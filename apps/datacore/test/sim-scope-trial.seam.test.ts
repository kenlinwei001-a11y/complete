/**
 * WO-SIM-SCOPE-TRIAL 验收门 —— 沙盘 P3（`SimSession.scope` 接读端）+ L3-a（Trial Tick 跑对栈）。
 *
 * ── 本门咬的接缝 ──────────────────────────────────────────────────────────────
 * **范围半（`SimSession.scope` 这个 record 松口袋，写端在前端）× 传导半（`propagateTick` 的图物化）**。
 * 两半此前没有连线：`scope` 写进库以后全仓只有 `snapshotKind` 一个键被读过，
 * tick 路由无条件遍历全本体 ⇒ 用户切到「局部推演」，引擎照样按 GLOBAL 全量算 ——
 * **答案是错的而页面不报错**（欠账 #129/#130 · `G-SIM-SCOPE-UNREAD`）。
 *
 * ── 判据是**效果层**，不是「函数被调用了」──────────────────────────────────────
 * 每条断言都跨过 HTTP 端点，比的是**同一份 baseSnapshot 在两个范围下跑出来的数**。
 * 「`scopePropagationGraph` 被调用了」证明不了任何事 —— 它可以调用了却原样返回。
 * 故本门只认：**同 base、同规则、同 tick 数，LOCAL 与 GLOBAL 的世界态必须不同**，
 * 且不同的位置正好是被裁掉那条边的下游。
 *
 * ── 变异反证的注入点（改哪一处会红，写明白免得下一个人猜）────────────────────
 *  · `sim/propagation.ts scopePropagationGraph` 的 LOCAL 分支 → 改成 `return { graph, … }`（原样不裁）
 *    ⇒ ①②③ 全红（LOCAL 的数会和 GLOBAL 一模一样，正是本单要根治的那个病样）。
 *  · 同函数里 `inScope.has(l.fromId) && inScope.has(l.toId)` 的 `&&` → 改 `||`
 *    ⇒ ① 红（留下一端在范围外的边 ⇒ 贡献写到范围外对象上）。
 *  · `app.ts` Trial Tick 里 `propagationRulesFired: propFired` → 改回硬写 `0`（= 本单之前的行为）
 *    ⇒ ④⑤ 红。
 *  · `contracts resolveSimScope` 的 LOCAL-无-target 分支 → 改成 `return {kind:"GLOBAL",…}`（静默降级）
 *    ⇒ ③ 红。
 */
import { describe, expect, it } from "vitest";
import { resolveSimScope, SIM_SCOPE_DEFAULT_HOPS } from "@platform/contracts";
import { scopePropagationGraph } from "../src/sim/propagation.js";
import { debugUser, makeApp, type TestApp } from "./helpers.js";

const ORG = { type: "SYNTHETIC" as const, jobId: "scope-trial-seam" };

/**
 * 抽象三点链（R14 零行业名）：`a1(TypeA) --FEEDS--> b1(TypeB) --FEEDS--> c1(TypeC)`。
 *
 * 为什么必须是**三**点而不是两点：两点图上 LOCAL(1 跳) 恰好把整张图都圈进来，
 * 与 GLOBAL 逐字节相同 ⇒ 断言恒绿而缺陷仍在（那正是"测试咬的是函数不是链路"的形态）。
 * 三点才有"范围外的下游"可丢。
 */
async function threeNodeWorld(t: TestApp, tenant: string): Promise<void> {
  for (const k of ["TypeA", "TypeB", "TypeC"]) {
    await t.repos.ontologyTypes.put({
      id: `otype_${k}_${tenant}`, tenantId: tenant, key: k, displayName: k,
      properties: [], derivedProperties: [], sourceBindings: [], version: 1, status: "ACTIVE",
    });
  }
  await t.repos.objects.put({ id: "a1", tenantId: tenant, type: "TypeA", props: {}, origin: ORG });
  await t.repos.objects.put({ id: "b1", tenantId: tenant, type: "TypeB", props: {}, origin: ORG });
  await t.repos.objects.put({ id: "c1", tenantId: tenant, type: "TypeC", props: {}, origin: ORG });
  await t.repos.links.put({ id: "l_ab", tenantId: tenant, type: "FEEDS", fromId: "a1", toId: "b1", origin: ORG });
  await t.repos.links.put({ id: "l_bc", tenantId: tenant, type: "FEEDS", fromId: "b1", toId: "c1", origin: ORG });
}

