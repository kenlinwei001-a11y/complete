import type { FastifyInstance } from "fastify";
import type { QueryTask } from "@platform/contracts";
import { loadConfig, type AppConfig } from "../src/config.js";
import { wireDeps, type AppDeps } from "../src/deps.js";
import { ScriptedLlmClient } from "../src/llm/mock.js";
import { MockMcpClient } from "../src/mcp/mock.js";
import { Metrics } from "../src/metrics.js";
import { createMockDataCore, type MockDataCore } from "../src/mocks/clients.js";
import { SEED_PACKAGE_ID, SEED_TENANT, seedIntentsAndPlans, seedScenarioPackage } from "../src/mocks/seed.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import type { Repos } from "../src/persistence/repos.js";
import { buildServer } from "../src/server.js";

export const PKG = SEED_PACKAGE_ID;
export const TENANT = SEED_TENANT;
export const PLANNER = `${TENANT}:user-planner:planner`;
export const ADMIN = `${TENANT}:user-admin:catalog_admin|planner`;
export const CZ_MANAGER = `${TENANT}:user-cz:base_manager:常州`;

export interface TestApp {
  app: FastifyInstance;
  deps: AppDeps;
  llm: ScriptedLlmClient;
  dataCore: MockDataCore;
  mcp: MockMcpClient;
  repos: Repos;
  metrics: Metrics;
  config: AppConfig;
}

export async function createTestApp(opts?: {
  /** 额外环境变量（如增量 §4.3 的 MCP_STDIO_ENABLED / MCP_STDIO_COMMAND_ALLOWLIST） */
  env?: Record<string, string>;
  /** 自定义 MCP mock（如 R8 重名工具的双 server 形态） */
  mcp?: MockMcpClient;
}): Promise<TestApp> {
  const config = loadConfig({ PORT: "0", LOG_LEVEL: "silent", ...(opts?.env ?? {}) } as NodeJS.ProcessEnv);
  const repos = createMemoryRepos();
  await repos.packages.insert(seedScenarioPackage());
  const { intents, plans } = seedIntentsAndPlans();
  for (const p of plans) await repos.plans.insert(p);
  for (const i of intents) await repos.intents.insert(i);

  const llm = new ScriptedLlmClient();
  const dataCore = createMockDataCore();
  const mcp = opts?.mcp ?? new MockMcpClient();
  const metrics = new Metrics();
  const deps = wireDeps({ config, repos, llm, dataCore, mcp, metrics });
  const app = await buildServer(deps);
  await app.ready();
  return { app, deps, llm, dataCore, mcp, repos, metrics, config };
}

export function baseContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { view: "risk", selectedObjects: [], filters: {}, ...overrides };
}

export async function submitQuery(
  t: TestApp,
  user: string,
  query: string,
  context: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<{ taskId: string; statusCode: number; body: Record<string, unknown> }> {
  const res = await t.app.inject({
    method: "POST",
    url: "/api/v1/queries",
    headers: { "x-debug-user": encodeURIComponent(user), "content-type": "application/json", ...headers },
    payload: { packageId: PKG, query, context: baseContext(context) },
  });
  const body = res.json() as Record<string, unknown>;
  return { taskId: body.taskId as string, statusCode: res.statusCode, body };
}

export async function waitForTask(
  t: TestApp,
  taskId: string,
  predicate: (task: QueryTask) => boolean = (task) =>
    ["COMPLETED", "FAILED", "CANCELLED", "AWAITING_CLARIFICATION"].includes(task.status),
  timeoutMs = 8000,
): Promise<QueryTask> {
  const start = Date.now();
  for (;;) {
    const task = await t.repos.tasks.get(taskId);
    if (task && predicate(task)) return task;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForTask timeout: ${taskId} status=${task?.status}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function debugHeaders(user: string): Record<string, string> {
  return { "x-debug-user": encodeURIComponent(user), "content-type": "application/json" };
}

/** Extract the last tool_call_id mentioned in any message of the request. */
export function lastToolCallId(req: { messages: { content: unknown }[] }): string {
  const text = JSON.stringify(req.messages);
  const matches = [...text.matchAll(/tool_call_id=\\"(tc_[A-Z0-9]+)\\"/g)];
  if (matches.length === 0) throw new Error("no tool_call_id found in messages");
  return (matches[matches.length - 1] as RegExpMatchArray)[1] as string;
}
