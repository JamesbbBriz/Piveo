import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildVideoRequest, startFirstFrameVideo } from '@/services/videoGeneration';

describe('video generation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('should create veo multipart-compatible payload fields', () => {
    const payload = buildVideoRequest({
      imageUrl: 'data:image/png;base64,abc',
      lastFrameImageUrl: 'data:image/png;base64,xyz',
      model: 'veo_3_1-fl',
      aspectRatio: '16:9',
      resolution: '1080p',
    });
    expect(payload.model).toBe('veo_3_1-fl');
    expect(payload.size).toBe('1920x1080');
    expect(payload.input_reference).toHaveLength(2);
    expect(payload.prompt).toContain('主体一致性优先');
    expect(payload.prompt).not.toContain('用户创作要求：');
  });

  it('should map veo portrait requests to 1080x1920', () => {
    const payload = buildVideoRequest({
      imageUrl: 'data:image/png;base64,abc',
      model: 'veo_3_1-fl',
      aspectRatio: '9:16',
      resolution: '1080p',
    });

    expect(payload.size).toBe('1080x1920');
  });

  it('should surface upstream errors instead of silently falling back', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(new Blob(['frame'], { type: 'image/webp' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ model: 'sora-2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await expect(
      startFirstFrameVideo({
        imageUrl: 'data:image/png;base64,abc',
        prompt: '让产品缓慢旋转',
      })
    ).rejects.toThrow(/Veo 上游生成失败：视频任务创建成功，但未返回任务 ID/);
  });

  it('should reject unsupported video models explicitly', async () => {
    await expect(
      startFirstFrameVideo({
        imageUrl: 'data:image/png;base64,abc',
        prompt: '让产品缓慢旋转',
        model: 'sora-2',
      })
    ).rejects.toThrow(/当前视频工作流仅支持 veo_3_1 模型，收到：sora-2/);
  });

  it('should return queued upstream task without polling', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(new Blob(['frame'], { type: 'image/webp' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ task_id: 'task-123', status: 'queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await expect(
      startFirstFrameVideo({
        imageUrl: 'data:image/png;base64,abc',
        prompt: '让产品缓慢旋转',
      })
    ).resolves.toMatchObject({
      id: 'task-123',
      status: 'queued',
      url: '',
    });
  });

  it('should surface backend configuration errors directly', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(new Blob(['frame'], { type: 'image/webp' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: '当前线路未配置上游鉴权。' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await expect(
      startFirstFrameVideo({
        imageUrl: 'data:image/png;base64,abc',
        prompt: '让产品缓慢旋转',
      })
    ).rejects.toThrow(/Veo 上游生成失败：当前线路未配置上游鉴权/);
  });
});
