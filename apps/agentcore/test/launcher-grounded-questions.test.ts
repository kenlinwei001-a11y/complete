import { describe, expect, it } from "vitest";
import { groundScenario, appendDataGapBlock, currentMonth, currentQuarter, type GroundingContext } from "../src/scenario-grounding.js";
import type { Answer } from "@platform/contracts";

/**
 * LAUNCHER-GROUNDED-QUESTIONS · Part A 接地纯函数测试（确定性 R6·零网络/时钟随机）。
 * 铁律：接地来自租户真数据 + sim-clock（此处以合成 GroundingContext 复现 demo 真值），零硬编码死对象。
 * 牙齿：还原死 lineId / 缺 month / 未解析相对时间即红。
 */

// demo 真值镜像（对 objects?type=Line/Base/Model/Customer 实测·按 id 排序）。
const DEMO: GroundingContext = {
  simDate: "2026-06-10", // sim-clock t0（GET /a/v1/synthetic/clock simulatedDate）
  objectsByType: {
    Line: [
      { id: "obj_line_LINE-changzhou", key: "LINE-changzhou", label: "常州一号线" },
      { id: "obj_line_LINE-chengdu", key: "LINE-chengdu", label: "成都一号线" },
    ],
    Base: [
      { id: "obj_base_changzhou", key: "changzhou", label: "常州" },
      { id: "obj_base_chengdu", key: "chengdu", label: "成都" },
    ],
    Model: [{ id: "obj_model_4680-NCM", key: "4680-NCM", label: "4680 三元圆柱" }],
    Customer: [{ id: "obj_customer_cust_7", key: "电网公司F", label: "电网公司F" }],
  },
};

const S11 = { triggerQuestion: "下周订单怎么排能少换型？", presetContext: { selectedObjects: [], slotPresets: { lineId: "常州·动力线-A", week: 1 } } };
const S18 = { triggerQuestion: "本月产销平衡到哪一步了？", presetContext: { selectedObjects: [], slotPresets: {} } };
const S03 = { triggerQuestion: "常州物料齐套为什么这天越线？", presetContext: { selectedObjects: [{ objectType: "Base", objectId: "changzhou", label: "常州" }], slotPresets: { baseId: "changzhou", factor: "物料齐套" } } };
const S19 = { triggerQuestion: "Q2 缺口用什么组合补？", presetContext: { selectedObjects: [], slotPresets: { quarter: "2026Q2" } } };

describe("S11 换型排序：死 lineId 接地为真线实例（元凶·牙齿）", () => {
  it("常州·动力线-A（不存在）→ LINE-changzhou（同类型真实首选实例，非死对象）", () => {
    const g = groundScenario(S11, DEMO);
    expect(g.slotPresets.lineId).toBe("LINE-changzhou");
    expect(g.slotPresets.lineId).not.toBe("常州·动力线-A"); // 还原死对象即红
    expect(g.changes.some((c) => c.field === "slotPresets.lineId" && c.reason === "dead_object_resolved")).toBe(true);
  });
  it("已是真实对象 → 保留不动（不乱换）", () => {
    const ok = { triggerQuestion: "x", presetContext: { selectedObjects: [], slotPresets: { lineId: "LINE-chengdu" } } };
    expect(groundScenario(ok, DEMO).slotPresets.lineId).toBe("LINE-chengdu");
  });
});

describe("S18 S&OP：缺 month 由 sim-clock 补齐 + 问句具象（元凶·牙齿）", () => {
  it("空 slotPresets → month=2026-06（clock 当前月）", () => {
    const g = groundScenario(S18, DEMO);
    expect(g.slotPresets.month).toBe("2026-06");
    expect(g.triggerQuestion).toBe("2026-06产销平衡到哪一步了？");
    expect(g.triggerQuestion).not.toContain("本月"); // 未解析相对时间即红
  });
});

describe("相对时间解析（sim-clock 派生·具体值注入）", () => {
  it("S03「这天」→ 2026-06-10（当前推演日）+ day 槽", () => {
    const g = groundScenario(S03, DEMO);
    expect(g.triggerQuestion).toContain("2026-06-10");
    expect(g.triggerQuestion).not.toContain("这天");
    expect(g.slotPresets.day).toBe("2026-06-10");
  });
  it("S11「下周」→ 具体周区间（2026-06-15~2026-06-21）", () => {
    const g = groundScenario(S11, DEMO);
    expect(g.triggerQuestion).toContain("2026-06-15");
    expect(g.triggerQuestion).toContain("2026-06-21");
  });
  it("S19「Q2」→ 2026Q2（前缀当前年份）", () => {
    const g = groundScenario(S19, DEMO);
    expect(g.triggerQuestion).toContain("2026Q2");
    expect(g.triggerQuestion).not.toMatch(/(?<!\d)Q2/);
  });
  it("helpers：currentMonth/currentQuarter 确定性", () => {
    expect(currentMonth("2026-06-10")).toBe("2026-06");
    expect(currentQuarter("2026-06-10")).toBe("2026Q2");
    expect(currentQuarter("2026-01-05")).toBe("2026Q1");
    expect(currentQuarter("2026-12-31")).toBe("2026Q4");
  });
});

