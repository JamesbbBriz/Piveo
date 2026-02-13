import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
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
app.use(cookieParser());

const IS_PROD = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "topseller_session";
const SESSION_TTL_SECONDS = Number(process.env.AUTH_SESSION_TTL_SECONDS || 60 * 60 * 24 * 7);
const JWT_SECRET = process.env.AUTH_JWT_SECRET || "dev-only-change-me";

const AUTH_USERNAME = String(process.env.AUTH_USER || "").trim();
const AUTH_PASSWORD = String(process.env.AUTH_PASSWORD || "");

const targetProxy = (process.env.UPSTREAM_API_BASE_URL || process.env.VITE_API_PROXY_TARGET || "https://n.lconai.com").trim();
const normalizeAuthorization = (raw) => {
  let v = String(raw || "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  if (/^sk-[\w-]+$/i.test(v)) {
    v = `Bearer ${v}`;
  }
  return v;
};

const upstreamAuthorization = normalizeAuthorization(
  process.env.UPSTREAM_AUTHORIZATION ||
  process.env.VITE_AUTHORIZATION ||
  (process.env.VITE_API_KEY ? `Bearer ${process.env.VITE_API_KEY}` : "")
);

if (IS_PROD && JWT_SECRET === "dev-only-change-me") {
  throw new Error("生产环境必须配置 AUTH_JWT_SECRET，不能使用默认值。");
}
if (IS_PROD && !process.env.AUTH_PASSWORD) {
  throw new Error("生产环境必须配置 AUTH_PASSWORD。");
}
if (IS_PROD && !upstreamAuthorization) {
  throw new Error("生产环境必须配置 UPSTREAM_AUTHORIZATION。");
}
if (!AUTH_USERNAME || !AUTH_PASSWORD) {
  throw new Error("必须配置 AUTH_USER 与 AUTH_PASSWORD，禁止使用硬编码默认凭据。");
}

const PASSWORD_HASH = await bcrypt.hash(AUTH_PASSWORD, 10);
const users = new Map([[AUTH_USERNAME, { username: AUTH_USERNAME, passwordHash: PASSWORD_HASH }]]);

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

// 每 30 分钟清理过期的登录限流条目，防止内存泄漏
const LOGIN_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  const expiryThreshold = LOGIN_WINDOW_MS + LOGIN_BLOCK_MS;
  for (const [key, state] of loginAttempts) {
    if (now - state.windowStart > expiryThreshold) {
      loginAttempts.delete(key);
    }
  }
}, LOGIN_CLEANUP_INTERVAL_MS).unref();

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

const isDisallowedProxyHost = (hostname) => {
  const raw = String(hostname || "").trim().toLowerCase();
  if (!raw) return true;
  if (raw === "localhost" || raw.endsWith(".localhost") || raw.endsWith(".local")) return true;
  const h = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  const ipVer = net.isIP(h);
  if (!ipVer) return false;
  if (ipVer === 4) {
    if (h.startsWith("10.")) return true;
    if (h.startsWith("127.")) return true;
    if (h.startsWith("192.168.")) return true;
    const parts = h.split(".").map((x) => Number(x));
    if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
  }
  const v6 = h.toLowerCase();
  if (v6 === "::1") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) return true;
  return false;
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

