export const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("FileReader 返回结果不是字符串"));
      }
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
};

export const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  if (!/^data:/i.test(dataUrl)) {
    throw new Error("无效 data url");
  }
  const resp = await fetch(dataUrl);
  if (!resp.ok) {
    throw new Error(`data url 解码失败：HTTP ${resp.status}`);
  }
  return await resp.blob();
};

/**
 * 将远程图片 URL 下载并转换为 data URL（base64）
 * 用于持久化存储 AI 生成的临时图片
 */
export const urlToDataUrl = async (imageUrl: string): Promise<string> => {
  // 如果已经是 data URL，直接返回
  if (/^data:/i.test(imageUrl)) {
    return imageUrl;
  }

  // 通过代理下载图片（避免 CORS）
  const proxyUrl = /^https?:\/\//i.test(imageUrl)
    ? `/auth/image-proxy?url=${encodeURIComponent(imageUrl)}`
    : imageUrl;

  const resp = await fetch(proxyUrl, { credentials: "include" });
  if (!resp.ok) throw new Error(`图片下载失败：HTTP ${resp.status}`);

  const blob = await resp.blob();

  // 转换为 data URL
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("转换 data URL 失败"));
      }
    };
    reader.onerror = () => reject(new Error("读取 Blob 失败"));
    reader.readAsDataURL(blob);
  });
};
