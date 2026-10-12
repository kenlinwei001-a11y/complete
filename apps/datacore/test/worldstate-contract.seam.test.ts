import { describe, expect, it } from "vitest";
import { makeApp, debugUser } from "./helpers.js";
import { ParetoAssembleResultSchema, type ParetoAssembleResult } from "@platform/contracts";

/**
 * WO-WORLDSTATE-CONTRACT · **世界态读取契约**的接缝门。
 *
 * ══ 今天的行为是 X，应该是 Y（开工实测原文，本机 4051 真后端 · demo 租户）══════════
 *
 * **X**：`sessionId` 这根管子**从前端一路通到装配器**，终点却没人接收 ——
 *   前端 `SandboxOptRoute.tsx` 传（`body = sessionId ? {sessionId} : {}`）、
 *   `opt-assemble.ts` 抄进回包（唯一一处，注释原文「本层不解释它」）、
 *   `opt-pareto.ts` 里 `sessionId` **零命中**（金丝雀：同文件 `objectives` 命中 17 ⇒ 真零命中）。
 *   真跑：给 `obj_model_4680-NCM.costPressure` 施 999（http 201，世界态确认写入 999）再 tick×3，
 *   方案寻优回包 **md5 `f46392a90be7692d17503e04fc06d432` / 19124B 逐字节不变**
 *   （24 方案 / 毛利 250.60 亿 / 获排率 0.4066 —— 与 LOOP11 四个人各自量到的数一致）。
 *   金丝雀：同一支端点只收窄 `selection` ⇒ md5 当场变 `fce5fb58b094da9fd1292829a46a0f74`。
 *   ⇒ 形态是「**接了线、线通、终点没人接收**」，不是「没接线」。
 *
 * **Y**：给了 `sessionId` 就按契约读该会话**当前拍**的世界态，把模型读的那几格改写成
 *   这次推演里的值，并**逐格披露**（读了哪几格 · 经哪条链路 · 按哪条公式 · 改前改后）。
 *
 * ══ 这道门咬的是链路不是函数 ═══════════════════════════════════════════════════
 * 全程走 **HTTP 路由**（`app.inject`）+ **真仓储**（世界态经 `repos.sim` 落库再读回）。
 * ⛔ 刻意不直调 `buildWorldReadView()`：只测函数是本仓记过的假绿第 9 形态
 *   （「实现有、测试有、且是绿的，零生产调用方」）。
 *
 * ══ R14 反硬编码：本门的本体里**没有一个电池/基地字样** ═════════════════════════
 * 类型叫 `TicketOrder`/`Coach`，字段叫 `farePrice`/`seatQty`/`seatCapacity`/`runCost`。
 * 世界态读取层若哪天偷偷硬编 `Order`/`unitCost`/`loadIndex` 落点，本门当场红。
 */

const T = "acme";
const ACME = debugUser(T, "admin", "admin");
type App = Awaited<ReturnType<typeof makeApp>>;

const putType = (
  t: App,
  key: string,
  props: { propKey: string; dataType: string; isPrimaryKey?: boolean; refToTypeKey?: string; unit?: string }[],
) =>
  t.repos.ontologyTypes.put({
    id: `ot_${T}_${key}`, tenantId: T, key, displayName: key, domain: "x", version: 1, status: "ACTIVE",
    derivedProperties: [], sourceBindings: [],
    properties: props.map((p) => ({ isPrimaryKey: false, ...p })) as never,
  });

const putObj = (t: App, type: string, id: string, props: Record<string, unknown>) =>
  t.repos.objects.put({ origin: { type: "MANUAL" }, id, tenantId: T, type, props });

const enableSim = (t: App) =>
  t.app.inject({ method: "PUT", url: `/a/v1/tenants/${T}/features`, headers: ACME, payload: { overrides: { "sim.sandbox": true } } });

