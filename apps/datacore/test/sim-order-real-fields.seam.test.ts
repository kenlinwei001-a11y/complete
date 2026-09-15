import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { deriveSeedBaseSnapshot, entersSimWorld } from "../src/sim/seed-world.js";
import { buildPropagationInputs } from "../src/sim/propagation-inputs.js";
import { replayWorldLine } from "../src/sim/metric-series.js";
import { resolveSimScope, type Perturbation, type TickState } from "@platform/contracts";
import type { ObjectInstance } from "../src/domain.js";

/**
 * WO-SIM-ORDER-REAL-FIELDS · **接缝门**：订单的真实业务字段 → 推演结果。
 *
 * ══ 本门咬的是链路，不是 `deriveSeedBaseSnapshot` 这一个函数 ═══════════════════════
 *
 * 只断言"播种函数返回了 measuredCells>0"是**已排练不是已实现**（本仓假绿第 9 形态）：
 * 那证明不了那个真值**进了传导式**。所以每一臂都走完整条：
 *
 *   真实对象属性（`Order.qty`/`unitPrice`/`leadDays`）
 *     → `deriveSeedBaseSnapshot` 同名探测（真读数档，`measuredCells += 1`）
 *     → `buildPropagationInputs` 装图/权重/取值域（与 `POST …/tick` 同一处装配）
 *     → `replayWorldLine` 真跑 N 拍
 *     → 下游 `Model.backlogQtyTop` / `backlogPriceTop` / `backlogHorizonDays` 的读数
 *
 * ⛔ 判据一律是**对照实验**（CLAUDE.md 铁律 1.5 判据一），不是"跑得起来吗"：
 *   改一个真值 ⇒ 下游读数必须按可预言的方式变。两个数逐字节相同 = 这条线没通，
 *   报「没通」不许报「差异很小」。
 */

/** 三个真实业务字段 ＝ 状态变量名（同名直取）。改这里就是改被测对象，不是改期望值。 */
const REAL_VARS = ["leadDays", "qty", "unitPrice"] as const;
/** 它们各自的下游落点（`seed.ts` 三条规则的 targetStateVar）。 */
const TOPS = { qty: "backlogQtyTop", unitPrice: "backlogPriceTop", leadDays: "backlogHorizonDays" } as const;

async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });
  return t;
}

/** 走完整条链跑到第 `toTick` 拍，回落盘世界态。**与路由同一处装配**，不在这里手搭引擎。 */
async function runWorld(t: TestApp, toTick: number, perturbations: readonly Perturbation[] = []): Promise<TickState> {
  const { state: seed } = await deriveSeedBaseSnapshot(t.repos, "demo");
  const rules = await t.repos.sim.listPropagationRules("demo", true);
  const inputs = await buildPropagationInputs(t.repos, t.adminCtx, resolveSimScope({}), rules);
  const line = replayWorldLine({
    seed,
    engine: {
      graph: inputs.graph, ruleParams: inputs.ruleParams, cadenceGates: inputs.cadenceGates,
      pairWeights: inputs.pairWeights, stateVarDomains: inputs.stateVarDomains,
    },
    rules: [...rules],
    perturbations,
    toTick,
  });
  return line.states[toTick]!;
}

/** 进推演世界的订单（= `entersSimWorld`，⛔ 不在这里另抄一份成员判据）。 */
async function liveOrders(t: TestApp): Promise<ObjectInstance[]> {
  const all = await t.repos.objects.listByType("demo", "Order");
  return all.filter((o) => entersSimWorld("Order", o));
}

/** 某张订单挂在哪个型号上（走真链路 `order_for_model`，⛔ 不按名字猜）。 */
async function modelOf(t: TestApp, orderId: string): Promise<string> {
  const links = await t.repos.links.list("demo", (l) => l.type === "order_for_model" && l.fromId === orderId);
  expect(links.length, `订单 ${orderId} 必须有 order_for_model 边；0 条说明取边坏了`).toBeGreaterThan(0);
  return links[0]!.toId;
}

const setProp = async (t: TestApp, o: ObjectInstance, patch: Record<string, unknown>): Promise<void> => {
  await t.repos.objects.put({ ...o, props: { ...o.props, ...patch } });
};

