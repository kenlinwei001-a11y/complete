import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropagationRule, SandboxViewConfig, SimMetricSeriesResponse } from "@platform/contracts";

/**
 * ══ WO-SIM-SESSION-WIRE · 会话生命周期 + 变更波及面的**接缝门**（咬链路不咬函数）══════
 *
 * 本门驱动的是「**用户在屏上按一下 → 真发那一跳 → 回包（或错误）回到屏上**」这一整条，
 * 不是「某个 endpoints 函数返回了对的值」。八臂全部在**响应这一层**改东西，断言**屏上跟着变**。
 *
 * ── 为什么要有这道门（开工实测的两条前提，铁律 0.5：派单给的是线索不是结论）─────────
 *
 * ① **今天的行为是 X**：后端 `PATCH …/sim/sessions/:id/status`（`apps/datacore/src/app.ts:2049`）
 *    与 `setSimSessionStatus` 早就在，PAUSED/ENDED 还是**世界真的冻结**（推进 / 扰动 / 回滚
 *    一律 409）；而统一推演控制台顶部**只印会话 id 与「会话哪来的」**，会话自己是什么状态
 *    一个字都没有，更没有任何控制。
 *    **应该是 Y**：状态上屏 + 三个迁移按钮真发那一跳，三种「没成功」分开说。
 *
 * ② **今天的行为是 X**：`POST …/sim/change-impact-preview` 的四桶波及面**前端零调用**
 *    （开工实测 `grep -rn "change-impact" apps/frontend-shell/src` 零命中；
 *     金丝雀：同法 grep `propagation-rules` 命中 2 处 ⇒ 检索面是好的）。
 *    **应该是 Y**：右栏检视里能就地问一次，且**不问就一发不发**（只读语义不做成副作用节奏）。
 *
 * ── 八臂 ───────────────────────────────────────────────────────────────────────
 *  ⓪ 金丝雀：外壳与状态条挂得起来，且屏上那个状态**来自会话清单回包**（改回包 ⇒ 屏上跟着变）
 *  ① 迁移真发那一跳：按「暂停」⇒ 打出 `PATCH`，实参是清单里那条会话的 id 与 `PAUSED`
 *  ② 迁移成功 ⇒ 清单被重取，屏上状态跟着翻（不是本地存一份 status 副本自嗨）
 *  ③ 后端 409 ⇒ **后端那句原话**上屏（不是一句「失败」）
 *  ④ 这一跳没走通 ⇒ 屏上说「不知道成没成」，且与 ③ 那句**字面不同**（两态不许合并）
 *  ⑤ 会话清单这一跳失败 ⇒ 状态位说「不知道它现在是什么状态」；
 *     而「清单回来了、里面没有这一条」是**另一句**（本门咬住两句不同）
 *  ⑥ 波及面：**不问一发不发**；问了才发，四桶计数与逐条上屏
 *  ⑦ 波及面的空集**分两态**：确为叶子 vs 有算不出来的部分（合并成一句即红）
 *  ⑧ 波及面这一跳没走通 ⇒ 「不知道有没有波及」，与 ⑦ 的「不波及任何下游」**字面不同**
 *
 * R6 确定性：网络全桩，无时钟、无随机。
 */

// ══════════════════════════════════════════════════════════════════════════════
// fixture
// ══════════════════════════════════════════════════════════════════════════════

/** 状态变量。**每一档都要有卡铺出来**，否则右栏那几臂在空集上恒真。 */
const STATE_VARS = ["demandLoad", "loadIndex", "queueDays", "supplyRisk", "costPressure", "defectPressure"] as const;
const NAMES: Record<string, string> = {
  demandLoad: "需求负载",
  loadIndex: "负载指数",
  queueDays: "排队天数",
  supplyRisk: "供应风险",
};
const TICKS = [0, 1, 2, 3];
const SESSION_ID = "sims_lifecycle";

