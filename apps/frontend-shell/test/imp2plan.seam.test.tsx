import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ChainImpedimentSchema, type SandboxViewConfig } from "@platform/contracts";

/**
 * WO-SANDBOX-IMP2PLAN · **沙盘缺的那一跳** —— SEAM 门。
 *
 * ── 这道门咬的是「跳」，不是「按钮在不在」────────────────────────────────────
 * 「阻滞点条上有可点的东西」是**画上去就有**的，断言它等于没断言。本门咬三件真事：
 *  ① **真导航**：喂一份真实形状的 `chain_impediments` 回包 → 点某条阻滞点 →
 *     断言 URL **真的变成** `/v/decision-play` 且 query **逐键**对（不是"含某个串"）。
 *  ② **join 缺失时病因文案正确**：没对到因子时，屏上必须写清"没对到"+"为什么"+
 *     "因此下面 5 区是引擎默认根因，不是这条阻滞点的根因"。
 *  ③ **诚实位随行**：`dataMode !== "LIVE"` 的阻滞点跳过去后限定仍在（不许在跳转时掉）。
 *
 * ── 会红的断言（本门的真正价值）──────────────────────────────────────────────
 * §4 那两条是**给引擎侧 WO-SANDBOX-S3 埋的绊线**：
 *  · 今天 contracts `ChainImpedimentSchema` 是 `z.strictObject`，塞一个 `factorId` **必抛**；
 *  · 故基线 fixture 全量阻滞点的 join status 恒为 `NO_FACTOR_DIMENSION`。
 * 等 S3 在契约上补出因子维那天，这两条**当场红**，逼着把本页的诚实位换成真跳转
 * （而不是留一句过期的"今天对不上"）。
 *
 * R6 确定性：无时钟、无随机；网络全桩。
 */

// ── 网络桩 ────────────────────────────────────────────────────────────────────
const net = vi.hoisted(() => ({
  imp: null as unknown,
  loss: null as unknown,
  dpCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    runSolver: vi.fn(async (key: string) => {
      if (key === "chain_loss_attribution") return { data: net.loss, snapshotVersion: "sv-test" };
      if (key === "chain_impediments") return { data: net.imp, snapshotVersion: "sv-test" };
      throw new Error(`[imp2plan.seam] 未编排的求解器：${key}`);
    }),
    invokeSolver: vi.fn(async (key: string, args: Record<string, unknown>) => {
      if (key !== "decision_play") throw new Error(`[imp2plan.seam] 未编排的求解器：${key}`);
      net.dpCalls.push(args);
      // 引擎侧行为忠实复刻：传不传 factorId 都会给出一个根因（对不上时**静默回落**到默认根因）。
      return {
        data: {
          rootCause: { factorId: "cf-cert-cycle", label: "认证周期长", metricKey: "supply_gap", gap: 1200, unit: "吨" },
          options: [],
          matrix: [],
          triggers: [],
          recommendedPlan: { planId: "p1", optionIds: [], steps: [], totalClosesGap: 0, totalCost: 0 },
          sandboxNarrowing: { beforeGap: 1200, afterGap: 1200, narrowedPct: 0, ticks: 0 },
          summary: "（门用）",
        },
      };
    }),
    createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
      id: "sims_imp2plan", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
      curTick: 0, parentCheckpointId: null, createdAt: "2026-06-25T00:00:00.000Z",
    })),
    simTick: vi.fn(async (_id: string, n: number) => ({ curTick: n, state: {} })),
    fetchSimCertification: vi.fn(async () => ({
      scope: "GLOBAL", targetRef: null, level: "L2_RUNNABLE",
      dims: { structure: 60, knowledge: 40, behavior: 30, composite: 45 },
      l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
      trialTick: { passed: false, derivationNodes: 0, propagationCovered: false, at: null, error: null },
      worldCompleteness: { pct: 55, derivationRules: { present: 1, needed: 2 }, actions: { present: 0, needed: 1 }, propagationRules: { present: 0, needed: 0 }, stateVarKeys: [], entering: [] },
      canEnterSimulation: false, gaps: [], computedAt: "2026-06-25T00:00:00.000Z",
    })),
    searchObjects: vi.fn(async () => ({ items: [], total: 0 })),
  };
});

