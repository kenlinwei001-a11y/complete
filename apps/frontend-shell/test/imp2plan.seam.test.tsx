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
      trialTick: { passed: false, rulesFired: 0, at: null, error: null },
      worldCompleteness: { pct: 55, stateVars: { present: 2, needed: 4 }, derivationRules: { present: 1, needed: 2 }, actions: { present: 0, needed: 1 }, propagationRules: { present: 0, needed: 0 }, entering: [] },
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
} from "@/views/sim/sandboxConsole";

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

const CFG: SandboxViewConfig = {
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

  it("join 缺失时病因文案正确：说清「没对到」+「为什么」+「下面 5 区是默认根因」", async () => {
    const user = userEvent.setup();
    mountApp();
    await screen.findByTestId("sandbox-console");
    await waitFor(() => expect(screen.getByTestId("sc-imp-jump")).toBeTruthy());

    const model = buildChainImpedimentModel(loadImp());
    const first = impedimentHandoffs(model, null)[0]!;
    expect(first.handoff.join.status).toBe("NO_FACTOR_DIMENSION");
    await user.click(screen.getByTestId(`sc-imp-jump-${first.im.impedimentId}`));

    const gap = await screen.findByTestId("dp-from-join-gap");
    const txt = gap.textContent ?? "";
    expect(txt).toContain("本次未能把这个阻滞点对到具体因子");
    expect(txt).toContain("CausalFactor"); // 缺的是哪一维
    expect(txt).toContain("strictObject"); // 为什么缺（契约层的实证，不是"暂不支持"）
    expect(txt).toContain("MaterialBatch"); // 撞不上的实测证据
    // 最要害的一句：别让人以为下面 5 区是这条阻滞点的根因
    expect(screen.getByTestId("dp-from-default-root").textContent).toContain("默认根因");
    expect(screen.queryByTestId("dp-from-join-ok")).toBeNull();
    // 能带过去的粗筛维当面说
    expect(txt).toContain(`stage=${first.im.stage}`);
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
