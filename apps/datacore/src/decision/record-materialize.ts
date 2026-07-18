/**
 * WO-CEO-DATA-supply · 真源记录**颗粒级**物化（纯函数·无仓储/IO·可单测）。
 *
 * 命门 · 颗粒不聚合：一条真源行 → **一个**真对象（1:1），**绝不聚合**。聚合留给下游确定性派生层
 *   （`derive/decision-fields` / 求解器），故驾驶舱任一数字可逐值下钻回一条真 RawDataset 行（R13）。
 *
 * R14：零业务常数——列→属性映射由调用方（导入方以数据）提供；本文件只做通用强转/装配。
 * R6：同 (rows, mapping, schema) → 字节级同 objects（对象 id/props/origin 无 Date.now/随机；行序即序）。
 */
import type { PropertyDef } from "../domain.js";

export interface MaterializeRecordsInput {
  targetType: string;
  /** 目标已发布类型的属性规格（判主键 + number 列强转）。 */
  props: PropertyDef[];
  /** 真源行（rawRows·原始颗粒）。 */
  rows: Record<string, unknown>[];
  /** 真源列 → 目标 propKey。 */
  columnMapping: Record<string, string>;
  /** 真源主键列名（缺省时取映射到主键属性的那一列）。 */
  primaryKeyColumn?: string;
  /** 真 RawDataset id（origin 溯源）。 */
  datasetId: string;
  /** 真源连接 id（溯源）。 */
  sourceConnId: string;
}

export interface MaterializedRecord {
  id: string;
  type: string;
  props: Record<string, unknown>;
  origin: { type: "MATERIALIZED"; datasetId: string; jobId: string };
}

export interface MaterializeRecordsResult {
  objects: MaterializedRecord[];
  warnings: string[];
  /** 实际采用的真源主键列。 */
  primaryKey: string;
}

/**
 * WO-CEO-DATA-2 · record-materialize 默认列映射模板。
 * 真源上传时调用方可直接引用（或自定义覆盖），让 CSV/Excel 列名 1:1 流入对象属性。
 * R14：这些是按对象类型 schema 派生的字段映射，非业务科目常数；换行业只需换类型/字段名。
 */
export const RECORD_MATERIALIZE_TEMPLATES: Record<
  string,
  { targetType: string; primaryKeyColumn: string; columnMapping: Record<string, string> }
> = {
  // 财务/需求/物料计划真源（WO-CEO-DATA-supply 基准模板）
  FinancePlan: {
    targetType: "FinancePlan",
    primaryKeyColumn: "finId",
    columnMapping: { finId: "finId", line: "line", budget: "budget", rolling: "rolling" },
  },
  DemandSegment: {
    targetType: "DemandSegment",
    primaryKeyColumn: "segId",
    columnMapping: {
      segId: "segId", segment: "segment", tgt: "tgt", p50: "p50", p90: "p90", act: "act",
      priceWan: "priceWan", marginPct: "marginPct", floorPct: "floorPct",
    },
  },
  MaterialBalance: {
    targetType: "MaterialBalance",
    primaryKeyColumn: "matBalId",
    columnMapping: {
      matBalId: "matBalId", material: "material", unit: "unit", netDemandTon: "netDemandTon",
      ltaPct: "ltaPct", gapTon: "gapTon", etaDate: "etaDate",
    },
  },
  // 供应链/地缘/决策真源（§2b 扩展字段）
  Supplier: {
    targetType: "Supplier",
    primaryKeyColumn: "supplierId",
    columnMapping: {
      supplierId: "supplierId", supplierCode: "supplierCode", name: "name", category: "category",
      materialType: "materialType", rating: "rating", region: "region", leadTime: "leadTime",
      minOrderQty: "minOrderQty", onTimeRate: "onTimeRate", status: "status",
      contractedSupplyTon: "contractedSupplyTon", actualSupplyTon: "actualSupplyTon",
      deliveryDate: "deliveryDate", poNumber: "poNumber",
    },
  },
  LongTermAgreement: {
    targetType: "LongTermAgreement",
    primaryKeyColumn: "ltaId",
    columnMapping: {
      ltaId: "ltaId", supplierId: "supplierId", materialType: "materialType",
      contractedQtyTon: "contractedQtyTon", actualDeliveredTon: "actualDeliveredTon",
      priceLinked: "priceLinked", breachPenaltyWan: "breachPenaltyWan",
      priceFormula: "priceFormula", effectiveDate: "effectiveDate", expiryDate: "expiryDate",
    },
  },
  CommodityPriceTrend: {
    targetType: "CommodityPriceTrend",
    primaryKeyColumn: "trendId",
    columnMapping: {
      trendId: "trendId", commodity: "commodity", weekOf: "weekOf", pricePerTon: "pricePerTon",
      pctChange: "pctChange", source: "source", spec: "spec", currency: "currency",
    },
  },
  ExternalSignal: {
    targetType: "ExternalSignal",
    primaryKeyColumn: "signalKey",
    columnMapping: {
      signalKey: "signalKey", name: "name", category: "category", value: "value", unit: "unit",
      asOf: "asOf", source: "source", trend: "trend", impact: "impact", elasticity: "elasticity",
      eventRef: "eventRef",
    },
  },
  DecisionGap: {
    targetType: "DecisionGap",
    primaryKeyColumn: "gapId",
    columnMapping: {
      gapId: "gapId", kind: "kind", description: "description", severity: "severity",
      ownerRef: "ownerRef", reviewDate: "reviewDate", evidence: "evidence",
    },
  },
  // WO-CEO-DATA-2 每指标因果域 drill 真对象
  CompetitorShare: {
    targetType: "CompetitorShare",
    primaryKeyColumn: "shareId",
    columnMapping: { shareId: "shareId", competitor: "competitor", segment: "segment", sharePct: "sharePct", period: "period" },
  },
  BidRecord: {
    targetType: "BidRecord",
    primaryKeyColumn: "bidId",
    columnMapping: { bidId: "bidId", segment: "segment", win: "win", lossReason: "lossReason", amount: "amount", competitorRef: "competitorRef" },
  },
  CompetitorPrice: {
    targetType: "CompetitorPrice",
    primaryKeyColumn: "priceId",
    columnMapping: { priceId: "priceId", competitor: "competitor", model: "model", pricePerKwh: "pricePerKwh", period: "period" },
  },
  PipelineOpportunity: {
    targetType: "PipelineOpportunity",
    primaryKeyColumn: "oppId",
    columnMapping: { oppId: "oppId", segment: "segment", stage: "stage", amount: "amount", winProb: "winProb" },
  },
  WinLossRecord: {
    targetType: "WinLossRecord",
    primaryKeyColumn: "recordId",
    columnMapping: { recordId: "recordId", oppId: "oppId", result: "result", reason: "reason", amount: "amount" },
  },
  PriceRealization: {
    targetType: "PriceRealization",
    primaryKeyColumn: "priceId",
    columnMapping: { priceId: "priceId", model: "model", listPrice: "listPrice", realizedPrice: "realizedPrice", period: "period" },
  },
  ARAging: {
    targetType: "ARAging",
    primaryKeyColumn: "agingId",
    columnMapping: { agingId: "agingId", customerRef: "customerRef", bucket: "bucket", amount: "amount", period: "period" },
  },
  DSO: {
    targetType: "DSO",
    primaryKeyColumn: "dsoId",
    columnMapping: { dsoId: "dsoId", segment: "segment", days: "days", period: "period" },
  },
  OverdueRecord: {
    targetType: "OverdueRecord",
    primaryKeyColumn: "overdueId",
    columnMapping: { overdueId: "overdueId", invoiceRef: "invoiceRef", overdueDays: "overdueDays", customerRef: "customerRef", amount: "amount" },
  },
};