import SandboxView from "@/views/sim/SandboxView";
import DecisionPlayView from "@/views/DecisionPlayView";
import { ChainLossPayloadSchema, type ChainLossPayload } from "@/views/sim/chainLineMap";
import {
  buildChainImpedimentModel,
  ChainImpedimentPayloadSchema,
  type ChainImpedimentPayload,
} from "@/views/sim/chainImpediment";
import {
  DECISION_PLAY_PATH,
  IMP_PARAM,
  deriveImpedimentHandoff,
  factorRefOf,
  impedimentHandoffs,
  impedimentJoinReason,
  locusTypesOf,
} from "@/views/sim/sandboxConsoleModel";

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
  throw new Error(`[imp2plan.seam] 找不到仓根（自 ${TEST_DIR} 向上未见 pnpm-workspace.yaml）`);
})();
const FIX = join(REPO_ROOT, "apps/frontend-shell/test/fixtures");

function loadImp(): ChainImpedimentPayload {
  const raw = JSON.parse(readFileSync(join(FIX, "chain-impediment-baseline.json"), "utf8")) as Record<string, unknown>;
  delete raw.__fixture_provenance;
  return ChainImpedimentPayloadSchema.parse(raw);
}
function loadLoss(): ChainLossPayload {
  return ChainLossPayloadSchema.parse(JSON.parse(readFileSync(join(FIX, "chain-loss-real.json"), "utf8")));
}

/**
 * 沙盘视图配置 —— 必须是**完整**的 `SandboxViewConfig`，不是 Partial。
 *
 * 坑（本门曾据此全红）：`SandboxView` 的 prop 是 `injectedConfig?: SandboxViewConfig`（整份，非 Partial），
 * 而契约 `SandboxViewConfigSchema` 里只有 `nodeObjectIds` 是 `.optional()` —— `tenantId`/`nodeTypes`/`linkTypes`
 * 全是**必填**。少了 `nodeTypes`，`SandboxView.tsx:97 buildNodes` 的 `cfg.nodeTypes.map` 直接在**渲染期**抛
 * `TypeError: Cannot read properties of undefined (reading 'map')`，§2 三条在跑到任何断言前就死了
 * （栈里是 `mountIndeterminateComponent`/`recoverFromConcurrentError` = React 渲染期，不是断言失败）。
 * 这类漏字段 `tsc` 是看得见的（TS2739），但 `tsconfig.build.json` 把 `test` 排除了、四包门又只跑 build+test
 * 不跑 typecheck ⇒ 唯一会说话的工具没被接进门。故此处显式写全，并留此注释。
 *
 * `nodeTypes` 取 fixture 里阻滞点 locus 的**真实对象类型**，让沙盘拓扑与阻滞点同源（而非凭空造名）。
 */
const CFG: SandboxViewConfig = {
  tenantId: "demo", // = fixture 里 impediments[].tenantId
  nodeTypes: ["MaterialBatch", "MaterialBalance", "Line"], // = 基线 fixture 全部 locus.objectType
  linkTypes: ["feeds", "produces"],
  stateVars: ["risk", "load"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 2,
};

/** URL 探针：把当前 location 原样吐到 DOM，测试据此断言「真的导航到了哪」。 */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="probe-url">{`${loc.pathname}${loc.search}`}</div>;
}

