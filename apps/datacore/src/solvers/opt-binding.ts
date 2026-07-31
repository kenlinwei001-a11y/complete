/**
 * 轨B·增量2 本体绑定层（OntologyBinding · R14/DF.8 真正落点）。
 *
 * 这是「invoke 前统一 args 预处理层」（SPEC §2 / §14.2 校正5）：把抽象优化模板的 `role`
 * （facility/client/open_cost…）映射到**某租户已发布本体的真实类型/属性**，从对象图读出系数，
 * 组装成 5 CP-SAT 核心引擎所需的结构化数组。**同一模板每租户绑不同本体 → 零代码改动，纯配置**（R14）。
 *
 * 复用（证不分叉）：
 *  - 角色推断借 A13 `resolveFieldRoles`（确定性，无 LLM）的思路；这里绑定显式给 role→ref，
 *    A13 仅在「未显式绑定」时作推荐（增量2 以显式 roleBindings 为准，确定性 R6）。
 *  - DF.8 接地（FUS3 去电池）：绑定引用的类型/属性**必须存在于本租户已发布本体**，否则报错——
 *    不靠 `checkGrounding` 的电池味正则（仅认 基地/产线/工厂 后缀），而是**对照真实本体校验存在性**，
 *    多行业通用、不造本体外实体。
 *  - 系数语义（FUS4）：系数 = 绑定的**类型化字段**（coeffSource=property 取对象属性；
 *    coeffSource=rule_params 取 rule.params）；规则是 gate 非系数源，绝不把系数硬塞进规则。
 *
 * 确定性 R6：对象按 id 稳定排序；同绑定同本体同参数 → 字节一致。R2：只读本租户对象。
 */
import type { ObjectInstance, ObjectTypeDef } from "../domain.js";
import type { OntologyBinding, OptTemplateFamily } from "@platform/contracts";
import { validationError } from "../errors.js";

/**
 * 绑定层读本体所需的最小仓储视图（解耦 Repos；app/service 注入真实实现）。
 *
 * WO-66-RULES-FIRST-CLASS P1 · **M5 死接口已删（判断与理由）**：此处原有
 * `ruleParams?(tenantId, ruleKey): Promise<Record<string, number>|undefined>` —— 声明了但
 * **全仓无实现、无调用者**（台账 §4.2 M5）。删而不实现的三条理由：
 *   ① **不可实现**：`OntologyBinding` 只有 `coeffSource: "property"|"rule_params"`，**没有 `coeffRuleKey`**
 *      —— 即使实现了这个方法也拿不到该读哪条规则，是一个语义不闭合的声明。
 *   ② **与本体 FUS4 冲突**：本体 §3 优化融合链明记「规则是 gate 非系数源(FUS4)」；优化系数应来自
 *      绑定的**类型化本体字段**，把系数搬进规则是反向。
 *   ③ **禁造第 6 套**：真要做也必须走 P1 收敛出的唯一入口 `RuleParamReader`，而不是在绑定层另开一条读法。
 * 同时（见 `assertCoeffSourceSupported`）把「`coeffSource=rule_params` 的绑定被当成 property 静默处理」
 * 改为**显式报错**——静默降级是本仓反复吃亏的病灶族。
 */
export interface BindingOntologyView {
  listTypes(tenantId: string): Promise<ObjectTypeDef[]>;
  listByType(tenantId: string, typeKey: string): Promise<ObjectInstance[]>;
}

/**
 * WO-66 P1（禁静默降级）：`coeffSource="rule_params"` 目前**未实现**（见上）。
 * 此前这类绑定会被**静默当成 `property`** 处理 → 用户以为系数来自规则、实际来自对象属性。
 * 现显式报错，把"没做"说出来，而不是假装做了。
 */
export function assertCoeffSourceSupported(binding: OntologyBinding): void {
  if (binding.coeffSource === "rule_params") {
    throw validationError(
      "OntologyBinding.coeffSource='rule_params' 尚未实现（缺 coeffRuleKey 语义；本体 §3 FUS4：规则是 gate 非系数源）。" +
        "请改用 coeffSource='property' 绑定类型化本体字段；确需读规则参数请先补 coeffRuleKey 契约并走唯一入口 RuleParamReader。",
    );
  }
}

