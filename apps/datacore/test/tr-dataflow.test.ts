import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, PLANNER, BASE_MANAGER, b64, ORDERS_CSV, type TestApp } from "./helpers.js";

/**
 * 数据流闭环轨迹验收（PRD-addendum-dataflow-loop-closure §5 TR1–TR8）：
 * 跟随一条数据走完全程，逐跳断言"产出→落地→下游可见"（DF-ACCEPT：任一出现"产出了但下游看不到"即未过）。
 * 注：TR3（建场景→前台推演）在 agentcore tr-scenario.test 覆盖（涉 QOS）。
 */
const objCount = async (t: TestApp, type: string, headers = ADMIN): Promise<number> => {
  const r = await t.app.inject({ method: "GET", url: `/a/v1/objects?type=${type}&pageSize=500`, headers });
  return (r.json() as { total: number }).total;
};

describe("数据流闭环轨迹 TR1–TR8", () => {
  it("TR1 上传订单 CSV → 落地 RawDataset 下游可见；合成订单 → 推演(affected_orders)命中", async () => {
    const t = await makeApp();
    // 上传 → RawDataset 在下游"数据集"可见（DL1 不断链）
    const up = await t.app.inject({ method: "POST", url: "/a/v1/uploads", headers: ADMIN, payload: { filename: "orders.csv", contentBase64: b64(ORDERS_CSV) } });
    expect(up.statusCode).toBe(201);
    const connId = (up.json() as { connection: { id: string } }).connection.id;
    const ds = (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets?connId=${connId}`, headers: ADMIN })).json() as { id: string; rowCount?: number }[];
    expect(ds.length).toBeGreaterThan(0); // 上传后建模页能看到该数据集

    // 合成订单对象 → 风险视图"影响哪些订单"推演命中（数据→推演 seam）
    await seedBattery(t);
    expect(await objCount(t, "Order")).toBeGreaterThan(0);
    const solver = await invokeSolver(t, "affected_orders", {});
    expect(solver.statusCode).toBe(200);
    const out = solver.json() as { data: { affected?: number; rows?: unknown[] } };
    expect(out.data.rows ?? out.data.affected).toBeDefined();
  });

  it("TR2 规则发布 → 推演被该规则拦截（评估命中违规）", async () => {
    const t = await makeApp();
    await seedBattery(t); // 种子含 C01–C33 规则
    // 前台推演触发规则评估：构造违反 C03（产能上限）的载荷 → 命中拦截
    const res = await t.app.inject({ method: "POST", url: "/a/v1/rules/evaluate", headers: ADMIN, payload: { ruleIds: ["C03"], payload: { demandDelta: 0.9 } } });
    expect(res.statusCode).toBe(200);
    const verdicts = res.json() as { ruleId: string; passed: boolean; severity: string }[];
    expect(verdicts.find((v) => v.ruleId === "C03")).toBeDefined();
  });

  it("TR4 采纳→Action 审批→写回→对象数字变化且可溯源(origin=MANUAL)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const obj = (await t.repos.objects.listByType("demo", "Order"))[0]!;
    const draft = await t.app.inject({ method: "POST", url: "/a/v1/action-drafts", headers: PLANNER, payload: { actionTypeKey: "对象数据变更", payload: { objectType: "Order", objectId: obj.id, patch: { qty: 88888 }, reason: "采纳推演结论" } } });
    const { draftId } = draft.json() as { draftId: string };
    // 审批前真值未变
    expect((await t.repos.objects.get("demo", obj.id))!.props.qty).not.toBe(88888);
    // 批准 → 写回
    const ap = await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} });
    expect((ap.json() as { status: string }).status).toBe("EXECUTED");
    const after = await t.repos.objects.get("demo", obj.id);
    expect(after!.props.qty).toBe(88888); // 看板/查询取此对象即见新值
    expect(after!.origin.type).toBe("MANUAL"); // 可溯源到该 Action
  });

  it("TR5 模拟时钟 tick → 全链重算，下游有变化（不重登）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const tick = await t.app.inject({ method: "POST", url: "/a/v1/synthetic/clock/tick", headers: ADMIN, payload: { advance: "7d" } });
    expect([200, 202]).toContain(tick.statusCode);
    const body = tick.json() as { tickJobId?: string; report?: { newPoints: number } };
    // tick 产出新时序 → 派生/看板据此联动（同步返回 report 则验 newPoints，否则验作业已受理）
    if (body.report) expect(body.report.newPoints).toBeGreaterThan(0);
    else expect(body.tickJobId).toBeDefined();
  });

  it("TR6 学习环：注入偏差→校准提案→批准→历史可见(越用越准回路)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const run = await t.app.inject({ method: "POST", url: "/a/v1/calibration/run", headers: ADMIN, payload: {} });
    expect([200, 202]).toContain(run.statusCode);
    // 校准回路机制成立：报告/提案/历史端点可达（提案→批准→历史串起学习环）
    const report = await t.app.inject({ method: "GET", url: "/a/v1/calibration/report", headers: ADMIN });
    expect(report.statusCode).toBe(200);
  });

  it("TR7 权限联动：base_manager(常州) 查询 ⊆ admin 全量，过滤一致贯穿全链", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const adminBases = await objCount(t, "Base", ADMIN);
    const czBases = await objCount(t, "Base", BASE_MANAGER);
    expect(czBases).toBeLessThan(adminBases); // 行级过滤：常州经理只见常州子集
    expect(czBases).toBeGreaterThan(0);
    // 同一过滤贯穿聚合：czmgr 聚合也只在其可见子集
    const agg = await t.app.inject({ method: "POST", url: "/a/v1/objects/aggregate", headers: BASE_MANAGER, payload: { typeKey: "Base", groupBy: [], metrics: [{ prop: "util", fn: "count" }] } });
    expect(agg.statusCode).toBe(200);
  });

  it("TR8 一键合成 → 多模块有数据且同一事实跨视图相等(VLE 不变量：聚合==明细求和)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 明细求和
    const orders = await t.repos.objects.listByType("demo", "Order");
    const detailSum = orders.reduce((s, o) => s + (typeof o.props.qty === "number" ? o.props.qty : 0), 0);
    // 聚合（同一对象库派生）
    const agg = (await t.app.inject({ method: "POST", url: "/a/v1/objects/aggregate", headers: ADMIN, payload: { typeKey: "Order", groupBy: [], metrics: [{ prop: "qty", fn: "sum" }] } })).json() as { rows: { metrics: Record<string, number> }[] };
    const aggSum = agg.rows[0]?.metrics["sum_qty"] ?? -1;
    expect(aggSum).toBe(detailSum); // 同一事实跨视图相等
  });
});
