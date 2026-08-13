import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import {
  ENTERPRISE_STATE_REAL_WORLD_ID,
  EnterpriseStateSchema,
  ImpactAnalysisResponseSchema,
  enterpriseStateId,
  type SandboxViewConfig,
} from "@platform/contracts";
import {
  captureEnterpriseStateSnapshot,
  createSimSession,
  fetchEnterpriseStates,
  fetchLatestEnterpriseState,
  runImpactAnalysis,
} from "@/api/endpoints";
import SandboxView from "@/views/sim/SandboxView";
import { TENANT_ID } from "@/mocks/fixtures";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { checkedTree, factHits } from "./factlock";

/**
 * WO-BEFE-WIRE-3 · **三条「后端注册了、前端零调用方」端点的接缝门**
 * （门 `befe-seam:check` 载体② 在并集态第一次照出它们；断点 `G-BE-FE-SEAM-DEAD`）。
 *
 * ── 派单里的路径与实测不符，本文件以**门跑出来的报告原文**为准 ────────────────
 *   派单写的                                   门报告里的真路径
 *   `POST /a/v1/sim/impact-analysis`        →  `POST /a/v1/simulation/impact-analysis`
 *   `POST /a/v1/enterprise-states/:id/fork` →  `POST /a/v1/twin/enterprise-states/:id/fork`
 *   `POST /a/v1/enterprise-states/diff`     →  **GET** `/a/v1/twin/enterprise-states/:id/diff?against=`
 * 三条全错（前缀 `sim`→`simulation`、少了 `twin` 段、方法 POST→GET）。照抄派单就会去接三条不存在的路。
 *
 * ── 为什么**不** `vi.mock("@/api/endpoints")` ────────────────────────────────
 * 那会把病灶所在的那一跳一起 mock 掉：桩函数收什么参数都行，URL 模板、query 串、body 序列化
 * 根本不参与，于是断言恒绿而缺口仍在。本文件走**真 endpoints**，在 MSW 层拦**真实 URL + 真实 body**
 * ——咬的是链路，不是函数（本仓假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 就死在这上面）。
 *
 * ── 判据「用户点得到」而不是「API 层有函数」──────────────────────────────────
 * 每条端点都从**真实渲染出来的可见控件**驱动：
 *   ① 影响传播 → `renderApp("/v/what-if")`（真 route）→ 选类型/对象/属性/值 → 选世界 → 点「在世界里分析影响」
 *   ② 分叉    → 挂真 `SandboxView` → 展开右栏「快照分叉与比对」→ 点「分叉进仿真世界」
 *   ③ 比对    → 同上 → 选两份快照 → 点「比对这两份快照」
 * 并各配一条**源码挂载断言**：组件必须真的被某个页面渲染（右栏是手工数组、无自动扫描，
 * 删掉那一行组件立刻变成"实现有、测试绿、零渲染得到"）。
 */

const readRepoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/* ═══════════════════════════════════════════════════════════════════════════
 * ① POST /a/v1/simulation/impact-analysis
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 在 `/v/what-if` 页上填满一处假设（真 REST 取类型/对象），返回选中的那个对象 id。 */
async function fillHypothesis(propKey: string, value: string): Promise<string> {
  fireEvent.change(await screen.findByTestId("wi-type-select"), { target: { value: "Base" } });
  const objSelect = await screen.findByTestId("wi-object-select");
  await waitFor(() => {
    const opts = within(objSelect).getAllByRole("option") as HTMLOptionElement[];
    expect(opts.filter((o) => o.value !== "").length, "对象列表空 ⇒ 后面选不出东西，断言全是空胜").toBeGreaterThan(0);
  });
  const objectId = (within(objSelect).getAllByRole("option") as HTMLOptionElement[]).filter((o) => o.value !== "")[0]!
    .value;
  fireEvent.change(objSelect, { target: { value: objectId } });
  fireEvent.change(screen.getByTestId("wi-prop-select"), { target: { value: propKey } });
  fireEvent.change(screen.getByTestId("wi-value-input"), { target: { value } });
  return objectId;
}

