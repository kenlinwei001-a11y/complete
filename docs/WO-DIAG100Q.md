# WO-DIAG-100Q · 自由深问 100 题真测工单（找卡点）

> ## ⚠️ 过期横幅（WO-R6 收编时加·2026-08-13）—— 先读这段再读下面任何一个数
>
> **本文件是一份历史快照，不是系统现状。**
>
> | 项 | 值 |
> |---|---|
> | 台账基线 | `claude/vigilant-knuth-b1nmxn` @ `e99f23c3`（2026-07-19） |
> | 收编时 canonical | `9ee260ab`（2026-08-13） |
> | 两者相距 | **1164 个提交**（实测 `git log --oneline e99f23c3..$CANON \| wc -l`） |
> | 台账点名的主要修路径 `apps/agentcore/src/router/ceo-route.ts` | 自基线以来**已动 9 个提交** |
>
> 也就是说：下面每一条「✗ 硬失败」「◑ 绿但错」「路由错配」**都可能早已被修**，
> 也可能还在——**本次收编没有重跑，因此一条都没有复验**。
> 照铁律 0.5：**「我一个月前测到它坏」不度量「它现在坏」**，两者是不同的命题。
>
> **怎么用这份文件**：
> - ✅ **可以**用它的**方法论**（28 题真 LLM 探针 · 五分判定 ✅/◐/◑/✗/⏱ · 卡点归类 + 精确修路径）；
> - ✅ **可以**用它作为「2026-07-19 那天确实做过一次真测」的**历史证据**（原始数据在
>   `scratchpad/diag100-results.json`，含 route/status/error/answer/provenance/耗时，可复核）；
> - ⛔ **不可以**拿它的任何一条结论当**今天的缺陷清单**去派单——要用，**先重跑一遍**
>   （`scratchpad/diag100.py`，注意它也停在基线那天的接口假设上，可能要先适配）。
>
> **收编范围说明**：原分支 6 个文件收了 5 个。`scratchpad/diag100.pid`（内容为单行 `95722`）
> **拒收** —— 那是 2026-07-19 那次后台进程的 PID，进程早已不存在，既非文档也非证据也非脚本，
> 且全仓无任何文件引用它（三份文档 + 脚本实测各 0 次命中）。



> 派发对象：1 名 dedicated dev（**测试单·只测不改码**，除非本单末尾「可选修复」明确授权）
> 基线：canonical `claude/vigilant-knuth-b1nmxn` @ e99f23c3（或审核方指定 tip）
> 交付：`docs/DIAG-100Q-RESULTS.md` 结果台账 + `scratchpad/diag100-results.json` 原始数据 + push `claude/handoff-diag-100q`

---

## 🚦 范围边界（本单身份 = 只碰这些）
- **只读/只测**：`apps/agentcore`（QOS 路由）、`apps/datacore`（求解器/对象）经 REST 黑盒测；不改引擎代码。
- **可写**：`scratchpad/diag100.py`（测试脚本）、`docs/DIAG-100Q-RESULTS.md`（结果）。
- **禁碰**：任何 `src/**` 引擎源码、golden、契约（发现 bug → 写进结果台账，不就地改）。

---

## 一、测试目的

**用 100 道基于真实种子数据的具象问题、绑真 LLM、走真 QOS 全链，系统性找卡点——判定每个卡点属于「缺关联数据 / 缺本体 / 缺 agent / 缺求解器 / 路由错配 / 编排断链」哪一类，给出精确 file:line 与最小修路径。**

铁律：**绿测试 ≠ 能用**。COMPLETED 不算过——必须答案**真接地**（引用真实体值、有溯源 provenance、口径对得上问题）才算过。断点常在接缝（自由问句 → 正确求解器 → 真数据）。

**为什么要"具象"**：抽象问题（"储能为什么没达标"）缺时间/基地/型号，测不出真断点。每题必须锚**库里真实存在**的实体（下方数据字典），这样"答不出/答错"才能归因到缺数据还是缺接线。

---

## 二、前置环境（dev 照做）

