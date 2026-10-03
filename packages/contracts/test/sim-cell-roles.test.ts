import { describe, expect, it } from "vitest";
import { buildCellRoles, type CellRoleRule } from "../src/sim.js";

/**
 * `buildCellRoles` 的两条判据（**2026-09-30 新建**）。
 *
 * ── 为什么会有这个文件 ─────────────────────────────────────────────────────
 * 全仓对 `buildCellRoles` / `minTransitTicksTo` **零直接测试** —— 缺陷因此潜伏：
 * 实测真后端 `Order.qty`（三个「Order 孤岛」之一），
 *   · `reachesTypes("Order","qty").has("Order")` = **false**  ⇒ 判它**不可落点**
 *   · `minTransitTicksTo("Order","qty","Order")` = **0**     ⇒ 判它「0 拍就到」
 * **同一张图、同一条链路，契约里两个函数给出相反答案**。屏上两个消费方各吃一个
 * （`landableVarsByType` 吃前者、`zeroReasonKind` 吃后者）⇒ 一旦某天某个 `Order` 型格
 * 真能到达另一个 `Order` 格，它既会**成为落点**，又会被读成「够得着却没动」。
 *
 * 根因：`distFrom` 把起点播成 0 只是为了起松弛，而 `minTransitTicksTo` 按**类型名**
 * 匹配 ⇒ 起点自己（同型）被当成「0 拍传到」。**0 条边 = 没有发生传导。**
 *
 * 下方 ③ 是本条要建的机制：∀ 全表断言两个函数**同进同出**。
 */

/** 真图里真有的形状（`GET /a/v1/sim/propagation-rules?published=true` 实测 55 条边里的四条）。 */
const e = (s: string, sv: string, t: string, tv: string, delayTicks?: number): CellRoleRule => ({
  sourceTypeKey: s,
  sourceStateVar: sv,
  targetTypeKey: t,
  targetStateVar: tv,
  delayTicks,
});

const BASE: CellRoleRule[] = [
  // 原材料涨价够到订单的**唯一那条路**
  e("Material", "priceShock", "Model", "costPressure"),
  e("Model", "costPressure", "Order", "costPressure"),
  // 预测偏差够到订单的那条路
  e("Model", "forecastBias", "Order", "demandPressure"),
  // 孤岛对：`Order` 的外生量 → `Model.backlogQtyTop`，而后者**零出边**（真图实测）
  e("Order", "qty", "Model", "backlogQtyTop"),
];

describe("WO-SIM-HORIZON · 契约 · 格子角色图", () => {
  it("① 代价 = 每条边 1 拍 + 该边 delayTicks（真后端四臂实测吻合过的那条公式）", () => {
    const r = buildCellRoles(BASE);
    // 每跳自身吃一拍：`Material.priceShock → Model.costPressure → Order.costPressure` = 2 跳
    expect(r.minTransitTicksTo("Material", "priceShock", "Order")).toBe(2);
    expect(r.minTransitTicksTo("Material", "priceShock", "Model")).toBe(1);
    expect(r.minTransitTicksTo("Model", "forecastBias", "Order")).toBe(1);

    // 只把**第一跳**加 5 天延迟 ⇒ 到 Model 1 → 6、到 Order 2 → 7（这正是屏上 ⑭b 的对照实验）
    const delayed = buildCellRoles(BASE.map((x) => (x.sourceTypeKey === "Material" ? { ...x, delayTicks: 5 } : x)));
    expect(delayed.minTransitTicksTo("Material", "priceShock", "Model")).toBe(6);
    expect(delayed.minTransitTicksTo("Material", "priceShock", "Order")).toBe(7);
  });

  it("② 孤岛：`Order.qty` 到不了 `Order` —— 两个函数必须**同时**说「到不了」", () => {
    const r = buildCellRoles(BASE);
    // 判据的两半各自先站住（不修的话下面第二条是 0，与上面第一条直接矛盾）
    expect(r.reachesTypes("Order", "qty").has("Order")).toBe(false);
    expect(r.minTransitTicksTo("Order", "qty", "Order")).toBeNull();
    // 而它能到 `Model`（那条出边是真的，只是通向死格）—— 证上一条不是「这张图整条都断」
    expect(r.reachesTypes("Order", "qty").has("Model")).toBe(true);
    expect(r.minTransitTicksTo("Order", "qty", "Model")).toBe(1);
  });

  it("③ ∀ 全表：`reachesTypes(t,v).has(X)` ⟺ `minTransitTicksTo(t,v,X) !== null`（本条要建的机制）", () => {
    const r = buildCellRoles(BASE);
    const types = [...new Set(BASE.flatMap((x) => [x.sourceTypeKey, x.targetTypeKey]))];
    const cells = types.flatMap((t) => r.drivableStateVarsOf(t).map((v) => [t, v] as const));
    /* 基数锚点（既是金丝雀也是 ∀ 的下限）：三个类型、三个可驱动格。
       ⛔ 写死条数不是过时风险 —— 夹具改了它就该红，因为下面那个 ∀ 的**射程**变了。 */
    expect(types.length).toBe(3);
    expect(cells.length).toBe(3);
    expect(cells.map(([t, v]) => `${t}.${v}`).sort()).toEqual(["Material.priceShock", "Model.forecastBias", "Order.qty"]);
    for (const [t, v] of cells) {
      for (const to of types) {
        expect(
          r.reachesTypes(t, v).has(to),
          `${t}.${v} → ${to}：两个函数对同一格给出了相反答案`,
        ).toBe(r.minTransitTicksTo(t, v, to) !== null);
      }
    }
  });

  it("④ 反向金丝雀：把孤岛接回主图 ⇒ 两个函数必须**同时**翻真（否证 ③ 是恒真）", () => {
    const r = buildCellRoles([...BASE, e("Model", "backlogQtyTop", "Order", "costPressure")]);
    expect(r.reachesTypes("Order", "qty").has("Order")).toBe(true);
    // `Order.qty → Model.backlogQtyTop → Order.costPressure` = 2 跳
    expect(r.minTransitTicksTo("Order", "qty", "Order")).toBe(2);
  });

  it("⑤ 排的是**起点那一格**、不是同型的所有格：环回到同型另一个格仍算「传到」", () => {
    const r = buildCellRoles([e("A", "x", "B", "y"), e("B", "y", "A", "z")]);
    // A.x 自己不算；绕一圈回来的 A.z 是**真传到了** ⇒ 2（若写成「同型一律不算」这里就是 null）
    expect(r.minTransitTicksTo("A", "x", "A")).toBe(2);
    // 金丝雀：同一张图上「到 B」= 1，证 ⑤ 不是把整张图判成了 2
    expect(r.minTransitTicksTo("A", "x", "B")).toBe(1);
  });
});
