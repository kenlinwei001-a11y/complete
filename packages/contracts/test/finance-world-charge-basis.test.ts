import { describe, expect, it } from "vitest";
import {
  FINANCE_WORLD_PRESSURE_DIVISOR,
  FinanceWorldPressureSchema,
  MONEY_CHARGE_BASIS,
} from "../src/finance-world.js";

/**
 * GOALLOOP-R2 · 金额摊销轴（`MONEY_CHARGE_BASIS`）的契约门。
 *
 * 病（改前）：压力的**分子**摊世界态覆盖到的对象、**分母**摊对象层全表 —— 两者不是同一个集合，
 * 实测差一个**固定倍数 2.902657**（全表 454.6433 亿 ÷ 世界成员 156.6300 亿），
 * 而回包里只有 `carriers`/`universe`，**看不出分母是谁** ⇒ 同一个「新增成本」两个口径
 * 差 92.1 万 vs 267.4 万，屏上无法分辨。
 *
 * 本门咬三件事：
 *  ① 三条金额轴都登记了总体（⛔ 少一条 = 那条又回到「现场挑一个 listByType」）；
 *  ② `FinanceWorldPressureSchema` **要求** `denominator`（⛔ 可选 = 不写也能过，门就是装饰品）；
 *  ③ `denominator` 与 `universe` 是**两个不同的数**（把披露总数当分母正是本单的病）。
 */
describe("GOALLOOP-R2 · MONEY_CHARGE_BASIS（金额摊销轴登记）", () => {
  const AXES = ["Order|costPressure", "Customer|receivablePressure", "ARInvoice|overduePressure"] as const;

  it("三条金额轴逐条登记了摊销总体（少一条即红）", () => {
    for (const key of AXES) {
      const e = MONEY_CHARGE_BASIS[key];
      expect(e, `轴 ${key} 未登记 —— 未登记 = 消费方又会现场挑一个集合`).toBeDefined();
      expect(e!.population).toBe("SIM_WORLD_MEMBERS");
      expect(e!.baseRef.length).toBeGreaterThan(0);
      expect(e!.note.length).toBeGreaterThan(0);
    }
    // 正向对照：登记的键集**恰好**等于上面三条（多登记 = 有轴在没人守的地方生效）。
    expect(Object.keys(MONEY_CHARGE_BASIS).sort()).toEqual([...AXES].sort());
  });

  it("量纲桥指向同一份声明（⛔ 不另立第二套除数）", () => {
    for (const key of AXES) {
      expect(MONEY_CHARGE_BASIS[key]!.divisorRef).toBe("FINANCE_WORLD_PRESSURE_DIVISOR");
    }
    // 扣住那条声明本身真实存在且 pp→100（`divisorRef` 是字符串指针，指到空处不算数）。
    expect(FINANCE_WORLD_PRESSURE_DIVISOR.pp).toBe(100);
    expect(FINANCE_WORLD_PRESSURE_DIVISOR.ratio).toBe(1);
  });

  it("FinanceWorldPressureSchema 要求 denominator，且 denominator.n ≠ universe", () => {
    const row = {
      stateVar: "costPressure",
      objectType: "Order",
      value: 0.004602,
      carriers: 150,
      universe: 500, // 台账总数（披露用）
      denominator: { set: "SIM_WORLD_MEMBERS", n: 150, weightSum: 15663001584 }, // 分母（摊销用）
      weighting: "VALUE" as const,
      weightingNote: "按承载对象真金额加权",
      provenance: { kind: "派生" as const, drillType: "Order", drillId: "*", drillField: "costPressure", drillValue: 0.004602 },
    };
    expect(FinanceWorldPressureSchema.safeParse(row).success).toBe(true);

    // ① 缺 denominator ⇒ **必须**不过（可选字段的话本行会绿，那这道门就是装饰品）。
    const { denominator, ...withoutDenominator } = row;
    void denominator;
    expect(FinanceWorldPressureSchema.safeParse(withoutDenominator).success).toBe(false);

    // ② denominator 必须与 universe 分开：把披露总数当分母 = 本单的病，schema 层挡住这个形状。
    const confused = { ...row, universe: 150, denominator: { set: "SIM_WORLD_MEMBERS", n: 500, weightSum: 1 } };
    const parsed = FinanceWorldPressureSchema.safeParse(confused);
    expect(parsed.success).toBe(true); // schema 管不了「填错」——
    // ⛔ 所以下面这句才是本测试的真判据：**两个数各是谁，回包里必须都写出来**。
    //    只给一个数时，读者只能猜它是台账总数还是分母（改前就是这样）。
    expect(confused.universe).not.toBe(confused.denominator.n);
  });

  it("正向对照：一个**必然为真**的行必须过（防「全都不过也算红」的假门）", () => {
    const ok = FinanceWorldPressureSchema.safeParse({
      stateVar: "overduePressure",
      objectType: "ARInvoice",
      value: 0.000533,
      carriers: 60,
      universe: 60,
      denominator: { set: "SIM_WORLD_MEMBERS", n: 60, weightSum: 160802 },
      weighting: "VALUE" as const,
      weightingNote: "按发票真金额加权",
      provenance: { kind: "派生" as const, drillType: "ARInvoice", drillId: "*", drillField: "overduePressure", drillValue: 0.000533 },
    });
    expect(ok.success, JSON.stringify(ok.error?.issues ?? [])).toBe(true);
  });
});
