import { describe, expect, it } from "vitest";
import type { GapFinding, PageContext, SubmitQueryBody } from "@platform/contracts";
import {
  createTestApp,
  submitQuery,
  waitForTask,
  lastToolCallId,
  ADMIN,
  PLANNER,
  PKG,
  TENANT,
  type TestApp,
} from "./helpers.js";
import { text, toolUse, type ScriptedTurn } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { projectNavigationSlice, renderNavigationSlice, navigationSliceSolverKeys } from "../src/agent/navigation-slice.js";
import { buildGrowthLoopWiring } from "../src/growth/scenario-grow.js";
import { questionSlug } from "../src/growth/scaffold.js";

/**
 * ★ WO-E2E-DIALOGUE-ACCEPTANCE · 全链验收门（capstone·蓝图 §5 拥有的唯一"防各半绿·断在接缝"硬门）。
 *
 * 蓝图 BLUEPRINT-DRIL-decision-dialogue.md §4 接缝表 S1~S7 逐缝串起来跑真问句：
 *   真问句 → ①分类器→router（S1）→ ②开放落 DRIL（S2/S3）→ ③agent 调 solver（S4）→
 *   ④缺数据自动补（S5·growth-engine）→ ⑤reflect 复盘（S6）→ ⑥结构化接地输出（S7）。
 *
 * 三类问句（覆盖真实分布·§5）：
 *   1. 预设命中：场景卡触发问句 → path-A 出真答案（证 S1）。
 *   2. 开放长尾：不在意图目录的自由问 → DRIL 检索资源出答（证 S2/S3）。
 *   3. CEO 深问：根因/方案类 → agent(+reflect) 出结论/证据/建议/风险（证 S4/S6/S7）。
 *
 * 命门纪律（诚实绿·非假绿）：
 *   · 真成立于本 base 的行为 → 真断言（无 LLM 诚实降级 + S5 growth + S7 ⟦ref⟧口径 + path-A 路由）。
 *   · 真 LLM 端到端（QOS_*_MODEL + key）→ `it.skipIf(!REAL_LLM)`（沙箱无 provider·不 red 门·部署态跑）。
 *   · base 未落依赖（REFLECT-LOOP·agent/reflect.ts 不存在）→ `describe.skip` + TODO「待 WO-REFLECT-LOOP 解封」。
 *   · 发现真断链 → 只暴露不修（注释点名断在哪个 S 缝·归哪张 WO）。
 */

/** 真 LLM 双跑门：部署态设 provider key（QOS_*_MODEL 有默认，需真 key 才可用）→ 解封 skipIf 段。 */
const REAL_LLM = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.E2E_REAL_LLM);

/** 供需双向块（rich block context·令 shouldUseFreeLLM=true → 落 path-B 真 LLM 深问接缝）。 */
function supplyDemandBlockPC(demandPct = 28.5): PageContext {
  return {
    view: "dashboard",
    entities: [],
    selection: [],
    drillPath: [],
    actions: [],
    block: {
      blockId: "dash-supply-demand",
      blockType: "supply-demand",
      blockTitle: "供需失衡双向归因",
      blockData: { metricKey: "seg_attain_ess", totalGap: 27.8, unit: "万套", demandPct, supplyPct: 63.2, reconciled: true },
      selection: [],
      provenanceRef: "supply_demand_gap_attribution",
    },
  };
}

