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

  for (const slot of intent.slots) {
    // ① classifier-extracted value (validated)
    const fromExtraction = await validateSlotValue(slot, extracted[slot.name], ontology, ctx);
    if (fromExtraction.ok) {
      slots[slot.name] = fromExtraction.value;
      continue;
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
