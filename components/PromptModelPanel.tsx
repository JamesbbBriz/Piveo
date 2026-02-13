import React, { useRef, useState } from "react";
import { ModelCharacter, ProductImage, SessionSettings } from "../types";
import { generateModelCharacter } from "../services/gemini";
import { Icon } from "./Icon";

interface PromptModelPanelProps {
  settings: SessionSettings;
  onUpdateSettings: (next: SessionSettings) => void;
  models: ModelCharacter[];
  onAddModel: (model: ModelCharacter) => void;
}

export const PromptModelPanel: React.FC<PromptModelPanelProps> = ({
  settings,
  onUpdateSettings,
  models,
  onAddModel,
}) => {
  const [isGeneratingModel, setIsGeneratingModel] = useState(false);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);

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
        id: Date.now().toString(),
        name: `AI 模特 ${models.length + 1}`,
        imageUrl,
      };
      onAddModel(model);
      selectModel(model.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`生成模特失败：${msg}`);
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
        id: Date.now().toString(),
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
      id: Date.now().toString(),
      imageUrl: dataUrl,
      createdAt: Date.now(),
    };
    onUpdateSettings({ ...settings, productImage: product });
  };

  const uploadProduct = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
    onUpdateSettings({ ...settings, productImage: null });
  };

  const selectedModel = settings.selectedModelId
    ? models.find((m) => m.id === settings.selectedModelId)
    : null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Product image section */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-400 shrink-0">产品</span>
        <div
          tabIndex={0}
          onPaste={handleProductPaste}
          onClick={() => !settings.productImage && productInputRef.current?.click()}
          className={`relative shrink-0 rounded-lg outline-none focus:ring-1 focus:ring-banana-500 ${
            settings.productImage ? "" : "cursor-pointer"
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
            <div className="w-10 h-10 rounded-lg border-2 border-dashed border-dark-500 flex items-center justify-center text-gray-600 hover:border-gray-400 hover:text-gray-400 transition-colors">
              <Icon name="box-open" className="text-xs" />
            </div>
          )}
        </div>
        {settings.productImage && (
          <button
            onClick={() => productInputRef.current?.click()}
            className="text-[10px] text-gray-500 hover:text-gray-300"
            title="更换产品图"
          >
            <Icon name="sync-alt" />
          </button>
        )}
        <input ref={productInputRef} type="file" accept="image/*" className="hidden" onChange={uploadProduct} />
      </div>

      <div className="w-px h-6 bg-dark-600" />

      {/* Model section */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-400 shrink-0">模特</span>
        <div className="flex gap-1.5 overflow-x-auto custom-scrollbar">
          <button
            onClick={() => selectModel(null)}
            className={`w-8 h-8 shrink-0 rounded-lg border flex items-center justify-center transition-colors text-[10px] ${
              settings.selectedModelId === null
                ? "border-banana-500 bg-banana-500/10 text-banana-500"
                : "border-dark-600 text-gray-500 hover:border-gray-400"
            }`}
            title="不锁定人物"
          >
            <Icon name="ban" />
          </button>
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => selectModel(m.id)}
              className={`relative w-8 h-8 shrink-0 rounded-lg overflow-hidden border transition-colors ${
                settings.selectedModelId === m.id ? "border-banana-500" : "border-dark-600 hover:border-gray-400"
              }`}
              title={m.name}
            >
              <img src={m.imageUrl} alt={m.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
        <button
          onClick={genModel}
          disabled={isGeneratingModel}
          className="text-[10px] px-2 py-1 bg-dark-700 hover:bg-dark-600 rounded text-banana-400 border border-dark-600 transition-colors disabled:opacity-50 shrink-0"
          title="AI 生成模特"
        >
          <Icon name={isGeneratingModel ? "spinner" : "magic"} className={isGeneratingModel ? "fa-spin" : ""} />
        </button>
        <button
          onClick={() => modelInputRef.current?.click()}
          className="text-[10px] px-2 py-1 bg-dark-700 hover:bg-dark-600 rounded text-gray-200 border border-dark-600 transition-colors shrink-0"
          title="上传模特"
        >
          <Icon name="upload" />
        </button>
        <input ref={modelInputRef} type="file" accept="image/*" className="hidden" onChange={uploadModel} />
      </div>

      {/* Switch to continuous editing */}
      {selectedModel && (
        <>
          <div className="w-px h-6 bg-dark-600" />
          <button
            onClick={() => onUpdateSettings({
              ...settings,
              selectedModelId: null,
              autoUseLastImage: true,
            })}
            className="text-[10px] px-2 py-1 bg-banana-500/10 hover:bg-banana-500/20 text-banana-400 border border-banana-500/30 rounded-md transition-colors flex items-center gap-1 shrink-0"
          >
            <Icon name="check-circle" /> 切换连续编辑
          </button>
        </>
      )}
    </div>
  );
};
