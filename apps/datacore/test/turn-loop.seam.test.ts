import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { deriveTurnDynamics, readWorldLine, WORLD_LINE_DEFAULT_WINDOW } from "../src/sim/world-line.js";

/**
 * WO-TURN-LOOP · **接缝门**：回合（第 N 拍）这件事对**求解器**可见。
 *
 * ── 这道门为什么必须接缝驱动、不能各半 unit ────────────────────────────────────────
 * 本单跨**沙盘半**（世界线落盘 `putTickState` / 取回 `listTickStates`）与**求解器半**
 * （`finance_world_projection` 沿世界线逐帧聚合）。各半分开测都能全绿而功能是坏的：
 *   · 只测 `deriveTurnDynamics` 纯函数 ⇒ 它当然对，但求解器可能压根没调它
 *     （本仓的假绿第 9 形态：测试咬的是**函数**不是**链路**）；
 *   · 只测 tick 路 ⇒ 世界线是对的，而求解器仍只读 `curTick` 一格，屏上永远看不到回合。
 * 所以①②③ 一律走**真路由 inject**（真种子 → 真规则 → 真会话 → 真扰动 → 真 tick → 真 invoke）。
 *
 * ── 用哪条链（为什么是这条）────────────────────────────────────────────────────────
 * `Material.priceShock --×0.65--> Model.costPressure --×0.9--> Order.costPressure`
 * （出厂种子实测：46 条规则里通往 `Order.costPressure` 的就这一条两跳链）。
 * 选它的理由是**读数可预言**：源涨 ⇒ 下游必涨，且要跨 2 跳才到，所以前两拍必然还是 0 ——
 * "第几拍才看得见"本身就是回合语义，单张快照答不出来。
 *
 * ⚠ 本文件**不新增门/棘轮/基线 JSON**（禁令 3），就是一个普通 vitest 接缝测试。
 */

const enableSim = async (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 三元正极 —— demo 世界里 `priceShock` 有下游成本链的物料（实测 8 个 Material 之一）。 */
const MAT_ID = "obj_material_pos_ncm";
const AL_ID = "obj_material_al_foil";

async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await enableSim(t);
  return t;
}

async function newSession(t: TestApp): Promise<string> {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { scope: { mode: "GLOBAL" } } });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}

async function perturb(t: TestApp, sid: string, objectId: string, magnitude: number, startTick: number): Promise<void> {
  const r = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
    payload: { kind: "cost_shock", targetObjectId: objectId, targetStateVar: "priceShock", magnitude, mode: "set", startTick, durationTicks: null, label: `${objectId} +${magnitude}` },
  });
  expect(r.statusCode).toBe(201);
}

/**
 * 扰**带回合延迟的那条边**的源端：`WorkOrder.releasePressure --×0.5 delay1--> Model.costPressure`。
 *
 * ⚠ 为什么顺序判据非它不可（实测逼出来的，写在这防止下次又被简化掉）：
 * 两条 `Material.priceShock` 都是 **delay 0 + combine:"sum" + mode:"set" + 永久生效**，
 * 到末拍两条都还开着 ⇒ 求和**天然可交换**，换顺序结果当然一样。那**不是**"回合没接上"，
 * 是这组扰动本身就没有顺序可言。**顺序要有意义，路径上必须有记忆** ——
 * 延迟(delayTicks) / 衰减(decay) / 饱和(clamp) 三者之一。本用例选延迟。
 */
async function perturbDelayed(t: TestApp, sid: string, objectId: string, magnitude: number, startTick: number): Promise<void> {
  const r = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
    payload: { kind: "capacity_loss", targetObjectId: objectId, targetStateVar: "releasePressure", magnitude, mode: "set", startTick, durationTicks: null, label: `${objectId} 投产压力 ${magnitude}` },
  });
  expect(r.statusCode).toBe(201);
}

