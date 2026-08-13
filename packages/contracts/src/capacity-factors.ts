import { z } from "zod";

/**
 * WO-CAPLIVE-1-ATOM · 产能推演 20 原子因子 → object.property 绑定**单一来源**（R14·治 G-CAPACITY-FACTOR-SHALLOW）。
 *
 * 背景（断点 G-CAPACITY-FACTOR-SHALLOW「20 因素宽而浅」）：前端 `factorOntology.ts` 的 20 因子（圈号 ①–⑳）
 * 只有 op + 圈号、**无 object.property 落点**；只有 `LEVER_FACTOR_PROPS`（4 因子可写）与 `bottleneck_matrix`
 * （7 因子有真张力）落到真属性 → ~13/20 是纯展示徽标。本表给**每个因子一个 object.property 落点 + 颗粒 + 可写标**，
 * 成为原子因子活推演（`capacity_forecast.byProcessModel` per-工序×型号-物料 + `discoverLevers` 反推）的接线单源。
 *
 * 纪律：
 *  - **单源**：前端 `factorOntology.ts` 应派生引用本表（不再各处散配 object.property·R14）；datacore `capacity.ts`
 *    的 `byProcessModel` 逐格瓶颈判定、`service.ts discoverLevers` 的 capacity grain 反推**读本表取属性**（改本表即改推演·非写死）。
 *  - **grain**：`'base'`（基地级聚合）/`'process'`（每工序·设备/产线归工序）/`'model-material'`（每型号-物料 BOM 齐套）。
 *  - **writable**：该属性是否为**派生叶输入**（可拨动的杠杆落点）；只读派生/结构量标 `false`。
 *  - **ruleGate**：拨动该因子受哪条规则闸约束（C03 物理产能上限 / C06·C16 齐套 / C08 外协红线）；无则省。
 *  - **命名**：`objectType`/`prop` 为真本体标识（与 `synthetic/battery.ts` 对象类型/属性一致）；`factorName` 为业务术语（非外部产品名）。
 */

export const FACTOR_GRAINS = ["base", "process", "model-material"] as const;
export const FactorGrainSchema = z.enum(FACTOR_GRAINS);
export type FactorGrain = z.infer<typeof FactorGrainSchema>;

export const CapacityFactorBindingSchema = z.object({
  /** 圈号 ①–⑳（与 factorOntology.ONTO_FACTORS.mark 单源一致·展示徽标锚）。 */
  mark: z.string(),
  /** 序号 1..20。 */
  num: z.number().int(),
  /** 因子名（业务术语·与 factorOntology.ONTO_FACTORS.name 一致）。 */
  factorName: z.string(),
  /** 落点对象类型（真本体·battery.ts 对象类型 key）。 */
  objectType: z.string(),
  /** 落点属性（真本体属性 key·= 可读/可拨动的 object.property）。 */
  prop: z.string(),
  /** 颗粒：基地 / 每工序 / 每型号-物料。 */
  grain: FactorGrainSchema,
  /** 是否派生叶输入（可作杠杆拨动落点）。 */
  writable: z.boolean(),
  /** 拨动约束规则闸（C03/C06/C08/C16…）·无则省。 */
  ruleGate: z.string().optional(),
});
export type CapacityFactorBinding = z.infer<typeof CapacityFactorBindingSchema>;

/**
 * 20 原子因子绑定单源（marks ①–⑳·6 层产能金字塔·与 factorOntology.ONTO_FACTORS 圈号一一对应）。
 * 数值不入本表（本表只声明"因子落在哪个 object.property·什么颗粒·可否拨动"）；真值由求解器沿链路真算。
 */
