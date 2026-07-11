import { describe, expect, it } from "vitest";
import { ClosurePolicySchema, type BuildPlan } from "@platform/contracts";
import { validateClosure } from "../src/databuilder/closure.js";

/**
 * WO-DB-CLOSURE-HARDEN 洞C 齿（closure 空壳判绿·据实非空判·KILL-MOCK-RED·green→red）：
 *  闭包旧仅读 `domain` 存在 → domain 已分配但切片真跑解析 0 节点仍 gatePassed=true（空壳冒充真派生）。
 *  硬化：调用方（service.ts 物化后）传 resolvedCounts(typeKey→真实节点数)：
 *   ① domain 有值 + 解析 ≥1 节点 → OBJECT/BOUND·gatePassed=true（真派生放行）；
 *   ② domain 有值但解析 0 节点 → OBJECT/FAILED·gatePassed=false（空壳翻红·根因·门有牙）；
 *   ③ 未传 counts（物化前 dry gate / 纯单测）→ 行为不变（未知不误红·向后兼容）；
 *   ④ PROVISIONAL：空壳 FAILED 降 ADVISORY·不阻断（如实记录·守"不靠阻断成 0"）。
 */
const policy = ClosurePolicySchema.parse({ object: {}, data: {}, forward: {} });
const planWith = (domain: string): BuildPlan => ({
  id: "bpl_c", tenantId: "demo", builderKey: "test", scriptHash: "h", seed: 1, script: "",
  dataSources: [], rules: [], kbDocs: [], createdAt: "2026-01-01", solverNeeds: [],
  objectTypes: [
    {
      typeKey: "Order", displayName: "订单", domain, sourceDataset: "order",
      properties: [{ propKey: "order_id", dataType: "String", isPrimaryKey: true, sourceField: "order_id" }],
    } as BuildPlan["objectTypes"][number],
  ],
});

describe("WO-DB-CLOSURE-HARDEN 洞C · 闭包据实非空判（空壳判绿翻红）", () => {
  it("① domain 有值 + 解析 ≥1 节点 → OBJECT/BOUND·gatePassed", () => {
    const r = validateClosure(planWith("commercial"), policy, "STRICT", new Map([["Order", 5]]));
    expect(r.gatePassed).toBe(true);
    expect(r.findings.some((f) => f.kind === "OBJECT" && f.ref === "Order" && f.status === "BOUND")).toBe(true);
    expect(r.objectsBound).toBe(1);
  });

  it("② domain 有值但解析 0 节点 → OBJECT/FAILED·gatePassed=false（空壳翻红·门有牙）", () => {
    const r = validateClosure(planWith("commercial"), policy, "STRICT", new Map([["Order", 0]]));
    expect(r.gatePassed).toBe(false); // ← 旧门此处 true（空壳判绿）；硬化后 false
    const f = r.findings.find((x) => x.kind === "OBJECT" && x.ref === "Order");
    expect(f?.status).toBe("FAILED");
    expect(f?.detail).toContain("0 节点");
  });

  it("③ 未传 counts（物化前/纯单测）→ 行为不变·gatePassed（向后兼容·未知不误红）", () => {
    const r = validateClosure(planWith("commercial"), policy); // 无 resolvedCounts
    expect(r.gatePassed).toBe(true);
    expect(r.findings.some((f) => f.kind === "OBJECT" && f.status === "BOUND")).toBe(true);
  });

  it("④ PROVISIONAL：空壳 FAILED 降 ADVISORY·不阻断（如实记录 gatePassed 仍诚实 false）", () => {
    const r = validateClosure(planWith("commercial"), policy, "PROVISIONAL", new Map([["Order", 0]]));
    expect(r.gatePassed).toBe(false); // STRICT 口径诚实
    expect(r.blocked).toBe(false); // PROVISIONAL 不阻断
    const f = r.findings.find((x) => x.kind === "OBJECT" && x.ref === "Order");
    expect(f?.severity).toBe("ADVISORY");
  });
});
