import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { applyPerturbationToState, type Perturbation, type SandboxViewConfig, type TickState } from "@platform/contracts";
import { server } from "./setup";
import SandboxView from "@/views/sim/SandboxView";

/**
 * WO-SIM-ACT-CLOSE · **扰动入口接缝门**（欠账 #150 的前端这一半）。
 *
 * ── 这条测试要证的那件事 ─────────────────────────────────────────────────────
 * 沙盘此前**没有任何让世界改变的动作**：能推进时间、能存档、能分叉、能比对，唯独不能施加扰动。
 * 后端两个入口一直都在（`/act` 与 `/perturbations`），`endpoints.ts` 也早有 `createSimPerturbation`
 * 封装 —— 但**全仓零 UI 调用方**。「实现有、测试有、且是绿的，零生产调用方」正是本仓记过的
 * 假绿第 9 形态：测试咬的是**函数**不是**链路**。
 *
 * ── 为什么不 `vi.mock("@/api/endpoints")` ───────────────────────────────────
 * 既有 sandbox 测试普遍整包 mock endpoints，那会把**病灶所在的那一跳一起 mock 掉**：
 * 桩函数随便收什么参数都行，URL 模板与 body 序列化根本不参与，于是断言恒绿而缺陷仍在。
 * 本文件走**真 endpoints**，在 MSW 层拦**真实 URL + 真实 body** 断言 —— 咬链路，不咬函数。
 *
 * ── MSW 桩为什么不会与后端漂移 ───────────────────────────────────────────────
 * 世界态的改写**直接调契约里的 `applyPerturbationToState`** —— 那是后端 `/act` 与
 * `POST /perturbations` 的**唯一施加实现**（`packages/contracts/src/sim.ts`）。
 * 桩不自己写一套「大概是这样改」的逻辑，所以「屏上变的那个数」与真后端算的是同一份。
 *
 * ── 变异反证的实测结果（**含一个必须写下来的否定结果**）─────────────────────────
 * 交付前逐条改源码验过本门会不会红：
 *  · 改掉「施加」按钮的 testid          → ① 红 ✅（datacore 侧 `sim-act-close.seam.test.ts` 也红）
 *  · 引擎不吃扰动（propagateTick 传 []）→ datacore 侧 ①② 红 ✅
 *  · Trial Tick 传导相恒记 0            → datacore 侧 ④ 红 ✅
 *  · **只**删掉 `setWorld(res.state)`   → **不红** ❗️ —— `qc.setQueryData(["a","sim-world",…])`
 *    仍在，`worldQuery.data` 变化经既有 `useEffect` 照样把态推上屏。
 *    ⇒ ① 的 KPI 断言钉的是「回包**以某条路**到达了屏幕」这个**效果**，
 *      **不是**「`setWorld` 这一行还在」这个实现细节。两条路同时删才红（实测：'41.8' not to be '41.8'）。
 *    这条否定结果特意留在这里：不写下来，下一个人会以为它在守 `setWorld`，改动时被"绿"误导。
 */

// ── 证物：真实发出的请求 ────────────────────────────────────────────────────────
const perturbCalls: { url: string; body: Record<string, unknown> }[] = [];

