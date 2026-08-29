// A3.1 · 14 域参考本体基线（元租户确定性种子）。
// 从 graphmeta.ts BUSINESS_DOMAINS 派生，禁新造域、禁外部产品名，行业无关命名。
// 产物：≈95 节点（14 domain + 56 object types + 25 cross-domain links），同 seed 字节一致（R6）。
// R2 隔离：tenantId 固定为 META_TENANT_ID，永不与业务租户数据混合。

import { BUSINESS_DOMAINS } from "../graphmeta.js";
import type { LinkTypeDef, ObjectTypeDef, PropertyDef } from "../domain.js";
import { mulberry32 } from "../prng.js";

/** 元租户 ID（R2 隔离：参考本体与业务租户完全隔离）。 */
export const META_TENANT_ID = "__refbase";

/** 参考本体固定种子（变更即破坏 R6 字节一致，需显式 bump version）。 */
export const REFBASE_SEED = 42;

/** 每域 4 个行业无关参考对象类型（key + displayName）。 */
const DOMAIN_REFERENCE_TYPES: Record<string, { key: string; displayName: string }[]> = {
  factory: [
    { key: "FactorySite", displayName: "工厂/基地" },
    { key: "ProductionLine", displayName: "生产线" },
    { key: "WorkCenter", displayName: "工作中心" },
    { key: "Facility", displayName: "设施" },
  ],
  product: [
    { key: "Product", displayName: "产品" },
    { key: "ProductModel", displayName: "产品型号" },
    { key: "ProductFamily", displayName: "产品族" },
    { key: "SKU", displayName: "SKU" },
  ],
  process: [
    { key: "Process", displayName: "工艺/工序" },
    { key: "Operation", displayName: "作业步骤" },
    { key: "ProcessStep", displayName: "工序步骤" },
    { key: "Routing", displayName: "工艺路线" },
  ],
  equip: [
    { key: "Equipment", displayName: "设备" },
    { key: "EquipmentAsset", displayName: "设备资产" },
    { key: "MaintenancePlan", displayName: "检修计划" },
    { key: "EquipmentCapability", displayName: "设备能力" },
  ],
  people: [
    { key: "Crew", displayName: "班组" },
    { key: "Worker", displayName: "人员" },
    { key: "SkillCertification", displayName: "技能认证" },
    { key: "ShiftPlan", displayName: "班次计划" },
  ],
  quality: [
    { key: "QualityLot", displayName: "质量批次" },
    { key: "InspectionResult", displayName: "检验结果" },
    { key: "QualityStandard", displayName: "质量标准" },
    { key: "DataSourceHealth", displayName: "数据源健康度" },
  ],
  capacity: [
    { key: "Capacity", displayName: "产能" },
    { key: "Shipment", displayName: "在途/发运" },
    { key: "CapacityPyramid", displayName: "产能金字塔" },
    { key: "Logistics", displayName: "物流" },
  ],
  forecast: [
    { key: "DemandForecast", displayName: "需求预测" },
    { key: "DemandSegment", displayName: "需求细分" },
    { key: "ForecastVersion", displayName: "预测版本" },
    { key: "MarketSignal", displayName: "市场信号" },
  ],
  sales: [
    { key: "Customer", displayName: "客户" },
    { key: "SalesOrder", displayName: "销售订单" },
    { key: "Invoice", displayName: "发票/应收" },
    { key: "Contract", displayName: "合同" },
  ],
  material: [
    { key: "Material", displayName: "物料" },
    { key: "Supplier", displayName: "供应商" },
    { key: "MaterialBatch", displayName: "物料批次" },
    { key: "BOM", displayName: "物料清单" },
  ],
  finance: [
    { key: "FinanceAccount", displayName: "财务账户" },
    { key: "FinanceMetric", displayName: "财务指标" },
    { key: "FinancePlan", displayName: "财务预算" },
    { key: "CarbonFactor", displayName: "碳因子" },
  ],
  plan: [
    { key: "AnnualScenario", displayName: "年度情景" },
    { key: "PlanTarget", displayName: "计划目标" },
    { key: "ScenarioTrigger", displayName: "情景触发条件" },
    { key: "CapexProject", displayName: "投资项目" },
  ],
  external: [
    { key: "ExternalSignal", displayName: "外部信号" },
    { key: "MarketIndex", displayName: "市场指数" },
    { key: "PolicySignal", displayName: "政策信号" },
    { key: "WeatherSignal", displayName: "环境信号" },
  ],
  decision: [
    { key: "Metric", displayName: "经营指标" },
    { key: "KSF", displayName: "关键成功要素" },
    { key: "Principal", displayName: "责任主体" },
    { key: "RootCauseChain", displayName: "根因归因链" },
  ],
};

