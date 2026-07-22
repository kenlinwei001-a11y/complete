import type { IntentDefinition, ObjectRef, SessionContext, SlotDef } from "@platform/contracts";
import type { OntologyClient, ToolAuthCtx } from "../tools/clients.js";
import { resolvePath } from "../util/jsonpath.js";

/** 感知层域外信号（A5）：用户给的裸串实体在本租户任何已发布类型都解析不到。 */
export interface OutOfDomainSignal {
  slotName: string;
  value: string;
  /** 最近邻候选（跨已发布类型按字符串相似度排序），供澄清"您是不是指…"。 */
  candidates: { objectType: string; objectId: string; label: string; score: number }[];
}

export interface SlotFillResult {
  slots: Record<string, unknown>;
  missing: SlotDef[];
  /** A5：被判域外的用户实体（→ orchestrator 发 entity.out_of_domain + 埋点）。 */
  outOfDomain: OutOfDomainSignal[];
}

/** 归一化编辑距离相似度（含子串包含加权）；CJK/拉丁通用，确定性纯函数。 */
export function entitySimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  // Levenshtein（O(la*lb)，实体串短，可接受）
  const dp = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) dp[j] = j;
  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  const lev = 1 - dp[lb] / Math.max(la, lb);
  // 子串包含（"常州" ⊂ "常州基地"）给底分，取两者较高。
  const contains = a.includes(b) || b.includes(a) ? Math.min(la, lb) / Math.max(la, lb) : 0;
  return Math.max(lev, contains);
}

/**
 * A5：对解析不到的用户实体，跨已发布类型采样对象，按 objectId/name 相似度取最近邻候选。
 * 只在域外分支调用（异常路径），每类型限采样、整体取 topK，避免热路径开销。
 */
export async function nearestEntities(
  key: string,
  ontology: OntologyClient,
  ctx: ToolAuthCtx,
  opts: { perType?: number; topK?: number; minScore?: number } = {},
): Promise<OutOfDomainSignal["candidates"]> {
  const perType = opts.perType ?? 50;
  const topK = opts.topK ?? 3;
  const minScore = opts.minScore ?? 0.34;
  let objectTypes: string[];
  try {
    objectTypes = await ontology.listObjectTypeKeys(ctx);
  } catch {
    return [];
  }
  const scored: OutOfDomainSignal["candidates"] = [];
  for (const objectType of objectTypes) {
    let rows: Record<string, unknown>[];
    try {
      const payload = await ontology.queryObjects(ctx, objectType, {}, perType);
      const d = payload.data as { rows?: unknown[]; items?: unknown[] } | unknown[];
      rows = (Array.isArray(d) ? d : (d?.rows ?? d?.items ?? [])) as Record<string, unknown>[];
      if (!Array.isArray(rows)) continue;
    } catch {
      continue;
    }
    for (const r of rows) {
      // 真实形状 { id, type, props }；裸串实体对应 props 内的 PK/名称值，逐 string 属性取最高相似度。
      const props = (r.props && typeof r.props === "object" ? (r.props as Record<string, unknown>) : r) as Record<string, unknown>;
      let best = { v: String(r.id ?? r.objectId ?? ""), score: entitySimilarity(key, String(r.id ?? r.objectId ?? "")) };
      for (const v of Object.values(props)) {
        if (typeof v !== "string") continue;
        const s = entitySimilarity(key, v);
        if (s > best.score) best = { v, score: s };
      }
      if (best.score >= minScore) scored.push({ objectType, objectId: best.v, label: best.v, score: Number(best.score.toFixed(3)) });
    }
  }
  // 确定性排序：分数降序 → 同分按 type/id 字典序（R6）。
  scored.sort((x, y) => y.score - x.score || `${x.objectType}${x.objectId}`.localeCompare(`${y.objectType}${y.objectId}`));
  return scored.slice(0, topK);
}

