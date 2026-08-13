import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { loginAs, renderApp, renderWithClient } from "./utils";
import { checkedTree, factHits } from "./factlock";
import { CONSOLIDATED_INTO_SANDBOX } from "@/pages/ShellLayout";
import {
  buildChainLineMap,
  ChainLossPayloadSchema,
  ringArcPointAt,
  ringSegmentArc,
  ringStationAnchors,
  RING_LAYOUT,
  type ChainLossPayload,
} from "@/views/sim/chainLineMap";
import zh from "@/locales/zh";

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WO-SANDBOX-UI-INTEGRATE · **七条沙盘 UI 分支并线后的存活门**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ── 这道门为什么存在 ─────────────────────────────────────────────────────────
 * 七张工单**同时在改同一块屏**（`SandboxConsole` / `SandboxView`），两两冲突 9 对。
 * 并线时每解一处冲突都可能"取一侧了事"——而取一侧的屏上后果与"那条分支从没做过"
 * **一模一样**：功能不见了，测试却可能因为各自的门只测各自那半而全绿。
 *
 * 所以本门的判据不是「沙盘渲染出来了」（那是装饰品，七条全被吃掉它照样绿），
 * 而是**逐条分支各挑一个只有它能产生的标志物**，一条一条咬。
 * 每条断言旁写明：**挑的是什么、为什么它代表那条分支没被吃掉**、
 * 以及**若那条分支被吃掉这里会怎么红**（变异反证的落点）。
 *
 * ── 判据从真实路由出发 ───────────────────────────────────────────────────────
 * 一律 `renderApp("/v/sim-sandbox")` —— 经真路由表 → entitlement 守卫 → 懒加载 →
 * `ViewPage` 分发 → `SandboxView` → `SandboxConsole`。
 * 直接 render 组件测不出「守卫/分发/装配」这一段，而并线恰恰最容易在装配处丢东西
 * （本单实测：`perturbation` 一节差点随 declutter 侧被整节吃掉）。
 *
 * ── 第二组判据：信息分层（`docs/CONVENTION-ui-information-layering.md`）────────
 * 第一层只放**数值 / 状态 / 名字**；口径括号与整段说明必须降进 `?` 浮层。
 * 一律**两向咬**：向一「第一层不含」（真降下去了）· 向二「浮层里含」（没被删）。
 * 只咬一向证明不了分层 —— 只咬向一可能是被删了（违反诚实位红线），
 * 只咬向二可能第一层也还挂着（降层根本没发生）。
 *
 * R6 确定性：网络全桩（MSW + 本文件的 `server.use` 覆盖），无时钟、无随机。
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = (() => {
  let dir = TEST_DIR;
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error(`[sandbox-ui-integrate] 找不到仓根（自 ${TEST_DIR} 向上未见 pnpm-workspace.yaml）`);
})();
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** 真实引擎载荷（与 `chain-line-map.seam` 同一份，不另造一套数据）。 */
const REAL: ChainLossPayload = ChainLossPayloadSchema.parse(
  JSON.parse(readFileSync(join(TEST_DIR, "fixtures/chain-loss-real.json"), "utf8")),
);

/**
 * `chain_loss_attribution` 在 MSW 里**没有桩**（实测：`handlers.ts` 全文零命中）——
 * 这不是本单造成的，是既有的 mock 缺口，后果是线路图在路由态永远落 `clm-engine-error`。
 * 本门要咬横向版面，就必须让它真的画出来，故在此补一条**只在本文件生效**的桩。
 */
function serveChainLoss() {
  server.use(
    http.post("*/b/v1/solvers/chain_loss_attribution/run", () =>
      HttpResponse.json({ data: REAL, snapshotVersion: "ov-integrate" }),
    ),
  );
}

/** 进沙盘并等到控制台落地（懒加载 + 两个求解器，故给足超时）。 */
async function enterSandbox() {
  renderApp("/v/sim-sandbox");
  await waitFor(() => expect(screen.getByTestId("sandbox-view")).toBeTruthy(), { timeout: 20000 });
  await waitFor(() => expect(screen.getByTestId("sandbox-console")).toBeTruthy(), { timeout: 20000 });
}

