/**
 * Gemini Native API Adapter
 *
 * Translates OpenAI-format requests into Google Gemini generateContent calls
 * and converts responses back to OpenAI format. Activated only when the active
 * provider has type === "gemini-native"; otherwise falls through to the
 * existing http-proxy-middleware.
 */

import { normalizeModelId } from "../services/providerStore.mjs";

const LOG = "[GEMINI-ADAPTER]";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Guess MIME type from the first bytes of a base64 string. */
function guessMimeFromBase64(b64) {
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/png"; // safe default
}

/** Parse a data-URL into { mimeType, data }. */
function parseDataUrl(url) {
  const m = url.match(/^data:([^;]+);base64,(.+)$/s);
  if (m) return { mimeType: m[1], data: m[2] };
  return null;
}

/** Derive aspect ratio string from "WxH" size. */
function sizeToAspectRatio(size) {
  if (!size || typeof size !== "string") return undefined;
  const m = size.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return undefined;

  const ratio = w / h;
  // Match to nearest standard ratio
  const known = [
    { r: 1, label: "1:1" },
    { r: 16 / 9, label: "16:9" },
    { r: 9 / 16, label: "9:16" },
    { r: 4 / 3, label: "4:3" },
    { r: 3 / 4, label: "3:4" },
    { r: 3 / 2, label: "3:2" },
    { r: 2 / 3, label: "2:3" },
    { r: 4 / 5, label: "4:5" },
    { r: 5 / 4, label: "5:4" },
    { r: 21 / 9, label: "21:9" },
  ];

  let best = known[0];
  let bestDist = Math.abs(ratio - best.r);
  for (const k of known) {
    const d = Math.abs(ratio - k.r);
    if (d < bestDist) {
      best = k;
      bestDist = d;
    }
  }
  return best.label;
}

/** Generate a pseudo chat-completion id. */
function chatId() {
  const hex = Math.random().toString(16).slice(2, 10);
  return `chatcmpl-gemini-${hex}`;
}

// ---------------------------------------------------------------------------
// OpenAI → Gemini request conversion
// ---------------------------------------------------------------------------

/**
 * Convert OpenAI chat/completions messages array to Gemini contents array.
 * System messages are prepended to the first user message.
 */
function convertMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  // Collect system texts to prepend
  const systemTexts = [];
  const nonSystem = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      const txt =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n")
            : "";
      if (txt) systemTexts.push(txt);
    } else {
      nonSystem.push(msg);
    }
  }

  const contents = [];

  for (let i = 0; i < nonSystem.length; i++) {
    const msg = nonSystem[i];
    const role = msg.role === "assistant" ? "model" : "user";
    const parts = [];

    // Prepend system prompt to the first user message
    if (i === 0 && role === "user" && systemTexts.length > 0) {
      parts.push({ text: systemTexts.join("\n\n") + "\n\n" });
    }

    if (typeof msg.content === "string") {
      // If we already added system text as a separate part, merge with it
      if (parts.length > 0 && msg.content) {
        parts[parts.length - 1].text += msg.content;
      } else if (msg.content) {
        parts.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          // Merge text into existing system-text part if this is the first one
          if (parts.length > 0 && parts[parts.length - 1].text !== undefined && parts[parts.length - 1] === parts[0] && i === 0 && systemTexts.length > 0) {
            parts[0].text += part.text;
          } else {
            parts.push({ text: part.text });
          }
        } else if (part.type === "_thought_signature" && part.thought_signature) {
          parts.push({ thought: true, thoughtSignature: part.thought_signature });
        } else if (part.type === "image_url" && part.image_url?.url) {
          const parsed = parseDataUrl(part.image_url.url);
          if (parsed) {
            parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
          }
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  // Gemini requires alternating user/model. Merge consecutive same-role entries.
  const merged = [];
  for (const c of contents) {
    if (merged.length > 0 && merged[merged.length - 1].role === c.role) {
      merged[merged.length - 1].parts.push(...c.parts);
    } else {
      merged.push(c);
    }
  }

  return merged;
}

/**
 * Build Gemini request body for /v1/chat/completions.
 */
function buildChatCompletionsBody(body) {
  const contents = convertMessages(body.messages || []);

  const generationConfig = {
    responseModalities: ["TEXT", "IMAGE"],
  };

  // Aspect ratio: prefer extra_body.google.image_config.aspect_ratio, fallback to size
  const explicitAr = body.extra_body?.google?.image_config?.aspect_ratio;
  if (explicitAr) {
    generationConfig.imageConfig = { aspectRatio: explicitAr };
  } else if (body.size) {
    const ar = sizeToAspectRatio(body.size);
    if (ar) generationConfig.imageConfig = { aspectRatio: ar };
  }

  return { contents, generationConfig };
}

/**
 * Build Gemini request body for /v1/images/generations.
 */
function buildImageGenerationsBody(body) {
  const parts = [];

  // Text prompt
  const promptText = [body.systemPrompt, body.prompt].filter(Boolean).join("\n\n");
  if (promptText) {
    parts.push({ text: promptText });
  }

  // Reference images
  if (Array.isArray(body.image)) {
    for (const img of body.image) {
      if (typeof img === "string" && img.length > 0) {
        const parsed = parseDataUrl(img);
        if (parsed) {
          parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
        } else {
          // Raw base64 without data-url prefix
          const mime = guessMimeFromBase64(img);
          parts.push({ inlineData: { mimeType: mime, data: img } });
        }
      }
    }
  }

  const contents = [{ role: "user", parts }];

  const generationConfig = {
    responseModalities: ["TEXT", "IMAGE"],
  };

  if (body.size) {
    const ar = sizeToAspectRatio(body.size);
    if (ar) generationConfig.imageConfig = { aspectRatio: ar };
  }

  return { contents, generationConfig };
}

// ---------------------------------------------------------------------------
// Gemini → OpenAI response conversion
// ---------------------------------------------------------------------------

/**
 * Extract useful parts from Gemini response (filter out thought parts).
 */
function extractParts(geminiResp) {
  const candidate = geminiResp?.candidates?.[0];
  if (!candidate?.content?.parts) return [];
  return candidate.content.parts.filter((p) => !p.thought);
}

/**
 * Convert Gemini response to OpenAI chat/completions format.
 * Preserves thought signatures for multi-turn continuity.
 */
function toChatCompletionResponse(geminiResp) {
  const candidate = geminiResp?.candidates?.[0];
  const allParts = candidate?.content?.parts || [];

  const contentParts = [];
  for (const p of allParts) {
    if (p.thought) {
      // Include thought signature for multi-turn continuity (not displayed)
      if (p.thoughtSignature) {
        contentParts.push({
          type: "_thought_signature",
          thought_signature: p.thoughtSignature,
        });
      }
      continue;
    }
    if (p.text !== undefined) {
      contentParts.push({ type: "text", text: p.text });
    } else if (p.inlineData) {
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,
        },
      });
    }
  }

  const usage = geminiResp?.usageMetadata;

  return {
    id: chatId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: contentParts,
        },
        finish_reason: "stop",
      },
    ],
    usage: usage
      ? {
          prompt_tokens: usage.promptTokenCount || 0,
          completion_tokens: usage.candidatesTokenCount || 0,
          total_tokens: usage.totalTokenCount || 0,
        }
      : undefined,
  };
}

