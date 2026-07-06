import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * F64 · AUTOFILL-SOP（用户亲令 2026-07-06·SPEC-autofill-sop §4）：工单中心「诊断新缺口」自动补 before→after
 * 证据块**前后端逐值可见**——前端逐值渲染每个 before/after 键值对，逐值 == 后端（MSW 真返 GapFillEvidence）。
 *
 * 逐值勾稽（铁律0.4）：断言前端渲染的 before/after 每个键值 == 后端 growth/run 报告 fillApplied.fillEvidence 真值。
 * 诚实边界：dataMode 位诚实渲染（PROVISIONAL 合成占位 / NONE 未自动补登记在办）——不冒充真实。
 * 真浏览器 + 真起后端逐值对照属审核方复验（此处 jsdom+MSW 结构逐值勾稽·诚实注）。
 *
 * revert 任一（前端摘掉 FillEvidenceBlock / 后端 handler 去掉 fillEvidence）→ 红。
 */

// 后端 MSW growth/run 真返的 GapFillEvidence 真值（handlers.ts 达成率分支）——前端逐值须与此勾稽。
const BACKEND_PROVISIONAL = {
  dataMode: "PROVISIONAL",
  fillAction: "fillData",
  before: { typeKey: "Object", rows: "0" },
  after: { typeKey: "Object", rows: "6" },
} as const;
// 默认（BOUNDARY 分支）真返 NONE 证据真值。
const BACKEND_NONE = {
  dataMode: "NONE",
  before: { worklistItems: "0", status: "gap" },
  after: { worklistItems: "1", status: "OPEN", worklistItemId: "wli_demo" },
} as const;

async function runDiagnose(query: string) {
  const user = userEvent.setup();
  loginAs("planner");
  renderApp("/admin/tickets");
  await screen.findByTestId("ticket-center-page");
  await user.click(screen.getByTestId("tc-diagnose-toggle"));
  const panel = await screen.findByTestId("tc-diagnose-panel");
  const input = within(panel).getByTestId("tc-diagnose-query");
  await user.clear(input);
  await user.type(input, query);
  await user.click(within(panel).getByTestId("tc-diagnose-run"));
  return within(await screen.findByTestId("tc-diagnose-report"));
}

describe("F64 · AUTOFILL-SOP 自动补 before→after 证据块前后端逐值勾稽", () => {
  it("PROVISIONAL 类（fillData）：前端逐值渲染 before{rows:0}→after{rows:6}·typeKey Object == 后端真值", async () => {
    const report = await runDiagnose("常州订单达成率是多少"); // 命中「达成率」→ 后端 CONVERGED + PROVISIONAL 证据

    const fe = within(await report.findByTestId("tc-fe-1"));
    // dataMode 位诚实渲染 == 后端。
    expect(fe.getByTestId("tc-fe-1-datamode")).toHaveTextContent(BACKEND_PROVISIONAL.dataMode);
    expect(fe.getByTestId("tc-fe-1-action")).toHaveTextContent(BACKEND_PROVISIONAL.fillAction);
    // before 逐值勾稽（每个键值对 == 后端）。
    expect(fe.getByTestId("tc-fe-1-before-rows")).toHaveTextContent(BACKEND_PROVISIONAL.before.rows);
    expect(fe.getByTestId("tc-fe-1-before-typeKey")).toHaveTextContent(BACKEND_PROVISIONAL.before.typeKey);
    // after 逐值勾稽。
    expect(fe.getByTestId("tc-fe-1-after-rows")).toHaveTextContent(BACKEND_PROVISIONAL.after.rows);
    expect(fe.getByTestId("tc-fe-1-after-typeKey")).toHaveTextContent(BACKEND_PROVISIONAL.after.typeKey);
    // 补前后真变化：rows 0 → 6（合成 6 行 PROVISIONAL），逐值不同（证据块非空壳）。
    expect(fe.getByTestId("tc-fe-1-before-rows")).not.toHaveTextContent("6");
    expect(fe.getByTestId("tc-fe-1-evidence")).toHaveTextContent(/PROVISIONAL/);
  });

  it("NONE 类（登记在办·未自动补）：前端逐值渲染 before{status:gap}→after{status:OPEN·worklistItemId} == 后端真值·诚实标 NONE", async () => {
    const report = await runDiagnose("常州瓶颈在哪"); // 非达成率 → 后端 BOUNDARY + NONE 证据（登记在办）

    const fe = within(await report.findByTestId("tc-fe-1"));
    expect(fe.getByTestId("tc-fe-1-datamode")).toHaveTextContent(BACKEND_NONE.dataMode);
    // before/after 逐值勾稽（未实际合成：worklistItems 0→1、status gap→OPEN）。
    expect(fe.getByTestId("tc-fe-1-before-status")).toHaveTextContent(BACKEND_NONE.before.status);
    expect(fe.getByTestId("tc-fe-1-before-worklistItems")).toHaveTextContent(BACKEND_NONE.before.worklistItems);
    expect(fe.getByTestId("tc-fe-1-after-status")).toHaveTextContent(BACKEND_NONE.after.status);
    expect(fe.getByTestId("tc-fe-1-after-worklistItems")).toHaveTextContent(BACKEND_NONE.after.worklistItems);
    expect(fe.getByTestId("tc-fe-1-after-worklistItemId")).toHaveTextContent(BACKEND_NONE.after.worklistItemId);
    // 诚实边界：NONE = 未自动补（数据未变），evidence 明示"未自动补·待人工"。
    expect(fe.getByTestId("tc-fe-1-evidence")).toHaveTextContent(/未自动补/);
  });
});
