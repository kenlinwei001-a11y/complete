# 逐条核 · 仓主端到端 Demo 链的 52 项原子需求

> 2026-08-09 · 审核方 · 起因：我上一轮把这条链当成「14 个方框」来数，**太粗**。
> 仓主指出「你遗漏了这里面不只一个需求：时序推演，solver 等等。这里面每个都不能遗漏」——**指得对**。
> 本文把链拆到**原子需求**逐条核，包含我上一轮**答错的一条**与**完全漏掉的一整维**。

**图例**：♻️ 已有可直接用 · 🔗 已有但缺一小块 · 🆕 要新做 · ⛔ 已裁

**52 项**：♻️ **24** · 🔗 **13** · 🆕 **13** · ⛔ **2**

---

## ⚠️ 先认三条：我上一轮的错与漏

| # | 上一轮我说的 | 实测 | 性质 |
|---|---|---|---|
| 1 | 「Option A 加班 / D 延期 **待核**」 | **都有承载**：加班 31 处 · `overtime` 42 · `nightShift` 6 · 延期 20 · `defer` 10 | **答得不准**（保守但错） |
| 2 | 时序推演 —— **一个字没提** | 「停机 **72h**」「Supplier **+7d**」「Logistics **+2d**」是三个**带时长的扰动**，是一整维需求 | **整维漏掉** |
| 3 | 「Solver 产出 4 个 Option」 | `mitigation_select` 实为**方案库枚举**（`extended.ts:39 MITIGATION_LIB` 7 因素 × 3 案），**不是求解器实解** | **性质说错** |

---

## 阶段 0 · 触发（3 项）

| # | 原子需求 | 裁决 | 依据 |
|---|---|---|---|
| 0.1 | 客户维（客户 A） | 🔗 | `Customer`(8 条) 有；但 **`quote_margin` 客户维在数据层是断的**（欠账 #118） |
| 0.2 | 订单量级（200,000 套） | ♻️ | `Order.qty` + `OrderLine`（Σ行===头 勾稽） |
| 0.3 | 订单创建写入 | 🔗 | `Order` 对象有；创建须走 Action 正门（R4），`ActionType` 已有 `plan_change` 族 |

## 阶段 1 · 订单评审五项（7 项）

| # | 原子需求 | 裁决 | 依据 |
|---|---|---|---|
| 1.1 | 产品校验 ✓ | ♻️ | `Model` / `ProductVersion` / `ProductLineCapability` |
| 1.2 | 客户信用 ✓ | ♻️ | **`credit_exposure` 求解器在册** + `Customer.creditLimit` |
| 1.3 | 价格 ✓ | 🔗 | `quote_margin` 在册，**客户维断**（同 0.1） |
| 1.4 | 产能 ⚠ | ♻️ | `capacity_forecast` / `capacity_feasibility` / `bottleneck_matrix` |
| 1.5 | 物料 ⚠ | ♻️ | `kit_readiness` / `mrp_netting` / `lta_gap` |
| 1.6 | 全链评审 | ♻️ | **`order_fullchain` 求解器**（一张单的全链） |
| 1.7 | **五项并行 + 三态结论（✓/⚠/✗）** | 🆕 | 五个求解器可并行调，但**无「评审单」聚合体承载三态结论** |

## 阶段 2 · Scenario 创建 · 五扰动（8 项）　←　**时序维集中在这里**

| # | 原子需求 | 裁决 | 依据 |
|---|---|---|---|
| 2.1 | Order **+20%**（比例型） | 🔗 | `act` **只支持 set 绝对值**，无 `increase/multiply` operator |
| 2.2 | Yield **−3pp**（百分点型） | 🔗 | 同上 |
| 2.3 | **L003 停机 72h（时长型）** | 🆕 | 🔴 **表达不了**。见下方 §时序 |
| 2.4 | **Supplier +7d（时长增量）** | 🆕 | 🔴 同上 |
| 2.5 | **Logistics +2d（时长增量）** | 🆕 | 🔴 同上 |
| 2.6 | **扰动生效时间** | 🆕 | `act` 入参 `{objectId, stateVar, value}` —— **无 effectiveAt** |
| 2.7 | **扰动持续时长 + 到点自动恢复** | 🆕 | **无 duration、无 revert** |
| 2.8 | 五扰动**联合**（非逐个） | 🔗 | `propagateTick` 本身是全量扫，天然联合；但 2.3–2.7 缺失使「联合」跑的是错的形态 |

### 🔴 时序推演 —— 我上一轮整维漏掉的那一维

**底层机制是齐的，缺的只是扰动注入口：**

