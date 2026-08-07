import type { FeatureDef } from "@platform/contracts";

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
 * 本文件是叶子模块（只依赖 @platform/contracts 类型），故 features.ts / service.ts / battery.ts 均可安全 import，无环。
 */
export interface BuiltInView {
  /** ViewConfig 键（= 前端路由 viewKey·workspace.views[].viewKey·VIEW_FEATURE_MAP 键）。 */
  key: string;
  /** ViewConfig / 导航标题（前端 nav label + ViewConfig.title·注意与功能名 featureName 不同）。 */
  title: string;
  /** 前端 renderer 注册键（PRD §7 renderer 分发）。 */
  renderer: string;
  /** 管控功能键（entitlement·VIEW_FEATURE_MAP 值·workspace viewAllowed 查此·关=导航消失 R3）。 */
  featureKey: string;
  /** FEATURE_REGISTRY 内该功能的展示名（可与 title 不同·如「驾驶舱」vs 视图 title「经营驾驶舱」）。 */
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
  { key: "graph", title: "本体图谱", renderer: "ontology-graph", featureKey: "view.ontology-graph", featureName: "本体图谱", seed: true, layout: {} },
  { key: "risk", title: "产能推演", renderer: "risk-board", featureKey: "view.risk-board", featureName: "风险推演看板", seed: true, bindings: { intents: ["risk_*"], solverKeys: ["risk_timeline"], apiTags: ["risk-board"] } },
  { key: "order", title: "订单台账", renderer: "ledger", featureKey: "view.ledger", featureName: "订单台账", seed: true },
  { key: "plan-audit", title: "规划体检", renderer: "plan-audit", featureKey: "view.plan-audit", featureName: "规划体检", seed: true, bindings: { intents: ["plan_audit_*"], solverKeys: ["plan_audit"], apiTags: ["plan-audit"] } },
  { key: "plan-generate", title: "方案生成", renderer: "plan-generate", featureKey: "view.plan-generate", featureName: "规划建议", seed: true, bindings: { intents: ["plan_generate_*"], solverKeys: ["plan_generate"], apiTags: ["plan-generate"] } },
  { key: "project-sim", title: "项目推演", renderer: "project-sim", featureKey: "view.project-sim", featureName: "项目推演", seed: true, bindings: { solverKeys: ["capacity_forecast"], intents: ["capacity_*"] } },
  { key: "sop-balance", title: "月度规划", renderer: "sop-balance", featureKey: "view.sop-balance", featureName: "月度规划", seed: true, bindings: { intents: ["sop_*"], solverKeys: ["sop_balance"], apiTags: ["sop"] } },
  // 全局联合推演（portfolio 求解器·全订单×全基地×时间联合最优）：renderer/solver 均已就绪，此前 scenarioSeed 漏接致内存态重启后 404。
  { key: "global-sim", title: "全局联合推演", renderer: "global-sim", featureKey: "view.global-sim", featureName: "全局联合推演", seed: true, layout: { solverKey: "portfolio" }, bindings: { solverKeys: ["portfolio"] } },
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