/**
 * BP-6 相对时间归结（确定性兜底层，diagnostic ledger D6）：LLM/分类器把"这天/今天/下周/本月"
 * 等相对时间引用原样抽进 date 槽 → 不满足 `^YYYY-MM-DD` 校验 → 归结失败、时间槽空（S03「这天」→ null）。
 *
 * 本函数在 LLM 抽取之后兜底：把相对引用归结成视图上下文里的**具体日期**（YYYY-MM-DD）。
 * 锚点优先级（只用现有 SessionContext 字段，绝不新增 contract 字段，R6 确定性纯函数）：
 *   1) context.timeWindow.from —— 视图焦点时间窗起点（= 焦点日/当前推演视角日）
 *   2) context.filters 里任一日期形态值（day/date/asOf/focusDate…，取首个 YYYY-MM-DD）
 * 拿不到锚点 → 返回 undefined（不编造"今天=wall clock"，保持确定性、不静默伪造）。
 *
 * 归结规则（锚点记为 D，ISO 周一为周首，全 UTC）：
 *   这天/今天/today/当天/本日 → D
 *   明天/tomorrow → D+1；昨天/yesterday → D-1
 *   下周/next week → D 所在周 +7 的周一；本周 → D 所在周周一；上周 → -7 周一
 *   本月/this month → D 所在月 1 号；下月 → 次月 1 号；上月 → 上月 1 号
 */
const REL_TIME_PATTERNS: { re: RegExp; kind: "day" | "tomorrow" | "yesterday" | "thisWeek" | "nextWeek" | "lastWeek" | "thisMonth" | "nextMonth" | "lastMonth" }[] = [
  { re: /^(这天|今天|当天|本日|today|这一天|此日)$/i, kind: "day" },
  { re: /^(明天|次日|tomorrow)$/i, kind: "tomorrow" },
  { re: /^(昨天|前一天|yesterday)$/i, kind: "yesterday" },
  { re: /^(本周|这周|这一周|this\s*week)$/i, kind: "thisWeek" },
  { re: /^(下周|下一周|next\s*week)$/i, kind: "nextWeek" },
  { re: /^(上周|上一周|last\s*week)$/i, kind: "lastWeek" },
  { re: /^(本月|这个月|当月|this\s*month)$/i, kind: "thisMonth" },
  { re: /^(下月|下个月|next\s*month)$/i, kind: "nextMonth" },
  { re: /^(上月|上个月|last\s*month)$/i, kind: "lastMonth" },
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** 从 SessionContext 取归结锚点日（YYYY-MM-DD）：timeWindow.from 优先，否则 filters 里首个日期形态值。 */
export function resolveAnchorDate(context: SessionContext): string | undefined {
  const tw = context.timeWindow?.from;
  if (typeof tw === "string" && ISO_DATE.test(tw)) return tw.slice(0, 10);
  const filters = context.filters ?? {};
  // 确定性：先查常见日期键名，再按键字典序兜底扫描；任一值是 YYYY-MM-DD 即采用。
  const preferredKeys = ["day", "date", "asOf", "asof", "focusDate", "focusDay", "currentDay", "anchorDate"];
  for (const k of preferredKeys) {
    const v = filters[k];
    if (typeof v === "string" && ISO_DATE.test(v)) return v.slice(0, 10);
  }
  for (const k of Object.keys(filters).sort()) {
    const v = filters[k];
    if (typeof v === "string" && ISO_DATE.test(v)) return v.slice(0, 10);
  }
  return undefined;
}

function fmtUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/** ISO 周一为周首：返回给定日期所在周的周一（UTC，确定性）。 */
function mondayOf(d: Date): Date {
  const out = new Date(d.getTime());
  const dow = out.getUTCDay(); // 0=Sun..6=Sat
  const deltaToMonday = dow === 0 ? -6 : 1 - dow;
  out.setUTCDate(out.getUTCDate() + deltaToMonday);
  return out;
}

/** 把相对时间引用归结为具体日期；非相对引用/无锚点 → undefined。纯函数、UTC、确定性（R6）。 */
export function resolveRelativeDate(raw: unknown, context: SessionContext): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s || ISO_DATE.test(s)) return undefined; // 已是具体日期，无需归结
  const hit = REL_TIME_PATTERNS.find((p) => p.re.test(s));
  if (!hit) return undefined;
  const anchorStr = resolveAnchorDate(context);
  if (!anchorStr) return undefined;
  const anchor = new Date(`${anchorStr}T00:00:00.000Z`);
  if (Number.isNaN(anchor.getTime())) return undefined;
  const d = new Date(anchor.getTime());
  switch (hit.kind) {
    case "day":
      return fmtUtcDate(d);
    case "tomorrow":
      d.setUTCDate(d.getUTCDate() + 1);
      return fmtUtcDate(d);
    case "yesterday":
      d.setUTCDate(d.getUTCDate() - 1);
      return fmtUtcDate(d);
    case "thisWeek":
      return fmtUtcDate(mondayOf(d));
    case "nextWeek": {
      const m = mondayOf(d);
      m.setUTCDate(m.getUTCDate() + 7);
      return fmtUtcDate(m);
    }
    case "lastWeek": {
      const m = mondayOf(d);
      m.setUTCDate(m.getUTCDate() - 7);
      return fmtUtcDate(m);
    }
    case "thisMonth":
      return fmtUtcDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    case "nextMonth":
      return fmtUtcDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
    case "lastMonth":
      return fmtUtcDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
  }
}

