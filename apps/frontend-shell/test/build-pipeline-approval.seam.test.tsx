import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { resetMockDb } from "@/mocks/db";
import { resetMockWorkflowRuns } from "@/mocks/handlers";

/**
 * WO-87 · databuilder pipeline「**配置面 × 放行面**」驱动接缝。
 *
 * ══ 这条测的是哪道接缝 ═══════════════════════════════════════════════════════
 * 不是「配置页能渲染」，也不是「PUT 存得进去」——那两半各自绿了三周，接缝仍是断的。
 * 咬的是整条：**在 `/admin/pipelines` 上给某个节点勾「人工放行」并存盘
 * ⇒ `/admin/data-builder` 上跑出来的建域运行真的停在 PAUSED
 * ⇒ 行上出现真放行入口 ⇒ 点它，运行真的收敛 SUCCEEDED。**
 * 任一半漏接（配置没生效 / 停了但屏上无人可放行 / 放行了不续跑）本文件即红。
 *
 * ══ 为什么这条以前不可能绿（收编前的真实缺口，逐层实测） ══════════════════════
 * ① **UI 层不缺**：`PipelineConfigPage.tsx:177 PausedRuns` 早挂了 `approve-{id}` 真入口。
 * ② **数据层缺**：它的数据源 `GET /a/v1/databuilder/workflow-runs` 里**永远没有 PAUSED** ——
 *    旧 mock `POST /workflow-runs`（`handlers.ts`）压根不读 pipeline，只在 FAILED/SUCCEEDED
 *    二选一。⇒ 铁律 0.5 第二形态「**接了线没数据**」：按钮在场，一次也渲染不出来。
 * ③ **UI 层还错接了一处**：`DataBuilderPage` 旧代码把 PAUSED 与 FAILED 并成一个「↻ 重入续跑」。
 *    对真后端那是**死按钮**：`resumeStoryWorkflow`（`datacore/databuilder/service.ts:625`）
 *    → `engine.resume` → `drive`，第一件事仍是 `requiresApproval && !isStepApproved`
 *    （`workflow-engine.ts:192`）⇒ 原地再停一次，只把 resumedCount 加 1。
 *    放行名单只有 `approveWorkflowStep`（`service.ts:640`）写得进去。
 *
 * ══ mock 侧凭什么算数（不是 UI 自导自演） ═════════════════════════════════════
 * `handlers.ts` 的 `driveMockStoryRun` 逐条对齐真后端语义并在注释里钉了 file:line：
 * 停用节点不进轨迹（`pipeline-defs.ts:154`）· 未放行的闸停 PAUSED 且保留现场
 * （`workflow-engine.ts:192-199`）· 放行名单键 `__approvedSteps`（`workflow-engine.ts:51`）·
 * approve = 记名单 + resume 续跑（`service.ts:640`）。**同一份 drive 被 POST 与 approve 共用**，
 * 与真后端 start/resume 共用一份 drive 同构 —— 不各抄一份策略，免得两套机制漂移。
 *
 * ⚠️ 适用范围只到 `story_build`。`intake` / `intake_import` 是**同步 HTTP 接入口**，
 * 真后端明写「无法在此暂停」（`intake-pipeline.ts:50-53` 直接判 FAILED），
 * 且 `BuildWorkflowRunSchema.kind` 是 `z.literal("story_build")`
 * （`packages/contracts/src/databuilder.ts:356`）—— intake 的暂停**在类型上就登记不成一条 run**。
 * 那一半的死锁由 `pipeline-config-seam.test.tsx` 的诚实位继续钉着，本文件不冒充闭合了它。
 */

/** 打开配置面并切到某个 kind（配置面默认停在 intake）。 */
async function openPipelineTab(kind: "story_build" | "intake" | "intake_import") {
  cleanup();
  loginAs("planner");
  renderApp("/admin/pipelines");
  await screen.findByTestId("pipeline-config");
  fireEvent.click(await screen.findByTestId(`pipeline-tab-${kind}`));
  return await screen.findByTestId("pipeline-editor");
}

/** 在配置面把某节点的「要人工放行」勾上并存盘（存完 kind 从「出厂默认」翻「已覆盖」）。 */
async function requireApprovalOn(nodeId: string) {
  const editor = await openPipelineTab("story_build");
  const row = within(editor).getByTestId(`pipeline-node-${nodeId}`);
  const box = within(row).getByTestId(`sop-approval-${nodeId}`) as HTMLInputElement;
  expect(box.checked).toBe(false); // 出厂态：没有任何节点要人批
  fireEvent.click(box);
  fireEvent.click(screen.getByTestId("pipeline-save"));
  await waitFor(() => expect(screen.getByTestId("pipeline-tab-story_build")).toHaveTextContent("已覆盖"));
}

/** 到数据构建发动机页同步跑一次工作流，返回时间线面板。 */
async function runWorkflowOnce() {
  const panel = await screen.findByTestId("wf-timeline");
  fireEvent.click(within(panel).getByTestId("wf-start"));
  return panel;
}

