/**
 * WO-SANDBOX-G1 · 推演沙盘系列**收口总门**（端到端 SEAM · 合并态）
 *
 * ── 本门为什么存在（不是把 13 张单的 unit 摞在一起）──────────────────────────
 * S0/D1–D4/E1–E4/F1–F4 十三张单各有各的 SEAM，**每条分支对自己的基线都是对的**。
 * 而本仓 2026-08-07 一天之内撞了三次**只在合并态才现形**的接缝：
 *   · `SolverContext.suppliers` 被两个单各加一份 → `TS2451`（两半各自 typecheck 都 exit 0）
 *   · R6 金值 +16 字节（D2 新增的进口供应商顶掉了 decision-info 的外协前置期最大值）
 *   · 本体锚点漂 196 行（D2 给 extended.ts 加了 259 行，把别人写的锚点推走了）
 * ⇒ 本门的判据是**一个世界跑到底**：同一次 `seedBattery` 种出的租户，
 *   依次驱动 D1→E4（节拍进推演）、E1（损失守恒）、E2（作用域收窄）、E3（三类阻滞点），
 *   并在**同一个 `Cadence` 对象**上验「多个消费方读的是同一个数」。
 *
 * ── 与既有单门的分工（不复述已有能力）──────────────────────────────────────
 *  · `sandbox-d1-cadence.test.ts` 数据半自证 · `sandbox-e4-cadence-propagation.seam.test.ts`
 *    D1×E4 两半接缝（但②③④例用的是**手搭抽象两点图 + 手喂的 D1 行** `lightWorld`/`D1_CADENCE_ROWS`）
 *  · `chain-loss-attribution.test.ts` / `chain-impediment-seam.test.ts` / `sandbox-chain-scope.seam.test.ts` 各一条缝
 * **本门新增这四条，既有门一条都没有**：
 *  ① **改的是种出来的那个对象**（不是规则、不是手喂的行）：直接改对象库里 `Cadence.everyDays`
 *     → 传导形状真跟着变。这才叫"数据半种下的东西真的在驱动引擎"。
 *  ② **一个数两个消费方对得上**（G1-3）：同一条 `Cadence.everyDays`，
 *     E1 归因摊的环节天数（everyDays/2）与 E4 闸门周期（everyDays tick）必须同源、且同时跟着变。
 *  ③ **同一个世界连跑四段**（G1-1..7）：各单各起 app 时，谁把谁的种子顶掉是看不见的。
 *  ④ **诚实缺席的理由必须在合并态下仍然为真**（G1-8）：E1 声称「本体里完全不存在」的段，
 *     若别的单已经把承载物种进来了，那句话就变成了**假的诚实**——比不写更危险。
 *     本门为此立**双向棘轮**（见 G1-8 注释），并在首次运行时就抓出了两条真实存量（清关 / IQC）。
 *
 * ── 变异反证的注入点（改哪一处会红，写明白免得下一个人猜）────────────────────
 *  · `synthetic/service.ts` `putAll("Cadence", …)` 注释掉         ⇒ G1-1 / G1-2 / G1-3 红
 *  · `app.ts` tick 路径 `buildCadenceGates(...)` 换成 `{}`        ⇒ G1-2 红（引擎半不读数据）
 *  · `chain-sim.ts` `computeLossAttribution` 分母改成含增值段      ⇒ G1-4 红（守恒破）
 *  · `scope.ts` `orderInChainScope` 恒 `true`                     ⇒ G1-5 红（作用域形同虚设）
 *  · `chain-impediment.ts` `readRuleThreshold` 写死回字面量        ⇒ G1-6 红（阈值不来自规则）
 *  · 给 `STRUCTURAL_GAPS` 新增一条「本体里没有」但其实已有承载的段 ⇒ G1-8 红
 *
 * ── 诚实边界（本门**不**断言什么，以及为什么）────────────────────────────────
 *  · **不**断言「基线上能演出真瓶颈」：柜位数从目标反解
 *    （`channels = ceil(lineTargetCells / (channelOutputDaily×0.97))`，`battery.ts:3582`），
 *    常州 formation 余量仅 +1.7% ⇒ 基线天然"刚好够"。凡需要瓶颈的地方一律**注入/override 造场景**
 *    并当场标注是人造的；要真瓶颈须把柜位改成独立种子量，**会动 R6 金值 → 另立单**。
 *  · **不**断言「换个基地答案就变」：引擎层作用域维只修了 3 处（欠账 #116，另有 dev 在修剩余的）。
 *    本门只断言**已接线的那几处**真收窄。
 *  · 前端半（四张视图从 registry 字符串键真渲染）在
 *    `apps/frontend-shell/test/sandbox-g1-views.seam.test.tsx` ——
 *    跨包不能同文件（`contracts-only-shared` + jsdom/node 两套环境）。
 *    两文件由 `bash scripts/gate-sandbox-g1.sh` 串成一条门（显式捕获退出码）。
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  CHAIN_NODE_IDS,
  LOSS_CONSERVATION_TOLERANCE_PCT,
  expectedCadenceWaitDays,
  isValueAddKind,
  type ChainImpediment,
  type ChainNode,
  type ChainStep,
  type LossAttribution,
} from "@platform/contracts";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { cadenceFromProps } from "../src/synthetic/cadence.js";
import { cadenceGate, nextGateTick } from "../src/sim/propagation.js";

const TENANT = "demo";
/** 收口态唯一的世界：一次 `makeApp` + 一次 `seedBattery`，四段全在它上面跑（合并态判据）。 */
let t: TestApp;

