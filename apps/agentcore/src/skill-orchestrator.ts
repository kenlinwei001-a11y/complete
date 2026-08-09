/**
 * Skill Graph 调度器（GraphScheduler）· `docs/PRD-skill-runtime-orchestrator.md` §3.4
 *
 * WO-SKILL-ORCHESTRATOR-S1 切片：**按层执行 · 同层并发 · 数据沿边流动**。
 *
 * ── 与既有线性执行器的关系（本单不改它）────────────────────────────────────────
 * `workflow/executor.ts:104` 是 `for (const step of input.steps)` 逐个 await 的**线性**执行器。
 * 本文件不动它、不替换它，只在旁边加**图调度**：拓扑波前 + 同层并发。
 * PRD §3.4 的「三处扇出收编」属 W2 单，本切片不做（诚实边界，见文末 §未做）。
 *
 * ── 数据沿边流动的强制机制（本单存在的意义）────────────────────────────────────
 * 节点 params 用的是**既有**模板语法 `{{steps.<nodeId>.output.<path>}}`，由**既有**
 * `util/template.ts resolveTemplate` 求值（不新写解析器 = 不造第二套词表）。
 * 关键在**作用域怎么建**：某节点的 `scope.steps` **只装它祖先的输出**
 * （`ancestorsOf(nodeId, predecessors)`）。于是——
 *   · 有边 → 上游输出可见 → 数据真的流过了这条边；
 *   · 无边 → 引用不到 → `TemplateResolutionError` → 该节点 FAILED。
 * 「边」因此不是画给人看的装饰，而是数据可见性的授权。这也让变异反证天然成立：
 * 把作用域里的祖先输出掐掉，第二层节点立刻拿 TEMPLATE_RESOLUTION_ERROR 变红。
 */
import {
  ancestorsOf,
  compileExecution,
  ErrorCodes,
  type ExecutionSource,
  type SkillExecution,
  type SkillExecutionStep,
  type SkillGraph,
  type SkillGraphLayer,
  type SkillGraphNode,
} from "@platform/contracts";
import type { DataCoreClient, ToolAuthCtx } from "./tools/clients.js";
import type { Repos } from "./persistence/repos.js";
import { resolveTemplate, TemplateResolutionError, type TemplateScope } from "./util/template.js";
// 裁决 v3 约束①：步骤形状的**单一来源是这个函数，不是某个闭合类型名**。
// 它实际接受 `ExtendedPlanStep = PlanStep | ExtraToolStep`（后者含 query_timeseries_agg /
// search_knowledge / plan_slice 三个真实可执行类型）。任何消费方校验步骤都必须走它。
import { validatePlanSteps } from "./workflow/validate.js";
import type { ExtendedPlanStep } from "./workflow/executor.js";

export interface GraphNodeResult {
  nodeId: string;
  kind: SkillGraphNode["kind"];
  /** 该节点所在层（便于断言「第二层拿到了第一层的输出」）。 */
  layer: number;
  status: "COMPLETED" | "FAILED" | "SKIPPED";
  /** 节点产物；下游经 `{{steps.<nodeId>.output...}}` 引用的就是它。 */
  output?: unknown;
  error?: { code: string; message: string };
  /** 本节点解析后的实参（诚实留痕：能看出它到底拿到了上游的什么值）。 */
  resolvedParams?: Record<string, unknown>;
  /** 该节点可见的上游节点（= 它的祖先集，按声明序）。 */
  visibleFrom?: string[];
}

export interface GraphRunResult {
  runId: string;
  tenantId: string;
  /**
   * 本次**实际走的执行来源**（审核方 2026-08-09 对名裁决判据 #1）。
   * 必须逐次上报：`execution.graph`（新路·图） / `execution.steps`（新路·线性链） /
   * `legacy.plan.steps`（旧路）。**回落 legacy 一旦静默，这个特性就等于没做而测试照绿。**
   */
  source: ExecutionSource;
  layers: SkillGraphLayer[];
  nodeResults: GraphNodeResult[];
  status: "COMPLETED" | "FAILED";
}

