import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SandboxViewConfig, SimCertification, SimSession } from "@platform/contracts";

/**
 * WO-SANDBOX-DENSITY · 推演沙盘**第一层降密**的分层契约门。
 *
 * ══ 来历 ═══════════════════════════════════════════════════════════════════════
 * 仓主对这一屏的原话：**「信息太多，第一层看不到重点」**。
 * 版面门 `scripts/check-layout-legibility.mjs` 把它量成一个数：`firstScreenCtrls`
 * （单屏可见交互控件数），基线 52。本单把左区动作条分成两层，是那个数的一部分来源。
 *
 * ══ 这道门与版面门的分工（**刻意不重复，也刻意不互相替代**）════════════════════
 *  · **版面门**在真 Chromium 里量「浏览器把它排成了什么样」——
 *    它能看见 `display:none`，但它一页只跑一次、跑一次 90 秒，且不进 vitest。
 *  · **本门**在 jsdom 里咬**分层契约**：默认收起 / 展开后原样回来 / 入口计数不撒谎。
 *    jsdom 看不见 CSS module（`vitest.config.ts` 里 `css: false` ⇒ `styles.x` 恒 `undefined`），
 *    所以折叠**必须写成行内 `style.display`** 才量得到 —— 这不是风格选择，是判据能否成立的前提。
 *    写进 `.module.css` 的折叠在本门眼里根本不存在，本门就会变成装饰品。
 *
 * ══ 为什么折叠**不用 `<details>`**（本单实测，写在这里免得下一个人改回去）══════════
 * Chromium 141 实测：闭合 `<details>` 的子节点 `checkVisibility()` 为 false、命中测试也
 * 打不到，但 `getBoundingClientRect()` **仍返回非零旧矩形**。而版面门 `visible()` 的判据是
 * 「计算样式非 none/hidden/opacity0 ＋ 非零矩形」（`scripts/lib/layout-probe.mjs`）
 * ⇒ **闭合 `<details>` 里的控件照样被当成"第一屏可见控件"在数**。
 * 取证不是推想：canonical 那一屏 52 个控件里，有 12 个正是闭合
 * `<details data-testid="sandbox-consolidated-links">`（`open===false`）里的深链接 `<a>`
 * —— 本单亲手逐控件 dump 复现（交单报告①）。
 * ⇒ 用 `<details>` 折叠 = 屏上看不见、数上不降，两头落空。
 *
 * ══ 为什么也**不用条件渲染**（`open ? <…/> : null`）═══════════════════════════════
 * 这三个按钮上挂着**别人单的接线断言**，共 4 处直接 `getByTestId(...)` 再点：
 *   `sandbox-console.seam.test.tsx` · `befe-e-sim-checkpoint-rollback.seam.test.tsx`
 *   · `sim-event-consumers.seam.test.tsx` · `scripts/ui-smoke-sandbox-p0.mjs`
 * 条件渲染会让它们全红。**本单只改版面，不推翻别人单的接线判断**，
 * 更不许靠改它们的测试来买绿。`display:none` 保住 DOM ⇒ 接线断言照旧成立。
 *
 * ══ 三条判据（**两向 + 对账**，少一条都证明不了分层成功）════════════════════════
 *  ① **默认收起**：折叠体 `style.display === "none"`、`data-open === "0"`、入口 `aria-expanded=false`。
 *     （只咬这一条 = 有可能是把它们删了。）
 *  ② **降层不是删除**：三个按钮仍在 DOM，展开后 `display !== "none"`、文案一字不变。
 *     （只咬这一条 = 有可能它们本来就一直在屏上，降密根本没发生。）
 *  ③ **入口计数不撒谎**：入口上写的 `data-count` === 折叠体里**渲染后真实的按钮数**。
 *     两侧同源对账（与阻滞点 `sc-impjump-count` 同一条纪律）——
 *     各数一遍迟早对不上：入口说 3 个、点开是 2 个，谁也不会发现。
 *
 * R6 确定性：网络全桩，无时钟、无随机。
 */

