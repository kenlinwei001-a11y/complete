import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, submitQuery, waitForTask, PLANNER, type TestApp } from "./helpers.js";
import { entitySimilarity, nearestEntities } from "../src/router/slots.js";
import { resetPerceptionMetrics } from "../src/router/perception-metrics.js";
import type { OntologyClient, ToolAuthCtx } from "../src/tools/clients.js";

/**
 * A5 感知层·实体域外信号（PRD to-do consider「感知层+本体校验」）。
 *
 * 故事脚本（~100 字）：常州基地的规划员小李在驾驶舱里连问四句——先问"苏州基地停产影响哪些订单"
 * （口误，本租户无苏州基地），再问"杭州的订单交付受什么影响"（同样域外），接着正确问"常州停产影响
 * 哪些订单"（命中），最后又把"长州"打错一个字。系统应：对三次域外实体各发一条 entity.out_of_domain
 * 事件并给出最近邻候选（常州），对命中的一次不发；埋点累计误触发率 = 域外/objectRef 解析尝试。
 */
describe("A5 感知层·实体域外信号 + 最近邻候选 + 误触发率埋点", () => {
  let t: TestApp;
  beforeEach(async () => {
    resetPerceptionMetrics();
    t = await createTestApp();
  });
  afterEach(() => resetPerceptionMetrics());

  /** 让分类器把 affected_orders 意图的 base 槽位抽成给定实体（驱动 objectRef 解析）。 */
  function askBase(query: string, base: string) {
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: { base },
    });
    // 域外 → 进澄清前不到路径B；命中 → 走路径A 求解。命中分支需要时由各用例自理。
    return submitQuery(t, PLANNER, query, { view: "risk", selectedObjects: [] });
  }

  it("纯函数：编辑距离相似度 + 子串包含对 CJK/拉丁稳定（确定性 R6）", () => {
    expect(entitySimilarity("常州", "常州")).toBe(1);
    expect(entitySimilarity("苏州", "常州")).toBeCloseTo(0.5, 5); // 一字之差
    expect(entitySimilarity("常州", "常州基地")).toBeCloseTo(0.5, 5); // 子串包含
    expect(entitySimilarity("成都", "常州")).toBe(0); // 毫不相干
    // 对称性 + 空串守护
    expect(entitySimilarity("a", "")).toBe(0);
    expect(entitySimilarity("4680-NCM", "4680-LFP")).toBeGreaterThan(0.5);
  });

  it("最近邻预言机：对域外裸串跨已发布类型取相似候选，命中的真实基地排首位", async () => {
    const ont = t.dataCore.ontology as unknown as OntologyClient;
    const ctx = { tenantId: "tenant-battery", userId: "u", roles: ["planner"] } as unknown as ToolAuthCtx;
    const cands = await nearestEntities("苏州", ont, ctx);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]!.label).toBe("常州"); // 苏州→常州（共享"州"，一字之差）
    expect(cands[0]!.score).toBeGreaterThanOrEqual(0.34);
    // 候选去到真实对象类型（Base），分数降序确定性
    expect(cands[0]!.objectType).toBe("Base");
    for (let i = 1; i < cands.length; i++) expect(cands[i - 1]!.score).toBeGreaterThanOrEqual(cands[i]!.score);
  });

  it("域外实体 → 发 entity.out_of_domain 事件，payload 带最近邻候选（常州）", async () => {
    const { taskId } = await askBase("苏州基地停产影响哪些订单", "苏州");
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("AWAITING_CLARIFICATION"); // base 解析不到 → 仍缺 → 澄清
    const events = await t.repos.events.listAfter(taskId, 0);
    const ood = events.find((e) => e.event === "entity.out_of_domain");
    expect(ood).toBeDefined();
    const p = ood!.payload as { slot: string; value: string; nearest: string; candidates: { label: string }[] };
    expect(p.slot).toBe("base");
    expect(p.value).toBe("苏州");
    expect(p.nearest).toBe("常州");
    expect(p.candidates.some((c) => c.label === "常州")).toBe(true);
  });

  it("命中实体（常州）→ 不发域外事件；埋点只计入分母（解析尝试）", async () => {
    const { taskId } = await askBase("常州停产影响哪些订单", "常州");
    await waitForTask(t, taskId);
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(events.some((e) => e.event === "entity.out_of_domain")).toBe(false);
    const m = (await t.app.inject({ method: "GET", url: "/api/v1/perception/metrics", headers: { "x-debug-user": encodeURIComponent(PLANNER) } })).json() as { attempts: number; outOfDomain: number };
    expect(m.attempts).toBeGreaterThanOrEqual(1);
    expect(m.outOfDomain).toBe(0);
  });

  it("整段故事：三域外+一命中 → 误触发率 = 3/4，最近域外明细带候选（租户隔离 R2）", async () => {
    // ① 苏州（域外）② 杭州（域外）③ 常州（命中）④ 长州（域外·错字）
    for (const [q, b] of [
      ["苏州基地停产影响哪些订单", "苏州"],
      ["杭州的订单交付受什么影响", "杭州"],
      ["常州停产影响哪些订单", "常州"],
      ["长州基地影响哪些订单", "长州"],
    ] as const) {
      const { taskId } = await askBase(q, b);
      await waitForTask(t, taskId);
    }
    const m = (await t.app.inject({ method: "GET", url: "/api/v1/perception/metrics", headers: { "x-debug-user": encodeURIComponent(PLANNER) } })).json() as {
      attempts: number;
      outOfDomain: number;
      falseTriggerRate: number;
      recent: { value: string; candidates: { label: string }[] }[];
    };
    expect(m.attempts).toBe(4); // 四次 objectRef 解析尝试
    expect(m.outOfDomain).toBe(3); // 苏州/杭州/长州
    expect(m.falseTriggerRate).toBeCloseTo(0.75, 4);
    // 最近域外明细（倒序）带最近邻候选，长州/苏州→常州
    const vals = m.recent.map((r) => r.value);
    expect(vals).toContain("苏州");
    expect(vals).toContain("杭州");
    expect(vals).toContain("长州");
    expect(vals).not.toContain("常州");
    const cz = m.recent.find((r) => r.value === "长州");
    expect(cz!.candidates.some((c) => c.label === "常州")).toBe(true);

    // 租户隔离：另一租户读到空埋点（R2）
    const other = (await t.app.inject({ method: "GET", url: "/api/v1/perception/metrics", headers: { "x-debug-user": encodeURIComponent("tenant-other:u2:planner") } })).json() as { attempts: number; outOfDomain: number };
    expect(other.attempts).toBe(0);
    expect(other.outOfDomain).toBe(0);
  });
});
