import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { domainResolveMulti, selectDeterministicMultiRoute } from "../src/router/domain-resolver.js";
import { detectCoupledPairs, domainRoutesToSpecs, assembleMultiRouteAnswer, type RouteSpec } from "../src/router/multi-route.js";
import { planCoordination } from "../src/router/coordinator.js";

/**
 * WO-QOS-CROSS-DOMAIN-UNIFIED · 跨域编排统一 SEAM（②确定性多路 + ⑤多意图兜底 + Coordinator 降级·驱动接缝）。
 *
 * 头号判据 SEAM-Q2（治 5 分钟·亲跑）：Q2 跨域 solver 题——flag 关 → **进 Coordinator**（3 角色 agent 烧预算·model=coordinator）；
 * flag 开 → **不进 Coordinator**（确定性接住·model=deterministic:multi-domain·agentRequests=0·并行 ≥3 solver·秒级带 ⟦ref⟧·耦合诚实标）。
 * 直接证明「跨域 solver 题从落 Coordinator 变成留确定性层」。
 *
 * R6 命门：domainResolveMulti + selectDeterministicMultiRoute + 块装配全纯函数·零 LLM/随机/时钟·同问句同解字节一致。
 */

/** Q2 铁证（PRD Q2·§3 头号判据）：涂布良率↓2%·有效产出↓5%·长协70%·哪些订单延误·外协还是加班。 */
const Q2 = "常州 4680-NCM 涂布良率掉了2%，未来4周有效产出降5%，7月三元长协覆盖70%，哪些订单会延误，缺口是外协还是加班？";
/** 风控员例（PRD §5·SEAM-1·独立多域）：一因（良率掉 2%）多果（交期↔affected / 毛利↔finance_pnl）·果与果独立。 */
const RISK_Q = "常州基地良率掉了2%，交期和毛利分别受多大影响？";
function riskPc(): PageContext {
  return { view: "risk", entities: [], selection: [], drillPath: [], actions: [], focus: { base: "常州" } };
}

/** 把 seed 注册表 agents 灌入测试 repos（Coordinator 扇出需要角色 agent）。 */
async function seedAgents(t: TestApp): Promise<void> {
  for (const ag of seedRegistry().agents) {
    if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
  }
}

const Q2_SOLVERS = ["yield_diagnosis", "capacity_forecast", "lta_gap", "affected_orders", "outsourcing_split"];

