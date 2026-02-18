import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiConfig } from "../services/apiConfig";
import { fetchBalance, listModels } from "../services/openaiImages";
import { Icon } from "./Icon";

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

/** Frontend-only display name: 2.5-series → Nano🍌, 3-pro → Nano🍌 PRO, 3-pro-2k → Nano🍌 PRO 2K */
export const getModelDisplayName = (modelId: string): string => {
  if (/gemini-3.*pro.*image.*2k/i.test(modelId)) return "Nano🍌 PRO 2K";
  if (/gemini-3.*pro.*image/i.test(modelId)) return "Nano🍌 PRO";
  if (/2\.5.*image/i.test(modelId)) return "Nano🍌";
  // fallback: strip common prefixes
  return modelId
    .replace(/^(gemini-|gpt-image-)/i, "")
    .replace(/-preview.*$/, "");
};

const formatMoney = (amount: number | null, currency = "USD"): string => {
  if (amount === null || !Number.isFinite(amount)) return "暂不可用";
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

const toPositiveInt = (raw: unknown, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return v >= 0 ? v : fallback;
};

const MIN_BALANCE_REFRESH_MS = Math.max(
  10_000,
  toPositiveInt((import.meta as any)?.env?.VITE_BALANCE_REFRESH_MIN_INTERVAL_MS, 60_000)
);
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
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [balanceAmount, setBalanceAmount] = useState<number | null>(null);
  const [balanceCurrency, setBalanceCurrency] = useState("USD");
  const [balanceHint, setBalanceHint] = useState("加载中...");
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const modelsReqIdRef = useRef(0);
  const balanceReqIdRef = useRef(0);
  const balanceLockRef = useRef(false);
  const lastModelsRequestedAtRef = useRef(0);
  const lastBalanceRequestedAtRef = useRef(0);
  const modelsFailureCountRef = useRef(0);
  const balanceFailureCountRef = useRef(0);
  const modelsCooldownUntilRef = useRef(0);
  const balanceCooldownUntilRef = useRef(0);

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
      const next = Array.from(new Set([apiConfig.defaultImageModel, ...(imageModels.length ? imageModels : ids)])).filter(Boolean);
      setModels(next);
      modelsFailureCountRef.current = 0;
      modelsCooldownUntilRef.current = 0;
    } catch {
      if (!mountedRef.current || reqId !== modelsReqIdRef.current) return;
      setModels((prev) => (prev.length ? prev : [apiConfig.defaultImageModel]));
      modelsFailureCountRef.current += 1;
      const idx = Math.min(modelsFailureCountRef.current - 1, FAILURE_BACKOFFS_MS.length - 1);
      modelsCooldownUntilRef.current = Date.now() + FAILURE_BACKOFFS_MS[idx];
    } finally {
      if (mountedRef.current && reqId === modelsReqIdRef.current) {
        setLoadingModels(false);
      }
    }
  }, [apiConfig, models.length]);

  const loadBalance = useCallback(async (opts?: { force?: boolean }) => {
    const now = Date.now();
    const force = Boolean(opts?.force);
    if (!force) {
      if (now < balanceCooldownUntilRef.current) return;
      if (now - lastBalanceRequestedAtRef.current < MIN_BALANCE_REFRESH_MS) return;
    }
    if (balanceLockRef.current) return;
    balanceLockRef.current = true;
    lastBalanceRequestedAtRef.current = now;
    const reqId = ++balanceReqIdRef.current;
    setLoadingBalance(true);
    try {
      const r = await fetchBalance({ api: apiConfig, signal: AbortSignal.timeout(QUICK_TIMEOUT_MS) });
      if (!mountedRef.current || reqId !== balanceReqIdRef.current) return;
      setBalanceAmount(r.amount);
      setBalanceCurrency(r.currency || "USD");
      const now = Date.now();
      setBalanceUpdatedAt(now);
      setBalanceHint(r.amount === null ? "暂不可用" : `已更新 ${new Date(now).toLocaleTimeString("zh-CN", { hour12: false })}`);
      balanceFailureCountRef.current = 0;
      balanceCooldownUntilRef.current = 0;
    } catch (e) {
      if (!mountedRef.current || reqId !== balanceReqIdRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      const hint = /鉴权失败|401|403/i.test(msg)
        ? "余额接口鉴权失败"
        : /not_supported|404|405/i.test(msg)
          ? "网关未开放余额接口"
          : /timeout|504|502|503|gateway/i.test(msg)
            ? "余额接口超时，请稍后重试"
            : "余额暂不可用";
      setBalanceAmount(null);
      setBalanceUpdatedAt(null);
      setBalanceHint(hint);
      balanceFailureCountRef.current += 1;
      const idx = Math.min(balanceFailureCountRef.current - 1, FAILURE_BACKOFFS_MS.length - 1);
      balanceCooldownUntilRef.current = Date.now() + FAILURE_BACKOFFS_MS[idx];
    } finally {
      balanceLockRef.current = false;
      if (mountedRef.current && reqId === balanceReqIdRef.current) {
        setLoadingBalance(false);
      }
    }
  }, [apiConfig]);

  useEffect(() => {
    void loadModels({ force: true });
    void loadBalance({ force: true });
  }, [apiConfig.authorization, apiConfig.baseUrl, loadBalance, loadModels]);

  useEffect(() => {
    if (refreshTick <= 0) return;
    void loadBalance();
  }, [refreshTick, loadBalance]);

  useEffect(() => {
    if (pendingModel && pendingModel === apiConfig.defaultImageModel) {
      setPendingModel(null);
    }
  }, [apiConfig.defaultImageModel, pendingModel]);

  const options = useMemo(() => {
    if (!models.length) return [apiConfig.defaultImageModel];
    return models;
  }, [models, apiConfig.defaultImageModel]);

  /* ── Compact mode: model selector + balance, vertical ── */
  if (compact) {
    const shortBalance =
      balanceAmount !== null && Number.isFinite(balanceAmount)
        ? `$${balanceAmount.toFixed(2)}`
        : "—";
    return (
      <div className="w-full flex flex-col items-center gap-1 px-1 py-1.5">
        <select
          value={apiConfig.defaultImageModel}
          onChange={(e) => onUpdateApiConfig({ ...apiConfig, defaultImageModel: e.target.value })}
          className="w-full bg-dark-900/60 border border-dark-600 rounded px-2 py-1.5 text-xs text-gray-200 text-center focus:outline-none focus:border-banana-500/50 cursor-pointer appearance-none"
          title={apiConfig.defaultImageModel}
        >
          {options.map((m) => (
            <option key={m} value={m}>{getModelDisplayName(m)}</option>
          ))}
        </select>
        <span
          className={`text-[10px] leading-tight ${
            balanceAmount !== null ? "text-banana-400" : "text-gray-500"
          }`}
          title={balanceHint}
        >
          {shortBalance}
        </span>
      </div>
    );
  }

  return (
    <div className="px-3 py-3 border-t border-dark-700">
      <div className="rounded-lg border border-dark-700 bg-dark-900/40 p-3">
        <select
          value={apiConfig.defaultImageModel}
          onChange={(e) => {
            const next = e.target.value;
            if (hasActiveFeature && next !== apiConfig.defaultImageModel) {
              setPendingModel(next);
            } else {
              onUpdateApiConfig({ ...apiConfig, defaultImageModel: next });
            }
          }}
          className="w-full bg-dark-800 border border-dark-600 rounded-md px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-dark-500"
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {getModelDisplayName(m)}
            </option>
          ))}
        </select>

        {pendingModel && (
          <div className="mt-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-2">
            <p className="text-[11px] text-amber-300">
              当前有一致性功能开启，切换模型可能导致生成结果不一致。确认切换？
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // N-1: 校验 pendingModel 是否仍在模型列表中
                  if (!models.includes(pendingModel)) {
                    alert("该模型已不在可用列表中，请重新选择。");
                    setPendingModel(null);
                    return;
                  }
                  onUpdateApiConfig({ ...apiConfig, defaultImageModel: pendingModel });
                  setPendingModel(null);
                }}
                className="flex-1 px-2 py-1.5 text-[11px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-md transition-colors"
              >
                确认切换
              </button>
              <button
                onClick={() => setPendingModel(null)}
                className="flex-1 px-2 py-1.5 text-[11px] bg-dark-700 hover:bg-dark-600 text-gray-300 border border-dark-600 rounded-md transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 text-[11px] text-gray-400">余额</div>
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-200">{formatMoney(balanceAmount, balanceCurrency)}</div>
          <button
            onClick={() => {
              void loadModels({ force: true });
              void loadBalance({ force: true });
            }}
            className="text-gray-500 hover:text-gray-300 p-1"
            title="刷新模型与余额"
          >
            <Icon name={(loadingModels || loadingBalance) ? "spinner" : "arrows-rotate"} className={`text-xs ${(loadingModels || loadingBalance) ? "fa-spin" : ""}`} />
          </button>
        </div>
        <div className="mt-2 pt-2 border-t border-dark-700 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 px-2 py-1 rounded border border-dark-600 bg-dark-800/70 truncate max-w-[110px]" title={authUser || "未登录"}>
            {authUser || "未登录"}
          </span>
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
