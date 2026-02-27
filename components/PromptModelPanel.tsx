import React, { useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { AspectRatio, ModelCharacter, ProductImage, ProductScale, SessionSettings } from "../types";
import { generateModelCharacter } from "../services/gemini";
import { getSupportedAspectRatios, getSupportedSizeForAspect } from "../services/sizeUtils";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

interface PromptModelPanelProps {
  settings: SessionSettings;
  onUpdateSettings: (next: SessionSettings) => void;
  models: ModelCharacter[];
  onAddModel: (model: ModelCharacter) => void;
  onDeleteModel?: (modelId: string) => void;
  onOpenBatchSet?: () => void;
}

const PromptModelPanelInner: React.FC<PromptModelPanelProps> = ({
  settings,
  onUpdateSettings,
  models,
  onAddModel,
  onDeleteModel,
  onOpenBatchSet,
}) => {
  const [isGeneratingModel, setIsGeneratingModel] = useState(false);
  const [awaitingProductPaste, setAwaitingProductPaste] = useState(false);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const productSlotRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();

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

  const setProductFromDataUrl = (dataUrl: string) => {
    const product: ProductImage = {
      id: uuidv4(),
      imageUrl: dataUrl,
      createdAt: Date.now(),
    };
    setAwaitingProductPaste(false);
    onUpdateSettings({ ...settings, productImage: product });
  };

  const uploadProduct = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAwaitingProductPaste(false);
    const reader = new FileReader();
    reader.onloadend = () => setProductFromDataUrl(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleProductPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onloadend = () => setProductFromDataUrl(reader.result as string);
          reader.readAsDataURL(file);
          return;
        }
      }
    }
  };

  const removeProduct = () => {
    if (window.confirm('确定要删除产品图吗？')) {
      setAwaitingProductPaste(false);
      onUpdateSettings({ ...settings, productImage: null });
    }
  };

  const primeProductPaste = () => {
    setAwaitingProductPaste(true);
    productSlotRef.current?.focus();
  };

  const selectedModel = settings.selectedModelId
    ? models.find((m) => m.id === settings.selectedModelId)
    : null;
  const workflowMode = selectedModel
    ? "锁定模特"
    : settings.autoUseLastImage
      ? "连续编辑"
      : "全新生成";
  const workflowHint = selectedModel
    ? "已锁定人物参考，适合保持人物一致并反复改背景/配件。"
    : settings.autoUseLastImage
      ? "每次会自动沿用上一张结果，适合连续微调同一张图。"
      : "每次都按当前提示词重新生成，适合探索新方向。";

  return (
    <div className="w-full rounded-xl border border-dark-700 bg-dark-900/40 px-3 py-2">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="flex flex-col gap-1.5 rounded-lg border border-dark-700 bg-dark-800/50 px-2.5 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-400 shrink-0">产品</span>
              <div
                ref={productSlotRef}
                role="button"
                aria-label="产品图输入位"
                tabIndex={0}
                onFocus={() => setAwaitingProductPaste(true)}
                onBlur={() => setAwaitingProductPaste(false)}
                onPaste={handleProductPaste}
                onClick={() => !settings.productImage && productInputRef.current?.click()}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !settings.productImage) {
                    e.preventDefault();
                    productInputRef.current?.click();
                  }
                }}
                className={`relative h-10 w-10 shrink-0 rounded-lg border transition-colors outline-none focus-visible:ring-2 ${
                  settings.productImage
                    ? "border-banana-500/70 focus-visible:ring-banana-500/60"
                    : awaitingProductPaste
                      ? "border-banana-500 bg-banana-500/10 focus-visible:ring-banana-500"
                      : "cursor-pointer border-dark-600 bg-dark-800/70 hover:border-gray-500 focus-visible:ring-banana-500/60"
                }`}
                title={settings.productImage ? "产品图已设置" : "点击上传或粘贴产品图"}
              >
                {settings.productImage ? (
                  <>
                    <img
                      src={settings.productImage.imageUrl}
                      alt="产品图"
                      className="w-10 h-10 rounded-lg border border-banana-500 object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); removeProduct(); }}
                      className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] shadow-md"
                      title="删除产品图"
                    >
                      <Icon name="times" />
                    </button>
                  </>
                ) : (
                  <div className="h-full w-full rounded-lg flex items-center justify-center text-gray-500">
                    <Icon name="box-open" className="text-xs" />
                  </div>
                )}
              </div>
              <button
                onClick={() => productInputRef.current?.click()}
                className="h-8 px-2.5 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:text-gray-100 hover:border-gray-500 transition-colors"
                title={settings.productImage ? "更换产品图" : "上传产品图"}
              >
                {settings.productImage ? "更换" : "上传"}
              </button>
              <button
                onClick={primeProductPaste}
                className={`h-8 px-2.5 rounded-md border text-[11px] transition-colors ${
                  awaitingProductPaste
                    ? "border-banana-500/40 bg-banana-500/10 text-banana-400"
                    : "border-dark-600 bg-dark-800 text-gray-300 hover:text-gray-100 hover:border-gray-500"
                }`}
                title="粘贴产品图"
              >
                粘贴产品
              </button>
              <input ref={productInputRef} type="file" accept="image/*" className="hidden" onChange={uploadProduct} />
            </div>
            <p className={`text-[10px] leading-relaxed ${
              awaitingProductPaste ? "text-banana-400" : "text-gray-500"
            }`}>
              {settings.productImage
                ? "产品图已就绪，可继续更换；也可先点“粘贴产品”后按 Cmd/Ctrl + V 覆盖。"
                : awaitingProductPaste
                  ? "现在直接按 Cmd/Ctrl + V 即可把剪贴板图片放进产品位。"
                  : "先点“上传”选择文件，或点“粘贴产品”后按 Cmd/Ctrl + V。"}
            </p>
          </div>

          <div className="hidden sm:block w-px h-7 bg-dark-600" />

          <div className="flex items-center gap-2 rounded-lg border border-dark-700 bg-dark-800/50 px-2.5 py-1.5">
            <span className="text-[11px] text-gray-400 shrink-0">模特</span>
            <div className="flex gap-1.5 overflow-x-auto custom-scrollbar max-w-[320px] sm:max-w-[420px]">
              <button
                onClick={() => selectModel(null)}
                className={`h-10 w-10 shrink-0 rounded-lg border flex items-center justify-center transition-colors text-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-banana-500/60 ${
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
                    className={`relative h-10 w-10 rounded-lg overflow-hidden border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-banana-500/60 ${
                      settings.selectedModelId === m.id
                        ? "border-banana-500"
                        : "border-dark-600 hover:border-gray-400"
                    }`}
                    title={m.name}
                  >
                    <img src={m.imageUrl} alt={m.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
                  </button>
                  {onDeleteModel && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`确定要删除模特"${m.name}"吗？`)) {
                          onDeleteModel(m.id);
                        }
                      }}
                      className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] shadow-md hover:bg-red-600 transition-colors"
                      title={`删除${m.name}`}
                    >
                      <Icon name="times" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={genModel}
              disabled={isGeneratingModel}
              className="h-8 px-2.5 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-banana-400 hover:border-gray-500 hover:bg-dark-700 transition-colors disabled:opacity-50 shrink-0 flex items-center gap-1.5"
              title="AI 生成模特"
            >
              <Icon name={isGeneratingModel ? "spinner" : "magic"} className={isGeneratingModel ? "fa-spin" : ""} />
              AI生成
            </button>
            <button
              onClick={() => modelInputRef.current?.click()}
              className="h-8 px-2.5 rounded-md border border-dark-600 bg-dark-800 text-[11px] text-gray-300 hover:border-gray-500 hover:bg-dark-700 transition-colors shrink-0 flex items-center gap-1.5"
              title="上传模特"
            >
              <Icon name="upload" />
              上传
            </button>
            <input ref={modelInputRef} type="file" accept="image/*" className="hidden" onChange={uploadModel} />
          </div>

          {selectedModel && (
            <button
              onClick={() => onUpdateSettings({
                ...settings,
                selectedModelId: null,
                autoUseLastImage: true,
              })}
              className="h-8 px-2.5 text-[10px] bg-banana-500/10 hover:bg-banana-500/20 text-banana-400 border border-banana-500/30 rounded-md transition-colors flex items-center gap-1 shrink-0"
            >
              <Icon name="check-circle" /> 切换连续编辑
            </button>
          )}

          <div className="hidden sm:block w-px h-7 bg-dark-600" />

          {/* Aspect Ratio */}
          <div className="flex items-center gap-1.5 rounded-lg border border-dark-700 bg-dark-800/50 px-2.5 py-1.5">
            <span className="text-[11px] text-gray-400 shrink-0">画幅</span>
            <select
              value={settings.aspectRatio}
              onChange={(e) => {
                const ratio = e.target.value as AspectRatio;
                onUpdateSettings({ ...settings, aspectRatio: ratio, batchSizes: [getSupportedSizeForAspect(ratio)] });
              }}
              className="h-7 bg-dark-800 border border-dark-600 rounded-md px-1.5 text-[11px] text-gray-200 focus:outline-none focus:border-banana-500/50 cursor-pointer"
            >
              {getSupportedAspectRatios().map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Product Scale */}
          <div className="flex items-center gap-1.5 rounded-lg border border-dark-700 bg-dark-800/50 px-2.5 py-1.5">
            <span className="text-[11px] text-gray-400 shrink-0">显眼度</span>
            <div className="flex gap-1">
              {([
                [ProductScale.Small, "低调"],
                [ProductScale.Standard, "平衡"],
                [ProductScale.Large, "突出"],
              ] as const).map(([scale, label]) => (
                <button
                  key={scale}
                  onClick={() => onUpdateSettings({ ...settings, productScale: scale })}
                  className={`h-7 px-2 rounded-md text-[10px] font-medium transition-colors ${
                    settings.productScale === scale
                      ? "bg-banana-500 text-dark-900 border border-banana-500"
                      : "bg-dark-700 text-gray-300 border border-dark-600 hover:border-gray-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="w-full xl:w-auto xl:min-w-[320px] rounded-lg border border-dark-600 bg-dark-800/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-400">当前工作流</span>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                workflowMode === "锁定模特"
                  ? "border-banana-500/40 text-banana-400 bg-banana-500/10"
                  : workflowMode === "连续编辑"
                    ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                    : "border-gray-500/40 text-gray-300 bg-dark-700"
              }`}>
                {workflowMode}
              </span>
              {onOpenBatchSet && (
                <button
                  onClick={onOpenBatchSet}
                  className="h-7 px-2.5 rounded-md border border-banana-500/40 bg-banana-500/10 text-[10px] text-banana-400 hover:bg-banana-500/20 transition-colors flex items-center gap-1"
                  title="按规则批量生成矩阵"
                >
                  <Icon name="layer-group" />
                  一键出矩阵
                </button>
              )}
            </div>
          </div>
          <p className="mt-1 text-[10px] text-gray-500 leading-relaxed">{workflowHint}</p>
        </div>
      </div>
    </div>
  );
};

export const PromptModelPanel = React.memo(PromptModelPanelInner, (prev, next) =>
  prev.settings === next.settings &&
  prev.models === next.models &&
  prev.onOpenBatchSet === next.onOpenBatchSet
);
