
import React, { useState, useEffect, useRef } from 'react';
import { AspectRatio, ImageResponseFormat, ProductScale, SessionSettings, SystemTemplate, ModelCharacter } from '../types';
import { Icon } from './Icon';
import { generateModelCharacter } from '../services/gemini';

interface SettingsPanelProps {
  settings: SessionSettings;
  onUpdateSettings: (newSettings: SessionSettings) => void;
  templates: SystemTemplate[];
  onSaveTemplate: (template: SystemTemplate) => void;
  models: ModelCharacter[];
  onAddModel: (model: ModelCharacter) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onUpdateSettings,
  templates,
  onSaveTemplate,
  models,
  onAddModel
}) => {
  const [localSystemPrompt, setLocalSystemPrompt] = useState(settings.systemPrompt);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [isGeneratingModel, setIsGeneratingModel] = useState(false);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const [customSize, setCustomSize] = useState("");
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<{
    ratio: boolean;
    generation: boolean;
    system: boolean;
    models: boolean;
  }>(() => {
    const defaults = { ratio: true, generation: true, system: true, models: true };
    try {
      const raw = localStorage.getItem("nanobanana_settings_groups_v1");
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaults;
      return {
        ratio: typeof parsed.ratio === "boolean" ? parsed.ratio : defaults.ratio,
        generation: typeof parsed.generation === "boolean" ? parsed.generation : defaults.generation,
        system: typeof parsed.system === "boolean" ? parsed.system : defaults.system,
        models: typeof parsed.models === "boolean" ? parsed.models : defaults.models,
      };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    setLocalSystemPrompt(settings.systemPrompt);
  }, [settings.systemPrompt]);

  useEffect(() => {
    try {
      localStorage.setItem("nanobanana_settings_groups_v1", JSON.stringify(openGroups));
    } catch {
      // ignore
    }
  }, [openGroups]);

  const handleAspectRatioChange = (ratio: AspectRatio) => {
    onUpdateSettings({ ...settings, aspectRatio: ratio });
  };

  const handleProductScaleChange = (scale: ProductScale) => {
    onUpdateSettings({ ...settings, productScale: scale });
  };

  const handleBatchCountChange = (n: number) => {
    const v = Math.min(Math.max(Math.round(n), 1), 10);
    onUpdateSettings({ ...settings, batchCount: v });
  };

  const handleResponseFormatChange = (rf: ImageResponseFormat) => {
    onUpdateSettings({ ...settings, responseFormat: rf });
  };

  const toggleSize = (size: string) => {
    const s = size.trim();
    if (!s) return;
    const next = new Set((settings.batchSizes || []).map((x) => String(x).trim()).filter(Boolean));
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onUpdateSettings({ ...settings, batchSizes: Array.from(next) });
  };

  const addCustomSize = () => {
    const s = customSize.trim().toLowerCase();
    if (!/^[0-9]{2,5}x[0-9]{2,5}$/.test(s)) {
      alert("尺寸格式不正确，请输入例如：832x1248");
      return;
    }
    const next = new Set((settings.batchSizes || []).map((x) => String(x).trim()).filter(Boolean));
    next.add(s);
    onUpdateSettings({ ...settings, batchSizes: Array.from(next) });
    setCustomSize("");
  };

  const clearSizes = () => {
    onUpdateSettings({ ...settings, batchSizes: [] });
  };

  const handleSystemPromptBlur = () => {
    onUpdateSettings({ ...settings, systemPrompt: localSystemPrompt });
  };

  const handleApplyTemplate = (content: string) => {
    setLocalSystemPrompt(content);
    onUpdateSettings({ ...settings, systemPrompt: content });
  };

  const handleSaveAsTemplate = () => {
    if (!newTemplateName.trim()) return;
    const newTemplate: SystemTemplate = {
      id: Date.now().toString(),
      name: newTemplateName,
      content: localSystemPrompt
    };
    onSaveTemplate(newTemplate);
    setNewTemplateName('');
    setIsEditingTemplate(false);
  };

  const handleModelSelect = (id: string | null) => {
    onUpdateSettings({ ...settings, selectedModelId: id === settings.selectedModelId ? null : id });
  };

  const handleGenerateModel = async () => {
    setIsGeneratingModel(true);
    try {
      const imageUrl = await generateModelCharacter();
      const newModel: ModelCharacter = {
        id: Date.now().toString(),
        name: `AI 模特 ${models.length + 1}`,
        imageUrl: imageUrl
      };
      onAddModel(newModel);
      handleModelSelect(newModel.id); // Auto select
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      alert(`生成模特失败：${msg}`);
    } finally {
      setIsGeneratingModel(false);
    }
  };

  const handleUploadModel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const newModel: ModelCharacter = {
          id: Date.now().toString(),
          name: `自定义模特 ${models.length + 1}`,
          imageUrl: reader.result as string
        };
        onAddModel(newModel);
        handleModelSelect(newModel.id);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const presetSizes = [
    "256x256",
    "512x512",
    "768x1024",
    "832x1248",
    "1024x1024",
    "1024x768",
    "720x1280",
    "1280x720",
    "1024x1792",
    "1792x1024",
  ];

  const batchSizesSet = new Set((settings.batchSizes || []).map((s) => String(s).trim()).filter(Boolean));
  const allOpen = Object.values(openGroups).every(Boolean);
  const toggleAll = () => {
    const next = !allOpen;
    setOpenGroups({ ratio: next, generation: next, system: next, models: next });
  };

  const SystemEditor = (
    <div className="bg-dark-700/20 border border-dark-700 rounded-xl p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-400 tracking-wider">
          系统指令
        </h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setTemplateDropdownOpen((v) => !v)}
              className="text-xs text-banana-500 hover:text-banana-400 font-medium flex items-center gap-1"
            >
              <Icon name="book" /> 模板
            </button>
            {templateDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-dark-700 border border-dark-600 rounded-lg shadow-xl z-10">
                <div className="p-1">
                  {templates.map(t => (
                    <button
                      key={t.id}
                      onClick={() => {
                        handleApplyTemplate(t.content);
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
        </div>
      </div>
      
      <div className="relative">
        <textarea
          value={localSystemPrompt}
          onChange={(e) => setLocalSystemPrompt(e.target.value)}
          onBlur={handleSystemPromptBlur}
          className="w-full bg-dark-900 border border-dark-600 rounded-lg p-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500 focus:ring-1 focus:ring-banana-500 transition-colors resize-none h-40"
          placeholder="定义 AI 的工作方式..."
        />
        <div className="absolute bottom-2 right-2">
          {!isEditingTemplate ? (
            <button 
              onClick={() => setIsEditingTemplate(true)}
              className="text-xs bg-dark-700 hover:bg-dark-600 text-gray-300 px-2 py-1 rounded border border-dark-500 transition-colors"
            >
              保存为模板
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-dark-800 p-1 rounded border border-dark-500">
              <input 
                type="text" 
                value={newTemplateName}
                onChange={e => setNewTemplateName(e.target.value)}
                placeholder="模板名称"
                className="bg-transparent text-xs text-white focus:outline-none w-24"
                autoFocus
              />
              <button onClick={handleSaveAsTemplate} className="text-banana-500 hover:text-banana-400"><Icon name="check" /></button>
              <button onClick={() => setIsEditingTemplate(false)} className="text-red-400 hover:text-red-300"><Icon name="times" /></button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-dark-800 border-b border-dark-700 p-4 lg:p-6 shadow-lg">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name="sliders-h" />
            <h2 className="text-sm font-semibold text-gray-200 truncate">创作设置</h2>
            <span className="text-[10px] bg-dark-700 px-2 py-0.5 rounded text-gray-500">
              {settings.batchSizes?.length ? `尺寸 ${settings.batchSizes.length} 个` : `画幅 ${settings.aspectRatio}`}
            </span>
            <span className="text-[10px] bg-dark-700 px-2 py-0.5 rounded text-gray-500">
              每次 {settings.batchCount || 1} 张
            </span>
            <span className="text-[10px] bg-dark-700 px-2 py-0.5 rounded text-gray-500">
              格式 {settings.responseFormat === "b64_json" ? "b64_json" : "url"}
            </span>
          </div>
          <button
            onClick={toggleAll}
            className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
            title={allOpen ? "收起全部" : "展开全部"}
          >
            <Icon name={allOpen ? "compress-alt" : "expand-alt"} /> {allOpen ? "收起全部" : "展开全部"}
          </button>
        </div>

        <div className="flex flex-col gap-4">
            {/* Aspect Ratio Section */}
            <div className="w-full space-y-4">
              <button
                onClick={() => setOpenGroups((v) => ({ ...v, ratio: !v.ratio }))}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-dark-700 bg-dark-900/40 hover:bg-dark-900/60 transition-colors"
                title={openGroups.ratio ? "收起" : "展开"}
              >
                <div className="flex items-center gap-2">
                  <Icon name="crop-alt" />
                  <span className="text-sm font-semibold text-gray-200">画幅与产品</span>
                  <span className="text-[10px] bg-dark-700 px-2 py-0.5 rounded text-gray-500">
                    {settings.aspectRatio} · {settings.productScale === ProductScale.Small ? "小" : settings.productScale === ProductScale.Large ? "大" : "标准"}
                  </span>
                </div>
                <Icon name={openGroups.ratio ? "chevron-up" : "chevron-down"} />
              </button>
              {openGroups.ratio && (
                <div className="mt-3 bg-dark-700/20 border border-dark-700 rounded-xl p-3">
                  <h3 className="text-sm font-semibold text-gray-400 tracking-wider mb-3">
                    画幅比例
                  </h3>
                  <div className="grid grid-cols-5 gap-2 lg:gap-3">
                    {Object.values(AspectRatio).map((ratio) => (
                      <button
                        key={ratio}
                        onClick={() => handleAspectRatioChange(ratio)}
                        className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${
                          settings.aspectRatio === ratio
                            ? 'bg-banana-500/10 border-banana-500 text-banana-400'
                            : 'bg-dark-700 border-dark-600 text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        <div 
                          className="border-2 border-current rounded-sm mb-1 opacity-80"
                          style={{
                            width: '24px',
                            height: ratio === '1:1' ? '24px' : ratio === '3:4' ? '32px' : ratio === '4:3' ? '18px' : ratio === '9:16' ? '36px' : '14px',
                            aspectRatio: ratio.replace(':', '/')
                          }}
                        />
                        <span className="text-xs font-medium">{ratio}</span>
                      </button>
                    ))}
                  </div>

                  <h3 className="text-sm font-semibold text-gray-400 tracking-wider mb-3 mt-6">
                    产品大小
                  </h3>
                  <div className="flex gap-2">
                    {[ProductScale.Small, ProductScale.Standard, ProductScale.Large].map((scale) => (
                      <button
                        key={scale}
                        onClick={() => handleProductScaleChange(scale)}
                        className={`flex-1 py-1.5 px-3 rounded-md border text-xs font-semibold transition-all ${
                          settings.productScale === scale
                            ? 'bg-banana-500 text-dark-900 border-banana-500'
                            : 'bg-dark-700 text-gray-400 border-dark-600 hover:border-gray-500'
                        }`}
                      >
                        {scale === ProductScale.Small ? '小' : scale === ProductScale.Standard ? '标准' : '大'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => setOpenGroups((v) => ({ ...v, generation: !v.generation }))}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-dark-700 bg-dark-900/40 hover:bg-dark-900/60 transition-colors"
                title={openGroups.generation ? "收起" : "展开"}
              >
                <div className="flex items-center gap-2">
                  <Icon name="cogs" />
                  <span className="text-sm font-semibold text-gray-200">生成设置</span>
                  <span className="text-[10px] bg-dark-700 px-2 py-0.5 rounded text-gray-500">
                    {settings.batchCount || 1} 张 · {settings.responseFormat === "b64_json" ? "b64_json" : "url"}
                  </span>
                </div>
                <Icon name={openGroups.generation ? "chevron-up" : "chevron-down"} />
              </button>
              {openGroups.generation && (
                <div className="bg-dark-700/40 border border-dark-600 rounded-lg p-3 space-y-4">
                  <div>
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                      <span>每次生成张数</span>
                      <span className="text-gray-200 font-semibold">{settings.batchCount || 1}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={settings.batchCount || 1}
                      onChange={(e) => handleBatchCountChange(Number(e.target.value))}
                      className="w-full accent-banana-500"
                    />
                  </div>

                  <div>
                    <div className="text-xs text-gray-400 mb-2">返回格式</div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleResponseFormatChange("url")}
                        className={`flex-1 py-1.5 px-3 rounded-md border text-xs font-semibold transition-all ${
                          settings.responseFormat === "url"
                            ? "bg-banana-500 text-dark-900 border-banana-500"
                            : "bg-dark-700 text-gray-300 border-dark-600 hover:border-gray-500"
                        }`}
                      >
                        url
                      </button>
                      <button
                        onClick={() => handleResponseFormatChange("b64_json")}
                        className={`flex-1 py-1.5 px-3 rounded-md border text-xs font-semibold transition-all ${
                          settings.responseFormat === "b64_json"
                            ? "bg-banana-500 text-dark-900 border-banana-500"
                            : "bg-dark-700 text-gray-300 border-dark-600 hover:border-gray-500"
                        }`}
                      >
                        b64_json
                      </button>
                    </div>
                    <div className="mt-2 text-[11px] text-gray-500">
                      提示：不同网关/模型对格式支持不同；如果不支持会自动退化为可展示的 data url。
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs text-gray-400">生成尺寸列表</div>
                      <button
                        onClick={clearSizes}
                        className="px-2 py-1 text-[11px] bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded"
                        title="清空尺寸列表（回到按画幅生成）"
                      >
                        清空
                      </button>
                    </div>
                    <div className="text-[11px] text-gray-500 mb-2">
                      为空：按画幅比例生成。非空：按此列表生成（可多尺寸批量）。
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {presetSizes.map((s) => {
                        const active = batchSizesSet.has(s);
                        return (
                          <button
                            key={s}
                            onClick={() => toggleSize(s)}
                            className={`px-2.5 py-1.5 rounded-full border text-[11px] transition-colors ${
                              active
                                ? "bg-banana-500/10 border-banana-500 text-banana-400"
                                : "bg-dark-700 border-dark-600 text-gray-300 hover:border-gray-500"
                            }`}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        value={customSize}
                        onChange={(e) => setCustomSize(e.target.value)}
                        className="flex-1 bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-banana-500"
                        placeholder="自定义尺寸，例如：832x1248"
                      />
                      <button
                        onClick={addCustomSize}
                        className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                      >
                        添加
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => setOpenGroups((v) => ({ ...v, system: !v.system }))}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-dark-700 bg-dark-900/40 hover:bg-dark-900/60 transition-colors"
                title={openGroups.system ? "收起" : "展开"}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon name="terminal" />
                  <span className="text-sm font-semibold text-gray-200 truncate">系统指令</span>
                  <span className="text-[10px] bg-dark-700 px-2 py-0.5 rounded text-gray-500 truncate">
                    {localSystemPrompt.trim() ? `${Math.min(localSystemPrompt.trim().length, 9999)} 字` : "未填写"}
                  </span>
                </div>
                <Icon name={openGroups.system ? "chevron-up" : "chevron-down"} />
              </button>
              {openGroups.system && SystemEditor}
            </div>
        </div>

        {/* Model Library Section */}
        <div>
            <button
              onClick={() => setOpenGroups((v) => ({ ...v, models: !v.models }))}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-dark-700 bg-dark-900/40 hover:bg-dark-900/60 transition-colors"
              title={openGroups.models ? "收起" : "展开"}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon name="user-circle" />
                <span className="text-sm font-semibold text-gray-200 truncate">模特库（人物一致性）</span>
                <span className="text-[10px] bg-dark-700 px-2 py-0.5 rounded text-gray-500 truncate">
                  {settings.selectedModelId ? "已锁定" : "未锁定"} · {models.length} 个
                </span>
              </div>
              <Icon name={openGroups.models ? "chevron-up" : "chevron-down"} />
            </button>

            {openGroups.models && (
              <div className="mt-3 bg-dark-700/20 border border-dark-700 rounded-xl p-3">
                <h3 className="text-sm font-semibold text-gray-400 tracking-wider mb-3 flex items-center gap-2">
                  <span>模特库（人物一致性）</span>
                  <span className="text-[10px] bg-dark-700 px-2 py-0.5 rounded text-gray-500">选择一个用来锁定脸</span>
                </h3>
                <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                {/* No Model Option */}
                <div 
                    onClick={() => handleModelSelect(null)}
                    className={`flex-shrink-0 w-16 h-16 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all ${
                        settings.selectedModelId === null 
                        ? 'border-banana-500 bg-banana-500/10 text-banana-500' 
                        : 'border-dashed border-dark-600 text-gray-500 hover:border-gray-400'
                    }`}
                >
                    <Icon name="ban" />
                </div>

                {/* Existing Models */}
                {models.map(model => (
                    <div 
                        key={model.id}
                        onClick={() => handleModelSelect(model.id)}
                        className={`flex-shrink-0 relative w-16 h-16 rounded-full border-2 cursor-pointer transition-all group overflow-hidden ${
                            settings.selectedModelId === model.id 
                            ? 'border-banana-500 ring-2 ring-banana-500/30' 
                            : 'border-transparent hover:border-gray-400'
                        }`}
                    >
                        <img src={model.imageUrl} alt={model.name} className="w-full h-full object-cover" />
                    </div>
                ))}

                {/* Add/Generate Actions */}
                <div className="flex flex-col gap-1 ml-2">
                    <button 
                        onClick={handleGenerateModel}
                        disabled={isGeneratingModel}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs bg-dark-700 hover:bg-dark-600 rounded text-banana-400 border border-dark-600 transition-colors whitespace-nowrap"
                    >
                        <Icon name={isGeneratingModel ? "spinner" : "magic"} className={isGeneratingModel ? "fa-spin" : ""} />
                        生成 AI 模特
                    </button>
                    <button 
                        onClick={() => modelInputRef.current?.click()}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs bg-dark-700 hover:bg-dark-600 rounded text-gray-300 border border-dark-600 transition-colors whitespace-nowrap"
                    >
                        <Icon name="upload" />
                        上传模特
                    </button>
                    <input type="file" ref={modelInputRef} onChange={handleUploadModel} accept="image/*" className="hidden" />
                </div>
            </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
};
