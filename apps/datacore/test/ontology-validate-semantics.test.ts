import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import type { AuthCtx, ObjectTypeDef, PropertyDef } from "../src/domain.js";
import type { FieldSemanticAnnotation, ScopeRuleViolation, ValidateOutputResult } from "@platform/contracts";

/**
 * WO-ONTOLOGY-CONTEXT-A · SEAM-GATE（缺口③·A-半消费者）
 *
 * 证明：A 侧输出校验消费者（POST /a/v1/ontology/validate-output）真正**用上**了 type-semantics 口径单一真值——
 *   (a) 逐字段附 unit/formula 口径注解（此前 unit/口径 只喂 B 的 LLM prompt，A 自身输出从不用）；
 *   (b) 值越过 scope 规则口径线（表达式为真=命中违规）→ 标记 ruleViolations。
 * 且这是**接线到本体单一真值**、非快照：MUTATE 口径真值（本体 upsertType unit %→pct/改派生 formula + 规则 C03 >0.5→>0.8 + publish）
 * 后再跑 **同一** 调用，注解与规则判定随之变——A-side 版的 apps/agentcore/test/ontology-context.test.ts（B-半接缝）。
 *
 * 关键红线（守 agentcore 执行器契约）：scope 规则命中**不改 ok/violations**——ok 仍只由 REJECT 级结构违规决定，
 * 否则 executor.ts 会据此开始拒它此前接受的行（行为漂移）。故断言两次调用 ok 恒为 true。
 */
const ADMIN_CTX: AuthCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };

const prop = (propKey: string, opts: Partial<PropertyDef> = {}): PropertyDef => ({
  propKey,
  dataType: "number",
  isPrimaryKey: false,
  ...opts,
});

/** Metric 类型：actual(单位 %) + target(单位 %) + gap(派生 actual-target)；formula/unit 是本 WO 关注的口径真值。 */
const metricType = (opts: { actualUnit: string; gapFormula: string }): Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status"> => ({
  key: "Metric",
  displayName: "经营指标",
  properties: [
    prop("metricKey", { dataType: "string", isPrimaryKey: true, description: "指标键" }),
    prop("actual", { description: "实际值", unit: opts.actualUnit }),
    prop("target", { description: "目标值", unit: "%" }),
    prop("gap", { description: "缺口" }),
  ],
  derivedProperties: [{ propKey: "gap", formula: opts.gapFormula }],
  sourceBindings: [],
});

/** 播口径本体：Metric（actual unit "%"、gap=actual-target）+ C03「Metric.actual > 0.5」BLOCK 作用于 Metric。 */
async function seedSemanticOntology(t: TestApp): Promise<void> {
  await t.services.ontology.upsertType(ADMIN_CTX, metricType({ actualUnit: "%", gapFormula: "actual - target" }));
  await t.services.ontology.publishVersion(ADMIN_CTX);
  await t.services.rules.create(ADMIN_CTX, {
    key: "C03",
    name: "产能上限约束",
    expression: "Metric.actual > 0.5",
    scopeObjectTypes: ["Metric"],
    severity: "BLOCK",
    status: "PUBLISHED",
  });
}

/** 驱动真实 A 侧消费者：POST /a/v1/ontology/validate-output（含违反 C03 的行）。 */
const validate = async (t: TestApp): Promise<ValidateOutputResult> =>
  (await (
    await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/validate-output",
      headers: ADMIN,
      // actual=0.6 > 0.5 → 命中 C03；结构上干净（PK 在、类型对）→ ok 应为 true
      payload: { objectType: "Metric", rows: [{ metricKey: "m1", actual: 0.6, target: 0.4 }] },
    })
  ).json()) as ValidateOutputResult;

const c03Of = (r: ValidateOutputResult): ScopeRuleViolation | undefined => (r.ruleViolations ?? []).find((rv) => rv.ruleKey === "C03");
const fs = (r: ValidateOutputResult, key: string): FieldSemanticAnnotation | undefined => r.fieldSemantics?.[key];

