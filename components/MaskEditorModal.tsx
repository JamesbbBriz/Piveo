import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";

interface MaskEditorModalProps {
  baseImageUrl: string;
  onClose: () => void;
  onSubmit: (params: { prompt: string; maskDataUrl: string; maskOverlayDataUrl: string }) => void;
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

export const MaskEditorModal: React.FC<MaskEditorModalProps> = ({ baseImageUrl, onClose, onSubmit }) => {
  const imgCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isReady, setIsReady] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadSeed, setReloadSeed] = useState(0);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brush, setBrush] = useState(36);
  const [mode, setMode] = useState<"paint" | "erase">("paint");
  const [prompt, setPrompt] = useState("");

  const hint = useMemo(() => {
    return "涂抹红色区域表示“需要修改”的地方。提交后会生成遮罩（透明=可编辑区域）。";
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setIsReady(false);
    setLoadState("loading");
    setLoadError(null);

    const drawToCanvas = (img: HTMLImageElement) => {
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 1024;

      const imgCanvas = imgCanvasRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      if (!imgCanvas || !overlayCanvas) return;

      imgCanvas.width = w;
      imgCanvas.height = h;
      overlayCanvas.width = w;
      overlayCanvas.height = h;

      const ctx = imgCanvas.getContext("2d");
      const octx = overlayCanvas.getContext("2d");
      if (!ctx || !octx) return;

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      octx.clearRect(0, 0, w, h);
      setIsReady(true);
      setLoadState("ready");
    };

    const loadImage = (src: string, withAnonymous: boolean): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        if (withAnonymous) img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("图片加载失败"));
        img.src = src;
      });

    const load = async () => {
      try {
        const img = await loadImage(baseImageUrl, true);
        if (cancelled) return;
        drawToCanvas(img);
        return;
      } catch {
        // ignore and fallback
      }

      try {
        const img = await loadImage(baseImageUrl, false);
        if (cancelled) return;
        drawToCanvas(img);
        return;
      } catch {
        // ignore and fallback
      }

      try {
        const resp = await fetch(baseImageUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        objectUrl = URL.createObjectURL(blob);
        const img = await loadImage(objectUrl, false);
        if (cancelled) return;
        drawToCanvas(img);
        return;
      } catch (e) {
        if (cancelled) return;
        setIsReady(false);
        setLoadState("error");
        setLoadError(e instanceof Error ? e.message : "未知错误");
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [baseImageUrl, reloadSeed]);

  // P1-14: 同步 overlay canvas 的物理尺寸与底图 canvas 一致
  const syncOverlaySize = useCallback(() => {
    const imgCanvas = imgCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!imgCanvas || !overlayCanvas) return;
    // overlay 的物理尺寸必须与底图 canvas 一致
    if (overlayCanvas.width !== imgCanvas.width) overlayCanvas.width = imgCanvas.width;
    if (overlayCanvas.height !== imgCanvas.height) overlayCanvas.height = imgCanvas.height;
    // CSS 尺寸同步：确保视觉上完全对齐
    const rendered = imgCanvas.getBoundingClientRect();
    overlayCanvas.style.width = `${rendered.width}px`;
    overlayCanvas.style.height = `${rendered.height}px`;
  }, []);

  useEffect(() => {
    const imgCanvas = imgCanvasRef.current;
    if (!imgCanvas || !isReady) return;
    syncOverlaySize();
    const ro = new ResizeObserver(() => syncOverlaySize());
    ro.observe(imgCanvas);
    return () => ro.disconnect();
  }, [isReady, syncOverlaySize]);

  const getPoint = (evt: React.PointerEvent) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((evt.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const drawDot = (x: number, y: number) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = mode === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = "rgba(239,68,68,0.55)"; // red-500 w/ alpha
    ctx.beginPath();
    ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const clearOverlay = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const buildMaskDataUrl = (): { maskDataUrl: string; maskOverlayDataUrl: string } => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) throw new Error("遮罩画布未就绪");
    const w = overlay.width;
    const h = overlay.height;
    const octx = overlay.getContext("2d");
    if (!octx) throw new Error("遮罩画布上下文不可用");

    const overlayData = octx.getImageData(0, 0, w, h);
    const src = overlayData.data;

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = w;
    maskCanvas.height = h;
    const mctx = maskCanvas.getContext("2d");
    if (!mctx) throw new Error("mask 画布上下文不可用");

    // Start with opaque black (keep). Transparent area means editable.
    const mask = mctx.createImageData(w, h);
    const dst = mask.data;
    for (let i = 0; i < dst.length; i += 4) {
      // Keep pixels black; alpha set later.
      dst[i] = 0;
      dst[i + 1] = 0;
      dst[i + 2] = 0;

      const alpha = src[i + 3];
      // If overlay has paint => editable => transparent alpha.
      dst[i + 3] = alpha > 8 ? 0 : 255;
    }
    mctx.putImageData(mask, 0, 0);

    try {
      return {
        maskDataUrl: maskCanvas.toDataURL("image/png"),
        maskOverlayDataUrl: overlay.toDataURL("image/png"),
      };
    } catch (e) {
      // CORS 导致 canvas 被污染时 toDataURL 会抛出 SecurityError
      const msg = e instanceof DOMException && e.name === "SecurityError"
        ? "无法导出遮罩：图片跨域受限，请尝试使用 b64_json 格式或下载后重新上传。"
        : `导出遮罩失败：${e instanceof Error ? e.message : String(e)}`;
      throw new Error(msg);
    }
  };

  const submit = () => {
    const p = prompt.trim();
    if (!p) {
      alert("请输入编辑提示词。");
      return;
    }
    try {
      const { maskDataUrl, maskOverlayDataUrl } = buildMaskDataUrl();
      onSubmit({ prompt: p, maskDataUrl, maskOverlayDataUrl });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl h-[88vh] bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-dark-700 flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-200 font-semibold">
            <Icon name="paint-brush" />
            局部编辑（遮罩）
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-2 text-xs bg-dark-900 hover:bg-dark-700 text-gray-200 border border-dark-600 rounded-lg"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-0">
          <div className="relative p-4 overflow-auto" ref={containerRef}>
            {loadState === "loading" && (
              <div className="text-gray-500 text-sm">加载图片中...</div>
            )}
            {loadState === "error" && (
              <div className="max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-3">
                <div className="text-sm text-red-200">图片加载失败，无法进入局部编辑。</div>
                <div className="text-xs text-red-300/90 break-all">{loadError || "请重试或换一张图。"}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setReloadSeed((v) => v + 1)}
                    className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                  >
                    重试加载
                  </button>
                  <a
                    href={baseImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                  >
                    新标签打开原图
                  </a>
                </div>
              </div>
            )}
            {loadState === "ready" && (
              <div className="inline-block relative rounded-xl border border-dark-700 bg-black/20 overflow-hidden">
                <canvas ref={imgCanvasRef} className="block max-w-full h-auto" />
                <canvas
                  ref={overlayCanvasRef}
                  className="absolute inset-0 block max-w-full h-auto touch-none"
                  onPointerDown={(e) => {
                    if (!isReady) return;
                    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
                    setIsDrawing(true);
                    const pt = getPoint(e);
                    if (pt) drawDot(pt.x, pt.y);
                  }}
                  onPointerMove={(e) => {
                    if (!isDrawing) return;
                    const pt = getPoint(e);
                    if (pt) drawDot(pt.x, pt.y);
                  }}
                  onPointerUp={() => setIsDrawing(false)}
                  onPointerCancel={() => setIsDrawing(false)}
                />
              </div>
            )}
          </div>

          <div className="border-l border-dark-700 p-4 space-y-4 overflow-y-auto">
            <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
              <div className="text-[11px] text-gray-400 mb-2">说明</div>
              <div className="text-sm text-gray-200 leading-relaxed">{hint}</div>
            </div>

            <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-gray-400">工具</div>
                <button
                  onClick={clearOverlay}
                  className="px-3 py-1.5 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                >
                  清空遮罩
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setMode("paint")}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
                    mode === "paint"
                      ? "bg-banana-500 text-dark-900 border-banana-500"
                      : "bg-dark-700 text-gray-200 border-dark-600 hover:bg-dark-600"
                  }`}
                >
                  涂抹
                </button>
                <button
                  onClick={() => setMode("erase")}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
                    mode === "erase"
                      ? "bg-banana-500 text-dark-900 border-banana-500"
                      : "bg-dark-700 text-gray-200 border-dark-600 hover:bg-dark-600"
                  }`}
                >
                  擦除
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1">
                  <span>笔刷大小</span>
                  <span className="text-gray-300">{brush}px</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={120}
                  value={brush}
                  onChange={(e) => setBrush(clamp(Number(e.target.value), 8, 120))}
                  className="w-full accent-banana-500"
                />
              </div>
            </div>

            <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
              <div className="text-[11px] text-gray-400 mb-2">编辑提示词</div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg p-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500 focus:ring-1 focus:ring-banana-500 transition-colors resize-none h-28"
                placeholder="例如：把红色区域的帽子改成蓝色，并保持人物一致性。"
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={submit}
                  className="flex-1 px-4 py-2 bg-banana-500 hover:bg-banana-400 text-dark-900 font-semibold rounded-lg"
                >
                  开始生成
                </button>
              </div>
              <div className="mt-2 text-[11px] text-gray-500">
                提示：部分模型支持原生遮罩编辑（/v1/images/edits）。如果不支持，会自动退化为“参考图 + 遮罩提示图”的编辑方式。
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
