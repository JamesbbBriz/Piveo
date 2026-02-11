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

export const getSupportedSizeForAspect = (aspect: AspectRatio | string): string => {
  return GEMINI_FLASH_IMAGE_SIZE_BY_ASPECT[String(aspect)] || GEMINI_FLASH_IMAGE_SIZE_BY_ASPECT["1:1"];
};

export const isSupportedAspectRatio = (aspect: unknown): aspect is AspectRatio => {
  if (typeof aspect !== "string") return false;
  return aspect in GEMINI_FLASH_IMAGE_SIZE_BY_ASPECT;
};

export const isSizeCompatibleWithAspect = (size: string, aspect: AspectRatio | string): boolean => {
  return String(size || "").trim().toLowerCase() === getSupportedSizeForAspect(aspect).toLowerCase();
};

export const filterSizesByAspect = (sizes: string[], aspect: AspectRatio | string): string[] => {
  const allowed = getSupportedSizeForAspect(aspect).toLowerCase();
  const normalized = (sizes || []).map((s) => String(s || "").trim().toLowerCase()).filter(Boolean);
  return normalized.includes(allowed) ? [allowed] : [];
};

