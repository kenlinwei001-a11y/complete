import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropagationRule, SandboxViewConfig, SimSession, TickState } from "@platform/contracts";

/**
 * ══ WO-SANDBOX-CONFIG-UX · 扰动因素 × 本体关系**同屏**门 ══════════════════════════
 *
 * 参照物：`docs/REF-config-page-ux.html`（配置页 tab 的版式）
 *        `docs/REF-ontology-twin-ux.html`（本体关系的语义分层：原生量/派生量 · 公式 · 启停即重算）
 *
 * 命题（仓主原话三句压成一句可验收的话）：
 *   **同一屏上左边拨扰动因素、右边是本体关系（含图），改任一侧另一侧当场变。**
 *
 * ── 这一门与既有五道沙盘门的分工（不重复咬同一件事）─────────────────────────────
 *  · `sandbox-three-zone.seam`   咬「每一块在哪个区、在第几层」——**骨架**
 *  · `edge-active.seam`          咬「拨一条边 ⇒ 差值表出数」——**关系表自己**
 *  · 本门                        咬「两块在**同一屏**上，且**互相驱动**」——**接缝**
 *    任一半单独绿都不算：关系表自己绿、扰动表单自己绿，而两者分居两屏时，
 *    「拨一下看关系怎么变」这个动作在屏上依然连不起来。这正是 SEAM-GATE 要堵的形态。
 *
 * ── 🔴 判据一律落在**数 / 计算样式 / DOM 结构**，不落在类名与复选框状态 ────────────
 *  · 「下游读数真变」   → 屏上那两个数（可达量纲数 / 可达边数）真的变小
 *  · 「改边即重画」     → 图的节点数与边数（`data-*` 由渲染现算）真的变
 *  · 「派生可分」       → `getComputedStyle(rect).strokeDasharray`（**计算样式**，不是 class）
 *  · 「切片有效」       → 不在当前片的行**不在 DOM 里**（`<details>` 折叠时子节点照样在 DOM，
 *                        拿存在性判永远绿 —— 本仓已有 dev 栽过这条）
 *
 * R6 确定性：网络全桩，无时钟、无随机。
 */

// ══════════════════════════════════════════════════════════════════════════════
// fixture
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 传导边 fixture。**结构照生产的形状造，不是随手编的两条**：
 *  · 一条 **3 跳链**（A.v0 → B.v1 → C.v2 → D.v3）—— 关掉中间那一跳，下游会**整段掉**，
 *    这才测得到「可达集变小」；只有 1 跳的 fixture 关掉后可达从 1 变 0，
 *    分不出「链断了」与「本来就只有一条」。
 *  · 一条**旁支**（A.v0 → E.v4）—— 关掉主链后旁支必须还在，否则"变小"可能是"整个没了"。
 *  · **两个域 + 一个未归域** —— 逼出 chip 切片那条判据（生产实测 9 域 + 未归域 = 10 片）。
 *
 * ⚠ 生产规模在这里说清楚，不假装 fixture 就是生产：demo 租户实测 **35 条边 / 10 个分片 /
 *   每片 2–7 行**（`apps/datacore/src/seed.ts` 的 `DEMO_PROPAGATION_RULES` × `resolveRuleDomain`）。
 *   本门的 fixture 只求**形状**齐全（多跳 + 旁支 + 多域 + 未归域），不求条数相等 ——
 *   条数相等对本门这几条判据不增加任何覆盖，而 35 条会让失败信息不可读。
 */
const RULE_DEFAULTS = {
  tenantId: "demo",
  combine: "sum" as const,
  decay: null,
  clamp: null,
  coefficientRef: null,
  cadenceNodeId: null,
  status: "PUBLISHED" as const,
  sourceTypeName: null,
  targetTypeName: null,
};

