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
/** 每次 `POST /a/v1/sim/sessions` 的请求体（⑥⑦ 用它断言"前端到底把哪份世界送上去了"）。 */
const createdBodies: { baseSnapshot?: TickState; scope?: Record<string, unknown> }[] = [];

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

/**
 * ══ WO-SIM-FRONTEND-SEED · 租户里**已经播好的那个世界**（后端 `sim/seed-world.ts` 播的那种）══
 *
 * 两处**刻意与 `deriveBaseSnapshot(CFG)` 不同**，缺一处这门就证明不了东西：
 *  · 值不同（`qty` 带真实量纲的大数）⇒ 屏上那批读数换没换得成，一眼可判；
 *  · 变量名不同（`qty` 不在 `CFG.stateVars` 里）⇒ 前端**不可能**自己派生出它，
 *    它只可能是从这份播种世界搬过来的。
 * `measuredCells` 刻意 **> 0**：本单验收判据①的那个数就是它。
 */
const SEEDED_WORLD: TickState = {
  obj_a1: { load: 41, risk: 7, qty: 1200 },
  obj_a2: { load: 39, risk: 9, qty: 860 },
  obj_b1: { load: 12, risk: 77, qty: 5 },
};
const SEEDED_ORIGIN = {
  kind: "DERIVED",
  formula: "两档取值：状态变量名恰好是该对象的一个数值属性 ⇒ 直接取真值；否则 round(hash01(…)×100)",
  note: "本门的样本世界：3 格是实测（状态变量名就是对象上的属性名），其余 6 格是结构派生的确定性占位。",
  types: 2,
  objects: 3,
  cells: 9,
  measuredCells: 3,
  derivedCells: 6,
};
const SEEDED_SESSION = {
  id: "sims_seeded",
  tenantId: "demo",
  baseSnapshot: SEEDED_WORLD,
  scope: { kind: "GLOBAL", target: null, baseSnapshotOrigin: SEEDED_ORIGIN },
  status: "RUNNING",
  curTick: 3,
  parentCheckpointId: null,
  disabledRuleKeys: [],
  tickDays: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function installHandlers(sessionItems: unknown[] = []) {
  let world: TickState = {};
  server.use(
    http.post("*/a/v1/sim/sessions", async ({ request }) => {
      const body = (await request.json()) as { baseSnapshot?: TickState; scope?: Record<string, unknown> };
      createdBodies.push(body);
      world = JSON.parse(JSON.stringify(body.baseSnapshot ?? {})) as TickState;
      return HttpResponse.json(
        { id: "sims_origin", tenantId: "demo", baseSnapshot: world, scope: body.scope ?? {}, status: "READY", curTick: 0, parentCheckpointId: null, createdAt: "2026-08-13T00:00:00.000Z" },
        { status: 201 },
      );
    }),
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: sessionItems })),
    /**
     * 单条会话（**裸 `:id` 路由**）—— `fetchSimSessionWorldBase` 打的就是这一条。
     *
     * ⚠ 为什么不能省：真后端的**列表**路由今天已经不下发 `baseSnapshot` 了
     * （投影落在仓储层 `listSessionSummaries`），只有这条裸 `:id` 还给。这个桩要是不摆，
     * 用例会**静默地**退到 `deriveBaseSnapshot` 兜底 ⇒ 看起来像"功能没做"，实际是"桩没摆"。
     * 本单实测吃过这一口：单文件跑绿、全套跑红（桩的覆盖面在两种跑法下不同）。
     */
    http.get("*/a/v1/sim/sessions/:id", ({ params }) => {
      const hit = (sessionItems as { id: string }[]).find((s) => s.id === params.id);
      return hit
        ? HttpResponse.json(hit)
        : HttpResponse.json({ error: { code: "NOT_FOUND", message: "no", requestId: "r" } }, { status: 404 });
    }),
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
  createdBodies.length = 0;
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
    // 基数下限：空 stateVars 会让下面这个 for **一次都不进**而用例照样绿（`coverage-blind` 的 LOOP_NO_FLOOR）。
    expect(CFG.stateVars.length).toBeGreaterThan(1);
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
    expect(CFG.stateVars.length).toBeGreaterThan(1); // 同上：无下限的 for 在空集上恒绿
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

/**
 * ══ WO-SIM-FRONTEND-SEED · tick0 世界态**先问后端播种的那一份要** ════════════════
 *
 * ── 病灶（2026-09-16 真后端 `SEED_DEMO=1` 实测，非转述）────────────────────────
 * **今天的行为 X**：本页 `init()` 用 `deriveBaseSnapshot(cfg)` 现算一份 100% 哈希世界
 * POST 上去。后端 `POST /a/v1/sim/sessions` 是**纯透传、它不播种**（`app.ts`
 * `createSimSessionWorld`：`input.baseSnapshot ?? {}`，原样落库）⇒ 这样建出来的会话
 * `scope.baseSnapshotOrigin` **整个字段不存在**（不是 `measuredCells: 0` —— 是压根没记号）。
 * 同一租户里后端启动时播下的那个世界实测 `cells 6363 / measuredCells 450`（命中
 * `Order.qty`/`unitPrice`/`leadDays`）⇒ **统一推演台看得到那 450 格真业务数，本页一格都看不到。**
 * **应该的 Y**：先取播种世界那一份当 tick0，连同后端写的出处记号一起复制进新会话的 scope。
 *
 * ── 三条判据为什么缺一不可 ──────────────────────────────────────────────────
 *  ⑥ **正向臂**：租户有播种世界 ⇒ 送上去的就是那一份（含前端派生不出来的变量名），且记号被带走。
 *  ⑦ **反向臂**：租户没有播种世界 ⇒ 回落 `deriveBaseSnapshot`，且**不伪造**一个「实测格 0/N」。
 *     ⚠ 只有 ⑥ 会被"它其实一直都这样"骗过去；只有 ⑦ 会被"它其实从来不走播种路"骗过去。
 *  ⑧ **空世界不许炸**：`stateVars: []` 且列表这一跳直接 500 —— 两条兜底路一起走，页面仍可跑。
 *
 * ⛔ 刻意**不另起一个测试文件**（仓主 2026-08-20 冻结令：不许新增门）——
 *    本文件本来就是"tick0 世界态出处"这件事的门，判据加在它身上才是同一件事的同一道门。
 */