/** CEO 深问 scripted path-B：query_objects → invoke_solver(gap_attribution) → final_answer（结论/证据/建议/风险 + ⟦ref⟧）。 */
function ceoDecisionTurns(): ScriptedTurn[] {
  const decisionMd = [
    "**结论**：储能缺口 27.8 万套主要由供给侧贡献 ⟦ref:0⟧。",
    "**证据**：供需归因求解显示供给端占比 63.2% ⟦ref:0⟧。",
    "**建议**：优先补正极产能并加开夜班。",
    "**风险**：夜班用工与正极到货仍存不确定性，需持续跟踪。",
  ].join("\n");
  return [
    () => ({
      content: [
        text("先取相关对象再做归因求解。"),
        toolUse("query_objects", { objectType: "Metric", filter: { metricKey: "seg_attain_ess" } }),
        toolUse("invoke_solver", { solverKey: "gap_attribution", args: { metricKey: "seg_attain_ess" } }),
      ],
    }),
    (req) => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: decisionMd }],
          provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.totalGap" }],
        }),
      ],
    }),
  ];
}

const H = { "x-debug-user": PLANNER, "content-type": "application/json" };
const AUTH = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
const noopEmit = async (): Promise<void> => {};
const finding = (gapCode: GapFinding["gapCode"]): GapFinding => ({ gapCode, evidence: "empty slice", suggestedFill: "f", blocking: true });
const body = (query: string, context: SubmitQueryBody["context"]): SubmitQueryBody => ({ packageId: PKG, query, context });

// =====================================================================================
// S1 · 分类器 → router → path-A（预设命中·真绿）
// 契约：分类命中的意图，router 真吃到并走 path-A 确定性求解（不误路由/不崩）。
// =====================================================================================
describe("S1 · 预设命中 → path-A（分类器→router 真接线·真绿）", () => {
  it("场景卡触发问句『常州基地影响哪些订单』→ 命中 affected_orders → path-A WORKFLOW 出答案", async () => {
    const t = await createTestApp();
    // 分类器命中预设意图（scripted 模拟分类器输出·测 router 吃到并落 path-A 的接缝·非蒙真 LLM）。
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.92 }],
      outOfCatalog: false,
      extractedSlots: { baseId: "changzhou" },
    });
    const { taskId, statusCode } = await submitQuery(t, ADMIN, "常州基地影响哪些订单", {
      view: "risk",
      selectedObjects: [{ objectType: "Base", objectId: "changzhou" }],
    });
    expect(statusCode).toBe(202);
    const task = await waitForTask(t, taskId);
    // S1 端到端：命中意图 → 走 path-A（WORKFLOW·非 AGENT 洪泛）→ 出答案（router 真吃到分类结果）。
    expect(task.status).toBe("COMPLETED");
    expect(task.matchedIntent?.intentKey).toBe("affected_orders");
    expect(task.path).toBe("WORKFLOW");
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    await t.app.close();
  });

  it("PageContext 焦点触发 CEO 确定性路由『储能为什么没达标』→ path-A gap_attribution（无需真 LLM 分类）", async () => {
    const t = await createTestApp();
    const pc: PageContext = {
      view: "gap-waterfall",
      focus: { metric: "seg_attain_ess", gap: 27.8, factorId: "cf-cathode-shortage" },
      entities: [{ type: "Metric", id: "seg_attain_ess", label: "储能达成率", value: 72.2, drillRef: "obj_metric" }],
      selection: ["cf-cathode-shortage"],
      drillPath: ["seg_attain_ess"],
      actions: ["decision_play"],
    };
    const { taskId } = await submitQuery(t, ADMIN, "储能为什么没达标", { view: "gap-waterfall", pageContext: pc });
    const task = await waitForTask(t, taskId);
    // S1：确定性 CEO 路由（PageContext 派生 args）真吃到并落 path-A·非崩。
    expect(task.classification?.model).toBe("deterministic:ceo-route");
    expect(task.matchedIntent?.intentKey).toBe("ceo_root_cause");
    expect(task.slots?.metricKey).toBe("seg_attain_ess");
    expect(task.status).toBe("COMPLETED");
    await t.app.close();
  });

  // TODO[待 WO-CLASSIFIER-PROMPT 部署态解封]：真 LLM 分类器命中预设的端到端命中率（沙箱无 provider→skipIf）。
  it.skipIf(!REAL_LLM)("[真 LLM] 分类器真判『常州基地影响哪些订单』→ 命中预设 → path-A", async () => {
    const t = await createTestApp({ env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "" } });
    const { taskId } = await submitQuery(t, ADMIN, "常州基地影响哪些订单", { view: "risk" });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("WORKFLOW");
    await t.app.close();
  });
});

