/**
 * LAUNCHER-GROUNDED-QUESTIONS · 场景启动器问题「接地化」（Part A · 根因 R14 数据驱动）。
 *
 * 出厂 SCENARIO_CATALOG 的 presetContext/triggerQuestion 是硬编码，未对当前租户真实数据校验接地：
 *   · S11 预设 lineId="常州·动力线-A" 是**死对象**（真实 Line 为 LINE-changzhou 类）
 *   · S18 问句"本月"、S03"这天"、S08"下周"、S19"Q2" 是**未解析相对时间**，缺必填槽（month）
 * 本模块把每张卡对「(对象库 ∩ 模拟时钟) 现状」求解接地：死对象→同类型真实首选实例、相对时间→sim-clock 派生具体值、
 * 补必填槽、具象问句。**纯函数**（输入 = 卡 + GroundingContext），确定性（R6：同租户同 clock 同结果），
 * 服务端 GET /b/v1/scenarios 下发时调用（非前端、非硬编码）。
 *
 * 诚实边界（PRD §6）：仅当某卡 selectedObjects 引用的对象类型**在租户零实例**时标 groundingGap（needsData→待补区）；
 * slotPreset 的对象引用尽力 resolve（有真实替代即换、无则原样留），绝不编造。
 */

import type { Answer } from "@platform/contracts";

/**
 * LAUNCHER-GROUNDED-QUESTIONS · Part B：工作流跑通但**结果为数据未接齐空壳**（BP-7 显性化文案·无 KPI/表数据）
 * → 追加 `gap` 块（携真问句 + taskId），驱动答案坞既有 GapCard 的「认领并补数据」（复用 GROWTH-WORKLIST
 * human-gated fill·非自动补）。纯函数便于单测。仅命中"数据未接齐/无输出"（真缺数据·补数据有用）；
 * "真无解"（约束不可行·补数据无用）不追加——诚实区分（R13 不假装可答/不误导补数据方向）。
 */
export function appendDataGapBlock(answer: Answer, question: string, taskId: string, now = new Date().toISOString()): Answer {
  const blocks = answer.blocks ?? [];
  const hasData = blocks.some((b) => b.type === "kpi" || b.type === "table" || b.type === "rule_violation" || b.type === "action_draft");
  const emptyMarked = blocks.some((b) => b.type === "text" && /数据未接齐|求解器本次无输出|求解器无结构化输出/.test((b as { markdown: string }).markdown));
  if (hasData || !emptyMarked) return answer;
  if (blocks.some((b) => b.type === "gap")) return answer; // 已有 gap 块不重复
  return {
    ...answer,
    blocks: [
      ...blocks,
      {
        type: "gap",
        report: {
          question,
          taskId,
          verdict: "BLOCKED",
          path: "WORKFLOW",
          findings: [{
            gapCode: "EMPTY_DATA",
            atStep: "invoke_solver",
            evidence: "工作流跑通但求解器输出为空壳（数据未接齐）——上游对象切片/口径无可计算输入。",
            suggestedFill: "认领并补数据：登记在办项 → 人工触发合成/导入该场景所需数据 → 继续推演重跑。",
            blocking: true,
          }],
          generatedAt: now,
        },
      },
    ],
  };
}

/** 归一化后的一个真实对象实例（业务主键 + 展示名）。 */
export interface GroundObject {
  /** 对象实例 id（如 obj_line_LINE-changzhou）。 */
  id: string;
  /** 业务主键值（求解器/预设引用用；如 Line→lineId="LINE-changzhou"）。 */
  key: string;
  /** 展示名（如 常州一号线）。 */
  label: string;
}

export interface GroundingContext {
  /** 模拟时钟当前日 YYYY-MM-DD（undefined → 无锚点，相对时间不接地，诚实留原样）。 */
  simDate?: string;
  /** 租户真实对象实例，按对象类型分组（已 fetch 到才有键；缺键=未探测，非"零实例"）。 */
  objectsByType: Record<string, GroundObject[]>;
}

/** slotPreset 键 → 对象类型（对象引用型槽位；用于死对象 resolve）。 */
const SLOT_OBJECT_TYPE: Record<string, string> = {
  lineId: "Line",
  baseId: "Base",
  modelId: "Model",
  custName: "Customer",
};

