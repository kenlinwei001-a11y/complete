# 修复报告 · G2 第二阶段（9 个需新增对象类型的求解器）

| 项 | 值 |
|---|---|
| 缺陷 | 核对报告 G2：13 个新求解器仅有声明无实现。第一阶段已补 4 个，本阶段补**剩余 9 个**（需新增对象类型） |
| 范围 | 批次 A（物料/认证/换型域 5 个）：cert_schedule(S07)·kit_readiness(S08)·lta_gap(S09)·inventory_optimize(S10)·changeover_sequence(S11)；批次 B（客户/财务/碳/良率域 4 个）：quote_margin(S15)·credit_exposure(S16)·carbon_footprint(S20)·yield_diagnosis(S12) |
| 修法 | 按 PRD-catalog §2 公式级规格实现，全部确定性；新增 7 个对象类型 + GenSpec 种子（含 §7 因果植入）+ 上下文加载器 + 算法 + 参照实现双算 |
| 验证 | datacore typecheck+lint 全绿；datacore **228 测试通过**（G2-P1 后 217 + 批次A 6 + 批次B 5）；agentcore 161 不回归；`pnpm -r typecheck` 全绿 |
| 至此 | **13 个缺失求解器全部补完**，20 场景 S01–S20 不再有 `SOLVER_NOT_FOUND` |

## 新增对象类型（7 个）

| 对象 | 用途 | 关键属性 |
|---|---|---|
| Material（8 料） | kit/lta/inventory/quote/carbon | bomPerCell·leadTimeDays·unitPrice·carbonFactor·ltaLockRatio·safetyDays |
| MaterialBatch（每料 4 批） | kit/inventory | qtyTons·ageDays·status·etaDay·lastConsumedDays（植入 6 批呆滞 + 2 批晚到） |
| Certification（型号×产线） | cert_schedule | status(量产/认证中/待认证)·certHours（lognormal 工时，追加 2 条待认证） |
| ChangeoverMatrix（6×6） | changeover_sequence | minutes（对角 0、同体系 30–60、跨体系 90–180） |
| Customer（8） | quote/credit | creditLimit·paymentTermsDays·discountRate·maxOverdueDays（G 植入逾期 38 天） |
| ARInvoice（24） | credit_exposure | amount·dueDate·status·overdueDays |
| CarbonFactor（省电网×8） | carbon_footprint | kind=grid·refKey(省)·factor（kgCO2e/kWh） |

并为 Base 增 `province` + `energyKwhPerCell`（成都植高/常州植低 → S20 碳超标戏剧点）。

> 种子持久化注意：物料/碳因子主键含中文，`obj_` 存储 id 改用 `hashString(pk)` 保唯一（直接用中文 PK 经 `[^\w-]→_` 归一会塌缩成同一 id 互相覆盖）。`energyKwhPerCell` 用 hashString 派生而非 `rng()`，**不消费主随机流**，避免扰动既有订单/拓扑序（这是首版会破坏 affected_orders/calibration 的根因，已修正）。

## 各求解器算法（忠实 PRD-catalog §2）

- **S07 cert_schedule**：待认证集（认证中/待认证），`priority=需求贡献/认证工时`，按 priority 降序在 `engineerGroups` 台并行机上装箱（C26 并行 ≤ 工程师组数），输出排期 {开始/完成周, 解锁产能}。
- **S08 kit_readiness**：逐单 `齐套率 = min_物料 (现库+ETA≤开工日在途)/(单耗×qty×packCells)`，开工日=交期−标准周期；缺料项带最早补齐日 + 三类建议。
- **S09 lta_gap**：`净需求=月需求−现库−在途`；`长协可用=年锁量×月配额`；`现货缺口=max(0,净需求−长协可用)`；建议 PO 两批，最迟下单日=需求日−交期。
- **S10 inventory_optimize**：`目标=日均耗用×(交期+安全天数)`，超储/欠储按 1.5/0.8 系数；可释放资金=Σ超储×单价；呆滞=≥90 日（C28）。
- **S11 changeover_sequence**：周订单集最近邻贪心（每步选换型矩阵最小者），vs 交期序节省分钟，标注违反交期单（C29 冻结期）。
- **S15 quote_margin**：`BOM=Σ(单耗×packCells×大宗价×(1+加工费率))`；报价=成本/(1−目标毛利)×(1−客户折扣)；`毛利率=(价−成本)/价` 对比细分底线（C15）；客户折扣驱动过线/触线/低于判定。
- **S16 credit_exposure**：`敞口=在手应收+在产未开票`；`可用=额度−敞口`；逾期 `overdueDays>30`(C32) 优先于额度判定→冻结。
- **S20 carbon_footprint**：`碳/电芯=Σ(单耗×物料碳因子)+单位能耗×省电网因子`，对比欧盟阈值；成都(四川电网×高能耗)超标、常州达标；最大改善杠杆=分解最大项。
- **S12 yield_diagnosis**：确定性良率日序（基线+小噪声，涂布×常州植入阶跃 −2pct）；滑窗 `|后7均−前7均|>2σ(前window)` 检突变日；候选根因=突变日 ±2 内事件对象（来料批次/检修/换批），C30 连降评审触发。

## 设计一致性

- **单一参数源**：全部业务常量（费率/上限/工程师组数/阈值/对策释放比）落在 `solver_params.p2`，遵循"求解器代码内绝不硬编码"约定。
- **确定性 + 双算**：9 个求解器纯函数化（`compute()` 无副作用）；测试侧独立重算逐字段比对（BOM/净需求/物料碳/齐套率等），符合 VLE ⑤段断言矩阵。
- **§7 戏剧点已植入并被检出**：呆滞 6 批（S10）、逾期 38 天（S16）、碳超标（S20）、良率突变（S12）、PO 晚到（S08 齐套缺口）—— 各被对应场景真值断言命中。

## 交付

`G2-phase2-solvers.tar.gz`（9 文件）+ `complete-v1.3-full-src.zip`（完整源码，含 G1+G2 全部）+ 本报告。在 v1.1+G1+G2P1 上 apply 即得全部 20 场景可推演。
