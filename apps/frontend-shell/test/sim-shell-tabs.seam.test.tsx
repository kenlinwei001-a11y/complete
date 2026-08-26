import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { loginAs } from "./utils";
import UnifiedSimShell from "@/views/sim/unified/UnifiedSimShell";
// 选中态在这两页上只由 CSS Module 的 `.on` 表达（无 `data-*`）。**读同一份 module**，
// 不在门里写死哈希类名 —— 抄一份出来就是装饰品（改了样式表门拿旧名去测、照样绿）。
import attrCss from "@/views/sim/console/SandboxAttr.module.css";
import optCss from "@/views/sim/console/SandboxOpt.module.css";

/**
 * ══ WO-SIM-SHELL-TABS · 四个独立页降成统一控制台模式页签的**接缝门** ══════════════
 *
 * 咬的是「**页签 → 真页面**」这条缝，不是「某个模式表返回了对的值」。
 * 全程渲染**真的** `UnifiedSimShell`，让它自己经 `views/registry.ts` 的 `getRenderer`
 * 去挂真的 `SandboxDetailRoute` / `SandboxAttrRoute` / `SandboxOptRoute` / `ChainLineMapView`
 * —— 手搓一个假组件顶上去，测的就只是本文件自己。
 *
 * ── 四臂 ───────────────────────────────────────────────────────────────────────
 *  ① **挂载**：切到每个页签 ⇒ 该页**自己的** testid 真出现在屏上（不是本门新造的标记）。
 *  ② **上下文不丢**（标的）：左栏改一处 + 卡墙选一张卡 → 切页签 → 切回 ⇒ 两样都还在。
 *     这一臂是合并的**全部理由**：只测「页签能切」等于没测。
 *  ③ **懒加载**：首屏 DOM 里没有任何一页；且**同一个探针**在切过去之后能找到它们
 *     （否定结论必须带金丝雀命中证据，见下 ⓪）。
 *  ④ **降级不丢能力**：四页各挑一个**核心交互**，在页签里照样能用。
 *
 * ── ⓪ 金丝雀（本门是不是在真的看屏幕）──────────────────────────────────────────
 * 第 ① 单的 dev 在这里栽过：拿 `data-total` 当「数据到齐」的探针，而它在 view-config
 * 一回来就是终值，那一刻时序还在路上 ⇒ 七例齐红在「卡片不存在」，真因是**探针不度量它要
 * 度量的东西**。故本门：
 *  · 用例 ⓪ 先拿一个**已知必中**的样例跑探针；不中 ⇒ 报「工具坏了」，不许报「组件没渲染」。
 *  · 第 ③ 臂那种**否定断言**（「不在 DOM 里」），必须在**同一个用例里**用同一个探针
 *    把它们找出来一次 —— 否则「探针坏了」与「页面确实没挂」在屏上一模一样。
 *
 * ── 桩的口径：壳自己的取数口给真 fixture，四页的取数口一律 404 ─────────────────
 * 本门咬的是**页签这条缝**；四页各自的格子落占位是**正常态**，不是漏接
 * （各自另有专门的门：`sandbox-detail-pixel` / `sandbox-attr-pixel` / `sandbox-opt-pixel` /
 * `chain-line-map.seam` / `edge-panel-4pages.seam`）。桩成 404 让它们**确定性**落空，
 * 而不是靠"恰好没人请求"蒙混。兜底 handler 排在末位 ⇒ 上面的具体桩先匹配。
 *
 * R6 确定性：网络全桩、无时钟、无随机。
 */

// ══════════════════════════════════════════════════════════════════════════════
// fixture
// ══════════════════════════════════════════════════════════════════════════════

const SESSION_ID = "sims_tabs";

/** 九条状态变量，切成三条 3 跳链 ⇒ 根源/枢纽/末端三层都非空（分层分支才真被跑到）。 */
const STATE_VARS = [
  "procurementDelay",
  "shortageRisk",
  "releasePressure",
  "priceShock",
  "costPressure",
  "collectionPressure",
  "demandPressure",
  "demandLoad",
  "promiseRisk",
] as const;