/** 求解器返回体是 `{ data, snapshotVersion }` —— 取 `data` 的唯一出口。 */
async function solve<T>(key: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await invokeSolver(t, key, args);
  expect(res.statusCode, `${key} 应 200，实收 ${res.body}`).toBe(200);
  return JSON.parse(res.body).data as T;
}

/** 取种出来的那一行 `Cadence` 对象（**对象库里的真行**，不是测试自己算的）。 */
async function seededCadence(nodeId: string) {
  const rows = await t.repos.objects.listByType(TENANT, "Cadence");
  const hit = rows.find((o) => o.props.nodeId === nodeId);
  if (!hit) throw new Error(`[G1] 种子未落 Cadence(${nodeId}) —— 数据半断供`);
  return hit;
}

/** 就地改落库的节拍字段（**改数据**，不改规则、不改代码）—— G1 的驱动手法。 */
async function patchCadence(nodeId: string, patch: Record<string, unknown>): Promise<void> {
  const o = await seededCadence(nodeId);
  await t.repos.objects.put({ ...o, props: { ...o.props, ...patch } });
}

beforeAll(async () => {
  t = await makeApp();
  await seedBattery(t); // 真合成：objects + links + 时序 + 规则 + params（四段共用这一个世界）
  const r = await t.app.inject({
    method: "PUT",
    url: `/a/v1/tenants/${TENANT}/features`,
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });
  expect(r.statusCode, `开 sim.* entitlement 失败：${r.body}`).toBeLessThan(300);
}, 180_000);

// ══════════════════════════════════════════════════════════════════════════════
// G1-1 · 数据半真的种下了 Cadence（不是"契约里有这个类型"）
// ══════════════════════════════════════════════════════════════════════════════

