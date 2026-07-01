/**
 * WO-SOURCE-TRANSPARENCY · 不变量 R-NO-ORPHAN-SOURCE 审计（消灭"走捷径"·防凭空对象回潮）。
 *
 * 铁律：凡来源为合成/物化（origin.type ∈ {SYNTHETIC, MATERIALIZED}）的 ObjectInstance，
 * **必有可解析的 rawDatasetId**（该 RawDataset 在本租户真实存在）——即每一个业务对象的源数据
 * 都能溯回"数据连接器"页可见的一张原始表（进而可下载 Excel 审计）。凭空对象（无 rawDatasetId
 * 或指向不存在的数据集）= 走捷径，本审计判红。
 *
 * 诚实边界（豁免，非漏洞）：
 *  - MANUAL：人工录入对象，无源数据表天然合理（用户直接建）。
 *  - META：系统本体自反投影（从 SYSTEM-ONTOLOGY.md 确定性重生成），源是文档锚点非 RawDataset。
 *  - 时序（TsSeries/TsPoint）：**诚实归类为派生指标非源数据**（派生自 Base/Line/Process 对象随时间），
 *    不是 ObjectInstance，故不在本审计口径内（D1 分类，见 WO §2.D）。
 *
 * 确定性 R6：纯遍历 + 排序，无时钟/随机。R2：仅本租户。
 */
import type { Repos } from "./repo/repo.js";
import type { ObjectInstance, ObjectTypeDef } from "./domain.js";

export interface OrphanFinding {
  objectId: string;
  type: string;
  originType: string;
  reason: "MISSING_RAW_DATASET_ID" | "DANGLING_RAW_DATASET";
}

export interface OrphanAudit {
  tenantId: string;
  checked: number;
  orphans: OrphanFinding[];
}

/** 从 origin 取 rawDatasetId（SYNTHETIC 有可选 rawDatasetId；MATERIALIZED 用 datasetId）。 */
function rawDatasetIdOf(o: ObjectInstance): string | undefined {
  const org = o.origin;
  if (org.type === "SYNTHETIC") return org.rawDatasetId;
  if (org.type === "MATERIALIZED") return org.datasetId;
  return undefined;
}

/** 需要有源数据表的来源类型（合成/物化都经"数据连接器→RawDataset→物化"链，必可溯源）。 */
function requiresSource(o: ObjectInstance): boolean {
  return o.origin.type === "SYNTHETIC" || o.origin.type === "MATERIALIZED";
}

/**
 * 审计一个租户：遍历全部已发布类型的对象，凡"需要源"的对象若无可解析 rawDatasetId → 凭空。
 * 排除 mergedInto（已并入 golden，不独立存在）。
 */
export async function auditNoOrphanSource(repos: Repos, tenantId: string): Promise<OrphanAudit> {
  const types: ObjectTypeDef[] = await repos.ontologyTypes.list(tenantId, (t) => t.status === "ACTIVE");
  // 已知数据集 id 集（解析是否 dangling）。
  const datasetIds = new Set((await repos.rawDatasets.list(tenantId)).map((d) => d.id));
  const orphans: OrphanFinding[] = [];
  let checked = 0;
  for (const ty of [...types].sort((a, b) => a.key.localeCompare(b.key))) {
    const objs = await repos.objects.listByType(tenantId, ty.key);
    for (const o of objs) {
      if (o.mergedInto) continue;
      if (!requiresSource(o)) continue;
      checked++;
      const rid = rawDatasetIdOf(o);
      if (!rid) {
        orphans.push({ objectId: o.id, type: o.type, originType: o.origin.type, reason: "MISSING_RAW_DATASET_ID" });
      } else if (!datasetIds.has(rid)) {
        orphans.push({ objectId: o.id, type: o.type, originType: o.origin.type, reason: "DANGLING_RAW_DATASET" });
      }
    }
  }
  orphans.sort((a, b) => a.objectId.localeCompare(b.objectId));
  return { tenantId, checked, orphans };
}