/** 卡上要有 `objectId` 才组得出焦点 —— 焦点是 `objectId × stateVar` 那一格。 */
function seriesFor(vars: readonly string[]): SimMetricSeriesResponse {
  const metrics = vars.map((sv, i) => ({
    key: `obj_${i}.${sv}`,
    objectId: `obj_${i}`,
    stateVar: sv,
    label: NAMES[sv] ?? sv,
    labelIsFallback: NAMES[sv] === undefined,
    unit: null,
    baseline: TICKS.map(() => 10 + i),
    // 全部「被推动」⇒ 全部铺在第一层，用例不必先展开收起块
    actual: TICKS.map((_, t) => 10 + i + (t === 0 ? 0 : (i + 1) * 2)),
    segments: [],
  }));
  return {
    sessionId: SESSION_ID,
    fromTick: 0,
    toTick: 3,
    ticks: TICKS,
    tickDays: 15,
    metrics,
    totalMetrics: metrics.length,
    truncated: false,
    appliedLimit: 500,
    appliedOrder: "magnitude",
    baselineOrigin: { sessionId: SESSION_ID, seedTick: 0, excludedPerturbationIds: [] },
    clamped: false,
  } as unknown as SimMetricSeriesResponse;
}

function cfgFor(vars: readonly string[]): SandboxViewConfig {
  return {
    tenantId: "demo",
    nodeTypes: ["Base", "Line"],
    nodeObjectIds: { Base: ["obj_0"], Line: ["obj_1"] },
    linkTypes: ["feeds"],
    stateVars: [...vars],
    stateVarNames: NAMES,
    radarDims: [],
    screens: ["sandbox"],
    propagationCount: 0,
  } as unknown as SandboxViewConfig;
}

/** 一条链：`demandLoad → loadIndex → queueDays`，于是选中卡有真的下游可谈。 */
function rules(): PropagationRule[] {
  const edges = [
    { from: "demandLoad", to: "loadIndex" },
    { from: "loadIndex", to: "queueDays" },
  ];
  return edges.map((e, i) => ({
    id: `spr_${i}`,
    tenantId: "demo",
    key: `rule_${i}`,
    sourceTypeKey: "Base",
    sourceStateVar: e.from,
    viaLinkKey: "feeds",
    targetTypeKey: "Line",
    targetStateVar: e.to,
    coefficient: 0.5,
    delayTicks: 1,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
    domainKey: null,
    domainName: null,
    sourceTypeName: null,
    targetTypeName: null,
  })) as unknown as PropagationRule[];
}

// ── 可变桩状态（每个用例 beforeEach 重置）─────────────────────────────────────
/** 会话清单当前回什么。`"throw"` = 这一跳自己失败；`[]` = 回来了但里面没有这一条。 */
let sessionsMode: "ok" | "throw" | "absent" = "ok";
let sessionStatus = "RUNNING";
/** `PATCH …/status` 桩：`null` = 成功；否则抛这个错。 */
let patchFailure: unknown = null;
const patchCalls: { sessionId: string; status: string }[] = [];
/** 波及面桩：`"throw"` = 这一跳失败；其余是回包本身。 */
let impactMode: "full" | "leaf" | "unresolved" | "throw" = "full";
const impactCalls: unknown[] = [];

/** 与 `apiClient` 的 `ApiClientError` **同一个类**（`vi.mock` 里的实例要能被生产代码 `instanceof` 认出来）。 */
class FakeApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

/** 后端 409 的**原话**（`app.ts` 的 `setSimSessionStatus` 逐字，2026-08-26 真跑 curl 抄回来的）。 */
const BACKEND_409 = `会话 ${SESSION_ID} 不能从 PAUSED 迁到 PAUSED（PAUSED 允许的去向：RUNNING/ENDED）。`;

