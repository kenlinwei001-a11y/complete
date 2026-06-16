import type { AuthCtx, CalibrationForecastRecord, ObjectInstance } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import { notFound, validationError } from "../errors.js";
import { round } from "../prng.js";
import { getByPath, setByPath } from "../paths.js";
import { BATTERY_SOLVER_PARAMS } from "../synthetic/battery.js";
import { BottleneckMatrixOutputSchema, CapacityForecastOutputSchema, PlanAuditOutputSchema, PlanGenerateOutputSchema, RiskTimelineOutputSchema } from "@platform/contracts";
import { num, str, type SolverContext, type SolverParamsShape } from "./types.js";
import { capacityForecast, computeRollup, curveMult, type ForecastArgs } from "./capacity.js";
import { affectedOrders, affectedOrdersAggregate, bottleneckMatrix, riskTimeline, type AffectedOrdersArgs, type RiskTimelineArgs } from "./risk.js";
import { planAudit, planGenerate, type PlanAuditInput, type PlanGenerateArgs } from "./plan.js";
import { capexScenario, type CapexScenarioArgs } from "./capex.js";
import { EXTENDED_SOLVERS, deriveExtendedArgs } from "./extended.js";

export const SOLVER_KEYS = [
  "capacity_rollup",
  "capacity_forecast",
  "bottleneck_matrix",
  "risk_timeline",
  "affected_orders",
  "plan_audit",
  "plan_generate",
  "capex_scenario",
  // 20 场景目录 §2 新增 13（成熟度 E6a）
  "mitigation_select",
  "cert_schedule",
  "kit_readiness",
  "lta_gap",
  "inventory_optimize",
  "changeover_sequence",
  "yield_diagnosis",
  "maintenance_stagger",
  "outsourcing_split",
  "quote_margin",
  "credit_exposure",
  "quarterly_gap",
  "carbon_footprint",
  // Phase6B 跨求解器编排器（meta-solver）
  "countermeasure_combo",
] as const;

/**
 * R11-SHAPE 求解器输出形状注册（顶层输出 key 全集，权威来源=契约输出 schema 的 `.shape`）。
 * validateClosure 据此校验 BuildPlan.solverNeeds[].renderBindings ⊆ 输出形状 —— 把跨服务
 * 形状断点(G-2)挡在建图期。未声明形状的求解器 → SHAPE 跳过（不阻塞，渐进补齐）。
 */
const shapeKeys = (schema: { shape: Record<string, unknown> }): string[] => Object.keys(schema.shape);
export const SOLVER_OUTPUT_SHAPES: Record<string, string[]> = {
  capacity_forecast: shapeKeys(CapacityForecastOutputSchema),
  bottleneck_matrix: shapeKeys(BottleneckMatrixOutputSchema),
  risk_timeline: shapeKeys(RiskTimelineOutputSchema),
  plan_audit: shapeKeys(PlanAuditOutputSchema),
  plan_generate: shapeKeys(PlanGenerateOutputSchema),
};

const DAY_MS = 86400000;

/**
 * S1 real solver algorithms. All numeric constants come from the per-tenant
 * solver_params storage (seeded by the scenario pack); the battery defaults are
 * the fallback when a tenant has no record yet. Deterministic: same input +
 * same param version → same output.
 *
 * M11/S1 修订：solver_params 每次变更 version+1 并落版本历史（solver_params_history），
 * 支持 runWithParams(指定版本/参数集) —— 校准引擎重放归因与回测的执行体。
 */
export class SolverService {
  constructor(private repos: Repos) {}

  async getParams(tenantId: string): Promise<SolverParamsShape> {
    const rec = await this.repos.solverParams.get(tenantId, `spar_${tenantId}`);
    const stored = (rec?.params ?? {}) as Record<string, unknown>;
    // shallow-merge over scenario-pack defaults so partial overrides work
    return { ...(BATTERY_SOLVER_PARAMS as unknown as SolverParamsShape), ...stored } as SolverParamsShape;
  }

  /** Current solver_params version (0 = never written). */
  async paramsVersion(tenantId: string): Promise<number> {
    const rec = await this.repos.solverParams.get(tenantId, `spar_${tenantId}`);
    return rec?.version ?? 0;
  }

  /** S1 修订：按指定版本取参数（历史缺失时回落当前版本）。 */
  async paramsAt(tenantId: string, version: number): Promise<SolverParamsShape> {
    const hist = await this.repos.solverParamsHistory.get(tenantId, `sparh_${tenantId}_v${version}`);
    if (!hist) return this.getParams(tenantId);
    return { ...(BATTERY_SOLVER_PARAMS as unknown as SolverParamsShape), ...(hist.params as Record<string, unknown>) } as SolverParamsShape;
  }

