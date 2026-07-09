import { beforeEach, describe, expect, it } from "vitest";
import type { QueryTask } from "@platform/contracts";
import { classifyGap } from "../src/growth/probe.js";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";

/**
 * 自成长发动机 P1：QOS 缺口探针 classifyGap —— 把终态 QueryTask 映射为结构化 GapReport（PRD §5）。
 */
const base = (over: Partial<QueryTask>): QueryTask => ({
  id: "task_x", tenantId: "demo", userId: "u", packageId: "pkg", conversationId: "c",
  query: "q", context: { view: "dash", selectedObjects: [], filters: {} }, status: "COMPLETED",
  clarificationRounds: 0, createdAt: "2026-06-17T00:00:00Z", ...over,
});

describe("classifyGap · 终态→缺口分类", () => {
  it("路径A + VERIFIED + 承载数据块（kpi）→ ANSWERABLE 无缺口", () => {
    const r = classifyGap(base({ path: "WORKFLOW", answer: { trustLevel: "VERIFIED_WORKFLOW", blocks: [{ type: "kpi", label: "可承接", value: 1 } as never], provenance: [], unverifiedNumerics: false } }));
    expect(r.verdict).toBe("ANSWERABLE");
    expect(r.findings).toHaveLength(0);
  });

  it("路径A + VERIFIED 但仅纯文本无承载数据（空投影）→ EMPTY_DATA BLOCKED（诚实门，不假收敛 G-9）", () => {
    const r = classifyGap(base({ path: "WORKFLOW", answer: { trustLevel: "VERIFIED_WORKFLOW", blocks: [{ type: "text", markdown: "可接" }], provenance: [], unverifiedNumerics: false } }));
    expect(r.verdict).toBe("BLOCKED");
    expect(r.findings[0]!.gapCode).toBe("EMPTY_DATA");
  });

  it("路径A + VERIFIED + 带 ⟦ref:⟧ 溯源文本 → 视为承载数据 → ANSWERABLE", () => {
    const r = classifyGap(base({ path: "WORKFLOW", answer: { trustLevel: "VERIFIED_WORKFLOW", blocks: [{ type: "text", markdown: "可接 ⟦ref:Order.gapTon⟧" }], provenance: [], unverifiedNumerics: false } }));
    expect(r.verdict).toBe("ANSWERABLE");
  });

  it("WORKFLOW_ONLY「请换个问法」兜底 → NO_INTENT BLOCKED", () => {
    const r = classifyGap(base({ path: "WORKFLOW", answer: { trustLevel: "VERIFIED_WORKFLOW", blocks: [{ type: "text", markdown: "请换个问法。本入口仅支持…" }], provenance: [], unverifiedNumerics: false } }));
    expect(r.verdict).toBe("BLOCKED");
    expect(r.findings[0]!.gapCode).toBe("NO_INTENT");
  });

  it("FAILED PLAN_NOT_FOUND → NO_PLAN", () => {
    const r = classifyGap(base({ status: "FAILED", path: "WORKFLOW", error: { code: "PLAN_NOT_FOUND", message: "plan not found: x" } }));
    expect(r.findings[0]!.gapCode).toBe("NO_PLAN");
  });

  it("FAILED solver 错误 → SOLVER_NOT_FOUND", () => {
    const r = classifyGap(base({ status: "FAILED", path: "WORKFLOW", error: { code: "TOOL_ERROR", message: "solver capacity_x not registered", stepId: "s2" } }));
    expect(r.findings[0]!.gapCode).toBe("SOLVER_NOT_FOUND");
    expect(r.findings[0]!.atStep).toBe("s2");
  });

  it("FAILED 模板解析 → SHAPE_MISMATCH", () => {
    const r = classifyGap(base({ status: "FAILED", path: "WORKFLOW", error: { code: "TEMPLATE_RESOLUTION_ERROR", message: "steps.s2.output.gapPct undefined" } }));
    expect(r.findings[0]!.gapCode).toBe("SHAPE_MISMATCH");
  });

  it("路径B + outOfCatalog → NO_INTENT BOUNDARY（已探索答出，非硬阻塞）", () => {
    const r = classifyGap(base({ path: "AGENT", classification: { candidates: [], outOfCatalog: true, extractedSlots: {}, latencyMs: 1, model: "m" }, answer: { trustLevel: "AGENT_EXPLORATORY", blocks: [], provenance: [], unverifiedNumerics: false } }));
    expect(r.verdict).toBe("BOUNDARY");
    expect(r.findings[0]!.gapCode).toBe("NO_INTENT");
    expect(r.findings[0]!.blocking).toBe(false);
  });

  // ── GAP-ACTIONABLE 齿（PRD §3.4·修 P3 用户实测痛点「常州基地的瓶颈是?」→工单看不到补什么/在哪补）──
  it("齿：FAILED LLM_PURPOSE_UNBOUND → actionable gap（非 OTHER·非「人工核实内部错误」·suggestedFill 含真修法）", () => {
    // 真实 evidence：orchestrator sanitizeLlmAuthLeak 归一码（用户实测「常州基地的瓶颈是?」终态即此）。
    const r = classifyGap(base({
      query: "常州基地的瓶颈是?", status: "FAILED", path: "WORKFLOW",
      error: { code: "LLM_PURPOSE_UNBOUND", message: "LLM 调用未成功：未绑定任何 LLM 用途，或已绑定 provider 的密钥无效/不可达。请在 设置→LLM 用途绑定 确认已绑 provider 且密钥有效——绑定任一大类即覆盖全部用途，无需逐意图单独绑定。", stepId: "classify" },
    }));
    const f = r.findings[0]!;
    expect(f.gapCode).toBe("LLM_PURPOSE_UNBOUND"); // 入正式码表，不再拍 OTHER
    expect(f.gapCode).not.toBe("OTHER");
    // 保留 evidence 原文（具体可行动错因不丢真相）：
    expect(f.evidence).toContain("设置→LLM 用途绑定");
    // 派生 what/where/acceptance（缺什么·补在哪·验收=本问句 E2E 答出）：
    expect(f.what).toBeTruthy();
    expect(f.where).toContain("设置→LLM 用途绑定");
    expect(f.acceptance).toContain("常州基地的瓶颈是?");
    // suggestedFill 含真修法（永不「人工核实内部错误」）：
    expect(f.suggestedFill).toContain("设置→LLM 用途绑定");
    expect(f.suggestedFill).not.toContain("人工核实内部错误");
  });

  it("齿：LLM 鉴权泄漏原始串（Could not resolve authentication）→ 归一 LLM_PURPOSE_UNBOUND actionable，不泄漏 SDK 串到 gapCode", () => {
    const r = classifyGap(base({ query: "常州瓶颈?", status: "FAILED", path: "WORKFLOW", error: { code: "TOOL_ERROR", message: "Could not resolve authentication method: x-api-key missing" } }));
    expect(r.findings[0]!.gapCode).toBe("LLM_PURPOSE_UNBOUND");
    expect(r.findings[0]!.suggestedFill).toContain("设置→LLM 用途绑定");
  });

  it("齿：任一终态的 finding 都携带 actionable what/where/acceptance，永不「人工核实内部错误」", () => {
    // 覆盖 ②失败未映射 / ④其它终态 —— 即便落 OTHER 码，也 actionable（保留 evidence 原文·派生三元）。
    const other = classifyGap(base({ query: "某问句?", status: "FAILED", path: "WORKFLOW", error: { code: "WEIRD_INTERNAL", message: "unexpected internal state z" } }));
    const cancelled = classifyGap(base({ query: "某问句?", status: "CANCELLED", path: "NONE" }));
    for (const r of [other, cancelled]) {
      const f = r.findings[0]!;
      expect(f.suggestedFill).not.toContain("人工核实内部错误");
      expect(f.what).toBeTruthy();
      expect(f.where).toBeTruthy();
      expect(f.acceptance).toContain("某问句?"); // 验收线=本问句 E2E 答出
    }
    // OTHER 码仍保留真实 evidence 原文（不被兜底文案掩盖）：
    expect(other.findings[0]!.evidence).toContain("unexpected internal state z");
  });
});

describe("growth probe endpoint · 真实 orchestrator 实跑", () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it("POST /api/v1/growth/probe：路径B 探索 → GapReport BOUNDARY", async () => {
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [text("探索答复"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "探索答复" }], provenance: [] })] });
    const res = await t.app.inject({
      method: "POST", url: "/api/v1/growth/probe",
      headers: { "x-debug-user": PLANNER, "content-type": "application/json" },
      payload: { packageId: "pkg_battery_manufacturing", query: "讲个笑话", context: { view: "dash", selectedObjects: [], filters: {} } },
    });
    expect(res.statusCode).toBe(200);
    const report = res.json() as { verdict: string; path: string; findings: { gapCode: string }[] };
    expect(report.path).toBe("AGENT");
    expect(report.verdict).toBe("BOUNDARY");
    expect(report.findings[0]!.gapCode).toBe("NO_INTENT");
  });
});
