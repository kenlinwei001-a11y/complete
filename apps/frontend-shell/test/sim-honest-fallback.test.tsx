import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ChainLossMatrixResult } from "@platform/contracts";
import { server } from "./setup";
import { loginAs, renderWithClient } from "./utils";
import { SandboxAttr } from "@/views/sim/console/SandboxAttr";
import { HEAT_EMPTY_GLYPH } from "@/views/sim/console/HeatMatrix";
import { EMPTY_REASON } from "@/views/sim/console/useLossAttribution";
import {
  CARD_EMPTY_REASON,
  StrategyCards,
  emptyStrategyCards,
  projectMitigationCards,
} from "@/views/sim/console/StrategyCards";

/**
 * ══ WO-SIM-HONEST-FALLBACK-A · 「兜底占位不许编数」的接缝门 ═══════════════════
 *
 * ── 病灶：今天的行为是 X，应该是 Y（本单开工前实测）──────────────────────────
 *
 * **X**：归因台的四格与应对策略卡**都已接真端点**，但端点没答 / 还在飞 / 参数不全时
 * 一律 `return PLACEHOLDER_*` —— 一整套抄自规格 HTML 的**业务数值**
 * （热矩阵 40 个百分比、根因树 10 行、明细 16 行、时序 12 行 × 120 个段坐标、
 * 策略卡「残差比 80 %」而求解器根本没有这一格）。
 * 屏上因此画着一张**看起来完全正常**的表，用户无从分辨它是真算出来的还是兜底编的
 * —— 本仓点名的「静默错答」：请求成功、界面照画、值是假的。
 *
 * **Y**：仓主 2026-08-09 裁定二（`scripts/check-debattery.mjs` 探测器 B 的报错文案原话）：
 * > 数据必须来自一次真实 API 调用。真没有的数据返回诚实空 + reason，不许兜底编一个。
 *
 * ── 这道门咬的是**链路**不是函数 ─────────────────────────────────────────────
 * 三条臂都**真渲染画布组件**、真让它自己发请求、真读屏上的字：
 *   ① 端点给真数据 ⇒ 屏上是**回包里那几个数**（逐值对拍，不是"有数就算过"）；
 *   ② 端点 200 但空 ⇒ 屏上诚实空态 + 原因，**且这一片里一个数字都没有**；
 *   ③ 参数不全没发请求 ⇒ 与 ② **不同的**屏上态（标的就是这一条：
 *      「没有这个数」与「没在问」混成一个态，用户仍然不知道发生了什么）。
 * 断言落在 `textContent` / `title` 上（**用户读得到的地方**），不落在 `data-source` 上
 * —— 那是属性，用户看不见；本单要消灭的那个态里 `data-source` 一直是对的。
 *
 * ── 工具自证（铁律 0.6：扫描类结论一律先跑金丝雀）────────────────────────────
 * 用例 ⓪ 先证明探针本身是好的：已知必中的选择器要中、已知必不中的要落空。
 * 本仓真事：探针选择器匹配到折叠组里不可见的元素，被误读成「按钮不存在」，连续误判两次。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 桩：环节 × 基地 损失矩阵的三种回包
// ══════════════════════════════════════════════════════════════════════════

const MATRIX_PATH = "*/a/v1/sim/chain-loss-matrix";
const DRILL_PATH = "*/a/v1/sim/chain-loss-drill";

const NODE_A = "capacity.aging";
const NODE_B = "material.kitting";
const BASE_A = "base_a";

/** 有数据的回包：**两行一列三个数**，屏上必须逐值对得上（`pct` 取整后就是格子里的字）。 */
const MATRIX_WITH_DATA: ChainLossMatrixResult = {
  nodes: [
    { nodeId: NODE_A, stage: "CAPACITY", label: "老化静置" },
    { nodeId: NODE_B, stage: "MATERIAL", label: "齐套发料" },
  ],
  bases: [{ baseId: BASE_A, name: "甲基地" }],
  cells: [
    { nodeId: NODE_A, baseId: BASE_A, pct: 37, days: 4.1 },
    { nodeId: NODE_B, baseId: BASE_A, pct: 63, days: 6.9 },
  ],
  rowTotals: [
    { nodeId: NODE_A, days: 4.1, pctOfGrandLoss: 37, baseCount: 1 },
    { nodeId: NODE_B, days: 6.9, pctOfGrandLoss: 63, baseCount: 1 },
  ],
  colTotals: [
    {
      baseId: BASE_A,
      anchorSo: "SO-HONEST-1",
      anchorBaseId: BASE_A,
      anchorAgingProcessId: "proc_1",
      days: 11,
      sumPct: 100,
      cellCount: 2,
      missingNodeIds: [],
      reason: null,
      probe: null,
    },
  ],
  residual: { byBase: [{ baseId: BASE_A, residualPct: 0, ok: true, reason: null }], rows: 0, rowsOk: true, tolerancePct: 0.5 },
  summary: "接缝桩：两环节 × 一基地",
};

