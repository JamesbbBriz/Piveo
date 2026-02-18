export type QueueSource = "chat" | "batch" | "mask-edit" | "model-gen";

export type QueueState = "IDLE" | "RUNNING" | "PAUSED_UNTIL" | "DEGRADED";

export interface QueuePolicy {
  initialMaxInFlight: number;
  maxPending: number;
  enqueueTimeoutMs: number;
  metricsWindowSize: number;
  degradeErrorRate: number;
  degradeP95Ms: number;
  recoverErrorRate: number;
  recoverP95Ms: number;
  recoverCooldownMs: number;
}

export interface AdaptiveMetrics {
  windowSize: number;
  errorRate: number;
  p95LatencyMs: number;
  last429At?: number;
}

export interface QueueStats {
  inFlight: number;
  pending: number;
  rejected: number;
  maxInFlight: number;
  state: QueueState;
  pausedUntil?: number;
  metrics: AdaptiveMetrics;
}

interface QueueOutcome {
  status?: number;
  latencyMs: number;
  networkError?: boolean;
  retryAfterSec?: number;
}

interface QueueTask<T> {
  id: string;
  source: QueueSource;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  deadlineAt: number;
  abortHandler?: () => void;
}

interface EnqueueOptions {
  source: QueueSource;
  signal?: AbortSignal;
}

type QueueListener = (stats: QueueStats) => void;

interface QueueOutcomePoint {
  at: number;
  status?: number;
  latencyMs: number;
  networkError?: boolean;
}

const toPositiveInt = (raw: unknown, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return v >= 0 ? v : fallback;
};

const toPositiveNumber = (raw: unknown, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
};

const env = (import.meta as any)?.env || {};

const policy: QueuePolicy = {
  initialMaxInFlight: Math.min(Math.max(toPositiveInt(env.VITE_QUEUE_INITIAL_MAX_INFLIGHT, 2), 1), 2),
  maxPending: Math.max(1, toPositiveInt(env.VITE_CHAT_QUEUE_MAX_PENDING, 20)),
  enqueueTimeoutMs: Math.max(1000, toPositiveInt(env.VITE_QUEUE_ENQUEUE_TIMEOUT_MS, 8000)),
  metricsWindowSize: Math.max(5, toPositiveInt(env.VITE_QUEUE_METRICS_WINDOW_SIZE, 20)),
  degradeErrorRate: toPositiveNumber(env.VITE_QUEUE_DEGRADE_ERROR_RATE, 0.15),
  degradeP95Ms: Math.max(1000, toPositiveInt(env.VITE_QUEUE_DEGRADE_P95_MS, 18000)),
  recoverErrorRate: toPositiveNumber(env.VITE_QUEUE_RECOVER_ERROR_RATE, 0.05),
  recoverP95Ms: Math.max(1000, toPositiveInt(env.VITE_QUEUE_RECOVER_P95_MS, 12000)),
  recoverCooldownMs: Math.max(1000, toPositiveInt(env.VITE_QUEUE_RECOVER_COOLDOWN_MS, 60000)),
};

let inFlight = 0;
let rejected = 0;
let dynamicMaxInFlight = policy.initialMaxInFlight;
let pausedUntil = 0;
let last429At: number | undefined;
let degradedAt = 0;
let pauseTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<QueueListener>();
const pending: Array<QueueTask<any>> = [];
const outcomes: QueueOutcomePoint[] = [];

const createAbortError = () => new DOMException("已取消", "AbortError");

const quantile = (input: number[], q: number): number => {
  if (input.length === 0) return 0;
  const sorted = [...input].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
};

const computeMetrics = (): AdaptiveMetrics => {
  const windowData = outcomes.slice(-policy.metricsWindowSize);
  if (windowData.length === 0) {
    return {
      windowSize: 0,
      errorRate: 0,
      p95LatencyMs: 0,
      last429At,
    };
  }
  const errorCount = windowData.filter((x) => x.networkError || (x.status || 0) >= 500).length;
  const latencies = windowData.map((x) => Math.max(0, x.latencyMs));
  return {
    windowSize: windowData.length,
    errorRate: errorCount / windowData.length,
    p95LatencyMs: quantile(latencies, 0.95),
    last429At,
  };
};

const getState = (): QueueState => {
  const now = Date.now();
  if (pausedUntil > now) return "PAUSED_UNTIL";
  if (dynamicMaxInFlight <= 1) return "DEGRADED";
  if (inFlight > 0 || pending.length > 0) return "RUNNING";
  return "IDLE";
};

const getStatsSnapshot = (): QueueStats => {
  const state = getState();
  const metrics = computeMetrics();
  return {
    inFlight,
    pending: pending.length,
    rejected,
    maxInFlight: dynamicMaxInFlight,
    state,
    pausedUntil: state === "PAUSED_UNTIL" ? pausedUntil : undefined,
    metrics,
  };
};

const emit = () => {
  const snapshot = getStatsSnapshot();
  for (const cb of listeners) {
    try {
      cb(snapshot);
    } catch {
      // ignore listener errors
    }
  }
};

