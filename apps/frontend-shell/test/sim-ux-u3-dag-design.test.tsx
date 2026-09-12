import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-U3-DAG-DESIGN · 判据 **U3**（过程图 + 点节点看凭什么）两张**样板页**的接线测试。
 *
 * 判据原文（`docs/PRD-harness-ux-adoption.md` §2 U3）：
 *   「页内有推演过程图，**且**节点点击真接到一个面板，面板里同时有 **来源** 与 **规则**」
 *
 * 这两页此前属「连图都没有」那 6 页（`docs/DESIGN-u2u3-structure.md` §2 逐页裁决）。
 * 与上一张单（`risk`/`plan-generate`，图已有、只差挂载点）不同：**这两页的图是本单造的**。
 *
 * ⚠ 本文件咬的**不是**「图渲染出来了」。判据的牙有三颗，逐条对应下面的分组：
 *  ① **点节点能看到它凭什么** —— 面板里同时有来源与规则，且规则是**该节点自己的**
 *     （不是一句放之四海皆准的套话）：C1/C2/C3/C6。
 *  ② **规则性质分档诚实** —— `rule.params` 档才是规则库里查得到的键，`trigger.default`
 *     是引擎兜底。混成一个字会把用户支去规则库找一个不存在的键：C3。
 *  ③ **这一页凭什么该画图而不是画步骤条** —— 必须能断言**分叉与汇合真的存在**，
 *     否则「造了个图」只是装饰：C4（decision-play 的 1→N→子集）、C5（optimize-whatif
 *     的两次独立求解），且 C5 同时咬「步骤条把并列层压成一格时**明说自己损失了什么**」。
 */

// ── decision-play 引擎态（与 `decision-play.test.tsx` 同源形状；此处只咬 U3 要的那几样）──
type Dims = { closesGap: number; cost: number; cycleDays: number; risk: number; exposure: number; reversibility: number };
type Opt = { optionId: string; factorId: string; label: string; sourceKind: "solver" | "agent" } & Dims & {
  provenance: { kind: string; basis: string; drillType: string; drillId: string; drillValue: number };
};

const OPTIONS: Opt[] = [
  { optionId: "opt-backup-cert", factorId: "cf-upstream-cut", label: "缩短备份供应商认证周期", sourceKind: "solver",
    closesGap: 3.2, cost: 248, cycleDays: 112, risk: 0.25, exposure: 0.23, reversibility: 0.8,
    provenance: { kind: "求解器", basis: "BackupSupplierPool.certWeeks", drillType: "BackupSupplierPool", drillId: "pool-cathode", drillValue: 16 } },
  { optionId: "opt-lta-clause", factorId: "cf-upstream-cut", label: "长协加价格联动条款", sourceKind: "agent",
    closesGap: 4.1, cost: 90, cycleDays: 30, risk: 0.2, exposure: 0.075, reversibility: 0.9,
    provenance: { kind: "策略推理", basis: "LongTermAgreement.priceLinked", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillValue: 0 } },
  { optionId: "opt-insource", factorId: "cf-upstream-cut", label: "上游自采矿+战略储备", sourceKind: "agent",
    closesGap: 5.5, cost: 1160, cycleDays: 180, risk: 0.55, exposure: 0.05, reversibility: 0.2,
    provenance: { kind: "策略推理", basis: "正极供应缺口(LTA 约定−实际交付)", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillValue: 600 } },
];

const DP = {
  rootCause: { factorId: "cf-upstream-cut", label: "上游减供", metricKey: "seg_attain_ess", gap: 27.8, unit: "%" },
  options: OPTIONS,
  matrix: OPTIONS.map((o) => ({
    optionId: o.optionId, label: o.label,
    dims: { closesGap: o.closesGap, cost: o.cost, cycleDays: o.cycleDays, risk: o.risk, exposure: o.exposure, reversibility: o.reversibility },
  })),
  triggers: [
    // 阈值取自**规则参数** ⇒ 规则库里查得到 ⇒ `ruleKey` 档（本页唯一的那一档）。
    { triggerId: "trig-lta-reprice", signalRef: "li_carbonate_price", signalValue: 96000, op: ">", threshold: 90000, fired: true, action: "长协重定价谈判", thresholdSource: "rule.params" },
    // 引擎内置兜底阈值 ⇒ 规则库里**没有**这个键 ⇒ `projection` 档。
    { triggerId: "trig-backup-cert", signalRef: "licarb_pct_cum", signalValue: 14.29, op: ">", threshold: 12, fired: true, action: "启动备份供应商认证", thresholdSource: "trigger.default" },
  ],
  recommendedPlan: {
    planId: "plan-cf-upstream-cut",
    // 3 个候选里只有 2 个进组合 —— C4 靠这个差集断言「汇合是真的、不是全连」。
    optionIds: ["opt-lta-clause", "opt-backup-cert"],
    steps: [
      { phase: "即刻", action: "长协加价格联动条款", optionRef: "opt-lta-clause" },
      { phase: "本季", action: "缩短备份供应商认证周期", optionRef: "opt-backup-cert" },
    ],
    totalClosesGap: 6.1, totalCost: 338,
  },
  sandboxNarrowing: { beforeGap: 27.8, afterGap: 21.7, narrowedPct: 21.94, ticks: 0 },
  summary: "根因「上游减供」→ 3 方案比对·推荐组合 2 项补 6.1%",
};

