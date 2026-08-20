/**
 * Skill Graph 调度器（GraphScheduler）· `docs/PRD-skill-runtime-orchestrator.md` §3.4
 *
 * WO-SKILL-ORCHESTRATOR-S1 切片：**按层执行 · 同层并发 · 数据沿边流动**。
 *
 * ── 与既有线性执行器的关系 ──────────────────────────────────────────────────────
 * `workflow/executor.ts` 的 `for (const step of input.steps)` 是逐个 await 的**线性**执行器。
 * 本文件不动它、不替换它（理由见文末 §未收编），只在旁边加**图调度**：拓扑波前 + 同层并发。
 *
 * ── WO-GRAPH-EXEC-CONSOLIDATE（2026-08-20）：扇出调度已收编 ────────────────────
 * 本文件下方的 `runLayeredGraph` 现在是 **agentcore 里唯一的多单元并发派发实现**。
 * `router/execute-plan.ts`（组内 Promise.all）与 `router/multi-route.ts`（多域 Promise.all）
 * 原各自写了一遍同一个调度循环，现均已**删除自己的循环**改调本核心（不是包一层）。
 * 并发派发站点数由 `test/graph-exec-consolidate.seam.test.ts` 现算并具名断言 ——
 * 再写第 N 套，机器先说话。
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
// `render` 节点复用**线性执行器同一个** `renderAnswer`（PRD §3.1「复用今天 executor 的同一 switch 体」）。
// 另写一个「图专用渲染器」= 两条路会渐渐渲染出不一样的答案，而两边测试各自全绿。
import { renderAnswer, type ExtendedPlanStep, type StepAudit } from "./workflow/executor.js";
import type { Metrics } from "./metrics.js";
import type { Answer } from "@platform/contracts";

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
  /**
   * 工具审计留痕（供下游 `render` 节点产 provenance，R13）。
   * ⚠ 诚实边界：`ToolPayload`（`contracts/common.ts:18`）只有 `{data, snapshotVersion}`，
   * **没有 toolCallId** —— 故 solver 节点这里给不出真的 toolCallId，
   * `renderAnswer` 会按它既有的兜底填 `"unknown"`。这是**既存**的形状缺口，不是本单新造的，
   * 也不假装已经有了；要补得先给 `SolverClient.invoke` 的返回加上 toolCallId。
   */
  audit?: StepAudit;
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
  /**
   * `render` 节点要的：`renderAnswer` 内部会在扫出未溯源数值时打点
   * （`metrics.unverifiedNumerics`）。复用既有渲染实现就得把它的依赖一起带上，
   * 少带 = 只能另写一个「不打点的渲染器」= 第二套实现。
   */
  metrics: Metrics;
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
  /**
   * 祖先节点的**原始产物**与**审计留痕**（同样只装祖先的，与 `scope.steps` 一个口径）。
   * `render` 节点要靠它们生成 provenance —— 没有边连过来的节点，它的数既进不了模板，
   * 也进不了溯源，两处一致。
   */
  visibleOutputs: Record<string, unknown>;
  visibleAudits: Record<string, StepAudit>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 分层扇出调度核心（WO-GRAPH-EXEC-CONSOLIDATE 收编点）
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * **仓内唯一的多单元并发派发实现**。收编前 agentcore 有三处各写一遍同一个循环：
 *  · `skill-orchestrator.ts`  层内 `Promise.allSettled` 分批（本文件·原 GraphScheduler.run 内联）
 *  · `router/execute-plan.ts` 按 `parallelGroup` 升序·组内 `Promise.all`·组间串行
 *  · `router/multi-route.ts`  单层 `Promise.all` 跑各域 solver
 * 三处的**调度骨架完全相同**（分层 → 层内并发 → 层间串行 → 按声明序落账），
 * 差的只是**两件事**，而这两件恰恰是本收编真正会咬人的地方：
 *
 * ① **一个分支失败时另几个怎么办**（`settle` 回调决定）
 *    · GraphScheduler：毒化后继（`poisonDescendants`）——失败节点的下游整棵子树 SKIPPED
 *    · executePlan / runParallelRoutes：**继续**——失败只体现在该单元产物的 `ok=false`，
 *      下游 `argsFrom` 取不到值就不填（`if (v != null)`），兄弟与下游照跑
 *    ⚠️ 这两条语义**不可互换**：把 continue 换成 poison，多域分路里一个 solver 挂掉就会
 *    吞掉其余域的诚实产出（违反 multi-route 的 R7「单失败不塌」）。故**策略留在调用方**，
 *    核心只管调度骨架 —— 这正是三处能合而语义零变的原因。
 *
 * ② **节点抛异常时整体上抛还是转成产物**（`onNodeThrow`）
 *    · `"propagate"` ≡ 旧 `Promise.all`：首个 reject 直接上抛（executePlan / runParallelRoutes
 *      逐字节沿用——它们的 `executor.run` 契约上**从不抛**（`tools/executor.ts` 顶注：
 *      "Client exceptions wrapped as { ok:false, payload:{ error } } — never thrown"），
 *      真抛出来的只可能是 `emit` 之类的编排层异常，那时上抛才是对的）
 *    · `"capture"` ≡ 旧 `Promise.allSettled`：转成 NODE_UNCAUGHT 产物（GraphScheduler 沿用）
 *
 * 落账顺序恒为**批内声明序**（不是完成序）——R6 确定性：网络抖动不改输出字节。
 */
