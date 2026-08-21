import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import type { SimMetricSeriesResponse } from "@platform/contracts";

/**
 * WO-SIM-BE-SERIES · **后端接缝门**：`GET /a/v1/sim/sessions/:id/metric-series`
 * —— 基线线 + 扰动后线 + 环节分段。
 *
 * ── 这道门为什么必须接缝驱动、不能各半 unit ────────────────────────────────────────
 * 本单跨**契约半**（新 schema）· **模型半**（世界线回放 + 归属 + 分段）· **路由半**（种子/规则集/扰动集的取数）。
 * 各半分开测都能全绿而功能是坏的，三种真实死法：
 *  · 基线的种子取错（另起会话 / 从 `baseSnapshot` 重开）⇒ 两条线**从 tick 0 就分叉**，
 *    而那道分叉与扰动毫无关系 —— 屏上显示的"扰动效果"其实是噪声。→ ①⑤ 咬。
 *  · 缺格被插值/补 0 ⇒ 插出来的点在屏上与实测值长得一模一样，永远查不出来。→ ③ 咬。
 *  · 分段让前端自己按规则表切 ⇒ 新增一条规则忘了加进去，它就从分段里消失且不报错。→ ① 咬（分段由后端给）。
 * 故本文件一律走**真路由 inject**（真 seed → 真规则 → 真会话 → 真扰动 → 真 tick），不直调模型函数。
 *
 * ── 用哪条边（为什么是这条）───────────────────────────────────────────────────────
 * `demo_base_load_to_line_util`：`Base.loadIndex --line_belongs_to_base(0.5, delay 1)--> Line.utilPressure`
 * （`src/seed.ts` 出厂种子）。选它是因为影响量**可解析**：源 4 ⇒ 每条产线每格 +2；源 20 ⇒ +10。
 * 于是"分叉了"这件事能断言成**具体的数**，而不是"不等于"就算过 ——「不等于」那种断言，
 * 系数读错、贡献落到别的对象上、甚至整条线全是 `null`，它都照样绿。
 */

const enableSim = async (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 常州基地 —— demo 世界里 `line_belongs_to_base` 出边最全的一个（实测 10 条产线）。 */
const BASE_ID = "obj_base_changzhou";
/** 被测的那条边（出厂种子）。 */
const RULE_KEY = "demo_base_load_to_line_util";
/** `Line` 的落域（`seed.ts` P38「产能与瓶颈复核(RCCP)」carrierTypeKey=Line ⇒ D06）。 */
const LINE_DOMAIN = { nodeId: "D06", label: "计划与排产" };

/** 扰动生效的那一格。**刻意 > 0** —— 等于 0 的话「生效前逐点相等」这条就无处可验（没有"生效前"）。 */
const START_TICK = 3;
/** tick0 行上由 `/act` 直写的值。**刻意 ≠ baseSnapshot 的 0**：见 ① 判据 c。 */
const ACT_LOAD = 4;
/** 扰动把负载置到的值。 */
const PERT_LOAD = 20;
const TICKS = 6;

async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await enableSim(t);
  return t;
}

interface Fixture {
  t: TestApp;
  sid: string;
  perturbationId: string;
}

/**
 * 建一个「tick0 行 ≠ baseSnapshot、且第 3 格起有一条扰动」的世界。
 *
 * 三步各有用处，别精简：
 *  · `baseSnapshot: {BASE: {loadIndex: 0}}` —— 会话开局；
 *  · `POST …/act` 把 tick0 行直写成 `ACT_LOAD` —— **让 tick0 行与 baseSnapshot 真的不同**。
 *    没有这一步，「基线种子取 tick0 行」与「取 baseSnapshot」两种实现产出完全一样，
 *    本文件就验不出它们的区别（那正是本单最容易做错的地方）。
 *  · `POST …/perturbations` 且 `startTick=3 > curTick=0` ⇒ 建单时**未生效**，
 *    路由不会立刻施加（`isPerturbationActiveAt(p, 0)` 为假），扰动只入库、由引擎在第 3 格施加。
 */