describe("WO-ONTOLOGY-CONTEXT-A · SEAM：validate-output 消费者据 type-semantics 单一真值产口径注解 + 规则命中（改真值即改判定·非快照）", () => {
  it("(1) 口径注解 unit/formula 落到输出 + 值越 C03 口径线被标记；(2)(3) MUTATE 口径真值后同一调用注解/判定随之变", async () => {
    const t = await makeApp({ seed: false });
    await seedSemanticOntology(t);

    // ── (1) 首跑：口径注解 + C03 命中 ─────────────────────────────────────────
    const before = await validate(t);
    // 结构判定不受影响：行结构干净 → ok 恒 true、无结构 violations（scope 规则不改 ok/violations）
    expect(before.ok).toBe(true);
    expect(before.violations).toHaveLength(0);
    // (a) 逐字段口径注解来自本体单一真值
    expect(fs(before, "actual")?.unit).toBe("%");
    expect(fs(before, "actual")?.dataType).toBe("number");
    expect(fs(before, "actual")?.description).toBe("实际值");
    expect(fs(before, "gap")?.formula).toBe("actual - target");
    // (b) 值 0.6 越过 C03「Metric.actual > 0.5」→ 标记（BLOCK、命中字段 actual、表达式原文）
    const c03Before = c03Of(before);
    expect(c03Before).toBeDefined();
    expect(c03Before!.rowIndex).toBe(0);
    expect(c03Before!.severity).toBe("BLOCK");
    expect(c03Before!.expression).toBe("Metric.actual > 0.5");
    expect(c03Before!.ruleName).toBe("产能上限约束");
    expect(c03Before!.fields).toContain("actual");

    // ── (2) MUTATE 口径单一真值：unit %→pct、改派生 formula；规则 C03 >0.5→>0.8；publish ──
    await t.services.ontology.upsertType(ADMIN_CTX, metricType({ actualUnit: "pct", gapFormula: "target - actual" }));
    await t.services.rules.create(ADMIN_CTX, {
      key: "C03",
      name: "产能上限约束",
      expression: "Metric.actual > 0.8",
      scopeObjectTypes: ["Metric"],
      severity: "BLOCK",
      status: "PUBLISHED",
    });
    await t.services.ontology.publishVersion(ADMIN_CTX);

    // ── (3) 重跑同一调用：注解/判定必须变（证接线到单一真值·非快照）─────────────────
    const after = await validate(t);
    expect(after.ok).toBe(true); // 结构仍干净
    // (a) unit 变：% → pct；formula 变：actual-target → target-actual
    expect(fs(after, "actual")?.unit).toBe("pct");
    expect(fs(after, "gap")?.formula).toBe("target - actual");
    // (b) C03 口径线上移到 0.8，值 0.6 不再越线 → 不再被标记
    expect(c03Of(after)).toBeUndefined();

    // ── 接缝硬断言：前后对照真的变了（漏接线/快照会让二者相等，红）──────────────
    expect(fs(after, "actual")?.unit).not.toBe(fs(before, "actual")?.unit);
    expect(fs(after, "gap")?.formula).not.toBe(fs(before, "gap")?.formula);
    expect(c03Of(before)).toBeDefined();
    expect(c03Of(after)).toBeUndefined();
  });

  it("未传 semantics 的既有调用逐字节兼容：modeling.ts 隔离区路径（3 参）不含 fieldSemantics/ruleViolations", async () => {
    // 直接单测纯函数的 3-参形态（modeling.ts:516 的调用形态），证 additive 字段在无 semantics 时整体省略。
    const { validateOutputAgainstOntology } = await import("../src/ontology-validate.js");
    const { ValidationPolicySchema } = await import("@platform/contracts");
    const typeDef = {
      key: "Metric", tenantId: "demo", displayName: "经营指标", domain: "biz",
      properties: [prop("metricKey", { dataType: "string", isPrimaryKey: true }), prop("actual")],
      derivedProperties: [],
    } as unknown as ObjectTypeDef;
    const r = validateOutputAgainstOntology([{ metricKey: "m1", actual: 0.9 }], typeDef, ValidationPolicySchema.parse({}));
    expect(r.ok).toBe(true);
    expect(r.fieldSemantics).toBeUndefined();
    expect(r.ruleViolations).toBeUndefined();
  });
});
