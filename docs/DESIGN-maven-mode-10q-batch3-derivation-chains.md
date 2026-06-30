# 设计走查 3 · 再 10 题（Q21–Q30）+ 推导链条

> 第三批·探不同求解器/能力维度（集中度/库存/换型/认证/S&OP/经验复用/数据健康/多重冲击/趋势预警/急单）。链节钉真实求解器/工具/路由，标 ✅本会话验证 / 📐设计待建 / ❌缺。设计推导·非真起服务实拍。

## §1 十题（Q21–Q30·与前 20 不重复）

| # | 问题 | 核心能力 / 求解器 |
|---|---|---|
| Q21 | 哪个指标在悄悄恶化、还没触红但趋势危险？ | **趋势/前导异常检测**（触警前） |
| Q22 | 年度 AOP 和季度滚动预测对不上，差在哪个细分、要不要重平衡？ | S&OP 平衡 / `quarterly_gap` |
| Q23 | 我对某供应商/某基地依赖太高吗？单点失效会怎样？ | 集中度风险 / `concentration_risk` |
| Q24 | 以前遇过类似"共享瓶颈"，当时怎么解的、有可复用处置吗？ | 经验复用 / `search_experience`+`search_knowledge`(S4) |
| Q25 | 客户急单 5000 套 7 天交，接不接？哪个基地能接？ | 急单即时可行性 / `order_fullchain`+`capacity` |
| Q26 | 哪些料压太多、能释放多少现金、哪些要赶紧补？ | 库存优化 / `inventory_optimize` |
| Q27 | 这周换型损失太大，重排序列能省多少？ | 换型序列 / `changeover_sequence` |
| Q28 | 新品认证要多久、卡哪个环节、影响哪些订单上市？ | 认证时间窗 / `cert_schedule` |
| Q29 | 我这套决策依赖的数据，哪些真采集、哪些合成估算、可信度地图？ | 数据健康元 / `buildDataHealth`+dataMode |
| Q30 | 锂价涨20%+某基地停产+大客户砍单同时发生，扛得住吗？ | 多重冲击压力测试 |

## §2 推导链条

### Q21 · 趋势/前导异常（触警前）—— 🔴新缺口候选
```
问句"哪个指标还没触红但趋势危险"
└ 取数: 时序点(A8 ts_point) + risk_timeline 逐日曲线 ✅
 └ 求解: risk_timeline → series 逐日 + crossDay 越线日 ✅(但**阈值触发**·crossDay=已越线)
 └ ❌缺: "还没越线但斜率/趋势危险"的**前导指标检测**(leading indicator·趋势外推·斜率异常)非显式能力
断点: ❌ **新缺口 N2**——系统是"越线即红"(threshold)·缺"趋势恶化预警"(还没红但快了)。
      Maven 态势感知的"early warning"这一格·建议 WO-LEADING-INDICATOR(趋势外推+斜率异常·确定性 R6)
```

### Q22 · S&OP 年度-季度对不上
```
问句"AOP 和季度滚动差在哪细分·要不要重平衡"
└ 取数: SopVersion(demand/supply·isFinal) ✅ + DemandSegment(p50/季度) ✅ + PlanTarget(AOP) ✅
 └ 求解: quarterly_gap(年度目标 vs 季度滚动) → 逐细分差 ✅(求解器验存在·dataMode 本会话验)
 └ 规则: C21(细分结构) C03(产能) 裁决
答:"储能细分季度滚动比 AOP 低 5.1pp·建议重平衡产能向储能"
断点: ◐ quarterly_gap 在·sop 域闭环。真值看细分预测真实性(DemandSegment 合成·诚实标)
```

### Q23 · 集中度单点失效
```
问句"对某供应商/基地依赖太高吗·单点失效怎样"
└ 取数: Order→Model→bases(可产网络) ✅ + Material→Supplier ✅
 └ 求解: concentration_risk → 集中度(HHI 式) + 单点失效敞口 ✅(求解器验存在·LIVE 白名单)
 └ 衔接: 失效→affected_orders 波及 ✅
答:"宜宾承接 38% 储能产能·单点失效→影响 N 张订单·建议分散到青岛/盐城"
断点: ✅ concentration_risk + affected_orders 链在。这是 Maven"单点脆弱性"一题·能答
```

