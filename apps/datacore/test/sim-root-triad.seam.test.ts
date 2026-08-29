import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { deriveSeedBaseSnapshot } from "../src/sim/seed-world.js";
import type { TickState } from "@platform/contracts";

/**
 * WO-SIM-ROOT-TRIAD · 三个**根源**扰动因素的接缝门
 * （G-ROOT-1 销售预测偏差 · G-ROOT-2 订单插单/取消 · G-ROOT-4 设备故障）。
 *
 * ══ 驱动的接缝 = 「种子数据 × 传导引擎」两半，任一半漏即红 ═════════════════════════
 *
 *   数据半：`seed.ts` 的规则 → `deriveSeedBaseSnapshot` 铺格子 → 真链路表上的实例
 *   引擎半：`POST /a/v1/sim/sessions` → `propagateTick` 逐拍落盘 → 回包里的世界态
 *
 * 每个根源三臂，**三臂各咬一半以上，合起来才咬住整条链**：
 *   ① **入度臂**：新量纲在**现算**的传导图上入度 = 0（它是根源，只能被外部打进来）。
 *      入度用**路由下发的真规则表**现算，不许硬编码键名清单 —— 硬编码会随下一条边失效。
 *      外加一条 **降级臂**：`demandPressure` 的入度必须**从 0 变成 ≥1**（G-ROOT-1 的模型修正）。
 *   ② **落点臂**：落点在 `world.state` 里**真带**这个量纲，且是**有分布的真值**（全距 > 0），
 *      不是 0 占位。⚠ 这是最容易假绿的一臂：只在对象属性上加变量、不进 `state`，
 *      用户在屏上"施加成功"而 `propagateTick` 读到 `undefined` ⇒ 下游一动不动
 *      （本仓注释里点名的「静默错答的老形态」）。
 *   ③ **传导臂**（标的）：同一个真世界跑两条线（基线 / 把根源那一格抬高 D），
 *      断言下游**值的方向与量级**，不是「没报错」。
 *      1 跳目标是**精确等式** `Δ = N × coefficient × D` —— 这条等式之所以成立，
 *      正因为它是根源：**没有任何规则写它** ⇒ 源值逐拍恒定 ⇒ 每拍贡献相同。
 *      量级对不上 = 引擎没照系数走；符号对不上 = 边的方向写反了。
 *
 * ══ 金丝雀（铁律 0.6：报否定结论之前先自证工具）═══════════════════════════════════
 *   · §0 恒等式：源码抽取器抽出的条数 === 路由下发的条数 === `grep -c "sourceStateVar:"`。
 *     不等 ⇒ 报「**工具坏了**」，不许报任何图结论。本单的对账文档正是被这一条救过一次
 *     （第一版正则 300 字窗口只抽出 28/35，据此得出「loadPressure 不在传导图里」的错误结论）。
 *   · §1 入度计数器拿一个**已知非零**的量纲自证（`demandLoad`），它若也报 0 ⇒ 计数器坏了，
 *     而不是「新量纲是根源」。报「入度为 0」时把这条证据一并打印。
 *   · §3 拿一个**已知走得通**的老根源（`deliveryDelay`）跑同一套机器；它若也不动 ⇒
 *     报「传导引擎不工作」，不许报「新根源接错了」。
 */

// ── 本单的三个根源（唯一出处：下面每一处都从这里取，不各写一遍）────────────────────
const TRIAD = [
  { gate: "G-ROOT-1", stateVar: "forecastBias", ruleKey: "demo_forecast_bias_to_order_demand", zh: "销售预测偏差（正=高估）" },
  { gate: "G-ROOT-2", stateVar: "orderChurn", ruleKey: "demo_order_churn_to_line_split", zh: "订单变更压力" },
  { gate: "G-ROOT-4", stateVar: "equipmentFailure", ruleKey: "demo_equipment_failure_to_process_queue", zh: "设备故障率" },
] as const;

/** 已知走得通的**老**根源 —— §3 的金丝雀（它若也不动，是引擎坏了，不是新边接错了）。 */
const CANARY_ROOT = { stateVar: "deliveryDelay", ruleKey: "demo_supplier_delay_to_material_shortage" } as const;