// =====================================================================================
// S1/S2 · 无 LLM 诚实降级不崩（capstone 灵魂·守 WO-0·真绿·沙箱必跑）
// 契约：开放题分类失败 + 无 provider → 诚实降级 COMPLETED，绝不 INTERNAL_ERROR/静默空答。
// =====================================================================================
describe("S1/S2 · 无 LLM provider 开放题 → 诚实降级不崩（真绿·守 WO-0）", () => {
  it("开放长尾问 + 无 provider + 分类失败 → COMPLETED 诚实降级文案·无 error（不崩）", async () => {
    const t = await createTestApp();
    // 不 queueClassification → mock classify 抛 → undefined；开放问句不命中确定性路由/场景卡。
    const { taskId } = await submitQuery(t, PLANNER, "随便帮我发散想想现在有什么值得关注的地方");
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED"); // 非 FAILED
    expect(task.error).toBeUndefined(); // 无 INTERNAL_ERROR（用户实测的崩已修）
    const block = task.answer?.blocks.find((b) => b.type === "text");
    const md = block && block.type === "text" ? block.markdown : "";
    expect(md).toContain("未接入可用的 LLM"); // 诚实说明未接 LLM·指路（非静默空答）
    await t.app.close();
  });

  it("对照：注入 provider 凭据 → 降级不触发·不劫持既有路径（字节兼容）", async () => {
    const t = await createTestApp({ env: { ANTHROPIC_API_KEY: "test-key" } });
    const { taskId } = await submitQuery(t, PLANNER, "随便帮我发散想想现在有什么值得关注的地方");
    const task = await waitForTask(t, taskId);
    const block = task.answer?.blocks.find((b) => b.type === "text");
    const md = block && block.type === "text" ? block.markdown : "";
    expect(md).not.toContain("未接入可用的 LLM"); // providerAvailable=true → 跳过本 WO 降级
    await t.app.close();
  });
});

// =====================================================================================
// S2/S3 · DRIL 开放长尾检索 → navigation-slice 喂 agent
// 契约：分类不中的开放题落 DRIL 语义检索，top-k 资源真喂进 navigation-slice，agent 命中它。
// 真绿部分：navigation-slice 投影是确定性纯函数（R6·无 LLM）——为开放问句真产候选 solver（DRIL→agent 接线在）。
// =====================================================================================
describe("S2/S3 · DRIL 检索接线（navigation-slice 确定性投影·真绿）", () => {
  it("开放问句 → projectNavigationSlice 确定性产候选 solver（R6 字节一致·DRIL→agent 喂料在）", () => {
    const scope = { objectTypes: ["Metric", "DemandSegment", "Base"], toolNames: ["query_objects", "invoke_solver"] };
    const q = "把这块供需缺口拆开逐层看看到底问题出在哪个环节";
    const pc = supplyDemandBlockPC(28.5);
    const a = renderNavigationSlice(projectNavigationSlice(q, pc, scope));
    const b = renderNavigationSlice(projectNavigationSlice(q, pc, scope));
    expect(a).toBe(b); // R6 确定性字节一致（无 LLM/时钟/随机）
    expect(a.length).toBeGreaterThan(0);
    // DRIL 语义：为开放问句检索出对口 solver（供需族）喂给 agent（非空图）。
    const keys = navigationSliceSolverKeys(projectNavigationSlice(q, pc, scope));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain("gap_attribution");
  });

  it("不同域开放问句 → 检索出不同对口 solver（有牙·非写死一张全局图）", () => {
    const quality = navigationSliceSolverKeys(
      projectNavigationSlice("良率为什么波动、哪个工序卡了", undefined, {
        objectTypes: ["Process", "Equipment", "QualityStandard"],
        toolNames: ["query_objects", "invoke_solver"],
      }),
    );
    const credit = navigationSliceSolverKeys(
      projectNavigationSlice("商用车集团G信用敞口还有多少额度", undefined, {
        objectTypes: ["Customer", "Order"],
        toolNames: ["query_objects", "invoke_solver"],
      }),
    );
    expect(quality).toContain("yield_diagnosis");
    expect(credit).toContain("credit_exposure");
    expect(quality).not.toEqual(credit);
  });

  // TODO[待 WO-DRIL-P2/P3/P4 + 真 LLM 部署态解封]：开放题真经分类器 outOfCatalog → DRIL 检索 → agent 命中检索资源出答。
  it.skipIf(!REAL_LLM)("[真 LLM] 开放长尾自由问 → 分类 outOfCatalog → DRIL 检索 → agent 出答（S2/S3 端到端）", async () => {
    const t = await createTestApp({ env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "" } });
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
    const pc = supplyDemandBlockPC(28.5);
    const { taskId } = await submitQuery(t, ADMIN, "把这块供需缺口拆开逐层看看到底问题出在哪个环节", { view: "dashboard", pageContext: pc });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    await t.app.close();
  });
});