app.post("/auth/login", express.json({ limit: "1mb" }), checkLoginRateLimit, async (req, res) => {
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

app.get("/auth/image-proxy", requireAuth, async (req, res) => {
  const raw = String(req.query?.url || "").trim();
  if (!raw) {
    res.status(400).json({ ok: false, message: "缺少 url 参数。" });
    return;
  }

  let u;
  try {
    u = new URL(raw);
  } catch {
    res.status(400).json({ ok: false, message: "图片地址格式无效。" });
    return;
  }
  if (!/^https?:$/i.test(u.protocol)) {
    res.status(400).json({ ok: false, message: "仅支持 http/https 图片地址。" });
    return;
  }
  if (isDisallowedProxyHost(u.hostname)) {
    res.status(403).json({ ok: false, message: "不允许代理该主机地址。" });
    return;
  }

  const controller = new AbortController();
  const timeoutMs = Number(process.env.IMAGE_PROXY_TIMEOUT_MS || 15000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstreamResp = await fetch(u.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "image/*,*/*;q=0.8",
      },
    });

    if (!upstreamResp.ok) {
      const text = await upstreamResp.text().catch(() => "");
      res.status(upstreamResp.status).json({
        ok: false,
        message: `图片拉取失败：HTTP ${upstreamResp.status} ${text.slice(0, 160)}`.trim(),
      });
      return;
    }

    const ct = upstreamResp.headers.get("content-type") || "application/octet-stream";
    const cc = upstreamResp.headers.get("cache-control");
    const etag = upstreamResp.headers.get("etag");
    const lm = upstreamResp.headers.get("last-modified");
    if (!/^image\//i.test(ct)) {
      res.status(415).json({
        ok: false,
        message: `代理地址返回的不是图片内容（${ct || "unknown"}）。`,
      });
      return;
    }

    res.setHeader("Content-Type", ct);
    if (cc) res.setHeader("Cache-Control", cc);
    else res.setHeader("Cache-Control", "private, max-age=3600");
    if (etag) res.setHeader("ETag", etag);
    if (lm) res.setHeader("Last-Modified", lm);
    const cl = upstreamResp.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);
    res.setHeader("X-Proxy-Image", "1");
    res.status(200);
    if (!upstreamResp.body) {
      res.status(502).json({ ok: false, message: "上游未返回有效图片流。" });
      return;
    }
    const stream = Readable.fromWeb(upstreamResp.body);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(502).json({ ok: false, message: "图片流转发失败。" });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof DOMException && e.name === "AbortError";
    res.status(isAbort ? 504 : 502).json({
      ok: false,
      message: isAbort ? "图片拉取超时。" : `图片拉取失败：${msg}`,
    });
  } finally {
    clearTimeout(timer);
  }
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
    proxyTimeout: Number(process.env.UPSTREAM_PROXY_TIMEOUT_MS || 90000),
    timeout: Number(process.env.UPSTREAM_TIMEOUT_MS || 95000),
    pathRewrite: { "^/api": "" },
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader("Authorization", upstreamAuthorization);
        proxyReq.setHeader("X-Auth-User", String(req.authUser || ""));
      },
      proxyRes: (proxyRes, req) => {
        if ((proxyRes.statusCode || 0) >= 500) {
          console.warn(
            `[UPSTREAM] ${req.method} ${req.originalUrl} -> ${proxyRes.statusCode} (${targetProxy})`
          );
        }
      },
      error: (err, _req, res) => {
        console.error(`[UPSTREAM] proxy error: ${err?.code || "unknown"} ${err?.message || "unknown error"}`);
        // 响应已结束或已销毁时不再写入，避免 ERR_STREAM_WRITE_AFTER_END
        if (res.writableEnded || res.destroyed) return;
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        }
        res.end(JSON.stringify({ ok: false, message: `上游网关请求失败：${err.message || "unknown error"}` }));
      },
    },
  })
);

if (process.env.NODE_ENV === "production") {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distDir = path.resolve(__dirname, "../dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    // Express 5 + path-to-regexp v8 不再支持 app.get("*")，使用无路径中间件做 SPA 回退。
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (req.path.startsWith("/api/") || req.path === "/api" || req.path.startsWith("/auth/") || req.path === "/auth") {
        next();
        return;
      }
      res.sendFile(path.join(distDir, "index.html"));
    });
  }
}

const port = Number(process.env.AUTH_PORT || process.env.PORT || 3101);
const host = String(process.env.AUTH_HOST || "127.0.0.1").trim() || "127.0.0.1";
let shuttingDown = false;

const server = app.listen(port, host, () => {
  console.log(`Auth server running on http://${host}:${port}`);
  console.log(`Seed user: ${AUTH_USERNAME}`);
  console.log(`[UPSTREAM] target: ${targetProxy}`);
  console.log(`[UPSTREAM] auth configured: ${upstreamAuthorization ? "yes" : "no"}`);
});

server.on("error", (err) => {
  console.error(`[AUTH] server error: ${err?.code || "unknown"} ${err?.message || "unknown error"}`);
  process.exitCode = 1;
});

server.on("close", () => {
  if (!shuttingDown) {
    console.error("[AUTH] server closed unexpectedly.");
  }
});

const shutdown = (signal) => {
  shuttingDown = true;
  console.log(`[AUTH] received ${signal}, shutting down...`);
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
