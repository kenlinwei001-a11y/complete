import type { FeatureDef } from "@platform/contracts";
import { BUSINESS_DOMAIN_KEYS } from "../graphmeta.js";

/**
 * WO-MEMORY-VIEW-RESILIENCE · 内置视图单一来源（"内存模式视图默认配置防丢"·PRD §4.1）。
 *
 * 病根（真实症状·断在接缝·绿测试≠能用）：同一批"出厂内置视图"的定义此前散落 4 处，各自手维护 →
 *   ① `features.ts` FEATURE_REGISTRY（VIEW 级功能 view.*·entitlement）
 *   ② `features.ts` VIEW_FEATURE_MAP（viewKey → featureKey·workspace 导航过滤）
 *   ③ `synthetic/service.ts` VIEW_DEFS（title/renderer/layout·ViewConfig 渲染）
 *   ④ `synthetic/battery.ts` scenarioSeed.views（出厂合成种哪些视图 → ViewConfig → /me/workspace）
 * 任一处漏一项即漂移：曾出现 `global-sim` 在 ①②③ 齐备但 ④ 漏 → 内存模式（DATABASE_URL 未设）每次重启后
 * `GET /a/v1/me/workspace` 不含「全局推演」→ 页面重启即隐身（各半 unit 全绿也测不出·断在接缝）。
 *
 * 本文件把内置视图收敛为**唯一真相源** `BUILTIN_VIEWS`——①②③④ 全部从此派生：
 *   features.ts        = ...builtInViewFeatureDefs() + ...builtInViewFeatureMap()（非 VIEW 功能仍手注册·顺序不动）
 *   synthetic/service  = VIEW_DEFS 核心段从 BUILTIN_VIEWS 派生（成员集/title/renderer 单一来源·layout 运行时注入）
 *   synthetic/battery  = scenarioSeed.views = SEEDED_VIEW_KEYS（= BUILTIN_VIEWS.filter(seed).map(key)）
 * 再由 `assertViewManifestIntegrity()` 在种子路径 fail-fast：任一 seeded 视图缺 featureKey/映射/VIEW_DEF → 启动即抛。
 *
 * 本文件是叶子模块（只依赖 @platform/contracts 类型 + 零依赖叶子 `graphmeta.ts`），
 * 故 features.ts / service.ts / battery.ts 均可安全 import，无环。
 */

/**
 * 「本体图谱」(`graph`) 的视角配置 —— 修 `G-GRAPH-ENTRY-DUP`（IA 重复入口）。
 *
 * 病灶（实测，非推测）：`graph` 此前是**零配置**（`layout: {}`、无 `options`），而
 * `graph-all`（图谱·全景）显式带的 `{colorBy:"domain", layoutSeed:42}` **恰好等于前端默认值**
 * （`OntologyGraphView.tsx` 的 `DEFAULT_OPTIONS = {colorBy:"domain"}` + `layoutSeed ?? 42`）。
 * 逐条比对 `colorBy`/`nodeFilter`/`dimOthers`/`linkKinds`/`mvpOverlay`/`layoutSeed` 六个消费分支
 * **全同 ⇒ 两个导航入口渲染输出完全相同**，用户站在导航栏前无法凭标题区分。
 *
 * 裁决（仓主）：两个入口都留，但必须**真的不同**。故给 `graph` 配一组真配置。
 *
 * 为什么选「业务域 allowlist + dimOthers」这一组（判据是**语义**，不是哪个好写）：
 *  · 二者的**主语不同**：`graph-all` 自述是"14 业务域对象类型 **+ 求解器 + 智能体**一张图"——
 *    主语是**整个系统三层**；而「本体图谱」的职责是**对象本体层**的浏览器（点节点出检查器：
 *    属性/来源字段/适用规则/派生公式/字段覆盖徽章/CSV 模版，见 f7、f27）。
 *    所以差别落在"**哪一层是主角**"上，这是这两个入口本来就该有的差别。
 *  · **为什么是 `dimOthers: true`（淡出）而不是隐藏**：求解器/智能体节点仍**渲染**，
 *    只是退到背景 —— ① 用户仍可点开它们看绑定关系（本体图谱是浏览器，不该藏东西）；
 *    ② 隐藏会让 `calc`/`fb`/`orch` 边因端点消失而一起没了，图会"缺一块"而不是"分主次"。
 *  · **为什么 `layoutSeed` 仍是 42**：故意与 `graph-all` **同布局**。换种子只会把节点位置洗一遍，
 *    那是**任意**差异不是**有意义**差异；同布局反而让用户左右切换时一眼看出"同一张图，
 *    强调的层不同"。
 *  · 未选 `colorBy:"source"`（那是 `graph-source` 的职责，选它等于再造一对重复入口）、
 *    未选 `mvpOverlay`（`graph-mvp` 的职责）、未选 `nodeFilter.tiers`（`graph-backbone` 的职责）。
 *
 * 域清单取 `graphmeta.BUSINESS_DOMAIN_KEYS`（14 业务域单一来源），**不手抄** ——
 * 新增业务域时本视角自动跟随，不会因为漏抄一个域把该域整片对象误淡出。
 */