const H = (tenant: string) => debugUser(tenant, "admin", "admin");

const enable = (t: TestApp, tenant: string) =>
  t.app.inject({
    method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers: H(tenant),
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.certification": true } },
  });

/** 两条 PUBLISHED 传导规则：A.flow→B.load、B.flow→C.load（同 linkKey，均即时）。 */
async function publishRules(t: TestApp, tenant: string): Promise<void> {
  for (const r of [
    { key: "r_ab", sourceTypeKey: "TypeA", sourceStateVar: "flow", viaLinkKey: "FEEDS", targetTypeKey: "TypeB", targetStateVar: "load" },
    { key: "r_bc", sourceTypeKey: "TypeB", sourceStateVar: "flow", viaLinkKey: "FEEDS", targetTypeKey: "TypeC", targetStateVar: "load" },
  ]) {
    const res = await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: H(tenant),
      payload: { ...r, coefficient: 1, delayTicks: 0, status: "PUBLISHED" },
    });
    expect(res.statusCode).toBe(201);
  }
}

/** 同一份 base：a1 与 b1 都有源态 ⇒ 两条规则在 GLOBAL 下都会真触发。 */
const BASE = { a1: { flow: 10 }, b1: { flow: 5, load: 0 }, c1: { load: 0 } };

type TickBody = {
  curTick: number;
  state: Record<string, Record<string, number>>;
  scope?: { kind: string; target: string | null; hops: number; objects: number; links: number; droppedObjects: number; droppedLinks: number; unresolved: string | null };
};

/** 建一个带指定 scope 的会话并跑 1 tick，回响应体（走真 HTTP 端点，不直调纯函数）。 */
async function tickWithScope(t: TestApp, tenant: string, scope: Record<string, unknown>): Promise<TickBody> {
  const sid = (await (await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: H(tenant),
    payload: { baseSnapshot: BASE, scope },
  })).json()).id as string;
  const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: H(tenant), payload: { n: 1 } });
  expect(r.statusCode).toBe(200);
  return r.json() as TickBody;
}

