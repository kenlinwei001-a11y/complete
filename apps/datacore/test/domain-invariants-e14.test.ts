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

  it("孤儿 Process（无 factory 根）→ ORPHAN_NO_ROOT finding（OBJECT/FAILED，非静默）", () => {
    const findings = checkDomainInvariants(orphanProcessPlan());
    const orphan = findings.find((f) => String(f.detail).includes("ORPHAN_NO_ROOT"));
    expect(orphan).toBeDefined();
    expect(orphan!.kind).toBe("OBJECT");
    expect(orphan!.status).toBe("FAILED");
    expect(orphan!.detail).toContain(DOMAIN_INVARIANT_CODE);
  });

  it("STRICT 闭包：孤儿运营对象 → gatePassed=false + blocked=true（碎片树被挡，不静默通过）", () => {
    const r = validateClosure(orphanProcessPlan(), policy, "STRICT");
    expect(r.gatePassed).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.findings.some((f) => String(f.detail).includes("ORPHAN_NO_ROOT") && f.status === "FAILED")).toBe(true);
  });

  it("PROVISIONAL 闭包：同碎片 → 降 ADVISORY、blocked=false（如实记录、不靠阻断成 0），gatePassed 诚实=false", () => {
    const r = validateClosure(orphanProcessPlan(), policy, "PROVISIONAL");
    expect(r.blocked).toBe(false);
    expect(r.gatePassed).toBe(false);
    const dom = r.findings.find((f) => String(f.detail).includes("ORPHAN_NO_ROOT"));
    expect(dom!.severity).toBe("ADVISORY");
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
