import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { createProxyMiddleware } from "http-proxy-middleware";

dotenv.config({ path: ".env.local", override: false });
dotenv.config();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const IS_PROD = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "topseller_session";
const SESSION_TTL_SECONDS = Number(process.env.AUTH_SESSION_TTL_SECONDS || 60 * 60 * 24 * 7);
const JWT_SECRET = process.env.AUTH_JWT_SECRET || "dev-only-change-me";

const DEFAULT_USERNAME = "guoboss";
const DEFAULT_PASSWORD = "qazwsxedc1229";
const AUTH_USERNAME = (process.env.AUTH_USER || DEFAULT_USERNAME).trim();
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || DEFAULT_PASSWORD;
const PASSWORD_HASH = await bcrypt.hash(AUTH_PASSWORD, 10);

const users = new Map([[AUTH_USERNAME, { username: AUTH_USERNAME, passwordHash: PASSWORD_HASH }]]);

const targetProxy = (process.env.UPSTREAM_API_BASE_URL || process.env.VITE_API_PROXY_TARGET || "https://n.lconai.com").trim();
const upstreamAuthorization = (
  process.env.UPSTREAM_AUTHORIZATION ||
  process.env.VITE_AUTHORIZATION ||
  (process.env.VITE_API_KEY ? `Bearer ${process.env.VITE_API_KEY}` : "")
).trim();

if (IS_PROD && JWT_SECRET === "dev-only-change-me") {
  throw new Error("生产环境必须配置 AUTH_JWT_SECRET，不能使用默认值。");
}
if (IS_PROD && !process.env.AUTH_PASSWORD) {
  throw new Error("生产环境必须配置 AUTH_PASSWORD。");
}
if (IS_PROD && !upstreamAuthorization) {
  throw new Error("生产环境必须配置 UPSTREAM_AUTHORIZATION。");
}

const signToken = (username) =>
  jwt.sign({ sub: username }, JWT_SECRET, {
    expiresIn: SESSION_TTL_SECONDS,
  });

const verifyToken = (token) => {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const username = typeof payload === "object" ? String(payload.sub || "") : "";
    if (!username) return null;
    if (!users.has(username)) return null;
    return username;
  } catch {
    return null;
  }
};

const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax",
  secure: IS_PROD,
  maxAge: SESSION_TTL_SECONDS * 1000,
  path: "/",
});

const LOGIN_WINDOW_MS = Number(process.env.AUTH_LOGIN_WINDOW_MS || 10 * 60 * 1000);
const LOGIN_MAX_ATTEMPTS = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 5);
const LOGIN_BLOCK_MS = Number(process.env.AUTH_LOGIN_BLOCK_MS || 30 * 60 * 1000);
const loginAttempts = new Map();

const getClientIp = (req) => {
  const xff = String(req.headers["x-forwarded-for"] || "");
  if (xff) return xff.split(",")[0].trim();
  return String(req.ip || req.socket?.remoteAddress || "unknown");
};

const getLoginRateKey = (req) => {
  const username = String(req.body?.username || "").trim().toLowerCase() || "*";
  return `${getClientIp(req)}:${username}`;
};

const getOrInitRateState = (key, now) => {
  const cur = loginAttempts.get(key);
  if (!cur || now - cur.windowStart > LOGIN_WINDOW_MS) {
    const next = { windowStart: now, count: 0, blockedUntil: 0 };
    loginAttempts.set(key, next);
    return next;
  }
  return cur;
};

const checkLoginRateLimit = (req, res, next) => {
  const now = Date.now();
  const key = getLoginRateKey(req);
  const state = getOrInitRateState(key, now);
  if (state.blockedUntil > now) {
    const retryAfterSec = Math.ceil((state.blockedUntil - now) / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({ ok: false, message: "登录尝试过于频繁，请稍后再试。" });
    return;
  }
  res.locals.loginRateKey = key;
  next();
};

const registerLoginFailure = (key) => {
  const now = Date.now();
  const state = getOrInitRateState(key, now);
  state.count += 1;
  if (state.count >= LOGIN_MAX_ATTEMPTS) {
    state.blockedUntil = now + LOGIN_BLOCK_MS;
    state.count = 0;
    state.windowStart = now;
  }
  loginAttempts.set(key, state);
};

const registerLoginSuccess = (key) => {
  loginAttempts.delete(key);
};

const getSessionUsername = (req) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifyToken(token);
};

const requireAuth = (req, res, next) => {
  const username = getSessionUsername(req);
  if (!username) {
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(401).json({ ok: false, message: "未登录或登录已失效。" });
    return;
  }
  req.authUser = username;
  next();
};

app.get("/auth/health", (_req, res) => {
  res.json({ ok: true, authUserCount: users.size });
});

app.post("/auth/login", checkLoginRateLimit, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const rateKey = String(res.locals.loginRateKey || "");
  if (!username || !password) {
    if (rateKey) registerLoginFailure(rateKey);
    res.status(400).json({ ok: false, message: "请输入账号和密码。" });
    return;
  }

  const user = users.get(username);
  if (!user) {
    if (rateKey) registerLoginFailure(rateKey);
    console.warn(`[AUTH] login failed: unknown user (${username}) from ${getClientIp(req)}`);
    res.status(401).json({ ok: false, message: "账号或密码错误。" });
    return;
  }

  const matched = await bcrypt.compare(password, user.passwordHash);
  if (!matched) {
    if (rateKey) registerLoginFailure(rateKey);
    console.warn(`[AUTH] login failed: bad password (${username}) from ${getClientIp(req)}`);
    res.status(401).json({ ok: false, message: "账号或密码错误。" });
    return;
  }

  if (rateKey) registerLoginSuccess(rateKey);
  const token = signToken(user.username);
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
  console.info(`[AUTH] login success: ${user.username} from ${getClientIp(req)}`);
  res.json({ ok: true, user: { username: user.username } });
});

app.get("/auth/session", (req, res) => {
  const username = getSessionUsername(req);
  if (!username) {
    // 未登录态返回 200，减少前端控制台噪音；真正的 API 保护由 /api 中间件负责。
    res.json({ ok: false, user: null });
    return;
  }
  res.json({ ok: true, user: { username } });
});

app.post("/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

app.use(
  "/api",
  requireAuth,
  (req, res, next) => {
    if (!upstreamAuthorization) {
      res.status(500).json({ ok: false, message: "服务端未配置上游鉴权（UPSTREAM_AUTHORIZATION）。" });
      return;
    }
    next();
  },
  createProxyMiddleware({
    target: targetProxy,
    changeOrigin: true,
    secure: true,
    pathRewrite: { "^/api": "" },
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader("Authorization", upstreamAuthorization);
      proxyReq.setHeader("X-Auth-User", String(req.authUser || ""));
    },
    onError: (err, _req, res) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      }
      res.end(JSON.stringify({ ok: false, message: `上游网关请求失败：${err.message || "unknown error"}` }));
    },
  })
);

if (process.env.NODE_ENV === "production") {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distDir = path.resolve(__dirname, "../dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }
}

const port = Number(process.env.AUTH_PORT || process.env.PORT || 3101);
app.listen(port, () => {
  console.log(`Auth server running on http://localhost:${port}`);
  console.log(`Seed user: ${AUTH_USERNAME}`);
});
