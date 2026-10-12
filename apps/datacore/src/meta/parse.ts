/**
 * Dogfooding P1 · 系统本体解析（纯函数,确定性 R6）：SYSTEM-ONTOLOGY.md + prd-ontology-index.json
 * → 八类元对象记录 + 关系。优先用机器可读 index（不变量/断点/PRD覆盖/PRD↔R-G）,
 * 仅断点状态/事件/域/切片走 markdown 轻量正则。同输入同输出（字节级一致）。
 */

export interface MetaNode {
  kind: "SystemInvariant" | "SystemBreakpoint" | "SystemEvent" | "SystemDomain" | "SystemObjectType" | "SystemGate" | "SystemSlice";
  key: string;
  props: Record<string, unknown>;
}
export interface MetaEdge {
  from: string; // "<kind>:<key>"
  to: string;
  kind: "related_to" | "covered_by" | "detected_at" | "in_domain" | "references";
  label?: string;
}
export interface MetaParseResult {
  nodes: MetaNode[];
  edges: MetaEdge[];
}

interface PrdIndex {
  ontology: { invariants: string[]; breakpoints: string[] };
  breakpointCoverage: Record<string, string[]>;
  prds: Record<string, { invariants?: string[]; breakpoints?: string[]; artifacts?: string[] }>;
}

const nodeId = (kind: MetaNode["kind"], key: string) => `${kind}:${key}`;

/** §8 断点表行 → 状态（✅已修/◐部分/⬜未修）+ 关联不变量(R*) + 链路位置（第3列）。 */
function parseBreakpointRow(md: string, g: string): { status: string; relatedInvariants: string[]; linkPosition: string } {
  const line = md.split("\n").find((l) => new RegExp(`^\\|\\s*${g}\\s*\\|`).test(l)) ?? "";
  const cols = line.split("|").map((c) => c.trim());
  const body = cols[2] ?? "";
  const status = /✅/.test(body) ? "FIXED" : /◐/.test(body) ? "PARTIAL" : /⬜|未修/.test(body) ? "OPEN" : "UNKNOWN";
  const relatedInvariants = [...new Set([...body.matchAll(/\bR(\d+)\b/g)].map((m) => `R${m[1]}`))];
  return { status, relatedInvariants, linkPosition: (cols[3] ?? "").slice(0, 120) };
}

export function parseMetaOntology(ontologyMd: string, prdIndex: PrdIndex): MetaParseResult {
  const nodes: MetaNode[] = [];
  const edges: MetaEdge[] = [];
  const push = (n: MetaNode) => nodes.push(n);
  const link = (e: MetaEdge) => edges.push(e);

  // ① 不变量 R*（index 权威）
  const invariants = [...prdIndex.ontology.invariants].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  for (const r of invariants) push({ kind: "SystemInvariant", key: r, props: { id: r } });

  // ② 断点 G*（index 给 id + PRD 覆盖;markdown §8 给状态 + 关联不变量 + 链路位置）
  for (const g of [...prdIndex.ontology.breakpoints].sort()) {
    const { status, relatedInvariants, linkPosition } = parseBreakpointRow(ontologyMd, g);
    const relatedPRDs = prdIndex.breakpointCoverage[g] ?? [];
    push({ kind: "SystemBreakpoint", key: g, props: { id: g, status, linkPosition, relatedInvariants, relatedPRDs } });
    for (const r of relatedInvariants) if (invariants.includes(r)) link({ from: nodeId("SystemBreakpoint", g), to: nodeId("SystemInvariant", r), kind: "related_to" });
  }

  // ③ 事件 §4（反引号 x.y;排除文件名扩展,只取领域事件）
  const FILE_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|sql|csv|txt|html|yaml|yml|sh|conf)$/;
  const events = [...new Set([...ontologyMd.matchAll(/`([a-z0-9_]+\.[a-z0-9_]+)`/g)].map((m) => m[1] as string))]
    .filter((e) => !FILE_EXT.test(e))
    .sort();
  for (const e of events) push({ kind: "SystemEvent", key: e, props: { name: e } });

  // ④ 域 §10（**Dn ...** 形态）
  const domains = [...new Set([...ontologyMd.matchAll(/\*\*(D\d+)\s+([^*（(]+?)\*\*/g)].map((m) => `${m[1]}|${(m[2] as string).trim()}`))];
  for (const d of domains) { const [id, name] = d.split("|"); push({ kind: "SystemDomain", key: id!, props: { id, name } }); }

  // ⑤ 切片 §3/§10（sys.x.y backtick 键）
  const slices = [...new Set([...ontologyMd.matchAll(/`(sys\.[a-z_]+\.[a-z_]+)`/g)].map((m) => m[1] as string))].sort();
  for (const s of slices) push({ kind: "SystemSlice", key: s, props: { key: s } });

  // ⑥ 门禁 §7（check-*.mjs 脚本 → 门名）
  const gates = [...new Set([...ontologyMd.matchAll(/`((?:ontology|chain|debattery|prd|prd:coverage|meta):check|check-[a-z-]+\.mjs)`/g)].map((m) => m[1] as string))].sort();
  for (const ga of gates) push({ kind: "SystemGate", key: ga, props: { name: ga } });

  // ⑦ 对象类型 §2（**Name**：... 行首加粗的制品名,轻量抽取）
  const objectTypes = [...new Set([...ontologyMd.matchAll(/^- \*\*([A-Z][A-Za-z0-9 /]+?)\*\*/gm)].map((m) => (m[1] as string).split("/")[0]!.trim()))]
    .filter((k) => k.length >= 2 && k.length <= 40);
  for (const ot of objectTypes) push({ kind: "SystemObjectType", key: ot, props: { key: ot } });

  // ⑧ 关系：PRD ↔ 不变量/断点（index prds[] 权威）→ references / covered_by
  for (const [prd, ref] of Object.entries(prdIndex.prds)) {
    for (const r of ref.invariants ?? []) if (invariants.includes(r)) link({ from: nodeId("SystemInvariant", r), to: `PRD:${prd}`, kind: "covered_by", label: "PRD 引用" });
    for (const g of ref.breakpoints ?? []) link({ from: nodeId("SystemBreakpoint", g), to: `PRD:${prd}`, kind: "covered_by", label: "PRD 覆盖" });
  }

  return { nodes, edges };
}
