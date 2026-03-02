import React, { useState, useCallback, useRef } from 'react';
import { Icon } from './Icon';
import { Button } from '@/components/base/buttons/button';
import { Badge } from '@/components/base/badges/badges';
import type { ProductCatalogItem, BrandKit } from '@/types';

export interface OnboardingProps {
  onFileUpload: (file: File) => void;
  onPaste: () => void;
  onQuickStart: (templateName: string) => void;
  onPromptSubmit: (prompt: string) => void;
  templates: Array<{ name: string; content: string }>;
  products?: ProductCatalogItem[];
  onProductSelect?: (product: ProductCatalogItem) => void;
  activeBrandKit?: BrandKit | null;
  onSetupBrandKit?: () => void;
}

const StepIndicator: React.FC<{ current: number; total: number }> = ({ current, total }) => (
  <div className="flex items-center gap-2.5 mb-6">
    {Array.from({ length: total }, (_, i) => {
      const done = i < current;
      const active = i === current;
      return (
        <React.Fragment key={i}>
          <div
            className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold border transition-colors ${
              done || active
                ? 'bg-[var(--piveo-accent)] border-[var(--piveo-accent)] text-white'
                : 'bg-white border-[var(--piveo-border)] text-[var(--piveo-muted)]'
            }`}
          >
            {done ? <Icon name="check" className="text-[10px]" /> : i + 1}
          </div>
          {i < total - 1 && (
            <div className={`h-px flex-1 ${done ? 'bg-[var(--piveo-accent)]' : 'bg-[var(--piveo-border)]'}`} />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

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
      <h3 className="text-lg font-semibold text-[var(--piveo-text)] mb-1">上传产品图</h3>
      <p className="text-xs text-[var(--piveo-body)] mb-4">拖拽或点击上传你的产品图片</p>

      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full h-44 rounded-xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-2 transition-all ${
          isDragOver
            ? 'border-[var(--piveo-accent)] bg-[#E7ECF3]'
            : 'border-[var(--piveo-border)] bg-white hover:border-[var(--piveo-accent)]'
        }`}
      >
        <Icon name="cloud-upload-alt" className="text-3xl text-[var(--piveo-muted)]" />
        <span className="text-xs text-[var(--piveo-body)]">拖拽图片到此处，或点击上传</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileUpload(file);
          e.target.value = '';
        }}
      />

      <div className="flex items-center gap-3 mt-3">
        <Button type="button" color="secondary" size="sm" className="flex-1" onClick={onPaste}>
          <Icon name="clipboard" className="text-[10px]" />
          粘贴图片
        </Button>
      </div>

      {products && products.length > 0 && onProductSelect && (
        <div className="mt-4">
          <p className="text-[11px] text-[var(--piveo-muted)] mb-2">从产品库选择：</p>
          <div className="flex flex-wrap gap-2">
            {products.slice(0, 8).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onProductSelect(p)}
                className="w-14 h-14 rounded-lg overflow-hidden border border-[var(--piveo-border)] hover:border-[var(--piveo-accent)] transition-colors"
                title={p.name}
              >
                <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        </div>
      )}

      <Button type="button" color="tertiary" size="sm" className="w-full mt-4" onClick={onSkip}>
        跳过，直接输入描述
      </Button>
    </div>
  );
};

const Step2Style: React.FC<{
  templates: Array<{ name: string; content: string }>;
  activeBrandKit?: BrandKit | null;
  onSetupBrandKit?: () => void;
  onSelect: (templateName: string) => void;
  onBack: () => void;
}> = ({ templates, activeBrandKit, onSetupBrandKit, onSelect, onBack }) => (
  <div>
    <h3 className="text-lg font-semibold text-[var(--piveo-text)] mb-1">选择风格</h3>
    <p className="text-xs text-[var(--piveo-body)] mb-4">选择创作风格模板，或使用品牌套件</p>

    {activeBrandKit ? (
      <div className="mb-4 p-3 rounded-lg border border-[var(--piveo-border)] bg-white flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-[var(--piveo-text)]">{activeBrandKit.name}</div>
          <div className="text-xs text-[var(--piveo-muted)]">品牌规则将自动注入到提示词</div>
        </div>
        <Badge type="pill-color" size="sm" color="brand">BrandKit</Badge>
      </div>
    ) : onSetupBrandKit ? (
      <Button type="button" color="secondary" size="sm" className="w-full mb-4" onClick={onSetupBrandKit}>
        <Icon name="palette" className="text-[10px]" />
        设置品牌套件（可选）
      </Button>
    ) : null}

    <div className="grid grid-cols-2 gap-2">
      {templates.map((tpl) => (
        <button
          key={tpl.name}
          type="button"
          onClick={() => onSelect(tpl.name)}
          className="p-3 rounded-lg border border-[var(--piveo-border)] bg-white text-left hover:border-[var(--piveo-accent)] hover:bg-[#E7ECF3] transition-all"
        >
          <span className="text-sm text-[var(--piveo-text)] font-medium">{tpl.name}</span>
          <p className="text-xs text-[var(--piveo-muted)] mt-1 line-clamp-2">{tpl.content.slice(0, 60)}...</p>
        </button>
      ))}
    </div>

    <Button type="button" color="tertiary" size="sm" className="w-full mt-4" onClick={onBack}>
      <Icon name="arrow-left" className="text-[9px]" />
      返回上一步
    </Button>
  </div>
);

