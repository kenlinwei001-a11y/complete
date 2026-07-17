import { AggregateRequestSchema, ErrorCodes, parseMcpToolFullName, parseSolverMcpToolName, QueryTimeseriesAggInputSchema, type SkillDefinition } from "@platform/contracts";
import { newId } from "../ids.js";
import { SKILL_RESOURCE_TEXT_LIMIT } from "../agent/context.js";
import type { Metrics } from "../metrics.js";
import type { Repos, ToolCallRow } from "../persistence/repos.js";
import { byteLength, digest, redact } from "../util/redact.js";
import { cosine, pseudoEmbed } from "../util/embedding.js";
import { BudgetTracker } from "./budget.js";
import { builtinTool } from "./registry.js";
import { DataCoreUnavailableError, type DataCoreClient, type ToolAuthCtx } from "./clients.js";
import type { McpClientPort } from "../mcp/types.js";
import type { SkillResourceReader } from "./skill-resources.js";

export type ToolBinding = { kind: "BUILTIN" } | { kind: "MCP"; mcpConfigId: string };

export interface ToolRunResult {
  ok: boolean;
  payload: unknown;
  toolCallId: string;
  outcome: "OK" | "DENIED" | "ERROR" | "BUDGET_EXCEEDED";
  durationMs: number;
}

export interface ExecutorOptions {
  taskId: string;
  ctx: ToolAuthCtx;
  /** Path B / agent runs only — shared across nested invocations. */
  budget?: BudgetTracker;
  /** Agent scopeDeclaration.toolNames — calls outside it are rejected regardless of user perms. */
  scopeToolNames?: string[];
}

export interface ExecutorDeps {
  dataCore: DataCoreClient;
  mcp?: McpClientPort;
  repos: Repos;
  metrics: Metrics;
  /** 增量 §3：read_skill_resource 的附件内容读取端口（缺省 → 仅返回元信息）。 */
  skillResources?: SkillResourceReader;
}

const OUTPUT_LIMIT = 64 * 1024;

