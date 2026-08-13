import type { OntologyReadSurface, OntologySignature } from "@platform/contracts";
import type { ObjectInstance } from "../domain.js";

/**
 * WO-69 P2 · **Function 本体签名注册表**（求解器 → 读/写本体面）。
 *
 * ─ 为什么存在 ────────────────────────────────────────────────────────────────
 * P1 给列级（属性级）安全上了一道**粗兜底**：调用者只要在任一对象类型上受列级约束，`SolverService.invoke()`
 * 就拒绝**全部**求解器（403 SOLVER_COLUMN_RESTRICTED）——因为「这个求解器到底读什么」当时**无人知道**。
 * 本表就是把那句「无人知道」变成可机器校验的声明，从而把兜底从「一刀切拒」收窄成「只拒真读到受限列的」。
 *
 * ─ 头号纪律：签名驱动**诚实拒绝**，绝不驱动「带缺列算下去」──────────────────────
 * 原病（live 取证）：受限用户拿到 quote_margin 毛利 **0.868**，真值 **0.2565**——「没权限」伪装成「业务数字」。
 * 拿着一个像模像样的错数去做决策，比看到一条 403 坏得多。故：
 *   · 声明读取面 ∩ 调用者受限列 ≠ ∅ → **拒**（不降级、不置零、不"尽力算"）。
 *   · 求解器**没有签名**（读取面未知）→ **拒**。未知 ≠ 安全。
 *
 * ─ 声明口径（与 S5 观测门共用同一把尺子，不许两套）────────────────────────────
 *  · 列级安全只隐藏**属性**、不隐藏行 ⇒「只 listByType 取了集合但一个属性都没读」的类型
 *    （如 deriveExtendedArgs 顶部无条件 `c.materials.map(o=>o.props)`）**不算**读取面：它对输出不可能有影响。
 *  · `propKeys` 省略 = **该类型全部属性都可能被读**（最保守）。有分支/入参能引入未观测属性的求解器
 *    一律省略（宁可多拒）。
 *  · **过度声明是安全方向（多拒），漏声明是事故方向（误放行 → 出错数字）**。S5 门只对漏声明判红。
 *
 * ─ 完备性：静态声明 + 运行时解析器 ────────────────────────────────────────────
 * 少数求解器的读取面**不是静态的**：
 *   · 入参决定（margin_attribution 的 targetType/costFields、concentration_risk 的 startType/path）；
 *   · 数据决定（gap_attribution 沿 CausalFactor.drillType 下钻、plan_rootcause 沿 RootCauseChain.driverType 取证）。
 * 对这些求解器，静态 `reads` 只是**下界**，另配 `resolveReads()` 在判定时把动态部分补全。
 * 解析器**只在调用者确有列级约束时**才执行（admin / 无列级策略 → 完全不跑 → S8 逐字节现行为）。
 */
