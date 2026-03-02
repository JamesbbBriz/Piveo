import type { BrandKit } from '@/types';

export interface BrandKitPromptPolicyResult {
  promptPrefix: string;
  hardRules: string[];
}

const joinIfAny = (label: string, values?: string[]) => {
  if (!Array.isArray(values) || values.length === 0) return '';
  return `${label}：${values.join('、')}`;
};

export const buildBrandKitPolicyPrompt = (kit: BrandKit | null): BrandKitPromptPolicyResult => {
  if (!kit) return { promptPrefix: '', hardRules: [] };

  const parts: string[] = [];
  const style = joinIfAny('品牌视觉风格', kit.styleKeywords);
  const palette = joinIfAny('品牌主色调', kit.colorPalette);
  const mood = joinIfAny('品牌氛围', kit.moodKeywords);
  if (style) parts.push(style);
  if (palette) parts.push(palette);
  if (mood) parts.push(mood);

  if (kit.tasteProfile) {
    const tp = kit.tasteProfile;
    const preferences = joinIfAny('品牌偏好', tp.learnedPreferences);
    const avoidances = joinIfAny('品牌禁忌', tp.learnedAvoidances);
    if (preferences) parts.push(preferences);
    if (avoidances) parts.push(avoidances);
    if (tp.compositionNotes) parts.push(`构图要求：${tp.compositionNotes}`);
    if (tp.colorNotes) parts.push(`色彩要求：${tp.colorNotes}`);
    if (tp.moodNotes) parts.push(`氛围要求：${tp.moodNotes}`);
  }

  const hardRules = kit.tasteProfile?.learnedAvoidances ?? [];
  return {
    promptPrefix: parts.length > 0 ? `【Brand DNA】${parts.join('。')}。` : '',
    hardRules,
  };
};