const NAMES: Record<string, string> = Object.fromEntries(STATE_VARS.map((sv, i) => [sv, `变量${i}`]));

interface Edge {
  from: string;
  to: string;
}
const EDGES: Edge[] = [];
for (let i = 0; i + 2 < STATE_VARS.length; i += 3) {
  EDGES.push({ from: STATE_VARS[i] as string, to: STATE_VARS[i + 1] as string });
  EDGES.push({ from: STATE_VARS[i + 1] as string, to: STATE_VARS[i + 2] as string });
}

/** 层级**由边集现算**（复刻后端 `layerOfStateVars` 的三条判据）—— 不手写一张层级表。 */
function layers(): { stateVar: string; layer: string; label: string }[] {
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const e of EDGES) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  return STATE_VARS.map((sv) => {
    const i = inDeg.get(sv) ?? 0;
    const o = outDeg.get(sv) ?? 0;
    const layer = i === 0 && o > 0 ? "source" : o === 0 && i > 0 ? "leaf" : i > 0 && o > 0 ? "hub" : "isolated";
    return { stateVar: sv, layer, label: layer };
  });
}

const RULES = EDGES.map((e, i) => ({
  id: `rule_${i}`,
  tenantId: "demo",
  key: `${e.from}->${e.to}`,
  sourceObjectType: "TypeA",
  sourceStateVar: e.from,
  targetObjectType: "TypeB",
  targetStateVar: e.to,
  linkType: "linkAB",
  coefficient: 0.5,
  delayTicks: 0,
  status: "PUBLISHED",
}));

const TICKS = [0, 1, 2, 3];
const SERIES = {
  sessionId: SESSION_ID,
  fromTick: 0,
  toTick: 3,
  ticks: TICKS,
  tickDays: 15,
  metrics: STATE_VARS.map((sv, i) => ({
    key: `obj_${i}.${sv}`,
    objectId: `obj_${i}`,
    stateVar: sv,
    label: NAMES[sv] ?? sv,
    labelIsFallback: false,
    unit: null,
    baseline: TICKS.map(() => 10 + i),
    // 逢三动一张 ⇒ 第一层有卡可点（"只铺变化"的那条规则见第 ① 单的门）。
    actual: TICKS.map((_, t) => 10 + i + (i % 3 === 0 && t > 0 ? i + 1 : 0)),
    segments: [],
  })),
  totalMetrics: STATE_VARS.length,
  truncated: false,
  appliedLimit: 500,
  appliedOrder: "magnitude",
  baselineOrigin: { sessionId: SESSION_ID, seedTick: 0, excludedPerturbationIds: [] },
  clamped: false,
};

const VIEW_CONFIG = {
  tenantId: "demo",
  nodeTypes: ["Base", "Line"],
  nodeObjectIds: { Base: ["obj_0"], Line: ["obj_1"] },
  linkTypes: ["feeds"],
  stateVars: [...STATE_VARS],
  stateVarNames: NAMES,
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"],
  propagationCount: RULES.length,
};

const SESSION = {
  id: SESSION_ID,
  tenantId: "demo",
  baseSnapshot: {},
  scope: {
    baseSnapshotOrigin: {
      kind: "DERIVED",
      formula: "round(hash01(objectId|stateVar)×100)",
      note: "tick0 读数为结构派生占位，不是实测",
      types: 2,
      objects: 11,
      cells: 99,
      measuredCells: 0,
      derivedCells: 99,
    },
  },
  status: "RUNNING",
  curTick: 3,
  parentCheckpointId: null,
  createdAt: "2026-08-26T00:00:00.000Z",
};