/** 对象 id sanitize（与合成 putAll 同规则·R6 稳定·CJK 保留）。 */
function sanitizeId(type: string, pk: string): string {
  return `obj_${type.toLowerCase()}_${pk}`.replace(/[^\p{L}\p{N}_-]/gu, "_");
}

/** 按目标 dataType 确定性强转真源值（number 列 parse；其余原样字符串化/保留）。 */
function coerce(value: unknown, dataType: PropertyDef["dataType"], warnings: string[], col: string): unknown {
  if (value === null || value === undefined || value === "") return value === "" ? "" : null;
  if (dataType === "number") {
    const num = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
    if (!Number.isFinite(num)) {
      warnings.push(`列「${col}」值「${String(value)}」非数值（目标属性 number）→ 置 null`);
      return null;
    }
    return num;
  }
  if (dataType === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).trim().toLowerCase();
    return ["true", "1", "yes", "y", "是"].includes(s);
  }
  return typeof value === "string" ? value : String(value);
}

export function materializeRecords(input: MaterializeRecordsInput): MaterializeRecordsResult {
  const warnings: string[] = [];
  const propByKey = new Map(input.props.map((p) => [p.propKey, p]));
  const pkProp = input.props.find((p) => p.isPrimaryKey);

  // 校验映射目标属性都存在于目标类型（防错列名静默落脏 props）。
  for (const [col, prop] of Object.entries(input.columnMapping)) {
    if (!propByKey.has(prop)) warnings.push(`映射列「${col}」→属性「${prop}」在类型「${input.targetType}」不存在`);
  }

  // 主键列：显式优先；否则取"映射到主键属性的列"。
  let primaryKey = input.primaryKeyColumn ?? "";
  if (!primaryKey && pkProp) {
    const hit = Object.entries(input.columnMapping).find(([, prop]) => prop === pkProp.propKey);
    primaryKey = hit?.[0] ?? "";
  }
  if (!primaryKey) {
    warnings.push(`未指定主键列且映射未覆盖主键属性（${pkProp?.propKey ?? "无主键属性"}）→ 无法生成稳定对象 id`);
    return { objects: [], warnings, primaryKey: "" };
  }

  const jobId = `record-materialize-${input.datasetId}`;
  const objects: MaterializedRecord[] = [];
  const seenIds = new Set<string>();
  let idx = 0;
  for (const row of input.rows) {
    const pkRaw = row[primaryKey];
    if (pkRaw === null || pkRaw === undefined || String(pkRaw).trim() === "") {
      warnings.push(`第 ${idx} 行主键列「${primaryKey}」空 → 跳过（不落无主键对象）`);
      idx++;
      continue;
    }
    const props: Record<string, unknown> = {};
    for (const [col, propKey] of Object.entries(input.columnMapping)) {
      const def = propByKey.get(propKey);
      if (!def) continue; // 已告警·不落不存在属性
      props[propKey] = coerce(row[col], def.dataType, warnings, col);
    }
    const id = sanitizeId(input.targetType, String(pkRaw));
    if (seenIds.has(id)) warnings.push(`主键值「${String(pkRaw)}」重复 → 后行覆盖前行（对象 id ${id}）`);
    seenIds.add(id);
    objects.push({
      id,
      type: input.targetType,
      props,
      origin: { type: "MATERIALIZED", datasetId: input.datasetId, jobId },
    });
    idx++;
  }
  return { objects, warnings, primaryKey };
}
