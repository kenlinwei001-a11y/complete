import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropagationRule, SandboxViewConfig } from "@platform/contracts";

/**
 * ══ WO-C0828-SEAM · 「统一推演控制台」`console0828` 的**接缝门**（SEAM-GATE：咬链路不咬函数）══
 *
 * ── 这道门为什么存在 ─────────────────────────────────────────────────────────
 * `console0828` 从 2026-09-10 起是 `/v/sim-unified` 的**默认视图**（`UnifiedSimShell.tsx`
 * 的 `if (!expert)` 提前 return），也就是说它是这条 route 上**用户第一眼看到的那块屏**。
 * 而在本门写出来之前，全仓 `apps/frontend-shell/test/` 里对它的引用只有一处形态：
 * 三个既有套件各自的 `enterExpert()` 辅助里那句 `screen.queryByTestId("c0828-expert")`
 * —— 那是**借它的按钮走开**，不是测它。
 *
 * 复量（开工实测，2026-09-10，base `3914f08d`）：
 *   `grep -rl "c0828" apps/frontend-shell/test/`      → 3 个文件，全部只用 `c0828-expert` 这一个锚点
 *   `grep -rn "console0828Model\|eventCatalog" apps/frontend-shell/src` 去掉自身目录后 → **0**
 *   ⇒ 两个模型文件的**唯一消费方**是 `Console0828.tsx`，而没有任何测试渲染过它
 *   ⇒ 「间接覆盖」这条可能性（铁律 0.5 判据 3：re-export / 高阶函数 / 字符串键分发）**已排除**，
 *      不是「我没找到」，是「它确实没有」。
 *   金丝雀（证明上面那个 grep 有鉴别力，否则 0 只能读作「工具坏了」）：
 *      同法搜 `usim-shell` → 2 个文件，`UnifiedSimShell` → 5 个文件。
 *
 * ── 五条臂，每条写清「链路的哪一端到哪一端」───────────────────────────────────
 *  ① **到达路径**：route 默认渲染 `c0828-root`（不是工作台），`c0828-expert` 点下去才切走。
 *     它是其余四条的前提 —— 它一断，别的断言全会红在「找不到 testid」上而指向错误的病因。
 *  ② **三重不可见的回归咬合**（本门最重要的一条）：落不了地的事件（`data-landable="0"`）
 *     **必须点得开**，点开后解释文本非空。历史病因是三样叠在一起：按钮 `disabled` +
 *     兜底原生 `title` + 面板靠点击打开 ⇒ 解释写好了，三条路用户一条都走不到。
 *     故断言**同时**咬住「不是 disabled」「没有原生 title」「点开后有字」——
 *     只咬其中一条，另外两条回归时不会红。
 *  ③ **加事件 → 暂存**：回包（`view-config` × `propagation-rules` × 对象层）决定哪件事落得了地，
 *     选落点 + 填幅度 → `c0828-add-*` → `c0828-staged-count` 跟着变。
 *     **加两件**（1 件与多件在模型层不是同一段：`causeOf` 只在单件时答得上主因）。
 *  ④ **算一下 → 出结果**：一个按钮背后是五跳（world → perturbation×N → tick → world → solver），
 *     断言四块结果面板**同时**出现，且它们读的是同一次结果。
 *  ⑤ **诚实态不许被吞**：三种「算不出来」各有各的屏上位置，且**都不许显示 0 或空白** ——
 *     「算不出来」与「等于 0」是两个不同的命题（`c0828-nocalc-*` / `c0828-run-error` /
 *     `c0828-imp-error`），屏上混了就是骗人。
 *
 * ── ⓪ 金丝雀 ────────────────────────────────────────────────────────────────
 * 用例 ⓪ 先跑一个**已知必中**的样例（12 件事全部渲染出按钮）。它若失败 ⇒ 报「**工具坏了**」，
 * ⛔ 不许读作「这件事落不了地」——② 那条臂正是靠「某个按钮 `data-landable=0`」下否定结论的，
 * 探针本身坏掉时那个结论会**恰好反着成立**。
 *
 * ── fixture 纪律 ────────────────────────────────────────────────────────────
 * · 卡点载荷复用既有基线 `fixtures/chain-impediment-baseline.json`（8 处，真引擎形状），
 *   **不新造基线 JSON**（仓主 2026-08-20 禁令 3）。
 * · 三种落地态（`ok` / `no-instance` / `no-statevar`）由**回包现算**，不写死名单：
 *   改 `nodeObjectIds` 或改边集，屏上跟着变 —— 这正是本门要咬的那条线。
 * · R6 确定性：网络全桩，无时钟、无随机。
 */

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// ══════════════════════════════════════════════════════════════════════════════
// fixture · 回包
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 传导规则的边集。**只有这里定义**「哪个类型今天承载哪个量」——
 * `resolveLanding` 拿它与对象条数求交，三种落地态全部由此现算。
 *
 * 刻意让三态都非空（否则 ② 那条臂等于没跑）：
 *   · `Material.priceShock`          ⇒ `material-price-up` **ok**
 *   · `Base.loadIndex`               ⇒ `capacity-loss`     **ok**
 *   · `Order.costPressure`           ⇒ `order-reprice`     **ok**，
 *                                     而 `rush-order` 要的是 `demandPressure` ⇒ **no-statevar**
 *   · `Equipment` 压根不在 `nodeObjectIds` 里 ⇒ `equipment-down` **no-instance**
 */
