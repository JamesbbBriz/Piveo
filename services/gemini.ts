import { ImageResponseFormat, Message, SessionSettings, ProductScale } from "../types";
import { imageObjToDataUrl, imagesGenerations, ResponseFormat } from "./openaiImages";
import { getSupportedSizeForAspect } from "./sizeUtils";

const aspectRatioToSize = (aspectRatio: string): string => {
  return getSupportedSizeForAspect(aspectRatio);
};

export const enhancePrompt = async (originalPrompt: string): Promise<string> => {
  // Keep "enhance" as a safe local no-op so the app doesn't require a separate text model.
  return originalPrompt.trim();
};

export const generateModelCharacter = async (opts?: { signal?: AbortSignal }): Promise<string> => {
  const resp = await imagesGenerations(
    {
    prompt:
      "生成一张高端时尚人像写真：中性背景、清晰对焦、8K 质感、面部特征稳定一致。",
    n: 1,
    size: "1024x1024",
    response_format: ResponseFormat.Url,
    },
    { signal: opts?.signal }
  );

  const first = resp.data[0];
  const imageUrl = first ? imageObjToDataUrl(first) : null;
  if (!imageUrl) throw new Error("生成模特图片失败（响应中没有 url/b64_json）。");
  return imageUrl;
}

export interface GenerateResponseOptions {
  n?: number;
  size?: string;
  responseFormat?: ImageResponseFormat;
  extraImages?: string[];
  signal?: AbortSignal;
}

export interface GenerateResponseResult {
  text: string | null;
  images: string[];
  promptUsed: string;
  sizeUsed: string;
  responseFormat: ImageResponseFormat;
  modelUsed: string;
}

const rfToEnum = (rf: ImageResponseFormat): ResponseFormat => {
  return rf === "b64_json" ? ResponseFormat.B64json : ResponseFormat.Url;
};

type ImageInputMode = "url" | "b64";

const detectImageInputMode = (value: string): ImageInputMode => {
  const s = String(value || "").trim();
  if (/^https?:\/\//i.test(s)) return "url";
  return "b64";
};

export const generateResponse = async (
  currentMessageText: string,
  referenceImage: string | null, // Current upload
  modelImage: string | null, // Character consistency
  history: Message[],
  settings: SessionSettings,
  options: GenerateResponseOptions = {}
): Promise<GenerateResponseResult> => {
  const imageInputsRaw: string[] = [];
  if (modelImage) imageInputsRaw.push(modelImage);
  if (referenceImage) imageInputsRaw.push(referenceImage);
  if (Array.isArray(options.extraImages) && options.extraImages.length) {
    for (const img of options.extraImages) {
      if (typeof img === "string" && img.trim()) imageInputsRaw.push(img.trim());
    }
  }

  // If user didn't provide a new image this turn, fall back to the most recent
  // image in the history for iterative edits.
  const lastMsg = history[history.length - 1];
  const hasNewImage = lastMsg?.parts?.some(p => p.type === 'image') ?? false;
  let lastHistoryImage: string | null = null;
  if (settings.autoUseLastImage && !hasNewImage && !referenceImage) {
    for (let i = history.length - 2; i >= 0; i--) {
      const imgPart = history[i].parts.find(p => p.type === 'image' && p.imageUrl);
      if (imgPart?.imageUrl) {
        lastHistoryImage = imgPart.imageUrl;
        imageInputsRaw.push(imgPart.imageUrl);
        break;
      }
    }
  }

  // 网关要求同一次请求只用一种图片输入方式（URL 或 base64）。
  // 优先级：当前上传图 > 额外编辑图 > 历史连续编辑图 > 一致性模特图。
  const uniqueInputs = Array.from(new Set(imageInputsRaw.map((s) => String(s || "").trim()).filter(Boolean)));
  const preferredMode: ImageInputMode | null = referenceImage
    ? detectImageInputMode(referenceImage)
    : (options.extraImages && options.extraImages.length > 0)
      ? detectImageInputMode(options.extraImages[0])
      : lastHistoryImage
        ? detectImageInputMode(lastHistoryImage)
        : modelImage
          ? detectImageInputMode(modelImage)
          : null;

  const imageInputs =
    preferredMode === null
      ? uniqueInputs
      : uniqueInputs.filter((img) => detectImageInputMode(img) === preferredMode);

  if (preferredMode !== null && imageInputs.length !== uniqueInputs.length) {
    console.warn(
      `[images] 检测到混合图片输入（url + base64），已按 ${preferredMode} 模式过滤：${imageInputs.length}/${uniqueInputs.length}`
    );
  }

  // --- ENHANCED SCALE LOGIC ---
  let scaleInstruction = "";
  if (settings.productScale === ProductScale.Small) {
    scaleInstruction =
      "尺寸要求：产品（例如发圈/头绳）必须非常纤细、细薄、精致，呈现为细线而不是厚带。相对标准版本，显著变小、变细。";
  } else if (settings.productScale === ProductScale.Large) {
    scaleInstruction = "尺寸要求：让产品更显眼、更厚、更大。";
  }

  let finalPrompt = currentMessageText || "生成图片。";
  const lower = finalPrompt.toLowerCase();
  if (
    lower.includes("shrink") ||
    lower.includes("smaller") ||
    lower.includes("thinner") ||
    finalPrompt.includes("缩小") ||
    finalPrompt.includes("更小") ||
    finalPrompt.includes("更细") ||
    finalPrompt.includes("变细") ||
    finalPrompt.includes("变小")
  ) {
    scaleInstruction +=
      " 关键：用户明确要求更小、更细。如果是发圈/头绳，请渲染为非常细的弹性细线，而不是厚重的发圈或宽带；相较前一版显著降低厚度与直径。";
  }

  try {
    // Build a lightweight text context.
    const historyLimit = 6;
    const recentHistory = history.slice(-historyLimit);
    const contextLines = recentHistory
      .map(m => {
        const t = m.parts
          .filter(p => p.type === "text" && p.text)
          .map(p => p.text)
          .join(" ");
        if (!t) return "";
        return `${m.role === "user" ? "用户" : "助手"}：${t}`;
      })
      .filter(Boolean);

    const contextText = contextLines.length ? `上下文：\n${contextLines.join("\n")}\n\n` : "";
    const systemText = settings.systemPrompt?.trim()
      ? `系统指令：\n${settings.systemPrompt.trim()}\n\n`
      : "";
    const n = Math.min(Math.max(options.n ?? 1, 1), 10);
    const responseFormat = options.responseFormat ?? settings.responseFormat ?? "url";
    const sizeUsed = options.size ?? aspectRatioToSize(settings.aspectRatio);
    const sizeInstruction = sizeUsed ? `\n\n尺寸要求：请生成 ${sizeUsed} 的图片。` : "";
    const promptUsed = `${systemText}${contextText}${finalPrompt} ${scaleInstruction}${sizeInstruction}`.trim();

    const resp = await imagesGenerations(
      {
        prompt: promptUsed,
        n,
        response_format: rfToEnum(responseFormat),
        size: sizeUsed,
        image: imageInputs.length ? imageInputs : undefined,
      },
      { signal: options.signal }
    );

    const images = (resp.data || [])
      .map((o) => (o ? imageObjToDataUrl(o) : null))
      .filter((u): u is string => Boolean(u));

    return {
      text: null,
      images,
      promptUsed,
      sizeUsed,
      responseFormat,
      modelUsed: resp.model_used || "",
    };

  } catch (error) {
    console.error("Image API Error:", error);
    throw error;
  }
};