export interface SolverOntologySignature extends OntologySignature {
  /**
   * 动态读取面补全（返回**追加**到静态 reads 的面）。只在存在列级约束时调用。
   * `listByType` 是租户内读对象的入口（解析器自己不许绕过 tenant 隔离）。
   */
  resolveReads?: (input: {
    args: Record<string, unknown>;
    listByType: (typeKey: string) => Promise<ObjectInstance[]>;
  }) => Promise<OntologyReadSurface[]>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** 静态 reads ∪ resolveReads() 的并（同 typeKey 合并；任一侧省略 propKeys → 合并结果也省略 = 全属性）。 */
export function mergeReadSurfaces(surfaces: OntologyReadSurface[]): OntologyReadSurface[] {
  const byType = new Map<string, { all: boolean; props: Set<string>; links: Set<string> }>();
  for (const s of surfaces) {
    let e = byType.get(s.typeKey);
    if (!e) {
      e = { all: false, props: new Set(), links: new Set() };
      byType.set(s.typeKey, e);
    }
    if (s.propKeys === undefined) e.all = true;
    else for (const p of s.propKeys) e.props.add(p);
    for (const l of s.linkKeys ?? []) e.links.add(l);
  }
  return [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([typeKey, e]) => ({
      typeKey,
      ...(e.all ? {} : { propKeys: [...e.props].sort() }),
      ...(e.links.size > 0 ? { linkKeys: [...e.links].sort() } : {}),
    }));
}

/** 沿某个「模板对象」的字段值展开出的下钻类型（gap_attribution / plan_rootcause 同型）。 */
const drillTypesFrom = (templateType: string, fieldKey: string) =>
  async ({ listByType }: { listByType: (t: string) => Promise<ObjectInstance[]> }): Promise<OntologyReadSurface[]> => {
    const rows = await listByType(templateType);
    const types = new Set<string>();
    for (const o of rows) {
      const t = str(o.props[fieldKey]);
      if (t) types.add(t);
    }
    // 下钻类型的属性由数据里的 drillField 决定 → propKeys 省略（= 全属性·最保守）。
    return [...types].sort().map((typeKey) => ({ typeKey }));
  };

/**
 * 已声明签名的求解器。**未列入 = 读取面未知 = 列级受限调用者一律拒**（保守缺省，见文件头）。
 * 每条声明由 `ontology-signature.seam.test.ts` 的 S5 门**真跑比对**（不是文档）。
 */
export const SOLVER_ONTOLOGY_SIGNATURES: Record<string, SolverOntologySignature> = {
  // ── ⑩ 洞：早返回求解器（自建 ctx·直取 repos.objects.listByType·不经 loadContext 列投影）────────

  /**
   * gap_attribution：结构层（Metric/Base/CompetitorShare）+ 因果层（CausalFactor 沿 caused_by）
   * + **下钻叶级真值**（类型由 CausalFactor.drillType **数据**决定 → resolveReads 补全）。
   * 静态面取 market_share ⊎ gross_margin 两分支实跑观测的并；propKeys 一律省略（分支/数据可引入新属性）。
   */
  gap_attribution: {
    reads: [
      { typeKey: "Metric" },
      { typeKey: "Base" },
      { typeKey: "CausalFactor", linkKeys: ["caused_by"] },
      { typeKey: "CompetitorShare" },
      { typeKey: "Order" },
      { typeKey: "Equipment" },
    ],
    resolveReads: drillTypesFrom("CausalFactor", "drillType"),
  },

  /**
   * plan_rootcause：Metric（越线判定）+ RootCauseChain（归因模板）+ KSF（层）
   * + **取证驱动类型**（由 RootCauseChain.driverType **数据**决定 → resolveReads 补全）。
   */
  plan_rootcause: {
    reads: [
      { typeKey: "Metric", propKeys: ["actual", "category", "floorVal", "ksfRef", "level", "metricId", "name", "target", "unit"] },
      { typeKey: "RootCauseChain", propKeys: ["baseWeight", "chainId", "driverType", "evidenceField", "factor", "kpiCategory", "selectField"] },
      { typeKey: "KSF", propKeys: ["ksfId", "name", "sub"] },
    ],
    resolveReads: drillTypesFrom("RootCauseChain", "driverType"),
  },

  /**
   * concentration_risk：**读取面完全由入参决定**（startType + path[].toType）——静态无从声明，
   * 全部交给 resolveReads（入参即完备，不依赖数据）。属性含各类型主键（本体决定）→ propKeys 省略。
   */
  concentration_risk: {
    reads: [],
    resolveReads: async ({ args }) => {
      const surfaces: OntologyReadSurface[] = [];
      const startType = str(args.startType);
      if (startType) surfaces.push({ typeKey: startType });
      const path = Array.isArray(args.path) ? (args.path as { toType?: string }[]) : [];
      for (const hop of path) if (hop?.toType) surfaces.push({ typeKey: str(hop.toType) });
      return surfaces;
    },
  },

  /**
   * margin_attribution：读取面由入参决定，且**属性也由入参决定**（revenueField + costFields[].field）
   * → 这是全表唯一能做到入参级精确 propKeys 的一条（主键属性未知 → 连带省略：见下，仍取全属性）。
   */
  margin_attribution: {
    reads: [],
    resolveReads: async ({ args }) => {
      const targetType = str(args.targetType);
      if (!targetType) return [];
      const costFields = Array.isArray(args.costFields) ? (args.costFields as { field?: string }[]) : [];
      const props = [str(args.revenueField) || "revenue", ...costFields.map((c) => str(c?.field))].filter(Boolean);
      // 主键属性名由本体决定（tdef.properties.isPrimaryKey），静态不可知 → 省略 propKeys（全属性·保守）。
      // 若将来把主键也解析进来，可改成精确 propKeys；在那之前**不许**只写 props 就当精确（漏声明=事故方向）。
      void props;
      return [{ typeKey: targetType }];
    },
  },

  /** metric_rollup：Metric（一等经营指标）+ PlanTarget（目标树对齐）。属性由实现固定 → 精确声明。 */
  metric_rollup: {
    reads: [
      { typeKey: "Metric", propKeys: ["actual", "category", "chainKey", "floorVal", "key", "ksfRef", "level", "metricId", "name", "ownerRef", "target", "unit"] },
      { typeKey: "PlanTarget", propKeys: ["period", "value"] },
    ],
  },

  /** cockpit_kpi：5 标量派生自 SopVersionRow/FinancePlan/Base/AnnualScenario。属性实现固定 → 精确。 */
  cockpit_kpi: {
    reads: [
      { typeKey: "SopVersionRow", propKeys: ["isFinal", "supply", "ver"] },
      { typeKey: "FinancePlan", propKeys: ["budget", "line", "rolling"] },
      { typeKey: "Base", propKeys: ["util"] },
      { typeKey: "AnnualScenario", propKeys: ["cashCushion", "key", "revenue"] },
    ],
  },

  /** ksf_graph：Metric + KSF 三层图投影。属性实现固定 → 精确。 */
  ksf_graph: {
    reads: [
      { typeKey: "Metric", propKeys: ["actual", "category", "floorVal", "ksfRef", "metricId", "name", "target", "unit"] },
      { typeKey: "KSF", propKeys: ["key", "ksfId", "name", "sub"] },
    ],
  },

  /** finance_pnl：FinancePlan 三线 + DemandSegment p50。属性实现固定 → 精确。 */
  finance_pnl: {
    reads: [
      { typeKey: "FinancePlan", propKeys: ["budget", "line", "rolling"] },
      { typeKey: "DemandSegment", propKeys: ["p50", "segment"] },
    ],
  },

  /** mrp_netting：MaterialBalance 净需求/缺口。属性实现固定 → 精确。 */
  mrp_netting: {
    reads: [{ typeKey: "MaterialBalance", propKeys: ["etaDate", "gapTon", "ltaPct", "material", "netDemandTon"] }],
  },

  // ── compute() 路径求解器（经 loadContext·列投影已作用，但"投影后照算"同样出错数 → 一并签名）────
  //
  // 注：loadContext 恒装配 certByModel（读 Line.baseId + Model.modelId + model_certified_on），
  //     故本段每条都连带 Line/Model —— 这两类被剔列会让 certByModel 静默算错（连带命门，勿删）。

  /** capacity_rollup：设备→工序→产线→基地 金字塔。 */
  capacity_rollup: {
    reads: [
      { typeKey: "Base", propKeys: ["agingCapDaily", "baseId", "formationCapDaily", "name"] },
      { typeKey: "Line", propKeys: ["baseId", "lineId", "name"], linkKeys: ["model_certified_on"] },
      { typeKey: "Process", propKeys: ["agingDays", "agingSlots", "attendance", "channelOutputDaily", "channels", "kind", "lineId", "name", "processId", "shiftHours", "shifts", "utilization", "yield"] },
      { typeKey: "Equipment", propKeys: ["availFactor", "ctSeconds", "equipId", "oee_current", "processId"] },
      { typeKey: "Model", propKeys: ["modelId"] },
    ],
  },

  /**
   * capacity_forecast：金字塔 + certByModel + 数据健康 + 检修 + 订单落窗。
   * ⚠ granularity:'process-model' 分支走**逐工序×型号产能链**并读 **Material**（物料齐套）——
   *   缺省入参的实跑观测**看不到**这一支，故此处**主动多声明 Material**（宁可多拒；漏声明=事故方向）。
   *   同理各类型 propKeys 一律省略（分支多）。
   */
  capacity_forecast: {
    reads: [
      { typeKey: "Base" },
      { typeKey: "Line", linkKeys: ["model_certified_on"] },
      { typeKey: "Process" },
      { typeKey: "Equipment" },
      { typeKey: "MaintPlan" },
      { typeKey: "Model" },
      { typeKey: "Order" },
      { typeKey: "DataSourceHealth" },
      { typeKey: "Material" },
    ],
  },

  /**
   * bottleneck_matrix：liveTightness/primaryFactor 只读金字塔四类（+ certByModel 连带 Line/Model）。
   * ⚠ 并线补声明（WO-R2 收编 P2 时被 S5 实跑当场揪出）：canonical 侧 `Process` 的读取面自本单分叉后
   * 长出了产能/老化/通道那一组属性；签名**漏声明 = 守卫误放行 = 出错数字**（正是本门存在的理由），
   * 故按 S5 实跑结果逐条补齐，而不是把断言改软。
   */
  bottleneck_matrix: {
    reads: [
      { typeKey: "Base", propKeys: ["baseId", "name", "util"] },
      { typeKey: "Line", propKeys: ["baseId"], linkKeys: ["model_certified_on"] },
      {
        typeKey: "Process",
        propKeys: [
          "agingDays",
          "agingSlots",
          "baseId",
          "capacityUnitKind",
          "channelOutputDaily",
          "channels",
          "name",
          "processId",
          "requiredThroughput",
          "yield",
        ],
      },
      { typeKey: "Equipment", propKeys: ["baseId"] },
      { typeKey: "Model", propKeys: ["modelId"] },
    ],
  },

  /**
   * risk_timeline：基线 climb + 事件脉冲 + 受影响订单 + 产能链 overlay。
   * ⚠ CHAIN_MATERIAL_SOLVERS：真缺口经产能链吸收杠杆 → 有读 **Material** 的分支（缺省入参未必触发）→ 主动声明。
   */
  risk_timeline: {
    reads: [
      { typeKey: "Base" },
      { typeKey: "Line", linkKeys: ["model_certified_on"] },
      { typeKey: "Process" },
      { typeKey: "Equipment" },
      { typeKey: "MaintPlan" },
      { typeKey: "Model" },
      { typeKey: "Order" },
      { typeKey: "Shipment" },
      { typeKey: "Segment" },
      { typeKey: "Material" },
      // ⚠ 并线补声明（WO-R2 收编 P2 时被 S5 实跑揪出）：canonical 的 WO-DECISION-INFO
      // 让处置前置期/运费读进 Customer/Supplier/InterBaseTransfer（`DECISION_INFO_SOLVERS`）。
      // 不列 propKeys = 全属性：守卫方向上这是**保守**（更容易拦），漏声明才会误放行出错数字。
      { typeKey: "Customer" },
      { typeKey: "Supplier" },
      { typeKey: "InterBaseTransfer" },
    ],
  },

  /** counterfactual_timeline：内部编排 risk_timeline 双轨推演（同依赖集，含 WO-DECISION-INFO 三类）。 */
  counterfactual_timeline: {
    reads: [
      { typeKey: "Base" },
      { typeKey: "Line", linkKeys: ["model_certified_on"] },
      { typeKey: "Process" },
      { typeKey: "Equipment" },
      { typeKey: "MaintPlan" },
      { typeKey: "Model" },
      { typeKey: "Order" },
      { typeKey: "Shipment" },
      { typeKey: "Segment" },
      { typeKey: "Material" },
      { typeKey: "Customer" },
      { typeKey: "Supplier" },
      { typeKey: "InterBaseTransfer" },
    ],
  },

  /** affected_orders：单基地明细 / 跨基地聚合**两路径并集**（riskEvents ⟹ MaintPlan）。 */
  affected_orders: {
    reads: [
      { typeKey: "Base" },
      { typeKey: "Line", linkKeys: ["model_certified_on"] },
      { typeKey: "Model" },
      { typeKey: "MaintPlan" },
      { typeKey: "Order" },
      { typeKey: "Shipment" },
      { typeKey: "Segment" },
    ],
  },

  /** audit_timeline：kind hash 形状 + riskEvents + affectedOrders。 */
  audit_timeline: {
    reads: [
      { typeKey: "Base" },
      { typeKey: "Line", linkKeys: ["model_certified_on"] },
      { typeKey: "Model" },
      { typeKey: "MaintPlan" },
      { typeKey: "Order" },
      { typeKey: "Shipment" },
      { typeKey: "Segment" },
    ],
  },

  /**
   * quote_margin（E6b 扩展族）：BOM 成本四项分解 —— 读 **Material.unitPrice**（敏感成本列）。
   * 这就是 WO-69 的原病例：受限用户曾拿到 margin 0.868（真值 0.2565）。签名让它**明确落在拒绝侧**。
   */
  quote_margin: {
    reads: [
      { typeKey: "Material", propKeys: ["bomUnit", "unitPrice"] },
      { typeKey: "Line", propKeys: ["baseId"], linkKeys: ["model_certified_on"] },
      { typeKey: "Model", propKeys: ["modelId"] },
    ],
  },

  /**
   * credit_exposure（E6b 扩展族）：敞口=应收+在产 —— 只读 Customer/ARInvoice。
   * 注意它**不读 Material 的任何属性**（deriveExtendedArgs 顶部虽无条件取了 c.materials 集合，
   * 但 credit_exposure 分支一个属性都没读 → 按本文件口径不计入读取面）——这正是 P2 收窄的典型受益者。
   */
  credit_exposure: {
    reads: [
      { typeKey: "Customer", propKeys: ["creditLimit", "custName", "receivables", "wipUnbilled"] },
      { typeKey: "ARInvoice", propKeys: ["amount", "custName", "invoiceId", "overdueDays"] },
      { typeKey: "Line", propKeys: ["baseId"], linkKeys: ["model_certified_on"] },
      { typeKey: "Model", propKeys: ["modelId"] },
    ],
  },
};

/** 已签名求解器 key（目录/DRIL 投影用；排序确定性 R6）。 */
export const SIGNED_SOLVER_KEYS: string[] = Object.keys(SOLVER_ONTOLOGY_SIGNATURES).sort();

/** 投影用：只取可序列化部分（去掉 resolveReads 函数）。 */
export function serializableSignature(key: string): OntologySignature | undefined {
  const sig = SOLVER_ONTOLOGY_SIGNATURES[key];
  if (!sig) return undefined;
  return {
    ...(sig.reads ? { reads: sig.reads } : {}),
    ...(sig.writes ? { writes: sig.writes } : {}),
  };
}
