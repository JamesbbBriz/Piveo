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
