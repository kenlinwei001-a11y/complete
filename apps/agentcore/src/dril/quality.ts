import { ewmaUpdate, type IntelligenceResource, type ResourceQuality } from "@platform/contracts";
import type { Repos, ResourceQualityScoreRow } from "../persistence/repos.js";
import type { ToolAuthCtx } from "../tools/clients.js";

/**
 * WO-DRIL-P3 · 运行时质量分服务（PRD-decision-resource-intelligence-layer §5.4）。
 *
 * 运行时探针每次资源调用后 `record` 一次观测（success/latency）→ 确定性 EWMA 更新 `resource_quality_scores`：
 *   successRate_new = α·success + (1-α)·old   (α=0.1)
 *   usageCount_new  = old + 1
 *   avgLatencyMs_new = α·latency + (1-α)·old
 * 复用契约纯函数 `ewmaUpdate`（R6·同 prev 同 observed → 字节一致，无 Date.now/random；lastProbeAt 由调用方传入时钟）。
 *
 * 质量分是 DERIVED 投影（R13）——真值落 `resource_quality_scores` 表，检索时由 registry `overlayQuality`
 * 叠加到 resource.quality 供 history 子分排序（低质资源排名下降 = SEAM 头号判据）。fail-open：无 prev → 首观测即基线。
 */
export class ResourceQualityService {
  constructor(private readonly repos: Repos) {}

  /** 记一次运行时观测 → EWMA 更新并 upsert；返回更新后的分行（R6·nowIso 由调用方注入·默认 record 时刻）。 */
  async record(
    ctx: ToolAuthCtx,
    kind: string,
    key: string,
    observed: { success: boolean; latencyMs: number },
    nowIso: string = new Date().toISOString(),
  ): Promise<ResourceQualityScoreRow> {
    const prev = await this.repos.resourceQualityScores.get(ctx.tenantId, kind, key);
    const next = ewmaUpdate(
      { successRate: prev?.successRate, usageCount: prev?.usageCount, avgLatencyMs: prev?.avgLatencyMs },
      observed,
    );
    const row: ResourceQualityScoreRow = {
      tenantId: ctx.tenantId,
      kind,
      key,
      successRate: next.successRate,
      usageCount: next.usageCount,
      avgLatencyMs: next.avgLatencyMs,
      lastProbeAt: nowIso,
    };
    await this.repos.resourceQualityScores.upsert(row);
    return row;
  }

  /** 读单资源质量分行（无 → undefined·端点/叠加用）。 */
  async get(ctx: ToolAuthCtx, kind: string, key: string): Promise<ResourceQualityScoreRow | undefined> {
    return this.repos.resourceQualityScores.get(ctx.tenantId, kind, key);
  }

  /** 本租户全部质量分行（registry 检索期批量叠加用·一次读回避免 N 次单读）。 */
  async listByTenant(ctx: ToolAuthCtx): Promise<ResourceQualityScoreRow[]> {
    return this.repos.resourceQualityScores.listByTenant(ctx.tenantId);
  }
}

/** 质量分行 → ResourceQuality 片段（叠加到 resource.quality·仅覆盖运行时三项·保留投影期 accuracy/trust 等）。 */
export function qualityFromRow(row: ResourceQualityScoreRow | undefined): Partial<ResourceQuality> {
  if (!row) return {};
  const out: Partial<ResourceQuality> = {};
  if (row.successRate !== undefined) out.successRate = row.successRate;
  if (row.usageCount !== undefined) out.usageCount = Math.round(row.usageCount);
  if (row.avgLatencyMs !== undefined) out.avgLatencyMs = Math.round(row.avgLatencyMs);
  if (row.lastProbeAt !== undefined) out.lastUpdated = row.lastProbeAt;
  return out;
}

/** 把运行时质量分叠加到资源（不改真值源·检索期投影·R13）。无分行 → 原样返回。 */
export function overlayQuality(resource: IntelligenceResource, row: ResourceQualityScoreRow | undefined): IntelligenceResource {
  const patch = qualityFromRow(row);
  if (Object.keys(patch).length === 0) return resource;
  return { ...resource, quality: { ...(resource.quality ?? {}), ...patch } } as IntelligenceResource;
}
