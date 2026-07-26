import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { domainResolveMulti } from "../src/router/domain-resolver.js";
import { selectDeterministicMultiRoute, detectCoupledPairs, assembleMultiDomainAnswer, selectMultiIntent } from "../src/router/multi-route.js";
import { planCoordination } from "../src/router/coordinator.js";

/**
 * WO-QOS-CROSS-DOMAIN-UNIFIED · 跨域编排统一版 SEAM（②确定性多路 + ⑤LLM 多意图 + Coordinator 降级）。
 *
 * 头号判据 SEAM-Q2（治 Q2 300s）：Q2 跨域题 flag **开** → **不进 Coordinator**（model=deterministic:multi-domain·agentRequests=0·
 * classify 耗时=0）·并行 ≥3 solver·分节答案带 ⟦ref⟧·耦合诚实标；flag **关**（+Coordinator 开）→ 进 Coordinator（证明修的就是这条）。
 *
 * R6 命门：domainResolveMulti + selectDeterministicMultiRoute + 块装配全纯函数·零 LLM/随机/时钟·同问句同解字节一致。
 */

/** 风控员例（PRD SEAM-1 旗舰）：一因（良率掉 2%）多果·果与果独立。 */
const RISK_Q = "常州基地良率掉了2%，交期和毛利分别受多大影响？";
/** Q2 铁证（治 300s·涂布良率↓·产出↓·长协·订单延误·外协/加班）——三角色关键词共现（长协/涂布/良率）故此前被 Coordinator 先抢。 */
const Q2 = "常州 4680-NCM 涂布良率下降2%、有效产出下降5%、长协覆盖70%，哪些订单会延误，是外协还是加班补缺口？";
function riskPc(): PageContext {
  return { view: "risk", entities: [], selection: [], drillPath: [], actions: [], focus: { base: "常州" } };
}

/** 把 seed 注册表 agents 灌入（Coordinator 扇出需绑定的角色 agent·helpers 默认只种 package/intents/plans）。 */
async function seedAgents(t: TestApp): Promise<void> {
  for (const ag of seedRegistry().agents) {
    if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
  }
}

