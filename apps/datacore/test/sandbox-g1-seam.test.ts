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
import { IMPEDIMENT_RULE_BINDINGS } from "../src/solvers/chain-impediment.js";
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
    const notSynthetic = rows.filter((r) => r.props.dataMode !== "SYNTHETIC");
    expect(synthetic.length, "一条 SYNTHETIC 节拍都没有 ⇒ 引擎永远拿不到闸门").toBeGreaterThan(0);
    // 用例标题声称「SYNTHETIC 与 EMPTY **都**在册」，但下面那个循环原本没有下限：
    // 全部行都是 SYNTHETIC 时它一圈不跑，"EMPTY 必带机器可读原因"这半**一次都没被验过**而全绿。
    expect(notSynthetic.length, "一条非 SYNTHETIC 的节拍都没有 ⇒ 「EMPTY 必带原因」那半是空跑").toBeGreaterThan(0);
    expect(synthetic.length + notSynthetic.length).toBe(rows.length); // 两类穷尽，没有第三态漏在扫描面外
    for (const e of notSynthetic) {
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
    // stepId 撞号会让上面这套"按 id 排除"整体失真（撞号的增值段被当成同一个，漏排一部分），
    // 且下面 ④ 的 `byStep` 也会被后写的覆盖。先钉住 stepId 在增值段内唯一。
    expect(valueAdd.map((s) => s.stepId)).toHaveLength(vaIds.size);
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
    // 全量结果里 so 撞号 ⇒ 集合塌掉 ⇒ 下面的"子集"判据被悄悄放宽（少了的那张单也能"在册"）。
    expect(allSos.size).toBe(all.rows.length);
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
    // impedimentId 撞号 ⇒ 集合塌掉 ⇒ "是全域子集"这条判据被放宽（漏掉的那条也能"在册"）。
    expect(allIds.size).toBe(all.impediments.length);
    for (const i of scoped.impediments) expect(allIds, `${i.impedimentId} 不在全域结果里 —— 收窄变成了另算一份`).toContain(i.impedimentId);

    // ⚠️ 2026-08-13 收编本门时**订正了这条断言的口径**（原文断言的行为已被 canonical 换掉，见下）。
    //
    // 原断言（2026-08-07 写）：「`chain_impediments` **不支持** `businessTypes` ⇒ 必须显式 400 拒绝」，
    // 且用 `expect(body).toContain("businessTypes")` 咬错误文案里出现该维名。
    // **今天在 canonical 上实测：这条已经过期，照原样收会把一句假话锁进门里。**
    //   实收：`{"error":{"code":"VALIDATION_ERROR","message":"scope 不合法：Invalid option:
    //          expected one of \"passenger\"|\"commercial\"|\"storage\""}}`
    //   —— 400 仍在（statusCode 断言照旧通过），但**理由完全变了**：canonical 已经把
    //   `businessTypes` 做成了**受支持的枚举维**（`BusinessTypeSchema` = passenger|commercial|storage，
    //   `solvers/chain-impediment.ts` 真按它过滤，并对"该 locus 类型不承载业务线属性"的判据
    //   出具 UNKNOWN 归属账）。这里 400 是因为 `"储能"` 是**中文标签不是枚举值**。
    // ⇒ 若保留原断言，等于把「本维不支持」这个**已被实现推翻**的结论固化成门；
    //   下一个人为了让门变绿，很可能去把 canonical 的 businessTypes 支持**改回不支持** —— 反向回退。
    //
    // **被保护的不变量没变，换成正着咬**（原注释那句话才是真判据）：
    // 「静默返全域 = 用户以为筛了其实没筛」——所以非法值必须当面拒绝、且要**告诉用户合法值是什么**。
    const rejected = await invokeSolver(t, "chain_impediments", { scope: { businessTypes: ["储能"] } });
    expect(rejected.statusCode, "非法 businessTypes 被静默吞掉了 —— 那是最危险的一种").toBe(400);
    // 不咬维名（canonical 的文案已不含它），改咬**合法值清单**：错误必须可自助修复，
    // 而不是只说一句"不合法"。三个枚举值一个都不能少（`toContain` 在超集上恒真，故逐个断言）。
    for (const legal of ["passenger", "commercial", "storage"]) {
      expect(rejected.body, `拒绝了却不告诉用户合法值 ${legal} ⇒ 用户只能猜`).toContain(legal);
    }

    // 正向：合法枚举值**真被支持且真收窄**（这是 canonical 相对本门原基线新长出来的能力，
    // 必须有断言驱动，否则它是"没人咬的实现"，下次被删掉也没人知道）。
    //
    // ⚠️ **这段断言的第一版是存活变异，已被实测打回、重写**（2026-08-13）：
    // 初版只写了 `scopeUnscoped===false` + `scope` 回带 + `toContain` 子集三条。
    // 变异 M3「把 `chain-impediment.ts` 的 businessTypes 过滤整行改成 `rows = byBase`（静默返全域）」
    // ⇒ **14/14 依旧全绿，RC=0**。三条全部恒真：前两条只看 scope 传没传、不看过滤结果；
    // 而 `toContain` 子集判据**在超集上恒真** —— 不过滤时结果正是全域，当然"每条都在全域里"。
    // ⇒ 子集是**必要不充分**条件，单靠它证明不了"筛了"。重写成下面这样，M3 当场红。
    const btScoped = await solve<{
      impediments: ChainImpediment[];
      scope: { businessTypes?: string[] };
      scopeUnscoped: boolean;
      segmentAttribution?: { requested: string[]; rows: { bindingId: string; carriesSegment: boolean; note: string }[] };
    }>("chain_impediments", { scope: { businessTypes: ["storage"] } });
    expect(btScoped.scopeUnscoped, "给了合法 businessTypes 却仍标全域 ⇒ 维没接线").toBe(false);
    expect(btScoped.scope.businessTypes, "结果没回带 scope ⇒ 前端看不见'筛没筛'").toEqual(["storage"]);
    // 子集（保留：它咬的是"不是另算一份"，与下面那条各管一头）
    for (const i of btScoped.impediments) {
      expect(allIds, `${i.impedimentId} 不在全域结果里 —— 收窄变成了另算一份`).toContain(i.impedimentId);
    }
    // 🔴 **咬"真的筛掉了东西"的那一条**（M3 的靶心）：严格变小，不许只是"没变大"。
    // 实测基线：全域 17 条，`storage` 16 条。过滤若成 no-op 则同为 17 ⇒ 本条红。
    expect(
      btScoped.impediments.length,
      "限定 businessTypes 后条数没有严格变小 ⇒ 过滤是空转（静默返全域 = 用户以为筛了其实没筛）",
    ).toBeLessThan(all.impediments.length);
    // 🔴 **咬"筛不动的地方要当面认账"**（D4 诚实：信息可以降级，不许假装筛准了）。
    // canonical 对"locus 类型不承载业务线属性"的判据出具逐 binding 的作用面账，并把 dataMode 降 PARTIAL。
    const seg = btScoped.segmentAttribution;
    expect(seg?.requested, "给了 businessTypes 却不出具作用面账 ⇒ 筛没筛得准无从查证").toEqual(["storage"]);
    const ineffective = (seg?.rows ?? []).filter((r) => !r.carriesSegment);
    expect(ineffective.length, "作用面账里一条'该判据筛不动'都没有 ⇒ 账是空壳").toBeGreaterThan(0);
    for (const r of ineffective) {
      expect(r.note, `${r.bindingId} 标了筛不动却不给理由 —— 那是静默降级`).not.toBe("");
    }
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
    // ⚠ 诚实登记：这一条**今天是空断言**（变异反证实测：把 `arbitrateByLocus` 的裁决整个摘掉、
    //   同一 locus 的候选全留，本例仍绿）。原因是结构性的，见下一例 —— 不是这行写错了，
    //   是生产上根本没有"同一 locus 出两条候选"的情形可裁。留着它是为了裁决一旦真的可达就立刻生效。
    const loci = out.impediments.map((i) => `${i.locus.objectType}|${i.locus.objectId}`);
    expect(new Set(loci).size, "同一个 locus 出了两条阻滞点 —— 三类不互斥").toBe(loci.length);

    // 判不出来的必须说清"为什么"（诚实缺席，不是不提）
    for (const u of out.unresolved) {
      expect(u.status).toBe("UNKNOWN");
      expect(u.reason.length, `${u.bindingId} 判不出来却没给原因`).toBeGreaterThan(10);
    }
  });

  /**
   * **诚实登记 + 棘轮**：PRD §5.1 要求「三类互斥可判，同一 locus 同时命中时按利用率红线裁决」。
   * 实现有（`arbitrateByLocus`），单测有（`chain-impediment-seam.test.ts` 用手搭候选直测纯函数），
   * 但**生产上恒不可达** —— 六条判据的 `locusObjectType` 两两不同
   * （Process / Line / Order / MaterialBatch / MaterialBalance / DataSourceHealth），
   * 于是 `byLocus` 的每个桶恒只有 1 个候选，裁决分支一次都进不去。
   *
   * 三分法定性 = **接了线没数据**（且是结构性的：不是"这批种子恰好没有"，是判据表决定了不可能有）。
   * 变异反证实测：把裁决整个摘掉 → 上一例仍绿（`RC=0`）⇒ 那条「同一 locus 不出两条」是空断言。
   * 本例把这个事实**钉成断言**：哪天有人加了一条落在已有 locus 类型上的判据，本例当场红，
   * 逼着把上一例升级成真裁决断言（而不是让一条空断言继续在那里冒充覆盖）。
   */
  it("诚实登记：六条判据的 locus 类型两两不同 ⇒ 互斥裁决在生产上**结构性不可达**（棘轮）", () => {
    const types = IMPEDIMENT_RULE_BINDINGS.map((b) => b.locusObjectType);
    expect(
      new Set(types).size,
      `有两条判据落在同一 locus 对象类型上（${types.join(", ")}）⇒ 裁决**真的可达了**。\n` +
        `  → 请把上一例那条「同一 locus 不出两条」升级成真裁决断言（造一个双候选 locus 并断言按红线取卡点），\n` +
        `    然后再把本例改成断言"可达"。别让空断言继续冒充覆盖。`,
    ).toBe(types.length);
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

  // ══ 2026-08-13 收编本门时补登：canonical 上 `WO-CHAIN-24` 又长出 10 条结构性缺口 ══════════
  // 本门原表只有上面 4 条，10 条新的**一条都没登记** ⇒ 首跑即被覆盖判据咬红（这正是它该做的事）：
  //   `E1 报了本门未登记的结构性缺口：demand.forecast#intake, … , delivery.acceptance#inspect`
  // 逐条按 `solvers/chain-loss.ts` 里各自的 `reason`/`probe`（那边每条都带实测行数与字段名）分类，
  // **不是一律填 `[]` 蒙混过关** —— 填 `[]` 等于宣布"这段永远不会变陈旧"，那是在阉割棘轮。
  // 判据只有一条：**这一段有没有"专属承载对象类型"可查？**
  //   · 有对象、缺的是**字段**              ⇒ `[]`（对象来了也不代表这段能算，查了也没意义）
  //   · **连对象类型都不存在**、且已点名叫什么 ⇒ 把那个名字登记上（它一旦被种进来，声明当场变陈旧 → 红）
  "demand.forecast#intake": [], // 缺字段：LongTermAgreement(n=3)/DemandSegment(n=3) 都在，缺的是"预告刷新时刻序列"
  "demand.quote#approval": ["Quote"], // 缺对象：全仓无 Quote 类型（`Quote` 今天只是规则求值期注入的命名空间，非本体对象）
  "capacity.rccp#review": ["ProductionSchedule"], // 缺对象：`ProductionSchedule` **生成器里有、对象库里 n=0** —— 最容易变陈旧的一条
  "capacity.wo_release#release": [], // 缺字段：WorkOrder(n=260) 在，缺 releaseDate/plannedReleaseDate
  "material.kitting#pick": [], // 缺字段：InventoryTxn(n=128) 每行只有单个 occurredAt，缺"请求↔收到"的配对时刻
  "material.purchase_req#approval": ["PurchaseRequisition"], // 缺对象：全仓无请购单类型（probe 自带金丝雀：PurchaseOrder 命中 20+ 行证明检索没坏）
  "material.purchase_order#place": [], // 缺字段：chain-loss.ts 原文明写"**有对象、缺字段**，不许与'没对象'混为一谈"
  "delivery.fg_stock#putaway": [], // 缺字段：FinishedGoodsInventory(n=57) 只有存量 + 全表同值的 asOf，构不成序列
  "delivery.transit#linehaul": [], // 缺字段：Shipment(n=13) 是**来料侧**在途（conn-srm），不是成品发运，非同一段
  "delivery.acceptance#inspect": [], // 缺字段：OrderPromise(n=24) 只有 promiseDate/asOf，无收货/验收时刻
};

/**
 * **已知过期声明**（欠账，本单不修 —— 修它要动 E1 的链路天数 ⇒ 动 `chain_loss` 全部 pct
 * 与前端 `chain-line-map.seam` 的真载荷快照，越出收口单边界，且会与在跑的 dev 撞车）。
 * 本体 §8 `G-CHAIN-LOSS-STALE-GAP`。修好后**必须**把对应项从此清单删掉，否则本门红。
 */
const KNOWN_STALE_GAPS = ["material.customs"] as const;
// ⚠️ 2026-08-13 收编本门时**棘轮下降一格**：`material.iqc` 已从本清单划掉（原文是
// `["material.customs", "material.iqc"]`）。**这一格是机器逼出来的，不是人想起来的** ——
// 把本门原样放到 canonical 上跑，G1-8 当场红并**指名道姓**说了该怎么改：
//   `expected [ 'material.customs' ] to deeply equal [ 'material.customs', 'material.iqc' ]`
//   `→ 少掉的：有人把它修好了 ⇒ 请把它从 KNOWN_STALE_GAPS 里划掉（棘轮只降不升）`
// **先坐实"是修好了"再降，没有拿红换绿**（若是种子被删导致承载物消失，那是回归，降格就是掩盖）：
//   · `IncomingInspection` **仍在种**：`synthetic/service.ts:776 putAll("IncomingInspection", …)`
//     + `battery.ts:2387` 链路 `po_inspected_by` 仍在 ⇒ 承载物没丢，排除"种子被删"这条回归路径；
//   · 真正的变化是 **`material.iqc` 已从 `STRUCTURAL_GAPS` 挪进了可算的 `drafts.push`**
//     （`solvers/chain-loss.ts`：`drillType: "IncomingInspection"` ·
//      `arrivedDay → releasedDay` · `day_stamp_span`），原文注释写着
//      「『到厂 ≠ 可投产』这段等待此前全仓无承载，D2 补上了，本单接进链路」。
//   ⇒ 它不再出现在 `out.empty` 里，"本体里完全不存在"这句话对它已不再成立 —— 是**真修好**。
// 对照组（证明棘轮没被整体阉割）：`material.customs` **仍在**清单里且仍被判过期 ——
// 它的承载物 `CustomsClearance` 有行，但本锚点链上的采购单是境内直供（NO_INSTANCE），故仍报空。

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
