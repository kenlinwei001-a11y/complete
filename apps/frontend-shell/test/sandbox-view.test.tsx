import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimSession } from "@platform/contracts";

/**
 * 增量 4 · R14 两配置证（证零行业锁死）：同一 <SandboxView> 代码，喂两个**结构不同**的
 * SandboxViewConfig（nodeTypes/stateVars 各异，行业实体名不同），都正确渲染对应节点数 + KPI + tick 交互，
 * 组件**零改动**。grep 见 SandboxView.tsx 源码无任何行业实体名（debattery:check 守这条）。
 *
 * 网络层（createSimSession/simTick/fetchSimCertification）以 vi.mock 桩接，确定性、无后端。
 */

// ── 网络桩：tick 时把每个对象每个状态变量 +10（断言节点色/KPI 随 tick 变化）。 ──────────────
const tickFn = vi.fn();
vi.mock("@/api/endpoints", () => ({
  fetchSimViewConfig: vi.fn(),
  fetchSimPropagationRules: vi.fn(async () => ({ items: [] })),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_test", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, feeds: [], createdAt: "2026-06-25T00:00:00.000Z",
  } satisfies SimSession)),
  simTick: vi.fn(async (sessionId: string, n: number) => {
    tickFn(sessionId, n);
    // 读不到 base 这里直接造一个递增态：由测试通过断言「值变化」验证，不依赖具体数。
    return { curTick: n, state: { __mut: { v: 999 } } };
  }),
  simWorld: vi.fn(),
  simCheckpoint: vi.fn(async () => ({ id: "cp1", sessionId: "sims_test", tenantId: "t", tick: 1, label: "tick1", createdAt: "x" })),
  simBranch: vi.fn(async () => ({ id: "sims_child", tenantId: "t", baseSnapshot: {}, scope: {}, status: "READY", curTick: 0, parentCheckpointId: "cp1", createdAt: "x" })),
  fetchSimCompare: vi.fn(async () => ({ a: [], b: [] })),
  fetchSimSessions: vi.fn(async () => []), // WO-SANDBOX-RUN-HISTORY：历史面板消费（空→诚实空态·不干扰既有断言）
  createActionDraft: vi.fn(async () => ({ draftId: "ad1", status: "PENDING" })),
  fetchObjectLineage: vi.fn(async (objectType: string, objectId: string) => ({
    object: { id: objectId, type: objectType, origin: { kind: "MATERIALIZED" } },
    source: {
      connection: { id: "conn1", name: "原型导入:demo", connectorTypeKey: "prototype_html", lastSyncAt: null },
      rawDataset: { id: "ds1", name: "orders_raw", rowCount: 24, fields: ["so", "cust"] },
      rawRowIdx: 0,
      rawRow: { so: "SO-3391" },
    },
    derivations: [{ prop: "revenueWan", formula: "p50*priceWan" }],
    snapshotVersion: "v1",
  })),
  fetchSimCertification: vi.fn(async () => ({
    scope: "GLOBAL", targetRef: null, level: "L2_RUNNABLE",
    dims: { structure: 60, knowledge: 40, behavior: 30, composite: 45 },
    l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
    trialTick: { passed: false, rulesFired: 0, at: null, error: null },
    worldCompleteness: { pct: 55, stateVars: { present: 2, needed: 4 }, derivationRules: { present: 1, needed: 2 }, actions: { present: 0, needed: 1 }, propagationRules: { present: 0, needed: 0 }, entering: [] },
    canEnterSimulation: false,
    gaps: [{ gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" }],
    computedAt: "2026-06-25T00:00:00.000Z",
  })),
  // 轨Q 增量2/3/4：评估清单/Schema规则/风险榜/控制台所需端点桩（benign 空数据，确定性·无后端）。
  fetchObjectTypes: vi.fn(async () => []),
  invokeSolver: vi.fn(async () => ({ data: { cards: [] }, snapshotVersion: "x" })),
  fetchSkills: vi.fn(async () => []),
  fetchMcpConfigs: vi.fn(async () => []),
  fetchDomainEvents: vi.fn(async () => []),
  fetchScenarioCards: vi.fn(async () => ({ launcherEnabled: false, total: 0, items: [] })),
  fetchWorkspace: vi.fn(async () => ({ scenarioPackages: [], navigation: [], views: [] })),
  submitQuery: vi.fn(async () => ({ taskId: "t1", status: "ROUTING", streamUrl: "" })),
}));

