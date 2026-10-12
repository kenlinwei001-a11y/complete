import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { resolveBlockRoute, hasBlockContext, blockTypeRoute } from "../src/router/ceo-route.js";
import { pageContextSummary, buildAgentUser } from "../src/agent/prompts.js";
import type { QueryTask } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN } from "./helpers.js";

/**
 * WO-BLOCK-DIALOGUE SEAM（闭 G-3 块级·数据形状 × 引擎路由 两半接缝）·**真验非 mock**。
 *
 * 病根若拆两半各自绿：前端产 block、后端不按 blockType 路由 / blockData 不进 args·prompt → 块级对话名存实亡。
 * 本 seam 证：① 前端派生的 pageContext.block 形状喂**真** resolveBlockRoute + **真** orchestrator → hasBlockContext 门开、
 * 按 blockType 定向落对应求解器、blockData 真达 extractedSlots + agent prompt；② 改块真实数据 → 推给 agent 的 blockData 变（C4）。
 *
 * 因 contracts-only-shared 跨 app 不可 import 前端 store：此处 `mkBlockPageContext` 逐字段镜像
 * `apps/frontend-shell/src/store/sessionStore.ts` derivePageContext 的 block 分支（buildContext 有活跃块时
 * pageContext.block = activeBlock = {blockId,blockType,blockTitle,blockData=getData(),selection,provenanceRef}）。
 * 前端侧另有 f-block 证 setActiveBlock/buildContext 真产此形状（改块数据→变）——两半合起来即端到端接缝。
 */

/** 镜像 store：有活跃块时 pageContext.block = 捕获的真实数据快照（其余页面级字段照 CEO-6-FE 派生·此处块级测试留空）。 */
function mkBlockPageContext(view: string, block: NonNullable<PageContext["block"]>): PageContext {
  return { view, entities: [], selection: [], drillPath: [], actions: [], block };
}

/** 供需双向块的**真实渲染数据**快照（与 DashboardView SupplyDemandAttributionPanel getData 同形状·需求端 28.5% 等真值）。 */
const SUPPLY_DEMAND_BLOCK: NonNullable<PageContext["block"]> = {
  blockId: "dash-supply-demand",
  blockType: "supply-demand",
  blockTitle: "供需失衡双向归因",
  blockData: {
    metricKey: "seg_attain_ess",
    totalGap: 27.8,
    unit: "万套",
    demandPct: 28.5,
    demandContribution: 7.92,
    supplyPct: 63.2,
    supplyContribution: 17.57,
    residual: 2.31,
    reconciled: true,
  },
  selection: [],
  provenanceRef: "supply_demand_gap_attribution",
};

