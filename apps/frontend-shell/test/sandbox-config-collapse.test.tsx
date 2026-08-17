import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropagationRule, SandboxViewConfig, SimPerturbation, SimSession, TickState } from "@platform/contracts";

/**
 * ══ WO-SANDBOX-CONFIG-COLLAPSE · 配置面板折叠态门 ═══════════════════════════════
 *
 * 仓主裁决：**配置面板默认收起成一条，点开才展开；地铁图留在首屏当主角。**
 *
 * 上一张单（WO-SANDBOX-CONFIG-UX）把「扰动 × 本体关系」并成同屏两列做对了，但代价是
 * 画布与 tick 控制条整体被挤到折线以下。真浏览器实测（`check-layout-legibility.mjs`）：
 * 主画布区顶边 **1440×900 → 1453px · 1280×800 → 1472px**，要滚半屏多才看得见第一个像素。
 *
 * ── 本门与两侧邻门的分工（三件事，谁也不替谁）──────────────────────────────────
 *  · `sandbox-config-ux.seam`  咬「**展开后**这一屏长什么样」（同屏两列 · 双向联动 · 算式可见）
 *  · **本门**                  咬「**默认收起** · 横幅上的数是真的 · 点得开点得回 · 分栏跟着变」
 *  · `check-layout-legibility` 咬「**画布真的在第一屏**」——⚠ 这一条 jsdom **判不了**（没有布局），
 *    故本门一个字都不去碰它，也**不许**在这里写一条"看起来像"的替代断言：
 *    那会变成「我用『控件少了』当作『画布回首屏了』的证据」，而前者并不度量后者
 *    （CLAUDE.md 铁律 0.6 句式）—— 正是本单要修的那个病本身。
 *
 * ── 🔴 判据落在哪 ────────────────────────────────────────────────────────────
 *  · 「默认收起」   → **行内 `display`**（`<details>`/条件渲染/CSS 类名三条路实测都是坑，
 *                     理由见 `SandboxConfigPanel.tsx` 文件头；行内样式 jsdom 读得到）
 *  · 「折叠≠删除」 → 收起态下内容**仍在 DOM**（D4 守恒：允许降层，不允许删除）
 *  · 「计数是真的」 → **走生产那条路**造一条扰动 / 关一条边，屏上的数跟着变
 *                     （写死的数在这两条上必红 —— 这就是本门存在的理由）
 *  · 「分栏跟着变」 → `sandbox-zones` 的 `data-fullrow`（同一个布尔驱动 CSS，不是第二份状态）
 *
 * R6 确定性：网络全桩，无时钟、无随机。
 */

// ══════════════════════════════════════════════════════════════════════════════
// fixture —— 形状照生产（多跳链 + 旁支 + 多域 + 未归域），条数不假装等于生产
// ══════════════════════════════════════════════════════════════════════════════

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
    domainKey: null,
    domainName: null,
  },
];

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

const SESSION_ID = "sims_collapse";

/**
 * 「已施加的扰动」的**唯一真相源** —— `createSimPerturbation` 往里 push，
 * `fetchSimPerturbations` 从里读。
 *
 * ⚠ 这是本门最要紧的一处设计：横幅上那个 N 如果被写死，或者只是渲染时抄下来的快照，
 *   §2「造一条新扰动 ⇒ 计数跟着变」当场红。桩成恒返 `{items: []}` 就测不到这件事了。
 */
let perturbationStore: SimPerturbation[] = [];
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
  createSimPerturbation: vi.fn(async (sessionId: string, body: Record<string, unknown>) => {
    const p = {
      id: `simpert_${perturbationStore.length + 1}`,
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
    } as unknown as SimPerturbation;
    // 后端**真的多了一条** —— 下一次 `fetchSimPerturbations` 就会读到它。
    perturbationStore = [...perturbationStore, p];
    return {
      perturbation: p,
      state: { ...capturedBase, a1: { ...(capturedBase.a1 ?? {}), v0: 99 } },
      curTick: 0,
    };
  }),
  fetchSimPerturbations: vi.fn(async () => ({ items: [...perturbationStore] })),
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

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

