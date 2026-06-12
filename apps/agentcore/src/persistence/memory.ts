import type {
  AgentDefinition,
  AgentRunRecord,
  ExecutionPlan,
  FallbackTrace,
  IntentDefinition,
  McpServerConfig,
  QueryTask,
  ScenarioPackage,
  SceneEntryConfig,
  SkillDefinition,
  WorkflowDefinition,
} from "@platform/contracts";
import type { CredentialRow, IdempotencyRow, QueryEventRow, Repos, TaskPatch, ToolCallRow } from "./repos.js";

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
  const fallbacks = new Map<string, FallbackTrace & { normalizedQuery: string }>();
  const agents = new Map<string, AgentDefinition>();
  const workflows = new Map<string, WorkflowDefinition>();
  const skills = new Map<string, SkillDefinition>();
  const mcpConfigs = new Map<string, McpServerConfig>();
  const sceneEntries = new Map<string, SceneEntryConfig>();
  const credentials = new Map<string, CredentialRow>();
  const idempotency = new Map<string, IdempotencyRow>();

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
    credentials: {
      async insert(c) {
        credentials.set(c.id, clone(c));
      },
      async get(id) {
        return clone(credentials.get(id));
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