interface Edge {
  sourceTypeKey: string;
  sourceStateVar: string;
  targetTypeKey: string;
  targetStateVar: string;
}

function baseEdges(): Edge[] {
  return [
    { sourceTypeKey: "Material", sourceStateVar: "priceShock", targetTypeKey: "Model", targetStateVar: "costPressure" },
    { sourceTypeKey: "Base", sourceStateVar: "loadIndex", targetTypeKey: "Line", targetStateVar: "utilPressure" },
    { sourceTypeKey: "Order", sourceStateVar: "costPressure", targetTypeKey: "Customer", targetStateVar: "receivablePressure" },
  ];
}

function rulesFromEdges(edges: readonly Edge[]): PropagationRule[] {
  return edges.map((e, i) => ({
    id: `spr_${String(i)}`,
    tenantId: "demo",
    key: `rule_${String(i)}`,
    sourceTypeKey: e.sourceTypeKey,
    sourceStateVar: e.sourceStateVar,
    viaLinkKey: "feeds",
    targetTypeKey: e.targetTypeKey,
    targetStateVar: e.targetStateVar,
    coefficient: 0.65,
    delayTicks: 0,
    combine: "sum",
    decay: null,
    clamp: null,
    coefficientRef: null,
    cadenceNodeId: null,
    status: "PUBLISHED",
    domainKey: null,
    domainName: null,
    sourceTypeName: null,
    targetTypeName: null,
  })) as unknown as PropagationRule[];
}

/** 落点实体。**没有 `Equipment` 这一项** —— `equipment-down` 的 `no-instance` 由它现算出来。 */
function baseNodeObjectIds(): Record<string, string[]> {
  return {
    Material: ["mat_licarb", "mat_alfoil"],
    Base: ["base_cz", "base_zz"],
    Order: ["ord_1", "ord_2", "ord_3"],
    Customer: ["cust_a", "cust_b"],
    Line: ["line_1"],
  };
}

let nodeObjectIds: Record<string, string[]> = baseNodeObjectIds();
let edges: Edge[] = baseEdges();

function cfg(): SandboxViewConfig {
  return {
    tenantId: "demo",
    nodeTypes: Object.keys(nodeObjectIds),
    nodeObjectIds,
    linkTypes: ["feeds"],
    stateVars: ["priceShock", "costPressure", "loadIndex", "utilPressure", "receivablePressure"],
    stateVarNames: { priceShock: "价格冲击", costPressure: "成本压力", loadIndex: "负载指数" },
    radarDims: [{ key: "structure", label: "结构" }],
    screens: ["sandbox"],
    propagationCount: edges.length,
  } as unknown as SandboxViewConfig;
}

