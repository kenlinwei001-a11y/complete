import { z } from "zod";

/**
 * WO-ORDER-BOOK-500 · 销售订单**头级**生命周期状态（`Order.status`）契约。
 *
 * ## 为什么必须新造，而不是复用 `OrderLineStatusSchema`
 *
 * 实测（`grep -rn "OrderLineStatusSchema"`，再追一层调用方 —— 铁律 0.5）：
 * `OrderLineStatusSchema = ["OPEN","COMMITTED","PARTIAL","SHIPPED"]` 全仓**只被
 * `OrderLineSchema.lineStatus` 一处消费**，它度量的是「**这一行**有没有被承诺 / 部分满足 / 发运」——
 * 是**行级履约进度**。订单**头**级要表达的是「这**张单**处在生产生命周期的哪一段」。
 *
 * 两者是**正交的两个维度**，不是同一个枚举的两种写法：
 *  - 一张 `COMPLETED` 的订单，它的行全是 `SHIPPED`；
 *  - 一张 `OPEN` 的订单，它的行可以是 `COMMITTED`（已承诺但整单尚未排产）。
 *
 * 把两者合成一个枚举 = 把「整单到哪一步」和「某一行发没发货」压成一个字段，
 * 从此再也切不出「这单在制、但其中一行还缺料」这类结论 —— 正是 `OrderLine` 当初被拆出来要解决的病。
 *
 * ## 为什么 `OPEN` 留在三态里（不是偷懒，是给既有行为起个准确的名字）
 *
 * 扩容前 `Order.status` **恒为 `"OPEN"`**（24/24 实测），而生产代码对这个值的**实际**用法
 * 有且只有一个语义 ——「**这张单还等着被排产**」：
 *  - `deriveOrderPromises`（`synthetic/battery.ts`）：`status !== "OPEN"` 即 `continue`，
 *    **只给 OPEN 单算 ATP 承诺** —— 已交付的单不需要承诺；
 *  - `solvers/portfolio.ts`：`orders.filter(o => o.status === "OPEN")` 就是
 *    **产能分配的决策集** —— 在制 / 已完成的单不该再进决策集抢产能。
 *
 * 所以把 `OPEN` 精确化为「已下待排产」是**把代码今天就已经在做的事说清楚**，
 * 不是给它换语义。附带的好处：24 张锚点订单的 `status` 字面量一个字节都不用动（R6）。
 */
export const OrderStatusSchema = z.enum([
  /** 已下待排产：订单已接、尚未排产 —— 产能分配决策集 + 需要 ATP 承诺。交期在未来。 */
  "OPEN",
  /** 进行中：已排产、在制（工单已下达，产线上正在跑）。交期在近端，允许少量已逾期在制。 */
  "IN_PRODUCTION",
  /** 已完成：已交付关闭，不再占用产能、不再需要承诺。交期在过去。 */
  "COMPLETED",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** 三态取值（供 `PropertyDef.enumValues` 回填 —— 声明了才有人校验，写在注释里的枚举不算数）。 */
export const ORDER_STATUSES = OrderStatusSchema.options;

/**
 * 订单簿状态构成（`已完成 : 进行中 : 已下待排产 = 70 : 20 : 10`）——**比例的单一来源**。
 *
 * 生成器按本表算目标条数（余额归 `OPEN` 保 Σ 精确），门与测试按本表算期望，
 * 两边同读一处 ⇒ 改比例只改这里，不会出现「生成器改了、断言还咬旧数」的双份真相。
 */
export const ORDER_STATUS_MIX: ReadonlyArray<{ status: OrderStatus; share: number }> = [
  { status: "COMPLETED", share: 0.7 },
  { status: "IN_PRODUCTION", share: 0.2 },
  { status: "OPEN", share: 0.1 },
];

/**
 * 按订单簿总数切分三态目标条数。
 *
 * `COMPLETED`/`IN_PRODUCTION` 取四舍五入，**`OPEN` 取余额** —— 保证三者之和 `=== total`
 * 恒成立（仿 `OrderLine` 尾行取余额保 Σ 精确的既有做法），不会因舍入丢 1 张。
 */
export function orderStatusTargets(total: number): Record<OrderStatus, number> {
  const completed = Math.round(total * 0.7);
  const inProduction = Math.round(total * 0.2);
  return { COMPLETED: completed, IN_PRODUCTION: inProduction, OPEN: total - completed - inProduction };
}
