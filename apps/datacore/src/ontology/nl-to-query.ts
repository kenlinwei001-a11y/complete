// WO-Phase3-B · §3.4 NL→Query 建议映射（advisory·不进确定性核·R6 确定性正则）。
//
// 定位：确定性正则 + 类型词表把常见问句**建议性**映射为 Query Engine 输入。映射失败 → 返回 null
// （调用方据此诚实回 NO_QUERY_PLAN，绝不编造）；映射成功也仍需 Query Engine 确定性执行
// （核心答案=引擎输出，非 NL）。收益=减少 Agent Path-B round-trip，非「NL 直接变 SQL 秒答」。
// **不碰 orchestrator/composer**（Phase2 territory）。
//
// R14：类型词表是 UI 词汇（基地/订单…→类型 key），非业务实例事实（不硬编基地名/型号名）；
// 实体名从问句里按「修饰词+类型词」正则抽取，作为 rootFilter 值（运行时数据决定真实匹配）。
import type { OntologyQueryInput } from "@platform/contracts";

/** 类型显示词 → 对象类型 key（UI 词汇映射·非业务实例·可随本体扩展）。 */
const TYPE_KEYWORDS: { word: string; typeKey: string }[] = [
  { word: "基地", typeKey: "Base" },
  { word: "订单", typeKey: "Order" },
  { word: "产线", typeKey: "Line" },
  { word: "型号", typeKey: "Model" },
  { word: "物料", typeKey: "Material" },
  { word: "供应商", typeKey: "Supplier" },
  { word: "客户", typeKey: "Customer" },
  { word: "工序", typeKey: "Process" },
];

export interface NlCatalogType {
  key: string;
  searchProps: string[];
}
export interface NlCatalog {
  types: NlCatalogType[];
}

/**
 * 把问句建议映射为 Query Engine 输入。成功 → 部分 OntologyQueryInput（rootType/rootFilter/hops/select）；
 * 失败（识别不出 ≥2 类型 / 类型不在本体）→ null。确定性（同问句同 catalog 同结果·无随机/时钟）。
 */
export function nlToQuery(nl: string, catalog: NlCatalog): Partial<OntologyQueryInput> | null {
  if (!nl || typeof nl !== "string") return null;
  const known = new Set(catalog.types.map((t) => t.key));
  const avail = TYPE_KEYWORDS.filter((k) => known.has(k.typeKey));

  // 按出现位置收集类型词命中 + 紧邻修饰词（如「常州基地」→ 修饰=常州）。
  type Hit = { typeKey: string; word: string; idx: number; entity?: string };
  const hits: Hit[] = [];
  for (const k of avail) {
    let from = 0;
    for (;;) {
      const idx = nl.indexOf(k.word, from);
      if (idx < 0) break;
      const mod = /([一-龥A-Za-z0-9]{1,8})$/.exec(nl.slice(Math.max(0, idx - 8), idx));
      hits.push({ typeKey: k.typeKey, word: k.word, idx, entity: mod?.[1] });
      from = idx + k.word.length;
    }
  }
  if (hits.length < 2) return null;
  hits.sort((a, b) => a.idx - b.idx);

  // 根 = 首个带修饰实体的命中（无则取首个）；目标 = 另一不同类型的命中。
  const rootHit = hits.find((h) => h.entity) ?? hits[0]!;
  const targetHit = hits.find((h) => h.typeKey !== rootHit.typeKey);
  if (!targetHit) return null;

  const query: Partial<OntologyQueryInput> = {
    rootType: rootHit.typeKey,
    hops: [],
    select: [{ type: targetHit.typeKey, fields: pickFields(catalog, targetHit.typeKey) }],
  };
  if (rootHit.entity) query.rootFilter = [{ field: "name", op: "eq", value: rootHit.entity }];
  return query;
}

/** 目标类型的默认投影字段：searchable 字段优先，缺省退主键近似 name/id。 */
function pickFields(catalog: NlCatalog, typeKey: string): string[] {
  const t = catalog.types.find((x) => x.key === typeKey);
  if (t && t.searchProps.length > 0) return t.searchProps.slice(0, 4);
  return ["name"];
}
