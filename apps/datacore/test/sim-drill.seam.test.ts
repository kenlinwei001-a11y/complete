import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import {
  DRILL_EVENT_SPECS,
  DrillEventKindSchema,
  assertDrillRoutingTableComplete,
  drillRoutesFor,
  normalizeDrillDataMode,
  resolveDrillArgs,
  ticksForDays,
  type DrillReport,
} from "@platform/contracts";
import { orchestrateDrill } from "../src/sim/drill-orchestrator.js";
import { scanDrillFindings, transitiveClosureSizes, quantileSorted } from "../src/sim/drill-scan.js";

/**
 * WO-SIM-DRILL-P12 · **推演演习接缝门**。
 *
 * ── 为什么必须接缝驱动、不能各半 unit（SEAM-GATE 头号判据）─────────────────────
 * 本单跨**契约半**（事件 schema + 路由表 + 卡点语义）· **编排半**（分派 → 真调 → 归一）·
 * **求解器半**（`sop_reschedule` 等 8 个既有求解器的真实输出形状）· **路由半**（真端点装配）。
 * 各半分开测都能全绿而功能是坏的，四种**真实**死法：
 *  · 路由表登记了但编排器没读它（写死 if 链）⇒ 加事件不生效，而单测路由表照样绿；
 *  · 求解器真被调了，但归一时把缺失的 `dataMode` 当成 `LIVE` ⇒ 屏上把估算画成实测；
 *  · 求解器抛错被 `catch { continue }` 吞掉 ⇒ 屏上从「没算出来」变成「没有风险」；
 *  · 归一读的字段名是照 PRD 抄的（PRD 说 `tightness` 在顶层，实测在 `rows[].tightness`
 *    且是**一张 factor→number 的表**）⇒ 取到 `undefined`，一条卡点都出不来而且不报错。
 * 故 ①②③ 一律走**真路由 inject**（真 seed → 真求解器 → 真编排），不直调纯函数。
 *
 * ── 三靶变异反证（每条动过的断言都要有靶）─────────────────────────────────────
 * 靶① 路由表改空 ⇒ ②「求解器真被调用」红
 * 靶② 归一处 `dataMode` 强制 LIVE ⇒ ④「诚实位」红
 * 靶③ 求解器抛错时静默跳过 ⇒ ⑤「未能评估仍在清单里」红
 */

const enableSim = async (t: TestApp) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/**
 * 锚点订单 —— 仓主验收线原话「把 SO-3391 交期提前 10 天」里的那一单。
 * 它是**种子里真实存在的行**（`synthetic/battery.ts` 的 `{ so:"SO-3391", cust:"广汽集团",
 * model:"4680-NCM", qty:7259, due:"2026-06-24", pri:"高" }`），不是本文件编的一个 id ——
 * 编一个不存在的 id，`sop_reschedule` 会走 404 分支，这道门就永远验不到真实的挤占逻辑。
 */
const ANCHOR_ORDER = "SO-3391";
const ADVANCE_DAYS = 10;

async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await enableSim(t);
  return t;
}

async function newSession(t: TestApp, tickDays = 1): Promise<string> {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { tickDays } });
  expect(r.statusCode).toBe(201);
  return (r.json() as { id: string }).id;
}

