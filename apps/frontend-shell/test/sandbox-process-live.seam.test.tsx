import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";
import { PROCESS_DEFINITIONS_RESPONSE, processInspectFixture } from "@/mocks/processWaitFixtures";
import { WAIT_KIND_ORDER } from "@/views/process/processWait";
import {
  buildProcessCanvasModel,
  classifyTickDrive,
  classifyTickDriveCanary,
  labelTiersFit,
  lineGapPx,
  procLabelBandPx,
  procLabelBoxHPx,
  procLabelTierGapPx,
  PROC_LAYOUT,
  TICK_DRIVE_ORDER,
  type ProcessLiveInput,
} from "@/views/sim/processCanvas";
import { ChainLossPayloadSchema, type ChainLossPayload } from "@/views/sim/chainLineMap";

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WO-PROCESS-CANVAS-LIVE · 第五档「业务流程」接推演节拍 —— SEAM 门
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ── 这道门守的命题（仓主原话）────────────────────────────────────────────────
 * 「它应该是在**推演沙盘**里面，且是一个**动态的数据变化**。基于某个时间 screenshot，
 *   有个**总结**」
 *
 * 拆成三条互不替代的断言，缺任一条都能让"看起来动了"蒙混过关：
 *  · **§B 真的动**：从真 workspace 进沙盘 → 切第五档 → **点控制条上那颗「推进 tick」** →
 *    能动的那几条**屏上真的变了**（读 DOM 文本 + `toBeVisible()` 的脉冲环，**不是查 state**）。
 *  · **§C 不该动的不许假装动**：不随节拍变的那批，屏上**明确标注**，
 *    而且**与「无承载对象」用两句不同的话**说 —— 两者定性不同、修法不同。
 *  · **§G additive 可回退**：不传节拍维时，模型输出与本单**之前那份实现**逐字节相同
 *    （比对的是 `fixtures/process-canvas-model-baseline.json`，
 *      由 `git show b3bce2a7:…/processCanvas.ts` 那份**基线实现**跑出来的，不是我手写的期望值）。
 *
 * ── 咬的是**链路**不是组件 ───────────────────────────────────────────────────
 * 一律 `renderApp("/v/sim-sandbox")`：真路由 → entitlement 闸 → `SandboxView`（会话在这里建、
 * tick 在这里推）→ `SandboxConsole` → 第五档。直接 `render(<ProcessCanvasView/>)` 只能证明
 * 「拿到组件能画」，证不了「控制条上推的那一拍真的打到了这张图」——
 * 而本单**唯一有价值的那件事**恰恰就是这条接缝。
 *
 * ── 一个字都不写死 ───────────────────────────────────────────────────────────
 * 本文件不出现任何流程键（`P##`）、承载类型名、条数金值。
 * 三档各自该有哪些流程，一律由**本文件自己装的那几个 handler 现场记账**再现算 ——
 * 判据是恒等式，不是抄来的数（种子一变就假红/假绿，本仓 #99 的老坑）。
 *
 * R6 确定性：网络全桩（MSW + `server.use` 覆盖），无时钟、无随机；
 * tick 回包由本文件按**固定增量**构造，同一串操作重跑字节级一致。
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

/** 线路图那一档的引擎载荷（与既有门共用同一份 fixture，不另造一套）。 */
const REAL_LOSS: ChainLossPayload = ChainLossPayloadSchema.parse(
  JSON.parse(readFileSync(join(TEST_DIR, "fixtures/chain-loss-real.json"), "utf8")),
);

/**
 * additive 反证的比对基准 —— **基线实现**的真输出。
 *
 * ⚠ 它不是我手打的期望值：产自 `git show b3bce2a7:apps/frontend-shell/src/views/sim/processCanvas.ts`
 * 那份**本单之前的实现**，喂同一份 mock fixture 跑出来后落盘。
 * 手打期望值只能证明「输出符合我以为的样子」，证不了「与改动前逐字节相同」——
 * 那正是本仓「我用 X 当作 Y 的证据」那条戒律要挡的。
 */
const BASELINE_MODEL_JSON = readFileSync(join(TEST_DIR, "fixtures/process-canvas-model-baseline.json"), "utf8");

// ══════════════════════════════════════════════════════════════════════════════
// § 世界数据 —— **全部从 fixture 现算**，一个类型名都不写死
// ══════════════════════════════════════════════════════════════════════════════

const DEFS = PROCESS_DEFINITIONS_RESPONSE.definitions;
/** 本次 fixture 里出现过的承载类型（升序，确定性）。 */
const CARRIERS = [...new Set(DEFS.map((d) => d.carrierTypeKey))].sort((a, b) => a.localeCompare(b));

/**
 * 把承载类型切成三堆，**对应三档**。切法是位次（现算），不是点名：
 *  · `DRIVEN`  前两种 —— 进传导规则两端 **且** 世界里给真对象  ⇒ 应判 `TICK_DRIVEN`
 *  · `NODATA`  第三种 —— 进传导规则两端 **但** 世界里 0 个对象 ⇒ 应判 `NO_CARRIER_OBJECTS`
 *  · 其余      不进传导规则                                     ⇒ 应判 `NOT_TICK_DRIVEN`
 * 三堆都必须非空，否则对应那一档的断言在空集合上跑 —— §A 的金丝雀先把这件事咬死。
 */
const DRIVEN_CARRIERS = CARRIERS.slice(0, 2);
const NODATA_CARRIER = CARRIERS[2] ?? "";
const STATIC_CARRIERS = CARRIERS.slice(3);

/** 每个「有对象」的承载类型给两个确定性 id（`<type>#1` / `#2`）。 */
const objectIdsOf = (t: string): string[] => [`${t}#1`, `${t}#2`];

