import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { planFingerprint } from "../src/actions.js";

/**
 * WO-GSIM-5-ACTION · 洞察→行动写回·闭决策环（SEAM-GATE·接缝驱动·非各半绿）。
 *
 * 接缝 = 数据半（portfolio 读的 Order/WorkOrder 真基线）× 引擎半（S2 Action 执行器回灌）。
 * 头号判据：portfolio 结果 **采纳前 ≠ 执行后**（真基线变），端到端——采纳一个方案 → 建 PROVISIONAL/PENDING
 * Action（断言状态·非 toast）→ approve → execute → 再跑 portfolio → 断言基线随采纳真变；幂等；R6 + tenant。
 */

const SOLVER_CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

type Alloc = { item: string; kind: string; committed: boolean; base: string; baseName: string; window: number; windowStartDay: number; qty: number; model: string };
type PortOut = {
  allocation: Alloc[];
  occupancy: { item: string; base: string; window: number; qty: number }[];
  displaced: { orderId: string; kind: string; qty: number }[];
  scenarios: { key: string; servedQty: number }[];
  reconciled: boolean;
  summary: string;
};

const runPortfolio = async (t: Awaited<ReturnType<typeof makeApp>>): Promise<PortOut> =>
  (await t.services.solvers.invoke(SOLVER_CTX, "portfolio", { scenarios: ["max_ontime", "min_cost"] })) as unknown as PortOut;

const servedFrom = (out: PortOut) =>
  out.allocation
    .filter((a) => a.kind === "order" && !a.committed)
    .map((a) => ({ orderId: a.item, base: a.base, baseName: a.baseName, window: a.window, windowStartDay: a.windowStartDay, qty: a.qty, model: a.model }));

const mkPayload = (out: PortOut, served: ReturnType<typeof servedFrom>) => ({
  source: "global-sim" as const,
  objective: "max_ontime",
  servedQty: served.reduce((s, x) => s + x.qty, 0),
  displaced: out.displaced.map((d) => d.orderId),
  summary: out.summary,
  served,
});

/** 采纳（POST /a/v1/action-drafts·真路由）。 */
const adopt = async (t: Awaited<ReturnType<typeof makeApp>>, payload: unknown) =>
  t.app.inject({ method: "POST", url: "/a/v1/action-drafts", headers: ADMIN, payload: { actionTypeKey: "plan_change", payload, submit: true } });

