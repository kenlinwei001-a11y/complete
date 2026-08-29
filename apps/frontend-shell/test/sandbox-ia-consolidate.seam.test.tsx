import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SandboxViewConfig } from "@platform/contracts";

/**
 * WO-SANDBOX-IA-CONSOLIDATE · 推演类入口收编进沙盘 —— SEAM 门。
 *
 * ## 本文件咬的四件事（缺一即退）
 *
 * **① 件一取证：五个子视图在沙盘内真到得了。**
 *    删导航入口之前必须先证明「删了功能不消失」。逐条断言沙盘内的到达路径
 *    （不是断言组件存在，是断言**从沙盘主屏出发点得到**）。
 *    这一条是**删除的前置条件**：它红了就不许删导航（删了 = 让功能消失）。
 *
 * **② 件二：导航里没有 ⊕ 路由仍可达（两向都测）。**
 *    「不在导航单列」与「深链接打不开」是两件事。只测前者 = 把回归当成功。
 *    反向那半（路由仍可达）走 `ViewPage` 的真分发路径：`workspace.views` 仍下发 ⇒ 渲染器仍拿得到。
 *
 * **③ 件三：模式切换一次只呈现一屏。**
 *    判据是**不在 DOM**，不是 `hidden`。`hidden` 只让人看不见，DOM 里还在、请求照发、
 *    屏幕阅读器照读 —— 那不叫「换一屏」，那叫「叠一屏再盖住」。
 *    咬法：切到模式 B 后，用 `queryByTestId`（不是 `not.toBeVisible()`）断言 A 的特征元素为 null。
 *
 * **④ 件三：上下文跨模式保持。**
 *    不带上下文的合并 = 把五个页面塞进一个 tab 条。咬法：模式 A 里改基地勾选 → 切 B → 再切回 A，
 *    勾选仍在；且 B 屏上那条「当前范围」读数与 A 里选的一致（证明它**真的传过去了**，
 *    不是各自记各自的）。
 *
 * R6 确定性：无时钟、无随机；网络全桩。
 */

// ── 网络桩（与 sandbox-console.seam 同款：两个求解器可分别编排）───────────────────
const net = vi.hoisted(() => ({
  loss: null as unknown,
  imp: null as unknown,
  calls: [] as { key: string; args: Record<string, unknown> }[],
}));

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    runSolver: vi.fn(async (key: string, args: Record<string, unknown>) => {
      net.calls.push({ key, args });
      if (key === "chain_loss_attribution") return { data: net.loss, snapshotVersion: "sv-test" };
      if (key === "chain_impediments") return { data: net.imp, snapshotVersion: "sv-test" };
      // 其余求解器（净室归因 / 假设推演 / 优化 / 断供半径各自的键）在本门里不编排：
      // 本门咬的是**壳**（哪一屏在 DOM 里、上下文有没有带过去），不是各模式内部的算法。
      // 抛错让各模式走自己的错误态 —— 那正是「内容原样搬进来」应有的表现。
      throw new Error(`[ia-consolidate] 未编排的求解器：${key}`);
    }),
    createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
      id: "sims_ia", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
      curTick: 0, parentCheckpointId: null, createdAt: "2026-06-25T00:00:00.000Z",
    })),
    fetchSimCertification: vi.fn(async () => null),
    fetchSimSessions: vi.fn(async () => ({ items: [] })),
    searchObjects: vi.fn(async () => ({ items: [], total: 0 })),
    listObjectTypes: vi.fn(async () => ({ items: [] })),
  };
});

import SandboxView from "@/views/sim/SandboxView";
import { SANDBOX_MODES, SANDBOX_MODE_LABEL, type SandboxMode } from "@/views/sim/sandboxModes";
import { ChainLossPayloadSchema, type ChainLossPayload } from "@/views/sim/chainLineMap";
import { ChainImpedimentPayloadSchema, type ChainImpedimentPayload } from "@/views/sim/chainImpediment";
import { NAV_GROUPS, CONSOLIDATED_INTO_SANDBOX } from "@/pages/ShellLayout";
import { getRenderer } from "@/views/registry";
import { routes } from "@/App";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { db } from "@/mocks/db";

// ── 仓根 / fixture ────────────────────────────────────────────────────────────
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
  throw new Error(`[ia-consolidate] 找不到仓根（自 ${TEST_DIR} 向上未见 pnpm-workspace.yaml）`);
})();
const FIX = join(REPO_ROOT, "apps/frontend-shell/test/fixtures");

