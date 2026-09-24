/**
 * ══ SEAM · 扰动影响面必须**随扰动变化** ══════════════════════════════════════════
 *
 * 仓主实拍（2026-09-14）：「我输入不同的扰动因素，该截屏数据没有变化…前端展示的都是假的？」
 * 真浏览器对照实验证实：原材料涨价 vs 设备故障 → 150/350/17家/156.6亿 **逐字节相同**。
 *
 * ── 2026-09-21 第二次事故（WO-EXPOSURE-CONTRIB）：第一次的修法只改了 `buildMoneyView`
 * 内部（加 NOISE_FLOOR），**没有动 deltas 的产地**。产地是
 * `Console0828.tsx` runM 的 `diffWorld(推演前, 推演后)` —— 它度量「时间走了 N 拍世界变了什么」，
 * 种子永久扰动（+212.42）每拍都在传导 ⇒ 背景 churn p50≈8.64 ≫ 0.01 门槛 ⇒ 150 张永远全入选。
 * 零扰动对照（两个 dev 各独立测一次）：照样 150 / 15,663,001,584 / 17。
 * 形态：「我用『buildMoneyView 对两组不同 deltas 给出不同结果』当作『屏上的影响面随扰动变化』
 * 的证据，而前者并不度量后者 —— 坏的不是 buildMoneyView，是喂给它的 deltas 根本不是扰动的贡献。」
 *
 * 故本门分两层：
 *  · ①-④ 守 `buildMoneyView` 内部逻辑（幅度地板 / 状态排除 / R6）——第一次事故的那一层，保留。
 *  · ⑤-⑦ 守 **deltas 产地**（`buildRunExposureDeltas` 与它的接线）——第二次事故的这一层。
 *    反向金丝雀 ⑤ 是本门的心脏：对照 ≡ 实跑（零扰动的定义）⇒ 必须 0 张 / 0 元；
 *    只验「不同输入给不同输出」抓不住「所有输入都给同一个非零常数」——上一次就是这么漏的。
 */
import { describe, expect, it } from "vitest";
import { respondsToInput, stableForSameInput } from "@platform/contracts";
import {
  buildMoneyView,
  buildRunExposureDeltas,
  splitOrderScope,
  type CellDelta,
  type OrderRow,
  type WorldCells,
} from "../src/views/sim/unified/console0828/console0828Model";
import { checkedTree, factHits } from "./factlock";

/** 真实形态的订单：三种状态按实测比例（COMPLETED 350 / IN_PRODUCTION 100 / OPEN 50 的缩样）。 */
const ORDERS: OrderRow[] = [
  ...Array.from({ length: 7 }, (_, i) => ({ id: `o_done_${i}`, cust: `C${i % 3}`, qty: 10, value: 1e8, due: null, status: "COMPLETED", model: "M" })),
  ...Array.from({ length: 2 }, (_, i) => ({ id: `o_prod_${i}`, cust: `C${i}`, qty: 10, value: 1e8, due: null, status: "IN_PRODUCTION", model: "M" })),
  { id: "o_open_0", cust: "C0", qty: 10, value: 1e8, due: null, status: "OPEN", model: "M" },
];
/**
 * WO-ORDER-SCOPE · `buildMoneyView` 改吃**三档**（在手 / 认识但不在手 / 判不了），
 * 不再吃裸订单数组 —— 敞口基数从此是「在手」而不是「不是已完成」。
 *
 * ⚠ 本文件的期望值**一个都没改**，因为上面这份夹具的状态全部取自契约 `ORDER_STATUSES`
 *   ⇒ `undecidable` 恒为空，三档退化成原来的两档，④ 的 `settledExcluded === 1` 照样成立。
 *   （反例见 `console0828-decision.seam.test.tsx`：那份夹具原本写的是 `CONFIRMED`/`PLANNED`，
 *     两个都不在契约枚举里，三张单会全部落进「判不了」—— 那才是本单要暴露的那条缝。）
 */
const SCOPE = splitOrderScope(ORDERS);
const d = (id: string, delta: number): CellDelta => ({ objectId: id, stateVar: "costPressure", before: 50, after: 50 + delta, delta });
const noCause = (): string | null => null;

// 扰动 A：两张未完成单被**实质推动**（幅度 5 / 3）
const A: CellDelta[] = [d("o_prod_0", 5), d("o_prod_1", 3), d("o_open_0", 2), d("o_done_0", 9)];
// 扰动 B：同样三张单都动了，但**全在噪声级**（≤0.01）——业务上等于没影响
const B: CellDelta[] = [d("o_prod_0", 0.002), d("o_prod_1", 0.001), d("o_open_0", 0.003), d("o_done_0", 9)];

/* ── ⑤⑥⑦ 的布景：一个被背景 churn 推过的对照世界（压力读数在 churn 量级） ──────────
 * 对照 = 同 active 规则集 · 同 horizon · 无本批扰动的世界（counterfactualState）。
 * 零扰动时实跑终态与它**逐字节相同**（tick vs counterfactual 根因单实测 6381 格 diff=0）。 */
