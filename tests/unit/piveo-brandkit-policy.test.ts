import { describe, expect, it } from 'vitest';
import type { BrandKit } from '@/types';
import { buildBrandKitPolicyPrompt } from '@/components/piveo/brandkitPolicy';

describe('brandkit policy', () => {
  it('builds brand dna prompt and hard rules', () => {
    const kit: BrandKit = {
      id: 'bk-1',
      name: 'Demo',
      description: '',
      styleKeywords: ['clean'],
      colorPalette: ['#ffffff', '#ff7d00'],
      moodKeywords: ['modern'],
      isActive: true,
      images: [],
      tasteProfile: {
        learnedPreferences: ['high contrast'],
        learnedAvoidances: ['dirty background'],
        compositionNotes: 'center composition',
        colorNotes: 'warm highlights',
        moodNotes: 'premium',
        distilledAt: Date.now(),
        ratingCountAtDistill: 1,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = buildBrandKitPolicyPrompt(kit);
    expect(result.promptPrefix).toContain('Brand DNA');
    expect(result.hardRules).toContain('dirty background');
  });
});
