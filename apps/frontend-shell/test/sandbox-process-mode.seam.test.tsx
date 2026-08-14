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