/** 已知入度非零的量纲 —— §1 的金丝雀（它若也报 0，是计数器坏了，不是「新量纲是根源」）。 */
const CANARY_NONROOT = "demandLoad";

const SEED_PATH = fileURLToPath(new URL("../src/seed.ts", import.meta.url));

interface LiveRule {
  key: string;
  sourceTypeKey: string;
  sourceStateVar: string;
  viaLinkKey: string;
  targetTypeKey: string;
  targetStateVar: string;
  coefficient: number;
  delayTicks: number;
}

/**
 * 从**种子源码**抽 `(sourceStateVar, targetStateVar)` 对 —— 给运行态当**独立第二证人**。
 *
 * ⚠ 抽取器是会骗人的（本仓已实测两次）：按「五行连续」写的整体正则会被行尾注释打断，
 * 按固定字符窗口写的正则会截断长条目。这里按**对象字面量切段、段内不限窗口**，
 * 并把条数恒等式交给调用方当金丝雀 —— 「抽到了一条」不度量「抽全了」。
 */
function extractSeedEdges(src: string): { edges: { from: string; to: string }[]; declaredRows: number } {
  const start = src.indexOf("const DEMO_PROPAGATION_RULES");
  const end = src.indexOf("export async function seedDemoPropagationRules");
  if (start < 0 || end < 0 || end <= start) throw new Error("工具坏了：seed.ts 里找不到 DEMO_PROPAGATION_RULES 的锚点");
  const block = src.slice(start, end);
  const edges: { from: string; to: string }[] = [];
  for (const chunk of block.split(/^\s*\{\s*$/m)) {
    const s = /^\s*sourceStateVar: "([A-Za-z0-9_]+)"/m.exec(chunk);
    const t = /^\s*targetStateVar: "([A-Za-z0-9_]+)"/m.exec(chunk);
    if (s && t) edges.push({ from: s[1]!, to: t[1]! });
  }
  // 独立口径（等价于 `grep -c 'sourceStateVar:'`）：与上面的切段法**完全不同的数法**。
  return { edges, declaredRows: (block.match(/^\s*sourceStateVar: "/gm) ?? []).length };
}

/** 入度 = 有多少条规则**写**这个量纲（现算，零硬编码名单）。 */
const inDegreeOf = (rules: readonly LiveRule[], stateVar: string): number =>
  rules.filter((r) => r.targetStateVar === stateVar).length;

/** 出度 = 有多少条规则**读**这个量纲。 */
const outDegreeOf = (rules: readonly LiveRule[], stateVar: string): number =>
  rules.filter((r) => r.sourceStateVar === stateVar).length;

const enableSim = (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

async function bootstrap(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t); // 数据半：物化本体对象 + 真链路
  await seedDemoPropagationRules(t.repos); // 数据半：PUBLISHED 传导规则
  await enableSim(t);
  return t;
}

async function liveRules(t: TestApp): Promise<LiveRule[]> {
  const r = await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN });
  expect(r.statusCode).toBe(200);
  return (r.json() as { items: LiveRule[] }).items;
}

/** 某类型在本租户的对象 id（升序，与引擎的遍历序同）。 */
async function idsOfType(t: TestApp, typeKey: string): Promise<string[]> {
  const rows = await t.repos.objects.listByType("demo", typeKey);
  return rows.filter((o) => !o.mergedInto).map((o) => o.id).sort((a, b) => a.localeCompare(b));
}

/** 建会话 + 推 n 拍，回**回包里**的世界态（走真路由，不碰内部函数）。 */
async function runWorld(t: TestApp, baseSnapshot: TickState, n: number): Promise<TickState> {
  const created = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } });
  expect(created.statusCode, `建会话失败：${created.body}`).toBe(201);
  const sid = (created.json() as { id: string }).id;
  const ticked = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n } });
  expect(ticked.statusCode, `推拍失败：${ticked.body}`).toBe(200);
  return (ticked.json() as { state: TickState }).state;
}