const ONTOLOGY_BROWSER_OPTIONS: Record<string, unknown> = {
  graphOptions: {
    colorBy: "domain",
    // 主角 = 业务域对象；求解器/智能体两域不在册 ⇒ 落入 dimOthers 的淡出集。
    nodeFilter: { domains: BUSINESS_DOMAIN_KEYS },
    dimOthers: true,
    layoutSeed: 42,
  },
  desc:
    "对象本体层：14 业务域的对象类型与它们之间的结构关系，点任一节点看属性、来源字段、适用规则与派生公式。" +
    "求解器与智能体属于其上的推演层与编排层，在此淡出——要三层同时看，切「图谱·全景」。",
};
export interface BuiltInView {
  /** ViewConfig 键（= 前端路由 viewKey·workspace.views[].viewKey·VIEW_FEATURE_MAP 键）。 */
  key: string;
  /** ViewConfig / 导航标题（前端 nav label + ViewConfig.title·注意与功能名 featureName 不同）。 */
  title: string;
  /** 前端 renderer 注册键（PRD §7 renderer 分发）。 */
  renderer: string;
  /** 管控功能键（entitlement·VIEW_FEATURE_MAP 值·workspace viewAllowed 查此·关=导航消失 R3）。 */
  featureKey: string;
  /**
   * 功能开关册里的功能名（`FeatureDef.name`·前端「功能开通配置」页渲染的就是它）。
   *
   * ⚠ **不是本地自治字段**：本表这批键同时被 AgentCore `features/registry.ts` 与前端 mock
   * `fixtures.ts` 声明 ⇒ 跨服务，名字的单一真相源是 `@platform/contracts` 的
   * `SHARED_FEATURE_NAMES`（WO-VIEWNAME-SINGLE-SOURCE）。这里写的值经
   * `builtInViewFeatureDefs()` 进 `features.ts` FEATURE_REGISTRY，在那里被
   * `assertSharedFeatureNames()` 逐条核对 —— 改这里不改册 ⇒ 模块加载期当场抛。
   */
  featureName: string;
  /** 是否随出厂合成种入 scenarioSeed.views（true = 核心视图·进 report.views 验收快照）。 */
  seed: boolean;
  /** 功能路由绑定（solverKeys/intents/apiTags·entitlement 中间件按此把端点/工具与功能挂钩）。 */
  bindings?: FeatureDef["bindings"];
  /** 静态 layout（部分核心视图 layout 依赖运行时 opts·由 seedViewConfigs 注入·此处仅纯静态项如 global-sim）。 */
  layout?: Record<string, unknown>;
  options?: Record<string, unknown>;
  /** 预留：角色可见性收窄（当前由 seedViewConfigs roleViews 处理·保留字段对齐 PRD 规格）。 */
  roles?: string[];
  /**
   * 父功能（FeatureDef.requires 直通）：父关 → `cascade()` 判本视图不生效 ⇒ 导航消失 + ViewPage 404。
   *
   * 为什么需要它：沙盘四子视图**不该独立于沙盘存在**——沙盘门关着却还能从导航点进子视图，
   * 是把一个整体拆成了四个孤儿。挂 `sim.sandbox` 后，四者与主屏同生共死，语义才对。
   */
  requires?: string[];
}

