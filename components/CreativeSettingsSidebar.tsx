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

  return (
    <div className="px-4 pb-4">
      <div className="bg-dark-900/20 border border-dark-700 rounded-xl p-3 space-y-4">
        <div>
          <div className="text-[11px] text-gray-400 mb-2">画幅比例</div>
          <div className="grid grid-cols-3 gap-2">
            {getSupportedAspectRatios().map((ratio) => (
              <button
                key={ratio}
                onClick={() => handleAspectRatioChange(ratio)}
                className={`py-2 rounded-lg border text-xs font-semibold transition-colors ${
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
          <div className="text-[11px] text-gray-400 mb-2">产品大小</div>
          <div className="flex gap-2">
            {[ProductScale.Small, ProductScale.Standard, ProductScale.Large].map((scale) => (
              <button
                key={scale}
                onClick={() => onUpdateSettings({ ...settings, productScale: scale })}
                className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                  settings.productScale === scale
                    ? "bg-banana-500 text-dark-900 border-banana-500"
                    : "bg-dark-700 text-gray-300 border-dark-600 hover:border-gray-500"
                }`}
              >
                {scale === ProductScale.Small ? "小" : scale === ProductScale.Standard ? "标准" : "大"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
