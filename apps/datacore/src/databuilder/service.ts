import { createHash } from "node:crypto";
import type {
  BuildJob,
  BuildPhase,
  BuildPlan,
  BuildRunBody,
  DataBuilderAgent,
  DataBuilderConfig,
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
import { comprehendScript } from "./comprehend.js";
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

  async runStory(ctx: AuthCtx, body: BuildRunBody): Promise<StoryBuildRun> {
    const connBefore = new Set((await this.repos.connections.list(ctx.tenantId)).map((c) => c.id));
    const dsBefore = new Set((await this.repos.rawDatasets.list(ctx.tenantId)).map((d) => d.id));

    const job = await this.run(ctx, body);
    const plan = job.planId ? await this.repos.buildPlans.get(ctx.tenantId, job.planId) : undefined;

    const producedConnections = (await this.repos.connections.list(ctx.tenantId))
      .filter((c) => !connBefore.has(c.id))
      .map((c) => c.id);
    const producedDatasets = (await this.repos.rawDatasets.list(ctx.tenantId))
      .filter((d) => !dsBefore.has(d.id))
      .map((d) => d.id);

    const run: StoryBuildRun = {
      id: newId("sbr"),
      tenantId: ctx.tenantId,
      script: body.script.trim(),
      buildPlan: plan,
      closureReport: job.closure,
      producedConnections,
      producedDatasets,
      status: job.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
      createdAt: nowIso(),
    };
    await this.repos.storyBuildRuns.put(run);
    return run;
  }

  async listStoryRuns(ctx: AuthCtx): Promise<StoryBuildRun[]> {
    return (await this.repos.storyBuildRuns.list(ctx.tenantId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async getStoryRun(ctx: AuthCtx, id: string): Promise<StoryBuildRun> {
    const r = await this.repos.storyBuildRuns.get(ctx.tenantId, id);
    if (!r) throw notFound("story build run");
    return r;
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
