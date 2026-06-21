// 原型 intake 正门（HTML → IntakeResult）+ schema 对账（列 ↔ 既有字段，确定性 + 候选 HITL）。
// 安全：**绝不 eval 不可信输入**——用受限正则定位 `const NAME = [...]`/`{...}` 字面量，轻量归一后 JSON.parse，
// 失败即入 unparsed（诚实不静默丢）。确定性（R6）：同 HTML 同输出（解析与对账皆纯函数）。
import type { IntakeResult, ProtoDataset, ProtoLink, ReconcilePreview, SchemaReconcileCandidate } from "@platform/contracts";

/** 把 JS 对象/数组字面量轻量归一为 JSON（不 eval）：去注释/尾逗号、单引号→双、裸键加引号。受限、失败回退 unparsed。 */
function normalizeLiteralToJson(src: string): string {
  let s = src;
  s = s.replace(/\/\/[^\n]*/g, ""); // 行注释
  s = s.replace(/\/\*[\s\S]*?\*\//g, ""); // 块注释
  s = s.replace(/'((?:[^'\\]|\\.)*)'/g, (_m, inner) => `"${String(inner).replace(/"/g, '\\"')}"`); // 单引号串→双引号
  s = s.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":'); // 裸键加引号
  s = s.replace(/,(\s*[}\]])/g, "$1"); // 尾逗号
  return s;
}

/** 平衡扫描：从 `[` 或 `{` 起取到匹配闭合（含字符串内括号跳过）。 */
function extractBalanced(text: string, start: number): { literal: string; end: number } | undefined {
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0, inStr = false, q = "";
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return { literal: text.slice(start, i + 1), end: i + 1 }; }
  }
  return undefined;
}

const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
const CONST_RE = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([[{])/g;
const L_RE = /\bL\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g;

/** 解析原型 HTML → 数据表 + 关系 + 未解析块（确定性）。 */
export function parsePrototypeHtml(html: string): IntakeResult {
  const scripts: string[] = [];
  let m: RegExpExecArray | null;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(html))) scripts.push(m[1]!);
  const code = scripts.length > 0 ? scripts.join("\n") : html; // 无 <script> 则全文兜底

  const dataSources: ProtoDataset[] = [];
  const unparsed: { name: string; reason: string }[] = [];
  const seen = new Set<string>();

  CONST_RE.lastIndex = 0;
  while ((m = CONST_RE.exec(code))) {
    const name = m[1]!;
    const bracePos = m.index + m[0].length - 1;
    const bal = extractBalanced(code, bracePos);
    if (!bal) { if (!seen.has(name)) { unparsed.push({ name, reason: "未找到匹配闭合括号" }); seen.add(name); } continue; }
    let value: unknown;
    try { value = JSON.parse(normalizeLiteralToJson(bal.literal)); }
    catch { if (!seen.has(name)) { unparsed.push({ name, reason: "字面量非受限 JSON（含函数/表达式）" }); seen.add(name); } CONST_RE.lastIndex = bal.end; continue; }
    CONST_RE.lastIndex = bal.end;
    if (seen.has(name)) continue;
    // 仅"对象数组"算数据表（每行一对象）。
    if (Array.isArray(value) && value.length > 0 && value.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
      const rows = value as Record<string, unknown>[];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      dataSources.push({ name, columns: cols, rowCount: rows.length, sampleRows: rows.slice(0, 3) });
      seen.add(name);
    } else {
      unparsed.push({ name, reason: Array.isArray(value) ? "非对象数组（标量/嵌套数组）" : "对象字面量（非数据表）" });
      seen.add(name);
    }
  }
  dataSources.sort((a, b) => a.name.localeCompare(b.name));

  // 关系：① L(src,tgt,rel) 显式；② ref 命名约定（列 xxxRef/xxxId 指向同名数据表）。
  const links: ProtoLink[] = [];
  const linkSeen = new Set<string>();
  const addLink = (l: ProtoLink) => { const k = `${l.from}|${l.to}|${l.rel}|${l.origin}`; if (!linkSeen.has(k)) { linkSeen.add(k); links.push(l); } };
  L_RE.lastIndex = 0;
  while ((m = L_RE.exec(code))) addLink({ from: m[1]!, to: m[2]!, rel: m[3]!, origin: "explicit" });
  const dsNames = new Map(dataSources.map((d) => [d.name.toLowerCase(), d.name]));
  for (const d of dataSources) {
    for (const col of d.columns) {
      const ref = /^(.*?)(Ref|Id)$/.exec(col);
      if (!ref || !ref[1]) continue;
      const target = dsNames.get(ref[1].toLowerCase()) ?? dsNames.get(`${ref[1].toLowerCase()}s`);
      if (target && target !== d.name) addLink({ from: d.name, to: target, rel: col, origin: "ref" });
    }
  }
  links.sort((a, b) => (a.from + a.to + a.rel).localeCompare(b.from + b.to + b.rel));

  return { dataSources, links, unparsed };
}

const norm = (s: string): string => s.toLowerCase().replace(/[_\s-]/g, "");

export interface ExistingTypeField { typeKey: string; propKey: string }

/**
 * schema 对账：原型列 ↔ 既有本体字段（确定性）。
 * - 归一名精确命中唯一既有字段 → autoMapped；
 * - 多命中/子串/无命中 → SchemaReconcileCandidate（按分降序，建议 USE/NEW），交人确认（不调 LLM）。
 */
export function reconcileIntake(datasets: ProtoDataset[], existing: ExistingTypeField[]): ReconcilePreview {
  const autoMapped: ReconcilePreview["autoMapped"] = [];
  const candidates: SchemaReconcileCandidate[] = [];
  for (const d of datasets) {
    for (const col of d.columns) {
      const nc = norm(col);
      const scored = existing
        .map((e) => ({ e, score: norm(e.propKey) === nc ? 1 : norm(e.propKey).includes(nc) || nc.includes(norm(e.propKey)) ? 0.5 : 0 }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.e.typeKey.localeCompare(b.e.typeKey) || a.e.propKey.localeCompare(b.e.propKey));
      const exact = scored.filter((x) => x.score === 1);
      if (exact.length === 1) {
        autoMapped.push({ datasetName: d.name, column: col, targetType: exact[0]!.e.typeKey, targetField: exact[0]!.e.propKey });
      } else {
        candidates.push({
          datasetName: d.name,
          prototypeColumn: col,
          candidates: scored.slice(0, 5).map((x) => ({ targetType: x.e.typeKey, targetField: x.e.propKey, score: x.score })),
          suggestedAction: scored.length > 0 ? "USE" : "NEW",
          status: "PENDING",
        });
      }
    }
  }
  return { autoMapped, candidates };
}