| 时序能力 | 状态 | 位置 |
|---|---|---|
| 模拟时钟 **一 tick = 一模拟日** | ♻️ | `simclock.ts:21` |
| **延迟传导** `delayTicks`（竞品「延迟 1 个时序」） | ♻️ | `sim.ts:49` |
| **延迟队列** `DelayedContribution.arriveTick`（resume 确定性） | ♻️ | `sim.ts:18-20` |
| **衰减窗** `decay{window, den}` | ♻️ | `sim.ts:51` |
| 逐 tick 态落库 `pending` 快照 | ♻️ | `sim.ts:106` |
| **按 tick 排期回放剧本** `OpsPlaybook` | ♻️ | `simclock.ts:137` `scenarioEvents.filter(e => e.tick === tk)` → `opsPlaybookRunner({tick, date, seed, scenarioEvents})` |
| **扰动注入口的时序** | 🆕 | 🔴 `app.ts:1482` `act` 直接改**当前 tick** 的 state，不排队、不定时、不恢复 |

**判据（三分法）：这是「接了线接错地方」，不是「没接线」。**
底层有完整的排期 / 延迟 / 衰减 / 回放机制，**唯独用户注入扰动的那个口没有时间维**。
⇒ 修法 = **把 `act` 接到既有的 `OpsPlaybook` 排期机制上**（`{effectiveAtTick, durationTicks, revertTo}`），
**不是新造一套定时器**。这一条直接决定「停机 72h 之后会不会恢复」——
今天跑出来的是**永久停机**，那是错的推演，而且不报错。

## 阶段 3 · Ontology Slice（2 项）

| # | 原子需求 | 裁决 | 依据 |
|---|---|---|---|
| 3.1 | 切片实体 + 展开 | ♻️ | `slice_specs` + `executeSlice` + `planSlice` + **4 条种子**（含 `order_fulfillment_360`） |
| 3.2 | 按决策意图语义裁剪 | 🆕 | 全仓 `DecisionIntent` **0 命中** |

## 阶段 4 · Causal Impact（3 项）

| # | 原子需求 | 裁决 | 依据 |
|---|---|---|---|
| 4.1 | 因果图（果→因） | ♻️ | `CausalFactor` + `caused_by` N:N 真物化 + `gap_attribution` BFS |
| 4.2 | 影响计数（对象/流程/决策/KPI 分项） | 🔗 | `/inference/whatif` 只回 `affectedObjects` **一个数字**，无分项 |
| 4.3 | `impact_graph_id` 可传给下一页 | 🆕 | 因果图是**输出字段**，每次现算、**无 id** |

## 阶段 5 · Joint Simulation（6 项）

| # | 原子需求 | 裁决 | 依据 |
|---|---|---|---|
| 5.1 | 世界分叉（不污染真实） | ♻️ | `SimSession` + `SimCheckpoint` + `/branch` + R4 隔离 |
| 5.2 | 逐 tick 推进 | ♻️ | `app.ts:1418` 按 `n` tick |
| 5.3 | 延迟 / 衰减传导 | ♻️ | `propagateTick` 延迟队列 + 衰减 + clamp |
| 5.4 | **传导边覆盖 5 扰动 × 24 节点** | 🆕 | 🔴 **今天只有 3 条 demo 种子**，`cadenceNodeId` 全 null |
| 5.5 | **扰动结束后的恢复曲线** | 🆕 | 依赖 2.7；今天扰动是永久的，画不出恢复段 |
| 5.6 | 局部推演在**指定世界**里跑 | 🆕 | 三个局部推演直读真本体 ⇒ fork 了世界仍在真库上算（**静默错答**） |

## 阶段 6 · Solver 四方案（8 项）

| # | 原子需求 | 裁决 | 依据 |
|---|---|---|---|
| 6.1 | Option A **加班** | ♻️ | 加班 31 处 · `overtime` 42 · `nightShift` 6（`ForecastArgs.whatIf.nightShifts`） |
| 6.2 | Option B **跨基地** | ♻️ | 跨基地 82 处 · `interbase-transfer.ts` 契约 |
| 6.3 | Option C **外协** | ♻️ | 外协 115 处 · `outsourcing_split` 求解器 + C08 外协红线规则 |
| 6.4 | Option D **延期** | ♻️ | 延期 20 处 · `defer` 10 · `finalDueDays`（G-VAR-2 最终交期 per-order） |
| 6.5 | Option 六维打分 | ♻️ | `DecisionOption{closesGap,cost,cycleDays,risk,exposure,reversibility}` + provenance |
| 6.6 | **Option 由求解器实解产生** | 🔗 | ⚠️ **今天是方案库枚举**（`extended.ts:39 MITIGATION_LIB` 7 因素 × 3 案），**不是解出来的**。CP-SAT 实解在 `portfolio`/`job_shop_schedule`，两者**未打通** |
| 6.7 | 可行性 / INFEASIBLE | 🔗 | `capacity_feasibility` + `optimize_whatif.conflictConstraints` 有，缺呈现 |
| 6.8 | 最小松弛（「交期+2d 或 加班+16h 或 跨基地」） | 🔗 | `conflictConstraints` 已有结构，缺「最小松弛量」计算 |

