import { describe, expect, it } from 'vitest';
import { validateImageFile } from '@/services/uploadPipeline';

describe('upload pipeline', () => {
  it('should reject unsupported mime type', () => {
    const file = new File(['abc'], 'a.txt', { type: 'text/plain' });
    expect(() => validateImageFile(file)).toThrow(/image/i);
  });
});
