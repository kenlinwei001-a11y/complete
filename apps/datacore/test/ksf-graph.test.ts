import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";

/**
 * audit.3 / generate · ksf_graph：3 层有向图投影（待解决问题=越线 Metric → 关键成功要素 KSF 5 → 财务计划指标 Metric）。
 * 读 Metric(ksfRef)+KSF 一等对象（spine），问题→KSF 威胁边、KSF→财务 支撑边，确定性 R6，audit/generate 共用。
 */
describe("ksf_graph · 财务 KSF 图投影", () => {
  it("3 层节点 + 威胁/支撑边；KSF 5 要素；问题挂 ksfRef；同 seed 字节一致（R6）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const out = (await invokeSolver(t, "ksf_graph", {})).json() as {
      data: {
        problems: { id: string; name: string; severity: string; ksfRef: string }[];
        ksfNodes: { id: string; key: string; name: string }[];
        finNodes: { id: string; status: string }[];
        edges: { from: string; to: string; kind: "threat" | "support" }[];
        summary: string;
      };
    };
    const g = out.data;
    // KSF 五要素（spine）
    expect(g.ksfNodes.length).toBe(5);
    expect(g.ksfNodes.map((k) => k.key).sort()).toEqual(["k_bal", "k_cash", "k_cost", "k_dem", "k_kit"]);
    // 财务指标层非空、问题层非空（全达标则取最弱保图非空）
    expect(g.finNodes.length).toBeGreaterThan(0);
    expect(g.problems.length).toBeGreaterThan(0);
    // 威胁边（问题→KSF）+ 支撑边（KSF→财务）齐备
    expect(g.edges.some((e) => e.kind === "threat" && e.from.startsWith("prob:") && e.to.startsWith("ksf:"))).toBe(true);
    expect(g.edges.some((e) => e.kind === "support" && e.from.startsWith("ksf:") && e.to.startsWith("fin:"))).toBe(true);
    expect(g.summary).toContain("关键成功要素");

    // R6：重跑字节一致
    const out2 = (await invokeSolver(t, "ksf_graph", {})).json() as { data: unknown };
    expect(JSON.stringify(out2.data)).toBe(JSON.stringify(g));
  });
});
