import React, { useRef } from 'react';
import { Icon } from './Icon';

interface PromptBarProps {
  inputText: string;
  onInputChange: (text: string) => void;
  onSend: () => void;
  onImageUpload: (file: File) => void;
  onEnhance: () => void;
  isGenerating: boolean;
  isEnhancing: boolean;
  selectedImage: { url: string; source: string } | null;
  onClearImage: () => void;
  disabled?: boolean;
}

export const PromptBar: React.FC<PromptBarProps> = ({
  inputText,
  onInputChange,
  onSend,
  onImageUpload,
  onEnhance,
  isGenerating,
  isEnhancing,
  selectedImage,
  onClearImage,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          onImageUpload(file);
          return;
        }
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageUpload(file);
    }
    e.target.value = '';
  };

  const canSend = (inputText.trim() || selectedImage) && !isGenerating && !disabled;

  return (
    <div className="bg-dark-800 border-t border-dark-700 p-4 lg:p-4 shrink-0">
      <div className="w-full flex flex-col gap-2">
        {/* Selected image preview */}
        {selectedImage && (
          <div className="relative inline-block self-start">
            <img
              src={selectedImage.url}
              alt="参考图"
              className="h-16 rounded-lg border border-emerald-500/50 object-cover shadow-lg"
              loading="lazy"
              decoding="async"
            />
            <button
              onClick={onClearImage}
              className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] shadow-md hover:bg-red-600"
            >
              <Icon name="times" />
            </button>
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end gap-2 bg-dark-900 border border-dark-600 rounded-xl p-2 focus-within:border-dark-500 transition-colors">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 text-gray-400 hover:text-banana-400 transition-colors rounded-lg hover:bg-dark-800"
            title="上传图片"
          >
            <Icon name="image" className="text-lg" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*"
            className="hidden"
          />
          <textarea
            value={inputText}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="例如：给人物加一顶红色帽子..."
            className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-gray-200 placeholder-gray-600 max-h-32 py-2.5 resize-none custom-scrollbar text-sm"
            rows={1}
            style={{ minHeight: '40px' }}
            disabled={disabled}
          />
          <button
            onClick={onEnhance}
            disabled={!inputText.trim() || isEnhancing || isGenerating}
            className={`p-2.5 text-banana-500 hover:text-banana-400 rounded-lg hover:bg-dark-800 disabled:opacity-40 ${isEnhancing ? 'animate-pulse' : ''}`}
            title="AI 提示词增强"
          >
            <Icon name="magic" />
          </button>
          <button
            onClick={onSend}
            disabled={!canSend}
            className={`p-2.5 rounded-lg font-semibold transition-all ${
              !canSend
                ? 'bg-dark-700 text-gray-500'
                : 'bg-banana-500 hover:bg-banana-400 text-dark-900 shadow-lg'
            }`}
            title="发送"
          >
            <Icon name="paper-plane" />
          </button>
        </div>

        <div className="text-[10px] text-gray-600">
          回车发送，Shift+回车换行。支持粘贴图片。
        </div>
      </div>
    </div>
  );
};