/** Validate + normalize a single slot value per its SlotDef (QOS-PRD §5.2.1 ①). */
export async function validateSlotValue(
  slot: SlotDef,
  value: unknown,
  ontology: OntologyClient,
  ctx: ToolAuthCtx,
): Promise<{ ok: boolean; value?: unknown; outOfDomain?: boolean }> {
  if (value === undefined || value === null || value === "") return { ok: false };
  switch (slot.type) {
    case "string":
      return { ok: true, value: String(value) };
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case "date": {
      const s = String(value);
      return /^\d{4}-\d{2}-\d{2}/.test(s) || !Number.isNaN(Date.parse(s)) ? { ok: true, value: s } : { ok: false };
    }
    case "timeWindow": {
      if (typeof value === "object" && value !== null) {
        const v = value as { from?: unknown; to?: unknown };
        if (v.from !== undefined && v.to !== undefined) {
          return { ok: true, value: { from: String(v.from), to: String(v.to) } };
        }
      }
      return { ok: false };
    }
    case "enum": {
      const s = String(value);
      return slot.enumValues?.includes(s) ? { ok: true, value: s } : { ok: false };
    }
    case "json": {
      // WO-Phase1-D+A：json 槽接受对象/数组原值；也接受 JSON 字符串（从模板/LLM 抽出时可能仍是字符串）。
      if (value !== null && typeof value === "object") return { ok: true, value };
      if (typeof value === "string") {
        const trimmed = value.trim();
        if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
          try {
            return { ok: true, value: JSON.parse(trimmed) };
          } catch {
            return { ok: false };
          }
        }
      }
      return { ok: false };
    }
    case "objectRef": {
      // Must be resolvable in the ontology (OntologyClient.getObject).
      if (typeof value === "object" && value !== null && "objectId" in (value as Record<string, unknown>)) {
        const ref = value as ObjectRef;
        try {
          const payload = await ontology.getObject(ctx, ref.objectType, ref.objectId);
          const data = payload.data as Record<string, unknown>;
          return {
            ok: true,
            value: {
              objectType: ref.objectType,
              objectId: (data.objectId as string) ?? ref.objectId,
              label: (data.name as string) ?? ref.label,
            } satisfies ObjectRef,
          };
        } catch {
          return { ok: false };
        }
      }
      // Bare string (e.g. "常州" / "4680-NCM" / "供应商A") — resolve across the tenant's
      // published object types, fetched DYNAMICALLY from the ontology (R14: no hardcoded type list；
      // 裸串实体不再仅限 Base/Model/Order，任意已建模类型均可解析)。
      const key = String(value);
      let objectTypes: string[];
      try {
        objectTypes = await ontology.listObjectTypeKeys(ctx);
      } catch {
        objectTypes = [];
      }
      for (const objectType of objectTypes) {
        try {
          const payload = await ontology.getObject(ctx, objectType, key);
          const data = payload.data as Record<string, unknown>;
          return {
            ok: true,
            value: {
              objectType,
              objectId: (data.objectId as string) ?? key,
              label: (data.name as string) ?? key,
            } satisfies ObjectRef,
          };
        } catch {
          /* try next type */
        }
      }
      // 域外：裸串实体在本租户任何已发布对象类型中都解析不到 → 不命中（→ 澄清/降级，感知层显式信号）。
      //   A5：标记 outOfDomain，让 fillSlots 取最近邻候选 + orchestrator 发独立事件/埋点。
      return { ok: false, outOfDomain: typeof value === "string" };
    }
  }
}

