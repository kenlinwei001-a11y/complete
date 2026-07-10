import type {
  TransformSpec,
  TransformSpecUpsert,
  TransformRun,
  TransformLineage,
  TransformValidationResult,
} from "@platform/contracts";
import type { AuthCtx, TransformSpecRecord, TransformRunRecord, RawDataset } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import { newId } from "../ids.js";
import { notFound, validationError } from "../errors.js";
import { profileRows } from "../connectors/profiler.js";
import { runTransform, validateStructure, terminalStepId } from "./engine.js";

type Row = Record<string, unknown>;

/**
 * E2 数据集转换引擎服务：转换规格 tenant 隔离 CRUD + 校验 + 物化 + 血缘。
 *
 * 物化（materialize）：解析 SOURCE → 载入 rawRows → 跑纯引擎 → 输出写为单一 RawDataset
 * （id 由 spec 派生，重跑覆盖，幂等），bump epoch，落 TransformRun（含列级血缘 + inputVersions）。
 *
 * 增量（incremental skip）：若存在上一次成功运行且**每个**输入数据集当前 syncedAt 与
 * 记录的 inputVersions 完全一致 → 跳过重算，返回 status=SKIPPED_UP_TO_DATE 的运行记录
 * （复用上次的 outputDatasetId/rowsOut/lineage）。
 *
 * 非目标（本切片文档化）：10⁷ 行级性能、真正的 delta-merge（仅追加/变更行的增量合并）、
 * 时间旅行深度回填。当前为「全量重算 + up-to-date 跳过」。真增量合并可在此扩展：
 * 按 inputVersions diff 出变更输入分片，仅重算受影响的下游步骤。
 */
export class TransformService {
  constructor(private repos: Repos) {}