describe("WO-SIM-SCOPE-TRIAL · P3 `SimSession.scope` 接读端（效果层：LOCAL≠GLOBAL）", () => {
  it("① 同 base 同规则同 tick：scope=LOCAL(TypeA) 与 scope=GLOBAL **结果不同**——被裁掉的那条边的下游没被算", async () => {
    const t = await makeApp();
    const TEN = "scopeseam1";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishRules(t, TEN);

    const g = await tickWithScope(t, TEN, { kind: "GLOBAL" });
    const l = await tickWithScope(t, TEN, { kind: "LOCAL", target: "TypeA" });

    // GLOBAL：两条边都在 ⇒ b1.load = 1×10 = 10、c1.load = 1×5 = 5。
    expect(g.state.b1.load).toBe(10);
    expect(g.state.c1.load).toBe(5);
    // LOCAL(TypeA, 1 跳)：范围 = {a1, b1}；`b1 --FEEDS--> c1` 两端不全在范围内 ⇒ 整条边被裁
    // ⇒ r_bc 一个 target 都取不到 ⇒ c1 完全没被算（**不是算成 0，是根本没参与**）。
    expect(l.state.b1.load).toBe(10); // 范围内那条边照常传导
    expect(l.state.c1.load).toBe(0); // ← 这一条就是 #129 的病灶位：修之前它也会是 5

    // 效果层判据（本门的头号断言）：两份世界态**必须不同**。
    // 「scopePropagationGraph 被调用了」证明不了任何事——它可以调用了却原样返回。
    expect(l.state).not.toEqual(g.state);

    // 诚实回执：范围回带，用户看得见"这次算了几个对象几条边、丢了多少"（R-ARG-FIDELITY）。
    expect(g.scope).toMatchObject({ kind: "GLOBAL", target: null, objects: 3, links: 2, droppedObjects: 0, droppedLinks: 0, unresolved: null });
    expect(l.scope).toMatchObject({ kind: "LOCAL", target: "TypeA", hops: SIM_SCOPE_DEFAULT_HOPS, objects: 2, links: 1, droppedObjects: 1, droppedLinks: 1, unresolved: null });
  });

  it("② 换根 ⇒ 换子图：scope=LOCAL(TypeC) 保住 B→C、裁掉 A→B（不是「局部=少算最后一跳」这种一厢情愿）", async () => {
    const t = await makeApp();
    const TEN = "scopeseam2";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishRules(t, TEN);

    const g = await tickWithScope(t, TEN, { kind: "GLOBAL" });
    const l = await tickWithScope(t, TEN, { kind: "LOCAL", target: "TypeC" });

    // LOCAL(TypeC, 1 跳)：范围 = {c1, b1}（无向展开 ⇒ 上游也进来）。
    // `a1 --FEEDS--> b1` 的 a1 在范围外 ⇒ 该边被裁 ⇒ b1.load 保持 0；`b1 --FEEDS--> c1` 在 ⇒ c1.load = 5。
    expect(l.state.b1.load).toBe(0);
    expect(l.state.c1.load).toBe(5);
    expect(l.state).not.toEqual(g.state);
    // 与①的 LOCAL 也不同 ⇒ 证明裁的是**这个 target 的邻域**，不是某个固定的"局部"。
    expect(l.state.b1.load).not.toBe(g.state.b1.load);
    expect(l.scope).toMatchObject({ kind: "LOCAL", target: "TypeC", objects: 2, links: 1, droppedObjects: 1, droppedLinks: 1 });
  });

  it("③ 诚实缺席：自称 LOCAL 却没有根（或根类型无已物化对象）⇒ 报缺 + 不传导，**绝不退回 GLOBAL**", async () => {
    const t = await makeApp();
    const TEN = "scopeseam3";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishRules(t, TEN);

    const g = await tickWithScope(t, TEN, { kind: "GLOBAL" });
    const noTarget = await tickWithScope(t, TEN, { kind: "LOCAL", target: null });
    const ghostTarget = await tickWithScope(t, TEN, { kind: "LOCAL", target: "TypeZ" });

    for (const [label, body] of [["无 target", noTarget], ["根类型无对象", ghostTarget]] as const) {
      // 报缺（机器可读 + 说人话），且图裁成空 ⇒ 世界原样不动。
      expect(body.scope?.unresolved, `${label} 必须显式报缺`).toBeTruthy();
      expect(body.scope?.objects, label).toBe(0);
      expect(body.scope?.links, label).toBe(0);
      expect(body.state.b1.load, label).toBe(0);
      expect(body.state.c1.load, label).toBe(0);
      // 头号判据：**不许**等于 GLOBAL 的结果。「我算不出局部」与「局部等于全局」是两个命题。
      expect(body.state, `${label} 不许静默退回 GLOBAL`).not.toEqual(g.state);
    }
  });

  it("④ 可回退（RL9）：不写 scope / 写活方案快照 bag 的老会话 —— 与 GLOBAL 逐字节相同", async () => {
    const t = await makeApp();
    const TEN = "scopeseam4";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishRules(t, TEN);

    const g = await tickWithScope(t, TEN, { kind: "GLOBAL" });
    const bare = await tickWithScope(t, TEN, {}); // 本单之前所有会话的形状
    const snapshotBag = await tickWithScope(t, TEN, { snapshotKind: "gslive", label: "方案", page: "global-sim" });

    expect(bare.state).toEqual(g.state);
    expect(snapshotBag.state).toEqual(g.state);
    expect(bare.scope?.kind).toBe("GLOBAL");
    expect(snapshotBag.scope?.kind).toBe("GLOBAL");
  });

  it("⑤ 纯函数直证：GLOBAL 返回**同一引用**（`===`）⇒ 不重排不复制，旧路径零改动", () => {
    const graph = {
      objects: [{ id: "a1", typeKey: "TypeA" }, { id: "b1", typeKey: "TypeB" }],
      links: [{ fromId: "a1", toId: "b1", linkKey: "FEEDS" }],
    };
    expect(scopePropagationGraph(graph, resolveSimScope({ kind: "GLOBAL" })).graph).toBe(graph);
    expect(scopePropagationGraph(graph, resolveSimScope({})).graph).toBe(graph);
    // hops=0：只留根类型对象 ⇒ 跨类型边一条都留不下（这正是默认 hops 取 1 而非 0 的理由）。
    const h0 = scopePropagationGraph(graph, resolveSimScope({ kind: "LOCAL", target: "TypeA", hops: 0 }));
    expect(h0.graph.objects.map((o) => o.id)).toEqual(["a1"]);
    expect(h0.graph.links).toEqual([]);
  });
});

