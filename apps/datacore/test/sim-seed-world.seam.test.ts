import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import {
  DEMO_SIM_WORLD_PERTURB_START_TICK,
  DEMO_SIM_WORLD_SESSION_ID,
  DEMO_SIM_WORLD_TICKS,
  seedDemoSimWorld,
} from "../src/sim/seed-world.js";
import { replayWorldLine } from "../src/sim/metric-series.js";
import { buildPropagationInputs } from "../src/sim/propagation-inputs.js";
import {
  partitionPropagationRules,
  resolveSimScope,
  SIM_METRIC_SERIES_MAX_LIMIT,
  type Perturbation,
  type SimMetricSeriesResponse,
  type SimSession,
  type SimSessionListItem,
  type TickState,
} from "@platform/contracts";

/**
 * WO-SIM-SEED-WORLD · **接缝门**：种子跑完 ⇒ 列表里有 RUNNING 会话，且 tick 态存在、非空、真动过。
 *
 * ══ 咬的是链路，不是函数 ═════════════════════════════════════════════════════
 *
 * 本门刻意**不**断言 `seedDemoSimWorld()` 返回了什么 —— 那只能证明一个函数会返回东西
 * （本仓假绿第 9 形态：实现有、测试有、且是绿的，而链路是断的）。
 * 它断言的是四页真正走的那条路：
 *
 *   播种（数据半：物化对象 + PUBLISHED 传导规则）
 *     → `services.sim` 建会话 + **真 tick**（引擎半：propagateTick 逐格落盘）
 *     → `GET /a/v1/sim/sessions`（**四页的会话钩子 `useConsoleSession` 打的就是这条**）
 *     → 列表里挑得出 `status==="RUNNING" && curTick>=1` 的那条
 *     → 该会话的 tick 态在库里、非空、且与 tick0 不同（= 真跑过传导核）。
 *
 * 任一半漏掉即红：数据半没播 ⇒ 无格子可铺（③ 诚实缺席那条会与①冲突）；
 * 引擎半没真跑 ⇒ curTick 不进位 / tick 态与 tick0 逐字节相同 / trace 恒 null。
 *
 * ⚠ **手写一个 `status:"RUNNING"` 塞进仓储能不能骗过本门**：骗不过 ——
 * ②③ 咬的是「tick 态行存在 + 与 tick0 不同 + trace 非空」，那是只有真 tick 才写得出来的东西。
 * 这三条正是本单派单里点名禁止的那种假 RUNNING 的**反面判据**。
 */