/**
 * 内置视图唯一真相源（出厂核心视图·顺序 = scenarioSeed / 导航顺序，保 workspace 导航序不变）。
 *
 * decision-play（决策推演·renderer=decision-play·DecisionPlayView.tsx）**不在此列且不种入**：它只有前端
 * renderer + 专用静态路由 `/v/decision-play`（App.tsx·免依赖 workspace.views 即可达），**没有** VIEW_DEF /
 * VIEW_FEATURE_MAP / view.decision-play 功能——配置不完整。诚实排除（种一个会 404 的破视图不如不种·PRD §4.1）。
 */
export const BUILTIN_VIEWS: BuiltInView[] = [
  { key: "dash", title: "经营驾驶舱", renderer: "dashboard", featureKey: "view.dash", featureName: "驾驶舱", seed: true, bindings: { apiTags: ["dash"] } },
  { key: "graph", title: "本体图谱", renderer: "ontology-graph", featureKey: "view.ontology-graph", featureName: "本体图谱", seed: true, layout: {}, options: ONTOLOGY_BROWSER_OPTIONS },
  { key: "risk", title: "产能推演", renderer: "risk-board", featureKey: "view.risk-board", featureName: "风险推演看板", seed: true, bindings: { intents: ["risk_*"], solverKeys: ["risk_timeline"], apiTags: ["risk-board"] } },
  { key: "order", title: "订单台账", renderer: "ledger", featureKey: "view.ledger", featureName: "订单台账", seed: true },
  { key: "plan-audit", title: "规划体检", renderer: "plan-audit", featureKey: "view.plan-audit", featureName: "规划体检", seed: true, bindings: { intents: ["plan_audit_*"], solverKeys: ["plan_audit"], apiTags: ["plan-audit"] } },
  { key: "plan-generate", title: "方案生成", renderer: "plan-generate", featureKey: "view.plan-generate", featureName: "规划建议", seed: true, bindings: { intents: ["plan_generate_*"], solverKeys: ["plan_generate"], apiTags: ["plan-generate"] } },
  { key: "project-sim", title: "项目推演", renderer: "project-sim", featureKey: "view.project-sim", featureName: "项目推演", seed: true, bindings: { solverKeys: ["capacity_forecast"], intents: ["capacity_*"] } },
  { key: "sop-balance", title: "月度规划", renderer: "sop-balance", featureKey: "view.sop-balance", featureName: "月度规划", seed: true, bindings: { intents: ["sop_*"], solverKeys: ["sop_balance"], apiTags: ["sop"] } },
  // 全局项目推演（portfolio 求解器·全订单×全基地×时间联合最优）：renderer/solver 均已就绪，此前 scenarioSeed 漏接致内存态重启后 404。
  { key: "global-sim", title: "全局项目推演", renderer: "global-sim", featureKey: "view.global-sim", featureName: "全局项目推演", seed: true, layout: { solverKey: "portfolio" }, bindings: { solverKeys: ["portfolio"] } },
  // ── 推演沙盘四子视图（WO-SANDBOX-VIEW-MOUNT · 补最后一英里）───────────────────
  //
  // 病灶（实测坐实，非推测）：这四个视图**组件写了、测试有、渲染器也注册了**
  // （`apps/frontend-shell/src/views/registry.ts:75/80/85/91`），却**没有任何东西把请求派给它们**：
  //   · 到达 renderer 的唯一通路 `ViewPage.tsx:33`（无 `view.*` 功能 → 404）与 `:38`
  //     （`workspace.views` 无此条目 → 403）—— **两道闸全关**；
  //   · 本表（后端内置视图单一来源）此前 10 项，四者一个都不在册；
  //   · `ShellLayout.tsx` NAV_GROUPS 无这四项；也没有专用静态路由。
  // ⇒ 用户从前端**永远看不到**。实拍验证：登录 demo/admin 点「推演沙盘」，
  //   渲染的是旧 SandboxView，F1/F2/F3 一个都不在屏上。
  //
  // 这是同一个病的**第三层**：组件写了 ✅ → 渲染器注册了 ✅ → **没人派单 ❌**。
  // 前两层今天都补过（#97 registry 接线 / #119 view-reachable 门），偏偏第三层没人管——
  // 而 `check-view-reachable.mjs:24-27` 自述只查前端模块图，**查不到"后端有没有这个视图"**，
  // 所以它对本病一路绿着放行。门的判据须同步升级（另单 WO-VIEW-MOUNT-GATE）。
  //
  // `requires: ["sim.sandbox"]`：四者与沙盘主屏同生共死（沙盘门关 → 级联判不生效 → 导航消失 + 404）。
  // 不这么挂就会出现"沙盘关着、子视图还能点进去"的孤儿态。
  { key: "chain-line-map", title: "全链线路图", renderer: "chain-line-map", featureKey: "view.chain-line-map", featureName: "全链线路图", seed: true, requires: ["sim.sandbox"], bindings: { solverKeys: ["chain_loss_attribution"] } },
  { key: "transit-flow", title: "在途与在制", renderer: "transit-flow", featureKey: "view.transit-flow", featureName: "在途与在制", seed: true, requires: ["sim.sandbox"] },
  { key: "physical-topology", title: "物理拓扑", renderer: "physical-topology", featureKey: "view.physical-topology", featureName: "物理拓扑", seed: true, requires: ["sim.sandbox"] },
  { key: "node-inspector", title: "节点检视", renderer: "node-inspector", featureKey: "view.node-inspector", featureName: "节点检视", seed: true, requires: ["sim.sandbox"] },
  // ── 沙盘第五子视图 · 全链阻滞点（WO-IMPEDIMENTS-REACHABLE · 同族病第五层）─────────
  //
  // 病灶（实测坐实）：`registry.ts:87` 早已 `registerRenderer("chain-impediments", …)`，组件
  // `views/sim/ChainImpedimentView.tsx` 有 442 行真实现 + 两条测试全绿，**却零路径渲染得到**：
  //   · 本表（后端派单的唯一真相源）无此 key ⇒ `workspace.views` 永远没有它 ⇒ ViewPage 双闸全关；
  //   · `App.tsx` 也没有专用静态 route ⇒ 手敲 URL 也只落 `v/:viewKey` 通用守卫 → 404。
  // 它同时躲开了既有两道门：`view-reachable:check` 问「模块有没有人 import」——registry 那行满足了，绿；
  // `nav-group-coverage:check` 对账的是「本表 seed:true」与「专用 route」两侧——它两侧都不在，不在射程。
  // 现补第三条判据（判据⑦ 渲染器可达）咬这一层，见 `scripts/check-nav-group-coverage.mjs`。
  //
  // 为什么走本表（BUILTIN_VIEWS）而不是专用 route —— 判据是**语义归属**，不是哪个好写：
  //   ① 它是沙盘家族的第五个成员（引擎 `chain_impediments` 出自 WO-SANDBOX-E3，组件自述与 F1
  //      `chain-line-map` 是"两个不同求解器、两个不同问题"的**姐妹页**），四个姐妹全在本表，
  //      第五个另起一套机制 = 「拆两半用不同机制不对接」，本仓栽过的老坑；
  //   ② 它**必须与沙盘同生共死**（`requires: ["sim.sandbox"]`）。专用 route 给不了这条：route 条目
  //      可按 feature 隐藏入口，但页面侧没有 Guard ⇒ 手敲 URL 照样进得去，违反 R3「功能关闭 = 不存在」；
  //   ③ 它的求解器入参是**租户范围**（`argsFromView` 读 `view.options.baseIds/businessTypes/modelIds`），
  //      而 `options` 只有 ViewConfig 这条路送得到；专用 route 直挂组件、`view` 恒 undefined ⇒
  //      该维度结构性失效。反观真正走专用 route 的那批（what-if / cleanroom-attr / disruption-radius /
  //      optimize-whatif）全是**净室通用**页：与租户本体无关、无需按行业裁剪，语义类别本就不同。
  { key: "chain-impediments", title: "全链阻滞点", renderer: "chain-impediments", featureKey: "view.chain-impediments", featureName: "全链阻滞点", seed: true, requires: ["sim.sandbox"], bindings: { solverKeys: ["chain_impediments"] } },
  // ── 流程等待态（WO-WAITING-STATES-FE · 需求 §20「『等待』是一等状态」）──────────
  //
  // 病灶（实测坐实，取证见 docs/WO-WAITING-STATES-FE-evidence.md）：业务流程层 65 条
  // `ProcessDefinition` 每条都带 `waitKind`（四态等待类型），种子 `seed.ts:697-698` 真写进了仓储，
  // 而 `processDefinitions` / `processDomains` 的 **src 读取方为 0** —— 只有 seed 写 + test 读，
  // 零 REST 路由、零事件 ⇒ 前端「等待态 0 命中」的病根在**后端没下发**，不在前端没接。
  // 本单同批补了读端 `GET /a/v1/process-definitions`（app.ts），本行补的是**派单**那一半。
  //
  // 为什么走本表（BUILTIN_VIEWS）而不是专用 route —— 同 chain-impediments 那条判据「语义归属」：
  //   ① 它消费的是**租户本体数据**（每租户 65 条流程定义、域名/流程名属行业模板种子），
  //      不是净室通用页；走专用 route 那批（what-if / cleanroom-attr / disruption-radius /
  //      optimize-whatif）全是与租户本体无关的通用页，语义类别本就不同；
  //   ② R3「功能关闭 = 不存在」：专用 route 页面侧无 Guard，手敲 URL 照样进得去。
  //
  // **不挂 requires**（与沙盘五子视图不同）：流程层是配置驱动的业务主数据，
  // 与 `sim.sandbox` 推演沙盘无从属关系；挂上去会造出「关了沙盘就看不到业务流程」的假依赖。
  { key: "process-wait", title: "流程等待态", renderer: "process-wait", featureKey: "view.process-wait", featureName: "流程等待态", seed: true },
  // ── 采购四段腿分解「该找谁」页（WO-R9-NAVREACH · 同族病第六层的**第二例**）──────────
  //
  // 病灶（2026-08-14 实测坐实，非推测）：`views/registry.ts:103` 逐字写着
  // `registerRenderer("procurement-legs", …)`，组件 `views/sim/ProcurementLegsView.tsx` 真实现、
  // 门 `test/procurement-legs-reachable.test.tsx` 12 例全绿 —— 而**没有任何路径渲染得到它**：
  //   · 本表（后端派单唯一真相源）无此 key ⇒ `workspace.views` 永远没有它 ⇒ ViewPage 双闸全关；
  //   · `App.tsx` 也无专用静态 route ⇒ 手敲 `/v/procurement-legs` 只落 `v/:viewKey` 通用守卫 → 404。
  // 三形态定性（铁律 0.5）＝ **没接线**（不是"接了线没数据"、也不是"接错地方"）：
  // 该 view 键在后端**整个不存在**——`grep -rn procurement-legs apps/datacore/src` 零命中，
  // 而同族已上屏的 `process-wait` 在本表命中一行（金丝雀证明 grep 是好的，不是它瞎了）。
  // 来历：`edeb3a10`（reclaim WO-R5 3/7）收编时**只收了前端半**，派单侧那一半没跟着来 ——
  // 本仓反复点名的「拆两半只做一半」，与 chain-impediments 是**同一个坑的第二次**。
  //
  // 为什么走本表（BUILTIN_VIEWS）而不是专用 route —— 判据是**语义归属**，另有一条**结构硬约束**：
  //   ① 语义：它消费的是**租户本体数据**（`kit_readiness` 逐缺料项的 `procurement` 四段 /
  //      `ownerDays` / `criticalLeg`，源头是租户的 Supplier/PurchaseOrder/CustomsClearance/
  //      IncomingInspection 真对象），可被行业模板裁剪；走专用 route 那批（what-if /
  //      cleanroom-attr / disruption-radius / optimize-whatif）全是与租户本体无关的**净室通用**页。
  //   ② R3「功能关闭 = 不存在」：专用 route 页面侧无 Guard，手敲 URL 照样进得去。
  //   ③ **结构硬约束（这条决定性，不是偏好）**：`ProcurementLegsView` 读 `view.options`
  //      （`ProcurementLegsView.tsx:305/311/316` 覆盖分析窗）与 `view.title`（`:364`），而
  //      `App.tsx` 的专用 route **直挂组件、不传任何 props**（`lazyWrap(<WhatIfView />)` 那个形态）
  //      ⇒ `view` 恒 undefined ⇒ 该页当场崩。`options` 只有 ViewConfig 这条路送得到。
  //
  // **不挂 requires**（与沙盘五子视图不同）：采购分解回答的是「这批料晚在哪一段、今天该打哪通电话」，
  // 是采购/齐套域的业务主数据页，与 `sim.sandbox` 推演沙盘无从属关系；挂上去会造出
  // 「关了沙盘就看不到该找谁」的假依赖。也**不进** `CONSOLIDATED_INTO_SANDBOX`：
  // 沙盘五模式（现状/归因/试一手/求最优/影响半径，见 `views/sim/sandboxModes.ts`）里没有它，
  // 收编表要求 `where` 写出「用户在沙盘里点哪里能到」—— 写不出来就不许进那张表（那是免死金牌，不是登记）。
  //
  // **不挂 bindings.solverKeys: ["kit_readiness"]**（刻意·与 chain-impediments 不同）：
  // `kit_readiness` 是**多路共用**的求解器（QOS 问答/场景解读/mock handlers 均在调，
  // 见 `frontend-shell/src/mocks/fixtures.ts:1376` 与 `handlers.ts:2462`），把它绑到一个 VIEW 级功能上
  // ⇒ 关掉这一页会连带把所有别的调用方一起 404。绑定该表达的是「这个功能独占这个求解器」，此处不成立。
  { key: "procurement-legs", title: "采购四段腿分解", renderer: "procurement-legs", featureKey: "view.procurement-legs", featureName: "采购四段腿分解", seed: true },
];

