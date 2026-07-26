import type { FeatureDef } from "@platform/contracts";
import type { AuthCtx, FeatureAuditRecord, FeatureConfigRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import { AppError, validationError } from "./errors.js";
import { builtInViewFeatureDefs, builtInViewFeatureMap } from "./synthetic/view-manifest.js";

/**
 * Feature entitlement (增量 PRD). FeatureRegistry is code-registered; resolution
 * is platform defaults → IndustryTemplate.features → tenant overrides → role
 * narrowing. Disabled = "does not exist" → 404 FEATURE_NOT_FOUND before authz.
 */

export const FEATURE_REGISTRY: FeatureDef[] = [
  // VIEW level · 内置视图（单一来源 synthetic/view-manifest.BUILTIN_VIEWS 派生·防 features/map/VIEW_DEFS/scenarioSeed
  // 四处漂移·WO-MEMORY-VIEW-RESILIENCE）。含 view.dash/ontology-graph/risk-board/ledger/plan-audit/plan-generate/
  // project-sim/sop-balance/global-sim——名称/bindings 与此前一字不差，唯 project-sim/sop-balance 相对序随 scenarioSeed
  // 导航序（无功能行为影响：resolve() 排序 + Set 消费·order 不入任何断言）。**非 VIEW 功能（下方 BLOCK/ACTION/sim.*/
  // opt.*/ceo.*）保持手注册·顺序原样不动**（PRD §9 风险点：非 VIEW 功能注册序不得被单一来源重构扰动）。
  ...builtInViewFeatureDefs(),
  // 剩余视图增量（前端 PRD §7.14–7.17 / 修订点 4）——非出厂种子核心视图（seed:false·不在 BUILTIN_VIEWS）·手注册
  { key: "view.annual-scenario", name: "年度规划", level: "VIEW", defaultOn: true, bindings: { apiTags: ["plan-aop"], solverKeys: ["capex_scenario"] } },
  { key: "view.quarterly-rolling", name: "季度规划", level: "VIEW", defaultOn: true, bindings: { apiTags: ["plan-quarterly"] } },
  { key: "view.order-chain", name: "订单全链聚合", level: "VIEW", defaultOn: true },
  { key: "view.geo-map", name: "基地地理视图", level: "VIEW", defaultOn: true },
  // 运营态出厂配置增量 §2/§4：运营复盘（只读历史证据链页面，消费 GET /a/v1/history/bundle）
  { key: "view.review", name: "运营复盘", level: "VIEW", defaultOn: true, bindings: { apiTags: ["history"] } },
  // BLOCK level
  { key: "shell.query-dock", name: "查询对话坞", level: "BLOCK", defaultOn: true },
  { key: "qos.agent-fallback", name: "Agent 兜底（路径 B）", level: "BLOCK", defaultOn: true },
  { key: "view.project-sim.whatif", name: "What-if 调参", level: "BLOCK", defaultOn: true, requires: ["view.project-sim"] },
  { key: "view.risk-board.mitigation", name: "处置方案区", level: "BLOCK", defaultOn: true, requires: ["view.risk-board"] },
  { key: "view.dash.widget.capacity", name: "驾驶舱·产能卡", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  { key: "view.dash.widget.risk", name: "驾驶舱·风险卡", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  // cockpit P1 富 KPI（需求/财务、物料）
  { key: "view.dash.widget.demand", name: "驾驶舱·需求与毛利卡", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  { key: "view.dash.widget.material", name: "驾驶舱·物料缺口卡", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  // cockpit P2 规划决策推演 · 根因 DAG（默认开）
  { key: "view.dash.widget.rootcause", name: "驾驶舱·根因归因 DAG", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  // SPINE.4 经营指标条（视图读 Metric 单一出处，默认开）
  { key: "view.dash.widget.metric", name: "驾驶舱·经营指标条", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  // cockpit P5 前端：V5/V7 版本切换 + 反事实双线图（默认开）
  { key: "view.dash.widget.version", name: "驾驶舱·S&OP版本切换", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  { key: "view.dash.widget.counterfactual", name: "驾驶舱·反事实双轨推演", level: "BLOCK", defaultOn: true, requires: ["view.dash"] },
  // §7.19 任务详情编排 DAG（默认开）
  { key: "view.task-dag", name: "任务详情·编排 DAG", level: "BLOCK", defaultOn: true },
  // §7.18 图谱八视角（每个视角可单独开关，BLOCK 级，依赖本体图谱）
  { key: "view.graph.persp.all", name: "图谱·全景", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.backbone", name: "图谱·主干分级", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.flow", name: "图谱·产能推演网络", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.source", name: "图谱·数据来源", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.solver", name: "图谱·求解器", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.mvp", name: "图谱·MVP", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.agent", name: "图谱·智能体网络", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  { key: "view.graph.persp.loop", name: "图谱·学习闭环", level: "BLOCK", defaultOn: true, requires: ["view.ontology-graph"] },
  // Dogfooding（系统本体自反）：/meta 元本体 entitlement（功能关闭=404 FEATURE_NOT_FOUND 先于角色门）。默认开。
  { key: "admin.meta-ontology", name: "系统自我（元本体 Dogfooding）", level: "BLOCK", defaultOn: true },
  // 治理增量 §1.4：域级开关（domain.{key}）——关一个域 = 该域类型在图谱/检索/建模/聚合整体不可见。
  // 默认全开；卖"财务域"为可选包的商业形态由此支持。
  { key: "domain.factory", name: "域·工厂", level: "BLOCK", defaultOn: true },
  { key: "domain.product", name: "域·产品", level: "BLOCK", defaultOn: true },
  { key: "domain.process", name: "域·工艺", level: "BLOCK", defaultOn: true },
  { key: "domain.equip", name: "域·设备", level: "BLOCK", defaultOn: true },
  { key: "domain.quality", name: "域·质量", level: "BLOCK", defaultOn: true },
  { key: "domain.capacity", name: "域·产能", level: "BLOCK", defaultOn: true },
  { key: "domain.forecast", name: "域·预测", level: "BLOCK", defaultOn: true },
  { key: "domain.people", name: "域·人员", level: "BLOCK", defaultOn: true },
  { key: "domain.plan", name: "域·计划", level: "BLOCK", defaultOn: true },
  { key: "domain.finance", name: "域·财务", level: "BLOCK", defaultOn: true },
  { key: "domain.material", name: "域·物料", level: "BLOCK", defaultOn: true },
  { key: "domain.sales", name: "域·销售", level: "BLOCK", defaultOn: true },
  { key: "domain.external", name: "域·外部", level: "BLOCK", defaultOn: true },
  { key: "domain.decision", name: "域·决策", level: "BLOCK", defaultOn: true },
  { key: "domain.unassigned", name: "域·未归域", level: "BLOCK", defaultOn: true },
  // ACTION level
  { key: "act.plan-audit.apply-fix", name: "体检一键修正", level: "ACTION", defaultOn: true, requires: ["view.plan-audit"] },
  { key: "act.adopt-to-draft", name: "采纳为草稿", level: "ACTION", defaultOn: true },
  { key: "act.export", name: "导出", level: "ACTION", defaultOn: true },
  { key: "act.aop-finalize", name: "AOP 情景拍板", level: "ACTION", defaultOn: true, requires: ["view.annual-scenario"] },
  // 推演沙盘（G-11·SPEC §4）：全部暗发 defaultOn:false——按租户开不同档（lite/Pro/旗舰），
  // 关 = /a/v1/sim/* 该能力 404 FEATURE_NOT_FOUND（R3 先于 authz）。现有租户零影响（RL2 暗发）。
  { key: "sim.sandbox", name: "推演沙盘", level: "VIEW", defaultOn: false },
  { key: "sim.propagation", name: "系数传导", level: "BLOCK", defaultOn: false, requires: ["sim.sandbox"] },
  { key: "sim.propagation.delay", name: "延迟传导", level: "BLOCK", defaultOn: false, requires: ["sim.propagation"] },
  { key: "sim.checkpoint", name: "检查点/回滚", level: "BLOCK", defaultOn: false, requires: ["sim.sandbox"] },
  { key: "sim.branch", name: "分支对比", level: "BLOCK", defaultOn: false, requires: ["sim.checkpoint"] },
  { key: "sim.certification", name: "就绪认证 L0-L4", level: "BLOCK", defaultOn: false, requires: ["sim.sandbox"] },
  { key: "sim.commander", name: "AI 推演指挥台", level: "BLOCK", defaultOn: false, requires: ["sim.sandbox"] },
  // 优化求解器融合（G-12·SPEC-optimization-template-pool §6）：全部暗发 defaultOn:false——按租户开不同档
  // （lite 给模板池+几个模板 / Pro 给 what-if+复用检索 / 旗舰再给离线进化）。关 = /a/v1/opt/* 该能力
  // 404 FEATURE_NOT_FOUND（R3 先于 authz）。现有租户零影响（RL2 暗发）。
  { key: "opt.solver-pool", name: "优化模板池", level: "VIEW", defaultOn: false, bindings: { apiTags: ["opt"] } },
  { key: "opt.whatif", name: "优化 what-if", level: "BLOCK", defaultOn: false, requires: ["opt.solver-pool"], bindings: { apiTags: ["opt-whatif"], solverKeys: ["optimize_whatif"] } },
  // WO-CROSS-OBJECT-MULTIOBJ 多目标 + 跨对象占用（暗发 defaultOff，依赖优化模板池）。
  { key: "opt.multiobj", name: "多目标 + 跨对象占用", level: "BLOCK", defaultOn: false, requires: ["opt.solver-pool"], bindings: { solverKeys: ["multi_objective", "cross_object_occupancy"] } },
  // 全局推演·活系统 NL/方案存比暗发门（R3）：真后端 /b/v1/sim/compose · /a/v1/sim/scenarios 端点未落 → defaultOff 不渲染避 404；WO-LIVE-SCENARIO 落后开门。核心（自由杠杆/矩阵/排产）不受此门·照常真出。
  { key: "view.global-sim.live", name: "全局推演·活系统(NL/方案存比)", level: "BLOCK", defaultOn: false },
  { key: "opt.embedding-retrieval", name: "模板复用检索", level: "BLOCK", defaultOn: false, requires: ["opt.solver-pool"] },
  { key: "opt.evolve", name: "模板进化(离线)", level: "BLOCK", defaultOn: false, requires: ["opt.solver-pool"] },
  // WO-CEO-DATA-supply（R3 暗发·defaultOn:false·关=404）：真源记录颗粒级物化（真 RawDataset 逐行→真对象·颗粒不聚合）。
  { key: "data-import.record-materialize", name: "真源记录物化", level: "ACTION", defaultOn: false, bindings: { apiTags: ["record-materialize"] } },
  // WO-CEO-DATA-2（R3 暗发·defaultOn:false）：CEO 驾驶舱原子颗粒数据集生成（只产原子颗粒·无预聚合·可 back-derivation）。
  { key: "ceo.dataset.generate", name: "CEO 驾驶舱原子数据集生成", level: "VIEW", defaultOn: false, bindings: { apiTags: ["ceo-dataset"] } },
  // WO-REAL-LLM-FREE-QUERY（R3 暗发·defaultOn:false·关=字节兼容不触发）：CEO/块级深问走 path-B 真 LLM 自由多跳推理
  // （确定性路由之外·PageContext/BlockContext 注入·失败落确定性兜底）。AgentCore registry 同键双注册（feature parity）。
  { key: "ceo.free-llm", name: "CEO 深问真 LLM 自由推理", level: "BLOCK", defaultOn: false },
  // WO-FIVE-ROLE-AI-EMPLOYEE P1（R3 暗发·defaultOn:false·关=字节兼容不触发）：跨域问题→Coordinator 多角色编排
  //（拆子问→invoke_agent 扇出调各角色 agent→汇总·scope 真隔离越界拒）。AgentCore registry 同键双注册（feature parity）。
  { key: "agent.coordinator", name: "跨域多角色 Coordinator 编排", level: "BLOCK", defaultOn: false },
  // WO-DRIL-P4（R3 暗发·defaultOn:false·关=字节兼容不触发）：Path-B Agent Loop 注入 DRIL 资源包（跨 solver/slice/rule
  // 预选组包）到首轮 prompt → agent 不再盲 discover 逐跳。AgentCore registry 同键双注册（feature parity）·暗发只经显式 override 开。
  { key: "qos.dril-routing", name: "DRIL 智能资源路由（Path-B 组包注入）", level: "BLOCK", defaultOn: false },
  // WO-LIGHTUP（R3 暗发·defaultOn:false·同 AgentCore registry parity·只经显式 override 开）：Path-B 收尾前**反思闭环**——
  // 确定性复盘（reflect.ts·R6）+ LLM critic advisory（fail-open）。orchestrator reflectEnabled 据本键 set.has 注入 runAgentLoop。
  { key: "agent.critic", name: "Agent 反思 LLM critic（确定性复盘之上的 advisory 复核·fail-open）", level: "BLOCK", defaultOn: false },
  // WO-LIGHTUP（R3 暗发·defaultOn:false·同 AgentCore registry parity·只经显式 override 开）：path-B 多对口 solver **服务端组合编排**
  //（executePlan 逐步 invoke_solver + 一次综合·不经 runAgentLoop·确定性 compose 秒答）。orchestrator composePathEnabled 据本键 set.has 挂点。
  { key: "qos.compose-path", name: "QOS 组合路径（多 solver 服务端编排）", level: "BLOCK", defaultOn: false },
  // WO-REASONING-TRACE（R3 暗发·defaultOn:false·同 AgentCore·只经显式 override 开）：path-B agent 每轮"思考旁白"（ReAct thought）
  // 经 step.completed 伪 step(type=agent_narration) 实时流前端·建人机信任。orchestrator reasoningTraceEnabled 据本键 set.has 挂点。
  { key: "qos.reasoning-trace", name: "QOS 推理旁白流（path-B agent 思考实时展示）", level: "BLOCK", defaultOn: false },
  // WO-DETERMINISTIC-CROSS-DOMAIN（R3 暗发·defaultOn:false·同 AgentCore registry parity·只经显式 override 开）：跨域题在**确定性层**
  // 逐域枚举 + 并行 solver + 零 LLM 块装配（改写 QOS 编排路由·排在 LLM classify 之前）。orchestrator deterministicMultiEnabled 据本键 set.has 挂点。
  // 与 ceo.free-llm/agent.coordinator 同列 QOS_DARK_LAUNCH_FEATURES → battery「all on」也保持默认关（不随模板顺带开）。
  { key: "qos.deterministic-multi-domain", name: "确定性跨域分路（多域并行 solver·零 LLM）", level: "BLOCK", defaultOn: false },
  { key: "qos.multi-intent-orchestration", name: "QOS 多意图并行编排（⑤ LLM 兜底·共享确定性后半）", level: "BLOCK", defaultOn: false },
];

export const ALL_FEATURE_KEYS: string[] = FEATURE_REGISTRY.map((f) => f.key);

/**
 * WO-Phase4 · QOS 路由暗发特性——**即便行业模板「全开」也保持默认关**，必须经**显式**租户 override 才启用。
 * 这两个门直接改写 QOS 编排路由（把有对口确定性 solver 的题劫持进慢/无预算的 path-B ReAct）——若被 battery
 * 「all on」模板顺带打开，会让 demo 租户在无真 provider 部署态里空转超时（真因=无预算 ReAct，本 WO 硬预算治之，
 * 但暗发门也必须诚实锁死默认关，不靠行业模板顺带开）。产品分档特性（sim.* / opt.* 等）不在此列，照常随模板开。
 */
export const QOS_DARK_LAUNCH_FEATURES: ReadonlySet<string> = new Set([
  "ceo.free-llm",
  "agent.coordinator",
  "qos.dril-routing",
  "agent.critic",
  "qos.compose-path",
  "qos.reasoning-trace",
  "qos.deterministic-multi-domain",
  "qos.multi-intent-orchestration",
]);

/** Workspace view key → controlling feature (server-side navigation filter). */
export const VIEW_FEATURE_MAP: Record<string, string> = {
  // 内置视图核心段（dash/graph/risk/order/plan-audit/plan-generate/project-sim/sop-balance/global-sim）
  // 单一来源 view-manifest.BUILTIN_VIEWS 派生（防漂移·WO-MEMORY-VIEW-RESILIENCE）。
  ...builtInViewFeatureMap(),
  // 别名与增量视图/图谱视角（非 BUILTIN_VIEWS 成员·手注册）：
  "ontology-graph": "view.ontology-graph", // graph 的 renderer 同名别名（两 viewKey 指同一功能）
  "annual-scenario": "view.annual-scenario",
  "quarterly-rolling": "view.quarterly-rolling",
  "order-chain": "view.order-chain",
  "geo-map": "view.geo-map",
  review: "view.review",
  // §7.18 图谱视角视图（renderer=ontology-graph 的 8 份 ViewConfig）
  "graph-all": "view.graph.persp.all",
  "graph-backbone": "view.graph.persp.backbone",
  "graph-flow": "view.graph.persp.flow",
  "graph-source": "view.graph.persp.source",
  "graph-solver": "view.graph.persp.solver",
  "graph-mvp": "view.graph.persp.mvp",
  "graph-agent": "view.graph.persp.agent",
  "graph-loop": "view.graph.persp.loop",
};

const byKey = new Map(FEATURE_REGISTRY.map((f) => [f.key, f]));

export const featureNotFound = () => new AppError("FEATURE_NOT_FOUND", "feature not found", 404);

export class FeatureService {
  constructor(private repos: Repos) {}

  registry(): FeatureDef[] {
    return FEATURE_REGISTRY;
  }

  // ---- 管理平台增量 §3：ViewConfig 联动的动态功能（view.{viewKey}，默认开） ----

  private async dynamicDefs(tenantId: string): Promise<FeatureDef[]> {
    const recs = await this.repos.dynamicFeatures.list(tenantId);
    return recs.map((r) => ({ key: r.key, name: r.name, level: "VIEW" as const, defaultOn: r.defaultOn }));
  }

  /** 静态注册表 + 本租户动态注册项（GET /a/v1/features/registry 下发）。 */
  async registryFor(tenantId: string): Promise<FeatureDef[]> {
    return [...FEATURE_REGISTRY, ...(await this.dynamicDefs(tenantId))];
  }

  async dynamicKeys(tenantId: string): Promise<Set<string>> {
    return new Set((await this.repos.dynamicFeatures.list(tenantId)).map((r) => r.key));
  }

  /** 创建 ViewConfig → 自动注册 view.{viewKey}（默认开）并 bump configVersion。 */
  async registerViewFeature(ctx: AuthCtx, viewKey: string, name: string): Promise<string> {
    const key = `view.${viewKey}`;
    if (byKey.has(key)) return key; // 静态注册表已有（内置视图）
    await this.repos.dynamicFeatures.put({
      id: `dynf_${ctx.tenantId}_${key}`,
      tenantId: ctx.tenantId,
      key,
      name,
      level: "VIEW",
      defaultOn: true,
      createdAt: new Date().toISOString(),
    });
    await this.mergeTenantOverride(ctx, ctx.tenantId, { [key]: true });
    return key;
  }

  /** 删除 ViewConfig → 注销动态功能 + 清掉残留 override 并 bump configVersion。 */
  async unregisterViewFeature(ctx: AuthCtx, viewKey: string): Promise<void> {
    const key = `view.${viewKey}`;
    if (byKey.has(key)) return; // 静态功能不可注销
    await this.repos.dynamicFeatures.remove(ctx.tenantId, `dynf_${ctx.tenantId}_${key}`);
    await this.mergeTenantOverride(ctx, ctx.tenantId, { [key]: null });
  }

  /** 合并式租户 override 写入（null = 删除该键）；saveConfig 会 bump configVersion + 审计。 */
  async mergeTenantOverride(
    ctx: AuthCtx,
    tenantId: string,
    patch: Record<string, boolean | null>,
  ): Promise<FeatureConfigRecord> {
    const existing = await this.repos.featureConfigs.get(tenantId, `fcfg_${tenantId}`);
    const merged: Record<string, boolean> = { ...(existing?.overrides ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    return this.saveConfig(ctx, tenantId, undefined, merged);
  }

  private async templateFeatures(tenantId: string): Promise<Set<string> | undefined> {
    const tenant = await this.repos.tenants.get(tenantId, tenantId);
    const industry = tenant?.industry;
    if (!industry) return undefined;
    // battery default: all on —— 但 QOS 路由暗发门（ceo.free-llm/agent.coordinator）诚实排除，不随「all on」顺带开
    // （WO-Phase4：暗发门只经显式 override 启用·default-off 锁死·防 demo 部署态空转超时·见 QOS_DARK_LAUNCH_FEATURES）。
    if (industry === "battery-manufacturing") {
      return new Set(ALL_FEATURE_KEYS.filter((k) => !QOS_DARK_LAUNCH_FEATURES.has(k)));
    }
    const tmpl = (
      await this.repos.industryTemplates.list(tenantId, (t) => t.industryKey === industry)
    )[0];
    const feats = tmpl?.template.features;
    return Array.isArray(feats) ? new Set(feats) : undefined;
  }

  /** Cascade requires: a key is effective only if all ancestors are on. */
  private cascade(on: Set<string>): Set<string> {
    const effective = new Set<string>();
    const isOn = (key: string, seen: Set<string>): boolean => {
      if (seen.has(key)) return false;
      seen.add(key);
      if (!on.has(key)) return false;
      const def = byKey.get(key);
      for (const parent of def?.requires ?? []) if (!isOn(parent, seen)) return false;
      return true;
    };
    for (const key of on) if (isOn(key, new Set())) effective.add(key);
    return effective;
  }

  private async layeredSet(tenantId: string, role?: string): Promise<{ on: Set<string>; configVersion: number }> {
    // L1 platform defaults（+ 本租户动态注册项，管理平台增量 §3）
    const on = new Set<string>(FEATURE_REGISTRY.filter((f) => f.defaultOn).map((f) => f.key));
    for (const d of await this.dynamicDefs(tenantId)) if (d.defaultOn) on.add(d.key);
    // L2 industry template defaults
    const tmpl = await this.templateFeatures(tenantId);
    if (tmpl) {
      for (const k of [...on]) if (!tmpl.has(k)) on.delete(k);
      for (const k of tmpl) if (byKey.has(k)) on.add(k);
    }
    // L3 tenant overrides
    let configVersion = 0;
    const tenantCfg = await this.repos.featureConfigs.get(tenantId, `fcfg_${tenantId}`);
    if (tenantCfg) {
      configVersion = tenantCfg.configVersion;
      for (const [k, v] of Object.entries(tenantCfg.overrides)) {
        if (v) on.add(k);
        else on.delete(k);
      }
    }
    // L4 role narrowing (can only remove)
    if (role) {
      const roleCfg = await this.repos.featureConfigs.get(tenantId, `fcfg_${tenantId}_${role}`);
      if (roleCfg) {
        configVersion = Math.max(configVersion, roleCfg.configVersion);
        for (const [k, v] of Object.entries(roleCfg.overrides)) if (!v) on.delete(k);
      }
    }
    return { on, configVersion };
  }

  /** Resolved effective feature set (expanded, cascaded) + configVersion. */
  async resolve(tenantId: string, role?: string): Promise<{ features: string[]; configVersion: number }> {
    const { on, configVersion } = await this.layeredSet(tenantId, role);
    return { features: [...this.cascade(on)].sort(), configVersion };
  }

  /** Union across the user's roles (each role is a narrowing of the tenant set). */
  async resolveForUser(ctx: AuthCtx): Promise<{ features: string[]; configVersion: number }> {
    const baseRoles = [...new Set(ctx.roles.map((r) => r.split(":")[0] as string))];
    if (baseRoles.length === 0) return this.resolve(ctx.tenantId);
    const union = new Set<string>();
    let configVersion = 0;
    for (const role of baseRoles) {
      const r = await this.resolve(ctx.tenantId, role);
      for (const f of r.features) union.add(f);
      configVersion = Math.max(configVersion, r.configVersion);
    }
    return { features: [...union].sort(), configVersion };
  }

  async enabled(tenantId: string, featureKey: string): Promise<boolean> {
    const { features } = await this.resolve(tenantId);
    return features.includes(featureKey);
  }

  /** Entitlement middleware: route tag / solverKey lookup → 404 when bound feature is off. */
  async requireByBinding(tenantId: string, kind: "solverKeys" | "apiTags" | "intents", value: string): Promise<void> {
    const bound = FEATURE_REGISTRY.filter((f) => (f.bindings?.[kind] ?? []).some((b) => matchBinding(b, value)));
    if (bound.length === 0) return; // untagged routes are not entitlement-controlled
    const { features } = await this.resolve(tenantId);
    for (const def of bound) {
      if (!features.includes(def.key)) throw featureNotFound();
    }
  }

  private async validateKeys(tenantId: string, overrides: Record<string, boolean>): Promise<void> {
    const dyn = await this.dynamicKeys(tenantId);
    for (const k of Object.keys(overrides)) {
      if (!byKey.has(k) && !dyn.has(k)) throw validationError(`unknown feature key: ${k}`);
    }
  }

  async putTenantConfig(ctx: AuthCtx, tenantId: string, overrides: Record<string, boolean>): Promise<FeatureConfigRecord> {
    await this.validateKeys(tenantId, overrides);
    return this.saveConfig(ctx, tenantId, undefined, overrides);
  }

  async putRoleConfig(ctx: AuthCtx, tenantId: string, role: string, overrides: Record<string, boolean>): Promise<FeatureConfigRecord> {
    await this.validateKeys(tenantId, overrides);
    // Role layer may only narrow within the tenant-enabled set (E6).
    const tenantSet = new Set((await this.resolve(tenantId)).features);
    for (const [k, v] of Object.entries(overrides)) {
      if (v && !tenantSet.has(k)) {
        throw new AppError("ROLE_CANNOT_EXCEED_TENANT", `role cannot enable '${k}' beyond tenant entitlement`, 422);
      }
    }
    return this.saveConfig(ctx, tenantId, role, overrides);
  }

  private async saveConfig(
    ctx: AuthCtx,
    tenantId: string,
    role: string | undefined,
    overrides: Record<string, boolean>,
  ): Promise<FeatureConfigRecord> {
    const id = role ? `fcfg_${tenantId}_${role}` : `fcfg_${tenantId}`;
    const existing = await this.repos.featureConfigs.get(tenantId, id);
    const all = await this.repos.featureConfigs.list(tenantId);
    const maxVersion = all.reduce((a, c) => Math.max(a, c.configVersion), 0);
    const rec: FeatureConfigRecord = {
      id,
      tenantId,
      role,
      overrides,
      configVersion: maxVersion + 1,
      updatedBy: ctx.userId,
      updatedAt: new Date().toISOString(),
    };
    await this.repos.featureConfigs.put(rec);
    const diff: FeatureAuditRecord["diff"] = {};
    const before = existing?.overrides ?? {};
    for (const k of new Set([...Object.keys(before), ...Object.keys(overrides)])) {
      if (before[k] !== overrides[k] && overrides[k] !== undefined) {
        diff[k] = { from: before[k] ?? null, to: overrides[k] as boolean };
      }
    }
    await this.repos.featureAudit.put({
      id: `faud_${tenantId}_${rec.configVersion}`,
      tenantId,
      role,
      diff,
      configVersion: rec.configVersion,
      updatedBy: ctx.userId,
      updatedAt: rec.updatedAt,
    });
    return rec;
  }

  async audit(tenantId: string): Promise<FeatureAuditRecord[]> {
    const all = await this.repos.featureAudit.list(tenantId);
    return all.sort((a, b) => b.configVersion - a.configVersion);
  }
}

/** Bindings may use a trailing wildcard, e.g. intents: ["plan_audit_*"]. */
function matchBinding(pattern: string, value: string): boolean {
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}
