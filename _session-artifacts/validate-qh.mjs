import { z } from "zod";
import { ClassificationResultSchema } from "@platform/contracts";
import fs from "fs";
// Reconstruct FAKE-06 QueryHistoryResponseSchema exactly as endpoints.ts defines it.
const QueryHistoryItemSchema = z.object({
  taskId: z.string(), query: z.string(),
  path: z.enum(["WORKFLOW","AGENT"]).nullable(),
  status: z.string(), view: z.string().nullable(), conversationId: z.string(),
  classification: ClassificationResultSchema.nullable(),
  answerSummary: z.string(), createdAt: z.string(), completedAt: z.string().nullable(),
});
const QueryHistoryResponseSchema = z.object({ items: z.array(QueryHistoryItemSchema), total: z.number() });
const raw = JSON.parse(fs.readFileSync("/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/qh.json","utf8"));
const r = QueryHistoryResponseSchema.safeParse(raw);
console.log("REAL backend query-history vs FAKE-06 schema → success:", r.success);
if(!r.success) console.log("ISSUES:", JSON.stringify(r.error.issues,null,2));
else console.log("  all", raw.items.length, "items pass; intents:", raw.items.map(i=>i.classification?.candidates?.[0]?.intentKey).join(", "));
