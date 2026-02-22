import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
  duration?: number; // ms, 0 = manual dismiss only
}

interface ToastContextType {
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const DEFAULT_DURATIONS: Record<Toast["type"], number> = {
  success: 5000,
  info: 5000,
  warning: 8000,
  error: 8000,
};

const ICON_MAP: Record<Toast["type"], string> = {
  success: "check-circle",
  error: "exclamation-circle",
  warning: "exclamation-triangle",
  info: "info-circle",
};

const COLOR_MAP: Record<Toast["type"], { border: string; bg: string; icon: string; text: string }> = {
  success: {
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/10",
    icon: "text-emerald-400",
    text: "text-emerald-200",
  },
  error: {
    border: "border-red-500/40",
    bg: "bg-red-500/10",
    icon: "text-red-400",
    text: "text-red-200",
  },
  warning: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/10",
    icon: "text-amber-400",
    text: "text-amber-200",
  },
  info: {
    border: "border-blue-500/40",
    bg: "bg-blue-500/10",
    icon: "text-blue-400",
    text: "text-blue-200",
  },
};

let toastCounter = 0;

const ToastItem: React.FC<{
  toast: Toast;
  onRemove: (id: string) => void;
}> = ({ toast, onRemove }) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const colors = COLOR_MAP[toast.type];

  useEffect(() => {
    // Trigger slide-in
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const duration = toast.duration ?? DEFAULT_DURATIONS[toast.type];
    if (duration <= 0) return;
    timerRef.current = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onRemove(toast.id), 300);
    }, duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast, onRemove]);

  const dismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    setTimeout(() => onRemove(toast.id), 300);
  };

  return (
    <div
      className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-lg backdrop-blur-sm transition-all duration-300 ${colors.border} ${colors.bg} bg-dark-800/95 ${
        visible ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
      }`}
      style={{ maxWidth: 380, minWidth: 260 }}
    >
      <Icon name={ICON_MAP[toast.type]} className={`${colors.icon} text-sm mt-0.5 shrink-0`} />
      <span className={`text-xs leading-relaxed flex-1 ${colors.text}`}>{toast.message}</span>
      <button
        onClick={dismiss}
        className="text-gray-500 hover:text-gray-300 transition-colors shrink-0 mt-0.5"
        title="关闭"
      >
        <Icon name="times" className="text-[10px]" />
      </button>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = `toast-${++toastCounter}-${Date.now()}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      {/* Toast stack — bottom-right corner */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 pointer-events-auto">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onRemove={removeToast} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
};
