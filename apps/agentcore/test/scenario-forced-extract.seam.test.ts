import { describe, expect, it } from "vitest";
import { normalizeObjectRefKey } from "@platform/contracts";
import { createTestApp, debugHeaders, waitForTask, PLANNER, type TestApp } from "./helpers.js";

/**
 * WO-SCENARIO-FORCED-EXTRACT · SEAM-GATE：forced（scenarioIntentKey 确定性绑定）分支必须解析自由文本。
 *
 * 病灶：前端场景启动器卡片输入框/CLI/对话坞直打 /api/v1/queries（不走 /b/v1/scenarios/:key/launch），
 * forced 分支 fillSlots/proceedWithIntent 的 extracted 恒 {} → fillSlots 内建「extracted > presetSlots」
 * 优先级拿不到任何抽取值 → 自由文本被吞：「…常州基地能不能接？」与「…能不能接？」同答案（恒全网合计）。
 *
 * 本测试复刻前端**精确载荷**（presetSlots + scenarioIntentKey + selectedObjects 直打 /api/v1/queries），
 * 断言用户实际点的那条路解析对了——不是运输层端点通了就算通：
 *   1) 问句带「常州基地」→ capacity_forecast args.base = "changzhou"（scope:BASE 单基地口径）；
 *   2) 原问句 → args.base 为空（scope:ALL 全网合计·不回归）；
 *   3) 两问句 P50 不同（语义真达成，不是"参数到达了"就算通）。
 * 变异反证：把 forced 分支 extracted 改回 {}，本测试必须变红（断言 1/3 同时失守）。
 */

/** 前端 useQuickLaunch 提交的精确 context（S01 卡 presetContext + scenarioIntentKey）。 */
const FRONTEND_CTX = {
  view: "project",
  selectedObjects: [{ objectType: "Model", objectId: "4680-NCM", label: "4680-NCM" }],
  filters: {},
  presetSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6 },
  scenarioIntentKey: "capacity_feasibility",
};

async function submitFrontendPayload(t: TestApp, query: string) {
  const res = await t.app.inject({
    method: "POST",
    url: "/api/v1/queries",
    headers: debugHeaders(PLANNER),
    payload: { packageId: "pkg_battery_manufacturing", query, context: FRONTEND_CTX },
  });
  expect(res.statusCode).toBe(202);
  const { taskId } = res.json() as { taskId: string };
  const task = await waitForTask(t, taskId);
  expect(task.status).toBe("COMPLETED");

  const calls = await t.repos.toolCalls.listByTask(taskId);
  const cf = calls.find((c) => {
    const input = c.input as { solverKey?: string } | undefined;
    return input?.solverKey === "capacity_forecast";
  });
  expect(cf).toBeTruthy();
  const cfArgs = (cf!.input as { args: Record<string, unknown> }).args;
  const p50Block = (task.answer?.blocks ?? []).find(
    (b) => b.type === "kpi" && (b as { label?: string }).label === "P50 产能",
  ) as { value?: string } | undefined;
  return { task, cfArgs, capWanP50: p50Block?.value };
}

describe("WO-SCENARIO-FORCED-EXTRACT · forced 分支自由文本解析 seam", () => {
  it("「常州基地能不能接」→ base=changzhou；「能不能接」→ 无 base（全网）；两问句 P50 不同", async () => {
    const t = await createTestApp();

    const withBase = await submitFrontendPayload(t, "4680-NCM 加 20% 六周交付，常州基地能不能接？");
    const plain = await submitFrontendPayload(t, "4680-NCM 加 20% 六周能不能接？");

    // ① 自由文本里的基地被解析进 solver 入参（单基地口径）。
    //    WO-BASE-SLOT-UNIFY §A：base 槽已由 `type:"string"` 统一为 `objectRef`+`refType:"Base"`
    //    （同一概念此前两种槽类型 = `G-BASE-SLOT-TYPE-SPLIT`），故这里到达 solver 的是**解析后的
    //    对象引用**而不再是裸串 —— 这是**更强**的形态：它证明 `changzhou` 真在本体里解析到了对象，
    //    而不只是把一个字符串搬了过去。归一走 contracts 单一出处（DataCore `normalizeBaseRef` 同款）。
    expect(withBase.cfArgs.base).toMatchObject({ objectType: "Base", objectId: "base_changzhou" });
    expect(normalizeObjectRefKey(withBase.cfArgs.base, "Base")).toBe("changzhou");
    // ② 原问句无基地 → 槽为空 → scope:ALL 全网合计（不回归·诚实标）。
    expect(plain.cfArgs.base === undefined || plain.cfArgs.base === null).toBe(true);
    // 共有入参一致（同型号/同增量/同周数），唯一变量是 base——排除他因致差。
    expect(withBase.cfArgs.modelId).toBe(plain.cfArgs.modelId);
    expect(withBase.cfArgs.demandDelta).toBe(plain.cfArgs.demandDelta);

    // ③ 语义达成：两问句答案必须真不同（生产实测 常州 5.5176 ≠ 全网 12.3016；测试环境 mock 金值
    // 常州 24.2（仅常州 24GWh）≠ 全网 74.7（常州+宜宾+溧阳 74GWh），钉死防静默回归）。
    expect(withBase.capWanP50).toBeTruthy();
    expect(plain.capWanP50).toBeTruthy();
    expect(withBase.capWanP50).not.toBe(plain.capWanP50);
    expect(Number(withBase.capWanP50)).toBeCloseTo(24.2, 1);
    expect(Number(plain.capWanP50)).toBeCloseTo(74.7, 1);

    await t.app.close();
  });
});