export interface LayeredDispatchSpec<T> {
  /** 分层：每层一组可并发的单元 id；**层间严格串行**（后层可见前层落账）。 */
  layers: readonly (readonly string[])[];
  /** 单元执行体。 */
  runNode: (nodeId: string) => Promise<T>;
  /** 层内并发上限；省略/≤0 ⇒ 整层一批（等价旧 `Promise.all(all.map(...))` 的无上限并发）。 */
  concurrency?: number;
  /** 见上 ②。 */
  onNodeThrow: "propagate" | "capture";
  /** `onNodeThrow:"capture"` 必给：把 reject 理由转成产物。 */
  captureThrow?: (nodeId: string, reason: unknown) => T;
  /**
   * 见上 ①。**一批跑完后按批内声明序**逐个调用；副作用（记上游输出、毒化后继）都在这里做。
   * 因为它在整批 await 之后才跑，同批单元互相看不见对方的落账（组内无依赖的前提）。
   */
  settle?: (nodeId: string, result: T) => void;
  /** 返回 true ⇒ 该单元**不执行** `runNode`，直接取 `skipped()` 产物（毒化传播）。 */
  isSkipped?: (nodeId: string) => boolean;
  /** `isSkipped` 命中时的产物。 */
  skipped?: (nodeId: string) => T;
}

/**
 * 分层扇出执行（**本仓唯一的图/扇出调度实现**）。
 *
 * ⛔ 要再写一个 `Promise.all(nodes.map(...))` 之前先读这里：
 * `graph-exec-consolidate.seam.test.ts` 现算 agentcore src 里的并发派发站点数并逐个具名断言，
 * 新增一处未登记的就当场变红并点名文件 —— 这道数就是为了不让「四套」变回「五套」。
 */
