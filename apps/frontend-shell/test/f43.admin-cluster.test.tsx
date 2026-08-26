import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F43 · 七管理页整簇（admin-console-closure §6，后端已就绪补前端）：
 * 闭环验证(VLE) / 隔离区 / 通知中心 / 域管理 —— 修审计暴露的"后端有·前端缺"。
 */
describe("F43 · 管理页整簇", () => {
  it("VLE 运行历史：列出运行 + 工程验证度", async () => {
    loginAs("planner");
    renderApp("/admin/validation");
    await screen.findByTestId("validation-page");
    const run = await screen.findByTestId("vle-run-vrun_1");
    expect(run).toHaveTextContent("SMOKE");
    expect(run).toHaveTextContent("通过");
    expect(run).toHaveTextContent("94%"); // 工程验证度
  });

  it("隔离区：只列 PENDING，重入按钮可点", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/quarantine");
    await screen.findByTestId("quarantine-page");
    expect(await screen.findByTestId("q-row-qr_1")).toHaveTextContent("结构不符");
    expect(screen.queryByTestId("q-row-qr_2")).toBeNull(); // DISCARDED 不列
    await user.click(screen.getByTestId("q-reprocess-qr_1"));
    await screen.findByText("已重入正门");
  });

  it("通知中心：未读角标 + 跳转引用对象", async () => {
    loginAs("planner");
    renderApp("/admin/notifications");
    await screen.findByTestId("notifications-page");
    expect(await screen.findByTestId("notif-unread")).toHaveTextContent("1 未读");
    const n1 = await screen.findByTestId("notif-ntf_1");
    expect(within(n1).getByTestId("notif-goto-ntf_1")).toHaveAttribute("href", "/admin/actions");
  });

  it("域管理：列出域 + 新建域", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/domains");
    await screen.findByTestId("domains-page");
    expect(await screen.findByTestId("domain-factory")).toHaveTextContent("工厂");
    await user.type(screen.getByTestId("domain-key"), "supplier");
    await user.click(screen.getByTestId("domain-create"));
    await screen.findByText("域已创建");
  });

  it("Agent 评测：用例库 + 跑评测 + 历史报告", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/evals");
    await screen.findByTestId("evals-page");
    expect(await screen.findByTestId("eval-case-ec_1")).toHaveTextContent("capacity_feasibility");
    expect(await screen.findByTestId("eval-run-erun_1")).toHaveTextContent("95%");
    // A14：parity 失因列（对 PRD 期望的偏差）
    // WO-UNIT-MEANING：失因数曾是裸「意图错分 1」——1 是用例数还是次数看不出；后端 byFailKind 计的是**用例条数**，
    // 故逐值带「例」、列头带（例）。通过率括号里的 19/20 同理。退回裸数即红。
    expect(await screen.findByTestId("eval-parity-erun_1")).toHaveTextContent(/意图错分 1 例/);
    expect(await screen.findByTestId("eval-run-erun_1")).toHaveTextContent(/\(\d+\/\d+ 例\)/);
    expect(screen.getByText("parity 失因（对 PRD 期望·例）")).toBeInTheDocument();
    expect(screen.getByText("通过率（例）")).toBeInTheDocument();
    await user.click(screen.getByTestId("eval-run"));
    await screen.findByText(/评测完成：20\/20 通过/);
  });

  it("本体切片：列出切片 + 契约 fixtures 徽章", async () => {
    loginAs("planner");
    renderApp("/admin/slices");
    await screen.findByTestId("slices-page");
    const s = await screen.findByTestId("slice-model_capacity_network");
    expect(s).toHaveTextContent("Model");
    expect(within(s).getByTestId("slice-fixtures-model_capacity_network")).toHaveTextContent("1");
  });

  it("实体合并：候选并排对照 + 选 golden 合并 + 合并历史还原", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/merge");
    await screen.findByTestId("merge-page");
    // 候选并排对照
    const cand = await screen.findByTestId("merge-cand-mc_1");
    expect(cand).toHaveTextContent("常州");
    // WO-UNIT-MEANING：匹配得分是 [0,1] 相似度（契约 MergeCandidateSchema.score 注释），此前渲染成裸「得分 0.92」。
    expect(screen.getByTestId("merge-cand-meta-mc_1").textContent ?? "").toMatch(/匹配得分 [\d.]+\/1（相似度）/);
    // 选 obj_a 为 golden 合并
    await user.click(within(cand).getByTestId("merge-golden-mc_1-obj_a"));
    await screen.findByText(/已合并/);
    // 合并历史可还原
    expect(await screen.findByTestId("unmerge-omg_0")).toBeInTheDocument();
  });
});
