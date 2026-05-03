import { createHash, randomUUID } from "node:crypto";

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

const hashText = (text) => createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);

const compactText = (text, limit = 220) =>
  String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

const parseBoundary = (contentType) => {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType || ""));
  return (m?.[1] || m?.[2] || "").trim();
};

const parseContentDisposition = (raw) => {
  const name = /(?:^|;)\s*name="([^"]*)"/i.exec(raw)?.[1] || "";
  const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(raw)?.[1] || "";
  return { name, filename };
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export function summarizeImageRequest({ contentType = "", body = Buffer.alloc(0) } = {}) {
  const ct = String(contentType || "");
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
  const base = {
    content_type: ct.split(";")[0].trim().toLowerCase() || "unknown",
    body_bytes: buf.length,
    fields: {},
    images: [],
    image_count: 0,
    image_bytes: 0,
    prompt_hash: null,
    prompt_preview: "",
  };

  if (/application\/json/i.test(ct)) {
    const parsed = safeJsonParse(buf.toString("utf8"));
    if (parsed && typeof parsed === "object") {
      for (const key of ["model", "n", "size", "response_format", "quality"]) {
        if (parsed[key] !== undefined && parsed[key] !== null) base.fields[key] = String(parsed[key]);
      }
      if (typeof parsed.prompt === "string") {
        base.prompt_hash = hashText(parsed.prompt);
        base.prompt_preview = compactText(parsed.prompt);
      }
    }
    return base;
  }

  const boundary = parseBoundary(ct);
  if (!boundary || !/multipart\/form-data/i.test(ct)) return base;

  const marker = Buffer.from(`--${boundary}`);
  let pos = 0;
  while (pos < buf.length) {
    const start = buf.indexOf(marker, pos);
    if (start < 0) break;
    const next = buf.indexOf(marker, start + marker.length);
    if (next < 0) break;
    pos = next;

    let part = buf.subarray(start + marker.length, next);
    if (part.length >= 2 && part[0] === 45 && part[1] === 45) break;
    if (part.length >= 2 && part[0] === 13 && part[1] === 10) part = part.subarray(2);
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) continue;
    const headerText = part.subarray(0, headerEnd).toString("latin1");
    const content = part.subarray(headerEnd + 4);
    const disposition = /^content-disposition:\s*(.+)$/im.exec(headerText)?.[1] || "";
    const contentPartType = /^content-type:\s*(.+)$/im.exec(headerText)?.[1]?.trim() || "";
    const { name, filename } = parseContentDisposition(disposition);
    if (!name) continue;

    if (filename || name === "image" || name === "mask") {
      base.images.push({
        field: name,
        filename: filename || undefined,
        content_type: contentPartType || undefined,
        bytes: content.length,
      });
      base.image_bytes += content.length;
      continue;
    }

    const value = content.toString("utf8");
    if (name === "prompt") {
      base.prompt_hash = hashText(value);
      base.prompt_preview = compactText(value);
    } else if (["model", "n", "size", "response_format", "quality"].includes(name)) {
      base.fields[name] = compactText(value, 80);
    }
  }

  base.image_count = base.images.length;
  return base;
}

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