```bash
# 1. 双服务内存态（无需 DB）
CK=$(openssl rand -hex 32)
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=$CK SERVICE_TOKEN=devsvc \
  node apps/datacore/dist/server.js &
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=devsvc \
  node apps/agentcore/dist/main.js &

# 2. 绑真 LLM（Kimi/Moonshot·openai_compatible·baseUrl https://api.moonshot.cn/v1·model kimi-k2.6）
#    apiKey 写 restricted 文件读取（no-secrets-echo·勿明文入命令/日志/提交）；datacore AES-GCM 落库。
#    POST /a/v1/llm-providers {name,kind:"openai_compatible",baseUrl,apiKey,models:[{modelId:"kimi-k2.6",
#      displayName,capabilities:{tools:true,structuredOutput:true,maxContext:131072}}],status:"ACTIVE"}
#    → POST /a/v1/llm-providers/{id}/test  {} 期望 ok:true
#    → PUT /a/v1/llm-bindings {bindings:[{purpose:"agent"|"classifier"|"comprehend",providerId,modelId:"kimi-k2.6"}]}
#    Key 找审核方要（用户已提供 kimi2.6 key）。
```

**dev 鉴权头**：`X-Debug-User: demo:admin:admin|planner|catalog_admin`
**提问端点**：`POST /b/v1/queries` body `{packageId:"pkg_battery_manufacturing", query, context:{view,selectedObjects:[],filters:{},pageContext:{view,entities:[{type,id,label}],selection:[...ids],drillPath:[],actions:[],focus:{...}}}}` → 轮询 `GET /b/v1/queries/{taskId}` 到终态。

---

## 三、数据字典（100 题的接地锚·全部库里真值）

| 维度 | 真实体（可直接引用） |
|---|---|
| **业务线(3)** | 乘用车(达成99.5%) · **储能(达成72.2%·目标139.2/实际100.5万套·缺口38.7)** · 商用车(115.8%) |
| **基地(13)·util%** | 常州88 成都82 厦门85 江门83 眉山79 武汉80 合肥78 自贡77 金华76 信阳75 枣庄73 扬州72 **邯郸70(最低)** |
| **基地类型** | 动力+储能:常州/成都/枣庄 · 储能:江门/眉山/信阳/邯郸/扬州 · 动力:厦门/武汉/合肥/自贡/金华 |
| **型号(6)** | 4680-NCM(碳76·超70线) 4680-LFP 2170-NCM 方形-LFP(储能) 圆柱-LFP(储能) 方形-NCM |
| **指标(10)·实际/目标** | seg_attain_ess 72.2/100 · market_share 21.5/23 · cash 58/60 · material_cov 95.8/100 · demand_attain 90.8/100 · gm_rate 17/16 · gross_profit 118.9/112 · revenue 700/700 · seg_attain_pas 99.5 · seg_attain_com 115.8 |
| **订单(24)** | SO-3391(广汽·4680-NCM·7259套·due06-24已逾期·hefei/jinhua) SO-3402(长安·14518·07-02) SO-3415(吉利·4033·07-18) SO-3420(东风·10485·07-09) …客户:广汽/长安/吉利/东风/宇通/国网/南网/国电投 |
| **客户(8)** | **商用车集团G(逾期38天·欠款涨)** 整车厂A/B/C 海外车企E 储能集成商D/H 电网公司F |
| **供应商(14)** | **容百科技(三元正极·S级·最大)** 当升(A) 长远锂科(B) 贝特瑞(负极S) 杉杉 恩捷 星源 天赐 新宙邦 诺德 鼎胜 科达利 震裕 凌云 |
| **物料缺口(t)** | **三元正极 缺1858(lta92%)** 石墨负极698 电解液630 铜箔398 电芯壳体360 磷酸铁锂正极492 铝箔166 · 隔膜/包材 0 |
| **矿价** | 碳酸锂 8.4万→9.6万/吨(+14%·周序 06-01→06-22) |
| **认证(18)** | 型号×产线×基地·状态 量产/认证中·gapContribution |
| **产能投资(3)** | 枣庄/江门 IRR/util24/C23 门 |
| **MES执行层(P0修后已有)** | WorkOrder260 QualityLot260 DefectRecord85 EquipmentOEE1000 EquipmentDowntime166 MaintenanceOrder193 WIPLot260 ShiftPlan1000 |
| **时间轴** | 模拟今天≈2026-06-10(tick0)·PlanTarget月度2026-01..12·订单due 06-24..07-28 |

---

## 四、测试结构（每题协议）

