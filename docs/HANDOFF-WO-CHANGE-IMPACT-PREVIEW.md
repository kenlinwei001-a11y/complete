# HANDOFF · WO-CHANGE-IMPACT-PREVIEW · 变更传播预览（模型层 previewChangeImpact + POST /a/v1/sim/change-impact-preview）

- 分支：`claude/handoff-wo-change-impact-preview`
- 范围边界遵守：只碰模型层纯函数 + 最小接线 + 测试 + 本文档。**未碰** `apps/frontend-shell/src/views/sim/**`（UI 另开单）。
- 背景：本仓此前完全没有「变更传播预览」——用户改扰动 / 关传导边 / 改派生公式，按下去之前看不到波及面（与事故 `G-LEVER-SNAPSHOT-UNIT-LIE` 同源：假数进审批留痕，屏上看不见）。参照物 `docs/REF-ontology-twin-ux.html:156` 有「假设焦点节点变动，按关系类型分桶列出必须执行的动作」。本单交付模型层纯函数 `previewChangeImpact` + 最小接线 `POST /a/v1/sim/change-impact-preview`。

---

## ① 传播关系清单（实测）

预览引擎要覆盖的传播关系，实测共 **五族**，全部有 file:line 证据。另有四项查过后**点名排除**（理由见 §1.6）。

### 1.1 传导规则 PropagationRule（35 条种子，PUBLISHED）

- **契约**：`packages/contracts/src/sim.ts:39` `PropagationRuleSchema`——`sourceTypeKey.sourceStateVar` →`viaLinkKey`→ `targetTypeKey.targetStateVar`，另带 `coefficient` / `delayTicks` / `combine(sum|max)` / `decay` / `clamp` / `coefficientRef(ruleKey+paramKey)` / `cadenceNodeId` / `domainKey`。
- **引擎**：`apps/datacore/src/sim/propagation.ts:442` `propagateTick`——每 tick 单跳（源读 `effState` ≤t，贡献落 `next`，跨跳 = 跨 tick）；`sourceVal===0` 跳过；`delayTicks` 排 pending（`arriveTick>tick`）；cadence 闸门拿不到进 `unresolvedGates`；`round12` 固定精度。
- **装配唯一处**：`apps/datacore/src/sim/propagation-inputs.ts:65` `buildPropagationInputs`。
- **种子**：`apps/datacore/src/seed.ts` `seedDemoPropagationRules`，35 条 PUBLISHED；既有测试 `apps/datacore/test/seed-demo-propagation.test.ts` 断言 `propagationCount===35`。
- **金丝雀 3 跳链**（真实存在于种子，预览的跳数展开以它为锚）：
  `demo_order_demand_pressure`（Order.demandPressure →order_for_model→ Model.demandLoad，0.8 / delay0）→ `demo_model_demand_to_base_load`（Model.demandLoad →model_producible_at→ Base.loadIndex，0.6 / 0）→ `demo_base_load_to_line_util`（Base.loadIndex →line_belongs_to_base→ Line.utilPressure，delayTicks=1）。

### 1.2 结构边 LinkType + link 实例（100 个 link key）

- 实测：`apps/datacore/src/synthetic/battery.ts` `batteryLinkTypes` 函数体内 `key: "..."` 去重计 **100**。
- 是传导导航的基底：`propagateTick` 的 `navOut` 索引与 ontology-core `recompute` 的 `navIn`/`navOut` 两个引擎都吃它。

### 1.3 派生属性 ObjectTypeDef.derivedProperties（14 条种子公式）

- 实测：grep `formula:` 于 `battery.ts`，命中 `:781-784` `:809-810` `:1028` `:1160-1161` `:1218` `:1245-1246` `:1277` `:1351` `:1371`，共 **14 条**。
- **契约**：`apps/datacore/src/domain.ts:249` `DerivedPropertyDef {propKey, formula}`。
- **引擎**：`apps/datacore/src/ontology.ts:862` `runDerivations` 批量触发；两型公式——聚合 `FN(Type.prop BY field)`（`parseAggregate` :64，跨类型，`byField` 匹配目标主键 `primaryKeyProp` :119）/ 算术（`evalArithmetic` :78，同对象标识符，未知标识符按 0 计）；`topoOrder` :804 遇环直接 throw `derivation cycle at X`。
- 种子举例：`Base.orderCount = COUNT(Order.so BY bases)`、`Base.committedQty = SUM(Order.qty BY bases)`、`Model.totalDemand = SUM(Order.qty BY model)`、`Order.value = qty*unitPrice`。

