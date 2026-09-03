import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropagationRule, SandboxViewConfig, SimMetricSeriesResponse } from "@platform/contracts";

/**
 * ══ WO-SIM-UNIFIED-SHELL · 统一推演控制台的**接缝门**（SEAM-GATE：咬链路不咬函数）══════
 *
 * 驱动的是「**后端回包 → 屏上**」这一条，不是「某个纯函数返回了对的值」——
 * 五臂全部在**响应这一层**改东西，断言**屏上跟着变**。
 *
 * ── 🔴 fixture 必须接近生产规模（否则等于没测）─────────────────────────────────
 * 铁律 0.5 判据 6 的形态「生产实参与测试实参交集为空」在本仓真实发生过：沙盘五个既有套件的
 * `stateVars` 只有 1–2 个，于是新写的分层分支一次都没跑到、五个套件全绿而改动零覆盖
 * （见 `test/sandbox-three-zone.seam.test.tsx` 的同款记账）。
 * 故本门的 `STATE_VARS` 取 **`apps/datacore/src/seed.ts` 传导规则派生出来的那 37 条真名**
 * （`sourceStateVar ∪ targetStateVar` 去重升序 = `view-config` 下发的那一份）。
 *
 * ── 五臂 ───────────────────────────────────────────────────────────────────────
 *  ① 卡墙来源：卡的**名字与个数**来自 `view-config` 回包 —— 改回包，屏上跟着变。
 *              **不断言写死的 37，也不断言写死的中文名**（期望值一律从 fixture 现算）。
 *  ② 层级现算：改 `propagation-rules` 的**边集** ⇒ 某个变量的层级跟着变（根源 → 枢纽）。
 *  ③ 只铺变化：未变化的不在第一层，但**在展开块里找得回来**（收起 ≠ 删除）。
 *  ④ 收合行为：收起 ⇒ 摘要条出现且带「已施加什么」；点「改扰动」⇒ 左栏回来。
 *  ⑤ 诚实位：占位/派生的数字，其口径标注与数字**同屏**（同一张卡内）可读到。
 *
 * ── ⓪ 金丝雀（本门是不是在真的看屏幕）────────────────────────────────────────
 * 用例 ⓪ 先跑一个**已知必中**的样例。它若失败 ⇒ 报「**工具坏了**」，
 * **不许**读作「组件没渲染」或「卡墙是空的」——本仓真事：探针匹配到折叠组里不可见的元素，
 * 被误读成「按钮不存在」，连续误判两次。
 *
 * ── 层级为什么由**回包**驱动而不是前端算 ──────────────────────────────────────
 * 后端 `drill-scan.ts:290 layerOfStateVars` 是全平台唯一实现，经
 * `GET /a/v1/sim/drill/state-var-layers` 下发；前端再算一份就是第二套真相源
 * （`views/sim/DrillPanel.tsx:125` 明文禁止）。故本门的 fixture 里，
 * **层级回包由边集现算**（`layersFromEdges` 复刻后端那三条判据）——
 * 于是「改边集 ⇒ 屏上层级跟着变」这句话在门里字面成立，
 * 而断言咬住的仍然是前端「没有一张手工登记的层级表」这条性质：
 * 前端一旦写死一张表，改了边集屏上也不会动 ⇒ 本臂当场红。
 *
 * R6 确定性：网络全桩，无时钟、无随机。
 */

// ══════════════════════════════════════════════════════════════════════════════
// fixture · 生产规模
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 37 条状态变量真名 —— 取自 `apps/datacore/src/seed.ts` 的传导规则
 * （复验：`grep -o 'sourceStateVar: "[a-zA-Z]*"\|targetStateVar: "[a-zA-Z]*"' apps/datacore/src/seed.ts
 *   | sed 's/.*: "//;s/"//' | sort -u | wc -l` = 37）。
 */
const STATE_VARS = [
  "changeoverPressure", "clearanceQueueDays", "collectionPressure", "costPressure",
  "defectPressure", "deliveryDelay", "deliveryHoldRisk", "demandLoad",
  "demandPressure", "drawdownPressure", "expeditePressure", "feedPressure",
  "gapPressure", "handlingBacklog", "inboundExpeditePressure", "inspectBacklog",
  "loadIndex", "loadPressure", "overduePressure", "priceShock",
  "procurementDelay", "promiseRisk", "qualificationQueue", "queueDays",
  "queuePressure", "receivablePressure", "releasePressure", "repairBacklog",
  "reviewPressure", "shortageRisk", "splitPressure", "supplyRisk",
  "switchPressure", "transferPressure", "turnoverPressure", "utilPressure",
  "windowSqueeze",
] as const;

/** 一条边。**只有这里定义边集** —— 层级回包由它现算，不另手写一份层级表。 */
interface Edge {
  from: string;
  to: string;
}

/**
 * 按下标取状态变量名，**越界即抛**。
 *
 * 加它不是为了「把 `noUncheckedIndexedAccess` 的类型错消掉」—— 那是把问题藏起来。
 * 下面两个循环的边界（`i + 2 < n` / `i < n`）本来就保证下标在界内；这里做的是把那句
 * 「本来就保证」变成**运行时会说话的东西**：日后若有人改了 `STATE_VARS` 的条数、
 * 改了步长、或把循环条件写松一格，越界读到的 `undefined` 会**当场抛在这里**，
 * 而不是悄悄造出一条 `{ from: undefined }` 的边 —— 那种边会让 `layersFromEdges`
 * 凭空多出一个名叫 `"undefined"` 的变量，于是卡墙个数对不上，
 * 红在一个离病根很远的断言上（本仓老坑：症状离病因越远，越容易被读成「组件坏了」）。
 */
