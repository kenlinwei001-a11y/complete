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
import {
  buildPareto,
  buildStageBoard,
  chainNodePresence,
  chainStageCoverage,
  transitOverlayBox,
  CHAIN_STAGE_DESIGN_TARGET,
} from "@/views/sim/sandboxConsole";

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
  /**
   * 金值变更（WO-CHAIN-24）：本用例原本断言「后端 4 段 12 节点、**差额 > 0**」，
   * 并在 `expectMissingNodes` 那行留了一句「设计目标与后端注册表若真的齐了，本用例应当被删掉而不是放行」。
   * 现在真的齐了（契约 5 段 24 节点），故按那句话把它**改写成齐了之后该断的东西**，而不是把 `> 0` 松成 `>= 0`：
   *  · 差额恒 0（且仍从契约常数独立算，不拿 `chainStageCoverage` 比对它自己）；
   *  · 新增的第 5 段 `DELIVERY` 必须真的有 lane、且 lane 里真有内容（节点或诚实缺席行）——
   *    只加枚举不落节点 = 屏上多一条永远空的泳道，那是「加了个名字」不是「建了一段模」。
   */
  it("链路阶段：设计目标 5 段 24 节点 == 后端在册 5 段 24 节点（差额归零），且第 5 段真的有内容", async () => {
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
    expect(expectMissingStages, "段数已补齐 ⇒ 差额必须恰为 0（不是 >=0，负数意味着注册表反超设计稿、同样要复核）").toBe(0);
    expect(expectMissingNodes, "节点数已补齐 ⇒ 差额必须恰为 0").toBe(0);
    expect(txt).toContain(`差 ${expectMissingStages} 段 ${expectMissingNodes} 个节点尚未建模`);
    // 派生函数本身也咬一道（它是屏上那句话的唯一出处）
    const cov = chainStageCoverage(buildStageBoard(loadLoss()));
    expect(cov.missingStageCount).toBe(expectMissingStages);
    expect(cov.missingNodeCount).toBe(expectMissingNodes);
    // 段名取 CHAIN_STAGES 派生的显示名（不是前端另抄一份 24 节点词表）
    for (const s of CHAIN_STAGES) expect(screen.getByTestId(`sc-lane-${s}`)).toBeTruthy();
    // 第 5 段：lane 在，且**有内容**（本次载荷里 delivery.* 三个节点都算不出来 ⇒ 走 orphanEmpty 行）。
    const delivery = screen.getByTestId("sc-lane-DELIVERY");
    expect(delivery.textContent ?? "").toContain("交付");
    const deliveryLane = buildStageBoard(loadLoss()).lanes.find((l) => l.stage === "DELIVERY");
    expect(deliveryLane, "buildStageBoard 必须为第 5 段铺一条 lane（段序派生自 CHAIN_STAGES）").toBeTruthy();
    expect(
      deliveryLane!.nodes.length + deliveryLane!.orphanEmpty.length,
      "DELIVERY 段既没有节点也没有诚实缺席行 = 空泳道（加了枚举没建模）",
    ).toBeGreaterThan(0);
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
    /**
     * 诚实位（WO-TRANSIT-GEOMETRY 后**改口径不改强度**）：
     * 旧断言咬的是「本图层未与线路图站点坐标对齐」这句欠账原文；该欠账已还
     * （几何单源 = `chainLineMap.ts`，见 `transit-geometry.seam.test.tsx`），
     * 于是这里改咬**还账后剩下的那半句真话**：几何同源了，但两图的站点 key 宇宙仍不同
     * ⇒ 同角度不代表同一个实体。**不许**因为"看起来对齐了"就把这句删掉。
     */
    const note = within(layer).getByTestId("transit-flow-host-nodes").textContent ?? "";
    expect(note, "几何已与线路图同源这件事必须写在屏上").toContain("与线路图同源");
    expect(note, "剩下的缺口（两图站点 key 不是同一套）不许被抹掉").toContain("同角度不代表同一个实体");
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

// ══════════════════════════════════════════════════════════════════════════════
/**
 * §8 · WO-CHAIN-24 **SEAM 门**：新增节点必须**三处同时在场**。
 *
 * ── 为什么是这三处（而不是各测各的）────────────────────────────────────────────
 * 「12 → 24 节点」是一个**跨三层**的改动：契约注册表（单源）× 引擎求解器（产不产这个节点）×
 * 前端两处消费（检视下拉 / 链路阶段画布）。三层各自单测全绿而链路断开，正是 S0 那次
 * 「D1 与 E1 各发明一套词表、交集为 0」的形态 —— 那次两边也都是绿的。
 * 故本门只认**同一个 nodeId 在三处同时出现**：
 *   ① 引擎载荷 `chain_loss_attribution`（`fixtures/chain-loss-real.json` = 真实响应抓取物）里
 *      要么有节点卡（算得出）、要么有诚实缺席行（算不出）—— **两者都没有 = 幽灵节点**：
 *      注册表里有、屏上永远不出现，等于「加了个 id」而不是「建了一段模」。
 *   ② `InspectorNodePanel` 的节点下拉（它的清单派生自 `CHAIN_NODE_REGISTRY`）。
 *   ③ 链路阶段画布对应 `stage` 的那条 lane 内（节点卡 / 段内 EMPTY 行 / 节点卡上的 EMPTY 计数）。
 *
 * 只测各半不算：单独断言「注册表有 24 条」是同义反复；单独断言「引擎返回 18 个节点」
 * 也证明不了那 18 个就是注册表里的那些。
 */
describe("§8 · WO-CHAIN-24 SEAM：新增节点三处同时在场", () => {
  /** 新增的 12 条 = 注册表末尾 12 条（前 12 条是 S0 冻结原表，「只许末位追加」由 contracts 侧金值咬死）。 */
  const NEW_NODES = CHAIN_NODE_REGISTRY.slice(12);

  it("SEAM：12 个新增节点逐个在 ①引擎载荷 ②检视下拉 ③链路阶段段内 —— 三处任一漏掉即红", async () => {
    expect(NEW_NODES, "新增节点不是 12 条 ⇒ 本门的取样口径已经不对了，先改口径再谈通过").toHaveLength(12);
    const payload = loadLoss();

    // ── ① 引擎载荷（真实响应）：每个新节点必须有节点卡或诚实缺席行 ──────────────
    const inNodes = new Set(payload.nodes.map((n) => n.nodeId));
    const inEmpty = new Set((payload.empty ?? []).map((e) => e.nodeId));
    const ghosts = NEW_NODES.filter((d) => !inNodes.has(d.nodeId) && !inEmpty.has(d.nodeId)).map((d) => d.nodeId);
    expect(ghosts, "这些节点在册但引擎既不产环节也不产 EMPTY 行 = 幽灵节点（注册表加了、没建模）").toEqual([]);

    // 单源自证：引擎给的 label 必须**逐字等于**注册表的 label（漂了就是第二份中文映射表）。
    for (const n of payload.nodes) {
      const def = CHAIN_NODE_REGISTRY.find((d) => d.nodeId === n.nodeId);
      if (def === undefined) continue; // 动态工序节点 `capacity.op.*` 不在静态册内，跳过
      expect(n.label, `节点 ${n.nodeId} 的 label 与注册表漂了：引擎「${n.label}」vs 注册表「${def.label}」`).toBe(def.label);
    }

    // ── ③ 段内（派生层）：lane 由 CHAIN_STAGES 派生，新节点必须落进它自己那段 ────
    const board = buildStageBoard(payload);
    const laneOf = new Map(board.lanes.map((l) => [l.stage, l]));
    for (const def of NEW_NODES) {
      const lane = laneOf.get(def.stage);
      expect(lane, `段 ${def.stage} 没有 lane（buildStageBoard 的段序应派生自 CHAIN_STAGES）`).toBeTruthy();
      const shown =
        lane!.nodes.some((n) => n.nodeId === def.nodeId) ||
        lane!.orphanEmpty.some((e) => e.nodeId === def.nodeId) ||
        lane!.nodes.some((n) => n.emptySteps.some((e) => e.nodeId === def.nodeId));
      expect(shown, `${def.nodeId} 不在 ${def.stage} 段内（既无节点卡、也无段内 EMPTY 行）`).toBe(true);
    }

    // ── 真挂载：②检视下拉 + ③屏上文字（派生层通过 ≠ 屏上看得到）──────────────
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-chain"));
    const boardText = screen.getByTestId("sc-stage-board").textContent ?? "";
    for (const def of NEW_NODES) {
      expect(boardText, `链路阶段画布上找不到「${def.label}」（${def.nodeId}）`).toContain(def.label);
    }

    await user.click(screen.getByTestId("sc-tab-vars"));
    const select = (await screen.findByTestId("node-inspector-select")) as HTMLSelectElement;
    const optionValues = [...select.options].map((o) => o.value);
    expect(optionValues, "检视下拉的清单必须逐条派生自 CHAIN_NODE_REGISTRY（含新增 12 条）").toEqual(
      CHAIN_NODE_REGISTRY.map((n) => n.nodeId),
    );
  });

  it("第 5 段 DELIVERY 端到端在场：契约有段 → 引擎产出带该 stage 的行 → 画布有 lane 且有内容", async () => {
    // ① 契约
    expect(CHAIN_STAGES).toContain("DELIVERY");
    const deliveryDefs = CHAIN_NODE_REGISTRY.filter((n) => n.stage === "DELIVERY");
    expect(deliveryDefs.length, "第 5 段在册 0 个节点 = 只加了个枚举名").toBeGreaterThan(0);

    // ② 引擎：载荷里真有 stage === "DELIVERY" 的行（本次全部是诚实缺席行 —— 算不出来也是一种发现）
    const payload = loadLoss();
    const deliveryRows = [
      ...payload.nodes.filter((n) => n.stage === "DELIVERY").map((n) => n.nodeId),
      ...(payload.empty ?? []).filter((e) => e.stage === "DELIVERY").map((e) => e.nodeId),
    ];
    expect(new Set(deliveryRows), "引擎没有为第 5 段产出全部在册节点的行 ⇒ 段是空的或漏了").toEqual(
      new Set(deliveryDefs.map((d) => d.nodeId)),
    );

    // ③ 画布：lane 在、有内容、且诚实标 EMPTY（不是补 0）
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-chain"));
    const laneText = screen.getByTestId("sc-lane-DELIVERY").textContent ?? "";
    for (const d of deliveryDefs) expect(laneText, `DELIVERY 段没画出「${d.label}」`).toContain(d.label);
    expect(laneText, "算不出来的段必须写明 EMPTY 与未补 0").toContain("未补 0");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
/**
 * §9 · WO-CONSOLE-CLEANUP —— 控制台五笔欠账收口的 SEAM 门。
 *
 * 五条各咬一处**接缝**（不是各半 unit）：
 *  ① 宿主把已取回的载荷传下去 ⇒ 右栏那次自取**当场消失**（数请求次数，不是读代码）。
 *     同时把「传下去会丢什么」钉死：`ChainLossPayloadSchema` 今天 strip 掉 `evidence[]` ——
 *     哪天有人把它补进 schema，这条断言当场红，逼着一起改屏上那段说明（而不是留一句过期的话）。
 *  ② 诚实缺席节点在画布上是**灰卡片**且与有数据卡**形状不同**：
 *     `data-card-shape` 两值互异 + 两者不共用任何 class + CSS 里 `.emptyCard` 真有 `clip-path`
 *     而 `.nodeCard` 没有。只调颜色深浅过不了这道门。
 *  ③ 「在册 ≠ 有数据」三态（算得出 / 只有 EMPTY 行 / 在册不在场）逐个上屏，数字全部派生自载荷；
 *     且**已过期的那句**（扩注册表不在本单边界）必须真的没了。
 *  ④ 在途图层与线路图**在同一块画布容器里**，两张 SVG 的 `viewBox` 逐字符相同（= 同一坐标系），
 *     叠加盒纯函数用**真浏览器量到的数**驱动、逐值对拍；两句常驻诚实位一个字不许少。
 *  ⑤ 阻滞点只能按 stage 联动这条口径差**在屏上**（此前只在源码注释里），段数派生自 `CHAIN_STAGES`。
 */
describe("§9 · WO-CONSOLE-CLEANUP：五笔欠账收口", () => {
  // ── ① 口径单源最后一格：右栏不再自取 ────────────────────────────────────────
  it("① 切到「变量输入」页签后 chain_loss_attribution **仍然只有一次**（右栏那次自取已消失）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    expect(net.calls.filter((c) => c.key === "chain_loss_attribution")).toHaveLength(1);

    await user.click(screen.getByTestId("sc-tab-vars"));
    await screen.findByTestId("node-inspector-root");
    // 面板拿到宿主载荷 ⇒ 一次都不许再发（不传 lossPayload 时这里会变成 2 次）
    expect(
      net.calls.filter((c) => c.key === "chain_loss_attribution"),
      "右栏又自取了一次 chain_loss_attribution ⇒ 同一个问题问了两遍（宿主没把 lossPayload 传下去）",
    ).toHaveLength(1);
    // 面板那句文案必须跟着从「本视图自取一次」翻到「未发第二次请求」
    expect(screen.getByTestId("node-inspector-live-cost").textContent ?? "").toContain("未发第二次请求");
  });

  it("① 代价钉死：宿主那一份被 ChainLossPayloadSchema **剥掉 evidence[]**，且屏上当面说明这件事", () => {
    // 拿**真抓下来的**带证据载荷过一遍前端读取层，证明 strip 是真的发生（不是我猜的）
    const raw = JSON.parse(readFileSync(join(FIX, "chain-loss-live-evidence.json"), "utf8")) as Record<string, unknown>;
    delete raw.__fixture_provenance;
    expect((raw.evidence as unknown[]).length, "取证 fixture 必须真带 evidence，否则本条恒真").toBeGreaterThan(20);
    const parsed = ChainLossPayloadSchema.parse(raw) as Record<string, unknown>;
    expect(
      "evidence" in parsed,
      "ChainLossPayloadSchema 已经声明 evidence[] ⇒ 宿主传下去不再丢证据 ⇒ SandboxConsole 里那段" +
        "「R13 证据在控制台里是空的」说明已经过期，必须一起改（这条断言就是为了逼你改它）",
    ).toBe(false);
    expect("empty" in parsed, "empty[] 是声明过的，必须活着").toBe(true);
  });

  it("① 屏上把这笔代价说清楚（不是悄悄丢一块功能）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-tab-vars"));
    const note = (await screen.findByTestId("sc-inspect-evidence-gap")).textContent ?? "";
    expect(note, "必须点名是宿主这一份缺字段").toContain("evidence");
    expect(note, "必须把「不是引擎没给」说出来 —— 两件事修法完全不同").toContain("不是引擎没给");
    expect(note, "必须给补齐路径").toContain("ChainLossPayloadSchema");
  });

  // ── ② 诚实缺席节点 = 灰卡片，且形状与有数据卡分家 ───────────────────────────
  it("② 每个「只有 EMPTY 行」的在册节点都有一张灰卡片，reason 逐字透传（不是段尾一行小字）", async () => {
    const payload = loadLoss();
    const board = buildStageBoard(payload);
    const emptyCards = board.lanes.flatMap((l) => l.emptyNodes);
    expect(emptyCards.length, "fixture 里应有只带诚实缺席行的节点，否则本条咬不到东西").toBeGreaterThan(5);

    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-chain"));

    for (const c of emptyCards) {
      const card = screen.getByTestId(`sc-empty-node-${c.nodeId}`);
      expect(card.getAttribute("data-card-shape"), `${c.nodeId} 的灰卡片没有形状标识`).toBe("notched-tag");
      const text = card.textContent ?? "";
      expect(text, `灰卡片上没写节点名：${c.nodeId}`).toContain(c.label);
      expect(text, "算不出来这件事必须写在卡上").toContain("EMPTY");
      expect(text, "「未补 0」不许丢").toContain("未补 0");
      for (const r of c.rows) {
        // 缺什么 —— 引擎 reason **原文**，前端一个字都不许改写/概括/截断
        expect(text, `缺席原因原文被改写或吞了：${r.stepId}`).toContain(r.reason);
        expect(text, `emptyKind 没上屏：${r.stepId}`).toContain(r.emptyKind);
      }
    }
    // 三分法在卡上分得开：NO_CARRIER 与 NO_INSTANCE 不许被抹成同一个词
    const kinds = new Set(emptyCards.flatMap((c) => c.kinds));
    expect(kinds.size, "fixture 里应至少有两种 emptyKind").toBeGreaterThan(1);
  });

  it("② 形状分家（不是颜色深浅）：data-card-shape 两值互异 + 不共用 class + CSS 里只有灰卡有 clip-path", async () => {
    const board = buildStageBoard(loadLoss());
    const dataNode = board.lanes.flatMap((l) => l.nodes)[0]!;
    const emptyNode = board.lanes.flatMap((l) => l.emptyNodes)[0]!;

    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-chain"));

    const solid = screen.getByTestId(`sc-node-${dataNode.nodeId}`);
    const notched = screen.getByTestId(`sc-empty-node-${emptyNode.nodeId}`);
    // ① DOM 层：形状标识必须不同
    expect(solid.getAttribute("data-card-shape")).toBe("solid-block");
    expect(
      notched.getAttribute("data-card-shape"),
      "灰卡片与有数据卡用了同一个形状标识 ⇒ 屏上只剩颜色深浅的差别，而深浅会被读成「同一种东西弱一点」",
    ).not.toBe(solid.getAttribute("data-card-shape"));
    // ② class 层：两者不许共用同一个卡片基类（否则形状必然一样，只能靠改色）
    const shared = [...solid.classList].filter((c) => notched.classList.contains(c));
    expect(shared, `两种卡共用了 class ${shared.join(",")} ⇒ 形状同源`).toEqual([]);
    // ③ 几何层：CSS 里灰卡真的切了角，有数据卡没有这条声明（源码级判据，jsdom 不跑 CSS 也咬得住）
    const css = readFileSync(join(REPO_ROOT, "apps/frontend-shell/src/views/sim/SandboxConsole.module.css"), "utf8");
    const block = (sel: string) => {
      const i = css.indexOf(`${sel} {`);
      expect(i, `CSS 里找不到 ${sel}`).toBeGreaterThan(-1);
      return css.slice(i, css.indexOf("}", i));
    };
    expect(block(".emptyCard"), "灰卡片没有 clip-path ⇒ 它跟实心卡是同一个矩形，形状没分家").toContain("clip-path");
    expect(block(".nodeCard"), "有数据卡也被切了角 ⇒ 两者形状又一样了").not.toContain("clip-path");
  });

  it("② 灰卡片可点：点了右栏切到「变量输入」（那里才有缺席证据，逐环节表对它是空表）", async () => {
    const board = buildStageBoard(loadLoss());
    const target = board.lanes.flatMap((l) => l.emptyNodes).find((n) => n.registered)!;
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-chain"));
    await user.click(screen.getByTestId(`sc-empty-node-${target.nodeId}`));
    const select = (await screen.findByTestId("node-inspector-select")) as HTMLSelectElement;
    expect(select.value, "点灰卡片没把右栏切到这个节点").toBe(target.nodeId);
  });

  // ── ③ 在册 ≠ 有数据 ─────────────────────────────────────────────────────────
  it("③ 诚实位改口径不删：差额那句留着，「在册 ≠ 有数据」三态全部上屏且数字派生自载荷", async () => {
    const payload = loadLoss();
    const presence = chainNodePresence(payload);
    // 派生层自证：三态互斥且穷尽（加起来 = 在册总数）
    expect(presence.withSteps.length + presence.emptyOnly.length + presence.absent.length).toBe(presence.registered);
    expect(presence.registered).toBe(CHAIN_NODE_REGISTRY.length);
    expect(presence.emptyOnly.length, "没有只带缺席行的在册节点 ⇒ 本条咬不到东西").toBeGreaterThan(5);
    expect(
      presence.absent.length,
      "没有「在册不在场」的节点 ⇒ 本条咬不到东西（fixture 实测应有 capacity.maint）",
    ).toBeGreaterThan(0);

    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-chain"));
    const txt = (await screen.findByTestId("sc-chain-coverage")).textContent ?? "";

    // 头号判据：这句话必须在（变异反证 ② 删掉它 ⇒ 本条红）
    expect(txt, "「在册 ≠ 有数据」这个区别不许从屏上消失").toContain("在册 ≠ 有数据");
    // 三态的数字全部是载荷的投影（前端零加法：这里从派生函数独立算一遍再比对屏上）
    expect(txt).toContain(`${presence.withSteps.length} 个算得出天数`);
    expect(txt).toContain(`${presence.emptyOnly.length} 个只有诚实缺席行`);
    expect(txt).toContain(`共 ${presence.emptyRowCount} 行`);
    for (const k of presence.emptyRowsByKind) {
      expect(txt, `emptyKind 分布里少了 ${k.kind}`).toContain(`${k.kind} ${k.count}`);
    }
    // 在册不在场：逐个点名（不是只报个数）
    expect(txt).toContain("在册不在场");
    for (const a of presence.absent) expect(txt, `「在册不在场」没点名 ${a.nodeId}`).toContain(a.nodeId);
    // 已过期的那句必须真的没了（差额归零之后它是废话）
    expect(txt, "扩注册表那句已过期，应当改成还账后剩下的真话而不是留着").not.toContain("不在本单边界");
  });

  it("③ 「在册不在场」在它自己那条泳道里单列一行（不是只在诚实位里提一句）", async () => {
    const board = buildStageBoard(loadLoss());
    const lanesWithAbsent = board.lanes.filter((l) => l.absentNodes.length > 0);
    expect(lanesWithAbsent.length, "fixture 里应有带「在册不在场」节点的段").toBeGreaterThan(0);

    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-chain"));
    for (const lane of lanesWithAbsent) {
      const row = screen.getByTestId(`sc-lane-${lane.stage}-absent`);
      const text = row.textContent ?? "";
      for (const a of lane.absentNodes) {
        expect(text, `${a.nodeId} 在册却没在段里单列出来`).toContain(a.label);
        expect(text).toContain(a.nodeId);
      }
      expect(text, "必须把「既没有环节也没有 EMPTY 行」这件事说出来").toContain("EMPTY");
    }
  });

  // ── ④ 在途图层叠在线路图同一块画布上 ────────────────────────────────────────
  it("④ 两张图在**同一个画布容器**里，且两个 SVG 的 viewBox 逐字符相同（= 同一套坐标）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(within(screen.getByTestId("sc-transit-toggle")).getByRole("checkbox"));
    await screen.findByTestId("sc-transit-layer");

    const stack = screen.getByTestId("sc-metro-stack");
    expect(stack.getAttribute("data-transit-overlay"), "图层开着时叠加没有启用").toBe("on");

    // 线路图舞台与在途环**都在这一个容器里**（此前是画布槽下的两个兄弟块）
    const stage = within(stack).getByTestId("clm-stage");
    const rings = stack.querySelectorAll('[data-testid="transit-ring"]');
    expect(rings.length, "叠加层钉的是 transit-ring 这个 testid；它不在同一个容器里 ⇒ CSS 选择器已经落空").toBe(1);
    expect(stage.getAttribute("viewBox")).toBeTruthy();
    expect(
      rings[0]!.getAttribute("viewBox"),
      "两图 viewBox 不同 ⇒ 盒子对齐了坐标也对不上，叠加就是把两张图摞在一起而已",
    ).toBe(stage.getAttribute("viewBox"));

    // 关掉图层 ⇒ 叠加也关掉（不留一层看不见的东西压在画布上）
    await user.click(within(screen.getByTestId("sc-transit-toggle")).getByRole("checkbox"));
    await waitFor(() => expect(screen.queryByTestId("sc-transit-layer")).toBeNull());
    expect(screen.getByTestId("sc-metro-stack").getAttribute("data-transit-overlay")).toBe("off");
  });

  it("④ 叠加盒纯函数：用真浏览器量到的矩形驱动 —— 环 SVG 落在舞台**同一个屏上矩形**并按画布裁切", () => {
    /**
     * 下面几个矩形取自**真浏览器实拍**量到的形态（线路图 1.00× 未平移）：
     * 舞台 SVG 980×680（`clm-stage` = `RING_LAYOUT.viewW/viewH`），画布可视区 703×498（`clm-canvas`），
     * 舞台左上角比画布内缩 1px（画布那圈边框）。于是右侧溢出 (309+980)−(308+703)=278px、
     * 下方溢出 (397+680)−(396+498)=183px，必须裁掉，否则放大时环会糊到画布外面去。
     */
    const stack = { left: 300, top: 200, width: 720, height: 620 };
    const canvas = { left: 308, top: 396, width: 703, height: 498 };
    const stage = { left: 309, top: 397, width: 980, height: 680 };
    const box = transitOverlayBox(stack, stage, canvas);
    expect(box.measured).toBe(true);
    // 逐值：叠加层与舞台**同一个矩形**（差一个像素，环上的站就指不到同一个点）
    expect(box.left).toBe(9);
    expect(box.top).toBe(197);
    expect(box.width).toBe(980);
    expect(box.height).toBe(680);
    // 裁切：只裁画布外面那部分，画布里的一律不裁
    expect(box.clipLeft).toBe(0);
    expect(box.clipTop).toBe(0);
    expect(box.clipRight).toBe(278);
    expect(box.clipBottom).toBe(183);

    // 放大平移后（舞台矩形被浏览器算成变换后的值）依然跟得上：本函数不认识 k/x/y，只认矩形
    const zoomed = { left: 209, top: 297, width: 1470, height: 1020 };
    const z = transitOverlayBox(stack, zoomed, canvas);
    expect(z.left).toBe(-91);
    expect(z.width).toBe(1470);
    expect(z.clipLeft).toBe(99);
    expect(z.clipTop).toBe(99);
    expect(z.clipRight).toBe(668);
    expect(z.clipBottom).toBe(423);

    // 量不到（jsdom / display:none）⇒ 明说没量到，界面据此**不假装已对齐**
    const zero = { left: 0, top: 0, width: 0, height: 0 };
    expect(transitOverlayBox(zero, zero, zero).measured).toBe(false);
  });

  it("④ CSS 里真有那条「钉」的声明，且只在测量到尺寸时生效", () => {
    const css = readFileSync(join(REPO_ROOT, "apps/frontend-shell/src/views/sim/SandboxConsole.module.css"), "utf8");
    const i = css.indexOf('.metroStack[data-transit-overlay="on"][data-overlay-measured="1"] svg[data-testid="transit-ring"]');
    expect(i, "叠加的 CSS 钉钉子没了 ⇒ 两张图又变回上下两块").toBeGreaterThan(-1);
    const rule = css.slice(i, css.indexOf("}", i));
    expect(rule).toContain("position: absolute");
    expect(rule, "叠加盒的四个数必须来自 transitOverlayBox 落下来的 CSS 变量，不许在样式表里写死几何").toContain(
      "var(--sc-ov-left)",
    );
    expect(rule, "溢出必须按画布裁，否则放大时环会糊到整页").toContain("clip-path");
  });

  it("④ 叠上去之后，图层那两句常驻诚实位一个字都没少", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(within(screen.getByTestId("sc-transit-toggle")).getByRole("checkbox"));
    const layer = await screen.findByTestId("sc-transit-layer");
    const note = within(layer).getByTestId("transit-flow-host-nodes").textContent ?? "";
    expect(note, "几何与线路图同源这件事必须写在屏上").toContain("与线路图同源");
    expect(note, "剩下的缺口（两图站点 key 不是同一套）不许因为「看起来叠上了」被抹掉").toContain("同角度不代表同一个实体");
    // 叠加本身也要当面说清楚（含"量不到就不假装"这条）
    const overlayNote = within(layer).getByTestId("sc-transit-overlay-note").textContent ?? "";
    expect(overlayNote).toContain("同一个屏上矩形");
  });

  // ── ⑤ 阻滞点只能按 stage 联动：口径差上屏 ───────────────────────────────────
  it("⑤ 「只能按 stage 联动、不能按节点点亮」这条接缝缺口在屏上，且段数派生自 CHAIN_STAGES", async () => {
    mount();
    await ready();
    const txt = screen.getByTestId("sc-imp-join-gap").textContent ?? "";
    expect(txt, "两个求解器没有共同 id 维度这件事必须说出来").toContain("没有共同的 id 维度");
    expect(txt, "「不能按节点精确点亮」是这条缺口的后果，不许省").toContain("不能按节点精确点亮");
    // 段数是派生的：注册表从 4 段变 5 段那天，这句话跟着变（写死的数当天就过期）
    expect(txt).toContain(`共 ${CHAIN_STAGES.length} 段`);
    expect(CHAIN_STAGES.length, "段数已经是 5，若这里仍是 4 说明 fixture/契约漂了").toBe(5);
  });
});
