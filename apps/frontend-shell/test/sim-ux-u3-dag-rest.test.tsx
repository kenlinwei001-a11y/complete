import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-U3-DAG-REST · 判据 **U3**（过程图 + 点节点看凭什么）**剩下 4 页**的接线测试。
 *
 * 判据原文（`docs/PRD-harness-ux-adoption.md` §2 U3）：
 *   「页内有推演过程图，**且**节点点击真接到一个面板，面板里同时有 **来源** 与 **规则**」
 *
 * ⚠ 本文件咬的**不是**「图渲染出来了」。判据的牙是 **点了要出面板、且面板里带的是
 * 那个节点自己的规则引用**。所以每条断言都长这样：
 *   ① 点之前面板**不在**（否则「面板一直挂在 DOM 里」也会让断言通过）；
 *   ② 点某个节点 → 面板在；
 *   ③ 面板里的 `rule-text` 含**该节点独有**的那句口径；
 *   ④ 再点另一个节点 → 规则**换成另一句**（证明不是一句盖全页的套话）。
 * 变异反证（收编前实测，原文见 §4.7）：把 `DagNodeInspector` 里那一行规则删掉 ⇒
 * 本文件必须红在「**面板在、规则不在**」，而不是红在「组件不见了」。
 *
 * ── 这 4 页与上一单判定的关系（本单逐页复核后**全部顶回**）────────────────────
 * `WO-U3-DAG-DESIGN` 判它们「缺后端派生边 / 缺产品裁决 / 无分段语义」而挂账。
 * 复核结论：那三句话各自都**是真的**，但**都不度量「这一页画不画得出推演过程图」** ——
 * 判据要的是**过程**图（节点 = 推演的一环，`data` = 该环读的求解器输出字段名），
 * 不是数据血缘图。逐页论据写在各页那份 `ReasoningGraph` 常量的头注里。
 */

/** 点一个节点 → 返回面板。**先断言点之前面板不在**。 */
async function clickNode(nodeTestId: string): Promise<HTMLElement> {
  expect(screen.queryByTestId("dag-node-inspector")).toBeNull();
  fireEvent.click(screen.getByTestId(nodeTestId));
  return screen.findByTestId("dag-node-inspector");
}

/** 面板里那两样（U3 的牙）：来源 + 规则，一个都不许缺。 */
function expectSrcAndRule(panel: HTMLElement, srcPart: string, rulePart: string): void {
  expect(within(panel).getByTestId("dag-node-inspector-src")).toHaveTextContent(srcPart);
  expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent(rulePart);
}

const closePanel = (): void => {
  fireEvent.keyDown(document, { key: "Escape" });
};

