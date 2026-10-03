import type { FastifyInstance } from "fastify";
import type { QueryTask } from "@platform/contracts";
import { loadConfig, type AppConfig } from "../src/config.js";
import { wireDeps, type AppDeps } from "../src/deps.js";
import type { DataCoreProviderDirectory } from "../src/llm/datacore-directory.js";
import type { LlmClient } from "../src/llm/types.js";
import { ScriptedLlmClient } from "../src/llm/mock.js";
import { MockMcpClient } from "../src/mcp/mock.js";
import { Metrics } from "../src/metrics.js";
import { createMockDataCore, type MockDataCore } from "../src/mocks/clients.js";
import { SEED_PACKAGE_ID, SEED_TENANT, seedIntentsAndPlans, seedScenarioPackage } from "../src/mocks/seed.js";
import { FeatureGate } from "../src/features/gate.js";
import type { LlmBudgetPort } from "../src/ops/llm-budget.js";
import type { RefReporter } from "../src/refs/report.js";
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
  /** LLM Provider 增量测试：替换 scripted mock（如 RoutingLlmClient + 本地 stub 端点） */
  llm?: LlmClient;
  providerDirectory?: DataCoreProviderDirectory;
  /** #89：注入真 FeatureGate（带 baseUrl + 假 fetch）以驱动真 entitlement 拉取链路；缺省 mock 模式全开。 */
  features?: FeatureGate;
  /** #92：注入配额账本端口（缺省 Noop → 既有测试字节不变）。 */
  llmBudget?: LlmBudgetPort;
  /** §2.4：注入捕获型引用上报端口（缺省按 config 派生，测试无凭证 = 不上报）。 */
  reportRefs?: RefReporter;
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
  const deps = wireDeps({
    config,
    repos,
    llm: opts?.llm ?? llm,
    dataCore,
    mcp,
    metrics,
    providerDirectory: opts?.providerDirectory,
    ...(opts?.features ? { features: opts.features } : {}),
    ...(opts?.llmBudget ? { llmBudget: opts.llmBudget } : {}),
    ...(opts?.reportRefs ? { reportRefs: opts.reportRefs } : {}),
  });
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