describe("WO-QOS-CROSS-DOMAIN-UNIFIED · 纯函数判定（R6·零 LLM）", () => {
  it("R6：同问句同 PageContext → domainResolveMulti 字节一致·风控员例枚举出 [finance_pnl, atp_check, yield_diagnosis]", () => {
    const a = domainResolveMulti(RISK_Q, riskPc());
    const b = domainResolveMulti(RISK_Q, riskPc());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // R6 命门
    expect(a.map((r) => r.solverKey)).toEqual(["finance_pnl", "atp_check", "yield_diagnosis"]);
    expect(a.every((r) => r.perDomainScore >= 0.6)).toBe(true);
    const sel = selectDeterministicMultiRoute(a);
    expect(sel).not.toBeNull();
    expect(sel!.length).toBe(3);
  });

  it("Q2 扩域覆盖（治缺口④）：良率/产出/长协/延误/外协 → 金库真名 solver·capacity_forecast 硬必填 modelId 填满（4680-NCM）", () => {
    const routes = domainResolveMulti(Q2, riskPc());
    const keys = routes.map((r) => r.solverKey);
    for (const k of ["yield_diagnosis", "capacity_forecast", "lta_gap", "affected_orders", "outsourcing_split"]) {
      expect(keys).toContain(k);
    }
    const cap = routes.find((r) => r.solverKey === "capacity_forecast")!;
    expect(cap.requiredArgs).toContain("modelId");
    expect(cap.args.modelId).toBe("4680-NCM");
    const sel = selectDeterministicMultiRoute(routes)!;
    expect(sel.length).toBeGreaterThanOrEqual(3);
    // 收口：MAX_DOMAINS 4→5·Q2 全 5 域入选（"外协还是加班"=outsourcing_split 是 Q2 收尾决策·不可被上界丢）。
    expect(sel.map((r) => r.solverKey)).toContain("outsourcing_split");
    expect(sel.every((r) => r.perDomainScore >= 0.6 && r.solverKey)).toBe(true);
    expect(JSON.stringify(domainResolveMulti(Q2, riskPc()))).toBe(JSON.stringify(routes)); // R6 字节一致
  });

  it("Q2 耦合诚实标：良率→产出→延误依赖链检出耦合对（诚实标·L1 不假装 L3 联合）", () => {
    const sel = selectDeterministicMultiRoute(domainResolveMulti(Q2, riskPc()))!;
    expect(detectCoupledPairs(sel).length).toBeGreaterThan(0);
  });

  it("capacity_forecast 缺 modelId（问句无型号 token）→ 该域被槽门剔除·但剩 ≥2 域仍可走多路（非整体炸）", () => {
    const q = "常州涂布良率下降、长协覆盖不足、订单会延误、外协还是加班？"; // 无 4680-NCM 型号 token
    const routes = domainResolveMulti(q, riskPc());
    const cap = routes.find((r) => r.solverKey === "capacity_forecast");
    expect(cap?.args.modelId).toBeUndefined();
    const sel = selectDeterministicMultiRoute(routes)!;
    expect(sel).not.toBeNull();
    expect(sel.map((r) => r.solverKey)).not.toContain("capacity_forecast"); // 缺参域剔除
    expect(sel.length).toBeGreaterThanOrEqual(2);
  });

  it("诚实边界：任一域被 open/orchestration 压到阈下 → 整体回落 null（不硬凑·让位 Coordinator/LLM）", () => {
    const openQ = "如果常州毛利掉了，交期会不会受影响？";
    expect(selectDeterministicMultiRoute(domainResolveMulti(openQ, riskPc()))).toBeNull();
  });

  it("单域族 → <2 → null（只对≥2 独立域启用·不劫持单域）", () => {
    expect(selectDeterministicMultiRoute(domainResolveMulti("常州毛利为什么下滑？", riskPc()))).toBeNull();
  });

  it("装配诚实标：检出耦合对 → 顶部标「独立测算·未链式传导·见 L3」·每域独立 ⟦ref⟧·装配无裸业务数字（R13）", () => {
    const routes = selectDeterministicMultiRoute(domainResolveMulti("常州供需对不上，交期分别受多大影响？", riskPc()))!;
    const coupled = detectCoupledPairs(routes);
    expect(coupled.length).toBeGreaterThan(0);
    const products = routes.map((r, i) => ({ route: r, toolCallId: `tc_${i}`, ok: true, outcome: "OK", durationMs: 1, data: { ok: true } }));
    const answer = assembleMultiDomainAnswer(products, coupled);
    const md = answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("独立测算");
    expect(md).toContain("未链式传导");
    expect(md).toContain("⟦ref:0⟧");
    expect(md).toContain("⟦ref:1⟧");
    expect(answer.unverifiedNumerics).toBe(false);
    expect(answer.provenance.length).toBe(routes.length);
  });

  it("Coordinator 降级（§3.3·纯函数）：Q2 能被 selectDeterministicMultiRoute 分解 → planCoordination(flag开) 返 undefined 让位②", () => {
    expect(planCoordination(Q2, riskPc(), [], false)).toBeDefined(); // flag 关：现状 Coordinator plan（SEAM-6 零回归）
    expect(planCoordination(Q2, riskPc(), [], true)).toBeUndefined(); // flag 开：能 solver 分解 → 让位②
    // 真开放会诊题（无逐域 solver 锚·orchestration 压分）→ selectDeterministicMultiRoute=null → 仍落 Coordinator（即便 flag 开）。
    const openTriad = "综合分析常州的交付风险连锁影响，给个整体结论";
    expect(planCoordination(openTriad, riskPc(), [], true)).toBeDefined();
  });

  it("⑤ selectMultiIntent（纯函数）：≥2 候选≥tauMid + 各有 solver + 槽可填 + 无冲突 → 多路；缺 solver/槽不满/单候选 → 丢/null", () => {
    const cands = [
      { intentKey: "ceo_credit_exposure", confidence: 0.9, solverKey: "credit_exposure", args: {}, slotsFillable: true },
      { intentKey: "ceo_finance_pnl", confidence: 0.88, solverKey: "finance_pnl", args: {}, slotsFillable: true },
      { intentKey: "x_low", confidence: 0.5, solverKey: "atp_check", args: {}, slotsFillable: true },
      { intentKey: "x_nosolver", confidence: 0.95, solverKey: undefined, args: {}, slotsFillable: true },
      { intentKey: "x_unfilled", confidence: 0.95, solverKey: "lta_gap", args: {}, slotsFillable: false },
    ];
    const sel = selectMultiIntent(cands, { tauMid: 0.8, maxIntents: 4 })!;
    expect(sel.routes.map((r) => r.solverKey)).toEqual(["credit_exposure", "finance_pnl"]);
    expect(selectMultiIntent([cands[0]!], { tauMid: 0.8, maxIntents: 4 })).toBeNull();
  });
});

