import { v4 as uuidv4 } from 'uuid';
import type { VideoJob, VideoJobResult, VideoJobStatus, VideoJobTask } from '@/types';
import { fetchUpstreamVideoTask, startFrameToFrameVideo } from './videoGeneration';

type UploadBlobResponse = { ok: true; id: string; url: string };

export interface CreateVideoJobInput {
  prompt: string;
  startFrameDataUrl: string;
  endFrameDataUrl?: string;
  aspectRatio: string;
  resolution: string;
  durationSec: number;
  candidateCount: number;
  model?: string;
}

const DEFAULT_MODEL = 'veo_3_1-fl';
const FIXED_DURATION_SEC = 8;

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(String((json as any)?.message || `HTTP ${resp.status}`));
  }
  return json as T;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.readAsDataURL(blob);
  });

const inferDataUrlMimeType = (dataUrl: string, fallback: string) => {
  const match = /^data:([^;,]+)[;,]/i.exec(String(dataUrl || ''));
  return match?.[1] || fallback;
};

const uploadDataUrl = async (dataUrl: string, contentType?: string) => {
  const json = await fetchJson<UploadBlobResponse>('/api/data/blobs', {
    method: 'POST',
    body: JSON.stringify({
      data: dataUrl,
      contentType: contentType || inferDataUrlMimeType(dataUrl, 'application/octet-stream'),
    }),
  });
  return { blobId: json.id, url: json.url };
};

const mapVideoResult = (result: any): VideoJobResult => ({
  id: String(result.id),
  blobId: result.blob_id ?? undefined,
  videoUrl: result.blob_id ? `/api/data/blobs/${result.blob_id}` : String(result.source_url || ''),
  durationSec: Number(result.duration_sec) || 8,
  mimeType: result.mime_type ?? undefined,
  fallback: Boolean(result.fallback),
  fallbackReason: result.fallback_reason ?? undefined,
  createdAt: Number(result.created_at) || Date.now(),
});

const parseVideoMetadata = (raw: unknown): { upstreamTasks: VideoJobTask[] } => {
  if (typeof raw !== 'string' || !raw.trim()) return { upstreamTasks: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      upstreamTasks: Array.isArray(parsed?.upstreamTasks) ? parsed.upstreamTasks : [],
    };
  } catch {
    return { upstreamTasks: [] };
  }
};

const mapVideoJob = (row: any): VideoJob => {
  const metadata = parseVideoMetadata(row.metadata_json);
  return {
  id: String(row.id),
  title: String(row.title || ''),
  model: String(row.model || DEFAULT_MODEL),
  status: String(row.status || 'pending') as VideoJobStatus,
  prompt: String(row.prompt || ''),
  startFrameUrl: row.start_blob_id ? `/api/data/blobs/${row.start_blob_id}` : '',
  startBlobId: row.start_blob_id ?? undefined,
  endFrameUrl: row.end_blob_id ? `/api/data/blobs/${row.end_blob_id}` : undefined,
  endBlobId: row.end_blob_id ?? undefined,
  aspectRatio: String(row.aspect_ratio || '16:9'),
  resolution: String(row.resolution || '720p'),
  durationSec: Number(row.duration_sec) || 8,
  candidateCount: Number(row.candidate_count) || 1,
  errorMessage: row.error_message ?? undefined,
  upstreamTasks: metadata.upstreamTasks,
  results: Array.isArray(row.results) ? row.results.map(mapVideoResult) : [],
  createdAt: Number(row.created_at) || Date.now(),
  updatedAt: Number(row.updated_at) || Date.now(),
  };
};

