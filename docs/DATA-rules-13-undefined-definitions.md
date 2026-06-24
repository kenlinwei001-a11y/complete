# 规则数据细化 · 13 个未定义规则的真定义 + 求解器引用表 + 硬编码迁移图

> 这是什么：`PRD-rules-as-references.md` 的 **P1 配套数据**——把"被引用但未定义"的规则补成可直接转抄的一等规则定义，并给出 `SOLVER_RULE_REFS` 引用表与硬编码阈值→`rule.params` 迁移图。实施 agent 照此**填空**，不必再决策口径。
> **接地分级**（每条标注）：
> - 🟢 **实测真值**：阈值从真实硬编码/参数提取（battery.ts / capacity.ts），可直接用。
> - 🟡 **参数驱动**：判定逻辑已存在，阈值来自对象字段/params（引用，不要再硬编码一份）。
> - 🔵 **设定值·可配置**：代码无固定阈值 → **本文给定合理默认值**，全部落 `rule.params`/表达式 → **管理员可在规则编辑器随时改，改即推演随之变**（这正是"规则即引用"的目的）。默认值是工程合理取值，非业务承诺；上线后按实际口径调即可。
> 锚点随分支漂，落地前 grep 核对一次。C90 经核实是误报（撞颜色码 `#4C90F0`），不是规则。

---

## 一、13 条规则定义（转抄进 `battery.ts rules[]` / 规则库；schema = 既有 `{key,name,expression,severity}` + 新增 `params`）

| key | name | expression（闸门，规则引擎评估） | severity | params（求解器读的阈值） | 接地 | 锚点 / 引用 |
|---|---|---|---|---|---|---|
| **C01** | 产线设计产能上限 | `Line.weeklyCapacityWan > Line.designCeilingWan` | BLOCK | `{}`（上限=产线字段，按基地/产线数据） | 🟡 参数驱动 | capacity.ts:280/294「physical cap」；与 C03(demandDelta>0.5 闸)互补——C01 是**绝对单线上限**，C03 是**增量闸** |
| **C02** | 化成/老化串并产能口径 | `Process.parallelThroughput < Process.requiredThroughput × (1 − tolerancePct)` | WARN | `{ tolerancePct: 0.05 }` | 🔵 设定·可配置 | battery.ts 注释「C02 串/并口径」；设 5% 容差，可改 |
| **C04** | 仅认证产线计入产能 | `Line.certStatus != '量产'`（未量产产线按系数降额，认证中=0.6） | WARN | `{ productionFactor: 1.0, pendingCertFactor: 0.6 }` | 🟢 实测真值 | battery.ts:85 `certFactors: { 量产:1.0, 认证中:0.6 }`；capacity.ts:223 |
| **C06** | 物料齐套缺口口径（MRP） | `MaterialBalance.gapTon > 0`（gapTon = net×(1−lta/100)） | WARN | `{}`（公式口径） | 🟢 实测真值 | battery.ts:1422「缺口=net×(1−lta/100)，C06 齐套口径」 |
| **C09** | 数据时延临时降级 | `DataSourceHealth.critical == true AND DataSourceHealth.lagHours > 2` | WARN | `{ staleHours: 2, normalFactor: 0.93, degradedFactor: 0.9 }` | 🟢 实测真值 | battery.ts:88 `health:{normal:0.93,degraded:0.9,staleHours:2}`；capacity.ts:189-197 |
| **C10** | 场景必填 + 行动审批留痕 | 治理型：`Scenario.requiredFields 完整 AND Action.approver != null AND Action.audited == true` | BLOCK | `{}`（布尔完整性，无数值阈值；可改表达式/scope） | 🔵 设定·可配置 | orchestration-skeleton.ts:39/151「按规则 C10 校验场景必填字段 / 要求审批人并留审计」 |
| **C11** | 检修窗口与交付高峰错峰 | `MaintPlan.window 距 Base.deliveryPeakWindow < minBufferDays`（检修须与交付高峰留缓冲） | WARN | `{ minBufferDays: 3 }` | 🔵 设定·可配置 | 卡 S03/S13；设 3 天缓冲，可改 |
| **C15** | 经营毛利底线 | `Order.marginPct < DemandSegment.floorPct` | BLOCK | `{ floorPas: 12, floorEss: 11, floorCom: 11 }`（建议直接引用 SEG_REGISTRY.floorPct，勿复制） | 🟢 实测真值 | base-registry.ts:45-47；ruleKeys MARGIN:C15 |
| **C16** | 齐套缺口预警 | `MaterialBalance.gapTon > 0`（与 C06 同口径，C16 偏预警视角） | WARN | `{}` | 🟢 实测真值 | ruleKeys KIT:`C06/C16`；可与 C06 合并或保留为「口径/预警」一对（见 §4 注） |
| **C21** | 产销平衡偏差 | `abs(SopVersionRow.demand − SopVersionRow.supply) / SopVersionRow.demand > balanceDeviationPct` | WARN | `{ balanceDeviationPct: 0.10 }` | 🔵 设定·可配置 | 卡 S04/S18；设 10% 偏差，可改 |
| **C22** | 换型损失/排产约束 | `Order.changeoverMin > maxChangeoverMin`（相邻换型损失超限） | WARN | `{ maxChangeoverMin: 120 }` | 🔵 设定·可配置 | 卡 S11/S18；设 120 分钟，可改 |
| **C24** | 接单毛利过线 | `Quote.marginPct < DemandSegment.floorPct`（接单阶段毛利须过底线，同 C15 口径、用于报价闸） | BLOCK | 同 C15（引用 SEG_REGISTRY.floorPct） | 🟢 实测真值(floor) | 卡 S15 quote_margin；C24 ≈ 报价阶段的 C15（见 §4 注，或合并） |
| **C25** | 外部终端需求假设偏离 | `ExternalSignal.terminalRegistration < AnnualScenario.extDemHigh × (1 − assumeTolerancePct)` | WARN | `{ assumeTolerancePct: 0.05 }` | 🔵 设定·可配置 | simSolvers.ts:199「外部信号·终端需求 ruleRef C25」；设 5% 容差，可改 |

