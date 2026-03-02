import type { BrandKit } from '@/types';
import { buildBrandKitPolicyPrompt } from '@/components/piveo/brandkitPolicy';

export const buildBrandKitPrompt = (brandKit: BrandKit | null): string => {
  const policy = buildBrandKitPolicyPrompt(brandKit);
  if (!policy.promptPrefix && policy.hardRules.length === 0) return '';

  const hardRules =
    policy.hardRules.length > 0
      ? `必须避免：${policy.hardRules.join('、')}。`
      : '';

  return `${policy.promptPrefix}${hardRules}`.trim();
};
