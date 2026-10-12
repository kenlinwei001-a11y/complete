import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp, loginAs } from "./utils";
import zh from "@/locales/zh";

/**
 * WO-ORDER-JOURNEY · SEAM 门 —— 「看见问题 → 就地推演解法」这一跳。
 *
 * ── 这道门咬什么（三件真事，不是"按钮在不在"）───────────────────────────────
 *  ① **真路由 + 真 workspace**：从 `renderApp("/v/order-chain")` 出发（走 App 真路由 →
 *     真 workspace（MSW）→ renderer 注册表 → `OrderChainView`），不是裸渲染组件。
 *     裸渲染 = 假绿第 9 形态（咬组件不咬链路），本文件刻意不那么写。
 *  ② **地铁线路图画的是这一张订单**：站序逐个 stepId 断言 == 引擎回包里那一张单的站序，
 *     且 `chain_loss_attribution` 收到的 `so` 逐字节等于三判面板解析出来的那张单。
 *  ③ **方案对比在同一页出现，URL 不变**（反面判据）：点开阻滞点上的「查看方案对比」，
 *     方案块 `toBeVisible()`，同时断言 `location.pathname` **没变**（防「改了名字其实还是跳走」）。
 *
 * ── 还咬两条本单的要害 ─────────────────────────────────────────────────────
 *  ④ **对上率**：补种子后，`MaterialBatch` 落点必须真对到 `cf-batch-idle`（precision=TYPE），
 *     而不是回落到默认根因；`Base` 落点同理对到 `cf-base-capacity-contention`。
 *     补种子前这两类 drillType 一条因子都没有 ⇒ 撤掉种子这条断言必红。
 *  ⑤ **壳与嵌入是同一份实现**：`zh.decisionPlay.implStamp` 这一行在**页面壳**（`/v/decision-play`）
 *     与**嵌入处**（阻滞点卡片内）同时出现 —— 改面板一处文案，两处断言一起红。
 *
 * R6 确定性：无时钟、无随机；三个求解器全桩，其余照走 MSW。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const readFixture = (f: string): Record<string, unknown> => {
  const raw = JSON.parse(readFileSync(join(HERE, "fixtures", f), "utf8")) as Record<string, unknown>;
  return (raw.data as Record<string, unknown> | undefined) ?? raw;
};

/**
 * 引擎回包桩。**形状与真引擎同源**：
 *  · `chain_loss_attribution` 用仓里那份真跑下来的 `chain-loss-real.json`（锚点订单 SO-3391，18 站）；
 *  · `chain_impediments` 用真基线 `chain-impediment-baseline.json`；
 *  · `decision_play` 的 `locusPlay` 由**桩里的同一份 join 规则**现算（EXACT → TYPE → NONE），
 *    与引擎 `decisionPlayLocus` 逐条同口径 —— 桩不比生产漂亮。
 */
const net = vi.hoisted(() => ({ dpArgs: [] as Record<string, unknown>[], lossArgs: [] as Record<string, unknown>[] }));

/** 补种子后 demo 租户里 drillType→(drillId, factorId) 的实测切片（2026-08-14 真跑 /a/v1/objects/query 取回）。 */
const SEEDED_FACTORS: { drillType: string; drillId: string; factorId: string; label: string }[] = [
  { drillType: "MaterialBalance", drillId: "mbal-2", factorId: "cf-cathode-shortage", label: "正极粉短缺" },
  { drillType: "MaterialBalance", drillId: "mbal-1", factorId: "cf-material-short", label: "物料短缺(root)" },
  { drillType: "Line", drillId: "*", factorId: "cf-cap-bottleneck-process", label: "瓶颈工序" },
  // ↓ 本单补的两条（撤掉它们 ⇒ §4 对上率断言必红）
  { drillType: "MaterialBatch", drillId: "*", factorId: "cf-batch-idle", label: "批次呆滞占用在制" },
  { drillType: "Base", drillId: "*", factorId: "cf-base-capacity-contention", label: "基地产能面吃紧引发跨业务线争用" },
];