/** 取一个真实存在的 `WorkOrder` id（不写死：种子改了要红在断言上，不该红在"找不到对象"上）。 */
async function someWorkOrderId(t: TestApp): Promise<string> {
  const wos = await t.repos.objects.listByType("demo", "WorkOrder");
  expect(wos.length).toBeGreaterThan(0); // 金丝雀：种子真的有 WorkOrder
  return [...wos].map((o) => o.id).sort()[0]!;
}

const tick = async (t: TestApp, sid: string): Promise<void> => {
  const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { ticks: 1 } });
  expect(r.statusCode).toBe(200);
};

interface TurnDyn {
  trajectory: { tick: number; value: number }[];
  deltaFromPrev: number | null;
  direction: string;
  peak: { tick: number; value: number } | null;
  accumulated: number;
  ticksUsed: number;
}
interface FinanceOut {
  worldId: string;
  curTick: number;
  pressures: { stateVar: string; value: number }[];
  turnDynamics?: { curTick: number; ticksUsed: number; windowRequested: number; truncated: boolean; note: string | null; byStateVar: Record<string, TurnDyn> };
  [k: string]: unknown;
}

const project = async (t: TestApp, sid: string, turnWindow?: number): Promise<FinanceOut> => {
  const r = await t.app.inject({
    method: "POST", url: "/a/v1/solvers/finance_world_projection/invoke", headers: ADMIN,
    payload: { args: { worldId: sid, ...(turnWindow ? { turnWindow } : {}) } },
  });
  expect(r.statusCode).toBe(200);
  return (r.json().data ?? r.json()) as FinanceOut;
};

/** 排除会话身份后的指纹 —— `worldId` 与内嵌它的 `summary` 每次必然不同，那是身份不是结果。 */
const fingerprint = (o: FinanceOut): string => {
  const c: Record<string, unknown> = { ...o };
  delete c.worldId;
  delete c.summary;
  return JSON.stringify(c);
};

