import type { AuthCtx, CalibrationForecastRecord, ObjectInstance } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OntologyCoreService } from "../ontology-core.js";
import type { OptimizerClient } from "./optimizer-client.js";
import { notFound, validationError } from "../errors.js";
import { round } from "../prng.js";
import { getByPath, setByPath } from "../paths.js";
import { BATTERY_SOLVER_PARAMS } from "../synthetic/battery.js";
import { BottleneckMatrixOutputSchema, CapacityForecastOutputSchema, PlanAuditOutputSchema, PlanGenerateOutputSchema, RiskTimelineOutputSchema } from "@platform/contracts";
import { num, str, type SolverContext, type SolverParamsShape } from "./types.js";
import { createHash } from "node:crypto";
import { runSolverSandbox } from "./sandbox.js";
import type { LlmClient } from "../llm.js";
import { generateSolverDraft, type SolverGenSpec } from "./llm-gen.js";
import type { OutboxService } from "../outbox.js";
import type { SolverArtifact, SolverGenDraft } from "@platform/contracts";
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
  // cockpit P2 规划决策推演 · 根因归因 DAG：经营 KPI 越线沿 RootCauseChain 归因模板逐层取证，
  // DAG 结构与每条边的贡献均从 Metric/RootCauseChain/活数据算出（确定性 R6，「结构=算、模板=配成对象」）。
  "plan_rootcause",
  // SPINE 经营目标-指标-责任骨架：从对象库聚合 actual + 对齐 PlanTarget target → 算 delta/miss，
  // 输出指标数组（各视图 KPI 单一出处 R-一致，派生投影非新真值 R13，确定性 R6）。
  "metric_rollup",
  // 通用 what-if 求解器（generic-inference P2，G-5）：包装本体派生引擎 recompute(dryRun+apply)，
  // 对任意已发布本体做"假设值前向重算"，非电池专用；growth 缺求解器 B 兜底路由到此。
  "generic_inference",
  // PRD-fde §8d/Q4 通用共享瓶颈求解器（净室,零依赖,声明式组合）：读对象图,按 viaField 把上游对象
  // 分组到共享资源,需求和>产能 = 瓶颈;按优先级判哪张单降级。非电池专用,任意本体经 args 字段映射即用。
  "shared_bottleneck",
  // PRD-fde §8c/Q5 隐性集中度（净室通用）：多跳反向聚合找暗线单点。
  "concentration_risk",
  // PRD-fde §8 Q3 毛利倒挂根因归因（净室通用）：成本项拆解 + 倒挂群主驱动聚合。
  "margin_attribution",
  // PRD-fde §8 Q2 单一供应商断供影响半径（净室通用）：反向多跳逐层扇出算扩散半径与叶层敞口。
  "supplier_disruption_radius",
  // PRD-fde §8d 组合最优化（CP-SAT sidecar 代理）：通用 0/1 选择最优化,贪心给不出的可证最优。
  "selection_optimize",
  // A8.1/8.2/8.3 CP-SAT 可证最优族：指派(订单→基地)/排序(换型)/装箱(产能填充)
  "assignment_optimize",
  "sequencing_optimize",
  "packing_optimize",
] as const;

/**
 * R11-SHAPE 求解器输出形状注册（顶层输出 key 全集，权威来源=契约输出 schema 的 `.shape`）。
 * validateClosure 据此校验 BuildPlan.solverNeeds[].renderBindings ⊆ 输出形状 —— 把跨服务
 * 形状断点(G-2)挡在建图期。未声明形状的求解器 → SHAPE 跳过（不阻塞，渐进补齐）。
 */
