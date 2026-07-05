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

/** 槽位取值来源（LAUNCHER-SLOT-TRUTH ③：本轮显式 > 上一轮 chip > preset）。 */
export type SlotSource = "extracted" | "chip" | "preset" | "null";

/**
 * LAUNCHER-SLOT-TRUTH ⑤：本轮用户**显式给了**某槽的值，但该值未能绑定（域外/校验失败）→
 * 最终改用了 chip / preset。记录之，使 orchestrator 能出**诚实横幅**而非静默换题。
 */
export interface SlotSubstitution {
  slotName: string;
  /** 用户本轮显式给的原始值（未能绑定者）。 */
  attempted: string;
  /** 实际采用的来源（chip=页面选中·preset=场景预置）。 */
  usedSource: Exclude<SlotSource, "extracted" | "null">;
  /** 实际采用的值（objectRef 或标量）。 */
  usedValue: unknown;
}

export interface SlotFillResult {
  slots: Record<string, unknown>;
  missing: SlotDef[];
  /** A5：被判域外的用户实体（→ orchestrator 发 entity.out_of_domain + 埋点）。 */
  outOfDomain: OutOfDomainSignal[];
  /** LAUNCHER-SLOT-TRUTH ③/④：每槽最终取值来源（回显 + 优先级审计）。 */
  sources: Record<string, SlotSource>;
  /** LAUNCHER-SLOT-TRUTH ⑤：显式给值但未绑定→改用 chip/preset 的替换记录（诚实横幅源）。 */
  substitutions: SlotSubstitution[];
}

/**
 * LAUNCHER-SLOT-TRUTH ① 形状钉死（单一真相源）：把分类器的 `extractedSlots` 归一为**扁平**
 * `{slotName: value}`（仅保留本意图已声明的槽名）。
 *
 * 根因 A：思维型分类器（Kimi 等）常把槽位**按意图键嵌套**回 `{affected_orders:{base:"合肥"}}`；
 * 此前 orchestrator 原样传、slots.ts 按扁平名取 → 全 miss → 落 defaultFrom(旧 chip) → **问合肥答常州**
 * 且绿标零提示（最恶性静默错答）。本函数吸收三种形态并统一压扁：
 *   1) 已扁平 `{base:"合肥"}`（含仅取本意图声明的槽名，丢弃噪声键）；
 *   2) 按本意图键嵌套 `{<intent.key>:{base:"合肥"}}`（最具体·优先）；
 *   3) 泛化单层嵌套 `{<其他意图键>:{base:"合肥"}}`（内层键命中槽名即吸收，先到先得·确定性顺序）。
 * 纯函数、确定性（R6），不引 LLM、不网络。
 */
