import React, { useEffect, useMemo, useState } from 'react';
import type { VideoJob } from '@/types';
import { createAndRunVideoJob, deleteVideoJob, listVideoJobs, refreshVideoJob, rerunVideoJob } from '@/services/videoJobs';
import { Icon } from '@/components/Icon';
import { convertImageToUploadWebp } from '@/services/uploadPipeline';

const DEFAULT_MODEL_NAME = 'veo_3_1-fl';
const FIXED_DURATION_SEC = 8;
const DEFAULT_ASPECT_RATIO = '16:9';
const VEO_ASPECT_RATIO_OPTIONS = ['16:9', '9:16'];
const VEO_RESOLUTION_OPTIONS = ['1080p'];
const CANDIDATE_OPTIONS = [1, 2, 3, 4];
const AUTO_REFRESH_INTERVAL_MS = 5000;

const formatTime = (ts: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts);

const statusMeta: Record<VideoJob['status'], { label: string; className: string }> = {
  pending: { label: '待处理', className: 'bg-slate-100 text-slate-700' },
  processing: { label: '处理中', className: 'bg-amber-100 text-amber-700' },
  completed: { label: '已完成', className: 'bg-emerald-100 text-emerald-700' },
  failed: { label: '失败', className: 'bg-red-100 text-red-700' },
};

const PreviewCard: React.FC<{
  title: string;
  subtitle: string;
  previewUrl?: string;
  required?: boolean;
  onSelect: (file: File) => void;
}> = ({ title, subtitle, previewUrl, required, onSelect }) => (
  <label className="group relative flex min-h-[220px] cursor-pointer flex-col overflow-hidden rounded-2xl border border-dashed border-[var(--piveo-border)] bg-white transition hover:border-[var(--piveo-accent)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
    <input
      type="file"
      accept="image/*"
      className="sr-only"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) onSelect(file);
      }}
    />
    {previewUrl ? (
      <img src={previewUrl} alt={title} className="h-52 w-full object-cover" />
    ) : (
      <div className="flex h-52 items-center justify-center bg-[linear-gradient(135deg,#f8fafc,#eef2f6)] text-[var(--piveo-muted)]">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-[var(--piveo-accent)] shadow-sm">
            <Icon name="image" className="text-lg" />
          </div>
          <div className="text-sm font-medium text-[var(--piveo-text)]">{title}</div>
          <div className="mt-1 text-xs">{subtitle}</div>
        </div>
      </div>
    )}
    <div className="flex items-center justify-between border-t border-[var(--piveo-border)] px-4 py-3 text-xs">
      <div>
        <div className="font-medium text-[var(--piveo-text)]">{title}{required ? ' *' : ''}</div>
        <div className="text-[var(--piveo-muted)]">{subtitle}</div>
      </div>
      <span className="rounded-full bg-[#E7ECF3] px-3 py-1 font-medium text-[var(--piveo-accent)]">
        {previewUrl ? '更换' : '上传'}
      </span>
    </div>
  </label>
);