每题记录 6 列：`序号 | 问句 | 锚实体 | 预期求解器 | 实际route | 结果判定`。
**结果判定枚举**（比 COMPLETED 严）：
- ✅ **真接地** = 完成 + 答案引用真实体值 + 有 provenance + 口径对题
- ◐ **绿但薄** = 完成但答案空/仅规则名/无真数据（如求解器跑了但输入空）
- ◑ **绿但错** = 完成但绑错求解器（答非所问，如断供半径→metric_rollup）
- ✗ **硬失败** = FAILED/400/超时/探索模式未产出
- ⏱ **超时** = >180s 未终态

**探针类型**（预先标注，便于归类）：`正常`(应通) / `gap-data`(疑缺数据) / `gap-route`(疑路由错配) / `gap-orch`(疑编排断链) / `gap-agent`(疑 agent 接不到工具)。

---

## 五、100 问题清单（按域·全部锚真实体）

### A. 经营指标根因归因（12·预期 gap_attribution / plan_rootcause / metric_rollup）
1. 储能业务线目标139.2万套、实际100.5、缺口38.7万套，根子在哪个基地哪个环节？先补哪最快？【储能·seg_attain_ess】正常
2. 市场份额21.5%没到23%，被哪个竞品在哪个细分抢走？价格还是产能？【market_share】gap-data(RootCauseChain无share链·验CausalFactor兜底)
3. 现金58亿差目标60亿2亿，缺口主要卡在应收还是库存占用？【cash】gap-data(chainKey=None·验能否归因)
4. 物料覆盖95.8%没满，哪几种物料拖的后腿？【material_cov·三元正极缺1858t】正常
5. 需求达成90.8%，是哪条业务线、哪个月拉低的？【demand_attain·PlanTarget月度】正常
6. 毛利率17%虽超标但储能线拖累多少？【gm_rate·储能marginPct13】正常
7. 乘用车达成99.5%差0.5%，是量还是价的缺口？【seg_attain_pas】正常
8. 商用车超额到115.8%，是真需求还是压价冲量？【seg_attain_com·priceWan1.8】gap-data
9. 营收700亿刚好达标，但结构里哪块在透支未来？【revenue】gap-orch
10. 毛利总额118.9亿超目标112，超额来自哪个细分？【gross_profit·三细分marginWan】正常
11. 把储能72.2的达成率沿链路拆到订单级，最深的叶子是哪几单？【seg_attain_ess·24订单】正常
12. 这10个指标里同时越线的是哪几个，有没有共同根因？【全10指标】gap-orch(跨指标共因)

### B. 产能·订单可承接·瓶颈（12·预期 capacity_forecast / order_fullchain / bottleneck_matrix / affected_orders）
13. 常州4680-NCM线，7月SO-3402(长安14518)+SO-3415(吉利4033)能按期交吗？瓶颈化成柜够吗？【常州util88·化成柜】gap-route(CEO深问接不到capacity_forecast?)
14. 常州util已88%全网最高，再接20%订单要不要外协？【常州】gap-route
15. SO-3391(广汽7259·due06-24)已逾期，还能救吗？调哪个基地？【SO-3391·hefei/jinhua】正常
16. 邯郸util只70%最闲，能不能把储能订单调过去填？【邯郸·储能】gap-route
17. 4680-NCM全网哪个基地产能余量最大？【4680-NCM·MODEL_BASE_MAP】正常
18. 若常州停一条线检修两周，波及哪些在手订单？【常州·affected_orders】正常
19. 储能280Ah/314Ah在眉山/信阳/扬州的产能瓶颈分别是什么工序？【储能三基地·bottleneck】gap-route
20. 7月所有高优订单(pri=高)总量多少，全网产能接得住吗？【Order.pri=高】正常
21. 厦门util85接近满，主产VDA-NCM，还能不能插单？【厦门】gap-route
22. 把24张在手订单按交期和产能做一次可承接性总评。【全24订单·order_fullchain】gap-route
23. 哪个基地是储能线的产能天花板，扩产投哪最划算？【储能基地·capex】gap-route
24. 化成柜是常州/合肥/枣庄的共同瓶颈，挤占关系怎么排？【化成柜·shared_bottleneck】gap-route

