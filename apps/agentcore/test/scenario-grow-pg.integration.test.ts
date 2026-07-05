import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { QueryTask } from "@platform/contracts";
import { loadConfig } from "../src/config.js";
import { wireDeps, type AppDeps } from "../src/deps.js";
import { ScriptedLlmClient } from "../src/llm/mock.js";
import { MockMcpClient } from "../src/mcp/mock.js";
import { Metrics } from "../src/metrics.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { scenarioPackageIdFor, seedScenarioPackage } from "../src/mocks/seed.js";
import { createPgRepos } from "../src/persistence/pg.js";
import type { Repos } from "../src/persistence/repos.js";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

/**
 * WO ONTO-SCEN-GROW · 真 PG live-fire（env-gated：未配 DATABASE_URL_TEST 则 skip；仿 datacore
 * execlock-pg.integration 既有约定）。守「绿测试≠能用」：内存仓储无约束/无持久语义，
 * 种子守卫 bug（§0 根因表）正是「只内存测才漏」——真 PG 部署里包已存在但意图空 → classify 候选恒空。
 *
 * 复现 + 根治验证（PRD-scenario-ontogenesis 验收 #2）：
 *   ① 在真 PG 里只落「场景包」（包存在、意图/计划全空 = 真部署烂状态）；
 *   ② POST /b/v1/scenarios/S01/grow → ensureScenarios→ensureScenarioPackageSeed per-id 幂等**自愈**意图/计划；
 *   ③ grow 末步 A10 验证 triggerQuestion 经 QOS 正序实跑 → 真答案 → maturity=GOVERNED；
 *   ④ launch S01 → Path A 确定性绑定 → 答案含真 KPI（非占位非探索兜底）；
 *   ⑤ 行级 SQL 直证：intent_definitions 已补齐、scenario_ontogenesis_runs 留痕、domain_events 有 scenario.matured。
 *
 * 跑法：
 *   DATABASE_URL_TEST=postgres://user:pw@host:5432/db npx vitest run test/scenario-grow-pg.integration.test.ts
 */
const DB = process.env.DATABASE_URL_TEST;
const TENANT = "t_growpg_livefire";
const PKG_ID = scenarioPackageIdFor(TENANT);
const ADMIN = `${TENANT}:u1:catalog_admin|planner`;
const H = { "x-debug-user": encodeURIComponent(ADMIN), "content-type": "application/json" };