export interface GraphSchedulerDeps {
  repos: Repos;
  dataCore: DataCoreClient;
}

export class SkillGraphCompileError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cycle?: string[],
  ) {
    super(message);
    this.name = "SkillGraphCompileError";
  }
}

/** 节点执行上下文——每个节点自带身份（PRD §3.5-b：并行后不得靠「当前串行步」推导）。 */
interface NodeRunContext {
  auth: ToolAuthCtx;
  node: SkillGraphNode;
  layer: number;
  scope: TemplateScope;
  visibleFrom: string[];
}

export class GraphScheduler {
  constructor(private readonly deps: GraphSchedulerDeps) {}

  /**
   * 跑一次执行来源（图 / 线性 steps / legacy plan steps 三选一，**由 `compileExecution` 判别**）。
   *
   * 确定性（R6）：
   *  · `layers[]` 来自 `compileExecution`，只由声明序决定；
   *  · `nodeResults[]` 按**声明序**归并（不是完成序）——网络抖动导致的完成先后不影响输出字节。
   */
  async run(
    auth: ToolAuthCtx,
    input: { execution?: SkillExecution; legacyPlanSteps?: SkillExecutionStep[] },
    opts: { runId: string; slots?: Record<string, unknown>; context?: unknown } = { runId: "run_0" },
  ): Promise<GraphRunResult> {
    const compiled = compileExecution(input);
    if (!compiled.ok) {
      throw new SkillGraphCompileError(compiled.code, compiled.message, compiled.cycle);
    }

    // ── 裁决 v3 约束①：线性两路必须过**生产校验器** `validatePlanSteps` ──────────────
    // 契约层只做结构地板（`type` 是开放 string，好让 ExtraToolStep 三类进得来）；
    // 语义真值（id 重复 / 悬空步骤引用 / 前向引用 / 超时合计上界）在这个函数里。
    // 契约包在下层不能 import agentcore（R1），所以这条线只能由消费方接——这里就是那个消费方。
    // 图路**不适用**：`validatePlanSteps` 的「只能引用 j<i」是线性假设，DAG 上不成立。
    const linearSteps =
      compiled.source === "execution.steps"
        ? input.execution?.steps
        : compiled.source === "legacy.plan.steps"
          ? input.legacyPlanSteps
          : undefined;
    if (linearSteps) {
      const errors = validatePlanSteps(linearSteps as unknown as ExtendedPlanStep[]);
      if (errors.length > 0) {
        throw new SkillGraphCompileError(
          ErrorCodes.PLAN_VALIDATION_ERROR,
          `线性步骤未过 validatePlanSteps（${errors.length} 项）：${errors.join("；")}`,
        );
      }
    }

    const graph = compiled.graph;

    const byId = new Map<string, SkillGraphNode>();
    for (const n of graph.nodes) byId.set(n.id, n);
    const layerOf = new Map<string, number>();
    for (const l of compiled.layers) for (const id of l.nodeIds) layerOf.set(id, l.index);

    /** 已完成节点的产物：nodeId -> output。**注意这里不直接当作用域**，见下面 scopeFor。 */
    const outputs = new Map<string, unknown>();
    const results = new Map<string, GraphNodeResult>();
    /** 被上游 FAIL 掐断的节点（及其后继）。 */
    const poisoned = new Set<string>();

    const concurrency = Math.max(1, graph.maxParallelNodes);

    for (const layer of compiled.layers) {
      // 同层并发，但**并发度有上限**（PRD §3.4：不许无上限）。分批 = 简单可靠的有界并发。
      for (let i = 0; i < layer.nodeIds.length; i += concurrency) {
        const batch = layer.nodeIds.slice(i, i + concurrency);
        const settled = await Promise.allSettled(
          batch.map(async (id): Promise<GraphNodeResult> => {
            const node = byId.get(id)!;
            if (poisoned.has(id)) {
              return { nodeId: id, kind: node.kind, layer: layer.index, status: "SKIPPED", error: { code: "UPSTREAM_FAILED", message: "上游节点失败，本节点未执行" } };
            }
            const visibleFrom = ancestorsOf(id, compiled.predecessors);
            const scope = this.scopeFor(visibleFrom, outputs, opts);
            return this.runNode({ auth, node, layer: layer.index, scope, visibleFrom });
          }),
        );
        for (let k = 0; k < batch.length; k++) {
          const id = batch[k]!;
          const s = settled[k]!;
          const node = byId.get(id)!;
          const r: GraphNodeResult =
            s.status === "fulfilled"
              ? s.value
              : {
                  nodeId: id,
                  kind: node.kind,
                  layer: layer.index,
                  status: "FAILED",
                  error: { code: "NODE_UNCAUGHT", message: s.reason instanceof Error ? s.reason.message : String(s.reason) },
                };
          results.set(id, r);
          if (r.status === "COMPLETED") {
            outputs.set(id, r.output);
          } else if (node.onError !== "SKIP") {
            // onError=FAIL（缺省）→ 毒化全部后继（与今天 executor 的 SKIP 语义互补）
            this.poisonDescendants(id, graph, poisoned);
          }
        }
      }
    }

    // 按**声明序**归并（R6）——不是完成序。
    const nodeResults = graph.nodes.map(
      (n) =>
        results.get(n.id) ?? {
          nodeId: n.id,
          kind: n.kind,
          layer: layerOf.get(n.id) ?? 0,
          status: "SKIPPED" as const,
          error: { code: "NOT_SCHEDULED", message: "未被调度" },
        },
    );

    return {
      runId: opts.runId,
      tenantId: auth.tenantId,
      // 判据 #1：走了哪一路，逐次说出来。不许静默回落。
      source: compiled.source,
      layers: compiled.layers,
      nodeResults,
      status: nodeResults.some((r) => r.status === "FAILED") ? "FAILED" : "COMPLETED",
    };
  }

