import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { SimSession } from "@platform/contracts";
import { server } from "./setup";
import { loginAs } from "./utils";
import type { ViewConfigVM } from "@/api/types";
import type { ViewRendererProps } from "@/views/registry";
import SandboxHomeRoute from "@/views/sim/console/SandboxHomeRoute";
import SandboxDetailRoute from "@/views/sim/console/SandboxDetailRoute";
import SandboxAttrRoute from "@/views/sim/console/SandboxAttrRoute";
import SandboxOptRoute from "@/views/sim/console/SandboxOptRoute";

/**
 * ══ WO-EDGE-PANEL-4PAGES · 推演沙盘指控台四页的「关掉一条传导边」接缝门 ══
 *
 * ── 今天的行为是 X，应该是 Y ─────────────────────────────────────────────────
 * **X（本单开工时实测，`node scripts/check-edge-active-mounts.mjs` RC=1）**：
 * `sim-console` / `sim-conduction` / `sim-attribution` / `sim-optimize` 四页在现算名册里**都在**
 * （R3 nav-sim-group：左导航「推演」组成员），却**一个 `EdgeActivePanel` 挂载点都没有** ⇒
 * 用户在这四页做不了「关掉这条边看看」，要退回旧沙盘页才能操作；而那道能拦住这件事的门
 * **建好了却没接进 `pnpm gates`**（门账 `binding=NONE` · `disposition=WIRE`），所以没人被告知。
 * **Y**：四页都挂上、且挂在**默认导出的主组件**里；门同批接线真跑。
 *
 * ── ⚠ 这道门为什么不能只断言「面板渲染出来了」 ────────────────────────────────
 * 「组件在 DOM 里」正是本仓反复吃亏的那个假绿形态（**实现有、测试绿、链路走不到**，
 * §8 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 同族）。所以本文件的头号判据是**屏上读数真的变了**：
 * 拨一下开关 ⇒ 真发 `POST …/:id/counterfactual` ⇒ 差值表**带方向与量级**出现在这一页上。
 * 只要把重算那一步拆掉，面板还在、边还列着、抽屉照样能展开，**而本文件必红** —— 这就是
 * 「咬链路不咬组件」的判据落点（变异反证见 §③ 的注释）。
 *
 * ── 三层判据（各咬一层，缺一层就有一种假绿）──────────────────────────────────
 *  ① **可达层**：四页挂载点静态可达，且**与门脚本共用同一份 `analyze` 与同一份现算名册** ——
 *     抄一份出来就是装饰品（改门脚本判据时本文件拿旧的去测、照样绿）。
 *  ② **版面层**：抽屉是**画布 `.app` 的兄弟**、不在画布里，且**默认折叠** ——
 *     这就是「画布内信息密度零破坏」那句话的机器判据（`.app` 定死 1440×897 且 `overflow:hidden`，
 *     塞进去的任何东西都得挤掉既有内容）。同时断言它**能被用户打开**（`<details open>` 翻真）。
 *  ③ **交互层（头号）**：真渲染 Route → 展开 → 拨开关 → **请求真打到本页那个会话** →
 *     屏上差值带方向与量级 → 关掉的边**可见地降级不消失**。
 *
 * ── 为什么真渲染 Route 而不是手搓 props ───────────────────────────────────────
 * `render(<EdgeActivePanel …/>)` 测的是**组件**。本文件一律渲染 `registry.ts` 真注册的那个默认导出
 * （`Sandbox*Route`），让它自己走 `useConsoleSession` → 自己拿会话 → 自己透给面板，
 * 断言落在**屏上真出现了什么**与**真发出去的 URL**上。
 *
 * R6 确定性：网络全桩、会话时间戳固定、无随机数、无真实时钟。
 */

/** 门脚本导出的判定函数与名册入口（**借用，不另写一份**）。门有 `import.meta.url === argv[1]` 守卫，
 *  import 它不会跑门、不会 `process.exit`。 */
