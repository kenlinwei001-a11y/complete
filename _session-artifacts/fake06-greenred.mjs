import { z } from "zod";
import { ClassificationResultSchema } from "@platform/contracts";

// EXACT reconstruction of the FAKE-06 guards from endpoints.ts / types.ts
function validatedShape(schema, raw) {
  const res = schema.safeParse(raw);
  if (!res.success) throw res.error;      // FAKE-06: drift → THROW (not silent as T)
  return raw;
}
const oldPassThrough = (_schema, raw) => raw; // OLD behavior: `res.json() as T` — zero validation

const QueryHistoryItemSchema = z.object({
  taskId: z.string(), query: z.string(), path: z.enum(["WORKFLOW","AGENT"]).nullable(),
  status: z.string(), view: z.string().nullable(), conversationId: z.string(),
  classification: ClassificationResultSchema.nullable(),
  answerSummary: z.string(), createdAt: z.string(), completedAt: z.string().nullable(),
});
const QueryHistoryResponseSchema = z.object({ items: z.array(QueryHistoryItemSchema), total: z.number() });
const ObjectsPageSchema = z.object({ items: z.array(z.object({ id: z.string(), type: z.string(), props: z.record(z.string(), z.unknown()) })), total: z.number() });

const valid = { items:[{ taskId:"t1",query:"q",path:"WORKFLOW",status:"COMPLETED",view:"dash",conversationId:"c1",classification:{candidates:[{intentKey:"capacity_feasibility",confidence:0.94}],outOfCatalog:false,extractedSlots:{},latencyMs:1,model:"m"},answerSummary:"",createdAt:"2026-07-01T00:00:00Z",completedAt:null}], total:1 };
const driftPathA = JSON.parse(JSON.stringify(valid)); driftPathA.items[0].path = "PATH_A";
const driftFlat  = JSON.parse(JSON.stringify(valid)); driftFlat.items[0].classification = { intentKey:"capacity_feasibility", confidence:0.94 };
const validObjs  = { items:[{id:"o1",type:"Order",props:{}}], total:1 };
const driftTotal = { items:[{id:"o1",type:"Order",props:{}}], total:"many" };

function trial(name, schema, payload) {
  let guarded="?", old="?";
  try { validatedShape(schema, payload); guarded="PASS (no throw)"; } catch { guarded="THROW ✅ (drift caught)"; }
  try { oldPassThrough(schema, payload); old="silently accepted"; } catch { old="threw"; }
  console.log(`  ${name.padEnd(42)} | FAKE-06 guard: ${guarded.padEnd(24)} | OLD as-T: ${old}`);
}
console.log("FAKE-06 green→red self-proof (real contracts schemas):");
console.log("GREEN (valid → guard passes):");
trial("query-history VALID", QueryHistoryResponseSchema, valid);
trial("objects VALID", ObjectsPageSchema, validObjs);
console.log("RED (drift → guard THROWS; OLD silently accepted the bug):");
trial("query-history path=PATH_A drift", QueryHistoryResponseSchema, driftPathA);
trial("query-history flat classification", QueryHistoryResponseSchema, driftFlat);
trial("objects total='many' drift", ObjectsPageSchema, driftTotal);
