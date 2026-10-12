"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  tone: "ok" | "err" | "info";
}

const ToastContext = createContext<{
  push: (message: string, tone?: Toast["tone"]) => void;
}>({ push: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function Toasts({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="card mono px-3 py-2 text-xs shadow-lg"
            style={{
              borderColor:
                t.tone === "ok"
                  ? "var(--accent)"
                  : t.tone === "err"
                    ? "var(--danger)"
                    : "var(--line-bright)",
              color:
                t.tone === "ok"
                  ? "var(--accent)"
                  : t.tone === "err"
                    ? "var(--danger)"
                    : "var(--fg)",
              maxWidth: "22rem",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