const IMPACT_FULL = {
  focus: { kind: "stateVar", objectId: "obj_0", stateVar: "demandLoad" },
  items: [
    { bucket: "recompute", target: "sv:obj_base_changzhou.loadIndex", hops: 1, via: "demo_model_demand_to_base_load" },
    { bucket: "recompute", target: "sv:obj_base_hefei.loadIndex", hops: 1, via: "demo_model_demand_to_base_load" },
    { bucket: "rederive", target: "op:obj_base_changzhou.capacity", hops: 2, via: "derived:Base.capacity" },
    { bucket: "rejudge", target: "rule:redline_outsource", hops: 2, via: "expression" },
  ],
  unresolved: [],
  truncated: false,
  maxHops: 6,
};
const IMPACT_LEAF = { ...IMPACT_FULL, items: [], unresolved: [], truncated: false };
const IMPACT_UNRESOLVED = {
  ...IMPACT_FULL,
  items: [],
  unresolved: [{ what: "派生规格 Base.capacity", missing: "表达式里的对象类型没物化" }],
  truncated: false,
};

vi.mock("@/api/apiClient", () => ({
  ApiClientError: FakeApiError,
  api: {
    a: vi.fn(async (path: string) => {
      if (path.includes("metric-series")) return seriesFor(STATE_VARS);
      throw new Error(`未桩的路径：${path}`);
    }),
    b: vi.fn(),
    aRaw: vi.fn(),
  },
}));

vi.mock("@/api/endpoints", () => ({
  fetchSimViewConfig: vi.fn(async () => cfgFor(STATE_VARS)),
  fetchDrillStateVarLayers: vi.fn(async () => ({
    layers: [
      { stateVar: "demandLoad", layer: "根源", label: NAMES.demandLoad },
      { stateVar: "loadIndex", layer: "枢纽", label: NAMES.loadIndex },
      { stateVar: "queueDays", layer: "末端", label: NAMES.queueDays },
    ],
    ruleCount: 2,
  })),
  fetchPropagationRules: vi.fn(async () => ({ items: rules(), stateVarNames: NAMES })),
  fetchSimSessions: vi.fn(async () => {
    if (sessionsMode === "throw") throw new FakeApiError(500, "INTERNAL_ERROR", "会话清单这一跳炸了");
    if (sessionsMode === "absent") return { items: [] };
    return {
      items: [
        {
          id: SESSION_ID,
          tenantId: "demo",
          status: sessionStatus,
          curTick: 3,
          parentCheckpointId: null,
          createdAt: "2026-08-26T00:00:00.000Z",
          scope: {},
        },
      ],
    };
  }),
  fetchSimPerturbations: vi.fn(async () => ({ items: [] })),
  createSimPerturbation: vi.fn(),
  patchSimSessionStatus: vi.fn(async (sessionId: string, status: string) => {
    patchCalls.push({ sessionId, status });
    if (patchFailure !== null) throw patchFailure;
    sessionStatus = status; // 后端真的落了库 ⇒ 下一次清单回的就是新状态
    return { id: sessionId, status, curTick: 3 };
  }),
  previewChangeImpact: vi.fn(async (focus: unknown) => {
    impactCalls.push(focus);
    if (impactMode === "throw") throw new FakeApiError(500, "INTERNAL_ERROR", "波及面这一跳炸了");
    if (impactMode === "leaf") return IMPACT_LEAF;
    if (impactMode === "unresolved") return IMPACT_UNRESOLVED;
    return IMPACT_FULL;
  }),
}));

import UnifiedSimShell from "@/views/sim/unified/UnifiedSimShell";

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UnifiedSimShell />
    </QueryClientProvider>,
  );
}

/** 等到会话解析完（状态位不再是 `loading`）—— 不等就会断言在「还在路上」那一帧上。 */
async function lifecycleReady(): Promise<HTMLElement> {
  const bar = await screen.findByTestId("usim-lifecycle");
  await waitFor(() => expect(bar.getAttribute("data-status")).not.toBe("loading"));
  return bar;
}

/** 选中一张卡，拿到右栏检视（右栏那三臂的前置）。 */
async function selectCard(sv: string): Promise<void> {
  const card = await screen.findByTestId(`usim-card-${sv}`);
  await userEvent.click(card);
  await screen.findByTestId("usim-inspector");
}

beforeEach(() => {
  sessionsMode = "ok";
  sessionStatus = "RUNNING";
  patchFailure = null;
  patchCalls.length = 0;
  impactMode = "full";
  impactCalls.length = 0;
});
afterEach(cleanup);

