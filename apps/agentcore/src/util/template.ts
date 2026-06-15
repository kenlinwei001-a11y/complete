import { resolvePath } from "./jsonpath.js";

/** Error thrown when a {{...}} reference cannot be resolved (→ TEMPLATE_RESOLUTION_ERROR). */
export class TemplateResolutionError extends Error {
  constructor(readonly ref: string) {
    super(`template reference could not be resolved: ${ref}`);
    this.name = "TemplateResolutionError";
  }
}

export interface TemplateScope {
  slots: Record<string, unknown>;
  context: unknown;
  steps: Record<string, unknown>; // stepId -> step output
}

const REF_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function resolveRef(expr: string, scope: TemplateScope): unknown {
  let value: unknown;
  if (expr.startsWith("slots.")) {
    const path = expr.slice("slots.".length);
    // Optional slots filled with null are valid values (not resolution failures).
    if (!path.includes(".") && !path.includes("[")) {
      if (!(path in scope.slots)) throw new TemplateResolutionError(expr);
      return scope.slots[path] ?? null;
    }
    value = resolvePath(scope.slots, "$." + path);
  } else if (expr === "slots") {
    value = scope.slots;
  } else if (expr.startsWith("context.")) {
    value = resolvePath(scope.context, "$." + expr.slice("context.".length));
  } else if (expr === "context") {
    value = scope.context;
  } else if (expr.startsWith("steps.")) {
    // steps.<stepId>.output.<path>
    const m = /^steps\.([\w-]+)\.output(?:\.(.*))?$/.exec(expr);
    if (!m) throw new TemplateResolutionError(expr);
    const stepId = m[1] as string;
    if (!(stepId in scope.steps)) throw new TemplateResolutionError(expr);
    const out = scope.steps[stepId];
    value = m[2] ? resolvePath(out, "$." + m[2]) : out;
  } else {
    throw new TemplateResolutionError(expr);
  }
  if (value === undefined) throw new TemplateResolutionError(expr);
  return value;
}

/**
 * Resolve a template value: strings that are exactly one "{{ref}}" become the referenced
 * value (any type); strings with embedded refs are interpolated; arrays/objects recurse.
 */
export function resolveTemplate(value: unknown, scope: TemplateScope): unknown {
  if (typeof value === "string") {
    const exact = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(value);
    if (exact) return resolveRef(exact[1] as string, scope);
    return value.replace(REF_RE, (_m, expr: string) => {
      const v = resolveRef(expr, scope);
      return typeof v === "string" ? v : JSON.stringify(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplate(v, scope));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTemplate(v, scope);
    }
    return out;
  }
  return value;
}

/** Collect all `{{slots.x}}` slot names referenced anywhere in a template structure. */
export function collectSlotRefs(value: unknown, acc = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const m of value.matchAll(REF_RE)) {
      const expr = (m[1] as string).trim();
      if (expr.startsWith("slots.")) {
        const name = expr.slice("slots.".length).split(/[.[]/)[0];
        if (name) acc.add(name);
      }
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectSlotRefs(v, acc);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectSlotRefs(v, acc);
  }
  return acc;
}