### C. 物料·供应链·长协·断供（12·预期 mrp_netting / lta_gap / supplier_disruption_radius / margin_attribution）
25. 三元正极缺1858吨(lta92%)，断供风险多大？备选顶得上吗？【三元正极·容百/当升/长远】gap-route(应supplier_disruption_radius)
26. 容百科技(最大正极供应商)断供两周，波及哪些型号、订单、缺口多少吨？【容百·SUP-001】gap-route
27. 碳酸锂涨到9.6万/吨(+14%)，对储能线毛利现金冲击多大？【碳酸锂·margin】gap-orch(decision_play前置?)
28. 长协覆盖不足的物料有哪些，缺口合计多少？【MaterialBalance 9·ltaPct】正常
29. 石墨负极缺698吨，贝特瑞一家供，风险集中度多高？【石墨负极·贝特瑞】gap-route(concentration_risk)
30. 电解液缺630吨、eta 06-25，赶得上7月订单齐套吗？【电解液·天赐/新宙邦】正常
31. 8种关键物料哪几种同时缺口>500吨且lta<95%？【三元/石墨/电解液】正常
32. 三元正极三家(容百/当升/长远)合同量vs实际交付差多少？【CATHODE_CONTRACT】正常
33. 若隔膜(现0缺口)突然断供，多久传导到停线？【隔膜·恩捷/星源】gap-data
34. 铜箔缺398吨，诺德/鼎胜哪家备选更快？【铜箔·诺德】gap-route
35. 把三元正极缺口沿"供应商→物料→型号→订单"反向追到受影响的具体订单。【三元正极·反向多跳】gap-route
36. 关键物料的长协到期节奏，哪个季度续签压力最大？【LTA 3·时序】gap-data

### D. 财务·信用·现金·应收（10·预期 credit_exposure / finance_pnl / decision_play）
37. 商用车集团G逾期38天欠款还涨，会不会拖累接单回款？【商用车集团G·cust_4】正常
38. 8个客户里信用风险最高的前三是谁？【Customer.maxOverdueDays】正常
39. 应收账龄里超期最多的一档金额多少，是哪个客户？【ARAging/OverdueRecord od-cg】正常
40. DSO最长的业务线是哪个，对现金垫多少天？【DSO·segment】gap-data
41. 现金58亿够不够撑住7月物料采购+工资？【cash·FinanceAccount】gap-orch
42. 24张应收发票里逾期的有几张，合计敞口多少？【ARInvoice 24】正常
43. 储能线量价本利科目：预算vs滚动vs差异，毛利倒挂了吗？【finance_pnl·储能】gap-route
44. 若给商用车集团G停止授信，影响多少在手订单？【商用车集团G·decision_play】gap-orch
45. 各基地财务账户现金/应收/应付，哪个基地现金最紧？【FinanceAccount 13】gap-route
46. 电网公司F回款周期长，占用了多少营运资金？【电网公司F】gap-data

### E. 质量·良率·工序·缺陷（10·预期 yield_diagnosis·**P0修前 gap-data / 修后应正常**）
47. 储能线良率波动大，是哪道工序(涂布/卷绕/装配)、哪台设备？工艺还是老化？【江门·涂布·DefectRecord】gap-data→(修后验)
48. 全网DefectRecord里缺陷最多的缺陷类型是什么，集中在哪个基地？【DefectRecord 85】gap-data→
49. QualityLot里失效率(failQty/batchSize)最高的工单是哪张？【QualityLot 260】gap-data→
50. 4680-NCM的质检不良主要卡在哪个检验特性？【InspectionResult·QualityStandard】gap-data→
51. 哪个基地的良率最近90天有统计突变(breakpoint)？【yield_diagnosis·C30】gap-data→
52. 涂布工序的良率基线vs实际差多少，哪条线最差？【Process.yield/yield_baseline】正常
53. WIP质检点(WIPQualityCheckpoint)拦截率最高的是哪个工序？【WIPQualityCheckpoint 390】gap-data→
54. 缺陷严重度(severity)高的批次，追到哪张工单、哪个型号？【DefectRecord.severity→WorkOrder】gap-data→
55. 储能线整体良率和动力线比差多少，根因是工艺还是物料？【Process×基地类型】gap-orch
56. 把一张失效QualityLot沿"质检批→工单→型号→订单"追全链影响。【QualityLot→Order】gap-data→

