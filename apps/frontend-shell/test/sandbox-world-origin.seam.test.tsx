import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { CellProvenance, SandboxViewConfig, TickState } from "@platform/contracts";
import { server } from "./setup";
import SandboxView from "@/views/sim/SandboxView";

/**
 * ══ WO-V4-HONEST-ORIGIN + WO-SANDBOX-REAL-SNAPSHOT · 顶栏读数**出处记号**门 ═══════════════
 *
 * ── 病历一（仓主截图 · 2026-08-13 · WO-V4-HONEST-ORIGIN）────────────────────────────
 * `deriveBaseSnapshot` 用 `hash01(对象id|变量名)×100` 派生 tick0 世界态。它是**确定性占位**
 * （R6 合规），问题不在数值而在**屏上没有任何记号说它是占位**：全对象取均值必然收敛到 50
 * （大数定律），于是顶栏 16 个读数全落在 49.5–50.4；同屏阻滞点行**有**「合成数据」徽标，
 * 顶栏一个都没有 —— 两者并排，读者只会把没记号的那批读成实测。
 *
 * ── 病历二（WO-SANDBOX-REAL-SNAPSHOT · 本轮）——**上一轮只修了记号，没修数** ──────────
 * 那一轮的结论是「修的是记号，不是数值」。它在当时是对的，但把一个更大的事实留在了原地：
 * **那份世界压根不该由前端造。** 前端没有对象，`deriveBaseSnapshot` 一次 `props` 都不读，
 * 它唯一能做的就是编 —— 编出来的数**长得和真值一模一样**，加个徽标只是让谎话带了张标签。
 *
 * **今天的行为 Y（本轮改完）**：前端**不传** `baseSnapshot`，世界由持有真实对象的服务端派生，
 * 并**逐格**盖 `measured` / `derived` 章。真后端实测（`SEED_DEMO=1`）：
 * 8,813 格中 measured **6,271** / derived **2,542** / unknown **0**。
 *
 * ⇒ 于是诚实位从**二值**变成**四态**：世界真实地是**混合**的，二值化的两种走法都在撒谎 ——
 * 全标「实测」把 2,542 格占位说成真读数；全标「占位」把 6,271 格真读数自毁可信度。
 *
 * ── 判据必须**两向**（PRD §4.3 原话「只咬一向证明不了」）──────────────────────
 * 本门把两向长成了四向（四态各咬一条），外加**两条反向金丝雀**：
 *  ⛔ `derived` 不许被**藏起来**（藏 = 假装那格不存在，与说它是实测一样不诚实）
 *  ⛔ 缺出处不许被**并进 `derived`**（那是拿「我没记」冒充「我记了，它是占位」）
 *
 * ── 🔴 本门要防的那个**具体**假绿（不写下来下一个人一定会踩）──────────────────
 * ① `init()` 建完会话立刻 `qc.setQueryData(["a","sim-world", id], …)`，而该 query 是
 *    `staleTime: Infinity` ⇒ **新建会话的那个 GET 根本不会发**。所以若拿「`worldQuery.data`
 *    到没到」当判据，徽标会在屏上全是占位的那一刻就翻成"实测"。第 ⑥ 条把这个事实钉住。
 * ② 本轮之后 `worldOrigin`（整份哪来的）**恒为 `MEASURED`** —— 世界都是后端给的。
 *    谁把徽标改回读它，屏上就会对着一堆哈希占位写「实测」。第 ② 条的混合世界**全部来自后端**，
 *    若徽标读 `origin` 该用例当场红。
 *
 * R6 确定性：网络全桩，无时钟、无随机。
 */

// ── 证物 ───────────────────────────────────────────────────────────────────────
const worldGets: string[] = [];
/** 建会话请求的 body 原文（**未经 `?? {}` 之类的回填**）—— 第 ① 条要咬「那个键压根不在」。 */
const createBodies: Record<string, unknown>[] = [];

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

