import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SandboxViewConfig } from "@platform/contracts";

/**
 * WO-R13-ONTOCHAIN-PANEL · 结论 ⇐ 本体链（对象 → 边 → 规则/公式）SEAM 门。
 *
 * ── 本文件咬的三条接缝 ────────────────────────────────────────────────────────
 *  ① `ChainLossPayloadSchema` 补上 `evidence[]` 之后，宿主那份载荷**真的带着证据走**
 *     （此前 zod strip 语义当场剥掉 —— 这是本单改的那一行）；
 *     右栏「下钻证据」说明文案同步从「缺字段」翻成「已接通」。
 *  ② 每条阻滞点有一个「本体链」开关（`<a>` 的**兄弟节点**，不是子节点），点开后
 *     对象/边/规则三段**逐段独立断言** —— 变异反证能做到「面板在、规则不在」只红规则断言。
 *  ③ 顶栏结论（前置期 · 流动效率）的本体链开关可展开；聚合结论不经单条派生边 ⇒
 *     边段诚实缺位（`data-present="0"` + 「后端未下发」），响应里真有的派生边去重后逐条列在 gaps。
 *
 * ── 挂载与载荷 ────────────────────────────────────────────────────────────────
 * 走 `SandboxView` 真挂载（同 `sandbox-console.seam` 的六个门路径），网络全桩（R6）。
 * 载荷 = 既有 fixture：`chain-loss-real.json`（28 条 evidence · anchor.so）+
 * `chain-impediment-baseline.json`（8 条阻滞点，evidence 带 ruleKey、**不带** derivationEdge ——
 * 所以「边段缺位」是 fixture 的常态路径，派生边透传靠编排一份带该字段的响应单独证）。
 */

// ── 网络桩（同 sandbox-console.seam 的最小集；记全部调用）──────────────────────
const net = vi.hoisted(() => ({
  loss: null as unknown,
  imp: null as unknown,
  calls: [] as { key: string; args: Record<string, unknown> }[],
}));

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    runSolver: vi.fn(async (key: string, args: Record<string, unknown>) => {
      net.calls.push({ key, args });
      if (key === "chain_loss_attribution") return { data: net.loss, snapshotVersion: "sv-test" };
      if (key === "chain_impediments") return { data: net.imp, snapshotVersion: "sv-test" };
      throw new Error(`[wo-r13-ontochain] 未编排的求解器：${key}`);
    }),
    createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
      id: "sims_r13", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
      curTick: 0, parentCheckpointId: null, createdAt: "2026-08-18T00:00:00.000Z",
    })),
    simTick: vi.fn(async (_id: string, n: number) => ({ curTick: n, state: { x: { v: 1 } } })),
    fetchSimCertification: vi.fn(async () => ({
      scope: "GLOBAL", targetRef: null, level: "L2_RUNNABLE",
      dims: { structure: 60, knowledge: 40, behavior: 30, composite: 45 },
      l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
      trialTick: { passed: false, derivationNodes: 0, propagationCovered: false, at: null, error: null },
      worldCompleteness: { pct: 55, derivationRules: { present: 1, needed: 2 }, actions: { present: 0, needed: 0 }, propagationRules: { present: 0, needed: 0 }, stateVarKeys: [], entering: [] },
      canEnterSimulation: false,
      gaps: [],
      computedAt: "2026-08-18T00:00:00.000Z",
    })),
    searchObjects: vi.fn(async () => ({ items: [], total: 0 })),
  };
});

import SandboxView from "@/views/sim/SandboxView";
import { ChainLossPayloadSchema, type ChainLossPayload } from "@/views/sim/chainLineMap";
import { ChainImpedimentPayloadSchema, type ChainImpedimentPayload } from "@/views/sim/chainImpediment";

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
  throw new Error(`[wo-r13-ontochain] 找不到仓根（自 ${TEST_DIR} 向上未见 pnpm-workspace.yaml）`);
})();
const FIX = join(REPO_ROOT, "apps/frontend-shell/test/fixtures");

function loadLossRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIX, "chain-loss-real.json"), "utf8")) as Record<string, unknown>;
}
function loadLoss(): ChainLossPayload {
  return ChainLossPayloadSchema.parse(loadLossRaw());
}
function loadImpRaw(): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(join(FIX, "chain-impediment-baseline.json"), "utf8")) as Record<string, unknown>;
  delete raw.__fixture_provenance;
  return raw;
}
function loadImp(): ChainImpedimentPayload {
  return ChainImpedimentPayloadSchema.parse(loadImpRaw());
}

