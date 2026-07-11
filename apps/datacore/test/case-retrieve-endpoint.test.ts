import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { projectCase, type DecisionArtifact } from "../src/memory/decision-case.js";
import type { DecisionCase } from "@platform/contracts";

/**
 * WO-L1.5-3 齿（审核方拆缝·CBR retrieve 端点·datacore 侧·POST /a/v1/memory/cases/retrieve-similar）：
 *  ① 开 memory.cbr_retrieve（demo battery 默认开）→ POST 检索命中已插入案例（三维 breakdown）;
 *  ② 关 memory.cbr_retrieve（显式 override false·证暗发翻闸）→ 404 FEATURE_NOT_FOUND（agent 回落）;
 *  ③ 独立于 memory.cbr：关 retrieve 不影响 memory.cbr 查看端点（GET /:id 仍可达）。
 * agent 薄适配器（调本端点）属 Dev-1 WO-L1.5-3B（agentcore·本 WO 不碰）。
 */
const caseCz: DecisionCase = projectCase(
  {
    source: "DECISION",
    refId: "dec_cz",
    title: "常州PACK02降产·订单延期",
    context: "未来30天常州基地PACK02产线降低20%产能 交付风险",
    options: [{ key: "delay", label: "延期" }],
    chosen: "delay",
    predicted: { summary: "延期5天", metrics: { deliveryRate: 0.9 } },
    ctx: { intentKey: "affected_orders", entities: ["BASE_CZ"] },
  } as DecisionArtifact,
  { tenantId: "demo", now: "2026-07-11T00:00:00.000Z" },
);

describe("WO-L1.5-3 · CBR retrieve 端点（POST retrieve-similar·暗发 memory.cbr_retrieve）", () => {
  it("① 开 → POST 检索命中（三维 breakdown）", async () => {
    const t = await makeApp();
    await t.repos.decisionCases.put({ ...caseCz, id: caseCz.caseId });
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/memory/cases/retrieve-similar",
      headers: ADMIN,
      payload: { query: "常州PACK02产能不足哪些订单延期", problemClass: "affected_scope_enumeration", entities: ["BASE_CZ"], topK: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { hits: { caseId: string; breakdown: { embed: number } }[]; disclaimer: string };
    expect(body.hits[0].caseId).toBe(caseCz.caseId);
    expect(body.hits[0].breakdown.embed).toBeGreaterThan(0);
    expect(body.disclaimer.length).toBeGreaterThan(0);
  });

  it("② 关 memory.cbr_retrieve（override false）→ POST 404 FEATURE_NOT_FOUND（暗发翻闸）", async () => {
    const t = await makeApp();
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "memory.cbr_retrieve": false }, configVersion: 1 } });
    const res = await t.app.inject({ method: "POST", url: "/a/v1/memory/cases/retrieve-similar", headers: ADMIN, payload: { query: "x" } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("FEATURE_NOT_FOUND");
  });

  it("③ 独立于 memory.cbr：关 retrieve 不影响案例查看端点（GET /:id 仍达）", async () => {
    const t = await makeApp();
    await t.repos.decisionCases.put({ ...caseCz, id: caseCz.caseId });
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "memory.cbr_retrieve": false }, configVersion: 1 } });
    // retrieve 关 → 404；但 memory.cbr（查看）仍开 → GET /:id 200。
    const retrieve = await t.app.inject({ method: "POST", url: "/a/v1/memory/cases/retrieve-similar", headers: ADMIN, payload: { query: "x" } });
    expect(retrieve.statusCode).toBe(404);
    const view = await t.app.inject({ method: "GET", url: `/a/v1/memory/cases/${caseCz.caseId}`, headers: ADMIN });
    expect(view.statusCode).toBe(200);
  });
});
