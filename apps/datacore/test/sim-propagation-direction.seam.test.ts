import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

/**
 * WO-SANDBOX-PROP-DIRECTION · 传导方向的**效果层**接缝门（欠账 #158 的复发闸）。
 *
 * ── 为什么已经有 `seed-demo-propagation.test.ts` 了还要这一支 ────────────────────────
 * 那支已有两道门，但它们咬的东西**都不是「这条规则在真 tick 里传导了多少」**：
 *  · 「方向可达门」咬的是**链路表**（`links.some(...)`）—— 证明"图上走得通"，
 *    证明不了"引擎真的沿这个方向算了"。图对而引擎 navOut 写反，它照样绿。
 *  · 「六方向逐条真触发」咬的是 `fired.has(ruleKey)` —— 证明"trace 里出现过这个名字"，
 *    证明不了"下游那个数真的变成了它该变成的值"。系数读错/贡献写到别的对象上，它照样绿。
 * 本文件补的正是那两道门中间的缝：**沿真 seed 的真链路，把一次扰动的数值一路咬到第三跳**，
 * 并且**把方向本身做成可反证的判据**（反转链路 ⇒ 规则必须不触发）。
 *
 * ── #158 的账与实测结论 ────────────────────────────────────────────────────────────
 * 立账原文：出厂种子规则 `demo_line_util_to_base_load`「从不触发，疑链路方向反了」。
 * 实测（本文件 + 真起服务 curl 双证）：**方向确实曾经反过，但已由 WO-P1 修复并改名**——
 * 今天的种子是 `demo_base_load_to_line_util`（`seed.ts:279`），
 * 声明 `Base.loadIndex --line_belongs_to_base--> Line.utilPressure`，
 * 与本体单源 `battery.ts:2321`（`fromTypeKey:"Base", toTypeKey:"Line"`）一致，**真的会触发**。
 * 故 #158 对**引擎/种子**这一半是**已闭**；本文件把它钉成回归门，防止再被改反。
 *
 * ⚠ 三种"不工作"在这里被拆开咬（铁律 0.5，修法完全不同）：
 *  · 「接错方向」→ 断言 ③（反转链路 ⇒ 必须不触发）
 *  · 「接了线没数据」→ 断言 ① 的前置（源端 `Base.loadIndex` 若恒 0，`propagation.ts:596`
 *    的 `if (sourceVal === 0) continue` 会直接跳过 ⇒ 本文件用**真扰动路由**把源端喂成非 0，
 *    这也正是 #158 立账时的第二种死法）
 *  · 「没接线」→ 断言 ① 本身（trace 里真有这条 ruleKey）
 */

const enableSim = async (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 常州基地 —— demo 世界里 `line_belongs_to_base` 出边最全的一个（实测 10 条产线）。 */
const BASE_ID = "obj_base_changzhou";

interface TickResp {
  curTick: number;
  state: Record<string, Record<string, number>>;
  trace: { ruleKey: string; fromObjectId: string; toObjectId: string; amount: number; viaLinkKey: string }[] | null;
}

/** 真 seed + 真规则 + 打开功能位。返回可直接建会话的 app。 */
async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await enableSim(t);
  return t;
}

/** 建会话 → 经**真扰动路由**把源端喂非 0（不是直写 baseSnapshot——那样测不到写端接缝）。 */
async function sessionWithBaseLoad(t: TestApp, loadIndex: number): Promise<string> {
  const created = await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
    payload: { baseSnapshot: { [BASE_ID]: { loadIndex: 0 } } },
  });
  expect(created.statusCode).toBe(201);
  const sid = created.json().id as string;
  const p = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
    payload: {
      kind: "capacity_loss", targetObjectId: BASE_ID, targetStateVar: "loadIndex",
      magnitude: loadIndex, mode: "set", label: `基地负载置为 ${loadIndex}`,
    },
  });
  expect(p.statusCode).toBe(201);
  return sid;
}

const tick = async (t: TestApp, sid: string): Promise<TickResp> => {
  const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
  expect(r.statusCode).toBe(200);
  return r.json() as TickResp;
};

