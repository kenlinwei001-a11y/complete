# PRD Addendum：Excel Seed 驱动的 700 亿规模运营数据扩充方案

> 编号：#59  
> 目标：基于 `CALB_Decision_OS_Ontology_Slice_Reasoning_Scenarios_100.xlsx` + `CALB_Decision_OS_Industrial_Digital_Twin_MASTER_FINAL.xlsx` 两份 seed，把系统数据/本体切片/求解器/约束条件/Agent-Workflow 同步扩充到 **年 700 亿收入、17% 综合毛利率、375 万套年需求** 的规模，并给出合理的天/周/月分解。  
> 约束：
> - 不新增硬编码业务常数（R14），所有规模系数、单价、毛利率从 `SEG_REGISTRY` / `PLAN_GOAL_TARGETS` / `BASE_REGISTRY` 推导；
> - 同 seed 字节级一致（R6）；
> - 改动必须回写 `docs/SYSTEM-ONTOLOGY.md`（铁律 0）。

---

## 1. Seed 数据资产清单

| 文件 | 结构 | 用途 |
|---|---|---|
| `CALB_Decision_OS_Ontology_Slice_Reasoning_Scenarios_100.xlsx` | 100 行 × 18 列（推演问题、本体切片、Agent、求解器、约束、输出决策等） | 决策场景模板、Agent/Workflow/约束条件 seed |
| `CALB_Decision_OS_Industrial_Digital_Twin_MASTER_FINAL.xlsx` | 22 个 sheet，50K+ 行 | 主数据 seed：Product/Customer/Base/Line/Equipment/BOM/Order/Inventory/MES/OEE/Rule/Constraint 等 |
| `CALB_Decision_OS_Generated_Scenarios_100.xlsx`（已生成） | 100 行 × 18 列 | 从 MASTER_FINAL 提取客户/产品/基地，按 10 个模板泛化的可执行推演场景 |

---

## 2. 现状差距分析

| 维度 | 当前状态 | 700 亿目标 | 差距 |
|---|---|---|---|
| **需求规模** | SEG_DEMAND 年需求 375 万套：乘用车 201.7 / 储能 139.2 / 商用车 34.1 | 年 375 万套，收入 ≈ 700 亿，毛利率 ≈ 17% | 收入/毛利率已对齐；但**产能、物料、订单、OEE 未同比放大** |
| **Base/Line 产能** | `BASE_REGISTRY` 13 基地，产能约为 132 万套时代的 util/gwh/lines | 需支撑 375 万套/年 | 产能数据未按需求比例缩放，导致 util/gwh 与需求脱节 |
| **物料平衡** | `MAT` 三元正极 8180 吨、隔膜 2376 万㎡、电解液 5544 吨 | 按 375 万套产量同比例放大 | 物料净需求仍为旧规模，出现“收入 700 亿但物料只够 132 万套”的失真 |
| **HTML_ORDERS** | 500–2700 套/单 | 需与 375 万套/年匹配 | 单量数量级过小，订单总和不匹配年度需求 |
| **时间分解** | 仅年度 DemandSegment + 月度 SOP 版本 | 需年→月→周→日 | 缺少 Weekly/Daily 层对象和 solver |
| **求解器** | `metric_rollup`、`order_fullchain`、`financePnl`、`affected_orders` 等 | 需新增日/周/月时间维度 solver | 缺少 `daily_capacity`、`weekly_kit`、`monthly_gap` 等 |
| **约束条件** | C01-C25 左右 | 需新增时间粒度约束 | 缺少日 util、周 kit、月 freeze、碳排、良率下限等 |
| **Agent/Workflow** | 已有 5 类 Agent 概念 | 需基于 100 场景注册 skill、workflow 模板 | 场景与 skill/workflow 未绑定 |

---

## 3. 总体架构：Seed → Scale → Slice → Solver → Constraint

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: Agent / Workflow / Scenario Templates             │
│  (100 scenarios → 5 agents → 10 workflows)                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Constraints (C26-C30)                             │
│  daily_util / weekly_kit / monthly_freeze / carbon / yield  │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Solvers                                           │
│  daily_capacity / weekly_kit / monthly_gap / carbon_tracker │
│  yield_analyzer / supply_risk / npi_assess                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Time-Granularity Data Objects                     │
│  MonthlyDemand / WeeklyDemand / DailyPlan                   │
│  MonthlyCapacity / WeeklyUtilization / DailyOEE             │
│  MaterialDailyConsumption / MaterialWeeklyArrival           │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Scaled Master Data                                │
│  Base/Line capacity scaled ×2.84; Material scaled ×2.84     │
│  Orders aggregated to match 375万套; BOM expanded           │
├─────────────────────────────────────────────────────────────┤
│  Layer 0: Seed Sources                                      │
│  Scenarios Excel + MASTER_FINAL Excel + Generated 100       │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Wave 1：数据规模对齐（Base / Line / Material / Order）