describe("WO-TURN-LOOP · 回合推进对求解器可见（接缝）", () => {
  // ── ① 金丝雀先跑：轨迹取法有鉴别力 ────────────────────────────────────────────────
  it("🐤 金丝雀：扰动幅度不同 ⇒ 轨迹必须不同（否则量法坏了，下面结论一律不许信）", async () => {
    const t = await seededApp();
    const big = await newSession(t);
    await perturb(t, big, MAT_ID, 20, 0);
    for (let i = 0; i < 3; i++) await tick(t, big);
    const small = await newSession(t);
    await perturb(t, small, MAT_ID, 5, 0);
    for (let i = 0; i < 3; i++) await tick(t, small);

    const a = (await project(t, big)).turnDynamics!.byStateVar.costPressure!;
    const b = (await project(t, small)).turnDynamics!.byStateVar.costPressure!;
    // 金丝雀：末拍必须都非 0（链真的通），且两者不等（读数真的随扰动动）。
    expect(a.trajectory[a.trajectory.length - 1]!.value).toBeGreaterThan(0);
    expect(b.trajectory[b.trajectory.length - 1]!.value).toBeGreaterThan(0);
    expect(a.trajectory[a.trajectory.length - 1]!.value).not.toBe(b.trajectory[b.trajectory.length - 1]!.value);
  });

  // ── ② 核心接缝：求解器读得到**前若干拍**，不只是当前一格 ──────────────────────────
  it("🔴 SEAM：tick×3 后求解器给出 4 拍轨迹，且前两拍为 0（两跳链的到达延迟 = 回合语义）", async () => {
    const t = await seededApp();
    const sid = await newSession(t);
    await perturb(t, sid, MAT_ID, 20, 0);
    for (let i = 0; i < 3; i++) await tick(t, sid);

    const out = await project(t, sid);
    const td = out.turnDynamics;
    expect(td).toBeDefined();
    expect(td!.curTick).toBe(3);
    // 缺省窗口 4 = 当前 + 前 3 ⇒ t0..t3 全在。
    expect(td!.ticksUsed).toBe(Math.min(WORLD_LINE_DEFAULT_WINDOW, 4));
    const cp = td!.byStateVar.costPressure!;
    expect(cp.trajectory.map((p) => p.tick)).toEqual([0, 1, 2, 3]);
    // 两跳链：t0/t1 还没传到 ⇒ 必须是 0；t2 起必须抬头。这四个数**单张快照给不出**。
    expect(cp.trajectory[0]!.value).toBe(0);
    expect(cp.trajectory[1]!.value).toBe(0);
    expect(cp.trajectory[2]!.value).toBeGreaterThan(0);
    expect(cp.trajectory[3]!.value).toBeGreaterThan(cp.trajectory[2]!.value);
    expect(cp.direction).toBe("RISING");
    expect(cp.peak!.tick).toBe(3);
    // 末拍值必须与既有 `pressures` 里那一行**同一个数** —— 两处口径若漂，曲线就与当前值对不上。
    const cur = out.pressures.find((p) => p.stateVar === "costPressure")!;
    expect(cp.trajectory[3]!.value).toBe(cur.value);
  });

  // ── ③ 顺序敏感性：本单的要害判据 ────────────────────────────────────────────────
  it("🔴 SEAM：同样三次扰动换先后顺序 ⇒ 结果必须不同（相同则说明回合没接上，只是快照重算）", async () => {
    const t = await seededApp();
    const woId = await someWorkOrderId(t);
    // 三次扰动里**必须**有一次落在带 delay 的边上（理由见 `perturbDelayed` 头注）。
    const fwd = await newSession(t);
    await perturb(t, fwd, MAT_ID, 20, 0);
    await perturb(t, fwd, AL_ID, 15, 1);
    await perturbDelayed(t, fwd, woId, 30, 2);
    for (let i = 0; i < 3; i++) await tick(t, fwd);

    const rev = await newSession(t);
    await perturbDelayed(t, rev, woId, 30, 0);
    await perturb(t, rev, AL_ID, 15, 1);
    await perturb(t, rev, MAT_ID, 20, 2);
    for (let i = 0; i < 3; i++) await tick(t, rev);

    const a = await project(t, fwd);
    const b = await project(t, rev);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
    // 且差异必须落在**轨迹**上，不是只差个 id —— 否则这条断言会被无关字段的抖动喂饱。
    const ta = a.turnDynamics!.byStateVar.costPressure!.trajectory.map((p) => p.value);
    const tb = b.turnDynamics!.byStateVar.costPressure!.trajectory.map((p) => p.value);
    expect(ta).not.toEqual(tb);
  });

  // ── ③b 顺序**不**敏感的那一半：可交换扰动换顺序结果相同，这是对的，不是缺陷 ──────────
  it("⚖️ 边界：两条 delay0 可加扰动换顺序 ⇒ 结果相同（顺序要有意义，路径上必须有记忆）", async () => {
    const t = await seededApp();
    const run = async (first: string, second: string): Promise<FinanceOut> => {
      const sid = await newSession(t);
      await perturb(t, sid, first, first === MAT_ID ? 20 : 15, 0);
      await perturb(t, sid, second, second === MAT_ID ? 20 : 15, 1);
      for (let i = 0; i < 3; i++) await tick(t, sid);
      return project(t, sid);
    };
    // 两条都走 `Material.priceShock --×0.65 delay0--> Model.costPressure`，combine:"sum"、永久生效
    // ⇒ 末拍两条都还开着，求和可交换。**若这条断言某天变红**，说明有人给这条边加了
    // 延迟/衰减/饱和，那时该更新的是这条注释，不是把上面那条顺序判据删掉。
    expect(fingerprint(await run(MAT_ID, AL_ID))).toBe(fingerprint(await run(AL_ID, MAT_ID)));
  });

  // ── ④ 确定性：同扰动同顺序两跑，除会话身份外逐字节相同 ───────────────────────────
  it("🔒 R6：同扰动同顺序重跑 ⇒ 除 worldId/summary 外逐字节相同（回合不许引入随机性）", async () => {
    const t = await seededApp();
    const run = async (): Promise<FinanceOut> => {
      const sid = await newSession(t);
      await perturb(t, sid, MAT_ID, 20, 0);
      await perturb(t, sid, AL_ID, 15, 1);
      for (let i = 0; i < 3; i++) await tick(t, sid);
      return project(t, sid);
    };
    expect(fingerprint(await run())).toBe(fingerprint(await run()));
  });

  // ── ⑤ 反向对照：不推进的世界，既有读数不变、回合量诚实缺席 ───────────────────────
  it("🔁 反向对照：tick×0 ⇒ 单帧世界 direction=UNKNOWN / delta=null，既有 pressures 不受影响", async () => {
    const t = await seededApp();
    const sid = await newSession(t);
    await perturb(t, sid, MAT_ID, 20, 0);
    const out = await project(t, sid); // 一拍都不推

    expect(out.curTick).toBe(0);
    const cp = out.turnDynamics!.byStateVar.costPressure!;
    // "看不出来" ≠ "没变"：单帧必须 UNKNOWN，绝不许报 FLAT。
    expect(cp.direction).toBe("UNKNOWN");
    expect(cp.deltaFromPrev).toBeNull();
    expect(cp.ticksUsed).toBe(1);
    expect(out.turnDynamics!.note).toContain("尚未推进过");
    // 既有读数：未推进 ⇒ 传导没跑 ⇒ 压力仍为 0（本单不许改既有行为）。
    expect(out.pressures.find((p) => p.stateVar === "costPressure")!.value).toBe(0);
  });

  // ── ⑥ 窗口：世界线比窗口长时必须诚实标 truncated ─────────────────────────────────
  it("📏 窗口：tick×5 + turnWindow=3 ⇒ 只回 3 拍且 truncated=true（不假装看全了）", async () => {
    const t = await seededApp();
    const sid = await newSession(t);
    await perturb(t, sid, MAT_ID, 20, 0);
    for (let i = 0; i < 5; i++) await tick(t, sid);

    const td = (await project(t, sid, 3)).turnDynamics!;
    expect(td.windowRequested).toBe(3);
    expect(td.ticksUsed).toBe(3);
    expect(td.truncated).toBe(true);
    expect(td.byStateVar.costPressure!.trajectory.map((p) => p.tick)).toEqual([3, 4, 5]);
  });

  // ── ⑦ 纯函数：拿掉世界线，回合量必须全部塌成"不知道" ─────────────────────────────
  it("🧮 纯函数：单点轨迹 ⇒ UNKNOWN/null；空轨迹 ⇒ 全空（回合量确实来自序列，不是现算）", () => {
    const one = deriveTurnDynamics([{ tick: 7, value: 42 }]);
    expect(one.direction).toBe("UNKNOWN");
    expect(one.deltaFromPrev).toBeNull();
    expect(one.maxStep).toBeNull();
    expect(one.peak).toEqual({ tick: 7, value: 42 });

    const none = deriveTurnDynamics([]);
    expect(none.direction).toBe("UNKNOWN");
    expect(none.peak).toBeNull();
    expect(none.ticksUsed).toBe(0);

    // 乱序输入必须按 tick 归位（R6：调用方给的顺序不许影响结果）。
    const shuffled = deriveTurnDynamics([{ tick: 2, value: 5 }, { tick: 0, value: 1 }, { tick: 1, value: 3 }]);
    expect(shuffled.trajectory.map((p) => p.tick)).toEqual([0, 1, 2]);
    expect(shuffled.direction).toBe("RISING");
    expect(shuffled.deltaFromPrev).toBe(2);
    expect(shuffled.accumulated).toBe(9);
  });

  // ── ⑧ 读取器：会话没有世界线时诚实说"读不到"，不冒充"历史为空" ───────────────────
  it("🕳 读取器：无世界线 ⇒ frames 空 + note 点明「读不到历史」（不与「历史为空」混为一谈）", async () => {
    const t = await seededApp();
    const wl = await readWorldLine(t.repos, "demo", "sims_does_not_exist", 3);
    expect(wl.frames.length).toBe(0);
    expect(wl.ticksUsed).toBe(0);
    expect(wl.note).toContain("读不到历史");
  });
});