type MountAnalysis = { ok: boolean; reason: string; mounts: number[]; range: [number, number] | null };
type SimPage = { key: string; file: string | null; why: string[] };
type Roster = { pages: SimPage[]; violations: { code: string; key: string }[] };
type GateModule = {
  analyze: (s: string) => MountAnalysis;
  loadSimPageRoster: (readFile: (rel: string) => string) => Roster;
};
const REPO = resolve(__dirname, "../../..");
const loadGate = async (): Promise<GateModule> =>
  (await import(resolve(REPO, "scripts/check-edge-active-mounts.mjs"))) as GateModule;

/** MSW fixture 里的传导边（`MOCK_RULE_SEED`，`src/mocks/handlers.ts`）。 */
const EDGE_A = "mock_a_to_b"; // TypeA.s1 —(linkAB · 系数 0.5)→ TypeB.s1
/**
 * fixture 世界的算术（**由 mock 的 counterfactual handler 声明，本文件不复算**）：
 * 基线 `TypeA#0.s1 = 60`、`TypeB#0.s1 = 30`；关掉 EDGE_A ⇒ 目标格少收 `0.5 × 60 = 30`
 * ⇒ 反事实为 0 ⇒ **Δ = −30，方向 ↓**。差值本身由**契约** `diffTickStates` 现算
 * （mock 与真后端同一支实现），所以屏上这个数不可能与后端在算术上漂移。
 */
const EXPECT_DELTA = "−30";

/** 本页「正在推演的那个世界」。四页都该把**它**透给面板 —— 用例 ③ 据此断言请求打到了这个 id。 */
const SESSION: SimSession = {
  id: "sims_4pages_running",
  tenantId: "demo",
  baseSnapshot: {},
  scope: {},
  status: "RUNNING",
  curTick: 3,
  parentCheckpointId: null,
  createdAt: "2026-08-20T00:00:00.000Z",
};

const err = (status: number, code: string) =>
  HttpResponse.json({ error: { code, message: code, requestId: "req_seam" } }, { status });

/** 一次真打出去的对照请求（URL + body）。 */
interface SeenCf {
  url: string;
  disabledRuleKeys: string[];
}

/**
 * 桩：只补默认 handler **没有**的那几条（`onUnhandledRequest:"error"`，缺一条整条用例会炸），
 * 外加对 counterfactual 的**放行探针**。
 *
 * ⚠ 探针 `return undefined` 是刻意的：它记录完就落到**真 mock handler**（差值仍由契约现算），
 * 不是自己伪造一份回包。自己伪造 = 本文件变成"我发了请求，我自己回了个差值给自己看"，
 * 那验的是本文件，不是链路。
 *
 * ⚠ 四页各自的取数端点一律桩成 404：本门咬的是**抽屉这条缝**，那几格落占位是**正常态**、
 * 不是漏接（各自另有专门的接缝门：`sandbox-host-wiring` / `sandbox-detail-args` /
 * `metric-series-wire` / `sandbox-pareto-model-exit`）。桩成 404 让它们**确定性**落空，
 * 而不是靠"恰好没人请求"蒙混。
 */
function installHandlers(seen: SeenCf[], opts: { sessions?: SimSession[] } = {}): void {
  server.use(
    http.post("*/a/v1/sim/sessions/:id/counterfactual", async ({ request }) => {
      const body = (await request.clone().json().catch(() => ({}))) as { disabledRuleKeys?: string[] };
      seen.push({ url: request.url, disabledRuleKeys: body.disabledRuleKeys ?? [] });
      return undefined; // 放行给真 mock handler
    }),
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: opts.sessions ?? [SESSION] })),
    http.post("*/a/v1/sim/chain-loss-matrix", () => err(404, "NOT_FOUND")),
    http.post("*/a/v1/sim/chain-loss-drill", () => err(404, "NOT_FOUND")),
    http.get("*/a/v1/sim/sessions/:id/node-detail", () => err(404, "NOT_FOUND")),
    http.get("*/a/v1/sim/sessions/:id/metric-series", () => err(404, "NOT_FOUND")),
    http.post("*/a/v1/sim/optimize-pareto/assemble", () => err(404, "NOT_FOUND")),
    http.post("*/a/v1/sim/optimize-pareto", () => err(404, "NOT_FOUND")),
  );
}