/** `SandboxViewConfig.nodeObjectIds`：只有 DRIVEN 那两种真有对象；NODATA 那种**刻意留空**。 */
const NODE_OBJECT_IDS: Record<string, string[]> = Object.fromEntries(DRIVEN_CARRIERS.map((t) => [t, objectIdsOf(t)]));

/** 本次世界里会被写到的状态变量（进 `stateVars`，`deriveBaseSnapshot` 据此种 tick0 占位）。 */
const STATE_VARS = ["pressureA", "pressureB"];

/** 两条传导规则：DRIVEN0 → DRIVEN1 → NODATA。⇒ 规则两端类型 = DRIVEN ∪ {NODATA}。 */
const RULES = [
  { from: DRIVEN_CARRIERS[0] ?? "", to: DRIVEN_CARRIERS[1] ?? "" },
  { from: DRIVEN_CARRIERS[1] ?? "", to: NODATA_CARRIER },
].map((r, i) => ({
  id: `simpr_live_${i}`,
  key: `live_rule_${i}`,
  tenantId: "demo",
  sourceTypeKey: r.from,
  sourceStateVar: STATE_VARS[0]!,
  viaLinkKey: `link_${i}`,
  targetTypeKey: r.to,
  targetStateVar: STATE_VARS[1]!,
  coefficient: 0.5,
  delayTicks: 0,
  combine: "sum" as const,
  decay: null,
  clamp: null,
  coefficientRef: null,
  cadenceNodeId: null,
  status: "PUBLISHED" as const,
}));

/** 一条流程**应该**落哪一档（现算的期望值，与被测实现各算各的 —— 不共用同一段代码）。 */
function expectedDrive(carrierTypeKey: string): "TICK_DRIVEN" | "NO_CARRIER_OBJECTS" | "NOT_TICK_DRIVEN" {
  if (DRIVEN_CARRIERS.includes(carrierTypeKey)) return "TICK_DRIVEN";
  if (carrierTypeKey === NODATA_CARRIER) return "NO_CARRIER_OBJECTS";
  return "NOT_TICK_DRIVEN";
}

/**
 * 记账本：端点这几次**真的**发出去了什么。
 * 断言一律拿它与屏上比 —— 两边都是现算的，中间没有写死的数。
 */
const ledger = {
  defsServed: -1,
  tickCalls: 0,
  /** 每次 tick 回包里 DRIVEN 对象的读数（供"屏上那个数真的是引擎给的那个数"对账）。 */
  lastTickState: {} as Record<string, Record<string, number>>,
  lastTick: -1,
};

/** 第 `n` 拍的世界态：DRIVEN 那两种类型的每个对象每拍**确定性地**加 `10n`。 */
function worldAt(n: number): Record<string, Record<string, number>> {
  const st: Record<string, Record<string, number>> = {};
  for (const t of DRIVEN_CARRIERS) {
    for (const oid of objectIdsOf(t)) {
      st[oid] = { [STATE_VARS[0]!]: 20 + 10 * n, [STATE_VARS[1]!]: 30 + 10 * n };
    }
  }
  return st;
}

function installHandlers() {
  ledger.defsServed = -1;
  ledger.tickCalls = 0;
  ledger.lastTickState = {};
  ledger.lastTick = -1;
  server.use(
    http.get("*/a/v1/process-definitions", () => {
      ledger.defsServed = DEFS.length;
      return HttpResponse.json(PROCESS_DEFINITIONS_RESPONSE);
    }),
    http.get("*/a/v1/process-definitions/:key/inspect", ({ params }) => {
      const body = processInspectFixture(String(params.key));
      return body === null
        ? HttpResponse.json({ error: { code: "NOT_FOUND", message: "no fixture", requestId: "req_t" } }, { status: 404 })
        : HttpResponse.json(body);
    }),
    http.post("*/b/v1/solvers/chain_loss_attribution/run", () =>
      HttpResponse.json({ data: REAL_LOSS, snapshotVersion: "ov-process-live" }),
    ),
    // ── 判据源①：视图配置（**带 `nodeObjectIds`** —— 默认 mock 没有这一项，缺它三档全判成静态）
    http.get("*/a/v1/sim/view-config", () =>
      HttpResponse.json({
        tenantId: "demo",
        nodeTypes: [...DRIVEN_CARRIERS],
        linkTypes: RULES.map((r) => r.viaLinkKey),
        stateVars: STATE_VARS,
        radarDims: [{ key: "structure", label: "结构" }],
        screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
        propagationCount: RULES.length,
        nodeObjectIds: NODE_OBJECT_IDS,
      }),
    ),
    // ── 判据源②：已发布传导规则
    http.get("*/a/v1/sim/propagation-rules", () => HttpResponse.json({ items: RULES })),
    // ── 动力源：推进一拍 ⇒ DRIVEN 那批读数确定性地变了
    http.post("*/a/v1/sim/sessions/:id/tick", async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { n?: number };
      ledger.tickCalls += 1;
      const curTick = ledger.tickCalls * (body.n ?? 1);
      const state = worldAt(curTick);
      ledger.lastTickState = state;
      ledger.lastTick = curTick;
      return HttpResponse.json({ curTick, state });
    }),
  );
}

/** 真路由进沙盘，等控制台落地。 */
async function enterSandbox(): Promise<void> {
  renderApp("/v/sim-sandbox");
  await waitFor(() => expect(screen.getByTestId("sandbox-view")).toBeTruthy(), { timeout: 20000 });
  await waitFor(() => expect(screen.getByTestId("sandbox-console")).toBeTruthy(), { timeout: 20000 });
}