describe.skipIf(!DB)("ONTO-SCEN-GROW · 真 PG live-fire（包存在意图空 → grow 自愈 → GOVERNED → 点卡出 KPI）", () => {
  let repos: Repos;
  let app: FastifyInstance;
  let deps: AppDeps;
  let pool: pg.Pool;

  const cleanup = async () => {
    // 依赖序清理（intent/plan 有 FK → 包）。
    await pool.query(`DELETE FROM scenario_ontogenesis_runs WHERE tenant_id = $1`, [TENANT]).catch(() => {});
    await pool.query(`DELETE FROM domain_events WHERE tenant_id = $1`, [TENANT]).catch(() => {});
    await pool.query(`DELETE FROM scenarios WHERE tenant_id = $1`, [TENANT]).catch(() => {});
    await pool.query(`DELETE FROM query_events WHERE task_id IN (SELECT id FROM query_tasks WHERE tenant_id = $1)`, [TENANT]).catch(() => {});
    await pool.query(`DELETE FROM tool_calls WHERE tenant_id = $1`, [TENANT]).catch(() => {});
    await pool.query(`DELETE FROM agent_runs WHERE tenant_id = $1`, [TENANT]).catch(() => {});
    await pool.query(`DELETE FROM query_tasks WHERE tenant_id = $1`, [TENANT]).catch(() => {});
    await pool.query(`DELETE FROM intent_definitions WHERE package_id = $1`, [PKG_ID]).catch(() => {});
    await pool.query(`DELETE FROM execution_plans WHERE package_id = $1`, [PKG_ID]).catch(() => {});
    await pool.query(`DELETE FROM scenario_packages WHERE tenant_id = $1`, [TENANT]).catch(() => {});
    await pool.query(`DELETE FROM growth_ledger WHERE tenant_id = $1`, [TENANT]).catch(() => {});
    await pool.query(`DELETE FROM growth_tickets WHERE tenant_id = $1`, [TENANT]).catch(() => {});
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB });
    repos = await createPgRepos(DB!); // 幂等迁移（012 scenario_ontogenesis_runs 含）
    await cleanup();
    // ① 复现真部署烂状态：包存在、意图/计划全空（原 main.ts「包存在」守卫下意图永不再种的根因态）。
    await repos.packages.insert(seedScenarioPackage(TENANT));
    const config = loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);
    deps = wireDeps({ config, repos, llm: new ScriptedLlmClient(), dataCore: createMockDataCore(), mcp: new MockMcpClient(), metrics: new Metrics() });
    app = await buildServer(deps);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close().catch(() => {});
    await cleanup().catch(() => {});
    await repos?.close().catch(() => {});
    await pool?.end().catch(() => {});
  });

  it("① 烂状态坐实：包存在（PG 行在），意图/计划为零（classify 候选恒空的根因态）", async () => {
    const pkgRow = await pool.query(`SELECT id FROM scenario_packages WHERE tenant_id = $1`, [TENANT]);
    expect(pkgRow.rowCount).toBe(1);
    expect(pkgRow.rows[0].id).toBe(PKG_ID);
    const intents = await pool.query(`SELECT count(*)::int AS n FROM intent_definitions WHERE package_id = $1`, [PKG_ID]);
    expect(intents.rows[0].n).toBe(0);
  });

  it("② grow S01 → 意图/计划 per-id 自愈（守卫根治）→ A10 真验证 → GOVERNED（真 PG 全程）", async () => {
    const res = await app.inject({ method: "POST", url: "/b/v1/scenarios/S01/grow", headers: H });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { runId: string; maturity: string; verification: { status: string; path: string; answerPreview: string | null } };
    expect(run.maturity).toBe("GOVERNED");
    expect(run.verification.status).toBe("VERIFIED");
    expect(run.verification.path).toBe("WORKFLOW"); // 确定性 Path A，非探索兜底
    expect(run.verification.answerPreview).toBeTruthy();

    // 意图自愈：包不再空（≥20 条、capacity_feasibility PUBLISHED）——SQL 行级直证（非内存假象）。
    const intents = await pool.query(`SELECT count(*)::int AS n FROM intent_definitions WHERE package_id = $1`, [PKG_ID]);
    expect(intents.rows[0].n).toBeGreaterThanOrEqual(20);
    const cf = await pool.query(`SELECT status FROM intent_definitions WHERE package_id = $1 AND key = 'capacity_feasibility'`, [PKG_ID]);
    expect(cf.rows[0]?.status).toBe("PUBLISHED");
    const plans = await pool.query(`SELECT count(*)::int AS n FROM execution_plans WHERE package_id = $1`, [PKG_ID]);
    expect(plans.rows[0].n).toBeGreaterThanOrEqual(20);

    // 发育留痕落真 PG（migration 012）。
    const runs = await pool.query(`SELECT record FROM scenario_ontogenesis_runs WHERE tenant_id = $1 AND scenario_key = 'S01'`, [TENANT]);
    expect(runs.rowCount).toBe(1);
    expect(runs.rows[0].record.maturity).toBe("GOVERNED");
    expect(runs.rows[0].record.verification.status).toBe("VERIFIED");

    // 三事件之 matured 入 outbox（domain_events 真 PG 行）。
    const evts = await pool.query(`SELECT event FROM domain_events WHERE tenant_id = $1 AND event = 'scenario.matured'`, [TENANT]);
    expect(evts.rowCount).toBeGreaterThanOrEqual(1);
  });

  it("③ launch S01（正序点卡）→ Path A 确定性绑定 → COMPLETED 答案含真 KPI（非占位非探索）", async () => {
    const res = await app.inject({ method: "POST", url: "/b/v1/scenarios/S01/launch", headers: H });
    expect(res.statusCode).toBe(202);
    const { taskId } = res.json() as { taskId: string };
    let task: QueryTask | undefined;
    for (let i = 0; i < 200; i++) {
      task = await repos.tasks.get(taskId);
      if (task && ["COMPLETED", "FAILED", "CANCELLED", "AWAITING_CLARIFICATION"].includes(task.status)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(task?.status).toBe("COMPLETED");
    expect(task?.path).toBe("WORKFLOW");
    expect(task?.classification?.model).toBe("deterministic:scenario-bind"); // §2.4 跳过 LLM classify
    const blocks = task?.answer?.blocks ?? [];
    const kpi = blocks.find((b) => b.type === "kpi") as { label?: string; value?: unknown } | undefined;
    expect(kpi).toBeDefined();
    expect(kpi!.value).not.toBeUndefined(); // 真 KPI 值（求解器投影，非静态占位）
    expect(blocks.some((b) => b.type === "text" && /未能产出回答|探索模式未能/.test(String((b as { markdown?: string }).markdown ?? "")))).toBe(false);
  });
});