/**
 * **服务端派生**的 tick0 世界（形状照真后端 `deriveSeedBaseSnapshot`：真值 + 回落占位混在同一份里）。
 * 刻意取"不像 50"的值：屏上若出现 50 附近那一族，说明它拿的还是哈希派生那一份。
 */
const SERVER_BASE: TickState = {
  obj_a1: { load: 71, risk: 12 },
  obj_a2: { load: 68, risk: 15 },
  obj_b1: { load: 5, risk: 90 },
};
/**
 * 逐格出处：`load` 三格**全实测**；`risk` 两格实测 + 一格回落占位。
 * ⚠ 刻意做成**按变量不均匀**——均匀的话「逐项记号」与「整份徽标」会退化成同一个判据，
 * 逐项那一支就算完全没接线也照样绿（那正是本仓「测的是函数不是链路」那个老病）。
 */
const SERVER_BASE_PROV: CellProvenance = {
  obj_a1: { load: "measured", risk: "measured" },
  obj_a2: { load: "measured", risk: "measured" },
  obj_b1: { load: "measured", risk: "derived" },
};
/** tick 之后的世界（引擎算的）—— 用来证明**出处跟着 tick0 走、不被推拍抹掉**。 */
const SERVER_WORLD: TickState = {
  obj_a1: { load: 81, risk: 22 },
  obj_a2: { load: 78, risk: 25 },
  obj_b1: { load: 15, risk: 99 },
};

/**
 * @param prov 传 **`null`** 模拟「老会话 / 后端没下发出处」那一档（第 ④ 条用）。
 *
 * ⚠ **哨兵是 `null` 不是 `undefined`，这一行踩过坑**：JS 的默认形参对 `undefined` **也会生效** ——
 * 写 `installHandlers(undefined)` 会**静默落回 `SERVER_BASE_PROV`**，于是第 ④ 条（"缺出处"那一档）
 * 实际测的是混合世界，报 `expected 'MIXED' to be 'UNKNOWN'`，而且**看起来像产品有 bug**。
 * 形态与本单要修的那个病同构：
 * **「我用『我传了 undefined』当作『被调方收到了"没有"』的证据，而前者并不度量后者。」**
 * （后端 `createSimSessionWorld` 区分"省略"与"显式 `{}`"，靠的正是不能用 `??` 把两者合并。）
 */
function installHandlers(prov: CellProvenance | null = SERVER_BASE_PROV) {
  server.use(
    http.post("*/a/v1/sim/sessions", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      createBodies.push(body);
      return HttpResponse.json(
        {
          id: "sims_origin", tenantId: "demo", baseSnapshot: SERVER_BASE,
          ...(prov === null ? {} : { baseSnapshotProvenance: prov }),
          scope: (body.scope as Record<string, unknown>) ?? {}, status: "READY", curTick: 0,
          parentCheckpointId: null, createdAt: "2026-08-13T00:00:00.000Z",
        },
        { status: 201 },
      );
    }),
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [] })),
    http.get("*/a/v1/sim/sessions/:id/world", ({ request }) => {
      worldGets.push(request.url);
      // 真后端在 `tick>0` 时照样带 `baseProvenance`（它描述的是**起点**，不是本回包的 state）。
      return HttpResponse.json({
        tick: 3, state: SERVER_WORLD,
        ...(prov === null ? {} : { baseProvenance: prov }),
      });
    }),
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
  createBodies.length = 0;
});
afterEach(() => cleanup());

