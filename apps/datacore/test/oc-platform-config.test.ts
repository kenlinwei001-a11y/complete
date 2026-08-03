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

/**
 * #92 · 账本的服务间消费面：三条路由此前全是 admin-only，而天然写入方 AgentCore
 * 拿的是服务间凭证（X-Service-Token + X-Tenant-Id）——进不去，于是账本零消费方。
 * 现放行 **读 + 记账**给 service 角色；**配置面（PUT 设限额）仍 admin-only**：
 * 设预算是人的决定，不该被服务改。
 */
describe("#92 · LLM 配额账本对服务间调用开放（读+记账）", () => {
  const SERVICE = { "x-service-token": "svc-secret", "x-tenant-id": "demo", "x-service-caller": "agentcore" };

  it("service 可读、可记账；PUT 设限额仍拒（配置面只归人）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });
    await t.app.inject({ method: "PUT", url: "/a/v1/llm-budgets", headers: ADMIN, payload: { hardLimitTokens: 500, softLimitPct: 0.8 } });

    const read = await t.app.inject({ method: "GET", url: "/a/v1/llm-budgets", headers: SERVICE });
    expect(read.statusCode).toBe(200);
    expect((read.json() as { hardLimitTokens: number }).hardLimitTokens).toBe(500);

    const rec = await t.app.inject({ method: "POST", url: "/a/v1/llm-budgets/record", headers: SERVICE, payload: { tokens: 450 } });
    expect(rec.statusCode).toBe(200);
    expect((rec.json() as { state: string }).state).toBe("SOFT_EXCEEDED"); // 450 ≥ soft 400

    // 配置面不对服务开放：service 改不了限额。
    const put = await t.app.inject({ method: "PUT", url: "/a/v1/llm-budgets", headers: SERVICE, payload: { hardLimitTokens: 999999 } });
    expect(put.statusCode).toBe(403);
  });

  it("R2 租户隔离：service 头带哪个租户就只动哪个租户的账本", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });
    await t.app.inject({ method: "POST", url: "/a/v1/llm-budgets/record", headers: SERVICE, payload: { tokens: 300 } });
    const other = await t.app.inject({
      method: "GET",
      url: "/a/v1/llm-budgets",
      headers: { ...SERVICE, "x-tenant-id": "acme" },
    });
    expect((other.json() as { usedTokens: number }).usedTokens).toBe(0);
    const demo = await t.app.inject({ method: "GET", url: "/a/v1/llm-budgets", headers: SERVICE });
    expect((demo.json() as { usedTokens: number }).usedTokens).toBe(300);
  });
});
