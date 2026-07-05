/**
 * WO ONTO-SCEN-CONTRACT · OntogenesisRun 仓储齿（PRD-scenario-ontogenesis §4 双仓储）。
 * ① memory 实现真跑：insert/get/list 全 tenant-scoped（R2 跨租户不可见）+ upsert 幂等 + ranAt 倒序确定性。
 * ② R9 仓储四处同改静态齿（同 check-sim.mjs 口径）：migration 012 + repos.ts 接口 + pg.ts 实现三处在位、
 *    pg 读语句 tenant_id 谓词随身（R2）。pg 连接在测试环境不可得（memory 为测试默认，CLAUDE.md 仓储双实现约定），
 *    诚实以静态齿钉 pg 面——不以 mock 冒充真 pg 落库。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createMemoryRepos } from "../src/persistence/memory.js";
import type { ScenarioOntogenesisRunRow } from "../src/persistence/repos.js";
import { createTestApp, ADMIN, debugHeaders } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));

function mkRun(over: Partial<ScenarioOntogenesisRunRow>): ScenarioOntogenesisRunRow {
  return {
    runId: "sor_a",
    tenantId: "demo",
    scenarioKey: "S01",
    ranAt: "2026-07-05T08:00:00.000Z",
    rings: { data: true, ontology: true, capability: true },
    verification: { status: "VERIFIED", path: "WORKFLOW", gapCode: null, answerPreview: "P50=132GWh", taskId: "task_1" },
    gaps: [],
    maturity: "GOVERNED",
    ...over,
  };
}

describe("ontogenesisRuns memory 仓储齿（insert/get/list · R2 tenant-scoped）", () => {
  it("insert→get 取回全形；跨租户 get 不可见（undefined）", async () => {
    const repos = createMemoryRepos();
    const run = mkRun({ gaps: [{ gapCode: "NO_SLICE", disposition: "NEEDS_HUMAN", detail: "缺切片", ticketId: "gtk_1" }] });
    await repos.ontogenesisRuns.insert(run);
    const got = await repos.ontogenesisRuns.get("demo", "sor_a");
    expect(got).toEqual(run);
    // R2：另一租户以同 runId 读 → 不可见。
    expect(await repos.ontogenesisRuns.get("t2", "sor_a")).toBeUndefined();
  });

  it("同 runId 再 insert = upsert（留痕更新不裂两行）", async () => {
    const repos = createMemoryRepos();
    await repos.ontogenesisRuns.insert(mkRun({ maturity: "PROVISIONAL" }));
    await repos.ontogenesisRuns.insert(mkRun({ maturity: "GOVERNED" }));
    expect((await repos.ontogenesisRuns.listByTenant("demo")).length).toBe(1);
    expect((await repos.ontogenesisRuns.get("demo", "sor_a"))!.maturity).toBe("GOVERNED");
  });

  it("listByScenario：只见本租户本卡，ranAt 倒序（最近发育在前）", async () => {
    const repos = createMemoryRepos();
    await repos.ontogenesisRuns.insert(mkRun({ runId: "sor_1", ranAt: "2026-07-01T00:00:00.000Z" }));
    await repos.ontogenesisRuns.insert(mkRun({ runId: "sor_2", ranAt: "2026-07-03T00:00:00.000Z" }));
    await repos.ontogenesisRuns.insert(mkRun({ runId: "sor_other_card", scenarioKey: "S02" }));
    await repos.ontogenesisRuns.insert(mkRun({ runId: "sor_other_tenant", tenantId: "t2" }));
    const list = await repos.ontogenesisRuns.listByScenario("demo", "S01");
    expect(list.map((r) => r.runId)).toEqual(["sor_2", "sor_1"]);
  });

  it("listByTenant：R2 只见本租户；倒序确定性（ranAt 同刻以 runId 决胜）", async () => {
    const repos = createMemoryRepos();
    const at = "2026-07-05T08:00:00.000Z";
    await repos.ontogenesisRuns.insert(mkRun({ runId: "sor_b", ranAt: at }));
    await repos.ontogenesisRuns.insert(mkRun({ runId: "sor_c", ranAt: at }));
    await repos.ontogenesisRuns.insert(mkRun({ runId: "sor_z", tenantId: "t2" }));
    const list = await repos.ontogenesisRuns.listByTenant("demo");
    expect(list.map((r) => r.runId)).toEqual(["sor_c", "sor_b"]);
    expect(list.every((r) => r.tenantId === "demo")).toBe(true);
  });
});

describe("grow 真跑 → 一等落库接线（§4：run 进 ontogenesisRuns + 卡挂 lastOntogenesisRunId）", () => {
  it("POST /b/v1/scenarios/S01/grow → run 落一等仓储（tenant 随身）且卡携 lastOntogenesisRunId 指向它", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { runId: string; tenantId?: string; maturity: string };
    // 一等留痕：按卡回看发育史（非仅内嵌在卡上）。
    const stored = await t.repos.ontogenesisRuns.get("demo", run.runId);
    expect(stored).toBeDefined();
    expect(stored!.tenantId).toBe("demo");
    expect(stored!.scenarioKey).toBe("S01");
    const byCard = await t.repos.ontogenesisRuns.listByScenario("demo", "S01");
    expect(byCard.map((r) => r.runId)).toContain(run.runId);
    // R2：跨租户不可见。
    expect(await t.repos.ontogenesisRuns.get("t2", run.runId)).toBeUndefined();
    // 卡挂 lastOntogenesisRunId（既有内嵌 lastOntogenesisRun additive 并存）。
    const card = await t.repos.scenarios.byKey("demo", "S01");
    expect(card?.lastOntogenesisRunId).toBe(run.runId);
    expect(card?.lastOntogenesisRun?.runId).toBe(run.runId);
  });
});

describe("ontogenesisRuns 仓储四处同改静态齿（migration + repos.ts + memory.ts + pg.ts · R9）", () => {
  it("migration 012：表 + tenant_id NOT NULL + (tenant_id, scenario_key) 索引在位", () => {
    const sql = readFileSync(join(here, "..", "migrations", "012_scenario_ontogenesis_runs.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS scenario_ontogenesis_runs/);
    expect(sql).toMatch(/tenant_id\s+TEXT NOT NULL/);
    expect(sql).toMatch(/scenario_key\s+TEXT NOT NULL/);
    expect(sql).toMatch(/ON scenario_ontogenesis_runs \(tenant_id, scenario_key/);
  });

  it("pg.ts：实现在位且读语句 tenant_id 谓词随身（R2）", () => {
    const pg = readFileSync(join(here, "..", "src", "persistence", "pg.ts"), "utf8");
    expect(pg).toMatch(/ontogenesisRuns:\s*\{/);
    expect(pg).toMatch(/INSERT INTO scenario_ontogenesis_runs\(run_id, tenant_id, scenario_key, ran_at, record\)/);
    expect(pg).toMatch(/FROM scenario_ontogenesis_runs WHERE run_id = \$1 AND tenant_id = \$2/);
    expect(pg).toMatch(/FROM scenario_ontogenesis_runs WHERE tenant_id = \$1 AND scenario_key = \$2 ORDER BY ran_at DESC/);
  });

  it("repos.ts：接口声明四方法（insert/get/listByScenario/listByTenant）", () => {
    const iface = readFileSync(join(here, "..", "src", "persistence", "repos.ts"), "utf8");
    expect(iface).toMatch(/ontogenesisRuns:\s*\{/);
    for (const m of ["insert(r: ScenarioOntogenesisRunRow)", "get(tenantId: string, runId: string)", "listByScenario(tenantId: string, scenarioKey: string)", "listByTenant(tenantId: string)"]) {
      expect(iface).toContain(m);
    }
  });
});