async function seedTicketWorld(t: App): Promise<void> {
  await putType(t, "TicketOrder", [
    { propKey: "ticketNo", dataType: "string", isPrimaryKey: true },
    { propKey: "seatQty", dataType: "number" },
    { propKey: "farePrice", dataType: "number" },
    { propKey: "refundCost", dataType: "number" },
    /**
     * **按座履约成本**（强度量）。加它的理由是本门开工时踩到的那一格：
     * 没有它时订单侧唯一命中成本词库的是 `refundCost`（违约金·总量），
     * 于是「成本压力」落到了**罚金轴**上，成本轴一格不动 —— 断言当场红（`expected 5 to be > 5`）。
     * 那不是接线错了，是**装置缺一格**：真租户的订单侧确实有按件成本
     *（demo 实测 `OrderLine.unitCost`，元/件），装置不给就测不到成本轴。
     * 命名同时命中 `cost` 与 `unitRate` 两个词库 ⇒ 装配器绑 role `unit_cost`（与 demo 同形），
     * 且**不会**被误当成 penalty（装配器那一格显式排除强度量）。
     */
    { propKey: "seatCostRate", dataType: "number" },
  ]);
  await putType(t, "Coach", [
    { propKey: "coachId", dataType: "string", isPrimaryKey: true },
    { propKey: "seatCapacity", dataType: "number" },
    { propKey: "runCost", dataType: "number" },
  ]);
  for (const [id, seatQty, farePrice, refundCost, seatCostRate] of [
    ["o1", 12, 100, 50, 2], ["o2", 8, 60, 5, 3], ["o3", 15, 90, 40, 1], ["o4", 6, 30, 30, 4],
  ] as [string, number, number, number, number][]) {
    await putObj(t, "TicketOrder", id, { ticketNo: id, seatQty, farePrice, refundCost, seatCostRate });
  }
  for (const [id, seatCapacity, runCost] of [["c1", 20, 5], ["c2", 10, 3], ["c3", 30, 7]] as [string, number, number][]) {
    await putObj(t, "Coach", id, { coachId: id, seatCapacity, runCost });
  }
}

/** 建一条真会话；`state` 直接当 tick0 世界态落库（走 `repos.sim`，与生产同一套存储）。 */
async function seedSession(t: App, id: string, state: Record<string, Record<string, number>>): Promise<void> {
  await t.repos.sim.createSession({
    id, tenantId: T, baseSnapshot: state, scope: {}, status: "RUNNING", curTick: 0,
    parentCheckpointId: null, disabledRuleKeys: [], tickDays: 1, createdAt: "2026-01-01T00:00:00.000Z",
  });
  await t.repos.sim.putTickState({ sessionId: id, tenantId: T, tick: 0, state, pending: [], trace: null });
}

const assemble = async (t: App, payload: Record<string, unknown> = {}) => {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/optimize-pareto/assemble", headers: ACME, payload });
  return { statusCode: r.statusCode, body: r.body, json: r.statusCode === 200 ? (JSON.parse(r.body) as ParetoAssembleResult) : undefined };
};

const ok = (a: { json?: ParetoAssembleResult }): Extract<ParetoAssembleResult, { applicable: true }> => {
  const p = ParetoAssembleResultSchema.safeParse(a.json);
  expect(p.success, `装配回包过不了契约：${JSON.stringify(a.json)}`).toBe(true);
  const r = p.success ? p.data : undefined;
  expect(r?.applicable, `装不出来：${JSON.stringify(a.json)}`).toBe(true);
  return r as Extract<ParetoAssembleResult, { applicable: true }>;
};

/** 取某订单在 args 里的按件履约成本（`eligibility[].cost` 首行）—— 成本轴的真落点。 */
const costOf = (r: Extract<ParetoAssembleResult, { applicable: true }>, order: string): number =>
  ((r.request.args?.eligibility as { order: string; cost: number }[]) ?? []).filter((e) => e.order === order)[0]!.cost;

const capOf = (r: Extract<ParetoAssembleResult, { applicable: true }>, line: string): number =>
  ((r.request.args?.lines as { id: string; capacity: number }[]) ?? []).find((l) => l.id === line)!.capacity;

