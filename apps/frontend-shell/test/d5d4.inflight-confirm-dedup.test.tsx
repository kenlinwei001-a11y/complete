import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";
import { mockGlobalSim } from "@/mocks/simSolvers";

/**
 * D5 · 在途可见 + 二次调参确认 / D4 · 在途去重（同步求解通道 useLiveSolver → portfolio·最重求解器）。
 *
 * 头号判据 = **效果层**，不接受「弹窗渲染出来了」这种运输层断言：
 *  ① 在途 + **离散**调参 → 弹窗；点**确认** → **前序 fetch 拿到的那个 AbortSignal 真的 aborted**（D1 并线后
 *     这一 abort 会一路传到 DataCore/优化器 sidecar，底层求解真停）+ 新请求以新参数发出；
 *  ② 点**否** → 前序 signal **未** aborted、**无**新请求发出、UI 出「参数已改 · 结果对应旧参数」、
 *     且用户改动**未被丢弃**（随后点「重算」发出的就是新参数）；
 *  ③ **滑杆**连拖 → **不弹窗**（每动一下弹一次框不可用），仍是「最后发出者胜」（前序 signal 逐个 aborted）；
 *  ④ 同 (solverKey,args) 在途 → 只有 1 个在途请求（反复微调回同一组参数不叠加）。
 *
 * 为什么在 fetch 层抓 signal：test/setup.ts 为绕开 undici 跨 realm 校验，在网络层**剥掉**了 signal
 * （MSW handler 里的 request.signal 永远不会 abort）。故本用例在 setup 的包装**之外**再包一层，
 * 抓住应用真正交给 fetch 的那个 AbortSignal —— 断言的是「前序请求收到了 abort」这一真效果本身。
 */

type PortCall = { args: Record<string, unknown>; signal: AbortSignal };

let calls: PortCall[] = [];
let originalFetch: typeof globalThis.fetch;
/** 求解闸门：置真则 handler 挂起（制造稳定的「在途」窗口·不靠真实 sleep 计时） */
let holdSolve = false;
let waiters: (() => void)[] = [];

const releaseAll = (): void => {
  const w = waiters;
  waiters = [];
  for (const fn of w) fn();
};

function installPortfolio(): void {
  server.use(
    http.post("*/b/v1/solvers/portfolio/run", async ({ request }) => {
      const body = (await request.json()) as { args: Record<string, unknown> };
      if (holdSolve) await new Promise<void>((resolve) => waiters.push(resolve));
      return HttpResponse.json({ data: mockGlobalSim(body.args), snapshotVersion: "ov-d5d4" });
    }),
  );
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

beforeEach(() => {
  calls = [];
  waiters = [];
  holdSolve = false;
  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal && urlOf(input).includes("/solvers/portfolio/run")) {
      let args: Record<string, unknown> = {};
      try {
        args = (JSON.parse(String(init.body)) as { args: Record<string, unknown> }).args;
      } catch {
        /* 非 JSON body 不参与断言 */
      }
      calls.push({ args, signal: init.signal });
    }
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
});

afterEach(async () => {
  holdSolve = false;
  releaseAll();
  await new Promise((r) => setTimeout(r, 0));
  globalThis.fetch = originalFetch;
});

/** 渲染全局推演页 → 等基线解上屏（此后 in-flight = 空，可稳定制造在途窗口）。 */
async function bootGlobalSim(): Promise<void> {
  installPortfolio();
  loginAs("planner");
  renderApp("/v/global-sim");
  await screen.findByTestId("global-sim");
  await screen.findByTestId("global-sim-heatmatrix");
  await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
  await waitFor(() => expect(screen.queryByTestId("global-sim-recalc")).toBeNull());
}

