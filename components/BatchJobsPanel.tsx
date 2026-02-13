import React, { useMemo, useState } from "react";
import { BatchJob, BatchJobStatus, BatchSlot, BatchVersion, ModelCharacter } from "../types";
import { Icon } from "./Icon";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { ModelPickerModal } from "./ModelPickerModal";
import { fileToDataUrl } from "../services/imageData";

interface BatchJobsPanelProps {
  jobs: BatchJob[];
  selectedJobId: string | null;
  isBusy?: boolean;
  models: ModelCharacter[];
  onSelectJob: (jobId: string) => void;
  onRunSlot: (jobId: string, slotId: string) => void;
  onSetPrimaryVersion: (jobId: string, slotId: string, versionId: string) => void;
  onOpenMaskEdit: (params: {
    jobId: string;
    slotId: string;
    versionId: string;
    baseImageUrl: string;
    historyItems: Array<{ id: string; imageUrl: string; title: string; subtitle?: string }>;
  }) => void;
  onArchiveJob: (jobId: string) => void;
  onRestoreJob: (jobId: string) => void;
  onSoftDeleteJob: (jobId: string) => void;
  onRecoverDeletedJob: (jobId: string) => void;
  onDuplicateJob: (jobId: string) => void;
  onDownloadVersion: (v: BatchVersion) => void;
  onCancelGeneration?: () => void;
  onUpdateJobImages: (jobId: string, updates: {
    productImageUrl?: string | null;
    modelImageUrl?: string | null;
  }) => void;
  onRunAllSlots?: (jobId: string, mode: "pending_only" | "all") => void;
  onCreateJob?: () => void;
  onUpdateJobBasePrompt?: (jobId: string, basePrompt: string) => void;
  onAddSlots?: (jobId: string) => void;
}

const STATUS_OPTIONS: Array<{ value: "all" | BatchJobStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "running", label: "生成中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
  { value: "archived", label: "已归档" },
  { value: "deleted", label: "回收站" },
];

const statusClass = (status: BatchJobStatus): string => {
  if (status === "running") return "text-banana-300 border-banana-500/40 bg-banana-500/10";
  if (status === "completed") return "text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
  if (status === "failed") return "text-red-300 border-red-500/40 bg-red-500/10";
  if (status === "archived") return "text-gray-300 border-gray-500/40 bg-dark-700";
  if (status === "deleted") return "text-gray-400 border-dark-500 bg-dark-800";
  return "text-sky-300 border-sky-500/40 bg-sky-500/10";
};

const statusLabel = (status: BatchJobStatus): string => {
  if (status === "draft") return "草稿";
  if (status === "running") return "生成中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "archived") return "已归档";
  if (status === "deleted") return "回收站";
  return status;
};

