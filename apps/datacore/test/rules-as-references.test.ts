import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { SOLVER_RULE_REFS } from "@platform/contracts";

/**
 * 规则即引用（PRD-rules-as-references）P1：补全 13 条「被引用但未定义」规则为一等规则
 * → 消灭前端"（当前库中没有找到定义）" + 规则闸不再空过。
 */
describe("规则即引用 P1 · 13 条规则一等化 + 引用闭合", () => {
  const THIRTEEN = ["C01", "C02", "C04", "C06", "C09", "C10", "C11", "C15", "C16", "C21", "C22", "C24", "C25"];

  it("13 条曾未定义规则均落库为 PUBLISHED + 命名阈值落 params（求解器 P2 可读）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/rules", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const rules = res.json() as { key: string; status: string; params?: Record<string, number> }[];
    const byKey = new Map(rules.filter((r) => r.status === "PUBLISHED").map((r) => [r.key, r]));
    for (const k of THIRTEEN) {
      expect(byKey.has(k), `规则 ${k} 应已定义并发布`).toBe(true);
    }
    // 写死阈值显式化落 params（改 param 即改推演——P2 求解器接入）。
    expect(byKey.get("C09")?.params?.staleHours).toBe(2);
    expect(byKey.get("C11")?.params?.minBufferDays).toBe(3);
    expect(byKey.get("C22")?.params?.maxChangeoverMin).toBe(120);
  });

  it("引用闭合：SOLVER_RULE_REFS 全部 ⊆ 已发布规则（无悬空引用 → 不再'未找到定义'）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rules = (await (await t.app.inject({ method: "GET", url: "/a/v1/rules", headers: ADMIN })).json()) as { key: string; status: string }[];
    const published = new Set(rules.filter((r) => r.status === "PUBLISHED").map((r) => r.key));
    const referenced = [...new Set(Object.values(SOLVER_RULE_REFS).flat())];
    const missing = referenced.filter((k) => !published.has(k));
    expect(missing, `悬空引用: ${missing.join(",")}`).toEqual([]);
  });

  it("13 条 expression 全部合法 DSL（可发布、dry-run 不报语法错）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rules = (await (await t.app.inject({ method: "GET", url: "/a/v1/rules", headers: ADMIN })).json()) as { key: string; expression: string }[];
    for (const k of THIRTEEN) {
      const r = rules.find((x) => x.key === k)!;
      const dry = await t.app.inject({ method: "POST", url: "/a/v1/rules/dry-run", headers: ADMIN, payload: { expression: r.expression, samplePayload: {} } });
      expect(dry.statusCode, `${k} dry-run`).toBe(200);
    }
  });
});
