import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SandboxViewConfig, SimCertification, SimSession } from "@platform/contracts";

/**
 * WO-SANDBOX-DECLUTTER · 推演沙盘主屏**信息减负**门。
 *
 * ── 来历（仓主逐页实测）──────────────────────────────────────────────────────
 * 「目前『推演沙盘』页面的信息太多了，无法让决策者看到重点」，并指着右栏「就绪认证」
 * 那一大块说「这些信息都可以删除」。本仓的产品哲学是**宁可显示空图 + 说明为什么，
 * 也不画假数据**，所以正解不是删，是**分层**：
 * `docs/CONVENTION-ui-information-layering.md` §1 —— 第一层放结论、第二层放明细、
 * 浮层放「凭什么」；诚实位**允许降层、绝不允许删除**，且降层后第一层必须留可见记号。
 *
 * ── 本门的头号判据：**两向都咬**（只咬一向证明不了收纳成功）─────────────────
 * ① **默认不渲染**：主屏首屏 DOM 里**根本没有**就绪认证 / 世界列表 / SEED / 口径差 /
 *    本体派生计数这些节点 —— 是"不渲染"，不是 `display:none`。
 *    （只咬这一向 = 可能是把它们删了，那就违反了硬约束。）
 * ② **展开后能渲染**：点抽屉入口 / 点 `?` 之后，**同一批 testid、同样的文本**全部回来。
 *    （只咬这一向 = 可能它们本来就一直在屏上，减负根本没发生。）
 *
 * ── 第二组判据：治理横幅两向 ─────────────────────────────────────────────────
 * `canEnterSimulation === false` ⇒ 横幅在，且含**真 gap 文案**（不是一句泛泛的警告）；
 * `=== true` ⇒ 横幅**不存在**（`queryByTestId` 为 null，不是 hidden）——
 * 「一切正常」时不该有任何提示占位。
 *
 * R6 确定性：网络全桩，无时钟、无随机。
 */

const { fetchCertFn } = vi.hoisted(() => ({ fetchCertFn: vi.fn() }));

vi.mock("@/api/endpoints", () => ({
  fetchWorkspace: vi.fn(),
  fetchSimViewConfig: vi.fn(),
  // 控制台内嵌两个链路求解器。本门测的是**信息分层**，与链路载荷无关：
  // 阻滞点给形状合法的空扫描，链路损失归因走 reject（线路图诚实空态，正是它该有的行为）。
  runSolver: vi.fn(async (key: string) =>
    key === "chain_impediments"
      ? {
          data: {
            scanId: "scan_declutter", scope: {}, impediments: [],
            counts: { total: 0, BOTTLENECK: 0, CONGESTION: 0, BREAK: 0 },
            unresolved: [], caveats: [], thresholds: [],
          },
          snapshotVersion: "ov-test",
        }
      : Promise.reject({ error: { code: "NOT_STUBBED", message: "本门不桩 chain_loss_attribution", requestId: "req_test" } }),
  ),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_declutter", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, createdAt: "2026-08-10T00:00:00.000Z",
  } satisfies SimSession)),
  simTick: vi.fn(async (_id: string, n: number) => ({ curTick: n, state: { x: { v: 50 } } })),
  simWorld: vi.fn(async () => ({ tick: 0, state: {} })),
  // 世界列表：给两条（含一条分支子世界）—— 它正是仓主截图里「7 个世界各带一个按钮塞爆右栏」那一块。
  fetchSimSessions: vi.fn(async () => ({
    items: [
      { id: "sims_declutter", tenantId: "t", baseSnapshot: {}, scope: {}, status: "RUNNING", curTick: 2, parentCheckpointId: null, createdAt: "x" },
      { id: "sims_child", tenantId: "t", baseSnapshot: {}, scope: {}, status: "READY", curTick: 0, parentCheckpointId: "cp1", createdAt: "x" },
    ],
  })),
  simCheckpoint: vi.fn(async () => ({ id: "cp1", sessionId: "sims_declutter", tenantId: "t", tick: 1, label: "t1", createdAt: "x" })),
  simBranch: vi.fn(),
  fetchSimCompare: vi.fn(),
  createActionDraft: vi.fn(async () => ({ draftId: "ad1", status: "PENDING" })),
  fetchSimCertification: fetchCertFn,
  submitQuery: vi.fn(),
  searchObjects: vi.fn(async () => ({ items: [], total: 0 })),
}));

