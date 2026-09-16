/**
 * WO-DERIV-DSL-PROBE · Q3 **探针测试，非门**（只量不改；收编方可直接删除本文件）。
 *
 * 推演世界的状态变量逐个过一遍，按「今天能不能写成 §2 DSL 派生属性」分档，并给出**格数**
 * （= Σ 该变量挂的对象数）—— 这才是「measuredCells 能涨到多少」的真实上限。
 *
 * 口径与 `sim/seed-world.ts deriveSeedBaseSnapshot` **逐字对齐**：
 * (type,var) 对来自传导规则 `varsByType`，对象集过 `entersSimWorld`，
 * 「真读数」判据 = `o.props[var]` 是有限数。
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { makeApp, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { entersSimWorld } from "../src/sim/seed-world.js";
import { STATE_VAR_DOMAINS } from "../src/synthetic/battery.js";

const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/probe";

describe("WO-DERIV-DSL-PROBE Q3 · 状态变量普查", () => {
  it("逐 (类型,变量) 数格 + 现状真读数 + 可用原料", async () => {
    mkdirSync(OUT, { recursive: true });
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    const ctx = t.adminCtx;

    const rules = await t.repos.sim.listPropagationRules(ctx.tenantId, true);
    // 🐤 金丝雀：规则表为空 ⇒ 是播种/取法坏了，不是「没有状态变量」
    expect(rules.length, "🐤 传导规则不该为 0").toBeGreaterThan(0);

    // varsByType（与 seed-world.ts 私有实现同构）
    const byType = new Map<string, Set<string>>();
    const add = (tk: string, sv: string) => {
      const c = byType.get(tk);
      if (c) c.add(sv); else byType.set(tk, new Set([sv]));
    };
    for (const r of rules) { add(r.sourceTypeKey, r.sourceStateVar); add(r.targetTypeKey, r.targetStateVar); }

    const allVars = [...new Set(rules.flatMap((r) => [r.sourceStateVar, r.targetStateVar]))].sort();
    const linkTypes = await t.repos.ontologyLinks.list(ctx.tenantId);
    const linkInst = await t.repos.links.list(ctx.tenantId);
    const instCount: Record<string, number> = {};
    for (const l of linkInst) instCount[l.type] = (instCount[l.type] ?? 0) + 1;

    const rows: Record<string, unknown>[] = [];
    let totalCells = 0, totalMeasured = 0;
    for (const typeKey of [...byType.keys()].sort()) {
      const vars = [...(byType.get(typeKey) ?? [])].sort();
      const objs = (await t.repos.objects.listByType(ctx.tenantId, typeKey)).filter((o) => entersSimWorld(typeKey, o));
      // 该类型上**真有值**的数值属性（从真对象数，不信 schema）
      const numHits: Record<string, number> = {};
      for (const o of objs) for (const [k, v] of Object.entries(o.props ?? {})) {
        if (typeof v === "number" && Number.isFinite(v)) numHits[k] = (numHits[k] ?? 0) + 1;
      }
      // 该类型可用的**有实例**的链（跨关系聚合的原料）
      const liveLinks = linkTypes
        .filter((lt) => (instCount[lt.key] ?? 0) > 0 && (lt.fromTypeKey === typeKey || lt.toTypeKey === typeKey))
        .map((lt) => `${lt.fromTypeKey === typeKey ? "out" : "in"}(${lt.key})->${lt.fromTypeKey === typeKey ? lt.toTypeKey : lt.fromTypeKey}×${instCount[lt.key]}`);
      for (const v of vars) {
        const measured = objs.filter((o) => typeof o.props[v] === "number" && Number.isFinite(o.props[v] as number)).length;
        totalCells += objs.length; totalMeasured += measured;
        rows.push({
          typeKey, stateVar: v, cells: objs.length, measuredNow: measured,
          domain: STATE_VAR_DOMAINS[v] ? `${STATE_VAR_DOMAINS[v]!.min}-${STATE_VAR_DOMAINS[v]!.max}` : "NO-DOMAIN",
          numericPropCount: Object.keys(numHits).length,
          numericProps: Object.keys(numHits).sort(),
          liveLinkCount: liveLinks.length,
          liveLinks,
        });
      }
    }

    const summary = {
      rulesCount: rules.length,
      distinctStateVars: allVars.length,
      distinctTypes: byType.size,
      typeVarPairs: rows.length,
      totalCells, totalMeasured,
      typesWithZeroNumericProps: [...new Set(rows.filter((r) => (r.numericPropCount as number) === 0).map((r) => r.typeKey))],
      allVars,
    };
    writeFileSync(`${OUT}/q3.json`, JSON.stringify({ summary, rows }, null, 1));
    console.log("[Q3-SUMMARY]", JSON.stringify(summary, null, 1));
    await t.app.close();
  }, 900_000);
});
