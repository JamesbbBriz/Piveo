// This module exposes an OpenAI-style images API surface, backed by an
// OpenAI-compatible HTTP endpoint.
// Default base URL is `/api` so the Vite dev server can proxy to bypass CORS.

import { ApiConfig, getEffectiveApiConfig } from "./apiConfig";

export interface ClientRequestOptions {
  api?: Partial<ApiConfig>;
  signal?: AbortSignal;
}

/**
 * 创建图片请求，用于创建AI生成图片的请求参数
 */
export interface 创建图片请求 {
  /**
   * 需要编辑的图片（文生图移除参数），可以是链接，可以是 b64
   */
  image?: string[];
  /**
   * 模型，用于图像生成的模型。
   */
  model?: Model;
  /**
   * 生成数量，要生成的图片数量。
   */
  n?: number | null;
  /**
   * 提示词，期望生成图片的文本描述，建议使用具体和详细的描述，包含关键的视觉元素，指定期望的艺术风格，描述构图和视角。
   */
  prompt: string;
  /**
   * 响应格式，返回生成图片的格式，有些是强制返回固定格式。
   */
  response_format?: ResponseFormat;
  /**
   * 图片尺寸，生成图片的尺寸（每个模型的尺寸请参考对应模型说明）。
   * 允许非枚举值（例如 "832x1248"），会被映射到 Gemini 的最接近的 aspect ratio。
   */
  size?: Size | string;
  [property: string]: any;
}

/**
 * 模型，用于图像生成的模型。
 */
export enum Model {
  Gemini25FlashImage = "gemini-2.5-flash-image",
  Gemini3ProImagePreview = "gemini-3-pro-image-preview",
  GptImage15 = "gpt-image-1.5",
}

/**
 * 响应格式，返回生成图片的格式，有些是强制返回固定格式。
 */
export enum ResponseFormat {
  B64json = "b64_json",
  Url = "url",
}

/**
 * 图片尺寸，生成图片的尺寸（每个模型的尺寸请参考对应模型说明）。
 */
export enum Size {
  The1024X1024 = "1024x1024",
  The1024X1792 = "1024x1792",
  The1792X1024 = "1792x1024",
  The256X256 = "256x256",
  The512X512 = "512x512",
}

export interface 图片对象 {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

export interface 图片生成响应 {
  created: number;
  data: 图片对象[];
  // 非 OpenAI 标准字段：用于前端展示实际命中的模型和接口。
  model_used?: string;
  endpoint_used?: "/v1/images/generations" | "/v1/chat/completions" | "/v1/images/edits";
  usage?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: {
      text_tokens?: number;
      image_tokens?: number;
    };
  };
}

const extractBase64 = (dataUrl: string): string => dataUrl.split(",")[1] || "";
const isDataUrl = (s: string) => /^data:/i.test(s);
const isHttpUrl = (s: string) => /^https?:\/\//i.test(s);
const guessMimeTypeFromB64 = (b64: string): string => {
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/png";
};

export const imageObjToDataUrl = (obj: 图片对象): string | null => {
  if (obj.url) return obj.url;
  if (obj.b64_json) {
    const mime = guessMimeTypeFromB64(obj.b64_json);
    return `data:${mime};base64,${obj.b64_json}`;
  }
  return null;
};

const normalizeImageInput = (s: string): string => {
  // Spec says: URL or b64. If caller passes data URL, strip header.
  if (isDataUrl(s)) return extractBase64(s);
  return s;
};

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, "");

const includesUnsupportedModelError = (message: string): boolean =>
  /not supported model for image generation/i.test(message) ||
  /unsupported model/i.test(message) ||
  /模型.*不支持.*(图片|生图)/i.test(message);

const chooseFallbackModel = (current: string, available: string[]): string | null => {
  const normalized = Array.from(
    new Set(
      available
        .map((m) => String(m || "").trim())
        .filter(Boolean)
        .filter((m) => !/^sora-/i.test(m))
    )
  );
  if (!normalized.length) return null;

  const preferredOrder = [
    "gpt-image-1.5",
    "gpt-image-1",
    "gemini-2.5-flash-image",
    "gemini-3-pro-image-preview",
  ];

  for (const preferred of preferredOrder) {
    if (preferred !== current && normalized.includes(preferred)) return preferred;
  }

  const anyImageModel = normalized.find((m) => /image/i.test(m) && m !== current);
  if (anyImageModel) return anyImageModel;

  const firstDifferent = normalized.find((m) => m !== current);
  return firstDifferent || null;
};

