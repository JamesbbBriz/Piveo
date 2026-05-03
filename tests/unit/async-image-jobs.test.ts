import { describe, expect, it, vi } from 'vitest';
import { createAsyncImageJobStore } from '../../server/services/asyncImageJobs.mjs';

describe('async image jobs', () => {
  it('returns immediately and stores the upstream response when the background request completes', async () => {
    let releaseUpstream!: () => void;
    const upstreamReady = new Promise<void>((resolve) => {
      releaseUpstream = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await upstreamReady;
      return new Response(JSON.stringify({ created: 1, data: [{ url: 'https://img.test/a.png' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const store = createAsyncImageJobStore({
      fetchImpl,
      timeoutMs: 10_000,
      ttlMs: 60_000,
      now: () => 1_700_000_000_000,
    });

    const job = store.submit({
      method: 'POST',
      targetUrl: 'https://upstream.test/v1/images/edits',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: Buffer.from('{"prompt":"x"}'),
      requestId: 'rid_1',
      username: 'alice',
      userId: 'user_1',
      endpoint: '/v1/images/edits',
      model: 'gpt-image-2-pro',
    });

    expect(job.status).toBe('running');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.get(job.id, 'alice')?.status).toBe('running');

    releaseUpstream();
    await job.done;

    const completed = store.get(job.id, 'alice');
    expect(completed?.status).toBe('succeeded');
    expect(completed?.upstreamStatus).toBe(200);
    expect(completed?.responseText).toContain('https://img.test/a.png');
  });
});
