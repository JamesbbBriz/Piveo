import React, { useEffect, useMemo } from "react";
import { Icon } from "./Icon";

export interface ErrorDetails {
  message: string;
  when: number;
  stage?: string;
  requestId?: string;
  status?: number;
  endpoint?: string;
  advice?: string[];
  extra?: Record<string, any>;
}

interface ErrorDetailsModalProps {
  error: ErrorDetails;
  onClose: () => void;
  onOpenApiSettings?: () => void;
}

export const ErrorDetailsModal: React.FC<ErrorDetailsModalProps> = ({ error, onClose, onOpenApiSettings }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const diagnosticText = useMemo(() => {
    const payload = {
      when: error.when,
      stage: error.stage,
      message: error.message,
      requestId: error.requestId,
      status: error.status,
      endpoint: error.endpoint,
      extra: error.extra || {},
    };
    return JSON.stringify(payload, null, 2);
  }, [error]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticText);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-dark-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-gray-200 font-semibold">
            <Icon name="exclamation-triangle" />
            错误详情
          </div>
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs bg-dark-900 hover:bg-dark-700 text-gray-200 border border-dark-600 rounded-lg"
          >
            关闭
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
            <div className="text-[11px] text-gray-400 mb-2">错误信息</div>
            <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{error.message}</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
              <div className="text-[11px] text-gray-400 mb-1">时间</div>
              <div className="text-sm text-gray-200">{new Date(error.when).toLocaleString()}</div>
            </div>
            <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
              <div className="text-[11px] text-gray-400 mb-1">阶段</div>
              <div className="text-sm text-gray-200">{error.stage || "—"}</div>
            </div>
            <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
              <div className="text-[11px] text-gray-400 mb-1">请求 ID</div>
              <div className="text-sm text-gray-200 break-all">{error.requestId || "—"}</div>
            </div>
            <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
              <div className="text-[11px] text-gray-400 mb-1">HTTP 状态码</div>
              <div className="text-sm text-gray-200">{typeof error.status === "number" ? error.status : "—"}</div>
            </div>
          </div>

          {error.endpoint && (
            <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
              <div className="text-[11px] text-gray-400 mb-2">接口</div>
              <div className="text-sm text-gray-200 break-all">{error.endpoint}</div>
            </div>
          )}

          {Array.isArray(error.advice) && error.advice.length > 0 && (
            <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
              <div className="text-[11px] text-gray-400 mb-2">建议操作</div>
              <div className="space-y-2">
                {error.advice.map((item, idx) => (
                  <div key={`${item}-${idx}`} className="text-sm text-gray-200 leading-relaxed">
                    {idx + 1}. {item}
                  </div>
                ))}
              </div>
              {onOpenApiSettings && (
                <div className="mt-3">
                  <button
                    onClick={() => {
                      onOpenApiSettings();
                      onClose();
                    }}
                    className="px-3 py-2 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-600 rounded-lg"
                  >
                    打开模型切换器
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="bg-dark-900/40 border border-dark-700 rounded-xl p-3">
            <div className="text-[11px] text-gray-400 mb-2">诊断信息（可复制发给我排查）</div>
            <pre className="text-[12px] text-gray-200 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
              {diagnosticText}
            </pre>
            <div className="mt-3">
              <button
                onClick={copy}
                className="px-3 py-2 text-xs bg-banana-500 hover:bg-banana-400 text-dark-900 font-semibold rounded-lg"
              >
                <Icon name="copy" /> 复制诊断信息
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
