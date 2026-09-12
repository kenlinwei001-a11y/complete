import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import type { OntologyClient } from "../src/tools/clients.js";

const CTX = { tenantId: "tenant-demo", userId: "u1", roles: ["planner"] };

/**
 * 本文件监听的是 queryObjects 的**第 5 个**形参 `asOfEpoch` —— 它由接口
 * `src/tools/clients.ts` 的 `OntologyClient.queryObjects` 声明，但 `MockDataCore`
 * （`src/mocks/clients.ts:240`）只实现到第 4 个。TS 允许「少写形参」实现接口，
 * 于是 mock 的**具体类型**比接口窄，直接往它身上装 5 参函数会 TS2322。
 *
 * 这里先把 mock 上转成它自己实现的那个接口再打桩 —— 是**放宽到契约真实形状**，
 * 不是 `as any`（属性名写错、返回类型不符照样报）。
 */
const asOntology = (o: OntologyClient): OntologyClient => o;

/**
 * #2 回归：任务级快照读（§13.1）已接进工具层。执行器（=一次任务运行）首次 query_objects 时
 * 捕获 taskEpoch（GET /a/v1/epoch/current），后续所有读注入同一 asOfEpoch → 任务内多步读一致。
 */
describe("并发一致性 §13.1 — 工具层任务快照（#2 已接线）", () => {
  it("首读捕获 taskEpoch 一次，跨多次读复用并注入 asOfEpoch", async () => {
    const t = await createTestApp();
    let epochCalls = 0;
    const seenAsOf: (number | undefined)[] = [];
    t.dataCore.epoch.current = async () => {
      epochCalls++;
      return { epoch: 42 };
    };
    const orig = t.dataCore.ontology.queryObjects.bind(t.dataCore.ontology);
    asOntology(t.dataCore.ontology).queryObjects = async (ctx, type, filter, limit, asOfEpoch) => {
      seenAsOf.push(asOfEpoch);
      return orig(ctx, type, filter, limit);
    };

    const ex = t.deps.engine.makeExecutor("task_snap", CTX);
    const r1 = await ex.run("query_objects", { objectType: "Base", filter: {} });
    const r2 = await ex.run("query_objects", { objectType: "Order", filter: {} });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(epochCalls).toBe(1); // 任务内只捕获一次
    expect(seenAsOf).toEqual([42, 42]); // 两次读注入同一 taskEpoch
  });

  it("不同任务运行各自独立捕获（执行器实例隔离）", async () => {
    const t = await createTestApp();
    let epoch = 10;
    let calls = 0;
    t.dataCore.epoch.current = async () => {
      calls++;
      return { epoch: epoch++ };
    };
    const seen: (number | undefined)[] = [];
    const orig = t.dataCore.ontology.queryObjects.bind(t.dataCore.ontology);
    asOntology(t.dataCore.ontology).queryObjects = async (ctx, type, filter, limit, asOfEpoch) => {
      seen.push(asOfEpoch);
      return orig(ctx, type, filter, limit);
    };
    const exA = t.deps.engine.makeExecutor("task_a", CTX);
    const exB = t.deps.engine.makeExecutor("task_b", CTX);
    await exA.run("query_objects", { objectType: "Base", filter: {} });
    await exB.run("query_objects", { objectType: "Base", filter: {} });
    expect(calls).toBe(2); // 两个执行器各捕获一次
    expect(seen).toEqual([10, 11]); // 各自的 taskEpoch
  });

  it("epoch 捕获失败（DataCore 不支持）→ 读退化为活数据（asOfEpoch undefined），不报错", async () => {
    const t = await createTestApp();
    t.dataCore.epoch.current = async () => {
      throw new Error("not supported");
    };
    const seen: (number | undefined)[] = [];
    const orig = t.dataCore.ontology.queryObjects.bind(t.dataCore.ontology);
    asOntology(t.dataCore.ontology).queryObjects = async (ctx, type, filter, limit, asOfEpoch) => {
      seen.push(asOfEpoch);
      return orig(ctx, type, filter, limit);
    };
    const ex = t.deps.engine.makeExecutor("task_fail", CTX);
    const r = await ex.run("query_objects", { objectType: "Base", filter: {} });
    expect(r.ok).toBe(true); // 优雅降级
    expect(seen).toEqual([undefined]);
  });
});
