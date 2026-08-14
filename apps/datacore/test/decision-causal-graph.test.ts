import { describe, expect, it } from "vitest";
import {
  causalDownstream,
  causalEdgesWithoutProvenance,
  CAUSAL_SEGMENTS,
  DecisionGraphSchema,
  type CausalSegment,
  type Decision,
  type DecisionGraph,
} from "@platform/contracts";
import { makeApp, seedBattery, ADMIN, debugUser, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-DECISION-CAUSAL-GRAPH · 决策因果图（Cause → Impact → Decision → Action → Result）。
 *
 * 仓主原话：「管理层真正关心的是**为什么这个决策被触发**，而不是 Agent 说了一句话。」
 *
 * 本文件是效果层四条判据的落地，逐条对应：
 *  ① **改因真的改果**（`describe` A1/A2）—— 同一套推演，只把扰动幅度改大，
 *     因果图上**指名道姓**的下游节点数值真的变，且**未受影响的分支逐字节不变**。
 *     "未受影响" 不由测试作者手点，而由 `causalDownstream()`（图自己）划出来。
 *  ② **每条边可溯**（A3）—— 每条边指得回哪条传导规则 / 哪个求解器输出。
 *  ③ **变异反证**（M1–M3）—— 把构图退化成「恒空图」「节点数值恒定」「边溯源被抹掉」，
 *     上面两条判据**必须变红**。还绿 = 判据咬的不是它声称咬的东西。
 *  ④ **诚实降级**（A4/B3）—— 某段无数据源时返回体带出**缺什么 + 要接什么**，不是安静的空数组。
 *
 * 纪律：不引入时钟/随机（R6）。全部用抽象 typeKey/stateVar/linkKey（R14 零业务常数）。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 场景：两条**互不相干**的链（这是判据①「未受影响的分支不变」得以成立的前提）
//
//   受扰链：  a1(TypeA).load --FEEDS--> b1(TypeB).load --FEEDS--> c1(TypeC).load
//   对照链：  d1(TypeD).load --FEEDS--> e1(TypeE).load
//
// 两条链的规则**按类型分开**（r_ab / r_bc / r_de），故扰动 a1 在图上无论如何到不了 e1。
// 若共用一条规则，"未受影响" 就只是"我没去看"，不是"它真没被影响"。
// ══════════════════════════════════════════════════════════════════════════

const TYPES = ["TypeA", "TypeB", "TypeC", "TypeD", "TypeE"] as const;
const BASE = { a1: { load: 0 }, b1: { load: 0 }, c1: { load: 0 }, d1: { load: 10 }, e1: { load: 0 } };

/**
 * 开三个开关。**headers 必须是那个租户自己的 admin** —— 拿 demo 的 admin 去开 otherco 的开关
 * 会被 R2 挡掉，于是 otherco 那边继续 404 `FEATURE_NOT_FOUND`；若测试只断言 `statusCode === 404`
 * 就会把「功能没开」误读成「跨租户读不到」，两件事都没验到（实测踩过一次，故此处连 code 一起断言）。
 */
const enableAll = (t: TestApp, tenant = "demo") =>
  t.app.inject({
    method: "PUT",
    url: `/a/v1/tenants/${tenant}/features`,
    headers: debugUser(tenant, "admin", "admin"),
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "decision.causal-graph": true } },
  });

async function seedGraph(t: TestApp, tenant = "demo"): Promise<void> {
  const origin = { type: "SYNTHETIC" as const, jobId: "wo-causal-graph" };
  for (const k of TYPES) {
    await t.repos.ontologyTypes.put({
      id: `otype_${k}`, tenantId: tenant, key: k, displayName: k,
      properties: [], derivedProperties: [], sourceBindings: [], version: 1, status: "ACTIVE",
    });
  }
  const objs: [string, string][] = [["a1", "TypeA"], ["b1", "TypeB"], ["c1", "TypeC"], ["d1", "TypeD"], ["e1", "TypeE"]];
  for (const [id, type] of objs) await t.repos.objects.put({ id, tenantId: tenant, type, props: {}, origin });
  const links: [string, string, string][] = [["lnk_ab", "a1", "b1"], ["lnk_bc", "b1", "c1"], ["lnk_de", "d1", "e1"]];
  for (const [id, fromId, toId] of links) {
    await t.repos.links.put({ id, tenantId: tenant, type: "FEEDS", fromId, toId, origin });
  }
  const rules = [
    { key: "r_ab", sourceTypeKey: "TypeA", targetTypeKey: "TypeB", coefficient: 0.5 },
    { key: "r_bc", sourceTypeKey: "TypeB", targetTypeKey: "TypeC", coefficient: 0.4 },
    { key: "r_de", sourceTypeKey: "TypeD", targetTypeKey: "TypeE", coefficient: 0.3 },
  ];
  for (const r of rules) {
    const res = await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN,
      payload: { ...r, sourceStateVar: "load", viaLinkKey: "FEEDS", targetStateVar: "load", delayTicks: 0, status: "PUBLISHED" },
    });
    expect(res.statusCode).toBe(201);
  }
}

