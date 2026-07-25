import { describe, it, expect, beforeEach } from "vitest";
import {
  findInvalidResources,
  computeQualityScore,
  ewmaUpdate,
  type IntelligenceResource,
} from "@platform/contracts";
import { createTestApp, debugHeaders, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { seedRegistry, seedMcpConfigs } from "../src/mocks/seed.js";
import {
  projectRules,
  projectSolvers,
  projectWorkflows,
} from "../src/dril/resource-projector.js";

/**
 * WO-DRIL-P1 · Resource Registry 地基 SEAM 门。
 * 头号判据：一次 GET /b/v1/resources 跨 7+ 类返回·新 4 kind(rule/workflow/skill/agent)各带非空 description·
 * 无空描述资源（接缝驱动：契约投影 × 三表持久 × 端点·任一半漏即红）。
 */

async function seedFullRegistry(t: TestApp): Promise<void> {
  const { agents, workflows, skills } = seedRegistry();
  for (const w of workflows) await t.repos.workflows.insert(w);
  for (const s of skills) await t.repos.skills.insert(s);
  for (const a of agents) await t.repos.agents.insert(a);
  for (const m of seedMcpConfigs()) await t.repos.mcpConfigs.insert(m);
}

async function listResources(t: TestApp, user: string, query = ""): Promise<IntelligenceResource[]> {
  const res = await t.app.inject({
    method: "GET",
    url: `/b/v1/resources${query}`,
    headers: debugHeaders(user),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: IntelligenceResource[] }).items;
}

describe("WO-DRIL-P1 · Resource Registry 一次发现全量资源", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    await seedFullRegistry(t);
  });

  it("GET /b/v1/resources 跨 7+ 类返回，无空描述资源（SEAM）", async () => {
    const items = await listResources(t, ADMIN);
    const kinds = new Set(items.map((r) => r.kind));
    // 7+ 类：solver / slice / rule / workflow / intent / skill / agent（+ mcp_tool）。
    expect(kinds.size).toBeGreaterThanOrEqual(7);
    for (const k of ["solver", "slice", "rule", "workflow", "intent", "skill", "agent"]) {
      expect(kinds.has(k as IntelligenceResource["kind"])).toBe(true);
    }
    // 无空描述资源（发布纪律有牙）。
    for (const r of items) {
      expect(typeof r.description).toBe("string");
      expect(r.description.trim().length).toBeGreaterThan(0);
    }
    // 每条投影都是合法 IntelligenceResource（per-kind schema）。
    expect(findInvalidResources(items)).toEqual([]);
  });

  it("新 4 kind（rule/workflow/skill/agent）各至少一条带非空 description（漏则红）", async () => {
    const items = await listResources(t, ADMIN);
    for (const k of ["rule", "workflow", "skill", "agent"]) {
      const ofKind = items.filter((r) => r.kind === k);
      expect(ofKind.length, `kind=${k} 应有投影资源`).toBeGreaterThan(0);
      for (const r of ofKind) expect(r.description.trim().length, `${k}/${r.key} 描述非空`).toBeGreaterThan(0);
    }
  });

  it("kind 过滤 + 单资源详情端点", async () => {
    const agents = await listResources(t, ADMIN, "?kind=agent");
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.every((r) => r.kind === "agent")).toBe(true);

    const first = agents[0]!;
    const res = await t.app.inject({
      method: "GET",
      url: `/b/v1/resources/agent/${encodeURIComponent(first.key)}`,
      headers: debugHeaders(ADMIN),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as IntelligenceResource).key).toBe(first.key);

    const miss = await t.app.inject({
      method: "GET",
      url: `/b/v1/resources/agent/__nope__`,
      headers: debugHeaders(ADMIN),
    });
    expect(miss.statusCode).toBe(404);
    expect((miss.json() as { error: { code: string } }).error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("R3 entitlement 先于 authz：关 view.project-sim → capacity_forecast solver 不出现", async () => {
    // 默认全开时 solver 在册。
    const before = await listResources(t, ADMIN, "?kind=solver");
    expect(before.some((r) => r.key === "capacity_forecast")).toBe(true);
    // 关掉 project-sim（capacity_forecast 绑定它）→ 该 solver 从注册表消失。
    t.deps.features.mock.disable(TENANT, "view.project-sim");
    const after = await listResources(t, ADMIN, "?kind=solver");
    expect(after.some((r) => r.key === "capacity_forecast")).toBe(false);
  });

  it("R2 租户隔离：他租户看不到本租户本地资源（agent/workflow/skill）", async () => {
    const other = "othertenant:user-x:planner";
    const items = await listResources(t, other);
    expect(items.some((r) => r.kind === "agent")).toBe(false);
    expect(items.some((r) => r.kind === "workflow")).toBe(false);
    expect(items.some((r) => r.kind === "skill")).toBe(false);
  });

  it("R13 派生投影落三表：intelligence_resources + resource_relations 有行", async () => {
    await listResources(t, ADMIN); // 触发投影
    const rows = await t.repos.intelligenceResources.listByTenant(TENANT);
    expect(rows.length).toBeGreaterThanOrEqual(7);
    // 每行带 source（datacore/agentcore/mcp），R13 记来源模块。
    expect(rows.every((r) => ["datacore", "agentcore", "mcp"].includes(r.source))).toBe(true);
    const rels = await t.repos.resourceRelations.listByTenant(TENANT);
    // seedRegistry 的 capacity_check 工作流 invoke capacity_forecast solver → workflow→solver invokes 边。
    expect(rels.some((r) => r.fromKind === "workflow" && r.toKind === "solver" && r.relType === "invokes")).toBe(true);
  });
});

describe("WO-DRIL-P1 · 投影纯函数 + 质量分公式（R6 确定性）", () => {
  it("projectSolvers/projectRules/projectWorkflows 均产非空 description，且合法", () => {
    const solvers = projectSolvers([
      { key: "s1", name: "求解器一", description: "描述一", domain: "plan" },
      { key: "s2", name: "求解器二", description: "" }, // 空描述 → 回落 name
    ]);
    const rules = projectRules([
      { key: "C03", name: "产能上限", description: "需求超上限", severity: "BLOCK", scopeObjectTypes: ["Order"] },
      { key: "C99" }, // 仅 key → 合成 description
    ]);
    const workflows = projectWorkflows([
      {
        id: "wf1", tenantId: "t", key: "wf_a", version: 1, name: "流程 A", description: undefined,
        inputs: { type: "object", properties: {} }, status: "PUBLISHED",
        steps: [{ id: "s1", type: "invoke_solver", params: { solverKey: "s1" } }] as never,
      },
    ]);
    const all = [...solvers, ...rules, ...workflows];
    for (const r of all) expect(r.description.trim().length).toBeGreaterThan(0);
    expect(findInvalidResources(all)).toEqual([]);
  });

  it("computeQualityScore/ewmaUpdate 确定性同输入同输出", () => {
    const q = { successRate: 0.9, accuracy: 0.8, avgLatencyMs: 1000, usageCount: 100, approval: "APPROVED" as const };
    expect(computeQualityScore(q)).toBe(computeQualityScore(q));
    const next = ewmaUpdate({ successRate: 1, usageCount: 5, avgLatencyMs: 2000 }, { success: false, latencyMs: 4000 });
    expect(next.usageCount).toBe(6);
    expect(next.successRate).toBeCloseTo(0.9, 6);
    expect(next.avgLatencyMs).toBeCloseTo(2200, 6);
  });
});
