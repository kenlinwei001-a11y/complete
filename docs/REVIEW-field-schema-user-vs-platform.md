# REVIEW · 用户《数据字段》设计 ↔ 平台现有字段 · 细致对照

> **这是什么**：审核方逐字段对照**用户提交的《数据字段.docx》**（CALB Decision OS 3-Part 数据字段设计：13 主数据表 + 19 事务表 + Part 3 Ontology/Neo4j/PostgreSQL Schema）与**平台现有字段**（`apps/datacore/src/synthetic/battery.ts` 的对象类型 propKey + LinkType）。
> **一句话**：**同一个域、两种建模哲学**——用户设计=ERP/数仓标准 schema（记录完整、命名规范、Foundry 四件套 Objects/Links/Actions/Metrics 齐全）；平台=决策模型 schema（字段少但全是喂求解器的决策派生量）。**用户的更适合做"导入标准本体"；平台胜在"决策派生字段"深度。**
> **定位**：本文是 `PRD-enterprise-dataset-import.md` 的**字段级依据**——G2 客户本体直导用用户的 objects/relations 作契约，G4 真数据换假值靠"记录字段→决策字段派生映射"（§4）。
> **状态**：评审稿。锚点均已核对（`complete` 分支 · `battery.ts` 行号）。

---

## §0 本体引用与影响（铁律 0）
- **对象类型**（§2）：`ObjectType`/`PropertyDef`/`LinkType`/`derivedProperties`（§2.B·`battery.ts`/`ontology`）· `ModelingSuggestion`（§2·A3）· 拟立 `OntologyImportBundle`（§2·= 用户 objects.json/relations.json 形态）。
- **链路**（§3）：数据接入链（导入侧字段映射）；本文定位字段/基数差异。
- **不变量**（§5）：**R14 应用层无业务常数**（用户业务 schema 留导入侧·不入平台代码）· **R12 字段全建模**（每源字段落对象属性·本文核对覆盖）· R13 溯源 · R6 确定性。
- **断点**（§8）：G-8 数据接入（字段映射补强）。
- **回写**：G2/G4 落地时按用户 schema 登记标准导入本体形态。

---

