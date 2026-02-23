import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { createProxyMiddleware } from "http-proxy-middleware";
import { initDatabase, getDb } from "./db.mjs";
import authRoutes, { requireAuth, seedUser, isSuperAdmin } from "./routes/auth.mjs";
import dataRoutes from "./routes/data.mjs";
import { checkQuota, recordUsage } from "./services/usageTracker.mjs";
import * as providerStore from "./services/providerStore.mjs";

const IS_PROD = process.env.NODE_ENV === "production";
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

const targetProxyAlt = (process.env.UPSTREAM_API_BASE_URL_ALT || "").trim();
const upstreamAuthorizationAlt = normalizeAuthorization(process.env.UPSTREAM_AUTHORIZATION_ALT || "");

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

// ---------- Initialize database & seed user ----------
initDatabase();
await seedUser();
providerStore.init();

// ---------- Express app ----------
const app = express();
app.disable("x-powered-by");
app.use(cookieParser());

// ---------- Mount auth routes ----------
app.use(authRoutes);

// ---------- Mount data CRUD routes ----------
app.use(dataRoutes);

// ---------- Upstream guard ----------
const toPositiveInt = (raw, fallback) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return v > 0 ? v : fallback;
};
const UPSTREAM_GUARD_ENABLED = String(process.env.UPSTREAM_GUARD_ENABLED || "true")
  .trim()
  .toLowerCase() !== "false";
const UPSTREAM_MAX_INFLIGHT_PER_USER = toPositiveInt(process.env.UPSTREAM_MAX_INFLIGHT_PER_USER, 2);
const UPSTREAM_MAX_INFLIGHT_GLOBAL = toPositiveInt(process.env.UPSTREAM_MAX_INFLIGHT_GLOBAL, 12);
const UPSTREAM_GUARD_RETRY_AFTER_SEC = toPositiveInt(process.env.UPSTREAM_GUARD_RETRY_AFTER_SEC, 5);
let upstreamImageInFlightGlobal = 0;
const upstreamImageInFlightByUser = new Map();

const isGuardedImageRoute = (rawUrl) => {
  const url = String(rawUrl || "");
  return url.includes("/v1/images/generations") || url.includes("/v1/images/edits");
};

const upstreamGuard = (req, res, next) => {
  if (!UPSTREAM_GUARD_ENABLED || !isGuardedImageRoute(req.originalUrl)) {
    next();
    return;
  }

  const user = String(req.authUser || "unknown");
  const userInFlight = Number(upstreamImageInFlightByUser.get(user) || 0);
  if (upstreamImageInFlightGlobal >= UPSTREAM_MAX_INFLIGHT_GLOBAL || userInFlight >= UPSTREAM_MAX_INFLIGHT_PER_USER) {
    const requestId = String(req.requestId || "");
    res.setHeader("Retry-After", String(UPSTREAM_GUARD_RETRY_AFTER_SEC));
    res.status(429).json({
      ok: false,
      message: "上游繁忙，已触发并发保护，请稍后重试。",
      request_id: requestId || undefined,
    });
    return;
  }

  upstreamImageInFlightGlobal += 1;
  upstreamImageInFlightByUser.set(user, userInFlight + 1);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    upstreamImageInFlightGlobal = Math.max(0, upstreamImageInFlightGlobal - 1);
    const cur = Number(upstreamImageInFlightByUser.get(user) || 0);
    if (cur <= 1) upstreamImageInFlightByUser.delete(user);
    else upstreamImageInFlightByUser.set(user, cur - 1);
  };

  res.on("finish", cleanup);
  res.on("close", cleanup);
  req.on("aborted", cleanup);
  next();
};

// ---------- Quota guard ----------
const quotaGuard = (req, res, next) => {
  if (!isGuardedImageRoute(req.originalUrl)) return next();
  const username = String(req.authUser || "");
  const db = getDb();
  const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!user) return next();
  req._quotaUserId = user.id;
  if (isSuperAdmin(username)) return next();
  const result = checkQuota(user.id);
  if (!result.allowed) {
    return res.status(429).json({ ok: false, message: result.message, quota_exceeded: true });
  }
  next();
};

// ---------- Upstream proxy (/api) ----------
// Data routes are mounted under /api/data and handled by dataRoutes above.
// All other /api/* requests are proxied to the upstream gateway.
/** Resolve active upstream config: providerStore first, env var fallback. */
const getUpstreamConfig = () => {
  const active = providerStore.getActive();
  if (active) {
    return { baseUrl: active.baseUrl, authorization: normalizeAuthorization(active.apiKey) };
  }
  // Fallback to env vars
  return { baseUrl: targetProxy, authorization: upstreamAuthorization };
};

