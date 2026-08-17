import { Suspense, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import {
  PROCESS_TASK_WAIT_STATES,
  PROCESS_TASK_WAIT_STATE_META,
  ProcessStuckResponseSchema,
  type ProcessStuckResponse,
} from "@platform/contracts";
import { NAV_GROUPS } from "@/pages/ShellLayout";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { db } from "@/mocks/db";
import { loginAs, renderApp } from "./utils";

/**
 * WO-PROCESS-INSTANCE · 流程卡点面板 SEAM。
 * （WO-R9-STUCKVIEW·2026-08-14 收编：原文件在 `handoff-wo-process-instance` 上，集成分支从未有过。
 *   收编时同步对齐 WO-R9-PROCESS-MERGE 改过的契约，逐处改动理由见下方各 §。）
 *
 * ── 头号判据 ──────────────────────────────────────────────────────────────
 * 需求 §4.5 那句「**为什么这个流程现在卡住了**」在界面上**真的有答案**，且答案是
 * **数据驱动**的：改后端载荷 → 界面必须跟着变。断言指名道姓到那四个字段
 * （卡在哪一步 / 为什么 / 等谁 / 等多久），不是「渲染了一个组件」。
 *
 * ── SEAM 的咬点：咬链路，不咬组件 ────────────────────────────────────────
 * §0 从 **URL** 出发（`renderApp("/v/process-stuck")`）跑完整条链：
 *   mock workspace 下发 → ViewPage 双闸 → registry → 组件 → 真取数。
 * 直接 `import` 组件只能证明「函数能跑」，证明不了「接线了」——
 * 本仓 F2/F3/F4 连踩三次 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`
 * （实现有、测试有、全绿、**零路由渲染得到**）。
 *
 * ⚠ **收编时实测发现原文件只咬到半条链**：它最强的一条是
 *   `getRenderer("process-stuck")` 取到 renderer 再渲染 —— 那只证明「registry 里有这一行」，
 *   证明不了「有任何东西能让你走到 registry」。原单确实也就只做了那一行：
 *   后端零派单、NAV_GROUPS 零条目 ⇒ `check-nav-group-coverage` 判据⑦ 当场把它列进
 *   「注册了但没有任何路径渲染得到」。**测试全绿、页面打不开**，正是它自己文档里警告的那个形态。
 *   故本轮把 §0 从「经 registry 渲染」升级成「经 URL 渲染」，并补 §0.5 结构守卫。
 *
 * ── 第二条纪律：诚实缺席 ─────────────────────────────────────────────────
 * 缺 `waitedMs` / `ownerDisplayName` / `definitionName` 时，界面**不得**出现
 * 「未知 / - / N/A / 0」这类占位符。缺席只是没说，占位符是说了一句假的。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");

// ── 网络桩：唯一数据源是 A 侧 /a/v1/process-instances/stuck ──────────────────
const net = vi.hoisted(() => ({
  payload: null as ProcessStuckResponse | null,
  fail: null as unknown,
  calls: 0,
}));

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    fetchStuckProcesses: vi.fn(async () => {
      net.calls += 1;
      if (net.fail !== null) throw net.fail;
      return net.payload;
    }),
  };
});

const DAY = 86_400_000;

/**
 * 一条卡在审批上的实例（满字段）。
 *
 * ⚠ **合并单 WO-R9-PROCESS-MERGE 把 `definitionKey` 改名为 `processKey`**
 * （`process-runtime.ts:319`，判据是仓内既有约定 `impact-analysis.ts:132`）。
 * 这里跟着改名 —— 不是"为了让测试变绿而改断言"：该字段**本页一个字都不读**
 * （组件源码里 `definitionKey`/`processKey` 均零出现，见 §4 的机器断言），
 * 改的是 fixture 的**输入形状**使其合法，不是改任何一条**期望值**。
 *
 * ⚠ 另两处合并改名（`subjectRef`→平铺、`startedAt/endedAt`→`enteredAt/exitedAt`）
 * **落在 `ProcessInstance` 上，不落在本投影上**：`ProcessStuckReason.subjectRef`
 * 至今仍是嵌套形（`process-runtime.ts:323`），`waitingSince/waitedMs` 也一字未动。
 * 故本文件这两处**刻意不改** —— 跟着派单描述去改会把合法 fixture 改成非法。
 */
function approvalRow(over: Record<string, unknown> = {}) {
  return {
    instanceId: "pinst_demo_P17_ord_1",
    processKey: "P17",
    definitionName: "销售订单评审接单",
    subjectRef: { typeKey: "Order", objectId: "ord_1" },
    taskId: "ptask_1",
    taskName: "信用超额审批",
    taskSeq: 1,
    waitState: "WAITING_APPROVAL",
    waitRef: "adraft_credit_1",
    ownerFunctionKey: "finance",
    ownerDisplayName: "财务",
    waitingSince: "2026-03-01T00:00:00.000Z",
    waitedMs: 3 * DAY,
    ...over,
  };
}

function tally(rows: { waitState: string }[]) {
  return Object.fromEntries(PROCESS_TASK_WAIT_STATES.map((s) => [s, rows.filter((r) => r.waitState === s).length]));
}

/**
 * ⚠ `derivedStuckCount` 是**合并单新增的必填字段**（`ProcessStuckResponseSchema`）。
 * 默认给 0 = 「反推侧此刻没有卡着的」，让既有各例保持原语义不变；
 * 要验那条诚实位的用例显式传非 0（见 §3 末两条）。
 */
function payloadOf(rows: Record<string, unknown>[], derivedStuckCount = 0): ProcessStuckResponse {
  return {
    evaluatedAt: "2026-03-04T00:00:00.000Z",
    stuck: rows,
    byWaitState: tally(rows as { waitState: string }[]),
    derivedStuckCount,
  } as ProcessStuckResponse;
}

/** 经 registry 取 renderer 渲染 —— 只证「registry 那一行在」，**不证可达**（可达见 §0）。
 *  WO-IA-E2E5E6 · E5 起组件内出现 Link/useSearchParams（跨页互跳），隔离渲染必须给
 *  Router 上下文 —— MemoryRouter 只是上下文，不改变本节断言证明的东西。 */
async function renderViaRegistry() {
  const { getRenderer } = await import("@/views/registry");
  const Renderer = getRenderer("process-stuck");
  expect(Renderer, "registry 里没有 process-stuck ⇒ 组件零生产调用方（F2/F3/F4 同款坑）").toBeTruthy();
  render(
    createElement(
      MemoryRouter,
      null,
      createElement(
        Suspense,
        { fallback: null },
        createElement(Renderer as never, { view: { key: "process-stuck" } as never }),
      ),
    ),
  );
}

beforeEach(() => {
  net.payload = null;
  net.fail = null;
  net.calls = 0;
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════
// ⓪ 可达性 —— **从 URL 出发**（缺这一节 = 实现有测试绿但没人渲染得到）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE FE · §0 可达性（可达 ≠ 已注册）", () => {
  beforeEach(() => {
    loginAs("planner"); // mock 里 planner 持 admin 角色
    // `process.runtime` 是**暗发**键（后端 defaultOn:false + INCOMPLETE_DATA_DARK_LAUNCH_FEATURES，
    // mock fixtures 照抄了这个 false）⇒ 默认状态下本页**本就不该可达**。
    // 这里显式开通，等价于租户在「功能开通」页打开它 —— 下面验的是「开通之后真的到得了」。
    db.tenantOverrides["process.runtime"] = true;
  });
  afterEach(() => {
    delete db.tenantOverrides["process.runtime"];
  });

  it("金丝雀：开通后 mock workspace 真下发 process-stuck（视图 + 路由 feature 双闸都开）", () => {
    const planner = ACCOUNTS.find((a) => a.username === "planner")!;
    const ws = workspaceForAccount(planner, db.tenantOverrides, db.configVersion);
    const view = (ws.views ?? []).find((v) => v.key === "process-stuck");
    expect(
      view,
      "mock allViews 里没有 process-stuck —— 不是页面坏了，是本测试的前提没成立（后端 VIEW_DEFS 与 mock fixtures 已漂移）",
    ).toBeDefined();
    // renderer 必须逐字对齐后端，否则 ViewPage 拿它去 getRenderer 会落「该视图类型暂不支持」兜底卡
    expect(view!.renderer).toBe("process-stuck");
    // 🔴 别名闸：功能键是 `process.runtime`，而 ViewPage.tsx:33 写死查 `view.${viewKey}`。
    //    两边都得在，缺后者 = 导航里点得到、点进去 404（后端 app.ts withRouteFeatureAliases 同款）。
    expect(ws.features).toContain("process.runtime");
    expect(ws.features, "缺 view.process-stuck 别名 ⇒ ViewPage 第一道闸就 404").toContain("view.process-stuck");
  });

  it("链路层：直接访问 /v/process-stuck → ViewPage 双闸放行 → 真渲染出整页", async () => {
    net.payload = payloadOf([approvalRow()]);
    renderApp("/v/process-stuck");
    // stuck-step 只在真组件里出现；落 404/403/「暂不支持」兜底卡时一个都不会有
    await waitFor(() => expect(screen.getByTestId("stuck-step")).toBeTruthy());
    expect(screen.getByTestId("stuck-step").textContent).toContain("信用超额审批");
  });

  /**
   * ⚠ WO-SANDBOX-NAV-CONSOLIDATE 改判据：本页已收编进沙盘「归因」模式的**实例层档**，
   * 条目带 `consolidatedWhen: "sim.sandbox"` ⇒ 沙盘开着时侧栏故意不单列。
   * 侧栏这一半因此改成在**沙盘关**的世界里验（条目仍在 = 收编 ≠ 删除）；
   * 沙盘开时的可达性由 `sandbox-nav-consolidate.seam.test.tsx` 验（点档 → 内容真出现）。
   */
  it("可发现性（沙盘关）：侧栏「归因与风险」组里有一条 /v/process-stuck 链接，且没落进「其它」兜底桶", async () => {
    db.tenantOverrides["sim.sandbox"] = false;
    try {
      renderApp("/v/dash");
      const nav = await screen.findByTestId("nav-business");
      const hrefs0 = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
      expect(hrefs0, "sim.sandbox 关着，沙盘入口仍在 ⇒ override 没生效，本条是空转").not.toContain("/v/sim-sandbox");
      const group = within(nav).getByTestId("nav-group-归因与风险");
      const link = within(group).getByText("流程卡点");
      expect(link.closest("a")?.getAttribute("href")).toBe("/v/process-stuck");
      // 反向：「其它」组（若存在）不得含它 —— 可达但折叠在兜底桶里 = 用户找不到（G-NAV-FALLBACK-BUCKET）
      const other = within(nav).queryByTestId("nav-group-其它");
      if (other) expect(within(other).queryByText("流程卡点")).toBeNull();
    } finally {
      delete db.tenantOverrides["sim.sandbox"];
    }
  });

  /**
   * 上一轮裁决「`process-wait`（模板层）与 `process-stuck`（实例层）**不合并，但补双向入口**」——
   * WO-SANDBOX-NAV-CONSOLIDATE **不推翻它**：收编之后它们仍是**两个**入口，只是入口的位置从
   * 「侧栏两条链接」变成「沙盘归因模式下的两个档」。故本条两个世界都咬：
   *   · 沙盘关 ⇒ 侧栏两条链接并存，各指各的 URL；
   *   · 沙盘开 ⇒ 沙盘里两个档并存（在 `sandbox-nav-consolidate.seam.test.tsx` 里咬，
   *     断言落在两档各自渲染出**自己那一页的内容**，不是两个按钮）。
   * 合成一个入口 = 把合并单新立的 waitStateOrigin 诚实位在信息架构层抹掉。
   */
  it("**不与 process-wait 混为一谈**（沙盘关）：两条入口同组并存，各自指向自己的 URL", async () => {
    db.tenantOverrides["sim.sandbox"] = false;
    try {
      renderApp("/v/dash");
      const nav = await screen.findByTestId("nav-business");
      const group = within(nav).getByTestId("nav-group-归因与风险");
      expect(within(group).getByText("流程等待态").closest("a")?.getAttribute("href")).toBe("/v/process-wait");
      expect(within(group).getByText("流程卡点").closest("a")?.getAttribute("href")).toBe("/v/process-stuck");
    } finally {
      delete db.tenantOverrides["sim.sandbox"];
    }
  });
});

describe("WO-PROCESS-INSTANCE FE · §0.5 结构守卫与 R3（暗发默认关）", () => {
  beforeEach(() => {
    loginAs("planner");
  });

  it("NAV_GROUPS 里它挂的是 kind:\"view\" 且带 consolidatedWhen（经后端下发·收编时留回退条目）", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items);
    const hit = items.filter((it) => it.key === "process-stuck");
    expect(hit, "process-stuck 在 NAV_GROUPS 里一条都没有").toHaveLength(1);
    // 挂成 route 会绕过 R3 页面侧守卫（暗发键关着也手敲得进去）
    expect(hit[0]!.kind).toBe("view");
    // WO-SANDBOX-NAV-CONSOLIDATE：条目**必须留着**（本页不受 sim.sandbox 门控），
    // 靠 consolidatedWhen 在沙盘开着时隐藏 —— 删条目 = 沙盘关的租户这一页从 IA 里蒸发。
    expect(
      hit[0]!.kind === "view" ? hit[0]!.consolidatedWhen : undefined,
      "条目没带 consolidatedWhen ⇒ 沙盘开着时它仍会单列（重复入口），「归因与风险」组也不会自动隐藏",
    ).toBe("sim.sandbox");
  });

  /**
   * ⚠ WO-SANDBOX-NAV-CONSOLIDATE：本条**必须在沙盘关着的世界里跑**。
   * 沙盘开着时这一页本来就被收编、侧栏本来就没有它 ⇒ 那句 `hrefs.has(...) === false`
   * 无论暗发键开还是关都成立，本条就不再度量 R3 了（拿"侧栏没有它"当"功能关闭生效"的证据，
   * 而此时前者另有原因）。沙盘开着那一侧的 R3 由 `sandbox-nav-consolidate.seam.test.tsx`
   * 的「暗发键守卫」咬：`process.runtime` 关 ⇒ 沙盘里**不出现** process-stuck 那一档。
   */
  it("R3「功能关闭 = 不存在」：**默认**（未开通）入口不在侧栏，且页面渲染不出来", async () => {
    // ⚠ 暗发键这一条不设 override —— 验的就是 mock 的**默认**态与真实 demo 租户一致（暗发中）。
    db.tenantOverrides["sim.sandbox"] = false; // 只排除"收编"这个混淆因素，见上注
    try {
      const planner = ACCOUNTS.find((a) => a.username === "planner")!;
      const ws = workspaceForAccount(planner, db.tenantOverrides, db.configVersion);
      expect(ws.features, "mock 默认把暗发键开着 ⇒ 演示态比生产态多一页（mock 在说谎）").not.toContain(
        "process.runtime",
      );
      expect(ws.features).not.toContain("view.process-stuck");

      renderApp("/v/process-stuck");
      const nav = await screen.findByTestId("nav-business");
      const hrefs = new Set(Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href")));
      // 金丝雀：同组邻居（不受暗发键控制、沙盘关时单列）仍在 ⇒ 「侧栏没有本页」确实是暗发键关掉的结果
      expect(hrefs.has("/v/process-wait"), "沙盘关着而同组邻居也不在 ⇒ 本条的断言在空导航上跑").toBe(true);
      expect(hrefs.has("/v/process-stuck"), "功能关着，入口仍在侧栏 —— 泄露了功能存在性（R3）").toBe(false);
      expect(screen.queryByTestId("stuck-step"), "功能关着，页面仍渲染得出来 —— 孤儿态（R3）").toBeNull();
    } finally {
      delete db.tenantOverrides["sim.sandbox"];
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ① 接线（缺这条 = 实现有测试绿但没人渲染得到）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE FE · 接线", () => {
  it("registry 注册了 process-stuck，且渲染时**真的**打了那个端点", async () => {
    net.payload = payloadOf([approvalRow()]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-step")).toBeTruthy());
    expect(net.calls, "渲染必须真去取数，不许用内置示例数据顶上").toBe(1);
  });

  it("endpoints 打的是 A 侧 /a/v1/process-instances/stuck（路径写死在源码里，防漂）", () => {
    const src = readFileSync(join(SRC, "api", "endpoints.ts"), "utf8");
    // 金丝雀：抽取器必须先命中一个已知存在的字串，否则报「工具坏了」而不是「路径不对」。
    expect(src.includes("fetchStuckProcesses"), "金丝雀：endpoints.ts 里连函数名都找不到 ⇒ 读错文件了").toBe(true);
    expect(src.includes("/a/v1/process-instances/stuck")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ② 四问都有答案，且**数据驱动**（改载荷 → 界面跟着变）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE FE · 「为什么卡住」四问", () => {
  it("卡在哪一步 / 为什么 / 等谁 / 等多久 —— 四个字段逐条渲染出来", async () => {
    net.payload = payloadOf([approvalRow()]);
    await renderViaRegistry();

    // ① 卡在哪一步
    await waitFor(() => expect(screen.getByTestId("stuck-step").textContent).toContain("信用超额审批"));
    expect(screen.getByTestId("stuck-step").textContent).toContain("第 1 步");
    // ② 为什么 —— 人话来自契约单一来源，且带具体审批单号
    expect(screen.getByTestId("stuck-why").textContent).toContain(
      PROCESS_TASK_WAIT_STATE_META.WAITING_APPROVAL.blocker,
    );
    expect(screen.getByTestId("stuck-waitref").textContent).toBe("adraft_credit_1");
    expect(screen.getByTestId("stuck-badge").textContent).toBe(
      PROCESS_TASK_WAIT_STATE_META.WAITING_APPROVAL.displayName,
    );
    // ③ 等谁
    expect(screen.getByTestId("stuck-owner").textContent).toBe("财务");
    // ④ 等多久
    expect(screen.getByTestId("stuck-waited").textContent).toBe("3 天");
    // 处理对象（这条流程在处理什么）
    expect(screen.getByTestId("stuck-subject").textContent).toBe("Order/ord_1");
  });

  it("**改载荷界面就变**：换等待态 + 换 owner + 换时长，三处显示同时跟着改", async () => {
    net.payload = payloadOf([
      approvalRow({
        waitState: "WAITING_EXTERNAL_SYSTEM",
        waitRef: "supplier_portal:PO-8891",
        ownerFunctionKey: "procurement",
        ownerDisplayName: "采购",
        waitedMs: 5 * DAY + 6 * 3_600_000,
      }),
    ]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-badge")).toBeTruthy());
    expect(screen.getByTestId("stuck-badge").textContent).toBe(
      PROCESS_TASK_WAIT_STATE_META.WAITING_EXTERNAL_SYSTEM.displayName,
    );
    expect(screen.getByTestId("stuck-why").textContent).toContain(
      PROCESS_TASK_WAIT_STATE_META.WAITING_EXTERNAL_SYSTEM.blocker,
    );
    expect(screen.getByTestId("stuck-waitref").textContent).toBe("supplier_portal:PO-8891");
    expect(screen.getByTestId("stuck-owner").textContent).toBe("采购");
    expect(screen.getByTestId("stuck-waited").textContent).toBe("5 天 6 小时");
    // 卡片上带 data-wait-state，五态可被机器区分（不只是一句文案）
    expect(screen.getByTestId("stuck-card").getAttribute("data-wait-state")).toBe("WAITING_EXTERNAL_SYSTEM");
  });

  it("五个等待态**各自**都能渲染出自己的人话（一个都不许漏，且不许串台）", async () => {
    // 🔴 循环前的**基数下界**（`check-coverage-blind` 的 LOOP_NO_FLOOR 咬的就是缺这一行）。
    // 没有它，词表若为空则循环体一次都不进 ⇒ 本例**恒绿**，而「五个态都渲染对」与
    // 「一个态都没测」在颜色上完全一样。⚠ 这一行是被那道门**当场报红逼出来的**，不是我想起来的。
    // 数字咬死 5 而不是 `> 0`：本页的全部意义就是五态互不串台，掉到四态必须红。
    expect(PROCESS_TASK_WAIT_STATES, "契约词表不是五值 ⇒ 下面的逐态断言不再覆盖全集").toHaveLength(5);
    const covered: string[] = [];
    for (const s of PROCESS_TASK_WAIT_STATES) {
      net.payload = payloadOf([approvalRow({ waitState: s, waitRef: `ref_${s}` })]);
      const { unmount } = { unmount: () => {} };
      document.body.innerHTML = "";
      await renderViaRegistry();
      await waitFor(() => expect(screen.getByTestId("stuck-badge")).toBeTruthy());
      expect(screen.getByTestId("stuck-badge").textContent, `${s} 的人话没渲染对`).toBe(
        PROCESS_TASK_WAIT_STATE_META[s].displayName,
      );
      expect(screen.getByTestId("stuck-card").getAttribute("data-wait-state")).toBe(s);
      covered.push(s);
      unmount();
    }
    // 循环**后**再收一次口：中途 break/continue 或提前 return 都会在这里露馅。
    expect(covered, "逐态断言实际只跑了一部分 ⇒ 「五态齐」是假的").toEqual([...PROCESS_TASK_WAIT_STATES]);
  });

  it("等待态计数条五个 key 恒在（0 是统计事实，与「缺就不显示」不冲突）", async () => {
    net.payload = payloadOf([approvalRow(), approvalRow({ instanceId: "pinst_2", waitState: "WAITING_DATA" })]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("tally-WAITING_APPROVAL")).toBeTruthy());
    expect(screen.getByTestId("tally-WAITING_APPROVAL").textContent).toContain("1");
    expect(screen.getByTestId("tally-WAITING_DATA").textContent).toContain("1");
    // 没有实例的态显示 0（这是「知道，且为零」）
    expect(screen.getByTestId("tally-WAITING_SCHEDULE").textContent).toContain("0");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 诚实缺席（本仓多起事故的直接对策）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE FE · 诚实缺席（缺就不显示那一块）", () => {
  it("没有 waitedMs ⇒ 「已等」整块**不渲染**，且界面不出现 0 / 未知 / - / N/A", async () => {
    const row = approvalRow();
    delete (row as Record<string, unknown>).waitedMs;
    delete (row as Record<string, unknown>).waitingSince;
    net.payload = payloadOf([row]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-step")).toBeTruthy());
    expect(screen.queryByTestId("stuck-waited"), "没有等待时长就不该有这一块").toBeNull();
    expect(screen.queryByText("已等")).toBeNull();
    for (const bad of ["未知", "N/A", "暂无数据"]) {
      expect(screen.queryByText(bad), `不许用占位符 ${bad} 冒充数据`).toBeNull();
    }
  });

  it("没有 ownerDisplayName ⇒ 退回显示 key 原值（真的），不是「未知」", async () => {
    net.payload = payloadOf([
      approvalRow({ ownerFunctionKey: "tenant_custom_dept", ownerDisplayName: undefined }),
    ]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-owner")).toBeTruthy());
    expect(screen.getByTestId("stuck-owner").textContent).toBe("tenant_custom_dept");
  });

  it("没有 definitionName ⇒ **不渲染**流程名，不拿 definitionKey 冒充名字", async () => {
    const row = approvalRow();
    delete (row as Record<string, unknown>).definitionName;
    net.payload = payloadOf([row]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-step")).toBeTruthy());
    expect(screen.queryByTestId("stuck-defname")).toBeNull();
  });

  it("零结果**不说**「一切正常」，而是点明可能只是还没有实例数据", async () => {
    net.payload = payloadOf([]);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-empty")).toBeTruthy());
    const txt = screen.getByTestId("stuck-empty").textContent ?? "";
    expect(txt).toContain("不等于");
    expect(txt).toContain("模板");
    expect(txt).not.toContain("一切正常");
  });

  it("功能未开通（404 FEATURE_NOT_FOUND）与「加载失败」是**两种**显示，不合并", async () => {
    net.fail = { code: "FEATURE_NOT_FOUND", status: 404, message: "feature not found" };
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-disabled")).toBeTruthy());
    expect(screen.queryByTestId("stuck-error"), "未开通不是故障，不许显示成错误").toBeNull();

    document.body.innerHTML = "";
    net.fail = { code: "INTERNAL", status: 500, message: "boom" };
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-error")).toBeTruthy());
    expect(screen.queryByTestId("stuck-disabled")).toBeNull();
  });

  /* ── 以下两条为 WO-R9-STUCKVIEW 新增：合并单新立的 `derivedStuckCount` 诚实位 ──────
   * 契约 `process-runtime.ts` §5 逐字写着：
   *   > 「但**不许因此静默消失**：不报这个数，调用方会把『本投影没算它们』读成『它们不存在』。」
   * 后端如实报了、前端把它吞掉，这条诚实位等于没有 —— 而且比没有更糟（契约里写着已经报了）。 */

  it("derivedStuckCount > 0 ⇒ 界面**必须**说出「本页答不出的那一批」及去哪看", async () => {
    net.payload = payloadOf([approvalRow()], 7);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-derived-note")).toBeTruthy());
    expect(screen.getByTestId("stuck-derived-count").textContent).toBe("7");
    const txt = screen.getByTestId("stuck-derived-note").textContent ?? "";
    /**
     * 必须说清「为什么本页答不出」（不是含糊一句"另有若干"），并给出去哪看。
     * ⚠ 2026-08-17 WO-SCREEN-PLAINSPEAK 改判据落点，**这两件事一件没少**：
     *   原来靠屏上印 `DERIVED_FROM_DOCUMENT`（溯源枚举值）与 `process_flow_time`（求解器名）——
     *   决策者读了做不出任何决定。落点换成「为什么」与「去哪看」的人话版。
     */
    expect(txt).toContain("反推");
    expect(txt).toContain("单据上没有「第几步」");
    expect(txt).toContain("流程等待态");
    // 反向：为 0 时不许挂这一块（那句话此时没有信息量，挂着像在暗示"另有一批"）
    document.body.innerHTML = "";
    net.payload = payloadOf([approvalRow()], 0);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-step")).toBeTruthy());
    expect(screen.queryByTestId("stuck-derived-note")).toBeNull();
  });

  it("stuck 为空**但** derivedStuckCount>0 ⇒ 空态不许说「没有正在等待的流程实例」（那句是假的）", async () => {
    net.payload = payloadOf([], 4);
    await renderViaRegistry();
    await waitFor(() => expect(screen.getByTestId("stuck-empty")).toBeTruthy());
    const txt = screen.getByTestId("stuck-empty").textContent ?? "";
    // 真有 4 条卡着，只是产地不同 —— 说成「没有正在等待的流程实例」会被直接读反。
    // 咬的是**那半句本身**（不是带前缀的整句）：任何形式的「没有正在等待的流程实例」此刻都是假话。
    // ⚠ 本条在收编时**真的报红过一次**，抓的是我自己写的文案：初版这一支写着
    //   「把这句读成『一切顺利』会直接读反」——一句讲纪律的话，却让「一切顺利」四个字
    //   真的出现在了用户屏幕上。改的是**文案**不是断言（断言弱化 = 掩盖）。
    expect(txt).not.toContain("没有正在等待的流程实例");
    expect(txt).toContain("4");
    expect(txt).not.toContain("一切顺利");
    // 那一批的说明同时也得在
    expect(screen.getByTestId("stuck-derived-count").textContent).toBe("4");

    // WO-UI-BURNDOWN-21（2026-08-14）：这条诚实位**留在第一层**，不许被"降层"降没了。
    // 判据出处 `docs/CONVENTION-ui-information-layering.md` §4.2：
    // 「这条诚实位若为真，用户会不会重新解读第一层的那个结论？会 ⇒ 它属于第一层。」
    // 这里正是"会"：不看它，本页的 0 会被读成「流程都没卡」。
    // 那次分层只改了一个指路词（「口径声明」→「说明」），被指的那段一个字没动 ——
    // 故这三句必须仍然**不点就看得见**。
    expect(txt, "改成 `?` 浮层就等于把它藏起来了 —— §4.2 明令这条不许降层").toContain("本页只统计运行时实例");
    expect(txt).toContain("会直接读反");
    expect(txt).toContain("见上方那条说明");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ④ 契约单源 + 主题（前端不得重定义契约已有类型 / 零硬编码颜色）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-PROCESS-INSTANCE FE · 单源与主题", () => {
  it("组件从 @platform/contracts 取词表与人话，**没有**手抄一份等待态字面量表", () => {
    const raw = readFileSync(join(SRC, "views", "ProcessStuckView.tsx"), "utf8");
    expect(raw.includes("PROCESS_TASK_WAIT_STATE_META"), "金丝雀：读错文件了").toBe(true);
    expect(raw.includes('from "@platform/contracts"')).toBe(true);

    // ⚠ **必须先剥注释再匹配** —— 初版没剥，结果匹到了组件文档里那句「别在这里手写
    // 一份 `{ WAITING_USER: "等人处理" }`」的**反面教材原文**，把一条讲纪律的注释
    // 判成了违纪代码。形态即铁律 0.6 的句式：「我用『源码文本里出现该模式』当作
    // 『代码里存在该映射』的证据，而前者并不度量后者」——注释也是源码文本。
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    // 金丝雀：剥注释这一步本身得是对的 —— 剥完必须还留着真代码，否则「没匹到」
    // 只是因为把整个文件都剥没了（那是工具坏了，不是代码干净）。
    expect(code.includes("PROCESS_TASK_WAIT_STATE_META"), "金丝雀：剥注释把代码也剥没了 ⇒ 工具坏了").toBe(true);
    expect(code.includes("等人处理"), "金丝雀：注释里的反面教材原文应已被剥掉").toBe(false);

    // 手抄一份 { WAITING_USER: "…" } 的映射即红。
    expect(/WAITING_USER\s*:\s*["'{]/.test(code), "组件里出现自建的 WAITING_* 映射 ⇒ 第二真相源").toBe(false);
  });

  it("mock handler 的 byWaitState 也从契约派生（mock 不许手抄五值）", () => {
    const src = readFileSync(join(SRC, "mocks", "handlers.ts"), "utf8");
    expect(src.includes("PROCESS_TASK_WAIT_STATES"), "mock 应从契约派生等待态词表").toBe(true);
  });

  /**
   * WO-R9-STUCKVIEW 新增：**mock 载荷必须过真契约 schema**。
   *
   * 收编时实测的病：原 mock 写的是合并前的 `definitionKey`、且没有合并后新增的必填
   * `derivedStuckCount`。两者都不会让任何既有断言变红（mock 模式没人校验形状），
   * 但 mock 模式下这一页要么少显示一整块、要么显示的是**契约里已不存在的字段**。
   * 拿 zod 直接咬，是唯一能让"mock 与契约漂移"这件事**机器先说话**的办法。
   */
  it("mock handler 的载荷逐字段过 ProcessStuckResponseSchema（mock 与契约漂移即红）", async () => {
    // MSW 由 test/setup.ts 起停（`onUnhandledRequest: "error"`），这里直接打 datacore 基址；
    // 走的就是应用真实会走的那一条 handler，不是另造一份 fixture。
    const res = await fetch("http://a.test/a/v1/process-instances/stuck");
    expect(res.status, "金丝雀：mock handler 没接上 ⇒ 下面的 parse 验的是空气").toBe(200);
    const body = await res.json();
    const parsed = ProcessStuckResponseSchema.safeParse(body);
    expect(
      parsed.success,
      `mock 载荷不符合契约：${parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2)}`,
    ).toBe(true);
    // 具体咬两处合并单改动，防"schema 过了但语义漂了"
    expect((body as ProcessStuckResponse).stuck[0]).toHaveProperty("processKey");
    expect((body as ProcessStuckResponse).stuck[0]).not.toHaveProperty("definitionKey");
    expect(
      (body as ProcessStuckResponse).derivedStuckCount,
      "mock 给 0 ⇒ 那条诚实位分支在 mock 模式下从不进入（接了线没数据）",
    ).toBeGreaterThan(0);
  });

  it("样式零硬编码颜色（三套主题自动跟随）", () => {
    const css = readFileSync(join(SRC, "views", "ProcessStuckView.module.css"), "utf8");
    expect(css.includes("var(--"), "金丝雀：CSS 里连一个 token 都没有 ⇒ 读错文件了").toBe(true);
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const fns = css.match(/\b(rgb|rgba|hsl|hsla)\s*\(/g) ?? [];
    expect(hex, `出现硬编码 hex：${hex.join(",")}`).toHaveLength(0);
    expect(fns, `出现颜色函数字面量：${fns.join(",")}`).toHaveLength(0);
  });
});
