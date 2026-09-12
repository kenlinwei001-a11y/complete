import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

/**
 * A18.2 · LLM 临时求解器（消灭 P5）：生成 → 冻结 → 锁死沙箱跑通自检 → 注册 PROVISIONAL → 沙箱执行（强标未审核）。
 * LLM mock（ScriptedLlmClient）；R6 由沙箱保证（Date/random 禁）；R7 隔离。
 */

const GOOD_DRAFT = {
  computeSource: "(ctx, args) => ({ types: Object.keys(ctx.objectsByType).length, echo: (args && args.x) || 0 })",
  outputShape: ["types", "echo"],
  argHints: { x: "回声数" },
  rationale: "统计对象类型数 + 回声入参（demo 临时件）",
};

describe("A18.2 · LLM 临时求解器生成 + 沙箱执行（L1）", () => {
  it("生成 → 沙箱跑通自检 → 注册 PROVISIONAL/UNVERIFIED + solver.provisional_generated 事件", async () => {
    const t: TestApp = await makeApp();
    t.llm.enqueue(GOOD_DRAFT);
    const art = (await (await t.app.inject({ method: "POST", url: "/a/v1/solvers/generate", headers: ADMIN, payload: { key: "demo_count", intent: "统计对象类型数" } })).json()) as {
      key: string; status: string; trustLevel: string; origin: string; hash: string; version: number; computeSource: string; createdBy: string;
    };
    expect(art.key).toBe("demo_count");
    expect(art.status).toBe("PROVISIONAL");
    expect(art.trustLevel).toBe("UNVERIFIED");
    expect(art.origin).toBe("LLM");
    expect(art.version).toBe(1);
    expect(art.hash.length).toBeGreaterThan(0);
    expect(art.createdBy).toBeTruthy(); // 创建人记录（A18.3 写真值门控用）
    // 事件
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "solver.provisional_generated");
    expect(events.some((e) => (e.payload as { key?: string }).key === "demo_count")).toBe(true);
  });

  it("注册后经 invoke 在锁死沙箱执行 → 输出 + 强标 __provisional（绝不冒充正式）", async () => {
    const t: TestApp = await makeApp();
    t.llm.enqueue(GOOD_DRAFT);
    await t.app.inject({ method: "POST", url: "/a/v1/solvers/generate", headers: ADMIN, payload: { key: "demo_count", intent: "统计" } });
    const out = (await (await t.app.inject({ method: "POST", url: "/a/v1/solvers/demo_count/invoke", headers: ADMIN, payload: { args: { x: 7 } } })).json()) as {
      data: { types: number; echo: number; __provisional: { status: string; trustLevel: string; origin: string } };
    };
    expect(out.data.echo).toBe(7);
    expect(typeof out.data.types).toBe("number");
    // R13 红线：临时件输出强标未审核
    expect(out.data.__provisional).toMatchObject({ status: "PROVISIONAL", trustLevel: "UNVERIFIED", origin: "LLM" });
  });

  it("坏件（用 Math.random 非确定）→ 沙箱自检失败 → status=UNREGISTERED（不注册，可查拒因）", async () => {
    const t: TestApp = await makeApp();
    t.llm.enqueue({ computeSource: "(ctx, args) => ({ r: Math.random() })", outputShape: ["r"], argHints: {}, rationale: "坏件" });
    const art = (await (await t.app.inject({ method: "POST", url: "/a/v1/solvers/generate", headers: ADMIN, payload: { key: "bad_solver", intent: "随机" } })).json()) as { status: string; rejectReason?: string };
    expect(art.status).toBe("UNREGISTERED");
    expect(art.rejectReason).toMatch(/random|禁用/);
    // 未注册 → invoke 该 key 应失败（不可调用）
    const inv = await t.app.inject({ method: "POST", url: "/a/v1/solvers/bad_solver/invoke", headers: ADMIN, payload: { args: {} } });
    expect(inv.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("GET artifact：看代码 + rationale + 状态（审核台用）", async () => {
    const t: TestApp = await makeApp();
    t.llm.enqueue(GOOD_DRAFT);
    await t.app.inject({ method: "POST", url: "/a/v1/solvers/generate", headers: ADMIN, payload: { key: "demo_count", intent: "统计" } });
    const art = (await (await t.app.inject({ method: "GET", url: "/a/v1/solvers/demo_count/artifact", headers: ADMIN })).json()) as { computeSource: string; rationale: string; status: string };
    expect(art.computeSource).toContain("ctx");
    expect(art.rationale.length).toBeGreaterThan(0);
    expect(art.status).toBe("PROVISIONAL");
  });

  it("R7 隔离：另一租户看不到临时件（artifact 404）", async () => {
    const t: TestApp = await makeApp();
    t.llm.enqueue(GOOD_DRAFT);
    await t.app.inject({ method: "POST", url: "/a/v1/solvers/generate", headers: ADMIN, payload: { key: "demo_count", intent: "统计" } });
    const other = await t.app.inject({ method: "GET", url: "/a/v1/solvers/demo_count/artifact", headers: { "x-debug-user": "acme:admin:admin" } });
    expect(other.statusCode).toBe(404);
  });
});