interface PageUnderTest {
  name: string;
  /** 页键 = 名册键 = `registry.ts` 的 renderer key = 面板 `pageKey` = 抽屉 testid 前缀（**一个键，四处同用**）。 */
  key: string;
  Route: ComponentType<ViewRendererProps>;
  /** 画布主容器（`.app` 那一层）—— 用例 ② 断言抽屉**不在它里面**。 */
  canvas: string;
}

const PAGES: readonly PageUnderTest[] = [
  { name: "① 推演指控台首页", key: "sim-console", Route: SandboxHomeRoute, canvas: '[data-testid="sandbox-home"]' },
  { name: "② 传导识别页", key: "sim-conduction", Route: SandboxDetailRoute, canvas: '[data-testid="sandbox-detail"]' },
  { name: "③ 损失归因台", key: "sim-attribution", Route: SandboxAttrRoute, canvas: '[data-testid="sandbox-attr"]' },
  { name: "④ 方案寻优台", key: "sim-optimize", Route: SandboxOptRoute, canvas: '[data-testid="sandbox-opt"]' },
];

const viewOf = (key: string): ViewConfigVM => ({ key, title: key, renderer: key, layout: undefined, options: undefined });

function mount(page: PageUnderTest): HTMLElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <page.Route view={viewOf(page.key)} />
    </QueryClientProvider>,
  );
  return container;
}

/** 展开抽屉 —— **走真实的用户动作**（点标题条），不是直接把 `open` 赋成 true。 */
async function openDock(user: ReturnType<typeof userEvent.setup>, key: string): Promise<HTMLElement> {
  const dock = await screen.findByTestId(`${key}-edge-dock`);
  expect(dock.hasAttribute("open"), `${key}：抽屉默认应折叠（收起态只占 26px，画布内零侵入）`).toBe(false);
  await user.click(screen.getByTestId(`${key}-edge-summary`));
  await waitFor(() => expect(dock.hasAttribute("open"), `${key}：点标题条应展开抽屉`).toBe(true));
  return dock;
}

let seen: SeenCf[];
beforeEach(() => {
  seen = [];
  loginAs("planner");
  installHandlers(seen);
});
afterEach(cleanup);

