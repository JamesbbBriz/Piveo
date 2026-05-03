import { beforeEach, describe, expect, it } from 'vitest';
import {
  initPersistentStorage,
  loadSessions,
  saveSessions,
  setStorageUserId,
} from '@/services/storage';
import { AspectRatio, ProductScale, type Session } from '@/types';

const makeSession = (): Session => ({
  id: 's_1',
  title: 'local heavy session',
  messages: [
    {
      id: 'm_1',
      role: 'model',
      timestamp: Date.now(),
      parts: [{ type: 'image', imageUrl: 'data:image/png;base64,AAAA' }],
    },
  ],
  updatedAt: Date.now(),
  messagesLoaded: true,
  settings: {
    systemPrompt: '',
    aspectRatio: AspectRatio.Square,
    selectedModelId: null,
    productScale: ProductScale.Standard,
    responseFormat: 'url',
    batchCount: 1,
    batchSizes: [],
    imageSize: '2K',
    autoUseLastImage: true,
    productImage: null,
  },
});

describe('server authoritative storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('purges legacy heavy local data and does not persist sessions locally', async () => {
    localStorage.setItem('nanobanana_sessions_v1', JSON.stringify([makeSession()]));

    await setStorageUserId('user_1');
    await initPersistentStorage();

    expect(localStorage.getItem('nanobanana_sessions_v1')).toBeNull();

    await saveSessions([makeSession()]);

    expect(localStorage.getItem('nanobanana_sessions_v1')).toBeNull();
    await expect(loadSessions()).resolves.toEqual([]);
  });
});