/** 沙盘会话/世界/扰动的最小真后端镜像（语义抄 datacore app.ts，施加逻辑走契约单源）。 */
function installSimHandlers(base: TickState) {
  let world: TickState = JSON.parse(JSON.stringify(base)) as TickState;
  server.use(
    http.post("*/a/v1/sim/sessions", async ({ request }) => {
      const body = (await request.json()) as { baseSnapshot?: TickState; scope?: Record<string, unknown> };
      world = JSON.parse(JSON.stringify(body.baseSnapshot ?? {})) as TickState;
      return HttpResponse.json(
        {
          id: "sims_pert", tenantId: "demo", baseSnapshot: world, scope: body.scope ?? {},
          status: "READY", curTick: 0, parentCheckpointId: null, createdAt: "2026-08-10T00:00:00.000Z",
        },
        { status: 201 },
      );
    }),
    http.get("*/a/v1/sim/sessions/:id/world", () => HttpResponse.json({ tick: 0, state: world })),
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [] })),
    // ★ 本门的核心：施加口。语义镜像 datacore `simApplyAtCurrentTick`（作用于**当前 tick**，不推进时间）。
    http.post("*/a/v1/sim/sessions/:id/perturbations", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      perturbCalls.push({ url: request.url, body });
      const p = {
        id: "simpert_seam", tenantId: "demo", sessionId: "sims_pert",
        kind: body.kind, targetObjectId: body.targetObjectId, targetStateVar: body.targetStateVar,
        startTick: 0, durationTicks: (body.durationTicks ?? null) as number | null,
        magnitude: Number(body.magnitude), mode: (body.mode ?? "set") as "set" | "delta" | "scale",
        label: String(body.label), createdAt: "2026-08-10T00:00:00.000Z",
      } as unknown as Perturbation;
      // 施加走**契约唯一实现**（与后端同一支，桩不可能算出不同的数）。
      world = applyPerturbationToState(world, p);
      return HttpResponse.json({ perturbation: p, curTick: 0, state: world }, { status: 201 });
    }),
    // 认证 entitlement 在本门不参与：回 404 让面板走既有的诚实降级分支（不影响扰动断言）。
    http.get("*/a/v1/sim/sessions/:id/certification", () =>
      HttpResponse.json({ error: { code: "FEATURE_NOT_FOUND", message: "off", requestId: "r" } }, { status: 404 }),
    ),
  );
}

// 抽象占位类型/对象名（R14 零行业实体名）。`nodeObjectIds` 是**真物化对象 id** ——
// 扰动落点必须取自这里，取 nodeTypes（类型名）会写到一个引擎取不到的键上。
const CFG: SandboxViewConfig = {
  tenantId: "tenant-seam",
  nodeTypes: ["TypeA", "TypeB"],
  nodeObjectIds: { TypeA: ["obj_a1"], TypeB: ["obj_b1"] },
  linkTypes: ["FEEDS"],
  stateVars: ["load", "risk"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 1,
};

function mount(cfg: SandboxViewConfig = CFG) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={cfg} />
    </QueryClientProvider>,
  );
}

/** 屏上「全局态」那个数（= 用户真正看到的 KPI）。 */
const globalKpiText = () => screen.getByTestId("sandbox-kpi-global-val").textContent ?? "";

beforeEach(() => {
  perturbCalls.length = 0;
  // tick0 世界由 deriveBaseSnapshot 从 CFG 派生（真物化 id 作键）；这里只需保证 handler 有个起点。
  installSimHandlers({});
});
afterEach(() => cleanup());

