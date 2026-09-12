import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropagationRule, SandboxViewConfig } from "@platform/contracts";
// WO-ORDER-SCOPE · 在手口径的判据取自契约单一出处，⛔ 测试里不另抄一份状态字面量清单。
import { isOnHandOrderStatus, ORDER_STATUSES } from "@platform/contracts";

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

/**
 * 订单簿。**单独具名**（而不是只活在 `OBJECTS.Order` 里）——
 * 本包开了 `noUncheckedIndexedAccess`，`OBJECTS.Order` 取出来是 `T | undefined`，
 * 用例里要拿它现算期望值就得先判空。具名之后期望值是从**同一份 fixture** 算出来的，
 * 而不是另抄一个字面量：抄一份就等于「期望值和被测数据各自漂」，改了 fixture 测试照样绿。
 */
const ORDERS: { id: string; props: Record<string, unknown> }[] = [
  { id: "ord_1", props: { cust: "宁德时代", qty: 1200, value: 30_000_000, due: "2026-10-01", status: "IN_PRODUCTION", model: "M1" } },
  { id: "ord_2", props: { cust: "宁德时代", qty: 800, value: 20_000_000, due: "2026-11-01", status: "OPEN", model: "M2" } },
  { id: "ord_3", props: { cust: "比亚迪", qty: 500, value: 12_000_000, due: "2026-12-01", status: "OPEN", model: "M1" } },
  /**
   * WO-ORDER-SCOPE · **这一张单是本单全部断言的判别器，⛔ 不许删、不许改状态。**
   *
   * 它同时满足两件事：**已交付关闭** ＋ **在世界差分里真的动了**（见 `WORLD_AFTER.ord_4`）。
   * 只有同时满足这两件，「有没有按在手口径过滤」才在读数上分得开：
   *   · 过滤了 ⇒ 受影响 **2** 张 / 敞口 **5000 万** / 基数 **6200 万**
   *   · 没过滤 ⇒ 受影响 **3** 张 / 敞口 **6200 万** / 基数 **7400 万**
   * ⚠ 若把它写成「已完成且没动」，两种实现给出的读数**完全相同** ——
   *   测试照样全绿，而 bug 原封不动。本仓把这种测试叫「咬不到东西的门」。
   */
  { id: "ord_4", props: { cust: "比亚迪", qty: 400, value: 12_000_000, due: "2026-05-01", status: "COMPLETED", model: "M1" } },
];

/**
 * 在手口径下**可被影响**的那几张（= 契约 `ON_HAND_ORDER_STATUSES`）。
 * 期望值一律从这里现算，⛔ 不写字面量 —— 改了 fixture 而期望值不动，就是「期望值与被测数据各自漂」。
 */
const ON_HAND_ORDERS = ORDERS.filter((o) => isOnHandOrderStatus(o.props.status));

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
  Order: ORDERS,
  Customer: [
    { id: "cust_a", props: { name: "宁德时代" } },
    { id: "cust_b", props: { name: "比亚迪" } },
  ],
  Line: [{ id: "line_1", props: { name: "常州 A 线" } }],
};

/**
 * 世界前后两态。差分**必须落在订单 id 上**，否则「被推动的订单敞口」恒 0 ——
 * 那会让 ④ 那条臂在一个「链路通了但读数没动」的假象上变绿。
 * `ord_1` / `ord_2` 动，`ord_3` 不动 ⇒ 敞口 = 30M + 20M = 5000 万，占**在手**订单簿 6200 万的 80.6%。
 *
 * ⚠ WO-ORDER-SCOPE 加了 `ord_4`：**已交付关闭，但读数照样动**。
 *   这不是凑数 —— 推演引擎不认识「在手」这个业务口径，它本来就会去推已完成单的格子，
 *   所以这里必须如实模拟那个行为，否则测的是一个后端不会产生的世界。
 *   过滤对不对，全靠这一格分辨：它**动了**但**不该被算进受影响订单**。
 */
const WORLD_BEFORE = {
  ord_1: { costPressure: 10 },
  ord_2: { costPressure: 20 },
  ord_3: { costPressure: 30 },
  ord_4: { costPressure: 40 },
  mat_licarb: { priceShock: 0 },
};
const WORLD_AFTER = {
  ord_1: { costPressure: 16.5 },
  ord_2: { costPressure: 24.25 },
  ord_3: { costPressure: 30 },
  ord_4: { costPressure: 51.75 },
  mat_licarb: { priceShock: 20 },
};

