import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { decideTriggerBoundary, triggerDimensions } from "../src/growth/data-boundary.js";
import type { TriggerBoundaryDecision, GrowthRunReport } from "@platform/contracts";

/**
 * FILL-BOUNDARY-GUARDRAIL（用户钉「触发补数据必须有边界·否则任意问题自由补数据=数据混乱」）。
 * 三闸 teeth：B1 槽位完备（未接地先澄清·非直接触发）/ B2 模式封闭（枚举越界拒）/ B3 越界（词表外新实体→DataRequest+R4）。
 * 复现用户泛问题「本月库存水位是否可以降低？」（无月份/型号/仓类/物料）→ 必先澄清，绝不直接触发合成。
 */
const H = { "x-debug-user": PLANNER, "content-type": "application/json" };
const VAGUE = "本月库存水位是否可以降低？";

type GateResp = { boundaryGate: TriggerBoundaryDecision; worklistItem?: { id: string; fillPlan?: { mode: string; action: string } } };

describe("FILL-BOUNDARY-GUARDRAIL · 触发补数据三闸", () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it("B1 · 泛问题无槽位 → 先澄清（CLARIFY·非直接触发）·不合成·不落账本 [teeth]", async () => {
    const res = await t.app.inject({
      method: "POST", url: "/api/v1/growth/run", headers: H,
      payload: { packageId: "pkg_battery_manufacturing", query: VAGUE, context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 2 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GateResp;
    // 关键 teeth：未先澄清即直接触发 = 数据混乱 → 必须回 CLARIFY（非 GrowthRunReport）。revert B1 → 直接跑 loop 出 terminalState → 本断言红。
    expect(body).toHaveProperty("boundaryGate");
    expect(body.boundaryGate.outcome).toBe("CLARIFY");
    expect((body.boundaryGate.missingSlots ?? []).length).toBeGreaterThan(0);
    expect(body.boundaryGate.round).toBe(1);
    expect(body.boundaryGate.maxRounds).toBe(2);
    expect(body).not.toHaveProperty("terminalState");
    // 未合成：账本零条（growth/run 在 CLARIFY 前返回，绝不进 LOOP/合成）。
    const ledger = (await t.app.inject({ method: "GET", url: "/api/v1/growth/ledger", headers: H }).then((r) => r.json())) as { items: unknown[] };
    expect(ledger.items.length).toBe(0);
  });

  it("B1 · 补齐定位槽位 → 生成计划预览（PREVIEW·人确认才跑）→ confirmed 才真跑", async () => {
    // 澄清回填 base=常州（注册表既有）→ 已接地 → PREVIEW（不直接跑）。
    const preview = await t.app.inject({
      method: "POST", url: "/api/v1/growth/run", headers: H,
      payload: { packageId: "pkg_battery_manufacturing", query: VAGUE, context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 2, slotValues: { base: "常州" } },
    });
    const pv = preview.json() as GateResp;
    expect(pv.boundaryGate.outcome).toBe("PREVIEW");
    expect(pv.boundaryGate.plan).toBeDefined();
    expect(pv.boundaryGate.plan!.origin).toBe("SYNTHETIC");
    expect(pv.boundaryGate.plan!.provisional).toBe(true);
    // 值域来源接地注册表；有界枚举取注册表既有值（不发明）。
    expect(pv.boundaryGate.plan!.boundedEnums.find((e) => e.field === "base")?.values).toContain("常州");

    // 人确认（confirmed:true）→ 真跑 LOOP → 返回 GrowthRunReport（terminalState 存在）。
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [text("探索"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "x" }], provenance: [] })] });
    const run = await t.app.inject({
      method: "POST", url: "/api/v1/growth/run", headers: H,
      payload: { packageId: "pkg_battery_manufacturing", query: VAGUE, context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 1, slotValues: { base: "常州" }, confirmed: true },
    });
    const report = run.json() as GrowthRunReport;
    expect(report.terminalState).toBeDefined();
    expect(["CONVERGED", "BOUNDARY", "MAX_ROUNDS", "NEEDS_HUMAN"]).toContain(report.terminalState);
  });

  it("B3 · 枚举越界（词表外新实体）→ HARD_BLOCK 拒·出 DataRequest 要求数据描述（confirmed 也不放行）[teeth]", async () => {
    for (const confirmed of [false, true]) {
      const res = await t.app.inject({
        method: "POST", url: "/api/v1/growth/run", headers: H,
        payload: { packageId: "pkg_battery_manufacturing", query: VAGUE, context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 1, slotValues: { base: "火星基地" }, confirmed },
      });
      const body = res.json() as GateResp;
      expect(body.boundaryGate.outcome).toBe("HARD_BLOCK");
      expect(body.boundaryGate.dataRequest?.newEntity).toBe(true);
      expect(body.boundaryGate.dataRequest?.descriptionRequired).toBe(true);
      expect((body.boundaryGate.dataRequest?.descriptionSchema ?? []).length).toBeGreaterThan(0);
      // 越界恒不合成（即便 confirmed:true 也不放行·新实体不得自动合成）。
      expect(body).not.toHaveProperty("terminalState");
    }
    const ledger = (await t.app.inject({ method: "GET", url: "/api/v1/growth/ledger", headers: H }).then((r) => r.json())) as { items: unknown[] };
    expect(ledger.items.length).toBe(0);
  });

  it("B3 · 人工输入数据描述 → 登记 HARD 在办项（importData·待 R4 正门·可追溯）", async () => {
    const res = await t.app.inject({
      method: "POST", url: "/api/v1/growth/run", headers: H,
      payload: { packageId: "pkg_battery_manufacturing", query: VAGUE, context: { view: "dash", selectedObjects: [], filters: {} }, slotValues: { base: "火星基地" }, dataRequestDescription: "字段: id/name/capacity; 值域: GWh; 样例: mars-1,火星基地,10" },
    });
    const body = res.json() as GateResp;
    expect(body.boundaryGate.outcome).toBe("HARD_BLOCK");
    expect(body.boundaryGate.dataRequest?.description).toContain("火星基地");
    expect(body.worklistItem).toBeDefined();
    expect(body.worklistItem!.fillPlan?.mode).toBe("HARD");
    expect(body.worklistItem!.fillPlan?.action).toBe("importData");
  });
});

