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
 *   · `CANVAS_MODES`（线路图 / 物理拓扑 / 链路阶段 / 本体拓扑 / **业务流程**）是「现状」这
 *     **一个**模式内部、中栏那块画布的画法 —— 换的是**同一问的画法**；
 *   · 本表换的是**问题本身**。层级不同，故两张表分开、不合并。
 *
 * ⚠ **2026-08-17 实测订正（WO-SANDBOX-NAV-CONSOLIDATE）**：本段原文写「**四种**画法」并逐个点名 ——
 *   `CANVAS_MODES` 早已是**五档**（`sandboxConsoleModel.ts` 的
 *   `["metro","topo","chain","ontology","process"]`，第五档 `process` 由 WO-SANDBOX-PROCESS-MODE 加入）。
 *   写死枚举成员的注释天生带保质期，而这一条过期的后果是**真的**：审核方据「第五档」这个词
 *   推断第五档指本表的 `radius`（影响半径），从而认为「流程那一块的内容早就搬进沙盘了」。
 *   实测两者都不对 —— 「第五档」是 `CANVAS_MODES` 的 `process`，而它复用的是
 *   `ProcessInspectPanel`（检视面板）＋ 同一个 `GET /a/v1/process-definitions` 端点，
 *   **不是** `/v/process-wait` 那一页的主体（四态分组表 / 「等谁」 / 到实例层的卡单计数与跳转
 *   一条都不在第五档里）。故本单不是「把已经搬完的登记一下」，是**真收编**（见下 §档）。
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

// ══════════════════════════════════════════════════════════════════════════════
// § 模式内的「档」（WO-SANDBOX-NAV-CONSOLIDATE）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ── 为什么加「档」这一层，而不是加第六个模式 ──────────────────────────────────
 * 仓主指着侧栏「归因与风险」组问「**为何导航栏还有这2个**」。实测根因不是漏配，是
 * **整组的收编承诺被逐条豁免掏空**：本组原本两项都带 `consolidatedWhen: "sim.sandbox"`
 * （沙盘一开整组消失），后来三张单各加了一项、每一项都不带 —— 每条豁免单独看都成立
 * （「沙盘五模式里没有它，带了页面就不可达」），**合起来把整组掏空了**。
 *
 * 修法只有一条不违反红线的路：**把那三页真收编进沙盘**（删条目而无替代入口 = 页面不可达）。
 * 收编的落点判定如下 —— 判据取「它回答哪一问」，与本表上方那条决策链对齐：
 *
 *   | 页                  | 它回答什么                          | 落点            |
 *   |--------------------|-------------------------------------|-----------------|
 *   | `process-wait`     | 这**类**流程通常在等哪一类东西       | 归因（模板层档） |
 *   | `process-stuck`    | **这一张单**此刻卡在第几步、等谁      | 归因（实例层档） |
 *   | `procurement-legs` | 这批料晚在哪一段、今天该打哪通电话    | 归因（责任方档） |
 *
 * 三页在 `ShellLayout.NAV_GROUPS` 里的既有注释各自都写着「它答的是『现状为什么这样』（归因）」——
 * 这不是本单新造的分类，是把仓库自己已经写下的判断执行掉。
 *
 * ⚠ **为什么不新增模式**：`SANDBOX_MODES` 的顺序即产品表达（见本文件头）。这三页与
 *   `cleanroom-attr` 回答的是**同一问**（为什么会这样），只是看的对象不同（链路损失 /
 *   流程模板 / 流程实例 / 采购责任方）。同一问的不同对象 = **档**，不是新的一环 ——
 *   插进决策链会把「五问」变成「八问」，而其中四问其实是同一问。
 *
 * ⚠ **与 `CANVAS_MODES` 仍然不是一回事**（本文件头那条硬约束一个字没改）：
 *   · `CANVAS_MODES` 换的是**同一问的画法**（线路图/物理拓扑/链路阶段/本体拓扑/业务流程）；
 *   · 本表换的是**同一问的对象**（看链路 / 看流程模板 / 看流程实例 / 看采购段）。
 *   两者都在「模式之下」这一层，但一个换画法、一个换对象，故各自成表、不合并。
 *
 * ⚠ **`process-wait` 与 `process-stuck` 不合并**（上一轮已裁决，本单不推翻）：
 *   模板层 vs 实例层，`waitStateOrigin` 的 `DEFINITION_TEMPLATE` vs `TASK_GATE` 分的正是这两者。
 *   它们进同一个模式**做两档**，各自渲染各自的整页，一个字都没揉在一起。
 */
export const SANDBOX_ATTRIBUTE_TABS = ["cleanroom", "process-wait", "process-stuck", "procurement-legs"] as const;
export type SandboxAttributeTab = (typeof SANDBOX_ATTRIBUTE_TABS)[number];

/**
 * 一档怎么取内容。**两种来源不许混**，因为它们的 R3 守卫机制不同：
 *  · `component`      —— 直接懒加载组件（净室通用页那一类：`App.tsx` 专用 route，不经后端下发，
 *                        人人可进、无 entitlement 闸）；
 *  · `workspace-view` —— 走 `workspace.views` + `getRenderer` 的**同一条分发路径**（与 `ViewPage`
 *                        逐字同构）。这条路把 R3 双闸（`features.includes("view.<key>")` +
 *                        `workspace.views` 有没有它）原样带进沙盘 —— 于是「暗发键关着 ⇒ 沙盘里
 *                        这一档整个不存在」是**结构保证**，不是我在这里手写一个 if。
 *                        `process-stuck` 挂在 `process.runtime`（`defaultOn:false`）正是靠这条。
 */
export type SandboxTabSource = "component" | "workspace-view";

export interface SandboxTabSpec {
  readonly label: string;
  /** 这一档回答哪一问（按钮 aria-label + 屏上副标题共用，措辞只有这一处）。 */
  readonly question: string;
  /** 这一档的**原独立页 view key**（= `ShellLayout.CONSOLIDATED_INTO_SANDBOX` 的键·门按此对账）。 */
  readonly originView: string;
  readonly source: SandboxTabSource;
}

/**
 * 「归因」模式的四档。**顺序 = 从粗到细**：先看链路哪一段亏（`cleanroom`），
 * 再看这类流程在等什么（模板层），再看具体哪一张单卡着（实例层），最后看该给谁打电话（责任方）。
 * 顺序与 `SANDBOX_MODES` 同理写在这张表里、不在渲染处随手排；测试对着这张表咬顺序。
 */
export const SANDBOX_ATTRIBUTE_TAB_SPEC: Record<SandboxAttributeTab, SandboxTabSpec> = {
  cleanroom: {
    label: "净室归因",
    question: "这条链的损失落在哪一段？（净室口径的全链归因）",
    originView: "cleanroom-attr",
    source: "component",
  },
  "process-wait": {
    label: "流程等待态",
    question: "这**类**流程通常在等哪一类东西？（模板层·四态分组）",
    originView: "process-wait",
    source: "workspace-view",
  },
  "process-stuck": {
    label: "流程卡点",
    question: "**这一张单**此刻卡在第几步、等谁、等了多久？（实例层·现场值）",
    originView: "process-stuck",
    source: "workspace-view",
  },
  "procurement-legs": {
    label: "采购四段腿",
    question: "这批料晚在哪一段、今天该打哪通电话？（责任方可归属的四段）",
    originView: "procurement-legs",
    source: "workspace-view",
  },
};

/** 「归因」模式的默认档（= 收编之前那个模式唯一的那一页，行为向后兼容）。 */
export const SANDBOX_ATTRIBUTE_DEFAULT_TAB: SandboxAttributeTab = "cleanroom";
