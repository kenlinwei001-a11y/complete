import "./leakGuard"; // 必须最早：包装 setTimeout/setInterval 之前不能有 app 代码排定时器
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// waitFor/findBy 默认超时 1000ms，在整套并行/顺序跑（CPU 争用）下偏紧 —— 同一用例单独跑能过、
// 全套跑因数据加载+渲染 >1s 而 "Unable to find element"。抬高异步断言超时以消除负载诱发的偶发失败。
configure({ asyncUtilTimeout: 15000 });
import { setupServer } from "msw/node";
import { clearMockTimers, handlers, resetMockSim } from "@/mocks/handlers";
import { resetMockDb } from "@/mocks/db";
import { clearTaskScripts, installMockEventSource, MockEventSource } from "@/mocks/mockEventSource";
import { queryClient } from "@/store/queryClient";
import { tokenStore } from "@/api/tokenStore";
import { useSessionStore } from "@/store/sessionStore";
import { useToastStore } from "@/store/toastStore";
import { harvestLeakedTimers } from "./leakGuard";

export const server = setupServer(...handlers);

// jsdom 不实现 HTMLCanvasElement.getContext（原交付环境装了 jsdom 可选原生依赖 canvas；
// 可移植/本机环境无 cairo 原生库时 echarts 渲染抛 "Not implemented" 并跨测试文件污染）。
// 注入轻量 2D context 桩：echarts 仅需绘图方法不抛错 + measureText 返回宽度即可正常渲染 DOM。
if (typeof HTMLCanvasElement !== "undefined" && !(HTMLCanvasElement.prototype as { __ctxStubbed?: boolean }).__ctxStubbed) {
  const noop = () => undefined;
  const make2dContext = () =>
    new Proxy(
      {
        measureText: (t: string) => ({ width: (t?.length ?? 0) * 6 }),
        getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        createPattern: () => null,
        setLineDash: noop,
        getLineDash: () => [] as number[],
      } as Record<string, unknown>,
      {
        get(target, prop) {
          return prop in target ? target[prop as string] : noop;
        },
        set(target, prop, value) {
          target[prop as string] = value;
          return true;
        },
      },
    );
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return make2dContext() as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement["getContext"];
  (HTMLCanvasElement.prototype as { __ctxStubbed?: boolean }).__ctxStubbed = true;
}

// rAF polyfill（jsdom 非 pretendToBeVisual 模式）
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  installMockEventSource();
  MockEventSource.defaultDelay = 5;

  // Node 20→24 + undici：fetch 构造 Request 时校验 signal instanceof（其 realm 的）AbortSignal，
  // 而 app/TanStack Query 创建的 signal 来自 jsdom realm → 抛 "Expected signal to be an instance
  // of AbortSignal"。测试不需要真实 abort，包一层 fetch 剥掉跨 realm signal（在 MSW 之外，最外层）。
  const baseFetch = globalThis.fetch?.bind(globalThis);
  if (baseFetch) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (init && "signal" in init && init.signal != null) {
        const { signal: _signal, ...rest } = init;
        return baseFetch(input, rest);
      }
      return baseFetch(input, init);
    }) as typeof fetch;
  }
  // react-router 导航构造 new Request(url, {signal})，signal 来自 jsdom realm 的 AbortController，
  // undici Request 校验 instanceof（其 realm 的）AbortSignal 失败 → 抛错。剥掉网络层 signal；
  // app 自身竞态以 controller.signal.aborted 在 JS 层判断，不依赖网络层 abort，安全。
  const RealRequest = globalThis.Request;
  if (RealRequest) {
    class PatchedRequest extends RealRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        if (init && "signal" in init && init.signal != null) {
          const { signal: _signal, ...rest } = init;
          super(input as RequestInfo, rest);
        } else {
          super(input as RequestInfo, init);
        }
      }
    }
    globalThis.Request = PatchedRequest as unknown as typeof Request;
  }
});

afterEach(async () => {
  cleanup();
  server.resetHandlers();
  resetMockDb();
  resetMockSim(); // WO-L4B：沙盘会话/世界态 store 是模块态，不清会跨用例串味
  clearMockTimers();
  clearTaskScripts();
  useToastStore.getState().reset();
  // ⚠ 先 cancel 再 clear。`clear()` 只丢弃缓存，**不中止在途请求**：已发出的 fetch 会在测试环境
  //    拆除之后才 resolve，vitest 随即报 "caught after test environment was torn down" 并判整包红。
  //    因其取决于请求与拆除的先后，同一提交可能一次绿一次红（CI 上真实出现过）。
  await queryClient.cancelQueries();
  queryClient.clear();
  tokenStore.clear();
  useSessionStore.getState().reset();

  // ---- 残留句柄守卫（欠账 #79）----------------------------------------------------
  // 上面这些 reset 全做完、组件也已卸载之后，进程里若还活着 app 排的定时器，它就是下一次
  // 「teardown 期未捕获异步错误」的火种：回调在 jsdom 环境拆掉后才 fire，vitest 记为
  // unhandled error，表现成「全部用例 passed / Errors 1 error / 退出码非 0」——同码同上下文
  // 一次绿一次红。断言咬的是**句柄本身还在不在**（效果层），不是「有没有写 cleanup」（运输层）。
  // harvest 会先真把它们清掉再报，守卫自己不成为下一条用例的污染源。
  const leaked = harvestLeakedTimers();
  if (leaked.length > 0) {
    throw new Error(
      `[leak-guard] 用例结束后仍有 ${leaked.length} 个 app 定时器存活，其回调会在测试环境拆除后才 fire` +
        `（= "This error was caught after test environment was torn down" · 整包随机红的成因）：\n` +
        leaked.map((l) => `  · ${l}`).join("\n"),
    );
  }
});

afterAll(() => server.close());