> **🔵 设定·可配置的 6 条（C02/C10/C11/C21/C22/C25）阈值已由本表给定工程合理默认值，全部落 `rule.params`/表达式 → 管理员在规则编辑器随时改、改即推演随之变。** 默认值非业务承诺，上线按实际口径调即可——可直接发布，不阻塞。

---

## 二、`SOLVER_RULE_REFS` 求解器↔规则引用表（来源=卡片 `SCENARIO_CATALOG.rules` 单一来源；落 `packages/contracts`）

```ts
// 每个求解器声明它引用哪些规则（门 rule-closure:check 据此校验"引用⊆已发布定义"）
export const SOLVER_RULE_REFS: Record<string, string[]> = {
  capacity_forecast:    ["C01", "C02", "C03", "C09"],
  affected_orders:      ["C05"],
  risk_timeline:        ["C06", "C11"],
  plan_audit:           ["C15", "C16", "C18", "C21", "C23"],
  plan_generate:        ["C08", "C15", "C18"],
  mitigation_select:    ["C08", "C10"],
  cert_schedule:        ["C04", "C26"],
  kit_readiness:        ["C06", "C16"],
  lta_gap:              ["C16", "C27"],
  inventory_optimize:   ["C16", "C28"],
  changeover_sequence:  ["C22", "C29"],
  yield_diagnosis:      ["C30"],
  maintenance_stagger:  ["C11"],
  outsourcing_split:    ["C08", "C31"],
  quote_margin:         ["C15", "C24"],
  credit_exposure:      ["C13", "C32"],
  capex_scenario:       ["C18", "C23"],
  quarterly_gap:        ["C08", "C29"],
  carbon_footprint:     ["C33"],
  // sop_balance 是工作流非求解器（/a/v1/sop/*），其规则引用 ["C18","C21","C22"] 由 sop 工作流声明
};
```
> 校验闭环：`⋃ SOLVER_RULE_REFS values` 必须 ⊆ 已发布规则 key 集。补完本文 13 条后，全集 = 已定义 15 ∪ 新增 13（去重）= 全部被引用码 → `rule-closure:check` 转绿。**落地前用求解器实际 output `ruleRefs` 对账一次**（卡声明 vs 求解器实出可能有微差，以求解器实出为准收敛）。

---

