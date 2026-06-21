// A3.2 域内/跨域两库：从本体图（types+links+domains）确定性派生两套切片库——
// ① 域内 biz.<域>.<root>：单域子图（root = 域内首个类型，hops = root 的同域直接邻接）；
// ② 跨域 biz.x.<from>_to_<to>：每个跨域接缝（一条 from.domain≠to.domain 的 link）一张切片（§10.4 接缝=断点高发区）。
// 纯函数确定性（同图同结果 R6）；产物为 SliceSpec 兼容形（可经 putSliceSpec 登记为一等切片、被 QOS 调）。

export interface LibType { key: string; domain?: string }
export interface LibLink { linkKey: string; fromTypeKey: string; toTypeKey: string }

export interface SliceLibEntry {
  sliceKey: string;
  scope: "intra" | "cross";
  rootType: string;
  domain: string;
  spannedTypes: string[];
  spannedDomains: string[];
  /** SliceSpec.spec.paths 兼容形（每 path 一串 {linkKey,direction}）。 */
  paths: { linkKey: string; direction: "out" | "in" }[][];
}

/** 域内库：每域一张（root=域内首个类型 key 字典序，hops=root 的同域直接邻接边）。无同域邻接的域跳过。 */
function deriveIntra(types: LibType[], links: LibLink[]): SliceLibEntry[] {
  const domainOf = new Map(types.map((t) => [t.key, t.domain ?? ""]));
  const byDomain = new Map<string, string[]>();
  for (const t of types) {
    const d = t.domain ?? "";
    if (!d) continue;
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d)!.push(t.key);
  }
  const out: SliceLibEntry[] = [];
  for (const [domain, keys] of [...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const root = keys.slice().sort()[0]!;
    // root 的同域直接邻接边（root 是 from 或 to，且对端同域）。
    const hops: { linkKey: string; direction: "out" | "in"; toType: string }[] = [];
    for (const l of links) {
      if (l.fromTypeKey === root && domainOf.get(l.toTypeKey) === domain) hops.push({ linkKey: l.linkKey, direction: "out", toType: l.toTypeKey });
      else if (l.toTypeKey === root && domainOf.get(l.fromTypeKey) === domain) hops.push({ linkKey: l.linkKey, direction: "in", toType: l.fromTypeKey });
    }
    if (hops.length === 0) continue; // 无同域子图 → 跳过（不造空心切片）
    hops.sort((a, b) => a.toType.localeCompare(b.toType) || a.linkKey.localeCompare(b.linkKey));
    out.push({
      sliceKey: `biz.${domain}.${root.toLowerCase()}`,
      scope: "intra",
      rootType: root,
      domain,
      spannedTypes: [...new Set([root, ...hops.map((h) => h.toType)])].sort(),
      spannedDomains: [domain],
      paths: hops.map((h) => [{ linkKey: h.linkKey, direction: h.direction }]),
    });
  }
  return out;
}

/** 跨域库：每个跨域接缝（from.domain≠to.domain）一张单跳切片，按 sliceKey 去重排序。 */
function deriveCross(types: LibType[], links: LibLink[]): SliceLibEntry[] {
  const domainOf = new Map(types.map((t) => [t.key, t.domain ?? ""]));
  const byKey = new Map<string, SliceLibEntry>();
  for (const l of links) {
    const fd = domainOf.get(l.fromTypeKey) ?? "";
    const td = domainOf.get(l.toTypeKey) ?? "";
    if (!fd || !td || fd === td) continue; // 仅跨域接缝
    const sliceKey = `biz.x.${l.fromTypeKey.toLowerCase()}_to_${l.toTypeKey.toLowerCase()}`;
    if (byKey.has(sliceKey)) continue;
    byKey.set(sliceKey, {
      sliceKey,
      scope: "cross",
      rootType: l.fromTypeKey,
      domain: fd,
      spannedTypes: [l.fromTypeKey, l.toTypeKey].sort(),
      spannedDomains: [fd, td].sort(),
      paths: [[{ linkKey: l.linkKey, direction: "out" }]],
    });
  }
  return [...byKey.values()].sort((a, b) => a.sliceKey.localeCompare(b.sliceKey));
}

/** 派生两库（确定性）。scope 过滤在端点做。 */
export function deriveSliceLibrary(types: LibType[], links: LibLink[]): { intra: SliceLibEntry[]; cross: SliceLibEntry[] } {
  return { intra: deriveIntra(types, links), cross: deriveCross(types, links) };
}

/** 转 SliceSpecRecord.spec 形（供 putSliceSpec 登记为一等切片）。 */
export function libEntryToSpec(e: SliceLibEntry): { root: { typeKey: string; selector: Record<string, never> }; paths: SliceLibEntry["paths"]; maxNodes: number } {
  return { root: { typeKey: e.rootType, selector: {} }, paths: e.paths, maxNodes: 500 };
}
