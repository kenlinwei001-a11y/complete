import { IndustryTemplateSchema, type GenSpec, type GraphViewDesc, type IndustryTemplate, type ModelingSuggestion, type PermissionPolicy, type PlantSpec } from "@platform/contracts";
import { sampleValueDomain, applyPlantCrossings, derivePlantFromRule } from "./value-domains.js";
import type { AuthCtx, Connection, ObjectInstance, RawDataset, SyntheticJob, SyntheticReport, User, ViewConfig } from "../domain.js";
import { profileRows } from "../connectors/profiler.js";
import { MOCK_EXTERNAL_DATA } from "../connectors/registry.js";
import type { Repos, Store } from "../repo/repo.js";
import type { LlmClient } from "../llm.js";
import type { Metrics } from "../metrics.js";
import type { OntologyService } from "../ontology.js";
import type { ModelingService } from "../modeling.js";
import type { ObjectInterfaceService } from "../ontology-governance.js"; // WO-69 P3 · 对象接口种子
import type { RulesService } from "../rules.js";
import type { TimeseriesService } from "../timeseries.js";
import type { SchedulerService } from "../scheduler.js";
import type { OutboxService } from "../outbox.js";
import type { FeatureService } from "../features.js";
import type { ActionService } from "../actions.js";
import { VIEW_FEATURE_MAP, ALL_FEATURE_KEYS } from "../features.js";
import { BUILTIN_VIEWS, assertViewManifestIntegrity } from "./view-manifest.js";
import { AuthService } from "../auth.js";
import { newId } from "../ids.js";
import { mulberry32, hashString, round } from "../prng.js";
import { evaluateExpression } from "../ruledsl.js";
import { batteryCoverageSlices } from "./data-categories.js";
import {
  BATTERY_ACTION_TYPES,
  BATTERY_OBJECT_INTERFACES,
  BATTERY_TYPE_INTERFACE_BINDINGS,
  BATTERY_RULE_SCOPES,
  BATTERY_SOLVER_PARAMS,
  BATTERY_TEMPLATE,
  BATTERY_TS_AGG_SPECS,
  batteryBuiltinSlices,
  batteryLinkTypes,
  batteryObjectTypes,
  generateBattery,
  generatePlanDomain,
  projectExceptionEvents,
  BINDINGS,
  outputLineScaleForBase,
  customerNameOfOrderCust,
} from "./battery.js";
import { cadenceObjectRows, deriveChainCadences } from "./cadence.js";
import { extendedObjectTypes, generateExtended, CAUSAL_EDGES } from "./battery-extended.js";
import { computeRollup } from "../solvers/capacity.js";
import type { SolverParamsShape } from "../solvers/types.js";
import { genPoint, maintWindowsFor, windowFor, type TsGenSpec } from "./tsgen.js";

const TEMPLATE_SYSTEM = `你是行业数据模板生成器。给定行业名称，输出 IndustryTemplate：
ontology.objectTypes（数组，每项 { key, displayName, properties:[{propKey,dataType,isPrimaryKey,refToTypeKey?}], derivedProperties:[{propKey,formula}] }）、
generation（每对象类型的 count{S,M,L} 与 propGenerators）、rules（规则 DSL 表达式）、scenarioSeed。
生成顺序必须保证先主数据后事务数据（fkSample 只引用更早的类型）。`;

const DAY_MS = 86400000;
const HISTORY_DAYS = 90;

/** 增量视图键（§7.14–7.17 四视图 + §7.18 图谱八视角；不进 report.views 快照）。 */
// 注：global-sim 已升为核心内置视图（seed:true·进 scenarioSeed.views/BUILTIN_VIEWS·WO-MEMORY-VIEW-RESILIENCE），
// 故从增量视图桶移除（避免与核心 views 双桶重复种入）。
const PLANVIEW_EXTRA_KEYS = [
  "review",
  "annual-scenario",
  "quarterly-rolling",
  "order-chain",
  "geo-map",
  "graph-all",
  "graph-backbone",
  "graph-flow",
  "graph-source",
  "graph-solver",
  "graph-mvp",
  "graph-agent",
  "graph-loop",
];

/**
 * **暗发中的增量视图**（WO-R9-STUCKVIEW·2026-08-14）—— 与上面那桶分开，因为它们**不能过种子期过滤**。
 *
 * ── 为什么必须单列（这是收编时实测出来的，不是照抄格式）─────────────────────
 * 上面 `PLANVIEW_EXTRA_KEYS` 会先过 `filterByFeatures()` 再落 ViewConfig。对**暗发**功能来说
 * 那是个死结：种子期 `process.runtime` 关着 ⇒ 该键被滤掉 ⇒ **根本没写进 ViewConfig** ⇒
 * 租户日后开通了功能，`/a/v1/me/workspace` 也无从下发（它只能从 ViewConfig 里挑，挑不出没写进去的）。
 * 表现是「开关打开了，页面还是没有」，而两侧代码看起来都对。
 *
 * ⇒ 正确分层：**ViewConfig 是目录，`/me/workspace` 是闸**。
 *    目录**无条件**收录（本常量），闸在**请求期**按 `VIEW_FEATURE_MAP` 逐次判（app.ts `viewAllowed()`）。
 *    R3「功能关闭 = 不存在」一点没松：关着时 `viewAllowed("process-stuck")` 为假 ⇒
 *    `views` 与 `navigation` 两处同时被滤掉，且 `withRouteFeatureAliases` 不下发
 *    `view.process-stuck` ⇒ 前端页面侧守卫也 404。三道闸全在请求期，比种子期那一道**更严**
 *    （种子期那道只在"种下去的那一刻"生效，之后功能怎么变它都不知道）。
 */
const DARK_LAUNCH_EXTRA_KEYS = [
  // 流程卡点面板（「为什么**这一张单**现在卡住了」·需求 §4.5）。控制键 `process.runtime`
  // （features.ts:272 VIEW_FEATURE_MAP + INCOMPLETE_DATA_DARK_LAUNCH_FEATURES 暗发）。
  "process-stuck",
];

/** §7.18 学习闭环视角 nodeFilter.ids —— 与图谱端点概念节点 id 一字不差。 */
const LOOP_NODE_IDS = [
  "产能预测",
  "实际产出",
  "精度校准器",
  "学习Agent",
  "经验记忆库",
  "良率",
  "OEE历史",
  "OEE指标",
  "聚合求解器",
  "工序产能",
];

interface TemplateTypeDef {
  key: string;
  displayName?: string;
  properties?: { propKey: string; dataType?: string; isPrimaryKey?: boolean; refToTypeKey?: string | null }[];
  derivedProperties?: { propKey: string; formula: string }[];
}

/** A7: one-click consistent synthetic data — single source objects + deterministic derivation + A8 ts history. */
export class SyntheticService {
  private scheduler: SchedulerService | null = null;
  private features: FeatureService | null = null;
  private actions: ActionService | null = null;
  /** 轨L 增量2：demo 经真建模链建本体时注入（modeling 在 synthetic 之前构造，setter 注入避免依赖环）。 */
  private modeling: ModelingService | null = null;
  /** 运营态出厂配置增量 §1：livedIn=true 时在标准合成后运行回放引擎（注入避免依赖环）。 */
  private livedInRunner: ((ctx: AuthCtx, input: { industry: string; scale: "S" | "M" | "L" | "XL"; seed: number; jobId: string }) => Promise<{ replay: { batches: number; days: number; points: number } }>) | null = null;
  /** DF-4：合成数据再生完成 → dataset.regenerated（失效驾驶舱/风险/场景数据/本体图/规则库）。 */
  private outbox: OutboxService | null = null;
  /** WO-69 P3：对象接口种子（setter 注入，避免 governance ↔ synthetic 依赖环）。 */
  private interfaces: ObjectInterfaceService | null = null;

  constructor(
    private repos: Repos,
    private llm: LlmClient,
    private ontology: OntologyService,
    private rules: RulesService,
    private metrics: Metrics,
    private model: string,
    private ts?: TimeseriesService,
  ) {}

  wire(deps: {
    scheduler?: SchedulerService;
    features?: FeatureService;
    actions?: ActionService;
    ts?: TimeseriesService;
    livedInRunner?: SyntheticService["livedInRunner"];
    modeling?: ModelingService;
    outbox?: OutboxService;
    interfaces?: ObjectInterfaceService;
  }): void {
    this.scheduler = deps.scheduler ?? this.scheduler;
    this.features = deps.features ?? this.features;
    this.actions = deps.actions ?? this.actions;
    this.ts = deps.ts ?? this.ts;
    this.livedInRunner = deps.livedInRunner ?? this.livedInRunner;
    this.modeling = deps.modeling ?? this.modeling;
    this.outbox = deps.outbox ?? this.outbox;
    this.interfaces = deps.interfaces ?? this.interfaces;
  }

  private async resolveTemplate(ctx: AuthCtx, industry: string): Promise<IndustryTemplate> {
    if (industry === "battery-manufacturing") return BATTERY_TEMPLATE;
    const stored = (
      await this.repos.industryTemplates.list(ctx.tenantId, (t) => t.industryKey === industry)
    )[0];
    if (stored) return stored.template;
    // Unknown industry → LLM-generated template, stored for review & reuse.
    const template = await this.llm.parseStructured({
      model: this.model,
      maxTokens: 16000,
      // LLM Provider 增量 §1.3：A7 行业模板生成走用途绑定（template_gen）
      tenantId: ctx.tenantId,
      purpose: "template_gen",
      system: TEMPLATE_SYSTEM,
      messages: [{ role: "user", content: `industry: ${industry}` }],
      schema: IndustryTemplateSchema,
    });
    await this.repos.industryTemplates.put({
      id: newId("tmpl"),
      tenantId: ctx.tenantId,
      industryKey: industry,
      template,
      source: "LLM",
      createdAt: new Date().toISOString(),
    });
    return template;
  }