describe("WO-SIM-ACT-CLOSE · 扰动入口接缝（真 endpoints + 真 URL + 真 body）", () => {
  it("① 点「施加扰动」→ 真发 POST …/perturbations，且**屏上 KPI 真的变了**（不是只调了个函数）", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-perturbation");

    const kpiBefore = globalKpiText();
    expect(kpiBefore.length, "KPI 读不到 ⇒ 后面的「变了」证明不了任何事").toBeGreaterThan(0);

    // 选一个真物化对象 + 状态变量，设一个足够大的 delta 让均值肉眼可见地变。
    await user.selectOptions(screen.getByTestId("sandbox-perturbation-object"), "obj_a1");
    await user.selectOptions(screen.getByTestId("sandbox-perturbation-statevar"), "load");
    await user.selectOptions(screen.getByTestId("sandbox-perturbation-mode"), "delta");
    const mag = screen.getByTestId("sandbox-perturbation-magnitude");
    await user.clear(mag);
    await user.type(mag, "40");

    await user.click(screen.getByTestId("sandbox-perturbation-apply-btn"));

    // ★ 断言 1：真的发出去了，打的是真实端点。
    await waitFor(() => expect(perturbCalls.length, "点了按钮但一个请求都没发 ⇒ 入口仍是死的（#150）").toBe(1));
    const call = perturbCalls[0]!;
    expect(call.url, `打错端点：${call.url}`).toContain("/a/v1/sim/sessions/sims_pert/perturbations");

    // ★ 断言 2：body 逐字段是用户选的那些（不是写死的默认值 —— 那样表单就是摆设）。
    expect(call.body).toMatchObject({ targetObjectId: "obj_a1", targetStateVar: "load", mode: "delta", magnitude: 40 });
    // 落点必须是**真物化对象 id**，不是类型名。写到类型名上 ⇒ 引擎 `state[sourceId]` 取不到 ⇒
    // 屏上看着变了、下游一动不动（静默错答）。
    expect(CFG.nodeObjectIds?.TypeA, "落点不在 view-config 的真物化 id 里 ⇒ 传导取不到源态")
      .toContain(call.body.targetObjectId);
    // 留空持续时间 = 永久（契约 durationTicks: null），不是 0 也不是 undefined 蒙混。
    expect(call.body.durationTicks, "持续时间留空必须显式传 null（= 永久），传 0 会被 zod 拒").toBeNull();

    // ★ 断言 3（效果层·本门头号判据）：**屏上的 KPI 真的变了**。
    await waitFor(() => expect(globalKpiText(), "KPI 没变 ⇒ 回包的世界态没落屏 = 闭环差最后一跳").not.toBe(kpiBefore));
    // 回执也在屏上（用户看得见"刚才那一下做了什么、把数从多少改到了多少"）。
    await screen.findByTestId("sandbox-perturbation-last");
    expect(screen.getByTestId("sandbox-perturbation-last-id").textContent).toContain("simpert_seam");
  });

  it("② 扰动作用在**当前 tick**、不推进时间（它不是 tick 的同义词）", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-perturbation");

    const tickLabelBefore = screen.getByTestId("sandbox-kpi-global").textContent ?? "";
    expect(tickLabelBefore).toContain("tick 0");

    await user.selectOptions(screen.getByTestId("sandbox-perturbation-object"), "obj_a1");
    await user.click(screen.getByTestId("sandbox-perturbation-apply-btn"));
    await waitFor(() => expect(perturbCalls.length).toBe(1));

    // 施加后仍停在 tick 0：扩散要等用户显式「推进 tick」（PRD：扰动是"事情发生了"，不是"时间过去了"）。
    await waitFor(() => expect(screen.getByTestId("sandbox-kpi-global").textContent ?? "").toContain("tick 0"));
  });

  it("③ 非法输入不发请求：幅度非数字 / 持续 tick < 1 —— 当面报错，不把脏值丢给后端", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-perturbation");

    const mag = screen.getByTestId("sandbox-perturbation-magnitude");
    await user.clear(mag);
    await user.type(mag, "abc");
    await user.click(screen.getByTestId("sandbox-perturbation-apply-btn"));
    expect(perturbCalls.length, "幅度是 abc 也照发 ⇒ 后端收到 NaN").toBe(0);

    await user.clear(mag);
    await user.type(mag, "5");
    const dur = screen.getByTestId("sandbox-perturbation-duration");
    await user.type(dur, "0");
    await user.click(screen.getByTestId("sandbox-perturbation-apply-btn"));
    expect(perturbCalls.length, "durationTicks=0 会被契约 zod 拒（min 1）——前端不该让它出门").toBe(0);
  });

  it("④ 诚实降级：本体无已物化对象 ⇒ 不给按钮，当面写明原因（不给一个点了没反应的钮）", async () => {
    mount({ ...CFG, nodeObjectIds: {} });
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-perturbation-unavailable");
    expect(screen.queryByTestId("sandbox-perturbation-apply-btn"), "无落点却仍给按钮 = 假入口").toBeNull();
  });

  it("⑤ 五种扰动类型逐条在下拉里（与契约 PerturbationKindSchema 对账，少一条即红）", async () => {
    mount();
    await screen.findByTestId("sandbox-view");
    const select = await screen.findByTestId("sandbox-perturbation-kind");
    const values = [...select.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value);
    expect(values.sort()).toEqual(
      ["capacity_loss", "cost_shock", "demand_shift", "quality_event", "supply_disruption"].sort(),
    );
  });
});