describe("WO-SANDBOX-PROP-DIRECTION · 出厂传导规则的方向（#158 复发闸）", () => {
  // ── ① 效果层：一次真扰动，数值一路咬到第三跳 ───────────────────────────────────────
  it("🔴 效果层 SEAM：Base.loadIndex 扰动 → 沿 line_belongs_to_base 真传导到 Line.utilPressure（数值断言）", async () => {
    const t = await seededApp();
    const sid = await sessionWithBaseLoad(t, 20);

    // 前置事实：这条边在**真链路表**上确实是 Base→Line，且常州基地真有 10 条出边。
    // （不先钉这个，下面的数值断言在"链路根本没种"时会以另一种理由变红，指错方向。）
    const outLinks = await t.repos.links.list("demo", (l) => l.type === "line_belongs_to_base" && l.fromId === BASE_ID);
    expect(outLinks.length).toBe(10);
    const lineIds = outLinks.map((l) => l.toId).sort();

    // tick1：规则带 delayTicks=1 ⇒ 本 tick 只排进 pending，尚未到达（这一格必须为 0，
    // 否则说明延迟被忽略了 —— 那是另一个 bug，不该被"最终值对了"盖过去）。
    const t1 = await tick(t, sid);
    expect(t1.curTick).toBe(1);
    for (const lineId of lineIds) expect(t1.state[lineId]?.utilPressure ?? 0).toBe(0);

    // tick2：延迟贡献到达。20 × 0.5 = 10，**每条产线各得 10**（combine:"sum"，一源十目标）。
    const t2 = await tick(t, sid);
    expect(t2.curTick).toBe(2);
    // 🔴 判据 a：这条规则真的出现在 trace 里（不是"规则能被解析"）。
    const fired = (t2.trace ?? []).filter((x) => x.ruleKey === "demo_base_load_to_line_util");
    expect(fired.length).toBe(10);
    expect(fired.map((x) => x.toObjectId).sort()).toEqual(lineIds);
    expect(fired.every((x) => x.amount === 10)).toBe(true);
    // 🔴 判据 b：下游状态变量**真的变了**，且变成了它该变成的那个数（不是 ">0"）。
    for (const lineId of lineIds) expect(t2.state[lineId]!.utilPressure).toBe(10);
    // 源端没被写坏（扰动是 set 20，传导不回写源）。
    expect(t2.state[BASE_ID]!.loadIndex).toBe(20);
    // 别的基地的产线**不该**被写到（证明贡献是沿这条基地的出边走的，不是全表刷）。
    const foreign = await t.repos.links.list("demo", (l) => l.type === "line_belongs_to_base" && l.fromId !== BASE_ID);
    expect(foreign.length).toBeGreaterThan(0); // 金丝雀：确实存在别家的产线，这条断言不是空转
    for (const l of foreign) expect(t2.state[l.toId]?.utilPressure ?? 0).toBe(0);

    // 🔴 判据 c：第三跳。#158 修好之前 `Line.utilPressure` 是**没有任何产出者的死源**，
    // 所以 `demo_line_util_to_process_queue` 也跟着永远拿不到输入。方向修对之后这一跳才通。
    const t3 = await tick(t, sid);
    const q = (t3.trace ?? []).filter((x) => x.ruleKey === "demo_line_util_to_process_queue");
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((x) => x.amount === 7)).toBe(true); // 10 × 0.7
    const processId = q[0]!.toObjectId;
    expect(t3.state[processId]!.queuePressure).toBe(7);
  });

  // ── ② 方向性反证：把 link 方向反过来 ⇒ 规则不应触发 ─────────────────────────────────
  // 这一条是本单的**核心判据**：证明上面那道门咬的是**方向**，不是"这条规则存在"。
  // 没有它，把 `viaLinkKey` 换成任意一条恰好也从 Base 出发的边，① 也可能照样绿。
  it("🔴 方向性反证：把 line_belongs_to_base 全部反向（Line→Base）⇒ 该规则必须不触发（金丝雀同跑）", async () => {
    const t = await seededApp();

    // ⚠ **前提断言（防本用例变成空转）**：本用例咬的是"把边反过来 ⇒ 那条规则不触发"，
    // 它隐含一个前提 —— 规则此刻确实声明 `Base --line_belongs_to_base--> Line`。
    // 没有这三行，一旦有人把种子改回 #158 原文（规则变成 Line→Base、key 也换了名），
    // 下面 `allKeys.has("demo_base_load_to_line_util")` 会**因为这个名字压根不存在**而恒 false ⇒
    // 本用例**假绿**（实测：变异反证时 ①③ 都红了，唯独这一条绿着）。把前提钉死，空转即红。
    const underTest = (await t.repos.sim.listPropagationRules("demo", true))
      .find((r) => r.viaLinkKey === "line_belongs_to_base")!;
    expect(underTest).toBeDefined();
    expect([underTest.key, underTest.sourceTypeKey, underTest.targetTypeKey])
      .toEqual(["demo_base_load_to_line_util", "Base", "Line"]);

    // 把真链路表里这条 key 的每一行**原地反向**（fromId/toId 互换），其余链路一律不动。
    const orig = await t.repos.links.list("demo", (l) => l.type === "line_belongs_to_base");
    expect(orig.length).toBeGreaterThan(0); // 金丝雀：确实反转到了东西，不是对空集操作
    for (const l of orig) await t.repos.links.put({ ...l, fromId: l.toId, toId: l.fromId });
    // 自证反转真的落盘了（否则下面的"不触发"可能只是没反转成功）。
    const after = await t.repos.links.list("demo", (l) => l.type === "line_belongs_to_base" && l.fromId === BASE_ID);
    expect(after.length).toBe(0);

    const sid = await sessionWithBaseLoad(t, 20);
    // 同一个会话里再喂一个**金丝雀源**：Order.demandPressure 走 order_for_model（未被反转的边）。
    const orderLink = (await t.repos.links.list("demo", (l) => l.type === "order_for_model"))[0]!;
    await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: {
        kind: "demand_shift", targetObjectId: orderLink.fromId, targetStateVar: "demandPressure",
        magnitude: 10, mode: "set", label: "金丝雀：订单需求压力 10",
      },
    });

    const t1 = await tick(t, sid);
    const t2 = await tick(t, sid);
    const allKeys = new Set([...(t1.trace ?? []), ...(t2.trace ?? [])].map((x) => x.ruleKey));

    // 🐤 金丝雀先说话：观测方法本身是好的 —— 未被反转的那条边照常触发。
    // 若这一行也红，结论是「观测坏了」，**不许**读作「规则不触发」（铁律 0.6）。
    expect(allKeys.has("demo_order_demand_pressure")).toBe(true);
    // 10 × 0.8 = 8 每 tick 一次。扰动是 `set` 且 `durationTicks:null` ⇒ 源端每 tick 都是 10，
    // `combine:"sum"` 在上一格的值上继续累加 ⇒ 8 → 16。两格都钉住，金丝雀才既证"会触发"
    // 又证"数是对的"（只钉一格的话，把系数改坏也可能碰巧还在)。
    expect(t1.state[orderLink.toId]!.demandLoad).toBe(8);
    expect(t2.state[orderLink.toId]!.demandLoad).toBe(16);

    // 🔴 判据：方向反了 ⇒ 这条规则一次都不触发，下游一个字节都不动。
    expect(allKeys.has("demo_base_load_to_line_util")).toBe(false);
    for (const l of orig) expect(t2.state[l.toId]?.utilPressure ?? 0).toBe(0);
    // 而源端**始终非 0** —— 证明"没传导"不是因为源没数据（那是另一种死法，修法完全不同：
    // `propagation.ts:596` 的 `if (sourceVal === 0) continue` 会以完全相同的外观跳过这条规则）。
    // t1 恰好 20：扰动真的落进去了，且这一格还没有别的东西写它。
    expect(t1.state[BASE_ID]!.loadIndex).toBe(20);
    // t2 = 24.8：金丝雀自己的链会绕回来喂 Base —— Order(10)×0.8 = Model.demandLoad 8 @t1，
    // 再 ×0.6 = 4.8 沿 model_producible_at 落到 Base.loadIndex @t2 ⇒ 20 + 4.8。
    // 这个数刻意钉死而不写 `>0`：它同时证明"源非 0"和"这一格的世界确实在演化"。
    expect(t2.state[BASE_ID]!.loadIndex).toBe(24.8);
  });

  // ── ③ 种子的方向必须与本体单源一致（把 #158 的成因钉在种子这一层）────────────────────
  it("🔴 种子方向 = 本体单源：demo_base_load_to_line_util 的三元组与 ontology linkType 声明一字不差", async () => {
    const t = await seededApp();
    const rules = await t.repos.sim.listPropagationRules("demo", true);
    const rule = rules.find((r) => r.viaLinkKey === "line_belongs_to_base");
    expect(rule).toBeDefined();
    // 本体单源经**真路由**读回（不是读 battery.ts 常量——那样测的是我抄得对不对，不是系统下发的对不对）。
    const reg = (await (await t.app.inject({
      method: "GET", url: "/a/v1/ontology/mapping/registries", headers: ADMIN,
    })).json()) as { linkTypes: { key: string; fromType: string; toType: string }[] };
    const decl = reg.linkTypes.find((l) => l.key === "line_belongs_to_base");
    expect(decl).toEqual({ key: "line_belongs_to_base", fromType: "Base", toType: "Line", cardinality: "1:N" });
    expect([rule!.sourceTypeKey, rule!.targetTypeKey]).toEqual([decl!.fromType, decl!.toType]);
    // #158 原文的方向（Line→Base）在今天的种子里**必须已经不存在**。
    expect(rules.some((r) => r.key === "demo_line_util_to_base_load")).toBe(false);
  });
});
