# 设计走查 2 · 再 10 题全栈决策问题 + 完整推导链条

> 用户：再列 10 题，要看**推导链条**。每题从问句一步步推到答案，链节钉到**真实求解器/对象类型/规则码/路由**，标 ✅本会话真跑验证 / 📐已设计待建 / ❌缺。**这是设计推导（非真起服务实拍）**——让你逐步审我的推导是否成立、断在哪。
> 标准链：`问句 → 路由(意图/场景) → 取数(对象/源) → 求解(solver) → 规则裁决(C-code) → 诚实位(dataMode) → 接地答案 → 断点`。

## §1 十题（与上一批不重复·均"单看板答不了")

| # | 问题 | 核心能力 |
|---|---|---|
| Q11 | 现在常州哪道工序是瓶颈？不管它，未来两周会连锁拖累哪些订单交期？ | 实时瓶颈 + 传导 + 波及 |
| Q12 | 洛阳齐套缺口 654 吨，加急采购/调拨/外协三种补法，哪种组合成本最低且赶上 D+13 越线日？ | 缺口 + 补救组合最优化 |
| Q13 | 蔚云汽车这客户，综合交付风险+信用+毛利，是不是该重点保？掉了损失多少营收？ | 客户级敞口聚合 |
| Q14 | 要不要给宜宾扩一条线？按需求预测多久回本？不扩缺口多大？ | 投资决策 + 预测 + ROI |
| Q15 | 对储能客户降价 3% 抢份额，毛利率会破底线吗？份额能涨多少？ | 价格-毛利-份额联动 |
| Q16 | 常州过载、青岛闲置，把哪些订单从常州挪到青岛最划算？挪后两边紧张度怎么变？ | 多基地再平衡 + 重算 |
| Q17 | 客户要碳足迹达标，哪些订单必须用低碳电网基地产？会挤掉别的订单产能吗？ | 碳约束排产冲突 |
| Q18 | 系统弹了 5 个红色预警，哪几个真要命、哪几个是 mock 启发的？先处理哪个？ | 预警真假甄别 + 诚实位 |
| Q19 | 把毛利底线从 14% 提到 16%，现有哪些订单从"可接"变"要提价"？影响多少营收？ | 规则变更影响分析 |
| Q20 | 上次没听建议强行接了低价单，回头看若听了会怎样？差多少？ | 决策反事实复盘 |

---

## §2 逐题推导链条

### Q11 · 实时瓶颈 + 连锁拖累
```
问句"常州哪道工序瓶颈+连锁拖累哪些订单"
 └─路由: 场景 agent(risk/order 入口) 或 Path B agent ✅(SCENE-B 真Kimi 验过)
   └─取数: Line/Equipment/Process(常州 baseId·util/oee) ✅ + Order(交期) ✅
     └─求解①: bottleneck_matrix(c, {baseId:常州, dataMode:LIVE})
              → liveTightness 按 真 OEE/利用率/良率 逐因子 → primary 主瓶颈 ✅(本会话验)
     └─求解②: risk_timeline(常州·主瓶颈因子, h=14)
              → demandCapacityTightness(真需求-产能·非哈希) 逐日曲线 + crossDay 越线日 ✅(FORECAST-SIM 验)
     └─求解③: affected_orders(baseId:常州, fromDay..toDay=越线窗)
              → 产能传导引擎算受影响订单 ✅(本会话验·物料齐套卡带 demandGap 真源)
   └─规则: C02/C03(交期) C06/C16(齐套) 裁决 ✅
   └─诚实位: dataMode=LIVE(真 OEE/util) 或 PARTIAL(部分回落) ✅
 答: "常州主瓶颈=化成(util 92%)；D+8 越线→拖累 SO-10003/10007… 共 N 张·明细可溯"
断点: ✅全链在·真跑验证过。微缺: "连锁"的多跳传导(瓶颈→订单→下游客户)需沙盘情景化 📐WO-E2
```

