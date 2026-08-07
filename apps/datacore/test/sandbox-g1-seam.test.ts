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
 *   并在**同一个 `Cadence` 对象**上验「三个消费方读的是同一个数」。
 *   任一半漏、或两半口径漂了，本门当场红。
 *
 * ── 与既有单门的分工（避免"复述已有能力"）──────────────────────────────────
 *  · `sandbox-d1-cadence.test.ts`  —— 数据半自证（种子推导对不对）
 *  · `sandbox-e4-cadence-propagation.seam.test.ts` —— D1×E4 两半接缝，但②③④例用的是
 *    **手搭的抽象两点图 + 手喂的 D1 行**（`lightWorld` / `D1_CADENCE_ROWS`）
 *  · `chain-loss-attribution.test.ts` / `chain-impediment-seam.test.ts` / `sandbox-chain-scope.seam.test.ts`
 *    —— 各自一条缝
 * **本门新增的是这些都没有的三条**：
 *  ① **改的是种出来的那个对象**（不是规则、不是手喂的行）：直接改 `Cadence.everyDays` 落库值
 *     → 传导形状真跟着变。这才叫"数据半种下的东西真的在驱动引擎"。
 *  ② **一个数三个消费方对得上**（G1-3）：同一条 `Cadence.everyDays`，
 *     E1 归因摊成的环节天数（`everyDays/2`）与 E4 闸门周期（`everyDays` tick）必须同源；
 *     此前两边各读各的，没有任何断言把它们焊在一起。
 *  ③ **同一个世界连跑四段**：D1→E4 / E1 / E2 / E3 用**同一个租户同一次 seed**，
 *     串起来跑。各单各起 app 时，谁把谁的种子顶掉是看不见的。
 *
 * ── 变异反证的注入点（改哪一处会红，写明白免得下一个人猜）────────────────────
 *  · `synthetic/service.ts:712` `putAll("Cadence", …)` 注释掉  ⇒ G1-1 / G1-3 红（数据半断供）
 *  · `app.ts` tick 路径里 `buildCadenceGates(...)` 换成 `{}`   ⇒ G1-2 红（引擎半不读数据）
 *  · `chain-sim.ts` `computeLossAttribution` 分母改成含增值段 ⇒ G1-4 红（守恒破）
 *  · `scope.ts` `orderInChainScope` 恒 `true`                 ⇒ G1-5 红（作用域形同虚设）
 *  · `chain-impediment.ts` `arbitrateByLocus` 的红线裁决拆掉   ⇒ G1-6 红（卡点/堵点混成一类）
 *
 * ── 诚实边界（本门**不**断言什么，以及为什么）────────────────────────────────
 *  · **不**断言「基线上能演出真瓶颈」：柜位数是从目标反解出来的
 *    （`channels = ceil(lineTargetCells / (channelOutputDaily×0.97))`，`battery.ts:3582`），
 *    常州 formation 余量仅 +1.7% ⇒ 沙盘基线天然"刚好够"。要真瓶颈须把柜位改成独立种子量，
 *    **会动 R6 金值 → 另立单**。本门凡需要瓶颈的地方一律**注入/override 造场景**并当场写明是人造的。
 *  · **不**断言「换个基地答案就变」：引擎层作用域维只修了 3 处（欠账 #116，另有 dev 在修剩余的）。
 *    本门只断言**已接线的那几处**真收窄，未接线的在 `docs/WO-SANDBOX-G1-ACCEPTANCE.md` 里如实登记。
 *  · 前端半（四个视图从 registry 字符串键真渲染）在 `apps/frontend-shell/test/sandbox-g1-views.seam.test.tsx`：
 *    跨包不能同文件（`contracts-only-shared` + jsdom/node 两套环境）。两文件由
 *    `bash scripts/gate-sandbox-g1.sh` 串成一条门（显式捕获退出码）。
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  CHAIN_NODE_IDS,
  LOSS_CONSERVATION_TOLERANCE_PCT,
  expectedCadenceWaitDays,
  isValueAddKind,
  type ChainImpediment,
  type ChainNode,
  type LossAttribution,
} from "@platform/contracts";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { cadenceFromProps } from "../src/synthetic/cadence.js";
import { cadenceGate, nextGateTick } from "../src/sim/propagation.js";

