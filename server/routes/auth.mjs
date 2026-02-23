import net from "node:net";
import { Readable } from "node:stream";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db.mjs";

const IS_PROD = process.env.NODE_ENV === "production";

// ---------- Super admin & provider state ----------
const SUPER_ADMIN_USERS = new Set(
  (process.env.SUPER_ADMIN_USERS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
);

export const isSuperAdmin = (username) =>
  SUPER_ADMIN_USERS.has(String(username || "").trim().toLowerCase());

import * as providerStore from "../services/providerStore.mjs";
const SESSION_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "topseller_session";
const SESSION_TTL_SECONDS = Number(process.env.AUTH_SESSION_TTL_SECONDS || 60 * 60 * 24 * 7);
const JWT_SECRET = process.env.AUTH_JWT_SECRET || "dev-only-change-me";

// ---------- Rate limiting ----------
const LOGIN_WINDOW_MS = Number(process.env.AUTH_LOGIN_WINDOW_MS || 10 * 60 * 1000);
const LOGIN_MAX_ATTEMPTS = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 5);
const LOGIN_BLOCK_MS = Number(process.env.AUTH_LOGIN_BLOCK_MS || 30 * 60 * 1000);
const loginAttempts = new Map();

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

// ---------- Helpers ----------
const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax",
  secure: IS_PROD,
  maxAge: SESSION_TTL_SECONDS * 1000,
  path: "/",
});

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

const signToken = (username) =>
  jwt.sign({ sub: username }, JWT_SECRET, {
    expiresIn: SESSION_TTL_SECONDS,
  });

export const verifyToken = (token) => {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const username = typeof payload === "object" ? String(payload.sub || "") : "";
    if (!username) return null;
    // Validate against DB instead of in-memory Map
    const db = getDb();
    const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (!user) return null;
    return username;
  } catch {
    return null;
  }
};

export const getSessionUsername = (req) => {
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

export const requireAuth = (req, res, next) => {
  const username = getSessionUsername(req);
  if (!username) {
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(401).json({ ok: false, message: "未登录或登录已失效。" });
    return;
  }
  req.authUser = username;
  next();
};

/**
 * Seed the initial user from env vars into the SQLite users table.
 * Called on startup. Insert only if the user doesn't already exist.
 */
export async function seedUser() {
  // Collect seed user pairs: AUTH_USER/AUTH_PASSWORD, AUTH_USER_2/AUTH_PASSWORD_2, ...
  const pairs = [];
  const primary = String(process.env.AUTH_USER || "").trim();
  const primaryPw = String(process.env.AUTH_PASSWORD || "");
  if (primary && primaryPw) pairs.push({ username: primary, password: primaryPw });

  for (let i = 2; i <= 10; i++) {
    const u = String(process.env[`AUTH_USER_${i}`] || "").trim();
    const p = String(process.env[`AUTH_PASSWORD_${i}`] || "");
    if (u && p) pairs.push({ username: u, password: p });
  }

  if (pairs.length === 0) {
    throw new Error("必须配置 AUTH_USER 与 AUTH_PASSWORD，禁止使用硬编码默认凭据。");
  }

  const db = getDb();
  for (const { username, password } of pairs) {
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (!existing) {
      const hash = await bcrypt.hash(password, 10);
      const now = Date.now();
      db.prepare(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(uuidv4(), username, hash, username, now, now);
      console.log(`[AUTH] Seeded user: ${username}`);
    } else {
      console.log(`[AUTH] User already exists: ${username}`);
    }
  }
}

// ---------- Router ----------
const router = express.Router();

router.get("/auth/health", (_req, res) => {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) as cnt FROM users").get();
  res.json({ ok: true, authUserCount: count.cnt });
});

router.post("/auth/login", express.json({ limit: "1mb" }), checkLoginRateLimit, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const rateKey = String(res.locals.loginRateKey || "");
  if (!username || !password) {
    if (rateKey) registerLoginFailure(rateKey);
    res.status(400).json({ ok: false, message: "请输入账号和密码。" });
    return;
  }

  const db = getDb();
  const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username);
  if (!user) {
    if (rateKey) registerLoginFailure(rateKey);
    console.warn(`[AUTH] login failed: unknown user (${username}) from ${getClientIp(req)}`);
    res.status(401).json({ ok: false, message: "账号或密码错误。" });
    return;
  }

  const matched = await bcrypt.compare(password, user.password_hash);
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
  res.json({ ok: true, user: { username: user.username, isSuperAdmin: isSuperAdmin(user.username) } });
});

router.get("/auth/session", (req, res) => {
  const username = getSessionUsername(req);
  if (!username) {
    res.json({ ok: false, user: null });
    return;
  }
  res.json({ ok: true, user: { username, isSuperAdmin: isSuperAdmin(username) } });
});

router.get("/auth/provider", requireAuth, (req, res) => {
  const providers = providerStore.getAll();
  const active = providerStore.getActive();
  res.json({
    ok: true,
    active: active?.id || "primary",
    options: providers.map((p) => ({ id: p.id, label: p.name })),
  });
});

router.post("/auth/provider", express.json({ limit: "1mb" }), requireAuth, (req, res) => {
  if (!isSuperAdmin(req.authUser)) {
    return res.status(403).json({ ok: false, message: "无权限" });
  }
  const providerId = String(req.body?.provider || "");
  try {
    providerStore.activate(providerId);
    console.info(`[AUTH] Super admin ${req.authUser} switched provider → ${providerId}`);
    res.json({ ok: true, active: providerId });
  } catch (e) {
    return res.status(400).json({ ok: false, message: e.message });
  }
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

router.get("/auth/image-proxy", requireAuth, async (req, res) => {
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

export default router;
