import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiConfig } from "../services/apiConfig";
import { listModels } from "../services/openaiImages";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

interface ModelSwitcherFooterProps {
  apiConfig: ApiConfig;
  onUpdateApiConfig: (cfg: ApiConfig) => void;
  refreshTick: number;
  hasActiveFeature?: boolean;
  authUser?: string | null;
  authLoading?: boolean;
  onLogout?: () => void;
  compact?: boolean;
}

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "gemini-3.1-flash-image-preview": "Nano🍌 2",
  "gemini-3-pro-image-preview": "Nano🍌 PRO",
  "gemini-3-pro-image": "Nano🍌 PRO",
  "gemini-2.5-flash-image-preview": "Nano🍌",
  "gemini-2.5-flash-image": "Nano🍌",
  "gpt-image-1.5": "GPT Image 1.5",
  "gpt-image-1": "GPT Image 1",
};

// These models are always shown regardless of server-returned list or allowed-models config.
const PINNED_MODELS = ["gemini-3.1-flash-image-preview"];

/** Canonicalize legacy model ids (frontend display + persistence). */
export const canonicalizeModelId = (modelId: string): string =>
  String(modelId || "").trim().replace(/-2k$/i, "");

const dedupeModelIds = (ids: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const normalized = canonicalizeModelId(id);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
};

/** Frontend-only display name lookup (exact match, case-insensitive). */
export const getModelDisplayName = (modelId: string): string => {
  const canonical = canonicalizeModelId(modelId);
  const mapped = MODEL_DISPLAY_NAMES[canonical.toLowerCase()];
  if (mapped) return mapped;
  return canonical.replace(/^(gemini-|gpt-image-)/i, "").replace(/-preview.*$/, "");
};

const toPositiveInt = (raw: unknown, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return v >= 0 ? v : fallback;
};

const MIN_MODELS_REFRESH_MS = Math.max(
  30_000,
  toPositiveInt((import.meta as any)?.env?.VITE_MODELS_REFRESH_MIN_INTERVAL_MS, 300_000)
);
const FAILURE_BACKOFFS_MS = [30_000, 60_000, 120_000];

const ModelSwitcherFooterInner: React.FC<ModelSwitcherFooterProps> = ({
  apiConfig,
  onUpdateApiConfig,
  refreshTick,
  hasActiveFeature = false,
  authUser = null,
  authLoading = false,
  onLogout,
  compact = false,
}) => {
  const { addToast } = useToast();
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const modelsReqIdRef = useRef(0);
  const lastModelsRequestedAtRef = useRef(0);
  const modelsFailureCountRef = useRef(0);
  const modelsCooldownUntilRef = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const QUICK_TIMEOUT_MS = 10_000;

  const loadModels = useCallback(async (opts?: { force?: boolean }) => {
    const now = Date.now();
    const force = Boolean(opts?.force);
    if (!force) {
      if (now < modelsCooldownUntilRef.current) return;
      if (now - lastModelsRequestedAtRef.current < MIN_MODELS_REFRESH_MS && models.length > 0) return;
    }
    lastModelsRequestedAtRef.current = now;
    const reqId = ++modelsReqIdRef.current;
    setLoadingModels(true);
    try {
      const ids = await listModels({ api: apiConfig, signal: AbortSignal.timeout(QUICK_TIMEOUT_MS) });
      if (!mountedRef.current || reqId !== modelsReqIdRef.current) return;
      const imageModels = ids.filter((m) => /image/i.test(m) && !/^sora-/i.test(m));
      const next = dedupeModelIds([
        apiConfig.defaultImageModel,
        ...PINNED_MODELS,
        ...(imageModels.length ? imageModels : ids),
      ]);
      setModels(next);
      modelsFailureCountRef.current = 0;
      modelsCooldownUntilRef.current = 0;
    } catch {
      if (!mountedRef.current || reqId !== modelsReqIdRef.current) return;
      setModels((prev) => (prev.length ? prev : dedupeModelIds([apiConfig.defaultImageModel, ...PINNED_MODELS])));
      modelsFailureCountRef.current += 1;
      const idx = Math.min(modelsFailureCountRef.current - 1, FAILURE_BACKOFFS_MS.length - 1);
      modelsCooldownUntilRef.current = Date.now() + FAILURE_BACKOFFS_MS[idx];
    } finally {
      if (mountedRef.current && reqId === modelsReqIdRef.current) {
        setLoadingModels(false);
      }
    }
  }, [apiConfig, models.length]);

  useEffect(() => {
    void loadModels({ force: true });
  }, [apiConfig.authorization, apiConfig.baseUrl, loadModels]);

  // Refresh models when user switches back to this tab (cross-user sync)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadModels({ force: true });
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [loadModels]);

  useEffect(() => {
    if (pendingModel && pendingModel === apiConfig.defaultImageModel) {
      setPendingModel(null);
    }
  }, [apiConfig.defaultImageModel, pendingModel]);

  const options = useMemo(() => {
    if (!models.length) return dedupeModelIds([apiConfig.defaultImageModel]);
    return dedupeModelIds(models);
  }, [models, apiConfig.defaultImageModel]);

  /* ── Compact mode: fixed model label ── */
  if (compact) {
    return (
      <div className="w-full flex flex-col items-center gap-1 px-1 py-1.5">
        <div
          className="w-full bg-dark-900/60 border border-dark-600 rounded px-2 py-1.5 text-xs text-gray-200 text-center"
          title="gemini-3.1-flash-image-preview"
        >
          Nano🍌 2
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-3 border-t border-dark-700">
      <div className="rounded-lg border border-dark-700 bg-dark-900/40 p-3">
        <div className="w-full bg-dark-800 border border-dark-600 rounded-md px-2.5 py-2 text-xs text-gray-200">
          Nano🍌 2
        </div>

        <div className="mt-2 pt-2 border-t border-dark-700 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 px-2 py-1 rounded border border-dark-600 bg-dark-800/70 truncate max-w-[110px]" title={authUser || "未登录"}>
            {authUser || "未登录"}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void loadModels({ force: true })}
              className="text-gray-500 hover:text-gray-300 p-1"
              title="刷新模型"
            >
              <Icon name={loadingModels ? "spinner" : "arrows-rotate"} className={`text-xs ${loadingModels ? "fa-spin" : ""}`} />
            </button>
            <button
              onClick={onLogout}
              disabled={authLoading || !onLogout}
              className="text-[11px] px-2.5 py-1.5 rounded border border-dark-600 bg-dark-800 hover:bg-dark-700 text-gray-200 disabled:opacity-60"
            >
              退出登录
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ModelSwitcherFooter = React.memo(ModelSwitcherFooterInner, (prev, next) =>
  prev.apiConfig === next.apiConfig &&
  prev.refreshTick === next.refreshTick &&
  prev.hasActiveFeature === next.hasActiveFeature &&
  prev.authUser === next.authUser &&
  prev.authLoading === next.authLoading &&
  prev.compact === next.compact
);