const { fetchCertFn } = vi.hoisted(() => ({ fetchCertFn: vi.fn() }));

vi.mock("@/api/endpoints", () => ({
  fetchWorkspace: vi.fn(),
  fetchSimViewConfig: vi.fn(),
  runSolver: vi.fn(async (key: string) =>
    key === "chain_impediments"
      ? {
          data: {
            scanId: "scan_density",
            scope: {},
            impediments: [],
            counts: { total: 0, BOTTLENECK: 0, CONGESTION: 0, BREAK: 0 },
            unresolved: [],
            caveats: [],
            thresholds: [],
          },
          snapshotVersion: "ov-test",
        }
      : Promise.reject({ error: { code: "NOT_STUBBED", message: "本门不桩 chain_loss_attribution", requestId: "req_test" } }),
  ),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_density",
    tenantId: "t",
    baseSnapshot: body.baseSnapshot,
    scope: {},
    status: "READY",
    curTick: 0,
    parentCheckpointId: null,
    createdAt: "2026-08-17T00:00:00.000Z",
  } satisfies SimSession)),
  simTick: vi.fn(async (_id: string, n: number) => ({ curTick: n, state: { x: { v: 50 } } })),
  simWorld: vi.fn(async () => ({ tick: 0, state: {} })),
  fetchSimSessions: vi.fn(async () => ({ items: [] })),
  simCheckpoint: vi.fn(async () => ({ id: "cp1", sessionId: "sims_density", tenantId: "t", tick: 1, label: "t1", createdAt: "x" })),
  simBranch: vi.fn(),
  fetchSimCompare: vi.fn(),
  createActionDraft: vi.fn(async () => ({ draftId: "ad1", status: "PENDING" })),
  fetchSimCertification: fetchCertFn,
  submitQuery: vi.fn(),
  searchObjects: vi.fn(async () => ({ items: [], total: 0 })),
}));

import SandboxView from "@/views/sim/SandboxView";

const CFG: SandboxViewConfig = {
  tenantId: "t-density",
  nodeTypes: ["TypeA", "TypeB"],
  linkTypes: ["linkAB"],
  stateVars: ["s1"],
  radarDims: [
    { key: "structure", label: "结构" },
    { key: "knowledge", label: "知识" },
    { key: "behavior", label: "行为" },
  ],
  screens: ["sandbox"],
  propagationCount: 1,
};