const saveVideoJob = async (payload: {
  id: string;
  title?: string;
  model?: string;
  status: VideoJobStatus;
  prompt: string;
  startBlobId: string;
  endBlobId?: string;
  aspectRatio: string;
  resolution: string;
  durationSec: number;
  candidateCount: number;
  errorMessage?: string | null;
  upstreamTasks?: VideoJobTask[];
  results?: Array<{
    id: string;
    blobId?: string;
    sourceUrl?: string;
    durationSec: number;
    mimeType?: string;
    fallback?: boolean;
    fallbackReason?: string;
    createdAt: number;
  }>;
}) => {
  await fetchJson(`/api/data/video-jobs/${payload.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: payload.title ?? '',
      model: payload.model ?? DEFAULT_MODEL,
      status: payload.status,
      prompt: payload.prompt,
      start_blob_id: payload.startBlobId,
      end_blob_id: payload.endBlobId ?? null,
      aspect_ratio: payload.aspectRatio,
      resolution: payload.resolution,
      duration_sec: payload.durationSec,
      candidate_count: payload.candidateCount,
      error_message: payload.errorMessage ?? null,
      metadata_json: JSON.stringify({
        upstreamTasks: payload.upstreamTasks ?? [],
      }),
      results_json: JSON.stringify(
        (payload.results ?? []).map((result) => ({
          id: result.id,
          blob_id: result.blobId ?? null,
          source_url: result.sourceUrl ?? null,
          duration_sec: result.durationSec,
          mime_type: result.mimeType ?? null,
          fallback: Boolean(result.fallback),
          fallback_reason: result.fallbackReason ?? null,
          created_at: result.createdAt,
        }))
      ),
    }),
  });
};

const persistVideoResult = async (url: string, fallbackMimeType?: string) => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`视频结果获取失败（HTTP ${resp.status}）`);
  const blob = await resp.blob();
  const dataUrl = await blobToDataUrl(blob);
  const uploaded = await uploadDataUrl(dataUrl, blob.type || fallbackMimeType || 'video/webm');
  return {
    blobId: uploaded.blobId,
    url: uploaded.url,
    mimeType: blob.type || fallbackMimeType || 'video/webm',
  };
};

export const listVideoJobs = async (): Promise<VideoJob[]> => {
  const json = await fetchJson<{ videoJobs: any[] }>('/api/data/video-jobs');
  return (json.videoJobs ?? []).map(mapVideoJob);
};

export const deleteVideoJob = async (jobId: string): Promise<void> => {
  await fetchJson(`/api/data/video-jobs/${jobId}`, { method: 'DELETE' });
};

const isTerminalTaskStatus = (status: string) => ['completed', 'succeeded', 'failed', 'error', 'cancelled'].includes(String(status || '').toLowerCase());

export const rerunVideoJob = async (job: VideoJob): Promise<VideoJob> => {
  const startFrameResp = await fetch(job.startFrameUrl);
  if (!startFrameResp.ok) throw new Error('首帧素材加载失败，无法重新生成。');
  const startFrameDataUrl = await blobToDataUrl(await startFrameResp.blob());

  let endFrameDataUrl: string | undefined;
  if (job.endFrameUrl) {
    const endFrameResp = await fetch(job.endFrameUrl);
    if (endFrameResp.ok) {
      endFrameDataUrl = await blobToDataUrl(await endFrameResp.blob());
    }
  }

  return await createAndRunVideoJob({
    prompt: job.prompt,
    startFrameDataUrl,
    endFrameDataUrl,
    aspectRatio: job.aspectRatio,
    resolution: job.resolution,
    durationSec: FIXED_DURATION_SEC,
    candidateCount: job.candidateCount,
    model: job.model,
  });
};

export const createAndRunVideoJob = async (input: CreateVideoJobInput): Promise<VideoJob> => {
  const id = uuidv4();
  const model = input.model || DEFAULT_MODEL;
  const title = input.prompt.trim().slice(0, 32) || 'VEO 视频任务';
  const startUpload = await uploadDataUrl(input.startFrameDataUrl);
  const endUpload = input.endFrameDataUrl ? await uploadDataUrl(input.endFrameDataUrl) : null;

  await saveVideoJob({
    id,
    title,
    model,
    status: 'processing',
    prompt: input.prompt,
    startBlobId: startUpload.blobId,
    endBlobId: endUpload?.blobId,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    durationSec: FIXED_DURATION_SEC,
    candidateCount: input.candidateCount,
    results: [],
  });

  try {
    const results = [];
    const failures: string[] = [];
    const upstreamTasks: VideoJobTask[] = [];
    for (let i = 0; i < input.candidateCount; i++) {
      try {
        const generated = await startFrameToFrameVideo({
          imageUrl: input.startFrameDataUrl,
          lastFrameImageUrl: input.endFrameDataUrl,
          durationSec: FIXED_DURATION_SEC,
          prompt: input.prompt,
          model,
          aspectRatio: input.aspectRatio,
          resolution: input.resolution,
        });
        if (generated.url) {
          const persisted = await persistVideoResult(generated.url, 'video/webm');
          results.push({
            id: uuidv4(),
            blobId: persisted.blobId,
            sourceUrl: persisted.url,
            durationSec: FIXED_DURATION_SEC,
            mimeType: persisted.mimeType,
            fallback: generated.fallback,
            fallbackReason: generated.fallbackReason,
            createdAt: Date.now(),
          });
        } else {
          upstreamTasks.push({
            id: generated.id,
            candidateIndex: i,
            status: generated.status || 'queued',
          });
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `候选视频 ${i + 1} 生成失败。`);
      }
    }

    const finalStatus: VideoJobStatus = upstreamTasks.length > 0
      ? 'processing'
      : results.length > 0
        ? 'completed'
        : 'failed';
    const finalErrorMessage = failures.length > 0
      ? `共 ${failures.length} 条候选生成失败。${failures[0]}`
      : undefined;

    await saveVideoJob({
      id,
      title,
      model,
      status: finalStatus,
      prompt: input.prompt,
      startBlobId: startUpload.blobId,
      endBlobId: endUpload?.blobId,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      durationSec: FIXED_DURATION_SEC,
      candidateCount: input.candidateCount,
      errorMessage: finalErrorMessage,
      upstreamTasks,
      results,
    });

    if (results.length === 0 && upstreamTasks.length === 0) {
      throw new Error(finalErrorMessage || '视频生成失败。');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '视频生成失败。';
    await saveVideoJob({
      id,
      title,
      model,
      status: 'failed',
      prompt: input.prompt,
      startBlobId: startUpload.blobId,
      endBlobId: endUpload?.blobId,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      durationSec: FIXED_DURATION_SEC,
      candidateCount: input.candidateCount,
      errorMessage: message,
      results: [],
    });
    throw error;
  }

  const jobs = await listVideoJobs();
  const created = jobs.find((job) => job.id === id);
  if (!created) throw new Error('视频任务保存成功，但重新读取失败。');
  return created;
};

export const refreshVideoJob = async (job: VideoJob): Promise<VideoJob> => {
  const pendingTasks = (job.upstreamTasks ?? []).filter((task) => !isTerminalTaskStatus(task.status));
  if (pendingTasks.length === 0) {
    return job;
  }

  const nextTasks = [...(job.upstreamTasks ?? [])];
  const nextResults = [...job.results];
  const failures: string[] = [];

  for (const task of pendingTasks) {
    try {
      const state = await fetchUpstreamVideoTask(task.id);
      const taskIndex = nextTasks.findIndex((item) => item.id === task.id);
      const normalizedStatus = String(state.status || '').toLowerCase();
      if ((normalizedStatus === 'completed' || normalizedStatus === 'succeeded') && !state.url) {
        throw new Error('视频任务已完成，但上游未返回视频地址。');
      }
      if (taskIndex >= 0) {
        nextTasks[taskIndex] = {
          ...nextTasks[taskIndex],
          status: normalizedStatus || nextTasks[taskIndex].status,
          videoUrl: state.url || nextTasks[taskIndex].videoUrl,
          checkedAt: Date.now(),
          errorMessage: undefined,
        };
      }
      if (state.url && !nextResults.some((result) => result.videoUrl === state.url)) {
        const persisted = await persistVideoResult(state.url, 'video/mp4');
        nextResults.push({
          id: uuidv4(),
          blobId: persisted.blobId,
          sourceUrl: persisted.url,
          durationSec: FIXED_DURATION_SEC,
          mimeType: persisted.mimeType,
          createdAt: Date.now(),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频状态刷新失败。';
      failures.push(message);
      const taskIndex = nextTasks.findIndex((item) => item.id === task.id);
      if (taskIndex >= 0) {
        nextTasks[taskIndex] = {
          ...nextTasks[taskIndex],
          status: 'failed',
          checkedAt: Date.now(),
          errorMessage: message,
        };
      }
    }
  }

  const hasPending = nextTasks.some((task) => !isTerminalTaskStatus(task.status));
  const hasSuccess = nextResults.length > 0;
  const nextStatus: VideoJobStatus = hasPending ? 'processing' : hasSuccess ? 'completed' : 'failed';
  const errorMessage = failures.length > 0 ? failures[0] : undefined;

  await saveVideoJob({
    id: job.id,
    title: job.title,
    model: job.model,
    status: nextStatus,
    prompt: job.prompt,
    startBlobId: job.startBlobId || '',
    endBlobId: job.endBlobId,
    aspectRatio: job.aspectRatio,
    resolution: job.resolution,
    durationSec: job.durationSec,
    candidateCount: job.candidateCount,
    errorMessage,
    upstreamTasks: nextTasks,
    results: nextResults.map((result) => ({
      id: result.id,
      blobId: result.blobId,
      sourceUrl: result.videoUrl,
      durationSec: result.durationSec,
      mimeType: result.mimeType,
      fallback: result.fallback,
      fallbackReason: result.fallbackReason,
      createdAt: result.createdAt,
    })),
  });

  const jobs = await listVideoJobs();
  const refreshed = jobs.find((item) => item.id === job.id);
  if (!refreshed) throw new Error('视频任务刷新成功，但重新读取失败。');
  return refreshed;
};
