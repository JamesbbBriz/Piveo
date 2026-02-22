import React, { useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useModalA11y } from "./useModalA11y";

export type BatchSceneType = "model" | "flatlay" | "detail" | "white" | "custom";

export interface BatchSetRule {
  id: string;
  scene: BatchSceneType;
  count: number;
  note: string;
  checkedPoses: string[];
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
  referenceImageUrl?: string;
}

const SCENE_OPTIONS: Array<{ value: BatchSceneType; label: string; hint: string }> = [
  { value: "model", label: "模特图", hint: "人物穿戴/持物场景" },
  { value: "flatlay", label: "平铺图", hint: "无人物，平铺展示材质与结构" },
  { value: "detail", label: "细节图", hint: "局部特写，突出质感工艺" },
  { value: "white", label: "白底图", hint: "电商主图，背景干净" },
  { value: "custom", label: "自定义", hint: "由你定义画面类型" },
];

const MODEL_POSES = [
  { id: "standing_front", label: "全身站姿", directive: "全身站姿正面，展示完整穿搭效果" },
  { id: "side_glance", label: "侧身回眸", directive: "侧身回眸，展现服装侧面轮廓与动态美感" },
  { id: "seated", label: "坐姿", directive: "坐姿休闲，展示服装在放松状态下的自然垂感" },
  { id: "walking", label: "行走抓拍", directive: "行走中抓拍，展现服装的飘逸感和运动活力" },
  { id: "upper_closeup", label: "半身特写", directive: "半身特写，聚焦上半身搭配细节和面部表情" },
  { id: "leaning", label: "倚靠姿态", directive: "倚靠或斜靠姿态，营造时尚杂志感的氛围" },
];

const DETAIL_ANGLES = [
  { id: "front_closeup", label: "正面特写", directive: "正面平视特写，展示产品整体外观和关键工艺" },
  { id: "overhead_45", label: "45°俯拍", directive: "45度俯拍角度，展示产品立体轮廓和层次" },
  { id: "macro", label: "微距纹理", directive: "微距特写，聚焦材质纹理、缝线和工艺细节" },
  { id: "side_profile", label: "侧面轮廓", directive: "侧面角度，展示产品轮廓线条和厚度" },
  { id: "in_use", label: "使用场景", directive: "手持或佩戴特写，展示产品在使用中的细节" },
];

const FLATLAY_PRESETS = [
  { id: "centered", label: "居中平铺", directive: "产品居中平铺，干净背景，展示完整外观和材质" },
  { id: "with_props", label: "搭配道具", directive: "产品搭配应季道具（花/咖啡/杂志等），增强场景感" },
  { id: "overhead", label: "俯拍全景", directive: "正上方俯拍，展示产品完整轮廓与细节" },
  { id: "warm_life", label: "暖调生活", directive: "暖色木纹/织物背景，搭配生活道具，温馨氛围" },
  { id: "cool_modern", label: "冷调现代", directive: "大理石/金属/深色背景，冷调高级质感" },
];

const WHITE_BG_PRESETS = [
  { id: "main_image", label: "电商主图", directive: "纯白背景正面居中，符合电商平台主图规范" },
  { id: "side_view", label: "侧面图", directive: "纯白背景侧面拍摄，展示产品轮廓和厚度" },
  { id: "size_ref", label: "尺寸参考", directive: "纯白背景带比例参照物，直观展示产品大小" },
  { id: "group", label: "组合展示", directive: "纯白背景多件/多色并排展示，突出系列感" },
  { id: "floating", label: "悬浮效果", directive: "纯白背景产品悬浮展示，带自然投影，增强立体感" },
];

const sceneLabelOf = (scene: BatchSceneType): string =>
  SCENE_OPTIONS.find((s) => s.value === scene)?.label || "自定义";

const defaultCheckedPoses = (scene: BatchSceneType, count: number): string[] => {
  const presets = scene === "model" ? MODEL_POSES : scene === "detail" ? DETAIL_ANGLES : scene === "flatlay" ? FLATLAY_PRESETS : scene === "white" ? WHITE_BG_PRESETS : null;
  if (!presets) return [];
  return presets.slice(0, count).map((p) => p.id);
};

