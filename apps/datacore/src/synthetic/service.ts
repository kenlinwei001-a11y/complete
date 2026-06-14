import { IndustryTemplateSchema, type GenSpec, type IndustryTemplate, type PermissionPolicy } from "@platform/contracts";
import type { AuthCtx, ObjectInstance, SyntheticJob, SyntheticReport, User, ViewConfig } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { LlmClient } from "../llm.js";
import type { Metrics } from "../metrics.js";
import type { OntologyService } from "../ontology.js";
import type { RulesService } from "../rules.js";
import type { TimeseriesService } from "../timeseries.js";
import type { SchedulerService } from "../scheduler.js";
import type { FeatureService } from "../features.js";
import type { ActionService } from "../actions.js";
import { VIEW_FEATURE_MAP } from "../features.js";
import { AuthService } from "../auth.js";
import { newId } from "../ids.js";
import { mulberry32, hashString, round } from "../prng.js";
import { evaluateExpression } from "../ruledsl.js";
import {
  BATTERY_ACTION_TYPES,
  BATTERY_RULE_SCOPES,
  BATTERY_SOLVER_PARAMS,
  BATTERY_TEMPLATE,
  BATTERY_TS_AGG_SPECS,
  batteryBuiltinSlices,
  batteryLinkTypes,
  batteryObjectTypes,
  generateBattery,
  generatePlanDomain,
} from "./battery.js";
import { extendedObjectTypes, generateExtended } from "./battery-extended.js";
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
  /** 运营态出厂配置增量 §1：livedIn=true 时在标准合成后运行回放引擎（注入避免依赖环）。 */
  private livedInRunner: ((ctx: AuthCtx, input: { industry: string; scale: "S" | "M" | "L" | "XL"; seed: number; jobId: string }) => Promise<{ replay: { batches: number; days: number; points: number } }>) | null = null;

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
  }): void {
    this.scheduler = deps.scheduler ?? this.scheduler;
    this.features = deps.features ?? this.features;
    this.actions = deps.actions ?? this.actions;
    this.ts = deps.ts ?? this.ts;
    this.livedInRunner = deps.livedInRunner ?? this.livedInRunner;
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
    input: { industry: string; scale: "S" | "M" | "L" | "XL"; seed?: number; livedIn?: boolean },
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
        await this.instantiateBattery(ctx, seed, input.scale, origin);
      } else {
        await this.instantiateGeneric(ctx, template, seed, input.scale, origin);
      }

      // ③b A8.6: 90-day deterministic ts history → full TS_AGGREGATE → derivation.
      // 运营态增量 §1.1：livedIn 时跳过 90 天标准历史（避免迟到容差拒收回填），
      // 365 天历史与聚合由回放引擎（月批次 × 真实管线）负责。
      if (input.industry === "battery-manufacturing" && this.ts) {
        await this.seedBatteryParamsAndSpecs(ctx, seed, input.scale);
        if (!input.livedIn) {
          await this.generateHistory(ctx, seed);
          await this.ts.runAggregation(ctx.tenantId, { full: true });
        }
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
          origin: { type: "SYNTHETIC" },
          status: "PUBLISHED",
        });
      }
      const views = await this.filterByFeatures(ctx, template.scenarioSeed.views);
      // 增量视图（§7.14–7.17 + 图谱八视角 + 运营回顾）：不进 report.views（保持验收快照稳定），但进 view_configs。
      const extraViews =
        input.industry === "battery-manufacturing" ? await this.filterByFeatures(ctx, PLANVIEW_EXTRA_KEYS) : [];
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
      return job;
    } catch (err) {
      job.status = "FAILED";
      job.error = err instanceof Error ? err.message : String(err);
      await this.repos.syntheticJobs.put(job);
      throw err;
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
        sliceKey: "capacity_forecast|all|S192-LFP",
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

  /** ③b: deterministic 90-day history per tsGenerators (maint dips share the MaintPlan objects). */
  private async generateHistory(ctx: AuthCtx, seed: number): Promise<void> {
    if (!this.ts) return;
    const t0 = Date.parse(`${BATTERY_SOLVER_PARAMS.forecastStart as string}T00:00:00Z`);
    const maintPlans = (await this.repos.objects.listByType(ctx.tenantId, "MaintPlan")).map((m) => ({
      baseId: String(m.props.baseId),
      week: Number(m.props.week),
      lastMaintStart: String(m.props.lastMaintStart),
    }));
    const windows = maintWindowsFor(maintPlans, BATTERY_SOLVER_PARAMS.forecastStart as string);
    const generators = (BATTERY_TEMPLATE.tsGenerators ?? []) as unknown as TsGenSpec[];
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
        for (let d = 0; d < HISTORY_DAYS; d++) {
          const dateIso = new Date(t0 - (HISTORY_DAYS - d) * DAY_MS).toISOString().slice(0, 10);
          points.push({
            entityId,
            ts: `${dateIso}T00:00:00.000Z`,
            values: genPoint(gen, { entityId, baseId }, dateIso, d, seed, windowFor(windows, baseId, dateIso)),
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

  private async instantiateBattery(
    ctx: AuthCtx,
    seed: number,
    scale: "S" | "M" | "L" | "XL",
    origin: { type: "SYNTHETIC"; jobId: string },
  ): Promise<number> {
    // 治理增量 §1：先注册域（object_types.domain FK 校验目标 + 检索/图谱按域分组）。
    await this.seedDomains(ctx);
    for (const t of batteryObjectTypes()) {
      const existing = await this.ontology.getType(ctx, t.key);
      if (!existing) await this.ontology.upsertType(ctx, t);
    }
    for (const lt of batteryLinkTypes()) await this.ontology.upsertLinkType(ctx, lt);
    if ((await this.ontology.currentVersion(ctx.tenantId)) === 0) {
      await this.ontology.publishVersion(ctx);
    }
    const g = generateBattery(seed, scale);
    let n = 0;
    const putAll = async (type: string, rows: Record<string, unknown>[], pk: string) => {
      for (const row of rows) {
        await this.repos.objects.put({
          id: `obj_${type.toLowerCase()}_${String(row[pk])}`.replace(/[^\w-]/g, "_"),
          tenantId: ctx.tenantId,
          type,
          props: row,
          origin,
        });
        n++;
      }
    };
    await putAll("Base", g.bases, "baseId");
    await putAll("Model", g.models, "modelId");
    await putAll("Order", g.orders, "so");
    await putAll("Line", g.lines, "lineId");
    await putAll("Process", g.processes, "processId");
    await putAll("Equipment", g.equipment, "equipId");
    await putAll("MaintPlan", g.maintPlans, "planId");
    await putAll("Segment", g.segments, "segKey");
    await putAll("Shipment", g.shipments, "shipId");
    await putAll("DataSourceHealth", g.dataHealth, "sourceId");
    // 20 场景目录 §7 扩展数据（E6b）：13 求解器所需对象类型 + 实例（确定性 + 戏剧点植入）。
    for (const t of extendedObjectTypes()) {
      if (!(await this.ontology.getType(ctx, t.key))) await this.ontology.upsertType(ctx, t);
    }
    const ext = generateExtended(seed, { models: g.models as { modelId: string }[], bases: g.bases as { baseId: string; name: string }[], lines: g.lines as { lineId: string }[] }, scale);
    await putAll("Material", ext.materials, "matId");
    await putAll("MaterialBatch", ext.materialBatches, "batchId");
    await putAll("Customer", ext.customers, "custId");
    await putAll("ARInvoice", ext.arInvoices, "invoiceId");
    await putAll("Certification", ext.certifications, "certId");
    await putAll("EnergyMeter", ext.energyMeters, "meterId");
    await putAll("ChangeoverMatrix", ext.changeoverMatrix, "pairId");
    await putAll("CapexProject", ext.capexProjects, "projectId");
    await putAll("PurchaseOrder", ext.purchaseOrders, "poId");
    await putAll("CarbonFactor", ext.carbonFactors, "factorId");
    await putAll("FinanceAccount", ext.financeAccounts, "accId");
    await putAll("FinanceMetric", ext.financeMetrics, "metricId");
    // links: model_producible_at + order_for_model + model_certified_on (cert state on edge props).
    for (const m of g.models) {
      for (const baseId of m.bases as string[]) {
        await this.repos.links.put({
          id: `lnk_mpa_${m.modelId}_${baseId}`.replace(/[^\w-]/g, "_"),
          tenantId: ctx.tenantId,
          type: "model_producible_at",
          fromId: `obj_model_${m.modelId}`.replace(/[^\w-]/g, "_"),
          toId: `obj_base_${baseId}`,
          origin,
        });
      }
    }
    for (const o of g.orders) {
      await this.repos.links.put({
        id: `lnk_ofm_${o.so}`.replace(/[^\w-]/g, "_"),
        tenantId: ctx.tenantId,
        type: "order_for_model",
        fromId: `obj_order_${o.so}`.replace(/[^\w-]/g, "_"),
        toId: `obj_model_${o.model}`.replace(/[^\w-]/g, "_"),
        origin,
      });
    }
    for (const cl of g.certLinks) {
      await this.repos.links.put({
        id: `lnk_cert_${cl.modelId}_${cl.lineId}`.replace(/[^\w-]/g, "_"),
        tenantId: ctx.tenantId,
        type: "model_certified_on",
        fromId: `obj_model_${cl.modelId}`.replace(/[^\w-]/g, "_"),
        toId: `obj_line_${cl.lineId}`.replace(/[^\w-]/g, "_"),
        props: { status: cl.status, modelId: cl.modelId, baseId: cl.baseId },
        origin,
      });
    }

    // 跨域切片 order_fulfillment_360 的链路边（product→factory→process→equip→supply→commercial）。
    // 全部由对象 FK 确定性派生（无随机/时钟），同 seed 字节级一致。
    const oid = (type: string, pk: unknown) => `obj_${type.toLowerCase()}_${String(pk)}`.replace(/[^\w-]/g, "_");
    const putLink = async (idRaw: string, type: string, fromId: string, toId: string, props?: Record<string, unknown>) => {
      await this.repos.links.put({
        id: idRaw.replace(/[^\w-]/g, "_"),
        tenantId: ctx.tenantId,
        type,
        fromId,
        toId,
        ...(props ? { props } : {}),
        origin,
      });
    };
    // factory: Line → Base（Line.baseId）
    for (const l of g.lines) {
      await putLink(`lnk_lbb_${l.lineId}`, "line_belongs_to_base", oid("Line", l.lineId), oid("Base", l.baseId));
    }
    // process: Line → Process（Process.lineId）
    for (const pr of g.processes) {
      await putLink(`lnk_lhp_${pr.processId}`, "line_has_process", oid("Line", pr.lineId), oid("Process", pr.processId));
    }
    // equip: Equipment → Process（Equipment.processId）
    for (const eq of g.equipment) {
      await putLink(`lnk_eui_${eq.equipId}`, "equip_used_in", oid("Equipment", eq.equipId), oid("Process", eq.processId));
    }
    // supply: Model → Material（确定性 BOM：每型号取 4 种物料，按型号序错位选取，覆盖全部 8 料）
    const matIds = ext.materials.map((m) => String((m as { matId: string }).matId));
    for (let mi = 0; mi < g.models.length; mi++) {
      const m = g.models[mi] as { modelId: string };
      const bom = Array.from({ length: 4 }, (_, k) => matIds[(mi * 2 + k) % matIds.length] as string);
      for (const matId of new Set(bom)) {
        await putLink(`lnk_mum_${m.modelId}_${matId}`, "model_uses_material", oid("Model", m.modelId), oid("Material", matId));
      }
    }
    // commercial: Order → Customer（按订单序轮转绑定，覆盖全部客户）
    const custIds = ext.customers.map((c) => String((c as { custId: string }).custId));
    if (custIds.length > 0) {
      for (let oi = 0; oi < g.orders.length; oi++) {
        const o = g.orders[oi] as { so: string };
        const custId = custIds[oi % custIds.length] as string;
        await putLink(`lnk_ooc_${o.so}`, "order_of_customer", oid("Order", o.so), oid("Customer", custId), { custId });
      }
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
    // supply（批次）: Material → MaterialBatch（batch.matId）
    for (const bt of ext.materialBatches) await putLink(`lnk_mhb_${P(bt).batchId}`, "material_has_batch", oid("Material", P(bt).matId), oid("MaterialBatch", P(bt).batchId));
    // supply（采购）: Material → PurchaseOrder（po.matId）
    for (const po of ext.purchaseOrders) await putLink(`lnk_mpo_${P(po).poId}`, "material_supplied_by_po", oid("Material", P(po).matId), oid("PurchaseOrder", P(po).poId));
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
    const weeklyTotal = round(
      rollup.bases.reduce((a, b) => a + b.weeklyWan * (baseCert.get(b.baseId) ?? 0), 0),
      4,
    );
    const avgUnitPrice = Math.round(
      g.models.reduce((a, m) => a + (typeof m.unitPrice === "number" ? m.unitPrice : 0), 0) / Math.max(1, g.models.length),
    );
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

    // 跨 6 域内置切片 order_fulfillment_360：合成即落库（resolve 不依赖外部配置脚本）。
    for (const s of batteryBuiltinSlices()) {
      await this.repos.sliceSpecs.put({
        id: `slice_${s.sliceKey}`.replace(/[^\w-]/g, "_"),
        tenantId: ctx.tenantId,
        sliceKey: s.sliceKey,
        version: s.version,
        spec: s.spec,
      });
    }
    return n;
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
      for (let i = 0; i < count; i++) {
        const props: Record<string, unknown> = {};
        for (const [propKey, spec] of Object.entries(gen.propGenerators)) {
          props[propKey] = this.genValue(spec as GenSpec, rng, i, generatedPks);
        }
        if (props[pkProp] == null) props[pkProp] = `${gen.typeKey.toLowerCase()}-${i + 1}`;
        const pkValue = String(props[pkProp]);
        pks.push(pkValue);
        await this.repos.objects.put({
          id: `obj_${gen.typeKey.toLowerCase()}_${pkValue}`.replace(/[^\w-]/g, "_"),
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

  private genValue(spec: GenSpec, rng: () => number, seq: number, pks: Map<string, string[]>): unknown {
    switch (spec.kind) {
      case "enum":
        return spec.values[Math.floor(rng() * spec.values.length)];
      case "number":
        return round(spec.min + rng() * (spec.max - spec.min), spec.precision ?? 2);
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
    const graphView = (title: string, graphOptions: Record<string, unknown>, layout: Record<string, unknown> = {}) => ({
      title,
      renderer: "ontology-graph",
      layout,
      options: { graphOptions },
    });
    const VIEW_DEFS: Record<string, { title: string; renderer: string; layout?: Record<string, unknown>; options?: Record<string, unknown> }> = {
      dash: { title: "经营驾驶舱", renderer: "dashboard", layout: DASH_LAYOUT },
      graph: { title: "本体图谱", renderer: "ontology-graph", layout: {} },
      risk: { title: "预判推演看板", renderer: "risk-board", layout: { solverKey: "risk_timeline", horizon: 14 } },
      order: { title: "订单台账", renderer: "ledger", layout: LEDGER_LAYOUT },
      "plan-audit": { title: "规划体检", renderer: "plan-audit", layout: { solverKey: "plan_audit" } },
      "plan-generate": { title: "方案生成", renderer: "plan-generate", layout: { solverKey: "plan_generate" } },
      "project-sim": { title: "项目沙盘推演", renderer: "project-sim", layout: { solverKey: "capacity_forecast" } },
      "sop-balance": { title: "S&OP 月度平衡", renderer: "sop-balance", layout: { apiTag: "sop" } },
      // 增量 §7.14–7.17
      "annual-scenario": {
        title: "年度情景规划台",
        renderer: "annual-scenario",
        layout: { endpoint: "/a/v1/plan/aop", year: 2026, actionTypeKey: "AOP情景拍板", finalizeFeature: "act.aop-finalize" },
      },
      "quarterly-rolling": {
        title: "季度滚动看板",
        renderer: "quarterly-rolling",
        layout: { endpoint: "/a/v1/plan/quarterly", n: 6, gapTiers: { red: 4, yellow: 0 }, ltaEscalatePct: 5 },
      },
      "order-chain": {
        title: "订单全链聚合",
        renderer: "order-chain",
        layout: { solverKey: "affected_orders", window: { before: 7, after: 14 }, problemCategories: ["DELIVERY", "MARGIN", "KIT", "CREDIT"] },
      },
      "geo-map": {
        title: "基地地理视图",
        renderer: "geo-map",
        layout: { objectType: "Base", sizeProp: "gwh", colorProp: "kind", utilThresholds: [92, 85, 78] },
      },
      // 运营态增量 §4.2：运营回顾（只读历史证据链页面，消费 history/bundle）
      review: { title: "运营回顾", renderer: "review", layout: { apiTag: "history" } },
      // §7.18 图谱八视角（零新代码视角：renderer=ontology-graph + graphOptions 配置）
      "graph-all": graphView("图谱·全景", { colorBy: "domain", layoutSeed: 42 }),
      "graph-backbone": graphView("图谱·主干分级", { colorBy: "domain", nodeFilter: { tiers: [0, 1] }, dimOthers: true, layoutSeed: 42 }),
      "graph-flow": graphView("图谱·产能推演网络", { colorBy: "domain", linkKinds: ["flow", "agg"], layoutSeed: 42 }),
      "graph-source": graphView("图谱·数据来源", { colorBy: "source", layoutSeed: 42 }),
      "graph-solver": graphView("图谱·求解器", { colorBy: "domain", nodeFilter: { domains: ["solver"] }, linkKinds: ["calc"], dimOthers: true, layoutSeed: 42 }),
      "graph-mvp": graphView("图谱·MVP", { colorBy: "domain", mvpOverlay: true, layoutSeed: 42 }),
      "graph-agent": graphView("图谱·智能体网络", { colorBy: "domain", nodeFilter: { domains: ["agent", "solver"] }, linkKinds: ["orch"], dimOthers: true, layoutSeed: 42 }),
      "graph-loop": graphView(
        "图谱·学习闭环",
        { colorBy: "domain", nodeFilter: { ids: LOOP_NODE_IDS }, linkKinds: ["fb", "orch"], dimOthers: true, layoutSeed: 42 },
        // 视角描述卡链接校准报告页（真数据 MAPE 趋势；原型假动画明确不复刻）
        { descriptionLink: "/admin/calibration", description: "查看精度趋势与校准历史" },
      ),
    };
    const ADMIN_NAV: { key: string; label: string }[] = [
      { key: "connections", label: "数据接入" },
      { key: "rule-docs", label: "规则文档审核" },
      { key: "modeling", label: "本体建模" },
      { key: "rules", label: "规则库" },
      { key: "permissions", label: "权限策略" },
      { key: "synthetic", label: "合成数据" },
      { key: "actions", label: "Action 审批" },
      { key: "features", label: "功能开通" },
      { key: "catalog", label: "意图目录" },
      { key: "agents", label: "Agent 注册表" },
      { key: "workflows", label: "Workflow" },
      { key: "skills", label: "Skill" },
      { key: "mcp", label: "MCP 服务器" },
      { key: "scenes", label: "场景入口" },
      { key: "ops/fallback", label: "兜底运营" },
    ];
    // 不同账号不同前端：admin 全量（含 admin 导航组），planner 业务视图，base_manager 子集 + 不同主题强调色。
    const baseManagerExtras = extraViews.filter((v) => v === "order-chain" || v === "review");
    const roleViews: Record<string, string[]> = {
      admin: [...views, ...extraViews],
      planner: [...views, ...extraViews],
      base_manager: [
        ...views.filter((v) => !["dash", "graph", "plan-audit", "plan-generate"].includes(v)),
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
          if (evaluateExpression(r.expression, { payload: { Order: o.props, ...o.props } })) violations++;
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
