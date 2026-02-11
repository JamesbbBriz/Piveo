import React, { useEffect, useState } from "react";
import { Icon } from "./Icon";

interface ImageCompareModalProps {
  beforeUrl: string;
  afterUrl: string;
  onClose: () => void;
}

export const ImageCompareModal: React.FC<ImageCompareModalProps> = ({ beforeUrl, afterUrl, onClose }) => {
  const [pos, setPos] = useState(50);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-5xl bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-dark-700 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <Icon name="columns" />
            图片对比
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-dark-900 hover:bg-dark-700 text-gray-200 border border-dark-600 rounded-lg"
          >
            关闭
          </button>
        </div>

        <div className="relative bg-black/30" style={{ height: "70vh" }}>
          <img src={beforeUrl} alt="原图" className="absolute inset-0 w-full h-full object-contain" />
          <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
            <img src={afterUrl} alt="新图" className="w-full h-full object-contain" />
          </div>

          {/* Divider */}
          <div className="absolute inset-y-0" style={{ left: `${pos}%` }}>
            <div className="w-px h-full bg-banana-400/80 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-banana-500 text-dark-900 flex items-center justify-center shadow-lg border border-black/30">
              <Icon name="arrows-alt-h" />
            </div>
          </div>

          <div className="absolute bottom-3 left-3 right-3 bg-dark-900/80 border border-dark-700 rounded-xl px-4 py-3 backdrop-blur">
            <div className="flex items-center justify-between text-[11px] text-gray-300 mb-2">
              <span>原图</span>
              <span>新图</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
              className="w-full accent-banana-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

