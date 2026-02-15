import { ImageResponseFormat, Message, SessionSettings, ProductScale } from "../types";
import { imageObjToDataUrl, imagesGenerations, ResponseFormat } from "./openaiImages";
import { getSupportedSizeForAspect } from "./sizeUtils";
import { getEffectiveApiConfig } from "./apiConfig";

const aspectRatioToSize = (aspectRatio: string, model?: string): string => {
  return getSupportedSizeForAspect(aspectRatio, model);
};

export const enhancePrompt = async (originalPrompt: string): Promise<string> => {
  const base = originalPrompt.trim();
  if (!base) return "";

  const additions: string[] = [];
  if (!/(高清|高分辨率|细节|清晰|8k|4k|high[-\s]?detail|sharp)/i.test(base)) {
    additions.push("画面清晰、细节锐利、边缘干净无噪点。");
  }
  if (!/(棚拍|光线|光效|打光|studio|lighting)/i.test(base)) {
    additions.push("使用柔和但有层次的棚拍光线，主体曝光准确。");
  }
  if (!/(构图|景深|背景|composition|depth of field)/i.test(base)) {
    additions.push("构图简洁，主体突出，背景不过度抢视觉。");
  }

  if (!additions.length) return base;
  return `${base}\n\n补充要求：${additions.join(" ")}`;
};

export const generateModelCharacter = async (
  opts?: { signal?: AbortSignal; description?: string }
): Promise<string> => {
  const desc = opts?.description?.trim();
  const prompt = desc
    ? `生成一张高端时尚人像写真：${desc}。中性背景、清晰对焦、8K 质感、面部特征稳定一致。`
    : "生成一张高端时尚人像写真：中性背景、清晰对焦、8K 质感、面部特征稳定一致。";

  const resp = await imagesGenerations(
    {
      prompt,
      model: "gemini-2.5-flash-image" as any,
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
  disableAutoUseLastImage?: boolean;
  signal?: AbortSignal;
  productInfo?: {
    name?: string;
    dimensions?: { width?: number; height?: number; depth?: number };
    size?: string;
    description?: string;
  };
  forceIncludeProductImage?: boolean;
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
  productImage: string | null, // Product image
  history: Message[],
  settings: SessionSettings,
  options: GenerateResponseOptions = {}
): Promise<GenerateResponseResult> => {

  // If user didn't provide a new image this turn, fall back to the most recent
  // image in the history for iterative edits.
  const lastMsg = history[history.length - 1];
  const hasNewImage = lastMsg?.parts?.some(p => p.type === 'image') ?? false;
  let lastHistoryImage: string | null = null;
  if (!options.disableAutoUseLastImage && settings.autoUseLastImage && !hasNewImage && !referenceImage) {
    for (let i = history.length - 2; i >= 0; i--) {
      const imgPart = history[i].parts.find(p => p.type === 'image' && p.imageUrl);
      if (imgPart?.imageUrl) {
        lastHistoryImage = imgPart.imageUrl;
        break;
      }
    }
  }

  const extraImages = Array.isArray(options.extraImages)
    ? options.extraImages.map((img) => String(img || "").trim()).filter(Boolean)
    : [];

  // 当存在"当前参考图/连续编辑图"时，产品图只做兜底，不再并行注入，
  // 避免产品图（尤其带人物的产品图）覆盖当前编辑语义。
  // 套图模式通过 forceIncludeProductImage 绕过聊天模式的排除逻辑。
  const includeProductImage = Boolean(productImage) && (
    options.forceIncludeProductImage || (!referenceImage && !lastHistoryImage)
  );

  const imageInputsRaw: string[] = [];
  if (referenceImage) imageInputsRaw.push(referenceImage);
  if (lastHistoryImage) imageInputsRaw.push(lastHistoryImage);
  if (includeProductImage && productImage) imageInputsRaw.push(productImage);
  if (modelImage) imageInputsRaw.push(modelImage);
  for (const img of extraImages) imageInputsRaw.push(img);

  // 网关要求同一次请求只用一种图片输入方式（URL 或 base64）。
  // 优先级：当前上传图 > 额外编辑图 > 历史连续编辑图 > 一致性模特图 > 产品图兜底。
  const uniqueInputs = Array.from(new Set(imageInputsRaw.map((s) => String(s || "").trim()).filter(Boolean)));
  const preferredMode: ImageInputMode | null = referenceImage
    ? detectImageInputMode(referenceImage)
    : extraImages.length > 0
      ? detectImageInputMode(extraImages[0])
      : lastHistoryImage
        ? detectImageInputMode(lastHistoryImage)
        : modelImage
          ? detectImageInputMode(modelImage)
          : (includeProductImage && productImage)
            ? detectImageInputMode(productImage)
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

  // --- PRODUCT INFO ---
  let productInfoInstruction = "";
  if (options.productInfo) {
    const pi = options.productInfo;
    const parts: string[] = [];
    if (pi.name) parts.push(`产品名称：${pi.name}`);
    if (pi.size) {
      parts.push(`产品实际尺寸：${pi.size}。请严格按照此尺寸比例渲染产品，确保产品与模特/场景的比例协调真实`);
    } else if (pi.dimensions) {
      const dims: string[] = [];
      if (pi.dimensions.width) dims.push(`宽${pi.dimensions.width}cm`);
      if (pi.dimensions.height) dims.push(`高${pi.dimensions.height}cm`);
      if (pi.dimensions.depth) dims.push(`深${pi.dimensions.depth}cm`);
      if (dims.length) {
        parts.push(`产品实际尺寸：${dims.join("×")}。请严格按照此尺寸比例渲染产品，确保产品与模特/场景的比例协调真实`);
      }
    }
    if (pi.description) parts.push(`产品特征：${pi.description}`);
    if (parts.length) productInfoInstruction = parts.join("。") + "。";
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
    // 这里不再拼接聊天历史文本，避免旧上下文干扰和额外时延。
    // 连续编辑的一致性仍通过图片输入（product/model/reference/last image）保证。
    const systemText = settings.systemPrompt?.trim()
      ? `系统指令：\n${settings.systemPrompt.trim()}\n\n`
      : "";
    let imageContext = "";
    if (includeProductImage && modelImage) {
      imageContext += "\n图片说明：提供了产品图和模特参考图。产品图是核心参考——请严格还原产品的外观、颜色、材质与细节。模特图仅用于人物外貌一致性参考。";
    } else if (includeProductImage) {
      imageContext += "\n图片说明：第一张是主要产品图，请重点参考产品本身的外观、颜色、材质与细节，无视图中的模特或人物。";
    }
    if (modelImage && !includeProductImage) {
      imageContext += "\n有模特图作为人物一致性参考，请保持人物特征稳定。";
    }
    const n = Math.min(Math.max(options.n ?? 1, 1), 10);
    const responseFormat = options.responseFormat ?? settings.responseFormat ?? "url";
    const currentModel = getEffectiveApiConfig().defaultImageModel;
    const sizeUsed = options.size ?? aspectRatioToSize(settings.aspectRatio, currentModel);
    const sizeInstruction = sizeUsed ? `\n\n尺寸要求：请生成 ${sizeUsed} 的图片。` : "";
    const productContext = productInfoInstruction ? `\n${productInfoInstruction}` : "";
    const promptUsed = `${systemText}${imageContext}${productContext}${finalPrompt} ${scaleInstruction}${sizeInstruction}`.trim();

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