function stateVarAt(i: number): string {
  const name = STATE_VARS[i];
  if (name === undefined) {
    throw new Error(`STATE_VARS 下标越界：${i}（共 ${STATE_VARS.length} 条）—— fixture 或循环边界被改坏了`);
  }
  return name;
}

/**
 * 基线边集：把 37 条切成若干条 3 跳链（`a→b→c`），末条挂上余下那一个。
 * 于是三层**都非空**（根源 / 枢纽 / 末端），分层分支才真的被跑到。
 */
function baseEdges(): Edge[] {
  const out: Edge[] = [];
  const n = STATE_VARS.length;
  for (let i = 0; i + 2 < n; i += 3) {
    out.push({ from: stateVarAt(i), to: stateVarAt(i + 1) });
    out.push({ from: stateVarAt(i + 1), to: stateVarAt(i + 2) });
  }
  // 余数（37 % 3 = 1）挂到第一条链的末端后面，避免有变量落在边集之外。
  const rest = n - (n % 3);
  for (let i = rest; i < n; i += 1) out.push({ from: stateVarAt(2), to: stateVarAt(i) });
  return out;
}

/**
 * 层级：**复刻后端 `layerOfStateVars` 的三条判据**（drill-scan.ts:290）。
 * 这份复刻只活在 fixture 里，代表「后端会回什么」；生产代码一行度数计算都没有。
 */
function layersFromEdges(edges: readonly Edge[]): { stateVar: string; layer: string; label: string }[] {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const e of edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  const keys = [...new Set([...inDeg.keys(), ...outDeg.keys()])].sort();
  const rows: { stateVar: string; layer: string; label: string }[] = [];
  for (const sv of keys) {
    const i = inDeg.get(sv) ?? 0;
    const o = outDeg.get(sv) ?? 0;
    const layer = i === 0 && o > 0 ? "根源" : o === 0 && i > 0 ? "末端" : "枢纽";
    rows.push({ stateVar: sv, layer, label: NAMES[sv] ?? sv });
  }
  return rows;
}