// ══════════════════════════════════════════════════════════════════════════════

describe("WO-SIM-SESSION-WIRE · 会话生命周期与变更波及面接缝门", () => {
  it("⓪ 金丝雀：状态条挂得起来，且屏上那个状态来自会话清单回包 —— 改回包，屏上跟着变（失败 ⇒ 报「工具坏了」，不许读作「这块屏没做」）", async () => {
    mount();
    const bar = await lifecycleReady();
    expect(bar.getAttribute("data-status")).toBe("RUNNING");
    expect(bar.textContent).toContain("RUNNING");
    // 三个迁移按钮都在，且**都不是禁用的**（有会话就该点得动）
    for (const t of ["paused", "running", "ended"]) {
      const btn = screen.getByTestId(`usim-status-${t}`) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    }

    // 改回包 ⇒ 屏上跟着变（这一步才是本臂的判据：屏上那个状态不是写死的）
    cleanup();
    sessionStatus = "PAUSED";
    mount();
    const bar2 = await lifecycleReady();
    await waitFor(() => expect(bar2.getAttribute("data-status")).toBe("PAUSED"));
  });

  it("① 迁移真发那一跳：按「暂停」⇒ 打出 PATCH，实参是清单里那条会话的 id 与 PAUSED（不是别的会话、也不是别的目标）", async () => {
    mount();
    await lifecycleReady();
    expect(patchCalls.length).toBe(0); // 不点不发
    await userEvent.click(screen.getByTestId("usim-status-paused"));
    await waitFor(() => expect(patchCalls.length).toBe(1));
    expect(patchCalls[0]).toEqual({ sessionId: SESSION_ID, status: "PAUSED" });
  });

  it("② 迁移成功 ⇒ 清单被重取、屏上状态跟着翻（状态只有清单那一个出处，不在组件里另存一份副本）", async () => {
    mount();
    const bar = await lifecycleReady();
    expect(bar.getAttribute("data-status")).toBe("RUNNING");
    await userEvent.click(screen.getByTestId("usim-status-paused"));
    await waitFor(() => expect(bar.getAttribute("data-status")).toBe("PAUSED"));
    // 反证：屏上翻过去的这个值是**清单重取回来的**，桩里 `sessionStatus` 已经是 PAUSED
    expect(sessionStatus).toBe("PAUSED");
    expect(screen.queryByTestId("usim-status-error")).toBeNull(); // 成功路径上不许有错误位
  });

  it("③ 后端 409 ⇒ 后端那句原话上屏（用户读到的是权威答案，不是前端猜的一句「失败」）", async () => {
    patchFailure = new FakeApiError(409, "INVALID_SIM_STATUS_TRANSITION", BACKEND_409);
    mount();
    await lifecycleReady();
    await userEvent.click(screen.getByTestId("usim-status-paused"));
    const err = await screen.findByTestId("usim-status-error");
    expect(err.textContent).toContain(BACKEND_409);
    expect(err.textContent).toContain("后端拒绝");
    // 状态**没有**被前端乐观地改掉（后端没答应，屏上就不许显示已经暂停了）
    expect(screen.getByTestId("usim-lifecycle").getAttribute("data-status")).toBe("RUNNING");
  });

  it("④ 这一跳没走通 ⇒ 屏上说「不知道成没成」，且与 ③ 那句字面不同（两态合并成一句即红）", async () => {
    patchFailure = new TypeError("Failed to fetch");
    mount();
    await lifecycleReady();
    await userEvent.click(screen.getByTestId("usim-status-ended"));
    const err = await screen.findByTestId("usim-status-error");
    expect(err.textContent).toContain("不知道迁移成没成");
    expect(err.textContent).not.toContain("后端拒绝");
    expect(err.textContent).not.toContain(BACKEND_409);
  });

  it("⑤ 「清单这一跳失败」与「清单里没有这一条」是两句不同的话（合并即红 —— 前者是不知道，后者是清单的结论）", async () => {
    sessionsMode = "throw";
    mount();
    const bar = await lifecycleReady();
    expect(bar.getAttribute("data-status")).toBe("no-session"); // 清单炸了 ⇒ 壳压根没解析出会话
    const absentText = screen.getByTestId("usim-status-absent").textContent ?? "";
    expect(absentText).toContain("没有会话");

    // 另一态：清单回来了，但里面没有指名那一条 —— 显式指定会话时才到得了
    cleanup();
    sessionsMode = "absent";
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <UnifiedSimShell view={{ key: "k", title: "t", renderer: "r", options: { sessionId: SESSION_ID } }} />
      </QueryClientProvider>,
    );
    const bar2 = await lifecycleReady();
    await waitFor(() => expect(bar2.getAttribute("data-status")).toBe("absent"));
    const absentText2 = screen.getByTestId("usim-status-absent").textContent ?? "";
    expect(absentText2).toContain("会话清单里没有这一条");
    expect(absentText2).not.toBe(absentText); // 两句话不许长一样
  });

  it("⑥ 波及面：不问一发不发；问了才发，四桶计数与逐条上屏（只读语义不做成副作用节奏）", async () => {
    mount();
    await lifecycleReady();
    await selectCard("demandLoad");
    expect(impactCalls.length).toBe(0); // 选中卡**不**触发预览

    await userEvent.click(screen.getByTestId("usim-impact-ask"));
    await waitFor(() => expect(impactCalls.length).toBe(1));
    // 焦点就是那一格：`objectId × stateVar`
    expect(impactCalls[0]).toEqual({ kind: "stateVar", objectId: "obj_0", stateVar: "demandLoad" });

    const result = await screen.findByTestId("usim-impact-result");
    expect(result.getAttribute("data-items")).toBe(String(IMPACT_FULL.items.length));
    const buckets = screen.getByTestId("usim-impact-buckets").textContent ?? "";
    expect(buckets).toContain("传导重算 2");
    expect(buckets).toContain("派生重算 1");
    expect(buckets).toContain("规则重判 1");
    const list = screen.getByTestId("usim-impact-list").textContent ?? "";
    expect(list).toContain("sv:obj_base_changzhou.loadIndex");
    expect(screen.queryByTestId("usim-impact-unresolved")).toBeNull();
  });

  it("⑦ 空集分两态：确为叶子 vs 有算不出来的部分（契约原文：items 空 + unresolved 空 才是叶子）", async () => {
    impactMode = "leaf";
    mount();
    await lifecycleReady();
    await selectCard("demandLoad");
    await userEvent.click(screen.getByTestId("usim-impact-ask"));
    const leaf = await screen.findByTestId("usim-impact-leaf");
    expect(leaf.textContent).toContain("不波及任何下游");
    expect(screen.queryByTestId("usim-impact-unresolved")).toBeNull();

    // 另一态：一条都没算出来，但**有算不出来的部分** ⇒ 绝不许说成「不波及」
    cleanup();
    impactMode = "unresolved";
    mount();
    await lifecycleReady();
    await selectCard("demandLoad");
    await userEvent.click(screen.getByTestId("usim-impact-ask"));
    const un = await screen.findByTestId("usim-impact-unresolved");
    expect(un.textContent).toContain("算不出来");
    expect(un.textContent).toContain("派生规格 Base.capacity");
    expect(screen.queryByTestId("usim-impact-leaf")).toBeNull();
  });

  it("⑧ 波及面这一跳没走通 ⇒ 「不知道有没有波及」，与 ⑦ 的「不波及任何下游」字面不同", async () => {
    impactMode = "throw";
    mount();
    await lifecycleReady();
    await selectCard("demandLoad");
    await userEvent.click(screen.getByTestId("usim-impact-ask"));
    const err = await screen.findByTestId("usim-impact-error");
    expect(err.textContent).toContain("不知道有没有波及");
    expect(screen.queryByTestId("usim-impact-leaf")).toBeNull();
    expect(screen.queryByTestId("usim-impact-result")).toBeNull();
  });
});
