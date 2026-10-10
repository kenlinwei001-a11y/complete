import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { SandboxViewConfig } from "@platform/contracts";
import { server } from "./setup";
import SandboxView from "@/views/sim/SandboxView";

/**
 * WO-SIM-SCOPE-LOCAL · 接缝驱动门（SEAM-GATE）：**局部范围必须真的到达后端**。
 *
 * ── 为什么这条测试不 mock `@/api/endpoints` ────────────────────────────────────
 * 病灶恰好**长在 endpoints 这一跳里**：
 *
 *   SandboxView 只传 2 个实参 `fetchSimCertification(sid, scope)`
 *     → `endpoints.ts:558` 的 URL 模板 `${target ? `&target=${...}` : ""}` 遇 undefined **整段不拼**
 *       → datacore `app.ts:1589` `scopeKind === "LOCAL" && target` 恒 false ⇒ `types = allTypes`（全本体）
 *         → datacore `app.ts:1640` 仍照 `scopeKind` 回 `scope:"LOCAL"`
 *
 * 净效果：用户点「局部」、屏上写「局部」、**算的是全局**。同族 R-ARG-FIDELITY / G-ARG-DROP-SEAM
 * ——危害不在崩溃，在于没人知道它算的不是你问的那个范围（静默错答比崩溃更危险）。
 *
 * 把 `@/api/endpoints` 整个 vi.mock 掉（既有 sandbox 测试的做法）**会把病灶那一跳一起 mock 掉**：
 * 桩函数照收 3 个实参，URL 模板根本不参与，于是断言恒绿而缺陷仍在。所以本文件走**真 endpoints**，
 * 在 MSW 层拦下**真实 URL** 断言 —— 咬的是链路，不是函数。
 *
 * MSW 桩的 `targetRef` 语义与后端 `app.ts:1640` **一字对齐**（`scope==="LOCAL" ? target : null`），
 * 这样"没带 target 的 LOCAL"在桩上也会复现出「自称 LOCAL、targetRef 为空」那个病样。
 */

// ── 捕获真实请求 URL（这就是本门的证物）───────────────────────────────────────
const certUrls: string[] = [];

