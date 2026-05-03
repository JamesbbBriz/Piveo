import { describe, expect, it } from 'vitest';
import { getQueueStats } from '../../services/generationQueue';

describe('generation queue policy', () => {
  it('defaults to one active image request to avoid overlapping expensive upstream jobs', () => {
    expect(getQueueStats().maxInFlight).toBe(1);
  });
});