const Step3Generate: React.FC<{
  onSubmit: (prompt: string) => void;
  onBack: () => void;
}> = ({ onSubmit, onBack }) => {
  const [prompt, setPrompt] = useState('');

  return (
    <div>
      <h3 className="text-lg font-semibold text-[var(--piveo-text)] mb-1">描述你想要的画面</h3>
      <p className="text-xs text-[var(--piveo-body)] mb-4">输入描述后自动开始生成</p>

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
        rows={4}
        className="w-full px-3 py-2.5 rounded-lg bg-white border border-[var(--piveo-border)] text-sm text-[var(--piveo-text)] placeholder-[var(--piveo-muted)] focus:outline-none focus:border-[var(--piveo-text)] resize-none"
        autoFocus
      />

      <Button
        type="button"
        color="primary"
        size="md"
        className="w-full mt-3"
        onClick={() => prompt.trim() && onSubmit(prompt.trim())}
        isDisabled={!prompt.trim()}
      >
        <Icon name="magic" className="text-[11px]" />
        开始生成
      </Button>

      <Button type="button" color="tertiary" size="sm" className="w-full mt-2" onClick={onBack}>
        <Icon name="arrow-left" className="text-[9px]" />
        返回上一步
      </Button>
    </div>
  );
};

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
  const isReturning = (() => {
    try {
      return localStorage.getItem('topseller_onboarding_done') === 'true';
    } catch {
      return false;
    }
  })();

  const [step, setStep] = useState(0);

  const handleFileUpload = useCallback((file: File) => {
    onFileUpload(file);
    setStep(1);
  }, [onFileUpload]);

  const handleProductSelect = useCallback((product: ProductCatalogItem) => {
    onProductSelect?.(product);
    setStep(1);
  }, [onProductSelect]);

  const handleStyleSelect = useCallback((templateName: string) => {
    onQuickStart(templateName);
    setStep(2);
  }, [onQuickStart]);

  const handlePromptSubmit = useCallback((prompt: string) => {
    try {
      localStorage.setItem('topseller_onboarding_done', 'true');
    } catch {
      // ignore
    }
    onPromptSubmit(prompt);
  }, [onPromptSubmit]);

  if (isReturning) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-8">
        <div className="max-w-lg w-full rounded-2xl border border-[var(--piveo-border)] bg-[var(--piveo-card)] p-6 flex flex-col items-center gap-4">
          <Badge type="pill-color" size="sm" color="brand">Quick Start</Badge>
          <h2 className="text-lg font-semibold text-[var(--piveo-text)]">开始创作</h2>
          <p className="text-xs text-[var(--piveo-body)] text-center">上传产品图或直接输入描述</p>

          <div className="w-full">
            <textarea
              placeholder="输入描述开始生成…"
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg bg-white border border-[var(--piveo-border)] text-sm text-[var(--piveo-text)] placeholder-[var(--piveo-muted)] focus:outline-none focus:border-[var(--piveo-text)] resize-none"
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
            <div className="flex flex-wrap gap-2 justify-center">
              {templates.slice(0, 4).map((tpl) => (
                <Button
                  key={tpl.name}
                  type="button"
                  color="secondary"
                  size="sm"
                  onClick={() => onQuickStart(tpl.name)}
                >
                  {tpl.name}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8">
      <div className="max-w-xl w-full rounded-2xl border border-[var(--piveo-border)] bg-[var(--piveo-card)] p-6">
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