## 三、硬编码阈值 → `rule.params` 迁移图（去硬编码，规则可编辑则推演随之变）

| 规则 | 现在硬编码在哪（删除/改读规则） | 迁移到 `rule.params` | 求解器改读 |
|---|---|---|---|
| **C09** | `battery.ts:88 health:{normal:0.93,degraded:0.9,staleHours:2}` + `capacity.ts:189-197` 内联比较 | `C09.params = {staleHours:2, normalFactor:0.93, degradedFactor:0.9}` | `capacityForecast` 改读 `rules.C09.params.staleHours` 等 |
| **C04** | `battery.ts:85 certFactors:{量产:1.0,认证中:0.6}` + `capacity.ts:223` | `C04.params = {productionFactor:1.0, pendingCertFactor:0.6}` | `capacityForecast` 改读 `rules.C04.params.pendingCertFactor` |
| **C15/C24** | `base-registry.ts:45-47 floorPct`（分段毛利底线） | `C15.params 引用 SEG_REGISTRY.floorPct`（**单一来源，不复制**） | margin 类求解器闸门调 `evaluate(C15, {marginPct, floorPct})` |
| **C06/C16** | `battery.ts:1422` MRP 公式 net×(1−lta/100) | 公式口径入 `C06.expression`，无数值 param | `kit_readiness`/`mrp_netting` 闸门调规则评估 gapTon>0 |
| **C03** | `capacity.ts:294` physical ceiling 注释 + 表达式已定义 | 已定义（`Order.demandDelta>0.5`）；确认求解器闸门**调规则**而非内联 0.5 | `capacityForecast` 闸门调 `evaluate(C03, {demandDelta})` |
| **C01** | `capacity.ts` 单线 physical cap 内联 | `C01` 上限=产线字段 `designCeilingWan`（对象字段，非 param 常量） | 闸门调 `evaluate(C01, {weeklyCap, ceiling})` |

> 迁移纪律（呼应 `no-hardcoded-rules:check` 门）：求解器源码里凡与上述规则同义的**业务阈值字面量**（0.93/0.6/0.5/12…）必须删除、改读 `rule.params` 或对象字段；改一条规则的 param → 该求解器在**所有 7 个推演入口**的判定随之变（PRD §3 汇聚点保证）。

---

## 四、给实施 agent 的注

1. **🔵 6 条设定规则**（C02/C10/C11/C21/C22/C25）：阈值已给工程合理默认值，**全部落 `rule.params`/表达式 → 可直接发布**（不阻塞 `rule-closure`）。上线后管理员在规则编辑器按实际业务口径调——**改 param 即所有 7 个推演入口的判定随之变**（PRD-rules-as-references §3 汇聚点保证）。这正是"可配置"的兑现：默认值只是起点，不是锁死。
2. **C06 vs C16、C15 vs C24 的重复**：两对语义高度重叠（KIT 口径/预警、毛利底线 经营/报价）。两种处置都可：①保留为一对（不同视角/severity）；②合并为一条 + 在引用处加 `stage` 参数。**建议保留为对**（卡片已分别引用，合并需改 18 处卡声明）。落地前定一种，写进规则 name 区分。
3. **expression 算子**：复用既有 DSL（`> < == AND OR NOT IN SUSTAIN IMPLIES`，见已定义 C30 用 SUSTAIN、C33 用 IMPLIES）。C05/C12/C30 是 `SUSTAIN(谓词, N)` 持续越线范式——C21/C22 若是"持续偏差"也可用 SUSTAIN。
4. **scopeObjectTypes**：每条按 expression 涉及的对象类型填（如 C15→`["Order","DemandSegment"]`，C09→`["DataSourceHealth"]`），供规则引擎 scope 过滤。
5. **落地顺序**：先转抄 8 条 🟢/🟡（实测/参数驱动）→ `rule-closure` 立即从"14 缺"降到"5 缺"；再领域确认 5 条 🟠 → 全绿。

> 状态：P1 规则数据**定稿**。13 条全部可直接转抄发布（🟢7 实测真值/参数驱动 + 🔵6 设定值·可配置），阈值全落 `rule.params`/表达式 → 可编辑、改即推演变。属 `PRD-rules-as-references.md` P1（补全未定义规则 + rule-closure 门）的数据补全。
