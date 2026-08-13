import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SandboxViewConfig, SimSession } from "@platform/contracts";

/**
 * WO-SANDBOX-KPI-LAYER · 顶栏读数**按偏离度分层**门。
 *
 * ── 来历（仓主二次反馈 + 截图，2026-08-13）────────────────────────────────────
 * 上一轮 `WO-SANDBOX-UI-INTEGRATE` 只把**量纲口径**（`（0–100 指数·全对象均值）`）
 * 降进了 `?` 浮层，读数本身仍是 `cfg.stateVars.map()` **无条件全铺**。
 * 真实租户 16 个状态变量、同字号同权重排一行，实测值全在 49.5–50.4 之间 ——
 * **16 个几乎相同的数 = 零信息量，却占着一屏最贵的一条**。
 * 仓主原话：「布局还是这么密密麻麻，没有分层？」
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『量纲口径降层了』当作『这一行分层了』的证据，而前者并不度量后者。」**
 *   少了那截括号 ≠ 分了层。
 *
 * ── 为什么必须单开这个门（**上一轮五个套件全绿却零覆盖**）───────────────────
 * 收编日实测：`sandbox-declutter` 的 `CFG.stateVars` 是 `["s1"]`（1 个），
 * `sandbox-console.seam` 是 `["risk","load"]`（2 个）—— **都 ≤ 第一层容量 3**，
 * 于是 `<details>` 那条路**一次都没进过**，五个套件全绿而改动零覆盖。
 * 这正是铁律 0.5 判据 6 那个形态：**生产实参（16 个）与测试实参（1–2 个）交集为空**，
 * 「这个组件有测试」证明不了「生产走的那个分支有测试」。
 * 故本门的 CFG **必须** > 3 个 stateVar，且要驱动**排序**而不只是**条数**。
 *
 * ── 判据（两向都咬）──────────────────────────────────────────────────────────
 * ① **真降层**：偏离中位数最大的前 3 个在第一层，其余在 `<details>` 里；
 * ② **绝不删除（D4 守恒）**：全部 stateVar 的 testid 仍在 DOM 里，一个不少；
 * ③ **咬排序不只咬条数**：故意让「数组顺序靠前」与「偏离度最大」**错开** ——
 *    naive `slice(0,3)` 会当场红。缺这一条，本门就是个只会数数的哑门。
 *
 * R6 确定性：网络全桩，无时钟、无随机。
 */

const CFG: SandboxViewConfig = {
  tenantId: "t-kpi-layer",
  nodeTypes: ["TypeA"],
  linkTypes: [],
  // 8 个 —— 必须 > FIRST_LAYER_KPIS(3)，否则整条 <details> 分支跑不到（见文件头）。
  // 顺序刻意让**数组靠前的三个恰恰是偏离最小的**，以此咬住"按偏离度排"而非"按数组序取前三"。
  stateVars: ["flat_a", "flat_b", "flat_c", "flat_d", "flat_e", "spike_hi", "spike_lo", "spike_mid"],
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"],
  propagationCount: 0,
};

/**
 * 世界态：5 个 flat_* 全是 50（构成中位数），3 个 spike_* 明显偏离。
 * ⇒ 期望第一层 = spike_hi / spike_lo / spike_mid，`<details>` = 五个 flat_*。
 */
const WORLD: Record<string, Record<string, number>> = {
  obj1: {
    flat_a: 50, flat_b: 50, flat_c: 50, flat_d: 50, flat_e: 50,
    spike_hi: 92, spike_lo: 4, spike_mid: 71,
  },
};

vi.mock("@/api/endpoints", () => ({
  fetchWorkspace: vi.fn(),
  fetchSimViewConfig: vi.fn(),
  runSolver: vi.fn(async () => Promise.reject({ error: { code: "NOT_STUBBED", message: "本门不桩求解器", requestId: "req_test" } })),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_kpi", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, createdAt: "2026-08-13T00:00:00.000Z",
  } satisfies SimSession)),
  simTick: vi.fn(async (_id: string, n: number) => ({ curTick: n, state: WORLD })),
  simWorld: vi.fn(async () => ({ tick: 0, state: WORLD })),
  fetchSimSessions: vi.fn(async () => ({ items: [] })),
  simCheckpoint: vi.fn(),
  simBranch: vi.fn(),
  fetchSimCompare: vi.fn(),
  createActionDraft: vi.fn(),
  fetchSimCertification: vi.fn(async () => null),
  submitQuery: vi.fn(),
  searchObjects: vi.fn(async () => ({ items: [], total: 0 })),
}));