  async runJob(
    ctx: AuthCtx,
    // 轨L 增量2：viaModelingChain（仅 demo 种子内部传 true）→ battery 本体经真建模链产出。API 契约不暴露此内部参数。
    input: {
      industry: string;
      scale: "S" | "M" | "L" | "XL";
      seed?: number;
      livedIn?: boolean;
      viaModelingChain?: boolean;
      // WO-SYNTH-VALIDATION-LITE：VALIDATION_LITE 跳 TS 历史/聚合（对象字节不变），historyDays 可显式覆盖。
      profile?: "FULL" | "VALIDATION_LITE";
      historyDays?: number;
    },
  ): Promise<SyntheticJob> {
    const t0 = Date.now();
    const seed = input.seed ?? 42;
    const job: SyntheticJob = {
      id: newId("job"),
      tenantId: ctx.tenantId,
      industry: input.industry,
      scale: input.scale,
      seed,
      status: "SUCCEEDED",
      createdAt: new Date().toISOString(),
    };
    try {
      const template = await this.resolveTemplate(ctx, input.industry);
      // Deterministic origin marker → same (industry, scale, seed) reruns are byte-identical.
      const originJobId = `synthetic-${input.industry}-${input.scale}-${seed}`;
      const origin = { type: "SYNTHETIC", jobId: originJobId } as const;

      // ① idempotency: clear only origin=SYNTHETIC data, then rebuild.
      await this.repos.objects.removeWhere(ctx.tenantId, (o) => o.origin.type === "SYNTHETIC");
      await this.repos.links.removeWhere(ctx.tenantId, (l) => l.origin.type === "SYNTHETIC");
      const oldRules = await this.repos.rules.list(ctx.tenantId, (r) => r.origin.type === "SYNTHETIC");
      for (const r of oldRules) await this.repos.rules.remove(ctx.tenantId, r.id);
      await this.clearSyntheticTimeseries(ctx);

      // ②③ ontology from template + source-object generation (topo order).
      if (input.industry === "battery-manufacturing") {
        await this.instantiateBattery(ctx, seed, input.scale, origin, input.viaModelingChain === true);
      } else {
        await this.instantiateGeneric(ctx, template, seed, input.scale, origin);
      }

      // ③b A8.6: 90-day deterministic ts history → full TS_AGGREGATE → derivation.
      // 运营态增量 §1.1：livedIn 时跳过 90 天标准历史（避免迟到容差拒收回填），
      // 365 天历史与聚合由回放引擎（月批次 × 真实管线）负责。
      if (input.industry === "battery-manufacturing" && this.ts) {
        await this.seedBatteryParamsAndSpecs(ctx, seed, input.scale);
        // WO-SYNTH-VALIDATION-LITE §3.1：LITE（或 historyDays<=0）跳 90 天 TS 历史与全量聚合。
        // genPoint 是 (seed,entity,day) 纯函数、不消耗对象 RNG 游标；派生管线(④)读对象而非 TS 原始点，
        // 故对象指纹 LITE===FULL（SEAM #1 守护）。livedIn 语义不变（其 365 天历史由回放引擎负责）。
        const historyDays =
          input.historyDays ?? (input.profile === "VALIDATION_LITE" ? 0 : HISTORY_DAYS);
        if (!input.livedIn && historyDays > 0) {
          await this.generateHistory(ctx, seed, historyDays);
          await this.ts.runAggregation(ctx.tenantId, { full: true });
        }
      }

      // ③c WO-69 P3：对象接口种子（Approvable + 实现者绑定）。**必须晚于 ActionType 注册**
      // （③b seedBatteryParamsAndSpecs 内）——接口声明的行动要能落到真注册表，否则宁可当场报错，
      // 不许种一个"声明了不存在的行动"的假接口。两条种法（A 路直 upsert / B 路建模链）在此汇合。
      if (input.industry === "battery-manufacturing") {
        await this.seedObjectInterfaces(ctx);
      }

      // ④ derive everything through the A4 pipeline (single source of truth).
      await this.ontology.runDerivations(ctx);

      // ⑤ rules (origin SYNTHETIC), views, demo accounts, policies, scheduler defaults.
      for (const r of template.rules) {
        await this.rules.create(ctx, {
          key: r.key,
          name: r.name,
          expression: r.expression,
          scopeObjectTypes:
            input.industry === "battery-manufacturing" ? (BATTERY_RULE_SCOPES[r.key] ?? ["Order"]) : ["Order"],
          severity: (["BLOCK", "WARN", "INFO"].includes(r.severity) ? r.severity : "WARN") as
            | "BLOCK"
            | "WARN"
            | "INFO",
          params: r.params ?? {},
          // WO-RULES-CLASSIFY：业务类别随种子规则透传（规则库分类筛选的真元数据源）。
          category: r.category,
          origin: { type: "SYNTHETIC" },
          status: "PUBLISHED",
        });
      }
      const views = await this.filterByFeatures(ctx, template.scenarioSeed.views);
      // 增量视图（§7.14–7.17 + 图谱八视角 + 运营复盘）：不进 report.views（保持验收快照稳定），但进 view_configs。
      // ⚠ 两桶合流但**过滤方式不同**（见 DARK_LAUNCH_EXTRA_KEYS 的文件头说明）：
      //   普通增量视图过种子期 feature 过滤；暗发视图**不过**，只由请求期 `/me/workspace` 那道闸判。
      //   合成一句 `filterByFeatures([...A, ...B])` 就会把暗发那批永久滤掉 —— 那正是本条要防的病。
      const extraViews =
        input.industry === "battery-manufacturing"
          ? [...(await this.filterByFeatures(ctx, PLANVIEW_EXTRA_KEYS)), ...DARK_LAUNCH_EXTRA_KEYS]
          : [];
      await this.seedViewConfigs(ctx, views, extraViews, { livedIn: input.livedIn });
      // 管理平台增量 §3：场景包记录（admin/views 与场景包管理页的事实源；幂等 upsert）。
      const pkgId = "pkg_battery_manufacturing";
      const existingPkg = await this.repos.scenarioPackages.get(ctx.tenantId, pkgId);
      await this.repos.scenarioPackages.put({
        id: pkgId,
        tenantId: ctx.tenantId,
        name: input.industry === "battery-manufacturing" ? "电池制造场景包" : `${input.industry} 场景包`,
        fromTemplate: input.industry,
        views: [...views, ...extraViews],
        toolWhitelist: existingPkg?.toolWhitelist ?? [],
        modelOverrides: existingPkg?.modelOverrides ?? {},
        thresholds: existingPkg?.thresholds ?? {},
        createdAt: existingPkg?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const accounts = await this.seedDemoAccounts(ctx);
      await this.seedPolicies(ctx);
      if (this.scheduler) {
        await this.scheduler.register(ctx.tenantId, "DERIVATION_FULL", "tenant", "0 2 * * *");
        await this.scheduler.register(ctx.tenantId, "RULE_SCAN", "tenant", "0 * * * *");
        await this.scheduler.register(ctx.tenantId, "TS_AGGREGATE", "tenant", "30 * * * *");
        // M11 §3 兜底定时：每周一全量校准（温和漂移周期性收口）
        await this.scheduler.register(ctx.tenantId, "CALIBRATION_RUN", "tenant", "0 3 * * 1");
      }

      // ⑥ validation report.
      job.report = await this.buildReport(ctx, template, views, accounts, seed);

      // ⑦ 运营态出厂配置增量 §1：livedIn → 标准合成后回放一年（T−365d → T0）。
      if (input.livedIn && this.livedInRunner && input.industry === "battery-manufacturing") {
        const replayT0 = Date.now();
        const r = await this.livedInRunner(ctx, { industry: input.industry, scale: input.scale, seed, jobId: originJobId });
        job.livedIn = { ...r.replay, durationMs: Date.now() - replayT0 };
        this.metrics.set("dc_livedin_replay_ms", { scale: input.scale }, Date.now() - replayT0);
      }

      await this.repos.syntheticJobs.put(job);
      this.metrics.set("dc_synthetic_job_duration_ms", { industry: input.industry }, Date.now() - t0);
      // DF-4：合成/再生完成 → 下游消费页联动（驾驶舱/风险/场景数据/本体图/规则库失效）。
      await this.outbox?.emit(
        ctx.tenantId,
        "dataset.regenerated",
        { jobId: job.id, industry: input.industry, scale: input.scale, seed },
        `synthetic:${ctx.tenantId}`,
      );
      return job;
    } catch (err) {
      job.status = "FAILED";
      job.error = err instanceof Error ? err.message : String(err);
      await this.repos.syntheticJobs.put(job);
      throw err;
    }
  }

  /**
   * WO-SYNTH-VALIDATION-LITE §3.5：将 src 租户的确定性合成产物深拷贝到 dst 租户（改 tenantId）。
   * 供 demo 重置 + CI baseline 复用（避免重复全种）。SEAM 铁律：
   *   fingerprint(cloneTenant(fresh-seed-tenant)) === fingerprint(fresh-seed-tenant)。
   * 覆盖：对象/链接/规则/权限策略/视图/场景包/合成作业/模拟时钟/本体类型/本体链接/域/求解器参数
   *   + TS（tsSeries + tsPoints）。所有 Store<T> 均含 list(tenantId)/put(item)，泛型逐条改 tenantId 落盘。
   */
  async cloneTenant(src: string, dst: string): Promise<void> {
    // 泛型 tenant-scoped 存储（item 均带 tenantId）——逐条改 tenantId 复制。
    const genericStores: Store<{ id: string; tenantId: string }>[] = [
      this.repos.objects as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.links as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.rules as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.policies as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.viewConfigs as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.scenarioPackages as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.syntheticJobs as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.simulationClocks as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.ontologyTypes as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.ontologyLinks as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.domains as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.solverParams as unknown as Store<{ id: string; tenantId: string }>,
      this.repos.tsSeries as unknown as Store<{ id: string; tenantId: string }>,
    ];
    for (const store of genericStores) {
      for (const it of await store.list(src)) {
        await store.put({ ...(it as Record<string, unknown>), tenantId: dst } as { id: string; tenantId: string });
      }
    }
    // TS 点：按已复制的 series 逐条搬运（幂等 upsert；keyed by seriesId/entityId/ts）。
    for (const s of await this.repos.tsSeries.list(dst)) {
      const pts = await this.repos.tsPoints.list(src, s.id);
      if (pts.length > 0) {
        await this.repos.tsPoints.upsert(dst, pts.map((p) => ({ ...p, tenantId: dst })));
      }
    }
  }

  /** A7 entitlement link: skip view/intent seeds bound to disabled features. */
  private async filterByFeatures(ctx: AuthCtx, views: string[]): Promise<string[]> {
    if (!this.features) return views;
    const { features } = await this.features.resolve(ctx.tenantId);
    const enabled = new Set(features);
    return views.filter((v) => {
      const fk = VIEW_FEATURE_MAP[v];
      return !fk || enabled.has(fk);
    });
  }

  private async clearSyntheticTimeseries(ctx: AuthCtx): Promise<void> {
    const series = await this.repos.tsSeries.list(ctx.tenantId, (s) => s.origin === "SYNTHETIC");
    const ids = new Set(series.map((s) => s.id));
    if (ids.size > 0) {
      await this.repos.tsPoints.removeWhere(ctx.tenantId, (p) => ids.has(p.seriesId));
      for (const s of series) await this.repos.tsSeries.remove(ctx.tenantId, s.id);
    }
    const specKeys = new Set(BATTERY_TS_AGG_SPECS.map((s) => s.key));
    for (const run of await this.repos.tsAggRuns.list(ctx.tenantId, (r) => specKeys.has(r.specKey))) {
      await this.repos.tsAggRuns.remove(ctx.tenantId, run.id);
    }
    for (const spec of await this.repos.tsAggSpecs.list(ctx.tenantId, (s) => specKeys.has(s.key))) {
      await this.repos.tsAggSpecs.remove(ctx.tenantId, spec.id);
    }
    for (const late of await this.repos.tsLateArrivals.list(ctx.tenantId)) {
      await this.repos.tsLateArrivals.remove(ctx.tenantId, late.id);
    }
    for (const f of await this.repos.forecastSnapshots.list(ctx.tenantId)) {
      await this.repos.forecastSnapshots.remove(ctx.tenantId, f.id);
    }
  }

  private async seedBatteryParamsAndSpecs(ctx: AuthCtx, seed: number, scale: "S" | "M" | "L" | "XL"): Promise<void> {
    // §S1 通用约定: all solver constants live in per-tenant solver_params storage.
    const existing = await this.repos.solverParams.get(ctx.tenantId, `spar_${ctx.tenantId}`);
    await this.repos.solverParams.put({
      id: `spar_${ctx.tenantId}`,
      tenantId: ctx.tenantId,
      params: BATTERY_SOLVER_PARAMS,
      version: (existing?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    });
    if (this.ts) {
      for (const spec of BATTERY_TS_AGG_SPECS) await this.ts.upsertSpec(ctx.tenantId, spec);
      // retention policy config slot (no compression implementation this period)
      await this.repos.retentionPolicies.put({
        id: `rtn_${ctx.tenantId}_default`,
        tenantId: ctx.tenantId,
        seriesKey: "*",
        rawDays: 365,
        downsampleAfterDays: 90,
        downsampleGrain: "day",
      });
    }
    // S2 ActionType registry (battery defaults).
    if (this.actions) {
      for (const t of BATTERY_ACTION_TYPES) await this.actions.registerType(ctx, t);
    }
    // §7.21 校准种子：2 条 PENDING 提案 + 1 条历史（确定性 id/时间；提案变更只能走 Action）。
    // M11：同 (industry, scale, seed) 重跑回到初始态 —— 先清空配对/预测记录/提案/历史。
    for (const rec of await this.repos.calibrationPairs.list(ctx.tenantId)) {
      await this.repos.calibrationPairs.remove(ctx.tenantId, rec.id);
    }
    for (const rec of await this.repos.calibrationForecasts.list(ctx.tenantId)) {
      await this.repos.calibrationForecasts.remove(ctx.tenantId, rec.id);
    }
    for (const rec of await this.repos.calibrationProposals.list(ctx.tenantId)) {
      await this.repos.calibrationProposals.remove(ctx.tenantId, rec.id);
    }
    for (const rec of await this.repos.calibrationHistory.list(ctx.tenantId)) {
      await this.repos.calibrationHistory.remove(ctx.tenantId, rec.id);
    }
    const t0 = BATTERY_SOLVER_PARAMS.forecastStart as string;
    const proposalSeeds = [
      {
        id: `calp_${ctx.tenantId}_seed_ramp`,
        parameter: "产能预测·爬坡系数基线",
        paramPath: "ramp.base",
        objectRef: "Solver:capacity_forecast",
        currentValue: (BATTERY_SOLVER_PARAMS.ramp as { base: number }).base,
        proposedValue: 0.9,
        basis: { windowFrom: "2026-06-17", windowTo: "2026-06-30", samples: 168 },
        trigger: "C12",
        sliceKey: "capacity_forecast|all|4680-NCM",
        paramRef: { scope: "SOLVER_PARAMS" as const, path: "ramp.base" },
        method: "REPLAY_ATTRIBUTION" as const,
        evidence: { windowFrom: "2026-06-17", windowTo: "2026-06-30", nPairs: 168, mapeBefore: 11.2, simulatedMapeAfter: 8.9, bias: 0.061, flags: ["ATTRIBUTION_SHARE:0.82"] },
      },
      {
        id: `calp_${ctx.tenantId}_seed_maint`,
        parameter: "检修产能系数（OEE 基线）",
        paramPath: "maintMult",
        objectRef: "Solver:capacity_forecast",
        currentValue: BATTERY_SOLVER_PARAMS.maintMult as number,
        proposedValue: 0.75,
        basis: { windowFrom: "2026-06-10", windowTo: "2026-06-30", samples: 96 },
        trigger: "手动",
        sliceKey: "capacity_forecast|all|圆柱-LFP",
        paramRef: { scope: "SOLVER_PARAMS" as const, path: "maintMult" },
        method: "EMA" as const,
        evidence: { windowFrom: "2026-06-10", windowTo: "2026-06-30", nPairs: 96, mapeBefore: 9.8, simulatedMapeAfter: 8.1, bias: -0.034, flags: [] },
      },
    ];
    for (const p of proposalSeeds) {
      await this.repos.calibrationProposals.put({
        ...p,
        tenantId: ctx.tenantId,
        status: "PENDING",
        createdAt: `${t0}T00:00:00.000Z`,
      });
    }
    await this.repos.calibrationHistory.put({
      id: `calh_${ctx.tenantId}_seed_1`,
      tenantId: ctx.tenantId,
      at: "2026-06-15T08:00:00.000Z",
      trigger: "C12",
      changedParams: ["良率基线（化成）"],
      mapeBefore: 11.2,
      mapeAfter: 8.4,
      method: "EMA",
      simulatedMapeAfter: 8.4, // 预言（回测）
      realizedMape: 8.7, // 实现（元闭环 14 日回写）—— 报告页"预言 vs 实现"
    });
    // A8.6 simulation clock at t0.
    await this.repos.simulationClocks.put({
      id: ctx.tenantId,
      tenantId: ctx.tenantId,
      t0: BATTERY_SOLVER_PARAMS.forecastStart as string,
      currentTick: 0,
      seed,
      industry: "battery-manufacturing",
      scale,
      status: "ACTIVE",
      firedEvents: [],
      activeAlerts: [],
    });
  }

  /** ③b: deterministic history per tsGenerators (maint dips share the MaintPlan objects).
   * WO-SYNTH-VALIDATION-LITE §3.1/§3.3：historyDays 参数化（默认 90；<=0 直接返回=LITE 跳 TS），
   * 日期串循环外一次预生成（消 per-entity×N 重复 new Date），输出逐字节不变。 */
  private async generateHistory(ctx: AuthCtx, seed: number, historyDays: number = HISTORY_DAYS): Promise<void> {
    if (!this.ts || historyDays <= 0) return;
    const t0 = Date.parse(`${BATTERY_SOLVER_PARAMS.forecastStart as string}T00:00:00Z`);
    // §3.3：日期串预生成（entity 循环内取用；与旧 per-day new Date 结果逐字节一致）。
    const dateIsoList = Array.from({ length: historyDays }, (_, d) =>
      new Date(t0 - (historyDays - d) * DAY_MS).toISOString().slice(0, 10),
    );
    const maintPlans = (await this.repos.objects.listByType(ctx.tenantId, "MaintPlan")).map((m) => ({
      baseId: String(m.props.baseId),
      week: Number(m.props.week),
      lastMaintStart: String(m.props.lastMaintStart),
    }));
    const windows = maintWindowsFor(maintPlans, BATTERY_SOLVER_PARAMS.forecastStart as string);
    const generators = (BATTERY_TEMPLATE.tsGenerators ?? []) as unknown as TsGenSpec[];
    // WO-SCALE-COHERENCE：output:line 实现产出按基地夹定产能派生 per-base 尺度（realized 层入 round-trip）。
    const baseCap = new Map<string, number>();
    for (const b of await this.repos.objects.listByType(ctx.tenantId, "Base")) baseCap.set(String(b.props.baseId), Number(b.props.formationCapDaily) || 0);
    for (const gen of generators) {
      const series = await this.ts.ensureSeries(ctx.tenantId, {
        seriesKey: gen.seriesKey,
        entityType: gen.entityType,
        entityRefField: entityRefFieldOf(gen.entityType),
        timeField: "ts",
        measureFields: gen.weightField ? [gen.measureField, gen.weightField] : [gen.measureField],
        origin: "SYNTHETIC",
      });
      const entities = (await this.repos.objects.listByType(ctx.tenantId, gen.entityType)).sort((a, b) =>
        a.id < b.id ? -1 : 1,
      );
      const points: { entityId: string; ts: string; values: Record<string, number>; tick?: number }[] = [];
      for (const e of entities) {
        const entityId = String(e.props[entityRefFieldOf(gen.entityType)] ?? e.id);
        const baseId = String(e.props.baseId ?? "");
        const scale = gen.seriesKey === "output:line" ? outputLineScaleForBase(baseCap.get(baseId) ?? 0) : undefined;
        for (let d = 0; d < historyDays; d++) {
          const dateIso = dateIsoList[d]!;
          points.push({
            entityId,
            ts: `${dateIso}T00:00:00.000Z`,
            values: genPoint(gen, { entityId, baseId, scale }, dateIso, d, seed, windowFor(windows, baseId, dateIso)),
            tick: 0,
          });
        }
      }
      await this.ts.writePoints(ctx.tenantId, series, points);
    }
  }

  // -- battery instantiation (master data → transactions, FK by construction) --

  /** 治理增量 §1：注册电池场景包的域注册表（含 owner，会签默认人）。 */
  private async seedDomains(ctx: AuthCtx): Promise<void> {
    const seeds: { domainKey: string; displayName: string; color: string; ownerUserId: string | null }[] = [
      { domainKey: "factory", displayName: "工厂", color: "#2563eb", ownerUserId: "usr_demo_admin" },
      { domainKey: "product", displayName: "产品", color: "#16a34a", ownerUserId: "usr_demo_admin" },
      { domainKey: "process", displayName: "工艺", color: "#9333ea", ownerUserId: "usr_demo_planner" },
      { domainKey: "equip", displayName: "设备", color: "#ea580c", ownerUserId: "usr_demo_planner" },
      { domainKey: "quality", displayName: "质量", color: "#dc2626", ownerUserId: "usr_demo_admin" },
      { domainKey: "capacity", displayName: "产能", color: "#0891b2", ownerUserId: "usr_demo_planner" },
      { domainKey: "forecast", displayName: "预测", color: "#7c3aed", ownerUserId: "usr_demo_planner" },
      { domainKey: "people", displayName: "人员", color: "#db2777", ownerUserId: "usr_demo_admin" },
      { domainKey: "plan", displayName: "计划", color: "#ca8a04", ownerUserId: "usr_demo_planner" },
      { domainKey: "finance", displayName: "财务", color: "#059669", ownerUserId: "usr_demo_admin" },
      // 跨域切片增量：扩展对象类型已使用 supply/commercial 两域，补注册（治理域开关/分组/检索切面才生效）。
      { domainKey: "supply", displayName: "供给", color: "#0d9488", ownerUserId: "usr_demo_planner" },
      { domainKey: "commercial", displayName: "商务", color: "#be185d", ownerUserId: "usr_demo_admin" },
      { domainKey: "external", displayName: "外部信号", color: "#475569", ownerUserId: "usr_demo_admin" },
      // cockpit P2：决策应用域（驾驶舱 KPI / 规划决策推演 / 根因归因链的归域）。
      { domainKey: "decision", displayName: "决策应用", color: "#7c3aed", ownerUserId: "usr_demo_admin" },
      { domainKey: "unassigned", displayName: "未归域", color: "#9ca3af", ownerUserId: null },
    ];
    for (const s of seeds) {
      const existing = (await this.repos.domains.list(ctx.tenantId, (d) => d.domainKey === s.domainKey))[0];
      if (existing) continue;
      await this.repos.domains.put({
        id: `dom_${ctx.tenantId}_${s.domainKey}`,
        tenantId: ctx.tenantId,
        domainKey: s.domainKey,
        displayName: s.displayName,
        color: s.color,
        ownerUserId: s.ownerUserId,
        createdAt: new Date().toISOString(),
      });
    }
  }

  /**
   * 活数据可溯（PRD-live-traceable-data §3.1）：一个"合成数据源"连接（确定性、按名幂等复用），
   * 承载所有合成 RawDataset。使演示租户在数据源页能看到真实的连接与原始表，而非凭空对象。
   */
  private async ensureSyntheticConnection(ctx: AuthCtx): Promise<string> {
    const SYNTH_NAME = "合成数据源（确定性生成）";
    const existing = (await this.repos.connections.list(ctx.tenantId, (c) => c.name === SYNTH_NAME))[0];
    if (existing) return existing.id;
    const conn: Connection = {
      id: newId("conn"),
      tenantId: ctx.tenantId,
      connectorTypeKey: "mock_erp",
      name: SYNTH_NAME,
      config: { synthetic: true },
      status: "ACTIVE",
      lastSyncAt: new Date().toISOString(),
    };
    await this.repos.connections.put(conn);
    return conn.id;
  }

  /**
   * SEED_DEMO 多源系统连接：补齐 mock 中 8 个 connections（ERP/CRM/IoT/PLM/MES/QMS/SRM），
   * 使数据接入控制台按源系统分组展示，RawDataset 的 dataset 名与 BINDINGS 一致（plm_platforms 等）。
   *
   * WO-DATAMODE-UNIFY-PROVENANCE（KILL-MOCK-RED·诚实标注）：这些"源系统"连接是**合成 demo 夹具**——其数据全由
   * generateBattery 确定性合成（无真 ERP/MES/IoT 后端），故 config.synthetic===true 诚实声明其合成 provenance
   * （与"合成数据源（确定性生成）"连接同标识）。使 buildSynthProvenancePredicate 能把经 BINDINGS 落到这些连接的
   * demo 物化对象（Base→conn-mes / Equipment→conn-iot / Order→conn-erp …）正确判为合成，不冒充 LIVE/实测。
   * 真接入（真 ERP 上传/连接）走独立连接·无此标识 → measurement=LIVE 且 provenance 非合成 = 真实测（R14 通用标识非连接名）。
   */
  private async ensureSourceConnections(ctx: AuthCtx): Promise<Map<string, string>> {
    const defs = [
      { id: "conn-erp", connectorTypeKey: "mock_erp", name: "ERP 主数据" },
      { id: "conn-crm", connectorTypeKey: "rest_api", name: "CRM 订单" },
      { id: "conn-iot", connectorTypeKey: "rest_api", name: "IoT 时序通道" },
      { id: "conn-plm", connectorTypeKey: "rest_api", name: "PLM 产品生命周期管理" },
      { id: "conn-mes", connectorTypeKey: "rest_api", name: "MES 制造执行系统" },
      { id: "conn-qms", connectorTypeKey: "rest_api", name: "QMS 质量管理系统" },
      { id: "conn-srm", connectorTypeKey: "rest_api", name: "SRM 供应商关系管理" },
    ];
    const map = new Map<string, string>();
    for (const d of defs) {
      const existing = await this.repos.connections.get(ctx.tenantId, d.id);
      if (existing) { map.set(d.id, existing.id); continue; }
      const conn: Connection = {
        id: d.id,
        tenantId: ctx.tenantId,
        connectorTypeKey: d.connectorTypeKey,
        name: d.name,
        config: { synthetic: true },
        status: "ACTIVE",
        lastSyncAt: new Date().toISOString(),
      };
      await this.repos.connections.put(conn);
      map.set(d.id, conn.id);
    }
    return map;
  }

  private async instantiateBattery(
    ctx: AuthCtx,
    seed: number,
    scale: "S" | "M" | "L" | "XL",
    origin: { type: "SYNTHETIC"; jobId: string },
    // 轨L 增量2：chainMode=true（仅 demo）→ 本体类型不在此直 upsert，改由真建模链
    // （derive→确定性策展PATCH→publish→materialize）产出；仍产 rawDataset+链路类型+链路实例。
    chainMode = false,
  ): Promise<number> {
    // 治理增量 §1：先注册域（object_types.domain FK 校验目标 + 检索/图谱按域分组）。域两模式都先注册（publish 归域校验需要）。
    await this.seedDomains(ctx);
    if (!chainMode) {
      // A 路：直接 upsert 策展类型 + 早发布版本。chainMode 下这两步移交建模链（末尾 seedDemoOntologyViaChain）。
      for (const t of batteryObjectTypes()) {
        const existing = await this.ontology.getType(ctx, t.key);
        if (!existing) await this.ontology.upsertType(ctx, t);
      }
    }
    // 链路类型：两模式都种（§1.A 末行：A 路链路种法保留，沙盘传导依赖其 key；upsertLinkType 不校验目标类型存在）。
    for (const lt of batteryLinkTypes()) await this.ontology.upsertLinkType(ctx, lt);
    if (!chainMode && (await this.ontology.currentVersion(ctx.tenantId)) === 0) {
      await this.ontology.publishVersion(ctx);
    }
    const g = generateBattery(seed, scale);
    let n = 0;
    // chainMode：收集链产 rawDataset id 喂建模链（按 putAll 调用序）。
    const rawDsIds: string[] = [];
    // WO-MODELING-INTERACTIVE：记录每个类型实际物化来源（连接+数据集+字段映射），供 A 路末尾 provenance 回填。
    const materializedBindings = new Map<string, { connId: string; dataset: string; fieldMappings: Record<string, string> }>();
    // 活数据可溯（PRD-live-traceable-data §3.1）：合成对象不再凭空落库，而是经"合成数据源→
    // RawDataset(原始行)→物化为对象"的真链路；每对象 origin 记 rawDatasetId/rawRowIdx，使数据源页
    // 可见原始数据、推演结果可溯回源头。确定性：连接/原始表/对象/backref 均由 (industry,scale,seed) 决定。
    const synthConnId = await this.ensureSyntheticConnection(ctx);
    const sourceConnMap = await this.ensureSourceConnections(ctx);
    const putAll = async (type: string, rows: Record<string, unknown>[], pk: string) => {
      // 按 BINDINGS 取源系统连接与数据集名（使数据接入控制台按 ERP/PLM/MES/QMS/SRM/IoT 分组展示）
      const binding = BINDINGS[type]?.[0];
      const sourceConnId = binding ? (sourceConnMap.get(binding.connId) ?? synthConnId) : synthConnId;
      const dsName = binding ? binding.dataset : type;
      // ① 原始表：按 连接+数据集名 幂等复用 id，原始行可经 /a/v1/raw-datasets 查看
      const existingDs = (await this.repos.rawDatasets.list(ctx.tenantId, (d) => d.sourceConnId === sourceConnId && d.name === dsName))[0];
      const ds: RawDataset = {
        id: existingDs?.id ?? newId("rds"),
        tenantId: ctx.tenantId,
        sourceConnId,
        name: dsName,
        fields: profileRows(rows),
        rowCount: rows.length,
        syncedAt: new Date().toISOString(),
      };
      await this.repos.rawDatasets.put(ds);
      await this.repos.rawRows.replace(ctx.tenantId, ds.id, rows);
      // WO-MODELING-INTERACTIVE：该类型真实来源 = 刚落的 RawDataset。字段映射优先用 BINDINGS 的细映射，
      // 否则用恒等映射（合成物化时 props 即原始行，propKey===sourceField），供末尾回填对象类型 provenance。
      materializedBindings.set(type, {
        connId: sourceConnId,
        dataset: dsName,
        fieldMappings: binding?.fieldMappings ?? Object.fromEntries(ds.fields.map((f) => [f.name, f.name])),
      });
      if (chainMode) {
        // chainMode：只产 rawDataset+rawRows，对象由建模链 materialize 产（统一 id 字节同 A 路）。
        rawDsIds.push(ds.id);
        return;
      }
      // ② 物化为对象，origin 记源头 backref（rawDatasetId + 行序）
      let idx = 0;
      for (const row of rows) {
        await this.repos.objects.put({
          id: `obj_${type.toLowerCase()}_${String(row[pk])}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
          tenantId: ctx.tenantId,
          type,
          props: row,
          origin: { ...origin, sourceConnId, rawDatasetId: ds.id, rawRowIdx: idx },
        });
        idx++;
        n++;
      }
    };
    await putAll("Base", g.bases, "baseId");
    // WO-SANDBOX-D1×E1 接缝 · 节拍落库。**此前缺的就是这一行**：
    // `synthetic/cadence.ts` 早已能从种子自身的发生序列推出全链节拍，但没有任何路径把它写出去，
    // 运行态 `Cadence` 恒 0 条，于是 E1 归因 / E4 推演 / F1 线路图全都取不到 —— 模块绿、链路断。
    // 值全部由种子推导（本文件不带任何节拍天数字面量）；推不出的行带 `emptyReason` 照样落库（诚实缺席可查询）。
    await putAll("Cadence", cadenceObjectRows(deriveChainCadences(g)), "nodeId");
    await putAll("ProductPlatform", g.productPlatforms, "platformId");
    await putAll("ProductSeries", g.productSeries, "seriesId");
    await putAll("Model", g.models, "modelId");
    await putAll("ProductVersion", g.productVersions, "versionId");
    await putAll("BOMHeader", g.bomHeaders, "bomId");
    await putAll("BOMDetail", g.bomDetails, "bomDetailId");
    await putAll("Routing", g.routings, "routingId");
    await putAll("Operation", g.operations, "operationId");
    await putAll("ProcessCapabilityWindow", g.processCapabilities, "capabilityId");
    await putAll("QualityStandard", g.qualityStandards, "standardId");
    await putAll("InspectionCharacteristic", g.inspectionCharacteristics, "charId");
    await putAll("ProductLineCapability", g.productLineCapabilities, "capId");
    await putAll("ProductEquipmentCapability", g.productEquipmentCapabilities, "equipCapId");
    await putAll("EngineeringChange", g.engineeringChanges, "changeId");
    await putAll("MaterialAlternative", g.materialAlternatives, "altId");
    await putAll("Workshop", g.workshops, "workshopId");
    await putAll("Order", g.orders, "so");
    await putAll("OrderLine", g.orderLines, "lineId"); // WO-ORDERLINE：订单明细行（紧随 Order·SO→型号行·勾稽 Σ行===头）
    await putAll("Line", g.lines, "lineId");
    await putAll("Process", g.processes, "processId");
    await putAll("Equipment", g.equipment, "equipId");
    await putAll("MaintPlan", g.maintPlans, "planId");
    await putAll("Segment", g.segments, "segKey");
    await putAll("Shipment", g.shipments, "shipId");
    await putAll("Warehouse", g.warehouses, "warehouseId"); // WO-WAREHOUSE-CUSTLOC：仓库（每基地 N 仓·库存仓位落点）
    // WO-INVENTORY-3TIER 库存三层闭环：完工入库派生的成品库存 FinishedGoodsInventory + 库存流水 InventoryTxn
    // （SEAM 端到端前提；派生源 WorkOrder 由下方 ①b 决策相关 MES 块统一物化，此处不再重复落库）。
    await putAll("FinishedGoodsInventory", g.finishedGoodsInv, "fgId");
    await putAll("InventoryTxn", g.inventoryTxns, "txnId");
    await putAll("OrderPromise", g.orderPromises, "promiseId"); // WO-ATP-PROMISE：订单承诺台账（对每 OPEN 订单 ATP 基线）
    await putAll("InterBaseTransfer", g.interBaseTransfers, "transferId"); // WO-INTERBASE-TRANSFER：跨基地调拨对象化（R13）
    await putAll("DataSourceHealth", g.dataHealth, "sourceId");
    // cockpit P1 绿地
    await putAll("DemandSegment", g.demandSegments, "segId");
    await putAll("FinancePlan", g.financePlans, "finId");
    await putAll("MaterialBalance", g.materialBalances, "matBalId");
    // cockpit P2 + SPINE 绿地（规划决策推演 + 根因 DAG + 目标-指标-责任骨架）
    await putAll("KSF", g.ksfs, "ksfId");
    await putAll("Principal", g.principals, "principalId");
    await putAll("Metric", g.metrics, "metricId");
    await putAll("RootCauseChain", g.rootCauseChains, "chainId");
    await putAll("SopVersionRow", g.sopVersionRows, "verId");
    // 20 场景目录 §7 扩展数据（E6b）：13 求解器所需对象类型 + 实例（确定性 + 戏剧点植入）。
    // chainMode：扩展类型同样移交建模链产出（末尾 seedDemoOntologyViaChain 覆盖 battery+extended 全 34 类）。
    if (!chainMode) {
      for (const t of extendedObjectTypes()) {
        if (!(await this.ontology.getType(ctx, t.key))) await this.ontology.upsertType(ctx, t);
      }
    }
    const ext = generateExtended(seed, { models: g.models as { modelId: string }[], bases: g.bases as { baseId: string; name: string }[], lines: g.lines as { lineId: string }[], equipment: g.equipment as { equipId: string; oeeA?: number; oeeP?: number; oeeQ?: number }[], materialBalances: g.materialBalances as { matBalId: string; gapTon?: number; netDemandTon?: number }[], demandSegments: g.demandSegments as { segId?: string; segment?: string; demandWanPerYearP50?: number; act?: number; priceWan?: number; marginPct?: number; floorPct?: number }[] }, scale);
    await putAll("Material", ext.materials, "matId");
    await putAll("Supplier", ext.suppliers, "supplierId");
    await putAll("MaterialBatch", ext.materialBatches, "batchId");
    await putAll("Customer", ext.customers, "custId");
    await putAll("CustomerLocation", ext.customerLocations, "locId"); // WO-WAREHOUSE-CUSTLOC：客户交付地点（交付地理落点）
    await putAll("ARInvoice", ext.arInvoices, "invoiceId");
    await putAll("Certification", ext.certifications, "certId");
    await putAll("EnergyMeter", ext.energyMeters, "meterId");
    await putAll("ChangeoverMatrix", ext.changeoverMatrix, "pairId");
    await putAll("CapexProject", ext.capexProjects, "projectId");
    await putAll("PurchaseOrder", ext.purchaseOrders, "poId");
    // WO-SANDBOX-D2：采购段两段新承载（清关仅进口单有 → 条数 < PO 数；到货检验每单必检 → 条数 == PO 数）。
    await putAll("CustomsClearance", ext.customsClearances, "clearanceId");
    await putAll("IncomingInspection", ext.incomingInspections, "inspectionId");
    await putAll("CarbonFactor", ext.carbonFactors, "factorId");
    await putAll("FinanceAccount", ext.financeAccounts, "accId");
    await putAll("FinanceMetric", ext.financeMetrics, "metricId");
    // WO-CEO-2 供应链/地缘/决策域（gap_attribution 因果链实体·§0 案例落成真对象）
    await putAll("LongTermAgreement", ext.longTermAgreements, "ltaId");
    await putAll("BackupSupplierPool", ext.backupSupplierPools, "poolId");
    await putAll("CommodityPriceTrend", ext.commodityPriceTrends, "trendId");
    await putAll("DecisionGap", ext.decisionGaps, "gapId");
    await putAll("CausalFactor", ext.causalFactors, "factorId");
    await putAll("TriggerRule", ext.triggerRules, "triggerId"); // WO-CEO-3 触发规则
    // WO-CEO-DATA-2 每指标 drill 真对象（market_share / revenue / cash / demand_attain）。
    await putAll("CompetitorShare", ext.competitorShares, "shareId");
    await putAll("BidRecord", ext.bidRecords, "bidId");
    await putAll("CompetitorPrice", ext.competitorPrices, "priceId");
    await putAll("PipelineOpportunity", ext.pipelineOpportunities, "oppId");
    await putAll("WinLossRecord", ext.winLossRecords, "recordId");
    await putAll("PriceRealization", ext.priceRealizations, "priceId");
    await putAll("ARAging", ext.arAgings, "agingId");
    await putAll("DSO", ext.dsos, "dsoId");
    await putAll("OverdueRecord", ext.overdueRecords, "overdueId");
    // WO-TIER3 毛利桥（gross_profit 专属反向归因域 drill 真对象·impactYi 由 DemandSegment×MaterialBalance 确定性派生）。
    await putAll("GrossMarginBridge", ext.grossMarginBridges, "bridgeId");
    // WO-EXCEPTION-EVENT · 四源归一异常事件（G-EXCEPTION-SCATTER）。
    //  ① 物化 3 源对象（DefectRecord/EquipmentDowntime/EquipmentAlarm）使 refId 可下钻回真源（R13）——
    //     此前仅本体类型存在、无 demo 实例；MaterialBalance/TriggerRule 上文已物化。
    await putAll("DefectRecord", g.defectRecords, "defectId");
    await putAll("EquipmentDowntime", g.equipmentDowntimes, "dtId");
    await putAll("EquipmentAlarm", g.equipmentAlarms, "alarmId");
    //  ①b 决策相关执行层 5 类（disjoint 于上 exc 的 3 类·生成器已产、原物化清单漏）：库存/Bug2(WorkOrder/WIPLot)、
    //     良率(QualityLot/InspectionResult)、设备(EquipmentOEE)——补齐使 yield_diagnosis/库存/设备问题有真源。
    //     高量低值执行类(ShiftPlan/ProductionSchedule/WIPMove/操作工考勤等)保持模型态不物化（避单次 seed 逾万对象拖垮）。
    await putAll("WorkOrder", g.workOrders, "woId");
    await putAll("WIPLot", g.wipLots, "lotId");
    await putAll("QualityLot", g.qualityLots, "qlotId");
    await putAll("InspectionResult", g.inspectionResults, "resultId");
    await putAll("EquipmentOEE", g.equipmentOEEs, "oeeId");
    //  ①c WO-OPT-WHATIF-CLOSE · 设备维修工单（同一批「生成器已产、物化清单漏」的欠账，本轮补最后一类）。
    //     `MaintenanceOrder` 在 demo 是**完整声明却零实例**的类型：propDef(battery.ts:1581) + 展示名 + 连接器映射
    //     (conn-eam/eam_maint_orders) + 数据类目(data-categories.ts:53) + 链路类型 maint_for_equip/spare_for_maint
    //     全都在，唯独 193 行确定性行（battery.ts hashString 派生·**零 rng**）从没落库 ⇒ 上述接线全是死的。
    //     它**不属于**上一行注释里那批「高量低值执行类」——193 行比已物化的 WorkOrder(260) 还少，
    //     且设备维修直接影响产能，是决策相关执行层。纯投影 putAll（无随机/时钟）⇒ R6 同 seed 字节一致。
    await putAll("MaintenanceOrder", g.maintenanceOrders, "moId");
    //  ② 统一异常流：generateBattery 已投 4 本地源（停机/告警/缺陷/缺料）；此处合并第 5 源 TriggerRule
    //     （→CUSTOMER，出自 generateExtended，同一 projectExceptionEvents·纯投影 R6），四源归一落一等对象。
    const t0Exc = Date.parse(`${BATTERY_SOLVER_PARAMS.forecastStart as string}T00:00:00Z`);
    const triggerExc = projectExceptionEvents({ triggerRules: ext.triggerRules }, t0Exc);
    const exceptionEvents = [...(g.exceptionEvents as Record<string, unknown>[]), ...triggerExc];
    await putAll("ExceptionEvent", exceptionEvents, "excId");
    // 外部域（EXT_SIG）：环境信号一等对象化（domain=external；来源/单位/新鲜度可溯 R13）。
    await putAll("ExternalSignal", MOCK_EXTERNAL_DATA.external_signals!, "signalKey");
    // links: model_producible_at + order_for_model + model_certified_on (cert state on edge props).
    for (const m of g.models) {
      for (const baseId of m.bases as string[]) {
        await this.repos.links.put({
          id: `lnk_mpa_${m.modelId}_${baseId}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
          tenantId: ctx.tenantId,
          type: "model_producible_at",
          fromId: `obj_model_${m.modelId}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
          toId: `obj_base_${baseId}`,
          origin,
        });
      }
    }
    for (const o of g.orders) {
      await this.repos.links.put({
        id: `lnk_ofm_${o.so}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
        tenantId: ctx.tenantId,
        type: "order_for_model",
        fromId: `obj_order_${o.so}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
        toId: `obj_model_${o.model}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
        origin,
      });
    }
    for (const cl of g.certLinks) {
      await this.repos.links.put({
        id: `lnk_cert_${cl.modelId}_${cl.lineId}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
        tenantId: ctx.tenantId,
        type: "model_certified_on",
        fromId: `obj_model_${cl.modelId}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
        toId: `obj_line_${cl.lineId}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
        props: { status: cl.status, modelId: cl.modelId, baseId: cl.baseId },
        origin,
      });
    }

    // 跨域切片 order_fulfillment_360 的链路边（product→factory→process→equip→supply→commercial）。
    // 全部由对象 FK 确定性派生（无随机/时钟），同 seed 字节级一致。
    const oid = (type: string, pk: unknown) => `obj_${type.toLowerCase()}_${String(pk)}`.replace(/[^\p{L}\p{N}_-]/gu, "_");
    const putLink = async (idRaw: string, type: string, fromId: string, toId: string, props?: Record<string, unknown>) => {
      await this.repos.links.put({
        id: idRaw.replace(/[^\p{L}\p{N}_-]/gu, "_"),
        tenantId: ctx.tenantId,
        type,
        fromId,
        toId,
        ...(props ? { props } : {}),
        origin,
      });
    };
    // product: Series → Platform（series.platformId）
    for (const s of g.productSeries) await putLink(`lnk_sbp_${s.seriesId}`, "series_belongs_to_platform", oid("ProductSeries", s.seriesId), oid("ProductPlatform", s.platformId));
    // product: Model → Series（model.seriesId）
    for (const m of g.models) {
      const seriesId = m.seriesId as string | undefined;
      if (seriesId) await putLink(`lnk_mbs_${m.modelId}`, "model_belongs_to_series", oid("Model", m.modelId), oid("ProductSeries", seriesId));
    }
    // product: Version → Model（version.modelId）
    for (const v of g.productVersions) await putLink(`lnk_vbm_${v.versionId}`, "version_belongs_to_model", oid("ProductVersion", v.versionId), oid("Model", v.modelId));
    // product: BOMHeader → ProductVersion（bom.versionId）
    for (const bh of g.bomHeaders) await putLink(`lnk_bbv_${bh.bomId}`, "bom_belongs_to_version", oid("BOMHeader", bh.bomId), oid("ProductVersion", bh.versionId));
    // product: BOMDetail → BOMHeader（detail.bomId）
    for (const bd of g.bomDetails) await putLink(`lnk_dbb_${bd.bomDetailId}`, "detail_belongs_to_bom", oid("BOMDetail", bd.bomDetailId), oid("BOMHeader", bd.bomId));
    // product: BOMDetail → Material（detail.materialId）
    for (const bd of g.bomDetails) await putLink(`lnk_dum_${bd.bomDetailId}`, "detail_uses_material", oid("BOMDetail", bd.bomDetailId), oid("Material", bd.materialId));
    // process: Routing → Model（routing.modelId）
    for (const r of g.routings) await putLink(`lnk_rbm_${r.routingId}`, "routing_belongs_to_model", oid("Routing", r.routingId), oid("Model", r.modelId));
    // process: Operation → Routing（operation.routingId）
    for (const o of g.operations) await putLink(`lnk_obr_${o.operationId}`, "operation_belongs_to_routing", oid("Operation", o.operationId), oid("Routing", o.routingId));
    // process: ProcessCapabilityWindow → Operation（capability.operationId）
    for (const c of g.processCapabilities) await putLink(`lnk_cbo_${c.capabilityId}`, "capability_belongs_to_operation", oid("ProcessCapabilityWindow", c.capabilityId), oid("Operation", c.operationId));
    // quality: QualityStandard → Model（standard.modelId）
    for (const qs of g.qualityStandards) await putLink(`lnk_qsm_${qs.standardId}`, "standard_belongs_to_model", oid("QualityStandard", qs.standardId), oid("Model", qs.modelId));
    // quality: InspectionCharacteristic → QualityStandard（char.standardId）
    for (const ic of g.inspectionCharacteristics) await putLink(`lnk_cbs_${ic.charId}`, "char_belongs_to_standard", oid("InspectionCharacteristic", ic.charId), oid("QualityStandard", ic.standardId));
    // factory: ProductLineCapability → Line（cap.lineId）
    for (const plc of g.productLineCapabilities) await putLink(`lnk_plc_${plc.capId}`, "product_line_capability", oid("ProductLineCapability", plc.capId), oid("Line", plc.lineId));
    // equip: ProductEquipmentCapability → Equipment（pec.equipmentId）
    for (const pec of g.productEquipmentCapabilities) await putLink(`lnk_pec_${pec.equipCapId}`, "product_equip_capability", oid("ProductEquipmentCapability", pec.equipCapId), oid("Equipment", pec.equipmentId));
    // lifecycle: EngineeringChange → Model（change.modelId）
    for (const ec of g.engineeringChanges) await putLink(`lnk_cam_${ec.changeId}`, "change_affects_model", oid("EngineeringChange", ec.changeId), oid("Model", ec.modelId));
    // supply: MaterialAlternative → Material（alt.primaryMaterialId）
    for (const ma of g.materialAlternatives) {
      await putLink(`lnk_afm_${ma.altId}`, "alt_for_material", oid("MaterialAlternative", ma.altId), oid("Material", ma.primaryMaterialId));
      // WO-PROCESS-TICK-COVERAGE 逆边：与上一行**共用同一次遍历**（不是抄一遍派生式）⇒ 两向严格互逆。
      await putLink(`lnk_mha_${ma.altId}`, "material_has_alternative", oid("Material", ma.primaryMaterialId), oid("MaterialAlternative", ma.altId));
    }
    // supply: Material → Supplier（material.supplierId）
    for (const m of ext.materials) {
      const supplierId = (m as { supplierId?: string }).supplierId;
      if (supplierId) await putLink(`lnk_msb_${(m as { matId: string }).matId}`, "material_supplied_by", oid("Material", (m as { matId: string }).matId), oid("Supplier", supplierId));
    }

    // WO-INTERBASE-TRANSFER：调拨三条链路（transfer_from_base/transfer_to_base→Base·transfer_of_model→Model·N:1）。
    // fromId/toId 是 baseId（下钻 obj_base_<baseId> = BASE_REGISTRY 真基地），model 是 modelId（obj_model_<modelId>）。
    for (const x of g.interBaseTransfers) {
      const tid = x.transferId as string;
      await putLink(`lnk_xff_${tid}`, "transfer_from_base", oid("InterBaseTransfer", tid), oid("Base", x.fromBase));
      // WO-PROCESS-TICK-COVERAGE 逆边（**只逆调出端**）：调拨是由调出基地的负载压出来的决策，
      // 调入端是结果不是原因；两端都逆会让同一条调拨被两个基地各推一次，等于把压力算两遍。
      await putLink(`lnk_bdt_${tid}`, "base_dispatches_transfer", oid("Base", x.fromBase), oid("InterBaseTransfer", tid));
      await putLink(`lnk_xft_${tid}`, "transfer_to_base", oid("InterBaseTransfer", tid), oid("Base", x.toBase));
      await putLink(`lnk_xfm_${tid}`, "transfer_of_model", oid("InterBaseTransfer", tid), oid("Model", x.model));
    }

    // factory: Base → Workshop（Workshop.baseId；方向翻转：Base 1:N Workshop）
    for (const w of g.workshops) {
      await putLink(`lnk_wbb_${w.workshopId}`, "workshop_belongs_to_base", oid("Base", w.baseId), oid("Workshop", w.workshopId));
    }
    // WO-WAREHOUSE-CUSTLOC · factory: Base → Warehouse（Warehouse.baseId；方向翻转：Base 1:N Warehouse）
    for (const w of g.warehouses) {
      await putLink(`lnk_wob_${w.warehouseId}`, "warehouse_of_base", oid("Base", w.baseId), oid("Warehouse", w.warehouseId));
    }
    // factory: Workshop → Line（Line 的 workshopId 从 lineId 派生：LINE-WS-{baseId}-{suffix}；方向翻转：Workshop 1:N Line）
    for (const l of g.lines) {
      const workshopId = (l.lineId as string).replace("LINE-", "");
      await putLink(`lnk_lbw_${l.lineId}`, "line_belongs_to_workshop", oid("Workshop", workshopId), oid("Line", l.lineId));
    }
    // factory: Base → Line（Line.baseId，保留向后兼容；方向翻转：Base 1:N Line）
    for (const l of g.lines) {
      await putLink(`lnk_lbb_${l.lineId}`, "line_belongs_to_base", oid("Base", l.baseId), oid("Line", l.lineId));
    }
    // process: Line → Process（Process.lineId）
    for (const pr of g.processes) {
      await putLink(`lnk_lhp_${pr.processId}`, "line_has_process", oid("Line", pr.lineId), oid("Process", pr.processId));
    }
    // equip: Equipment → Process（Equipment.processId）
    for (const eq of g.equipment) {
      await putLink(`lnk_eui_${eq.equipId}`, "equip_used_in", oid("Equipment", eq.equipId), oid("Process", eq.processId));
      // WO-PROCESS-TICK-COVERAGE 逆边：工序排队压力要能落到**具体设备**上（设备是产能瓶颈的真落点）。
      await putLink(`lnk_pue_${eq.equipId}`, "process_uses_equipment", oid("Process", eq.processId), oid("Equipment", eq.equipId));
    }
    // supply: Model → Material（确定性 BOM：每型号取 4 种物料，按型号序错位选取，覆盖全部 8 料）
    const matIds = ext.materials.map((m) => String((m as { matId: string }).matId));
    for (let mi = 0; mi < g.models.length; mi++) {
      const m = g.models[mi] as { modelId: string };
      const bom = Array.from({ length: 4 }, (_, k) => matIds[(mi * 2 + k) % matIds.length] as string);
      for (const matId of new Set(bom)) {
        await putLink(`lnk_mum_${m.modelId}_${matId}`, "model_uses_material", oid("Model", m.modelId), oid("Material", matId));
        // WO-P1 影响向逆边：与上一行**共用同一个 bom 变量**（不是抄一遍派生式）⇒ 两向严格互逆，
        // 改 BOM 派生式时不可能只改一半（抄一份就会漂，本仓已因「金丝雀各抄一份正则」吃过亏）。
        await putLink(`lnk_mubm_${matId}_${m.modelId}`, "material_used_by_model", oid("Material", matId), oid("Model", m.modelId));
      }
    }
    // ── WO-P1 · 供应「影响方向」逆边（类型声明见 battery.ts `batteryLinkTypes()` 同名三条）────────
    // 既有 `material_supplied_by`(Material→Supplier) / `model_uses_material`(Model→Material) /
    // `order_for_model`(Order→Model) 表达的是**归属 FK**，方向「下游→上游」；
    // 传导引擎只沿 fromId→toId 走（`sim/propagation.ts` navOut），拿归属边跑影响传导必然走反。
    // 这里按**同一批 FK** 反投影出「上游→下游」的影响边（供应商断供→物料短缺→型号缺料→订单交不出）。
    // 纯投影：遍历序跟着既有边、无 rng/无时钟 ⇒ 同 (industry, scale, seed) 重跑字节一致（R6）。
    for (const m of ext.materials) {
      const supplierId = (m as { supplierId?: string }).supplierId;
      const matId = (m as { matId: string }).matId;
      if (supplierId) await putLink(`lnk_ssm_${supplierId}_${matId}`, "supplier_supplies_material", oid("Supplier", supplierId), oid("Material", matId));
    }
    for (const o of g.orders) {
      await putLink(`lnk_mdbo_${o.so}`, "model_demanded_by_order", oid("Model", o.model), oid("Order", o.so));
    }
    // ── commercial: Order → Customer ────────────────────────────────────────
    // WO-QUOTE-MARGIN-CUSTOMER（欠账 #118）：**按真实归属绑定**，不再按订单序轮转。
    //
    // 修前：`custIds[oi % custIds.length]` —— 与 `Order.cust` 上写的客户名毫无关系。实测（seed 42·S）
    //   「商用车集团G」名下 3 张全是广汽集团（乘用车）的单，「电网公司F」名下挂着宇通客车（商用车）的单。
    //   于是任何沿这条边做的客户维求解（S15 `quote_margin`）都在算别人的订单，却把提问者的客户名印在答案上。
    // 修后：`Order.cust` → `ORDER_CUST_TO_CUSTOMER` 归属册 → `Customer.custName` → `custId`。
    //   · 边上加带 `custName`/`orderCust`，让「这条边凭什么这么连」在边自身可自证（不必回查册）。
    //   · 归属册里没有的订单客户名 → **不建边**（诚实缺席）。此前的轮转会给它随手落一个客户 ——
    //     那正是「张冠李戴的数比没有更危险」（`solvers/decision-info.ts:304` 早已独立登记过同一事实）。
    const custIdByName = new Map(ext.customers.map((c) => [String((c as { custName: string }).custName), String((c as { custId: string }).custId)]));
    for (const ord of g.orders) {
      const o = ord as { so: string; cust?: string };
      const orderCust = String(o.cust ?? "");
      const custName = orderCust ? customerNameOfOrderCust(orderCust) : undefined;
      const custId = custName ? custIdByName.get(custName) : undefined;
      if (!custId || !custName) continue; // 无归属登记 → 不建边（不轮转、不落首客户）
      await putLink(`lnk_ooc_${o.so}`, "order_of_customer", oid("Order", o.so), oid("Customer", custId), { custId, custName, orderCust });
    }

    // ---- 8 域切片增量：13 条跨域边中的 11 条（由 ext/g 的对象 FK 确定性派生）----
    const P = (o: unknown) => o as Record<string, unknown>;
    // factory（认证）: Model → Certification（cert.modelId）
    for (const c of ext.certifications) await putLink(`lnk_mhc_${P(c).certId}`, "model_has_cert", oid("Model", P(c).modelId), oid("Certification", P(c).certId));
    // commercial（应收）: Customer → ARInvoice（按 custName 匹配 custId）
    const custByName = new Map(ext.customers.map((c) => [String(P(c).custName), String(P(c).custId)]));
    for (const inv of ext.arInvoices) {
      const cid = custByName.get(String(P(inv).custName));
      if (cid) await putLink(`lnk_chi_${P(inv).invoiceId}`, "customer_has_invoice", oid("Customer", cid), oid("ARInvoice", P(inv).invoiceId));
    }
    // WO-WAREHOUSE-CUSTLOC · commercial: CustomerLocation → Customer（loc.customerRef；参照 order_of_customer 方向）
    for (const loc of ext.customerLocations) {
      await putLink(`lnk_cloc_${P(loc).locId}`, "custloc_of_customer", oid("CustomerLocation", P(loc).locId), oid("Customer", P(loc).customerRef));
      // WO-PROCESS-TICK-COVERAGE 逆边：客户侧压力（信用/应收）要能落到该客户的**收货地点**上。
      await putLink(`lnk_chl_${P(loc).locId}`, "customer_has_location", oid("Customer", P(loc).customerRef), oid("CustomerLocation", P(loc).locId));
    }
    // supply（批次）: Material → MaterialBatch（batch.matId）
    for (const bt of ext.materialBatches) await putLink(`lnk_mhb_${P(bt).batchId}`, "material_has_batch", oid("Material", P(bt).matId), oid("MaterialBatch", P(bt).batchId));
    // supply（采购）: Material → PurchaseOrder（po.matId）
    for (const po of ext.purchaseOrders) await putLink(`lnk_mpo_${P(po).poId}`, "material_supplied_by_po", oid("Material", P(po).matId), oid("PurchaseOrder", P(po).poId));
    // WO-SANDBOX-D2 · supply（采购责任方）: PurchaseOrder → Supplier（po.supplierId）——
    // 「这一单是谁供的」此前只能经 Material 主供间接猜，多供物料一猜就错。
    for (const po of ext.purchaseOrders) await putLink(`lnk_pos_${P(po).poId}`, "po_from_supplier", oid("PurchaseOrder", P(po).poId), oid("Supplier", P(po).supplierId));
    // WO-SANDBOX-D2 · supply（清关）: PurchaseOrder → CustomsClearance（仅进口单有）
    for (const cc of ext.customsClearances) await putLink(`lnk_pocc_${P(cc).clearanceId}`, "po_customs_cleared_by", oid("PurchaseOrder", P(cc).poId), oid("CustomsClearance", P(cc).clearanceId));
    // WO-SANDBOX-D2 · quality（到货检验）: PurchaseOrder → IncomingInspection（每单必检）
    for (const ii of ext.incomingInspections) await putLink(`lnk_poii_${P(ii).inspectionId}`, "po_inspected_by", oid("PurchaseOrder", P(ii).poId), oid("IncomingInspection", P(ii).inspectionId));
    // supply（碳因子）: Material → CarbonFactor（kind=material 时 key=matId）
    for (const cf of ext.carbonFactors) if (P(cf).kind === "material") await putLink(`lnk_mcf_${P(cf).factorId}`, "material_carbon", oid("Material", P(cf).key), oid("CarbonFactor", P(cf).factorId));
    // factory（能耗）: Base → EnergyMeter（em.baseId）
    for (const em of ext.energyMeters) await putLink(`lnk_bem_${P(em).meterId}`, "base_energy_meter", oid("Base", P(em).baseId), oid("EnergyMeter", P(em).meterId));
    // factory（换型）: Model → ChangeoverMatrix（cm.fromModel）
    for (const cm of ext.changeoverMatrix) await putLink(`lnk_mco_${P(cm).pairId}`, "model_changeover", oid("Model", P(cm).fromModel), oid("ChangeoverMatrix", P(cm).pairId));
    // capacity（在途）: Base → Shipment（sh.baseId）
    for (const sh of g.shipments) await putLink(`lnk_bsh_${P(sh).shipId}`, "base_has_shipment", oid("Base", P(sh).baseId), oid("Shipment", P(sh).shipId));
    // equip（检修）: Base → MaintPlan（mp.baseId）
    for (const mp of g.maintPlans) await putLink(`lnk_bmp_${P(mp).planId}`, "base_maint_plan", oid("Base", P(mp).baseId), oid("MaintPlan", P(mp).planId));
    // product（细分）: Model → Segment（确定性化学体系映射：S192→ess｜L148→com｜其余→pas）
    const segOf = (modelId: string) => (modelId.includes("S192") ? "ess" : modelId.includes("L148") ? "com" : "pas");
    for (const m of g.models) await putLink(`lnk_mis_${m.modelId}`, "model_in_segment", oid("Model", m.modelId), oid("Segment", segOf(String(m.modelId))));
    // quality（数据源）: Base → DataSourceHealth（N:N，每基地挂全部数据源）
    for (const b of g.bases) for (const dh of g.dataHealth) await putLink(`lnk_bdh_${b.baseId}_${P(dh).sourceId}`, "base_data_health", oid("Base", b.baseId), oid("DataSourceHealth", P(dh).sourceId));
    // finance（Phase5A）: Base → FinanceAccount（fa.baseId）
    for (const fa of ext.financeAccounts) await putLink(`lnk_bfn_${P(fa).accId}`, "base_finance", oid("Base", P(fa).baseId), oid("FinanceAccount", P(fa).accId));
    // WO-EXCEPTION-EVENT · 异常事件→源对象溯源边（exc_sourced_from·R13 全监听下钻）。toType 异构（5 源），
    // 真实源类型落 edge props.refType；目标 obj 已物化（3 源上文 putAll + MaterialBalance/TriggerRule 已物化）。
    for (const ev of exceptionEvents) {
      const refType = String(ev.refType);
      const refId = String(ev.refId);
      await putLink(`lnk_exc_${String(ev.excId)}`, "exc_sourced_from", oid("ExceptionEvent", ev.excId), oid(refType, refId), { refType, refId });
      // WO-PROCESS-TICK-COVERAGE 逆边（**只逆 DefectRecord 那一源**）：缺陷变多 → 异常处置积压。
      // 为什么不把五源都逆：另四源（EquipmentAlarm/EquipmentDowntime/MaterialBalance/TriggerRule）
      // 今天在传导图上都不是 target，逆了也没有源能驱动它们 —— 那就是「接了线没数据」的边，
      // 只会让链路表变胖而屏上一动不动。等哪一源真被接进传导链了再逆哪一源。
      if (refType === "DefectRecord") {
        await putLink(`lnk_dre_${String(ev.excId)}`, "defect_raises_exception", oid("DefectRecord", refId), oid("ExceptionEvent", ev.excId));
      }
    }

    // §7.14 计划域种子：年度情景/触发条件/目标分解。分解值锚定 S1.1 rollup 的供给口径
    // （weeklyWan × 认证系数）—— 与 S&OP 平衡台/季度滚动同源，确定性（无时钟/随机）。
    const params = BATTERY_SOLVER_PARAMS as unknown as SolverParamsShape;
    const toObj = (type: string, rows: Record<string, unknown>[]): ObjectInstance[] =>
      rows.map((r, i) => ({ id: `tmp_${type}_${i}`, tenantId: ctx.tenantId, type, props: r, origin }));
    const certByModel = new Map<string, Map<string, string>>();
    for (const cl of g.certLinks) {
      let m = certByModel.get(cl.modelId);
      if (!m) {
        m = new Map();
        certByModel.set(cl.modelId, m);
      }
      m.set(cl.baseId, cl.status);
    }
    const rollup = computeRollup({
      tenantId: ctx.tenantId,
      params,
      bases: toObj("Base", g.bases),
      lines: toObj("Line", g.lines),
      processes: toObj("Process", g.processes),
      equipment: toObj("Equipment", g.equipment),
      maintPlans: toObj("MaintPlan", g.maintPlans),
      models: [],
      orders: [],
      shipments: [],
      segments: [],
      dataHealth: [],
      certByModel,
    });
    const baseCert = new Map<string, number>();
    for (const m of certByModel.values()) {
      for (const [baseId, status] of m) {
        baseCert.set(baseId, Math.max(baseCert.get(baseId) ?? 0, params.certFactors[status] ?? 1));
      }
    }
    // WO-SCALE-COHERENCE 断裂点D：weeklyTotal = Σ weeklyWan×certFactor（认证中 0.6 ramp）——与 planviews.ts 季度
    // 滚动看板 sup 同口径（dem=PlanTarget=annualBase 与 sup 同 cert 基·三档缺口平衡·不desync）。AnnualScenario.revenue
    // = 认证产能×52×P̄ ≈ 599 亿（= 需求 700 亿 − 认证爬坡供给缺口 ~14.5%，非玩具尺度）。修好断裂点B+C 后由玩具 15 亿
    // 升到企业级 599 亿（脱离玩具 40×）；与需求锚 700 亿的差 = 真实供给/认证缺口（SEAM 营收容差覆盖此 ramp）。
    const weeklyTotal = round(
      rollup.bases.reduce((a, b) => a + b.weeklyWan * (baseCert.get(b.baseId) ?? 0), 0),
      4,
    );
    // WO-SCALE-COHERENCE 断裂点D：avgUnitPrice 改需求加权 P̄ = Σ(demandWanPerYearP50×priceWan)/ΣdemandWanPerYearP50（≈1.8667 万元/套=18667 元/套），
    // 而非型号等权 mean → AOP.revenue = weeklyTotal×52×P̄ 收敛到 700 亿锚（收紧四方营收互核容差 ε≤12%）。
    const dsP50 = g.demandSegments.reduce((a, d) => a + (typeof d.demandWanPerYearP50 === "number" ? d.demandWanPerYearP50 : 0), 0);
    const dsRev = g.demandSegments.reduce((a, d) => a + (typeof d.demandWanPerYearP50 === "number" ? d.demandWanPerYearP50 : 0) * (typeof d.priceWan === "number" ? d.priceWan : 0), 0);
    const avgUnitPrice = Math.round((dsP50 > 0 ? dsRev / dsP50 : 0) * 1e4); // 万元/套 → 元/套
    const pd = generatePlanDomain(weeklyTotal, avgUnitPrice);
    await putAll("AnnualScenario", pd.scenarios, "scnId");
    await putAll("ScenarioTrigger", pd.triggers, "trigId");
    await putAll("PlanTarget", pd.planTargets, "tgtId");

    // 8 域切片增量：plan 域 2 条边（情景→目标 / 情景→投资），由 pd 的 key/scenarioKey 确定性派生。
    for (const t of pd.planTargets) {
      const scnId = `AOP-2026-${String(P(t).scenarioKey)}`;
      await putLink(`lnk_s2t_${P(t).tgtId}`, "scenario_to_target", oid("AnnualScenario", scnId), oid("PlanTarget", P(t).tgtId));
    }
    for (const s of pd.scenarios) {
      if (String(P(s).key) === "conservative") continue; // 保守情景不新增产能投资
      for (const cp of ext.capexProjects) await putLink(`lnk_s2c_${P(s).key}_${P(cp).projectId}`, "scenario_to_capex", oid("AnnualScenario", P(s).scnId), oid("CapexProject", P(cp).projectId));
    }
    // finance（Phase5A）: AnnualScenario → FinanceMetric（按 scenarioKey 匹配）
    for (const s of pd.scenarios) {
      const fm = ext.financeMetrics.find((m) => String(P(m).scenarioKey) === String(P(s).key));
      if (fm) await putLink(`lnk_s2f_${P(s).key}`, "scenario_to_finance", oid("AnnualScenario", P(s).scnId), oid("FinanceMetric", P(fm).metricId));
    }
    // plan（Phase7A）: Order → PlanTarget（按交期月匹配月度目标）→ Order 根直达 plan 域。
    const monthTargets = new Set(pd.planTargets.filter((t) => P(t).level === "month").map((t) => String(P(t).period)));
    for (const o of g.orders) {
      const month = String((o as { due?: string }).due ?? "").slice(0, 7);
      if (monthTargets.has(month)) await putLink(`lnk_otp_${o.so}`, "order_to_plantarget", oid("Order", o.so), oid("PlanTarget", `PT-${month}`));
    }

    // SPINE 骨架链：指标→KSF / 指标→责任人（由 Metric.ksfRef/ownerRef 确定性派生，骨架可视化 + R-一致）。
    for (const m of g.metrics) {
      const mid = oid("Metric", P(m).metricId);
      if (P(m).ksfRef) await putLink(`lnk_mak_${P(m).metricId}`, "metric_affects_ksf", mid, oid("KSF", P(m).ksfRef));
      if (P(m).ownerRef) await putLink(`lnk_mob_${P(m).metricId}`, "metric_ownedby", mid, oid("Principal", P(m).ownerRef));
    }
    // SPINE.2 责任闭环：目标树→责任人（年/季→运营负责人，月→计划部，确定性派生）。
    for (const t of pd.planTargets) {
      const owner = String(P(t).level) === "month" ? "prin-plan" : "prin-coo";
      await putLink(`lnk_pto_${P(t).tgtId}`, "plantarget_ownedby", oid("PlanTarget", P(t).tgtId), oid("Principal", owner));
    }
    // WO-CEO-2 gap_attribution：因果边 caused_by（果→因·CausalFactor 一等因果链·引擎遍历 C2/C9）。
    // 常数边·零 rng·同 seed 字节一致；边 id 由 from/to 确定性派生。
    for (const e of CAUSAL_EDGES) {
      await putLink(`lnk_cby_${e.from}_${e.to}`, "caused_by", oid("CausalFactor", e.from), oid("CausalFactor", e.to));
    }
    // WO-INVENTORY-3TIER 库存三层闭环链路（FG→Model/Warehouse·Txn→FG/WorkOrder；完工入库溯源）。
    const realModelIds = new Set(g.models.map((m) => String((m as { modelId: unknown }).modelId)));
    for (const fg of g.finishedGoodsInv) {
      const fgId = String(P(fg).fgId);
      // fg_of_model 仅在型号是真 Model 时连（部分完工工单 modelId 为储能等目录外型号 → 诚实不连悬空边）。
      if (realModelIds.has(String(P(fg).model))) {
        await putLink(`lnk_fgm_${fgId}`, "fg_of_model", oid("FinishedGoodsInventory", fgId), oid("Model", P(fg).model));
        // WO-PROCESS-TICK-COVERAGE 逆边：型号需求负载 → 成品库存被提走的压力（同一个 realModelIds
        // 守卫，不另抄一份 —— 抄一份就会漂，本仓已因「金丝雀各抄一份正则」吃过亏）。
        await putLink(`lnk_msf_${fgId}`, "model_stocked_as_finished_goods", oid("Model", P(fg).model), oid("FinishedGoodsInventory", fgId));
      }
      await putLink(`lnk_fgw_${fgId}`, "fg_at_warehouse", oid("FinishedGoodsInventory", fgId), oid("Warehouse", P(fg).warehouseId));
    }
    for (const tx of g.inventoryTxns) {
      const txnId = String(P(tx).txnId);
      await putLink(`lnk_txf_${txnId}`, "txn_for_fg", oid("InventoryTxn", txnId), oid("FinishedGoodsInventory", P(tx).fgRef));
      if (P(tx).woRef) await putLink(`lnk_txw_${txnId}`, "txn_from_wo", oid("InventoryTxn", txnId), oid("WorkOrder", P(tx).woRef));
    }
    // WO-ATP-PROMISE 订单承诺链路（承诺 → 订单·一订单一承诺 N:1；承诺溯源到销售订单）。
    for (const p of g.orderPromises) {
      const promiseId = String(P(p).promiseId);
      await putLink(`lnk_pfo_${promiseId}`, "promise_for_order", oid("OrderPromise", promiseId), oid("Order", P(p).orderRef));
      // WO-PROCESS-TICK-COVERAGE 逆边：订单缺口 → 交期承诺风险（P19 的读数就该跟着订单缺口动）。
      await putLink(`lnk_ohp_${promiseId}`, "order_has_promise", oid("Order", P(p).orderRef), oid("OrderPromise", promiseId));
    }
    // WO-ORDERLINE 订单拆行链路（明细行 → 订单头 N:1 + 明细行 → 型号 N:1；一单多型号真表达·行级溯源）。
    for (const ln of g.orderLines) {
      const lineId = String(P(ln).lineId);
      await putLink(`lnk_loo_${lineId}`, "line_of_order", oid("OrderLine", lineId), oid("Order", P(ln).orderRef));
      await putLink(`lnk_olm_${lineId}`, "orderline_for_model", oid("OrderLine", lineId), oid("Model", P(ln).model));
      // WO-PROCESS-TICK-COVERAGE 逆边：订单需求压力 → 拆行/排产要素确认压力（P18）。
      await putLink(`lnk_ohl_${lineId}`, "order_has_line", oid("Order", P(ln).orderRef), oid("OrderLine", lineId));
    }

    // ══════════════════════════════════════════════════════════════════════════════════
    // WO-PROCESS-TICK-COVERAGE 档 2 · 执行层「影响向逆边」实例（类型声明见 battery.ts 同名 15 条）
    //
    // 这一段与上面那些"顺手加一行"的逆边不同：这几条的**正向边本身从来没被物化过**
    // （`wo_on_line` / `wip_for_wo` / `qlot_for_wo` / `defect_for_wiplot` / `maint_for_equip`
    //  在 `batteryLinkTypes()` 里声明了很久，真链路表上一条实例都没有 —— 本单实测）。
    // 所以这里不是"反投影一条已有的边"，是**第一次把这批 FK 落成边**，且只落影响向那一向：
    // 归属向今天没有消费方，落了就是纯增重。哪天有消费方了再落哪一条。
    //
    // 纯投影（遍历既有对象数组、零 rng、零时钟）⇒ 同 (industry, scale, seed) 字节一致（R6）。
    // ══════════════════════════════════════════════════════════════════════════════════
    // D07 ①：Line → WorkOrder（wo.lineId）—— 产线吃紧 ⇒ 工单下达受阻
    for (const wo of g.workOrders) {
      await putLink(`lnk_lrw_${P(wo).woId}`, "line_runs_work_order", oid("Line", P(wo).lineId), oid("WorkOrder", P(wo).woId));
    }
    // D07 ②：WorkOrder → WIPLot（lot.woId）—— 工单积压 ⇒ 齐套发料/投料堆积
    for (const lot of g.wipLots) {
      await putLink(`lnk_wyw_${P(lot).lotId}`, "work_order_yields_wip_lot", oid("WorkOrder", P(lot).woId), oid("WIPLot", P(lot).lotId));
    }
    // D08 ①：WorkOrder → QualityLot（qlot.woId）—— 工单积压 ⇒ 过程质检攒批排队
    for (const ql of g.qualityLots) {
      await putLink(`lnk_wsq_${P(ql).qlotId}`, "work_order_sampled_by_quality_lot", oid("WorkOrder", P(ql).woId), oid("QualityLot", P(ql).qlotId));
    }
    // D08 ②：WIPLot → DefectRecord（def.lotId）—— 在制堆积 ⇒ 缺陷暴露变多
    for (const df of g.defectRecords) {
      await putLink(`lnk_wfd_${P(df).defectId}`, "wip_lot_found_defect", oid("WIPLot", P(df).lotId), oid("DefectRecord", P(df).defectId));
    }
    // D09：Equipment → MaintenanceOrder（mo.equipId）—— 设备负荷 ⇒ 维修派工积压
    for (const mo of g.maintenanceOrders) {
      await putLink(`lnk_ehm_${P(mo).moId}`, "equipment_has_maintenance_order", oid("Equipment", P(mo).equipId), oid("MaintenanceOrder", P(mo).moId));
    }
    // D05：Material → MaterialBalance（按**物料名**归属 —— MaterialBalance 只有 `material` 中文名，没有 matId）
    // 诚实缺席：名字在 Material 目录里对不上的（S 规模下"包材"没有对应 Material）**不建边**，
    // 不按序轮转硬凑 —— 「张冠李戴的数比没有更危险」（`order_of_customer` 那次已独立登记过同一事实）。
    {
      const matIdByName = new Map(ext.materials.map((m) => [String(P(m).name), String(P(m).matId)]));
      for (const mb of g.materialBalances) {
        const matId = matIdByName.get(String(P(mb).material));
        if (!matId) continue;
        await putLink(`lnk_mhbal_${P(mb).matBalId}`, "material_has_balance", oid("Material", matId), oid("MaterialBalance", P(mb).matBalId));
      }
    }
    // D11：Customer → OverdueRecord（od.customerRef 是 custName ⇒ 经 custByName 换 custId）
    // ⚠ 为什么不用 `od.invoiceRef` 直连 ARInvoice（那才是更自然的父）：实测
    //    `overdueRecords[].invoiceRef` 形如 `INV-CG-001`，而真 ARInvoice 的 pk 是 `arinvoice_<i>_<j>`
    //    —— **对不上任何一张真发票**。照名字猜着连就是造一条悬空边。改走客户这一层（真对得上）。
    for (const od of ext.overdueRecords) {
      const cid = custByName.get(String(P(od).customerRef));
      if (!cid) continue;
      await putLink(`lnk_cho_${P(od).overdueId}`, "customer_has_overdue_record", oid("Customer", cid), oid("OverdueRecord", P(od).overdueId));
    }

    // 跨域内置切片 + 每类型全字段覆盖切片（字段覆盖铁律）：合成即落库（resolve 不依赖外部配置脚本）。
    for (const s of [...batteryBuiltinSlices(), ...batteryCoverageSlices()]) {
      await this.repos.sliceSpecs.put({
        id: `slice_${s.sliceKey}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
        tenantId: ctx.tenantId,
        sliceKey: s.sliceKey,
        version: s.version,
        spec: s.spec,
      });
    }
    // WO-MODELING-INTERACTIVE（provenance 回填·KILL-MOCK）：A 路每个"由某合成数据集物化"的对象类型，
    // 若 sourceBindings 为空（batteryObjectTypes 未被 BINDINGS 覆盖者 + 全部 extendedObjectTypes 出厂即空），
    // 补上它真实物化来源的 RawDataset（putAll 落的 ds.name/连接）——使已发布本体不再"无来源"、左栏数据集
    // 不再"未建模"（DataSourcePanel 覆盖度按 sourceBindings.dataset 匹配）。BINDINGS 已带更细字段映射者不覆盖；
    // 纯派生/未物化类型不在 materializedBindings 内 → 诚实留空（不臆造数据集名）。chainMode 由建模链自设 provenance，跳过。
    if (!chainMode) {
      for (const [typeKey, b] of materializedBindings) {
        const ty = await this.ontology.getType(ctx, typeKey);
        if (ty && (ty.sourceBindings?.length ?? 0) === 0) {
          await this.ontology.setSourceBindings(ctx, typeKey, [b]);
        }
      }
    }
    // 轨L 增量2：chainMode → 全 34 rawDataset 经真建模链产本体类型+对象（provenance 因果真实）。
    // 放在末尾：此前无 repo 对象/类型读依赖（putLink 不读、computeRollup 用内存临时对象、sliceSpecs 不读），
    // 链 materialize 后 runJob 后续步骤（seedViewConfigs 等）即见全 34 类型+对象，与 A 路无差。
    if (chainMode) {
      n = await this.seedDemoOntologyViaChain(ctx, rawDsIds);
    }
    return n;
  }

  /**
   * WO-69 P3 · 种下内置对象接口（`Approvable`）并把实现者类型的 `implements`/`actions` 贴上。
   *
   * 幂等（R6）：接口按 key 查重，已存在同版本内容则不新开版本；类型绑定为等值覆盖。
   * 不在 `BATTERY_TYPE_INTERFACE_BINDINGS` 内的类型**一个字段都不动**（零回归）。
   */
  private async seedObjectInterfaces(ctx: AuthCtx): Promise<void> {
    if (!this.interfaces) return;
    for (const spec of BATTERY_OBJECT_INTERFACES) {
      const existing = await this.interfaces.get(ctx, spec.key);
      if (!existing) {
        await this.interfaces.upsert(ctx, spec);
        await this.interfaces.publish(ctx, spec.key);
      } else if (existing.status === "DRAFT") {
        await this.interfaces.publish(ctx, spec.key, existing.version);
      }
    }
    for (const [typeKey, binding] of Object.entries(BATTERY_TYPE_INTERFACE_BINDINGS)) {
      await this.ontology.setInterfaceBindings(ctx, typeKey, binding);
    }
  }

  /**
   * 轨L 增量2：demo 本体经真建模链产出（根因方案，非盖戳捷径）。
   *  derive(全34 rawDataset → 带噪初稿+真 FK 候选) → 确定性策展 PATCH（以 batteryObjectTypes/
   *  extendedObjectTypes 为半自动建模"人工修正真值"，覆写 suggestion 的 displayName/domain/属性/
   *  派生属性；清 linkTypes 不污染 A 路策展链路）→ publishDraft（真 CREATE 类型 + publish 真算
   *  sourceBindings/sourceDataset from 真 rawDataset → R13 provenance 因果真实）→ materialize（统一
   *  id obj_${type}_${pk} + §1.2 CJK regex → 字节同基线）。R6：全程确定性 derive，无 LLM/时钟/随机。
   *  幂等：fresh repo → 全 CREATE；rerun（类型已存在）→ MAP_TO_EXISTING（不崩；materialize 自清重物化）。
   */
  private async seedDemoOntologyViaChain(ctx: AuthCtx, rawDsIds: string[]): Promise<number> {
    if (!this.modeling) throw new Error("modeling chain not wired (synthetic.wire({modeling}))");
    const existingKeys = new Set((await this.ontology.listTypes(ctx)).map((t) => t.key));
    const draft = await this.modeling.derive(ctx, rawDsIds);
    // 确定性策展 PATCH：覆写 derive 的带噪初稿为策展真值（KEY/属性集 derive 已基本对，仅修 FK 过判/枚举/名/域/派生）。
    draft.suggestion.objectTypes = this.buildCuratedSuggestionObjectTypes(existingKeys);
    draft.suggestion.linkTypes = []; // 链路类型由 batteryLinkTypes（A 路）种，链不再产，避免 FK 自动命名链路污染。
    await this.repos.ontologyDrafts.put(draft);
    await this.modeling.publishDraft(ctx, draft.id);
    const mat = await this.modeling.materialize(ctx, draft.id);
    return mat.created;
  }

  /**
   * 把策展类型定义（batteryObjectTypes+extendedObjectTypes，半自动建模"人工修正真值"）映射成
   * ModelingSuggestion.objectTypes。sourceDataset=typeKey（rawDataset.name=typeKey）、sourceField=propKey
   * （raw 列名=propKey）。已存在类型走 MAP_TO_EXISTING（rerun 幂等），否则 CREATE。
   */
  private buildCuratedSuggestionObjectTypes(existingKeys: Set<string>): ModelingSuggestion["objectTypes"] {
    const defs = [...batteryObjectTypes(), ...extendedObjectTypes()];
    return defs.map((def) => {
      const exists = existingKeys.has(def.key);
      return {
        action: (exists ? "MAP_TO_EXISTING" : "CREATE") as "CREATE" | "MAP_TO_EXISTING",
        existingTypeKey: exists ? def.key : null,
        typeKey: def.key,
        displayName: def.displayName,
        domain: def.domain ?? "unassigned",
        // 源系统路由（mock→real）后 RawDataset 名 = BINDINGS 源系统表名（mes_base_master/erp_sales_orders…），
        // 非类型键；materialize 与 publishDraft 均按 rawDataset.name 匹配 sourceDataset，故取真实表名，
        // 否则有 BINDINGS 的类型（Base/Order/Workshop/Line/Process/Equipment/Model…）在链路下匹配不到源表 → 零物化。
        sourceDataset: BINDINGS[def.key]?.[0]?.dataset ?? def.key,
        properties: def.properties.map((p) => ({
          propKey: p.propKey,
          sourceField: p.propKey,
          dataType: p.dataType,
          isPrimaryKey: p.isPrimaryKey ?? false,
          refToTypeKey: p.refToTypeKey ?? null,
        })),
        derivedProperties: (def.derivedProperties ?? []).map((d) => ({ propKey: d.propKey, formula: d.formula })),
        confidence: 1,
      };
    });
  }

  // -- generic instantiation from (LLM-generated) templates ----------------------

  private async instantiateGeneric(
    ctx: AuthCtx,
    template: IndustryTemplate,
    seed: number,
    scale: "S" | "M" | "L" | "XL",
    origin: { type: "SYNTHETIC"; jobId: string },
  ): Promise<number> {
    const typeDefs = (template.ontology.objectTypes ?? []) as TemplateTypeDef[];
    for (const td of Array.isArray(typeDefs) ? typeDefs : []) {
      const existing = await this.ontology.getType(ctx, td.key);
      if (!existing) {
        await this.ontology.upsertType(ctx, {
          key: td.key,
          displayName: td.displayName ?? td.key,
          properties: (td.properties ?? []).map((p) => ({
            propKey: p.propKey,
            dataType: (p.dataType ?? "string") as "string" | "number" | "boolean" | "date" | "enum" | "ref" | "json",
            isPrimaryKey: p.isPrimaryKey ?? false,
            refToTypeKey: p.refToTypeKey ?? null,
          })),
          derivedProperties: td.derivedProperties ?? [],
          sourceBindings: [],
        });
      }
    }
    if ((await this.ontology.currentVersion(ctx.tenantId)) === 0) {
      await this.ontology.publishVersion(ctx);
    }
    const rng = mulberry32(seed ^ hashString(template.industryKey));
    const generatedPks = new Map<string, string[]>();
    let n = 0;
    // Generation array order = topo order (master data before transactions).
    for (const gen of template.generation) {
      const td = (Array.isArray(typeDefs) ? typeDefs : []).find((t) => t.key === gen.typeKey);
      const pkProp = td?.properties?.find((p) => p.isPrimaryKey)?.propKey ?? "id";
      const count = gen.count[scale] ?? gen.count.L; // XL 缺省回落 L（通用模板未声明 XL 时）
      const pks: string[] = [];
      // A6：先把整批行生成出来（rng 序列与旧版一致），再在固定索引植入越线/近边界（opt-in），最后物化。
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < count; i++) {
        const props: Record<string, unknown> = {};
        for (const [propKey, spec] of Object.entries(gen.propGenerators)) {
          props[propKey] = this.genValue(spec as GenSpec, rng, i, generatedPks, propKey);
        }
        if (props[pkProp] == null) props[pkProp] = `${gen.typeKey.toLowerCase()}-${i + 1}`;
        rows.push(props);
      }
      // A6 越线植入（opt-in，护 R6 向后兼容）：显式 plants ⊕ autoPlant 从 BLOCK 规则反推（无声明则不植）。
      const plants: PlantSpec[] = [...(gen.plants ?? [])];
      if (gen.autoPlant) {
        for (const r of template.rules ?? []) {
          if (String(r.severity).toUpperCase() !== "BLOCK") continue;
          const p = derivePlantFromRule({ key: r.key, expression: r.expression }, gen.typeKey);
          if (p) plants.push(p);
        }
      }
      for (const plant of plants) if (plant.typeKey === gen.typeKey) applyPlantCrossings(rows, plant);
      for (const props of rows) {
        const pkValue = String(props[pkProp]);
        pks.push(pkValue);
        await this.repos.objects.put({
          id: `obj_${gen.typeKey.toLowerCase()}_${pkValue}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
          tenantId: ctx.tenantId,
          type: gen.typeKey,
          props,
          origin,
        });
        n++;
      }
      generatedPks.set(gen.typeKey, pks);
    }
    return n;
  }

  private genValue(spec: GenSpec, rng: () => number, seq: number, pks: Map<string, string[]>, propKey = ""): unknown {
    switch (spec.kind) {
      case "enum":
        return spec.values[Math.floor(rng() * spec.values.length)];
      case "number":
        return round(spec.min + rng() * (spec.max - spec.min), spec.precision ?? 2);
      case "valueDomain":
        return sampleValueDomain(spec, propKey, rng); // A6 拟真值域分布采样（确定性）
      case "pattern":
        return spec.pattern.replace(/\{seq(?::(\d+))?\}/g, (_, width?: string) =>
          String(seq + 1).padStart(width ? Number(width) : 1, "0"),
        );
      case "fkSample": {
        const candidates = pks.get(spec.refTypeKey) ?? [];
        if (candidates.length === 0) return null;
        return candidates[Math.floor(rng() * candidates.length)];
      }
      case "date": {
        const from = Date.parse(spec.from);
        const to = Date.parse(spec.to);
        const t = from + Math.floor(rng() * Math.max(1, to - from));
        return new Date(t).toISOString().slice(0, 10);
      }
    }
  }

  // -- demo accounts / views / policies ------------------------------------------

  private async seedDemoAccounts(ctx: AuthCtx): Promise<string[]> {
    const wanted: { username: string; roles: string[]; attributes: Record<string, unknown> }[] = [
      // admin 演示账号持有全部管理角色，保证所有管理台可见（部署批次约定；tenant_admin 为管理平台增量 §2）
      { username: "admin", roles: ["admin", "planner", "catalog_admin", "tenant_admin"], attributes: {} },
      { username: "planner", roles: ["planner"], attributes: {} },
      {
        username: "base_manager",
        roles: ["base_manager:常州"],
        attributes: { baseScope: ["changzhou"], baseName: "常州" },
      },
    ];
    const names: string[] = [];
    for (const w of wanted) {
      names.push(w.username);
      const existing = (
        await this.repos.users.list(ctx.tenantId, (u) => u.username === w.username)
      )[0];
      if (existing) continue; // keep stable (argon2 salts differ per hash)
      const user: User = {
        id: `usr_${ctx.tenantId}_${w.username}`,
        tenantId: ctx.tenantId,
        username: w.username,
        passwordHash: await AuthService.hashPassword("demo1234"),
        roles: w.roles,
        attributes: w.attributes,
      };
      await this.repos.users.put(user);
    }
    return names;
  }

  private async seedViewConfigs(
    ctx: AuthCtx,
    views: string[],
    extraViews: string[] = [],
    opts?: { livedIn?: boolean },
  ): Promise<void> {
    // 前端 PRD §7：每个视图声明 renderer（前端按注册表分发）+ 声明式 layout（dashboard widget / ledger 列）。
    const DASH_LAYOUT: Record<string, unknown> = {
      widgets: [
        {
          key: "gwh", type: "kpi", title: "总产能 (GWh)", unit: "GWh", featureKey: "view.dash.widget.capacity",
          query: { kind: "objects-aggregate", objectType: "Base", agg: "sum", prop: "gwh" },
          provenance: { toolName: "query_objects", outputPath: "$.sum(gwh)", label: "全部基地铭牌产能合计" },
        },
        {
          key: "util", type: "kpi", title: "平均利用率", unit: "%",
          query: { kind: "objects-aggregate", objectType: "Base", agg: "avg", prop: "util" },
          provenance: { toolName: "query_objects", outputPath: "$.avg(util)", label: "12 基地利用率算术平均" },
        },
        {
          key: "attain", type: "kpi", title: "计划达成率", unit: "%",
          query: { kind: "objects-aggregate", objectType: "Line", agg: "avg", prop: "schedule_attainment" },
          provenance: { toolName: "query_timeseries_agg", outputPath: "$.avg(schedule_attainment)", label: "attainment:line 周聚合回写值" },
        },
        {
          key: "orders", type: "kpi", title: "在手订单",
          // livedIn：已交付订单也在 Order 表（生命周期完整），在手口径过滤 status=OPEN
          query: { kind: "objects-aggregate", objectType: "Order", agg: "count", ...(opts?.livedIn ? { filter: { status: "OPEN" } } : {}) },
          provenance: { toolName: "query_objects", outputPath: "$.count", label: "Order 行计数" },
        },
        // cockpit P1 富 KPI（数字经合成 DemandSegment/FinancePlan/MaterialBalance + 派生/聚合算出，前端零写死 R14；R13 溯源）。
        {
          key: "demand-p50", type: "kpi", title: "需求 P50 (万套/年)", unit: "万套/年", featureKey: "view.dash.widget.demand",
          query: { kind: "objects-aggregate", objectType: "DemandSegment", agg: "sum", prop: "demandWanPerYearP50" },
          provenance: { toolName: "query_objects", outputPath: "$.sum(demandWanPerYearP50)", label: "三细分需求 P50 合计（万套/年）" },
        },
        {
          key: "gross-margin", type: "kpi", title: "毛利总额 (亿)", unit: "亿", featureKey: "view.dash.widget.demand",
          query: { kind: "objects-aggregate", objectType: "DemandSegment", agg: "sum", prop: "marginWan" },
          provenance: { toolName: "query_objects", outputPath: "$.sum(marginWan)", label: "Σ(需求×单价×毛利率) 派生回写" },
        },
        {
          key: "material-gap", type: "kpi", title: "物料现货缺口 (吨)", unit: "吨", featureKey: "view.dash.widget.material",
          query: { kind: "objects-aggregate", objectType: "MaterialBalance", agg: "sum", prop: "gapTon" },
          provenance: { toolName: "query_objects", outputPath: "$.sum(gapTon)", label: "净需求×(1−长协覆盖) 缺口合计" },
        },
        // DS.2 富 KPI 补全（PRD §2 缺口表 8 富 KPI）：cockpit_kpi 一 solver 出 5 标量，各 valuePath 取（R13 溯源对象）。
        {
          key: "supply-v7", type: "kpi", title: "可供给 (万·终版)", unit: "万",
          query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "supplyV7" },
          provenance: { toolName: "invoke_solver", outputPath: "$.supplyV7", label: "最终版 SopVersionRow.supply（S&OP 定稿可供给）" },
        },
        {
          key: "rev-attain", type: "kpi", title: "收入达成率", unit: "%",
          query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "revAttainPct" },
          provenance: { toolName: "invoke_solver", outputPath: "$.revAttainPct", label: "FinancePlan 收入行 rolling÷budget×100" },
        },
        {
          key: "util-peak", type: "kpi", title: "利用率瓶颈 (峰)", unit: "%",
          query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "utilPeak" },
          provenance: { toolName: "invoke_solver", outputPath: "$.utilPeak", label: "max(Base.util)：最高负荷基地（瓶颈风险）" },
        },
        {
          key: "aop-base", type: "kpi", title: "AOP 基准营收 (亿)", unit: "亿",
          query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "aopBaseRev" },
          provenance: { toolName: "invoke_solver", outputPath: "$.aopBaseRev", label: "baseline 年度情景 revenue（AOP 基准）" },
        },
        {
          key: "cash-cushion", type: "kpi", title: "现金垫 C18 (亿)", unit: "亿",
          query: { kind: "solver", solverKey: "cockpit_kpi", args: {}, valuePath: "cashCushion" },
          provenance: { toolName: "invoke_solver", outputPath: "$.cashCushion", label: "baseline 年度情景 cashCushion（C18 现金安全垫）" },
        },
        // SPINE.4 经营指标条（视图绑定迁移：驾驶舱 KPI 读 Metric 单一出处 R-一致）。metric_rollup 对齐目标树
        // 算 target/actual/delta/miss，前端零写死（R14）；越线红标，与各视图同一 Metric（一处事实一处出处）。
        {
          key: "metric-strip", type: "metric-strip", title: "经营指标（目标 vs 实际 · 单一出处）", span: 2, featureKey: "view.dash.widget.metric",
          query: { kind: "solver", solverKey: "metric_rollup", args: { level: "op" }, valuePath: "metrics" },
          provenance: { toolName: "invoke_solver", outputPath: "$.metrics", label: "metric_rollup：Metric 对齐目标树算 delta/miss（各视图 KPI 单一出处）" },
        },
        // cockpit P2 规划决策推演 · 根因 DAG（KPI 越线 → 因子 → 取证叶，结构与贡献均经 plan_rootcause 求解器
        // 从 PlanKpi/RootCauseChain/活数据算出，前端零写死 R14；R13 求解器溯源）。
        {
          key: "rootcause", type: "dag", title: "规划决策推演 · 未达成指标根因下钻", span: 2, featureKey: "view.dash.widget.rootcause",
          query: { kind: "solver", solverKey: "plan_rootcause", args: {}, valuePath: "dag" },
          provenance: { toolName: "invoke_solver", outputPath: "$.dag", label: "plan_rootcause：经营 KPI 越线沿归因模板逐层取证（贡献=活数据聚合）" },
        },
        // PRD-cockpit §2.1 订单经营台账（逐单根因 DAG + 状态筛选 + 综合毛利率聚合）：affected_orders rows/problems 同源。
        {
          key: "order-ledger", type: "order-ledger", title: "订单经营台账 · 逐单根因下钻", span: 2,
          query: { kind: "solver", solverKey: "affected_orders", args: {} },
          provenance: { toolName: "invoke_solver", outputPath: "$.rows", label: "affected_orders：受影响订单逐单 + problems 归并 + 综合毛利率（SEG 单价×毛利率派生）" },
        },
        // PRD-cockpit §2.1 规划决策推演（月/季/年 KPI 条 + 根因链 DAG + 一键去建议/体检）：metric_rollup 按 level + plan_rootcause 根因。
        {
          key: "plan-drill", type: "plan-drill", title: "规划决策推演 · 未达成指标根因下钻", span: 2,
          query: { kind: "solver", solverKey: "plan_rootcause", args: {}, valuePath: "kpis" },
          provenance: { toolName: "invoke_solver", outputPath: "$.kpis", label: "plan_rootcause 按 level（月/季/年）越线指标 + 根因 DAG；一键去建议/体检" },
        },
        // cockpit P5：S&OP 版本切换（V1/V3/V5/V7，SopVersionRow；选版本看供给/缺口/备注，R14 零写死）。
        {
          key: "version-toggle", type: "version-toggle", title: "S&OP 版本切换（V5/V7）", span: 1, featureKey: "view.dash.widget.version",
          query: { kind: "objects", objectType: "SopVersionRow", limit: 20 },
          provenance: { toolName: "query_objects", outputPath: "$.items", label: "SopVersionRow 版本演进（gap=demand−supply 派生）" },
        },
        // cockpit P5：反事实双轨推演（"如不解决 XX 未来 N 天"，counterfactual_timeline → baseline ‖ mitigated 双曲线 + 差值）。
        {
          key: "counterfactual", type: "counterfactual", title: "反事实双轨推演（如不解决会怎样）", span: 2, featureKey: "view.dash.widget.counterfactual",
          query: { kind: "solver", solverKey: "counterfactual_timeline", args: { horizon: 30 } },
          provenance: { toolName: "invoke_solver", outputPath: "$", label: "counterfactual_timeline：do-nothing vs 处置后双曲线 + 峰值削减/越线日推迟" },
        },
        {
          key: "oee-trend", type: "chart", title: "OEE 14 日趋势", span: 2, chartKind: "line",
          query: { kind: "timeseries", seriesKey: "oee:equip", entityIds: [], grain: "day", agg: "avg", days: 14 },
          provenance: { toolName: "query_timeseries_agg", outputPath: "$.points", label: "oee:equip 日粒度均值" },
        },
        {
          key: "orders-table", type: "table", title: "在手订单（前 8）", span: 2,
          query: { kind: "objects", objectType: "Order", columns: ["so", "cust", "model", "qty", "due", "status"], limit: 8, ...(opts?.livedIn ? { filter: { status: "OPEN" } } : {}) },
          provenance: { toolName: "query_objects", outputPath: "$.items", label: "订单对象查询" },
        },
        // 运营态增量 §4.1：12 个月产出趋势（检修月下凹）/ 准交率 / 年度已执行工单 / 已交付台账。
        // 数据源 = GET /a/v1/history/bundle（kind=history 声明式 widget，仅 livedIn 时注入）。
        ...(opts?.livedIn
          ? [
              {
                key: "trend-12m", type: "chart", title: "12 个月产出趋势（万套）", span: 2, chartKind: "bar",
                query: { kind: "history", field: "trend" },
                provenance: { toolName: "query_timeseries_agg", outputPath: "$.trend", label: "output:line 月度聚合（检修月下凹可见）" },
              },
              {
                key: "ontime-rate", type: "kpi", title: "已交付准交率", unit: "%",
                query: { kind: "history", field: "onTimeRate" },
                provenance: { toolName: "query_objects", outputPath: "$.onTimeRate", label: "近 12 个月已交付订单按期率（51/60）" },
              },
              {
                key: "executed-workorders", type: "kpi", title: "年度已执行工单",
                query: { kind: "history", field: "executedCount" },
                provenance: { toolName: "query_objects", outputPath: "$.actionStats.executed", label: "Action 审计史 EXECUTED 计数" },
              },
              {
                key: "delivered-ledger", type: "table", title: "已交付订单台账", span: 2,
                query: { kind: "history", field: "delivered", columns: ["so", "cust", "model", "qty", "due", "deliveredAt", "delayDays"] },
                provenance: { toolName: "query_objects", outputPath: "$.delivered", label: "已交付订单（生命周期完整）" },
              },
            ]
          : []),
      ],
    };
    const LEDGER_LAYOUT: Record<string, unknown> = {
      objectType: "Order",
      columns: [
        { key: "so", label: "SO" },
        { key: "cust", label: "客户", filterable: true },
        { key: "model", label: "型号", filterable: true },
        { key: "qty", label: "数量" },
        { key: "due", label: "交期" },
        { key: "bases", label: "基地", filterable: true },
        { key: "status", label: "状态", filterable: true },
      ],
    };
    // G-GRAPH-DESC-CONTRACT-SPLIT（已闭）：描述卡曾经写进第 3 形参 `layout`，字段名 `description`/`descriptionLink`，
    // 而前端 OntologyGraphView 从 `options` 读 `desc`/`descLink` ⇒ 生产态八视角描述卡一张都不渲染（MSW mock 恰好
    // 走对的形状，把生产的错位盖成全绿 —— 铁律 0.5 判据 #6）。裁定见 contracts `GraphViewDescSchema` 注释：
    // 容器归 `options`（与同特性的 `graphOptions` 同源；`layout` 是 DF.6 拉取靶的机器消费位）。
    // 第 3 形参**受契约类型约束**，再写错字段名即 tsc 报错，不再靠人眼发现。
    const graphView = (title: string, graphOptions: Record<string, unknown>, desc: GraphViewDesc = {}) => ({
      title,
      renderer: "ontology-graph",
      layout: {},
      options: { graphOptions, ...desc },
    });
    // 去电池锁死 8a（R14）：把推演视图的结构（字段组/目标字段/DAG 驱动因子/问题分类）真下发到 ViewConfig.layout，
    // 使前端不再走写死兜底而是后端配置驱动（换租户/行业改这里即可，界面跟着变）。
    const PLAN_AUDIT_FIELD_GROUPS = [
      { title: "需求侧（万套）", fields: [
        { key: "dem", label: "月度需求总量", unit: "万套", step: 0.1 },
        { key: "seg_pas", label: "乘用车", unit: "万套", step: 0.1 },
        { key: "seg_ess", label: "储能", unit: "万套", step: 0.1 },
        { key: "seg_com", label: "商用车", unit: "万套", step: 0.1 },
      ] },
      { title: "供给侧", fields: [
        { key: "sup", label: "月度可供给", unit: "万套", step: 0.1 },
        { key: "ltaCov", label: "长协覆盖率", unit: "%", step: 1 },
        { key: "kitGap", label: "正极物料缺口", unit: "吨", step: 10 },
      ] },
      { title: "财务侧", fields: [
        { key: "gmTarget", label: "毛利率目标", unit: "%", step: 0.5 },
        { key: "cashCushion", label: "现金安全垫(13周最低点)", unit: "亿", step: 0.5 },
        { key: "capex", label: "CAPEX 本月", unit: "亿", step: 0.5 },
      ] },
    ];
    const PLAN_GENERATE_GOAL_FIELDS = [
      { key: "revGrowthPct", label: "收入增长", unit: "%", step: 1 },
      { key: "gmFloorPct", label: "毛利底线", unit: "%", step: 0.1, hardKey: "hardGm" },
      { key: "sharePts", label: "份额增", unit: "pct", step: 1 },
      { key: "capexCap", label: "CAPEX 上限", unit: "亿", step: 1, hardKey: "hardCapex" },
      { key: "cashFloor", label: "现金底线", unit: "亿", step: 1, hardKey: "hardCash" },
      // PRD-IND-plan-generate §4.1/§8.4：库存周转目标（求解器 turnsFloor/meetTurns 已支持，补面板暴露）。
      { key: "invTurns", label: "库存周转", unit: "次", step: 0.5 },
    ];
    const PROJECT_SIM_DRIVER_FACTORS = [
      { id: "f1", label: "节拍 × OEE × 良率", sub: "IoT/MES/QMS 驱动因子" },
      { id: "f2", label: "爬坡曲线 + 检修窗", sub: "前4周 0.88→1.0 · 各基地检修周" },
      { id: "f3", label: "认证系数 + 数据健康度", sub: "PLM 认证 · P90 系数" },
    ];
    const ORDER_CHAIN_LABELS = { DELIVERY: "交期", MARGIN: "毛利", KIT: "齐套", CREDIT: "信用" };
    const SEG_COLORS = { 乘用车: "#5E8FE8", 商用车: "#DD9551", 储能: "#36BFA5" };
    // 核心内置视图 layout（DF.6 拉取靶：每 solver-backed 视图声明"要拉取的求解器输出字段"——喂 ModuleProvisioner/SHAPE
    // 闭包：拉取靶 ⊄ 求解器输出形状 → 缺该输出字段 → TO_CREATE·G-8/R12 输出侧）。dash 依赖运行时 opts.livedIn，故各核心
    // 视图 layout 留本地此 map；**成员集 + title + renderer 单一来源 = BUILTIN_VIEWS**（防 scenarioSeed/VIEW_DEFS 漂移·
    // WO-MEMORY-VIEW-RESILIENCE §4.2）。
    const CORE_VIEW_LAYOUTS: Record<string, Record<string, unknown>> = {
      dash: DASH_LAYOUT,
      graph: {},
      risk: { solverKey: "risk_timeline", horizon: 14, outputFields: ["cards", "planRows", "horizon", "threshold"] },
      order: LEDGER_LAYOUT,
      "plan-audit": { solverKey: "plan_audit", fieldGroups: PLAN_AUDIT_FIELD_GROUPS, outputFields: ["H", "M", "S", "score", "verdict"] },
      "plan-generate": { solverKey: "plan_generate", goalFields: PLAN_GENERATE_GOAL_FIELDS, outputFields: ["schemes", "recommend"] },
      "project-sim": { solverKey: "capacity_forecast", driverFactors: PROJECT_SIM_DRIVER_FACTORS, outputFields: ["capWanP50", "capWanP90", "gap", "perBaseRows", "mainBn"] },
      "global-sim": { solverKey: "portfolio" },
      "sop-balance": { apiTag: "sop" },
    };
    const VIEW_DEFS: Record<string, { title: string; renderer: string; layout?: Record<string, unknown>; options?: Record<string, unknown> }> = {
      // 核心内置视图：成员集/title/renderer 从 BUILTIN_VIEWS 派生（单一来源·防漂移）；layout 取 CORE_VIEW_LAYOUTS。
      ...Object.fromEntries(
        BUILTIN_VIEWS.map(
          (bv): [string, { title: string; renderer: string; layout: Record<string, unknown>; options?: Record<string, unknown> }] => [
            bv.key,
            { title: bv.title, renderer: bv.renderer, layout: CORE_VIEW_LAYOUTS[bv.key] ?? bv.layout ?? {}, ...(bv.options ? { options: bv.options } : {}) },
          ],
        ),
      ),
      // 增量 §7.14–7.17
      "annual-scenario": {
        title: "年度规划",
        renderer: "annual-scenario",
        layout: { endpoint: "/a/v1/plan/aop", year: 2026, actionTypeKey: "AOP情景拍板", finalizeFeature: "act.aop-finalize" },
      },
      "quarterly-rolling": {
        title: "季度规划",
        renderer: "quarterly-rolling",
        layout: { endpoint: "/a/v1/plan/quarterly", n: 6, gapTiers: { red: 4, yellow: 0 }, ltaEscalatePct: 5 },
      },
      "order-chain": {
        title: "订单进展与卡因",
        renderer: "order-chain",
        layout: { solverKey: "affected_orders", window: { before: 7, after: 14 }, problemCategories: ["DELIVERY", "MARGIN", "KIT", "CREDIT"], categoryLabels: ORDER_CHAIN_LABELS, segColors: SEG_COLORS, outputFields: ["rows", "problems", "summary", "columns"] },
      },
      "geo-map": {
        title: "基地地理视图",
        renderer: "geo-map",
        layout: { objectType: "Base", sizeProp: "gwh", colorProp: "kind", utilThresholds: [92, 85, 78] },
      },
      // 运营态增量 §4.2：运营复盘（只读历史证据链页面，消费 history/bundle）
      review: { title: "运营复盘", renderer: "review", layout: { apiTag: "history" } },
      // WO-PROCESS-INSTANCE · 流程卡点面板（暗发·见 DARK_LAUNCH_EXTRA_KEYS）。
      // 走增量视图桶而**不进** BUILTIN_VIEWS，判据是**语义归属**（同 nav 门判据⑦ 的修法说明），逐条：
      //  ① 它的控制键是 `process.runtime`（引擎级），不是 `view.<key>`。BUILTIN_VIEWS 的
      //     `builtInViewFeatureDefs()` 会照 featureKey **再注册一份 defaultOn:true 的 FeatureDef** ——
      //     那会把 features.ts:112 那条 `defaultOn:false` 顶掉，**暗发当场失效**（且静默）。
      //  ② `seed:true` 会进 `SEEDED_VIEW_KEYS` → `scenarioSeed.views` → `report.views` 验收金值；
      //     它是**暗发**页，出现在出厂验收快照里等于宣称"已交付"，与暗发语义直接矛盾。
      //  ③ 它不是「净室通用页」（App.tsx 专用 route 那一类）：读的是租户自己的流程实例，
      //     且必须有页面侧 R3 守卫 —— 专用 route 给不了（手敲 URL 绕过去）。
      // layout 留空：本页不经 solver，数据直接来自 `GET /a/v1/process-instances/stuck`。
      "process-stuck": { title: "流程卡点", renderer: "process-stuck", layout: {} },
      // §7.18 图谱八视角（零新代码视角：renderer=ontology-graph + graphOptions 配置）。
      // PRD-IND-map 缺口④：每视角叙事描述（逐字录自 HTML，ViewDef 配置下发，前端 descCard 渲染，非写死）。
      "graph-all": graphView("图谱·全景", { colorBy: "domain", layoutSeed: 42 }, { desc: "全域对象与关系全景：14 业务域对象类型 + 求解器 + 智能体一张图，按域着色；可切数据来源着色、主干分级、各推演网络与学习闭环视角。" }),
      "graph-backbone": graphView("图谱·主干分级", { colorBy: "domain", nodeFilter: { tiers: [0, 1] }, dimOthers: true, layoutSeed: 42 }, { desc: "按层级看节点：一级=推演主干（产能预测←工序产能→产线产能→工厂产能→基地）；二级=按业务推演链切片（产能/产销/采购/财务现金）；三级=明细（OEE历史/停机/操作员/不良/供应商/物流）。" }),
      "graph-flow": graphView("图谱·产能推演网络", { colorBy: "domain", linkKinds: ["flow", "agg"], layoutSeed: 42 }, { desc: "产能金字塔自下而上派生：节拍×OEE→设备产能→×良率×人力→工序产能→min瓶颈→产线产能→Σ→工厂产能。工序有串行（按瓶颈 min）与并行（化成/老化多通道）之分；物流时长经物料齐套约束可投产能；最后与预测场景、需求、瓶颈汇入产能预测。" }),
      "graph-source": graphView("图谱·数据来源", { colorBy: "source", layoutSeed: 42 }, { desc: "只聚焦真正来自源系统的原始数据节点，按源系统重新着色，回答『每个数据从哪来』：ERP/SAP 物料主数据、MES 工艺与制造执行、EAM/CMMS 设备资产、IoT/SCADA 节拍OEE、QMS/LIMS 质量、HR/排班 人员工时、PLM 产品BOM、WMS 物料齐套。产能域(派生)、求解器、智能体不是源数据，已淡出。" }),
      "graph-solver": graphView("图谱·求解器", { colorBy: "domain", nodeFilter: { domains: ["solver"] }, linkKinds: ["calc"], dimOthers: true, layoutSeed: 42 }, { desc: "求解器以智能辅助决策中台形式注册，绑定到对应对象类型：聚合求解器（产能金字塔）、瓶颈求解器（工艺链最小割）、场景求解器（假设情景重算）、精度校准器（预测↔实际偏差学习）。读业务对象、写回派生对象，由管线/Agent 触发。" }),
      "graph-mvp": graphView("图谱·MVP", { colorBy: "domain", mvpOverlay: true, layoutSeed: 42 }, { desc: "实色高亮的是 MVP 必备的核心闭环：工艺路线(节拍)+设备(OEE)+良率+产能聚合/瓶颈+需求→产能预测。⊕ 虚线节点是当前缺口，需从源系统补采——其中实际产出、OEE历史、生产工单MO 是离散组装制造与自学习闭环最关键的三项，缺它们系统就『算不准、学不会』。" }),
      "graph-agent": graphView("图谱·智能体网络", { colorBy: "domain", nodeFilter: { domains: ["agent", "solver"] }, linkKinds: ["orch"], dimOthers: true, layoutSeed: 42 }, { desc: "产能预测不是『一个 Agent 跑一个模型』，而是编排Agent 指挥一支专职智能体团队：意图解析/检索/建模求解/瓶颈诊断/解释校验/学习/行动，外加经验记忆库（越用越聪明）与约束规则（安全边界）。每个 Agent 把求解器与业务建模当工具调用——AI 的价值在于可自主规划、可解释、可成长的协同。" }),
      "graph-loop": graphView(
        "图谱·学习闭环",
        { colorBy: "domain", nodeFilter: { ids: LOOP_NODE_IDS }, linkKinds: ["fb", "orch"], dimOthers: true, layoutSeed: 42 },
        // 视角描述卡链接校准报告页（真数据 MAPE 趋势；原型假动画明确不复刻）。
        // 修 G-GRAPH-DESC-CONTRACT-SPLIT 时的第三处发现：本视角原先**没有叙事正文** —— 唯一那句
        // "查看精度趋势与校准历史" 语义上是**链接文字**，却占着 `description` 位；而前端 `descLink`
        // 需要 `{to,label}` 才渲染得出可点文字，裸字符串 `descriptionLink` 连 label 都没有。
        // 故此处补齐两者：正文取仓内既有同视角文案（`frontend-shell/src/mocks/fixtures.ts` 学习闭环视角），
        // label 保留原字符串，一字未改。
        {
          desc: "预测 ↔ 实际偏差 → 精度校准器 → 参数写回 → 越用越准（真实数据 MAPE 趋势见校准报告页，不做假动画）。",
          descLink: { to: "/admin/calibration", label: "查看精度趋势与校准历史" },
        },
      ),
    };
    // fail-fast（WO-MEMORY-VIEW-RESILIENCE §4.3）：种子路径断言每个 seeded 内置视图接线完整——featureKey 已注册 +
    // VIEW_FEATURE_MAP 有一致映射 + VIEW_DEFS 有定义。任一半漂移即此处抛错（不再靠人肉发现内存态"视图重启隐身"）。
    assertViewManifestIntegrity({
      viewFeatureMap: VIEW_FEATURE_MAP,
      viewDefs: VIEW_DEFS,
      registeredFeatureKeys: new Set(ALL_FEATURE_KEYS),
    });
    const ADMIN_NAV: { key: string; label: string }[] = [
      { key: "connections", label: "数据接入" },
      { key: "rule-docs", label: "规则文档审核" },
      { key: "modeling", label: "本体建模" },
      { key: "rules", label: "规则库" },
      { key: "permissions", label: "权限策略" },
      { key: "synthetic", label: "合成数据" },
      { key: "actions", label: "Action 审批" },
      { key: "features", label: "功能开通" },
      { key: "boundary", label: "边界册治理" },
      { key: "prototype-intake", label: "原型 intake" },
      { key: "catalog", label: "意图目录" },
      { key: "agents", label: "Agent 注册表" },
      { key: "workflows", label: "Workflow" },
      { key: "skills", label: "Skill" },
      { key: "mcp", label: "MCP 服务器" },
      { key: "scenes", label: "场景入口" },
      { key: "ops/fallback", label: "兜底运营" },
      { key: "query-history", label: "推演历史" },
    ];
    // 不同账号不同前端：admin 全量（含 admin 导航组），planner 业务视图，base_manager 子集 + 不同主题强调色。
    const baseManagerExtras = extraViews.filter((v) => v === "order-chain" || v === "review");
    const roleViews: Record<string, string[]> = {
      admin: [...views, ...extraViews],
      planner: [...views, ...extraViews],
      base_manager: [
        // global-sim（全局项目推演）属规划/管理层视图·base_manager 沿用原样不纳入（此前经 extraViews 分桶天然不含·
        // 升为核心 views 后须显式排除以保行为不变·WO-MEMORY-VIEW-RESILIENCE 只让"该出现的角色"稳定出现，不扩权）。
        ...views.filter((v) => !["dash", "graph", "plan-audit", "plan-generate", "global-sim"].includes(v)),
        ...baseManagerExtras,
      ],
    };
    const themes: Record<string, Record<string, string>> = {
      admin: { "--accent": "#4C90F0" },
      planner: { "--accent": "#43B7D7" },
      base_manager: { "--accent": "#36BFA5" },
    };
    const old = await this.repos.viewConfigs.list(ctx.tenantId, (v) => v.origin === "SYNTHETIC");
    for (const v of old) await this.repos.viewConfigs.remove(ctx.tenantId, v.id);
    for (const [role, keys] of Object.entries(roleViews)) {
      const navigation: ViewConfig["navigation"] = keys.map((k) => ({
        key: k,
        label: VIEW_DEFS[k]?.title ?? k,
        viewKey: k,
        group: "business" as const,
      }));
      if (role === "admin") {
        navigation.push(...ADMIN_NAV.map((n) => ({ key: n.key, label: n.label, group: "admin" as const })));
      }
      const vc: ViewConfig = {
        id: `vc_${ctx.tenantId}_${role}`,
        tenantId: ctx.tenantId,
        role,
        scenarioPackages: ["pkg_battery_manufacturing"],
        views: keys.map((k) => ({
          key: k,
          title: VIEW_DEFS[k]?.title ?? k,
          renderer: VIEW_DEFS[k]?.renderer ?? k,
          layout: VIEW_DEFS[k]?.layout ?? {},
          ...(VIEW_DEFS[k]?.options ? { options: VIEW_DEFS[k]?.options } : {}),
        })),
        theme: themes[role] ?? { "--accent": "#4C90F0" },
        navigation,
        origin: "SYNTHETIC",
      };
      await this.repos.viewConfigs.put(vc);
    }
  }

  private async seedPolicies(ctx: AuthCtx): Promise<void> {
    const wanted: Omit<PermissionPolicy, "id" | "tenantId">[] = [
      {
        resource: { kind: "OBJECT_TYPE", key: "Base" },
        grants: [
          { role: "admin", ops: ["READ", "WRITE", "EXECUTE"] },
          { role: "planner", ops: ["READ"] },
        ],
      },
      {
        resource: { kind: "OBJECT_TYPE", key: "Base" },
        grants: [{ role: "base_manager", ops: ["READ"] }],
        rowFilter: "Object.baseId IN ${user.attributes.baseScope}",
      },
      {
        resource: { kind: "OBJECT_TYPE", key: "Order" },
        grants: [
          { role: "admin", ops: ["READ", "WRITE", "EXECUTE"] },
          { role: "planner", ops: ["READ"] },
        ],
      },
      {
        resource: { kind: "OBJECT_TYPE", key: "Order" },
        grants: [{ role: "base_manager", ops: ["READ"] }],
        rowFilter: "Object.bases IN ${user.attributes.baseScope}",
      },
      {
        resource: { kind: "OBJECT_TYPE", key: "Model" },
        grants: [
          { role: "admin", ops: ["READ", "WRITE", "EXECUTE"] },
          { role: "planner", ops: ["READ"] },
          { role: "base_manager", ops: ["READ"] },
        ],
      },
      // A8: ts entity row policy inherits the object-type policy (Line scoped per base for base_manager).
      {
        resource: { kind: "OBJECT_TYPE", key: "Line" },
        grants: [
          { role: "admin", ops: ["READ", "WRITE", "EXECUTE"] },
          { role: "planner", ops: ["READ"] },
        ],
      },
      {
        resource: { kind: "OBJECT_TYPE", key: "Line" },
        grants: [{ role: "base_manager", ops: ["READ"] }],
        rowFilter: "Object.baseId IN ${user.attributes.baseScope}",
      },
      // ── A6 列级（属性级）安全 · demo 受限角色样例 ────────────────────────────────
      // Material 此前无任何策略（= default allow）。列级演示必须显式建策略，故这里成对下种：
      // ① 宽策略保住既有角色的现状（不因“新增策略”把 default-allow 翻成 deny）；
      // ② 受限策略只授给**新角色** line_operator（产线操作员）——只有它拿列级约束。
      // 两条并存下 line_operator 只匹配 ②（不匹配 ① 的任何 grant），故并集语义不会把限制“解除”。
      {
        resource: { kind: "OBJECT_TYPE", key: "Material" },
        grants: [
          { role: "admin", ops: ["READ", "WRITE", "EXECUTE"] },
          { role: "planner", ops: ["READ", "WRITE", "EXECUTE"] },
          { role: "base_manager", ops: ["READ", "WRITE", "EXECUTE"] },
          { role: "catalog_admin", ops: ["READ", "WRITE", "EXECUTE"] },
        ],
      },
      {
        resource: { kind: "OBJECT_TYPE", key: "Material" },
        grants: [{ role: "line_operator", ops: ["READ", "WRITE"] }],
        // 产线操作员看得到料号/库存/交期，但看不到也改不了采购单价（成本属敏感列）。
        propertyPolicy: { denyRead: ["unitPrice"], denyWrite: ["unitPrice"] },
      },
    ];
    for (let i = 0; i < wanted.length; i++) {
      const w = wanted[i] as Omit<PermissionPolicy, "id" | "tenantId">;
      const id = `pol_${ctx.tenantId}_${w.resource.kind}_${w.resource.key}_${i}`.toLowerCase();
      await this.repos.policies.put({ id, tenantId: ctx.tenantId, ...w });
    }
  }

  // -- validation report -----------------------------------------------------------

  private async buildReport(
    ctx: AuthCtx,
    template: IndustryTemplate,
    views: string[],
    accounts: string[],
    seed: number,
  ): Promise<SyntheticReport> {
    const types = await this.ontology.listTypes(ctx);
    const rowCounts: Record<string, number> = {};
    const byType = new Map<string, ObjectInstance[]>();
    for (const t of types) {
      const objs = (await this.repos.objects.listByType(ctx.tenantId, t.key)).sort((a, b) =>
        a.id < b.id ? -1 : 1,
      );
      byType.set(t.key, objs);
      rowCounts[t.key] = objs.length;
    }

    const fkChecks: SyntheticReport["fkChecks"] = [];
    const models = byType.get("Model") ?? [];
    const orders = byType.get("Order") ?? [];
    const bases = byType.get("Base") ?? [];
    if (orders.length > 0 && models.length > 0) {
      const modelIds = new Set(models.map((m) => m.props.modelId));
      fkChecks.push({
        check: "Order.model ∈ Model",
        passed: orders.every((o) => modelIds.has(o.props.model)),
        sampled: orders.length,
      });
      const modelBases = new Map(models.map((m) => [m.props.modelId, new Set((m.props.bases as string[]) ?? [])]));
      fkChecks.push({
        check: "Order.bases ⊆ Model.bases",
        passed: orders.every((o) =>
          ((o.props.bases as string[]) ?? []).every((b) => modelBases.get(o.props.model)?.has(b)),
        ),
        sampled: orders.length,
      });
    }
    if (models.length > 0 && bases.length > 0) {
      const baseIds = new Set(bases.map((b) => b.props.baseId));
      fkChecks.push({
        check: "Model.bases ⊆ Base",
        passed: models.every((m) => ((m.props.bases as string[]) ?? []).every((b) => baseIds.has(b))),
        sampled: models.length,
      });
    }

    const ruleScan: SyntheticReport["ruleScan"] = [];
    for (const r of template.rules) {
      let violations = 0;
      for (const o of orders) {
        try {
          // WO-RULE-EXPR-PARAMS：合成越线统计也用规则自己的命名阈值（否则 C08 这类
          // 阈值已迁进 params 的规则会在这里恒 0 违规 = 哑弹，而报告看起来一切正常）。
          if (evaluateExpression(r.expression, { payload: { Order: o.props, ...o.props }, params: r.params })) violations++;
        } catch {
          /* unevaluable against object props — counts as pass */
        }
      }
      ruleScan.push({ ruleKey: r.key, evaluated: orders.length, violations });
    }

    const derivationSpotChecks: SyntheticReport["derivationSpotChecks"] = [];
    const model0 = models[0];
    if (model0) {
      const expected = orders
        .filter((o) => o.props.model === model0.props.modelId)
        .reduce((a, o) => a + (typeof o.props.qty === "number" ? o.props.qty : 0), 0);
      derivationSpotChecks.push({
        typeKey: "Model",
        propKey: "totalDemand",
        objectId: model0.id,
        ok: model0.props.totalDemand === expected,
      });
    }
    const base0 = bases.find((b) => b.props.baseId === "changzhou") ?? bases[0];
    if (base0) {
      const expected = orders
        .filter((o) => ((o.props.bases as string[]) ?? []).includes(base0.props.baseId as string))
        .reduce((a, o) => a + (typeof o.props.qty === "number" ? o.props.qty : 0), 0);
      derivationSpotChecks.push({
        typeKey: "Base",
        propKey: "committedQty",
        objectId: base0.id,
        ok: base0.props.committedQty === expected,
      });
    }

    const timeseries = await this.buildTsReport(ctx, seed);
    return { rowCounts, fkChecks, ruleScan, derivationSpotChecks, views, accounts, ...(timeseries ? { timeseries } : {}) };
  }

  /** A8.6: ts section — point counts, gap scan, aggregation spot recomputation. */
  private async buildTsReport(ctx: AuthCtx, _seed: number): Promise<SyntheticReport["timeseries"] | undefined> {
    if (!this.ts) return undefined;
    const series = await this.repos.tsSeries.list(ctx.tenantId, (s) => s.origin === "SYNTHETIC");
    if (series.length === 0) return undefined;
    const pointCounts: Record<string, number> = {};
    const gaps: { seriesKey: string; entityId: string; missingDays: number }[] = [];
    for (const s of series.sort((a, b) => (a.seriesKey < b.seriesKey ? -1 : 1))) {
      const points = await this.repos.tsPoints.list(ctx.tenantId, s.id);
      pointCounts[s.seriesKey] = points.length;
      const sample = points[0]?.entityId;
      if (sample) {
        const days = new Set(points.filter((p) => p.entityId === sample && (p.tick ?? 0) === 0).map((p) => p.ts.slice(0, 10)));
        if (days.size < HISTORY_DAYS) gaps.push({ seriesKey: s.seriesKey, entityId: sample, missingDays: HISTORY_DAYS - days.size });
      }
    }
    // spot recompute: line_output_daily for the first Line entity's latest day bucket.
    const aggSpotChecks: { specKey: string; entityId: string; ok: boolean }[] = [];
    const outputSeries = series.find((s) => s.seriesKey === "output:line");
    if (outputSeries) {
      const runs = await this.repos.tsAggRuns.list(ctx.tenantId, (r) => r.specKey === "line_output_daily");
      const run = runs.sort((a, b) => (a.id < b.id ? -1 : 1))[0];
      if (run) {
        const points = await this.repos.tsPoints.list(ctx.tenantId, outputSeries.id, {
          entityIds: [run.entityId],
          from: `${run.windowStart}T00:00:00.000Z`,
          to: new Date(Date.parse(`${run.windowEnd}T00:00:00Z`) + DAY_MS).toISOString(),
        });
        const expected = round(points.reduce((a, p) => a + (p.values.output ?? 0), 0), 6);
        aggSpotChecks.push({ specKey: "line_output_daily", entityId: run.entityId, ok: Math.abs(expected - run.value) < 1e-6 });
      }
    }
    return { pointCounts, gaps, aggSpotChecks };
  }
}

export function entityRefFieldOf(entityType: string): string {
  switch (entityType) {
    case "Equipment":
      return "equipId";
    case "Process":
      return "processId";
    case "Line":
      return "lineId";
    case "Model":
      return "modelId";
    case "Base":
      return "baseId";
    default:
      return "id";
  }
}
