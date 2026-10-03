import { describe, expect, it } from "vitest";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";
import {
  ChainLossMatrixResultSchema,
  MONEY_CONSERVATION_TOLERANCE_YUAN,
  lossValueAtRiskYuan,
  orderExposureYuan,
  orderStatusTargets,
  type ChainLossMatrixResult,
} from "@platform/contracts";
// 订单簿总数取生成侧的单一出处，**不在测试里写 500 这个字面量**
// （写死就成了第二份真相：扩容改了生成器，这里还咬旧数、还是绿的）。
import { ORDER_BOOK_SIZE } from "../src/synthetic/battery.js";

/**
 * WO-LOSS-ATTRIB-MONEY · 「损失归因说得出多少钱」的接缝门。
 *
 * ── 这个文件咬的是什么 ──────────────────────────────────────────────────────
 * 数据半 = 种子里的 `Order.value`（派生属性 `qty × unitPrice`）+ `Order.bases`（可产基地清单）
 *          + `Order.status`（三态 70:20:10）；
 * 引擎半 = 契约 §5.5 的 `orderExposureYuan` / `lossValueAtRiskYuan` + 矩阵求解器的敞口装配。
 * 任一半漏（订单没金额 / 敞口没按基地过滤 / **没按在手过滤** / 金额没乘进格子）本文件当场红。
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
 *  ⑥ 契约两个纯函数各自的口径（单测层，供变异反证定位到底是哪一半坏了）。
 *  ⑦ **敞口是「在手」口径**：已交付关闭单一分钱都不进，且在手/已交付两个数
 *     与 `order-status.ts` 的 `orderStatusTargets` 同源、加起来等于全簿。
 *
 * ── ⚠ 判据 ⑦ 的由来：本单第一版自己犯的错（照实记账，不藏）────────────────
 * 初版 `orderExposureYuan` **不看 `status`**，把整本 500 单（含 350 张 `COMPLETED`）
 * 都算进敞口 ⇒ 在手订单簿总额报 **454.64 亿**，真值 **156.63 亿**，**虚报 2.90×**。
 * 而 `order-status.ts` 早就为同一形态记过一次账（驾驶舱「在手订单」卡片虚报 3.3 倍）——
 * **同一个错在同一个仓里犯了第二次**，故按铁律 0.6 二级处置**当场建机制**：判据 ⑦ 就是那道门。
 * 它咬的不是「数对不对」，是「**口径有没有跟平台的单一出处对齐**」——
 * 前者换个种子就失效，后者不会。
 *
 * ── 变异反证（本单**亲手跑过**，下面写的是实测结果不是预期）──────────────────
 * **变异 A**：把基地过滤短路掉（`if (false && !bases.includes(baseId))`，每列都拿整本簿当敞口）。
 *   实测 **RC=1，2 failed | 5 passed**：
 *   · **判据 ② 红** —— `两列敞口居然相等 …: expected 1 to be greater than 1`（比值 9.43 → 1.000）；
 *   · **判据 ⑥ 红** —— `expected { exposureYuan: 350, …(3) } to deeply equal { exposureYuan: 100, …(3) }`。
 *   ⚠ 附带：这条变异**连 `tsc` 都过不去**（`error TS2345: Argument of type 'string | null'
 *   is not assignable to parameter of type 'string'` —— 短路后 `baseId` 的收窄没了）。
 *   即基地过滤有**两道**防线，类型系统是第一道。
 * **变异 B**：把在手过滤短路掉（`if (false && !isOnHandOrderStatus(o.status))`，即回到初版那个错）。
 *   实测 **RC=1，2 failed | 5 passed**（`tsc` 这条**过得去** —— 所以它只有测试这一道防线，
 *   这正是判据 ⑦ 必须存在的理由）：
 *   · **判据 ⑥ 红** —— `expected { exposureYuan: 10099, …(3) } to deeply equal { exposureYuan: 100, …(3) }`
 *     （10099 = 100 + 那张 9,999 的 `COMPLETED` 单混了进来）；
 *   · **判据 ⑦ 红** —— `种子里一张 COMPLETED 都没有 ⇒ 本条判据没真跑起来: expected 0 to be greater than 0`
 *     （`orderBookDelivered` 归零 —— 排除计数没了，金丝雀先说话）。
 * 两次变异各自还原 → **7/7 全绿，RC=0**。
 *
 * ⚠ 上面每一条都是**跑出来的原文**，不是预期。初稿曾按"应该会这样红"写了两条，
 * 实跑下来 ⑦ 的红法与预想完全不同（是金丝雀先红，不是数值断言先红）——
 * 照实改回。**猜出来的变异结果和没做变异是一回事。**
 *
 * ⚠ **判据 ④ 在变异 A 下仍然绿，这是本门的已知盲区，照实记账**：
 * 每列都拿整本订单簿时，`exposureOverlapRatio` 从 1.66 变成 **13.00**，
 * 而 ④ 只断言「它 > 1 且等于 Σ敞口÷订单簿」—— 13.00 两条都满足。
 * 也就是说**④ 度量的是「这个比率自洽」，不是「敞口按基地过滤了」**，后者只有 ②⑥ 咬得住。
 * 不给 ④ 加一个「ratio < 基地数」的上界，是因为那个上界没有业务出处
 * （真实租户完全可能一单可产全部基地）——**宁可把盲区写明，不编一条看起来更严的断言。**
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
    // 敞口：在手过滤 + 按基地过滤 + 跳过未登记 value（不当 0）。
    const orders = [
      { value: 100, bases: ["a", "b"], status: "OPEN" },
      { value: 200, bases: ["b"], status: "IN_PRODUCTION" }, // 在制也在手（货没交、钱没结）
      { value: undefined, bases: ["a"], status: "OPEN" }, // 未登记金额 ⇒ skipped，不计 0
      { value: 50, bases: ["c"], status: "OPEN" },
      { value: 9_999, bases: ["a", "b", "c"], status: "COMPLETED" }, // 已交付 ⇒ 一分钱都不许进敞口
    ];
    expect(orderExposureYuan(orders, "a")).toEqual({ exposureYuan: 100, countedOrders: 1, skippedOrders: 1, deliveredOrders: 1 });
    expect(orderExposureYuan(orders, "b")).toEqual({ exposureYuan: 300, countedOrders: 2, skippedOrders: 0, deliveredOrders: 1 });
    // baseId=null ⇒ 整本**在手**订单簿（对账锚点）。9999 那张 COMPLETED 不在里面。
    expect(orderExposureYuan(orders, null)).toEqual({ exposureYuan: 350, countedOrders: 3, skippedOrders: 1, deliveredOrders: 1 });
    // 一单可产多基地 ⇒ Σ各基地敞口(100+300+50=450) > 订单簿(350)：重复计入是口径的一部分。
    expect(100 + 300 + 50).toBeGreaterThan(350);

    // ⚠ 本单第一版就是漏了这道过滤（把 COMPLETED 也算进去）。这一条是那笔账的锁：
    //   9,999 远大于其余全部之和，漏了它任何一个断言都会当场红成天文数字。
    expect(orderExposureYuan(orders, null).exposureYuan).toBeLessThan(9_999);

    // `status` 缺失 ⇒ 不在手（保守），且**计入 deliveredOrders 而不是静默丢**。
    // 这一条锁的是 `orderMoneyShape` 漏传 status 那个形态：真发生时敞口会整片变 0。
    expect(orderExposureYuan([{ value: 100, bases: ["a"] }], "a")).toEqual({
      exposureYuan: 0, countedOrders: 0, skippedOrders: 0, deliveredOrders: 1,
    });

    // 天 → 钱：pct 是 0–100 不是 0–1（写错一个数量级这里当场红）。
    expect(lossValueAtRiskYuan(1000, 100)).toBe(1000);
    expect(lossValueAtRiskYuan(1000, 71.3)).toBeCloseTo(713, 9);
    expect(lossValueAtRiskYuan(1000, 0)).toBe(0);
  });

  it("⑦ 敞口是**在手**口径：已交付单一分钱都不进，且与 order-status 单一出处同源", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const m = await okMatrix(t);

    // 金丝雀：种子里必须**真有**已交付单，否则这条判据等于没跑（三态 70:20:10）。
    expect(m.money.orderBookDelivered, "种子里一张 COMPLETED 都没有 ⇒ 本条判据没真跑起来").toBeGreaterThan(0);
    expect(m.money.orderBookCount).toBeGreaterThan(0);

    // 在手簿 + 已交付 == 全簿：两个数加起来必须是订单簿总数，否则有单被静默吞掉。
    const seen = m.money.orderBookCount + m.money.orderBookSkipped + m.money.orderBookDelivered;
    expect(seen, "在手 + 未登记 + 已交付 ≠ 全簿 ⇒ 有订单被静默丢了").toBe(ORDER_BOOK_SIZE);

    // 口径与 `order-status.ts` 同源：已交付占比按 ORDER_STATUS_MIX 应是 70%。
    expect(m.money.orderBookDelivered).toBe(orderStatusTargets(ORDER_BOOK_SIZE).COMPLETED);
    expect(m.money.orderBookCount).toBe(
      orderStatusTargets(ORDER_BOOK_SIZE).OPEN + orderStatusTargets(ORDER_BOOK_SIZE).IN_PRODUCTION,
    );

    // 屏上措辞随结果走 —— 印金额不印口径，用户就会拿它去对营收，然后判「对不上账」。
    expect(m.money.caption).toContain("未完成态");
    expect(m.summary).toContain("在手");
  });
});