  /**
   * 所有 solver_params 写入的唯一通道：克隆 → 变更 → version+1 → 双份历史
   * （首写时补当前版本快照，再写新版本快照）。返回新版本号。
   */
  async mutateParams(tenantId: string, mutate: (params: Record<string, unknown>) => void, note?: string): Promise<number> {
    const id = `spar_${tenantId}`;
    const rec = await this.repos.solverParams.get(tenantId, id);
    const prevVersion = rec?.version ?? 0;
    const prevParams = structuredClone(rec?.params ?? {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    if (rec && !(await this.repos.solverParamsHistory.get(tenantId, `sparh_${tenantId}_v${prevVersion}`))) {
      await this.repos.solverParamsHistory.put({
        id: `sparh_${tenantId}_v${prevVersion}`,
        tenantId,
        version: prevVersion,
        params: structuredClone(prevParams),
        createdAt: now,
      });
    }
    const params = prevParams;
    mutate(params);
    const version = prevVersion + 1;
    await this.repos.solverParams.put({ id, tenantId, params, version, updatedAt: now });
    await this.repos.solverParamsHistory.put({
      id: `sparh_${tenantId}_v${version}`,
      tenantId,
      version,
      params: structuredClone(params),
      note,
      createdAt: now,
    });
    return version;
  }

  async setParam(tenantId: string, path: string, value: number, note?: string): Promise<number> {
    return this.mutateParams(tenantId, (p) => setByPath(p, path, value), note);
  }

  async getParamValue(tenantId: string, path: string): Promise<unknown> {
    return getByPath((await this.getParams(tenantId)) as unknown as Record<string, unknown>, path);
  }

  /** 本体基线属性变更等非 solver_params 写入也要推进参数版本（配对 staleParams 锚点）。 */
  async bumpParamsVersion(tenantId: string, note: string): Promise<number> {
    return this.mutateParams(tenantId, () => undefined, note);
  }

  async loadContext(
    tenantId: string,
    visibleOrders?: ObjectInstance[],
    opts?: { withExtended?: boolean },
  ): Promise<SolverContext> {
    const [bases, lines, processes, equipment, maintPlans, models, orders, shipments, segments, dataHealth] =
      await Promise.all([
        this.repos.objects.listByType(tenantId, "Base"),
        this.repos.objects.listByType(tenantId, "Line"),
        this.repos.objects.listByType(tenantId, "Process"),
        this.repos.objects.listByType(tenantId, "Equipment"),
        this.repos.objects.listByType(tenantId, "MaintPlan"),
        this.repos.objects.listByType(tenantId, "Model"),
        visibleOrders ? Promise.resolve(visibleOrders) : this.repos.objects.listByType(tenantId, "Order"),
        this.repos.objects.listByType(tenantId, "Shipment"),
        this.repos.objects.listByType(tenantId, "Segment"),
        this.repos.objects.listByType(tenantId, "DataSourceHealth"),
      ]);
    const certByModel = new Map<string, Map<string, string>>();
    const certLinks = await this.repos.links.list(tenantId, (l) => l.type === "model_certified_on");
    const lineBase = new Map(lines.map((l) => [l.id, str(l.props.baseId)]));
    const modelById = new Map(models.map((m) => [m.id, str(m.props.modelId)]));
    for (const link of certLinks.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const modelId = modelById.get(link.fromId) ?? str(link.props?.modelId);
      const baseId = lineBase.get(link.toId) ?? str(link.props?.baseId);
      if (!modelId || !baseId) continue;
      let m = certByModel.get(modelId);
      if (!m) {
        m = new Map();
        certByModel.set(modelId, m);
      }
      m.set(baseId, str(link.props?.status, "量产"));
    }
    const params = await this.getParams(tenantId);
    // #4 性能：扩展数据（E6b 10 类）仅 13 新求解器需要 —— 默认不加载（省 10 次全表扫描），
    // invoke/runWithParams 在 solverKey∈EXTENDED_SOLVERS 时才置 withExtended。
    const empty: ObjectInstance[] = [];
    const [materials, materialBatches, customers, arInvoices, certifications, energyMeters, changeoverMatrix, capexProjects, purchaseOrders, carbonFactors] =
      opts?.withExtended
        ? await Promise.all([
            this.repos.objects.listByType(tenantId, "Material"),
            this.repos.objects.listByType(tenantId, "MaterialBatch"),
            this.repos.objects.listByType(tenantId, "Customer"),
            this.repos.objects.listByType(tenantId, "ARInvoice"),
            this.repos.objects.listByType(tenantId, "Certification"),
            this.repos.objects.listByType(tenantId, "EnergyMeter"),
            this.repos.objects.listByType(tenantId, "ChangeoverMatrix"),
            this.repos.objects.listByType(tenantId, "CapexProject"),
            this.repos.objects.listByType(tenantId, "PurchaseOrder"),
            this.repos.objects.listByType(tenantId, "CarbonFactor"),
          ])
        : [empty, empty, empty, empty, empty, empty, empty, empty, empty, empty];
    return {
      tenantId,
      params,
      bases: sortById(bases),
      lines: sortById(lines),
      processes: sortById(processes),
      equipment: sortById(equipment),
      maintPlans: sortById(maintPlans),
      models: sortById(models),
      orders: sortById(orders),
      shipments: sortById(shipments),
      segments: sortById(segments),
      dataHealth: sortById(dataHealth),
      certByModel,
      materials: sortById(materials),
      materialBatches: sortById(materialBatches),
      customers: sortById(customers),
      arInvoices: sortById(arInvoices),
      certifications: sortById(certifications),
      energyMeters: sortById(energyMeters),
      changeoverMatrix: sortById(changeoverMatrix),
      capexProjects: sortById(capexProjects),
      purchaseOrders: sortById(purchaseOrders),
      carbonFactors: sortById(carbonFactors),
    };
  }

  /** §6.2 test hook + iot_delay scenario: mark a critical source stale (C09 → P90 0.93→0.90). */
  async markSourceStale(tenantId: string, sourceId: string, lagHours: number): Promise<void> {
    const all = await this.repos.objects.listByType(tenantId, "DataSourceHealth");
    const obj = all.find((o) => o.props.sourceId === sourceId) ?? all[0];
    if (!obj) throw notFound("data source health object");
    obj.props.lagHours = lagHours;
    await this.repos.objects.put(obj);
  }

  /**
   * Pure deterministic dispatch — no storage side effects. The calibration
   * engine's replay attribution & backtest call this with patched contexts.
   */
  compute(c: SolverContext, solverKey: string, args: Record<string, unknown>): Record<string, unknown> {
    switch (solverKey) {
      case "capacity_rollup": {
        const r = computeRollup(c);
        return { bases: r.bases, ruleRefs: r.ruleRefs };
      }
      case "capacity_forecast":
        return capacityForecast(c, args as unknown as ForecastArgs);
      case "bottleneck_matrix":
        return bottleneckMatrix(c, args as { dataMode?: string; baseIds?: string[] });
      case "risk_timeline":
        return riskTimeline(c, args as unknown as RiskTimelineArgs);
      case "affected_orders": {
        // baseId → 单基地明细（risk-board/内部/测试）；无 baseId → 跨基地聚合（order-chain 视图 VM）。
        if (!args.baseId) return affectedOrdersAggregate(c, args as { base?: string; horizon?: number });
        return affectedOrders(c, args as unknown as AffectedOrdersArgs);
      }
      case "plan_audit": {
        const required = ["dem", "seg_pas", "seg_ess", "seg_com", "sup", "ltaCov", "kitGap", "gmTarget", "cashCushion", "capex"];
        for (const k of required) {
          if (typeof args[k] !== "number") throw validationError(`plan_audit input field '${k}' (number) required`);
        }
        return planAudit(c, args as unknown as PlanAuditInput);
      }
      case "plan_generate":
        return planGenerate(c, args as unknown as PlanGenerateArgs);
      case "capex_scenario":
        return capexScenario(c, args as unknown as CapexScenarioArgs);
      default: {
        // 20 场景目录 §2 新增 13 求解器：缺 args 时从对象数据推导（E6b），再确定性求解
        const ext = EXTENDED_SOLVERS[solverKey];
        if (ext) return ext(deriveExtendedArgs(c, solverKey, args));
        throw notFound(`solver ${solverKey}`);
      }
    }
  }

  /** S1 修订：以指定参数版本（或显式参数集）运行 —— 同输入同参数版本同输出。 */
  async runWithParams(
    tenantId: string,
    solverKey: string,
    args: Record<string, unknown>,
    opts?: { paramsVersion?: number; params?: SolverParamsShape },
  ): Promise<Record<string, unknown>> {
    const c = await this.loadContext(tenantId, undefined, { withExtended: !!EXTENDED_SOLVERS[solverKey] });
    const params =
      opts?.params ?? (opts?.paramsVersion !== undefined ? await this.paramsAt(tenantId, opts.paramsVersion) : c.params);
    return this.compute({ ...c, params }, solverKey, args);
  }

  async invoke(
    ctx: AuthCtx,
    solverKey: string,
    args: Record<string, unknown>,
    visibleOrders?: ObjectInstance[],
  ): Promise<Record<string, unknown>> {
    const c = await this.loadContext(ctx.tenantId, visibleOrders, { withExtended: !!EXTENDED_SOLVERS[solverKey] });
    const out = this.compute(c, solverKey, args);
    if (solverKey === "capacity_forecast") {
      // T9 deviation line: remember the prediction for tick-time comparison.
      const modelId = str(args.modelId);
      const weeks = num(out.weeks, 6);
      await this.repos.forecastSnapshots.put({
        id: `fcst_${ctx.tenantId}_${modelId}`,
        tenantId: ctx.tenantId,
        modelId,
        p50: num(out.p50),
        weeks,
        predictedDaily: round(num(out.p50) / (weeks * 7), 6),
        createdAt: new Date().toISOString(),
      });
      // M11 §1: 轻量预测记录（按日窗口；含周曲线，供配对引擎与重放归因消费）
      await this.recordCalibrationForecasts(ctx.tenantId, c.params, modelId, out);
    }
    return out;
  }

  /**
   * M11 §1 预测记录：对窗口内每个目标日落一条 calf_ 记录（全基地合计 + 每基地切片），
   * predicted 含爬坡/检修周曲线（Σ日预测 = p50）。已配对窗口不重写（一个预测只配对一次）。
   */
  private async recordCalibrationForecasts(
    tenantId: string,
    params: SolverParamsShape,
    modelId: string,
    out: Record<string, unknown>,
  ): Promise<void> {
    const weeks = num(out.weeks, 6);
    const healthFactor = num(out.healthFactor, params.health.normal);
    const rows = (out.perBaseRows ?? []) as { baseId: string; weeklyCap: number; certFactor: number; maintWeek: number | null }[];
    if (!Array.isArray(rows) || rows.length === 0) return;
    const version = await this.paramsVersion(tenantId);
    const startMs = Date.parse(`${params.forecastStart.slice(0, 10)}T00:00:00Z`);
    const now = new Date().toISOString();
    for (let d = 0; d < weeks * 7; d++) {
      const date = new Date(startMs + d * DAY_MS).toISOString().slice(0, 10);
      const week = Math.floor(d / 7) + 1;
      let total = 0;
      for (const r of rows) {
        const daily = round((num(r.weeklyCap) * num(r.certFactor) * curveMult(params, week, r.maintWeek ?? null)) / 7, 6);
        total += daily;
        await this.putForecastRecord(tenantId, {
          id: fcstRecId(tenantId, modelId, r.baseId, date),
          tenantId,
          solverKey: "capacity_forecast",
          modelId,
          baseId: r.baseId,
          windowFrom: date,
          windowTo: date,
          predicted: daily,
          predictedP90: round(daily * healthFactor, 6),
          paramsVersion: version,
          weekOfWindow: week,
          createdAt: now,
        });
      }
      await this.putForecastRecord(tenantId, {
        id: fcstRecId(tenantId, modelId, "all", date),
        tenantId,
        solverKey: "capacity_forecast",
        modelId,
        windowFrom: date,
        windowTo: date,
        predicted: round(total, 6),
        predictedP90: round(total * healthFactor, 6),
        paramsVersion: version,
        weekOfWindow: week,
        createdAt: now,
      });
    }
  }

  private async putForecastRecord(tenantId: string, rec: CalibrationForecastRecord): Promise<void> {
    const existing = await this.repos.calibrationForecasts.get(tenantId, rec.id);
    if (existing?.pairedAt) return; // 该窗口已配对 —— 不重开
    await this.repos.calibrationForecasts.put(rec);
  }
}

export function fcstRecId(tenantId: string, modelId: string, baseId: string, date: string): string {
  return `calf_${tenantId}_capfc_${modelId}_${baseId}_${date}`.replace(/[^\w-]/g, "_");
}

function sortById(arr: ObjectInstance[]): ObjectInstance[] {
  return [...arr].sort((a, b) => (a.id < b.id ? -1 : 1));
}
