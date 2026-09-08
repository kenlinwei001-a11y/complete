/**
 * ══ WO-SIM-SHELL-TABS · 统一推演控制台的**模式登记表**（单一出处）══════════════
 *
 * 这张表回答一个问题：`/v/sim-unified` 这一屏，顶部那排页签有哪些档、什么顺序、
 * 每一档的内容从哪来。**顺序即产品表达** —— 与 `../sandboxModes.ts` 同一条纪律：
 * 顺序在表里定，不在渲染处随手排；门对着这张表咬顺序（改了会红）。
 *
 * ── 为什么不复用 `sandboxModes.ts` 的 `SANDBOX_MODES` ────────────────────────
 * 第 ① 单（WO-SIM-UNIFIED-SHELL）把 `SANDBOX_MODES`（现状/归因/试一手/求最优/影响半径）
 * 原样搬来当占位。**那是另一屏的模式表**：它换的是「旧沙盘控制台 `SandboxConsole` 的五问」，
 * 各档对应 `cleanroom-attr` / `what-if` / `optimize-whatif` / `disruption-radius` 四个**通用页**。
 * 本屏（统一推演控制台）换的是「这次扰动之后看哪一面」，各档对应
 * `sim-conduction` / `sim-attribution` / `sim-optimize` / `chain-line-map` 四个**推演页** ——
 * **两套模式表的成员一个都不重叠**，合成一张只会让两屏互相牵扯。故各自成表。
 * （已批准的 UX 规格 artifact 7e027dab 的 `.modes` 那一排，逐字就是本表。）
 *
 * ── 一档的内容怎么取：只有一条路 ──────────────────────────────────────────────
 * `renderer` 字段填的是 **`views/registry.ts` 里 `registerRenderer` 的那个 key**，
 * 由 `getRenderer(key)` 解析 —— 与 `ViewPage` **逐字同构的同一条分发路径**。
 * 好处有三，缺一条都不该另开第二条路：
 *  ① **懒加载白拿**：`registerRenderer` 内部就是 `lazy(() => import(...))`，
 *     没被选中的档连 chunk 都不会下载（本单判据之一，见接缝门第 ③ 臂）。
 *  ② **不制造第二个挂载口**：四页仍然只有一处 import（registry），
 *     改注册即两处同时生效，不会出现「独立路由改了、页签里还挂着旧组件」。
 *  ③ **门已经在看着它**：`scripts/check-nav-group-coverage.mjs` 判据⑦ 对账
 *     registry 的每个 key 有没有路径渲染得到；本表引用的是同一批 key。
 *
 * ⚠ **本表不写 `import()`**：写了就是第二条取数路，且会把四页拖进本壳的首屏 chunk。
 *
 * ── 「未接线」为什么占位禁用而不是隐藏 ───────────────────────────────────────
 * 沿用第 ① 单的裁决原文：**隐藏 = 假装没这功能**。规格里的九档中，本单只接四档
 * （`演习结论` / `传导边册` / `本体与就绪` 属后续单），它们**在表里留档、按钮禁用、
 * `title` 写明为什么还点不动** —— 用户看得见「这一屏最终有这些面」，也知道今天点不动。
 */

/** 模式序列 = 已批准 UX 规格里 `.modes` 那一排的顺序（顺序即表达，不许随手改）。 */
export const UNIFIED_MODES = [
  "now",
  "conduction",
  "attribution",
  "optimize",
  "verdict",
  "linemap",
  "edges",
  "readiness",
] as const;
export type UnifiedMode = (typeof UNIFIED_MODES)[number];

/**
 * ══ WO-SIM-TICK-GATE（2026-08-29）· 问句里的**计数一律现算**，不许写死 ══════════
 *
 * ── 今天的行为是 X ────────────────────────────────────────────────────────────
 * 两句问句里各写死了一个数，**两个今天都是错的**（2026-08-29 真后端 `SEED_DEMO=1` 实测）：
 *  · `edges` 写「**38** 条因果边」，而同一屏右栏 `EdgeActivePanel` 写「**42** 条边」——
 *    **同一屏两个数打架**，且 42 是对的。
 *  · `now` 写「**37** 个状态变量」，而卡墙的卡片数 = `view-config.stateVars.length` = **40**。
 *
 * 实测证据（`GET /a/v1/sim/view-config`，demo 租户）：`propagationCount = 42` · `stateVars = 40`；
 * 逐域现算 `D03:8 D04:4 D05:7 D06:2 D07:3 D08:3 D09:2 D10:4 D11:2 未归域:7` **合计 42**，
 * 且 `GET /a/v1/sim/propagation-rules` 回的 42 条**全部 PUBLISHED**。
 * 「38」的出处追到 `apps/datacore/src/seed.ts` 头注那句「共 **38 条**」—— 那是**加边之前**的旧数，
 * 边加到 42 之后没人回来改这句话（本仓治过多次的「手抄的数不会自己失效」）。
 *
 * ── 应该是 Y ─────────────────────────────────────────────────────────────────
 * `question` 从**常量串**改成**吃现算计数的函数**，计数由壳从 `view-config` 那一份回包取。
 * 于是新增一条边、改一次本体，屏上两处**同时**跟着变，**没有人需要记得回来改这里**。
 *
 * ⚠ 判据落在「**两处读同一个来源**」上：本表的 `propagationRules` 取
 * `view-config.propagationCount`，后端那一行是 `propagationCount: rules.length`，
 * 其中 `rules = repos.sim.listPropagationRules(tenantId, true)` ——
 * 与 `EdgeActivePanel` 的 `fetchPropagationRules(true).items.length` **是同一个仓储调用、同一个实参**。
 * 两处不是"各查一次碰巧相等"，是同一份真相的两次投影。
 */
