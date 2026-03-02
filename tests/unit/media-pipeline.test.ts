import { describe, expect, it } from 'vitest';
import { buildMediaTasks } from '@/services/mediaPipeline';

describe('media pipeline', () => {
  it('builds N image tasks plus one video task with brandkit context', () => {
    const tasks = buildMediaTasks({ styles: ['a', 'b', 'c'], brandKitId: 'bk_1' });
    expect(tasks.imageTasks).toHaveLength(3);
    expect(tasks.videoTask).toBeTruthy();
    expect(tasks.sharedContext.brandKitId).toBe('bk_1');
  });
});
