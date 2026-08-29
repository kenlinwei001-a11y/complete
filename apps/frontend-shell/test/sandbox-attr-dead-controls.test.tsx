import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import {
  CHAIN_NODE_REGISTRY,
  NETWORK_SCOPE_KEY,
  SimMetricSeriesItemSchema,
  SimMetricSegmentSchema,
  baseScopeOptions,
  chainNodeDef,
  type ChainLossMatrixResult,
} from "@platform/contracts";
import { server } from "./setup";
import { loginAs, renderWithClient } from "./utils";
import { SandboxAttr } from "@/views/sim/console/SandboxAttr";
import { projectHeatByScope, SCOPE_NOT_IN_MATRIX, type HeatMatrixModel } from "@/views/sim/console/useLossAttribution";

/**
 * ══ WO-ATTR-DEAD-CONTROLS · 「点了没反应」的死控件门 ═════════════════════════
 *
 * ── 病灶（仓主在跑起来的系统上逐个点、点不动，不是推测）─────────────────────
 * **X（改造前）**：归因台上有三个控件是死的 ——
 *   ① 段页签（`全局/需求段/产能段/物料段/交付段`）是 `<b>`：无 `onClick`、无 state、高亮写死第 0 个；
 *   ② 轮次页签（`第一轮次`…）同病；
 *   ③ 基地/全网下拉是 `<select defaultValue={SCOPES[0]?.key}>`：**非受控、无 `onChange`**，
 *      而且 `defaultValue` 是**常州**、屏上却画着全部 13 列 —— 控件报的状态本身就是假的。
 * **Y（现在）**：能接的接上（③ 真筛列）、接不上的**显式 `disabled` + `title` 说清为什么**（①②）。
 *
 * ── 这道门咬的是**链路**不是函数 ─────────────────────────────────────────────
 * 三条臂都真渲染画布、真发请求、真用 `userEvent` 点/选，再读屏上的 DOM：
 *   §1 段页签为什么不可用 —— **契约形状现算**，不是抄一句结论；
 *   §2 范围下拉真的筛 —— 选基地 ⇒ 只剩该列；选全网 ⇒ 列全回来；
 *       且**逐块断言哪块跟了哪块没跟**（静默只变一半比什么都不变更能骗人）；
 *   §3 死控件普查 —— 扫渲染出来的整棵树，凡「看起来能点」的必须二选一：真接上，或显式 disabled。
 *
 * ── 工具自证（铁律 0.6：扫描类结论一律先跑金丝雀）────────────────────────────
 * 用例 ⓪ 先证明探针是好的：已知必中的要中、已知必不中的要落空。
 * 否则「扫出 0 个死控件」与「扫描器坏了」在屏上一模一样。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 桩：两个基地的损失矩阵（列筛选要能真的看出差别，一列的桩验不了）
// ══════════════════════════════════════════════════════════════════════════

const MATRIX_PATH = "*/a/v1/sim/chain-loss-matrix";
const DRILL_PATH = "*/a/v1/sim/chain-loss-drill";

const NODE_A = "capacity.aging";
const NODE_B = "material.kitting";
/** 基地 id 取**册里真有的两条** —— 编一个 id 会让「册外基地」那条臂验不到真实形态。 */
const BASE_KEEP = "changzhou";
const BASE_DROP = "hefei";

const colTotal = (baseId: string, days: number) => ({
  baseId,
  anchorSo: `SO-DEAD-${baseId}`,
  anchorBaseId: baseId,
  anchorAgingProcessId: `proc_${baseId}`,
  days,
  sumPct: 100,
  cellCount: 2,
  missingNodeIds: [],
  reason: null,
  probe: null,
});

const MATRIX_TWO_BASES: ChainLossMatrixResult = {
  nodes: [
    { nodeId: NODE_A, stage: "CAPACITY", label: "老化静置" },
    { nodeId: NODE_B, stage: "MATERIAL", label: "齐套发料" },
  ],
  bases: [
    { baseId: BASE_KEEP, name: "常州" },
    { baseId: BASE_DROP, name: "合肥" },
  ],
  cells: [
    { nodeId: NODE_A, baseId: BASE_KEEP, pct: 37, days: 4.1 },
    { nodeId: NODE_B, baseId: BASE_KEEP, pct: 63, days: 6.9 },
    { nodeId: NODE_A, baseId: BASE_DROP, pct: 21, days: 2.2 },
    { nodeId: NODE_B, baseId: BASE_DROP, pct: 79, days: 8.4 },
  ],
  rowTotals: [
    { nodeId: NODE_A, days: 6.3, pctOfGrandLoss: 29, baseCount: 2 },
    { nodeId: NODE_B, days: 15.3, pctOfGrandLoss: 71, baseCount: 2 },
  ],
  colTotals: [colTotal(BASE_KEEP, 11), colTotal(BASE_DROP, 10.6)],
  residual: {
    byBase: [
      { baseId: BASE_KEEP, residualPct: 0, ok: true, reason: null },
      { baseId: BASE_DROP, residualPct: 0, ok: true, reason: null },
    ],
    rows: 0,
    rowsOk: true,
    tolerancePct: 0.5,
  },
  summary: "死控件门桩：两环节 × 两基地",
};

