import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { makeApp, seedBattery, invokeSolver, ADMIN } from "./helpers.js";
import { generateBattery, BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";

/**
 * WO-UNIT-MARGIN-96X · **取证探针**（临时·非交付门）。
 *
 * 只测量、不断言业务结论 —— 目的是拿到铁律 1.5 要求的那组对照实验读数。
 * 打印的每个数都会进报告；断言只用来保证「量法本身没坏」（金丝雀）。
 */
describe("WO-UNIT-MARGIN-96X · 取证探针", () => {
  it("① 种子层：Model.unitPrice / Model.unitCost 的真值与比值", () => {
    const g = generateBattery(42, "S");
    const rows = g.models.map((m) => ({
      modelId: String(m.modelId),
      pos: String(m.pos),
      unitPrice: Number(m.unitPrice),
      unitCost: Number(m.unitCost),
      ratio: Number(m.unitPrice) / Number(m.unitCost),
      // 注释宣称的那个减法：unitPrice − unitCost
      claimedUnitMargin: Number(m.unitPrice) - Number(m.unitCost),
      claimedMarginPct: (Number(m.unitPrice) - Number(m.unitCost)) / Number(m.unitPrice),
      // 若把成本换算到「套」阶（×packCellCount）后再减
      packAlignedMargin: Number(m.unitPrice) - Number(m.unitCost) * 96,
      packAlignedPct: (Number(m.unitPrice) - Number(m.unitCost) * 96) / Number(m.unitPrice),
    }));
    console.log("PACKCELLCOUNT =", BATTERY_SOLVER_PARAMS.packCellCount);
    console.log("MODEL_ROWS =", JSON.stringify(rows, null, 1));
    const hash = createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
    console.log("MODEL_ROWS_HASH =", hash);
    // 金丝雀：读数取法是好的（有型号、价与成本都非零）
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.unitPrice > 0)).toBe(true);
    expect(rows.every((r) => r.unitCost > 0)).toBe(true);
  });

  it("② 种子层：OrderLine 上两格的反范式化值 + 行级毛利读数", () => {
    const g = generateBattery(42, "S");
    const lines = (g.orderLines as Record<string, unknown>[]).slice(0, 5).map((l) => ({
      lineId: String(l.lineId),
      model: String(l.model),
      qty: Number(l.qty),
      unitPrice: Number(l.unitPrice),
      unitCost: Number(l.unitCost),
      revenue: Number(l.qty) * Number(l.unitPrice),
      costAsIs: Number(l.qty) * Number(l.unitCost),
      costPackAligned: Number(l.qty) * Number(l.unitCost) * 96,
    }));
    console.log("ORDERLINE_SAMPLE =", JSON.stringify(lines, null, 1));
    const all = g.orderLines as Record<string, unknown>[];
    const totRev = all.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
    const totCost = all.reduce((s, l) => s + Number(l.qty) * Number(l.unitCost), 0);
    console.log("ORDERLINE_TOTALS =", JSON.stringify({
      n: all.length,
      totRev: Math.round(totRev),
      totCostAsIs: Math.round(totCost),
      costShareAsIs: totCost / totRev,
      costSharePackAligned: (totCost * 96) / totRev,
    }));
    const hash = createHash("sha256").update(JSON.stringify(lines)).digest("hex").slice(0, 16);
    console.log("ORDERLINE_HASH =", hash);
    expect(all.length).toBeGreaterThan(0);
  });

  it("④ 引擎层：优化装配 —— unit_cost 到底绑没绑上（毛利轴是否活着）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await t.app.inject({
      method: "POST",
      url: "/a/v1/sim/optimize-pareto/assemble",
      headers: ADMIN,
      payload: {},
    });
    console.log("ASSEMBLE_STATUS =", r.statusCode);
    const j = JSON.parse(r.body) as Record<string, unknown>;
    console.log("ASSEMBLE_APPLICABLE =", j.applicable);
    const req = (j.request ?? {}) as Record<string, unknown>;
    const args = (req.args ?? {}) as Record<string, unknown>;
    const elig = (args.eligibility ?? []) as Record<string, unknown>[];
    console.log("ASSEMBLE_FAMILY =", req.family);
    console.log("ASSEMBLE_ARGS_KEYS =", Object.keys(args).join(","));
    console.log("ELIG_SAMPLE =", JSON.stringify(elig.slice(0, 5)));
    console.log("ELIG_COST_NONZERO =", elig.filter((e) => Number(e.cost) !== 0).length, "/", elig.length);
    console.log("OBJECTIVES =", JSON.stringify(req.objectives ?? args.objectives ?? j.objectives));
    console.log("UNAVAILABLE =", JSON.stringify(j.unavailableObjectives ?? (req as Record<string, unknown>).unavailableObjectives));
    // 把整包里带 margin/cost 字样的键路径找出来
    const seen: string[] = [];
    const walk = (o: unknown, path: string, depth: number) => {
      if (depth > 4 || o === null || typeof o !== "object") return;
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (/margin|cost|unit/i.test(k)) seen.push(`${path}.${k}=${JSON.stringify(v)?.slice(0, 220)}`);
        if (!Array.isArray(v)) walk(v, `${path}.${k}`, depth + 1);
        else if (v.length > 0) walk(v[0], `${path}.${k}[0]`, depth + 1);
      }
    };
    walk(j, "$", 0);
    console.log("MARGIN_COST_KEYS =\n" + seen.join("\n"));
    expect([200, 404]).toContain(r.statusCode);
  });

  it("③ 引擎层：quote_margin 真实读数（真后端 seed + 真求解器路）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "quote_margin", {}, ADMIN);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const out = (body.output ?? body) as Record<string, unknown>;
    console.log("QUOTE_MARGIN_STATUS =", res.statusCode);
    console.log("QUOTE_MARGIN_OUT =", JSON.stringify(out, null, 1));
    const hash = createHash("sha256").update(JSON.stringify(out)).digest("hex").slice(0, 16);
    console.log("QUOTE_MARGIN_HASH =", hash);
    expect(res.statusCode).toBe(200);
  });
});
