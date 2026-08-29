// 数据构建 Pipeline 服务：租户覆盖的 CRUD + 「解析出该 kind 当前生效的定义」。
// 解析规则（单一入口，所有链路共用）：租户存了同 kind 的记录 → 用它；否则 → 出厂默认。
// R2：一切读写带 tenantId；跨租户不可见。
import type { AuthCtx } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";
import { notFound, validationError } from "../errors.js";
import type { BuildPipeline, BuildPipelineKind, BuildPipelineUpsert } from "@platform/contracts";
import { BUILD_PIPELINE_KINDS, factoryPipeline, orderPipelineNodes } from "./pipeline-defs.js";

const nowIso = (): string => new Date().toISOString();

/** 租户覆盖记录的确定性 id（一租户一 kind 至多一条 → 幂等 upsert，不会堆垃圾）。 */
const pipelineId = (tenantId: string, kind: BuildPipelineKind): string => `bpp_${tenantId}_${kind}`;

export class BuildPipelineService {
  constructor(
    private repos: Repos,
    private outbox?: OutboxService,
  ) {}

  /** 全部 kind 的当前生效定义（未覆盖的给出厂默认，factory=true 可辨认）。 */
  async list(ctx: AuthCtx): Promise<BuildPipeline[]> {
    return Promise.all(BUILD_PIPELINE_KINDS.map((k) => this.resolve(ctx, k)));
  }

  /**
   * 当前**生效**的 pipeline 定义：租户覆盖优先，否则出厂默认。
   * 这是「步骤从数据里读出来」的单一读取点 —— 引擎与各接入口都经此拿定义。
   */
  async resolve(ctx: AuthCtx, kind: BuildPipelineKind): Promise<BuildPipeline> {
    const rec = await this.repos.buildPipelines.get(ctx.tenantId, pipelineId(ctx.tenantId, kind));
    return rec ?? factoryPipeline(ctx.tenantId, kind);
  }

  async get(ctx: AuthCtx, kind: string): Promise<BuildPipeline> {
    if (!BUILD_PIPELINE_KINDS.includes(kind as BuildPipelineKind)) throw notFound(`build pipeline ${kind}`);
    return this.resolve(ctx, kind as BuildPipelineKind);
  }

  /** 覆盖某 kind 的 pipeline（幂等 upsert）。校验后落库并发事件。 */
  async upsert(ctx: AuthCtx, kind: string, input: BuildPipelineUpsert): Promise<BuildPipeline> {
    if (!BUILD_PIPELINE_KINDS.includes(kind as BuildPipelineKind)) throw notFound(`build pipeline ${kind}`);
    const k = kind as BuildPipelineKind;
    if (input.kind !== k) throw validationError(`body.kind(${input.kind}) 与路径 kind(${k}) 不一致`);
    const existing = await this.repos.buildPipelines.get(ctx.tenantId, pipelineId(ctx.tenantId, k));
    const doc: BuildPipeline = {
      ...input,
      kind: k,
      id: pipelineId(ctx.tenantId, k),
      tenantId: ctx.tenantId,
      factory: false,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    const issues = validatePipeline(doc);
    if (issues.length > 0) throw validationError(`pipeline 校验未通过：${issues.join(" · ")}`);
    await this.repos.buildPipelines.put(doc);
    await this.outbox?.emit(ctx.tenantId, "buildpipeline.updated", { kind: k, nodes: doc.nodes.length, enabled: doc.nodes.filter((n) => n.enabled).length });
    return doc;
  }

  /** 撤销覆盖 → 回到出厂默认（行为回到写死时代）。 */
  async reset(ctx: AuthCtx, kind: string): Promise<BuildPipeline> {
    if (!BUILD_PIPELINE_KINDS.includes(kind as BuildPipelineKind)) throw notFound(`build pipeline ${kind}`);
    const k = kind as BuildPipelineKind;
    await this.repos.buildPipelines.remove(ctx.tenantId, pipelineId(ctx.tenantId, k));
    await this.outbox?.emit(ctx.tenantId, "buildpipeline.reset", { kind: k });
    return factoryPipeline(ctx.tenantId, k);
  }
}

/** 结构校验：节点 id 唯一 · 边两端存在 · 无环 · 至少一个启用节点。 */
export function validatePipeline(doc: BuildPipeline): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const n of doc.nodes) {
    if (ids.has(n.id)) issues.push(`DUP_NODE_ID:${n.id}`);
    ids.add(n.id);
  }
  for (const e of doc.edges) {
    if (!ids.has(e.from)) issues.push(`EDGE_FROM_MISSING:${e.from}`);
    if (!ids.has(e.to)) issues.push(`EDGE_TO_MISSING:${e.to}`);
  }
  if (doc.nodes.length > 0 && doc.nodes.every((n) => !n.enabled)) issues.push("NO_ENABLED_NODE");
  // orderPipelineNodes 有环时会把剩余节点补在尾部 → 用「拓扑消解数 < 节点数」判环。
  if (doc.edges.length > 0 && hasCycle(doc)) issues.push("CYCLE");
  return issues;
}

function hasCycle(doc: BuildPipeline): boolean {
  const ids = new Set(doc.nodes.map((n) => n.id));
  const indeg = new Map(doc.nodes.map((n) => [n.id, 0]));
  const adj = new Map(doc.nodes.map((n) => [n.id, [] as string[]]));
  for (const e of doc.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([k]) => k);
  let seen = 0;
  while (q.length > 0) {
    const u = q.shift()!;
    seen++;
    for (const v of adj.get(u) ?? []) {
      indeg.set(v, (indeg.get(v) ?? 0) - 1);
      if (indeg.get(v) === 0) q.push(v);
    }
  }
  return seen < doc.nodes.length;
}

/** 可观测投影：当前生效定义的执行顺序（前端画布/审计一眼看「实际会怎么跑」）。 */
export function projectPipelineOrder(doc: BuildPipeline): { stepKey: string; label: string; enabled: boolean; onFailure: string; maxAttempts: number; requiresHumanApproval: boolean }[] {
  return orderPipelineNodes(doc).map((n) => ({
    stepKey: n.stepKey,
    label: n.label,
    enabled: n.enabled,
    onFailure: n.sop.onFailure,
    maxAttempts: n.sop.maxAttempts,
    requiresHumanApproval: n.sop.requiresHumanApproval,
  }));
}