export interface GroundingChange {
  field: string;
  from: unknown;
  to: unknown;
  reason: "dead_object_resolved" | "relative_time_resolved" | "slot_filled" | "object_verified";
}

export interface GroundedScenario {
  selectedObjects: { objectType: string; objectId: string; label?: string }[];
  slotPresets: Record<string, unknown>;
  triggerQuestion: string;
  /** 接地后仍不可答（selectedObjects 引用类型零实例）→ 入"待补数据"区。 */
  needsData: boolean;
  groundingGap?: { gapCode: "EMPTY_DATA"; missingType: string; detail: string };
  /** 接地留痕（改了什么·R13 可溯）。 */
  changes: GroundingChange[];
}

// ---- 相对时间归结（sim-clock 派生·UTC·确定性 R6）----

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/** ISO 周一为周首。 */
function mondayOf(d: Date): Date {
  const out = new Date(d.getTime());
  const dow = out.getUTCDay(); // 0=Sun..6=Sat
  out.setUTCDate(out.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return out;
}

/** 当前月 YYYY-MM。 */
export function currentMonth(simDate: string): string {
  return simDate.slice(0, 7);
}
/** 相对某月偏移的 YYYY-MM。 */
function monthOffset(simDate: string, delta: number): string {
  const d = new Date(`${simDate}T00:00:00.000Z`);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** 当前季度 YYYYQn。 */
export function currentQuarter(simDate: string): string {
  const d = new Date(`${simDate}T00:00:00.000Z`);
  return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}
/** 某相对周（0=本周,1=下周,-1=上周）的周一~周日区间（含）。 */
function weekWindow(simDate: string, deltaWeeks: number): { from: string; to: string } {
  const m = mondayOf(new Date(`${simDate}T00:00:00.000Z`));
  m.setUTCDate(m.getUTCDate() + deltaWeeks * 7);
  const sun = new Date(m.getTime());
  sun.setUTCDate(sun.getUTCDate() + 6);
  return { from: ymd(m), to: ymd(sun) };
}

/**
 * 相对时间 token → { 问句替换文案, 注入槽位 }。按问句文字触发（数据驱动·非逐卡硬编码）。
 * 顺序敏感：先长词后短词，避免"下个月"被"月"误配（此处用完整词，安全）。
 */
interface TimeToken {
  re: RegExp;
  resolve: (simDate: string) => { display: string; slot?: Record<string, unknown> };
}
const TIME_TOKENS: TimeToken[] = [
  { re: /下个月|下月/g, resolve: (s) => ({ display: monthOffset(s, 1), slot: { month: monthOffset(s, 1) } }) },
  { re: /上个月|上月/g, resolve: (s) => ({ display: monthOffset(s, -1), slot: { month: monthOffset(s, -1) } }) },
  { re: /这个月|本月|当月/g, resolve: (s) => ({ display: currentMonth(s), slot: { month: currentMonth(s) } }) },
  { re: /下一周|下周/g, resolve: (s) => { const w = weekWindow(s, 1); return { display: `下周（${w.from}~${w.to}）`, slot: { weekStart: w.from, weekEnd: w.to } }; } },
  { re: /上一周|上周/g, resolve: (s) => { const w = weekWindow(s, -1); return { display: `上周（${w.from}~${w.to}）`, slot: { weekStart: w.from, weekEnd: w.to } }; } },
  { re: /这一周|这周|本周/g, resolve: (s) => { const w = weekWindow(s, 0); return { display: `本周（${w.from}~${w.to}）`, slot: { weekStart: w.from, weekEnd: w.to } }; } },
  { re: /这一天|这天|当天|今天|本日/g, resolve: (s) => ({ display: s, slot: { day: s } }) },
  { re: /本季度|这个季度/g, resolve: (s) => ({ display: currentQuarter(s), slot: { quarter: currentQuarter(s) } }) },
  // 裸季度 "Q2"（未带年份）→ 前缀当前年份（如 2026Q2）。仅当未已带 4 位年份时。
  { re: /(?<!\d)Q([1-4])(?![0-9])/g, resolve: (s) => ({ display: `${s.slice(0, 4)}Q$1`, slot: {} }) },
];

// ---- 对象接地 ----

/** 在某类型真实实例中按业务键/ id 匹配 value；命中返回该实例，否则 undefined。 */
function matchObject(objs: GroundObject[], value: string): GroundObject | undefined {
  return objs.find((o) => o.key === value || o.id === value || o.id.endsWith(`_${value}`) || o.label === value);
}

/**
 * 接地一张场景卡（纯函数）。simDate 缺失 → 跳过相对时间归结（诚实留原样）；
 * objectsByType 缺某类型键 → 未探测，尽力不接地不 gap。
 */
export function groundScenario(
  card: {
    triggerQuestion: string;
    presetContext: { selectedObjects: { objectType: string; objectId: string; label?: string }[]; slotPresets: Record<string, unknown> };
  },
  gctx: GroundingContext,
): GroundedScenario {
  const changes: GroundingChange[] = [];
  let needsData = false;
  let groundingGap: GroundedScenario["groundingGap"];

  // 1) selectedObjects：死对象→同类型真实首选实例；类型零实例→标 gap（待补）。
  const selectedObjects = card.presetContext.selectedObjects.map((so) => {
    const objs = gctx.objectsByType[so.objectType];
    if (!objs) return so; // 未探测该类型 → 尽力，不动
    if (objs.length === 0) {
      needsData = true;
      groundingGap = { gapCode: "EMPTY_DATA", missingType: so.objectType, detail: `对象类型「${so.objectType}」在本租户零实例，无法接地引用「${so.objectId}」——需先补该类型数据。` };
      return so;
    }
    const hit = matchObject(objs, so.objectId);
    if (hit) {
      if (so.label !== hit.label) changes.push({ field: `selectedObjects.${so.objectType}`, from: so.objectId, to: hit.key, reason: "object_verified" });
      return { objectType: so.objectType, objectId: hit.key, label: hit.label };
    }
    // 死对象 → 首选真实实例（objs 已按 id 排序，确定性 R6）。
    const first = objs[0]!;
    changes.push({ field: `selectedObjects.${so.objectType}`, from: so.objectId, to: first.key, reason: "dead_object_resolved" });
    return { objectType: so.objectType, objectId: first.key, label: first.label };
  });

  // 2) slotPresets：对象引用型槽位 resolve 死对象；相对时间填槽。
  const slotPresets: Record<string, unknown> = { ...card.presetContext.slotPresets };
  for (const [k, type] of Object.entries(SLOT_OBJECT_TYPE)) {
    const v = slotPresets[k];
    if (typeof v !== "string" || v === "") continue;
    const objs = gctx.objectsByType[type];
    if (!objs || objs.length === 0) continue; // 未探测/零实例 → 不编造
    if (matchObject(objs, v)) continue; // 已是真实对象 → 保留
    const first = objs[0]!;
    changes.push({ field: `slotPresets.${k}`, from: v, to: first.key, reason: "dead_object_resolved" });
    slotPresets[k] = first.key;
  }

  // 3) 相对时间：解析问句 token → 具象问句 + 补槽（有 simDate 才做）。
  let triggerQuestion = card.triggerQuestion;
  if (gctx.simDate) {
    for (const tok of TIME_TOKENS) {
      tok.re.lastIndex = 0;
      if (!tok.re.test(triggerQuestion)) continue;
      const { display, slot } = tok.resolve(gctx.simDate);
      const before = triggerQuestion;
      tok.re.lastIndex = 0;
      triggerQuestion = triggerQuestion.replace(tok.re, display);
      if (before !== triggerQuestion) changes.push({ field: "triggerQuestion", from: before, to: triggerQuestion, reason: "relative_time_resolved" });
      // 补必填/展示槽（不覆盖预设已有真实值）。
      if (slot) {
        for (const [sk, sv] of Object.entries(slot)) {
          if (slotPresets[sk] === undefined || slotPresets[sk] === null || slotPresets[sk] === "") {
            slotPresets[sk] = sv;
            changes.push({ field: `slotPresets.${sk}`, from: undefined, to: sv, reason: "slot_filled" });
          }
        }
      }
    }
  }

  return { selectedObjects, slotPresets, triggerQuestion, needsData, groundingGap, changes };
}