export interface UnifiedModeCounts {
  /**
   * 传导规则（因果边）条数 = `view-config.propagationCount`。
   * `null` = view-config 这一跳还没回来 ⇒ **「还不知道」，不是 0**（不许拿 0 兜底印在屏上）。
   */
  readonly propagationRules: number | null;
  /** 状态变量个数 = `view-config.stateVars.length` —— 卡墙的卡片数就是它。`null` 同上。 */
  readonly stateVars: number | null;
}

export interface UnifiedModeSpec {
  /** 按钮文案（第一层只放「它是什么的一个名字」，口径与说明降到 `title`）。 */
  readonly label: string;
  /**
   * 这一档回答哪一问（按钮 `title` 用，措辞只有这一处）。
   *
   * **是函数不是常量串**：问句里凡出现计数，一律由 `counts` 现算填进去（判据见本节头注）。
   * 计数没到手时（`null`）必须**换一种说法**，不许印 `0` 也不许印 `—— 条`。
   */
  readonly question: (counts: UnifiedModeCounts) => string;
  /**
   * 组标签 = 规格里那几个 `.grp` 分隔符（`扰动后` / `图` / `底账`）。
   * `null` = 不另起一组（跟在上一组里）。第一档 `now` 无组标签。
   */
  readonly group: string | null;
  /**
   * 这一档挂哪个 renderer（`views/registry.ts` 的 key）。
   * `null` = **本壳自带**（`now` 的指标卡墙 + 右栏检视，第 ① 单交付）。
   * 卡墙有几张卡由 `view-config.stateVars` 现算 —— 此处**不写死一个张数**（写死的那版是 37，实测 40）。
   */
  readonly renderer: string | null;
  /**
   * 尚未接线的档：这里写**为什么**（人话，会显示在禁用按钮的 `title` 里）。
   * `null` = 已接线、可点。
   */
  readonly pending: string | null;
}

export const UNIFIED_MODE_SPEC: Record<UnifiedMode, UnifiedModeSpec> = {
  now: {
    label: "指标态势",
    question: (c) =>
      c.stateVars === null
        ? "这次扰动之后，每个状态变量各自动了没有、动了多少（状态变量个数还没取到）"
        : `这次扰动之后，${c.stateVars} 个状态变量各自动了没有、动了多少`,
    group: null,
    renderer: null,
    pending: null,
  },
  conduction: {
    label: "传导识别",
    question: () => "扰动沿哪条链传下去、每一跳被谁挡住",
    group: "扰动后",
    renderer: "sim-conduction",
    pending: null,
  },
  attribution: {
    label: "损失归因",
    question: () => "一张单全链走完，每个环节吃掉了多少",
    group: null,
    renderer: "sim-attribution",
    pending: null,
  },
  optimize: {
    label: "方案寻优",
    question: () => "针对这次扰动给对策，按目标做帕累托排序",
    group: null,
    renderer: "sim-optimize",
    pending: null,
  },
  verdict: {
    label: "演习结论",
    question: () => "这次推演的结论是什么、凭哪几条证据",
    group: null,
    renderer: null,
    // ⛔ 措辞里不许出现「工单 / 本单」这类**排期语汇**：那是开发内部的说法，用户读不懂
    //    （与本轮「动作 pin:xxx（本单不落写操作）」同一条病，接缝门 ⑩ 臂扫全屏可见文本）。
    pending: "这次推演的结论页还没有做好，所以现在点不动 —— 三个后端接口已经好了，缺的是这一档的版面",
  },
  linemap: {
    label: "产销线路图",
    question: () => "站 = 环节，站圈 = 该环节吃掉的全链损失占比",
    group: "图",
    renderer: "chain-line-map",
    pending: null,
  },
  edges: {
    label: "传导边册",
    question: (c) =>
      c.propagationRules === null
        ? "因果边按域分组，关掉一条看结论怎么变（边数还没取到）"
        : `${c.propagationRules} 条因果边按域分组，关掉一条看结论怎么变`,
    group: "底账",
    renderer: null,
    pending: "整册的版面还没有做好；今天要关掉某条边，在传导识别 / 损失归因 / 方案寻优三档底部的折叠抽屉里",
  },
  readiness: {
    label: "本体与就绪",
    question: () => "这个推演世界凭什么可信（就绪认证 + 真实性标注）",
    group: null,
    renderer: null,
    pending: "就绪认证与真实性标注这两张表还没有做好，所以现在点不动",
  },
};

/** 已接线（可点）的档。判据只有一条：`renderer !== null` 或它就是本壳自带的 `now`。 */
export function isModeLive(mode: UnifiedMode): boolean {
  return UNIFIED_MODE_SPEC[mode].pending === null;
}

/**
 * 本表引用的 renderer key 全集（去重、保表序）。
 * 存在的理由：门/测试要对账「这些 key 在 `views/registry.ts` 里真注册过」——
 * 各处再抄一遍键名就会漂（改了表而门拿旧名单去测、照样绿）。
 */
export const UNIFIED_MODE_RENDERER_KEYS: readonly string[] = UNIFIED_MODES.map(
  (m) => UNIFIED_MODE_SPEC[m].renderer,
).filter((k): k is string => k !== null);
