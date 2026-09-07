import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateBattery, BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * WO-UNIT-MARGIN-96X · 断点 `G-UNIT-MARGIN-CROSS-DENOM` 的**事实钉子**。
 *
 * ── 它钉的是什么 ───────────────────────────────────────────────────────────
 * `Model.unitPrice` 的分母是**套**，`Model.unitCost` 的分母是**电芯**，而两格
 * 在本体上**同声明 `unit:"元"`** ⇒ 任何按 `unit` 串做的校验都判它们"已对齐"。
 * 求解器（`opt-assemble`/`opt-binding`）据此把二者放进同一个减法当"毛利"。
 *
 * ── 为什么需要这个文件（不是记账，是拦错修法）─────────────────────────────
 * 本单开工时，派单与三处源码注释都把病因写成「差一个 `packCellCount`(96) 倍」。
 * **实测推翻**：那条路上 `packCellCount` 一次都没被读过，真实比值是 25.8×–34.2×。
 * 若有人照旧说法「乘个 96 对齐一下」，成本会变成营收的 **286.9%**（每一单巨亏）——
 * 那不是修对了口径，是把一个错数换成另一个错数。**本文件就是拦这一手的。**
 *
 * ⛔ 本文件**不断言**毛利轴该不该存在、也不改任何金值 —— 那是种子层/治理裁决
 *    （`docs/DECISION-unit-of-account.md` §1.5「套/电芯不得充当金额分母」）。
 */

/** 判断一份源码是否**读**了 `packCellCount`（剥行注释，避免注释里提一嘴被当成读取）。 */
function readsPackCellCount(src: string): boolean {
  return src
    .split("\n")
    .map((l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, "")) // 整行注释 → 空
    .map((l) => l.replace(/\/\/.*$/, "")) // 行尾注释
    .some((l) => l.includes("packCellCount"));
}

const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("G-UNIT-MARGIN-CROSS-DENOM · 单价按套 / 单件成本按电芯，同声明 `元`", () => {
  it("① 两格都声明 `unit:\"元\"` —— 这正是本差**对机器不可见**的原因", () => {
    const src = read("synthetic/battery.ts");
    // 金丝雀：先证明这个抓法抓得到东西（`unitPrice` 那格必中）。
    const priceDecl = /propKey: "unitPrice", dataType: "number", isPrimaryKey: false, unit: "元"/.test(src);
    expect(priceDecl, "金丝雀不中 ⇒ 属性声明的写法变了，本用例在测别的东西").toBe(true);
    // 目标：`unitCost` 同样声明 `unit: "元"`。
    expect(/propKey: "unitCost", dataType: "number", isPrimaryKey: false, unit: "元"/.test(src)).toBe(true);
  });

  it("② 真实比值是 25.7×–40.6×，**不是** packCellCount(96) —— 拦「乘个 96 就对齐」这一手", () => {
    const g = generateBattery(42, "S");
    const ratios = g.models.map((m) => Number(m.unitPrice) / Number(m.unitCost));
    const lo = Math.min(...ratios);
    const hi = Math.max(...ratios);
    console.log("UNITPRICE/UNITCOST 比值区间 =", lo.toFixed(3), "–", hi.toFixed(3), " n=", ratios.length);
    // 区间取自 6 个型号**全量**实测（25.735 圆柱-LFP … 40.563 4680-LFP），不是抽样。
    expect(lo).toBeGreaterThan(20);
    expect(hi).toBeLessThan(45);
    // 96 落在区间外 ⇒ 「差一个 packCellCount 倍」这个说法在数值上就站不住。
    const pcc = Number(BATTERY_SOLVER_PARAMS.packCellCount);
    expect(pcc).toBeGreaterThan(hi);
  });

  it("③ 按 96 对齐会让成本 > 营收（286.9%）—— 所以那不是「修口径」，是改金值", () => {
    const g = generateBattery(42, "S");
    const lines = g.orderLines as Record<string, unknown>[];
    const rev = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
    const cost = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitCost), 0);
    const pcc = Number(BATTERY_SOLVER_PARAMS.packCellCount);
    console.log("成本/营收 今天 =", (cost / rev).toFixed(4), " 按 packCellCount 对齐后 =", ((cost * pcc) / rev).toFixed(4));
    expect(cost / rev).toBeLessThan(0.05); // 今天：被系统性低估
    expect((cost * pcc) / rev).toBeGreaterThan(1); // 乘 96：每一单巨亏
  });

  it("④ 价/成本/毛利这条路上**没有任何一处读** packCellCount（金丝雀共用同一实现）", () => {
    // 金丝雀：产能路必须中 —— 不中说明 `readsPackCellCount` 坏了，而不是「代码干净」。
    expect(readsPackCellCount(read("solvers/capacity.ts")), "金丝雀不中 ⇒ 抓法坏了，不许读作「没有命中」").toBe(true);
    // 目标：价/成本/毛利路径逐个为假。
    for (const f of ["solvers/opt-assemble.ts", "solvers/opt-binding.ts", "solvers/extended.ts"]) {
      expect(readsPackCellCount(read(f)), `${f} 读了 packCellCount ⇒ 本断点的病因描述需重测`).toBe(false);
    }
  });
});
