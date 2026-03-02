import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('brand tokens', () => {
  it('should include piveo title and monochrome primary token', () => {
    const html = readFileSync('index.html', 'utf-8');
    expect(html).toContain('Piveo');
    expect(html).toContain('#101828');
  });
});