/** 一批对象在某量纲上的读数之和（缺格记 0）。 */
const sumOf = (state: TickState, ids: readonly string[], stateVar: string): number =>
  ids.reduce((acc, id) => acc + (state[id]?.[stateVar] ?? 0), 0);

/** 深拷贝一份世界态（两条线必须从**逐字节相同**的起点出发，否则差值不度量扰动）。 */
const cloneState = (s: TickState): TickState => JSON.parse(JSON.stringify(s)) as TickState;

/** 推拍数：最深的一条新链 orderChurn→demandLoad→loadIndex→(delay1)utilPressure→releasePressure 要 5 拍，8 拍留余量。 */
const TICKS = 8;
/** 抬高幅度：取一个与派生读数（0–100）同量级、且乘上任何系数都不会整成 0 的数。 */
const BUMP = 10;

describe("WO-SIM-ROOT-TRIAD · 三个根源扰动因素（SEAM：种子数据 × 传导引擎）", () => {
  // ══════════════════════════════════════════════════════════════════════════
  // §0 金丝雀先说话 —— 报任何「入度为 0 / 这个量纲不在图里」之前，先自证工具
  // ══════════════════════════════════════════════════════════════════════════
  it("§0 🐤 恒等式金丝雀：源码抽取器 === grep 口径 === 路由下发条数（三者不等即『工具坏了』）", async () => {
    const { edges, declaredRows } = extractSeedEdges(readFileSync(SEED_PATH, "utf8"));
    expect(
      edges.length,
      `工具坏了：切段法抽出 ${edges.length} 条，而 grep 口径 ${declaredRows} 条 —— 不许据此报任何传导图结论`,
    ).toBe(declaredRows);
    expect(edges.length, "抽出 0 条 ⇒ 锚点或正则坏了，不是『种子里没有规则』").toBeGreaterThan(10);

    const t = await bootstrap();
    const live = await liveRules(t);
    expect(live.length, `源码 ${edges.length} 条 vs 路由 ${live.length} 条 —— 不等说明播种漏了或路由过滤了`).toBe(edges.length);

    // 三个新量纲必须在**源码抽取器**这个独立证人里也看得见（不是只有路由说有）。
    for (const { stateVar } of TRIAD) {
      expect(
        edges.some((e) => e.from === stateVar || e.to === stateVar),
        `${stateVar} 在种子源码里一条边都没有`,
      ).toBe(true);
    }
  }, 120000);

  // ══════════════════════════════════════════════════════════════════════════
  // §1 入度臂 —— 它们是**根源**（入度 0），且 demandPressure 被**降级**
  // ══════════════════════════════════════════════════════════════════════════
  it("§1 🔴 入度臂：三个新量纲入度 = 0（现算·非硬编码名单），且 demandPressure 由 0 → ≥1（降级）", async () => {
    const t = await bootstrap();
    const rules = await liveRules(t);

    // 🐤 金丝雀：入度计数器拿一个**已知非零**的量纲自证。它若也报 0，是计数器坏了。
    const canaryIn = inDegreeOf(rules, CANARY_NONROOT);
    expect(canaryIn, `工具坏了：${CANARY_NONROOT} 的入度算出 0，而它明明被多条规则写 ⇒ 计数器不度量入度`).toBeGreaterThan(0);

    // ── 三个根源：入度必须为 0（否定结论 ⇒ 同时给出金丝雀命中证据）──────────────
    for (const { gate, stateVar } of TRIAD) {
      const writers = rules.filter((r) => r.targetStateVar === stateVar).map((r) => r.key);
      expect(
        writers,
        `${gate} · ${stateVar} 不再是根源：被 ${writers.join("、")} 写。` +
          `（金丝雀：${CANARY_NONROOT} 入度 ${canaryIn} > 0 ⇒ 计数器是好的，这不是工具问题）`,
      ).toEqual([]);
      // 根源必须**有下游**，否则它是个扰了也没人看的孤儿格
      expect(outDegreeOf(rules, stateVar), `${gate} · ${stateVar} 出度为 0 ⇒ 扰它什么都不会发生`).toBeGreaterThan(0);
    }

    // ── 🔴 降级臂：demandPressure 从根源变成一级衍生（本单有意的模型修正）────────
    const demandWriters = rules.filter((r) => r.targetStateVar === "demandPressure").map((r) => r.key);
    expect(
      demandWriters,
      "demandPressure 仍然入度 0 ⇒ G-ROOT-1 的模型修正没落地（预测偏差没接上需求压力）",
    ).toContain("demo_forecast_bias_to_order_demand");
    expect(inDegreeOf(rules, "demandPressure")).toBeGreaterThanOrEqual(1);

    // ── 根源集合（现算）：必须**包含**新三个 + 两个老根源，且**不含** demandPressure ──
    // 用「包含」而不是「等于」：别的单也在往图里加根源边，写死全集会把它们全变成假红。
    const vars = new Set(rules.flatMap((r) => [r.sourceStateVar, r.targetStateVar]));
    const roots = [...vars].filter((v) => inDegreeOf(rules, v) === 0).sort();
    for (const v of [...TRIAD.map((x) => x.stateVar), "deliveryDelay", "priceShock"]) {
      expect(roots, `${v} 应当是根源（现算根源集：${roots.join("、")}）`).toContain(v);
    }
    expect(roots, "demandPressure 已降级为一级衍生，不该再出现在根源里").not.toContain("demandPressure");
  }, 120000);

  it("§1b 🔴 中文名：三个根源在**真接口**里都拿得到人话名（下拉里没名字 = 用户挑不出来）", async () => {
    const t = await bootstrap();
    const r = await t.app.inject({ method: "GET", url: "/a/v1/sim/view-config", headers: ADMIN });
    expect(r.statusCode).toBe(200);
    const cfg = r.json() as { stateVars: string[]; stateVarNames?: Record<string, string> };
    // 🐤 金丝雀：先证明这份字典真的非空，否则下面逐条比对恒绿
    expect(cfg.stateVarNames?.loadIndex, "工具坏了：连老量纲的名字都取不到").toBe("负载指数");
    for (const { gate, stateVar, zh } of TRIAD) {
      expect(cfg.stateVars, `${gate} · ${stateVar} 没进 view-config 的量纲清单`).toContain(stateVar);
      expect(cfg.stateVarNames?.[stateVar], `${gate} · ${stateVar} 没有中文名`).toBe(zh);
    }
  }, 120000);

  // ══════════════════════════════════════════════════════════════════════════
  // §2 落点臂 —— 真进了 `world.state`，且是**有分布的真值**不是 0 占位
  // ══════════════════════════════════════════════════════════════════════════
  it("§2 🔴 落点臂：三个根源在真种子世界态里**真带上**，且全距 > 0（不是 0 占位）", async () => {
    const t = await bootstrap();
    const rules = await liveRules(t);
    const { state } = await deriveSeedBaseSnapshot(t.repos, "demo"); // 生产同一支派生

    // 🐤 金丝雀：这个世界态真的非空（空世界会让下面每一条"某量纲缺席"都读作代码问题）
    const cells = Object.values(state).reduce((n, row) => n + Object.keys(row).length, 0);
    expect(cells, "工具坏了：派生出来的世界态是空的").toBeGreaterThan(100);

    for (const { gate, stateVar, ruleKey } of TRIAD) {
      const rule = rules.find((r) => r.key === ruleKey);
      expect(rule, `${gate} · 规则 ${ruleKey} 没播进来`).toBeDefined();
      const landingType = rule!.sourceTypeKey;
      const ids = await idsOfType(t, landingType);
      expect(ids.length, `${gate} · 落点类型 ${landingType} 在 demo 里零对象 ⇒ 这个根源扰不动`).toBeGreaterThan(0);

      // ── 真带上：**每一个**落点对象都要有这一格（不是"某几个有"）──────────────
      const missing = ids.filter((id) => typeof state[id]?.[stateVar] !== "number");
      expect(
        missing.length,
        `${gate} · ${landingType}.${stateVar} 有 ${missing.length}/${ids.length} 个落点没进 world.state ⇒ ` +
          `用户扰它时 propagateTick 读到 undefined，屏上"施加成功"而下游一动不动（静默错答的老形态）`,
      ).toBe(0);

      // ── 值非空：全距 > 0。全距为 0 的量纲连种子扰动都会把它判出局
      //    （`pickSeedPerturbation`：「全距为 0 的变量直接出局：delta 0 = 什么都没发生」）。
      const values = ids.map((id) => state[id]![stateVar]!);
      expect(values.every((v) => Number.isFinite(v)), `${gate} · ${stateVar} 有非有限值`).toBe(true);
      expect(
        Math.max(...values) - Math.min(...values),
        `${gate} · ${landingType}.${stateVar} 全世界同一个数（全距 0）⇒ 这是 0/常数占位，不是可扰的读数`,
      ).toBeGreaterThan(0);
    }
  }, 180000);

  // ══════════════════════════════════════════════════════════════════════════
  // §3 传导臂（标的）—— 扰它，下游**真的动**，且方向与量级都对
  // ══════════════════════════════════════════════════════════════════════════
  it("§3 🔴 传导臂：每个根源抬高 D ⇒ 1 跳目标 Δ === N×系数×D（精确），远端下游按预期方向动", async () => {
    const t = await bootstrap();
    const rules = await liveRules(t);
    const seed = (await deriveSeedBaseSnapshot(t.repos, "demo")).state;
    const links = await t.repos.links.list("demo");

    /** 沿某条 linkKey 从 fromId 出发、类型为 targetType 的下游对象（与引擎的 `targetsOf` 同判据）。 */
    const typeOf = new Map<string, string>();
    for (const ot of await t.repos.ontologyTypes.list("demo")) {
      for (const o of await t.repos.objects.listByType("demo", ot.key)) typeOf.set(o.id, o.type);
    }
    const targetsOf = (linkKey: string, fromId: string, targetType: string): string[] =>
      links.filter((l) => l.type === linkKey && l.fromId === fromId && typeOf.get(l.toId) === targetType).map((l) => l.toId).sort();

    // 基线：整个世界一个字节不动，推 N 拍。三个根源共用它（省一半机器时间）。
    const baseline = await runWorld(t, cloneState(seed), TICKS);

    /** 把某一格抬高 D 再跑一遍，回「1 跳目标的实测 Δ」与「远端下游的实测 Δ」。 */
    const probe = async (rule: LiveRule, farType: string, farVar: string) => {
      const landingIds = await idsOfType(t, rule.sourceTypeKey);
      // 选落点：第一个**沿这条边真有下游**的对象（没有下游的落点扰了也不会动，测它等于测空气）
      const pick = landingIds
        .map((id) => ({ id, targets: targetsOf(rule.viaLinkKey, id, rule.targetTypeKey) }))
        .find((x) => x.targets.length > 0);
      expect(
        pick,
        `${rule.key}: ${rule.sourceTypeKey} --${rule.viaLinkKey}--> ${rule.targetTypeKey} 在真链路表上一个落点都走不通`,
      ).toBeDefined();

      const before = seed[pick!.id]?.[rule.sourceStateVar];
      // 这一句同时是落点臂在**传导现场**的复核：格子不在，下面的 Δ 就不度量任何东西。
      expect(typeof before, `${rule.key}: 落点 ${pick!.id}.${rule.sourceStateVar} 不在 world.state 里`).toBe("number");

      const bumped = cloneState(seed);
      bumped[pick!.id]![rule.sourceStateVar] = before! + BUMP;
      const after = await runWorld(t, bumped, TICKS);

      const farIds = await idsOfType(t, farType);
      return {
        oneHopDelta: sumOf(after, pick!.targets, rule.targetStateVar) - sumOf(baseline, pick!.targets, rule.targetStateVar),
        oneHopTargets: pick!.targets.length,
        farDelta: sumOf(after, farIds, farVar) - sumOf(baseline, farIds, farVar),
        pickId: pick!.id,
      };
    };

    // ── 🐤 金丝雀：先拿**已知走得通**的老根源跑同一套机器 ────────────────────────
    // 它若也不动 ⇒ 报「传导引擎/取数坏了」，**不许**报「新根源接错了」。
    const canaryRule = rules.find((r) => r.key === CANARY_ROOT.ruleKey)!;
    const canary = await probe(canaryRule, "Model", "supplyRisk");
    expect(
      canary.oneHopDelta,
      `工具坏了：老根源 ${CANARY_ROOT.stateVar} 抬高 ${BUMP} 之后 1 跳目标一动不动 ⇒ 这是引擎/取数问题，不是新边的问题`,
    ).not.toBe(0);
    expect(canary.oneHopDelta).toBeCloseTo(TICKS * canaryRule.coefficient * BUMP * canary.oneHopTargets, 4);

    // ── G-ROOT-1 · 预测偏差 → 订单需求压力（**负向**：高估 ⇒ 需求压力下修）───────
    const r1 = rules.find((r) => r.key === "demo_forecast_bias_to_order_demand")!;
    expect(r1.coefficient, "G-ROOT-1 的系数必须为负：高估(+) ⇒ 需求压力下修。正系数会把方向读反").toBeLessThan(0);
    const p1 = await probe(r1, "Model", "demandLoad");
    expect(
      p1.oneHopDelta,
      `G-ROOT-1 传导臂：Model.forecastBias +${BUMP} 之后 Order.demandPressure 一动不动（落点 ${p1.pickId}）`,
    ).toBeCloseTo(TICKS * r1.coefficient * BUMP * p1.oneHopTargets, 4);
    expect(p1.oneHopDelta, "方向错了：高估预测应当把需求压力**压低**").toBeLessThan(0);
    expect(p1.farDelta, "G-ROOT-1 远端：需求压力下修应当把型号需求负载一起带下去").toBeLessThan(0);

    // ── G-ROOT-2 · 订单变更 → 订单行拆分压力；远端真的走到工单下达压力 ───────────
    const r2 = rules.find((r) => r.key === "demo_order_churn_to_line_split")!;
    expect(r2.coefficient).toBeGreaterThan(0);
    const p2 = await probe(r2, "WorkOrder", "releasePressure");
    expect(
      p2.oneHopDelta,
      `G-ROOT-2 传导臂：Order.orderChurn +${BUMP} 之后 OrderLine.splitPressure 一动不动（落点 ${p2.pickId}）`,
    ).toBeCloseTo(TICKS * r2.coefficient * BUMP * p2.oneHopTargets, 4);
    // 🔴 派单原文要的是 `orderChurn → releasePressure`。Order→WorkOrder 没有任何链路
    //    （`workOrderProps` 里根本没有订单 FK），故改走 order_for_model 四跳。这一条断言的正是
    //    「虽然多了两跳，它**真的**走到了工单下达压力」—— 不然那句改接就只是说说。
    expect(
      p2.farDelta,
      "G-ROOT-2 远端：插单/取消四跳（→型号需求负载→基地负载→产线利用率→工单下达）之后工单侧必须被顶起来",
    ).toBeGreaterThan(0);

    // ── G-ROOT-4 · 设备故障 → 工序排队压力；远端真的走到设备负荷压力 ──────────────
    const r4 = rules.find((r) => r.key === "demo_equipment_failure_to_process_queue")!;
    expect(r4.coefficient).toBeGreaterThan(0);
    const p4 = await probe(r4, "Equipment", "loadPressure");
    expect(
      p4.oneHopDelta,
      `G-ROOT-4 传导臂：Equipment.equipmentFailure +${BUMP} 之后 Process.queuePressure 一动不动（落点 ${p4.pickId}）`,
    ).toBeCloseTo(TICKS * r4.coefficient * BUMP * p4.oneHopTargets, 4);
    // 🔴 派单原文要的 `equipmentFailure → loadPressure`：多一跳（设备→工序→设备负荷），
    //    因为 loadPressure 挂在 Equipment 自己身上、全表零自环边。这条断言它**真的**走到了。
    expect(
      p4.farDelta,
      "G-ROOT-4 远端：设备故障两跳（→工序排队→设备负荷）之后 Equipment.loadPressure 必须真的动",
    ).toBeGreaterThan(0);
  }, 300000);
});
