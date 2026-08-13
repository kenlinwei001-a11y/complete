import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { SandboxViewConfig, TickState } from "@platform/contracts";
import { server } from "./setup";
import SandboxView, { deriveBaseSnapshot } from "@/views/sim/SandboxView";

/**
 * ══ WO-V4-HONEST-ORIGIN · 顶栏读数**出处记号**门（PRD-sandbox-v4 §2.1 / §4.3）══════════
 *
 * ── 病历（仓主截图 + PRD §2.1 逐行取证）─────────────────────────────────────────
 * `deriveBaseSnapshot` 用 `hash01(对象id|变量名)×100` 派生 tick0 世界态。它是**确定性占位**
 * （R6 合规），问题不在数值而在**屏上没有任何记号说它是占位**：全对象取均值必然收敛到 50
 * （大数定律），于是顶栏 16 个读数全落在 49.5–50.4；同屏阻滞点行**有**「合成数据」徽标，
 * 顶栏一个都没有 —— 两者并排，读者只会把没记号的那批读成实测。
 *
 * ── ⛔ 不许怎么修 ─────────────────────────────────────────────────────────────
 * 不许改 `hash01` 的派生本身（把值改得"不像 50"只会得到一屏**更像真的**假数据，比现在更坏）。
 * 本门第 ③ 条把这一点也咬住：`deriveBaseSnapshot` 的输出必须仍是那份哈希派生。
 *
 * ── 判据必须**两向**（PRD §4.3 原话「只咬一向证明不了」）──────────────────────
 *  ① 占位期：徽标在，且写着「合成·占位」（`data-origin="DERIVED"`）
 *  ② 实测期：记号**换掉** —— 写「实测」（`data-origin="MEASURED"`），且「合成·占位」**不再出现**
 * 只咬 ① 可能是它永远显示占位（那就成了另一种谎：真实测了还说是占位）；
 * 只咬 ② 可能是它一开始就说实测。
 *
 * ── 🔴 本门要防的那个**具体**假绿（不写下来下一个人一定会踩）──────────────────
 * PRD §2.1 写「占位只在 `simWorld` 回来**之前**占屏」。**实测不是这样**：
 * `init()` 建完会话立刻 `qc.setQueryData(["a","sim-world", id], …)` 把占位塞进同一个缓存键，
 * 而该 query 是 `staleTime: Infinity` ⇒ **新建会话的那个 GET 根本不会发**。
 * 所以若拿「`worldQuery.data` 到没到」当判据，徽标会在**屏上全是哈希数**的那一刻就翻成"实测"——
 * 那比今天没有徽标更坏。第 ④ 条用「`GET …/world` 的真实请求数 == 0」把这个事实钉住。
 *
 * R6 确定性：网络全桩，无时钟、无随机。
 */

// ── 证物 ───────────────────────────────────────────────────────────────────────
const worldGets: string[] = [];

const CFG: SandboxViewConfig = {
  tenantId: "tenant-origin",
  nodeTypes: ["TypeA", "TypeB"],
  nodeObjectIds: { TypeA: ["obj_a1", "obj_a2"], TypeB: ["obj_b1"] },
  linkTypes: ["FEEDS"],
  stateVars: ["load", "risk"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 1,
};

/** 后端算出来的世界态（**与前端哈希派生刻意不同**：不同才能证明屏上换的是那一份）。 */
const SERVER_WORLD: TickState = {
  obj_a1: { load: 71, risk: 12 },
  obj_a2: { load: 68, risk: 15 },
  obj_b1: { load: 5, risk: 90 },
};

function installHandlers() {
  let world: TickState = {};
  server.use(
    http.post("*/a/v1/sim/sessions", async ({ request }) => {
      const body = (await request.json()) as { baseSnapshot?: TickState; scope?: Record<string, unknown> };
      world = JSON.parse(JSON.stringify(body.baseSnapshot ?? {})) as TickState;
      return HttpResponse.json(
        { id: "sims_origin", tenantId: "demo", baseSnapshot: world, scope: body.scope ?? {}, status: "READY", curTick: 0, parentCheckpointId: null, createdAt: "2026-08-13T00:00:00.000Z" },
        { status: 201 },
      );
    }),
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [] })),
    http.get("*/a/v1/sim/sessions/:id/world", ({ request }) => {
      worldGets.push(request.url);
      return HttpResponse.json({ tick: 3, state: SERVER_WORLD });
    }),
    // tick 回包 = **后端算的**世界态 ⇒ 屏上记号必须从「合成·占位」换成「实测」。
    http.post("*/a/v1/sim/sessions/:id/tick", () => HttpResponse.json({ curTick: 1, state: SERVER_WORLD })),
    http.get("*/a/v1/sim/sessions/:id/perturbations", () => HttpResponse.json({ items: [] })),
    http.get("*/a/v1/sim/sessions/:id/certification", () =>
      HttpResponse.json({ error: { code: "FEATURE_NOT_FOUND", message: "off", requestId: "r" } }, { status: 404 }),
    ),
  );
}