const PERTURBATIONS = [
  {
    id: "simpert_1",
    tenantId: "demo",
    sessionId: SESSION_ID,
    kind: "shock",
    targetObjectId: "obj_0",
    targetStateVar: "procurementDelay",
    startTick: 0,
    durationTicks: null,
    magnitude: 18,
    mode: "delta",
    label: "采购到货延迟 +18d",
    createdAt: "2026-08-26T00:00:00.000Z",
  },
];

/**
 * 损失归因台的热矩阵**给真回包**（其余取数口一律 404）。
 *
 * ⚠ 这不是"顺手多桩一个"，是第 ④ 臂**不空转**的前提：`useAttrDetail` 在
 * `heat.source !== "endpoint"` 时把 `selected` 写死成 `i === 0`（占位口径），
 * 于是"点明细行 ⇒ 落点跟着换"这件事**在占位态下根本到不了** ——
 * 那时断言不红，读作"通过"就是本仓记过的第三种假绿（**被变异的行为今天到不了**）。
 * 故这一格喂真数据，让那条交互真的有地方可去。
 * 形状取自 `useLossAttribution.projectHeatMatrix` 读的那几个字段（nodes/bases/cells/colTotals）。
 */
const HEAT_NODES = ["capacity.aging", "material.kitting", "capacity.qc_batch"] as const;
const HEAT_BASES = [
  { baseId: "changzhou", name: "常州" },
  { baseId: "hefei", name: "合肥" },
] as const;
const CHAIN_LOSS_MATRIX = {
  nodes: HEAT_NODES.map((nodeId) => ({ nodeId, label: nodeId })),
  bases: HEAT_BASES.map((b) => ({ baseId: b.baseId, name: b.name })),
  cells: HEAT_NODES.flatMap((nodeId, i) =>
    HEAT_BASES.map((b, j) => ({ nodeId, baseId: b.baseId, pct: 30 - i * 8 - j * 3, days: (30 - i * 8 - j * 3) * 0.216 })),
  ),
  colTotals: HEAT_BASES.map((b) => ({ baseId: b.baseId, days: 12.3, sumPct: 100, residual: 0, reason: null })),
  summary: "3 个环节 × 2 个基地，2 列有数据",
};

/** 四页各自的取数口打到这里 —— **确定性落空**，不是"恰好没人请求"。 */
const NOT_FOUND = () =>
  HttpResponse.json({ error: { code: "NOT_FOUND", message: "本门不桩四页的取数口", requestId: "req_tabs" } }, { status: 404 });

function installHandlers(): void {
  server.use(
    http.get("*/a/v1/sim/view-config", () => HttpResponse.json(VIEW_CONFIG)),
    http.post("*/a/v1/sim/chain-loss-matrix", () => HttpResponse.json(CHAIN_LOSS_MATRIX)),
    http.get("*/a/v1/sim/drill/state-var-layers", () => HttpResponse.json({ layers: layers(), ruleCount: RULES.length })),
    http.get("*/a/v1/sim/propagation-rules", () => HttpResponse.json({ items: RULES, stateVarNames: NAMES })),
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [SESSION] })),
    http.get("*/a/v1/sim/sessions/:id/metric-series", () => HttpResponse.json(SERIES)),
    http.get("*/a/v1/sim/sessions/:id/perturbations", () => HttpResponse.json({ items: PERTURBATIONS })),
    // 兜底排末位：上面没点名的一律 404（含四页自己的取数口与 B 侧求解器）。
    http.all("*", NOT_FOUND),
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 被测面
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 一档 = 页签键 + 该页**自己的** testid（本门一个新 testid 都不造）+ 一个核心交互。
 *
 * ⚠ 派单原文举的例子是「损失归因**点热力格**」——**实测该例不成立**：`HeatMatrix.tsx` 的格子
 * 只有 `title` 与 `data-empty`，**没有 `onClick`**（全文件零个）。损失归因台真正的下钻交互是
 * **根因树的二级行**（`TreeRow` 的 `onPick`）与**明细行**（`sandbox-attr-detail-*` 的 `onClick`）。
 * 故本门第 ④ 臂咬明细行 —— 「点了之后屏上换内容」这件事本身没变，换的只是点哪儿。
 */
