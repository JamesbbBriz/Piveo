import { describe, expect, it } from 'vitest';
import { SCENE_OPTIONS, STYLE_LIBRARY } from '@/components/piveo/config';

describe('piveo config', () => {
  it('should expose product/model/architecture scenes and style presets', () => {
    expect(SCENE_OPTIONS.map((s) => s.id)).toEqual(['product', 'model', 'architecture']);
    expect(STYLE_LIBRARY.length).toBeGreaterThan(0);
  });

  it('should provide styles compatible with architecture scene', () => {
    const architectureStyles = STYLE_LIBRARY.filter((style) => style.sceneCompat.includes('architecture'));
    expect(architectureStyles.length).toBeGreaterThan(0);
  });
});
