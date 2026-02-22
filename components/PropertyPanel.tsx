import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AspectRatio, GeneratedImage, ModelCharacter, ProductCatalogItem, ProductImage, ProductScale, SessionSettings, SystemTemplate } from '../types';
import { getSupportedAspectRatios, getSupportedSizeForAspect } from '../services/sizeUtils';
import { generateModelCharacter } from '../services/gemini';
import { Icon } from './Icon';
import { ApiConfig } from '../services/apiConfig';
import { getModelDisplayName } from './ModelSwitcherFooter';
import { useToast } from './Toast';

interface PropertyPanelProps {
  settings: SessionSettings;
  onUpdateSettings: (next: SessionSettings) => void;
  models: ModelCharacter[];
  products: ProductCatalogItem[];
  onAddModel: (model: ModelCharacter) => void;
  onDeleteModel: (modelId: string) => void;
  templates: SystemTemplate[];
  onSaveTemplate: (template: SystemTemplate) => void;
  apiConfig: ApiConfig;
  onUpdateApiConfig: (cfg: ApiConfig) => void;
  selectedImage: string | null;
  onClearSelectedImage: () => void;
  // Image detail mode
  selectedGalleryImage?: GeneratedImage | null;
  onClearGalleryImage?: () => void;
  onGalleryImageAction?: (image: GeneratedImage, action: string) => void;
}

/* ── Collapsible Section ── */
const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}> = ({ title, children, defaultExpanded = true }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="border-b border-dark-700">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-dark-800/50 transition-colors"
      >
        <span className="text-[11px] font-semibold text-gray-300 tracking-wide">{title}</span>
        <Icon name={expanded ? "chevron-up" : "chevron-down"} className="text-gray-500 text-[10px]" />
      </button>
      {expanded && (
        <div className="px-4 pb-3">
          {children}
        </div>
      )}
    </div>
  );
};

