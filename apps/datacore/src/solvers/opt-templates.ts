import type { OptModelTemplate } from "@platform/contracts";

/**
 * 优化模板池 5 CP-SAT 核心的**一等可发现实例**（G-12 收 provenance 门空过）。
 *
 * 此前 `/a/v1/opt/templates` 只回裸 family 字符串、代码里无任何 `OptModelTemplate` 字面量 →
 * 模板既不可溯源、`solver-license:check` 的 LIC4「OptModelTemplate 字面量须带 provenance.license」
 * 规则空过（无字面量可查）。这里把 5 核心落为带 provenance/requiredRoles/decisionVars 的真实例，
 * 使端点返回可溯源模板、许可证门有真对象可校验。
 *
 * 红线：**零业务常数（R14）**——只认抽象 role/vtype/约束族，行业（供应链/医疗/能源）经 OntologyBinding
 * 绑进来，不进模板。**许可证（LIC3/LIC4）**——OR-Tools CP-SAT 方法重表达、非训练；provenance.license 留痕。
 * 确定性（R6）——纯静态常量，同构同序。
 */
const LIC = "Apache-2.0（OR-Tools CP-SAT 方法重表达·非训练·LIC3 署名/LIC4 仅取派生 Results）";

export const OPT_MODEL_TEMPLATES: OptModelTemplate[] = [
  {
    key: "facility_location",
    displayName: "选址-分配（设施开设 × 需求分配）",
    family: "facility_location",
    objectiveSense: "minimize",
    decisionVars: [
      { name: "open", vtype: "B", indexBy: ["facility"] },
      { name: "assign", vtype: "B", indexBy: ["facility", "client"] },
    ],
    constraintFamilies: [
      { key: "serve_each_client", kind: "cover", expr: "for each client: sum_facility assign[facility,client] == 1" },
      { key: "only_if_open", kind: "link", expr: "assign[facility,client] <= open[facility]" },
    ],
    requiredRoles: [
      { role: "facility", of: "objectType" },
      { role: "client", of: "objectType" },
      { role: "open_cost", of: "property" },
      { role: "serve_cost", of: "property" },
    ],
    params: { maxFacilities: 0 },
    status: "GOVERNED",
    provenance: { derivedFrom: "OR-Tools CP-SAT 选址模型族（uncapacitated facility location）方法重表达", license: LIC },
  },
  {
    key: "min_cost_flow",
    displayName: "最小费用流（网络流守恒 × 容量）",
    family: "min_cost_flow",
    objectiveSense: "minimize",
    decisionVars: [{ name: "flow", vtype: "I", indexBy: ["edge"] }],
    constraintFamilies: [
      { key: "conservation", kind: "balance", expr: "for each node: inflow - outflow == supply[node]" },
      { key: "capacity", kind: "bound", expr: "0 <= flow[edge] <= capacity[edge]" },
    ],
    requiredRoles: [
      { role: "node", of: "objectType" },
      { role: "edge", of: "link" },
      { role: "capacity", of: "property" },
      { role: "cost", of: "property" },
      { role: "supply", of: "property" },
    ],
    params: {},
    status: "GOVERNED",
    provenance: { derivedFrom: "OR-Tools CP-SAT 网络最小费用流模型族方法重表达", license: LIC },
  },
  {
    key: "set_cover",
    displayName: "集合覆盖（最少集合覆盖全元素）",
    family: "set_cover",
    objectiveSense: "minimize",
    decisionVars: [{ name: "pick", vtype: "B", indexBy: ["set"] }],
    constraintFamilies: [{ key: "cover_each_element", kind: "cover", expr: "for each element: sum_{set ∋ element} pick[set] >= 1" }],
    requiredRoles: [
      { role: "set", of: "objectType" },
      { role: "element", of: "objectType" },
      { role: "set_cost", of: "property" },
    ],
    params: {},
    status: "GOVERNED",
    provenance: { derivedFrom: "OR-Tools CP-SAT 集合覆盖模型族方法重表达", license: LIC },
  },
  {
    key: "independent_set",
    displayName: "最大权独立集（互斥择优）",
    family: "independent_set",
    objectiveSense: "maximize",
    decisionVars: [{ name: "choose", vtype: "B", indexBy: ["node"] }],
    constraintFamilies: [{ key: "edge_exclusion", kind: "conflict", expr: "for each edge(u,v): choose[u] + choose[v] <= 1" }],
    requiredRoles: [
      { role: "node", of: "objectType" },
      { role: "edge", of: "link" },
      { role: "weight", of: "property" },
    ],
    params: {},
    status: "GOVERNED",
    provenance: { derivedFrom: "OR-Tools CP-SAT 最大权独立集模型族方法重表达", license: LIC },
  },
  {
    key: "combinatorial_auction",
    displayName: "组合拍卖（捆绑投标择优，物品至多售一次）",
    family: "combinatorial_auction",
    objectiveSense: "maximize",
    decisionVars: [{ name: "win", vtype: "B", indexBy: ["bid"] }],
    constraintFamilies: [{ key: "item_at_most_once", kind: "packing", expr: "for each item: sum_{bid ∋ item} win[bid] <= 1" }],
    requiredRoles: [
      { role: "bid", of: "objectType" },
      { role: "item", of: "objectType" },
      { role: "bid_value", of: "property" },
    ],
    params: {},
    status: "GOVERNED",
    provenance: { derivedFrom: "OR-Tools CP-SAT 组合拍卖（winner determination）模型族方法重表达", license: LIC },
  },
];

/** 端点/CLI 发现用：稳定键序（R6）。 */
export const OPT_TEMPLATE_KEYS = OPT_MODEL_TEMPLATES.map((t) => t.key);
