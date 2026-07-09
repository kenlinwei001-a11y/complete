# DESIGN-QUERY30-ORCH · 拆单方案（epic → 6 期 WO）

> 源：QUERY30-ORCH（BLOCKED·回炉WO-6）。dev 诚实自阻：WO note 称"10 求解器函数在"不实，实测仅 2/11 存在。
> 本文档为**拆单设计**，待协调方(用户)审定后派 dev。不改运行时。

## 0. 现状裁定（registry 实测·2026-07-09）

- SOLVER_REGISTRY 48 键。QUERY30-ORCH 声明 11 求解器，**实测仅 2 存在**：
  - ✅ `what_if_displacement`（Q01 挤占推演核心·已注册）
  - ✅ `countermeasure_combo`（已除魔数系数→诚实降级态·Phase1 committed）
  - ❌ 缺失 9：`multi_plan_compare` `cash_projection` `labor_balance` `energy_cost_schedule` `full_cost_rollup` `signal_propagation` `reroute_decision` `multi_constraint_schedule` `capex_alternatives`
- **9 缺失中数个可复用现有机器（非从零）**——见下表 P2/P3 复用列。
- 另需：数据地基（§2.1 字段+§2.2 边）+ 跨求解器编排层（真 gap 账本）+ 7workflow/2agent/5skill/30intent 发育（§2.5/2.6）。
- **⚠ 风险（先堵）**：dep `QUERY30-ONTOLOGY-EXT` 标 DONE 但**静态契约无 `Line.capacityDaily/certifiedModels`**（§2.1 标注的"最大单点缺口"）、无 `Order.promiseDate/allocatedLineIds`、无边 `Order-ALLOCATED_ON→Line`/`DISPLACES`。数据地基是否真落地存疑 → 若空，9 求解器全建在沙上（绿测试≠能用）。**P0 必须先核实-或-补齐**。

## 1. 拆 6 期 WO

| WO | 内容 | 复用现有机器 | 齿（验收锚） | dep |
|---|---|---|---|---|
| **Q30-P0 数据地基** | `Line.capacityDaily/certifiedModels/changeoverGroup` + `Order.promiseDate/marginPct/allocatedLineIds` + 边 `ALLOCATED_ON`/`DISPLACES` | 核 `QUERY30-ONTOLOGY-EXT` 真落地 | 契约+仓储双实现+迁移+R6；`Line.capacityDaily` 可查真值（非 Base 聚合兜底） | — |
| **Q30-P1 Q01 垂直打穿（样板·分期铁律）** | 校验 `what_if_displacement` 真挤占级联 + 新建 `multi_plan_compare`（五维比较矩阵·纯聚合层）+ 接单全链推演 workflow + Q01 NL 入 QOS 场景路由（解 R3 电池卡·9洞共性根） | `what_if_displacement` 已存 | Q01「4680-NCM+20% 六周能否接」经 QueryDock NL→QOS 真跑 → 多方案+挤占明细+毛利变化+受影响订单逐单再方案 | P0 |
| **Q30-P2 求解器横铺 A（复用·低成本）** | `capex_alternatives` / `full_cost_rollup` / `signal_propagation` | `capex_scenario` / `capacity_rollup`+`finance_pnl` / `supplier_disruption_radius`（图传导） | 各 registry 注册+R6+≥1 NL 场景命中 | P1 |
| **Q30-P3 求解器横铺 B（新域·中成本）** | `cash_projection` / `labor_balance` / `energy_cost_schedule` / `reroute_decision` / `multi_constraint_schedule` | `min_cost_flow`(reroute) / 排产族 `sequencing_optimize`+`cert_schedule`+`changeover_sequence`(三约束联解) | 同上 + 联合解真调子约束（非各自为战） | P1 |
| **Q30-P4 跨求解器编排层（治 countermeasure 诈账根）** | 真映射异构子求解器产出（`cert_schedule`→schedule / `changeover`→savedVsDueMin / `capex`→windows·各不同无公共 release 字段）到统一 gap 释放账本；`countermeasure_combo` 除魔数改真调 | — | Q6「保交付/毛利/信用三选二怎么排杠杆组合」真调各子求解器（非借名·非魔数系数） | P2+P3 |
| **Q30-P5 workflow/agent/skill/intent 发育** | 7 workflow + 2 agent + 5 skill + 30 intent 经 ONTO-SCEN 发育管道（genome 声明 planSteps/ruleIds/sliceTargets → 三环长成·非 seed.ts 手装·闭 G-9） | ONTO-SCEN 管道 | 30 问入 intent 目录 + 发育 run 留痕 + 场景卡 PROVISIONAL 起 | P4 |

依赖链：**P0 → P1 → {P2, P3 并行} → P4 → P5**。分期铁律（设计 §3）：P1 先打穿再横铺，不并行开工。

## 2. 派单节奏建议

1. **先派 P0 + P1**（数据地基 + Q01 样板闭环）。我复验：Q01 真 NL 打穿 + 数据真值。
2. 绿后再派 **P2 / P3**（横铺·可并行两 WO）。
3. 末派 **P4 / P5**（编排层 + 发育）。

不一次性丢整 epic：无验收基线的大单 = 返工温床（QUERY30-ORCH 首次即栽在此）。每期独立齿、独立复验。

## 3. 本体引用与影响（铁律 0）

- **对象类型**：Line(+capacityDaily/certifiedModels)、Order(+promiseDate/marginPct/allocatedLineIds)；新边 Order-ALLOCATED_ON→Line、Order-DISPLACES→Order（源 §2.2）。
- **链路**：L-QOS（NL→QOS 场景路由·P1 打穿）、L-SOLVER（求解链·P2/P3）、新增「挤占推演链」Order→Line→Order(被挤)→Customer→Finance。
- **事件**：ONTO-SCEN 发育三环（P5·growth.*）。
- **不变量**：R6 确定性（全求解器）、R3 视图过滤（NL 路由解电池卡）、C34–C50（QUERY30-RULES）。
- **断点**：G-9（场景卡未走发育闭环·P5 闭）、countermeasure 诈账（P4 治）。
- **回写**：P0 落地后回写 §2 对象字段/§3 边；P5 发育回写 §4 事件。
