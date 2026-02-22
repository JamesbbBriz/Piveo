import React, { useState, useCallback, useRef } from 'react';
import { Icon } from './Icon';

export interface OnboardingProps {
  onFileUpload: (file: File) => void;
  onPaste: () => void;
  onQuickStart: (templateName: string) => void;
  onPromptSubmit: (prompt: string) => void;
  templates: Array<{ name: string; content: string }>;
}

export const Onboarding: React.FC<OnboardingProps> = ({
  onFileUpload,
  onPaste,
  onQuickStart,
  onPromptSubmit,
  templates,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [promptText, setPromptText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onFileUpload(file);
    }
  }, [onFileUpload]);

  const handleFileClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileUpload(file);
    }
    e.target.value = '';
  }, [onFileUpload]);

  const handlePromptSubmit = useCallback(() => {
    if (promptText.trim()) {
      onPromptSubmit(promptText.trim());
      setPromptText('');
    }
  }, [promptText, onPromptSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handlePromptSubmit();
    }
  }, [handlePromptSubmit]);

  return (
    <div
      className={`flex flex-col items-center justify-center h-full min-h-0 px-6 py-8 transition-colors ${
        isDragOver ? 'bg-banana-500/5' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="max-w-lg w-full flex flex-col items-center gap-6">
        {/* Title */}
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-banana-500/10 flex items-center justify-center mx-auto mb-4">
            <Icon name="palette" className="text-2xl text-banana-400" />
          </div>
          <h2 className="text-lg font-semibold text-zinc-200 mb-1">
            上传你的产品图，开始创作
          </h2>
          <p className="text-[12px] text-zinc-500">
            拖拽图片到此处，或使用下方工具开始
          </p>
        </div>

        {/* Upload actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleFileClick}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl border-2 border-dashed transition-all ${
              isDragOver
                ? 'border-banana-500 bg-banana-500/10 text-banana-400'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800'
            }`}
          >
            <Icon name="folder-open" className="text-sm" />
            <span className="text-[12px] font-medium">拖拽上传</span>
          </button>

          <button
            onClick={onPaste}
            className="flex items-center gap-2 px-5 py-3 rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 transition-all"
          >
            <Icon name="clipboard" className="text-sm" />
            <span className="text-[12px] font-medium">粘贴图片</span>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Divider */}
        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 border-t border-zinc-800" />
          <span className="text-[11px] text-zinc-600">或者直接输入描述开始生成</span>
          <div className="flex-1 border-t border-zinc-800" />
        </div>

        {/* Prompt input */}
        <div className="w-full relative">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例如：一位模特穿着白色衬衫，站在极简白色背景前..."
            rows={2}
            className="w-full px-4 py-3 pr-12 rounded-xl bg-zinc-900 border border-zinc-700 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-banana-500/50 resize-none transition-colors"
          />
          <button
            onClick={handlePromptSubmit}
            disabled={!promptText.trim()}
            className="absolute right-3 bottom-3 w-7 h-7 rounded-lg bg-banana-500 text-dark-900 flex items-center justify-center hover:bg-banana-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Icon name="arrow-right" className="text-[10px]" />
          </button>
        </div>

        {/* Quick start templates */}
        {templates.length > 0 && (
          <div className="w-full">
            <p className="text-[11px] text-zinc-500 mb-2">快速开始：</p>
            <div className="flex flex-wrap gap-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.name}
                  onClick={() => onQuickStart(tpl.name)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-[11px] text-zinc-300 hover:border-banana-500/40 hover:text-banana-400 hover:bg-banana-500/5 transition-all"
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
