import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FinanceWorldProjectionOutput, SandboxViewConfig, SimSession, TickState } from "@platform/contracts";

/**
 * ══ WO-FINANCE-WORLDSTATE · 前端半：金额面板真的换掉了「缺记号」 ═══════════════════
 *
 * ── 这道门咬什么（SEAM：不是各半 unit 各绿就算）───────────────────────────────────
 *  ① **接线**：沙盘的**真会话 id** 真的作为 `worldId` 传给了 `finance_world_projection`
 *     （挂错世界 = 屏上是另一个世界的钱，看不出来）；
 *  ② **数字来自回包**：屏上的金额与 Δ 由回包现算比对，**不写死** ——
 *     写死等于赌桩不变，桩一改这条测试就在测别的东西；
 *  ③ **诚实位两向**：口径行「推演投影 · 非实测」**常驻第一层**（不 hover、不点开就在），
 *     且求解器说不可用 / 请求失败时**退回缺口记号**并给后端原话，**不显示 0、不编数**。
 *
 * 反向判据同样要有：可用时**不许**出现缺口记号，不可用时**不许**出现金额行。
 * 只咬一向会漏掉「两个都渲染了」这种最难看的形态。
 *
 * R6：网络全桩、无时钟、无随机。
 */

const STATE_VARS = [
  "costPressure",
  "demandLoad",
  "demandPressure",
  "overduePressure",
  "priceShock",
  "receivablePressure",
];

const CFG: SandboxViewConfig = {
  tenantId: "demo",
  nodeTypes: ["MaterialBatch"],
  nodeObjectIds: { MaterialBatch: ["mb_001", "mb_002"] },
  linkTypes: ["feeds"],
  stateVars: STATE_VARS,
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"],
  propagationCount: 13,
};

/**
 * 回包桩 —— **按契约 `FinanceWorldProjectionOutputSchema` 写全**。
 *
 * ⚠ 三区门的教训（那份文件顶部记着）：桩少一个字段会让面板在渲染期抛异常、整棵树被卸掉，
 *   于是失败信息指向一个跟病因毫不相干的地方。**桩要按契约写全，否则读到的红是桩的红。**
 */
const OUT_OK: FinanceWorldProjectionOutput = {
  worldId: "sims_fin",
  curTick: 2,
  worldStateSource: "TICK",
  worldObjectCount: 3,
  available: true,
  notes: ["收入行故意不动：世界态需求侧变量与 FinancePlan 收入行之间今天没有传导规则。"],
  basis: {
    kind: "PROJECTION",
    pressureUnit: "pp",
    divisor: 100,
    source: "DEFAULT_DECLARED",
    note: "金额 = 基线 ×（1 + 压力 ÷ 100）",
  },
  pressures: [
    {
      stateVar: "costPressure",
      objectType: "Order",
      value: 4.5,
      carriers: 1,
      universe: 24,
      weighting: "VALUE",
      weightingNote: "按承载对象真金额加权",
      provenance: { kind: "派生", drillType: "Order", drillId: "obj_order_SO-1", drillField: "costPressure", drillValue: 108 },
    },
  ],
  lines: [
    {
      subject: "收入",
      role: "REVENUE",
      budget: 9800,
      rolling: 10000,
      projected: 10000,
      delta: 0,
      deltaPct: 0,
      driver: "",
      formula: "10000（本链不驱动收入）",
      provenance: { kind: "实测", drillType: "FinancePlan", drillId: "fin-rev", drillField: "rolling", drillValue: 10000 },
    },
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
      provenance: { kind: "实测", drillType: "FinancePlan", drillId: "fin-cogs", drillField: "rolling", drillValue: 8000 },
    },
    {
      subject: "毛利",
      role: "MARGIN",
      budget: 1960,
      rolling: 2000,
      projected: 1640,
      delta: -360,
      deltaPct: -18,
      driver: "Order.costPressure（经 收入Δ − 成本Δ 传导）",
      formula: "2000 + 0 − 360 = 1640",
      provenance: { kind: "实测", drillType: "FinancePlan", drillId: "fin-gm", drillField: "rolling", drillValue: 2000 },
    },
  ],
  cash: {
    available: true,
    arBaseline: 5000,
    arProjected: 5112.5,
    arDelta: 112.5,
    overdueExposure: 45,
    overdueSharePct: 0.9,
    invoiceUniverse: 24,
    invoiceCarriers: 24,
    customerLinked: 24,
    formula: "应收投影 = Σ_发票 amount ×（1 + 客户 receivablePressure ÷ 100）",
    provenance: { kind: "实测", drillType: "ARInvoice", drillId: "arinvoice_0_0", drillField: "amount", drillValue: 900 },
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
      provenance: { kind: "派生", drillType: "PropagationRule", drillId: "simpr_demo_material_price_to_model_cost", drillField: "coefficient", drillValue: 0.65 },
    },
    {
      ruleId: "simpr_demo_model_cost_to_order_cost",
      ruleKey: "demo_model_cost_to_order_cost",
      from: "Model.costPressure",
      to: "Order.costPressure",
      viaLinkKey: "model_demanded_by_order",
      coefficient: 0.9,
      delayTicks: 0,
      provenance: { kind: "派生", drillType: "PropagationRule", drillId: "simpr_demo_model_cost_to_order_cost", drillField: "coefficient", drillValue: 0.9 },
    },
  ],
  reconChecks: [{ label: "收入 − 销售成本 − 毛利", baselineResidual: 0, projectedResidual: 0, ok: true }],
  reconciled: true,
  summary: "成本 8000 → 8360、毛利 2000 → 1640。**推演投影，非实测**。",
};