/** roleBindings → Map(role → ref)，便于按 role 取绑定。 */
function roleMap(b: OntologyBinding): Map<string, { kind: string; ref: string }> {
  return new Map(b.roleBindings.map((rb) => [rb.role, rb.bind]));
}

function pkOf(t: ObjectTypeDef): string | undefined {
  return t.properties.find((p) => p.isPrimaryKey)?.propKey;
}

function num(v: unknown, d = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d;
}

function objId(o: ObjectInstance, pk?: string): string {
  return String((pk ? (o.props as Record<string, unknown>)[pk] : undefined) ?? o.id);
}

/**
 * DF.8 接地（多行业通用，非电池正则）：绑定引用的每个类型/属性必须存在于本租户**已发布本体**。
 * 越界（引用不存在的类型/字段）→ 报错，绝不静默造实体。返回类型索引供后续读对象。
 */
async function groundBinding(
  view: BindingOntologyView,
  binding: OntologyBinding,
): Promise<Map<string, ObjectTypeDef>> {
  const types = await view.listTypes(binding.tenantId);
  const byKey = new Map(types.filter((t) => t.status === "ACTIVE").map((t) => [t.key, t]));
  const violations: string[] = [];
  for (const rb of binding.roleBindings) {
    if (rb.bind.kind === "objectType") {
      if (!byKey.has(rb.bind.ref)) violations.push(`类型 '${rb.bind.ref}'（role=${rb.role}）`);
    } else if (rb.bind.kind === "property") {
      // property ref 形如 "Type.prop"：类型与字段都须在本体内。
      const [typeKey, propKey] = rb.bind.ref.split(".");
      const t = typeKey ? byKey.get(typeKey) : undefined;
      if (!t) violations.push(`属性所属类型 '${typeKey}'（role=${rb.role}）`);
      else if (!t.properties.some((p) => p.propKey === propKey)) violations.push(`属性 '${rb.bind.ref}'（role=${rb.role}）`);
    }
    // kind==="link" 留待后续（5 核心暂以 objectType/property 绑定即可）。
  }
  if (violations.length > 0) {
    throw validationError(`DF.8 接地失败：绑定引用了本体外实体 —— ${violations.join("、")}（绑定不得引用本租户已发布本体之外的类型/属性）`);
  }
  return byKey;
}

/** 取 role 对应的类型 def（必须是 objectType 绑定）。 */
function typeForRole(role: string, rm: Map<string, { kind: string; ref: string }>, byKey: Map<string, ObjectTypeDef>): ObjectTypeDef {
  const bind = rm.get(role);
  if (!bind) throw validationError(`绑定缺 role '${role}'`);
  if (bind.kind !== "objectType") throw validationError(`role '${role}' 须绑 objectType（当前 ${bind.kind}）`);
  const t = byKey.get(bind.ref);
  if (!t) throw validationError(`role '${role}' 绑定的类型 '${bind.ref}' 不在本体内`);
  return t;
}

/** 取 property role 的 propKey（"Type.prop" → "prop"）。缺省返回 fallback。 */
function propForRole(role: string, rm: Map<string, { kind: string; ref: string }>, fallback?: string): string | undefined {
  const bind = rm.get(role);
  if (!bind) return fallback;
  if (bind.kind !== "property") throw validationError(`role '${role}' 须绑 property（当前 ${bind.kind}）`);
  return bind.ref.includes(".") ? bind.ref.split(".")[1] : bind.ref;
}