const getClientConfig = (override?: Partial<ApiConfig>): ApiConfig => {
  const base = getEffectiveApiConfig();
  const merged: ApiConfig = {
    baseUrl: override?.baseUrl ?? base.baseUrl,
    authorization: override?.authorization ?? base.authorization,
    defaultImageModel: override?.defaultImageModel ?? base.defaultImageModel,
  };
  merged.baseUrl = normalizeBaseUrl(merged.baseUrl || "/api");
  merged.authorization = (merged.authorization || "").trim();
  merged.defaultImageModel = (merged.defaultImageModel || Model.Gemini25FlashImage).trim();
  return merged;
};

const buildAuthHeaders = (cfg: ApiConfig): Record<string, string> => {
  const auth = (cfg.authorization || "").trim();
  return auth ? { Authorization: auth } : {};
};

const toImageUrlForChat = (s: string): string => {
  if (isHttpUrl(s) || isDataUrl(s)) return s;
  // raw base64
  const mime = guessMimeTypeFromB64(s);
  return `data:${mime};base64,${s}`;
};

const isGeminiImageModel = (model: string): boolean => /^gemini-/i.test(model) && /image/i.test(model);

export const listModels = async (opts?: ClientRequestOptions): Promise<string[]> => {
  const cfg = getClientConfig(opts?.api);

  const resp = await fetch(`${cfg.baseUrl}/v1/models`, {
    headers: buildAuthHeaders(cfg),
    signal: opts?.signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`拉取模型列表失败：HTTP ${resp.status} ${text}`.trim());
  }
  const json = await resp.json();
  const data = Array.isArray(json?.data) ? json.data : [];
  const ids = data.map((m: any) => m?.id).filter((x: any) => typeof x === "string");
  return ids;
};

export interface BalanceInfo {
  amount: number | null;
  currency?: string;
  endpointUsed?: string;
}

const toNumberOrNull = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const normalizeUsageToUsd = (usedRaw: number, limitUsd: number): number => {
  // 网关常见三种口径：美元、分、千分之一美元。
  // 选择“与额度量级最接近且不过分夸张”的口径。
  const candidates = [usedRaw, usedRaw / 100, usedRaw / 1000];
  const maxReasonable = Math.max(limitUsd * 1.2, 1);
  for (const c of candidates) {
    if (c >= 0 && c <= maxReasonable) return c;
  }
  // 如果都不在合理区间，优先保守地按美元处理。
  return usedRaw;
};

const parseBalancePayload = (payload: any): { amount: number | null; currency?: string } => {
  if (!payload || typeof payload !== "object") return { amount: null };

  const directCandidates = [
    payload?.total_available,
    payload?.available_balance,
    payload?.balance,
    payload?.credit?.balance,
    payload?.data?.total_available,
    payload?.data?.available_balance,
    payload?.data?.balance,
    payload?.result?.balance,
  ];
  for (const c of directCandidates) {
    const n = toNumberOrNull(c);
    if (n !== null) {
      return {
        amount: n,
        currency: payload?.currency || payload?.credit?.currency || payload?.data?.currency || "USD",
      };
    }
  }

  const granted = toNumberOrNull(payload?.total_granted);
  const used = toNumberOrNull(payload?.total_used);
  if (granted !== null && used !== null) {
    return { amount: granted - used, currency: payload?.currency || "USD" };
  }

  return { amount: null, currency: payload?.currency || payload?.data?.currency || "USD" };
};