describe("WO-SIM-ORDER-REAL-FIELDS · 订单真实字段进推演世界（SEAM）", () => {
  it("①正向 measuredCells = 在手订单数 × 3，且两边**各自独立**算一遍再比", async () => {
    const t = await seededApp();
    const { origin, state } = await deriveSeedBaseSnapshot(t.repos, "demo");

    // ── 算法 A：引擎现场计数（被测对象自己报的数）──
    const reported = origin.measuredCells;

    // ── 算法 B：完全独立地重算一遍 —— 数"进世界的订单 × 真值字段"，不碰 origin ──
    const live = await liveOrders(t);
    // 🐤 金丝雀：在手订单集非空，且确实被 COMPLETED 过滤剔过（剔除数为 0 而对象层有 COMPLETED
    //   ⇒ `entersSimWorld` 没生效，此时**不许**报「没有已完成订单」——见该函数头注）。
    const all = await t.repos.objects.listByType("demo", "Order");
    const completed = all.filter((o) => o.props.status === "COMPLETED").length;
    expect(live.length, "在手订单集不应为空").toBeGreaterThan(0);
    expect(completed, "对象层应当有 COMPLETED 单；为 0 则本用例的过滤臂在空跑").toBeGreaterThan(0);
    expect(all.length - live.length).toBe(completed);

    // 每张在手单的三个字段都必须是有限数（否则它那格会落哈希，B 的算式就不成立）
    for (const o of live) {
      for (const v of REAL_VARS) {
        expect(typeof o.props[v], `${o.id}.${v} 应为 number`).toBe("number");
        expect(Number.isFinite(o.props[v] as number)).toBe(true);
      }
    }
    const independent = live.length * REAL_VARS.length;

    expect(reported, `引擎报 ${reported} 格 vs 独立重算 ${independent} 格`).toBe(independent);
    expect(reported).toBeGreaterThan(0); // 本单的全部意义：这个数以前恒 0

    // ── 而且"实测格"必须**真的等于对象上的那个值**（不是碰巧数对了个数）──
    for (const o of live) {
      for (const v of REAL_VARS) {
        expect(state[o.id]?.[v], `${o.id}.${v} 世界态读数应 === 对象真值`).toBe(o.props[v]);
      }
    }
    // 其余类型仍然全靠派生（⛔ 本单不许把别人的哈希兜底删掉）
    expect(origin.derivedCells).toBeGreaterThan(0);
    expect(origin.measuredCells + origin.derivedCells).toBe(origin.cells);
  }, 180000);

  it("①反向 把某张单的 qty 删掉 ⇒ 该格退回哈希、measuredCells 减 1（只测正向不算）", async () => {
    const t = await seededApp();
    const before = await deriveSeedBaseSnapshot(t.repos, "demo");

    const live = await liveOrders(t);
    const victim = live[0]!;
    const hadValue = victim.props.qty as number;
    expect(Number.isFinite(hadValue)).toBe(true);
    expect(before.state[victim.id]?.qty).toBe(hadValue);

    // 变异：只删这一个属性，别的一个字节不动。
    const { qty: _dropped, ...rest } = victim.props;
    await t.repos.objects.put({ ...victim, props: rest });

    const after = await deriveSeedBaseSnapshot(t.repos, "demo");
    expect(after.origin.measuredCells, "删一个属性 ⇒ 实测格恰好少 1").toBe(before.origin.measuredCells - 1);
    expect(after.origin.cells, "格子总数不变（退回哈希，不是少一格）").toBe(before.origin.cells);
    // 那一格必须**退回哈希**，而不是变成 undefined / 0 / 残留旧值
    const fallen = after.state[victim.id]?.qty;
    expect(typeof fallen).toBe("number");
    expect(fallen).not.toBe(hadValue);
    expect(fallen).toBeGreaterThanOrEqual(0);
    expect(fallen).toBeLessThanOrEqual(100); // 哈希支值域恰为 [0,100]
    // 同一对象的**别的**真值格不受影响（证明变异是定点的，不是把整行打翻）
    expect(after.state[victim.id]?.unitPrice).toBe(victim.props.unitPrice);
  }, 180000);

  it("② 改真值 ⇒ 下游读数必须跟着变：把一张单的价格 ×1.5，重跑同一套推演", async () => {
    const t = await seededApp();
    const live = await liveOrders(t);

    // 取"本型号在手单里单价最高的那张" —— 落点是 max，只有 top 那张才可预言地推动下游。
    // （这不是挑好数：挑一张非 top 的单也能证明"没变"，但那证明的是 max 的语义，不是接线断了。）
    const byModel = new Map<string, ObjectInstance[]>();
    for (const o of live) {
      const m = await modelOf(t, o.id);
      (byModel.get(m) ?? byModel.set(m, []).get(m)!).push(o);
    }
    const [modelId, rows] = [...byModel.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
    const top = [...rows].sort((a, b) => (b.props.unitPrice as number) - (a.props.unitPrice as number))[0]!;

    const worldBefore = await runWorld(t, 3);
    const readBefore = worldBefore[modelId]?.[TOPS.unitPrice];
    expect(typeof readBefore, "下游落点必须真的有读数").toBe("number");
    // 系数 1.0 原样透传 + max ⇒ 下游读数就是那张 top 单的真实单价（可预言，不是"大概相关"）
    expect(readBefore).toBe(top.props.unitPrice);

    await setProp(t, top, { unitPrice: (top.props.unitPrice as number) * 1.5 });

    const worldAfter = await runWorld(t, 3);
    const readAfter = worldAfter[modelId]?.[TOPS.unitPrice];

    expect(
      readAfter,
      `下游读数改前 ${readBefore} 改后 ${readAfter} —— 逐字节相同 = 这条线没通（不是"差异很小"）`,
    ).not.toBe(readBefore);
    expect(readAfter).toBe((top.props.unitPrice as number) * 1.5);
  }, 180000);

  it("③ 两张金额差一个量级的真订单，同一个扰动 ⇒ 下游读数必须拉开", async () => {
    const t = await seededApp();
    const live = await liveOrders(t);

    // 同一个型号下挑两张 qty 差一个量级的单 —— 必须同型号，否则比的是两个不同的落点，
    // "拉开"就成了废话（不同型号本来就不同）。
    const byModel = new Map<string, ObjectInstance[]>();
    for (const o of live) {
      const m = await modelOf(t, o.id);
      (byModel.get(m) ?? byModel.set(m, []).get(m)!).push(o);
    }
    let picked: { modelId: string; big: ObjectInstance; small: ObjectInstance } | null = null;
    for (const [modelId, rows] of byModel) {
      const sorted = [...rows].sort((a, b) => (b.props.qty as number) - (a.props.qty as number));
      const big = sorted[0]!, small = sorted[sorted.length - 1]!;
      if ((big.props.qty as number) >= (small.props.qty as number) * 10) { picked = { modelId, big, small }; break; }
    }
    expect(picked, "种子里应当存在同型号下 qty 差一个量级的两张单").not.toBeNull();
    const { modelId, big, small } = picked!;

    /**
     * 同一个扰动 = 同一个 kind/mode/magnitude/startTick，只换落点对象。
     * 幅度取得足够大，保证被扰的那张单在本型号内成为 top —— 否则 `max` 会把它盖掉，
     * 于是"读数没变"就变成了 max 语义的体现，而不是真值有没有进传导式的证据。
     */
    const bump = (o: ObjectInstance): Perturbation[] => [{
      id: `pt_${o.id}`, tenantId: "demo", sessionId: "s", kind: "OTHER",
      targetObjectId: o.id, targetStateVar: "qty",
      startTick: 1, durationTicks: null, magnitude: 100000, mode: "delta",
      label: "同一个扰动（只换落点）", createdAt: "2026-01-01T00:00:00.000Z",
    }];

    const readBig = (await runWorld(t, 3, bump(big)))[modelId]?.[TOPS.qty];
    const readSmall = (await runWorld(t, 3, bump(small)))[modelId]?.[TOPS.qty];

    expect(typeof readBig).toBe("number");
    expect(typeof readSmall).toBe("number");
    expect(
      readBig,
      `大单 ${big.props.qty} 套得 ${readBig}，小单 ${small.props.qty} 套得 ${readSmall} —— ` +
        `两者相同 ⇒ 真值没进传导式，只是存下来了`,
    ).not.toBe(readSmall);
    // 可预言：差额恰等于两张单真实台数之差（系数 1.0 + delta 同幅 + max）
    expect((readBig as number) - (readSmall as number))
      .toBe((big.props.qty as number) - (small.props.qty as number));
  }, 180000);

  it("④ R6：同 (industry, scale, seed) 重跑，世界态逐字节一致", async () => {
    const a = await seededApp();
    const b = await seededApp();
    const wa = await runWorld(a, 3);
    const wb = await runWorld(b, 3);
    // 🐤 金丝雀：世界非空且真含实测格（空世界上 "两次相同" 恒真）
    const { origin } = await deriveSeedBaseSnapshot(a.repos, "demo");
    expect(origin.measuredCells).toBeGreaterThan(0);
    expect(JSON.stringify(wa)).toBe(JSON.stringify(wb));

    // 同一棵树连跑两次也必须一致（`propagateTick` 保持纯函数）
    expect(JSON.stringify(await runWorld(a, 3))).toBe(JSON.stringify(wa));
  }, 180000);

  it("⑤ 接缝：真值必须**出现在传导结果里**，且 max 语义不随拍数漂（不是纯积分器）", async () => {
    const t = await seededApp();
    const live = await liveOrders(t);
    const byModel = new Map<string, ObjectInstance[]>();
    for (const o of live) {
      const m = await modelOf(t, o.id);
      (byModel.get(m) ?? byModel.set(m, []).get(m)!).push(o);
    }

    const w1 = await runWorld(t, 1);
    const w5 = await runWorld(t, 5);

    for (const [modelId, rows] of byModel) {
      for (const v of REAL_VARS) {
        const expected = Math.max(...rows.map((o) => o.props[v] as number));
        const target = TOPS[v];
        // 落点读数 === 该型号在手订单里那个字段的真实最大值（系数 1.0 原样透传）
        expect(w1[modelId]?.[target], `${modelId}.${target} @tick1`).toBe(expected);
        /**
         * ⚠ 这一条是本门最要紧的一格：`combine:"max"` 每拍重算、不吃上一拍的值。
         * 若哪天有人把这三条改成 `combine:"sum"`，读数会一拍比一拍大（纯积分器），
         * 到 tick5 就是个没有业务含义的数 —— 而且**不会有别的东西报错**，
         * 因为这三个量刻意不在 `STATE_VAR_DOMAINS` 里，引擎不夹不衰减。
         */
        expect(w5[modelId]?.[target], `${modelId}.${target} @tick5 必须与 @tick1 相同（max 不累加）`)
          .toBe(expected);
      }
    }
  }, 180000);
});
