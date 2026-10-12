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

/**
 * WO-DASH-ONHAND · 「**在手订单**」= 未完成态（`OPEN` 已下待排产 + `IN_PRODUCTION` 进行中）——
 * **口径的单一出处**。驾驶舱卡片、订单经营台账、接缝测试一律读本常量，不许各写各的字面量。
 *
 * ## 为什么必须有这一处（这不是"给枚举起个别名"）
 *
 * 修前实测（真后端 `SEED_DEMO=1` · 500 单订单簿）：**同一个业务概念，一屏三个数**——
 *  · 驾驶舱「在手订单」卡片 = **500**（`objects-aggregate` 压根没带 filter ⇒ 把 **350 张
 *    `COMPLETED`** 也数进去了 ⇒ 按此判在手量**虚报 3.3 倍**）；
 *  · 订单经营台账「全部」 = **127**；
 *  · 真正的未完成态 = **150**（= `OPEN` 50 + `IN_PRODUCTION` 100）。
 * 三个数没有任何一处写着它们是三种不同的东西 —— 这正是「一个词一屏三个值」的老病。
 *
 * ## 为什么是「非 COMPLETED」而不是「只有 OPEN」
 *
 * `COMPLETED` 的语义（见上）是「已交付关闭，不再占用产能、不再需要承诺」⇒ 已经**不在手**了。
 * `IN_PRODUCTION` 是「已排产、在制」—— 货还没交出去，钱还没结清，**在手**。
 * 所以在手 = 全簿 − 已完成，而**不是**只数 `OPEN`（那是另一个口径，见下）。
 *
 * ## ⚠ 与 `portfolio.ts` / `chain-impediment.ts` 的 `status === "OPEN"` 不是同一个口径，别去"统一"
 *
 * 那两处数的是「**产能分配决策集**」——已排产的在制单不该再进决策集抢一次产能，
 * 所以它们排除 `IN_PRODUCTION` 是**对的**。两个口径回答的是两个问题：
 *  · 「还有多少货没交出去？」  ⇒ 在手 = 本常量（含在制）
 *  · 「还有多少单要排产？」    ⇒ 决策集 = 仅 `OPEN`
 * 把它们合成一个常量，就会重演 `OrderLineStatus` 那次「把两个正交维度压成一个字段」的病。
 */
export const ON_HAND_ORDER_STATUSES: readonly OrderStatus[] = ["OPEN", "IN_PRODUCTION"];

/** 「在手」谓词（单一出处 —— 逐处 `!== "COMPLETED"` 的字面量比较一律换成本函数）。 */
export function isOnHandOrderStatus(status: unknown): boolean {
  return typeof status === "string" && (ON_HAND_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * 在手口径的**屏上措辞**（单一出处）。卡片副标题与台账脚注同读此串 ——
 * 修了口径却忘了改屏上那句话，等于换了个花样继续骗人。
 */
export const ON_HAND_ORDER_CAPTION = "订单簿口径 · 未完成态（已下待排产 + 进行中），不含已交付关闭单";
