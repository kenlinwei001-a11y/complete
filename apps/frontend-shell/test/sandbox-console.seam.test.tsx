import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CHAIN_NODE_REGISTRY, CHAIN_STAGES, type SandboxViewConfig } from "@platform/contracts";

/**
 * WO-SANDBOX-CONSOLE · 推演沙盘主屏 = **一页控制台** —— SEAM 门。
 *
 * ── 本文件的头号判据（缺则本单退回）────────────────────────────────────────────
 * **① 口径单源接缝**：`chain_loss_attribution` 全页**只发一次请求**，
 *    画布卡片的节点占比 / 右栏逐环节表 / 底部 Pareto 三处是**同一份响应的三种投影**。
 *    ——「同一份数据在屏上出现三次、还各算各的」正是本仓 #99/#110 那个坑。
 *    咬法：数网络调用次数 + 改载荷里的 `pctOfChainLoss` → 三处**必须同时**跟着变。
 * **② 三处各答一问、不重叠**：画布卡片只出「节点级一个数 + 最大那条环节 + 折叠计数」，
 *    **不出全表**；全表只在右栏。咬法：断言卡片里数不到全部环节名，右栏里数得到。
 * **③ 诚实位不许在重组时弄丢**：复用组件自带的诚实标记（物理拓扑「占位值」横幅 /
 *    节点检视 PLACEHOLDER / 线路图 AND≠OR）在控制台里仍在 DOM；
 *    本页新增的四条诚实位（范围逐消费方 / 时窗无 ARGS / 链路阶段差额 / 卡点口径差）也在。
 * **④ 旧主屏 6 样一个都不许掉**：KPI 行 / tick 控制条 / 就绪认证 / 多场景对比 / AI 指挥台 /
 *    本体 PmDag —— 逐个断言仍可达。
 * **⑤ 四个独立页零回归**：新增的 prop 默认值必须 = 今天的行为（`chrome="full"` 时线路图仍出 h3，
 *    图例不在 `<details>` 里）。
 *
 * ── 载荷来源 ──────────────────────────────────────────────────────────────────
 * `fixtures/chain-loss-real.json` —— 引擎 `chain_loss_attribution` 的**真实返回体**（既有 fixture，
 * 本单不再造第二份）。`fixtures/chain-impediment-baseline.json` —— 引擎 `chain_impediments` 基线
 * （出处见该文件头 `__fixture_provenance`）。
 *
 * R6 确定性：无时钟、无随机；网络全桩。
 */

// ── 网络桩：两个求解器可分别编排；记全部调用以数「发了几次请求」 ───────────────────
const net = vi.hoisted(() => ({
  loss: null as unknown,
  imp: null as unknown,
  lossFail: null as unknown,
  impFail: null as unknown,
  calls: [] as { key: string; args: Record<string, unknown> }[],
}));

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    runSolver: vi.fn(async (key: string, args: Record<string, unknown>) => {
      net.calls.push({ key, args });
      if (key === "chain_loss_attribution") {
        if (net.lossFail !== null) throw net.lossFail;
        return { data: net.loss, snapshotVersion: "sv-test" };
      }
      if (key === "chain_impediments") {
        if (net.impFail !== null) throw net.impFail;
        return { data: net.imp, snapshotVersion: "sv-test" };
      }
      throw new Error(`[sandbox-console.seam] 未编排的求解器：${key}`);
    }),
    createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
      id: "sims_console", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
      curTick: 0, parentCheckpointId: null, createdAt: "2026-06-25T00:00:00.000Z",
    })),
    simTick: vi.fn(async (_id: string, n: number) => ({ curTick: n, state: { x: { v: 77 } } })),
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
    searchObjects: vi.fn(async () => ({ items: [], total: 0 })),
  };
});

import SandboxView from "@/views/sim/SandboxView";
import { ChainLineMapView } from "@/views/sim/ChainLineMapView";
import { ChainLossPayloadSchema, type ChainLossPayload } from "@/views/sim/chainLineMap";
import { ChainImpedimentPayloadSchema, type ChainImpedimentPayload } from "@/views/sim/chainImpediment";
import { buildPareto, buildStageBoard, chainStageCoverage, CHAIN_STAGE_DESIGN_TARGET } from "@/views/sim/sandboxConsole";

