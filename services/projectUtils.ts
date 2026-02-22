import type { Session, GeneratedImage, Message } from '../types';

/**
 * Extract GeneratedImage records from a Session's chat messages.
 * Walks through all messages and collects image parts with metadata.
 */
export function extractImagesFromSession(session: Session): GeneratedImage[] {
  const images: GeneratedImage[] = [];

  for (const msg of session.messages) {
    // Find the prompt text from the same message (for user messages) or preceding user message
    const textPart = msg.parts.find((p) => p.type === 'text');
    const promptText = textPart?.text || '';

    for (let pi = 0; pi < msg.parts.length; pi++) {
      const part = msg.parts[pi];
      if (part.type !== 'image' || !part.imageUrl) continue;

      const meta = part.meta;
      images.push({
        id: meta?.id || `${msg.id}-${pi}`,
        imageUrl: part.imageUrl,
        prompt: meta?.prompt || promptText,
        model: meta?.model || '',
        size: meta?.size || '',
        createdAt: meta?.createdAt || msg.timestamp,
        source: meta?.action?.includes('局部编辑') ? 'mask-edit'
          : meta?.action?.includes('变体') ? 'variation'
          : 'chat',
        parentImageId: meta?.parentImageUrl ? undefined : undefined,
        action: meta?.action,
      });
    }
  }

  return images;
}

/**
 * Find the prompt text associated with a model response message.
 * Looks backwards from the message index to find the preceding user message's text.
 */
export function findPromptForMessage(messages: Message[], messageIndex: number): string {
  for (let i = messageIndex; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') {
      const textPart = msg.parts.find((p) => p.type === 'text');
      if (textPart?.text) return textPart.text;
    }
  }
  return '';
}