function install(): void {
  server.use(
    http.post(MATRIX_PATH, () => HttpResponse.json(MATRIX_TWO_BASES)),
    // 本门不咬三级子因 ⇒ 显式 404 让它确定性落空（不落空会引入与本门无关的异步噪声）。
    http.post(DRILL_PATH, () =>
      HttpResponse.json({ error: { code: "NOT_FOUND", message: "n/a", requestId: "req_dead" } }, { status: 404 }),
    ),
  );
}

// ══════════════════════════════════════════════════════════════════════════
// § 探针
// ══════════════════════════════════════════════════════════════════════════

const canvas = (): HTMLElement => screen.getByTestId("sandbox-attr");
const scopeSelect = (): HTMLSelectElement => screen.getByTestId("sandbox-attr-scope") as HTMLSelectElement;
/** 屏上真渲染出来的热力列（表头一格一列）。 */
const heatBaseIds = (): string[] =>
  [...document.querySelectorAll('[data-testid^="sandbox-attr-heat-base-"]')].map(
    (el) => el.getAttribute("data-testid")?.replace("sandbox-attr-heat-base-", "") ?? "",
  );
const heatCellIds = (): string[] =>
  [...document.querySelectorAll('[data-testid^="sandbox-attr-heat-cell-"]')].map(
    (el) => el.getAttribute("data-testid") ?? "",
  );

/** 等矩阵那一跳真的落地（骨架态与真数据态的格子 id 完全不同，早读必然读到骨架）。 */
async function heatReady(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId("sandbox-attr-heat").getAttribute("data-source")).toBe("endpoint"),
  );
}

beforeEach(() => {
  loginAs("planner");
  install();
});
afterEach(cleanup);

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 段页签 / 轮次页签：不可用，且**说得出为什么**
// ══════════════════════════════════════════════════════════════════════════