describe("WO-QOS-CROSS-DOMAIN-UNIFIED · 纯函数判定（R6·零 LLM·单一真值源逐域枚举）", () => {
  it("R6：Q2 → domainResolveMulti 字节一致·枚举出 Q2 五域·各槽可填（去 −0.4 跨域惩罚后各够格）", () => {
    const a = domainResolveMulti(Q2, riskPc());
    const b = domainResolveMulti(Q2, riskPc());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // R6 命门
    const keys = a.map((r) => r.solverKey);
    // Q2 五域 solver 真名（**非** yield_diag/lta_gap_q/outsourcing_q 那些场景意图 key）。
    expect(keys.filter((k) => Q2_SOLVERS.includes(k)).length).toBeGreaterThanOrEqual(5);
    expect(a.every((r) => r.perDomainScore >= 0.6)).toBe(true);
    expect(a.every((r) => r.slotsFillable)).toBe(true); // 硬门：各必填槽可填
    const sel = selectDeterministicMultiRoute(a);
    expect(sel).not.toBeNull();
    expect(sel!.length).toBeGreaterThanOrEqual(3);
  });

  it("槽可填硬门：capacity 域缺 modelId（无型号）→ 该域不够格 → 整体回落 null（不硬凑·§3.2）", () => {
    // "有效产出" 命中 capacity 族但**无型号** → capacity.slotsOk=false → selectDeterministicMultiRoute 整体回落。
    const routes = domainResolveMulti("常州有效产出降了，长协覆盖也不够", riskPc());
    expect(routes.some((r) => r.solverKey === "capacity_forecast" && !r.slotsFillable)).toBe(true);
    expect(selectDeterministicMultiRoute(routes)).toBeNull(); // 任一域不够格 → whole-fallback
  });

  it("无 PageContext → perDomainScore=0 → null（不冒进·上游照落 Coordinator/单域/LLM）", () => {
    const routes = domainResolveMulti(Q2, undefined);
    expect(routes.every((r) => r.perDomainScore === 0)).toBe(true);
    expect(selectDeterministicMultiRoute(routes)).toBeNull();
  });

  it("诚实边界：含 open（如果/会不会）→ 各域 −0.6 压到阈下 → null（不硬凑）", () => {
    const routes = domainResolveMulti("如果常州良率掉了，交期和毛利会不会受影响？", riskPc());
    expect(routes.every((r) => r.perDomainScore < 0.6)).toBe(true);
    expect(selectDeterministicMultiRoute(routes)).toBeNull();
  });

  it("Coordinator 降级判据：Q2 能被 selectDeterministicMultiRoute 拆 ≥2 solver → flag 开时 planCoordination 让位（返 undefined）", () => {
    // flag 开（canDeterministicMulti=true）→ Q2 让位 ②（返 undefined·§3.3）。
    expect(planCoordination(Q2, riskPc(), [], { canDeterministicMulti: true })).toBeUndefined();
    // flag 关（默认）→ 逐字节不变：Q2 三词共现（长协/涂布/良率）→ 仍召集三角会诊（返 plan）。
    expect(planCoordination(Q2, riskPc(), [])).toBeDefined();
  });

  it("SEAM-4 耦合诚实标（纯装配·防假综合）：Q2 检出耦合对·标「独立测算·未链式传导」·**不出现「已给联合/组合方案」**", () => {
    const routes = selectDeterministicMultiRoute(domainResolveMulti(Q2, riskPc()))!;
    const specs = domainRoutesToSpecs(routes);
    const coupled = detectCoupledPairs(specs);
    expect(coupled.length).toBeGreaterThan(0); // affected↔capacity 等耦合对
    const products = specs.map((r, i) => ({ route: r, toolCallId: `tc_${i}`, ok: true, outcome: "OK", durationMs: 1, data: { solverKey: r.solverKey, ok: true } }));
    const answer = assembleMultiRouteAnswer(products, coupled);
    const md = answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("独立测算");
    expect(md).toContain("未链式传导");
    expect(md).not.toMatch(/已给(出)?(联合|组合)方案/); // 防假综合（KILL-MOCK-RED）
    expect(answer.unverifiedNumerics).toBe(false); // 装配无裸业务数字（一律 ⟦ref⟧ 溯源·R13）
  });

  it("SEAM-5 partial（R7）：单 solver 失败 → 该节标「未计算 + 原因」·其余正常·无 hallucinate", () => {
    const specs: RouteSpec[] = [
      { domain: "yield", route: "yield_diagnosis", solverKey: "yield_diagnosis", sectionTitle: "良率诊断", args: {}, confidence: 0.85 },
      { domain: "capacity", route: "capacity_forecast", solverKey: "capacity_forecast", sectionTitle: "有效产出/产能", args: {}, confidence: 0.85 },
    ];
    const products = [
      { route: specs[0]!, toolCallId: "tc_0", ok: true, outcome: "OK", durationMs: 1, data: { ok: true } },
      { route: specs[1]!, toolCallId: "tc_1", ok: false, outcome: "ERROR", durationMs: 1, data: undefined },
    ];
    const answer = assembleMultiRouteAnswer(products, []);
    const md = answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("该域未计算");
    expect(md).toContain("ERROR");
    expect(md).toContain("⟦ref:0⟧"); // 成功域仍溯源
  });
});

