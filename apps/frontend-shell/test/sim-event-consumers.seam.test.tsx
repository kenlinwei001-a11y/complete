import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { SandboxViewConfig } from "@platform/contracts";
import { server } from "./setup";
import { queryClient } from "@/store/queryClient";
import { invalidateForEvent } from "@/store/eventInvalidation";
import SandboxView from "@/views/sim/SandboxView";

/**
 * WO-L4B（欠账 #145）· `sim.*` 事件**真消费方**的效果层接缝门。
 *
 * ── 这条门要挡的是什么 ────────────────────────────────────────────────────────
 * 「给事件补订阅方」最容易糊弄的做法，是写一个空回调让订阅计数变好看 —— 那是 #90/#92 那族
 * 假接线的翻版。所以本文件**一条都不断言「订阅函数被调用了」**，只断言**副作用**：
 *
 *   发一个 `sim.branched` → 屏上真的多出那个分叉世界；
 *   发一个 `sim.tick_completed` → 屏上的 tick 与 KPI 真的换成了服务端的新值。
 *
 * 与 `sim-event-invalidation.seam.test.ts` 的分工：那份咬**失效表→queryKey** 这一跳（store 层），
 * 这份咬**事件→重取→DOM** 整条链（组件层）。前者能证前缀匹配对，证不了"屏上真的变了"。
 *
 * ── 三个必须做对的细节（做错就是假绿）────────────────────────────────────────
 * ① **必须用单例 queryClient 挂载**。`invalidateForEvent` 打的是 `@/store/queryClient` 那个单例；
 *    既有沙盘测试习惯 `new QueryClient()`，那样事件永远打不到组件的 query 上 —— 断言会以
 *    "什么都没发生" 的形式恒绿（因为我断的是"发生了"，所以这里会恒红，反而安全；但仍写明以免后人照抄错）。
 * ② **必须先断言"事件发出去之前，屏上还是旧的"**。少了这一步，就分不清"是事件让它变的"
 *    还是"它本来就会自己变"（背景重取 / 轮询）。故每条用例都有一个「改了服务端但没发事件 ⇒ 屏上不变」的前置。
 * ③ **必须有拼错事件名的反证**。证明咬的是真事件名而不是任意字符串。
 *
 * MSW 用的是**本文件自己的会话 store**（不是 handlers.ts 的默认桩）：因为要模拟
 * "另一个标签页/另一个用户改了服务端"，必须能在组件不知情的情况下改服务端状态。
 */

// ── 本门自己的"服务端"（可在组件不知情时被改动，用于模拟另一个标签页的动作）──────────
type Sess = { id: string; tenantId: string; baseSnapshot: Record<string, unknown>; scope: Record<string, unknown>; status: string; curTick: number; parentCheckpointId: string | null; createdAt: string };
let sessions: Sess[] = [];
let worlds: Record<string, { tick: number; state: Record<string, Record<string, number>> }> = {};
/** 服务端被打了几次（用于证明"没发事件就没有重取"，而不是靠肉眼看屏）。 */
let sessionListHits = 0;
let worldHits = 0;

function installHandlers() {
  server.use(
    http.get("*/a/v1/sim/sessions", () => {
      sessionListHits += 1;
      return HttpResponse.json({ items: sessions });
    }),
    http.post("*/a/v1/sim/sessions", async ({ request }) => {
      const body = (await request.json()) as { baseSnapshot?: Record<string, Record<string, number>>; scope?: Record<string, unknown> };
      const s: Sess = {
        id: "sims_main", tenantId: "demo", baseSnapshot: body.baseSnapshot ?? {}, scope: body.scope ?? {},
        status: "READY", curTick: 0, parentCheckpointId: null, createdAt: "2026-08-09T00:00:00.000Z",
      };
      sessions.push(s);
      worlds[s.id] = { tick: 0, state: body.baseSnapshot ?? {} };
      return HttpResponse.json(s, { status: 201 });
    }),
    http.get("*/a/v1/sim/sessions/:id/world", ({ params }) => {
      worldHits += 1;
      const id = String((params as { id: string }).id);
      return HttpResponse.json(worlds[id] ?? { tick: 0, state: {} });
    }),
    // 就绪认证：本门不测它，给个形状合法的最小回包即可（失败只会让右栏少一块，不影响断言）。
    http.get("*/a/v1/sim/sessions/:id/certification", () =>
      HttpResponse.json({
        scope: "GLOBAL", targetRef: null, level: "L2_RUNNABLE",
        dims: { structure: 70, knowledge: 50, behavior: 35, composite: 52 },
        l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
        trialTick: { passed: false, derivationNodes: 1, propagationCovered: false, at: null, error: null },
        worldCompleteness: {
          pct: 60, derivationRules: { present: 1, needed: 2 },
          actions: { present: 0, needed: 1 }, propagationRules: { present: 1, needed: 1 }, stateVarKeys: [], entering: [],
        },
        canEnterSimulation: false, gaps: [], computedAt: "2026-08-09T00:00:00.000Z",
      }),
    ),
  );
}

