import { describe, expect, it } from "vitest";
import { ClosurePolicySchema, BuildPlanSchema, type BuildPlan } from "@platform/contracts";
import { validateClosure } from "../src/databuilder/closure.js";
import { checkDomainInvariants, DOMAIN_INVARIANT_CODE, DOMAIN_ROOT_REQUIREMENTS } from "../src/databuilder/domain-invariants.js";
import { comprehendScript } from "../src/databuilder/comprehend.js";

/**
 * 增量2 · E14 域运营本体不变量（数据驱动 RL5，确定性 R6）。
 * - 倒推出孤儿运营域对象（无 factory 根可达）→ closure 报 DOMAIN_INVARIANT_VIOLATION:ORPHAN_NO_ROOT（非静默）。
 * - 关键词地板对运营故事自动补根 → 倒推出的对象树域完整（不再产无根碎片）。
 * - 约束是数据（DOMAIN_ROOT_REQUIREMENTS）非代码：零业务/实体常数。
 */

const policy = ClosurePolicySchema.parse({ object: {}, data: {}, forward: {} });

/** 运营域对象（process）但无 factory 根 + 无 ref 链 = 无根碎片（模拟 LLM 产碎片树）。 */
function orphanProcessPlan(): BuildPlan {
  return BuildPlanSchema.parse({
    id: "bpl_e14", tenantId: "demo", builderKey: "t", scriptHash: "h", seed: 1, script: "",
    dataSources: [], rules: [], kbDocs: [], solverNeeds: [], createdAt: "2026-01-01",
    objectTypes: [
      { typeKey: "Process", displayName: "工序", domain: "process", properties: [{ propKey: "procId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number" }] },
    ],
  });
}

describe("增量2 · E14 域不变量（约束是数据）", () => {
  it("DOMAIN_ROOT_REQUIREMENTS 仅用 domain 词表（零实体/行业常数）—— 值都是 domain 名", () => {
    const domainTokens = new Set(["factory", "product", "process", "equip", "people", "quality", "capacity", "forecast", "sales", "material", "finance", "plan", "external"]);
    for (const [k, roots] of Object.entries(DOMAIN_ROOT_REQUIREMENTS)) {
      expect(domainTokens.has(k)).toBe(true);
      for (const r of roots) expect(domainTokens.has(r)).toBe(true);
    }
  });

  it("孤儿 Process（无 factory 根）→ ORPHAN_NO_ROOT finding 被surface（OBJECT/SOFT ORPHAN_PASSED，非静默）", () => {
    // 评审校正：无根 = 倒推可能不完整的**信号**，非"此域不可建"的事实 → SOFT 记录（surface 进 GapReport），
    // 不 HARD 阻断合法最小域（如 LLM 只产 Proc+Ord、不建全工厂）。仍非静默（finding 在、可观测）。
    const findings = checkDomainInvariants(orphanProcessPlan());
    const orphan = findings.find((f) => String(f.detail).includes("ORPHAN_NO_ROOT"));
    expect(orphan).toBeDefined();
    expect(orphan!.kind).toBe("OBJECT");
    expect(orphan!.status).toBe("ORPHAN_PASSED");
    expect(orphan!.detail).toContain(DOMAIN_INVARIANT_CODE);
  });

  it("STRICT 闭包：孤儿运营对象不 HARD 阻断合法最小域（gatePassed=true），但 ORPHAN_NO_ROOT 进 findings（非静默 surface）", () => {
    const r = validateClosure(orphanProcessPlan(), policy, "STRICT");
    expect(r.blocked).toBe(false);
    expect(r.gatePassed).toBe(true); // 合法最小域可建——E14 无根碎片是 advisory 信号，不误杀
    expect(r.findings.some((f) => String(f.detail).includes("ORPHAN_NO_ROOT"))).toBe(true); // 仍 surface，不静默
  });

  it("地板补根：运营故事（工序/瓶颈/设备）倒推 → 自动拉入 factory 根 + 域完整（无 ORPHAN_NO_ROOT）", () => {
    const NOVEL = "某条化成工序共享一台瓶颈设备，故障时下游订单被迫降级，按优先级哪些订单受影响、毛利损失多少";
    const body = comprehendScript(NOVEL, 42);
    const plan = BuildPlanSchema.parse({ id: "bpl_x", tenantId: "demo", builderKey: "t", scriptHash: "h", seed: 42, script: NOVEL, createdAt: "2026-01-01", ...body });
    // factory 根域对象被补入（Base）。
    expect(plan.objectTypes.some((t) => t.domain === "factory")).toBe(true);
    // 运营域对象（process/equip）都能经 ref 链到 factory 根 → 无 ORPHAN_NO_ROOT。
    const findings = checkDomainInvariants(plan);
    expect(findings.some((f) => String(f.detail).includes("ORPHAN_NO_ROOT"))).toBe(false);
    // 闭包通过（域完整）。
    const r = validateClosure(plan, policy, "STRICT");
    expect(r.gatePassed).toBe(true);
  });

  it("确定性 R6：同 (script, seed) 两次 comprehend → 域补全结果字节级一致", () => {
    const NOVEL = "工序瓶颈导致设备争用，排产降级";
    const a = JSON.stringify(comprehendScript(NOVEL, 7).objectTypes);
    const b = JSON.stringify(comprehendScript(NOVEL, 7).objectTypes);
    expect(a).toBe(b);
  });
});
