/**
 * WO-SIM-TRIAL-SCOPE-RECONCILE 验收门 —— **两条各自正确、互相冲突的改动合成一份之后，两侧都还在**。
 *
 * ══ 这条门存在的理由（不是复述那两张单，是它们的交集）══════════════════════════════
 *
 * 两侧改的是同一段代码的同一处，且**方向相反**：
 *  · A 侧 `WO-SIM-SCOPE-TRIAL`（闭 #129/#130 `G-SIM-SCOPE-UNREAD`）——
 *    在 tick 路的**图物化那一步**插入 `scopePropagationGraph`，让 `SimSession.scope` 终于有读端。
 *  · B 侧 `WO-SIM-ACT-CLOSE`（闭 #152）——
 *    把那一整段图物化**抽走**，收成唯一装配处 `buildPropagationInputs`，好让 Trial Tick 与真 tick 同源。
 *
 * 「在原地插一段」× 「把原地整段搬走」= 冲突。而**择一必丢功能**：
 *  · 只要 A ⇒ Trial Tick 又变回另抄一份装配 ⇒ 「认证说能跑、真 tick 不是这个数」；
 *  · 只要 B ⇒ 范围裁剪连同那段代码一起没了 ⇒ 用户切 LOCAL 而引擎按 GLOBAL 全量算（静默错答）。
 * 正确解是**合成**：`buildPropagationInputs` 也吃范围 ⇒ 单一装配处 ∧ 范围裁剪同时成立。
 *
 * ══ 本门咬什么 ═══════════════════════════════════════════════════════════════════
 *  ① 效果层 · A 侧还在：**同一个世界**里，LOCAL 与 GLOBAL 跑出来的数必须不同（tick 路 + 认证路都验）。
 *  ② 效果层 · B 侧还在：Trial Tick 的传导相真的跑，`propagationRulesDeclared` 仍在下发。
 *  ③ 结构层 · 同源判据：`app.ts` 里图物化 / 范围裁剪 / 闸门装配**各只有一处**，且都在 `buildPropagationInputs` 里。
 *     —— 这一条是**机制**（铁律 0.6 二级处置）：下次谁再给 Trial Tick 另抄一份装配，
 *     是机器先说话，不是人先想起来。
 *
 * ⚠ ①② 与两张原单的门（`sim-scope-trial.seam.test.ts` / `sim-act-close.seam.test.ts`）**刻意重叠一部分**，
 *   但落点不同：那两条各自在自己的世界里验自己那一半；本条把两半放进**同一个世界、同一次请求链**里验，
 *   因为合并事故恰恰只在"两半同时在场"时才暴露。
 *
 * ══ 变异反证（都亲手跑过，输出记在交付报告里）══════════════════════════════════════
 *  · 破坏 A 侧：`app.ts buildPropagationInputs` 里 `scopePropagationGraph({objects,links}, scope)`
 *    → 改成 `{ graph: {objects, links}, report: … }`（不裁）⇒ ①-tick 与 ①-cert 双红。
 *  · 破坏 B 侧：`app.ts trialPropagate` 整体 → 改回 `{ fired: 0, declared: 0 }`（= 修之前的行为）⇒ ② 红。
 *  · 破坏同源：把 `trialPropagate` 里的 `buildPropagationInputs` 换成就地再物化一份 ⇒ ③ 红。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { debugUser, makeApp, type TestApp } from "./helpers.js";

const ORG = { type: "SYNTHETIC" as const, jobId: "trial-scope-reconcile" };
const H = (tenant: string) => debugUser(tenant, "admin", "admin");

/**
 * 三点链 `a1(TypeA) --FEEDS--> b1(TypeB) --FEEDS--> c1(TypeC)`（R14 零行业名）。
 * 必须三点：两点图上 LOCAL(1 跳) 恰好圈住整张图 ⇒ 与 GLOBAL 逐字节相同 ⇒ 断言恒绿而缺陷仍在。
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

const enable = (t: TestApp, tenant: string) =>
  t.app.inject({
    method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers: H(tenant),
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.certification": true } },
  });

/** 两条 PUBLISHED 传导规则：A.flow→B.load、B.flow→C.load。 */
async function publishRules(t: TestApp, tenant: string): Promise<void> {
  for (const r of [
    { key: "r_ab", sourceTypeKey: "TypeA", sourceStateVar: "flow", viaLinkKey: "FEEDS", targetTypeKey: "TypeB", targetStateVar: "load" },
    { key: "r_bc", sourceTypeKey: "TypeB", sourceStateVar: "flow", viaLinkKey: "FEEDS", targetTypeKey: "TypeC", targetStateVar: "load" },
  ]) {
    const res = await t.app.inject({
      method: "POST", url: "/a/v1/sim/propagation-rules", headers: H(tenant),
      payload: { ...r, coefficient: 1, delayTicks: 0, status: "PUBLISHED" },
    });
    expect(res.statusCode, "种传导规则失败——后面的断言全部无意义").toBe(201);
  }
}