// 在 mock 之后 import 组件（确保用到桩）。
import SandboxView from "@/views/sim/SandboxView";
import { fetchSimPropagationRules } from "@/api/endpoints";

// 配置 A（供应链行业）vs 配置 B（物流行业）—— 结构不同，证同代码跑通两行业（R14）。
const CONFIG_A: SandboxViewConfig = {
  tenantId: "tenant-a",
  nodeTypes: ["Supplier", "Factory", "Order"],
  linkTypes: ["supplies", "produces"],
  stateVars: ["risk", "load"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 2,
};
const CONFIG_B: SandboxViewConfig = {
  tenantId: "tenant-b",
  nodeTypes: ["Warehouse", "Route", "Shipment", "Carrier"],
  linkTypes: ["routes"],
  stateVars: ["delay"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 1,
};

function wrap(cfg: SandboxViewConfig) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SandboxView injectedConfig={cfg} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("增量4 · <SandboxView> 配置驱动（R14 两行业证）", () => {
  beforeEach(() => tickFn.mockClear());
  afterEach(() => cleanup());

  it("配置A（供应链 3 类对象）：渲染 3 个拓扑节点 + 每个 stateVar 一个 KPI + 就绪认证", async () => {
    wrap(CONFIG_A);
    await screen.findByTestId("sandbox-view");
    // 会话 init 后拓扑节点出现（节点=nodeTypes，逐 nodeType 一个 PmDag 节点）。
    for (const t of CONFIG_A.nodeTypes) {
      await screen.findByTestId(`sandbox-dag-node-${t}`);
    }
    // KPI 行 = 全局 + 每个 stateVar 一个。
    expect(screen.getByTestId("sandbox-kpi-global")).toBeTruthy();
    for (const v of CONFIG_A.stateVars) expect(screen.getByTestId(`sandbox-kpi-${v}`)).toBeTruthy();
    // 就绪认证面板（L0-L4 stepper + canEnter + gaps + 雷达三轴）。
    await waitFor(() => expect(screen.getByTestId("sim-cert-level").textContent).toContain("L2"));
    expect(screen.getByTestId("sim-cert-canenter").textContent).toContain("✗");
    expect(screen.getByTestId("sim-cert-gap-0")).toBeTruthy();
    for (const d of CONFIG_A.radarDims) expect(screen.getByTestId(`sandbox-radar-axis-${d.key}`)).toBeTruthy();
  });

  it("配置B（物流 4 类对象 / 不同 stateVar）：同代码渲染 4 节点 + 对应 KPI（零改动证 R14）", async () => {
    wrap(CONFIG_B);
    await screen.findByTestId("sandbox-view");
    for (const t of CONFIG_B.nodeTypes) {
      await screen.findByTestId(`sandbox-dag-node-${t}`);
    }
    // 配置 A 的实体名在配置 B 下不应存在（证渲染随配置变，非写死）。
    expect(screen.queryByTestId("sandbox-dag-node-Supplier")).toBeNull();
    expect(screen.getByTestId("sandbox-kpi-delay")).toBeTruthy();
    expect(screen.queryByTestId("sandbox-kpi-risk")).toBeNull();
  });

  it("推进 tick：调用 simTick 且全局 KPI 值变化（节点/KPI 随 world 态更新）", async () => {
    const user = userEvent.setup();
    wrap(CONFIG_A);
    await screen.findByTestId("sandbox-view");
    // 等会话 init 完（tick 按钮可用）。
    const btn = await screen.findByTestId("sandbox-tick-btn");
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    const before = screen.getByTestId("sandbox-kpi-global-val").textContent;

    await user.click(btn);
    await waitFor(() => expect(tickFn).toHaveBeenCalledWith("sims_test", 1));
    // tick 后全局态来自新 world（桩返回 {__mut:{v:999}}）→ 值应不同于 init 态。
    await waitFor(() => expect(screen.getByTestId("sandbox-kpi-global-val").textContent).not.toBe(before));
  });
});

// ── 轨A P1 三项：双雷达 / AI 指挥台 / R13 溯源 ──────────────────────────────────────────
import { parseSandboxIntent } from "@/views/sim/SandboxView";

describe("轨A P1 · 健康6维+信任4维 双雷达（DERIVE 自 cert，缺数据诚实标）", () => {
  afterEach(() => cleanup());
  it("渲染健康6轴 + 信任4轴；needed=0 的维诚实标 *（不写死占位）", async () => {
    wrap(CONFIG_A);
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-dual-radar");
    // 健康 6 维 + 信任 4 维轴标都在（来自 deriveHealth/TrustDims，非写死）。
    for (const k of ["ruleCoverage", "utilization", "closure", "cycleSafety", "observability", "activation"]) {
      await screen.findByTestId(`sandbox-health-axis-${k}`);
    }
    for (const k of ["runtime", "explainability", "temporal", "dataTrust"]) {
      expect(screen.getByTestId(`sandbox-trust-axis-${k}`)).toBeTruthy();
    }
    // cert mock: propagationRules.needed=0 → 规则覆盖维诚实标缺数据（轴标带 *）。
    expect(screen.getByTestId("sandbox-health-axis-ruleCoverage").textContent).toContain("*");
    expect(screen.getByTestId("sandbox-health-radar-missing")).toBeTruthy();
  });
});

describe("轨A P1 · AI 指挥台（确定性意图解析 R6，无 LLM）", () => {
  afterEach(() => cleanup());

  it("parseSandboxIntent 纯函数确定性：中文意图 → 动作（同输入同输出）", () => {
    expect(parseSandboxIntent("推进 5 个 tick").kind).toBe("tick");
    expect(parseSandboxIntent("推进 5 个 tick").n).toBe(5);
    expect(parseSandboxIntent("存档检查点").kind).toBe("checkpoint");
    expect(parseSandboxIntent("分支对比").kind).toBe("branch");
    expect(parseSandboxIntent("查询就绪状态").kind).toBe("query");
    expect(parseSandboxIntent("帮我画条龙").kind).toBe("unknown");
    // 确定性：重复解析字节一致。
    expect(parseSandboxIntent("推进 3 tick")).toEqual(parseSandboxIntent("推进 3 tick"));
  });

  it("NL「推进 2 tick」→ 经现有沙盘 API 真推进（simTick 调 2 次）+ 回执", async () => {
    const user = userEvent.setup();
    wrap(CONFIG_A);
    await screen.findByTestId("sandbox-view");
    const input = await screen.findByTestId("sandbox-ai-input");
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    tickFn.mockClear(); // 与首 describe 共用同一 tickFn，本测试前清零（确定性断言 2 次）
    await user.type(input, "推进 2 tick");
    await user.click(screen.getByTestId("sandbox-ai-run"));
    await waitFor(() => expect(tickFn).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("sandbox-ai-echo").textContent).toContain("推进 2");
  });

  it("未识别意图诚实降级（不瞎跑，提示支持指令集）", async () => {
    const user = userEvent.setup();
    wrap(CONFIG_A);
    await screen.findByTestId("sandbox-view");
    const input = await screen.findByTestId("sandbox-ai-input");
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    tickFn.mockClear();
    await user.type(input, "随便写点啥xyz");
    await user.click(screen.getByTestId("sandbox-ai-run"));
    await waitFor(() => expect(screen.getByTestId("sandbox-ai-echo").textContent).toContain("未识别意图"));
    expect(tickFn).not.toHaveBeenCalled(); // 诚实：未识别不触发任何动作
  });
});

describe("G-11 P3 · 传导边标注（×系数·Δ延迟，接真传导规则·零行业常数 R14）", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(fetchSimPropagationRules).mockResolvedValue({ items: [] });
  });

  const rule = (over: Partial<import("@platform/contracts").PropagationRule>): import("@platform/contracts").PropagationRule => ({
    id: "pr", tenantId: "tenant-a", key: "pr_key",
    sourceTypeKey: "Supplier", sourceStateVar: "risk",
    viaLinkKey: "supplies", targetTypeKey: "Factory", targetStateVar: "load",
    coefficient: 0.85, delayTicks: 0, combine: "sum", decay: null, clamp: null,
    coefficientRef: null, status: "PUBLISHED", ...over,
  });

  it("有真规则：边标 ×系数（delayTicks>0 加 ·Δ延迟），系数全来自规则字段（非写死）", async () => {
    vi.mocked(fetchSimPropagationRules).mockResolvedValue({
      items: [
        rule({ id: "p1", sourceTypeKey: "Supplier", targetTypeKey: "Factory", coefficient: 0.85, delayTicks: 0 }),
        rule({ id: "p2", sourceTypeKey: "Factory", targetTypeKey: "Order", coefficient: 0.7, delayTicks: 2 }),
      ],
    });
    wrap(CONFIG_A);
    await screen.findByTestId("sandbox-view");
    const e1 = await screen.findByTestId("sandbox-dag-edge-label-Supplier-Factory");
    expect(e1.textContent).toContain("×0.85");
    expect(e1.textContent).not.toContain("Δ"); // delayTicks=0 不显延迟
    const e2 = await screen.findByTestId("sandbox-dag-edge-label-Factory-Order");
    expect(e2.textContent).toContain("×0.7");
    expect(e2.textContent).toContain("·Δ2"); // delayTicks=2 显延迟
  });

  it("无规则（纯建模态/entitlement 关）：诚实不标 label（不造假占位）", async () => {
    vi.mocked(fetchSimPropagationRules).mockResolvedValue({ items: [] });
    wrap(CONFIG_A);
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-dag-node-Supplier");
    // 兜底相邻边仍在（拓扑可见），但无系数标注。
    expect(screen.queryByTestId("sandbox-dag-edge-label-Supplier-Factory")).toBeNull();
  });
});

