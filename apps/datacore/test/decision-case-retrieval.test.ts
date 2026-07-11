import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { projectCase, retrieveSimilarCases, type DecisionArtifact } from "../src/memory/decision-case.js";
import type { DecisionCase } from "@platform/contracts";

/**
 * WO-L1.5-2 齿（§4.2 / acceptance ①②③④⑤）：
 *  ① 三维检索命中（breakdown 对得上·V2 精神）；
 *  ② R6 检索双跑字节一致命中序（V6②）；
 *  ③ R2 跨租户 404/空（V2）；
 *  ④ 回退：关 memory.cbr → 端点 404 FEATURE_NOT_FOUND（V8③）；
 *  ⑤ 案例数字随行免责（disclaimer·非业务真值）。
 */

const now = "2026-07-11T00:00:00.000Z";
function mkCase(refId: string, title: string, context: string, ctx: DecisionArtifact["ctx"], tenantId = "demo"): DecisionCase {
  const a: DecisionArtifact = {
    source: "DECISION",
    refId,
    title,
    context,
    options: [{ key: "delay", label: "延期" }],
    chosen: "delay",
    predicted: { summary: "s", metrics: { deliveryRate: 0.9 } },
    ctx,
  };
  return projectCase(a, { tenantId, now });
}

const caseCapacity = mkCase("dec_cap", "常州基地PACK02降产·订单延期", "未来30天常州基地PACK02产线降低20%产能 交付风险", {
  intentKey: "affected_orders",
  entities: ["BASE_CZ", "Line:PACK02"],
  metrics: ["deliveryRate"],
});
const caseMargin = mkCase("dec_margin", "毛利率下降归因", "财务毛利率下降 客户信用敞口分析", {
  intentKey: "margin_attribution_q",
  entities: ["SEG_A"],
  metrics: ["grossMargin"],
});

describe("WO-L1.5-2 · CBR 检索（纯函数 §4.2）", () => {
  it("① 同域近义问句 → 产能案例高位命中；三维 breakdown 有据", () => {
    const r = retrieveSimilarCases([caseCapacity, caseMargin], {
      tenantId: "demo",
      text: "常州基地PACK02产能不足哪些订单延期",
      problemClass: "affected_scope_enumeration",
      entities: ["BASE_CZ"],
      metrics: [],
      topK: 5,
      weightsVersion: "v1",
    });
    expect(r.hits[0].caseId).toBe(caseCapacity.caseId); // 产能案例居首
    expect(r.hits[0].breakdown.embed).toBeGreaterThan(0);
    expect(r.hits[0].breakdown.scenario).toBe(1); // problemClass 精确匹配
    expect(r.hits[0].breakdown.business).toBeGreaterThan(0); // BASE_CZ 命中
    expect(r.hits[0].disclaimer.length).toBeGreaterThan(0); // ⑤ 随行免责
  });

  it("① 异域问句 → 产能案例不再高位（确定性·非恒返）", () => {
    const r = retrieveSimilarCases([caseCapacity, caseMargin], {
      tenantId: "demo",
      text: "财务毛利率下降客户信用敞口",
      problemClass: "financial_attribution",
      entities: ["SEG_A"],
      metrics: [],
      topK: 5,
      weightsVersion: "v1",
    });
    expect(r.hits[0].caseId).toBe(caseMargin.caseId);
  });

  it("② R6 检索双跑字节一致命中序", () => {
    const q = { tenantId: "demo", text: "常州PACK02降产", problemClass: null, entities: ["BASE_CZ"], metrics: [], topK: 5, weightsVersion: "v1" };
    const a = retrieveSimilarCases([caseCapacity, caseMargin], q);
    const b = retrieveSimilarCases([caseCapacity, caseMargin], q);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("WO-L1.5-2 · CBR 读端点（暗发 memory.cbr 门·R2）", () => {
  it("④ 关 memory.cbr（显式 override false·证暗发闸）→ GET /a/v1/memory/cases/* 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    // demo=battery 默认全开（templateFeatures 'all on'）→ 显式 override 关 memory.cbr 证暗发回退杠杆。
    const put = await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "memory.cbr": false }, configVersion: 1 } });
    expect([200, 201, 204]).toContain(put.statusCode);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/memory/cases/similar?q=test", headers: ADMIN });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("FEATURE_NOT_FOUND");
    const one = await t.app.inject({ method: "GET", url: `/a/v1/memory/cases/${caseCapacity.caseId}`, headers: ADMIN });
    expect(one.statusCode).toBe(404); // 关时连存在性都不泄漏
  });

  it("① 开 memory.cbr（demo 默认开）→ 检索命中已插入案例 + GET /:id 命中", async () => {
    const t = await makeApp();
    await t.repos.decisionCases.put({ ...caseCapacity, id: caseCapacity.caseId }); // WO-2 直接插入·真实摄取在 WO-3
    const res = await t.app.inject({ method: "GET", url: "/a/v1/memory/cases/similar?q=" + encodeURIComponent("常州PACK02降产") + "&entities=BASE_CZ", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { hits: { caseId: string }[]; total: number };
    expect(body.hits[0].caseId).toBe(caseCapacity.caseId);
    const one = await t.app.inject({ method: "GET", url: `/a/v1/memory/cases/${caseCapacity.caseId}`, headers: ADMIN });
    expect(one.statusCode).toBe(200);
    expect((one.json() as DecisionCase).caseId).toBe(caseCapacity.caseId);
  });

  it("③ R2 租户隔离：另一租户 GET 本租户 caseId → 404（案例不泄漏）", async () => {
    const t = await makeApp();
    await t.repos.decisionCases.put({ ...caseCapacity, id: caseCapacity.caseId }); // demo 案例
    // repo 层 R2（endpoint 用 ctx.tenantId 取）：他租户取不到 demo 的 caseId。
    const cross = await t.repos.decisionCases.get("acme", caseCapacity.caseId);
    expect(cross).toBeUndefined();
    const mine = await t.repos.decisionCases.get("demo", caseCapacity.caseId);
    expect(mine?.caseId).toBe(caseCapacity.caseId);
  });
});
