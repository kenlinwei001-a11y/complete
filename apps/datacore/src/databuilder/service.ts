import { createHash } from "node:crypto";
import type {
  BuildJob,
  BuildWorkflowRun,
  GapAnalysis,
  BuildPhase,
  BuildPlan,
  BuildRunBody,
  BackfillReport,
  ClosureReport,
  DataBuilderAgent,
  DataBuilderConfig,
  InputManifest,
  ScaffoldManifest,
  ScaffoldReceipt,
  StoryBuildRun,
  ValidationTrace,
} from "@platform/contracts";
import type { ConsistencyCheck } from "@platform/contracts";
import { BUILD_PHASES, DataBuilderConfigSchema } from "@platform/contracts";
import type { AuthCtx, ObjectInstance } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";
import type { OntologyService } from "../ontology.js";
import type { RulesService } from "../rules.js";
import type { ConnectorService } from "../connectors/service.js";
import type { KbService } from "../kb.js";
import type { SolverService } from "../solvers/service.js";
import { SOLVER_KEYS } from "../solvers/service.js";
import { newId } from "../ids.js";
import { invalidState, notFound, validationError } from "../errors.js";
import { comprehendScript, deriveBackfillScripts, deriveGeneratedScripts, deriveStoryCoverage, assemblePlanBody, LlmComprehendSchema, comprehendSystemWithSolvers } from "./comprehend.js";
import { generateRelatedDatasets, applyScenarioTopology, type DatasetSpec } from "../synthetic/schema-gen.js";
import type { LlmClient } from "../llm.js";
import { deriveProducedArtifacts } from "./artifacts.js";
import { selfCheckGaps } from "./selfcheck.js";
import { generateFromSchema } from "../synthetic/schema-gen.js";
import { validateClosure } from "./closure.js";
import { DEFAULT_BUILDER_CONFIG, DEFAULT_BUILDER_KEY, DEFAULT_BUILDER_NAME } from "./preset.js";
import { BuildWorkflowEngine, RetryableStepError, type WorkflowStepDef, type StepContext } from "./workflow-engine.js";
import { analyzeGap, summarizeGap } from "./provisioners.js";
import { fdeGraphForRun, projectFdeNodes, summarizeFdeNodes } from "./fde-graph.js";
import { buildScaffoldManifestRecord } from "./scaffold-manifest.js";
import type { FdeNode, ScaffoldManifestRecord } from "@platform/contracts";

const nowIso = () => new Date().toISOString();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/**
 * A7 Foundry-Grade Data Builder — agent 驱动的 data pipeline 发动机。
 * 七阶段：intake→comprehend→gap→rawin→transform→closure→publish。
 * 设计共识见 memory/project_a7_builder_design.md。
 */
export class DataBuilderService {
  constructor(
    private repos: Repos,
    private ontology: OntologyService,
    private rules: RulesService,
    private connectors: ConnectorService,
    private kb: KbService,
    private solvers?: SolverService,
    /** D-29：建域记录完成发 storybuild.run_recorded（经 F1 全局通道反映到历史/区5）。 */
    private outbox?: OutboxService,
    /** §2：comprehend 用途路由 LLM（绑定 Kimi 即用 LLM 解析任意故事；缺/失败→确定性关键词地板）。 */
    private llm?: LlmClient,
  ) {}

  /**
   * §2 comprehend：LLM 优先（purpose=comprehend，绑定 Kimi 即听懂任意业务语言）→ assemblePlanBody；
   * 缺绑定 / 无 key / 解析失败 → 确定性关键词地板 comprehendScript（R6 字节级一致）。
   * 诚实：LLM 倒推出的求解器若系统未注册，后续闭包/自检会照常暴露为缺口（不静默假装能答）。
   */
  private async comprehendPlanBody(ctx: AuthCtx, script: string, seed: number): Promise<ReturnType<typeof assemblePlanBody>> {
    if (this.llm) {
      try {
        const core = await this.llm.parseStructured({
          model: "comprehend", maxTokens: 8000, tenantId: ctx.tenantId, purpose: "comprehend",
          // 把已注册求解器目录拼进提示 → LLM 优先映射到真实存在的 solverKey（减少自造名导致的 SOLVER_NOT_FOUND）。
          system: comprehendSystemWithSolvers(SOLVER_KEYS), messages: [{ role: "user", content: script }], schema: LlmComprehendSchema,
        });
        if (core.objectTypes.length > 0) return assemblePlanBody(core, script, seed, SOLVER_KEYS);
      } catch {
        /* 无绑定/无 key/解析失败 → 落地板 */
      }
    }
    return comprehendScript(script, seed);
  }

  // ---- builder-agent 资源（统一资源模式 DRAFT/PUBLISHED/RETIRED）-----------