describe("WO-BLOCK-DIALOGUE SEAM · 块级定向路由 + blockData 真达 agent（闭 G-3 块级）", () => {
  it("C-SEAM 纯函数：blockType 定向映射 + blockData/focus 派生 args（真值·非写死）", () => {
    const pc = mkBlockPageContext("dashboard", SUPPLY_DEMAND_BLOCK);
    expect(hasBlockContext(pc)).toBe(true);
    expect(blockTypeRoute("supply-demand")).toBe("gap_attribution");
    const route = resolveBlockRoute(pc, "ceo");
    expect(route).toBeDefined();
    expect(route!.route).toBe("gap_attribution"); // 按 blockType 定向（非问句关键词）
    expect(route!.usedPageContext).toBe(true);
    expect(route!.args.metricKey).toBe("seg_attain_ess"); // 从 blockData 真值派生
    // blockData 整体作强上下文随 args 留存（供审计 + prompt 锚定·非求解器数学入参）。
    expect(route!.args.blockType).toBe("supply-demand");
    expect(route!.args.blockData).toEqual(SUPPLY_DEMAND_BLOCK.blockData);
  });

  it("C-SEAM 纯函数：blockData 真达 agent prompt——pageContextSummary 展开块内具体数（需求端 28.5% 等·答案可锚定）", () => {
    const pc = mkBlockPageContext("dashboard", SUPPLY_DEMAND_BLOCK);
    const summary = pageContextSummary(pc);
    expect(summary).toContain("供需失衡双向归因"); // 块标题
    expect(summary).toContain("demandPct=28.5"); // 块内真实数（agent 据此针对性答·非泛泛）
    expect(summary).toContain("supplyPct=63.2");
    expect(summary).toContain("totalGap=27.8");
  });

  it("C-SEAM 端到端：块 pageContext 经**真 orchestrator** → hasBlockContext 门开 → 按 blockType 落求解器（deterministic:block-route）", async () => {
    const t = await createTestApp();
    // 问句故意用"这块什么情况"泛问——路由由 blockType 决定（非关键词），证块是意图锚。
    const pc = mkBlockPageContext("dashboard", SUPPLY_DEMAND_BLOCK);
    const { taskId, statusCode } = await submitQuery(t, ADMIN, "这块什么情况", { view: "dashboard", pageContext: pc });
    expect(statusCode).toBe(202);
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.classification?.model).toBe("deterministic:block-route"); // 块级定向路由（非 LLM/CEO 问句/兜底）
    expect(task.matchedIntent?.intentKey).toBe("ceo_root_cause"); // supply-demand → gap_attribution → ceo_root_cause
    expect(task.slots?.metricKey).toBe("seg_attain_ess"); // 块数据派生 args 真达 path A 求解器
    // blockData 真达后端并记录（classification.extractedSlots 持久化·证块真实数据真达 orchestrator）。
    expect(task.classification?.extractedSlots.blockData).toEqual(SUPPLY_DEMAND_BLOCK.blockData);
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0); // 出答案（锚该块）
    await t.app.close();
  });

  it("C-SEAM 端到端：blockType 决定求解器——metric-strip→ceo_metric·decision-options→ceo_decision（同泛问不同块→不同求解器）", async () => {
    const t = await createTestApp();
    const metricBlock = mkBlockPageContext("dashboard", {
      blockId: "metric-strip", blockType: "metric-strip", blockTitle: "经营指标条",
      blockData: { metricKey: "op_revenue", metrics: [{ metricId: "op_revenue", miss: true }], missCount: 1 }, selection: [],
    });
    const optionsBlock = mkBlockPageContext("decision-play", {
      blockId: "dp-options", blockType: "decision-options", blockTitle: "对症方案区",
      blockData: { metricKey: "seg_attain_ess", factorId: "cf-cathode-shortage", count: 3 }, selection: ["cf-cathode-shortage"],
    });
    const r1 = await submitQuery(t, ADMIN, "这块什么情况", { view: "dashboard", pageContext: metricBlock });
    const r2 = await submitQuery(t, ADMIN, "这块什么情况", { view: "decision-play", pageContext: optionsBlock });
    const task1 = await waitForTask(t, r1.taskId);
    const task2 = await waitForTask(t, r2.taskId);
    expect(task1.matchedIntent?.intentKey).toBe("ceo_metric"); // metric-strip → metric_rollup
    expect(task2.matchedIntent?.intentKey).toBe("ceo_decision"); // decision-options → decision_play
    expect(task2.slots?.factorId).toBe("cf-cathode-shortage"); // 块内 selection 驱动 factorId
    await t.app.close();
  });

  it("C4 seam red-bite：改块真实数据 → 推给 agent 的 blockData 变（extractedSlots.blockData + prompt 均随之变）", async () => {
    const t = await createTestApp();
    const block1 = { ...SUPPLY_DEMAND_BLOCK, blockData: { ...SUPPLY_DEMAND_BLOCK.blockData, demandPct: 28.5 } };
    const block2 = { ...SUPPLY_DEMAND_BLOCK, blockData: { ...SUPPLY_DEMAND_BLOCK.blockData, demandPct: 51.4 } };
    const r1 = await submitQuery(t, ADMIN, "这块什么情况", { view: "dashboard", pageContext: mkBlockPageContext("dashboard", block1) });
    const r2 = await submitQuery(t, ADMIN, "这块什么情况", { view: "dashboard", pageContext: mkBlockPageContext("dashboard", block2) });
    const task1 = await waitForTask(t, r1.taskId);
    const task2 = await waitForTask(t, r2.taskId);
    expect((task1.classification?.extractedSlots.blockData as Record<string, unknown>).demandPct).toBe(28.5);
    expect((task2.classification?.extractedSlots.blockData as Record<string, unknown>).demandPct).toBe(51.4);
    // prompt 侧同验：改数据 → agent prompt 里的块真实数变（答案锚定的具体数随之变·有牙）。
    const s1 = pageContextSummary(mkBlockPageContext("dashboard", block1));
    const s2 = pageContextSummary(mkBlockPageContext("dashboard", block2));
    expect(s1).toContain("demandPct=28.5");
    expect(s2).toContain("demandPct=51.4");
    expect(s1).not.toBe(s2);
    await t.app.close();
  });

  it("C5 退化（不破 CEO-6-FE·诚实）：无活跃块 → hasBlockContext 假·不走 block-route（退页面级 CEO 问句路由）", async () => {
    const noBlock: PageContext = { view: "gap-waterfall", entities: [{ type: "Metric", id: "seg_attain_ess", label: "储能达成率", drillRef: "seg_attain_ess" }], selection: ["seg_attain_ess"], drillPath: [], actions: [], focus: { metric: "seg_attain_ess" } };
    expect(hasBlockContext(noBlock)).toBe(false);
    expect(resolveBlockRoute(noBlock, "ceo")).toBeUndefined();
    const t = await createTestApp();
    const { taskId } = await submitQuery(t, ADMIN, "储能为什么没达标", { view: "gap-waterfall", pageContext: noBlock });
    const task = await waitForTask(t, taskId);
    expect(task.classification?.model).not.toBe("deterministic:block-route"); // 无块 → 不走块级路由
    expect(task.classification?.model).toBe("deterministic:ceo-route"); // 退化为页面级 CEO 深问（CEO-6 原路·未破）
    await t.app.close();
  });

  it("未登记 blockType → resolveBlockRoute undefined（不劫持·退化）", () => {
    const pc = mkBlockPageContext("dashboard", { blockId: "x", blockType: "unknown-block", blockTitle: "X", blockData: {}, selection: [] });
    expect(blockTypeRoute("unknown-block")).toBeUndefined();
    expect(resolveBlockRoute(pc, "ceo")).toBeUndefined();
  });

  it("buildAgentUser 注入块上下文（path-B agent 自由推理同源·全知在哪块看什么真数据）", () => {
    const task = {
      query: "这块什么情况",
      context: { view: "dashboard", selectedObjects: [], filters: {}, pageContext: mkBlockPageContext("dashboard", SUPPLY_DEMAND_BLOCK) },
    } as unknown as QueryTask;
    const user = buildAgentUser(task);
    expect(user).toContain("当前深问块: 供需失衡双向归因");
    expect(user).toContain("demandPct=28.5");
  });
});