### Q24 · 经验复用（知识库）
```
问句"以前类似共享瓶颈怎么解的·有可复用处置吗"
└ 路由: Path B agent ✅
 └ 工具: search_experience(经验记忆库·50 案例 distill) ✅ + search_knowledge(S4 知识库) ✅(agentcore 验存在)
 └ 诚实位: **经验命中是"过往解法参考"·数字不得直接引用** ✅(seed:597 诚实约束·防旧数当真)
答:"历史有 3 个类似共享瓶颈案例·当时用'夜班+外协'解·参考处置(数字需本期重算)"
断点: ✅ S4 KB + experience 工具在·且诚实约束(不拿旧数冒充)。Maven"经验/学习"一题·能答(检索层)
      微缺: "可复用处置"自动套用到当前(非仅检索)是增量·属 E 自进化范畴
```

### Q25 · 急单即时可行性
```
问句"急单 5000套7天·接不接·哪基地能接"
└ 路由: 场景 agent(order 入口)✅
 └ 取数: 新 Order(qty=5000,due=D+7) + 各基地 capacity_forecast ✅ + Model.bases ✅
 └ 求解①: 逐可产基地 capacity_forecast(周供给 P50/P90 vs 5000) ✅(V1 验)
 └ 求解②: order_fullchain(该急单·交期/齐套/财务三闸) ✅(读源验)
 └ 规则: C02/C03(交期) C06/C16(齐套) C15(毛利)
答:"常州 P90 周供 4200<5000→单基地不够·常州+成都拆单可达·齐套缺X需加急·毛利OK→可接(拆单)"
断点: ✅ 链全在(capacity+order_fullchain)·急单即时评估能答。微缺: 多基地拆单最优=assignment_optimize(在)
```

### Q26 · 库存释放现金
```
问句"哪些料压太多·释放多少现金·哪些要补"
└ 取数: MaterialBalance(库存/缺口) ✅ + 单价 ✅
 └ 求解: inventory_optimize → over(超储)/under(缺)/idle(呆滞天数)/releasableCash ✅(本会话真invoke验·LIVE·真matId数据)
 └ 规则: C16(安全库存) C28
答:"cu_foil 呆滞116天·可释放现金X·neg_graphite 缺2356需补"(本会话真跑见过此结构)
断点: ✅ inventory_optimize 本会话真 invoke 验过(LIVE·真 underQty/idleDays)。能答·强项
```

### Q27 · 换型序列优化
```
问句"换型损失大·重排序列省多少"
└ 取数: 排产序列(订单/型号切换) + 换型损失参数
 └ 求解: changeover_sequence → 优化序列 + 节省 ✅(求解器验·LIVE 白名单)
答:"按化学体系聚类重排→换型次数 12→7·省工时 X"
断点: ◐ changeover_sequence 在(LIVE)·但换型损失系数真值需真排程源(demo 合成·诚实标)
```

### Q28 · 认证时间窗影响上市
```
问句"新品认证多久·卡哪·影响哪些订单上市"
└ 取数: 认证环节/周期 + 待认证型号 + 关联订单
 └ 求解: cert_schedule → 认证甘特 + 关键路径卡点 ✅(求解器验·LIVE 白名单)
 └ 衔接: 卡点→影响订单上市日
答:"4680-新化学认证 90 天·卡在'安全测试'环节·影响 Q3 上市的 N 张订单"
断点: ◐ cert_schedule 在·真认证进度需真合规源接入(demo 合成)
```

### Q29 · 数据健康元（可信度地图）—— 元能力
```
问句"我依赖的数据哪些真采集·哪些合成估算·可信度地图"
└ 求解: buildDataHealth(逐源对象数 + 真实系统归因 SCADA/MES/ERP/SRM…) ✅(WO-7 本会话验 9/9 源非0)
 └ + dataMode 诚实位(每求解器输出 LIVE/MOCK/PARTIAL) ✅(WO-DM 全族验)
 └ + provenance/ValidationTrace(逐值溯源) ✅
答:"9 个真实系统源·X 个对象真物化·当前 demo 全经单一合成连接器(诚实标)·求解器 dataMode 地图: LIVE×8/PARTIAL×5/MOCK×2"
断点: ◐✅ **元能力强**——可信度地图(dataHealth+dataMode+provenance)是 Maven"治理/可信"环本系统强项。
      诚实边界: demo 单合成源(N1 多源真接入后此图才"多源真")
```