beforeEach(() => {
  loginAs("planner");
  serveChainLoss();
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 七条分支各自的存活标志物（一条一个，说明为什么它代表那条）
// ══════════════════════════════════════════════════════════════════════════════

describe("§1 · 七条分支的产物逐条还活着", () => {
  /**
   * ① WO-SANDBOX-DECLUTTER —— 标志物：**诊断抽屉的两向性**。
   *
   * 挑它的理由：declutter 的产物不是"多了个按钮"，是**把就绪认证/世界列表/本体派生
   * 从常驻右栏挪进默认折叠的抽屉**。所以能代表它的只有**两向**：
   *   向一 抽屉入口在，且 `sandbox-readiness` **根本不在 DOM 里**（是不渲染，不是 hidden）；
   *   向二 点开之后 `sandbox-readiness` 回来（收纳 ≠ 删除）。
   * 被吃掉时怎么红：并线时若取 canonical 的单数组 `rail` 一侧，就绪认证会常驻右栏 ⇒
   * 向一当场红（能查到 `sandbox-readiness`）。若取成"删掉了"，向二红。
   */
  it("① declutter：诊断抽屉两向 —— 默认不渲染就绪认证，点开后回来", async () => {
    const user = userEvent.setup();
    await enterSandbox();

    const toggle = screen.getByTestId("sc-diag-toggle");
    expect(toggle, "诊断抽屉入口不在 ⇒ declutter 整条被吃掉了").toBeTruthy();
    // 入口自带真计数（不是装饰徽标）
    expect(screen.getByTestId("sc-diag-count").textContent ?? "").toMatch(/\d/);

    // 向一：第一层**不渲染**（queryBy 为 null，而不是 not.toBeVisible）
    expect(
      screen.queryByTestId("sandbox-readiness"),
      "就绪认证仍常驻第一层 ⇒ 诊断抽屉没生效（并线时取错了 rail 那一侧）",
    ).toBeNull();
    expect(screen.queryByTestId("sandbox-worlds")).toBeNull();

    // 向二：点开就回来
    await user.click(toggle);
    expect(
      await screen.findByTestId("sandbox-readiness"),
      "抽屉点开后就绪认证仍不出现 ⇒ 这不是收纳，是删除（违反诚实位红线）",
    ).toBeTruthy();
  }, 60000);

  /**
   * ② WO-SANDBOX-IA-CONSOLIDATE —— 标志物：**五模式切换条 + 跨模式范围条**。
   *
   * 挑它的理由：ia-consolidate 的产物是「一屏五模式」这个骨架本身。
   * canonical 上**没有任何模式切换**（`sandbox-mode-*` 一个都不存在），
   * 所以这五个键的存在只可能来自这条分支。范围条 `sandbox-scope-strip` 一并咬，
   * 因为"不带上下文的合并 = 把五页塞进一个 tab 条"——它是这条分支自己立的判据。
   * 被吃掉时怎么红：取 declutter 一侧的 `SandboxView` 就没有模式条 ⇒ 五个 getBy 全红。
   */
  it("② ia-consolidate：五个模式 + 跨模式范围条 + 九条收编链接", async () => {
    await enterSandbox();
    expect(screen.getByTestId("sandbox-mode-switch")).toBeTruthy();
    for (const m of ["now", "attribute", "tryone", "optimize", "radius"]) {
      expect(screen.getByTestId(`sandbox-mode-${m}`), `模式「${m}」不在 ⇒ ia-consolidate 的模式骨架被吃掉`).toBeTruthy();
    }
    expect(screen.getByTestId("sandbox-scope-strip"), "跨模式范围条不在 ⇒ 只并了 tab 条没并上下文").toBeTruthy();
    expect(screen.getByTestId("sandbox-mode-question"), "「当前模式回答哪一问」不在").toBeTruthy();
    // 收编登记表里的每一条，屏上都要有一条到得了的链接（收编 ≠ 删除）
    for (const key of Object.keys(CONSOLIDATED_INTO_SANDBOX)) {
      expect(
        screen.getByTestId(`sandbox-consolidated-${key}`),
        `收编表登记了 ${key}，但沙盘里没有到达它的链接 ⇒ 收编变成了黑洞`,
      ).toBeTruthy();
    }
  }, 60000);

  /**
   * ③ WO-CHAIN-MAP-LAYOUT —— 标志物：**站位落在「行 × 列」而不是椭圆上**。
   *
   * 挑它的理由：这条分支把全链线路图**从环形改成横向折行地铁图**。
   * 光咬 `data-row` 这个属性存在是弱判据（改个名就骗过去了），所以这里咬的是
   * **只有横向折行才成立的结构不变量**：
   *   a. 同一行的所有站共用同一条基线（行内 y 只有一个取值）；
   *   b. 全图 y 的取值个数 **恰好等于行数**（环形版 35 个站会有 ~35 个不同的 y）；
   *   c. **没有任何一个站落在旧椭圆上**（环形版的不变量恰恰是"每个站都在椭圆上"）。
   * 三条一起，环形版一条都过不了。
   * 被吃掉时怎么红：并线若取回环形版 `ChainLineMapView`，b 与 c 立刻红。
   */
  it("③ chain-map-layout：横向折行的三条结构不变量（环形版一条都不满足）", async () => {
    await enterSandbox();
    // 先等线路图真画出来（桩已就位；未画出来就断言等于在断言空集合 —— 恒真的废门）
    await waitFor(
      () => expect(document.querySelectorAll('[data-testid^="clm-station-"]').length).toBeGreaterThan(3),
      { timeout: 20000 },
    );
    const map = buildChainLineMap(REAL);
    const trunk = [...map.stations, ...map.suspended].filter((s) => s.lineId === "trunk");
    const plan = map.lines.find((l) => l.lineId === "trunk")!.plan;

    // 前提先立住：站位数要足够多，否则「取值个数」判据分辨不出圆和横线
    expect(trunk.length, "主线站位太少 ⇒ 下面的判据分辨不出圆和横线（前提不成立，不是行为不对）")
      .toBeGreaterThan(3 * plan.rowCount);

    // a. 行内共线
    for (const row of new Set(trunk.map((s) => s.row))) {
      const ys = new Set(trunk.filter((s) => s.row === row).map((s) => s.y));
      expect(ys.size, `第 ${row} 行的站不共用一条基线 ⇒ 这一行不是水平的`).toBe(1);
    }
    // b. y 的取值个数 == 行数
    expect(
      new Set(trunk.map((s) => s.y)).size,
      "y 的取值个数不等于行数 ⇒ 这不是横向折行布局（环形版会有几十个不同的 y）",
    ).toBe(plan.rowCount);
    // c. 一个站都不在旧椭圆上
    const onEllipse = trunk.filter((s) => {
      const dx = (s.x - RING_LAYOUT.cx) / RING_LAYOUT.rx;
      const dy = (s.y - RING_LAYOUT.cy) / RING_LAYOUT.ry;
      return Math.abs(Math.hypot(dx, dy) - 1) < 1e-6;
    });
    expect(onEllipse.map((s) => s.label), "还有站落在旧椭圆上 ⇒ 版面没真的换成横向").toEqual([]);

    // 屏上那一份也要带行列坐标（派生层横了、渲染层没跟 = 白改）
    const dom = document.querySelector('[data-testid^="clm-station-"]')!;
    expect(dom.getAttribute("data-row"), "站元素没有行坐标 ⇒ 渲染层没跟上横向版面").not.toBeNull();
  }, 60000);

  /**
   * ④ handoff-sandbox-metro-prd —— 标志物：**那份 PRD 文件本身**。
   *
   * 挑它的理由：这条分支只有一个文件（`docs/PRD-sandbox-metro-ops.md`，616 行），
   * 没有任何代码产物 —— 文件在不在**就是**它活没活着。
   * 不只咬文件名（改名就骗过去），一并咬它的标题与两个只属于它的小节标题。
   * 被吃掉时怎么红：并线漏了这条 ⇒ readFileSync 抛错。
   */
  it("④ metro-prd：docs/PRD-sandbox-metro-ops.md 在，且内容是它自己", () => {
    const md = readRepo("docs/PRD-sandbox-metro-ops.md");
    expect(md.length, "PRD 是空的").toBeGreaterThan(2000);
    expect(md, "标题不对 ⇒ 文件在但不是这条分支的产物").toContain("推演沙盘");
    // 每份 PRD 都必须含《本体引用与影响》（铁律 0），拿它当第二个锚点
    expect(md, "缺《本体引用与影响》节 ⇒ 不符合本仓 PRD 规格").toMatch(/本体引用与影响/);
  });

  /**
   * ⑤ WO-CAPACITY-CARD-LAYOUT —— 标志物：**6 层卡片链 + 诚实位降层后的可见记号**。
   *
   * 挑它的理由：这条分支把产能推演的「可用产能派生诊断」从**六个并列长条**改成
   * **自下而上的卡片链**，并把那段口径/溯源说明从常驻正文降进 `?` 浮层、
   * 在第一层留 `cap-dag-honesty-mark` 当记号。记号 + 浮层两件一起，才是它的产物。
   *
   * ⚠ 为什么这一条不走 `/v/sim-sandbox`：它根本不在沙盘这一页（在产能推演页，
   *   `RiskBoardView.tsx:860` 内嵌）。硬塞进沙盘路由只会得到一条恒真的假断言。
   *   故此处直接渲染该组件本体 —— 诚实边界写在这里，不假装它也是沙盘的一部分。
   */
  it("⑤ capacity-card：6 层卡片链 + 诚实位降层留可见记号（两向）", async () => {
    const user = userEvent.setup();
    // 文案单一来源先立住（R14：口径原文在 locales，不内联）
    expect(zh.capDag.honesty, "capDag 文案块不在 ⇒ 这条分支的 zh.ts 产物被吃掉").toBeTruthy();
    expect(zh.capDag.honestyMark).toBeTruthy();

    const { CapacityDerivationDag } = await import("@/views/capacity/CapacityDerivationDag");
    renderWithClient(<CapacityDerivationDag baseId="changzhou" />);

    const nodes = await screen.findByTestId("cap-dag-nodes", undefined, { timeout: 20000 });
    // 六层缺一不可（少一层 = 派生链断了一节，卡片化就没意义）
    for (let i = 1; i <= 6; i++) {
      expect(
        within(nodes).getByTestId(`cap-dag-step-${i}`),
        `第 ${i} 层卡片不在 ⇒ 6 层卡片链不完整`,
      ).toBeTruthy();
    }
    // 向一：诚实位正文**不在**第一层，只留记号
    expect(screen.getByTestId("cap-dag-honesty-mark"), "诚实位记号不在 ⇒ 静默降层 = 删除（规范 §1 红线）").toBeTruthy();
    // 前提先立住：这句原文里确实含「本体 §3」，否则下面两条断言都在测一个不存在的子串（恒真的废门）
    expect(zh.capDag.honesty, "诚实位原文里没有『本体 §3』⇒ 下面的判据咬不到东西（前提不成立）").toContain("本体 §3");
    expect(screen.getByTestId("cap-dag-changzhou").textContent ?? "", "诚实位正文仍占第一层 ⇒ 降层没发生")
      .not.toContain("本体 §3");
    // 向二：`?` 一开，原文回来（InfoPopover 的正文锚点是 `info-body-{testId}`）
    await user.hover(screen.getByTestId("info-cap-dag-honesty"));
    const body = await screen.findByTestId("info-body-cap-dag-honesty", undefined, { timeout: 10000 });
    expect(body.textContent ?? "", "浮层里也没有诚实位原文 ⇒ 这是删除不是降层").toContain("本体 §3");
  }, 60000);

  /**
   * ⑥ WO-TRANSIT-GEOMETRY —— 标志物：**环几何仍是"对外单源"且在途图层仍在用它**。
   *
   * 挑它的理由：这条分支的产物**不是**画面上的某个像素，而是
   * 「在途图层不许自己再算一遍站点位置，坐标只能有一处实现」这条约束。
   * 它最容易在并线时被误伤 —— 因为 chain-map-layout 把线路图改成了横向，
   * 很容易顺手把环几何当死代码删掉，而在途图层**仍然靠它**。
   * 故咬三件：
   *   a. 三个环几何出口仍可调用且算得出真数（不是留了个空壳）；
   *   b. `TransitFlowLayer` 源码里仍**从 `chainLineMap` import** 这些函数
   *      （= 没有各写一套，单源没破）；
   *   c. 沙盘里在途图层的入口仍在。
   * 被吃掉时怎么红：删掉环几何 ⇒ a 抛错；在途图层改回自绘直线 ⇒ b 红。
   */
  it("⑥ transit-geometry：环几何单源仍在，且在途图层仍从 chainLineMap 取坐标", async () => {
    // a. 纯函数真算得出（弧上取中点，必须落在椭圆上）
    const anchors = ringStationAnchors(["a", "b", "c", "d"], 1);
    expect(anchors.length).toBe(4);
    const arc = ringSegmentArc(anchors[0]!, anchors[1]!, "seg-a-b");
    const mid = ringArcPointAt(arc.a0, arc.a1, 1, 0.5);
    const dx = (mid.x - RING_LAYOUT.cx) / RING_LAYOUT.rx;
    const dy = (mid.y - RING_LAYOUT.cy) / RING_LAYOUT.ry;
    expect(Math.hypot(dx, dy), "弧上取的点不在环上 ⇒ 环几何被改坏或被掏空").toBeCloseTo(1, 6);

    // b. 单源没破：在途图层仍从 chainLineMap 拿这些坐标函数（不是自己再算一遍）
    // import 边住在哪个文件不是事实（WO-C 修法）：全树抽取 `./chainLineMap` 的 import 子句再判，
    // `[^}]*` 不跨子句 —— 别的 import 里同名符号不算数。
    const fe = checkedTree("apps/frontend-shell/src", 'from "@platform/contracts"', 100);
    const clauses = fe
      .flatMap(([, s]) => [...s.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/chainLineMap"/g)].map((m) => m[1] ?? ""))
      .join(",");
    for (const fn of ["ringStationAnchors", "ringSegmentArc", "ringArcPointAt", "RING_LAYOUT"]) {
      expect(
        clauses,
        `TransitFlowLayer 不再从 chainLineMap import ${fn} ⇒ 几何单源被打破（它又自己算了一套坐标）`,
      ).toContain(fn);
    }

    // c. 沙盘里那个图层入口还在
    await enterSandbox();
    expect(screen.getByTestId("sc-transit-toggle"), "在途批次图层入口不在 ⇒ 这条分支在屏上没了落点").toBeTruthy();
  }, 60000);

  /**
   * ⑦ WO-IMPEDIMENTS-REACHABLE —— 标志物：**阻滞点在沙盘里真出数，且登记为已收编**。
   *
   * 挑它的理由：这条分支的目标只有一个 ——「让 `chain-impediments` 有一条真的渲染得到的路」
   * （它并线前是"实现有、测试绿、页面永远打不开"）。并线时它与 ia-consolidate **方向对立**
   * （前者要加进导航、后者要移出导航收进沙盘），裁决取了后者。
   * 所以这里咬的**不是它原本的实现方式（导航条目）**，而是**它的目标**：
   *   a. 阻滞点统计条在沙盘第一层，且是**真数**（三档计数都渲染出来）；
   *   b. 它在收编登记表里（= 有表、有理由、有门对账，不是"忘了登记"）。
   * 被吃掉时怎么红：若并线把收编整个丢了、又没加回导航，b 红；
   * 若沙盘里阻滞点条没了，a 红 —— 两者任一都意味着这条分支的目标没兑现。
   */
  it("⑦ impediments-reachable：阻滞点在沙盘出真数 + 已登记收编（目标兑现，非原机制）", async () => {
    await enterSandbox();
    const bar = await screen.findByTestId("sc-impbar", undefined, { timeout: 20000 });
    expect(bar, "阻滞点统计条不在沙盘第一层 ⇒ 可达性目标没兑现").toBeTruthy();
    for (const kind of ["BOTTLENECK", "CONGESTION", "BREAK"]) {
      expect(
        screen.getByTestId(`sc-imp-${kind}-count`).textContent ?? "",
        `${kind} 档没有计数 ⇒ 条在但没出数`,
      ).toMatch(/\d/);
    }
    expect(
      CONSOLIDATED_INTO_SANDBOX["chain-impediments"],
      "chain-impediments 不在收编登记表里 ⇒ 它既不在导航、也没被登记 = 又变回黑洞",
    ).toBeTruthy();
    expect(CONSOLIDATED_INTO_SANDBOX["chain-impediments"]!.where.length, "收编条目没写用户点哪里能到")
      .toBeGreaterThan(6);
  }, 60000);
});

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 信息分层：第一层不许留口径括号与整段说明（两向）
// ══════════════════════════════════════════════════════════════════════════════

describe("§2 · 第一层只放数值/状态/名字 —— 口径与整段说明必须在浮层（两向）", () => {
  /**
   * 仓主原话：沙盘第一层「密密麻麻大量信息，很多是功能或信息描述型」。
   * 规范 §2 R-UI-3 把这类文字一律判进浮层。这里逐条咬**第一层不含**，
   * 并在同一条里咬**浮层含**——只咬前者会把"删掉"也判成通过。
   */
  it("① 量纲口径 `0–100 指数` 不在第一层，但 `?` 里在", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const kpis = screen.getByTestId("sandbox-kpis");
    // 向一：第一层只剩名字 + 数值 + tick
    expect(kpis.textContent ?? "", "量纲口径仍占第一层（规范 §2 R-UI-3）").not.toContain("0–100 指数");
    expect(kpis.textContent ?? "").not.toContain("全对象均值");
    // 但数值本身必须还在（口径降层不等于把结论也一起藏了 —— 数字属于第一层）
    expect(screen.getByTestId("sandbox-kpi-global-val").textContent ?? "").toMatch(/\d/);
    // 向二：记号一开，原文回来
    await user.hover(screen.getByTestId("info-kpi-unit"));
    const note = await screen.findByTestId("sandbox-kpi-unit-note", undefined, { timeout: 10000 });
    expect(note.textContent ?? "", "浮层里没有量纲 ⇒ 这是删除不是降层").toContain("0–100 指数");
  }, 60000);

  /**
   * 「口径差（按引擎显示…）」「联动口径（真实的接缝缺口…）」这两段是
   * 派单点名的**整段开发者说明**。它们是诚实位（说明接缝真缺口），
   * 所以只许降层、不许删 —— 两向都咬。
   */
  it("② 两段整段说明（口径差 / 联动口径）不在第一层，但各自 `?` 里在", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const console_ = screen.getByTestId("sandbox-console");
    await waitFor(() => expect(screen.getByTestId("sc-impbar")).toBeTruthy(), { timeout: 20000 });

    // 向一：整段正文不在第一层（浮层关着时**不渲染**，不是 hidden）
    expect(screen.queryByTestId("sc-imp-gap"), "「口径差」正文常驻第一层 ⇒ 没降层").toBeNull();
    expect(screen.queryByTestId("sc-imp-join-gap"), "「联动口径」正文常驻第一层 ⇒ 没降层").toBeNull();
    // 记号必须留着（静默降层 = 删除）
    expect(within(console_).getByTestId("info-imp-gap"), "第一层没留「口径差」的记号").toBeTruthy();
    expect(within(console_).getByTestId("info-imp-join-gap"), "第一层没留「联动口径」的记号").toBeTruthy();

    // 向二：分别点开，原文回来
    await user.hover(screen.getByTestId("info-imp-gap"));
    expect(
      (await screen.findByTestId("sc-imp-gap", undefined, { timeout: 10000 })).textContent ?? "",
      "「口径差」浮层是空的 ⇒ 删除而非降层",
    ).not.toBe("");
    await user.unhover(screen.getByTestId("info-imp-gap"));
    await user.hover(screen.getByTestId("info-imp-join-gap"));
    expect(
      (await screen.findByTestId("sc-imp-join-gap", undefined, { timeout: 10000 })).textContent ?? "",
      "「联动口径」浮层是空的 ⇒ 删除而非降层",
    ).not.toBe("");
  }, 60000);

  /**
   * 规范 §2 明令：**禁止用原生 `title` 属性 / SVG `<title>` 当浮层**
   * （2026-08-10 实测事故：环形图上两个 `<title>` 滞留并遮挡图形本身）。
   *
   * ── 这条为什么是「本单产物零违规 + 全屏棘轮」两段，而不是一句 `toEqual([])` ──────
   * 实测：并线后沙盘这一屏共 **84** 个元素带原生 `title`。逐文件对账 canonical 之后
   * 定性清楚了（数字必须能指向责任人，否则就是拿一个笼统的数盖住两个不同事实）：
   *   · `SandboxConsole.tsx` 10 → 10（canonical 就有，本次并线一个没加）；
   *   · `ChainImpedimentView.tsx` 1 → 1（同上）；
   *   · `SandboxView.tsx` **0 → 3**（`WO-SANDBOX-IA-CONSOLIDATE` 新引入：模式条
   *     `title={SANDBOX_MODE_QUESTION}`、范围条那两段口径、收编链接 `title={p.where}`）——
   *     **这三个是本单的责任，已当场改掉**（前两个改 `aria-label`，中间那段整段口径
   *     改用受控的 `InfoPopover`），现回到 0。
   * 余下 81 条是 canonical 既有欠账（`G-UI-FIRSTLAYER-OVERLOAD` 同族），且相当一部分落在
   * `WO-SANDBOX-CANDIDATES-FE` 正在动的阻滞点候选文件里 —— 本单范围边界明令不许碰，
   * 硬改会与那张单撞车。
   *
   * 所以判据分两段，两段都必须有牙：
   *   ① **本单七条分支产出的那块壳，零违规**（精确、稳定、与数据无关）；
   *   ② **全屏棘轮**：总数只降不升。今天写死 84，谁再加一个原生 title 就红，
   *      而清理欠账把它降下去时**必须同步改小这个数**（改大要在 diff 里现形，藏不住）。
   */
  const NATIVE_TITLE_CEILING = 84;

  it("③-1 本单七条分支产出的壳：零原生 title（ia-consolidate 引入的 3 处已改掉）", async () => {
    await enterSandbox();
    await waitFor(() => expect(screen.getByTestId("sc-impbar")).toBeTruthy(), { timeout: 20000 });
    // 这四块正是七条分支在这一屏上新造的东西（模式条 / 范围条 / 收编链接 / KPI 顶栏）
    for (const testId of ["sandbox-mode-switch", "sandbox-scope-strip", "sandbox-consolidated-links", "sandbox-kpis"]) {
      const region = screen.getByTestId(testId);
      const offenders = [region, ...Array.from(region.querySelectorAll("*"))]
        .filter((e) => e.hasAttribute("title"))
        .map((e) => `${e.tagName}[title=${(e.getAttribute("title") ?? "").slice(0, 40)}…]`);
      expect(
        offenders,
        `${testId} 里有元素用原生 title 当浮层 —— 它由操作系统绘制、永远画在最上层、` +
          `移开后滞留（规范 §2 R-UI-3 明令禁止；本仓 2026-08-10 真出过遮挡事故）。改用 InfoPopover 或 aria-label。`,
      ).toEqual([]);
    }
  }, 60000);

  it("③-2 全屏棘轮：原生 title 总数只降不升，且 SVG <title> 恒为 0", async () => {
    await enterSandbox();
    await waitFor(() => expect(screen.getByTestId("sc-impbar")).toBeTruthy(), { timeout: 20000 });
    const root = screen.getByTestId("sandbox-view");
    const n = root.querySelectorAll("[title]").length;
    // 先自证判据咬得住：屏上确实存在这类元素，否则这条断言是在对空集恒真
    expect(n, "屏上一个带 title 的元素都没有 ⇒ 要么欠账真清完了（那就把上限调到 0），要么这条断言没咬到东西")
      .toBeGreaterThan(0);
    expect(
      n,
      `原生 title 从 ${NATIVE_TITLE_CEILING} 涨到 ${n} —— 有人又新增了原生 tooltip（规范 §2 明令禁止）。` +
        `要么改用 InfoPopover，要么在 diff 里把 NATIVE_TITLE_CEILING 调大并说明理由（藏不住）。`,
    ).toBeLessThanOrEqual(NATIVE_TITLE_CEILING);
    // SVG <title> 是那次真事故的直接成因，它必须恒为 0（不给棘轮，只给零）
    expect(
      root.querySelectorAll("svg title").length,
      "SVG <title> 又回来了 —— 正是 2026-08-10 环形图滞留遮挡的成因",
    ).toBe(0);
  }, 60000);
});
