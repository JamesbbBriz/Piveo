import React, { useRef, useState, useEffect } from 'react';
import type { ReferenceIntent } from '../types';
import { Icon } from './Icon';
import { Button } from '@/components/base/buttons/button';
import { Tabs } from '@/components/application/tabs/tabs';
import { NumberedAttachmentsStrip, type Attachment } from './NumberedAttachmentsStrip';

const INTENT_OPTIONS: { value: ReferenceIntent; label: string }[] = [
  { value: 'all', label: '全部参考' },
  { value: 'product', label: '产品外观' },
  { value: 'style', label: '风格氛围' },
  { value: 'composition', label: '构图排版' },
];

// P1-#10：示例提示词，给新用户一个 starting point。涵盖核心场景。
const EXAMPLE_PROMPTS: { label: string; prompt: string }[] = [
  { label: '产品白底图', prompt: '把这张产品图改成纯白背景的电商主图，光线柔和均匀，居中构图，无投影。' },
  { label: '场景氛围图', prompt: '把这张产品放进现代北欧风客厅场景，自然光从左侧大窗洒入，画面温暖柔和。' },
  { label: '模特上身', prompt: '让模特身穿这件衣服，街拍风格，城市背景虚化，自然站姿。' },
  { label: '多图合成', prompt: '用图1的产品 + 图2的背景场景 + 图3的灯光氛围，合成一张品牌主视觉。' },
  { label: '细节特写', prompt: '聚焦产品细节（材质纹理、缝线、商标），微距镜头，柔光，背景模糊。' },
];

interface PromptBarProps {
  inputText: string;
  onInputChange: (text: string) => void;
  onSend: () => void;
  /** 生成中点击发送区域时改为取消生成 — 没有传入则禁用取消能力 */
  onCancel?: () => void;
  onImageUpload: (file: File) => void;
  onEnhance: () => void;
  isGenerating: boolean;
  isEnhancing: boolean;
  selectedImage: { url: string; source: string } | null;
  onClearImage: () => void;
  referenceIntent: ReferenceIntent;
  onReferenceIntentChange: (intent: ReferenceIntent) => void;
  disabled?: boolean;
  // 多图附件（可选）：顺序即 1..N 编号顺序
  attachments?: Attachment[];
  onAttachmentsChange?: (next: Attachment[]) => void;
}

