import type { FieldProfile } from "@platform/contracts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function inferType(values: unknown[]): FieldProfile["inferredType"] {
  let num = 0;
  let bool = 0;
  let date = 0;
  let json = 0;
  let str = 0;
  for (const v of values) {
    if (typeof v === "number") num++;
    else if (typeof v === "boolean") bool++;
    else if (typeof v === "object" && v !== null) json++;
    else if (typeof v === "string") {
      if (DATE_RE.test(v)) date++;
      else if (v.trim() !== "" && !Number.isNaN(Number(v))) num++;
      else if (v === "true" || v === "false") bool++;
      else str++;
    }
  }
  const total = num + bool + date + json + str;
  if (total === 0) return "string";
  if (json / total > 0.5) return "json";
  if (date / total > 0.8) return "date";
  if (bool / total > 0.8) return "boolean";
  if (num / total > 0.8) return "number";
  return "string";
}

/** Field profiles: inferredType, samples, nullRate, uniqueRate, enumCandidates (PRD §2.1). */
export function profileRows(rows: Record<string, unknown>[]): FieldProfile[] {
  const fieldNames: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) if (!fieldNames.includes(k)) fieldNames.push(k);
  }
  return fieldNames.map((name) => {
    const all = rows.map((r) => r[name]);
    const nonNull = all.filter((v) => v !== null && v !== undefined && v !== "");
    const distinct = new Map<string, unknown>();
    for (const v of nonNull) {
      const key = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (!distinct.has(key)) distinct.set(key, v);
    }
    const nullRate = rows.length === 0 ? 0 : (all.length - nonNull.length) / rows.length;
    const uniqueRate = nonNull.length === 0 ? 0 : distinct.size / nonNull.length;
    const inferredType = inferType(nonNull);
    const profile: FieldProfile = {
      name,
      inferredType,
      samples: [...distinct.values()].slice(0, 5),
      nullRate: Math.round(nullRate * 1000) / 1000,
      uniqueRate: Math.round(uniqueRate * 1000) / 1000,
    };
    // Enum candidates: few distinct non-numeric values repeated across rows.
    if (
      inferredType === "string" &&
      distinct.size > 0 &&
      distinct.size <= 10 &&
      nonNull.length >= distinct.size * 2
    ) {
      profile.enumCandidates = [...distinct.keys()];
    }
    return profile;
  });
}