const shapeKeys = (schema: { shape: Record<string, unknown> }): string[] => Object.keys(schema.shape);
export const SOLVER_OUTPUT_SHAPES: Record<string, string[]> = {
  // 契约 schema 权威（声明输出契约）
  capacity_forecast: shapeKeys(CapacityForecastOutputSchema),
  bottleneck_matrix: shapeKeys(BottleneckMatrixOutputSchema),
  risk_timeline: shapeKeys(RiskTimelineOutputSchema),
  plan_audit: shapeKeys(PlanAuditOutputSchema),
  plan_generate: shapeKeys(PlanGenerateOutputSchema),
  // 其余 17 求解器输出形状（取自实现的成功路径返回对象顶层 key；权威=求解器实现）
  capacity_rollup: ["bases", "ruleRefs"],
  // 通用 what-if（recompute dryRun 包装）：顶层渲染键 = 派生 before/after deltas + 受影响计数。
  generic_inference: ["deltas", "rows", "affectedObjects", "count", "rootTypes"],
  shared_bottleneck: ["bottlenecks", "contention", "downgraded", "summary"],
  concentration_risk: ["concentrations", "topExposure", "summary"],
  margin_attribution: ["inverted", "rootDrivers", "invertedCount", "summary"],
  supplier_disruption_radius: ["rootType", "rootId", "layers", "radius", "totalAffected", "leafType", "leafCount", "summary"],
  selection_optimize: ["status", "optimal", "selected", "totalValue", "totalWeight", "itemType", "budget", "candidateCount", "summary"],
  assignment_optimize: ["status", "optimal", "assignments", "objective", "itemType", "binType", "itemCount", "binCount", "summary"],
  sequencing_optimize: ["status", "optimal", "sequence", "changeovers", "objective", "jobType", "jobCount", "summary"],
  packing_optimize: ["status", "optimal", "bins", "binCount", "objective", "itemType", "itemCount", "binCapacity", "summary"],
  affected_orders: ["baseId", "affected", "total", "count", "columns", "rows", "fallback", "problems", "summary"],
  capex_scenario: ["scenarioKey", "quarters", "demand", "s0", "S", "G", "windows", "projects", "c23"],
  mitigation_select: ["factor", "baseName", "urgency", "plans", "recommended", "draftPayload", "options", "factors", "error"],
  cert_schedule: ["schedule", "engineerGroups", "ruleRefs"],
  kit_readiness: ["rows", "shortageCount", "ruleRefs"],
  lta_gap: ["material", "month", "netDemand", "coverage", "gap", "po", "ruleRefs"],
  inventory_optimize: ["over", "under", "idle", "releasableCash", "ruleRefs"],
  changeover_sequence: ["lineId", "sequence", "totalChangeoverMin", "savedVsDueMin", "infeasible", "ruleRefs"],
  yield_diagnosis: ["breakpoint", "candidates", "ruleRefs"],
  maintenance_stagger: ["adjustments", "unresolved", "ruleRefs"],
  outsourcing_split: ["allocation", "totalCost", "savedVsAllDelay", "outsourceQualityGate", "ruleRefs"],
  quote_margin: ["margin", "floor", "diff", "verdict", "breakdown", "ruleRefs"],
  credit_exposure: ["limit", "exposure", "available", "exposureBreakdown", "overdue", "newOrderVerdict", "ruleRefs"],
  quarterly_gap: ["quarter", "combo", "residualGap", "ruleRefs"],
  carbon_footprint: ["modelId", "baseName", "total", "breakdown", "threshold", "verdict", "maxLever", "ruleRefs"],
  countermeasure_combo: ["gap", "combo", "residualGap", "totalCost", "feasible", "ruleRefs"],
  plan_rootcause: ["kpis", "dag", "offTargetCount", "summary", "ruleRefs"],
  metric_rollup: ["metrics", "missCount", "byLevel", "summary"],
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

  /** generic_inference 需读对象图 + 前向重算（recompute 在 OntologyCore）；app.ts 构造后注入。 */
  private ontologyCore?: OntologyCoreService;
  setOntologyCore(oc: OntologyCoreService): void {
    this.ontologyCore = oc;
  }

  /** selection_optimize 走 CP-SAT sidecar（OPTIMIZER_BASE_URL 配置时注入；测试注入 mock）。 */
  private optimizer?: OptimizerClient;
  setOptimizer(client: OptimizerClient): void {
    this.optimizer = client;
  }

  /** A18.2 LLM 临时求解器生成用 LLM + outbox（app.ts 注入；未注入则 generate 报错，不静默）。 */
  private llm?: LlmClient;
  private outbox?: OutboxService;
  setLlm(llm: LlmClient): void { this.llm = llm; }
  setOutbox(o: OutboxService): void { this.outbox = o; }

  /** A18.2：构建沙箱 ctx（按对象类型分组的实例图；LLM 临时求解器只读这个 + args，净室隔离）。 */
  private async buildSandboxCtx(tenantId: string): Promise<{ objectsByType: Record<string, Record<string, unknown>[]> }> {
    const types = await this.repos.ontologyTypes.list(tenantId);
    const objectsByType: Record<string, Record<string, unknown>[]> = {};
    for (const t of types) {
      const rows = await this.repos.objects.listByType(tenantId, t.key);
      objectsByType[t.key] = rows.map((r) => ({ id: r.id, ...r.props }));
    }
    return { objectsByType };
  }

  /**
   * A18.2 消灭 P5：LLM 生成临时求解器 → 冻结(hash+版本) → 锁死沙箱跑通自检 → 注册 PROVISIONAL（或 UNREGISTERED）。
   * LLM 只在此调一次，产物冻结；运行期确定性由沙箱保证（Date/random 禁）。注册成功发 solver.provisional_generated。
   */
  async generateProvisionalSolver(ctx: AuthCtx, spec: SolverGenSpec): Promise<SolverArtifact> {
    if (!this.llm) throw validationError("LLM 未注入，无法生成临时求解器（A18.2 需配 comprehend provider）");
    const draft = await this.generateDraftWithSchema(ctx, spec);
    return this.registerProvisionalSolver(ctx, spec.key, draft);
  }

  private async generateDraftWithSchema(ctx: AuthCtx, spec: SolverGenSpec): Promise<SolverGenDraft> {
    // spec.objectTypes 缺省则从本租户本体填充（让 LLM 写对字段引用）。
    if (spec.objectTypes.length === 0) {
      const types = await this.repos.ontologyTypes.list(ctx.tenantId);
      spec = { ...spec, objectTypes: types.map((t) => ({ typeKey: t.key, props: t.properties.map((p) => p.propKey) })) };
    }
    return generateSolverDraft(this.llm!, spec, { tenantId: ctx.tenantId });
  }

  /** 冻结 + 沙箱跑通自检 + 注册（纯逻辑，确定性；draft 已由 LLM 产出/或测试直供）。 */
  async registerProvisionalSolver(ctx: AuthCtx, key: string, draft: SolverGenDraft): Promise<SolverArtifact> {
    const hash = createHash("sha256").update(draft.computeSource).digest("hex").slice(0, 16);
    const prior = (await this.repos.solverArtifacts.list(ctx.tenantId, (a) => a.key === key)).sort((a, b) => b.version - a.version)[0];
    const version = prior ? prior.version + 1 : 1;
    const base: Omit<SolverArtifact, "status" | "trustLevel" | "rejectReason"> = {
      id: `sart_${ctx.tenantId}_${key}_v${version}`,
      tenantId: ctx.tenantId,
      key,
      computeSource: draft.computeSource,
      outputShape: draft.outputShape,
      argHints: draft.argHints,
      rationale: draft.rationale,
      origin: "LLM",
      hash,
      version,
      createdBy: ctx.userId,
      createdAt: new Date().toISOString(),
    };
    // 跑通自检：用本租户对象图样例 ctx + 空 args 在沙箱执行，输出须为对象。
    const sampleCtx = await this.buildSandboxCtx(ctx.tenantId);
    const probe = await runSolverSandbox(draft.computeSource, sampleCtx, {}, { timeoutMs: 1500 });
    let artifact: SolverArtifact;
    if (probe.ok && probe.output !== null && typeof probe.output === "object") {
      artifact = { ...base, status: "PROVISIONAL", trustLevel: "UNVERIFIED" };
    } else {
      artifact = { ...base, status: "UNREGISTERED", trustLevel: "UNVERIFIED", rejectReason: probe.error ?? "跑通自检输出非对象" };
    }
    await this.repos.solverArtifacts.put(artifact);
    if (artifact.status === "PROVISIONAL") {
      await this.outbox?.emit(ctx.tenantId, "solver.provisional_generated", { key, version, hash, trustLevel: "UNVERIFIED" });
    }
    return artifact;
  }

  /** 取某 key 的最新可调用 SolverArtifact（PROVISIONAL/ADVISORY_PASSED/GOVERNED）。 */
  private async activeArtifact(tenantId: string, key: string): Promise<SolverArtifact | undefined> {
    const all = (await this.repos.solverArtifacts.list(tenantId, (a) => a.key === key)).sort((a, b) => b.version - a.version);
    return all.find((a) => a.status === "PROVISIONAL" || a.status === "ADVISORY_PASSED" || a.status === "GOVERNED");
  }

  getArtifact(tenantId: string, key: string): Promise<SolverArtifact | undefined> {
    return this.activeArtifact(tenantId, key);
  }

  /**
   * A18.4 审核台：列临时求解器制品（每 key 取最新版本），供人工审核台展示队列（按状态分组/晋升）。
   * 默认全量；status 过滤（如只看 PROVISIONAL 待审）。确定性按 key 排序。
   */
  async listArtifacts(tenantId: string, status?: string): Promise<SolverArtifact[]> {
    const all = await this.repos.solverArtifacts.list(tenantId);
    const latestByKey = new Map<string, SolverArtifact>();
    for (const a of all) {
      const prev = latestByKey.get(a.key);
      if (!prev || a.version > prev.version) latestByKey.set(a.key, a);
    }
    return [...latestByKey.values()]
      .filter((a) => !status || a.status === status)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * A18.3 写真值门控（用户裁决 2026-06-21）：未审核临时件**默认不写真值**（R4）；放宽：**仅创建人**
   * （actor===createdBy）可用自己造的临时件写真值，且写入打"未认证·UNVERIFIED·LLM"标。GOVERNED 件任何人可写。
   * 纯函数，便于 Action 执行层调用 + 单测。返回 {allowed, label?, reason?}。
   */
  static canArtifactWriteTruth(art: SolverArtifact, actorUserId: string): { allowed: boolean; label?: string; reason?: string } {
    if (art.status === "GOVERNED") return { allowed: true };
    if (art.status === "PROVISIONAL" || art.status === "ADVISORY_PASSED") {
      if (actorUserId === art.createdBy) {
        return { allowed: true, label: `审核中·未认证·origin=${art.origin}·trustLevel=${art.trustLevel}` };
      }
      return { allowed: false, reason: `临时求解器 ${art.key} 未审核：仅创建人(${art.createdBy})可用其写真值；他人需先晋升 GOVERNED` };
    }
    return { allowed: false, reason: `求解器 ${art.key} 状态 ${art.status} 不可写真值` };
  }

  /** 经 key + actor 查门控（Action 执行层用；非临时件 key 视为内置正式 → 允许）。 */
  async checkWriteTruth(ctx: AuthCtx, solverKey: string): Promise<{ allowed: boolean; label?: string; reason?: string }> {
    if ((SOLVER_KEYS as readonly string[]).includes(solverKey)) return { allowed: true }; // 内置正式求解器
    const art = await this.activeArtifact(ctx.tenantId, solverKey);
    if (!art) return { allowed: false, reason: `求解器 ${solverKey} 未注册` };
    return SolverService.canArtifactWriteTruth(art, ctx.userId);
  }

  /**
   * A18.4 晋升：把跑通的临时件 PROVISIONAL/ADVISORY_PASSED → GOVERNED（人工审批解锁写真值）。
   * 发 solver.status_changed。逐制品晋升的求解器一环（整域晋升由 databuilder 编排逐项调用）。
   */
  async promoteSolver(ctx: AuthCtx, key: string): Promise<SolverArtifact> {
    const art = await this.activeArtifact(ctx.tenantId, key);
    if (!art) throw notFound("solver artifact");
    if (art.status === "GOVERNED") return art; // 幂等
    const promoted: SolverArtifact = { ...art, status: "GOVERNED", trustLevel: "VERIFIED" };
    await this.repos.solverArtifacts.put(promoted);
    await this.outbox?.emit(ctx.tenantId, "solver.status_changed", { key, from: art.status, to: "GOVERNED" });
    return promoted;
  }

  /** A18.2：在锁死沙箱里执行已注册的 LLM 临时求解器，输出强标 trustLevel/origin（推演可用、写真值另受门控）。 */
  private async invokeArtifact(ctx: AuthCtx, art: SolverArtifact, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sandboxCtx = await this.buildSandboxCtx(ctx.tenantId);
    const r = await runSolverSandbox(art.computeSource, sandboxCtx, args, { timeoutMs: 1500 });
    if (!r.ok) throw validationError(`临时求解器 ${art.key} 沙箱执行失败：${r.error ?? "未知"}`);
    const out = (r.output && typeof r.output === "object" ? r.output : { result: r.output }) as Record<string, unknown>;
    // 强标未审核（R13）：每个临时求解器结果都带 origin/status/trustLevel，绝不冒充正式。
    return { ...out, __provisional: { origin: art.origin, status: art.status, trustLevel: art.trustLevel, solverKey: art.key, version: art.version } };
  }

  /**
   * 通用 what-if（generic_inference，G-5）：包装本体派生引擎 recompute(dryRun+apply)——对任意已发布
   * 本体套假设源属性值、前向重算下游派生链，返回 before/after deltas（不落库、无副作用，确定性 R6）。
   * args.apply: [{objectType,objectId,prop,value}]。非电池专用；growth 缺求解器 B 兜底路由到此。
   */
  private async genericInference(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.ontologyCore) throw validationError("generic_inference 未注入 ontologyCore");
    const apply = Array.isArray(args.apply) ? (args.apply as { objectType: string; objectId: string; prop: string; value: unknown }[]) : [];
    if (apply.length === 0) throw validationError("generic_inference 需 apply:[{objectType,objectId,prop,value}]（假设值）");
    const changes = apply.map((a) => ({ typeKey: a.objectType, prop: a.prop, objectIds: [a.objectId] }));
    const result = await this.ontologyCore.recompute(ctx, changes, { dryRun: true, apply: apply.map((a) => ({ objectId: a.objectId, prop: a.prop, value: a.value })) });
    const deltas = result.dryRunDeltas ?? [];
    return {
      deltas,
      rows: deltas.map((d) => ({ objectId: d.objId, type: d.type, prop: d.prop, before: d.before, after: d.after })),
      affectedObjects: result.updatedObjects,
      count: deltas.length,
      rootTypes: [...new Set(apply.map((a) => a.objectType))],
    };
  }

  /**
   * PRD-fde §8d/Q4 共享瓶颈（净室,零依赖,确定性 R6）：读对象图 → 按 viaField 把 sharedByType 对象分组到
   * resourceType 资源 → 需求和(Σ demandField) > 产能(capacityField) = 瓶颈 → 按 priorityField 判降级。
   * 通用:任意本体经 args 字段映射即用(args: resourceType/sharedByType/viaField/capacityField/demandField/priorityField?)。
   * 答"哪些工序/设备瓶颈、谁挤占谁、哪张单降级"——报表做不到的对象关系+行为规则联合推理。
   */
  private async sharedBottleneck(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const resourceType = str(args.resourceType);
    const sharedByType = str(args.sharedByType);
    const viaField = str(args.viaField);
    const capacityField = args.capacityField ? str(args.capacityField) : "capacity";
    const demandField = args.demandField ? str(args.demandField) : "qty";
    const priorityField = args.priorityField ? str(args.priorityField) : undefined;
    if (!resourceType || !sharedByType || !viaField) throw validationError("shared_bottleneck 需 resourceType/sharedByType/viaField");

    const resources = await this.repos.objects.listByType(ctx.tenantId, resourceType);
    const sharers = await this.repos.objects.listByType(ctx.tenantId, sharedByType);
    const rtype = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === resourceType))[0];
    const stype = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === sharedByType))[0];
    const rPk = rtype?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const sPk = stype?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const keyOf = (o: ObjectInstance, pk?: string) => String((pk ? o.props[pk] : undefined) ?? o.id);
    const resByKey = new Map(resources.map((r) => [keyOf(r, rPk), r]));

    // 分组：每个资源被哪些上游对象共享。
    const byResource = new Map<string, ObjectInstance[]>();
    for (const s of sharers) {
      const rid = String(s.props[viaField] ?? "");
      if (!rid) continue;
      const list = byResource.get(rid) ?? [];
      list.push(s);
      byResource.set(rid, list);
    }

    const bottlenecks: Record<string, unknown>[] = [];
    const contention: Record<string, unknown>[] = [];
    const downgraded: Record<string, unknown>[] = [];
    // 确定性：资源键排序
    for (const rid of [...byResource.keys()].sort()) {
      const demanders = byResource.get(rid)!;
      const res = resByKey.get(rid);
      const capacity = res ? Number(res.props[capacityField]) : NaN;
      const demand = demanders.reduce((acc, d) => acc + (Number(d.props[demandField]) || 0), 0);
      const sharerKeys = demanders.map((d) => keyOf(d, sPk)).sort();
      // 瓶颈：有产能且需求和 > 产能,且 ≥2 个争用者(共享)。
      if (Number.isFinite(capacity) && demand > capacity && demanders.length >= 2) {
        bottlenecks.push({ resourceType, resourceId: rid, capacity, demand, sharerCount: demanders.length });
        contention.push({ resourceId: rid, sharers: sharerKeys });
        // 降级：优先级最低者(priorityField 升序;缺则需求最小者),确定性 tiebreak by key。
        const ranked = [...demanders].sort((a, b) => {
          const pa = priorityField ? Number(a.props[priorityField]) || 0 : Number(a.props[demandField]) || 0;
          const pb = priorityField ? Number(b.props[priorityField]) || 0 : Number(b.props[demandField]) || 0;
          return pa - pb || keyOf(a, sPk).localeCompare(keyOf(b, sPk));
        });
        downgraded.push({ resourceId: rid, sharedByType, objectId: keyOf(ranked[0]!, sPk), reason: priorityField ? "优先级最低" : "需求最小" });
      }
    }
    return {
      bottlenecks,
      contention,
      downgraded,
      summary: `${bottlenecks.length} 个共享瓶颈,${contention.reduce((a, c) => a + (c.sharers as string[]).length, 0)} 张单争用,${downgraded.length} 张被降级`,
    };
  }

  /**
   * PRD-fde §8c/Q5 隐性集中度（净室,零依赖,确定性 R6）：沿多跳 ref 路径把 startType 对象反向聚合到
   * 终端 rootType,找出"多个看似分散的起点都依赖同一个根"的隐性单点（如客户→订单→物料→二级供应商：
   * 哪个二级供应商被最多客户隐性依赖）。报表按客户/产品/区域切永远切不出这条暗线。
   * args: { startType, path:[{viaField,toType}], minDependents? }。
   */
  private async concentrationRisk(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const startType = str(args.startType);
    const path = Array.isArray(args.path) ? (args.path as { viaField: string; toType: string }[]) : [];
    const minDependents = Number(args.minDependents ?? 2);
    if (!startType || path.length === 0) throw validationError("concentration_risk 需 startType + path:[{viaField,toType}]");

    // 每个路径目标类型预建 PK→对象 索引（多跳遍历用）。
    const idxByType = new Map<string, Map<string, ObjectInstance>>();
    for (const hop of path) {
      if (idxByType.has(hop.toType)) continue;
      const objs = await this.repos.objects.listByType(ctx.tenantId, hop.toType);
      const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === hop.toType))[0];
      const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
      idxByType.set(hop.toType, new Map(objs.map((o) => [String((pk ? o.props[pk] : undefined) ?? o.id), o])));
    }
    const sdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === startType))[0];
    const sPk = sdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const starts = await this.repos.objects.listByType(ctx.tenantId, startType);
    const keyOf = (o: ObjectInstance, pk?: string) => String((pk ? o.props[pk] : undefined) ?? o.id);

    // 每个起点沿路径走到终端根；断链(中途 ref 解析不到)则跳过。
    const byRoot = new Map<string, Set<string>>();
    for (const s of starts) {
      let cur: ObjectInstance | undefined = s;
      for (const hop of path) {
        const refVal = String(cur!.props[hop.viaField] ?? "");
        cur = idxByType.get(hop.toType)!.get(refVal);
        if (!cur) break;
      }
      if (!cur || cur === s) continue;
      const rootKey = keyOf(cur);
      const set = byRoot.get(rootKey) ?? new Set<string>();
      set.add(keyOf(s, sPk));
      byRoot.set(rootKey, set);
    }
    const rootType = path[path.length - 1]!.toType;
    const concentrations = [...byRoot.entries()]
      .filter(([, deps]) => deps.size >= minDependents)
      .map(([rootId, deps]) => ({ rootType, rootId, dependents: [...deps].sort(), count: deps.size }))
      .sort((a, b) => b.count - a.count || a.rootId.localeCompare(b.rootId));
    return {
      concentrations,
      topExposure: concentrations[0] ?? null,
      summary: `${concentrations.length} 个隐性集中单点（${rootType}）,最大敞口 ${concentrations[0]?.count ?? 0} 个依赖方`,
    };
  }

  /**
   * PRD-fde §8 Q3 毛利倒挂根因归因（净室,零依赖,确定性 R6）：把每个目标对象的成本拆成多个成本项,
   * 算出毛利/毛利率,标记"倒挂"(毛利率 < 阈值,默认 0 即亏本),并按成本项占比定位**主驱动**——
   * 报表只给"毛利为负"的总数,切不出"是哪个成本项把它拉穿的";本求解器跨整个倒挂群聚合出根因驱动。
   * args: { targetType, revenueField?, costFields:[{field,label?}], marginThreshold?, sign? }。
   */
  private async marginAttribution(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const targetType = str(args.targetType);
    const revenueField = str(args.revenueField, "revenue");
    const costFields = Array.isArray(args.costFields) ? (args.costFields as { field: string; label?: string }[]) : [];
    const marginThreshold = num(args.marginThreshold, 0);
    if (!targetType || costFields.length === 0) throw validationError("margin_attribution 需 targetType + costFields:[{field,label?}]");

    const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === targetType))[0];
    const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const objs = await this.repos.objects.listByType(ctx.tenantId, targetType);

    const inverted: {
      id: string; revenue: number; totalCost: number; margin: number; marginRate: number;
      topDriver: { label: string; value: number; share: number } | null;
      attribution: { label: string; value: number; share: number }[];
    }[] = [];
    for (const o of objs) {
      const id = String((pk ? o.props[pk] : undefined) ?? o.id);
      const revenue = num(o.props[revenueField]);
      const comps = costFields.map((cf) => ({ label: cf.label ?? cf.field, value: num(o.props[cf.field]) }));
      const totalCost = comps.reduce((s, c) => s + c.value, 0);
      const margin = round(revenue - totalCost, 6);
      const marginRate = revenue !== 0 ? round(margin / revenue, 6) : margin < 0 ? -1 : 0;
      if (marginRate >= marginThreshold) continue; // 未倒挂
      const attribution = comps
        .map((c) => ({ label: c.label, value: c.value, share: totalCost !== 0 ? round(c.value / totalCost, 6) : 0 }))
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      inverted.push({ id, revenue, totalCost, margin, marginRate, topDriver: attribution[0] ?? null, attribution });
    }
    inverted.sort((a, b) => a.marginRate - b.marginRate || a.id.localeCompare(b.id));

    // 跨整个倒挂群聚合根因驱动：某成本项作为主驱动出现的次数 + 累计金额。
    const driverAgg = new Map<string, { label: string; invertedCount: number; totalValue: number }>();
    for (const row of inverted) {
      if (!row.topDriver) continue;
      const d = driverAgg.get(row.topDriver.label) ?? { label: row.topDriver.label, invertedCount: 0, totalValue: 0 };
      d.invertedCount += 1;
      d.totalValue = round(d.totalValue + row.topDriver.value, 6);
      driverAgg.set(row.topDriver.label, d);
    }
    const rootDrivers = [...driverAgg.values()].sort((a, b) => b.invertedCount - a.invertedCount || b.totalValue - a.totalValue || a.label.localeCompare(b.label));
    return {
      inverted,
      rootDrivers,
      invertedCount: inverted.length,
      summary: `${inverted.length} 个目标毛利倒挂；根因主驱动 ${rootDrivers[0]?.label ?? "—"}（拉穿 ${rootDrivers[0]?.invertedCount ?? 0} 个）`,
    };
  }

  /**
   * cockpit P2 规划决策推演 · 根因归因 DAG（净室读对象图,确定性 R6,「结构=算、模板=配成对象」）：
   * 经营 KPI（PlanKpi）越线 → 按 RootCauseChain 归因模板沿 driverType 取活数据逐层取证 →
   * 产出多根 DAG（kpi 越线根 → factor 因子 → evidence 取证叶）,每条边权重=贡献占比（活数据聚合算出,非写死）。
   * 报表只会告诉你"毛利率低了",这里把"为什么低、低在哪个因子、证据是哪些细分/物料"沿因果链量化展开。
   * args: { kpiCategory? }（指定单一 KPI 类别；缺省=所有越线 KPI；全部达标则取最弱一个,DAG 恒有内容）。
   */
  private async planRootcause(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    // SPINE 归一：经营指标读 Metric 一等对象（PlanKpi 已归一为 Metric）。
    const kpiObjs = await this.repos.objects.listByType(ctx.tenantId, "Metric");
    const chainObjs = await this.repos.objects.listByType(ctx.tenantId, "RootCauseChain");
    if (kpiObjs.length === 0) throw validationError("plan_rootcause 需先合成 Metric（经营指标）对象");
    const onlyCategory = args.kpiCategory ? str(args.kpiCategory) : undefined;

    // 1) 指标越线判定（actual < floorVal；缺口 gap=target-actual，确定性按 metricId 排序）。
    const kpis = kpiObjs
      .map((o) => o.props)
      .filter((p) => !onlyCategory || str(p.category) === onlyCategory)
      .map((p) => {
        const actual = num(p.actual);
        const target = num(p.target);
        const floorVal = num(p.floorVal);
        const offTarget = actual < floorVal;
        return {
          kpiId: str(p.metricId), name: str(p.name), category: str(p.category),
          actual, target, floorVal, unit: str(p.unit),
          gap: round(target - actual, 4), offTarget,
          status: offTarget ? "RED" : actual < target ? "AMBER" : "GREEN",
        };
      })
      .sort((a, b) => a.kpiId.localeCompare(b.kpiId));

    // 2) 选定要归因的 KPI：越线者；若全达标则取最弱一个（actual/target 最低）→ DAG 恒有内容（"最大风险"）。
    let roots = kpis.filter((k) => k.offTarget);
    if (roots.length === 0 && kpis.length > 0) {
      roots = [[...kpis].sort((a, b) => a.actual / a.target - b.actual / b.target || a.kpiId.localeCompare(b.kpiId))[0]!];
    }

    // 3) 沿归因模板逐层取证（driverType 活数据聚合 → 因子贡献 → 取证叶，贡献占比 = 边权重）。
    const nodes: Record<string, unknown>[] = [];
    const edges: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const addNode = (n: Record<string, unknown>) => { if (!seen.has(n.id as string)) { seen.add(n.id as string); nodes.push(n); } };
    const driverCache = new Map<string, { props: Record<string, unknown> }[]>();
    const loadDriver = async (type: string) => {
      if (!driverCache.has(type)) driverCache.set(type, (await this.repos.objects.listByType(ctx.tenantId, type)).map((o) => ({ props: o.props })));
      return driverCache.get(type)!;
    };
    const MAX_LEAVES = 4;

    for (const k of roots) {
      addNode({ id: `kpi:${k.kpiId}`, kind: "kpi", label: k.name, value: k.gap, actual: k.actual, target: k.target, status: k.status, unit: k.unit });
      const chains = chainObjs.map((o) => o.props).filter((c) => str(c.kpiCategory) === k.category).sort((a, b) => str(a.chainId).localeCompare(str(b.chainId)));
      // 每因子贡献 = driverType 对象 evidenceField 之和 × baseWeight（活数据量化，非写死）。
      const factors: { chainId: string; factor: string; contribution: number; leaves: { id: string; label: string; value: number }[] }[] = [];
      for (const c of chains) {
        const driverType = str(c.driverType);
        const evidenceField = str(c.evidenceField);
        const selectField = str(c.selectField);
        const rows = await loadDriver(driverType);
        const leaves = rows
          .map((r) => ({ id: `${str(c.chainId)}:${str(r.props[selectField] ?? "?")}`, label: str(r.props[selectField] ?? "?"), value: round(Math.abs(num(r.props[evidenceField])), 4) }))
          .filter((l) => l.value > 0)
          .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
          .slice(0, MAX_LEAVES);
        const contribution = round(leaves.reduce((s, l) => s + l.value, 0) * num(c.baseWeight, 1), 4);
        if (contribution > 0) factors.push({ chainId: str(c.chainId), factor: str(c.factor), contribution, leaves });
      }
      const totalContribution = factors.reduce((s, f) => s + f.contribution, 0);
      for (const f of factors) {
        const share = totalContribution > 0 ? round(f.contribution / totalContribution, 4) : 0;
        addNode({ id: `factor:${f.chainId}`, kind: "factor", label: f.factor, value: f.contribution, share });
        edges.push({ from: `kpi:${k.kpiId}`, to: `factor:${f.chainId}`, weight: share, kind: "kpi_factor" });
        for (const l of f.leaves) {
          addNode({ id: `leaf:${l.id}`, kind: "evidence", label: l.label, value: l.value });
          edges.push({ from: `factor:${f.chainId}`, to: `leaf:${l.id}`, weight: f.contribution > 0 ? round(l.value / f.contribution, 4) : 0, kind: "factor_evidence" });
        }
      }
    }

    const offTargetCount = kpis.filter((k) => k.offTarget).length;
    const worst = roots[0];
    return {
      kpis,
      dag: { nodes, edges },
      offTargetCount,
      summary: `${offTargetCount} 项 KPI 越线；归因根「${worst?.name ?? "—"}」缺口 ${worst?.gap ?? 0}${worst?.unit ?? ""}，沿 ${nodes.filter((n) => n.kind === "factor").length} 个因子展开取证`,
      ruleRefs: [],
    };
  }

  /**
   * SPINE 经营目标-指标-责任骨架 · metric_rollup（净室读对象图,确定性 R6,派生投影非新真值 R13）：
   * 从对象库读 Metric 一等对象 → target 对齐目标树(若 metric.key 命中 PlanTarget.period 则取其 value，否则用 Metric.target)
   * → actual 取 Metric.actual（已由合成 P1 同源数据算出/或数据源派生）→ 算 delta=actual−target、miss=actual<floorVal。
   * 输出 Metric[] + 越线数 + 按 level 分布。各视图 KPI 读此单一出处（R-一致）。args: { level? }。
   */
  private async metricRollup(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const metricObjs = await this.repos.objects.listByType(ctx.tenantId, "Metric");
    if (metricObjs.length === 0) throw validationError("metric_rollup 需先合成 Metric（经营指标）对象");
    const onlyLevel = args.level ? str(args.level) : undefined;
    const planTargets = await this.repos.objects.listByType(ctx.tenantId, "PlanTarget");
    const targetByKey = new Map(planTargets.map((t) => [str(t.props.period), num(t.props.value)]));

    const metrics = metricObjs
      .map((o) => o.props)
      .filter((p) => !onlyLevel || str(p.level) === onlyLevel)
      .map((p) => {
        const actual = num(p.actual);
        // target 优先对齐目标树（PlanTarget），命中则取，否则用 Metric 自带 target（不复制第二口径）。
        const target = targetByKey.has(str(p.key)) ? targetByKey.get(str(p.key))! : num(p.target);
        const floorVal = p.floorVal !== undefined ? num(p.floorVal) : target;
        return {
          metricId: str(p.metricId), key: str(p.key), name: str(p.name), unit: str(p.unit),
          level: str(p.level), category: str(p.category), target, actual,
          delta: round(actual - target, 4), miss: actual < floorVal, floorVal,
          ksfRef: p.ksfRef ?? null, ownerRef: p.ownerRef ?? null, chainKey: str(p.chainKey),
        };
      })
      .sort((a, b) => a.metricId.localeCompare(b.metricId));

    const byLevel: Record<string, number> = {};
    for (const m of metrics) byLevel[m.level] = (byLevel[m.level] ?? 0) + 1;
    const missCount = metrics.filter((m) => m.miss).length;
    return {
      metrics,
      missCount,
      byLevel,
      summary: `${metrics.length} 项指标，${missCount} 项越线（按 level：${Object.entries(byLevel).map(([k, v]) => `${k}:${v}`).join(" ")}）`,
    };
  }

  /**
   * PRD-fde §8 Q2 单一供应商断供的影响半径（净室,零依赖,确定性 R6）：从断供根（如某二级供应商）
   * 沿"谁引用我"的反向多跳逐层扇出——物料→订单→客户，逐层算出受冲击集合、扩散半径（穿透层数）、
   * 叶层敞口。与 concentration_risk（多源收敛到一根）互为反向：这里是一根扇出冲击多个叶子。
   * args: { rootType, rootId, layers:[{type, viaField}] }（每层 type 对象的 viaField 引用上一层的主键/根）。
   */
  private async supplierDisruptionRadius(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const rootType = str(args.rootType);
    const rootId = str(args.rootId);
    const layers = Array.isArray(args.layers) ? (args.layers as { type: string; viaField: string }[]) : [];
    if (!rootType || !rootId || layers.length === 0) throw validationError("supplier_disruption_radius 需 rootType + rootId + layers:[{type,viaField}]");

    let frontier = new Set<string>([rootId]); // 当前层可被引用的"上一层主键"集合
    const result: { type: string; viaField: string; count: number; ids: string[] }[] = [];
    let radius = 0;
    for (const layer of layers) {
      const objs = await this.repos.objects.listByType(ctx.tenantId, layer.type);
      const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === layer.type))[0];
      const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
      const hit = objs.filter((o) => frontier.has(String(o.props[layer.viaField] ?? "")));
      const ids = hit.map((o) => String((pk ? o.props[pk] : undefined) ?? o.id)).sort();
      result.push({ type: layer.type, viaField: layer.viaField, count: ids.length, ids });
      if (ids.length > 0) radius += 1; // 半径 = 实际穿透到的层数
      frontier = new Set(ids);
      if (ids.length === 0) break; // 断链：再深的层不会有受冲击对象
    }
    const leaf = result[result.length - 1];
    const totalAffected = result.reduce((s, l) => s + l.count, 0);
    return {
      rootType,
      rootId,
      layers: result,
      radius,
      totalAffected,
      leafType: leaf?.type ?? null,
      leafCount: leaf?.count ?? 0,
      summary: `断供「${rootId}」影响半径 ${radius} 层、波及 ${totalAffected} 个对象；叶层 ${leaf?.type ?? "—"} ${leaf?.count ?? 0} 个`,
    };
  }

  /**
   * PRD-fde §8d 组合最优化（CP-SAT sidecar 代理）：通用 0/1 选择最优化（背包族）——从对象图取候选项
   * （itemType 的 valueField/weightField），在 Σweight≤budget（及可选 maxCount/minValue）下最大化 Σvalue。
   * 贪心/启发式对 0/1 背包不保证最优,这里走 OR-Tools CP-SAT 给**可证最优**——TS 解不动的"复杂推演"。
   * 数据不出边界（自托管 sidecar）。args: { itemType, valueField?, weightField?, budget, maxCount?, minValue?, seed? }。
   */
  private async selectionOptimize(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const itemType = str(args.itemType);
    const valueField = str(args.valueField, "value");
    const weightField = str(args.weightField, "weight");
    if (!itemType || args.budget === undefined) throw validationError("selection_optimize 需 itemType + budget（+ valueField/weightField）");
    if (!this.optimizer) throw validationError("selection_optimize 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const budget = num(args.budget);

    const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === itemType))[0];
    const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const objs = await this.repos.objects.listByType(ctx.tenantId, itemType);
    const items = objs
      .map((o) => ({ id: String((pk ? o.props[pk] : undefined) ?? o.id), value: num(o.props[valueField]), weight: num(o.props[weightField]) }))
      .sort((a, b) => a.id.localeCompare(b.id)); // 稳定输入序 → 确定性 R6

    const result = await this.optimizer.solve({
      model: "selection",
      seed: Number(args.seed ?? 42),
      items,
      budget,
      maxCount: args.maxCount === undefined ? undefined : Number(args.maxCount),
      minValue: args.minValue === undefined ? undefined : Number(args.minValue),
    });
    return {
      status: result.status,
      optimal: result.optimal,
      selected: [...result.selected].sort(),
      totalValue: result.totalValue,
      totalWeight: result.totalWeight,
      itemType,
      budget,
      candidateCount: items.length,
      summary: `最优选 ${result.selected.length}/${items.length} 项,总价值 ${result.totalValue}（${result.optimal ? "可证最优" : result.status === "INFEASIBLE" ? "不可行" : "可行解"}）`,
    };
  }

  /**
   * A8.1 指派最优化（CP-SAT sidecar 代理）：把 itemType 对象指派到 binType 对象（订单→基地/产线），
   * 每 item 一指派、Σweight ≤ bin.capacity、按 (item,bin) 成本最小化（资格 mask=缺成本对不可指派）。
   * 贪心给不出全局最优,走 OR-Tools CP-SAT 可证最优；数据不出边界。未配 OPTIMIZER_BASE_URL → 显式"未接入"不兜底。
   * args: { itemType, binType, weightField?, capacityField?, costField?(item 上每 bin 同成本) | costMatrix?, seed? }。
   */
  private async assignmentOptimize(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const itemType = str(args.itemType);
    const binType = str(args.binType);
    const weightField = str(args.weightField, "weight");
    const capacityField = str(args.capacityField, "capacity");
    const costField = str(args.costField, "cost");
    if (!itemType || !binType) throw validationError("assignment_optimize 需 itemType + binType（+ weightField/capacityField/costField）");
    if (!this.optimizer?.solveAssignment) throw validationError("assignment_optimize 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");

    const pkOf = async (type: string): Promise<string | undefined> =>
      (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === type))[0]?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const itemPk = await pkOf(itemType);
    const binPk = await pkOf(binType);
    const itemObjs = (await this.repos.objects.listByType(ctx.tenantId, itemType)).sort((a, b) => a.id.localeCompare(b.id));
    const binObjs = (await this.repos.objects.listByType(ctx.tenantId, binType)).sort((a, b) => a.id.localeCompare(b.id));
    const items = itemObjs.map((o) => ({ id: String((itemPk ? o.props[itemPk] : undefined) ?? o.id), weight: num(o.props[weightField]) }));
    const bins = binObjs.map((o) => ({ id: String((binPk ? o.props[binPk] : undefined) ?? o.id), capacity: num(o.props[capacityField]) }));
    // 成本：每 item 携带一个 costField 标量 → 对所有 bin 同成本（默认完全图，资格全开）。
    const costs = items.flatMap((it) => bins.map((b) => ({ item: it.id, bin: b.id, cost: num(itemObjs.find((o) => String((itemPk ? o.props[itemPk] : undefined) ?? o.id) === it.id)?.props[costField] ?? 1) })));

    const result = await this.optimizer.solveAssignment({ model: "assignment", seed: Number(args.seed ?? 42), items, bins, costs });
    return {
      status: result.status,
      optimal: result.optimal,
      assignments: [...result.assignments].sort((a, b) => a.item.localeCompare(b.item)),
      objective: result.objective,
      itemType,
      binType,
      itemCount: items.length,
      binCount: bins.length,
      summary: `指派 ${result.assignments.length}/${items.length} 个${itemType}到${bins.length}个${binType}，总成本 ${result.objective}（${result.optimal ? "可证最优" : result.status === "INFEASIBLE" ? "不可行" : "可行解"}）`,
    };
  }

  /**
   * A8.2 排序最优化（CP-SAT sidecar 代理）：把 jobType 对象按 groupField 排序，最小化相邻 group 换型损失。
   * args: { jobType, groupField, seed? }（换型矩阵默认 = 不同 group 计 1）。未配引擎 → 显式"未接入"。
   */
  private async sequencingOptimize(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const jobType = str(args.jobType);
    const groupField = str(args.groupField, "group");
    if (!jobType) throw validationError("sequencing_optimize 需 jobType（+ groupField）");
    if (!this.optimizer?.solveSequencing) throw validationError("sequencing_optimize 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === jobType))[0];
    const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const objs = (await this.repos.objects.listByType(ctx.tenantId, jobType)).sort((a, b) => a.id.localeCompare(b.id));
    const jobs = objs.map((o) => ({ id: String((pk ? o.props[pk] : undefined) ?? o.id), group: String(o.props[groupField] ?? "") }));
    const result = await this.optimizer.solveSequencing({ model: "sequencing", seed: Number(args.seed ?? 42), jobs });
    return {
      status: result.status,
      optimal: result.optimal,
      sequence: result.sequence,
      changeovers: result.changeovers,
      objective: result.objective,
      jobType,
      jobCount: jobs.length,
      summary: `${jobs.length} 个${jobType}最优排序，换型 ${result.changeovers} 次（${result.optimal ? "可证最优" : result.status === "INFEASIBLE" ? "不可行" : "可行解"}）`,
    };
  }

  /**
   * A8.3 装箱最优化（CP-SAT sidecar 代理）：把 itemType 对象（sizeField）装入容量 binCapacity 的箱，最小化箱数。
   * args: { itemType, sizeField?, binCapacity, seed? }。未配引擎 → 显式"未接入"。
   */
  private async packingOptimize(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const itemType = str(args.itemType);
    const sizeField = str(args.sizeField, "size");
    if (!itemType || args.binCapacity === undefined) throw validationError("packing_optimize 需 itemType + binCapacity（+ sizeField）");
    if (!this.optimizer?.solvePacking) throw validationError("packing_optimize 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const binCapacity = num(args.binCapacity);
    const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === itemType))[0];
    const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const objs = (await this.repos.objects.listByType(ctx.tenantId, itemType)).sort((a, b) => a.id.localeCompare(b.id));
    const items = objs.map((o) => ({ id: String((pk ? o.props[pk] : undefined) ?? o.id), size: num(o.props[sizeField]) }));
    const result = await this.optimizer.solvePacking({ model: "packing", seed: Number(args.seed ?? 42), items, binCapacity });
    return {
      status: result.status,
      optimal: result.optimal,
      bins: result.bins,
      binCount: result.binCount,
      objective: result.objective,
      itemType,
      itemCount: items.length,
      binCapacity,
      summary: `${items.length} 个${itemType}装入 ${result.binCount} 个箱（容量 ${binCapacity}，${result.optimal ? "可证最优" : result.status === "INFEASIBLE" ? "不可行" : "可行解"}）`,
    };
  }

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
    // A18.2：内置求解器优先；非内置 key 若有已注册 SolverArtifact（PROVISIONAL+），走锁死沙箱执行（强标未验证）。
    if (!(SOLVER_KEYS as readonly string[]).includes(solverKey)) {
      const art = await this.activeArtifact(ctx.tenantId, solverKey);
      if (art) return this.invokeArtifact(ctx, art, args);
    }
    // generic_inference 走本体派生引擎（非纯 compute；需对象图 + recompute），先于 loadContext 拦截。
    if (solverKey === "generic_inference") return this.genericInference(ctx, args);
    // shared_bottleneck 通用求解器（读任意对象图,非电池 context）,同样先拦截。
    if (solverKey === "shared_bottleneck") return this.sharedBottleneck(ctx, args);
    if (solverKey === "concentration_risk") return this.concentrationRisk(ctx, args);
    if (solverKey === "margin_attribution") return this.marginAttribution(ctx, args);
    if (solverKey === "plan_rootcause") return this.planRootcause(ctx, args);
    if (solverKey === "metric_rollup") return this.metricRollup(ctx, args);
    if (solverKey === "supplier_disruption_radius") return this.supplierDisruptionRadius(ctx, args);
    if (solverKey === "selection_optimize") return this.selectionOptimize(ctx, args);    if (solverKey === "assignment_optimize") return this.assignmentOptimize(ctx, args);
    if (solverKey === "sequencing_optimize") return this.sequencingOptimize(ctx, args);
    if (solverKey === "packing_optimize") return this.packingOptimize(ctx, args);
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