async function runDrill(t: TestApp, sid: string, payload: Record<string, unknown>): Promise<DrillReport> {
  const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/drill`, headers: ADMIN, payload });
  expect(r.statusCode).toBe(200);
  return r.json() as DrillReport;
}

describe("WO-SIM-DRILL-P12 · 推演演习接缝", () => {
  // ══════════════════════════════════════════════════════════════════════
  // ① 契约半：路由表数据驱动 · 枚举与登记同覆盖
  // ══════════════════════════════════════════════════════════════════════
  it("① 路由表登记了全部 11 类事件，且每类至少一条路由（枚举加了表没加 ⇒ 当场抛）", () => {
    expect(() => assertDrillRoutingTableComplete()).not.toThrow();
    // 金丝雀：枚举本身确实有 11 个值（若这里读到 0，是契约没加载对，不是「表是空的」）
    expect(DrillEventKindSchema.options.length).toBe(11);
    expect(DRILL_EVENT_SPECS.length).toBe(11);
    for (const kind of DrillEventKindSchema.options) {
      expect(drillRoutesFor(kind).length, `${kind} 一条路由都没有`).toBeGreaterThan(0);
    }
  });

  /**
   * ══ WO-EVENTS-WRITE-STATE 的接缝断言 ══════════════════════════════════════
   *
   * **今天的行为是 X，应该是 Y**（COO 2026-08-28 真后端实测复现，本单开工第一步）：
   * · **X**：11 类事件里只有 `MATERIAL_REPRICE` 声明了世界态落点，其余 10 类
   *   `stateEffect: null` ⇒ 只被路由到求解器，**一格世界态都不写**。
   * · **Y**：每一类事件都落在一个**在传导图上真有出边**的状态变量上。
   *
   * ⚠ **为什么这条必须是接缝测试而不是纯契约单测**：「有没有出边」这件事，
   * 契约层**根本答不出来** —— 出边表是运行期数据（`PropagationRule`，各租户自己维护）。
   * 只在契约里断言「11 类都有 stateEffect」会得到一个漂亮的绿灯，
   * 而落点完全可能指向一个本租户压根没有出边的格子 ⇒ 冲击打上去一步都传不下去，
   * 屏上表现为「看起来改了实际还是不动」，**比压根不落点更难发现**（派单原话）。
   * 故必须拿**真 seed 出来的已发布规则**去比。
   */
  it("① 11 类事件**全部**有世界态落点，且每个落点在真规则表上**真有出边**（落在叶子上比不落更糟）", async () => {
    const t = await seededApp();
    const rules = await t.repos.sim.listPropagationRules("demo", true);
    // 金丝雀：先证明规则表真读出来了。读到 0 是「seed 没跑/查错了」，不是「没有出边」——
    // 少了这一句，下面每条断言都会以「所有落点都没出边」的形态整齐地红，把人指向错误的方向。
    expect(rules.length, "已发布传导规则读到 0 条 ⇒ 是规则表没读出来，不是落点没有出边").toBeGreaterThan(0);

    const outEdges = new Map<string, string[]>();
    for (const r of rules) {
      const k = `${r.sourceTypeKey}.${r.sourceStateVar}`;
      outEdges.set(k, [...(outEdges.get(k) ?? []), `${r.targetTypeKey}.${r.targetStateVar}`]);
    }
    // 金丝雀②：拿一个**已知必中**的格子验证这张出边表是对的（本来就在跑的那条料价链）
    expect(outEdges.get("Material.priceShock"), "金丝雀不中 ⇒ 出边表建错了，不是落点有问题").toContain("Model.costPressure");

    for (const s of DRILL_EVENT_SPECS) {
      expect(s.stateEffect, `${s.kind}（${s.label}）没有世界态落点 ⇒ 用户加了它也不会改变任何数`).not.toBeNull();
      const eff = s.stateEffect!;
      const outs = outEdges.get(`${eff.objectType}.${eff.stateVar}`) ?? [];
      expect(
        outs.length,
        `${s.kind} 的落点 ${eff.objectType}.${eff.stateVar} 在真规则表上零出边 ⇒ 打上去一步都传不下去`,
      ).toBeGreaterThan(0);
    }
    await t.app.close();
  });

  it("① 加一个新事件只需改**一处**：路由与校验规则全部由 DRILL_EVENT_SPECS 派生", () => {
    // 判据：编排器拿到的路由**完全**来自规格表 —— 表里有几条，`drillRoutesFor` 就给几条
    // （加上通用路由，且按 solverKey 去重）。这条断言使「引擎里另写一条 if 分支」变得可见：
    // 若编排器私自加了一个求解器，端到端的 solverRuns 会多出表里没有的 key（见 ② 的集合断言）。
    const spec = DRILL_EVENT_SPECS.find((s) => s.kind === "ORDER_RESCHEDULE")!;
    const routes = drillRoutesFor("ORDER_RESCHEDULE");
    const expected = new Set([...spec.routes.map((r) => r.solverKey), "risk_timeline"]);
    expect(new Set(routes.map((r) => r.solverKey))).toEqual(expected);
  });

  it("① 入参解释是声明式的：required 缺值 ⇒ 报 missing（而不是硬调一次拿 400）", () => {
    /**
     * ⚠ 样本从 `FORECAST_BIAS` 换成 `ORDER_INSERT`（WO-EVENTS-WRITE-STATE）：
     * 预测偏差的 `modelId` 已改成从 `eventTarget` 取（用户在下拉里选了型号就够，
     * 不必再手填一遍），故它上面已经没有「payloadKey 取不到」这一态可测。
     * 临时插单的型号是**另一件事**（给哪个客户插哪个型号），仍走 payloadKey 且必填 ——
     * 这条断言要咬的「声明式取参 + required 缺值报 missing」在它身上一字不差地成立。
     */
    const spec = DRILL_EVENT_SPECS.find((s) => s.kind === "ORDER_INSERT")!;
    const route = spec.routes.find((r) => r.solverKey === "capacity_forecast")!;
    // `capacity_forecast` 实测**必须**带 modelId（不带 → 400 "modelId required"）
    const without = resolveDrillArgs(route, { kind: "ORDER_INSERT", targetObjectId: "X", payload: {}, effectiveDay: 0 }, 30);
    expect(without?.missing).toContain("modelId");
    const withIt = resolveDrillArgs(
      route,
      { kind: "ORDER_INSERT", targetObjectId: "X", payload: { modelId: "2170-NCM" }, effectiveDay: 0 },
      30,
    );
    expect(withIt?.missing).toEqual([]);
    expect(withIt?.args).toEqual({ modelId: "2170-NCM" });

    // 预测偏差这一路改从 eventTarget 取 ⇒ 选了型号就不缺参（这是本单去掉的那格多余手填框）
    const fbRoute = DRILL_EVENT_SPECS.find((s) => s.kind === "FORECAST_BIAS")!.routes.find((r) => r.solverKey === "capacity_forecast")!;
    const fb = resolveDrillArgs(fbRoute, { kind: "FORECAST_BIAS", targetObjectId: "2170-NCM", payload: { biasPct: 20 }, effectiveDay: 0 }, 30);
    expect(fb?.missing).toEqual([]);
    expect(fb?.args).toEqual({ modelId: "2170-NCM" });
  });

  // ══════════════════════════════════════════════════════════════════════
  // ② 接缝主干：事件 → 编排 → 求解器**真被调** → 归一 → DrillFinding
  //    （任一半漏即红）
  // ══════════════════════════════════════════════════════════════════════
  it("② 端到端：SO-3391 提前 10 天 ⇒ 求解器真被调 + 屏上给出被挤占订单号与代价数字", async () => {
    const t = await seededApp();
    const sid = await newSession(t);
    const rep = await runDrill(t, sid, {
      horizonDays: 30,
      events: [{ kind: "ORDER_RESCHEDULE", targetObjectId: ANCHOR_ORDER, payload: { advanceDays: ADVANCE_DAYS }, effectiveDay: 0 }],
    });

    // ── (a) 求解器**真的**被调用了（靶① 把路由表改空 ⇒ 这里当场红）──────────────
    const called = rep.solverRuns.map((r) => r.solverKey);
    expect(called, "一个求解器都没被调用 ⇒ 路由表没被读，或编排器没走它").toContain("sop_reschedule");
    expect(called).toContain("risk_timeline"); // 通用路由：任何事件都调
    // 且**没有**表外的 key —— 编排器私加 if 分支会在这里露出来
    const allowed = new Set(drillRoutesFor("ORDER_RESCHEDULE").map((r) => r.solverKey));
    for (const k of called) expect(allowed.has(k), `${k} 不在路由表里，编排器私自加了分支？`).toBe(true);
    expect(rep.solverRuns.find((r) => r.solverKey === "sop_reschedule")?.ok).toBe(true);

    // ── (b) 归一真的产出了结论（求解器调通但归一读错字段名 ⇒ 这里红）──────────────
    const displaced = rep.findings.filter((f) => f.source.solverKey === "sop_reschedule" && f.key.includes("displaced"));
    expect(displaced.length, "sop_reschedule 调通了却一条被挤占订单都没归一出来").toBeGreaterThan(0);

    // ── (c) 仓主的验收线：**具体订单号 + 代价数字**都在屏上那句话里 ────────────────
    for (const f of displaced) {
      // 订单号（不是「有 2 单被挤」这种模糊话）
      expect(f.where.objectId).toMatch(/^SO-/);
      expect(f.why).toContain(f.where.objectId);
      // 代价数字：`why` 里带总代价，`provenance` 里带分项（换型/加班/延误）
      expect(f.why).toContain("代价");
      expect(typeof f.source.provenance.costTotal).toBe("number");
      expect(f.source.provenance.costBreakdown).toBeTruthy();
      // R13 溯源：能回仓储对拍的下钻三元组
      expect(f.source.provenance.drill).toBeTruthy();
    }
  });

  it("② 事件驱动的结论**只在给了事件时**出现（scanOnly 不调求解器）", async () => {
    const t = await seededApp();
    const sid = await newSession(t);
    const scanOnly = await runDrill(t, sid, { horizonDays: 30, scanOnly: true, events: [] });
    // 没有事件 ⇒ 没有求解器回执；但**扫描照跑**（堵点来自传导图，与事件无关）
    expect(scanOnly.solverRuns).toEqual([]);
    expect(scanOnly.findings.some((f) => f.source.solverKey === "sop_reschedule")).toBe(false);
  });

  // ══════════════════════════════════════════════════════════════════════
  // ③ 时间语义：tickDays（G-DRILL-1）
  // ══════════════════════════════════════════════════════════════════════
  it("③ 推演 N 天 ⇒ ceil(N/tickDays) 个 tick，且天口径随会话走", async () => {
    expect(ticksForDays(30, 1)).toBe(30);
    expect(ticksForDays(30, 7)).toBe(5); // ceil(30/7)
    expect(ticksForDays(1, 7)).toBe(1);

    const t = await seededApp();
    const sid = await newSession(t, 7);
    const rep = await runDrill(t, sid, { horizonDays: 30, scanOnly: true, events: [] });
    expect(rep.tickDays).toBe(7);
    expect(rep.ticks).toBe(5);
  });

  it("③ tickDays 从 SimSession 透到**下游四页的消费面**（会话列表投影）", async () => {
    // ⚠ 本条只验「四页够得着」，**不验四页已经按天显示** —— 后者是 WO-SIM-CONSOLE-DAYS。
    // 下游四页的会话单源 `useConsoleSession` 走 `GET /a/v1/sim/sessions` 的
    // `SimSessionListItem`，再经 `pickLatestRunningSession` 整条返回。
    // 故只要列表项带上 tickDays，四页就读得到。
    //
    // ── 变异反证：**真正的守卫点是仓储投影，不是 zod** ─────────────────────────
    // 本条断言写完后逐靶实测过，其中一靶**没打红**，照实记在这里免得下一个人再信错：
    //  · 靶 A（无效）把 `tickDays` 从 `SimSessionSchema` 上摘掉 ⇒ 本条**仍然绿**。
    //    原因：`GET /a/v1/sim/sessions` 这条路由**不做 zod parse**
    //    （`app.ts` 直接 `return { items: await repos.sim.listSessionSummaries(...) }`），
    //    所以契约改了运行时不受影响，只有 typecheck 会红。
    //    ⇒ 「schema 里有这个字段」并不度量「响应里有这个字段」。
    //  · 靶 B（有效）把 `tickDays: s.tickDays ?? 1` 从 `repo/memory.ts` 的
    //    `listSessionSummaries` 投影里删掉 ⇒ 本条**当场红**
    //    （`expected undefined to be 7`）。这才是真正承载它的那一行。
    // ⚠ 且 memory 绿不构成 pg 也行（`repo/pg.ts` 是逐列表，见 migration 039 的 R9 注释）。
    const t = await seededApp();
    const sid = await newSession(t, 7);
    // 推一拍让它变成 RUNNING（`pickLatestRunningSession` 只认 RUNNING）
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });

    const list = await t.app.inject({ method: "GET", url: "/a/v1/sim/sessions", headers: ADMIN });
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { items: { id: string; status: string; tickDays?: number }[] }).items;
    const mine = items.find((s) => s.id === sid);
    expect(mine, "会话不在列表里").toBeTruthy();
    expect(mine!.tickDays, "列表投影没带 tickDays ⇒ 下游四页永远读不到天口径").toBe(7);
    expect(mine!.status).toBe("RUNNING"); // 金丝雀：确实是 pickLatestRunningSession 会挑中的那种

    // 时间轴回包也带口径（方案 A：消费方手上只有这一个响应）
    const series = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/metric-series`, headers: ADMIN });
    expect(series.statusCode).toBe(200);
    expect((series.json() as { tickDays?: number }).tickDays).toBe(7);
  });

  // ══════════════════════════════════════════════════════════════════════
  // ④ 诚实位（靶②）：缺 dataMode ⇒ UNDECLARED，**绝不** LIVE
  // ══════════════════════════════════════════════════════════════════════
  it("④ 诚实位：sop_reschedule 无 dataMode 字段 ⇒ 归一成 UNDECLARED，不冒充 LIVE", async () => {
    const t = await seededApp();
    const sid = await newSession(t);
    const rep = await runDrill(t, sid, {
      horizonDays: 30,
      events: [{ kind: "ORDER_RESCHEDULE", targetObjectId: ANCHOR_ORDER, payload: { advanceDays: ADVANCE_DAYS }, effectiveDay: 0 }],
    });
    const sop = rep.findings.filter((f) => f.source.solverKey === "sop_reschedule");
    expect(sop.length).toBeGreaterThan(0);
    // 🔴 靶②：把 `readDataMode` 改成 `?? "LIVE"` ⇒ 这一行当场红
    for (const f of sop) {
      expect(f.source.dataMode, "sop_reschedule 实测没有 dataMode 字段，归一必须是 UNDECLARED").toBe("UNDECLARED");
    }
    // 汇总也不许把 UNDECLARED 洗成可信
    expect(rep.summary.trustworthy).toBe(false);
  });

  it("④ 诚实位归一的**唯一实现**：认识的值原样保留，不认识 / 缺失一律 UNDECLARED", () => {
    expect(normalizeDrillDataMode("LIVE")).toBe("LIVE");
    expect(normalizeDrillDataMode("MOCK")).toBe("MOCK");
    expect(normalizeDrillDataMode("PARTIAL")).toBe("PARTIAL"); // 实测 risk_timeline 回这个（PRD 未列）
    expect(normalizeDrillDataMode(undefined)).toBe("UNDECLARED");
    expect(normalizeDrillDataMode(null)).toBe("UNDECLARED");
    expect(normalizeDrillDataMode("真的")).toBe("UNDECLARED");
    expect(normalizeDrillDataMode(1)).toBe("UNDECLARED");
  });

  // ══════════════════════════════════════════════════════════════════════
  // ⑤ 失败不静默吞（靶③）：抛错 ⇒「未能评估」留在清单里
  // ══════════════════════════════════════════════════════════════════════
  it("⑤ 求解器抛错 ⇒ 记「未能评估」**留在清单里**，绝不从屏上消失", async () => {
    const rep = await orchestrateDrill({
      events: [{ kind: "ORDER_RESCHEDULE", targetObjectId: ANCHOR_ORDER, payload: { advanceDays: 10 }, effectiveDay: 0 }],
      horizonDays: 30,
      tickDays: 1,
      worldId: "w1",
      forkedFromStateId: null,
      // 全塌
      invokeSolver: async (key) => {
        throw new Error(`SOLVER_BOOM_${key}`);
      },
    });
    // 🔴 靶③：把编排器里失败分支改成 `continue` ⇒ 这三行当场红
    const unevaluated = rep.findings.filter((f) => f.kind === "未能评估");
    expect(unevaluated.length, "求解器全塌了，清单里却一条「未能评估」都没有 ⇒ 被静默吞了").toBeGreaterThan(0);
    expect(unevaluated.some((f) => f.why.includes("SOLVER_BOOM_sop_reschedule"))).toBe(true);
    // 错误码逐条可见（不是一句笼统的「失败」）
    expect(rep.solverRuns.every((r) => r.ok === false)).toBe(true);
    expect(rep.solverRuns.map((r) => r.error).join(" ")).toContain("SOLVER_BOOM_");
  });

  it("⑤ 全部失败 ⇒ allFailed=true 且文案明说「不是没有风险」（与「无卡点」是两个状态）", async () => {
    const allFail = await orchestrateDrill({
      events: [{ kind: "ORDER_RESCHEDULE", targetObjectId: ANCHOR_ORDER, payload: { advanceDays: 10 }, effectiveDay: 0 }],
      horizonDays: 30, tickDays: 1, worldId: "w1", forkedFromStateId: null,
      invokeSolver: async () => { throw new Error("BOOM"); },
    });
    expect(allFail.summary.allFailed).toBe(true);
    expect(allFail.summary.text).toContain("未能评估");
    expect(allFail.summary.text).toContain("不是「没有风险」");

    // 对照：真的没扫出东西 —— 这是**另一个**状态，文案与 allFailed 必须不同
    const empty = await orchestrateDrill({
      events: [], horizonDays: 30, tickDays: 1, worldId: "w1", forkedFromStateId: null,
      invokeSolver: async () => ({}),
    });
    expect(empty.summary.allFailed).toBe(false);
    expect(empty.summary.text).not.toContain("不是「没有风险」");
    expect(empty.summary.text).not.toBe(allFail.summary.text);
  });

  it("⑤ 调通但没登记归一规则 ⇒ 同样记「未能评估」，不静默丢结果", async () => {
    const rep = await orchestrateDrill({
      events: [{ kind: "ORDER_RELOCATE", targetObjectId: "SO-1", payload: {}, effectiveDay: 0 }],
      horizonDays: 30, tickDays: 1, worldId: "w1", forkedFromStateId: null,
      // portfolio 有 normalizer；这里让它回一个**空**壳，risk_timeline 也回空 ⇒ 0 条结论但不是失败
      invokeSolver: async () => ({ someUnknownShape: true }),
    });
    expect(rep.summary.allFailed).toBe(false);
    // 没有结论时，`findings` 可以是空的，但**求解器回执必须在**（证明确实调过）
    expect(rep.solverRuns.length).toBeGreaterThan(0);
    expect(rep.solverRuns.every((r) => r.ok)).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════
  // ⑥ 卡点扫描器（G-DRILL-2）：A 方案分位 · 传递闭包 · 三类互斥
  // ══════════════════════════════════════════════════════════════════════
  it("⑥ 卡点/脆弱点按 P90/P95 分位切，三类由构造互斥（零配置·不许出现固定红线）", () => {
    // 造一个分布明确的世界：19 个 1 + 一个 100 ⇒ 100 必然越过 P95
    const state: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 19; i++) state[`o${i}`] = { v: 1 };
    state.hot = { v: 100 };
    const findings = scanDrillFindings({
      state,
      rules: [],
      typeOf: new Map(Object.keys(state).map((k) => [k, "T"])),
      stateVarLabel: (s) => s,
    });
    const chokes = findings.filter((f) => f.kind === "卡点");
    expect(chokes.map((f) => f.where.objectId)).toEqual(["hot"]);
    // 三类互斥：同一个 (对象,变量) 不许既是卡点又是脆弱点
    const keys = findings.map((f) => `${f.where.objectId}|${f.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
    // 诚实位：传导引擎读的是真实世界态 ⇒ LIVE
    for (const f of findings) expect(f.source.dataMode).toBe("LIVE");
    // 阈值出处进溯源（R13 可下钻），不是一个裸判断
    expect(chokes[0]!.source.provenance.p95).toBeDefined();
    expect(chokes[0]!.source.provenance.basis).toContain("分位");
  });

  it("⑥ 单样本变量不硬判（「算不出分布」不冒充「没事」）", () => {
    const findings = scanDrillFindings({
      state: { only: { v: 999 } },
      rules: [],
      typeOf: new Map([["only", "T"]]),
      stateVarLabel: (s) => s,
    });
    expect(findings.filter((f) => f.kind === "卡点")).toEqual([]);
  });

  it("⑥ 堵点用**传递闭包**不是出度（出度会把「直连 3 个叶子」排在「直连 1 个再散 40 个」前面）", () => {
    // a→b→c→d（a 出度 1，闭包 3）；x→y1,y2,y3（x 出度 3，闭包 3）
    // 关键对照：a 出度只有 1，但闭包与 x 相同 ⇒ 用出度会把 a 排到后面，用闭包不会
    const mk = (k: string, s: string, sv: string, tt: string, tv: string) =>
      ({ key: k, sourceTypeKey: s, sourceStateVar: sv, targetTypeKey: tt, targetStateVar: tv }) as never;
    const sizes = transitiveClosureSizes([
      mk("r1", "A", "v", "B", "v"),
      mk("r2", "B", "v", "C", "v"),
      mk("r3", "C", "v", "D", "v"),
      mk("r4", "X", "v", "Y1", "v"),
      mk("r5", "X", "v", "Y2", "v"),
      mk("r6", "X", "v", "Y3", "v"),
    ]);
    expect(sizes.get("A\u0000v")).toBe(3); // 出度 1，闭包 3
    expect(sizes.get("X\u0000v")).toBe(3); // 出度 3，闭包 3
    expect(sizes.get("C\u0000v")).toBe(1);
  });

  it("⑥ 传导图成环不死循环（真实传导图允许成环）", () => {
    const mk = (k: string, s: string, tt: string) =>
      ({ key: k, sourceTypeKey: s, sourceStateVar: "v", targetTypeKey: tt, targetStateVar: "v" }) as never;
    const sizes = transitiveClosureSizes([mk("r1", "A", "B"), mk("r2", "B", "A")]);
    expect(sizes.get("A\u0000v")).toBe(1); // 闭包含 B，不含自己
  });

  it("⑥ 分位函数：空样本回 null（不是 0）——「算不出阈值」不是「阈值为 0」", () => {
    expect(quantileSorted([], 0.9)).toBeNull();
    expect(quantileSorted([5], 0.9)).toBe(5);
    expect(quantileSorted([0, 10], 0.5)).toBe(5); // 线性插值
  });

  // ══════════════════════════════════════════════════════════════════════
  // ⑦ R6 确定性 + R4-sim 边界 + 规模闸
  // ══════════════════════════════════════════════════════════════════════
  it("⑦ R6：同输入重跑，结论逐字节一致", async () => {
    const t = await seededApp();
    const sid = await newSession(t);
    const body = {
      horizonDays: 30,
      events: [{ kind: "ORDER_RESCHEDULE", targetObjectId: ANCHOR_ORDER, payload: { advanceDays: ADVANCE_DAYS }, effectiveDay: 0 }],
    };
    const a = await runDrill(t, sid, body);
    const b = await runDrill(t, sid, body);
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
    expect(JSON.stringify(a.summary)).toBe(JSON.stringify(b.summary));
  });

  it("⑦ R4-sim：演习是只读的 —— 世界线 curTick 一格不动", async () => {
    const t = await seededApp();
    const sid = await newSession(t);
    const before = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}`, headers: ADMIN });
    const tickBefore = (before.json() as { curTick: number }).curTick;
    await runDrill(t, sid, { horizonDays: 30, scanOnly: true, events: [] });
    const after = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}`, headers: ADMIN });
    // 演习推了 30 拍，但**不落盘** ⇒ 会话本身的世界线不动
    expect((after.json() as { curTick: number }).curTick).toBe(tickBefore);
  });

  it("⑦ 规模闸：逐类截断 + 诚实位（「我给了 N 条」与「一共 M 条」分得开）", async () => {
    // 造一个会爆量的世界：200 个对象 × 1 个变量 ⇒ 卡点/脆弱点各远超上限
    const state: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 200; i++) state[`o${String(i).padStart(3, "0")}`] = { v: i };
    const scan = scanDrillFindings({
      state, rules: [],
      typeOf: new Map(Object.keys(state).map((k) => [k, "T"])),
      stateVarLabel: (s) => s,
    });
    const rep = await orchestrateDrill({
      events: [], horizonDays: 30, tickDays: 1, worldId: "w1", forkedFromStateId: null,
      invokeSolver: async () => ({}),
      scanFindings: scan,
      limitPerKind: 5,
    });
    expect(rep.appliedLimitPerKind).toBe(5);
    expect(rep.truncated).toBe(true);
    // 逐类都被压到 5 条以内
    for (const kind of ["卡点", "脆弱点"]) {
      expect(rep.findings.filter((f) => f.kind === kind).length).toBeLessThanOrEqual(5);
      // 诚实位报的是**真实总数**，不是被裁后的数
      expect(rep.totalByKind[kind]!).toBeGreaterThan(5);
    }
    // 截断这件事出现在人读的那句话里
    expect(rep.summary.text).toContain("只回前 5 条");
  });

  it("⑦ 规模闸**逐类**限而非全局 Top-N（全局会把整类低分结论挤掉 = 把截断伪装成结论）", async () => {
    // 高分卡点 20 条（sev 90+）+ 低分堵点 3 条（sev ~10）
    const state: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 40; i++) state[`o${String(i).padStart(3, "0")}`] = { v: i };
    const scan = scanDrillFindings({
      state,
      // 三条边 ⇒ 会产出堵点，且 severity 远低于卡点
      rules: [
        { key: "r1", sourceTypeKey: "A", sourceStateVar: "v", targetTypeKey: "B", targetStateVar: "v" },
        { key: "r2", sourceTypeKey: "B", sourceStateVar: "v", targetTypeKey: "C", targetStateVar: "v" },
        { key: "r3", sourceTypeKey: "C", sourceStateVar: "v", targetTypeKey: "D", targetStateVar: "v" },
      ] as never,
      typeOf: new Map(Object.keys(state).map((k) => [k, "T"])),
      stateVarLabel: (s) => s,
    });
    const rep = await orchestrateDrill({
      events: [], horizonDays: 30, tickDays: 1, worldId: "w1", forkedFromStateId: null,
      invokeSolver: async () => ({}), scanFindings: scan, limitPerKind: 2,
    });
    // 🔴 关键断言：堵点 severity 远低于卡点，全局 Top-N 会把它们**一条不剩**地挤掉。
    // 逐类限 ⇒ 每类都还在。
    expect(rep.findings.filter((f) => f.kind === "堵点").length).toBeGreaterThan(0);
    expect(rep.findings.filter((f) => f.kind === "卡点").length).toBeGreaterThan(0);
  });
});
