import { describe, expect, it } from "vitest";
import { invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * cockpit P4 / order 视图 · 订单全链推演（order_fullchain）：逐单三关联判（交期/齐套/财务三闸）
 * + 统一结论（可接/提价X%接/不建议接）+ 业务建模链 DAG，读对象图，确定性 R6。
 */
describe("cockpit P4 / order · 订单全链推演（L1 + L6）", () => {
  it("L1：首单三判 + 统一结论 + 9 节点业务建模链 DAG", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "order_fullchain", {});
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { so: string; verdict: string; vc: string; judges: { cap: { verdict: string; ruleRefs: string[] }; kit: { verdict: string }; fin: { marginOk: boolean; creditOk: boolean; ruleRefs: string[] } }; dag: { nodes: { id: string; kind: string }[]; edges: { from: string; to: string }[] }; conds: string[] } }).data;
    expect(out.so).toBeTruthy();
    // 三判齐全
    expect(out.judges.cap.ruleRefs).toContain("C02");
    expect(out.judges.fin.ruleRefs).toContain("C15"); // 毛利线
    expect(out.judges.fin.ruleRefs).toContain("C13"); // 信用
    expect(out.judges.fin.ruleRefs).toContain("C18"); // 现金
    // 统一结论三色之一
    expect(["可接", "不建议接"]).toContain(out.verdict.replace(/提价\d+%接/, "可接").includes("接") ? (out.verdict.includes("提价") ? "可接" : out.verdict) : out.verdict);
    // DAG：order 根 + 三判节点 + 结论节点 + 边
    expect(out.dag.nodes.some((n) => n.kind === "order")).toBe(true);
    expect(out.dag.nodes.filter((n) => n.kind === "judge").length).toBe(3);
    expect(out.dag.nodes.some((n) => n.kind === "verdict")).toBe(true);
    expect(out.dag.edges.length).toBeGreaterThanOrEqual(9);
    // 三判 → 结论 收敛
    expect(out.dag.edges.filter((e) => e.to === "vrd").length).toBe(3);
  });

  it("L1：指定 so 推演该单", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const all = (await (await t.app.inject({ method: "POST", url: "/a/v1/objects/query", headers: { "x-debug-user": "demo:usr_demo_admin:admin" }, payload: { objectType: "Order", filter: {}, limit: 1 } })).json()) as { rows?: { props: { so: string } }[]; data?: { props: { so: string } }[] };
    const so = (all.rows ?? all.data ?? [])[0]!.props.so;
    const res = await invokeSolver(t, "order_fullchain", { so });
    expect((res.json() as { data: { so: string } }).data.so).toBe(so);
  });

  it("L6：同 so 字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = (await invokeSolver(t, "order_fullchain", { so: "SO-3391" })).json();
    const b = (await invokeSolver(t, "order_fullchain", { so: "SO-3391" })).json();
    expect(JSON.stringify((a as { data: unknown }).data)).toBe(JSON.stringify((b as { data: unknown }).data));
  });
});
