import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type {
  BottleneckMatrixOutput,
  ChainLossMatrixResult,
  ChainNodeDetail,
  ImpactAnalysisRequest,
  ImpactAnalysisResponse,
  Perturbation,
  SandboxViewConfig,
  SimSession,
  TickState,
} from "@platform/contracts";
import { server } from "./setup";
import type { ViewConfigVM } from "@/api/types";
import SandboxDetailRoute, {
  deriveImpactChange,
  deriveMitigation,
  objectTypeOf,
  pickLatestPerturbation,
} from "@/views/sim/console/SandboxDetailRoute";

/**
 * ══ WO-SIM-DETAIL-WIRE · 传导识别页「宿主组装参数 → 发请求 → 诚实位翻真」的接缝门 ═══
 *
 * ── 病灶：今天的行为是 X，应该是 Y ─────────────────────────────────────────────
 *
 * **X（改造前实测·真浏览器）**：`/v/sim-conduction` 上有真会话
 * （`data-session-reason="auto"`、`data-session-id="sims_…"` 已透下去），整页**只发两个请求**：
 *   `200 /a/v1/sim/sessions` + `400 /a/v1/sim/sessions/sims_…/node-detail`
 * 三个诚实位全是 `placeholder`。两个不同的病叠在一起：
 *   ① `node-detail` 恒 400 —— 后端 `nodeId` 必填（`app.ts` 手写守卫），
 *      而 `useNodeDetail` 的门槛只有 `sessionId !== ""` ⇒ 每次都发一条注定失败的请求；
 *   ② 影响半径扇区 / 应对策略栈 **连请求都不发** —— `impactChange` / `mitigation`
 *      只从 `view.options` 取，而后端 workspace 从不下发这四个 viewKey 的 options ⇒ 恒 undefined
 *      ⇒ 两个 hook 恒 `enabled:false`。适配层注释自己写着「页面开了口，宿主没往里送值」。
 *
 * **Y（应该）**：宿主从**本租户自己的数据**解析出三个入参（口径写在 `SandboxDetailRoute` 文件头），
 * 三跳真发出去、三个诚实位分别翻 `endpoint` / `impact-analysis` / `solver`；
 * 解析不出来的那一个 **一条请求都不发**，诚实位留在 `placeholder` 且说得出为什么。
 *
 * ── 这道门咬的是**链路**不是函数 ───────────────────────────────────────────────
 * 每条用例都真渲染 `SandboxDetailRoute`（`registry.ts` 里注册的那个默认导出），
 * 让它自己去发请求、自己落回，再读屏上的诚实位 + **真发出去的 URL 与 body**。
 * 纯函数只在 ⓪ 金丝雀里自证（证明判据本身没坏），不拿它们的返回值当交付证据 ——
 * 那是"测函数"，本仓记过的假绿第 9 形态。
 *
 * R6 确定性：网络全桩、无随机、无真实时钟。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 证物
// ══════════════════════════════════════════════════════════════════════════

const SESSION: SimSession = {
  id: "sims_wire",
  tenantId: "demo",
  baseSnapshot: {},
  scope: {},
  status: "RUNNING",
  curTick: 3,
  parentCheckpointId: null,
  createdAt: "2026-08-20T00:00:00.000Z",
};

/** 落点节点的唯一出处。**两个环节**：`[0]` 与"损失最大的那个"刻意不是同一条，见用例 ①。 */
const MATRIX: ChainLossMatrixResult = {
  nodes: [
    { nodeId: "capacity.aging", stage: "CAPACITY", label: "老化静置" },
    { nodeId: "material.kitting", stage: "MATERIAL", label: "齐套发料" },
  ],
  bases: [{ baseId: "base_a", name: "甲基地" }],
  cells: [
    // ⚠ 故意让 `[1]` 吃的损失更大：宿主若改成"取损失最大的那个"，用例 ① 会当场红。
    { nodeId: "capacity.aging", baseId: "base_a", pct: 30, days: 3 },
    { nodeId: "material.kitting", baseId: "base_a", pct: 70, days: 7 },
  ],
  rowTotals: [
    { nodeId: "capacity.aging", days: 3, pctOfGrandLoss: 30, baseCount: 1 },
    { nodeId: "material.kitting", days: 7, pctOfGrandLoss: 70, baseCount: 1 },
  ],
  colTotals: [
    {
      baseId: "base_a",
      anchorSo: "SO-WIRE-1",
      anchorBaseId: "base_a",
      anchorAgingProcessId: "proc_wire_1",
      days: 10,
      sumPct: 100,
      cellCount: 2,
      missingNodeIds: [],
      reason: null,
      probe: null,
    },
  ],
  residual: { byBase: [{ baseId: "base_a", residualPct: 0, ok: true, reason: null }], rows: 0, rowsOk: true, tolerancePct: 0.5 },
  summary: "接缝桩：两环节 × 一基地",
};

