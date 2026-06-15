import type { IntentDefinition, ObjectRef, SessionContext, SlotDef } from "@platform/contracts";
import type { OntologyClient, ToolAuthCtx } from "../tools/clients.js";
import { resolvePath } from "../util/jsonpath.js";

const OBJECT_TYPES = ["Base", "Model", "Order"];

export interface SlotFillResult {
  slots: Record<string, unknown>;
  missing: SlotDef[];
}

/** Validate + normalize a single slot value per its SlotDef (QOS-PRD §5.2.1 ①). */
export async function validateSlotValue(
  slot: SlotDef,
  value: unknown,
  ontology: OntologyClient,
  ctx: ToolAuthCtx,
): Promise<{ ok: boolean; value?: unknown }> {
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
      // Bare string (e.g. "常州" / "4680-NCM") — try to resolve across known object types.
      const key = String(value);
      for (const objectType of OBJECT_TYPES) {
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
      return { ok: false };
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

  for (const slot of intent.slots) {
    // ① classifier-extracted value (validated)
    const fromExtraction = await validateSlotValue(slot, extracted[slot.name], ontology, ctx);
    if (fromExtraction.ok) {
      slots[slot.name] = fromExtraction.value;
      continue;
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
  return { slots, missing };
}

export function clarifyPromptFor(slot: SlotDef): string {
  return slot.clarifyPrompt ?? `请提供${slot.name}`;
}
