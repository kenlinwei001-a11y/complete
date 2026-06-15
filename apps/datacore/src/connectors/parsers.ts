/** CSV / JSON / XLSX tabular parsing for the file_upload adapter. */
import { inflateRawSync } from "node:zlib";

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

// ---------------------------------------------------------------------------
// XLSX（OntoFlow P2）：最小 ZIP 读取（stored/method0 + deflate/method8）+ 单 sheet 解析。
// 仅取 sheet1 + sharedStrings；首行表头；不支持公式求值/多 sheet/样式（按 PRD 最小子集）。
// ---------------------------------------------------------------------------

/** 从 ZIP buffer 提取指定文件名的解压内容（遍历中央目录）。 */
function unzipEntries(buf: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // 找 End Of Central Directory（签名 0x06054b50），从尾部回扫
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("xlsx: 不是合法的 ZIP（无 EOCD）");
  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42); // local header offset
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (wanted(name)) {
      // 解析 local header 取真实数据起点（本地 extra 长度可能不同）
      const lNameLen = buf.readUInt16LE(lho + 26);
      const lExtraLen = buf.readUInt16LE(lho + 28);
      const dataStart = lho + 30 + lNameLen + lExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      out.set(name, method === 0 ? Buffer.from(comp) : inflateRawSync(comp));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function xmlMatches(xml: string, re: RegExp): RegExpMatchArray[] {
  return [...xml.matchAll(re)];
}
const xmlUnescape = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#10;/g, "\n").replace(/&apos;/g, "'");

/** col 字母（A,B,...,AA）→ 0 起列序。 */
function colIndex(ref: string): number {
  const letters = ref.replace(/[0-9]+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseXlsx(buf: Buffer): Record<string, unknown>[] {
  const files = unzipEntries(buf, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet1\.xml$/.test(n));
  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = xmlMatches(sharedXml, /<si\b[^>]*>([\s\S]*?)<\/si>/g).map((m) => {
    // <si> 可能含多个 <t>（富文本），拼接
    const ts = xmlMatches(m[1] ?? "", /<t\b[^>]*>([\s\S]*?)<\/t>/g).map((x) => xmlUnescape(x[1] ?? ""));
    return ts.join("");
  });
  const sheetXml = files.get("xl/worksheets/sheet1.xml")?.toString("utf8") ?? "";
  const rowsXml = xmlMatches(sheetXml, /<row\b[^>]*>([\s\S]*?)<\/row>/g);
  const grid: string[][] = [];
  for (const rm of rowsXml) {
    const cells = xmlMatches(rm[1] ?? "", /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g);
    const rowArr: string[] = [];
    for (const cm of cells) {
      const attrs = (cm[1] ?? cm[3] ?? "");
      const inner = cm[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const vRaw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
      const inlineT = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
      let val: string;
      if (type === "s") val = shared[Number(vRaw)] ?? "";
      else if (type === "inlineStr" && inlineT !== undefined) val = xmlUnescape(inlineT);
      else val = xmlUnescape(vRaw);
      const ci = ref ? colIndex(ref) : rowArr.length;
      rowArr[ci] = val;
    }
    grid.push(rowArr);
  }
  const nonEmpty = grid.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0] as string[];
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      if (!h) return;
      const raw = r[idx] ?? "";
      obj[h] = raw !== "" && raw.trim() !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
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