/**
 * 跑一次完整推演并取回因果图。
 *
 * ⚠ 扰动的 `startTick` **必须落在未来**（这里 = 2）：建单时已生效的扰动由路由
 * `simApplyAtCurrentTick` 直接施加，那条路**原样保留旧 trace、不写新 trace**（`app.ts` 原注释），
 * 于是它在世界上真的落了地却在 trace 上无痕 —— 构图器只能出 CAUSE 节点、出不了下游边（落 caveat）。
 * 要驱动**引擎**施加、从而拿到落地 trace 行，就得让 `producedTick === startTick` 由 tick 循环达成。
 */
async function runScenario(t: TestApp, magnitude: number): Promise<DecisionGraph> {
  const sid = (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: BASE } })).json().id as string;
  const created = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
    payload: { kind: "capacity_loss", targetObjectId: "a1", targetStateVar: "load", magnitude, mode: "set", startTick: 2, durationTicks: null, label: `把 a1.load 设为 ${magnitude}` },
  });
  expect(created.statusCode).toBe(201);
  const ticked = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 3 } });
  expect(ticked.statusCode).toBe(200);
  const res = await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/sim/${sid}`, headers: ADMIN });
  expect(res.statusCode).toBe(200);
  // 路由回来的东西必须**真的**是一张合法因果图（superRefine 四条门在这里生效，不是摆设）。
  return DecisionGraphSchema.parse(res.json());
}

const nodeOf = (g: DecisionGraph, id: string) => g.nodes.find((n) => n.nodeId === id);
const valueOf = (g: DecisionGraph, id: string): number | null | undefined => nodeOf(g, id)?.value;
const causeNode = (g: DecisionGraph) => g.nodes.find((n) => n.segment === "CAUSE")!;

// ══════════════════════════════════════════════════════════════════════════
// § 判据①的**唯一实现**（正例与三个变异体共用同一支）
//
// 共用是本单的硬要求，不是省事：铁律 0.6 已把「金丝雀与主逻辑各抄一份正则」定性为装饰品 ——
// 变异体若走另一支断言，改主断言时变异体拿旧的去测、照样绿。
// ══════════════════════════════════════════════════════════════════════════

/**
 * 判据①：改因 → 果真的变，且**图自己划出的**未受影响分支逐字节不变。
 * 违反即 throw（`expect` 断言失败会抛），供 `expect(fn).toThrow()` 反向验证。
 */
function assertCauseChangesEffect(gSmall: DecisionGraph, gLarge: DecisionGraph): void {
  // (a) 因变了：CAUSE 节点的幅度确实是两个不同的数（前提，不是结论）。
  expect(causeNode(gSmall).value).toBe(100);
  expect(causeNode(gLarge).value).toBe(200);

  // (b) 果真的变 —— **指名道姓哪个节点、哪个数**（不是"某个下游变了"这种可以蒙混的说法）：
  //     链路 a1 --r_ab(0.5)--> b1 --r_bc(0.4)--> c1，扰动在 t2 落地并当 tick 起传导。
  //     t2: b1 = 0.5M；t3: b1 = 0.5M + 0.5M = M，c1 = 0.4 × (t2 的 b1 = 0.5M) = 0.2M。
  expect(valueOf(gSmall, "imp:a1.load@t2")).toBe(100);
  expect(valueOf(gLarge, "imp:a1.load@t2")).toBe(200);
  expect(valueOf(gSmall, "imp:b1.load@t2")).toBe(50); // 0.5 × 100
  expect(valueOf(gLarge, "imp:b1.load@t2")).toBe(100); // 0.5 × 200
  expect(valueOf(gSmall, "imp:b1.load@t3")).toBe(100); // 100 = M
  expect(valueOf(gLarge, "imp:b1.load@t3")).toBe(200);
  expect(valueOf(gSmall, "imp:c1.load@t3")).toBe(20); // 0.2 × 100 —— 隔了两跳的末端节点
  expect(valueOf(gLarge, "imp:c1.load@t3")).toBe(40); // 0.2 × 200
  // 幅度翻倍 ⇒ 末端节点也翻倍（不只是"变了"，是按传导系数**真算**着变）。
  expect(valueOf(gLarge, "imp:c1.load@t3")).toBe(2 * (valueOf(gSmall, "imp:c1.load@t3") as number));

  // (c) 未受影响的分支**逐字节不变** —— "未受影响" 由图自己划：
  //     对照链 d1→e1 的节点必须**不在** CAUSE 的前向可达集里。
  const reachSmall = causalDownstream(gSmall, causeNode(gSmall).nodeId);
  const reachLarge = causalDownstream(gLarge, causeNode(gLarge).nodeId);
  for (const id of ["imp:d1.load@t1", "imp:d1.load@t2", "imp:e1.load@t2", "imp:e1.load@t3"]) {
    expect(reachSmall).not.toContain(id);
    expect(reachLarge).not.toContain(id);
  }
  // …而受扰链的末端必须**在**可达集里（否则上面那条"不在"是同义反复：图里根本没边）。
  expect(reachSmall).toContain("imp:c1.load@t3");
  expect(reachLarge).toContain("imp:c1.load@t3");

  // 对照链逐节点数值全等（d1 恒 10 ⇒ e1 每 tick +3：t2=6, t3=9）。
  expect(valueOf(gSmall, "imp:e1.load@t2")).toBe(6);
  expect(valueOf(gSmall, "imp:e1.load@t3")).toBe(9);
  expect(valueOf(gLarge, "imp:e1.load@t2")).toBe(6);
  expect(valueOf(gLarge, "imp:e1.load@t3")).toBe(9);
  // 逐字节：把两张图上「非可达」的那部分抽出来对比，必须完全一样。
  const untouched = (g: DecisionGraph, reach: string[]) =>
    JSON.stringify(g.nodes.filter((n) => n.segment === "IMPACT" && !reach.includes(n.nodeId)).map((n) => [n.nodeId, n.value]));
  expect(untouched(gLarge, reachLarge)).toBe(untouched(gSmall, reachSmall));
}

/** 判据②：每条边指得回它的来源（且量化边必须说清是哪条规则/求解器算的）。 */
function assertEveryEdgeTraceable(g: DecisionGraph, expectProducers: string[]): void {
  expect(g.edges.length).toBeGreaterThan(0);
  expect(causalEdgesWithoutProvenance(g)).toEqual([]);
  for (const e of g.edges) {
    expect(e.provenance.refId.length).toBeGreaterThan(0);
    expect(e.provenance.detail.length).toBeGreaterThan(0);
  }
  // 指得回**具体哪条**规则/求解器 —— 不是"有个非空字符串"就算过。
  const producers = new Set(g.edges.map((e) => e.provenance.producedBy).filter((x): x is string => x !== null));
  for (const p of expectProducers) expect([...producers]).toContain(p);
}

// ══════════════════════════════════════════════════════════════════════════
describe("WO-DECISION-CAUSAL-GRAPH · A 沙盘源（Cause/Impact 真值抽取）", () => {
  it("A0 暗发 entitlement（R3 先于 authz）：未开的租户 → 两条路由全 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    const H = debugUser("freshco", "admin", "admin");
    for (const url of ["/a/v1/causal-graphs/sim/whatever", "/a/v1/causal-graphs/decision/whatever"]) {
      const r = await t.app.inject({ method: "GET", url, headers: H });
      expect(r.statusCode).toBe(404);
      expect(r.json().error.code).toBe("FEATURE_NOT_FOUND");
    }
    // ⚠ demo 租户**不是** FEATURE_NOT_FOUND —— 这不是漏开，是本仓既有的分层语义，写死在这里免得下一个人误判：
    //   `defaultOn:false` 只管住 L1 平台默认；demo 的 industry 是 `battery-manufacturing`，其模板是
    //   「all on 减去两个显式暗发集合」（`features.ts templateFeatures`）。而那两个集合的注释原文写着
    //   「**产品分档特性（sim.* / opt.* 等）不在此列，照常随模板开**」—— 本 flag 与 sim.* 同属产品分档，
    //   故遵既有约定不进暗发集合。判据：它与 `sim.sandbox` 在 demo 上的可见性**必须一致**；
    //   若哪天要求 demo 也看不见，那是改暗发集合（跨切面），不是改本 flag 的 defaultOn。
    const simVisible = await t.services.features.enabled("demo", "sim.sandbox");
    const cgVisible = await t.services.features.enabled("demo", "decision.causal-graph");
    expect(cgVisible).toBe(simVisible);
    const r2 = await t.app.inject({ method: "GET", url: "/a/v1/causal-graphs/sim/whatever", headers: ADMIN });
    expect(r2.statusCode).toBe(404);
    expect(r2.json().error.code).toBe(cgVisible ? "NOT_FOUND" : "FEATURE_NOT_FOUND");
    await t.app.close();
  });

  it("A1+A2 判据①【改因真的改果】：扰动 100→200，c1@t3 由 20→40，对照链 e1 逐字节不变", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedGraph(t);
    const gSmall = await runScenario(t, 100);
    const gLarge = await runScenario(t, 200);
    assertCauseChangesEffect(gSmall, gLarge);
    await t.app.close();
  });

  it("A3 判据②【每条边可溯】：每条传导边指回具体 PropagationRule.key，扰动边指回 perturbation:<id>", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedGraph(t);
    const g = await runScenario(t, 100);
    assertEveryEdgeTraceable(g, ["r_ab", "r_bc", "r_de"]);

    // 扰动落地边：kind=CAUSE_TO_IMPACT，producedBy 是引擎写的溯源键 `perturbation:<扰动 id>`。
    const cause = causeNode(g);
    const landing = g.edges.filter((e) => e.kind === "CAUSE_TO_IMPACT");
    expect(landing.length).toBe(1);
    expect(landing[0]!.fromNodeId).toBe(cause.nodeId);
    expect(landing[0]!.toNodeId).toBe("imp:a1.load@t2");
    expect(landing[0]!.provenance.producedBy).toBe(`perturbation:${cause.provenance.refId}`);
    expect(landing[0]!.amount).toBe(100);

    // 一条具体的传导边：溯源 detail 里必须带得出**可复算的原文**（系数、链路、搬运量）。
    const bc = g.edges.find((e) => e.toNodeId === "imp:c1.load@t3")!;
    expect(bc.provenance.producedBy).toBe("r_bc");
    expect(bc.fromNodeId).toBe("imp:b1.load@t2");
    expect(bc.amount).toBe(20); // 0.4 × 50
    expect(bc.provenance.detail).toContain("r_bc");
    expect(bc.provenance.detail).toContain("0.4");
    expect(bc.provenance.refId).toContain("b1->c1");
    await t.app.close();
  });

  it("A4 判据④【诚实降级】：沙盘上没有的三段带出 missing+needs，不是安静的空数组", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedGraph(t);
    const g = await runScenario(t, 100);

    // CAUSE / IMPACT 有真值 ⇒ 不许再声明缺口（schema superRefine ② 已锁，这里再钉一次形状）。
    expect(g.segmentCounts.CAUSE).toBe(1);
    expect(g.segmentCounts.IMPACT).toBeGreaterThan(0);
    // 其余三段一个节点都没有 ⇒ **必须**逐段说清缺什么、要接什么。
    for (const seg of ["DECISION", "ACTION", "RESULT"] as CausalSegment[]) {
      expect(g.segmentCounts[seg]).toBe(0);
      const gap = g.segmentGaps.find((x) => x.segment === seg);
      expect(gap, `段 ${seg} 为空却没有 segmentGaps 条目 —— 空白会被当成"没问题"`).toBeDefined();
      expect(gap!.reason).toBe("NO_SOURCE_WIRED"); // 三分法：这是"没接线"，不是"接了线没数据"
      expect(gap!.missing.length).toBeGreaterThan(20);
      expect(gap!.needs.length).toBeGreaterThan(20);
    }
    // DECISION 段的缺口必须**指名道姓**说清今天为什么接不上（而不是"暂无数据"）。
    const dec = g.segmentGaps.find((x) => x.segment === "DECISION")!;
    expect(dec.missing).toContain("loadContext");
    expect(dec.missing).toContain("detectChainImpediments");
    // ACTION 段：ActionDraft 上没有 sessionId 这条实测事实必须写在返回体里。
    expect(g.segmentGaps.find((x) => x.segment === "ACTION")!.missing).toContain("sessionId");
    await t.app.close();
  });

  it("A5 R2 跨租户 404 + R6 确定性（同一 session 两次取图逐字节一致·无时钟无随机）", async () => {
    const t = await makeApp();
    await enableAll(t);
    await enableAll(t, "otherco");
    await seedGraph(t);
    const sid = (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: BASE } })).json().id as string;
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 2 } });

    const other = debugUser("otherco", "admin", "admin");
    // 先自证 otherco 的开关**真的开了** —— 否则下面的 404 只是"功能没开"，验不到 R2。
    expect((await t.app.inject({ method: "GET", url: "/a/v1/sim/sessions", headers: other })).statusCode).toBe(200);
    const cross = await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/sim/${sid}`, headers: other });
    expect(cross.statusCode).toBe(404);
    expect(cross.json().error.code).toBe("NOT_FOUND"); // 统一错误信封 {error:{code,message,requestId}}
    expect(cross.json().error.requestId).toBeDefined();

    const a = await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/sim/${sid}`, headers: ADMIN });
    const b = await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/sim/${sid}`, headers: ADMIN });
    expect(a.body).toBe(b.body);
    // 这个 session 一条扰动都没有 ⇒ CAUSE 段是「接了线没数据」而**不是**「没接线」（三分法不许混）。
    const g = DecisionGraphSchema.parse(a.json());
    expect(g.segmentCounts.CAUSE).toBe(0);
    expect(g.segmentGaps.find((x) => x.segment === "CAUSE")!.reason).toBe("SOURCE_EMPTY");
    expect(g.segmentGaps.find((x) => x.segment === "DECISION")!.reason).toBe("NO_SOURCE_WIRED");
    await t.app.close();
  });

  it("A6 边级诚实缺口：路由施加的扰动（startTick=当前 tick）在 trace 上无痕 → 出 CAUSE 节点、不出边、caveats 说明为什么", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedGraph(t);
    const sid = (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: BASE } })).json().id as string;
    // 不传 startTick ⇒ 默认当前 tick ⇒ 走 simApplyAtCurrentTick（不写 trace）。
    const created = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: { kind: "capacity_loss", targetObjectId: "a1", targetStateVar: "load", magnitude: 100, mode: "set", label: "路由直接施加" },
    });
    const pid = created.json().perturbation.id as string;
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    const g = DecisionGraphSchema.parse((await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/sim/${sid}`, headers: ADMIN })).json());

    // CAUSE 节点在（扰动是真的发生了），但它**没有**任何出边。
    expect(g.segmentCounts.CAUSE).toBe(1);
    expect(g.edges.filter((e) => e.fromNodeId === `cause:${pid}`)).toEqual([]);
    // …而缺口必须写在 caveats 里，指名道姓是哪条扰动、为什么补不出边。
    const cav = g.caveats.find((c) => c.includes(pid));
    expect(cav, "路由施加的扰动没有落地 trace，却没有任何 caveat 说明 —— 这就是'诚实位在说谎'").toBeDefined();
    expect(cav!).toContain("simApplyAtCurrentTick");
    // 对照：世界态确实被改了（扰动真落了地），所以"没边"不是"没发生"。
    const world = (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/world`, headers: ADMIN })).json();
    expect(world.state.a1.load).toBe(100);
    await t.app.close();
  });

  /**
   * A7 —— **这条是亲手跑真链路撞出来的**，不是先写测试再写代码。
   *
   * 上面 A1 那条链（3 tick、扰动落地当 tick 就到末端）恰好全连通，于是"图是断的"这件事照不到。
   * 真跑 demo 种子链（`SEED_DEMO=1` 的 `Order.demandPressure → Model → Base → Line`，跑 5 tick）时：
   * **48 个节点数值随扰动真的变了，却掉在 `causalDownstream(cause)` 之外** —— 图上看它们与扰动无关。
   * 根因之一：引擎只在扰动**首次生效**那一 tick 写落地 trace，此后它仍按住那个值却无任何 trace 行 ⇒
   * 目标格在 t+1、t+2… 只作为源出现、没有入边，链条从那里断掉，下游全部跟着掉出可达集。
   *
   * 本例把那个条件**最小化复现**：扰动 t2 落地、`durationTicks:null`、跑到 t5。
   * 没有「值延续」边时，`c1.load@t5` 必然不可达（老实现在此处会红）。
   */
  it("A7 持续扰动跨多 tick：值延续边把链接上 —— 末端节点仍在可达集内（真跑撞出来的断链回归）", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedGraph(t);
    const sid = (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: BASE } })).json().id as string;
    await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: { kind: "capacity_loss", targetObjectId: "a1", targetStateVar: "load", magnitude: 100, mode: "set", startTick: 2, durationTicks: null, label: "持续停机" },
    });
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 5 } });
    const g = DecisionGraphSchema.parse((await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/sim/${sid}`, headers: ADMIN })).json());

    const reach = causalDownstream(g, causeNode(g).nodeId);
    // 扰动落点在 t3/t4 没有任何 trace 行（引擎只在首次生效写），靠「值延续」边接上。
    for (const id of ["imp:a1.load@t2", "imp:a1.load@t3", "imp:a1.load@t4"]) expect(reach).toContain(id);
    // …末端节点在最后一 tick 仍追得回这次扰动（没有延续边时这里必红）。
    expect(reach).toContain("imp:c1.load@t5");
    // 逐 tick 手算（`combine:"sum"` 是**累加**不是覆盖 —— 这里第一版写成 20 被测试当场顶回来）：
    //   b1: t2=0.5×100=50 → t3=100 → t4=150 → t5=200
    //   c1: t3=0.4×b1@t2=20 → t4=20+0.4×100=60 → t5=60+0.4×150=120
    expect(valueOf(g, "imp:b1.load@t4")).toBe(150);
    expect(valueOf(g, "imp:c1.load@t5")).toBe(120);

    // 延续边必须**说清凭什么**：三条判据（扰动仍生效 / 本 tick 无人写 / 值真的相等）写在 detail 里。
    const hold = g.edges.find((e) => e.edgeId.startsWith("e:hold:") && e.toNodeId === "imp:a1.load@t3")!;
    expect(hold).toBeDefined();
    expect(hold.amount).toBeNull(); // 延续不搬量，写 0 会被读成"传了个 0"
    expect(hold.provenance.detail).toContain("isPerturbationActiveAt");
    expect(hold.provenance.detail).toContain("无任何 trace 行写过这一格");

    // 变异反证：把延续边全部拿掉 → 末端节点当场掉出可达集（证明这条边真的在承重）。
    const without = { ...g, edges: g.edges.filter((e) => !e.edgeId.startsWith("e:hold:")) };
    expect(causalDownstream(without, causeNode(g).nodeId)).not.toContain("imp:c1.load@t5");
    await t.app.close();
  });

  it("A8 连通性自检写进返回体：延迟规则造成的断点被机器数出来（不靠人读图去发现）", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedGraph(t);
    // 再加一条 **delayTicks=1** 的规则 c1 → 另一个类型：延迟到达行不带 fromObjectId ⇒ 补不出入边。
    await t.repos.ontologyTypes.put({
      id: "otype_TypeF", tenantId: "demo", key: "TypeF", displayName: "TypeF",
      properties: [], derivedProperties: [], sourceBindings: [], version: 1, status: "ACTIVE",
    });
    const origin = { type: "SYNTHETIC" as const, jobId: "wo-causal-graph" };
    await t.repos.objects.put({ id: "f1", tenantId: "demo", type: "TypeF", props: {}, origin });
    await t.repos.links.put({ id: "lnk_cf", tenantId: "demo", type: "FEEDS", fromId: "c1", toId: "f1", origin });
    await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN,
      payload: { key: "r_cf", sourceTypeKey: "TypeC", sourceStateVar: "load", viaLinkKey: "FEEDS", targetTypeKey: "TypeF", targetStateVar: "load", coefficient: 0.5, delayTicks: 1, status: "PUBLISHED" },
    });
    const sid = (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: { ...BASE, f1: { load: 0 } } } })).json().id as string;
    await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: { kind: "capacity_loss", targetObjectId: "a1", targetStateVar: "load", magnitude: 100, mode: "set", startTick: 2, durationTicks: null, label: "持续停机" },
    });
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 6 } });
    const g = DecisionGraphSchema.parse((await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/sim/${sid}`, headers: ADMIN })).json());

    // f1 的值确实被扰动改了（延迟一跳到达）：贡献在 beforeTick=3 由 c1@t3(=20) 算出 = 10，
    // arriveTick=4，在 beforeTick=4 那轮结算 ⇒ 落在 t5 这一行。
    expect(valueOf(g, "imp:f1.load@t5")).toBe(10);
    // ……但它**追不回因**（DelayedContribution 不记 fromObjectId），且这件事必须写在返回体里。
    expect(causalDownstream(g, causeNode(g).nodeId)).not.toContain("imp:f1.load@t5");
    const orphanCaveat = g.caveats.find((c) => c.startsWith("连通性自检"));
    expect(orphanCaveat, "图是断的，返回体却一个字都不说 —— 这就是'诚实位在说谎'").toBeDefined();
    expect(orphanCaveat!).toContain("没有任何入边");
    const delayCaveat = g.caveats.find((c) => c.includes("r_cf") && c.includes("fromObjectId"));
    expect(delayCaveat, "延迟贡献补不出入边的原因必须指名到具体规则").toBeDefined();
    // 聚合而非逐条：一条规则只出一条 caveat（实测真种子链一次推演会产生 40 条延迟到达，逐条报会刷屏）。
    expect(g.caveats.filter((c) => c.includes("r_cf") && c.includes("fromObjectId")).length).toBe(1);
    await t.app.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("WO-DECISION-CAUSAL-GRAPH · M 变异反证（判据必须能红）", () => {
  /** 三个变异体全部作用在**真构图器的输出**上 —— 与正例共用同一支断言（见上文注释）。 */
  const mutantEmpty = (g: DecisionGraph): DecisionGraph => ({
    ...g,
    nodes: [],
    edges: [],
    segmentCounts: Object.fromEntries(CAUSAL_SEGMENTS.map((s) => [s, 0])) as Record<CausalSegment, number>,
  });
  const mutantConstValue = (g: DecisionGraph): DecisionGraph => ({ ...g, nodes: g.nodes.map((n) => ({ ...n, value: n.segment === "CAUSE" ? n.value : 1 })) });
  const mutantNoProvenance = (g: DecisionGraph): DecisionGraph => ({
    ...g,
    edges: g.edges.map((e) => ({ ...e, provenance: { ...e.provenance, producedBy: null } })),
  });

  it("M1 恒返回空图 → 判据①【改因改果】变红（正例同一支断言，绿的那支必须在这里抛）", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedGraph(t);
    const gSmall = await runScenario(t, 100);
    const gLarge = await runScenario(t, 200);
    expect(() => assertCauseChangesEffect(gSmall, gLarge)).not.toThrow(); // 先证明正例是绿的
    expect(() => assertCauseChangesEffect(mutantEmpty(gSmall), mutantEmpty(gLarge))).toThrow();
    await t.app.close();
  });

  it("M2 节点数值恒定 → 判据①变红（幅度翻倍但末端节点纹丝不动 ⇒ 因果被掐断）", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedGraph(t);
    const gSmall = await runScenario(t, 100);
    const gLarge = await runScenario(t, 200);
    expect(() => assertCauseChangesEffect(mutantConstValue(gSmall), mutantConstValue(gLarge))).toThrow();
    await t.app.close();
  });

  it("M3 抹掉边的 producedBy → 判据②【每条边可溯】变红", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedGraph(t);
    const g = await runScenario(t, 100);
    expect(() => assertEveryEdgeTraceable(g, ["r_ab", "r_bc", "r_de"])).not.toThrow(); // 正例绿
    const mutated = mutantNoProvenance(g);
    expect(() => assertEveryEdgeTraceable(mutated, ["r_ab"])).toThrow();
    // 具体红在哪：量化边失去了"哪条规则算的" ⇒ 纯函数当场点名。
    expect(causalEdgesWithoutProvenance(mutated).length).toBeGreaterThan(0);
    await t.app.close();
  });

  it("M4 契约门变异：空段不给 missing/needs → schema 当场抛（诚实缺席不是靠自觉）", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedGraph(t);
    const g = await runScenario(t, 100);
    // 把 DECISION 段的缺口条目删掉，其余原样 —— 一个"看着干净"的返回体。
    const lying = { ...g, segmentGaps: g.segmentGaps.filter((x) => x.segment !== "DECISION") };
    expect(() => DecisionGraphSchema.parse(lying)).toThrow(/DECISION/);
    // 反向：有节点的段却声明缺口 → 同样抛（自相矛盾）。
    const contradiction = { ...g, segmentGaps: [...g.segmentGaps, { segment: "IMPACT" as const, reason: "SOURCE_EMPTY" as const, missing: "x".repeat(30), needs: "y".repeat(30) }] };
    expect(() => DecisionGraphSchema.parse(contradiction)).toThrow(/IMPACT/);
    // 悬空边 → 抛。
    const dangling = { ...g, edges: [...g.edges, { ...g.edges[0]!, edgeId: "e:ghost", fromNodeId: "nope" }] };
    expect(() => DecisionGraphSchema.parse(dangling)).toThrow(/悬空边/);
    // 段序倒流（把一条 IMPACT→IMPACT 边谎称成 DECISION→ACTION）→ 抛。
    const backwards = { ...g, edges: [...g.edges.slice(1), { ...g.edges[0]!, kind: "DECISION_TO_ACTION" as const }] };
    expect(() => DecisionGraphSchema.parse(backwards)).toThrow(/DECISION/);
    await t.app.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("WO-DECISION-CAUSAL-GRAPH · B 台账源（Decision → 五段全覆盖）", () => {
  const METRIC = "seg_attain_ess";
  const SVC: AuthCtx = { tenantId: "demo", userId: "u-admin", roles: ["admin"], attributes: {} };

  async function makeDecision(t: TestApp): Promise<Decision> {
    const dp = (await t.services.solvers.invoke(SVC, "decision_play", { metricKey: METRIC })) as unknown as { options: { optionId: string }[] };
    const chosen = [dp.options[0]!.optionId];
    return (await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: { metricKey: METRIC, chosenOptionIds: chosen } })).json() as Decision;
  }

  it("B1 五段接线：根因 → 指标缺口 → 决策 → 方案；★「为什么这个决策被触发」那条边带得出触发量", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedBattery(t);
    const dec = await makeDecision(t);
    const res = await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/decision/${dec.id}`, headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const g = DecisionGraphSchema.parse(res.json());

    expect(g.source).toEqual({ kind: "decision", refId: dec.id });
    expect(g.segmentCounts.CAUSE).toBeGreaterThan(0);
    expect(g.segmentCounts.IMPACT).toBe(1);
    expect(g.segmentCounts.DECISION).toBe(1);
    expect(g.segmentCounts.ACTION).toBeGreaterThan(0);

    // ★ IMPACT → DECISION：这条边就是「为什么这个决策被触发」的答案，且必须带得出**那个数**。
    const trigger = g.edges.find((e) => e.kind === "IMPACT_TO_DECISION")!;
    expect(trigger).toBeDefined();
    expect(trigger.amount).toBe(dec.rootRef.rootMetric.gap);
    expect(trigger.provenance.producedBy).toBe("gap_attribution"); // 指得回哪个求解器
    expect(trigger.provenance.detail).toContain(dec.rootRef.rootMetric.key);
    // 缺口节点的数就是台账里的那个数（不是构图器另算的）。
    expect(g.nodes.find((n) => n.segment === "IMPACT")!.value).toBe(dec.rootRef.rootMetric.gap);
    // 判据②同样适用于台账源：每条边指得回真求解器 / 真产物。
    assertEveryEdgeTraceable(g, ["gap_attribution", "decision_play"]);
    await t.app.close();
  });

  it("B2 ★预言不许冒充实测：closesGap 挂在 ACTION 节点上，RESULT 段仍是 NOT_YET_REALIZED", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedBattery(t);
    const dec = await makeDecision(t);
    const g = DecisionGraphSchema.parse((await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/decision/${dec.id}`, headers: ADMIN })).json());

    const chosenOpt = dec.optionsRef.options.find((o) => o.optionId === dec.chosenOptionIds[0])!;
    const actionNode = g.nodes.find((n) => n.nodeId === `action:opt:${chosenOpt.optionId}`)!;
    expect(actionNode.value).toBe(chosenOpt.closesGap); // 预言值在 ACTION 段
    expect(actionNode.provenance.detail).toContain("预言"); // 且明写它是预言
    expect(actionNode.provenance.producedBy).toBe("decision_play");

    // RESULT 段一个节点都没有，且原因必须是 NOT_YET_REALIZED（"还没到"，不是"没接线"也不是"没数据"）。
    expect(g.segmentCounts.RESULT).toBe(0);
    const gap = g.segmentGaps.find((x) => x.segment === "RESULT")!;
    expect(gap.reason).toBe("NOT_YET_REALIZED");
    expect(gap.needs).toContain(`/a/v1/decisions/${dec.id}/outcome`);
    // 缺口文案必须把「预言没被搬进 RESULT」这件事说出来（读图的人最容易在这里误会）。
    expect(gap.missing).toContain("预言");
    // 真验一遍：RESULT 段没有任何节点携带 closesGap 这个数。
    expect(g.nodes.filter((n) => n.segment === "RESULT" && n.value === chosenOpt.closesGap)).toEqual([]);
    await t.app.close();
  });

  it("B3 实测回填后 RESULT 段真的长出来（同一条决策，改的只是 outcome）", async () => {
    const t = await makeApp();
    await enableAll(t);
    await seedBattery(t);
    const dec = await makeDecision(t);
    const before = DecisionGraphSchema.parse((await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/decision/${dec.id}`, headers: ADMIN })).json());
    expect(before.segmentCounts.RESULT).toBe(0);

    await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/commit`, headers: ADMIN });
    const predicted = dec.optionsRef.options.find((o) => o.optionId === dec.chosenOptionIds[0])!.closesGap;
    const realizedGapClose = Math.round(predicted * 0.8 * 100) / 100; // 外部注入的实测（非系统自造）
    const realized = (await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/outcome`, headers: ADMIN, payload: { realizedGapClose, note: "运营回填" } })).json() as Decision;
    expect(realized.status).toBe("REALIZED");

    const after = DecisionGraphSchema.parse((await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/decision/${dec.id}`, headers: ADMIN })).json());
    expect(after.segmentCounts.RESULT).toBe(2); // 实测补缺口 + 效果%
    expect(after.segmentGaps.find((x) => x.segment === "RESULT")).toBeUndefined(); // 有节点了就不许再声明缺口
    expect(after.nodes.find((n) => n.nodeId === `result:${dec.id}:realizedGapClose`)!.value).toBe(realizedGapClose);
    expect(after.nodes.find((n) => n.nodeId === `result:${dec.id}:effectivenessPct`)!.value).toBe(realized.outcome!.effectivenessPct);
    // ACTION → RESULT 边存在，且**不带数值**（实测是全体选定方案的合计，按预言比例摊出来的归属是假的）。
    const ar = after.edges.filter((e) => e.kind === "ACTION_TO_RESULT");
    // 咬死条数而不是 `> 0`：每个选定方案 × 每个 RESULT 节点各一条边（实测 1 × 2 = 2）。
    // 只写 `> 0` 时「只连了第一个选定方案 / 只连到第一个结果节点」与「全连上了」同色 ——
    // 而漏连正是这条边最可能的错法。
    expect(ar.length).toBe(dec.chosenOptionIds.length * after.segmentCounts.RESULT);
    for (const e of ar) {
      expect(e.amount).toBeNull();
    }
    await t.app.close();
  });

  it("B4 R2 跨租户 404 + R6 确定性（同一决策两次取图逐字节一致）", async () => {
    const t = await makeApp();
    await enableAll(t);
    await enableAll(t, "otherco");
    await seedBattery(t);
    const dec = await makeDecision(t);
    const cross = await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/decision/${dec.id}`, headers: debugUser("otherco", "admin", "admin") });
    expect(cross.statusCode).toBe(404);
    const a = await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/decision/${dec.id}`, headers: ADMIN });
    const b = await t.app.inject({ method: "GET", url: `/a/v1/causal-graphs/decision/${dec.id}`, headers: ADMIN });
    expect(a.body).toBe(b.body);
    await t.app.close();
  });
});