interface TabUnderTest {
  /** `unifiedModes.ts` 的键 = `usim-tab-<key>` 的后缀。 */
  key: string;
  label: string;
  /** 这一页**自己**的特征元素（第 ① / ③ 臂用）。 */
  marker: string;
  /** `registry.ts` 里它注册的 renderer key（第 ① 臂顺带对账壳透下去的那个键）。 */
  renderer: string;
}

const TABS: readonly TabUnderTest[] = [
  { key: "conduction", label: "传导识别", marker: "sandbox-detail", renderer: "sim-conduction" },
  { key: "attribution", label: "损失归因", marker: "sandbox-attr", renderer: "sim-attribution" },
  { key: "optimize", label: "方案寻优", marker: "sandbox-opt", renderer: "sim-optimize" },
  { key: "linemap", label: "产销线路图", marker: "clm-zoom-readout", renderer: "chain-line-map" },
];

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UnifiedSimShell />
    </QueryClientProvider>,
  );
}

/** 等卡墙把第一屏铺完。探针落在 `data-series`（时序这一跳到底回来没有），不是 `data-total`。 */
async function readyNow(): Promise<HTMLElement> {
  const wall = await screen.findByTestId("usim-wall");
  await waitFor(() => {
    expect(wall.getAttribute("data-total")).toBe(String(STATE_VARS.length));
    expect(wall.getAttribute("data-series")).toBe("1");
  });
  return wall;
}

/** 切到某一档，并等它真挂上（**走真实用户动作**，不是直接改 state）。 */
async function goTab(user: ReturnType<typeof userEvent.setup>, tab: TabUnderTest): Promise<HTMLElement> {
  await user.click(screen.getByTestId(`usim-tab-${tab.key}`));
  const panel = await screen.findByTestId("usim-mode-panel");
  await waitFor(() => expect(panel.getAttribute("data-mode")).toBe(tab.key));
  await screen.findByTestId(tab.marker);
  return panel;
}

beforeEach(() => {
  loginAs("planner");
  installHandlers();
});
afterEach(cleanup);