describe("WO-BEFE-WIRE-3 ① 影响传播（POST /a/v1/simulation/impact-analysis）", () => {
  beforeEach(() => {
    loginAs("planner");
  });
  afterEach(() => cleanup());

  it("①-A 用户点得到：真 route 上选完假设 → 点按钮 → 屏上四维的每个数都来自那次响应", async () => {
    const world = await createSimSession({ baseSnapshot: { "TypeA#0": { load: 50, risk: 20 } } });

    renderApp("/v/what-if");
    const objectId = await fillHypothesis("util", "2");

    // 世界下拉的默认值 = 后端真回的那个会话 id（不是前端写死的字符串）。
    const worldSel = (await screen.findByTestId("impact-world-select")) as HTMLSelectElement;
    expect(worldSel.value, "世界下拉没选中后端返回的会话 ⇒ 它的选项是编的").toBe(world.id);

    fireEvent.click(screen.getByTestId("impact-run"));
    await screen.findByTestId("impact-head");

    // 期望值 = 拿同一处变更**再打一次真端点**（同一条 api 层，未 mock）。
    // mock 引擎对 `oldValue` 不敏感（它只吃 objectType/objectId/value），故此处不必复刻 oldValue。
    const expected = ImpactAnalysisResponseSchema.parse(
      await runImpactAnalysis({
        worldId: world.id,
        change: { objectType: "Base", objectId, prop: "util", value: 2 },
        limit: 200,
      }),
    );
    // 金丝雀：闭包非空，否则下面「逐条相等」是空胜。
    expect(expected.affectedObjects.count, "闭包为空 ⇒ 这条用例证明不了任何事").toBeGreaterThan(0);

    expect(screen.getByTestId("impact-count-objects").textContent).toBe(String(expected.affectedObjects.count));
    expect(screen.getByTestId("impact-universe-objects").textContent).toContain(
      String(expected.affectedObjects.universe),
    );
  });

  it("①-B 真 URL + 真 body：body 逐字段是用户在表单里选的那些（不是写死的默认值）", async () => {
    const world = await createSimSession({ baseSnapshot: {} });
    const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
    server.use(
      http.post("*/a/v1/simulation/impact-analysis", async ({ request }) => {
        calls.push({ url: request.url, method: request.method, body: (await request.json()) as Record<string, unknown> });
        // 刻意与默认桩**完全不同**的一组数：屏上若还显默认值，就是写死的。
        return HttpResponse.json({
          basis: {
            engine: "ontology-core.recompute",
            worldId: world.id,
            worldTick: 7,
            worldStatus: "RUNNING",
            worldOverlayApplied: 3,
            countBasis: "DISTINCT_OBJECTS",
            derivationSpecCount: 4,
            kpiTypeKeys: ["ProbeKpiType"],
            oldValueMismatch: true,
            observedOldValue: 41,
          },
          affectedObjects: {
            available: true,
            count: 9,
            universe: 137,
            items: [{ objectId: "probe-obj-1", objectType: "ProbeType", changedProps: [{ prop: "pk", before: 1, after: 2 }] }],
            truncated: true,
          },
          affectedProcesses: {
            available: true,
            count: 5,
            universe: 65,
            items: [
              {
                processKey: "P42",
                name: "探针流程",
                domainKey: "D07",
                ownerFunctionKey: "F1",
                waitKind: "NONE",
                stdDurationDays: 3,
                carrierTypeKey: "ProbeType",
                viaObjectIds: ["probe-obj-1"],
              },
            ],
            truncated: false,
            instanceLevel: { available: false, reason: "实例粒度今天无承载物", missingCarrier: "ProcessInstance" },
          },
          affectedDecisions: {
            available: true,
            count: 0,
            universe: 0,
            items: [],
            truncated: false,
          },
          affectedKpis: { available: true, count: 2, universe: 11, items: [], truncated: false },
          warnings: ["探针告警一", "探针告警二"],
        });
      }),
    );

    renderApp("/v/what-if");
    const objectId = await fillHypothesis("util", "2");
    fireEvent.click(screen.getByTestId("impact-run"));
    await screen.findByTestId("impact-head");

    // ★ 打的是真端点、真方法。
    await waitFor(() => expect(calls.length, "点了按钮一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url, `打错端点：${calls[0]!.url}`).toContain("/a/v1/simulation/impact-analysis");
    // ★ body 逐字段来自表单（world 来自下拉、change 来自四个选择器）。
    expect(calls[0]!.body).toMatchObject({
      worldId: world.id,
      change: { objectType: "Base", objectId, prop: "util", value: 2 },
    });

    // ★ 屏上每个数都来自这次响应（零写死）。
    expect(screen.getByTestId("impact-count-objects").textContent).toBe("9");
    expect(screen.getByTestId("impact-universe-objects").textContent).toContain("137");
    expect(screen.getByTestId("impact-count-processes").textContent).toBe("5");
    expect(screen.getByTestId("impact-universe-processes").textContent).toContain("65");
    expect(screen.getByTestId("impact-count-kpis").textContent).toBe("2");
    expect(screen.getByTestId("impact-count-decisions").textContent).toBe("0");
    // 诚实位记号必须在**第一层**看得见（降层到浮层可以，删掉不行）。
    expect(screen.getByTestId("impact-warning-flag").textContent).toContain("2");
    expect(screen.getByTestId("impact-oldvalue-mismatch")).toBeInTheDocument();
    expect(screen.getByTestId("impact-truncated-objects")).toBeInTheDocument();
  });

  it("①-C 「算不了」不许塌成 0：`available:false` 显「算不了」+ 缺什么，且不渲染任何计数", async () => {
    await createSimSession({ baseSnapshot: {} });
    renderApp("/v/what-if");
    await fillHypothesis("util", "2");
    fireEvent.click(screen.getByTestId("impact-run"));
    await screen.findByTestId("impact-head");

    // 默认桩里 mock 世界真的没有流程/决策/KPI 承载物 ⇒ 三维 available:false。
    for (const dim of ["processes", "decisions", "kpis"]) {
      const card = screen.getByTestId(`impact-dim-${dim}`);
      expect(card.getAttribute("data-available"), `${dim} 维不该是 available`).toBe("0");
      expect(screen.getByTestId(`impact-blocked-${dim}`).textContent).toBe("算不了");
      // 缺的承载物名来自响应（可 grep 验证，不是一句"暂无数据"）。
      expect(screen.getByTestId(`impact-missing-${dim}`).textContent!.length).toBeGreaterThan(2);
      // ★ 反证核心：这一维**不许**渲染出计数（渲染出来就是把"算不了"塌成了 0）。
      expect(screen.queryByTestId(`impact-count-${dim}`), `${dim} 维把「算不了」渲染成了数字`).toBeNull();
    }
  });

  it("①-C2 对照组：`count:0 · universe:0`（台账空）必须真的显 0 —— 与「算不了」在屏上分得开", async () => {
    await createSimSession({ baseSnapshot: {} });
    server.use(
      http.post("*/a/v1/simulation/impact-analysis", () =>
        HttpResponse.json({
          basis: {
            engine: "ontology-core.recompute", worldId: "w", worldTick: 0, worldStatus: "READY",
            worldOverlayApplied: 0, countBasis: "DISTINCT_OBJECTS", derivationSpecCount: 0,
            kpiTypeKeys: [], oldValueMismatch: false,
          },
          affectedObjects: { available: true, count: 0, universe: 0, items: [], truncated: false },
          affectedProcesses: { available: true, count: 0, universe: 0, items: [], truncated: false, instanceLevel: { available: false, reason: "r", missingCarrier: "ProcessInstance" } },
          affectedDecisions: { available: true, count: 0, universe: 0, items: [], truncated: false },
          affectedKpis: { available: true, count: 0, universe: 0, items: [], truncated: false },
          warnings: [],
        }),
      ),
    );
    renderApp("/v/what-if");
    await fillHypothesis("util", "2");
    fireEvent.click(screen.getByTestId("impact-run"));
    await screen.findByTestId("impact-head");
    expect(screen.getByTestId("impact-count-processes").textContent).toBe("0");
    expect(screen.getByTestId("impact-universe-processes").textContent).toContain("0");
    expect(screen.queryByTestId("impact-blocked-processes"), "台账空被误显成「算不了」").toBeNull();
  });

  it("①-D 零写死反证：端点打成 500 → 诚实错误块，屏上不再有任何四维数字", async () => {
    await createSimSession({ baseSnapshot: {} });
    server.use(
      http.post("*/a/v1/simulation/impact-analysis", () =>
        HttpResponse.json({ error: { code: "BOOM", message: "传播炸了", requestId: "req_i" } }, { status: 500 }),
      ),
    );
    renderApp("/v/what-if");
    await fillHypothesis("util", "2");
    fireEvent.click(screen.getByTestId("impact-run"));

    const box = await screen.findByTestId("impact-error");
    expect(box.textContent).toContain("BOOM");
    expect(box.textContent).toContain("传播炸了");
    expect(box.textContent).toContain("req_i");
    expect(screen.queryByTestId("impact-head"), "报错了还留着上一轮的数字 = 那些数是写死的").toBeNull();
    expect(screen.queryByTestId("impact-count-objects")).toBeNull();
  });

  it("①-E 不是死组件：`ImpactAnalysisPanel` 真的被 WhatIfView 渲染，且端点 URL 真在 endpoints.ts 里", () => {
    const view = readRepoFile("../src/views/WhatIfView.tsx");
    expect(view.length, "WhatIfView.tsx 读到了空内容——路径漂了，先修路径再看结论").toBeGreaterThan(1000);
    expect(view).toContain(`import { ImpactAnalysisPanel }`);
    expect(view).toContain(`<ImpactAnalysisPanel change={impactChange} />`);

    const eps = readRepoFile("../src/api/endpoints.ts");
    // 金丝雀：同样的手法先抓一个已知必在的 URL，抓不到说明是断言方式坏了而不是端点没接。
    expect(eps, "金丝雀未中 ⇒ 读法坏了，下面的「不存在」全部不可信").toContain("/a/v1/twin/enterprise-states");
    expect(eps).toContain(`"/a/v1/simulation/impact-analysis"`);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ②③ POST …/twin/enterprise-states/:id/fork  ·  GET …/twin/enterprise-states/:id/diff
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 抽象占位配置（R14 零行业实体名）——沙盘挂载所需，本节不依赖它的任何数值。 */
const CFG: SandboxViewConfig = {
  tenantId: "tenant-seam",
  nodeTypes: ["TypeA"],
  nodeObjectIds: { TypeA: ["obj_a1"] },
  linkTypes: ["FEEDS"],
  stateVars: ["load"],
  radarDims: [
    { key: "structure", label: "结构" },
    { key: "knowledge", label: "知识" },
    { key: "behavior", label: "行为" },
  ],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 1,
};

function mountSandbox() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

/** 展开右栏「快照分叉与比对」（第二层：一次点击）。 */
async function openTwinRail(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const sec = await screen.findByTestId("sc-rail-enterprise-state-twin");
  await user.click(within(sec).getByText("快照分叉与比对"));
}

describe("WO-BEFE-WIRE-3 ②③ 快照分叉与比对（fork / diff）", () => {
  beforeEach(() => {
    loginAs("planner");
  });
  afterEach(() => cleanup());

  it("②-A 用户点得到：沙盘右栏展开 →「分叉进仿真世界」→ 屏上真出现新行，真实世界那一行零字节改动", async () => {
    const user = userEvent.setup();
    const world = await createSimSession({ baseSnapshot: {} });
    const sourceRaw = await captureEnterpriseStateSnapshot(); // 真实世界一份快照（原始响应，供逐字节比对）
    const source = EnterpriseStateSchema.parse(sourceRaw); // 过契约 schema = 与真后端同形状

    mountSandbox();
    await screen.findByTestId("sandbox-view");
    await openTwinRail(user);
    await screen.findByTestId("enterprise-state-twin");

    // 第一层先给「有几份快照」这个数（来自 GET …/twin/enterprise-states，不是前端数出来的）。
    await waitFor(() => expect(screen.getByTestId("twin-state-count").textContent).toBe("1"));

    // 分叉源默认 = 真实世界那一份；目标默认 = 后端真回的那个推演会话。
    expect((screen.getByTestId("twin-fork-source") as HTMLSelectElement).value).toBe(source.id);
    expect((screen.getByTestId("twin-fork-target") as HTMLSelectElement).value).toBe(world.id);

    // 拦一层只为取证（取证后仍把请求交给默认桩不可行，故这里直接复用契约纯函数算出同一份结果）。
    await user.click(screen.getByTestId("twin-fork-run"));

    const forkedId = await screen.findByTestId("twin-forked-id");
    // ★ 新行的 id 是**后端算的**确定性 id（契约函数同源），不是前端拼的字符串。
    expect(forkedId.textContent).toBe(enterpriseStateId(TENANT_ID, world.id, source.capturedAt.tick));
    expect(screen.getByTestId("twin-forked-world").textContent).toBe(world.id);
    expect(screen.getByTestId("twin-forked-from").textContent).toBe(source.id);
    // 诚实位：这些数是复制来的、没有重算 —— 第一层必须留得住这句话。
    expect(screen.getByTestId("twin-forked-provenance").textContent).toContain("FORK");
    expect(screen.getByTestId("twin-forked-provenance").textContent).toContain("未重算");

    // ★ 效果层：新行真的进了时间线（重取而不是本地拼一条）。
    await waitFor(() => expect(screen.getByTestId("twin-state-count").textContent).toBe("2"));

    // ★ 世界隔离反证：真实世界那一行**一个字节都没动**。
    const realAfter = await fetchLatestEnterpriseState(ENTERPRISE_STATE_REAL_WORLD_ID);
    expect(JSON.stringify(realAfter.state), "分叉动了真实世界那一行 ⇒ 两世界没有物理隔离").toBe(
      JSON.stringify(sourceRaw),
    );
  });

  it("②-B 真 URL + 真 body：fork 打的是 `/twin/enterprise-states/<id>/fork`，body.worldId = 下拉选的那个", async () => {
    const user = userEvent.setup();
    const world = await createSimSession({ baseSnapshot: {} });
    const source = await captureEnterpriseStateSnapshot();

    const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
    server.use(
      http.post("*/a/v1/twin/enterprise-states/:id/fork", async ({ params, request }) => {
        calls.push({ url: request.url, method: request.method, body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json(
          {
            ...source,
            id: "estate_probe_forked",
            worldId: String((params as { id: string }).id) === source.id ? world.id : "WRONG",
            isSimulated: true,
            forkedFromStateId: source.id,
            provenance: { ...source.provenance, mode: "FORK", basedOnStateId: source.id, clockSource: "FORKED" },
          },
          { status: 201 },
        );
      }),
    );

    mountSandbox();
    await screen.findByTestId("sandbox-view");
    await openTwinRail(user);
    await screen.findByTestId("enterprise-state-twin");
    await user.click(await screen.findByTestId("twin-fork-run"));

    await waitFor(() => expect(calls.length, "点了按钮一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    expect(calls[0]!.method).toBe("POST");
    // 路径段必须完整带 `twin`（派单里那条没有 `twin` 的路径根本不存在）。
    expect(calls[0]!.url).toContain(`/a/v1/twin/enterprise-states/${encodeURIComponent(source.id)}/fork`);
    expect(calls[0]!.body).toEqual({ worldId: world.id });
    // 屏上显示的是**响应里**那个 id，不是请求里那个（证明是投影响应而不是乐观拼串）。
    expect((await screen.findByTestId("twin-forked-id")).textContent).toBe("estate_probe_forked");
  });

  it("③-A 用户点得到：选两份快照 →「比对这两份快照」→ 真发 GET …/:id/diff?against=，屏上出结论", async () => {
    const user = userEvent.setup();
    const world = await createSimSession({ baseSnapshot: {} });
    const source = await captureEnterpriseStateSnapshot();
    const forkedId = enterpriseStateId(TENANT_ID, world.id, source.capturedAt.tick);

    mountSandbox();
    await screen.findByTestId("sandbox-view");
    await openTwinRail(user);
    await screen.findByTestId("enterprise-state-twin");
    // 先分叉出第二份（比对需要两份）——同一条 UI 链，不是测试自己往 store 里塞。
    await user.click(await screen.findByTestId("twin-fork-run"));
    await waitFor(() => expect(screen.getByTestId("twin-state-count").textContent).toBe("2"));

    // 取证：拦 diff 只为读 URL/参数；结果仍来自后端（这里把它换成一组**有差异**的真结果，
    // 因为 mock 世界里 fork 是逐字节复制 ⇒ 真差分必然 0 项，那一支在 ③-B 单独验）。
    const diffCalls: string[] = [];
    server.use(
      http.get("*/a/v1/twin/enterprise-states/:id/diff", ({ params, request }) => {
        diffCalls.push(request.url);
        return HttpResponse.json({
          before: new URL(request.url).searchParams.get("against"),
          after: String((params as { id: string }).id),
          changes: [
            { key: "kpi:probe_a", group: "profit", label: "探针指标甲", from: 10, to: 12.5 },
            // `null` = 诚实空：该项在那份快照里数不出来 —— 屏上必须是「—」不是 0。
            { key: "sum:Probe.x", group: "supply", label: "探针合计", from: null, to: 3 },
          ],
        });
      }),
    );

    await user.click(screen.getByTestId("twin-diff-run"));
    await screen.findByTestId("twin-diff-head");

    // ★ 真 URL + 真 query：`against` 就是「基准」下拉当前选中的那一份。
    await waitFor(() => expect(diffCalls.length).toBe(1));
    const url = new URL(diffCalls[0]!);
    expect(url.pathname).toContain("/a/v1/twin/enterprise-states/");
    expect(url.pathname.endsWith("/diff"), `不是 diff 路径：${url.pathname}`).toBe(true);
    const against = (screen.getByTestId("twin-diff-against") as HTMLSelectElement).value;
    const base = (screen.getByTestId("twin-diff-base") as HTMLSelectElement).value;
    expect(url.searchParams.get("against")).toBe(against);
    expect(decodeURIComponent(url.pathname)).toContain(base);
    // 两端确实是两份不同的快照（否则"比对"这件事本身没发生）。
    expect(new Set([against, base, source.id, forkedId]).size).toBe(2);

    // ★ 屏上逐行来自响应（含 null → 「—」，绝不是 0）。
    expect(screen.getByTestId("twin-diff-count").textContent).toBe("2");
    expect(screen.getByTestId("twin-diff-from-kpi:probe_a").textContent).toBe("10");
    expect(screen.getByTestId("twin-diff-to-kpi:probe_a").textContent).toBe("12.50");
    expect(screen.getByTestId("twin-diff-from-sum:Probe.x").textContent).toBe("—");
    expect(screen.getByTestId("twin-diff-from-sum:Probe.x").textContent).not.toBe("0");
    expect(screen.getByTestId("twin-diff-to-sum:Probe.x").textContent).toBe("3");
  });

  it("③-B 未拦截的真差分：刚分叉那份与源逐项一致 → 明写「0 项差异 = 比过了没有变化」，不是「没查到」", async () => {
    const user = userEvent.setup();
    await createSimSession({ baseSnapshot: {} });
    await captureEnterpriseStateSnapshot();

    mountSandbox();
    await screen.findByTestId("sandbox-view");
    await openTwinRail(user);
    await screen.findByTestId("enterprise-state-twin");
    await user.click(await screen.findByTestId("twin-fork-run"));
    await waitFor(() => expect(screen.getByTestId("twin-state-count").textContent).toBe("2"));

    await user.click(screen.getByTestId("twin-diff-run"));
    await screen.findByTestId("twin-diff-head");

    // fork 原样继承数值 ⇒ 契约纯函数 `diffEnterpriseStates` 真算出 0 项（这是**后端真算的**，不是桩摆的）。
    const states = await fetchEnterpriseStates();
    expect(states.items.length, "两份快照都在 ⇒ 差分的两端是真的").toBe(2);
    expect(screen.getByTestId("twin-diff-count").textContent).toBe("0");
    expect(screen.getByTestId("twin-diff-identical").textContent).toContain("完全一致");
    expect(screen.queryByTestId("twin-diff-table"), "0 项差异却渲染了表 ⇒ 表里是编的行").toBeNull();
  });

  it("②③-C 不是死组件：`EnterpriseStateTwinPanel` 真的挂在沙盘右栏，且两条 URL 真在 endpoints.ts 里", () => {
    const view = readRepoFile("../src/views/sim/SandboxView.tsx");
    expect(view.length, "SandboxView.tsx 读到了空内容——路径漂了").toBeGreaterThan(1000);
    expect(view).toContain(`import { EnterpriseStateTwinPanel }`);
    expect(view).toContain(`id: "enterprise-state-twin"`);
    expect(view).toContain(`node: <EnterpriseStateTwinPanel />`);

    // URL 模板住在哪个文件不是事实（WO-C 修法）：全树判在不在，搬家不红；模板没了才红。
    const fe = checkedTree("apps/frontend-shell/src", 'from "@platform/contracts"', 100);
    expect(factHits(fe, "/a/v1/twin/enterprise-states/latest"), "twin latest URL 没了 ⇒ 前端拼不出请求").not.toEqual([]);
    expect(factHits(fe, "}/fork`"), "fork URL 模板没了").not.toEqual([]);
    expect(factHits(fe, /\/diff\?against=\$\{encodeURIComponent\(against\)\}/), "diff URL 模板没了").not.toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ④ UI 信息分层规范（docs/CONVENTION-ui-information-layering.md）
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WO-BEFE-WIRE-3 ④ 两个新面板遵守 UI 信息分层规范", () => {
  beforeEach(() => {
    loginAs("planner");
  });
  afterEach(() => cleanup());

  /** 只扫代码：注释里出现 `title` 这个词不算违规（提及 ≠ 使用）。 */
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  /** 每份文件配一句**只在注释里出现**的金丝雀，用来自证"剥注释"这一步真的生效了。 */
  const FILES = [
    { rel: "../src/views/sim/ImpactAnalysisPanel.tsx", canary: "四个「0」不是同一个 0" },
    // ⚠ 别拿「两世界物理隔离」当金丝雀：那句话**同时**出现在浮层正文的 JSX 里（= 真代码），
    //   剥完注释仍在 ⇒ 金丝雀恒亮，反而证明不了剥注释生效（本文件第一版就这么错过一次）。
    { rel: "../src/views/sim/EnterpriseStateTwinPanel.tsx", canary: "不该挤进" },
  ] as const;

  it("④-A 禁用原生 tooltip：两个面板都不用 HTML `title=` / SVG `<title>` 当浮层（本仓出过滞留遮挡事故）", () => {
    for (const { rel, canary } of FILES) {
      const raw = readRepoFile(rel);
      expect(raw.length, `${rel}：读到了空内容——路径漂了，先修路径再看结论`).toBeGreaterThan(1000);
      // 自证工具：剥注释这一步必须真在剥（拿一句只在注释里出现的话当金丝雀）。
      expect(raw.includes(canary), `${rel}：金丝雀短语不在原文里了——探针过期，先修探针`).toBe(true);
      const code = stripComments(raw);
      expect(code.includes(canary), `${rel}：剥注释没生效 ⇒ 下面的「代码里没有」全部不可信`).toBe(false);
      expect(/\btitle\s*=/.test(code), `${rel}：代码里用了 title= 当浮层（规范 §2 明令禁止）`).toBe(false);
      expect(code.includes("<title"), `${rel}：代码里用了 SVG <title>`).toBe(false);
      // 正面判据：真的用了规范指定的那个唯一实现。
      expect(code).toContain("InfoPopover");
    }
  });

  it("④-B 口径/公式不在第一层：`?` 浮层默认不渲染，hover 才出（关着时 DOM 里没有正文）", async () => {
    const user = userEvent.setup();
    await createSimSession({ baseSnapshot: {} });
    renderApp("/v/what-if");
    await fillHypothesis("util", "2");
    fireEvent.click(screen.getByTestId("impact-run"));
    await screen.findByTestId("impact-head");

    // 关着时正文**不在 DOM**（不是 hidden —— 藏起来的东西照样进 DOM、照样被读屏念）。
    expect(screen.queryByTestId("info-body-impact-basis")).toBeNull();
    expect(screen.queryByTestId("impact-basis-note")).toBeNull();
    // 但触发器永远可见：诚实位降层后第一层必须留记号。
    await user.hover(screen.getByTestId("info-wrap-impact-basis"));
    const body = await screen.findByTestId("impact-basis-note");
    // 浮层里放的是口径 —— 引擎名与计数口径这类"凭什么"，不是结论数字。
    expect(body.textContent).toContain("ontology-core.recompute");
    expect(body.textContent).toContain("DISTINCT_OBJECTS");
  });

  it("④-C 第二层要点一次才出：明细表默认不渲染，点「展开明细」才有", async () => {
    const user = userEvent.setup();
    await createSimSession({ baseSnapshot: {} });
    renderApp("/v/what-if");
    await fillHypothesis("util", "2");
    fireEvent.click(screen.getByTestId("impact-run"));
    await screen.findByTestId("impact-head");

    expect(screen.queryByTestId("impact-details"), "明细默认就在第一层 ⇒ 分层没做").toBeNull();
    await user.click(screen.getByTestId("impact-detail-toggle"));
    await screen.findByTestId("impact-details");
    expect(screen.getByTestId("impact-detail-objects")).toBeInTheDocument();
  });
});