function loadLoss(): ChainLossPayload {
  return ChainLossPayloadSchema.parse(JSON.parse(readFileSync(join(FIX, "chain-loss-real.json"), "utf8")) as unknown);
}
function loadImp(): ChainImpedimentPayload {
  const raw = JSON.parse(readFileSync(join(FIX, "chain-impediment-baseline.json"), "utf8")) as Record<string, unknown>;
  delete raw.__fixture_provenance;
  return ChainImpedimentPayloadSchema.parse(raw);
}

const CFG: SandboxViewConfig = {
  tenantId: "tenant-ia",
  nodeTypes: ["Supplier", "Factory", "Order"],
  linkTypes: ["supplies", "produces"],
  stateVars: ["risk", "load"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 2,
};

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

/** 等「现状」模式的控制台把两个求解器的载荷都上屏。 */
async function ready() {
  await screen.findByTestId("sandbox-console");
  await waitFor(() => expect(screen.getByTestId("sc-imp-BREAK-count").textContent).not.toBe("—"));
}

beforeEach(() => {
  net.loss = loadLoss();
  net.imp = loadImp();
  net.calls.length = 0;
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════════
// § 件一 · 取证：五个子视图在沙盘内**真到得了**（删导航入口的前置条件）
// ══════════════════════════════════════════════════════════════════════════════
describe("§件一 · 五个子视图在沙盘内的到达路径（删入口的前置条件）", () => {
  it("① chain-line-map（全链线路图）= 中栏**默认**画布模式，进沙盘即在屏上", async () => {
    mount();
    await ready();
    // 默认模式就是它：不需要点任何东西
    expect(screen.getByTestId("sandbox-console").getAttribute("data-mode")).toBe("metro");
    expect(screen.getByTestId("sc-slot-metro").hasAttribute("hidden")).toBe(false);
    // 线路图组件本体真渲染（不是空槽）
    expect(await screen.findByTestId("clm-stage")).toBeInTheDocument();
  });

  it("② physical-topology（物理拓扑）= 中栏画布页签「物理拓扑」，一次点击到达", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-mode-topo"));
    expect(screen.getByTestId("sandbox-console").getAttribute("data-mode")).toBe("topo");
    expect(screen.getByTestId("sc-slot-topo").hasAttribute("hidden")).toBe(false);
    expect(await within(screen.getByTestId("sc-slot-topo")).findByTestId("phys-topo")).toBeInTheDocument();
  });

  it("③ node-inspector（节点检视）= 右栏常驻面板 →「变量输入」页签，一次点击到达", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    // 右栏是**常驻**的（不需要先点别的）
    expect(screen.getByTestId("sc-inspect-pane")).toBeInTheDocument();
    await user.click(screen.getByTestId("sc-tab-vars"));
    expect(await screen.findByTestId("insp-panel")).toBeInTheDocument();
  });

  it("④ transit-flow（在途与在制）= 线路图上的「在途批次图层」勾选框，一次勾选到达", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const toggle = within(screen.getByTestId("sc-transit-toggle")).getByRole("checkbox");
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(await screen.findByTestId("sc-transit-layer")).toBeInTheDocument();
  });

  it("⑤ chain-impediments（全链阻滞点）= 主屏统计条 + 逐条清单，进沙盘即在屏上", async () => {
    mount();
    await ready();
    // 统计条四卡出真数（不是「—」）
    expect(screen.getByTestId("sc-impbar")).toBeInTheDocument();
    expect(screen.getByTestId("sc-imp-BREAK-count").textContent).not.toBe("—");
    // 逐条清单（点一条进决策推演）
    expect(await screen.findByTestId("sc-imp-jump")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// § 件二 · 导航里没有 ⊕ 路由仍可达（两向）
// ══════════════════════════════════════════════════════════════════════════════
describe("§件二 · 收编后的九个键：导航不单列，但路由仍可达", () => {
  const navViewKeys = new Set(
    NAV_GROUPS.flatMap((g) => g.items.filter((it) => it.kind === "view").map((it) => it.key)),
  );
  const navRouteKeys = new Set(
    NAV_GROUPS.flatMap((g) => g.items.filter((it) => it.kind === "route").map((it) => it.key)),
  );
  const consolidated = Object.keys(CONSOLIDATED_INTO_SANDBOX);

  it("金丝雀：收编表非空，且 NAV_GROUPS 解析出来的两个键集都非空（表读空 = 下面的断言恒真）", () => {
    expect(consolidated.length, "收编表为空 ⇒ 本组断言全部恒真（哑门）").toBeGreaterThan(0);
    expect(navViewKeys.size).toBeGreaterThan(5);
    expect(navRouteKeys.size).toBeGreaterThan(0);
    // 已知必中：这几个是**保留**的独立场景，必须还在导航里 —— 它们若也不在，说明我删多了。
    for (const keep of ["project-sim", "global-sim", "risk", "order-chain"]) {
      expect(navViewKeys.has(keep), `${keep} 是独立场景不是沙盘子视图，不该被删`).toBe(true);
    }
    expect(navRouteKeys.has("sim-sandbox"), "沙盘自己必须留在导航里").toBe(true);
  });

  /**
   * ⚠ WO-SANDBOX-NAV-CONSOLIDATE 改判据：`kind:"view"` 条目现在有**两种**合法状态，
   * 与 `kind:"route"` 的既有规则（见下一条）完全同构：
   *   · **无条目** —— 该页随控制台的 entitlement 一起消失（五个沙盘子视图 requires:["sim.sandbox"]，
   *     沙盘关 ⇒ 连 workspace.views 都没有它，没有可回退的东西）；
   *   · **有条目 + `consolidatedWhen`** —— 该页**不受**那个 entitlement 门控（沙盘关着照样能打开），
   *     故必须留一条回退入口，否则沙盘关的租户「沙盘没有 + 导航也没有」= 页面从 IA 里蒸发。
   * 唯一非法的是第三态：**有条目却不带 `consolidatedWhen`** —— 那是真·重复入口，
   * 且会让整组的收编承诺被掏空（`check-nav-group-coverage.mjs` 判据⑧a/⑨ 机械守同一件事）。
   */
  it("正向：收编键在 NAV_GROUPS 的 kind:\"view\" 里要么没有条目，要么带 consolidatedWhen（不许两头占）", () => {
    const viewItems = NAV_GROUPS.flatMap((g) => g.items).filter(
      (it): it is Extract<(typeof NAV_GROUPS)[number]["items"][number], { kind: "view" }> => it.kind === "view",
    );
    const strays = consolidated
      .map((k) => viewItems.find((it) => it.key === k))
      .filter((it): it is NonNullable<typeof it> => it !== undefined && it.consolidatedWhen === undefined)
      .map((it) => it.key);
    expect(
      strays,
      `这些键已收编进沙盘，却仍是导航里**不带 consolidatedWhen** 的平级视图条目 —— 永不消失的重复入口：[${strays.join(", ")}]`,
    ).toEqual([]);
    // 金丝雀：两种合法状态**都真的存在**（否则上面的过滤在单一形态上跑，另一种形态坏了也看不出来）
    const withFallback = consolidated.filter((k) => viewItems.some((it) => it.key === k && it.consolidatedWhen !== undefined));
    const withoutEntry = consolidated.filter((k) => !viewItems.some((it) => it.key === k));
    expect(withFallback.length, "一个带 consolidatedWhen 的 view 收编项都没有 ⇒ 那一支形态没被覆盖").toBeGreaterThan(0);
    expect(withoutEntry.length, "一个无条目的 view 收编项都没有 ⇒ 那一支形态没被覆盖").toBeGreaterThan(0);
  });

  it("正向：四个 static-route 收编页在 NAV_GROUPS 里**留着回退条目**，且带 consolidatedWhen（沙盘开则隐藏）", () => {
    // 留条目 ≠ 单列：`consolidatedWhen` 决定它在沙盘开着时不渲染。删条目才是错的 ——
    // 那会让 sim.sandbox 关着的租户「沙盘没有 + 导航也没有」，四个页从 IA 里蒸发。
    const routeConsolidated = consolidated.filter((k) => CONSOLIDATED_INTO_SANDBOX[k]!.via === "static-route");
    expect(routeConsolidated.length, "static-route 收编项为空 ⇒ 本条恒真").toBeGreaterThan(0);
    const items = NAV_GROUPS.flatMap((g) => g.items).filter(
      (it): it is Extract<(typeof NAV_GROUPS)[number]["items"][number], { kind: "route" }> => it.kind === "route",
    );
    for (const key of routeConsolidated) {
      const item = items.find((it) => it.key === key);
      expect(item, `${key} 声明收编，却已无 kind:"route" 回退条目 ⇒ 沙盘关掉时这一页从 IA 里蒸发`).toBeTruthy();
      expect(
        item!.consolidatedWhen,
        `${key} 的条目没带 consolidatedWhen ⇒ 沙盘开着时它仍会单列 = 重复入口`,
      ).toBe("sim.sandbox");
    }
  });

  it("反向：收编键的路由**仍然可达**（深链接不许断）", () => {
    // 经后端下发的那批走 `/v/:viewKey` 通用分发：mock/后端仍下发 ⇒ ViewPage 查得到 view + 拿得到 renderer。
    // WO-SANDBOX-NAV-CONSOLIDATE：`view-defs`（增量视图桶）与 `workspace.views`（BUILTIN_VIEWS 种子）
    // 在**前端这一侧**走的是同一条分发路径，差别只在后端从哪张表派单（门脚本按 via 分开验那一半）。
    // ⚠ `process-stuck` 是暗发页（`process.runtime` defaultOn:false）⇒ 默认 workspace 里没有它，
    //   本条必须先把它开通，否则会把「暗发中」误判成「深链接断了」。
    db.tenantOverrides["process.runtime"] = true;
    const viaDispatch = consolidated.filter((k) => {
      const via = CONSOLIDATED_INTO_SANDBOX[k]!.via;
      return via === "workspace.views" || via === "view-defs";
    });
    const ws = workspaceForAccount(
      ACCOUNTS.find((a) => a.username === "planner")!,
      db.tenantOverrides,
      db.configVersion,
    );
    const wsViews = ws.views ?? [];
    const wsFeatures = ws.features ?? [];
    // 金丝雀：mock 下发确实有视图（一个都没有 ⇒ 下面的 find 全部落空、断言方向恰好反过来）
    expect(wsViews.length).toBeGreaterThan(5);
    for (const key of viaDispatch) {
      const view = wsViews.find((v) => v.key === key);
      expect(view, `${key} 已从 workspace.views 消失 ⇒ /v/${key} 深链接会落 403/404（这就是回归）`).toBeTruthy();
      expect(
        wsFeatures.includes(`view.${key}`),
        `${key} 的 entitlement 没下发 ⇒ ViewPage 先判 feature → 404`,
      ).toBe(true);
      expect(getRenderer(view!.renderer), `${key} 的 renderer 没注册 ⇒ 打开是 UnsupportedViewCard`).toBeDefined();
    }
    // 四个推演页走 App.tsx 专用静态 route：静态段先于 `:viewKey` 匹配，免下发即可达。
    const viaRoute = consolidated.filter((k) => CONSOLIDATED_INTO_SANDBOX[k]!.via === "static-route");
    const shellChildren = routes.find((r) => r.path === "/")!.children ?? [];
    const staticRoutes = new Set(
      shellChildren.map((r) => r.path ?? "").filter((p) => p.startsWith("v/") && !p.includes(":")).map((p) => p.slice(2)),
    );
    // 金丝雀：路由表解析得出东西（解析空 ⇒ 下面 has() 全 false，方向是误红而非漏放，但仍要说清）
    expect(staticRoutes.has("sim-sandbox"), "路由表解析不出 sim-sandbox ⇒ 本测试的解析器坏了").toBe(true);
    for (const key of viaRoute) {
      expect(staticRoutes.has(key), `App.tsx 没有 { path: "v/${key}" } ⇒ /v/${key} 落 :viewKey 兜底 → 404`).toBe(true);
    }
    // 两条路加起来必须盖住全表（漏一种 via 值 = 上面两个循环各自空转）
    expect(viaDispatch.length + viaRoute.length).toBe(consolidated.length);
    delete db.tenantOverrides["process.runtime"];
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// § 件三 · 模式切换：一次只呈现一屏（判据是**不在 DOM**，不是 hidden）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 各模式的**特征元素**：只有该模式渲染时才可能出现的 testid。
 *
 * ⚠ 后四格刻意用**壳级** `sandbox-mode-pane-<m>` 而不是各视图自己的根 testid
 * （`cleanroom-attr` / `what-if` / …）：那四个根在数据取不到时会换成诚实空态
 * （`cr-types-error` / `dr-empty-no-chain` 之流），拿它们当"这一屏在不在"的判据，
 * 会把**空态**误判成**没渲染** —— 那是「我用 X 当作 Y 的证据，而 X 并不度量 Y」的老形态。
 * 「现状」用 `sandbox-console`：它是真实组件的根，不是本单自造的壳。
 */
const MODE_SIGNATURE: Record<SandboxMode, string> = {
  now: "sandbox-console",
  attribute: "sandbox-mode-pane-attribute",
  tryone: "sandbox-mode-pane-tryone",
  optimize: "sandbox-mode-pane-optimize",
  radius: "sandbox-mode-pane-radius",
};

describe("§件三 · 模式切换 = 换一整屏，不是叠一屏", () => {
  it("金丝雀：模式序列按决策链排，且五个模式各有特征元素登记（登记漏了 ⇒ 下面断言恒真）", () => {
    expect([...SANDBOX_MODES]).toEqual(["now", "attribute", "tryone", "optimize", "radius"]);
    for (const m of SANDBOX_MODES) expect(MODE_SIGNATURE[m]).toBeTruthy();
    expect(Object.keys(MODE_SIGNATURE).length).toBe(SANDBOX_MODES.length);
  });

  it("默认落「现状」模式，五个模式按钮都在顶栏", async () => {
    mount();
    await ready();
    const bar = screen.getByTestId("sandbox-mode-switch");
    for (const m of SANDBOX_MODES) {
      expect(within(bar).getByTestId(`sandbox-mode-${m}`).textContent).toContain(SANDBOX_MODE_LABEL[m]);
    }
    expect(screen.getByTestId("sandbox-mode-now").getAttribute("aria-pressed")).toBe("true");
  });

  /**
   * 深浅两套主题（仓主用浅色）—— jsdom 不跑真 CSS，故这里咬**可静态判定的那一半**：
   * 模式切换条这棵子树里**不许出现写死的颜色**（内联 `#RRGGBB` / `rgb()` / 颜色关键字）。
   * 写死一个色，暗色主题下看得见、浅色主题下就可能糊成一片 —— 这是本仓 tokens.css 存在的理由。
   * 允许 `var(--…)`：那正是跟着主题走的写法。
   */
  it("主题无关：模式切换条整棵子树零硬编码颜色（只许 var(--…) ）", async () => {
    mount();
    await ready();
    const bar = screen.getByTestId("sandbox-mode-switch");
    const nodes = [bar, ...Array.from(bar.querySelectorAll<HTMLElement>("*"))];
    // 金丝雀：这棵子树确实有带 style 的节点（一个都没有 ⇒ 下面的检查恒真）
    expect(nodes.filter((n) => n.getAttribute("style")).length).toBeGreaterThan(0);
    const offenders = nodes
      .map((n) => n.getAttribute("style") ?? "")
      .filter((s) => /#[0-9a-f]{3,8}\b|\brgba?\(/i.test(s));
    expect(
      offenders,
      `模式切换条里出现了写死的颜色：${offenders.join(" | ")} —— 暗色下看得见不代表浅色下看得见，` +
        `颜色一律走 tokens.css 的 var(--…)（三套主题自动跟随）。`,
    ).toEqual([]);
  });

  it("屏上的「已收编原独立页」清单与 CONSOLIDATED_INTO_SANDBOX **不许漂移**（两张表各写一半 = #99/#110 的病根）", async () => {
    mount();
    await ready();
    const box = screen.getByTestId("sandbox-consolidated-links");
    const shown = Array.from(box.querySelectorAll("a")).map((a) => (a.getAttribute("data-testid") ?? "").replace(/^sandbox-consolidated-/, ""));
    expect(shown.slice().sort()).toEqual(Object.keys(CONSOLIDATED_INTO_SANDBOX).slice().sort());
    // 每条的 href 就是那个键的深链接（写错 href = 清单在，点过去 404）
    for (const a of Array.from(box.querySelectorAll("a"))) {
      const key = (a.getAttribute("data-testid") ?? "").replace(/^sandbox-consolidated-/, "");
      expect(a.getAttribute("href")).toBe(`/v/${key}`);
    }
    // 默认折叠（第二层，不占第一层——仓主原话「信息太多，第一层看不到重点」）
    expect((box as HTMLDetailsElement).open).toBe(false);
  });

  it("切到模式 B ⇒ 模式 A 的特征元素**不在 DOM 里**（逐对全测，不是抽一对）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    for (const to of SANDBOX_MODES) {
      await user.click(screen.getByTestId(`sandbox-mode-${to}`));
      await waitFor(() => expect(screen.getByTestId(`sandbox-mode-${to}`).getAttribute("aria-pressed")).toBe("true"));
      await screen.findByTestId(MODE_SIGNATURE[to]);
      for (const other of SANDBOX_MODES) {
        if (other === to) continue;
        const el = screen.queryByTestId(MODE_SIGNATURE[other]);
        expect(
          el,
          `切到「${SANDBOX_MODE_LABEL[to]}」后，「${SANDBOX_MODE_LABEL[other]}」的特征元素仍在 DOM 里 —— ` +
            `这是「叠一屏再盖住」，不是「换一整屏」。hidden/display:none 一律不算。`,
        ).toBeNull();
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// § 件三 · 上下文跨模式保持（不带上下文的合并 = 把五页塞进一个 tab 条）
// ══════════════════════════════════════════════════════════════════════════════
/**
 * 取「任意一个基地复选框」。
 *
 * ⚠ 并线单 WO-SANDBOX-UI-INTEGRATE 实测到的**跨分支碰撞**（两条分支各自都对，合起来才炸）：
 * 本单原写 `screen.getAllByTestId(/^sc-base-/)[0]`，而 WO-SANDBOX-DECLUTTER 给基地清单
 * 套了一层可滚容器 `<div data-testid="sc-base-list">`（规范 §1：筛选器属第二层，不该是最高的东西）。
 * 该容器在 DOM 序上**排在所有复选框之前**，于是 `[0]` 取到的是**容器本身**，
 * `baseId` 被解析成字面量 `"list"`，`click` 点在 div 上什么也没发生 ——
 * 断言遂报 `expected '…全部基地…' to contain 'list'`，看上去像"上下文没带过去"，
 * 实则是**选择器咬错了元素**。形态即本仓铁律 0.6 那句：
 * 「我用『testid 前缀匹配』当作『这是一个复选框』的证据，而前者并不度量后者。」
 *
 * 修法：按**元素本身是不是复选框**来筛（语义判据），不靠 testid 命名巧合；
 * 并先断言前提（至少存在一个）再返回，前提不成立时报的是"前提没成立"而不是"行为不对"。
 */
function firstBaseCheckbox(): { el: HTMLElement; baseId: string } {
  const boxes = screen
    .getAllByTestId(/^sc-base-/)
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "checkbox");
  expect(
    boxes.length,
    "沙盘左栏一个基地复选框都没有 —— 这是本条断言的**前提**没成立（BASE_REGISTRY 空 / 左栏没渲染），不是上下文保持坏了",
  ).toBeGreaterThan(0);
  const el = boxes[0]!;
  const baseId = (el.getAttribute("data-testid") ?? "").replace(/^sc-base-/, "");
  expect(baseId, "基地复选框的 testid 解析不出 baseId").not.toBe("");
  return { el, baseId };
}

describe("§件三 · 上下文跨模式保持", () => {
  it("在「现状」里改基地勾选 → 切「归因」→ 切回「现状」，勾选仍在", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    // 初始：一个都没勾（= 全部基地）；勾掉一个基地进入「部分选中」态
    const { el: anyBase, baseId } = firstBaseCheckbox();
    await user.click(anyBase);
    const scopeTextBefore = screen.getByTestId("sandbox-scope-strip").textContent ?? "";
    expect(scopeTextBefore).toContain(baseId);

    await user.click(screen.getByTestId("sandbox-mode-attribute"));
    await screen.findByTestId(MODE_SIGNATURE.attribute);
    await user.click(screen.getByTestId("sandbox-mode-now"));
    await screen.findByTestId("sandbox-console");

    const again = await screen.findByTestId(`sc-base-${baseId}`);
    expect(again, "切模式回来后基地勾选丢了 —— 上下文没带过去").toBeChecked();
  });

  it("上下文条**跨模式常驻**且读数一致（证明是同一份，不是各记各的）", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const { el: anyBase, baseId } = firstBaseCheckbox();
    await user.click(anyBase);
    const expected = screen.getByTestId("sandbox-scope-strip").textContent;

    for (const m of SANDBOX_MODES) {
      await user.click(screen.getByTestId(`sandbox-mode-${m}`));
      await screen.findByTestId(MODE_SIGNATURE[m]);
      expect(
        screen.getByTestId("sandbox-scope-strip").textContent,
        `「${SANDBOX_MODE_LABEL[m]}」模式下上下文条读数变了 —— 说明各模式各记各的`,
      ).toBe(expected);
      expect(screen.getByTestId("sandbox-scope-strip").textContent ?? "").toContain(baseId);
    }
  });
});