describe("WO-EDGE-PANEL-4PAGES · 指控台四页「关掉一条传导边 → 屏上读数真的变了」", () => {
  // ── ① 可达层 ────────────────────────────────────────────────────────────────
  it("🔴 可达：四页都在现算名册里，且挂载点落在**默认导出主组件**的行段内（判据与名册均与门脚本共用同一份实现）", async () => {
    const { analyze, loadSimPageRoster } = await loadGate();

    // 金丝雀：同一个 `analyze` 对两个已知答案的合成样例必须给出**相反**结论。
    // 不跑它就没资格把下面的"全过"读成结论（铁律 0.6：报否定/肯定结论前先自证工具）。
    expect(analyze(`export default function P() {\n  return <EdgeActivePanel />;\n}\n`).ok).toBe(true);
    const sub = analyze(`export default function P() {\n  return <S />;\n}\nfunction S() {\n  return <EdgeActivePanel />;\n}\n`);
    expect(sub.ok).toBe(false);
    expect(sub.reason).toBe("MOUNTED_IN_SUBCOMPONENT");

    const roster = loadSimPageRoster((rel) => readFileSync(resolve(REPO, rel), "utf8"));
    expect(roster.violations.map((v) => `${v.code}:${v.key}`)).toEqual([]);

    for (const p of PAGES) {
      const entry = roster.pages.find((x) => x.key === p.key);
      // 本页**必须在受检面里** —— 不在名册里 = 这道门从来没问过它 = 它永远绿
      // （§8 `G-GATE-ROSTER-HANDCOPIED` 的确切形态）。
      expect(`${p.key}:${entry ? "in-roster" : "MISSING"}`).toBe(`${p.key}:in-roster`);
      expect(entry!.why.length, `${p.key}：进名册必须有依据链`).toBeGreaterThan(0);
      const r = analyze(readFileSync(resolve(REPO, entry!.file as string), "utf8"));
      expect(`${p.key}:${r.reason}`).toBe(`${p.key}:OK`);
    }
  });

  // ── ② 版面层 ────────────────────────────────────────────────────────────────
  it.each(PAGES.map((p) => [p.name, p] as const))(
    "%s · 版面：抽屉是画布的**兄弟**不是子节点、默认折叠、点一下能展开（画布内信息密度零侵入的机器判据）",
    async (_name, page) => {
      const user = userEvent.setup();
      const container = mount(page);

      const canvas = await waitFor(() => {
        const el = container.querySelector(page.canvas);
        expect(el, `${page.key}：画布没渲染出来（那说明红在别处，不是抽屉的事）`).not.toBeNull();
        return el as HTMLElement;
      });
      const dock = await screen.findByTestId(`${page.key}-edge-dock`);

      // 🔴 抽屉**不在画布里**：`.app` 定死 1440×897 且 `overflow:hidden`，
      //    塞进画布的任何东西都必须挤掉既有内容（这条一破，「画布内逐像素不动」就是空话）。
      expect(canvas.contains(dock), `${page.key}：抽屉被塞进了画布里`).toBe(false);
      // 且两者同父（= 紧贴画布下沿，不是飘到别处）。宿主包裹元素是 `display:contents`，
      // 故这个"父"就是页面在 shell 里的落点。
      expect(dock.parentElement, `${page.key}：抽屉与画布不同父`).toBe(canvas.parentElement);

      await openDock(user, page.key);
    },
    60000,
  );

  // ── ③ 交互层（头号判据）─────────────────────────────────────────────────────
  //
  // ⚠ **变异反证锚**：把 `EdgeActivePanel.onToggle` 里 `simCounterfactual(...)` 那一步拆掉，
  //   面板还在、边照样列、抽屉照样能展开、②那条照样绿 —— **只有本条会红**，
  //   且红在「差值没出来 / 数没变」而不是「组件不见了」。红在别处即说明它证的是别的东西。
  it.each(PAGES.map((p) => [p.name, p] as const))(
    "%s · 🔴 SEAM：展开抽屉 → 列出真边 → 拨开关 → 请求真打到**本页那个会话** → 屏上差值带方向与量级",
    async (_name, page) => {
      const user = userEvent.setup();
      mount(page);
      await openDock(user, page.key);

      const tid = (s: string) => `edge-active-${page.key}-${s}`;
      const panel = await screen.findByTestId(tid("panel"), {}, { timeout: 20000 });

      // 列的是 MSW 真响应里的边（源/目标/链路/系数逐字段直取，前端零加工），不是写死的占位行。
      const row = within(panel).getByTestId(tid(`edge-${EDGE_A}`));
      expect(row.textContent).toContain("TypeA.s1");
      expect(row.textContent).toContain("linkAB");
      expect(row.textContent).toContain("TypeB.s1");
      expect(row.textContent).toContain("系数 0.5");
      expect(row.getAttribute("data-active")).toBe("true");

      // 拨一下开关 —— **不点任何"再运行一次"的按钮**（拨开关即刻要对照，这是该能力的定义）。
      await user.click(within(panel).getByTestId(tid(`toggle-${EDGE_A}`)));

      // 🔴 请求真发了，而且打的是**本页 `useConsoleSession` 查到的那个会话**
      //    —— 不是面板自己就地开的探针世界（那会让"这一页的推演"与"屏上的差值"对不上）。
      await waitFor(() => expect(seen.length, "一个对照请求都没发出去").toBeGreaterThan(0));
      const cf = seen[seen.length - 1]!;
      expect(cf.url).toContain(`/a/v1/sim/sessions/${SESSION.id}/counterfactual`);
      expect(cf.disabledRuleKeys).toContain(EDGE_A);
      // 反面证据：**没有**把请求打到别的会话上（一次开页只对着一个世界算）。
      expect([...new Set(seen.map((s) => new URL(s.url).pathname))]).toEqual([
        `/a/v1/sim/sessions/${SESSION.id}/counterfactual`,
      ]);

      // 🔴 屏上读数真的变了：差值表出现，且**带方向和量级**（不是只标个"变了"）。
      const diff = await within(panel).findByTestId(tid("diff"), {}, { timeout: 20000 });
      const cell = within(diff).getByTestId(tid("diff-TypeB#0-s1"));
      expect(cell.textContent).toContain("↓");
      expect(cell.textContent).toContain(EXPECT_DELTA);

      // 结论句必须是"有变化"那一支，不是"没变"的两种诚实缺席之一。
      expect(within(panel).getByTestId(tid("verdict")).textContent).toContain("发生变化");

      // 关掉的边**没有从列表里消失**，而是可见地降级 —— 消失了用户就不知道自己关了什么。
      expect(within(panel).getByTestId(tid(`edge-${EDGE_A}`)).getAttribute("data-active")).toBe("false");
      expect(within(panel).getByTestId(tid(`off-${EDGE_A}`)).textContent).toContain("已关闭");
    },
    60000,
  );

  // ── ④ 这道门存在的**全部理由**：没跑过推演也看得见、也能用 ──────────────────────
  //
  // 本门拦的原始缺陷就是「面板被挂进只在跑出结果后才渲染的子组件」⇒ 没跑过推演就看不见开关。
  // 故这里把世界抽空（租户一条会话都没有）再走一遍：抽屉照样在、照样能展开、
  // 拨一下**照样算得出差值**（面板就地开一个探针世界），且屏上**标出这个差值的出处**。
  it("🔴 没有任何推演会话时：四页的抽屉照样能开、拨开关照样算得出差值，且屏上标明差值来自探针世界", async () => {
    for (const page of PAGES) {
      seen.length = 0;
      installHandlers(seen, { sessions: [] }); // 租户零会话
      const user = userEvent.setup();
      mount(page);
      await openDock(user, page.key);

      const tid = (s: string) => `edge-active-${page.key}-${s}`;
      const panel = await screen.findByTestId(tid("panel"), {}, { timeout: 20000 });
      // 还没拨开关时就先把"这一页没有世界"说清楚（诚实缺席，不是静默）。
      expect(within(panel).getByTestId(tid("no-session")).textContent).toContain("就地开一个探针世界");

      await user.click(within(panel).getByTestId(tid(`toggle-${EDGE_A}`)));

      const diff = await within(panel).findByTestId(tid("diff"), {}, { timeout: 20000 });
      expect(within(diff).getByTestId(tid("diff-TypeB#0-s1")).textContent).toContain(EXPECT_DELTA);
      // R13 出处：拿占位世界算出来的差值只反映**边的结构影响**，不是实测量级 —— 必须标。
      expect(within(panel).getByTestId(tid("probe-origin"))).toBeInTheDocument();
      // 且确实是**新开的**那个世界，不是把请求打给了一个不存在的会话。
      expect(seen.length).toBeGreaterThan(0);
      expect(new URL(seen[seen.length - 1]!.url).pathname).not.toContain(SESSION.id);

      cleanup();
    }
  }, 120000);
});
