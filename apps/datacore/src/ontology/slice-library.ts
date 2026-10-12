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

// ── 切片连通性审计（WO-SLICE-CONNECTIVITY · R6 纯函数 · R12 正向闭包） ────────────
// 节点=切片，边=两切片可 join（共享类型 或 桥接 link）；孤岛=度 0 的切片（谁也 join 不上）。
// 形式化「跨切片关联字段必须真实存在本体图」为一道门——检测 §8 G-BUILD-LINK（恒空/孤立切片）。

export interface SliceConnectivityReport {
  /** 全切片 key（字典序）。 */
  slices: string[];
  /** 边：a<b 字典序稳定；via 记连通机制，detail 记依据（共享类型集 或 linkKey+join 字段）。 */
  edges: { a: string; b: string; via: "shared-type" | "bridge-link"; detail: string }[];
  /** 孤岛：度=0 的切片（与任何其他切片无共享类型、无桥接 link）。 */
  islands: { sliceKey: string; reason: string }[];
  /** 每切片度数（相邻切片数；一对切片至多一条边）。 */
  degree: Record<string, number>;
}

/**
 * 审计切片库连通性（确定性 R6·纯计算·无 Date.now/random·同入同出字节一致）。
 * 边判据（满足任一即连，一对切片至多一条边，共享类型优先）：
 *   (a) shared-type：两切片共享 ≥1 个 spannedType；
 *   (b) bridge-link：存在一条 link 桥接「A 的某 spannedType ←link→ B 的某 spannedType」。
 * 自环不算边（同一切片不与自己连）。
 */
export function auditSliceConnectivity(entries: SliceLibEntry[], _types: LibType[], links: LibLink[]): SliceConnectivityReport {
  // 按 sliceKey 去重（首见优先）并按字典序稳定排序。
  const byKey = new Map<string, SliceLibEntry>();
  for (const e of entries) if (!byKey.has(e.sliceKey)) byKey.set(e.sliceKey, e);
  const nodes = [...byKey.values()].sort((a, b) => a.sliceKey.localeCompare(b.sliceKey));
  const slices = nodes.map((n) => n.sliceKey);
  const typeSetOf = new Map(nodes.map((n) => [n.sliceKey, new Set(n.spannedTypes)] as const));

  const degree: Record<string, number> = Object.fromEntries(slices.map((k) => [k, 0]));
  const edges: SliceConnectivityReport["edges"] = [];

  // 桥接 link 候选按 linkKey 字典序，detail 取首条确定性。
  const sortedLinks = links.slice().sort((x, y) => x.linkKey.localeCompare(y.linkKey));

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const aKey = nodes[i]!.sliceKey;
      const bKey = nodes[j]!.sliceKey;
      const aSet = typeSetOf.get(aKey)!;
      const bSet = typeSetOf.get(bKey)!;

      // (a) 共享类型（优先）。
      const shared = [...aSet].filter((t) => bSet.has(t)).sort();
      if (shared.length > 0) {
        edges.push({ a: aKey, b: bKey, via: "shared-type", detail: shared.join(",") });
        degree[aKey]!++;
        degree[bKey]!++;
        continue;
      }

      // (b) 桥接 link：A 某类型 ←link→ B 某类型（任一方向）。
      const bridge = sortedLinks.find(
        (l) => (aSet.has(l.fromTypeKey) && bSet.has(l.toTypeKey)) || (bSet.has(l.fromTypeKey) && aSet.has(l.toTypeKey)),
      );
      if (bridge) {
        edges.push({ a: aKey, b: bKey, via: "bridge-link", detail: `${bridge.linkKey}: ${bridge.fromTypeKey}→${bridge.toTypeKey}` });
        degree[aKey]!++;
        degree[bKey]!++;
      }
    }
  }

  const islands = slices
    .filter((k) => degree[k] === 0)
    .map((sliceKey) => ({ sliceKey, reason: "度=0：与任何其他切片既无共享类型也无桥接 link（无法 join，G-BUILD-LINK 检测面）" }));

  return { slices, edges, islands, degree };
}

/** 转 SliceSpecRecord.spec 形（供 putSliceSpec 登记为一等切片）。 */
export function libEntryToSpec(e: SliceLibEntry): { root: { typeKey: string; selector: Record<string, never> }; paths: SliceLibEntry["paths"]; maxNodes: number } {
  return { root: { typeKey: e.rootType, selector: {} }, paths: e.paths, maxNodes: 500 };
}