export const PromptBar: React.FC<PromptBarProps> = ({
  inputText,
  onInputChange,
  onSend,
  onCancel,
  onImageUpload,
  onEnhance,
  isGenerating,
  isEnhancing,
  selectedImage,
  onClearImage,
  referenceIntent,
  onReferenceIntentChange,
  disabled = false,
  attachments,
  onAttachmentsChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const intentItems = INTENT_OPTIONS;
  // P1-#10：示例 popover 开关
  const [examplesOpen, setExamplesOpen] = useState(false);
  const examplesRef = useRef<HTMLDivElement>(null);
  // P2-#20：底部提示文案的永久"已看过"标记，写到 localStorage 防止每次刷新又出现
  const HINT_DISMISSED_KEY = 'piveo_promptbar_hint_dismissed';
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(HINT_DISMISSED_KEY) === '1'; }
    catch { return false; }
  });
  const dismissHint = () => {
    setHintDismissed(true);
    try { window.localStorage.setItem(HINT_DISMISSED_KEY, '1'); } catch { /* ignore */ }
  };
  // 点击 popover 外部时关闭
  useEffect(() => {
    if (!examplesOpen) return;
    const handler = (e: MouseEvent) => {
      if (examplesRef.current && !examplesRef.current.contains(e.target as Node)) {
        setExamplesOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [examplesOpen]);

  // 在 textarea 光标位置插入 @图N 引用；若拿不到光标则追加到末尾
  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      onInputChange((inputText || '') + snippet);
      return;
    }
    const start = el.selectionStart ?? inputText.length;
    const end = el.selectionEnd ?? inputText.length;
    const before = inputText.slice(0, start);
    const after = inputText.slice(end);
    const next = before + snippet + after;
    onInputChange(next);
    // 恢复光标到插入内容之后
    requestAnimationFrame(() => {
      const pos = start + snippet.length;
      try {
        el.focus();
        el.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    });
  };

  const handleInsertRef = (idx: number) => {
    insertAtCursor(`@图${idx + 1} `);
  };

  const handleRemoveAttachment = (id: string) => {
    if (!onAttachmentsChange || !attachments) return;
    onAttachmentsChange(attachments.filter((a) => a.id !== id));
  };

  const handleReorderAttachment = (fromIdx: number, toIdx: number) => {
    if (!onAttachmentsChange || !attachments) return;
    if (fromIdx === toIdx) return;
    if (fromIdx < 0 || fromIdx >= attachments.length) return;
    if (toIdx < 0 || toIdx >= attachments.length) return;
    const next = attachments.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onAttachmentsChange(next);
  };

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

        {/* 多图附件编号条 + 使用提示 */}
        {attachments && attachments.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[11px] text-[var(--piveo-muted)] leading-none">
              <Icon name="info-circle" className="text-[10px]" />
              <span>
                已附 <span className="text-[var(--piveo-text)] font-medium">{attachments.length}</span> 张参考图。
                {attachments.length >= 2 ? (
                  <>
                    点编号插入引用，Prompt 里可说{" "}
                    <span className="text-[var(--piveo-text)] font-medium">"用图1的脸，图2的背景"</span>。
                  </>
                ) : (
                  <>再粘贴/上传可继续添加，最多 6 张。</>
                )}
              </span>
            </div>
            <NumberedAttachmentsStrip
              attachments={attachments}
              onRemove={handleRemoveAttachment}
              onReorder={onAttachmentsChange ? handleReorderAttachment : undefined}
              onInsertRef={handleInsertRef}
            />
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
            ref={textareaRef}
            value={inputText}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              attachments && attachments.length >= 2
                ? "例如：用图1的脸 + 图2的背景 + 图3的服装风格，合成一张..."
                : attachments && attachments.length === 1
                ? "例如：把这张图的背景换成北欧客厅，光线保留..."
                : "例如：改成现代轻奢客厅，保留原户型与采光..."
            }
            className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-[var(--piveo-text)] placeholder-[var(--piveo-muted)] max-h-32 py-2.5 resize-none custom-scrollbar text-sm"
            rows={1}
            style={{ minHeight: '40px' }}
            disabled={disabled}
          />
          {/* P1-#10：示例 popover 触发按钮，hover 上去说"看示例"。新用户找不到 @图N 用法
              和起手 prompt 时，这是最自然的发现路径。 */}
          <div className="relative" ref={examplesRef}>
            <Button
              type="button"
              color="tertiary"
              size="sm"
              onClick={() => setExamplesOpen((v) => !v)}
              className="!p-2.5 !text-[var(--piveo-body)] hover:!text-[var(--piveo-text)]"
              aria-label="提示词示例"
              title="提示词示例"
            >
              <Icon name="lightbulb" />
            </Button>
            {examplesOpen && (
              <div className="absolute bottom-full mb-2 right-0 z-30 w-72 bg-white border border-[var(--piveo-border)] rounded-xl shadow-xl p-2">
                <div className="px-2 py-1.5 text-[11px] text-[var(--piveo-muted)] font-medium">
                  常用提示词模板（点击填入）
                </div>
                {EXAMPLE_PROMPTS.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => {
                      onInputChange(ex.prompt);
                      setExamplesOpen(false);
                      textareaRef.current?.focus();
                    }}
                    className="w-full text-left px-2 py-2 rounded-lg hover:bg-[#EEF2F6] transition-colors"
                  >
                    <div className="text-xs font-medium text-[var(--piveo-text)]">{ex.label}</div>
                    <div className="text-[11px] text-[var(--piveo-muted)] mt-0.5 line-clamp-2">{ex.prompt}</div>
                  </button>
                ))}
                <div className="px-2 py-1.5 text-[10px] text-[var(--piveo-muted)] border-t border-[var(--piveo-border)] mt-1">
                  小技巧：上传多张参考图后，可在提示词中写 <code className="bg-[#EEF2F6] px-1 rounded">@图1</code> <code className="bg-[#EEF2F6] px-1 rounded">@图2</code> 引用对应图片
                </div>
              </div>
            )}
          </div>
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
          {isGenerating && onCancel ? (
            // 生成中把发送按钮换成停止按钮，避免长任务把 UI 锁住，用户以为卡死了
            <Button
              type="button"
              size="sm"
              color="primary"
              onClick={onCancel}
              className="!p-2.5 !bg-red-500 !text-white hover:!bg-red-600"
              aria-label="停止生成"
              title="停止生成"
            >
              <Icon name="stop" />
            </Button>
          ) : (
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
          )}
        </div>

        {/* P2-#20：提示文案永久显示是噪音，看过一次就够了；可关闭并永久记忆 */}
        {!hintDismissed && (
          <div className="text-[10px] text-[var(--piveo-muted)] flex items-center justify-between">
            <span>回车发送，Shift+回车换行。支持粘贴图片。</span>
            <button
              type="button"
              onClick={dismissHint}
              className="text-[var(--piveo-muted)] hover:text-[var(--piveo-text)] ml-2"
              aria-label="关闭提示"
              title="不再显示"
            >
              <Icon name="times" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