function withTimeout<T>(p: Promise<T>, ms: number | undefined, label: string): Promise<T> {
  if (!ms) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * GuardedToolExecutor (QOS-PRD §7.3): IamClient.check → Budget(path B) → client call →
 * tool_calls audit. Client exceptions wrapped as { ok:false, payload:{ error } } — never thrown.
 */
export class GuardedToolExecutor {
  /** §13.1 任务级快照锚点：本执行器（=一次任务运行）首读时捕获，之后复用。 */
  private taskEpoch?: number;
  /** #6 任务内 READ 结果缓存（key=tool|canonicalArgs）；与任务级快照同生命周期。 */
  private readonly readCache = new Map<string, unknown>();

  constructor(
    private readonly deps: ExecutorDeps,
    private readonly opts: ExecutorOptions,
  ) {}

  /** 首读捕获租户 epoch；失败（如 DataCore 不支持）则返回 undefined → 读路径退化为活数据。 */
  private async taskSnapshotEpoch(ctx: ToolAuthCtx): Promise<number | undefined> {
    if (this.taskEpoch !== undefined) return this.taskEpoch;
    try {
      this.taskEpoch = (await this.deps.dataCore.epoch.current(ctx)).epoch;
    } catch {
      this.taskEpoch = undefined;
    }
    return this.taskEpoch;
  }

  get authCtx(): ToolAuthCtx {
    return this.opts.ctx;
  }

  async run(
    toolName: string,
    input: unknown,
    options?: {
      binding?: ToolBinding;
      timeoutMs?: number;
      /**
       * 增量 §5：并行 READ 轮的预算确定性 —— 循环侧按 tool_use 顺序预先计数，
       * 此处不再重复消耗（{ok:false} 直接回 BUDGET_EXCEEDED）。
       */
      budgetDecision?: { ok: true } | { ok: false; reason: string };
      /** 约束执行层 stage3②：声明此工具输出应符合的本体对象类型 → 运行时强制校验,不符拒（信任边界）。 */
      expectsObjectType?: string;
    },
  ): Promise<ToolRunResult> {
    const started = Date.now();
    const binding = options?.binding ?? { kind: "BUILTIN" as const };

    // 0) agent scopeDeclaration gate (platform PRD §6.3 Q2 — independent of user perms)
    if (this.opts.scopeToolNames && !this.opts.scopeToolNames.includes(toolName)) {
      return this.finish(toolName, input, { error: ErrorCodes.AGENT_SCOPE_VIOLATION }, "DENIED", started, false);
    }

    // 0.5) OBO token about to expire (<60s) → refuse to start new tool calls (platform PRD §11)
    const exp = this.opts.ctx.tokenExpiresAt;
    if (exp !== undefined && exp * 1000 - Date.now() < 60_000) {
      this.deps.metrics.oboDenied.inc();
      return this.finish(toolName, input, { error: "OBO_TOKEN_EXPIRING" }, "DENIED", started, false);
    }

    // A1 求解器 MCP 工具：mcp__solvers__{key} → 复用既有 invoke_solver 执行路径（OBO 到 DataCore，零重写）。
    // scope 门已用原名校验（line 110），此处归一到 invoke_solver 供下游分发；审计名亦记为 invoke_solver。
    const solverKeyFromMcp = parseSolverMcpToolName(toolName);
    if (solverKeyFromMcp) {
      const inp = (input ?? {}) as Record<string, unknown>;
      toolName = "invoke_solver";
      input = { solverKey: solverKeyFromMcp, args: (inp.args as Record<string, unknown>) ?? {} };
    }

    // 1) coarse-grained IAM check
    try {
      const verdict = await this.deps.dataCore.iam.check(this.opts.ctx, toolName, input);
      if (!verdict.allowed) {
        return this.finish(
          toolName,
          input,
          { error: "PERMISSION_DENIED", reason: verdict.reason ?? "无权访问" },
          "DENIED",
          started,
          false,
        );
      }
    } catch (err) {
      return this.finish(toolName, input, wrapError(err), "ERROR", started, false);
    }

    // 2) budget (path B only)；并行轮由循环侧预计数（budgetDecision 传入）
    if (options?.budgetDecision) {
      if (!options.budgetDecision.ok) {
        return this.finish(
          toolName,
          input,
          { error: "BUDGET_EXCEEDED", reason: options.budgetDecision.reason },
          "BUDGET_EXCEEDED",
          started,
          false,
        );
      }
    } else if (this.opts.budget) {
      const cost = builtinTool(toolName)?.costClass ?? "CHEAP";
      const ok = this.opts.budget.tryConsume(cost);
      if (!ok.ok) {
        return this.finish(toolName, input, { error: "BUDGET_EXCEEDED", reason: ok.reason }, "BUDGET_EXCEEDED", started, false);
      }
    }

    // 3) client call — #6 任务内 READ 结果记忆化（仅 BUILTIN READ；COMPUTE/写/MCP 不缓存，
    // 因 invoke_solver 等有副作用如 M11 forecastSnapshots/calibrationForecasts，缓存会破坏其契约）。
    // 与 #2 任务级快照一致：任务内 READ 一致，故缓存正确；仍走 finish() 记 tool_call 以保溯源。
    const cacheable = binding.kind === "BUILTIN" && builtinTool(toolName)?.sideEffect === "READ";
    const ckey = cacheable ? `${toolName}|${canonicalArgs(input)}` : "";
    if (cacheable && this.readCache.has(ckey)) {
      return this.finish(toolName, input, this.readCache.get(ckey), "OK", started, true);
    }
    try {
      const payload = await withTimeout(this.dispatch(toolName, input, binding), options?.timeoutMs, toolName);
      // stage3②：声明了 expectsObjectType → 工具输出按本体对象类型 schema/值域强制校验,不符拒（DENIED）。
      if (options?.expectsObjectType) {
        const p = payload as { rows?: unknown; data?: unknown };
        const rowsRaw = Array.isArray(p?.rows) ? p.rows : Array.isArray(p?.data) ? p.data : Array.isArray(payload) ? payload : [];
        const rows = (rowsRaw as unknown[]).filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
        if (rows.length > 0) {
          const vr = await this.deps.dataCore.ontology.validateOutput(this.opts.ctx, options.expectsObjectType, rows);
          if (!vr.ok) {
            return this.finish(toolName, input, { error: "ONTOLOGY_VALIDATION_FAILED", objectType: options.expectsObjectType, violations: vr.violations }, "DENIED", started, false);
          }
        }
      }
      if (cacheable) this.readCache.set(ckey, payload);
      return this.finish(toolName, input, payload, "OK", started, true);
    } catch (err) {
      return this.finish(toolName, input, wrapError(err), "ERROR", started, false);
    }
  }

  private async dispatch(toolName: string, input: unknown, binding: ToolBinding): Promise<unknown> {
    const ctx = this.opts.ctx;
    if (binding.kind === "MCP") {
      if (!this.deps.mcp) throw new Error("MCP client not configured");
      // 增量 §4.2：模型可见名/审计名是 mcp__{serverName}__{toolName} 全名；
      // 调下游 MCP server 时还原为原始工具名（invoke_mcp_tool 旧形态原名直传兼容）。
      const parsed = parseMcpToolFullName(toolName);
      const rawName = parsed?.toolName ?? toolName;
      return this.deps.mcp.callTool(binding.mcpConfigId, rawName, input as Record<string, unknown>);
    }
    const args = (input ?? {}) as Record<string, unknown>;
    switch (toolName) {
      case "discover": {
        const kind = String(args.kind);
        if (kind !== "object_types" && kind !== "slices" && kind !== "solvers" && kind !== "mcp_tools") {
          return { error: "kind must be object_types|slices|solvers|mcp_tools" };
        }
        if (kind === "object_types") {
          // CL.3：列本租户真实已发布对象类型名（agent 照真名查不再猜）。
          const q = args.query ? String(args.query).toLowerCase() : undefined;
          const types = await this.deps.dataCore.ontology.listObjectTypes(ctx);
          const items = q ? types.filter((t) => t.key.toLowerCase().includes(q) || t.label.includes(String(args.query))) : types;
          return { items, hint: "用 query_objects 时 objectType 必须是上列真实 key（区分大小写）；勿猜英文名。" };
        }
        if (kind === "mcp_tools") {
          // §2 MCP 按需加载目录：当前部署未启用 >24 工具按需加载模式 → 空目录
          return { items: [] };
        }
        return this.deps.dataCore.catalog.discover(ctx, kind, args.query ? String(args.query) : undefined);
      }
      case "resolve_slice":
        return this.deps.dataCore.ontology.resolveSlice(
          ctx,
          String(args.sliceKey),
          (args.args ?? {}) as Record<string, unknown>,
        );
      case "plan_slice": {
        const req: {
          rootType: string;
          targets: string[];
          maxHops: number;
          question?: string;
        } = {
          rootType: String(args.rootType),
          targets: Array.isArray(args.targets) ? args.targets.map(String) : [],
          maxHops: args.maxHops === undefined ? 6 : Number(args.maxHops),
        };
        if (args.question !== undefined) req.question = String(args.question);
        const res = await this.deps.dataCore.ontology.planSlice(ctx, req);
        if (!res.ok) return res;
        // A3-SUITE-2：新规划的切片必须登记为一等 SliceSpec，后续 resolve_slice 才能消费。
        if (!res.plan.reused) {
          const spec = {
            root: { typeKey: res.plan.rootType, selector: {} as Record<string, unknown> },
            paths: res.plan.paths.map((p) =>
              p.hops.map((h) => ({ linkKey: h.linkKey, direction: h.direction as "out" | "in" }))
            ),
          };
          await this.deps.dataCore.ontology.putSliceSpec(ctx, res.plan.sliceKey, spec);
        }
        return {
          planned: true,
          reused: res.plan.reused,
          sliceKey: res.plan.sliceKey,
          rootType: res.plan.rootType,
          spannedDomains: res.plan.spannedDomains,
          pathCount: res.plan.paths.length,
          plan: res.plan,
        };
      }
      case "query_objects": {
        // CL.3：未知 typeKey → 结构化 UNKNOWN_TYPE + did-you-mean（不静默返空，agent 据此改名重查）。
        const dym = await this.unknownTypeGuard(ctx, String(args.objectType));
        if (dym) return dym;
        const res = await this.deps.dataCore.ontology.queryObjects(
          ctx,
          String(args.objectType),
          (args.filter ?? {}) as Record<string, unknown>,
          args.limit === undefined ? undefined : Math.min(Number(args.limit), 200),
          // 并发一致性 §13.1：任务内首读捕获 taskEpoch，后续读复用 → 任务级快照一致（近似 MVCC）
          await this.taskSnapshotEpoch(ctx),
        );
        // CL.3：类型存在但 0 实例 → 区分"空 vs 不存在"，提示先引导（接 bootstrap/gap-fill），不让 agent 误判无数据。
        const total = (res?.data as { total?: number } | undefined)?.total;
        if (total === 0) return { ...res, empty: true, hint: `对象类型 ${String(args.objectType)} 存在但 0 实例：可能租户未引导，请先 run_synthetic/bootstrap 合成计划域，而非判定"无数据"。` };
        return res;
      }
      case "get_object": {
        const dym = await this.unknownTypeGuard(ctx, String(args.objectType));
        if (dym) return dym;
        return this.deps.dataCore.ontology.getObject(ctx, String(args.objectType), String(args.objectId));
      }
      // Dogfooding P3：问运行中的系统自己（受 DataCore MetaAccessPolicy 白名单门控,OBO 透传）。
      case "query_system_ontology":
        return this.deps.dataCore.ontology.queryMetaOntology(ctx);
      case "get_breakpoint":
        return this.deps.dataCore.ontology.getMetaBreakpoint(ctx, String(args.id));
      case "impact_of":
        return this.deps.dataCore.ontology.metaImpact(ctx, String(args.node));
      case "aggregate_objects":
        // 治理增量 §3.6 / G8：contracts IO 强校验，聚合下推（避免拉全量行）。
        return this.deps.dataCore.ontology.aggregateObjects(ctx, AggregateRequestSchema.parse(input));
      case "invoke_solver":
        return this.deps.dataCore.solver.invoke(ctx, String(args.solverKey), (args.args ?? {}) as Record<string, unknown>);
      case "evaluate_rules":
        return this.deps.dataCore.rules.evaluate(
          ctx,
          args.ruleIds as string[] | "ALL_APPLICABLE",
          args.payload,
        );
      // CL.2 合规数据生成：触发确定性合成/建域（**触发合成 ≠ 伪造**），落未审核态（PROVISIONAL）。
      // 回执只含元信息 + provisional 标记；业务数字由 agent 后续 query_* 读回真实物化值（铁律自洽）。
      case "fill_data": {
        const r = await this.deps.dataCore.ontology.fillData(ctx, {
          typeKey: String(args.typeKey),
          fields: (args.fields ?? []) as string[],
          ...(args.rows === undefined ? {} : { rows: Number(args.rows) }),
          ...(args.seed === undefined ? {} : { seed: Number(args.seed) }),
        });
        return { ...r, provisional: true, _note: "未审核合成数据（PROVISIONAL）：业务数字请用 query_objects 读回真实物化值；转正经 create_action_draft 走审批。" };
      }
      case "run_synthetic": {
        const r = await this.deps.dataCore.datagen.runSynthetic(ctx, {
          industry: String(args.industry),
          scale: String(args.scale),
          ...(args.seed === undefined ? {} : { seed: Number(args.seed) }),
          ...(args.livedIn === undefined ? {} : { livedIn: Boolean(args.livedIn) }),
        });
        return { ...r, provisional: true, _note: "未审核合成数据（PROVISIONAL）：业务数字请用 query_objects/query_timeseries_agg 读回真实物化值；答案须标注'基于本轮合成的未审核数据'。" };
      }
      case "build_domain": {
        const r = await this.deps.dataCore.datagen.buildDomain(ctx, {
          story: String(args.story),
          ...(args.seed === undefined ? {} : { seed: Number(args.seed) }),
        });
        return { ...r, provisional: true, _note: "未审核建域（PROVISIONAL）：建出对象/规则/求解器骨架；读回/推演用 query_objects/invoke_solver；转正走 R4。" };
      }
      case "create_action_draft":
        return this.deps.dataCore.action.createDraft(ctx, String(args.actionType), args.payload ?? args);
      // 增量4 §5：AI 推演指挥台 —— OBO 到 DataCore /a/v1/sim/*（透传用户 JWT）。
      // R4：sim tick/act 模拟态不写真值（DataCore 保证）；回执只含会话态元信息，不绕审批。
      case "sim_init":
        return this.deps.dataCore.sim.init(ctx, {
          ...(args.baseSnapshot !== undefined ? { baseSnapshot: args.baseSnapshot as Record<string, unknown> } : {}),
          ...(args.scope !== undefined ? { scope: args.scope as Record<string, unknown> } : {}),
        });
      case "sim_tick":
        return this.deps.dataCore.sim.tick(ctx, String(args.sessionId ?? ""), args.n === undefined ? 1 : Number(args.n));
      case "sim_world":
        return this.deps.dataCore.sim.world(ctx, String(args.sessionId ?? ""));
      case "sim_certify":
        return this.deps.dataCore.sim.certify(
          ctx,
          String(args.sessionId ?? ""),
          args.scope === undefined ? undefined : String(args.scope),
          args.target === undefined ? undefined : String(args.target),
        );
      case "search_knowledge":
        return this.deps.dataCore.kb.search(ctx, {
          query: String(args.query),
          topK: args.topK === undefined ? undefined : Math.min(Math.max(1, Number(args.topK)), 10),
          connId: args.connId === undefined ? undefined : String(args.connId),
        });
      case "query_timeseries_agg":
        // contracts IO enforced at the boundary; invalid input → TOOL_ERROR (never raw rows)
        return this.deps.dataCore.timeseries.aggQuery(ctx, QueryTimeseriesAggInputSchema.parse(input));
      case "read_skill_resource":
        return this.readSkillResource(String(args.skillId ?? ""), String(args.resourceName ?? ""));
      case "search_experience":
        return this.searchExperience(String(args.query ?? ""), args.topK === undefined ? 3 : Math.min(Math.max(1, Number(args.topK)), 10));
      // 自成长发动机 A4：成长工单施工面（厂商中立，R2 租户隔离）。
      case "discover_growth_tickets":
        return this.discoverGrowthTickets(ctx.tenantId, args.status ? String(args.status) : undefined);
      case "claim_growth_ticket":
        return this.transitionGrowthTicket(ctx, String(args.ticketId ?? ""), "IN_PROGRESS", args.assignee ? String(args.assignee) : ctx.userId);
      case "submit_growth_ticket":
        return this.transitionGrowthTicket(ctx, String(args.ticketId ?? ""), "IN_REVIEW");
      default:
        throw new Error(`unknown tool: ${toolName}`);
    }
  }

  /**
   * CL.3：未知对象类型守卫——typeKey 不在本租户已发布类型集 → 返结构化 UNKNOWN_TYPE +
   * validTypes + did-you-mean（最近编辑距离），而非静默返空。命中真实类型 → 返 undefined（放行）。
   * R6 确定性（编辑距离纯函数）；类型清单经 listObjectTypeKeys（OBO，R2 隔离）。
   */
  private async unknownTypeGuard(ctx: ToolAuthCtx, typeKey: string): Promise<{ error: string; validTypes: string[]; suggestion?: string } | undefined> {
    let valid: string[];
    try {
      valid = await this.deps.dataCore.ontology.listObjectTypeKeys(ctx);
    } catch {
      return undefined; // 类型清单不可达时不拦（退化为既有行为），避免误伤
    }
    if (valid.length === 0 || valid.includes(typeKey)) return undefined;
    const suggestion = nearestType(typeKey, valid);
    return {
      error: "UNKNOWN_TYPE",
      validTypes: valid,
      ...(suggestion ? { suggestion } : {}),
    };
  }

  /** A4：列出成长工单（R2 租户隔离；按 status 过滤）。施工 agent 据此知道要建什么、骨架到哪。 */
  private async discoverGrowthTickets(tenantId: string, status?: string): Promise<unknown> {
    const all = await this.deps.repos.growthTickets.listByTenant(tenantId);
    const items = status ? all.filter((t) => t.status === status) : all;
    return {
      items: items.map((t) => ({
        id: t.id, fromQuestion: t.fromQuestion, gapCode: t.gapCode, status: t.status,
        ioContract: t.ioContract, ontologyRefs: t.ontologyRefs, acceptance: t.acceptance,
        scaffoldedDrafts: t.scaffoldedDrafts ?? [], assignee: t.assignee,
      })),
    };
  }

  /** A4：成长工单状态流转（claim→IN_PROGRESS / submit→IN_REVIEW）；不存在→错误，R2 隔离。 */
  private async transitionGrowthTicket(ctx: { tenantId: string }, ticketId: string, to: "IN_PROGRESS" | "IN_REVIEW", assignee?: string): Promise<unknown> {
    const tk = (await this.deps.repos.growthTickets.listByTenant(ctx.tenantId)).find((t) => t.id === ticketId);
    if (!tk) return { error: `TICKET_NOT_FOUND: ${ticketId}` };
    const updated = { ...tk, status: to, ...(assignee ? { assignee } : {}) };
    await this.deps.repos.growthTickets.upsert(updated);
    return { id: updated.id, status: updated.status, assignee: updated.assignee };
  }

  /**
   * 增量 §3：read_skill_resource —— 文本类（按 mime/扩展名判定）返回内容（≤64KB 截断+提示）；
   * 二进制类返回元信息并明示「无法直接读取」。渐进披露第三级：summary → body → resource。
   */
  private async readSkillResource(skillId: string, resourceName: string): Promise<unknown> {
    const skill = await this.deps.repos.skills.get(skillId);
    if (!skill || skill.tenantId !== this.opts.ctx.tenantId) {
      throw new Error(`skill not found: ${skillId}`);
    }
    const resource = skill.resources.find((r) => r.name === resourceName);
    if (!resource) throw new Error(`skill resource not found: ${resourceName}`);
    const mime = resource.mime ?? inferMime(resource.name);
    const meta = {
      skillId,
      name: resource.name,
      mime,
      description: resource.description ?? "",
    };
    if (!isTextMime(mime)) {
      const sizeBytes = await this.deps.skillResources?.size?.(skill as SkillDefinition, resource);
      return {
        ...meta,
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        readable: false,
        note: "二进制附件，无法直接读取；仅提供元信息（mime/大小/用途描述）。",
      };
    }
    const content = await this.deps.skillResources?.read(skill as SkillDefinition, resource);
    if (content === undefined) {
      return { ...meta, readable: false, note: "资源内容暂不可读（未配置资源存储）。" };
    }
    if (Buffer.byteLength(content, "utf8") > SKILL_RESOURCE_TEXT_LIMIT) {
      let sliced = content.slice(0, SKILL_RESOURCE_TEXT_LIMIT);
      while (Buffer.byteLength(sliced, "utf8") > SKILL_RESOURCE_TEXT_LIMIT) sliced = sliced.slice(0, -1024);
      return {
        ...meta,
        readable: true,
        truncated: true,
        content: sliced,
        note: `[内容超过 64KB，已截断；完整内容共 ${Buffer.byteLength(content, "utf8")} 字节]`,
      };
    }
    return { ...meta, readable: true, truncated: false, content };
  }

  /**
   * 运营态增量 §3：经验记忆库检索 —— 确定性伪向量（pseudoEmbed）余弦排序，
   * READ 级、经统一审计（tool_calls）。命中是「参考解法」而非事实源：数字红线
   * 仍由 provenance 机制约束（回答中的业务数字必须来自可溯源工具结果）。
   */
  private async searchExperience(query: string, topK: number): Promise<unknown> {
    if (!query.trim()) return { hits: [] };
    const cases = await this.deps.repos.experience.listByTenant(this.opts.ctx.tenantId);
    const qv = pseudoEmbed(query);
    const hits = cases
      .map((c) => ({
        question: c.question,
        approach: c.approach,
        outcome: c.outcome,
        scene: c.scene,
        date: c.date,
        score: Math.round(cosine(qv, c.embedding) * 1000) / 1000,
      }))
      .sort((a, b) => b.score - a.score || (a.question < b.question ? -1 : 1))
      .slice(0, topK);
    return { hits, total: cases.length };
  }

  /** Audit + metrics + result shaping (4) 写审计. */
  private async finish(
    toolName: string,
    input: unknown,
    payload: unknown,
    outcome: ToolRunResult["outcome"],
    started: number,
    ok: boolean,
  ): Promise<ToolRunResult> {
    const durationMs = Date.now() - started;
    const toolCallId = newId("tc");
    const redactedInput = redact(input);
    const redactedOutput = redact(payload);
    const row: ToolCallRow = {
      id: toolCallId,
      taskId: this.opts.taskId,
      toolName,
      input: redactedInput,
      outputDigest: digest(redactedOutput),
      output: byteLength(redactedOutput) > OUTPUT_LIMIT ? null : redactedOutput,
      outcome,
      durationMs,
      createdAt: new Date().toISOString(),
    };
    await this.deps.repos.toolCalls.insert(row);
    this.deps.metrics.toolCalls.inc({ tool: toolName, outcome });
    return { ok, payload, toolCallId, outcome, durationMs };
  }
}

/** #6 稳定参数键：键名排序后序列化，使 {a,b} 与 {b,a} 命中同一缓存。 */
/** CL.3：did-you-mean —— 在候选类型里找与 typeKey 最近的（不区分大小写的 Levenshtein），过远则不建议。 */
function nearestType(typeKey: string, candidates: string[]): string | undefined {
  const lev = (a: string, b: string): number => {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => i);
    for (let j = 1; j <= n; j++) {
      let prev = dp[0]!;
      dp[0] = j;
      for (let i = 1; i <= m; i++) {
        const tmp = dp[i]!;
        dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i]!, dp[i - 1]!);
        prev = tmp;
      }
    }
    return dp[m]!;
  };
  const lk = typeKey.toLowerCase();
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = lev(lk, c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  // 过远（超过类型名长度一半）不建议，避免误导
  return best !== undefined && bestD <= Math.max(2, Math.ceil(typeKey.length / 2)) ? best : undefined;
}

function canonicalArgs(input: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  try {
    return JSON.stringify(norm(input));
  } catch {
    return String(input);
  }
}

function wrapError(err: unknown): { error: string; message?: string } {
  if (err instanceof DataCoreUnavailableError) return { error: ErrorCodes.DATACORE_UNAVAILABLE };
  const message = err instanceof Error ? err.message : String(err);
  return { error: "TOOL_ERROR", message };
}

const TEXT_MIMES = new Set(["text/markdown", "text/plain", "text/csv", "application/json"]);
const TEXT_EXT_MIME: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
};

function inferMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXT_MIME[ext] ?? "application/octet-stream";
}

function isTextMime(mime: string): boolean {
  return TEXT_MIMES.has(mime) || mime.startsWith("text/");
}
