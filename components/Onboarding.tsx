import React, { useState, useCallback, useRef } from 'react';
import { Icon } from './Icon';
import type { ProductCatalogItem, BrandKit } from '@/types';

export interface OnboardingProps {
  onFileUpload: (file: File) => void;
  onPaste: () => void;
  onQuickStart: (templateName: string) => void;
  onPromptSubmit: (prompt: string) => void;
  templates: Array<{ name: string; content: string }>;
  // Extended props for 3-step flow
  products?: ProductCatalogItem[];
  onProductSelect?: (product: ProductCatalogItem) => void;
  activeBrandKit?: BrandKit | null;
  onSetupBrandKit?: () => void;
}

/* ── Step Indicator ── */
const StepIndicator: React.FC<{ current: number; total: number }> = ({ current, total }) => (
  <div className="flex items-center gap-2 mb-6">
    {Array.from({ length: total }, (_, i) => (
      <React.Fragment key={i}>
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors ${
          i < current
            ? 'bg-banana-500 text-dark-900'
            : i === current
            ? 'bg-banana-500/20 border-2 border-banana-500 text-banana-400'
            : 'bg-dark-700 text-gray-500'
        }`}>
          {i < current ? <Icon name="check" className="text-[10px]" /> : i + 1}
        </div>
        {i < total - 1 && (
          <div className={`flex-1 h-0.5 rounded transition-colors ${
            i < current ? 'bg-banana-500' : 'bg-dark-600'
          }`} />
        )}
      </React.Fragment>
    ))}
  </div>
);

/* ── Step 1: Upload Product ── */
const Step1Upload: React.FC<{
  onFileUpload: (file: File) => void;
  onPaste: () => void;
  products?: ProductCatalogItem[];
  onProductSelect?: (product: ProductCatalogItem) => void;
  onSkip: () => void;
}> = ({ onFileUpload, onPaste, products, onProductSelect, onSkip }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) onFileUpload(file);
  }, [onFileUpload]);

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-200 mb-1">上传产品图</h3>
      <p className="text-[11px] text-gray-500 mb-4">拖拽或点击上传你的产品图片</p>

      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full h-40 rounded-xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-2 transition-all ${
          isDragOver
            ? 'border-banana-500 bg-banana-500/5'
            : 'border-dark-600 bg-dark-800/50 hover:border-gray-500'
        }`}
      >
        <Icon name="cloud-upload-alt" className="text-3xl text-gray-500" />
        <span className="text-[12px] text-gray-400">拖拽图片到此处，或点击上传</span>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) onFileUpload(file);
        e.target.value = '';
      }} />

      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={onPaste}
          className="flex-1 h-9 rounded-lg border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:border-gray-500 transition-colors flex items-center justify-center gap-1.5"
        >
          <Icon name="clipboard" className="text-[10px]" />
          粘贴图片
        </button>
      </div>

      {/* Product library quick select */}
      {products && products.length > 0 && onProductSelect && (
        <div className="mt-4">
          <p className="text-[10px] text-gray-500 mb-1.5">从产品库选择：</p>
          <div className="flex flex-wrap gap-1.5">
            {products.slice(0, 8).map((p) => (
              <button
                key={p.id}
                onClick={() => onProductSelect(p)}
                className="w-14 h-14 rounded-lg overflow-hidden border border-dark-600 hover:border-banana-500 transition-colors"
                title={p.name}
              >
                <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onSkip}
        className="w-full mt-4 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        跳过，直接输入描述
      </button>
    </div>
  );
};

/* ── Step 2: Choose Style ── */
const Step2Style: React.FC<{
  templates: Array<{ name: string; content: string }>;
  activeBrandKit?: BrandKit | null;
  onSetupBrandKit?: () => void;
  onSelect: (templateName: string) => void;
  onBack: () => void;
}> = ({ templates, activeBrandKit, onSetupBrandKit, onSelect, onBack }) => (
  <div>
    <h3 className="text-base font-semibold text-gray-200 mb-1">选择风格</h3>
    <p className="text-[11px] text-gray-500 mb-4">选择创作风格模板，或使用品牌套件</p>

    {/* Brand Kit option */}
    {activeBrandKit ? (
      <div className="mb-4 p-3 rounded-lg border border-banana-500/30 bg-banana-500/5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-banana-500" />
          <span className="text-[11px] text-banana-400 font-medium">品牌套件：{activeBrandKit.name}</span>
        </div>
        <p className="text-[10px] text-gray-500">品牌 DNA 将自动注入生成</p>
      </div>
    ) : onSetupBrandKit ? (
      <button
        onClick={onSetupBrandKit}
        className="w-full mb-4 h-10 rounded-lg border border-dashed border-dark-500 bg-dark-800/50 text-[11px] text-gray-400 hover:border-banana-500/50 hover:text-banana-400 transition-colors flex items-center justify-center gap-1.5"
      >
        <Icon name="palette" className="text-[10px]" />
        设置品牌套件（可选）
      </button>
    ) : null}

    {/* Template cards */}
    <div className="grid grid-cols-2 gap-2">
      {templates.map((tpl) => (
        <button
          key={tpl.name}
          onClick={() => onSelect(tpl.name)}
          className="p-3 rounded-lg border border-dark-600 bg-dark-800 text-left hover:border-banana-500/40 hover:bg-banana-500/5 transition-all group"
        >
          <span className="text-[12px] text-gray-200 font-medium group-hover:text-banana-400">{tpl.name}</span>
          <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{tpl.content.slice(0, 60)}...</p>
        </button>
      ))}
    </div>

    <button
      onClick={onBack}
      className="w-full mt-4 text-[11px] text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center gap-1"
    >
      <Icon name="arrow-left" className="text-[9px]" />
      返回上一步
    </button>
  </div>
);

/* ── Step 3: Generate (auto-transition) ── */
const Step3Generate: React.FC<{
  onSubmit: (prompt: string) => void;
  onBack: () => void;
}> = ({ onSubmit, onBack }) => {
  const [prompt, setPrompt] = useState('');

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-200 mb-1">描述你想要的画面</h3>
      <p className="text-[11px] text-gray-500 mb-4">输入描述后自动开始生成</p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (prompt.trim()) onSubmit(prompt.trim());
          }
        }}
        placeholder="例如：一位年轻模特穿着产品，站在极简白色背景前，棚拍光线..."
        rows={3}
        className="w-full px-3 py-2.5 rounded-lg bg-dark-800 border border-dark-600 text-[12px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500/50 resize-none"
        autoFocus
      />

      <button
        onClick={() => prompt.trim() && onSubmit(prompt.trim())}
        disabled={!prompt.trim()}
        className="w-full mt-3 h-10 rounded-lg bg-banana-500 text-dark-900 text-[13px] font-semibold hover:bg-banana-400 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
      >
        <Icon name="magic" className="text-[11px]" />
        开始生成
      </button>

      <button
        onClick={onBack}
        className="w-full mt-2 text-[11px] text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center gap-1"
      >
        <Icon name="arrow-left" className="text-[9px]" />
        返回上一步
      </button>
    </div>
  );
};

