import type { IndustryTemplate } from "@platform/contracts";
import type { DerivedPropertyDef, LinkTypeDef, ObjectTypeDef, PropertyDef } from "../domain.js";
import { mulberry32, pick, randInt, round } from "../prng.js";

/** Built-in battery-manufacturing template (QOS-PRD §7.6 semantics). */

export const BASES: { baseId: string; name: string; kind: "动力" | "储能" }[] = [
  { baseId: "changzhou", name: "常州", kind: "动力" },
  { baseId: "hefei", name: "合肥", kind: "动力" },
  { baseId: "xian", name: "西安", kind: "动力" },
  { baseId: "yibin", name: "宜宾", kind: "储能" },
  { baseId: "liyang", name: "溧阳", kind: "动力" },
  { baseId: "qingdao", name: "青岛", kind: "储能" },
  { baseId: "nanjing", name: "南京", kind: "动力" },
  { baseId: "chengdu", name: "成都", kind: "储能" },
  { baseId: "fuzhou", name: "福州", kind: "储能" },
  { baseId: "changsha", name: "长沙", kind: "动力" },
  { baseId: "huizhou", name: "惠州", kind: "储能" },
  { baseId: "yancheng", name: "盐城", kind: "动力" },
];

export const MODELS: { modelId: string; name: string }[] = [
  { modelId: "4680-NCM", name: "4680 三元圆柱" },
  { modelId: "4680-LFP", name: "4680 磷酸铁锂圆柱" },
  { modelId: "L300-NCM", name: "L300 三元长电芯" },
  { modelId: "L148-LFP", name: "L148 铁锂方形" },
  { modelId: "P28-NCM", name: "P28 软包三元" },
  { modelId: "S192-LFP", name: "S192 储能电芯" },
];

const CUSTOMERS = ["星辰汽车", "蓝海储能", "极光电动", "云岭新能源", "晨风车业", "沧浪电网"];
const BOTTLENECKS = ["电芯", "模组", "PACK", "化成"];

const baseProps: PropertyDef[] = [
  { propKey: "baseId", dataType: "string", isPrimaryKey: true },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "kind", dataType: "enum", isPrimaryKey: false },
  { propKey: "util", dataType: "number", isPrimaryKey: false },
  { propKey: "bottleneck", dataType: "enum", isPrimaryKey: false },
  { propKey: "gwh", dataType: "number", isPrimaryKey: false },
];
const baseDerived: DerivedPropertyDef[] = [
  { propKey: "orderCount", formula: "COUNT(Order.so BY bases)" },
  { propKey: "committedQty", formula: "SUM(Order.qty BY bases)" },
];

const modelProps: PropertyDef[] = [
  { propKey: "modelId", dataType: "string", isPrimaryKey: true },
  { propKey: "name", dataType: "string", isPrimaryKey: false },
  { propKey: "bases", dataType: "json", isPrimaryKey: false },
  { propKey: "unitPrice", dataType: "number", isPrimaryKey: false },
];
const modelDerived: DerivedPropertyDef[] = [
  { propKey: "totalDemand", formula: "SUM(Order.qty BY model)" },
  { propKey: "orderCount", formula: "COUNT(Order.so BY model)" },
];

const orderProps: PropertyDef[] = [
  { propKey: "so", dataType: "string", isPrimaryKey: true },
  { propKey: "cust", dataType: "string", isPrimaryKey: false },
  { propKey: "model", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Model" },
  { propKey: "qty", dataType: "number", isPrimaryKey: false },
  { propKey: "due", dataType: "date", isPrimaryKey: false },
  { propKey: "bases", dataType: "json", isPrimaryKey: false },
];
const orderDerived: DerivedPropertyDef[] = [{ propKey: "value", formula: "qty * unitPrice" }];

export function batteryObjectTypes(): Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">[] {
  return [
    { key: "Base", displayName: "生产基地", properties: baseProps, derivedProperties: baseDerived, sourceBindings: [] },
    { key: "Model", displayName: "电池型号", properties: modelProps, derivedProperties: modelDerived, sourceBindings: [] },
    { key: "Order", displayName: "销售订单", properties: orderProps, derivedProperties: orderDerived, sourceBindings: [] },
  ];
}