/** 切到第五档并等它把台账取回来 + 节拍维算出来。 */
async function openProcessMode(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByTestId("sc-mode-process"));
  await screen.findByTestId("spc-board", undefined, { timeout: 20000 });
  // 节拍维要等两条租户级取数 + 世界态缓存都到位；到位的判据是"总结那句话不再报判据源缺席"。
  await waitFor(
    () => expect(screen.getByTestId("spc-live-summary").getAttribute("data-gap")).not.toBe("config"),
    { timeout: 20000 },
  );
  return screen.getByTestId("spc-board");
}

/** 屏上这一刻每座站的节拍读数（现算，不写清单）。 */
function renderedLive(): { key: string; drive: string; moved: boolean; reading: string; delta: string; text: string }[] {
  return screen.getAllByTestId(/^spc-card-/).map((g) => {
    const key = g.getAttribute("data-process-key") ?? "";
    const line = g.querySelector(`[data-testid="spc-live-${key}"]`);
    return {
      key,
      drive: g.getAttribute("data-drive") ?? "",
      moved: g.getAttribute("data-moved") === "1",
      reading: g.getAttribute("data-reading") ?? "",
      delta: g.getAttribute("data-delta") ?? "",
      text: line?.textContent ?? "",
    };
  });
}

/** 推一拍（点的是**控制条上那颗真按钮**，不是直接调 API）。 */
async function pushTick(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const btn = await screen.findByTestId("sandbox-tick-btn", undefined, { timeout: 20000 });
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false), { timeout: 20000 });
  const before = ledger.tickCalls;
  await user.click(btn);
  await waitFor(() => expect(ledger.tickCalls).toBe(before + 1), { timeout: 20000 });
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
  it("A1 · 分档函数**三档都说得出话** —— 一个恒返回「不随节拍变」的实现同样能让 §C 全绿", () => {
    const c = classifyTickDriveCanary();
    expect(c.driven, "喂「在规则两端 + 有对象」都判不出随节拍变 ⇒ 分档函数坏了").toBe("TICK_DRIVEN");
    expect(c.noData, "喂「在规则两端 + 0 个对象」都判不出无承载对象 ⇒ 两个不同事实被合成了一个").toBe("NO_CARRIER_OBJECTS");
    expect(c.dark, "喂「不在规则两端」都判不出不随节拍变 ⇒ 分档函数坏了").toBe("NOT_TICK_DRIVEN");
    // 三档必须互不相等 —— 否则"分档"是装饰
    expect(new Set([c.driven, c.noData, c.dark]).size).toBe(3);
    expect(TICK_DRIVE_ORDER.length).toBe(3);
  });

  it("A2 · 本次世界真的把三档都造出来了（任一堆为空 ⇒ 那一档的断言在空集合上跑，恒真）", () => {
    expect(DEFS.length, "fixture 一条流程都没有 ⇒ 下面每条断言恒真恒绿").toBeGreaterThan(1);
    expect(DRIVEN_CARRIERS.length, "没有任何一种承载物被判为随节拍变 ⇒ §B「真的动了」无从谈起").toBeGreaterThan(0);
    expect(NODATA_CARRIER.length, "没有「接了线没数据」那一档 ⇒ §C 的反面判据（两句话必须不同）在空集合上跑").toBeGreaterThan(0);
    expect(STATIC_CARRIERS.length, "没有「本层不随节拍变」那一档 ⇒ §C 主判据在空集合上跑").toBeGreaterThan(0);
    // 三堆两两不相交（否则一条流程会被数进两档，`byDrive` 求和恒等式反而看不出问题）
    expect(DRIVEN_CARRIERS).not.toContain(NODATA_CARRIER);
    expect(STATIC_CARRIERS).not.toContain(NODATA_CARRIER);
    for (const t of DRIVEN_CARRIERS) expect(STATIC_CARRIERS).not.toContain(t);
    // 每一档都真的对得上至少一条流程（承载类型存在 ≠ 有流程用它）
    for (const kind of TICK_DRIVE_ORDER) {
      expect(DEFS.filter((d) => expectedDrive(d.carrierTypeKey) === kind).length, `档 ${kind} 一条流程都没有`).toBeGreaterThan(0);
    }
  });

  it("A3 · tick 回包**真的会变**（两拍读数相同 ⇒ 下面「动了」的断言在恒等数据上跑）", () => {
    expect(JSON.stringify(worldAt(1))).not.toBe(JSON.stringify(worldAt(2)));
    expect(Object.keys(worldAt(1)).length, "tick 回包里一个对象都没有 ⇒ 读数恒 null，动不动无从谈起").toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §B 接缝：真 workspace → 沙盘 → 第五档 → **推一拍** → 屏上真的变了
// ══════════════════════════════════════════════════════════════════════════════

describe("§B 接缝驱动（推的是控制条上那颗真按钮，看的是 DOM 文本不是 state）", () => {
  it("B1 · 第五档一挂出来就带着分类：三档条数之和 == 端点下发条数，且每条流程落的档与现算期望一致", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);

    const rows = renderedLive();
    expect(ledger.defsServed, "记账本没记到 ⇒ handler 没被打到，下面比的是两个空数").toBeGreaterThan(0);
    expect(rows.length, "屏上渲染的站数 ≠ 端点下发条数").toBe(ledger.defsServed);

    // 每一条落的档，与本文件**另算一遍**的期望逐条对齐（不共用被测实现的那段代码）
    for (const r of rows) {
      const def = DEFS.find((d) => d.key === r.key)!;
      expect(r.drive, `${r.key}（承载 ${def.carrierTypeKey}）落错档`).toBe(expectedDrive(def.carrierTypeKey));
    }

    // 屏上那句总结里的三个数 == 现数 DOM 得到的三个数（同源判据：屏上写的必须度量屏上画的）
    const sum = screen.getByTestId("spc-live-summary");
    for (const [attr, kind] of [["data-driven", "TICK_DRIVEN"], ["data-nodata", "NO_CARRIER_OBJECTS"], ["data-static", "NOT_TICK_DRIVEN"]] as const) {
      expect(sum.getAttribute(attr), `总结里的 ${kind} 条数 ≠ 现数 DOM 的条数`).toBe(String(rows.filter((r) => r.drive === kind).length));
    }
    // 分档不许漏人、不许一条被数两遍
    expect(
      Number(sum.getAttribute("data-driven")) + Number(sum.getAttribute("data-nodata")) + Number(sum.getAttribute("data-static")),
    ).toBe(ledger.defsServed);
    expect(screen.queryByTestId("spc-live-drive-mismatch"), "三档求和报警亮了").toBeNull();
  }, 90000);

  it("B2 · **推一拍** → 能动的那几条屏上**真的变了**（读 DOM 文本；动的站亮出可见的脉冲环）", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);

    // 推第一拍之前：这是第一张快照，没有可比的上一拍 —— 屏上必须**明说没得比**，
    // 而不是印一个会被读成"什么都没动"的 0。
    expect(screen.getByTestId("spc-live-summary").getAttribute("data-comparable")).toBe("0");
    expect(screen.queryAllByTestId(/^spc-moved-/).length, "还没推过任何一拍就已经有站亮脉冲环 ⇒ 那个环不是「动了」的证据").toBe(0);

    // 先推一拍，让「上一拍」存在（tick0 是建会话时的占位态，与 tick1 之间本来就该有差）
    await pushTick(user);
    await waitFor(() => expect(screen.getByTestId("spc-live-summary").getAttribute("data-tick")).toBe(String(ledger.lastTick)), { timeout: 20000 });

    // 记下这一刻能动的那几条的**屏上文本**
    const drivenKeys = renderedLive().filter((r) => r.drive === "TICK_DRIVEN").map((r) => r.key);
    expect(drivenKeys.length, "一条能动的都没有 ⇒ 下面的断言在空集合上跑").toBeGreaterThan(0);
    const before = new Map(renderedLive().map((r) => [r.key, r.text]));

    // 再推一拍
    await pushTick(user);
    await waitFor(() => expect(screen.getByTestId("spc-live-summary").getAttribute("data-tick")).toBe(String(ledger.lastTick)), { timeout: 20000 });

    const after = new Map(renderedLive().map((r) => [r.key, r.text]));
    for (const k of drivenKeys) {
      expect(
        after.get(k),
        `${k} 是「随节拍变」，推了一拍屏上那行字却一个字都没变 —— 这一档就是画着好看`,
      ).not.toBe(before.get(k));
    }
    // 屏上那个读数必须**真的是引擎回包里的那个数**（不是本地自增的假象）
    const rowsNow = renderedLive();
    for (const r of rowsNow.filter((x) => x.drive === "TICK_DRIVEN")) {
      const def = DEFS.find((d) => d.key === r.key)!;
      const ids = NODE_OBJECT_IDS[def.carrierTypeKey] ?? [];
      const vals = ids.flatMap((id) => Object.values(ledger.lastTickState[id] ?? {}));
      const mean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
      expect(Number(r.reading), `${r.key} 屏上读数 ≠ 引擎这一拍回包里那批对象的读数`).toBeCloseTo(mean, 6);
    }

    // 「动了」这件事在屏上有一个**可见**的图元（不是只写在 data-* 里给测试看）
    const rings = screen.getAllByTestId(/^spc-moved-/);
    expect(rings.length, "有站的读数变了，却没有任何一个脉冲环 ⇒ 屏上看不出动过").toBeGreaterThan(0);
    for (const ring of rings) expect(ring).toBeVisible();
    // 亮环的那批 == data-moved 说动了的那批（同源：屏上画的与屏上写的必须是同一件事）
    expect(rings.map((e) => e.getAttribute("data-testid")!.replace("spc-moved-", "")).sort()).toEqual(
      rowsNow.filter((r) => r.moved).map((r) => r.key).sort(),
    );
  }, 120000);

  it("B3 · 总结说的是**变化**不是当前值：带上一拍拍号、动了几条、按等待态分列", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);
    await pushTick(user);
    await waitFor(() => expect(screen.getByTestId("spc-live-summary").getAttribute("data-tick")).toBe(String(ledger.lastTick)), { timeout: 20000 });
    await pushTick(user);
    await waitFor(() => expect(screen.getByTestId("spc-live-summary").getAttribute("data-tick")).toBe(String(ledger.lastTick)), { timeout: 20000 });

    const sum = screen.getByTestId("spc-live-summary");
    expect(sum).toBeVisible();
    // ① 这张快照是**哪个世界、哪一拍**（"动了"是相对谁说的，不写出来没法核对）
    expect(sum.getAttribute("data-session")!.length, "总结没写出这是哪个世界").toBeGreaterThan(0);
    expect(sum.getAttribute("data-tick")).toBe(String(ledger.lastTick));
    expect(sum.getAttribute("data-comparable"), "有上一拍却报「没得比」").toBe("1");
    expect(sum.getAttribute("data-prev-tick")).not.toBe(sum.getAttribute("data-tick"));
    // ② 文本里必须出现**上一拍的拍号**与**动了几条** —— 只报当前值不算"动态"
    expect(sum.textContent).toContain(`第 ${sum.getAttribute("data-prev-tick")} 拍`);
    const moved = Number(sum.getAttribute("data-moved"));
    expect(moved, "推了两拍一条都没动 ⇒ 下面的措辞断言在空数据上跑").toBeGreaterThan(0);
    expect(sum.textContent).toContain(`${moved} 条真的动了`);
    // ③ 按等待态分列（`movedByWaitKind`）——至少有一个态被点名
    const kindLabels = renderedLive()
      .filter((r) => r.moved)
      .map((r) => DEFS.find((d) => d.key === r.key)!.waitKind);
    expect(kindLabels.length).toBeGreaterThan(0);
  }, 120000);

  it("B4 · 第五档是**观察者**：它不建第二个会话、不自己发 tick", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const before = ledger.tickCalls;
    await openProcessMode(user);
    // 切进第五档本身**不许**推进任何一拍（自己发 tick ⇒ 同一个会话被两处推进，curTick 打架）
    expect(ledger.tickCalls, "切到第五档就自己推了一拍 ⇒ 它成了第二个控制器").toBe(before);
    // 屏上写出的世界 id，必须与沙盘控制条那个世界是同一个（不是本档自己另开的）
    const sid = screen.getByTestId("spc-live-summary").getAttribute("data-session") ?? "";
    expect(sid.length).toBeGreaterThan(0);
    await pushTick(user);
    await waitFor(() => expect(screen.getByTestId("spc-live-summary").getAttribute("data-tick")).toBe(String(ledger.lastTick)), { timeout: 20000 });
    expect(
      screen.getByTestId("spc-live-summary").getAttribute("data-session"),
      "推了一拍之后本档看的世界换了 ⇒ 它看的不是控制条上那个世界",
    ).toBe(sid);
  }, 90000);
});