function rulesFromEdges(edges: readonly Edge[]): PropagationRule[] {
  return edges.map((e, i) => ({
    id: `spr_${i}`,
    tenantId: "demo",
    key: `rule_${i}_${e.from}_${e.to}`,
    sourceTypeKey: "Base",
    sourceStateVar: e.from,
    viaLinkKey: "feeds",
    targetTypeKey: "Line",
    targetStateVar: e.to,
    coefficient: 0.5 + (i % 5) / 10,
    delayTicks: i % 3,
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

/**
 * 名字字典：**刻意只登记一部分** —— 未登记的键不进字典（后端契约明文），
 * 于是屏上「有业务名」与「回落裸键」两态都被跑到。
 */
const NAMES: Record<string, string> = {
  changeoverPressure: "换型压力",
  clearanceQueueDays: "清关排队天数",
  collectionPressure: "回款压力",
  costPressure: "成本压力",
  loadIndex: "负载指数",
  deliveryDelay: "交付延迟",
  demandPressure: "需求压力",
  supplyRisk: "供应风险",
};

const TICKS = [0, 1, 2, 3];
const TICK_DAYS = 15; // ⇒ 窗口 4 格 × 15 天 = 60 天（抽屉那张双线图的跨度**现算**，不写死 60）

/** 这个变量在本 fixture 里属于哪一档（三档互斥，用例据此现算期望，不写死名单）。 */
type Kind = "moved" | "unmoved" | "empty";
function kindOf(i: number): Kind {
  if (i % 3 === 0) return "moved";
  if (i % 7 === 5) return "empty";
  return "unmoved";
}

function seriesFor(vars: readonly string[]): SimMetricSeriesResponse {
  const metrics = vars.map((sv, i) => {
    const k = kindOf(i);
    const base = 10 + i;
    const baseline = TICKS.map(() => base);
    const actual =
      k === "moved"
        ? TICKS.map((_, t) => base + (t === 0 ? 0 : (i + 1)))
        : k === "empty"
          ? TICKS.map(() => null)
          : TICKS.map(() => base);
    return {
      key: `obj_${i}.${sv}`,
      objectId: `obj_${i}`,
      stateVar: sv,
      label: NAMES[sv] ?? sv,
      labelIsFallback: NAMES[sv] === undefined,
      unit: null,
      baseline,
      actual,
      segments: [],
    };
  });
  return {
    sessionId: "sims_u",
    fromTick: 0,
    toTick: 3,
    ticks: TICKS,
    tickDays: TICK_DAYS,
    metrics,
    totalMetrics: metrics.length,
    truncated: false,
    appliedLimit: 500,
    appliedOrder: "magnitude",
    baselineOrigin: { sessionId: "sims_u", seedTick: 0, excludedPerturbationIds: [] },
    clamped: false,
  } as unknown as SimMetricSeriesResponse;
}

/**
 * 后端下发的传导规则条数（`view-config.propagationCount`）。
 * **刻意不等于 `STATE_VARS.length`，也不等于任何"看起来对"的数** —— 页签那句问句若还写死
 * 一个常数，本门的 ⑨ 臂就会当场红；两个数若被写成同一个来源，也会红。
 */
let propagationCount = 42;

function cfgFor(vars: readonly string[], names: Record<string, string>): SandboxViewConfig {
  return {
    tenantId: "demo",
    nodeTypes: ["Base", "Line"],
    nodeObjectIds: { Base: ["obj_0"], Line: ["obj_1"] },
    linkTypes: ["feeds"],
    stateVars: [...vars],
    stateVarNames: names,
    radarDims: [
      { key: "structure", label: "结构" },
      { key: "knowledge", label: "知识" },
      { key: "behavior", label: "行为" },
    ],
    screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
    // WO-SIM-TICK-GATE：页签问句里那个「N 条因果边」现在**读这个字段**（改前写死 38）。
    // 用例可就地改 `propagationCount` 变量，断言屏上跟着变。
    propagationCount,
  } as unknown as SandboxViewConfig;
}

/** 后端那句「一句人话的出处说明」（`SeedWorldSnapshotOrigin.note`）—— 屏上要原样读得到。 */
const ORIGIN_NOTE = "tick0 读数为结构派生占位，不是实测";
const ORIGIN_FORMULA = "round(hash01(objectId|stateVar)×100)";

// ── 可变桩状态（每个用例 beforeEach 重置） ──────────────────────────────────────
let edges: Edge[] = [];
let cfg: SandboxViewConfig = cfgFor(STATE_VARS, NAMES);
let series: SimMetricSeriesResponse | null = null;
let originKind = "DERIVED";
/** 变异反证 ③ 的开关：摘掉口径标注（**只在门里模拟**，生产代码不带这个开关）。 */

const perturbations = [
  {
    id: "simpert_1",
    tenantId: "demo",
    sessionId: "sims_u",
    kind: "shock",
    targetObjectId: "obj_0",
    targetStateVar: "loadIndex",
    startTick: 0,
    durationTicks: null,
    magnitude: 12,
    mode: "delta",
    label: "常州 A 线停机 72h",
    createdAt: "2026-08-26T00:00:00.000Z",
  },
];

vi.mock("@/api/endpoints", () => ({
  fetchSimViewConfig: vi.fn(async () => cfg),
  fetchDrillStateVarLayers: vi.fn(async () => ({ layers: layersFromEdges(edges), ruleCount: edges.length })),
  fetchPropagationRules: vi.fn(async () => ({ items: rulesFromEdges(edges), stateVarNames: NAMES })),
  fetchSimSessions: vi.fn(async () => ({
    items: [
      {
        id: "sims_u",
        tenantId: "demo",
        status: "RUNNING",
        curTick: 3,
        parentCheckpointId: null,
        createdAt: "2026-08-26T00:00:00.000Z",
        scope: {
          baseSnapshotOrigin: {
            kind: originKind,
            formula: ORIGIN_FORMULA,
            note: ORIGIN_NOTE,
            types: 2,
            objects: 11348,
            cells: 408528,
            measuredCells: 0,
            derivedCells: 408528,
          },
        },
      },
    ],
  })),
  fetchSimPerturbations: vi.fn(async () => ({ items: perturbations })),
  createSimPerturbation: vi.fn(),
}));

vi.mock("@/api/apiClient", () => ({
  api: {
    a: vi.fn(async (path: string) => {
      if (path.includes("metric-series")) {
        if (series === null) throw new Error("metric-series 桩：本用例刻意不回");
        return series;
      }
      throw new Error(`未桩的路径：${path}`);
    }),
    b: vi.fn(),
    aRaw: vi.fn(),
  },
}));

import UnifiedSimShell from "@/views/sim/unified/UnifiedSimShell";

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UnifiedSimShell />
    </QueryClientProvider>,
  );
}

/**
 * 等到卡墙真的把这一屏铺完（不等就会在空 model 上做断言）。
 *
 * ⚠ **两个条件都要等，不许只等 `data-total`**（本门第一版就栽在这里）：
 * `data-total` 在 `view-config` 一回来就是终值 **37**，而那一刻**指标时序还在路上** ——
 * 于是断言跑在"所有卡都还是 `EMPTY`、全被收进展开块"的那一帧上，
 * 七个用例一起红在「卡片不存在」，指向一个跟病因毫不相干的地方。
 * 形态正是 CLAUDE.md 铁律 0.6 那一句：**「我用 X 当作 Y 的证据，而 X 并不度量 Y。」**
 * 故探针落在 `data-series`（时序这一跳到底回来没有）上。
 */
async function ready(expectedCards: number, expectSeries = true): Promise<HTMLElement> {
  const wall = await screen.findByTestId("usim-wall");
  await waitFor(() => {
    expect(wall.getAttribute("data-total")).toBe(String(expectedCards));
    expect(wall.getAttribute("data-series")).toBe(expectSeries ? "1" : "0");
  });
  return wall;
}

/** 本 fixture 下**必然被推动**的那些变量（期望值现算，不写死名单）。 */
const MOVED_VARS = STATE_VARS.filter((_, i) => kindOf(i) === "moved");

beforeEach(() => {
  edges = baseEdges();
  propagationCount = 42;
  cfg = cfgFor(STATE_VARS, NAMES);
  series = seriesFor(STATE_VARS);
  originKind = "DERIVED";
});
afterEach(cleanup);

// ══════════════════════════════════════════════════════════════════════════════

describe("WO-SIM-UNIFIED-SHELL · 统一推演控制台接缝门", () => {
  it("⓪ 金丝雀：五区外壳挂得起来，且卡墙铺出了 fixture 声明的那些卡（失败 ⇒ 报「工具坏了」，不许读作「卡墙是空的」）", async () => {
    mount();
    const wall = await ready(STATE_VARS.length);
    // 基数下限先咬：fixture 若退化成 1–2 个变量，下面所有 filter 都会在空集上恒真。
    expect(STATE_VARS.length).toBeGreaterThan(30);
    expect(wall).toBeTruthy();
    expect(screen.getByTestId("usim-shell")).toBeTruthy();
    expect(screen.getByTestId("usim-tabs")).toBeTruthy();
    expect(screen.getByTestId("usim-status")).toBeTruthy();
    expect(screen.getByTestId("usim-center")).toBeTruthy();
    expect(screen.getByTestId("usim-right")).toBeTruthy();
    expect(screen.getByTestId("usim-log")).toBeTruthy();
    // 已知必中：fixture 声明为「被推动」的那批变量，第一层上必然铺得出来。
    expect(MOVED_VARS.length).toBeGreaterThan(3);
    expect(screen.getByTestId(`usim-card-${MOVED_VARS[0]}`)).toBeTruthy();
    // 反向金丝雀：声明为「未变化」的那批**默认不在第一层**（在展开块里，臂 ③ 咬）。
    const quiet = STATE_VARS.filter((_, i) => kindOf(i) !== "moved")[0] as string;
    expect(screen.queryByTestId(`usim-card-${quiet}`)).toBeNull();
  });

  it("① 卡墙来源臂：卡的**个数与名字**来自 view-config 回包 —— 改回包，屏上跟着变", async () => {
    mount();
    await ready(STATE_VARS.length);

    // 个数：**先把每层的展开块打开**（未变化的默认收在里面），再数 —— 期望值从回包现算，不是写死的 37。
    const expandAll = async (): Promise<void> => {
      for (const t of screen.queryAllByTestId("usim-unmoved-toggle")) await userEvent.click(t);
    };
    await expandAll();
    const all = screen.getAllByTestId(/^usim-card-/);
    expect(all.length).toBe(cfg.stateVars.length);

    // 名字：字典里登记过的显业务名、没登记的**显裸键本身**（两态都要在屏上分得出来）。
    const named = screen.getByTestId("usim-card-costPressure");
    expect(named.textContent).toContain(NAMES.costPressure);
    expect(named.getAttribute("data-named")).toBe("1");
    const fallbackKey = STATE_VARS.find((sv) => NAMES[sv] === undefined) as string;
    const fellBack = screen.getByTestId(`usim-card-${fallbackKey}`);
    expect(fellBack.textContent).toContain(fallbackKey);
    expect(fellBack.getAttribute("data-named")).toBe("0");

    // ── 改回包 ⇒ 屏上跟着变（这一步才是本臂的判据）──────────────────────────
    cleanup();
    const fewer = STATE_VARS.slice(0, 5);
    const renamed = { ...NAMES, costPressure: `${NAMES.costPressure}·改名验证` };
    cfg = cfgFor(fewer, renamed);
    series = seriesFor(fewer);
    mount();
    await ready(fewer.length);
    for (const t of screen.queryAllByTestId("usim-unmoved-toggle")) await userEvent.click(t);

    expect(screen.getAllByTestId(/^usim-card-/).length).toBe(fewer.length);
    expect(screen.getByTestId("usim-card-costPressure").textContent).toContain(renamed.costPressure);
    // 被移出回包的那些卡**必须消失**（否则说明前端存了一份自己的清单）。
    expect(screen.queryByTestId("usim-card-loadIndex")).toBeNull();
  });

  it("② 层级现算臂：改 propagation-rules 的**边集** ⇒ 某个变量的层级跟着变（根源 → 枢纽）", async () => {
    // 标的：第一条链的链头，基线上入度 0、出度 1 ⇒ 根源。
    const subject = STATE_VARS[0];
    const before = layersFromEdges(edges).find((r) => r.stateVar === subject);
    expect(before?.layer, "fixture 前提坏了：标的在基线边集上不是根源").toBe("根源");

    mount();
    await ready(STATE_VARS.length);
    const card = screen.getByTestId(`usim-card-${subject}`);
    expect(card.getAttribute("data-layer")).toBe(before?.layer);
    // 分组容器也必须落在同一层（卡与分组两处口径一致，漂了就说明有两套判定）。
    const group = card.closest("[data-testid='usim-group']");
    expect(group?.getAttribute("data-layer")).toBe(before?.layer);

    // ── 给这个根源加一条**入边** ⇒ 它变成枢纽 ────────────────────────────────
    cleanup();
    edges = [...baseEdges(), { from: STATE_VARS[5], to: subject }];
    const after = layersFromEdges(edges).find((r) => r.stateVar === subject);
    expect(after?.layer, "fixture 前提坏了：加了入边之后标的仍不是枢纽").toBe("枢纽");
    expect(after?.layer).not.toBe(before?.layer);

    mount();
    await ready(STATE_VARS.length);
    const card2 = screen.getByTestId(`usim-card-${subject}`);
    // 🔴 头号判据：屏上那个层级跟着**边集**变了。前端若存一张手工层级表，这里恒等于 before ⇒ 红。
    expect(card2.getAttribute("data-layer")).toBe(after?.layer);
    expect(card2.getAttribute("data-layer")).not.toBe(before?.layer);
    expect(card2.closest("[data-testid='usim-group']")?.getAttribute("data-layer")).toBe(after?.layer);
  });

  it("③ 只铺变化臂：未变化的不在第一层，但在「未变化 N 项」展开块里找得回来（收起 ≠ 删除）", async () => {
    mount();
    await ready(STATE_VARS.length);

    const movedVars = STATE_VARS.filter((_, i) => kindOf(i) === "moved");
    const unmovedVars = STATE_VARS.filter((_, i) => kindOf(i) !== "moved");
    // 基数下限：两档都非空，否则下面的断言在空集上恒真。
    expect(movedVars.length).toBeGreaterThan(3);
    expect(unmovedVars.length).toBeGreaterThan(3);

    // 被推动的：在第一层（`usim-group-moved` 容器内）。
    const someMoved = movedVars[0];
    const movedCard = screen.getByTestId(`usim-card-${someMoved}`);
    expect(movedCard.getAttribute("data-moved")).toBe("1");
    expect(movedCard.closest("[data-testid='usim-group-moved']")).not.toBeNull();

    // 未变化的：第一层里**没有**。
    const someUnmoved = unmovedVars[0];
    expect(screen.queryByTestId(`usim-card-${someUnmoved}`)).toBeNull();

    // 但展开块里找得回来 —— 「收进展开块」与「删掉」的区别就在这一步。
    const toggles = screen.getAllByTestId("usim-unmoved-toggle");
    expect(toggles.length).toBeGreaterThan(0);
    // 计数写在按钮上：它是"还有多少东西没显示"的诚实位。
    for (const t of toggles) expect(t.textContent).toMatch(/未变化\s*\d+\s*项/);
    for (const t of toggles) await userEvent.click(t);

    const back = screen.getByTestId(`usim-card-${someUnmoved}`);
    expect(back.getAttribute("data-moved")).toBe("0");
    expect(back.closest("[data-testid='usim-group-unmoved']")).not.toBeNull();
    // 展开块里的卡是**同一张卡**（同样带口径标注），不是另一套简化行。
    expect(within(back).getByTestId(`usim-calibre-${someUnmoved}`)).toBeTruthy();
  });

  it("④ 收合臂：收起 ⇒ 摘要条出现且带「已施加什么」；点「改扰动」⇒ 左栏回来", async () => {
    mount();
    await ready(STATE_VARS.length);

    expect(screen.getByTestId("usim-rail")).toBeTruthy();
    expect(screen.queryByTestId("usim-rail-summary")).toBeNull();

    await userEvent.click(screen.getByTestId("usim-rail-collapse"));

    expect(screen.queryByTestId("usim-rail")).toBeNull();
    const summary = await screen.findByTestId("usim-rail-summary");
    expect(summary).toBeTruthy();
    // 「已施加什么」必须真的说得出来 —— 落点变量的业务名 + 幅度都在摘要条上。
    const applied = screen.getByTestId("usim-rail-summary-applied");
    await waitFor(() => expect(applied.textContent).toContain(NAMES.loadIndex));
    // 幅度**从 fixture 现取**，不写死 12 —— 改了 fixture 这条断言要跟着动。
    // 取不到 = fixture 被清空，那不是「摘要条没渲染」，直接抛出来别让它退化成一句空断言。
    const [firstPert] = perturbations;
    if (firstPert === undefined) throw new Error("fixture perturbations 为空 —— 本臂失去被驱动的输入");
    expect(applied.textContent).toContain(String(firstPert.magnitude));
    // 结果读数：被推动几张 / 一共几张（个数由回包现算，不写死）。
    const movedCount = STATE_VARS.filter((_, i) => kindOf(i) === "moved").length;
    expect(screen.getByTestId("usim-rail-summary-result").textContent).toContain(
      `${movedCount}/${STATE_VARS.length}`,
    );

    await userEvent.click(screen.getByTestId("usim-rail-reopen"));
    expect(screen.getByTestId("usim-rail")).toBeTruthy();
    expect(screen.queryByTestId("usim-rail-summary")).toBeNull();
  });

  it("⑤ 诚实位臂：派生读数的口径标注与数字**同屏**（同一张卡内），且写着后端那句出处", async () => {
    mount();
    await ready(STATE_VARS.length);

    const sv = STATE_VARS.filter((_, i) => kindOf(i) === "moved")[0] as string;
    const card = screen.getByTestId(`usim-card-${sv}`);

    // 数字在这张卡里。
    const value = within(card).getByTestId(`usim-value-${sv}`);
    expect(value.textContent?.trim()).not.toBe("");
    expect(value.textContent).not.toContain("—");

    // 🔴 口径标注**在同一张卡里**（不是页脚一句总说明）——摘掉它，本条当场红。
    const calibre = within(card).getByTestId(`usim-calibre-${sv}`);
    expect(calibre.textContent).toContain("推演投影·非实测");
    // 且写的是**后端那句人话**，不是前端自己编的措辞。
    expect(calibre.textContent).toContain(ORIGIN_NOTE);
    expect(card.getAttribute("data-provenance")).toBe("PROJECTED");

    // 状态条上那份整体出处同样如实（实测格 0/408528 —— 这批读数一格实测都没有）。
    const originEl = screen.getByTestId("usim-origin");
    expect(originEl.getAttribute("data-origin-kind")).toBe("DERIVED");
    expect(originEl.textContent).toContain(ORIGIN_NOTE);

    // ── 算不出来 ≠ 0：`EMPTY` 卡显「—」并带缺席原因，**不补 0** ────────────────
    const emptyVars = STATE_VARS.filter((_, i) => kindOf(i) === "empty");
    expect(emptyVars.length).toBeGreaterThan(0);
    for (const t of screen.getAllByTestId("usim-unmoved-toggle")) await userEvent.click(t);
    const emptyCard = screen.getByTestId(`usim-card-${emptyVars[0]}`);
    expect(emptyCard.getAttribute("data-provenance")).toBe("EMPTY");
    expect(within(emptyCard).getByTestId(`usim-value-${emptyVars[0]}`).textContent).toContain("—");
    expect(within(emptyCard).getByTestId(`usim-calibre-${emptyVars[0]}`).textContent).toContain("算不出来");
  });

  it("⑥ 右栏检视：点卡 ⇒ 四问在屏上（含谁推的/推坏谁的系数与延迟），且「没有落点」与「算不出来」是两个态", async () => {
    mount();
    await ready(STATE_VARS.length);

    // 标的取第一条链的**链头**（有出边、无入边）⇒ 上游空态、下游非空。
    const head = STATE_VARS[0];
    await userEvent.click(screen.getByTestId(`usim-card-${head}`));
    const pane = await screen.findByTestId("usim-inspector");
    expect(pane.getAttribute("data-statevar")).toBe(head);

    // 这是什么 / 变了多少 / 凭什么，三段都在。
    expect(within(pane).getByTestId("usim-inspector-layer").getAttribute("data-layer")).toBe("根源");
    expect(within(pane).getByTestId("usim-inspector-value")).toBeTruthy();
    expect(within(pane).getByTestId("usim-inspector-calibre").textContent).toContain(ORIGIN_NOTE);

    // 谁推的：链头没有入边 ⇒ 显式空态（**结论**，不是缺数据）。
    expect(within(pane).getByTestId("usim-upstream-none")).toBeTruthy();
    // 推坏谁：下游一跳带系数与延迟，两者都取自边集。
    const downTarget = edges.find((e) => e.from === head)?.to as string;
    const downRow = within(pane).getByTestId(`usim-down-${downTarget}`);
    const rule = rulesFromEdges(edges).find((r) => r.sourceStateVar === head && r.targetStateVar === downTarget);
    expect(downRow.textContent).toContain(String(rule?.coefficient));
    expect(downRow.textContent).toContain(`${rule?.delayTicks} 拍`);

    // 落点三态里的「ok / none」互斥地出现在 data-state 上。
    const landings = within(pane).getByTestId("usim-landings");
    expect(["ok", "none", "unknown"]).toContain(landings.getAttribute("data-state"));

    // ── 时序整跳缺席 ⇒ 落点必须是 `unknown`（**不是** `none`）──────────────────
    cleanup();
    series = null;
    mount();
    // 时序整跳缺席 ⇒ 每张卡都是 `EMPTY` ⇒ 一张都不在第一层（这本身就是诚实的），先展开再点。
    await ready(STATE_VARS.length, false);
    for (const t of screen.queryAllByTestId("usim-unmoved-toggle")) await userEvent.click(t);
    await userEvent.click(screen.getByTestId(`usim-card-${head}`));
    const pane2 = await screen.findByTestId("usim-inspector");
    expect(within(pane2).getByTestId("usim-landings").getAttribute("data-state")).toBe("unknown");
  });

  it("⑦ 抽屉：右栏「展开」进三栏抽屉，窗口天数由 ticks×tickDays **现算**（不是写死的 60）", async () => {
    mount();
    await ready(STATE_VARS.length);
    await userEvent.click(screen.getByTestId(`usim-card-${STATE_VARS[0]}`));
    expect(screen.queryByTestId("usim-drawer")).toBeNull();

    await userEvent.click(screen.getByTestId("usim-act-expand"));
    const drawer = await screen.findByTestId("usim-drawer");
    expect(within(drawer).getByTestId("usim-drawer-chain")).toBeTruthy();
    expect(within(drawer).getByTestId("usim-drawer-landings")).toBeTruthy();
    const seriesCol = within(drawer).getByTestId("usim-drawer-series");
    expect(seriesCol.textContent).toContain(`${TICKS.length * TICK_DAYS} 天`);

    await userEvent.click(screen.getByTestId("usim-drawer-toggle"));
    expect(screen.queryByTestId("usim-drawer")).toBeNull();
  });

  /**
   * ⑧ **WO-SIM-SHELL-TABS 改写了这一条**（改前 / 改后 / 为什么，逐句写在这里）。
   *
   * ── 改前 ────────────────────────────────────────────────────────────────────
   * ```
   * it("⑧ 模式页签：只有「现状」是活的，其余四档占位**禁用**…", …)
   *   const now = screen.getByTestId("usim-tab-now");  expect(now.disabled).toBe(false);
   *   for (const m of ["attribute","tryone","optimize","radius"])
   *     expect(screen.getByTestId(`usim-tab-${m}`).disabled).toBe(true);
   * ```
   *
   * ── 为什么改（判据：这条断言咬的是「版面长这样」还是「这个能力还在」）──────────
   * 它咬的是**一份具体的占位名单**，而那份名单来自 `../sandboxModes.ts` 的 `SANDBOX_MODES`
   * ——**另一屏**（旧沙盘控制台 `SandboxConsole`）的模式表。那五档指向
   * `cleanroom-attr`/`what-if`/`optimize-whatif`/`disruption-radius` 四个通用页，
   * 与本屏要挂的四页（`sim-conduction`/`sim-attribution`/`sim-optimize`/`chain-line-map`）
   * **一个都不重叠**。已批准的 UX 规格（artifact 7e027dab 的 `.modes`）给了本屏自己的九档，
   * 第 ② 单接其中五档、留三档占位 ⇒ 名单本身**按批准的 UX 变了**，属「咬版面」⇒ 更新断言。
   *
   * 而它保护的那个**能力**——「未接线的档要占位禁用、不许隐藏（隐藏 = 假装没这功能）」——
   * 一个字都没放宽：下面照旧逐档断言 `disabled` 且**在 DOM 里**。
   *
   * ── 期望值从哪来（不许从被测的那张表现算，那是空转）────────────────────────
   * `EXPECT_TABS` 是**已批准 UX 规格里那排按钮的逐字文案与顺序**，硬写在门里。
   * 若有人改了 `unifiedModes.ts` 的顺序或文案，本条当场红 —— 这正是「顺序即产品表达」
   * 需要一道门守着的原因；把期望改成 `UNIFIED_MODES.map(…)` 就等于让被告自证清白。
   */
  it("⑧ 模式页签：顺序与文案 == 已批准 UX 规格；已接线的可点，未接线的**占位禁用**（不是隐藏）", async () => {
    mount();
    await ready(STATE_VARS.length);

    // 规格 artifact 7e027dab `.modes[role=tablist]` 里那排按钮，逐字逐序。
    const EXPECT_TABS = [
      "指标态势",
      "传导识别",
      "损失归因",
      "方案寻优",
      "演习结论",
      "产销线路图",
      "传导边册",
      "本体与就绪",
    ];
    const tabs = within(screen.getByTestId("usim-tabs")).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(EXPECT_TABS);

    // 本单接线的五档（含本壳自带的「指标态势」）：可点。
    for (const m of ["now", "conduction", "attribution", "optimize", "linemap"]) {
      const t = screen.getByTestId(`usim-tab-${m}`) as HTMLButtonElement;
      expect(t.disabled, `${m} 档已接线，应可点`).toBe(false);
    }
    // 尚未接线的三档：**在 DOM 里**且禁用，并且 `title` 说得出为什么点不动。
    for (const m of ["verdict", "edges", "readiness"]) {
      const t = screen.getByTestId(`usim-tab-${m}`) as HTMLButtonElement;
      expect(t.disabled, `${m} 档未接线，应占位禁用`).toBe(true);
      expect(t.getAttribute("data-active")).toBe("0");
      expect((t.getAttribute("title") ?? "").length, `${m} 档要说明为什么点不动`).toBeGreaterThan(10);
    }
    // 默认落在「指标态势」。
    expect(screen.getByTestId("usim-tab-now").getAttribute("data-active")).toBe("1");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WO-SIM-TICK-GATE · 顺带两条 A 类（同一屏、别的角色实测抓出来的）
// ══════════════════════════════════════════════════════════════════════════════
/**
 * ── ⑨ 守什么 ─────────────────────────────────────────────────────────────────
 * 改前页签问句里写死两个数，**两个今天都是错的**（真后端 `SEED_DEMO=1` 实测）：
 *   ·「38 条因果边」 ⇒ 实测 `view-config.propagationCount` = **42**，
 *     而**同一屏**右栏 `EdgeActivePanel` 写的就是 42 —— 一屏之内两个数打架；
 *   ·「37 个状态变量」⇒ 实测 `stateVars.length` = **40**（卡墙卡片数就是它）。
 * 判据必须写成「**这两个数由回包现算**」，**不许**写成「不等于 38」——
 * 后者把 38 换成 42 也能骗过去，而 42 明天照样会过期。故本臂**改回包、断言屏上跟着变**。
 *
 * ── ⑩ 守什么 ─────────────────────────────────────────────────────────────────
 * 改前「钉到对照 / 追这条链」两个按钮可点、零请求，屏底日志印
 * `动作 pin:supplyRisk（本单不落写操作）` —— 工单黑话 + 机器动作键上了用户屏，
 * 且是个**假旋钮**（点了有反馈、什么都没发生）。
 */
describe("WO-SIM-TICK-GATE · 页签计数现算 / 假旋钮下屏", () => {
  it("⑨ 页签计数臂：两个数都由 view-config 回包现算 —— 改回包，两处 title 跟着变", async () => {
    mount();
    await ready(STATE_VARS.length);

    // 金丝雀：这两个页签真的在屏上（不中 ⇒ 报「工具坏了」，不许读作「数字不对」）
    const edgesTab = screen.getByTestId("usim-tab-edges");
    const nowTab = screen.getByTestId("usim-tab-now");
    expect(edgesTab, "金丝雀不中 ⇒ 本臂什么都没证明").toBeTruthy();

    // 期望值**现算**，不写死：边数取回包字段，变量数取回包数组长度。
    expect(edgesTab.getAttribute("title")).toContain(`${propagationCount} 条因果边`);
    expect(nowTab.getAttribute("title")).toContain(`${STATE_VARS.length} 个状态变量`);
    // 改前那个写死的 38 已经不在了（本 fixture 的回包是 42，两者不等 ⇒ 这一句有意义）。
    // ⚠ **刻意不写** `not.toContain("37 个状态变量")`：本 fixture 的 `STATE_VARS.length`
    //    **恰好就是 37**，那句话会把**正确**的现算结果判成错的 —— 我第一版就是这么红的。
    //    形态正是本门自己在警告的那一个：「我用『屏上出现了 37』当作『它是写死的』的证据，
    //    而前者并不度量后者。」判据只能落在**改回包屏上跟不跟着变**上，见下半段。
    expect(edgesTab.getAttribute("title")).not.toContain("38 条因果边");

    // ── 改**回包** ⇒ 两处跟着走（写死常数的话这两句当场红）────────────────────
    cleanup();
    propagationCount = 99;
    const fewer = STATE_VARS.slice(0, 5);
    cfg = cfgFor(fewer, NAMES);
    series = seriesFor(fewer);
    mount();
    await ready(fewer.length);
    const edgesTab2 = screen.getByTestId("usim-tab-edges");
    const nowTab2 = screen.getByTestId("usim-tab-now");
    expect(edgesTab2.getAttribute("title")).toContain("99 条因果边");
    expect(nowTab2.getAttribute("title")).toContain("5 个状态变量");
    // 现在**旧值必须消失** —— 这一对否定断言此刻才有意义（回包已经不是那两个数了）
    expect(edgesTab2.getAttribute("title")).not.toContain("42 条因果边");
    expect(nowTab2.getAttribute("title")).not.toContain("37 个状态变量");
  });

  it("⑨' 计数没到手时说「还没取到」，**不许**印成 0 条（「不知道」≠「一条都没有」）", async () => {
    // 守的是本仓那句话：**「我没找到」和「它不存在」是两个不同的命题。**
    // view-config 整跳失败 ⇒ 计数为 `null`；屏上若印「0 条因果边」，用户会去查一个不存在的故障。
    cfg = undefined as unknown as SandboxViewConfig;
    series = null;
    mount();
    const edgesTab = await screen.findByTestId("usim-tab-edges");
    await waitFor(() => {
      const title = edgesTab.getAttribute("title") ?? "";
      expect(title).toContain("还没取到");
      expect(title).not.toContain("0 条因果边");
    });
    expect(screen.getByTestId("usim-tab-now").getAttribute("title") ?? "").not.toContain("0 个状态变量");
  });

  it("⑩ 假旋钮臂：钉到对照 / 追这条链**禁用占位 + 人话 title**，工单黑话一个字都不上屏", async () => {
    mount();
    await ready(STATE_VARS.length);
    await userEvent.click(screen.getByTestId(`usim-card-${STATE_VARS[0]}`));
    await screen.findByTestId("usim-inspector");

    // 金丝雀（反证）：同一排里「展开到底部抽屉」是**活的** ——
    // 否则下面的 disabled 证明不了是"未接线"造成的，而可能是整栏都点不动。
    expect((screen.getByTestId("usim-act-expand") as HTMLButtonElement).disabled).toBe(false);

    for (const [id, what] of [["usim-act-pin", "钉到对照"], ["usim-act-trace", "追这条链"]] as const) {
      const btn = screen.getByTestId(id) as HTMLButtonElement;
      // ① 留在屏上（隐藏 = 假装没这功能）
      expect(btn.textContent).toContain(what);
      // ② 今天点不动，且机器可读位说得出它是"未接线"而不是"坏了"
      expect(btn.disabled, `${what} 今天零请求，必须占位禁用而不是假装可点`).toBe(true);
      expect(btn.getAttribute("data-pending")).toBe("1");
      // ③ title 用人话说清将来做什么 + 今天为什么点不动
      const title = btn.getAttribute("title") ?? "";
      expect(title.length, `${what} 要说明为什么点不动`).toBeGreaterThan(20);
      expect(title).toContain("还没有做好");
    }

    // ── 全屏扫一遍：工单黑话 / 机器动作键一个都不许出现在用户能读到的文字里 ──
    //    判据落在**屏上的可见文本 + title**，不是源码 —— 源码里出现 `pin:` 是正常的。
    const shell = screen.getByTestId("usim-shell");
    const visible = [
      shell.textContent ?? "",
      ...[...shell.querySelectorAll("[title]")].map((e) => e.getAttribute("title") ?? ""),
    ].join("\n");
    for (const jargon of ["本单", "pin:", "trace:", "写操作", "工单"]) {
      expect(visible, `屏上出现了工单黑话「${jargon}」`).not.toContain(jargon);
    }
  });
});
