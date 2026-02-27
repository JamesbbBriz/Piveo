function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

export async function exportComparison(
  beforeUrl: string,
  afterUrl: string,
  options?: {
    layout?: 'horizontal' | 'vertical';
    beforeLabel?: string;
    afterLabel?: string;
  }
): Promise<void> {
  const layout = options?.layout ?? 'horizontal';
  const beforeLabel = options?.beforeLabel ?? '原图';
  const afterLabel = options?.afterLabel ?? '生成';

  const [beforeImg, afterImg] = await Promise.all([
    loadImage(beforeUrl),
    loadImage(afterUrl),
  ]);

  // Use the larger dimension to normalize both images
  const w = Math.max(beforeImg.naturalWidth, afterImg.naturalWidth);
  const h = Math.max(beforeImg.naturalHeight, afterImg.naturalHeight);

  const canvasW = layout === 'horizontal' ? w * 2 : w;
  const canvasH = layout === 'horizontal' ? h : h * 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  // Black background for letterboxing
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Draw helper: center the image within the given region
  const drawCentered = (
    img: HTMLImageElement,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) => {
    const scale = Math.min(dw / img.naturalWidth, dh / img.naturalHeight);
    const sw = img.naturalWidth * scale;
    const sh = img.naturalHeight * scale;
    ctx.drawImage(img, dx + (dw - sw) / 2, dy + (dh - sh) / 2, sw, sh);
  };

  if (layout === 'horizontal') {
    drawCentered(beforeImg, 0, 0, w, h);
    drawCentered(afterImg, w, 0, w, h);
  } else {
    drawCentered(beforeImg, 0, 0, w, h);
    drawCentered(afterImg, 0, h, w, h);
  }

  // Draw labels
  const fontSize = 24;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textBaseline = 'top';

  const drawLabel = (text: string, x: number, y: number) => {
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  };

  const pad = 16;
  drawLabel(beforeLabel, pad, pad);
  if (layout === 'horizontal') {
    drawLabel(afterLabel, w + pad, pad);
  } else {
    drawLabel(afterLabel, pad, h + pad);
  }

  // Export as WebP
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comparison-${Date.now()}.webp`;
      a.click();
      URL.revokeObjectURL(url);
    },
    'image/webp',
    0.92
  );
}