describe("WO-SIM-SCOPE-TRIAL · L3-a 认证 Trial Tick 真跑传导栈（效果层：传导计数 > 0）", () => {
  /** 建会话 + 取认证。会话 base 有源态 ⇒ 传导栈**真有东西可触发**。 */
  const certify = async (t: TestApp, tenant: string, query: string) => {
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: H(tenant),
      payload: { baseSnapshot: BASE, scope: { kind: "GLOBAL" } },
    })).json()).id as string;
    const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification?${query}`, headers: H(tenant) });
    expect(r.statusCode).toBe(200);
    return r.json() as { trialTick: { passed: boolean; rulesFired: number; derivationRulesFired?: number; propagationRulesFired?: number; error: string | null } };
  };

  it("④ Trial Tick 之后**传导计数 > 0**（此前恒 0：跑的是 recompute 栈 B，不是传导栈 A）", async () => {
    const t = await makeApp();
    const TEN = "trialseam1";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishRules(t, TEN);

    const cert = await certify(t, TEN, "scope=GLOBAL");
    expect(cert.trialTick.passed).toBe(true);
    expect(cert.trialTick.error).toBeNull();
    // 头号判据：传导栈**真的动了**。两条 PUBLISHED 规则在 GLOBAL 下都产出了贡献。
    expect(cert.trialTick.propagationRulesFired).toBe(2);
    expect(cert.trialTick.propagationRulesFired!).toBeGreaterThan(0);
    // 本租户零派生规格 ⇒ 派生栈 0。修之前 `rulesFired = rc.order.length` 恒 0，
    // 屏上「规则触发 0 条」——而传导栈明明有两条在跑。这一行就是 #152 的病历。
    expect(cert.trialTick.derivationRulesFired).toBe(0);
    expect(cert.trialTick.rulesFired).toBe(cert.trialTick.derivationRulesFired! + cert.trialTick.propagationRulesFired!);
    expect(cert.trialTick.rulesFired).toBeGreaterThan(0);
  });

  it("⑤ 接缝合流：认证的 LOCAL 范围**同样作用于 Trial Tick** ⇒ 传导计数随范围变（2 → 1）", async () => {
    const t = await makeApp();
    const TEN = "trialseam2";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishRules(t, TEN);

    const global = await certify(t, TEN, "scope=GLOBAL");
    const local = await certify(t, TEN, "scope=LOCAL&target=TypeA");
    // LOCAL(TypeA) 的子图只留 a1→b1 ⇒ 只有 r_ab 触发得了。
    // 两半（范围裁剪 × Trial Tick）任一半漏接，这条就红：
    //  · 范围没接进 Trial Tick ⇒ 恒 2；· Trial Tick 还跑 recompute ⇒ 恒 0。
    expect(global.trialTick.propagationRulesFired).toBe(2);
    expect(local.trialTick.propagationRulesFired).toBe(1);
  });

  it("⑥ 零传导规则的租户：传导计数诚实为 0（不虚报，也不因此判 FAIL）", async () => {
    const t = await makeApp();
    const TEN = "trialseam3";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    // 刻意不发布任何传导规则。
    const cert = await certify(t, TEN, "scope=GLOBAL");
    expect(cert.trialTick.propagationRulesFired).toBe(0);
    expect(cert.trialTick.passed).toBe(true);
  });
});
