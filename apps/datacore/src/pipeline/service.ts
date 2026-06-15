import type { OntologyWorkflow, OntologyWorkflowUpsert, WfValidationIssue } from "@platform/contracts";
import type { AuthCtx, OntologyWorkflowRecord } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import { newId } from "../ids.js";
import { notFound } from "../errors.js";

/**
 * OntoFlow（PRD v2）P1：本体建模工作流 CRUD + 校验。
 * 数据先行 ⊕ 图谱先行统一到一份 OntologyWorkflow；本期只做存储与校验，
 * 处理引擎/发布/物化在 P2–P4。多租户隔离，确定性。
 */
export class WorkflowService {
  constructor(private repos: Repos) {}

  async list(ctx: AuthCtx): Promise<OntologyWorkflow[]> {
    const recs = await this.repos.ontologyWorkflows.list(ctx.tenantId);
    return recs.map((r) => r.doc).sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async get(ctx: AuthCtx, id: string): Promise<OntologyWorkflow> {
    const rec = await this.repos.ontologyWorkflows.get(ctx.tenantId, id);
    if (!rec) throw notFound(`ontology workflow ${id}`);
    return rec.doc;
  }

  async create(ctx: AuthCtx, input: OntologyWorkflowUpsert): Promise<OntologyWorkflow> {
    const now = new Date().toISOString();
    const id = newId("wf");
    const doc: OntologyWorkflow = { ...input, id, tenantId: ctx.tenantId, status: "DRAFT", createdAt: now, updatedAt: now };
    await this.save(doc);
    return doc;
  }

  async update(ctx: AuthCtx, id: string, input: OntologyWorkflowUpsert): Promise<OntologyWorkflow> {
    const existing = await this.get(ctx, id);
    const doc: OntologyWorkflow = {
      ...input,
      id,
      tenantId: ctx.tenantId,
      status: existing.status, // 状态不经 PUT 改（发布走 /publish）
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.save(doc);
    return doc;
  }

  private async save(doc: OntologyWorkflow): Promise<void> {
    const rec: OntologyWorkflowRecord = { id: doc.id, tenantId: doc.tenantId, doc, updatedAt: doc.updatedAt ?? new Date().toISOString() };
    await this.repos.ontologyWorkflows.put(rec);
  }

  /**
   * 校验：节点 id 唯一、边引用存在、DAG 无环、实体主键齐备、链路两端类型在图内、
   * STATIC/ONTOLOGY 一致性（STATIC 节点不应配派生/状态变量/行动 —— 提示先 promote）。
   */
  async validate(ctx: AuthCtx, id: string): Promise<{ ok: boolean; issues: WfValidationIssue[] }> {
    const wf = await this.get(ctx, id);
    const issues: WfValidationIssue[] = [];
    const ids = new Set<string>();
    for (const n of wf.nodes) {
      if (ids.has(n.id)) issues.push({ nodeId: n.id, code: "DUP_NODE_ID", message: `节点 id 重复：${n.id}` });
      ids.add(n.id);
    }
    // 边引用存在
    for (const e of wf.edges) {
      if (!ids.has(e.from)) issues.push({ code: "EDGE_FROM_MISSING", message: `边起点不存在：${e.from}` });
      if (!ids.has(e.to)) issues.push({ code: "EDGE_TO_MISSING", message: `边终点不存在：${e.to}` });
    }
    // DAG 无环（Kahn）
    if (this.hasCycle(wf)) issues.push({ code: "CYCLE", message: "流程图存在环（必须为 DAG）" });
    // 实体/链路语义
    const entityTypeKeys = new Set<string>();
    for (const n of wf.nodes) {
      if (n.kind === "SUBGRAPH_ENTITY") {
        entityTypeKeys.add(n.modeling.typeKey);
        if (!n.modeling.primaryKey) issues.push({ nodeId: n.id, code: "NO_PK", message: `实体 ${n.modeling.typeKey} 缺主键` });
        if (n.storageMode === "STATIC" && ((n.modeling.derived?.length ?? 0) > 0 || (n.modeling.stateVariables?.length ?? 0) > 0 || (n.modeling.actions?.length ?? 0) > 0)) {
          issues.push({ nodeId: n.id, code: "STATIC_HAS_ONTOLOGY_FEATURES", message: `静态图谱节点 ${n.modeling.typeKey} 含派生/状态变量/行动，请先提升为本体图谱` });
        }
      }
    }
    for (const n of wf.nodes) {
      if (n.kind === "SUBGRAPH_LINK") {
        if (!entityTypeKeys.has(n.spec.fromTypeKey)) issues.push({ nodeId: n.id, code: "LINK_FROM_TYPE_MISSING", message: `链路 ${n.spec.linkKey} 起点类型 ${n.spec.fromTypeKey} 不在图内` });
        if (!entityTypeKeys.has(n.spec.toTypeKey)) issues.push({ nodeId: n.id, code: "LINK_TO_TYPE_MISSING", message: `链路 ${n.spec.linkKey} 终点类型 ${n.spec.toTypeKey} 不在图内` });
      }
    }
    return { ok: issues.length === 0, issues };
  }

  private hasCycle(wf: OntologyWorkflow): boolean {
    const adj = new Map<string, string[]>();
    const indeg = new Map<string, number>();
    for (const n of wf.nodes) {
      indeg.set(n.id, 0);
      adj.set(n.id, []);
    }
    for (const e of wf.edges) {
      if (!adj.has(e.from) || !indeg.has(e.to)) continue;
      adj.get(e.from)!.push(e.to);
      indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    }
    const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([k]) => k);
    let visited = 0;
    while (queue.length) {
      const u = queue.shift()!;
      visited++;
      for (const v of adj.get(u) ?? []) {
        indeg.set(v, (indeg.get(v) ?? 0) - 1);
        if (indeg.get(v) === 0) queue.push(v);
      }
    }
    return visited < wf.nodes.length;
  }
}