### Q12 · 缺口补救组合最优化
```
问句"654吨缺口·加急/调拨/外协 哪种组合成本低且赶上 D+13"
 └─路由: 场景 agent / Path A(若配 intent)
   └─取数: MaterialBalance(gapTon=654·etaDate) ✅ + 基地产能 ✅ + 补救手段库
     └─求解①: kit_readiness → 真缺口 + 最早齐套日 ✅(本会话验·LIVE)
     └─求解②: countermeasure_combo(缺口, 手段集) → 组合方案 ✅(本会话验·PARTIAL·魔数成本兜底)
        或 opt 族 set_cover/min_cost_flow(CP-SAT sidecar) → 可证最优组合 ✅(求解器在)
   └─规则: C16(安全库存) + 越线日约束 D+13
   └─诚实位: PARTIAL(手段成本是魔数兜底·非真采购报价) ⚠️
 答: "加急 200吨+调拨 150吨 成本最低·D+11 齐套<D+13 ✓"
断点: ◐ 组合求解在·但成本是魔数兜底(PARTIAL 诚实标)。真缺: 补救手段的真成本/真 lead-time 接真源(SRM/采购系统)
      → 属上游真接入(同 N1 多源)；CP-SAT 最优需 OPTIMIZER_BASE_URL sidecar 配置(未配则报"未接入"不兜底 ✅诚实)
```

### Q13 · 客户级综合敞口
```
问句"蔚云汽车 交付风险+信用+毛利 该不该重点保·掉了损失多少"
 └─路由: Path B agent(跨对象聚合·非单 intent) ✅
   └─取数: Order(cust=蔚云汽车 过滤) ✅ + 该客户 creditUsedRatio ✅ + DemandSegment 单价 ✅
     └─求解①: 逐订单 order_fullchain(交期/齐套/财务三闸) ✅(本会话读源验)
     └─求解②: credit_exposure(客户维度) → 信用敞口 ✅(本会话验·PARTIAL)
     └─聚合: Σ该客户营收(qty×真细分单价) = 损失上界 ✅(affected_orders 营收口径验过)
   └─规则: C13(信用) C15(毛利底线) C18(现金)
   └─诚实位: PARTIAL(credit 魔数兜底) ✅
 答: "蔚云=高敞口客户(信用占 0.8·占营收 22%)·掉了损失≈X 万·建议保"
断点: ◐ 链在·但"客户维度聚合"无专用求解器(靠 agent 编排逐单+求和)
      → agent 真 Kimi 能编排(SCENE-B 验过 agent 会调求解器+聚合)·但确定性"客户 360 敞口"求解器是增量(可立 WO)
```

### Q14 · 产能投资 ROI 决策
```
问句"宜宾扩线吗·多久回本·不扩缺口多大"
 └─路由: Path A(capacity_feasibility intent) 或场景 agent
   └─取数: DemandSegment(p50/p90 预测) ✅ + 宜宾 capacity_forecast 产能 ✅
     └─求解①: capacity_forecast(宜宾, demandDelta, weeks) → P50/P90 产能 + 缺口比例 ✅(本会话验 V1)
     └─求解②: capex_scenario(扩线投资, 产出增益) → ROI/回本周期 ✅(求解器在·缺数抛错不兜底)
   └─规则: C03(产能可达)
   └─诚实位: capex_scenario 缺数→抛错(诚实·不编) ✅;capacity LIVE/MOCK 按 liveTightness ✅
 答: "不扩: D+90 缺口 12%;扩一线: capex X·按预测 14 个月回本"
断点: ✅ 链全在·capacity_forecast+capex_scenario 都验过。微缺: "回本"依赖真投资额/真单位收益接真财务源(demo 合成·诚实标)
```

### Q15 · 价格-毛利-份额联动
```
问句"储能降价3%·毛利破底线吗·份额涨多少"
 └─路由: 场景 agent(plan-generate 入口) ✅
   └─取数: DemandSegment(储能·marginPct/floorPct/share) ✅ + FinancePlan ✅
     └─求解①: plan_generate(降价情景) → shareDelta 同源派生(✅本会话验 WO-SHARE17·删-17魔数)
     └─求解②: finance_pnl(降价后) → 毛利率 budgetPct→rollPct ✅(本会话读源验·读真 FinancePlan)
   └─规则: C15(毛利底线·marginPct≥floorPct) 裁决 ✅
   └─诚实位: finance_pnl LIVE(真对象·F-DM-KS-1 白名单验过) ✅;plan_generate LIVE ✅
 答: "降价3%→毛利率 15.86%→15.1%(>底线14% ✓ 但缓冲薄)·份额 +shareDelta pp"
断点: ✅ 链全在·shareDelta 同源+finance_pnl 真对象都验过。这题是系统强项(plan 域闭环)
```