/**
 * 200 但空：**行列都在、一个格子都没有**，且后端这次没逐列给 reason
 * （`reason: null`）—— 屏上仍然要有一句人话，那句话得由前端自己补上。
 */
const MATRIX_ANSWERED_EMPTY: ChainLossMatrixResult = {
  ...MATRIX_WITH_DATA,
  cells: [],
  rowTotals: [],
  colTotals: [{ ...(MATRIX_WITH_DATA.colTotals[0] as (typeof MATRIX_WITH_DATA.colTotals)[number]), days: null, sumPct: null, cellCount: 0, reason: null }],
  summary: "接缝桩：答了，但没有可归因的损失",
};

const err = (status: number) =>
  HttpResponse.json({ error: { code: "INTERNAL", message: "INTERNAL", requestId: "req_honest" } }, { status });

/** 矩阵一旦是真数据，根因树就会去下钻。本门不咬子因 ⇒ 显式桩 404 让它确定性落空。 */
function install(matrix: ChainLossMatrixResult | "fail"): void {
  server.use(
    http.post(MATRIX_PATH, () => (matrix === "fail" ? err(500) : HttpResponse.json(matrix))),
    http.post(DRILL_PATH, () => err(404)),
  );
}

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 探针
// ══════════════════════════════════════════════════════════════════════════

const heatCells = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-testid^="sandbox-attr-heat-cell-"]'),
];
const cellOf = (nodeId: string, baseId: string): HTMLElement =>
  screen.getByTestId(`sandbox-attr-heat-cell-${nodeId}-${baseId}`);

/**
 * 贡献度时序那一格里**用户读得到的那几列**（竖排组名 / 环节 / 基线 / 扰动后）。
 * 刻意**不含第 5 列泳道** —— 那一列画的是轨道刻度（`00:00`…），带数字是应该的，
 * 把它算进来会让「这一片没有业务数值」这条断言恒红（那是尺子选错，不是代码有问题）。
 */
function seriesValueText(): string {
  const grid = screen.getByTestId("sandbox-attr-series");
  return [...grid.children].slice(0, 4).map((c) => c.textContent ?? "").join(" ");
}

beforeEach(() => {
  // 不登录 ⇒ 401 ⇒ apiClient 触发全局跳登录，jsdom 报一串 "Not implemented: navigation"。
  // 那是测试没登录造成的噪声，不是组件的行为。
  loginAs("planner");
});
afterEach(cleanup);