describe("WO-QOS-CROSS-DOMAIN-UNIFIED · 活系统 SEAM（真跑 orchestrator·mock LLM 驱动）", () => {
  it("SEAM-Q2（头号·治 5 分钟）：flag 开 → **不进 Coordinator**（agentRequests=0·model=deterministic:multi-domain·并行 ≥3 solver·⟦ref⟧）", async () => {
    const t: TestApp = await createTestApp();
    // 同时开 Coordinator 与 ②：证明 ② 在 Coordinator 门**之前**先接住（真接缝·非 Coordinator 恰好没开）。
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator", "qos.deterministic-multi-domain"]);
    await seedAgents(t);
    const { taskId } = await submitQuery(t, ADMIN, Q2, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(task.classification?.model).toBe("deterministic:multi-domain"); // 确定性接住·非 coordinator
    expect(task.classification?.latencyMs).toBe(0); // 零 classify
    expect(t.llm.classifyRequests.length).toBe(0);
    expect(t.llm.agentRequests.length).toBe(0); // **不进 Coordinator·无 path-B agent**（治 5 分钟根因）
    expect(task.path).toBe("WORKFLOW");

    const plan = task.multiIntentPlan!;
    expect(plan.routeSource).toBe("deterministic-multi-domain");
    expect(plan.synthesisMode).toBe("deterministic");
    const solvers = plan.selectedIntents.map((s) => s.solverKey);
    expect(solvers.filter((k) => Q2_SOLVERS.includes(k)).length).toBeGreaterThanOrEqual(3); // 并行 ≥3 Q2 solver
    expect(plan.coupledPairs.length).toBeGreaterThan(0); // 耦合诚实标

    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("⟦ref:0⟧");
    expect(md).toContain("未链式传导");
    await t.app.close();
  });

  it("SEAM-Q2 对照（根治证）：同 Q2·flag **关** → **进 Coordinator**（model=coordinator·agentRequests≥1·证明修的就是这条）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]); // ② 门**关**·Coordinator 开
    await seedAgents(t);
    const { taskId } = await submitQuery(t, ADMIN, Q2, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).toBe("coordinator"); // 走老路进 Coordinator
    expect(task.classification?.model).not.toBe("deterministic:multi-domain");
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(1); // 3 角色 agent 真被调（烧预算的老路）
    expect(task.multiIntentPlan).toBeUndefined();
    await t.app.close();
  });

  it("SEAM-1（独立多域）：风控员例 flag 开 → deterministic:multi-domain·agentRequests=0·并行 ≥3 solver·三域分节各 ⟦ref⟧", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.deterministic-multi-domain"]);
    const { taskId } = await submitQuery(t, ADMIN, RISK_Q, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).toBe("deterministic:multi-domain");
    expect(t.llm.classifyRequests.length).toBe(0);
    expect(t.llm.agentRequests.length).toBe(0);
    const solvers = task.multiIntentPlan!.selectedIntents.map((s) => s.solverKey);
    expect(solvers).toContain("finance_pnl"); // 毛利
    expect(solvers).toContain("yield_diagnosis"); // 良率
    expect(solvers).toContain("affected_orders"); // 交期
    expect(solvers.length).toBeGreaterThanOrEqual(3);
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("⟦ref:0⟧");
    expect(md).toContain("⟦ref:2⟧");
    await t.app.close();
  });

  it("SEAM-2（根治·同题两态）：跨域题 flag 关→落 LLM/Coordinator·开→确定性接住（0 classify·0 agentRequests）", async () => {
    // flag 关（+ceo.free-llm）：跨域被 −0.4 压下 → 落 path-B free-LLM agent = 落 LLM 推理路径。
    const off: TestApp = await createTestApp();
    off.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
    off.llm.queueAgentTurn(() => ({ content: [text("跨域连锁分析（探索模式）。"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "跨域结论（path-B·LLM）。" }], provenance: [] })] }));
    const rOff = await submitQuery(off, ADMIN, RISK_Q, { view: "risk", pageContext: riskPc() });
    const tOff = await waitForTask(off, rOff.taskId, (x) => x.status === "COMPLETED");
    expect(tOff.classification?.model).not.toBe("deterministic:multi-domain");
    expect(off.llm.agentRequests.length).toBeGreaterThanOrEqual(1); // 落 LLM
    await off.app.close();

    // flag 开：确定性多路在 free-LLM 之前接住 → 零 LLM。
    const on: TestApp = await createTestApp();
    on.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm", "qos.deterministic-multi-domain"]);
    const rOn = await submitQuery(on, ADMIN, RISK_Q, { view: "risk", pageContext: riskPc() });
    const tOn = await waitForTask(on, rOn.taskId, (x) => x.status === "COMPLETED");
    expect(tOn.classification?.model).toBe("deterministic:multi-domain");
    expect(on.llm.agentRequests.length).toBe(0);
    expect(on.llm.classifyRequests.length).toBe(0);
    await on.app.close();
  });

  it("SEAM-3（⑤兜底）：确定性没覆盖的跨域题 → classify 出 ≥2 高置信候选 → 并行（非只 top-1）·routeSource=llm-multi-intent", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.multi-intent-orchestration"]); // 仅 ⑤·② 关
    // 中性问句（非 CEO 问句·不匹配任何硬域族 → ② 不覆盖）；classify 手动返 2 个高置信 CEO 候选（各无必填槽）。
    t.llm.queueClassification({
      candidates: [
        { intentKey: "ceo_credit_exposure", confidence: 0.9 },
        { intentKey: "ceo_bottleneck", confidence: 0.88 },
      ],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, ADMIN, "请综合梳理一下当前经营局面", {
      view: "risk",
      pageContext: { view: "risk", entities: [], selection: [], drillPath: [], actions: [] } as PageContext,
    });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(t.llm.classifyRequests.length).toBe(1); // classify 真被调（⑤ 在 classify 之后）
    expect(t.llm.agentRequests.length).toBe(0); // 并行 solver·非 agent
    expect(task.classification?.model).toBe("llm:multi-intent");
    const plan = task.multiIntentPlan!;
    expect(plan.routeSource).toBe("llm-multi-intent");
    expect(plan.selectedIntents.length).toBe(2); // 并行 2 意图·非只 top-1
    expect(plan.selectedIntents.map((s) => s.solverKey).sort()).toEqual(["bottleneck_matrix", "credit_exposure"]);
    await t.app.close();
  });

  it("SEAM-6（零回归）：两 flag 全关（默认 ALL）→ Q2 **不**被多路劫持（无 multiIntentPlan·model≠multi-domain）", async () => {
    const t: TestApp = await createTestApp(); // 默认 ALL（deterministicMultiEnabled/multiIntentEnabled("ALL")=false·Coordinator 亦关）
    await seedAgents(t);
    const { taskId } = await submitQuery(t, ADMIN, Q2, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).not.toBe("deterministic:multi-domain");
    expect(task.classification?.model).not.toBe("llm:multi-intent");
    expect(task.multiIntentPlan).toBeUndefined();
    await t.app.close();
  });
});