// ── 仓根 / fixture ────────────────────────────────────────────────────────────
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = (() => {
  let dir = TEST_DIR;
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error(`[sandbox-console.seam] 找不到仓根（自 ${TEST_DIR} 向上未见 pnpm-workspace.yaml）`);
})();
const FIX = join(REPO_ROOT, "apps/frontend-shell/test/fixtures");

function loadLoss(): ChainLossPayload {
  const raw = JSON.parse(readFileSync(join(FIX, "chain-loss-real.json"), "utf8")) as unknown;
  return ChainLossPayloadSchema.parse(raw);
}
function loadImp(): ChainImpedimentPayload {
  const raw = JSON.parse(readFileSync(join(FIX, "chain-impediment-baseline.json"), "utf8")) as Record<string, unknown>;
  delete raw.__fixture_provenance;
  return ChainImpedimentPayloadSchema.parse(raw);
}

const CFG: SandboxViewConfig = {
  tenantId: "tenant-console",
  nodeTypes: ["Supplier", "Factory", "Order"],
  linkTypes: ["supplies", "produces"],
  stateVars: ["risk", "load"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 2,
};

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

/** 等控制台把两个求解器的载荷都上屏（阻滞点四卡 + Pareto 都出数）。 */
async function ready() {
  await screen.findByTestId("sandbox-console");
  await waitFor(() => expect(screen.getByTestId("sc-pareto")).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId("sc-imp-BREAK-count").textContent).not.toBe("—"));
}

