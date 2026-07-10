# QUERY30-P3 · 求解器横铺 B（新域·中成本）FDE 真跑证据

> WO：Q30-P3（QUERY30-ORCH epic·DESIGN-query30-orch-split.md §1 P3 行）。
> 交付 5 个 path-A 求解器：3 新域（真读 SEED 对象派生）+ 2 复用类（真调子求解器·非借名魔数）。
> 基线 `SOLVER_REGISTRY` 53 → **58**；`ALL_SOLVER_CATALOG` 53 → **58**（键集相等·门 `ontology-core`/`catalog` 守）。
> 真跑环境：datacore(PORT=4001·SEED_DEMO=1·CREDENTIAL_KEY·SERVICE_TOKEN=svc·OPTIMIZER_BASE_URL=http://127.0.0.1:4003)
> + agentcore(PORT=4102·DATACORE_BASE_URL=http://127.0.0.1:4001) + CP-SAT sidecar(services/optimizer·PORT=4003)。
> QOS 真跑：`POST /api/v1/queries`（packageId=pkg_battery_manufacturing·header `X-Debug-User: demo:planner:planner`）→ 轮询 task → **path=WORKFLOW·status=COMPLETED** → answer KPI 逐值对照后端直 invoke（`POST /a/v1/solvers/{key}/invoke`）真值。

## 诚实位说明（重要）

demo 种子世界 `viaModelingChain` 全合成 → 顶层 `dataMode` 被正交的「真实↔合成」维盖为 `SYNTHETIC`（诚实·非 bug）。
求解器**自报的实测/估算维**在 `confidence.measurement`：读真对象+算术=`LIVE`；含估算参数=`PARTIAL`。下文以 measurement 为准。

---

## 1. cash_projection（现金流投影·新域·measurement=LIVE）

- 真读：`FinanceAccount.cashOnHand`（期初现金·亿→万元）+ `Order`(qty×unitPrice=营收·marginPct→销售成本·due 交期) + `Customer.termDays`（回款账期 T+termDays）。逐周回款/付款净现金累积成现金曲线 + 13 周安全垫（最低点·C18 口径）。
- **真 NL 问句**（S31·view=dash）：「未来 13 周现金流怎么走？现金安全垫最低到多少、哪一周最紧张？」
- **QOS 真跑**：path=WORKFLOW · status=COMPLETED · intent=cash_projection_q。
- **逐值对照**（QOS answer KPI == 后端直 invoke 真值）：
  | 字段 | QOS KPI | 后端直 invoke |
  |---|---|---|
  | 期初现金 | 5820000 万元 | openingCashWan=5820000 |
  | 现金安全垫(最低点) | 5280944.6 万元 | minCashWan=5280944.6 |
  | 安全垫最低周 | 第 6 周 | minCashWeek=6 |
  | 累计回款/付款 | 272820 / 539055.4 万元 | totalInflowWan=272820 / totalOutflowWan=539055.4 |
  | 订单数/基地数 | 24 单 / 12 个 | orderCount=24 / baseCount=12 |
- R6：同 seed 重跑字节一致（单测 `q30-p3-newdomain-reuse-solvers.test.ts`）。诚实空态：无对象租户→期初 0/0 单/PARTIAL。

## 2. labor_balance（人力平衡·新域·measurement=PARTIAL）

- 真读：`LaborShift`(headcount 白/夜班·borrowable·skillModels) + `Order.allocatedLineIds`（派线需求）。逐线需求人·班 vs 可用人·班缺口。`laborPerWan` 取 `params.risk.deliveryLaborPerWan`（估算参数·标 PARTIAL·不冒充实测）。
- **真 NL 问句**（S32·view=risk）：「各产线人力配得过来吗？哪些线欠配、缺多少人·班？」
- **QOS 真跑**：path=WORKFLOW · status=COMPLETED · intent=labor_balance_q。
- **逐值对照**：
  | 字段 | QOS KPI | 后端直 invoke |
  |---|---|---|
  | 编制合计 | 718 人 | totalHeadcount=718 |
  | 需求人力 | 2764.8 人·班 | totalRequiredManShifts=2764.8 |
  | 净缺口 | 2046.8 | totalGap=2046.8 |
  | 欠配产线数 | 10 线 | deficitLineCount=10 |
  | 人力需求系数 | 1.6 人·班/万套 | laborPerWan=1.6 |
- 诚实位：measurement=PARTIAL（laborPerWan 估算参数·非实测·编制/派单为真读对象）。R6 字节一致。诚实空态：无对象→空 lines/PARTIAL。

## 3. energy_cost_schedule（能耗成本排程·新域·SEED 无 TOU 电价→诚实空缺）

- 真读：`EnergyMeter`(energyPerUnit 单耗·gridFactor 电网碳因子) + `Order.bases`（逐基地需求）。能耗(kWh)/碳排(kg)逐周排程。
- **⚠ 诚实红线**：SEED **无分时电价(TOU)数据**（gridFactor 是碳排因子非电价）——电价须调用方经 `args.tariff` 提供；缺失即 `totalEnergyCostWan=null` + note 指明（绝不虚构峰谷价）。S33 卡 slotPresets 由规划者显式供 tariff（非冒充种子真值·求解器 note 标注来源）。
- **真 NL 问句**（S33·view=dash）：「各基地能耗和碳排怎么排？按分时电价这一周期的电费成本多少？」
- **QOS 真跑**：path=WORKFLOW · status=COMPLETED · intent=energy_cost_schedule_q。
- **逐值对照**（tariff=峰1.2/平0.7/谷0.35·占比0.3/0.4/0.3→加权 0.745 元/kWh）：
  | 字段 | QOS KPI | 后端直 invoke |
  |---|---|---|
  | 总能耗 | 34812600 kWh | totalEnergyKwh=34812600 |
  | 总碳排 | 22138989.6 kg | totalCarbonKg=22138989.6 |
  | 有分时电价 | 是 | tariffAvailable=true |
  | 总能耗成本 | 2593.53 万元 | totalEnergyCostWan=2593.53（=34812600×0.745/10000·真算术）|
- 诚实空态单测：无 tariff → tariffAvailable=false·totalEnergyCostWan=null·note「SEED 未含分时电价」·measurement=PARTIAL（能耗/碳排仍为真值·成本诚实空缺）。R6 字节一致。

## 4. reroute_decision（改道决策·复用 min_cost_flow·真调 CP-SAT）

- 真读：`Line`(capacityDaily/actual_output_daily) + `Certification`(量产型号↔产线) + `ChangeoverMatrix`(换型分钟)。断供/停线产线产量改道到能产同型号且有余量的候选产线，建带容量/成本网络 → **真调 `this.minCostFlow`**（CP-SAT sidecar）求最小成本流分配。arc 成本 = **真 ChangeoverMatrix 换型分钟**（断线型号↔候选可产型号最小换型·非魔数系数）。
- **真 NL 问句**（S34·view=risk）：「常州这条产线停了，产量改道到哪几条线总成本最低？」
- **QOS 真跑**：path=WORKFLOW · status=COMPLETED · intent=reroute_decision_q。
- **逐值对照 + 真调证据**：
  | 字段 | QOS KPI | 后端直 invoke |
  |---|---|---|
  | 停线产线 | LINE-changzhou | disruptedLineId=LINE-changzhou |
  | 待改道/已改道产量 | 61698 / 61698 | reroutedVolume=61698 / shippedVolume=61698 |
  | 目标函数值 | 0 | objective=0（子解 min_cost_flow 真值）|
  | 求解状态/最优 | OPTIMAL / 是 | status=OPTIMAL / optimal=true / subSolver=min_cost_flow |
- **真调证据**（结果取子求解器真值·随子解变而变）：`flows` 为 min_cost_flow 真解且**容量受限**——SRC→chengdu 30447(满余量)、handan 26188(满余量)、hefei 5063(部分·余量 33191)= 61698 合计。11 候选线 spare/cost 逐条真读（cost=0 因候选线已量产 4680-NCM·同型号无换型成本→改道免费·真实答案非编造）。
- 单测证真调：`MockOpt(objective=777/888)` → 输出 objective 跟变 777/888（证非常数魔数）；`mock.lastFlow` 捕获 SRC/SINK 节点自真对象组装。诚实降级：无 optimizer→status=NO_OPTIMIZER·空流·不 throw。

## 5. multi_constraint_schedule（多约束联合排产·复用排产族三子解·真调各子解）

- **真调**三子求解器联合解（非各自为战·非借名魔数）：① `sequencing_optimize` 的 **CP-SAT 排序引擎**（`solveSequencing`·同 model="sequencing"/同协议·换型组最短切换序·可证最优·bounded 到换型子解选出的**真订单联合排产窗口**≤maxJobs=8——因求解器读全订单簿(24)时 exact-TSP(AddCircuit)组合爆炸不可解[实测 >90s]，联合排产本按线/周窗口作业故对真窗口求最优)；② `changeover_sequence`（extended·自 c.orders+c.changeoverMatrix 派生·逐单换型分钟）；③ `cert_schedule`（extended·C26 并行约束认证排周·未量产型号阻塞窗）。
- **真 NL 问句**（S35·view=project）：「这批订单怎么排，既排序最优、又少换型、又不违认证就绪？」
- **QOS 真跑**：path=WORKFLOW · status=COMPLETED · intent=multi_constraint_schedule_q。
- **逐值对照 + 真调证据**（三子解真值嵌入·随子解变而变）：
  | 子解 | QOS KPI | 后端直 invoke |
  |---|---|---|
  | ① sequencing_optimize | 目标函数值 1 | sequencing={objective:1, changeovers:1, optimal:true, status:OPTIMAL, jobCount:6}|
  | ② changeover_sequence | 换型总耗时 46 分钟 | changeover={lineId:L1, totalChangeoverMin:46, savedVsDueMin:0}|
  | ③ cert_schedule | Scheduled 6 · 工程师组 3 | cert={scheduledCount:6, engineerGroups:3}|
  | 联合序/阻塞 | — | jointSequence 6 单 · blockedByCert=[] |
  | subSolvers | — | ["sequencing_optimize","changeover_sequence","cert_schedule"]|
- 单测证真调：`sequencing.objective`==CP-SAT 引擎真值(mock 4242)；`changeover.totalChangeoverMin`==直调 changeover_sequence 真值；`cert.scheduledCount`==直调 cert_schedule.schedule.length；jointSequence 逐单 changeoverMin 取自 changeover_sequence 子解。诚实降级：无 optimizer→sequencing.status=NO_OPTIMIZER·以换型序为基序·measurement=PARTIAL。

---

## 齿/门全绿

- `pnpm --filter datacore build`、`--filter contracts build`、`--filter agentcore build` 全绿。
- 单测：`apps/datacore/test/q30-p3-newdomain-reuse-solvers.test.ts`（20 用例·5 求解器各 I/O 契约+R6+诚实空态+复用类证真调）绿；`render-bindings-real-fields.test.ts`（5 新绑定真世界真 invoke 逐字段在场）绿；`solver-registry.test.ts`（冻结基线 +5）绿；`catalog`/`ontology-core`（Set(SOLVER_KEYS)==Set(ALL_SOLVER_CATALOG)·**58=58**）绿。
- 门：`solver-coverage:check`（58 引用全 ∈ registry·零幽灵）· `solver-label-coverage:check`（58 求解器·414 字段人话齐）· `ontogenesis:check` · `scenario-ontogenesis-runtime:check`（35 卡全 GOVERNED）· `no-fake-done:check` · `ontology-slices:check`（母体回写后切片重生成一致）全绿。
- 本体回写：`docs/SYSTEM-ONTOLOGY.md` §2.E「横铺 8 求解器已交付（Q30-P2/P3）」+ `node scripts/build-ontology-slices.mjs`。
