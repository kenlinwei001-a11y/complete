import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type {
  AgentDefinition,
  AgentRunRecord,
  ExecutionPlan,
  Handoff,
  IntentDefinition,
  IntentSliceSpec,
  LlmProviderConfig,
  MaterializedIntent,
  McpServerConfig,
  ModelBinding,
  QueryTask,
  ScenarioPackage,
  SceneEntryConfig,
  Scenario,
  SkillDefinition,
  WorkflowDefinition,
} from "@platform/contracts";

import type { CredentialRow, FallbackTraceRow, QueryEventRow, Repos, ScenarioOntogenesisRunRow, TaskPatch, ToolCallRow } from "./repos.js";

const ACTIVE = ["ROUTING", "AWAITING_CLARIFICATION", "EXECUTING_WORKFLOW", "EXECUTING_AGENT"];

export async function runMigrations(pool: pg.Pool): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/persistence -> ../../migrations ; src/persistence -> ../../migrations
  const dir = join(here, "..", "..", "migrations");
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const done = await pool.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [f]);
    if (done.rowCount && done.rowCount > 0) continue;
    const sql = await readFile(join(dir, f), "utf8");
    await pool.query(sql);
    await pool.query(`INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [f]);
  }
}

/** PostgreSQL repository implementation (selected when DATABASE_URL is set). */
export async function createPgRepos(databaseUrl: string): Promise<Repos> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  await runMigrations(pool);

  const q = (text: string, params?: unknown[]) => pool.query(text, params as never[]);

  return {
    packages: {
      async insert(p: ScenarioPackage) {
        await q(
          `INSERT INTO scenario_packages(id, tenant_id, name, config, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET config = $4, updated_at = $6`,
          [p.id, p.tenantId, p.name, JSON.stringify(p), p.createdAt, p.updatedAt],
        );
      },
      async get(id) {
        const r = await q(`SELECT config FROM scenario_packages WHERE id = $1`, [id]);
        return r.rows[0]?.config as ScenarioPackage | undefined;
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT config FROM scenario_packages WHERE tenant_id = $1`, [tenantId]);
        return r.rows.map((x) => x.config as ScenarioPackage);
      },
    },
    intents: {
      async insert(i: IntentDefinition) {
        await q(
          `INSERT INTO intent_definitions(id, package_id, key, version, status, definition)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [i.id, i.packageId, i.key, i.version, i.status, JSON.stringify(i)],
        );
      },
      async update(i: IntentDefinition) {
        await q(`UPDATE intent_definitions SET status = $2, definition = $3 WHERE id = $1`, [
          i.id,
          i.status,
          JSON.stringify(i),
        ]);
      },
      async get(id) {
        const r = await q(`SELECT definition FROM intent_definitions WHERE id = $1`, [id]);
        return r.rows[0]?.definition as IntentDefinition | undefined;
      },
      async listByPackage(packageId) {
        const r = await q(`SELECT definition FROM intent_definitions WHERE package_id = $1`, [packageId]);
        return r.rows.map((x) => x.definition as IntentDefinition);
      },
    },
    plans: {
      async insert(p: ExecutionPlan) {
        await q(
          `INSERT INTO execution_plans(id, package_id, key, version, status, plan) VALUES ($1,$2,$3,$4,$5,$6)`,
          [p.id, p.packageId, p.key, p.version, p.status, JSON.stringify(p)],
        );
      },
      async update(p: ExecutionPlan) {
        await q(`UPDATE execution_plans SET status = $2, plan = $3 WHERE id = $1`, [p.id, p.status, JSON.stringify(p)]);
      },
      async get(id) {
        const r = await q(`SELECT plan FROM execution_plans WHERE id = $1`, [id]);
        return r.rows[0]?.plan as ExecutionPlan | undefined;
      },
      async listByPackage(packageId) {
        const r = await q(`SELECT plan FROM execution_plans WHERE package_id = $1`, [packageId]);
        return r.rows.map((x) => x.plan as ExecutionPlan);
      },
    },
    tasks: {
      async insert(t: QueryTask) {
        await q(
          `INSERT INTO query_tasks(id, tenant_id, user_id, package_id, conversation_id, query, context, status,
             path, classification, matched_intent, slots, answer, error, clarification_rounds, created_at, completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            t.id,
            t.tenantId,
            t.userId,
            t.packageId,
            t.conversationId,
            t.query,
            JSON.stringify(t.context),
            t.status,
            t.path ?? null,
            t.classification ? JSON.stringify(t.classification) : null,
            t.matchedIntent ? JSON.stringify(t.matchedIntent) : null,
            t.slots ? JSON.stringify(t.slots) : null,
            t.answer ? JSON.stringify(t.answer) : null,
            t.error ? JSON.stringify(t.error) : null,
            t.clarificationRounds,
            t.createdAt,
            t.completedAt ?? null,
          ],
        );
      },
      async patch(id, p: TaskPatch) {
        const sets: string[] = [];
        const vals: unknown[] = [id];
        const add = (col: string, v: unknown) => {
          vals.push(v);
          sets.push(`${col} = $${vals.length}`);
        };
        if (p.status !== undefined) add("status", p.status);
        if (p.path !== undefined) add("path", p.path);
        if (p.classification !== undefined) add("classification", JSON.stringify(p.classification));
        if (p.matchedIntent !== undefined) add("matched_intent", JSON.stringify(p.matchedIntent));
        if (p.slots !== undefined) add("slots", JSON.stringify(p.slots));
        if (p.clarificationRounds !== undefined) add("clarification_rounds", p.clarificationRounds);
        if (p.answer !== undefined) add("answer", JSON.stringify(p.answer));
        if (p.error !== undefined) add("error", JSON.stringify(p.error));
        if (p.resolvedRefs !== undefined) add("resolved_refs", JSON.stringify(p.resolvedRefs));
        if (p.completedAt !== undefined) add("completed_at", p.completedAt);
        if (sets.length === 0) return;
        await q(`UPDATE query_tasks SET ${sets.join(", ")} WHERE id = $1`, vals);
      },
      async get(id) {
        const r = await q(`SELECT * FROM query_tasks WHERE id = $1`, [id]);
        const row = r.rows[0];
        if (!row) return undefined;
        return rowToTask(row);
      },
      async countActiveByUser(tenantId, userId) {
        const r = await q(
          `SELECT count(*)::int AS n FROM query_tasks WHERE tenant_id = $1 AND user_id = $2 AND status = ANY($3)`,
          [tenantId, userId, ACTIVE],
        );
        return r.rows[0]?.n ?? 0;
      },
      async listByConversation(tenantId, conversationId) {
        const r = await q(
          `SELECT * FROM query_tasks WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at`,
          [tenantId, conversationId],
        );
        return r.rows.map(rowToTask);
      },
      async listByTenant(tenantId, limit) {
        const r = await q(
          `SELECT * FROM query_tasks WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
          [tenantId, limit],
        );
        return r.rows.map(rowToTask);
      },
      async listStuckExecuting(cutoffIso) {
        const r = await q(
          `SELECT * FROM query_tasks WHERE status LIKE 'EXECUTING_%' AND created_at < $1`,
          [cutoffIso],
        );
        return r.rows.map(rowToTask);
      },
    },
    events: {
      async append(taskId, event, payload) {
        const r = await q(
          `INSERT INTO query_events(task_id, seq, event, payload)
           VALUES ($1, COALESCE((SELECT max(seq) FROM query_events WHERE task_id = $1), 0) + 1, $2, $3)
           RETURNING seq, created_at`,
          [taskId, event, JSON.stringify(payload ?? null)],
        );
        return {
          taskId,
          seq: r.rows[0].seq as number,
          event,
          payload,
          createdAt: new Date(r.rows[0].created_at as string).toISOString(),
        } satisfies QueryEventRow;
      },
      async listAfter(taskId, afterSeq) {
        const r = await q(`SELECT * FROM query_events WHERE task_id = $1 AND seq > $2 ORDER BY seq`, [
          taskId,
          afterSeq,
        ]);
        return r.rows.map((x) => ({
          taskId: x.task_id as string,
          seq: x.seq as number,
          event: x.event as string,
          payload: x.payload,
          createdAt: new Date(x.created_at as string).toISOString(),
        }));
      },
    },
    toolCalls: {
      async insert(row: ToolCallRow) {
        await q(
          `INSERT INTO tool_calls(id, task_id, tool_name, input, output_digest, output, outcome, duration_ms, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            row.id,
            row.taskId,
            row.toolName,
            JSON.stringify(row.input ?? null),
            row.outputDigest,
            row.output === null ? null : JSON.stringify(row.output),
            row.outcome,
            row.durationMs,
            row.createdAt,
          ],
        );
      },
      async get(id) {
        const r = await q(`SELECT * FROM tool_calls WHERE id = $1`, [id]);
        const x = r.rows[0];
        if (!x) return undefined;
        return rowToToolCall(x);
      },
      async listByTask(taskId) {
        const r = await q(`SELECT * FROM tool_calls WHERE task_id = $1 ORDER BY created_at`, [taskId]);
        return r.rows.map(rowToToolCall);
      },
    },
    agentRuns: {
      async insert(rec: AgentRunRecord) {
        await q(
          `INSERT INTO agent_runs(id, task_id, record) VALUES ($1,$2,$3)
           ON CONFLICT (task_id) DO UPDATE SET record = $3`,
          [rec.id, rec.taskId, JSON.stringify(rec)],
        );
      },
      async getByTask(taskId) {
        const r = await q(`SELECT record FROM agent_runs WHERE task_id = $1`, [taskId]);
        return r.rows[0]?.record as AgentRunRecord | undefined;
      },
    },
    handoffs: {
      async insert(h: Handoff) {
        await q(
          `INSERT INTO handoffs(id, tenant_id, task_id, from_agent_id, to_agent_id, record)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET record = $6`,
          [h.id, h.tenantId, h.taskId, h.fromAgentId, h.toAgentId, JSON.stringify(h)],
        );
      },
      async get(tenantId, id) {
        // R2：tenant_id 谓词随身，跨租户返回空。
        const r = await q(`SELECT record FROM handoffs WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
        return r.rows[0]?.record as Handoff | undefined;
      },
      async listByTask(tenantId, taskId) {
        const r = await q(
          `SELECT record FROM handoffs WHERE tenant_id = $1 AND task_id = $2 ORDER BY (record->>'at') ASC`,
          [tenantId, taskId],
        );
        return r.rows.map((x) => x.record as Handoff);
      },
    },
    fallbackTraces: {
      async insert(t) {
        await q(
          `INSERT INTO fallback_traces(id, task_id, tenant_id, package_id, normalized_query, trace, outcome, feedback, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [t.id, t.taskId, t.tenantId, t.packageId, t.normalizedQuery, JSON.stringify(t), t.outcome, t.feedback ?? null, t.createdAt],
        );
      },
      async get(id) {
        const r = await q(`SELECT trace FROM fallback_traces WHERE id = $1`, [id]);
        return r.rows[0]?.trace as FallbackTraceRow | undefined;
      },
      async getByTask(taskId) {
        const r = await q(`SELECT trace FROM fallback_traces WHERE task_id = $1`, [taskId]);
        return r.rows[0]?.trace as FallbackTraceRow | undefined;
      },
      async setFeedback(taskId, vote) {
        const r = await q(
          `UPDATE fallback_traces SET feedback = $2, trace = jsonb_set(trace, '{feedback}', to_jsonb($2::text)) WHERE task_id = $1`,
          [taskId, vote],
        );
        return (r.rowCount ?? 0) > 0;
      },
      async list(filter) {
        const conds = ["tenant_id = $1"];
        const vals: unknown[] = [filter.tenantId];
        if (filter.packageId) {
          vals.push(filter.packageId);
          conds.push(`package_id = $${vals.length}`);
        }
        if (filter.from) {
          vals.push(filter.from);
          conds.push(`created_at >= $${vals.length}`);
        }
        if (filter.to) {
          vals.push(filter.to);
          conds.push(`created_at <= $${vals.length}`);
        }
        const r = await q(`SELECT trace FROM fallback_traces WHERE ${conds.join(" AND ")}`, vals);
        return r.rows.map((x) => x.trace as FallbackTraceRow);
      },
    },
    agents: versionedRepo<AgentDefinition>(q, "agents"),
    workflows: versionedRepo<WorkflowDefinition>(q, "workflows"),
    skills: versionedRepo<SkillDefinition>(q, "skills"),
    mcpConfigs: {
      async insert(c: McpServerConfig) {
        await q(`INSERT INTO mcp_configs(id, tenant_id, status, config) VALUES ($1,$2,$3,$4)`, [
          c.id,
          c.tenantId,
          c.status,
          JSON.stringify(c),
        ]);
      },
      async update(c: McpServerConfig) {
        await q(`UPDATE mcp_configs SET status = $2, config = $3 WHERE id = $1`, [c.id, c.status, JSON.stringify(c)]);
      },
      async remove(id) {
        await q(`DELETE FROM mcp_configs WHERE id = $1`, [id]);
      },
      async get(id) {
        const r = await q(`SELECT config FROM mcp_configs WHERE id = $1`, [id]);
        return r.rows[0]?.config as McpServerConfig | undefined;
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT config FROM mcp_configs WHERE tenant_id = $1`, [tenantId]);
        return r.rows.map((x) => x.config as McpServerConfig);
      },
    },
    sceneEntries: {
      async upsert(s: SceneEntryConfig) {
        await q(
          `INSERT INTO scene_entries(id, tenant_id, view_key, config) VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, view_key) DO UPDATE SET id = $1, config = $4`,
          [s.id, s.tenantId, s.viewKey, JSON.stringify(s)],
        );
      },
      async remove(id) {
        await q(`DELETE FROM scene_entries WHERE id = $1`, [id]);
      },
      async get(id) {
        const r = await q(`SELECT config FROM scene_entries WHERE id = $1`, [id]);
        return r.rows[0]?.config as SceneEntryConfig | undefined;
      },
      async byView(tenantId, viewKey) {
        const r = await q(`SELECT config FROM scene_entries WHERE tenant_id = $1 AND view_key = $2`, [
          tenantId,
          viewKey,
        ]);
        return r.rows[0]?.config as SceneEntryConfig | undefined;
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT config FROM scene_entries WHERE tenant_id = $1`, [tenantId]);
        return r.rows.map((x) => x.config as SceneEntryConfig);
      },
    },
    scenarios: {
      async upsert(s: Scenario) {
        await q(
          `INSERT INTO scenarios(id, tenant_id, scenario_key, config) VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, scenario_key) DO UPDATE SET id = $1, config = $4`,
          [s.id, s.tenantId, s.scenarioKey, JSON.stringify(s)],
        );
      },
      async remove(id) {
        await q(`DELETE FROM scenarios WHERE id = $1`, [id]);
      },
      async get(id) {
        const r = await q(`SELECT config FROM scenarios WHERE id = $1`, [id]);
        return r.rows[0]?.config as Scenario | undefined;
      },
      async byKey(tenantId, scenarioKey) {
        const r = await q(`SELECT config FROM scenarios WHERE tenant_id = $1 AND scenario_key = $2`, [tenantId, scenarioKey]);
        return r.rows[0]?.config as Scenario | undefined;
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT config FROM scenarios WHERE tenant_id = $1`, [tenantId]);
        return r.rows.map((x) => x.config as Scenario);
      },
    },
    // PRD-scenario-ontogenesis §4：发育运行一等留痕（migration 012）。R2：读一律带 tenant_id 谓词。
    ontogenesisRuns: {
      async insert(r: ScenarioOntogenesisRunRow) {
        await q(
          `INSERT INTO scenario_ontogenesis_runs(run_id, tenant_id, scenario_key, ran_at, record)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (run_id) DO UPDATE SET record = $5`,
          [r.runId, r.tenantId, r.scenarioKey, r.ranAt, JSON.stringify(r)],
        );
      },
      async get(tenantId, runId) {
        const r = await q(`SELECT record FROM scenario_ontogenesis_runs WHERE run_id = $1 AND tenant_id = $2`, [runId, tenantId]);
        return r.rows[0]?.record as ScenarioOntogenesisRunRow | undefined;
      },
      async listByScenario(tenantId, scenarioKey) {
        const r = await q(
          `SELECT record FROM scenario_ontogenesis_runs WHERE tenant_id = $1 AND scenario_key = $2 ORDER BY ran_at DESC, run_id DESC`,
          [tenantId, scenarioKey],
        );
        return r.rows.map((x) => x.record as ScenarioOntogenesisRunRow);
      },
      async listByTenant(tenantId) {
        const r = await q(
          `SELECT record FROM scenario_ontogenesis_runs WHERE tenant_id = $1 ORDER BY ran_at DESC, run_id DESC`,
          [tenantId],
        );
        return r.rows.map((x) => x.record as ScenarioOntogenesisRunRow);
      },
    },
    materializedIntents: {
      async upsert(i: MaterializedIntent) {
        await q(
          `INSERT INTO materialized_intents(id, tenant_id, key, config) VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, key) DO UPDATE SET id = $1, config = $4`,
          [i.id, i.tenantId, i.key, JSON.stringify(i)],
        );
      },
      async remove(id) {
        await q(`DELETE FROM materialized_intents WHERE id = $1`, [id]);
      },
      async get(id) {
        const r = await q(`SELECT config FROM materialized_intents WHERE id = $1`, [id]);
        return r.rows[0]?.config as MaterializedIntent | undefined;
      },
      async byKey(tenantId, key) {
        const r = await q(`SELECT config FROM materialized_intents WHERE tenant_id = $1 AND key = $2`, [tenantId, key]);
        return r.rows[0]?.config as MaterializedIntent | undefined;
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT config FROM materialized_intents WHERE tenant_id = $1`, [tenantId]);
        return r.rows.map((x) => x.config as MaterializedIntent);
      },
    },
    intentSlices: {
      async upsert(s: IntentSliceSpec) {
        await q(
          `INSERT INTO intent_slices(tenant_id, slice_key, config) VALUES ($1,$2,$3)
           ON CONFLICT (tenant_id, slice_key) DO UPDATE SET config = $3`,
          [s.tenantId, s.sliceKey, JSON.stringify(s)],
        );
      },
      async byKey(tenantId, sliceKey) {
        const r = await q(`SELECT config FROM intent_slices WHERE tenant_id = $1 AND slice_key = $2`, [tenantId, sliceKey]);
        return r.rows[0]?.config as IntentSliceSpec | undefined;
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT config FROM intent_slices WHERE tenant_id = $1`, [tenantId]);
        return r.rows.map((x) => x.config as IntentSliceSpec);
      },
    },
    experience: {
      async upsert(c) {
        await q(
          `INSERT INTO experience_cases(id, tenant_id, doc) VALUES ($1,$2,$3)
           ON CONFLICT (id) DO UPDATE SET doc = $3`,
          [c.id, c.tenantId, JSON.stringify(c)],
        );
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT doc FROM experience_cases WHERE tenant_id = $1 ORDER BY id`, [tenantId]);
        return r.rows.map((x) => x.doc as import("./repos.js").ExperienceCaseRow);
      },
    },
    growthLedger: {
      async insert(e) {
        await q(`INSERT INTO growth_ledger(id, tenant_id, doc) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`, [e.id, e.tenantId, JSON.stringify(e)]);
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT doc FROM growth_ledger WHERE tenant_id = $1 ORDER BY id DESC`, [tenantId]);
        return r.rows.map((x) => x.doc as import("@platform/contracts").GrowthLedgerEntry);
      },
    },
    growthTickets: {
      async upsert(t) {
        await q(`INSERT INTO growth_tickets(id, tenant_id, doc) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET doc = $3`, [t.id, t.tenantId, JSON.stringify(t)]);
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT doc FROM growth_tickets WHERE tenant_id = $1 ORDER BY id DESC`, [tenantId]);
        return r.rows.map((x) => x.doc as import("@platform/contracts").GrowthTicket);
      },
    },
    growthWorklist: {
      async upsert(w) {
        await q(`INSERT INTO growth_worklist(id, tenant_id, doc) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET doc = $3`, [w.id, w.tenantId, JSON.stringify(w)]);
      },
      async get(tenantId, id) {
        const r = await q(`SELECT doc FROM growth_worklist WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
        return r.rows[0]?.doc as import("@platform/contracts").WorklistItem | undefined;
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT doc FROM growth_worklist WHERE tenant_id = $1 ORDER BY (doc->>'createdAt') DESC`, [tenantId]);
        return r.rows.map((x) => x.doc as import("@platform/contracts").WorklistItem);
      },
    },
    evalCases: {
      async upsert(c) {
        await q(
          `INSERT INTO eval_cases(id, tenant_id, suite, doc) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET doc = $4, suite = $3`,
          [c.id, c.tenantId, c.suite, JSON.stringify(c)],
        );
      },
      async get(id) {
        const r = await q(`SELECT doc FROM eval_cases WHERE id = $1`, [id]);
        return r.rows[0]?.doc as import("@platform/contracts").EvalCase | undefined;
      },
      async listByTenant(tenantId, suite) {
        const r = suite
          ? await q(`SELECT doc FROM eval_cases WHERE tenant_id = $1 AND suite = $2 ORDER BY id`, [tenantId, suite])
          : await q(`SELECT doc FROM eval_cases WHERE tenant_id = $1 ORDER BY id`, [tenantId]);
        return r.rows.map((x) => x.doc as import("@platform/contracts").EvalCase);
      },
    },
    evalRuns: {
      async insert(rep) {
        await q(`INSERT INTO eval_runs(id, tenant_id, doc) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET doc = $3`, [
          rep.id,
          rep.tenantId,
          JSON.stringify(rep),
        ]);
      },
      async get(id) {
        const r = await q(`SELECT doc FROM eval_runs WHERE id = $1`, [id]);
        return r.rows[0]?.doc as import("@platform/contracts").EvalRunReport | undefined;
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT doc FROM eval_runs WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]);
        return r.rows.map((x) => x.doc as import("@platform/contracts").EvalRunReport);
      },
    },
    credentials: {
      async insert(c: CredentialRow) {
        await q(`INSERT INTO credentials(id, tenant_id, name, ciphertext, created_at) VALUES ($1,$2,$3,$4,$5)`, [
          c.id,
          c.tenantId,
          c.name,
          c.ciphertext,
          c.createdAt,
        ]);
      },
      async get(id) {
        const r = await q(`SELECT * FROM credentials WHERE id = $1`, [id]);
        const x = r.rows[0];
        if (!x) return undefined;
        return {
          id: x.id as string,
          tenantId: x.tenant_id as string,
          name: x.name as string,
          ciphertext: x.ciphertext as string,
          createdAt: new Date(x.created_at as string).toISOString(),
        };
      },
    },
    llmProviders: {
      async upsert(c: LlmProviderConfig) {
        await q(
          `INSERT INTO llm_providers(id, tenant_id, key, config) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET tenant_id = $2, key = $3, config = $4`,
          [c.id, c.tenantId ?? null, c.key, JSON.stringify(c)],
        );
      },
      async get(id) {
        const r = await q(`SELECT config FROM llm_providers WHERE id = $1`, [id]);
        return r.rows[0]?.config as LlmProviderConfig | undefined;
      },
      async byKey(tenantId, key) {
        const r = tenantId
          ? await q(`SELECT config FROM llm_providers WHERE tenant_id = $1 AND key = $2`, [tenantId, key])
          : await q(`SELECT config FROM llm_providers WHERE tenant_id IS NULL AND key = $1`, [key]);
        return r.rows[0]?.config as LlmProviderConfig | undefined;
      },
      async listByTenant(tenantId) {
        const r = await q(`SELECT config FROM llm_providers WHERE tenant_id = $1`, [tenantId]);
        return r.rows.map((x) => x.config as LlmProviderConfig);
      },
    },
    llmBindings: {
      async put(tenantId, bindings: ModelBinding[]) {
        await q(`DELETE FROM llm_bindings WHERE tenant_id = $1`, [tenantId]);
        for (const b of bindings) {
          await q(`INSERT INTO llm_bindings(tenant_id, role, binding) VALUES ($1,$2,$3)`, [
            tenantId,
            b.role,
            JSON.stringify(b),
          ]);
        }
      },
      async list(tenantId) {
        const r = await q(`SELECT binding FROM llm_bindings WHERE tenant_id = $1`, [tenantId]);
        return r.rows.map((x) => x.binding as ModelBinding);
      },
      async get(tenantId, role) {
        const r = await q(`SELECT binding FROM llm_bindings WHERE tenant_id = $1 AND role = $2`, [tenantId, role]);
        return r.rows[0]?.binding as ModelBinding | undefined;
      },
    },
    idempotency: {
      async putIfAbsent(key, taskId) {
        const r = await q(
          `INSERT INTO idempotency_keys(key, task_id) VALUES ($1,$2)
           ON CONFLICT (key) DO UPDATE SET task_id = CASE
             WHEN idempotency_keys.created_at < now() - interval '24 hours' THEN EXCLUDED.task_id
             ELSE idempotency_keys.task_id END,
             created_at = CASE
             WHEN idempotency_keys.created_at < now() - interval '24 hours' THEN now()
             ELSE idempotency_keys.created_at END
           RETURNING task_id`,
          [key, taskId],
        );
        return r.rows[0].task_id as string;
      },
    },
    domainEvents: {
      async append(e) {
        await q(`INSERT INTO domain_events(id, tenant_id, event, payload, created_at) VALUES ($1,$2,$3,$4,$5)`, [e.id, e.tenantId, e.event, JSON.stringify(e.payload), e.createdAt]);
      },
      async listSince(tenantId, since) {
        const r = await q(
          `SELECT id, tenant_id, event, payload, created_at FROM domain_events WHERE tenant_id = $1 AND ($2::text IS NULL OR created_at >= $2::timestamptz) ORDER BY created_at ASC LIMIT 200`,
          [tenantId, since ?? null],
        );
        return r.rows.map((x) => ({
          id: x.id as string,
          tenantId: x.tenant_id as string,
          event: x.event as string,
          payload: (x.payload ?? {}) as Record<string, unknown>,
          createdAt: new Date(x.created_at as string | Date).toISOString(),
        }));
      },
    },
    async close() {
      await pool.end();
    },
  };

  function versionedRepo<T extends { id: string; tenantId: string; key: string; version: number; status: string }>(
    query: typeof q,
    table: string,
  ) {
    return {
      async insert(v: T) {
        await query(`INSERT INTO ${table}(id, tenant_id, key, version, status, definition) VALUES ($1,$2,$3,$4,$5,$6)`, [
          v.id,
          v.tenantId,
          v.key,
          v.version,
          v.status,
          JSON.stringify(v),
        ]);
      },
      async update(v: T) {
        await query(`UPDATE ${table} SET status = $2, definition = $3 WHERE id = $1`, [v.id, v.status, JSON.stringify(v)]);
      },
      async remove(id: string) {
        await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      },
      async get(id: string) {
        const r = await query(`SELECT definition FROM ${table} WHERE id = $1`, [id]);
        return r.rows[0]?.definition as T | undefined;
      },
      async latestByKey(tenantId: string, key: string) {
        const r = await query(
          `SELECT definition FROM ${table} WHERE tenant_id = $1 AND key = $2 ORDER BY version DESC LIMIT 1`,
          [tenantId, key],
        );
        return r.rows[0]?.definition as T | undefined;
      },
      async listByTenant(tenantId: string) {
        const r = await query(`SELECT definition FROM ${table} WHERE tenant_id = $1`, [tenantId]);
        return r.rows.map((x) => x.definition as T);
      },
    };
  }
}