import SandboxView from "@/views/sim/SandboxView";

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

const ready = () => screen.findByTestId("sandbox-console");

describe("WO-SANDBOX-KPI-LAYER · 顶栏读数按偏离度分层", () => {
  it("① 真降层：偏离最大的 3 个在第一层，其余进 <details>；② D4 守恒：8 个 testid 一个不少", async () => {
    mount();
    await ready();
    await waitFor(() => expect(screen.getByTestId("sandbox-kpi-rest")).toBeTruthy());
    // ── 前置守护（非空转）：CFG 必须真的超出第一层容量，否则下面两向都恒真 ──
    expect(CFG.stateVars.length, "stateVars ≤ 3 时 <details> 根本不渲染，本门会空跑通过").toBeGreaterThan(3);

    // ② D4 守恒先咬：一个都不许少（降层 ≠ 删除）
    for (const v of CFG.stateVars) {
      expect(screen.getByTestId(`sandbox-kpi-${v}`), `${v} 掉了 —— 降层写成了删除，违反 D4`).toBeTruthy();
    }

    // ① 分层：第一层 = 顶栏里**不在 <details> 内**的那些
    const rest = screen.getByTestId("sandbox-kpi-rest");
    const inRest = CFG.stateVars.filter((v) => within(rest).queryByTestId(`sandbox-kpi-${v}`) !== null);
    const inFirst = CFG.stateVars.filter((v) => !inRest.includes(v));

    // ③ 咬**排序**不只咬条数。期望值**从屏上真实读数现算**，不写死 —— 组件的世界态来自
    //    `deriveBaseSnapshot(cfg)` 与 `simWorld`/`simTick` 三处，写死期望等于赌哪一处赢（实测赌输过）。
    const shown = new Map(
      CFG.stateVars.map((v) => [v, Number(screen.getByTestId(`sandbox-kpi-${v}-val`).textContent)]),
    );
    // 前置守护（本条最要紧）：读数必须**真的分散**，否则排序恒平手、③ 无法失败 ——
    // 那正是「断言存在、语义正确、且是绿的，只是取样点落在裁与不裁同解的值上」那个形态。
    expect(new Set(shown.values()).size, "屏上读数全同 ⇒ 排序判据无法失败，本条会空跑通过").toBeGreaterThan(3);

    const vals = [...shown.values()].sort((a, b) => a - b);
    const median = vals.length % 2 ? vals[(vals.length - 1) / 2]! : (vals[vals.length / 2 - 1]! + vals[vals.length / 2]!) / 2;
    const expectedFirst = [...shown.entries()]
      .sort((a, b) => Math.abs(b[1] - median) - Math.abs(a[1] - median) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, 3)
      .map(([v]) => v);
    // 数组序（flat_a/b/c 排最前）与偏离序**不同** ⇒ naive `slice(0,3)` 会当场红。
    expect(expectedFirst.sort()).not.toEqual(CFG.stateVars.slice(0, 3).sort());
    expect([...inFirst].sort()).toEqual([...expectedFirst].sort());
    expect(inRest.length).toBe(CFG.stateVars.length - 3);

    // 降层的**可见记号**（规范 §1：静默降层等于删除）
    expect(screen.getByTestId("sandbox-kpi-rest-toggle").textContent ?? "").toContain(String(inRest.length));
  });

  it("④ 第一层容量守恒：无论多少个 stateVar，第一层读数个数不随之膨胀（这才是「不密密麻麻」的机器判据）", async () => {
    mount();
    await ready();
    await waitFor(() => expect(screen.getByTestId("sandbox-kpi-rest")).toBeTruthy());
    const rest = screen.getByTestId("sandbox-kpi-rest");
    const inFirst = CFG.stateVars.filter((v) => within(rest).queryByTestId(`sandbox-kpi-${v}`) === null);
    // 上限咬死：读数 8 个而第一层恒 3 个。若哪天有人把 map 改回全铺，本条当场红。
    expect(inFirst.length).toBeLessThanOrEqual(3);
    expect(inFirst.length, "第一层一个读数都没有 ⇒ 降过头了，等于把结论也收走").toBeGreaterThan(0);
  });
});
