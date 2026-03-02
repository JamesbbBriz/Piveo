import { describe, expect, it } from 'vitest';
import { buildVideoRequest } from '@/services/videoGeneration';

describe('video generation', () => {
  it('should create first-frame request payload', () => {
    const payload = buildVideoRequest({ imageUrl: 'data:image/png;base64,abc', durationSec: 15 });
    expect(payload.durationSec).toBe(15);
    expect(payload.firstFrameImageUrl).toContain('data:image');
  });
});