### 4.1 缩放系数推导

- 旧需求规模：约 132 万套/年（隐含在原始 `MAT` 与 `BASE_REGISTRY` 中）。
- 新需求规模：375 万套/年。
- **规模系数 `SCALE_FACTOR = 375 / 132 ≈ 2.84`**。
- 所有从旧规模派生的产能、物料、订单数量统一乘以 `SCALE_FACTOR`，保留 R6 确定性（使用 `round(..., 0/1)`，不引入随机抖动）。

### 4.2 Base/Line 产能缩放

**Seed**：`07_Base_Line_Network`（Base_ID, Line_ID, Capacity, OEE）。

| 字段 | 当前 | 调整后 |
|---|---|---|
| `util` | 各基地旧 util | `round(min(util × 2.84 / load_factor, 95), 1)`，上限 95% |
| `gwh` | 旧 GWh | `round(gwh × 2.84, 1)` |
| `lines` | 旧 line 数 | `ceil(lines × 2.84)`，部分基地新增产线 |
| `bottleneck` | 旧瓶颈 | 根据缩放后负载重新计算 |

**约束**：
- 任何基地利用率不超过 95%（预留爬坡/维护缓冲）。
- 总产能 ≥ 375 万套 × 平均单车带电量系数。

### 4.3 物料平衡缩放

**Seed**：`10_BOM_Material`（Material_ID, Quantity, Unit, Level）。

| 物料 | 当前净需求 | 缩放后净需求 |
|---|---|---|
| 三元正极 | 8,180 吨 | `round(8180 × 2.84, 0)` = 23,231 吨 |
| 隔膜 | 2,376 万㎡ | `round(2376 × 2.84, 0)` = 6,748 万㎡ |
| 电解液 | 5,544 吨 | `round(5544 × 2.84, 0)` = 15,745 吨 |

**新增物料**：从 `BOM_Material` seed 中提取 Top-N 关键物料，补齐到 `MAT` 列表中（负极材料、结构件、包材等）。

### 4.4 订单数据缩放

**Seed**：`11_Order_Demand`（Order_ID, Customer_ID, Product_ID, Quantity）。

- 旧 `HTML_ORDERS`：500–2,700 套/单，总量约数千套。
- 新目标：年 375 万套。
- 策略：保留原订单分布形态，但把单量放大，并把订单数量增加到与年度需求匹配。
- 简单可行方案：
  - 单量 = `round(old_qty × 2.84, 0)`；
  - 订单总数按 375 万套 / 平均单量反推，从 seed 循环取 `Customer_ID`/`Product_ID` 生成。

### 4.5 700 亿 / 17% 校验

- `totalRev = Σ(p50 × priceWan)` 应保持 ≈ 700.0 亿。
- `gmRate = totalMargin / totalRev × 100` 应保持 ≈ 17.0%。
- 若缩放物料/产能导致成本项变化，需同步 `SEG_REGISTRY.marginPct` 微调或成本加成逻辑保持 17%。

---

## 5. Wave 2：时间维度数据层（年 → 月 → 周 → 日）

### 5.1 新增对象类型

| 对象类型 | 领域 | 说明 |
|---|---|---|
| `MonthlyDemand` | `plan` | 按客户/产品/基地的月度需求 |
| `WeeklyDemand` | `plan` | 按客户/产品/基地的每周需求 |
| `DailyPlan` | `plan` | 日生产计划 |
| `MonthlyCapacity` | `factory` | 月度可用产能 |
| `WeeklyUtilization` | `factory` | 周利用率 |
| `DailyOEE` | `equip` | 日 OEE |
| `MaterialDailyConsumption` | `supply` | 日物料消耗 |
| `MaterialWeeklyArrival` | `supply` | 周物料到货计划 |

### 5.2 分解规则

**年 → 月**：
- 从 `SEG_DEMAND` 年度 p50 出发，按 S-curve/季节系数分解到 12 个月。
- 季节系数从 `Order_Demand` seed 的月份分布统计得到（若无，使用预设的锂电行业旺季系数）。

**月 → 周**：
- 每月按 4.33 周平均分配，叠加周波动系数（±5%，由 seed 哈希确定）。

