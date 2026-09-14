# GOALMAP-SUP-B · 业务闭环持续改进（3.13–3.16）取证

**PIN 实测**：派单写 `canonical = fbfa88f1，你的 worktree 已在此 commit`——**不成立**。
进场实测 `HEAD = 778cc589`（2026-06-15），且 `git merge-base --is-ancestor HEAD fbfa88f1` → **是祖先**，
落后 **4665** 个提交；树龄探针 `wc -l apps/datacore/src/synthetic/battery.ts` = **1249**。
这正是 CLAUDE.md 铁律 3 记过的 LOOP10「同一问题得到 20 与 500 两个都正确的答案」那棵旧树。
已 `git checkout --detach fbfa88f1`，复测树龄 = **7053** 行。**以下全部证据取自 fbfa88f1。**
（未 commit / 未 push，`git status --porcelain` 空。）

**取证环境**：worktree 无 `node_modules` → `pnpm install` (RC=0) + `@platform/contracts` build (RC=0)
+ `@platform/llm-adapters` build (RC=0，不建会报与本单无关的假红)。未起任何服务（4001/4002/5173 一个都没碰）。

---

## 判定表

| 编号 | 能力项 | 判定 | 实测证据（file + 符号 + 亲手跑出来的数） | 金丝雀 |
|---|---|---|---|---|
| **3.13a** | 需求预测偏差 | **部分**（仓主已说先不做，只给一句结论 + 一个反直觉实测） | `synthetic/battery.ts` `SEG_DEMAND_ANCHOR` 三行常量同时带 `tgt` 与 `act`，差**算得出来**：我手算 乘用车 **99.5%** · 储能 **72.2%** · 商用车 **115.8%** · 合计 **340.6/375.0 = 90.8%**（72.2% 与源码注释「储能 72.2%<95 → 越线」对得上，证明我读法没错）。**但两个坑**：① `act` 是**硬编码常量**，不由任何成交/产出记录派生；② 我实测 `tgt ≡ demandWanPerYearP50` **逐项全等**（node 跑 `S.every(x=>x.tgt===x.p50)` → `true`）⇒ 本仓「需求目标」与「需求P50预测」**是同一个数**，于是"预测偏差"与"目标达成差"在数值上不可区分 | 同一脚本对 `Σtgt` 报 **375.0**，命中 `battery.ts` 注释里写死的 375 万套/年锚 ⇒ 解析没跑偏 |
| **3.13b** | 销售达成差异（销售目标 vs 实际成交） | **已有** | `contracts/base-registry.ts` `GOAL_REGISTRY.revenue` = 计划侧 target **700 亿** / floor **686**；`battery.ts` `goalMetric("kpi-revenue", …, orderBookRevYi, …)` 的 actual = **成交侧订单簿**（交期落计划年的 **458** 张已签单，Σ数量×单价 = **415.6 亿**）⇒ 达成 **59.4%** < floor ⇒ `miss=true` 转红。**两条链分开取数**。亲手跑 `vitest run test/revenue-reconcile.seam.test.ts` → **RC=0，6/6 绿**，其中 §4 是一条真**对照实验**：删订单 → 达成率按可预言的量掉、①计划口径逐字节不动 | 同 run 的 §3 断言 `Σvalue ≡ Σ(qty×unitPrice)` 亦绿 ⇒ 订单簿是真算不是写死 |
| **3.13c** | 计划产出偏差（计划产量 vs 实际产量） | **已有**（但"计划"这一半是**产能预测**，不是排产计划——见《我可能错在哪》①） | `simclock.ts` 里 `deviation = Math.abs(snap.predictedDaily − actualDaily) / actualDaily`：predicted 来自 `capacity_forecast` 落的 `calibrationForecasts`（`solvers/service.ts` `recordCalibrationForecasts`），actual 由 `output:line` 真 tsPoints 按基地聚合（**取各车间当日产出的均值而非求和**，源码自述避免在制品按车间重复计入）。写成 A8 序列 `forecast_dev:model`。亲手跑 `vitest run test/m11-calibration.test.ts --testTimeout=60000` → **RC=0，10/10 绿**，含 C1「error/ape 与手算一致」 | 全仓 seriesKey 字面量共 **8** 个（`attainment:base/line`、`forecast_dev:model`、`oee:equip`、`output:line`、`util:line`、`yield:process`、`*`），其中 `forecast_dev` 是**唯一**由两个量算出来的；对照：`attainment` 是 `value-domains.ts` 里 band `[0.8,1.02]` 的**采样量**，不是 实际÷目标 |
| **3.13d** | 盈利目标偏差（利润目标 vs 实际利润） | **部分**（目标半边真；**实际半边缺**——是预测口径派生，不是已实现利润） | 目标：`GOAL_REGISTRY.gross_profit` target **112 亿** / floor **108.5**（注释自述 112=700×16%），单一来源。实际：`goalMetric("kpi-gross-profit", …, totalMargin, …)`，而 `totalMargin = Σ(demandWanPerYearP50 × priceWan × marginPct)` ⇒ 源码 `basis` 自己写明「**需求预测口径**…与同屏「营收」的成交侧口径不同源，两者不可相除」。另一处 `sop.ts step4`：`gmOk = gmRoll >= gmBudget − gmTolerance`，但 `gmRoll` 由 payload 的 qty/price/gmRate 算 ⇒ **目标 vs 滚动计划**，两边都在计划侧 | 搜实现利润的四个名字 `realizedMargin/actualRevenue/actualMargin/actualGm` **全 0 命中**；金丝雀：同一把 grep 对同文件 `gmRate` 报 **4** 命中 ⇒ 工具是好的，是真没有 |
| **3.14** | 根因分析（给"因为 X"还是只给差值） | **已有** | 不是只给差值。`gap_attribution` 输出 `rootMetric{target, actual, gap}` + **分层** `levels[]`：depth1=基地 / depth2=订单·瓶颈 / depth3=因果链(caused_by)（份额与营收类走 depth1=细分、depth2=因果根因）⇒ **追因 2–3 层**。终点是**具体对象**不是一句话：每叶带 `drillType/drillId/drillField/drillValue`，实测落点如 `PriceRealization:pr-ess-1.realizedPrice`、`Supplier:SUP-003.actualSupplyTon`、`BidRecord:bid-ess-1.win`、`CommodityPriceTrend:licarb-w4.pctChange`。我 node 跑因果域清单：**37 个因子 / 其中 24 个 isRoot**，覆盖 7 个 metricKey（capacity 7 · market_share/revenue/cash/demand_attain/gross_profit/chain_flow 各 4 · 共享 8）。每层硬勾稽 `Σ子+residual=父gap ≤1e-4`，residual 诚实承。亲手跑 `vitest run test/gap-attribution.test.ts` → 该文件 **全绿**，含 C3「≥18 叶跨 ≥3 基地」、C4「每叶下钻到源对象真值字段」、C5 三条颗粒铁律（改订单额/改供应商实际供货/改矿价 → 对应叶贡献**跟着变**，不变即判写死） | C5 三条就是本项的金丝雀：它们证明归因**不是**硬编码文案。另 `PriceRealization` 实测只播 **2** 行（`pr-ess-1`/`pr-pas-1`）—— 链路真，但样本极薄 |
| **3.15①** | 回流机制有没有（偏差 → 参数的写路径） | **部分**（**有一条真回流路，且是闭合的**；但只覆盖 **3** 个参数 / **1** 个求解器。另一条"决策成效"回流**算了但没人用**） | **写路径实测全程**：`pairing.ts runPairing`（predicted vs actual 配对）→ `calibration/service.ts generateForSlice` → 三方法（A=EMA / B=重放归因 / C=分位数匹配）→ **回测门槛** `minImprovementPct=1` → `CalibrationProposal(PENDING)` → Action「校准参数变更」→ `applyAction` → `performApply` → `solvers.setParam` → `mutateParams`（**solver_params 写入的唯一通道**）。**谁写**=审批通过的 Action（`autoApply` 默认 **false**，开启也只放行方法A且变幅<5%）；**写到哪**=`solver_params`（或 `ONTOLOGY_PROPERTY` 切片对象等比缩放）；**何时触发**=四个真入口：`simclock` tick、`livedin/engine.ts:581` 回填按月批、C12 规则命中（`app.ts` `ruleScan.setCalibrationHook`）、手动 `runAll("CALIBRATION_RUN")`。亲手跑 m11 测试 **10/10 绿**，其中 **C9** 就是整条回路：tick 良率下滑 → C12 → 方法A提案(含回测证据) → 批准 → 继续 tick → **MAPE 收敛且报告可见全链**（13.6s）；C6 断言「批准 → 参数版本+1 且**后续求解真用新值**」。**范围**：node 数 `calibration.params` = **3** 条（`Process.yield`/`ramp.base`/`health.normal`），且 `SOLVER_KEY = "capacity_forecast"` 写死 ⇒ 销售/利润/需求三类偏差**无任何回流路** | 金丝雀（区分"没接线"）：`CalibrationService` 的 **src** 调用方在 `app.ts` 有 3 处（import/类型/`new`）+ 5 条 HTTP 路由；**test 引用 0** ⇒ 不是"只有 test 引用"的假绿 |
| **3.15②** | 若有，确定性（R6）怎么保 | **已有** | 两件事**共存在不同的面上**，不是靠妥协：① **参数版本化**——`mutateParams` = 克隆→变更→`version+1`→**双份历史快照**(`solverParamsHistory`)；`paramsAt(version)` 可取任一旧版重放；求解入口支持 `opts.paramsVersion`。② **样本带版本**——`CalibrationPairRecord.paramsVersion` + `staleParams`（`f.paramsVersion !== currentVersion`），旧参样本**不进新提案回测基线**。③ **可精确回滚**——提案存 `appliedFrom` / `appliedParamsVersion`，本体域还存 `appliedSnapshot` 逐对象旧值。④ **R6 那条不受影响**——`synthetic/service.ts seedBatteryParamsAndSpecs` 在每次播种时把 `solver_params` **写回静态常量 `BATTERY_SOLVER_PARAMS`** ⇒ 校准漂移**活不过一次重播**；且 R6 金值面不含 solver_params。合起来正是 CLAUDE.md 那句契约：「合成数据同(industry,scale,seed)字节一致；求解器同输入**同参数版本**同输出」——确定性的键里**本来就有参数版本**。⚠ 一个真缺口：`version` 是 `(existing?.version ?? 0)+1` **单调递增**，重播不归零 ⇒ 参数**内容**可复现，版本**号**在脏租户上不可复现 | 金丝雀：C6「回滚恢复上一版本；`runWithParams` 复现旧版本」绿 ⇒ 版本重放不是纸面设计 |
| **3.16** | 数据与决策资产沉淀（三个月前那次决策翻不翻得出） | **部分**（按低标准量：**落库齐备、但检索入口只有按 id**；且"结果"这一项产品内无回填路径） | **落库 ✅ 四项齐备**：`contracts/decision-kernel.ts DecisionSchema` = `decidedBy`(谁·`kernel.ts` 取 `ctx.userId`) / `createdAt`+`updatedAt`(何时) / `rootRef`(真 gap_attribution)+`optionsRef`(真 decision_play)+`trace[]`(R13 每步挂 refId)（依据） / `outcome`(结果) / `actionDraftIds` / `status`。且 `create` 会**拒幽灵方案**（选定 ⊄ 真推演 → 400），`commit` 只经 ActionService 落 DRAFT 走 S2（R4 正门·绝不直写业务真值）。**查得出来吗 ⚠ 只有按 id**：路由实测仅 `POST /a/v1/decisions`、`GET /a/v1/decisions/:id`、`/:id/commit`、`/:id/outcome`、`GET /a/v1/decision-outcome-stats`，**无 list/按时间/按人/按指标检索**；kernel 公开方法共 **5** 个（create/get/commit/recordOutcome/outcomeStats），无 list。**也绕不过去**：`repo.ts:250` `decisions: Store<Decision>` 是独立 store，Decision **不是本体对象类型** ⇒ `/a/v1/objects?type=Decision` 取不到。**反查也断**：`kernel.commit` 建 draft 时传 `origin: {}`，而 `origin` 形状是 `{taskId,agentId,userId}`（`actions.ts:687` 补 `userId`）——**没有 decisionId 字段**⇒ 从可列的 `GET /a/v1/action-drafts` **回不到**那条决策。**"结果"半边**：前端**零调用** `/outcome`（`recordOutcome` 只在 `app.ts` 一处可达），且源码自述其入参 `realizedGapClose` 是「**外部实测·运营回填·KILL-MOCK：系统绝不自造**」⇒ 产品内 `outcome` 恒 null、`status` 到不了 REALIZED | 三个否定结论各带金丝雀：① 路由 grep 对 `app.(get\|post\|...)` 报 **373** 条 ⇒ 正则看得见路由；② 同一把 grep 在 `DecisionPlayPanel.tsx` 对 `commit` 报 **15** 命中、对 `/outcome` 报 0 ⇒ 是真没调；③ `"DecisionGap"` 在 synthetic 两文件报 **1+3** 命中而 `"Decision"` 报 **0** ⇒ 台账确实不是本体类型 |

