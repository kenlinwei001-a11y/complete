import { describe, expect, it } from "vitest";
import { riskTimeline, resolveTensionThreshold } from "../src/solvers/risk.js";
import { BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import type { SolverContext, SolverParamsShape } from "../src/solvers/types.js";

/**
 * RISKBOARD-RULES-AGENTS 牙齿（C1·用户亲定·铁律0.6）：风险推演链的越线日/轨迹/处置计划由**真规则仓 + 可校准参数**驱动，
 * 非写死系数/标签。回退到"越线阈值内联写死 / 决策偏移内联魔数 / 规则号只是裸标签"即红。
 *
 * 覆盖：
 *  齿A 越线阈值由真规则算：携 tensionThreshold param 的已发布规则 → 越线日随之变（revert 真规则接线 → 越线日回写死 85 → 红）。
 *  齿B 处置计划规则号 → 从规则仓解析真规则（name/expression/severity）；未发布 → null（诚实标·不冒充有定义）。
 *  齿C 处置计划决策偏移（越线前 N 天 / 反提判据 / 备份触发峰值）入 params.risk.plan（改 param 即改·非内联魔数）。
 *  齿D appliedRules 汇总驱动本推演的真规则（越线阈值规则 ⊕ 处置计划规则）。
 */

const LIVE = BATTERY_SOLVER_PARAMS.bottleneck.live; // oeeBase:30, oeeK:220

function mkObj(props: Record<string, unknown>): { id: string; props: Record<string, unknown> } {
  return { id: `obj-${String(props.baseId ?? props.equipId ?? "x")}`, props };
}

type RuleRec = { key: string; name: string; expression: string; severity: "BLOCK" | "WARN" | "INFO"; params?: Record<string, number> };

/** 最小 ctx：1 基地 + 1 设备（oee_current 0.7 → 设备OEE 张力 96·越线）；可注入已发布规则仓 + 覆盖参数。 */
function makeCtx(opts?: { rules?: Record<string, RuleRec>; params?: SolverParamsShape }): SolverContext {
  return {
    tenantId: "t",
    params: opts?.params ?? BATTERY_SOLVER_PARAMS,
    bases: [mkObj({ baseId: "b1", name: "测试基地", util: 0.85 })],
    lines: [],
    processes: [],
    equipment: [mkObj({ equipId: "E0", baseId: "b1", oee_current: 0.7 })],
    maintPlans: [],
    models: [],
    orders: [],
    shipments: [],
    segments: [],
    dataHealth: [],
    certByModel: new Map(),
    demandSegments: [],
    sopVersions: [],
    ...(opts?.rules ? { rules: opts.rules } : {}),
  } as unknown as SolverContext;
}

type Out = {
  threshold: number;
  thresholdRuleKey?: string;
  appliedRules?: { key: string; name: string; expression: string; role: string; params?: Record<string, number> }[];
  cards: { crossDay: number | null; peak: number | null; currentTightness?: { value: number | null } }[];
  planRows?: {
    start: string; det: string; rule: string;
    ruleRef?: { key: string; name: string; expression: string; severity: string; role: string } | null;
  }[];
};

const tension96 = Math.round(LIVE.oeeBase + (1 - 0.7) * LIVE.oeeK); // 96

describe("RISKBOARD-RULES-AGENTS · C1 越线日/轨迹/处置由真规则+可校准参数驱动", () => {
  it("齿A：越线阈值优先由携 tensionThreshold param 的已发布规则算（发布/改该规则 → 越线日随之变·回退写死 85 即红）", () => {
    // 无规则 → 用 SolverParam 默认阈值 85；张力 96 ≥ 85 → 越线日 D+1。
    const base = riskTimeline(makeCtx(), {}) as Out;
    expect(base.threshold).toBe(85);
    expect(base.thresholdRuleKey).toBeUndefined();
    expect(base.cards[0]!.currentTightness?.value).toBe(tension96);
    expect(base.cards[0]!.crossDay).toBe(1); // 96 ≥ 85 → 越线

    // 发布一条携 tensionThreshold=97 的规则 → 越线阈值抬到 97 → 张力 96 < 97 → **不再越线**（越线日由真规则算）。
    const withRule = riskTimeline(
      makeCtx({ rules: { RISK_TENSION: { key: "RISK_TENSION", name: "推演张力越线阈值", expression: "RiskCard.tension >= tensionThreshold", severity: "WARN", params: { tensionThreshold: 97 } } } }),
      {},
    ) as Out;
    expect(withRule.threshold).toBe(97); // 阈值来自规则 param（非写死 85）
    expect(withRule.thresholdRuleKey).toBe("RISK_TENSION");
    expect(withRule.cards[0]!.crossDay).toBeNull(); // 越线日随真规则移动（回退写死 85 → 会仍是 D+1 → 红）

    // 改规则 param 到可越线阈值 70 → 96 ≥ 70 → 又越线 D+1（改 param 即改裁决）。
    const lower = riskTimeline(
      makeCtx({ rules: { RISK_TENSION: { key: "RISK_TENSION", name: "推演张力越线阈值", expression: "RiskCard.tension >= tensionThreshold", severity: "WARN", params: { tensionThreshold: 70 } } } }),
      {},
    ) as Out;
    expect(lower.threshold).toBe(70);
    expect(lower.cards[0]!.crossDay).toBe(1);

    // resolveTensionThreshold 纯函数：无规则回落 param.threshold；有规则取 param 值 + ruleKey。
    expect(resolveTensionThreshold(makeCtx()).value).toBe(85);
    const r = resolveTensionThreshold(makeCtx({ rules: { RISK_TENSION: { key: "RISK_TENSION", name: "n", expression: "e", severity: "WARN", params: { tensionThreshold: 88 } } } }));
    expect(r.value).toBe(88);
    expect(r.ruleKey).toBe("RISK_TENSION");
    expect(r.rule?.role).toBe("越线阈值");
  });

  it("齿B：处置计划 ruleRef 从规则仓解析真规则（name/expression/severity）·未发布 → null（诚实标·不冒充定义）", () => {
    // 未发布 C05/C21 → planRow.rule 仍是溯源号，但 ruleRef=null（诚实：规则仓无定义）。
    const noRules = riskTimeline(makeCtx(), {}) as Out;
    expect((noRules.planRows ?? []).length).toBeGreaterThan(0);
    const r0 = noRules.planRows!.find((r) => r.rule === "C05")!;
    expect(r0.ruleRef).toBeNull(); // 未发布 → null（非冒充有真规则）

    // 发布 C05（真规则表达式）→ ruleRef 携真值（改规则即改推演引用·非写死标签）。
    const c05 = { key: "C05", name: "产线利用率持续越线", expression: "SUSTAIN(Line.utilization > 95, 3)", severity: "WARN" as const };
    const c21 = { key: "C21", name: "产销平衡偏差", expression: "SopVersionRow.balanceDeviationPct > 0.10", severity: "WARN" as const, params: { balanceDeviationPct: 0.1 } };
    const withRules = riskTimeline(makeCtx({ rules: { C05: c05, C21: c21 } }), {}) as Out;
    const row = withRules.planRows!.find((r) => r.rule === "C05")!;
    expect(row.ruleRef).not.toBeNull();
    expect(row.ruleRef!.key).toBe("C05");
    expect(row.ruleRef!.name).toBe("产线利用率持续越线");
    expect(row.ruleRef!.expression).toBe("SUSTAIN(Line.utilization > 95, 3)"); // 规则仓真表达式（回退裸标签 → 缺失即红）
    expect(row.ruleRef!.role).toContain("处置计划");
    // 反提 S&OP 行（cross D+1 ≤ sopReflectDays）→ 引用 C21 真规则。
    const sop = withRules.planRows!.find((r) => r.rule === "C21");
    expect(sop?.ruleRef?.expression).toBe("SopVersionRow.balanceDeviationPct > 0.10");
  });

  it("齿C：处置计划决策偏移（越线前 N 天 / 反提判据 / 备份峰值）入 params.risk.plan（改 param 即改·非内联魔数）", () => {
    const baseRows = (riskTimeline(makeCtx(), {}) as Out).planRows!;
    // 默认：主方案启动文案含"越线前7天"；备份行 det 含"峰值≥90"（峰值 96 ≥ 90）。
    expect(baseRows.some((r) => r.start.includes("越线前7天"))).toBe(true);
    expect(baseRows.some((r) => r.det.includes("峰值≥90"))).toBe(true);
    expect(baseRows.some((r) => r.det.includes("14 天内越线"))).toBe(true); // 反提 S&OP 行·D+1 ≤ 14

    // 覆盖 params.risk.plan（可校准）→ 文案随之变（回退到内联 7/14/90 → 断言红）。
    const p2: SolverParamsShape = JSON.parse(JSON.stringify(BATTERY_SOLVER_PARAMS));
    p2.risk.plan = { leadDays: 10, sopReflectDays: 20, backupPeakThreshold: 99, backupLeadDays: 4, backupTailDays: 8, crossFallbackDays: 14 };
    const rows2 = (riskTimeline(makeCtx({ params: p2 }), {}) as Out).planRows!;
    expect(rows2.some((r) => r.start.includes("越线前10天"))).toBe(true); // leadDays 改 → 启动偏移变
    expect(rows2.some((r) => r.det.includes("20 天内越线"))).toBe(true);   // sopReflectDays 改
    // backupPeakThreshold 抬到 99 > 峰值 96 → 不再出备份行（峰值≥N 判据由 param 驱动）。
    expect(rows2.some((r) => r.det.includes("双保险"))).toBe(false);
  });

  it("齿D：appliedRules 汇总驱动本推演的真规则（越线阈值规则 ⊕ 处置计划规则·去重）", () => {
    const rules = {
      RISK_TENSION: { key: "RISK_TENSION", name: "推演张力越线阈值", expression: "RiskCard.tension >= tensionThreshold", severity: "WARN" as const, params: { tensionThreshold: 70 } },
      C05: { key: "C05", name: "产线利用率持续越线", expression: "SUSTAIN(Line.utilization > 95, 3)", severity: "WARN" as const },
      C21: { key: "C21", name: "产销平衡偏差", expression: "SopVersionRow.balanceDeviationPct > 0.10", severity: "WARN" as const, params: { balanceDeviationPct: 0.1 } },
    };
    const out = riskTimeline(makeCtx({ rules }), {}) as Out;
    const keys = (out.appliedRules ?? []).map((r) => r.key);
    expect(keys).toContain("RISK_TENSION"); // 越线阈值规则
    expect(keys).toContain("C05"); // 处置计划规则
    expect(keys).toContain("C21");
    // 去重（C05 被主方案+备份两行引用，只出现一次）。
    expect(keys.filter((k) => k === "C05").length).toBe(1);
    // 越线阈值规则 role 标注正确。
    expect(out.appliedRules!.find((r) => r.key === "RISK_TENSION")!.role).toBe("越线阈值");
    // 无任何规则 → appliedRules 缺省（不冒充）。
    expect((riskTimeline(makeCtx(), {}) as Out).appliedRules).toBeUndefined();
  });
});
