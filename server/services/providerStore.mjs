import { getDb } from "../db.mjs";

/**
 * Provider store — env-var-driven with DB persistence for activation state + model cache.
 *
 * Provider definitions (name, URL, API key) come from environment variables.
 * The DB only stores which provider is active and cached model lists.
 *
 * Env var pattern per provider slot:
 *   UPSTREAM_API_BASE_URL        / UPSTREAM_AUTHORIZATION        → "primary"
 *   UPSTREAM_API_BASE_URL_2      / UPSTREAM_AUTHORIZATION_2      → "slot2"
 *   UPSTREAM_API_BASE_URL_3      / UPSTREAM_AUTHORIZATION_3      → "slot3"
 *   ... (unlimited)
 *
 * Legacy aliases (still supported):
 *   UPSTREAM_API_BASE_URL_ALT    / UPSTREAM_AUTHORIZATION_ALT    → "alt"
 *
 * Display names:
 *   UPSTREAM_NAME (default "线路1"), UPSTREAM_NAME_2, UPSTREAM_NAME_3 ...
 *   UPSTREAM_NAME_ALT (default "备用线路")
 */

const normalizeAuthorization = (raw) => {
  let v = String(raw || "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  if (/^sk-[\w-]+$/i.test(v)) {
    v = `Bearer ${v}`;
  }
  return v;
};

/** @type {Map<string, Provider>} */
let providers = new Map();

/**
 * Build provider list from env vars. Called once at init.
 */
function buildFromEnv() {
  const defs = [];

  // Slot 1 (primary) — uses base env var names for backwards compatibility
  const primaryUrl = (process.env.UPSTREAM_API_BASE_URL || process.env.VITE_API_PROXY_TARGET || "").trim();
  const primaryKey = normalizeAuthorization(
    process.env.UPSTREAM_AUTHORIZATION || process.env.VITE_AUTHORIZATION ||
    (process.env.VITE_API_KEY ? `Bearer ${process.env.VITE_API_KEY}` : "")
  );
  if (primaryUrl && primaryKey) {
    defs.push({
      id: "primary",
      name: (process.env.UPSTREAM_NAME || "线路1").trim(),
      baseUrl: primaryUrl,
      apiKey: primaryKey,
      type: (process.env.UPSTREAM_PROVIDER_TYPE || "openai").trim(),
    });
  }

  // Numbered slots: _2, _3, _4, ... (scan until gap)
  for (let i = 2; ; i++) {
    const url = (process.env[`UPSTREAM_API_BASE_URL_${i}`] || "").trim();
    const key = normalizeAuthorization(process.env[`UPSTREAM_AUTHORIZATION_${i}`] || "");
    if (!url || !key) break;
    defs.push({
      id: `slot${i}`,
      name: (process.env[`UPSTREAM_NAME_${i}`] || `线路${i}`).trim(),
      baseUrl: url,
      apiKey: key,
      type: (process.env[`UPSTREAM_PROVIDER_TYPE_${i}`] || "openai").trim(),
    });
  }

  // Legacy _ALT slot (kept for backwards compat, skipped if already covered by _2)
  if (!defs.some((d) => d.baseUrl === (process.env.UPSTREAM_API_BASE_URL_ALT || "").trim())) {
    const altUrl = (process.env.UPSTREAM_API_BASE_URL_ALT || "").trim();
    const altKey = normalizeAuthorization(process.env.UPSTREAM_AUTHORIZATION_ALT || "");
    if (altUrl && altKey) {
      defs.push({
        id: "alt",
        name: (process.env.UPSTREAM_NAME_ALT || "备用线路").trim(),
        baseUrl: altUrl,
        apiKey: altKey,
        type: (process.env.UPSTREAM_PROVIDER_TYPE_ALT || "openai").trim(),
      });
    }
  }

  return defs;
}