## 阶段 7–8 · Compare 与推荐（5 项）

| # | 原子需求 | 裁决 | 依据 |
|---|---|---|---|
| 7.1 | 多方案对比 | 🔗 | `/sim/compare?a=&b=` **两两**，需扩 N 路 |
| 7.2 | 基线语义标记 | 🆕 | 无 BASELINE/SCENARIO 标记，谁是基线靠调用方记 |
| 7.3 | 权重 / ε / 字典序 + 敏感性 | ♻️ | `GlobalSimMethod` + `methodWeights` **已完整实现** |
| 8.1 | 推荐方案 | ♻️ | `decision_play.recommendedPlan` |
| 8.2 | 推荐理由 + 证据 | 🔗 | `Decision.trace` 四步溯源有；**独立 Evidence 类型无** |

## 阶段 9–10 · 批复与执行（4 项）

| # | 原子需求 | 裁决 | 依据 |
|---|---|---|---|
| 9.1 | 经营批复链 | ⛔ | **仓主已裁**「流程审计这种都不需要体现」 |
| 9.2 | 批复条件动态生成 | ⛔ | 同上 |
| 10.1 | 执行动作生成 | ♻️ | `Decision.commit` → ActionDraft（DRAFT，走 R4 正门） |
| 10.2 | 执行状态机 | 🔗 | `ActionStatus` 8 态齐；但 `G-ACTION-NOOP-EXEC` **还剩 1 条未接线** |

## 阶段 11 · 外部系统反馈（4 项）

| # | 原子需求 | 裁决 | 依据 |
|---|---|---|---|
| 11.1 | **ERP** 反馈 | ♻️ | `mock_erp` 连接器已有（`registry.ts:128`） |
| 11.2 | **MES** 反馈 | 🆕 | 🔴 **零** |
| 11.3 | **WMS** 反馈 | 🆕 | 🔴 **零** |
| 11.4 | **TMS** 反馈 | 🆕 | 🔴 **零** |

（连接器全集实测只有 `mock_erp` / `mock_crm` / `mock_external` 三个。照 `mock_erp` 的模子补三个即可，不是新机制。）

## 阶段 12–13 · Replay 与校准（5 项）

| # | 原子需求 | 裁决 | 依据 |
|---|---|---|---|
| 12.1 | 时间轴回放 | ♻️ | `010_replay_ops.sql` + `calibration/replay.ts` |
| 12.2 | 预测 vs 实际 | ♻️ | `DecisionOutcome{realizedGapClose, predictedGapClose, effectivenessPct}` |
| 12.3 | 「当时知道什么」 | 🔗 | `ruleSetVersion` FNV-1a 指纹已记（R6），缺组装 |
| 13.1 | 误差 / 模型漂移 | ♻️ | M11 校准引擎（EMA / 重放归因 / 分位）`calibration/{methods,metrics,pairing}.ts` |
| 13.2 | 校准回写模型参数 | 🔗 | `Calibration{Proposals,History}` 有；回写须走 Action 正门 |

---

## 汇总：13 项 🆕 里，按承重排序

| 序 | 缺口 | 为什么承重 |
|---|---|---|
| **1** | **扰动时序（2.3–2.7）** | 「停机 72h」跑成**永久停机**，且**不报错**。所有带时长的扰动都是错的推演 |
| **2** | **传导边（5.4）** | 只有 3 条边，联合推演的因果链**看着确凿实则是假的** |
| **3** | 局部推演的数据源开关（5.6） | fork 了世界却仍算真库，两个世界给同一个结果**且看不出错** |
| 4 | `impact_graph_id`（4.3） | 04→05 传不下去，链条在此断开 |
| 5 | Option 由实解产生（6.6，🔗） | 今天是查库；库外的方案永远出不来 |
| 6 | MES/WMS/TMS（11.2–11.4） | 闭环收不回来，Replay 无「实际」可比 |
| 7 | 决策意图裁剪（3.2） | 切片不随意图变，交付风险与利润风险取同一套对象 |
| 8 | 评审单三态聚合（1.7） | 五项结论无处落，`⚠` 表达不出来 |
| 9–13 | 基线语义 / Evidence 类型 / Decision Graph / 恢复曲线 / 影响分项计数 | 均为补一小块 |

**前三条有一个共同形态：不报错、有输出、但是错的。** 这正是本仓最贵的病（静默错答）。
⇒ 派单优先级按此表，**不按链条顺序**。