export function normalizeExtractedSlots(
  raw: Record<string, unknown> | undefined,
  intent: IntentDefinition,
): Record<string, unknown> {
  const slotNames = new Set(intent.slots.map((s) => s.name));
  const flat: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return flat;
  // 1) 顶层已扁平的槽名条目（丢弃非槽名噪声键）
  for (const [k, v] of Object.entries(raw)) {
    if (slotNames.has(k)) flat[k] = v;
  }
  // 2) 按本意图键嵌套：raw[intent.key] = { slotName: value }（最具体 → 覆盖 1）
  const byIntent = raw[intent.key];
  if (byIntent && typeof byIntent === "object" && !Array.isArray(byIntent)) {
    for (const [k, v] of Object.entries(byIntent as Record<string, unknown>)) {
      if (slotNames.has(k)) flat[k] = v;
    }
  }
  // 3) 泛化单层嵌套（其他意图键下的对象）：内层键命中槽名且尚未填 → 吸收（确定性遍历顺序）
  for (const [k, v] of Object.entries(raw)) {
    if (k === intent.key || slotNames.has(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [ik, iv] of Object.entries(v as Record<string, unknown>)) {
        if (slotNames.has(ik) && flat[ik] === undefined) flat[ik] = iv;
      }
    }
  }
  return flat;
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
  const sources: Record<string, SlotSource> = {};
  const substitutions: SlotSubstitution[] = [];

  for (const slot of intent.slots) {
    // 本轮用户显式给的原始值（用于 ⑤ 替换记录：显式给了却没绑上 → 诚实横幅）。
    const raw = extracted[slot.name];
    const attempted =
      raw !== undefined && raw !== null && raw !== ""
        ? typeof raw === "object"
          ? JSON.stringify(raw)
          : String(raw)
        : undefined;

    // ① 本轮显式抽取（最高优先级·validated）
    const fromExtraction = await validateSlotValue(slot, raw, ontology, ctx);
    if (fromExtraction.ok) {
      slots[slot.name] = fromExtraction.value;
      sources[slot.name] = "extracted";
      continue;
    }
    // ①.b BP-6 相对时间归结兜底：LLM 把"这天/今天/下周/本月"抽进 date 槽但不可解析 →
    // 用视图上下文锚点归结成具体日期（确定性，仅 date 槽，仅在直校验失败时）。修 S03「这天」→ null。
    // 仍属"本轮显式"来源（用户本轮真给了时间引用）。
    if (slot.type === "date") {
      const resolved = resolveRelativeDate(raw, context);
      if (resolved !== undefined) {
        const revalidated = await validateSlotValue(slot, resolved, ontology, ctx);
        if (revalidated.ok) {
          slots[slot.name] = revalidated.value;
          sources[slot.name] = "extracted";
          continue;
        }
      }
    }
    // A5：用户给的实体被判域外（objectRef 裸串解析不到）→ 取最近邻候选，记信号。
    if (fromExtraction.outOfDomain && slot.type === "objectRef") {
      const value = String(raw);
      outOfDomain.push({ slotName: slot.name, value, candidates: await nearestEntities(value, ontology, ctx) });
    }
    // ② defaultFrom = 上一轮/页面选中 chip（LAUNCHER-SLOT-TRUTH ③：本轮显式 > 上一轮 chip > preset）。
    //    本轮显式已在 ① 处理并 continue；到此说明本轮未给或未绑成 → chip 优先于 preset 兜底。
    if (slot.defaultFrom) {
      const candidate = resolvePath(context, slot.defaultFrom);
      const fromDefault = await validateSlotValue(slot, candidate, ontology, ctx);
      if (fromDefault.ok) {
        slots[slot.name] = fromDefault.value;
        sources[slot.name] = "chip";
        // ⑤：用户本轮显式给了值却没绑上（域外/校验失败）→ 改用了旧 chip → 记替换（诚实横幅源·绝不静默）。
        if (attempted !== undefined) substitutions.push({ slotName: slot.name, attempted, usedSource: "chip", usedValue: fromDefault.value });
        continue;
      }
    }
    // ①.5 场景启动器 presetSlots（PRD-scenario-launcher §3.1）：优先级**最低**（低于 chip）——
    // 点场景启动零反问直达推演；本轮显式与 chip 均缺时才用预置。
    const preset = context.presetSlots?.[slot.name];
    if (preset !== undefined) {
      const fromPreset = await validateSlotValue(slot, preset, ontology, ctx);
      if (fromPreset.ok) {
        slots[slot.name] = fromPreset.value;
        sources[slot.name] = "preset";
        if (attempted !== undefined) substitutions.push({ slotName: slot.name, attempted, usedSource: "preset", usedValue: fromPreset.value });
        continue;
      }
      // BP-6：场景卡/预置也可能带相对时间引用（如 day:"这天"）→ 同样确定性归结后再校验。
      if (slot.type === "date") {
        const resolvedPreset = resolveRelativeDate(preset, context);
        if (resolvedPreset !== undefined) {
          const reval = await validateSlotValue(slot, resolvedPreset, ontology, ctx);
          if (reval.ok) {
            slots[slot.name] = reval.value;
            sources[slot.name] = "preset";
            if (attempted !== undefined) substitutions.push({ slotName: slot.name, attempted, usedSource: "preset", usedValue: reval.value });
            continue;
          }
        }
      }
    }
    // ③ required & still missing → clarification; optional → null
    if (slot.required) missing.push(slot);
    else {
      slots[slot.name] = null;
      sources[slot.name] = "null";
    }
  }
  return { slots, missing, outOfDomain, sources, substitutions };
}

/**
 * 面向用户的澄清反问文案（铁律 0.4：零裸内部 key 面向用户）。
 * 优先级 clarifyPrompt（人话 + 单位 + 示例 + 取值域）> description（人话）> 兜底裸名。
 * 兜底裸名 `请提供${slot.name}` 会把 `demandDelta` 这类内部参数名直接甩给用户——**只应在
 * 既无 clarifyPrompt 又无 description 时出现**，且已被门禁 `scripts/check-clarify-humanized.mjs`
 * 挡在发布前（防新增槽回潮裸 key）。此前该函数无视 description、直接跳兜底裸名——本单根因①。
 */
export function clarifyPromptFor(slot: SlotDef): string {
  const clarify = slot.clarifyPrompt?.trim();
  if (clarify) return clarify;
  const desc = slot.description?.trim();
  if (desc) return desc;
  return `请提供${slot.name}`;
}

/** 裸内部 key 兜底文案形态（`请提供${name}`）——门禁/齿检用来判定某槽是否会向用户泄漏裸参数名。 */
export function isRawKeyClarifyPrompt(slot: SlotDef): boolean {
  return clarifyPromptFor(slot) === `请提供${slot.name}`;
}