/**
 * 把绑定 + 本体对象 → 5 CP-SAT 核心引擎的结构化 args（与增量1 求解器入参一致）。
 * 每族要求的 role：
 *  - facility_location: facility(objectType) · client(objectType) · open_cost(property on facility)
 *      · assign_cost(property on facility，对所有 client 同成本) | distance(property，client/facility 各有则做差绝对值)
 *      · capacity?(property on facility) · demand?(property on client)
 *  - min_cost_flow: node(objectType) · supply(property) · arc(objectType: from/to/cost(+cap?) 属性)
 *  - set_cover: set(objectType) · covers(property: 逗号/分号分隔的元素 id) · cost?(property) · universe?(objectType)
 *  - independent_set: node(objectType) · weight?(property) · edge(objectType: a/b 属性)
 *  - combinatorial_auction: bid(objectType) · value(property) · items(property: 分隔的物品 id)
 */
export async function bindToSolverArgs(
  view: BindingOntologyView,
  family: OptTemplateFamily,
  binding: OntologyBinding,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (binding.templateKey !== family && binding.templateKey !== "") {
    // templateKey 与 family 不一致只警示语义；以传入 family 为准（family 来自模板族）。
  }
  // WO-66 P1（禁静默降级）：未实现的 coeffSource 显式报错，不再被当成 property 静默处理。
  assertCoeffSourceSupported(binding);
  const byKey = await groundBinding(view, binding);
  const rm = roleMap(binding);
  const tid = binding.tenantId;
  const seed = num(extra.seed, 42);

  const splitIds = (v: unknown): string[] =>
    typeof v === "string" ? v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : [];

  switch (family) {
    case "facility_location": {
      const facT = typeForRole("facility", rm, byKey);
      const cliT = typeForRole("client", rm, byKey);
      const facPk = pkOf(facT), cliPk = pkOf(cliT);
      const openProp = propForRole("open_cost", rm, "openCost")!;
      const assignProp = propForRole("assign_cost", rm, "assignCost"); // 每设施一标量，对所有 client 同成本
      const capProp = rm.has("capacity") ? propForRole("capacity", rm) : undefined;
      const demProp = rm.has("demand") ? propForRole("demand", rm) : undefined;
      const facObjs = (await view.listByType(tid, facT.key)).sort((a, b) => a.id.localeCompare(b.id));
      const cliObjs = (await view.listByType(tid, cliT.key)).sort((a, b) => a.id.localeCompare(b.id));
      const facilities = facObjs.map((o) => ({
        id: objId(o, facPk),
        openCost: num((o.props as Record<string, unknown>)[openProp]),
        ...(capProp ? { capacity: num((o.props as Record<string, unknown>)[capProp]) } : {}),
      }));
      const clients = cliObjs.map((o) => ({
        id: objId(o, cliPk),
        ...(demProp ? { demand: num((o.props as Record<string, unknown>)[demProp]) } : {}),
      }));
      // 指派成本：每设施携带 assignProp 标量 → 对所有 client 同成本（完全图，资格全开）。缺则成本 1。
      const assignCosts = facilities.flatMap((f) => {
        const facRow = facObjs.find((o) => objId(o, facPk) === f.id);
        const c = assignProp ? num((facRow?.props as Record<string, unknown>)[assignProp], 1) : 1;
        return clients.map((cl) => ({ client: cl.id, facility: f.id, cost: c }));
      });
      return { facilities, clients, assignCosts, seed, facilityType: facT.key, clientType: cliT.key };
    }
    case "min_cost_flow": {
      const nodeT = typeForRole("node", rm, byKey);
      const arcT = typeForRole("arc", rm, byKey);
      const nodePk = pkOf(nodeT);
      const supplyProp = propForRole("supply", rm, "supply")!;
      const fromProp = propForRole("arc_from", rm, "from")!;
      const toProp = propForRole("arc_to", rm, "to")!;
      const costProp = propForRole("arc_cost", rm, "cost")!;
      const capProp = rm.has("arc_cap") ? propForRole("arc_cap", rm) : undefined;
      const nodeObjs = (await view.listByType(tid, nodeT.key)).sort((a, b) => a.id.localeCompare(b.id));
      const arcObjs = (await view.listByType(tid, arcT.key)).sort((a, b) => a.id.localeCompare(b.id));
      const nodes = nodeObjs.map((o) => ({ id: objId(o, nodePk), supply: num((o.props as Record<string, unknown>)[supplyProp]) }));
      const arcs = arcObjs.map((o) => {
        const p = o.props as Record<string, unknown>;
        return { from: String(p[fromProp]), to: String(p[toProp]), cost: num(p[costProp]), ...(capProp ? { cap: num(p[capProp]) } : {}) };
      });
      return { nodes, arcs, seed, nodeType: nodeT.key };
    }
    case "set_cover": {
      const setT = typeForRole("set", rm, byKey);
      const setPk = pkOf(setT);
      const coversProp = propForRole("covers", rm, "covers")!;
      const costProp = rm.has("cost") ? propForRole("cost", rm) : undefined;
      const setObjs = (await view.listByType(tid, setT.key)).sort((a, b) => a.id.localeCompare(b.id));
      const sets = setObjs.map((o) => {
        const p = o.props as Record<string, unknown>;
        return { id: objId(o, setPk), covers: splitIds(p[coversProp]), ...(costProp ? { cost: num(p[costProp]) } : {}) };
      });
      return { sets, seed, setType: setT.key };
    }
    case "independent_set": {
      const nodeT = typeForRole("node", rm, byKey);
      const nodePk = pkOf(nodeT);
      const weightProp = rm.has("weight") ? propForRole("weight", rm) : undefined;
      const nodeObjs = (await view.listByType(tid, nodeT.key)).sort((a, b) => a.id.localeCompare(b.id));
      const nodes = nodeObjs.map((o) => ({ id: objId(o, nodePk), ...(weightProp ? { weight: num((o.props as Record<string, unknown>)[weightProp]) } : {}) }));
      let edges: { a: string; b: string }[] = [];
      if (rm.has("edge")) {
        const edgeT = typeForRole("edge", rm, byKey);
        const aProp = propForRole("edge_a", rm, "a")!, bProp = propForRole("edge_b", rm, "b")!;
        const edgeObjs = (await view.listByType(tid, edgeT.key)).sort((a, b) => a.id.localeCompare(b.id));
        edges = edgeObjs.map((o) => ({ a: String((o.props as Record<string, unknown>)[aProp]), b: String((o.props as Record<string, unknown>)[bProp]) }));
      }
      return { nodes, edges, seed, nodeType: nodeT.key };
    }
    case "combinatorial_auction": {
      const bidT = typeForRole("bid", rm, byKey);
      const bidPk = pkOf(bidT);
      const valueProp = propForRole("value", rm, "value")!;
      const itemsProp = propForRole("items", rm, "items")!;
      const bidObjs = (await view.listByType(tid, bidT.key)).sort((a, b) => a.id.localeCompare(b.id));
      const bids = bidObjs.map((o) => {
        const p = o.props as Record<string, unknown>;
        return { id: objId(o, bidPk), value: num(p[valueProp]), items: splitIds(p[itemsProp]) };
      });
      return { bids, seed, bidType: bidT.key };
    }
    case "cross_object_occupancy":
      // WO-CROSS-OBJECT-MULTIOBJ：委托专用绑定层（订单/产线/合同三元组，DF.8 诚实拒绝/报缺）。
      return bindCrossObjectOccupancy(view, binding, extra);
    default:
      throw validationError(`绑定层暂不支持模板族 '${family}'（增量1 仅 5 核心 + cross_object_occupancy；multi_objective 由 vars/constraints 直接给）`);
  }
}