### Q16 · 多基地负载再平衡
```
问句"常州过载青岛闲置·挪哪些订单最划算·挪后紧张度怎么变"
 └─路由: Path B agent / 场景 agent
   └─取数: Order(可产基地含常州&青岛) ✅ + 两基地产能 share ✅ + util ✅
     └─求解①: assignment_optimize(订单→基地·CP-SAT) → 最优再分配 ✅(求解器在·LIVE 白名单)
     └─求解②: risk_timeline(常州/青岛·再分配后) 重算紧张度 ✅(demandCapacityTightness 随负载变·FORECAST-SIM 验"改需求→曲线变")
   └─规则: C02/C03(产能) + 可产网络约束(model.bases)
   └─诚实位: LIVE(真产能 share) ✅
 答: "挪 SO-X/Y(青岛可产)→常州 util 92%→85%·青岛 62%→71%·两边都进安全区"
断点: ◐ assignment_optimize + risk_timeline 重算都在。缺: "挪后重算"的**沙盘对比基线**进决策日常 📐WO-E2(否则要手动两次 invoke 比)
```

### Q17 · 碳约束排产冲突
```
问句"碳足迹达标·哪些订单必须低碳电网基地产·会挤掉别的吗"
 └─路由: Path B agent
   └─取数: Order ✅ + CarbonFactor(基地电网碳因子·material_carbon 链) ✅ + 产能 ✅
     └─求解①: carbon_footprint(订单·基地碳因子) → 逐订单碳足迹 ✅(本会话验·LIVE 白名单)
     └─求解②: 低碳基地产能约束 vs 需低碳订单需求 → 冲突检测
   └─规则: 碳达标阈值(客户要求·config 驱动)
   └─诚实位: carbon_footprint LIVE(真 CarbonFactor 对象) ✅
 答: "3 张储能订单须盐城/宜春(低碳)产·但两基地产能仅够 2 张→挤掉 SO-Z·需外协或放宽"
断点: ◐ carbon_footprint 在·但"碳约束下的排产冲突"=多约束求解(碳+产能+交期)·
      现 carbon_footprint 单算碳·**碳作为硬约束喂排产求解器**是增量(opt 族可扩·或新 WO)。这是 N1 多约束的另一面
```

### Q18 · 预警真假甄别(诚实位的杀手锏)
```
问句"5 个红预警·哪真要命·哪是 mock 启发·先处理哪个"
 └─路由: 场景 agent(risk 入口) ✅
   └─取数: risk_timeline 各卡 ✅
     └─求解: risk_timeline 逐卡 → dataMode(LIVE/PARTIAL/MOCK) + currentTightness ✅(本会话验·诚实位地基 WO-DM)
     └─排序: severity = util压力 + 是否主瓶颈 + 是否结构危机 (caseSeverityFromData ✅读源验)
   └─诚实位: **逐卡 dataMode**——LIVE=真OEE/需求派生·MOCK=哈希启发(诚实标"无实测") ✅
 答: "红警5个: 2个 LIVE(常州化成/洛阳齐套·真要命·先处理) · 3个 MOCK(物流/换型·mock 基线·非真订单产生·后看)"
断点: ✅ **这是系统最强项**——dataMode 诚实位让"真红 vs mock 红"可区分(WO-DM 全族+F-DM-KS-1 本会话四证验)。
      Maven"置信度"环这题完整能答·且前端徽章(DataModeBadge)消费验过
```

### Q19 · 规则变更影响分析
```
问句"毛利底线 14%→16%·哪些订单从可接变要提价·影响多少营收"
 └─路由: Path B agent(批量重算)
   └─取数: 全 Order ✅ + DemandSegment(marginPct/floorPct) ✅ + 规则 C15(可编辑引用?)
     └─求解: 逐订单 order_fullchain(新 floorPct=16%) → 财务三闸重判 ✅(读源验·marginOk=marginPct≥floorPct)
     └─对比: 旧 floor vs 新 floor 下 verdict 变化集 + Σ受影响营收
   └─规则: C15 版本化(规则即一等可编辑引用?)
   └─诚实位: PARTIAL(order_fullchain 含 700/周魔数·F-DM-KS-1 已降 PARTIAL) ✅
 答: "提到16%→12 张从可接变要提价·影响营收 X 万·其中储能占多数"
断点: ◐ 批量重算链在(order_fullchain 可传 floorPct)。缺: **规则一等可编辑引用 + 版本化 what-if**
      → 断点 G-10(规则被引用但非一等可编辑·关联规则半空)·这是已登记断点·改规则即重算属 WO(规则库增量)
```