export const CAPACITY_FACTOR_BINDINGS: CapacityFactorBinding[] = [
  // 层1 设备（节拍×OEE×通道×班次 → 单机日产出）
  { mark: "①", num: 1, factorName: "节拍 CT", objectType: "Equipment", prop: "ctSeconds", grain: "process", writable: true },
  { mark: "②", num: 2, factorName: "通道数", objectType: "Process", prop: "channels", grain: "process", writable: true, ruleGate: "C03" },
  { mark: "③", num: 3, factorName: "设备OEE", objectType: "Equipment", prop: "oee_current", grain: "process", writable: true }, // WO-LEVER-BINDING-DRIFT：落点=**有效 OEE**（见下 OEE 三原子说明）
  { mark: "④", num: 4, factorName: "性能 OEE-P", objectType: "Equipment", prop: "oeeP", grain: "process", writable: false }, // 被 ③ 快照掩蔽 → 拨不动（sensitivity 恒 0）
  { mark: "⑧", num: 8, factorName: "利用率", objectType: "Process", prop: "utilization", grain: "process", writable: true },
  { mark: "⑯", num: 16, factorName: "班次时长×班次", objectType: "Process", prop: "shifts", grain: "process", writable: true },
  // 层2 工序（×良率×在岗 → 工序日吞吐）
  { mark: "⑥", num: 6, factorName: "工序良率", objectType: "Process", prop: "yield_baseline", grain: "process", writable: true },
  { mark: "⑦", num: 7, factorName: "质量 OEE-Q", objectType: "Equipment", prop: "oeeQ", grain: "process", writable: false }, // 同 ④：被 ③ 快照掩蔽
  { mark: "⑨", num: 9, factorName: "良率爬坡", objectType: "Line", prop: "target_yield", grain: "process", writable: false },
  { mark: "⑰", num: 17, factorName: "在岗出勤/熟练", objectType: "Process", prop: "attendance", grain: "process", writable: true },
  // 层3 产线（min 瓶颈工序·WIP·平衡）
  { mark: "⑩", num: 10, factorName: "瓶颈工序", objectType: "Line", prop: "utilization", grain: "process", writable: true },
  { mark: "⑪", num: 11, factorName: "在制 WIP", objectType: "Line", prop: "capacityDaily", grain: "process", writable: false },
  { mark: "⑫", num: 12, factorName: "产线平衡", objectType: "Line", prop: "max_capacity_day", grain: "process", writable: false },
  // 层4 可投（∩ 物料齐套·到货约束）
  { mark: "⑬", num: 13, factorName: "物料齐套", objectType: "Material", prop: "onHand", grain: "model-material", writable: true, ruleGate: "C06" },
  { mark: "⑭", num: 14, factorName: "BOM 齐套", objectType: "Material", prop: "bomUnit", grain: "model-material", writable: false },
  { mark: "⑮", num: 15, factorName: "物料到货", objectType: "Material", prop: "leadTime", grain: "model-material", writable: true, ruleGate: "C16" },
  // 层5 预测（× 爬坡 − 换型 − 检修）
  { mark: "⑳", num: 20, factorName: "投产爬坡", objectType: "Line", prop: "status", grain: "process", writable: false },
  // WO-ENGINE-2 件一：真属性名是 `minutes`（`battery-extended.ts` ChangeoverMatrix def：pairId/fromModel/toModel/**minutes**/hours/lineId）。
  // 旧写法 `changeoverMin` 在对象上恒不存在 ⇒ `discoverCapacityLevers` 的 `typeof o.props[b.prop] === "number"` 过滤把候选**全部剔掉**
  // （不是 `?? 0` 兜底算 0——两种失效方式修法不同）。⚠️ 改名是必要不充分条件，见下方 ⑤ 的三重死记账。
  { mark: "⑤", num: 5, factorName: "换型损失", objectType: "ChangeoverMatrix", prop: "minutes", grain: "process", writable: true, ruleGate: "C08" },
  { mark: "⑱", num: 18, factorName: "设备检修", objectType: "MaintPlan", prop: "week", grain: "base", writable: false },
  // 层6 缺口（− 需求 → 缺口/富余）
  { mark: "⑲", num: 19, factorName: "需求", objectType: "Order", prop: "qty", grain: "base", writable: false },
];

