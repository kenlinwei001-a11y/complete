import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import {
  SIM_METRIC_SERIES_DEFAULT_LIMIT,
  SIM_METRIC_SERIES_MAX_LIMIT,
  type SimMetricSeriesResponse,
} from "@platform/contracts";

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

/**
 * 取指标时序。**显式带 `order=key&limit=<硬上限>`** —— 这不是可省的装饰，理由写在这里：
 *
 * 自 WO-SIM-SERIES-SCALE（2026-08-22）起本端点**不传参数就不回全量**：默认只回
 * `SIM_METRIC_SERIES_DEFAULT_LIMIT`（=12）条、且默认按**变化幅度**降序。
 * 而本文件下面那几条判据（基线口径 / 缺格 / 可逆 / 目录完整）要的是**全目录**。
 * ⚠ 实测过：不显式指定的话，`obj_base_changzhou.loadIndex`（幅度 4→20 = 16）会被
 *   逐格累加的 `utilPressure` / `queuePressure`（幅度 30+）**挤出前 12** ——
 *   那不是回归，是闸在正常工作。把它读成回归会去"修"掉刚建好的闸。
 *
 * 配套金丝雀（`toBe(out.totalMetrics)`）：万一哪天这个世界长过硬上限，它当场报「尺子坏了」，
 * 而不是让这些用例在一个子集上**悄悄全绿**。「我没找到」和「它不存在」是两个命题。
 */