/** 用一次离散调参把求解打进「在途」（闸门挂住），返回该在途请求的下标。 */
async function startHeldSolve(user: ReturnType<typeof userEvent.setup>): Promise<number> {
  holdSolve = true;
  const before = calls.length;
  await user.click(screen.getByTestId("global-sim-obj-min_cost"));
  await waitFor(() => expect(calls.length).toBe(before + 1));
  await screen.findByTestId("global-sim-recalc"); // 在途可见（徽标 + 已耗时 + 取消）
  return before;
}

describe("D5 · 在途可见（已耗时 + 主动取消）", () => {
  it("求解在途 → 徽标带「已耗时」秒数 + 可主动取消；取消后结果标「对应旧参数」且不再在途", async () => {
    const user = userEvent.setup();
    await bootGlobalSim();
    const idx = await startHeldSolve(user);

    // 在途可见：既有徽标扩展出已耗时读数 + 取消按钮（不新造一套状态显示）
    expect(screen.getByTestId("global-sim-elapsed")).toBeInTheDocument();
    const cancelBtn = screen.getByTestId("global-sim-cancel-solve");

    // 主动取消 → 前序 fetch 的 signal 真被 abort（不必靠改参数间接取消）
    await user.click(cancelBtn);
    await waitFor(() => expect(calls[idx]!.signal.aborted).toBe(true));
    expect(calls.length).toBe(idx + 1); // 取消不等于重发
    await waitFor(() => expect(screen.queryByTestId("global-sim-recalc")).toBeNull());
    // 屏上结果就此对应旧参数 → 明标 + 待「重算」（绝不静默不一致）
    expect(screen.getByTestId("global-sim-stale-banner")).toHaveTextContent("参数已改");
    expect(screen.getByTestId("global-sim-hero")).toHaveAttribute("data-stale", "true");
  });
});