/**
 * WO-CROSS-OBJECT-MULTIOBJ 跨对象占用绑定层（R14/DF.8）：把租户本体的 订单/产线/合同 类对象绑成
 * cross_object_occupancy 引擎所需三元组 args。**零业务常数**——系数全取绑定的类型化字段。
 *
 * 必需 role（绑不到 → DF.8 诚实拒绝，不编实体）：
 *  - order(objectType) · revenue/penalty/qty(property on order) · line(objectType) · line_capacity(property on line)
 * 可选 role：
 *  - order_contract(property on order → contractId)
 *  - contract(objectType) + contract_cap(property on contract)：**无合同类型 → 诚实报缺**（contracts=[]，contractBound=false），不伪造合同额度约束
 *  - eligibility(objectType) + elig_order/elig_line/elig_cost(property)：显式可产对；未绑 → 诚实标 eligibilityDefaulted（全资格全通、换型成本 0，不编成本数字）
 */
export async function bindCrossObjectOccupancy(
  view: BindingOntologyView,
  binding: OntologyBinding,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const byKey = await groundBinding(view, binding);
  const rm = roleMap(binding);
  const tid = binding.tenantId;
  const seed = num(extra.seed, 42);

  const orderT = typeForRole("order", rm, byKey);
  const lineT = typeForRole("line", rm, byKey);
  const orderPk = pkOf(orderT), linePk = pkOf(lineT);
  const revProp = propForRole("revenue", rm, "revenue")!;
  const penProp = propForRole("penalty", rm, "penalty")!;
  const qtyProp = propForRole("qty", rm, "qty")!;
  const contractRefProp = rm.has("order_contract") ? propForRole("order_contract", rm) : undefined;
  const capProp = propForRole("line_capacity", rm, "capacity")!;

  const orderObjs = (await view.listByType(tid, orderT.key)).sort((a, b) => a.id.localeCompare(b.id));
  const lineObjs = (await view.listByType(tid, lineT.key)).sort((a, b) => a.id.localeCompare(b.id));
  const orders = orderObjs.map((o) => {
    const p = o.props as Record<string, unknown>;
    return {
      id: objId(o, orderPk),
      revenue: num(p[revProp]),
      penalty: num(p[penProp]),
      qty: num(p[qtyProp]),
      ...(contractRefProp ? { contractId: String(p[contractRefProp] ?? "") || undefined } : {}),
    };
  });
  const lines = lineObjs.map((l) => ({ id: objId(l, linePk), capacity: num((l.props as Record<string, unknown>)[capProp]) }));

  // 合同类对象：无绑定 → 诚实报缺（不伪造额度约束）。
  let contracts: { id: string; cap: number }[] = [];
  const contractBound = rm.has("contract");
  if (contractBound) {
    const contractT = typeForRole("contract", rm, byKey);
    const contractPk = pkOf(contractT);
    const capC = propForRole("contract_cap", rm, "cap")!;
    const contractObjs = (await view.listByType(tid, contractT.key)).sort((a, b) => a.id.localeCompare(b.id));
    contracts = contractObjs.map((c) => ({ id: objId(c, contractPk), cap: num((c.props as Record<string, unknown>)[capC]) }));
  }

  // 可产对（eligibility）：显式绑 objectType（elig_order/elig_line/elig_cost）→ 读真对；未绑 → 诚实标 defaulted，全资格全通、成本 0（不编成本）。
  let eligibility: { order: string; line: string; cost: number }[] = [];
  const eligibilityBound = rm.has("eligibility");
  if (eligibilityBound) {
    const eligT = typeForRole("eligibility", rm, byKey);
    const eoProp = propForRole("elig_order", rm, "order")!;
    const elProp = propForRole("elig_line", rm, "line")!;
    const ecProp = rm.has("elig_cost") ? propForRole("elig_cost", rm) : undefined;
    const eligObjs = (await view.listByType(tid, eligT.key)).sort((a, b) => a.id.localeCompare(b.id));
    eligibility = eligObjs.map((e) => {
      const p = e.props as Record<string, unknown>;
      return { order: String(p[eoProp]), line: String(p[elProp]), cost: ecProp ? num(p[ecProp]) : 0 };
    });
  } else {
    eligibility = orders.flatMap((o) => lines.map((l) => ({ order: o.id, line: l.id, cost: 0 })));
  }

  return {
    orders,
    lines,
    contracts,
    eligibility,
    seed,
    orderType: orderT.key,
    lineType: lineT.key,
    contractBound,
    eligibilityDefaulted: !eligibilityBound,
  };
}
