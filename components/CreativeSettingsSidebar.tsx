import React from "react";
import { AspectRatio, ProductScale, SessionSettings } from "../types";
import { getSupportedAspectRatios, getSupportedSizeForAspect } from "../services/sizeUtils";

interface CreativeSettingsSidebarProps {
  settings: SessionSettings;
  onUpdateSettings: (next: SessionSettings) => void;
}

export const CreativeSettingsSidebar: React.FC<CreativeSettingsSidebarProps> = ({ settings, onUpdateSettings }) => {
  const handleAspectRatioChange = (ratio: AspectRatio) => {
    onUpdateSettings({ ...settings, aspectRatio: ratio, batchSizes: [getSupportedSizeForAspect(ratio)] });
  };
  const getScaleLabel = (scale: ProductScale): string => {
    if (scale === ProductScale.Small) return "低调";
    if (scale === ProductScale.Large) return "突出";
    return "平衡";
  };

  return (
    <div className="px-3 pb-2.5">
      <div className="bg-dark-900/20 border border-dark-700 rounded-xl p-2 space-y-2.5">
        <div>
          <div className="text-[10px] text-gray-400 mb-1.5">画幅比例</div>
          <div className="grid grid-cols-3 gap-2">
            {getSupportedAspectRatios().map((ratio) => (
              <button
                key={ratio}
                onClick={() => handleAspectRatioChange(ratio)}
                className={`h-8 rounded-lg border text-[10px] font-semibold transition-colors ${
                  settings.aspectRatio === ratio
                    ? "bg-banana-500/10 border-banana-500 text-banana-400"
                    : "bg-dark-700 border-dark-600 text-gray-300 hover:border-gray-500"
                }`}
              >
                {ratio}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] text-gray-400 mb-1.5">产品显眼程度</div>
          <div className="flex gap-2">
            {[ProductScale.Small, ProductScale.Standard, ProductScale.Large].map((scale) => (
              <button
                key={scale}
                onClick={() => onUpdateSettings({ ...settings, productScale: scale })}
                className={`flex-1 h-8 rounded-lg border text-[10px] font-semibold transition-colors ${
                  settings.productScale === scale
                    ? "bg-banana-500 text-dark-900 border-banana-500"
                    : "bg-dark-700 text-gray-300 border-dark-600 hover:border-gray-500"
                }`}
              >
                {getScaleLabel(scale)}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-gray-500">影响产品在画面中的占比与存在感。</div>
        </div>
      </div>
    </div>
  );
};
