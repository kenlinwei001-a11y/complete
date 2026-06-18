import { createHash } from "node:crypto";
import type {
  BuildJob,
  BuildPhase,
  BuildPlan,
  BuildRunBody,
  BackfillReport,
  DataBuilderAgent,
  DataBuilderConfig,
  InputManifest,
  ScaffoldManifest,
  ScaffoldReceipt,
  StoryBuildRun,
} from "@platform/contracts";
import { BUILD_PHASES, DataBuilderConfigSchema } from "@platform/contracts";
import type { AuthCtx, ObjectInstance } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OntologyService } from "../ontology.js";
import type { RulesService } from "../rules.js";
import type { ConnectorService } from "../connectors/service.js";
import type { KbService } from "../kb.js";
import { newId } from "../ids.js";
import { invalidState, notFound, validationError } from "../errors.js";
import { comprehendScript, deriveBackfillScripts } from "./comprehend.js";
import { selfCheckGaps } from "./selfcheck.js";
import { generateFromSchema } from "../synthetic/schema-gen.js";
import { validateClosure } from "./closure.js";
import { DEFAULT_BUILDER_CONFIG, DEFAULT_BUILDER_KEY, DEFAULT_BUILDER_NAME } from "./preset.js";

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
  ) {}

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

  /** A 栈构建成功 ⊕ 跨系统全链闭合 → SUCCEEDED；任一断 → FAILED（R11 跨系统）。 */
  private mergeStatus(jobStatus: string, receipt: ScaffoldReceipt | undefined): StoryBuildRun["status"] {
    if (jobStatus !== "SUCCEEDED") return "FAILED";
    if (receipt && !receipt.fullChainOk) return "FAILED";
    return "SUCCEEDED";
  }

  async runStory(ctx: AuthCtx, body: BuildRunBody): Promise<StoryBuildRun> {
    const id = newId("sbr");
    const connBefore = new Set((await this.repos.connections.list(ctx.tenantId)).map((c) => c.id));
    const dsBefore = new Set((await this.repos.rawDatasets.list(ctx.tenantId)).map((d) => d.id));

    const job = await this.run(ctx, body);
    const plan = job.planId ? await this.repos.buildPlans.get(ctx.tenantId, job.planId) : undefined;
    const scaffoldReceipt = await this.crossSystemScaffold(ctx, id, plan);

    const producedConnections = (await this.repos.connections.list(ctx.tenantId))
      .filter((c) => !connBefore.has(c.id))
      .map((c) => c.id);
    const producedDatasets = (await this.repos.rawDatasets.list(ctx.tenantId))
      .filter((d) => !dsBefore.has(d.id))
      .map((d) => d.id);

    const run: StoryBuildRun = {
      id,
      tenantId: ctx.tenantId,
      script: body.script.trim(),
      buildPlan: plan,
      closureReport: job.closure,
      scaffoldReceipt,
      gapReport: selfCheckGaps(body.script.trim(), id, job.closure, scaffoldReceipt),
      producedConnections,
      producedDatasets,
      status: this.mergeStatus(job.status, scaffoldReceipt),
      createdAt: nowIso(),
    };
    await this.repos.storyBuildRuns.put(run);
    return run;
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
      const run = await this.runStory(ctx, { script, builderKey: DEFAULT_BUILDER_KEY });
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
      status: "PENDING_INPUT",
      createdAt: nowIso(),
    };
    await this.repos.storyBuildRuns.put(run);
    return run;
  }

  /** PATCH inputs：补录 ASK_USER 字段（seed）→ 续跑既有七阶段建域 → 更新同一条历史记录。 */
  async submitStoryInputs(ctx: AuthCtx, id: string, inputs: Record<string, string | number | boolean>): Promise<StoryBuildRun> {
    const run = await this.getStoryRun(ctx, id);
    if (run.status !== "PENDING_INPUT") throw invalidState("story run not awaiting input");
    const seedRaw = inputs.seed;
    const seed = typeof seedRaw === "number" ? seedRaw : typeof seedRaw === "string" && seedRaw.trim() !== "" ? Number(seedRaw) : 42;

    const connBefore = new Set((await this.repos.connections.list(ctx.tenantId)).map((c) => c.id));
    const dsBefore = new Set((await this.repos.rawDatasets.list(ctx.tenantId)).map((d) => d.id));
    const job = await this.run(ctx, { script: run.script, seed, builderKey: DEFAULT_BUILDER_KEY });
    const plan = job.planId ? await this.repos.buildPlans.get(ctx.tenantId, job.planId) : undefined;
    const scaffoldReceipt = await this.crossSystemScaffold(ctx, run.id, plan);

    const updated: StoryBuildRun = {
      ...run,
      buildPlan: plan,
      closureReport: job.closure,
      scaffoldReceipt,
      gapReport: selfCheckGaps(run.script, run.id, job.closure, scaffoldReceipt),
      producedConnections: (await this.repos.connections.list(ctx.tenantId)).filter((c) => !connBefore.has(c.id)).map((c) => c.id),
      producedDatasets: (await this.repos.rawDatasets.list(ctx.tenantId)).filter((d) => !dsBefore.has(d.id)).map((d) => d.id),
      status: this.mergeStatus(job.status, scaffoldReceipt),
    };
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
        const body0 = comprehendScript(script, seed);
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

      // ④ raw-in 灌注：结构化数据→A1 连接器上传（留上传记录）；脚本→知识库
      setPhase("rawin", "RUNNING");
      const datasetIdByKey = new Map<string, string>();
      for (const ds of plan.dataSources) {
        const csv = generateFromSchema(ds.datasetKey, ds.fields, ds.rowCount, seed);
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