export const VideoGenerationPage: React.FC = () => {
  const promptFieldId = 'video-job-prompt';
  const [startFrameDataUrl, setStartFrameDataUrl] = useState<string>('');
  const [endFrameDataUrl, setEndFrameDataUrl] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_NAME);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('720p');
  const [candidateCount, setCandidateCount] = useState(1);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aspectRatioOptions = VEO_ASPECT_RATIO_OPTIONS;
  const resolutionOptions = VEO_RESOLUTION_OPTIONS;

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const next = await listVideoJobs();
      setJobs(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载视频历史失败。');
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    if (!aspectRatioOptions.includes(aspectRatio)) {
      setAspectRatio(DEFAULT_ASPECT_RATIO);
    }
    if (!resolutionOptions.includes(resolution)) {
      setResolution(resolutionOptions[0]);
    }
  }, [aspectRatio, aspectRatioOptions, resolution, resolutionOptions]);

  useEffect(() => {
    const pendingJobs = jobs.filter((job) => job.status === 'processing' || job.status === 'pending');
    if (pendingJobs.length === 0 || submitting) return;

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const refreshedJobs = await Promise.all(
            pendingJobs.map(async (job) => {
              try {
                return await refreshVideoJob(job);
              } catch {
                return job;
              }
            })
          );

          setJobs((prev) => {
            const nextById = new Map(refreshedJobs.map((job) => [job.id, job]));
            return prev.map((job) => nextById.get(job.id) ?? job);
          });
        } catch {
          // Auto refresh is best-effort. Users still have manual refresh available.
        }
      })();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [jobs, submitting]);

  const canSubmit = useMemo(
    () => Boolean(startFrameDataUrl) && Boolean(prompt.trim()) && !submitting,
    [startFrameDataUrl, prompt, submitting]
  );

  const handleFileSelect = async (file: File, kind: 'start' | 'end') => {
    setError(null);
    try {
      const converted = await convertImageToUploadWebp(file, 1920);
      if (kind === 'start') setStartFrameDataUrl(converted.output);
      else setEndFrameDataUrl(converted.output);
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片读取失败。');
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createAndRunVideoJob({
        prompt: prompt.trim(),
        startFrameDataUrl,
        endFrameDataUrl: endFrameDataUrl || undefined,
        aspectRatio,
        resolution,
        durationSec: FIXED_DURATION_SEC,
        candidateCount,
        model: selectedModel,
      });
      setJobs((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '视频生成失败。');
    } finally {
      setSubmitting(false);
      await loadHistory();
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!window.confirm('确定删除这个视频任务吗？删除后历史结果将一并移除。')) return;
    try {
      await deleteVideoJob(jobId);
      setJobs((prev) => prev.filter((job) => job.id !== jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败。');
    }
  };

  const handleRerun = async (job: VideoJob) => {
    setSubmitting(true);
    setError(null);
    try {
      const rerun = await rerunVideoJob(job);
      setJobs((prev) => [rerun, ...prev.filter((item) => item.id !== rerun.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新生成失败。');
    } finally {
      setSubmitting(false);
      await loadHistory();
    }
  };

  const handleRefreshJob = async (job: VideoJob) => {
    setSubmitting(true);
    setError(null);
    try {
      const refreshed = await refreshVideoJob(job);
      setJobs((prev) => [refreshed, ...prev.filter((item) => item.id !== refreshed.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新视频状态失败。');
    } finally {
      setSubmitting(false);
      await loadHistory();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--piveo-bg)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 xl:flex-row">
        <section className="xl:sticky xl:top-0 xl:w-[430px] xl:self-start">
          <div className="overflow-hidden rounded-[28px] border border-[var(--piveo-border)] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <div className="border-b border-[var(--piveo-border)] bg-[linear-gradient(135deg,#ffffff,#f5f7fb)] px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--piveo-muted)]">Video Studio</p>
                  <h1 className="mt-2 text-2xl font-semibold text-[var(--piveo-text)]">首尾帧生成视频</h1>
                  <p className="mt-2 text-sm text-[var(--piveo-body)]">
                    独立视频工作流，当前模型为 <span className="font-medium text-[var(--piveo-text)]">{selectedModel}</span>。
                  </p>
                </div>
                <div className="min-w-[170px] rounded-2xl bg-[#E7ECF3] px-3 py-2 text-right">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--piveo-muted)]">Model</div>
                  <div
                    aria-label="当前视频模型"
                    className="mt-2 w-full rounded-xl border border-white/70 bg-white px-3 py-2 text-sm font-semibold text-[var(--piveo-accent)]"
                  >
                    {selectedModel}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-5 p-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <PreviewCard
                  title="首帧"
                  subtitle="必填，决定起始画面"
                  previewUrl={startFrameDataUrl || undefined}
                  required
                  onSelect={(file) => void handleFileSelect(file, 'start')}
                />
                <PreviewCard
                  title="尾帧"
                  subtitle="可选，帮助控制收尾画面"
                  previewUrl={endFrameDataUrl || undefined}
                  onSelect={(file) => void handleFileSelect(file, 'end')}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor={promptFieldId} className="text-sm font-medium text-[var(--piveo-text)]">提示词 *</label>
                <textarea
                  id={promptFieldId}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  placeholder="描述你希望首尾帧之间发生的动作、镜头运动和整体氛围。"
                  className="w-full rounded-2xl border border-[var(--piveo-border)] bg-[#FCFCFD] px-4 py-3 text-sm text-[var(--piveo-text)] outline-none transition focus:border-[var(--piveo-accent)]"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm font-medium text-[var(--piveo-text)]">
                  时长
                  <div className="w-full rounded-xl border border-[var(--piveo-border)] bg-[#F6F8FB] px-3 py-2 text-sm font-normal text-[var(--piveo-text)]">
                    固定 8 秒
                  </div>
                </label>
                <label className="space-y-2 text-sm font-medium text-[var(--piveo-text)]">
                  比例
                  <select
                    aria-label="视频比例"
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    className="w-full rounded-xl border border-[var(--piveo-border)] bg-white px-3 py-2 text-sm font-normal text-[var(--piveo-text)]"
                  >
                    {aspectRatioOptions.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                  <div className="text-xs font-normal text-[var(--piveo-muted)]">
                    Veo 3.1 仅支持横屏和竖屏两种尺寸。
                  </div>
                </label>
                <label className="space-y-2 text-sm font-medium text-[var(--piveo-text)]">
                  分辨率
                  <select
                    aria-label="视频分辨率"
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    disabled
                    className="w-full rounded-xl border border-[var(--piveo-border)] bg-white px-3 py-2 text-sm font-normal text-[var(--piveo-text)]"
                  >
                    {resolutionOptions.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                  <div className="text-xs font-normal text-[var(--piveo-muted)]">
                    将分别提交为 `1920x1080` 或 `1080x1920`。
                  </div>
                </label>
                <label className="space-y-2 text-sm font-medium text-[var(--piveo-text)]">
                  候选数量
                  <select
                    value={candidateCount}
                    onChange={(e) => setCandidateCount(Number(e.target.value))}
                    className="w-full rounded-xl border border-[var(--piveo-border)] bg-white px-3 py-2 text-sm font-normal text-[var(--piveo-text)]"
                  >
                    {CANDIDATE_OPTIONS.map((value) => (
                      <option key={value} value={value}>{value} 条</option>
                    ))}
                  </select>
                </label>
              </div>

              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--piveo-accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--piveo-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon name={submitting ? 'spinner fa-spin' : 'play'} />
                {submitting ? '正在生成视频...' : '生成视频'}
              </button>
            </div>
          </div>
        </section>

        <section className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-3xl border border-[var(--piveo-border)] bg-white px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--piveo-text)]">视频历史</h2>
              <p className="text-sm text-[var(--piveo-body)]">预览、下载、删除和重新生成都在这里完成。</p>
            </div>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="rounded-full border border-[var(--piveo-border)] px-3 py-2 text-xs font-medium text-[var(--piveo-body)] transition hover:bg-[#EEF2F6]"
            >
              刷新历史
            </button>
          </div>

          {loadingHistory ? (
            <div className="rounded-3xl border border-[var(--piveo-border)] bg-white px-6 py-10 text-center text-sm text-[var(--piveo-body)]">
              正在加载视频历史...
            </div>
          ) : jobs.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[var(--piveo-border)] bg-[linear-gradient(135deg,#ffffff,#f7f9fc)] px-6 py-14 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#E7ECF3] text-[var(--piveo-accent)]">
                <Icon name="film" className="text-xl" />
              </div>
              <div className="text-lg font-medium text-[var(--piveo-text)]">还没有视频任务</div>
              <p className="mt-2 text-sm text-[var(--piveo-body)]">上传首帧，补一个可选尾帧，再写提示词，就可以开始第一条视频了。</p>
            </div>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => {
                const meta = statusMeta[job.status];
                return (
                  <article key={job.id} className="overflow-hidden rounded-3xl border border-[var(--piveo-border)] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--piveo-border)] px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-[var(--piveo-text)]">{job.title || 'VEO 视频任务'}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.className}`}>{meta.label}</span>
                        </div>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--piveo-body)]">{job.prompt}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--piveo-muted)]">
                          <span className="rounded-full bg-[#F6F8FB] px-2.5 py-1">{job.aspectRatio}</span>
                          <span className="rounded-full bg-[#F6F8FB] px-2.5 py-1">{job.resolution}</span>
                          <span className="rounded-full bg-[#F6F8FB] px-2.5 py-1">{job.durationSec} 秒</span>
                          <span className="rounded-full bg-[#F6F8FB] px-2.5 py-1">{job.candidateCount} 条候选</span>
                          <span className="rounded-full bg-[#F6F8FB] px-2.5 py-1">{formatTime(job.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRerun(job)}
                          disabled={submitting}
                          className="rounded-full border border-[var(--piveo-border)] px-3 py-2 text-xs font-medium text-[var(--piveo-body)] transition hover:bg-[#EEF2F6] disabled:opacity-50"
                        >
                          重新生成
                        </button>
                        {(job.status === 'processing' || job.status === 'pending') && (
                          <button
                            type="button"
                            onClick={() => void handleRefreshJob(job)}
                            disabled={submitting}
                            className="rounded-full border border-[var(--piveo-border)] px-3 py-2 text-xs font-medium text-[var(--piveo-body)] transition hover:bg-[#EEF2F6] disabled:opacity-50"
                          >
                            刷新状态
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDelete(job.id)}
                          className="rounded-full border border-red-200 px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          删除
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-4 p-5 lg:grid-cols-[220px,1fr]">
                      <div className="space-y-3">
                        <div>
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--piveo-muted)]">首帧</div>
                          <img src={job.startFrameUrl} alt="首帧" className="h-36 w-full rounded-2xl object-cover" />
                        </div>
                        {job.endFrameUrl && (
                          <div>
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--piveo-muted)]">尾帧</div>
                            <img src={job.endFrameUrl} alt="尾帧" className="h-36 w-full rounded-2xl object-cover" />
                          </div>
                        )}
                      </div>

                      <div className="space-y-3">
                        {job.errorMessage && (
                          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {job.errorMessage}
                          </div>
                        )}

                        {Boolean(job.upstreamTasks?.length) && (
                          <div className="rounded-2xl border border-[var(--piveo-border)] bg-[#FCFCFD] px-4 py-3 text-sm text-[var(--piveo-body)]">
                            <div className="mb-2 font-medium text-[var(--piveo-text)]">上游任务</div>
                            <div className="space-y-2">
                              {job.upstreamTasks?.map((task) => (
                                <div key={task.id} className="flex flex-wrap items-center gap-2 text-xs">
                                  <span className="rounded-full bg-[#F0F4F8] px-2 py-1 text-[var(--piveo-text)]">
                                    候选 {task.candidateIndex + 1}
                                  </span>
                                  <span className="rounded-full bg-[#F6F8FB] px-2 py-1">{task.status}</span>
                                  <code className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{task.id}</code>
                                  {task.errorMessage && (
                                    <span className="text-red-600">{task.errorMessage}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {job.results.length === 0 ? (
                          <div className="flex h-full min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-[var(--piveo-border)] bg-[#FCFCFD] text-sm text-[var(--piveo-body)]">
                            {job.status === 'processing' ? '视频正在生成中...' : '当前任务还没有可预览结果。'}
                          </div>
                        ) : (
                          <div className="grid gap-4 md:grid-cols-2">
                            {job.results.map((result, index) => (
                              <article key={result.id} className="overflow-hidden rounded-2xl border border-[var(--piveo-border)] bg-[#FCFCFD]">
                                <video src={result.videoUrl} controls playsInline className="aspect-video w-full bg-black" />
                                <div className="space-y-3 px-4 py-3">
                                  <div className="flex items-center justify-between text-sm text-[var(--piveo-text)]">
                                    <span className="font-medium">候选视频 {index + 1}</span>
                                    <span className="text-xs text-[var(--piveo-muted)]">{result.durationSec} 秒</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <a
                                      href={result.videoUrl}
                                      download={`veo31-video-${job.id}-${index + 1}.webm`}
                                      className="rounded-full bg-[var(--piveo-accent)] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[var(--piveo-accent-hover)]"
                                    >
                                      下载
                                    </a>
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
