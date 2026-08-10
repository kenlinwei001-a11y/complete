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
    expect(await within(screen.getByTestId("sc-slot-topo")).findByTestId("pt-matrix")).toBeInTheDocument();
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

  it("正向：五个沙盘子视图，一个都不在 NAV_GROUPS 的 kind:\"view\" 里（重复入口已消）", () => {
    const strays = consolidated.filter((k) => navViewKeys.has(k));
    expect(
      strays,
      `这些键已收编进沙盘，却仍是导航里的平级视图条目 —— 重复入口：[${strays.join(", ")}]`,
    ).toEqual([]);
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

  it("反向：九个键的路由**仍然可达**（深链接不许断）", () => {
    // 五个子视图走 `/v/:viewKey` 通用分发：mock/后端仍下发 ⇒ ViewPage 查得到 view + 拿得到 renderer。
    const viaDispatch = consolidated.filter((k) => CONSOLIDATED_INTO_SANDBOX[k]!.via === "workspace.views");
    const ws = workspaceForAccount(
      ACCOUNTS.find((a) => a.username === "planner")!,
      db.tenantOverrides,
      db.configVersion,
    );
    // 金丝雀：mock 下发确实有视图（一个都没有 ⇒ 下面的 find 全部落空、断言方向恰好反过来）
    expect(ws.views.length).toBeGreaterThan(5);
    for (const key of viaDispatch) {
      const view = ws.views.find((v) => v.key === key);
      expect(view, `${key} 已从 workspace.views 消失 ⇒ /v/${key} 深链接会落 403/404（这就是回归）`).toBeTruthy();
      expect(
        ws.features.includes(`view.${key}`),
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
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// § 件三 · 模式切换：一次只呈现一屏（判据是**不在 DOM**，不是 hidden）
// ══════════════════════════════════════════════════════════════════════════════

/** 各模式的**特征元素**：只有该模式渲染时才可能出现的 testid。 */
const MODE_SIGNATURE: Record<SandboxMode, string> = {
  now: "sandbox-console",
  attribute: "cleanroom-attr-root",
  tryone: "whatif-root",
  optimize: "optimize-whatif-root",
  radius: "disruption-radius-root",
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
describe("§件三 · 上下文跨模式保持", () => {
  it("在「现状」里改基地勾选 → 切「归因」→ 切回「现状」，勾选仍在", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    // 初始：一个都没勾（= 全部基地）；勾掉一个基地进入「部分选中」态
    const anyBase = screen.getAllByTestId(/^sc-base-/)[0]!;
    const baseId = (anyBase.getAttribute("data-testid") ?? "").replace(/^sc-base-/, "");
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
    const anyBase = screen.getAllByTestId(/^sc-base-/)[0]!;
    const baseId = (anyBase.getAttribute("data-testid") ?? "").replace(/^sc-base-/, "");
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
