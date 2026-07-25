import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-GRAY-NODE-AUTOFILL · SEAM（灰节点从"诚实灰终点"变"自动补齐起点"·前端触发+重渲染半）：
 * 产能推演灰节点（EMPTY_DATA 时序维度·物流时长/设备OEE 逐日）旁给"补此维度数据"入口 →
 * probe 诊断 gapCode → run 探针→补齐→重跑闭环 → 据引擎 fillApplied.fillMode 重渲染：
 *   ① SOFT（无具体业务实体·引擎合成）→ 灰变 PROVISIONAL 有数（标"未接实测"·断言 DOM 真变·非恒灰）。
 *   ② HARD（真实基地实体·引擎出 DataRequest）→ 显精确 DataRequest（断言不显 LIVE/实测·不静默合成）。
 * 接缝声明：引擎侧（decideDataGap 时序 HARD/SOFT · scenario-grow fill · detectTimeseries）在 base
 * (databuilder-harness) 已落；本单前端触发+重渲染半；SEAM 用 MSW 桩喂**真引擎响应形状**（GapReport /
 * GrowthRunReport · fillApplied.fillMode / dataRequest）。三单合并态（databuilder-harness + 本单 + 上游
 * 路由）跑真端到端；此处以显式 mock 驱动前端接线断裂（KILL-MOCK：真实体只显 DataRequest·永不 LIVE）。
 */
