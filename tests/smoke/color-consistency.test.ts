import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('piveo color consistency', () => {
  it('should keep global legacy palette bridge and app scope class', () => {
    const css = readFileSync('index.css', 'utf-8');
    const layout = readFileSync('components/Layout.tsx', 'utf-8');

    expect(layout).toContain('piveo-root');
    expect(css).toContain('.piveo-root [class*="bg-dark-900"]');
    expect(css).toContain('.piveo-root [class*="border-dark-"]');
    expect(css).toContain('.piveo-root [class*="text-banana-"]');
    expect(css).toContain('.piveo-root [class*="accent-banana-"]');
  });
});
