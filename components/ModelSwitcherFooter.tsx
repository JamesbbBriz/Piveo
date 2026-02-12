import React, { useEffect, useMemo, useState } from "react";
import { ApiConfig } from "../services/apiConfig";
import { fetchBalance, listModels } from "../services/openaiImages";
import { Icon } from "./Icon";

interface ModelSwitcherFooterProps {
  apiConfig: ApiConfig;
  onUpdateApiConfig: (cfg: ApiConfig) => void;
  refreshTick: number;
}

const formatMoney = (amount: number | null, currency = "USD"): string => {
  if (amount === null || !Number.isFinite(amount)) return "暂不可用";
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

export const ModelSwitcherFooter: React.FC<ModelSwitcherFooterProps> = ({ apiConfig, onUpdateApiConfig, refreshTick }) => {
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [balanceAmount, setBalanceAmount] = useState<number | null>(null);
  const [balanceCurrency, setBalanceCurrency] = useState("USD");
  const [balanceHint, setBalanceHint] = useState("加载中...");
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<number | null>(null);

  const loadModels = async () => {
    setLoadingModels(true);
    try {
      const ids = await listModels({ api: apiConfig });
      const imageModels = ids.filter((m) => /image/i.test(m) && !/^sora-/i.test(m));
      const next = Array.from(new Set([apiConfig.defaultImageModel, ...(imageModels.length ? imageModels : ids)])).filter(Boolean);
      setModels(next);
    } catch {
      setModels((prev) => (prev.length ? prev : [apiConfig.defaultImageModel]));
    } finally {
      setLoadingModels(false);
    }
  };

  const loadBalance = async () => {
    setLoadingBalance(true);
    try {
      const r = await fetchBalance({ api: apiConfig });
      setBalanceAmount(r.amount);
      setBalanceCurrency(r.currency || "USD");
      const now = Date.now();
      setBalanceUpdatedAt(now);
      setBalanceHint(r.amount === null ? "暂不可用" : `已更新 ${new Date(now).toLocaleTimeString("zh-CN", { hour12: false })}`);
    } catch (e) {
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
    } finally {
      setLoadingBalance(false);
    }
  };

  useEffect(() => {
    void loadModels();
    void loadBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiConfig.authorization, apiConfig.baseUrl]);

  useEffect(() => {
    if (refreshTick <= 0) return;
    void loadBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  const options = useMemo(() => {
    if (!models.length) return [apiConfig.defaultImageModel];
    return models;
  }, [models, apiConfig.defaultImageModel]);

  return (
    <div className="px-3 py-3 border-t border-dark-700">
      <div className="rounded-lg border border-dark-700 bg-dark-900/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-gray-400">模型</span>
          <button
            onClick={() => {
              void loadModels();
              void loadBalance();
            }}
            className="text-gray-500 hover:text-gray-300"
            title="刷新模型与余额"
          >
            <Icon name={(loadingModels || loadingBalance) ? "spinner" : "arrows-rotate"} className={(loadingModels || loadingBalance) ? "fa-spin" : ""} />
          </button>
        </div>
        <select
          value={apiConfig.defaultImageModel}
          onChange={(e) => onUpdateApiConfig({ ...apiConfig, defaultImageModel: e.target.value })}
          className="w-full bg-dark-800 border border-dark-600 rounded-md px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-dark-500"
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <div className="mt-3 text-[11px] text-gray-400">余额</div>
        <div className="text-sm text-gray-200">{formatMoney(balanceAmount, balanceCurrency)}</div>
        <div className="text-[10px] text-gray-500 mt-0.5">{balanceHint}</div>
        {balanceUpdatedAt !== null && (
          <div className="text-[10px] text-gray-600 mt-0.5">
            更新时间 {new Date(balanceUpdatedAt).toLocaleString("zh-CN", { hour12: false })}
          </div>
        )}
      </div>
    </div>
  );
};