/** 面板挂上了就返回 —— **不点开**（本门大半判据要的正是那个未点开的默认态）。 */
const ready = async () => {
  await screen.findByTestId("sandbox-console");
  await screen.findByTestId("sandbox-config-bar");
  await screen.findByTestId("sandbox-config-panel");
};

/** 折叠判据的**唯一读法**：行内计算样式。类名在 vitest（`css:false`）里读不到，读了也证明不了。 */
const panelDisplay = () => window.getComputedStyle(screen.getByTestId("sandbox-config-panel")).display;

const barText = () => screen.getByTestId("sandbox-config-bar").textContent ?? "";

beforeEach(() => {
  perturbationStore = [];
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
describe("§1 · 默认收起成一条：折的是**位置**，不是内容", () => {
  it("默认态 = 横幅在、面板行内 `display:none`（且判据真的读得到东西）", async () => {
    mount();
    await ready();

    // 🐤 金丝雀：先证明这条读法在本环境里读得出**非空**的值。
    // 读不到 ⇒ 是「工具坏了」（jsdom 不认行内 display），不许读成「面板恰好是收起的」。
    expect(panelDisplay(), "计算样式读不出 display ⇒ 判据自己瞎了，不是面板收起了").not.toBe("");

    expect(panelDisplay(), "配置面板默认不是收起的 ⇒ 仓主裁决没落地").toBe("none");
    expect(screen.getByTestId("sandbox-config-bar").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("sandbox-config-shell").getAttribute("data-open")).toBe("0");
  });

  it("折叠≠删除：收起态下上一张单的内容**一件不少地留在 DOM 里**（D4 守恒）", async () => {
    mount();
    await ready();
    expect(panelDisplay()).toBe("none");

    // 这四样是上一张单的产出。收起态下它们必须**仍可 getByTestId 到** ——
    // 换成条件渲染的话，这里就是第一处红，而那正是工单点名禁止的那条路。
    for (const id of [
      "sandbox-config-input-col",
      "sandbox-config-relation-col",
      "sandbox-config-card-relations",
      "sandbox-perturbation-timeline",
    ]) {
      expect(screen.getByTestId(id), `${id} 收起时从 DOM 里消失了 ⇒ 这是删除，不是折叠`).toBeTruthy();
    }
    // 图也在（它是被折起来的那块里最重的一件）
    await waitFor(() => expect(screen.getByTestId("sandbox-config-graph-svg")).toBeTruthy());
  });

  it("横幅**不套 `<details>`**（那条路实测折不掉版面门的账，见文件头）", async () => {
    mount();
    await ready();
    const bar = screen.getByTestId("sandbox-config-bar");
    expect(bar.closest("details"), "横幅被塞进 `<details>` ⇒ 闭合子节点矩形仍非零，版面门照数").toBeNull();
    expect(bar.tagName, "横幅不是 `<button>` ⇒ 键盘/读屏拿不到它").toBe("BUTTON");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§2 · 横幅上的三个数是**现算**的（写死的数在这一节必红）", () => {
  it("落地即与 fixture 对账：已施加 0 条 · 传导边 4 条 · 启用 4 条", async () => {
    mount();
    await ready();

    // 会话建起来之前是 `—`（"还没有会话" ≠ "一条都没施加"，不许显示同一个 0）
    await waitFor(() => expect(screen.getByTestId("sandbox-config-bar-applied").textContent).toBe("0"));
    expect(screen.getByTestId("sandbox-config-bar-edges").textContent).toBe(String(RULES.length));
    expect(screen.getByTestId("sandbox-config-bar-active").textContent).toBe(String(RULES.length));
    // 屏上那句话读得通（不是三个裸数字并排）
    expect(barText()).toContain("已施加");
    expect(barText()).toContain("传导边");
  });

  it("🔴 造一条新扰动 ⇒ 「已施加」当场 0 → 1（**走生产那条路**：点施加按钮，不是改变量）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await waitFor(() => expect(screen.getByTestId("sandbox-config-bar-applied").textContent).toBe("0"));

    await user.click(screen.getByTestId("sandbox-perturbation-apply-btn"));

    // 后端真的多了一条（桩里 push 的那条）
    await waitFor(() => expect(perturbationStore.length).toBe(1));
    // 🔴 判据落在**屏上那个数**：不跟着变 ⇒ 它是写死的，或者是渲染时抄下来的快照
    await waitFor(() =>
      expect(
        screen.getByTestId("sandbox-config-bar-applied").textContent,
        "施加了一条扰动而横幅上的计数没动 ⇒ 这个数不是现算的",
      ).toBe("1"),
    );
    // 面板**仍然是收起的** —— 施加扰动不该顺手把它弹开（那等于默认态没意义）
    expect(panelDisplay()).toBe("none");
  });

  it("🔴 关掉一条传导边 ⇒ 「启用」4 → 3，而「传导边」总数**不动**（两个数分得开）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await waitFor(() => expect(screen.getByTestId("sandbox-config-bar-active").textContent).toBe("4"));

    // 先点开才够得着关系表（表在被折起来的那一块里）——这本身也是"点得开"的一次真跑
    await user.click(screen.getByTestId("sandbox-config-bar"));
    await waitFor(() => expect(panelDisplay()).toBe("grid"));

    const panel = screen.getByTestId("edge-active-sandbox-panel");
    await user.click(within(panel).getByTestId("edge-active-sandbox-toggle-b_to_c"));
    await user.click(within(panel).getByTestId("edge-active-sandbox-apply"));
    await waitFor(() => expect(patchFn).toHaveBeenCalled());

    await waitFor(() =>
      expect(
        screen.getByTestId("sandbox-config-bar-active").textContent,
        "关了一条边而横幅上「启用」没变 ⇒ 这个数没接上会话里的屏蔽集",
      ).toBe("3"),
    );
    expect(
      screen.getByTestId("sandbox-config-bar-edges").textContent,
      "关一条边把「传导边总数」也减了 ⇒ 两个数被合成了一个，用户读不出「关掉了几条」",
    ).toBe("4");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§3 · 点得开、点得回，且分栏方式跟着一起变", () => {
  it("点横幅 ⇒ 展开成两列（`display:grid`，不是 `block`）；再点 ⇒ 收回", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    expect(panelDisplay()).toBe("none");

    await user.click(screen.getByTestId("sandbox-config-bar"));
    // ⚠ 判据咬死 `grid`：展开成 `block` 会把上一张单的「同屏两列」悄悄拆掉，
    //   而屏上"看起来也展开了"—— 这正是最容易漏过去的那一档。
    await waitFor(() => expect(panelDisplay()).toBe("grid"));
    expect(screen.getByTestId("sandbox-config-bar").getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByTestId("sandbox-config-bar"));
    await waitFor(() => expect(panelDisplay()).toBe("none"));
    expect(screen.getByTestId("sandbox-config-bar").getAttribute("aria-expanded")).toBe("false");
  });

  it("🔴 分栏跟着折叠态走：收起 = 两栏（画布回第一行）· 展开 = 上下两行", async () => {
    const user = userEvent.setup();
    mount();
    await ready();

    const zones = screen.getByTestId("sandbox-zones");
    // 收起 ⇒ 不整行 ⇒ `.zones` 的 `300px | 1fr` 生效 ⇒ 画布排在第一行右侧。
    // ⚠ 这一条**不能替代**真浏览器那条「画布 top < 视口高」——jsdom 没有布局，量不到 top。
    //   它只证明"开关接上了"，画布到底在不在第一屏由版面门判（见文件头分工）。
    expect(zones.getAttribute("data-fullrow"), "收起态仍占整行 ⇒ 画布还在第二行，地铁图回不来").toBe("0");

    await user.click(screen.getByTestId("sandbox-config-bar"));
    await waitFor(() => expect(zones.getAttribute("data-fullrow")).toBe("1"));

    await user.click(screen.getByTestId("sandbox-config-bar"));
    await waitFor(() => expect(zones.getAttribute("data-fullrow")).toBe("0"));
  });

  it("展开后画布区**仍在 DOM 且仍是同一个**（展开不是把画布换掉，只是换了排法）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const before = screen.getByTestId("sandbox-zone-canvas");

    await user.click(screen.getByTestId("sandbox-config-bar"));
    await waitFor(() => expect(panelDisplay()).toBe("grid"));

    expect(
      screen.getByTestId("sandbox-zone-canvas"),
      "展开后画布区不见了 ⇒ 那是删除不是重排（变异反证要求红在『位置』而不是『存在』）",
    ).toBe(before);
  });
});
