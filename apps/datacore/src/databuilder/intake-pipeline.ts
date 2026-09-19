// 数据接入/导入的 pipeline 执行（仓主原话：「只要数据接入或导入，就按照这个 pipeline 处理数据」）。
//
// 改造前：/a/v1/databuilder/intake 与 /intake/import 在路由里直连
//   parsePrototypeHtml → reconcileIntake → RawDataset —— 零 pipeline 引用（写死）。
// 改造后：两条路由都先 resolve 出当前生效的 BuildPipeline 定义，再按其**节点序列 + 每节点 SOP**执行。
//   改 pipeline 定义（删节点/停用/改顺序/改失败策略）⇒ 这两个接入口的实际处理行为立刻跟着变。
//
// SOP 执行语义复用 workflow-engine 的 executeStepWithSop（同一份实现，不另抄一套策略判断）。
import type { AuthCtx, RawDataset } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";
import type { OntologyService } from "../ontology.js";
import type { ConnectorService } from "../connectors/service.js";
import type { BuildPipeline, IntakeResult, ReconcilePreview, SchemaReconcileCandidate } from "@platform/contracts";
import { executeStepWithSop, type StepContext, type WorkflowStepDef } from "./workflow-engine.js";
import { resolvePipelineSteps, type StepRegistry } from "./pipeline-defs.js";
import { parsePrototypeHtml, reconcileIntake, type ExistingTypeField } from "./prototype-intake.js";

/** 一次 pipeline 执行的步记录（可观测：每步跑没跑、跑了几次、什么结果）。 */
export interface PipelineStepRecord {
  stepKey: string;
  title: string;
  status: "SUCCEEDED" | "SKIPPED" | "FAILED";
  attempts: number;
  detail?: string;
  error?: string;
}

export interface PipelineRunResult {
  context: StepContext;
  steps: PipelineStepRecord[];
  status: "SUCCEEDED" | "FAILED";
  error?: string;
}

/**
 * 轻量 pipeline 执行器（同步 HTTP 语境，不落 BuildWorkflowRun）：按解析出的步骤序列逐步执行，
 * context 跨步累积。失败语义由节点 SOP 决定（executeStepWithSop 共用实现）。
 * 人工介入（requiresHumanApproval）在同步接入口语境下表现为**该步停下**并把 run 标 FAILED —— 诚实暴露
 * 「这条链路配了要人批但同步口无处可批」，不假装跑通。
 */
export async function runPipelineSteps(
  steps: WorkflowStepDef[],
  initialContext: StepContext = {},
  backoffMs: (attempt: number) => number = (a) => Math.min(2000, 100 * 2 ** (a - 1)),
): Promise<PipelineRunResult> {
  let context: StepContext = { ...initialContext };
  const records: PipelineStepRecord[] = [];
  for (const def of steps) {
    if (def.requiresApproval) {
      records.push({ stepKey: def.stepKey, title: def.title, status: "FAILED", attempts: 0, error: "该节点 SOP 要求人工介入，但同步接入口无法在此暂停" });
      return { context, steps: records, status: "FAILED", error: `step ${def.stepKey} requires human approval` };
    }
    const outcome = await executeStepWithSop(def, context, { maxAttempts: def.maxAttempts ?? 1, backoffMs });
    if (outcome.kind === "done") {
      const r = outcome.result;
      if (r.patch) context = { ...context, ...r.patch };
      records.push({ stepKey: def.stepKey, title: def.title, status: r.skip ? "SKIPPED" : "SUCCEEDED", attempts: outcome.attempts, detail: r.detail });
    } else if (outcome.kind === "skipped") {
      records.push({ stepKey: def.stepKey, title: def.title, status: "SKIPPED", attempts: outcome.attempts, detail: outcome.detail });
    } else {
      const msg = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      records.push({ stepKey: def.stepKey, title: def.title, status: "FAILED", attempts: outcome.attempts, error: msg });
      return { context, steps: records, status: "FAILED", error: `step ${def.stepKey} failed: ${msg}` };
    }
  }
  return { context, steps: records, status: "SUCCEEDED" };
}

