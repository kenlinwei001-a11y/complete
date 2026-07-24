import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { db } from "@/mocks/db";

/**
 * WO-CAPLIVE-2-COCKPIT · 产能推演「活台」SEAM 组合测（前端 + datacore merge 态·头号判据·非各半绿）。
 * 治 G-CAPACITY-DEAD-BI（产能页全只读）：① 原子因子活推演（generic_inference 真重算·携真三元组·deltas 逐字投影·KILL-MOCK）
 * ② 因子级根因（gap_attribution scope.factorId → 树随之细分）③ 方案存 A 分支 B → 横比矩阵各格=各方案真算（改方案 → 矩阵变）
 * ④ tornado 排序=真敏感度（改 mock 敏感度 → 顺序变）⑤ 采纳 → PENDING_APPROVAL（真审批·非 toast）。
 * 依赖 WO-LIVE-NL/WO-LIVE-SCENARIO 用 MSW 桩覆盖（桩按输入真变输出·非写死示意），集成接真点见 endpoints/handlers 注释。
 */

async function openChangzhou(): Promise<void> {
  loginAs("planner");
  renderApp("/v/risk");
  const card = await screen.findByTestId("risk-card-常州");
  fireEvent.click(card);
  await screen.findByTestId("risk-detail-常州");
}

