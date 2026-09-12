import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SimWorldReadDisclosure } from "@platform/contracts";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

/**
 * ══ WO-WORLDSTATE-SURFACE · 接缝门：世界态成为白名单求解器的**统一入参** ═══════════
 *
 * ── 这道门跨的是哪三半（SEAM-GATE：不是各半 unit 各绿就算）────────────────────────
 *  ① **数据半**：`seed.ts` 的需求传导链（`Order.demandPressure →×0.8→ Model.demandLoad
 *     →×0.6→ Base.loadIndex →×0.5（delay1）→ Line.utilPressure`）真把扰动推到世界态里；
 *  ② **机制半**：`world-surface.ts` 的三道闸（白名单 / args.worldId 开关 / 不静默回落）
 *     + `world-read.ts` 的叠加核（DIRECT + PROJECTED，与装配器路径**同一个核**）；
 *  ③ **求解器半**：`risk_timeline` / `capacity_forecast` / `affected_orders` 三个白名单
 *     求解器的回包真的随世界态变，且 `worldState` 披露键随包下发。
 *
 * ── 头号判据（工单 · 对照实验，铁律 1.5 判据一）───────────────────────────────────
 * 同 (args, scope)，**扰动前**调一次、**扰动+tick 后**调一次：
 *   · 修前（基线提交 c69d345d4）：两个哈希**必须相等** —— 那就是病
 *     （`compute()` 同步够不着 async 世界态 ⇒ 回包与扰动无关）；
 *   · 修后（本分支）：两个哈希**必须不同**，且 `worldState.cellsApplied > 0` 说清改了几格。
 * 本测试在两侧都真跑：`console.log("[contrast] …")` 打出的四个数就是报告要的那四个数。
 *
 * ── 反向判据（同样必须写）───────────────────────────────────────────────────────
 *  ① 不传 `worldId` ⇒ 回包**没有** `worldState` 键、两跑逐字节相同（R6 最重要的兼容判据）；
 *  ② 传了 `worldId` 但世界零压力/空世界 ⇒ 剥掉 `worldState` 披露键后与真值口径**逐字节相同**
 *    （叠加核只缩格不重排 —— 行序不同造成的差异不算"世界态生效"）。
 *
 * ── ⚠ 本文件必须在**基线提交**上也能跑（对照实验的"修前"那一半）─────────────────
 * 故不顶层 import `world-surface.ts`（基线上不存在）——白名单表用动态 import 取，
 * 且哈希的 `console.log` 排在所有 `expect` 之前：基线上断言会红（那就是病），日志照样落盘。
 */

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function createWorld(t: TestApp, baseSnapshot: Record<string, Record<string, number>>): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } });
  expect(res.statusCode, `建会话失败：${res.body}`).toBe(201);
  return (res.json() as { id: string }).id;
}

const tick = (t: TestApp, sid: string, n: number) =>
  t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n } });

type SolverData = Record<string, unknown> & { worldState?: SimWorldReadDisclosure };
const dataOf = (res: { json: () => unknown }): SolverData => (res.json() as { data: SolverData }).data;
const hashOf = (x: unknown): string => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
/** 剥掉披露键（加性键）后比真值口径 —— 披露本就只该在"读了世界"时多出来。 */
const stripWs = (d: SolverData): Record<string, unknown> => {
  const { worldState: _ws, ...rest } = d;
  return rest;
};

interface Candidate {
  orderId: string;
  so: string;
  modelId: string;
  qty: number;
}

/**
 * 挑一张**三个求解器都会真读到**的订单（金丝雀，不是编的 id）：
 *  ① `status:"OPEN"` 且 `qty` 为有限数 ⇒ 进 `capacity_forecast` 的需求基线（Σ OPEN qty）；
 *  ② `due` 落在 [0,180] 天窗口（forecastStart=2026-06-10，OPEN 单 offset 恒 10–180 ⇒ 恒真，
 *     但仍实测不断言种子）；`props.bases` 非空 ⇒ 进 `affected_orders` 的订单池；
 *  ③ 经 `order_for_model` 真链路挂到型号 ⇒ 需求传导链第一跳有边可走；
 *  ④ 该型号 `capacity_forecast` 真跑 200（有认证产线）⇒ 供给端也通。
 */