describe("WO-SANDBOX-REAL-SNAPSHOT · tick0 世界归服务端 + 逐格出处诚实位（四态）", () => {
  it("① 建会话**不传** `baseSnapshot`：那个键在请求 body 里压根不存在（前端不再造世界）", async () => {
    installHandlers();
    mount();
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(createBodies.length).toBeGreaterThan(0));

    const body = createBodies[0]!;
    // ★ 判据落在**键的存在性**上，不是 `body.baseSnapshot` 的真值性：
    //   传 `{}`（"我就是要空世界"）与不传（"你替我派生"）是两个不同的命题，后端据此二分。
    //   写 `!body.baseSnapshot` 的话，传 `{}` 也会绿 —— 那正好是错的那一支。
    expect("baseSnapshot" in body, "前端仍在往上传世界 —— 本单的病根没拔").toBe(false);
    // 🐤 金丝雀（否定结论必须配命中证据，铁律 0.6）：同一个 body 里**该有的键确实有**。
    //   它若也报 false，那是 body 根本没被记下来，上面那个 `false` 什么都证明不了。
    expect("scope" in body, "连 scope 都不在 ⇒ body 没被记下来，上面那条否定结论作废").toBe(true);
  });

  it("② 混合世界：徽标标 `MIXED` 且**两个数都写在屏上** —— 不许二值化", async () => {
    installHandlers();
    mount();
    await screen.findByTestId("sandbox-view");

    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("MIXED"));
    // 5 格实测 + 1 格占位（`obj_b1.risk`）
    expect(badge().getAttribute("data-measured-cells")).toBe("5");
    expect(badge().getAttribute("data-derived-cells")).toBe("1");
    expect(badge().getAttribute("data-unknown-cells")).toBe("0");
    // ⛔ 反向金丝雀：占位那一档**不许被藏起来**（藏 = 假装那格不存在，同样不诚实）。
    expect(badge().textContent, "占位格数没写在屏上 —— 藏起来与说成实测一样不诚实").toContain("1");
    expect(badge().textContent).toContain("占位");
    expect(badge().textContent).toContain("实测");

    // 屏上的读数真的是**后端那一份**（记号换了但数没换 = 记号在说谎）。
    const ids = Object.keys(SERVER_BASE);
    expect(ids.length).toBeGreaterThan(2);
    expect(CFG.stateVars.length).toBeGreaterThan(1); // 基数下限：空集上 for 一次都不进也照样绿
    for (const v of CFG.stateVars) {
      const avg = ids.reduce((a, o) => a + (SERVER_BASE[o]?.[v] ?? 0), 0) / ids.length;
      const shown = screen.queryByTestId(`sandbox-kpi-${v}-val`);
      expect(shown, `stateVar ${v} 的读数不在 DOM 里`).not.toBeNull();
      expect(shown!.textContent).toBe(avg.toFixed(1));
    }
  });

  it("③ **逐项**记号：全实测的项与含占位的项显示**不一样**（不许两档长得一样）", async () => {
    installHandlers();
    mount();
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("MIXED"));

    // `load`：三格全实测 ⇒ MEASURED
    const load = screen.getByTestId("sandbox-kpi-load");
    expect(load.getAttribute("data-origin")).toBe("MEASURED");
    expect(load.getAttribute("data-derived-cells")).toBe("0");
    // `risk`：两格实测 + 一格占位 ⇒ MIXED，且占位数要写出来
    const risk = screen.getByTestId("sandbox-kpi-risk");
    expect(risk.getAttribute("data-origin")).toBe("MIXED");
    expect(risk.getAttribute("data-derived-cells")).toBe("1");
    expect(risk.textContent, "含占位的项没在屏上标出来").toContain("占位");
    // ★ 这一条是本用例的核心：两档**在屏上真的不同**。
    //   只咬 `data-origin` 不够 —— 属性对了而文案一样，用户看到的仍是两个没法分辨的数。
    expect(load.textContent, "全实测项与含占位项文案相同 ⇒ 逐项记号形同虚设").not.toBe(risk.textContent);
    expect(load.textContent).not.toContain("占位");
    // 无障碍口径同样两档分开（屏幕阅读器读到的不许是同一句）。
    expect(load.getAttribute("aria-label")).not.toBe(risk.getAttribute("aria-label"));
  });

  it("④ 缺出处 ⇒ `UNKNOWN`，**不许并进 `derived`**（「我没记」不等于「它是占位」）", async () => {
    installHandlers(null); // 老会话 / 后端没下发逐格出处（哨兵必须是 null，见 installHandlers 头注）
    mount();
    await screen.findByTestId("sandbox-view");

    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("UNKNOWN"));
    expect(badge().getAttribute("data-unknown-cells")).toBe("6");
    expect(badge().getAttribute("data-derived-cells"), "缺出处被并进了 derived —— 拿「我没记」冒充「它是占位」").toBe("0");
    expect(badge().getAttribute("data-measured-cells")).toBe("0");
    expect(badge().textContent).toContain("未知");
    // ⛔ 两向：不许在未知态说实测，也不许在未知态说占位（两者都是把未知伪装成已知）。
    expect(badge().textContent).not.toContain("实测");
    expect(badge().textContent).not.toContain("合成·占位");
  });

  it("⑤ 全实测世界 ⇒ `MEASURED`，且**占位字样一个都不出现**（反向：不许永远说占位）", async () => {
    installHandlers({
      obj_a1: { load: "measured", risk: "measured" },
      obj_a2: { load: "measured", risk: "measured" },
      obj_b1: { load: "measured", risk: "measured" },
    });
    mount();
    await screen.findByTestId("sandbox-view");

    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("MEASURED"));
    expect(badge().getAttribute("data-measured-cells")).toBe("6");
    expect(badge().getAttribute("data-derived-cells")).toBe("0");
    expect(badge().textContent).toContain("实测");
    expect(badge().textContent, "全实测还在说占位 = 另一种谎（自毁可信度那一支）").not.toContain("占位");
  });

  it("⑥ 判据不能用「`worldQuery.data` 到没到」—— 新建会话时那个 GET **一次都不会发**", async () => {
    installHandlers();
    mount();
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("MIXED"));

    // ★ 否定结论先立：页面这一侧一次都没发过 `GET …/world`
    //   （`init` 用 setQueryData 塞了世界 + `staleTime: Infinity` ⇒ 那个 query 已是 fresh）。
    const fromPage = worldGets.length;
    expect(fromPage).toBe(0);

    // 🐤 金丝雀（**必须在否定结论之后立刻给**，铁律 0.6）：同一个 handler 在已知必中那一面要记账。
    await fetch("http://localhost/a/v1/sim/sessions/sims_origin/world");
    expect(worldGets.length, "handler 自己不记账 ⇒ 上面那个「0 次」证明不了任何事").toBeGreaterThan(fromPage);
  });

  it("⑦ 推进 tick（引擎算的世界）后，tick0 的出处**仍在屏上** —— 不许被推拍抹掉", async () => {
    const user = userEvent.setup();
    installHandlers();
    mount();
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("MIXED"));

    await user.click(screen.getByTestId("sandbox-tick-btn"));

    // 读数换成引擎那一份（tick 真的推了）。
    const ids = Object.keys(SERVER_WORLD);
    const avgLoad = ids.reduce((a, o) => a + (SERVER_WORLD[o]?.load ?? 0), 0) / ids.length;
    await waitFor(() => expect(screen.getByTestId("sandbox-kpi-load-val").textContent).toBe(avgLoad.toFixed(1)));

    // ★ 而起点的出处**没被抹掉**：一条从占位起跑的链，算到第 3 拍依旧是从占位起跑的。
    //   把它在 tick>0 时丢掉，等于让用户以为推演结果比它的起点更可信。
    expect(badge().getAttribute("data-origin")).toBe("MIXED");
    expect(badge().getAttribute("data-derived-cells")).toBe("1");
  });

  it("⑧ 事件驱动重取（真 GET 回来的那一份）出处照样在 —— 跟着数据走，不跟着某一个入口走", async () => {
    installHandlers();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SandboxView injectedConfig={CFG} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("MIXED"));

    // 模拟 `sim.tick_completed` 到达 → invalidateForEvent 把这个 key 标脏 → 真重取。
    await qc.invalidateQueries({ queryKey: ["a", "sim-world", "sims_origin"] });
    await waitFor(() => expect(worldGets.length).toBeGreaterThan(0));
    await waitFor(() => expect(badge().getAttribute("data-origin")).toBe("MIXED"));
    expect(badge().getAttribute("data-derived-cells")).toBe("1");
  });
});