export const fetchBalance = async (opts?: ClientRequestOptions): Promise<BalanceInfo> => {
  const cfg = getClientConfig(opts?.api);

  const requestJson = async (path: string): Promise<any> => {
    const resp = await fetch(`${cfg.baseUrl}${path}`, {
      method: "GET",
      headers: buildAuthHeaders(cfg),
      signal: opts?.signal,
    });
    if (resp.status === 404 || resp.status === 405) {
      throw new Error(`not_supported:${path}`);
    }
    if (resp.status === 401 || resp.status === 403) {
      const text = await resp.text().catch(() => "");
      throw new Error(`鉴权失败：HTTP ${resp.status} ${text}`.trim());
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} ${text}`.trim());
    }
    const text = await resp.text().catch(() => "");
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  // 优先尝试文档中明确给出的组合端点：
  // 1) /v1/dashboard/billing/subscription（额度）
  // 2) /v1/dashboard/billing/usage（已用）
  try {
    const [subscription, usage] = await Promise.all([
      requestJson("/v1/dashboard/billing/subscription"),
      requestJson("/v1/dashboard/billing/usage"),
    ]);
    const subLimitCandidates = [
      subscription?.hard_limit_usd,
      subscription?.soft_limit_usd,
      subscription?.system_hard_limit_usd,
      subscription?.data?.hard_limit_usd,
      subscription?.data?.soft_limit_usd,
      subscription?.balance,
      subscription?.data?.balance,
    ];
    let limitUsd: number | null = null;
    for (const c of subLimitCandidates) {
      const n = toNumberOrNull(c);
      if (n !== null) {
        limitUsd = n;
        break;
      }
    }

    const usageCandidates = [
      usage?.total_usage,
      usage?.used,
      usage?.data?.total_usage,
      usage?.data?.used,
      usage?.result?.total_usage,
    ];
    let usedRaw: number | null = null;
    for (const c of usageCandidates) {
      const n = toNumberOrNull(c);
      if (n !== null) {
        usedRaw = n;
        break;
      }
    }

    if (limitUsd !== null && usedRaw !== null) {
      const usedUsd = normalizeUsageToUsd(usedRaw, limitUsd);
      return {
        amount: Math.max(limitUsd - usedUsd, 0),
        currency: subscription?.currency || subscription?.data?.currency || "USD",
        endpointUsed: "/v1/dashboard/billing/subscription + /v1/dashboard/billing/usage",
      };
    }
    // 如果 subscription 已经带余额，直接返回。
    const parsedSub = parseBalancePayload(subscription);
    if (parsedSub.amount !== null) {
      return {
        amount: parsedSub.amount,
        currency: parsedSub.currency || "USD",
        endpointUsed: "/v1/dashboard/billing/subscription",
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/鉴权失败/.test(msg)) throw e;
  }

  const candidates = [
    "/v1/dashboard/billing/credit_grants",
    "/dashboard/billing/credit_grants",
    "/v1/billing/credit_grants",
    "/v1/billing/balance",
    "/v1/user/balance",
    "/v1/dashboard/billing/subscription",
    "/v1/dashboard/billing/usage",
  ];

  let lastErr = "";
  for (const path of candidates) {
    try {
      const json = await requestJson(path);
      const parsed = parseBalancePayload(json);
      return {
        amount: parsed.amount,
        currency: parsed.currency,
        endpointUsed: path,
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (String(lastErr).startsWith("not_supported:")) continue;
      if (/鉴权失败/.test(lastErr)) throw e;
    }
  }

  throw new Error(lastErr ? `余额接口暂不可用：${lastErr}` : "余额接口暂不可用");
};

const geminiImageViaChat = async (
  req: 创建图片请求,
  cfg: ApiConfig,
  model: string,
  signal?: AbortSignal
): Promise<图片生成响应> => {
  const n = Math.min(Math.max(req.n ?? 1, 1), 10);
  const responseFormat = req.response_format ?? ResponseFormat.Url;
  const created = Math.floor(Date.now() / 1000);
  const size = req.size ?? Size.The1024X1024;

  const data: 图片对象[] = [];
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    const hasImages = Array.isArray(req.image) && req.image.length > 0;
    const content = hasImages
      ? [
          { type: "text", text: req.prompt },
          ...req.image!.map((img) => ({
            type: "image_url",
            image_url: { url: toImageUrlForChat(img) },
          })),
        ]
      : req.prompt;

    const resp = await fetch(`${cfg.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(cfg),
      },
      body: JSON.stringify({
        model,
        // Some gateways may accept `size` for image models even on chat endpoint.
        // If not supported, it will be ignored.
        size,
        messages: [{ role: "user", content }],
      }),
      signal,
    });

    const text = await resp.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // keep null
    }

    if (!resp.ok) {
      const msg = json?.error?.message || text;
      throw new Error(`对话接口出图失败：HTTP ${resp.status} ${msg}`.trim());
    }

    const out = json?.choices?.[0]?.message?.content;
    if (typeof out !== "string") throw new Error("对话接口返回格式异常（message.content 不是字符串）。");

    // Gateway returns markdown with embedded data url: ![image](data:image/png;base64,....)
    const mdMatch = /!\[image\]\(([^)]+)\)/i.exec(out);
    const dataUrlMatch = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/.exec(out);
    const url = (mdMatch?.[1] || dataUrlMatch?.[0] || "").trim();
    if (!url) throw new Error("对话接口输出中未找到图片（data url）。");

    if (responseFormat === ResponseFormat.B64json) {
      if (!url.startsWith("data:image/")) {
        throw new Error("当 response_format=b64_json 时，期望拿到 data url 图片。");
      }
      data.push({ b64_json: extractBase64(url), revised_prompt: req.prompt });
    } else {
      data.push({ url, revised_prompt: req.prompt });
    }
  }

  return {
    created,
    data,
    model_used: model,
    endpoint_used: "/v1/chat/completions",
  };
};

