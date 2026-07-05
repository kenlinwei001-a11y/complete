import { describe, expect, it } from "vitest";
import type { IntentDefinition, SessionContext } from "@platform/contracts";
import { fillSlots, resolveAnchorDate, resolveRelativeDate } from "../src/router/slots.js";
import { summarizeSolverOutput } from "../src/workflow/executor.js";

/**
 * BP-6 相对时间归结 + BP-7 空结果显性化（诊断账本 D6/D7，系统本体 §8）。
 * 全部确定性、无网络/时钟随机（LLM 一律不参与，直接喂抽取结果与求解器 payload）。
 */

// ---- 测试桩：fillSlots 的 OntologyClient / ctx（date 槽不触本体，objectRef 才需要）----
const ontology = {
  getObject: async (_ctx: unknown, objectType: string, objectId: string) => ({ data: { objectType, objectId, name: objectId } }),
  listObjectTypeKeys: async () => ["Base"],
  queryObjects: async () => ({ data: { rows: [] } }),
} as unknown as Parameters<typeof fillSlots>[3];
const ctx = { tenantId: "demo", userId: "u", roles: [], token: "t" } as unknown as Parameters<typeof fillSlots>[4];

function session(over: Partial<SessionContext> = {}): SessionContext {
  return { view: "risk", selectedObjects: [], filters: {}, ...over } as SessionContext;
}

describe("BP-6 · resolveRelativeDate 纯函数归结（确定性，UTC，ISO 周一为周首）", () => {
  const anchorCtx = session({ timeWindow: { from: "2026-06-24", to: "2026-06-30" } });

  it("这天/今天/today → 锚点日（焦点时间窗起点）", () => {
    expect(resolveRelativeDate("这天", anchorCtx)).toBe("2026-06-24");
    expect(resolveRelativeDate("今天", anchorCtx)).toBe("2026-06-24");
    expect(resolveRelativeDate("today", anchorCtx)).toBe("2026-06-24");
    expect(resolveRelativeDate("TODAY", anchorCtx)).toBe("2026-06-24");
  });

  it("明天 +1 / 昨天 -1", () => {
    expect(resolveRelativeDate("明天", anchorCtx)).toBe("2026-06-25");
    expect(resolveRelativeDate("昨天", anchorCtx)).toBe("2026-06-23");
  });

  it("本周/下周/上周 → 对应周一（2026-06-24 是周三）", () => {
    expect(resolveRelativeDate("本周", anchorCtx)).toBe("2026-06-22"); // 周一
    expect(resolveRelativeDate("下周", anchorCtx)).toBe("2026-06-29");
    expect(resolveRelativeDate("上周", anchorCtx)).toBe("2026-06-15");
  });

  it("本月/下月/上月 → 对应月 1 号", () => {
    expect(resolveRelativeDate("本月", anchorCtx)).toBe("2026-06-01");
    expect(resolveRelativeDate("下月", anchorCtx)).toBe("2026-07-01");
    expect(resolveRelativeDate("上月", anchorCtx)).toBe("2026-05-01");
  });

  it("已是具体日期 / 不认识的词 / 非字符串 → undefined（不归结）", () => {
    expect(resolveRelativeDate("2026-01-01", anchorCtx)).toBeUndefined();
    expect(resolveRelativeDate("某个无关词", anchorCtx)).toBeUndefined();
    expect(resolveRelativeDate(123, anchorCtx)).toBeUndefined();
    expect(resolveRelativeDate(null, anchorCtx)).toBeUndefined();
  });

  it("无锚点 → undefined（不编造 wall clock，诚实留空）", () => {
    expect(resolveRelativeDate("这天", session())).toBeUndefined();
  });

  it("锚点来源：timeWindow.from 优先于 filters；无 timeWindow 时用 filters 日期值", () => {
    expect(resolveAnchorDate(session({ timeWindow: { from: "2026-03-15", to: "2026-03-20" }, filters: { day: "2026-09-09" } }))).toBe("2026-03-15");
    expect(resolveAnchorDate(session({ filters: { day: "2026-09-09" } }))).toBe("2026-09-09");
    expect(resolveAnchorDate(session({ filters: { asOf: "2026-09-09" } }))).toBe("2026-09-09");
    expect(resolveAnchorDate(session({ filters: { 区域: "华东" } }))).toBeUndefined();
    expect(resolveAnchorDate(session())).toBeUndefined();
  });
});