const createRule = (scene: BatchSceneType = "model", count = 1): BatchSetRule => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  scene,
  count,
  note: "",
  checkedPoses: defaultCheckedPoses(scene, count),
});

const clampCount = (v: number) => {
  if (!Number.isFinite(v)) return 1;
  return Math.min(10, Math.max(1, Math.round(v)));
};

export const BatchSetModal: React.FC<BatchSetModalProps> = ({ isOpen, onClose, onSubmit, referenceImageUrl }) => {
  const [rules, setRules] = useState<BatchSetRule[]>([
    createRule("model", 2),
    createRule("flatlay", 1),
  ]);
  const modalRef = useRef<HTMLDivElement>(null);

  useModalA11y(isOpen, modalRef, onClose);

  const totalCount = useMemo(
    () =>
      rules.reduce((sum, r) => {
        const presets = r.scene === "model" ? MODEL_POSES : r.scene === "detail" ? DETAIL_ANGLES : null;
        return sum + (presets ? r.checkedPoses.length : clampCount(r.count));
      }, 0),
    [rules]
  );

  const updateRule = (id: string, patch: Partial<BatchSetRule>) => {
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, ...patch };
        if (patch.scene && patch.scene !== r.scene) {
          updated.checkedPoses = defaultCheckedPoses(patch.scene, updated.count);
        }
        return updated;
      })
    );
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
      const presets =
        rule.scene === "model" ? MODEL_POSES : rule.scene === "detail" ? DETAIL_ANGLES : null;

      if (presets && rule.checkedPoses.length > 0) {
        for (const poseId of rule.checkedPoses) {
          const pose = presets.find((p) => p.id === poseId);
          if (!pose) continue;
          items.push({
            scene: rule.scene,
            sceneLabel: `${sceneLabelOf(rule.scene)} · ${pose.label}`,
            note: [pose.directive, rule.note.trim()].filter(Boolean).join("；"),
          });
        }
      } else {
        const count = clampCount(rule.count);
        for (let i = 0; i < count; i++) {
          items.push({
            scene: rule.scene,
            sceneLabel: sceneLabelOf(rule.scene),
            note: rule.note.trim(),
          });
        }
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
              先定义要出几张、每张是什么类型。生成后进入独立套图工作台，不污染聊天区。
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <Icon name="times" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3">
          {referenceImageUrl && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <img
                src={referenceImageUrl}
                alt="参考图"
                className="w-16 h-16 rounded-lg object-cover border border-dark-600 shrink-0"
              />
              <div className="min-w-0">
                <div className="text-xs text-emerald-300 font-medium flex items-center gap-1.5">
                  <Icon name="lock" className="text-[10px]" />
                  参考图（已锁定）
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">将基于此图风格生成所有场景变体</p>
              </div>
            </div>
          )}

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
            const presets =
              rule.scene === "model" ? MODEL_POSES : rule.scene === "detail" ? DETAIL_ANGLES : null;
            const hasPoseCheckboxes = !!presets;

            const togglePose = (poseId: string) => {
              const next = rule.checkedPoses.includes(poseId)
                ? rule.checkedPoses.filter((id) => id !== poseId)
                : [...rule.checkedPoses, poseId];
              updateRule(rule.id, { checkedPoses: next });
            };

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
                <div className={`grid grid-cols-1 ${hasPoseCheckboxes ? "md:grid-cols-[140px_1fr]" : "md:grid-cols-[140px_100px_1fr]"} gap-2`}>
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
                  {!hasPoseCheckboxes && (
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
                  )}
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
                {hasPoseCheckboxes && (
                  <div className="mt-2">
                    <div className="text-[11px] text-gray-400 mb-1.5">
                      {rule.scene === "model" ? "姿态" : rule.scene === "detail" ? "角度" : rule.scene === "flatlay" ? "构图" : "用途"}（勾选即生成，每个勾选项 = 1 张图）
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {presets.map((p) => {
                        const checked = rule.checkedPoses.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePose(p.id)}
                            className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                              checked
                                ? "border-banana-500 bg-banana-500/20 text-banana-400"
                                : "border-dark-600 bg-dark-800 text-gray-400 hover:text-gray-200 hover:border-dark-500"
                            }`}
                          >
                            {checked ? "✓ " : ""}{p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
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
            创建套图任务
          </button>
        </div>
      </div>
    </div>
  );
};
