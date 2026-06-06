"use client";

import { useEffect, useState } from "react";
import { X, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { subscribeToasts, dismissToast, type ToastMessage } from "@/lib/toast";

const ICON = {
  error: AlertCircle,
  info: Info,
  success: CheckCircle2,
} as const;

export function Toaster() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))]">
      {toasts.map((t) => {
        const Icon = ICON[t.type];
        return (
          <div
            key={t.id}
            role="alert"
            className="flex items-start gap-2 px-3 py-2 rounded-md text-xs shadow-lg border"
            style={{
              background: "var(--background)",
              borderColor:
                t.type === "error" ? "var(--destructive-foreground, #b91c1c)" : "var(--border)",
              color: "var(--foreground)",
            }}
          >
            <Icon
              size={14}
              className="mt-0.5 shrink-0"
              style={{ color: t.type === "error" ? "var(--destructive-foreground, #b91c1c)" : "var(--muted-foreground)" }}
              aria-hidden="true"
            />
            <span className="flex-1 break-words leading-relaxed">{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              className="shrink-0 hover:opacity-70"
              style={{ color: "var(--muted-foreground)" }}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
