/**
 * WO-SIM-CONSOLE-DAYS · 推演控制台轨道横轴的**唯一换算点**（tick 序号 → 天）。
 *
 * ══ 病灶：今天的行为是 X，应该是 Y（本单开工前实测）═══════════════════════════
 *
 * **X（2026-08-25 改造前实测原文，三处逐字节相同；复验 `grep -rn 'ticks.map' apps/frontend-shell/src/views/sim/console/`）**：
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
 * 后端也早就在吃「天」并**把口径随回包一起下发**（见下）——缺的只是前端这一半没挂上去。
 * 2026-08-25 开工前实测：`daysForTicks` 定义在契约里，而**前端一处都没有调用它**
 * （金丝雀：同文件的 `ticksForDays` 同一条 grep 命中 10 行 ⇒ 工具没坏）。
 * ✅ **本单已把它接上**，现有 3 处引用（本文件 · `views/sim/unified/metricWallModel.ts` ·
 * 定义处 `packages/contracts/src/sim.ts`）。
 * 复验：`grep -rn daysForTicks apps/frontend-shell/src packages/contracts/src`。
 *
 * ⚠ **这段话原本写的是「全仓零消费方」，本单接上之后它就成了假话** ——
 * 被 `node scripts/check-stale-claims.mjs` 的 STALE-4 当场咬红逼出来的，不是人想起来的。
 * 教训：**描述"当时的观测"要用不会被读成"现状"的措辞** —— 一句「零消费方」留在活注释里，
 * 前后包多少「这是沿革」都没用：下一个读者只会读到那六个字。
 *
 * **Y（本单落地）**：三处统一走本文件，标签按「天」说人话。
 *
 * ══ 口径从**回包**取，不从会话取（方案 A）—— 这不是本单的选择，是契约定的 ═══════
 *
 * `SimMetricSeriesResponseSchema` 自带 `tickDays`，且它的注释**把两条路都写下来并选了 A**
 * （`packages/contracts/src/sim.ts` 该字段处，原话）：
 *
 * > 消费方 `views/sim/console/MetricGantt.tsx` 的横轴**直接渲染 `series.ticks` 的裸序号**，
 * > 它手上只有这一个响应。走 B 就得让每个消费方各自再拼一次 `useConsoleSession` ——
 * > 而「换算口径从哪来」这件事一旦有两个出处，迟早漂（本仓治过多次的第二套真相源）。
 *
 * ⚠ **本单开工时先按方案 B 写了一版（从 `useConsoleSession` 把 `tickDays` 一路透到三个
 *   hook），实测到上面这段注释后整版撤回。** 留这段账在这里，是因为方案 B 看起来更"正统"
 *   （口径跟着世界走），下一个人很容易再走一遍：
 *   · B 要动 `useConsoleSession` + 三个 Route + 四个组件 + 三个 hook，**七处签名**；
 *   · 而 `useConsoleSession` 的 `explicit` 那条路**刻意不查会话列表**（省一跳），
 *     于是 B 在那条路上**永远拿不到 `tickDays`**，只能要么猜 1（真实 7 时把「第 35 天」
 *     写成「第 5 天」，差 7 倍且不会有任何东西报错），要么在屏上标"口径未知"；
 *   · A 只动三个 hook 的函数体，且**天然没有"拿不到"这一态** —— 要换算就说明回包在手，
 *     回包在手就一定有口径。
 *
 * 后端确实恒填（**不是"schema 里有"就算数**，本仓刚为这个区别记过账）：
 *   · `apps/datacore/src/app.ts` 的 metric-series 路由 → `buildMetricSeries({… tickDays: s.tickDays ?? 1})`；
 *   · `apps/datacore/src/sim/metric-series.ts:399` → `tickDays: Math.max(1, Math.floor(args.tickDays ?? 1))`。
 *   复验：`grep -n "tickDays" apps/datacore/src/sim/metric-series.ts`
 *   （金丝雀：同函数里必中的 `appliedOrder` 现算命中 3 行；它若也报 0，是工具坏了）。
 *
 * ══ 为什么换算复用契约的 `daysForTicks`，不在前端另写一份 ═══════════════════
 *
 * 与 `ticksForDays` 放进契约是同一条理由（那条注释的原话）：**UI 与引擎必须用同一份判据**。
 * 各写一份 = 第二套真相源 —— 引擎按 `ceil(N / tickDays)` 推 tick、屏上按另一套算天，
 * 这种错**不会崩，只会静默算错**。本仓已吃过「两份逐字节相同的副本、改一份漏一份不会红」的亏，
 * 故本文件**只做措辞**，一个算术都不自己算。
 *
 * ⚠ 占位模式（没会话 / 这一跳失败 / 回包零指标）**一格都不走本文件**：
 * 那三处的 `HOUR_TICKS` / `SERIES_TICKS` / `EXEC_TICKS` 是规格 `docs/ux-spec/sandbox/*.html`
 * 的**墙钟时刻**（`00:00`…`28:00`），四页像素级 1:1 的验收线咬着它们，
 * 且它们压根不是 tick 序号 —— 拿天去换算就是把规格占位改成假数据。
 */
import { daysForTicks } from "@platform/contracts";

/**
 * 回包的 `tickDays` → 真正用来换算的那个数。
 *
 * `?? 1` 在**这里**是安全的，理由与「拿不到会话就别猜」**不冲突**，区别在于问的是谁：
 * 本函数的入参来自**已经在手的回包**，契约对该字段写的是
 * 「缺省 `1` ⇒ 本字段引入前的响应照旧解析、读出来恒 `1`（additive · 可回退）」——
 * 即「回包里没这一格」**就是**「一 tick 一天」，不是「不知道」。
 * （反面：方案 B 里 `explicit` 那条路是**连回包带会话都没问过**，那才是"不知道"。见文件头注。）
 */
export function tickDaysOf(responseTickDays: number | undefined): number {
  return responseTickDays ?? 1;
}

/**
 * 单格标签。**说人话**：用户不看说明也该知道这是天。
 *
 * ⚠ 标签宽度：真数据模式下每格 4 个字（`第 30 天`），比规格占位那套 `00:00` 的 5 个字**更短**，
 * 故不会把轨道头撑得比像素基线更宽。（真数据模式本来就不在像素 1:1 的验收线上 ——
 * 它渲染的刻度条数由回包决定，与规格那 15 条无关。）
 */
export function tickAxisLabel(tick: number, responseTickDays: number | undefined): string {
  return `第 ${daysForTicks(tick, tickDaysOf(responseTickDays))} 天`;
}

/**
 * 整条轴。三个 hook 的 `ticks.map((t) => String(t))` 一律换成这一句。
 *
 * ⚠ **别在调用点自己 `map` 一份出来** —— 那就是本文件要消灭的那三份副本又长回来。
 */
export function tickAxisLabels(ticks: readonly number[], responseTickDays: number | undefined): string[] {
  return ticks.map((t) => tickAxisLabel(t, responseTickDays));
}