describe("轨A P1 · R13 节点溯源悬浮（复用 fetchObjectLineage，沿本体链路）", () => {
  afterEach(() => cleanup());

  it("空世界（无 nodeObjectIds）：点节点诚实标无上游可溯，不裸渲染", async () => {
    const user = userEvent.setup();
    wrap(CONFIG_A);
    await screen.findByTestId("sandbox-view");
    const node = await screen.findByTestId("sandbox-dag-node-Supplier");
    await user.click(node);
    await screen.findByTestId("sandbox-lineage-popover");
    await screen.findByTestId("sandbox-lineage-empty");
  });

  it("有真对象：点节点取代表对象 lineage → 沿链路 数据源→原始表→建模→对象", async () => {
    const user = userEvent.setup();
    const cfgWithObjs: SandboxViewConfig = { ...CONFIG_A, nodeObjectIds: { Supplier: ["obj_supplier_s1"], Factory: [], Order: [] } };
    wrap(cfgWithObjs);
    await screen.findByTestId("sandbox-view");
    const node = await screen.findByTestId("sandbox-dag-node-Supplier");
    await user.click(node);
    await screen.findByTestId("sandbox-lineage-chain");
    expect(screen.getByTestId("sandbox-lineage-source").textContent).toContain("原型导入");
    expect(screen.getByTestId("sandbox-lineage-dataset").textContent).toContain("orders_raw");
    expect(screen.getByTestId("sandbox-lineage-object").textContent).toContain("obj_supplier_s1");
  });
});