describe("G1-1 · 数据半：seedBattery 真落 Cadence 对象，nodeId 全在 CHAIN_NODE_REGISTRY 在册", () => {
  it("行数 > 0；SYNTHETIC 与 EMPTY 都在册，且 EMPTY 必带机器可读原因", async () => {
    const rows = await t.repos.objects.listByType(TENANT, "Cadence");
    expect(rows.length, "seedBattery 没落任何 Cadence —— D1 数据半没接进合成主流程").toBeGreaterThan(0);
    for (const r of rows) {
      expect(CHAIN_NODE_IDS, `Cadence.nodeId=${String(r.props.nodeId)} 不在 CHAIN_NODE_REGISTRY 在册`).toContain(String(r.props.nodeId));
    }
    const synthetic = rows.filter((r) => r.props.dataMode === "SYNTHETIC");
    expect(synthetic.length, "一条 SYNTHETIC 节拍都没有 ⇒ 引擎永远拿不到闸门").toBeGreaterThan(0);
    for (const e of rows.filter((r) => r.props.dataMode !== "SYNTHETIC")) {
      expect(String(e.props.emptyReason ?? ""), `${String(e.props.nodeId)} 标空却没给原因（"查过没有" ≠ "压根没登记"）`).not.toBe("");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-2 · 数据半 Cadence → 引擎半 propagateTick：**改落库的那个数**，传导形状真跟着变
// ══════════════════════════════════════════════════════════════════════════════

const GATE_NODE = "demand.consensus";
/** 传导规则**只建一次**（同 key 重复 POST 会各自新建 id ⇒ 同一条流被算两遍，守恒当场破）。 */
let ruleId: string | null = null;
let flowIds: { orderId: string; modelId: string } | null = null;

async function ensureRule(): Promise<{ orderId: string; modelId: string }> {
  if (flowIds && ruleId) return flowIds;
  const links = await t.repos.links.list(TENANT, (l) => l.type === "order_for_model");
  expect(links[0], "demo 世界没有 order_for_model 链路 —— 合成种子结构变了").toBeDefined();
  const ids = { orderId: links[0]!.fromId, modelId: links[0]!.toId };
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/sim/propagation-rules",
    headers: ADMIN,
    payload: {
      key: "g1_gated",
      sourceTypeKey: "Order",
      sourceStateVar: "demandPressure",
      viaLinkKey: "order_for_model",
      targetTypeKey: "Model",
      targetStateVar: "demandLoad",
      coefficient: 1,
      delayTicks: 0,
      cadenceNodeId: GATE_NODE,
      status: "PUBLISHED",
    },
  });
  expect(res.statusCode, `建传导规则失败：${res.body}`).toBe(201);
  ruleId = res.json().id as string;
  // 单条纪律：本租户只应有这一条 PUBLISHED 传导规则，否则下面的守恒判据会被别的流污染。
  expect((await t.repos.sim.listPropagationRules(TENANT, true)).length, "本租户不止一条 PUBLISHED 传导规则").toBe(1);
  flowIds = ids;
  return ids;
}

/** 跑一条「恒定来料 → 过闸」的流，回逐 tick 累计到达（走真 REST tick 端点，不直调纯函数）。 */
async function runFlow(ticks: number): Promise<number[]> {
  const { orderId, modelId } = await ensureRule();
  const sid = (
    await (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/sim/sessions",
        headers: ADMIN,
        payload: { baseSnapshot: { [orderId]: { demandPressure: 1 }, [modelId]: { demandLoad: 0 } } },
      })
    ).json()
  ).id as string;
  const seen: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(r.statusCode, `tick 失败：${r.body}`).toBe(200);
    seen.push((r.json().state as Record<string, Record<string, number>>)[modelId]?.demandLoad ?? 0);
  }
  return seen;
}

