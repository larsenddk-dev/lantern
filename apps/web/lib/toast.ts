/**
 * Tiny global toast bus — framework-free pub/sub so any module (including the
 * API client) can surface a transient message. Rendered by <Toaster />.
 */

export type ToastType = "error" | "info" | "success";

export interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

type Listener = (toasts: ToastMessage[]) => void;

let toasts: ToastMessage[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

function emit() {
  for (const l of listeners) l(toasts);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, type: ToastType = "error"): number {
  const id = nextId++;
  toasts = [...toasts, { id, message, type }];
  emit();
  if (typeof window !== "undefined") {
    window.setTimeout(() => dismissToast(id), 4500);
  }
  return id;
}