  async list(ctx: AuthCtx): Promise<TransformSpec[]> {
    const recs = await this.repos.transformSpecs.list(ctx.tenantId);
    return recs.map((r) => r.doc).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async get(ctx: AuthCtx, id: string): Promise<TransformSpec> {
    const rec = await this.repos.transformSpecs.get(ctx.tenantId, id);
    if (!rec) throw notFound(`transform ${id}`);
    return rec.doc;
  }

  async create(ctx: AuthCtx, input: TransformSpecUpsert): Promise<TransformSpec> {
    const now = new Date().toISOString();
    const id = newId("tf");
    const doc: TransformSpec = { ...input, id, tenantId: ctx.tenantId, createdAt: now, updatedAt: now };
    await this.save(doc);
    return doc;
  }

  async update(ctx: AuthCtx, id: string, input: TransformSpecUpsert): Promise<TransformSpec> {
    const existing = await this.get(ctx, id);
    const doc: TransformSpec = {
      ...input,
      id,
      tenantId: ctx.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.save(doc);
    return doc;
  }

  private async save(doc: TransformSpec): Promise<void> {
    const rec: TransformSpecRecord = { id: doc.id, tenantId: doc.tenantId, doc, updatedAt: doc.updatedAt ?? new Date().toISOString() };
    await this.repos.transformSpecs.put(rec);
  }

  /**
   * 校验：DAG 无环（Kahn）、输入引用存在、SOURCE 数据集可解析、恰有一个终端步骤、
   * MAP/FILTER/JOIN/AGGREGATE/WINDOW 列引用存在（沿 schema 传播静态校验）。
   */
  async validate(ctx: AuthCtx, id: string): Promise<TransformValidationResult> {
    const spec = await this.get(ctx, id);
    const sourceColumns: Record<string, string[]> = {};
    const issues: TransformValidationResult["issues"] = [];
    for (const step of spec.steps) {
      if (step.kind !== "SOURCE") continue;
      const ds = await this.resolveSource(ctx, step.datasetRef);
      if (!ds) {
        issues.push({ stepId: step.id, code: "SOURCE_UNRESOLVED", message: `SOURCE ${step.id} 无法解析数据集 ${step.datasetRef.rawDatasetId ?? step.datasetRef.name ?? "?"}` });
        sourceColumns[step.id] = [];
      } else {
        sourceColumns[step.id] = ds.fields.map((f) => f.name);
      }
    }
    issues.push(...validateStructure(spec, sourceColumns));
    return { ok: issues.length === 0, issues };
  }

  /** 物化：跑引擎 → 写输出 RawDataset + epoch + TransformRun（含增量跳过）。 */
  async materialize(ctx: AuthCtx, id: string): Promise<TransformRun> {
    const spec = await this.get(ctx, id);
    const { ok, issues } = await this.validate(ctx, id);
    if (!ok) throw validationError(`transform ${id} 校验未通过：${issues.map((i) => i.code).join(",")}`);

    // resolve SOURCE datasets → rows + inputVersions
    const inputsById: Record<string, Row[]> = {};
    const inputVersions: Record<string, string> = {};
    for (const step of spec.steps) {
      if (step.kind !== "SOURCE") continue;
      const ds = await this.resolveSource(ctx, step.datasetRef);
      if (!ds) throw validationError(`SOURCE ${step.id} 无法解析数据集`);
      inputsById[step.id] = await this.repos.rawRows.list(ctx.tenantId, ds.id);
      inputVersions[ds.id] = ds.syncedAt;
    }

    const outputDatasetId = `rds_xf_${spec.id}`;
    const startedAt = new Date().toISOString();

    // incremental skip: prior successful run with identical inputVersions
    const prior = await this.latestSuccessful(ctx, spec.id);
    if (prior && sameVersions(prior.inputVersions, inputVersions)) {
      const skipped: TransformRun = {
        id: newId("tfrun"),
        tenantId: ctx.tenantId,
        specId: spec.id,
        status: "SKIPPED_UP_TO_DATE",
        outputDatasetId: prior.outputDatasetId,
        rowsOut: prior.rowsOut,
        epoch: prior.epoch,
        inputVersions,
        lineage: prior.lineage,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      await this.saveRun(skipped);
      return skipped;
    }

    // full recompute (documented non-goal: true delta-merge)
    const { rows, lineage } = runTransform(spec, inputsById);
    const epoch = await this.repos.epochs.next(ctx.tenantId);
    const dataset: RawDataset = {
      id: outputDatasetId,
      tenantId: ctx.tenantId,
      sourceConnId: `transform:${spec.id}`,
      name: spec.outputDatasetName,
      fields: profileRows(rows),
      rowCount: rows.length,
      syncedAt: new Date().toISOString(),
    };
    await this.repos.rawRows.replace(ctx.tenantId, outputDatasetId, rows);
    await this.repos.rawDatasets.put(dataset);

    const run: TransformRun = {
      id: newId("tfrun"),
      tenantId: ctx.tenantId,
      specId: spec.id,
      status: "SUCCEEDED",
      outputDatasetId,
      rowsOut: rows.length,
      epoch,
      inputVersions,
      lineage,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    await this.saveRun(run);
    return run;
  }

  /** 最新运行的列级血缘（从未物化 → 404）。 */
  async lineage(ctx: AuthCtx, id: string): Promise<TransformLineage> {
    await this.get(ctx, id); // tenant + existence
    const run = await this.latestRun(ctx, id);
    if (!run) throw notFound(`transform ${id} lineage (never materialized)`);
    return run.lineage;
  }

  async runs(ctx: AuthCtx, id: string): Promise<TransformRun[]> {
    const recs = await this.repos.transformRuns.list(ctx.tenantId, (r) => r.doc.specId === id);
    return recs.map((r) => r.doc).sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  }

  // ---- helpers ----

  private async saveRun(run: TransformRun): Promise<void> {
    const rec: TransformRunRecord = { id: run.id, tenantId: run.tenantId, doc: run, updatedAt: run.finishedAt ?? run.startedAt };
    await this.repos.transformRuns.put(rec);
  }

  private async latestRun(ctx: AuthCtx, specId: string): Promise<TransformRun | undefined> {
    const all = await this.runs(ctx, specId);
    return all[0];
  }

  private async latestSuccessful(ctx: AuthCtx, specId: string): Promise<TransformRun | undefined> {
    const all = await this.runs(ctx, specId);
    return all.find((r) => r.status === "SUCCEEDED");
  }

  /** Resolve a SOURCE datasetRef to a RawDataset (by id, else by unique name). */
  private async resolveSource(ctx: AuthCtx, ref: { rawDatasetId?: string; name?: string }): Promise<RawDataset | undefined> {
    if (ref.rawDatasetId) {
      const ds = await this.repos.rawDatasets.get(ctx.tenantId, ref.rawDatasetId);
      if (ds) return ds;
    }
    if (ref.name) {
      const all = await this.repos.rawDatasets.list(ctx.tenantId, (d) => d.name === ref.name);
      if (all.length > 0) return all.sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    }
    return undefined;
  }

  /** Expose terminal id for callers/tests. */
  terminal(spec: TransformSpec): string {
    return terminalStepId(spec.steps);
  }
}

function sameVersions(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (a[ak[i]!] !== b[bk[i]!]) return false;
  }
  return true;
}
