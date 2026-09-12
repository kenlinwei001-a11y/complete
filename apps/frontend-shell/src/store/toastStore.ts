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
  /** 清空并**撤销所有待触发的自动消失定时器**（登出/切租户；测试 teardown 亦用它清场） */
  reset: () => void;
}

let seq = 0;
/**
 * 每条 toast 的自动消失定时器。**必须记下来**：原先是裸 setTimeout，谁也取消不了——
 * toast store 是模块级单例、不随组件卸载而终结，于是每弹一次 toast 就留下一个 6s 句柄，
 * 它会在测试环境拆除之后才 fire（vitest 记为 teardown 期未捕获错误 → 全绿却 RC≠0）。
 * 全量套件实测一次跑出 100 个这样的残留句柄，全部出自这一行。
 */
const autoDismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = `toast_${++seq}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    autoDismissTimers.set(
      id,
      setTimeout(() => {
        autoDismissTimers.delete(id);
        set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
      }, 6000),
    );
  },
  dismiss: (id) => {
    const timer = autoDismissTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      autoDismissTimers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },
  reset: () => {
    for (const timer of autoDismissTimers.values()) clearTimeout(timer);
    autoDismissTimers.clear();
    set({ toasts: [] });
  },
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
