import { dataUrlToBlob } from "./imageData";

export type DownloadFormat = "png" | "jpg" | "webp";
export interface DownloadOptions {
  format: DownloadFormat;
  quality: number; // 70-100
}

const DOWNLOAD_FORMAT_KEY = "topseller_download_format_v1";
const DOWNLOAD_QUALITY_KEY = "topseller_download_quality_v1";

const normalizeFormat = (raw: string): DownloadFormat | null => {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "jpg" || v === "jpeg") return "jpg";
  if (v === "webp") return "webp";
  if (v === "png") return "png";
  return null;
};

const normalizeQuality = (raw: unknown, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.round(n);
  return Math.min(100, Math.max(70, v));
};

const loadPreferredFormat = (): DownloadFormat => {
  try {
    const raw = localStorage.getItem(DOWNLOAD_FORMAT_KEY);
    return normalizeFormat(raw || "") || "jpg";
  } catch {
    return "jpg";
  }
};

const loadPreferredQuality = (): number => {
  try {
    const raw = localStorage.getItem(DOWNLOAD_QUALITY_KEY);
    return normalizeQuality(raw ?? "", 100);
  } catch {
    return 100;
  }
};

const savePreferredOptions = (options: DownloadOptions) => {
  try {
    localStorage.setItem(DOWNLOAD_FORMAT_KEY, options.format);
    localStorage.setItem(DOWNLOAD_QUALITY_KEY, String(normalizeQuality(options.quality, 100)));
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

const blobToFormat = async (blob: Blob, format: DownloadFormat, quality?: number): Promise<Blob> => {
  const targetType =
    format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
  const sourceType = String(blob.type || "").split(";")[0].trim().toLowerCase();
  if (sourceType === targetType) {
    return blob;
  }

  const { width, height, img, url } = await readImageDimensions(blob);
  const canvas = document.createElement("canvas");
  try {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布上下文");
    if (format === "jpg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    const encodeQuality =
      format === "png" ? undefined : normalizeQuality(quality, 100) / 100;
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, targetType, encodeQuality)
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

const fetchImageBlob = async (imageUrl: string): Promise<Blob> => {
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
  opts?: { basename?: string; format?: DownloadFormat; quality?: number }
) => {
  const preferred = loadDownloadOptions();
  const format = opts?.format || preferred.format;
  const quality = format === "webp" ? normalizeQuality(opts?.quality ?? preferred.quality, 100) : normalizeQuality(opts?.quality ?? preferred.quality, 100);
  const base = (opts?.basename || `topseller-${Date.now()}`).replace(/\.[^.]+$/, "");
  const srcBlob = await fetchImageBlob(imageUrl);
  const outBlob = await blobToFormat(srcBlob, format, quality);
  triggerDownload(outBlob, `${base}.${format}`);
};