/**
 * WO-LEVER-BINDING-DRIFT · OEE 三原子 vs 有效 OEE：为什么 ③ 的落点是 `oee_current` 而 ④⑦ 标 `writable:false`
 * （治 `G-LEVER-BINDING-DRIFT`——「设备层拨杆永远反推不出候选」）。
 *
 * **不是两条互相打架的可写路径，是一条**：产能链读 OEE 只经 `capacity.ts equipmentOee(props)` 一个出入口，
 * 而它的语义是 **快照优先、原子兜底**：
 *
 *     oee_current 存在且 >0  →  取 oee_current              （= 有效 OEE·**唯一真被消费的值**）
 *     否则                   →  取 oeeA × oeeP × oeeQ        （兜底分解·仅当快照缺失）
 *
 * 而 `synthetic/battery.ts` 给**每台**设备都回填了 `oee_current = round(oeeA×oeeP×oeeQ, 3)`，
 * 时序 `oee_daily_7d` 也持续把它物化 ⇒ 生产数据下**兜底分支恒不进入**，三原子被快照完全掩蔽。
 * 后果（实测·见 `docs/PRD-lever-binding-drift.md` §2）：`patchCapacityContext` 改 `oeeA/oeeP/oeeQ` 后
 * `equipmentOee` 返回值不变 → Σp50 不变 → 敏感度恒 0 → `service.ts discoverCapacityLevers`
 * 在「无下游影响 → 非有效杠杆」处把它们整批丢弃。**登记三原子为可写落点等于登记三个永远拨不动的杠杆。**
 *
 * 故：
 *  - ③ = 设备层**唯一可拨的 OEE 落点**，prop = `oee_current`（与 `capacity.ts` 逐格瓶颈 ③ 的
 *    provenance `{objectType:"Equipment", prop:"oee_current"}` 对齐——修前二者相左，正是本次漂移的另一半）；
 *  - ④⑦ 保留为**分解原子**（本体属性真实存在、连接器有字段映射），但 `writable:false` 表「今天拨不动」；
 *    可用率 OEE-A 可由 `oee_current /(oeeP × oeeQ)` 反解，不因 ③ 改指而丢失可解释性。
 *  - 若将来去掉快照回填（让 `equipmentOee` 真走乘积分支），届时应把 ④⑦ 连同 OEE-A 一并改回 `writable:true`
 *    并把 ③ 拆开——但那是**改产能链语义**，不属本单；`check-lever-binding-drift.mjs` 会一直盯着这条不变量。
 */

/** 圈号 → 绑定（byProcessModel 逐格瓶颈判定读属性时用·单源查表·非写死）。 */
export function factorBindingByMark(mark: string): CapacityFactorBinding | undefined {
  return CAPACITY_FACTOR_BINDINGS.find((b) => b.mark === mark);
}

/** 可拨动（writable）因子绑定集（discoverLevers capacity grain 的候选杠杆落点单源）。 */
export function writableFactorBindings(grain?: FactorGrain): CapacityFactorBinding[] {
  return CAPACITY_FACTOR_BINDINGS.filter((b) => b.writable && (grain ? matchesGrain(b.grain, grain) : true));
}

/** grain 兼容：'process-model' 作用域含 process ∪ model-material 两颗粒（工序×型号-物料下钻）。 */
export function matchesGrain(bindingGrain: FactorGrain, scope: FactorGrain | "process-model"): boolean {
  if (scope === "process-model") return bindingGrain === "process" || bindingGrain === "model-material";
  return bindingGrain === scope;
}

/** `${objectType}.${prop}` 全集（LEVER_FACTOR_PROPS 派生/校验用）。 */
export function factorPropKeys(): string[] {
  return CAPACITY_FACTOR_BINDINGS.map((b) => `${b.objectType}.${b.prop}`);
}