// ── SIM-REAL-SNAPSHOT（审计簇D 治本·牙齿测试）：baseSnapshot 取后端真对象属性态，非 hash(oid)。 ──
import { deriveBaseSnapshot } from "@/views/sim/SandboxView";

describe("SIM-REAL-SNAPSHOT · deriveBaseSnapshot 取后端真属性态（非 hash·簇D 红线）", () => {
  const cfg: SandboxViewConfig = {
    ...CONFIG_A,
    stateVars: ["s1", "s2"],
    nodeObjectIds: { Supplier: ["obj_a1", "obj_a2"], Factory: ["obj_b1"], Order: [] },
    // 后端真实对象当前属性态（= obj.props 命中 stateVar 数值）。obj_b1 仅有 s1（s2 后端无真值）。
    nodeObjectState: { obj_a1: { s1: 62, s2: 48 }, obj_a2: { s1: 30, s2: 71 }, obj_b1: { s1: 15 } },
  };

  it("baseSnapshot 逐值 = view-config.nodeObjectState 真值（非 hash 派生）", () => {
    const snap = deriveBaseSnapshot(cfg);
    // 真对象 id 为键 + 值逐一命中后端真属性态。
    expect(snap["obj_a1"]).toEqual({ s1: 62, s2: 48 });
    expect(snap["obj_a2"]).toEqual({ s1: 30, s2: 71 });
    // obj_b1 后端仅 s1 有真值 → s2 诚实退 0（静止），绝不 hash/合成冒充。
    expect(snap["obj_b1"]).toEqual({ s1: 15, s2: 0 });
    // 空世界类型（Order 无对象）退占位键，全 0（诚实空态）。
    expect(snap["Order#0"]).toEqual({ s1: 0, s2: 0 });
  });

  it("牙齿：与旧 hash(oid) 造伪初态语义相斥（真值 ≠ 结构哈希）", () => {
    const snap = deriveBaseSnapshot(cfg);
    // 旧实现：row[v] = round(hash01(`${oid}|${v}`)*100)。复现之，证真值与之不同（非哈希产物）。
    const hash01 = (s: string): number => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return ((h >>> 0) % 1000) / 1000;
    };
    const hashed = Math.round(hash01("obj_a1|s1") * 100);
    // 真值 62（来自 nodeObjectState）必须 ≠ 该 id 的哈希产物 —— 若回退 hash 实现，此断言转红。
    expect(snap["obj_a1"]!.s1).toBe(62);
    expect(snap["obj_a1"]!.s1).not.toBe(hashed);
  });

  it("nodeObjectState 缺省（老配置无该字段）→ 全 0 诚实静止，不 hash 兜底", () => {
    const legacy: SandboxViewConfig = { ...CONFIG_A, stateVars: ["s1"], nodeObjectIds: { Supplier: ["obj_x"], Factory: [], Order: [] } };
    const snap = deriveBaseSnapshot(legacy);
    expect(snap["obj_x"]).toEqual({ s1: 0 });
  });
});

