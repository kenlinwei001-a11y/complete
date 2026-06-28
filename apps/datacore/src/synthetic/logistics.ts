import type { IndustryTemplate } from "@platform/contracts";

/**
 * 内置非电池行业模板：物流仓配选址（logistics-warehouse）。
 *
 * 缘起（G-12 收口 §5-B「真立 ≥1 非电池行业租户」）：行业未知时 `resolveTemplate` 走 LLM 生成模板，
 * 但本环境 LLM 一律 mock → 无法**确定性**产出真对象世界（违 R6、且是 mock）。这里以**代码内置确定性模板**
 * （同 `BATTERY_TEMPLATE` 范式）立一个真实非电池世界：配送仓（facility）/ 门店（client），
 * 经 `synthetic.runJob → instantiateGeneric` 物化为已发布对象类型 + FK 一致对象，
 * 供 `OntologyBinding(facility_location) → /opt/solve` 真 CP-SAT 求最优（非 mock、非 skip）。
 *
 * R14（行业无关）：字段只用**抽象 role**（openCost/serveCost/demand/region/capacity），零电池业务常数；
 *   行业是「绑定进来的内容」——同一 facility_location 模板对本租户绑 Warehouse/Store，对电池租户绑 Base/DemandSegment，
 *   求解器/绑定层/whatif **代码零改**。
 * R6（确定性）：count/propGenerators 固定，同 (seed, scale) 重跑字节一致（mulberry32(seed ^ hash(industryKey))）。
 * 模板为 uncapacitated 选址族：capacity 仅作 advisory 字段（不入求解约束，故绑定层不绑 capacity 即恒可行）。
 */
export const LOGISTICS_TEMPLATE: IndustryTemplate = {
  industryKey: "logistics-warehouse",
  ontology: {
    objectTypes: [
      {
        key: "Warehouse",
        displayName: "配送仓",
        properties: [
          { propKey: "whId", dataType: "string", isPrimaryKey: true },
          { propKey: "region", dataType: "string" },
          { propKey: "openCost", dataType: "number" }, // 固定开仓成本（facility open_cost）
          { propKey: "serveCost", dataType: "number" }, // 单仓对门店服务成本（assign_cost 标量·完全图）
          { propKey: "capacity", dataType: "number" }, // 日吞吐（advisory；uncapacitated 模板不入约束）
        ],
        derivedProperties: [],
      },
      {
        key: "Store",
        displayName: "门店",
        properties: [
          { propKey: "storeId", dataType: "string", isPrimaryKey: true },
          { propKey: "region", dataType: "string" },
          { propKey: "demand", dataType: "number" },
        ],
        derivedProperties: [],
      },
    ],
    linkTypes: [],
  },
  generation: [
    {
      typeKey: "Warehouse",
      count: { S: 6, M: 14, L: 30, XL: 30 },
      propGenerators: {
        whId: { kind: "pattern", pattern: "WH-{seq:3}" },
        region: { kind: "enum", values: ["east", "south", "north", "west", "central"] },
        openCost: { kind: "number", min: 80, max: 320, precision: 0 },
        serveCost: { kind: "number", min: 2, max: 18, precision: 1 },
        capacity: { kind: "number", min: 500, max: 3000, precision: 0 },
      },
    },
    {
      typeKey: "Store",
      count: { S: 10, M: 40, L: 160, XL: 160 },
      propGenerators: {
        storeId: { kind: "pattern", pattern: "ST-{seq:4}" },
        region: { kind: "enum", values: ["east", "south", "north", "west", "central"] },
        demand: { kind: "number", min: 20, max: 200, precision: 0 },
      },
    },
  ],
  // 规则可选；本模板不声明业务规则（保持最小可用·零业务常数）。
  rules: [],
  // 视图/意图留空：本租户用平台默认配置驱动视图（前端 config-driven，debattery:check 静态扫源为 0）。
  scenarioSeed: { views: [], intents: [] },
};
