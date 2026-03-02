import type { ProcessedUpload } from '@/components/piveo/types';

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_UPLOAD_MB = 15;

export const validateImageFile = (file: File) => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are supported');
  }
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Unsupported image format. Use JPG, PNG or WEBP');
  }
  const maxSize = MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error(`Image is too large. Max size is ${MAX_UPLOAD_MB}MB`);
  }
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode image'));
    image.src = src;
  });

export const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const resizeImageDataUrl = async (inputDataUrl: string, maxEdge = 1600): Promise<{ output: string; width: number; height: number }> => {
  const image = await loadImage(inputDataUrl);
  const ratio = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(image, 0, 0, width, height);
  const output = canvas.toDataURL('image/webp', 0.92);
  canvas.width = 0;
  canvas.height = 0;
  return { output, width, height };
};

export const processUploadFile = async (file: File): Promise<ProcessedUpload> => {
  validateImageFile(file);
  const inputDataUrl = await fileToDataUrl(file);
  const resized = await resizeImageDataUrl(inputDataUrl);
  return {
    file,
    previewUrl: resized.output,
    width: resized.width,
    height: resized.height,
    mime: 'image/webp',
  };
};