### 3.16 附加一句（高标准·单独记，不影响上面判定）
**能否复用成模板：不能，但结构已预留。** `Decision.id` 由 `(tenantId, metricKey, factorId, chosenOptionIds)` 哈希派生（`derivedId`）⇒ 同情形同 id（天然去重/可复现），但**没有**模板抽象、没有"套用上次决策"的入口。
`decision/outcome-stats.ts aggregateOutcomeStats` 按 `(metricKey, factorId, optionId)` 归集 REALIZED 决策的实测 `effectivenessPct` → `weight`，**设计意图就是回去给 `decision_play` 排序当乘子**——但源码自己写着「后续 decision_play 排序读此 weight（**超范围·列后续单**）」，我实测 `decision_play` 实现里**零处**读 `outcomeStats/avgEffectivenessPct`（那些 `.weight` 命中全是 `binding.weights[...]`，来自 `RuleEntry.params` 的归因系数，另一回事）。
⇒ **这是本单第二条"回流"，它算得出来、落得了库、有 REST 出口，但没有任何消费方**，加上上面"outcome 产品内无回填路径"，它今天**双重空转**。

---

## 另外两处"屏上有数、但那个数不度量它自己声称的东西"（顺手撞到，属 3.13 证据链）

1. **`livedin/engine.ts` 的达成率是剧本，不是算出来的**：`attainment = round(88 + (m*6)/11, 1)`（12 个月 88%→94% 线性爬升），然后 `demand = actual / (attainment/100)` —— **目标是从"实际"和"预设达成率"倒推出来的**。同一行里 `lastActual` 是真值（`actual × share`），而 `dv: 0` **硬编码**、`rolling` 与 `target` **赋同值**。且 `dv` 确实上屏（`SopBalanceView.tsx` 逐行 `(r.dv*100).toFixed(1)%` + 合计行）⇒ 历史 S&OP 台账那 12 个月，偏差列恒显 **+0.0%**，而它旁边的"上期实际"是个不等于目标的真数。
2. **`sop.ts step2` 的 `dv` 不是达成差**：`dv = (rolling − target)/target` —— 用的是**滚动预测**，不是 `lastActual`；且缺省派生分支把 `lastActual` 写死 **0**、`rolling` 赋 `target`。`lastActual` 全仓 src 只有两个写入点（这条写 0、livedin 那条写真值），**没有任何公式消费它**。
3. **校准报告在没数据时会给一条"正在变好"的合成曲线**：`legacySeries` 无配对 → `baselineSeries`，`mape = 11.2 − i*0.32 + 噪声`（单调收敛），而 `CalibrationReport` **没有任何 provenance/synthetic 标志位**（金丝雀：同文件 `thresholdPct` 报 4 命中、全仓 `provenance` 在 `solvers/service.ts` 报 56 命中 ⇒ 词存在、工具好使，是这个响应里真没有）⇒ 屏上"模型越来越准"可能是脚本，调用方分辨不了。

