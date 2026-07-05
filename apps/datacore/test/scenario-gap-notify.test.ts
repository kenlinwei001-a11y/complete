import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, PLANNER } from "./helpers.js";

/**
 * ONTO-SCEN-LAUNCH-DET（PRD-scenario-ontogenesis §2.5）· B→A 服务间角色通知路由齿：
 * `POST /a/v1/notifications/notify-role`（x-service-token）→ NotificationService.notifyRole 角色扇出 →
 * 前端铃铛/通知中心（收件箱）可见 + refType/refId 深链工单。用户 JWT/debug 一律 403（服务间凭证约定）。
 */
describe("场景缺口通知（服务间 notify-role → 收件箱）", () => {
  const payload = {
    role: "admin",
    kind: "scenario_gap",
    title: "场景卡「产能可行性」发育缺口（SOLVER_NOT_FOUND）",
    body: "点卡不可答：求解器被删。已建成长工单 gtk_TEST。",
    refType: "growth_ticket",
    refId: "gtk_TEST",
  };

  it("服务间凭证 → 角色扇出落收件箱（admin 铃铛可见·refId 深链工单）", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/notifications/notify-role",
      headers: { "x-service-token": "svc-secret", "x-tenant-id": "demo", "x-service-caller": "agentcore", "content-type": "application/json" },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { notified: number }).notified).toBeGreaterThanOrEqual(1);

    const inbox = (await t.app.inject({ method: "GET", url: "/a/v1/notifications", headers: ADMIN })).json() as {
      items: { kind: string; refType?: string; refId?: string; title: string }[];
      unread: number;
    };
    const n = inbox.items.find((x) => x.kind === "scenario_gap");
    expect(n).toBeDefined();
    expect(n!.refType).toBe("growth_ticket");
    expect(n!.refId).toBe("gtk_TEST");
    expect(inbox.unread).toBeGreaterThanOrEqual(1);

    // 角色扇出边界：planner 不收 admin 角色通知
    const plannerInbox = (await t.app.inject({ method: "GET", url: "/a/v1/notifications", headers: PLANNER })).json() as {
      items: { kind: string }[];
    };
    expect(plannerInbox.items.some((x) => x.kind === "scenario_gap")).toBe(false);
  });

  it("非服务凭证（用户态）一律 403——服务间路由不对用户开放", async () => {
    const t = await makeApp({ env: { SERVICE_TOKEN: "svc-secret" } });
    const res = await t.app.inject({ method: "POST", url: "/a/v1/notifications/notify-role", headers: ADMIN, payload });
    expect(res.statusCode).toBe(403);
  });
});
