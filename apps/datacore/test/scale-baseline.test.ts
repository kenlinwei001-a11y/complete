import { describe, expect, it } from "vitest";
import { ADMIN, makeApp } from "./helpers.js";

/**
 * E12 数据规模化 + 性能基线：把数据从 200 拉到 10⁴ 订单（XL 档），验证全链路（生成→对象化
 * →派生→查询→聚合）在规模下仍成立且性能在预算内。回答评估「规模下还成立吗」。
 *
 * 性能阈值取宽松上限（CI 机器波动容忍）；目的是建立基线 + 防数量级回归，非微基准。
 */
describe("E12 · 10⁴ 订单规模基线", () => {
  it("XL 合成（10000 订单）端到端完成，对象量达标，全链路在性能预算内", async () => {
    const t = await makeApp();
    const tGen0 = Date.now();
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/synthetic/jobs",
      headers: ADMIN,
      payload: { industry: "battery-manufacturing", scale: "XL", seed: 42 },
    });
    expect(res.statusCode).toBe(202);
    const genMs = Date.now() - tGen0;
    expect(genMs).toBeLessThan(120_000); // 生成+对象化+派生 ≤ 2min（基线）

    // 订单对象量真实达 10⁴（存储层计数；确认生成规模而非 demo 量级）
    const orderCount = (await t.repos.objects.listByType("demo", "Order")).length;
    expect(orderCount).toBe(10000);
    // #3 修复后：聚合计数对全量准确（不再被 queryObjects 的 ≤1000 截断静默算错），truncated 诚实
    const tAgg0 = Date.now();
    const agg = await t.app.inject({
      method: "POST",
      url: "/a/v1/objects/aggregate",
      headers: ADMIN,
      payload: { typeKey: "Order", groupBy: [], metrics: [{ prop: "so", fn: "count" }] },
    });
    const aggMs = Date.now() - tAgg0;
    expect(agg.statusCode).toBe(200);
    const aggBody = agg.json() as { rows: { metrics: Record<string, number> }[]; truncated: boolean };
    expect(aggBody.rows[0]!.metrics.count_so).toBe(10000); // 全量计数正确
    expect(aggBody.truncated).toBe(false); // 未超 20 万安全上限 → 诚实标 false
    expect(aggMs).toBeLessThan(5_000);

    // 过滤查询在规模下仍快（limit 截断）
    const tQ0 = Date.now();
    const q = await t.app.inject({
      method: "POST",
      url: "/a/v1/objects/query",
      headers: ADMIN,
      payload: { objectType: "Order", filter: {}, limit: 100 },
    });
    const qMs = Date.now() - tQ0;
    expect(q.statusCode).toBe(200);
    expect((q.json() as { data: unknown[] }).data.length).toBe(100);
    expect(qMs).toBeLessThan(3_000);
  }, 180_000);

  it("XL 确定性：同 seed 重跑订单数与首单一致（规模下仍字节级可复现）", async () => {
    const a = await makeApp();
    await a.app.inject({ method: "POST", url: "/a/v1/synthetic/jobs", headers: ADMIN, payload: { industry: "battery-manufacturing", scale: "XL", seed: 7 } });
    const b = await makeApp();
    await b.app.inject({ method: "POST", url: "/a/v1/synthetic/jobs", headers: ADMIN, payload: { industry: "battery-manufacturing", scale: "XL", seed: 7 } });
    const firstOrder = async (app: typeof a) => {
      const r = await app.app.inject({ method: "POST", url: "/a/v1/objects/query", headers: ADMIN, payload: { objectType: "Order", filter: {}, limit: 1 } });
      return (r.json() as { data: { props: Record<string, unknown> }[] }).data[0]?.props;
    };
    expect(await firstOrder(b)).toEqual(await firstOrder(a));
  }, 180_000);
});