import SandboxView from "@/views/sim/SandboxView";

const CFG: SandboxViewConfig = {
  tenantId: "t-declutter",
  nodeTypes: ["TypeA", "TypeB"],
  linkTypes: ["linkAB"],
  stateVars: ["s1"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["sandbox"],
  propagationCount: 1,
};

/** 未认证态：三条真 gap（横幅取前 3 条 —— 正好卡在"还有没有第 4 条"的边界上）。 */
const GAPS = [
  { gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" },
  { gapCode: "G-NO-PROPAGATION", ref: "behavior", detail: "本体无传导规则，tick 不会传导" },
  { gapCode: "G-THIN-STATEVARS", ref: "structure", detail: "状态变量 2/4，世界不完整" },
  { gapCode: "G-NO-OBSERVABILITY", ref: "behavior", detail: "可观测性未达标" },
];

function certOf(canEnter: boolean): SimCertification {
  return {
    scope: "GLOBAL", targetRef: null, level: canEnter ? "L4_CERTIFIED" : "L2_RUNNABLE",
    dims: { structure: 60, knowledge: 40, behavior: 30, composite: 45 },
    l4Checks: { fanoutSafe: true, writebackComplete: canEnter, observabilityMet: canEnter },
    trialTick: { passed: canEnter, rulesFired: canEnter ? 3 : 0, at: null, error: null },
    worldCompleteness: {
      pct: canEnter ? 100 : 55,
      stateVars: { present: 2, needed: 4 }, derivationRules: { present: 1, needed: 2 },
      actions: { present: 0, needed: 1 }, propagationRules: { present: 0, needed: 0 },
      entering: [{ key: "s1", kind: "DERIVATION", source: "deriv:s1" }],
    },
    canEnterSimulation: canEnter,
    // 已认证 ⇒ 无缺件（这正是"横幅一个像素都不占"该成立的那一档）。
    gaps: canEnter ? [] : GAPS,
    computedAt: "2026-08-10T00:00:00.000Z",
  };
}

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

async function ready() {
  await screen.findByTestId("sandbox-console");
  // 会话建立 + 首发认证回来（此后 cert 已在 state 里，横幅/抽屉计数都该稳定）。
  await waitFor(() => expect(fetchCertFn).toHaveBeenCalled());
}

/**
 * 「收进抽屉/浮层的东西」清单 —— **两向断言共用同一份**。
 *
 * 共用是刻意的：若哪天有人只改了其中一向的清单，两向就会对不上而当场红。
 * 各条的 `open` 描述打开它的动作（抽屉 or 某个 `?`）。
 */
const STOWED: { testId: string; open: "diag" | string; what: string }[] = [
  { testId: "sim-cert-level", open: "diag", what: "就绪认证 L0–L4" },
  { testId: "sim-cert-gauge", open: "diag", what: "世界完整度 gauge" },
  { testId: "sim-cert-entering", open: "diag", what: "将进入沙盘的要素清单" },
  { testId: "sandbox-readiness", open: "diag", what: "就绪认证整块" },
  { testId: "sandbox-worlds", open: "diag", what: "世界列表" },
  { testId: "sandbox-config-summary", open: "diag", what: "本体派生计数" },
  { testId: "sc-seed", open: "diag", what: "SEED 确定性种子" },
  { testId: "sc-window-badge", open: "diag", what: "时窗无 ARGS 徽标" },
  { testId: "sc-imp-gap", open: "imp-gap", what: "口径差" },
  { testId: "sc-imp-join-gap", open: "imp-join-gap", what: "联动口径" },
  { testId: "sc-scope-reach", open: "scope-reach", what: "范围能带到哪" },
  { testId: "sc-legend", open: "legend", what: "阻滞点图例" },
  { testId: "sc-dim-modelIds-note", open: "dim-modelIds", what: "产品维无 ARGS 说明" },
  { testId: "sc-dim-businessTypes-note", open: "dim-businessTypes", what: "业务线维无 ARGS 说明" },
  { testId: "sc-window-note", open: "window", what: "时窗为何禁用" },
];

beforeEach(() => {
  fetchCertFn.mockReset();
  fetchCertFn.mockImplementation(async () => certOf(false));
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════════
describe("§1 · 主屏减负 —— **两向都咬**（只咬一向证明不了收纳成功）", () => {
  it("向一：主屏**默认一个都不渲染**（是不渲染，不是 display:none）", async () => {
    mount();
    await ready();
    for (const s of STOWED) {
      expect(
        screen.queryByTestId(s.testId),
        `「${s.what}」（${s.testId}）默认就在主屏上 ⇒ 减负没发生。它该收进${s.open === "diag" ? "诊断抽屉" : `\`?\` 浮层 info-${s.open}`}。`,
      ).toBeNull();
    }
    // 抽屉本体也不渲染（入口在、内容不在 —— 这正是"折叠"的定义）
    expect(screen.queryByTestId("sc-diag-panel")).toBeNull();
  });

  it("向二：点开抽屉 / 点开对应 `?` 之后，**同一批 testid 全部回来**（收纳 ≠ 删除）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();

    // 抽屉那一档
    await user.click(screen.getByTestId("sc-diag-toggle"));
    await screen.findByTestId("sc-diag-panel");
    for (const s of STOWED.filter((x) => x.open === "diag")) {
      expect(screen.queryByTestId(s.testId), `展开抽屉后「${s.what}」没回来 ⇒ 它是被删了，不是被收了`).toBeTruthy();
    }

    // `?` 那一档：每条各点各的触发器
    for (const s of STOWED.filter((x) => x.open !== "diag")) {
      await user.click(await screen.findByTestId(`info-${s.open}`));
      expect(
        screen.queryByTestId(s.testId),
        `点开 info-${s.open} 之后「${s.what}」没出现 ⇒ 诚实位被删了（硬约束①：只许换承载方式）`,
      ).toBeTruthy();
    }
  });

  it("抽屉入口**能被发现**：常驻可见 + 带真计数（不是藏起来找不到的东西）", async () => {
    mount();
    await ready();
    const toggle = screen.getByTestId("sc-diag-toggle");
    expect(toggle).toBeTruthy();
    // 计数是真的：cert 的缺件清单有 4 条 ⇒ 入口上就该是 4 项待办（不是写死的装饰数字）。
    await waitFor(() => expect(screen.getByTestId("sc-diag-count").textContent ?? "").toContain(`${GAPS.length} 项待办`));
    expect(toggle.getAttribute("data-issues")).toBe(String(GAPS.length));
    // 且计数随数据变：cert 变成 0 缺件时，入口不再报待办。
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("计数随真数据走：已认证（0 缺件）时入口改报「N 项」而不是编一个待办数", async () => {
    fetchCertFn.mockImplementation(async () => certOf(true));
    mount();
    await ready();
    await waitFor(() => expect(screen.getByTestId("sc-diag-toggle").getAttribute("data-issues")).toBe("0"));
    expect(screen.getByTestId("sc-diag-count").textContent ?? "").not.toContain("待办");
  });

  it("主屏留下的是**决策者那一档**：三张阻滞点卡 + 流动效率 + 逐条清单 + 四页签 + 节点检视", async () => {
    mount();
    await ready();
    for (const k of ["BOTTLENECK", "CONGESTION", "BREAK", "FLOW"]) {
      expect(screen.getByTestId(`sc-imp-${k}`), `阻滞点卡 ${k} 不该被减掉`).toBeTruthy();
    }
    for (const m of ["metro", "topo", "chain", "ontology"]) {
      expect(screen.getByTestId(`sc-mode-${m}`), `画布页签 ${m} 不该被减掉`).toBeTruthy();
    }
    expect(screen.getByTestId("sc-inspect-pane")).toBeTruthy();
    expect(screen.getByTestId("sc-imp-jump")).toBeTruthy();
    // 结论式顶栏：端到端产销 / 时窗档位 / 全局态指数 三样留着
    expect(screen.getByTestId("sc-scale").textContent ?? "").toContain("端到端产销");
    for (const w of ["30D", "60D", "90D"]) expect(screen.getByTestId(`sc-window-${w}`)).toBeTruthy();
    expect(screen.getByTestId("sandbox-kpi-global").textContent ?? "").toContain("0–100 指数");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§2 · 治理横幅（主屏唯一保留的治理信号）—— 两向", () => {
  it("canEnterSimulation=false ⇒ 横幅在，且含**真 gap 文案**（不是一句泛泛的警告）", async () => {
    mount();
    await ready();
    const banner = await screen.findByTestId("sandbox-gov-banner");
    const txt = banner.textContent ?? "";
    // 真 gap 的三要素（gapCode / ref / detail）逐字在屏上 —— 前端不改写、不总结。
    expect(txt, "缺 gapCode ⇒ 用户没法去查是哪一条").toContain(GAPS[0]!.gapCode);
    expect(txt, "缺 detail ⇒ 只剩一句「未就绪」，等于没说").toContain(GAPS[0]!.detail);
    expect(txt).toContain(GAPS[1]!.detail);
    // 截断必须看得见：4 条只显 3 条 ⇒ 屏上要写还有 1 条，不许让人以为"就这些"。
    expect(screen.getByTestId("sandbox-gov-banner-more").textContent ?? "").toContain("1");
    // 「查看详情 →」真的能打开抽屉（不是一个死链接）
    const user = userEvent.setup();
    expect(screen.queryByTestId("sc-diag-panel")).toBeNull();
    await user.click(screen.getByTestId("sandbox-gov-banner-cta"));
    expect(await screen.findByTestId("sc-diag-panel")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("sim-cert-level")).toBeTruthy());
  });

  it("canEnterSimulation=true ⇒ 横幅**不存在**（是不渲染，不是 hidden ——「一切正常」不占任何像素）", async () => {
    fetchCertFn.mockImplementation(async () => certOf(true));
    mount();
    await ready();
    // 等一个只有 cert 到齐后才会变的锚点，确保这不是"还没渲染"的假阴性。
    await waitFor(() => expect(screen.getByTestId("sc-diag-toggle").getAttribute("data-issues")).toBe("0"));
    expect(
      screen.queryByTestId("sandbox-gov-banner"),
      "已认证还挂着一条治理横幅 ⇒ 把噪音当安全感；规范 §1：第一层只放结论",
    ).toBeNull();
    expect(screen.queryByTestId("sandbox-gov-banner-cta")).toBeNull();
  });

  it("cert 还没取到 ⇒ 也不出横幅（**不知道 ≠ 不能推演**，拿警告填未知就是编造治理结论）", async () => {
    fetchCertFn.mockImplementation(async () => {
      throw { error: { code: "FEATURE_NOT_FOUND", message: "sim.certification 关", requestId: "r1" } };
    });
    mount();
    await screen.findByTestId("sandbox-console");
    await waitFor(() => expect(fetchCertFn).toHaveBeenCalled());
    expect(screen.queryByTestId("sandbox-gov-banner")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§3 · `?` 浮层规格（docs/CONVENTION-ui-information-layering.md §2 R-UI-3）", () => {
  it("悬停显示 · **移开立即消失**（这条就是环形图那个原生 tooltip 事故的对策）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const trigger = screen.getByTestId("info-legend");
    expect(screen.queryByTestId("info-body-legend"), "默认就展开 ⇒ 它根本没起到收纳作用").toBeNull();

    await user.hover(trigger);
    expect(await screen.findByTestId("info-body-legend")).toBeTruthy();

    await user.unhover(screen.getByTestId("info-wrap-legend"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("info-body-legend"),
        "移开后浮层还在 ⇒ 正是仓主实测报的那个「弹窗不消失、遮挡图形」的病样",
      ).toBeNull(),
    );
  });

  it("键盘可达：focus 显示 / blur 消失 / Esc 关闭（鼠标不是唯一入口）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const trigger = screen.getByTestId("info-legend") as HTMLButtonElement;

    // `act` 包住原生 focus()：它触发的是真 `focusin`（React 18 的 onFocus 就挂在这个事件上），
    // 不 act 包住的话 state 更新落在 React 的 act 环境之外、可能不刷新 ⇒ 假红。
    await act(async () => {
      trigger.focus();
    });
    expect(await screen.findByTestId("info-body-legend")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // 正文经 aria-describedby 挂在触发器上（读屏能读到，不只是视觉上有）
    expect(trigger.getAttribute("aria-describedby")).toBe(screen.getByTestId("info-body-legend").getAttribute("id"));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("info-body-legend")).toBeNull());

    await act(async () => {
      trigger.blur();
      trigger.focus();
    });
    await screen.findByTestId("info-body-legend");
    await act(async () => {
      trigger.blur();
    });
    await waitFor(() => expect(screen.queryByTestId("info-body-legend")).toBeNull());
  });

  it("浮层是**受控 DOM 节点**，不是原生 tooltip：主屏不许用 HTML `title` 属性充当浮层", async () => {
    mount();
    await ready();
    const console_ = screen.getByTestId("sandbox-console");
    // 规范 §2 明令禁止：`title` 属性 / SVG `<title>` 由操作系统绘制、恒在最上层、移开滞留。
    // 金丝雀（自证这条查询真的在查东西）：先确认我们**确实**扫到了元素，再断言没有违规元素。
    const all = console_.querySelectorAll("*");
    expect(all.length, "金丝雀：控制台里一个元素都没扫到 ⇒ 是查询坏了，不是页面干净").toBeGreaterThan(50);
    const svgTitles = console_.querySelectorAll("svg title");
    expect(
      Array.from(svgTitles).map((t) => t.textContent),
      "SVG <title> = 原生 tooltip（规范 §2 明令禁止用它充当浮层）",
    ).toEqual([]);
  });

  it("浮层戴的是**验过的那张表面**（全局 .popover-surface），不是自己另写一份背景", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("info-legend"));
    const body = await screen.findByTestId("info-body-legend");
    // 欠账 #104 的那张表面：`test/provenance-popover-legibility.test.tsx` 已对三套主题
    // 逐一验过「渲染像素不依赖底下的内容」。自己再写一份 background 就是开一条没人验的分身
    // （反面教材：.panel 磨砂玻璃上文字对比度从 9.19 掉到 1.01）。
    expect(body.className, "浮层没戴 popover-surface ⇒ 它的可读性没有任何门在验").toContain("popover-surface");
    expect(/\bpanel\b/.test(body.className), "浮层挂在磨砂玻璃 .panel 上 ⇒ 底下内容会透上来").toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
/**
 * §4 · **右栏溢出 ⇒ 中栏大片空白** 这条结构缺陷的回归锁。
 *
 * ── 病理（在 canonical 96038d1d 的 CSS/DOM 上逐条追出来的，不是猜）─────────────
 * 仓主截图里两个症状是**同一个成因**：右栏被塞爆 ＋ 中间主区几乎整屏空白。
 *  ① `.root` 是 `display:grid`，第三行（三栏区）写 `minmax(0,1fr)`，
 *     但**容器本身没有确定高度**（只有 `min-height:76vh`）⇒ 该行是**内容驱动**的，1fr 不封顶；
 *  ② `.mid` 三列 grid + 默认 `align-items:stretch` ⇒ **行高 = 最高那一列的内容高度**；
 *  ③ 右栏 `.pane` **自身没有 `overflow`**，而右栏折叠区那几个 `<details>`
 *     （canonical `SandboxConsole.tsx:801-806`）是 `.paneBody` 的**兄弟节点**、
 *     落在任何 `overflow:auto` 容器**之外** ⇒ 就绪认证（L0–L4 + 雷达 + 三卡 + gauge +
 *     entering 13 条 + 缺件清单）＋ 世界列表 7 行按钮，全额计入右栏高度；
 *  ④ 于是三栏行被撑得很高，而中栏 `.canvasSlot`（`flex:1` + `overflow:auto`）
 *     被拉到同样高度、内容却只有画布那么高 ⇒ **下方大片全空**。
 *
 * ── 修法（三条，缺一条这个坑就还能从别的路回来）─────────────────────────────
 *  A. `.root` 改 flex 列 + `.mid { flex: 1 1 0 }` ⇒ 行高取**剩余空间**，永不再由内容决定；
 *  B. 右栏折叠区包进 `.railStack`（自带 `max-height` + `overflow:auto`）；
 *  C. 最大的两个占位者（就绪认证 / 世界列表）整体搬进诊断抽屉。
 *
 * ── 为什么这道门咬的是 CSS 文本 + DOM 结构，不是像素 ─────────────────────────
 * jsdom **不做布局**（`offsetHeight` 恒 0），断言不出"空了多少像素"。
 * 所以这里咬的是**让那个像素结果不可能发生的结构不变量**。
 * 本仓已有同款做法（`sandbox-console.seam §9` 直接咬 `.emptyCard` 的 `clip-path` 声明）。
 * ⚠ 诚实边界：**这不能替代真浏览器实拍** —— 本沙箱没有 chromium
 * （`scripts/ui-smoke-sandbox.mjs` 会 SKIP），故本单**未做浏览器复验**，此处只锁结构。
 */
describe("§4 · 右栏撑高三栏行 ⇒ 中栏空白（结构不变量回归锁）", () => {
  const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), "../src/views/sim/SandboxConsole.module.css");
  const css = readFileSync(CSS_PATH, "utf8");

  it("金丝雀：CSS 文件真的读到了（否则下面每条『没找到』都是工具坏了，不是代码对了）", () => {
    expect(css.length, "CSS 读成空 ⇒ 路径错了").toBeGreaterThan(2000);
    // 一个与本单无关、canonical 上就有的已知规则 —— 它若也找不到，就是路径/解析的问题。
    expect(css, "金丝雀规则 `.impCard` 都找不到 ⇒ 读错文件了").toContain(".impCard");
  });

  it("A · `.mid` 的高度取**剩余空间**（flex-basis 0），不再由最高那一列的内容决定", () => {
    const mid = /\.mid\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(mid, "没抓到 .mid 规则体").not.toBe("");
    expect(
      mid.replace(/\s+/g, " "),
      "`.mid` 缺 `flex: 1 1 0` ⇒ 三栏行高又变回内容驱动，右栏一多就把中栏拉出大片空白",
    ).toContain("flex: 1 1 0");
  });

  it("B · 右栏折叠区有**自己的滚动容器**（内容再多也不外溢到行高上）", () => {
    const stack = /\.railStack\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(stack, "没抓到 .railStack 规则体 —— 折叠区又回到裸挂在 .pane 下了").not.toBe("");
    expect(stack).toContain("overflow: auto");
    expect(stack, "缺 max-height ⇒ overflow 永远不会触发").toContain("max-height");
  });

  it("B' · DOM 上折叠区**确实**被包在那个滚动容器里（CSS 写了但没挂上等于没写）", async () => {
    mount();
    await ready();
    const stack = screen.getByTestId("sc-rail-stack");
    for (const id of ["sc-rail-compare", "sc-rail-commander"]) {
      const el = screen.getByTestId(id);
      expect(stack.contains(el), `${id} 不在 sc-rail-stack 里 ⇒ 它的高度仍会计入三栏行高`).toBe(true);
    }
  });

  it("C · 最大的两个占位者（就绪认证 / 世界列表）**不在右栏**了（它们才是把右栏塞爆的那两个）", async () => {
    mount();
    await ready();
    const inspectPane = screen.getByTestId("sc-inspect-pane");
    expect(inspectPane.querySelector('[data-testid="sandbox-readiness"]')).toBeNull();
    expect(inspectPane.querySelector('[data-testid="sandbox-worlds"]')).toBeNull();
  });
});
