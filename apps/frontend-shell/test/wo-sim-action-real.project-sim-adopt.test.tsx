import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { mockCapacityForecast } from "@/mocks/simSolvers";

/**
 * WO-SIM-ACTION-REAL · 项目推演⑥「采纳结论」按钮 —— 屏上那句「结论可采纳为 Action」的兑现半。
 *
 * 病灶（审核方亲手复核）：`ProjectSimView.tsx` DAG fc 节点备注写「结论可采纳为 Action
 * （参数组合 + 推演快照写回）」，而该文件 `ActionDraft`/`actionTypeKey`/`adopt` 零命中 ——
 * 用户照这句话去等工单永远等不到。（DynamicLeverPanel 的「采纳杠杆组合」是**另一个**动作
 * ——采纳产能保障方案·改写杠杆属性，不接结论本身，不能算这句承诺的兑现。）
 *
 * 本测断言（前端半接缝）：点「采纳结论」→ POST /a/v1/action-drafts 真发出，
 * actionTypeKey=采纳产能预测结论 · submit=true（直进 S2 审批·非直改真值 R4），
 * 且 payload 里的**参数组合与推演快照就是屏上那份**（快照数值 = mock 求解器同输入真算的
 * 输出，不是写死的期望值——前端改错接线，这里当场红）。
 * 后端半（审批→真写对象→读回字段变）见 apps/datacore/test/action-adopt-forecast.seam.test.ts。
 */

interface CapturedDraft {
  actionTypeKey?: string;
  payload?: Record<string, unknown>;
  submit?: boolean;
}

function captureDrafts(): { captured: CapturedDraft[] } {
  const captured: CapturedDraft[] = [];
  server.use(
    http.post("*/a/v1/action-drafts", async ({ request }) => {
      captured.push((await request.json()) as CapturedDraft);
      return HttpResponse.json({ draftId: "act-sim-adopt", status: "PENDING_APPROVAL" }, { status: 201 });
    }),
  );
  return { captured };
}

describe("WO-SIM-ACTION-REAL · 项目推演⑥ 采纳结论 → ActionDraft（参数组合 + 推演快照）", () => {
  it("整单：点「采纳结论」→ 草稿真发出，payload 的参数组合+快照 = 屏上那份（与求解器输出逐字段相等）", async () => {
    const { captured } = captureDrafts();
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");

    // 默认整单（4680-NCM · 40 万套 · 6 周）首算完成 → 跳到⑥结论与对策
    await screen.findByTestId("pm-stepper");
    await user.click(screen.getByTestId("pm-step-chip-6"));
    const btn = await screen.findByTestId("pm-adopt-conclusion");
    expect(btn).not.toBeDisabled();
    await user.click(btn);

    await waitFor(() => expect(captured.length).toBe(1));
    const draft = captured[0]!;
    expect(draft.actionTypeKey).toBe("采纳产能预测结论");
    expect(draft.submit, "必须直进审批链（R4：真值写入经 Action 审批，不直改）").toBe(true);

    const p = draft.payload!;
    // 参数组合 = 屏上输入
    expect(p.source).toBe("project-sim");
    expect(p.modelId).toBe("4680-NCM");
    expect(p.mode).toBe("single");
    expect(p.demandWan).toBe(40); // 万套
    expect(p.weeks).toBe(6); // 周
    expect(p.orderId, "未选中订单时不许臆造 orderId").toBeUndefined();

    // 推演快照 = 求解器同输入真算的输出（量纲核对：capWanP50/capWanP90/gapWan 万套·healthFactor 无量纲）
    const expected = mockCapacityForecast({ modelId: "4680-NCM", qty: 40, weeks: 6 }) as {
      capWanP50: number; capWanP90: number; gap: number; healthFactor: number; ok: boolean; mainBn: string;
    };
    const snap = p.snapshot as Record<string, unknown>;
    expect(snap.capWanP50).toBe(expected.capWanP50);
    expect(snap.capWanP90).toBe(expected.capWanP90);
    expect(snap.gapWan).toBe(Math.max(0, expected.gap));
    expect(snap.healthFactor).toBe(expected.healthFactor);
    expect(snap.ok).toBe(expected.ok);
    expect(snap.mainBn).toBe(expected.mainBn ?? "");
  });

  it("改参数后采纳：payload 跟随屏上参数（需求量 40→55 万套），不许采纳到旧参数的旧结论", async () => {
    const { captured } = captureDrafts();
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/project-sim");

    await screen.findByTestId("pm-stepper");
    // 改需求量 40 → 55（受控 number 输入逐键入会被钳位，fireEvent 一次到位）→ 跳⑥等重算完成（需求 KPI 变 55）
    const qtyInput = screen.getByLabelText("需求(万套)");
    fireEvent.change(qtyInput, { target: { value: "55" } });
    await user.click(screen.getByTestId("pm-step-chip-6"));
    // ⚠ 2026-08-19 WO-TIMEOUT-5000-SWEEP：等待预算 5s→20s（共享机高负载假红，同型见 c9ff5936f）；判据未动。
    await waitFor(() => expect(screen.getByTestId("kpi-demand")).toHaveTextContent("55"), { timeout: 20000 });
    const btn = await screen.findByTestId("pm-adopt-conclusion");
    await waitFor(() => expect(btn).not.toBeDisabled());
    await user.click(btn);

    await waitFor(() => expect(captured.length).toBe(1));
    const p = captured[0]!.payload!;
    expect(p.demandWan).toBe(55);
    const expected = mockCapacityForecast({ modelId: "4680-NCM", qty: 55, weeks: 6 }) as { capWanP50: number };
    expect((p.snapshot as Record<string, unknown>).capWanP50).toBe(expected.capWanP50);
    // 整条墙钟预算同理上调（WO-TIMEOUT-5000-SWEEP）：renderApp+懒加载链路在共享机负载下会超全局 20s。
  }, 60000);
});
