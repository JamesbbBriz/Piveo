import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useModalA11y } from "./useModalA11y";

export interface MaskEditorHistoryItem {
  id: string;
  imageUrl: string;
  title: string;
  subtitle?: string;
}

interface MaskEditorModalProps {
  baseImageUrl: string;
  historyItems: MaskEditorHistoryItem[];
  onSelectBaseImage: (url: string) => void;
  onClose: () => void;
  onSubmit: (params: {
    baseImageUrl: string;
    prompt: string;
    maskDataUrl: string;
    maskOverlayDataUrl: string;
  }) => Promise<{ generatedImageUrls?: string[] } | void>;
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const IMAGE_LOAD_TIMEOUT_MS = 8000;
const IMAGE_TOTAL_TIMEOUT_MS = 20000;

const isDataOrBlobUrl = (url: string): boolean => /^data:|^blob:/i.test(String(url || ""));
const isHttpUrl = (url: string): boolean => /^https?:\/\//i.test(String(url || ""));
const canvasToBlob = (canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("画布导出失败"));
          return;
        }
        resolve(blob);
      }, type, quality);
    } catch (e) {
      reject(e);
    }
  });

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(blob);
  });

export const MaskEditorModal: React.FC<MaskEditorModalProps> = ({
  baseImageUrl,
  historyItems,
  onSelectBaseImage,
  onClose,
  onSubmit,
}) => {
  const imgCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadSeed, setReloadSeed] = useState(0);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brush, setBrush] = useState(36);
  const [mode, setMode] = useState<"paint" | "erase">("paint");
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitInfo, setSubmitInfo] = useState<string | null>(null);

  const hint = useMemo(() => {
    return "涂抹红色区域表示“需要修改”的地方。提交后会生成遮罩（透明=可编辑区域）。";
  }, []);

  useModalA11y(true, modalRef, onClose);

  const clearOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    clearOverlay();
    setSubmitError(null);
    setSubmitInfo(null);
    setIsDrawing(false);
    lastPointRef.current = null;
  }, [baseImageUrl, clearOverlay]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    let totalTimer: number | null = null;

    setIsReady(false);
    setLoadState("loading");
    setLoadError(null);
    totalTimer = window.setTimeout(() => {
      if (cancelled) return;
      setLoadState("error");
      setLoadError("图片加载总超时。请重试，或先下载后重新上传再做局部编辑。");
    }, IMAGE_TOTAL_TIMEOUT_MS);

    const finish = () => {
      if (totalTimer !== null) {
        window.clearTimeout(totalTimer);
        totalTimer = null;
      }
    };

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
      finish();
    };

    const loadImage = (src: string, withAnonymous: boolean, timeoutMs = IMAGE_LOAD_TIMEOUT_MS): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        let done = false;
        const cleanup = () => {
          done = true;
          window.clearTimeout(timer);
          img.onload = null;
          img.onerror = null;
        };
        const timer = window.setTimeout(() => {
          if (done) return;
          cleanup();
          reject(new Error(`图片加载超时（${timeoutMs}ms）`));
        }, timeoutMs);
        if (withAnonymous) img.crossOrigin = "anonymous";
        img.onload = () => {
          if (done) return;
          cleanup();
          resolve(img);
        };
        img.onerror = () => {
          if (done) return;
          cleanup();
          reject(new Error("图片加载失败"));
        };
        img.src = src;
      });

    const fetchToObjectUrl = async (src: string, timeoutMs = 12000): Promise<string> => {
      const controller = new AbortController();
      const t = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(src, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        return URL.createObjectURL(blob);
      } finally {
        window.clearTimeout(t);
      }
    };

    const load = async () => {
      let lastError: unknown = null;

      if (isDataOrBlobUrl(baseImageUrl)) {
        try {
          const img = await loadImage(baseImageUrl, false);
          if (cancelled) return;
          drawToCanvas(img);
          return;
        } catch (e) {
          lastError = e;
        }
      }

      if (isHttpUrl(baseImageUrl)) {
        try {
          const proxied = `/auth/image-proxy?url=${encodeURIComponent(baseImageUrl)}`;
          objectUrl = await fetchToObjectUrl(proxied, 15000);
          const img = await loadImage(objectUrl, false, 10000);
          if (cancelled) return;
          drawToCanvas(img);
          return;
        } catch (e) {
          lastError = e;
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
          }
        }
      }

      try {
        const img = await loadImage(baseImageUrl, false);
        if (cancelled) return;
        drawToCanvas(img);
        return;
      } catch (e) {
        lastError = e;
      }

      try {
        objectUrl = await fetchToObjectUrl(baseImageUrl);
        const img = await loadImage(objectUrl, false, 8000);
        if (cancelled) return;
        drawToCanvas(img);
        return;
      } catch (e) {
        lastError = e;
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
      }

      if (isHttpUrl(baseImageUrl)) {
        try {
          const proxied = `/auth/image-proxy?url=${encodeURIComponent(baseImageUrl)}`;
          const img = await loadImage(proxied, false);
          if (cancelled) return;
          drawToCanvas(img);
          return;
        } catch (e) {
          lastError = e;
        }
      }

      if (cancelled) return;
      finish();
      setIsReady(false);
      setLoadState("error");
      const msg = lastError instanceof Error ? lastError.message : "未知错误";
      setLoadError(`${msg}。可尝试“重试加载”，或先在聊天区点下载后再上传进行局部编辑。`);
    };

    void load();
    return () => {
      cancelled = true;
      finish();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [baseImageUrl, reloadSeed]);

  const syncOverlaySize = useCallback(() => {
    const imgCanvas = imgCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!imgCanvas || !overlayCanvas) return;
    if (overlayCanvas.width !== imgCanvas.width) overlayCanvas.width = imgCanvas.width;
    if (overlayCanvas.height !== imgCanvas.height) overlayCanvas.height = imgCanvas.height;
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
    ctx.fillStyle = "rgba(239,68,68,0.55)";
    ctx.beginPath();
    ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const drawStroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brush;
    ctx.globalCompositeOperation = mode === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = "rgba(239,68,68,0.55)";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  };

  const buildMaskDataUrl = async (): Promise<{ maskDataUrl: string; maskOverlayDataUrl: string }> => {
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

    const mask = mctx.createImageData(w, h);
    const dst32 = new Uint32Array(mask.data.buffer);
    for (let i = 0; i < dst32.length; i++) {
      const alpha = src[i * 4 + 3];
      dst32[i] = alpha > 8 ? 0x00000000 : 0xff000000;
    }
    mctx.putImageData(mask, 0, 0);

    try {
      const [maskBlob, overlayBlob] = await Promise.all([
        canvasToBlob(maskCanvas, "image/png"),
        canvasToBlob(overlay, "image/png"),
      ]);
      const [maskDataUrl, maskOverlayDataUrl] = await Promise.all([
        blobToDataUrl(maskBlob),
        blobToDataUrl(overlayBlob),
      ]);
      return {
        maskDataUrl,
        maskOverlayDataUrl,
      };
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "SecurityError"
        ? "无法导出遮罩：图片跨域受限，请尝试使用 b64_json 格式或下载后重新上传。"
        : `导出遮罩失败：${e instanceof Error ? e.message : String(e)}`;
      throw new Error(msg);
    }
  };

  const submit = async () => {
    const p = prompt.trim();
    if (!p) {
      window.alert("请输入编辑提示词。");
      return;
    }
    if (!isReady || loadState !== "ready") {
      window.alert("图片尚未加载完成，请稍后再试。");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitInfo(null);
    try {
      const { maskDataUrl, maskOverlayDataUrl } = await buildMaskDataUrl();
      const result = await onSubmit({
        baseImageUrl,
        prompt: p,
        maskDataUrl,
        maskOverlayDataUrl,
      });
      const generatedImageUrls = Array.isArray(result?.generatedImageUrls)
        ? result?.generatedImageUrls.filter((u): u is string => Boolean(u))
        : [];

      if (generatedImageUrls.length > 0) {
        onSelectBaseImage(generatedImageUrls[0]);
        clearOverlay();
        setSubmitInfo(`已生成 ${generatedImageUrls.length} 张，已切换到最新结果，可继续局部修改。`);
      } else {
        setSubmitInfo("请求已提交，请在左侧历史中选择结果继续编辑。");
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeHistoryId = useMemo(() => {
    const found = historyItems.find((item) => item.imageUrl === baseImageUrl);
    return found?.id || null;
  }, [baseImageUrl, historyItems]);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 lg:p-4" onClick={onClose}>
      <div
        ref={modalRef}
        tabIndex={-1}
        className="w-full max-w-[1680px] h-[92vh] bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-dark-700 flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-200 font-semibold">
            <Icon name="paint-brush" />
            局部编辑（遮罩）
          </div>
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs bg-dark-900 hover:bg-dark-700 text-gray-200 border border-dark-600 rounded-lg"
          >
            关闭
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          <aside className="hidden md:flex w-64 border-r border-dark-700 bg-dark-900/35 flex-col min-h-0">
            <div className="px-3 py-2 border-b border-dark-700 text-[11px] text-gray-400">历史（点选切换编辑底图）</div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {historyItems.length === 0 && (
                <div className="text-xs text-gray-500 px-2 py-3">暂无可切换历史</div>
              )}
              {historyItems.map((item) => {
                const active = activeHistoryId === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectBaseImage(item.imageUrl)}
                    className={`w-full text-left rounded-lg border transition-colors overflow-hidden ${
                      active
                        ? "border-banana-500 bg-banana-500/10"
                        : "border-dark-700 hover:border-dark-500 bg-dark-800/40"
                    }`}
                  >
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      className="w-full h-28 object-cover bg-black/20"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="p-2">
                      <div className="text-xs text-gray-200 truncate">{item.title}</div>
                      {item.subtitle && <div className="mt-1 text-[10px] text-gray-500 truncate">{item.subtitle}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="flex-1 min-w-0 flex flex-col lg:flex-row">
            <div className="flex-1 p-3 lg:p-4 overflow-auto flex items-start justify-center">
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
              {loadState !== "error" && (
                <div className="inline-block relative max-w-full rounded-xl border border-dark-700 bg-black/20 overflow-hidden">
                  <canvas
                    ref={imgCanvasRef}
                    className="block w-auto h-auto max-w-full max-h-[calc(92vh-170px)]"
                  />
                  <canvas
                    ref={overlayCanvasRef}
                    className="absolute inset-0 touch-none"
                    onPointerDown={(e) => {
                      if (!isReady || isSubmitting) return;
                      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
                      setIsDrawing(true);
                      const pt = getPoint(e);
                      if (pt) {
                        drawDot(pt.x, pt.y);
                        lastPointRef.current = pt;
                      }
                    }}
                    onPointerMove={(e) => {
                      if (!isDrawing || isSubmitting) return;
                      const pt = getPoint(e);
                      if (pt) {
                        if (lastPointRef.current) {
                          drawStroke(lastPointRef.current, pt);
                        } else {
                          drawDot(pt.x, pt.y);
                        }
                        lastPointRef.current = pt;
                      }
                    }}
                    onPointerUp={(e) => {
                      try {
                        (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
                      } catch {
                        // ignore
                      }
                      setIsDrawing(false);
                      lastPointRef.current = null;
                    }}
                    onPointerCancel={() => {
                      setIsDrawing(false);
                      lastPointRef.current = null;
                    }}
                  />
                  {loadState === "loading" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-dark-900/60">
                      <div className="text-gray-400 text-sm">加载图片中...</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="w-full lg:w-[360px] border-t lg:border-t-0 lg:border-l border-dark-700 p-3 lg:p-4 space-y-4 overflow-y-auto">
              <div className="md:hidden bg-dark-900/40 border border-dark-700 rounded-xl p-3">
                <div className="text-[11px] text-gray-400 mb-2">历史（移动端）</div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {historyItems.map((item) => {
                    const active = activeHistoryId === item.id;
                    return (
                      <button
                        key={`mobile-${item.id}`}
                        onClick={() => onSelectBaseImage(item.imageUrl)}
                        className={`flex-shrink-0 rounded-md border ${active ? "border-banana-500" : "border-dark-600"}`}
                      >
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="w-16 h-16 object-cover rounded-md"
                          loading="lazy"
                          decoding="async"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
                <div className="text-[11px] text-gray-400 mb-2">说明</div>
                <div className="text-sm text-gray-200 leading-relaxed">{hint}</div>
              </div>

              <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-gray-400">工具</div>
                  <button
                    onClick={clearOverlay}
                    disabled={isSubmitting}
                    className="px-3 py-1.5 text-xs bg-dark-700 hover:bg-dark-600 disabled:opacity-60 text-gray-200 border border-dark-600 rounded-lg"
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
                {submitError && <div className="mt-2 text-xs text-red-300">{submitError}</div>}
                {submitInfo && <div className="mt-2 text-xs text-emerald-300">{submitInfo}</div>}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void submit()}
                    disabled={isSubmitting || loadState !== "ready"}
                    className="flex-1 px-4 py-2 bg-banana-500 hover:bg-banana-400 disabled:opacity-60 text-dark-900 font-semibold rounded-lg"
                  >
                    {isSubmitting ? "生成中..." : "开始生成"}
                  </button>
                </div>
                <div className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                  提示：生成完成后弹窗不会关闭，结果会自动进入左侧历史，可直接切换并继续局部编辑。
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};
