# AUDIT-worldstate-rollout · 全 63 求解器 worldAware 判定台账

**WO-WORLDSTATE-SURFACE 的附属审计**（工单硬约束 ②：每个 solver 必须标 `worldAware: true|false`
加一句理由；判不了的标「判不了 + 缺什么证据」）。

## 机制与判定尺

- 机制本体：`apps/datacore/src/solvers/world-surface.ts`（白名单 `WORLD_AWARE_SOLVERS` + 注入器
  `applyWorldStateToContext`），叠加核：`apps/datacore/src/sim/world-read.ts`（`buildSolverWorldOverlay`，
  DIRECT + PROJECTED，与装配器路径同一个核）。
- **判定尺**（白名单收录判据原文）：这个求解器答的是「**这次推演里**会怎样」，还是「**今天的事实**是什么」。
  台账/审计/体检/查询类随推演变反而是错的 ⇒ `false`；答案会被世界态投影（demandPressure→qty↑、
  utilPressure/loadIndex→capacity↓、costPressure→cost↑）改写的 ⇒ `true`。
- **机制可达性两条路**（实测 dispatch，`service.ts` invoke）：
  - **compute 路 25 个**：走 `loadContext` → 注入器 → `compute()`，白名单登记即生效。
  - **拦截路 38 个**：在 `loadContext` 之前被各自入口拦截、直接读 `repos`（实测每个方法体
    头 40 行均为 `repos.objects.listByType` 直读）——本机制**结构性够不着**，要接线须在
    各自入口调**同一个** `buildSolverWorldOverlay` 叠自己的读取结果（不许抄第二份叠加核）。

## 本体引用与影响

对象类型：Order.qty / Line.capacityDaily / Model.cost / Base.loadIndex（投影落点，词库现判）。
链路：demo 需求传导链 `order_for_model → model_producible_at → line_belongs_to_base`。
不变量：R2（跨租户 404 暗发）、R4（只叠副本，仓储行不动）、R6（无 worldId ⇒ 逐字节同旧）。
本文件是审计台账，不改任何链路/事件/门禁。

## 判定总表（63 = true 26 + false 32 + 判不了 5）

### A · worldAware: true —— 已接线（3，本单落地）

| solver | 一句理由 |
|---|---|
| risk_timeline | 曲线由 Line.capacityDaily（空闲产能）与 Order.qty（需求）算出；utilPressure→capacity↓、demandPressure→qty↑ 都在 demo 传导链上。 |
| capacity_forecast | 需求基线 = Σ OPEN Order.qty（demandPressure 直达），供给端吃 loadIndex/utilPressure；两端都被世界态改写。 |
| affected_orders | 延迟判定吃 Order.qty 与基地空闲产能；扰动前后必须给出不同的波及表，否则「施加扰动」与「没施加」同一张表。 |

### B · worldAware: true —— 候选·compute 路·登记即生效（12，剩余清单第一梯队）

| solver | 一句理由 |
|---|---|
| counterfactual_timeline | 双轨推演（内部编排 riskTimeline 同一依赖集，risk.ts 内两处调用）；白名单后自动继承叠加 ctx，零额外改动。 |
| bottleneck_matrix | 瓶颈排位由 Base/Line/Process/Equipment 的负荷与产能算出；loadIndex/utilPressure→capacity↓ 直接改排位。 |
| mitigation_select | 处置选择的输入缺口由 Order/Base 派生（deriveExtendedArgs）；demandPressure→qty 改缺口 ⇒ 改选择。 |
| countermeasure_combo | 对策组合与 mitigation_select 同族：缺口→对策，缺口被世界态改写。 |
| quarterly_gap | 季度供需缺口 = 需求（Order.qty）对供给（产能），两端都在投影表上。 |
| lta_gap | 长期协议覆盖缺口，需求驱动，同上。 |
| kit_readiness | 齐套判定 = 订单需求→物料需求；demandPressure→qty 改需求量 ⇒ 改齐套结论。 |
| inventory_optimize | 库存优化目标与约束由需求派生，demand 投影直达。 |
| changeover_sequence | 换产排序吃订单组合与交期，Order.qty/组合被世界态改写。 |
| maintenance_stagger | 检修错峰吃产能与负荷窗口，utilPressure→capacity↓ 改窗口。 |
| outsourcing_split | 外包拆分吃产能缺口，capacity 投影直达。 |
| quote_margin | 报价毛利 = 按当前成本结构的前瞻回答；costPressure→cost↑ 落其读的 BOM 成本格 ⇒ 世界态报价才是诚实报价。 |

### C · worldAware: true —— 已有自己的世界态口（4，不走本机制）

| solver | 一句理由 |
|---|---|
| finance_world_projection | 专口 `args.worldId` 必填 + 「我没有世界态」做成 400 硬错误 —— 本单闸③照的就是它的样板。 |
| chain_loss_attribution | 专口 `args.sessionId` → `loadChainSimOverlay`；传就变、不传就不变（本单病的金丝雀对照组）。 |
| multi_objective | 装配路世界口：`assembleParetoModel` 里 `input.sessionId` → `buildWorldReadView`；不传 sessionId ⇒ view 不建 ⇒ 逐字节同旧。 |
| optimize_whatif | 同 multi_objective 的装配路口（同一 assembleParetoModel）。 |

