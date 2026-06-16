import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { decideActionDraft, fetchSopVersion } from "@/api/endpoints";
import { queryClient } from "@/store/queryClient";
import { db } from "@/mocks/db";
import zh from "@/locales/zh";

/**
 * F17（增量 §7.12 / 验收表）：②商用车偏差行 C21 chip → 点击跳⑤且议程项高亮；
 * ④现金不达时⑤chip 禁用+tooltip；定稿走 Action（定稿月度计划版本 → 版本待审批
 * → 审批 EXECUTED → FINAL）→ 全页锁定态 + 横幅。
 */
describe("F17 · S&OP 月度平衡台（sop-balance）", () => {
  it("五步法：②C21 chip 跳⑤高亮；④现金不达→⑤chip 禁用+tooltip；定稿走 Action → 待审批 → 批准后 FINAL 锁定", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/sop-balance");

    // 新建 2026-07 草稿 → 六卡 KPI 条（每卡含溯源浮层）+ 版本徽章 V1 评审中
    await user.click(await screen.findByTestId("sop-create"));
    await waitFor(() => expect(screen.getByTestId("sop-detail-status")).toHaveTextContent("DRAFT"));
    expect(screen.getByTestId("sop-kpi-bar")).toBeInTheDocument();
    // 缺口卡走共享六要素溯源（悬浮即弹：推导公式 + 关联规则两跳）
    await user.hover(screen.getByTestId("prov-v-sopkpi-gap"));
    const gapTip = await screen.findByTestId("prov-tip");
    expect(gapTip).toHaveTextContent("缺口 = 需求P50 − 可供给");
    await user.unhover(screen.getByTestId("prov-v-sopkpi-gap"));
    expect(screen.getByTestId("sop-version-badge")).toHaveTextContent("V1 评审中");

    // ① 产品评审 → IN_REVIEW
    await user.click(screen.getByTestId("sop-run-1"));
    await screen.findByTestId("sop-s1-table");
    await waitFor(() => expect(screen.getByTestId("sop-detail-status")).toHaveTextContent("IN_REVIEW"));

    // ② 需求评审：商用车 −11.8%（>±10%）→ 行尾 C21 chip
    await user.click(screen.getByTestId("sop-step-chip-2"));
    await user.click(await screen.findByTestId("sop-run-2"));
    const dvCom = await screen.findByTestId("sop-dv-com");
    expect(dvCom).toHaveTextContent("-11.8%");
    const c21 = screen.getByTestId("sop-c21-chip-com");
    expect(c21).toHaveTextContent("C21 差异提报");

    // chip 点击 → 跳⑤且对应议程项高亮
    await user.click(c21);
    await screen.findByTestId("sop-step5");
    const agenda0 = screen.getByTestId("sop-agenda-0");
    expect(agenda0).toHaveAttribute("data-highlight", "1");
    expect(agenda0).toHaveTextContent("商用车");

    // ③ 供应评审：缺口 2.5 > 2 红标
    await user.click(screen.getByTestId("sop-step-chip-3"));
    await user.click(await screen.findByTestId("sop-run-3"));
    expect(await screen.findByTestId("sop-gap")).toHaveTextContent("2.5");

    // ④ 现金垫 40 < 50 → 不通过 → ⑤入口 chip 禁用 + 原因 tooltip
    await user.click(screen.getByTestId("sop-step-chip-4"));
    fireEvent.change(await screen.findByLabelText("现金垫(13周最低点)"), { target: { value: "40" } });
    await user.click(screen.getByTestId("sop-run-4"));
    await waitFor(() => expect(screen.getByTestId("sop-s4-pass")).toHaveTextContent("④ 财务整合未通过"));
    const chip5 = screen.getByTestId("sop-step-chip-5");
    expect(chip5).toBeDisabled();
    expect(chip5).toHaveAttribute("title", zh.sim.sop.step5Blocked);

    // 修正现金垫 → ④通过 → ⑤执行（决议 → EXEC_MEETING）
    fireEvent.change(screen.getByLabelText("现金垫(13周最低点)"), { target: { value: "58" } });
    await user.click(screen.getByTestId("sop-run-4"));
    await waitFor(() => expect(screen.getByTestId("sop-step-chip-5")).toBeEnabled());
    await user.click(screen.getByTestId("sop-step-chip-5"));
    await user.click(await screen.findByTestId("sop-run-5"));
    await waitFor(() => expect(screen.getByTestId("sop-detail-status")).toHaveTextContent("EXEC_MEETING"));

    // 定稿走 Action：actionType=定稿月度计划版本 → 草稿待审批 + 版本 pendingApproval（仍未 FINAL）
    await user.click(await screen.findByTestId("sop-finalize"));
    await screen.findByTestId("sop-finalize-pending");
    expect(screen.getByTestId("sop-detail-pending")).toHaveTextContent("待审批");
    expect(screen.getByTestId("sop-detail-status")).toHaveTextContent("EXEC_MEETING");
    const draft = db.actionDrafts[0]!;
    expect(draft.actionTypeKey).toBe("定稿月度计划版本");
    const versionId = String((draft.payload as { versionId: string }).versionId);
    expect((draft.payload as { resolutions: unknown[] }).resolutions.length).toBeGreaterThan(0);

    // 审批通过 → 域执行器：Action EXECUTED → 版本 FINAL（pendingApproval 清空）
    await decideActionDraft(draft.id, "APPROVE", "月度定稿");
    const v = await fetchSopVersion(versionId);
    expect(v.status).toBe("FINAL");
    expect(v.pendingApproval ?? null).toBeNull();

    // 全页锁定态：横幅 + 编辑控件只读 + 版本徽章 已定稿·C22 锁定
    await queryClient.invalidateQueries();
    await screen.findByTestId("sop-locked-banner");
    expect(screen.getByTestId("sop-locked-banner")).toHaveTextContent("已定稿——变更须走变更 Action");
    expect(screen.getByTestId("sop-version-badge")).toHaveTextContent("V1 已定稿·C22 锁定");
    expect(screen.queryByTestId("sop-run-1")).not.toBeInTheDocument();
  });

  it("FINAL 种子版本：锁定横幅 + 改字段 409 PLAN_LOCKED 兜底 + 发起变更（actionType=计划版本变更）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/sop-balance");

    // 种子：2026-06 已定稿（FINAL）
    expect(await screen.findByTestId("sop-status-2026-06")).toHaveTextContent("FINAL");
    await user.click(screen.getByTestId("sop-version-2026-06"));

    const banner = await screen.findByTestId("sop-locked-banner");
    expect(banner).toHaveTextContent("已定稿——变更须走变更 Action");
    expect(screen.getByTestId("sop-version-badge")).toHaveTextContent("V1 已定稿·C22 锁定");
    // 全部编辑控件只读：五步执行按钮不渲染
    expect(screen.queryByTestId("sop-run-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sop-run-5")).not.toBeInTheDocument();

    // 改字段尝试 → 后端 409 PLAN_LOCKED → toast 透出 + 前端兜底同横幅
    await user.click(screen.getByTestId("sop-lock-demo-save"));
    expect(await screen.findByText(/S&OP 版本已定稿（C22 锁定）/)).toBeInTheDocument();
    expect(screen.getByTestId("sop-locked-banner")).toBeInTheDocument();

    // 发起变更 → actionType=计划版本变更 草稿
    await user.click(screen.getByTestId("sop-request-change"));
    await waitFor(() => expect(db.actionDrafts[0]!.actionTypeKey).toBe("计划版本变更"));
    expect(db.actionDrafts[0]!.status).toBe("PENDING_APPROVAL");
    expect((db.actionDrafts[0]!.payload as { versionId: string }).versionId).toBe("sop-202606-final");
  });
});
