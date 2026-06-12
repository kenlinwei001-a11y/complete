import { create } from "zustand";

export interface ToastItem {
  id: string;
  kind: "info" | "success" | "error" | "warn";
  message: string;
  code?: string;
  requestId?: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = `toast_${++seq}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, 6000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export function toastError(err: unknown): void {
  const e = err as { code?: string; message?: string; requestId?: string };
  useToastStore.getState().push({
    kind: "error",
    message: e?.message ?? String(err),
    code: e?.code,
    requestId: e?.requestId,
  });
}

export function toast(message: string, kind: ToastItem["kind"] = "info"): void {
  useToastStore.getState().push({ kind, message });
}
