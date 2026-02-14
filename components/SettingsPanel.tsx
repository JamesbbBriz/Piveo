import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AspectRatio, ProductScale } from "../types";
import { ApiConfig } from "../services/apiConfig";
import { fetchBalance, listModels } from "../services/openaiImages";
import { getSupportedAspectRatios } from "../services/sizeUtils";
import { clearAll } from "../services/storage";
import { Icon } from "./Icon";
import { getModelDisplayName } from "./ModelSwitcherFooter";

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

const formatMoney = (amount: number | null, currency = "USD"): string => {
  if (amount === null || !Number.isFinite(amount)) return "暂不可用";
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

/* ── Component ── */

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  apiConfig: ApiConfig;
  onUpdateApiConfig: (cfg: ApiConfig) => void;
  hasActiveFeature: boolean;
  authUser: string | null;
  authLoading: boolean;
  onLogout: () => void;
  defaultPreferences: DefaultPreferences;
  onUpdateDefaultPreferences: (prefs: DefaultPreferences) => void;
  balanceRefreshTick: number;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  open,
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
}) => {
  /* ── Model & balance fetching ── */
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [balanceAmount, setBalanceAmount] = useState<number | null>(null);
  const [balanceCurrency, setBalanceCurrency] = useState("USD");
  const [balanceHint, setBalanceHint] = useState("加载中...");
  const mountedRef = useRef(true);
  const modelsReqIdRef = useRef(0);
  const balanceReqIdRef = useRef(0);
  const balanceLockRef = useRef(false);

  const [clearConfirm, setClearConfirm] = useState(false);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const QUICK_TIMEOUT_MS = 10_000;

  const loadModelList = useCallback(async () => {
    const reqId = ++modelsReqIdRef.current;
    setLoadingModels(true);
    try {
      const ids = await listModels({ api: apiConfig, signal: AbortSignal.timeout(QUICK_TIMEOUT_MS) });
      if (!mountedRef.current || reqId !== modelsReqIdRef.current) return;
      const imageModels = ids.filter((m) => /image/i.test(m) && !/^sora-/i.test(m));
      const next = Array.from(new Set([apiConfig.defaultImageModel, ...(imageModels.length ? imageModels : ids)])).filter(Boolean);
      setModels(next);
    } catch {
      if (!mountedRef.current || reqId !== modelsReqIdRef.current) return;
      setModels((prev) => (prev.length ? prev : [apiConfig.defaultImageModel]));
    } finally {
      if (mountedRef.current && reqId === modelsReqIdRef.current) setLoadingModels(false);
    }
  }, [apiConfig]);

  const loadBalance = useCallback(async () => {
    if (balanceLockRef.current) return;
    balanceLockRef.current = true;
    const reqId = ++balanceReqIdRef.current;
    setLoadingBalance(true);
    try {
      const r = await fetchBalance({ api: apiConfig, signal: AbortSignal.timeout(QUICK_TIMEOUT_MS) });
      if (!mountedRef.current || reqId !== balanceReqIdRef.current) return;
      setBalanceAmount(r.amount);
      setBalanceCurrency(r.currency || "USD");
      const now = Date.now();
      setBalanceHint(r.amount === null ? "暂不可用" : `已更新 ${new Date(now).toLocaleTimeString("zh-CN", { hour12: false })}`);
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
      setBalanceHint(hint);
    } finally {
      balanceLockRef.current = false;
      if (mountedRef.current && reqId === balanceReqIdRef.current) setLoadingBalance(false);
    }
  }, [apiConfig]);

  // Fetch on open
  useEffect(() => {
    if (!open) return;
    void loadModelList();
    void loadBalance();
  }, [open, loadModelList, loadBalance]);

  // External refresh tick
  useEffect(() => {
    if (!open || balanceRefreshTick <= 0) return;
    void loadBalance();
  }, [balanceRefreshTick, open, loadBalance]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md max-h-[85vh] mx-4 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700">
          <h2 className="text-base font-semibold text-gray-100">设置</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 p-1 transition-colors">
            <Icon name="xmark" className="text-sm" />
          </button>
        </div>

        {/* Body */}
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

              {/* Balance */}
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">余额</label>
                <div className="flex items-center justify-between bg-dark-900 border border-dark-600 rounded-md px-2.5 py-2">
                  <span className="text-sm text-gray-200">{formatMoney(balanceAmount, balanceCurrency)}</span>
                  <button
                    onClick={() => { void loadModelList(); void loadBalance(); }}
                    className="text-gray-500 hover:text-gray-300 p-0.5 transition-colors"
                    title="刷新模型与余额"
                  >
                    <Icon
                      name={(loadingModels || loadingBalance) ? "spinner" : "arrows-rotate"}
                      className={`text-xs ${(loadingModels || loadingBalance) ? "fa-spin" : ""}`}
                    />
                  </button>
                </div>
                <p className="text-[10px] text-gray-600 mt-1">{balanceHint}</p>
              </div>
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

          {/* ── 4. 数据管理 ── */}
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
      </div>
    </div>
  );
};