## §1 定性：记录型 vs 决策型（贯穿全文的一把尺）
| | 用户《数据字段》设计 | 平台 battery.ts |
|---|---|---|
| 建模目的 | 建"**世界的账**"（ERP/数仓·记录完整） | 建"**决策的料**"（喂求解器·派生量） |
| 命名 | 规范 canonical（`factory_id`+`factory_code`） | 电池缩写（`baseId`·id 混编码） |
| Foundry 对齐 | ✅ objects/relations/**actions/metrics** 四件套 + pg DDL(FK约束) + Neo4j | ObjectType/LinkType/Rule/Solver/derivedProperty（无形式化 actions/metrics 声明层） |
| 覆盖广度 | 32 表（含 energy/carbon/labor/quality/forecast/logistics） | 核心 + 扩展对象（Certification/MaterialBatch/CarbonFactor/EnergyMeter/MaintPlan…）字段 terse |
| 层级 | Factory→**Workshop**→Line→Equipment（4层） | Base→Line→**Process**→Equipment（3层·无车间） |

---

## §2 逐实体字段 diff（关键实体）

### 2.1 Factory / Base
- **用户 factory**：`factory_id, factory_code, factory_name, province, city, factory_type(CELL/PACK), capacity_gwh, status, start_date`
- **平台 Base**：`baseId, name, kind, util, bottleneck, gwh, formationCapDaily, agingCapDaily, lon, lat, position, orderCount, committedQty, oeeIndex, modelId, chem`
- **diff**：用户有 `factory_code/province/city/factory_type/status/start_date`（**记录/生命周期元数据**）；平台有 `util/bottleneck/oeeIndex/orderCount/committedQty`（**决策派生量·非源数据**）。geo：用户 province/city，平台 lon/lat。
- **判**：用户完整记录 + 平台派生量互补——导入用户记录 → 平台派生 util/bottleneck。

### 2.2 Workshop（用户独有 · 平台缺）
- **用户 workshop**：`workshop_id, factory_id, workshop_name, process_type`，10 车间(制浆/涂布/辊压/分切/卷绕/装配/注液/化成/分容/PACK)。
- **平台**：🔴 **无独立 Workshop 实体**（工艺折进 Process/Line）。
- **判**：用户的车间层是**真实锂电工艺结构**，平台缺——设备故障/瓶颈定位到车间粒度时平台不够细。

### 2.3 Equipment（分水岭·可靠性 vs OEE）
- **用户 equipment**：`equipment_id, line_id, equipment_code, equipment_type, manufacturer, install_date, **mtbf, mttr, health_score**, status`
- **平台 Equipment**：`equipId, processId, lineId, baseId, ctSeconds, availFactor, **oeeA, oeeP, oeeQ, oee_current**`
- **diff**：用户强在**可靠性工程**(MTBF/MTTR/健康度/厂商/安装日 → 设备故障推演真信号)；平台强在**OEE 三分解**(可用/性能/质量)。**两者几乎不重叠。**
- **判**：🔴 平台该补 MTBF/MTTR/health（equipment_failure 场景的真驱动·现在只有 OEE）。

### 2.4 Product / Model
- **用户 product**：`product_id, product_code, product_name, chemistry, capacity_ah, voltage, application`
- **平台 Model**：`modelId, name, chem, pos, bases, unitPrice, carbonFootprint, totalDemand, orderCount`
- **diff**：用户有 `capacity_ah/voltage/application`（**规格**）；平台有 `unitPrice/carbonFootprint/totalDemand/orderCount`（**商业/决策派生**）。

### 2.5 Order（记录型 vs 决策型·最典型）
- **用户 sales_order**：`order_id, customer_id, order_type, priority, order_date, delivery_date, status, total_quantity, total_amount` + sales_order_item(`order_item_id, order_id, product_id, quantity, unit_price`)
- **平台 Order**：`so, cust, model, qty, due, pri, status, **demandDelta, outsourceRatio, creditUsedRatio, marginPct, allocatedLineIds, penaltyClause, substitutable, priceLockedUntil, costBreakdown, value, promiseDate, leadDays**`
- **diff**：用户是**干净记录**；平台一半字段是**决策派生量**（挤占比/信用占用率/占线明细/成本拆解/毛利率）——**用户源数据里没有这些**。
- **判**：**导入的真难点在此**——记录字段直接落库，决策字段（demandDelta/allocatedLineIds/costBreakdown）必须由平台派生引擎/求解器**算出来**（见 §4）。

### 2.6 BOM / Material / Routing（结构基本对齐）
- **用户 bom**：`product_id, material_id, qty_per_unit, scrap_rate`；**material**：`material_id, material_code, material_name, category, unit, supplier_id, lead_time_day`；**routing**：`product_id, step_no, process, line_type, standard_cycle_time_sec`
- **平台**：Model→BomLine→Material 链 + BomLine 有配比。
- **diff**：用户 bom 有 `scrap_rate`(损耗率)、material 有 `lead_time_day`(采购提前期) — 更全；平台 BOM 结构在但配方值通用。**基本可对齐映射。**

---

## §3 关系 / 基数对照

| 关系 | 用户设计 | 平台 | 判 |
|---|---|---|---|
| Factory 拥有 Line | **HAS · 1:N**（正确） | `line_belongs_to_base` **N:N** | 🔴 **平台基数错**：一条线只属一个基地，应 N:1 |
| Line 用 Equipment | **USES · 1:N** | `equip_used_in`(Equipment→Process N:N) | 用户更直观 |
| Product 耗 Material | **CONSUMES · N:M** | `model_uses_material` N:N + BomLine 桥 | 对齐 |
| 覆盖 | 主干 7 关系·语义清晰(HAS/USES/PRODUCES/CONSUMES/CREATES) | ~20 链路·含扩展(Certification/MaterialBatch/CarbonFactor/MaintPlan/ChangeoverMatrix) | 平台扩展更多·但基数不严谨 |

**用户设计的基数普遍更正确（层级用 1:N）；平台过度用 N:N（`line_belongs_to_base: N:N` 是明确错误）。**

---

## §4 记录型 → 决策型 派生映射（导入落地清单·G4 核心）
用户记录数据导入后，平台派生引擎须把它算成决策字段（**这是治假推演的正解：决策量从真记录算，而非 hash**）：

| 平台决策字段 | 从用户哪些记录字段派生 | 派生逻辑 |
|---|---|---|
| Base.util / oeeIndex | production_line.oee + equipment.oee + production_report | 真实利用率聚合(非 hash·治 WO-CAP-03 稀释) |
| Base.bottleneck | 各 Line/Process 的 capacity vs demand | 真供需缺口(治 WO-CAP-01 mockTightness) |
| Order.demandDelta | sales_order.total_quantity vs forecast.demand | 真需求偏差 |
| Order.allocatedLineIds | production_order.line_id ← order | 真占线明细 |
| Order.costBreakdown | bom×material_cost + labor_cost + energy_cost | 真 BOM 成本(用户有 cost 表) |
| Equipment.oee_current | equipment_event + production_report | 真设备态(非哈希) |
| Material 齐套 | inventory + bom + purchase_order/supplier_delivery | 真齐套 |

→ **用户的 32 表恰好提供了派生这些决策量的全部真实原料**（cost 表/forecast/production_report/equipment_event/inventory 都在），**导入即可从源头替换平台的 hash 假值**。

---

## §5 三条对照结论

1. **用户设计 = 平台缺的"标准导入契约"。** 命名规范、基数正确、FK 约束、Foundry 四件套齐全——比 battery.ts 更适合做"客户导入的标准本体"。**建议 G2 本体直导直接采用用户的 objects.json/relations.json 格式为契约**（`PRD-enterprise-dataset-import.md`）。

2. **导入难点不是字段对不上，是决策派生量要算。** §4 清单是导入落地的核心；用户 32 表提供了派生真原料，导入后由派生引擎算决策字段——顺带治假推演(G4)。

3. **平台该向用户设计对齐三处（该改平台）：**
   - **补 Workshop 车间层**（用户 §2.2·平台缺·工艺粒度不足）。
   - **Equipment 补 MTBF/MTTR/health_score**（用户 §2.3·设备故障推演真信号·平台只有 OEE）。
   - **修基数错误 `line_belongs_to_base` N:N → N:1**（用户 §3·平台链路不严谨）。
   - 可选：采用用户 actions.json/metrics.json 作平台"能力声明层"标准格式。

## §6 关联文档
- `PRD-enterprise-dataset-import.md`（G2 本体直导用本文§5-1 的用户 schema 契约·G4 用本文§4 派生映射）
- `PRD-capacity-sim-decision-flow.md`（WO-CAP-01/03·本文§4 派生治假值配合）
- `AUDIT-fake-simulation-inventory.md`（hash 假值根·本文§4 治其源）
- `HANDOFF-databuilder-genuine-and-import.md`（三份索引·本文补字段级依据）

## 附录 · 证据锚点
用户《数据字段.docx》：Part1 factory/workshop/line/equipment/product/material/bom/routing 字段表 · Part3 objects/relations/actions/metrics.json + pg DDL(FK) + Neo4j。平台：`battery.ts:411`(baseProps)/`:448`(orderProps·决策字段 demandDelta/allocatedLineIds/costBreakdown)/`:506`(equipmentProps·oeeA/P/Q 无MTBF)·`line_belongs_to_base cardinality:"N:N"`(基数错)·母体 §5 R14/R12/R13/R6 · §8 G-8。
