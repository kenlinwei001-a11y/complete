import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FinanceWorldProjectionOutput } from "@platform/contracts";
import { server } from "./setup";
import { FinanceProjectionPanel } from "@/views/sim/SandboxImpactBand";

/**
 * ══ WO-FIELD-DEAD-6 病① · 「诚实位那一层」真的上屏了 ═══════════════════════════════
 *
 * ── 这道门为什么必须驱动**接缝**，不是测一个函数 ────────────────────────────────
 * 本单要治的是 `solver-field-seam:check` 报出的三条 S3 死字段
 * （`worldStateSource` / `worldObjectCount` / `pressures`）——它们的病**不在任何一个函数里**：
 * 后端算了、契约逼着必填带上、`SandboxImpactBand.tsx:192` 也真调了求解器、还真按契约 `safeParse`
 * 校了形 —— **每一半都是绿的，字段就是没上屏**。这正是本仓「绿测试 ≠ 能用·断在接缝」的标本。
 * 所以这道门从**真实求解器回包**出发：
 *  · **MSW 拦真 URL**（`*/b/v1/solvers/finance_world_projection/run`，
 *    与 `api/endpoints.ts:350` `runSolver` 拼的那条路一字不差），
 *  · **不 `vi.mock` 组件、不 `vi.mock('@/api/endpoints')`** —— 真 fetch → 真 zod 校形 → 真渲染。
 *    桩打在组件上，验的就是桩；桩打在网络上，验的才是这条链。
 *
 * ── 咬四条（每条对应一个真实会静默错答的形态）──────────────────────────────────
 *  ① `carriers / universe / weighting` **真出现在屏上**（`getByText` 级 + `toBeVisible`，
 *     不是"在 DOM 里"—— 降进折叠层同样叫"看的人看不见"）；
 *  ② `weighting:"EQUAL"` 显示为**回落**且带 `weightingNote` **原文**
 *     （EQUAL 与 VALUE 混显 = 抹掉可信度差别）；
 *  ③ `carriers:0 · universe:0` 与 `carriers:0 · universe:500` **屏上措辞不同**
 *     （契约注释原文：缺 `universe`，`carriers:0` 无法区分「台账空」与「查过了没中」。
 *     这条最容易被一句「无数据」糊掉 —— 糊掉之后 `universe` 这个字段等于又死了一次）；
 *  ④ 回包**缺字段**时退回诚实缺口记号，且**不把整棵 React 树卸掉**
 *     （`SandboxImpactBand.tsx` 的注释记着这条真事故：第一版 `as` 硬转，回包缺 `lines` 时
 *     `out.lines.find(...)` 抛，React 把整棵树卸掉 ⇒ 沙盘白屏、连坐 4 个用例。
 *     故本例在面板**旁边**放一个兄弟金丝雀节点，断言它还活着 ——
 *     只断言"出现了缺口记号"是不够的：树被卸掉时缺口记号也一样不在，两种坏法要能分开）。
 *
 * 反向判据同样在：可用时不许出现缺口记号；不可用时不许出现金额行与成色行。
 * 只咬一向漏得掉「两个都渲染了」这种最难看的形态。
 *
 * R6：网络全桩、无时钟、无随机。
 */

/** `runSolver` 拼出来的真实路径（`api/endpoints.ts` 的 `/b/v1/solvers/${key}/run`）。 */
const SOLVER_URL = "*/b/v1/solvers/finance_world_projection/run";

const PROV = { kind: "派生", drillType: "Order", drillId: "obj_order_SO-1", drillField: "costPressure", drillValue: 108 } as const;

/**
 * 回包桩 —— **按契约 `FinanceWorldProjectionOutputSchema` 写全**。
 * 少一个字段 `safeParse` 就判不过 ⇒ 面板走缺口分支 ⇒ 读到的红是桩的红，不是代码的红。
 */
const OUT: FinanceWorldProjectionOutput = {
  worldId: "sims_prov",
  curTick: 3,
  worldStateSource: "BASE_SNAPSHOT",
  worldObjectCount: 7,
  available: true,
  notes: ["收入行故意不动：世界态需求侧变量与 FinancePlan 收入行之间今天没有传导规则。"],
  basis: { kind: "PROJECTION", pressureUnit: "pp", divisor: 100, source: "DEFAULT_DECLARED", note: "金额 = 基线 ×（1 + 压力 ÷ 100）" },
  pressures: [
    /* ① 正常档：真有承载对象，且拿得到金额权重 ⇒ VALUE。 */
    {
      stateVar: "costPressure",
      objectType: "Order",
      value: 4.5,
      carriers: 3,
      universe: 500,
      weighting: "VALUE",
      weightingNote: "按 Order.amount 真金额加权",
      provenance: PROV,
    },
    /* ② 回落档：拿不到金额权重 ⇒ EQUAL。`weightingNote` 写明是哪个字段拿不到。 */
    {
      stateVar: "receivablePressure",
      objectType: "Customer",
      value: 2.25,
      carriers: 12,
      universe: 40,
      weighting: "EQUAL",
      weightingNote: "Customer 上没有可用的金额字段（arBalance 缺失），退回等权",
      provenance: { ...PROV, drillType: "Customer", drillField: "receivablePressure" },
    },
    /* ③ `carriers:0 · universe:500` —— **查过了，一个都没中**（台账有，态没传到）。 */
    {
      stateVar: "overduePressure",
      objectType: "ARInvoice",
      value: 0,
      carriers: 0,
      universe: 500,
      weighting: "VALUE",
      weightingNote: "按 ARInvoice.amount 真金额加权",
      provenance: { ...PROV, drillType: "ARInvoice", drillField: "overduePressure" },
    },
    /* ④ `carriers:0 · universe:0` —— **台账里就没有这类对象**。与 ③ 是两件事。 */
    {
      stateVar: "scrapPressure",
      objectType: "ScrapTicket",
      value: 0,
      carriers: 0,
      universe: 0,
      weighting: "EQUAL",
      weightingNote: "ScrapTicket 台账为空，无金额可加权",
      provenance: { ...PROV, drillType: "ScrapTicket", drillField: "scrapPressure" },
    },
  ],
  lines: [
    {
      subject: "销售成本",
      role: "COST",
      budget: 7840,
      rolling: 8000,
      projected: 8360,
      delta: 360,
      deltaPct: 4.5,
      driver: "Order.costPressure",
      formula: "8000 ×（1 + 4.5 ÷ 100）= 8360",
      provenance: { ...PROV, kind: "实测", drillType: "FinancePlan", drillId: "fin-cogs", drillField: "rolling", drillValue: 8000 },
    },
    {
      subject: "毛利",
      role: "MARGIN",
      budget: 1960,
      rolling: 2000,
      projected: 1640,
      delta: -360,
      deltaPct: -18,
      driver: "Order.costPressure",
      formula: "2000 + 0 − 360 = 1640",
      provenance: { ...PROV, kind: "实测", drillType: "FinancePlan", drillId: "fin-gm", drillField: "rolling", drillValue: 2000 },
    },
  ],
  cash: {
    available: true,
    arBaseline: 5000,
    arProjected: 5112.5,
    arDelta: 112.5,
    overdueExposure: 45,
    overdueSharePct: 0.9,
    invoiceUniverse: 500,
    invoiceCarriers: 0,
    customerLinked: 500,
    formula: "应收投影 = Σ_发票 amount ×（1 + 客户 receivablePressure ÷ 100）",
    provenance: { ...PROV, kind: "实测", drillType: "ARInvoice", drillId: "arinvoice_0_0", drillField: "amount", drillValue: 900 },
  },
  chain: [
    {
      ruleId: "simpr_demo_material_price_to_model_cost",
      ruleKey: "demo_material_price_to_model_cost",
      from: "Material.priceShock",
      to: "Model.costPressure",
      viaLinkKey: "material_used_by_model",
      coefficient: 0.65,
      delayTicks: 0,
      provenance: { ...PROV, drillType: "PropagationRule", drillId: "simpr_demo_material_price_to_model_cost", drillField: "coefficient", drillValue: 0.65 },
    },
  ],
  reconChecks: [{ label: "收入 − 销售成本 − 毛利", baselineResidual: 0, projectedResidual: 0, ok: true }],
  reconciled: true,
  summary: "成本 8000 → 8360、毛利 2000 → 1640。**推演投影，非实测**。",
};

/** 让真实 URL 回一份指定载荷（`payload` 走 `unknown` 是为了能喂**不合契约**的回包，见 ④）。 */
function serveProjection(payload: unknown) {
  server.use(http.post(SOLVER_URL, () => HttpResponse.json({ data: payload, snapshotVersion: "ov-test" })));
}

/**
 * 挂载。**面板旁边放一个兄弟金丝雀** —— ④ 的判据落在它身上：
 * 面板若在渲染期抛异常，React 会卸掉**整棵**树，这个兄弟节点会跟着消失。
 * 只断言"缺口记号出现了"分不出「优雅报缺」与「整棵树没了」——后者屏上也没有缺口记号。
 */
function mount(worldId: string | null = "sims_prov") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <div>
        <span data-testid="tree-alive-canary">兄弟节点还活着</span>
        <FinanceProjectionPanel worldId={worldId} curTick={3} />
      </div>
    </QueryClientProvider>,
  );
}

const pressure = (id: string) => screen.getByTestId(`sandbox-impact-finance-pressure-${id}`);

afterEach(() => cleanup());

describe("WO-FIELD-DEAD-6 病① · 财务投影的诚实位真的上屏（接缝：真 URL → 真校形 → 真渲染）", () => {
  it("🔴 ① `pressures[]` 逐条上屏：value / carriers / universe / weighting 四样同时在，且**可见**", async () => {
    serveProjection(OUT);
    mount();

    const list = await screen.findByTestId("sandbox-impact-finance-pressures");
    // 基数下限先咬（单参形式 —— 双参 `coverage-blind` 门识别不到）。
    expect(list.children.length).toBe(OUT.pressures.length);

    const row = pressure("Order-costPressure");
    expect(row).toBeVisible();
    // 值来自回包（现算比对，不写死一个字面量 —— 写死等于赌桩不变）。
    const src = OUT.pressures.find((p) => p.stateVar === "costPressure")!;
    expect(within(row).getByTestId("sandbox-impact-finance-pressure-Order-costPressure-value").textContent).toBe(src.value.toFixed(2));
    // 分子/分母真上屏（`getByText` 级 —— 不是快照，也不是只在 data-* 属性里）。
    const carriers = within(row).getByTestId("sandbox-impact-finance-pressure-Order-costPressure-carriers");
    expect(carriers).toBeVisible();
    expect(carriers.textContent ?? "").toContain(String(src.carriers));
    expect(carriers.textContent ?? "").toContain(String(src.universe));
    // 机器判据（措辞可改，语义不可改）。
    expect(row.getAttribute("data-carriers")).toBe(String(src.carriers));
    expect(row.getAttribute("data-universe")).toBe(String(src.universe));
    expect(row.getAttribute("data-weighting")).toBe(src.weighting);

    // 反向：可用时不许出现任何缺口记号（两个都渲染是最难看的形态）。
    expect(screen.queryByTestId("sandbox-impact-finance-unavailable")).toBeNull();
    expect(screen.queryByTestId("sandbox-impact-finance-failed")).toBeNull();
    expect(screen.queryByTestId("sandbox-impact-finance-contradiction")).toBeNull();
  });

  it("🔴 ② `weighting:\"EQUAL\"` 显示为**回落**并带 `weightingNote` 原文；与 `VALUE` 屏上**不一样**", async () => {
    serveProjection(OUT);
    mount();
    await screen.findByTestId("sandbox-impact-finance-pressures");

    const eq = OUT.pressures.find((p) => p.weighting === "EQUAL" && p.carriers > 0)!;
    const val = OUT.pressures.find((p) => p.weighting === "VALUE" && p.carriers > 0)!;
    const eqTxt = within(pressure(`${eq.objectType}-${eq.stateVar}`))
      .getByTestId(`sandbox-impact-finance-pressure-${eq.objectType}-${eq.stateVar}-weighting`);
    const valTxt = within(pressure(`${val.objectType}-${val.stateVar}`))
      .getByTestId(`sandbox-impact-finance-pressure-${val.objectType}-${val.stateVar}-weighting`);

    expect(eqTxt).toBeVisible();
    // 「回落」这个词必须在屏上（不是只在 data-weighting 里——属性用户读不到）。
    expect(eqTxt.textContent ?? "").toContain("回落");
    // `weightingNote` **原文**（不许前端改写、不许截断——"为什么退回等权"只有后端知道）。
    expect(eqTxt.textContent ?? "").toContain(eq.weightingNote);
    expect(valTxt.textContent ?? "").toContain(val.weightingNote);

    /**
     * 🔴 头号判据：两档**屏上措辞不同**。
     * 这一条不是"看起来更好"，是可信度不同 —— EQUAL 那个数是拿不到金额权重硬算的。
     * 变异反证：把 EQUAL/VALUE 渲染成同一句 ⇒ 本行当场红。
     */
    expect(eqTxt.textContent).not.toBe(valTxt.textContent);
    // 且 VALUE 那档不许出现「回落」（否则"不同"可以靠给两边都加回落来假装满足）。
    expect(valTxt.textContent ?? "").not.toContain("回落");
  });

  it("🔴 ③ `carriers:0·universe:0` 与 `carriers:0·universe:500` **屏上措辞不同**（不许合并成一句「无数据」）", async () => {
    serveProjection(OUT);
    mount();
    await screen.findByTestId("sandbox-impact-finance-pressures");

    const emptyLedger = OUT.pressures.find((p) => p.carriers === 0 && p.universe === 0)!;   // 台账里就没有这类对象
    const noneCarry = OUT.pressures.find((p) => p.carriers === 0 && p.universe > 0)!;        // 查过了，一个都没中
    const a = within(pressure(`${emptyLedger.objectType}-${emptyLedger.stateVar}`))
      .getByTestId(`sandbox-impact-finance-pressure-${emptyLedger.objectType}-${emptyLedger.stateVar}-carriers`);
    const b = within(pressure(`${noneCarry.objectType}-${noneCarry.stateVar}`))
      .getByTestId(`sandbox-impact-finance-pressure-${noneCarry.objectType}-${noneCarry.stateVar}-carriers`);

    expect(a).toBeVisible();
    expect(b).toBeVisible();
    /**
     * 契约 `FinanceWorldPressureSchema.universe` 注释原文：
     * 「缺它 `carriers:0` 无法区分『台账空』与『查过了没中』」。
     * 合并成一句 ⇒ 后端专门多下发的 `universe` 又变回死字段 ⇒ 本行当场红。
     */
    expect(a.textContent).not.toBe(b.textContent);
    // 且「查过了没中」那句必须把**全域基数**写出来（分母不藏起来，否则读者仍不知道查了多少个）。
    expect(b.textContent ?? "").toContain(String(noneCarry.universe));
  });

  it("🔴 `worldStateSource` / `worldObjectCount` 常驻第一层（世界态取自哪一份 · 几个对象有态）", async () => {
    serveProjection(OUT);
    mount();
    const line = await screen.findByTestId("sandbox-impact-finance-worldstate");
    expect(line).toBeVisible();
    // BASE_SNAPSHOT ⇒ 屏上必须说明这是**回落到基线快照**，不是当前 tick 的态（两者金额可以差很远）。
    expect(line.getAttribute("data-source")).toBe(OUT.worldStateSource);
    expect(line.textContent ?? "").toContain("回落");
    expect(line.getAttribute("data-objects")).toBe(String(OUT.worldObjectCount));
    expect(line.textContent ?? "").toContain(String(OUT.worldObjectCount));
  });

  it("🔴 契约判据优先于回包一面之词：`worldObjectCount:0` + `available:true` ⇒ 据实报缺，且写明矛盾", async () => {
    // 契约 finance-world.ts:146 原文「0 = 空世界 → available:false」。回包违约时不许照着渲染。
    serveProjection({ ...OUT, worldObjectCount: 0, available: true });
    mount();
    const bad = await screen.findByTestId("sandbox-impact-finance-contradiction");
    expect(bad).toBeVisible();
    // 反向：一个金额、一条成色都不许出现（空世界的投影恒等于基线 = 拿基线冒充投影）。
    expect(screen.queryByTestId("sandbox-impact-finance-lines")).toBeNull();
    expect(screen.queryByTestId("sandbox-impact-finance-pressures")).toBeNull();
    // 世界态出处仍常驻（此时它正是答案：0 个对象有态）。
    expect(screen.getByTestId("sandbox-impact-finance-worldstate").getAttribute("data-objects")).toBe("0");
  });

  it("🔴 ④ 回包缺 `pressures` ⇒ 退回诚实缺口记号，且**整棵 React 树没被卸掉**", async () => {
    /**
     * 这一例复现的是 `SandboxImpactBand.tsx` 注释里记着的那条真事故：
     * 第一版用 `as` 硬转（编译期断言、运行期零检查），回包缺字段时下游 `.find()` 抛，
     * React 卸掉整棵树 ⇒ 屏上不是「这块面板没数据」，而是**整个沙盘白屏**（连坐 4 个用例）。
     * 现在校形走契约 `safeParse`，缺字段按「拿不到数」处理。
     */
    const { pressures: _dropped, ...withoutPressures } = OUT;
    serveProjection(withoutPressures);
    mount();

    const failed = await screen.findByTestId("sandbox-impact-finance-failed");
    expect(failed).toBeVisible();
    // 报缺时要指名道姓是哪个字段不合形（"本页不猜它想说什么"）。
    expect(failed.textContent ?? "").toContain("pressures");
    // 🔴 兄弟节点还在 = 树没被卸掉。缺了这一条，"优雅报缺"与"整棵树没了"分不开。
    expect(screen.getByTestId("tree-alive-canary")).toBeVisible();
    // 口径行也仍在（诚实位允许降层、不许删除）。
    expect(screen.getByTestId("sandbox-impact-finance-caliber")).toBeVisible();
    // 反向：不许出现金额行或成色行（缺形状还照渲染 = 拿半份数据冒充完整回包）。
    expect(screen.queryByTestId("sandbox-impact-finance-lines")).toBeNull();
    expect(screen.queryByTestId("sandbox-impact-finance-pressures")).toBeNull();
  });
});
