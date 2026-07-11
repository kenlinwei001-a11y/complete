import { describe, expect, it } from "vitest";
import type { PropagationRule, PropagationTrace, SandboxViewConfig } from "@platform/contracts";
import { simTickTimeLabel } from "@/locales/zh";
import { computeNodeAttribution } from "@/views/sim/SandboxView";

/**
 * WO-SANDBOX-TICK-CALENDAR（S5·纯前端消费既有 trace）：
 *  ① tick↔业务时间：curTick(模拟日)→「第 N 天/周」人话标（R6 纯换算·R14 配置驱动·无 Date.now）。
 *  ② 节点归因「为什么红」：末次 tick trace 中传入本类型对象的贡献·join propRules 取真系数/延迟（R13/G-10·非造）·无 trace 诚实空。
 */

describe("simTickTimeLabel · tick↔业务时间（R6 纯换算·未提供 tickUnit 退默认 day/1）", () => {
  it("day/week/milestone + 默认", () => {
    expect(simTickTimeLabel(3)).toBe("第 3 天"); // 默认 day/1·<7 天
    expect(simTickTimeLabel(14)).toBe("第 14 天 · 第 2 周"); // ≥7 天补周
    expect(simTickTimeLabel(2, { unit: "week", perTick: 7 })).toBe("第 2 周（第 14 天）"); // perTick=7·week 主显
    expect(simTickTimeLabel(3, { unit: "milestone", perTick: 1 })).toBe("第 3 个里程碑");
    expect(simTickTimeLabel(0)).toBe("第 0 天");
  });
});

const CFG = {
  nodeObjectIds: { Base: ["obj_base_changzhou", "obj_base_wuhan"], Model: ["obj_model_ncm"] },
} as unknown as SandboxViewConfig;

const RULES = [
  { key: "demo_model_to_base", coefficient: 0.6, delayTicks: 0 },
  { key: "demo_line_to_base", coefficient: 0.5, delayTicks: 1 },
] as unknown as PropagationRule[];

const TRACE: PropagationTrace[] = [
  { ruleKey: "demo_model_to_base", fromObjectId: "obj_model_ncm", toObjectId: "obj_base_changzhou", amount: 12.5, viaLinkKey: "model_producible_at" },
  { ruleKey: "demo_line_to_base", fromObjectId: "obj_line_l1", toObjectId: "obj_base_changzhou", amount: 3.2, viaLinkKey: "line_belongs_to_base" },
  { ruleKey: "demo_model_to_base", fromObjectId: "obj_model_ncm", toObjectId: "obj_base_wuhan", amount: 8.0, viaLinkKey: "model_producible_at" },
];

describe("computeNodeAttribution · 节点归因（消费真 trace·join propRules 真系数·R13/G-10·绝不编造）", () => {
  it("Base 类型归因：filter toObjectId∈Base 对象 + join 系数/延迟", () => {
    const attr = computeNodeAttribution("Base", CFG, TRACE, RULES);
    expect(attr.length).toBe(3); // 2 常州 + 1 武汉（均 Base 对象）
    const cz = attr.find((a) => a.fromObjectId === "obj_model_ncm" && a.ruleKey === "demo_model_to_base");
    expect(cz?.coefficient).toBe(0.6); // 真 join propRules
    expect(cz?.delayTicks).toBe(0);
    expect(cz?.amount).toBe(12.5); // 真 trace amount
    const line = attr.find((a) => a.ruleKey === "demo_line_to_base");
    expect(line?.coefficient).toBe(0.5);
    expect(line?.delayTicks).toBe(1);
  });

  it("规则不在 propRules → 系数/延迟诚实 null（不臆造·G-10）", () => {
    const attr = computeNodeAttribution("Base", CFG, [
      { ruleKey: "unknown_rule", fromObjectId: "x", toObjectId: "obj_base_changzhou", amount: 1, viaLinkKey: "v" },
    ], RULES);
    expect(attr.length).toBe(1);
    expect(attr[0]!.coefficient).toBeNull();
    expect(attr[0]!.delayTicks).toBeNull();
  });

  it("无 trace / 该类型无贡献 → 空数组（诚实空态·非造）", () => {
    expect(computeNodeAttribution("Base", CFG, [], RULES)).toEqual([]);
    expect(computeNodeAttribution("Model", CFG, TRACE, RULES)).toEqual([]); // trace 无 toObjectId∈Model
  });
});