describe("WO-WORLDSTATE-CONTRACT · 产出侧读这次推演的世界态", () => {
  it("⓪ 金丝雀：装置与探针先自证（不中 ⇒ 报「工具坏了」，不许读作「接线对了」）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedTicketWorld(t);
    // (a) 本体真进去了 —— 否则下面每一条"没变化"都是空转。
    expect((await t.repos.objects.listByType(T, "TicketOrder")).length, "订单没进去").toBe(4);
    // (b) 装配口通 —— 404 会让「没读世界态」与「没这条路」分不开。
    const base = await assemble(t);
    expect(base.statusCode, "装配口不通 ⇒ 本门测的是别的东西").toBe(200);
    // (c) **读数取法有鉴别力**：换个真会输入的东西，args 必须当场变。
    //     这一格不过 ⇒ 报「量法坏了」，下面所有「变了/没变」都不可信。
    await seedSession(t, "s-canary", { o1: { costPressure: 50 } });
    const withWorld = ok(await assemble(t, { sessionId: "s-canary" }));
    expect(costOf(withWorld, "o1"), "金丝雀不中：世界态里明明有 costPressure，成本却一格没动 ⇒ 量法坏了")
      .toBeGreaterThan(costOf(ok(base), "o1"));
  });

  it("① 对照实验：施扰动后模型读的是**这次推演的世界态**（成本压力 ⇒ 成本升）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedTicketWorld(t);
    const before = ok(await assemble(t));
    // 装置前提写死成算术，读者不必去猜：o1 成本 = 占用 runCost(c1)=5 + 按座 2 × 12 座 = 29。
    expect(costOf(before, "o1"), "装置前提变了 ⇒ 下面那个可预言的数就不成立了").toBe(29);

    // `costPressure` 挂在**订单自己**身上（SELF 承载体）。
    await seedSession(t, "s1", { o1: { costPressure: 100 } });
    const after = ok(await assemble(t, { sessionId: "s1" }));

    /**
     * 方向可预言（铁律 1.5 判据一）：压力 100pp ⇒ 因子 ×(1+100/100)=2，
     * 只作用在**按座成本**那一格 ⇒ 5 + (2×2) × 12 = **53**。
     * ⚠ 不是「整笔成本翻倍」：占用成本 `runCost` 挂在**车厢**上，订单的成本压力够不着它 ——
     *   两笔钱各按各的口径计价，谁都没被凭空改口径（同 `opt-binding` 那条纪律）。
     */
    expect(costOf(after, "o1"), "成本压力没落到按座成本那一格").toBe(53);
    // 没被扰动的单**一格不动** —— 否则就是把局部推演放大成了全局结论。
    expect(costOf(after, "o2"), "没施扰动的单也被改了 ⇒ 落点错了").toBe(costOf(before, "o2"));
  });

  it("② 反向对照：不传 sessionId ⇒ 与本契约引入前**逐字节相同**（且两跑一致·R6）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedTicketWorld(t);
    // 世界里明明有一条会话、且态很猛 —— 不传就**一格都不许叠**。
    await seedSession(t, "s2", { o1: { costPressure: 900 }, c1: { loadIndex: 90 } });
    const a1 = await assemble(t);
    const a2 = await assemble(t);
    expect(a1.body, "不传 sessionId 两跑不一致 ⇒ R6 破").toBe(a2.body);
    expect(ok(a1).worldState, "不传 sessionId 却带回了世界态披露 ⇒ 向后兼容破").toBeNull();
    // 与「这条会话根本不存在」时的结果逐字节相同 ⇒ 证明没传就是真没读。
    const t2 = await makeApp();
    await enableSim(t2);
    await seedTicketWorld(t2);
    expect((await assemble(t2)).body, "有会话与无会话在不传时给出了不同的数 ⇒ 悄悄读了").toBe(a1.body);
  });

  it("③ 方向可预言：负荷指数 ⇒ 可用产能下降（`capacity` 这一格朝可预言方向移动）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedTicketWorld(t);
    const before = ok(await assemble(t));
    expect(capOf(before, "c3"), "装置前提：c3 产能应为 30").toBe(30);
    // 负荷 40pp ⇒ 可用产能 ×(1−40/100)=0.6 ⇒ 30 → 18。
    await seedSession(t, "s3", { c3: { loadIndex: 40 } });
    const after = ok(await assemble(t, { sessionId: "s3" }));
    expect(capOf(after, "c3")).toBeCloseTo(18, 6);
    expect(capOf(after, "c1"), "没施扰动的产线也被改了 ⇒ 落点错了").toBe(capOf(before, "c1"));
  });

  it("④ R2：会话不存在 / 属于别的租户 ⇒ **404**，⛔ 不静默退化成读本体真值", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedTicketWorld(t);
    const gone = await assemble(t, { sessionId: "s-nope" });
    expect(gone.statusCode, "不存在的会话居然 200 ⇒ 正是本单要修的那个病的形态").toBe(404);

    // 别租户的会话：**存在**，但不属于我 ⇒ 同样 404（不许暗示"有这么一条"）。
    await t.repos.sim.createSession({
      id: "s-other", tenantId: "zeta", baseSnapshot: {}, scope: {}, status: "RUNNING", curTick: 0,
      parentCheckpointId: null, disabledRuleKeys: [], tickDays: 1, createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect((await assemble(t, { sessionId: "s-other" })).statusCode, "读到了别租户的会话 ⇒ R2 破").toBe(404);
  });

  it("⑤ 可披露：读了哪几格 · 经哪条链路 · 按哪条公式 · 改前改后（铁律 1.5 判据二）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedTicketWorld(t);
    await seedSession(t, "s5", { o1: { costPressure: 100 }, c3: { loadIndex: 40 } });
    const r = ok(await assemble(t, { sessionId: "s5" }));
    const w = r.worldState;
    expect(w, "传了 sessionId 却没有世界态披露 ⇒ 这一层不可披露").not.toBeNull();
    if (!w) return;

    expect(w.sessionId).toBe("s5");
    expect(w.source, "tick0 已落格，应读 TICK 而不是回落快照").toBe("TICK");
    expect(w.agentInvolved, "推演路今天零 LLM，必须明写未调用 agent").toBe(false);
    expect(w.cellsApplied, "一格都没改 ⇒ 世界态没被消费").toBeGreaterThan(0);

    // 每一格都能追到**出处**：压力挂在谁身上、经哪条边、落到哪个对象的哪个属性、改前改后。
    const cost = w.applied.find((c) => c.stateVar === "costPressure");
    expect(cost, "成本压力那一格没进溯源表").toBeTruthy();
    expect(cost!.carrierId, "承载体不是订单自己 ⇒ 取错了").toBe("o1");
    expect(cost!.via, "同对象承载应标 SELF").toBe("SELF");
    expect(cost!.kind).toBe("PROJECTED");
    expect(cost!.after, "改后不大于改前 ⇒ 方向错了").toBeGreaterThan(cost!.before);
    // R14：落点是**词库现判**出来的，不是硬编字段名 —— 本体里没有 unitCost/loadIndex 这些名字。
    expect(cost!.objectType).toBe("TicketOrder");

    // 量纲桥必须随包下发（「凭什么是这个数」当场可查），且与 finance-world 同一座。
    expect(w.pressureUnit).toBe("pp");
    expect(w.divisor).toBe(100);
    expect(w.rules.some((x) => x.stateVar === "costPressure"), "投影声明表没下发").toBe(true);

    // 诚实缺席：世界态里有、本模型没消费的变量必须点名，⛔ 不许留白。
    await seedSession(t, "s5b", { o1: { costPressure: 10, someUnknownPressure: 42 } });
    const w2 = ok(await assemble(t, { sessionId: "s5b" })).worldState!;
    expect(w2.unconsumed.map((u) => u.stateVar), "没被消费的变量留白了 ⇒ 会被读成「这个变量没有压力」")
      .toContain("someUnknownPressure");
  });

  it("⑥ 同名直取：状态变量恰好是本体上的一个属性 ⇒ 直接覆盖（与播种侧同一个身份）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedTicketWorld(t);
    const before = ok(await assemble(t));
    // `seatCapacity` **是 Coach 的真属性**：世界态里同名那一格 ⇒ 直接就是它的值，不折算。
    await seedSession(t, "s6", { c3: { seatCapacity: 7 } });
    const after = ok(await assemble(t, { sessionId: "s6" }));
    expect(capOf(before, "c3")).toBe(30);
    expect(capOf(after, "c3"), "同名属性没被直取 ⇒ 与播种侧 deriveSeedBaseSnapshot 的身份不一致").toBe(7);
    const cell = after.worldState!.applied.find((c) => c.property === "seatCapacity");
    expect(cell?.kind, "同名直取应标 DIRECT 而不是 PROJECTED").toBe("DIRECT");
  });
});
