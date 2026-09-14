/**
 * WO-ADVERSARY-REACTION · 接缝测试：**交易对手会还手**（数据半 × 引擎半，一半漏即红）。
 *
 * ── 今天的行为 X / 应该的 Y（本单立单依据，实测·非推测）────────────────────────────
 * **X**：46 条传导边没有一条表达「对手方对我方应对做出反应」。`Order.orderChurn`
 *   （订单变更频度 = 插单/取消）**入度 0**：只有用户手动拨扰动才会动，世界里再糟的事
 *   都不会让任何客户主动砍一张单 ⇒ **单方推演**（扰动是一次性外生冲击，对手不还手）。
 * **Y**：我方把成本转嫁到客户头上、越过该客户容忍线之后，客户按一条**可披露的规则**
 *   砍单，且这个还手**回流进世界态**、影响下一拍读数。
 *
 * ── 五格对照实验（铁律 1.5·缺一格不算交付）──────────────────────────────────────
 *  §5 金丝雀   —— 先证明"读数取法有鉴别力"（不然下面四格全是废话）
 *  §2 反向对照 —— 关闭态必须与本单引入前**逐字节相同**（改坏既有行为比没做还糟）
 *  §1 开/关    —— 同扰动同应对，两组结果必须不同（相同 ⇒ 对抗方没接上）
 *  §3 金额相关 —— 同条数、不同金额的两个对手，还手力度必须按金额拉开（不是只看条数）
 *  §4 确定性   —— 同 seed 同输入重跑两次逐字节相同（对抗方不许引入随机性）
 *
 * ⚠ 断言全部咬**读数**（`Order.orderChurn` 的实际数值），不咬"规则在不在册"——
 *   「规则声明了」不度量「引擎真按它算了」，那正是本仓反复治的那个形态。
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ADVERSARY_FEATURE_KEY, assertReactionWellFormed } from "@platform/contracts";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

const REACTION_RULE_KEY = "demo_customer_reaction_cut_order";
const REACTION_LINK_KEY = "customer_places_order";
/** 种子里这条还手边的容忍线；超过它才激起反应（与 seed.ts 同一个数，改一处即红）。 */
const TOLERANCE = 12;

const md5 = (v: unknown) => createHash("md5").update(JSON.stringify(v)).digest("hex");

/** 起一个已播种、已开沙盘的租户。`adversary` 决定对抗方开关 —— 这就是被对照的那个变量。 */
async function boot(adversary: boolean): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: {
      overrides: {
        "sim.sandbox": true,
        "sim.propagation": true,
        ...(adversary ? { [ADVERSARY_FEATURE_KEY]: true } : {}),
      },
    },
  });
  return t;
}

/** 客户 → 其名下订单 id（走还手边本身，与引擎同一批边，不另开取数路）。 */
async function ordersByCustomer(t: TestApp): Promise<Map<string, string[]>> {
  const links = await t.repos.links.list("demo", (l) => l.type === REACTION_LINK_KEY);
  const m = new Map<string, string[]>();
  for (const l of links) (m.get(l.fromId) ?? m.set(l.fromId, []).get(l.fromId)!).push(l.toId);
  for (const v of m.values()) v.sort();
  return m;
}

/** 一个客户的在手金额敞口 Σ(qty × unitPrice)（与 `pair-weights.ts` 同一口径）。 */
async function exposureOf(t: TestApp, orderIds: readonly string[]): Promise<number> {
  let sum = 0;
  for (const id of orderIds) {
    const o = await t.repos.objects.get("demo", id);
    const p = (o?.props ?? {}) as Record<string, unknown>;
    sum += Math.max(0, Number(p.qty ?? 0) * Number(p.unitPrice ?? 0));
  }
  return sum;
}

/** 建会话 + 推 n 拍，回最后一拍世界态。`base` 直接写客户的应收压力（= 我方应对的落点）。 */
async function runWorld(
  t: TestApp, base: Record<string, Record<string, number>>, n: number,
): Promise<Record<string, Record<string, number>>> {
  const created = await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: base },
  });
  // 建会话真路由回 **201 Created**（不是 200）—— 第一版写死 200，五个用例一起红在同一行。
  expect(created.statusCode, created.body).toBe(201);
  const sid = (created.json() as { id: string }).id;
  const ticked = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n },
  });
  expect(ticked.statusCode, ticked.body).toBe(200);
  return (ticked.json() as { state: Record<string, Record<string, number>> }).state;
}