export async function runLayeredGraph<T>(spec: LayeredDispatchSpec<T>): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const limit = spec.concurrency !== undefined && spec.concurrency > 0 ? spec.concurrency : Number.POSITIVE_INFINITY;
  for (const layer of spec.layers) {
    const size = Number.isFinite(limit) ? (limit as number) : Math.max(1, layer.length);
    for (let i = 0; i < layer.length; i += size) {
      const batch = layer.slice(i, i + size);
      const tasks = batch.map(async (id): Promise<T> => {
        // 毒化判定放在**任务体内**（与收编前一致）：整批任务同步起跑，故同批互不影响，
        // 而前批/前层的 settle 已经跑完 ⇒ 上游失败对本批可见。
        if (spec.isSkipped?.(id) === true) return spec.skipped!(id);
        return spec.runNode(id);
      });
      let values: T[];
      if (spec.onNodeThrow === "propagate") {
        values = await Promise.all(tasks); // ≡ 收编前的 Promise.all：首个 reject 整体上抛
      } else {
        const settled = await Promise.allSettled(tasks); // ≡ 收编前的 Promise.allSettled
        values = settled.map((s, k) => (s.status === "fulfilled" ? s.value : spec.captureThrow!(batch[k]!, s.reason)));
      }
      for (let k = 0; k < batch.length; k++) {
        const id = batch[k]!;
        const v = values[k]!;
        out.set(id, v);
        spec.settle?.(id, v);
      }
    }
  }
  return out;
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
    /** 已完成节点的审计留痕：nodeId -> StepAudit。`render` 节点据此产 provenance（R13）。 */
    const audits = new Map<string, StepAudit>();
    const results = new Map<string, GraphNodeResult>();
    /** 被上游 FAIL 掐断的节点（及其后继）。 */
    const poisoned = new Set<string>();

    const concurrency = Math.max(1, graph.maxParallelNodes);

    // 调度骨架已收编进 `runLayeredGraph`（本文件上方·仓内唯一实现）；此处只留**本路独有的语义**：
    // 毒化后继（`settle`）+ 上游失败即跳过（`isSkipped`）+ 未捕获异常转产物（`captureThrow`）。
    // 层内**有上限**并发（PRD §3.4：不许无上限）由 `concurrency` 表达，分批行为与收编前逐字节一致。
    const scheduled = await runLayeredGraph<GraphNodeResult>({
      layers: compiled.layers.map((l) => l.nodeIds),
      concurrency,
      onNodeThrow: "capture",
      runNode: async (id) => {
        const node = byId.get(id)!;
        const visibleFrom = ancestorsOf(id, compiled.predecessors);
        const scope = this.scopeFor(visibleFrom, outputs, opts);
        // `render` 节点靠祖先的**原始产物 + 审计留痕**产 provenance（R13）。
        // 同样只装祖先的，与 `scope.steps` 一个口径：没有边连过来的节点，
        // 它的数既进不了模板，也进不了溯源 —— 两处不许各有各的可见性。
        const visibleOutputs: Record<string, unknown> = {};
        const visibleAudits: Record<string, StepAudit> = {};
        for (const a of visibleFrom) {
          if (outputs.has(a)) visibleOutputs[a] = outputs.get(a);
          const au = audits.get(a);
          if (au) visibleAudits[a] = au;
        }
        return this.runNode({
          auth,
          node,
          layer: layerOf.get(id) ?? 0,
          scope,
          visibleFrom,
          visibleOutputs,
          visibleAudits,
        });
      },
      isSkipped: (id) => poisoned.has(id),
      skipped: (id) => ({
        nodeId: id,
        kind: byId.get(id)!.kind,
        layer: layerOf.get(id) ?? 0,
        status: "SKIPPED",
        error: { code: "UPSTREAM_FAILED", message: "上游节点失败，本节点未执行" },
      }),
      captureThrow: (id, reason) => ({
        nodeId: id,
        kind: byId.get(id)!.kind,
        layer: layerOf.get(id) ?? 0,
        status: "FAILED",
        error: { code: "NODE_UNCAUGHT", message: reason instanceof Error ? reason.message : String(reason) },
      }),
      settle: (id, r) => {
        if (r.status === "COMPLETED") {
          outputs.set(id, r.output);
          // 审计与产物同批落账，供下游 render 取用（不另开第二条时序）
          if (r.audit) audits.set(id, r.audit);
        } else if (byId.get(id)!.onError !== "SKIP") {
          // onError=FAIL（缺省）→ 毒化全部后继（与今天 executor 的 SKIP 语义互补）
          this.poisonDescendants(id, graph, poisoned);
        }
      },
    });
    for (const [id, r] of scheduled) results.set(id, r);

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
      // 派发按 kind 显式三分。**不要写成二选一的三元表达式** —— 新增 kind 时
      // 「忘了加分支」会被静默归到 else 那一路（本仓最贵的错法之一）。
      // 编译期 `IMPLEMENTED_NODE_KINDS` 已挡掉其余 kind，故 default 只可能是两者不同步时到达。
      switch (ctx.node.kind) {
        case "skill": {
          const output = await this.runSkillNode(ctx.auth, resolvedParams);
          return { ...base, status: "COMPLETED", output, resolvedParams };
        }
        case "solver": {
          const { output, audit } = await this.runSolverNode(ctx.auth, resolvedParams);
          return { ...base, status: "COMPLETED", output, resolvedParams, audit };
        }
        case "render": {
          const output = this.runRenderNode(ctx, resolvedParams);
          return { ...base, status: "COMPLETED", output, resolvedParams };
        }
        default:
          throw Object.assign(
            new Error(
              `节点「${ctx.node.id}」kind=${ctx.node.kind} 过了编译期 IMPLEMENTED_NODE_KINDS 却没有派发分支 —— ` +
                `契约与调度器不同步（加 kind 到 IMPLEMENTED_NODE_KINDS 就是承诺这里有分支）`,
            ),
            { code: "NODE_DISPATCH_MISSING" },
          );
      }
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
  private async runSolverNode(
    auth: ToolAuthCtx,
    params: Record<string, unknown>,
  ): Promise<{ output: unknown; audit: StepAudit }> {
    const solverKey = params.solverKey;
    if (typeof solverKey !== "string" || solverKey.length === 0) {
      throw Object.assign(new Error("solver 节点缺少 params.solverKey"), { code: ErrorCodes.VALIDATION_ERROR });
    }
    const args = (params.args ?? {}) as Record<string, unknown>;
    const payload = await this.deps.dataCore.solver.invoke(auth, solverKey, args);
    return {
      output: { solverKey, data: payload.data, snapshotVersion: payload.snapshotVersion },
      // toolName 必须逐字是 "invoke_solver"：`renderAnswer` 靠它决定走 `enrichProvenance`
      // 那条富化路（`executor.ts` 同一判断），写别的名字会静默降级成 `{source:"TOOL_RESULT"}`。
      audit: {
        toolCallId: "unknown", // 见 GraphNodeResult.audit 头注：ToolPayload 里没有它
        toolName: "invoke_solver",
        ...(payload.snapshotVersion ? { snapshotVersion: payload.snapshotVersion } : {}),
      },
    };
  }

  /**
   * `render` 节点（R11 收口点）· PRD §3.1 表：`render` ↔ 今日 `render_answer`。
   *
   * ── 语义边界 ────────────────────────────────────────────────────────────────
   * · **输入**：`params.blocks` —— 与今日 `render_answer` 步骤**逐字段同构**的
   *   `AnswerBlockTemplate[]`。块里用同一套 `{{steps.<nodeId>.output...}}` 语法引用上游产物，
   *   由**同一个** `resolveTemplate` 在本节点的**祖先作用域**上求值（`runNode` 里已统一做完）。
   *   ⇒ 没有边连过来的节点，render **引用不到**：R11 的「链要汇进 render」与
   *      「数据只沿边流动」是同一件事的两面，不是两条各管各的规则。
   * · **输出**：一个 `Answer`（`{trustLevel, blocks, provenance, unverifiedNumerics}`）——
   *   就是 QOS 的答案信封。消费方 = 本路由的 REST 响应（`POST /b/v1/skill-graphs/run`
   *   的 `nodeResults[].output`）；接进 SSE `answer` 帧 / 前端 renderer 分发属**后续单**，
   *   本单没做，**不假装做了**（见文末「未做」）。
   * · **一张图几个**：恰好一个，由 `compileGraph` 的 R11 校验保证（见
   *   `skill-graph.ts assertRenderClosure` 头注：多个 render ⇒ 哪个才是答案没有答案）。
   *
   * ── trustLevel 为什么钉死 VERIFIED_WORKFLOW ──────────────────────────────────
   * 编译期 `IMPLEMENTED_NODE_KINDS` 只放行 `skill`/`solver`/`render`，
   * 三者 `determinismOf` 全是 `PURE`（`agent`/`compose` 那两个 LLM kind today 编译即拒）
   * ⇒ 今天能编译出来的图**按构造不含 LLM 节点**，等价于线性侧的 Path A。
   * ⚠ 这条推理**依赖「LLM kind 仍未实现」这个前提**：放开 `agent`/`compose` 的那一单
   *   必须回来把它改成按 `execution.mode` / 节点 determinism 派生，否则这里会开始说谎。
   */
  private runRenderNode(ctx: NodeRunContext, params: Record<string, unknown>): Answer {
    const blocks = params.blocks;
    if (!Array.isArray(blocks)) {
      throw Object.assign(
        new Error(
          `render 节点「${ctx.node.id}」缺少 params.blocks（应为 AnswerBlockTemplate[]，与今日 render_answer 步骤同构）`,
        ),
        { code: ErrorCodes.VALIDATION_ERROR },
      );
    }
    return renderAnswer(
      blocks as Record<string, unknown>[],
      ctx.visibleAudits,
      "VERIFIED_WORKFLOW",
      this.deps.metrics,
      ctx.visibleOutputs,
    );
  }
}