/** `GET …/:id/node-detail` 的回包 = 契约 `ChainNodeDetailSchema`（**不是**前端那份私有形状）。 */
const NODE_DETAIL: ChainNodeDetail = {
  node: {
    nodeId: "capacity.aging",
    label: "老化静置",
    stage: "CAPACITY",
    station: "老化站",
    nodeDays: 3,
    nodePct: 30,
    steps: [],
  },
  lots: [
    {
      lotNo: "LOT-W-1",
      station: "老化站",
      batch: 3000,
      wip: 1200,
      takt: 30,
      yieldPct: 98,
      evidence: { lot: { objectType: "WIPLot", objectId: "LOT-W-1", prop: "qty", value: 1200 }, batch: null, takt: null, yield: null },
    },
  ],
  route: { fromStation: "齐套站", toStation: "质检站", basis: "接缝桩：Operation.operationSeq 相邻工序" },
  missing: [],
  visibility: { visibleLineCount: 1, totalLineCount: 1, rowFilters: [] },
};

/**
 * 两条扰动：`startTick` 小的那条**排在数组后面** —— 宿主若拿 `items.at(-1)` 当"最近一条"，
 * 派生出来的落点就会是 `obj_b1`，用例 ① 的 body 断言当场红。
 */
const PERTURBATIONS: Perturbation[] = [
  {
    id: "pert_new",
    tenantId: "demo",
    sessionId: SESSION.id,
    kind: "capacity_loss",
    targetObjectId: "obj_a1",
    targetStateVar: "loadIndex",
    startTick: 2,
    durationTicks: null,
    magnitude: -10,
    mode: "delta",
    label: "接缝桩·新",
    createdAt: "2026-08-20T02:00:00.000Z",
  },
  {
    id: "pert_old",
    tenantId: "demo",
    sessionId: SESSION.id,
    kind: "capacity_loss",
    targetObjectId: "obj_b1",
    targetStateVar: "queueLen",
    startTick: 1,
    durationTicks: null,
    magnitude: -5,
    mode: "delta",
    label: "接缝桩·旧",
    createdAt: "2026-08-20T01:00:00.000Z",
  },
];

/** 世界里的**实测现值**：`value` 只许从这里取（不许按 magnitude/mode 自己再算一遍）。 */
const WORLD: TickState = { obj_a1: { loadIndex: 42 }, obj_b1: { queueLen: 7 } };

const VIEW_CONFIG: SandboxViewConfig = {
  tenantId: "demo",
  nodeTypes: ["TypeA", "TypeB"],
  linkTypes: ["linkAB"],
  stateVars: ["loadIndex", "queueLen"],
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"],
  propagationCount: 1,
  nodeObjectIds: { TypeA: ["obj_a1"], TypeB: ["obj_b1"] },
};

/** 瓶颈矩阵：**乙基地更紧** —— 宿主若取"第一行"而不是"最紧那行"，用例 ① 的求解器实参断言会红。 */
const BOTTLENECK: BottleneckMatrixOutput = {
  dataMode: "LIVE",
  factors: ["f_alpha", "f_beta"],
  rows: [
    { base: "甲基地", tightness: { f_alpha: 70, f_beta: 60 }, primary: "f_alpha" },
    { base: "乙基地", tightness: { f_alpha: 55, f_beta: 91 }, primary: "f_beta" },
  ],
};

