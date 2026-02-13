import React, { useEffect, useState } from "react";
import { SessionSettings, SystemTemplate } from "../types";
import { Icon } from "./Icon";

interface SystemPromptBarProps {
  settings: SessionSettings;
  onUpdateSettings: (next: SessionSettings) => void;
  templates: SystemTemplate[];
  onSaveTemplate: (template: SystemTemplate) => void;
}

export const SystemPromptBar: React.FC<SystemPromptBarProps> = ({
  settings,
  onUpdateSettings,
  templates,
  onSaveTemplate,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [localPrompt, setLocalPrompt] = useState(settings.systemPrompt);
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");

  useEffect(() => {
    setLocalPrompt(settings.systemPrompt);
  }, [settings.systemPrompt]);

  const applyTemplate = (content: string) => {
    setLocalPrompt(content);
    onUpdateSettings({ ...settings, systemPrompt: content });
    setTemplateDropdownOpen(false);
  };

  const saveAsTemplate = () => {
    if (!newTemplateName.trim()) return;
    onSaveTemplate({
      id: Date.now().toString(),
      name: newTemplateName.trim(),
      content: localPrompt,
    });
    setNewTemplateName("");
    setIsSaving(false);
  };

  const preview = settings.systemPrompt?.trim()
    ? settings.systemPrompt.trim().slice(0, 60) + (settings.systemPrompt.trim().length > 60 ? "..." : "")
    : "未设置系统指令";

  return (
    <div className="bg-dark-800/60 border-b border-dark-700">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-dark-800/80 transition-colors"
      >
        <Icon name="scroll" className="text-banana-500 text-xs" />
        <span className="text-[11px] font-medium text-gray-300">系统指令</span>
        <span className="text-[11px] text-gray-500 truncate flex-1 text-left">{preview}</span>
        <Icon name={expanded ? "chevron-up" : "chevron-down"} className="text-gray-500 text-xs" />
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
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
                        onClick={() => applyTemplate(t.content)}
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
            {!isSaving ? (
              <button
                onClick={() => setIsSaving(true)}
                className="text-[11px] bg-dark-700 hover:bg-dark-600 text-gray-200 px-2 py-1 rounded border border-dark-600"
              >
                保存为模板
              </button>
            ) : null}
          </div>
          <textarea
            value={localPrompt}
            onChange={(e) => {
              const v = e.target.value;
              setLocalPrompt(v);
              onUpdateSettings({ ...settings, systemPrompt: v });
            }}
            className="w-full bg-dark-900 border border-dark-600 rounded-lg p-3 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-banana-500 focus:ring-1 focus:ring-banana-500 transition-colors resize-none h-24"
            placeholder="定义 AI 的工作方式..."
          />
          {isSaving && (
            <div className="flex items-center gap-2 bg-dark-900 p-2 rounded-lg border border-dark-600">
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
              <button onClick={() => setIsSaving(false)} className="text-red-400 hover:text-red-300" title="取消">
                <Icon name="times" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