// ══════════════════════════════════════════════════════════════════════════════
// §C ⛔ 反面判据：不该动的那批，屏上明确标注，且**与「无数据」用两句不同的话**说
// ══════════════════════════════════════════════════════════════════════════════

describe("§C 「本层不随节拍变」≠「无承载对象」≠ 留白（这一节红了 = 一个数盖住了两个事实）", () => {
  it("C1 · 不随节拍变的那批：屏上有**可见文字**明确标注，不是空白、不是靠灰掉", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);

    const statics = renderedLive().filter((r) => r.drive === "NOT_TICK_DRIVEN");
    expect(statics.length, "一条「不随节拍变」都没有 ⇒ 本节全部断言在空集合上跑").toBeGreaterThan(0);
    for (const r of statics) {
      const el = screen.getByTestId(`spc-live-${r.key}`);
      expect(el, `${r.key} 被判为不随节拍变，屏上却什么都没说 —— 留白会被读成「加载中 / 坏了」`).toBeVisible();
      expect((el.textContent ?? "").trim().length, `${r.key} 的标注是空串`).toBeGreaterThan(0);
      // 形状也标了一遍（色觉差异者与黑白打印稿上仍分得出）
      expect(screen.getByTestId(`spc-static-${r.key}`)).toBeTruthy();
      // 读屏那条通路也把话说全了（视觉之外的第四重编码）
      expect(screen.getByTestId(`spc-card-${r.key}`).getAttribute("aria-label")).toContain("本层不随节拍变");
    }
    // 这批**一个都不许**亮脉冲环（结构上写不到它们，"动了"就是假的）
    for (const r of statics) expect(screen.queryByTestId(`spc-moved-${r.key}`)).toBeNull();
  }, 90000);

  it("C2 · **两句话必须不同**：「本层不随节拍变」与「无承载对象」在屏上不是同一串字", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);

    const rows = renderedLive();
    const staticTexts = new Set(rows.filter((r) => r.drive === "NOT_TICK_DRIVEN").map((r) => r.text.trim()));
    const noDataTexts = new Set(rows.filter((r) => r.drive === "NO_CARRIER_OBJECTS").map((r) => r.text.trim()));
    expect(staticTexts.size, "「不随节拍变」那批屏上没有任何文字").toBeGreaterThan(0);
    expect(noDataTexts.size, "「无承载对象」那批屏上没有任何文字 ⇒ 本条在空集合上跑").toBeGreaterThan(0);

    /**
     * ⛔ 本单最要紧的一条断言（派单点名的变异反证就咬它）：
     * 两档的措辞**交集必须为空**。合成一句 = 把「传导图里根本没有这类承载物」（结构上不会动）
     * 与「传导图够得着但这个世界里没有该类对象」（补数据即会动）盖成一个 —— 两者定性不同、
     * 修法不同，混了就一定修错地方。
     */
    for (const s of staticTexts) {
      expect(
        noDataTexts.has(s),
        `「本层不随节拍变」与「无承载对象」用了同一串字「${s}」—— 两个定性不同、修法不同的事实被盖成一个`,
      ).toBe(false);
    }
    // 读屏通路同样不许合并
    const staticKey = rows.find((r) => r.drive === "NOT_TICK_DRIVEN")!.key;
    const noDataKey = rows.find((r) => r.drive === "NO_CARRIER_OBJECTS")!.key;
    const staticAria = screen.getByTestId(`spc-card-${staticKey}`).getAttribute("aria-label") ?? "";
    const noDataAria = screen.getByTestId(`spc-card-${noDataKey}`).getAttribute("aria-label") ?? "";
    expect(staticAria).toContain("本层不随节拍变");
    expect(noDataAria).toContain("无承载对象");
    expect(noDataAria, "「无承载对象」的读屏文案里出现了「本层不随节拍变」⇒ 两档在读屏通路上被合并了").not.toContain("本层不随节拍变");
  }, 90000);

  it("C3 · 「无承载对象」那批：推多少拍都不许动（它们没有对象可读，动了就是编的）", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);
    await pushTick(user);
    await waitFor(() => expect(screen.getByTestId("spc-live-summary").getAttribute("data-tick")).toBe(String(ledger.lastTick)), { timeout: 20000 });
    await pushTick(user);
    await waitFor(() => expect(screen.getByTestId("spc-live-summary").getAttribute("data-tick")).toBe(String(ledger.lastTick)), { timeout: 20000 });

    for (const r of renderedLive().filter((x) => x.drive !== "TICK_DRIVEN")) {
      expect(r.moved, `${r.key} 不是节拍驱动，却被判成「这一拍动了」`).toBe(false);
      expect(r.reading, `${r.key} 没有承载对象却给出了读数 —— 那个数是编的`).toBe("");
    }
  }, 120000);

  it("C4 · 诚实位：判据**测不出**「本质上该不该随节拍变」这句话必须在浮层里，且不许被删", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);
    // 浮层默认不渲染内容（`open===false` ⇒ 不在 DOM）——先把它打开再咬，否则等于没咬
    await user.hover(screen.getByTestId("info-process-tick-drive"));
    const limit = await screen.findByTestId("spc-live-limit", undefined, { timeout: 20000 });
    expect(limit.textContent).toContain("不说明它本质上不该随节拍变");
    expect(screen.getByTestId("spc-live-basis").textContent).toContain("propagateTick");
    // 四态计数条属**模板层**这件事也必须说出来（它就摆在会跳的读数旁边）
    expect(screen.getByTestId("spc-live-waitkind-static").textContent).toContain("模板层");
    expect(screen.getByTestId("spc-kindbar").getAttribute("data-tick-invariant")).toBe("1");
  }, 90000);
});