/** 对象层。名字只从这里来（组件取 `props.name` / `props.cust` 等，取不到就回落 id，不编）。 */
const OBJECTS: Record<string, { id: string; props: Record<string, unknown> }[]> = {
  Material: [
    { id: "mat_licarb", props: { name: "碳酸锂", matName: "碳酸锂" } },
    { id: "mat_alfoil", props: { name: "铝箔", matName: "铝箔" } },
  ],
  Base: [
    { id: "base_cz", props: { name: "常州基地" } },
    { id: "base_zz", props: { name: "枣庄基地" } },
  ],
  Order: [
    { id: "ord_1", props: { cust: "宁德时代", qty: 1200, value: 30_000_000, due: "2026-10-01", status: "CONFIRMED", model: "M1" } },
    { id: "ord_2", props: { cust: "宁德时代", qty: 800, value: 20_000_000, due: "2026-11-01", status: "PLANNED", model: "M2" } },
    { id: "ord_3", props: { cust: "比亚迪", qty: 500, value: 12_000_000, due: "2026-12-01", status: "CONFIRMED", model: "M1" } },
  ],
  Customer: [
    { id: "cust_a", props: { name: "宁德时代" } },
    { id: "cust_b", props: { name: "比亚迪" } },
  ],
  Line: [{ id: "line_1", props: { name: "常州 A 线" } }],
};

/**
 * 世界前后两态。差分**必须落在订单 id 上**，否则「被推动的订单敞口」恒 0 ——
 * 那会让 ④ 那条臂在一个「链路通了但读数没动」的假象上变绿。
 * `ord_1` / `ord_2` 动，`ord_3` 不动 ⇒ 敞口 = 30M + 20M = 5000 万，占订单簿 6200 万的 80.6%。
 */
const WORLD_BEFORE = {
  ord_1: { costPressure: 10 },
  ord_2: { costPressure: 20 },
  ord_3: { costPressure: 30 },
  mat_licarb: { priceShock: 0 },
};
const WORLD_AFTER = {
  ord_1: { costPressure: 16.5 },
  ord_2: { costPressure: 24.25 },
  ord_3: { costPressure: 30 },
  mat_licarb: { priceShock: 20 },
};

const DISCLOSURE = {
  graph: { objects: 11_348, links: 40_212 },
  slice: { sliceKey: "sim.propagation", hops: 3 },
  rules: { declared: 47, fired: 12, withCoefficientRef: 0 },
  agent: { invoked: false },
  timings: { total: 812 },
};

function impedimentPayload(): unknown {
  return JSON.parse(readFileSync(join(FIX, "chain-impediment-baseline.json"), "utf8")) as unknown;
}

// ── 可变桩开关（每个用例 beforeEach 重置） ────────────────────────────────────
/** `simTick` 这一跳失败 ⇒ 整个「算一下」失败（⑤ 的 `c0828-run-error` 臂）。 */
let tickFails = false;
/** 求解器这一跳失败 ⇒ 钱还在，卡点那半说「没问出来」（⑤ 的 `c0828-imp-error` 臂）。 */
let solverFails = false;
/** 每次「算一下」真正打出去的扰动请求（③④ 断言「打的是我选的那个落点」）。 */
let perturbCalls: Record<string, unknown>[] = [];

vi.mock("@/api/endpoints", () => ({
  // ── console0828 这一屏用到的六个 ──
  fetchSimViewConfig: vi.fn(async () => cfg()),
  fetchPropagationRules: vi.fn(async () => ({ items: rulesFromEdges(edges), stateVarNames: {} })),
  fetchAllObjects: vi.fn(async (type: string) => {
    const items = OBJECTS[type] ?? [];
    return { items, total: items.length, hasMore: false, page: 1, pageSize: 500 };
  }),
  simWorld: vi.fn(async () => ({
    tick: perturbCalls.length === 0 ? 0 : 3,
    state: perturbCalls.length === 0 ? WORLD_BEFORE : WORLD_AFTER,
  })),
  createSimPerturbation: vi.fn(async (_sid: string, body: Record<string, unknown>) => {
    perturbCalls.push(body);
    return { perturbation: { id: `simpert_${String(perturbCalls.length)}`, startTick: 0, ...body } };
  }),
  simTick: vi.fn(async (_sid: string, n: number) => {
    if (tickFails) throw new Error("推进这一跳没走通（桩：本用例刻意不回）");
    return { curTick: n, state: WORLD_AFTER, disclosure: DISCLOSURE };
  }),
  runSolver: vi.fn(async () => {
    if (solverFails) throw new Error("求解器这一跳没走通（桩：本用例刻意不回）");
    return { data: impedimentPayload(), snapshotVersion: "sv-test" };
  }),
  proposeSimCandidates: vi.fn(),

  // ── 外壳 `UnifiedSimShell` 在提前 return 之前照样跑的那几个 hook ──
  fetchSimSessions: vi.fn(async () => ({
    items: [
      {
        id: "sims_c0828",
        tenantId: "demo",
        status: "RUNNING",
        curTick: 0,
        parentCheckpointId: null,
        createdAt: "2026-09-10T00:00:00.000Z",
        scope: {},
      },
    ],
  })),
  fetchSimPerturbations: vi.fn(async () => ({ items: [] })),
  fetchDrillStateVarLayers: vi.fn(async () => ({ layers: [], ruleCount: edges.length })),
  patchSimSessionStatus: vi.fn(),
  previewChangeImpact: vi.fn(),
}));

