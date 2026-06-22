import { describe, expect, it } from "vitest";
import { makeApp, type TestApp } from "./helpers.js";
import { SolverService } from "../src/solvers/service.js";
import type { SolverArtifact } from "@platform/contracts";

/**
 * A18.3 写真值门控（创建人作用域，用户裁决）+ A18.4 晋升 GOVERNED。
 * 红线：未审核临时件默认不写真值；仅创建人可用自己造的写（带"未认证"标）；晋升 GOVERNED 后任何人可写。
 */
const baseArt = (over: Partial<SolverArtifact>): SolverArtifact => ({
  id: "sart_demo_x_v1", tenantId: "demo", key: "x", computeSource: "(c,a)=>({})", outputShape: [], argHints: {},
  rationale: "", origin: "LLM", status: "PROVISIONAL", trustLevel: "UNVERIFIED", hash: "h", version: 1,
  createdBy: "alice", createdAt: "2026-01-01", ...over,
});

describe("A18.3 · 写真值门控（创建人作用域，纯函数）", () => {
  it("PROVISIONAL + 创建人本人 → 允许写真值（带'审核中·未认证'标）", () => {
    const r = SolverService.canArtifactWriteTruth(baseArt({}), "alice");
    expect(r.allowed).toBe(true);
    expect(r.label).toMatch(/未认证|UNVERIFIED|审核中/);
  });
  it("PROVISIONAL + 非创建人 → 拒（他人需先晋升 GOVERNED）", () => {
    const r = SolverService.canArtifactWriteTruth(baseArt({}), "bob");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/创建人|晋升/);
  });
  it("GOVERNED → 任何人可写真值（无未认证标）", () => {
    const r = SolverService.canArtifactWriteTruth(baseArt({ status: "GOVERNED", trustLevel: "VERIFIED" }), "bob");
    expect(r.allowed).toBe(true);
    expect(r.label).toBeUndefined();
  });
  it("GENERATED/UNREGISTERED → 不可写真值", () => {
    expect(SolverService.canArtifactWriteTruth(baseArt({ status: "UNREGISTERED" }), "alice").allowed).toBe(false);
  });
});

const GOOD_DRAFT = { computeSource: "(ctx, args) => ({ n: Object.keys(ctx.objectsByType).length })", outputShape: ["n"], argHints: {}, rationale: "统计" };

describe("A18.4 · 晋升 GOVERNED + 写真值门控端点（L1）", () => {
  it("生成 PROVISIONAL → write-truth-check 创建人允许/他人拒 → promote GOVERNED → 任何人允许 + 事件", async () => {
    const t: TestApp = await makeApp();
    t.llm.enqueue(GOOD_DRAFT);
    // admin(=usr_demo_admin) 创建
    const ADMIN = { "x-debug-user": "demo:usr_demo_admin:admin" };
    const OTHER = { "x-debug-user": "demo:usr_demo_other:admin" };
    await t.app.inject({ method: "POST", url: "/a/v1/solvers/generate", headers: ADMIN, payload: { key: "demo_count", intent: "统计" } });

    // 创建人本人 → 允许（带标）
    const selfCheck = (await (await t.app.inject({ method: "GET", url: "/a/v1/solvers/demo_count/write-truth-check", headers: ADMIN })).json()) as { allowed: boolean; label?: string };
    expect(selfCheck.allowed).toBe(true);
    expect(selfCheck.label).toMatch(/未认证|UNVERIFIED/);
    // 他人 → 拒
    const otherCheck = (await (await t.app.inject({ method: "GET", url: "/a/v1/solvers/demo_count/write-truth-check", headers: OTHER })).json()) as { allowed: boolean };
    expect(otherCheck.allowed).toBe(false);

    // 晋升 GOVERNED
    const promoted = (await (await t.app.inject({ method: "POST", url: "/a/v1/solvers/demo_count/promote", headers: ADMIN })).json()) as { status: string; trustLevel: string };
    expect(promoted.status).toBe("GOVERNED");
    expect(promoted.trustLevel).toBe("VERIFIED");
    // 晋升后他人也可写真值
    const afterOther = (await (await t.app.inject({ method: "GET", url: "/a/v1/solvers/demo_count/write-truth-check", headers: OTHER })).json()) as { allowed: boolean };
    expect(afterOther.allowed).toBe(true);
    // 事件
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "solver.status_changed");
    expect(events.some((e) => (e.payload as { to?: string }).to === "GOVERNED")).toBe(true);
  });
});
