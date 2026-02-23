import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AspectRatio, ProductScale } from "../types";
import { ApiConfig } from "../services/apiConfig";
import { listModels } from "../services/openaiImages";
import { getSupportedAspectRatios } from "../services/sizeUtils";
import { clearAll } from "../services/storage";
import { getProvider, switchProvider, type ProviderOption } from "../services/auth";
import { syncService } from "../services/sync";
import { Icon } from "./Icon";
import { getModelDisplayName } from "./ModelSwitcherFooter";
import { useToast } from "./Toast";

export const DEFAULT_PREFERENCES_KEY = "topseller.default_preferences";

export interface DefaultPreferences {
  aspectRatio: AspectRatio;
  productScale: ProductScale;
  batchCount: number;
}

export const DEFAULT_PREFERENCES: DefaultPreferences = {
  aspectRatio: AspectRatio.Portrait,
  productScale: ProductScale.Standard,
  batchCount: 1,
};

export const loadDefaultPreferences = (): DefaultPreferences => {
  try {
    const raw = localStorage.getItem(DEFAULT_PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    return {
      aspectRatio: Object.values(AspectRatio).includes(parsed.aspectRatio) ? parsed.aspectRatio : DEFAULT_PREFERENCES.aspectRatio,
      productScale: Object.values(ProductScale).includes(parsed.productScale) ? parsed.productScale : DEFAULT_PREFERENCES.productScale,
      batchCount: typeof parsed.batchCount === "number" ? Math.min(Math.max(Math.round(parsed.batchCount), 1), 10) : DEFAULT_PREFERENCES.batchCount,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
};

export const saveDefaultPreferences = (prefs: DefaultPreferences) => {
  try {
    localStorage.setItem(DEFAULT_PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {}
};

/* ── Helpers ── */

const ASPECT_RATIO_LABELS: Record<string, string> = {
  "1:1": "1:1 正方形",
  "2:3": "2:3 竖版",
  "3:2": "3:2 横版",
  "3:4": "3:4 竖版",
  "4:3": "4:3 横版",
  "4:5": "4:5 竖版",
  "5:4": "5:4 横版",
  "9:16": "9:16 手机屏",
  "16:9": "16:9 宽屏",
  "21:9": "21:9 超宽",
};

const PRODUCT_SCALE_LABELS: Record<string, string> = {
  [ProductScale.Small]: "低调",
  [ProductScale.Standard]: "平衡",
  [ProductScale.Large]: "突出",
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

/* ── Component ── */

interface SettingsPanelProps {
  open?: boolean;
  onClose?: () => void;
  apiConfig: ApiConfig;
  onUpdateApiConfig: (cfg: ApiConfig) => void;
  hasActiveFeature: boolean;
  authUser: string | null;
  authLoading: boolean;
  onLogout: () => void;
  defaultPreferences: DefaultPreferences;
  onUpdateDefaultPreferences: (prefs: DefaultPreferences) => void;
  balanceRefreshTick: number;
  isSuperAdmin?: boolean;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  open = true,
  onClose,
  apiConfig,
  onUpdateApiConfig,
  hasActiveFeature,
  authUser,
  authLoading,
  onLogout,
  defaultPreferences,
  onUpdateDefaultPreferences,
  balanceRefreshTick,
  isSuperAdmin = false,
}) => {
  const { addToast } = useToast();

  /* ── Model fetching ── */
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const modelsReqIdRef = useRef(0);
  const lastModelsRequestedAtRef = useRef(0);
  const modelsFailureCountRef = useRef(0);
  const modelsCooldownUntilRef = useRef(0);

  const [clearConfirm, setClearConfirm] = useState(false);

  /* ── Provider switching (super admin only) ── */
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>("primary");
  const [providerSwitching, setProviderSwitching] = useState(false);

  useEffect(() => {
    if (!open || !isSuperAdmin) return;
    let cancelled = false;
    getProvider().then((info) => {
      if (cancelled) return;
      setActiveProvider(info.active);
      setProviderOptions(info.options);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, isSuperAdmin]);

  const handleSwitchProvider = useCallback(async (id: string) => {
    if (id === activeProvider || providerSwitching) return;
    setProviderSwitching(true);
    try {
      const result = await switchProvider(id);
      setActiveProvider(result.active);
      addToast({ type: 'success', message: `已切换到${providerOptions.find(o => o.id === result.active)?.label || result.active}` });
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || '切换失败' });
    } finally {
      setProviderSwitching(false);
    }
  }, [activeProvider, providerSwitching, providerOptions, addToast]);

  /* ── Usage stats ── */
  const [usageData, setUsageData] = useState<{ monthlyPercent: number; dailyPercent: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    syncService.fetchMyUsage().then((data) => {
      if (!cancelled) setUsageData(data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, balanceRefreshTick]);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const QUICK_TIMEOUT_MS = 10_000;

  const loadModelList = useCallback(async (opts?: { force?: boolean }) => {
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
      if (mountedRef.current && reqId === modelsReqIdRef.current) setLoadingModels(false);
    }
  }, [apiConfig, models.length]);

  // Fetch on open
  useEffect(() => {
    if (!open) return;
    void loadModelList({ force: true });
  }, [open, loadModelList]);

  // Clear pending when model syncs
  useEffect(() => {
    if (pendingModel && pendingModel === apiConfig.defaultImageModel) {
      setPendingModel(null);
    }
  }, [apiConfig.defaultImageModel, pendingModel]);

  const modelOptions = useMemo(() => {
    if (!models.length) return [apiConfig.defaultImageModel];
    return models;
  }, [models, apiConfig.defaultImageModel]);

  const aspectRatios = useMemo(() => getSupportedAspectRatios(), []);

  /* ── Handlers ── */

  const handleClearAll = useCallback(async () => {
    await clearAll();
    window.location.reload();
  }, []);

  if (!open) return null;

  const settingsContent = (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">

      {/* ── 1. 账号 ── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">账号</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center text-gray-300">
              <Icon name="user" className="text-sm" />
            </div>
            <span className="text-sm text-gray-200">{authUser || "未登录"}</span>
          </div>
          <button
            onClick={onLogout}
            disabled={authLoading}
            className="text-xs px-3 py-1.5 rounded-md border border-dark-600 bg-dark-700 hover:bg-dark-600 text-gray-300 disabled:opacity-60 transition-colors"
          >
            退出登录
          </button>
        </div>
      </section>

      {/* ── 1.5 API 线路（管理员） ── */}
      {isSuperAdmin && providerOptions.length > 1 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">API 线路（管理员）</h3>
          <div className="space-y-2">
            <div className="flex gap-1">
              {providerOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleSwitchProvider(opt.id)}
                  disabled={providerSwitching}
                  className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                    activeProvider === opt.id
                      ? "bg-banana-500/20 border-banana-500/50 text-banana-400"
                      : "bg-dark-900 border-dark-600 text-gray-400 hover:text-gray-200 hover:border-dark-500"
                  } disabled:opacity-60`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-600">切换后所有用户立即生效</p>
          </div>
        </section>
      )}

      {/* ── 2. 模型与用量 ── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">模型与用量</h3>
        <div className="space-y-3">
          {/* Model select */}
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">默认模型</label>
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
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-dark-500"
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>{getModelDisplayName(m)}</option>
              ))}
            </select>
          </div>

          {/* Pending model warning */}
          {pendingModel && (
            <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-2">
              <p className="text-[11px] text-amber-300">
                当前有一致性功能开启，切换模型可能导致生成结果不一致。确认切换？
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (!models.includes(pendingModel)) {
                      addToast({ type: 'warning', message: '该模型已不在可用列表中，请重新选择。' });
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

          <div className="flex justify-end">
            <button
              onClick={() => void loadModelList({ force: true })}
              className="text-gray-500 hover:text-gray-300 p-0.5 transition-colors"
              title="刷新模型"
            >
              <Icon
                name={loadingModels ? "spinner" : "arrows-rotate"}
                className={`text-xs ${loadingModels ? "fa-spin" : ""}`}
              />
            </button>
          </div>

          {/* Usage progress bar */}
          {usageData && <UsageBar label="本月用量" percent={usageData.monthlyPercent} />}
        </div>
      </section>

      {/* ── 3. 默认偏好 ── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">默认偏好</h3>
        <p className="text-[11px] text-gray-500 mb-3">新建会话时的初始值</p>
        <div className="space-y-3">
          {/* Aspect ratio */}
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">画幅比例</label>
            <select
              value={defaultPreferences.aspectRatio}
              onChange={(e) => onUpdateDefaultPreferences({ ...defaultPreferences, aspectRatio: e.target.value as AspectRatio })}
              className="w-full bg-dark-900 border border-dark-600 rounded-md px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-dark-500"
            >
              {aspectRatios.map((ar) => (
                <option key={ar} value={ar}>{ASPECT_RATIO_LABELS[ar] || ar}</option>
              ))}
            </select>
          </div>

          {/* Product scale */}
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">产品显眼程度</label>
            <div className="flex gap-1">
              {Object.values(ProductScale).map((ps) => (
                <button
                  key={ps}
                  onClick={() => onUpdateDefaultPreferences({ ...defaultPreferences, productScale: ps })}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors ${
                    defaultPreferences.productScale === ps
                      ? "bg-banana-500/20 border-banana-500/50 text-banana-400"
                      : "bg-dark-900 border-dark-600 text-gray-400 hover:text-gray-200 hover:border-dark-500"
                  }`}
                >
                  {PRODUCT_SCALE_LABELS[ps]}
                </button>
              ))}
            </div>
          </div>

          {/* Batch count */}
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">默认生成数量</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={10}
                value={defaultPreferences.batchCount}
                onChange={(e) => onUpdateDefaultPreferences({ ...defaultPreferences, batchCount: Number(e.target.value) })}
                className="flex-1 accent-banana-500"
              />
              <span className="text-sm text-gray-200 w-6 text-center">{defaultPreferences.batchCount}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. 团队管理 ── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">团队管理</h3>
        <div className="p-4 rounded-lg border border-dark-600 bg-dark-800/50 text-center">
          <Icon name="users" className="text-2xl text-gray-600 mb-2" />
          <p className="text-xs text-gray-500">团队协作功能即将上线</p>
          <p className="text-[10px] text-gray-600 mt-1">邀请成员、权限管理、共享素材库</p>
        </div>
      </section>

      {/* ── 5. 数据管理 ── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">数据管理</h3>
        {!clearConfirm ? (
          <button
            onClick={() => setClearConfirm(true)}
            className="text-xs px-3 py-2 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            清除全部数据
          </button>
        ) : (
          <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 space-y-2">
            <p className="text-[11px] text-red-300">
              此操作将永久删除所有会话、模板、素材和设置，无法恢复。确定要继续吗？
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleClearAll}
                className="flex-1 px-2 py-1.5 text-[11px] bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 rounded-md transition-colors"
              >
                确认清除
              </button>
              <button
                onClick={() => setClearConfirm(false)}
                className="flex-1 px-2 py-1.5 text-[11px] bg-dark-700 hover:bg-dark-600 text-gray-300 border border-dark-600 rounded-md transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );

  // Render as full MainContent view (no overlay)
  return (
    <div className="flex flex-col h-full bg-dark-900">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700 shrink-0">
        <h2 className="text-base font-semibold text-gray-100">设置</h2>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 p-1 transition-colors">
            <Icon name="xmark" className="text-sm" />
          </button>
        )}
      </div>

      {/* Content area — scrollable, centered max-width for readability */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-lg mx-auto p-5 space-y-6">
          {settingsContent}
        </div>
      </div>
    </div>
  );
};

/* ── Usage Bar ── */

const UsageBar: React.FC<{ label: string; percent: number }> = ({ label, percent }) => {
  // -1 means unlimited
  if (percent === -1) {
    return (
      <div className="p-3 rounded-lg border border-dark-600 bg-dark-800/50">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400">{label}</span>
          <span className="text-[11px] text-gray-500">不限量</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg border border-dark-600 bg-dark-800/50">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-gray-400">{label}</span>
        <span className="text-[11px] text-gray-400">{percent}%</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-dark-600 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300 bg-banana-500"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
};