/**
 * Convert Gemini response to OpenAI images/generations format.
 */
function toImageGenerationsResponse(geminiResp) {
  const parts = extractParts(geminiResp);

  const data = [];
  let revisedPrompt = undefined;

  for (const p of parts) {
    if (p.inlineData) {
      data.push({
        b64_json: p.inlineData.data,
        revised_prompt: revisedPrompt,
      });
    } else if (p.text) {
      revisedPrompt = p.text;
    }
  }

  return {
    created: Math.floor(Date.now() / 1000),
    data,
  };
}

// ---------------------------------------------------------------------------
// Gemini API call
// ---------------------------------------------------------------------------

async function callGemini(config, model, geminiBody) {
  const token = config.authorization.replace(/^Bearer\s+/i, "").trim();
  const base = config.baseUrl.replace(/\/+$/, "");
  const url = `${base}/v1beta/models/${model}:generateContent?key=${token}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geminiBody),
    signal: AbortSignal.timeout(model.includes("pro") ? 180_000 : 90_000),
  });

  const responseBody = await resp.json();

  if (!resp.ok) {
    const errMsg =
      responseBody?.error?.message ||
      responseBody?.error?.status ||
      `HTTP ${resp.status}`;
    const err = new Error(errMsg);
    err.status = resp.status;
    err.body = responseBody;
    throw err;
  }

  // Check for blocked / empty candidates
  if (
    !responseBody.candidates ||
    responseBody.candidates.length === 0
  ) {
    const blockReason =
      responseBody.promptFeedback?.blockReason || "UNKNOWN";
    const err = new Error(
      `Gemini returned no candidates (blockReason: ${blockReason})`
    );
    err.status = 400;
    err.body = responseBody;
    throw err;
  }

  return responseBody;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleChatCompletions(req, res, config, body) {
  let model = body.model || "gemini-2.5-flash-image";
  model = model.replace(/-2k$/i, "");
  const geminiBody = buildChatCompletionsBody(body);

  console.info(`${LOG} ${req.requestId || "-"} chat/completions model=${model}`);

  const geminiResp = await callGemini(config, model, geminiBody);
  const openaiResp = toChatCompletionResponse(geminiResp);

  return res.json(openaiResp);
}

async function handleImageGenerations(req, res, config, body) {
  let model = body.model || "gemini-2.5-flash-image";
  model = model.replace(/-2k$/i, "");
  const n = Math.max(1, Number(body.n) || 1);

  console.info(
    `${LOG} ${req.requestId || "-"} images/generations model=${model} n=${n}`
  );

  const geminiBody = buildImageGenerationsBody(body);

  if (n === 1) {
    const geminiResp = await callGemini(config, model, geminiBody);
    const openaiResp = toImageGenerationsResponse(geminiResp);
    return res.json(openaiResp);
  }

  // n > 1: make parallel requests
  const results = await Promise.allSettled(
    Array.from({ length: n }, () => callGemini(config, model, geminiBody))
  );

  const allData = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      const partial = toImageGenerationsResponse(r.value);
      allData.push(...partial.data);
    } else {
      console.error(`${LOG} one of n=${n} requests failed: ${r.reason?.message}`);
    }
  }

  if (allData.length === 0) {
    // All failed — throw the first error
    const firstErr = results.find((r) => r.status === "rejected")?.reason;
    throw firstErr || new Error("All parallel requests failed");
  }

  return res.json({
    created: Math.floor(Date.now() / 1000),
    data: allData,
  });
}

function handleModels(_req, res) {
  return res.json({
    object: "list",
    data: [
      { id: "gemini-2.5-flash-image", object: "model" },
      { id: "gemini-3-pro-image-preview", object: "model" },
      { id: "gemini-3-pro-image-preview-2k", object: "model" },
    ],
  });
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create the Gemini native adapter middleware.
 *
 * @param {() => {baseUrl: string, authorization: string, type: string}} getUpstreamConfig
 * @param {{ recordUsage?: Function, isSuperAdmin?: Function }} opts
 */
export function createGeminiNativeHandler(getUpstreamConfig, { recordUsage, isSuperAdmin } = {}) {
  return async (req, res, next) => {
    // First check with X-Route-Model header for quick type check
    const routeModel = req._routeModel;
    const headerConfig = getUpstreamConfig(routeModel);

    // Not gemini-native — pass through to proxy middleware
    if (headerConfig.type !== "gemini-native") {
      return next();
    }

    // Manually read request body (don't consume it via express.json)
    let body = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bodyStr = Buffer.concat(chunks).toString("utf-8");
      body = bodyStr ? JSON.parse(bodyStr) : {};
    } catch (parseErr) {
      console.error(`${LOG} body parse error: ${parseErr.message}`);
      return res.status(400).json({
        error: {
          message: "Invalid JSON body",
          type: "invalid_request_error",
          code: "invalid_json",
        },
      });
    }

    // Re-resolve config using body.model for more precise routing
    const bodyModel = body.model || routeModel;
    const config = getUpstreamConfig(bodyModel);

    // After body parse, if the final config is not gemini-native, fall through
    if (config.type !== "gemini-native") {
      return next();
    }

    try {
      // Route dispatch (path has /api stripped by Express mount)
      const p = req.path;

      if (p === "/v1/chat/completions") {
        await handleChatCompletions(req, res, config, body);
      } else if (p === "/v1/images/generations") {
        await handleImageGenerations(req, res, config, body);
      } else if (p === "/v1/models") {
        handleModels(req, res);
      } else {
        return res.status(501).json({
          error: {
            message: `Gemini adapter does not support ${p}`,
            type: "invalid_request_error",
            code: "unsupported_route",
          },
        });
      }

      // Record usage after successful response
      if (
        req._quotaUserId &&
        recordUsage &&
        (req.path === "/v1/images/generations" ||
          req.path === "/v1/images/edits" ||
          req.path === "/v1/chat/completions")
      ) {
        try {
          recordUsage({
            userId: req._quotaUserId,
            username: String(req.authUser || ""),
            endpoint: req.path,
            model: normalizeModelId(body.model) || null,
            statusCode: res.statusCode || 200,
            requestId: req.requestId || "",
          });
        } catch (e) {
          console.error(`${LOG} usage record error: ${e.message}`);
        }
      }
    } catch (err) {
      const status = err.status || 502;
      const requestId = req.requestId || "";
      console.error(
        `${LOG} ${requestId || "-"} error: ${err.message}`
      );

      // Record failed usage too
      if (req._quotaUserId && recordUsage) {
        try {
          recordUsage({
            userId: req._quotaUserId,
            username: String(req.authUser || ""),
            endpoint: req.path,
            model: normalizeModelId(body.model) || null,
            statusCode: status,
            requestId: requestId || "",
          });
        } catch (_) {}
      }

      if (res.headersSent) return;

      // Map Gemini errors to OpenAI-style errors
      return res.status(status).json({
        error: {
          message: err.message || "Upstream Gemini error",
          type:
            status === 400
              ? "invalid_request_error"
              : status === 429
                ? "rate_limit_error"
                : "api_error",
          code: err.body?.error?.status || `gemini_${status}`,
        },
      });
    }
  };
}