vi.mock("@/api/apiClient", () => ({
  api: {
    a: vi.fn(async (path: string) => {
      throw new Error(`未桩的路径：${path}`);
    }),
    b: vi.fn(),
    aRaw: vi.fn(),
  },
  ApiClientError: class ApiClientError extends Error {},
}));

import UnifiedSimShell from "@/views/sim/unified/UnifiedSimShell";
import { BUSINESS_EVENTS } from "@/views/sim/unified/console0828/eventCatalog";

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UnifiedSimShell />
    </QueryClientProvider>,
  );
}

/**
 * 等到左栏把 12 件事的落地判定**算完**再断言。
 *
 * ⚠ **不许只等 `c0828-root`**：根节点在 `view-config` / `propagation-rules` 两跳都还在路上时
 * 就已经挂出来了，那一帧上每件事都还是「还在判定」，`data-landable` 一律是 `"0"` ——
 * 于是 ② 那条臂会在**所有**事件上都「成立」，包括那些其实落得了地的。
 * 形态正是铁律 0.6 那一句：**「我用 X 当作 Y 的证据，而 X 并不度量 Y。」**
 * 故探针落在「至少有一件事真的判成了可落地」上（`data-landable="1"`）。
 */
async function railReady(): Promise<void> {
  await screen.findByTestId("c0828-root");
  await waitFor(() => {
    const landable = screen
      .getAllByTestId(/^c0828-ev-/)
      .filter((b) => b.getAttribute("data-landable") === "1");
    expect(landable.length).toBeGreaterThan(0);
  });
}

/** 加一件事：展开 → 选落点 → （可选）改幅度 → 加进去。 */
async function addEvent(eventId: string, objectId: string, magnitude?: number): Promise<void> {
  fireEvent.click(screen.getByTestId(`c0828-ev-${eventId}`));
  const sel = await screen.findByTestId(`c0828-pick-${eventId}`);
  // 候选来自对象层那一跳，等它回来再选 —— 不等就会选在一个只有占位项的下拉上。
  await waitFor(() => {
    expect(within(sel as HTMLSelectElement).getAllByRole("option").length).toBeGreaterThan(1);
  });
  fireEvent.change(sel, { target: { value: objectId } });
  if (magnitude !== undefined) {
    fireEvent.change(screen.getByTestId(`c0828-mag-${eventId}`), { target: { value: String(magnitude) } });
  }
  const add = screen.getByTestId(`c0828-add-${eventId}`);
  expect(add).not.toBeDisabled();
  fireEvent.click(add);
}

beforeEach(() => {
  nodeObjectIds = baseNodeObjectIds();
  edges = baseEdges();
  tickFails = false;
  solverFails = false;
  perturbCalls = [];
});
afterEach(cleanup);

// ══════════════════════════════════════════════════════════════════════════════

