import { randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

const toHeadersObject = (headers) => {
  const out = {};
  if (!headers) return out;
  for (const [key, value] of headers.entries()) {
    out[key.toLowerCase()] = value;
  }
  return out;
};

const sanitizeHeaders = (headers = {}) => {
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = String(rawKey || "").toLowerCase();
    if (!key) continue;
    if (["host", "connection", "content-length", "transfer-encoding"].includes(key)) continue;
    const value = String(rawValue || "");
    if (value) out[key] = value;
  }
  return out;
};

export function createAsyncImageJobStore(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available for async image jobs");
  }
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Math.max(1_000, Number(opts.timeoutMs)) : DEFAULT_TIMEOUT_MS;
  const ttlMs = Number.isFinite(Number(opts.ttlMs)) ? Math.max(60_000, Number(opts.ttlMs)) : DEFAULT_TTL_MS;
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const jobs = new Map();

  const cleanup = () => {
    const cutoff = now() - ttlMs;
    for (const [id, job] of jobs.entries()) {
      if ((job.finishedAt || job.createdAt) < cutoff) jobs.delete(id);
    }
  };

  const submit = (input) => {
    cleanup();
    const id = randomUUID();
    const createdAt = now();
    const job = {
      id,
      status: "running",
      createdAt,
      updatedAt: createdAt,
      finishedAt: null,
      requestId: String(input.requestId || id),
      username: String(input.username || ""),
      userId: input.userId || null,
      endpoint: String(input.endpoint || ""),
      model: input.model || null,
      upstreamStatus: null,
      responseHeaders: {},
      responseText: "",
      error: null,
      done: null,
    };
    jobs.set(id, job);

    job.done = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetchImpl(input.targetUrl, {
          method: input.method || "POST",
          headers: sanitizeHeaders(input.headers),
          body: input.body,
          signal: controller.signal,
        });
        job.upstreamStatus = resp.status;
        job.responseHeaders = toHeadersObject(resp.headers);
        job.responseText = await resp.text();
        job.status = "succeeded";
      } catch (e) {
        const isAbort = e?.name === "AbortError";
        job.status = "failed";
        job.error = isAbort
          ? `上游任务超时（服务端等待 ${Math.round(timeoutMs / 1000)} 秒）`
          : String(e?.message || e || "上游任务失败");
      } finally {
        clearTimeout(timer);
        job.finishedAt = now();
        job.updatedAt = job.finishedAt;
      }
    })();

    return job;
  };

  const get = (id, username) => {
    cleanup();
    const job = jobs.get(String(id || ""));
    if (!job) return null;
    if (username !== undefined && job.username !== String(username || "")) return null;
    return job;
  };

  return { submit, get, cleanup };
}

export async function readRawBody(req, { limitBytes = 80 * 1024 * 1024 } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limitBytes) {
      const err = new Error("请求体过大。");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    request_id: job.requestId,
    endpoint: job.endpoint,
    model: job.model,
    upstream_status: job.upstreamStatus,
    content_type: job.responseHeaders?.["content-type"] || "application/json",
    response_text: job.status === "succeeded" ? job.responseText : undefined,
    error: job.status === "failed" ? job.error : undefined,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    finished_at: job.finishedAt,
  };
}
