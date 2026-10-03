import { describe, expect, it } from "vitest";
import {
  computeBaseFreshness, digestSpecCells, fnv1a, specCellIndex, specCellKey, specRefDiffs, todayOfSpecCell,
  worldCellKeys, type BaseSnapshotSource,
} from "../src/sim/spec-cells.js";
import { STATE_VAR_VALUE_REFS } from "../src/synthetic/battery.js";
import type { PropagationRule } from "@platform/contracts";
import type { DerivationSpecRecord } from "../src/domain.js";

/**
 * WO-3ROOT-P2 · 接缝：**规格基值的运行期新鲜度**（`docs/PRD-WO-3ROOT-P2-runtime-rederive.md`）。
 *
 * 咬的是链路两端：
 *   ① **归属**（D1）—— 「这格归不归规格」由 ACTIVE 规格 ∩ 世界量纲空间派生（不是编译期字面量）；
 *   ② **时效**（D2）—— 基值 vs 今天从对象 props 重算的规格真值，逐格 `round(...,6)`、**无容差**；
 *   ③ **三态**（A7）—— 缺源指纹 ⇒ `UNKNOWN`，⛔ 不许读作 FRESH。
 *
 * ⛔ 本档**不**为让新判据变绿而改既有断言；也**不**新增门/棘轮/基线 JSON（仓主禁令 3）。
 */

const spec = (specKey: string, targetType: string, targetProp: string, formula: string, status = "ACTIVE"): DerivationSpecRecord =>
  ({ specKey, targetType, targetProp, formula, status, tenantId: "demo" } as unknown as DerivationSpecRecord);

const rule = (sourceTypeKey: string, sourceStateVar: string, targetTypeKey: string, targetStateVar: string): PropagationRule =>
  ({ sourceTypeKey, sourceStateVar, targetTypeKey, targetStateVar } as unknown as PropagationRule);