/* ── Main Onboarding ── */
export const Onboarding: React.FC<OnboardingProps> = ({
  onFileUpload,
  onPaste,
  onQuickStart,
  onPromptSubmit,
  templates,
  products,
  onProductSelect,
  activeBrandKit,
  onSetupBrandKit,
}) => {
  // Check if simplified mode (returning user)
  const isReturning = (() => {
    try {
      return localStorage.getItem('topseller_onboarding_done') === 'true';
    } catch { return false; }
  })();

  const [step, setStep] = useState(0);

  const handleFileUpload = useCallback((file: File) => {
    onFileUpload(file);
    setStep(1); // advance to style selection
  }, [onFileUpload]);

  const handleProductSelect = useCallback((product: ProductCatalogItem) => {
    onProductSelect?.(product);
    setStep(1);
  }, [onProductSelect]);

  const handleStyleSelect = useCallback((templateName: string) => {
    onQuickStart(templateName);
    setStep(2); // advance to prompt
  }, [onQuickStart]);

  const handlePromptSubmit = useCallback((prompt: string) => {
    try {
      localStorage.setItem('topseller_onboarding_done', 'true');
    } catch {}
    onPromptSubmit(prompt);
  }, [onPromptSubmit]);

  // Simplified mode for returning users
  if (isReturning) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-8">
        <div className="max-w-md w-full flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-banana-500/10 flex items-center justify-center">
            <Icon name="bolt" className="text-xl text-banana-400" />
          </div>
          <h2 className="text-base font-semibold text-gray-200">开始创作</h2>
          <p className="text-[11px] text-gray-500 text-center">上传产品图或直接输入描述</p>

          <div className="w-full relative">
            <textarea
              placeholder="输入描述开始生成…"
              rows={2}
              className="w-full px-3 py-2.5 pr-10 rounded-lg bg-dark-800 border border-dark-600 text-[12px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500/50 resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const val = (e.target as HTMLTextAreaElement).value.trim();
                  if (val) handlePromptSubmit(val);
                }
              }}
            />
          </div>

          {templates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-center">
              {templates.slice(0, 4).map((tpl) => (
                <button
                  key={tpl.name}
                  onClick={() => onQuickStart(tpl.name)}
                  className="px-2.5 py-1 rounded-md bg-dark-800 border border-dark-600 text-[10px] text-gray-400 hover:border-banana-500/40 hover:text-banana-400 transition-all"
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Full 3-step onboarding
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8">
      <div className="max-w-md w-full">
        <StepIndicator current={step} total={3} />

        {step === 0 && (
          <Step1Upload
            onFileUpload={handleFileUpload}
            onPaste={onPaste}
            products={products}
            onProductSelect={handleProductSelect}
            onSkip={() => setStep(2)}
          />
        )}

        {step === 1 && (
          <Step2Style
            templates={templates}
            activeBrandKit={activeBrandKit}
            onSetupBrandKit={onSetupBrandKit}
            onSelect={handleStyleSelect}
            onBack={() => setStep(0)}
          />
        )}

        {step === 2 && (
          <Step3Generate
            onSubmit={handlePromptSubmit}
            onBack={() => setStep(step > 1 ? 1 : 0)}
          />
        )}
      </div>
    </div>
  );
};