describe("WO-QOS-CROSS-DOMAIN-UNIFIED · 活系统 SEAM（真跑 orchestrator）", () => {
  it("SEAM-Q2（头号·治 300s）：Q2 flag 开 → 不进 Coordinator·model=deterministic:multi-domain·agentRequests=0·并行 ≥3 solver·⟦ref⟧·耦合诚实标", async () => {
    const t: TestApp = await createTestApp();
    // 多域门开 + Coordinator 也开（证是"② 排在 Coordinator 前接住"·非"Coordinator 没开才不进"）。
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.deterministic-multi-domain", "agent.coordinator"]);
    await seedAgents(t);
    const { taskId } = await submitQuery(t, ADMIN, Q2, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(task.classification?.model).toBe("deterministic:multi-domain"); // 不进 Coordinator
    expect(task.classification?.latencyMs).toBe(0);
    expect(t.llm.classifyRequests.length).toBe(0);
    expect(t.llm.agentRequests.length).toBe(0); // 零 agent（Coordinator 会烧 agent·此处 0 证没进）
    expect(task.path).toBe("WORKFLOW");

    const plan = task.multiIntentPlan!;
    expect(plan.routeSource).toBe("deterministic-multi-domain");
    const solvers = plan.selectedIntents.map((s) => s.solverKey);
    const q2Set = ["yield_diagnosis", "capacity_forecast", "lta_gap", "affected_orders", "outsourcing_split"];
    expect(solvers.filter((k) => q2Set.includes(k)).length).toBeGreaterThanOrEqual(3);
    expect(plan.coupledPairs.length).toBeGreaterThan(0);

    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("⟦ref:0⟧");
    expect(md).toContain("未链式传导");
    expect(md).not.toContain("已给出联合");
    await t.app.close();
  });

  it("SEAM-Q2 对照（根治证）：Q2 flag 关 + Coordinator 开 → **进 Coordinator**（model=coordinator·agentRequests≥1）——证明修的就是这条", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]); // 多域门关·Coordinator 开
    await seedAgents(t);
    for (const ans of ["长协覆盖 70%，缺口需补。", "涂布产出下降，产能受限。", "良率下降 2%，需诊断。"]) {
      t.llm.queueAgentTurn(() => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: ans }], provenance: [] })] }));
    }
    const { taskId } = await submitQuery(t, ADMIN, Q2, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).toBe("coordinator"); // 进 Coordinator（现状病根路径）
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(1); // 烧 agent（Q2 300s 来源）
    await t.app.close();
  });

  it("SEAM-1（风控员独立多域）：flag 开 → 确定性接住·并行 3 solver·各 ⟦ref⟧·agentRequests=0", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.deterministic-multi-domain"]);
    const { taskId } = await submitQuery(t, ADMIN, RISK_Q, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).toBe("deterministic:multi-domain");
    expect(t.llm.agentRequests.length).toBe(0);
    const plan = task.multiIntentPlan!;
    expect(plan.selectedIntents.map((s) => s.solverKey)).toEqual(["finance_pnl", "atp_check", "yield_diagnosis"]);
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("⟦ref:0⟧");
    expect(md).toContain("⟦ref:2⟧");
    await t.app.close();
  });

  it("SEAM-2（根治证）：跨域题 flag 关→落 LLM（path-B agent 真被调）· flag 开→确定性接住（agentRequests=0·classify 耗时=0）", async () => {
    const off: TestApp = await createTestApp();
    off.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
    off.llm.queueAgentTurn((_req) => ({
      content: [text("跨域连锁分析（探索模式）。"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "跨域结论（path-B·LLM）。" }], provenance: [] })],
    }));
    const rOff = await submitQuery(off, ADMIN, RISK_Q, { view: "risk", pageContext: riskPc() });
    const tOff = await waitForTask(off, rOff.taskId, (x) => x.status === "COMPLETED");
    expect(tOff.classification?.model).not.toBe("deterministic:multi-domain");
    expect(off.llm.agentRequests.length).toBeGreaterThanOrEqual(1);
    expect(tOff.path).toBe("AGENT");
    await off.app.close();

    const on: TestApp = await createTestApp();
    on.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm", "qos.deterministic-multi-domain"]);
    const rOn = await submitQuery(on, ADMIN, RISK_Q, { view: "risk", pageContext: riskPc() });
    const tOn = await waitForTask(on, rOn.taskId, (x) => x.status === "COMPLETED");
    expect(tOn.classification?.model).toBe("deterministic:multi-domain");
    expect(tOn.classification?.latencyMs).toBe(0);
    expect(on.llm.agentRequests.length).toBe(0);
    expect(on.llm.classifyRequests.length).toBe(0);
    await on.app.close();
  });

  it("SEAM-3（⑤ LLM 多意图兜底）：确定性没覆盖的题 → classify 多候选 → **并行**（非只 top-1）·routeSource=llm-multi-intent·agentRequests=0", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.multi-intent-orchestration"]); // 仅 ⑤ 开（② 关）
    t.llm.queueClassification({
      candidates: [
        { intentKey: "ceo_credit_exposure", confidence: 0.9 },
        { intentKey: "ceo_finance_pnl", confidence: 0.88 },
      ],
      outOfCatalog: false,
      extractedSlots: {},
    });
    // 非 CEO 问句（不被确定性 CEO 绑定拦截）+ pageContext（CEO 意图进候选池）。
    const { taskId } = await submitQuery(t, ADMIN, "常州这个基地帮我整体过一遍看看", { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const plan = task.multiIntentPlan!;
    expect(plan.routeSource).toBe("llm-multi-intent");
    expect(plan.selectedIntents.length).toBeGreaterThanOrEqual(2); // 并行 ≥2（非只 top-1）
    const solvers = plan.selectedIntents.map((s) => s.solverKey);
    expect(solvers).toContain("credit_exposure");
    expect(solvers).toContain("finance_pnl");
    expect(t.llm.classifyRequests.length).toBeGreaterThanOrEqual(1); // 经了真 classify（⑤ = LLM 兜底）
    expect(t.llm.agentRequests.length).toBe(0); // 零 agent（并行 solver + 零 LLM 装配）
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("⟦ref:0⟧");
    await t.app.close();
  });

  it("SEAM-4（耦合诚实）：耦合跨域题 flag 开 → 确定性接住·顶部诚实标耦合·coupledPairs 非空·不出「已给出联合」", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.deterministic-multi-domain"]);
    const { taskId } = await submitQuery(t, ADMIN, "常州供需对不上，交期分别受多大影响？", { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).toBe("deterministic:multi-domain");
    expect(task.multiIntentPlan?.coupledPairs.length).toBeGreaterThan(0);
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("未链式传导");
    expect(md).not.toContain("已给出联合");
    await t.app.close();
  });

  it("SEAM-6（零回归·含 Coordinator）：两 flag 全关（默认 ALL）→ 跨域题**不**被多路劫持（沿用现单域 deterministic:ceo-route·非 multi-domain）", async () => {
    const t: TestApp = await createTestApp(); // 默认 ALL（deterministicMultiEnabled/multiIntentEnabled("ALL")=false）
    const { taskId } = await submitQuery(t, ADMIN, RISK_Q, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).not.toBe("deterministic:multi-domain");
    expect(task.multiIntentPlan).toBeUndefined();
    await t.app.close();
  });
});