describe("WO-GSIM-5-ACTION · 洞察→行动写回·闭决策环（SEAM-GATE）", () => {
  it("SEAM 头号：端到端基线真变（采纳→PROVISIONAL Action→审批→执行→回灌→下一轮 portfolio 真变）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ① 基线快照。
    const before = await runPortfolio(t);
    const served = servedFrom(before);
    expect(served.length).toBeGreaterThan(0);
    const pick = served[0]!.orderId; // 追踪一个被服务订单
    expect(before.allocation.some((a) => a.item === pick && a.kind === "order" && !a.committed)).toBe(true);

    // ② 采纳 → 真 Action（PENDING_APPROVAL·非 toast·断言状态）。
    const payload = mkPayload(before, served);
    const created = (await adopt(t, payload)).json() as { draftId: string; status: string };
    expect(created.status).toBe("PENDING_APPROVAL"); // 真进审批流·不是前端提示
    const draftId = created.draftId;

    // ③ 审批（demo admin 自审 ALLOW_ADMIN）→ 自动执行 → EXECUTED。
    const approved = (await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} })).json() as { status: string; executionResult?: { ok: boolean; targetRef?: string } };
    expect(approved.status).toBe("EXECUTED");
    expect(approved.executionResult?.ok).toBe(true);

    // ④ 回灌物化真对象（在产 WorkOrder·origin=ACTION·R13 provenance 溯回方案）。
    const wos = (await t.repos.objects.listByType("demo", "WorkOrder")).filter((o) => o.origin.type === "ACTION");
    expect(wos.length).toBe(served.length);
    const wPick = wos.find((w) => String(w.props._adoptedOrderId) === pick)!;
    expect(wPick).toBeDefined();
    expect((wPick.props._provenance as { source: string }).source).toBe("global-sim");
    expect(String(wPick.props.status)).toBe("生产中"); // 承诺占用·非完工

    // ⑤ 下一轮 portfolio：基线真变——被服务订单已移出 OPEN 决策集，且以 committed WIP 承诺占用。
    const after = await runPortfolio(t);
    expect(JSON.stringify(after.occupancy)).not.toBe(JSON.stringify(before.occupancy)); // 结果真变
    // 被追踪订单不再作为自由订单出现在决策分配里（已 status→已排产）。
    expect(after.allocation.some((a) => a.item === pick && a.kind === "order" && !a.committed)).toBe(false);
    // 新的承诺占用 WIP 进入基线（committed·item = WIP:WO-GS-…）。
    const newWip = after.allocation.filter((a) => a.committed && a.item.includes("WO-GS-"));
    expect(newWip.length).toBeGreaterThan(0);
    // 承诺占用后决策集变小（自由决策订单减少）。
    const freeOrdersBefore = before.allocation.filter((a) => a.kind === "order" && !a.committed).length;
    const freeOrdersAfter = after.allocation.filter((a) => a.kind === "order" && !a.committed).length;
    expect(freeOrdersAfter).toBeLessThan(freeOrdersBefore);
    expect(after.reconciled).toBe(true); // 回灌后守恒仍成立
  });

  it("SEAM 幂等：同方案两次采纳 → 只 1 个 Action + 1 组物化（第二次不重复）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await runPortfolio(t);
    const served = servedFrom(before);
    const payload = mkPayload(before, served);
    const fp = planFingerprint("plan_change", payload)!;
    expect(fp).toMatch(/^gsim_/);

    const first = (await adopt(t, payload)).json() as { draftId: string };
    await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${first.draftId}/approve`, headers: ADMIN, payload: {} });
    const wosAfter1 = (await t.repos.objects.listByType("demo", "WorkOrder")).filter((o) => o.origin.type === "ACTION").length;

    // 第二次采纳同方案 → 返回既有草稿（不新建）。
    const second = (await adopt(t, payload)).json() as { draftId: string };
    expect(second.draftId).toBe(first.draftId);
    const drafts = await t.repos.actionDrafts.list("demo", (d) => d.fingerprint === fp);
    expect(drafts.length).toBe(1); // 仅一个 Action
    const wosAfter2 = (await t.repos.objects.listByType("demo", "WorkOrder")).filter((o) => o.origin.type === "ACTION").length;
    expect(wosAfter2).toBe(wosAfter1); // 物化未翻倍
  });

  it("SEAM R6 + tenant：同 payload 两跑生成物字节一致；跨租户不可见/不可批（404）", async () => {
    // R6：两个独立 app 同 payload 采纳+执行 → 生成的 WorkOrder id + props 字节一致（除随机 actionId 外）。
    const stripOrigin = (o: { id: string; type: string; props: Record<string, unknown> }) => {
      // 归一非确定性的 Action backref（actionId/drillId = 随机草稿 id）；断言物化制品身份（id/props）字节一致。
      const { _provenance, _adoptedByAction, ...rest } = o.props as Record<string, unknown> & { _provenance?: Record<string, unknown> };
      void _adoptedByAction;
      const prov = _provenance ? { ..._provenance, actionId: "<id>", drillId: "<id>" } : undefined;
      return JSON.stringify({ id: o.id, type: o.type, props: { ...rest, _provenance: prov } });
    };
    const runOnce = async () => {
      const t = await makeApp();
      await seedBattery(t);
      const before = await runPortfolio(t);
      const served = servedFrom(before);
      const payload = mkPayload(before, served);
      const created = (await adopt(t, payload)).json() as { draftId: string };
      await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${created.draftId}/approve`, headers: ADMIN, payload: {} });
      const objs = (await t.repos.objects.listByType("demo", "WorkOrder"))
        .filter((o) => o.origin.type === "ACTION")
        .sort((a, b) => a.id.localeCompare(b.id));
      return objs.map(stripOrigin);
    };
    const runA = await runOnce();
    const runB = await runOnce();
    expect(runA.length).toBeGreaterThan(0);
    expect(runA).toEqual(runB); // 字节一致（R6·id/props 全 payload 派生）

    // tenant：租户 A 的草稿·租户 B 不可见/不可批（404·tenant_id everywhere）。
    const t = await makeApp();
    await seedBattery(t);
    const before = await runPortfolio(t);
    const payload = mkPayload(before, servedFrom(before));
    const created = (await adopt(t, payload)).json() as { draftId: string };
    const otherTenant = { "x-debug-user": "acme:boss:admin" };
    const getCross = await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${created.draftId}`, headers: otherTenant });
    expect(getCross.statusCode).toBe(404);
    const approveCross = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${created.draftId}/approve`, headers: otherTenant, payload: {} });
    expect(approveCross.statusCode).toBe(404);
  });
});