// ══════════════════════════════════════════════════════════════════════════════
// ① what-if —— 上一单判「缺后端派生边」
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-U3-DAG-REST · what-if：同一份假设的两条路，世界语义不同", () => {
  async function openWhatIf(): Promise<void> {
    loginAs("planner");
    renderApp("/v/what-if");
    await screen.findByTestId("wi-process-graph");
  }

  it("U3R-C1 · 点「前向重算」环 → 来源（求解器 + 它读的字段）与规则同时在", async () => {
    await openWhatIf();
    const panel = await clickNode("wi-process-graph-dag-node-infer");
    // 来源 = 求解器 + 字段：只写求解器名，用户不知道看哪个字段；只写字段名，不知道谁算的。
    expectSrcAndRule(panel, "generic_inference", "recompute(dryRun + apply)");
    expect(within(panel).getByTestId("dag-node-inspector-src")).toHaveTextContent("affectedObjects");
    // 诚实位：这一路没有推演世界 —— 它决定了这一路的数能不能与下一路的数对比。
    expect(within(panel).getByTestId("dag-node-inspector-note")).toHaveTextContent("没有推演世界");
  });

  it("U3R-C2 · 两条路是**两个并列节点**，规则各不相同（不是一句盖全页的套话）", async () => {
    await openWhatIf();
    // 同一层（layer 1）两个节点 —— 这就是步骤条压不进一格的那件事。
    expect(screen.getByTestId("wi-process-graph-dag-node-infer")).toHaveAttribute("data-layer", "1");
    expect(screen.getByTestId("wi-process-graph-dag-node-propagate")).toHaveAttribute("data-layer", "1");

    let panel = await clickNode("wi-process-graph-dag-node-propagate");
    expectSrcAndRule(panel, "impact-analysis", "被隔离的推演世界");
    // 反向：它**不**含另一环的规则原文 —— 证明规则是「该节点的」。
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).not.toHaveTextContent("recompute(dryRun + apply)");
    closePanel();

    // 「四维分项」环带的是四个 0 不是同一个 0 那条口径（本页最容易读错的一条）。
    panel = await clickNode("wi-process-graph-dag-node-dims");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("四个「0」不是同一个 0");
  });

  it("U3R-C3 · 分叉真的存在：一个入参环连出两条互不为输入的路（这才是必须画图的理由）", async () => {
    await openWhatIf();
    const dag = screen.getByTestId("wi-process-graph-dag");
    // layer 1 恰好 2 个节点。
    const l1 = [...dag.querySelectorAll('[data-testid^="wi-process-graph-dag-node-"]')].filter(
      (n) => n.getAttribute("data-layer") === "1",
    );
    expect(l1).toHaveLength(2);
    // 入参环自己说得清「两个出口共用同一份类型强制」——否则两处结论对不上会被读成引擎不一致。
    const panel = await clickNode("wi-process-graph-dag-node-assume");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("两个出口共用同一份类型强制");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ② global-sim —— 上一单判「缺产品裁决」
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-U3-DAG-REST · global-sim：一次解的三个面，按期率是真汇合", () => {
  async function openGlobalSim(): Promise<void> {
    loginAs("planner");
    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim-process-graph");
  }

  it("U3R-C4 · 点「产能台账」环 → 来源是 capacityLedger、规则是占用率口径（含除数为 0 的诚实位）", async () => {
    await openGlobalSim();
    const panel = await clickNode("global-sim-process-graph-dag-node-ledger");
    expectSrcAndRule(panel, "capacityLedger", "allocated ÷ cap");
    // 除数为 0 时不臆造 100% —— 这一句就是「凭什么」的实质内容。
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("不臆造");
    expect(within(panel).getByTestId("dag-node-inspector-src")).toHaveTextContent("portfolio");
  });

  it("U3R-C5 · 汇合是真的：按期率环同时连着获排与被挤，且规则点名分母含被挤单", async () => {
    await openGlobalSim();
    // 三个并列切片都在 layer 2。
    for (const k of ["alloc", "displaced", "ledger"]) {
      expect(screen.getByTestId(`global-sim-process-graph-dag-node-${k}`)).toHaveAttribute("data-layer", "2");
    }
    const panel = await clickNode("global-sim-process-graph-dag-node-ontime");
    // 判据的实质：分母含被挤单。少看这一句，「按期率高」会被读成「排得好」。
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("分母含被挤单");
    expect(within(panel).getByTestId("dag-node-inspector-formula")).toHaveTextContent(
      "ontime ÷ (servedCount + displacedCount)",
    );
  });

  it("U3R-C6 · 逐环规则各不相同（被挤 vs 客户级影响，同一支上下游两环也不共用一句）", async () => {
    await openGlobalSim();
    let panel = await clickNode("global-sim-process-graph-dag-node-displaced");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("产能台账守恒");
    closePanel();

    panel = await clickNode("global-sim-process-graph-dag-node-customer");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("客户名与细分取自真对象");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).not.toHaveTextContent("产能台账守恒");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ cleanroom-attr —— 上一单判「缺产品裁决」。三 tab 三求解器 ⇒ 一档一张图。
// ══════════════════════════════════════════════════════════════════════════════

const CR_TYPES = [
  { key: "Furnace", displayName: "化成柜", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "furnaceId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] },
  { key: "Job", displayName: "在制任务", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "jobId", dataType: "string", isPrimaryKey: true }, { propKey: "furnaceRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Furnace" }, { propKey: "qty", dataType: "number", isPrimaryKey: false }, { propKey: "priority", dataType: "number", isPrimaryKey: false }] },
  { key: "Customer", displayName: "客户", domain: "people", status: "ACTIVE", properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Order" }] },
  { key: "Order", displayName: "订单", domain: "product", status: "ACTIVE", properties: [{ propKey: "orderId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Supplier" }] },
  { key: "Supplier", displayName: "供应商", domain: "supply", status: "ACTIVE", properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }] },
  { key: "Product", displayName: "产品", domain: "product", status: "ACTIVE", properties: [{ propKey: "prodId", dataType: "string", isPrimaryKey: true }, { propKey: "revenue", dataType: "number", isPrimaryKey: false }, { propKey: "rawCost", dataType: "number", isPrimaryKey: false }, { propKey: "laborCost", dataType: "number", isPrimaryKey: false }] },
];

describe("WO-U3-DAG-REST · cleanroom-attr：三档各一张图，第一环是**参数倒推**", () => {
  async function openCleanroom(): Promise<void> {
    loginAs("planner");
    server.use(http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(CR_TYPES)));
    renderApp("/v/cleanroom-attr");
    await screen.findByTestId("cr-bn-process-graph");
  }

  it("U3R-C7 · 共享瓶颈：点「参数倒推」环 → 来源写出**这一次真正用的那组参数**（不是参数名清单）", async () => {
    await openCleanroom();
    const panel = await clickNode("cr-bn-process-graph-dag-node-args");
    // 「你凭什么把 Furnace 当资源类型」的答案在倒推规则里，不在求解器里。
    const src = within(panel).getByTestId("dag-node-inspector-src");
    expect(src).toHaveTextContent("resourceType=Furnace");
    expect(src).toHaveTextContent("sharedByType=Job");
    expect(src).toHaveTextContent("viaField=furnaceRef");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("字段名语义强度打分");
  });

  it("U3R-C8 · 共享瓶颈的汇合是真的：降级判定同时要「是瓶颈」与「有哪几方」两个上游", async () => {
    await openCleanroom();
    // 两个并列产物在 layer 2，降级判定在 layer 3。
    expect(screen.getByTestId("cr-bn-process-graph-dag-node-bottlenecks")).toHaveAttribute("data-layer", "2");
    expect(screen.getByTestId("cr-bn-process-graph-dag-node-contention")).toHaveAttribute("data-layer", "2");
    expect(screen.getByTestId("cr-bn-process-graph-dag-node-downgraded")).toHaveAttribute("data-layer", "3");

    // 瓶颈环的规则点名「争用者 ≥ 2」——单方独占把产能用满不算共享瓶颈。
    let panel = await clickNode("cr-bn-process-graph-dag-node-bottlenecks");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("争用者 ≥ 2");
    closePanel();

    // 降级环规则是**另一句**（让位顺序），且诚实位交代优先级字段这次倒推到没有。
    panel = await clickNode("cr-bn-process-graph-dag-node-downgraded");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("按优先级字段排序取让位者");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).not.toHaveTextContent("争用者 ≥ 2");
    expect(within(panel).getByTestId("dag-node-inspector-note")).toHaveTextContent("priority");
  });

  it("U3R-C9 · 切到隐性集中度档 → 换一张图，链上逐跳 viaField 在来源里逐字可见", async () => {
    await openCleanroom();
    fireEvent.click(screen.getByTestId("cr-tab-concentration"));
    await screen.findByTestId("cr-cc-process-graph");
    // 换档 = 换图：上一档那张图整个不在了（不是两张图叠着）。
    expect(screen.queryByTestId("cr-bn-process-graph")).toBeNull();

    const panel = await clickNode("cr-cc-process-graph-dag-node-chain");
    const src = within(panel).getByTestId("dag-node-inspector-src");
    expect(src).toHaveTextContent("startType=Customer");
    expect(src).toHaveTextContent("orderRef→Order");
    expect(src).toHaveTextContent("supplierRef→Supplier");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("ref 结构逐跳倒推");
  });

  it("U3R-C10 · 毛利倒挂档：成本拆项环的规则点名「分母是总成本不是营收」（本档最易读错的一条）", async () => {
    await openCleanroom();
    fireEvent.click(screen.getByTestId("cr-tab-margin"));
    await screen.findByTestId("cr-ma-process-graph");

    // 倒推环把**这次真正认下来的成本字段**逐个写出（少认一个毛利就算高）。
    let panel = await clickNode("cr-ma-process-graph-dag-node-args");
    expect(within(panel).getByTestId("dag-node-inspector-src")).toHaveTextContent("costFields=rawCost , laborCost");
    closePanel();

    panel = await clickNode("cr-ma-process-graph-dag-node-attribution");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).toHaveTextContent("分母是**总成本**不是营收");
    expect(within(panel).getByTestId("dag-node-inspector-formula")).toHaveTextContent("share_i = cost_i ÷ totalCost");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ④ sop-balance —— 上一单判「无分段语义」
// ══════════════════════════════════════════════════════════════════════════════

describe("WO-U3-DAG-REST · sop-balance：顶栏六个数的推演链（边是后端实测的）", () => {
  async function openSop(): Promise<void> {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/sop-balance");
    await user.click(await screen.findByTestId("sop-create"));
    await waitFor(() => expect(screen.getByTestId("sop-detail-status")).toHaveTextContent("DRAFT"));
    await screen.findByTestId("sop-process-graph");
  }

  it("U3R-C11 · 缺口环带**真规则键**链路：点②需求评审环 → 规则是 C21 且标「规则键」档", async () => {
    await openSop();
    const panel = await clickNode("sop-process-graph-dag-node-s2");
    expectSrcAndRule(panel, "sop.step2", "C21");
    // 分档诚实：C21 是规则库里查得到的键，不是前端投影 —— 混成一个字会把用户支去找不存在的键。
    expect(within(panel).getByTestId("dag-node-inspector-rule")).toHaveAttribute("data-rule-kind", "ruleKey");
    expect(within(panel).getByTestId("dag-node-inspector-rule-kind")).toHaveTextContent("规则键");
  });

  it("U3R-C12 · ④ 财务环的规则是 C15/C18 两条，且诚实位说清 C18 是**阻断门**不是警示", async () => {
    await openSop();
    const panel = await clickNode("sop-process-graph-dag-node-s4");
    const rule = within(panel).getByTestId("dag-node-inspector-rule-text");
    expect(rule).toHaveTextContent("C15");
    expect(rule).toHaveTextContent("C18");
    expect(within(panel).getByTestId("dag-node-inspector-rule")).toHaveAttribute("data-rule-kind", "ruleKey");
    expect(within(panel).getByTestId("dag-node-inspector-note")).toHaveTextContent("阻断门");
  });

  it("U3R-C13 · ① 是**孤点**且面板明说「③ 不读这个数」——不补一条后端没有的边", async () => {
    await openSop();
    // 屏上 ① 被淡出（`state: dim`），与其余环分得出来。
    expect(screen.getByTestId("sop-process-graph-dag-node-s1")).toHaveAttribute("data-state", "dim");
    const panel = await clickNode("sop-process-graph-dag-node-s1");
    // 这句话就是这张图最该说的一件事：改 ① 不会让顶栏的可供给动。
    expect(within(panel).getByTestId("dag-node-inspector-note")).toHaveTextContent("不读");
    expect(within(panel).getByTestId("dag-node-inspector-note")).toHaveTextContent("改 ① 不会让顶栏「可供给」动");
  });

  it("U3R-C14 · 缺口是汇合点：需求来自②、供给来自⑤，两支的规则各不相同", async () => {
    await openSop();
    let panel = await clickNode("sop-process-graph-dag-node-kpi-gap");
    expectSrcAndRule(panel, "②/③/⑤ 联动", "需求P50 − 可供给");
    expect(within(panel).getByTestId("dag-node-inspector-note")).toHaveTextContent("唯一的汇合点");
    closePanel();

    panel = await clickNode("sop-process-graph-dag-node-s5");
    expect(within(panel).getByTestId("dag-node-inspector-formula")).toHaveTextContent("supFinal = s3.sup + Σ resolutions[].delta");
    expect(within(panel).getByTestId("dag-node-inspector-rule-text")).not.toHaveTextContent("需求P50 − 可供给");
  });

  it("U3R-C15 · 反向断言：Escape 后面板真消失（不是一直挂在 DOM 里让上面几条白通过）", async () => {
    await openSop();
    await clickNode("sop-process-graph-dag-node-s3");
    closePanel();
    expect(screen.queryByTestId("dag-node-inspector")).toBeNull();
  });
});