/** 世界态为空那一档：`available:false` + 原因（前端必须退回缺口记号，不许显示 0）。 */
const OUT_EMPTY: FinanceWorldProjectionOutput = {
  ...OUT_OK,
  worldObjectCount: 0,
  available: false,
  unavailableReason: "世界 sims_fin 的态为空（0 个对象有态）—— 金额投影会恒等于基线，据实报缺。",
  notes: ["世界的态为空（baseSnapshot/tick 态均无对象）。"],
};

/** 本用例这次让求解器怎么答（每个 it 自己设）。 */
let financeMode: "ok" | "empty" | "fail" = "ok";
/** 记下求解器真被喂了什么 args —— ①「接线」判据落在这上面。 */
const solverCalls: { key: string; args: Record<string, unknown> }[] = [];

let capturedBase: TickState = {};

vi.mock("@/api/endpoints", () => ({
  fetchWorkspace: vi.fn(),
  fetchSimViewConfig: vi.fn(),
  runSolver: vi.fn(async (key: string, args: Record<string, unknown>) => {
    solverCalls.push({ key, args });
    if (key !== "finance_world_projection") {
      return Promise.reject({ error: { code: "NOT_STUBBED", message: `本门不桩 ${key}`, requestId: "req_test" } });
    }
    if (financeMode === "fail") {
      return Promise.reject({ error: { code: "FEATURE_NOT_FOUND", message: "sim.sandbox 未开通", requestId: "req_test" } });
    }
    return { data: financeMode === "ok" ? OUT_OK : OUT_EMPTY, snapshotVersion: "ov-test" };
  }),
  createSimSession: vi.fn(async (body: { baseSnapshot: TickState }) => {
    capturedBase = body.baseSnapshot;
    return {
      id: "sims_fin",
      tenantId: "demo",
      baseSnapshot: body.baseSnapshot,
      scope: {},
      status: "READY",
      curTick: 0,
      parentCheckpointId: null,
      createdAt: "2026-08-14T00:00:00.000Z",
    } satisfies SimSession;
  }),
  createSimPerturbation: vi.fn(),
  fetchSimPerturbations: vi.fn(async () => ({ items: [] })),
  deleteSimPerturbation: vi.fn(),
  simTick: vi.fn(async (_id: string, n: number) => ({ curTick: n, state: capturedBase })),
  simWorld: vi.fn(async () => ({ tick: 0, state: capturedBase })),
  fetchSimSessions: vi.fn(async () => ({ items: [] })),
  simCheckpoint: vi.fn(),
  simBranch: vi.fn(),
  fetchSimCompare: vi.fn(),
  createActionDraft: vi.fn(),
  fetchSimCertification: vi.fn(async () => null),
  runImpactAnalysis: vi.fn(async () => Promise.reject({ error: { code: "NOT_STUBBED", message: "本门不桩影响传播", requestId: "req_test" } })),
  submitQuery: vi.fn(),
  searchObjects: vi.fn(async () => ({ items: [], total: 0 })),
}));