beforeEach(() => {
  net.loss = loadLoss();
  net.imp = loadImp();
  net.lossFail = null;
  net.impFail = null;
  net.calls.length = 0;
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════════
describe("§1 · 口径单源接缝（头号判据）", () => {
  it("① chain_loss_attribution 全页只发一次请求 —— 三处投影共用同一份响应", async () => {
    mount();
    await ready();
    const lossCalls = net.calls.filter((c) => c.key === "chain_loss_attribution");
    expect(lossCalls).toHaveLength(1);
    // 而且它是**线路图**发的（控制台自己只发阻滞点那一条）——发第二次就说明宿主自己又取了一遍。
    expect(net.calls.filter((c) => c.key === "chain_impediments")).toHaveLength(1);
  });

  it("② 改载荷里某环节的 pctOfChainLoss → 画布卡片 / 右栏表 / 底部 Pareto **三处同时**跟着变", async () => {
    const base = loadLoss();
    // 挑「占全链损失最大」的那条环节，把它的 pct 改成一个一眼能认出来的数。
    const top = [...base.attribution].sort((a, b) => b.pctOfChainLoss - a.pctOfChainLoss)[0]!;
    const MARK = 42.4242;
    net.loss = {
      ...base,
      attribution: base.attribution.map((a) => (a.stepId === top.stepId ? { ...a, pctOfChainLoss: MARK } : a)),
    };
    const nodeId = base.nodes.find((n) => n.steps.some((s) => s.stepId === top.stepId))!.nodeId;

    const user = userEvent.setup();
    mount();
    await ready();

    // (a) 底部 Pareto：那根柱子的读数
    expect(screen.getByTestId(`sc-pareto-${top.stepId}`).textContent ?? "").toContain("42.4%");
    // (b) 画布卡片：切到链路阶段模式，节点级读数 = 该节点各环节 pct 之和（含被改的那条）
    await user.click(screen.getByTestId("sc-mode-chain"));
    const card = await screen.findByTestId(`sc-node-${nodeId}`);
    expect(card.textContent ?? "").toContain("42.4");
    // (c) 右栏逐环节表：同一条环节的影响率
    await user.click(card);
    const row = await screen.findByTestId(`sc-step-${top.stepId}`);
    expect(row.textContent ?? "").toContain("42.4%");
  });

  it("③ Pareto 行序 = 引擎 pctOfChainLoss 降序（前端不自排一套，也不自定分母）", async () => {
    const payload = loadLoss();
    const expected = buildPareto(payload).rows.map((r) => r.stepId);
    mount();
    await ready();
    const bars = within(screen.getByTestId("sc-pareto")).getAllByRole("button");
    const shown = bars.map((b) => (b.getAttribute("data-testid") ?? "").replace(/^sc-pareto-/, ""));
    expect(shown).toEqual(expected);
    // 分母来自引擎：守恒说明里那个 Σ 必须是载荷里的 conservation.sumPct，不是前端加出来的。
    expect(screen.getByTestId("sc-pareto-note").textContent ?? "").toContain(payload.conservation!.sumPct.toFixed(3));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§2 · 三处各答一问，不重叠（仓主的设计修正）", () => {
  it("画布卡片只出「节点级一个数 + 最大那条环节 + 折叠计数」，**不出全表**；全表只在右栏", async () => {
    const payload = loadLoss();
    const board = buildStageBoard(payload);
    // 找一个环节数 ≥ 2 的节点（有东西可折叠才谈得上"不出全表"）。
    const multi = board.lanes.flatMap((l) => l.nodes).find((n) => n.steps.length >= 2);
    expect(multi, "fixture 里应有环节数 ≥2 的节点，否则本用例咬不到东西").toBeTruthy();

    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-chain"));
    const card = await screen.findByTestId(`sc-node-${multi!.nodeId}`);
    const cardText = card.textContent ?? "";

    // 卡片里出现的是最大那条 + 「其余 N 项」，不是每条环节都列出来
    expect(cardText).toContain(multi!.topStep!.label);
    expect(cardText).toContain(`其余 ${multi!.collapsedCount} 项`);
    const otherLabels = multi!.steps.filter((s) => s.stepId !== multi!.topStep!.stepId).map((s) => s.label);
    for (const lbl of otherLabels) expect(cardText, `卡片不该展开「${lbl}」——那是右栏的活`).not.toContain(lbl);

    // 右栏才是全表：每条环节都有一行
    await user.click(card);
    const table = await screen.findByTestId("sc-step-table");
    for (const s of multi!.steps) expect(within(table).getByTestId(`sc-step-${s.stepId}`)).toBeTruthy();
  });

  it("增值段影响率显示「—」而非 0（作业段不进损失分母）", async () => {
    const payload = loadLoss();
    const board = buildStageBoard(payload);
    const withWork = board.lanes.flatMap((l) => l.nodes).find((n) => n.steps.some((s) => s.valueAdd));
    expect(withWork, "fixture 里应有含增值段的节点").toBeTruthy();
    const workStep = withWork!.steps.find((s) => s.valueAdd)!;

    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-chain"));
    await user.click(await screen.findByTestId(`sc-node-${withWork!.nodeId}`));
    const row = await screen.findByTestId(`sc-step-${workStep.stepId}`);
    expect(row.getAttribute("data-value-add")).toBe("1");
    expect(row.textContent ?? "").toContain("—");
    expect(row.textContent ?? "").not.toContain("0.0%");
  });

  it("点底部 Pareto 的柱子 → 右栏切到该柱所属节点（Pareto 是入口，明细仍只在右栏）", async () => {
    const payload = loadLoss();
    const top = buildPareto(payload).rows[0]!;
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId(`sc-pareto-${top.stepId}`));
    await waitFor(() => expect(screen.getByTestId("sc-step-detail").getAttribute("data-node-id")).toBe(top.nodeId));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§3 · 阻滞点统计条 = 引擎 counts（不是前端自己数 items）", () => {
  it("四张卡的数字逐个等于 counts；改 counts → 界面跟着变", async () => {
    const imp = loadImp();
    mount();
    await ready();
    expect(screen.getByTestId("sc-imp-BOTTLENECK-count").textContent).toBe(String(imp.counts.BOTTLENECK));
    expect(screen.getByTestId("sc-imp-CONGESTION-count").textContent).toBe(String(imp.counts.CONGESTION));
    expect(screen.getByTestId("sc-imp-BREAK-count").textContent).toBe(String(imp.counts.BREAK));

    cleanup();
    net.imp = { ...imp, counts: { ...imp.counts, BREAK: imp.counts.BREAK + 7 } };
    mount();
    await ready();
    expect(screen.getByTestId("sc-imp-BREAK-count").textContent).toBe(String(imp.counts.BREAK + 7));
  });

  it("扫描失败 → 四卡显「—」而**不是 0**（0 条阻滞点与扫不出来是两回事）", async () => {
    net.impFail = { error: { code: "FEATURE_NOT_FOUND", message: "not found", requestId: "req_x" } };
    mount();
    await screen.findByTestId("sandbox-console");
    await screen.findByTestId("sc-imp-error");
    expect(screen.getByTestId("sc-imp-BOTTLENECK-count").textContent).toBe("—");
    expect(screen.getByTestId("sc-imp-CONGESTION-count").textContent).toBe("—");
    expect(screen.getByTestId("sc-imp-BREAK-count").textContent).toBe("—");
    expect(screen.getByTestId("sc-imp-error-code").textContent).toBe("FEATURE_NOT_FOUND");
  });

  it("「卡点」按**引擎口径**显示 —— 设计稿那句「规则/审批闸」不许盖过 BOTTLENECK 的真判据", async () => {
    mount();
    await ready();
    // 卡片副标题 = chainImpediment.ts 的 IMPEDIMENT_KIND_MEANING（PRD §5.1 单源），不是设计稿措辞
    expect(screen.getByTestId("sc-imp-BOTTLENECK").textContent ?? "").toContain("加产能有用");
    // 且屏上必须明说这条口径差
    const gap = screen.getByTestId("sc-imp-gap").textContent ?? "";
    expect(gap).toContain("产能/利用率打满");
    expect(gap).toContain("没有一条判「等审批");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§4 · 诚实位（本页新增的四条）", () => {
  it("链路阶段：设计目标 5 段 24 节点 vs 后端 4 段 12 节点，差额明写 —— 不冒充也不手抄词表", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-chain"));
    const txt = (await screen.findByTestId("sc-chain-coverage")).textContent ?? "";
    expect(txt).toContain(`${CHAIN_STAGE_DESIGN_TARGET.stageCount} 段 ${CHAIN_STAGE_DESIGN_TARGET.nodeCount} 节点`);
    expect(txt).toContain(`${CHAIN_STAGES.length} 段`);
    expect(txt).toContain(`${CHAIN_NODE_REGISTRY.length} 个静态在册节点`);
    // ⚠ 差额**不许**从 `chainStageCoverage` 自己算出来再拿去比对自己（那是同义反复，
    //   实测：把 missingNodeCount 直接改成 0 也不会红）。这里从**契约常数**独立算一遍。
    const expectMissingStages = CHAIN_STAGE_DESIGN_TARGET.stageCount - CHAIN_STAGES.length;
    const expectMissingNodes = CHAIN_STAGE_DESIGN_TARGET.nodeCount - CHAIN_NODE_REGISTRY.length;
    expect(expectMissingNodes, "设计目标与后端注册表若真的齐了，本用例应当被删掉而不是放行").toBeGreaterThan(0);
    expect(txt).toContain(`差 ${expectMissingStages} 段 ${expectMissingNodes} 个节点尚未建模`);
    // 派生函数本身也咬一道（它是屏上那句话的唯一出处）
    const cov = chainStageCoverage(buildStageBoard(loadLoss()));
    expect(cov.missingStageCount).toBe(expectMissingStages);
    expect(cov.missingNodeCount).toBe(expectMissingNodes);
    // 段名取 CHAIN_STAGES 派生的显示名（不是前端另抄一份 24 节点词表）
    for (const s of CHAIN_STAGES) expect(screen.getByTestId(`sc-lane-${s}`)).toBeTruthy();
  });

  it("时窗 30/60/90D 无 ARGS → 控件禁用 + 徽标（不给用户一个假旋钮）", async () => {
    mount();
    await ready();
    for (const w of ["30D", "60D", "90D"]) {
      expect((screen.getByTestId(`sc-window-${w}`) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByTestId("sc-window-badge").textContent).toContain("无 ARGS");
  });

  it("范围三维**逐消费方**标接线：基地可勾且真进 args.scope；业务线/产品 无 ARGS 且不可勾", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    expect(screen.getByTestId("sc-dim-businessTypes-badge").textContent).toContain("无 ARGS");
    expect(screen.getByTestId("sc-dim-modelIds-badge").textContent).toContain("无 ARGS");
    expect(screen.getByTestId("sc-dim-baseIds-badge").textContent).toContain("已接线");
    // 另两维只出说明、不出勾选框
    expect(screen.getByTestId("sc-dim-businessTypes-note").textContent ?? "").toContain("400");

    // 勾基地 → chain_impediments 真带 scope.baseIds（这就是"已接线"的证据）
    const before = net.calls.filter((c) => c.key === "chain_impediments").length;
    await user.click(screen.getByTestId("sc-base-changzhou"));
    await waitFor(() => expect(net.calls.filter((c) => c.key === "chain_impediments").length).toBeGreaterThan(before));
    const last = [...net.calls].reverse().find((c) => c.key === "chain_impediments")!;
    expect((last.args.scope as { baseIds?: string[] }).baseIds).toBeTruthy();

    // 而 chain_loss_attribution **不随范围重取**（实测它不吃任何范围维度，屏上也这么写）
    expect(screen.getByTestId("sc-scope-reach").textContent ?? "").toContain("不吃任何范围维度");
  });

  it("复用组件自带的诚实标记一个没丢：物理拓扑占位横幅 / 节点检视 PLACEHOLDER / 线路图 AND≠OR", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    // 线路图（默认模式）：AND≠OR 警示仍在 DOM（嵌入态收进 details，但没删）
    expect(screen.getByTestId("clm-and-or-warning")).toBeTruthy();
    expect(screen.getByTestId("clm-legend-collapsed")).toBeTruthy();
    // 物理拓扑：占位值横幅
    await user.click(screen.getByTestId("sc-mode-topo"));
    const banner = await screen.findByTestId("phys-topo-placeholder-banner");
    expect(banner.textContent ?? "").toContain("占位值");
    // 节点检视：右栏「变量输入 · 占位」页签下的面板仍带「段耗时为占位值·不是实测」诚实位
    await user.click(screen.getByTestId("sc-tab-vars"));
    const inspector = await screen.findByTestId("node-inspector-root");
    expect(inspector.textContent ?? "").toContain("段耗时为占位值（未接真实数据）");
    expect(inspector.textContent ?? "").toContain("不是实测");
  });

  it("右栏节点检视是**受控**的：画布选中的节点即检视的节点（不是两个各选各的）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    // 选一个既在引擎载荷里、又在 CHAIN_NODE_REGISTRY 里的节点（受控 prop 只认在册 id）
    const board = buildStageBoard(loadLoss());
    const inRegistry = board.lanes
      .flatMap((l) => l.nodes)
      .find((n) => CHAIN_NODE_REGISTRY.some((r) => r.nodeId === n.nodeId) && n.nodeId !== "order.cash");
    expect(inRegistry, "fixture 应含至少两个在册节点").toBeTruthy();

    await user.click(screen.getByTestId("sc-mode-chain"));
    await user.click(await screen.findByTestId(`sc-node-${inRegistry!.nodeId}`));
    await user.click(screen.getByTestId("sc-tab-vars"));
    const select = (await screen.findByTestId("node-inspector-select")) as HTMLSelectElement;
    expect(select.value).toBe(inRegistry!.nodeId);
  });

  it("链路阶段的 EMPTY 环节如实列出（算不出来 ≠ 0）", async () => {
    const payload = loadLoss();
    expect((payload.empty ?? []).length, "fixture 应含诚实缺席行").toBeGreaterThan(0);
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-chain"));
    const board = screen.getByTestId("sc-stage-board");
    expect(board.textContent ?? "").toContain("EMPTY");
    expect(board.textContent ?? "").toContain("未补 0");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§5 · 旧主屏 6 样一个都不许掉", () => {
  it("KPI 行 / tick 控制条四个按钮 / 时间轴 / 就绪认证 / 多场景对比 / AI 指挥台 / 本体 PmDag 全部可达", async () => {
    mount();
    await ready();
    // ① KPI 行（全局 + 逐 stateVar）
    expect(screen.getByTestId("sandbox-kpi-global").textContent ?? "").toContain("0–100 指数");
    for (const v of CFG.stateVars) expect(screen.getByTestId(`sandbox-kpi-${v}`)).toBeTruthy();
    // ② tick 控制条
    for (const t of ["sandbox-tick-btn", "sandbox-checkpoint-btn", "sandbox-branch-btn", "sandbox-adopt-btn", "sandbox-timeline"]) {
      expect(screen.getByTestId(t), `控制条少了 ${t}`).toBeTruthy();
    }
    // ③ 就绪认证（右栏可折叠区，默认展开）
    await waitFor(() => expect(screen.getByTestId("sim-cert-level").textContent).toContain("L2"));
    for (const d of CFG.radarDims) expect(screen.getByTestId(`sandbox-radar-axis-${d.key}`)).toBeTruthy();
    // ④ 多场景对比（未分支时给的是空态说明，不是消失）
    expect(screen.getByTestId("sc-rail-compare")).toBeTruthy();
    expect(screen.getByTestId("sandbox-compare-idle")).toBeTruthy();
    // ⑤ AI 指挥台（sim.commander 关时组件返回 null —— 折叠区壳仍在，这是 R3 暗发的正确形态）
    expect(screen.getByTestId("sc-rail-commander")).toBeTruthy();
    // ⑥ 本体 PmDag = 画布第四模式
    for (const t of CFG.nodeTypes) expect(screen.getByTestId(`sandbox-dag-node-${t}`)).toBeTruthy();
  });

  it("本体拓扑节点框宽度**恒为正**（既有缺陷：本体 94 类对象时 g−14 变负 ⇒ 框静默消失）", async () => {
    // demo 租户实测 94 个已发布对象类型；这里直接喂 94 个，复现 1280/95 − 14 = −0.526 那一档。
    const many: SandboxViewConfig = { ...CFG, nodeTypes: Array.from({ length: 94 }, (_, i) => `T${i}`) };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SandboxView injectedConfig={many} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("sandbox-console");
    await waitFor(() => expect(screen.getByTestId("sandbox-dag-node-T0")).toBeTruthy());
    const rects = document.querySelectorAll('[data-testid="sandbox-dag"] rect');
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      const w = Number(r.getAttribute("width"));
      expect(w, `节点框宽度 ${w} ≤ 0 ⇒ 浏览器报 "A negative value is not valid" 并整块不画`).toBeGreaterThan(0);
    }
  });

  it("推进 tick 仍真调 simTick 且 KPI 变（控制台只是换了摆放，不是换了行为）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const btn = screen.getByTestId("sandbox-tick-btn") as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    const before = screen.getByTestId("sandbox-kpi-global-val").textContent;
    await user.click(btn);
    await waitFor(() => expect(screen.getByTestId("sandbox-kpi-global-val").textContent).not.toBe(before));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§6 · 一块画布多模式（不是多个页）", () => {
  it("四个模式切同一块画布槽；切过的模式不卸载（不重取数、不丢态）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    // 起手只有线路图槽有内容
    expect(screen.getByTestId("sc-slot-metro").hasAttribute("hidden")).toBe(false);
    expect(screen.getByTestId("sc-slot-topo").hasAttribute("hidden")).toBe(true);

    await user.click(screen.getByTestId("sc-mode-topo"));
    expect(screen.getByTestId("sc-slot-topo").hasAttribute("hidden")).toBe(false);
    expect(screen.getByTestId("sc-slot-metro").hasAttribute("hidden")).toBe(true);
    // 线路图**仍在 DOM**（只是隐藏）——切回来不该重发请求
    const lossCallsAfterSwitch = net.calls.filter((c) => c.key === "chain_loss_attribution").length;
    await user.click(screen.getByTestId("sc-mode-metro"));
    expect(net.calls.filter((c) => c.key === "chain_loss_attribution")).toHaveLength(lossCallsAfterSwitch);
    expect(screen.getByTestId("clm-root")).toBeTruthy();
  });

  it("在途批次是线路图上的**图层**（开关在画布工具条），不是一个平级页", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    expect(screen.queryByTestId("sc-transit-layer")).toBeNull();
    await user.click(within(screen.getByTestId("sc-transit-toggle")).getByRole("checkbox"));
    const layer = await screen.findByTestId("sc-transit-layer");
    expect(within(layer).getByTestId("transit-flow-root")).toBeTruthy();
    // 诚实位：本图层未与线路图站点坐标对齐，屏上明写
    expect(within(layer).getByTestId("transit-flow-host-nodes").textContent ?? "").toContain("未与线路图站点坐标对齐");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§7 · 四个独立页零回归（新 prop 默认值 = 今天的行为）", () => {
  it("ChainLineMapView 不传 chrome 时仍出 h3 标题、图例**不在** details 里", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChainLineMapView />
      </QueryClientProvider>,
    );
    await screen.findByTestId("clm-legend");
    expect(screen.getByTestId("clm-root").getAttribute("data-chrome")).toBe("full");
    expect(screen.queryByTestId("clm-legend-collapsed")).toBeNull();
    expect(screen.getByText("全链线路图 · 环节损失归因")).toBeTruthy();
  });

  it("不传 onPayload 时取数路径一字不变（仍只发一次、仍正常上屏）", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChainLineMapView />
      </QueryClientProvider>,
    );
    await screen.findByTestId("clm-summary");
    expect(net.calls.filter((c) => c.key === "chain_loss_attribution")).toHaveLength(1);
  });
});