const CERT: SimCertification = {
  scope: "GLOBAL",
  targetRef: null,
  level: "L2_RUNNABLE",
  dims: { structure: 60, knowledge: 40, behavior: 30, composite: 45 },
  l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
  trialTick: { passed: false, rulesFired: 0, at: null, error: null },
  worldCompleteness: {
    pct: 55,
    stateVars: { present: 2, needed: 4 },
    derivationRules: { present: 1, needed: 2 },
    actions: { present: 0, needed: 1 },
    propagationRules: { present: 0, needed: 0 },
    entering: [{ key: "s1", kind: "DERIVATION", source: "deriv:s1" }],
  },
  canEnterSimulation: false,
  gaps: [{ gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" }],
  computedAt: "2026-08-17T00:00:00.000Z",
};

/**
 * 第二层那三个动作的**期望文案**（一字不改地照抄屏上原文）。
 * 「降层 ≠ 删除」这条判据要求展开后**文本也原样回来**，只咬 testid 在不在证明不了这一点
 * —— 一个空按钮同样有 testid。
 */
const SECONDARY = [
  { testId: "sandbox-checkpoint-btn", text: "存档检查点" },
  { testId: "sandbox-branch-btn", text: "分支（多场景对比）" },
  { testId: "sandbox-adopt-btn", text: "采纳此推演结论" },
];

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

async function ready() {
  await screen.findByTestId("sandbox-console");
  await waitFor(() => expect(fetchCertFn).toHaveBeenCalled());
}

beforeEach(() => {
  fetchCertFn.mockReset();
  fetchCertFn.mockImplementation(async () => CERT);
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════════
describe("§1 · 左区动作条分两层 —— 两向都咬", () => {
  it("① 默认收起：折叠体 display:none ＋ data-open=0 ＋ 入口 aria-expanded=false", async () => {
    mount();
    await ready();
    const fold = await screen.findByTestId("sandbox-more-actions");
    // 判据落在**行内 display** 上，不落在类名上 —— jsdom 里类名量不到（css:false）。
    expect(fold.style.display, "折叠体默认不是 display:none ⇒ 第一层根本没降密").toBe("none");
    expect(fold.getAttribute("data-open")).toBe("0");
    const toggle = screen.getByTestId("sandbox-more-actions-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("sandbox-more-actions");
    // 入口**必须看得见**：藏起来找不到的抽屉 = 把内容删了（与顶栏诊断抽屉同一条纪律）。
    expect(toggle).toBeVisible();
    expect(toggle.textContent ?? "").toContain("更多动作");
  });

  it("① 主动作留在第一层：`推进 tick` 不在折叠体里，且不点就看得见", async () => {
    mount();
    await ready();
    const tick = await screen.findByTestId("sandbox-tick-btn");
    const fold = screen.getByTestId("sandbox-more-actions");
    expect(fold.contains(tick), "`推进 tick` 被一起降层了 ⇒ 这一屏没有任何『现在就该做』的动作").toBe(false);
    expect(tick).toBeVisible();
  });

  it("② 降层 ≠ 删除：三个次级动作**始终在 DOM**，展开后 display 恢复且文案一字不变", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    // 收起态：DOM 里就在（这一条正是「不是删了」的证据）
    for (const s of SECONDARY) {
      expect(screen.getByTestId(s.testId), `${s.testId} 不在 DOM ⇒ 这不是降层，是删除`).toBeTruthy();
    }
    await user.click(screen.getByTestId("sandbox-more-actions-toggle"));
    const fold = screen.getByTestId("sandbox-more-actions");
    await waitFor(() => expect(fold.getAttribute("data-open")).toBe("1"));
    expect(fold.style.display, "展开后仍是 display:none ⇒ 这个入口是个死开关").not.toBe("none");
    expect(screen.getByTestId("sandbox-more-actions-toggle").getAttribute("aria-expanded")).toBe("true");
    for (const s of SECONDARY) {
      const el = screen.getByTestId(s.testId);
      expect(fold.contains(el), `${s.testId} 没在折叠体里 ⇒ 名册与实物对不上`).toBe(true);
      expect(el.textContent ?? "", `${s.testId} 的文案变了 ⇒ 降层顺手改了内容`).toContain(s.text);
    }
  });

  it("③ 入口计数不撒谎：`data-count` === 折叠体里**渲染后真实的按钮数**（两侧同源对账）", async () => {
    mount();
    await ready();
    const toggle = screen.getByTestId("sandbox-more-actions-toggle");
    const fold = screen.getByTestId("sandbox-more-actions");
    const real = fold.querySelectorAll("button").length;
    // 先自证这个"真数"不是 0 —— 金丝雀：分母塌了的话下面那个等式会恒真而毫无意义。
    expect(real, "折叠体里一个按钮都没有 ⇒ 量的不是我要量的东西（先修选择器，别改断言）").toBeGreaterThan(1);
    expect(Number(toggle.getAttribute("data-count")), "入口写的数与折叠体里的真实按钮数对不上").toBe(real);
    expect(toggle.textContent ?? "").toContain(String(real));
    // 名册与实物逐条对账（顺序无关，按 testid 集合比）
    const inFold = [...fold.querySelectorAll("button")].map((b) => b.getAttribute("data-testid")).sort();
    expect(inFold).toEqual(SECONDARY.map((s) => s.testId).sort());
  });
});
