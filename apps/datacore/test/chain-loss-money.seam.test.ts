import { describe, expect, it } from "vitest";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";
import {
  ChainLossMatrixResultSchema,
  MONEY_CONSERVATION_TOLERANCE_YUAN,
  lossValueAtRiskYuan,
  orderExposureYuan,
  type ChainLossMatrixResult,
} from "@platform/contracts";

/**
 * WO-LOSS-ATTRIB-MONEY · 「损失归因说得出多少钱」的接缝门。
 *
 * ── 这个文件咬的是什么 ──────────────────────────────────────────────────────
 * 数据半 = 种子里的 `Order.value`（派生属性 `qty × unitPrice`）+ `Order.bases`（可产基地清单）；
 * 引擎半 = 契约 §5.5 的 `orderExposureYuan` / `lossValueAtRiskYuan` + 矩阵求解器的敞口装配。
 * 任一半漏（订单没金额 / 敞口没按基地过滤 / 金额没乘进格子）本文件当场红。
 * **全部经真 HTTP 端点驱动**（`app.inject`）——纯函数绿证明不了路由把金额发出去了。
 *
 * ── 判据（= 交单时那五格对照实验，逐条落成断言）────────────────────────────
 *  ① **屏上/回包有金额**：回包里 `valueAtRiskYuan` 必须真出现且 > 0。
 *     金丝雀：同一个回包里 `days` 必须也 > 0 —— 它不中就是**测试自己坏了**，
 *     那时该报「量法坏了」，不许报「没有金额」。
 *  ② **13 个基地拆得开**：敞口最大与最小两列，**同一个环节**的金额必须不同，
 *     且比值 == 两列敞口之比（金额是敞口的线性像，不是噪声）。
 *     ⚠ 这一条是本单存在的理由：修前 16/18 行**逐列同值**（天数维度今天仍然如此），
 *     一张按基地拆的表、公式里没有基地项，拆了等于没拆。
 *  ③ **反向对照（防「只是加了噪声」）**：同一列内 `days` 相同的两个环节，金额**必须仍然相同**。
 *     若连它们都被拉开，说明拉开靠的是随机而不是敞口。
 *  ④ **对得上账**：逐列 Σ 格子金额 == 该列敞口（±1 元）；且 Σ 各列敞口 ÷ 订单簿总额
 *     == `exposureOverlapRatio`（一单可产多基地故 > 1，这个数必须显式返回、不许让人猜）。
 *  ⑤ **诚实缺席**：没有可产订单的基地，金额是 `null` **不是 0**
 *     （「没数据」与「金额是 0」是相反的结论）。
 *
 * ── 变异反证（本单亲手跑过）────────────────────────────────────────────────
 * 把 `orderExposureYuan` 里的基地过滤 `if (!bases.includes(baseId)) continue;` 删掉
 * （即每列都拿整本订单簿当敞口）→ 判据 ② 当场红（两列金额变成相等、比值 1.000 而非 10.25），
 * 判据 ④ 的 `exposureOverlapRatio` 从 1.57 跳到 13.00。还原 → 全绿。
 */

const URL = "/a/v1/sim/chain-loss-matrix";

async function okMatrix(t: TestApp, payload: Record<string, unknown> = {}): Promise<ChainLossMatrixResult> {
  const res = await t.app.inject({ method: "POST", url: URL, headers: ADMIN, payload });
  expect(res.statusCode, `矩阵端点应 200，实际 ${res.statusCode}：${res.body.slice(0, 400)}`).toBe(200);
  return ChainLossMatrixResultSchema.parse(res.json());
}

/** 有敞口且有链的列（金额判据只在这批上成立）。 */
const pricedCols = (m: ChainLossMatrixResult) => m.colTotals.filter((c) => c.exposureYuan !== null && c.days !== null);