const RULES: PropagationRule[] = [
  {
    ...RULE_DEFAULTS,
    id: "r1",
    key: "a_to_b",
    sourceTypeKey: "TypeA",
    sourceStateVar: "v0",
    viaLinkKey: "l1",
    targetTypeKey: "TypeB",
    targetStateVar: "v1",
    coefficient: 0.5,
    delayTicks: 0,
    domainKey: "D01",
    domainName: "域一",
    sourceTypeName: "甲类对象",
    targetTypeName: "乙类对象",
  },
  {
    ...RULE_DEFAULTS,
    id: "r2",
    key: "b_to_c",
    sourceTypeKey: "TypeB",
    sourceStateVar: "v1",
    viaLinkKey: "l2",
    targetTypeKey: "TypeC",
    targetStateVar: "v2",
    coefficient: 0.4,
    delayTicks: 1,
    domainKey: "D01",
    domainName: "域一",
  },
  {
    ...RULE_DEFAULTS,
    id: "r3",
    key: "c_to_d",
    sourceTypeKey: "TypeC",
    sourceStateVar: "v2",
    viaLinkKey: "l3",
    targetTypeKey: "TypeD",
    targetStateVar: "v3",
    coefficient: 0.3,
    delayTicks: 0,
    domainKey: "D02",
    domainName: "域二",
  },
  {
    ...RULE_DEFAULTS,
    id: "r4",
    key: "a_to_e",
    sourceTypeKey: "TypeA",
    sourceStateVar: "v0",
    viaLinkKey: "l4",
    targetTypeKey: "TypeE",
    targetStateVar: "v4",
    coefficient: 0.2,
    delayTicks: 0,
    domainKey: null, // 未归域：目标类型不是任何流程的承载物（生产实测 3 条）
    domainName: null,
  },
];

/** 焦点 = 扰动落点。`effPObject` 取 `perturbTargets[0]`、`effPStateVar` 取 `stateVars[0]`。 */
const FOCUS = "TypeA.v0";

const CFG: SandboxViewConfig = {
  tenantId: "demo",
  nodeTypes: ["TypeA", "TypeB", "TypeC", "TypeD", "TypeE"],
  nodeObjectIds: { TypeA: ["a1"], TypeB: ["b1"], TypeC: ["c1"], TypeD: ["d1"], TypeE: ["e1"] },
  linkTypes: ["l1", "l2", "l3", "l4"],
  stateVars: ["v0", "v1", "v2", "v3", "v4"],
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"],
  propagationCount: RULES.length,
};

const SESSION_ID = "sims_cfgux";

/** 会话上**已落盘**的屏蔽集 —— 关系图的单一真相源（`patchSimDisabledRules` 写，`fetchSimSessions` 读）。 */
let sessionDisabled: string[] = [];
let capturedBase: TickState = {};

const { patchFn } = vi.hoisted(() => ({ patchFn: vi.fn() }));

vi.mock("@/api/endpoints", () => ({
  fetchWorkspace: vi.fn(),
  fetchSimViewConfig: vi.fn(async () => CFG),
  runSolver: vi.fn(async () => Promise.reject({ error: { code: "NOT_STUBBED", message: "本门不桩求解器", requestId: "req_t" } })),
  createSimSession: vi.fn(async (body: { baseSnapshot: TickState }) => {
    capturedBase = body.baseSnapshot;
    return {
      id: SESSION_ID,
      tenantId: "demo",
      baseSnapshot: body.baseSnapshot,
      scope: {},
      status: "READY",
      curTick: 0,
      parentCheckpointId: null,
      createdAt: "2026-08-17T00:00:00.000Z",
    } satisfies SimSession;
  }),
  fetchSimSessions: vi.fn(async () => ({
    items: [
      {
        id: SESSION_ID,
        tenantId: "demo",
        baseSnapshot: capturedBase,
        scope: {},
        status: "READY",
        curTick: 0,
        parentCheckpointId: null,
        createdAt: "2026-08-17T00:00:00.000Z",
        // 这一份就是图读的那一份（宿主 `sessionDisabledRuleKeys` 从这里取）。
        disabledRuleKeys: [...sessionDisabled],
      },
    ],
  })),
  fetchPropagationRules: vi.fn(async () => ({ items: RULES })),
  patchSimDisabledRules: patchFn,
  simCounterfactual: vi.fn(async (_id: string, body: { disabledRuleKeys: string[] }) => ({
    sessionId: SESSION_ID,
    ticks: 1,
    disabledRuleKeys: body.disabledRuleKeys,
    suppressedRules: [],
    suppressedRulesFiredInBaseline: [],
    diffs: [],
  })),
  createSimPerturbation: vi.fn(async (sessionId: string, body: Record<string, unknown>) => ({
    perturbation: {
      id: "simpert_cfgux",
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
      createdAt: "2026-08-17T00:00:00.000Z",
    },
    // 扰动后世界态**真的不一样**（判据「结果区的数变了」要落在数上，不能桩成恒等）。
    state: { ...capturedBase, a1: { ...(capturedBase.a1 ?? {}), v0: 99 } },
    curTick: 0,
  })),
  fetchSimPerturbations: vi.fn(async () => ({ items: [] })),
  deleteSimPerturbation: vi.fn(),
  simTick: vi.fn(async (_id: string, n: number) => ({ curTick: n, state: capturedBase })),
  simWorld: vi.fn(async () => ({ tick: 0, state: capturedBase })),
  simCheckpoint: vi.fn(),
  simBranch: vi.fn(),
  fetchSimCompare: vi.fn(),
  createActionDraft: vi.fn(),
  fetchSimCertification: vi.fn(async () => null),
  runImpactAnalysis: vi.fn(async () => Promise.reject(new Error("本门不桩影响分析"))),
  submitQuery: vi.fn(),
  searchObjects: vi.fn(async () => ({ items: [], total: 0 })),
}));