/** scenarioSeed.views 单一来源：seed:true 的内置视图键（battery.ts 引用·防第 4 处漂移）。 */
export const SEEDED_VIEW_KEYS: string[] = BUILTIN_VIEWS.filter((v) => v.seed).map((v) => v.key);

/** 派生：内置视图 VIEW 级 FeatureDef（features.ts FEATURE_REGISTRY 顶部 spread·非 VIEW 功能仍手注册）。 */
export function builtInViewFeatureDefs(): FeatureDef[] {
  return BUILTIN_VIEWS.map((v) => ({
    key: v.featureKey,
    name: v.featureName,
    level: "VIEW" as const,
    defaultOn: true,
    ...(v.bindings ? { bindings: v.bindings } : {}),
    ...(v.requires ? { requires: v.requires } : {}),
  }));
}

/** 派生：内置视图 viewKey → featureKey（features.ts VIEW_FEATURE_MAP 核心段·别名/增量视图/图谱视角仍手注册）。 */
export function builtInViewFeatureMap(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const v of BUILTIN_VIEWS) m[v.key] = v.featureKey;
  return m;
}

/**
 * fail-fast（PRD §4.3）：种子路径断言每个 seeded 内置视图接线完整——featureKey 已在功能注册表 +
 * VIEW_FEATURE_MAP 有一致映射 + VIEW_DEFS 有定义。任一半漂移 → 启动期抛错（不再靠人肉发现"页面隐身"）。
 * 依赖注入（不 import features/service·保叶子无环）：调用方（seedViewConfigs）传入三者。
 */
export function assertViewManifestIntegrity(deps: {
  viewFeatureMap: Record<string, string>;
  viewDefs: Record<string, unknown>;
  registeredFeatureKeys: ReadonlySet<string>;
}): void {
  for (const bv of BUILTIN_VIEWS) {
    if (!bv.seed) continue;
    const problems: string[] = [];
    if (!bv.featureKey) problems.push("缺 featureKey");
    else if (!deps.registeredFeatureKeys.has(bv.featureKey)) problems.push(`功能未注册(${bv.featureKey})`);
    if (deps.viewFeatureMap[bv.key] !== bv.featureKey) problems.push(`VIEW_FEATURE_MAP[${bv.key}] 缺失/不一致`);
    if (!deps.viewDefs[bv.key]) problems.push(`VIEW_DEFS[${bv.key}] 缺失`);
    if (problems.length > 0) {
      throw new Error(
        `视图清单完整性校验失败·内置视图「${bv.key}」：${problems.join("·")}` +
          `（view-manifest 单一来源接线断裂·WO-MEMORY-VIEW-RESILIENCE §4.3 种子路径 fail-fast）`,
      );
    }
  }
}
