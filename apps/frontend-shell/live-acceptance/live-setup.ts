// 真后端验收的 setup：**不装 MSW**（请求真的打到 127.0.0.1:4801），只补 jsdom 缺的两件东西。
import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 30000 });

if (typeof HTMLCanvasElement !== "undefined") {
  const noop = () => undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = () =>
    new Proxy({ measureText: (t: string) => ({ width: (t?.length ?? 0) * 6 }) } as Record<string, unknown>, {
      get: (t, p) => (p in t ? (t as Record<string, unknown>)[p as string] : noop),
    });
}
if (typeof globalThis.ResizeObserver === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof globalThis.EventSource === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).EventSource = class {
    close() {}
    addEventListener() {}
  };
}