const DISCLOSURE = {
  graph: { objects: 11_348, links: 40_212 },
  slice: { sliceKey: "sim.propagation", hops: 3 },
  rules: { declared: 47, fired: 12, withCoefficientRef: 0 },
  agent: { invoked: false },
  timings: { total: 812 },
};

/**
 * 卡点载荷。基线 fixture **一个字节都不改**（仓主 2026-08-20 禁令 3：不新增基线 JSON），
 * 要对策时就地给前两处各挂一条 —— 形状逐字段抄自真引擎回包
 * （本单实测 `POST /a/v1/solvers/chain_impediments/invoke` 的
 * `cand_…_Material.leadTime_pos_lfp_PEER_BEST_10`），不是我想出来的结构。
 */
function impedimentPayload(): unknown {
  const raw = JSON.parse(readFileSync(join(FIX, "chain-impediment-baseline.json"), "utf8")) as {
    impediments: { impedimentId: string; locus: { objectType: string; objectId: string }; candidates: unknown[] }[];
  };
  if (!withCandidates) return raw;
  for (const im of raw.impediments.slice(0, 2)) {
    im.candidates = [
      {
        candidateId: `cand_${im.impedimentId}_lead`,
        impedimentId: im.impedimentId,
        label: `物料·到货周期 ↓ 10（${im.locus.objectId}）`,
        lever: {
          objectType: "Material", objectId: im.locus.objectId, prop: "leadTime",
          factorName: "物料到货", factorMark: "⑮", grain: "model-material", unit: "天", valueKind: "days",
        },
        fromValue: 26, toValue: 10,
        join: { kind: "LINK_HOP", path: "batch_replenishes_material: MaterialBatch→Material" },
        rungKind: "PEER_BEST",
        rungSource: "同侪 Material.leadTime 真实极值（最小） 10",
        effectKind: "DOWNSTREAM_ONLY",
        // ⚠ `dims` 至少要有**一维真的动了**（契约 `superRefine`：不动的不是方案）——
        //    第一版我把 value 与 baseline 写成同一个数，`ChainImpedimentPayloadSchema.parse()`
        //    当场抛，屏上退成「卡点识别未完成」，而我差点把它读成「注入没生效」。
        dims: [
          { key: "breach", label: "超阈幅度（Batch.idleDays）", value: 19, baseline: 19, unit: "天", betterWhen: "lower", dataMode: "SYNTHETIC" },
          { key: "capacityP50", label: "产能 cellsPerDayP50 合计（电芯/日）", value: 36_603_161.75, baseline: 32_081_231.89, unit: "电芯/日", betterWhen: "higher", dataMode: "SYNTHETIC" },
        ],
        provenance: {
          solverKey: "chain_impediments",
          formula: "patchCapacityContext(Material.leadTime: 26→10) → 判据重算 + Σ cellsPerDayP50 重算",
          inputs: ["Material.leadTime", "Batch.idleDays", "rule:C28"],
        },
        dataMode: "SYNTHETIC",
      },
    ];
  }
  return raw;
}

// ── 可变桩开关（每个用例 beforeEach 重置） ────────────────────────────────────
/** `simTick` 这一跳失败 ⇒ 整个「算一下」失败（⑤ 的 `c0828-run-error` 臂）。 */
let tickFails = false;
/** 求解器这一跳失败 ⇒ 钱还在，卡点那半说「没问出来」（⑤ 的 `c0828-imp-error` 臂）。 */
let solverFails = false;
/** 每次「开始推演」真正打出去的扰动请求（③④ 断言「打的是我选的那个落点」）。 */
let perturbCalls: Record<string, unknown>[] = [];
/**
 * 会话的 `tickDays`（`null` = 回包里压根没有这一格 ⇒ 契约「缺省 1」）。
 * ⑥ 的对照实验就是拨它：**同一条会话、同一个第 6 拍，`tickDays` 1 vs 3 必须给出不同的日期**。
 */