export function batteryLinkTypes(): Omit<LinkTypeDef, "id" | "tenantId" | "version">[] {
  return [
    { key: "model_producible_at", fromTypeKey: "Model", toTypeKey: "Base", cardinality: "N:N" },
    { key: "order_for_model", fromTypeKey: "Order", toTypeKey: "Model", cardinality: "1:N" },
  ];
}

export const BATTERY_TEMPLATE: IndustryTemplate = {
  industryKey: "battery-manufacturing",
  ontology: {
    objectTypes: batteryObjectTypes(),
    linkTypes: batteryLinkTypes(),
  },
  generation: [
    {
      typeKey: "Base",
      count: { S: 12, M: 12, L: 12 },
      propGenerators: {
        util: { kind: "number", min: 0.62, max: 0.97, precision: 2 },
        gwh: { kind: "number", min: 6, max: 42, precision: 1 },
        bottleneck: { kind: "enum", values: BOTTLENECKS },
      },
    },
    {
      typeKey: "Model",
      count: { S: 6, M: 6, L: 6 },
      propGenerators: { unitPrice: { kind: "number", min: 380, max: 980, precision: 0 } },
    },
    {
      typeKey: "Order",
      count: { S: 20, M: 60, L: 200 },
      propGenerators: {
        so: { kind: "pattern", pattern: "SO-{seq:5}" },
        cust: { kind: "enum", values: CUSTOMERS },
        model: { kind: "fkSample", refTypeKey: "Model" },
        qty: { kind: "number", min: 100, max: 2500, precision: 0 },
        due: { kind: "date", from: "2026-07-01", to: "2026-12-31" },
      },
    },
  ],
  rules: [
    { key: "C03", name: "产能上限约束", expression: "Order.demandDelta > 0.5", severity: "BLOCK" },
    { key: "C08", name: "外协比例红线", expression: "Order.outsourceRatio > 0.3", severity: "WARN" },
    { key: "C13", name: "客户信用额度", expression: "Order.creditUsedRatio > 1", severity: "BLOCK" },
  ],
  scenarioSeed: { views: ["dash", "risk", "order"], intents: [] },
};

export interface GeneratedBattery {
  bases: Record<string, unknown>[];
  models: Record<string, unknown>[];
  orders: Record<string, unknown>[];
}

/**
 * Deterministic generation: master data (Base) → Model → Order, topo order,
 * referential integrity by construction. Same seed → byte-identical output.
 */
export function generateBattery(seed: number, scale: "S" | "M" | "L"): GeneratedBattery {
  const rng = mulberry32(seed);
  const orderCount = scale === "S" ? 20 : scale === "M" ? 60 : 200;

  const bases = BASES.map((b) => ({
    baseId: b.baseId,
    name: b.name,
    kind: b.kind,
    util: round(0.62 + rng() * 0.35, 2),
    bottleneck: pick(rng, BOTTLENECKS),
    gwh: round(6 + rng() * 36, 1),
  }));

  const models = MODELS.map((m) => {
    const n = randInt(rng, 2, 5);
    const shuffled = [...BASES.map((b) => b.baseId)];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i] as string;
      shuffled[i] = shuffled[j] as string;
      shuffled[j] = tmp;
    }
    return {
      modelId: m.modelId,
      name: m.name,
      bases: shuffled.slice(0, n).sort(),
      unitPrice: randInt(rng, 380, 980),
    };
  });

  const orders: Record<string, unknown>[] = [];
  for (let i = 0; i < orderCount; i++) {
    const model = models[Math.floor(rng() * models.length)] as (typeof models)[number];
    const producible = model.bases;
    const nBases = randInt(rng, 1, Math.min(2, producible.length));
    const start = Math.floor(rng() * producible.length);
    const orderBases = Array.from({ length: nBases }, (_, k) => producible[(start + k) % producible.length] as string).sort();
    const dueDay = randInt(rng, 0, 180);
    const due = new Date(Date.UTC(2026, 6, 1) + dueDay * 86400000).toISOString().slice(0, 10);
    orders.push({
      so: `SO-${String(10001 + i).padStart(5, "0")}`,
      cust: pick(rng, CUSTOMERS),
      model: model.modelId,
      qty: randInt(rng, 100, 2500),
      due,
      bases: orderBases,
      unitPrice: model.unitPrice, // copied for the derived value formula
    });
  }
  return { bases, models, orders };
}