/** Initialize: build from env, then hydrate activation state + model cache from DB. */
export function init() {
  const defs = buildFromEnv();
  const db = getDb();

  // Ensure DB rows exist for each env-defined provider
  const upsert = db.prepare(
    "INSERT OR IGNORE INTO providers (id, is_active) VALUES (?, 0)"
  );
  for (const d of defs) {
    upsert.run(d.id);
  }

  // Read DB state
  const rows = db.prepare("SELECT * FROM providers").all();
  const dbState = new Map(rows.map((r) => [r.id, r]));

  // Merge: env provides config, DB provides state
  providers = new Map();
  for (const d of defs) {
    const row = dbState.get(d.id);
    providers.set(d.id, {
      ...d,
      isActive: Boolean(row?.is_active),
      modelsCache: row?.models_cache ? JSON.parse(row.models_cache) : null,
      modelsFetchedAt: row?.models_fetched_at ?? null,
      allowedModels: row?.allowed_models ? JSON.parse(row.allowed_models) : null,
    });
  }

  // If no provider is active but we have providers, activate the first one
  if (providers.size > 0 && !getActive()) {
    const firstId = defs[0].id;
    db.prepare("UPDATE providers SET is_active = 1 WHERE id = ?").run(firstId);
    providers.get(firstId).isActive = true;
  }

  console.log(`[ProviderStore] loaded ${providers.size} provider(s) from env vars`);
}

/** Return all providers (env-defined, enriched with DB state). */
export function getAll() {
  return Array.from(providers.values());
}

/** Return the active provider, or null. */
export function getActive() {
  for (const p of providers.values()) {
    if (p.isActive) return p;
  }
  return null;
}

/** Activate a provider by id (DB + cache). */
export function activate(id) {
  if (!providers.has(id)) throw new Error("供应商不存在。");

  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE providers SET is_active = 0 WHERE is_active = 1").run();
    db.prepare("UPDATE providers SET is_active = 1 WHERE id = ?").run(id);
  })();

  for (const p of providers.values()) {
    p.isActive = p.id === id;
  }
}

/** Store fetched model list. */
export function updateModelsCache(id, models) {
  const target = providers.get(id);
  if (!target) throw new Error("供应商不存在。");

  const now = Date.now();
  const db = getDb();
  db.prepare(
    "UPDATE providers SET models_cache = ?, models_fetched_at = ? WHERE id = ?"
  ).run(JSON.stringify(models), now, id);

  target.modelsCache = models;
  target.modelsFetchedAt = now;
}

/** Update allowed models for a provider. */
export function updateAllowedModels(id, models) {
  const target = providers.get(id);
  if (!target) throw new Error("供应商不存在。");

  const db = getDb();
  db.prepare(
    "UPDATE providers SET allowed_models = ? WHERE id = ?"
  ).run(JSON.stringify(models), id);

  target.allowedModels = models;
}

/** Strip known suffixes (-2k, etc.) and lowercase for matching. */
export function normalizeModelId(id) {
  if (!id) return "";
  return id.toLowerCase().replace(/-2k$/i, "");
}

/** Find a provider whose allowedModels includes the given model. Prefers active. Case-insensitive, suffix-normalized. */
export function findProviderForModel(modelId) {
  if (!modelId) return null;
  const needle = normalizeModelId(modelId);
  let fallback = null;
  for (const p of providers.values()) {
    if (!Array.isArray(p.allowedModels)) continue;
    if (!p.allowedModels.some((m) => normalizeModelId(m) === needle)) continue;
    if (p.isActive) return p;
    if (!fallback) fallback = p;
  }
  return fallback;
}

/** Return the union of all providers' allowedModels, or null if none configured. Lowercase-deduped. */
export function getAllAllowedModels() {
  const seen = new Set();
  const result = [];
  let anyConfigured = false;
  for (const p of providers.values()) {
    if (Array.isArray(p.allowedModels)) {
      anyConfigured = true;
      for (const m of p.allowedModels) {
        const lower = m.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          result.push(m);
        }
      }
    }
  }
  return anyConfigured ? result : null;
}

/** Fetch model list from upstream /v1/models, cache and return. */
export async function fetchModelsFromUpstream(id) {
  const target = providers.get(id);
  if (!target) throw new Error("供应商不存在。");

  let authorization = target.apiKey;
  if (authorization && !authorization.toLowerCase().startsWith("bearer ")) {
    authorization = `Bearer ${authorization}`;
  }

  const url = `${target.baseUrl.replace(/\/+$/, "")}/v1/models`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    throw new Error(`上游返回 HTTP ${resp.status}`);
  }

  const body = await resp.json();
  const models = (body.data || []).map((m) => m.id).filter(Boolean);
  updateModelsCache(id, models);
  return models;
}
