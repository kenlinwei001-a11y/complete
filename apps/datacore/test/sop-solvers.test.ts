import { describe, expect, it } from "vitest";
import { invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { generateBattery } from "../src/synthetic/battery.js";

/**
 * wave③ sop 后端（mrp_netting 物料线 / finance_pnl 量价本利）+ cockpit P5 / sop 版本演进 SopVersionRow。
 * 数据走管线、确定性 R6，前端零写死（HTML SOP_* 精确值=合成种子）。
 */
describe("sop 后端求解器 + 版本演进（L1 + L6）", () => {
  it("L6：generateBattery 同 seed sopVersionRows 字节一致 + V7 待定稿 + gap 派生口径", () => {
    const a = generateBattery(42, "S");
    const b = generateBattery(42, "S");
    expect(JSON.stringify(a.sopVersionRows)).toBe(JSON.stringify(b.sopVersionRows));
    expect(a.sopVersionRows.length).toBe(4); // V1/V3/V5/V7
    expect(a.sopVersionRows.find((r) => r.ver === "V7")!.isFinal).toBe(true);
  });

  it("L1：mrp_netting 读 MaterialBalance → 物料净需求表（缺口降序 + 缺口数）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "mrp_netting", {})).json() as { data: { materials: { material: string; netDemand: number; ltaCoverPct: number; gap: number }[]; shortageCount: number } }).data;
    expect(out.materials.length).toBe(9); // MAT 扩至 9 项关键物料
    expect(out.materials[0]!.netDemand).toBeGreaterThan(0);
    // 缺口降序
    for (let i = 1; i < out.materials.length; i++) expect(out.materials[i - 1]!.gap).toBeGreaterThanOrEqual(out.materials[i]!.gap);
    expect(out.shortageCount).toBeGreaterThanOrEqual(0);
  });

  it("L1：finance_pnl 读 FinancePlan → 量价本利科目表 + 毛利率行 + 归因", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "finance_pnl", {})).json() as { data: { pnl: { subject: string; budget: number; rolling: number; diff: number }[]; gmRow: { rollPct: number; diffPp: number }; attribution: string } }).data;
    expect(out.pnl.map((p) => p.subject)).toEqual(["收入", "销售成本", "毛利"]);
    // diff = rolling − budget（派生一致）
    for (const p of out.pnl) expect(p.diff).toBeCloseTo(p.rolling - p.budget, 1);
    expect(out.gmRow.rollPct).toBeGreaterThan(0);
    expect(out.attribution).toContain("储能占比");
  });

  it("L1：SopVersionRow 物化 + gap 派生回写（demand−supply）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const rows = (await (await t.app.inject({ method: "POST", url: "/a/v1/objects/query", headers: { "x-debug-user": "demo:usr_demo_admin:admin" }, payload: { objectType: "SopVersionRow", filter: {}, limit: 10 } })).json()) as { rows?: { props: Record<string, number> }[]; data?: { props: Record<string, number> }[] };
    const list = (rows.rows ?? rows.data ?? []);
    expect(list.length).toBe(4);
    const r0 = list[0]!.props;
    expect(r0.gap).toBeCloseTo((r0.demand as number) - (r0.supply as number), 1);
  });
});