import SandboxView from "@/views/sim/SandboxView";
import SandboxConfigPanel from "@/views/sim/SandboxConfigPanel";
import { buildRelationGraph, describeEdgeFormula, downstreamReach, relationNodeKey } from "@/views/sim/sandboxRelationGraph";

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

/**
 * ⚠ WO-SANDBOX-CONFIG-COLLAPSE 起，配置面板**默认收起成一条横幅**（仓主裁决：地铁图留首屏）。
 *   故本 helper 多做一件事：**把它点开**。本文件其余 15 例的断言一个字没改 ——
 *   它们验的是「展开后这一屏长什么样」，而那件事本单一点没动。
 *
 * ⚠ 这里**必须真的点**，不许改成"直接渲染展开态"的后门：
 *   走后门就等于生产走一条路、测试验另一条路（本仓「生产实参与测试实参交集为空」那类假绿）。
 *   点不动 ⇒ 下面 15 例集体红，这正是要的信号。
 */
const ready = async () => {
  await screen.findByTestId("sandbox-console");
  await screen.findByTestId("sandbox-config-panel");
  const bar = await screen.findByTestId("sandbox-config-bar");
  // 🐤 金丝雀：先证明"它此刻确实是收起的"。若哪天默认态被改回展开，这里不中 ⇒
  //   报「前提变了」而不是闷头点一下把它**关上**（那会让下面 15 例全红，且红得莫名其妙）。
  expect(bar.getAttribute("aria-expanded"), "配置面板默认态不是收起 ⇒ 本 helper 的前提变了").toBe("false");
  await userEvent.setup().click(bar);
  await waitFor(() => expect(bar.getAttribute("aria-expanded")).toBe("true"));
  await waitFor(() => expect(screen.getByTestId("sandbox-config-graph-svg")).toBeTruthy());
};

/** 图上现算的三个数（**由渲染产出**，不是测试自己再算一遍 —— 再算一遍就成了自己跟自己对账）。 */
function graphCounts(): { nodes: number; edges: number; active: number } {
  const svg = screen.getByTestId("sandbox-config-graph-svg");
  return {
    nodes: Number(svg.getAttribute("data-node-count")),
    edges: Number(svg.getAttribute("data-edge-count")),
    active: Number(svg.getAttribute("data-active-edge-count")),
  };
}