**周 → 日**：
- 每周 5 个工作日，日计划 = 周计划 / 5，再叠加设备 OEE 日波动（从 `13_MES_IOT_OEE` seed 统计）。

### 5.3 关键字段

`MonthlyDemand`：
- `monthlyDemandId`, `year`, `month`, `customerId`, `productId`, `baseId`, `quantitySet`, `revenueWan`, `gmPct`

`DailyPlan`：
- `dailyPlanId`, `date`, `lineId`, `productId`, `plannedQty`, `actualQty`, `oeePct`, `status`

---

## 6. Wave 3：求解器扩充

新增 solver 注册到 `apps/datacore/src/solvers/service.ts`，并同步 mock 到 `simSolvers.ts`。

| Solver | 输入 | 输出 | 绑定场景模板 |
|---|---|---|---|
| `daily_capacity` | DailyPlan + Line + OEE | 日产能缺口/超载/建议调整 | 模板 1/3/6 |
| `weekly_kit` | WeeklyDemand + BOM + MaterialWeeklyArrival | 周齐套率/缺料清单 | 模板 2 |
| `monthly_gap` | MonthlyDemand + MonthlyCapacity | 月度供需缺口 | 模板 1/6/9 |
| `supply_risk` | Supplier + Material + Inventory | 替代方案/风险等级 | 模板 2 |
| `npi_assess` | ProductVersion + Line + Equipment | 新工艺/设备/产能满足度 | 模板 4 |
| `delivery_risk` | Order + Progress + Line | 延期概率/根因 | 模板 5 |
| `cost_down` | BOM + Material + Energy | 降本方案 | 模板 7 |
| `yield_analyzer` | ProcessCapability + Quality + MES | 良率根因/改善方案 | 模板 8 |
| `capex_sim` | DemandGrowth + LineCost + Capacity | 投资收益模拟 | 模板 9 |
| `carbon_tracker` | DailyPlan + Energy + EmissionFactor | 碳排/能源优化 | 模板 10 |

---

## 7. Wave 4：约束条件扩充

新增约束注册到规则 DSL / constraint 模块（参考 `16_Constraint_Model` seed）。

| ID | 名称 | 表达式 | 触发场景 |
|---|---|---|---|
| C26 | 日产能利用率上限 | `daily_utilization <= 95%` | 模板 1/3/6 |
| C27 | 周物料齐套率下限 | `weekly_kit_rate >= 98%` | 模板 2 |
| C28 | 月度冻结期 | `monthly_freeze_days >= 7` | 模板 1/6 |
| C29 | 碳排上限 | `unit_carbon <= target_carbon` | 模板 10 |
| C30 | 良率下限 | `process_yield >= 95%` | 模板 8 |
| C31 | 交付准时率 | `on_time_rate >= 98%` | 模板 5 |
| C32 | 投资回报率 | `roi >= 15%` | 模板 9 |

---

## 8. Wave 5：Agent / Workflow / 本体切片扩充

### 8.1 Agent Skill 映射

| Agent | Skill | 绑定 Solver | 场景模板 |
|---|---|---|---|
| Capacity Agent | `assess_capacity_rebalance` | `daily_capacity` / `monthly_gap` | 1, 3, 6, 9 |
| Supply Risk Agent | `assess_supply_alternative` | `weekly_kit` / `supply_risk` | 2 |
| Maintenance Agent | `assess_downtime_impact` | `daily_capacity` / `yield_analyzer` | 3, 8 |
| Planning Agent | `optimize_production_layout` | `monthly_gap` / `delivery_risk` | 1, 5, 6, 7, 10 |
| Simulation Agent | `run_what_if_simulation` | `capex_sim` / `cost_down` / `carbon_tracker` | 4, 7, 9, 10 |

### 8.2 Workflow 模板

统一决策工作流（每个场景实例化）：

```
Event Trigger
    ↓
Ontology Query（定位影响对象：Product/Order/Line/Material）
    ↓
Data Aggregation（从数字孪生取实时状态）
    ↓
Rule Check（C26-C32）
    ↓
Agent Reasoning（选择 Skill）
    ↓
Solver Optimization（MILP / CP-SAT / Monte Carlo / Graph）
    ↓
Action Generation（计划调整/风险预警/资源配置/投资建议）
    ↓
Human Approval / Auto-execution
```

### 8.3 本体切片

基于 `02_Object_Model` + `03_Relationship_Model`，把 27 个对象类型划分为 10 个领域切片：