describe("WO-87 · pipeline 配置面 × PAUSED 放行面 驱动接缝", () => {
  // 现场清理：pipeline 覆盖（db）与运行台账（模块级数组）都要还原，否则用例之间顺序耦合。
  afterEach(() => { resetMockDb(); resetMockWorkflowRuns(); });

  it("头号判据：配置面勾 publish_build「人工放行」⇒ 建域运行真停 PAUSED、行上有真放行入口 ⇒ 放行后真收敛", async () => {
    // ── 配置这一半 ──
    await requireApprovalOn("publish_build");

    // ── 生效那一半：同一个建域执行口，行为跟着配置变 ──
    cleanup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const panel = await runWorkflowOnce();

    // 第一条 mock 运行故意断在 cross_scaffold（闸 publish_build 在它**之后**）——
    // 失败先发生 ⇒ 仍是 FAILED，闸不该把失败掩盖成 PAUSED。这一条同时钉住「闸不吞失败」。
    expect(await within(panel).findByText("FAILED")).toBeTruthy();
    expect(within(panel).getByText(/断在 cross_scaffold/)).toBeTruthy();

    // 第二条：闸前三步跑完 → 停在 publish_build 之前。
    fireEvent.click(within(panel).getByTestId("wf-start"));
    const approveBtn = (await within(panel).findByTestId(/^wf-approve-/)) as HTMLButtonElement;
    const runId = approveBtn.getAttribute("data-testid")!.replace("wf-approve-", "");
    expect(approveBtn.textContent).toContain("publish_build");
    expect(within(panel).getByTestId(`wf-status-${runId}`).textContent).toBe("PAUSED");

    // 现场保留：闸前的步已跑完，不是整条 run 从头重来。
    expect(within(panel).getByTestId(`wf-run-${runId}`).textContent).toContain("3/7 步完成");

    // resume 不是 approve 的替代品：PAUSED 的行上**不给**「重入续跑」（给了就是死按钮）。
    expect(within(panel).queryByTestId(`wf-resume-${runId}`)).toBeNull();

    // ── 放行 ⇒ 真续跑到终态，放行入口消失 ──
    fireEvent.click(approveBtn);
    await waitFor(() => expect(within(panel).getByTestId(`wf-status-${runId}`).textContent).toBe("SUCCEEDED"));
    expect(within(panel).queryByTestId(`wf-approve-${runId}`)).toBeNull();
  });

  it("同一条 PAUSED 运行在配置面的放行面板里也在场且可放行（PausedRuns 不再是恒空的摆设）", async () => {
    await requireApprovalOn("publish_build");

    cleanup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const panel = await runWorkflowOnce();
    await within(panel).findByText("FAILED"); // 第一条：演示断点
    fireEvent.click(within(panel).getByTestId("wf-start"));
    const runId = (await within(panel).findByTestId(/^wf-approve-/)).getAttribute("data-testid")!.replace("wf-approve-", "");

    // 回配置面：PAUSED 的运行必须出现在放行面板里（这正是此前「接了线没数据」那一处）。
    cleanup();
    loginAs("planner");
    renderApp("/admin/pipelines");
    await screen.findByTestId("pipeline-config");
    const paused = await screen.findByTestId("paused-runs");
    expect(within(paused).queryByTestId("paused-empty")).toBeNull();
    const row = await within(paused).findByTestId(`paused-run-${runId}`);
    expect(row.textContent).toContain("publish_build");

    fireEvent.click(within(paused).getByTestId(`approve-${runId}`));
    await waitFor(() => expect(screen.queryByTestId(`paused-run-${runId}`)).toBeNull());
  });

  it("停用节点也真的不执行：关掉 inference ⇒ 该步整个不出现在运行轨迹里（不是灰着摆那）", async () => {
    const editor = await openPipelineTab("story_build");
    const row = within(editor).getByTestId("pipeline-node-inference");
    fireEvent.click(within(row).getByTestId("node-enabled-inference"));
    fireEvent.click(screen.getByTestId("pipeline-save"));
    await waitFor(() => expect(screen.getByTestId("pipeline-tab-story_build")).toHaveTextContent("已覆盖"));

    cleanup();
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const panel = await runWorkflowOnce();
    await within(panel).findByText("FAILED");
    fireEvent.click(within(panel).getByTestId("wf-start"));

    await waitFor(() => expect(within(panel).queryAllByText("SUCCEEDED").length).toBeGreaterThan(0));
    // 运行展开后逐步可见；被停用的那步一条都不该在（真后端 resolvePipelineSteps 也是整步不入列）。
    expect(within(panel).queryByTestId("wf-step-inference")).toBeNull();
    expect(within(panel).getByTestId("wf-step-publish_build")).toBeTruthy();
  });

  it("出厂默认不受影响：没配任何放行节点 ⇒ 运行照旧收敛，屏上一个放行入口都不出现", async () => {
    loginAs("planner");
    renderApp("/admin/data-builder");
    await screen.findByTestId("data-builder-page");
    const panel = await runWorkflowOnce();
    await within(panel).findByText("FAILED");
    fireEvent.click(within(panel).getByTestId("wf-start"));

    await waitFor(() => expect(within(panel).queryAllByText("SUCCEEDED").length).toBeGreaterThan(0));
    expect(within(panel).queryAllByTestId(/^wf-approve-/)).toHaveLength(0);
    expect(within(panel).queryByText("PAUSED")).toBeNull();
  });
});
