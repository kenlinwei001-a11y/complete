import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

describe("F17 · S&OP 月度平衡台（sop-balance）", () => {
  it("新建版本 → ①执行（DRAFT→IN_REVIEW）→ ②三线对照 |dv|>10% 红标 C21；④不通过阻断⑤", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/sop-balance");

    // 新建 2026-07 草稿
    await user.click(await screen.findByTestId("sop-create"));
    await waitFor(() => expect(screen.getByTestId("sop-detail-status")).toHaveTextContent("DRAFT"));

    // ① 产品评审：PLM 认证边 diff → 变更清单表；状态推进 IN_REVIEW
    await user.click(screen.getByTestId("sop-run-1"));
    await screen.findByTestId("sop-s1-table");
    expect(screen.getByTestId("sop-s1-table")).toHaveTextContent("认证转量产");
    await waitFor(() => expect(screen.getByTestId("sop-detail-status")).toHaveTextContent("IN_REVIEW"));

    // ② 需求评审：三线对照，商用车 −11.8%（>±10%）红标 ⚑ + C21 提报
    await user.click(screen.getByTestId("sop-step-chip-2"));
    await user.click(await screen.findByTestId("sop-run-2"));
    const dvCom = await screen.findByTestId("sop-dv-com");
    expect(dvCom).toHaveTextContent("-11.8%");
    expect(dvCom).toHaveTextContent("⚑");
    expect(screen.getByTestId("sop-s2-table")).toHaveTextContent("C21 差异提报");

    // ③ 供应评审：供给 129.5 vs 需求 132 → 缺口 2.5 > 2 红标
    await user.click(screen.getByTestId("sop-step-chip-3"));
    await user.click(await screen.findByTestId("sop-run-3"));
    const gap = await screen.findByTestId("sop-gap");
    expect(gap).toHaveTextContent("2.5");
    expect(gap).toHaveTextContent("缺口 > 2 万套");

    // ④ 财务整合：现金垫 40 亿 < C18 底线 50 → 不通过
    await user.click(screen.getByTestId("sop-step-chip-4"));
    const cash = await screen.findByLabelText("现金垫(13周最低点)");
    await user.clear(cash);
    await user.type(cash, "40");
    await user.click(screen.getByTestId("sop-run-4"));
    const s4 = await screen.findByTestId("sop-s4-pass");
    expect(s4).toHaveTextContent("④ 财务整合未通过");
    expect(s4).toHaveTextContent("C18 底线 50");

    // ⑤ 被阻断：按钮禁用 + 原因文案
    await user.click(screen.getByTestId("sop-step-chip-5"));
    expect(await screen.findByTestId("sop-run-5")).toBeDisabled();
    expect(screen.getByTestId("sop-step5-blocked")).toHaveTextContent("④ 财务整合未通过，阻断进入⑤");
  });

  it("FINAL 版本：锁定 banner（C22）+ 改字段尝试 → 409 PLAN_LOCKED toast", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/sop-balance");

    // 种子：2026-06 已定稿（FINAL）
    const final = await screen.findByTestId("sop-version-2026-06");
    expect(screen.getByTestId("sop-status-2026-06")).toHaveTextContent("FINAL");
    await user.click(final);

    expect(await screen.findByTestId("sop-locked-banner")).toHaveTextContent("已锁定（C22）");
    // 全部只读：五步执行按钮不渲染
    expect(screen.queryByTestId("sop-run-1")).not.toBeInTheDocument();

    // 改字段尝试 → 409 PLAN_LOCKED → toast 展示后端错误语义
    await user.click(screen.getByTestId("sop-lock-demo-save"));
    expect(await screen.findByText(/S&OP 版本已定稿（C22 锁定）/)).toBeInTheDocument();
  });
});