/** 与引擎 `decisionPlayLocus` 同一条 join 规则（EXACT 逐字节 → TYPE 通配 → NONE 诚实空）。 */
function resolveLocusFactor(locusType: string, locusId: string) {
  const sameType = SEEDED_FACTORS.filter((f) => f.drillType === locusType).sort((a, b) => a.factorId.localeCompare(b.factorId));
  const exact = sameType.find((f) => f.drillId === locusId);
  const wildcard = sameType.find((f) => f.drillId === "*" || f.drillId.startsWith("DYNAMIC-"));
  const hit = exact ?? wildcard;
  return {
    status: hit ? "JOINED" : "NO_FACTOR",
    precision: exact ? "EXACT" : hit ? "TYPE" : "NONE",
    factorId: hit?.factorId ?? null,
    factorLabel: hit?.label ?? null,
    drillField: hit ? "（桩）" : null,
    basis: hit ? `桩：drillType=${locusType} 命中 ${hit.factorId}（drillId=${hit.drillId}）` : `桩：drillType=${locusType} 无任何因子`,
    candidateFactorCount: sameType.length,
  };
}

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    runSolver: vi.fn(async (key: string, args?: Record<string, unknown>, signal?: AbortSignal) => {
      if (key === "chain_loss_attribution") {
        net.lossArgs.push(args ?? {});
        return { data: readFixture("chain-loss-real.json"), snapshotVersion: "sv-test" };
      }
      if (key === "chain_impediments") return { data: readFixture("chain-impediment-baseline.json"), snapshotVersion: "sv-test" };
      return actual.runSolver(key, args ?? {}, signal);
    }),
    invokeSolver: vi.fn(async (key: string, args: Record<string, unknown>) => {
      if (key !== "decision_play") return actual.invokeSolver(key, args);
      net.dpArgs.push(args);
      const locusType = typeof args.locusType === "string" ? args.locusType : "";
      const locusId = typeof args.locusId === "string" ? args.locusId : "";
      const base = {
        rootCause: { factorId: "cf-cert-cycle", label: "认证周期长", metricKey: "supply_gap", gap: 1200, unit: "吨" },
        options: [], matrix: [], triggers: [],
        recommendedPlan: { planId: "p1", optionIds: [], steps: [], totalClosesGap: 0, totalCost: 0 },
        sandboxNarrowing: { beforeGap: 1200, afterGap: 1200, narrowedPct: 0, ticks: 0 },
        summary: "（门用）",
      };
      // 可回退性同构：没锚落点 ⇒ **连键都不加**（与引擎 `decisionPlayLocus` 返回 null 的行为一致）。
      if (locusType === "" || locusId === "") return { data: base, snapshotVersion: "sv-test" };
      return {
        data: {
          ...base,
          locusPlay: {
            locus: { objectType: locusType, objectId: locusId },
            join: resolveLocusFactor(locusType, locusId),
            impediments: [],
            candidateTotal: 0,
            scanId: "scan_seam",
            optionsNote: "（门用）落点解法与六维方案卡不是一回事。",
            summary: "（门用）",
          },
        },
        snapshotVersion: "sv-test",
      };
    }),
  };
});

const loss = () => readFixture("chain-loss-real.json") as unknown as {
  anchor: { so: string };
  nodes: { nodeId: string; steps: { stepId: string }[] }[];
};
const imps = () => (readFixture("chain-impediment-baseline.json") as unknown as {
  impediments: { impedimentId: string; locus: { objectType: string; objectId: string } }[];
}).impediments;

beforeEach(() => {
  net.dpArgs.length = 0;
  net.lossArgs.length = 0;
  loginAs("planner");
});