---

## 需起服务复核

1. **一个真播种的 demo 租户里 `calibrationPairs` 到底是不是 0。** 静态链路是清楚的：`calibrationForecasts` 只在 `capacity_forecast` 跑过才落，播种时 `synthetic/service.ts` 反而会把 `forecastSnapshots` 与 `calibrationPairs` **清空**；`livedin` 回填会按月调 `calibrationTicker`。所以「屏上那条 MAPE 曲线是真配对算的，还是 `baselineSeries` 那条脚本曲线」**只能真跑 `SEED_DEMO=1` 看 `GET /a/v1/calibration/report` 才能定**。这直接决定 3.13c / 3.15 的成色。
2. **用户实际落到的 S&OP 是哪条路**：`livedin` 的 `dv≡0` 历史版本，还是 `sop.ts step2` 的 `rolling−target`。两条都不是"实际 vs 目标"，但屏上表现不同。
3. **demo 租户里有没有任何一条 Decision**。若为 0，则 3.16「只能按 id 查」在今天还构不成用户可感的痛，但也说明台账**从没被真正使用过**——两种结论对排期的含义相反。

---

## 我可能错在哪（≤3）

1. **3.13c 我判"已有"，但"计划"那一半是产能预测不是排产计划。** `forecast_dev` 的 predicted 来自 `capacity_forecast`（能产多少），若客户说的"计划产出"指**已下发的排产计划/工单量**，那我找到的就不是它——本仓另有 `Line.schedule_attainment`，而那是 `value-domains` 里 band `[0.62,0.95]`/`[0.8,1.02]` 的**采样值**，不是两个量相除。按那个口径，3.13c 应降为**部分**。我没有把排产计划这条线追到底。
2. **3.16「无检索入口」我是从路由表 + kernel 方法表 + store 类型三处交叉得出的，但我没跑起服务去打一次。** 若存在我没想到的间接出口（某个 workflow/solver 把 decisions 投影出来、或 agentcore `/b/v1` 侧有代理路由），结论会松动。我只核到 datacore 侧。
3. **3.13d 我判"实际半边缺"，依据是 `kpi-gross-profit` 的 actual 走需求 P50 口径。** 但本仓还有一个 **250.60 亿毛利**（方案寻优口径，CLAUDE.md 自己列在四个营收数那张表里），我没有去追它是否构成另一条"已实现利润"的来源——若它是按真实获排订单行算的，3.13d 可能比我判的要好一档。