### Q30 · 多重冲击压力测试 —— ◐需沙盘合成
```
问句"锂价+20%+某基地停产+大客户砍单 同时·扛得住吗"
└ 路由: Path B agent / 沙盘
 └ 取数: 当前世界快照 + 三冲击参数
 └ 求解: 沙盘 sim/sessions: act(锂价冲击)+act(基地停产)+act(砍单)→ propagateTick 复合传导 ✅(沙盘在)
   或 capex_scenario/counterfactual 单冲击 ✅·**多冲击叠加=沙盘组合 act**
答:"三冲击叠加→毛利-X·现金垫破底线·建议优先保现金(降 capex)"
断点: ◐ 沙盘 act/tick 复合传导在·但"**多冲击一键压测 + 对比基线**"进决策日常 📐WO-E2。
      databuilder/stress 是**数据生成**压测(非决策)·决策多冲击=沙盘组合·E2 让它一键化
```

## §3 这一批的发现

### ✅ 坐实的强项（之前没单独验的扩展求解器都在）
- Q23 集中度(concentration_risk)·Q26 库存(inventory_optimize·**本会话真 invoke 验过**)·Q27 换型·Q28 认证·Q22 S&OP——**10 个扩展求解器全在且带 dataMode**(本会话 WO-DM 验过 14 extended)。
- Q24 经验复用(S4 KB + experience·**且诚实约束"旧数不得直接引用"**)·Q29 数据健康(buildDataHealth 9/9 源验)——**Maven 经验/治理两环本系统强项**。

### 🔴 新缺口 N2（趋势/前导异常·Q21）
- **现状**：risk_timeline 是**阈值触发**(crossDay=已越线红)。
- **缺**："还没越线但**趋势恶化/斜率异常**"的前导预警(leading indicator)——Maven 态势感知的"early warning before threshold"这一格。
- **建议**：WO-LEADING-INDICATOR（趋势外推 + 斜率/异常检测·确定性 R6·接 risk_timeline series）。低成本增量·价值高(防"红了才知道")。

### 📐 又见 E2（Q30 多冲击 / 沙盘合成）
- 多重冲击压力测试 = 沙盘组合 act + 对比基线 → **WO-E2** 让它一键化。再次佐证 E2 价值。

## §4 三批 30 题 · 缺口收敛总览
| 缺口类 | 命中题 | 补它的 WO |
|---|---|---|
| E 活体（沙盘进日常 + 校准越用越准） | Q1/3/6/16/20/30 | **WO-E1 / WO-E2** |
| 统一审计 / 决策史 | Q9/Q20 | **WO-AUDIT-OBS** |
| 多源/多约束仲裁（融合不只拼接） | Q2/Q12/Q17 | **WO-MULTISRC-ARBITER**（建议含多约束） |
| 趋势/前导异常（触警前） | Q21 | **WO-LEADING-INDICATOR**（新·建议） |
| 规则一等可编辑（改规则即重算） | Q19 | 断点 G-10（已登记·规则库增量） |
| 视图跨域 layout | Q10 | 断点 G-5（已登记） |

**强项（已 Palantir 同级·30 题验证）**：诚实位/置信度(Q4/18/29)·plan&sop 闭环(Q1/15/22)·瓶颈传导波及(Q3/11/23/25)·46 求解器族(Q12/26/27/28…)·经验治理(Q24/29)。

## §5 诚实边界 & 本体
- 设计推导·链节多数本会话真跑验证(标 ✅·Q26 inventory_optimize 真 invoke 见过结构)·少数 agent 编排推断。非 30 题端到端真起服务实拍。
- **本体**：链路 query_to_answer + 数据→本体→推演→决策→回采→校准；不变量 R13(诚实位)/R6(确定性)/R4(审批)/R14(跨域)；断点 G-10/G-5/G-11/G-12 + **建议新增 G-N1(多源/多约束)·G-N2(前导异常)入 §8**；新 WO 建议 WO-MULTISRC-ARBITER / WO-LEADING-INDICATOR。

---
*审核方设计推导走查 3（design+review·链节引真实系统·非真起服务实拍）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
