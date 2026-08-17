import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SandboxViewConfig, SimSession, TickState } from "@platform/contracts";

/**
 * ══ WO-SANDBOX-V3 · 推演沙盘**三区骨架**门 ══════════════════════════════════════
 * 规格：`docs/PRD-sandbox-v3-three-zone.md`（§1 三区 · §2 降层清单 · §4 验收判据）
 * 规范：`docs/CONVENTION-ui-information-layering.md`（R-UI-1/2/3 + §1 不许删除）
 *
 * ── 为什么要第四道沙盘门（前三道都绿，而仓主连问了三次「还是这么乱」）────────────
 * ① DECLUTTER（收抽屉）· ② UI-INTEGRATE（收浮层）· ③ KPI-LAYER（收折叠）——
 * 三轮都在**既有骨架内**做减法，骨架本身没动：顶栏 KPI ＋ 四张计数卡 ＋ 阻滞点长列表 ＋
 * 底部三栏，**四块平级铺开**。三道门也都只咬"某一块变小了没有"，
 * 于是**四块各自变小、门全绿、屏上照样平铺**。
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『每一块都变小了』当作『这一屏分层了』的证据，而前者并不度量后者。」**
 * 本门咬的是**骨架**：每一块**在哪个区、在第几层**，而不是它有多大。
 *
 * ── 🔴 fixture 必须接近生产规模（否则等于没测）─────────────────────────────────
 * 实测（2026-08-13，收编 KPI-LAYER 时）：沙盘五个既有套件的 `CFG.stateVars` 是 **1–2 个**，
 * 而生产是 **16 个** ⇒ 新写的分层分支**一次都没跑到**，五个套件全绿而改动零覆盖。
 * 这正是铁律 0.5 判据 6 的形态：**生产实参与测试实参交集为空**。
 * 故本门：`stateVars` **16 个**（= `apps/datacore/src/seed.ts` 传导规则派生出的那一批的规模）、
 * 阻滞点用**真基线 fixture 的 8 条**（≥ 7，= 仓主截图里那条长列表的量级）。
 * 每处 `for`/`filter` 之前都先咬**基数下限**（单参 `expect(x.length).toBeGreaterThan(n)`——
 * 双参形式 `coverage-blind` 门的 `hasCardinalityAnchor` 识别不到）。
 *
 * ── 判据（PRD §4）──────────────────────────────────────────────────────────────
 *  §1 三区各自存在且可定位（三个 testid）
 *  §2 D4 守恒**两向都咬**：① 默认**不可见**且**仍在 DOM**（是降层不是删除）
 *                        ② 打开后**同一批 testid、同样的文本**全部回来
 *     ——只咬①可能是把它删了；只咬②可能是它本来就一直在屏上。两向缺一不可。
 *  §3 输入唯一性：主区/下区的输入控件集合与白名单做**等号**比较
 *     （`toContain` 在未裁的超集上恒真 = 等于没断言，`G-SEG-SCOPE-SUPERSET-ASSERT` 同族）
 *  §4 接缝：**扰动（数据侧）× 影响传播（引擎侧）**——施加扰动后 `runImpactAnalysis`
 *     必须被真调用，且 `worldId` = 沙盘自己的会话、`change` = 那条扰动的真落点。
 *     任一半漏即红（SEAM-GATE：不是各半 unit 绿就算）。
 *
 * R6 确定性：网络全桩，无时钟、无随机。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures");

// ══════════════════════════════════════════════════════════════════════════════
// fixture · 生产规模
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 16 个状态变量 —— 名字取自 `apps/datacore/src/seed.ts` 的传导规则
 * （`sourceStateVar`/`targetStateVar` 去重升序就是 view-config 下发的那一份，`app.ts:1826`）。
 * 取真名不是为了好看：本单下区的「财务动态」判据落在**这批变量里带成本/回款语义的那几条**
 * （`priceShock → costPressure → receivablePressure → overduePressure` 是一条 4 跳传导链），
 * 编个 `s1/s2` 会让"这一带到底在显示什么"变成不可复核的问题。
 */
const STATE_VARS = [
  "costPressure",
  "demandLoad",
  "demandPressure",
  "deliveryDelay",
  "expeditePressure",
  "loadIndex",
  "overduePressure",
  "priceShock",
  "queueDays",
  "queuePressure",
  "receivablePressure",
  "shortageRisk",
  "supplyRisk",
  "utilPressure",
  "wipBacklog",
  "yieldDrift",
];

const CFG: SandboxViewConfig = {
  tenantId: "demo", // = 阻滞点 fixture 里 impediments[].tenantId
  nodeTypes: ["MaterialBatch", "MaterialBalance", "Line"], // = 基线 fixture 全部 locus.objectType
  nodeObjectIds: {
    MaterialBatch: ["mb_001", "mb_002"],
    MaterialBalance: ["mbal_001"],
    Line: ["line_001", "line_002"],
  },
  linkTypes: ["feeds", "produces"],
  stateVars: STATE_VARS,
  radarDims: [
    { key: "structure", label: "结构" },
    { key: "knowledge", label: "知识" },
    { key: "behavior", label: "行为" },
  ],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 13,
};