/** 挑两个**订单条数相同、金额不同**的客户 —— §3 的实验对象。挑不出来就让测试红，不静默跳过。 */
async function pickSameCountDifferentMoney(t: TestApp) {
  const byCust = await ordersByCustomer(t);
  const rows: { custId: string; name: string; orders: string[]; exposure: number }[] = [];
  for (const [custId, orders] of [...byCust].sort((a, b) => a[0].localeCompare(b[0]))) {
    // 客户**人话名**一并取出：本单的结论要写进本体，而「是哪两家客户」这种事
    // 必须由机器打出来，不许我凭印象往台账上写（铁律 1.5 判据四·信台账 = 信注释）。
    // ⚠ 属性名是 `custName` **不是** `name` —— 第一版写 `props.name`，
    //   读回 `undefined` 静默回落成 id，屏上打出 `obj_customer_cust_5(obj_customer_cust_5)`。
    //   形态：**「我用『这个 key 读不到值』当作『这个对象没有名字』的证据」** —— 是量法找错了字段。
    //   故这里**不静默回落**：读不到就让下面的断言红，而不是打一个看起来像 id 的"名字"。
    const o = await t.repos.objects.get("demo", custId);
    const name = String((o?.props as Record<string, unknown> | undefined)?.custName ?? "");
    rows.push({ custId, name, orders, exposure: await exposureOf(t, orders) });
  }
  for (const a of rows) {
    for (const b of rows) {
      if (a.custId >= b.custId) continue;
      if (a.orders.length !== b.orders.length) continue;
      if (a.exposure === b.exposure || a.exposure === 0 || b.exposure === 0) continue;
      return a.exposure > b.exposure ? { big: a, small: b } : { big: b, small: a };
    }
  }
  throw new Error("挑不出「同条数、不同金额」的两个客户 —— 本实验的前提在这棵树上不成立，需重设计而非跳过");
}