async function worldWithFuturePerturbation(): Promise<Fixture> {
  const t = await seededApp();
  const created = await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
    payload: { baseSnapshot: { [BASE_ID]: { loadIndex: 0 } } },
  });
  expect(created.statusCode).toBe(201);
  const sid = created.json().id as string;

  const acted = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/act`, headers: ADMIN,
    payload: { objectId: BASE_ID, stateVar: "loadIndex", value: ACT_LOAD },
  });
  expect(acted.statusCode).toBe(200);
  // 金丝雀：tick0 行确实被改了，且**与 baseSnapshot 不同** —— ① 判据 c 全靠这个差额才有意义。
  const tick0 = await t.repos.sim.getTickState("demo", sid, 0);
  expect(tick0!.state[BASE_ID]!.loadIndex).toBe(ACT_LOAD);
  expect((await t.repos.sim.getSession("demo", sid))!.baseSnapshot[BASE_ID]!.loadIndex).toBe(0);

  const p = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
    payload: {
      kind: "capacity_loss", targetObjectId: BASE_ID, targetStateVar: "loadIndex",
      startTick: START_TICK, magnitude: PERT_LOAD, mode: "set", label: `第 ${START_TICK} 格起基地负载置 ${PERT_LOAD}`,
    },
  });
  expect(p.statusCode).toBe(201);
  const perturbationId = p.json().perturbation.id as string;
  // 金丝雀：未来才生效的扰动**不许**在建单时就改世界（改了的话 ① 的"生效前相等"会被悄悄破坏）。
  expect((await t.repos.sim.getTickState("demo", sid, 0))!.state[BASE_ID]!.loadIndex).toBe(ACT_LOAD);

  const ticked = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: TICKS },
  });
  expect(ticked.statusCode).toBe(200);
  expect(ticked.json().curTick).toBe(TICKS);
  return { t, sid, perturbationId };
}

const series = async (t: TestApp, sid: string, qs = "from=0&to=6"): Promise<SimMetricSeriesResponse> => {
  const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/metric-series?${qs}`, headers: ADMIN });
  expect(r.statusCode).toBe(200);
  return r.json() as SimMetricSeriesResponse;
};

const metricOf = (out: SimMetricSeriesResponse, key: string) => {
  const m = out.metrics.find((x) => x.key === key);
  expect(m, `回包里没有指标 ${key}（有的是：${out.metrics.map((x) => x.key).join(", ")}）`).toBeDefined();
  return m!;
};

const lineIdsOf = async (t: TestApp): Promise<string[]> =>
  (await t.repos.links.list("demo", (l) => l.type === "line_belongs_to_base" && l.fromId === BASE_ID))
    .map((l) => l.toId).sort();