const CONTROL: WorldCells = {
  o_done_0: { costPressure: 91.2 },
  o_prod_0: { costPressure: 58.64 },
  o_prod_1: { costPressure: 47.11 },
  o_open_0: { costPressure: 33.33 },
};
/** 在对照世界上叠一个边际效应 = 这次扰动真推出来的那一下。 */
const bump = (base: WorldCells, oid: string, by: number): WorldCells => ({
  ...base,
  [oid]: { costPressure: (base[oid]?.costPressure ?? 0) + by },
});
const applyAll = (base: WorldCells, bumps: readonly [string, number][]): WorldCells =>
  bumps.reduce((w, [oid, by]) => bump(w, oid, by), base);

describe("SEAM · 扰动影响面随扰动变化", () => {
  it("① 两个不同扰动 ⇒ 被推动的单数必须不同（这一条就是那次事故）", () => {
    const va = buildMoneyView(A, SCOPE, noCause);
    const vb = buildMoneyView(B, SCOPE, noCause);
    const r = respondsToInput("被推动的单", va, vb, (v) => v.exposedOrders);
    expect(r.ok, r.message).toBe(true);
  });

  it("② 敞口金额同口径 —— 否则会出现「单数变了金额没变」的自相矛盾", () => {
    const r = respondsToInput("合计敞口", buildMoneyView(A, SCOPE, noCause), buildMoneyView(B, SCOPE, noCause), (v) => v.exposure);
    expect(r.ok, r.message).toBe(true);
  });

  it("③ 反向金丝雀：同一个扰动跑两次必须完全相同（R6）", () => {
    const r = stableForSameInput("被推动的单", buildMoneyView(A, SCOPE, noCause), buildMoneyView(A, SCOPE, noCause), (v) => v.exposedOrders);
    expect(r.ok, r.message).toBe(true);
  });

  it("④ 已完成单一张都不进影响面（仓主报的原始 bug）", () => {
    const v = buildMoneyView(A, SCOPE, noCause);
    expect(v.settledExcluded, "引擎给已完成单算了 delta，本视图必须把它们计入 settledExcluded 并排除").toBe(1);
    /* WO-ORDER-SCOPE：这个恒等式现在有**四**项 —— 补上 `undecidableExcluded`。
       留三项的话，哪天真冒出一个不认识的状态，那张单会从等式里凭空消失而这条断言照样绿
       （本仓记过账：「少掉的那批静默消失在影响面里，屏上看不出区别」）。
       本夹具状态全在契约枚举内 ⇒ 该项此刻恒 0，先钉住它，等式才对得起「划分」这个词。 */
    expect(v.undecidableExcluded, "本夹具状态全部取自契约 ORDER_STATUSES ⇒ 判不了这一档必须是空的").toBe(0);
    expect(v.exposedOrders + v.settledExcluded + v.undecidableExcluded + v.faintOnly).toBe(
      new Set(A.map((x) => x.objectId)).size,
    );
  });

  it("⑤ 反向金丝雀·本门的心脏：对照 ≡ 实跑（零扰动）⇒ 0 张 / 0 元，无论背景 churn 多大", () => {
    // 零扰动的定义：实跑终态逐字节复现对照世界（根因单实测 6381 格 diff=0）。
    // CONTROL 里的读数全在 churn 量级（33–91）——旧口径 diffWorld(推演前, 推演后)
    // 会把这四张单全报成「被推动」；对照差分下它们必须一格都不剩。
    const deltas = buildRunExposureDeltas(CONTROL, structuredClone(CONTROL));
    expect(deltas, "对照与实跑相同 ⇒ 边际贡献必须为空；非空 = 又把 churn 当扰动贡献").toEqual([]);
    const money = buildMoneyView(deltas, SCOPE, noCause);
    expect(money.exposedOrders).toBe(0);
    expect(money.exposure).toBe(0);
  });

  it("⑥ churn 之上叠两种不同的边际效应 ⇒ 四数不同，且 churn 一格都不许漏进 deltas", () => {
    const afterA = applyAll(CONTROL, [["o_prod_0", 5], ["o_prod_1", 3], ["o_open_0", 2], ["o_done_0", 9]]);
    const afterB = applyAll(CONTROL, [["o_prod_0", 0.002], ["o_prod_1", 0.001], ["o_open_0", 0.003], ["o_done_0", 9]]);
    const deltasA = buildRunExposureDeltas(CONTROL, afterA);
    const deltasB = buildRunExposureDeltas(CONTROL, afterB);
    // churn 相消：deltas 里只能有边际效应那几格，背景一格都不许在。
    expect(deltasA.map((x) => x.objectId).sort()).toEqual(["o_done_0", "o_open_0", "o_prod_0", "o_prod_1"]);
    expect(deltasB.map((x) => x.objectId).sort()).toEqual(["o_done_0", "o_open_0", "o_prod_0", "o_prod_1"]);
    const r = respondsToInput("被推动的单", buildMoneyView(deltasA, SCOPE, noCause), buildMoneyView(deltasB, SCOPE, noCause), (v) => v.exposedOrders);
    expect(r.ok, r.message).toBe(true);
    const r2 = respondsToInput("合计敞口", buildMoneyView(deltasA, SCOPE, noCause), buildMoneyView(deltasB, SCOPE, noCause), (v) => v.exposure);
    expect(r2.ok, r2.message).toBe(true);
  });

  it("⑦ 结构判据：屏上的 deltas 必须产自从对照世界出发的差分（接线挪回旧路 = 红）", () => {
    const tree = checkedTree(
      "apps/frontend-shell/src/views/sim/unified/console0828",
      "useMutation", // 已知必中：Console0828.tsx 代码里一定有
      2, // 该目录至少 tsx + model + eventCatalog 三个源文件
    );
    // 正向：deltas 的产地函数在屏组件里被真调用（import 行无括号，天然不算）。
    const callers = factHits(tree, /(?<![\w.])buildRunExposureDeltas\s*\(/);
    expect(
      callers.some((f) => f.endsWith("Console0828.tsx")),
      `runM 必须真调 buildRunExposureDeltas（对照差分的唯一产地）；命中文件：${callers.join(",") || "无"}`,
    ).toBe(true);
    // 反向：旧接线不许复活 —— diffWorld(before.state … 量的是时间 churn，不是扰动贡献。
    const oldWiring = factHits(tree, /diffWorld\s*\(\s*before\.state/);
    expect(
      oldWiring,
      `旧接线复活：diffWorld(before.state, after.state) 量的是「时间走 N 拍的总 churn」，零扰动也报 150 张 / 156.6 亿；命中：${oldWiring.join(",")}`,
    ).toEqual([]);
    // 对照来源：组件必须真调 simCounterfactual（拿 counterfactualState 的那条路）。
    const control = factHits(tree, /(?<![\w.])simCounterfactual\s*\(/);
    expect(
      control.some((f) => f.endsWith("Console0828.tsx")),
      "对照世界只能来自 simCounterfactual 的 counterfactualState（active 规则集）；baselineState 不过对抗方闸，不可用",
    ).toBe(true);
  });

  /* ── ⑧ ②b 摘牌结构判据（WO-EXPOSURE-CONTRIB ②b）────────────────────────────
   * 第四个数「受阻环节」是另一种病：不是口径错，是**压根没接线** —— runM 里那一句
   * `runSolver(chain_impediments, { scope })` 的全部入参就是 scope，没有 sid/扰动/tick，
   * 构造性不可能随扰动变（实测零扰动 18、加扰动仍 18）。裁决 = 摘牌：
   * 移出「本次推演结果」语境，明标「基础数据现状 · 与本次扰动无关」。
   * ⛔ 工单明令禁止第三条路：留在原位只把标签改模糊 —— 那是把谎言降层，不是消除它。
   * 故本条守三样：两卡不许复活 · `.impediments` 字段访问不许复活 · 明标必须在场。
   * 反向金丝雀在注释里写死：把 `runSolver` 塞回 runM（全文件第 2 个调用点）即红。 */
  it("⑧ 摘牌结构判据：受阻环节不许再回到「本次推演结果」语境", () => {
    const tree = checkedTree(
      "apps/frontend-shell/src/views/sim/unified/console0828",
      "useMutation",
      2,
    );
    // ① 「受阻环节」「可处置」两张 KPI 卡不许复活 —— 那是把构造性恒定数摆进推演结果第一屏。
    const cards = factHits(tree, /key:\s*"(?:imp|fix)"/);
    expect(cards, `imp/fix 两卡复活（②b 摘牌被回退）；命中：${cards.join(",")}`).toEqual([]);
    // ② RunResult 的 `.impediments` 字段访问不许复活（顶栏 scope 回显必须来自 impQ.data）。
    const field = factHits(tree, /\.impediments\b/);
    expect(field, `result.impediments 复活（摘牌被回退）；命中：${field.join(",")}`).toEqual([]);
    // ③ runSolver 全目录只能剩 **1 个**调用点（impQ 独立查询）；塞回 runM = 第 2 处 ⇒ 当场红。
    const tsx = tree.find(([p]) => p.endsWith("Console0828.tsx"));
    expect(tsx, "Console0828.tsx 必须在 checkedTree 里（金丝雀：目录/文件名变了这里先红）").toBeDefined();
    const solverCalls = (tsx?.[1].match(/(?<![\w.])runSolver\s*\(/g) ?? []).length;
    expect(solverCalls, `runSolver 调用点 = ${solverCalls}，应恰为 1（impQ）；为 2 = 已塞回 runM`).toBe(1);
    // ④ 摘牌后的明标必须在场：「基础数据现状 · 与本次扰动无关」（读者不读代码也能判断）。
    const caption = factHits(tree, /c0828-base-status/);
    expect(
      caption.some((f) => f.endsWith("Console0828.tsx")),
      "c0828-base-status 明标缺失 —— 摘牌不是删数，新位置的措辞必须让读者自己判断它与扰动无关",
    ).toBe(true);
  });
});
