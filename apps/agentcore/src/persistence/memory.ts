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
import type {
  CredentialRow,
  DomainEventRow,
  ExperienceCaseRow,
  FallbackTraceRow,
  IdempotencyRow,
  QueryEventRow,
  Repos,
  ScenarioOntogenesisRunRow,
  TaskPatch,
  ToolCallRow,
} from "./repos.js";

const ACTIVE_STATUSES = new Set(["ROUTING", "AWAITING_CLARIFICATION", "EXECUTING_WORKFLOW", "EXECUTING_AGENT"]);

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/** In-memory repository implementation. Used by all tests; transaction semantics best-effort. */
export function createMemoryRepos(): Repos {
  const packages = new Map<string, ScenarioPackage>();
  const intents = new Map<string, IntentDefinition>();
  const plans = new Map<string, ExecutionPlan>();
  const tasks = new Map<string, QueryTask>();
  const events = new Map<string, QueryEventRow[]>();
  const toolCalls = new Map<string, ToolCallRow>();
  const agentRuns = new Map<string, AgentRunRecord>();
  const handoffs = new Map<string, Handoff>();
  const fallbacks = new Map<string, FallbackTraceRow>();
  const agents = new Map<string, AgentDefinition>();
  const workflows = new Map<string, WorkflowDefinition>();
  const skills = new Map<string, SkillDefinition>();
  const mcpConfigs = new Map<string, McpServerConfig>();
  const sceneEntries = new Map<string, SceneEntryConfig>();
  const scenarios = new Map<string, Scenario>();
  const ontogenesisRuns = new Map<string, ScenarioOntogenesisRunRow>();
  const materializedIntents = new Map<string, MaterializedIntent>();
  const intentSlices = new Map<string, IntentSliceSpec>();
  const credentials = new Map<string, CredentialRow>();
  const idempotency = new Map<string, IdempotencyRow>();
  const llmProviders = new Map<string, LlmProviderConfig>();
  const llmBindings = new Map<string, ModelBinding[]>();
  const experience = new Map<string, ExperienceCaseRow>();
  const domainEvents: DomainEventRow[] = [];
  const growthLedger = new Map<string, import("@platform/contracts").GrowthLedgerEntry>();
  const growthTickets = new Map<string, import("@platform/contracts").GrowthTicket>();
  const growthWorklist = new Map<string, import("@platform/contracts").WorklistItem>();
  const evalCases = new Map<string, import("@platform/contracts").EvalCase>();
  const evalRuns = new Map<string, import("@platform/contracts").EvalRunReport>();

  return {
    packages: {
      async insert(p) {
        packages.set(p.id, clone(p));
      },
      async get(id) {
        return clone(packages.get(id));
      },
      async listByTenant(tenantId) {
        return [...packages.values()].filter((p) => p.tenantId === tenantId).map(clone);
      },
    },
    intents: {
      async insert(i) {
        intents.set(i.id, clone(i));
      },
      async update(i) {
        intents.set(i.id, clone(i));
      },
      async get(id) {
        return clone(intents.get(id));
      },
      async listByPackage(packageId) {
        return [...intents.values()].filter((i) => i.packageId === packageId).map(clone);
      },
    },
    plans: {
      async insert(p) {
        plans.set(p.id, clone(p));
      },
      async update(p) {
        plans.set(p.id, clone(p));
      },
      async get(id) {
        return clone(plans.get(id));
      },
      async listByPackage(packageId) {
        return [...plans.values()].filter((p) => p.packageId === packageId).map(clone);
      },
    },
    tasks: {
      async insert(t) {
        tasks.set(t.id, clone(t));
      },
      async patch(id, patch: TaskPatch) {
        const t = tasks.get(id);
        if (!t) return;
        tasks.set(id, { ...t, ...clone(patch) } as QueryTask);
      },
      async get(id) {
        return clone(tasks.get(id));
      },
      async countActiveByUser(tenantId, userId) {
        return [...tasks.values()].filter(
          (t) => t.tenantId === tenantId && t.userId === userId && ACTIVE_STATUSES.has(t.status),
        ).length;
      },
      async listByConversation(tenantId, conversationId) {
        return [...tasks.values()]
          .filter((t) => t.tenantId === tenantId && t.conversationId === conversationId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(clone);
      },
      async listByTenant(tenantId, limit) {
        return [...tasks.values()]
          .filter((t) => t.tenantId === tenantId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit)
          .map(clone);
      },
      async listStuckExecuting(cutoffIso) {
        return [...tasks.values()]
          .filter((t) => t.status.startsWith("EXECUTING_") && t.createdAt < cutoffIso)
          .map(clone);
      },
    },
    events: {
      async append(taskId, event, payload) {
        const list = events.get(taskId) ?? [];
        const row: QueryEventRow = {
          taskId,
          seq: list.length + 1,
          event,
          payload: clone(payload),
          createdAt: new Date().toISOString(),
        };
        list.push(row);
        events.set(taskId, list);
        return clone(row);
      },
      async listAfter(taskId, afterSeq) {
        return (events.get(taskId) ?? []).filter((e) => e.seq > afterSeq).map(clone);
      },
    },
    toolCalls: {
      async insert(row) {
        toolCalls.set(row.id, clone(row));
      },
      async get(id) {
        return clone(toolCalls.get(id));
      },
      async listByTask(taskId) {
        return [...toolCalls.values()]
          .filter((r) => r.taskId === taskId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(clone);
      },
    },
    agentRuns: {
      async insert(r) {
        agentRuns.set(r.taskId, clone(r));
      },
      async getByTask(taskId) {
        return clone(agentRuns.get(taskId));
      },
    },
    handoffs: {
      async insert(h) {
        handoffs.set(h.id, clone(h));
      },
      async get(tenantId, id) {
        const h = handoffs.get(id);
        // R2：跨租户不可见（返回 undefined，等价 404）。
        return h && h.tenantId === tenantId ? clone(h) : undefined;
      },
      async listByTask(tenantId, taskId) {
        return [...handoffs.values()]
          .filter((h) => h.tenantId === tenantId && h.taskId === taskId)
          .sort((a, b) => a.at.localeCompare(b.at))
          .map(clone);
      },
    },
    fallbackTraces: {
      async insert(t) {
        fallbacks.set(t.id, clone(t));
      },
      async get(id) {
        return clone(fallbacks.get(id));
      },
      async getByTask(taskId) {
        return clone([...fallbacks.values()].find((t) => t.taskId === taskId));
      },
      async setFeedback(taskId, vote) {
        const t = [...fallbacks.values()].find((x) => x.taskId === taskId);
        if (!t) return false;
        t.feedback = vote;
        return true;
      },
      async list(filter) {
        return [...fallbacks.values()]
          .filter(
            (t) =>
              t.tenantId === filter.tenantId &&
              (!filter.packageId || t.packageId === filter.packageId) &&
              (!filter.from || t.createdAt >= filter.from) &&
              (!filter.to || t.createdAt <= filter.to),
          )
          .map(clone);
      },
    },
    agents: {
      async insert(a) {
        agents.set(a.id, clone(a));
      },
      async update(a) {
        agents.set(a.id, clone(a));
      },
      async remove(id) {
        agents.delete(id);
      },
      async get(id) {
        return clone(agents.get(id));
      },
      async latestByKey(tenantId, key) {
        const list = [...agents.values()]
          .filter((a) => a.tenantId === tenantId && a.key === key)
          .sort((a, b) => b.version - a.version);
        return clone(list[0]);
      },
      async listByTenant(tenantId) {
        return [...agents.values()].filter((a) => a.tenantId === tenantId).map(clone);
      },
    },
    workflows: {
      async insert(w) {
        workflows.set(w.id, clone(w));
      },
      async update(w) {
        workflows.set(w.id, clone(w));
      },
      async remove(id) {
        workflows.delete(id);
      },
      async get(id) {
        return clone(workflows.get(id));
      },
      async latestByKey(tenantId, key) {
        const list = [...workflows.values()]
          .filter((w) => w.tenantId === tenantId && w.key === key)
          .sort((a, b) => b.version - a.version);
        return clone(list[0]);
      },
      async listByTenant(tenantId) {
        return [...workflows.values()].filter((w) => w.tenantId === tenantId).map(clone);
      },
    },
    skills: {
      async insert(s) {
        skills.set(s.id, clone(s));
      },
      async update(s) {
        skills.set(s.id, clone(s));
      },
      async remove(id) {
        skills.delete(id);
      },
      async get(id) {
        return clone(skills.get(id));
      },
      async listByTenant(tenantId) {
        return [...skills.values()].filter((s) => s.tenantId === tenantId).map(clone);
      },
    },
    mcpConfigs: {
      async insert(c) {
        mcpConfigs.set(c.id, clone(c));
      },
      async update(c) {
        mcpConfigs.set(c.id, clone(c));
      },
      async remove(id) {
        mcpConfigs.delete(id);
      },
      async get(id) {
        return clone(mcpConfigs.get(id));
      },
      async listByTenant(tenantId) {
        return [...mcpConfigs.values()].filter((c) => c.tenantId === tenantId).map(clone);
      },
    },
    sceneEntries: {
      async upsert(s) {
        // (tenantId, viewKey) unique
        for (const [id, e] of sceneEntries) {
          if (e.tenantId === s.tenantId && e.viewKey === s.viewKey && id !== s.id) sceneEntries.delete(id);
        }
        sceneEntries.set(s.id, clone(s));
      },
      async remove(id) {
        sceneEntries.delete(id);
      },
      async get(id) {
        return clone(sceneEntries.get(id));
      },
      async byView(tenantId, viewKey) {
        return clone([...sceneEntries.values()].find((s) => s.tenantId === tenantId && s.viewKey === viewKey));
      },
      async listByTenant(tenantId) {
        return [...sceneEntries.values()].filter((s) => s.tenantId === tenantId).map(clone);
      },
    },
    scenarios: {
      async upsert(s) {
        // (tenantId, scenarioKey) unique
        for (const [id, e] of scenarios) {
          if (e.tenantId === s.tenantId && e.scenarioKey === s.scenarioKey && id !== s.id) scenarios.delete(id);
        }
        scenarios.set(s.id, clone(s));
      },
      async remove(id) {
        scenarios.delete(id);
      },
      async get(id) {
        return clone(scenarios.get(id));
      },
      async byKey(tenantId, scenarioKey) {
        return clone([...scenarios.values()].find((s) => s.tenantId === tenantId && s.scenarioKey === scenarioKey));
      },
      async listByTenant(tenantId) {
        return [...scenarios.values()].filter((s) => s.tenantId === tenantId).map(clone);
      },
    },
    ontogenesisRuns: {
      async insert(r) {
        ontogenesisRuns.set(r.runId, clone(r));
      },
      async get(tenantId, runId) {
        const r = ontogenesisRuns.get(runId);
        // R2：跨租户不可见（返回 undefined，等价 404）。
        return r && r.tenantId === tenantId ? clone(r) : undefined;
      },
      async listByScenario(tenantId, scenarioKey) {
        return [...ontogenesisRuns.values()]
          .filter((r) => r.tenantId === tenantId && r.scenarioKey === scenarioKey)
          .sort((a, b) => b.ranAt.localeCompare(a.ranAt) || b.runId.localeCompare(a.runId))
          .map(clone);
      },
      async listByTenant(tenantId) {
        return [...ontogenesisRuns.values()]
          .filter((r) => r.tenantId === tenantId)
          .sort((a, b) => b.ranAt.localeCompare(a.ranAt) || b.runId.localeCompare(a.runId))
          .map(clone);
      },
    },
    materializedIntents: {
      async upsert(i) {
        // (tenantId, key) unique
        for (const [id, e] of materializedIntents) {
          if (e.tenantId === i.tenantId && e.key === i.key && id !== i.id) materializedIntents.delete(id);
        }
        materializedIntents.set(i.id, clone(i));
      },
      async remove(id) {
        materializedIntents.delete(id);
      },
      async get(id) {
        return clone(materializedIntents.get(id));
      },
      async byKey(tenantId, key) {
        return clone([...materializedIntents.values()].find((i) => i.tenantId === tenantId && i.key === key));
      },
      async listByTenant(tenantId) {
        return [...materializedIntents.values()].filter((i) => i.tenantId === tenantId).map(clone);
      },
    },
    intentSlices: {
      async upsert(s) {
        for (const [id, e] of intentSlices) {
          if (e.tenantId === s.tenantId && e.sliceKey === s.sliceKey && id !== s.sliceKey) intentSlices.delete(id);
        }
        intentSlices.set(`${s.tenantId}::${s.sliceKey}`, clone(s));
      },
      async byKey(tenantId, sliceKey) {
        return clone(intentSlices.get(`${tenantId}::${sliceKey}`));
      },
      async listByTenant(tenantId) {
        return [...intentSlices.values()].filter((s) => s.tenantId === tenantId).map(clone);
      },
    },
    experience: {
      async upsert(c) {
        experience.set(c.id, clone(c));
      },
      async listByTenant(tenantId) {
        return [...experience.values()]
          .filter((c) => c.tenantId === tenantId)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map(clone);
      },
    },
    growthLedger: {
      async insert(e) { growthLedger.set(e.id, clone(e)); },
      async listByTenant(tenantId) { return [...growthLedger.values()].filter((e) => e.tenantId === tenantId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(clone); },
    },
    growthTickets: {
      async upsert(t) { growthTickets.set(t.id, clone(t)); },
      async listByTenant(tenantId) { return [...growthTickets.values()].filter((t) => t.tenantId === tenantId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(clone); },
    },
    growthWorklist: {
      async upsert(w) { growthWorklist.set(w.id, clone(w)); },
      async get(tenantId, id) { const w = growthWorklist.get(id); return w && w.tenantId === tenantId ? clone(w) : undefined; },
      async listByTenant(tenantId) { return [...growthWorklist.values()].filter((w) => w.tenantId === tenantId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(clone); },
    },
    domainEvents: {
      async append(e) { domainEvents.push(clone(e)); },
      async listSince(tenantId, since) {
        return domainEvents
          .filter((e) => e.tenantId === tenantId && (!since || e.createdAt >= since))
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
          .slice(-200)
          .map(clone);
      },
    },
    credentials: {
      async insert(c) {
        credentials.set(c.id, clone(c));
      },
      async get(id) {
        return clone(credentials.get(id));
      },
    },
    llmProviders: {
      async upsert(c) {
        // (tenantId, key) unique
        for (const [id, e] of llmProviders) {
          if (e.tenantId === c.tenantId && e.key === c.key && id !== c.id) llmProviders.delete(id);
        }
        llmProviders.set(c.id, clone(c));
      },
      async get(id) {
        return clone(llmProviders.get(id));
      },
      async byKey(tenantId, key) {
        return clone([...llmProviders.values()].find((c) => c.tenantId === tenantId && c.key === key));
      },
      async listByTenant(tenantId) {
        return [...llmProviders.values()].filter((c) => c.tenantId === tenantId).map(clone);
      },
    },
    llmBindings: {
      async put(tenantId, bindings) {
        llmBindings.set(tenantId, clone(bindings));
      },
      async list(tenantId) {
        return clone(llmBindings.get(tenantId) ?? []);
      },
      async get(tenantId, role) {
        return clone((llmBindings.get(tenantId) ?? []).find((b) => b.role === role));
      },
    },
    evalCases: {
      async upsert(c) {
        evalCases.set(c.id, clone(c));
      },
      async get(id) {
        return clone(evalCases.get(id));
      },
      async listByTenant(tenantId, suite) {
        return [...evalCases.values()]
          .filter((c) => c.tenantId === tenantId && (suite ? c.suite === suite : true))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map(clone);
      },
    },
    evalRuns: {
      async insert(r) {
        evalRuns.set(r.id, clone(r));
      },
      async get(id) {
        return clone(evalRuns.get(id));
      },
      async listByTenant(tenantId) {
        return [...evalRuns.values()]
          .filter((r) => r.tenantId === tenantId)
          .sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1))
          .map(clone);
      },
    },
    idempotency: {
      async putIfAbsent(key, taskId) {
        const existing = idempotency.get(key);
        if (existing && Date.now() - Date.parse(existing.createdAt) < 24 * 3600_000) {
          return existing.taskId;
        }
        idempotency.set(key, { key, taskId, createdAt: new Date().toISOString() });
        return taskId;
      },
    },
    async close() {
      /* no-op */
    },
  };
}