describe("WO-SIM-HONEST-FALLBACK-A · 端点回包 → 屏上态（三态必须互不相同）", () => {
  it("⓪ 探针先自证：已知必中的要中、已知必不中的要落空（不中 ⇒ 报「工具坏了」）", async () => {
    install(MATRIX_WITH_DATA);
    renderWithClient(<SandboxAttr />);

    // 已知必中：热矩阵一定会渲染格子（有数据没数据都渲染，只是内容不同）。
    await waitFor(() => expect(heatCells().length).toBeGreaterThan(0));
    // 已知必不中：这个基地 id 桩里根本没有 ⇒ 探针必须落空（证明它不是"什么都返回一个元素"）。
    expect(document.querySelector('[data-testid="sandbox-attr-heat-cell-capacity.aging-no-such-base"]')).toBeNull();
    // 四条原因文案互不相同 —— 这是本门全部三条臂能分得开的前提，先证明它成立。
    const reasons = Object.values(EMPTY_REASON);
    expect(new Set(reasons).size, "四条空态原因里有重复 ⇒ 三态从源头上就分不开").toBe(reasons.length);
    // 且一条内部符号名都不许出现在屏上文案里（用户不认识，写了等于没解释）。
    for (const r of reasons) expect(r).not.toMatch(/sessionId|objectType|nodeId|\bso\b|placeholder/i);
  });

  it("① 端点给真数据 ⇒ 屏上是**回包里那几个数**（逐值对拍，不是「有数就算过」）", async () => {
    install(MATRIX_WITH_DATA);
    renderWithClient(<SandboxAttr />);

    await waitFor(() =>
      expect(screen.getByTestId("sandbox-attr-heat").getAttribute("data-source")).toBe("endpoint"),
    );
    // 逐格对拍：屏上的字 == 回包 `pct` 取整；`title` 里的天数 == 回包 `days`。
    expect(MATRIX_WITH_DATA.cells.length, "桩里一个格子都没有 ⇒ 这条断言等于没跑").toBeGreaterThan(0);
    for (const c of MATRIX_WITH_DATA.cells) {
      const el = cellOf(c.nodeId, c.baseId);
      expect(el.textContent).toBe(String(Math.round(c.pct)));
      expect(el.getAttribute("data-empty")).toBe("0");
      expect(el.getAttribute("title")).toContain(c.days.toFixed(2));
    }
    // 反向证据：真数据态下屏上**不出现**任何一条空态文案。
    const heat = screen.getByTestId("sandbox-attr-heat").textContent ?? "";
    for (const r of Object.values(EMPTY_REASON)) expect(heat).not.toContain(r);
  });

  it("② 端点 200 但空 ⇒ 诚实空态 + 原因，且这一片里**一个数字都没有**", async () => {
    install(MATRIX_ANSWERED_EMPTY);
    renderWithClient(<SandboxAttr />);

    await waitFor(() =>
      expect(screen.getByTestId("sandbox-attr-heat").getAttribute("data-source")).toBe("endpoint"),
    );
    const cells = heatCells();
    expect(cells.length, "空态下热矩阵一格都没渲染 ⇒ 版面塌了（本单硬约束：等高空态）").toBeGreaterThan(0);
    for (const el of cells) {
      // 印「—」而不是 0：「没有数」和「数是 0」是两个相反的结论。
      expect(el.textContent).toBe(HEAT_EMPTY_GLYPH);
      expect(el.textContent).not.toBe("0");
      expect(el.getAttribute("data-empty")).toBe("1");
      // 原因**用户读得到**（悬停），不是只写在 data-* 里。
      expect(el.getAttribute("title")).toBe(EMPTY_REASON.empty);
    }
    // 整片热矩阵（含行名列名）里一个阿拉伯数字都不许有 —— 有就是又编了一个数。
    expect(screen.getByTestId("sandbox-attr-heat").textContent ?? "").not.toMatch(/\d/);
  });

  it("③ 参数不全没发请求 ⇒ 与 ② **不同**的屏上态（「没在问」≠「问了但没有」）", async () => {
    install(MATRIX_ANSWERED_EMPTY);
    // 不给 sessionId ⇒ `useContributionSeries` 的 useQuery `enabled:false` ⇒ 压根不发请求。
    renderWithClient(<SandboxAttr />);

    // ⚠ 先等**矩阵那一跳落地**再读两格。底部时序的 `notAsked` 是同步就有的，
    //   只等它会在矩阵还停在骨架态时就往下跑 —— 那时热矩阵的格子 id 还是骨架的那批，
    //   下面 `cellOf(NODE_A, BASE_A)` 必然找不到（本条实测踩过一次：单跑绿、整文件跑红）。
    await waitFor(() =>
      expect(screen.getByTestId("sandbox-attr-heat").getAttribute("data-source")).toBe("endpoint"),
    );
    expect(seriesValueText()).toContain(EMPTY_REASON.notAsked);
    const text = seriesValueText();
    // 与第 ② 臂那句话**不是同一句**：混成一个态就是本单的标的。
    expect(text, "「没在问」被说成了「问了但没有」⇒ 用户仍然不知道发生了什么").not.toContain(
      EMPTY_REASON.empty,
    );
    // 这几列里只有 `—`，没有任何业务读数。
    expect(text).toContain("—");
    expect(text).not.toMatch(/\d/);
    // 同一块屏上，热矩阵那格报的是**另一条**原因 —— 两格各说各的实话。
    expect(cellOf(NODE_A, BASE_A).getAttribute("title")).toBe(EMPTY_REASON.empty);
  });

  it("④ 端点没答上来（500）⇒ 第三种态，既不是「没在问」也不是「问了但没有」", async () => {
    install("fail");
    renderWithClient(<SandboxAttr />);

    await waitFor(() =>
      expect(cellOf("demand.consensus", "changzhou").getAttribute("title")).toBe(EMPTY_REASON.noAnswer),
    );
    const heat = screen.getByTestId("sandbox-attr-heat").textContent ?? "";
    expect(heat).not.toMatch(/\d/);
    // 骨架行取自冻结册（真出处），且**不是满册** —— 满册等于把骨架读成「这就是全部环节」。
    const rows = document.querySelectorAll('[data-testid^="sandbox-attr-heat-row-"]');
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 应对策略卡：求解器没有的那一格，屏上必须印 `—`
// ══════════════════════════════════════════════════════════════════════════

describe("WO-SIM-HONEST-FALLBACK-A · 应对策略卡（求解器回包 → 屏上态）", () => {
  const PLANS = [
    { key: "night_shift", name: "增开夜班", eff: 11, tn: 2, cost: "中", score: 0.4 },
    { key: "cross_train", name: "跨基地借调", eff: 9, tn: 5, cost: "低", score: 0.9 },
    { key: "temp_labor", name: "临时用工", eff: 8, tn: 3, cost: "中", score: 0.2 },
  ];

  it("① 求解器给了方案 ⇒ 名字/推荐/达成度上屏；**残差比仍是 `—`**（求解器就是没这一格）", () => {
    const cards = projectMitigationCards(PLANS, "cross_train");
    renderWithClient(<StrategyCards cards={cards} source="solver" onApply={() => undefined} />);

    const top = screen.getByTestId("sandbox-detail-strategy-cross_train");
    expect(top.textContent).toContain("跨基地借调"); // 金丝雀：真数据确实上屏了
    expect(top.textContent).toContain("100 %"); // 达成度 = 相对最优案 ⇒ 榜首恒 100
    // 残差比：求解器没有这一格 ⇒ 屏上 `—`。改造前这里印的是规格占位的 `80 %`。
    expect(top.querySelector("em")?.textContent).toBe("—");
    expect(top.getAttribute("data-prov-residual")).toBe("placeholder");
    // 推荐档才有可点的按钮。
    expect(screen.getByTestId("sandbox-detail-apply").getAttribute("data-enabled")).toBe("1");
  });

  it("② 没在问（宿主还没选基地/因素）⇒ 三张空卡 + 说人话的原因，按钮不可点", () => {
    const cards = emptyStrategyCards(CARD_EMPTY_REASON.notAsked);
    renderWithClient(<StrategyCards cards={cards} source="placeholder" />);

    const stk = screen.getByTestId("sandbox-detail-strategies");
    // 版面不塌：仍是三张卡（`.stk` 那一列的高度按三张卡定）。
    expect(stk.querySelectorAll('[data-testid^="sandbox-detail-strategy-"]').length).toBe(3);
    expect(stk.textContent).toContain(CARD_EMPTY_REASON.notAsked.short);
    // 一个业务数值都没有：屏上只剩表头文字、`—` 和达成度条。
    expect(stk.textContent).not.toMatch(/\d/);
    // 「有一个可以应用的推荐」这句话没有出处时不许说：徽标不出现，按钮不可点。
    expect(stk.textContent).not.toContain("推荐");
    expect(screen.getByTestId("sandbox-detail-apply").getAttribute("data-enabled")).toBe("0");
  });

  it("③ 求解器答了但零方案 ⇒ 与「没在问」**不同**的那句话", () => {
    const cards = emptyStrategyCards(CARD_EMPTY_REASON.empty);
    renderWithClient(<StrategyCards cards={cards} source="placeholder" />);

    const stk = screen.getByTestId("sandbox-detail-strategies");
    expect(stk.textContent).toContain(CARD_EMPTY_REASON.empty.short);
    expect(stk.textContent).not.toContain(CARD_EMPTY_REASON.notAsked.short);
    // 四条卡面原因互不相同（同 § 1 用例 ⓪ 的判据，这一格自己也要成立）。
    const shorts = Object.values(CARD_EMPTY_REASON).map((r) => r.short);
    expect(new Set(shorts).size).toBe(shorts.length);
  });
});
