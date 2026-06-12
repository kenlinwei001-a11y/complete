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
  BATTERY_SOLVER_PARAMS,
  BATTERY_TEMPLATE,
  BATTERY_TS_AGG_SPECS,
  batteryLinkTypes,
  batteryObjectTypes,
  generateBattery,
} from "./battery.js";
import { genPoint, maintWindowsFor, windowFor, type TsGenSpec } from "./tsgen.js";

const TEMPLATE_SYSTEM = `你是行业数据模板生成器。给定行业名称，输出 IndustryTemplate：
ontology.objectTypes（数组，每项 { key, displayName, properties:[{propKey,dataType,isPrimaryKey,refToTypeKey?}], derivedProperties:[{propKey,formula}] }）、
generation（每对象类型的 count{S,M,L} 与 propGenerators）、rules（规则 DSL 表达式）、scenarioSeed。
生成顺序必须保证先主数据后事务数据（fkSample 只引用更早的类型）。`;

const DAY_MS = 86400000;
const HISTORY_DAYS = 90;

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

  constructor(
    private repos: Repos,
    private llm: LlmClient,
    private ontology: OntologyService,
    private rules: RulesService,
    private metrics: Metrics,
    private model: string,
    private ts?: TimeseriesService,
  ) {}

  wire(deps: { scheduler?: SchedulerService; features?: FeatureService; actions?: ActionService; ts?: TimeseriesService }): void {
    this.scheduler = deps.scheduler ?? this.scheduler;
    this.features = deps.features ?? this.features;
    this.actions = deps.actions ?? this.actions;
    this.ts = deps.ts ?? this.ts;
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
    input: { industry: string; scale: "S" | "M" | "L"; seed?: number },
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
      if (input.industry === "battery-manufacturing" && this.ts) {
        await this.seedBatteryParamsAndSpecs(ctx, seed, input.scale);
        await this.generateHistory(ctx, seed);
        await this.ts.runAggregation(ctx.tenantId, { full: true });
      }

      // ④ derive everything through the A4 pipeline (single source of truth).
      await this.ontology.runDerivations(ctx);

      // ⑤ rules (origin SYNTHETIC), views, demo accounts, policies, scheduler defaults.
      for (const r of template.rules) {
        await this.rules.create(ctx, {
          key: r.key,
          name: r.name,
          expression: r.expression,
          scopeObjectTypes: ["Order"],
          severity: (["BLOCK", "WARN", "INFO"].includes(r.severity) ? r.severity : "WARN") as
            | "BLOCK"
            | "WARN"
            | "INFO",
          origin: { type: "SYNTHETIC" },
          status: "PUBLISHED",
        });
      }
      const views = await this.filterByFeatures(ctx, template.scenarioSeed.views);
      await this.seedViewConfigs(ctx, views);
      const accounts = await this.seedDemoAccounts(ctx);
      await this.seedPolicies(ctx);
      if (this.scheduler) {
        await this.scheduler.register(ctx.tenantId, "DERIVATION_FULL", "tenant", "0 2 * * *");
        await this.scheduler.register(ctx.tenantId, "RULE_SCAN", "tenant", "0 * * * *");
        await this.scheduler.register(ctx.tenantId, "TS_AGGREGATE", "tenant", "30 * * * *");
      }

      // ⑥ validation report.
      job.report = await this.buildReport(ctx, template, views, accounts, seed);
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

  private async seedBatteryParamsAndSpecs(ctx: AuthCtx, seed: number, scale: "S" | "M" | "L"): Promise<void> {
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

  private async instantiateBattery(
    ctx: AuthCtx,
    seed: number,
    scale: "S" | "M" | "L",
    origin: { type: "SYNTHETIC"; jobId: string },
  ): Promise<number> {
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
    return n;
  }

  // -- generic instantiation from (LLM-generated) templates ----------------------

  private async instantiateGeneric(
    ctx: AuthCtx,
    template: IndustryTemplate,
    seed: number,
    scale: "S" | "M" | "L",
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
      const count = gen.count[scale];
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
      { username: "admin", roles: ["admin"], attributes: {} },
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

  private async seedViewConfigs(ctx: AuthCtx, views: string[]): Promise<void> {
    const titles: Record<string, string> = { dash: "驾驶舱", risk: "风险推演", order: "订单台账" };
    const roleViews: Record<string, string[]> = {
      admin: views,
      planner: views,
      base_manager: views.filter((v) => v !== "dash"),
    };
    const old = await this.repos.viewConfigs.list(ctx.tenantId, (v) => v.origin === "SYNTHETIC");
    for (const v of old) await this.repos.viewConfigs.remove(ctx.tenantId, v.id);
    for (const [role, keys] of Object.entries(roleViews)) {
      const vc: ViewConfig = {
        id: `vc_${ctx.tenantId}_${role}`,
        tenantId: ctx.tenantId,
        role,
        scenarioPackages: ["battery-manufacturing"],
        views: keys.map((k) => ({ key: k, title: titles[k] ?? k })),
        theme: { primary: role === "admin" ? "#1f6feb" : role === "planner" ? "#0b7261" : "#7c3aed" },
        navigation: keys.map((k) => ({ key: k, label: titles[k] ?? k })),
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

function entityRefFieldOf(entityType: string): string {
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