export interface IntakeDeps {
  repos: Repos;
  ontology: OntologyService;
  connectors: ConnectorService;
  outbox?: OutboxService;
}

/** pipeline 执行摘要（响应里回带 → 前端/审计一眼看出「这次是按哪条 pipeline 跑的、每步跑没跑」）。 */
export interface PipelineTrace {
  kind: BuildPipeline["kind"];
  name: string;
  factory: boolean;
  steps: PipelineStepRecord[];
}

const trace = (p: BuildPipeline, r: PipelineRunResult): PipelineTrace => ({ kind: p.kind, name: p.name, factory: p.factory, steps: r.steps });

// ---------------------------------------------------------------------------
// 数据接入（POST /a/v1/databuilder/intake）步骤实现注册表
// ---------------------------------------------------------------------------

export interface IntakeOutcome {
  intake: IntakeResult;
  reconcile: ReconcilePreview;
  pipeline: PipelineTrace;
}

/** 空结果：某步被停用/跳过时的诚实缺省（不假装有数据）。 */
const EMPTY_INTAKE: IntakeResult = { dataSources: [], links: [], unparsed: [] };
const EMPTY_RECONCILE: ReconcilePreview = { autoMapped: [], candidates: [] };

export function intakeStepRegistry(deps: IntakeDeps, ctx: AuthCtx, input: { html: string }): StepRegistry {
  return {
    intake_parse: {
      title: "解析：确定性抽取原型内嵌数据表 + 关系",
      run: async () => {
        const intake = parsePrototypeHtml(input.html);
        return {
          detail: `datasets=${intake.dataSources.length} links=${intake.links.length} unparsed=${intake.unparsed.length}`,
          patch: { intake },
        };
      },
    },
    intake_reconcile: {
      title: "字段对账：原型列 ↔ 既有本体字段",
      run: async (c) => {
        const intake = (c["intake"] as IntakeResult | undefined) ?? EMPTY_INTAKE;
        const existing: ExistingTypeField[] = (await deps.ontology.listTypes(ctx)).flatMap((t) =>
          t.properties.map((p) => ({ typeKey: t.key, propKey: p.propKey })),
        );
        const reconcile = reconcileIntake(intake.dataSources, existing);
        return {
          detail: `autoMapped=${reconcile.autoMapped.length} candidates=${reconcile.candidates.length}`,
          patch: { reconcile },
        };
      },
    },
    intake_persist_candidates: {
      title: "落对账队列：候选入 HITL 队列等人确认",
      run: async (c) => {
        const reconcile = (c["reconcile"] as ReconcilePreview | undefined) ?? EMPTY_RECONCILE;
        const stamp = Date.now();
        const persisted: (SchemaReconcileCandidate & { id: string; tenantId: string })[] = [];
        for (const [i, cand] of reconcile.candidates.entries()) {
          const rec = { ...cand, id: `rcc_${ctx.tenantId}_${stamp}_${i}`, tenantId: ctx.tenantId };
          await deps.repos.reconcileCandidates.put(rec);
          persisted.push(rec);
        }
        return { detail: `persisted=${persisted.length}`, patch: { persistedCandidates: persisted } };
      },
    },
    intake_emit: {
      title: "发事件：prototype.intake_recorded",
      run: async (c) => {
        const intake = (c["intake"] as IntakeResult | undefined) ?? EMPTY_INTAKE;
        const persisted = (c["persistedCandidates"] as unknown[] | undefined) ?? [];
        await deps.outbox?.emit(ctx.tenantId, "prototype.intake_recorded", {
          datasets: intake.dataSources.length,
          links: intake.links.length,
          unparsed: intake.unparsed.length,
          candidates: persisted.length,
        });
        return { detail: "emitted" };
      },
    },
  };
}

/**
 * 数据接入正门：**按 pipeline 处理数据**（改造前是路由里写死的三连调用）。
 * 响应形状与改造前一致（intake / reconcile），额外回带 pipeline 执行轨迹。
 */
