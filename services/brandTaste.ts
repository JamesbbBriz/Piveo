/**
 * Brand Taste Distillation Engine
 *
 * Analyzes on-brand vs off-brand rated images using Gemini multimodal
 * to distill a structured brand taste profile.
 */

import type { BrandKit, BrandTasteProfile, ImageRating } from '@/types';
import { imagesGenerations, imageObjToDataUrl, ResponseFormat } from './openaiImages';
import { urlToDataUrl } from './imageData';

const MAX_ON_BRAND = 8;
const MAX_OFF_BRAND = 4;
const MIN_RATINGS = 5;

export interface DistillResult {
  profile: BrandTasteProfile;
  onBrandCount: number;
  offBrandCount: number;
}

/**
 * Check if there are enough ratings to distill.
 * Requires at least MIN_RATINGS total, with at least 1 of each type.
 */
export function canDistill(ratings: ImageRating[]): { ready: boolean; message: string } {
  const onBrand = ratings.filter((r) => r.rating === 'on-brand');
  const offBrand = ratings.filter((r) => r.rating === 'off-brand');

  if (ratings.length < MIN_RATINGS) {
    return { ready: false, message: `还需 ${MIN_RATINGS - ratings.length} 张评价` };
  }
  if (onBrand.length === 0) {
    return { ready: false, message: '至少需要 1 张「符合品牌」' };
  }
  if (offBrand.length === 0) {
    return { ready: false, message: '至少需要 1 张「不符合品牌」' };
  }
  return { ready: true, message: '可以分析' };
}

/**
 * Ensure image URL is a data URL for API submission.
 */
async function resolveImageUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (/^data:/i.test(url)) return url;
  try {
    return await urlToDataUrl(url);
  } catch {
    return null;
  }
}

/**
 * Distill brand taste profile from rated images.
 * Sends images to Gemini for multimodal analysis.
 */
export async function distillBrandTaste(
  brandKit: BrandKit,
  ratings: ImageRating[],
  signal?: AbortSignal,
): Promise<DistillResult> {
  const onBrand = ratings
    .filter((r) => r.rating === 'on-brand')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ON_BRAND);

  const offBrand = ratings
    .filter((r) => r.rating === 'off-brand')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_OFF_BRAND);

  // Resolve image URLs to data URLs for API
  const resolvedOnBrand: string[] = [];
  for (const r of onBrand) {
    const url = await resolveImageUrl(r.imageUrl);
    if (url) resolvedOnBrand.push(url);
  }

  const resolvedOffBrand: string[] = [];
  for (const r of offBrand) {
    const url = await resolveImageUrl(r.imageUrl);
    if (url) resolvedOffBrand.push(url);
  }

  const allImages = [...resolvedOnBrand, ...resolvedOffBrand];

  // Build analysis prompt
  const onCount = resolvedOnBrand.length;
  const offCount = resolvedOffBrand.length;

  const promptParts: string[] = [
    `以下是品牌「${brandKit.name}」的图片评价。`,
    `前 ${onCount} 张是「符合品牌」的图片，后 ${offCount} 张是「不符合品牌」的图片。`,
    '',
    '请从以下维度对比分析这两组图片的差异，总结品牌的视觉偏好：',
    '1. learnedPreferences：品牌偏爱的视觉元素（数组，每项简短）',
    '2. learnedAvoidances：品牌排斥的视觉元素（数组，每项简短）',
    '3. compositionNotes：构图偏好（一段话）',
    '4. colorNotes：色彩偏好（一段话）',
    '5. moodNotes：氛围偏好（一段话）',
    '',
    '请直接用 JSON 格式回复，不要包含 markdown 代码块标记：',
    '{ "learnedPreferences": [...], "learnedAvoidances": [...], "compositionNotes": "...", "colorNotes": "...", "moodNotes": "..." }',
  ];

  if (brandKit.styleKeywords.length > 0) {
    promptParts.splice(2, 0, `品牌已有风格关键词：${brandKit.styleKeywords.join('、')}。`);
  }

  const prompt = promptParts.join('\n');

  // Use Gemini via the existing proxy
  const resp = await imagesGenerations(
    {
      prompt,
      n: 1,
      response_format: ResponseFormat.Url,
      size: '1024x1024',
      image: allImages.length > 0 ? allImages : undefined,
    },
    { signal, queueSource: 'chat' },
  );

  // Extract text response — Gemini returns text in the response
  let responseText = '';
  for (const item of resp.data || []) {
    if (item && typeof item === 'object') {
      // The API may return text in various fields
      const obj = item as any;
      if (obj.text) {
        responseText = obj.text;
        break;
      }
      if (obj.revised_prompt) {
        responseText = obj.revised_prompt;
      }
    }
  }

  // If no text from data, try the model's text field or raw response
  if (!responseText && (resp as any).text) {
    responseText = (resp as any).text;
  }

  // Parse JSON from response
  const parsed = parseProfileJson(responseText);

  const profile: BrandTasteProfile = {
    learnedPreferences: parsed.learnedPreferences || [],
    learnedAvoidances: parsed.learnedAvoidances || [],
    compositionNotes: parsed.compositionNotes || '',
    colorNotes: parsed.colorNotes || '',
    moodNotes: parsed.moodNotes || '',
    distilledAt: Date.now(),
    ratingCountAtDistill: ratings.length,
  };

  return {
    profile,
    onBrandCount: onCount,
    offBrandCount: offCount,
  };
}

function parseProfileJson(text: string): Partial<BrandTasteProfile> {
  if (!text) return {};

  // Strip markdown code fences if present
  let cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '').trim();

  // Try to extract JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};

  try {
    const obj = JSON.parse(jsonMatch[0]);
    return {
      learnedPreferences: Array.isArray(obj.learnedPreferences) ? obj.learnedPreferences.map(String) : [],
      learnedAvoidances: Array.isArray(obj.learnedAvoidances) ? obj.learnedAvoidances.map(String) : [],
      compositionNotes: typeof obj.compositionNotes === 'string' ? obj.compositionNotes : '',
      colorNotes: typeof obj.colorNotes === 'string' ? obj.colorNotes : '',
      moodNotes: typeof obj.moodNotes === 'string' ? obj.moodNotes : '',
    };
  } catch {
    return {};
  }
}