describe("WO-SIM-SHELL-TABS · 四页降成模式页签", () => {
  // ── ⓪ 金丝雀 ────────────────────────────────────────────────────────────────
  it("⓪ 金丝雀：探针先在**已知必中**的元素上命中 —— 不中就报「工具坏了」，不许报「页面没挂」", async () => {
    mount();
    // 三个已知必在：壳、页签条、默认档的卡墙。任何一个不中 = 本门下面所有断言都不该被信。
    expect(await screen.findByTestId("usim-shell"), "工具坏了：连壳都找不到").toBeTruthy();
    expect(screen.getByTestId("usim-tabs"), "工具坏了：页签条找不到").toBeTruthy();
    await readyNow();
    // 反向金丝雀：一个**确定不存在**的 testid 必须查不到（探针不能"什么都能找到"）。
    expect(screen.queryByTestId("usim-tab-这个档不存在")).toBeNull();
  });

  // ── ① 挂载臂 ────────────────────────────────────────────────────────────────
  it.each(TABS.map((t) => [t.label, t] as const))(
    "① 挂载 · %s：切过去 ⇒ 该页**自己的**特征元素真渲染，且壳透下去的 renderer 键就是注册表里那个",
    async (_label, tab) => {
      const user = userEvent.setup();
      mount();
      await readyNow();

      const panel = await goTab(user, tab);
      // 壳把哪个 renderer 键透下去，写在面板上 —— 挂错页会在这里当场露馅（而不是靠肉眼看内容）。
      expect(panel.getAttribute("data-renderer")).toBe(tab.renderer);
      // 该页自己的特征元素**在这块面板里面**（不是碰巧在屏幕别处）。
      expect(within(panel).getByTestId(tab.marker)).toBeTruthy();
      // 换了档就不该还留着卡墙（同一时刻只呈现一个模式的内容）。
      expect(screen.queryByTestId("usim-wall")).toBeNull();
    },
  );

  it("① 挂载 · 会话透传：四页拿到的是**壳解析好的那个会话**，不是各自另查一遍", async () => {
    const user = userEvent.setup();
    mount();
    await readyNow();
    for (const tab of TABS.filter((t) => t.key !== "linemap")) {
      const panel = await goTab(user, tab);
      // 三个适配层共用的诚实位（`consoleHostProps`）：`explicit` = 宿主显式给了会话。
      const host = within(panel).getByTestId("sandbox-console-host");
      expect(host.getAttribute("data-session-id"), `${tab.label}：应拿到壳的会话`).toBe(SESSION_ID);
      expect(host.getAttribute("data-session-reason"), `${tab.label}：应是宿主显式透传`).toBe("explicit");
    }
  });

  // ── ② 上下文不丢臂（本单的标的） ────────────────────────────────────────────
  it("② 上下文不丢：左栏改一处 + 卡墙选一张卡 → 切页签 → 切回 ⇒ 两样都还在", async () => {
    const user = userEvent.setup();
    mount();
    const wall = await readyNow();

    // ── (a) 左栏：挑一个**能按基地下钻**的因子（`data-base-drill` 由 `selectedNum` 现算，
    //        它就是左栏选择态在 DOM 上的读数），再把范围下拉改到一个真基地。
    //        两样都是纯客户端态 —— 组件一卸载就没了，正是本臂要护住的东西。
    //        ⚠ 不写死因子编号：可下钻与否由契约 `canDrillByBase(objectType)` 定，
    //        册子改了本门不该跟着红；找不到任何一个 ⇒ 报「这一臂在空转」，不读作通过。
    const scope = () => screen.getByTestId("sandbox-home-scope") as HTMLSelectElement;
    let drillable = false;
    for (const f of screen.getAllByTestId(/^sandbox-home-factor-/)) {
      await user.click(f);
      if (scope().getAttribute("data-base-drill") === "on") {
        drillable = true;
        break;
      }
    }
    expect(drillable, "左栏没有任何可按基地下钻的因子 ⇒ 这一臂在空转，不能读作通过").toBe(true);

    const before = scope().value;
    const target = Array.from(scope().querySelectorAll("option")).find((o) => !o.disabled && o.value !== before);
    expect(target, "范围下拉里应至少有第二个可选项（否则这一臂在空转）").toBeDefined();
    await user.selectOptions(scope(), (target as HTMLOptionElement).value);
    const railPicked = scope().value;
    expect(railPicked).toBe((target as HTMLOptionElement).value);

    // ── (b) 卡墙：选中第一张可点的卡（壳级 `selected`）。
    const card = within(wall).getAllByTestId(/^usim-card-/)[0] as HTMLElement;
    const cardId = card.getAttribute("data-testid") as string;
    await user.click(card);
    await waitFor(() => expect(screen.getByTestId(cardId).getAttribute("aria-pressed")).toBe("true"));

    // ── 切走：左栏必须**还在**（它属于壳，不属于任何一档）。
    await goTab(user, TABS[0] as TabUnderTest);
    expect(scope().value, "切到别的档时左栏就被卸载了 ⇒ 用户正在挑的落点当场清零").toBe(railPicked);
    expect(scope().getAttribute("data-base-drill"), "切档后左栏选中的因子也丢了").toBe("on");

    // 再切一档（多切一次：只切一次的话「第一次切没事、第二次才丢」这一形态漏得掉）。
    await goTab(user, TABS[2] as TabUnderTest);

    // ── 切回：两样都还在。
    await user.click(screen.getByTestId("usim-tab-now"));
    const wall2 = await readyNow();
    expect(scope().value, "切回来之后左栏的选择没了 —— 这正是合并要消灭的那件事").toBe(railPicked);
    expect(scope().getAttribute("data-base-drill"), "切回来之后左栏选中的因子没了").toBe("on");
    expect(
      within(wall2).getByTestId(cardId).getAttribute("aria-pressed"),
      "切回来之后卡墙的选中卡没了",
    ).toBe("true");
    // 右栏检视也应跟着回到那张卡（选中态不是只剩一个高亮壳子）。
    expect(screen.getByTestId("usim-inspector").getAttribute("data-statevar")).toBe(
      cardId.replace("usim-card-", ""),
    );
  });

  it("② 上下文不丢 · 已施加清单：切档期间左栏那份「已施加」照旧读得到", async () => {
    const user = userEvent.setup();
    mount();
    await readyNow();
    // 收起左栏 ⇒ 常驻摘要条出现，且带「已施加什么」（第 ① 单交付的那条）。
    // ⚠ 摘要条印的是**落点变量的中文名 + 幅度**（`buildRailSummary` 的口径），
    //   不是扰动记录自己的 `label` —— 期望值照它写，不照派单里那句话写。
    await user.click(screen.getByTestId("usim-rail-collapse"));
    const applied = await screen.findByTestId("usim-rail-summary-applied");
    const expectText = NAMES[PERTURBATIONS[0]?.targetStateVar as string] as string;
    expect(applied.textContent).toContain(expectText);
    expect(applied.textContent).toContain(String(PERTURBATIONS[0]?.magnitude));
    // 切到别的档，摘要条仍在（它是壳的一部分，不随档走）。
    await goTab(user, TABS[1] as TabUnderTest);
    expect(screen.getByTestId("usim-rail-summary-applied").textContent).toContain(expectText);
  });

  // ── ③ 懒加载臂 ──────────────────────────────────────────────────────────────
  it("③ 懒加载：首屏一页都没挂；**同一个探针**切过去之后逐个能找到（否定结论带金丝雀命中证据）", async () => {
    const user = userEvent.setup();
    mount();
    await readyNow();

    // 否定断言：首屏四页的特征元素一个都不在 DOM 里。
    for (const tab of TABS) {
      expect(screen.queryByTestId(tab.marker), `${tab.label} 在首屏就被挂上了`).toBeNull();
    }
    // 面板容器本身也不该存在（默认档是卡墙）。
    expect(screen.queryByTestId("usim-mode-panel")).toBeNull();

    // 金丝雀：**同一个 `queryByTestId`** 在切过去之后必须找得到 —— 否则上面那四个 `null`
    // 证明的只是"探针坏了"，不是"页面没挂"。
    for (const tab of TABS) {
      await goTab(user, tab);
      expect(screen.queryByTestId(tab.marker), `工具坏了：切到 ${tab.label} 之后仍找不到它`).not.toBeNull();
      // 且此刻**只有这一页**在 DOM 里（不是四页一起挂着、只是轮流显示）。
      for (const other of TABS.filter((x) => x.key !== tab.key)) {
        expect(screen.queryByTestId(other.marker), `在 ${tab.label} 档下 ${other.label} 也挂着`).toBeNull();
      }
    }
  });

  // ── ④ 降级不丢能力臂 ────────────────────────────────────────────────────────
  it("④ 不丢能力 · 传导识别：「关掉一条传导边」抽屉仍能被用户打开", async () => {
    const user = userEvent.setup();
    mount();
    await readyNow();
    await goTab(user, TABS[0] as TabUnderTest);

    const dock = await screen.findByTestId("sim-conduction-edge-dock");
    expect(dock.hasAttribute("open"), "抽屉默认应折叠").toBe(false);
    await user.click(screen.getByTestId("sim-conduction-edge-summary"));
    await waitFor(() => expect(dock.hasAttribute("open"), "在页签里点标题条打不开抽屉").toBe(true));
  });

  it("④ 不丢能力 · 损失归因：点明细行 ⇒ 下钻落点跟着换（页面自己的核心下钻）", async () => {
    const user = userEvent.setup();
    mount();
    await readyNow();
    const panel = await goTab(user, TABS[1] as TabUnderTest);

    const detail = within(panel).getByTestId("sandbox-attr-detail");
    // 前提自证：热矩阵这一格必须是**真回包**，占位态下这条交互到不了（见 `CHAIN_LOSS_MATRIX` 头注）。
    await waitFor(() => expect(detail.getAttribute("data-source")).toBe("endpoint"));

    const rows = within(panel).getAllByTestId(/^sandbox-attr-detail-/);
    expect(rows.length, "明细行一条都没有 ⇒ 这一臂在空转，不能读作通过").toBeGreaterThan(1);
    const first = rows[0] as HTMLElement;
    const second = rows[1] as HTMLElement;
    expect(first.className, "默认落点应在第一行").toContain(attrCss.on as string);
    expect(second.className).not.toContain(attrCss.on as string);

    await user.click(second);
    await waitFor(() => {
      expect(second.className, "在页签里点明细行，落点没跟着换").toContain(attrCss.on as string);
      expect(first.className, "旧落点没让出来（两行同时高亮 = 下钻其实没生效）").not.toContain(attrCss.on as string);
    });
  });

  it("④ 不丢能力 · 方案寻优：点候选方案卡 ⇒ 选中态迁移（页面自己的核心下钻）", async () => {
    const user = userEvent.setup();
    mount();
    await readyNow();
    const panel = await goTab(user, TABS[2] as TabUnderTest);

    const cards = within(panel).getAllByTestId(/^sandbox-opt-card-/);
    expect(cards.length, "候选方案一张都没有 ⇒ 这一臂在空转").toBeGreaterThan(1);
    // 点**当前没被选中**的那一张（照 `cards[1]` 硬点，撞上它本来就选中时断言恒真 = 空转）。
    const on = (el: Element): boolean => el.className.includes(optCss.on as string);
    const wasOn = cards.filter(on);
    const other = cards.find((c) => !on(c));
    expect(wasOn.length, "点之前应恰好有一张选中（缺省方案）").toBe(1);
    expect(other, "所有方案卡都已选中 ⇒ 这一臂在空转").toBeDefined();

    await user.click(other as HTMLElement);
    await waitFor(() => {
      expect(on(other as HTMLElement), "在页签里点方案卡，选中态没迁过来").toBe(true);
      expect(on(wasOn[0] as HTMLElement), "旧的那张没让出来（两张同时选中 = 选择其实没生效）").toBe(false);
    });

    /**
     * ⚠ **诚实边界：这一臂咬到哪儿为止。**
     * 右侧「方案详情 / 绑定约束」两格在本门里**不会跟着变**，而这不是缺陷：
     * `detailRowsOf` / `constraintRowsOf` 在 `model.source === "placeholder"` 时返回**静态**占位行
     * （见 `useParetoFrontier.ts` 的那两个 `if`），本门把 `optimize-pareto` 桩成 404 ⇒ 恒占位。
     * 所以这里**不写**「详情文字变了」那条断言 —— 写了它今天也红不了、也绿不出信息，
     * 正是本仓记过的第三种情形「**被变异的行为今天到不了**」。
     * 要咬那一格得先给这一页喂真前沿回包，那是 `sandbox-pareto-model-exit` 那道门的射程。
     */
  });

  it("④ 不丢能力 · 产销线路图：缩放条仍能改视图（页面自己的核心交互）", async () => {
    const user = userEvent.setup();
    mount();
    await readyNow();
    const panel = await goTab(user, TABS[3] as TabUnderTest);

    const readout = within(panel).getByTestId("clm-zoom-readout");
    const before = readout.textContent;
    await user.click(within(panel).getByTestId("clm-zoom-in"));
    await waitFor(() => expect(readout.textContent, "在页签里点放大，倍率读数一个字没变").not.toBe(before));
  });
});