// ══════════════════════════════════════════════════════════════════════════════
// §0 · 金丝雀 —— 先自证数据源与工具是好的（铁律 0.6：报否定结论前先跑已知必中的样例）
// ══════════════════════════════════════════════════════════════════════════════
describe("§0 金丝雀", () => {
  it("两份 fixture 真有内容，且阻滞点里真的**同时**有 MaterialBatch 与 Base 两类落点（否则 §4 恒真）", () => {
    const L = loss();
    expect(L.anchor.so, "锚点订单读不出来 ⇒ fixture/读取器坏了，不是页面坏了").toMatch(/^SO-/);
    expect(L.nodes.length, "站点为 0 ⇒ 下面的站序断言全是空跑").toBeGreaterThan(5);
    const types = new Set(imps().map((i) => i.locus.objectType));
    expect(types.has("MaterialBatch"), "基线里没有 MaterialBatch 落点 ⇒ §4 那条断言会恒真").toBe(true);
    expect(imps().length).toBeGreaterThan(0);
  });

  it("金丝雀 · join 规则本身是有分辨力的：不存在的 drillType 必须落 NONE（而不是什么都能对上）", () => {
    expect(resolveLocusFactor("MaterialBatch", "elyte_b2").precision).toBe("TYPE");
    expect(resolveLocusFactor("MaterialBalance", "mbal-2").precision).toBe("EXACT");
    expect(resolveLocusFactor("NoSuchType", "x").precision).toBe("NONE");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §1 · 真路由进「订单进展与卡因」→ 地铁线路图画的是**这一张订单**
// ══════════════════════════════════════════════════════════════════════════════
describe("§1 订单进展与卡因 · 地铁线路图按单订单驱动", () => {
  it("改名生效：页面标题是「订单进展与卡因」（renderer key 仍是 order-chain）", async () => {
    renderApp("/v/order-chain");
    expect(await screen.findByText(zh.orderChain.title, {}, { timeout: 10_000 })).toBeVisible();
    expect(zh.orderChain.title).toBe("订单进展与卡因");
  });

  it("点开线路图 → 引擎收到的 so **逐字节等于**面板上那张单；站序逐个 stepId 对上", async () => {
    const user = userEvent.setup();
    renderApp("/v/order-chain");

    const summary = await screen.findByTestId("oc-metro-summary", {}, { timeout: 10_000 });
    const so = (await screen.findByTestId("oc-metro-so")).textContent ?? "";
    expect(so, "订单号没渲染出来 ⇒ 下面的逐字节断言会拿空串去比").not.toBe("");

    await user.click(summary);

    // ① 引擎收到的是**这一张单**（不是空 args = 全域）。
    await waitFor(() => expect(net.lossArgs.length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(net.lossArgs[0]).toEqual({ so });

    // ② 站序：逐个 stepId 在屏上（期望值从回包现取，零字面量）。
    const slot = await screen.findByTestId("oc-metro-slot");
    await within(slot).findByTestId("clm-root", {}, { timeout: 10_000 });
    const stepIds = loss().nodes.flatMap((n) => n.steps.map((s) => s.stepId));
    expect(stepIds.length, "回包一个站都没有 ⇒ 循环恒真").toBeGreaterThan(5);
    let seen = 0;
    for (const id of stepIds) {
      const el = within(slot).queryByTestId(`clm-station-${id}`) ?? within(slot).queryByTestId(`clm-suspended-${id}`);
      if (el !== null) seen++;
    }
    // 「循环真跑满」的前置断言（imp2plan 那次的教训：空集合上的循环恒真）。
    expect(seen, `${stepIds.length} 个站一个都没画出来 ⇒ 图没渲染，不是站少`).toBeGreaterThan(stepIds.length / 2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 · 阻滞点页 · 点一条卡点 → 方案对比**在同一页**出现（URL 不变）
// ══════════════════════════════════════════════════════════════════════════════
describe("§2 就地嵌入 · 不跳走", () => {
  it("点「查看方案对比」→ 方案块 toBeVisible()，且 URL **一个字符都没变**（反面判据）", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/v/chain-impediments");

    const first = imps()[0]!;
    const summary = await screen.findByTestId(`ci-play-${first.impedimentId}-summary`, {}, { timeout: 10_000 });
    const before = router.state.location.pathname + router.state.location.search;

    await user.click(summary);

    const panel = await screen.findByTestId(`ci-play-${first.impedimentId}`, {}, { timeout: 10_000 });
    expect(panel).toBeVisible();
    // 方案对比的主体（⑥ 落点块）真挂出来了 —— 不是只出了个空壳。
    expect(await within(panel).findByTestId("dp-locus-play")).toBeVisible();

    // 反面判据：**URL 未变**（跳走的话这条当场红）。
    expect(router.state.location.pathname + router.state.location.search).toBe(before);
    expect(router.state.location.pathname).toBe("/v/chain-impediments");
  });

  it("嵌入时真把这条阻滞点的 locus 喂给了引擎（不是喂空 args 冒充「就地推演」）", async () => {
    const user = userEvent.setup();
    renderApp("/v/chain-impediments");
    const first = imps()[0]!;
    await user.click(await screen.findByTestId(`ci-play-${first.impedimentId}-summary`, {}, { timeout: 10_000 }));
    await waitFor(() => expect(net.dpArgs.length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(net.dpArgs.some((a) => a.locusType === first.locus.objectType && a.locusId === first.locus.objectId)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 · 壳与嵌入是**同一份实现**（改一处文案，两处一起红）
// ══════════════════════════════════════════════════════════════════════════════
describe("§3 壳与嵌入同源", () => {
  it("页面壳 /v/decision-play 上有 dp-impl-stamp，且文案 == zh.decisionPlay.implStamp", async () => {
    renderApp("/v/decision-play");
    const stamp = await screen.findByTestId("dp-impl-stamp", {}, { timeout: 10_000 });
    expect(stamp).toHaveTextContent(zh.decisionPlay.implStamp);
  });

  it("嵌入处也有同一行 dp-impl-stamp（同一份实现的可核判据）", async () => {
    const user = userEvent.setup();
    renderApp("/v/chain-impediments");
    const first = imps()[0]!;
    await user.click(await screen.findByTestId(`ci-play-${first.impedimentId}-summary`, {}, { timeout: 10_000 }));
    const panel = await screen.findByTestId(`ci-play-${first.impedimentId}`, {}, { timeout: 10_000 });
    expect(within(panel).getByTestId("dp-impl-stamp")).toHaveTextContent(zh.decisionPlay.implStamp);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 · 对上率 —— 补种子后这条落点必须对到**具体因子**，不是回落默认根因
// ══════════════════════════════════════════════════════════════════════════════
describe("§4 locus → CausalFactor 对上率（撤掉本单补的种子即红）", () => {
  it("MaterialBatch 落点对到 cf-batch-idle（本单新补；补之前该 drillType 一条因子都没有）", async () => {
    const user = userEvent.setup();
    renderApp("/v/chain-impediments");
    const batch = imps().find((i) => i.locus.objectType === "MaterialBatch");
    expect(batch, "基线里没有 MaterialBatch 落点 ⇒ 本用例是空跑").toBeDefined();
    await user.click(await screen.findByTestId(`ci-play-${batch!.impedimentId}-summary`, {}, { timeout: 10_000 }));
    const panel = await screen.findByTestId(`ci-play-${batch!.impedimentId}`, {}, { timeout: 10_000 });
    const lp = await within(panel).findByTestId("dp-locus-play");
    expect(lp).toHaveAttribute("data-join", "JOINED");
    expect(within(lp).getByTestId("dp-locus-factor")).toHaveTextContent("cf-batch-idle");
    // 精度不许塌：`*` 通配 ⇒ TYPE，不能冒充 EXACT。
    expect(within(lp).getByTestId("dp-locus-precision")).toHaveTextContent("TYPE");
    // 「按类型对上」这句话必须在脸上（否则读者会当成这一张单据自己的因子）。
    expect(lp).toHaveTextContent("按类型对上");
  });

  it("对不上时诚实空 —— 不回落到贡献最大的默认因子（NONE 三态之一，禁塌）", () => {
    const j = resolveLocusFactor("NoSuchType", "whatever");
    expect(j.status).toBe("NO_FACTOR");
    expect(j.factorId).toBeNull();
  });
});
