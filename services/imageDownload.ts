import { dataUrlToBlob } from "./imageData";

export type DownloadFormat = "webp";
export interface DownloadOptions {
  format: DownloadFormat;
  quality: number; // 70-99
}

const DOWNLOAD_QUALITY_KEY = "topseller_download_quality_v1";

const normalizeQuality = (raw: unknown, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.round(n);
  return Math.min(99, Math.max(70, v));
};

const loadPreferredQuality = (): number => {
  try {
    const raw = localStorage.getItem(DOWNLOAD_QUALITY_KEY);
    return normalizeQuality(raw ?? "", 99);
  } catch {
    return 99;
  }
};

const savePreferredOptions = (options: DownloadOptions) => {
  try {
    localStorage.setItem(DOWNLOAD_QUALITY_KEY, String(normalizeQuality(options.quality, 99)));
  } catch {
    // ignore
  }
};

export const loadDownloadOptions = (): DownloadOptions => ({
  format: "webp",
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

export const blobToFormat = async (blob: Blob, _format: DownloadFormat, quality?: number): Promise<Blob> => {
  const { width, height, img, url } = await readImageDimensions(blob);
  const canvas = document.createElement("canvas");
  try {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布上下文");
    ctx.drawImage(img, 0, 0, width, height);
    const encodeQuality = normalizeQuality(quality, 99) / 100;
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", encodeQuality)
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
  opts?: { basename?: string; quality?: number }
) => {
  const preferred = loadDownloadOptions();
  const quality = normalizeQuality(opts?.quality ?? preferred.quality, 99);
  const base = (opts?.basename || `topseller-${Date.now()}`).replace(/\.[^.]+$/, "");
  const srcBlob = await fetchImageBlob(imageUrl);
  const outBlob = await blobToFormat(srcBlob, "webp", quality);
  triggerDownload(outBlob, `${base}.webp`);
};