const impactResponse = (worldId: string): ImpactAnalysisResponse => ({
  basis: {
    engine: "ontology-core.recompute",
    worldId,
    worldTick: 3,
    worldStatus: "RUNNING",
    worldOverlayApplied: 2,
    countBasis: "DISTINCT_OBJECTS",
    derivationSpecCount: 1,
    kpiTypeKeys: [],
    oldValueMismatch: false,
  },
  affectedObjects: { available: true, count: 1, universe: 2, items: [], truncated: false },
  affectedProcesses: {
    available: true,
    count: 1,
    universe: 3,
    truncated: false,
    items: [
      {
        processKey: "P01",
        name: "接缝桩·受影响流程",
        domainKey: "D01",
        ownerFunctionKey: "F01",
        waitKind: "NONE",
        stdDurationDays: 1,
        carrierTypeKey: "TypeA",
        viaObjectIds: ["obj_a1"],
      },
    ],
    instanceLevel: { available: false, reason: "接缝桩：实例粒度今天无承载物", missingCarrier: "ProcessInstance" },
  },
  affectedDecisions: { available: false, reason: "接缝桩：无 KPI 承载物", missingCarrier: "ObjectType(target+actual)" },
  affectedKpis: { available: false, reason: "接缝桩：无 KPI 承载物", missingCarrier: "ObjectType(target+actual)" },
  warnings: [],
});

const MITIGATION_SOLUTION = {
  factor: "f_beta",
  baseName: "乙基地",
  urgency: 0.7,
  recommended: "plan_b",
  plans: [
    { key: "plan_a", name: "接缝桩案甲", eff: 9, tn: 5, cost: "低", score: 0.4 },
    { key: "plan_b", name: "接缝桩案乙", eff: 12, tn: 2, cost: "中", score: 0.9 },
    { key: "plan_c", name: "接缝桩案丙", eff: 8, tn: 3, cost: "中", score: 0.2 },
  ],
};

const err = (status: number, code: string) =>
  HttpResponse.json({ error: { code, message: code, requestId: "req_args" } }, { status });

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 桩与记录器
// ══════════════════════════════════════════════════════════════════════════

let seen: { method: string; url: string }[] = [];
let impactBodies: ImpactAnalysisRequest[] = [];
let solverCalls: { key: string; args: Record<string, unknown> }[] = [];

const urlsMatching = (re: RegExp): string[] => seen.filter((r) => re.test(r.url)).map((r) => `${r.method} ${r.url}`);

const NODE_DETAIL_RE = /\/node-detail/;
const IMPACT_RE = /\/a\/v1\/simulation\/impact-analysis/;
const MITIGATION_RE = /\/a\/v1\/solvers\/mitigation_select\/invoke/;

interface StubOpts {
  /** `"none"` = 三个出处全空 ⇒ 三个入参都解析不出。 */
  derivable?: "all" | "none";
  /** `node-detail` 回一个**不是** `ChainNodeDetail` 的形状（页面必须落占位而不是白屏）。 */
  detailShape?: "contract" | "foreign";
}

function installHandlers(opts: StubOpts = {}): void {
  const derivable = opts.derivable ?? "all";
  server.use(
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [SESSION] })),
    http.get("*/a/v1/sim/sessions/:id/node-detail", () =>
      opts.detailShape === "foreign"
        ? // 前端那份私有形状（clock/directions/…）—— 与契约零个同名字段。
          HttpResponse.json({ clock: "x", directions: ["y"], filters: [], conduction: [], strip: {}, card: {}, flow: [], callout: [] })
        : HttpResponse.json(NODE_DETAIL),
    ),
    http.post("*/a/v1/sim/chain-loss-matrix", () =>
      derivable === "all" ? HttpResponse.json(MATRIX) : err(404, "NOT_FOUND"),
    ),
    http.post("*/a/v1/sim/chain-loss-drill", () => err(404, "NOT_FOUND")),
    http.get("*/a/v1/sim/sessions/:id/perturbations", () =>
      HttpResponse.json({ items: derivable === "all" ? PERTURBATIONS : [] }),
    ),
    http.get("*/a/v1/sim/sessions/:id/world", () => HttpResponse.json({ tick: 3, state: WORLD })),
    http.get("*/a/v1/sim/view-config", () => HttpResponse.json(VIEW_CONFIG)),
    http.post("*/a/v1/simulation/impact-analysis", async ({ request }) => {
      const body = (await request.json()) as ImpactAnalysisRequest;
      impactBodies.push(body);
      return HttpResponse.json(impactResponse(body.worldId));
    }),
    http.post("*/a/v1/solvers/:key/invoke", async ({ params, request }) => {
      const key = String(params.key);
      const body = (await request.json().catch(() => ({}))) as { args?: Record<string, unknown> };
      solverCalls.push({ key, args: body.args ?? {} });
      if (key === "bottleneck_matrix") {
        return HttpResponse.json({
          data: derivable === "all" ? BOTTLENECK : { ...BOTTLENECK, rows: [] },
          snapshotVersion: "ov-wire",
        });
      }
      if (key === "mitigation_select") return HttpResponse.json({ data: MITIGATION_SOLUTION, snapshotVersion: "ov-wire" });
      return err(404, "SOLVER_NOT_FOUND");
    }),
  );
}