const TENANT = "demo";

/** 收口态唯一的世界：一次 `makeApp` + 一次 `seedBattery`，四段全在它上面跑（合并态判据）。 */
let t: TestApp;

const enableSim = () =>
  t.app.inject({
    method: "PUT",
    url: `/a/v1/tenants/${TENANT}/features`,
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 取种出来的那一行 `Cadence` 对象（**对象库里的真行**，不是测试自己算的）。 */
async function seededCadence(nodeId: string) {
  const rows = await t.repos.objects.listByType(TENANT, "Cadence");
  const hit = rows.find((o) => o.props.nodeId === nodeId);
  if (!hit) throw new Error(`[G1] 种子未落 Cadence(${nodeId}) —— 数据半断供`);
  return hit;
}

/** 就地改落库的 `everyDays`（**改数据**，不改规则、不改代码）—— G1 的驱动手法。 */
async function overrideEveryDays(nodeId: string, everyDays: number): Promise<void> {
  const o = await seededCadence(nodeId);
  await t.repos.objects.put({ ...o, props: { ...o.props, everyDays } });
}

beforeAll(async () => {
  t = await makeApp();
  await seedBattery(t); // 真合成：objects + links + 时序 + 规则 + params（四段共用这一个世界）
  const r = await enableSim();
  expect(r.statusCode, "开 sim.* entitlement 失败，后面 tick 会 404").toBeLessThan(300);
}, 120_000);

// ══════════════════════════════════════════════════════════════════════════════
// G1-1 · 数据半真的种下了 Cadence（不是"契约里有这个类型"）
// ══════════════════════════════════════════════════════════════════════════════

describe("G1-1 · 数据半：seedBattery 真落 Cadence 对象，且 nodeId 全在 CHAIN_NODE_REGISTRY 在册", () => {
  it("Cadence 行数 > 0，SYNTHETIC 与 EMPTY 都在册（诚实缺席要查得到）", async () => {
    const rows = await t.repos.objects.listByType(TENANT, "Cadence");
    expect(rows.length, "seedBattery 没落任何 Cadence —— D1 数据半没接进合成主流程").toBeGreaterThan(0);
    // 每一行的 nodeId 必须在契约单源里（防"数据半自造方言 id"，那会让 E1/E4/前端三边对不上）
    for (const r of rows) {
      expect(CHAIN_NODE_IDS, `Cadence.nodeId=${String(r.props.nodeId)} 不在 CHAIN_NODE_REGISTRY 在册`).toContain(
        String(r.props.nodeId),
      );
    }
    const synthetic = rows.filter((r) => r.props.dataMode === "SYNTHETIC");
    const empty = rows.filter((r) => r.props.dataMode !== "SYNTHETIC");
    expect(synthetic.length, "一条 SYNTHETIC 节拍都没有 ⇒ 引擎永远拿不到闸门").toBeGreaterThan(0);
    // EMPTY 行必须带机器可读原因（"查过没有" ≠ "压根没登记"）
    for (const e of empty) expect(String(e.props.emptyReason ?? ""), `${String(e.props.nodeId)} 标空却没给原因`).not.toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-2 · 数据半 Cadence → 引擎半 propagateTick：**改落库的那个数**，传导形状真跟着变
// ══════════════════════════════════════════════════════════════════════════════

describe("G1-2 · SEAM 命门：改种出来的 Cadence.everyDays ⇒ propagateTick 的放行形状真的因它而变", () => {
  /** 沿 demo 真链路挂一条声明了节拍闸门的传导规则，跑 N tick，回逐 tick 读数。 */
  async function runFlow(cadenceNodeId: string, ticks: number): Promise<{ seen: number[]; orderId: string; modelId: string }> {
    const links = await t.repos.links.list(TENANT, (l) => l.type === "order_for_model");
    const first = links[0];
    expect(first, "demo 世界没有 order_for_model 链路 —— 合成种子结构变了").toBeDefined();
    const { fromId: orderId, toId: modelId } = first!;
    // 规则每次重建（幂等 key），只改数据不改规则 —— 规则在两次测量之间**一个字都不动**
    await t.app.inject({
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
        cadenceNodeId,
        status: "PUBLISHED",
      },
    });
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
    return { seen, orderId, modelId };
  }

  /** 首个非零读数的下标 = 第一次开闸的 tick（形状指纹：闸门前**恒 0**，不是"变小了"）。 */
  const firstRelease = (seen: readonly number[]): number => seen.findIndex((v) => v > 0);

  it("闸门相位/周期来自**对象库那一行**：第一次放行的 tick == nextGateTick(0, gate(该行))", async () => {
    const nodeId = "demand.consensus";
    const row = await seededCadence(nodeId);
    const cad = cadenceFromProps(row.props);
    expect(cad, "种出来的 demand.consensus 不是 SYNTHETIC ⇒ 本例的前提不成立").toBeDefined();
    const gate = cadenceGate(cad!);
    expect(gate, "该节拍不可整 tick 表示 ⇒ 引擎诚实拒绝（本例前提不成立）").not.toBeNull();

    const expectFirst = nextGateTick(0, gate!);
    const { seen } = await runFlow(nodeId, expectFirst + 2);
    // 闸门前恒 0（真的一点都没放），到点当 tick 把攒下的一次性放完
    expect(seen.slice(0, expectFirst)).toEqual(new Array(expectFirst).fill(0));
    expect(firstRelease(seen), "第一次放行的 tick 与对象库那行算出的闸门对不上").toBe(expectFirst);
  });

  it("**只改数据**（Cadence.everyDays 6→3，规则一字不动）⇒ 放行周期真的减半，且总量守恒", async () => {
    const nodeId = "demand.consensus";
    const original = await seededCadence(nodeId);
    const originalEvery = Number(original.props.everyDays);
    try {
      // 人造场景（写明）：把周期钉到 6 与 3 两档，让"周期减半"这件事有确定的期望形状。
      // 用种子真实值直接对比不行 —— 它是一个具体数，无法同时给出"改前/改后"两组。
      await overrideEveryDays(nodeId, 6);
      const slow = (await runFlow(nodeId, 14)).seen;
      await overrideEveryDays(nodeId, 3);
      const fast = (await runFlow(nodeId, 14)).seen;

      // 放行次数：周期 6 → 14 tick 内放行 ~2 次；周期 3 → ~4 次。用"读数跳变次数"数。
      const jumps = (seen: readonly number[]) => seen.filter((v, i) => i > 0 && v > (seen[i - 1] ?? 0)).length + (seen[0]! > 0 ? 1 : 0);
      const slowJumps = jumps(slow);
      const fastJumps = jumps(fast);
      expect(fastJumps, `周期减半后放行次数没变多（slow=${slowJumps} fast=${fastJumps}）—— 引擎根本没读那一行`).toBeGreaterThan(
        slowJumps,
      );
      // 守恒：闸门只改**什么时候**到，不改**到多少**（同 14 tick 的总投放量相同）
      expect(fast[fast.length - 1], "总量被闸门改掉了 —— 那不是节拍，是漏水").toBe(slow[slow.length - 1]);
    } finally {
      await overrideEveryDays(nodeId, originalEvery); // 还原，后面的例子照旧读种子真值
    }
  });

  it("把该行改成诚实缺席（dataMode≠SYNTHETIC）⇒ 声明它的规则进 unresolved 且**不传导**，绝不按'随到随办'跑", async () => {
    const nodeId = "demand.consensus";
    const original = await seededCadence(nodeId);
    try {
      await t.repos.objects.put({ ...original, props: { ...original.props, dataMode: "EMPTY", emptyReason: "G1 人造：验诚实缺席" } });
      const { seen } = await runFlow(nodeId, 4);
      expect(seen, "节拍标空却照样传导 ⇒ 把'不知道要等多久'渲染成了'不用等'").toEqual([0, 0, 0, 0]);
      // 响应必须显式报缺（不是安静的零）
      const links = await t.repos.links.list(TENANT, (l) => l.type === "order_for_model");
      const sid = (
        await (
          await t.app.inject({
            method: "POST",
            url: "/a/v1/sim/sessions",
            headers: ADMIN,
            payload: { baseSnapshot: { [links[0]!.fromId]: { demandPressure: 1 }, [links[0]!.toId]: { demandLoad: 0 } } },
          })
        ).json()
      ).id as string;
      const body = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json();
      const unresolved = (body.cadence?.unresolved ?? []) as { cadenceNodeId: string }[];
      expect(unresolved.map((u) => u.cadenceNodeId), "响应里没有报缺 —— 那就是静默兜底").toContain(nodeId);
    } finally {
      await t.repos.objects.put(original);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-3 · **一个数三个消费方对得上**：E1 归因摊的天数 与 E4 闸门周期 同源
// ══════════════════════════════════════════════════════════════════════════════

describe("G1-3 · 跨消费方口径自洽：同一条 Cadence.everyDays，E1 摊成的环节天数 == 契约唯一公式 everyDays/2", () => {
  it("E1 的每一个 cadence 段都能在对象库找到同 nodeId 的行，且 days 逐值 == expectedCadenceWaitDays(该行)", async () => {
    const res = await invokeSolver(t, "chain_loss_attribution", {});
    expect(res.statusCode, `chain_loss_attribution 失败：${res.body}`).toBe(200);
    const out = res.json() as { nodes: ChainNode[] };
    const cadRows = await t.repos.objects.listByType(TENANT, "Cadence");
    const byNode = new Map(cadRows.map((r) => [String(r.props.nodeId), r.props]));

    const cadenceSteps = out.nodes.flatMap((n) => n.steps.filter((s) => s.kind === "cadence").map((s) => ({ node: n, step: s })));
    expect(cadenceSteps.length, "E1 一个 cadence 段都没有 ⇒ D1×E1 那条缝又断了").toBeGreaterThan(0);
    let checked = 0;
    for (const { step } of cadenceSteps) {
      // 段 id 约定 `${nodeId}__cadence`（chain-loss.ts:581）—— 反解回 nodeId 去对账
      const nodeId = step.stepId.replace(/__cadence$/, "");
      const props = byNode.get(nodeId);
      expect(props, `E1 产出了 cadence 段 ${step.stepId}，但对象库里没有这条 Cadence —— 两半各造各的`).toBeDefined();
      if (props!.dataMode !== "SYNTHETIC") {
        // 诚实缺席的行不该摊出天数
        expect(step.days, `${nodeId} 在库里标空，E1 却摊了 ${step.days} 天 —— 静默兜底`).toBe(0);
        continue;
      }
      expect(step.days, `${nodeId}：E1 摊 ${step.days} 天，而库里 everyDays=${String(props!.everyDays)} ⇒ 应为其一半`).toBeCloseTo(
        expectedCadenceWaitDays({ everyDays: Number(props!.everyDays) }),
        9,
      );
      checked += 1;
    }
    expect(checked, "没有一条 SYNTHETIC 节拍被 E1 摊进链路 —— 对账没有发生").toBeGreaterThan(0);
  });

  it("改落库的 everyDays ⇒ E1 摊的天数**跟着变**（证明 E1 是运行时读对象，不是种子期烤死的常数）", async () => {
    const nodeId = "demand.consensus";
    const original = await seededCadence(nodeId);
    const originalEvery = Number(original.props.everyDays);
    const daysOf = async (): Promise<number | undefined> => {
      const out = (await invokeSolver(t, "chain_loss_attribution", {})).json() as { nodes: ChainNode[] };
      for (const n of out.nodes) for (const s of n.steps) if (s.stepId === `${nodeId}__cadence`) return s.days;
      return undefined;
    };
    try {
      await overrideEveryDays(nodeId, 20);
      expect(await daysOf(), "everyDays=20 ⇒ 该段应摊 10 天").toBeCloseTo(10, 9);
      await overrideEveryDays(nodeId, 40);
      expect(await daysOf(), "把 everyDays 翻倍，E1 摊的天数没跟着翻 ⇒ E1 读的不是这个对象").toBeCloseTo(20, 9);
    } finally {
      await overrideEveryDays(nodeId, originalEvery);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-4 · 损失守恒：全链非增值环节 pctOfChainLoss 之和 == 100%（分母排除增值段）
// ══════════════════════════════════════════════════════════════════════════════

describe("G1-4 · LossAttribution 守恒（分母排除增值段 · S0 冻结口径）", () => {
  it("Σ 非增值段 pctOfChainLoss == 100 ±容差，且**增值段一条都不在归因表里**", async () => {
    const out = (await invokeSolver(t, "chain_loss_attribution", {})).json() as {
      nodes: ChainNode[];
      attribution: LossAttribution[];
      totals: { valueAddDays: number; nonValueDays: number };
      conservation: { sumPct: number; residual: number | null; tolerancePct: number; ok: boolean };
    };
    expect(out.attribution.length, "归因表空 ⇒ 守恒在空表上是假绿").toBeGreaterThan(0);

    // ① 引擎自报的守恒读数
    expect(out.conservation.residual, "residual 为 null ⇒ 无归因行，空表守恒无意义").not.toBeNull();
    expect(Math.abs(out.conservation.residual!)).toBeLessThanOrEqual(out.conservation.tolerancePct);
    expect(out.conservation.tolerancePct).toBe(LOSS_CONSERVATION_TOLERANCE_PCT);
    expect(out.conservation.ok).toBe(true);

    // ② 本门**自己再算一遍**（不信引擎自报）：从 nodes.steps 独立重算，两边必须一致
    const allSteps = out.nodes.flatMap((n) => n.steps);
    const nonValue = allSteps.filter((s) => !isValueAddKind(s.kind));
    const valueAdd = allSteps.filter((s) => isValueAddKind(s.kind));
    const denom = nonValue.reduce((a, s) => a + s.days, 0);
    expect(denom, "全链非增值总量为 0 ⇒ 分母不成立").toBeGreaterThan(0);
    const sum = out.attribution.reduce((a, r) => a + r.pctOfChainLoss, 0);
    expect(Math.abs(sum - 100), `逐行相加得 ${sum}，不是 100`).toBeLessThanOrEqual(LOSS_CONSERVATION_TOLERANCE_PCT);

    // ③ 分母确实排除了增值段：归因表里的 stepId 与增值段 stepId **交集为空**
    const vaIds = new Set(valueAdd.map((s) => s.stepId));
    const leaked = out.attribution.filter((r) => vaIds.has(r.stepId));
    expect(leaked.map((r) => r.stepId), "增值段进了归因分母 —— S0 口径破了").toEqual([]);
    expect(out.totals.valueAddDays, "增值总量为 0 ⇒ 本判据退化成'全都是非增值'，证不了排除").toBeGreaterThan(0);

    // ④ 逐行口径：每行 pct == 该段天数 / 全链非增值总量 × 100（不是"看着像"）
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

describe("G1-5 · 作用域真收窄：给 businessTypes / baseIds ⇒ 结果真变小且是子集", () => {
  it("affected_orders：给 businessTypes ⇒ 严格变小 + 是全量的子集 + 结果回带 scope", async () => {
    const all = (await invokeSolver(t, "affected_orders", {})).json() as { affected: Record<string, unknown>[]; scope?: unknown };
    expect(all.affected.length, "全量 affected 为 0 ⇒ 收窄判据退化，证不了任何事").toBeGreaterThan(0);
    expect(all.scope, "未限定却回带了 scope").toBeUndefined();

    const bts = [...new Set(all.affected.map((o) => String(o.businessType ?? "")))].filter((s) => s !== "");
    expect(bts.length, `全量结果里只有 ${bts.length} 种业务线 ⇒ 无法证明"没泄漏其他细分"`).toBeGreaterThan(1);
    const pick = [...bts].sort()[0]!;

    const one = (await invokeSolver(t, "affected_orders", { businessTypes: [pick] })).json() as {
      affected: Record<string, unknown>[];
      scope?: { businessTypes?: string[] };
    };
    expect(one.affected.length, `选 ${pick} 后结果没变小 ⇒ 作用域形同虚设`).toBeLessThan(all.affected.length);
    expect(one.affected.length, "收窄到 0 ⇒ 本例证不了'只含该细分'").toBeGreaterThan(0);
    // 子集：不是"另算了一批"，是"从全量里筛出来的"
    const allKeys = new Set(all.affected.map((o) => String(o.so)));
    for (const o of one.affected) expect(allKeys, `${String(o.so)} 不在全量结果里 —— 收窄变成了另算一份`).toContain(String(o.so));
    // 零泄漏：一条别的细分都不许混进来
    for (const o of one.affected) expect(String(o.businessType), "跨细分泄漏（G-SEG-ATTR-CROSS-SEGMENT 同类事故）").toBe(pick);
    expect(one.scope?.businessTypes, "结果没回带 scope ⇒ 前端看不见'筛没筛'（R-ARG-FIDELITY）").toEqual([pick]);
  });

  it("chain_impediments：给 baseIds ⇒ 结果真收窄；给 businessTypes ⇒ **显式拒绝**而不是静默返全域", async () => {
    const all = (await invokeSolver(t, "chain_impediments", {})).json() as {
      impediments: ChainImpediment[];
      scopeUnscoped: boolean;
    };
    expect(all.scopeUnscoped).toBe(true);
    const bases = [...new Set(all.impediments.map((i) => String((i.locus.objectId.match(/常州|信阳|武汉|眉山|厦门/) ?? [""])[0])))];
    void bases; // 仅为可读性保留；真正的收窄判据用下面的 baseIds 维

    const baseObjs = await t.repos.objects.listByType(TENANT, "Base");
    const oneBase = String(baseObjs[0]!.props.baseId ?? baseObjs[0]!.props.name);
    const scoped = (await invokeSolver(t, "chain_impediments", { scope: { baseIds: [oneBase] } })).json() as {
      impediments: ChainImpediment[];
      scope: { baseIds?: string[] };
      scopeUnscoped: boolean;
    };
    expect(scoped.scopeUnscoped).toBe(false);
    expect(scoped.scope.baseIds).toEqual([oneBase]);
    expect(scoped.impediments.length, `限定单基地 ${oneBase} 后条数没减少 ⇒ scope 没生效`).toBeLessThan(all.impediments.length);

    // 未支持的维必须**当面拒绝**（静默返全域 = 用户以为筛了、其实没筛）
    const rejected = await invokeSolver(t, "chain_impediments", { scope: { businessTypes: ["储能"] } });
    expect(rejected.statusCode, "businessTypes 被静默吞掉了 —— 那是最危险的一种").toBe(400);
    expect(rejected.body).toContain("businessTypes");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-6 · 阻滞点三类按 PRD §5.1 判据**分开判**（不是一个笼统标签）
// ══════════════════════════════════════════════════════════════════════════════

describe("G1-6 · 卡点/堵点/断点三类互斥可判，裁决线来自规则而非代码常数", () => {
  it("三类各有自己的判据出处：BREAK 必带 breakSubtype；每条 evidence 指得出 ruleKey 与阈值出处", async () => {
    const out = (await invokeSolver(t, "chain_impediments", {})).json() as {
      impediments: ChainImpediment[];
      counts: Record<string, number>;
      thresholds: { bindingId: string; ruleKey: string; source: string; value: number }[];
      unresolved: { bindingId: string; status: string; reason: string }[];
    };
    expect(out.impediments.length, "一条阻滞点都判不出来 ⇒ 后面的互斥判据全退化").toBeGreaterThan(0);

    for (const im of out.impediments) {
      // R13：每个数字可溯源 —— 规则码 + 阈值 + 单位，一个都不许缺
      expect(im.evidence.ruleKey, `${im.impedimentId} 没有 ruleKey ⇒ 阈值来路不明`).toBeTruthy();
      expect(im.evidence.unit).toBeTruthy();
      expect(Number.isFinite(im.evidence.metricValue)).toBe(true);
      expect(Number.isFinite(im.evidence.threshold)).toBe(true);
      // 阈值必须在 thresholds 表里有出处行（source ∈ param/literal/field）
      const th = out.thresholds.find((x) => x.ruleKey === im.evidence.ruleKey);
      expect(th, `${im.evidence.ruleKey} 的阈值没有出处行 ⇒ 引擎自带了一个数`).toBeDefined();
      expect(["param", "literal", "field"]).toContain(th!.source);
      if (im.kind === "BREAK") expect(im.breakSubtype, "BREAK 未带 breakSubtype").toBeTruthy();
      else expect(im.breakSubtype, "非 BREAK 却带了 breakSubtype").toBeUndefined();
    }

    // 互斥：同一个 locus 不许既是卡点又是堵点
    const byLocus = new Map<string, Set<string>>();
    for (const im of out.impediments) {
      const k = `${im.locus.objectType}:${im.locus.objectId}`;
      (byLocus.get(k) ?? byLocus.set(k, new Set()).get(k)!).add(im.kind);
    }
    for (const [k, kinds] of byLocus) {
      expect(kinds.has("BOTTLENECK") && kinds.has("CONGESTION"), `${k} 同时被判成卡点与堵点 —— 三类不互斥`).toBe(false);
    }

    // 判不出来的判据必须在 unresolved 里说清"为什么"（诚实缺席，不是不提）
    for (const u of out.unresolved) {
      expect(u.status).toBe("UNKNOWN");
      expect(u.reason.length, `${u.bindingId} 判不出来却没给原因`).toBeGreaterThan(10);
    }
  });

  it("裁决线是**规则里的红线**：改 C05 的红线 ⇒ 卡点/堵点的划分真的跟着翻（改规则即改推演）", async () => {
    const before = (await invokeSolver(t, "chain_impediments", {})).json() as {
      counts: Record<string, number>;
      thresholds: { ruleKey: string; value: number }[];
    };
    // 规则按 `key` 找（`rules` 仓储的主键是 `id`，`C05` 是 key —— 拿 key 当 id 查会恒 undefined）
    const c05 = (await t.repos.rules.list(TENANT, (r) => r.key === "C05" && r.status === "PUBLISHED"))[0];
    expect(c05, "规则库里没有已发布的 C05 ⇒ 本例前提不成立").toBeDefined();
    const originalExpr = c05!.expression;
    const originalParams = c05!.params;
    try {
      // 人造场景（写明）：把产线利用率红线压到 1%，让"达红线"这件事在基线上必然成立
      // —— 基线天然不夹定（柜位从目标反解，余量 +1.7%），不造场景就没有可翻转的分界。
      await t.repos.rules.put({ ...c05!, expression: "Line.utilization >= params.redline", params: { redline: 1 } });
      const low = (await invokeSolver(t, "chain_impediments", {})).json() as { counts: Record<string, number>; thresholds: { ruleKey: string; source: string; value: number }[] };
      expect(low.counts.BOTTLENECK, "把红线压到 1% 后卡点数没涨 ⇒ 引擎读的不是规则里的红线").toBeGreaterThan(
        before.counts.BOTTLENECK ?? 0,
      );
      const th = low.thresholds.find((x) => x.ruleKey === "C05");
      expect(th?.value, "阈值读回的不是刚改的那个数").toBe(1);
      expect(th?.source, "阈值来源不是 params ⇒ 没走命名阈值面").toBe("param");

      // 反向：红线抬到 999% ⇒ 一条利用率卡点都判不出来（同一批对象、只改红线，结论翻转）
      await t.repos.rules.put({ ...c05!, expression: "Line.utilization >= params.redline", params: { redline: 999 } });
      const high = (await invokeSolver(t, "chain_impediments", {})).json() as { counts: Record<string, number> };
      expect(high.counts.BOTTLENECK, "红线抬到 999% 还判得出卡点 ⇒ 那个数不是从规则来的").toBeLessThan(
        low.counts.BOTTLENECK ?? 0,
      );
    } finally {
      await t.repos.rules.put({ ...c05!, expression: originalExpr, ...(originalParams === undefined ? {} : { params: originalParams }) });
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G1-7 · R6：合并态下同输入两跑字节一致（三个求解器一起验，不是各验各的）
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