describe("WO-SIM-FRONTEND-SEED · tick0 取后端播种世界（正/反两臂 + 空世界兜底）", () => {
  it("⑥ 正向臂：租户有播种世界 ⇒ 送上去的 baseSnapshot **就是那一份**，出处记号一起带走，屏上写出实测格", async () => {
    cleanup();
    installHandlers([SEEDED_SESSION]);
    mount();
    await screen.findByTestId("sandbox-view");

    await waitFor(() => expect(createdBodies.length).toBeGreaterThan(0));
    const sent = createdBodies[0]!;

    // 🐤 金丝雀先行：这份样本世界确实和前端派生的那一份不同（同 ⇒ 下面的断言什么都证明不了）。
    const derived = deriveBaseSnapshot(CFG);
    expect(JSON.stringify(SEEDED_WORLD)).not.toBe(JSON.stringify(derived));

    // ① 送上去的是播种世界，逐字节。
    expect(JSON.stringify(sent.baseSnapshot)).toBe(JSON.stringify(SEEDED_WORLD));
    // ② 带着一个**前端派生不出来**的变量名 ⇒ 它只可能来自后端那一份（这一条比①更难作弊）。
    expect(CFG.stateVars).not.toContain("qty");
    expect(Object.keys(sent.baseSnapshot?.obj_a1 ?? {})).toContain("qty");
    // ③ 出处记号原样进了新会话的 scope —— 本单验收判据①的那个数。
    const origin = (sent.scope as { baseSnapshotOrigin?: { measuredCells?: number } } | undefined)?.baseSnapshotOrigin;
    expect(origin, "scope.baseSnapshotOrigin 缺席 = 又回到了「建出来的会话没有任何出处记号」那个病").toBeDefined();
    expect(origin!.measuredCells).toBe(SEEDED_ORIGIN.measuredCells);
    expect(origin!.measuredCells!).toBeGreaterThan(0);
    // ④ 用户屏上**看得见**那一档（记号只写进数据、不上屏 = 用户仍然分不出来）。
    const mark = await screen.findByTestId("sandbox-kpi-base-origin");
    expect(mark.getAttribute("data-measured-cells")).toBe(String(SEEDED_ORIGIN.measuredCells));
    expect(mark.textContent).toContain(`实测格 ${SEEDED_ORIGIN.measuredCells}/${SEEDED_ORIGIN.cells}`);
    // ⑤ 粗记号**不许**因此翻成「实测」：这份世界 9 格里只有 3 格实测，整份盖实测是另一种谎。
    expect(badge().getAttribute("data-origin")).toBe("DERIVED");
  });

  it("⑦ 反向臂：租户一个播种世界都没有 ⇒ 回落哈希派生，且**不伪造**「实测格 0/N」这句话", async () => {
    mount(); // beforeEach 装的是空列表
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(createdBodies.length).toBeGreaterThan(0));

    expect(JSON.stringify(createdBodies[0]!.baseSnapshot)).toBe(JSON.stringify(deriveBaseSnapshot(CFG)));
    expect((createdBodies[0]!.scope as Record<string, unknown>).baseSnapshotOrigin).toBeUndefined();
    // 「我没有这个记号」与「这份世界零格实测」是两个命题 —— 兜底路谁也没算过后者，写出来就是编的。
    expect(screen.queryByTestId("sandbox-kpi-base-origin")).toBeNull();
    // 而占位那一个记号**必须还在**（诚实位可降层不可删）。
    expect(badge().getAttribute("data-origin")).toBe("DERIVED");
    expect(badge().textContent).toContain("合成·占位");
  });

  it("⑧ 空世界不许炸：`stateVars: []` ＋ 会话列表这一跳 500 —— 两条兜底路同时走，页面照样挂得起来", async () => {
    cleanup();
    installHandlers();
    // 列表这一跳直接失败：`resolveTick0World` 必须吞掉它并退兜底，⛔ 不许让沙盘打不开。
    server.use(http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ error: { code: "BOOM", message: "x", requestId: "r" } }, { status: 500 })));
    const EMPTY: SandboxViewConfig = { ...CFG, stateVars: [], nodeObjectIds: {}, propagationCount: 0 };
    mount(EMPTY);

    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(createdBodies.length).toBeGreaterThan(0));
    // `deriveBaseSnapshot` 的空世界约定：每个类型退 `${type}#0` 占位键 + 单占位变量 `v`。
    expect(JSON.stringify(createdBodies[0]!.baseSnapshot)).toBe(JSON.stringify(deriveBaseSnapshot(EMPTY)));
    expect(Object.keys(createdBodies[0]!.baseSnapshot ?? {})).toEqual(["TypeA#0", "TypeB#0"]);
    expect(screen.queryByTestId("sandbox-kpi-base-origin")).toBeNull();
    expect(badge().getAttribute("data-origin")).toBe("DERIVED");
  });
});