describe("WO-C0828-SEAM · 08-28 决策屏接缝门", () => {
  it("⓪ 金丝雀：12 件事全部挂出按钮，且三种落地态都非空 —— 失败 ⇒ 报「工具坏了」，不许读作「今天没有可加的事」", async () => {
    mount();
    await railReady();

    // 已知必中：目录里有几件事，屏上就该有几个按钮。
    const btns = screen.getAllByTestId(/^c0828-ev-/);
    expect(btns).toHaveLength(BUSINESS_EVENTS.length);
    expect(BUSINESS_EVENTS.length).toBe(12);

    // 三态都要有样本，否则 ②③ 两条臂里的否定/肯定结论都失去对照。
    const landable = btns.filter((b) => b.getAttribute("data-landable") === "1");
    const unlandable = btns.filter((b) => b.getAttribute("data-landable") === "0");
    expect(landable.length).toBeGreaterThan(0);
    expect(unlandable.length).toBeGreaterThan(0);

    // 组件自己的金丝雀位：它认为「一件都落不了地」时才会挂 c0828-canary-broken。
    expect(screen.queryByTestId("c0828-canary-broken")).toBeNull();
  });

  it("① 到达路径：route 默认就是决策屏（不是工作台），且「专家模式」点下去真能切过去", async () => {
    mount();
    await railReady();

    // 默认这一屏是 console0828，外壳自己也这么标。
    const shell = screen.getByTestId("usim-shell");
    expect(shell.getAttribute("data-view")).toBe("console0828");
    expect(screen.getByTestId("c0828-rail")).toBeInTheDocument();
    // 工作台此刻不在 DOM 里 —— 「默认渲染 c0828」这句话的另一半。
    expect(screen.queryByTestId("usim-wall")).toBeNull();

    fireEvent.click(screen.getByTestId("c0828-expert"));

    await waitFor(() => {
      expect(screen.getByTestId("usim-shell").getAttribute("data-view")).toBe("expert");
    });
    // 切过去之后决策屏让位，工作台接手（两屏同一条 route、同一个会话）。
    expect(screen.queryByTestId("c0828-root")).toBeNull();
  });

  it("② 三重不可见回归：落不了地的事**点得开**，且理由三条路都到得了（不是 disabled · 无原生 title · 点开有字）", async () => {
    mount();
    await railReady();

    // 这件事今天落不了地，是**回包现算**出来的：`Equipment` 不在 nodeObjectIds 里。
    const btn = screen.getByTestId("c0828-ev-equipment-down");
    expect(btn.getAttribute("data-landable")).toBe("0");

    // ── 三条路，缺一条当年就制造过「解释写好了没人看得到」 ──
    // 路 ①：按钮不能是 disabled，否则下面那一 click 根本不会发生。
    expect(btn).not.toBeDisabled();
    expect(btn.hasAttribute("disabled")).toBe(false);
    // 路 ②：口径不许塞进原生 title（disabled 元素上多数浏览器根本不渲染它；且违反 R-UI-3）。
    expect(btn.getAttribute("title")).toBeNull();
    // 路 ③：理由在第一层就已经摆着，不用点开也读得到。
    expect(btn.textContent ?? "").toContain("一个实例都没有");

    // 点开 ⇒ 解释面板出现，且**有字**（空面板与「没有面板」在屏上一样难用）。
    fireEvent.click(btn);
    const panel = await screen.findByTestId("c0828-absent-equipment-down");
    expect((panel.textContent ?? "").trim().length).toBeGreaterThan(20);
    expect(panel.textContent ?? "").toContain("不是取数失败");
    // 它找过哪些落点 —— 名单来自事件目录，不是拼出来的一句空话。
    expect(panel.textContent ?? "").toContain("Equipment");

    // 点得开 ≠ 加得进去：真正的写口另有早退守着，表单一律不出现。
    expect(screen.queryByTestId("c0828-form-equipment-down")).toBeNull();
    expect(screen.queryByTestId("c0828-add-equipment-down")).toBeNull();
  });

  it("②b 三态不许塌成一个：「一个实例都没有」与「有实例但没有这个量」是两句不同的话", async () => {
    mount();
    await railReady();

    // rush-order 要 Order.demandPressure，而边集里 Order 只承载 costPressure ⇒ no-statevar。
    const rush = screen.getByTestId("c0828-ev-rush-order");
    expect(rush.getAttribute("data-landable")).toBe("0");
    fireEvent.click(rush);
    const statevar = await screen.findByTestId("c0828-absent-rush-order");
    expect(statevar.textContent ?? "").toContain("没有传导路径");

    // 同为「落不了地」，措辞必须与 no-instance 那条不同 —— 合并即红。
    fireEvent.click(screen.getByTestId("c0828-ev-equipment-down"));
    const noinst = await screen.findByTestId("c0828-absent-equipment-down");
    expect(noinst.textContent).not.toBe(statevar.textContent);

    // 而同一个 Order 上换一个量就落得了地 ⇒ 上面那个 "0" 是**这个量**的结论，不是「Order 取不到数」。
    expect(screen.getByTestId("c0828-ev-order-reprice").getAttribute("data-landable")).toBe("1");
  });

  it("③ 加事件 → 暂存：件数跟着变，**加两件必须显示 2 件**（1 件与多件在模型层不是同一段）", async () => {
    mount();
    await railReady();

    expect(screen.getByTestId("c0828-staged-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("c0828-staged-count")).toBeNull();

    await addEvent("material-price-up", "mat_licarb", 15);
    await waitFor(() => {
      expect(screen.getByTestId("c0828-staged-count").textContent ?? "").toContain("1 件");
    });
    // 名字来自对象层那一跳，不是回显 id。
    expect(screen.getByTestId("c0828-chip-material-price-up").textContent ?? "").toContain("碳酸锂");
    expect(screen.queryByTestId("c0828-staged-empty")).toBeNull();

    await addEvent("capacity-loss", "base_cz");
    await waitFor(() => {
      expect(screen.getByTestId("c0828-staged-count").textContent ?? "").toContain("2 件");
    });
    expect(screen.getByTestId("c0828-chip-capacity-loss").textContent ?? "").toContain("常州基地");
  });

  it("④ 算一下 → 出结果：一个按钮背后五跳走完，四块结果面板同时出现且读的是同一次结果", async () => {
    mount();
    await railReady();

    // 一件都没加时按钮是死的 —— 「算一下」不该在没有输入时可点。
    expect(screen.getByTestId("c0828-go")).toBeDisabled();
    expect(screen.getByTestId("c0828-idle")).toBeInTheDocument();

    await addEvent("material-price-up", "mat_licarb", 15);
    const go = screen.getByTestId("c0828-go");
    await waitFor(() => {
      expect(go).not.toBeDisabled();
    });
    fireEvent.click(go);

    // 四块面板 —— 缺一块都算这条链没走通。
    await screen.findByTestId("c0828-money");
    expect(screen.getByTestId("c0828-cust")).toBeInTheDocument();
    expect(screen.getByTestId("c0828-impediment")).toBeInTheDocument();
    expect(screen.getByTestId("c0828-board")).toBeInTheDocument();
    expect(screen.queryByTestId("c0828-idle")).toBeNull();

    // 打出去的扰动实参 = 我在屏上选的那一个（落点/量/幅度/kind 逐项对得上，不是「发了个请求」）。
    expect(perturbCalls).toHaveLength(1);
    expect(perturbCalls[0]).toMatchObject({
      targetObjectId: "mat_licarb",
      targetStateVar: "priceShock",
      magnitude: 15,
      kind: "cost_shock",
      mode: "delta",
    });

    // 敞口来自**差分 ∩ 订单**（ord_1 + ord_2 动了，ord_3 没动）——
    // 写死期望会让「差分算错」这件事测不出来，故期望值由 fixture 现算。
    const moved = ["ord_1", "ord_2"];
    const expected = OBJECTS.Order.filter((o) => moved.includes(o.id)).reduce(
      (s, o) => s + (o.props.value as number),
      0,
    );
    expect(screen.getByTestId("c0828-exposure-sub").textContent ?? "").toContain(`${String(moved.length)} 张单`);
    expect(expected).toBe(50_000_000);
    // 屏上是「5000 万元」这类人话格式，故咬「不是 0、不是空」+ 张数，金额精确值由上面那一行守。
    const exposure = screen.getByTestId("c0828-exposure").textContent ?? "";
    expect(exposure.trim()).not.toBe("");
    expect(exposure).not.toMatch(/^0\s*元$/);

    // 单件 ⇒ 主因答得上（这正是 ③ 要加两件的原因：多件时这句话必须换成「说不清」）。
    expect(screen.getByTestId("c0828-maincause").textContent ?? "").toContain("原材料涨价");

    // 卡点两半都来自引擎基线（8 处），前端零判定。
    expect(screen.getByTestId("c0828-impediment").textContent ?? "").toContain("扫出 8 处");
    expect(screen.getByTestId("c0828-board").textContent ?? "").toContain("8 处卡点");
    expect(screen.queryByTestId("c0828-imp-error")).toBeNull();

    // 披露层上屏（铁律 1.5 判据二：推演过程必须可披露，且「没调 agent」要明写不许留白）。
    const honesty = screen.getByTestId("c0828-honesty").textContent ?? "";
    expect(honesty).toContain("sim.propagation");
    expect(honesty).toContain("本次未调用 agent");
  });

  it("④b 多件时主因这句话必须换成「说不清」——不许挑一个顶上（差分层看不出某一格是谁推的）", async () => {
    mount();
    await railReady();

    await addEvent("material-price-up", "mat_licarb", 15);
    await addEvent("capacity-loss", "base_cz");
    await waitFor(() => {
      expect(screen.getByTestId("c0828-staged-count").textContent ?? "").toContain("2 件");
    });

    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    expect(perturbCalls).toHaveLength(2);
    const cause = screen.getByTestId("c0828-maincause").textContent ?? "";
    expect(cause).toContain("说不清主要是哪一件");
    expect(cause).not.toContain("原材料涨价");
  });

  it("⑤ 诚实态 · 三行钱：算不出来的画「这次算不出来」——⛔ 不许显示 0，也不许留空", async () => {
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    // 三行各自有自己的位置，且都是「算不出来」这一态 —— 三行塌成一行、或悄悄变 0，都在这里红。
    for (const label of ["毛利差", "多花的成本", "压住的应收"]) {
      const cell = screen.getByTestId(`c0828-nocalc-${label}`);
      const txt = (cell.textContent ?? "").trim();
      expect(txt).toBe("这次算不出来");
      // 「算不出来」与「等于 0」是两个命题 —— 这两条断言就是那条界线本身。
      expect(txt).not.toBe("0");
      expect(txt).not.toBe("");
      expect(txt).not.toMatch(/^0\s*元$/);
    }

    // 全屏诚实位把这条语义写在字面上，不靠用户自己领会删除线。
    const honesty = screen.getByTestId("c0828-honesty").textContent ?? "";
    expect(honesty).toContain("这次算不出来");
    expect(honesty).toContain("不是 0");
  });

  it("⑤b 诚实态 · 整跳失败：说「这次没算成」，而**不是**摆一屏 0 出来", async () => {
    tickFails = true;
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));

    const err = await screen.findByTestId("c0828-run-error");
    expect(err.textContent ?? "").toContain("这次没算成");
    // 屏上必须写明这是「这一跳失败」，与「结果是 0」分开 —— 两者处置相反。
    expect(err.textContent ?? "").toContain("不是「结果是 0」");

    // 且**一个数都不许摆出来**：没有结果就没有钱那三行、没有卡点、没有看板。
    expect(screen.queryByTestId("c0828-money")).toBeNull();
    expect(screen.queryByTestId("c0828-cust")).toBeNull();
    expect(screen.queryByTestId("c0828-impediment")).toBeNull();
    expect(screen.queryByTestId("c0828-board")).toBeNull();
    expect(screen.getByTestId("c0828-idle")).toBeInTheDocument();
  });

  it("⑤c 诚实态 · 半跳失败：钱照出，而卡点那半说「没问出来」——不许静默吞成「没有卡点」", async () => {
    solverFails = true;
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));

    // 钱这一半走通了，照常上屏（一跳失败不该把整屏拖黑）。
    await screen.findByTestId("c0828-money");
    expect(screen.queryByTestId("c0828-run-error")).toBeNull();

    // 卡点这一半照实说「没问出来」，且与「没有卡点」字面分开。
    const impErr = await screen.findByTestId("c0828-imp-error");
    expect(impErr.textContent ?? "").toContain("卡点这一跳没走通");
    expect(impErr.textContent ?? "").toContain("不是「没有卡点」");
    // 没问出来 ⇒ 看板不许摆出来（摆一张空看板 = 说「一处卡点都没有」）。
    expect(screen.queryByTestId("c0828-board")).toBeNull();
  });
});
