import React, { useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useModalA11y } from "./useModalA11y";

export type BatchSceneType = "model" | "flatlay" | "detail" | "white" | "custom";

export interface BatchSetRule {
  id: string;
  scene: BatchSceneType;
  count: number;
  note: string;
}

export interface BatchSetItem {
  scene: BatchSceneType;
  sceneLabel: string;
  note: string;
}

interface BatchSetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (items: BatchSetItem[]) => void;
}

const SCENE_OPTIONS: Array<{ value: BatchSceneType; label: string; hint: string }> = [
  { value: "model", label: "模特图", hint: "人物穿戴/持物场景" },
  { value: "flatlay", label: "平铺图", hint: "无人物，平铺展示材质与结构" },
  { value: "detail", label: "细节图", hint: "局部特写，突出质感工艺" },
  { value: "white", label: "白底图", hint: "电商主图，背景干净" },
  { value: "custom", label: "自定义", hint: "由你定义画面类型" },
];

const sceneLabelOf = (scene: BatchSceneType): string =>
  SCENE_OPTIONS.find((s) => s.value === scene)?.label || "自定义";

const createRule = (scene: BatchSceneType = "model", count = 1): BatchSetRule => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  scene,
  count,
  note: "",
});

const clampCount = (v: number) => {
  if (!Number.isFinite(v)) return 1;
  return Math.min(10, Math.max(1, Math.round(v)));
};

export const BatchSetModal: React.FC<BatchSetModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [rules, setRules] = useState<BatchSetRule[]>([
    createRule("model", 2),
    createRule("flatlay", 1),
  ]);
  const modalRef = useRef<HTMLDivElement>(null);

  useModalA11y(isOpen, modalRef, onClose);

  const totalCount = useMemo(
    () => rules.reduce((sum, r) => sum + clampCount(r.count), 0),
    [rules]
  );

  const updateRule = (id: string, patch: Partial<BatchSetRule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRule = (id: string) => {
    setRules((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  const applyQuickPreset = () => {
    setRules([createRule("model", 2), createRule("flatlay", 1)]);
  };

  const handleSubmit = () => {
    const items: BatchSetItem[] = [];
    for (const rule of rules) {
      const count = clampCount(rule.count);
      for (let i = 0; i < count; i++) {
        items.push({
          scene: rule.scene,
          sceneLabel: sceneLabelOf(rule.scene),
          note: rule.note.trim(),
        });
      }
    }
    if (items.length === 0) return;
    onSubmit(items);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        ref={modalRef}
        tabIndex={-1}
        className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl border border-dark-600 bg-dark-800 shadow-2xl flex flex-col"
      >
        <div className="px-4 py-3 border-b border-dark-700 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">一键出套图</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              先定义要出几张、每张是什么类型，生成后会逐张进入聊天记录，可单独微调和下载。
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <Icon name="times" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3">
          <div className="flex items-center justify-between">
            <button
              onClick={applyQuickPreset}
              className="px-2.5 py-1.5 text-xs rounded-md border border-dark-600 bg-dark-900 text-gray-300 hover:bg-dark-700"
            >
              示例：2张模特 + 1张平铺
            </button>
            <div className="text-xs text-gray-300">
              总张数 <span className="text-banana-400 font-semibold">{totalCount}</span>
            </div>
          </div>

          {rules.map((rule, index) => {
            const sceneMeta = SCENE_OPTIONS.find((s) => s.value === rule.scene);
            return (
              <div key={rule.id} className="rounded-xl border border-dark-700 bg-dark-900/40 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-300 font-medium">规则 {index + 1}</div>
                  <button
                    onClick={() => removeRule(rule.id)}
                    disabled={rules.length <= 1}
                    className="text-xs px-2 py-1 rounded border border-dark-600 text-gray-400 hover:text-red-300 hover:border-red-500/40 disabled:opacity-40"
                  >
                    删除
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[140px_100px_1fr] gap-2">
                  <label className="text-[11px] text-gray-400">
                    类型
                    <select
                      value={rule.scene}
                      onChange={(e) => updateRule(rule.id, { scene: e.target.value as BatchSceneType })}
                      className="mt-1 w-full h-9 rounded-md border border-dark-600 bg-dark-800 px-2 text-xs text-gray-200"
                    >
                      {SCENE_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-gray-400">
                    数量
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={rule.count}
                      onChange={(e) => updateRule(rule.id, { count: clampCount(Number(e.target.value)) })}
                      className="mt-1 w-full h-9 rounded-md border border-dark-600 bg-dark-800 px-2 text-xs text-gray-200"
                    />
                  </label>
                  <label className="text-[11px] text-gray-400">
                    单独要求（可选）
                    <input
                      value={rule.note}
                      onChange={(e) => updateRule(rule.id, { note: e.target.value })}
                      placeholder={
                        rule.scene === "custom"
                          ? "例如：侧45度构图，暖色背景，手持产品"
                          : `例如：${sceneMeta?.hint || "补充你的画面要求"}`
                      }
                      className="mt-1 w-full h-9 rounded-md border border-dark-600 bg-dark-800 px-2 text-xs text-gray-200 placeholder-gray-500"
                    />
                  </label>
                </div>
              </div>
            );
          })}

          <button
            onClick={() => setRules((prev) => [...prev, createRule("model", 1)])}
            className="w-full h-9 rounded-md border border-dashed border-dark-500 text-xs text-gray-300 hover:text-gray-100 hover:border-gray-500"
          >
            + 添加一条规则
          </button>
        </div>

        <div className="px-4 py-3 border-t border-dark-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md border border-dark-600 bg-dark-900 text-gray-300 hover:bg-dark-700"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={totalCount <= 0}
            className="px-3 py-1.5 text-xs rounded-md border border-banana-500 bg-banana-500 text-dark-900 font-semibold hover:bg-banana-400 disabled:opacity-50"
          >
            开始出套图
          </button>
        </div>
      </div>
    </div>
  );
};