/** 真挂路由：沙盘 → `/v/decision-play`。点击走的是生产那条 `navigate()`，不是测试自己造的跳转。 */
function mountApp() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/sandbox"]}>
        <LocationProbe />
        <Routes>
          <Route path="/sandbox" element={<SandboxView injectedConfig={CFG} />} />
          <Route path="/v/decision-play" element={<DecisionPlayView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  net.imp = loadImp();
  net.loss = loadLoss();
  net.dpCalls = [];
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════════
describe("§1 派生层 · 阻滞点 → 决策推演的入参（纯函数，可逐键咬）", () => {
  it("每条阻滞点都产出可跳 URL；query 逐键 = 引擎载荷的真字段（不是任意字符串）", () => {
    const model = buildChainImpedimentModel(loadImp());
    const rows = impedimentHandoffs(model, null);
    expect(rows.length).toBe(model.total);

    for (const { im, handoff } of rows) {
      expect(handoff.href.startsWith(`${DECISION_PLAY_PATH}?`)).toBe(true);
      const q = new URLSearchParams(handoff.href.split("?")[1]);
      // 逐键咬真值 —— 改引擎载荷里的 locus/stage/ruleKey，这里必须跟着变。
      expect(q.get(IMP_PARAM.from)).toBe(im.impedimentId);
      expect(q.get(IMP_PARAM.kind)).toBe(im.kind);
      expect(q.get(IMP_PARAM.stage)).toBe(im.stage);
      expect(q.get(IMP_PARAM.locusType)).toBe(im.locus.objectType);
      expect(q.get(IMP_PARAM.locusId)).toBe(im.locus.objectId);
      expect(q.get(IMP_PARAM.locusLabel)).toBe(im.locus.label);
      expect(q.get(IMP_PARAM.mode)).toBe(im.honesty.mode);
      if (im.evidence.ruleKey !== null) expect(q.get(IMP_PARAM.rule)).toBe(im.evidence.ruleKey);
    }
  });

  it("`status === \"JOINED\"` ⟺ 带 factorId —— 没对上就一个 factorId 都不传（不猜）", () => {
    const model = buildChainImpedimentModel(loadImp());
    for (const { handoff } of impedimentHandoffs(model, null)) {
      expect(handoff.params[IMP_PARAM.factor] === undefined).toBe(handoff.join.status !== "JOINED");
      expect(handoff.href.includes("factorId=")).toBe(handoff.join.status === "JOINED");
    }
  });

  /*
   * 病因文案里「本次这批落在几类对象上」是**现算**的 —— 换一份载荷，这句话必须跟着变。
   *
   * 这条门守的是本单的核心对策：屏上那句原本写的是「demo 的 locus 只有
   * MaterialBalance / MaterialBatch / Line **三类**」，是 2026-08-08 的一次性测量被写死进文案；
   * 上游判据绑定长出第四类 `Base` 之后，它在屏上说了六天谎而没有任何人会被通知。
   * 判据：**能从手里的载荷数出来的数，一律不许写死** —— 故这里咬「换载荷即变」，
   * 而不是咬某个具体的数（咬数就又造了一个会过期的断言）。
   */
  it("病因文案里的类数是**现算**的：换一份载荷，这句话跟着变；且不留写死的「三类」", () => {
    const model = buildChainImpedimentModel(loadImp());
    const types = locusTypesOf(model);
    expect(types.length).toBeGreaterThan(0);

    const reason = impedimentHandoffs(model, null)[0]!.handoff.join.reason;
    expect(reason).toContain(`本次这批阻滞点落在 ${types.length} 类对象上`);
    for (const t of types) expect(reason).toContain(t);
    // 旧文案那两句已被证伪的写死断言，一个字都不许再出现。
    expect(reason).not.toContain("只有 MaterialBalance / MaterialBatch / Line 三类");
    expect(reason).not.toContain("一条都没有");

    // 只留一类 locus 的载荷 ⇒ 现算值必须变（写死的话这条当场红）。
    const oneType = model.groups.flatMap((g) => g.items)[0]!.locus.objectType;
    const narrowed = {
      ...model,
      groups: model.groups.map((g) => ({ ...g, items: g.items.filter((im) => im.locus.objectType === oneType) })),
    };
    expect(locusTypesOf(narrowed)).toEqual([oneType]);
    expect(impedimentJoinReason("NO_FACTOR_DIMENSION", locusTypesOf(narrowed))).toContain("落在 1 类对象上");
  });

  it("诚实位随行：dataMode !== LIVE ⇒ caveat 非空且 query 带 impMode（③）", () => {
    const model = buildChainImpedimentModel(loadImp());
    const degraded = impedimentHandoffs(model, null).filter(({ im }) => im.honesty.degraded);
    expect(degraded.length).toBeGreaterThan(0); // 基线里确有 PARTIAL/SYNTHETIC，不然本条是空转
    for (const { im, handoff } of degraded) {
      expect(handoff.caveat).not.toBeNull();
      expect(handoff.caveat?.mode).toBe(im.honesty.mode);
      expect(handoff.params[IMP_PARAM.mode]).toBe(im.honesty.mode);
    }
  });

  it("因子维是**探**出来的，不是写死的 null：载荷里一旦有因子维，status 立刻翻 JOINED", () => {
    const model = buildChainImpedimentModel(loadImp());
    const im = model.groups.flatMap((g) => g.items)[0]!;
    expect(factorRefOf(im)).toBeNull(); // 今天：契约里没有这一维

    // 模拟 WO-SANDBOX-S3 补上因子维之后的载荷形状 → 本层零改动即接通。
    const withFactor = { ...im, factorId: "cf-material-short" } as typeof im;
    expect(factorRefOf(withFactor)).toBe("cf-material-short");
    const h = deriveImpedimentHandoff(withFactor);
    expect(h.join.status).toBe("JOINED");
    expect(h.params[IMP_PARAM.factor]).toBe("cf-material-short");
    expect(h.join.carried).toContain("factorId");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§2 接缝 · 点一条阻滞点 → 真的导航到决策推演，且带对了参数", () => {
  it("点击 → URL 真的变成 /v/decision-play 且 query 逐键对；决策推演页真渲染", async () => {
    const user = userEvent.setup();
    mountApp();
    await screen.findByTestId("sandbox-console");
    await waitFor(() => expect(screen.getByTestId("sc-imp-jump")).toBeTruthy());

    // 取屏上第一条（顺序 = contracts 冻结全序，本层不重排）
    const model = buildChainImpedimentModel(loadImp());
    const first = impedimentHandoffs(model, null)[0]!;
    const row = screen.getByTestId(`sc-imp-jump-${first.im.impedimentId}`);
    expect(row.getAttribute("href")).toBe(first.handoff.href);

    await user.click(row);

    // ① 真导航（不是"按钮在"）：URL 探针读到的是真 location。
    await waitFor(() => {
      expect(screen.getByTestId("probe-url").textContent).toBe(first.handoff.href);
    });
    const url = screen.getByTestId("probe-url").textContent!;
    const q = new URLSearchParams(url.split("?")[1]);
    expect(url.startsWith(DECISION_PLAY_PATH)).toBe(true);
    expect(q.get(IMP_PARAM.from)).toBe(first.im.impedimentId);
    expect(q.get(IMP_PARAM.locusId)).toBe(first.im.locus.objectId);
    expect(q.get(IMP_PARAM.stage)).toBe(first.im.stage);

    // ② 决策推演页真收到了这条阻滞点（横幅出，且 locus 是真对象 id）
    const banner = await screen.findByTestId("dp-from-impediment");
    expect(banner.getAttribute("data-impediment-id")).toBe(first.im.impedimentId);
    expect(screen.getByTestId("dp-from-locus").textContent).toContain(first.im.locus.objectId);

    // ③ 没对到因子 ⇒ **绝不能**把 factorId 传给引擎（传了就是让它静默回落成编造）
    await waitFor(() => expect(net.dpCalls.length).toBeGreaterThan(0));
    expect(net.dpCalls[0]!.factorId).toBeUndefined();
  });

  /*
   * ⚠ 本例的判据口径于 2026-08-14 变过一次（WO-FE-RED-7），**不许改回去**，来历如下：
   *
   * 旧判据咬的是**术语字面**：要求这块横幅的 textContent 直接含
   * `CausalFactor` / `strictObject` / `MaterialBatch` 三个词。
   * 那是错的，两条原因各自独立成立：
   *  ① **与另一道门正面冲突**：`scripts/check-dev-jargon-onscreen.mjs` 明令
   *     契约类型名与 zod 术语不许上屏（仓主原话：「这些都是我看不懂的功能」）。
   *     旧判据站在被禁的那一边 —— 它是在**逼源码违规**，测试绿等于门红。
   *  ② **咬错了层**：按 `docs/CONVENTION-ui-information-layering.md` §1，
   *     「为什么对不上」这类**口径/机制**属浮层，不属第一层。它已被移进
   *     `InfoPopover topic="为什么对不上"`，而 `InfoPopover` 在 `open===false` 时
   *     **根本不渲染**（不是 hidden）⇒ 不触发就读不到，旧断言从此恒假。
   *
   * 新判据咬**语义**，不咬术语 —— 原来要守的那三件事一件没少，且各自钉在**它该在的那一层**：
   *   ⓐ「没对到」  → 第一层（不许降层：降了用户会把下面的推演当成对自己问题的回答）
   *   ⓑ「为什么」  → 浮层正文，且必须是**实证**（撞不上的实测）而**不是**「暂不支持」这种搪塞
   *   ⓒ「下面是默认根因」→ 第一层（最要害的一句）
   * 其中 ⓑ 的反向断言（不许出现「暂不支持」）比旧判据**更咬得住原来那个病** ——
   * 旧判据只要源码里塞个 `strictObject` 就能骗过，新判据要求这句话真的在给证据。
   */
  it("join 缺失时病因文案正确：说清「没对到」+「为什么」+「下面是默认根因」", async () => {
    const user = userEvent.setup();
    mountApp();
    await screen.findByTestId("sandbox-console");
    await waitFor(() => expect(screen.getByTestId("sc-imp-jump")).toBeTruthy());

    const model = buildChainImpedimentModel(loadImp());
    const first = impedimentHandoffs(model, null)[0]!;
    expect(first.handoff.join.status).toBe("NO_FACTOR_DIMENSION");
    await user.click(screen.getByTestId(`sc-imp-jump-${first.im.impedimentId}`));

    const gap = await screen.findByTestId("dp-from-join-gap");
    // ① 第一层只留**结论** —— 「没对到」这一句必须常驻，不许躲进浮层。
    expect(gap.textContent ?? "").toContain("本次未能把这个阻滞点对到具体因子");
    // 最要害的一句：别让人以为下面的推演是这条阻滞点的根因
    expect(screen.getByTestId("dp-from-default-root").textContent).toContain("默认根因");
    expect(screen.queryByTestId("dp-from-join-ok")).toBeNull();

    /*
     * ② 「为什么对不上」按 UI 分层降到 `?` 浮层 —— **浮层关着时正文根本不在 DOM 里**
     *   （`InfoPopover` 是 `{open ? <span…> : null}`，不是 `display:none`）。
     *   ⚠ 本条此前**长期假红**并被当成"文案没写"：旧断言直接读 `gap.textContent` 找
     *   「CausalFactor / strictObject / MaterialBatch」，而那段正文自打降层那天起就不在
     *   关闭态的 DOM 里 ⇒ 断言恒不成立。判据必须**先证不在、触发、再证在**，
     *   否则读到的是"浮层没开"而不是"文案不对"。
     */
    expect(screen.queryByTestId("dp-from-why-body")).toBeNull(); // 关着时：不在 DOM（不是 not.toBeVisible）
    await user.click(screen.getByTestId("info-dp-from-why"));
    const body = await screen.findByTestId("dp-from-why-body");
    expect(body).toBeVisible();
    const why = body.textContent ?? "";

    // ③ 浮层正文咬**定性**，不咬会过期的一次性测量。
    //   旧断言咬的是「CausalFactor / strictObject / MaterialBatch」——那段文案里
    //   「locus 只有三类」「MaterialBatch 一条都没有」两句 2026-08-14 复核确认已是假话，
    //   测试若咬着它们，就等于**反过来把屏上的谎话钉死**（改对文案 = 测试变红）。
    expect(why).toContain("因果因子"); // 缺的是哪一维（说人话，不上契约类型名）
    expect(why).toContain("缺的是判据，不是数据"); // 真病因的定性（缺判据 ≠ 缺数据，修法完全不同）
    expect(why).toContain("通配"); // 为什么缺：下钻对象写的是通配，而「通配算不算对上」没定义
    // 能带过去的粗筛维当面说
    expect(why).toContain(`stage=${first.im.stage}`);
  });

  it("③ 诚实位不许在跳转时掉：PARTIAL/SYNTHETIC 的限定跳过去后仍在屏上", async () => {
    const user = userEvent.setup();
    mountApp();
    await screen.findByTestId("sandbox-console");
    await waitFor(() => expect(screen.getByTestId("sc-imp-jump")).toBeTruthy());

    const model = buildChainImpedimentModel(loadImp());
    const degraded = impedimentHandoffs(model, null).find(({ im }) => im.honesty.degraded)!;
    expect(degraded).toBeTruthy();
    await user.click(screen.getByTestId(`sc-imp-jump-${degraded.im.impedimentId}`));

    const caveat = await screen.findByTestId("dp-from-caveat");
    expect(caveat.getAttribute("data-mode")).toBe(degraded.im.honesty.mode);
    expect((caveat.textContent ?? "").length).toBeGreaterThan(10);
    expect(screen.getByTestId("dp-from-impediment").getAttribute("data-mode")).toBe(degraded.im.honesty.mode);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§3 零回归 · 不带 imp 参数进决策推演时，本单一个字都不多出", () => {
  it("直接进 /v/decision-play（无 fromImpediment）⇒ 无入口横幅，5 区照常", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/v/decision-play"]}>
          <Routes>
            <Route path="/v/decision-play" element={<DecisionPlayView />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId("decision-play");
    expect(screen.queryByTestId("dp-from-impediment")).toBeNull();
    expect(screen.getByTestId("dp-root-cause")).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§4 绊线 · 引擎侧（WO-SANDBOX-S3）补上因子维那天，这两条当场红", () => {
  it("今天 contracts ChainImpedimentSchema 是 strictObject ⇒ 塞 factorId 必抛（补上就不抛→本条红）", () => {
    const base = loadImp().impediments[0]!;
    // 先自证工具是对的：原样一定过（否则下面的"抛"证明不了任何事）
    expect(() => ChainImpedimentSchema.parse(base)).not.toThrow();
    expect(() => ChainImpedimentSchema.parse({ ...base, factorId: "cf-material-short" })).toThrow();
    expect(() => ChainImpedimentSchema.parse({ ...base, locus: { ...base.locus, factorId: "cf-x" } })).toThrow();
  });

  it("今天基线全量阻滞点 join 恒为 NO_FACTOR_DIMENSION（有一条接通即红）", () => {
    const model = buildChainImpedimentModel(loadImp());
    const rows = impedimentHandoffs(model, null);
    expect(rows.length).toBeGreaterThan(0);
    const joined = rows.filter(({ handoff }) => handoff.join.status === "JOINED");
    expect(joined.map(({ im }) => im.impedimentId)).toEqual([]);
    for (const { handoff } of rows) {
      expect(handoff.join.missing).toBe("factorId（CausalFactor 维）");
      expect(handoff.join.carried).toEqual(["stage"]);
    }
  });
});