beforeEach(() => {
  sessionDisabled = [];
  capturedBase = {};
  patchFn.mockReset();
  patchFn.mockImplementation(async (_id: string, keys: string[]) => {
    sessionDisabled = [...keys];
    return { id: SESSION_ID, disabledRuleKeys: [...keys] };
  });
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════════
describe("§0 · 纯模型：算式是**还原**不是编造，原生/派生判据只有一条", () => {
  it("算式逐段对应引擎算术（sum / max / 延迟 / 衰减 / 夹值 / 系数引用），一段都不许省", () => {
    // 🐤 金丝雀：最常见的那一档（sum · 无延迟 · 无衰减 · 无夹值）必须能还原出来。
    // 它不中 ⇒ 是还原器坏了，不是"这条边没算式"。
    expect(describeEdgeFormula(RULES[0]!)).toBe("TypeB.v1 ← TypeB.v1 + 0.5 × TypeA.v0");

    // 延迟：引擎 `arriveTick = releaseTick + delayTicks`
    expect(describeEdgeFormula(RULES[1]!)).toContain("延迟 1 拍到达");

    // max：引擎 `applyContribution` 的 `Math.max(cur, amount)` 分支
    expect(describeEdgeFormula({ ...RULES[0]!, combine: "max" })).toBe("TypeB.v1 ← max(TypeB.v1, 0.5 × TypeA.v0)");

    // 衰减：引擎 `factor = 1 - dist/den`，源与目标相邻 ⇒ dist = 1
    expect(describeEdgeFormula({ ...RULES[0]!, decay: { window: 3, den: 4 } })).toContain("× (1 − 1/4)");
    // 超窗：引擎 `continue`（无贡献）—— 那是"不传导"，不是"乘一个小系数"，屏上必须分得开
    expect(describeEdgeFormula({ ...RULES[0]!, decay: { window: 0, den: 4 } })).toContain("本边不传导");

    // 夹值：引擎 §3「应用 clamp」
    expect(describeEdgeFormula({ ...RULES[0]!, clamp: { min: 0, max: 10 } })).toContain("再夹到 [0, 10]");

    // 系数引用规则表 ⇒ **不许把内联那个数写进算式**（引擎会去规则表取，写死就是撒谎）
    const ref = describeEdgeFormula({ ...RULES[0]!, coefficientRef: { ruleKey: "C08", paramKey: "ratio" } });
    expect(ref).toContain("规则 C08.ratio");
    expect(ref, "系数引用时仍把内联值 0.5 写进算式 ⇒ 屏上那个数不是算的时候用的那个数").not.toContain("0.5");
  });

  it("原生量/派生量：判据是「有没有**参与推演**的边写它」——关掉最后一条写它的边，它退回原生量", () => {
    const all = buildRelationGraph(RULES, [], new Map());
    expect(all.nodes.length).toBeGreaterThan(4);
    const kindOf = (k: string) => all.nodes.find((n) => n.key === k)?.kind;
    expect(kindOf("TypeA.v0"), "没有任何边写它 ⇒ 原生量（= 你拨的那个）").toBe("native");
    expect(kindOf("TypeB.v1"), "有边写它 ⇒ 派生量").toBe("derived");

    // 关掉唯一写 TypeB.v1 的那条边 ⇒ 它**退回原生量**（参照物那句「下游退回报告原值」的我们这一侧）
    const off = buildRelationGraph(RULES, ["a_to_b"], new Map());
    expect(off.nodes.find((n) => n.key === "TypeB.v1")?.kind).toBe("native");
    expect(off.derivedCount, "关掉一条边后派生量个数必须真的少一个").toBe(all.derivedCount - 1);
  });

  it("环安全：租户建出 A→B→A 时不递归爆栈，图照画（白屏比画错一层严重得多）", () => {
    const cyc: PropagationRule[] = [
      { ...RULES[0]!, id: "c1", key: "x_to_y", sourceTypeKey: "X", sourceStateVar: "s", targetTypeKey: "Y", targetStateVar: "s" },
      { ...RULES[0]!, id: "c2", key: "y_to_x", sourceTypeKey: "Y", sourceStateVar: "s", targetTypeKey: "X", targetStateVar: "s" },
    ];
    const g = buildRelationGraph(cyc, [], new Map());
    expect(g.nodes.length).toBe(2);
    expect(downstreamReach(g, "X.s").nodeKeys).toEqual(["Y.s"]); // 走一圈就停，不无限入队
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§1 · 同屏：扰动输入与本体关系在**同一视口内**（不是两个 tab、不是两个路由）", () => {
  /**
   * ⚠ 标题原文是「都是**不点就看见**」。WO-SANDBOX-CONFIG-COLLAPSE 之后这句话不再成立 ——
   *   配置面板默认收起，要点一下横幅。**照实改标题**，不许留着旧标题让 `ready()` 偷偷替它点开：
   *   那样测试名就在替代码撒谎（本仓「注释/标题替代码撒谎」那条老账）。
   *   仍然成立、且本例真正在守的是后半句：**展开后一个 `<details>` 都不许有** ——
   *   否则就是"展开了还要再展开一次"，等于折了两层。
   */
  it("两侧同属左区、同在一个配置面板里；展开后不套任何 `<details>`（折一层，不许折两层）", async () => {
    mount();
    await ready();

    const zoneInput = screen.getByTestId("sandbox-zone-input");
    const panel = screen.getByTestId("sandbox-config-panel");
    expect(zoneInput.contains(panel), "配置面板不在左区 ⇒ 顶了 PRD §1① 的『唯一输入区』").toBe(true);

    const inputCol = screen.getByTestId("sandbox-config-input-col");
    const relCol = screen.getByTestId("sandbox-config-relation-col");
    // 两列互不嵌套 = 它们真是两列，不是"一列里多了几个 div"
    expect(inputCol.contains(relCol)).toBe(false);
    expect(relCol.contains(inputCol)).toBe(false);
    // 同一个面板之下 ⇒ 同一屏（判据落在 DOM 归属，不落在 CSS —— jsdom 没有布局）
    expect(panel.contains(inputCol) && panel.contains(relCol)).toBe(true);

    // 两侧的主角都**不在任何折叠容器里**（`<details>` 折叠时子节点照样在 DOM，
    // 所以这里判的是"有没有 details 祖先"，不是"在不在 DOM"）
    for (const id of ["sandbox-perturbation", "sandbox-config-graph"]) {
      const el = screen.getByTestId(id);
      expect(el.closest("details"), `${id} 被塞进了折叠块 ⇒ 又要先展开才看得见`).toBeNull();
      expect(el).toBeVisible();
    }
  });

  it("异构各占一卡：`要施加什么`（表单）与`已经施加了什么`（时间轴）是两张同时可见的卡", async () => {
    mount();
    await ready();
    const form = screen.getByTestId("sandbox-config-card-perturbation");
    const applied = screen.getByTestId("sandbox-config-card-applied");
    expect(form.contains(screen.getByTestId("sandbox-perturbation"))).toBe(true);
    expect(applied.contains(screen.getByTestId("sandbox-perturbation-timeline"))).toBe(true);
    // 同时可见 —— 「异构 ⇒ 各占一卡、同时可见」正是与 chip 切片相对的那一半判据
    expect(form).toBeVisible();
    expect(applied).toBeVisible();
    // 且**只渲染一次**：搬运不是复制（复制会让 getByTestId 抛"找到多个"，也会让两份状态各飘各的）
    expect(screen.getAllByTestId("sandbox-perturbation-timeline").length).toBe(1);
    expect(screen.getAllByTestId("edge-active-sandbox-panel").length).toBe(1);
  });

  it("图与表**同卡片**：图紧接表之下，不在另一个路由/tab/抽屉", async () => {
    mount();
    await ready();
    const card = screen.getByTestId("sandbox-config-card-relations");
    const table = screen.getByTestId("sandbox-config-relation-table");
    const graph = screen.getByTestId("sandbox-config-graph");
    expect(card.contains(table) && card.contains(graph), "表与图不在同一张卡里").toBe(true);
    // 顺序：表在前、图在后（`compareDocumentPosition` 的 FOLLOWING 位）
    expect(table.compareDocumentPosition(graph) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(graph.closest("details"), "图被塞进折叠块 ⇒ 不算同卡片可见").toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§2 · 双向联动（判据落在**数**与**DOM 结构**上）", () => {
  it("左→右：换扰动落点/量纲 ⇒ 图**当场换一张**（节点数真的变）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();

    // 默认焦点 = TypeA.v0（三跳链 + 一条旁支）⇒ 焦点 1 + 下游 4 = 5 个量纲
    const before = graphCounts();
    expect(before.nodes, "默认焦点的下游子图节点数不对 ⇒ 焦点没接上扰动落点").toBe(5);
    expect(screen.getByTestId("sandbox-config-reach-nodes").textContent).toBe("4");

    // 把量纲换成 v1 ⇒ 焦点变成 TypeA.v1，而没有任何规则碰这一对 ⇒ 诚实报「不会扩散」
    await user.selectOptions(screen.getByTestId("sandbox-perturbation-statevar"), "v1");
    await waitFor(() => expect(screen.getByTestId("sandbox-config-graph-focus-absent")).toBeTruthy());
    expect(screen.queryByTestId("sandbox-config-graph-svg"), "落点不在图上时还画了一张图 ⇒ 空图与「没加载出来」分不开").toBeNull();
    expect(screen.getByTestId("sandbox-config-graph-focus-absent").textContent).toContain("不会沿本体链路扩散");

    // 换回落点对象为 b1（TypeB）+ 量纲 v1 ⇒ 焦点 TypeB.v1，下游只剩 C、D 两跳
    await user.selectOptions(screen.getByTestId("sandbox-perturbation-object"), "b1");
    await waitFor(() => expect(screen.getByTestId("sandbox-config-graph-svg")).toBeTruthy());
    const after = graphCounts();
    expect(after.nodes, "换了落点，图上的量纲数没变 ⇒ 左→右这一路没接上").toBe(3);
    expect(after.nodes).not.toBe(before.nodes);
  });

  it("🔴 右→左接缝：关掉一条边 ⇒ **下游读数真的变小** + 图**真的重画**（走生产那条路，不是直接改 prop）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();

    const before = graphCounts();
    const reachBefore = Number(screen.getByTestId("sandbox-config-reach-nodes").textContent);
    const edgesBefore = Number(screen.getByTestId("sandbox-config-reach-edges").textContent);
    expect(reachBefore).toBe(4);
    expect(edgesBefore).toBe(4);

    // ── 走真实用户路径：在关系表里拨掉中间那一跳，再「应用到本会话」 ──────────────
    // `b_to_c` 在「域一」片里（默认选中第一片 D01）。
    const panel = screen.getByTestId("edge-active-sandbox-panel");
    await user.click(within(panel).getByTestId("edge-active-sandbox-toggle-b_to_c"));
    await waitFor(() => expect(within(panel).getByTestId("edge-active-sandbox-apply")).toBeTruthy());
    await user.click(within(panel).getByTestId("edge-active-sandbox-apply"));

    // 落盘走的是真 endpoint（不是测试自己改变量）
    await waitFor(() => expect(patchFn).toHaveBeenCalled());
    expect(patchFn.mock.calls[0]![1]).toEqual(["b_to_c"]);

    // 🔴 判据落在**数**：可达量纲 4 → 2（C、D 两跳整段掉；旁支 E 必须还在）
    await waitFor(() => expect(screen.getByTestId("sandbox-config-reach-nodes").textContent).toBe("2"));
    expect(screen.getByTestId("sandbox-config-reach-edges").textContent).toBe("2");

    // 🔴 判据落在**图的 DOM 结构**：节点数与参与推演的边数都真的变了
    const after = graphCounts();
    expect(after.nodes, "关了一条边，图上的量纲数没变 ⇒ 「改边即重画」没接上").toBeLessThan(before.nodes);
    expect(after.active).toBeLessThan(before.active);
    // 旁支还在 ⇒ 变小的是"链断了"，不是"整张图没了"
    expect(screen.getByTestId("sandbox-config-node-TypeE.v4")).toBeTruthy();
  });

  it("扰动施加后**结果区的数真的变**（不是只调了个函数）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sandbox-perturbation-apply-btn"));
    const last = await screen.findByTestId("sandbox-perturbation-last-delta");
    const [b, a] = last.textContent!.split("→").map((s) => Number(s.trim()));
    expect(Number.isFinite(b!) && Number.isFinite(a!)).toBe(true);
    expect(a, "施加扰动后全局态读数没动 ⇒ 屏上变了、下游不动（静默错答）").not.toBe(b);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§3 · 语义分层：派生可分 · 算式可见 · 切片有效", () => {
  it("派生量与原生量视觉可分 —— 判据落在**计算样式**（`strokeDasharray`），不是类名", async () => {
    mount();
    await ready();
    const rectOf = (k: string) => screen.getByTestId(`sandbox-config-node-rect-${k}`);
    const dash = (k: string) => window.getComputedStyle(rectOf(k)).strokeDasharray;

    // 🐤 金丝雀：先证明这条读法在本环境里真的读得到东西。
    // 读不到 ⇒ 是「工具坏了」（jsdom 不认这个属性），不许读成「两者恰好一样」。
    expect(dash("TypeB.v1"), "计算样式读不出 strokeDasharray ⇒ 判据自己瞎了，不是页面没分").not.toBe("");

    expect(dash("TypeA.v0"), "原生量应为实线（你能拨的那一类）").toBe("none");
    expect(dash("TypeB.v1"), "派生量应为虚线（由规则算出的那一类）").not.toBe("none");
    // 语义标记同时也在 DOM 上（给读屏与后续门用），但**判据不靠它**
    expect(rectOf("TypeA.v0").closest("[data-kind]")!.getAttribute("data-kind")).toBe("native");
  });

  it("算式**可见**（不是悬停才出），且全组件零 `<title>`（既有棘轮：SVG title 恒为 0）", async () => {
    mount();
    await ready();
    const list = screen.getByTestId("sandbox-config-formulas");
    expect(list).toBeVisible();
    expect(within(list).getByTestId("sandbox-config-formula-a_to_b").textContent).toContain(
      "TypeB.v1 ← TypeB.v1 + 0.5 × TypeA.v0",
    );
    // 出处记号必须在屏上（这一行是**还原**的，不是后端下发的公式）
    expect(screen.getByTestId("info-relation-formula-provenance")).toBeTruthy();

    // 既有棘轮（2026-08-10 悬停滞留遮挡）：本组件一个 `<title>` 都不许有
    const panel = screen.getByTestId("sandbox-config-panel");
    expect(panel.querySelectorAll("title").length, "SVG `<title>` 又回来了 —— 悬停浮层会滞留遮挡").toBe(0);
    expect(panel.querySelectorAll("[title]").length, "原生 title 属性只降不升").toBe(0);
  });

  it("切片有效：不在当前片的行**不在 DOM 里**（判据落在可见性/存在性，不是 `<details>` 折叠）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const panel = screen.getByTestId("edge-active-sandbox-panel");
    // 默认第一片 = D01（域一），含 a_to_b / b_to_c；D02 的 c_to_d 不在这一片
    expect(within(panel).getByTestId("edge-active-sandbox-edge-a_to_b")).toBeTruthy();
    expect(
      within(panel).queryByTestId("edge-active-sandbox-edge-c_to_d"),
      "别的域的行还在 DOM 里 ⇒ 切片是 CSS 藏的，不是真切片",
    ).toBeNull();

    await user.click(within(panel).getByTestId("edge-active-sandbox-domain-D02"));
    expect(within(panel).getByTestId("edge-active-sandbox-edge-c_to_d")).toBeTruthy();
    expect(within(panel).queryByTestId("edge-active-sandbox-edge-a_to_b")).toBeNull();
  });

  it("一屏摊开：每一片的行数都在个位数（生产实测 35 条 → 10 片 · 每片 2–7 行）", async () => {
    mount();
    await ready();
    const panel = screen.getByTestId("edge-active-sandbox-panel");
    const chips = within(panel).getByTestId("edge-active-sandbox-domains");
    const counts = Array.from(chips.querySelectorAll("[data-count]")).map((c) => Number(c.getAttribute("data-count")));
    expect(counts.length, "一个 chip 都没有 ⇒ 切片没生效，判据恒真").toBeGreaterThan(1);
    for (const n of counts) expect(n, "某一片的条数进了两位数 ⇒ 那一片摊不进一屏").toBeLessThan(10);
    // chip 上的数与真渲染的行数是**同一个数组的长度**（不可能出现"写 7 条、点开 5 行"）
    const rows = within(panel).getByTestId("edge-active-sandbox-edges").children.length;
    expect(counts).toContain(rows);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§4 · 变异反证：拆掉联动，必须红在「改了边但图没变」", () => {
  /**
   * 反证的形态很重要（工单原话）：**红在「改了边但图没变」，不是「组件不见了」**。
   * 故本例先断言两次渲染**组件都在**，再断言两者的**图不同** ——
   * 若有人把 `disabledRuleKeys` 这条线拆掉（面板照渲、图照画，只是不再吃这个入参），
   * 上面的"组件在"照样绿，而下面这条当场红，且失败信息直指联动。
   */
  function renderPanel(disabled: string[]) {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SandboxConfigPanel
          inputCards={[{ id: "probe", title: "探针", hint: "反证用", node: <span>x</span> }]}
          relationTable={<span data-testid="probe-table">表</span>}
          focusNodeKey={FOCUS}
          disabledRuleKeys={disabled}
        />
      </QueryClientProvider>,
    );
  }

  it("同一焦点、只改 `disabledRuleKeys`：图必须不同（两次都要先证明组件在）", async () => {
    const openView = renderPanel([]);
    await waitFor(() => expect(screen.getByTestId("sandbox-config-graph-svg")).toBeTruthy());
    const open = graphCounts();
    expect(screen.getByTestId("sandbox-config-panel"), "组件本身就没渲染出来 ⇒ 下面的比较无意义").toBeTruthy();
    openView.unmount();

    renderPanel(["b_to_c"]);
    await waitFor(() => expect(screen.getByTestId("sandbox-config-graph-svg")).toBeTruthy());
    expect(screen.getByTestId("sandbox-config-panel")).toBeTruthy();
    const closed = graphCounts();

    expect(closed.nodes, "改了边但图上的量纲数一模一样 ⇒ 联动被拆掉了（不是组件不见了）").not.toBe(open.nodes);
    expect(closed.active, "改了边但参与推演的边数一模一样 ⇒ 联动被拆掉了").toBeLessThan(open.active);
  });

  it("反证②：焦点键拼错一个字 ⇒ 报「不在图上」而不是照画一张全图（证焦点真的被用了）", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SandboxConfigPanel
          inputCards={[]}
          relationTable={<span />}
          focusNodeKey={relationNodeKey("TypeA", "v0x")}
          disabledRuleKeys={[]}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("sandbox-config-graph-focus-absent")).toBeTruthy());
    expect(screen.queryByTestId("sandbox-config-graph-svg")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§5 · 判据 U4b（WO-U4B-U1-U8-SIM）：被关掉的边**留在图上并带理由**", () => {
  /**
   * ── 为什么本页这一格是「**已经符合**」而不是「本单做的」───────────────────────
   * `docs/PRD-harness-ux-adoption.md` §4 表长期把 `sim-sandbox` 的 U4b 记为**不符合**，
   * 理由写的是「`EdgeActivePanel` 是独立面板，不是画在因果/传导图上的一层」。
   * 那句话在**当时**属实，但 `WO-SANDBOX-CONFIG-COLLAPSE` 把关系图搬进本面板之后就过期了：
   * `buildRelationGraph(rules, disabledRuleKeys, …)` 让关掉的边 `active:false` **留在图上**，
   * `RelationEdgePath` 给它虚线 + `--danger` 描边 + `aria-label` 补「本次推演已关掉」，
   * `EdgeFormulaList` 再补一条**可见文字**「本次推演已关掉」，图例里还有并列的一条
   * 「已关掉的边（本次推演假装它不存在）」。
   * 形态（铁律 0.6）：**「我用『那份 §4 分析当时的结论』当作『今天的实现是什么』的证据，
   * 而前者并不度量后者」** —— 表是人写的、会过期。所以本单不改实现，只**补一道门**，
   * 让这一格以后由机器说话。
   *
   * 判据两条缺一不可（与本单其余 U4b 用例同形态）：
   *   ① 被排除项**真的还在同一张图里**（不是从图上消失）；
   *   ② 它**带排除理由**（看得见"为什么"，不是只有一根灰线）。
   */
  it("U4b-C5 · 关掉 `b_to_c`：该边仍在图上、标 `data-active=false`、且屏上有可见的「本次推演已关掉」", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SandboxConfigPanel
          inputCards={[{ id: "probe", title: "探针", hint: "U4b", node: <span>x</span> }]}
          relationTable={<span data-testid="probe-table">表</span>}
          focusNodeKey={null}
          disabledRuleKeys={["b_to_c"]}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("sandbox-config-graph-svg")).toBeTruthy());

    // ── 判据①：被关掉的那条边**还在同一张图里**（同一个 svg 容器内），只是降级 ──
    const svg = screen.getByTestId("sandbox-config-graph-svg");
    const off = within(svg).getByTestId("sandbox-config-edge-b_to_c");
    expect(off, "关掉的边从图上消失了 ⇒ 用户不知道自己关了什么").toBeTruthy();
    expect(off.getAttribute("data-active")).toBe("false");
    // 入选的边仍并列在同一张图上（"同图"要的是两者并列，不是把入选项换成被排除项）。
    expect(within(svg).getByTestId("sandbox-config-edge-a_to_b").getAttribute("data-active")).toBe("true");
    // 降级走**计算样式**上的虚线，不是类名（类名判据骗得过，线型骗不过）。
    expect(off.style.strokeDasharray, "只改了颜色没改线型 ⇒ 低对比主题下等于没表达").not.toBe("none");

    // ── 判据②：**理由可见**（不是只有一根灰线，也不是只藏在 aria/title 里）──
    const why = screen.getByTestId("sandbox-config-formula-off-b_to_c");
    expect(why.textContent).toContain("本次推演已关掉");
    expect(why).toBeVisible();
    // 图例把「已关掉的边」与其余编码**并列**登记（参照件那张六色图例的我们这一侧）。
    expect(screen.getByTestId("sandbox-config-graph-legend").textContent).toContain("已关掉的边");
  });

  it("U4b-C5-反向哨兵 · 一条都没关时屏上不该出现「已关掉」（证上一条不是恒真）", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SandboxConfigPanel inputCards={[]} relationTable={<span />} focusNodeKey={null} disabledRuleKeys={[]} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("sandbox-config-graph-svg")).toBeTruthy());
    expect(screen.queryByTestId("sandbox-config-formula-off-b_to_c")).toBeNull();
    expect(screen.getByTestId("sandbox-config-edge-b_to_c").getAttribute("data-active")).toBe("true");
  });
});
