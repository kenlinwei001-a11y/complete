import type {
  OntologyWorkflow,
  OntologyWorkflowUpsert,
  WfValidationIssue,
  ReadinessResult,
  ScaffoldResult,
  GenericInferenceInput,
  GenericInferenceOutput,
} from "@platform/contracts";
import type { AuthCtx, OntologyWorkflowRecord, ObjectInstance, ViewConfig } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import { newId } from "../ids.js";
import { notFound, validationError, AppError } from "../errors.js";
import { runProcessing, type EntityRecord } from "./processing.js";
import { buildTypeDefs, buildLinkDefs, buildSliceSpec, entityStorageModes } from "./subgraph.js";
import type { InferenceTypeDef } from "./generic-inference.js";
import { computeReadiness } from "./readiness.js";
import { buildScaffold } from "./scaffold.js";
import { computeInference } from "./generic-inference.js";
import type { OntologyService } from "../ontology.js";
import type { OntologyCoreService } from "../ontology-core.js";

/**
 * WO-MERGE-01 B2 跨系统 scaffold 客户端：把 scaffold 蓝图里的 Agent + 场景入口真推到 AgentCore
 * （create→publish→scene-entry），由 app.ts 在 AGENTCORE_BASE_URL 配置时以 OBO(x-debug-user) 注入。
 * 未注入（如测试/单机未配）→ scaffold 诚实记 deferred，绝不伪造已落库（KILL-MOCK-RED）。
 */
export interface ScaffoldPushItem {
  agentKey: string;
  agentTitle: string;
  systemPrompt?: string;
  /** Agent 最小授权对象类型（scaffold 用发布出的实体 typeKey；AgentCore 发布门探针要求其在 DataCore 本体存在）。 */
  objectTypes: string[];
  tools: string[];
  sceneViewKey: string;
  sceneTitle: string;
  typeKey: string;
}
export interface AgentScaffoldClient {
  /** 幂等推送单个 Agent（create→publish）+ 场景入口（AGENT_FIRST）。返回真落库回执或 error（诚实）。 */
  push(ctx: AuthCtx, item: ScaffoldPushItem): Promise<{ agentPushed?: string; scenePushed?: string; error?: string }>;
}

/**
 * OntoFlow（PRD v2）：本体建模工作流 CRUD/校验(P1) + 数据处理预览(P2) + 发布/提升(P3)
 * + 准备度/生成应用/通用推演(P4)。数据先行 ⊕ 图谱先行统一到一份 OntologyWorkflow。多租户隔离，确定性。
 */
export class WorkflowService {
  constructor(
    private repos: Repos,
    private ontology: OntologyService,
    private ontologyCore: OntologyCoreService,
    /** WO-MERGE-01 B2：跨系统 scaffold（A→B）客户端；未配 AGENTCORE_BASE_URL 时缺省 undefined → deferred。 */
    private agentScaffoldClient?: AgentScaffoldClient,
  ) {}

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

  /**
   * P2 预览（dry-run）：对指定实体节点，用其 ProcessingSpec（节点内嵌或上游 PROCESS 节点）
   * 在传入的样例 rows 上跑数据处理，返回实体记录（不落库）。rows 由前端从上传/连接器样例提供。
   */
  async preview(ctx: AuthCtx, id: string, opts: { nodeId: string; rows: Record<string, unknown>[] }): Promise<{ typeKey: string; total: number; entities: EntityRecord[] }> {
    const wf = await this.get(ctx, id);
    const node = wf.nodes.find((n) => n.id === opts.nodeId);
    if (!node || node.kind !== "SUBGRAPH_ENTITY") throw validationError(`节点 ${opts.nodeId} 不是实体节点`);
    // ProcessingSpec：优先节点内嵌（图谱先行），否则取上游 PROCESS 节点（数据先行）
    let spec = node.processing;
    if (!spec) {
      const upstreamIds = wf.edges.filter((e) => e.to === node.id).map((e) => e.from);
      const proc = wf.nodes.find((n) => n.kind === "PROCESS" && upstreamIds.includes(n.id));
      if (proc && proc.kind === "PROCESS") spec = proc.spec;
    }
    if (!spec) throw validationError(`实体 ${node.modeling.typeKey} 无数据处理规格（节点 processing 或上游 PROCESS）`);
    const entities = runProcessing(opts.rows, spec);
    return { typeKey: node.modeling.typeKey, total: entities.length, entities };
  }

  /** P3 提升：实体节点 STATIC→ONTOLOGY（纳入派生/推演）。 */
  async promote(ctx: AuthCtx, id: string, nodeId: string): Promise<OntologyWorkflow> {
    const wf = await this.get(ctx, id);
    const node = wf.nodes.find((n) => n.id === nodeId);
    if (!node || node.kind !== "SUBGRAPH_ENTITY") throw validationError(`节点 ${nodeId} 不是实体节点`);
    node.storageMode = "ONTOLOGY";
    node.status = "READY";
    const doc: OntologyWorkflow = { ...wf, updatedAt: new Date().toISOString() };
    await this.save(doc);
    return doc;
  }