// ══════════════════════════════════════════════════════════════════════════════
// §G additive 反证：不传节拍维 ⇒ 与**本单之前那份实现**逐字节相同
// ══════════════════════════════════════════════════════════════════════════════

describe("§G additive 可回退（比的是基线实现的真输出，不是我手打的期望值）", () => {
  it("G1 · 不传第三参 ⇒ `JSON.stringify` 与基线 fixture **逐字节相同**", () => {
    expect(BASELINE_MODEL_JSON.length, "基线 fixture 是空的 ⇒ 下面比的是两个空串，恒绿").toBeGreaterThan(100);
    const now = JSON.stringify(buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER));
    expect(now, "不传节拍维时的输出与本单之前那份实现不再逐字节相同 ⇒ additive 契约破了").toBe(BASELINE_MODEL_JSON);
  });

  it("G2 · 传 `null` 与省略等价（两条回退路径不许分家）", () => {
    const omitted = JSON.stringify(buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER));
    const explicitNull = JSON.stringify(buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER, null));
    expect(explicitNull).toBe(omitted);
  });

  it("G3 · `live` 键在**不传时根本不存在**（不是 `null`、不是 `undefined` 占槽）", () => {
    const m = buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER);
    expect(Object.prototype.hasOwnProperty.call(m, "live"), "模型层留下了 live 键槽").toBe(false);
    for (const line of m.lines) {
      for (const st of line.stations) {
        expect(Object.prototype.hasOwnProperty.call(st, "live"), `站 ${st.key} 留下了 live 键槽`).toBe(false);
      }
    }
  });

  it("G4 · 传了节拍维 ⇒ 输出**必须**与基线不同（否则 G1 是恒真断言）", () => {
    const input: ProcessLiveInput = {
      rules: RULES.map((r) => ({ sourceTypeKey: r.sourceTypeKey, targetTypeKey: r.targetTypeKey })),
      nodeObjectIds: NODE_OBJECT_IDS,
      snapshot: { sessionId: "s1", tick: 1, state: worldAt(1), origin: "MEASURED" },
      prevSnapshot: { sessionId: "s1", tick: 0, state: worldAt(0), origin: "MEASURED" },
    };
    const withLive = JSON.stringify(buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER, input));
    expect(withLive, "接了节拍维输出却与基线一模一样 ⇒ 第三参根本没接上，G1 就是一句废话").not.toBe(BASELINE_MODEL_JSON);
    // R6 确定性：同输入两次，字节级一致
    expect(JSON.stringify(buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER, input))).toBe(withLive);
  });

  it("G5 · 同一拍与自己比 ⇒ 报「没得比」，不许报「都没动」（那个 0 会被读成结论）", () => {
    const same = {
      rules: RULES.map((r) => ({ sourceTypeKey: r.sourceTypeKey, targetTypeKey: r.targetTypeKey })),
      nodeObjectIds: NODE_OBJECT_IDS,
      snapshot: { sessionId: "s1", tick: 3, state: worldAt(3), origin: "MEASURED" as const },
      prevSnapshot: { sessionId: "s1", tick: 3, state: worldAt(3), origin: "MEASURED" as const },
    };
    expect(buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER, same).live?.comparable).toBe(false);
    // 换了拍才算可比
    const diff = { ...same, prevSnapshot: { ...same.prevSnapshot, tick: 2, state: worldAt(2) } };
    expect(buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER, diff).live?.comparable).toBe(true);
  });

  it("G6 · `byWaitKind`（模板层）**推多少拍都不变** —— 「等外部方 +3」这类说法今天恒为假", () => {
    const mk = (tick: number) =>
      buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER, {
        rules: RULES.map((r) => ({ sourceTypeKey: r.sourceTypeKey, targetTypeKey: r.targetTypeKey })),
        nodeObjectIds: NODE_OBJECT_IDS,
        snapshot: { sessionId: "s1", tick, state: worldAt(tick), origin: "MEASURED" },
        prevSnapshot: { sessionId: "s1", tick: tick - 1, state: worldAt(tick - 1), origin: "MEASURED" },
      });
    const a = mk(1);
    const b = mk(7);
    expect(JSON.stringify(b.byWaitKind), "四态计数随 tick 变了 ⇒ 有人把模板层当成了世界态").toBe(JSON.stringify(a.byWaitKind));
    // 而"这一拍每一态动了几条"是**另一族**度量，它必须真的存在（不然上面那条只是"两个都没有"）
    expect(a.live?.movedByWaitKind.length).toBe(a.byWaitKind.length);
    expect((a.live?.movedByWaitKind ?? []).reduce((s, g) => s + g.moved, 0)).toBeGreaterThan(0);
  });

  it("G7 · 分档判据只吃**下发数据**：抽掉 nodeObjectIds ⇒ 能动的那批降级为「无承载对象」，不是「不随节拍变」", () => {
    const base = {
      rules: RULES.map((r) => ({ sourceTypeKey: r.sourceTypeKey, targetTypeKey: r.targetTypeKey })),
      snapshot: { sessionId: "s1", tick: 1, state: worldAt(1), origin: "MEASURED" as const },
      prevSnapshot: null,
    };
    const withObjs = buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER, { ...base, nodeObjectIds: NODE_OBJECT_IDS });
    const without = buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER, { ...base, nodeObjectIds: {} });
    const cnt = (m: typeof withObjs, k: (typeof TICK_DRIVE_ORDER)[number]) => m.live?.byDrive.find((g) => g.kind === k)?.count ?? -1;
    expect(cnt(withObjs, "TICK_DRIVEN")).toBeGreaterThan(0);
    expect(cnt(without, "TICK_DRIVEN")).toBe(0);
    // 关键：它们变成「无承载对象」而**不是**「本层不随节拍变」—— 前者补数据即动，后者结构上不动
    expect(cnt(without, "NO_CARRIER_OBJECTS")).toBe(cnt(withObjs, "TICK_DRIVEN") + cnt(withObjs, "NO_CARRIER_OBJECTS"));
    expect(cnt(without, "NOT_TICK_DRIVEN")).toBe(cnt(withObjs, "NOT_TICK_DRIVEN"));
  });

  /**
   * G9 —— 本单实测抓到的一个**只差一点就发出去**的版面 bug（记在这里当护栏）。
   *
   * 站上多了第三行读数之后，同侧两层之间只剩 `labelTierGap(28) − 3×labelLineH(39) = −11px`，
   * **跨层压字**。而 `labelOverflow` 那套检测比的是**同一层内**相邻标签的**水平**包围盒 ——
   * 它对垂直方向一言不发（「我用 X 当作 Y 的证据，而 X 并不度量 Y」的又一例）。
   * 所以这条断言必须**单独存在**，不能指望既有的 overflow 断言顺手咬到。
   */
  it("G9 · 标签分层不许压字：两行 / 三行两种版面都得装得下（`labelOverflow` 咬不到这一维）", () => {
    // 先证这个判据**能说「不」**（否则它说「行」一文不值）—— 与主逻辑共用同一份实现
    expect(PROC_LAYOUT.labelTierGap, "层距是 0 ⇒ 下面的判据在退化输入上跑").toBeGreaterThan(0);
    const need2 = 2 * PROC_LAYOUT.labelLineH;
    const need3 = 3 * PROC_LAYOUT.labelLineH;
    // 反面样例：三行文字配「不加层距」的旧几何 —— 必须判为装不下
    expect(PROC_LAYOUT.labelTierGap >= need3, "旧层距居然装得下三行 ⇒ 常量变了，本条的取证已过期，须重算").toBe(false);

    expect(labelTiersFit(false), "两行版面装不下 ⇒ 本单把既有版面弄坏了").toBe(true);
    expect(labelTiersFit(true), "三行版面装不下 ⇒ 节拍读数会压到下一层标签上").toBe(true);
    // 层距与块高都必须真的长了一行（只长一个 = 另一个继续压）
    expect(procLabelTierGapPx(true)).toBe(PROC_LAYOUT.labelTierGap + PROC_LAYOUT.labelLineH);
    expect(procLabelBoxHPx(true)).toBe(PROC_LAYOUT.labelBoxH + PROC_LAYOUT.labelLineH);
    expect(procLabelTierGapPx(true)).toBeGreaterThanOrEqual(need3);
    expect(procLabelBoxHPx(true)).toBeGreaterThanOrEqual(need3);
    // 不传时**逐字节回到旧几何**（additive：几何一动，canvas.h 与每座站的 y 全会变）
    expect(procLabelTierGapPx(false)).toBe(PROC_LAYOUT.labelTierGap);
    expect(procLabelBoxHPx(false)).toBe(PROC_LAYOUT.labelBoxH);
    expect(procLabelBoxHPx(false)).toBeGreaterThanOrEqual(need2);
    expect(procLabelBandPx(false)).toBeLessThan(procLabelBandPx(true));
    expect(lineGapPx(false)).toBeLessThan(lineGapPx(true));

    // 落到**真模型**上：接了节拍维的那份，每座站的第三行基线必须仍在自己的标签块里
    const input: ProcessLiveInput = {
      rules: RULES.map((r) => ({ sourceTypeKey: r.sourceTypeKey, targetTypeKey: r.targetTypeKey })),
      nodeObjectIds: NODE_OBJECT_IDS,
      snapshot: { sessionId: "s1", tick: 1, state: worldAt(1), origin: "MEASURED" },
      prevSnapshot: { sessionId: "s1", tick: 0, state: worldAt(0), origin: "MEASURED" },
    };
    const m = buildProcessCanvasModel(PROCESS_DEFINITIONS_RESPONSE, WAIT_KIND_ORDER, input);
    const stations = m.lines.flatMap((l) => l.stations);
    expect(stations.length, "一座站都没有 ⇒ 下面在空集合上跑").toBeGreaterThan(0);
    for (const st of stations) {
      const thirdLineY = st.label.subY + PROC_LAYOUT.labelLineH; // 组件就是这么摆第三行的
      expect(thirdLineY, `${st.key} 的节拍读数落在标签块之外 ⇒ 它会压到下一层`).toBeLessThanOrEqual(
        st.label.box.y + st.label.box.h,
      );
    }
    /**
     * 跨层不压字 —— 判据必须**对站圈半径归一**。
     *
     * ⚠ 这一条第一版写错过，留作反面教材：原来直接比 `t0.box.y + h ≤ t1.box.y`，
     *   实测红在 `182 > 180.51`。根因不是版面压字，是**站圈半径不同**
     *   （`r ∝ √标准工期`，`top = y + r + labelBase + tier×tierGap`）——
     *   工期大的站圈大、标签自然更靠下 1.5px。那条断言度量的是「半径差」，不是「层距够不够」。
     *   形态还是那句：**「我用 X 当作 Y 的证据，而 X 并不度量 Y。」**
     *   ⇒ 改成先减掉 `y + r`（站圈下缘），只比**层内偏移**，与半径无关。
     */
    for (const st of stations) {
      const offset = st.label.box.y - (st.y + st.r); // 相对站圈下缘的层内偏移
      expect(offset, `${st.key} 的标签层偏移与 tier 对不上`).toBeCloseTo(
        PROC_LAYOUT.labelBase + st.label.tier * procLabelTierGapPx(true),
        6,
      );
      expect(st.label.box.h).toBe(procLabelBoxHPx(true));
    }
    // 归一之后，「tier0 块底 ≤ tier1 块顶」就是纯层距不等式 —— 与 labelTiersFit 同一件事，
    // 但这里是**从真模型的站上量出来的**，不是再算一遍常量。
    const tiers = [...new Set(stations.map((s) => s.label.tier))].sort();
    expect(tiers.length, "全部站都挤在同一层 ⇒ 跨层断言在空集合上跑").toBeGreaterThan(1);
    for (let i = 1; i < tiers.length; i += 1) {
      const lo = PROC_LAYOUT.labelBase + tiers[i - 1]! * procLabelTierGapPx(true) + procLabelBoxHPx(true);
      const hi = PROC_LAYOUT.labelBase + tiers[i]! * procLabelTierGapPx(true);
      expect(lo, `tier${tiers[i - 1]} 的标签块压进了 tier${tiers[i]}`).toBeLessThanOrEqual(hi);
    }
  });

  it("G8 · 分档函数本身：三档判据逐条可证伪（不靠上面那些集成路径间接证明）", () => {
    const rules = new Set(["A", "B"]);
    expect(classifyTickDrive("A", rules, 2)).toBe("TICK_DRIVEN");
    expect(classifyTickDrive("A", rules, 0)).toBe("NO_CARRIER_OBJECTS");
    expect(classifyTickDrive("C", rules, 2)).toBe("NOT_TICK_DRIVEN");
    expect(classifyTickDrive("C", rules, 0)).toBe("NOT_TICK_DRIVEN");
    // 空规则集 ⇒ 全部不随节拍变（"没有传导规则"与"有规则但够不着"在这一档上同解，
    // 屏上那句话对两者都成立：传导图里没有这类承载物）
    expect(classifyTickDrive("A", new Set<string>(), 2)).toBe("NOT_TICK_DRIVEN");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §H 守恒：接了节拍维，本档原有的诚实位与结构红线一条都不许掉
// ══════════════════════════════════════════════════════════════════════════════

describe("§H 守恒（加一维不许弄丢既有判据）", () => {
  it("H1 · 条数恒等式 / 两层交集 / 顺序依据 / 标准工期口径 四条诚实位都还在", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    await openProcessMode(user);
    expect(screen.getByTestId("spc-counts").getAttribute("data-total")).toBe(String(ledger.defsServed));
    expect(screen.getByTestId("spc-counts").getAttribute("data-laid")).toBe(String(ledger.defsServed));
    expect(screen.getByTestId("spc-disjoint").getAttribute("data-overlap")).toBe("0");
    expect(screen.getByTestId("spc-order-basis").getAttribute("data-basis")).toBe("display-order");
    expect(screen.getByTestId("spc-stddays-caveat")).toBeVisible();
  }, 90000);

  it("H2 · 图例降到浮层是**降层不是删除**：第一层留着 `?` 记号，四条原文一字未少", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const board = await openProcessMode(user);
    // 第一层的可见记号还在（规范 §1：静默降层等于删除）
    const trigger = screen.getByTestId("info-process-legend");
    expect(trigger).toBeVisible();
    expect(within(board.parentElement as HTMLElement).queryByTestId("spc-legend")).toBeTruthy();
    // 打开后原文一条不少，且本轮新增的两个图元也在同一处有解释
    await user.hover(trigger);
    for (const id of [
      "spc-legend-station",
      "spc-legend-interchange",
      "spc-legend-dashed",
      "spc-legend-waitkind",
      "spc-legend-moved",
      "spc-legend-static",
    ]) {
      expect(await screen.findByTestId(id, undefined, { timeout: 20000 }), `图例条目 ${id} 在降层过程中丢了`).toBeTruthy();
    }
  }, 90000);

  it("H3 · 本档仍然**零原生 tooltip**（新增的图元没顺手带回 `<title>`）", async () => {
    const user = userEvent.setup();
    await enterSandbox();
    const board = await openProcessMode(user);
    expect(board.querySelectorAll("[title]").length).toBe(0);
    expect(board.querySelectorAll("svg title").length).toBe(0);
  }, 90000);
});