describe("WO-ATTR-DEAD-CONTROLS §1 · 页签不可用是据实的（判据从契约现算，不抄结论）", () => {
  it("⓪ 探针自证：已知必中的要中、已知必不中的要落空", async () => {
    renderWithClient(<SandboxAttr />);
    await heatReady();
    // 已知必中：段页签那一条肯定渲染得出来。
    expect(screen.getByTestId("sandbox-attr-stage-tabs")).toBeTruthy();
    // 已知必不中：这个 testid 根本不存在 ⇒ 探针必须落空（证明它不是「什么都返回一个元素」）。
    expect(document.querySelector('[data-testid="sandbox-attr-no-such-thing"]')).toBeNull();
    // 已知必中：热力列探针在真数据态下一定有命中。
    expect(heatBaseIds().length).toBeGreaterThan(0);
  });

  it("① 契约现算：贡献度时序的指标行**没有段（ChainStage）维度**", () => {
    // 金丝雀先跑：注册表这一侧**确实**有 `stage`，且取得到 —— 不中就是探针坏了，不是"数据里没有"。
    expect(CHAIN_NODE_REGISTRY.length, "环节注册表是空的 ⇒ 这条在空转").toBeGreaterThan(0);
    for (const n of CHAIN_NODE_REGISTRY) expect(typeof n.stage, "在册环节缺 stage ⇒ 金丝雀坏了").toBe("string");
    expect(chainNodeDef("capacity.aging")?.stage).toBe("CAPACITY");

    // 判据：指标行的字段集**现从契约 schema 取**（不是抄一份字段名清单在这里）。
    const itemKeys = Object.keys(SimMetricSeriesItemSchema.shape);
    expect(itemKeys.length, "指标行 schema 解析不出字段 ⇒ 尺子坏了").toBeGreaterThan(0);
    expect(itemKeys, "指标行上出现了 stage ⇒ 段页签可以接了，本门与组件里的记账都过期").not.toContain("stage");

    // 唯一可能通到段的那条路：`segments[].nodeId`，但它的取值域由 `source` 决定，
    // 且 schema 上同样没有 `stage`（`domain` 档的 D01…D13 在业务域册里没有段）。
    const segKeys = Object.keys(SimMetricSegmentSchema.shape);
    expect(segKeys).toContain("nodeId");
    expect(segKeys).toContain("source");
    expect(segKeys, "分段上出现了 stage ⇒ 段页签可以接了").not.toContain("stage");
  });

  it("② 五个段页签全部 disabled，且每个都挂着**用户读得到**的原因", async () => {
    renderWithClient(<SandboxAttr />);
    await heatReady();
    const tabs = [...screen.getByTestId("sandbox-attr-stage-tabs").querySelectorAll("button")];
    expect(tabs.length, "段页签一个都没渲染 ⇒ 断言等于没跑").toBeGreaterThan(0);
    for (const t of tabs) {
      expect(t.disabled, `段页签「${t.textContent}」没 disabled ⇒ 又是一个点了没反应的东西`).toBe(true);
      const why = t.getAttribute("title") ?? "";
      expect(why.length, `段页签「${t.textContent}」没说为什么不可用`).toBeGreaterThan(0);
      // 说人话：一个内部符号名都不许出现（用户不认识，写了等于没解释）。
      expect(why).not.toMatch(/ChainStage|stage|nodeId|sessionId|segments|placeholder/i);
    }
    // 反向证据：`<b>` 那个老形态**不许**回来（回来了就是又一个假页签）。
    expect(
      screen.getByTestId("sandbox-attr-stage-tabs").querySelector("b, u, i"),
      "页签栏里又出现了 b/u/i ⇒ 退回成了看起来能点、点了没反应的东西",
    ).toBeNull();
  });

  it("③ 轮次页签同样 disabled + 有原因（含右侧那两个翻页箭头）", async () => {
    renderWithClient(<SandboxAttr />);
    await heatReady();
    for (const testid of ["sandbox-attr-rounds", "sandbox-attr-stage-tabs"]) {
      const bar = screen.getByTestId(testid);
      const btns = [...bar.querySelectorAll("button")];
      expect(btns.length, `${testid} 一个按钮都没有 ⇒ 断言等于没跑`).toBeGreaterThan(0);
      for (const b of btns) {
        expect(b.disabled, `${testid} 里的「${b.textContent}」没 disabled`).toBe(true);
        expect((b.getAttribute("title") ?? "").length, `${testid} 里的「${b.textContent}」没说为什么`).toBeGreaterThan(0);
      }
      expect(bar.querySelector("b, u, i"), `${testid} 里又出现了 b/u/i`).toBeNull();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 范围下拉：真的筛，且**说得清它影响不到什么**
// ══════════════════════════════════════════════════════════════════════════

describe("WO-ATTR-DEAD-CONTROLS §2 · 范围下拉真的筛热力图（选了就变，切回就回来）", () => {
  it("① 默认「全网」== 屏上真在画的那件事（改前默认是常州、却画着全部列）", async () => {
    renderWithClient(<SandboxAttr />);
    await heatReady();
    expect(scopeSelect().value).toBe(NETWORK_SCOPE_KEY);
    expect(heatBaseIds()).toEqual([BASE_KEEP, BASE_DROP]);
  });

  it("② 选「常州基地」⇒ 热力图**只剩常州列**；切回「全网」⇒ 列全回来", async () => {
    const user = userEvent.setup();
    renderWithClient(<SandboxAttr />);
    await heatReady();
    const before = heatCellIds();
    expect(before.length, "筛之前一个格子都没有 ⇒ 后面「变少了」验不到东西").toBe(4);

    await user.selectOptions(scopeSelect(), BASE_KEEP);
    await waitFor(() => expect(heatBaseIds()).toEqual([BASE_KEEP]));
    // 逐格断言：留下的全是常州列，被筛掉的那列**一个格子都不剩**。
    const kept = heatCellIds();
    expect(kept.length).toBe(2);
    for (const id of kept) expect(id.endsWith(`-${BASE_KEEP}`)).toBe(true);
    expect(kept.some((id) => id.endsWith(`-${BASE_DROP}`))).toBe(false);
    // 留下这一列的**数一个都没变**（列投影不许重算任何一个数）。
    expect(screen.getByTestId(`sandbox-attr-heat-cell-${NODE_A}-${BASE_KEEP}`).textContent).toBe("37");
    expect(screen.getByTestId(`sandbox-attr-heat-cell-${NODE_B}-${BASE_KEEP}`).textContent).toBe("63");

    await user.selectOptions(scopeSelect(), NETWORK_SCOPE_KEY);
    await waitFor(() => expect(heatBaseIds()).toEqual([BASE_KEEP, BASE_DROP]));
    expect(heatCellIds().sort()).toEqual(before.sort());
  });

  it("③ 逐块点名：哪块跟着范围变、哪块不跟 —— 且**屏上说得出来**", async () => {
    const user = userEvent.setup();
    renderWithClient(<SandboxAttr />);
    await heatReady();

    // 跟着变的那一块，机器可读的记号说「我跟」。
    const heat = screen.getByTestId("sandbox-attr-heat");
    expect(heat.getAttribute("data-scope-follows")).toBe("1");
    expect(heat.getAttribute("data-scope")).toBe(NETWORK_SCOPE_KEY);

    // 不跟的三块，各自说「我不跟」。
    for (const testid of ["sandbox-attr-left", "sandbox-attr-right", "sandbox-attr-bot"]) {
      expect(screen.getByTestId(testid).getAttribute("data-scope-follows"), `${testid} 没表态跟不跟`).toBe("0");
    }

    // 记号只是给机器看的 —— 用户那一半必须也有：下拉自己挂着边界说明，
    // 且那句话**逐个点了名**哪三块不跟（不是一句含糊的「部分区域」）。
    const hint = scopeSelect().getAttribute("title") ?? "";
    expect(hint).toContain("热力");
    expect(hint).toContain("根因树");
    expect(hint).toContain("归因明细");
    expect(hint).toContain("瀑布");

    // 真跑一遍：选了基地之后，不跟的那块**内容确实没动**（不是靠属性自证）。
    const detailBefore = screen.getByTestId("sandbox-attr-detail").textContent;
    await user.selectOptions(scopeSelect(), BASE_KEEP);
    await waitFor(() => expect(heatBaseIds()).toEqual([BASE_KEEP]));
    expect(
      screen.getByTestId("sandbox-attr-detail").textContent,
      "归因明细跟着基地变了 ⇒ 与屏上那句话对不上（它的三级子因走的是订单号那条路，没有基地维度）",
    ).toBe(detailBefore);
    // 记号跟着选中项走（不是写死的 1）。
    expect(screen.getByTestId("sandbox-attr-heat").getAttribute("data-scope")).toBe(BASE_KEEP);
  });

  it("④ 选一个**这次回包里没有**的基地 ⇒ 诚实空态，不拿全网顶上", () => {
    // 纯函数直验：这一态在真桩里造不出来（桩里两列都有数），但它在生产里真实存在
    // （空态骨架只有 4 列，而下拉有 13 条）。
    const model: HeatMatrixModel = {
      nodes: [{ nodeId: NODE_A, label: "老化静置" }],
      bases: [{ baseId: BASE_KEEP, name: "常州" }],
      cells: new Map([[`${NODE_A}|${BASE_KEEP}`, { pct: 37, days: 4.1 }]]),
      reasons: new Map(),
      source: "endpoint",
    };
    const out = projectHeatByScope(model, BASE_DROP);
    // 列还在（版面不塌），名字取自册（不是编的），格子一个都没有。
    expect(out.bases).toEqual([{ baseId: BASE_DROP, name: "合肥" }]);
    expect(out.cells.size).toBe(0);
    expect(out.reasons.get(BASE_DROP)).toBe(SCOPE_NOT_IN_MATRIX);
    // **绝不**回落成「那就给你看全网」——那正是本单要消灭的「下拉说 A、屏上画 B」。
    expect(out.bases.some((b) => b.baseId === BASE_KEEP)).toBe(false);

    // 恒等臂：全网**原样返回同一个对象**（不复制、不重排）。
    expect(projectHeatByScope(model, NETWORK_SCOPE_KEY)).toBe(model);
    // 金丝雀：这个 baseId 在下拉选项里**确实存在**（否则上面验的是一个用户选不到的值）。
    expect(baseScopeOptions().map((s) => s.key)).toContain(BASE_DROP);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 死控件普查：扫整棵渲染树，凡「看起来能点」的都必须有交代
// ══════════════════════════════════════════════════════════════════════════

describe("WO-ATTR-DEAD-CONTROLS §3 · 全页普查（不许再长出第四个死控件）", () => {
  it("① 每个 <button> 要么真能点、要么 disabled + 说明；没有第三种", async () => {
    renderWithClient(<SandboxAttr />);
    await heatReady();
    const btns = [...canvas().querySelectorAll("button")];
    // 金丝雀：这一页**确实**有按钮（扫出 0 个不等于"页面很干净"，也可能是选择器坏了）。
    expect(btns.length, "整页零个 button ⇒ 扫描器坏了或页签退回成了 b/u/i").toBeGreaterThan(0);
    for (const b of btns) {
      if (b.disabled) {
        expect((b.getAttribute("title") ?? "").length, `disabled 的「${b.textContent}」没说为什么`).toBeGreaterThan(0);
      } else {
        // 今天这一页没有"可用的按钮"这一类；真出现了，它必须能被键盘够到。
        expect(b.getAttribute("aria-hidden"), `可用按钮「${b.textContent}」对读屏隐藏了`).not.toBe("true");
      }
    }
  });

  it("② 真能点的行都够得到（键盘 + 光标），且点了**真的换选中**", async () => {
    const user = userEvent.setup();
    renderWithClient(<SandboxAttr />);
    await heatReady();

    // 明细行是本页唯一"点了会变"的一类行（根因树二级行同理，走同一个 setState）。
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid^="sandbox-attr-detail-"]')];
    expect(rows.length, "明细一行都没有 ⇒ 这条在空转").toBeGreaterThan(1);
    for (const r of rows) {
      expect(r.getAttribute("role"), "能点的行没有 role=button ⇒ 读屏用户不知道它能点").toBe("button");
      expect(r.getAttribute("tabIndex") ?? r.tabIndex.toString(), "能点的行键盘够不到").toBe("0");
    }

    // 真点：选中态必须从第 0 行挪到第 1 行（不是"点了不报错"就算过）。
    const second = rows[1] as HTMLElement;
    expect(rows[0]?.className).toContain("on");
    await user.click(second);
    await waitFor(() => expect(second.className).toContain("on"));
  });

  /*
   * ⚠ WO-CONSOLE-BLOCKERS · **本条断言整条换过，换成更强的那一句**。
   *
   * 原来断言的是「假英文菜单 `File Edit View Window Tools Help` 挂了 `aria-hidden` + `title`」——
   * 也就是**承认它是假控件，然后要求它别骗读屏用户**。UX 第 7 轮把它判为阻塞项，理由不是无障碍：
   * 「给假菜单加无障碍标注，解决的是『读屏用户会不会被它骗』，**不解决**『拿给同行看像不像产品』」。
   * 形态照 CLAUDE.md 铁律 0.6：**「我用『标了 aria-hidden』当作『它不再是假控件』的证据。」**
   *
   * 那条菜单现已**从三个屏一起删掉**。所以这条用例现在咬的是更强的命题：
   * **屏上根本不该出现那六个英文词**。原命题（装饰件不冒充控件）由下面左轨/面板头那两段继续守。
   */
  it("③ 假英文菜单已不存在；其余纯装饰（左轨 / 面板头记号）对读屏隐藏，不冒充控件", async () => {
    renderWithClient(<SandboxAttr />);
    await heatReady();
    const text = canvas().textContent ?? "";
    // 金丝雀：同一个判据对一段**已知含有**那串菜单的文本必须命中 —— 否则下面的否定结论是白拿的。
    const FAKE_MENU = /\bFile\b[\s\S]{0,60}\bEdit\b[\s\S]{0,60}\bView\b/;
    expect(FAKE_MENU.test("File Edit View Window Tools Help"), "判据对已知样本都不命中 ⇒ 尺子坏了").toBe(true);
    expect(FAKE_MENU.test(text), "假英文菜单又回来了").toBe(false);
    expect(canvas().querySelector('[class*="mb"]'), "假菜单容器还在").toBeNull();

    // 左轨与面板头那些真装饰件仍须对读屏隐藏（原命题的其余部分，一个都不放）。
    // ⚠ 判据是「**在不在** aria-hidden 的子树里」，不是「自己身上有没有那个属性」：
    //   `aria-hidden` 是**整棵子树**生效的，容器上标一次即可（本页 `.crew` 就是这么标的）。
    //   拿"自己身上有没有"当判据会把一个**已经正确隐藏**的装饰件报成"在冒充可点"——
    //   形态照铁律 0.6：「我用『元素自身有该属性』当作『它对读屏可见』的证据。」
    const rail = canvas().querySelector('[class*="rail"]') as HTMLElement | null;
    expect(rail, "左轨找不到 ⇒ 探针坏了").not.toBeNull();
    const railItems = [...(rail as HTMLElement).querySelectorAll("span")];
    expect(railItems.length, "左轨一项都没有 ⇒ 这条在空转").toBeGreaterThan(0);
    for (const s of railItems) {
      expect(s.closest('[aria-hidden="true"]'), `左轨装饰件「${s.textContent?.trim()}」还在冒充可点`).not.toBeNull();
      expect(s.tagName, "左轨装饰件成了真控件").not.toBe("BUTTON");
    }
  });
});