/**
 * Slot filling (QOS-PRD §5.2.1): extracted → typed validation → defaultFrom on the
 * session context → required & missing → clarification list. Optional missing → null.
 */
export async function fillSlots(
  intent: IntentDefinition,
  extracted: Record<string, unknown>,
  context: SessionContext,
  ontology: OntologyClient,
  ctx: ToolAuthCtx,
): Promise<SlotFillResult> {
  const slots: Record<string, unknown> = {};
  const missing: SlotDef[] = [];
  const outOfDomain: OutOfDomainSignal[] = [];

  for (const slot of intent.slots) {
    // ① classifier-extracted value (validated)
    const fromExtraction = await validateSlotValue(slot, extracted[slot.name], ontology, ctx);
    if (fromExtraction.ok) {
      slots[slot.name] = fromExtraction.value;
      continue;
    }
    // ①.b BP-6 相对时间归结兜底：LLM 把"这天/今天/下周/本月"抽进 date 槽但不可解析 →
    // 用视图上下文锚点归结成具体日期（确定性，仅 date 槽，仅在直校验失败时）。修 S03「这天」→ null。
    if (slot.type === "date") {
      const resolved = resolveRelativeDate(extracted[slot.name], context);
      if (resolved !== undefined) {
        const revalidated = await validateSlotValue(slot, resolved, ontology, ctx);
        if (revalidated.ok) {
          slots[slot.name] = revalidated.value;
          continue;
        }
      }
    }
    // A5：用户给的实体被判域外（objectRef 裸串解析不到）→ 取最近邻候选，记信号。
    if (fromExtraction.outOfDomain && slot.type === "objectRef") {
      const value = String(extracted[slot.name]);
      outOfDomain.push({ slotName: slot.name, value, candidates: await nearestEntities(value, ontology, ctx) });
    }
    // ①.5 场景启动器 presetSlots（PRD-scenario-launcher §3.1）：按槽位名预置，
    // 优先级低于用户自由文本抽取、高于 defaultFrom —— 让"点场景启动"零反问直达推演。
    const preset = context.presetSlots?.[slot.name];
    if (preset !== undefined) {
      const fromPreset = await validateSlotValue(slot, preset, ontology, ctx);
      if (fromPreset.ok) {
        slots[slot.name] = fromPreset.value;
        continue;
      }
      // BP-6：场景卡/预置也可能带相对时间引用（如 day:"这天"）→ 同样确定性归结后再校验。
      if (slot.type === "date") {
        const resolvedPreset = resolveRelativeDate(preset, context);
        if (resolvedPreset !== undefined) {
          const reval = await validateSlotValue(slot, resolvedPreset, ontology, ctx);
          if (reval.ok) {
            slots[slot.name] = reval.value;
            continue;
          }
        }
      }
    }
    // ② defaultFrom evaluated against the session context
    if (slot.defaultFrom) {
      const candidate = resolvePath(context, slot.defaultFrom);
      const fromDefault = await validateSlotValue(slot, candidate, ontology, ctx);
      if (fromDefault.ok) {
        slots[slot.name] = fromDefault.value;
        continue;
      }
    }
    // ③ required & still missing → clarification; optional → null
    if (slot.required) missing.push(slot);
    else slots[slot.name] = null;
  }
  return { slots, missing, outOfDomain };
}

export function clarifyPromptFor(slot: SlotDef): string {
  return slot.clarifyPrompt ?? `请提供${slot.name}`;
}
