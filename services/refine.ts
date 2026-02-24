import { getSupportedSizeForAspect } from './sizeUtils';

export interface RefineMessage {
  role: 'user' | 'model';
  text?: string;
  imageUrl?: string;  // data URL
}

interface RefineSettings {
  model: string;
  aspectRatio: string;
  systemPrompt?: string;
}

interface RefineResult {
  imageUrl: string;
  text?: string;
}

/**
 * Convert RefineMessage[] to OpenAI chat/completions messages format
 * and send to the API. Returns the model's image + optional text response.
 */
export async function sendRefineMessage(
  messages: RefineMessage[],
  settings: RefineSettings,
  signal?: AbortSignal
): Promise<RefineResult> {
  const openaiMessages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> = [];

  // Add system prompt if provided
  if (settings.systemPrompt) {
    openaiMessages.push({ role: 'system', content: settings.systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (msg.imageUrl && msg.text) {
        openaiMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: msg.text },
            { type: 'image_url', image_url: { url: msg.imageUrl } },
          ],
        });
      } else if (msg.imageUrl) {
        openaiMessages.push({
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: msg.imageUrl } },
          ],
        });
      } else {
        openaiMessages.push({ role: 'user', content: msg.text || '' });
      }
    } else {
      // model role → assistant
      if (msg.imageUrl) {
        openaiMessages.push({
          role: 'assistant',
          content: [
            { type: 'image_url', image_url: { url: msg.imageUrl } },
          ],
        });
      } else {
        openaiMessages.push({ role: 'assistant', content: msg.text || '' });
      }
    }
  }

  const size = getSupportedSizeForAspect(settings.aspectRatio);

  const body = {
    model: settings.model,
    messages: openaiMessages,
    size,
    extra_body: {
      google: {
        image_config: {
          aspect_ratio: settings.aspectRatio,
        },
      },
    },
  };

  const resp = await fetch('/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Refine request failed (HTTP ${resp.status}): ${errText}`);
  }

  const data = await resp.json();

  // Parse response — look for image in choices[0].message.content
  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error('No response from model');
  }

  const content = choice.message?.content;
  let imageUrl = '';
  let text = '';

  if (Array.isArray(content)) {
    // Array format: look for image_url and text parts
    for (const part of content) {
      if (part.type === 'image_url' && part.image_url?.url) {
        imageUrl = part.image_url.url;
      } else if (part.type === 'text' && part.text) {
        text += (text ? '\n' : '') + part.text;
      }
    }
  } else if (typeof content === 'string') {
    // String content — check for markdown image or data URL
    const mdMatch = /!\[.*?\]\((data:image\/[^)]+)\)/.exec(content);
    if (mdMatch) {
      imageUrl = mdMatch[1];
      text = content.replace(mdMatch[0], '').trim();
    } else if (content.startsWith('data:image/')) {
      imageUrl = content;
    } else {
      text = content;
    }
  }

  if (!imageUrl) {
    throw new Error(text || 'Model did not return an image');
  }

  return { imageUrl, text: text || undefined };
}
