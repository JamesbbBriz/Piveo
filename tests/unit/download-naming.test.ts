import { describe, expect, it } from 'vitest';
import { normalizeDownloadBase } from '@/services/imageDownload';

describe('download naming', () => {
  it('uses piveo prefix', () => {
    expect(normalizeDownloadBase(undefined)).toMatch(/^piveo-/);
  });
});