let sessionTickDays: number | null = null;
/** 会话创建日 —— 第 0 拍那一天。`null` ⇒ 取不到，屏上必须退回「第 N 拍」而**不是编一个今天**。 */
let sessionCreatedAtRaw: string | null = "2026-09-10T00:00:00.000Z";
/** 卡点载荷要不要带对策（基线 8 处全是 0 对策 ⇒ 四栏面板根本不渲染，⑦ 就没东西可咬）。 */
let withCandidates = false;

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
        ...(sessionCreatedAtRaw === null ? {} : { createdAt: sessionCreatedAtRaw }),
        ...(sessionTickDays === null ? {} : { tickDays: sessionTickDays }),
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
// `fmtMoney` 一并取来：期望串由**屏上同一个格式化函数**现算，⛔ 不手敲「6200 万」——
// 手敲的那种串只要格式化改一次小数位就假红，而它并不度量口径对不对（WO-ORDER-SCOPE 实测踩过）。
import {
  MONEY_BREAKDOWN_LABELS,
  fmtMoney,
  splitOrderScope,
} from "@/views/sim/unified/console0828/console0828Model";

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
  sessionTickDays = null;
  sessionCreatedAtRaw = "2026-09-10T00:00:00.000Z";
  withCandidates = false;
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
    expect(btn.textContent ?? "").toContain("无任何实例");

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
    expect(statevar.textContent ?? "").toContain("无传导路径");

    // ⚠ 左栏一次只展开一件事 ⇒ 先把这一句取下来再去点下一件，否则它的面板已经收走了。
    const whyStateVar = screen.getByTestId("c0828-absent-why-rush-order").textContent ?? "";

    // 同为「落不了地」，措辞必须与 no-instance 那条不同 —— 合并即红。
    fireEvent.click(screen.getByTestId("c0828-ev-equipment-down"));
    const noinst = await screen.findByTestId("c0828-absent-equipment-down");
    /**
     * ⚠ **咬「那句措辞」本身，不咬整块面板**（本单实测修正的一处假绿）：
     * 整块面板里还混着「它找过哪些落点」那段**逐事件明细**，两个事件的明细天然不同 ⇒
     * 把两条措辞改成**一模一样**，`noinst.textContent !== statevar.textContent` **仍然成立**，
     * 门全绿。变异反证当场抖出来的：把 `LANDING_ABSENCE_TEXT` 两条改成同一句 ⇒ 14/14 全过。
     * 形态（铁律 0.6 句式）：
     * 「我用『两块面板的文本不相等』当作『两种措辞不一样』的证据，而前者并不度量后者。」
     * 故改咬 `c0828-absent-why-*` —— 那个锚点上**只有**那一句措辞。
     */
    const whyNoInst = screen.getByTestId("c0828-absent-why-equipment-down").textContent ?? "";
    expect(whyStateVar.trim().length).toBeGreaterThan(10);
    expect(whyNoInst.trim().length).toBeGreaterThan(10);
    expect(whyNoInst).not.toBe(whyStateVar);
    // 两句各自的**可判定内核**也要在（只比"不相等"的话，改一个标点就能骗过去）。
    expect(whyNoInst).toContain("无任何实例");
    expect(whyStateVar).toContain("无传导路径");
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

    // 敞口来自**差分 ∩ 在手订单**（ord_1 + ord_2 动了；ord_3 没动；
    // **ord_4 动了但已交付关闭 ⇒ 不算**，WO-ORDER-SCOPE）——
    // 写死期望会让「差分算错」这件事测不出来，故期望值由 fixture 现算。
    const moved = ["ord_1", "ord_2"];
    const expected = ORDERS.filter((o) => moved.includes(o.id)).reduce(
      (s, o) => s + (o.props.value as number),
      0,
    );
    // ⚠ 这一行就是本单的**变异反证锚点**：把在手过滤去掉，ord_4 会被数进来 ⇒ 屏上变「3 张单」⇒ 本行必红。
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
    expect(screen.getByTestId("c0828-board").textContent ?? "").toContain("8 处受阻环节");
    expect(screen.queryByTestId("c0828-imp-error")).toBeNull();

    // 披露层上屏（铁律 1.5 判据二：推演过程必须可披露，且「没调 agent」要明写不许留白）。
    const honesty = screen.getByTestId("c0828-honesty").textContent ?? "";
    expect(honesty).toContain("sim.propagation");
    expect(honesty).toContain("本次未调用 agent");
  });

  it("④c WO-ORDER-SCOPE · 影响面只算在手单：已交付关闭的单**动了也不算**，且口径必须上屏", async () => {
    /* ── 今天的行为是 X（仓主 2026-09-12 在真屏上抓到）──
     *   「我输入一个扰动因素，结果反馈**影响 500 张订单**。这个是错的，
     *    **不应该影响已经完成的订单**，**进行中订单也需要分析是否计算在里面**。」
     *   真后端实测：全簿 500 = COMPLETED 350 + IN_PRODUCTION 100 + OPEN 50。
     * ── 应该是 Y ──
     *   基数 = 契约 `ON_HAND_ORDER_STATUSES`（OPEN + IN_PRODUCTION）= 150 张；
     *   COMPLETED 不算（货已交钱已结），IN_PRODUCTION 算（货没交钱没结，仍在手）。
     *   且**口径要看得见** —— 静默过滤掉 350 张与当初把它们算进来，同样是不诚实。 */

    // ── 🐤 金丝雀先行：夹具里三档都得在，否则这条用例什么也分辨不了 ──
    // 不中 ⇒ 报「夹具坏了」，⛔ 不许把绿读作「过滤是对的」。
    expect(ORDER_STATUSES.length).toBe(3); // 契约仍是三态；长出第 4 态 ⇒ `splitOrderScope` 的档名要重新审
    expect(ON_HAND_ORDERS).toHaveLength(3); // ord_1 IN_PRODUCTION + ord_2/ord_3 OPEN
    expect(ORDERS).toHaveLength(4); // 多出来的那张就是 ord_4（COMPLETED）
    const completed = ORDERS.filter((o) => !isOnHandOrderStatus(o.props.status));
    expect(completed.map((o) => o.id)).toEqual(["ord_4"]);
    // 判别器成立的前提：ord_4 **在差分里真的动了**。它若不动，本用例两种实现都会绿。
    expect(WORLD_AFTER.ord_4.costPressure).not.toBe(WORLD_BEFORE.ord_4.costPressure);

    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    // ① 主数：被推动的 3 张里只认在手的 2 张 —— ord_4 动了，但不进这个数。
    const sub = screen.getByTestId("c0828-exposure-sub").textContent ?? "";
    expect(sub).toContain("2 张单");
    expect(sub).not.toContain("3 张单");

    // ② 金额跟着同一个口径走：敞口 = 30M + 20M，**不含** ord_4 的 12M；
    //    基数 = 在手三张 62M，**不是**全簿 74M。金额那条路没跟着改的话，这里会红。
    const onHandBook = ON_HAND_ORDERS.reduce((s, o) => s + (o.props.value as number), 0);
    const fullBook = ORDERS.reduce((s, o) => s + (o.props.value as number), 0);
    const expectedExposure = ORDERS.filter((o) => ["ord_1", "ord_2"].includes(o.id)).reduce(
      (s, o) => s + (o.props.value as number),
      0,
    );
    expect(onHandBook).toBe(62_000_000);
    expect(fullBook).toBe(74_000_000);
    expect(expectedExposure).toBe(50_000_000);
    const recon = screen.getByTestId("c0828-recon").textContent ?? "";
    expect(recon).toContain(fmtMoney(onHandBook, "元")); // 在手基数上屏
    expect(recon).not.toContain(fmtMoney(fullBook, "元")); // 全簿基数⛔ 不许当基数
    expect(recon).toContain(fmtMoney(expectedExposure, "元")); // 敞口仍是在手那两张
    // 基数那句话必须明写是「在手」，否则读者会把 6200 万当成全簿。
    expect(recon).toContain("在手订单簿合计");

    // ③ 受影响客户同源：ord_4 是比亚迪的单，它动了但不算 ⇒ 比亚迪不算被波及。
    //    分母也走在手口径（比亚迪仍有在手单 ord_3，故仍是 2 家）。
    const custPanel = screen.getByTestId("c0828-cust").textContent ?? "";
    expect(custPanel).toContain("1 / 2 家");

    // ④ 口径必须**看得见**（仓主要的是「分析是否计算在里面」，不是默默过滤）：
    //    被排除的张数点名上屏，且说清在手的构成。
    const note = screen.getByTestId("c0828-scope-note").textContent ?? "";
    expect(note).toContain("已交付关闭 1 张不计入");
    expect(note).toContain("在手单 3 张");

    // ⑤ 状态分布那一格的基数仍是**全簿** —— 那 1 张已完成单必须还看得见。
    //    过滤若把它从屏上抹掉，就从「算错」变成了「删除」，比原 bug 更坏。
    expect(screen.getByTestId("c0828-status-COMPLETED").textContent ?? "").toContain("1");
    expect(screen.getByTestId("c0828-cust").textContent ?? "").toContain(`全簿 ${String(ORDERS.length)} 张单的状态分布`);
  });

  it("④d WO-ORDER-SCOPE · 状态不认识的单落「判不了」，⛔ 不许被静默并进「不受影响」", () => {
    /* ── 为什么必须单独咬这一条 ──
     * 真后端今天三态齐全、`unknown` 恒为 0，上面那条用例也构造不出它 ⇒
     * 这个分支属于本仓说的「**接了线没数据**」态：写了、但从没被触发过，
     * 于是「它对不对」这件事一次都没被验过。这里用纯函数把它**当场触发**。
     *
     * ── 它为什么危险（不是洁癖）──
     * `isOnHandOrderStatus` 对任何不认识的值（含 null）返回 false。若只切两档，
     * 后端哪天把状态改个名，那批单会被**静默并进「不算」那一侧** ⇒
     * 屏上读作「没有受影响的订单」，而真相是「我判不了」。
     * 本仓已为同一个陷阱记过账：`chain-loss-matrix.ts` 注释原文
     * 「`isOnHandOrderStatus(undefined)` 恒假 ⇒ 每一列敞口都会变成 0」。 */
    const row = (id: string, status: string | null) =>
      ({ id, cust: "某客户", qty: 1, value: 1_000_000, due: null, status, model: null });

    // 🐤 金丝雀：先证明这把尺子对**认识**的状态是准的，再拿它去判「不认识」。
    const known = splitOrderScope([row("a", "OPEN"), row("b", "IN_PRODUCTION"), row("c", "COMPLETED")]);
    expect([known.open, known.inProduction, known.completed, known.unknown]).toEqual([1, 1, 1, 0]);
    expect(known.onHand).toHaveLength(2);

    // 正题：改名后的串、以及 null，都必须落 `unknown`——
    // ⛔ 既不许算进在手（那会虚报敞口），也不许算进已完成（那会假装「已经判过了」）。
    const weird = splitOrderScope([row("d", "CONFIRMED"), row("e", "PLANNED"), row("f", null)]);
    expect(weird.unknown).toBe(3);
    expect(weird.onHand).toHaveLength(0);
    expect(weird.completed).toBe(0); // ← 这一条就是「静默并进另一边」的反证
    expect(weird.open + weird.inProduction).toBe(0);

    // 三档必须恒等于全簿，一张都不许在分档中蒸发。
    for (const s of [known, weird]) {
      expect(s.onHand.length + s.completed + s.unknown).toBe(s.all.length);
    }
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
    expect(cause).toContain("无法归因到单一事件");
    expect(cause).not.toContain("原材料涨价");
  });

  it("⑤ 诚实态 · 三行钱：算不出来的画「这次算不出来」——⛔ 不许显示 0，也不许留空", async () => {
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    // 三行各自有自己的位置，且都是「算不出来」这一态 —— 三行塌成一行、或悄悄变 0，都在这里红。
    // ⚠ 栏目名从**被测代码的单源**取（`MONEY_BREAKDOWN_LABELS`），⛔ 不在这里另抄一份数组 ——
    //   抄一份就是「期望值与被测数据各自漂」，改了一边照样绿。
    expect(MONEY_BREAKDOWN_LABELS).toHaveLength(3);
    for (const label of MONEY_BREAKDOWN_LABELS) {
      const cell = screen.getByTestId(`c0828-nocalc-${label}`);
      const txt = (cell.textContent ?? "").trim();
      expect(txt).toBe("本次无法计算");
      // 「算不出来」与「等于 0」是两个命题 —— 这两条断言就是那条界线本身。
      expect(txt).not.toBe("0");
      expect(txt).not.toBe("");
      expect(txt).not.toMatch(/^0\s*元$/);
    }

    // 全屏诚实位把这条语义写在字面上，不靠用户自己领会删除线。
    const honesty = screen.getByTestId("c0828-honesty").textContent ?? "";
    expect(honesty).toContain("本次无法计算");
    expect(honesty).toContain("不是 0");
  });

  it("⑤b 诚实态 · 整跳失败：说「这次没算成」，而**不是**摆一屏 0 出来", async () => {
    tickFails = true;
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));

    const err = await screen.findByTestId("c0828-run-error");
    expect(err.textContent ?? "").toContain("本次推演未完成");
    // 屏上必须写明这是「这一跳失败」，与「结果是 0」分开 —— 两者处置相反。
    expect(err.textContent ?? "").toContain("不是「结果为 0」");

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
    expect(impErr.textContent ?? "").toContain("卡点识别未完成");
    expect(impErr.textContent ?? "").toContain("不是「无卡点」");
    // 没问出来 ⇒ 看板不许摆出来（摆一张空看板 = 说「一处卡点都没有」）。
    expect(screen.queryByTestId("c0828-board")).toBeNull();
  });

  /* ════════════════════════════════════════════════════════════════════════════
   * ⑥ 拍 → 真实日期（WO-C0828-VOICE · 仓主 2026-09-11「从几拍太模糊了，为何不调整为日期」）
   * ════════════════════════════════════════════════════════════════════════════
   * **铁律 1.5 判据一要的那条对照实验**：不是「跑得起来吗」，而是
   * 「当我把 `tickDays` 从 1 改成 3，第 N 拍的日期必须按可预言的方式变化」。
   * 判据：`Δ = N × (3 − 1)` 天。四个数（两种 tickDays × 第 0 拍 / 第 6 拍）缺一个不算交付。
   * ⚠ 用 UTC 日历日算期望值，不走本地时区 —— 否则这条门在 CI 与本机会各说一套。
   */
  const D0 = Date.parse("2026-09-10T00:00:00.000Z");
  const iso = (days: number): string => new Date(D0 + days * 86_400_000).toISOString().slice(0, 10);

  async function tickTextAt(td: number | null, horizonTicks: number): Promise<string> {
    // ⚠ 两次量测在**同一个用例**里，而 `beforeEach` 只在用例之间跑 ——
    //    不清零的话第二次 `simWorld` 会按「已经施过扰动」回 tick 3，
    //    于是「第 0 拍」那两个数就不是第 0 拍了（第一版实测正是栽在这里）。
    perturbCalls = [];
    sessionTickDays = td;
    mount();
    await railReady();
    fireEvent.change(screen.getByTestId("c0828-horizon"), { target: { value: String(horizonTicks) } });
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");
    return screen.getByTestId("c0828-tl-head").textContent ?? "";
  }

  it("⑥ 对照实验 · tickDays 1 vs 3：同一个第 6 拍必须给出不同日期，且差值 = 6×(3−1) = 12 天", async () => {
    // 桩里 `simTick` 回 `curTick = n` ⇒ 推 6 拍后终点就是第 6 拍，起点第 0 拍。
    const t1 = await tickTextAt(1, 6);
    cleanup();
    const t3 = await tickTextAt(3, 6);

    // 四个数，逐个写出来（缺一个不算交付）。
    const d0_td1 = iso(0);            // tickDays=1 · 第 0 拍
    const d6_td1 = iso(6 * 1);        // tickDays=1 · 第 6 拍
    const d0_td3 = iso(0);            // tickDays=3 · 第 0 拍（起点与 tickDays 无关）
    const d6_td3 = iso(6 * 3);        // tickDays=3 · 第 6 拍
    expect([d0_td1, d6_td1, d0_td3, d6_td3]).toEqual(["2026-09-10", "2026-09-16", "2026-09-10", "2026-09-28"]);

    expect(t1).toContain(d0_td1);
    expect(t1).toContain(d6_td1);
    expect(t3).toContain(d0_td3);
    expect(t3).toContain(d6_td3);

    // 这一条才是对照实验本身：**换了口径，屏上的数必须真的跟着变**。
    expect(d6_td3).not.toBe(d6_td1);
    expect((Date.parse(d6_td3) - Date.parse(d6_td1)) / 86_400_000).toBe(12);
    expect(t3).not.toContain(d6_td1);

    // 「拍」不许被日期挤掉 —— 引擎收发的量就是拍，两层对不上账时要靠它追。
    expect(t1).toContain("第 6 拍");
    expect(t3).toContain("第 6 拍");
  });

  it("⑥b 取不到起始日 ⇒ 退回「第 N 拍」并说明，⛔ 不许编一个今天顶上", async () => {
    sessionCreatedAtRaw = null;
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    const head = screen.getByTestId("c0828-tl-head").textContent ?? "";
    expect(head).toContain("第 0 拍");
    // 「没取到」与「没有」是两个命题，且都不许变成一个编出来的日期。
    expect(head).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const why = screen.getByTestId("c0828-tl-calibre").textContent ?? "";
    expect(why.trim().length).toBeGreaterThan(10);
    expect(why).toContain("按拍显示");
    // 今天的日期一个字都不许出现 —— 这正是「编一个今天顶上」的指纹。
    expect(why).not.toContain(new Date().toISOString().slice(0, 10));
  });

  /* ════════════════════════════════════════════════════════════════════════════
   * ⑦ 「N 种对策 ▸」点了要有反应（仓主实拍：点了没反应）
   * ════════════════════════════════════════════════════════════════════════════
   * 三条病因叠在一起，故断言也咬三条：面板**标题跟着选择走** · 选中态在按钮上
   * （`aria-pressed`）· **点默认那一项也算数**（它原本是「`picked` 前后完全相同」那一条）。
   * 变异反证：把 `setPickedFix` 改成空函数 ⇒ 本用例第一条断言必红。
   */
  it("⑦ 对策面板跟着选择走：点 A 标题是 A，点 B 变成 B，且选中态落在按钮上", async () => {
    withCandidates = true;
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    // 载荷里前两处带了对策 ⇒ 两条可选，够做 A/B 对照（一条的话这条臂等于没跑）。
    const buttons = screen.getAllByTestId(/^c0828-fixbtn-/);
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const [btnA, btnB] = buttons as [HTMLElement, HTMLElement];
    const idA = (btnA.getAttribute("data-testid") ?? "").replace("c0828-fixbtn-", "");
    const idB = (btnB.getAttribute("data-testid") ?? "").replace("c0828-fixbtn-", "");
    expect(idA).not.toBe(idB);

    // 默认就画着第一处 ⇒ 选中态必须**一进来就标在它头上**，
    // 否则屏上会出现「面板画着 A，而 A 没被标选中」这种自相矛盾。
    expect(btnA.getAttribute("aria-pressed")).toBe("true");
    expect(btnB.getAttribute("aria-pressed")).toBe("false");

    // ⚠ 点**默认那一项**：`picked` 前后相同，但反馈不许因此消失。
    fireEvent.click(btnA);
    await waitFor(() => {
      expect(screen.getByTestId("c0828-fixbtn-" + idA).getAttribute("aria-pressed")).toBe("true");
    });
    const tagA = screen.getByTestId("c0828-options-tag").textContent ?? "";

    // 点 B ⇒ 面板**真的换了一处**（标题与辨识串同时变）。
    fireEvent.click(screen.getByTestId("c0828-fixbtn-" + idB));
    await waitFor(() => {
      expect(screen.getByTestId("c0828-fixbtn-" + idB).getAttribute("aria-pressed")).toBe("true");
    });
    expect(screen.getByTestId("c0828-fixbtn-" + idA).getAttribute("aria-pressed")).toBe("false");
    const tagB = screen.getByTestId("c0828-options-tag").textContent ?? "";

    // 这一条就是变异反证咬住的那个命题：`setPickedFix` 一被掐掉，两者当场相等。
    expect(tagB).not.toBe(tagA);
    // 辨识串必须真的指向被选中的那一处（重名两行靠它分开）。
    expect(tagB).toContain(idB.split("_").at(-1) ?? "");
  });

  it("⑦b 同名两行必须分得开：辨识串带判据码 + 落点，⛔ 不是「①②」这种序号", async () => {
    withCandidates = true;
    mount();
    await railReady();
    await addEvent("material-price-up", "mat_licarb", 15);
    fireEvent.click(screen.getByTestId("c0828-go"));
    await screen.findByTestId("c0828-money");

    const rows = screen.getAllByTestId(/^c0828-fix-/);
    const tags = rows.map((r) => r.textContent ?? "");
    // 两行的可见文本不许一字不差 —— 这正是实拍里那两行「磷酸铁锂正极」的病。
    expect(new Set(tags).size).toBe(tags.length);
    for (const t of tags) {
      expect(t).toContain("判据 ");
      expect(t).toContain("落点 ");
    }
  });
});
