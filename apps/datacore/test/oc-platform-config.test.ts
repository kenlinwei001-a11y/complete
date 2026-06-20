import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

const ACME = debugUser("acme", "admin", "admin");

describe("OC7 LLM 成本配额与降级", () => {
  it("软线→降级、硬线→拒（state/degrade）+ 用量累加 + R2", async () => {
    const t = await makeApp();
    await t.app.inject({ method: "PUT", url: "/a/v1/llm-budgets", headers: ADMIN, payload: { hardLimitTokens: 1000, softLimitPct: 0.8 } });
    let st = (await (await t.app.inject({ method: "GET", url: "/a/v1/llm-budgets", headers: ADMIN })).json()) as { state: string; degrade: boolean; softLimitTokens: number };
    expect(st.state).toBe("OK"); expect(st.degrade).toBe(false); expect(st.softLimitTokens).toBe(800);
    // 用 850 → 过软线 → 降级
    st = (await (await t.app.inject({ method: "POST", url: "/a/v1/llm-budgets/record", headers: ADMIN, payload: { tokens: 850 } })).json()) as typeof st;
    expect(st.state).toBe("SOFT_EXCEEDED"); expect(st.degrade).toBe(true);
    // 再用 200（共 1050）→ 过硬线 → 拒
    st = (await (await t.app.inject({ method: "POST", url: "/a/v1/llm-budgets/record", headers: ADMIN, payload: { tokens: 200 } })).json()) as typeof st;
    expect(st.state).toBe("HARD_EXCEEDED");
    // R2：acme 无配额（hard=0=不限）→ OK
    const acme = (await (await t.app.inject({ method: "GET", url: "/a/v1/llm-budgets", headers: ACME })).json()) as { state: string; usedTokens: number };
    expect(acme.state).toBe("OK"); expect(acme.usedTokens).toBe(0);
  });
});

describe("OC9 工厂日历 · 净生产窗口扣减", () => {
  it("周末扣除 + 春节周节假日扣除 + 加班日补回", async () => {
    const t = await makeApp();
    // 2026-02-16(周一)~2026-02-22(周日)：自然 7 天，周末扣 2 → 净 5
    let nw = (await (await t.app.inject({ method: "GET", url: "/a/v1/calendars/main/net-window?from=2026-02-16&to=2026-02-22", headers: ADMIN })).json()) as { netProductionDays: number };
    expect(nw.netProductionDays).toBe(5);
    // 标 2/17~2/19 为春节假期（HOLIDAY）→ 净 5-3=2
    await t.app.inject({ method: "PUT", url: "/a/v1/calendars/main", headers: ADMIN, payload: { exceptions: [
      { date: "2026-02-17", kind: "HOLIDAY", label: "春节" }, { date: "2026-02-18", kind: "HOLIDAY", label: "春节" }, { date: "2026-02-19", kind: "HOLIDAY", label: "春节" },
      { date: "2026-02-21", kind: "EXTRA_WORKDAY", label: "调休补班" }, // 周六补班 +1
    ] } });
    nw = (await (await t.app.inject({ method: "GET", url: "/a/v1/calendars/main/net-window?from=2026-02-16&to=2026-02-22", headers: ADMIN })).json()) as { netProductionDays: number };
    expect(nw.netProductionDays).toBe(3); // 5 - 3 假 + 1 补班 = 3（周一在产、周二三四假、周五在产、周六补班、周日休）
  });
});

describe("OC5 写回回声抑制 + 不一致告警", () => {
  it("回流同值→ECHO_SUPPRESSED；回流异值→DIVERGENCE；无 pending→NO_PENDING", async () => {
    const t = await makeApp();
    // 写回 Order:SO-1.status = CONFIRMED
    await t.app.inject({ method: "POST", url: "/a/v1/writeback-echoes", headers: ADMIN, payload: { ref: "Order:SO-1.status", writtenValue: "CONFIRMED", actionId: "act_1" } });
    // 源系统回流同值 → 回声抑制（pending 消费）
    const echo = (await (await t.app.inject({ method: "POST", url: "/a/v1/writeback-echoes/reconcile", headers: ADMIN, payload: { ref: "Order:SO-1.status", incomingValue: "CONFIRMED" } })).json()) as { verdict: string };
    expect(echo.verdict).toBe("ECHO_SUPPRESSED");
    // 再写回 + 回流异值 → 不一致告警
    await t.app.inject({ method: "POST", url: "/a/v1/writeback-echoes", headers: ADMIN, payload: { ref: "Order:SO-2.qty", writtenValue: 100, actionId: "act_2" } });
    const div = (await (await t.app.inject({ method: "POST", url: "/a/v1/writeback-echoes/reconcile", headers: ADMIN, payload: { ref: "Order:SO-2.qty", incomingValue: 95 } })).json()) as { verdict: string; writtenValue: unknown; incomingValue: unknown };
    expect(div.verdict).toBe("DIVERGENCE"); expect(div.writtenValue).toBe(100); expect(div.incomingValue).toBe(95);
    // 无 pending → NO_PENDING
    const none = (await (await t.app.inject({ method: "POST", url: "/a/v1/writeback-echoes/reconcile", headers: ADMIN, payload: { ref: "Order:NOPE.x", incomingValue: 1 } })).json()) as { verdict: string };
    expect(none.verdict).toBe("NO_PENDING_WRITEBACK");
  });
});