async function pickDemandOrder(t: TestApp): Promise<Candidate> {
  const orders = await t.repos.objects.listByType("demo", "Order");
  expect(orders.length, "Order 种子为空 ⇒ 取数坏了，不是『没订单可挑』").toBeGreaterThan(100);
  const links = await t.repos.links.list("demo");
  const ofm = new Set(links.filter((l) => l.type === "order_for_model").map((l) => l.fromId));
  const t0 = Date.parse("2026-06-10T00:00:00Z");
  const candidates = orders
    .filter((o) => String(o.props.status ?? "OPEN") === "OPEN")
    .filter((o) => typeof o.props.qty === "number" && Number.isFinite(o.props.qty) && (o.props.qty as number) > 0)
    .filter((o) => Array.isArray(o.props.bases) && (o.props.bases as string[]).length > 0)
    .filter((o) => ofm.has(o.id))
    .filter((o) => {
      const due = Date.parse(`${String(o.props.due)}T00:00:00Z`);
      const day = Math.round((due - t0) / 86400000);
      return Number.isFinite(day) && day >= 0 && day <= 180;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  expect(candidates.length, "没有同时过 ①②③ 的 OPEN 订单 ⇒ 用例前提不成立").toBeGreaterThan(0);
  for (const o of candidates) {
    const modelId = String(o.props.model);
    const probe = await invokeSolver(t, "capacity_forecast", { modelId, weeks: 52 });
    if (probe.statusCode === 200) {
      return { orderId: o.id, so: String(o.props.so), modelId, qty: o.props.qty as number };
    }
  }
  throw new Error("没有任何候选订单的型号能跑通 capacity_forecast（④ 不过）⇒ 用例前提不成立");
}

/** 三个接线求解器各自的调用 args（worldId 由用例自己补）。 */
const wiredArgs = (cand: Candidate): Record<string, Record<string, unknown>> => ({
  risk_timeline: {},
  capacity_forecast: { modelId: cand.modelId, weeks: 52 },
  affected_orders: {},
});
const WIRED_KEYS = ["risk_timeline", "capacity_forecast", "affected_orders"] as const;

/** 施加需求扰动并推 4 拍（3 跳 + 末跳 delayTicks:1），返回会话内真世界态（数据半金丝雀）。 */
async function perturbDemand(t: TestApp, sid: string, cand: Candidate) {
  const created = await t.app.inject({
    method: "POST",
    url: `/a/v1/sim/sessions/${sid}/perturbations`,
    headers: ADMIN,
    payload: {
      kind: "demand_shift",
      targetObjectId: cand.orderId,
      targetStateVar: "demandPressure",
      magnitude: 60,
      mode: "set",
      label: `追加需求 ${cand.so} +60pp`,
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  expect((await tick(t, sid, 4)).statusCode).toBe(200);
  const row = await t.repos.sim.getTickState("demo", sid, 4);
  expect(row, "tick4 态行缺失 ⇒ 传导链根本没跑").not.toBeNull();
  const state = row!.state;
  // 数据半自证（缺一 ⇒ 后面的『求解器没变』读不出是机制坏了还是链没通）：
  // ⚠ 不许断言 `=== 60`：`demo_forecast_bias_to_order_demand` 把 demandPressure 变成
  //    **规则写入量** ⇒ 取值域声明的衰减每拍合法地漏（实测 60 →4 拍→ 9.4518）。
  //    衰减到 9.45 与「没扰动」是两个命题 —— 判据是「还大于 0」，不是「等于施加点」。
  expect(state[cand.orderId]?.demandPressure, "扰动没落格（或 4 拍内已衰减归零 ⇒ 链白跑）").toBeGreaterThan(0);
  const vars = new Map<string, number>();
  for (const obj of Object.values(state)) for (const [v, val] of Object.entries(obj)) vars.set(v, (vars.get(v) ?? 0) + (val as number));
  expect(vars.get("demandLoad") ?? 0, "第①跳没到 Model.demandLoad ⇒ 传导链断在第①跳").toBeGreaterThan(0);
  expect(vars.get("loadIndex") ?? 0, "第②跳没到 Base.loadIndex ⇒ 断在第②跳").toBeGreaterThan(0);
  expect(vars.get("utilPressure") ?? 0, "第③跳没到 Line.utilPressure ⇒ 断在第③跳（delayTicks:1 ⇒ 需 tick≥4）").toBeGreaterThan(0);
  return state;
}

describe("WO-WORLDSTATE-SURFACE · 统一世界态读取面", () => {
  it("金丝雀：种子/传导规则/求解器注册/白名单表四样都在（任一不在 ⇒ 后面读不出坏了还是真没变）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    // ① 需求传导链三条规则**一条不缺**（集合等号，不是 for…toContain —— 缺一条与不缺给同色的写法不要）。
    const DEMAND_RULE_KEYS = [
      "demo_base_load_to_line_util",
      "demo_model_demand_to_base_load",
      "demo_order_demand_pressure",
    ];
    const rules = await t.repos.sim.listPropagationRules("demo", true);
    expect(rules.length).toBeGreaterThan(3);
    expect(rules.map((r) => r.key).filter((k) => DEMAND_RULE_KEYS.includes(k)).sort()).toEqual(DEMAND_RULE_KEYS);
    // ② 三样对象种子非空（叠加核的遍历集 —— 空集上跑叠加是空转，R6 断言不许咬空集）。
    expect((await t.repos.objects.listByType("demo", "Line")).length).toBeGreaterThan(10);
    expect((await t.repos.objects.listByType("demo", "Model")).length).toBeGreaterThan(2);
    // ③ 三个白名单求解器与对照组求解器都真注册（反向金丝雀：不存在的 key 必须非 200）。
    const cand = await pickDemandOrder(t);
    for (const key of [...WIRED_KEYS, "capacity_rollup"]) {
      const ok = await invokeSolver(t, key, wiredArgs(cand)[key] ?? {});
      expect(ok.statusCode, `${key} 未注册或跑不通：${ok.body}`).toBe(200);
    }
    const bogus = await invokeSolver(t, "risk_timeline_not_a_key", {});
    expect(bogus.statusCode).not.toBe(200);
    // ④ 白名单表**恰好**这三个（动态 import：本文件必须在基线提交上也能跑 —— 基线没有这个模块）。
    const { WORLD_AWARE_SOLVERS } = await import("../src/solvers/world-surface.js");
    expect(Object.keys(WORLD_AWARE_SOLVERS).sort()).toEqual([...WIRED_KEYS].sort());
    for (const [k, reason] of Object.entries(WORLD_AWARE_SOLVERS)) {
      expect(reason.length, `${k} 的 worldAware 理由为空 ⇒ 收录判据形同虚设`).toBeGreaterThan(10);
    }
  });

  it("🔴 头号判据 · 对照实验：三个接线求解器 —— 同 (args,scope) 扰动前 vs 扰动+tick4 后，回包必须**真的不同**", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const cand = await pickDemandOrder(t);
    // 世界里放上被扰动的那张单（零压力起点 —— 扰动前这格是 0）。
    const sid = await createWorld(t, { [cand.orderId]: { demandPressure: 0 } });

    // ── 扰动前（世界零压力）──────────────────────────────────────────────────────
    const before: Record<string, SolverData> = {};
    for (const key of WIRED_KEYS) {
      const res = await invokeSolver(t, key, { ...wiredArgs(cand)[key], worldId: sid });
      expect(res.statusCode, `${key} 扰动前调用失败：${res.body}`).toBe(200);
      before[key] = dataOf(res);
    }

    // ── 真扰动 → 真 tick×4（不直写 baseSnapshot —— 那样测不到写端接缝）─────────────
    await perturbDemand(t, sid, cand);

    // ── 扰动后：四个数**先全部落盘**（console.log），断言另起一轮 ─────────────────
    //    （基线上第一个求解器的 ≠ 断言就红 —— 若断言与调用混在一轮，
    //    后两个求解器的「修前相等」证据就永远打不出来。）
    const afterAll: Record<string, SolverData> = {};
    for (const key of WIRED_KEYS) {
      const res = await invokeSolver(t, key, { ...wiredArgs(cand)[key], worldId: sid });
      expect(res.statusCode, `${key} 扰动后调用失败：${res.body}`).toBe(200);
      afterAll[key] = dataOf(res);
      const hBefore = hashOf(before[key]);
      const hAfter = hashOf(afterAll[key]);
      console.log(`[contrast] solver=${key} before=${hBefore} after=${hAfter} equal=${hBefore === hAfter}`);
    }
    for (const key of WIRED_KEYS) {
      const hBefore = hashOf(before[key]);
      const hAfter = hashOf(afterAll[key]);
      // 🔴 头号判据：**必须不同**（修前这两个哈希逐字节相同 —— 那就是本单要治的病）。
      expect(hAfter, `${key} 扰动前后逐字节相同 ⇒ 世界态没进求解器（病未愈）`).not.toBe(hBefore);
      // 量法自证：披露块说得出**改了几格、改在哪**，不是空转（cellsApplied>0 且明细非空）。
      const ws = afterAll[key]!.worldState;
      expect(ws, `${key} 回包缺 worldState 披露键`).toBeDefined();
      expect(ws!.cellsApplied, `${key} 一格都没改写却声称读了世界 ⇒ 量法没有鉴别力`).toBeGreaterThan(0);
      expect(ws!.applied.length).toBeGreaterThan(0); // R6 断言不许咬空集：明细真的遍历过
      expect(ws!.objectTypesRead.length).toBeGreaterThan(0);
      expect(ws!.source).toBe("TICK");
      expect(ws!.tick).toBe(4);
    }
  });

  it("R6 兼容：不传 worldId ⇒ 无 worldState 键且两跑逐字节相同；零压力世界 ⇒ 剥披露键后与真值口径逐字节相同", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const cand = await pickDemandOrder(t);
    const sid = await createWorld(t, { [cand.orderId]: { demandPressure: 0 } }); // 零压力世界

    // 跨提交 R6 对的锚点：**三个求解器的真值哈希先全部落盘再断言**
    // （基线上第一轮的「零压力世界有 worldState」断言就红 —— 混在一轮会吞掉后两个真值哈希）。
    const truth: Record<string, SolverData> = {};
    for (const key of WIRED_KEYS) {
      truth[key] = dataOf(await invokeSolver(t, key, wiredArgs(cand)[key]!));
      console.log(`[r6-truth] solver=${key} truth=${hashOf(truth[key])}`);
    }
    for (const key of WIRED_KEYS) {
      const args = wiredArgs(cand)[key]!;
      const a = truth[key]!;
      const b = dataOf(await invokeSolver(t, key, args));
      // ① 不传 worldId：没有 worldState 键（加性键不许悄悄出现），两跑逐字节相同。
      expect(a.worldState, `${key} 没传 worldId 却带 worldState ⇒ 闸②漏了`).toBeUndefined();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      // ② 零压力世界 + worldId：剥掉披露键后与真值口径**逐字节相同**
      //    （叠加核只缩格不重排 —— 若这条红，说明差异来自行序/引用而不是世界态）。
      const w = await invokeSolver(t, key, { ...args, worldId: sid });
      expect(w.statusCode, `${key} 零压力世界调用失败：${w.body}`).toBe(200);
      const wData = dataOf(w);
      expect(wData.worldState, `${key} 传了 worldId 却没有披露键 ⇒ 闸③的诚实位丢了`).toBeDefined();
      expect(wData.worldState!.cellsApplied).toBe(0); // 压力为 0 ⇒ 因子 1 ⇒ 不算改写（不虚高）
      expect(JSON.stringify(stripWs(wData)), `${key} 零压力世界 ≠ 真值口径 ⇒ 叠加核干了缩格以外的事`).toBe(JSON.stringify(a));
    }
  });

  it("闸① 白名单外：capacity_rollup 传 worldId（含幽灵 id）⇒ 机制够不着它（无 worldState 键·与真值口径逐字节相同）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const cand = await pickDemandOrder(t);
    const sid = await createWorld(t, { [cand.orderId]: { demandPressure: 0 } });
    await perturbDemand(t, sid, cand); // 世界里有真扰动 —— 白名单外照样不许看见它

    const truth = dataOf(await invokeSolver(t, "capacity_rollup", {}));
    expect(truth.worldState).toBeUndefined();
    const withWorld = await invokeSolver(t, "capacity_rollup", { worldId: sid });
    expect(withWorld.statusCode, withWorld.body).toBe(200);
    expect(dataOf(withWorld).worldState, "白名单外求解器带 worldState ⇒ 闸①漏了").toBeUndefined();
    expect(JSON.stringify(dataOf(withWorld))).toBe(JSON.stringify(truth));
    // 更强的断言：**幽灵 worldId 也 200** —— 注入器根本没跑（跑了会 404）。
    // 这证明机制对白名单外是"够不着"，不是"读了但没用"。
    const ghost = await invokeSolver(t, "capacity_rollup", { worldId: "sims_ghost_never_existed" });
    expect(ghost.statusCode, ghost.body).toBe(200);
    expect(JSON.stringify(dataOf(ghost))).toBe(JSON.stringify(truth));
  });

  it("闸③ 不静默回落：幽灵 worldId ⇒ 404；跨租户 worldId ⇒ 404；空串 worldId ⇒ 400（金丝雀：同 key 真世界 200）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enableSim(t);
    const sid = await createWorld(t, {});
    // 跨租户：经仓储在**别的租户**建会话，demo 身份去读 ⇒ 同一个 notFound（R2 暗发，不泄露存在性）。
    await t.repos.sim.createSession({
      id: "sims_rival_tenant",
      tenantId: "tenant_rival",
      baseSnapshot: {},
      scope: {},
      status: "READY",
      curTick: 0,
      parentCheckpointId: null,
      createdAt: "2026-09-12T00:00:00.000Z",
    });

    const ghost = await invokeSolver(t, "risk_timeline", { worldId: "sims_ghost_never_existed" });
    expect(ghost.statusCode, ghost.body).toBe(404);
    const rival = await invokeSolver(t, "risk_timeline", { worldId: "sims_rival_tenant" });
    expect(rival.statusCode, rival.body).toBe(404);
    const empty = await invokeSolver(t, "risk_timeline", { worldId: "" });
    expect(empty.statusCode, empty.body).toBe(400);
    // 金丝雀：同一个 key 在**真世界**上必须 200 —— 否则上面三条读不出是"闸门生效"还是"求解器坏了"。
    expect((await invokeSolver(t, "risk_timeline", { worldId: sid })).statusCode).toBe(200);
    // 且 400 的错误消息必须说清"不静默当没传"（静默 = 以为在看推演、屏上是真值）。
    expect(empty.body).toContain("worldId");
  });

  it("空世界诚实：worldObjects=0 + note 明说「未发生世界隔离」，数值仍给且等于真值口径", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enableSim(t);
    const sid = await createWorld(t, {}); // 空世界（tick0 态为空）

    const res = await invokeSolver(t, "risk_timeline", { worldId: sid });
    expect(res.statusCode, res.body).toBe(200);
    const d = dataOf(res);
    expect(d.worldState).toBeDefined();
    expect(d.worldState!.worldObjects).toBe(0);
    expect(d.worldState!.cellsApplied).toBe(0);
    expect(d.worldState!.note).toContain("未发生世界隔离");
    // 诚实位不是"藏起数字"：剥掉披露键后与真值口径逐字节相同。
    const truth = dataOf(await invokeSolver(t, "risk_timeline", {}));
    expect(JSON.stringify(stripWs(d))).toBe(JSON.stringify(truth));
  });

  it("披露块可复核：sessionId/tick/source/divisor/rules/applied/unconsumed/agentInvolved 齐全，demandLoad 诚实进 unconsumed", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const cand = await pickDemandOrder(t);
    const sid = await createWorld(t, { [cand.orderId]: { demandPressure: 0 } });
    await perturbDemand(t, sid, cand);

    const d = dataOf(await invokeSolver(t, "risk_timeline", { worldId: sid }));
    const ws = d.worldState!;
    expect(ws).toBeDefined();
    expect(ws.sessionId).toBe(sid);
    expect(ws.tick).toBe(4);
    expect(ws.source).toBe("TICK");
    expect(ws.pressureUnit).toBe("pp");
    expect(ws.divisor).toBe(100); // 与 finance_world_projection 同一座量纲桥
    expect(ws.agentInvolved).toBe(false); // 推演路零 LLM ⇒ 明写，不留白
    expect(ws.rules.length).toBeGreaterThan(0);
    expect(ws.worldObjects).toBeGreaterThan(0);
    // 需求投影真的落在 Order.qty 上（demand 词库落点，不是写死的属性名）：
    const qtyCell = ws.applied.find((a) => a.stateVar === "demandPressure" && a.property === "qty");
    expect(qtyCell, "applied 里找不到 demandPressure→qty 的 PROJECTED 格 ⇒ 需求投影没落点").toBeDefined();
    expect(qtyCell!.kind).toBe("PROJECTED");
    expect(qtyCell!.objectId).toBe(cand.orderId);
    expect(qtyCell!.after).toBeGreaterThan(qtyCell!.before); // 需求压力 60pp ⇒ qty ×1.6
    // 产能投影真的落在 Line.capacityDaily 上（capacity 词库落点）：
    const capCell = ws.applied.find((a) => a.stateVar === "utilPressure" && a.property === "capacityDaily");
    expect(capCell, "applied 里找不到 utilPressure→capacityDaily 的 PROJECTED 格 ⇒ 产能投影没落点").toBeDefined();
    expect(capCell!.after).toBeLessThan(capCell!.before); // 利用率压力 ⇒ 可用产能↓
    // 诚实缺席：demandLoad 在世界态里但没有投影规则 ⇒ 必须进 unconsumed（不许留白让人以为没压力）。
    const unc = ws.unconsumed.map((u) => u.stateVar);
    expect(unc).toContain("demandLoad");
  });

  it("世界内 R6：同 (worldId, tick) 两跑逐字节相同（含 worldState 披露键）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const cand = await pickDemandOrder(t);
    const sid = await createWorld(t, { [cand.orderId]: { demandPressure: 0 } });
    await perturbDemand(t, sid, cand);

    const a = dataOf(await invokeSolver(t, "risk_timeline", { worldId: sid }));
    const b = dataOf(await invokeSolver(t, "risk_timeline", { worldId: sid }));
    expect(a.worldState).toBeDefined();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