// =====================================================================================
// S4/S7 · CEO 深问 agent → solver + 结构化决策输出（scripted path-B·真绿）
// 契约 S4：agent 涉算题真调 solver（Solver-first·不自己算）。
// 契约 S7：final_answer 含 结论/证据/建议/风险 + 每业务数字 ⟦ref:N⟧（provenance 校验真跑）。
// =====================================================================================
describe("S4/S7 · CEO 深问 agent 调 solver + 决策结构化接地输出（scripted 真接线·真绿）", () => {
  async function runCeoDeep(t: TestApp) {
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]); // 显式暗发开 → path-B 真 agent 循环
    t.llm.queueAgentTurn(...ceoDecisionTurns());
    const pc = supplyDemandBlockPC(28.5);
    const { taskId } = await submitQuery(t, ADMIN, "综合分析这块供需失衡的根因和应对方案有哪些风险", { view: "dashboard", pageContext: pc });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const calls = await t.repos.toolCalls.listByTask(taskId);
    return { task, calls };
  }

  it("S4：agent 真进 path-B 循环并调 invoke_solver（Solver-first·非自己算）", async () => {
    const t = await createTestApp();
    const { task, calls } = await runCeoDeep(t);
    expect(task.path).toBe("AGENT"); // 真 path-B（非确定性单跳）
    const seq = calls.map((c) => c.toolName);
    expect(seq).toContain("invoke_solver"); // 涉算题真落 solver
    await t.app.close();
  });

  it("S7：final_answer 结构含 结论/证据/建议/风险 + 每业务数字 ⟦ref:N⟧（接地口径·provenance 真校验）", async () => {
    const t = await createTestApp();
    const { task } = await runCeoDeep(t);
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    // 决策四段结构（S7）。
    expect(md).toContain("结论");
    expect(md).toContain("证据");
    expect(md).toContain("建议");
    expect(md).toContain("风险");
    // 数字接地：业务数字带 ⟦ref:N⟧（产品侧 provenance 校验/保留真跑·非散文裸数）。
    expect(md).toMatch(/⟦ref:\d+⟧/);
    expect(task.answer?.trustLevel).toBe("AGENT_EXPLORATORY"); // 真 LLM 探索输出·不冒充 VERIFIED
    await t.app.close();
  });

  // TODO[待部署态真 provider 解封]：真 LLM 自生成 CEO 深问答案含 结论/证据/建议/风险 + 接地。
  it.skipIf(!REAL_LLM)("[真 LLM] CEO 深问真出结论/证据/建议/风险 + ⟦ref⟧接地（S4/S7 端到端）", async () => {
    const t = await createTestApp({ env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "" } });
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
    const pc = supplyDemandBlockPC(28.5);
    const { taskId } = await submitQuery(t, ADMIN, "综合分析这块供需失衡的根因和应对方案有哪些风险", { view: "dashboard", pageContext: pc });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md.length).toBeGreaterThan(0);
    expect(md).toMatch(/⟦ref:\d+⟧/);
    await t.app.close();
  });
});