/** 阻滞点：**真基线 fixture**（8 条 · counts 2/3/3）—— 与 `imp2plan.seam` 同一份，不另造一套。 */
function loadImp(): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(join(FIX, "chain-impediment-baseline.json"), "utf8")) as Record<string, unknown>;
  delete raw.__fixture_provenance;
  return raw;
}
const IMP = loadImp();
const IMP_ROWS = IMP.impediments as { impedimentId: string }[];

/** 建会话时后端回的那份 baseSnapshot（= 下区差分的左端）。桩里捕获，测试据此现算期望值。 */
let capturedBase: TickState = {};
/** 施加扰动后后端回的世界态。默认 = 基线（"一项都没动"那一档），单条用例里再改。 */
let perturbedState: TickState | null = null;

const { runImpactFn } = vi.hoisted(() => ({ runImpactFn: vi.fn() }));

vi.mock("@/api/endpoints", () => ({
  fetchWorkspace: vi.fn(),
  fetchSimViewConfig: vi.fn(),
  runSolver: vi.fn(async (key: string) =>
    key === "chain_impediments"
      ? { data: IMP, snapshotVersion: "ov-test" }
      : Promise.reject({ error: { code: "NOT_STUBBED", message: "本门不桩 chain_loss_attribution", requestId: "req_test" } }),
  ),
  createSimSession: vi.fn(async (body: { baseSnapshot: TickState }) => {
    capturedBase = body.baseSnapshot;
    return {
      id: "sims_v3",
      tenantId: "demo",
      baseSnapshot: body.baseSnapshot,
      scope: {},
      status: "READY",
      curTick: 0,
      parentCheckpointId: null,
      createdAt: "2026-08-13T00:00:00.000Z",
    } satisfies SimSession;
  }),
  createSimPerturbation: vi.fn(async (sessionId: string, body: Record<string, unknown>) => ({
    perturbation: {
      id: "simpert_v3",
      tenantId: "demo",
      sessionId,
      kind: body.kind,
      targetObjectId: body.targetObjectId,
      targetStateVar: body.targetStateVar,
      startTick: 0,
      durationTicks: body.durationTicks ?? null,
      magnitude: body.magnitude,
      mode: body.mode,
      label: body.label,
      createdAt: "2026-08-13T00:00:00.000Z",
    },
    state: perturbedState ?? capturedBase,
    curTick: 0,
  })),
  fetchSimPerturbations: vi.fn(async () => ({ items: [] })),
  deleteSimPerturbation: vi.fn(),
  simTick: vi.fn(async (_id: string, n: number) => ({ curTick: n, state: perturbedState ?? capturedBase })),
  simWorld: vi.fn(async () => ({ tick: 0, state: capturedBase })),
  fetchSimSessions: vi.fn(async () => ({ items: [] })),
  simCheckpoint: vi.fn(),
  simBranch: vi.fn(),
  fetchSimCompare: vi.fn(),
  createActionDraft: vi.fn(),
  fetchSimCertification: vi.fn(async () => null),
  runImpactAnalysis: runImpactFn,
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

const ready = async () => {
  await screen.findByTestId("sandbox-console");
  // 阻滞点扫描回来（下区汇总条 / 逐条清单都等它）——不等就会在空 model 上做断言。
  await waitFor(() => expect(screen.getByTestId("sc-impjump-count")).toBeTruthy());
};

beforeEach(() => {
  capturedBase = {};
  perturbedState = null;
  runImpactFn.mockReset();
  /**
   * 影响传播响应 —— **按契约 `ImpactAnalysisResponseSchema` 写全**。
   *
   * ⚠ 这里踩过一次（本门第一版）：`basis` 少了 `kpiTypeKeys` ⇒ 面板在渲染期抛
   *   `Cannot read properties of undefined (reading 'join')` ⇒ **整棵树被 React 卸掉**，
   *   于是失败信息是「找不到 `sandbox-perturbation-last`」——指向一个跟病因毫不相干的地方。
   *   桩要按契约写全，否则读到的红是桩的红，不是代码的红。
   *
   * KPI 维给**真内容**（`metricKey`/`unit`/`before→after`）：它就是本单判定里
   * 「平台今天唯一带单位、且在被隔离世界里随变更重算」的那个出处，桩成空会让这条判定不可复核。
   */
  runImpactFn.mockResolvedValue({
    basis: {
      engine: "ontology-core.recompute",
      worldId: "sims_v3",
      worldTick: 0,
      worldStatus: "READY",
      worldOverlayApplied: 1,
      countBasis: "DISTINCT_OBJECTS",
      derivationSpecCount: 3,
      kpiTypeKeys: ["Metric"],
      oldValueMismatch: false,
    },
    affectedObjects: { available: true, count: 2, universe: 5, items: [], truncated: false },
    affectedProcesses: {
      available: true,
      count: 0,
      universe: 0,
      items: [],
      truncated: false,
      instanceLevel: { available: false, reason: "流程实例今天无承载物", missingCarrier: "ProcessInstance" },
    },
    affectedDecisions: { available: true, count: 0, universe: 0, items: [], truncated: false },
    affectedKpis: {
      available: true,
      count: 1,
      universe: 4,
      items: [
        {
          objectId: "metric_gm",
          metricKey: "gross_margin",
          name: "毛利率",
          unit: "%",
          changedProps: [{ prop: "actual", before: 18.4, after: 16.1 }],
          breach: "BREACHED",
        },
      ],
      truncated: false,
    },
    warnings: [],
  });
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════════
describe("§1 · 三区各自存在且可定位（PRD §4.1）", () => {
  it("三个区 testid 都在，且三者互不嵌套（嵌套 = 还是一个区，只是多了几个 div）", async () => {
    mount();
    await ready();
    const input = screen.getByTestId("sandbox-zone-input");
    const canvas = screen.getByTestId("sandbox-zone-canvas");
    const impact = screen.getByTestId("sandbox-zone-impact");
    for (const [a, b] of [
      [input, canvas],
      [canvas, impact],
      [input, impact],
    ] as const) {
      expect(a.contains(b), "两个区互相嵌套 ⇒ 它们不是两个区").toBe(false);
      expect(b.contains(a), "两个区互相嵌套 ⇒ 它们不是两个区").toBe(false);
    }
  });

  it("主区的主画布 = 全链线路图；物理拓扑/链路阶段/本体拓扑是**同区内的档位**，不是平级页", async () => {
    mount();
    await ready();
    const canvas = screen.getByTestId("sandbox-zone-canvas");
    // 默认档 = 线路图（PRD §1②「`ChainLineMapView` 提为主画布」）
    expect(screen.getByTestId("sc-mode-metro").getAttribute("aria-pressed")).toBe("true");
    // 四个档位全部在**主区之内** —— 在区外就意味着它们仍与主画布平级抢位
    const gears = ["metro", "topo", "chain", "ontology"];
    expect(gears.length).toBeGreaterThan(3);
    for (const m of gears) {
      expect(canvas.contains(screen.getByTestId(`sc-mode-${m}`)), `档位 ${m} 不在主区内`).toBe(true);
    }
    // 节点检视也在主区（PRD §2 第 5 行「主区节点检视面板」）：点了节点在同一区里看结果，
    // 视线不用横跨整屏（规范 R-UI-1）。
    expect(canvas.contains(screen.getByTestId("sc-inspect-pane"))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 · D4 守恒 —— PRD §2 那张表**逐行**，两向都咬
// ══════════════════════════════════════════════════════════════════════════════

/**
 * PRD §2 表的机器可读版。**两向断言共用同一份**（共用是刻意的：
 * 哪天有人只改了其中一向的清单，两向就会对不上而当场红）。
 *
 *  · `row`      PRD §2 表里的第几行（复审时能一眼对上）
 *  · `probes`   降到第二层的那些 testid（**至少一个**，逐个两向咬）
 *  · `opener`   打开它的那个 summary 的 testid
 *  · `mark`     第一层留下的**可见记号** —— 规范 §1：静默降层等于删除
 */
const STOWED: { row: number; what: string; probes: string[]; opener: string; mark: string }[] = [
  {
    row: 3,
    what: "阻滞点长列表（截图里 7 行，本 fixture 8 行）",
    probes: IMP_ROWS.slice(0, 3).map((r) => `sc-imp-jump-${r.impedimentId}`),
    opener: "sc-impjump-summary",
    mark: "sc-impjump-count",
  },
  {
    row: 4,
    what: "范围（业务线/基地勾选）",
    probes: ["sc-base-list", "sc-dim-baseIds"],
    opener: "sc-scope-summary",
    mark: "sc-scope-summary-val",
  },
];

describe("§2 · D4 守恒：允许降层，绝不允许删除（PRD §2 逐行 · 两向都咬）", () => {
  it("清单本身非空且覆盖 PRD §2 里**需要本单动手**的那几行（空清单会让下面两向恒真）", () => {
    expect(STOWED.length).toBeGreaterThan(1);
    const probeCount = STOWED.flatMap((s) => s.probes).length;
    expect(probeCount).toBeGreaterThan(3);
  });

  it("① 默认**不可见**，但**仍在 DOM** —— 只咬「不可见」分不出降层与删除", async () => {
    mount();
    await ready();
    for (const s of STOWED) {
      expect(s.probes.length).toBeGreaterThan(0);
      for (const id of s.probes) {
        const el = screen.getByTestId(id);
        expect(el, `第 ${s.row} 行「${s.what}」的 ${id} 从 DOM 里没了 ⇒ 这是删除，不是降层（违反 D4）`).toBeInTheDocument();
        expect(el, `${id} 默认就可见 ⇒ 它根本没降层（第 ${s.row} 行「${s.what}」）`).not.toBeVisible();
      }
      // 第一层记号必须**看得见**：静默降层等于删除（规范 §1）
      expect(screen.getByTestId(s.mark), `第 ${s.row} 行降层后第一层没留可见记号`).toBeVisible();
    }
  });

  it("② 打开之后**同一批 testid、同样的文本**全部回来", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    for (const s of STOWED) {
      // 基数下限（`coverage-blind` 门 LOOP_NO_FLOOR）：probes 为空时下面整段跑 0 圈、照样绿。
      // ⚠ 必须是**单参** `expect(x.length)` —— 该门的 `hasCardinalityAnchor` 认的是
      //   `expect(EXPR.length)`，双参 `expect(EXPR.length, "msg")` 它识别不到（实测 2026-08-13；
      //   复验：`node scripts/check-coverage-blind.mjs`，正则见 `scripts/check-coverage-blind.mjs:306`）。
      expect(s.probes.length).toBeGreaterThan(0);
      // 先记下折叠态的文本，展开后逐字比 —— 只比"在不在"会漏掉「回来了但内容被改写」这一形态。
      const before = s.probes.map((id) => screen.getByTestId(id).textContent ?? "");
      await user.click(screen.getByTestId(s.opener));
      const after: string[] = [];
      for (const id of s.probes) {
        const el = screen.getByTestId(id);
        expect(el, `${id} 展开后仍不可见 ⇒ 打开的不是它所在的那一层`).toBeVisible();
        after.push(el.textContent ?? "");
      }
      expect(after, `第 ${s.row} 行「${s.what}」展开后文本变了 ⇒ 降层顺手改了内容`).toEqual(before);
    }
  });

  it("第 2 行 · 四张计数卡：**四个数字仍在**（等于引擎 counts），但已搬进下区且不再各占一张大卡", async () => {
    mount();
    await ready();
    const impact = screen.getByTestId("sandbox-zone-impact");
    const counts = IMP.counts as Record<string, number>;
    const kinds = ["BOTTLENECK", "CONGESTION", "BREAK"];
    expect(kinds.length).toBeGreaterThan(2);
    for (const k of kinds) {
      const card = screen.getByTestId(`sc-imp-${k}`);
      expect(impact.contains(card), `计数卡 ${k} 不在下区 ⇒ PRD §2 第 2 行没落实`).toBe(true);
      // 数字仍是引擎那一份（降层/搬家不许顺手改口径）
      expect(screen.getByTestId(`sc-imp-${k}-count`).textContent).toBe(String(counts[k]));
    }
    expect(impact.contains(screen.getByTestId("sc-imp-FLOW"))).toBe(true);

    // 「不再各占一张大卡」的**机制**判据：`.impBar` 不再是等宽四列 grid。
    // 只咬"在下区"证明不了这一半 —— 搬过去照样可以是四张大卡。
    const rawCss = readFileSync(join(HERE, "../src/views/sim/SandboxConsole.module.css"), "utf8");
    expect(rawCss, "金丝雀规则 `.impCard` 都找不到 ⇒ 读错文件了").toContain(".impCard");
    const body = rawCss.match(/\.impBar\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(body.length, "没抓到 .impBar 规则体").toBeGreaterThan(0);
    expect(body.includes("grid-template-columns"), "`.impBar` 还在用等宽列 grid ⇒ 仍是四张平铺大卡").toBe(false);
  });

  it("第 1 行 · 16 个 stateVar 读数：第一层 3 个，其余在 `<details>` 里（③轮成果不许被本单撞掉）", async () => {
    mount();
    await ready();
    expect(CFG.stateVars.length).toBeGreaterThan(8);
    const rest = screen.getByTestId("sandbox-kpi-rest");
    const inRest = CFG.stateVars.filter((v) => within(rest).queryByTestId(`sandbox-kpi-${v}`) !== null);
    const inFirst = CFG.stateVars.filter((v) => !inRest.includes(v));
    // 等号，不是 `toContain`：条数写死成 3 是 `FIRST_LAYER_KPIS` 的承诺，多一个少一个都该红。
    expect(inFirst.length).toBe(3);
    expect(inRest.length).toBe(CFG.stateVars.length - 3);
    // D4：一个都不许少
    for (const v of CFG.stateVars) expect(screen.getByTestId(`sandbox-kpi-${v}`)).toBeInTheDocument();
  });

  it("折叠段 summary 上的数**不许撒谎**：写几项就必须真有几项（现数，不写死）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    // 全链指标：summary 说「N 项」，展开后 `sc-metric-*` 必须正好 N 张
    const claimed = Number((screen.getByTestId("sc-metrics-summary").textContent ?? "").match(/\d+/)?.[0] ?? "-1");
    expect(claimed).toBeGreaterThan(0);
    await user.click(screen.getByTestId("sc-metrics-summary"));
    const cards = Array.from(screen.getByTestId("sc-metrics").querySelectorAll("[data-testid^='sc-metric-']"));
    expect(cards.length, "summary 上的条数与真实卡片数对不上 ⇒ 第一层记号在撒谎").toBe(claimed);

    // 阻滞点：summary 说几条，展开后逐条清单的 data-count 必须相等（两侧同源 `impedimentHandoffs`）
    const jumpClaim = Number(screen.getByTestId("sc-impjump-count").textContent ?? "-1");
    expect(jumpClaim).toBe(IMP_ROWS.length);
    await user.click(screen.getByTestId("sc-impjump-summary"));
    expect(screen.getByTestId("sc-imp-jump").getAttribute("data-count")).toBe(String(jumpClaim));
  });

  it("第 7 行 · 多场景对比 / AI 指挥台：**层不变**（仍是默认收起的折叠区），只是随左区搬了家", async () => {
    mount();
    await ready();
    const input = screen.getByTestId("sandbox-zone-input");
    const stack = screen.getByTestId("sc-rail-stack");
    expect(input.contains(stack), "折叠区没跟着进左区 ⇒ 它带的动作按钮会落在只读区").toBe(true);
    const ids = ["sc-rail-compare", "sc-rail-commander"];
    expect(ids.length).toBeGreaterThan(1);
    for (const id of ids) {
      const d = screen.getByTestId(id) as HTMLDetailsElement;
      expect(stack.contains(d), `${id} 不在 sc-rail-stack 里`).toBe(true);
      expect(d.open, `${id} 默认展开了 ⇒ 层变了（PRD §2 末两行判的是「不动」）`).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§3 · 输入唯一性：主区与下区**零输入控件**（PRD §4.4）", () => {
  /**
   * 白名单 —— PRD §4.4 原话「『展开/切档』这类**纯视图控件**除外并显式列白名单」。
   *
   * 判据不是"它长得像不像输入"，是**它改的是什么**：
   *  · 改**世界态 / 真值**            ⇒ 输入，必须在左区（本清单里一个都没有）
   *  · 改**这一屏怎么显示**（档位/图层/看哪个节点）⇒ 视图控件，允许留在主区
   * 少了这条判据，白名单就会变成"凡是我懒得挪的都写进来"。
   */
  const VIEW_CONTROL_WHITELIST = [
    "sc-family-toggle", // 产品族同心环：图层开关（改画什么，不改世界）
    "sc-transit-toggle", // 在途批次图层：图层开关
  ];
  /**
   * 判据的选择器**逐字照 PRD §4.4**：`<input>/<select>/<button type=submit>`。
   * 画布档位（`sc-mode-*`）与检视页签（`sc-tab-*`）是 `<button type="button">`，
   * 按 PRD 的字面判据本就不计 —— 它们也确实只切档、不改世界。
   * 不擅自把选择器扩到"所有 button"：那会把「点了进决策推演」这类**导航**也算成输入，
   * 度量的就不是 PRD 要的那个东西了。
   */
  const SELECTOR = 'input, select, textarea, button[type="submit"]';

  /** 一个元素在**哪个带 testid 的祖先**下 —— 白名单按 testid 记，不按 DOM 路径记。 */
  function ownerTestId(el: Element): string {
    let cur: Element | null = el;
    while (cur !== null) {
      const t = cur.getAttribute("data-testid");
      if (t !== null && t !== "") return t;
      cur = cur.parentElement;
    }
    return "(无 testid 祖先)";
  }

  /** 比较器全序：平手返回 0（`a<b?-1:1` 对相等元素恒不返回 0，违反契约，V8 给任意顺序）。 */
  const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

  function controlsIn(zone: HTMLElement): string[] {
    return [...new Set(Array.from(zone.querySelectorAll(SELECTOR)).map(ownerTestId))].sort(byName);
  }

  it("主区 + 下区的输入控件集合 **等于** 白名单（等号，不是 toContain —— 后者在超集上恒真）", async () => {
    mount();
    await ready();

    /**
     * 🐤 金丝雀：同一条选择器打在**左区**（已知必中的那一面）。
     *
     * 这一条不是装饰。本判据的结论形态是**否定式**（「主区/下区里没有输入控件」），
     * 而选择器写错时得到的也是一个空集 —— 两者在门里长得一模一样。
     * 报「零命中」之前必须先证明工具是好的（CLAUDE.md 铁律 0.6）。
     * 且它与主逻辑**共用同一份 `SELECTOR` 与 `controlsIn`**，不另抄一份：
     * 抄了就是装饰品——改主选择器时金丝雀拿旧的去测、照样绿。
     */
    const canaryLeft = controlsIn(screen.getByTestId("sandbox-zone-input"));
    expect(canaryLeft.length, "同一条选择器在左区也扫不到输入控件 ⇒ **门自己瞎了**，不是页面干净").toBeGreaterThan(3);

    const found = [
      ...new Set([
        ...controlsIn(screen.getByTestId("sandbox-zone-canvas")),
        ...controlsIn(screen.getByTestId("sandbox-zone-impact")),
      ]),
    ].sort(byName);
    expect(found, "主区/下区多出了白名单外的输入控件 —— 输入必须在左区（PRD §1①「唯一输入区」）").toEqual(
      [...VIEW_CONTROL_WHITELIST].sort(byName),
    );
  });

  it("扰动输入整套在左区，且主区/下区里一个都找不到", async () => {
    mount();
    await ready();
    const input = screen.getByTestId("sandbox-zone-input");
    const canvas = screen.getByTestId("sandbox-zone-canvas");
    const impact = screen.getByTestId("sandbox-zone-impact");
    const ids = [
      "sandbox-perturbation-kind",
      "sandbox-perturbation-object",
      "sandbox-perturbation-statevar",
      "sandbox-perturbation-mode",
      "sandbox-perturbation-magnitude",
      "sandbox-perturbation-duration",
      "sandbox-perturbation-apply-btn",
    ];
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) {
      const el = screen.getByTestId(id);
      expect(input.contains(el), `${id} 不在左区 ⇒ 输入区不唯一`).toBe(true);
      expect(canvas.contains(el)).toBe(false);
      expect(impact.contains(el)).toBe(false);
      // 扰动是这一区的主角：**不点就看见**（不许再被塞进一层默认展开的折叠块里）
      expect(el, `${id} 默认不可见 ⇒ 沙盘唯一的动作入口又被藏起来了`).toBeVisible();
    }
  });

  it("R4：左区没有任何直写本体真值的入口 —— 写真值只有「采纳」那一条，且它走 ActionDraft", async () => {
    mount();
    await ready();
    const input = screen.getByTestId("sandbox-zone-input");
    // 采纳按钮在（沙盘 → 真值的唯一正门）
    expect(input.contains(screen.getByTestId("sandbox-adopt-btn"))).toBe(true);
    // 而扰动那条路写的是 SimSession 世界态：它的说明必须常驻，不许降层
    expect(screen.getByTestId("sandbox-perturbation-note").textContent ?? "").toContain("采纳才经 Action 正门写真值");
  });

  /**
   * WO-UI-BURNDOWN-21（2026-08-14）· 扰动说明那一段的**分层接缝**。
   *
   * 这条与上面那条是**一对**，缺一不可：
   *  · 上面咬「R4 诚实位必须常驻第一层」（规范 §4.2：它为真会改变用户对整块的解读）；
   *  · 本条咬「中间那段机制说明确实降进了浮层，且**原文一字不少**」。
   * 只有上面那条，降层做过头把 R4 那句也藏了不会红；只有本条，把整段留在第一层也不会红。
   */
  it("分层接缝：扰动说明的机制部分降进 `?`，R4 那句仍在第一层，且降层不是删除", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const note = screen.getByTestId("sandbox-perturbation-note");

    // ① 第一层：两个结论都在，中间那段机制说明**不在**。
    expect(note.textContent ?? "").toContain("扰动作用在");
    expect(note.textContent ?? "").toContain("采纳才经 Action 正门写真值");
    expect(note.textContent ?? "", "机制说明还摆在第一层 ⇒ 降层没做").not.toContain("扩散到下游");

    // ② `?` 记号默认可见；浮层正文默认不在 DOM。
    //    ⚠ 用 `toBeNull()`：关着时 `queryByTestId` 返回 null，`not.toBeVisible()` 会让 jest-dom
    //    抛 "received value must be an HTMLElement" —— 那是测试自己报错，不是判据成立。
    expect(within(note).getByTestId("info-sandbox-perturb-after")).toBeVisible();
    expect(screen.queryByTestId("info-body-sandbox-perturb-after")).toBeNull();

    // ③ 触发后原文还在 —— 这一条才是"没删内容"的证据。
    await user.hover(within(note).getByTestId("info-wrap-sandbox-perturb-after"));
    const body = await screen.findByTestId("info-body-sandbox-perturb-after");
    expect(body.textContent, "降层把这段降没了 —— 那是删除不是分层").toContain("引擎沿本体链路把它扩散到下游");
    expect(body.textContent).toContain("填了持续 tick 数的到期还会自动回退");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§4 · 下区影响带 —— 扰动 × 影响传播的**接缝**（SEAM-GATE）", () => {
  const applyPerturbation = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.selectOptions(screen.getByTestId("sandbox-perturbation-object"), "mb_001");
    await user.selectOptions(screen.getByTestId("sandbox-perturbation-statevar"), "costPressure");
    await user.click(screen.getByTestId("sandbox-perturbation-apply-btn"));
    await screen.findByTestId("sandbox-perturbation-last");
  };

  it("两半都在下区：逐节点指标影响 ＋ 财务/世界态动态变化（PRD §1③「两半，左右分列」）", async () => {
    mount();
    await ready();
    const impact = screen.getByTestId("sandbox-zone-impact");
    expect(impact.contains(screen.getByTestId("sandbox-impact-nodes"))).toBe(true);
    expect(impact.contains(screen.getByTestId("sandbox-impact-finance"))).toBe(true);
  });

  it("🔴 接缝：施加扰动 ⇒ `runImpactAnalysis` 真被调用，且 worldId = 沙盘自己的会话、change = 那条扰动的真落点", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    // 未施加扰动前**不许**发请求：没有假设就没有影响，跑一次得到的是"改了个空"的结论。
    expect(runImpactFn).not.toHaveBeenCalled();
    expect(screen.getByTestId("impact-need-change").textContent ?? "").toContain("左区还没有施加扰动");

    // 扰动把 costPressure 从基线抬到 88（下一条用例据此现算差分）
    perturbedState = { ...capturedBase, mb_001: { ...capturedBase.mb_001, costPressure: 88 } };
    await applyPerturbation(user);

    await waitFor(() => expect(runImpactFn).toHaveBeenCalled());
    const arg = runImpactFn.mock.calls[0]![0] as { worldId: string; change: Record<string, unknown> };
    expect(arg.worldId, "影响传播跑在了别的世界上 ⇒ 屏上画布是 A 世界、影响是 B 世界（静默错答）").toBe("sims_v3");
    // change 逐键 = 用户在左区真选的那四个维度（不是写死的默认值）
    expect(arg.change.objectId).toBe("mb_001");
    expect(arg.change.prop).toBe("costPressure");
    expect(arg.change.objectType).toBe("MaterialBatch");
    expect(arg.change.value).toBe(88);
    // 下区里没有那个「在世界里分析影响」按钮（它已由 autoRun 取代 —— 否则下区就有输入控件了）
    expect(screen.queryByTestId("impact-run"), "下区还留着运行按钮 ⇒ 破 PRD §4.4 输入唯一性").toBeNull();
    expect(screen.getByTestId("impact-world-fixed").textContent).toBe("sims_v3");
  });

  it("世界态差分：未扰动时**逐项与基线相等**（是「比过了没动」不是「没比」）", async () => {
    mount();
    await ready();
    expect(screen.getByTestId("sandbox-impact-delta-head").textContent ?? "").toContain("一项都没动");
    // 16 项一个不少（差分带不许只显示"有意思的那几个"）
    const rest = screen.getByTestId("sandbox-impact-delta-rest-list");
    const rows = Array.from(rest.querySelectorAll("[data-testid^='sandbox-impact-delta-']"));
    expect(rows.length).toBeGreaterThan(8);
    expect(CFG.stateVars.length).toBeGreaterThan(8); // 单参，同上：双参的 `coverage-blind` 认不出
    for (const v of CFG.stateVars) {
      expect(within(rest).getByTestId(`sandbox-impact-delta-${v}`), `${v} 没出现在差分带里`).toBeInTheDocument();
    }
  });

  it("世界态差分：扰动后只有被扰的那一项进第一层，且变化量**从屏上两个读数现算**（不写死）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    perturbedState = { ...capturedBase, mb_001: { ...capturedBase.mb_001, costPressure: 88 } };
    await applyPerturbation(user);

    await waitFor(() => expect(screen.getByTestId("sandbox-impact-delta-list")).toBeTruthy());
    const moved = Array.from(
      screen.getByTestId("sandbox-impact-delta-list").querySelectorAll("[data-testid$='-amt']"),
    ).map((e) => (e.getAttribute("data-testid") ?? "").replace(/^sandbox-impact-delta-|-amt$/g, ""));
    // 等号：`toContain` 在"全都进了第一层"这个超集上恒真，那正是本单要防的病。
    expect(moved).toEqual(["costPressure"]);

    /**
     * 变化量**从屏上现算**，不写死。
     * 世界态来自 `deriveBaseSnapshot` / `simWorld` / `simTick` 三处，写死期望等于赌哪一处赢。
     * 这里只断言一条**恒等式**：屏上那行的 `base → now` 与它右边的变化量必须自洽。
     */
    const vals = screen.getByTestId("sandbox-impact-delta-costPressure-vals").textContent ?? "";
    const nums = vals.match(/-?\d+(?:\.\d+)?/g) ?? [];
    expect(nums.length).toBe(2);
    const expected = Number(nums[1]) - Number(nums[0]);
    const amt = screen.getByTestId("sandbox-impact-delta-costPressure-amt").textContent ?? "";
    expect(amt).toBe(`${expected > 0 ? "+" : "−"}${Math.abs(expected).toFixed(1)}`);
    expect(screen.getByTestId("sandbox-impact-delta-head").textContent ?? "").toContain("1 / 16");
  });

  /**
   * 🔴 本单三形态判定的**机器可核版**（报告 §③ 的那条结论，不许只写在文档里）。
   *
   * 判定：「财务指标随扰动的动态变化」= 形态③「接了线接错地方」，修法是**补挂载点**。
   * 平台今天唯一「带单位、且在被隔离世界里随变更重算」的指标出处 = `affectedKpis`
   * （`AffectedKpiItem`：`metricKey` / `unit` / `changedProps[].before→after` / `breach`）。
   * 这一条咬的就是：**那个出处真的到了沙盘下区的屏上**，且带着 before→after。
   * 反面（本单刻意不做的那条）：`finance_pnl` 不吃世界态 ⇒ 摆上来永远不动，见下一条诚实位用例。
   */
  it("🔴 金额型指标随扰动动：KPI 维（metricKey/unit/before→after）真的到达下区的屏上", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    perturbedState = { ...capturedBase, mb_001: { ...capturedBase.mb_001, costPressure: 88 } };
    await applyPerturbation(user);
    await waitFor(() => expect(runImpactFn).toHaveBeenCalled());

    const band = await screen.findByTestId("sandbox-impact-nodes");
    // 明细是第二层（规范 §1）：点一次才出 —— 先证明它默认不在，再证明点了就在（两向）。
    expect(within(band).queryByTestId("impact-detail-kpis")).toBeNull();
    await user.click(within(band).getByTestId("impact-detail-toggle"));

    const row = await within(band).findByTestId("impact-kpi-metric_gm");
    const txt = row.textContent ?? "";
    expect(txt).toContain("gross_margin"); // 指标键（带业务语义的那个 key）
    expect(within(band).getByTestId("impact-kpi-breach-metric_gm").textContent).toBe("BREACHED");
    // 这一维必须在**下区**，不是在别处（挂错地方正是本单修的那个病）
    expect(screen.getByTestId("sandbox-zone-impact").contains(row)).toBe(true);
  });

  it("诚实位：金额口径为什么不在这一带 —— 第一层留记号，正文在浮层（两向）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    // ① 默认不渲染正文（是不渲染，不是藏起来）
    expect(screen.queryByTestId("sandbox-impact-finance-gap")).toBeNull();
    // 第一层的可见记号（`?` 触发器）在
    const trigger = screen.getByTestId("info-impact-finance-gap");
    expect(trigger).toBeVisible();
    // ② 打开后正文回来，且明写「这个数是推演投影、不是本租户实际损益」这件事
    await user.hover(trigger);
    const body = await screen.findByTestId("sandbox-impact-finance-gap");
    const txt = body.textContent ?? "";
    /**
     * ⚠ 2026-08-17 WO-SCREEN-PLAINSPEAK 改判据落点，**守的承诺一个字没放宽**。
     *
     * 原断言咬的是 `"finance_pnl"` 与 `"不吃 worldId / sessionId"` —— 那是**求解器键名**
     * 与**函数签名参数名**，属 R-UI-4 点名的开发话（用户读了做不出任何决定）。
     * 本单把它们**移进代码注释**（`locales/zh.ts` 的 `financeGapBody` 上方那段注释，
     * 原文「勿与求解器 `finance_pnl` 混：它读本体真值、签名不吃 worldId/sessionId」）
     * ——**是移走不是删除**，工程师要查依然查得到，只是不再印在用户屏上。
     *
     * ⛔ 所以这里**不能**改成咬新措辞里的某个词就算完 —— 那样只是换个字符串。
     * 判据必须落在**这条诚实位对用户的承诺**上，它有两半，缺一即红：
     *   ① 这个数是**推演投影、不是实测值**；
     *   ② 它与**本租户实际损益**是两回事（原文「别和 finance_pnl 搞混」的人话版）。
     * 两半都在 ⇒ 用户拿到的信息与改写前**等价**；删掉任一半 ⇒ 这里当场红。
     */
    expect(txt, "没说清这是推演投影 ⇒ 用户会把它当实测损益读").toContain("推演投影");
    expect(txt, "没说清「不是实测值」").toContain("不是实测值");
    expect(txt, "没把它与「本租户实际损益」划清界限 ⇒ 原诚实位被删掉了，不是降层").toContain("实际损益");
  });
});