async function openDecisionPlayGraph(): Promise<void> {
  loginAs("planner");
  server.use(http.post("*/a/v1/solvers/decision_play/invoke", () => HttpResponse.json({ data: DP, snapshotVersion: "ov-dp" })));
  renderApp("/v/decision-play");
  await screen.findByTestId("dp-process-graph");
}

/** 点一个节点 → 返回面板。**先断言点之前面板不在**（否则「面板一直在」也会让断言通过）。 */
async function clickNode(nodeTestId: string): Promise<HTMLElement> {
  expect(screen.queryByTestId("dag-node-inspector")).toBeNull();
  fireEvent.click(screen.getByTestId(nodeTestId));
  return screen.findByTestId("dag-node-inspector");
}

describe("WO-U3-DAG-DESIGN · decision-play：推演过程图点节点 → 面板带来源+规则", () => {
  it("U3D-C1 · 点根因环 → 来源（gap_attribution + 它读的字段）与规则（分摊口径）同时在", async () => {
    await openDecisionPlayGraph();
    const panel = await clickNode("dp-dag-node-root");

    // 来源 = 求解器 + 它读的字段：只写求解器名，用户仍不知道该看哪个字段；只写字段名，不知道谁算的。
    const src = within(panel).getByTestId("dag-node-inspector-src");
    expect(src).toHaveTextContent("gap_attribution");
    expect(src).toHaveTextContent("rootCause.factorId");
    // 规则 = 这一环的判定口径（不是套话）。
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("缺口沿本体反向逐层分摊");
    expect(within(panel).getByTestId("dag-node-inspector-rule")).toHaveAttribute("data-rule-kind", "projection");
  });

  it("U3D-C2 · 点候选方案环 → 规则是**引擎给的依据原文**（逐字，前端不改写），且逐环各不相同", async () => {
    await openDecisionPlayGraph();

    // 方案 A：引擎 provenance = 求解器 · BackupSupplierPool.certWeeks
    let panel = await clickNode("dp-dag-node-opt:opt-backup-cert");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("BackupSupplierPool.certWeeks");
    // 下钻三元组也在（定位到「哪个对象的哪个字段等于多少」）。
    expect(within(panel).getByTestId("dag-node-inspector-inputs")).toHaveTextContent("BackupSupplierPool[pool-cathode] = 16");
    fireEvent.keyDown(document, { key: "Escape" });

    // 方案 B：**另一条依据** —— 证明规则是「该节点的」，不是一句盖全页的套话。
    panel = await clickNode("dp-dag-node-opt:opt-lta-clause");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("LongTermAgreement.priceLinked");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).not.toHaveTextContent("BackupSupplierPool.certWeeks");
  });

  it("U3D-C3 · 触发环规则性质**分两档**：rule.params ⇒ 规则键 · trigger.default ⇒ 确定性投影", async () => {
    await openDecisionPlayGraph();

    // 阈值取自规则参数 ⇒ 规则库里查得到 ⇒ ruleKey 档 + 屏上徽章写「规则键」。
    let panel = await clickNode("dp-dag-node-trig:trig-lta-reprice");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("li_carbonate_price > 90000");
    expect(within(panel).getByTestId("dag-node-inspector-rule")).toHaveAttribute("data-rule-kind", "ruleKey");
    expect(within(panel).getByTestId("dag-node-inspector-rule-kind")).toHaveTextContent("规则键");
    fireEvent.keyDown(document, { key: "Escape" });

    // 引擎内置兜底 ⇒ 不是规则库的键 ⇒ projection 档，且诚实位明说「要改得先落成规则参数」。
    panel = await clickNode("dp-dag-node-trig:trig-backup-cert");
    expect(within(panel).getByTestId("dag-node-inspector-rule")).toHaveAttribute("data-rule-kind", "projection");
    expect(within(panel).getByTestId("dag-node-inspector-note")).toHaveTextContent("规则库里没有这个键");
  });

  it("U3D-C4 · 图上**分叉与汇合是真的**：1 根因 → 3 候选 → 只有进组合的 2 个连去推荐（这才是必须画图的理由）", async () => {
    await openDecisionPlayGraph();
    const dag = screen.getByTestId("dp-dag");

    // 分叉：候选层（layer 2）真有 3 个节点。
    const optNodes = dag.querySelectorAll('[data-testid^="dp-dag-node-opt:"]');
    expect(optNodes).toHaveLength(3);
    for (const n of optNodes) expect(n).toHaveAttribute("data-layer", "2");

    // 汇合是**子集**不是全连：没进组合的那个在图上降级为 dim（屏上分得出来），进了的不 dim。
    expect(screen.getByTestId("dp-dag-node-opt:opt-insource")).toHaveAttribute("data-state", "dim");
    expect(screen.getByTestId("dp-dag-node-opt:opt-lta-clause")).toHaveAttribute("data-state", "normal");
    expect(screen.getByTestId("dp-dag-node-opt:opt-backup-cert")).toHaveAttribute("data-state", "normal");

    // 推荐组合环自己说得出「合计是怎么来的」。
    const panel = await clickNode("dp-dag-node-plan");
    expect(within(panel).getByTestId("dag-node-inspector-formula")).toHaveTextContent("Σ 组内方案 closesGap");
  });
});

