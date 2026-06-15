import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, PLANNER, type TestApp } from "./helpers.js";

const ADOPT_PAYLOAD = { base: "changzhou", factor: "物料齐套", planKey: "early_stock" };

async function submitDraft(t: TestApp): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: PLANNER,
    payload: { actionTypeKey: "adopt_mitigation", payload: ADOPT_PAYLOAD },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { draftId: string }).draftId;
}

const listNotifs = (t: TestApp, headers: Record<string, string>) =>
  t.app.inject({ method: "GET", url: "/a/v1/notifications", headers }).then(
    (r) => r.json() as { items: { id: string; kind: string; refType?: string; refId?: string }[]; unread: number },
  );

describe("运营完备性 §9 — 通知中心（OC8/OC9）", () => {
  it("提交审批 → 审批人收到定向 approval_pending 通知（跳转 action）；已读后未读数归零", async () => {
    const t = await makeApp();
    const draftId = await submitDraft(t);

    const admin = await listNotifs(t, ADMIN);
    expect(admin.unread).toBeGreaterThanOrEqual(1);
    const pending = admin.items.find((n) => n.kind === "approval_pending" && n.refId === draftId);
    expect(pending).toBeDefined();
    expect(pending!.refType).toBe("action");

    // originator (planner) should NOT receive the approval-pending notification
    const plannerInbox = await listNotifs(t, PLANNER);
    expect(plannerInbox.items.some((n) => n.kind === "approval_pending")).toBe(false);

    // mark read → unread drops
    await t.app.inject({ method: "POST", url: `/a/v1/notifications/${pending!.id}/read`, headers: ADMIN });
    const after = await listNotifs(t, ADMIN);
    expect(after.unread).toBe(admin.unread - 1);
  });

  it("被拒 → 发起人收到 action_rejected 通知（含意见）", async () => {
    const t = await makeApp();
    const draftId = await submitDraft(t);
    const rej = await t.app.inject({
      method: "POST",
      url: `/a/v1/action-drafts/${draftId}/reject`,
      headers: ADMIN,
      payload: { comment: "现金垫不足，暂缓" },
    });
    expect(rej.statusCode).toBe(200);

    const planner = await listNotifs(t, PLANNER);
    const rejected = planner.items.find((n) => n.kind === "action_rejected" && n.refId === draftId);
    expect(rejected).toBeDefined();
  });

  it("read-all 清空未读", async () => {
    const t = await makeApp();
    await submitDraft(t);
    const before = await listNotifs(t, ADMIN);
    expect(before.unread).toBeGreaterThan(0);
    const r = await t.app.inject({ method: "POST", url: "/a/v1/notifications/read-all", headers: ADMIN });
    expect((r.json() as { marked: number }).marked).toBe(before.unread);
    const after = await listNotifs(t, ADMIN);
    expect(after.unread).toBe(0);
  });
});