const series = async (t: TestApp, sid: string, qs = "from=0&to=6"): Promise<SimMetricSeriesResponse> => {
  const url = `/a/v1/sim/sessions/${sid}/metric-series?${qs}&order=key&limit=${SIM_METRIC_SERIES_MAX_LIMIT}`;
  const r = await t.app.inject({ method: "GET", url, headers: ADMIN });
  expect(r.statusCode).toBe(200);
  const out = r.json() as SimMetricSeriesResponse;
  expect(
    out.metrics.length,
    "本世界的指标数已超过硬上限 ⇒ 本文件那几条「全目录」判据正在一个子集上空转，先把尺子修好再读结论",
  ).toBe(out.totalMetrics);
  return out;
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

// ══════════════════════════════════════════════════════════════════════════════
// WO-SIM-SERIES-SCALE · 规模闸（**生产量级世界**，不是 1 对象的手造世界）
// ══════════════════════════════════════════════════════════════════════════════
/**
 * ── 这一组为什么必须用**上万对象**的世界 ────────────────────────────────────────
 * 上面那一组（WO-SIM-BE-SERIES）当初的真后端实测用的是
 * `baseSnapshot={obj_base_changzhou:{loadIndex:42}}` —— **一个对象**，回包 17 条，一切正常。
 * 形态（照本仓 0.6 句式）：
 * > **「我用『1 对象手造世界回包 17 条』当作『这个端点回包规模可控』的证据，而前者并不度量后者。」**
 * 这正是铁律 0.5 判据 6 的**生产实参与测试实参交集为空**：三周来验的是生产从没走过的规模。
 *
 * 真浏览器走真实用户路径（`/v/sim-sandbox` → `deriveBaseSnapshot(view-config)` → 推进一拍）
 * 建出来的世界是 **11,348 对象 × 36 状态变量**，端点实测回
 * **408,528 条 / 116,859,540 字节 / 21.8 秒**，屏上那张甘特**只画 12 行**，
 * 请求 20 秒回不来 ⇒ `data-source` 恒 `placeholder` ⇒ **静默错答**。
 *
 * 故本组的世界必须是**上万对象**量级。用小世界写这几条断言 = 把刚修好的病重新埋回去。
 *
 * ── 世界怎么造（每一步都有用，别精简）───────────────────────────────────────────
 *  · `SCALE_OBJECTS` 个合成对象 × 2 个**已登记**状态变量（取值域 = 已发布规则的
 *    source/target stateVar，与生产同一口径）⇒ 目录 = `SCALE_OBJECTS × 2` 条；
 *  · 合成对象**刻意不在本体图上** ⇒ 没有规则会写它们 ⇒ 两条线恒等 ⇒ 幅度恒 0，
 *    于是「幅度最大的那几条」就只能是下面那三条**被扰动打过**的，判据可解析、不是"不等于"；
 *  · 三条扰动的幅度**刻意各不相同且拉开**（900 / 800 / 700），
 *    这样"按幅度降序"就能断言成**具体的顺序**，而不是"某种排序"。
 */
describe("WO-SIM-SERIES-SCALE · 指标时序规模闸（生产量级世界·11,348 对象是真实测得的量级）", () => {
  /** 合成对象数。**上万量级**（真实测 11,337 个 `nodeObjectIds` + 11 个空类型占位键 = 11,348）。 */
  const SCALE_OBJECTS = 10_000;
  /** 每个对象带的已登记状态变量（`seedDemoPropagationRules` 的 source/target 取值域里真有这两个）。 */
  const SCALE_VARS = ["loadIndex", "utilPressure"] as const;
  /** 合成对象的基线值 —— 全体同一个数 ⇒ 没被扰动打过的那些幅度恒 0。 */
  const FLAT = 50;
  /** 三条"热"指标：`set` 到这些值 ⇒ 幅度 = |值 − FLAT| = 900 / 800 / 700，三档拉开、可解析。 */
  const HOT: readonly (readonly [number, number])[] = [[0, 950], [1, 850], [2, 750]];
  const oid = (i: number): string => `obj_scale_${String(i).padStart(5, "0")}`;
  /** 目录规模 = 对象数 × 变量数。**这个数就是 `totalMetrics` 该有的值**。 */
  const CATALOG = SCALE_OBJECTS * SCALE_VARS.length;

  interface ScaleFixture { t: TestApp; sid: string }

  async function scaleWorld(opts: { perturb?: boolean } = {}): Promise<ScaleFixture> {
    const t = await makeApp();
    await seedDemoPropagationRules(t.repos); // 只要规则（= 指标目录的口径来源），不需要整套 battery
    await enableSim(t);

    const baseSnapshot: Record<string, Record<string, number>> = {};
    for (let i = 0; i < SCALE_OBJECTS; i++) {
      const row: Record<string, number> = {};
      for (const v of SCALE_VARS) row[v] = FLAT;
      baseSnapshot[oid(i)] = row;
    }
    const created = await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot },
    });
    expect(created.statusCode).toBe(201);
    const sid = created.json().id as string;

    for (const [i, value] of opts.perturb === false ? [] : HOT) {
      const p = await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
        payload: {
          kind: "capacity_loss", targetObjectId: oid(i), targetStateVar: "loadIndex",
          startTick: 1, magnitude: value, mode: "set", label: `热指标 ${i} 置 ${value}`,
        },
      });
      expect(p.statusCode).toBe(201);
    }
    const ticked = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 2 },
    });
    expect(ticked.statusCode).toBe(200);
    return { t, sid };
  }

  const get = async (t: TestApp, sid: string, qs = ""): Promise<SimMetricSeriesResponse> => {
    const r = await t.app.inject({
      method: "GET", url: `/a/v1/sim/sessions/${sid}/metric-series${qs}`, headers: ADMIN,
    });
    expect(r.statusCode).toBe(200);
    return r.json() as SimMetricSeriesResponse;
  };

  /** 一条指标的**变化幅度**，与服务端同一口径（`|actual 末个有效读数 − baseline 首个有效读数|`）。 */
  const magnitudeOf = (m: SimMetricSeriesResponse["metrics"][number]): number => {
    const first = m.baseline.find((v) => v !== null) ?? null;
    const last = [...m.actual].reverse().find((v) => v !== null) ?? null;
    return first === null || last === null ? 0 : Math.abs(last - first);
  };

  // ── ① 防复发的那台机器：**不传任何参数也不许回全量** ────────────────────────────
  it("🔴 SEAM：生产量级世界（10,000 对象 × 2 变量 = 20,000 条目录）下**不传 limit** ⇒ 回包 ≤ 硬上限，且 totalMetrics 如实等于全量", async () => {
    const { t, sid } = await scaleWorld();
    const out = await get(t, sid);

    // 金丝雀先说话：这个世界**真的是**上万量级 —— 否则下面每一条都在一个小世界上空转全绿。
    expect(out.totalMetrics, "世界没造起来 ⇒ 本用例在空转，先修世界再读结论").toBe(CATALOG);
    expect(out.totalMetrics).toBeGreaterThan(10_000);

    // 🔴 本单的核心判据：**任何调用方从此都打不爆服务**。
    expect(out.metrics.length).toBeLessThanOrEqual(SIM_METRIC_SERIES_MAX_LIMIT);
    expect(out.metrics.length).toBe(SIM_METRIC_SERIES_DEFAULT_LIMIT);
    expect(out.appliedLimit).toBe(SIM_METRIC_SERIES_DEFAULT_LIMIT);

    // 🔴 诚实位：**不许静默截断**。「我没给你剩下的」必须与「一共就这么多」分得开。
    expect(out.truncated).toBe(true);

    // 回包**真的变小了**：改造前 116,859,540 字节 / 408,528 条（真 datacore 实测）。
    // 这条按"每条 ≈ 286 字节"折算，20,000 条的全量约 5.7MB —— 回包必须远小于它。
    const bytes = JSON.stringify(out).length;
    expect(bytes, `回包 ${bytes} 字节 —— 闸没起作用`).toBeLessThan(200_000);
  });

  // ── ② 硬上限压得住任何客户端 ────────────────────────────────────────────────
  it("🔴 limit 要多少都压到硬上限（appliedLimit 亮出来，不是静默给全量）；limit 小于默认值时如实生效", async () => {
    const { t, sid } = await scaleWorld();

    const huge = await get(t, sid, "?limit=999999");
    expect(huge.metrics.length).toBe(SIM_METRIC_SERIES_MAX_LIMIT);
    expect(huge.appliedLimit).toBe(SIM_METRIC_SERIES_MAX_LIMIT);
    expect(huge.truncated).toBe(true);
    expect(huge.totalMetrics).toBe(CATALOG);

    const tiny = await get(t, sid, "?limit=3");
    expect(tiny.metrics.length).toBe(3);
    expect(tiny.appliedLimit).toBe(3);
  });

  // ── ③ 幅度档回的确实是变化最大的那些（可解析，不是"不等于"）─────────────────────
  it("🔴 order=magnitude ⇒ 回的正是被扰动打过的那三条，且按 |actual末 − baseline首| 降序（900/800/700）", async () => {
    const { t, sid } = await scaleWorld();
    const out = await get(t, sid, "?order=magnitude&limit=3");
    expect(out.appliedOrder).toBe("magnitude");

    // 具体到**哪三条、什么顺序、幅度各是多少** —— 「排序了」这种断言，排错方向也照样绿。
    expect(out.metrics.map((m) => m.key)).toEqual(HOT.map(([i]) => `${oid(i)}.loadIndex`));
    expect(out.metrics.map(magnitudeOf)).toEqual(HOT.map(([, v]) => Math.abs(v - FLAT)));

    // 反向金丝雀：这三条**真的被挑出来了**，不是"恰好排在字典序最前面"——
    // 字典序前三条是 obj_scale_00000 的两个变量 + obj_scale_00001.loadIndex，与上面这组不同。
    const byKey = await get(t, sid, "?order=key&limit=3");
    expect(byKey.appliedOrder).toBe("key");
    expect(byKey.metrics.map((m) => m.key)).toEqual([
      `${oid(0)}.loadIndex`, `${oid(0)}.utilPressure`, `${oid(1)}.loadIndex`,
    ]);
    expect(byKey.metrics.map((m) => m.key)).not.toEqual(out.metrics.map((m) => m.key));
  });

  // ── ④ 白名单（下钻）：名单外的**连目录都不进** ⇒ totalMetrics 跟着变小 ──────────────
  it("🔴 objectIds / stateVars 是白名单不是排除表：totalMetrics 反映筛后的全量；名单落空 ⇒ 0 条且 truncated=false", async () => {
    const { t, sid } = await scaleWorld();

    const byVar = await get(t, sid, "?stateVars=loadIndex&limit=5");
    expect(byVar.totalMetrics).toBe(SCALE_OBJECTS); // 只剩一个变量 ⇒ 目录砍半
    expect(byVar.metrics.every((m) => m.stateVar === "loadIndex")).toBe(true);

    const byObj = await get(t, sid, `?objectIds=${oid(0)},${oid(1)}`);
    expect(byObj.totalMetrics).toBe(2 * SCALE_VARS.length);
    expect(byObj.truncated).toBe(false); // 4 条 < 默认 12 ⇒ **一共就这么多**，不是"我没给你"
    expect(new Set(byObj.metrics.map((m) => m.objectId))).toEqual(new Set([oid(0), oid(1)]));

    // 名单落空：`totalMetrics=0 & truncated=false` = 「一共就这么多（零条）」，
    // 与「被裁了」是两个命题 —— 只看 `metrics.length===0` 的话这两态长得一模一样。
    const none = await get(t, sid, "?objectIds=obj_不存在");
    expect(none.metrics.length).toBe(0);
    expect(none.totalMetrics).toBe(0);
    expect(none.truncated).toBe(false);
  });

  // ── ⑤ R6 确定性：截断 + 排序之后仍然字节级可复现（tiebreaker 必须是全序）──────────
  it("🔴 R6：同 (session, limit, order) 连跑三次逐字节一致；幅度并列的那一大批按 key 升序（tiebreaker 稳定）", async () => {
    const { t, sid } = await scaleWorld();
    const url = `/a/v1/sim/sessions/${sid}/metric-series?limit=${SIM_METRIC_SERIES_DEFAULT_LIMIT}&order=magnitude`;
    const bodies = [];
    for (let i = 0; i < 3; i++) {
      const r = await t.app.inject({ method: "GET", url, headers: ADMIN });
      expect(r.statusCode).toBe(200);
      bodies.push(r.body);
    }
    expect(bodies[1]).toBe(bodies[0]);
    expect(bodies[2]).toBe(bodies[0]);
    expect(bodies[0]!.length).toBeGreaterThan(200); // 金丝雀：不是一个恒返 "{}" 的实现

    // 前 3 条是热指标；第 4 条起幅度全为 0（合成对象没有规则写它们）⇒ 必须按 key 升序。
    // 没有稳定 tiebreaker 的话，同一个世界两次刷新行序会跳 —— 那正是 R6 要禁的。
    const out = JSON.parse(bodies[0]!) as SimMetricSeriesResponse;
    const flatKeys = out.metrics.slice(HOT.length).map((m) => m.key);
    expect(flatKeys.length).toBeGreaterThan(0); // 金丝雀：确实有并列的那一批可验
    expect(out.metrics.slice(HOT.length).map(magnitudeOf)).toEqual(flatKeys.map(() => 0));
    expect(flatKeys).toEqual([...flatKeys].sort());
  });

  // ── ⑥ **全体幅度并列为 0** 的世界：tiebreaker 不是可选项，它就是这里的实际排序 ──────
  /**
   * 这条不是补充用例，是**真实世界的默认形态**。集成线收编 `WO-SIM-SEED-WORLD` 之后，
   * `SEED_DEMO=1` 播出的那条种子世界实测（真服务，非 mock）：
   * ```
   * sims_demo_seed_world  RUNNING  curTick=3  baseSnapshot 3411 键
   * GET …/metric-series → 1,249,004 字节 / 3,494 条 / ticks=[0,1,2,3]
   * 其中「baseline ≠ actual」的条数 = 0        ← 零扰动 ⇒ 全部幅度并列为 0
   * ```
   * ⇒ **屏上那 12 行到底是谁，完全由 tiebreaker 决定**。tiebreaker 若不是全序
   * （比如只写 `mag[b]-mag[a]` 靠 `Array.sort` 的稳定性兜底），同一个世界两次刷新行序就会跳，
   * 而且**没有任何东西会报错** —— 永远绿的那种错。故这里把它钉死：
   * 全并列时 `order=magnitude` 必须与 `order=key` **逐条相同**。
   */
  it("🔴 零扰动世界（全体幅度并列为 0，= 种子世界的实际形态）⇒ magnitude 档必须逐条等于 key 档，且两次重跑不跳序", async () => {
    const { t, sid } = await scaleWorld({ perturb: false });

    const mag = await get(t, sid, `?order=magnitude&limit=${SIM_METRIC_SERIES_DEFAULT_LIMIT}`);
    const key = await get(t, sid, `?order=key&limit=${SIM_METRIC_SERIES_DEFAULT_LIMIT}`);

    // 金丝雀：这个世界**真的**全并列为 0（否则下面那句在一个有区分度的世界上是空转）。
    expect(mag.metrics.map(magnitudeOf)).toEqual(mag.metrics.map(() => 0));
    expect(mag.totalMetrics).toBe(CATALOG); // 且它**真的是**上万量级，不是空世界

    expect(mag.metrics.map((m) => m.key)).toEqual(key.metrics.map((m) => m.key));
    // 顺带钉住 tiebreaker 的方向：升序，不是"某种固定顺序"。
    expect(mag.metrics.map((m) => m.key)).toEqual([...mag.metrics.map((m) => m.key)].sort());

    const again = await get(t, sid, `?order=magnitude&limit=${SIM_METRIC_SERIES_DEFAULT_LIMIT}`);
    expect(again.metrics.map((m) => m.key)).toEqual(mag.metrics.map((m) => m.key));
  });
});
