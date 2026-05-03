import { describe, expect, it } from 'vitest';
import { createUpstreamInflightTracker } from '../../server/services/upstreamInflightTracker.mjs';

describe('upstream inflight tracker', () => {
  it('holds a per-user slot until the caller explicitly releases it', () => {
    const tracker = createUpstreamInflightTracker({ maxPerUser: 1, maxGlobal: 2 });

    const first = tracker.acquire('alice');
    expect(first.allowed).toBe(true);
    expect(tracker.countForUser('alice')).toBe(1);

    const blocked = tracker.acquire('alice');
    expect(blocked.allowed).toBe(false);
    expect(tracker.countForUser('alice')).toBe(1);

    first.release();
    expect(tracker.countForUser('alice')).toBe(0);

    const afterRelease = tracker.acquire('alice');
    expect(afterRelease.allowed).toBe(true);
    afterRelease.release();
  });
});