/** 跨域接缝（断点高发区）：每对相邻域一条单跳参考链路。 */
const CROSS_DOMAIN_SEAMS: [string, string][] = [
  ["factory", "product"],
  ["factory", "process"],
  ["factory", "equip"],
  ["factory", "people"],
  ["factory", "capacity"],
  ["product", "process"],
  ["product", "sales"],
  ["product", "material"],
  ["process", "equip"],
  ["process", "people"],
  ["process", "quality"],
  ["equip", "quality"],
  ["equip", "material"],
  ["people", "sales"],
  ["quality", "sales"],
  ["capacity", "sales"],
  ["capacity", "material"],
  ["forecast", "sales"],
  ["forecast", "plan"],
  ["plan", "finance"],
  ["plan", "decision"],
  ["external", "forecast"],
  ["external", "plan"],
  ["finance", "decision"],
  ["decision", "people"],
];

function pkProp(key: string): PropertyDef {
  return { propKey: `${key.charAt(0).toLowerCase() + key.slice(1)}Id`, dataType: "string", isPrimaryKey: true };
}

function nameProp(): PropertyDef {
  return { propKey: "name", dataType: "string", isPrimaryKey: false, searchable: true };
}

export interface RefbaseOntology {
  tenantId: string;
  seed: number;
  objectTypes: Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">[];
  linkTypes: Omit<LinkTypeDef, "id" | "tenantId" | "version">[];
}

/**
 * 生成元租户参考本体（确定性 R6）。
 * - 14 业务域（来自 BUSINESS_DOMAINS，无新造域）
 * - 每域 4 个行业无关参考对象类型
 * - 25 条跨域接缝链路
 * 总节点数 ≈ 14 + 56 + 25 = 95。
 */
export function generateRefbaseOntology(seed = REFBASE_SEED): RefbaseOntology {
  // 用 rng 仅做不可预测但确定的 id 后缀派生（非业务语义）。
  const rng = mulberry32(seed);
  const randId = () => Math.floor(rng() * 1_000_000).toString(36).padStart(4, "0");

  const objectTypes: Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">[] = [];
  for (const domain of BUSINESS_DOMAINS.map((d) => d.key).sort()) {
    const types = DOMAIN_REFERENCE_TYPES[domain] ?? [];
    for (const t of types) {
      objectTypes.push({
        key: t.key,
        displayName: t.displayName,
        domain,
        properties: [pkProp(t.key), nameProp()],
        derivedProperties: [],
        sourceBindings: [],
      });
    }
  }

  const firstTypeOfDomain = new Map<string, string>();
  for (const domain of BUSINESS_DOMAINS.map((d) => d.key)) {
    const types = DOMAIN_REFERENCE_TYPES[domain] ?? [];
    if (types.length > 0) firstTypeOfDomain.set(domain, types[0]!.key);
  }

  const linkTypes: Omit<LinkTypeDef, "id" | "tenantId" | "version">[] = [];
  for (const [fromDomain, toDomain] of CROSS_DOMAIN_SEAMS) {
    const fromType = firstTypeOfDomain.get(fromDomain);
    const toType = firstTypeOfDomain.get(toDomain);
    if (!fromType || !toType) continue;
    linkTypes.push({
      key: `ref_${fromDomain}_to_${toDomain}_${randId()}`,
      fromTypeKey: fromType,
      toTypeKey: toType,
      cardinality: "N:N",
    });
  }

  // 确定性排序（R6 字节一致）
  objectTypes.sort((a, b) => a.key.localeCompare(b.key));
  linkTypes.sort((a, b) => a.key.localeCompare(b.key));

  return { tenantId: META_TENANT_ID, seed, objectTypes, linkTypes };
}

/** 参考本体节点计数（C2 证据）。 */
export function refbaseNodeCount(o: RefbaseOntology): { domains: number; objectTypes: number; linkTypes: number; total: number } {
  return {
    domains: BUSINESS_DOMAINS.length,
    objectTypes: o.objectTypes.length,
    linkTypes: o.linkTypes.length,
    total: BUSINESS_DOMAINS.length + o.objectTypes.length + o.linkTypes.length,
  };
}

/** 内容指纹（djb2，R6 同 seed 同 digest）。 */
export function refbaseDigest(o: RefbaseOntology): string {
  const s = JSON.stringify({ seed: o.seed, objectTypes: o.objectTypes, linkTypes: o.linkTypes });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, "0");
}
