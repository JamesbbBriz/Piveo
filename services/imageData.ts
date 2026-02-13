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
