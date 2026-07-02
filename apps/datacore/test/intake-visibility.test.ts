import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, b64, type TestApp } from "./helpers.js";

/**
 * WO-INTAKE-VISIBILITY（G-VIS-1）：上传→objectify→未命中列入 reconcile 队列（C2）→逐列 resolve→重跑物化→
 * 对象实例带该列真值（C6 IPO 闭环）。治本：skip 列不再静默丢，人确认后真物化进对象（前端所见=后端真值）。
 */
describe("WO-INTAKE-VISIBILITY · 上传→建模→物化一条龙", () => {
  it("C2：objectify 未精确命中的列 → 落 reconcile-candidates 队列（带 column/sampleValues/connId·可 connId 过滤）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t); // 发布 battery 本体（Order 含 so/qty 字段）
    // 上传：so 精确命中 Order.so；ordered_qty 部分命中(qty) → 候选；weird_col 无命中 → 候选。
    const csv = "so,ordered_qty,weird_col\nSO-E2E-1,1500,x1\nSO-E2E-2,900,x2\n";
    const up = (await (await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "orders_e2e.csv", contentBase64: b64(csv) } })).json()) as { connId: string };
    const connId = up.connId;

    const obj = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake/objectify", headers: ADMIN, payload: { connId } })).json()) as { candidates: number };
    expect(obj.candidates).toBeGreaterThan(0);

    const queue = (await (await t.app.inject({ method: "GET", url: `/a/v1/databuilder/reconcile-candidates?connId=${connId}`, headers: ADMIN })).json()) as { items: { column?: string; suggestedAction: string; sampleValues?: unknown[]; connId?: string }[] };
    expect(queue.items.length).toBeGreaterThan(0);
    const first = queue.items[0]!;
    expect(first.column).toBeTruthy();
    expect(first.suggestedAction).toBeTruthy();
    expect(first.connId).toBe(connId);
    // ordered_qty 列在队列里，带样本值（前端确认时看上下文）。
    const oq = queue.items.find((c) => c.column === "ordered_qty")!;
    expect(oq.sampleValues).toContain(1500);
    // connId 过滤真生效：换个不存在的 connId → 空。
    const other = (await (await t.app.inject({ method: "GET", url: `/a/v1/databuilder/reconcile-candidates?connId=nope`, headers: ADMIN })).json()) as { items: unknown[] };
    expect(other.items.length).toBe(0);
  });

  it("C6：resolve(USE→qty) → 重跑 objectify → Order 实例的 qty 严格等于上传行的 ordered_qty 值（前端确认真生效·非装饰）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const csv = "so,ordered_qty\nSO-E2E-9,1777\nSO-E2E-8,640\n";
    const up = (await (await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "orders_e2e2.csv", contentBase64: b64(csv) } })).json()) as { connId: string };
    const connId = up.connId;

    // objectify#1：ordered_qty 未精确命中 → 候选（未物化到 qty）。
    await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake/objectify", headers: ADMIN, payload: { connId } });
    const queue = (await (await t.app.inject({ method: "GET", url: `/a/v1/databuilder/reconcile-candidates?connId=${connId}`, headers: ADMIN })).json()) as { items: { id: string; column?: string }[] };
    const cand = queue.items.find((c) => c.column === "ordered_qty")!;
    expect(cand).toBeTruthy();

    // 人确认：ordered_qty 就是 Order.qty（USE）。
    const res = await t.app.inject({ method: "POST", url: `/a/v1/databuilder/reconcile-candidates/${cand.id}/resolve`, headers: ADMIN, payload: { action: "USE", target: "qty" } });
    expect(res.statusCode).toBe(200);

    // objectify#2（重跑物化，resolve 生效）→ Order 实例带 qty。
    await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake/objectify", headers: ADMIN, payload: { connId } });
    const objs = (await (await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Order&pageSize=500", headers: ADMIN })).json()) as { items: { id: string; props: Record<string, unknown> }[] };
    const inst = objs.items.find((o) => String(o.props.so ?? "").includes("SO-E2E-9") || o.id.includes("SO-E2E-9"));
    expect(inst).toBeTruthy();
    // 前端所见 = 后端真值：实例 qty === 上传行 ordered_qty（1777）。
    expect(Number(inst!.props.qty)).toBe(1777);
  });
});
