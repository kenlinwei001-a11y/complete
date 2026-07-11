import { describe, expect, it } from "vitest";
import { DecisionCaseSchema } from "@platform/contracts";
import {
  projectCase,
  extractFeatures,
  validateCaseFeatures,
  pseudoEmbed,
  cosine,
  VALID_PROBLEM_CLASSES,
  type DecisionArtifact,
} from "../src/memory/decision-case.js";

/**
 * WO-L1.5-1 齿（§4.1 / acceptance ①②③④）：
 *  ① projectCase 契约合法 + R6 双跑字节一致（V6①）；
 *  ② 特征键 ∈ 真实注册表（PROBLEM_CLASS 经 problemClassForIntent·零幽灵）；
 *  ③ validateCaseFeatures green→red（注入幽灵 PROBLEM_CLASS 必报·KILL-MOCK-RED）；
 *  ④ pseudoEmbed 确定性 + cosine ∈[0,1]。
 */

const artifact: DecisionArtifact = {
  source: "DECISION",
  refId: "dec_1",
  title: "常州基地PACK02降产·订单延期",
  context: "未来30天常州基地PACK02产线降低20%产能 2026-08-01 交付风险",
  options: [
    { key: "delay", label: "延期" },
    { key: "outsource", label: "外协" },
  ],
  chosen: "delay",
  rejectedRationale: [{ optionKey: "outsource", rationale: "外协比过高" }],
  predicted: { summary: "延期5天", metrics: { deliveryRate: 0.92 } },
  ctx: { taskId: "task_1", intentKey: "affected_orders", entities: ["BASE_CZ", "Line:PACK02"], metrics: ["deliveryRate"] },
};
const opts = { tenantId: "demo", now: "2026-07-11T00:00:00.000Z" };

describe("WO-L1.5-1 · CBR 契约 + 特征抽取 + 案例投影", () => {
  it("① projectCase 契约合法 + R6 双跑字节一致", () => {
    const c1 = projectCase(artifact, opts);
    DecisionCaseSchema.parse(c1);
    const c2 = projectCase(artifact, opts);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
    // 溯源 + 诚实位
    expect(c1.provenance).toBe("dec_1");
    expect(c1.origin).toBe("LEARNED"); // source=DECISION → LEARNED
    expect(c1.disclaimer.length).toBeGreaterThan(0);
    expect(c1.caseId).toMatch(/^case_[0-9a-f]{8}$/);
  });

  it("② PROBLEM_CLASS 键 ∈ 真实注册表（affected_orders→affected_scope_enumeration）", () => {
    const features = extractFeatures(artifact);
    const pc = features.find((f) => f.dim === "PROBLEM_CLASS")!;
    expect(pc.key).toBe("affected_scope_enumeration"); // INTENT_PROBLEM_CLASS[affected_orders]
    expect(VALID_PROBLEM_CLASSES.has(pc.key)).toBe(true);
    // 决策/受影响维有据
    expect(features.some((f) => f.dim === "ACTION_TYPE" && f.key === "delay")).toBe(true);
    expect(features.some((f) => f.dim === "ENTITY" && f.key === "BASE_CZ")).toBe(true);
    expect(features.some((f) => f.dim === "METRIC" && f.key === "deliveryRate")).toBe(true);
    expect(features.some((f) => f.dim === "TEMPORAL" && f.key === "horizon_30d")).toBe(true);
    expect(validateCaseFeatures(features)).toEqual([]);
  });

  it("② 未知 intentKey → unknown_intent（诚实归口·非静默幽灵）", () => {
    const c = projectCase({ ...artifact, ctx: { intentKey: "nonexistent_intent_zzz" } }, opts);
    const pc = c.problem.features.find((f) => f.dim === "PROBLEM_CLASS")!;
    expect(pc.key).toBe("unknown_intent");
    expect(VALID_PROBLEM_CLASSES.has(pc.key)).toBe(true);
  });

  it("③ KILL-MOCK green→red：注入幽灵 PROBLEM_CLASS → validateCaseFeatures 必报", () => {
    expect(validateCaseFeatures(extractFeatures(artifact))).toEqual([]); // green
    const ghost = validateCaseFeatures([{ dim: "PROBLEM_CLASS", key: "handrolled_ghost", value: null, num: null }]);
    expect(ghost.length).toBeGreaterThan(0);
    expect(ghost[0]).toMatch(/幽灵特征/);
  });

  it("④ pseudoEmbed 确定性 + cosine ∈[0,1]（同域近·异域远）", () => {
    const a = pseudoEmbed("常州基地PACK02产线降产");
    const a2 = pseudoEmbed("常州基地PACK02产线降产");
    expect(a).toEqual(a2); // R6
    const near = pseudoEmbed("常州基地PACK02产能不足");
    const far = pseudoEmbed("财务毛利率下降 客户信用敞口");
    expect(cosine(a, a)).toBeCloseTo(1, 5);
    expect(cosine(a, near)).toBeGreaterThan(cosine(a, far));
    expect(cosine(a, far)).toBeGreaterThanOrEqual(0);
  });
});