/**
 * OpenAI-style: POST /v1/images/generations
 * Returns { created, data: [{ url | b64_json, revised_prompt? }, ...] }
 */
export const imagesGenerations = async (
  req: 创建图片请求,
  opts?: ClientRequestOptions
): Promise<图片生成响应> => {
  const cfg = getClientConfig(opts?.api);
  const signal = opts?.signal;

  const callWithModel = async (model: string): Promise<图片生成响应> => {
    if (/^sora-/i.test(model)) {
      throw new Error(
        `当前模型「${model}」是视频模型，不支持图片生成。请在左侧栏「接口」里切换到图片模型（例如 gemini-2.5-flash-image 或 gpt-image-1.5）。`
      );
    }

    if (isGeminiImageModel(model)) {
      // 该网关对 Gemini 图片模型常走 /v1/chat/completions。
      return geminiImageViaChat({ ...req, model: model as Model }, cfg, model, signal);
    }

    const body: Record<string, any> = {
      prompt: req.prompt,
      model,
      n: req.n ?? 1,
      response_format: req.response_format ?? ResponseFormat.Url,
      size: req.size ?? Size.The1024X1024,
    };

    if (req.image?.length) {
      body.image = req.image.map(normalizeImageInput);
    }

    // Pass-through for extra fields (future-proofing)
    for (const [k, v] of Object.entries(req)) {
      if (k in body) continue;
      if (k === "image" || k === "prompt" || k === "model" || k === "n" || k === "response_format" || k === "size")
        continue;
      body[k] = v;
    }

    let resp: Response;
    try {
      resp = await fetch(`${cfg.baseUrl}/v1/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(cfg),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : String(e);
      throw new Error(
        `图片接口网络错误：${msg}。` +
          `如果在浏览器开发环境出现，多半是 CORS。建议使用 /api 代理或让 ${cfg.baseUrl} 开启 CORS。`
      );
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`图片接口请求失败：HTTP ${resp.status} ${text}`.trim());
    }

    const json = (await resp.json()) as 图片生成响应;
    if (!json || typeof json.created !== "number" || !Array.isArray(json.data)) {
      throw new Error("图片接口返回结构异常。");
    }
    return {
      ...json,
      model_used: model,
      endpoint_used: "/v1/images/generations",
    };
  };

  const initialModel = (req.model ?? cfg.defaultImageModel).trim();
  try {
    return await callWithModel(initialModel);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!includesUnsupportedModelError(msg)) throw e;

    // 自动兜底：当网关返回“模型不支持生图”时，尝试从 /v1/models 里选一个图片模型。
    try {
      const models = await listModels({ api: cfg, signal });
      const fallback = chooseFallbackModel(initialModel, models);
      if (!fallback) {
        throw new Error(
          `模型「${initialModel}」不支持生图，且未找到可用备选模型。请在左侧「接口」中手动切换模型。`
        );
      }
      const fallbackResp = await callWithModel(fallback);
      return fallbackResp;
    } catch (fallbackError) {
      const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`当前模型不可用（${initialModel}）。自动切换失败：${fallbackMsg}`);
    }
  }
};

export interface 图片编辑请求 {
  image: string[]; // data url / url / raw base64
  prompt: string;
  mask?: string; // data url / url / raw base64
  model?: string;
  n?: number | null;
  size?: string;
  response_format?: ResponseFormat;
  quality?: string;
  [property: string]: any;
}

const base64ToBlob = (b64: string, mimeType: string): Blob => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
};

const inputToBlob = async (
  input: string,
  signal?: AbortSignal
): Promise<{ blob: Blob; mimeType: string; filename: string }> => {
  if (isDataUrl(input)) {
    const m = /^data:([^;]+);base64,(.*)$/i.exec(input);
    const mimeType = m?.[1] || "image/png";
    const b64 = m?.[2] || "";
    const blob = base64ToBlob(b64, mimeType);
    const ext = mimeType.includes("png") ? "png" : mimeType.includes("jpeg") ? "jpg" : "bin";
    return { blob, mimeType, filename: `upload.${ext}` };
  }

  if (isHttpUrl(input)) {
    const resp = await fetch(input, { signal });
    if (!resp.ok) throw new Error(`拉取图片失败：HTTP ${resp.status}`);
    const mimeType = resp.headers.get("content-type") || "application/octet-stream";
    const blob = await resp.blob();
    const ext = mimeType.includes("png") ? "png" : mimeType.includes("jpeg") ? "jpg" : "bin";
    return { blob, mimeType, filename: `remote.${ext}` };
  }

  // raw base64
  const mimeType = guessMimeTypeFromB64(input);
  const blob = base64ToBlob(input, mimeType);
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("jpeg") ? "jpg" : "bin";
  return { blob, mimeType, filename: `b64.${ext}` };
};

/**
 * OpenAI-style: POST /v1/images/edits (multipart/form-data)
 */
export const imagesEdits = async (
  req: 图片编辑请求,
  opts?: ClientRequestOptions
): Promise<图片生成响应> => {
  const cfg = getClientConfig(opts?.api);
  const signal = opts?.signal;

  const fd = new FormData();

  if (!Array.isArray(req.image) || req.image.length === 0) {
    throw new Error("images/edits 需要至少 1 张 image。");
  }

  for (let i = 0; i < req.image.length; i++) {
    const { blob, filename } = await inputToBlob(req.image[i], signal);
    fd.append("image", blob, filename.replace("upload", `image_${i}`));
  }

  if (req.mask) {
    const { blob, filename } = await inputToBlob(req.mask, signal);
    fd.append("mask", blob, filename.replace("upload", "mask"));
  }

  fd.append("prompt", req.prompt);
  fd.append("n", String(req.n ?? 1));
  if (req.size) fd.append("size", String(req.size));
  if (req.response_format) fd.append("response_format", String(req.response_format));
  if (req.model) fd.append("model", String(req.model));
  if (req.quality) fd.append("quality", String(req.quality));

  // Pass-through for extra fields
  for (const [k, v] of Object.entries(req)) {
    if (k === "image" || k === "mask" || k === "prompt" || k === "n" || k === "size" || k === "response_format" || k === "model" || k === "quality")
      continue;
    if (v === undefined || v === null) continue;
    fd.append(k, String(v));
  }

  const resp = await fetch(`${cfg.baseUrl}/v1/images/edits`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(cfg),
    },
    body: fd,
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`图片编辑请求失败：HTTP ${resp.status} ${text}`.trim());
  }

  const json = (await resp.json()) as 图片生成响应;
  if (!json || typeof json.created !== "number" || !Array.isArray(json.data)) {
    throw new Error("图片编辑接口返回结构异常。");
  }
  return {
    ...json,
    model_used: req.model,
    endpoint_used: "/v1/images/edits",
  };
};
