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
import { CURRENCY_BASE_UNIT, currencyScaleOf } from "./field-role-lexicon.js";

/** 绑定层读本体所需的最小仓储视图（解耦 Repos；app/service 注入真实实现）。 */
export interface BindingOntologyView {
  listTypes(tenantId: string): Promise<ObjectTypeDef[]>;
  listByType(tenantId: string, typeKey: string): Promise<ObjectInstance[]>;
  /** coeffSource=rule_params 时取规则参数（G-10「改规则即改优化」）；无则 undefined。 */
  ruleParams?(tenantId: string, ruleKey: string): Promise<Record<string, number> | undefined>;
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
 * 取某 property role 绑定的那一格在**本体上声明的单位**（WO-MARGIN-AXIS）。
 *
 * 单位取自 `PropertyDef.unit` —— 本体的单一来源，**不由字段名猜**
 * （猜单位与猜方向同类：猜错了屏上照样是一条正常曲线，只是数差一个数量级）。
 * role 未绑 / 该格没声明单位 ⇒ `undefined`，由调用方判「量纲对不齐」并报缺。
 */
function unitForRole(role: string, rm: Map<string, { kind: string; ref: string }>, byKey: Map<string, ObjectTypeDef>): string | undefined {
  const bind = rm.get(role);
  if (!bind || bind.kind !== "property") return undefined;
  const [typeKey, propKey] = bind.ref.split(".");
  if (!typeKey || !propKey) return undefined;
  return byKey.get(typeKey)?.properties.find((p) => p.propKey === propKey)?.unit ?? undefined;
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
 *  - line_assign_cost(property on line)：**每条产线一个标量占用成本**，对所有订单同成本
 *    （WO-SIM-PARETO-MODEL-EXIT 新增·可选）。语义与取法**照搬同文件 `facility_location` 的
 *    `assign_cost`**（原话：「每设施携带 assignProp 标量 → 对所有 client 同成本（完全图，资格全开）」，
 *    见本文件 `case "facility_location"` 分支里 `assignCosts` 那一段；⚠ 不写行号，行号会漂）——
 *    不是新发明一套口径，是把已在跑的那条口径搬到本族上。
 *    ⚠ 优先级 `elig_cost` > `line_assign_cost` > 0：显式可产对自带的成本最准；它没有时才退回
 *    每线标量；两者都没有才是 0，而那个 0 由回包的 `assignCostBound:false` 标出来。
 *    未绑 line_assign_cost ⇒ 成本仍为 0，既有调用方（无此 role）逐字节不变。
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
  /**
   * ══ WO-MARGIN-AXIS · 营收这一格：**总量**还是**强度量**，由绑定显式点名 ══════════
   *
   * **今天的行为是 X**（开工实测，本机 4001 内存态 demo 租户）：本层把
   * `orders[].revenue` 取成 `num(p[revProp])` —— 而装配器绑上来的是 `OrderLine.unitPrice`
   * （**单价**，元/件）。引擎再对获排单求和 ⇒ 「营收轴」= Σ**单价**。
   * 实测两行同型号订单 `SO-900030-L2`(qty 722) 与 `SO-900215-L1`(qty 7220)：
   * **各贡献同一个 21,626**，10 倍的量差在这根轴上完全消失。
   *
   * **应该是 Y**：营收轴 = Σ**行金额** = Σ(单价 × 用量)。
   *
   * **修法：加一个显式 role，不去猜。** 两种绑法，语义由绑定方声明：
   *   · role `revenue`      —— 该格**本身就是一行的金额**（总量）⇒ 直接用（既有行为，逐字节不变）。
   *   · role `unit_revenue` —— 该格是**每单位单价**（强度量）⇒ 必须 `× qty` 才成为金额。
   *
   * ⛔ **为什么不在本层"看名字像单价就乘 qty"**：本层是**跨行业通用**的（R14），
   * 换个租户 `revenue` 可能真的绑在一格金额上，那时乘 qty 就是**平方级高估**，
   * 而屏上看不出来 —— 曲线照样正常。名字判定属于装配器（它有词库
   * `ROLE_LEXICON.unitRate`），本层只认**显式声明**。
   */
  const unitRevProp = rm.has("unit_revenue") ? propForRole("unit_revenue", rm) : undefined;
  const revProp = unitRevProp ?? propForRole("revenue", rm, "revenue")!;
  const penProp = propForRole("penalty", rm, "penalty")!;
  const qtyProp = propForRole("qty", rm, "qty")!;
  const contractRefProp = rm.has("order_contract") ? propForRole("order_contract", rm) : undefined;
  const capProp = propForRole("line_capacity", rm, "capacity")!;

  /**
   * ══ WO-MARGIN-AXIS · 量纲对齐（**opt-in**，默认关）══════════════════════════
   *
   * **今天的行为是 X**：营收侧与成本侧**各按各自本体上声明的单位**回包，本层不看单位。
   * 实测 demo 租户：`OrderLine.unitPrice` 声明 **元**、`Base.serveCost` 声明 **万元**
   * ⇒ 两根轴差 10⁴ 倍。各画各的曲线时看不出来，**一旦相减（毛利）就错得离谱**。
   *
   * **应该是 Y**：要相减的那几格先折到**同一个基准货币单位**（`元`），并把
   * 「折齐了没有」作为一格**回包事实**（`currencyAligned`）交出去，让下游能机器核。
   *
   * ⚠ **默认关（`alignCurrency` 不传 ⇒ 不折算）**：本层的既有调用方（`bindToSolverArgs`
   * 的 `cross_object_occupancy` 分支、既有测试与金值）都按未折算的读数在跑，
   * 默认打开会让它们**静默改数**。要毛利轴的那条路（装配器）自己把开关打开。
   *
   * ⛔ **折不动就报 false，不许默认 1**：某一格没声明单位、或声明了一个非货币单位，
   * `currencyScaleOf` 返回 `undefined` ⇒ `currencyAligned:false`，
   * 且**该格原样不动**。默认按 1 折算 = 「不认识的单位就当它是元」，正是要防的静默错算。
   */
  const alignCurrency = extra.alignCurrency === true;
  const revUnit = unitForRole(unitRevProp ? "unit_revenue" : "revenue", rm, byKey);
  const penUnit = unitForRole("penalty", rm, byKey);
  const revScale = alignCurrency ? currencyScaleOf(revUnit) : 1;
  const penScale = alignCurrency ? currencyScaleOf(penUnit) : 1;

  const orderObjs = (await view.listByType(tid, orderT.key)).sort((a, b) => a.id.localeCompare(b.id));
  const lineObjs = (await view.listByType(tid, lineT.key)).sort((a, b) => a.id.localeCompare(b.id));
  const orders = orderObjs.map((o) => {
    const p = o.props as Record<string, unknown>;
    const qty = num(p[qtyProp]);
    // 单价 ⇒ 乘用量成为行金额；金额 ⇒ 原样。再按需折到基准货币单位。
    const revRaw = unitRevProp ? num(p[revProp]) * qty : num(p[revProp]);
    return {
      id: objId(o, orderPk),
      revenue: revRaw * (revScale ?? 1),
      penalty: num(p[penProp]) * (penScale ?? 1),
      qty,
      ...(contractRefProp ? { contractId: String(p[contractRefProp] ?? "") || undefined } : {}),
    };
  });
  const lines = lineObjs.map((l) => ({ id: objId(l, linePk), capacity: num((l.props as Record<string, unknown>)[capProp]) }));
  // 每线占用成本（可选）：绑了才有，绑不到就没有这一维 —— 没有时下面照旧写 0，
  // 而那个 0 由回包的 `assignCostBound:false` 举起来，**不许被读成"占用免费"**。
  const assignCostProp = rm.has("line_assign_cost") ? propForRole("line_assign_cost", rm) : undefined;
  // WO-MARGIN-AXIS：成本这一格同样折到基准货币单位（理由见上面 `alignCurrency` 段）。
  // ⚠ **成本刻度按"实际取哪一格"取**：优先级是 `elig_cost` > `line_assign_cost`，
  //   两格可能声明不同单位，取错那一格就是折错倍数。
  const assignCostUnit = unitForRole("line_assign_cost", rm, byKey);
  const eligCostUnit = unitForRole("elig_cost", rm, byKey);
  const costUnit = rm.has("elig_cost") ? eligCostUnit : assignCostUnit;
  const costScale = alignCurrency ? currencyScaleOf(costUnit) : 1;

  /**
   * ══ WO-UNITCOST-LAND · 成本这一格：**按指派**计价还是**按件**计价 ═══════════════
   *
   * **今天的行为是 X**：`eligibility[].cost` 只有两个来源，`elig_cost` 与 `line_assign_cost`，
   * **两个都是按「一次指派」计价的标量**（同 `facility_location` 的 `assign_cost` 口径）。
   * 于是成本与订单大小无关：一行 722 件与一行 7,220 件占用同一条线 ⇒ **成本完全相同**。
   * 营收侧上一单已由 `unit_revenue` 修成「单价 × 用量」，成本侧却还停在按指派 ⇒
   * 两根轴**不同阶**，相减得到的"毛利"里成本占比只有 0.331%（实测），
   * 毛利轴因此与营收轴强同向，答不了「单位经济学上哪个方案更划算」。
   *
   * **应该是 Y**：本体给得出**按件履约成本**时（`OrderLine.unitCost`，元/电芯），
   * 该单的履约成本 = `unitCost × qty`，与营收侧同阶。
   *
   * **修法与营收侧严格对称，不新发明**：新增可选 role `unit_cost`（order 上的强度量格），
   * 判据是**显式声明**不是猜名字 —— 理由与上面 `unit_revenue` 那一段逐字相同：
   * 本层跨行业通用，换个租户 `cost` 可能真的绑在一格总额上，那时乘 qty 就是平方级高估，
   * 而**屏上看不出来**。名字判定属于装配器（它有词库 `ROLE_LEXICON.unitRate`）。
   *
   * ⚠ **加性叠加，不是替换**：按件成本与按指派成本是**两笔不同的钱**
   * （料工费 vs 占线/换型），故 `cost = 指派成本 + 每件成本 × qty`。
   * 未绑 `unit_cost` ⇒ 该项恒 0 ⇒ 既有调用方逐字节不变。
   */
  const unitCostProp = rm.has("unit_cost") ? propForRole("unit_cost", rm) : undefined;
  const unitCostScale = alignCurrency ? currencyScaleOf(unitForRole("unit_cost", rm, byKey)) : 1;
  /** 订单 id → 该单的按件履约成本总额（`unitCost × qty`，已折到基准货币单位）。未绑 ⇒ 空表。 */
  const unitFulfillCost = new Map<string, number>(
    unitCostProp
      ? orderObjs.map((o) => {
          const p = o.props as Record<string, unknown>;
          return [objId(o, orderPk), num(p[unitCostProp]) * num(p[qtyProp]) * (unitCostScale ?? 1)] as [string, number];
        })
      : [],
  );
  const lineAssignCost = new Map(
    assignCostProp
      ? lineObjs.map((l) => [objId(l, linePk), num((l.props as Record<string, unknown>)[assignCostProp]) * (costScale ?? 1)])
      : [],
  );

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
  // 不给初值：下面 if/else 两条路径都必赋值，写个 `[]` 只会让人误以为"绑不到就是空表"
  // （绑不到走的是 else 的**全资格全通**，不是空表 —— 这两件事的回包完全不同）。
  let eligibility: { order: string; line: string; cost: number }[];
  const eligibilityBound = rm.has("eligibility");
  if (eligibilityBound) {
    const eligT = typeForRole("eligibility", rm, byKey);
    const eoProp = propForRole("elig_order", rm, "order")!;
    const elProp = propForRole("elig_line", rm, "line")!;
    const ecProp = rm.has("elig_cost") ? propForRole("elig_cost", rm) : undefined;
    const eligObjs = (await view.listByType(tid, eligT.key)).sort((a, b) => a.id.localeCompare(b.id));
    eligibility = eligObjs.map((e) => {
      const p = e.props as Record<string, unknown>;
      const line = String(p[elProp]);
      // 成本三档优先级（显式 > 每线标量 > 没量到）：可产对自带成本字段最准；没有就退回
      // 该线的标量占用成本（同 facility_location 的 assign_cost）；两者都没有才是 0，
      // 而这个 0 由 `assignCostBound:false` 标出来，不许被读成"占用不要钱"。
      // `lineAssignCost` 里的值**已折算**（见上），故只有走 `ecProp` 这一支才在这里折。
      const order = String(p[eoProp]);
      const assign = ecProp ? num(p[ecProp]) * (costScale ?? 1) : (lineAssignCost.get(line) ?? 0);
      // WO-UNITCOST-LAND：按指派 + 按件（未绑 unit_cost 时后项恒 0 ⇒ 既有行为逐字节不变）。
      return { order, line, cost: assign + (unitFulfillCost.get(order) ?? 0) };
    });
  } else {
    // 全资格全通。成本：绑了 line_assign_cost 就用该线的**真实字段值**（同 facility_location 的
    // assign_cost 口径）；没绑才写 0 —— 0 在这里是"这一维没有数据"的记号，由
    // `eligibilityDefaulted` + `assignCostBound` 两位一起说清楚，不许被读成"占用不要钱"。
    eligibility = orders.flatMap((o) =>
      lines.map((l) => ({ order: o.id, line: l.id, cost: (lineAssignCost.get(l.id) ?? 0) + (unitFulfillCost.get(o.id) ?? 0) })),
    );
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
    /**
     * 占用成本这一维**有没有真数据**（false ⇒ eligibility[].cost 恒 0，不是"免费"是"没量到"）。
     * WO-UNITCOST-LAND：绑了 `unit_cost` 也算"有真数据" —— 那时 cost 里就有一笔真实的按件履约成本，
     * 哪怕按指派那笔一格都没绑。⛔ 漏掉这一支会让毛利轴在"只有按件成本"的租户上被误判成报缺。
     */
    assignCostBound:
      unitCostProp !== undefined ||
      (eligibilityBound ? rm.has("elig_cost") || assignCostProp !== undefined : assignCostProp !== undefined),
    /** `eligibility[].cost` 里**含不含**按件履约成本（`unit_cost` × qty）。下游据此说清成本口径。 */
    costIncludesUnitFulfillment: unitCostProp !== undefined,
    /** 按件履约成本折算用的每单位量字段（`costIncludesUnitFulfillment` 为 false 时无意义）。 */
    unitCostQtyProp: unitCostProp !== undefined ? qtyProp : undefined,
    // ── WO-MARGIN-AXIS · 口径自述（下游据此判「这两根轴能不能相减」，不靠猜）──────────
    /** `orders[].revenue` 是**行金额**（`unit_revenue` × qty）还是**原格总量**（`revenue` 直取）。 */
    revenueFromUnitRate: unitRevProp !== undefined,
    /** 折算用的每单位量字段（`revenueFromUnitRate` 为 false 时无意义）。 */
    revenueQtyProp: unitRevProp !== undefined ? qtyProp : undefined,
    /**
     * 营收侧与成本侧**是否已折到同一个基准货币单位**。
     *
     * ⛔ 这一格是毛利轴的**准入证**：`false` 时两根轴的差值没有意义
     * （实测差 10⁴ 倍那种），`opt-pareto` 见到 false 就拒绝算毛利并明说原因，
     * **不静默给一个错数**。true 的条件是三样都成立：开了 `alignCurrency`、
     * 营收侧刻度取到、成本侧刻度取到（成本没绑时只要营收侧取到即可 —— 那时成本恒 0，
     * 而 `assignCostBound:false` 已把这件事举起来了）。
     */
    // WO-UNITCOST-LAND：按件成本也是成本侧的一格钱 ⇒ 它绑上了就必须**它的刻度也取到**，
    // 否则「元 vs 万元」那种 10⁴ 倍静默错算会从这条新路重新溜进毛利轴。
    currencyAligned:
      alignCurrency &&
      revScale !== undefined &&
      (assignCostProp === undefined && !rm.has("elig_cost") ? true : costScale !== undefined) &&
      (unitCostProp === undefined ? true : unitCostScale !== undefined),
    /** 折算后的基准单位（`currencyAligned` 为 false 时为 undefined —— 不谎报一个没折成的单位）。 */
    currencyUnit: alignCurrency && revScale !== undefined ? CURRENCY_BASE_UNIT : undefined,
  };
}
