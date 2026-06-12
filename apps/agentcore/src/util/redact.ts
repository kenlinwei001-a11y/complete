import { createHash } from "node:crypto";

const SENSITIVE_KEY_RE = /(password|token|secret)/i;

/** Deep-copy a value replacing values of sensitive keys with "[REDACTED]" (QOS-PRD §10.4). */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex");
}

export function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "null");
}