describe("WO-ADVERSARY-REACTION · 客户会还手（五格对照实验）", () => {
  // ══ §5 金丝雀 —— 先证明读数取法有鉴别力（放最前面：它不过，下面四格全无意义）══
  it("§5 金丝雀：还手边与其逆边真的在数据里，且我的读数取法抓得住变化", async () => {
    const t = await boot(true);

    // 金丝雀 a：拿一个**确定存在**的边（正向 `order_of_customer`）证明 links.list 是好的。
    const fwd = await t.repos.links.list("demo", (l) => l.type === "order_of_customer");
    expect(fwd.length, "金丝雀失败 ⇒ links.list 坏了，不是数据没有").toBeGreaterThan(0);
    // 影响向逆边必须与正向边**条数相同**（同一段派生式建出，严格互逆）。
    const rev = await t.repos.links.list("demo", (l) => l.type === REACTION_LINK_KEY);
    expect(rev.length).toBe(fwd.length);

    // 金丝雀 b：读数取法有鉴别力 —— 拿一个**确定会变**的量跑一遍，它必须动。
    const byCust = await ordersByCustomer(t);
    const [custId, orders] = [...byCust].sort((a, b) => a[0].localeCompare(b[0]))[0]!;
    const quiet = await runWorld(t, { [custId]: { receivablePressure: 0 } }, 2);
    const loud = await runWorld(t, { [custId]: { receivablePressure: TOLERANCE * 8 } }, 2);
    const q = quiet[orders[0]!]?.orderChurn ?? 0;
    const l = loud[orders[0]!]?.orderChurn ?? 0;
    expect(l, `读数不动 ⇒ 报「量法坏了」，不许报「代码没问题」（quiet=${q} loud=${l}）`).not.toBe(q);
  }, 300000);

  // ══ §2 反向对照（最重要）—— 关闭态不许有任何还手 ═══════════════════════════════
  it("§2 反向对照：对抗方**关闭**时 orderChurn 仍是纯外生根（入度 0），世界态不含任何还手写入", async () => {
    const t = await boot(false);
    const byCust = await ordersByCustomer(t);
    const [custId, orders] = [...byCust].sort((a, b) => a[0].localeCompare(b[0]))[0]!;

    // 同一个"我方应对"（把应收压力压到远高于容忍线），关闭态下客户**一动不动**。
    const state = await runWorld(t, { [custId]: { receivablePressure: TOLERANCE * 8 } }, 3);
    for (const oid of orders) {
      expect(
        state[oid]?.orderChurn ?? 0,
        `关闭态写了 orderChurn ⇒ 既有行为被改坏了，比没做还糟（订单 ${oid}）`,
      ).toBe(0);
    }

    // 且这条边**没有**被喂进引擎（披露层必须明说这是一次单方推演）。
    const d = await disclose(t, { [custId]: { receivablePressure: TOLERANCE * 8 } }, 1);
    expect(d.adversary.enabled).toBe(false);
    expect(d.adversary.declared).toBe(0);
    expect(d.adversary.suppressed, "关闭态必须点名被闸掉了几条，不许留白").toBeGreaterThan(0);
    expect(d.items.some((i) => i.ruleKey === REACTION_RULE_KEY)).toBe(false);
  }, 300000);

  // ══ §1 开 vs 关 —— 同扰动同应对，两组结果必须不同 ═══════════════════════════════
  it("§1 开/关对照：同一应对下两组世界态 md5 必须不同（相同 ⇒ 对抗方没接上）", async () => {
    const on = await boot(true);
    const off = await boot(false);
    const byCust = await ordersByCustomer(on);
    const [custId, orders] = [...byCust].sort((a, b) => a[0].localeCompare(b[0]))[0]!;
    const base = { [custId]: { receivablePressure: TOLERANCE * 8 } };

    const sOn = await runWorld(on, base, 3);
    const sOff = await runWorld(off, base, 3);
    const hOn = md5(sOn);
    const hOff = md5(sOff);
    // eslint-disable-next-line no-console
    console.log(`ADVERSARY_EXP1 on=${hOn} off=${hOff}`);
    expect(hOn, "开/关逐字节相同 ⇒ 对抗方根本没接上").not.toBe(hOff);

    // 差异必须**落在还手的落点上**，不是别处的噪声。
    expect(sOn[orders[0]!]?.orderChurn ?? 0).toBeGreaterThan(0);
    expect(sOff[orders[0]!]?.orderChurn ?? 0).toBe(0);
  }, 300000);

  // ══ §3 反应与金额相关 —— 同条数、不同金额必须拉开 ═══════════════════════════════
  it("§3 同条数不同金额的两个客户，受同一冲击 ⇒ 还手力度按金额比拉开（不是只看条数）", async () => {
    const t = await boot(true);
    const { big, small } = await pickSameCountDifferentMoney(t);
    // 两家客户**同时**受同一冲击（同一个世界里，排除"两次跑不同"这个干扰项）。
    const base = {
      [big.custId]: { receivablePressure: TOLERANCE * 8 },
      [small.custId]: { receivablePressure: TOLERANCE * 8 },
    };
    const state = await runWorld(t, base, 2);
    const churnBig = state[big.orders[0]!]?.orderChurn ?? 0;
    const churnSmall = state[small.orders[0]!]?.orderChurn ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `ADVERSARY_EXP3 单数=${big.orders.length} | 大户 ${big.name}(${big.custId}) 敞口=${big.exposure} churn=${churnBig}` +
        ` | 小户 ${small.name}(${small.custId}) 敞口=${small.exposure} churn=${churnSmall}` +
        ` | 敞口比=${big.exposure / small.exposure} 还手比=${churnBig / churnSmall}`,
    );

    expect(big.orders.length).toBe(small.orders.length); // 前提：条数确实相同
    // 🐤 名字读得到 —— 否则上面那行日志里的"客户名"其实是 id 的回落，
    //    而本体里写的「是哪两家客户」就成了没有出处的话。
    for (const r of [big, small]) {
      expect(r.name, `${r.custId} 的 custName 读不到 ⇒ 量法找错字段，不是这家客户没名字`).not.toBe("");
    }
    expect(churnBig, "还手力度为 0 ⇒ 这一格没验到东西").toBeGreaterThan(0);
    expect(churnSmall).toBeGreaterThan(0);
    // 🔴 这就是本仓那条病灶的反面判据：两家同为 N 单，**读数不许逐字节相同**。
    expect(
      churnBig,
      `同条数不同金额却给出相同还手力度 ⇒ 权重口径没生效（正是「东风与零跑同为 4 单、压力逐字节相同」那个病）`,
    ).not.toBe(churnSmall);
    // 且方向必须对：盘子大的还手更狠，比值与敞口比一致（不是随便不等就算过）。
    expect(churnBig).toBeGreaterThan(churnSmall);
    const ratioChurn = churnBig / churnSmall;
    const ratioMoney = big.exposure / small.exposure;
    expect(Math.abs(ratioChurn - ratioMoney)).toBeLessThan(1e-6);
  }, 300000);

  // ══ §4 确定性 —— 对抗方不许引入随机性 ═══════════════════════════════════════════
  it("§4 确定性：同 seed 同应对重跑两次 ⇒ 世界态逐字节相同", async () => {
    const a = await boot(true);
    const b = await boot(true);
    const byCust = await ordersByCustomer(a);
    const [custId] = [...byCust].sort((x, y) => x[0].localeCompare(y[0]))[0]!;
    const base = { [custId]: { receivablePressure: TOLERANCE * 8 } };
    expect(md5(await runWorld(a, base, 3))).toBe(md5(await runWorld(b, base, 3)));
  }, 300000);

  // ══ 可披露（铁律 1.5 判据二）—— 规则 key / 系数 / 触发条件 / 承载条数必须给得出 ══
  it("可披露：命中的规则 key · 系数 · 容忍线 · 还手动作 · 承载条数 · 越线对手数 · **谁选的**，一项不缺", async () => {
    const t = await boot(true);
    const byCust = await ordersByCustomer(t);
    const [custId] = [...byCust].sort((a, b) => a[0].localeCompare(b[0]))[0]!;
    const d = await disclose(t, { [custId]: { receivablePressure: TOLERANCE * 8 } }, 1);

    // 🐤 金丝雀（仓主 2026-09-08 补的判据要求的那一条）：**先拿一条确定命中的普通规则**
    //    证明"可披露这一层本身出得来东西"，再去断言还手边的那几项。
    //    不先验这一步 ⇒ 万一披露层整层是空的，下面每一条都会以"某项没给"的面目报出来，
    //    而真相是"这一层根本没产出"。形态：**「我用『某项读不到』当作『那一项没实现』的证据」**。
    const canaryPhysical = d.items.find((i) => !i.isReaction && i.fired);
    expect(
      canaryPhysical,
      "金丝雀失败：一条命中的**普通**传导边都披露不出来 ⇒ 报「披露层坏了」，不是「还手边没给」",
    ).toBeTruthy();
    expect(canaryPhysical!.ruleKey.length).toBeGreaterThan(0);
    expect(canaryPhysical!.coefficient).toBeGreaterThan(0);
    // 普通边**不许**冒充还手边：这几项必须是 null（而不是 0/空串这种"像模像样的值"）。
    expect(canaryPhysical!.reactionSelectedBy).toBeNull();
    expect(canaryPhysical!.reactionTriggeredActors).toBeNull();

    const item = d.items.find((i) => i.ruleKey === REACTION_RULE_KEY);
    expect(item, "还手边没进披露层 ⇒ 用户读不到「谁在跟我博弈」").toBeTruthy();
    expect(item!.isReaction).toBe(true);
    expect(item!.reactionActorTypeKey).toBe("Customer");
    expect(item!.reactionMove).toBe("CUT_ORDER");
    expect(item!.reactionMoveName).toBe("砍单"); // 人话名必须给，屏上不许只显裸键
    expect(item!.reactionTolerance).toBe(TOLERANCE);
    expect(item!.coefficient).toBeGreaterThan(0); // 系数是业务事实，必须给
    expect(item!.weightBasis).toBe("actor_exposure_relative");
    expect(item!.weightNormalize).toBe("SOURCE_POOL_MEAN");
    expect(item!.weightPairs, "承载条数必须给").toBeGreaterThan(0);
    expect(item!.reactionTriggeredActors, "越线对手数必须给（1 个客户被惹毛）").toBe(1);
    // ── 仓主 2026-09-08 架构原则：**「这是按规则算的，不是谁编的」必须读得出来** ──────
    // 数值由求解器算（系数 + 分摊 + 容忍线，上面几行已断言）；这三行回答的是
    // 「这条规则**凭什么是这一条**」—— 缺了它，前面几项再全也答不了这一问。
    expect(item!.reactionSelectedBy, "今天还手只能由规则表直选（零 LLM）").toBe("RULE_TABLE");
    expect(item!.reactionSelectedByName).toBe("规则表直选"); // 屏上不许只显裸键
    expect(item!.reactionSelectorRef, "规则表直选没有『谁挑的』，必须是 null 不是空串").toBeNull();

    expect(d.adversary.enabled).toBe(true);
    expect(d.adversary.declared).toBe(1);
    expect(d.adversary.suppressed).toBe(0);
    expect(d.adversary.moves).toEqual(["CUT_ORDER"]);
    expect(d.adversary.triggeredActors).toBe(1);
    // 汇总栏也必须明写"这一步是谁做的" —— 留白会让人以为反应是模型选的。
    expect(d.adversary.selectors).toEqual(["RULE_TABLE"]);

    // ── 顶层 agent 栏：本次推演**零 LLM**，必须明写而不是留白（铁律 1.5 判据二）──────
    expect(d.agentInvoked, "推演路今天零 LLM ⇒ 必须明写 invoked:false").toBe(false);
  }, 300000);

  // ══ 架构原则的**构造期闸**：选择方不许自带强度 ═══════════════════════════════
  // 仓主 2026-09-08：「所有计算原则上使用求解器而不是 agent 来计算，agent 只负责…挑规则」。
  // ⇒ 编排层将来只能**挑一条已有规则**，数值必须来自那条规则自己。
  // 这条用例是那道闸的**变异反证**：喂一条没有表内强度的还手边，构造期必须当场抛。
  // 没有反证的门是装饰品 —— 门永远绿也可能是因为它什么都不拦。
  it("架构原则闸：还手边不带表内强度（coefficient/coefficientRef 都没有）⇒ 构造期必须抛", async () => {
    const wellFormed = {
      key: "probe_ok", sourceTypeKey: "Customer", coefficient: 0.35, coefficientRef: null,
      reaction: { actorTypeKey: "Customer", tolerance: 12, move: "CUT_ORDER", selectedBy: "RULE_TABLE", selectorRef: null },
    };
    // 🐤 金丝雀：合规的那条**必须过** —— 否则这道闸是"一律拒绝"，反证就没有意义。
    expect(() => assertReactionWellFormed([wellFormed])).not.toThrow();

    // 变异：把表内强度拿掉（模拟"强度由挑规则的那一方现编"）。
    const noStrength = { ...wellFormed, key: "probe_no_strength", coefficient: undefined, coefficientRef: null };
    expect(() => assertReactionWellFormed([noStrength])).toThrow(/表内强度/);

    // 变异：规则表直选却带了"谁挑的"出处 —— 读起来像编排层参与过。
    const fakeSelector = {
      ...wellFormed, key: "probe_fake_selector",
      reaction: { ...wellFormed.reaction, selectorRef: "agent_run_1" },
    };
    expect(() => assertReactionWellFormed([fakeSelector])).toThrow(/selectorRef/);
  });
});

