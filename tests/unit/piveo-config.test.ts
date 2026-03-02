import { describe, expect, it } from 'vitest';
import { SCENE_OPTIONS, STYLE_LIBRARY } from '@/components/piveo/config';

describe('piveo config', () => {
  it('should expose product/model scenes and style presets', () => {
    expect(SCENE_OPTIONS.map((s) => s.id)).toEqual(['product', 'model']);
    expect(STYLE_LIBRARY.length).toBeGreaterThan(0);
  });
});