// ── WO-CAP-03-KPI-FIX：KPI 口径 = 携带者真均值（分母=携带者，非全对象稀释）+ 量纲统一 + cert.knowledge 正名。 ──
describe("WO-CAP-03 · KPI 携带者真均值 + 量纲统一（治利用率 2.0 稀释）", () => {
  afterEach(() => cleanup());
  // Line.utilization 百分(92/90) 与 Process.utilization 分数(0.9/1.0) 混存同一 stateVar；另 3 个 Order 对象不携带 utilization。
  const MIXED: SandboxViewConfig = {
    tenantId: "tenant-cap",
    nodeTypes: ["Line", "Process", "Order"],
    linkTypes: ["line_has_process"],
    stateVars: ["utilization"],
    radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
    screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
    propagationCount: 1,
    nodeObjectIds: { Line: ["L1", "L2"], Process: ["P1", "P2"], Order: ["O1", "O2", "O3"] },
    nodeObjectState: { L1: { utilization: 92 }, L2: { utilization: 90 }, P1: { utilization: 0.9 }, P2: { utilization: 1.0 } },
  };

  it("利用率 KPI = 携带者(4)量纲统一后真均值 93.0（非 ÷7 稀释 26.3·非未归一 46.0）", async () => {
    wrap(MIXED);
    await screen.findByTestId("sandbox-view");
    const kpi = await screen.findByTestId("sandbox-kpi-utilization-val");
    // 携带者 4 个：Line[92,90] 百分保留 + Process[0.9,1.0]×100 归一 → [92,90,90,100] 均值 93.0。
    await waitFor(() => expect(kpi.textContent).toBe("93.0"));
    // 反证稀释/未归一（若回退 ÷全对象 或不统一量纲，值会是 26.3 / 46.0 等，断言转红）。
    expect(kpi.textContent).not.toBe("26.3");
    expect(kpi.textContent).not.toBe("46.0");
    expect(kpi.textContent).not.toBe("2.0");
  });

  it("cert.knowledge 正名：健康雷达该维展示「建模完整度」而非误标「利用率」", async () => {
    wrap(MIXED);
    await screen.findByTestId("sandbox-view");
    const axis = await screen.findByTestId("sandbox-health-axis-utilization");
    expect(axis.textContent).toContain("建模完整度");
    expect(axis.textContent).not.toContain("利用率");
  });
});
