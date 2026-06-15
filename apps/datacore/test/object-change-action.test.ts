import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, PLANNER } from "./helpers.js";

interface SliceResult { nodes: { typeKey: string; objectKey: string; props: Record<string, unknown> }[] }

describe("Phase9B 对象级数据变更（Action 门控 + 二次推演）", () => {
  it("OC1: 改对象字段必须经 Action 审批；EXECUTED 后落账(origin→MANUAL) + 切片二次推演反映新值", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 取一张订单当前 qty（直接读仓储拿完整实例，含 origin）
    const orders = await t.repos.objects.listByType("demo", "Order");
    const obj = orders[0]!;
    const objectId = obj.id;
    const so = String(obj.props.so);
    const origQty = obj.props.qty;
    expect(origQty).not.toBe(99999);

    // 创建对象数据变更草稿 → PENDING_APPROVAL（不直接改真值）
    const draftRes = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "对象数据变更", payload: { objectType: "Order", objectId, patch: { qty: 99999 }, reason: "纠正录入" } },
    });
    expect(draftRes.statusCode).toBe(201);
    const { draftId, status } = draftRes.json() as { draftId: string; status: string };
    expect(status).toBe("PENDING_APPROVAL");

    // 审批前：真值未变（仍需审批）
    const mid = await t.repos.objects.get("demo", objectId);
    expect(mid!.props.qty).toBe(origQty);

    // admin 批准 → 域执行器落库
    const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    const done = approved.json() as { status: string; executionResult?: { targetRef?: string } };
    expect(done.status).toBe("EXECUTED");
    expect(done.executionResult?.targetRef).toBe(`OBJ-${objectId}`);

    // 落账：新值 + origin=MANUAL（溯源：变更经 Action 审计留痕）
    const after = await t.repos.objects.get("demo", objectId);
    expect(after!.props.qty).toBe(99999);
    expect(after!.origin.type).toBe("MANUAL");

    // 二次推演：切片重新检索该订单 → 节点反映新值（resolve 实时读当前对象）
    const slice = (await t.app.inject({
      method: "POST",
      url: "/a/v1/ontology/slices/order_fulfillment_360/resolve",
      headers: ADMIN,
      payload: { args: { so } },
    })).json() as SliceResult;
    const orderNode = slice.nodes.find((n) => n.typeKey === "Order" && n.objectKey === so);
    expect(orderNode?.props.qty).toBe(99999);

    // 审计可查
    const audit = await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${draftId}/audit`, headers: ADMIN });
    expect(audit.statusCode).toBe(200);
  });

  it("OC2: 不存在的对象 → 执行失败(EXECUTION_FAILED)，不静默成功", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const draftRes = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "对象数据变更", payload: { objectType: "Order", objectId: "obj_order_NOPE", patch: { qty: 1 }, reason: "x" } },
    });
    const { draftId } = draftRes.json() as { draftId: string };
    const approved = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    expect((approved.json() as { status: string }).status).toBe("EXECUTION_FAILED");
  });
});