export async function runIntakePipeline(deps: IntakeDeps, pipeline: BuildPipeline, ctx: AuthCtx, input: { html: string }): Promise<IntakeOutcome> {
  const steps = resolvePipelineSteps(pipeline, intakeStepRegistry(deps, ctx, input));
  const run = await runPipelineSteps(steps);
  if (run.status === "FAILED") throw new Error(run.error ?? "intake pipeline failed");
  const intake = (run.context["intake"] as IntakeResult | undefined) ?? EMPTY_INTAKE;
  const reconcile = (run.context["reconcile"] as ReconcilePreview | undefined) ?? EMPTY_RECONCILE;
  // 落库过就回带带 id 的候选（HITL 队列可查）；没落库过则回带原始候选（诚实：无 id = 未入队）。
  const persisted = run.context["persistedCandidates"] as SchemaReconcileCandidate[] | undefined;
  return {
    intake,
    reconcile: { ...reconcile, candidates: persisted ?? reconcile.candidates },
    pipeline: trace(pipeline, run),
  };
}

// ---------------------------------------------------------------------------
// 数据导入（POST /a/v1/databuilder/intake/import）步骤实现注册表
// ---------------------------------------------------------------------------

export interface ImportDatasetView {
  id: string;
  name: string;
  rowCount: number;
  fields: string[];
}

export interface IntakeImportOutcome {
  connection: unknown;
  datasets: ImportDatasetView[];
  rowCounts: Record<string, number>;
  pipeline: PipelineTrace;
}

export function intakeImportStepRegistry(deps: IntakeDeps, ctx: AuthCtx, input: { filename: string; html: string }): StepRegistry {
  return {
    import_materialize: {
      title: "物化进库：经 prototype_html 连接器落 RawDataset",
      run: async () => {
        const result = await deps.connectors.importPrototype(ctx, input.filename, input.html);
        return {
          detail: `connId=${result.connection.id} rows=${Object.values(result.rowCounts).reduce((a, b) => a + b, 0)}`,
          patch: { connection: result.connection, connId: result.connection.id, rowCounts: result.rowCounts },
        };
      },
    },
    import_project_datasets: {
      title: "投影表清单：列出该连接下的 RawDataset",
      run: async (c) => {
        const connId = c["connId"] as string | undefined;
        if (!connId) return { skip: true, detail: "无 connId（上游未物化）→ 跳过" };
        const datasets: ImportDatasetView[] = (await deps.connectors.listRawDatasets(ctx, connId)).map((d: RawDataset) => ({
          id: d.id,
          name: d.name,
          rowCount: d.rowCount,
          fields: d.fields.map((f: { name: string }) => f.name),
        }));
        return { detail: `datasets=${datasets.length}`, patch: { datasets } };
      },
    },
    import_emit: {
      title: "发事件：prototype.materialized",
      run: async (c) => {
        const connId = c["connId"] as string | undefined;
        const datasets = (c["datasets"] as ImportDatasetView[] | undefined) ?? [];
        const rowCounts = (c["rowCounts"] as Record<string, number> | undefined) ?? {};
        await deps.outbox?.emit(ctx.tenantId, "prototype.materialized", {
          connId: connId ?? null,
          datasets: datasets.length,
          rows: Object.values(rowCounts).reduce((a, b) => a + b, 0),
        });
        return { detail: "emitted" };
      },
    },
  };
}

/** 数据导入正门：**按 pipeline 处理数据**（改造前是路由里写死的 importPrototype→list→emit）。 */
export async function runIntakeImportPipeline(
  deps: IntakeDeps,
  pipeline: BuildPipeline,
  ctx: AuthCtx,
  input: { filename: string; html: string },
): Promise<IntakeImportOutcome> {
  const steps = resolvePipelineSteps(pipeline, intakeImportStepRegistry(deps, ctx, input));
  const run = await runPipelineSteps(steps);
  if (run.status === "FAILED") throw new Error(run.error ?? "intake import pipeline failed");
  return {
    connection: run.context["connection"] ?? null,
    datasets: (run.context["datasets"] as ImportDatasetView[] | undefined) ?? [],
    rowCounts: (run.context["rowCounts"] as Record<string, number> | undefined) ?? {},
    pipeline: trace(pipeline, run),
  };
}