const fmtTime = (ts?: number): string => {
  if (!ts) return "-";
  return new Date(ts).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getActiveVersion = (slot: BatchSlot): BatchVersion | null => {
  if (!slot.versions.length) return null;
  const primary = slot.versions.find((v) => v.isPrimary);
  if (primary) return primary;
  if (slot.activeVersionId) {
    const byActive = slot.versions.find((v) => v.id === slot.activeVersionId);
    if (byActive) return byActive;
  }
  return slot.versions[slot.versions.length - 1] || null;
};

export const BatchJobsPanel: React.FC<BatchJobsPanelProps> = ({
  jobs,
  selectedJobId,
  isBusy,
  models,
  onSelectJob,
  onRunSlot,
  onSetPrimaryVersion,
  onOpenMaskEdit,
  onArchiveJob,
  onRestoreJob,
  onSoftDeleteJob,
  onRecoverDeletedJob,
  onDuplicateJob,
  onDownloadVersion,
  onCancelGeneration,
  onUpdateJobImages,
  onRunAllSlots,
  onCreateJob,
  onUpdateJobBasePrompt,
  onAddSlots,
}) => {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | BatchJobStatus>("all");
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [awaitingProductPaste, setAwaitingProductPaste] = useState(false);
  const [awaitingModelPaste, setAwaitingModelPaste] = useState(false);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);

  const filteredJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs
      .filter((job) => (statusFilter === "all" ? true : job.status === statusFilter))
      .filter((job) => {
        if (!q) return true;
        const slotText = job.slots.map((s) => `${s.title} ${s.promptTemplate}`).join(" ");
        const hay = `${job.title} ${job.projectId || ""} ${job.productId || ""} ${job.basePrompt || ""} ${slotText}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [jobs, query, statusFilter]);

  const selectedJob = useMemo(() => {
    if (!selectedJobId) return filteredJobs[0] || null;
    return jobs.find((j) => j.id === selectedJobId) || filteredJobs[0] || null;
  }, [jobs, filteredJobs, selectedJobId]);

  const selectJobAndFocus = (jobId: string) => {
    onSelectJob(jobId);
  };

  const handleProductImageUpload = async (jobId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      onUpdateJobImages(jobId, { productImageUrl: dataUrl });
    } catch (err) {
      console.error("产品图上传失败：", err);
      window.alert(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    }
    e.target.value = "";
  };

  const handleModelImageUpload = async (jobId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      onUpdateJobImages(jobId, { modelImageUrl: dataUrl });
    } catch (err) {
      console.error("模特图上传失败：", err);
      window.alert(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    }
    e.target.value = "";
  };

  const handleProductPaste = async (jobId: string, e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          try {
            const dataUrl = await fileToDataUrl(file);
            onUpdateJobImages(jobId, { productImageUrl: dataUrl });
            setAwaitingProductPaste(false);
          } catch (err) {
            console.error("粘贴产品图失败：", err);
            window.alert(`粘贴失败：${err instanceof Error ? err.message : String(err)}`);
          }
          return;
        }
      }
    }
  };

  const handleModelPaste = async (jobId: string, e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          try {
            const dataUrl = await fileToDataUrl(file);
            onUpdateJobImages(jobId, { modelImageUrl: dataUrl });
            setAwaitingModelPaste(false);
          } catch (err) {
            console.error("粘贴模特图失败：", err);
            window.alert(`粘贴失败：${err instanceof Error ? err.message : String(err)}`);
          }
          return;
        }
      }
    }
  };

  return (
    <>
    <div className="flex-1 min-h-0 h-full flex overflow-hidden">
      <aside className="w-[320px] border-r border-dark-700 bg-dark-800/70 flex flex-col min-h-0">
        <div className="p-3 border-b border-dark-700 space-y-2">
          <div className="text-sm font-semibold text-gray-100 flex items-center gap-2">
            <Icon name="layer-group" />
            套图工作台
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-8 rounded-md border border-dark-600 bg-dark-900 px-2 text-xs text-gray-200 placeholder-gray-500"
            placeholder="搜索任务/商品/关键词"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | BatchJobStatus)}
            className="w-full h-8 rounded-md border border-dark-600 bg-dark-900 px-2 text-xs text-gray-200"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {onCreateJob && (
            <button
              onClick={onCreateJob}
              className="w-full h-8 rounded-md border border-banana-500/40 bg-banana-500/10 text-banana-400 text-xs font-medium hover:bg-banana-500/20 transition-colors flex items-center justify-center gap-1.5"
            >
              <Icon name="plus" />
              新建套图任务
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar p-2 space-y-2">
          {filteredJobs.map((job) => {
            const active = selectedJob?.id === job.id;
            return (
              <button
                key={job.id}
                onClick={() => selectJobAndFocus(job.id)}
                className={`w-full text-left rounded-lg border p-2 transition-colors ${
                  active
                    ? "border-banana-500 bg-banana-500/10"
                    : "border-dark-700 bg-dark-900/40 hover:border-dark-500"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-gray-100 truncate">{job.title}</div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${statusClass(job.status)}`}>
                    {statusLabel(job.status)}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-gray-500 truncate">
                  {job.slots.length} 个槽位 · 更新 {fmtTime(job.updatedAt)}
                </div>
              </button>
            );
          })}
          {filteredJobs.length === 0 && <div className="text-xs text-gray-500 py-10 text-center">没有匹配的套图任务</div>}
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        {isBusy && onCancelGeneration && (
          <div className="px-4 py-3 bg-banana-500/10 border-b border-banana-500/30 flex items-center gap-3">
            <div className="animate-spin text-banana-400">
              <Icon name="spinner" />
            </div>
            <div className="flex-1">
              <div className="text-xs text-banana-300 font-medium">
                正在生成套图，请稍候...
              </div>
              <div className="text-[11px] text-banana-400/70 mt-0.5">
                生成完成后可在工作台查看结果
              </div>
            </div>
            <button
              onClick={onCancelGeneration}
              className="px-2.5 py-1.5 text-xs rounded-md border border-dark-600 bg-dark-900 text-gray-300 hover:bg-dark-700"
            >
              取消生成
            </button>
          </div>
        )}
        {!selectedJob ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">暂无套图任务</div>
        ) : (
          <>
            <div className="border-b border-dark-700 p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-base text-gray-100 font-semibold truncate">{selectedJob.title}</div>
                <div className="mt-1 text-[11px] text-gray-500">
                  创建 {fmtTime(selectedJob.createdAt)} · 更新 {fmtTime(selectedJob.updatedAt)} · {selectedJob.slots.length} 槽位
                </div>
              </div>
              <div className="flex items-center gap-2">
                {onRunAllSlots && selectedJob.status !== "deleted" && selectedJob.status !== "archived" && selectedJob.status !== "running" && (
                  <button
                    disabled={Boolean(isBusy)}
                    onClick={() => {
                      const hasCompleted = selectedJob.slots.some((s) => s.status === "completed");
                      if (hasCompleted) {
                        const choice = window.confirm("存在已完成的槽位。\n\n点击「确定」= 全部重跑\n点击「取消」= 只跑未完成的");
                        onRunAllSlots(selectedJob.id, choice ? "all" : "pending_only");
                      } else {
                        onRunAllSlots(selectedJob.id, "all");
                      }
                    }}
                    className="px-3 py-1.5 text-xs rounded-md border border-banana-500 bg-banana-500/20 text-banana-300 font-medium hover:bg-banana-500/30 disabled:opacity-50 transition-colors"
                  >
                    <Icon name="play" className="mr-1" />
                    开始工作
                  </button>
                )}
                <button
                  onClick={() => onDuplicateJob(selectedJob.id)}
                  className="px-2.5 py-1.5 text-xs rounded-md border border-dark-600 bg-dark-900 text-gray-200 hover:bg-dark-700"
                >
                  复制任务
                </button>
                {selectedJob.status !== "archived" && selectedJob.status !== "deleted" && (
                  <button
                    onClick={() => onArchiveJob(selectedJob.id)}
                    className="px-2.5 py-1.5 text-xs rounded-md border border-dark-600 bg-dark-900 text-gray-200 hover:bg-dark-700"
                  >
                    归档
                  </button>
                )}
                {selectedJob.status === "archived" && (
                  <button
                    onClick={() => onRestoreJob(selectedJob.id)}
                    className="px-2.5 py-1.5 text-xs rounded-md border border-dark-600 bg-dark-900 text-gray-200 hover:bg-dark-700"
                  >
                    恢复
                  </button>
                )}
                {selectedJob.status !== "deleted" && (
                  <button
                    onClick={() => {
                      if (window.confirm(`确定要删除任务"${selectedJob.title}"吗？`)) {
                        onSoftDeleteJob(selectedJob.id);
                      }
                    }}
                    className="px-2.5 py-1.5 text-xs rounded-md border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                  >
                    删除
                  </button>
                )}
                {selectedJob.status === "deleted" && (
                  <button
                    onClick={() => onRecoverDeletedJob(selectedJob.id)}
                    className="px-2.5 py-1.5 text-xs rounded-md border border-dark-600 bg-dark-900 text-gray-200 hover:bg-dark-700"
                  >
                    从回收站恢复
                  </button>
                )}
              </div>
            </div>

            {/* 基础提示词 */}
            <div className="border-b border-dark-700 px-4 py-3">
              <div className="text-[11px] text-gray-400 mb-1.5">基础提示词</div>
              <textarea
                value={selectedJob.basePrompt || ""}
                onChange={(e) => onUpdateJobBasePrompt?.(selectedJob.id, e.target.value)}
                placeholder="输入整体要求，例如：高端电商风格，突出产品质感..."
                rows={2}
                className="w-full rounded-md border border-dark-600 bg-dark-900 px-3 py-2 text-xs text-gray-200 placeholder-gray-500 resize-none focus:border-banana-500/50 focus:outline-none"
                disabled={selectedJob.status === "deleted"}
              />
            </div>

            {/* 套图专用图片上传区 */}
            <div className="border-b border-dark-700 p-3 bg-dark-900/20">
              <div className="text-xs text-gray-400 mb-2">套图专用图片（可选）</div>
              <div className="grid grid-cols-2 gap-3">
                {/* 产品图上传区 */}
                <div className="rounded-lg border border-dark-700 bg-dark-800/40 p-2 flex flex-col gap-2">
                  {selectedJob.productImageUrl ? (
                    <>
                      <img
                        src={selectedJob.productImageUrl}
                        alt="产品图"
                        className="w-full h-28 object-cover rounded-md border border-dark-600 bg-black/20 cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setPreviewImageUrl(selectedJob.productImageUrl!)}
                      />
                      <div className="flex gap-1">
                        <button
                          onClick={() => setAwaitingProductPaste(true)}
                          className={`flex-1 px-2 py-1 text-[10px] rounded border transition-colors ${
                            awaitingProductPaste
                              ? "border-banana-500/40 bg-banana-500/10 text-banana-400"
                              : "border-dark-600 bg-dark-800 text-gray-300 hover:border-gray-500"
                          }`}
                        >
                          粘贴更换
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('确定要删除产品图吗？')) {
                              onUpdateJobImages(selectedJob.id, { productImageUrl: null });
                            }
                          }}
                          disabled={selectedJob.status === "deleted"}
                          className="flex-1 px-2 py-1 text-[10px] rounded border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                        >
                          删除
                        </button>
                      </div>
                    </>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      onFocus={() => setAwaitingProductPaste(true)}
                      onBlur={() => setAwaitingProductPaste(false)}
                      onPaste={(e) => handleProductPaste(selectedJob.id, e)}
                      className={`w-full h-28 rounded-md border-2 border-dashed flex flex-col items-center justify-center text-xs cursor-pointer transition-colors outline-none ${
                        awaitingProductPaste
                          ? "border-banana-500 bg-banana-500/10 text-banana-400"
                          : "border-dark-600 bg-dark-900/40 text-gray-500 hover:border-gray-500 hover:text-gray-400"
                      }`}
                      onClick={() => document.getElementById(`product-input-${selectedJob.id}`)?.click()}
                    >
                      <Icon name="image" className="text-2xl mb-1" />
                      <span>{awaitingProductPaste ? "按 Cmd/Ctrl+V 粘贴" : "点击或粘贴产品图"}</span>
                      <input
                        id={`product-input-${selectedJob.id}`}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleProductImageUpload(selectedJob.id, e)}
                        disabled={selectedJob.status === "deleted"}
                      />
                    </div>
                  )}
                  <div className="text-[10px] text-gray-500 text-center">产品图</div>
                </div>

                {/* 模特图上传区 */}
                <div className="rounded-lg border border-dark-700 bg-dark-800/40 p-2 flex flex-col gap-2">
                  {selectedJob.modelImageUrl ? (
                    <>
                      <img
                        src={selectedJob.modelImageUrl}
                        alt="固定模特"
                        className="w-full h-28 object-cover rounded-md border border-dark-600 bg-black/20 cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setPreviewImageUrl(selectedJob.modelImageUrl!)}
                      />
                      <div className="flex gap-1">
                        <button
                          onClick={() => setIsModelPickerOpen(true)}
                          className="flex-1 px-2 py-1 text-[10px] rounded border border-dark-600 bg-dark-800 text-gray-300 hover:border-gray-500"
                        >
                          模特库
                        </button>
                        <button
                          onClick={() => setAwaitingModelPaste(true)}
                          className={`flex-1 px-2 py-1 text-[10px] rounded border transition-colors ${
                            awaitingModelPaste
                              ? "border-banana-500/40 bg-banana-500/10 text-banana-400"
                              : "border-dark-600 bg-dark-800 text-gray-300 hover:border-gray-500"
                          }`}
                        >
                          粘贴更换
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('确定要删除固定模特图吗？')) {
                              onUpdateJobImages(selectedJob.id, { modelImageUrl: null });
                            }
                          }}
                          disabled={selectedJob.status === "deleted"}
                          className="flex-1 px-2 py-1 text-[10px] rounded border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                        >
                          删除
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div
                        role="button"
                        tabIndex={0}
                        onFocus={() => setAwaitingModelPaste(true)}
                        onBlur={() => setAwaitingModelPaste(false)}
                        onPaste={(e) => handleModelPaste(selectedJob.id, e)}
                        className={`w-full h-20 rounded-md border-2 border-dashed flex flex-col items-center justify-center text-xs cursor-pointer transition-colors outline-none ${
                          awaitingModelPaste
                            ? "border-banana-500 bg-banana-500/10 text-banana-400"
                            : "border-dark-600 bg-dark-900/40 text-gray-500 hover:border-gray-500 hover:text-gray-400"
                        }`}
                        onClick={() => document.getElementById(`model-input-${selectedJob.id}`)?.click()}
                      >
                        <Icon name="user" className="text-lg mb-0.5" />
                        <span className="text-[10px]">{awaitingModelPaste ? "按 Cmd/Ctrl+V 粘贴" : "点击上传或粘贴"}</span>
                        <input
                          id={`model-input-${selectedJob.id}`}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleModelImageUpload(selectedJob.id, e)}
                          disabled={selectedJob.status === "deleted"}
                        />
                      </div>
                      <button
                        onClick={() => setIsModelPickerOpen(true)}
                        className="w-full py-1.5 text-[10px] rounded border border-banana-500/40 bg-banana-500/10 text-banana-400 hover:bg-banana-500/20 transition-colors"
                      >
                        <Icon name="users" className="mr-1" />
                        从模特库选择
                      </button>
                    </div>
                  )}
                  <div className="text-[10px] text-gray-500 text-center">固定模特</div>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar p-4 space-y-3">
              {selectedJob.slots.map((slot, idx) => {
                const current = getActiveVersion(slot);
                return (
                  <section key={slot.id} className="rounded-xl border border-dark-700 bg-dark-900/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-gray-100 font-medium truncate">
                          {idx + 1}. {slot.title}
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500 truncate">
                          {slot.promptTemplate || "无单独提示词"}
                        </div>
                        {slot.error && (
                          <div className="mt-1 text-[11px] text-red-300 truncate">
                            失败原因：{slot.error}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-dark-600 bg-dark-800 text-gray-300">
                          {slot.status === "pending" ? "待生成" : slot.status === "running" ? "生成中" : slot.status === "completed" ? "已完成" : "失败"}
                        </span>
                        <button
                          onClick={() => onRunSlot(selectedJob.id, slot.id)}
                          disabled={Boolean(isBusy) || selectedJob.status === "deleted"}
                          className="px-2.5 py-1.5 text-xs rounded-md border border-banana-500/40 bg-banana-500/10 text-banana-400 hover:bg-banana-500/20 disabled:opacity-50"
                        >
                          单独重跑
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3">
                      <div className="rounded-lg border border-dark-700 bg-dark-800/40 p-2 flex flex-col">
                        {current?.imageUrl ? (
                          <img
                            src={current.imageUrl}
                            alt={slot.title}
                            onClick={() => setPreviewImageUrl(current.imageUrl!)}
                            className="w-full h-56 object-cover rounded-md border border-dark-600 bg-black/20 cursor-pointer hover:opacity-90 transition-opacity"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="w-full h-56 rounded-md border border-dark-700 bg-dark-900/40 text-xs text-gray-500 flex items-center justify-center">
                            暂无产出
                          </div>
                        )}

                        {current && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button
                              onClick={() => onSetPrimaryVersion(selectedJob.id, slot.id, current.id)}
                              className="px-2 py-1 text-[10px] rounded border border-dark-600 bg-dark-900 text-gray-200 hover:bg-dark-700"
                            >
                              设为主图
                            </button>
                            <button
                              onClick={() => onDownloadVersion(current)}
                              className="px-2 py-1 text-[10px] rounded border border-dark-600 bg-dark-900 text-gray-200 hover:bg-dark-700"
                            >
                              下载
                            </button>
                            <button
                              onClick={() => {
                                if (!current.imageUrl) return;
                                const historyItems = slot.versions
                                  .filter((v) => v.imageUrl)
                                  .sort((a, b) => b.createdAt - a.createdAt)
                                  .map((v) => ({
                                    id: v.id,
                                    imageUrl: v.imageUrl as string,
                                    title: `${slot.title} · v${v.index}`,
                                    subtitle: fmtTime(v.createdAt),
                                  }));
                                onOpenMaskEdit({
                                  jobId: selectedJob.id,
                                  slotId: slot.id,
                                  versionId: current.id,
                                  baseImageUrl: current.imageUrl,
                                  historyItems,
                                });
                              }}
                              disabled={!current.imageUrl || selectedJob.status === "deleted"}
                              className="px-2 py-1 text-[10px] rounded border border-dark-600 bg-dark-900 text-gray-200 hover:bg-dark-700 disabled:opacity-50"
                            >
                              局部编辑
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="text-[11px] text-gray-400 mb-2">版本历史（可切换）</div>
                        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                          {slot.versions
                            .slice()
                            .sort((a, b) => b.createdAt - a.createdAt)
                            .map((v) => {
                              const active = current?.id === v.id;
                              return (
                                <button
                                  key={v.id}
                                  onClick={() => onSetPrimaryVersion(selectedJob.id, slot.id, v.id)}
                                  className={`rounded-lg border overflow-hidden text-left ${
                                    active ? "border-banana-500" : "border-dark-700 hover:border-dark-500"
                                  }`}
                                >
                                  <div className="w-full h-24 bg-dark-900/50">
                                    {v.imageUrl ? (
                                      <img
                                        src={v.imageUrl}
                                        alt={`v${v.index}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPreviewImageUrl(v.imageUrl!);
                                        }}
                                        className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                        loading="lazy"
                                        decoding="async"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-500">无图</div>
                                    )}
                                  </div>
                                  <div className="px-2 py-1.5 bg-dark-900/60">
                                    <div className="text-[10px] text-gray-200">v{v.index}</div>
                                    <div className="text-[10px] text-gray-500 truncate">{fmtTime(v.createdAt)}</div>
                                  </div>
                                </button>
                              );
                            })}
                          {slot.versions.length === 0 && (
                            <div className="col-span-full text-xs text-gray-500 border border-dashed border-dark-600 rounded-lg p-4 text-center">
                              该槽位暂无产出版本
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}
              {selectedJob.status !== "deleted" && selectedJob.status !== "archived" && onAddSlots && (
                <button
                  onClick={() => onAddSlots(selectedJob.id)}
                  className="w-full py-3 rounded-xl border-2 border-dashed border-dark-600 text-xs text-gray-400 hover:border-banana-500/40 hover:text-banana-400 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Icon name="plus" />
                  添加槽位
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
    {previewImageUrl && (
      <ImagePreviewModal
        imageUrl={previewImageUrl}
        onClose={() => setPreviewImageUrl(null)}
      />
    )}
    {isModelPickerOpen && selectedJob && (
      <ModelPickerModal
        models={models}
        onSelect={(model) => {
          onUpdateJobImages(selectedJob.id, { modelImageUrl: model.imageUrl });
          setIsModelPickerOpen(false);
        }}
        onClose={() => setIsModelPickerOpen(false)}
      />
    )}
  </>
  );
};