// =====================================================================================
// S5 · solver → 数据·EMPTY_DATA/NO_INTENT → growth 自动补（databuilder-harness 已落·真绿）
// 契约：solver 出真数据；EMPTY_DATA/NO_INTENT → 触发 growth 诊断 + 补齐建议（不是天花板·是一环）。
// 观测端点：POST /api/v1/growth/probe（诊断 gapCode）+ /api/v1/growth/run（补齐 LOOP）。
// =====================================================================================
describe("S5 · 缺数据自动补：growth probe 诊断 + 补齐建议（端到端真绿·databuilder-harness）", () => {
  it("/api/v1/growth/probe 开放题真跑 orchestrator → 结构化 GapReport 诊断触发（findings 非空·非天花板）", async () => {
    const t = await createTestApp();
    // 开放题：分类 outOfCatalog → path-B 探索 → 终态 → classifyGap 诊断为 NO_INTENT（BOUNDARY·可补）。
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [text("探索"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "探索作答" }], provenance: [] })] });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/growth/probe",
      headers: H,
      payload: { packageId: PKG, query: "常州基地设备OEE与物流时长未来30天逐日时序推演", context: { view: "dash", selectedObjects: [], filters: {} } },
    });
    expect(res.statusCode).toBe(200);
    const report = res.json() as { verdict: string; path: string; findings: { gapCode: string }[] };
    // S5 命门：对话失败/边界真触发 growth 诊断（引擎知道缺什么·非静默"到天花板"）。
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings[0]!.gapCode).toBe("NO_INTENT");
    expect(report.verdict).toBe("BOUNDARY");
    await t.app.close();
  });

  it("/api/v1/growth/run NO_INTENT 题 → advanced:true 自补 DRAFT 意图草稿（补齐前进·非恒骨架工单）", async () => {
    const t = await createTestApp();
    const q = "常州基地设备OEE与物流时长未来30天逐日时序推演";
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [text("探索"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "探索作答" }], provenance: [] })] });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/growth/run",
      headers: H,
      payload: { ...body(q, { view: "dash", selectedObjects: [], filters: {} }), maxRounds: 2 },
    });
    expect(res.statusCode).toBe(200);
    const report = res.json() as {
      terminalState: string;
      rounds: { gapReport: { findings: { gapCode: string }[] }; fillApplied?: { gapCode: string; advanced: boolean; scaffolded?: { kind: string; key: string }[] } }[];
    };
    const r0 = report.rounds[0]!;
    expect(r0.gapReport.findings[0]!.gapCode).toBe("NO_INTENT");
    expect(r0.fillApplied!.advanced).toBe(true); // 自补前进（非 advanced:false 骨架）
    expect(r0.fillApplied!.scaffolded!.some((d) => d.kind === "intent")).toBe(true); // 产出 DRAFT 意图草稿
    await t.app.close();
  });

  it("EMPTY_DATA 时序题（无具体实体）→ SOFT 合成 PROVISIONAL 逐日时序补齐建议（标未接实测）", async () => {
    const t = await createTestApp();
    const q = "设备OEE与物流时长未来30天逐日时序推演"; // 无基地名 → decideDataGap SOFT
    const wiring = buildGrowthLoopWiring(t.deps, AUTH, body(q, { view: "dash", selectedObjects: [], filters: {} }), noopEmit);
    const r = await wiring.fill(finding("EMPTY_DATA"));
    // S5 命门：EMPTY_DATA 不是天花板 → 触发补齐建议（SOFT 合成 PROVISIONAL·诚实标未接实测）。
    expect(r.fillMode).toBe("SOFT");
    expect(r.advanced).toBe(true);
    expect(r.action).toContain("PROVISIONAL");
    expect(r.action).toContain("未接实测");
    await t.app.close();
  });

  it("EMPTY_DATA + 真实基地『常州』→ HARD DataRequest 补齐建议·不静默合成（KILL-MOCK 命门）", async () => {
    const t = await createTestApp();
    const q = "常州基地设备OEE未来30天逐日时序推演";
    const wiring = buildGrowthLoopWiring(t.deps, AUTH, body(q, { view: "risk", selectedObjects: [{ objectType: "Base", objectId: "b_cz" }], filters: {} }), noopEmit);
    const r = await wiring.fill(finding("EMPTY_DATA"));
    // 命中真实业务实体 → HARD 走真人正门 DataRequest（拒静默造事实）。
    expect(r.fillMode).toBe("HARD");
    expect(r.advanced).toBe(false);
    expect(r.dataRequest).toBeDefined();
    expect(r.dataRequest!.entities).toContain("常州");
    expect(r.dataRequest!.reason).toContain("不静默合成");
    await t.app.close();
  });
});

