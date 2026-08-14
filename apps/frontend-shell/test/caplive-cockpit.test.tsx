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

    // ── WO-P50-RENAME · SEAM：**仓主实测撞上的就是这张表** ────────────────────────
    // 原病灶：明细表头只写 `before` / `after`，派生字段列渲的是引擎原始键 `p50`，
    // 而 `p50` 在本仓背了 6 个量纲 ⇒ 用户「不可能分得出是哪个」。
    // 现在断言量纲**在表头上**（不是藏在 hover / 注释里 —— 那两处用户看不到）。
    const details = screen.getByTestId("lever-deltas-details");
    const headText = details.querySelector("thead")?.textContent ?? "";
    expect(headText).toContain("before（电芯/日）");
    expect(headText).toContain("after（电芯/日）");
    expect(headText).toContain("变化（电芯/日）");
    // 图例同步说清「这一列是哪个 p50」——且必须是改名后的自带口径名。
    expect(details.textContent ?? "").toContain("cellsPerDayP50");
    // 反向：旧的「套/天」是 WO-P50-RENAME 实测订正掉的错量纲（差 96 倍），不许回潮。
    expect(details.textContent ?? "").not.toContain("套/天");
  });

  /**
   * ⚠ WO-FACTOR-SCOPE-SINGLESOURCE 改写本例（原版是**假绿**的教科书样本，照铁律 0.5 判据 6 记账）：
   * 原版点的 chip 是 `rootcause-factor-化成柜张力`，而「化成柜张力」只存在于 `mocks/fixtures.ts:808`——
   * 生产两套词表（`BN_FACTORS` 7 个中文名 / `CausalFactor.factorId` 28 个 `cf-*`）**都不含它**；
   * 桩又对**任意** factorId 都追加一个节点。⇒ 这条 SEAM 一直绿，而它验的那条路生产上不存在。
   * 形态：**「我用『测试里点了 chip 树就变了』当作『生产点了会变』的证据，而测试实参 ∩ 生产实参 = ∅。」**
   *
   * 现在：chip 的 **testid = 引擎回执里的 `factorId`**（`scope.availableFactors` 下发·单一来源），
   * 断言点的是「传出去的值是 id 不是中文名」+「不同 id → 不同细分节点」+「引擎说没细分时界面必须显式喊出来」。
   */
  it("SEAM② 因子级根因单源：chip 候选来自引擎 availableFactors，传出去的是 factorId（不是卡面中文因子名），换 id → 树真变", async () => {
    let capturedScope: { baseId?: string; factorId?: string } | undefined;
    const AVAIL = [
      { factorId: "cf-cap-equipment-oee", label: "设备OEE", drillType: "Equipment", drillField: "oee_current", objectCount: 60 },
      { factorId: "cf-cap-yield-variance", label: "良率波动", drillType: "Process", drillField: "yield_baseline", objectCount: 50 },
    ];
    server.use(
      http.post("*/a/v1/solvers/gap_attribution/invoke", async ({ request }) => {
        const body = (await request.json()) as { args?: { scope?: { baseId?: string; factorId?: string } } };
        capturedScope = body.args?.scope;
        const factorId = capturedScope?.factorId;
        const hit = AVAIL.find((f) => f.factorId === factorId);
        const l2 = [
          { id: "equip:常州", factor: "常州 设备瓶颈", contribution: 4.1, unit: "%", share: 0.5, path: ["m1", "base:常州", "equip:常州"], provenance: { drillType: "Equipment", drillField: "oee_current", drillValue: 0.78 } },
          { id: "material:cathode", factor: "正极物料短缺", contribution: 3.0, unit: "%", share: 0.3, path: ["m1", "base:常州", "material:cathode"], provenance: { drillType: "MaterialBalance", drillField: "gapTon", drillValue: 1820 } },
        ];
        // 细分层按 factorId 真变（不同 id → 不同节点 id/不同下钻对象·KILL-MOCK·非"任意串都给一个节点"）。
        const l3 = hit
          ? [{
              depth: 3, label: `因子细分 · ${hit.label}`, residual: 0,
              nodes: [{
                id: `capobj:${hit.factorId}:OBJ-1`, factor: `OBJ-1 · ${hit.drillField}=0.87`, contribution: 1.8, unit: "%", share: 0.6,
                path: ["m1", "base:常州", `capfactor:${hit.factorId}`, `capobj:${hit.factorId}:OBJ-1`],
                provenance: { drillType: hit.drillType, drillField: hit.drillField, drillValue: 0.87 },
              }],
            }]
          : [];
        return HttpResponse.json({
          data: {
            rootMetric: { key: "seg_attain_ess", name: "储能达成率", unit: "%", target: 100, actual: 72.2, gap: 27.8 },
            totalGap: 27.8,
            scope: {
              baseId: "changzhou", availableFactors: AVAIL,
              ...(factorId
                ? (hit
                    ? { factorId: hit.factorId, factorLabel: hit.label, factorApplied: true }
                    : { factorId, factorApplied: false, factorNote: `因子「${factorId}」无对应 CausalFactor 因果域` })
                : {}),
            },
            levels: [
              { depth: 1, label: "基地", residual: 2.1, nodes: [{ id: "base:常州", factor: "基地 常州", contribution: 9.2, unit: "%", share: 0.33 }] },
              { depth: 2, label: "订单/瓶颈", residual: 1.0, nodes: l2 },
              ...l3,
            ],
            causalEdges: [], atomicLeaves: [], reconChecks: [], reconciled: true, residualPct: 12, summary: "储能达成率缺口 27.8%",
          },
          snapshotVersion: "ov-infer",
        });
      }),
    );
    await openChangzhou();

    // 默认（基地级·无 factorId）：诚实"未按因子细分"。
    await screen.findByTestId("rootcause-panel-常州");
    await waitFor(() => expect(screen.getByTestId("rootcause-scope-note")).toHaveTextContent("未"));
    expect(capturedScope?.baseId).toBeTruthy();
    expect(capturedScope?.factorId).toBeUndefined();

    // ① 单源：chip 是引擎下发的那两个（用 factorId 作 testid），且**没有**卡面中文因子名的 chip。
    const chip = await screen.findByTestId("rootcause-factor-cf-cap-equipment-oee");
    expect(chip).toHaveAttribute("data-factor-label", "设备OEE"); // 显示仍是用户认得的名字
    expect(screen.queryByTestId("rootcause-factor-化成柜张力"), "又把卡面因子名当 factorId 渲染了（病灶复发）").toBeNull();

    // ② 传出去的是 id 不是中文名 → 树随之细分。
    fireEvent.click(chip);
    await waitFor(() => expect(capturedScope?.factorId).toBe("cf-cap-equipment-oee"));
    await waitFor(() => expect(screen.getByTestId("dag-node-capobj:cf-cap-equipment-oee:OBJ-1")).toBeInTheDocument());
    expect(screen.getByTestId("rootcause-scope-note")).toHaveTextContent("已按因子");

    // ③ 换一个 id → 细分节点**换成另一个**（证不是"点了就给同一个节点"）。
    fireEvent.click(screen.getByTestId("rootcause-factor-cf-cap-yield-variance"));
    await waitFor(() => expect(screen.getByTestId("dag-node-capobj:cf-cap-yield-variance:OBJ-1")).toBeInTheDocument());
    expect(screen.queryByTestId("dag-node-capobj:cf-cap-equipment-oee:OBJ-1")).toBeNull();
  });

  it("SEAM②b 件四 · 兜底态表达强度：引擎回 factorApplied=false → 出**告警条 + 一键回基地级**（不是树底一行小字）", async () => {
    server.use(
      http.post("*/a/v1/solvers/gap_attribution/invoke", async ({ request }) => {
        const body = (await request.json()) as { args?: { scope?: { factorId?: string } } };
        const factorId = body.args?.scope?.factorId;
        return HttpResponse.json({
          data: {
            rootMetric: { key: "seg_attain_ess", name: "储能达成率", unit: "%", target: 100, actual: 72.2, gap: 27.8 },
            totalGap: 27.8,
            // 引擎下发了候选，但这个基地对该因子**没有承载对象** → 点了据实说没细分。
            scope: {
              baseId: "changzhou",
              availableFactors: [{ factorId: "cf-cap-changeover-loss", label: "换型损失", drillType: "EquipmentDowntime", drillField: "durationMin", objectCount: 3 }],
              ...(factorId ? { factorId, factorApplied: false, factorNote: "基地「常州」没有「换型损失」的承载对象——按基地聚合返回，未按该因子细分。" } : {}),
            },
            levels: [
              { depth: 1, label: "基地", residual: 2.1, nodes: [{ id: "base:常州", factor: "基地 常州", contribution: 9.2, unit: "%", share: 0.33 }] },
              { depth: 2, label: "订单/瓶颈", residual: 1.0, nodes: [{ id: "equip:常州", factor: "常州 设备瓶颈", contribution: 4.1, unit: "%", share: 1, path: ["m1", "base:常州", "equip:常州"], provenance: { drillType: "Equipment", drillField: "oee_current", drillValue: 0.78 } }] },
            ],
            causalEdges: [], atomicLeaves: [], reconChecks: [], reconciled: true, residualPct: 12, summary: "储能达成率缺口 27.8%",
          },
          snapshotVersion: "ov-infer",
        });
      }),
    );
    await openChangzhou();
    await screen.findByTestId("rootcause-panel-常州");
    expect(screen.queryByTestId("rootcause-factor-rejected"), "没点因子就报未生效").toBeNull();

    fireEvent.click(await screen.findByTestId("rootcause-factor-cf-cap-changeover-loss"));
    // 件四：必须是用户不可能忽略的形态 —— role=alert 的告警条 + 引擎原话 + 一键回基地级。
    const alert = await screen.findByTestId("rootcause-factor-rejected");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("未按该因子细分");
    expect(alert).toHaveTextContent("没有「换型损失」的承载对象");
    fireEvent.click(screen.getByTestId("rootcause-factor-reset"));
    await waitFor(() => expect(screen.queryByTestId("rootcause-factor-rejected")).toBeNull());
  });

  it("SEAM②c 件三 · 引擎一个可细分因子都不下发 → 据实说明，不画一排点不动的按钮", async () => {
    server.use(
      http.post("*/a/v1/solvers/gap_attribution/invoke", async () =>
        HttpResponse.json({
          data: {
            rootMetric: { key: "seg_attain_ess", name: "储能达成率", unit: "%", target: 100, actual: 72.2, gap: 27.8 },
            totalGap: 27.8,
            scope: { baseId: "changzhou", availableFactors: [], availableFactorsNote: "基地「常州」在产能因子的承载对象上无数据，本页当前无可细分因子。" },
            levels: [
              { depth: 1, label: "基地", residual: 2.1, nodes: [{ id: "base:常州", factor: "基地 常州", contribution: 9.2, unit: "%", share: 0.33 }] },
              { depth: 2, label: "订单/瓶颈", residual: 1.0, nodes: [{ id: "equip:常州", factor: "常州 设备瓶颈", contribution: 4.1, unit: "%", share: 1, path: ["m1", "base:常州", "equip:常州"], provenance: { drillType: "Equipment", drillField: "oee_current", drillValue: 0.78 } }] },
            ],
            causalEdges: [], atomicLeaves: [], reconChecks: [], reconciled: true, residualPct: 12, summary: "储能达成率缺口 27.8%",
          },
          snapshotVersion: "ov-infer",
        })),
    );
    await openChangzhou();
    const none = await screen.findByTestId("rootcause-factor-none");
    expect(none).toHaveTextContent("无可细分因子");
    // 一个因子 chip 都不许渲染（永远不生效的按钮比没有按钮更糟）。
    expect(within(screen.getByTestId("rootcause-factor-scope")).queryAllByTestId(/^rootcause-factor-cf-/).length).toBe(0);
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
