import React from "react";
import { Icon } from "./Icon";
import { DownloadFormat, DownloadOptions } from "../services/imageDownload";

interface DownloadOptionsModalProps {
  isOpen: boolean;
  options: DownloadOptions;
  onChange: (next: DownloadOptions) => void;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  confirmLabel?: string;
}

const formatLabel = (format: DownloadFormat): string => {
  if (format === "jpg") return "JPG";
  if (format === "webp") return "WEBP";
  return "PNG";
};

export const DownloadOptionsModal: React.FC<DownloadOptionsModalProps> = ({
  isOpen,
  options,
  onChange,
  onCancel,
  onConfirm,
  title = "下载设置",
  confirmLabel = "下载",
}) => {
  if (!isOpen) return null;
  const showQuality = options.format !== "png";
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
              {(["jpg", "webp", "png"] as DownloadFormat[]).map((format) => (
                <button
                  key={format}
                  onClick={() =>
                    onChange({
                      format,
                      quality: format === "webp" ? 100 : options.quality,
                    })
                  }
                  className={`flex-1 h-9 rounded-md border text-xs font-semibold transition-colors ${
                    options.format === format
                      ? "border-banana-500 bg-banana-500/10 text-banana-400"
                      : "border-dark-600 bg-dark-900 text-gray-300 hover:border-gray-500"
                  }`}
                >
                  {formatLabel(format)}
                </button>
              ))}
            </div>
          </div>

          {showQuality && (
            <div>
              <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                <span>质量</span>
                <span className="text-gray-200 font-semibold">{options.quality}</span>
              </div>
              <input
                type="range"
                min={70}
                max={100}
                value={options.quality}
                onChange={(e) => onChange({ ...options, quality: Number(e.target.value) })}
                className="w-full accent-banana-500"
              />
              {options.format === "webp" && (
                <div className="mt-1 text-[11px] text-gray-500">WEBP 建议 100 以保留细节。</div>
              )}
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