### F. 设备·OEE·停机·维护（8·预期 maintenance_stagger·**P0修前 gap-data / 修后应正常**）
57. 全网OEE最低的前五台设备是哪些，卡在可用率/性能/质量哪项？【EquipmentOEE 1000】gap-data→
58. 停机时长最长的设备在哪个基地，主要停机原因是什么？【EquipmentDowntime 166】gap-data→
59. 设备告警(EquipmentAlarm)里高级别告警集中在哪个工序？【EquipmentAlarm 111】gap-data→
60. 维修工单(MaintenanceOrder)积压最多的基地是哪个？【MaintenanceOrder 193】gap-data→
61. 化成柜(常州瓶颈)的OEE和停机情况怎样，是不是它拖了产能？【常州·化成·EquipmentOEE】gap-orch
62. 检修计划(MaintPlan)有没有和高峰订单撞期需要错峰？【MaintPlan 13·maintenance_stagger】gap-route
63. 备件消耗(SparePartConsumption)异常高的设备预示什么故障？【SparePartConsumption 193】gap-data→
64. 780台设备里OEE<70%的占比多少，对总产能拖累几个点？【Equipment 780×OEE】gap-data→

### G. 在制·工单·排程·进度（8·**P0修前 gap-data / 修后应正常**）
65. 在制(WIPLot)总量多少，卡在哪个工序最多？【WIPLot 260】gap-data→
66. 260张工单里qtyActual/qtyPlanned达成率最低的前五张？【WorkOrder 260】gap-data→
67. 排程(ProductionSchedule)里今天(06-10)之后交付压力最大的是哪条线？【ProductionSchedule 650】gap-data→
68. 半成品(在制)库存按基地汇总，成品/半成品/原材料各多少？【WIPLot×base·Bug2】gap-data→(验库存列不再空)
69. 常州所有工单的进度，有没有落后于排程的？【常州·WorkOrder×Schedule】gap-data→
70. WIP移动(WIPMove)最慢的工序间流转是哪段？【WIPMove 765】gap-data→
71. 班次计划(ShiftPlan)里实际vs计划人力缺口最大的线？【ShiftPlan 1000】gap-data→
72. 把一张延误工单追到它压住的下游订单交期。【WorkOrder→Order】gap-orch

### H. 决策·方案·优化·组合（12·预期 decision_play / outsourcing_split / selection_optimize / countermeasure_combo / optimize_whatif）
73. 储能38.7万套缺口，用加班/外协/调基地，哪个组合代价最小？【储能·outsourcing_split】◐验(上轮"真无解"·疑缺杠杆)
74. 针对储能达成给三套方案并比对，触发哪条行动规则？【储能·decision_play·matrix】正常
75. 若不解决三元正极缺口，未来30天会怎样？【三元正极·counterfactual_timeline】gap-route
76. 订单→基地最优指派，怎么排产能利用最高？【24订单×13基地·assignment_optimize】gap-route
77. 换型损失最小的排产顺序是什么？【ChangeoverMatrix 30·sequencing_optimize】gap-route
78. 给定产能上限，装箱式填满哪些订单收益最大？【packing_optimize】gap-route
79. 加大投资：储能vs动力哪条线IRR更高？【CapexProject·capex_scenario】gap-route
80. 把"外协比例从20%提到40%"做一次what-if，毛利怎么变？【optimize_whatif】gap-route
81. 多目标(交期+成本+毛利)下最优对策组合是什么？【countermeasure_combo·meta】gap-orch
82. 若碳酸锂再涨15%，最优应对是锁长协还是换LFP？【碳酸锂·decision_play】gap-orch
83. 邯郸/扬州低负荷基地，接哪些订单能同时提利用率和毛利？【邯郸/扬州·selection_optimize】gap-route
84. 给储能缺口出一个"可执行到订单级"的补救排产方案。【储能·全链】gap-orch

### I. 碳足迹·能耗·ESG（6·预期 carbon_footprint）
85. 4680-NCM碳足迹76超70线，主要超在哪个环节？【4680-NCM·CarbonFactor】正常
86. 6个型号里碳足迹超标的有几个，NCM系是不是都超？【Model.carbonFootprint】正常
87. 哪个基地单位能耗最高，换工艺能压多少碳？【EnergyMeter 13】gap-route
88. 把4680-NCM从NCM换到LFP，碳足迹和毛利各变多少？【4680-NCM/LFP·what-if】gap-orch
89. 全网碳足迹和电网因子(gridFactor)最相关的是哪几个基地？【EnergyMeter.gridFactor】gap-data
90. 碳足迹超标会不会影响出口订单(海外车企E)？【海外车企E·carbon】gap-orch