describe("§GRAY-NODE-AUTOFILL SEAM · 灰节点触发补齐 → 据引擎 SOFT/HARD 重渲染", () => {
  // ── SEAM ①：SOFT（无具体实体·合成基地）→ 灰节点从诚实灰升级为 PROVISIONAL 有数（标未接实测·DOM 真变）。
  it("① 灰 EMPTY_DATA 节点（合成基地·物流时长）→ 触发补齐 → 变 PROVISIONAL 有数（标未接实测·非恒灰·不冒充 LIVE/实测）", async () => {
    const user = userEvent.setup();
    server.use(
      // 单卡·非真实业务实体基地（不在 BASE_REGISTRY）→ 该维度时序问句无实体命中 → 引擎判 SOFT。
      http.post("*/a/v1/solvers/risk_timeline/invoke", () =>
        HttpResponse.json({
          data: {
            horizon: 30, threshold: 85,
            cards: [{
              base: "合成基地", baseId: "synbase", factor: "化成柜张力", peak: 96, crossDay: 5,
              series: Array.from({ length: 30 }, (_, i) => Math.min(96, 50 + i * 2)),
              events: [], provenanceSynthetic: true, affectedOrders: [],
            }],
            planRows: [],
          }, snapshotVersion: "ov-syn",
        }),
      ),
      // bottleneck_matrix：合成基地的"物流时长"张力 ≥ 阈值−15（=70）→ 进 others 灰行（无逐日源）。
      http.post("*/a/v1/solvers/bottleneck_matrix/invoke", () =>
        HttpResponse.json({
          data: {
            dataMode: "MOCK", factors: ["物流时长", "设备OEE", "瓶颈工序"],
            rows: [{ base: "合成基地", primary: "物流时长", tightness: { 物流时长: 80, 设备OEE: 62, 瓶颈工序: 60 } }],
          }, snapshotVersion: "ov-12",
        }),
      ),
      // 探针：该维度时序 → EMPTY_DATA（真引擎 GapReport 形状）。
      http.post("*/b/v1/growth/probe", async ({ request }) => {
        const b = (await request.json()) as { query: string };
        return HttpResponse.json({
          question: b.query, taskId: "gtask_gray", verdict: "BLOCKED", path: "WORKFLOW",
          findings: [{ gapCode: "EMPTY_DATA", atStep: "resolve_slice", evidence: "切片/查询返回空集（该维度逐日时序未接地）", suggestedFill: "真人正门/合成", blocking: true }],
          generatedAt: "2026-06-17T00:00:00Z",
        });
      }),
      // 补齐闭环：无具体实体 → SOFT（引擎合成 PROVISIONAL 逐日时序·真 GrowthRunReport 形状·fillMode:SOFT）。
      http.post("*/b/v1/growth/run", async ({ request }) => {
        const b = (await request.json()) as { query: string; maxRounds?: number };
        return HttpResponse.json({
          question: b.query, maxRounds: b.maxRounds ?? 4,
          rounds: [{ round: 1, gapReport: { question: b.query, taskId: "gtask_gray", verdict: "ANSWERABLE", path: "WORKFLOW", findings: [], generatedAt: "2026-06-17T00:00:00Z" }, fillApplied: { gapCode: "EMPTY_DATA", action: "SOFT 缺数据 → 经管线确定性合成 PROVISIONAL 逐日时序（未接实测，业务真值待接实测覆盖）", advanced: true, fillMode: "SOFT" } }],
          terminalState: "CONVERGED", openTickets: [], generatedAt: "2026-06-17T00:00:00Z",
        });
      }),
    );

    loginAs("planner");
    renderApp("/v/risk");

    // 展开合成基地卡 → 内联详情 → 灰时序维度行（物流时长·无逐日实测源）。
    const card = await screen.findByTestId("risk-card-合成基地");
    await user.click(card);

    // 补齐前：诚实灰（data-phase=idle·非有数）。
    const grayNode = await screen.findByTestId("gray-node-物流时长");
    expect(grayNode).toHaveAttribute("data-phase", "idle");
    expect(grayNode).toHaveTextContent("无逐日实测源");

    // 触发补齐（admin 可点）。
    await user.click(within(grayNode).getByTestId("gray-fill-cta-物流时长"));

    // 重渲染：灰 → PROVISIONAL 有数（DOM 真变·data-phase=soft）。
    const soft = await screen.findByTestId("gray-fill-soft-物流时长");
    expect(soft).toHaveTextContent("PROVISIONAL");
    expect(soft).toHaveTextContent("未接实测");
    // DOM 真变（非恒灰）：节点相位从 idle → soft。
    expect(await screen.findByTestId("gray-node-物流时长")).toHaveAttribute("data-phase", "soft");
    // 诚实红线：SOFT 补齐产物绝不冒充实测/LIVE。
    expect(soft).not.toHaveTextContent("LIVE");
    expect(soft).not.toHaveTextContent("实测当前");
  });

  // ── SEAM ②：HARD（真实基地实体·常州）→ 只显精确 DataRequest（不显 LIVE/实测·不静默合成）。
  it("② 真实基地实体（常州·设备OEE）→ HARD 显精确 DataRequest（须导入·不显 LIVE/实测·不静默合成）", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/a/v1/solvers/risk_timeline/invoke", () =>
        HttpResponse.json({
          data: {
            horizon: 30, threshold: 85,
            cards: [{
              base: "常州", baseId: "changzhou", factor: "化成柜张力", peak: 96, crossDay: 5,
              series: Array.from({ length: 30 }, (_, i) => Math.min(96, 50 + i * 2)),
              events: [], affectedOrders: [],
            }],
            planRows: [],
          }, snapshotVersion: "ov-cz",
        }),
      ),
      http.post("*/a/v1/solvers/bottleneck_matrix/invoke", () =>
        HttpResponse.json({
          data: {
            dataMode: "MOCK", factors: ["设备OEE", "物流时长", "瓶颈工序"],
            rows: [{ base: "常州", primary: "设备OEE", tightness: { 设备OEE: 88, 物流时长: 60, 瓶颈工序: 61 } }],
          }, snapshotVersion: "ov-12",
        }),
      ),
      http.post("*/b/v1/growth/probe", async ({ request }) => {
        const b = (await request.json()) as { query: string };
        return HttpResponse.json({
          question: b.query, taskId: "gtask_gray", verdict: "BLOCKED", path: "WORKFLOW",
          findings: [{ gapCode: "EMPTY_DATA", evidence: "切片返回空集", suggestedFill: "真人正门导入", blocking: true }],
          generatedAt: "2026-06-17T00:00:00Z",
        });
      }),
      // 补齐闭环：真实业务实体（常州）→ HARD（出精确 DataRequest·绝不静默合成·真 GrowthRunReport 形状）。
      http.post("*/b/v1/growth/run", async ({ request }) => {
        const b = (await request.json()) as { query: string; maxRounds?: number };
        const dataRequest = {
          typeKey: "Equipment",
          columns: ["ts（时间戳/日期·逐日）", "value（该实体逐日度量值·随时间变化）"],
          entities: ["常州"],
          reason: "问句涉及真实业务实体「常州」——自动合成将造业务事实；须经真人正门（连接器导入 / Excel 上传 → Action 审批）补真实数据，不静默合成（时序维度：须补真实逐日时序——时间戳+度量列，绝不伪造真实体时序）",
        };
        return HttpResponse.json({
          question: b.query, maxRounds: b.maxRounds ?? 4,
          rounds: [{ round: 1, gapReport: { question: b.query, taskId: "gtask_gray", verdict: "BLOCKED", path: "WORKFLOW", findings: [{ gapCode: "EMPTY_DATA", evidence: "切片返回空集", suggestedFill: "真人正门导入", blocking: true }], generatedAt: "2026-06-17T00:00:00Z" }, fillApplied: { gapCode: "EMPTY_DATA", action: "HARD 缺真实业务数据（常州·逐日时序）→ 真人正门导入，不静默合成", advanced: false, fillMode: "HARD", dataRequest, ticket: { gapCode: "EMPTY_DATA", detail: dataRequest.reason } } }],
          terminalState: "BOUNDARY", openTickets: [{ gapCode: "EMPTY_DATA", detail: dataRequest.reason }], generatedAt: "2026-06-17T00:00:00Z",
        });
      }),
    );

    loginAs("planner");
    renderApp("/v/risk");

    const card = await screen.findByTestId("risk-card-常州");
    await user.click(card);

    const grayNode = await screen.findByTestId("gray-node-设备OEE");
    expect(grayNode).toHaveAttribute("data-phase", "idle");
    await user.click(within(grayNode).getByTestId("gray-fill-cta-设备OEE"));

    // 重渲染：HARD → 精确 DataRequest（DOM 真变·data-phase=hard）。
    const hard = await screen.findByTestId("gray-fill-hard-设备OEE");
    expect(hard).toHaveTextContent("需导入真实数据");
    // 精确 DataRequest：对象类型 + 实体（常州）+ 须补列。
    expect(within(hard).getByTestId("gray-fill-hard-type-设备OEE")).toHaveTextContent("Equipment");
    expect(hard).toHaveTextContent("常州");
    expect(hard).toHaveTextContent("须补列");
    // KILL-MOCK 命门：HARD 只显 DataRequest·不显 LIVE/实测·不静默合成。
    expect(hard).not.toHaveTextContent("LIVE");
    expect(hard).not.toHaveTextContent("实测");
    expect(hard).toHaveTextContent("不静默合成");
    // DOM 真变（非恒灰）：节点相位 idle → hard。
    expect(await screen.findByTestId("gray-node-设备OEE")).toHaveAttribute("data-phase", "hard");
  });
});