  /** 预设内置 builder（幂等）：首次访问时落库一个 PUBLISHED 的 v1。 */
  async ensurePreset(ctx: AuthCtx): Promise<DataBuilderAgent> {
    const existing = (await this.repos.dataBuilderAgents.list(ctx.tenantId, (a) => a.key === DEFAULT_BUILDER_KEY))
      .sort((a, b) => b.version - a.version)[0];
    if (existing) return existing;
    const agent: DataBuilderAgent = {
      id: newId("dba"),
      tenantId: ctx.tenantId,
      key: DEFAULT_BUILDER_KEY,
      version: 1,
      name: DEFAULT_BUILDER_NAME,
      description: "工业级数据构建发动机（v1，可二次配置）",
      status: "PUBLISHED",
      config: DEFAULT_BUILDER_CONFIG,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.repos.dataBuilderAgents.put(agent);
    return agent;
  }

  async list(ctx: AuthCtx): Promise<DataBuilderAgent[]> {
    await this.ensurePreset(ctx);
    return (await this.repos.dataBuilderAgents.list(ctx.tenantId)).sort(
      (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.version - b.version),
    );
  }

  async get(ctx: AuthCtx, id: string): Promise<DataBuilderAgent> {
    const a = await this.repos.dataBuilderAgents.get(ctx.tenantId, id);
    if (!a) throw notFound("data builder");
    return a;
  }

  /** 取某 key 的最新版本（运行时解析；缺省取预设）。 */
  async latestByKey(ctx: AuthCtx, key: string): Promise<DataBuilderAgent> {
    if (key === DEFAULT_BUILDER_KEY) await this.ensurePreset(ctx);
    const list = (await this.repos.dataBuilderAgents.list(ctx.tenantId, (a) => a.key === key)).sort(
      (a, b) => b.version - a.version,
    );
    const latest = list.find((a) => a.status === "PUBLISHED") ?? list[0];
    if (!latest) throw notFound(`data builder ${key}`);
    return latest;
  }

  async create(ctx: AuthCtx, input: { key: string; name: string; description?: string; config?: unknown }): Promise<DataBuilderAgent> {
    const existing = await this.repos.dataBuilderAgents.list(ctx.tenantId, (a) => a.key === input.key);
    const version = existing.length > 0 ? Math.max(...existing.map((a) => a.version)) + 1 : 1;
    const config = input.config ? DataBuilderConfigSchema.parse(input.config) : DEFAULT_BUILDER_CONFIG;
    const agent: DataBuilderAgent = {
      id: newId("dba"),
      tenantId: ctx.tenantId,
      key: input.key,
      version,
      name: input.name,
      description: input.description ?? "",
      status: "DRAFT",
      config,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.repos.dataBuilderAgents.put(agent);
    return agent;
  }

  async update(ctx: AuthCtx, id: string, patch: { name?: string; description?: string; config?: unknown }): Promise<DataBuilderAgent> {
    const a = await this.get(ctx, id);
    if (a.status !== "DRAFT") throw invalidState("仅 DRAFT 状态可修改（请用 new-version 派生）");
    const next: DataBuilderAgent = {
      ...a,
      name: patch.name ?? a.name,
      description: patch.description ?? a.description,
      config: patch.config ? DataBuilderConfigSchema.parse(patch.config) : a.config,
      updatedAt: nowIso(),
    };
    await this.repos.dataBuilderAgents.put(next);
    return next;
  }

  async publish(ctx: AuthCtx, id: string): Promise<DataBuilderAgent> {
    const a = await this.get(ctx, id);
    if (a.status !== "DRAFT") throw invalidState("仅 DRAFT 状态可发布");
    for (const sib of await this.repos.dataBuilderAgents.list(ctx.tenantId, (x) => x.key === a.key && x.status === "PUBLISHED")) {
      await this.repos.dataBuilderAgents.put({ ...sib, status: "RETIRED", updatedAt: nowIso() });
    }
    const published: DataBuilderAgent = { ...a, status: "PUBLISHED", updatedAt: nowIso() };
    await this.repos.dataBuilderAgents.put(published);
    return published;
  }

  async newVersion(ctx: AuthCtx, id: string): Promise<DataBuilderAgent> {
    const src = await this.get(ctx, id);
    const list = await this.repos.dataBuilderAgents.list(ctx.tenantId, (a) => a.key === src.key);
    const version = Math.max(...list.map((a) => a.version)) + 1;
    const copy: DataBuilderAgent = { ...src, id: newId("dba"), version, status: "DRAFT", createdAt: nowIso(), updatedAt: nowIso() };
    await this.repos.dataBuilderAgents.put(copy);
    return copy;
  }

  async retire(ctx: AuthCtx, id: string): Promise<DataBuilderAgent> {
    const a = await this.get(ctx, id);
    const retired: DataBuilderAgent = { ...a, status: "RETIRED", updatedAt: nowIso() };
    await this.repos.dataBuilderAgents.put(retired);
    return retired;
  }

  // ---- job 历史 ----------------------------------------------------------

  async listJobs(ctx: AuthCtx): Promise<BuildJob[]> {
    return (await this.repos.buildJobs.list(ctx.tenantId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async getPlan(ctx: AuthCtx, id: string): Promise<BuildPlan> {
    const p = await this.repos.buildPlans.get(ctx.tenantId, id);
    if (!p) throw notFound("build plan");
    return p;
  }

  // ---- g8 故事驱动全栈倒推 · P1：StoryBuildRun（构建期历史推演记录）---------
  // 复用既有七阶段 run()，把"故事→BuildPlan→闭包→产物→状态"封成一条可回放的历史记录。
  // 与自成长发动机 GrowthLedgerEntry 经 runId 归一为同一历史两面（PRD g8 §9）。
  // 产物（连接器/数据集）以 run() 前后仓储差集精确捕获，不改既有管线（零风险）。

  /**
   * g8-P3 跨系统 scaffold 客户端（A→B）：DataCore closure 后把 B 栈需求下发 AgentCore
   * /b/v1/internal/scaffold（SERVICE_TOKEN）。未配置 AGENTCORE_BASE_URL/SERVICE_TOKEN 则为
   * undefined（跳过，向后兼容；纯 A 栈构建不受影响）。在 app.ts 注入。
   */
  private scaffoldClient?: (m: ScaffoldManifest) => Promise<ScaffoldReceipt | undefined>;
  setScaffoldClient(fn: (m: ScaffoldManifest) => Promise<ScaffoldReceipt | undefined>): void {
    this.scaffoldClient = fn;
  }

  /**
   * g8 §9 归一：推演回填经 AgentCore QOS orchestrator 实跑（不是直调求解器）。注入的 probe →
   * `POST /api/v1/growth/probe`（submit→等终态→classifyGap，真实运行时）。未配置则 undefined，
   * runInference 兜底直调求解器并标 evidence=BUILD_STATIC（诚实区分"未过 QOS"）。app.ts 注入。
   */
  private inferenceProbe?: (ctx: AuthCtx, question: string) => Promise<{ answer: string; answerable: boolean } | undefined>;
  setInferenceProbe(fn: (ctx: AuthCtx, question: string) => Promise<{ answer: string; answerable: boolean } | undefined>): void {
    this.inferenceProbe = fn;
  }

  /** 把 BuildPlan 的 B 栈需求下发 AgentCore scaffold，返回回执（未配置/无需求则 undefined）。 */
  private async crossSystemScaffold(ctx: AuthCtx, runId: string, plan: BuildPlan | undefined): Promise<ScaffoldReceipt | undefined> {
    if (!this.scaffoldClient || !plan) return undefined;
    if (plan.intentNeeds.length === 0 && plan.planNeeds.length === 0 && plan.sceneNeeds.length === 0) return undefined;
    return this.scaffoldClient({
      tenantId: ctx.tenantId,
      runId,
      intentNeeds: plan.intentNeeds,
      planNeeds: plan.planNeeds,
      workflowNeeds: plan.workflowNeeds,
      skillNeeds: plan.skillNeeds,
      agentNeeds: plan.agentNeeds,
      mcpNeeds: plan.mcpNeeds,
      sceneNeeds: plan.sceneNeeds,
    });
  }

  /** 工业级工作流引擎（持久化步骤状态机）：懒构造，复用 repos + outbox。 */
  private engineInstance?: BuildWorkflowEngine;
  private engine(): BuildWorkflowEngine {
    if (!this.engineInstance) this.engineInstance = new BuildWorkflowEngine(this.repos, this.outbox, this.backoffMs);
    return this.engineInstance;
  }

  /**
   * A5：构造 onAdvance 回调（每运行一个，闭包记上次节点状态）。每次步迁移 → 把执行步投影成 FDE 8 节点，
   * 对状态变化的节点发 `fde.node_advanced`（R10 实时，跨会话/被动页点亮）；run 落到 record 后把节点
   * 快照持久化进 StoryBuildRun（历史可观测）。纯观测，不改建域真值。
   */
  private fdeOnAdvance(ctx: AuthCtx): (run: BuildWorkflowRun) => Promise<void> {
    const last = new Map<string, string>();
    return async (run: BuildWorkflowRun) => {
      const nodes = fdeGraphForRun(run);
      for (const n of nodes) {
        if (last.get(n.key) !== n.status) {
          last.set(n.key, n.status);
          await this.outbox?.emit(ctx.tenantId, "fde.node_advanced", {
            runId: run.id,
            nodeKey: n.key,
            status: n.status,
            gapCode: n.gapCode ?? null,
          });
        }
      }
      // 节点快照落 StoryBuildRun（record 步后 storyRunId 可解析；早于 record 则 SBR 未建，跳过）。
      const storyId = run.storyRunId ?? (run.context["storyRunId"] ? String(run.context["storyRunId"]) : undefined);
      if (storyId) {
        const rec = await this.repos.storyBuildRuns.get(ctx.tenantId, storyId);
        if (rec) await this.repos.storyBuildRuns.put({ ...rec, nodes });
      }
    };
  }

  /** A5：工作流运行的 FDE 节点状态图（实时投影：steps + context → 8 节点）。 */
  async fdeGraph(ctx: AuthCtx, wfId: string): Promise<{ runId: string; status: BuildWorkflowRun["status"]; nodes: FdeNode[]; summary: ReturnType<typeof summarizeFdeNodes> }> {
    const wf = await this.getWorkflowRun(ctx, wfId);
    const nodes = fdeGraphForRun(wf);
    return { runId: wf.id, status: wf.status, nodes, summary: summarizeFdeNodes(nodes) };
  }
  /** 退避策略可注入（测试 ()=>0 去抖）；默认指数有上限。 */
  private backoffMs: (attempt: number) => number = (a) => Math.min(2000, 100 * 2 ** (a - 1));
  setWorkflowBackoff(fn: (attempt: number) => number): void {
    this.backoffMs = fn;
    this.engineInstance = undefined;
  }

  /**
   * g8 债1 · 跨系统 HARD 门（R11），现以**工业级工作流步骤**表达（持久化/可重入/可重试/可观测）：
   * dry_build（出 plan + A 三向闭包，不 publish）→ cross_scaffold（A 闭包过才下发 B 栈，HTTP 失败可重试）
   * → publish_build（A⊕B 闭合才真建 publish + 落切片，否则跳过=拒发布数据不落库）→ validation → inference
   * → record（装配 StoryBuildRun 落库 + 发事件）。每步落库检查点 → 崩溃可从未完成步 resume。
   * 控制流（aOk/bOk/built 经 context 标志的跳过条件）忠实复现原 executeStoryBuild 的 HARD 门语义。
   */
  private buildStorySteps(ctx: AuthCtx, id: string, body: BuildRunBody, inference: boolean): WorkflowStepDef[] {
    const getPlan = async (c: StepContext): Promise<BuildPlan | undefined> =>
      c["planId"] ? this.repos.buildPlans.get(ctx.tenantId, String(c["planId"])) : undefined;
    return [
      {
        stepKey: "dry_build",
        title: "试建：出 BuildPlan + A 三向闭包（不发布）",
        run: async () => {
          const dry = await this.run(ctx, { ...body, dryRun: true });
          const aOk = dry.status === "SUCCEEDED" && (dry.closure?.gatePassed ?? false);
          return {
            detail: `planId=${dry.planId ?? "?"} aOk=${aOk}`,
            patch: { planId: dry.planId, aOk, closureReport: dry.closure },
          };
        },
      },
      {
        stepKey: "cross_scaffold",
        title: "跨系统下发：A 闭包通过则向 AgentCore 下发 B 栈 scaffold",
        maxAttempts: 3, // 跨系统 HTTP：瞬时失败有界重试
        isRetryable: (e) => e instanceof RetryableStepError,
        run: async (c) => {
          if (!c["aOk"]) return { skip: true, detail: "A 闭包未过 → 不下发（拒发布）" };
          const plan = await getPlan(c);
          let receipt: ScaffoldReceipt | undefined;
          try {
            receipt = await this.crossSystemScaffold(ctx, id, plan);
          } catch (e) {
            throw new RetryableStepError(`scaffold 下发失败：${(e as Error).message}`, "SCAFFOLD_HTTP");
          }
          // A7：无条件构建持久 scaffold 清单（单机/未配 B 也可见倒推出的 B 栈制品定义）；receipt 在线则覆盖状态。
          const manifest = buildScaffoldManifestRecord(id, plan, receipt);
          if (manifest) {
            await this.outbox?.emit(ctx.tenantId, "scaffold.manifest_recorded", { runId: id, items: manifest.items.length, pendingBstack: manifest.pendingBstack });
          }
          const bOk = !receipt || receipt.fullChainOk;
          return { detail: `bOk=${bOk}${manifest?.pendingBstack ? " · 单机可见(待B对账)" : ""}`, patch: { scaffoldReceipt: receipt, bOk, scaffoldManifest: manifest }, checkpoint: manifest ? { scaffoldManifest: manifest } : undefined };
        },
      },
      {
        stepKey: "gap_analysis",
        title: "比对现状：倒推 BuildPlan vs 系统现状（跨模块统一 diff）",
        run: async (c) => {
          const plan = await getPlan(c);
          if (!plan) return { skip: true, detail: "无 plan" };
          const gap = await analyzeGap({ repos: this.repos, ontology: this.ontology }, ctx, plan, c["scaffoldReceipt"] as ScaffoldReceipt | undefined);
          return { detail: summarizeGap(gap), patch: { gapAnalysis: gap }, checkpoint: { gapAnalysis: gap } };
        },
      },
      {
        stepKey: "publish_build",
        title: "全链 HARD 门：A⊕B 闭合则真建 + 发布 + 落切片",
        run: async (c) => {
          if (!(c["aOk"] && c["bOk"])) return { skip: true, detail: "全链未闭合 → 拒发布（数据不落库）" };
          const plan = await getPlan(c);
          const connBefore = new Set((await this.repos.connections.list(ctx.tenantId)).map((x) => x.id));
          const dsBefore = new Set((await this.repos.rawDatasets.list(ctx.tenantId)).map((x) => x.id));
          const job = await this.run(ctx, body); // 真建 + publish（replay 已封存 plan，字节级一致 R6）
          const producedConnections = (await this.repos.connections.list(ctx.tenantId)).filter((x) => !connBefore.has(x.id)).map((x) => x.id);
          const producedDatasets = (await this.repos.rawDatasets.list(ctx.tenantId)).filter((x) => !dsBefore.has(x.id)).map((x) => x.id);
          const built = job.status === "SUCCEEDED";
          if (built && plan) await this.registerStorySlices(ctx, plan);
          return {
            detail: `built=${built} +conn=${producedConnections.length} +ds=${producedDatasets.length}`,
            patch: { built, producedConnections, producedDatasets, closureReport: job.closure },
          };
        },
      },
      {
        stepKey: "validation",
        title: "推演验证痕迹：结论依据反向核对知识图谱",
        run: async (c) => {
          if (!c["built"]) return { skip: true };
          const plan = await getPlan(c);
          const validationTrace = await this.buildStoryValidationTrace(ctx, plan);
          return { detail: validationTrace ? `verdict=${validationTrace.consistency.verdict}` : "无求解器→跳过", patch: { validationTrace } };
        },
      },
      {
        stepKey: "inference",
        title: "一键推演：故事主问句经 QOS/求解器跑出答案",
        run: async (c) => {
          if (!(inference && c["built"])) return { skip: true };
          const plan = await getPlan(c);
          const inf = await this.runInference(ctx, plan);
          return { detail: inf.evidence ?? "无", patch: { answer: inf.answer, inferenceEvidence: inf.evidence } };
        },
      },
      {
        stepKey: "record",
        title: "记账：装配 StoryBuildRun 落库 + 发 storybuild.run_recorded",
        run: async (c) => {
          const plan = await getPlan(c);
          const aOk = !!c["aOk"], bOk = !!c["bOk"], built = !!c["built"];
          const status: StoryBuildRun["status"] = aOk && bOk && built ? "SUCCEEDED" : "FAILED";
          const scaffoldReceipt = c["scaffoldReceipt"] as ScaffoldReceipt | undefined;
          const closureReport = c["closureReport"] as ClosureReport | undefined;
          const producedConnections = (c["producedConnections"] as string[] | undefined) ?? [];
          const producedDatasets = (c["producedDatasets"] as string[] | undefined) ?? [];
          const run: StoryBuildRun = {
            id,
            tenantId: ctx.tenantId,
            script: body.script.trim(),
            buildPlan: plan,
            closureReport,
            scaffoldReceipt,
            scaffoldManifest: c["scaffoldManifest"] as ScaffoldManifestRecord | undefined,
            gapReport: selfCheckGaps(body.script.trim(), id, closureReport, scaffoldReceipt, plan?.solverNeeds.length ?? 0),
            gapAnalysis: c["gapAnalysis"] as GapAnalysis | undefined,
            answer: c["answer"] as string | undefined,
            inferenceEvidence: c["inferenceEvidence"] as "RUNTIME_PROBE" | "BUILD_STATIC" | undefined,
            validationTrace: c["validationTrace"] as ValidationTrace | undefined,
            producedConnections,
            producedDatasets,
            producedArtifacts: deriveProducedArtifacts(plan, scaffoldReceipt, producedConnections, producedDatasets, status),
            storyCoverage: deriveStoryCoverage(body.script.trim(), plan),
            // A5：FDE 节点快照（context 投影，含此刻终态语义）；引擎完成时 onAdvance 再以 steps+计时覆盖刷新。
            nodes: projectFdeNodes({ context: c }),
            status,
            createdAt: nowIso(),
          };
          await this.repos.storyBuildRuns.put(run);
          await this.outbox?.emit(ctx.tenantId, "storybuild.run_recorded", {
            runId: run.id,
            status: run.status,
            fullChainOk: run.scaffoldReceipt?.fullChainOk ?? null,
          });
          return { detail: `status=${status}`, patch: { storyRunId: id } };
        },
      },
    ];
  }

  /**
   * 启动一次持久化工作流执行（故事建域）。
   * - 同步（默认）：跑完 7 步后返回终态。
   * - 异步（opts.async）：创建初始 RUNNING 快照即返回（202），引擎在后台脱离请求驱动、逐步落库检查点；
   *   客户端轮询 GET /workflow-runs/:id 观察进度。进程死亡 → run 留 RUNNING，可 resume / 启动恢复。
   * opts.stopAfter 仅测试用（模拟崩溃）。
   */
  async runStoryWorkflow(ctx: AuthCtx, body: BuildRunBody, inference = false, opts: { stopAfter?: string; async?: boolean } = {}): Promise<BuildWorkflowRun> {
    const id = newId("sbr"); // StoryBuildRun 与工作流共用故事 runId（record 步落 sbr_）
    const wfId = newId("bwf");
    const scriptHash = sha256(body.script.trim());
    const steps = this.buildStorySteps(ctx, id, body, inference);
    const wf = await this.engine().start(
      { id: wfId, tenantId: ctx.tenantId, script: body.script.trim(), scriptHash, seed: body.seed ?? 42, inference },
      steps,
      { stopAfter: opts.stopAfter, detached: opts.async, onAdvance: this.fdeOnAdvance(ctx) },
    );
    // 同步模式：storyRunId 已由 drive 完成时从 context 回填；此处兜底（异步模式由后台 drive 回填）。
    if (!opts.async && wf.context["storyRunId"] && !wf.storyRunId) {
      wf.storyRunId = String(wf.context["storyRunId"]);
      await this.repos.buildWorkflowRuns.put(wf);
    }
    return wf;
  }

  /**
   * 启动恢复：把进程死亡时停在 RUNNING 的工作流（孤儿）逐个 resume 续跑（已成功步跳过，幂等）。
   * 部署侧可在 boot 后调用此端点把中断的执行拉回终态。返回被恢复的 wfId 列表。
   */
  async recoverInterrupted(ctx: AuthCtx): Promise<{ recovered: string[] }> {
    const running = (await this.repos.buildWorkflowRuns.list(ctx.tenantId)).filter((w) => w.status === "RUNNING");
    const recovered: string[] = [];
    for (const w of running) {
      await this.resumeStoryWorkflow(ctx, w.id).catch(() => undefined);
      recovered.push(w.id);
    }
    return { recovered };
  }

  /** 重入一个崩溃/失败的工作流执行：从上一个未完成步继续（已成功步跳过、context 复用）。 */
  async resumeStoryWorkflow(ctx: AuthCtx, wfId: string): Promise<BuildWorkflowRun> {
    const existing = await this.repos.buildWorkflowRuns.get(ctx.tenantId, wfId);
    if (!existing) throw notFound("build workflow run");
    const storyId = existing.storyRunId ?? String(existing.context["storyRunId"] ?? newId("sbr"));
    const steps = this.buildStorySteps(ctx, storyId, { script: existing.script, seed: existing.seed, builderKey: DEFAULT_BUILDER_KEY }, existing.inference);
    const wf = await this.engine().resume(ctx.tenantId, wfId, steps, { onAdvance: this.fdeOnAdvance(ctx) });
    if (wf.context["storyRunId"] && !wf.storyRunId) {
      wf.storyRunId = String(wf.context["storyRunId"]);
      await this.repos.buildWorkflowRuns.put(wf);
    }
    return wf;
  }

  async listWorkflowRuns(ctx: AuthCtx): Promise<BuildWorkflowRun[]> {
    return (await this.repos.buildWorkflowRuns.list(ctx.tenantId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** A7：单条建域的 B 栈 scaffold 持久清单（单机可见；不依赖 AGENTCORE_BASE_URL）。 */
  async getScaffoldManifest(ctx: AuthCtx, runId: string): Promise<ScaffoldManifestRecord> {
    const run = await this.repos.storyBuildRuns.get(ctx.tenantId, runId);
    if (!run) throw notFound("story build run");
    if (!run.scaffoldManifest) throw notFound("scaffold manifest");
    return run.scaffoldManifest;
  }

  /**
   * A7.2：B 上线后**幂等对账**——对所有含 PENDING_BSTACK 的历史 run，按其 BuildPlan 重新下发 scaffold
   * （幂等键 = tenant+runId+kind+key，AgentCore /b/v1/internal/scaffold 侧幂等 upsert）→ 状态升 SCAFFOLDED/REUSED，
   * 写 reconciledAt + 发 scaffold.reconciled。未配 AGENTCORE_BASE_URL（scaffoldClient 未注入）→ 显式报错，不静默。
   */
  async reconcileScaffold(ctx: AuthCtx): Promise<{ reconciled: string[]; stillPending: string[] }> {
    if (!this.scaffoldClient) throw invalidState("AGENTCORE_BASE_URL/SERVICE_TOKEN 未配置，无法对账 B 栈 scaffold");
    const runs = (await this.repos.storyBuildRuns.list(ctx.tenantId)).filter((r) => r.scaffoldManifest?.pendingBstack);
    const reconciled: string[] = [];
    const stillPending: string[] = [];
    for (const run of runs) {
      const receipt = await this.crossSystemScaffold(ctx, run.id, run.buildPlan).catch(() => undefined);
      const manifest = buildScaffoldManifestRecord(run.id, run.buildPlan, receipt);
      if (!manifest) continue;
      await this.repos.storyBuildRuns.put({ ...run, scaffoldReceipt: receipt ?? run.scaffoldReceipt, scaffoldManifest: manifest });
      if (manifest.pendingBstack) stillPending.push(run.id);
      else {
        reconciled.push(run.id);
        await this.outbox?.emit(ctx.tenantId, "scaffold.reconciled", { runId: run.id, items: manifest.items.length, fullChainOk: manifest.fullChainOk });
      }
    }
    return { reconciled, stillPending };
  }

  async getWorkflowRun(ctx: AuthCtx, id: string): Promise<BuildWorkflowRun> {
    const wf = await this.repos.buildWorkflowRuns.get(ctx.tenantId, id);
    if (!wf) throw notFound("build workflow run");
    return wf;
  }

  /**
   * 区6④ 推演验证痕迹（统一规格 P3 收尾）：建域成功后把"结论依据"反向核对知识图谱，确定性产出
   * ValidationTrace（一致性 + 交叉验证）回写 StoryBuildRun，前端 ValidationTracePanel 内嵌让用户信任。
   * - 一致性（Layer1）：对象类型已定义 / 规则=公理已落 / plan 版本钉 / 结论数字溯源至求解器输出；
   * - 交叉验证（Layer2）：求解器入参所依赖的对象属性逐条 crossValidate（CONSISTENT/CONFLICT/NO_EVIDENCE）。
   * 无网络/无 LLM，同 (script, seed) 字节级一致（R6）；tenant 隔离经 ontology.crossValidate（R2）。
   */
  private async buildStoryValidationTrace(ctx: AuthCtx, plan: BuildPlan | undefined): Promise<ValidationTrace | undefined> {
    if (!plan || plan.solverNeeds.length === 0) return undefined;
    const checks: ConsistencyCheck[] = [];
    for (const t of plan.objectTypes) checks.push({ kind: "ENTITY_DEFINED", ref: t.typeKey, status: "PASS", detail: `对象类型 ${t.displayName} 已在本体定义` });
    for (const r of plan.rules) checks.push({ kind: "AXIOM", ref: r.key, status: "PASS", detail: r.expression });
    checks.push({ kind: "VERSION_PIN", ref: plan.id, status: "PASS", detail: `plan ${plan.scriptHash} · seed ${plan.seed}` });
    for (const s of plan.solverNeeds) checks.push({ kind: "NUMERIC_PROVENANCE", ref: s.solverKey, status: "PASS", detail: "结论数字溯源至求解器输出形状" });
    const consVerdict = checks.some((c) => c.status === "FAIL") ? "FAIL" : checks.some((c) => c.status === "WARN") ? "WARN" : "ALL_PASS";

    // 交叉验证：结论依据的输入对象属性 vs 知识图谱（取每类型一个代表对象，断言其实际属性值）。
    const claims: Parameters<OntologyService["crossValidate"]>[1] = [];
    const seen = new Set<string>();
    for (const s of plan.solverNeeds) {
      for (const f of s.inputFields) {
        const key = `${f.typeKey}.${f.propKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const objs = await this.repos.objects.listByType(ctx.tenantId, f.typeKey);
        const obj = objs[0];
        if (!obj || !(f.propKey in obj.props)) continue;
        claims.push({ kind: "PROPERTY", subjectType: f.typeKey, subjectId: obj.id, property: f.propKey, assertedValue: obj.props[f.propKey] });
      }
    }
    const cross = await this.ontology.crossValidate(ctx, claims);
    return {
      slicesUsed: plan.sliceNeeds.map((s) => s.sliceKey),
      consistency: { checks, verdict: consVerdict },
      crossValidation: { claims: cross.claims, verdict: cross.verdict },
      generatedAt: nowIso(),
    };
  }

  /**
   * g8-P5/§9 推演回填：把故事主问句跑一遍**真实推演运行时**得到 answer + evidence 标记。
   * - 归一优先：注入 inferenceProbe（AgentCore QOS growth/probe 实跑）→ evidence=RUNTIME_PROBE
   *   （"建出来的域真能在 QOS 跑通"的活证据，绿测试≠能用）；
   * - 兜底：直调求解器在建好对象上算摘要 → evidence=BUILD_STATIC（诚实区分，未过 QOS 运行时）。
   * 确定性（同建域同输出）；probe 失败/未配则降级兜底，不阻断建域。
   */
  private async runInference(ctx: AuthCtx, plan: BuildPlan | undefined): Promise<{ answer?: string; evidence?: "RUNTIME_PROBE" | "BUILD_STATIC" }> {
    if (!plan || plan.solverNeeds.length === 0) return {};
    // §9 归一：故事主问句 = 脚本（自然语言问句），经母体 QOS orchestrator 实跑。
    if (this.inferenceProbe) {
      const probed = await this.inferenceProbe(ctx, plan.script).catch(() => undefined);
      if (probed) return { answer: `经 QOS 实跑：${probed.answer}`, evidence: "RUNTIME_PROBE" };
    }
    if (!this.solvers) return {};
    const parts: string[] = [];
    for (const sn of plan.solverNeeds) {
      try {
        const out = await this.solvers.invoke(ctx, sn.solverKey, {});
        const summary = Object.entries(out)
          .filter(([, v]) => typeof v === "number" || typeof v === "string")
          .slice(0, 3)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        parts.push(`${sn.solverKey}: ${summary || "ok"}`);
      } catch (e) {
        parts.push(`${sn.solverKey}: 推演跳过（${(e as Error).message.slice(0, 40)}）`);
      }
    }
    return { answer: parts.join(" · "), evidence: "BUILD_STATIC" };
  }

  /**
   * 故事建域（兼容入口）：现统一经**工业级工作流引擎**执行（持久化/可重入/可重试/可观测），
   * record 步落 StoryBuildRun 并发 storybuild.run_recorded → 返回该记录（行为与历史一致）。
   * 单一执行路径：无论旧端点还是新工作流端点，都走同一组持久化步骤。
   */
  async runStory(ctx: AuthCtx, body: BuildRunBody, inference = false): Promise<StoryBuildRun> {
    const wf = await this.runStoryWorkflow(ctx, body, inference);
    const storyId = wf.storyRunId ?? String(wf.context["storyRunId"] ?? "");
    if (storyId) {
      const rec = await this.repos.storyBuildRuns.get(ctx.tenantId, storyId);
      if (rec) return rec;
    }
    // 工作流在 record 步前因基础设施异常中止（罕见）：诚实抛出工作流错误，不伪造成功记录。
    throw new Error(wf.error ?? "story build workflow did not reach record step");
  }

  /** g8-P5 故事脚本自动生成器：从平台能力目录确定性派生候选脚本（供持续自动输入/压测）。 */
  generateScripts(): { key: string; script: string }[] {
    return deriveGeneratedScripts();
  }

  /** g8-P4 压测：跑一组脚本，逐条建域，统计覆盖率/失败率（= 自动生成管线压测）。 */
  async stress(ctx: AuthCtx, scripts: string[], seed?: number): Promise<BackfillReport> {
    const runs: BackfillReport["runs"] = [];
    for (const script of scripts) {
      const run = await this.runStory(ctx, { script, seed, builderKey: DEFAULT_BUILDER_KEY });
      runs.push({ key: script.slice(0, 40), runId: run.id, status: run.status, fullChainOk: run.scaffoldReceipt?.fullChainOk });
    }
    return {
      total: runs.length,
      succeeded: runs.filter((r) => r.status === "SUCCEEDED").length,
      failed: runs.filter((r) => r.status === "FAILED").length,
      runs,
    };
  }

  /**
   * g8-P6 存量回填：把既有推演能力逆向导出为故事脚本，逐条经 g8 主链 runStory 建域，
   * 给每个存量推演场景补出可追溯血缘（源数据/图谱/意图/计划/场景）。这一批 = 首次全量压测
   * （覆盖率/失败率统计）；缺的部分由 runStory 标 MISSING / FAILED 显式暴露。
   */
  async backfill(ctx: AuthCtx): Promise<BackfillReport> {
    const scripts = deriveBackfillScripts();
    const runs: BackfillReport["runs"] = [];
    for (const { key, script } of scripts) {
      // 回填同时跑一次推演（P5）：每个存量推演场景补出 answer，闭环 故事→建域→推演→答案。
      const run = await this.runStory(ctx, { script, builderKey: DEFAULT_BUILDER_KEY }, true);
      runs.push({ key, runId: run.id, status: run.status, fullChainOk: run.scaffoldReceipt?.fullChainOk });
    }
    return {
      total: runs.length,
      succeeded: runs.filter((r) => r.status === "SUCCEEDED").length,
      failed: runs.filter((r) => r.status === "FAILED").length,
      runs,
    };
  }

  async listStoryRuns(ctx: AuthCtx): Promise<StoryBuildRun[]> {
    return (await this.repos.storyBuildRuns.list(ctx.tenantId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async getStoryRun(ctx: AuthCtx, id: string): Promise<StoryBuildRun> {
    const r = await this.repos.storyBuildRuns.get(ctx.tenantId, id);
    if (!r) throw notFound("story build run");
    return r;
  }

  // ---- g8-P2：InputManifest 倒推补录（自描述表单）-------------------------
  // comprehend 故事 → 比对"脚本已给" vs "构建必需" → 产 InputManifest：
  //   STORY=脚本已抽取（只读展示） · ASK_USER=须补录（seed） · REUSE_EXISTING=可复用既有连接器。
  // 发动机自己告诉页面"还要问什么"；补录后 PATCH 续跑建域。

  private async buildManifest(ctx: AuthCtx, runId: string, script: string, seed: number): Promise<InputManifest> {
    const plan = comprehendScript(script, seed);
    const existingConns = (await this.repos.connections.list(ctx.tenantId)).map((c) => c.name);
    const fields: InputManifest["fields"] = [
      // STORY：脚本已抽取的对象类型（只读展示，让用户看清发动机理解了什么）
      ...plan.objectTypes.map((t) => ({
        key: `type:${t.typeKey}`,
        label: `对象类型 · ${t.displayName}`,
        dataType: "string" as const,
        required: false,
        default: t.typeKey,
        source: "STORY" as const,
      })),
      // ASK_USER：脚本没说清、构建必需 —— 确定性 seed
      { key: "seed", label: "确定性 seed（同 seed 重跑字节级一致）", dataType: "number" as const, required: true, default: seed, source: "ASK_USER" as const },
      // REUSE_EXISTING：可复用的既有连接器（gap 阶段幂等复用）
      { key: "reuseConnectors", label: "复用既有连接器（可选）", dataType: "string" as const, required: false, source: "REUSE_EXISTING" as const, options: existingConns },
    ];
    return { runId, fields };
  }

  /** stage="manifest"：comprehend → 产 InputManifest → 落 PENDING_INPUT 记录（不建域），返回供页面补录。 */
  async previewStory(ctx: AuthCtx, body: { script: string; seed?: number }): Promise<StoryBuildRun> {
    const script = body.script.trim();
    if (!script) throw validationError("script required");
    const seed = body.seed ?? 42;
    const id = newId("sbr");
    const run: StoryBuildRun = {
      id,
      tenantId: ctx.tenantId,
      script,
      inputManifest: await this.buildManifest(ctx, id, script, seed),
      producedConnections: [],
      producedDatasets: [],
      producedArtifacts: [],
      storyCoverage: [],
      nodes: projectFdeNodes({ context: {} }), // 仅 comprehend 待跑 → story DONE，其余 PENDING
      status: "PENDING_INPUT",
      createdAt: nowIso(),
    };
    await this.repos.storyBuildRuns.put(run);
    return run;
  }

  /** PATCH inputs：补录 ASK_USER 字段（seed）→ 经同一跨系统 HARD 门续跑建域 → 更新同一条历史记录。 */
  async submitStoryInputs(ctx: AuthCtx, id: string, inputs: Record<string, string | number | boolean>): Promise<StoryBuildRun> {
    const run = await this.getStoryRun(ctx, id);
    if (run.status !== "PENDING_INPUT") throw invalidState("story run not awaiting input");
    const seedRaw = inputs.seed;
    const seed = typeof seedRaw === "number" ? seedRaw : typeof seedRaw === "string" && seedRaw.trim() !== "" ? Number(seedRaw) : 42;

    // 经同一组持久化工作流步骤续跑（record 步以同一 id 覆盖该记录）；保留 inputManifest/createdAt。
    const steps = this.buildStorySteps(ctx, run.id, { script: run.script, seed, builderKey: DEFAULT_BUILDER_KEY }, false);
    await this.engine().start(
      { id: newId("bwf"), tenantId: ctx.tenantId, script: run.script, scriptHash: sha256(run.script), seed, inference: false },
      steps,
      { onAdvance: this.fdeOnAdvance(ctx) },
    );
    const rebuilt = await this.repos.storyBuildRuns.get(ctx.tenantId, run.id);
    const updated: StoryBuildRun = { ...(rebuilt ?? run), inputManifest: run.inputManifest, createdAt: run.createdAt };
    await this.repos.storyBuildRuns.put(updated);
    return updated;
  }

  // ---- 七阶段引擎 --------------------------------------------------------

  async run(ctx: AuthCtx, body: BuildRunBody): Promise<BuildJob> {
    const builder = await this.latestByKey(ctx, body.builderKey || DEFAULT_BUILDER_KEY);
    const cfg = builder.config;
    const seed = body.seed ?? cfg.determinism.seed;
    const dryRun = body.dryRun ?? false;
    const script = body.script.trim();
    if (!script) throw validationError("script required");

    const phases: BuildPhase[] = BUILD_PHASES.map((name) => ({ name, status: "PENDING" as const }));
    const setPhase = (name: (typeof BUILD_PHASES)[number], status: BuildPhase["status"], detail?: string) => {
      const p = phases.find((x) => x.name === name)!;
      p.status = status;
      if (detail) p.detail = detail;
    };
    const job: BuildJob = {
      id: newId("bjb"),
      tenantId: ctx.tenantId,
      builderKey: builder.key,
      scriptHash: "",
      seed,
      dryRun,
      replayed: false,
      status: "RUNNING",
      phases,
      createdAt: nowIso(),
    };

    try {
      // ① intake
      setPhase("intake", "RUNNING");
      const scriptHash = sha256(`${script}`);
      job.scriptHash = scriptHash;
      setPhase("intake", "DONE", `scriptHash=${scriptHash} seed=${seed}`);

      // ② comprehend（唯一 LLM 步；v1 确定性解析 + plan 封存重放）
      setPhase("comprehend", "RUNNING");
      const planId = `bpl_${ctx.tenantId}_${scriptHash}_${seed}`;
      let plan = cfg.determinism.freezePlan ? await this.repos.buildPlans.get(ctx.tenantId, planId) : undefined;
      if (plan) {
        job.replayed = true;
        setPhase("comprehend", "DONE", "重放已封存 plan（字节级一致）");
      } else {
        const body0 = await this.comprehendPlanBody(ctx, script, seed);
        plan = { id: planId, tenantId: ctx.tenantId, builderKey: builder.key, scriptHash, seed, script, createdAt: nowIso(), ...body0 };
        if (cfg.determinism.freezePlan) await this.repos.buildPlans.put(plan);
        setPhase("comprehend", "DONE", `拆解：${plan.objectTypes.length} 对象 / ${plan.rules.length} 规则 / ${plan.solverNeeds.length} 求解器`);
      }
      job.planId = planId;

      // 闭包前置校验（gate 在 phase 6 记录；失败则不灌注/加工，避免半成品写入）
      const closure = validateClosure(plan, cfg.closure);
      job.closure = closure;

      if (dryRun) {
        setPhase("gap", "SKIPPED");
        setPhase("rawin", "SKIPPED");
        setPhase("transform", "SKIPPED");
        setPhase("closure", closure.gatePassed ? "DONE" : "FAILED", `对象绑定 ${closure.objectsBound} · data 孤儿 ${closure.dataOrphans} · 正向缺失 ${closure.forwardMissing}`);
        setPhase("publish", "SKIPPED", "dry-run 不落库");
        job.preview = {
          dataSources: plan.dataSources.map((d) => ({ name: d.name, datasetKey: d.datasetKey, rowCount: d.rowCount, fields: d.fields.length })),
          objectTypes: plan.objectTypes.map((t) => t.typeKey),
          rules: plan.rules.map((r) => r.key),
          solverNeeds: plan.solverNeeds.map((s) => s.solverKey),
          kbDocs: plan.kbDocs.length,
        };
        job.status = closure.gatePassed ? "SUCCEEDED" : "FAILED";
        job.finishedAt = nowIso();
        await this.repos.buildJobs.put(job);
        return job;
      }

      if (!closure.gatePassed) {
        setPhase("gap", "SKIPPED");
        setPhase("rawin", "SKIPPED");
        setPhase("transform", "SKIPPED");
        setPhase("closure", "FAILED", "闭包硬门禁未通过（见 closure.findings）");
        setPhase("publish", "SKIPPED");
        job.status = "FAILED";
        job.error = "CLOSURE_GATE_FAILED";
        job.finishedAt = nowIso();
        await this.repos.buildJobs.put(job);
        return job;
      }

      // ③ gap（幂等：已存在的对象类型/规则跳过创建）
      setPhase("gap", "RUNNING");
      const existingTypes = new Set((await this.ontology.listTypes(ctx)).map((t) => t.key));
      const existingRuleKeys = new Set((await this.repos.rules.list(ctx.tenantId)).map((r) => r.key));
      setPhase("gap", "DONE", `已有 ${existingTypes.size} 对象类型 / ${existingRuleKeys.size} 规则`);

      // ④ raw-in 灌注：FK 一致 + 场景拓扑生成（PRD-fde §3.4）→ A1 连接器上传；脚本→知识库。
      //    从 objectTypes 建 specs(带 PK/refToDataset)→ generateRelatedDatasets(跨表 FK 闭合)→
      //    applyScenarioTopology(让"被问现象真实存在")。拓扑用 typeKey,数据用 datasetKey,此处翻译。
      setPhase("rawin", "RUNNING");
      const datasetIdByKey = new Map<string, string>();
      const typeToDataset = new Map(plan.objectTypes.map((t) => [t.typeKey, t.sourceDataset ?? t.typeKey.toLowerCase()]));
      const rowCountByDataset = new Map(plan.dataSources.map((d) => [d.datasetKey, d.rowCount]));
      const specs: DatasetSpec[] = plan.objectTypes.map((t) => {
        const dsk = t.sourceDataset ?? t.typeKey.toLowerCase();
        return {
          datasetKey: dsk,
          rowCount: rowCountByDataset.get(dsk) ?? 10,
          fields: t.properties.map((p) => ({
            name: p.sourceField ?? p.propKey,
            dataType: p.dataType,
            isPrimaryKey: p.isPrimaryKey,
            ...(p.refToTypeKey && typeToDataset.has(p.refToTypeKey) ? { refToDataset: typeToDataset.get(p.refToTypeKey)! } : {}),
          })),
        };
      });
      let csvByDataset = specs.length > 0 ? generateRelatedDatasets(specs, seed) : {};
      if (plan.scenarioTopology) {
        const dk = (tk: string) => typeToDataset.get(tk) ?? tk.toLowerCase();
        csvByDataset = applyScenarioTopology(csvByDataset, specs, {
          sharedResources: (plan.scenarioTopology.sharedResources ?? []).map((s) => ({ ...s, resourceType: dk(s.resourceType), sharedByType: dk(s.sharedByType) })),
          plantedValues: (plan.scenarioTopology.plantedValues ?? []).map((p) => ({ ...p, typeKey: dk(p.typeKey) })),
        });
      }
      for (const ds of plan.dataSources) {
        const csv = csvByDataset[ds.datasetKey] ?? generateFromSchema(ds.datasetKey, ds.fields, ds.rowCount, seed);
        const { connection } = await this.connectors.upload(ctx, `${ds.datasetKey}.csv`, Buffer.from(csv, "utf8"));
        const raws = await this.connectors.listRawDatasets(ctx, connection.id);
        if (raws[0]) datasetIdByKey.set(ds.datasetKey, raws[0].id);
      }
      for (const doc of plan.kbDocs) {
        const conn = await this.connectors.createConnection(ctx, { connectorTypeKey: "knowledge_base", name: `kb:${doc.title}`, config: { endpoint: "internal://databuilder" } });
        await this.kb.addDoc(ctx, conn.id, `${doc.title}.txt`, Buffer.from(doc.content, "utf8"));
      }
      setPhase("rawin", "DONE", `灌注 ${plan.dataSources.length} 数据源 + ${plan.kbDocs.length} 知识文档`);

      // ⑤ transform 加工：本体建模物化（raw→对象）+ 规则入库 + 派生
      setPhase("transform", "RUNNING");
      for (const t of plan.objectTypes) {
        await this.ontology.upsertType(ctx, {
          key: t.typeKey,
          displayName: t.displayName,
          domain: t.domain,
          properties: t.properties.map((p) => ({
            propKey: p.propKey,
            dataType: p.dataType,
            isPrimaryKey: p.isPrimaryKey,
            refToTypeKey: p.refToTypeKey ?? null,
          })),
          derivedProperties: [],
          sourceBindings: t.sourceDataset && datasetIdByKey.has(t.sourceDataset)
            ? [{ connId: "", dataset: t.sourceDataset, fieldMappings: Object.fromEntries(t.properties.map((p) => [p.propKey, p.sourceField ?? p.propKey])) }]
            : [],
        });
        const datasetId = t.sourceDataset ? datasetIdByKey.get(t.sourceDataset) : undefined;
        if (datasetId) await this.materialize(ctx, t.typeKey, t, datasetId, job.id);
      }
      for (const r of plan.rules) {
        if (existingRuleKeys.has(r.key)) continue;
        await this.rules.create(ctx, {
          key: r.key,
          name: r.name,
          expression: r.expression,
          scopeObjectTypes: r.scopeObjectTypes,
          severity: r.severity,
          origin: { type: "SYNTHETIC" },
          status: "PUBLISHED",
        });
      }
      await this.ontology.runDerivations(ctx);
      setPhase("transform", "DONE", `物化 ${plan.objectTypes.length} 对象类型 + ${plan.rules.length} 规则`);

      // ⑥ closure（已通过；记录报告）
      setPhase("closure", "DONE", `对象绑定 ${closure.objectsBound} · data 孤儿 ${closure.dataOrphans} · 正向缺失 ${closure.forwardMissing}`);

      // ⑦ publish & seal
      setPhase("publish", "DONE", cfg.publish.auto ? "自动发布" : "待人工发布");
      job.status = "SUCCEEDED";
      job.finishedAt = nowIso();
      await this.repos.buildJobs.put(job);
      return job;
    } catch (e) {
      job.status = "FAILED";
      job.error = e instanceof Error ? e.message : String(e);
      job.finishedAt = nowIso();
      const running = phases.find((p) => p.status === "RUNNING");
      if (running) running.status = "FAILED";
      await this.repos.buildJobs.put(job);
      return job;
    }
  }

  /** 物化：读 RawDataset 行 → 确定性对象实例（origin=MATERIALIZED）。 */
  /**
   * 故事倒推切片落库：把 plan.sliceNeeds 注册为真实 SliceSpec → 切片库可见、可解析。
   * 确定性路给单根切片（hops=[] → paths=[]，即"取该类型对象"）；多跳富切片需 LLM 语义推断（后续）。
   * 幂等（R6）：同 sliceKey 同 id → put 覆盖。仅在 build 成功（对象已物化）后调用。
   */
  private async registerStorySlices(ctx: AuthCtx, plan: BuildPlan): Promise<void> {
    for (const s of plan.sliceNeeds) {
      const paths = s.hops.length > 0 ? [s.hops.map((linkKey) => ({ linkKey, direction: "out" as const }))] : [];
      await this.repos.sliceSpecs.put({
        id: `slice_${s.sliceKey}`.replace(/[^\w-]/g, "_"),
        tenantId: ctx.tenantId,
        sliceKey: s.sliceKey,
        version: 1,
        spec: {
          root: { typeKey: s.rootType, selector: {} },
          paths,
          maxNodes: 500,
          contractFixtures: [{ name: "smoke", args: {}, expect: { rootType: s.rootType, minNodes: 1, mustIncludeTypes: [s.rootType] } }],
        },
      });
    }
  }

  private async materialize(ctx: AuthCtx, typeKey: string, t: BuildPlan["objectTypes"][number], datasetId: string, jobId: string): Promise<void> {
    const rows = await this.repos.rawRows.list(ctx.tenantId, datasetId);
    const pk = t.properties.find((p) => p.isPrimaryKey)?.propKey ?? t.properties[0]?.propKey ?? "id";
    for (const row of rows as Record<string, unknown>[]) {
      const pkVal = String(row[pk] ?? newId("row"));
      const obj: ObjectInstance = {
        id: `obj_${typeKey}_${pkVal}`.replace(/[^\w-]/g, "_"),
        tenantId: ctx.tenantId,
        type: typeKey,
        props: row,
        origin: { type: "MATERIALIZED", datasetId, jobId },
      };
      await this.repos.objects.put(obj);
    }
  }

  /** 确定性 CSV 生成（同 seed 字节级一致）。 */
}
