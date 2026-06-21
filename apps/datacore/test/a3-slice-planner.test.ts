import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { planSlice, type PlannerType, type PlannerLink } from "../src/ontology/slice-planner.js";
import type { PlanSliceResponse, SlicePlan } from "@platform/contracts";

const TYPES: PlannerType[] = [
  { key: "Order", domain: "sales" },
  { key: "Model", domain: "product" },
  { key: "Base", domain: "factory" },
  { key: "Process", domain: "process" },
  { key: "Lonely", domain: "external" },
];
const LINKS: PlannerLink[] = [
  { linkKey: "has_model", fromTypeKey: "Order", toTypeKey: "Model" },
  { linkKey: "made_at", fromTypeKey: "Model", toTypeKey: "Base" },
  { linkKey: "runs", fromTypeKey: "Base", toTypeKey: "Process" },
];

const plan = (r: PlanSliceResponse): SlicePlan => { if (!r.ok) throw new Error("expected plan"); return r.plan; };

describe("A3.3 · 多跳切片规划器（确定性图路径搜索）", () => {
  it("链式最短路 Order→Model→Base→Process（hops + 证据 + 跨域集）", () => {
    const r = planSlice(TYPES, LINKS, { rootType: "Order", targets: ["Process"], maxHops: 6 });
    const p = plan(r);
    expect(p.paths[0]!.hops).toEqual([
      { linkKey: "has_model", direction: "out", toType: "Model" },
      { linkKey: "made_at", direction: "out", toType: "Base" },
      { linkKey: "runs", direction: "out", toType: "Process" },
    ]);
    expect(p.pathEvidence[0]).toBe("Order -[has_model:out]-> Model -[made_at:out]-> Base -[runs:out]-> Process");
    expect(p.spannedDomains).toEqual(["factory", "process", "product", "sales"]); // 排序去重（字典序）
    expect(p.sliceKey).toBe("biz.plan.order__process");
  });

  it("多目标：各 target 一条最短路（目标排序确定）", () => {
    const p = plan(planSlice(TYPES, LINKS, { rootType: "Order", targets: ["Process", "Base"], maxHops: 6 }));
    expect(p.paths.map((x) => x.target)).toEqual(["Base", "Process"]); // sorted
    expect(p.paths.find((x) => x.target === "Base")!.hops).toHaveLength(2);
  });

  it("反向可达：从 Process 经 in 边回到 Order（无向图）", () => {
    const p = plan(planSlice(TYPES, LINKS, { rootType: "Process", targets: ["Order"], maxHops: 6 }));
    expect(p.paths[0]!.hops.map((h) => h.direction)).toEqual(["in", "in", "in"]);
    expect(p.paths[0]!.hops.at(-1)!.toType).toBe("Order");
  });

  it("不可达 → NO_PATH（列 unreachable）", () => {
    const r = planSlice(TYPES, LINKS, { rootType: "Order", targets: ["Lonely", "Process"], maxHops: 6 });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason.code).toBe("NO_PATH"); expect(r.reason.unreachable).toEqual(["Lonely"]); }
  });

  it("maxHops 限制：超跳即不可达", () => {
    const r = planSlice(TYPES, LINKS, { rootType: "Order", targets: ["Process"], maxHops: 2 }); // 需 3 跳
    expect(r.ok).toBe(false);
  });

  it("R6 确定性：同图同请求字节一致", () => {
    const a = planSlice(TYPES, LINKS, { rootType: "Order", targets: ["Process", "Base"], maxHops: 6 });
    const b = planSlice(TYPES, LINKS, { rootType: "Order", targets: ["Base", "Process"], maxHops: 6 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // 目标顺序不影响输出（内部排序）
  });

  it("tie-break：等长两路时域内边优先（确定性消歧）", () => {
    // Order→A→Process 与 Order→B→Process 都是 2 跳；A 与 Order 同域(sales)，B 跨域 → 选经 A。
    const types: PlannerType[] = [
      { key: "Order", domain: "sales" }, { key: "A", domain: "sales" }, { key: "B", domain: "finance" }, { key: "Process", domain: "process" },
    ];
    const links: PlannerLink[] = [
      { linkKey: "oa", fromTypeKey: "Order", toTypeKey: "A" },
      { linkKey: "ob", fromTypeKey: "Order", toTypeKey: "B" },
      { linkKey: "ap", fromTypeKey: "A", toTypeKey: "Process" },
      { linkKey: "bp", fromTypeKey: "B", toTypeKey: "Process" },
    ];
    const p = plan(planSlice(types, links, { rootType: "Order", targets: ["Process"], maxHops: 6 }));
    expect(p.paths[0]!.hops[0]!.toType).toBe("A"); // 域内边优先
  });
});

describe("A3.3 · 规划端点（真服务 · 本租户本体图 + R2）", () => {
  it("POST /a/v1/slices/plan：root===target → 空路径 ok；未知类型 → NO_PATH", async () => {
    const t = await makeApp();
    await seedBattery(t); // 物化电池本体（OntologyType + Link 图）
    const types = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })).json() as { key: string }[];
    expect(types.length).toBeGreaterThan(0);
    const root = types[0]!.key;
    const self = (await t.app.inject({ method: "POST", url: "/a/v1/slices/plan", headers: ADMIN, payload: { rootType: root, targets: [root] } })).json() as PlanSliceResponse;
    expect(self.ok).toBe(true);
    if (self.ok) expect(self.plan.paths[0]!.hops).toEqual([]);
    const miss = (await t.app.inject({ method: "POST", url: "/a/v1/slices/plan", headers: ADMIN, payload: { rootType: root, targets: ["NoSuchType"] } })).json() as PlanSliceResponse;
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.reason.unreachable).toContain("NoSuchType");
  });

  it("R2：无本体的租户 → 任意目标 NO_PATH（不泄漏他租户图）", async () => {
    const t = await makeApp();
    const r = (await t.app.inject({ method: "POST", url: "/a/v1/slices/plan", headers: { "x-debug-user": "empty:admin:admin" }, payload: { rootType: "Order", targets: ["Process"] } })).json() as PlanSliceResponse;
    expect(r.ok).toBe(false);
  });
});
