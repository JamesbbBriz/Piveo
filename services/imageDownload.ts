import { dataUrlToBlob } from "./imageData";

export type DownloadFormat = "webp" | "jpeg";
export interface DownloadOptions {
  format: DownloadFormat;
  quality: number; // 70-99
}

const DOWNLOAD_QUALITY_KEY = "piveo_download_quality_v1";
const DOWNLOAD_FORMAT_KEY = "piveo_download_format_v1";

const normalizeQuality = (raw: unknown, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.round(n);
  return Math.min(99, Math.max(70, v));
};

const normalizeFormat = (raw: unknown): DownloadFormat => {
  if (raw === "jpeg" || raw === "webp") return raw;
  return "webp";
};

const loadPreferredQuality = (): number => {
  try {
    const raw = localStorage.getItem(DOWNLOAD_QUALITY_KEY);
    return normalizeQuality(raw ?? "", 99);
  } catch {
    return 99;
  }
};

const loadPreferredFormat = (): DownloadFormat => {
  try {
    return normalizeFormat(localStorage.getItem(DOWNLOAD_FORMAT_KEY));
  } catch {
    return "webp";
  }
};

const savePreferredOptions = (options: DownloadOptions) => {
  try {
    localStorage.setItem(DOWNLOAD_QUALITY_KEY, String(normalizeQuality(options.quality, 99)));
    localStorage.setItem(DOWNLOAD_FORMAT_KEY, normalizeFormat(options.format));
  } catch {
    // ignore
  }
};

export const loadDownloadOptions = (): DownloadOptions => ({
  format: loadPreferredFormat(),
  quality: loadPreferredQuality(),
});

export const saveDownloadOptions = (options: DownloadOptions) => {
  savePreferredOptions(options);
};

const readImageDimensions = (blob: Blob): Promise<{ width: number; height: number; img: HTMLImageElement; url: string }> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width || 1,
        height: img.naturalHeight || img.height || 1,
        img,
        url,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片解码失败"));
    };
    img.src = url;
  });

export const blobToFormat = async (blob: Blob, format: DownloadFormat, quality?: number): Promise<Blob> => {
  const { width, height, img, url } = await readImageDimensions(blob);
  const canvas = document.createElement("canvas");
  try {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布上下文");
    ctx.drawImage(img, 0, 0, width, height);
    const encodeQuality = normalizeQuality(quality, 99) / 100;
    const mimeType = format === "jpeg" ? "image/jpeg" : "image/webp";
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, encodeQuality)
    );
    if (!out) throw new Error("图片格式转换失败");
    return out;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    img.src = "";
    URL.revokeObjectURL(url);
  }
};

export const fetchImageBlob = async (imageUrl: string): Promise<Blob> => {
  if (/^data:/i.test(imageUrl)) {
    return await dataUrlToBlob(imageUrl);
  }
  const url = /^https?:\/\//i.test(imageUrl)
    ? `/auth/image-proxy?url=${encodeURIComponent(imageUrl)}`
    : imageUrl;
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.blob();
};

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const downloadImageWithFormat = async (
  imageUrl: string,
  opts?: { basename?: string; quality?: number; format?: DownloadFormat }
) => {
  const preferred = loadDownloadOptions();
  const format = normalizeFormat(opts?.format ?? preferred.format);
  const quality = normalizeQuality(opts?.quality ?? preferred.quality, 99);
  const base = normalizeDownloadBase(opts?.basename).replace(/\.[^.]+$/, "");
  const srcBlob = await fetchImageBlob(imageUrl);
  const outBlob = await blobToFormat(srcBlob, format, quality);
  const ext = format === "jpeg" ? "jpg" : "webp";
  triggerDownload(outBlob, `${base}.${ext}`);
};

export const normalizeDownloadBase = (basename?: string): string =>
  String(basename || `piveo-${Date.now()}`).trim() || `piveo-${Date.now()}`;
