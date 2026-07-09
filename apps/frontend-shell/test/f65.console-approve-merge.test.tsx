import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { db } from "@/mocks/db";
import { ADMIN_PAGES } from "@/pages/adminRegistry";
import type { ActionDraft } from "@platform/contracts";

/**
 * F65 · UPG-L0-CONSOLE-APPROVE（PRD-gapfill-surface-consolidation §5 B2·§4.1/§4.3·参 GROWTH-TICKET-MERGE tombstone 范式）：
 * DataBuilder「待审批补齐」（db-approvals·R4 就地批复）被统一 Console 详情抽屉完全承接 → 就地 R4 批复不跳 /admin/actions（R17）。
 * 四齿（revert 任一 → 红）：
 *  ① tombstone：/admin/db-approvals 302→/admin/tickets（深链承接·防死链·RL2/RL9 不静默删）；
 *  ② 承接（防丢）：暗发 ON → 抽屉内「就地批复」段现 + 批准就地流转（就地 R4·不跳页 R17）；
 *  ③ 回退（C3·additive）：暗发 OFF（默认）→ 抽屉无就地批复段 = 改造前系统（仍走旧审批面）；旧 /admin/data-builder 面路由保留可回退；
 *  ④ 零新增导航项：/admin/db-approvals 仅 tombstone 深链，不进 ADMIN_PAGES（无幽灵导航项）。
 */
const boardWith = (flag: boolean) =>
  http.get("*/b/v1/growth/board", () => {
    return HttpResponse.json({
      items: [
        { id: "wli-seed-1", tenantId: "demo", source: "WORKLIST", kind: "DATA_GAP", fromQuestion: "常州影响哪些订单？", gapCode: "EMPTY_DATA", status: "OPEN", claimable: true, evidence: "SOFT 缺数据", createdAt: "2026-06-17T09:00:00.000Z", updatedAt: "2026-06-17T09:00:00.000Z" },
      ],
      inDrawerApproveEnabled: flag,
    });
  });

// 单审批步草稿：一次批准 → APPROVED 离开 PENDING_APPROVAL（逐值可证后端状态变更）。
const seedSingleStepPending = (id: string): ActionDraft => {
  const d: ActionDraft = {
    id, tenantId: "demo", actionTypeKey: "materialize_synthetic_world",
    payload: { typeKey: "Order" }, origin: { userId: "usr-admin" },
    status: "PENDING_APPROVAL", approvalSteps: [{ seq: 1, role: "admin" }],
    createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z",
  };
  db.actionDrafts.unshift(d);
  return d;
};

describe("F65 · CONSOLE-APPROVE 就地批复整合 + 旧面 tombstone 退役（四齿）", () => {
  it("齿① tombstone：/admin/db-approvals 302→/admin/tickets（承接深链·防死链）", async () => {
    loginAs("planner"); // admin+catalog_admin
    const { router } = renderApp("/admin/db-approvals");
    await screen.findByTestId("ticket-center-page");
    expect(router.state.location.pathname).toBe("/admin/tickets");
  });

  it("齿② 暗发 ON：抽屉内「就地批复」段承接 db-approvals + 批准就地流转（R4·不跳页 R17）", async () => {
    const user = userEvent.setup();
    server.use(boardWith(true));
    seedSingleStepPending("act-indrawer-1");
    loginAs("planner");
    const { router } = renderApp("/admin/tickets");
    await screen.findByTestId("ticket-center-page");

    // 开工单详情抽屉。
    await user.click(await screen.findByTestId("tc-row-wli-seed-1"));
    const drawer = await screen.findByTestId("tc-drawer");
    // 就地批复段承接（防丢）：段 + 待批草稿行 + 批准/驳回按钮。
    const approvals = await within(drawer).findByTestId("tc-db-approvals");
    // 计数 = 后端 PENDING_APPROVAL 草稿数（逐值·含既有 fixture）——段真承接全部待批。
    const pendingCount = db.actionDrafts.filter((d) => d.status === "PENDING_APPROVAL").length;
    expect(within(approvals).getByTestId("tc-db-approval-count")).toHaveTextContent(String(pendingCount));
    expect(within(approvals).getByTestId("tc-db-approval-act-indrawer-1")).toBeInTheDocument();

    // 就地批准 → 未离开 Console（路由仍 /admin/tickets·R17 不跳 /admin/actions）。
    await user.click(within(approvals).getByTestId("tc-db-approve-act-indrawer-1"));
    // 后端状态真变更：草稿离开 PENDING_APPROVAL（逐值·refetch 后段消失=空态诚实隐）。
    await screen.findByText("已批准（就地·未离开 Console）");
    expect(db.actionDrafts.find((d) => d.id === "act-indrawer-1")?.status).toBe("APPROVED");
    // R17：全程未跳页（仍在统一 Console）。
    expect(router.state.location.pathname).toBe("/admin/tickets");
  });

  it("齿③ 回退（C3·默认关闸）：抽屉无就地批复段 = 改造前系统；旧 /admin/data-builder 面路由保留", async () => {
    const user = userEvent.setup();
    server.use(boardWith(false)); // 暗发 OFF（默认·关闸=改造前系统）
    seedSingleStepPending("act-indrawer-2"); // 有待批草稿但关闸不显现
    loginAs("planner");
    renderApp("/admin/tickets");
    await screen.findByTestId("ticket-center-page");
    await user.click(await screen.findByTestId("tc-row-wli-seed-1"));
    await screen.findByTestId("tc-drawer");
    // 关闸 → 抽屉内无就地批复段（回退到改造前·仍走旧 DataBuilder InPlaceApprovalPanel / /admin/actions）。
    expect(screen.queryByTestId("tc-db-approvals")).toBeNull();
    // 旧面 additive 保留：/admin/data-builder 路由仍登记（旧路径不删·回退可证）。
    expect(ADMIN_PAGES.find((p) => p.path === "data-builder")).toBeDefined();
  });

  it("齿④ 零幽灵导航：/admin/db-approvals 仅 tombstone 深链，不进 ADMIN_PAGES（承接主体仍 tickets）", () => {
    expect(ADMIN_PAGES.find((p) => p.path === "db-approvals")).toBeUndefined();
    expect(ADMIN_PAGES.find((p) => p.path === "tickets")).toBeDefined();
  });
});