const CFG: SandboxViewConfig = {
  tenantId: "tenant-r13",
  nodeTypes: ["Supplier", "Factory", "Order"],
  linkTypes: ["supplies", "produces"],
  stateVars: ["risk", "load"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 2,
};

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

/** 等控制台把两份载荷都上屏（阻滞点四卡出数 + Pareto 出数 ⇒ loss 与 imp 都到了）。 */
async function ready() {
  await screen.findByTestId("sandbox-console");
  await waitFor(() => expect(screen.getByTestId("sc-pareto")).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId("sc-imp-BREAK-count").textContent).not.toBe("—"));
}

beforeEach(() => {
  net.loss = loadLossRaw();
  net.imp = loadImpRaw();
  net.calls.length = 0;
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════════
describe("WO-R13-ONTOCHAIN-PANEL · 结论 ⇐ 本体链", () => {
  // ── 金丝雀：先自证数据源与工具是好的（铁律 0.6）──────────────────────────────
  it("金丝雀 · 两份 fixture 的真形状（否则下面的断言全是空跑）", () => {
    const lossRaw = loadLossRaw();
    const ev = lossRaw.evidence as { derivationEdge: string; solverKey: string }[];
    expect(ev.length, "chain-loss-real.json 必须真带 evidence 行").toBeGreaterThan(20);
    expect(typeof (lossRaw.anchor as { so?: unknown }).so, "载荷必须真带 anchor.so").toBe("string");

    const imp = loadImp();
    expect(imp.impediments.length, "基线阻滞点至少 3 条").toBeGreaterThan(2);
    for (const im of imp.impediments) {
      expect(im.evidence.solverKey, `${im.impedimentId} 缺 solverKey`).toBe("chain_impediments");
      expect(im.evidence.ruleKey, `${im.impedimentId} 缺 ruleKey ⇒ 规则段正向断言咬不到东西`).toBeTruthy();
      // 基线**不带**派生边 ⇒ 「边段缺位」是 fixture 的常态路径（不是本文件编排的特例）
      expect(im.evidence.derivationEdge, `${im.impedimentId} 带了 derivationEdge ⇒ 缺位断言恒真`).toBeUndefined();
    }
  });

  // ── ① schema 补 evidence：宿主那份载荷真的带着证据走 ─────────────────────────
  it("① ChainLossPayloadSchema 不再剥 evidence（本单改的那一行）+ 屏上说明翻成「已接通」", async () => {
    const parsed = ChainLossPayloadSchema.parse(loadLossRaw()) as Record<string, unknown>;
    expect(
      Array.isArray(parsed.evidence) ? parsed.evidence.length : -1,
      "evidence 仍被剥掉 ⇒ 宿主传下去的载荷没有下钻证据（本单的 schema 补齐没生效）",
    ).toBe(28);
    expect("empty" in parsed, "empty[] 是早就声明过的，必须活着").toBe(true);

    // 屏上那句说明同步翻篇（旧文案说的是「缺字段」，新事实不许再那么说）
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId("sc-tab-vars"));
    await screen.findByTestId("node-inspector-root");
    const brief = screen.getByTestId("sc-inspect-evidence-gap-brief").textContent ?? "";
    expect(brief, "说明文案必须反映新事实：证据已随宿主载荷接通").toContain("下钻证据已接通");
    expect(brief, "旧事实（缺字段）不许再印在屏上 —— 那是过期声明").not.toContain("缺字段");
  });

  // ── ② 阻滞点逐条 ⇒ 本体链弹层（三段逐段独立断言）─────────────────────────────
  it("② 点某条阻滞点的「本体链」⇒ 链面板出现，三段各自咬各自的", async () => {
    const im = loadImp().impediments[0]!;
    const user = userEvent.setup();
    mount();
    await ready();

    // 开关是 `<a>` 的**兄弟节点**（不许嵌进链接里：嵌进去点开关会变成跳走）
    const btn = screen.getByTestId(`sc-imp-chain-${im.impedimentId}`);
    expect(btn.closest("a"), "本体链开关嵌进了 <a> —— 必须是它的兄弟节点").toBeNull();
    // 原来的跳转行一个属性没动（href 还在 = 没被我们换成按钮）
    const jump = screen.getByTestId(`sc-imp-jump-${im.impedimentId}`);
    expect(jump.getAttribute("href"), "跳转行的 href 被碰了").toBeTruthy();

    // 关着时面板**不渲染**（不是 hidden）
    expect(screen.queryByTestId(`sc-imp-chain-panel-${im.impedimentId}`)).toBeNull();
    await user.click(btn);
    const panel = await screen.findByTestId(`sc-imp-chain-panel-${im.impedimentId}`);
    const view = `sc-imp-chain-view-${im.impedimentId}`;

    // 对象段：locus 三元组 + 判定依据的实测值/单位（原值透出，不换算）
    const objectLeg = screen.getByTestId(`${view}-object`);
    expect(objectLeg.getAttribute("data-present")).toBe("1");
    expect(objectLeg.textContent, "对象段缺对象类型").toContain(im.locus.objectType);
    expect(objectLeg.textContent, "对象段缺对象 id").toContain(im.locus.objectId);
    expect(objectLeg.textContent, "对象段缺业务名").toContain(im.locus.label);
    expect(screen.getByTestId(`${view}-object-value`).textContent, "对象段缺实测值").toContain(String(im.evidence.metricValue));
    expect(screen.getByTestId(`${view}-object-value`).textContent, "对象段缺单位").toContain(im.evidence.unit);

    // 规则段：规则码 + 求解器（fixture 每条都带 ruleKey —— 金丝雀已自证）
    const ruleLeg = screen.getByTestId(`${view}-rule`);
    expect(ruleLeg.getAttribute("data-present")).toBe("1");
    expect(screen.getByTestId(`${view}-rule-key`).textContent, "规则段缺规则码").toContain(im.evidence.ruleKey!);
    expect(screen.getByTestId(`${view}-rule-solver`).textContent, "规则段缺求解器").toContain(im.evidence.solverKey);

    // 边段：基线响应**不带**派生边 ⇒ 诚实缺位（「后端未下发」+ gaps 写明缺什么）
    const edgeLeg = screen.getByTestId(`${view}-edge`);
    expect(edgeLeg.getAttribute("data-present"), "边段应如实缺位（基线无 derivationEdge）").toBe("0");
    expect(edgeLeg.textContent).toContain("后端未下发");
    expect(screen.getByTestId(`${view}-gaps`).textContent, "gaps 必须写明缺的是派生边").toContain("派生边未下发");

    void panel;
    // 再点一次收起（收起 = 卸载，不是藏）
    await user.click(btn);
    expect(screen.queryByTestId(`sc-imp-chain-panel-${im.impedimentId}`)).toBeNull();
  });

  it("② 派生边透传：响应带 derivationEdge/ruleParamKey 时边段与参数键逐字上屏（编排一份带字段的响应来证）", async () => {
    // 契约里这两个字段是 optional；基线 fixture 恰好都没带。要证「后端一旦下发就原样上屏」，
    // 只能编排一份**带**这两个字段的响应（值照抄 chain-loss-real.json 里真出现过的派生边，不新造）。
    const EDGE = "order_of_customer"; // chain-loss-real.json evidence[].derivationEdge 的真值之一
    const raw = loadImpRaw();
    const first = (raw.impediments as { evidence: Record<string, unknown> }[])[0]!;
    first.evidence.derivationEdge = EDGE;
    first.evidence.ruleParamKey = "idleDays";
    net.imp = raw;
    const im = ChainImpedimentPayloadSchema.parse(raw).impediments[0]!;

    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId(`sc-imp-chain-${im.impedimentId}`));
    const view = `sc-imp-chain-view-${im.impedimentId}`;

    const edgeLeg = await screen.findByTestId(`${view}-edge`);
    expect(edgeLeg.getAttribute("data-present")).toBe("1");
    expect(edgeLeg.textContent, "边段没透出响应里的派生边").toContain(EDGE);
    expect(screen.getByTestId(`${view}-rule`).textContent, "规则段没透出参数键").toContain("idleDays");
    // 边段到了 ⇒ gaps 里那条「派生边未下发」必须不在（缺位说明跟着事实走）
    const gaps = screen.queryByTestId(`${view}-gaps`);
    expect(gaps === null ? "" : gaps.textContent, "边已下发却仍写着「派生边未下发」⇒ 过期声明").not.toContain("派生边未下发");
  });

  it("② 规则码缺位路径：ruleKey 不下发 ⇒ 规则段整体诚实缺位 + gaps 写明（不拿求解器名冒充规则）", async () => {
    const raw = loadImpRaw();
    const first = (raw.impediments as { evidence: Record<string, unknown> }[])[0]!;
    delete first.evidence.ruleKey;
    net.imp = raw;
    const im = ChainImpedimentPayloadSchema.parse(raw).impediments[0]!;

    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByTestId(`sc-imp-chain-${im.impedimentId}`));
    const view = `sc-imp-chain-view-${im.impedimentId}`;

    // 变异反证的落点：面板在、对象段在，**只**规则段缺位 —— 三段各自独立
    expect(screen.getByTestId(`${view}-object`).getAttribute("data-present")).toBe("1");
    const ruleLeg = screen.getByTestId(`${view}-rule`);
    expect(ruleLeg.getAttribute("data-present"), "ruleKey 缺位 ⇒ 规则段必须整体诚实缺位").toBe("0");
    expect(ruleLeg.textContent).toContain("后端未下发");
    expect(screen.getByTestId(`${view}-gaps`).textContent).toContain("规则码未下发");
  });

  // ── ③ 顶栏结论 ⇒ 本体链（聚合结论的诚实缺位）─────────────────────────────────
  it("③ 顶栏「本体链」开关可展开：对象段接 anchor.so，边段诚实缺位，响应真有的派生边逐条列进 gaps", async () => {
    const lossRaw = loadLossRaw();
    const so = (lossRaw.anchor as { so: string }).so;
    const ev = lossRaw.evidence as { derivationEdge: string }[];
    const distinctEdges = [...new Set(ev.map((r) => r.derivationEdge))];

    const user = userEvent.setup();
    mount();
    await ready();

    const toggle = screen.getByTestId("sc-topchain-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("sc-topchain-panel"), "关着时面板必须不渲染").toBeNull();

    await user.click(toggle);
    const panel = await screen.findByTestId("sc-topchain-panel");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // 对象段：锚点订单（响应 anchor.so 真有；类型「Order」取自响应 anchor.selection 的原文语义）
    const objectLeg = screen.getByTestId("sc-topchain-object");
    expect(objectLeg.getAttribute("data-present")).toBe("1");
    expect(objectLeg.textContent, "对象段缺锚点订单号").toContain(so);
    // 规则段：只有真实求解器 key（载荷无规则码/公式字段）
    const ruleLeg = screen.getByTestId("sc-topchain-rule");
    expect(ruleLeg.getAttribute("data-present")).toBe("1");
    expect(screen.getByTestId("sc-topchain-rule-solver").textContent).toContain("chain_loss_attribution");
    // 边段：聚合结论不经单条派生边 ⇒ 诚实缺位；真走过的派生边去重后逐条列 gaps（原值透出）
    const edgeLeg = screen.getByTestId("sc-topchain-edge");
    expect(edgeLeg.getAttribute("data-present"), "聚合结论的边段必须如实缺位").toBe("0");
    expect(edgeLeg.textContent).toContain("后端未下发");
    const gaps = screen.getByTestId("sc-topchain-gaps").textContent ?? "";
    expect(gaps, "gaps 必须带锚点选取口径原文").toContain("锚点选取口径");
    for (const e of distinctEdges) {
      expect(gaps, `gaps 缺响应里真走过的派生边「${e}」`).toContain(e === "" ? "锚点自身对象" : e);
    }
    // 守恒/口径文案不许复制第二份（互指不复制）
    expect(gaps, "不许把分母口径抄第二遍 —— 互指下区说明即可").not.toContain("pctOfChainLoss");

    void panel;
    await user.click(toggle);
    expect(screen.queryByTestId("sc-topchain-panel"), "再点一次应收起（卸载，不是藏）").toBeNull();
  });

  it("③ 载荷未回时：链开关照样点得开，三段如实缺位并写明原因（不拿占位冒充）", async () => {
    net.loss = null; // 线路图取不到数 ⇒ 宿主手里没有载荷
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-console");
    await waitFor(() => expect(screen.getByTestId("sc-imp-BREAK-count").textContent).not.toBe("—"));

    await user.click(screen.getByTestId("sc-topchain-toggle"));
    await screen.findByTestId("sc-topchain-panel");
    expect(screen.getByTestId("sc-topchain-object").getAttribute("data-present")).toBe("0");
    expect(screen.getByTestId("sc-topchain-object").textContent).toContain("后端未下发");
    expect(screen.getByTestId("sc-topchain-edge").getAttribute("data-present")).toBe("0");
    const gaps = screen.getByTestId("sc-topchain-gaps").textContent ?? "";
    expect(gaps, "缺段必须写明为什么缺").toContain("载荷未回");
  });
});
