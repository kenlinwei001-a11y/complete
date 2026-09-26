import zh from "@/locales/zh";

/**
 * JSONSchema → 表单生成器（PRD §7.4）。
 * 支持 string / number / boolean / enum / secret；
 * secret：输入 type=password，已保存值不回显（占位 ******，留空表示不修改）。
 */
export interface JsonSchemaFormProps {
  schema: Record<string, unknown>;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  /** 已保存过的 secret 字段集合（不回显） */
  savedSecrets?: string[];
}

interface FieldSchema {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  format?: string; // "secret"
  default?: unknown;
}

export function isSecretField(f: FieldSchema): boolean {
  return f.format === "secret" || f.type === "secret";
}

export function JsonSchemaForm({ schema, value, onChange, savedSecrets = [] }: JsonSchemaFormProps) {
  const properties = (schema.properties ?? {}) as Record<string, FieldSchema>;
  const required = (schema.required ?? []) as string[];

  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {Object.entries(properties).map(([key, f]) => {
        const label = f.title ?? key;
        const req = required.includes(key);
        const id = `jsf-${key}`;
        const secret = isSecretField(f);
        const saved = secret && savedSecrets.includes(key);
        let control: React.ReactNode;

        if (secret) {
          control = (
            <input
              id={id}
              type="password"
              autoComplete="new-password"
              placeholder={saved ? "******（已保存，不回显）" : ""}
              value={(value[key] as string) ?? ""}
              onChange={(e) => set(key, e.target.value)}
            />
          );
        } else if (Array.isArray(f.enum)) {
          control = (
            <select id={id} value={(value[key] as string) ?? ""} onChange={(e) => set(key, e.target.value)}>
              <option value="" disabled>
                请选择
              </option>
              {f.enum.map((opt) => (
                <option key={String(opt)} value={String(opt)}>
                  {String(opt)}
                </option>
              ))}
            </select>
          );
        } else if (f.type === "boolean") {
          control = (
            <input
              id={id}
              type="checkbox"
              checked={Boolean(value[key] ?? f.default ?? false)}
              onChange={(e) => set(key, e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
          );
        } else if (f.type === "number" || f.type === "integer") {
          control = (
            <input
              id={id}
              type="number"
              value={value[key] == null ? "" : String(value[key])}
              onChange={(e) => set(key, e.target.value === "" ? undefined : Number(e.target.value))}
            />
          );
        } else {
          control = (
            <input
              id={id}
              type="text"
              value={(value[key] as string) ?? ""}
              onChange={(e) => set(key, e.target.value)}
            />
          );
        }

        return (
          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor={id} style={{ fontSize: 12, color: "var(--muted)" }}>
              {label}
              {req && <span style={{ color: "var(--danger-txt)" }}> *</span>}
              {secret && (
                <span className="badge amber" style={{ marginLeft: 6 }}>
                  secret
                </span>
              )}
            </label>
            {control}
            {f.description && <span style={{ fontSize: 12, color: "var(--muted2)" }}>{f.description}</span>}
            {secret && <span style={{ fontSize: 12, color: "var(--muted2)" }}>{zh.admin.connections.secretNoEcho}</span>}
          </div>
        );
      })}
    </div>
  );
}
