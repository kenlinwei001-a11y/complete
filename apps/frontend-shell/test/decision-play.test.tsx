import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { queryClient } from "@/store/queryClient";

/**
 * WO-D · 决策推演页 decision_play 前端接线（5 区决策页·KILL-MOCK·SEAM-GATE）。
 * 5 区全部从真 `invokeSolver('decision_play')` 输出渲染，零写死数字/叙事串——喂两个「引擎态」（根因颗粒不同）
 * 证同一页组件纯投影：closesGap / 推荐组合 / narrowedPct 随之变（C4 接缝的前端半；引擎半由
 * datacore/test/decision-play.test.ts C6 锁）。诚实标注 solver「确定性求解」/ agent「策略推理·非真 LLM」。
 */

type Dims = { closesGap: number; cost: number; cycleDays: number; risk: number; exposure: number; reversibility: number };
type Opt = { optionId: string; factorId: string; label: string; sourceKind: "solver" | "agent" } & Dims & {
  provenance: { kind: string; basis: string; drillType: string; drillId: string; drillValue: number };
};

function matrixOf(options: Opt[]) {
  return options.map((o) => ({
    optionId: o.optionId,
    label: o.label,
    dims: { closesGap: o.closesGap, cost: o.cost, cycleDays: o.cycleDays, risk: o.risk, exposure: o.exposure, reversibility: o.reversibility },
  }));
}

