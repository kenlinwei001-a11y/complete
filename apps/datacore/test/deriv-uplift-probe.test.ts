/**
 * WO-DERIV-DSL-PROBE · 上限验证 **探针测试，非门**（只量不改；收编方可直接删除本文件）。
 *
 * 问题：把状态变量做成派生属性，`measuredCells` 真的会从 450 涨吗？
 * 判据（与 `seed-world.ts deriveSeedBaseSnapshot` 同一份实现，不另抄一套）：
 * 先量基线 → 编译 + recompute 三条试点规格 → 再量。涨幅必须**恰好等于**试点变量的格数。
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { makeApp, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { deriveSeedBaseSnapshot } from "../src/sim/seed-world.js";

const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/probe";

describe("WO-DERIV-DSL-PROBE · measuredCells 上限验证", () => {
  it("试点三条 ⇒ measuredCells 按格数精确上涨", async () => {
    mkdirSync(OUT, { recursive: true });
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    const ctx = t.adminCtx;
    const ov = await t.services.ontology.currentVersion(ctx.tenantId);

    // ── 基线 ────────────────────────────────────────────────────────────────
    const before = await deriveSeedBaseSnapshot(t.repos, ctx.tenantId);
    // 🐤 金丝雀：基线必须复现活服务上的 6363/450；对不上 ⇒ 量法坏了，不许继续下结论
    expect(before.origin.cells, "🐤 cells 应为 6363").toBe(6363);
    expect(before.origin.measuredCells, "🐤 measuredCells 应为 450").toBe(450);

    // ── 试点三条（全部是 Q2 已人工核算过的式子） ───────────────────────────
    const PILOTS = [
      { specKey: "pilot_line_util_pressure", targetType: "Line", targetProp: "utilPressure", formula: "CLAMP(this.actual_output_daily * 100 / this.max_capacity_day, 0, 100)" },
      { specKey: "pilot_line_blocked_pressure", targetType: "Line", targetProp: "blockedPressure", formula: "COALESCE(SUM(out(line_runs_work_order).qtyPlanned, WHERE status == '生产中'), 0)" },
      { specKey: "pilot_cust_recv_pressure", targetType: "Customer", targetProp: "receivablePressure", formula: "COALESCE(this.receivables * 100 / this.creditLimit, 0)" },
    ];
    await t.services.ontologyCore.compileSpecs(ctx, ov, PILOTS);

    const lineIds = (await t.repos.objects.listByType(ctx.tenantId, "Line")).map((o) => o.id);
    const custIds = (await t.repos.objects.listByType(ctx.tenantId, "Customer")).map((o) => o.id);
    const woIds = (await t.repos.objects.listByType(ctx.tenantId, "WorkOrder")).map((o) => o.id);
    await t.services.ontologyCore.recompute(ctx, [
      { typeKey: "Line", prop: "actual_output_daily", objectIds: lineIds },
      { typeKey: "Customer", prop: "receivables", objectIds: custIds },
      { typeKey: "WorkOrder", prop: "qtyPlanned", objectIds: woIds },
    ]);

    // ── 再量 ────────────────────────────────────────────────────────────────
    const after = await deriveSeedBaseSnapshot(t.repos, ctx.tenantId);
    const delta = after.origin.measuredCells - before.origin.measuredCells;

    // 试点覆盖的格数：Line×2 + Customer×1
    const lineCells = (await t.repos.objects.listByType(ctx.tenantId, "Line")).length;
    const custCells = (await t.repos.objects.listByType(ctx.tenantId, "Customer")).length;
    const expected = lineCells * 2 + custCells;

    const R = {
      before: { cells: before.origin.cells, measuredCells: before.origin.measuredCells },
      after: { cells: after.origin.cells, measuredCells: after.origin.measuredCells },
      delta, expected,
      breakdown: { lineCells, custCells, formula: `${lineCells}×2 + ${custCells} = ${expected}` },
      pilots: PILOTS.map((p) => `${p.targetType}.${p.targetProp}`),
    };
    writeFileSync(`${OUT}/uplift.json`, JSON.stringify(R, null, 1));
    console.log("[UPLIFT]", JSON.stringify(R, null, 1));

    expect(after.origin.cells, "总格数不该变（变量集没变）").toBe(before.origin.cells);
    expect(delta, "measuredCells 涨幅应精确等于试点变量的格数").toBe(expected);
    await t.app.close();
  }, 900_000);
});