/* ── Image Detail View ── */
const ImageDetailView: React.FC<{
  image: GeneratedImage;
  onBack: () => void;
  onAction: (action: string) => void;
}> = ({ image, onBack, onAction }) => {
  const [promptCopied, setPromptCopied] = useState(false);

  const createdDate = new Date(image.createdAt);
  const dateStr = `${String(createdDate.getMonth() + 1).padStart(2, '0')}-${String(createdDate.getDate()).padStart(2, '0')} ${String(createdDate.getHours()).padStart(2, '0')}:${String(createdDate.getMinutes()).padStart(2, '0')}`;

  const handleCopyPrompt = () => {
    if (!image.prompt) return;
    navigator.clipboard.writeText(image.prompt).then(() => {
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar bg-dark-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-dark-700 flex items-center gap-2">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-200 transition-colors"
          title="返回设置"
        >
          <Icon name="arrow-left" className="text-xs" />
        </button>
        <span className="text-xs font-bold text-gray-300 tracking-wider">图片详情</span>
        <span className="text-[10px] text-gray-500 ml-auto">{dateStr}</span>
      </div>

      {/* Large preview */}
      <div className="px-4 py-3">
        {image.imageUrl ? (
          <div className="relative rounded-lg overflow-hidden border border-dark-600 bg-dark-800 cursor-pointer" onClick={() => onAction('preview')}>
            <img
              src={image.imageUrl}
              alt={image.prompt || '图片'}
              className="w-full object-contain max-h-[300px]"
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : (
          <div className="w-full h-40 rounded-lg bg-dark-800 border border-dark-600 flex items-center justify-center">
            <Icon name="image" className="text-3xl text-gray-600" />
          </div>
        )}
      </div>

      {/* Primary action: batch from image */}
      {image.source !== 'batch' && (
        <div className="px-4 pb-2">
          <button
            onClick={() => onAction('batch-from-image')}
            className="w-full h-9 rounded-lg border border-banana-500 bg-banana-500/20 text-xs text-banana-300 font-semibold hover:bg-banana-500/30 transition-colors flex items-center justify-center gap-2"
          >
            <Icon name="layer-group" className="text-[11px]" />
            一键出套图
          </button>
        </div>
      )}

      {/* Quick actions */}
      <div className="px-4 pb-3">
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => onAction('download')}
            className="h-8 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:text-gray-100 hover:border-gray-500 transition-colors flex items-center justify-center gap-1.5"
          >
            <Icon name="download" className="text-[10px] text-gray-500" />
            下载
          </button>
          <button
            onClick={() => onAction('mask-edit')}
            className="h-8 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:text-gray-100 hover:border-gray-500 transition-colors flex items-center justify-center gap-1.5"
          >
            <Icon name="paint-brush" className="text-[10px] text-gray-500" />
            编辑
          </button>
          <button
            onClick={() => onAction('variation')}
            className="h-8 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:text-gray-100 hover:border-gray-500 transition-colors flex items-center justify-center gap-1.5"
          >
            <Icon name="clone" className="text-[10px] text-gray-500" />
            变体
          </button>
          <button
            onClick={() => onAction('set-reference')}
            className="h-8 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:text-gray-100 hover:border-gray-500 transition-colors flex items-center justify-center gap-1.5"
          >
            <Icon name="crosshairs" className="text-[10px] text-gray-500" />
            参考图
          </button>
          <button
            onClick={() => onAction('preview')}
            className="h-8 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:text-gray-100 hover:border-gray-500 transition-colors flex items-center justify-center gap-1.5"
          >
            <Icon name="eye" className="text-[10px] text-gray-500" />
            大图
          </button>
          <button
            onClick={handleCopyPrompt}
            className="h-8 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:text-gray-100 hover:border-gray-500 transition-colors flex items-center justify-center gap-1.5"
          >
            <Icon name="copy" className="text-[10px] text-gray-500" />
            {promptCopied ? '已复制' : '复制词'}
          </button>
        </div>
      </div>

      {/* Prompt */}
      {image.prompt && (
        <div className="px-4 pb-3">
          <div className="text-[11px] text-gray-500 mb-1">提示词</div>
          <p className="text-[11px] text-gray-300 leading-relaxed bg-dark-800 rounded-lg p-2.5 border border-dark-600 max-h-[100px] overflow-y-auto custom-scrollbar">
            {image.prompt}
          </p>
        </div>
      )}

      {/* Batch scene info */}
      {image.source === 'batch' && (image.slotTitle || image.jobId) && (
        <div className="px-4 pb-3">
          {image.slotTitle && (
            <div className="text-[11px] text-gray-400 mb-1.5">
              场景：{image.slotTitle}
            </div>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={() => onAction('batch-rerun-slot')}
              className="flex-1 h-8 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:text-gray-100 hover:border-gray-500 transition-colors flex items-center justify-center gap-1.5"
            >
              <Icon name="redo" className="text-[10px] text-gray-500" />
              重新生成
            </button>
            <button
              onClick={() => onAction('batch-view-job')}
              className="flex-1 h-8 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:text-gray-100 hover:border-gray-500 transition-colors flex items-center justify-center gap-1.5"
            >
              <Icon name="layer-group" className="text-[10px] text-gray-500" />
              查看套图
            </button>
          </div>
        </div>
      )}

      {/* Delete */}
      <div className="px-4 pb-4 mt-auto">
        <button
          onClick={() => onAction('delete')}
          className="w-full h-8 rounded-md border border-dark-700 text-[11px] text-gray-500 hover:text-red-400 hover:border-red-900/50 transition-colors flex items-center justify-center gap-1.5"
        >
          <Icon name="trash-alt" className="text-[10px]" />
          删除
        </button>
      </div>
    </div>
  );
};

/* ── Library Picker Popover ── */
const LibraryPicker: React.FC<{
  items: Array<{ id: string; name: string; imageUrl: string }>;
  onSelect: (item: { id: string; name: string; imageUrl: string }) => void;
  onClose: () => void;
  emptyText: string;
}> = ({ items, onSelect, onClose, emptyText }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-0 right-0 top-full mt-1 z-50 bg-dark-800 border border-dark-600 rounded-lg shadow-xl max-h-52 overflow-y-auto custom-scrollbar"
    >
      {items.length === 0 ? (
        <p className="text-[10px] text-gray-500 text-center py-4">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5 p-2">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => { onSelect(item); onClose(); }}
              className="group relative rounded-md overflow-hidden border border-dark-600 hover:border-banana-500 transition-colors aspect-square bg-dark-900"
              title={item.name}
            >
              <img
                src={item.imageUrl}
                alt={item.name}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
              <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] text-gray-300 truncate px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {item.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const PropertyPanelInner: React.FC<PropertyPanelProps> = ({
  settings,
  onUpdateSettings,
  models,
  products,
  onAddModel,
  onDeleteModel,
  templates,
  onSaveTemplate,
  apiConfig,
  onUpdateApiConfig,
  selectedImage,
  onClearSelectedImage,
  selectedGalleryImage,
  onClearGalleryImage,
  onGalleryImageAction,
}) => {
  const [isGeneratingModel, setIsGeneratingModel] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  const handleSaveAsTemplate = () => {
    const name = newTemplateName.trim();
    const content = settings.systemPrompt?.trim();
    if (!name || !content) return;
    onSaveTemplate({ id: uuidv4(), name, content });
    setSavingTemplate(false);
    setNewTemplateName('');
    addToast({ type: 'success', message: `模板「${name}」已保存` });
  };

  const selectModel = (id: string | null) => {
    const newId = id === settings.selectedModelId ? null : id;
    const updates: Partial<SessionSettings> = { selectedModelId: newId };
    if (newId !== null && settings.autoUseLastImage) {
      updates.autoUseLastImage = false;
    }
    onUpdateSettings({ ...settings, ...updates });
  };

  const genModel = async () => {
    setIsGeneratingModel(true);
    try {
      const imageUrl = await generateModelCharacter();
      const model: ModelCharacter = {
        id: uuidv4(),
        name: `AI 模特 ${models.length + 1}`,
        imageUrl,
      };
      onAddModel(model);
      selectModel(model.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addToast({ type: 'error', message: `生成模特失败：${msg}` });
    } finally {
      setIsGeneratingModel(false);
    }
  };

  const uploadModel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const model: ModelCharacter = {
        id: uuidv4(),
        name: `自定义模特 ${models.length + 1}`,
        imageUrl: reader.result as string,
      };
      onAddModel(model);
      selectModel(model.id);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const uploadProduct = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const product: ProductImage = {
        id: uuidv4(),
        imageUrl: reader.result as string,
        createdAt: Date.now(),
      };
      onUpdateSettings({ ...settings, productImage: product });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removeProduct = () => {
    if (window.confirm('确定要删除产品图吗？')) {
      onUpdateSettings({ ...settings, productImage: null });
    }
  };

  const selectedModel = settings.selectedModelId
    ? models.find((m) => m.id === settings.selectedModelId)
    : null;

  // Image detail mode: show image details instead of settings
  if (selectedGalleryImage && onClearGalleryImage && onGalleryImageAction) {
    return (
      <ImageDetailView
        image={selectedGalleryImage}
        onBack={onClearGalleryImage}
        onAction={(action) => onGalleryImageAction(selectedGalleryImage, action)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar bg-dark-900">
      <div className="px-4 py-3 border-b border-dark-700">
        <span className="text-xs font-bold text-gray-300 tracking-wider">创作设置</span>
      </div>

      {/* Product Image */}
      <Section title="产品图">
        {settings.productImage ? (
          <div className="relative inline-block">
            <img
              src={settings.productImage.imageUrl}
              alt="产品图"
              className="w-full max-h-32 rounded-lg border border-banana-500/50 object-contain bg-dark-800"
              loading="lazy"
              decoding="async"
            />
            <button
              onClick={removeProduct}
              className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] shadow-md hover:bg-red-600"
              title="删除产品图"
            >
              <Icon name="times" />
            </button>
          </div>
        ) : (
          <div
            onClick={() => productInputRef.current?.click()}
            className="w-full h-20 rounded-lg border-2 border-dashed border-dark-600 bg-dark-800/50 flex flex-col items-center justify-center cursor-pointer hover:border-gray-500 transition-colors"
          >
            <Icon name="box-open" className="text-gray-500 text-lg mb-1" />
            <span className="text-[10px] text-gray-500">点击上传产品图</span>
          </div>
        )}
        <div className="relative mt-2 flex gap-2">
          <button
            onClick={() => productInputRef.current?.click()}
            className="flex-1 h-7 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:text-gray-100 hover:border-gray-500 transition-colors flex items-center justify-center gap-1"
          >
            <Icon name="upload" className="text-[9px]" />
            上传
          </button>
          <button
            onClick={() => setShowProductPicker((v) => !v)}
            className={`flex-1 h-7 rounded-md border text-[11px] transition-colors flex items-center justify-center gap-1 ${
              showProductPicker
                ? "border-banana-500 bg-banana-500/10 text-banana-400"
                : "border-dark-600 bg-dark-800 text-gray-300 hover:text-gray-100 hover:border-gray-500"
            }`}
          >
            <Icon name="box-open" className="text-[9px]" />
            产品库
          </button>
          {showProductPicker && (
            <LibraryPicker
              items={products}
              onSelect={(p) => {
                onUpdateSettings({
                  ...settings,
                  productImage: { id: p.id, imageUrl: p.imageUrl, createdAt: Date.now() },
                });
              }}
              onClose={() => setShowProductPicker(false)}
              emptyText="产品库为空，请先添加产品"
            />
          )}
        </div>
        <input ref={productInputRef} type="file" accept="image/*" className="hidden" onChange={uploadProduct} />
      </Section>

      {/* Model Character */}
      <Section title="模特">
        <div className="flex flex-wrap gap-1.5 mb-2">
          <button
            onClick={() => selectModel(null)}
            className={`h-10 w-10 shrink-0 rounded-lg border flex items-center justify-center transition-colors text-[10px] ${
              settings.selectedModelId === null
                ? "border-banana-500 bg-banana-500/10 text-banana-500"
                : "border-dark-600 bg-dark-800 text-gray-500 hover:border-gray-400"
            }`}
            title="不锁定人物"
          >
            <Icon name="ban" />
          </button>
          {models.map((m) => (
            <div key={m.id} className="relative shrink-0">
              <button
                onClick={() => selectModel(m.id)}
                className={`relative h-10 w-10 rounded-lg overflow-hidden border transition-colors ${
                  settings.selectedModelId === m.id
                    ? "border-banana-500"
                    : "border-dark-600 hover:border-gray-400"
                }`}
                title={m.name}
              >
                <img src={m.imageUrl} alt={m.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`确定要删除模特"${m.name}"吗？`)) {
                    onDeleteModel(m.id);
                  }
                }}
                className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] shadow-md hover:bg-red-600"
                title={`删除${m.name}`}
              >
                <Icon name="times" />
              </button>
            </div>
          ))}
        </div>
        <div className="relative flex gap-2">
          <button
            onClick={genModel}
            disabled={isGeneratingModel}
            className="flex-1 h-7 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-banana-400 hover:border-gray-500 hover:bg-dark-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <Icon name={isGeneratingModel ? "spinner" : "magic"} className={isGeneratingModel ? "fa-spin" : ""} />
            AI生成
          </button>
          <button
            onClick={() => modelInputRef.current?.click()}
            className="flex-1 h-7 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:border-gray-500 hover:bg-dark-700 transition-colors flex items-center justify-center gap-1"
          >
            <Icon name="upload" />
            上传
          </button>
        </div>
        {models.length > 6 && (
          <div className="relative mt-1.5">
            <button
              onClick={() => setShowModelPicker((v) => !v)}
              className={`w-full h-7 rounded-md border text-[11px] transition-colors flex items-center justify-center gap-1 ${
                showModelPicker
                  ? "border-banana-500 bg-banana-500/10 text-banana-400"
                  : "border-dark-600 bg-dark-800 text-gray-300 hover:text-gray-100 hover:border-gray-500"
              }`}
            >
              <Icon name="users" className="text-[9px]" />
              查看全部模特 ({models.length})
            </button>
            {showModelPicker && (
              <LibraryPicker
                items={models}
                onSelect={(m) => selectModel(m.id)}
                onClose={() => setShowModelPicker(false)}
                emptyText="模特库为空"
              />
            )}
          </div>
        )}
        <input ref={modelInputRef} type="file" accept="image/*" className="hidden" onChange={uploadModel} />
      </Section>

      {/* Aspect Ratio */}
      <Section title="画幅比例">
        <div className="grid grid-cols-3 gap-1.5">
          {getSupportedAspectRatios().map((ratio) => (
            <button
              key={ratio}
              onClick={() => onUpdateSettings({ ...settings, aspectRatio: ratio as AspectRatio, batchSizes: [getSupportedSizeForAspect(ratio)] })}
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
      </Section>

      {/* Product Scale */}
      <Section title="产品显眼度">
        <div className="flex gap-2">
          {([
            [ProductScale.Small, "低调"],
            [ProductScale.Standard, "平衡"],
            [ProductScale.Large, "突出"],
          ] as const).map(([scale, label]) => (
            <button
              key={scale}
              onClick={() => onUpdateSettings({ ...settings, productScale: scale })}
              className={`flex-1 h-8 rounded-lg border text-[10px] font-semibold transition-colors ${
                settings.productScale === scale
                  ? "bg-banana-500 text-dark-900 border-banana-500"
                  : "bg-dark-700 text-gray-300 border-dark-600 hover:border-gray-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      {/* Style Template */}
      <Section title="风格模板">
        <select
          value={templates.findIndex((t) => t.content === settings.systemPrompt)}
          onChange={(e) => {
            const idx = Number(e.target.value);
            if (idx >= 0 && idx < templates.length) {
              onUpdateSettings({ ...settings, systemPrompt: templates[idx].content });
            }
          }}
          className="w-full h-8 bg-dark-800 border border-dark-600 rounded-md px-2 text-[11px] text-gray-200 focus:outline-none focus:border-banana-500/50 cursor-pointer mb-2"
        >
          <option value={-1}>自定义</option>
          {templates.map((t, i) => (
            <option key={t.id} value={i}>{t.name}</option>
          ))}
        </select>
        <textarea
          value={settings.systemPrompt || ''}
          onChange={(e) => onUpdateSettings({ ...settings, systemPrompt: e.target.value })}
          placeholder="在这里输入摄影师要求、风格描述…"
          rows={5}
          className="w-full bg-dark-800 border border-dark-600 rounded-md px-2.5 py-2 text-[11px] text-gray-200 focus:outline-none focus:border-banana-500/50 resize-y placeholder-gray-600 leading-relaxed"
        />
        {savingTemplate ? (
          <div className="flex gap-1 mt-1.5">
            <input
              type="text"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveAsTemplate();
                if (e.key === 'Escape') { setSavingTemplate(false); setNewTemplateName(''); }
              }}
              placeholder="输入模板名称"
              className="flex-1 h-7 px-2 bg-dark-800 border border-banana-500/40 rounded-md text-[11px] text-gray-200 focus:outline-none focus:border-banana-500 placeholder-gray-600"
              autoFocus
            />
            <button
              onClick={handleSaveAsTemplate}
              className="h-7 px-2 rounded-md bg-banana-500/20 border border-banana-500/40 text-banana-400 text-[11px] hover:bg-banana-500/30 transition-colors"
            >
              保存
            </button>
            <button
              onClick={() => { setSavingTemplate(false); setNewTemplateName(''); }}
              className="h-7 px-2 rounded-md bg-dark-700 border border-dark-600 text-gray-400 text-[11px] hover:bg-dark-600 transition-colors"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSavingTemplate(true)}
            disabled={!settings.systemPrompt?.trim()}
            className="mt-1.5 w-full h-7 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors disabled:opacity-40"
          >
            另存为模板
          </button>
        )}
      </Section>

      {/* Generation Count */}
      <Section title="生成数量">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={10}
            value={settings.batchCount}
            onChange={(e) => onUpdateSettings({ ...settings, batchCount: Number(e.target.value) })}
            className="flex-1 accent-banana-500"
          />
          <span className="text-[12px] text-gray-300 w-6 text-center font-medium">{settings.batchCount}</span>
        </div>
        <p className="mt-1 text-[10px] text-gray-500">每次生成 {settings.batchCount} 张图片</p>
      </Section>

      {/* Continuous Edit */}
      <Section title="连续编辑" defaultExpanded={false}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-300">自动沿用上一张结果</span>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoUseLastImage}
              onChange={(e) => {
                const next = { ...settings, autoUseLastImage: e.target.checked };
                if (e.target.checked && next.selectedModelId !== null) {
                  next.selectedModelId = null;
                }
                onUpdateSettings(next);
              }}
              className="h-4 w-4 accent-banana-500"
            />
          </label>
        </div>
        <p className="mt-1 text-[10px] text-gray-500">
          {settings.autoUseLastImage
            ? "已开启：每次会自动沿用上一张结果做连续微调。"
            : "已关闭：每次都按当前提示词重新生成。"}
        </p>
      </Section>

      {/* Reference Image */}
      {selectedImage && (
        <Section title="参考图">
          <div className="relative inline-block">
            <img
              src={selectedImage}
              alt="参考图"
              className="w-full max-h-24 rounded-lg border border-emerald-500/50 object-contain bg-dark-800"
              loading="lazy"
              decoding="async"
            />
            <button
              onClick={onClearSelectedImage}
              className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] shadow-md hover:bg-red-600"
              title="清除参考图"
            >
              <Icon name="times" />
            </button>
          </div>
        </Section>
      )}

      {/* Separator */}
      <div className="border-t border-dark-600 my-1" />

      {/* Model Selection */}
      <Section title="模型选择" defaultExpanded={false}>
        <select
          value={apiConfig.defaultImageModel}
          onChange={(e) => onUpdateApiConfig({ ...apiConfig, defaultImageModel: e.target.value })}
          className="w-full h-8 bg-dark-800 border border-dark-600 rounded-md px-2 text-[11px] text-gray-200 focus:outline-none focus:border-banana-500/50 cursor-pointer"
        >
          <option value={apiConfig.defaultImageModel}>{getModelDisplayName(apiConfig.defaultImageModel)}</option>
        </select>
        <p className="mt-1 text-[10px] text-gray-500">当前：{getModelDisplayName(apiConfig.defaultImageModel)}</p>
      </Section>
    </div>
  );
};

export const PropertyPanel = React.memo(PropertyPanelInner, (prev, next) =>
  prev.settings === next.settings &&
  prev.models === next.models &&
  prev.products === next.products &&
  prev.templates === next.templates &&
  prev.apiConfig === next.apiConfig &&
  prev.selectedImage === next.selectedImage &&
  prev.selectedGalleryImage === next.selectedGalleryImage
);