// ── 引擎态 A（seg_attain_ess 越线·certWeeks=16 / LTA 缺口大）：推荐组合 = 长协条款 + 备份认证。────────────
const OPTIONS_A: Opt[] = [
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
const DP_A = {
  rootCause: { factorId: "cf-upstream-cut", label: "上游减供", metricKey: "seg_attain_ess", gap: 27.8, unit: "%" },
  options: OPTIONS_A,
  matrix: matrixOf(OPTIONS_A),
  triggers: [
    { triggerId: "trig-backup-cert", signalRef: "licarb_pct_cum", signalValue: 14.29, op: ">", threshold: 12, fired: true, action: "启动备份供应商认证", thresholdSource: "trigger.default" },
    { triggerId: "trig-fx-hedge", signalRef: "usd_cny", signalValue: 7.18, op: ">", threshold: 8, fired: false, action: "外汇对冲展期", thresholdSource: "trigger.default" },
    { triggerId: "trig-lta-reprice", signalRef: "li_carbonate_price", signalValue: 96000, op: ">", threshold: 90000, fired: true, action: "长协重定价谈判", thresholdSource: "trigger.default" },
  ],
  recommendedPlan: {
    planId: "plan-cf-upstream-cut", optionIds: ["opt-lta-clause", "opt-backup-cert"],
    steps: [
      { phase: "即刻", action: "长协加价格联动条款", optionRef: "opt-lta-clause" },
      { phase: "本季", action: "缩短备份供应商认证周期", optionRef: "opt-backup-cert" },
    ],
    totalClosesGap: 6.1, totalCost: 338,
  },
  sandboxNarrowing: { beforeGap: 27.8, afterGap: 21.7, narrowedPct: 21.94, ticks: 0 },
  summary: "根因「上游减供」(可解决供应权重 6.1%) → 3 方案比对·推荐组合 2 项补 6.1%(收窄 21.94%)·2/3 触发规则 fire",
};

// ── 引擎态 B（改根因颗粒：certWeeks 16→4·LTA 缺口收窄）→ closesGap 变·推荐组合变 {备份认证 + 自采}·收窄变。──
const OPTIONS_B: Opt[] = [
  { ...OPTIONS_A[0]!, closesGap: 5.9, cycleDays: 28, provenance: { ...OPTIONS_A[0]!.provenance, drillValue: 4 } },
  { ...OPTIONS_A[1]!, closesGap: 2.0, provenance: { ...OPTIONS_A[1]!.provenance, drillValue: 0 } },
  { ...OPTIONS_A[2]!, closesGap: 3.0, provenance: { ...OPTIONS_A[2]!.provenance, drillValue: 200 } },
];
const DP_B = {
  ...DP_A,
  options: OPTIONS_B,
  matrix: matrixOf(OPTIONS_B),
  recommendedPlan: {
    planId: "plan-cf-upstream-cut", optionIds: ["opt-backup-cert", "opt-insource"],
    steps: [
      { phase: "即刻", action: "缩短备份供应商认证周期", optionRef: "opt-backup-cert" },
      { phase: "半年", action: "上游自采矿+战略储备", optionRef: "opt-insource" },
    ],
    totalClosesGap: 8.9, totalCost: 1408,
  },
  sandboxNarrowing: { beforeGap: 27.8, afterGap: 18.9, narrowedPct: 32.01, ticks: 0 },
};

function dpHandler(payload: unknown) {
  return http.post("*/a/v1/solvers/decision_play/invoke", () => HttpResponse.json({ data: payload, snapshotVersion: "ov-dp" }));
}

function renderDP(payload: unknown) {
  loginAs("planner");
  server.use(dpHandler(payload));
  return renderApp("/v/decision-play");
}

describe("WO-D · 决策推演页 5 区", () => {
  it("C1 · 5 区全渲真值（根因 / 方案×3 / 比对矩阵 / 触发 / 推荐+收窄）", async () => {
    renderDP(DP_A);
    // ① 根因区
    const rc = await screen.findByTestId("dp-root-cause");
    expect(rc).toHaveTextContent("上游减供");
    expect(rc).toHaveTextContent("seg_attain_ess");
    expect(screen.getByTestId("dp-root-gap")).toHaveTextContent("27.8%");
    // ② 方案卡区（3 张·closesGap 真值）
    expect(screen.getByTestId("dp-option-opt-backup-cert")).toBeInTheDocument();
    expect(screen.getByTestId("dp-option-opt-lta-clause")).toBeInTheDocument();
    expect(screen.getByTestId("dp-option-opt-insource")).toBeInTheDocument();
    expect(screen.getByTestId("dp-option-cg-opt-backup-cert")).toHaveTextContent("3.2%");
    // ③ 比对矩阵（cell 真值 + 最优列高亮从数据算：closesGap 最优=自采 5.5）
    expect(screen.getByTestId("dp-matrix-opt-backup-cert-closesGap")).toHaveTextContent("3.2%");
    expect(screen.getByTestId("dp-matrix-opt-insource-closesGap")).toHaveAttribute("data-best", "1");
    expect(screen.getByTestId("dp-matrix-opt-backup-cert-closesGap")).not.toHaveAttribute("data-best", "1");
    // ④ 触发规则
    expect(screen.getByTestId("dp-trigger-trig-backup-cert")).toBeInTheDocument();
    // ⑤ 推荐组合 + 差距收窄
    expect(screen.getByTestId("dp-plan")).toBeInTheDocument();
    expect(screen.getByTestId("dp-step-opt-lta-clause")).toBeInTheDocument();
    expect(screen.getByTestId("dp-narrowed-pct")).toHaveTextContent("21.94%");
  });

  it("C2 · 点方案卡展开 → 六维 + provenance 下钻，点 drill 弹真对象值", async () => {
    renderDP(DP_A);
    const toggle = await screen.findByTestId("dp-option-toggle-opt-backup-cert");
    fireEvent.click(toggle);
    const detail = await screen.findByTestId("dp-option-detail-opt-backup-cert");
    // 六维全出
    for (const d of ["closesGap", "cost", "cycleDays", "risk", "exposure", "reversibility"]) {
      expect(within(detail).getByTestId(`dp-dim-opt-backup-cert-${d}`)).toBeInTheDocument();
    }
    // 下钻真对象（点 drill 弹「来自 {drillType}.{drillId} · {basis} = {drillValue}」）
    const drill = within(detail).getByTestId("dp-drill-opt-backup-cert");
    expect(drill).toHaveTextContent("BackupSupplierPool");
    fireEvent.click(drill);
    const dd = await screen.findByTestId("dp-drill-detail-opt-backup-cert");
    expect(dd).toHaveTextContent("BackupSupplierPool");
    expect(dd).toHaveTextContent("pool-cathode");
    expect(dd).toHaveTextContent("certWeeks");
    expect(dd).toHaveTextContent("16");
  });

  it("C3 · sourceKind 诚实：solver→确定性求解 / agent→策略推理·非真 LLM，全页无「数据库事实」", async () => {
    const { container } = renderDP(DP_A);
    expect(await screen.findByTestId("dp-src-opt-backup-cert")).toHaveTextContent("确定性求解");
    expect(screen.getByTestId("dp-src-opt-lta-clause")).toHaveTextContent("策略推理·非真 LLM");
    expect(screen.getByTestId("dp-src-opt-insource")).toHaveTextContent("策略推理·非真 LLM");
    expect(container.textContent ?? "").not.toContain("数据库事实");
  });

  it("C4 · 接缝（前端半）：改根因颗粒（引擎态 A→B）→ closesGap / 推荐组合 / narrowedPct 跟着变（纯投影·零写死）", async () => {
    // 引擎态 A
    renderDP(DP_A);
    expect(await screen.findByTestId("dp-option-cg-opt-backup-cert")).toHaveTextContent("3.2%");
    expect(screen.getByTestId("dp-narrowed-pct")).toHaveTextContent("21.94%");
    expect(screen.getByTestId("dp-matrix-row-opt-lta-clause")).toHaveTextContent("推荐");
    expect(screen.getByTestId("dp-matrix-row-opt-insource")).not.toHaveTextContent("推荐");

    // 切引擎态 B（同组件代码·仅后端根因颗粒变）——清缓存 + 换 handler + 重挂。
    cleanup();
    queryClient.clear();
    server.resetHandlers();
    server.use(dpHandler(DP_B));
    renderApp("/v/decision-play");

    // closesGap 变（3.2→5.9·drillValue 16→4 派生）、narrowedPct 变（21.94→32.01）、推荐组合变（+自采）。
    expect(await screen.findByTestId("dp-option-cg-opt-backup-cert")).toHaveTextContent("5.9%");
    expect(screen.getByTestId("dp-narrowed-pct")).toHaveTextContent("32.01%");
    expect(screen.getByTestId("dp-matrix-row-opt-insource")).toHaveTextContent("推荐");
  });

  it("C5 · triggers fired 随信号真值；thresholdSource=rule.params → 「已被规则覆盖」", async () => {
    const payload = {
      ...DP_A,
      triggers: [
        // 阈值被规则覆盖（12→20）→ 14.29 < 20 → 不再 fire（证阈值一等可编辑）。
        { triggerId: "trig-backup-cert", signalRef: "licarb_pct_cum", signalValue: 14.29, op: ">", threshold: 20, fired: false, action: "启动备份供应商认证", thresholdSource: "rule.params" },
        { triggerId: "trig-lta-reprice", signalRef: "li_carbonate_price", signalValue: 96000, op: ">", threshold: 90000, fired: true, action: "长协重定价谈判", thresholdSource: "trigger.default" },
      ],
    };
    renderDP(payload);
    expect(await screen.findByTestId("dp-trigger-fired-trig-lta-reprice")).toHaveTextContent("已触发");
    expect(screen.getByTestId("dp-trigger-fired-trig-backup-cert")).toHaveTextContent("未触发");
    expect(screen.getByTestId("dp-trigger-trig-lta-reprice")).toHaveAttribute("data-fired", "1");
    expect(screen.getByTestId("dp-trigger-trig-backup-cert")).toHaveAttribute("data-fired", "0");
    expect(screen.getByTestId("dp-trigger-src-trig-backup-cert")).toHaveTextContent("已被规则覆盖");
    expect(screen.getByTestId("dp-trigger-src-trig-lta-reprice")).toHaveTextContent("默认阈值");
  });

  it("空根因 / 功能未开 → 诚实空态，不编方案", async () => {
    loginAs("planner");
    server.use(
      http.post("*/a/v1/solvers/decision_play/invoke", () =>
        HttpResponse.json({ error: { code: "FEATURE_NOT_FOUND", message: "求解器不存在或未开通", requestId: "r1" } }, { status: 404 }),
      ),
    );
    renderApp("/v/decision-play");
    expect(await screen.findByTestId("dp-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("dp-options")).toBeNull();
    expect(screen.queryByTestId("dp-plan")).toBeNull();
  });

  it("提交决策：create Decision（选定=推荐组合）→ commit → 走 S2 审批链", async () => {
    loginAs("planner");
    server.use(
      dpHandler(DP_A),
      http.post("*/a/v1/decisions", () => HttpResponse.json({ id: "dec_abc", status: "PROPOSED" }, { status: 201 })),
      http.post("*/a/v1/decisions/dec_abc/commit", () => HttpResponse.json({ id: "dec_abc", status: "COMMITTED" })),
    );
    renderApp("/v/decision-play");
    const btn = await screen.findByTestId("dp-commit");
    fireEvent.click(btn);
    const res = await screen.findByTestId("dp-commit-result");
    expect(res).toHaveTextContent("dec_abc");
  });

  it("驾驶舱「💡 决策推演」入口 → 点击进入 /v/decision-play（可达·非闲置）", async () => {
    loginAs("planner");
    server.use(dpHandler(DP_A));
    const { router } = renderApp("/v/dash");
    const entry = await screen.findByTestId("dash-decision-entry");
    expect(entry).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dash-decision-go"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/decision-play"));
    // 落地即渲真求解器 5 区（根因区出）。
    expect(await screen.findByTestId("dp-root-cause")).toBeInTheDocument();
  });
});
