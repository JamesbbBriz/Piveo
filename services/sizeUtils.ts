import { AspectRatio } from "../types";

// Gemini 2.5 Flash Image 支持的固定宽高比与分辨率映射。
export const GEMINI_FLASH_IMAGE_SIZE_BY_ASPECT: Record<string, string> = {
  "1:1": "1024x1024",
  "2:3": "832x1248",
  "3:2": "1248x832",
  "3:4": "864x1184",
  "4:3": "1184x864",
  "4:5": "896x1152",
  "5:4": "1152x896",
  "9:16": "768x1344",
  "16:9": "1344x768",
  "21:9": "1536x672",
};

// Gemini 3 Pro Image Preview 支持的 2K 分辨率映射。
export const GEMINI_PRO_IMAGE_2K_SIZE_BY_ASPECT: Record<string, string> = {
  "1:1": "2048x2048",
  "2:3": "1696x2528",
  "3:2": "2528x1696",
  "3:4": "1792x2400",
  "4:3": "2400x1792",
  "4:5": "1856x2304",
  "5:4": "2304x1856",
  "9:16": "1536x2752",
  "16:9": "2752x1536",
  "21:9": "3168x1344",
};

const SUPPORTED_ASPECT_RATIO_ORDER: AspectRatio[] = [
  AspectRatio.Square,
  AspectRatio.TwoByThree,
  AspectRatio.ThreeByTwo,
  AspectRatio.Portrait,
  AspectRatio.Landscape,
  AspectRatio.FourByFive,
  AspectRatio.FiveByFour,
  AspectRatio.Mobile,
  AspectRatio.Wide,
  AspectRatio.UltraWide,
];

export const getSupportedAspectRatios = (): AspectRatio[] => SUPPORTED_ASPECT_RATIO_ORDER;

export const getSupportedSizeForAspect = (aspect: AspectRatio | string, model?: string): string => {
  // 判断是否为 Gemini 3 Pro 模型
  const isGemini3Pro = model && /gemini-3-pro-image/i.test(model);

  // 根据模型选择对应的分辨率映射
  const sizeMap = isGemini3Pro ? GEMINI_PRO_IMAGE_2K_SIZE_BY_ASPECT : GEMINI_FLASH_IMAGE_SIZE_BY_ASPECT;

  return sizeMap[String(aspect)] || sizeMap["1:1"];
};

export const isSupportedAspectRatio = (aspect: unknown): aspect is AspectRatio => {
  if (typeof aspect !== "string") return false;
  return aspect in GEMINI_FLASH_IMAGE_SIZE_BY_ASPECT;
};

export const isSizeCompatibleWithAspect = (size: string, aspect: AspectRatio | string): boolean => {
  const s = String(size || "").trim().toLowerCase();
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(s);
  if (!m) return false;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;

  const a = String(aspect || "").trim();
  const am = /^(\d+)\s*:\s*(\d+)$/i.exec(a);
  if (!am) return false;
  const aw = Number(am[1]);
  const ah = Number(am[2]);
  if (!Number.isFinite(aw) || !Number.isFinite(ah) || aw <= 0 || ah <= 0) return false;

  const target = aw / ah;
  const actual = w / h;
  // 容差设为 0.025 以支持所有 1K 和 2K 分辨率（21:9 的 3168x1344 需要 ~0.024）
  return Math.abs(actual - target) <= 0.025;
};

export const filterSizesByAspect = (sizes: string[], aspect: AspectRatio | string): string[] => {
  const normalized = (sizes || [])
    .map((s) => String(s || "").trim().toLowerCase())
    .filter(Boolean);
  const unique = Array.from(new Set(normalized));
  return unique.filter((s) => isSizeCompatibleWithAspect(s, aspect));
};