/**
 * ── §未收编：还剩哪一套，以及为什么（诚实边界，勿当已完成）──────────────────────
 *
 * **`workflow/executor.ts` 的线性执行器（本仓仅存的第二套）—— 本单实测判定「今天收不动」**，
 * 三条具体阻碍（不是"风险大"这种话，是机器可核的差异）：
 *  ① **早退带值**：它在循环中途 `return completed(answer)` 至少三处（工具 DENIED → 返回权限文案答案；
 *     `evaluate_rules` 出 BLOCK 裁决 → 返回违规答案；`render_answer` → 返回渲染答案）。
 *     分层调度器的契约是「跑完整层」，**表达不了「跑到一半就带着一个成品答案退出、后面的步一个都不跑」**。
 *  ② **步间共享可变作用域**：`scope.steps` 直接指向 `stepOutputs` 这一个对象，第 i 步能读到第 i-1 步刚写的值；
 *     GraphScheduler 的作用域是**按祖先集现搭**的（`scopeFor(visibleFrom, …)`，无边即读不到）。
 *     线性执行器的既有工作流**依赖**"前面所有步都可见"，换成祖先可见性会让它们批量报 TEMPLATE_RESOLUTION_ERROR。
 *  ③ **步类型不重合**：线性侧 8 类（含 llm_compose / invoke_agent / invoke_mcp_tool / render_answer 等），
 *     图侧只实现 skill / solver 两类，其余在编译期显式 NOT_IMPLEMENTED。且它有 4 个生产调用方
 *     （`engine.runWorkflowSteps` ← path-A / Coordinator 多角色扇出 / plan-builder / server 工作流试跑）。
 * ⇒ 收它是**重写线性执行器**，不是收编调度骨架；应单独立单，先补 ①②③ 三项语义再谈。
 *
 * ── 其余明确未做 ──────────────────────────────────────────────────────────────
 *  · 取消到底（AbortSignal 透传到 solver.invoke 第 4 参）—— PRD §5，属 W3 单。
 *  · 按题型预算 / RuntimeContext 统一工厂 / progress 事件 —— PRD §4/§6，属 W3 单。
 *  · dependsOn 编译期内联展开 —— PRD §8.1，属 W4 单。
 *  · rule/agent/human/slice/mcp/compose 节点 —— 编译期 NOT_IMPLEMENTED 显式拒绝。
 *    （`render` 已于 WO-SKILL-GRAPH-RENDER-CLOSURE 落地，故从本行移出。）
 *  · **`render` 产出的 `Answer` 只回在本路由的 JSON 响应里**：接进 SSE `answer` 帧 /
 *    前端 renderer 分发**没做**。判据：`grep -rn "skill-graphs/run" apps/frontend-shell/src` 零命中
 *    （本体 §8 `G-BE-FE-SEAM-DEAD` 记的就是这一条）。「图能产出答案」≠「屏上看得见答案」。
 *  · solver 节点的 `toolCallId` 恒 `"unknown"` —— `ToolPayload` 里没有这个字段（既存缺口，非本单新造）。
 */