const viewOf = (options?: Record<string, unknown>): ViewConfigVM => ({
  key: "sim-conduction",
  title: "sim-conduction",
  renderer: "sim-conduction",
  layout: undefined,
  options,
});

function mount(options?: Record<string, unknown>): HTMLElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <SandboxDetailRoute view={viewOf(options)} />
    </QueryClientProvider>,
  );
  return container;
}

const attr = (root: HTMLElement, sel: string, name: string): string | null =>
  root.querySelector(sel)?.getAttribute(name) ?? null;

const hostAttr = (root: HTMLElement, name: string): string | null =>
  attr(root, '[data-testid="sandbox-console-host"]', name);

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 用例
// ══════════════════════════════════════════════════════════════════════════

describe("WO-SIM-DETAIL-WIRE · 传导识别页宿主组装参数（接缝）", () => {
  beforeEach(() => {
    seen = [];
    impactBodies = [];
    solverCalls = [];
    server.events.on("request:start", ({ request }) => seen.push({ method: request.method, url: request.url }));
  });
  afterEach(() => {
    server.events.removeAllListeners("request:start");
    cleanup();
  });

  it("⓪ 金丝雀：三条派生规则与记录器先自证（不中 ⇒ 报「判据坏了」，不许读作「接线对了」）", async () => {
    // (a) 「最近一条扰动」：数组顺序与时间顺序**刻意相反**，两个方向各堵一个。
    expect(pickLatestPerturbation(PERTURBATIONS)?.id, "拿数组最后一个当「最近」⇒ 判据坏了").toBe("pert_new");
    expect(pickLatestPerturbation([]), "空清单必须给 undefined").toBeUndefined();
    // 同 tick 连下两条 ⇒ 判据必须落在 `createdAt` 上。`id` 字典序在这里**恰好相反**
    //（`pert_a` < `pert_z`），照 id 排会挑出先下的那条 —— 真跑时这个坑真的踩到了。
    const sameTick: Perturbation[] = [
      { ...PERTURBATIONS[0]!, id: "pert_z", startTick: 5, createdAt: "2026-08-20T03:00:00.000Z" },
      { ...PERTURBATIONS[0]!, id: "pert_a", startTick: 5, createdAt: "2026-08-20T04:00:00.000Z" },
    ];
    expect(pickLatestPerturbation(sameTick)?.id, "同 tick 时按 id 排了 ⇒ 挑中的是先下的那条").toBe("pert_a");

    // (b) 类型反查：查得到 / 查不到必须分得开（查不到 = undefined，不是空串）。
    expect(objectTypeOf(VIEW_CONFIG, "obj_a1")).toBe("TypeA");
    expect(objectTypeOf(VIEW_CONFIG, "obj_zzz"), "不在册的对象反查出了一个类型 ⇒ 反查坏了").toBeUndefined();
    expect(objectTypeOf(undefined, "obj_a1")).toBeUndefined();

    // (c) 三样缺一 ⇒ 不许拼出一处变更（拼出来就会去换一个确凿的假半径）。
    expect(deriveImpactChange(PERTURBATIONS[0], WORLD, VIEW_CONFIG)).toEqual({
      objectType: "TypeA",
      objectId: "obj_a1",
      prop: "loadIndex",
      value: 42,
    });
    expect(deriveImpactChange(undefined, WORLD, VIEW_CONFIG), "没有扰动却拼出了变更").toBeUndefined();
    expect(deriveImpactChange(PERTURBATIONS[0], {}, VIEW_CONFIG), "世界里没这个读数却拼出了变更").toBeUndefined();
    expect(deriveImpactChange(PERTURBATIONS[0], WORLD, undefined), "反查不出类型却拼出了变更").toBeUndefined();

    // (d) 处置口径取**最紧那格**，且**不下传 tightness**（下传会让引擎不再出 dataMode）。
    expect(deriveMitigation(BOTTLENECK)).toEqual({ baseName: "乙基地", factor: "f_beta" });
    expect(deriveMitigation({ ...BOTTLENECK, rows: [] }), "空矩阵却给出了处置口径").toBeUndefined();
    expect(deriveMitigation(undefined)).toBeUndefined();

    // (e) 记录器：先证明它真的会记到东西，否则下面每一条「一个请求都没发」都是空转。
    installHandlers();
    expect(seen, "记录器起点必须干净").toHaveLength(0);
    await fetch("http://a.test/a/v1/sim/sessions");
    expect(urlsMatching(/\/a\/v1\/sim\/sessions/), "记录器一条都没记到 ⇒ 记录器坏了").toHaveLength(1);
  });

  it("① 三个出处齐 ⇒ 三跳真发出去、三个诚实位分别翻 endpoint / impact-analysis / solver", async () => {
    installHandlers({ derivable: "all" });
    const root = mount();

    // 先等宿主定态，再读诚实位（顺序反过来会把"还没查完"读成"查完了"）。
    await waitFor(() => expect(hostAttr(root, "data-session-reason")).toBe("auto"));
    await waitFor(() => expect(hostAttr(root, "data-node-source")).toBe("derived"));
    await waitFor(() => expect(hostAttr(root, "data-impact-change-source")).toBe("derived"));
    await waitFor(() => expect(hostAttr(root, "data-mitigation-source")).toBe("derived"));

    // ── 缝 ① 节点详情：落点来自矩阵 `[0]`，且请求真带上了它 ──────────────────
    await waitFor(() => expect(attr(root, '[data-testid="sandbox-detail"]', "data-source")).toBe("endpoint"));
    expect(attr(root, '[data-testid="sandbox-detail"]', "data-detail-reason")).toBe("ok");
    expect(hostAttr(root, "data-node-id"), "落点不是矩阵 `[0]`（取成了「损失最大的那个」？）").toBe("capacity.aging");
    const detailHits = urlsMatching(NODE_DETAIL_RE);
    expect(detailHits, "node-detail 一条都没发").not.toHaveLength(0);
    for (const u of detailHits) {
      expect(u, "请求没带 nodeId ⇒ 后端必 400（这正是本单要修的那条）").toContain("nodeId=capacity.aging");
      expect(u).toContain("sims_wire");
    }
    // 回包真被投影上屏：卡与流转明细翻真，传导识别表如实留在占位（端点答不出那三列）。
    expect(attr(root, '[data-testid="sandbox-detail-card"]', "data-prov")).toBe("endpoint");
    expect(attr(root, '[data-testid="sandbox-detail-flow"]', "data-prov")).toBe("endpoint");
    expect(
      attr(root, '[data-testid="sandbox-detail-flow"]', "data-prov-time"),
      "端点没有时间这一量，标成 endpoint 就是冒充",
    ).toBe("placeholder");
    expect(
      attr(root, '[data-testid="sandbox-detail-conduction"]', "data-prov"),
      "端点答不出型号/影响级/耗时，传导识别表不许标真",
    ).toBe("placeholder");
    // 屏上真出现了回包里的值（不是"属性翻了但没渲染"）。
    expect(root.querySelector('[data-testid="sandbox-detail-flow"]')?.textContent).toContain("LOT-W-1");
    expect(root.querySelector('[data-testid="sandbox-detail-card"]')?.textContent).toContain("老化静置");

    // ── 缝 ② 影响半径：body 里的那处变更逐字节 = 扰动落点 × 世界实测现值 ────────
    await waitFor(() => expect(attr(root, '[data-testid="sandbox-detail-cone"]', "data-source")).toBe("impact-analysis"));
    expect(urlsMatching(IMPACT_RE), "impact-analysis 一条都没发").not.toHaveLength(0);
    expect(impactBodies[0]?.worldId).toBe("sims_wire");
    expect(impactBodies[0]?.change, "变更不是「最近那条扰动 × 世界里的实测现值」").toEqual({
      objectType: "TypeA",
      objectId: "obj_a1",
      prop: "loadIndex",
      value: 42,
    });
    expect(root.querySelector('[data-testid="sandbox-detail-cone"]')?.textContent).toContain("接缝桩·受影响流程");

    // ── 缝 ③ 应对策略：求解器实参 = 最紧那格，且**没有** tightness ────────────
    await waitFor(() => expect(attr(root, '[data-testid="sandbox-detail-strategies"]', "data-source")).toBe("solver"));
    const mit = solverCalls.filter((c) => c.key === "mitigation_select");
    expect(mit, "mitigation_select 一次都没调").not.toHaveLength(0);
    expect(mit[0]?.args.baseName, "基地不是瓶颈矩阵里最紧的那个").toBe("乙基地");
    expect(mit[0]?.args.factor, "因素不是该基地自己的 primary").toBe("f_beta");
    expect(
      Object.prototype.hasOwnProperty.call(mit[0]?.args ?? {}, "tightness"),
      "把矩阵里的 tightness 直传下去了 ⇒ 引擎不再现算、也不再出 dataMode，屏上那份紧张度失去凭证",
    ).toBe(false);
    expect(root.querySelector('[data-testid="sandbox-detail-strategies"]')?.textContent).toContain("接缝桩案乙");
  });

  it("② 三个出处全空 ⇒ 三跳**一个请求都不发**，三个诚实位仍是 placeholder 且说得出为什么", async () => {
    installHandlers({ derivable: "none" });
    const root = mount();

    await waitFor(() => expect(hostAttr(root, "data-session-reason")).toBe("auto"));
    await waitFor(() => expect(hostAttr(root, "data-node-source")).toBe("unavailable"));
    await waitFor(() => expect(hostAttr(root, "data-impact-change-source")).toBe("unavailable"));
    await waitFor(() => expect(hostAttr(root, "data-mitigation-source")).toBe("unavailable"));

    // 有会话（`auto`）但三个入参都没有 —— 这两件事必须分得开，只看 data-source 是分不出来的。
    expect(hostAttr(root, "data-session-id"), "会话是有的，落占位不是因为没会话").toBe("sims_wire");
    expect(attr(root, '[data-testid="sandbox-detail"]', "data-source")).toBe("placeholder");
    expect(attr(root, '[data-testid="sandbox-detail"]', "data-detail-reason")).toBe("no-node");
    expect(attr(root, '[data-testid="sandbox-detail-cone"]', "data-source")).toBe("placeholder");
    expect(attr(root, '[data-testid="sandbox-detail-strategies"]', "data-source")).toBe("placeholder");

    // 反向断言：三条**注定失败/无意义**的请求一条都不许发出去。
    expect(urlsMatching(NODE_DETAIL_RE), "没有落点还去打 node-detail ⇒ 又一条注定 400 的请求").toEqual([]);
    expect(urlsMatching(IMPACT_RE), "没有「改了什么」还去算影响半径").toEqual([]);
    expect(urlsMatching(MITIGATION_RE), "没有基地/因素还去调处置优选").toEqual([]);
    expect(solverCalls.filter((c) => c.key === "mitigation_select"), "同上（按实参口径再咬一遍）").toEqual([]);

    // 主容器仍在 DOM 里 = 落占位不是白屏。
    expect(root.querySelector('[data-testid="sandbox-detail"]')).not.toBeNull();
  });

  it("③ 端点回了一个不认识的形状 ⇒ 落占位 + 报 shape-mismatch，**不白屏**（病③ 的反向证据）", async () => {
    installHandlers({ derivable: "all", detailShape: "foreign" });
    const root = mount();

    await waitFor(() => expect(hostAttr(root, "data-node-source")).toBe("derived"));
    // 请求是真发出去了、也真回了 200 —— 只是形状不认识。
    await waitFor(() => expect(urlsMatching(NODE_DETAIL_RE)).not.toHaveLength(0));
    await waitFor(() =>
      expect(attr(root, '[data-testid="sandbox-detail"]', "data-detail-reason")).toBe("shape-mismatch"),
    );
    expect(attr(root, '[data-testid="sandbox-detail"]', "data-source")).toBe("placeholder");
    // 「这一跳挂了」与「回来的东西我不认识」必须分得开 —— 前者查端点，后者查前端的投影。
    expect(attr(root, '[data-testid="sandbox-detail"]', "data-detail-reason")).not.toBe("request-failed");
    expect(root.querySelector('[data-testid="sandbox-detail"]'), "白屏了").not.toBeNull();
    expect(root.querySelector('[data-testid="sandbox-detail-conduction"]')?.textContent, "占位表没渲染 ⇒ 半个白屏").toContain(
      "P2161",
    );
  });
});