  /**
   * P3 发布：校验通过后，把实体/链路落本体(types/links/version) + 子图切片(SliceSpec)，
   * 工作流置 PUBLISHED。本体 schema 为设计产物，直接写（与 modeling publish 同级）；
   * 对象物化(真值)走 Action（见「流水线发布物化」ActionType + domainExecutor）。
   */
  async publish(ctx: AuthCtx, id: string): Promise<{ types: string[]; links: string[]; sliceKey?: string; version: number }> {
    const { ok, issues } = await this.validate(ctx, id);
    if (!ok) throw new AppError("WORKFLOW_INVALID", `校验未通过：${issues.map((i) => i.code).join(",")}`, 422);
    const wf = await this.get(ctx, id);
    const typeDefs = buildTypeDefs(wf);
    for (const t of typeDefs) await this.ontology.upsertType(ctx, t);
    const linkDefs = buildLinkDefs(wf);
    for (const l of linkDefs) await this.ontology.upsertLinkType(ctx, l);
    const version = (await this.ontology.publishVersion(ctx)).version;
    const slice = buildSliceSpec(wf);
    if (slice) await this.ontologyCore.putSliceSpec(ctx, slice.sliceKey, 1, slice.spec as never);
    await this.save({ ...wf, status: "PUBLISHED", updatedAt: new Date().toISOString() });
    return { types: typeDefs.map((t) => t.key), links: linkDefs.map((l) => l.key), sliceKey: slice?.sliceKey, version };
  }

  /** P4 准备度：各实体/子图局部仿真准备度评分（纯确定性，见 readiness.ts）。 */
  async readiness(ctx: AuthCtx, id: string): Promise<ReadinessResult> {
    const wf = await this.get(ctx, id);
    return computeReadiness(wf);
  }

  /**
   * P4 生成应用（§8.1）+ WO-MERGE-01 B2 真落库：从已发布本体派生 视图/场景/Agent/场景包/求解器绑定。
   *
   * 落库边界：
   *   ① 视图 → DataCore viewConfigs（每工作流一份 scaffold 视图配置 vc_scaffold_<tenant>_<id>，幂等 replace）。
   *      视图/本体 schema 属「设计产物」，与 publish 直写 types/links 同级 → 直接幂等落库，可查·前端可渲染。
   *   ② Agent + 场景入口 → 跨系统属 AgentCore（/b/v1/agents create→publish、/b/v1/scene-entries）。
   *      配置了 AGENTCORE_BASE_URL 时经注入的 agentScaffoldClient 以 OBO 真推（真落库·可查）；
   *      未配置或推送失败 → 记 persisted.deferred（诚实回执，KILL-MOCK-RED：不把未落库冒充已落库）。
   */
  async scaffold(ctx: AuthCtx, id: string): Promise<ScaffoldResult> {
    const wf = await this.get(ctx, id);
    const result = buildScaffold(wf);

    // ① 视图 → DataCore viewConfigs（幂等 replace）。
    const viewConfigId = `vc_scaffold_${ctx.tenantId}_${id}`;
    const vc: ViewConfig = {
      id: viewConfigId,
      tenantId: ctx.tenantId,
      role: `scaffold:${id}`,
      scenarioPackages: [...result.scenarioPackages],
      views: result.views.map((v) => ({
        key: v.key,
        title: v.title,
        renderer: v.kind === "graph" ? "ontology-graph" : v.kind,
        ...(v.typeKey ? { options: { typeKey: v.typeKey } } : {}),
      })),
      theme: { "--accent": "#4C90F0" },
      navigation: result.views.map((v) => ({ key: v.key, label: v.title, viewKey: v.key, group: "business" as const })),
      origin: "MANUAL",
    };
    await this.repos.viewConfigs.put(vc);

    // ② Agent + 场景入口 → AgentCore（真跨系统落库，或诚实 deferred）。
    const agentsPushed: string[] = [];
    const sceneEntriesPushed: string[] = [];
    const deferred: string[] = [];
    const agentByKey = new Map(result.agents.map((a) => [a.key, a]));
    if (result.scenes.length === 0) {
      // 无核心实体 → 无 Agent/场景需推（非缺陷，纯结构骨架）。
    } else if (!this.agentScaffoldClient) {
      deferred.push("agentcore-agents-scenes: AGENTCORE_BASE_URL 未配置（真部署经网关同源可达）");
    } else {
      for (const scene of result.scenes) {
        const agent = agentByKey.get(scene.agentKey);
        const item: ScaffoldPushItem = {
          agentKey: scene.agentKey,
          agentTitle: agent?.title ?? `${scene.typeKey} 助手`,
          systemPrompt: agent?.systemPrompt,
          objectTypes: [scene.typeKey],
          tools: agent?.tools ?? [],
          sceneViewKey: scene.key,
          sceneTitle: scene.title,
          typeKey: scene.typeKey,
        };
        const r = await this.agentScaffoldClient.push(ctx, item);
        if (r.agentPushed) agentsPushed.push(r.agentPushed);
        if (r.scenePushed) sceneEntriesPushed.push(r.scenePushed);
        if (r.error) deferred.push(`scene ${scene.key}: ${r.error}`);
      }
    }

    return {
      ...result,
      persisted: {
        viewConfigId,
        viewKeys: result.views.map((v) => v.key),
        agentsPushed,
        sceneEntriesPushed,
        deferred,
      },
    };
  }

  /**
   * P4 通用 what-if（§8.2）：对已发布本体的 ONTOLOGY 类型对象施加变更，
   * 沿派生/聚合边有界传播，输出 before/after。领域深推演仍需求解器（可插拔）。
   */
  async inference(ctx: AuthCtx, id: string, input: GenericInferenceInput): Promise<GenericInferenceOutput> {
    const wf = await this.get(ctx, id);
    const modes = entityStorageModes(wf);
    const types: InferenceTypeDef[] = buildTypeDefs(wf)
      .filter((t) => modes.get(t.key) === "ONTOLOGY")
      .map((t) => ({ key: t.key, storageMode: "ONTOLOGY", properties: t.properties, derivedProperties: t.derivedProperties }));
    const links = buildLinkDefs(wf);
    const objectsByType: Record<string, ObjectInstance[]> = {};
    for (const t of types) objectsByType[t.key] = await this.repos.objects.listByType(ctx.tenantId, t.key);
    return computeInference({ types, links, objectsByType }, input);
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