  /**
   * 建模板作用域：`steps` **只装祖先的输出**。
   *
   * 这一处就是「数据沿边流动」的执行点。改成 `outputs` 全量（无视 visibleFrom）= 退化成
   * 「同一次运行里谁都能读谁」，边就失去意义 —— 变异反证正是掐这里。
   */
  private scopeFor(
    visibleFrom: string[],
    outputs: Map<string, unknown>,
    opts: { slots?: Record<string, unknown>; context?: unknown },
  ): TemplateScope {
    const steps: Record<string, unknown> = {};
    for (const id of visibleFrom) {
      if (outputs.has(id)) steps[id] = outputs.get(id);
    }
    return { slots: opts.slots ?? {}, context: opts.context ?? {}, steps };
  }

  private poisonDescendants(from: string, graph: SkillGraph, poisoned: Set<string>): void {
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of graph.edges) {
        if (e.from === cur && !poisoned.has(e.to)) {
          poisoned.add(e.to);
          queue.push(e.to);
        }
      }
    }
  }

  private async runNode(ctx: NodeRunContext): Promise<GraphNodeResult> {
    const base = { nodeId: ctx.node.id, kind: ctx.node.kind, layer: ctx.layer, visibleFrom: ctx.visibleFrom };
    let resolvedParams: Record<string, unknown>;
    try {
      resolvedParams = resolveTemplate(ctx.node.params, ctx.scope) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof TemplateResolutionError) {
        return {
          ...base,
          status: "FAILED",
          error: {
            code: ErrorCodes.TEMPLATE_RESOLUTION_ERROR,
            // 诚实报因：多半是「引用了一个没有边连过来的节点」——边没连，数据就不该流过来。
            message: `节点「${ctx.node.id}」无法解析模板引用 ${e.ref}；本节点可见的上游为 [${ctx.visibleFrom.join(", ") || "（无）"}]——引用图上没有边连过来的节点是不允许的`,
          },
        };
      }
      throw e;
    }

    try {
      const output =
        ctx.node.kind === "skill"
          ? await this.runSkillNode(ctx.auth, resolvedParams)
          : await this.runSolverNode(ctx.auth, resolvedParams);
      return { ...base, status: "COMPLETED", output, resolvedParams };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return {
        ...base,
        status: "FAILED",
        resolvedParams,
        error: { code: typeof err.code === "string" ? err.code : "NODE_FAILED", message: err.message ?? String(e) },
      };
    }
  }

  /**
   * `skill` 节点：按 key 载入本租户 Skill（R2 tenant_id everywhere）。
   *
   * 产物刻意包含 `solverKeys` —— 把 Skill 的 `references[kind=solver]` 摊平，供下游 `solver` 节点
   * 直接引用。这正是 PRD §8.3「引用可校验」的运行期一面：Skill 声明它要用哪个求解器，
   * 图把这个声明**真的**接到了求解调用上，而不是让它躺在元数据里没人读。
   */
  private async runSkillNode(auth: ToolAuthCtx, params: Record<string, unknown>): Promise<unknown> {
    const skillKey = params.skillKey;
    if (typeof skillKey !== "string" || skillKey.length === 0) {
      throw Object.assign(new Error("skill 节点缺少 params.skillKey"), { code: ErrorCodes.VALIDATION_ERROR });
    }
    const skill = await this.deps.repos.skills.latestByKey(auth.tenantId, skillKey);
    if (!skill || skill.tenantId !== auth.tenantId) {
      throw Object.assign(new Error(`skill not found: ${skillKey}`), { code: "SKILL_NOT_FOUND" });
    }
    const refs = skill.references ?? [];
    return {
      skillId: skill.id,
      key: skill.key,
      version: skill.version,
      status: skill.status,
      capability: skill.capability,
      sideEffect: skill.sideEffect,
      /** references 里 kind=solver 的 key（按声明序）——下游 solver 节点的输入。 */
      solverKeys: refs.filter((r) => r.kind === "solver").map((r) => r.key),
      ruleKeys: refs.filter((r) => r.kind === "rule").map((r) => r.key),
      inputSchema: skill.inputSchema ?? null,
    };
  }

  /**
   * `solver` 节点：经既有 OBO 通道调 DataCore 求解器。
   *
   * 诚实边界：本切片**不传 `signal`**（`SolverClient.invoke` 的第 4 参）——取消补线是 PRD §5 / W3 单，
   * 不在 S1 范围。不传 = 现行为（不可取消），与 `tools/executor.ts:401` 今天的状态一致，
   * 不假装已经做了。
   */
  private async runSolverNode(auth: ToolAuthCtx, params: Record<string, unknown>): Promise<unknown> {
    const solverKey = params.solverKey;
    if (typeof solverKey !== "string" || solverKey.length === 0) {
      throw Object.assign(new Error("solver 节点缺少 params.solverKey"), { code: ErrorCodes.VALIDATION_ERROR });
    }
    const args = (params.args ?? {}) as Record<string, unknown>;
    const payload = await this.deps.dataCore.solver.invoke(auth, solverKey, args);
    return { solverKey, data: payload.data, snapshotVersion: payload.snapshotVersion };
  }
}

/**
 * ── 本切片明确未做（诚实边界，勿当已完成）────────────────────────────────────────
 *  · 三处扇出收编（executor.ts 线性 / multi-route.ts 多域 / Coordinator）—— PRD §3.4，属 W2 单。
 *  · 取消到底（AbortSignal 透传到 solver.invoke 第 4 参）—— PRD §5，属 W3 单。
 *  · 按题型预算 / RuntimeContext 统一工厂 / progress 事件 —— PRD §4/§6，属 W3 单。
 *  · dependsOn 编译期内联展开 —— PRD §8.1，属 W4 单。
 *  · rule/agent/human/slice/render/mcp/compose 节点 —— 编译期 NOT_IMPLEMENTED 显式拒绝。
 */
