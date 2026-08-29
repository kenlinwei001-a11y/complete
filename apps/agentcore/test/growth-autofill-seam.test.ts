import { beforeEach, describe, expect, it } from "vitest";
import type { GapFinding, SubmitQueryBody } from "@platform/contracts";
import { createTestApp, PKG, PLANNER, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { buildGrowthLoopWiring } from "../src/growth/scenario-grow.js";
import { questionSlug } from "../src/growth/scaffold.js";

/**
 * WO-DATABUILDER-HARNESS · SEAM（接缝驱动·LLM mock·确定性 R6）：数据构建"agent"从一次性抽取升级为
 * 会诊断+补齐的 harness——三层弱点逐一驱动，断言 gapCode **前进**（非恒 BOUNDARY 骨架工单）。
 *
 * 头号判据（SEAM-GATE）= 接缝驱动通，非各半绿：
 *  ① NO_INTENT（意图路由层·命门起点）：诊断出 NO_INTENT → 自补 DRAFT 意图（绑 generic_inference 兜底计划）
 *     → advanced:true + 意图草稿产出（DRAFT·待审批 R4），非落 else 骨架工单（advanced:false）。
 *  ② EMPTY_DATA 时序（无具体实体·灰节点）→ SOFT 经管线合成 PROVISIONAL 逐日时序（标"未接实测"）。
 *  ③ EMPTY_DATA + 真实基地（命中 groundingVocab）→ HARD DataRequest·**不静默合成**（断言无 fillData 调用·KILL-MOCK 命门）。
 */
const H = { "x-debug-user": PLANNER, "content-type": "application/json" };
const AUTH = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
const noopEmit = async (): Promise<void> => {};
const finding = (gapCode: GapFinding["gapCode"]): GapFinding => ({ gapCode, evidence: "empty slice", suggestedFill: "f", blocking: true });
const body = (query: string, context: SubmitQueryBody["context"]): SubmitQueryBody => ({ packageId: PKG, query, context });

describe("SEAM ① NO_INTENT 自补（意图路由层·命门起点·与 NO_PLAN 同口径）", () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it("NO_INTENT query → run → advanced:true + DRAFT 意图草稿产出（待审批 R4·非落 else 骨架工单）", async () => {
    const q = "常州基地设备OEE与物流时长未来30天逐日时序推演";
    // 分类无候选命中 → 路径B agent 兜底作答（本体外）→ classifyGap = NO_INTENT。
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [text("探索"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "探索作答" }], provenance: [] })] });

    const res = await t.app.inject({
      method: "POST", url: "/api/v1/growth/run", headers: H,
      payload: { ...body(q, { view: "dash", selectedObjects: [], filters: {} }), maxRounds: 2 },
    });
    expect(res.statusCode).toBe(200);
    const report = res.json() as {
      terminalState: string;
      rounds: { gapReport: { findings: { gapCode: string }[] }; fillApplied?: { gapCode: string; advanced: boolean; scaffolded?: { kind: string; key: string }[] } }[];
    };

    // 命门：诊断出 NO_INTENT 且**自补前进**（advanced:true）——非恒 advanced:false 骨架工单。
    const r0 = report.rounds[0]!;
    expect(r0.gapReport.findings[0]!.gapCode).toBe("NO_INTENT");
    expect(r0.fillApplied!.gapCode).toBe("NO_INTENT");
    expect(r0.fillApplied!.advanced).toBe(true);
    // 产出 DRAFT 意图草稿（+ 首建兜底计划）。
    const intentDraft = r0.fillApplied!.scaffolded!.find((d) => d.kind === "intent");
    expect(intentDraft).toBeDefined();
    expect(intentDraft!.key).toBe(`intent_growth_${questionSlug(q)}`);

    // R4：意图真落库为 DRAFT（不自动发布→不进分类候选→活体路由不被污染）。
    const intents = await t.repos.intents.listByPackage(PKG);
    const made = intents.find((i) => i.key === `intent_growth_${questionSlug(q)}`);
    expect(made).toBeDefined();
    expect(made!.status).toBe("DRAFT");
    expect(made!.examples).toContain(q.slice(0, 200));
    expect(made!.planRef?.planKey).toBe(`plan_growth_${questionSlug(q)}`);
    // 绑的兜底 DRAFT 计划也在（generic_inference）。
    const plan = (await t.repos.plans.listByPackage(PKG)).find((p) => p.key === `plan_growth_${questionSlug(q)}`);
    expect(plan!.status).toBe("DRAFT");

    // DRAFT 未发布（R4 墙·同 O9）→ 有界收敛开票（施工=审批发布/补槽，非从零）。
    expect(report.terminalState).toBe("BOUNDARY");
  });

  it("幂等（R6）：scaffoldedByGap 命中 → 二次 fill 不重建，同问句同 slug", async () => {
    const q = "储能基地未来60天产能缺口时序";
    const wiring = buildGrowthLoopWiring(t.deps, AUTH, body(q, { view: "dash", selectedObjects: [], filters: {} }), noopEmit);
    const first = await wiring.fill(finding("NO_INTENT"));
    expect(first.advanced).toBe(true);
    expect(first.scaffolded!.some((d) => d.kind === "intent")).toBe(true);
    // 二次（同 wiring·scaffoldedByGap 已缓存）→ 不重建、不再 advanced（已就绪）。
    const second = await wiring.fill(finding("NO_INTENT"));
    expect(second.advanced).toBe(false);
    // 意图仅一条（幂等）。
    const intents = await t.repos.intents.listByPackage(PKG);
    expect(intents.filter((i) => i.key === `intent_growth_${questionSlug(q)}`).length).toBe(1);
  });
});