/** 沙盘会话/认证/tick 的最小真后端镜像（语义抄 datacore app.ts，非随手编）。 */
function installSimHandlers() {
  server.use(
    http.post("*/a/v1/sim/sessions", async ({ request }) => {
      const body = (await request.json()) as { baseSnapshot?: Record<string, unknown>; scope?: Record<string, unknown> };
      return HttpResponse.json(
        {
          id: "sims_seam", tenantId: "demo", baseSnapshot: body.baseSnapshot ?? {}, scope: body.scope ?? {},
          status: "READY", curTick: 0, parentCheckpointId: null, createdAt: "2026-08-08T00:00:00.000Z",
        },
        { status: 201 },
      );
    }),
    http.get("*/a/v1/sim/sessions/:id/certification", ({ request }) => {
      certUrls.push(request.url);
      const url = new URL(request.url);
      const scope = url.searchParams.get("scope") === "LOCAL" ? "LOCAL" : "GLOBAL";
      const target = url.searchParams.get("target");
      return HttpResponse.json({
        scope,
        // ← 与 datacore app.ts:1640 同语义：LOCAL 但 target 缺失 ⇒ targetRef 为 null（病样可复现）
        targetRef: scope === "LOCAL" ? target : null,
        level: "L2_RUNNABLE",
        dims: { structure: 70, knowledge: 50, behavior: 35, composite: 52 },
        l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
        trialTick: { passed: false, derivationNodes: 1, propagationCovered: false, at: null, error: null },
        worldCompleteness: {
          pct: scope === "LOCAL" ? 48 : 60,
          derivationRules: { present: 1, needed: 2 },
          actions: { present: 0, needed: 1 }, propagationRules: { present: 1, needed: 1 },
          stateVarKeys: [],
          entering: [{ key: "s1", kind: "DERIVATION", source: "deriv:s1" }],
        },
        canEnterSimulation: false,
        gaps: [{ gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" }],
        computedAt: "2026-08-08T00:00:00.000Z",
      });
    }),
  );
}

// 控制台内嵌两个链路求解器；它们走仓库既有的 MSW 求解器 handler（handlers.ts `*/a/v1/solvers/:key/invoke`），
// 本门不覆盖 —— 范围接缝与链路求解器无关，让它们照常跑即可（诚实空态不影响断言）。

const CFG: SandboxViewConfig = {
  tenantId: "tenant-seam",
  // 抽象占位类型名：本门要证的是"target 真的随行"，与行业无关（R14 零行业实体名）。
  nodeTypes: ["TypeA", "TypeB", "TypeC"],
  linkTypes: ["linkAB"],
  stateVars: ["s1", "s2"],
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

/** 最后一次认证请求的 URL（= 屏上那份数字真正问的是哪个范围）。 */
const lastCertUrl = () => certUrls[certUrls.length - 1] ?? "";

/**
 * WO-SANDBOX-DECLUTTER · 就绪认证（含范围切换器与范围对账）已收进**默认折叠的诊断抽屉**：
 * 主屏只留决策者那一档，建模者那一档按需展开。折叠时抽屉内部**不渲染**，故本门的 UI 交互
 * 都要先点开它。**接缝本身一行没变** —— 会话建立时那一发 GLOBAL 认证请求仍在挂载即发出
 * （下面第一条断言就咬这个），抽屉只影响"人怎么点到范围切换器"，不影响"参数怎么随行"。
 */
async function openDiagnostics(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("sc-diag-toggle"));
  await screen.findByTestId("sc-diag-panel");
}

beforeEach(() => {
  certUrls.length = 0;
  installSimHandlers();
});
afterEach(() => cleanup());

describe("WO-SIM-SCOPE-LOCAL · ① 局部范围接缝（真 endpoints + 真 URL）", () => {
  it("切到 LOCAL：请求 URL **真带 &target=**，且回包 targetRef 非空（修前此处恒缺 target ⇒ 后端算全局）", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");

    // 会话建立后先出一发 GLOBAL 认证。
    await waitFor(() => expect(certUrls.length).toBeGreaterThan(0));
    expect(lastCertUrl()).toContain("scope=GLOBAL");
    // GLOBAL 档不该带 target（带了就是另一种撒谎：全局却声称按某类型裁过）。
    expect(lastCertUrl()).not.toContain("target=");

    // 切到「局部」（范围切换器住在诊断抽屉里 —— 先开抽屉）。
    await openDiagnostics(user);
    await screen.findByTestId("sim-cert-scope-LOCAL");
    await user.click(screen.getByTestId("sim-cert-scope-LOCAL"));

    // ★ 本门的核心断言：URL 必须同时带 scope=LOCAL **和** target=<某 nodeType>。
    await waitFor(() => expect(lastCertUrl()).toContain("scope=LOCAL"));
    expect(
      lastCertUrl(),
      `LOCAL 档的请求 URL 必须带 &target=；实际=${lastCertUrl()}\n` +
        "缺 target ⇒ datacore app.ts:1589 的 `scopeKind===\"LOCAL\" && target` 恒 false ⇒ 算全本体，" +
        "而 app.ts:1640 仍回 scope:\"LOCAL\" ⇒ 屏上说局部、数字是全局（静默错答）",
    ).toContain("target=TypeA");

    // 效果层：屏上真的显示出被裁的那个对象类型（targetRef 非空 = 后端确实按它裁了子图）。
    await waitFor(() => expect(screen.getByTestId("sim-cert-target").textContent ?? "").toContain("TypeA"));
    // 且完整度确实换成了 LOCAL 那一份（48 而非 60）——数字随范围变，不是换个标签而已。
    await waitFor(() => expect(screen.getByTestId("sim-cert-gauge-pct").textContent ?? "").toContain("48"));
  });

  it("换目标对象类型：URL 里的 target 跟着换（选择器不是摆设）", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await openDiagnostics(user);
    await screen.findByTestId("sim-cert-scope-LOCAL");
    await user.click(screen.getByTestId("sim-cert-scope-LOCAL"));
    await waitFor(() => expect(lastCertUrl()).toContain("target=TypeA"));

    await user.selectOptions(screen.getByTestId("sandbox-cert-target-select"), "TypeC");
    await waitFor(() => expect(lastCertUrl()).toContain("target=TypeC"));
    expect(lastCertUrl()).toContain("scope=LOCAL");
    await waitFor(() => expect(screen.getByTestId("sim-cert-target").textContent ?? "").toContain("TypeC"));
  });

  it("本体无对象类型（LOCAL 无 target 可带）：**绝不**产生一个自称 LOCAL 的结果，且屏上写明为何不提供", async () => {
    const user = userEvent.setup();
    mount({ ...CFG, nodeTypes: [] });
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(certUrls.length).toBeGreaterThan(0));

    // 诚实降级位在屏上（不是静默禁用）—— 在诊断抽屉里，展开即可见。
    await openDiagnostics(user);
    expect(screen.getByTestId("sandbox-cert-local-unavailable").textContent ?? "").toContain("局部范围不提供");
    expect(screen.queryByTestId("sandbox-cert-target-select")).toBeNull();

    // 就算用户点了「局部」——不许发出一发无 target 的 LOCAL 请求。
    await screen.findByTestId("sim-cert-scope-LOCAL");
    await user.click(screen.getByTestId("sim-cert-scope-LOCAL"));

    await waitFor(() => expect(screen.getByTestId("sim-cert-scope-GLOBAL").getAttribute("data-active")).toBe("1"));
    // ★ 全过程零条 LOCAL 请求：没有 target 的 LOCAL 在后端就是 GLOBAL，宁可不提供也不冒充。
    expect(
      certUrls.filter((u) => u.includes("scope=LOCAL")),
      "无 target 时不允许发出 scope=LOCAL 的认证请求（后端会算全局却回 scope:LOCAL ⇒ 静默错答）",
    ).toHaveLength(0);
    // 屏上档位仍是「全局」——绝不出现「档位写着 LOCAL、数字却是 GLOBAL」那一格。
    expect(screen.getByTestId("sim-cert-scope-LOCAL").getAttribute("data-active")).toBe("0");
  });
});