describe("WO-U3-DAG-DESIGN · optimize-whatif：并列的两次求解，步骤条压成一格、图上分得开", () => {
  async function openOptimizeWhatifGraph(): Promise<void> {
    loginAs("planner");
    renderApp("/v/optimize-whatif");
    // WO-U4B-U1-U8 · 判据 U1：`ow-solve` 提交闸已撤，改任一入参即重算 ⇒ 这里不再点任何按钮。
    await screen.findByTestId("ow-process-graph", {}, { timeout: 8000 });
  }

  it("U3D-C5 · 两次求解是**两个并列节点**，规则各不相同（基线 vs 扰动后各解一次）", async () => {
    await openOptimizeWhatifGraph();

    // 同一层（layer 1）两个节点 —— 这就是步骤条压不进一格的那件事。
    const baseNode = screen.getByTestId("ow-dag-node-solve-baseline");
    const pertNode = screen.getByTestId("ow-dag-node-solve-perturbed");
    expect(baseNode).toHaveAttribute("data-layer", "1");
    expect(pertNode).toHaveAttribute("data-layer", "1");

    let panel = await clickNode("ow-dag-node-solve-baseline");
    expect(within(panel).getByTestId("dag-node-inspector-src")).toHaveTextContent("baselineSolution / baselineObjective");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("基线局面真解一次");
    fireEvent.keyDown(document, { key: "Escape" });

    panel = await clickNode("ow-dag-node-solve-perturbed");
    expect(within(panel).getByTestId("dag-node-inspector-src")).toHaveTextContent("perturbedSolution / perturbedObjective");
    // 「另解一次·不是在基线解上改数」—— 本页全部结论（Δ 可比）的立足点。
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("另解一次");
  });

  it("U3D-C6 · 步骤条在并列层**明说自己损失了什么**（不挑首节点的规则冒充全层）", async () => {
    await openOptimizeWhatifGraph();

    // 切到第 2 步「两次求解」——该层有 2 个并列环。
    fireEvent.click(screen.getByTestId("ow-steps-step-2"));
    const rule = screen.getByTestId("ow-steps-meta-rule");
    expect(rule).toHaveTextContent("2 个并列环");
    expect(rule).toHaveTextContent("在过程图上点各环看");
    // 数据栏仍逐环列全字段名（防漂移机制靠字段名，不许因为并列就省掉）。
    const data = screen.getByTestId("ow-steps-meta-data");
    expect(data).toHaveTextContent("baselineSolution / baselineObjective");
    expect(data).toHaveTextContent("perturbedSolution / perturbedObjective");
  });

  it("U3D-C7 · 反向断言：Escape 后面板真消失（不是一直挂在 DOM 里让上面几条白通过）", async () => {
    await openOptimizeWhatifGraph();
    await clickNode("ow-dag-node-compare");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("dag-node-inspector")).toBeNull();
  });
});