/** a1、b1 都有源态 ⇒ GLOBAL 下两条规则都真触发（否则"少算了"证明不了是范围造成的）。 */
const BASE = { a1: { flow: 10 }, b1: { flow: 5, load: 0 }, c1: { load: 0 } };

interface TickBody {
  state: Record<string, Record<string, number>>;
  scope?: { kind: string; target: string | null; objects: number; links: number; droppedObjects: number; droppedLinks: number; unresolved: string | null };
}
interface TrialTick {
  passed: boolean;
  rulesFired: number;
  derivationRulesFired?: number;
  propagationRulesFired?: number;
  propagationRulesDeclared?: number;
  error: string | null;
}

async function newSession(t: TestApp, tenant: string, scope: Record<string, unknown>): Promise<string> {
  const res = await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: H(tenant), payload: { baseSnapshot: BASE, scope },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}
const tick = async (t: TestApp, tenant: string, sid: string): Promise<TickBody> => {
  const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: H(tenant), payload: { n: 1 } });
  expect(r.statusCode).toBe(200);
  return r.json() as TickBody;
};
const certify = async (t: TestApp, tenant: string, sid: string, query: string): Promise<TrialTick> => {
  const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification?${query}`, headers: H(tenant) });
  expect(r.statusCode).toBe(200);
  return r.json().trialTick as TrialTick;
};

describe("WO-SIM-TRIAL-SCOPE-RECONCILE · 合并后两侧功能同时在场", () => {
  // ══ ① A 侧（范围裁剪）在合并后仍然生效 —— tick 路与认证路**两条路都验** ═══════════════
  it("① 切 LOCAL 引擎真的只算局部：同一个世界里 tick 路与认证路的数**都**随范围变（A 侧没被合掉）", async () => {
    const t = await makeApp();
    const TEN = "reconcile1";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishRules(t, TEN);

    const sidGlobal = await newSession(t, TEN, { kind: "GLOBAL" });
    const sidLocal = await newSession(t, TEN, { kind: "LOCAL", target: "TypeA" });

    // ── ①-tick：真 tick 路 ────────────────────────────────────────────────────
    const g = await tick(t, TEN, sidGlobal);
    const l = await tick(t, TEN, sidLocal);
    // GLOBAL：两条边都在 ⇒ b1.load = 10、c1.load = 5。
    expect(g.state.b1.load).toBe(10);
    expect(g.state.c1.load).toBe(5);
    // LOCAL(TypeA, 1 跳)：范围 = {a1,b1}；`b1--FEEDS-->c1` 两端不全在范围内 ⇒ 整条边被裁 ⇒ c1 根本没参与。
    expect(l.state.b1.load).toBe(10);
    expect(l.state.c1.load, "🔴 A 侧被合掉了：LOCAL 又按全量算（#129 原样复发）").toBe(0);
    // 头号判据（效果层）：两份世界态必须不同。「函数被调用了」证明不了任何事。
    expect(l.state, "🔴 LOCAL 与 GLOBAL 结果相同 ⇒ 范围裁剪在合并中丢了").not.toEqual(g.state);
    // 诚实回执随 tick 下发（R-ARG-FIDELITY）—— 装配处搬家后它必须还在回包里。
    expect(g.scope).toMatchObject({ kind: "GLOBAL", objects: 3, links: 2, droppedObjects: 0, droppedLinks: 0 });
    expect(l.scope).toMatchObject({ kind: "LOCAL", target: "TypeA", objects: 2, links: 1, droppedObjects: 1, droppedLinks: 1 });

    // ── ①-cert：认证路（Trial Tick 的传导相同样吃范围）───────────────────────────
    // 这一半是"合成"真正的落点：范围裁剪必须发生在**唯一装配处**里，
    // 否则认证路会绕过它 ⇒ 下面这两个数会一样。
    const certGlobal = await certify(t, TEN, sidGlobal, "scope=GLOBAL");
    const certLocal = await certify(t, TEN, sidGlobal, "scope=LOCAL&target=TypeA");
    expect(certGlobal.propagationRulesFired, "GLOBAL 下两条规则都产出贡献").toBe(2);
    expect(certLocal.propagationRulesFired, "🔴 范围没进唯一装配处 ⇒ 认证路绕过了裁剪").toBe(1);
  });

  // ══ ② B 侧（Trial Tick 传导相 + declared 诚实位）在合并后仍然生效 ═══════════════════
  it("② Trial Tick 的传导相真的跑，且 propagationRulesDeclared 仍在下发（B 侧没被合掉）", async () => {
    const t = await makeApp();
    const TEN = "reconcile2";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishRules(t, TEN);
    const sid = await newSession(t, TEN, { kind: "GLOBAL" });

    const trial = await certify(t, TEN, sid, "scope=GLOBAL");
    expect(trial.passed).toBe(true);
    expect(trial.error).toBeNull();
    // 传导相**真的动了**（修之前恒 0：跑的是 recompute 派生相，不是传导相）。
    expect(trial.propagationRulesFired, "🔴 B 侧被合掉了：Trial Tick 又只跑派生相（#152 原样复发）").toBe(2);
    // 诚实位：B 侧独有的第三个拆账字段。A 侧没有它 —— 合并里最容易被"择一"顺手丢掉的就是这一个。
    expect(trial.propagationRulesDeclared, "🔴 propagationRulesDeclared 不下发了 ⇒ B 侧的诚实位丢了").toBe(2);
    // 拆账与总数对得上（本租户零派生规格 ⇒ 派生相 0）。
    expect(trial.derivationRulesFired).toBe(0);
    expect(trial.rulesFired).toBe((trial.derivationRulesFired ?? 0) + (trial.propagationRulesFired ?? 0));
  });

  it("②补 诚实位真的有信息量：世界态驱动不动传导时 declared>0 而 fired===0", async () => {
    const t = await makeApp();
    const TEN = "reconcile3";
    await threeNodeWorld(t, TEN);
    await enable(t, TEN);
    await publishRules(t, TEN);
    // 源态全 0 ⇒ 无源即无贡献（引擎 `sourceVal === 0` 直接 continue）。
    const res = await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: H(TEN),
      payload: { baseSnapshot: { a1: { flow: 0 }, b1: { flow: 0, load: 0 }, c1: { load: 0 } }, scope: { kind: "GLOBAL" } },
    });
    const trial = await certify(t, TEN, res.json().id as string, "scope=GLOBAL");
    expect(trial.propagationRulesDeclared, "规则确实声明了 2 条").toBe(2);
    expect(trial.propagationRulesFired, "空世界里传导跑不动，认证必须照实说 0").toBe(0);
  });

  // ══ ③ 结构层 · 同源判据（这是机制，不是"下次注意"）═══════════════════════════════
  describe("③ 单一装配处：图物化 / 范围裁剪 / 闸门装配在 app.ts 里各只有一处", () => {
    const APP_SRC = readFileSync(fileURLToPath(new URL("../src/app.ts", import.meta.url)), "utf8");

    /**
     * **唯一实现**：剔掉纯注释行后数命中。金丝雀与主逻辑共用这一支 ——
     * 铁律 0.6 明文：金丝雀不许各抄一份正则，抄了就是装饰品（改主正则时金丝雀拿旧的去测、照样绿）。
     */
    const countCodeSites = (src: string, re: RegExp): number => {
      const code = src
        .split("\n")
        .filter((line) => {
          const s = line.trim();
          return !(s.startsWith("//") || s.startsWith("*") || s.startsWith("/*"));
        })
        .join("\n");
      return [...code.matchAll(re)].length;
    };

    /**
     * 图物化的代码形状 —— 咬的是 `.push({ id: o.id, typeKey: o.type })` 这个**形状**，
     * **刻意不带接收变量名**。
     *
     * ⚠ 这一条是被自己的变异反证当场纠正过来的，原样记在这儿（铁律 0.6 第 1 次 = 修 + 记账）：
     * 初版写成 `/objects\.push\(…/`，而变异注入的那份抄写用的是 `dupObjects.push(…)` ——
     * 大小写不同（`Objects` vs `objects`）⇒ 正则一次都没中 ⇒ **变异下这条断言照样绿**。
     * 形态即「我用『变量名叫 objects 的那行 push』当作『图物化发生了几次』的证据，
     * 而前者并不度量后者」。抄一份装配的人**恰恰**会换个变量名（不换就撞名编译不过），
     * 所以带变量名的正则天生抓不到它要抓的那个人。现在只咬形状，换什么名字都躲不掉。
     */
    const GRAPH_MATERIALIZE = () => /\.push\(\{\s*id:\s*o\.id,\s*typeKey:\s*o\.type\s*\}\)/g;
    const SCOPE_CROP = () => /scopePropagationGraph\(/g;
    const CADENCE_ASSEMBLE = () => /buildCadenceGates\(/g;
    const ASSEMBLY_CALLERS = () => /await buildPropagationInputs\(/g;

    it("金丝雀：数数器与剔注释共用同一支实现，且两个方向都验过（否则下面的「各只有一处」不许信）", () => {
      // 正向：一个**已知必中**的样例必须中。不中 ⇒ 报「工具坏了」，不许报「代码干净」。
      expect(countCodeSites(APP_SRC, /const buildPropagationInputs = async/g), "金丝雀不中 ⇒ 数数器坏了").toBe(1);
      // 反向：只出现在注释里的东西必须被剔掉。app.ts 的注释里确实提过 `buildPropagationInputs`
      // （tick 路与 trialPropagate 的说明各一处），若剔注释没生效，下面这个数会 > 2。
      expect(countCodeSites("// scopePropagationGraph(\n * scopePropagationGraph(\n", SCOPE_CROP()), "剔注释没生效").toBe(0);
      expect(countCodeSites("const x = scopePropagationGraph(a, b);", SCOPE_CROP()), "剔注释把真代码也剔了").toBe(1);
    });

    it("图物化只有一处（Trial Tick 若另抄一份装配，这里当场变 2）", () => {
      expect(
        countCodeSites(APP_SRC, GRAPH_MATERIALIZE()),
        "🔴 app.ts 里出现了第二处图物化 ⇒ 「认证说能跑、真 tick 不是这个数」的老形态回来了",
      ).toBe(1);
    });

    it("范围裁剪只有一处，且闸门装配也只有一处（两者必须与图物化同处，否则总有一条路绕得过去）", () => {
      expect(countCodeSites(APP_SRC, SCOPE_CROP()), "🔴 范围裁剪出现第二处 ⇒ 两条路口径会漂").toBe(1);
      expect(countCodeSites(APP_SRC, CADENCE_ASSEMBLE()), "🔴 闸门装配出现第二处").toBe(1);
    });

    it("那一处就在 buildPropagationInputs 里，且它至少被两条路各调一次（tick / Trial Tick）", () => {
      const start = APP_SRC.indexOf("const buildPropagationInputs = async");
      expect(start, "找不到装配处 ⇒ 先修工具再看结论").toBeGreaterThan(-1);
      const end = APP_SRC.indexOf("\n  };", start);
      expect(end, "切不出装配处函数体").toBeGreaterThan(start);
      const body = APP_SRC.slice(start, end);
      // 三件事都在同一个函数体里 = 「单一装配处 ∧ 范围裁剪」这条合成判据的结构证据。
      expect(countCodeSites(body, GRAPH_MATERIALIZE()), "图物化不在装配处里").toBe(1);
      expect(countCodeSites(body, SCOPE_CROP()), "🔴 范围裁剪不在装配处里 ⇒ 谁调用谁自己裁 = 装配处纪律作废").toBe(1);
      expect(countCodeSites(body, CADENCE_ASSEMBLE()), "闸门装配不在装配处里").toBe(1);
      // 两条路都吃它（tick 路 + trialPropagate）。少一条 = 有一条路又自己造轮子了。
      expect(countCodeSites(APP_SRC, ASSEMBLY_CALLERS()), "🔴 装配处的调用方不足两条 ⇒ 有一条路绕开了它").toBeGreaterThanOrEqual(2);
    });
  });
});