function mount(cfg: SandboxViewConfig = CFG) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={cfg} />
    </QueryClientProvider>,
  );
}

const badge = () => screen.getByTestId("sandbox-kpi-origin");

beforeEach(() => {
  worldGets.length = 0;
  installHandlers();
});
afterEach(() => cleanup());

describe("WO-V4-HONEST-ORIGIN · 顶栏占位值诚实位（两向）", () => {
  it("① 占位期：徽标在场且写「合成·占位」（DERIVED）—— 屏上那批数确实是哈希派生的那一份", async () => {
    mount();
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("DERIVED"));
    expect(badge().textContent).toContain("合成·占位");
    expect(badge().textContent).not.toContain("实测");

    // 屏上的读数确实 == `deriveBaseSnapshot` 那一份（否则"占位"这个记号指的不是屏上这批数）。
    const base = deriveBaseSnapshot(CFG);
    const ids = Object.keys(base);
    expect(ids.length).toBeGreaterThan(2);
    for (const v of CFG.stateVars) {
      const avg = ids.reduce((a, o) => a + (base[o]?.[v] ?? 0), 0) / ids.length;
      const shown = screen.queryByTestId(`sandbox-kpi-${v}-val`);
      // 分层后只有前 N 个在第一层，其余在 `<details>` 里 —— 折叠态内容仍在 DOM，故一律找得到。
      expect(shown, `stateVar ${v} 的读数不在 DOM 里`).not.toBeNull();
      expect(shown!.textContent).toBe(avg.toFixed(1));
    }
  });

  it("② 实测期：推进一个 tick（后端回包）⇒ 记号**换成**「实测」（MEASURED），「合成·占位」不再出现", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("DERIVED"));

    await user.click(screen.getByTestId("sandbox-tick-btn"));

    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("MEASURED"));
    expect(badge().textContent).toContain("实测");
    expect(badge().textContent, "占位记号没换掉 —— 只加不换等于没换（只咬一向的那种假绿）").not.toContain("合成·占位");

    // 屏上的读数也真的换成了后端那一份（记号换了但数没换 = 记号在说谎）。
    const ids = Object.keys(SERVER_WORLD);
    expect(ids.length).toBeGreaterThan(2);
    const avgLoad = ids.reduce((a, o) => a + (SERVER_WORLD[o]?.load ?? 0), 0) / ids.length;
    await waitFor(() => expect(screen.getByTestId("sandbox-kpi-load-val").textContent).toBe(avgLoad.toFixed(1)));
  });

  it("③ `hash01` 派生**没被改**：同一份 cfg 重跑逐字节一致，且全对象均值仍收敛在 50 附近（R6 占位不动）", () => {
    // 这一条是**反向**约束：本单修的是记号，不是数值。有人"顺手把占位改得不像 50"就在这里红。
    const a = deriveBaseSnapshot(CFG);
    const b = deriveBaseSnapshot(CFG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // R6 确定性
    const ids = Object.keys(a);
    expect(ids.length).toBeGreaterThan(2);
    for (const oid of ids) for (const v of CFG.stateVars) {
      const x = a[oid]![v]!;
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThan(-1);
      expect(x).toBeLessThan(101);
    }
  });

  it("④ 判据不能用「`worldQuery.data` 到没到」—— 新建会话时那个 GET **一次都不会发**（本门钉住这个事实）", async () => {
    mount();
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("DERIVED"));

    // ★ 否定结论先立：页面这一侧一次都没发过 `GET …/world`
    //   （`init` 用 setQueryData 塞了占位 + `staleTime: Infinity` ⇒ 那个 query 已是 fresh，不会去取）。
    const fromPage = worldGets.length;
    expect(fromPage).toBe(0);

    // 🐤 金丝雀（**必须在否定结论之后立刻给**，铁律 0.6）：同一个 handler 在**已知必中**的那一面
    //   必须记得上账 —— 手打一次同一个 URL，计数应当涨。不涨 ⇒ 是 handler 瞎了，不是页面没发。
    await fetch("http://localhost/a/v1/sim/sessions/sims_origin/world");
    expect(worldGets.length, "handler 自己不记账 ⇒ 上面那个「0 次」证明不了任何事").toBeGreaterThan(fromPage);
  });

  it("⑤ 事件驱动重取（真 GET 回来的那一份）同样标「实测」—— 出处跟着数据走，不跟着某一个入口走", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SandboxView injectedConfig={CFG} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("DERIVED"));

    // 模拟 `sim.tick_completed` 到达 → invalidateForEvent 把这个 key 标脏 → 真重取。
    await qc.invalidateQueries({ queryKey: ["a", "sim-world", "sims_origin"] });
    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("MEASURED"));
    expect(badge().textContent).toContain("实测");
    expect(worldGets.length).toBeGreaterThan(0);
  });
});