function rowToTask(row: Record<string, unknown>): QueryTask {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    userId: row.user_id as string,
    packageId: row.package_id as string,
    conversationId: row.conversation_id as string,
    query: row.query as string,
    context: row.context as QueryTask["context"],
    status: row.status as QueryTask["status"],
    path: (row.path as QueryTask["path"]) ?? undefined,
    classification: (row.classification as QueryTask["classification"]) ?? undefined,
    matchedIntent: (row.matched_intent as QueryTask["matchedIntent"]) ?? undefined,
    slots: (row.slots as Record<string, unknown>) ?? undefined,
    clarificationRounds: row.clarification_rounds as number,
    answer: (row.answer as QueryTask["answer"]) ?? undefined,
    error: (row.error as QueryTask["error"]) ?? undefined,
    resolvedRefs: (row.resolved_refs as QueryTask["resolvedRefs"]) ?? undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at as string).toISOString() : undefined,
  };
}

function rowToToolCall(x: Record<string, unknown>): ToolCallRow {
  return {
    id: x.id as string,
    taskId: x.task_id as string,
    toolName: x.tool_name as string,
    input: x.input,
    outputDigest: x.output_digest as string,
    output: x.output ?? null,
    outcome: x.outcome as ToolCallRow["outcome"],
    durationMs: x.duration_ms as number,
    createdAt: new Date(x.created_at as string).toISOString(),
  };
}