### D · worldAware: true —— 候选·拦截路·需在自入口挂同一叠加核（7，剩余清单第二梯队）

| solver | 一句理由 |
|---|---|
| portfolio | 组合优化（订单组合取舍）由需求/成本驱动；intercepted 直读 repos，须在 portfolioOptimize 入口叠同一核。 |
| base_capacity_outlook | 基地产能展望是预测口径，capacity/demand 驱动。（注：`base_outlook_coeffs` 规则有读者零写者是另一单的已知病灶，本单不碰、也不许再造第三个此类死端。） |
| sop_reschedule | S&OP 重排吃供需两侧，demand/capacity 投影直达。 |
| atp_check | 可承诺量 = 产能 − 已承诺，capacity 投影改可承诺量。 |
| decision_play | 决策剧本（缺口→动作编排），缺口被世界态改写。 |
| supplier_disruption_radius | 名字即推演：「这个供应商断供波及多大半径」，断供场景天然该来自 sim 会话。 |
| shared_bottleneck | 通用瓶颈（读任意对象图），与 bottleneck_matrix 同判定，不同数据口。 |

### E · worldAware: false —— 台账/审计/体检/查询/纯参数（32，机制不许够着它们）

| solver | 一句理由 |
|---|---|
| capacity_rollup | 产能结构体检（设备→工序→产线→基地金字塔），答「今天的产能是什么」；已被接缝门钉为白名单外对照组（幽灵 worldId 也 200）。 |
| capacity_ledger | 产能台账（池/入边/工单余量），台账类；`SOLVER_REQUIRED_TYPES.capacity_ledger = []` 连核心对象都不读。 |
| plan_audit | 审计校验：拿 args 计划数对 Segment 边际做合规检查，答「这份计划合不合规」。 |
| plan_generate | `SOLVER_REQUIRED_TYPES = []` 不读任何核心对象，纯 params/args ⇒ 叠加无落点。 |
| capex_scenario | 同上 `[]`，纯 params/args（deriveS0 是 planviews 路径，非 compute）。 |
| cert_schedule | 答「资质窗口内何时能排产」，读 Certification 静态资质格；投影四变量（cost/capacity/demand）不落资质格。 |
| yield_diagnosis | 良率诊断吃 A8 时序 series（自有 async 预注入器），投影无路改良率时序；体检诊断类。 |
| audit_timeline | 审计时间线是事实留痕，随推演变反而是错的。 |
| metric_rollup | 指标汇总，答「今天的指标值」。 |
| cockpit_kpi | KPI 看板，今日事实。 |
| ksf_graph | 关键成功因子图查询，结构事实。 |
| order_fullchain | 订单全链路追溯，事实链路。 |
| mrp_netting | 净需求台账计算，答「今天缺多少料」。 |
| finance_pnl | 真值 P&L 台账；推演口径已有 finance_world_projection 专口，不许把台账做成随推演变。 |
| chain_impediments | 链上堵点检测（事实体检）；另有并行 WO 可能动它，本单明令不碰。 |
| process_flow_time | 流程实例流转时长统计，事实口径。 |
| ontology_query | 本体图遍历查询，结构事实。 |
| generic_inference | 本体派生引擎带 recompute（写路径）；世界态叠加只该发生在只读副本上（R4），要世界态版须在派生源数据层做，不是本机制。 |
| concentration_risk | 供应/客户集中度是结构体检，不随单次推演变。 |
| selection_optimize 等 11 个（selection/assignment/sequencing/packing/job_shop/facility_location/min_cost_flow/set_cover/independent_set/combinatorial_auction/cross_object_occupancy） | 抽象 CP-SAT 模板：问题数据来自请求体 args，不读 ctx 对象数组 ⇒ 投影无落点；要「世界态版寻优」应在上游装配层换问题数据（multi_objective/optimize_whatif 已走那条路）。 |

### F · 判不了（5，各缺一样证据）

| solver | 缺什么证据 |
|---|---|
| gap_attribution | 归因对象语义：调用方要「解释真值缺口」还是「解释推演缺口」——缺前端沙盘是否给它传 sessionId/worldId 入口的证据。 |
| supply_demand_gap_attribution | 同上（供需缺口归因），同一证据缺位。 |
| plan_rootcause | 计划根因是「解释已发生偏差」（false）还是「推演里偏差的根因」（true），缺调用方语义证据。 |
| margin_attribution | 毛利归因同上：归因通常面向已发生事实，但成本压力推演下归因也有意义；缺产品语义证据。 |
| supply_vulnerability | 其「扰动假设」是求解器内生的（false）还是应来自 sim 会话（true），需读其产品定义才能定。 |

## 剩余清单的接线顺序建议（不是本单范围）

1. **先 B 梯队（12 个）**：白名单登记即生效，零新代码路径；但每个都必须先补一条
   「扰动前后回包必须不同」的对照断言（照 `worldstate-surface.seam.test.ts` 头号判据），
   答不出「世界态哪一格改它读的哪一格」的不许登记。
2. **再 D 梯队（7 个）**：各自入口调同一个 `buildSolverWorldOverlay`，不许抄第二份叠加核。
3. **F 梯队（5 个）**：先取证据再判定，不许带着「判不了」进白名单。
