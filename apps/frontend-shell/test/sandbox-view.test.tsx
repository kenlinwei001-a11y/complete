import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  fetchWorkspace: vi.fn(),
  fetchSimViewConfig: vi.fn(),
  // WO-SANDBOX-CONSOLE：主屏改成一页控制台后内嵌 F1 线路图 + 阻滞点统计条，两者都走 runSolver。
  // 本文件测的是 R14 两配置证（本体派生），故给形状合法的空扫描；链路损失归因不桩 → 线路图诚实空态。
  runSolver: vi.fn(async (key: string) =>
    key === "chain_impediments"
      ? {
          data: {
            scanId: "scan_test", scope: {}, impediments: [],
            counts: { total: 0, BOTTLENECK: 0, CONGESTION: 0, BREAK: 0 },
            unresolved: [], caveats: [], thresholds: [],
          },
          snapshotVersion: "ov-test",
        }
      : Promise.reject({ error: { code: "NOT_STUBBED", message: "本用例不桩 chain_loss_attribution", requestId: "req_test" } }),
  ),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_test", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, createdAt: "2026-06-25T00:00:00.000Z",
  } satisfies SimSession)),
  simTick: vi.fn(async (sessionId: string, n: number) => {
    tickFn(sessionId, n);
    // 读不到 base 这里直接造一个递增态：由测试通过断言「值变化」验证，不依赖具体数。
    return { curTick: n, state: { __mut: { v: 999 } } };
  }),
  // WO-L4B：SandboxView 现有两条真 useQuery（世界列表 / 世界态）。本文件是全量替换式 vi.mock，
  // 新导出不桩进来就是 undefined → 组件崩。世界态桩回空态：设计上 init 已用 setQueryData 就地写入
  // 且 staleTime:Infinity，正常不该发生重取；万一重取了，KPI 断言会当场变红——这正是我们想要的信号。
  simWorld: vi.fn(async () => ({ tick: 0, state: {} })),
  fetchSimSessions: vi.fn(async () => ({ items: [] })),
  simCheckpoint: vi.fn(async () => ({ id: "cp1", sessionId: "sims_test", tenantId: "t", tick: 1, label: "tick1", createdAt: "x" })),
  simBranch: vi.fn(async () => ({ id: "sims_child", tenantId: "t", baseSnapshot: {}, scope: {}, status: "READY", curTick: 0, parentCheckpointId: "cp1", createdAt: "x" })),
  fetchSimCompare: vi.fn(async () => ({ a: [], b: [] })),
  createActionDraft: vi.fn(async () => ({ draftId: "ad1", status: "PENDING" })),
  fetchSimCertification: vi.fn(async () => ({
    scope: "GLOBAL", targetRef: null, level: "L2_RUNNABLE",
    dims: { structure: 60, knowledge: 40, behavior: 30, composite: 45 },
    l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
    trialTick: { passed: false, derivationNodes: 0, propagationCovered: false, at: null, error: null },
    worldCompleteness: { pct: 55, derivationRules: { present: 1, needed: 2 }, actions: { present: 0, needed: 1 }, propagationRules: { present: 0, needed: 0 }, stateVarKeys: [], entering: [] },
    canEnterSimulation: false,
    gaps: [{ gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" }],
    computedAt: "2026-06-25T00:00:00.000Z",
  })),
}));

// 在 mock 之后 import 组件（确保用到桩）。
import SandboxView from "@/views/sim/SandboxView";

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
      <SandboxView injectedConfig={cfg} />
    </QueryClientProvider>,
  );
}

/**
 * WO-SANDBOX-DECLUTTER · 就绪认证整块已从**常驻右栏**改成**默认折叠的诊断抽屉**
 * （仓主原话：「这些信息都可以删除」——本仓的做法是收纳不是删除）。
 * 折叠时抽屉内部**一个节点都不渲染**，所以要断它里面的东西，必须先真的把抽屉点开。
 * 这一步本身就是「收纳成功」的另一半证据：不点开就找不到 ⇒ 主屏确实不再挂着它。
 */
async function openDiagnostics(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("sc-diag-toggle"));
  await screen.findByTestId("sc-diag-panel");
}

describe("增量4 · <SandboxView> 配置驱动（R14 两行业证）", () => {
  beforeEach(() => tickFn.mockClear());
  afterEach(() => cleanup());

  it("配置A（供应链 3 类对象）：渲染 3 个拓扑节点 + 每个 stateVar 一个 KPI + 就绪认证", async () => {
    const user = userEvent.setup();
    wrap(CONFIG_A);
    await screen.findByTestId("sandbox-view");
    // 会话 init 后拓扑节点出现（节点=nodeTypes，逐 nodeType 一个 PmDag 节点）。
    for (const t of CONFIG_A.nodeTypes) {
      await screen.findByTestId(`sandbox-dag-node-${t}`);
    }
    // KPI 行 = 全局 + 每个 stateVar 一个。
    expect(screen.getByTestId("sandbox-kpi-global")).toBeTruthy();
    for (const v of CONFIG_A.stateVars) expect(screen.getByTestId(`sandbox-kpi-${v}`)).toBeTruthy();
    // WO-UNIT-MEANING：读数曾是裸「62.5」——看不出满分是 100 还是 10。沙盘态是 0–100 指数
    // （deriveBaseSnapshot 的 hash01()*100 与 aggregate 的"均值 0-100"共同界定·前端自有口径），标签须带量程。
    expect(screen.getByTestId("sandbox-kpi-global").textContent ?? "").toContain("0–100 指数");
    for (const v of CONFIG_A.stateVars) {
      expect(screen.getByTestId(`sandbox-kpi-${v}`).textContent ?? "").toContain("0–100 指数");
    }
    // 就绪认证面板（L0-L4 stepper + canEnter + gaps + 雷达三轴）——现在住在诊断抽屉里。
    await openDiagnostics(user);
    await waitFor(() => expect(screen.getByTestId("sim-cert-level").textContent).toContain("L2"));
    // WO-RC-UX-DOOR-TEXT：未认证态显「可试跑（未认证·结论仅供参考）」——标准页 tick 未被 canEnter 门控·非劝退（诚实门）。
    const canenterText = screen.getByTestId("sim-cert-canenter").textContent ?? "";
    expect(canenterText).toContain("可试跑");
    expect(canenterText).not.toContain("暂不可进入");
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