### Q20 · 决策反事实复盘
```
问句"上次没听建议接了低价单·若听了会怎样·差多少"
 └─路由: Path B agent
   └─取数: 历史决策(该订单决策 trace) + 当时基线快照 + 实际结果(writeback 回采)
     └─求解①: counterfactual_timeline(do-nothing baseline vs mitigated) → 双轨对比 ✅(求解器在)
     └─求解②: 实际 vs 当时推演 对账(writeback-echoes reconcile) 📐(回采 primitive 在·对账可见待 WO-E1)
   └─诚实位: PARTIAL(反事实是确定性派生·非真历史平行宇宙) ✅
 答: "若听建议提价3%接: 毛利+X·实际低价接: 毛利-Y·差 Z 万·且当时推演 crossDay 与实际吻合度 W%"
断点: ◐ counterfactual_timeline 在·但**"调当时决策的 trace + 回采实际对账"**=
      决策历史可追(审计 trace) 📐WO-AUDIT-OBS + 回采对账 📐WO-E1。这题是 D+E+审计三件的合体测
```

## §3 推导链条暴露的覆盖图

| 链节 | 状态 | 证据 |
|---|---|---|
| 路由(意图/场景 agent) | ✅ | SCENE-B 真 Kimi 验·agent 会调求解器+聚合 |
| 取数(对象/source) | ✅单源 / ❌真多源 | listByType 单对象库验过·真多源冲突=N1 缺口 |
| 求解(46 求解器) | ✅ | bottleneck/risk_timeline/order_fullchain/capacity/capex/plan_generate/finance_pnl/carbon/assignment/counterfactual 等本会话验 |
| 规则裁决(C-code) | ◐ | 裁决在·**规则一等可编辑引用** G-10 待(Q19) |
| 诚实位(dataMode) | ✅ | WO-DM 全族+F-DM-KS-1 四证验(Q18 杀手锏) |
| 接地答案 | ✅ | SCENE-B 真 Kimi 出 654吨/15.92%/65分+管理事项验过 |
| 沙盘对比/进日常 | 📐 | Q16/Q20 需 WO-E2 |
| 回采对账/越用越准 | 📐 | Q20 需 WO-E1 |
| 审计/决策史追溯 | 📐 | Q20 需 WO-AUDIT-OBS |

## §4 这一批的新观察

1. **Q18 是系统已成熟的强项**——预警真假甄别(dataMode 诚实位)完整能答·是 Maven 置信度环里本系统**做到 Palantir 同级**的一题。
2. **Q12/Q17 又指向 N1 的近亲**——"补救手段真成本"(Q12)、"碳作为硬约束喂排产"(Q17)都是**多源/多约束**没充分立项的：N1(多源冲突仲裁)+ 多约束硬约束求解 = 同一类"融合不只是拼接"的缺口。建议 WO-MULTISRC-ARBITER 扩为含**多约束硬约束**(碳/成本/lead-time 作约束喂 opt 族)。
3. **Q19 命中已登记断点 G-10**(规则非一等可编辑引用)——"改规则即重算"的 what-if 需规则库增量·这是 D+E 之外的一块。
4. **Q13 客户360敞口**——靠 agent 编排能答·但确定性"客户维度聚合"求解器是低成本增量(可选)。

## §5 诚实边界
- 设计推导·非真起服务跑 10 题(那是 FDE 实拍)。链节多数本会话真跑验证过(标 ✅)·少数(Q13 客户聚合/Q19 规则重算)是 agent 编排推断·标注。
- "✅能答"= 链节都在且验证过·不等于富答案体验已对这 10 题实拍。
- N1/G-10 等缺口是架构判断·dev 若指已有路径给文件:行我复核。

## 本体引用与影响
- **链路** `sys.orch.query_to_answer` 各段 + 数据→本体→推演→决策→回采→校准大环(Q20 走全环)。
- **不变量** R13(诚实位 Q18)·R4(审批 Q14/Q19)·R6(确定性推演)·R14(跨域/config 约束 Q17)·R2/R3(隔离 Q16/Q20)。
- **断点** G-10(规则可编辑 Q19·已登记)·G-11/G-12(沙盘活体 Q16/Q20)·**G-N1(多源/多约束融合 Q12/Q17·建议入 §8)**。
- **WO 建议**：WO-MULTISRC-ARBITER 扩含多约束硬约束(Q12/Q17)；规则一等可编辑引用(G-10·Q19)为独立增量。

---
*审核方设计推导走查 2（design+review·链节引真实系统·非真起服务实拍）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
