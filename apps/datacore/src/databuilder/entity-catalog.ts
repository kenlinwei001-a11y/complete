import type { AuthCtx } from "../domain.js";
import type { ObjectTypeDef } from "../domain.js";
import type { OntologyService } from "../ontology.js";

/**
 * 实体与字段目录索引（PRD-fde §3.2，P1 读模型版，不复制真值——实时查 repos.objects/类型）。
 * 解决两件事：① 问题消歧（"C客户/常州" → 系统里具体存在的实体候选,绝不带占位符进数据生成）；
 * ② 知现有字段明细（类型→字段,标出时序字段/主键/单位）——这是元本体(只到 type key)没有的层。
 * 纯函数 + 薄服务,确定性（R6）。
 */

/** 归一化编辑距离相似度 + 子串包含（CJK/拉丁通用,确定性）。 */
export function entitySimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  const dp = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) dp[j] = j;
  for (let i = 1; i <= la; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  const lev = 1 - dp[lb]! / Math.max(la, lb);
  const contains = a.includes(b) || b.includes(a) ? Math.min(la, lb) / Math.max(la, lb) : 0;
  return Math.max(lev, contains);
}

export interface FieldCatalogEntry {
  typeKey: string;
  displayName: string;
  domain?: string;
  primaryKey: string | null;
  fields: { name: string; dataType: string; isPrimaryKey: boolean; temporal: boolean; unit?: string; refToTypeKey?: string | null }[];
}

/** 字段目录：每个已发布对象类型 → 字段明细（含 temporal 时序标记）。 */
export function buildFieldCatalog(types: ObjectTypeDef[]): FieldCatalogEntry[] {
  return types
    .filter((t) => t.status === "ACTIVE")
    .map((t) => ({
      typeKey: t.key,
      displayName: t.displayName,
      domain: t.domain,
      primaryKey: t.properties.find((p) => p.isPrimaryKey)?.propKey ?? null,
      fields: t.properties.map((p) => ({
        name: p.propKey,
        dataType: p.dataType,
        isPrimaryKey: p.isPrimaryKey,
        temporal: p.temporal ?? false,
        ...(p.unit ? { unit: p.unit } : {}),
        refToTypeKey: p.refToTypeKey ?? null,
      })),
    }));
}

export interface EntityCandidate {
  typeKey: string;
  objectId: string;
  label: string;
  score: number;
}

/** 对一组对象行按相似度打分（纯函数）：取 props 内 PK/名称/string 值与 q 的最高相似度。 */
export function scoreEntities(q: string, typeKey: string, rows: { id: string; props: Record<string, unknown> }[], minScore: number): EntityCandidate[] {
  const out: EntityCandidate[] = [];
  for (const r of rows) {
    let best = { v: "", score: 0 };
    for (const v of Object.values(r.props)) {
      if (typeof v !== "string") continue;
      const s = entitySimilarity(q, v);
      if (s > best.score) best = { v, score: s };
    }
    if (best.score >= minScore) out.push({ typeKey, objectId: best.v, label: best.v, score: Number(best.score.toFixed(3)) });
  }
  return out;
}

/**
 * 消歧：把模糊实体 q 解析成系统里具体存在的候选（跨类型或指定类型）。
 * 命中 → 钉具体名;空 → 域外（调用方走 InputManifest 补录,不猜）。确定性排序（R6）。
 */
export async function resolveEntity(
  ctx: AuthCtx,
  q: string,
  ontology: OntologyService,
  opts: { type?: string; topK?: number; minScore?: number; perType?: number } = {},
): Promise<EntityCandidate[]> {
  const topK = opts.topK ?? 5;
  const minScore = opts.minScore ?? 0.34;
  const perType = opts.perType ?? 200;
  const types = opts.type ? [opts.type] : (await ontology.listTypes(ctx)).filter((t) => t.status === "ACTIVE").map((t) => t.key);
  const all: EntityCandidate[] = [];
  for (const typeKey of types) {
    const payload = await ontology.queryObjects(ctx, typeKey, {}, perType);
    const rows = (payload.data as { id: string; props: Record<string, unknown> }[]) ?? [];
    all.push(...scoreEntities(q, typeKey, rows, minScore));
  }
  all.sort((a, b) => b.score - a.score || `${a.typeKey}${a.objectId}`.localeCompare(`${b.typeKey}${b.objectId}`));
  return all.slice(0, topK);
}