describe("WO-SIM-SCOPE-LOCAL · ② 会话范围（去掉 `scope:{}` 空范围会话）", () => {
  it("建会话时把**选中的范围**真写进 SimSession.scope（不再是空对象），屏上可对账", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post("*/a/v1/sim/sessions", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body.scope);
        return HttpResponse.json(
          { id: "sims_seam", tenantId: "demo", baseSnapshot: {}, scope: body.scope ?? {}, status: "READY", curTick: 0, parentCheckpointId: null, createdAt: "x" },
          { status: 201 },
        );
      }),
    );
    mount();
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    // 修前恒为 `{}`（空范围）：向导里选的范围被丢弃，用户跑的是另一个会话。
    expect(bodies[0]).toEqual({ kind: "GLOBAL", target: null });
    await openDiagnostics(user);
    await waitFor(() =>
      expect(screen.getByTestId("sandbox-session-scope-of-record").textContent ?? "").toContain("GLOBAL"),
    );
  });

  /**
   * 诚实位 —— **本条断言自己被改过一次方向，原样记在这儿**（合并单 WO-SIM-TRIAL-SCOPE-RECONCILE 发现）。
   *
   * 原断言是 `toContain("尚未裁剪推演本身")`。`G-SIM-SCOPE-UNREAD` 开着时它是对的；
   * `WO-SIM-SCOPE-TRIAL` 把断点闭掉（引擎真按范围裁剪）之后，实现改了、UI 文案没跟，
   * 而**这条断言把那句已经反过来的话原地锁住，且一直是绿的**。
   * 形态：「我用『文案没变』当作『屏上说的是真的』的证据，而前者并不度量后者」——
   * 这正是本仓「绿测试≠能用」的又一个形态：测试咬的是**字符串**，不是**它与实现是否一致**。
   *
   * 所以现在不只咬文案，**同时咬反向**：那句已作废的旧话**不许再出现**。
   * 下一次若有人把引擎的范围裁剪改回全量、又顺手把老文案贴回来，这条会红。
   *
   * ⚠ 并线单 WO-SANDBOX-UI-INTEGRATE：`sandbox-scope-reach-note` 已被 WO-SANDBOX-DECLUTTER
   * 从主屏第一层降进**诊断抽屉**，故本条必须先 `openDiagnostics(user)` 才拿得到该节点
   * —— `user` 由此而来（declutter 侧的新增），断言方向仍取 canonical 的**已修正**版本。
   */
  it("诚实位：范围**已**作用于推演本身，且作废的旧文案不许复活（G-SIM-SCOPE-UNREAD 已闭）", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("sandbox-view");
    await openDiagnostics(user);
    const note = (await screen.findByTestId("sandbox-scope-reach-note")).textContent ?? "";
    // 正向：屏上说的是今天的真相。
    expect(note).toContain("已作用于推演本身");
    // 诚实缺席那一档也必须写在屏上（拿不到根 ⇒ 空图报缺，不退回 GLOBAL）。
    expect(note).toContain("裁成空图并报缺");
    // 反向：作废的旧话不许再出现 —— 它曾经真的在屏上挂了一整个增量。
    expect(note, "旧文案复活 = 屏上又开始说引擎不裁剪范围（与 buildPropagationInputs 的实现相反）")
      .not.toContain("尚未裁剪推演本身");

    // WO-UI-BURNDOWN-21（2026-08-14）· 中间那句「到底裁了什么」按规范 §1 降进了 `?` 浮层，
    // 两个**结论**（上面两条断言）仍在第一层。降层不是删除 ⇒ 必须能把原文原样取回来。
    expect(note, "口径还摆在第一层 ⇒ 降层没做").not.toContain("邻域子图传导");
    expect(screen.queryByTestId("info-body-sandbox-scope-reach"), "浮层正文默认就在 DOM ⇒ 没起到收纳作用").toBeNull();
    await user.hover(await screen.findByTestId("info-wrap-sandbox-scope-reach"));
    const reach = await screen.findByTestId("info-body-sandbox-scope-reach");
    expect(reach.textContent, "口径被降没了 —— 那是删除不是分层").toContain("只按该对象类型的邻域子图传导");
    expect(reach.textContent).toContain("就绪认证的试算也跑在同一范围里");
  });

  it("选中范围与会话范围漂移 → 显式提示 + 「按当前范围重建会话」按钮（不静默、不自动重建）", async () => {
    const user = userEvent.setup();
    const scopes: unknown[] = [];
    server.use(
      http.post("*/a/v1/sim/sessions", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        scopes.push(body.scope);
        return HttpResponse.json(
          { id: `sims_${scopes.length}`, tenantId: "demo", baseSnapshot: {}, scope: body.scope ?? {}, status: "READY", curTick: 0, parentCheckpointId: null, createdAt: "x" },
          { status: 201 },
        );
      }),
    );
    mount();
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(scopes).toHaveLength(1));

    await openDiagnostics(user);
    await screen.findByTestId("sim-cert-scope-LOCAL");
    await user.click(screen.getByTestId("sim-cert-scope-LOCAL"));

    // 切了认证范围，但会话还是 GLOBAL 那个 —— 必须让用户看见，而不是假装已生效。
    const drift = await screen.findByTestId("sandbox-scope-drift");
    expect(drift.textContent ?? "").toContain("LOCAL");
    expect(scopes, "切认证范围不得偷偷重建会话").toHaveLength(1);

    await user.click(screen.getByTestId("sandbox-scope-rebuild-btn"));
    await waitFor(() => expect(scopes).toHaveLength(2));
    expect(scopes[1]).toEqual({ kind: "LOCAL", target: "TypeA" });
  });
});
