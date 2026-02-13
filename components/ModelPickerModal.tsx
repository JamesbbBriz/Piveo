import React from "react";
import { ModelCharacter } from "../types";
import { Icon } from "./Icon";

interface ModelPickerModalProps {
  models: ModelCharacter[];
  onSelect: (model: ModelCharacter) => void;
  onClose: () => void;
}

export const ModelPickerModal: React.FC<ModelPickerModalProps> = ({
  models,
  onSelect,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-dark-900 border border-dark-700 rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
          <div className="flex items-center gap-3">
            <Icon name="users" className="text-banana-400 text-lg" />
            <h3 className="text-lg font-semibold text-gray-100">选择模特</h3>
            <span className="px-2 py-0.5 text-xs rounded-full bg-dark-800 text-gray-400 border border-dark-600">
              {models.length} 个模特
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-400 hover:text-gray-200 flex items-center justify-center transition-colors"
          >
            <Icon name="times" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {models.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {models.map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    onSelect(model);
                    onClose();
                  }}
                  className="aspect-[3/4] rounded-lg border border-dark-700 bg-dark-800/60 overflow-hidden group relative hover:border-banana-500 transition-colors"
                >
                  <img
                    src={model.imageUrl}
                    alt={model.name}
                    className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2">
                    <div className="text-xs text-gray-200 font-medium truncate">{model.name}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center">
              <Icon name="users" className="text-6xl text-gray-700 mb-4" />
              <p className="text-gray-500 text-sm">还没有模特</p>
              <p className="text-gray-600 text-xs mt-1">请先在模特库中添加模特</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-dark-700 flex justify-end bg-dark-900/60">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-200 border border-dark-600 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
};
