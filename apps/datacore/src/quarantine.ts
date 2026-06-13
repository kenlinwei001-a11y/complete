import type { AuthCtx, QuarantineRowRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import { newId } from "./ids.js";
import { notFound, validationError } from "./errors.js";

export type QuarantineReason = QuarantineRowRecord["reason"];

/**
 * 运营完备性 §4 数据隔离区。
 *
 * 写入点：连接器同步行级失败 / materialize 行级失败 / A8 时序越界 / 单位 lint。
 * **行级失败不再使批次失败**（批次结果含 `quarantined: n`）。异常行可在中台行内编辑后
 * 重投对应管线（reprocess），或批量丢弃（discard，需意见）。连接器健康度卡显示隔离率，>5% 告警。
 */
export class QuarantineService {
  constructor(private repos: Repos) {}

  async record(
    tenantId: string,
    input: {
      connId: string;
      dataset: string;
      raw: Record<string, unknown>;
      reason: QuarantineReason;
      detail?: string;
      reprocess: QuarantineRowRecord["reprocess"];
    },
  ): Promise<QuarantineRowRecord> {
    const rec: QuarantineRowRecord = {
      id: newId("qr"),
      tenantId,
      connId: input.connId,
      dataset: input.dataset,
      raw: input.raw,
      reason: input.reason,
      detail: input.detail,
      status: "PENDING",
      reprocess: input.reprocess,
      createdAt: new Date().toISOString(),
    };
    await this.repos.quarantineRows.put(rec);
    return rec;
  }

  /** 按原因分组 + 汇总（前端 /admin/quarantine）。 */
  async list(ctx: AuthCtx, status: QuarantineRowRecord["status"] = "PENDING"): Promise<{
    items: QuarantineRowRecord[];
    byReason: Record<string, number>;
    total: number;
  }> {
    const items = await this.repos.quarantineRows.list(ctx.tenantId, (q) => q.status === status);
    const byReason: Record<string, number> = {};
    for (const q of items) byReason[q.reason] = (byReason[q.reason] ?? 0) + 1;
    return { items, byReason, total: items.length };
  }

  /** 隔离率（PENDING 行 ÷ 给定 datasetTotal）；>5% 告警由调用方判定。 */
  async rate(tenantId: string, connId: string, datasetTotal: number): Promise<number> {
    if (datasetTotal <= 0) return 0;
    const pending = await this.repos.quarantineRows.list(
      tenantId,
      (q) => q.connId === connId && q.status === "PENDING",
    );
    return pending.length / (datasetTotal + pending.length);
  }

  /**
   * 修复并重处理：行内编辑（props 覆盖）后重投。校验通过 → 重建对象进入正常管线并标 REPROCESSED。
   */
  async reprocess(
    ctx: AuthCtx,
    id: string,
    edits?: Record<string, unknown>,
  ): Promise<{ status: "REPROCESSED"; objectId: string }> {
    const rec = await this.repos.quarantineRows.get(ctx.tenantId, id);
    if (!rec) throw notFound("quarantine row");
    if (rec.status !== "PENDING") throw validationError("row is not PENDING");
    const raw = { ...rec.raw, ...(edits ?? {}) };
    const { targetKey, mapping, pk } = rec.reprocess;
    const props: Record<string, unknown> = {};
    for (const m of mapping) props[m.propKey] = raw[m.sourceField];
    // re-run the same validation the pipeline applied (PK presence)
    if (pk && (props[pk] == null || props[pk] === "")) {
      throw validationError(`primary key '${pk}' still missing/empty after edit`);
    }
    const idSuffix = pk && props[pk] != null ? String(props[pk]) : newId("row");
    const objectId = `obj_${targetKey.toLowerCase()}_${rec.connId}_${idSuffix}`.replace(/[^\w-]/g, "_");
    await this.repos.objects.put({
      id: objectId,
      tenantId: ctx.tenantId,
      type: targetKey,
      props,
      origin: { type: "MATERIALIZED", datasetId: rec.connId, jobId: newId("job") },
    });
    await this.repos.quarantineRows.put({ ...rec, status: "REPROCESSED", raw });
    return { status: "REPROCESSED", objectId };
  }

  /** 批量丢弃（需意见）。 */
  async discard(ctx: AuthCtx, ids: string[], comment: string): Promise<{ discarded: number }> {
    if (!comment.trim()) throw validationError("discard requires a comment");
    let discarded = 0;
    for (const id of ids) {
      const rec = await this.repos.quarantineRows.get(ctx.tenantId, id);
      if (rec && rec.status === "PENDING") {
        await this.repos.quarantineRows.put({ ...rec, status: "DISCARDED", detail: `${rec.detail ?? ""} | discarded: ${comment}` });
        discarded++;
      }
    }
    return { discarded };
  }
}
