import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, TENANT, debugHeaders } from "./helpers.js";

/**
 * D-29 实时环 E-c：AgentCore 领域事件馈源（/b/v1/outbox）——B 侧发布类事件落库，供前端 F1 双源轮询
 * 跨会话传播。验证：append→列出、?since 游标过滤、R2 租户隔离。
 */
describe("E-c · AgentCore 领域事件馈源 /b/v1/outbox", () => {
  it("DF-5：真发布技能 → skill.published 落 /b/v1/outbox（补 B 栈资源发布信号·red-bite）", async () => {
    const t = await createTestApp();
    const H = debugHeaders(ADMIN);
    const created = await t.app.inject({
      method: "POST", url: "/b/v1/skills", headers: H,
      payload: { key: "df5_probe", name: "DF5探针技能", summary: "占位", body: "占位正文", resources: [] },
    });
    const id = (created.json() as { id: string }).id;
    const t0 = new Date(Date.now() - 1000).toISOString();
    // force=true 走 lint/eval 审计豁免，聚焦发布 → 事件发射（DF-5 缺口）。
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H, payload: {} });
    expect(pub.statusCode).toBe(200);
    const feed = await t.app.inject({ method: "GET", url: `/b/v1/outbox?since=${encodeURIComponent(t0)}`, headers: H });
    const rows = feed.json() as Array<{ event: string }>;
    // /b/v1/outbox 是失效信号馈源（仅 eventId/event/createdAt·无 payload）；前端按 event 名失效绑定下拉。
    expect(rows.map((r) => r.event)).toContain("skill.published"); // red-bite：未发射 emit 则此断言红
  });


  it("append → /b/v1/outbox 列出（eventId/event/createdAt）+ ?since 游标过滤 + R2 隔离", async () => {
    const t = await createTestApp();
    const t0 = new Date(Date.now() - 1000).toISOString();
    await t.repos.domainEvents.append({ id: "evt_w1", tenantId: TENANT, event: "workflow.published", payload: { id: "wf1" }, createdAt: new Date().toISOString() });
    await t.repos.domainEvents.append({ id: "evt_a1", tenantId: TENANT, event: "agent.published", payload: { id: "ag1" }, createdAt: new Date().toISOString() });
    // 他租户事件不应被本租户看到（R2）
    await t.repos.domainEvents.append({ id: "evt_x", tenantId: "other", event: "scenario.published", payload: {}, createdAt: new Date().toISOString() });

    const res = await t.app.inject({ method: "GET", url: `/b/v1/outbox?since=${encodeURIComponent(t0)}`, headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const evts = res.json() as { eventId: string; event: string; createdAt: string }[];
    const names = evts.map((e) => e.event);
    expect(names).toContain("workflow.published");
    expect(names).toContain("agent.published");
    expect(names).not.toContain("scenario.published"); // 他租户事件被 R2 隔离
    expect(evts.every((e) => e.eventId && e.createdAt)).toBe(true);

    // 未来游标 → 空（F1 轮询语义：只回 since 之后）
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const empty = await t.app.inject({ method: "GET", url: `/b/v1/outbox?since=${encodeURIComponent(future)}`, headers: debugHeaders(ADMIN) });
    expect((empty.json() as unknown[]).length).toBe(0);
  });
});
