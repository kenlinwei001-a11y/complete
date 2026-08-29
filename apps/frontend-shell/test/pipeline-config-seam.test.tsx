import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { resetMockDb } from "@/mocks/db";
import { resetMockWorkflowRuns } from "@/mocks/handlers";
import { submitIntake } from "@/api/endpoints";

/**
 * WO-FE-WIRE-2 件一 · **接缝驱动**测试（验收第 2 条）。
 *
 * 单子写死的判据：⛔「界面能渲染」不算，⛔「CRUD 能存能取」也不算 —— 那都只测了一半。
 * 必须是：**在界面上改 pipeline ⇒ `/a/v1/databuilder/intake` 的实际处理行为跟着变**。
 *
 * 故本测每一条都走同一条链：真渲染配置页 → 真点界面控件 → 真存 → **再打 intake 端点看产物变没变**。
 * 只断言"存进去了"的写法在这里一律不算数。
 */
describe("WO-FE-WIRE-2 · pipeline 配置面接缝（改配置 ⇒ intake 处理行为真变）", () => {
  // WO-87：运行台账也清。下面那条诚实位断言的是「**intake 的暂停**没登记成 run」——
  // 台账里若混进别处留下的 story_build PAUSED，它会为了**错误的理由**变红，诚实位就失去意义。
  afterEach(() => { resetMockDb(); resetMockWorkflowRuns(); });

  it("基线：出厂默认（四节点全开）⇒ intake 产出解析 + 对账两段，且四步都跑了", async () => {
    const before = (await submitIntake("<html/>")) as unknown as {
      intake?: unknown; reconcile?: unknown; ranSteps: string[]; status: string; pipeline: { factory: boolean };
    };
    expect(before.status).toBe("SUCCEEDED");
    expect(before.pipeline.factory).toBe(true); // 未覆盖 = 出厂默认
    expect(before.intake).toBeDefined();
    expect(before.reconcile).toBeDefined();
    expect(before.ranSteps).toEqual(["intake_parse", "intake_reconcile", "intake_persist_candidates", "intake_emit"]);
  });

  it("头号判据：界面上关掉「字段对账」节点并保存 ⇒ intake 响应里 reconcile 段**真的消失**（不是只存进去了）", async () => {
    loginAs("planner");
    renderApp("/admin/pipelines");
    await screen.findByTestId("pipeline-config");

    // 默认就在 intake 这一 kind；等节点行渲染出来。
    const row = await screen.findByTestId("pipeline-node-intake_reconcile");
    const toggle = within(row).getByTestId("node-enabled-intake_reconcile") as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle); // 关掉「字段对账」
    fireEvent.click(screen.getByTestId("pipeline-save"));

    // 存完 → 该 kind 从「出厂默认」变「已覆盖」（配置面真落库）
    await waitFor(() => expect(screen.getByTestId("pipeline-tab-intake")).toHaveTextContent("已覆盖"));

    // ★ 接缝：再打 intake，**处理行为**必须跟着变——reconcile 段不再产出，且该步不在 ranSteps 里。
    const after = (await submitIntake("<html/>")) as unknown as {
      intake?: unknown; reconcile?: unknown; ranSteps: string[]; pipeline: { factory: boolean };
    };
    expect(after.pipeline.factory).toBe(false);
    expect(after.intake).toBeDefined(); // 解析仍在
    expect(after.reconcile).toBeUndefined(); // ← 关掉的那一段真没了
    expect(after.ranSteps).not.toContain("intake_reconcile");
    expect(after.ranSteps).toContain("intake_parse");
  });

  it("SOP「要人工放行」勾上并保存 ⇒ intake 真的停在 PAUSED 等放行（而不是照跑完）", async () => {
    loginAs("planner");
    renderApp("/admin/pipelines");
    await screen.findByTestId("pipeline-config");

    const row = await screen.findByTestId("pipeline-node-intake_persist_candidates");
    fireEvent.click(within(row).getByTestId("sop-approval-intake_persist_candidates"));
    fireEvent.click(screen.getByTestId("pipeline-save"));
    await waitFor(() => expect(screen.getByTestId("pipeline-tab-intake")).toHaveTextContent("已覆盖"));

    const after = (await submitIntake("<html/>")) as unknown as {
      status: string; pausedAt?: string; ranSteps: string[]; reconcile?: unknown;
    };
    expect(after.status).toBe("PAUSED"); // 人不放行就停在这
    expect(after.pausedAt).toBe("intake_persist_candidates");
    expect(after.ranSteps).toEqual(["intake_parse", "intake_reconcile"]); // 停点之前的跑了
    expect(after.reconcile).toBeDefined();
  });

  /**
   * WO-R4 件二 · 上面那条只咬到**后端停住了**，没咬「屏上有没有人放得了行」——
   * 停住而没人能放行 = 死锁，比照跑完更糟。本条把那半截补上。
   *
   * ⚠️ 补的时候实测出来的**不是覆盖缺口，是真死锁**（派单人写的「canonical 有真放行入口所以不是
   * 死锁」与实测不符，见下）。三层各自的真相，全部亲手跑出来、不是读代码猜的：
   *
   * ① **UI 层**：`PipelineConfigPage.tsx:177 PausedRuns` 确实挂了真入口
   *    （`data-testid={`approve-${r.id}`}`，:204）——所以**不是「没接线」**。
   * ② **mock 数据层**：该入口的数据源是 `fetchWorkflowRuns` → `handlers.ts` 的 `MOCK_WORKFLOW_RUNS`，
   *    而这个数组只被 `POST /a/v1/databuilder/workflow-runs` 填。
   *    `POST /a/v1/databuilder/intake` 停在 PAUSED 时**只回了一个响应体**，一条 run 都没注册
   *    ⇒ 对 intake 而言 `PausedRuns` 只会渲染 `paused-empty`。铁律 0.5 第二形态「**接了线没数据**」。
   * ③ **契约层（这才是真正卡住的地方）**：`BuildWorkflowRunSchema.kind` 是
   *    `z.literal("story_build")`（`packages/contracts/src/databuilder.ts:356`）——
   *    intake 的暂停**在类型上就没法登记成一条 run**。所以这不是补个 mock 就能了的，
   *    要动契约，属产品/架构裁决，超出本单文件边界（🚦本单只碰 tsconfig + 本测试文件）。
   *
   * ⚠️ **2026-08-13 WO-87 订正：本段原先还写了一句「真后端根本没有 PAUSE 这一态」——那句是错的，
   * 现予删除**（同一撤回见 `docs/WO-FOLLOWUP-2026-08-13.md` §5；WO-87 收编时逐层复验确认）。
   * 真后端**有** PAUSE，而且是生产接线的整条：
   *   `datacore/databuilder/workflow-engine.ts:192-199`（`requiresApproval && !isStepApproved`
   *   ⇒ `run.status = "PAUSED"` + 发 `buildworkflow.run_paused`）
   *   ← SOP 来自 `pipeline-defs.ts:164 resolvePipelineSteps`
   *   ← `service.ts:578 buildStorySteps` ← `POST /a/v1/databuilder/workflow-runs`（`app.ts:4416`）；
   *   放行 `app.ts:4540` → `service.ts:640 approveWorkflowStep`（记放行名单 + resume）。
   * 错的形态（照铁律 0.6 的句式）：**「我用『intake-pipeline.ts 里没有 PAUSED』当作
   * 『真后端没有暂停能力』的证据，而前者并不度量后者。」** 只 grep 了一个文件就下了全后端的结论。
   *
   * **准确的说法**：暂停能力按**执行口**分裂，不是按有无分裂 ——
   *   · `story_build`（持久化工作流口）：**真能暂停、真能放行**。该条链路的接缝由
   *     `test/build-pipeline-approval.seam.test.tsx`（WO-87）端到端咬住，死锁已闭合。
   *   · `intake` / `intake_import`（**同步 HTTP 接入口**）：`intake-pipeline.ts:50-53` 明写
   *     「同步接入口无法在此暂停」，遇 `requiresApproval` 判 FAILED。这是**诚实的能力边界声明**，
   *     不是缺陷；而上面那条 it 断言的 `status:"PAUSED"` 仍是 **mock 独有行为**（真后端此处报错）。
   *
   * 故本条诚实位的**适用范围只到 intake 这一口**：钉住「intake 停住了但屏上无人可放行」，
   * 卡点在契约层（③）。谁把③闭上它就当场红，逼人回来改这段注释和断言。
   * ⛔ 不许把它改成 `skip` 或删掉了事——那是把已知死锁重新变回不可见。
   */
  it("放行入口的诚实位：intake 停在 PAUSED，但屏上没有任何人放得了行（已知死锁·闭合即红）", async () => {
    loginAs("planner");
    renderApp("/admin/pipelines");
    await screen.findByTestId("pipeline-config");

    const row = await screen.findByTestId("pipeline-node-intake_persist_candidates");
    fireEvent.click(within(row).getByTestId("sop-approval-intake_persist_candidates"));
    fireEvent.click(screen.getByTestId("pipeline-save"));
    await waitFor(() => expect(screen.getByTestId("pipeline-tab-intake")).toHaveTextContent("已覆盖"));

    const after = (await submitIntake("<html/>")) as unknown as { status: string; pausedAt?: string };
    expect(after.status).toBe("PAUSED"); // 前置：确实停住了（否则下面在测空气）
    expect(after.pausedAt).toBe("intake_persist_candidates");

    // ① 放行面板**在场** —— 证明是「接了线没数据」，不是「没接线」。这两者修法完全不同。
    const panel = await screen.findByTestId("paused-runs");

    // ② 但那条 PAUSED 的 intake 运行**没进这个面板**：面板空着，一个放行按钮都没有。
    //    ⇒ 停住的这条链路，屏上无人可放行 = 死锁。
    expect(within(panel).queryByTestId("paused-empty")).not.toBeNull();
    expect(screen.queryAllByTestId(/^approve-/)).toHaveLength(0);

    // ③ 缺口闭合时（intake 暂停真登记成一条 run）②必然变红，本注释与断言必须一起改成：
    //      const btn = await screen.findByTestId(`approve-${runId}`);
    //      fireEvent.click(btn);
    //      await waitFor(() => expect(screen.queryByTestId(`paused-run-${runId}`)).toBeNull());
  });

  it("撤销覆盖 ⇒ 行为回出厂默认（改回去也要真回去，不留半永久残留）", async () => {
    loginAs("planner");
    renderApp("/admin/pipelines");
    await screen.findByTestId("pipeline-config");

    const row = await screen.findByTestId("pipeline-node-intake_emit");
    fireEvent.click(within(row).getByTestId("node-enabled-intake_emit"));
    fireEvent.click(screen.getByTestId("pipeline-save"));
    await waitFor(() => expect(screen.getByTestId("pipeline-tab-intake")).toHaveTextContent("已覆盖"));

    const disabled = (await submitIntake("<html/>")) as unknown as { emitted?: string };
    expect(disabled.emitted).toBeUndefined(); // 发事件那步被关掉了

    fireEvent.click(screen.getByTestId("pipeline-reset"));
    await waitFor(() => expect(screen.getByTestId("pipeline-tab-intake")).toHaveTextContent("出厂默认"));

    const restored = (await submitIntake("<html/>")) as unknown as { emitted?: string; ranSteps: string[] };
    expect(restored.emitted).toBe("prototype.intake_recorded");
    expect(restored.ranSteps).toHaveLength(4);
  });
});