### 1.4 DerivationSpec 第二套派生系统（机制在、demo 零种子——「接了线没数据」态）

- **契约**：`apps/datacore/src/domain.ts:434` `DerivationSpecRecord {specKey, targetType, targetProp, formula, deps[{typeKey, prop, via?, direction?}], status}`。
- **引擎**：`apps/datacore/src/ontology-core.ts:219` `compileSpecs`（`parseFormula`→`extractDeps`→Kahn `topoSort` :267，拒环 `CYCLIC_DERIVATION` 带环路径）；`:341` `recompute`（增量 + dryRun what-if；`propToSpecs` 含 `Type.*` 通配 :391-397；`resolveAffectedTargets` :400 沿 `navIn`/`navOut` 反导航：`direction=out` ⇒ target 在 `fromId` 侧，`direction=in` ⇒ target 在 `toId` 侧；沿 topo 序传播 dirty :447）。
- **唯一写者**：`ontology-core.ts:246`（`compileSpecs` 内 `repos.derivationSpecs.put`）；生产调用方 `app.ts:4095` 路由。
- **必须点名**：**两套派生系统并存是实测发现**——`derivedProperties`（§1.3）批量全量 vs `DerivationSpec` 增量按变更集；机制全在但 demo 零种子，是「接了线没数据」态（不是没接线），预览引擎须明确标注这一族当前无实例可波及。

### 1.5 规则表达式 RuleEntry.expression（29 条种子）

- 实测：`grep -c "expression:" battery.ts` = **29**。
- **DSL**：`apps/datacore/src/ruledsl.ts` `parseExpression` :334 / `collectFieldPaths` :391（抽字段引用，rejudge 桶的依据）/ `evaluateExpression` :558。
- 种子举例：`battery.ts` C03 / C05 / C08 / C13 等（expression 经 `parityRuleExpression` 派生引用 params）。

### 1.6 排除项（查过、点名、给理由）

| 候选 | 排除理由 |
|---|---|
| causal-graph `CausalEdge` | gap_attribution 查询时投影，非传播关系本体 |
| finance-world 的 PropagationRule 使用 | 读端投影 |
| `Metric.ksfRef` | 求解器内部 |
| 既有端点 `POST /a/v1/simulation/impact-analysis`（`app.ts:2230` → `sim/impact-analysis.ts`） | 走 DerivationSpec `recompute` dryRun 栈——与本 WO **不同栈**：本单覆盖 sim 传导 + 两套派生 + 规则判定四族，且按关系分桶带跳数；不重复造 |

### 1.7 金丝雀自证（铁律 0.6 纪律）

本节每个计数 / 否定结论都跑过正向金丝雀：

1. **35 条传导规则**：由既有测试 `apps/datacore/test/seed-demo-propagation.test.ts` 断言确认，非本单次 grep 数出来的。
2. **3 跳链**：`demo_order_demand_pressure` / `demo_model_demand_to_base_load` / `demo_base_load_to_line_util` 三条 key 在种子中均可取到实例，逐跳 viaLinkKey 对得上。
3. **100 个 link key**：计数集中含已知必中的 `order_for_model` / `model_producible_at` / `line_belongs_to_base`——三枚金丝雀全中，工具没瞎，100 可信。
4. **14 条 derivedProperties——差点报假阴性的教训**：第一次按 `derivedProperties: []` 形态 grep，零命中（种子不是内联空数组形态）；换 `formula:` 才追到变量赋值形态。**这是铁律 0.6 的实例：「我用 `derivedProperties:` 字面量当作派生公式存在性的证据，而前者并不度量后者。」** 否定结论前先自证工具的判据，在此节直接决定结论真假。
5. **29 条 expression**：`grep -c "expression:"` 命中 29，同文件内已知必中的 C03/C05/C08/C13 在命中集内。

---

## ② 改法与论据

（待补）

## ③ T1–T5 实测输出原文

（待补）

## ④ 基线变化

（待补）

## ⑤ 与其他 dev 文件重叠

（待补）

## ⑥ 没做的部分 + 差什么 + 可派的具体单

（待补）
