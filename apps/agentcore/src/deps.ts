import type { AppConfig } from "./config.js";
import { ExecutionEngine } from "./engine.js";
import { TaskEvents } from "./events.js";
import type { LlmClient } from "./llm/types.js";
import type { McpClientPort } from "./mcp/types.js";
import { Metrics } from "./metrics.js";
import type { Repos } from "./persistence/repos.js";
import { Orchestrator } from "./router/orchestrator.js";
import { CatalogService } from "./catalog/service.js";
import type { DataCoreClient } from "./tools/clients.js";

export interface AppDeps {
  config: AppConfig;
  repos: Repos;
  metrics: Metrics;
  llm: LlmClient;
  dataCore: DataCoreClient;
  mcp?: McpClientPort;
  engine: ExecutionEngine;
  events: TaskEvents;
  orchestrator: Orchestrator;
  catalog: CatalogService;
}

export function wireDeps(base: {
  config: AppConfig;
  repos: Repos;
  llm: LlmClient;
  dataCore: DataCoreClient;
  mcp?: McpClientPort;
  metrics?: Metrics;
}): AppDeps {
  const metrics = base.metrics ?? new Metrics();
  const events = new TaskEvents(base.repos);
  const engine = new ExecutionEngine({
    repos: base.repos,
    metrics,
    llm: base.llm,
    dataCore: base.dataCore,
    mcp: base.mcp,
    config: base.config,
  });
  const orchestrator = new Orchestrator({ repos: base.repos, metrics, config: base.config, engine, events });
  const catalog = new CatalogService(base.repos);
  return {
    config: base.config,
    repos: base.repos,
    metrics,
    llm: base.llm,
    dataCore: base.dataCore,
    mcp: base.mcp,
    engine,
    events,
    orchestrator,
    catalog,
  };
}