describe("WO-SIM-BE-SERIES · 指标时序（基线线 + 扰动后线 + 环节分段）", () => {
  // ── ① 基线是"同一世界不施加扰动的那条线"：生效前逐点相等，生效那一格才分叉 ──────────────
  it("🔴 SEAM：扰动 startTick=3 ⇒ 全部指标在 tick<3 逐点相等，loadIndex 在 tick3 才由 4 跳到 20", async () => {
    const { t, sid, perturbationId } = await worldWithFuturePerturbation();
    const lineIds = await lineIdsOf(t);
    expect(lineIds.length).toBe(10); // 金丝雀：链路真的种了，本用例不是在空世界里空转

    const out = await series(t, sid);
    expect(out.ticks).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(out.fromTick).toBe(0);
    expect(out.toTick).toBe(6);
    expect(out.clamped).toBe(false);

    // 🔴 判据 a：**基线出处** —— 同一个会话、从 tick0 种起、剔掉的正是本会话那条扰动。
    //    这三个数任意一个不对，下面所有"分叉点"的断言都只是巧合。
    expect(out.baselineOrigin.sessionId).toBe(sid);
    expect(out.baselineOrigin.seedTick).toBe(0);
    expect(out.baselineOrigin.excludedPerturbationIds).toEqual([perturbationId]);

    const load = metricOf(out, `${BASE_ID}.loadIndex`);
    // 🔴 判据 b：分叉点**恰好**落在生效格，且两侧都是**具体的数**（不是"不等于"）。
    expect(load.baseline).toEqual([ACT_LOAD, ACT_LOAD, ACT_LOAD, ACT_LOAD, ACT_LOAD, ACT_LOAD, ACT_LOAD]);
    expect(load.actual).toEqual([ACT_LOAD, ACT_LOAD, ACT_LOAD, PERT_LOAD, PERT_LOAD, PERT_LOAD, PERT_LOAD]);

    // 🔴 判据 c：基线 tick0 = **tick0 行的 4**，不是 baseSnapshot 的 0。
    //    「另起会话 / 从 baseSnapshot 重开」的实现在这一行当场红 —— 它是常驻的防线，
    //    不像 ⑤ 的变异反证那样跑完就撤。
    expect(load.baseline[0]).toBe(ACT_LOAD);

    // 🔴 判据 d：**每一个**指标在生效前逐点相等（不只是被扰动那一个）。
    //    只验 loadIndex 会漏掉"下游某条线从 tick0 就歪了"这种病样。
    for (const m of out.metrics) {
      expect(m.baseline.slice(0, START_TICK), `${m.key} 在生效前就分叉了`).toEqual(m.actual.slice(0, START_TICK));
    }
    // 金丝雀：至少有一个指标**真的**分叉了 —— 否则上面那条"逐点相等"在两条线恒等时也全绿（空转）。
    const diverged = out.metrics.filter((m) => JSON.stringify(m.baseline) !== JSON.stringify(m.actual));
    expect(diverged.map((m) => m.key)).toContain(`${BASE_ID}.loadIndex`);
    expect(diverged.length).toBeGreaterThan(1); // 扰动确实沿边扩散到了下游，不是只改了落点那一格

    // 🔴 判据 e：**分段由后端给**，且能溯回是哪条边把这个数写上去的。
    //    `Line.utilPressure` 的贡献全部来自 `demo_base_load_to_line_util`（该边落域 D06）。
    const util = metricOf(out, `${lineIds[0]}.utilPressure`);
    expect(util.segments.length).toBeGreaterThan(0);
    for (const seg of util.segments) {
      expect(seg.nodeId).toBe(LINE_DOMAIN.nodeId);
      expect(seg.label).toBe(LINE_DOMAIN.label);
      expect(seg.source).toBe("domain"); // 出厂种子 35 条 cadenceNodeId 全为 null ⇒ 回落落域档
      expect(seg.ruleKeys).toEqual([RULE_KEY]);
      expect(seg.toTick).toBeGreaterThanOrEqual(seg.fromTick);
    }
    // 诚实留白：`Base.loadIndex` 这一格没有任何边写它（值来自种子与扰动）⇒ **不产生分段**，
    // 而不是硬派给最近的那个环节。
    expect(load.segments).toEqual([]);

    // 🔴 判据 f（接缝·防第二套真相源）：回放出来的 `actual` 必须**逐格等于落库的世界线**。
    //    没有这一条，本端点就可能自成一套算法：屏上（`…/world`）一个数、曲线上另一个数，
    //    而两边各自都"绿"。
    const persisted = await t.repos.sim.listTickStates("demo", sid);
    expect(persisted.map((x) => x.tick)).toEqual(out.ticks); // 金丝雀：世界线确实有这 7 格
    for (const m of out.metrics) {
      const fromWorld = persisted.map((row) => {
        const v = row.state[m.objectId]?.[m.stateVar];
        return typeof v === "number" ? v : null;
      });
      expect(m.actual, `${m.key} 的 actual 与落库世界线不一致`).toEqual(fromWorld);
    }
    // 反向金丝雀：落库世界线里**每一个**已登记状态变量的格都出现在了回包里（没有被悄悄漏掉）。
    const known = new Set((await t.repos.sim.listPropagationRules("demo", true)).flatMap((r) => [r.sourceStateVar, r.targetStateVar]));
    const inWorld = new Set<string>();
    for (const row of persisted) {
      for (const [objectId, bucket] of Object.entries(row.state)) {
        for (const [stateVar, v] of Object.entries(bucket)) {
          if (typeof v === "number" && known.has(stateVar)) inWorld.add(`${objectId}.${stateVar}`);
        }
      }
    }
    expect(inWorld.size).toBeGreaterThan(1); // 金丝雀：这个集合不是空的，下面那条比对才有意义
    expect(out.metrics.map((m) => m.key).sort()).toEqual([...inWorld].sort());
  });

  // ── ② 可逆：删掉那条扰动 ⇒ 两条线重新重合 ────────────────────────────────────────
  it("🔴 SEAM：DELETE 掉扰动 ⇒ 每个指标的 baseline 与 actual 逐点重合，excludedPerturbationIds 清空", async () => {
    const { t, sid, perturbationId } = await worldWithFuturePerturbation();

    // 先证明"删之前是分叉的"——否则"删之后重合"可能只是本来就没分叉过（空转）。
    const before = await series(t, sid);
    expect(metricOf(before, `${BASE_ID}.loadIndex`).actual).not.toEqual(metricOf(before, `${BASE_ID}.loadIndex`).baseline);

    const del = await t.app.inject({
      method: "DELETE", url: `/a/v1/sim/sessions/${sid}/perturbations/${perturbationId}`, headers: ADMIN,
    });
    expect(del.statusCode).toBe(200);

    const after = await series(t, sid);
    expect(after.baselineOrigin.excludedPerturbationIds).toEqual([]);
    // 🔴 判据：**每一个**指标两条线逐点相同 —— 扰动没了，就没有任何东西能把两条线分开。
    for (const m of after.metrics) {
      expect(m.actual, `${m.key} 在扰动删除后仍未与基线重合`).toEqual(m.baseline);
    }
    // 且重合到的是**没有扰动的那条线**（4 一路到底），不是"把 actual 抄给 baseline"这种假重合。
    expect(metricOf(after, `${BASE_ID}.loadIndex`).actual).toEqual([ACT_LOAD, ACT_LOAD, ACT_LOAD, ACT_LOAD, ACT_LOAD, ACT_LOAD, ACT_LOAD]);

    // ⚠ 诚实边界（别当 bug 修）：删扰动**不回滚落库的世界态**（`app.ts` 明写「删的是扰动记录，
    //   不回滚世界态；回滚走 checkpoint/rollback」）。本端点回答的是「按这个世界**当前**的扰动集，
    //   两条线各是什么样」，故它与落库行在这一刻**刻意**不同 —— 下面这句把这件事钉住，
    //   免得下一个人看到差异就去"修"成读落库行（那会当场打破本用例要的可逆性）。
    const persisted = await t.repos.sim.listTickStates("demo", sid);
    expect(persisted.at(-1)!.state[BASE_ID]!.loadIndex).toBe(PERT_LOAD);
  });

  // ── ③ 缺格返 null，不插值、不补 0；窗口超出世界线也不凭空造格 ──────────────────────
  it("🔴 缺格 ⇒ null（不是 0、不是插值）；to 超出 curTick ⇒ 收敛并亮 clamped，不补未来格", async () => {
    const { t, sid } = await worldWithFuturePerturbation();
    const lineIds = await lineIdsOf(t);
    const out = await series(t, sid);

    // `Line.utilPressure` 这一格在 tick0/1 **根本不存在**：这条边 delay=1，第一笔贡献
    // 在 tick2 才落地。0/1 两格必须是 `null` ——
    //  · 写成 `0` ⇒ 把「这个世界里没有这一格」说成「这一格是 0」；
    //  · 插值/后向填充 ⇒ 插出来的点在屏上与实测值长得一模一样，用户无从分辨。
    const util = metricOf(out, `${lineIds[0]}.utilPressure`);
    expect(util.actual[0]).toBeNull();
    expect(util.actual[1]).toBeNull();
    expect(util.baseline[0]).toBeNull();
    expect(util.baseline[1]).toBeNull();
    // 金丝雀：这条指标**后面确实有值** —— 否则"前两格是 null"在一条全 null 的死指标上也全绿。
    expect(util.actual[2]).toBe(ACT_LOAD * 0.5); // 4 × 0.5 = 2
    // 且 `null` 不是把整条线读空：两条线在这一格都是同一个真实数。
    expect(util.baseline[2]).toBe(ACT_LOAD * 0.5);

    // 两条线与 `ticks` **等长**（缺格是 `null` 占位，不是把格子删掉 —— 删掉就对不齐 x 轴了）。
    for (const m of out.metrics) {
      expect(m.actual.length).toBe(out.ticks.length);
      expect(m.baseline.length).toBe(out.ticks.length);
    }

    // 窗口超出世界线：**不预测未来** ⇒ 截到 curTick、亮 `clamped`，且**不**补 7..99 这些空格。
    const far = await series(t, sid, "from=0&to=99");
    expect(far.clamped).toBe(true);
    expect(far.toTick).toBe(TICKS);
    expect(far.ticks).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // 窗口内截取也如实：from=4 ⇒ 只回 4..6，且值与全窗对应位置逐点相同（不是重算出另一套数）。
    const win = await series(t, sid, "from=4&to=6");
    expect(win.ticks).toEqual([4, 5, 6]);
    expect(win.clamped).toBe(false);
    expect(metricOf(win, `${BASE_ID}.loadIndex`).actual).toEqual(metricOf(out, `${BASE_ID}.loadIndex`).actual.slice(4));
  });

  // ── ④ R6 确定性：同 (session, from, to) 重跑**字节级**一致 ────────────────────────
  it("🔴 R6：同 (session, from, to) 连跑三次，响应体逐字节相同（回包零 wall-clock 字段）", async () => {
    const { t, sid } = await worldWithFuturePerturbation();
    const url = `/a/v1/sim/sessions/${sid}/metric-series?from=0&to=6`;
    const a = await t.app.inject({ method: "GET", url, headers: ADMIN });
    const b = await t.app.inject({ method: "GET", url, headers: ADMIN });
    const c = await t.app.inject({ method: "GET", url, headers: ADMIN });
    expect(a.statusCode).toBe(200);
    expect(b.body).toBe(a.body);
    expect(c.body).toBe(a.body);
    // 金丝雀：body 不是空壳（一个恒返 "{}" 的实现也能让上面两句全绿）。
    expect(a.body.length).toBeGreaterThan(200);
    expect((a.json() as SimMetricSeriesResponse).metrics.length).toBeGreaterThan(1);

    // 只读：三次请求之后世界线**一个字节没动**（本端点不许 putTickState/putSession/emit）。
    const s = await t.repos.sim.getSession("demo", sid);
    expect(s!.curTick).toBe(TICKS);
    expect((await t.repos.sim.listTickStates("demo", sid)).length).toBe(TICKS + 1);
  });

  // ── ⑤ 变异反证：把基线改成「另起会话重算」⇒ ① 必须当场红 ──────────────────────────
  //
  // 变异 M1 **手工执行并已记录在交单报告里**（把 `metric-series.ts` 里基线那一跑的种子
  // 从"本会话 tick0 行"改成 `{}` = 新建会话的世界，一行改动），实测 6 条里 **4 条当场红**，① 的原文：
  //   AssertionError: expected [ null, null, null, null, null, …(2) ] to deeply equal [ 4, 4, 4, 4, 4, 4, 4 ]
  //    ❯ test/metric-series.seam.test.ts:148  expect(load.baseline).toEqual([ACT_LOAD, …])
  //   → 基线整条变成 null，分叉点从 tick3 提前到了 tick0（判据 b 与 c 同时红）。
  // 一并红的还有 ②（`obj_base_changzhou.loadIndex 在扰动删除后仍未与基线重合`）、③（`expected null to be 2`）、
  // 本条（`expected null to be 4`）；④ 与 R3 那条仍绿 —— 确定性与鉴权本就不度量基线口径，它俩绿是对的。
  //
  // 本用例是那次变异的**常驻替身**：它不改实现，而是把"基线必须来自本会话自己的 tick0 行"
  // 这件事直接钉成断言 —— 任何"另起会话/从 baseSnapshot 重开"的改法都过不去。
  // （变异反证是一次性的，钉子才是留得住的那半。）
  it("🔴 变异反证的常驻替身：基线必须来自**本会话自己的 tick0 行**，另起会话/换种子即红", async () => {
    const { t, sid } = await worldWithFuturePerturbation();
    const out = await series(t, sid);

    // (a) 基线出处必须指回本会话 —— 指向别的会话 = 上面禁掉的那种假分叉。
    expect(out.baselineOrigin.sessionId).toBe(sid);
    expect(out.baselineOrigin.seedTick).toBe(0);

    // (b) 基线 tick0 = tick0 行的值（4），**不是** baseSnapshot 的 0，更不是新会话的"这一格不存在"。
    //     三种错法各自会读成 0 / 0 / null，三种都被这一行挡住。
    const load = metricOf(out, `${BASE_ID}.loadIndex`);
    expect(load.baseline[0]).toBe(ACT_LOAD);
    expect(load.actual[0]).toBe(ACT_LOAD);

    // (c) 两条线在 tick0 **必须相等** —— 这就是"假分叉"的判据本身：
    //     基线换了世界，第 0 格立刻对不上，而那道分叉与扰动毫无关系。
    for (const m of out.metrics) {
      expect(m.baseline[0], `${m.key} 在 tick0 就分叉了 ⇒ 基线不是同一个世界`).toEqual(m.actual[0]);
    }

    // (d) 另起一个会话真的会给出不同的世界 —— 这是本条断言**非空转**的证据：
    //     若新会话恰好与本会话逐格相同，上面几条就挡不住任何东西。
    const fresh = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: {} });
    expect(fresh.statusCode).toBe(201);
    const freshId = fresh.json().id as string;
    const freshTick0 = await t.repos.sim.getTickState("demo", freshId, 0);
    expect(freshTick0!.state).toEqual({}); // 新会话的 tick0 是空世界 ⇒ 拿它当基线种子必然从 tick0 就分叉
    expect(freshTick0!.state[BASE_ID]?.loadIndex).toBeUndefined();
  });

  // ── R3 entitlement 先于 authz：功能关 = 不存在（404），不是 403 ──────────────────
  it("🔴 R3：sim.propagation 关掉 ⇒ 本路由 404 FEATURE_NOT_FOUND；R2：别租户 404", async () => {
    const { t, sid } = await worldWithFuturePerturbation();
    // R2：别租户看不到这个会话（先验，证明下面的 404 不是"路由压根不存在"）。
    const other = await t.app.inject({
      method: "GET", url: `/a/v1/sim/sessions/${sid}/metric-series`,
      headers: { "x-debug-user": "other:admin:admin" },
    });
    expect(other.statusCode).toBe(404);

    await t.app.inject({
      method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
      payload: { overrides: { "sim.sandbox": true, "sim.propagation": false } },
    });
    const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/metric-series`, headers: ADMIN });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("FEATURE_NOT_FOUND");
  });
});