const enableSim = (t: TestApp, tenant = "demo") =>
  t.app.inject({
    method: "PUT",
    url: `/a/v1/tenants/${tenant}/features`,
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 世界态格子数（objectId × stateVar），断言"非空"时用它——`Object.keys(state).length` 只数到对象。 */
const cellCount = (state: TickState): number =>
  Object.values(state).reduce((n, row) => n + Object.keys(row).length, 0);

/**
 * ⚠ 回包类型是 `SimSessionListItem`（**不含 `baseSnapshot`**·WO-SIM-SESSIONS-PROJECTION）。
 * 原来这里写的是 `as SimSession[]` —— 一个 `as` 让类型系统对这件事**一个字都说不出来**
 * （铁律 0.6 第 4 条那个形态：旧名以「数据键」形态存在，`typecheck` 全绿）。
 * 改成投影类型之后，任何再从列表里读世界内容的写法都会**编译当场红**。
 */
const listSessions = async (t: TestApp): Promise<SimSessionListItem[]> => {
  const r = await t.app.inject({ method: "GET", url: "/a/v1/sim/sessions", headers: ADMIN });
  expect(r.statusCode).toBe(200);
  return r.json().items as SimSessionListItem[];
};

/** 单条会话的完整读（含 `baseSnapshot`）—— 列表投影之后，世界内容只从这条路来。 */
const getSession = async (t: TestApp, id: string): Promise<SimSession> => {
  const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${id}`, headers: ADMIN });
  expect(r.statusCode).toBe(200);
  return r.json() as SimSession;
};

/** 指标身份，与 `metric-series.ts` 的 `metricKey` 同式（回包里的 `key` 就是这个）。 */
const metricKey = (objectId: string, stateVar: string): string => `${objectId}.${stateVar}`;

/** 一格指标在窗口内的两条线读数（长度/序与回包的 `ticks` 同）。 */
interface CensusReading {
  objectId: string;
  stateVar: string;
  baseline: (number | null)[];
  actual: (number | null)[];
}

/**
 * **全量普查**：把这个世界的两条线（基线 / 扰动后）整条跑出来，逐格数「谁真的动了」。
 *
 * ══ 为什么这一条对账**离开了 HTTP**（跨单交叉·本次修的就是它）══════════════════════
 *
 * **X（改之前·实测原文）**：⑤e 要数的是「**全世界**真跑动了多少个下游格」，而它拿的是
 * `GET …/metric-series` 的**默认回包** —— `WO-SIM-SERIES-SCALE` 已经给那条端点封了顶
 * （默认 `limit`=12、硬上限 500），于是这条断言实际在数「**这一页里**动了几格」：
 *   · 不传参数         → 回 12 条 / `total=3494` / 动了 4 → 下游 **3**
 *   · `limit=500`      → 回 500 条 / 动了 20 → 下游 19
 *   · `limit=3494`     → 被夹到硬上限 500，同上
 *   而全量真跑动的下游是 **93** 格 ⇒ `expected 3 to be 93`。
 * 形态是本仓记过账的那一句：
 * > 「我用『**这一页**里动了几格』当作『**全世界**动了几格』的证据，而前者并不度量后者。」
 *
 * ⚠ `order=magnitude` **救不了**：它排的是 `|actual 末 − baseline 首|`（窗口内**位移**），
 *   而「动没动」看的是两条线的**分叉**。基线自己也会随 tick 走，位移大的格子多数根本没分叉 ——
 *   实测 `limit=500&order=magnitude` 仍然只捞到 20 个。两个不同的量，别当成同一回事。
 *
 * **Y（现在）**：对账的**真值**由**引擎自己**给 —— `replayWorldLine` 正是那条端点内部用的
 * 同一个纯函数（`buildMetricSeries` 就调它），入参走**唯一装配处** `buildPropagationInputs`。
 * 封顶**一个字节都不动**：那道闸挡的是浏览器 OOM（408,528 条 / 116MB / 21.8 秒），
 * 为了让测试好数而给它开个口子，等于把生产病重新打开一次。
 *
 * ══ 这样会不会造出「第二套真相源」—— 会，所以下面用桥把它钉死 ═══════════════════════
 * 本函数自己装一遍入参（seed / 图 / 规则 / 扰动），万一哪天路由那边改喂别的，
 * 普查就会悄悄与屏上那条曲线分家。⇒ ⑤e 里有两道**桥**，任一处漂移当场红：
 *   · 桥①：封顶回包里每一条「动了」的指标，`baseline`/`actual` 必须与普查**逐值相同**；
 *   · 桥②：拿普查算出的对象当白名单，走**端点自己的** `objectIds` 入口再要一次
 *     （整份装得进硬上限，`truncated:false` 是诚实闸），回来的「动了」集合必须与普查**逐条相同**。
 * 桥②同时是「不必开口子」的证据：端点**已有**的白名单入口就够拿到这一份，不需要新入口。
 */
async function censusWorldLines(t: TestApp, sessionId: string): Promise<{
  catalog: number;
  /** 两条线在窗口内**任一格**取值不同的指标 key，升序。 */
  moved: string[];
  readings: Map<string, CensusReading>;
}> {
  const s = (await t.repos.sim.getSession("demo", sessionId))!;
  // 逐条对齐路由喂给 `buildMetricSeries` 的那一份（`app.ts` 的 metric-series 路由）：
  // 种子取**本会话自己的 tick0 行**（缺行才退回 baseSnapshot）；引擎吃 `active`（= 已发布 − 本会话屏蔽，
  // 走契约唯一实现 `partitionPropagationRules`，不在这里手写一个 filter）；目录口径吃**全量已发布**。
  const seed = (await t.repos.sim.getTickState("demo", s.id, 0))?.state ?? s.baseSnapshot;
  const published = await t.repos.sim.listPropagationRules("demo", true);
  const { active } = partitionPropagationRules(published, s.disabledRuleKeys);
  const perturbations = await t.repos.sim.listPerturbations("demo", s.id);
  // 逐实例分摊权重与图/参数/闸门同一处装配（WO-COEF-FROM-BOM）——路由那一份也是这么喂的。
  const inputs = await buildPropagationInputs(t.repos, t.adminCtx, resolveSimScope(s.scope), active);
  const engine = { graph: inputs.graph, ruleParams: inputs.ruleParams, cadenceGates: inputs.cadenceGates, pairWeights: inputs.pairWeights };
  const actualLine = replayWorldLine({ seed, engine, rules: active, perturbations, toTick: s.curTick });
  const baselineLine = replayWorldLine({ seed, engine, rules: active, perturbations: [], toTick: s.curTick });

  // 目录口径 = `buildMetricSeries` 那一份：两条线在窗口内出现过的格子 ∩ 已发布规则的 source/target 变量。
  const knownStateVars = new Set(published.flatMap((r) => [r.sourceStateVar, r.targetStateVar]));
  const cells = new Map<string, { objectId: string; stateVar: string }>();
  for (const line of [actualLine, baselineLine]) {
    for (const st of line.states) {
      for (const [objectId, row] of Object.entries(st)) {
        for (const [stateVar, v] of Object.entries(row)) {
          if (typeof v !== "number" || !knownStateVars.has(stateVar)) continue;
          cells.set(metricKey(objectId, stateVar), { objectId, stateVar });
        }
      }
    }
  }

  const readings = new Map<string, CensusReading>();
  const moved: string[] = [];
  const ticks = Array.from({ length: s.curTick + 1 }, (_, i) => i);
  // 缺格记 `null`（不插值、不补 0）—— 与 `buildMetricSeries` 的 `readAt` 同一条纪律。
  const readAt = (line: { states: TickState[] }, tick: number, objectId: string, stateVar: string): number | null => {
    const v = line.states[tick]?.[objectId]?.[stateVar];
    return typeof v === "number" ? v : null;
  };
  for (const [key, { objectId, stateVar }] of cells) {
    const baseline = ticks.map((tick) => readAt(baselineLine, tick, objectId, stateVar));
    const actualVals = ticks.map((tick) => readAt(actualLine, tick, objectId, stateVar));
    readings.set(key, { objectId, stateVar, baseline, actual: actualVals });
    // 比较器与 ⑤b/⑤c 在 HTTP 那侧用的是同一式（`JSON.stringify` 两条线），不另立一套判据。
    if (JSON.stringify(baseline) !== JSON.stringify(actualVals)) moved.push(key);
  }
  return { catalog: cells.size, moved: moved.sort(), readings };
}

describe("WO-SIM-SEED-WORLD · 种子世界接缝", () => {
  it("① 播种 → GET /a/v1/sim/sessions 里有一条 RUNNING(curTick≥1)、baseSnapshot 非空；② tick 态落盘且真动过；③ 幂等", async () => {
    const t = await makeApp();
    await enableSim(t);

    // ── 金丝雀：播种之前列表是空的 ────────────────────────────────────────────────
    // 没有这一步，下面的"有一条 RUNNING"就可能是**别处早就有的**会话，
    // 那样这门度量的就不是本单（"我用 X 当作 Y 的证据，而 X 并不度量 Y"）。
    expect(await listSessions(t), "播种前不该有任何沙盘会话").toEqual([]);

    // 数据半：物化本体对象 + 播 PUBLISHED 传导规则（生产 SEED_DEMO 序列的同两步）。
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);

    const report = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    expect(report.created, `种子世界没建起来：${report.reason ?? ""}`).toBe(true);

    // ── ① 四页真正走的那条路：列表里挑得出 RUNNING ──────────────────────────────
    const items = await listSessions(t);
    expect(items).toHaveLength(1); // 没被 `snapshotKind` 过滤掉（那个键会让会话从沙盘列表里消失）
    const s = items[0]!;
    expect(s.id).toBe(DEMO_SIM_WORLD_SESSION_ID);
    expect(s.status).toBe("RUNNING");
    expect(s.curTick).toBe(DEMO_SIM_WORLD_TICKS);
    expect(s.curTick).toBeGreaterThanOrEqual(1);
    // WO-SIM-SESSIONS-PROJECTION：列表**不再带世界内容**，「世界非空」改由规模摘要作证；
    // 完整的那一份从 `GET …/:id` 取（两处必须逐值对得上，见下）。
    expect(s.baseSnapshotScale.cells, "规模摘要说这个世界非空").toBeGreaterThan(0);
    const full = await getSession(t, s.id);
    expect(cellCount(full.baseSnapshot), "baseSnapshot 非空").toBeGreaterThan(0);
    expect(s.baseSnapshotScale.cells, "列表摘要与单取的世界必须是同一个数").toBe(cellCount(full.baseSnapshot));
    expect(s.baseSnapshotScale.objects).toBe(Object.keys(full.baseSnapshot).length);

    // 出处记号随列表原样下发（判据 3：这批读数说得出出处，且分项是**现测**的）。
    const origin = (s.scope as { baseSnapshotOrigin?: Record<string, unknown> }).baseSnapshotOrigin;
    expect(origin?.kind).toBe("DERIVED");
    expect(origin?.cells).toBe(cellCount(full.baseSnapshot));
    expect((origin?.measuredCells as number) + (origin?.derivedCells as number)).toBe(origin?.cells);

    // ── ② tick 态：存在 + 非空 + 与 tick0 不同 + trace 非空（= 真的过了传导核）────
    const tick0 = await t.repos.sim.getTickState("demo", s.id, 0);
    const last = await t.repos.sim.getTickState("demo", s.id, s.curTick);
    expect(tick0, "tick0 行必须落盘").not.toBeNull();
    expect(last, `tick${s.curTick} 行必须落盘`).not.toBeNull();
    expect(cellCount(last!.state), "当前 tick 态非空").toBeGreaterThan(0);
    expect(last!.state, "世界真动过（恒等桩会逐字节相同）").not.toEqual(tick0!.state);
    expect(last!.trace, "真 tick 会记 trace；假 RUNNING 记不出来").not.toBeNull();
    expect(last!.trace!.length).toBeGreaterThan(0);

    // 世界态是从**真物化对象**上铺的：随便取一格，它的 objectId 必须是本租户真对象。
    const anyObjectId = Object.keys(full.baseSnapshot)[0]!;
    const objs = await t.repos.objects.listByType("demo", (await t.repos.objects.get("demo", anyObjectId))!.type);
    expect(objs.some((o) => o.id === anyObjectId), "世界的键 = 真物化对象 id（不是 `${type}#0` 占位）").toBe(true);

    // ── ③ 幂等：重复播种一条都不多，也不会把已有世界又推 3 拍 ────────────────────
    const again = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    expect(again.created).toBe(false);
    const after = await listSessions(t);
    expect(after).toHaveLength(1);
    expect(after[0]!.curTick).toBe(DEMO_SIM_WORLD_TICKS);
  });

  /**
   * ══ WO-SIM-SEED-PERTURB · 扰动接缝 ═══════════════════════════════════════════════
   *
   * **X（改之前·真服务实测）**：`sims_demo_seed_world` 的 `GET …/perturbations` 回 `{"items":[]}`，
   * `GET …/metric-series` 3494 条指标里「`baseline ≠ actual`」的**条数 = 0** ——
   * 样例 `obj_arinvoice_arinvoice_0_0.overduePressure`
   * `baseline=[15,15,36.6,83.8]` / `actual=[15,15,36.6,83.8]` 逐值全等。
   * 推演沙盘首页两列一模一样，一整片"无事发生"。
   *
   * **Y（应该）**：种子世界带一条说得出出处的扰动，两条线真分叉，且**下游真的被带动**。
   *
   * ── 咬的是链路，不是"有没有那条记录" ─────────────────────────────────────────────
   * ⛔ 只断言「扰动记录存在」**不算数** —— 那正是判据 2 点名的静默错答：
   *    扰动写到一个 `propagateTick` 取不到的键上（`Type#0` 这种占位），记录明明在、
   *    `state[sourceId]` 却永远取不到 ⇒ 屏上那一格变了、下游一动不动，而测试全绿。
   * 所以本门断的是整条链：
   *    播种 → 扰动入库 → **引擎在 tick1 施加** → `GET …/metric-series` 两条线分叉
   *    → **动的对象不止落点自身**（下游真的被带动）。
   *
   * ── 谁走 HTTP、谁不走（WO-SEED-REACH-SEAM 划的这条线，别再来回搬）──────────────────
   * ⑤a–⑤d、⑤f **全部经 HTTP**，且都在 `WO-SIM-SERIES-SCALE` 那道封顶**之下**成立 ——
   * 「两条线真分叉」「下游真的被带动」在 12 条的默认页里照样看得见（实测：动了 4 条、下游 3 个），
   * 接缝因此仍由真实端点咬着。
   * 只有 ⑤e 例外：它要的是**全世界动了多少格**这个**总量**，而总量按定义就不可能从一个
   * 「刻意只回一页」的端点里数出来。故它的真值改由引擎自己给（`censusWorldLines`），
   * 并用两道桥钉回 HTTP（见该函数头注）。**封顶一个字节都没动** —— 那道闸挡的是浏览器 OOM，
   * 为了让一条断言好数而给它开口子，等于拿生产的病换测试的方便。
   */
  it("⑤ 扰动接缝：播种 ⇒ 会话有扰动 ⇒ metric-series 两条线分叉 ⇒ 且被带动的对象不止落点自身", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);

    const report = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
    expect(report.created, `种子世界没建起来：${report.reason ?? ""}`).toBe(true);

    // ── ⑤a 扰动真在库里，且**落点是真物化对象上真存在的那一格**（判据 2 的前半）──────
    const pr = await t.app.inject({
      method: "GET", url: `/a/v1/sim/sessions/${DEMO_SIM_WORLD_SESSION_ID}/perturbations`, headers: ADMIN,
    });
    expect(pr.statusCode).toBe(200);
    const perturbations = pr.json().items as Perturbation[];
    // 一条（判据 3：只播一条 ⇒ `delta`/`scale` 不可交换的顺序问题在结构上不存在）。
    expect(perturbations, `没播扰动：${report.perturbationReason ?? ""}`).toHaveLength(1);
    const p = perturbations[0]!;
    expect(p.startTick, "startTick 必须 ≥1：取 0 会被路由写进 tick0 行，而两条线共用同一份 tick0 种子 ⇒ 又变回逐值全等")
      .toBe(DEMO_SIM_WORLD_PERTURB_START_TICK);
    expect(p.startTick).toBeGreaterThanOrEqual(1);
    // 落点必须是真物化对象（不是 `${type}#0` 占位），且该状态变量在它 tick0 的态里真的有。
    const landing = await t.repos.objects.get("demo", p.targetObjectId);
    expect(landing, `落点 ${p.targetObjectId} 必须是真物化对象`).not.toBeNull();
    const tick0 = await t.repos.sim.getTickState("demo", DEMO_SIM_WORLD_SESSION_ID, 0);
    expect(typeof tick0!.state[p.targetObjectId]?.[p.targetStateVar], "落点那一格必须在世界态里真存在").toBe("number");
    // 幅度有出处：全距 = 该状态变量在本世界的观测 max−min，且**必须非零**（`delta 0` = 什么都没发生）。
    expect(report.choice!.magnitude).toBe(report.choice!.varMax - report.choice!.varMin);
    expect(p.magnitude).toBe(report.choice!.magnitude);
    expect(p.magnitude).not.toBe(0);

    // ── ⑤b 两条线真分叉（判据 7 的核心：`baseline ≠ actual` 的条数 > 0）─────────────
    //
    // ⚠ **2026-08-25 WO-SIM-ROOT-PROCUREMENT 订正：这一臂原来读的是「默认那一页」，它不度量分叉。**
    //   原文取 `GET …/metric-series`（不带参数 ⇒ `limit=12` + `order=magnitude`）里逐值不等的条数。
    //   而 `magnitude` 排的是**窗口内位移** `|actual 末 − baseline 首|`，**不是两条线的分叉** ——
    //   这件事本文件 ⑤e 的头注早就写着，只是当时没意识到 ⑤b 自己也踩在同一个坑上：
    //   在那 12 条恰好包含分叉格的世界里它是绿的，**靠的是运气不是判据**。
    //   补进 3 条采购根源边（`procurementDelay → shortageRisk`）之后，`shortageRisk`/`supplyRisk`
    //   的**基线位移**排到了前 12（基线自己也在长），把真正分叉的那些格挤出了这一页 ⇒
    //   实测 `moved` 从 4 掉到 **0**，而全量普查里分叉的仍是 **93 格**。传导核一切正常，
    //   红的是这条断言的口径。形态就是本仓那一句：
    //     **「我用『这一页里动了几格』当作『这个世界动了几格』的证据，而前者并不度量后者。」**
    //
    //   修法**不是**把 limit 调大（那只是把运气的赌注加大），也**不是**给端点开"全量"口子
    //   （那道封顶挡的是浏览器 OOM）。改走端点**已有**的 `objectIds` 白名单入口 ——
    //   即本文件 ⑤e-桥② 早就在用的那条路：筛完只剩这些对象的格子、整份装得进硬上限，
    //   `truncated:false` 就是"这一份是完整的"那句话的诚实闸。HTTP 仍在链路里，判据不再靠运气。
    const census = await censusWorldLines(t, DEMO_SIM_WORLD_SESSION_ID);
    const movedObjectIds = [...new Set(census.moved.map((k) => census.readings.get(k)!.objectId))].sort();
    expect(movedObjectIds.length, "普查里一个对象都没动 ⇒ 扰动压根没进传导核").toBeGreaterThan(0);
    const ms = await t.app.inject({
      method: "GET",
      url: `/a/v1/sim/sessions/${DEMO_SIM_WORLD_SESSION_ID}/metric-series`
        + `?limit=${SIM_METRIC_SERIES_MAX_LIMIT}&order=key&objectIds=${encodeURIComponent(movedObjectIds.join(","))}`,
      headers: ADMIN,
    });
    expect(ms.statusCode).toBe(200);
    const series = ms.json() as SimMetricSeriesResponse;
    expect(series.truncated, "白名单筛完仍被硬上限截断 ⇒ 这一份不完整，下面的计数不许信").toBe(false);
    const moved = series.metrics.filter((m) => JSON.stringify(m.baseline) !== JSON.stringify(m.actual));
    expect(moved.length, "两条线逐值全等 = 扰动没进传导核（本单要消灭的那个 X）").toBeGreaterThan(0);

    // ── ⑤c **下游真的被带动**（判据 2 的后半 · 本门最要害的一条）───────────────────
    // 只有落点自己动 = 扰动被就地写进了那一格、没沿链路走 —— 记录在、屏上也变了、下游一动不动。
    const movedObjects = new Set(moved.map((m) => m.objectId));
    const downstream = [...movedObjects].filter((id) => id !== p.targetObjectId);
    expect(downstream.length, "只有落点自身动过 ⇒ 扰动没沿链路传导（静默错答的老形态）").toBeGreaterThan(0);
    // 落点自己当然也得动 —— 它不动说明扰动压根没落地。
    expect(movedObjects.has(p.targetObjectId), "落点自己必须动").toBe(true);

    // ── ⑤d 金丝雀：先自证这个比较器真能分辨「相同」与「不同」（铁律 0.6）────────────
    // 它若把什么都判成"动了"，⑤b/⑤c 就是两条恒真的断言，度量不到任何东西。
    // 已知必**不**中：tick0 是两条线共用的种子 ⇒ 第 0 格必须逐值相等，分叉不许提前到 t0。
    expect(series.ticks[0]).toBe(0);
    for (const m of moved) {
      expect(m.baseline[0], `${m.key} 在 t0 就分叉了 ⇒ 扰动被烙进了基线自己的起点`).toBe(m.actual[0]);
    }
    // 已知必中：随便挑一条动了的，它至少有一格真的不等（不是 JSON 序列化的假象）。
    const sample = moved[0]!;
    expect(sample.baseline.some((v, i) => v !== sample.actual[i]), "金丝雀：比较器认得出真差值").toBe(true);
    // 反向金丝雀：没动的那些，逐格必须真相等。
    const still = series.metrics.filter((m) => JSON.stringify(m.baseline) === JSON.stringify(m.actual));
    expect(still.length, "全世界都动了 ⇒ 这个世界里没有「没被带动」的对照，⑤b 就不成其为证据").toBeGreaterThan(0);
    expect(still[0]!.baseline).toEqual(still[0]!.actual);

    // ── ⑤e 可达面口径不是装饰：结构估的下游格数 == 真跑动了的下游格数 ────────────────
    // 这一条是给排序键做的"金丝雀"：`reachCells` 若与真跑对不上，那它就不度量它声称度量的东西
    // （本单实测过一次：第一跳开销算错 ⇒ 估 37 / 真 94，正是靠这条对账抖出来的）。
    //
    // ⚠ **真值不从「默认那一页」里数**（WO-SEED-REACH-SEAM·跨单交叉）——
    //   那份只有 12 条，数出来的是「这一页动了几格」不是「全世界动了几格」，实测 3 ≠ 93。
    //   全量由引擎自己给：`censusWorldLines` 走的是端点内部同一个 `replayWorldLine` +
    //   同一处 `buildPropagationInputs`，**不碰那道封顶**（理由见该函数头注）。
    //   （`census` 现在在 ⑤b 就算好了 —— 因为 ⑤b 自己也需要它来选白名单，见那一段的订正。）
    const landingKey = metricKey(p.targetObjectId, p.targetStateVar);
    // 金丝雀：普查必须先认得出落点自己动了 —— 连它都没动，下面数出来的就不是"这条扰动的下游"。
    expect(census.moved, "普查里连落点自己都没动 ⇒ 普查装的入参与真跑那条不是同一个世界").toContain(landingKey);
    // `reachCells` 的口径：**不含落点那一格**（落点对象上的其它格仍算下游）。
    const censusDownstreamCells = census.moved.filter((k) => k !== landingKey);
    expect(censusDownstreamCells.length, "结构可达面与真跑对不上 ⇒ 排序键度量的不是传导").toBe(report.choice!.reachCells);
    // `reachObjects` 的口径：**不含落点对象**。两个数分属排序键结构里两个不同字段，
    // 只对其中一个 ⇒ 另一个可以随便错而没人知道（"一个数盖住两件事"的老形态）。
    const censusDownstreamObjects = new Set(
      census.moved.map((k) => census.readings.get(k)!.objectId).filter((id) => id !== p.targetObjectId),
    );
    expect(censusDownstreamObjects.size, "结构可达面的**对象**数与真跑对不上").toBe(report.choice!.reachObjects);

    // ── ⑤e-桥① 普查与**屏上那条曲线**必须是同一个世界（防"第二套真相源"）──────────────
    // 回包里每一条"动了"的指标，逐值必须与普查相同。普查若哪天装错了入参
    //（种子取错、规则集取错、范围没裁），这里当场红 —— 而不是安静地把 ⑤e 变成自说自话。
    for (const m of moved) {
      const r = census.readings.get(m.key);
      expect(r, `${m.key}：HTTP 说它动了，普查目录里却没有这一格 ⇒ 两处口径已分家`).toBeDefined();
      expect(m.baseline, `${m.key}：普查的基线与回包对不上 ⇒ 普查不是同一个世界`).toEqual(r!.baseline);
      expect(m.actual, `${m.key}：普查的扰动后线与回包对不上 ⇒ 普查不是同一个世界`).toEqual(r!.actual);
    }

    // ── ⑤e-桥② 端点**已有**的白名单入口就够复现这一份（⇒ 不需要给它开"全量"口子）────────
    // ⑤b 那次请求走的正是这条白名单路（`limit=硬上限 & order=key & objectIds=普查动过的对象`），
    // 故这里直接拿它的结果对账：经端点拿回来的「动了」集合必须与普查**逐条相同**。
    // （订正前这一段自己另发一次同样的请求；⑤b 改口径后两次请求完全同参，留两份就是白跑一次。）
    const httpMoved = moved.map((m) => m.key).sort();
    expect(httpMoved, "经端点白名单入口拿回来的「动了」集合与普查对不上 ⇒ 普查是第二套真相源").toEqual(census.moved);

    // ── ⑤f **落库的世界**与**屏上的曲线**必须是同一个世界 ──────────────────────────
    // 为什么必须单独咬这一条（变异反证逼出来的，不是想出来的）：
    // `metric-series` **从 tick0 现场重算两条线**，它压根不读 `sim_tick_state` 的落盘行。
    // ⇒ 只要扰动记录在库里，哪怕它是在 tick **之后**才建的（那时逐格世界态早已算完、
    //   `POST …/perturbations` 只把落点那一格就地改了、下游一格没动），
    //   ⑤b/⑤c 依旧全绿 —— 曲线是对的，而**落盘的世界是错的**。
    //   沙盘取「当前世界」走的正是那批落盘行（`GET …/:id/world`），于是屏上两处对不上账。
    // 判据：逐格比对「落盘的当前 tick 态」与「曲线 actual 的最后一格」，必须逐值相同。
    const last = await t.repos.sim.getTickState("demo", DEMO_SIM_WORLD_SESSION_ID, series.toTick);
    expect(last, `tick${series.toTick} 行必须落盘`).not.toBeNull();
    for (const m of moved) {
      expect(
        last!.state[m.objectId]?.[m.stateVar],
        `${m.key}：落盘世界与曲线 actual 对不上 ⇒ 扰动没进那条真跑的传导（多半是建扰动排到了 tick 之后）`,
      ).toBe(m.actual[m.actual.length - 1]);
    }
  });

  it("⑥ 确定性（R6）：同一份世界重播一遍，选出来的落点与幅度**逐字节一致**", async () => {
    // 判据 5 要的是"同一份种子重跑字节级一致"。两个互不相干的 app 各播一次再逐字段比 ——
    // 比"把纯函数调用两次"强：它连**读库顺序**引入的漂移也一起咬住（`listByType` / `links.list`
    // 若哪天回来的顺序不稳，选点就会跟着漂，而纯函数那种比法看不见）。
    const seedOnce = async (): Promise<Perturbation | null> => {
      const t = await makeApp();
      await enableSim(t);
      await seedBattery(t);
      await seedDemoPropagationRules(t.repos);
      const r = await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);
      expect(r.created).toBe(true);
      return r.perturbation ?? null;
    };
    const a = await seedOnce();
    const b = await seedOnce();
    expect(a, "第一次就没播出扰动，这条断言便无从谈起").not.toBeNull();
    // 含 `id` 与 `createdAt`：两者都固定（不取时钟、不取 randomBytes）⇒ 逐字节相同。
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("④ 诚实缺席：零传导规则/零物化对象的租户**不建空世界**（空 baseSnapshot 的 RUNNING = 另一种占位）", async () => {
    const t = await makeApp();
    const report = await seedDemoSimWorld(t.repos, t.services.sim, {
      tenantId: "freshco",
      userId: "usr_freshco_admin",
      roles: ["admin"],
      attributes: {},
    });
    expect(report.created).toBe(false);
    expect(report.sessionId).toBeNull();
    expect(report.reason, "不建就必须说为什么（诚实缺席，不是静默返回空回执）").toContain("零可铺格子");
    // 断言落在**仓储**上而不是 REST 上：`freshco` 是个连 `sim.sandbox` 都没开的干净租户，
    // 走 REST 拿到的会是 404 FEATURE_NOT_FOUND（entitlement 先于 authz），
    // 那证明的是"功能没开"，**不是**"没建世界"——两件事，别拿一个当另一个的证据。
    expect(await t.repos.sim.listSessions("freshco")).toEqual([]);
  });
});
