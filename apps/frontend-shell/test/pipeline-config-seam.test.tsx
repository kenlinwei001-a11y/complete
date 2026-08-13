import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { resetMockDb } from "@/mocks/db";
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
  afterEach(() => resetMockDb());

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
