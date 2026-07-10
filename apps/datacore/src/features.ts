import type { FeatureDef } from "@platform/contracts";
import type { AuthCtx, FeatureAuditRecord, FeatureConfigRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { AuditService } from "./audit.js";
import { AppError, validationError } from "./errors.js";

/**
 * Feature entitlement (增量 PRD). FeatureRegistry is code-registered; resolution
 * is platform defaults → IndustryTemplate.features → tenant overrides → role
 * narrowing. Disabled = "does not exist" → 404 FEATURE_NOT_FOUND before authz.
 */

export const FEATURE_REGISTRY: FeatureDef[] = [
  // VIEW level
  { key: "view.dash", name: "驾驶舱", level: "VIEW", defaultOn: true, bindings: { apiTags: ["dash"] } },
  { key: "view.ontology-graph", name: "本体图谱", level: "VIEW", defaultOn: true },
  { key: "view.risk-board", name: "风险推演看板", level: "VIEW", defaultOn: true, bindings: { intents: ["risk_*"], solverKeys: ["risk_timeline"], apiTags: ["risk-board"] } },
  { key: "view.ledger", name: "订单台账", level: "VIEW", defaultOn: true },
  { key: "view.plan-audit", name: "规划体检", level: "VIEW", defaultOn: true, bindings: { intents: ["plan_audit_*"], solverKeys: ["plan_audit"], apiTags: ["plan-audit"] } },
  { key: "view.plan-generate", name: "规划建议", level: "VIEW", defaultOn: true, bindings: { intents: ["plan_generate_*"], solverKeys: ["plan_generate"], apiTags: ["plan-generate"] } },
  { key: "view.sop-balance", name: "S&OP 月度平衡", level: "VIEW", defaultOn: true, bindings: { intents: ["sop_*"], solverKeys: ["sop_balance"], apiTags: ["sop"] } },
  { key: "view.project-sim", name: "项目沙盘推演", level: "VIEW", defaultOn: true, bindings: { solverKeys: ["capacity_forecast"], intents: ["capacity_*"] } },
  // 剩余视图增量（前端 PRD §7.14–7.17 / 修订点 4）
  { key: "view.annual-scenario", name: "年度情景规划台", level: "VIEW", defaultOn: true, bindings: { apiTags: ["plan-aop"], solverKeys: ["capex_scenario"] } },
  { key: "view.quarterly-rolling", name: "季度滚动看板", level: "VIEW", defaultOn: true, bindings: { apiTags: ["plan-quarterly"] } },
  { key: "view.order-chain", name: "订单聚合", level: "VIEW", defaultOn: true },
  { key: "view.geo-map", name: "基地地理视图", level: "VIEW", defaultOn: true },
  // WO-8：场景启动器视图——AgentCore registry 已注册(defaultOn) 但 DataCore(权威 entitlement 源)此前缺 →
  // 解析集无 view.scenarios → launcherEnabled 恒 false、SL2「关 view.scenarios 隐藏启动器」门结构性永不可触发。
  // 两系统功能注册表对此键同源（同 defaultOn:true）。关→/b/v1/scenarios launcherEnabled=false（启动器隐藏）。
  { key: "view.scenarios", name: "场景启动器", level: "VIEW", defaultOn: true },
  // 运营态出厂配置增量 §2/§4：运营回顾（只读历史证据链页面，消费 GET /a/v1/history/bundle）
  { key: "view.review", name: "运营回顾", level: "VIEW", defaultOn: true, bindings: { apiTags: ["history"] } },
  // WO-MERGE-01 B1：OntoFlow 本体建模工作流（Entitlement 铁律）——关→ /a/v1/ontology-workflows/* 全部 404
  // FEATURE_NOT_FOUND（先于 authz）。additive·defaultOn（暗发）。前端按 resolved features 决定导航显隐 + 诚实降级。
  { key: "data-builder", name: "本体建模工作流", level: "VIEW", defaultOn: true, bindings: { apiTags: ["data-builder"] } },
  // BLOCK level
  { key: "shell.query-dock", name: "查询对话坞", level: "BLOCK", defaultOn: true },
  { key: "qos.agent-fallback", name: "Agent 兜底（路径 B）", level: "BLOCK", defaultOn: true },
  { key: "view.project-sim.whatif", name: "What-if 调参", level: "BLOCK", defaultOn: true, requires: ["view.project-sim"] },
  { key: "view.risk-board.mitigation", name: "处置方案区", level: "BLOCK", defaultOn: true, requires: ["view.risk-board"] },
  // WO-CAP-01-REALDEMAND（闭 G-SIM-FAKE·暗发 defaultOn:false·additive）：风险张力需求驱动因素绑真供需
  // demandCapacityTightness（真 DemandSegment/SopVersion vs 真产能）——ON=红对真实需求敏感·常州真供需 ~65 不再
  // 决策级恒红；OFF（关闸）=现行 lines-utilization 合成扁平分支不变（回退演练）。**无 solverKeys 绑定**（不 404
  // risk_timeline·OFF 仍可跑旧路径）·纯求解器内行为读 `SolverContext.features`。battery 模板全开 → demo 默认 ON。
  { key: "qos.risk_realdemand", name: "风险张力绑真供需（暗发）", level: "BLOCK", defaultOn: false, requires: ["view.risk-board"] },
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
  // GRAPH-PANORAMA-ONLY（用户亲定 2026-07-05）：原 §7.18 图谱八视角 BLOCK 键（view.graph.persp.*）
  // 已声明退役（见下方 RETIRED_FEATURE_KEYS）——图谱仅存全景一个入口（view.ontology-graph 门控）。
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
  // WO-ENTERPRISE-DR-AUDIT（sub-B·外部审计 SIEM 对接）：审计日志外送到外部 SIEM/审计系统（webhook_ndjson）。
  // 暗发 defaultOn:false——关 = /a/v1/audit-sinks* 404 FEATURE_NOT_FOUND（R3 先于 authz）。secret 加密不回显（R5）。
  { key: "audit-sink", name: "外部审计对接（SIEM）", level: "VIEW", defaultOn: false, bindings: { apiTags: ["audit-sink"] } },
  { key: "opt.solver-pool", name: "优化模板池", level: "VIEW", defaultOn: false, bindings: { apiTags: ["opt"] } },
  { key: "opt.whatif", name: "优化 what-if", level: "BLOCK", defaultOn: false, requires: ["opt.solver-pool"], bindings: { apiTags: ["opt-whatif"], solverKeys: ["optimize_whatif"] } },
  { key: "opt.embedding-retrieval", name: "模板复用检索", level: "BLOCK", defaultOn: false, requires: ["opt.solver-pool"] },
  { key: "opt.evolve", name: "模板进化(离线)", level: "BLOCK", defaultOn: false, requires: ["opt.solver-pool"] },
  // UPG-L0-GAPCORE（PRD-gap-analysis-engine §3/§11）：配套现状快照（6 类 A 栈·服务间/OBO）。暗发
  // defaultOn:false（RL2）——关 = GET /a/v1/databuilder/registry-snapshot 404 FEATURE_NOT_FOUND
  // （R3 先于 authz·回退演练 C5）。现有租户零影响（additive）。
  { key: "databuilder.registry-snapshot", name: "配套现状快照（服务间）", level: "BLOCK", defaultOn: false },
  // UPG-L0-PREANALYSIS（PRD-gap-analysis-engine §6/§11）：AgentCore 查询预分析全景旁路的权威 entitlement
  // （DataCore 是 entitlement 唯一真相源·AgentCore 经 /a/v1/tenants/{id}/features 解析下发）。暗发
  // defaultOn:false（RL2）——关 = AgentCore 不起后台预分析 + /b/v1/growth/pre-analysis/:taskId 404。现有租户零影响。
  { key: "growth.pre_analysis", name: "查询预分析全景", level: "BLOCK", defaultOn: false },
  // UPG-L0-HIDDENREQ（PRD-gap-analysis-engine §8）：隐藏需求闭包（expandHiddenRequirements 三白名单·零幽灵）的
  // 权威 entitlement。暗发 defaultOn:false（RL2）——关 = 预分析只诊断显式需求（与不做隐藏需求发现一致·回退演练 C3）。现有租户零影响。
  { key: "growth.hidden_req", name: "隐藏需求闭包发现", level: "BLOCK", defaultOn: false },
];

export const ALL_FEATURE_KEYS: string[] = FEATURE_REGISTRY.map((f) => f.key);

/**
 * GRAPH-PANORAMA-ONLY（用户亲定 2026-07-05·registry 声明退役·防幽灵 entitlement）：
 * 图谱七视角（主干/流/源/求解器/MVP/智能体/学习闭环）全删仅存全景；graph-all 与主入口 graph
 * 同质合一（label「图谱全景」，仍由 VIEW 级 view.ontology-graph 门控，requires 链不动）→
 * 八个 view.graph.persp.* BLOCK 键一并退役。声明式退役而非静默删除：
 * ① 租户/角色 override 落库残留引用退役键 → 解析时忽略（不复活幽灵 feature）；
 * ② 新写入 override 引用退役键 → 422 校验拒绝；
 * ③ 退役视图键（RETIRED_VIEW_KEYS）不得再注册为动态视图功能，workspace 过滤旧库残留 ViewConfig。
 */
export const RETIRED_FEATURE_KEYS: ReadonlySet<string> = new Set([
  "view.graph.persp.all",
  "view.graph.persp.backbone",
  "view.graph.persp.flow",
  "view.graph.persp.source",
  "view.graph.persp.solver",
  "view.graph.persp.mvp",
  "view.graph.persp.agent",
  "view.graph.persp.loop",
]);

/** 退役视图键（对应上表·前端路由 302→/v/graph 全景；workspace/动态注册均拒）。 */
export const RETIRED_VIEW_KEYS: ReadonlySet<string> = new Set([
  "graph-all",
  "graph-backbone",
  "graph-flow",
  "graph-source",
  "graph-solver",
  "graph-mvp",
  "graph-agent",
  "graph-loop",
]);

/** Workspace view key → controlling feature (server-side navigation filter). */
export const VIEW_FEATURE_MAP: Record<string, string> = {
  dash: "view.dash",
  risk: "view.risk-board",
  order: "view.ledger",
  graph: "view.ontology-graph",
  "ontology-graph": "view.ontology-graph",
  "plan-audit": "view.plan-audit",
  "plan-generate": "view.plan-generate",
  "sop-balance": "view.sop-balance",
  "project-sim": "view.project-sim",
  "annual-scenario": "view.annual-scenario",
  "quarterly-rolling": "view.quarterly-rolling",
  "order-chain": "view.order-chain",
  "geo-map": "view.geo-map",
  review: "view.review",
  // GRAPH-PANORAMA-ONLY：graph-{persp} 八份 ViewConfig 已退役（RETIRED_VIEW_KEYS），此处不再映射。
};

const byKey = new Map(FEATURE_REGISTRY.map((f) => [f.key, f]));

export const featureNotFound = () => new AppError("FEATURE_NOT_FOUND", "feature not found", 404);

export class FeatureService {
  /** WO-AUDIT-OBS：可选审计写入器；构造时注入 → feature 变更也落统一 audit_log。 */
  constructor(private repos: Repos, private auditSvc?: AuditService) {}

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
    // GRAPH-PANORAMA-ONLY 防幽灵：退役视图键不得借动态注册复活。
    if (RETIRED_VIEW_KEYS.has(viewKey)) throw validationError(`view key retired: ${viewKey}`);
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
    if (industry === "battery-manufacturing") return new Set(ALL_FEATURE_KEYS); // battery default: all on
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
        if (RETIRED_FEATURE_KEYS.has(k)) continue; // 防幽灵：落库残留的退役键不参与解析
        if (v) on.add(k);
        else on.delete(k);
      }
    }
    // L4 role narrowing (can only remove)
    if (role) {
      const roleCfg = await this.repos.featureConfigs.get(tenantId, `fcfg_${tenantId}_${role}`);
      if (roleCfg) {
        configVersion = Math.max(configVersion, roleCfg.configVersion);
        for (const [k, v] of Object.entries(roleCfg.overrides)) {
          if (RETIRED_FEATURE_KEYS.has(k)) continue; // 防幽灵：同上
          if (!v) on.delete(k);
        }
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
      // GRAPH-PANORAMA-ONLY 防幽灵：退役键显式拒绝（区别于未知键，报因清晰）。
      if (RETIRED_FEATURE_KEYS.has(k)) throw validationError(`feature key retired: ${k}`);
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
    // WO-AUDIT-OBS：feature 变更经统一 append-only 审计日志（actor=ctx.userId·R-AUDIT）+ outbox。
    if (this.auditSvc) {
      await this.auditSvc.record(ctx, {
        action: "features.updated",
        targetKind: "feature_config",
        targetId: id,
        before: { overrides: before },
        after: { overrides, configVersion: rec.configVersion, role: role ?? null },
        outboxPayload: { configVersion: rec.configVersion, role: role ?? null, diff },
      }, tenantId);
    }
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
