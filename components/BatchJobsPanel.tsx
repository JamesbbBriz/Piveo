import React, { useEffect, useMemo, useRef, useState } from "react";
import { BatchJob, BatchJobStatus, BatchSlot, BatchVersion, ModelCharacter } from "../types";
import { Icon } from "./Icon";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { DownloadOptionsModal } from "./DownloadOptionsModal";
import { downloadImageWithFormat, loadDownloadOptions, saveDownloadOptions, DownloadOptions } from "../services/imageDownload";
import { useToast } from "./Toast";

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
  onRunAllSlots?: (jobId: string, mode: "pending_only" | "all") => void;
  onCreateJob?: () => void;
  onRenameJob: (jobId: string, newTitle: string) => void;
  onAddSlots?: (jobId: string) => void;
  onRefineSlot?: (jobId: string, slotId: string, instruction: string) => void;
  refiningSlotIds?: Set<string>;
  onGoBack?: () => void;
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

const fmtShort = (ts?: number): string => {
  if (!ts) return "-";
  return new Date(ts).toLocaleString([], {
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
  onRunAllSlots,
  onCreateJob,
  onRenameJob,
  onAddSlots,
  onRefineSlot,
  refiningSlotIds,
  onGoBack,
}) => {
  const { addToast } = useToast();
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [refineTexts, setRefineTexts] = useState<Record<string, string>>({});
  const [downloadOptions, setDownloadOptions] = useState<DownloadOptions>(loadDownloadOptions);
  const [pendingDownload, setPendingDownload] = useState<{ version: BatchVersion } | null>(null);
  const [jobSelectorOpen, setJobSelectorOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | BatchJobStatus>("all");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const jobSelectorRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const confirmDownload = async () => {
    if (!pendingDownload?.version.imageUrl) return;
    saveDownloadOptions(downloadOptions);
    await downloadImageWithFormat(pendingDownload.version.imageUrl, {
      basename: `topseller-batch-${pendingDownload.version.id}`,
      quality: downloadOptions.quality,
    });
    setPendingDownload(null);
  };

  // Close dropdowns on outside click
  useEffect(() => {
    if (!jobSelectorOpen && !moreMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (jobSelectorOpen && jobSelectorRef.current && !jobSelectorRef.current.contains(e.target as Node)) {
        setJobSelectorOpen(false);
      }
      if (moreMenuOpen && moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [jobSelectorOpen, moreMenuOpen]);

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

  const hasPendingOrFailed = selectedJob?.slots.some((s) => s.status === "pending" || s.status === "failed");

  return (
    <>
    <div className="flex-1 min-h-0 h-full flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="px-3 py-2 border-b border-dark-700 bg-dark-800/70 flex items-center gap-2 shrink-0">
        {onGoBack && (
          <button
            onClick={onGoBack}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-md text-gray-300 hover:text-gray-100 hover:bg-dark-700 transition-colors shrink-0"
          >
            <Icon name="arrow-left" className="text-[10px]" />
            返回图库
          </button>
        )}

        {/* Job selector dropdown */}
        <div className="relative flex-1 min-w-0" ref={jobSelectorRef}>
          <button
            onClick={() => setJobSelectorOpen((v) => !v)}
            className="flex items-center gap-1.5 min-w-0 max-w-[300px] px-2 py-1.5 rounded-md hover:bg-dark-700 transition-colors"
          >
            <span className="text-sm text-gray-100 font-medium truncate">
              {selectedJob?.title || "选择任务"}
            </span>
            <Icon name="chevron-down" className="text-[10px] text-gray-400 shrink-0" />
          </button>

          {jobSelectorOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 w-80 rounded-lg border border-dark-600 bg-dark-800 shadow-2xl">
              <div className="p-2 border-b border-dark-700 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="flex-1 min-w-0 h-7 rounded-md border border-dark-600 bg-dark-900 px-2 text-xs text-gray-200 placeholder-gray-500"
                    placeholder="搜索任务"
                    autoFocus
                  />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as "all" | BatchJobStatus)}
                    className="h-7 rounded-md border border-dark-600 bg-dark-900 px-1.5 text-xs text-gray-200 shrink-0"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto custom-scrollbar py-1">
                {filteredJobs.map((job) => {
                  const active = selectedJob?.id === job.id;
                  return (
                    <button
                      key={job.id}
                      className={`w-full text-left px-3 py-2 transition-colors ${
                        active ? "bg-dark-700" : "hover:bg-dark-700/60"
                      }`}
                      onClick={() => {
                        onSelectJob(job.id);
                        setJobSelectorOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="text-xs text-gray-100 truncate flex-1 min-w-0">{job.title}</div>
                        <span className={`text-[10px] px-1.5 py-px rounded-full border shrink-0 ${statusClass(job.status)}`}>
                          {statusLabel(job.status)}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-500 truncate mt-0.5">
                        {job.slots.length}槽 · {fmtShort(job.updatedAt)}
                      </div>
                    </button>
                  );
                })}
                {filteredJobs.length === 0 && (
                  <div className="text-xs text-gray-500 py-6 text-center">没有匹配的矩阵任务</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Status badge */}
        {selectedJob && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${statusClass(selectedJob.status)}`}>
            {statusLabel(selectedJob.status)}
          </span>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Run pending/failed button */}
          {onRunAllSlots && selectedJob && hasPendingOrFailed &&
            selectedJob.status !== "deleted" && selectedJob.status !== "archived" && selectedJob.status !== "running" && (
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
              生成未完成
            </button>
          )}

          {/* Create new job */}
          {onCreateJob && (
            <button
              onClick={onCreateJob}
              className="px-2.5 py-1.5 text-xs rounded-md border border-dark-600 bg-dark-900 text-gray-300 hover:text-gray-100 hover:bg-dark-700 transition-colors"
              title="新建矩阵任务"
            >
              <Icon name="plus" />
            </button>
          )}

          {/* More menu */}
          {selectedJob && (
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setMoreMenuOpen((v) => !v)}
                className="px-2 py-1.5 text-xs rounded-md border border-dark-600 bg-dark-900 text-gray-400 hover:text-gray-200 hover:bg-dark-700 transition-colors"
              >
                <Icon name="ellipsis-vertical" />
              </button>
              {moreMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-md border border-dark-600 bg-dark-800 shadow-xl py-1">
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-dark-700 transition-colors"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      const newTitle = window.prompt("重命名任务", selectedJob.title);
                      if (newTitle && newTitle.trim()) {
                        onRenameJob(selectedJob.id, newTitle.trim());
                      }
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-dark-700 transition-colors"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      onDuplicateJob(selectedJob.id);
                    }}
                  >
                    复制任务
                  </button>
                  {selectedJob.status !== "archived" && selectedJob.status !== "deleted" && (
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-dark-700 transition-colors"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        onArchiveJob(selectedJob.id);
                      }}
                    >
                      归档
                    </button>
                  )}
                  {selectedJob.status === "archived" && (
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-dark-700 transition-colors"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        onRestoreJob(selectedJob.id);
                      }}
                    >
                      恢复
                    </button>
                  )}
                  {selectedJob.status !== "deleted" && (
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs text-red-300 hover:bg-dark-700 transition-colors"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        if (window.confirm(`确定要删除任务"${selectedJob.title}"吗？`)) {
                          onSoftDeleteJob(selectedJob.id);
                        }
                      }}
                    >
                      删除
                    </button>
                  )}
                  {selectedJob.status === "deleted" && (
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-dark-700 transition-colors"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        onRecoverDeletedJob(selectedJob.id);
                      }}
                    >
                      从回收站恢复
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Busy banner */}
      {isBusy && onCancelGeneration && (
        <div className="px-4 py-3 bg-banana-500/10 border-b border-banana-500/30 flex items-center gap-3 shrink-0">
          <div className="animate-spin text-banana-400">
            <Icon name="spinner" />
          </div>
          <div className="flex-1">
            <div className="text-xs text-banana-300 font-medium">
              正在生成矩阵，请稍候...
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

      {/* Main content area */}
      {!selectedJob ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">暂无矩阵任务</div>
      ) : (
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
                          onClick={() => setPendingDownload({ version: current })}
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
                {/* 内联调整输入框 */}
                {onRefineSlot && current?.imageUrl && selectedJob.status !== "deleted" && selectedJob.status !== "archived" && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={refineTexts[slot.id] || ""}
                      onChange={(e) => setRefineTexts((prev) => ({ ...prev, [slot.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          const text = (refineTexts[slot.id] || "").trim();
                          if (!text) return;
                          onRefineSlot(selectedJob.id, slot.id, text);
                          setRefineTexts((prev) => ({ ...prev, [slot.id]: "" }));
                        }
                      }}
                      placeholder="输入调整指令，如：背景换成户外、产品颜色更亮..."
                      disabled={Boolean(isBusy) || Boolean(refiningSlotIds?.has(slot.id))}
                      className="flex-1 h-8 rounded-md border border-dark-600 bg-dark-900 px-3 text-xs text-gray-200 placeholder-gray-500 focus:border-banana-500/50 focus:outline-none disabled:opacity-50"
                    />
                    <button
                      onClick={() => {
                        const text = (refineTexts[slot.id] || "").trim();
                        if (!text) return;
                        onRefineSlot(selectedJob.id, slot.id, text);
                        setRefineTexts((prev) => ({ ...prev, [slot.id]: "" }));
                      }}
                      disabled={Boolean(isBusy) || Boolean(refiningSlotIds?.has(slot.id)) || !(refineTexts[slot.id] || "").trim()}
                      className="h-8 px-3 rounded-md border border-banana-500/40 bg-banana-500/10 text-banana-400 text-xs font-medium hover:bg-banana-500/20 disabled:opacity-50 transition-colors shrink-0"
                    >
                      {refiningSlotIds?.has(slot.id) ? "优化中..." : "发送"}
                    </button>
                  </div>
                )}
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
      )}
    </div>
    {previewImageUrl && (
      <ImagePreviewModal
        imageUrl={previewImageUrl}
        onClose={() => setPreviewImageUrl(null)}
      />
    )}
    <DownloadOptionsModal
      isOpen={pendingDownload !== null}
      options={downloadOptions}
      onChange={setDownloadOptions}
      onCancel={() => setPendingDownload(null)}
      onConfirm={() => void confirmDownload()}
      confirmLabel="开始下载"
      imageUrl={pendingDownload?.version.imageUrl}
    />
  </>
  );
};
