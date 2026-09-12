/** CSV / JSON / XLSX tabular parsing for the file_upload adapter（G-6：xlsx 经 node-xlsx 解析）。 */
import xlsx from "node-xlsx";

/**
 * XLSX 解析（G-6）：取首个工作表，首行为表头 → 每行映射为 {表头: 值}。
 * 复用与 csv/json 相同的"行数组"出口，下游 profileRows/建模/物化链路一致。值保留 xlsx 原生类型。
 */
export function parseXlsx(buf: Buffer): Record<string, unknown>[] {
  const sheets = xlsx.parse(buf);
  const sheet = sheets[0];
  if (!sheet || !Array.isArray(sheet.data) || sheet.data.length === 0) return [];
  const [header, ...dataRows] = sheet.data as unknown[][];
  const keys = (header ?? []).map((h) => String(h ?? "").trim());
  return dataRows
    .filter((r) => Array.isArray(r) && r.some((c) => c != null && c !== ""))
    .map((r) => {
      const obj: Record<string, unknown> = {};
      keys.forEach((k, i) => {
        if (k) obj[k] = (r as unknown[])[i] ?? null;
      });
      return obj;
    });
}

export function parseCsv(text: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, ""); // strip BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      rows.push(cur);
      cur = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0] as string[];
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      const raw = r[idx] ?? "";
      if (raw !== "" && !Number.isNaN(Number(raw)) && raw.trim() !== "") obj[h] = Number(raw);
      else obj[h] = raw;
    });
    return obj;
  });
}

export function parseJsonRows(text: string): Record<string, unknown>[] {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === "object") {
    for (const v of Object.values(parsed)) {
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  throw new Error("JSON file must contain an array of row objects");
}
