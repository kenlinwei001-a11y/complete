import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { CHAIN_NODE_REGISTRY } from "@platform/contracts";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";
import { PROCESS_DEFINITIONS_RESPONSE, processInspectFixture } from "@/mocks/processWaitFixtures";
import { CANVAS_MODES } from "@/views/sim/sandboxConsoleModel";
import { chainLayerOverlap, chainLayerOverlapCanaryKey } from "@/views/sim/processCanvas";
import { ChainLossPayloadSchema, type ChainLossPayload } from "@/views/sim/chainLineMap";

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WO-SANDBOX-PROCESS-MODE · 主画布**第五档「业务流程」** —— SEAM 门
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ── 这道门守的命题 ───────────────────────────────────────────────────────────
 * 仓主原话：「点击每个 node 后展示与其他 node ＋ node 内部 sub-node 的**完整本体关系**」
 * 「右侧节点要**完整**」。上一轮把这件事判成「两层不能合并 ⇒ 只能放在别的页」——
 * 那是**读错了约束**：契约 `process.ts` 说的是两个**数据模型**不能互相顶替、不能揉成一张表，
 * 它没有说两层不能同屏。本门就是把「同屏」与「不同模型」这两件事**同时**钉死：
 *
 *  · **同屏**（§B）：从真实路由 `/v/sim-sandbox` 进 → 切第五档 → 点一条流程 → 检视面板出内容。
 *  · **不同模型**（§C · 本单的结构红线）：第五档渲染出来的键集合 ∩ `CHAIN_NODE_REGISTRY`
 *    的 24 个冻结 nodeId **= ∅**。这一条红了就说明有人把两层揉了。
 *
 * ── 咬的是**链路**不是组件 ───────────────────────────────────────────────────
 * 一律 `renderApp("/v/sim-sandbox")`：经真路由表 → `SimSandboxGuard` entitlement 闸 →
 * 懒加载 → `SandboxView` → `SandboxConsole` → 第五档 → MSW。
 * 直接 `render(<ProcessCanvasView/>)` 只证明「拿到组件能画」，不证明「有任何路径能让你拿到它」
 * ——本仓记过的假绿第 9 形态（`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）。
 *
 * ── 条数**不写死** ───────────────────────────────────────────────────────────
 * 本文件通篇没有 `65`（也没有 `11`）。判据是**恒等式**：
 * 「屏上渲染的流程卡数」== 「本次响应里 `definitions` 的条数」，
 * 而后者由**本文件自己装的那个 handler 现场记账**（`served`）—— 它就是端点这一次真发出去的数。
 * 把金值抄进测试 = 种子一变就假红/假绿（本仓 #99 的老坑）。
 *
 * ── 诚实位守恒（§D）─────────────────────────────────────────────────────────
 * 加第五档最容易顺手弄坏的，是前四档各自带的诚实标记。故本门**逐档**咬一个只有那一档能产生的
 * 标志物，并且是在**切到第五档之后**咬 —— 「切档时被卸载了」与「从来没渲染过」在屏上长得一样，
 * 只在切之前咬等于没咬。
 *
 * R6 确定性：网络全桩（MSW + 本文件 `server.use` 覆盖），无时钟、无随机。
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

/** 线路图那一档要的真实引擎载荷（与既有门共用同一份 fixture，不另造一套）。 */
const REAL_LOSS: ChainLossPayload = ChainLossPayloadSchema.parse(
  JSON.parse(readFileSync(join(TEST_DIR, "fixtures/chain-loss-real.json"), "utf8")),
);

/**
 * 本次响应的**记账本**：`served` 是端点这一次真的发出去了几条。
 * 断言拿它与屏上卡片数比 —— 两边都是现算的，中间没有任何写死的数。
 */
const ledger = { served: -1, calls: 0, inspectCalls: [] as string[] };

function installHandlers() {
  ledger.served = -1;
  ledger.calls = 0;
  ledger.inspectCalls = [];
  server.use(
    // ① 第五档的取数 —— 同时记账「这次发了几条」
    http.get("*/a/v1/process-definitions", () => {
      ledger.calls += 1;
      ledger.served = PROCESS_DEFINITIONS_RESPONSE.definitions.length;
      return HttpResponse.json(PROCESS_DEFINITIONS_RESPONSE);
    }),
    // ② 检视面板的取数 —— 记下被点开的是哪条（证明点击真的驱动了这条链，而不是面板自己乱取）
    http.get("*/a/v1/process-definitions/:key/inspect", ({ params }) => {
      ledger.inspectCalls.push(String(params.key));
      return passthroughInspect(String(params.key));
    }),
    // ③ 线路图档的引擎载荷（MSW 默认 handlers 里没有 `chain_loss_attribution` 的桩；
    //    不补它线路图会落 `clm-engine-error`，AND≠OR 警示那条诚实位就无从谈起）
    http.post("*/b/v1/solvers/chain_loss_attribution/run", () =>
      HttpResponse.json({ data: REAL_LOSS, snapshotVersion: "ov-process-mode" }),
    ),
  );
}

/** 检视响应仍走 mock 那一份 `processInspectFixture`（不另造一套数据），本文件只负责记账。 */
function passthroughInspect(key: string) {
  const body = processInspectFixture(key);
  if (body === null) {
    return HttpResponse.json({ error: { code: "NOT_FOUND", message: "no fixture", requestId: "req_t" } }, { status: 404 });
  }
  return HttpResponse.json(body);
}

/** 真路由进沙盘，等控制台落地（懒加载 ＋ 两个求解器，故给足超时）。 */
async function enterSandbox(): Promise<void> {
  renderApp("/v/sim-sandbox");
  await waitFor(() => expect(screen.getByTestId("sandbox-view")).toBeTruthy(), { timeout: 20000 });
  await waitFor(() => expect(screen.getByTestId("sandbox-console")).toBeTruthy(), { timeout: 20000 });
}

/** 切到第五档并等它把台账取回来。 */
async function openProcessMode(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByTestId("sc-mode-process"));
  return await screen.findByTestId("spc-board", undefined, { timeout: 20000 });
}

/** 屏上这一刻真的渲染出来的流程键（现算，不写清单）。 */
function renderedProcessKeys(): string[] {
  return screen
    .getAllByTestId(/^spc-card-/)
    .map((el) => el.getAttribute("data-process-key") ?? "")
    .filter((k) => k.length > 0);
}

/** 屏上每座站的几何 + 归属（现算；`data-*` 是本档唯一的受控读数出口，见组件头浮层纪律）。 */
function renderedStations(): { key: string; cx: number; cy: number; r: number; days: number; lane: string; interchange: boolean }[] {
  return screen.getAllByTestId(/^spc-card-/).map((g) => {
    const circle = g.querySelector("circle:not([class*='Halo'])");
    // 站必须真是个圆（线路图的图元），不是一个被 CSS 画圆的 div —— 那是卡片墙换皮。
    const lane = g.closest("[data-testid^='spc-lane-']");
    return {
      key: g.getAttribute("data-process-key") ?? "",
      cx: Number(circle?.getAttribute("cx") ?? Number.NaN),
      cy: Number(circle?.getAttribute("cy") ?? Number.NaN),
      r: Number(g.getAttribute("data-r") ?? Number.NaN),
      days: Number(g.getAttribute("data-std-days") ?? Number.NaN),
      lane: lane?.getAttribute("data-testid")?.replace("spc-lane-", "") ?? "",
      interchange: g.getAttribute("data-interchange") === "1",
    };
  });
}

beforeEach(() => {
  loginAs("planner");
  installHandlers();
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════════
// §A 金丝雀 —— 报否定结论之前先自证工具与数据源是好的（铁律 0.6）
// ══════════════════════════════════════════════════════════════════════════════

describe("§A 金丝雀（不中就报「工具坏了」，不许报「代码干净」）", () => {
  it("A1 · 交集函数**真的能检出重叠** —— 喂一个已知必中的 nodeId 进去必须报重叠", () => {
    const canary = chainLayerOverlapCanaryKey();
    expect(canary.length, "契约的 CHAIN_NODE_REGISTRY 是空的 ⇒ 契约坏了，不是两层不相交").toBeGreaterThan(0);
    // 关键：不先证明这个函数会「说有」，那么它后面说「没有」就一文不值 ——
    // 一个恒返回空数组的实现同样能让 §C 全绿。
    expect(chainLayerOverlap([canary]), "交集函数对已知必中的样例都报不出重叠 ⇒ 它坏了").toEqual([canary]);
    expect(chainLayerOverlap([canary, "P01"])).toEqual([canary]);
  });

  it("A2 · 本次 fixture 真有多条流程、真跨多个域，且真有一对**共用承载物**的流程", () => {
    const defs = PROCESS_DEFINITIONS_RESPONSE.definitions;
    expect(defs.length, "fixture 一条流程都没有 ⇒ 下面每条断言都在空集合上跑，恒真恒绿").toBeGreaterThan(1);
    expect(new Set(defs.map((d) => d.domainKey)).size, "全部流程挤在一个域里 ⇒ 分泳道的断言等于没断言").toBeGreaterThan(1);
    const shared = defs.filter((d) => defs.some((o) => o.key !== d.key && o.carrierTypeKey === d.carrierTypeKey));
    expect(shared.length, "没有任何一对共用承载物的流程 ⇒「同承载物流程」那条本体关系在空集合上跑").toBeGreaterThan(1);
  });

  it("A3 · 第五档真的登记进了画布档位表（不是我在测一个没接线的组件）", () => {
    expect(CANVAS_MODES).toContain("process");
    // 前四档一个都没被顶掉 —— 加档不是换档
    for (const m of ["metro", "topo", "chain", "ontology"]) expect(CANVAS_MODES).toContain(m);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §B 接缝：真路由 → 第五档 → 点一条 → 检视面板出内容
// ══════════════════════════════════════════════════════════════════════════════

describe("§B 接缝驱动（从 URL 出发，不是直接渲染组件）", () => {
  it("B1 · /v/sim-sandbox → 切「业务流程」→ 台账真上屏，且**渲染条数 == 端点下发条数**", async () => {
    const user = userEvent.setup();
    await enterSandbox();

    // 切档之前：第五档一个请求都不发（懒挂载，与其余四档同一机制）
    expect(ledger.calls, "还没切到第五档就已经取了台账 ⇒ 懒挂载失效，白花一次请求").toBe(0);

    const board = await openProcessMode(user);
    await waitFor(() => expect(ledger.calls).toBe(1), { timeout: 20000 });

    const keys = renderedProcessKeys();
    // ⚠ 判据是**恒等式**，不是某个金值：左边现数 DOM，右边是端点这次真发出去的条数。
    expect(ledger.served, "记账本没记到 ⇒ handler 没被打到，下面比的是两个空数").toBeGreaterThan(0);
    expect(keys.length, "屏上渲染的流程条数 ≠ 端点下发的条数 ⇒ 本档漏画了流程").toBe(ledger.served);
    // 键不重复：同一条流程画两遍也能凑够条数，那是另一种"看起来对"
    expect(new Set(keys).size).toBe(keys.length);
    // 屏上那两个数也必须自洽（诚实位 ①）
    const counts = screen.getByTestId("spc-counts");
    expect(counts.getAttribute("data-total")).toBe(String(ledger.served));
    expect(counts.getAttribute("data-laid")).toBe(String(ledger.served));
    expect(screen.queryByTestId("spc-count-mismatch"), "下发 ≠ 铺开的报警亮了").toBeNull();
    // 泳道真的按域分了（不是一锅端）
    expect(within(board).getAllByTestId(/^spc-lane-/).length).toBeGreaterThan(1);
  }, 90000);

  it("B2 · 点一条流程 → 右栏出 ProcessInspectPanel，且内容是**这一条**的完整本体关系", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);

    // 挑一条**真有同承载物兄弟**的流程 —— 那条关系是本面板最值得当场看见的一条，
    // 且挑法是现算的（不写死 key），fixture 换了也仍然挑得到。
    const defs = PROCESS_DEFINITIONS_RESPONSE.definitions;
    const target = defs.find((d) => defs.some((o) => o.key !== d.key && o.carrierTypeKey === d.carrierTypeKey));
    expect(target, "金丝雀 A2 说有，这里却挑不到 ⇒ 挑法坏了").toBeDefined();
    const sibling = defs.find((o) => o.key !== target!.key && o.carrierTypeKey === target!.carrierTypeKey)!;

    await user.click(screen.getByTestId(`spc-card-${target!.key}`));

    const panel = await screen.findByTestId("pi-panel", undefined, { timeout: 20000 });
    // 面板确实是为**这一条**开的（不是随便哪条都能让门变绿）
    expect(panel.getAttribute("data-process")).toBe(target!.key);
    expect(ledger.inspectCalls, "面板出现了，却没有人去要过它的本体投影 ⇒ 那是一张静态皮").toContain(target!.key);
    expect(within(panel).getByTestId("pi-name")).toHaveTextContent(target!.name);
    expect(within(panel).getByTestId("pi-carrierkey")).toHaveTextContent(target!.carrierTypeKey);
    // 「node 内部 sub-node 的完整本体关系」——这一条的同承载物流程真被反查出来
    expect(within(panel).getByTestId(`pi-sibling-${sibling.key}`)).toHaveTextContent(sibling.name);
    // 右栏顶上标的是流程键（不是 nodeId）
    expect(screen.getByTestId("sc-inspect-process-key")).toHaveTextContent(target!.key);
    // 完整本体关系的七个区块**都在**（不是只画了个标题）
    for (const block of ["pi-process", "pi-runtime", "pi-carrier", "pi-relations", "pi-shared", "pi-levers", "pi-layers"]) {
      expect(within(panel).getByTestId(block), `检视面板缺区块 ${block} ⇒ 「完整」这两个字不成立`).toBeTruthy();
    }
  }, 90000);

  it("B3 · 换一条流程 → 面板跟着换（不是第一次点完就钉死）", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);
    const keys = renderedProcessKeys();
    expect(keys.length).toBeGreaterThan(1);

    await user.click(screen.getByTestId(`spc-card-${keys[0]}`));
    await waitFor(() => expect(screen.getByTestId("pi-panel").getAttribute("data-process")).toBe(keys[0]), { timeout: 20000 });
    await user.click(screen.getByTestId(`spc-card-${keys[1]}`));
    await waitFor(() => expect(screen.getByTestId("pi-panel").getAttribute("data-process")).toBe(keys[1]), { timeout: 20000 });
    expect(ledger.inspectCalls).toEqual(expect.arrayContaining([keys[0]!, keys[1]!]));
  }, 90000);
});

// ══════════════════════════════════════════════════════════════════════════════
// §C ⛔ 结构红线：两层同屏，但**不许同模型**
// ══════════════════════════════════════════════════════════════════════════════

describe("§C 结构红线（这一条红了 = 有人把两层揉了）", () => {
  it("C1 · 第五档渲染的键集合 ∩ CHAIN_NODE_REGISTRY 的 24 个 nodeId = ∅", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);

    const keys = renderedProcessKeys();
    expect(keys.length, "一张卡都没渲染 ⇒ 下面的交集恒为空，这条断言会假绿").toBeGreaterThan(0);
    // `Set<string>` 而不是 `Set<字面量联合>`：字面量联合会让 `has(任意 string)` 编译不过，
    // 而**编译不过**与「交集为空」是两回事 —— 前者会诱使人把这条断言删掉了事。
    const nodeIds = new Set<string>(CHAIN_NODE_REGISTRY.map((n) => n.nodeId));
    expect(nodeIds.size, "冻结注册表是空的 ⇒ 交集恒空，断言无意义").toBeGreaterThan(0);

    const overlap = keys.filter((k) => nodeIds.has(k));

    /**
     * **同源判据**（这一条是写变异反证时补的，它咬的东西与下面两条都不一样）：
     * 屏上 `spc-disjoint` 那个数，必须等于**现数 DOM** 得到的交集大小。
     *
     * 为什么单独立一条：原实现按**响应**算交集，而屏上那句话声称度量的是
     * 「本档渲染出来的键」。两者今天恒等 ⇒ 谁也发现不了。把一个冻结 nodeId
     * 在**渲染时**混进来（变异体 2）就会分家：DOM 里有交集、屏上照样写 0。
     * 那正是「我用 X 当作 Y 的证据，而 X 并不度量 Y」。
     * ⚠ 注意这条在变异体下**必须仍然绿**（1 == 1）—— 它证明的是"两个数同源"，
     * 不是"没有交集"；判"有没有交集"是下面那条的事。两条各咬各的，别合并。
     */
    expect(
      screen.getByTestId("spc-disjoint").getAttribute("data-overlap"),
      "屏上写的交集数 ≠ 现数 DOM 得到的交集数 ⇒ 屏上那句诚实位度量的不是屏上画的东西",
    ).toBe(String(overlap.length));

    expect(
      overlap,
      `业务流程层的键与链路节拍层的冻结 nodeId 出现交集：${overlap.join("、")} —— ` +
        "契约 process.ts 文件头明写两层「不能互相替代，也不能合并」。同屏是可以的，同模型不行。",
    ).toEqual([]);

    // 屏上那个数也必须是 0（诚实位与断言同源：它红了，屏上那句话就已经在骂人了）
    expect(screen.getByTestId("spc-disjoint").getAttribute("data-overlap")).toBe("0");
  }, 90000);

  it("C2 · 两层的**选中态互不写入**：切档来回一趟，各自选中的还是各自那个", async () => {
    const user = userEvent.setup();
    await enterSandbox();

    // 先在链路阶段档选一个节拍节点（那一档的选中态是 nodeId）
    await user.click(screen.getByTestId("sc-mode-chain"));
    const nodeIdEl = await screen.findByTestId("sc-inspect-node-id", undefined, { timeout: 20000 });
    const pickedNodeId = nodeIdEl.textContent ?? "";
    expect(pickedNodeId.length, "链路阶段档没有任何选中节点 ⇒ 这条断言在空态上跑").toBeGreaterThan(0);

    // 切到第五档选一条流程（那一档的选中态是 processKey）
    await openProcessMode(user);
    const keys = renderedProcessKeys();
    await user.click(screen.getByTestId(`spc-card-${keys[0]}`));
    await screen.findByTestId("pi-panel", undefined, { timeout: 20000 });
    // 第五档在场时，节拍层的检视器**不在 DOM**（右栏是另一层的面板，不是两层叠在一起）
    expect(screen.queryByTestId("sc-tab-steps"), "第五档右栏还挂着节拍层的页签 ⇒ 两层被塞进同一个检视器").toBeNull();
    expect(screen.getByTestId("sc-inspect-pane").getAttribute("data-layer")).toBe("process");

    // 切回链路阶段档：刚才那个节拍节点**没被流程键覆盖**
    await user.click(screen.getByTestId("sc-mode-chain"));
    await waitFor(() => expect(screen.getByTestId("sc-inspect-pane").getAttribute("data-layer")).toBe("chain"), { timeout: 20000 });
    expect(
      screen.getByTestId("sc-inspect-node-id"),
      "切了一趟第五档之后节拍层的选中态变了 ⇒ 两个选中态互相写入了（= 两层共用一个 state）",
    ).toHaveTextContent(pickedNodeId);
  }, 90000);
});

// ══════════════════════════════════════════════════════════════════════════════
// §D 诚实位守恒 —— 加一档不许弄丢前四档任何一条诚实标记
// ══════════════════════════════════════════════════════════════════════════════

describe("§D 诚实位（在**切到第五档之后**咬，否则等于没咬）", () => {
  it("D1 · 前四档各自的诚实标记，在第五档在场时仍在 DOM 里", async () => {
    const user = userEvent.setup();
    await enterSandbox();

    // 逐档访问一次（这几档是懒挂载的，没进去过就不在 DOM —— 那不叫"丢了"）
    await screen.findByTestId("sc-slot-metro", undefined, { timeout: 20000 });
    await user.click(screen.getByTestId("sc-mode-topo"));
    await screen.findByTestId("phys-topo-placeholder-banner", undefined, { timeout: 20000 });
    await user.click(screen.getByTestId("sc-mode-chain"));
    await screen.findByTestId("sc-chain-coverage-brief", undefined, { timeout: 20000 });

    // 切到第五档 —— 现在逐条查前四档的标志物是否还在
    await openProcessMode(user);

    // ① 线路图：AND ≠ OR 警示（隐喻误读的诚实位）
    expect(screen.getByTestId("clm-and-or-warning"), "线路图的 AND≠OR 警示丢了").toBeTruthy();
    // ① 线路图：EMPTY 停运站位（「算不出来」必须一直看得见，不许被当成 0）
    expect(screen.getAllByTestId(/^clm-suspended-/).length, "线路图的 EMPTY 停运站位一个都没有").toBeGreaterThan(0);
    // ② 物理拓扑：「格内数值为占位值」横幅（跨视图契约，见该组件注释）
    expect(screen.getByTestId("phys-topo-placeholder-banner")).toHaveTextContent("占位值");
    // ③ 链路阶段：在册 ≠ 有数据
    expect(screen.getByTestId("sc-chain-coverage-brief")).toHaveTextContent("在册");
    // ④ 本体拓扑：档位按钮仍在（它的内容由宿主下发，档位本身不许被第五档顶掉）
    expect(screen.getByTestId("sc-mode-ontology")).toBeTruthy();
    expect(screen.getByTestId("sc-slot-ontology")).toBeTruthy();
  }, 120000);

  it("D2 · 第五档自己的诚实位：条数现算 / 标准工期 ≠ 实测 / 两层口径说明 / 运行态缺席理由", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);

    // ① 条数现算（两个数都印在屏上，且不是写死的）
    expect(screen.getByTestId("spc-counts")).toHaveTextContent("现算");
    // ② 标准工期不是实测滞留
    expect(screen.getByTestId("spc-stddays-caveat")).toHaveTextContent("标准工期");
    // ③ 两层为何能同屏、又为何不合并 —— 口径降进浮层但**没被删**（`?` 触发器在第一层）
    expect(screen.getByTestId("info-process-layers")).toBeTruthy();
    await user.click(screen.getByTestId("info-process-layers"));
    expect(await screen.findByTestId("spc-layers-note", undefined, { timeout: 20000 })).toHaveTextContent("不能互相替代");

    // ④ 运行态缺席理由：照后端原样显示，前端不写第二份会过期的说明
    const keys = renderedProcessKeys();
    await user.click(screen.getByTestId(`spc-card-${keys[0]}`));
    const panel = await screen.findByTestId("pi-panel", undefined, { timeout: 20000 });
    const runtime = within(panel).getByTestId("pi-runtime");
    expect(runtime.getAttribute("data-runtime-available"), "运行态被标成「可用」⇒ 拿标准工期冒充了实测").toBe("0");
    expect(within(panel).getByTestId("pi-runtime-reason").textContent ?? "").not.toHaveLength(0);
    expect(within(panel).getAllByRole("listitem").length).toBeGreaterThan(0);
  }, 120000);

  /**
   * D3 · **原生 tooltip 棘轮的补漏**（`docs/CONVENTION-ui-information-layering.md` §2 R-UI-3）。
   *
   * `sandbox-ui-integrate.seam` 的全屏棘轮数的是**当前 DOM 里**的 `[title]` 总数，
   * 而画布各档是**懒挂载**的 —— 那道门从没切到第五档，于是第五档里新增多少个原生 tooltip
   * 它都数不到，照样绿。**这正是本仓铁律 0.6 那句「我用 X 当作 Y 的证据，而 X 并不度量 Y」**：
   * 用「棘轮绿」当作「没新增原生 tooltip」的证据，而前者在懒挂载的档位上并不度量后者。
   * 故本条在**第五档真的挂出来之后**再数一次，把这个洞补上。
   */
  it("D3 · 第五档挂出来之后，本档**零原生 tooltip**（懒挂载会让全屏棘轮数不到这一档）", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const board = await openProcessMode(user);
    // 先自证判据咬得住：全屏范围内确实存在带 title 的元素（否则下面是在对空集恒真）
    expect(
      screen.getByTestId("sandbox-view").querySelectorAll("[title]").length,
      "全屏一个 [title] 都没有 ⇒ 这条断言没咬到东西（工具坏了，不是本档干净）",
    ).toBeGreaterThan(0);
    expect(
      board.querySelectorAll("[title]").length,
      "第五档里出现了原生 tooltip —— 规范 §2 R-UI-3 明令禁止（不受控 · 永远画在最上层 · 移开滞留）。要说明就用 InfoPopover。",
    ).toBe(0);
    expect(board.querySelectorAll("svg title").length, "SVG <title> 是 2026-08-10 那次遮挡事故的直接成因").toBe(0);
  }, 90000);
});

// ══════════════════════════════════════════════════════════════════════════════
// §E D4 守恒 —— 这是**新增一档**，不是把别处的东西搬走
// ══════════════════════════════════════════════════════════════════════════════

describe("§E D4 守恒（新增 ≠ 搬走）", () => {
  it("E1 · 「流程等待态」页仍然可达、仍然能点开同一个检视面板", async () => {
    const user = userEvent.setup();
    renderApp("/v/process-wait");
    const btns = await screen.findAllByTestId(/^pw-inspect-P/, undefined, { timeout: 20000 });
    expect(btns.length, "流程等待态页一个检视入口都没有 ⇒ 这一页被搬空了（D4 守恒破）").toBeGreaterThan(0);
    await user.click(btns[0]!);
    expect(await screen.findByTestId("pi-panel", undefined, { timeout: 20000 })).toBeTruthy();
  }, 90000);

  it("E2 · 沙盘前四档一个都没被顶掉（档位按钮 ＋ 槽位逐个还在）", async () => {
    await enterSandbox();
    for (const m of ["metro", "topo", "chain", "ontology", "process"]) {
      expect(screen.getByTestId(`sc-mode-${m}`), `档位按钮 sc-mode-${m} 不见了`).toBeTruthy();
      expect(screen.getByTestId(`sc-slot-${m}`), `画布槽位 sc-slot-${m} 不见了`).toBeTruthy();
    }
    // 档位数 == 登记表长度（加档必须过登记表，不许在渲染处随手多画一个）
    expect(screen.getAllByTestId(/^sc-mode-/).length).toBe(CANVAS_MODES.length);
  }, 90000);
});

// ══════════════════════════════════════════════════════════════════════════════
// §F WO-R9-METRO-UX · **形**必须是地铁线路图，且线**不许臆造顺序**
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ── 这一节守的命题 ───────────────────────────────────────────────────────────
 * 仓主看到第五档真屏后的原话：「**没有看到类似『地铁线路』的 UX**」。
 * §B/§C/§D 全绿的那一版就是卡片墙 —— 说明**既有断言一条都没有度量"形"**。
 * 照铁律 0.6 的句式：「我用『条数对、能点开、诚实位在』当作『形对』的证据，
 * 而前者并不度量后者。」故本节把"形"变成可被机器咬的判据：
 * 站是**圆**、有**坐标**、连在**轨**上、轨上标着**依据档位**。
 *
 * ── 更要紧的那一半：不许臆造顺序 ─────────────────────────────────────────────
 * 派单原话：「**编一个看起来像流程的顺序，比卡片墙更坏** —— 它看着专业，
 * 但那个顺序不会因为现实变化而变」。故 F2/F3 咬的不是"画得好看"，是
 * **每一条画出来的关系都必须能在响应里指出它的出处**：
 *  · 轨（同线相邻）只表示排版序 ⇒ 必须标 `display-order`，且两端必须同域；
 *  · 换乘弧只由**共用承载物**产生 ⇒ 两端在响应里的 `carrierTypeKey` 必须真的相等。
 * 任何一条连线指不出出处，就是编的。
 */
describe("§F 线路图之形 + 连线必须有出处（这一节红了 = 又画回卡片墙，或顺序是编的）", () => {
  it("F1 · 是 SVG 线路图：站是**圆**、有画布坐标，且站数 == 端点下发条数", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const board = await openProcessMode(user);

    const stage = within(board).getByTestId("spc-stage");
    expect(stage.tagName.toLowerCase(), "第五档的画布不是 <svg> ⇒ 又是 DOM 卡片墙换皮，不是线路图").toBe("svg");

    const stations = renderedStations();
    expect(stations.length, "一座站都没有 ⇒ 下面每条几何断言都在空集合上跑，恒真恒绿").toBeGreaterThan(0);
    // 判据仍是**恒等式**（不是金值）：屏上站数 == 端点这次真发出去的条数
    expect(ledger.served).toBeGreaterThan(0);
    expect(stations.length, "屏上站数 ≠ 端点下发条数 ⇒ 本档漏画了流程").toBe(ledger.served);

    for (const s of stations) {
      expect(Number.isFinite(s.cx) && Number.isFinite(s.cy), `站 ${s.key} 没有画布坐标 ⇒ 它不在一条线上，只是个 DOM 块`).toBe(true);
      expect(s.r, `站 ${s.key} 半径不是正数 ⇒ 站圈没画出来`).toBeGreaterThan(0);
    }

    // 轨真的存在（有 ≥2 站的线就必须有段）——只有站没有线，那是散点图不是线路图
    expect(screen.getAllByTestId(/^spc-seg-/).length, "一段轨都没有 ⇒ 站之间没有连线，这不是线路图").toBeGreaterThan(0);

    // 同一行相邻两站的圆**不重叠**（几何只算不量：圆心距 > 两半径之和）
    const byLaneRow = new Map<string, typeof stations>();
    for (const s of stations) {
      const k = `${s.lane}#${s.cy}`;
      const b = byLaneRow.get(k);
      if (b === undefined) byLaneRow.set(k, [s]);
      else b.push(s);
    }
    for (const group of byLaneRow.values()) {
      const ordered = [...group].sort((a, b) => a.cx - b.cx);
      for (let i = 1; i < ordered.length; i += 1) {
        const a = ordered[i - 1]!;
        const b = ordered[i]!;
        expect(b.cx - a.cx, `站 ${a.key} 与 ${b.key} 的圆压在一起（圆心距 ${b.cx - a.cx} ≤ ${a.r + b.r}）`).toBeGreaterThan(a.r + b.r);
      }
    }
  }, 90000);

  it("F2 · 轨只表示**排版序**：每段都标 display-order，且两端必属**同一条线**（跨域连线 = 臆造端到端顺序）", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);

    // ① 屏上的依据档位必须是 display-order —— 端点没下发先后（processCanvas.ts §0 有结构证明）
    expect(
      screen.getByTestId("spc-order-basis").getAttribute("data-basis"),
      "站序依据被标成了 measured，但本档端点根本没下发实测站序 ⇒ 那是造假",
    ).toBe("display-order");

    // ② 逐段验出处：标了档位 + 两端同域
    const laneOf = new Map(PROCESS_DEFINITIONS_RESPONSE.definitions.map((d) => [d.key, d.domainKey] as const));
    const segs = screen.getAllByTestId(/^spc-seg-/);
    expect(segs.length).toBeGreaterThan(0);
    for (const seg of segs) {
      expect(seg.getAttribute("data-order-basis"), "有一段轨没标依据档位 ⇒ 读的人会当它是流向").toBe("display-order");
      const [from, to] = (seg.getAttribute("data-testid") ?? "").replace("spc-seg-", "").split("-");
      expect(
        laneOf.get(String(from)),
        `轨 ${from}→${to} 跨了业务域 —— 端点没下发任何跨域先后关系，这条线是编的`,
      ).toBe(laneOf.get(String(to)));
    }

    // ③ 「为什么是虚线」的取证与两个实测反例进了浮层，且**没被删**（触发器在第一层）
    expect(screen.getByTestId("info-process-order-basis")).toBeTruthy();
    await user.click(screen.getByTestId("info-process-order-basis"));
    expect(await screen.findByTestId("spc-order-basis-note", undefined, { timeout: 20000 })).toHaveTextContent("strictObject");
    expect(screen.getByTestId("spc-order-basis-why"), "「编号相邻 ≠ 先后」的实测反例被删了").toHaveTextContent("P43");
    expect(screen.getByTestId("spc-order-basis-where"), "「实测站序在哪」的复验探针被删了").toHaveTextContent("flow-rules.ts");
  }, 90000);

  it("F3 · 换乘弧的出处唯一 = **共用承载物**：两端在响应里的 carrierTypeKey 必须真的相等", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);

    const defs = PROCESS_DEFINITIONS_RESPONSE.definitions;
    const carrierOf = new Map(defs.map((d) => [d.key, d.carrierTypeKey] as const));
    // 现算「应该有几座换乘站」：承载物被 >1 条流程用的那些流程（金丝雀 A2 已证 fixture 里真有）
    const expectInterchange = new Set(
      defs.filter((d) => defs.some((o) => o.key !== d.key && o.carrierTypeKey === d.carrierTypeKey)).map((d) => d.key),
    );
    expect(expectInterchange.size, "fixture 里没有共用承载物的流程 ⇒ 这条断言在空集合上跑").toBeGreaterThan(1);

    // 屏上标成换乘的那批，必须与现算的那批**一模一样**（多标 = 编关系，少标 = 漏画关系）
    const onScreen = new Set(renderedStations().filter((s) => s.interchange).map((s) => s.key));
    expect([...onScreen].sort(), "屏上的换乘站集合 ≠ 现算的共用承载物流程集合").toEqual([...expectInterchange].sort());

    // ⚠ 弧的 testid 命名空间是 `spc-ic-` 而不是 `spc-interchange-`：后者会把说明段
    //   `spc-interchange-note` 一起捞进来，于是下面"逐条验出处"会去查一个叫 note 的流程键。
    //   写这条断言时**当场撞到过**，故把坑连同理由留在这里（第 2 次就该建机制，见铁律 0.6）。
    const arcs = screen.getAllByTestId(/^spc-ic-/);
    expect(arcs.length, "有换乘站却一条换乘弧都没画").toBeGreaterThan(0);
    for (const arc of arcs) {
      const [from, to] = (arc.getAttribute("data-testid") ?? "").replace("spc-ic-", "").split("-");
      const c = carrierOf.get(String(from));
      expect(c, `换乘弧 ${from}→${to} 的起点不在本次响应里 ⇒ 这条弧是凭空画的`).toBeDefined();
      expect(carrierOf.get(String(to)), `换乘弧 ${from}→${to} 两端的承载物不同 ⇒ 这条换乘关系是编的`).toBe(c);
      expect(arc.getAttribute("data-carrier")).toBe(c);
    }

    // 屏上那句「共用承载物 ≠ 先后 ≠ 依赖」的诚实位在（隐喻误读的防线，抄第一档 AND≠OR 的做法）
    expect(screen.getByTestId("spc-interchange-note")).toHaveTextContent("不说明有先后");
  }, 90000);

  it("F4 · 站圈大小是**真编码**不是装饰：工期大的站半径不小于工期小的站，且缩放控件真的动", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const board = await openProcessMode(user);

    const stations = renderedStations();
    const byDays = [...stations].sort((a, b) => a.days - b.days);
    expect(byDays[0]!.days, "所有站工期相同 ⇒ 半径单调性这条断言恒真（换个 fixture 才咬得住）").toBeLessThan(
      byDays[byDays.length - 1]!.days,
    );
    for (let i = 1; i < byDays.length; i += 1) {
      expect(
        byDays[i]!.r,
        `站 ${byDays[i]!.key}（${byDays[i]!.days}天）的圈比 ${byDays[i - 1]!.key}（${byDays[i - 1]!.days}天）还小 ⇒ 半径没在编码工期`,
      ).toBeGreaterThanOrEqual(byDays[i - 1]!.r);
    }

    // 缩放：点一下放大，画布上的变换真的变了（不是画了三个不通电的按钮）
    const before = board.getAttribute("data-zoom");
    await user.click(screen.getByTestId("spc-zoom-in"));
    await waitFor(() => expect(board.getAttribute("data-zoom")).not.toBe(before), { timeout: 20000 });
    expect(Number(board.getAttribute("data-zoom"))).toBeGreaterThan(Number(before));
  }, 90000);
});
