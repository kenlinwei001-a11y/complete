import type { ProcessingSpec, AttributeMapping, WfAggFn, MaskRule } from "@platform/contracts";

/**
 * OntoFlow（PRD v2）P2：数据处理引擎 —— 把（事件/主数据）行按 ProcessingSpec
 * 分组折叠成实体记录：逐属性类型转换 + 聚合函数(Last/First/Sum/Max/Min/Avg/Count) +
 * 分组/窗口 + 失效标记 + 脱敏。纯函数、确定性（同输入字节级一致；分组按插入序，组内按输入序）。
 */

export interface EntityRecord {
  key: string; // 主键值（或分组键）
  props: Record<string, unknown>;
  expired?: boolean;
}

function cast(v: unknown, dt: AttributeMapping["dataType"]): unknown {
  if (v === undefined || v === null) return v;
  switch (dt) {
    case "Double": return Number(v);
    case "Int": return Math.trunc(Number(v));
    case "Boolean": return v === true || v === "true" || v === 1 || v === "1";
    case "String": return String(v);
    case "Date": return String(v);
    case "Json": return v;
  }
}

/** 组内折叠（与 timeseries 聚合同族；Last/First 按输入序，数值聚合用 Number）。 */
export function fold(rows: Record<string, unknown>[], fn: WfAggFn, field: string): unknown {
  if (rows.length === 0) return undefined;
  const vals = rows.map((r) => r[field]);
  switch (fn) {
    case "Last": return vals[vals.length - 1];
    case "First": return vals[0];
    case "Count": return rows.length;
    case "Sum": return round(vals.reduce((s: number, v) => s + num(v), 0));
    case "Avg": return round(vals.reduce((s: number, v) => s + num(v), 0) / rows.length);
    case "Max": return Math.max(...vals.map(num));
    case "Min": return Math.min(...vals.map(num));
  }
}
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function bucket(v: unknown, step: number): string {
  const n = Number(v);
  if (Number.isFinite(n) && step > 0) return String(Math.floor(n / step) * step);
  return String(v); // 非数值：原值分组（step 仅对数值生效）
}

function applyMask(props: Record<string, unknown>, rules: MaskRule[] | undefined): void {
  for (const r of rules ?? []) {
    if (!(r.prop in props)) continue;
    const v = String(props[r.prop] ?? "");
    if (r.strategy === "REDACT") props[r.prop] = "***";
    else if (r.strategy === "HASH") props[r.prop] = `h:${fnv(v)}`;
    else if (r.strategy === "PARTIAL") props[r.prop] = v.length <= 2 ? "**" : `${v[0]}***${v[v.length - 1]}`;
  }
}
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

/** 主运行：rows + spec → 实体记录数组。 */
export function runProcessing(rows: Record<string, unknown>[], spec: ProcessingSpec): EntityRecord[] {
  const mappings = spec.mappings ?? [];
  const pkMapping = mappings.find((m) => m.isPrimaryKey);
  const groupFields = spec.groupBy?.fields?.length ? spec.groupBy.fields : pkMapping ? [pkMapping.sourceField] : [];
  const win = spec.groupBy?.window;

  // 分组（插入序）
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const parts = groupFields.map((f) => String(row[f] ?? ""));
    if (win) parts.push(bucket(row[win.field], win.step));
    const gk = parts.join("");
    (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(row);
  }

  // 失效参考点：全量 expiry.field 的最大值（确定性）
  let refMs: number | undefined;
  if (spec.expiry) {
    for (const r of rows) {
      const t = Date.parse(String(r[spec.expiry.field] ?? ""));
      if (!Number.isNaN(t)) refMs = refMs === undefined ? t : Math.max(refMs, t);
    }
  }

  const out: EntityRecord[] = [];
  for (const [gk, grows] of groups) {
    const props: Record<string, unknown> = {};
    for (const m of mappings) props[m.targetProp] = cast(fold(grows, m.fn, m.sourceField), m.dataType);
    let expired = false;
    if (spec.expiry && refMs !== undefined) {
      let recMs: number | undefined;
      for (const r of grows) {
        const t = Date.parse(String(r[spec.expiry.field] ?? ""));
        if (!Number.isNaN(t)) recMs = recMs === undefined ? t : Math.max(recMs, t);
      }
      if (recMs !== undefined && (refMs - recMs) / 86400000 > spec.expiry.ttlDays) expired = true;
    }
    applyMask(props, spec.masking);
    const key = pkMapping ? String(props[pkMapping.targetProp] ?? gk) : gk;
    out.push({ key, props, ...(expired ? { expired: true } : {}) });
  }
  return out;
}