const schedulePumpAtPauseEnd = () => {
  if (pauseTimer) return;
  const wait = Math.max(1, pausedUntil - Date.now());
  pauseTimer = setTimeout(() => {
    pauseTimer = null;
    pumpQueue();
  }, wait);
};

const maybeRecoverConcurrency = () => {
  if (dynamicMaxInFlight >= 2) return;
  const now = Date.now();
  if (now - degradedAt < policy.recoverCooldownMs) return;
  const metrics = computeMetrics();
  if (metrics.windowSize < 5) return;
  if (metrics.errorRate < policy.recoverErrorRate && metrics.p95LatencyMs < policy.recoverP95Ms) {
    dynamicMaxInFlight = 2;
  }
};

const evaluateAdaptiveConcurrency = () => {
  const metrics = computeMetrics();
  const degradeByError = metrics.windowSize >= 5 && metrics.errorRate >= policy.degradeErrorRate;
  const degradeByLatency = metrics.windowSize >= 5 && metrics.p95LatencyMs >= policy.degradeP95Ms;
  const degradeBy429 = !!last429At && Date.now() - last429At < policy.recoverCooldownMs;

  if (degradeByError || degradeByLatency || degradeBy429) {
    if (dynamicMaxInFlight !== 1) {
      dynamicMaxInFlight = 1;
      degradedAt = Date.now();
    }
    return;
  }

  maybeRecoverConcurrency();
};

const onTaskSettled = () => {
  inFlight = Math.max(0, inFlight - 1);
  emit();
  pumpQueue();
};

const startTask = <T>(task: QueueTask<T>) => {
  if (task.signal?.aborted) {
    task.reject(createAbortError());
    emit();
    pumpQueue();
    return;
  }

  inFlight += 1;
  emit();

  Promise.resolve()
    .then(() => task.run())
    .then(task.resolve, task.reject)
    .finally(() => {
      if (task.signal && task.abortHandler) {
        task.signal.removeEventListener("abort", task.abortHandler);
      }
      onTaskSettled();
    });
};

function pumpQueue() {
  const now = Date.now();
  if (pausedUntil > now) {
    schedulePumpAtPauseEnd();
    emit();
    return;
  }

  if (pauseTimer) {
    clearTimeout(pauseTimer);
    pauseTimer = null;
  }

  while (pending.length > 0 && inFlight < dynamicMaxInFlight) {
    const task = pending.shift();
    if (!task) break;
    if (task.signal?.aborted) {
      task.reject(createAbortError());
      continue;
    }
    if (Date.now() > task.deadlineAt) {
      task.reject(new Error("生成队列等待超时，请稍后重试。"));
      continue;
    }
    startTask(task);
  }

  emit();
}

const removePendingTask = (id: string): QueueTask<any> | undefined => {
  const idx = pending.findIndex((x) => x.id === id);
  if (idx < 0) return undefined;
  const [task] = pending.splice(idx, 1);
  return task;
};

export const enqueueGenerationTask = <T>(
  taskFn: () => Promise<T>,
  options: EnqueueOptions
): Promise<T> => {
  if (options.signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  if (pending.length + inFlight >= policy.maxPending) {
    rejected += 1;
    emit();
    return Promise.reject(new Error("当前生成队列繁忙，请稍后重试。"));
  }

  return new Promise<T>((resolve, reject) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const task: QueueTask<T> = {
      id,
      source: options.source,
      run: taskFn,
      resolve,
      reject,
      signal: options.signal,
      deadlineAt: Date.now() + policy.enqueueTimeoutMs,
    };

    if (options.signal) {
      const handler = () => {
        const removed = removePendingTask(id);
        if (!removed) return;
        removed.reject(createAbortError());
        emit();
      };
      task.abortHandler = handler;
      options.signal.addEventListener("abort", handler, { once: true });
    }

    pending.push(task);
    emit();
    pumpQueue();
  });
};

export const reportGenerationOutcome = (outcome: QueueOutcome) => {
  const now = Date.now();
  outcomes.push({
    at: now,
    status: outcome.status,
    latencyMs: Math.max(0, outcome.latencyMs),
    networkError: outcome.networkError,
  });
  if (outcomes.length > policy.metricsWindowSize * 3) {
    outcomes.splice(0, outcomes.length - policy.metricsWindowSize * 3);
  }

  if ((outcome.status || 0) === 429) {
    last429At = now;
    const retryAfterMs = Math.max(1000, Math.floor((outcome.retryAfterSec || 5) * 1000));
    pausedUntil = Math.max(pausedUntil, now + retryAfterMs);
  }

  evaluateAdaptiveConcurrency();
  emit();
  pumpQueue();
};

export const getQueueStats = (): QueueStats => getStatsSnapshot();

export const onQueueStateChange = (listener: QueueListener): (() => void) => {
  listeners.add(listener);
  listener(getStatsSnapshot());
  return () => {
    listeners.delete(listener);
  };
};

export const shouldUseConservativeRetry = (queueDepthHint = 0): boolean => {
  const stats = getQueueStats();
  if (queueDepthHint > 0) return true;
  return stats.state === "DEGRADED" || stats.state === "PAUSED_UNTIL" || stats.pending > 0;
};