import SandboxView from "@/views/sim/SandboxView";

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

const ready = () => screen.findByTestId("sandbox-console");

beforeEach(() => {
  financeMode = "ok";
  solverCalls.length = 0;
  capturedBase = {};
});
afterEach(() => cleanup());

describe("WO-FINANCE-WORLDSTATE · 沙盘下区的金额面板", () => {
  it("🔴 接线判据：金额面板用的是**沙盘自己的那个世界**（worldId = 真会话 id）", async () => {
    mount();
    await ready();
    await waitFor(() => expect(solverCalls.some((c) => c.key === "finance_world_projection")).toBe(true));
    const call = solverCalls.find((c) => c.key === "finance_world_projection")!;
    // 等号：`toBeTruthy` 在"随便传了个什么"上恒真，那正是"挂错世界"看不出来的原因。
    expect(call.args.worldId).toBe("sims_fin");
  });

  it("🔴 金额真的上屏，且屏上的数**从回包现算**（不写死）", async () => {
    mount();
    await ready();
    const cost = await screen.findByTestId("sandbox-impact-finance-line-cost");
    const margin = screen.getByTestId("sandbox-impact-finance-line-margin");

    // 基数下限先咬（单参形式 —— 双参 `coverage-blind` 门识别不到）。
    const rows = Array.from(screen.getByTestId("sandbox-impact-finance-lines").children);
    expect(rows.length).toBeGreaterThan(2);

    /**
     * 屏上的「基线 → 投影」必须与回包的 rolling/projected 一致（**现算**，不写死数字）。
     *
     * ⚠ 比对前先归一千分位：Node 的 `zh-CN` 用的是**窄不换行空格**（U+202F）当分组符，
     *   不是逗号（本用例第一版就栽在这：`expected '8 000.00' to contain '8000.00'`）。
     *   两边都过同一个归一器 ⇒ 断言咬的是**数值**，不是某个 ICU 版本的分组符长什么样。
     */
    const digits = (s: string) => s.replace(/[^\d.]/g, "");
    const costOut = OUT_OK.lines.find((l) => l.role === "COST")!;
    const valsTxt = digits(within(cost).getByTestId("sandbox-impact-finance-line-cost-vals").textContent ?? "");
    expect(valsTxt).toContain(digits(costOut.rolling.toFixed(2)));
    expect(valsTxt).toContain(digits(costOut.projected.toFixed(2)));
    // Δ 与方向：成本↑（up）、毛利↓（down）。方向标错 = 屏上说反了，比不显示更坏。
    expect(screen.getByTestId("sandbox-impact-finance-line-cost-amt").getAttribute("data-dir")).toBe("up");
    expect(within(margin).getByTestId("sandbox-impact-finance-line-margin-amt").getAttribute("data-dir")).toBe("down");
    // Δ 文本 = |projected − rolling|（恒等式，不是抄回包里的 delta 字段 —— 抄了就没验算）。
    const expectDelta = Math.abs(costOut.projected - costOut.rolling).toFixed(2);
    const amtTxt = screen.getByTestId("sandbox-impact-finance-line-cost-amt").textContent ?? "";
    expect(amtTxt.startsWith("+")).toBe(true);
    expect(digits(amtTxt)).toBe(digits(expectDelta));

    // 现金行同样在（应收余额），且用的是回包里的基线。
    expect(screen.getByTestId("sandbox-impact-finance-line-ar")).toBeInTheDocument();

    // 反向：可用时**不许**同时出现缺口记号（两个都渲染是最难看的形态）。
    expect(screen.queryByTestId("sandbox-impact-finance-unavailable")).toBeNull();
    expect(screen.queryByTestId("sandbox-impact-finance-failed")).toBeNull();
  });

  it("🔴 口径**常驻第一层**：不 hover、不点开就在，且说明这是推演不是实测", async () => {
    mount();
    await ready();
    const caliber = await screen.findByTestId("sandbox-impact-finance-caliber");
    expect(caliber).toBeVisible();
    expect(caliber.textContent ?? "").toContain("推演投影");
    expect(caliber.textContent ?? "").toContain("非实测");
    // 换算除数也来自回包（前端零写死系数）。
    await waitFor(() => expect(screen.getByTestId("sandbox-impact-finance-caliber").textContent ?? "").toContain("100"));
  });

  it("🔴 诚实位两向：`?` 记号常驻第一层 · 正文默认不渲染 · 打开后写明它与真实损益的分工", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    // ① 正文默认**不渲染**（是不渲染，不是藏起来）
    expect(screen.queryByTestId("sandbox-impact-finance-gap")).toBeNull();
    const trigger = screen.getByTestId("info-impact-finance-gap");
    expect(trigger).toBeVisible();
    /**
     * ② 打开后正文回来：既写清这块金额怎么来的，也仍然写明它与真实损益是两回事。
     *
     * ⚠ 2026-08-17 WO-SCREEN-PLAINSPEAK 改判据落点，**边界一个字没放宽**：
     *   原断言咬的是屏上出现 `finance_pnl` 与 `不吃 worldId / sessionId` ——
     *   那是**求解器名与函数签名**，决策者读了做不出任何决定（正是 dev-jargon 门那条判据）。
     *   于是这条测试变成了「用一个不该上屏的标识符，去证明一条该上屏的诚实位还在」：
     *   **它咬的是措辞，不是那条事实。** 措辞一改就红，而边界其实纹丝未动。
     *   改法不是删断言，是把落点换成**那条事实的人话版**（分工仍必须被说出来）；
     *   技术出处（`finance_pnl` 签名不吃 worldId/sessionId）移进 zh.ts 该段的代码注释。
     */
    await user.hover(trigger);
    const body = await screen.findByTestId("sandbox-impact-finance-gap");
    const txt = body.textContent ?? "";
    expect(txt).toContain("这个世界里花了多少钱");
    expect(txt).toContain("本租户实际损益");
    expect(txt).toContain("两回事");
    expect(txt).toContain("推演投影");
    // 反向：求解器名/签名这类开发的话**不许**再出现在屏上
    expect(txt).not.toContain("finance_pnl");
    expect(txt).not.toContain("sessionId");
  });

  it("🔴 退回诚实缺口：求解器说 available:false ⇒ 给它的原话，**一个金额都不显示**", async () => {
    financeMode = "empty";
    mount();
    await ready();
    const gap = await screen.findByTestId("sandbox-impact-finance-unavailable");
    expect(gap.textContent ?? "").toContain(OUT_EMPTY.unavailableReason!);
    // 反向：不许出现金额行（显示 0 或编一个数正是本单要防的）。
    expect(screen.queryByTestId("sandbox-impact-finance-lines")).toBeNull();
    expect(screen.queryByTestId("sandbox-impact-finance-line-cost")).toBeNull();
    // 口径行仍然常驻（诚实位允许降层，不许删除）。
    expect(screen.getByTestId("sandbox-impact-finance-caliber")).toBeVisible();
  });

  it("🔴 退回诚实缺口：请求本身失败（能力未开通）⇒ 摆后端原话，本页不替它编一个数", async () => {
    financeMode = "fail";
    mount();
    await ready();
    const failed = await screen.findByTestId("sandbox-impact-finance-failed");
    expect(failed.textContent ?? "").toContain("sim.sandbox 未开通"); // 后端原话
    expect(screen.queryByTestId("sandbox-impact-finance-lines")).toBeNull();
    expect(screen.getByTestId("sandbox-impact-finance-caliber")).toBeVisible();
  });

  it("换算链降层可查：真规则系数点得开（『凭什么是这个数』降层，但不是没有）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const chain = await screen.findByTestId("sandbox-impact-finance-chain");
    // 第二层：默认折叠（`<details>` 未展开 ⇒ 内容在 DOM 但不可见）
    expect(chain.hasAttribute("open")).toBe(false);
    await user.click(screen.getByTestId("sandbox-impact-finance-chain-toggle"));
    const hops = Array.from(screen.getByTestId("sandbox-impact-finance-chain-list").children);
    expect(hops.length).toBeGreaterThan(1);
    // 系数来自回包（改种子系数 → 屏上跟着变；前端一个系数都没写死）。
    const hop = screen.getByTestId("sandbox-impact-finance-hop-demo_material_price_to_model_cost");
    expect(hop.textContent ?? "").toContain("0.65");
    expect(hop.textContent ?? "").toContain("Material.priceShock");
  });
});
