import React, { useMemo, useState } from "react";
import { BatchJob, BatchJobStatus, BatchSlot, BatchVersion } from "../types";
import { Icon } from "./Icon";

interface BatchJobsPanelProps {
  jobs: BatchJob[];
  selectedJobId: string | null;
  isBusy?: boolean;
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
}) => {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | BatchJobStatus>("all");

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

  return (
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
                    onClick={() => onSoftDeleteJob(selectedJob.id)}
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
                            className="w-full h-56 object-cover rounded-md border border-dark-600 bg-black/20"
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
                                        className="w-full h-full object-cover"
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
            </div>
          </>
        )}
      </main>
    </div>
  );
};
