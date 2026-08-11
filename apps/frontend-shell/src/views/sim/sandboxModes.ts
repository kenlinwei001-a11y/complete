/**
 * WO-SANDBOX-IA-CONSOLIDATE · **推演沙盘的模式登记表**（单一出处）。
 *
 * ── 这张表回答的问题：沙盘这一屏，现在到底在回答哪一问 ────────────────────────
 * 收编之前，这五问各占一个导航条目、各是一页：用户得自己记住「先看归因、再试一手、
 * 最后求最优」这个顺序，并靠导航在五页之间来回跳（跳一次 = 上下文清零一次）。
 * 收编之后它们是**同一屏的五个模式**，而模式的**排列顺序本身就是产品表达**：
 *
 *   现状 → 归因 → 试一手 → 求最优 → 影响半径
 *   ────  ────  ──────  ──────  ────────
 *   看见   为什么  改一个   最优解   万一断了
 *   什么   会这样  试试看   是什么   波及多大
 *
 * 这是一条**决策链**，不是一排并列的 tab。顺序改了，表达就变了 ——
 * 所以顺序在这张表里定，不在渲染处随手排；测试对着这张表咬顺序（改了会红）。
 *
 * ── 硬约束（本表的存在理由之一）────────────────────────────────────────────────
 * **任何时刻只呈现一个模式的内容。** 切模式 = 换一整屏，不是往同一屏上叠加。
 * 判据是「另一个模式的内容**不在 DOM 里**」，不是 `hidden` / `display:none` ——
 * 后者只是让人看不见：DOM 还在、请求照发、屏幕阅读器照读、页面照样越来越挤。
 * 仓主对这一屏的原话是「信息太多，第一层看不到重点」；并完更挤 = 这次合并是负分。
 *
 * ⚠ 与画布模式（`sandboxConsoleModel.ts` 的 `CANVAS_MODES`）**不是一回事**，别混：
 *   · `CANVAS_MODES`（线路图 / 物理拓扑 / 链路阶段 / 本体拓扑）是「现状」这**一个**模式
 *     内部、中栏那块画布的四种画法 —— 换的是**同一问的画法**；
 *   · 本表换的是**问题本身**。层级不同，故两张表分开、不合并。
 */

/** 模式序列 = 决策链顺序（顺序即表达，不许随手改）。 */
export const SANDBOX_MODES = ["now", "attribute", "tryone", "optimize", "radius"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];

/** 按钮文案（第一层只放「它是什么的一个名字」，口径与说明降到 title/副标题）。 */
export const SANDBOX_MODE_LABEL: Record<SandboxMode, string> = {
  now: "现状",
  attribute: "归因",
  tryone: "试一手",
  optimize: "求最优",
  radius: "影响半径",
};

/** 一句话：这个模式回答哪一问（按钮 title + 屏上副标题共用，措辞只有这一处）。 */
export const SANDBOX_MODE_QUESTION: Record<SandboxMode, string> = {
  now: "现在到底怎么样？（全链线路图 / 物理拓扑 / 阻滞点 / 节点检视）",
  attribute: "为什么会这样？（共享瓶颈 / 隐性集中度 / 毛利倒挂）",
  tryone: "改一个假设会怎样？（通用假设推演）",
  optimize: "最优解是什么？（参数扰动看目标 Δ）",
  radius: "万一断了，波及多大？（反向多跳逐层扇出）",
};

/**
 * 各模式对应的**原独立页 view key**（= `ShellLayout.CONSOLIDATED_INTO_SANDBOX` 里的键）。
 * 用途有二：① 屏上给出「这一屏原来是哪一页」的深链接（书签/外部链接仍可达，且用户看得见对应关系）；
 *          ② 测试/门按此对账「模式表」与「收编表」不许漂移 —— 两张表各写一半、没人对账，
 *             正是本仓 #99/#110 那个坑。
 * `now` 不是某一页的替身（它是沙盘控制台本身，一屏里含五个原独立页），故为 null。
 */
export const SANDBOX_MODE_ORIGIN_VIEW: Record<SandboxMode, string | null> = {
  now: null,
  attribute: "cleanroom-attr",
  tryone: "what-if",
  optimize: "optimize-whatif",
  radius: "disruption-radius",
};

/**
 * ── 跨模式上下文 ──────────────────────────────────────────────────────────────
 * 合并的价值全在这里：**不带上下文的合并，只是把五个页面塞进一个 tab 条**（等于没做）。
 *
 * 今天真正**跨模式带得动**的只有基地范围一项，故本类型只有这一个字段 ——
 * 这是诚实的边界，不是"先占个位"：
 *  · **基地**：`SandboxConsole` 左栏勾选 → 真进 `chain_impediments` 的 `args.scope.baseIds`。
 *    这句**不是本文件的主张**，单一出处是 `SandboxConsole.tsx` 的 `sc-scope-reach` 那段既有诚实位
 *    （连同它的数字一起，读那里；本文件不复述、不重新主张，免得两处措辞将来各飘各的）。
 *    复验：`cd apps/frontend-shell && npx vitest run test/sandbox-console.seam.test.tsx`
 *    的「范围三维**逐消费方**标接线」一例（断言基地勾选真进 `args.scope`）。
 *    提升到壳里之后，切模式不丢。
 *  · **订单锚点**：今天不是壳级控件 —— 它由线路图自己按 `so` 取（`chain_loss_attribution`
 *    唯一认的入参），壳里没有第二个订单选择器。硬造一个"看起来能选、其实各模式各用各的"
 *    的下拉，就是本仓最恨的假旋钮。要做得先把线路图的锚点提上来，那是另一张单。
 *  · **时窗**：两个链路求解器**都没有时间窗入参**（`SandboxConsole` 顶栏那个 `30D/60D/90D`
 *    因此是禁用的 + 挂「时窗无 ARGS」徽标）。壳里再加一个能点的时窗 = 造第二个假旋钮。
 * 这两条的缺席在屏上明写（`sandbox-scope-strip` 的诚实位），不静默省略。
 */
export interface SandboxScope {
  /** 选中的基地 id（空数组 = 全部基地，与 `SandboxConsole` 内部口径一致）。 */
  baseIds: string[];
}

export const EMPTY_SANDBOX_SCOPE: SandboxScope = { baseIds: [] };

/** 上下文的人读摘要（壳与各模式共用同一句，避免两处各写一套措辞后漂移）。 */
export function describeSandboxScope(scope: SandboxScope): string {
  return scope.baseIds.length === 0 ? "全部基地" : `${scope.baseIds.length} 个基地：${scope.baseIds.join(" · ")}`;
}
