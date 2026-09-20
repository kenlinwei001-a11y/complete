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
 * `Material.priceShock --> Model.costPressure --> Order.costPressure`
 * （出厂种子实测：46 条规则里通往 `Order.costPressure` 的就这一条两跳链）。
 * ⚠ 本行原写 `×0.65` / `×0.9`，**两个系数都已过期**（2026-09-20 实测订正）：求解器自己下发的
 * `chain` 里是 `demo_material_price_to_model_cost` **0.15684781** ·
 * `demo_model_cost_to_order_cost` **0.2775**，两条 `delayTicks` 均为 **0**
 * （两跳仍要两拍：第 1 拍写 Model，第 2 拍 Model 才喂 Order）。系数以 `chain` 下发值为准，别信这行注释。
 * 选它的理由是**读数可预言**：源涨 ⇒ 下游必涨，且要跨 2 跳才到，所以前两拍必然还是 0 ——
 * "第几拍才看得见"本身就是回合语义，单张快照答不出来。
 *
 * ⚠ 本文件**不新增门/棘轮/基线 JSON**（禁令 3），就是一个普通 vitest 接缝测试。
 *
 * ── ⚠ 2026-09-20 判据换轨：tick0 起点**不再是空世界** ────────────────────────────────
 * **病因（不是本文件的错，是它的前提被换掉了）**：`a67ed05c`（WO-SANDBOX-REAL-SNAPSHOT
 * 后端半，抢救提交·提交信息自述「未经任何验证，未跑测试」）把 `createSimSessionWorld` 从
 *   `const base = input.baseSnapshot ?? {};`            ← 不传 ⇒ **空世界**
 * 改成「不传 `baseSnapshot` ⇒ 服务端 `deriveSeedBaseSnapshot` 从真实对象派生 tick0 世界」。
 * 本文件的 `newSession()` 正是**不传** `baseSnapshot` 的那条路 ⇒ 起点从「0 个承载对象」
 * 变成「150/500 张订单带 `costPressure`」⇒ 原来那几条 `toBe(0)` 全部失去前提。
 * ⇒ **`toBe(0)` 当年为真，靠的是「聚合了个空集」，而不是「到达延迟」** —— 判据一直没在
 *   度量它自称度量的东西。换轨后（对照臂）才真的在度量。
 *
 * ── ✅ 2026-09-20 结案：上一版头注里那条「与扰动幅度不单调」是**误读，不是缺陷** ──────────
 * 原文（现已删除）写：不扰动 `[…13.059346]` · +20 `[…12.963336]` · +40 `[…13.070014]`
 * 「+40 比 +20 高」，并留作独立工单。**实测推翻：那三条读数全对，结论全错。**
 *
 * 病因是**量法**不是引擎：`perturb()` 用的是 `mode:"set"`，而 `Material.priceShock` 的
 * tick0 起点**不是 0** —— `deriveSeedBaseSnapshot` 给 `obj_material_pos_ncm` 播的是 **38**
 * （⛔ 不在 `Material.props` 上，8 个 Material 的 `props.priceShock` 实测全 `undefined`，
 * 只在世界态里；所以 grep 种子文件永远找不到它）。⇒ `set M` 的**真实冲击是 `M − 38`**：
 *   · 「+20」其实是 **−18**（降价！）· 「+40」其实是 **+2** · 「不扰动」其实是 **+0**
 * 逐字节旁证：`mode:"delta"` 的 `+2` 臂轨迹 = `[17.213662, 15.715810, 14.044885, 13.070014]`
 * 与上面那条「+40」**一字不差**；`delta +0` 臂 = 「不扰动」臂一字不差。
 * ⇒ 「+40 比 +20 高」正是**单调**的表现（+2 > −18），不是反常。
 *
 * 真·相对扰动（`mode:"delta"`）下，0→+1000 十一个点上聚合值/单对象值**严格单调**（§⑩ 咬住）。
 * 「下行」本身也不是缺陷：递推式是 `x(t+1)=rest+(1−λ)(x(t)−rest)+inflow`（`propagation.ts` 衰减相），
 * 入流小于衰减损失即下行 —— 它**叠加**在衰减后的存量上，不是「换成引擎算的数」。
 *
 * **形态（照铁律 0.6 句式）**：
 * > 「我用『magnitude 这个数大』当作『扰动强度大』的证据，而前者并不度量后者 ——
 * >  `mode:"set"` 下强度 = `magnitude − 起点值`，而起点值是 38。」
 * 这与本文件 §⑤ 那条「`toBe(0)` 靠的是聚合了个空集」是**同一个病的第二次**：
 * 两次都是**默认起点是 0**，而 `a67ed05c` 之后它不是。⇒ 机制见 §⑨ 反向金丝雀。
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
 * **相对**扰动（`mode:"delta"`）—— 真正的「源值 +N」。
 *
 * ⚠ 与上面的 `perturb`（`mode:"set"`）是**两件事，别混**：`set M` 的真实强度是 `M − 起点值`，
 * 而本夹具里 `Material.priceShock` 的起点值是 **38**（见文件头注「2026-09-20 结案」）。
 * 凡要问「扰动加大，下游是不是更大」这类**单调性**问题，只有 `delta` 答得了 ——
 * `set` 的横轴原点在 38 上，拿它画曲线必然把「−18 vs +2」读成「+20 vs +40」。
 */