describe("BP-6 · fillSlots 兜底：date 槽抽到「这天」→ 归结成具体日期（S03 修复）", () => {
  const riskRootCause: IntentDefinition = {
    id: "int_x",
    packageId: "pkg",
    key: "risk_root_cause",
    version: 1,
    status: "PUBLISHED",
    name: "风险根因",
    description: "解释某基地某天风险越线根因",
    examples: [],
    enabledViews: "*",
    slots: [
      { name: "base", type: "objectRef", required: true, defaultFrom: "$.selectedObjects[0]", description: "基地" },
      { name: "day", type: "date", required: false, description: "日期" },
    ],
    planId: "plan_x",
    riskLevel: "READ",
    owner: "seed",
    createdAt: "now",
    updatedAt: "now",
  } as unknown as IntentDefinition;

  it("有焦点窗：day=「这天」→ 归结为焦点日（不再 null）", async () => {
    const context = session({
      selectedObjects: [{ objectType: "Base", objectId: "changzhou", label: "常州" }],
      timeWindow: { from: "2026-06-24", to: "2026-06-30" },
    });
    const { slots, missing } = await fillSlots(riskRootCause, { day: "这天" }, context, ontology, ctx);
    expect(slots.day).toBe("2026-06-24");
    expect(missing.length).toBe(0);
  });

  it("无焦点窗：day=「这天」无法归结 → 诚实留 null（不编造），且不破坏必填槽", async () => {
    const context = session({ selectedObjects: [{ objectType: "Base", objectId: "changzhou", label: "常州" }] });
    const { slots } = await fillSlots(riskRootCause, { day: "这天" }, context, ontology, ctx);
    expect(slots.day).toBeNull();
  });

  it("已是具体日期：原样校验通过，不被归结改写", async () => {
    const context = session({
      selectedObjects: [{ objectType: "Base", objectId: "changzhou", label: "常州" }],
      timeWindow: { from: "2026-06-24", to: "2026-06-30" },
    });
    const { slots } = await fillSlots(riskRootCause, { day: "2026-01-15" }, context, ontology, ctx);
    expect(slots.day).toBe("2026-01-15");
  });
});