app.use(
  "/api",
  (req, res, next) => {
    const incoming = String(req.headers["x-request-id"] || "").trim();
    const requestId = incoming || randomUUID();
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  },
  requireAuth,
  (req, res, next) => {
    const { authorization } = getUpstreamConfig();
    if (!authorization) {
      res.status(500).json({ ok: false, message: "当前线路未配置上游鉴权。" });
      return;
    }
    next();
  },
  upstreamGuard,
  quotaGuard,
  createProxyMiddleware({
    target: targetProxy,
    router: () => getUpstreamConfig().baseUrl,
    changeOrigin: true,
    secure: true,
    proxyTimeout: Number(process.env.UPSTREAM_PROXY_TIMEOUT_MS || 90000),
    timeout: Number(process.env.UPSTREAM_TIMEOUT_MS || 95000),
    pathRewrite: { "^/api": "" },
    on: {
      proxyReq: (proxyReq, req) => {
        const requestId = String(req.requestId || "");
        const { baseUrl, authorization } = getUpstreamConfig();
        proxyReq.setHeader("Authorization", authorization);
        proxyReq.setHeader("X-Auth-User", String(req.authUser || ""));
        if (requestId) {
          proxyReq.setHeader("X-Request-Id", requestId);
        }
        if (req.originalUrl.includes("/v1/images/generations") || req.originalUrl.includes("/v1/images/edits")) {
          console.info(`[UPSTREAM] ${requestId || "-"} ${req.method} ${req.originalUrl} -> ${baseUrl}`);
        }
      },
      proxyRes: (proxyRes, req) => {
        const requestId = String(req.requestId || "");
        const { baseUrl } = getUpstreamConfig();
        if (req.originalUrl.includes("/v1/images/generations") || req.originalUrl.includes("/v1/images/edits")) {
          console.info(
            `[UPSTREAM] ${requestId || "-"} ${req.method} ${req.originalUrl} <- ${proxyRes.statusCode || 0}`
          );
          if (req._quotaUserId) {
            try {
              recordUsage({
                userId: req._quotaUserId,
                username: String(req.authUser || ""),
                endpoint: req.originalUrl.includes("/v1/images/generations")
                  ? "/v1/images/generations" : "/v1/images/edits",
                model: null,
                statusCode: proxyRes.statusCode || 0,
                requestId,
              });
            } catch (e) { console.error(`[USAGE] record error: ${e.message}`); }
          }
          return;
        }
        if ((proxyRes.statusCode || 0) >= 500) {
          console.warn(
            `[UPSTREAM] ${requestId || "-"} ${req.method} ${req.originalUrl} -> ${proxyRes.statusCode} (${baseUrl})`
          );
        }
      },
      error: (err, req, res) => {
        const requestId = String(req?.requestId || "");
        console.error(
          `[UPSTREAM] ${requestId || "-"} proxy error: ${err?.code || "unknown"} ${err?.message || "unknown error"}`
        );
        if (res.writableEnded || res.destroyed) return;
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        }
        res.end(
          JSON.stringify({
            ok: false,
            message: `上游网关请求失败：${err.message || "unknown error"}`,
            request_id: requestId || undefined,
          })
        );
      },
    },
  })
);

// ---------- Production static serving ----------
if (process.env.NODE_ENV === "production") {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distDir = path.resolve(__dirname, "../dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
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

// ---------- Start server ----------
const port = Number(process.env.AUTH_PORT || process.env.PORT || 3101);
const host = String(process.env.AUTH_HOST || "0.0.0.0").trim() || "0.0.0.0";
let shuttingDown = false;

const server = app.listen(port, host, () => {
  console.log(`Auth server running on http://${host}:${port}`);
  console.log(`Seed user: ${AUTH_USERNAME}`);
  const active = providerStore.getActive();
  console.log(`[UPSTREAM] active provider: ${active ? `${active.name} (${active.baseUrl})` : `env fallback (${targetProxy})`}`);
  console.log(
    `[UPSTREAM] guard: ${UPSTREAM_GUARD_ENABLED ? "on" : "off"} (per-user=${UPSTREAM_MAX_INFLIGHT_PER_USER}, global=${UPSTREAM_MAX_INFLIGHT_GLOBAL})`
  );
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