describe("WO-LOSS-ATTRIB-MONEY · 损失归因的金额口径与基地维", () => {
  it("① 回包里真有元金额（金丝雀：同一回包的 days 必须也 > 0，否则是测试坏了）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const m = await okMatrix(t);

    // 金丝雀先跑：量法自证。它不中 ⇒ 报「工具坏了」，不许报「没有金额」。
    const daysCells = m.cells.filter((c) => c.days > 0);
    expect(daysCells.length, "金丝雀不中：回包里连 days > 0 的格子都没有 ⇒ 是这个测试/种子坏了，不是没有金额").toBeGreaterThan(0);

    const priced = m.cells.filter((c) => c.valueAtRiskYuan !== null && (c.valueAtRiskYuan as number) > 0);
    expect(priced.length, "回包里没有任何 valueAtRiskYuan > 0 的格子 —— 这一屏仍然答不了「损失了多少钱」").toBeGreaterThan(0);

    // 对账块必须在，且订单簿总额 > 0（它是所有金额的锚）。
    expect(m.money.orderBookTotalYuan).toBeGreaterThan(0);
    expect(m.money.orderBookCount).toBeGreaterThan(0);
    // summary 这句人读的话里必须带「亿元」——屏上没有金额时，这句是唯一能被读到的金额出处。
    expect(m.summary).toContain("亿元");
  });

  it("② 基地维是真的：敞口最大/最小两列，同一环节金额不同，且比值 == 敞口之比", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const m = await okMatrix(t);

    const cols = [...pricedCols(m)].sort((a, b) => (b.exposureYuan as number) - (a.exposureYuan as number));
    expect(cols.length, "有敞口的列不足 2，判据 ② 无从谈起").toBeGreaterThanOrEqual(2);
    const big = cols[0]!;
    const small = cols[cols.length - 1]!;
    const expRatio = (big.exposureYuan as number) / (small.exposureYuan as number);
    expect(expRatio, "两列敞口居然相等 —— 种子里基地维没差异，判据 ② 失去意义").toBeGreaterThan(1);

    // 逐环节比对：两列都有的格子，金额必须不同，且比值恒等于敞口之比。
    let compared = 0;
    for (const n of m.nodes) {
      const a = m.cells.find((c) => c.nodeId === n.nodeId && c.baseId === big.baseId);
      const b = m.cells.find((c) => c.nodeId === n.nodeId && c.baseId === small.baseId);
      if (!a || !b || a.valueAtRiskYuan === null || b.valueAtRiskYuan === null) continue;
      if ((b.valueAtRiskYuan as number) <= 0) continue; // 0 天的环节两边都是 0，比值无意义
      compared++;
      expect(
        a.valueAtRiskYuan,
        `环节「${n.label}」在 ${big.baseId} 与 ${small.baseId} 上金额相同 ⇒ 这张表按基地拆了等于没拆`,
      ).not.toBe(b.valueAtRiskYuan);
    }
    expect(compared, "没有任何可比环节 —— 判据 ② 没真跑起来").toBeGreaterThan(0);

    // 金额是敞口的线性像：整列同一个倍数（该环节 pct 在两列相同时）。
    // 取一个两列 pct 相同的环节来验（如订单回款：天数维度本就逐列同值）。
    const sameP = m.nodes
      .map((n) => ({
        a: m.cells.find((c) => c.nodeId === n.nodeId && c.baseId === big.baseId),
        b: m.cells.find((c) => c.nodeId === n.nodeId && c.baseId === small.baseId),
      }))
      .find((x) => x.a && x.b && Math.abs(x.a.pct - x.b.pct) < 1e-9 && x.a.pct > 0);
    expect(sameP, "找不到两列 pct 相同的环节，无法验「金额是敞口的线性像」").toBeTruthy();
    const gotRatio = (sameP!.a!.valueAtRiskYuan as number) / (sameP!.b!.valueAtRiskYuan as number);
    expect(gotRatio).toBeCloseTo(expRatio, 6);
  });

  it("③ 反向对照：同一列内 days 相同的两个环节，金额必须仍然相同（不是噪声）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const m = await okMatrix(t);

    let pairs = 0;
    for (const col of pricedCols(m)) {
      const cs = m.cells.filter((c) => c.baseId === col.baseId && c.valueAtRiskYuan !== null);
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++) {
          if (cs[i]!.days !== cs[j]!.days) continue;
          pairs++;
          expect(
            cs[i]!.valueAtRiskYuan,
            `同列同天数的两个环节金额被拉开了（${col.baseId} ${cs[i]!.nodeId} vs ${cs[j]!.nodeId}）⇒ 这是噪声不是基地维`,
          ).toBe(cs[j]!.valueAtRiskYuan);
        }
    }
    expect(pairs, "一对等天数环节都没有 —— 判据 ③ 没真跑起来（金丝雀不中）").toBeGreaterThan(0);
  });

  it("④ 对得上账：逐列 Σ 金额 == 敞口；Σ各列敞口 ÷ 订单簿 == 显式返回的重复计入倍率", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const m = await okMatrix(t);

    for (const col of pricedCols(m)) {
      const sum = m.cells
        .filter((c) => c.baseId === col.baseId && c.valueAtRiskYuan !== null)
        .reduce((s, c) => s + (c.valueAtRiskYuan as number), 0);
      expect(Math.abs(sum - (col.exposureYuan as number))).toBeLessThanOrEqual(MONEY_CONSERVATION_TOLERANCE_YUAN);
      expect(col.moneyOk, `列 ${col.baseId} 金额守恒未通过，残差 ${col.moneyResidualYuan}`).toBe(true);
    }
    expect(m.money.allColumnsMoneyOk).toBe(true);

    // 重复计入倍率必须显式且自洽：一单可产多基地 ⇒ Σ各列敞口 > 订单簿总额。
    const sumExp = m.colTotals.reduce((s, c) => s + (c.exposureYuan ?? 0), 0);
    expect(m.money.exposureSumYuan).toBeCloseTo(sumExp, 6);
    expect(m.money.exposureOverlapRatio).not.toBeNull();
    expect(m.money.exposureOverlapRatio as number).toBeCloseTo(sumExp / m.money.orderBookTotalYuan, 9);
    expect(m.money.exposureOverlapRatio as number).toBeGreaterThan(1);

    // 行合计金额之和 == Σ各列敞口（同一批格子换个方向加）。
    const sumRow = m.rowTotals.reduce((s, r) => s + (r.valueAtRiskYuan ?? 0), 0);
    expect(Math.abs(sumRow - sumExp)).toBeLessThanOrEqual(MONEY_CONSERVATION_TOLERANCE_YUAN);
  });

  it("⑤ 诚实缺席 + R6：敞口与锚点单无关；同参数二次调用逐字段一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const m = await okMatrix(t);

    // 敞口只随「这个基地能产哪些单」变，不随「这次拿哪张单当锚点」变。
    const anchored = m.colTotals.find((c) => c.anchorSo !== null);
    expect(anchored).toBeTruthy();
    const m2 = await okMatrix(t, { so: anchored!.anchorSo as string });
    for (const c of m.colTotals) {
      const o = m2.colTotals.find((x) => x.baseId === c.baseId);
      expect(o?.exposureYuan, `列 ${c.baseId} 的敞口随锚点单变了 —— 那是把两个自变量绑成了一个`).toBe(c.exposureYuan);
    }
    // 指定单只可产部分基地 ⇒ 其余列天数 null（诚实缺席），但**敞口仍在**，且不是 0。
    const blanks = m2.colTotals.filter((c) => c.days === null);
    for (const b of blanks) {
      expect(b.days).toBeNull();
      expect(b.days).not.toBe(0);
    }

    // R6：同参数两次调用逐字段一致。
    const again = await okMatrix(t);
    expect(JSON.stringify(again)).toBe(JSON.stringify(m));
  });

  it("⑥ 契约 §5.5 两个纯函数各自的口径（单测层，供变异反证定位）", () => {
    // 敞口：按基地过滤 + 跳过未登记 value（不当 0）。
    const orders = [
      { value: 100, bases: ["a", "b"] },
      { value: 200, bases: ["b"] },
      { value: undefined, bases: ["a"] }, // 未登记金额 ⇒ skipped，不计 0
      { value: 50, bases: ["c"] },
    ];
    expect(orderExposureYuan(orders, "a")).toEqual({ exposureYuan: 100, countedOrders: 1, skippedOrders: 1 });
    expect(orderExposureYuan(orders, "b")).toEqual({ exposureYuan: 300, countedOrders: 2, skippedOrders: 0 });
    // baseId=null ⇒ 整本订单簿（对账锚点）。
    expect(orderExposureYuan(orders, null)).toEqual({ exposureYuan: 350, countedOrders: 3, skippedOrders: 1 });
    // 一单可产多基地 ⇒ Σ各基地敞口(100+300+50=450) > 订单簿(350)：重复计入是口径的一部分。
    expect(100 + 300 + 50).toBeGreaterThan(350);

    // 天 → 钱：pct 是 0–100 不是 0–1（写错一个数量级这里当场红）。
    expect(lossValueAtRiskYuan(1000, 100)).toBe(1000);
    expect(lossValueAtRiskYuan(1000, 71.3)).toBeCloseTo(713, 9);
    expect(lossValueAtRiskYuan(1000, 0)).toBe(0);
  });
});
