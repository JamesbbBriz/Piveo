import { ImageResponseFormat, Message, SessionSettings, ProductScale, ReferenceIntent } from "../types";
import { imageObjToDataUrl, imagesGenerations, ResponseFormat } from "./openaiImages";
import { getSupportedSizeForAspect } from "./sizeUtils";
import { getEffectiveApiConfig } from "./apiConfig";
import { urlToDataUrl } from "./imageData";

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
      response_format: ResponseFormat.B64json,
    },
    { signal: opts?.signal, queueSource: "model-gen" }
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
  queueSource?: "chat" | "batch" | "mask-edit" | "model-gen";
  /** 参考图意图（仅当 referenceImage 存在时生效） */
  referenceIntent?: ReferenceIntent;
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

/** 如果是 blob URL（/api/data/blobs/...），fetch 并转为 data URL；data URL 和 http URL 保持不变 */
const ensureDataUrl = async (imageUrl: string | null): Promise<string | null> => {
  if (!imageUrl) return null;
  if (/^data:/i.test(imageUrl)) return imageUrl; // 已经是 data URL
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl; // 远程 URL，网关可直接访问
  // 相对路径（如 /api/data/blobs/xxx）→ 需要 fetch 转为 data URL
  try {
    return await urlToDataUrl(imageUrl);
  } catch (e) {
    console.warn("[images] 转换 blob URL 为 data URL 失败:", imageUrl, e);
    return imageUrl;
  }
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

  const extraImagesRaw = Array.isArray(options.extraImages)
    ? options.extraImages.map((img) => String(img || "").trim()).filter(Boolean)
    : [];

  // 确保所有图片都是可发送格式（blob URL → data URL）
  const [resolvedRef, resolvedHistory, resolvedProduct, resolvedModel, ...resolvedExtras] =
    await Promise.all([
      ensureDataUrl(referenceImage),
      ensureDataUrl(lastHistoryImage),
      ensureDataUrl(productImage),
      ensureDataUrl(modelImage),
      ...extraImagesRaw.map((img) => ensureDataUrl(img)),
    ]);
  referenceImage = resolvedRef;
  lastHistoryImage = resolvedHistory;
  productImage = resolvedProduct;
  modelImage = resolvedModel;
  const extraImages = resolvedExtras.filter((s): s is string => Boolean(s));

  // 参考图意图决定产品图是否共存：
  // - intent=product 或 intent=all：参考图替代产品图（用户贴的就是产品）
  // - intent=style 或 intent=composition：参考图只做风格/构图参考，产品图保留
  // 套图模式通过 forceIncludeProductImage 绕过聊天模式的排除逻辑。
  const refIntent = options.referenceIntent ?? 'all';
  const refExcludesProduct = refIntent === 'product' || refIntent === 'all';
  const includeProductImage = Boolean(productImage) && (
    options.forceIncludeProductImage || (
      referenceImage ? !refExcludesProduct : !lastHistoryImage
    )
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
    scaleInstruction = "产品尺寸要小而精致，线条纤细，细节轻盈，相对于标准版本显著缩小。";
  } else if (settings.productScale === ProductScale.Large) {
    scaleInstruction = "让产品更显眼、更突出。";
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
    scaleInstruction += " 用户明确要求更小更细，请显著降低产品的体积与线条粗细。";
  }

  try {
    // 这里不再拼接聊天历史文本，避免旧上下文干扰和额外时延。
    // 连续编辑的一致性仍通过图片输入（product/model/reference/last image）保证。

    // 按图片输入位置声明角色，帮助模型明确每张图的职责。
    // 图片顺序：referenceImage/lastHistoryImage → productImage → modelImage
    // 铁律：有模特图时，人物特征锁定模特图，其他图中的人物一律忽略。
    const MODEL_LOCK = "人物的面部特征、肤色、身材、发型全部以模特参考图为准，忽略其他图片中可能出现的人物外观。";
    let imageContext = "";

    if (referenceImage && includeProductImage && modelImage) {
      // 三图共存（intent=style/composition 时参考图+产品图+模特图）
      const refRole = refIntent === 'style'
        ? "图片1是风格参考——请参考其色调、光影和整体氛围，不要参考其中的具体商品或人物外观"
        : "图片1是构图参考——请参考其拍摄角度、人物姿态和画面布局，不要参考其中的具体商品外观";
      imageContext = `${refRole}。图片2是产品参考图——仅参考商品外观（款式/颜色/材质），忽略图中可能出现的人物。图片3是模特参考图——${MODEL_LOCK}`;
    } else if (referenceImage && modelImage) {
      // 参考图+模特图（intent=product/all 时参考图替代产品图）
      const refRole = refIntent === 'product'
        ? "图片1是产品参考——请严格还原其中商品的款式、颜色和材质细节，忽略图中可能出现的人物"
        : "图片1是参考图——请参考其中的商品外观、风格氛围和构图布局，但不参考其中的人物外观";
      imageContext = `${refRole}。图片2是模特参考图——${MODEL_LOCK}`;
    } else if (referenceImage && includeProductImage) {
      // 参考图+产品图，无模特
      const refRole = refIntent === 'style'
        ? "图片1是风格参考——请参考其色调、光影和整体氛围"
        : "图片1是构图参考——请参考其拍摄角度和画面布局";
      imageContext = `${refRole}。图片2是产品参考图——请严格还原其中商品的外观、颜色、材质与细节。`;
    } else if (referenceImage) {
      // 仅参考图，无模特无产品
      imageContext = refIntent === 'style'
        ? "图片1是风格参考——请参考其色调、光影和整体氛围。"
        : refIntent === 'composition'
        ? "图片1是构图参考——请参考其拍摄角度、人物姿态和画面布局。"
        : refIntent === 'product'
        ? "图片1是产品参考——请严格还原其中商品的款式、颜色和材质细节。"
        : "图片1是参考图——请参考其中的所有元素，包括商品、人物、风格和构图。";
    } else if (includeProductImage && modelImage) {
      // 产品图+模特图（无参考图）
      imageContext = `图片1是产品参考图——仅参考商品外观（款式/颜色/材质），忽略图中可能出现的人物。图片2是模特参考图——${MODEL_LOCK}`;
    } else if (includeProductImage) {
      // 仅产品图
      imageContext = "图片1是产品参考图。请严格还原图片1中产品的外观、颜色、材质与细节，保持完全不变。模特或人物由你自行创建，产品为视觉主体。";
    } else if ((lastHistoryImage) && modelImage) {
      // 连续编辑图+模特图
      imageContext = `图片1是当前编辑参考图，对图片1进行修改。图片2是模特参考图——${MODEL_LOCK}`;
    } else if (modelImage) {
      // 仅模特图
      imageContext = "图片1是模特参考图。请保持图片1中人物的面部特征与身份特征完全不变。";
    }

    const n = Math.min(Math.max(options.n ?? 1, 1), 10);
    const responseFormat = options.responseFormat ?? settings.responseFormat ?? "url";
    const currentModel = getEffectiveApiConfig().defaultImageModel;
    const sizeUsed = options.size ?? aspectRatioToSize(settings.aspectRatio, currentModel);
    const productContext = productInfoInstruction ? `\n${productInfoInstruction}` : "";
    const contextPrefix = imageContext ? `${imageContext}\n` : "";
    const promptUsed = `${contextPrefix}${productContext}${finalPrompt} ${scaleInstruction}`.trim();

    const resp = await imagesGenerations(
      {
        prompt: promptUsed,
        systemPrompt: settings.systemPrompt?.trim() || undefined,
        n,
        response_format: rfToEnum(responseFormat),
        size: sizeUsed,
        image: imageInputs.length ? imageInputs : undefined,
      },
      { signal: options.signal, queueSource: options.queueSource || "chat" }
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