### J. 竞品·份额·价格·营收漏斗（6·预期 gap_attribution / concentration）
91. 份额被竞对A/B/C分别抢走多少，在哪个细分最狠？【CompetitorShare 3】gap-data
92. 竞品价格(CompetitorPrice)比我们低多少，压制了哪些型号？【CompetitorPrice 2·pricePerKwh】gap-data
93. 营收漏斗(PipelineOpportunity)里赢率低的阶段卡在哪？【PipelineOpportunity 2】gap-data
94. 丢标(WinLossRecord/BidRecord)最主要的原因是价格还是产能？【BidRecord·lossReason】gap-data
95. 价格实现(realizedPrice/listPrice)折让最大的型号是哪个？【PriceRealization 2】gap-data
96. 份额21.5%要提到23%，从抢哪个竞品的哪个细分最现实？【market_share·gap_attribution】gap-orch

### K. 时序·模拟·认证·跨域（6）
97. 枣庄4680-LFP产线认证推迟两周，连锁影响哪些订单交期？【枣庄·Certification·affected_orders】⏱验(上轮超时挂死)
98. 认证中(状态)的产线有几条，各自gapContribution多少？【Certification 18】正常
99. 从模拟今天06-10推进30天，储能缺口曲线怎么走？【simclock·risk_timeline】gap-route
100. PlanTarget月度目标2026-07 vs 实际，哪个月缺口最大？【PlanTarget 17·时序】gap-data

---

## 六、卡点分类框架（dev 按此归类每个非✅项）

| 类别 | 判据 | 典型修路径 |
|---|---|---|
| **缺关联数据** | 求解器跑了但输入对象空(total=0)/薄 | 补 synthetic 物化(如已修的 MES 16类·service.ts:663) |
| **缺本体** | 对象类型/链路/归因模板根本不存在 | 加 ObjectType/RootCauseChain/link(battery.ts) |
| **缺 agent** | path-B/dcp 探索模式"未能产出"·接不到求解器工具 | agent 工具注册 + 求解器暴露为 tool |
| **缺求解器** | 没有能算此问的求解器 | 新增 solver(solvers/service.ts) |
| **路由错配(绿but错)** | 绑错求解器·答非所问 | 扩 ceo-route 意图映射(ceo-route.ts:12-15,120-124) |
| **编排断链** | 求解器硬依赖前置未满足→400·无兜底 | 串链/兜底(如 decision_play 需先 gap_attribution) |

---

## 七、已知卡点（审核方 10 题真测已发现·dev 需确认+扩展）

1. **CEO 深问只覆盖 3/49 求解器**（`ceo-route.ts:12-15,120-124` 仅 4 粗正则→gap_attribution/decision_play/metric_rollup）。B/C/F/G/H 大量问题会**误路由或落探索模式**——本单 gap-route 标注处重点验。
2. **decision_play 硬依赖前置 gap_attribution**（无则 400·无兜底）——Q27/Q82 等 signal 类验。
3. **path-B/dcp 探索模式对复杂问题"未能产出"/超时挂死**（无 timeout 兜底）——Q13/Q97 验。
4. **MES 执行层 16 类**（已由审核方 P0 修·`service.ts:663` 补 putAll）——E/F/G 域验修后是否真出数据（修前全空）。
5. **成品库存无本体**（FinishedGoodsInventory 类型不存在）——Q68 验库存列（Bug2）。
6. **RootCauseChain 缺 share/cash 链**（但 CausalFactor 兜底）——Q2/Q3 验归因是否退化。

---

## 八、交付物（DoD）

1. `docs/DIAG-100Q-RESULTS.md`：100 行结果台账（6 列）+ 每个非✅项的**卡点归类 + 精确 file:line + 最小修建议**。
2. `scratchpad/diag100-results.json`：原始（含 route/status/error/answer/provenance/耗时）。
3. **汇总统计**：✅/◐/◑/✗/⏱ 计数 + 路由分布 + 6 类卡点各命中几题 + Top-10 最该修。
4. push `claude/handoff-diag-100q`（只含测试脚本+结果 doc·不碰引擎源码）。

**验收判据（审核方复验）**：① 100 题真跑真 LLM（非 mock）② 每个非✅项有归类+file:line ③ 至少覆盖 6 类卡点框架 ④ 结果可复现（脚本+种子）。