describe("无 sim-clock 锚点 → 相对时间诚实留原样（不编造 wall clock）", () => {
  it("simDate 缺失 → 问句不改写、不补时间槽", () => {
    const g = groundScenario(S18, { simDate: undefined, objectsByType: DEMO.objectsByType });
    expect(g.triggerQuestion).toBe("本月产销平衡到哪一步了？");
    expect(g.slotPresets.month).toBeUndefined();
  });
});

describe("可答性过滤：selectedObjects 引用类型零实例 → needsData（待补区）", () => {
  it("Base 类型零实例 → groundingGap(EMPTY_DATA) + needsData", () => {
    const g = groundScenario(S03, { simDate: "2026-06-10", objectsByType: { Base: [] } });
    expect(g.needsData).toBe(true);
    expect(g.groundingGap?.gapCode).toBe("EMPTY_DATA");
    expect(g.groundingGap?.missingType).toBe("Base");
  });
  it("类型未探测（缺键）→ 不 gap（尽力·诚实不伪造）", () => {
    const g = groundScenario(S03, { simDate: "2026-06-10", objectsByType: {} });
    expect(g.needsData).toBe(false);
  });
});

describe("Part B：空结果（数据未接齐）→ 追加 gap 块驱动『认领并补数据』（非自动补·牙齿）", () => {
  const NOW = "2026-06-10T00:00:00.000Z";
  const emptyAnswer = (): Answer => ({ trustLevel: "VERIFIED_WORKFLOW", blocks: [{ type: "text", markdown: "**结果为空（数据未接齐）**：「rows」为空，且本次未产出关键标量——" }], provenance: [] } as unknown as Answer);
  const dataAnswer = (): Answer => ({ trustLevel: "VERIFIED_WORKFLOW", blocks: [{ type: "kpi", label: "shortageCount", value: "2", provId: "p" }], provenance: [] } as unknown as Answer);
  const infeasibleAnswer = (): Answer => ({ trustLevel: "VERIFIED_WORKFLOW", blocks: [{ type: "kpi", label: "residualGap", value: "50", provId: "p" }, { type: "text", markdown: "**结果为空（真无解）**：求解器已运行…" }], provenance: [] } as unknown as Answer);

  it("数据未接齐空壳 → 追加 gap(EMPTY_DATA) 携真问句 + taskId", () => {
    const out = appendDataGapBlock(emptyAnswer(), "本月产销平衡到哪一步了？", "task_1", NOW);
    const gap = out.blocks.find((b) => b.type === "gap") as { report: { findings: { gapCode: string }[]; question: string; taskId: string } } | undefined;
    expect(gap).toBeDefined();
    expect(gap!.report.findings[0].gapCode).toBe("EMPTY_DATA");
    expect(gap!.report.question).toBe("本月产销平衡到哪一步了？");
    expect(gap!.report.taskId).toBe("task_1");
  });
  it("有真数据（KPI）→ 不追加 gap（不误报可答为缺）", () => {
    const out = appendDataGapBlock(dataAnswer(), "q", "task_2", NOW);
    expect(out.blocks.some((b) => b.type === "gap")).toBe(false);
  });
  it("真无解（约束不可行·非数据缺）→ 不追加 gap（补数据无用·诚实区分）", () => {
    const out = appendDataGapBlock(infeasibleAnswer(), "q", "task_3", NOW);
    expect(out.blocks.some((b) => b.type === "gap")).toBe(false);
  });
  it("确定性：同输入同 now → 同输出（R6）", () => {
    expect(JSON.stringify(appendDataGapBlock(emptyAnswer(), "q", "t", NOW))).toBe(JSON.stringify(appendDataGapBlock(emptyAnswer(), "q", "t", NOW)));
  });
});

describe("R6 确定性：同租户同 clock 同数据 → 同接地结果", () => {
  it("两次接地字节级一致", () => {
    const a = groundScenario(S11, DEMO);
    const b = groundScenario(S11, DEMO);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
