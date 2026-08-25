/**
 * WO-SIM-CONSOLE-DAYS · 推演控制台轨道横轴的**唯一换算点**（tick 序号 → 天）。
 *
 * ══ 病灶：今天的行为是 X，应该是 Y（本单开工前实测）═══════════════════════════
 *
 * **X（改造前实测原文，三处逐字节相同）**：
 * ```ts
 * ticks: ticks.map((t) => String(t))          // useMetricSeries.ts:412  （首页·指标甘特）
 * ticks: ticks.map((t) => String(t))          // useLossAttribution.ts:699（归因台·环节序列）
 * ticks: res.ticks.map((t) => String(t))      // useParetoFrontier.ts:738 （寻优台·执行对比）
 * ```
 * 三处都把**回包的 tick 序号原样当成轴标签**上屏。用户在沙盘输「推演 30 天」，
 * 屏上写的是 `0 1 2 …`；`tickDays > 1` 时更错 —— 5 个 tick 其实是 35 天，屏上写着 `0..4`。
 *
 * ⚠ 这是本仓三态里的**第三态「接了线接错地方」**，不是「没接线」也不是「接了线没数据」：
 * 换算函数 `daysForTicks`（`packages/contracts/src/sim.ts:238`）**早就存在**，
 * 后端两处也早就在吃「天」（`app.ts:2849` 与 `sim/drill-orchestrator.ts:622` 的 `ticksForDays`）——
 * 缺的只是前端这一半从来没挂上去。开工前实测 `daysForTicks` **全仓零消费方**
 * （金丝雀：同文件的 `ticksForDays` 同一条 grep 命中 10 行 ⇒ 工具没坏，是真的零）。
 *
 * **Y（本单落地）**：三处统一走本文件，标签按「天」说人话；`tickDays` 拿不到时**不猜**。
 *
 * ══ 为什么换算复用契约的 `daysForTicks`，不在前端另写一份 ═══════════════════
 *
 * 与 `ticksForDays` 放进契约是同一条理由（那条注释的原话）：**UI 与引擎必须用同一份判据**。
 * 各写一份 = 第二套真相源 —— 引擎按 `ceil(N / tickDays)` 推 tick、屏上按另一套算天，
 * 这种错**不会崩，只会静默算错**。本仓已吃过「两份逐字节相同的副本、改一份漏一份不会红」的亏，
 * 故本文件**只做取整与措辞**，一个算术都不自己算。
 *
 * ══ ⚠ 拿不到 `tickDays` 时为什么不默认 1（本文件最容易被"优化"掉的一条）═══════
 *
 * 契约确实写了「缺省 1」「消费方一律写 `?? 1`」—— 但那句话的主语是
 * **「会话对象在手、只是 `tickDays` 这一格没填」**。它不覆盖另一件事：
 * **压根没有会话对象**。两者是不同的命题，混成一句就会静默显示一个可能错的天数：
 *
 *   | 情形 | 判据 | 本文件的处置 |
 *   |---|---|---|
 *   | 会话在手，`tickDays` 有值 | `useConsoleSession` 走 `auto` 且服务端填了 | 按该值换算，标 `day` |
 *   | 会话在手，`tickDays` 缺失 | 走 `auto`，本字段引入前建的旧世界 | **`?? 1`**（契约明写「缺失与 1 同义」）⇒ 标 `day` |
 *   | **没有会话对象** | 走 `explicit`（宿主只给了 id，列表 `enabled:false` ⇒ 一条会话都没查） | **不猜**：按 tick 说话，标 `tick` |
 *
 * 第三行落 `?? 1` 会怎样：真实 `tickDays=7` 的世界上，屏上把「第 35 天」写成「第 5 天」——
 * **差 7 倍，而且不会有任何东西报错**。这正是本仓反复记账的那种「永远绿的错」。
 * 故第三行退回 tick 口径并**在屏上就说得出来**（`第 N 拍`，「拍」= 本仓对 tick 的既有说法，
 * 见 `useMetricSeries.ts` 头注的「建会话 → **走两拍** → 取回包」），
 * 同时把口径挂在 `data-tick-unit` / `data-tick-days` 上供门断言。
 *
 * ⚠ 别把第三行"补齐"成 `?? 1` —— 要真正消除它，正确修法在**宿主**：
 * `explicit` 那条路今天不查列表（`useConsoleSession` 刻意如此，省一跳且让「打的是显式那个 id」
 * 可被直接断言），要拿到 `tickDays` 得改成打裸 `GET /a/v1/sim/sessions/:id`
 * （后端 `apps/datacore/src/app.ts:1968` **已存在**）。那是行为改动，属另一张单，
 * 不在本单的 🚦 范围边界内。
 *
 * ⚠ 占位模式（没会话 / 这一跳失败 / 回包零指标）**一格都不走本文件**：
 * 那三处的 `HOUR_TICKS` / `SERIES_TICKS` / `EXEC_TICKS` 是规格 `docs/ux-spec/sandbox/*.html`
 * 的**墙钟时刻**（`00:00`…`28:00`），四页像素级 1:1 的验收线咬着它们，
 * 且它们压根不是 tick 序号 —— 拿天去换算就是把规格占位改成假数据。
 */
import { daysForTicks } from "@platform/contracts";

/**
 * 轴的口径。**两态互斥，不许合并成一个布尔** —— `day` 是"这是第几天"，
 * `tick` 是"这是第几拍、而一拍几天我不知道"。后者不是前者的降级显示，是**另一句话**。
 */
export type TickAxisUnit = "day" | "tick";

/**
 * 会话的 `tickDays` → 轴口径。`undefined` = 没有会话对象（不是"会话说它是 1"）。
 *
 * 入参刻意收 `number | undefined` 而不是 `number`：调用方要是先写了 `?? 1`
 * 再传进来，这一位就永远翻不到 `tick`，而"永远翻不到"的诚实位等于没有。
 */
export function tickAxisUnit(tickDays: number | undefined): TickAxisUnit {
  return tickDays === undefined ? "tick" : "day";
}

/**
 * 单格标签。**说人话**：用户不看说明也该知道这是天。
 *
 * · 口径已知 ⇒ `第 N 天`，`N = daysForTicks(tick, tickDays)`（契约的那一份，不自己算）；
 * · 口径未知 ⇒ `第 N 拍`，`N` 是回包给的 tick 序号原样 —— **说得出来的那一半照说，
 *   说不出来的那一半不编**。
 *
 * ⚠ 标签宽度：真数据模式下每格 4 个字（`第 30 天`），比规格占位那套 `00:00` 的 5 个字**更短**，
 * 故不会把轨道头撑得比像素基线更宽。（真数据模式本来就不在像素 1:1 的验收线上 ——
 * 它渲染的刻度条数由回包决定，与规格那 15 条无关。）
 */
export function tickAxisLabel(tick: number, tickDays: number | undefined): string {
  return tickDays === undefined ? `第 ${tick} 拍` : `第 ${daysForTicks(tick, tickDays)} 天`;
}

/**
 * 整条轴。三个 hook 的 `ticks.map((t) => String(t))` 一律换成这一句。
 *
 * ⚠ **别在调用点自己 `map` 一份出来** —— 那就是本文件要消灭的那三份副本又长回来。
 */
export function tickAxisLabels(ticks: readonly number[], tickDays: number | undefined): string[] {
  return ticks.map((t) => tickAxisLabel(t, tickDays));
}