const CFG: SandboxViewConfig = {
  // 抽象占位类型名（R14 零行业实体名）——本门证的是事件→重取→屏，与行业无关。
  tenantId: "tenant-l4b",
  nodeTypes: ["TypeA", "TypeB"],
  linkTypes: ["linkAB"],
  stateVars: ["s1"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["sandbox"],
  propagationCount: 1,
};

/** ★ 必须挂**单例** queryClient：invalidateForEvent 打的就是它（见文件头 ①）。 */
function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

/**
 * 等到主会话建好并出现在世界列表里（= 起跑线）。
 *
 * WO-SANDBOX-DECLUTTER：世界列表已从**常驻右栏**收进**默认折叠的诊断抽屉**
 * （仓主实测：7 个世界各带一个「切到此世界」按钮常驻右栏，把决策者的屏塞爆）。
 * 折叠时抽屉内部不渲染，故本门先把抽屉点开再等起跑线。
 *
 * ⚠ 这不改变本门要证的东西：它咬的是「`sim.*` 事件到达 ⇒ **列表内容真的变了**」，
 * 而列表在哪一层与事件消费链一行关系都没有。抽屉开着之后，每一条断言逐字不变。
 */
async function waitForMainWorld() {
  await screen.findByTestId("sandbox-view");
  const toggle = await screen.findByTestId("sc-diag-toggle");
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  await screen.findByTestId("sc-diag-panel");
  await waitFor(() => expect(screen.getByTestId("sandbox-world-sims_main")).toBeInTheDocument());
}

beforeEach(() => {
  sessions = [];
  worlds = {};
  sessionListHits = 0;
  worldHits = 0;
  installHandlers();
});
afterEach(() => cleanup());

describe("WO-L4B · sim.* 事件 → 前端真消费方（效果层：断言屏上真的变了）", () => {
  it("① sim.branched → 分叉出的子世界**真的出现在世界列表里**（修「刷新即丢」）", async () => {
    mount();
    await waitForMainWorld();

    // 另一个标签页（或另一个用户）从检查点分了个支：服务端多了一个子会话，本页尚不知情。
    sessions.push({
      id: "sims_child", tenantId: "demo", baseSnapshot: {}, scope: {},
      status: "READY", curTick: 0, parentCheckpointId: "cp_1", createdAt: "2026-08-09T00:00:00.000Z",
    });
    worlds["sims_child"] = { tick: 0, state: {} };

    // ★ 前置（见文件头 ②）：没发事件之前，屏上**不该**自己冒出来 —— 否则下面那条断言证明不了是事件的功劳。
    expect(
      screen.queryByTestId("sandbox-world-sims_child"),
      "还没发事件，子世界就已经在屏上了 —— 那说明它是被别的机制刷出来的，本门的断言不成立",
    ).toBeNull();

    // ★ 事件到达（真实链路里由 useDomainEventStream 轮询 /a/v1/outbox 后调用同一个函数）。
    invalidateForEvent("sim.branched");

    // ★ 效果层断言：子世界**真的出现在 DOM 里**，并且被标成分支。
    await waitFor(() =>
      expect(
        screen.getByTestId("sandbox-world-sims_child"),
        "发了 sim.branched 但世界列表没刷出子世界 —— 这正是欠账 #145 的病样：事件发了没人收，" +
          "分叉出来的世界只活在 SandboxView 的 useState(branchId) 里，刷新即丢",
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("sandbox-world-sims_child")).toHaveAttribute("data-branch", "1");
  });

  it("② sim.tick_completed → 当前世界态**真的换成服务端新值**（tick 与 KPI 都变）", async () => {
    mount();
    await waitForMainWorld();
    // 起跑线：tick 0。
    await waitFor(() => expect(screen.getByTestId("sandbox-kpi-global")).toHaveTextContent("tick 0"));

    // 另一处推进了 7 个 tick，世界态整体抬到 80（服务端已变，本页尚不知情）。
    worlds["sims_main"] = { tick: 7, state: { "TypeA#0": { s1: 80 }, "TypeB#0": { s1: 80 } } };

    // ★ 前置：没发事件 ⇒ 不该重取（staleTime:Infinity 就是为此），屏上仍是 tick 0。
    const hitsBefore = worldHits;
    expect(screen.getByTestId("sandbox-kpi-global")).toHaveTextContent("tick 0");

    // ★ 事件到达。
    invalidateForEvent("sim.tick_completed");

    // ★ 效果层断言：真的重取了，且屏上的 tick 与 KPI 都换成了新值。
    await waitFor(() =>
      expect(
        screen.getByTestId("sandbox-kpi-global"),
        "发了 sim.tick_completed 但屏上还停在 tick 0 —— 别的标签页/别的用户会一直看着过期的世界态",
      ).toHaveTextContent("tick 7"),
    );
    expect(worldHits, "没有发生真重取（GET …/world 没被打）——那 tick 是从哪变出来的？").toBeGreaterThan(hitsBefore);
    expect(screen.getByTestId("sandbox-kpi-global-val")).toHaveTextContent("80.0");
  });

  it("③ 反证：事件名拼错一个字母 → 屏上什么都不变（证咬的是真事件名，不是任意字符串）", async () => {
    mount();
    await waitForMainWorld();

    sessions.push({
      id: "sims_child", tenantId: "demo", baseSnapshot: {}, scope: {},
      status: "READY", curTick: 0, parentCheckpointId: "cp_1", createdAt: "2026-08-09T00:00:00.000Z",
    });
    worlds["sims_main"] = { tick: 7, state: { "TypeA#0": { s1: 80 } } };
    const listHitsBefore = sessionListHits;
    const worldHitsBefore = worldHits;

    for (const bad of ["sim.branchedd", "sim.branch", "sim.tick_complete", "sim_tick_completed"]) {
      invalidateForEvent(bad);
    }

    // 给足够的机会让"万一会变"暴露出来（若真变了，下面三条会红）。
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("sandbox-world-sims_child")).toBeNull();
    expect(screen.getByTestId("sandbox-kpi-global")).toHaveTextContent("tick 0");
    expect(
      sessionListHits + worldHits,
      "拼错的事件名居然触发了重取 —— 说明失效是被别的东西触发的，不是事件名匹配",
    ).toBe(listHitsBefore + worldHitsBefore);
  });

  it("④ 本地分支动作 → 子世界立刻进世界列表（发起方这一页不必等事件轮询）", async () => {
    // 分支需要 checkpoint + branch 两跳；本门只关心"列表真的多一行"。
    server.use(
      http.post("*/a/v1/sim/sessions/:id/checkpoint", () =>
        HttpResponse.json({ id: "cp_1", sessionId: "sims_main", tenantId: "demo", tick: 0, label: "branch@tick0", createdAt: "2026-08-09T00:00:00.000Z" }),
      ),
      http.post("*/a/v1/sim/sessions/:id/branch", () => {
        const child: Sess = {
          id: "sims_child", tenantId: "demo", baseSnapshot: {}, scope: {},
          status: "READY", curTick: 0, parentCheckpointId: "cp_1", createdAt: "2026-08-09T00:00:00.000Z",
        };
        sessions.push(child);
        worlds[child.id] = { tick: 0, state: {} };
        return HttpResponse.json(child, { status: 201 });
      }),
      http.get("*/a/v1/sim/compare", () => HttpResponse.json({ a: [], b: [] })),
    );

    const user = userEvent.setup();
    mount();
    await waitForMainWorld();
    expect(screen.queryByTestId("sandbox-world-sims_child")).toBeNull();

    await user.click(screen.getByTestId("sandbox-branch-btn"));

    await waitFor(() =>
      expect(
        screen.getByTestId("sandbox-world-sims_child"),
        "本地分支后世界列表没多出子世界 —— 修前它只落在 useState(branchId)，刷新即丢",
      ).toBeInTheDocument(),
    );
  });
});