describe("G1-2 · SEAM 命门：改种出来的 Cadence ⇒ propagateTick 的放行形状真的因它而变", () => {
  it("闸门相位来自**对象库那一行**：第一次放行的 tick == nextGateTick(0, gate(该行))，之前恒 0", async () => {
    const row = await seededCadence(GATE_NODE);
    const cad = cadenceFromProps(row.props);
    expect(cad, `种出来的 ${GATE_NODE} 不是 SYNTHETIC ⇒ 本例前提不成立`).toBeDefined();
    const gate = cadenceGate(cad!);
    expect(gate, "该节拍不可整 tick 表示 ⇒ 引擎诚实拒绝（本例前提不成立）").not.toBeNull();

    const expectFirst = nextGateTick(0, gate!);
    expect(expectFirst, "相位为 0 时「闸门前恒 0」退化成空断言 —— 换一个有相位的节点").toBeGreaterThan(0);
    const seen = await runFlow(expectFirst + 2);
    expect(seen.slice(0, expectFirst), "闸门前不是恒 0 ⇒ 到点放行退化成了固定时长").toEqual(new Array(expectFirst).fill(0));
    expect(seen[expectFirst], "到点没有把攒下的一次性放完（批量释放现象消失）").toBe(expectFirst + 1);
  });

  it("**只改数据**（everyDays 6→3、规则一字不动）⇒ 放行次数真的变多，且公倍数点上总量守恒", async () => {
    const original = await seededCadence(GATE_NODE);
    const restore = { everyDays: original.props.everyDays, offsetDays: original.props.offsetDays };
    try {
      // 人造场景（写明）：把周期钉到 6 / 3、相位钉到 0，让"周期减半"有确定的期望形状。
      // 用种子真值直接比不行 —— 它是一个具体数，给不出"改前/改后"两组。
      const TICKS = 13; // 索引 0..12；12 是 6 与 3 的公倍数点 ⇒ 两边都刚放完，总量可直接比
      await patchCadence(GATE_NODE, { everyDays: 6, offsetDays: 0 });
      const slow = await runFlow(TICKS);
      await patchCadence(GATE_NODE, { everyDays: 3, offsetDays: 0 });
      const fast = await runFlow(TICKS);

      const jumps = (s: readonly number[]) => s.filter((v, i) => i > 0 && v > (s[i - 1] ?? 0)).length + (s[0]! > 0 ? 1 : 0);
      expect(jumps(fast), `周期减半后放行次数没变多（slow=${jumps(slow)} fast=${jumps(fast)}）—— 引擎根本没读那一行`).toBeGreaterThan(
        jumps(slow),
      );
      // 守恒：闸门只改**什么时候**到，不改**到多少**（在两个周期的公倍数点上比较）
      expect(fast[TICKS - 1], "公倍数点上的总量被闸门改掉了 —— 那不是节拍，是漏水").toBe(slow[TICKS - 1]);
      expect(slow[TICKS - 1], "总量为 0 ⇒ 守恒判据退化").toBe(TICKS);
    } finally {
      await patchCadence(GATE_NODE, restore);
    }
  });

  it("把该行改成诚实缺席（dataMode≠SYNTHETIC）⇒ 声明它的规则**不传导**且响应显式报缺，绝不按'随到随办'跑", async () => {
    const original = await seededCadence(GATE_NODE);
    try {
      await patchCadence(GATE_NODE, { dataMode: "EMPTY", emptyReason: "G1 人造场景：验诚实缺席" });
      const seen = await runFlow(4);
      expect(seen, "节拍标空却照样传导 ⇒ 把'不知道要等多久'渲染成了'不用等'").toEqual([0, 0, 0, 0]);

      const { orderId, modelId } = await ensureRule();
      const sid = (
        await (
          await t.app.inject({
            method: "POST",
            url: "/a/v1/sim/sessions",
            headers: ADMIN,
            payload: { baseSnapshot: { [orderId]: { demandPressure: 1 }, [modelId]: { demandLoad: 0 } } },
          })
        ).json()
      ).id as string;
      const body = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json();
      const unresolved = (body.cadence?.unresolved ?? []) as { cadenceNodeId: string }[];
      expect(unresolved.map((u) => u.cadenceNodeId), "响应里没有报缺 —— 那就是静默兜底（安静的零）").toContain(GATE_NODE);
    } finally {
      await t.repos.objects.put(original);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-3 · 一个数多个消费方对得上：E1 归因摊的天数 与 E4 闸门周期 同源
// ══════════════════════════════════════════════════════════════════════════════

interface ChainLossOut {
  nodes: ChainNode[];
  attribution: LossAttribution[];
  empty: { stepId: string; nodeId: string; kind: string; dataMode: string; emptyKind: string; reason: string; probe: string }[];
  totals: { leadTimeDays: number; valueAddDays: number; nonValueDays: number; flowEfficiency: number | null; stepCount: number; emptyCount: number };
  conservation: { sumPct: number; residual: number | null; tolerancePct: number; ok: boolean };
}

describe("G1-3 · 跨消费方口径自洽：E1 摊成的环节天数 == 契约唯一公式 expectedCadenceWaitDays(库里那一行)", () => {
  it("E1 每个 cadence 段都能在对象库找到同 nodeId 的行，days 逐值 == everyDays/2", async () => {
    const out = await solve<ChainLossOut>("chain_loss_attribution");
    const byNode = new Map((await t.repos.objects.listByType(TENANT, "Cadence")).map((r) => [String(r.props.nodeId), r.props]));

    const steps = out.nodes.flatMap((n) => n.steps).filter((s) => s.kind === "cadence");
    expect(steps.length, "E1 一个 cadence 段都没有 ⇒ D1×E1 那条缝又断了").toBeGreaterThan(0);
    let checked = 0;
    for (const step of steps) {
      const nodeId = step.stepId.replace(/__cadence$/, ""); // 段 id 约定见 chain-loss.ts
      const props = byNode.get(nodeId);
      expect(props, `E1 产出了 cadence 段 ${step.stepId}，但对象库里没有这条 Cadence —— 两半各造各的`).toBeDefined();
      expect(props!.dataMode, `${nodeId} 在库里标空，E1 却摊出了段 —— 静默兜底`).toBe("SYNTHETIC");
      expect(step.days, `${nodeId}：E1 摊 ${step.days} 天，库里 everyDays=${String(props!.everyDays)} ⇒ 应为其一半`).toBeCloseTo(
        expectedCadenceWaitDays({ everyDays: Number(props!.everyDays) }),
        9,
      );
      checked += 1;
    }
    expect(checked, "没有一条 SYNTHETIC 节拍被 E1 摊进链路 —— 对账没有发生").toBeGreaterThan(0);
  });

  it("改落库的 everyDays ⇒ E1 摊的天数**跟着变**（证明 E1 是运行时读对象，不是种子期烤死的常数）", async () => {
    const original = await seededCadence(GATE_NODE);
    const daysOf = async (): Promise<number | undefined> =>
      (await solve<ChainLossOut>("chain_loss_attribution")).nodes.flatMap((n) => n.steps).find((s) => s.stepId === `${GATE_NODE}__cadence`)?.days;
    try {
      await patchCadence(GATE_NODE, { everyDays: 20 });
      expect(await daysOf(), "everyDays=20 ⇒ 该段应摊 10 天").toBeCloseTo(10, 9);
      await patchCadence(GATE_NODE, { everyDays: 40 });
      expect(await daysOf(), "把 everyDays 翻倍，E1 摊的天数没跟着翻 ⇒ E1 读的不是这个对象").toBeCloseTo(20, 9);
    } finally {
      await t.repos.objects.put(original);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-4 · 损失守恒：全链非增值环节 pctOfChainLoss 之和 == 100%（分母排除增值段）
// ══════════════════════════════════════════════════════════════════════════════

describe("G1-4 · LossAttribution 守恒（分母排除增值段 · S0 冻结口径）", () => {
  it("Σ 非增值段 pct == 100 ±容差；增值段一条都不在归因表里；逐行 pct == 天数/分母", async () => {
    const out = await solve<ChainLossOut>("chain_loss_attribution");
    expect(out.attribution.length, "归因表空 ⇒ 守恒在空表上是假绿").toBeGreaterThan(0);

    // ① 引擎自报的守恒读数
    expect(out.conservation.residual, "residual 为 null ⇒ 无归因行，空表守恒无意义").not.toBeNull();
    expect(Math.abs(out.conservation.residual!)).toBeLessThanOrEqual(out.conservation.tolerancePct);
    expect(out.conservation.tolerancePct).toBe(LOSS_CONSERVATION_TOLERANCE_PCT);
    expect(out.conservation.ok).toBe(true);

    // ② 本门**自己再算一遍**（不信引擎自报）：从 nodes.steps 独立重算
    const allSteps: ChainStep[] = out.nodes.flatMap((n) => n.steps);
    const nonValue = allSteps.filter((s) => !isValueAddKind(s.kind));
    const valueAdd = allSteps.filter((s) => isValueAddKind(s.kind));
    const denom = nonValue.reduce((a, s) => a + s.days, 0);
    expect(denom, "全链非增值总量为 0 ⇒ 分母不成立").toBeGreaterThan(0);
    const sum = out.attribution.reduce((a, r) => a + r.pctOfChainLoss, 0);
    expect(Math.abs(sum - 100), `逐行相加得 ${sum}，不是 100`).toBeLessThanOrEqual(LOSS_CONSERVATION_TOLERANCE_PCT);

    // ③ 分母确实排除了增值段
    const vaIds = new Set(valueAdd.map((s) => s.stepId));
    expect(out.attribution.filter((r) => vaIds.has(r.stepId)).map((r) => r.stepId), "增值段进了归因分母 —— S0 口径破了").toEqual([]);
    expect(valueAdd.length, "全链一个增值段都没有 ⇒ 本判据退化成'全是非增值'，证不了排除").toBeGreaterThan(0);
    expect(out.totals.valueAddDays, "增值总量为 0 ⇒ 同上退化").toBeGreaterThan(0);

    // ④ 逐行口径：pct == 该段天数 / 全链非增值总量 × 100（不是"看着像"）
    const byStep = new Map(nonValue.map((s) => [s.stepId, s.days]));
    for (const r of out.attribution) {
      const d = byStep.get(r.stepId);
      expect(d, `归因行 ${r.stepId} 在 nodes.steps 里找不到对应段`).toBeDefined();
      expect(r.nonValueDays).toBeCloseTo(d!, 9);
      expect(r.pctOfChainLoss, `${r.stepId} 的占比与"天数/分母"对不上`).toBeCloseTo((d! / denom) * 100, 6);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-5 · ChainScope 真收窄（不是原样返回）
// ══════════════════════════════════════════════════════════════════════════════

interface AggOut {
  summary: { orderCount: number };
  rows: { so: string; seg: string }[];
  scope?: { businessTypes?: string[]; baseIds?: string[] };
}

describe("G1-5 · 作用域真收窄：给 businessTypes / baseIds ⇒ 结果真变小且是子集", () => {
  it("affected_orders：给 businessTypes ⇒ 严格变小 + 是全量子集 + 零跨细分泄漏 + 回带 scope", async () => {
    const all = await solve<AggOut>("affected_orders");
    expect(all.rows.length, "全量订单集为 0 ⇒ 收窄判据退化，证不了任何事").toBeGreaterThan(0);
    expect(all.scope, "未限定却回带了 scope（R-ARG-FIDELITY：未限定 → 字段不出现）").toBeUndefined();

    // 效果层对拍的真值源 = 仓储里的 Order.businessType（不采信求解器自述的 seg 标签）
    const btBySo = new Map((await t.repos.objects.listByType(TENANT, "Order")).map((o) => [String(o.props.so), String(o.props.businessType)]));
    const present = [...new Set(all.rows.map((r) => btBySo.get(r.so) ?? ""))].filter((s) => s !== "").sort();
    expect(present.length, `全量结果只有 ${present.length} 种业务线 ⇒ 无法证明"没泄漏其他细分"`).toBeGreaterThan(1);
    const pick = present[0]!;

    const one = await solve<AggOut>("affected_orders", { businessTypes: [pick] });
    expect(one.rows.length, `选 ${pick} 后结果没变小 ⇒ 作用域形同虚设`).toBeLessThan(all.rows.length);
    expect(one.rows.length, "收窄到 0 ⇒ 本例证不了'只含该细分'").toBeGreaterThan(0);
    const allSos = new Set(all.rows.map((r) => r.so));
    for (const r of one.rows) {
      expect(allSos, `${r.so} 不在全量结果里 —— 收窄变成了另算一份`).toContain(r.so);
      expect(btBySo.get(r.so), "跨细分泄漏（G-SEG-ATTR-CROSS-SEGMENT 同类事故）").toBe(pick);
    }
    expect(one.scope?.businessTypes, "结果没回带 scope ⇒ 前端看不见'筛没筛'").toEqual([pick]);
  });

  it("chain_impediments：给 baseIds ⇒ 真收窄；给 businessTypes ⇒ **显式拒绝**而不是静默返全域", async () => {
    const all = await solve<{ impediments: ChainImpediment[]; scopeUnscoped: boolean }>("chain_impediments");
    expect(all.scopeUnscoped).toBe(true);
    expect(all.impediments.length, "全域一条阻滞点都没有 ⇒ 收窄判据退化").toBeGreaterThan(0);

    const bases = await t.repos.objects.listByType(TENANT, "Base");
    const oneBase = String(bases[0]!.props.baseId);
    const scoped = await solve<{ impediments: ChainImpediment[]; scope: { baseIds?: string[] }; scopeUnscoped: boolean }>("chain_impediments", {
      scope: { baseIds: [oneBase] },
    });
    expect(scoped.scopeUnscoped).toBe(false);
    expect(scoped.scope.baseIds).toEqual([oneBase]);
    expect(scoped.impediments.length, `限定单基地 ${oneBase} 后条数没减少 ⇒ scope 没生效`).toBeLessThan(all.impediments.length);
    // 子集：不是"另算了一批"
    const allIds = new Set(all.impediments.map((i) => i.impedimentId));
    for (const i of scoped.impediments) expect(allIds, `${i.impedimentId} 不在全域结果里 —— 收窄变成了另算一份`).toContain(i.impedimentId);

    // 未支持的维必须**当面拒绝**（静默返全域 = 用户以为筛了、其实没筛）
    const rejected = await invokeSolver(t, "chain_impediments", { scope: { businessTypes: ["储能"] } });
    expect(rejected.statusCode, "businessTypes 被静默吞掉了 —— 那是最危险的一种").toBe(400);
    expect(rejected.body).toContain("businessTypes");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-6 · 阻滞点三类按 PRD §5.1 判据**分开判**（不是一个笼统标签）
// ══════════════════════════════════════════════════════════════════════════════

interface ScanOut {
  impediments: ChainImpediment[];
  counts: { total: number; BOTTLENECK: number; CONGESTION: number; BREAK: number };
  thresholds: { bindingId: string; ruleKey: string; source: string; ruleParamKey?: string; value: number }[];
  unresolved: { bindingId: string; status: string; reason: string }[];
}

describe("G1-6 · 卡点/堵点/断点三类互斥可判，裁决线来自规则而非代码常数", () => {
  it("三类都判得出来；每条 evidence 指得出 ruleKey + 阈值出处；同一 locus 不出两类", async () => {
    const out = await solve<ScanOut>("chain_impediments");
    expect(out.impediments.length, "一条阻滞点都判不出来 ⇒ 后面的互斥判据全退化").toBeGreaterThan(0);
    // 三类都在（"一个笼统标签"的反面判据）
    expect(out.counts.BOTTLENECK, "卡点 0 条 ⇒ 三类没分开").toBeGreaterThan(0);
    expect(out.counts.CONGESTION, "堵点 0 条 ⇒ 三类没分开").toBeGreaterThan(0);
    expect(out.counts.BREAK, "断点 0 条 ⇒ 三类没分开").toBeGreaterThan(0);
    expect(out.counts.total).toBe(out.impediments.length);

    for (const im of out.impediments) {
      expect(im.evidence.ruleKey, `${im.impedimentId} 没有 ruleKey ⇒ 阈值来路不明（R13）`).toBeTruthy();
      expect(im.evidence.unit).toBeTruthy();
      expect(Number.isFinite(im.evidence.metricValue)).toBe(true);
      expect(Number.isFinite(im.evidence.threshold)).toBe(true);
      const th = out.thresholds.find((x) => x.ruleKey === im.evidence.ruleKey);
      expect(th, `${im.evidence.ruleKey} 的阈值没有出处行 ⇒ 引擎自带了一个数`).toBeDefined();
      expect(["param", "literal", "field"], `阈值来源 ${th!.source} 不在三类里`).toContain(th!.source);
      if (im.kind === "BREAK") expect(im.breakSubtype, "BREAK 未带 breakSubtype").toBeTruthy();
      else expect(im.breakSubtype, "非 BREAK 却带了 breakSubtype").toBeUndefined();
      expect(im.tenantId, "R2 tenant_id everywhere").toBe(TENANT);
    }

    // 三类互斥（裁决在 arbitrateByLocus 一处，不靠 if 顺序的巧合）
    const loci = out.impediments.map((i) => `${i.locus.objectType}|${i.locus.objectId}`);
    expect(new Set(loci).size, "同一个 locus 出了两条阻滞点 —— 三类不互斥").toBe(loci.length);

    // 判不出来的必须说清"为什么"（诚实缺席，不是不提）
    for (const u of out.unresolved) {
      expect(u.status).toBe("UNKNOWN");
      expect(u.reason.length, `${u.bindingId} 判不出来却没给原因`).toBeGreaterThan(10);
    }
  });

  it("裁决线是**规则里的红线**：改 C05 的红线 ⇒ 卡点条数真的跟着翻（改规则即改推演）", async () => {
    const c05s = await t.repos.rules.list(TENANT, (r) => r.key === "C05" && r.status === "PUBLISHED");
    expect(c05s.length, "已发布的 C05 不是恰好一条 —— 下面的 put 会被另一条顶掉，判据失真").toBe(1);
    const c05 = c05s[0]!;
    const before = await solve<ScanOut>("chain_impediments");
    try {
      // 人造场景（写明）：基线天然不夹定（柜位从目标反解、余量 +1.7%），不造场景就没有可翻转的分界。
      // 只改**规则**（表达式里的阈值搬进 params 再改它），引擎源码一个字不动。
      await t.repos.rules.put({ ...c05, expression: "Line.utilization >= params.redline", params: { redline: 1 } });
      const low = await solve<ScanOut>("chain_impediments");
      expect(low.counts.BOTTLENECK, "把红线压到 1% 后卡点数没涨 ⇒ 引擎读的不是规则里的红线").toBeGreaterThan(before.counts.BOTTLENECK);
      const th = low.thresholds.find((x) => x.ruleKey === "C05");
      expect(th?.value, "阈值读回的不是刚改的那个数").toBe(1);
      expect(th?.source, "阈值来源不是 params ⇒ 没走命名阈值面").toBe("param");
      expect(th?.ruleParamKey).toBe("redline");

      await t.repos.rules.put({ ...c05, expression: "Line.utilization >= params.redline", params: { redline: 999 } });
      const high = await solve<ScanOut>("chain_impediments");
      expect(high.counts.BOTTLENECK, "红线抬到 999% 还判得出同样多的卡点 ⇒ 那个数不是从规则来的").toBeLessThan(low.counts.BOTTLENECK);
    } finally {
      await t.repos.rules.put(c05); // 原样还原（含原 expression / params / version）
    }
    const after = await solve<ScanOut>("chain_impediments");
    expect(after.counts, "还原后结论与基线不一致 ⇒ 本例污染了共享世界").toEqual(before.counts);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-7 · R6：合并态下同输入两跑字节一致（三个求解器一起验）
// ══════════════════════════════════════════════════════════════════════════════

describe("G1-7 · R6 确定性（合并态）", () => {
  it("chain_loss_attribution / chain_impediments / affected_orders 连跑两次逐字节一致", async () => {
    for (const key of ["chain_loss_attribution", "chain_impediments", "affected_orders"]) {
      const a = (await invokeSolver(t, key, {})).body;
      const b = (await invokeSolver(t, key, {})).body;
      expect(a, `${key} 两跑不一致 ⇒ R6 破（合并态引入了时钟/随机/遍历序依赖）`).toBe(b);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-8 · 诚实缺席的**理由**必须在合并态下仍然为真（双向棘轮）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * E1 的 `STRUCTURAL_GAPS`（`solvers/chain-loss.ts`）是一张**静态表**：每条写死了
 * 「本体里完全不存在」+ 一段取证 probe。这些 probe 是在**各自单的基线上**跑出来的。
 * 合并之后，别的单可能已经把承载物种进来了 —— 于是那句"完全不存在"变成了**假的诚实**：
 * 页面上还挂着"该段无承载"，而库里已经有真数据。这比不写更危险（用户以为查过了）。
 *
 * 判据是**双向棘轮**，两边都得钉住，只钉一边都会烂：
 *  · 不在已知清单里的段：其候选承载对象类型必须**真的 0 行**（新出现的过期声明 → 红）
 *  · 在已知清单里的段：必须**仍然有行**（有人修好了却没更新清单 → 红，逼着把欠账划掉）
 * 另加覆盖判据：`STRUCTURAL_GAP_CARRIERS` 必须覆盖 E1 报出的每一条结构性缺口，
 * E1 新增一条而这里没登记 → 红（逼着人分类，而不是让它悄悄溜过）。
 */
const STRUCTURAL_GAP_CARRIERS: Record<string, readonly string[]> = {
  // reason 说的是"没有这个**字段**"（三个看着像的对象都在，但口径不同）⇒ 无"该段专属对象类型"可查
  "material.in_transit": [],
  // D2 新增：`CustomsClearance`（`synthetic/service.ts` putAll + `po_customs_cleared_by` 链路）
  "material.customs": ["CustomsClearance"],
  // D2 新增：`IncomingInspection`（同上 + `po_inspected_by` 链路）
  "material.iqc": ["IncomingInspection"],
  // reason 说的是"返工**天数**无承载"（不良记录对象在，缺的是时长字段）⇒ 同 in_transit
  "chain.rework": [],
};

/**
 * **已知过期声明**（欠账，本单不修 —— 修它要动 E1 的链路天数 ⇒ 动 `chain_loss` 全部 pct
 * 与前端 `chain-line-map.seam` 的真载荷快照，越出收口单边界，且会与在跑的 dev 撞车）。
 * 本体 §8 `G-CHAIN-LOSS-STALE-GAP`。修好后**必须**把对应项从此清单删掉，否则本门红。
 */
const KNOWN_STALE_GAPS = ["material.customs", "material.iqc"] as const;

describe("G1-8 · 合并态下「诚实缺席」的理由仍为真（双向棘轮 · 本门首跑即抓出两条真实存量）", () => {
  it("E1 声称无承载的结构性缺口，其承载物在对象库里的实况必须与清单逐条对上", async () => {
    const out = await solve<ChainLossOut>("chain_loss_attribution");
    const structural = out.empty.filter((e) => !e.stepId.endsWith("__cadence"));
    expect(structural.length, "E1 一条结构性缺口都没报 ⇒ 本棘轮无对象，判据退化").toBeGreaterThan(0);

    // 覆盖判据：E1 新增一条结构性缺口而本表没登记 → 红（逼着分类，不许悄悄溜过）
    const unclassified = structural.map((e) => e.stepId).filter((id) => !(id in STRUCTURAL_GAP_CARRIERS));
    expect(unclassified, `E1 报了本门未登记的结构性缺口：${unclassified.join(", ")} —— 请在 STRUCTURAL_GAP_CARRIERS 里登记其候选承载对象类型`).toEqual([]);

    const stale: string[] = [];
    for (const e of structural) {
      const carriers = STRUCTURAL_GAP_CARRIERS[e.stepId] ?? [];
      let rows = 0;
      for (const type of carriers) rows += (await t.repos.objects.listByType(TENANT, type)).length;
      if (carriers.length > 0 && rows > 0) stale.push(e.stepId);
    }
    expect(
      [...stale].sort(),
      `E1 「本体里完全不存在」的声明与合并态实况对不上。\n` +
        `  实测过期：${stale.join(", ") || "（无）"}\n` +
        `  已登记欠账：${[...KNOWN_STALE_GAPS].join(", ")}\n` +
        `  → 新增的：E1 该段的承载物已被别的单种进来了，那句"完全不存在"现在是假的（本体 §8 G-CHAIN-LOSS-STALE-GAP）。\n` +
        `  → 少掉的：有人把它修好了 ⇒ 请把它从 KNOWN_STALE_GAPS 里划掉（棘轮只降不升）。`,
    ).toEqual([...KNOWN_STALE_GAPS].sort());
  });
});