/** 取一次带披露的推进（`?disclose=1`）——可披露那一层的读端。 */
async function disclose(t: TestApp, base: Record<string, Record<string, number>>, n: number) {
  const created = await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: base },
  });
  const sid = (created.json() as { id: string }).id;
  const r = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?disclose=1`, headers: ADMIN, payload: { n },
  });
  expect(r.statusCode, r.body).toBe(200);
  const body = r.json() as {
    disclosure: {
      rules: {
        items: {
          ruleKey: string; isReaction: boolean; fired: boolean; coefficient: number;
          reactionActorTypeKey: string | null; reactionMove: string | null;
          reactionMoveName: string | null; reactionTolerance: number | null;
          reactionTriggeredActors: number | null;
          reactionSelectedBy: string | null; reactionSelectedByName: string | null;
          reactionSelectorRef: string | null;
          weightBasis: string | null; weightNormalize: string | null; weightPairs: number | null;
        }[];
        adversary: {
          enabled: boolean; declared: number; suppressed: number;
          fired: number; triggeredActors: number; moves: string[]; selectors: string[];
        };
      };
      agent: { invoked: boolean; calls: number };
    };
  };
  expect(body.disclosure, "?disclose=1 没回披露层").toBeTruthy();
  // `agent` 与 `rules` 是披露层的两栏（⑤ 与 ③）。摊平一格带出来，
  // 免得用例为了读「本次调没调 LLM」再各自去翻回包结构。
  return { ...body.disclosure.rules, agentInvoked: body.disclosure.agent.invoked };
}
