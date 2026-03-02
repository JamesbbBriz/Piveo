import { v4 as uuidv4 } from 'uuid';

export interface BuildVideoRequestInput {
  imageUrl: string;
  durationSec?: number;
  prompt?: string;
}

export interface VideoRequestPayload {
  firstFrameImageUrl: string;
  durationSec: number;
  prompt: string;
  motion: 'smooth-zoom-pan';
}

export interface VideoGenerationResult {
  id: string;
  url: string;
  durationSec: number;
  fallback: boolean;
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load first frame image'));
    image.src = src;
  });

const createMediaRecorder = (stream: MediaStream): MediaRecorder => {
  const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const mimeType of mimeTypes) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType)) {
      return new MediaRecorder(stream, { mimeType });
    }
  }
  return new MediaRecorder(stream);
};

export const buildVideoRequest = ({ imageUrl, durationSec = 15, prompt = '' }: BuildVideoRequestInput): VideoRequestPayload => ({
  firstFrameImageUrl: imageUrl,
  durationSec,
  prompt,
  motion: 'smooth-zoom-pan',
});

export const createFallbackMotionVideo = async ({ imageUrl, durationSec = 8 }: BuildVideoRequestInput): Promise<VideoGenerationResult> => {
  const image = await loadImage(imageUrl);
  const width = 768;
  const height = Math.max(432, Math.round(width * (image.naturalHeight / Math.max(1, image.naturalWidth))));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable');

  const stream = canvas.captureStream(24);
  const recorder = createMediaRecorder(stream);
  const chunks: Blob[] = [];

  const videoBlob = await new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error('Fallback recorder failed'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));

    const start = performance.now();
    const totalMs = durationSec * 1000;

    const render = (now: number) => {
      const elapsed = Math.min(totalMs, now - start);
      const t = elapsed / totalMs;

      const scale = 1 + t * 0.08;
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      const offsetX = (width - drawWidth) * 0.5;
      const offsetY = (height - drawHeight) * (0.45 + t * 0.1);

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

      if (elapsed < totalMs) {
        requestAnimationFrame(render);
      } else {
        recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
      }
    };

    recorder.start(200);
    requestAnimationFrame(render);
  });

  return {
    id: uuidv4(),
    url: URL.createObjectURL(videoBlob),
    durationSec,
    fallback: true,
  };
};

export const startFirstFrameVideo = async (input: BuildVideoRequestInput): Promise<VideoGenerationResult> => {
  const useUpstream = String((import.meta as any)?.env?.VITE_ENABLE_VIDEO_UPSTREAM || '').toLowerCase() === 'true';
  const payload = buildVideoRequest(input);

  if (useUpstream) {
    try {
      const resp = await fetch('/api/v1/videos/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (json?.url) {
        return {
          id: json.id || uuidv4(),
          url: String(json.url),
          durationSec: Number(json.durationSec) || payload.durationSec,
          fallback: false,
        };
      }
    } catch {
      // fall back
    }
  }

  return await createFallbackMotionVideo(input);
};
