/** Minimal JSON-Schema conformance check (type/properties/required/items/enum) for expectsSchema. */
export function checkJsonSchema(value: unknown, schema: Record<string, unknown>, path = "$"): string[] {
  const errors: string[] = [];
  const type = schema.type as string | undefined;
  if (type) {
    const ok =
      (type === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) ||
      (type === "array" && Array.isArray(value)) ||
      (type === "string" && typeof value === "string") ||
      ((type === "number" || type === "integer") && typeof value === "number") ||
      (type === "boolean" && typeof value === "boolean") ||
      (type === "null" && value === null);
    if (!ok) {
      errors.push(`${path}: expected ${type}, got ${Array.isArray(value) ? "array" : typeof value}`);
      return errors;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) {
    errors.push(`${path}: value not in enum`);
  }
  if (type === "object") {
    const obj = value as Record<string, unknown>;
    const required = (schema.required as string[] | undefined) ?? [];
    for (const r of required) {
      if (!(r in obj)) errors.push(`${path}.${r}: required property missing`);
    }
    const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
    for (const [k, sub] of Object.entries(props)) {
      if (k in obj) errors.push(...checkJsonSchema(obj[k], sub, `${path}.${k}`));
    }
  }
  if (type === "array" && schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    (value as unknown[]).forEach((v, i) =>
      errors.push(...checkJsonSchema(v, schema.items as Record<string, unknown>, `${path}[${i}]`)),
    );
  }
  return errors;
}
