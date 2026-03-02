import React, { useState, useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { DownloadOptions, fetchImageBlob, blobToFormat } from "../services/imageDownload";

interface DownloadOptionsModalProps {
  isOpen: boolean;
  options: DownloadOptions;
  onChange: (next: DownloadOptions) => void;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  confirmLabel?: string;
  imageUrl?: string;
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const DownloadOptionsModal: React.FC<DownloadOptionsModalProps> = ({
  isOpen,
  options,
  onChange,
  onCancel,
  onConfirm,
  title = "下载设置",
  confirmLabel = "下载",
  imageUrl,
}) => {
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [estimatedSize, setEstimatedSize] = useState<number | null>(null);
  const [computing, setComputing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch source blob when modal opens
  useEffect(() => {
    if (!isOpen || !imageUrl) {
      setSourceBlob(null);
      setEstimatedSize(null);
      return;
    }
    let cancelled = false;
    setComputing(true);
    fetchImageBlob(imageUrl)
      .then((blob) => {
        if (!cancelled) setSourceBlob(blob);
      })
      .catch(() => {
        if (!cancelled) setSourceBlob(null);
      });
    return () => { cancelled = true; };
  }, [isOpen, imageUrl]);

  // Compute estimated size when quality/sourceBlob changes
  useEffect(() => {
    if (!sourceBlob) {
      setEstimatedSize(null);
      setComputing(false);
      return;
    }
    setComputing(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      let cancelled = false;
      blobToFormat(sourceBlob, options.format, options.quality)
        .then((out) => {
          if (!cancelled) {
            setEstimatedSize(out.size);
            setComputing(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setEstimatedSize(null);
            setComputing(false);
          }
        });
      // cleanup for this specific conversion
      return () => { cancelled = true; };
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [sourceBlob, options.format, options.quality]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-sm rounded-xl border border-dark-600 bg-dark-800 shadow-2xl">
        <div className="px-4 py-3 border-b border-dark-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-200">
            <Icon name="times" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <div className="text-xs text-gray-400 mb-2">格式</div>
            <div className="flex gap-2">
              {(["webp", "jpeg"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => onChange({ ...options, format: fmt })}
                  className={`flex-1 py-1.5 text-xs rounded-md border font-semibold transition-colors ${
                    options.format === fmt
                      ? "border-banana-500 bg-banana-500 text-dark-900"
                      : "border-dark-600 bg-dark-900 text-gray-300 hover:bg-dark-700"
                  }`}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
              <span>{options.format.toUpperCase()} 质量</span>
              <span className="text-gray-200 font-semibold">{options.quality}</span>
            </div>
            <input
              type="range"
              min={70}
              max={99}
              value={options.quality}
              onChange={(e) => onChange({ ...options, quality: Number(e.target.value) })}
              className="w-full accent-banana-500"
            />
            <div className="mt-1 text-[11px] text-gray-500">建议 99 以保留最佳细节，降低可减小文件体积。</div>
          </div>

          {imageUrl && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">预估大小</span>
              <span className="text-gray-200 font-semibold">
                {computing ? "计算中..." : estimatedSize != null ? formatSize(estimatedSize) : "-"}
              </span>
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-dark-700 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md border border-dark-600 bg-dark-900 text-gray-300 hover:bg-dark-700"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs rounded-md border border-banana-500 bg-banana-500 text-dark-900 font-semibold hover:bg-banana-400"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
