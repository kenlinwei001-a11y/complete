import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";

/**
 * SEAM-GATE（AgentCore 半）：PRD-CAP-DEMANDDELTA 后，capacity_feasibility 计划渲染
 * 单位统一为「万套」、带 effectiveDemand、provenance 携带 formula/valueLabel。
 * Mock DataCore 形态与真 DataCore 输出对齐（同字段名），任一半缺字段都会让模板解析失败 → 红。
 */
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("PRD-CAP-DEMANDDELTA · capacity_feasibility SEAM", () => {
  it("渲染 KPI 单位为万套且含有效需求；provenance 命中 formula/valueLabel", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.92 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6 },
    });
    const { taskId } = await submitQuery(t, PLANNER, "4680-NCM 加 20% 六周能不能接？", { view: "dash" });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("WORKFLOW");

    const kpis = task.answer?.blocks.filter((b) => b.type === "kpi") ?? [];
    const units = new Map(kpis.filter((b) => b.type === "kpi").map((b) => [b.label, b.unit]));
    expect(units.get("P50 产能")).toBe("万套");
    expect(units.get("P90 产能")).toBe("万套");
    expect(units.get("有效需求")).toBe("万套");

    const prov = task.answer?.provenance ?? [];
    const p50Prov = prov.find((p) => p.outputPath === "$.data.p50");
    const edProv = prov.find((p) => p.outputPath === "$.data.effectiveDemand");
    expect(p50Prov?.formula).toContain("weeklyCap");
    expect(p50Prov?.valueLabel).toContain("P50");
    expect(edProv?.formula).toContain("demandDelta");
    expect(edProv?.valueLabel).toContain("有效需求");
  });

  it("demandDelta=0.6 仍被 C03 BLOCK，不进入 KPI 渲染", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.92 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM", demandDelta: 0.6, weeks: 6 },
    });
    const { taskId } = await submitQuery(t, PLANNER, "4680-NCM 加 60% 六周能不能接？", { view: "dash" });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.answer?.blocks.some((b) => b.type === "kpi")).toBe(false);
    const violation = task.answer?.blocks.find((b) => b.type === "rule_violation");
    expect(violation?.type === "rule_violation" && violation.ruleId).toBe("C03");
  });
});