describe("SEAM ②③ EMPTY_DATA 时序自补（灰节点·KILL-MOCK 命门）", () => {
  let t: TestApp;
  let fillCalls: { typeKey: string; fields: string[] }[];

  beforeEach(async () => {
    t = await createTestApp();
    fillCalls = [];
    const orig = t.deps.dataCore.ontology.fillData.bind(t.deps.dataCore.ontology);
    // 侦测 fillData 调用（③ 断言真实体绝不静默合成 = 零调用）。
    t.deps.dataCore.ontology.fillData = async (ctx, req) => {
      fillCalls.push({ typeKey: req.typeKey, fields: req.fields });
      return orig(ctx, req);
    };
  });

  it("② 无具体实体的时序 query → SOFT 合成 PROVISIONAL 逐日时序（标未接实测）", async () => {
    // 无基地/细分名 → decideDataGap SOFT；含"逐日/时序/未来" → 时序维度。
    const q = "设备OEE与物流时长未来30天逐日时序推演";
    const wiring = buildGrowthLoopWiring(t.deps, AUTH, body(q, { view: "dash", selectedObjects: [], filters: {} }), noopEmit);
    const r = await wiring.fill(finding("EMPTY_DATA"));

    expect(r.fillMode).toBe("SOFT");
    expect(r.advanced).toBe(true);
    expect(r.action).toContain("未接实测");
    expect(r.action).toContain("PROVISIONAL");
    expect(r.dataRequest).toBeUndefined(); // SOFT 不出 DataRequest
    // 真合成一次·且形状为"时间维度序列"（ts 列）。
    expect(fillCalls.length).toBe(1);
    expect(fillCalls[0]!.fields).toContain("ts");
  });

  it("③ EMPTY_DATA + 真实基地「常州」→ HARD DataRequest·**不静默合成**（零 fillData 调用·KILL-MOCK）", async () => {
    const q = "常州基地设备OEE未来30天逐日时序推演";
    const wiring = buildGrowthLoopWiring(t.deps, AUTH, body(q, { view: "risk", selectedObjects: [{ objectType: "Base", objectId: "b_cz" }], filters: {} }), noopEmit);
    const r = await wiring.fill(finding("EMPTY_DATA"));

    expect(r.fillMode).toBe("HARD");
    expect(r.advanced).toBe(false); // HARD 不自动前进：剩真人给真实数据
    // 命门断言：真实体绝不静默合成 → 零 fillData 调用。
    expect(fillCalls.length).toBe(0);
    // 出精确 DataRequest 走真人正门（连接器/上传→Action 审批）。
    expect(r.dataRequest).toBeDefined();
    expect(r.dataRequest!.typeKey).toBe("Base");
    expect(r.dataRequest!.entities).toContain("常州");
    expect(r.dataRequest!.reason).toContain("不静默合成");
    expect(r.dataRequest!.reason).toContain("逐日时序"); // 时序维度接地：声明须补真实逐日时序
    expect(r.ticket).toBeDefined();
  });
});
