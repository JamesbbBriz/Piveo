import React, { useRef } from 'react';
import type { ReferenceIntent } from '../types';
import { Icon } from './Icon';
import { Button } from '@/components/base/buttons/button';
import { Tabs } from '@/components/application/tabs/tabs';

const INTENT_OPTIONS: { value: ReferenceIntent; label: string }[] = [
  { value: 'all', label: '全部参考' },
  { value: 'product', label: '产品外观' },
  { value: 'style', label: '风格氛围' },
  { value: 'composition', label: '构图排版' },
];

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
  referenceIntent: ReferenceIntent;
  onReferenceIntentChange: (intent: ReferenceIntent) => void;
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
  referenceIntent,
  onReferenceIntentChange,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const intentItems = INTENT_OPTIONS;

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
    <div className="bg-[var(--piveo-card)] border-t border-[var(--piveo-border)] p-4 lg:p-4 shrink-0">
      <div className="w-full flex flex-col gap-2">
        {/* Selected image preview + intent selector */}
        {selectedImage && (
          <div className="flex items-center gap-3">
            <div className="relative inline-block shrink-0">
              <img
                src={selectedImage.url}
                alt="参考图"
                className="h-16 rounded-lg border border-[var(--piveo-border)] object-cover shadow-sm"
                loading="lazy"
                decoding="async"
              />
              <button
                onClick={onClearImage}
                className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] shadow-sm hover:bg-red-600"
              >
                <Icon name="times" />
              </button>
            </div>
            <Tabs selectedKey={referenceIntent} onSelectionChange={(key) => onReferenceIntentChange(String(key) as ReferenceIntent)}>
              <Tabs.List
                items={intentItems}
                type="button-gray"
                size="sm"
                className="bg-transparent ring-0 p-0 gap-1.5 overflow-x-auto scrollbar-hide"
              >
                {(opt) => (
                  <Tabs.Item
                    id={opt.value}
                    textValue={opt.label}
                    className="!text-[11px] !py-1 !px-2.5 !rounded-md !border !border-[var(--piveo-border)] !bg-white !text-[var(--piveo-body)]"
                  >
                    {opt.label}
                  </Tabs.Item>
                )}
              </Tabs.List>
            </Tabs>
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end gap-2 bg-white border border-[var(--piveo-border)] rounded-xl p-2 focus-within:border-[var(--piveo-text)] transition-colors">
          <Button
            type="button"
            color="tertiary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="!p-2.5 !text-[var(--piveo-body)] hover:!text-[var(--piveo-text)]"
            aria-label="上传图片"
          >
            <Icon name="image" className="text-lg" />
          </Button>
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
            className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-[var(--piveo-text)] placeholder-[var(--piveo-muted)] max-h-32 py-2.5 resize-none custom-scrollbar text-sm"
            rows={1}
            style={{ minHeight: '40px' }}
            disabled={disabled}
          />
          <Button
            type="button"
            color="tertiary"
            size="sm"
            onClick={onEnhance}
            isDisabled={!inputText.trim() || isEnhancing || isGenerating}
            isLoading={isEnhancing}
            className="!p-2.5 !text-[var(--piveo-accent)] hover:!text-[var(--piveo-accent-hover)]"
            aria-label="AI 提示词增强"
          >
            <Icon name="magic" />
          </Button>
          <Button
            type="button"
            size="sm"
            color="primary"
            onClick={onSend}
            isDisabled={!canSend}
            className="!p-2.5 !bg-[var(--piveo-text)] !text-white hover:!bg-[var(--piveo-accent-hover)] disabled:!bg-[var(--piveo-border)] disabled:!text-[var(--piveo-muted)]"
            aria-label="发送"
          >
            <Icon name="paper-plane" />
          </Button>
        </div>

        <div className="text-[10px] text-[var(--piveo-muted)]">
          回车发送，Shift+回车换行。支持粘贴图片。
        </div>
      </div>
    </div>
  );
};
