import React, { useEffect, useRef, useState } from "react";
import { ModelCharacter, ProductImage, SessionSettings, SystemTemplate } from "../types";
import { generateModelCharacter } from "../services/gemini";
import { Icon } from "./Icon";

interface PromptModelPanelProps {
  settings: SessionSettings;
  onUpdateSettings: (next: SessionSettings) => void;
  templates: SystemTemplate[];
  onSaveTemplate: (template: SystemTemplate) => void;
  models: ModelCharacter[];
  onAddModel: (model: ModelCharacter) => void;
}

export const PromptModelPanel: React.FC<PromptModelPanelProps> = ({
  settings,
  onUpdateSettings,
  templates,
  onSaveTemplate,
  models,
  onAddModel,
}) => {
  const [openPanel, setOpenPanel] = useState(true);
  const [localSystemPrompt, setLocalSystemPrompt] = useState(settings.systemPrompt);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [isGeneratingModel, setIsGeneratingModel] = useState(false);
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalSystemPrompt(settings.systemPrompt);
  }, [settings.systemPrompt]);

  const applyTemplate = (content: string) => {
    setLocalSystemPrompt(content);
    onUpdateSettings({ ...settings, systemPrompt: content });
  };

  const saveAsTemplate = () => {
    if (!newTemplateName.trim()) return;
    onSaveTemplate({
      id: Date.now().toString(),
      name: newTemplateName.trim(),
      content: localSystemPrompt,
    });
    setNewTemplateName("");
    setIsEditingTemplate(false);
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
        id: Date.now().toString(),
        name: `AI 模特 ${models.length + 1}`,
        imageUrl,
      };
      onAddModel(model);
      selectModel(model.id);
      setOpenPanel(true);
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
      setOpenPanel(true);
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
        id: Date.now().toString(),
        imageUrl: reader.result as string,
        createdAt: Date.now(),
      };
      onUpdateSettings({ ...settings, productImage: product });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removeProduct = () => {
    onUpdateSettings({ ...settings, productImage: null });
  };

  return (
    <div className="bg-dark-900/30 border border-dark-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpenPanel((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-dark-900/50"
      >
        <div className="flex items-center gap-2 text-gray-200">
          <Icon name="sliders-h" />
          <span className="text-xs font-semibold">系统指令与一致性模特</span>
          <span className="text-[10px] text-gray-500">模特 {settings.selectedModelId ? "已锁定" : "未锁定"}</span>
          {settings.productImage && <span className="text-[10px] text-banana-400">产品图 已设置</span>}
        </div>
        <Icon name={openPanel ? "chevron-up" : "chevron-down"} />
      </button>
      {openPanel && (
        <div className="border-t border-dark-700 p-3 space-y-3">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="relative">
                <button
                  onClick={() => setTemplateDropdownOpen((v) => !v)}
                  className="text-xs text-banana-500 hover:text-banana-400 font-medium flex items-center gap-1"
                >
                  <Icon name="book" /> 模板
                </button>
                {templateDropdownOpen && (
                  <div className="absolute left-0 top-full mt-2 w-56 bg-dark-700 border border-dark-600 rounded-lg shadow-xl z-10">
                    <div className="p-1">
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            applyTemplate(t.content);
                            setTemplateDropdownOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-dark-600 rounded-md truncate"
                          title={t.content}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {!isEditingTemplate ? (
                <button
                  onClick={() => setIsEditingTemplate(true)}
                  className="text-[11px] bg-dark-700 hover:bg-dark-600 text-gray-200 px-2 py-1 rounded border border-dark-600"
                >
                  保存为模板
                </button>
              ) : null}
            </div>

            <textarea
              value={localSystemPrompt}
              onChange={(e) => {
                const v = e.target.value;
                setLocalSystemPrompt(v);
                onUpdateSettings({ ...settings, systemPrompt: v });
              }}
              className="w-full bg-dark-800 border border-dark-600 rounded-lg p-3 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500 focus:ring-1 focus:ring-banana-500 transition-colors resize-none h-24"
              placeholder="定义 AI 的工作方式..."
            />

            {!isEditingTemplate ? null : (
              <div className="flex items-center gap-2 bg-dark-800 p-2 rounded-lg border border-dark-600">
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="模板名称"
                  className="flex-1 bg-transparent text-xs text-white focus:outline-none"
                  autoFocus
                />
                <button onClick={saveAsTemplate} className="text-banana-500 hover:text-banana-400" title="保存">
                  <Icon name="check" />
                </button>
                <button onClick={() => setIsEditingTemplate(false)} className="text-red-400 hover:text-red-300" title="取消">
                  <Icon name="times" />
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-dark-700 pt-3 space-y-3">
            <div className="text-[11px] text-gray-400">产品图</div>
            {settings.productImage ? (
              <div className="relative inline-block">
                <img
                  src={settings.productImage.imageUrl}
                  alt="产品图"
                  className="w-20 h-20 rounded-xl border border-banana-500 object-cover"
                  loading="lazy"
                  decoding="async"
                />
                <button
                  onClick={removeProduct}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md"
                  title="删除产品图"
                >
                  <Icon name="times" />
                </button>
              </div>
            ) : (
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-dark-600 flex items-center justify-center text-gray-600">
                <Icon name="box-open" />
              </div>
            )}
            <button
              onClick={() => productInputRef.current?.click()}
              className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 rounded text-gray-200 border border-dark-600 transition-colors"
            >
              <Icon name="upload" /> {settings.productImage ? "更换产品图" : "上传产品图"}
            </button>
            <input ref={productInputRef} type="file" accept="image/*" className="hidden" onChange={uploadProduct} />
            <div className="text-[10px] text-gray-500">上传后每次生成都会带上此产品</div>
          </div>

          <div className="border-t border-dark-700 pt-3 space-y-3">
            <div className="text-[11px] text-gray-400">一致性模特</div>
            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
              <button
                onClick={() => selectModel(null)}
                className={`w-12 h-12 shrink-0 rounded-xl border flex items-center justify-center transition-colors ${
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
                  className={`relative w-12 h-12 shrink-0 rounded-xl overflow-hidden border transition-colors ${
                    settings.selectedModelId === m.id ? "border-banana-500" : "border-dark-600 hover:border-gray-400"
                  }`}
                  title={m.name}
                >
                  <img src={m.imageUrl} alt={m.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
            {settings.selectedModelId && (
              <button
                onClick={() => onUpdateSettings({
                  ...settings,
                  selectedModelId: null,
                  autoUseLastImage: true,
                })}
                className="w-full px-3 py-2 text-xs bg-banana-500/10 hover:bg-banana-500/20 text-banana-400 border border-banana-500/30 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Icon name="check-circle" /> 基底满意，切换连续编辑
              </button>
            )}
            <div className="flex gap-2">
              <button
                onClick={genModel}
                disabled={isGeneratingModel}
                className="flex-1 px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 rounded text-banana-400 border border-dark-600 transition-colors disabled:opacity-50"
              >
                <Icon name={isGeneratingModel ? "spinner" : "magic"} className={isGeneratingModel ? "fa-spin" : ""} /> 生成 AI 模特
              </button>
              <button
                onClick={() => modelInputRef.current?.click()}
                className="flex-1 px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 rounded text-gray-200 border border-dark-600 transition-colors"
              >
                <Icon name="upload" /> 上传
              </button>
              <input ref={modelInputRef} type="file" accept="image/*" className="hidden" onChange={uploadModel} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
