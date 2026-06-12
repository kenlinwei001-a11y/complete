import type { ProvenanceRef } from "@platform/contracts";
import { resolvePath } from "../util/jsonpath.js";

/**
 * Provenance passthrough (A8.3 / S4.1):
 * - query_timeseries_agg outputs carry `data.tsAgg` (aggRunId/specKey/window/rowsIn)
 *   → ProvenanceRef source TS_AGGREGATE + tsAgg meta;
 * - search_knowledge hits carry docId/span/source/score
 *   → ProvenanceRef source KB_CHUNK + kb meta (hit picked via outputPath when possible).
 * Everything else stays TOOL_RESULT.
 */

export type ProvenanceEnrichment = Pick<ProvenanceRef, "source"> & Partial<Pick<ProvenanceRef, "tsAgg" | "kb">>;

interface TsAggMeta {
  aggRunId: string;
  specKey: string;
  window: { start: string; end: string };
  rowsIn: number;
}

function isTsAggMeta(v: unknown): v is TsAggMeta {
  if (v === null || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.aggRunId === "string" &&
    typeof m.specKey === "string" &&
    typeof m.rowsIn === "number" &&
    m.window !== null &&
    typeof m.window === "object"
  );
}

interface KbHitLike {
  docId: string;
  span: { start: number; end: number };
  source?: string;
  score?: number;
}

function isKbHit(v: unknown): v is KbHitLike {
  if (v === null || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return typeof m.docId === "string" && m.span !== null && typeof m.span === "object";
}

/**
 * Derive enriched provenance source + meta from an audited tool output.
 * `outputPath` (when given) points into the output, e.g. "$.data.hits[0]".
 */
export function enrichProvenance(
  toolName: string | undefined,
  output: unknown,
  outputPath?: string,
): ProvenanceEnrichment {
  if (!toolName || output === null || output === undefined || typeof output !== "object") {
    return { source: "TOOL_RESULT" };
  }
  const data = (output as Record<string, unknown>).data as Record<string, unknown> | undefined;

  if (toolName === "query_timeseries_agg") {
    const tsAgg = data?.tsAgg;
    if (isTsAggMeta(tsAgg)) {
      return {
        source: "TS_AGGREGATE",
        tsAgg: { aggRunId: tsAgg.aggRunId, specKey: tsAgg.specKey, window: tsAgg.window, rowsIn: tsAgg.rowsIn },
      };
    }
  }

  if (toolName === "search_knowledge") {
    let hit: unknown = outputPath ? resolvePath(output, outputPath) : undefined;
    if (Array.isArray(hit)) hit = hit[0];
    if (!isKbHit(hit)) {
      const hits = data?.hits;
      hit = Array.isArray(hits) ? hits[0] : undefined;
    }
    if (isKbHit(hit)) {
      return {
        source: "KB_CHUNK",
        kb: {
          docId: hit.docId,
          span: hit.span,
          ...(hit.source !== undefined ? { sourceName: hit.source } : {}),
          ...(hit.score !== undefined ? { score: hit.score } : {}),
        },
      };
    }
  }

  return { source: "TOOL_RESULT" };
}