describe("D5 · 二次调参确认（离散控件才弹 · 确认=真取消上一次推演）", () => {
  it("在途 + 离散调参 → 弹窗；点【确认】→ 前序请求真被 abort + 新参数请求发出", async () => {
    const user = userEvent.setup();
    await bootGlobalSim();
    const idx = await startHeldSolve(user);

    // 第二次离散调参（切主目标 = 下拉/开关类）→ 弹窗，且**此刻还没动前序、也没发新请求**
    await user.click(screen.getByTestId("global-sim-obj-min_changeover"));
    await screen.findByTestId("recompute-confirm");
    expect(calls.length).toBe(idx + 1);
    expect(calls[idx]!.signal.aborted).toBe(false);

    // 【确认】→ 效果层：前序 fetch 收到 abort（底层求解真停）+ 以新参数发起新请求
    holdSolve = false;
    releaseAll();
    await user.click(screen.getByTestId("recompute-confirm-ok"));
    await waitFor(() => expect(calls[idx]!.signal.aborted).toBe(true));
    await waitFor(() => expect(calls.length).toBe(idx + 2));
    expect(calls[idx + 1]!.args.objective).toBe("min_changeover");
    await waitFor(() => expect(screen.queryByTestId("recompute-confirm")).toBeNull());
    // 确认重算 = 不留旧参数标（结果与参数重新对齐）
    await waitFor(() => expect(screen.queryByTestId("global-sim-stale-banner")).toBeNull());
  });

  it("点【否】→ 前序未被 abort、新请求未发出、UI 标「参数已改·结果对应旧参数」；改动保留（点重算即按新参数发）", async () => {
    const user = userEvent.setup();
    await bootGlobalSim();
    const idx = await startHeldSolve(user);

    await user.click(screen.getByTestId("global-sim-obj-min_changeover"));
    await screen.findByTestId("recompute-confirm");

    await user.click(screen.getByTestId("recompute-confirm-keep"));
    await waitFor(() => expect(screen.queryByTestId("recompute-confirm")).toBeNull());

    // 越过 debounce 窗口也不得偷偷发起；前序在途请求也不得被取消
    await new Promise((r) => setTimeout(r, 500));
    expect(calls.length).toBe(idx + 1);
    expect(calls[idx]!.signal.aborted).toBe(false);

    // 红线②：结果区明标「参数已改 · 当前结果对应旧参数」并置灰
    expect(screen.getByTestId("global-sim-stale-banner")).toHaveTextContent("参数已改 · 当前结果对应旧参数");
    expect(screen.getByTestId("global-sim-stale")).toBeInTheDocument();
    expect(screen.getByTestId("global-sim-hero")).toHaveAttribute("data-stale", "true");

    // 红线①：绝不静默丢弃用户输入 —— 点「重算」发出的必须是**用户刚改的**新参数
    holdSolve = false;
    releaseAll();
    await user.click(screen.getByTestId("global-sim-stale-recompute"));
    await waitFor(() => expect(calls.length).toBe(idx + 2));
    expect(calls[idx + 1]!.args.objective).toBe("min_changeover");
    await waitFor(() => expect(screen.queryByTestId("global-sim-stale-banner")).toBeNull());
  });

  it("滑杆（连续控件）连拖 → 全程不弹窗，且仍是「最后发出者胜」（前序 signal 逐个 aborted）", async () => {
    const user = userEvent.setup();
    await bootGlobalSim();

    // 选转拨目标基地（select 本身不改 args·转拨量=0 时不携 committedBatches）
    const sel = screen.getByTestId("global-sim-transfer-base") as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBeGreaterThan(1));
    await user.selectOptions(sel, sel.options[1]!.value);

    holdSolve = true;
    const slider = screen.getByTestId("global-sim-transfer-slider");
    const base = calls.length;

    fireEvent.change(slider, { target: { value: "5" } });
    await waitFor(() => expect(calls.length).toBe(base + 1));
    fireEvent.change(slider, { target: { value: "10" } });
    await waitFor(() => expect(calls.length).toBe(base + 2));
    fireEvent.change(slider, { target: { value: "15" } });
    await waitFor(() => expect(calls.length).toBe(base + 3));

    // 细则①：滑杆全程不弹二次确认
    expect(screen.queryByTestId("recompute-confirm")).toBeNull();
    // 最后发出者胜：每一次前序都被取消，只剩最后一次在途
    await waitFor(() => expect(calls[base]!.signal.aborted).toBe(true));
    expect(calls[base + 1]!.signal.aborted).toBe(true);
    expect(calls[base + 2]!.signal.aborted).toBe(false);
    expect((calls[base + 2]!.args.committedBatches as { qty: number }[])[0]!.qty).toBe(150000);
  });
});

describe("D4 · 在途去重（同 solverKey+args 复用在途请求）", () => {
  it("微调后又调回同一组参数 → 该组参数已在途 → 不重复发起（只 1 个在途请求）", async () => {
    const user = userEvent.setup();
    await bootGlobalSim();

    const sel = screen.getByTestId("global-sim-transfer-base") as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBeGreaterThan(1));
    await user.selectOptions(sel, sel.options[1]!.value);

    holdSolve = true;
    const slider = screen.getByTestId("global-sim-transfer-slider");
    const base = calls.length;

    // 参数组 A 打出去并挂在途
    fireEvent.change(slider, { target: { value: "5" } });
    await waitFor(() => expect(calls.length).toBe(base + 1));
    const inFlight = calls[base]!;

    // 微调到 B 后立刻调回 A（去抖窗内 B 未发出）→ A 已在途 → 复用，不再发第二发
    fireEvent.change(slider, { target: { value: "10" } });
    fireEvent.change(slider, { target: { value: "5" } });
    await new Promise((r) => setTimeout(r, 600)); // 远超 debounce 300ms

    expect(calls.length).toBe(base + 1);
    expect(inFlight.signal.aborted).toBe(false); // 复用 = 不取消不重发
    expect(screen.queryByTestId("recompute-confirm")).toBeNull();
    expect(screen.getByTestId("global-sim-recalc")).toBeInTheDocument(); // 仍在途（可见）
  });
});