1. 产品工程切片（Product/Cell/Module/Pack/BOM/Routing）
2. 客户订单切片（Customer/Contract/Order/Demand）
3. 需求预测切片（Demand/Forecast/Plan）
4. 制造网络切片（Factory/Workshop/Line）
5. 产线能力切片（Line/Equipment/Process/OEE）
6. 设备资产切片（Equipment/Maintenance/SparePart）
7. 供应链切片（Supplier/Material/Inventory/Warehouse）
8. 质量切片（Quality/Inspection/Defect）
9. 物流切片（Shipment/Warehouse/Inventory）
10. 能源碳排切片（Energy/Carbon/Process）

---

## 9. Wave 6：前端同步与回归测试

### 9.1 前端同步清单

| 文件 | 同步内容 |
|---|---|
| `apps/frontend-shell/src/mocks/fixtures.ts` | GRAPH 新增时间维度节点/边；`sopConfig` 规模对齐；`riskTimeline` 约束条件卡片 |
| `apps/frontend-shell/src/mocks/simSolvers.ts` | 新增 solver mock：`daily_capacity`、`weekly_kit`、`monthly_gap` 等；`PLAN_VERSION_CURRENT` 规模对齐 |
| `apps/frontend-shell/src/views/DashboardView.tsx` | 时间维度 KPI 展示（日/周/月切换） |
| `apps/frontend-shell/src/widgets/` | 新增 DailyCapacityWidget / WeeklyKitWidget / MonthlyGapWidget（可选） |

### 9.2 回归测试门禁

```bash
pnpm -r build
pnpm -r test
pnpm -r lint / typecheck
```

关键验证点：
- `curl :4001/a/v1/objects/MonthlyDemand | jq '.items | length'` 期望 ≥ 12 个月 × 基地数 × 产品数
- `curl :4001/a/v1/objects/DailyPlan | jq '.items | length'` 期望 ≈ 260 工作日 × 产线数
- Dashboard 毛利率 ≈ 17%，收入 ≈ 700 亿
- VLE 闭环测试通过（修复因规模变化导致的断言失败）

---

## 10. 文件变更清单

| 文件 | 变更 |
|---|---|
| `apps/datacore/src/synthetic/battery.ts` | SEG_DEMAND 不变；MAT 放大 ×2.84；Base/Line 容量放大；HTML_ORDERS 放大；新增时间维度对象生成 |
| `apps/datacore/src/synthetic/battery-extended.ts` | 新增 MonthlyDemand/WeeklyDemand/DailyPlan 等对象类型定义 |
| `apps/datacore/src/solvers/service.ts` | 注册 10 个新 solver |
| `apps/datacore/src/rules/constraints.ts`（或等价文件） | 新增 C26-C32 约束 |
| `apps/datacore/src/synthetic/seed.ts` | 扩展 Agent/Workflow/Skill seed |
| `packages/contracts/src/base-registry.ts` | 如新增边界册（可选） |
| `apps/frontend-shell/src/mocks/fixtures.ts` | 同步 GRAPH + sopConfig |
| `apps/frontend-shell/src/mocks/simSolvers.ts` | 同步 solver mock |
| `docs/SYSTEM-ONTOLOGY.md` | 回写 §2 新增对象、§3 新增链路、§5 新增不变量、§6 新增约束 |
| `docs/PRD-addendum-excel-seed-700B-expansion.md` | 本方案 |

---

## 11. 实施顺序建议

```
Wave 1: 数据规模对齐（Base/Line/Material/Order 放大到 375万套）
Wave 2: 时间维度数据层（年→月→周→日对象）
Wave 3: 求解器扩充（daily/weekly/monthly + 9 个新 solver）
Wave 4: 约束条件扩充（C26-C32）
Wave 5: Agent/Workflow/本体切片扩充
Wave 6: 前端同步 + 本体回写 + 全量回归测试
```

每个 Wave 完成后都应可独立编译、独立测试。

---

## 12. 验收标准

1. 年收入 ≈ 700 亿，综合毛利率 ≈ 17%。
2. 物料净需求、Base/Line 产能与 375 万套年需求匹配，无数量级脱节。
3. 新增时间维度对象：月度 ≥ 数百条，周 ≥ 数千条，日 ≥ 数万条（稀疏但可查询）。
4. 新增 10 个 solver，每个 solver 有 mock 数据覆盖至少 1 个场景。
5. 新增 7 个约束条件，VLE 测试可验证。
6. 5 个 Agent 各有 ≥ 2 个 skill，10 个 workflow 模板可实例化。
7. `pnpm -r build && pnpm -r test` 全绿（或修复全部新增失败）。