describe("FILL-BOUNDARY-GUARDRAIL · decideTriggerBoundary 纯函数确定性（R6）", () => {
  const base = {
    contextText: "",
    providedSlots: {} as Record<string, unknown>,
    dimensions: triggerDimensions(),
    publishedTypes: ["Base", "Order", "Model"],
    targetTypeKey: "Object",
    targetIsExplicitType: false,
  };

  it("同问句同槽位 → 同判（确定性）", () => {
    const a = decideTriggerBoundary({ question: VAGUE, ...base });
    const b = decideTriggerBoundary({ question: VAGUE, ...base });
    expect(a).toEqual(b);
    expect(a.outcome).toBe("CLARIFY");
  });

  it("问句命中注册表实体（常州）→ 已接地 → PREVIEW", () => {
    const d = decideTriggerBoundary({ question: "常州基地库存能降吗", ...base });
    expect(d.outcome).toBe("PREVIEW");
  });

  it("显式目标类型不在已发布 schema → HARD_BLOCK（B2 模式封闭·新类型）", () => {
    const d = decideTriggerBoundary({ question: "常州库存", ...base, targetTypeKey: "火星舱", targetIsExplicitType: true });
    expect(d.outcome).toBe("HARD_BLOCK");
    expect(d.dataRequest?.newEntity).toBe(true);
  });

  it("枚举有界字段值域全取注册表既有（R14·不含硬编码实体）", () => {
    const dims = triggerDimensions();
    const baseDim = dims.find((x) => x.slot === "base");
    expect(baseDim?.enumValues).toContain("常州");
    expect(baseDim?.enumValues).not.toContain("火星基地");
  });
});