async function perturbDelta(t: TestApp, sid: string, objectId: string, magnitude: number): Promise<void> {
  const r = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
    payload: { kind: "cost_shock", targetObjectId: objectId, targetStateVar: "priceShock", magnitude, mode: "delta", startTick: 0, durationTicks: null, label: `${objectId} delta+${magnitude}` },
  });
  expect(r.statusCode).toBe(201);
}

/**
 * 某个 (对象, 状态量) 在 **tick0 世界态**里的起点值。
 * ⛔ 不写死 38、也⛔ 不读 `Material.props`（实测 8 个 Material 的 `props.priceShock` 全 `undefined`，
 * 这个数只活在 `deriveSeedBaseSnapshot` 派生出来的世界态里）——种子改了要红在断言上，不该红在魔数上。
 */
async function tick0Value(t: TestApp, sid: string, objectId: string, stateVar: string): Promise<number> {
  const wl = await readWorldLine(t.repos, "demo", sid, 0, 1);
  const v = wl.frames[0]?.state[objectId]?.[stateVar];
  expect(typeof v).toBe("number"); // 金丝雀：起点真的承载这个量（不承载就不是"起点为 0"，是"读错地方了"）
  return v as number;
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
  /** `carriers`/`universe` 是 §⑩ 非空金丝雀要读的两个数（承载集 / 全域）—— 不列出来类型系统看不见它们。 */
  pressures: { stateVar: string; value: number; carriers: number; universe: number }[];
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
  it("🔴 SEAM：tick×3 后求解器给出 4 拍轨迹，前两拍与无扰动对照臂逐字节相同（两跳链的到达延迟 = 回合语义）", async () => {
    const t = await seededApp();
    /**
     * **对照臂**（本单判据的承重墙）：同一棵种子、同一串 tick，**不施加扰动**。
     * `deriveSeedBaseSnapshot` 是确定性的（R6）⇒ 两臂 tick0 必然同源，差别只可能来自扰动。
     */
    const ctrlSid = await newSession(t);
    for (let i = 0; i < 3; i++) await tick(t, ctrlSid);
    const ctrl = (await project(t, ctrlSid)).turnDynamics!.byStateVar.costPressure!;

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
    /**
     * 两跳链的**到达延迟**：t0/t1 扰动还没传到 ⇒ 必须与对照臂**逐字节相同**；
     * t2 是**第一个**分岔的拍。「第几拍才看得见」本身就是回合语义，单张快照答不出来。
     *
     * ⚠ 这条判据**比原来的 `toBe(0)` 强**：`toBe(0)` 在**空世界**下恒真（一个承载对象都没有，
     *   聚合当然是 0）——它其实没在度量到达延迟。对照臂式只可能被真的延迟满足：
     *   链若在 t0/t1 就到了，两臂会分岔；链若压根没到，t2 不会分岔。
     */
    expect(cp.trajectory[0]!.value).toBe(ctrl.trajectory[0]!.value);
    expect(cp.trajectory[1]!.value).toBe(ctrl.trajectory[1]!.value);
    expect(cp.trajectory[2]!.value).not.toBe(ctrl.trajectory[2]!.value);
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
    /**
     * 既有读数：未推进 ⇒ 传导没跑 ⇒ 压力**仍是 tick0 起点那一份**（本单不许改既有行为）。
     *
     * ⚠ 判据从「恒 0」换成「等于无扰动的同一棵世界」——`toBe(0)` 编码的是
     * `a67ed05c` 之前那个**空世界**（见本文件头注「tick0 起点不再是空世界」）。
     * 对照臂同样证得住「扰动还没到」，而且不依赖起点恰好是 0。
     */
    const ctrl = await project(t, await newSession(t)); // 同种子、不扰动、不推进
    expect(out.pressures.find((p) => p.stateVar === "costPressure")!.value)
      .toBe(ctrl.pressures.find((p) => p.stateVar === "costPressure")!.value);
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

  // ── ⑨ 反向金丝雀：「不扰动」的唯一正确对照臂 ──────────────────────────────────────
  it("🐤 反向金丝雀：set(tick0 起点值) ⇒ 与不扰动臂逐字节相同；set(0) ⇒ 必须不同（幅度 0 ≠ 没扰动）", async () => {
    const t = await seededApp();

    const ctrlSid = await newSession(t);
    const seedVal = await tick0Value(t, ctrlSid, MAT_ID, "priceShock");
    // 金丝雀：起点**不是 0** —— 这一条正是上一版头注误读的根。它若某天真的变成 0，
    // 下面两条断言会分别变红/变绿，而不是悄悄换掉本文件全部结论的前提。
    expect(seedVal).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) await tick(t, ctrlSid);
    const ctrl = await project(t, ctrlSid);

    // ① 把源**设回它本来的值** = 没有改变任何东西 ⇒ 必须逐字节同对照臂。
    const sameSid = await newSession(t);
    await perturb(t, sameSid, MAT_ID, seedVal, 0);
    for (let i = 0; i < 3; i++) await tick(t, sameSid);
    expect(fingerprint(await project(t, sameSid))).toBe(fingerprint(ctrl));

    // ② `set 0` 把源从 seedVal **降到 0** ⇒ 是一次真扰动（降价），结果必须不同。
    //    ⚠ 这一条是本文件的要害：没有它，「幅度 0」会被当成「没扰动」，
    //    于是整条响应曲线的横轴原点错位 38，把单调读成不单调。
    const zeroSid = await newSession(t);
    await perturb(t, zeroSid, MAT_ID, 0, 0);
    for (let i = 0; i < 3; i++) await tick(t, zeroSid);
    expect(fingerprint(await project(t, zeroSid))).not.toBe(fingerprint(ctrl));
  });

  // ── ⑩ 响应曲线单调：扰动加大 ⇒ 下游必须更大（方向性正确的底线）───────────────────
  it("📈 单调：delta 扰动阶梯 0→+1000 ⇒ 聚合读数与单对象读数都严格递增（源涨⇒下游涨）", async () => {
    const t = await seededApp();
    const MODEL = "obj_model_2170-NCM";
    /**
     * 为什么必须**同时**咬聚合值与单对象值（工单 §6 的那个问题）：
     * `aggregatePressure` 是 `Σwᵢpᵢ / Σwᵢ`，权重 `wᵢ = qty × unitPrice` 取自**本体对象**、
     * 与世界态无关 ⇒ 分母对扰动恒定，聚合是 pᵢ 的**固定线性泛函**，结构上造不出非单调。
     * 实测旁证：九个臂上 `carriers/universe` 恒为 150/500、`weighting` 恒为 VALUE。
     * 两条曲线并排咬住 ⇒ 万一哪天真非单调了，能当场分清是「引擎单格」还是「聚合口径」。
     */
    const ladder = [0, 2, 10, 40, 200, 1000];
    const aggs: number[] = [];
    const cells: number[] = [];
    for (const m of ladder) {
      const sid = await newSession(t);
      if (m !== 0) await perturbDelta(t, sid, MAT_ID, m);
      for (let i = 0; i < 3; i++) await tick(t, sid);
      const out = await project(t, sid);
      const cost = out.pressures.find((p) => p.stateVar === "costPressure")!;
      // 🐤 非空金丝雀：真的有承载对象在参与聚合（0 承载 ⇒ 下面的"单调"是拿空集比出来的）。
      expect(cost.carriers).toBeGreaterThan(0);
      expect(cost.universe).toBeGreaterThan(cost.carriers);
      const td = out.turnDynamics!.byStateVar.costPressure!;
      aggs.push(td.trajectory[td.trajectory.length - 1]!.value);
      // 单对象末拍读数（走世界线末帧，与聚合同一份态）。
      const wl = await readWorldLine(t.repos, "demo", sid, 3, WORLD_LINE_DEFAULT_WINDOW);
      const v = wl.frames[wl.frames.length - 1]!.state[MODEL]?.costPressure;
      expect(typeof v).toBe("number"); // 金丝雀：观测点真的承载这个量
      cells.push(v as number);
    }
    for (let i = 1; i < ladder.length; i++) {
      expect(aggs[i]!).toBeGreaterThan(aggs[i - 1]!);   // 聚合口径单调
      expect(cells[i]!).toBeGreaterThan(cells[i - 1]!); // 引擎单格单调
    }
  });
});