describe("WO-CAPLIVE-2 · 产能活台 SEAM", () => {
  it("SEAM① 拨原子因子 → generic_inference 携真 {objectType,objectId,prop,value}（objectId 非写死）→ deltas 非零逐字投影", async () => {
    // 捕获 B 侧 run 请求，证携带杠杆真对象三元组（非写死）；喂显式 mock payload → 逐字渲（KILL-MOCK）。
    let captured: { objectType: string; objectId: string; prop: string; value: number } | null = null;
    server.use(
      http.post("*/b/v1/solvers/generic_inference/run", async ({ request }) => {
        const body = (await request.json()) as { args?: { apply?: { objectType: string; objectId: string; prop: string; value: number }[] } };
        captured = body.args?.apply?.[0] ?? null;
        return HttpResponse.json({
          data: { deltas: [{ objId: "obj_Base_CZ", type: "Base", prop: "weeklyCap", before: 88, after: 97.5 }], rows: [{ objectId: "obj_Base_CZ", type: "Base", prop: "weeklyCap", before: 88, after: 97.5 }], affectedObjects: 1, count: 1, rootTypes: ["Equipment"] },
          snapshotVersion: "ov-gi",
        });
      }),
    );
    await openChangzhou();

    // 产能页原子因子活推演面板（复用 DynamicLeverPanel·产能瓶颈 → 产能杠杆集）。
    expect(await screen.findByTestId("caplive-lever-常州")).toBeInTheDocument();
    const oee = await screen.findByTestId("lever-slider-oee_current");
    fireEvent.change(oee, { target: { value: "0.95" } });
    await waitFor(() => expect(screen.getByTestId("lever-deltas")).toBeInTheDocument());

    // 携真三元组（objectId 来自杠杆发现真对象·非写死）。
    expect(captured).toEqual({ objectType: "Equipment", objectId: "obj_Equipment_E1", prop: "oee_current", value: 0.95 });
    // deltas 逐字投影 before/after（KILL-MOCK：喂显式 payload → 逐字渲）。
    const row = screen.getByTestId("lever-delta-row-obj_Base_CZ-weeklyCap");
    expect(within(row).getByTestId("lever-before-obj_Base_CZ-weeklyCap")).toHaveTextContent("88");
    expect(within(row).getByTestId("lever-after-obj_Base_CZ-weeklyCap")).toHaveTextContent("97.5");
    expect(screen.getByTestId("lever-affected-count")).toHaveTextContent("1");
  });

  it("SEAM② 因子级根因：选因子 → gap_attribution 携 scope.factorId → 树随之细分（改 factorId → 树变·非写死）", async () => {
    let capturedScope: { baseId?: string; factorId?: string } | undefined;
    server.use(
      http.post("*/a/v1/solvers/gap_attribution/invoke", async ({ request }) => {
        const body = (await request.json()) as { args?: { scope?: { baseId?: string; factorId?: string } } };
        capturedScope = body.args?.scope;
        const factorId = capturedScope?.factorId;
        // 桩按 scope.factorId 真细分：未选因子=基地级 2 结构叶；选因子 → 追加该因子专属结构叶（树节点数变·KILL-MOCK）。
        const l2 = [
          { id: "equip:常州", factor: "常州 设备瓶颈", contribution: 4.1, unit: "%", share: 0.5, path: ["m1", "base:常州", "equip:常州"], provenance: { drillType: "Equipment", drillField: "oee_current", drillValue: 0.78 } },
          { id: "material:cathode", factor: "正极物料短缺", contribution: 3.0, unit: "%", share: 0.3, path: ["m1", "base:常州", "material:cathode"], provenance: { drillType: "MaterialBalance", drillField: "gapTon", drillValue: 1820 } },
        ];
        if (factorId) l2.push({ id: `factor:${factorId}`, factor: `因子细分·${factorId}`, contribution: 2.2, unit: "%", share: 0.2, path: ["m1", "base:常州", `factor:${factorId}`], provenance: { drillType: "Process", drillField: "yield_baseline", drillValue: 0.9 } });
        return HttpResponse.json({
          data: {
            rootMetric: { key: "seg_attain_ess", name: "储能达成率", unit: "%", target: 100, actual: 72.2, gap: 27.8 },
            totalGap: 27.8,
            levels: [
              { depth: 1, label: "基地", residual: 2.1, nodes: [{ id: "base:常州", factor: "基地 常州", contribution: 9.2, unit: "%", share: 0.33 }] },
              { depth: 2, label: "订单/瓶颈", residual: 1.0, nodes: l2 },
            ],
            causalEdges: [], atomicLeaves: [], reconChecks: [], reconciled: true, residualPct: 12, summary: "储能达成率缺口 27.8%",
          },
          snapshotVersion: "ov-infer",
        });
      }),
    );
    await openChangzhou();

    // 默认（基地级·无 factorId）：只有基地结构叶，无因子专属节点 + 诚实"未按因子细分"。
    await screen.findByTestId("rootcause-panel-常州");
    await waitFor(() => expect(screen.getByTestId("rootcause-scope-note")).toHaveTextContent("未"));
    expect(capturedScope?.baseId).toBeTruthy();
    expect(capturedScope?.factorId).toBeUndefined();

    // 选一个因子 chip → 传 scope.factorId → 树追加因子专属结构叶（树随之细分）。
    const chip = await screen.findByTestId("rootcause-factor-化成柜张力");
    fireEvent.click(chip);
    await waitFor(() => expect(capturedScope?.factorId).toBe("化成柜张力"));
    await waitFor(() => expect(screen.getByTestId("dag-node-factor:化成柜张力")).toBeInTheDocument());
    expect(screen.getByTestId("rootcause-scope-note")).toHaveTextContent("已按因子");
  });

  it("SEAM③ 方案存 A 分支 B → 横比矩阵各格 = 各方案真算（不同 apply → capGain 不同·改方案 → 矩阵变）", async () => {
    const user = userEvent.setup();
    await openChangzhou();

    // 方案 A：拨 oee → 存。
    fireEvent.change(await screen.findByTestId("lever-slider-oee_current"), { target: { value: "0.95" } });
    await waitFor(() => expect((screen.getByTestId("lever-slider-oee_current") as HTMLInputElement).value).toBe("0.95"));
    await user.type(screen.getByTestId("caplive-scenario-name"), "方案A_高OEE");
    await waitFor(() => expect(screen.getByTestId("caplive-scenario-save")).not.toBeDisabled());
    await user.click(screen.getByTestId("caplive-scenario-save"));
    await screen.findByTestId("caplive-scenario-list");

    // 方案 B：改拨 yield（不同 apply）→ 存。
    fireEvent.change(screen.getByTestId("lever-slider-yield_baseline"), { target: { value: "0.99" } });
    await waitFor(() => expect((screen.getByTestId("lever-slider-yield_baseline") as HTMLInputElement).value).toBe("0.99"));
    await user.type(screen.getByTestId("caplive-scenario-name"), "方案B_高良率");
    await user.click(screen.getByTestId("caplive-scenario-save"));
    await waitFor(() => expect(within(screen.getByTestId("caplive-scenario-list")).getAllByTestId(/^caplive-scenario-row-/).length).toBe(2));

    // 勾选两方案 → 横比矩阵各格 = 各方案 generic_inference 真算（capGain 由各自 apply 算·非写死）。
    const picks = within(screen.getByTestId("caplive-scenario-list")).getAllByTestId(/^caplive-scenario-pick-/);
    await user.click(picks[0]!);
    await user.click(picks[1]!);
    await user.click(screen.getByTestId("caplive-scenario-compare"));
    const matrix = await screen.findByTestId("caplive-scenario-matrix");
    const capgains = within(matrix).getAllByTestId(/^caplive-matrix-capGain-/).map((el) => el.textContent);
    // 两方案 apply 不同（oee=0.95 vs yield=0.99）→ 矩阵各行 capGain 不同（真算·非写死）。
    expect(capgains.length).toBe(2);
    expect(capgains[0]).not.toEqual(capgains[1]);
  });

  it("SEAM④ tornado 排序=真敏感度：改 mock 敏感度 → 顺序随之变（证排序非写死）", async () => {
    // 反转敏感度：yield 最大 → 排最前。
    server.use(
      http.post("*/a/v1/solvers/generic_inference/invoke", async ({ request }) => {
        const body = (await request.json()) as { args?: { mode?: string } };
        if (body.args?.mode !== "levers") return HttpResponse.json({ data: { deltas: [], rows: [], affectedObjects: 0, count: 0, rootTypes: [] }, snapshotVersion: "ov-gi" });
        return HttpResponse.json({
          data: {
            levers: [
              { objectType: "Process", objectId: "obj_Process_P1", prop: "yield_baseline", factor: "良率波动", currentValue: 0.9, sensitivity: 3.3, provenance: { src: "s", formula: "f", inputs: [] } },
              { objectType: "Equipment", objectId: "obj_Equipment_E1", prop: "oee_current", factor: "设备OEE", currentValue: 0.82, sensitivity: 0.4, provenance: { src: "s", formula: "f", inputs: [] } },
            ],
            deltas: [], rows: [], affectedObjects: 0, count: 2, rootTypes: ["Process", "Equipment"],
          },
          snapshotVersion: "ov-lv",
        });
      }),
    );
    await openChangzhou();
    await screen.findByTestId("tornado-bar-yield_baseline");
    const bars = within(screen.getByTestId("lever-tornado")).getAllByTestId(/^tornado-bar-/);
    expect(bars.map((b) => b.getAttribute("data-testid"))).toEqual(["tornado-bar-yield_baseline", "tornado-bar-oee_current"]);
  });

  it("SEAM⑤ 采纳方案 → plan_change ActionDraft 走 PENDING_APPROVAL（真审批·C5 门不绕·非 toast）", async () => {
    let captured: { actionTypeKey?: string; payload?: Record<string, unknown>; submit?: boolean } | null = null;
    server.use(
      http.post("*/a/v1/action-drafts", async ({ request }) => {
        captured = (await request.json()) as { actionTypeKey?: string; payload?: Record<string, unknown>; submit?: boolean };
        return HttpResponse.json({ draftId: "act-caplive", status: "PENDING_APPROVAL" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    await openChangzhou();

    // 存一个方案 → 横比 → 采纳。
    fireEvent.change(await screen.findByTestId("lever-slider-oee_current"), { target: { value: "0.95" } });
    await waitFor(() => expect(screen.getByTestId("caplive-scenario-save")).not.toBeDisabled());
    await user.click(screen.getByTestId("caplive-scenario-save"));
    // 存第二个方案以便横比（两方案）。
    fireEvent.change(screen.getByTestId("lever-slider-yield_baseline"), { target: { value: "0.99" } });
    await user.click(screen.getByTestId("caplive-scenario-save"));
    await waitFor(() => expect(within(screen.getByTestId("caplive-scenario-list")).getAllByTestId(/^caplive-scenario-row-/).length).toBe(2));
    const picks = within(screen.getByTestId("caplive-scenario-list")).getAllByTestId(/^caplive-scenario-pick-/);
    await user.click(picks[0]!);
    await user.click(picks[1]!);
    await user.click(screen.getByTestId("caplive-scenario-compare"));
    const matrix = await screen.findByTestId("caplive-scenario-matrix");
    const adoptBtn = within(matrix).getAllByTestId(/^caplive-scenario-adopt-/)[0]!;
    await user.click(adoptBtn);

    // 采纳走 Action 审批（plan_change·submit=true → PENDING_APPROVAL·非直改/非仅 toast）。
    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.actionTypeKey).toBe("plan_change");
    expect(captured!.submit).toBe(true);
    expect(captured!.payload).toHaveProperty("levers");
    expect(Array.isArray((captured!.payload as { levers: unknown[] }).levers)).toBe(true);
  });

  it("活能力② 人机对话（真 NL·替 QaPanel 假 NL）：问句 → askCapacityLive 路由 generic_inference → 叙述带溯源（答案随问句变·KILL-MOCK）", async () => {
    const user = userEvent.setup();
    await openChangzhou();

    // 对话面板 testid 用作用域 baseId（RISK_TIMELINE 常州 → baseId=changzhou）。
    const dialog = await screen.findByTestId("capacity-live-dialog-changzhou");
    await user.type(within(dialog).getByTestId("capacity-live-input"), "化成良率降到 92% 产能少多少？");
    await user.click(within(dialog).getByTestId("capacity-live-ask"));
    const ans = await screen.findByTestId("capacity-live-answer");
    // 答案含问句里的数字（桩按输入真解析·非写死示意）+ 溯源可展开（R13）。
    expect(ans).toHaveTextContent("92%");
    expect(within(dialog).getByTestId("capacity-live-solver")).toBeInTheDocument();
    expect(within(dialog).getByTestId("capacity-live-deltas")).toBeInTheDocument();
  });
});
