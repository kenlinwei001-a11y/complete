/**
 * JSONPath-lite resolver (QOS-PRD §5.2.2).
 * Supports only: `$` root, `.field` property access, `[n]` array index.
 * Returns undefined for malformed paths or when traversal hits null/undefined.
 */
export function resolvePath(root: unknown, path: string): unknown {
  if (typeof path !== "string" || path.length === 0) return undefined;
  let rest = path.trim();
  if (rest.startsWith("$")) rest = rest.slice(1);
  let cur: unknown = root;
  while (rest.length > 0) {
    if (cur === null || cur === undefined) return undefined;
    if (rest.startsWith(".")) {
      const m = /^\.([A-Za-z_$一-鿿][\w$一-鿿-]*)/.exec(rest);
      if (!m) return undefined;
      const field = m[1] as string;
      if (typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[field];
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith("[")) {
      const m = /^\[(\d+)\]/.exec(rest);
      if (!m) return undefined;
      const idx = Number(m[1]);
      if (!Array.isArray(cur)) return undefined;
      cur = cur[idx];
      rest = rest.slice(m[0].length);
    } else {
      return undefined;
    }
  }
  return cur ?? undefined;
}