// =====================================================================================
// S6 · agent → reflect → 输出（REFLECT-LOOP 未落·base 无 agent/reflect.ts）
// 契约：出口前复盘拦下"未接地/工具静默失败"，重规划。
// 命门纪律：base 未落此依赖 → describe.skip + TODO（骨架立着·诚实标未解封·非删非假绿）。
// =====================================================================================
describe.skip("S6 · agent→reflect→输出（TODO 待 WO-REFLECT-LOOP 合入解封·base 无 agent/reflect.ts）", () => {
  it("[待 WO-REFLECT-LOOP] 出口前 reflect 拦下未接地答案 → 重规划再取证（S6 端到端）", async () => {
    // TODO[待 WO-REFLECT-LOOP]：agent/reflect.ts 落地后，断言 agent 出口前复盘：
    //   ① 检出 final_answer 有裸数无 ⟦ref⟧ / 工具静默失败 → 触发 re-plan；
    //   ② 重规划后补取证 → 出口答案接地率提升。
    // 本 base（379a2039·databuilder-harness）reflect.ts 不存在 → describe.skip 骨架立着（诚实·非假绿）。
    expect(true).toBe(true);
  });
});

// =====================================================================================
// S7 · 数字接地口径（无 LLM 降级态·path-A 确定性）——补充证据
// base 强项：无 LLM provider 时组合路径确定性兜底仍每步 ⟦ref:N⟧（execute-plan.ts:92 deterministicSynthesis）。
// 注：单 solver path-A 预设答案的接地口径由 S4/S7 scripted path-B 段覆盖（provenance 真校验）；
//     此处以 navigation-slice 侧证"接地/溯源标记"贯穿产品侧（R13 派生投影非新真值源）。
// =====================================================================================
describe("S7 · 接地口径贯穿（补充·真绿）", () => {
  it("答案结构骨架：COMPLETED 任务 answer 必有 blocks 数组 + trustLevel（结构口径存在·非空壳）", async () => {
    const t = await createTestApp();
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.92 }],
      outOfCatalog: false,
      extractedSlots: { baseId: "changzhou" },
    });
    const { taskId } = await submitQuery(t, ADMIN, "常州基地影响哪些订单", {
      view: "risk",
      selectedObjects: [{ objectType: "Base", objectId: "changzhou" }],
    });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(Array.isArray(task.answer?.blocks)).toBe(true);
    expect(task.answer?.trustLevel).toBeDefined(); // 信任级别口径存在（VERIFIED/EXPLORATORY 诚实标）
    await t.app.close();
  });
});