describe("BP-7 · summarizeSolverOutput 空结果显性化（D7，不静默吞空数组）", () => {
  const PROV = "prov_test";

  it("真无解：combo:[] 但 residualGap/quarter 在 → 渲染「真无解 + 放宽约束」文案", () => {
    // S19 quarterly_gap 实际形态：对策不足时 combo 空、残余缺口=全量。
    const blocks = summarizeSolverOutput({ data: { quarter: "2026Q2", combo: [], residualGap: 50, ruleRefs: ["C08", "C29"] } }, PROV);
    const text = blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n");
    expect(text).toContain("真无解");
    expect(text).toContain("对策组合"); // ④ 人话化：combo→对策组合（不再直出裸 key）
    expect(text).not.toContain("combo"); // 齿：内部裸 key 不再泄漏到文案
    // 仍保留真实标量 KPI（quarter/residualGap 人话化为 季度/残余缺口），非纯空白
    const kpiLabels = blocks.filter((b) => b.type === "kpi").map((b) => (b as { label: string }).label);
    expect(kpiLabels).toContain("残余缺口"); // 原裸 key residualGap → 人话
    expect(kpiLabels).toContain("季度"); // 原裸 key quarter → 人话
    expect(kpiLabels).not.toContain("residualGap"); // 齿：裸 key 不得再出现
  });

  it("数据未接齐：仅空数组、无关键标量 → 渲染「数据未接齐 + 先接入数据」文案", () => {
    const blocks = summarizeSolverOutput({ data: { rows: [], over: [] } }, PROV);
    const text = blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n");
    expect(text).toContain("数据未接齐");
    expect(text).toContain("明细行"); // rows→明细行（人话点名·不静默吞）
    expect(text).toContain("超储项"); // over→超储项
  });

  it("空 combo + 非空 evaluatedRules → 有结果表在，空子字段降为轻量 infeasible 一行（不误报整体真无解·LAUNCHER 复验移交）", () => {
    // 渲染条件修：答案已含结果表（evaluatedRules 投表）时，空 combo 只降为轻量『infeasible（无）』一行，
    // 仍点名 combo 不静默吞，但不升格为『结果为空（真无解）』整体判决——避免与并存结果表冲突误导用户。
    const blocks = summarizeSolverOutput(
      { data: { quarter: "2026Q2", combo: [], residualGap: 50, ruleRefs: ["C08", "C29"], evaluatedRules: [{ key: "C08", outcome: "NOT_APPLICABLE" }, { key: "C29", outcome: "NOT_APPLICABLE" }] } },
      PROV,
    );
    const text = blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n");
    expect(text).not.toContain("真无解"); // 有结果表并存 → 不得升格为整体无解
    expect(text).not.toContain("infeasible"); // ④ 内部术语人话化：不再直出 infeasible
    expect(text).toContain("对策组合"); // 仍点名空子字段（人话），不静默吞
    expect(text).toMatch(/子字段.*：无/); // 轻量披露改人话『无』
    expect(blocks.some((b) => b.type === "table")).toBe(true); // evaluatedRules 仍投表（不丢信息）
  });

  it("S11 疵回归：6 行换型序列结果表 + 空子字段 over → 不误报『真无解』，只降为轻量 infeasible 行", () => {
    // 真后端 changeover_sequence 实形态：sequence 有 6 行结果，over 恰为空数组 → 旧逻辑误显『结果为空（真无解）』。
    const blocks = summarizeSolverOutput(
      {
        data: {
          sequence: [
            { lineId: "LINE-A", from: "M1", to: "M2", loss: 12 },
            { lineId: "LINE-A", from: "M2", to: "M3", loss: 8 },
            { lineId: "LINE-A", from: "M3", to: "M4", loss: 15 },
            { lineId: "LINE-A", from: "M4", to: "M5", loss: 6 },
            { lineId: "LINE-A", from: "M5", to: "M6", loss: 9 },
            { lineId: "LINE-A", from: "M6", to: "M1", loss: 11 },
          ],
          totalLoss: 61,
          over: [],
        },
      },
      PROV,
    );
    const text = blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n");
    expect(text).not.toContain("真无解"); // 核心：结果表并存时绝不误报整体无解
    expect(text).not.toContain("数据未接齐");
    expect(text).not.toContain("infeasible"); // ④ 内部术语人话化
    expect(text).toContain("超储项"); // over→超储项（人话点名）
    expect(text).toMatch(/子字段.*：无/);
    expect(blocks.some((b) => b.type === "table")).toBe(true); // 6 行结果表在
  });

  it("有数据：非空数组照常投表，不触发空结果文案", () => {
    const blocks = summarizeSolverOutput({ data: { quarter: "2026Q2", combo: [{ key: "outsource", release: 30 }], residualGap: 20 } }, PROV);
    const text = blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n");
    expect(text).not.toContain("真无解");
    expect(text).not.toContain("数据未接齐");
    expect(blocks.some((b) => b.type === "table")).toBe(true);
  });

  it("空结果文案可溯源（带 provId 的 KPI 仍在，文案块为 text 不静默丢弃）", () => {
    const blocks = summarizeSolverOutput({ data: { quarter: "2026Q2", combo: [], residualGap: 50 } }, PROV);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((b) => b.type === "text" && (b as { markdown: string }).markdown.includes("下一步建议"))).toBe(true);
  });
});