describe("WO-3ROOT-P2 · spec-cells（归属 + 时效）", () => {
  it("D1 · 索引 = ACTIVE 规格 ∩ 世界量纲空间：空间外的规格**不许**进索引（widening 守卫）", () => {
    const specs = [
      spec("order_demand_pressure", "Order", "demandPressure", "COALESCE(this.demandDelta * 100, 0)"),
      spec("order_value", "Order", "value", "this.qty * this.unitPrice"), // ← 落点不在世界量纲空间
      spec("retired_one", "Order", "costPressure", "this.creditUsedRatio * 100", "RETIRED"),
    ];
    const universe = worldCellKeys([rule("Model", "demandLoad", "Order", "demandPressure")]);
    const index = specCellIndex(specs, universe);
    expect([...index.keys()]).toEqual(["Order|demandPressure"]);
    // 金丝雀：不带 universe 时另两条**确实**会被收进来 —— 证明上一条不是「恒空」而是过滤生效
    expect(specCellIndex(specs).size).toBe(2);
  });

  it("D1 · refs 对账：specKey 不一致 / 索引里没有 ⇒ 差集非空（沿用既有「绑定断裂」抛错路径）", () => {
    const refKey = Object.keys(STATE_VAR_VALUE_REFS)[0]!;
    const refSpecKey = STATE_VAR_VALUE_REFS[refKey]!.specKey;
    const [typeKey, stateVar] = refKey.split("|") as [string, string];
    const good = specCellIndex([spec(refSpecKey, typeKey, stateVar, "0")]);
    expect(specRefDiffs(good)).toEqual([]); // 正向：对得上 ⇒ 零差集
    // 反向：把 specKey 改掉 ⇒ 必须报出来（不是静默通过）
    const renamed = specCellIndex([spec("some_other_key", typeKey, stateVar, "0")]);
    expect(specRefDiffs(renamed).join("|")).toContain(refKey);
    // 再反向：整条规格缺位 ⇒ 也必须报出来
    expect(specRefDiffs(new Map()).length).toBe(Object.keys(STATE_VAR_VALUE_REFS).length);
  });

  it("D2 · 三态：FRESH / STALE（含逐格明细）/ UNKNOWN；props 撤回 ⇒ 必须回到 FRESH", () => {
    const formule = "COALESCE(this.demandDelta * 100, 0)";
    const specs = [spec("order_demand_pressure", "Order", "demandPressure", formule)];
    const universe = worldCellKeys([rule("Model", "demandLoad", "Order", "demandPressure")]);
    const index = specCellIndex(specs, universe);
    const entry = { objectId: "obj_order_SO-3391", stateVar: "demandPressure", specKey: "order_demand_pressure", baseValue: 60 };
    const source: BaseSnapshotSource = { revision: 7, asOf: "2026-10-03T00:00:00.000Z", specCells: [entry], digest: digestSpecCells([entry]) };
    const baseSnapshot = { "obj_order_SO-3391": { demandPressure: 60, demandDelta: 0.6 } };
    const typeOf = new Map([["obj_order_SO-3391", "Order"]]);
    const withProps = (props: Record<string, unknown>) => new Map([["obj_order_SO-3391", props]]);

    // ① FRESH：源没变（revision 相等 ⇒ 短路）与源变了但逐格相等，两条路都要到 FRESH
    const freshShort = computeBaseFreshness({ source, baseSnapshot, index, typeOf, propsOf: withProps({ demandDelta: 0.6, demandPressure: 60 }), currentRevision: 7 });
    expect(freshShort.state).toBe("FRESH");
    expect(freshShort.staleCellCount).toBe(0);
    const freshScan = computeBaseFreshness({ source, baseSnapshot, index, typeOf, propsOf: withProps({ demandDelta: 0.6, demandPressure: 60 }), currentRevision: 8 });
    expect(freshScan.state).toBe("FRESH"); // ⚠ revision 不等也照样 FRESH ⇒ 判据本体在逐格比对上

    // ② STALE：`demandDelta` 0.6 → 0.9 ⇒ props.demandPressure 60 → 90（E1 的可预言形态）
    const stale = computeBaseFreshness({ source, baseSnapshot, index, typeOf, propsOf: withProps({ demandDelta: 0.9, demandPressure: 90 }), currentRevision: 8 });
    expect(stale.state).toBe("STALE");
    expect(stale.staleCellCount).toBe(1);
    expect(stale.staleCells[0]).toEqual({ objectId: "obj_order_SO-3391", stateVar: "demandPressure", specKey: "order_demand_pressure", baseValue: 60, currentValue: 90 });
    expect(stale.evaluatedCellCount).toBe(index.size);

    // ③ 反向否证（A3）：props 撤回 0.6/60 ⇒ 同一条会话必须回到 FRESH
    const reverted = computeBaseFreshness({ source, baseSnapshot, index, typeOf, propsOf: withProps({ demandDelta: 0.6, demandPressure: 60 }), currentRevision: 9 });
    expect(reverted.state).toBe("FRESH");
    expect(reverted.staleCellCount).toBe(0);

    // ④ UNKNOWN（A7）：缺源指纹 ⇒ 第三态，⛔ 不许读作 FRESH
    const unknown = computeBaseFreshness({ source: null, baseSnapshot, index, typeOf, propsOf: withProps({ demandDelta: 0.9, demandPressure: 90 }), currentRevision: 9 });
    expect(unknown.state).toBe("UNKNOWN");
    expect(unknown.reason).toBeTruthy();
    expect(unknown.staleCellCount).toBe(0);

    // ⑤ 口径（A9）：逐位比、无容差 —— 1e-9 的差也必须报 STALE（存量 339 格舍入差就该红）
    const bitDiff = computeBaseFreshness({ source, baseSnapshot: { "obj_order_SO-3391": { demandPressure: 59.999999999 } }, index, typeOf, propsOf: withProps({ demandDelta: 0.6 }), currentRevision: 9 });
    expect(bitDiff.state).toBe("STALE");
  });

  it("D2 · R6 确定性：digest 无时钟无随机；同输入同输出；换一个基值必换指纹", () => {
    const cells = [{ objectId: "b", stateVar: "y", specKey: "k2", baseValue: 2 }, { objectId: "a", stateVar: "x", specKey: "k1", baseValue: 1 }];
    expect(digestSpecCells(cells)).toBe(digestSpecCells([...cells].reverse())); // 序无关
    expect(digestSpecCells(cells)).not.toBe(digestSpecCells([{ ...cells[0]!, baseValue: 3 }, cells[1]!]));
    expect(fnv1a("")).toMatch(/^[0-9a-f]{8}$/); // 金丝雀：函数活着（空串也有确定值）
  });

  it("D2 · today(c) 与 runDerivations 同口径：round(...,6)；译不出/非有限 ⇒ undefined（判不了≠0）", () => {
    expect(todayOfSpecCell("COALESCE(this.demandDelta * 100, 0)", { demandDelta: 0.6 })).toBe(60);
    expect(todayOfSpecCell("this.qty / 3", { qty: 1 })).toBe(0.333333);
    expect(todayOfSpecCell("SUM(in(some_link).qty)", {})).toBeUndefined(); // 聚合 DSL 不译 ⇒ 判不了
    expect(todayOfSpecCell("COALESCE(this.nonexistent, 0)", {})).toBe(0);   // 缺格 ⇒ fallback 0（与规格层同口径）
  });

  it("D1 · 键式与既有登记表同式：`类型|量纲`（不许改口径）", () => {
    expect(specCellKey("Order", "demandPressure")).toBe("Order|demandPressure");
    expect(Object.keys(STATE_VAR_VALUE_REFS).every((k) => k.includes("|"))).toBe(true);
  });
});
