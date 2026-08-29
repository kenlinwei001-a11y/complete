# WO-DIAG-100Q · 自由深问 100 题真测结果台账

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



> 基线：canonical `claude/vigilant-knuth-b1nmxn` @ e99f23c3
> 测试时间：2026-07-19 17:17:32
> LLM：Kimi 2.6（真实 LLM·非 mock）

## 汇总统计

- ✅ 真接地：8 题
- ◐ 绿但薄：2 题
- ◑ 绿但错：5 题
- ✗ 硬失败：13 题
- ⏱ 超时：0 题
- 总计：28 题

## 100 题结果

| 序号 | 问句 | 锚实体 | 探针 | 实际 route | 状态 | 判定 | 耗时(s) | 卡点归类 | 修路径 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 储能业务线目标139.2万套、实际100.5、缺口38.7万套，根子在哪个基地哪个环节？先补哪最快？ | 储能·seg_attain_ess | 正常 | AGENT | COMPLETED | ✗ | 150.66 | 缺 agent / 编排断链 | agentcore path-B 探索模式对复杂归因问句无 timeout 兜底且未暴露 gap_attribution 工具；补 agent tool 注册或 ceo-route 粗映射（ceo-route.ts:12-15,120-124） |
| 2 | 市场份额21.5%没到23%，被哪个竞品在哪个细分抢走？价格还是产能？ | market_share | gap-data | AGENT | COMPLETED | ✅ | 56.6 | - | - |
| 3 | 现金58亿差目标60亿2亿，缺口主要卡在应收还是库存占用？ | cash | gap-data | AGENT | COMPLETED | ✗ | 21.16 | 缺 agent / 缺本体 | cash 无 RootCauseChain 导致 outOfCatalog 落探索模式；补 cash 归因链或 CausalFactor 兜底（battery.ts / solvers/service.ts） |
| 4 | 物料覆盖95.8%没满，哪几种物料拖的后腿？ | material_cov·三元正极缺1858t | 正常 | AGENT | COMPLETED | ✅ | 72.72 | - | - |
| 5 | 需求达成90.8%，是哪条业务线、哪个月拉低的？ | demand_attain·PlanTarget月度 | 正常 | WORKFLOW | COMPLETED | ◑ | 1.05 | 路由错配 | 需求达成"哪个月拉低"被错路由到 metric_rollup；扩 ceo-route.ts 意图映射，将时间序列/下钻问句导向 plan_rootcause 或 metric_drill |
| 6 | 毛利率17%虽超标但储能线拖累多少？ | gm_rate·储能marginPct13 | 正常 | AGENT | COMPLETED | ✅ | 98.42 | - | - |
| 7 | 乘用车达成99.5%差0.5%，是量还是价的缺口？ | seg_attain_pas | 正常 | WORKFLOW | COMPLETED | ◑ | 1.01 | 路由错配 | 同 Q5：seg_attain_pas 被 metric_rollup 泛化应答，未按"量/价缺口"拆分；扩 ceo-route.ts 细意图 |
| 8 | 商用车超额到115.8%，是真需求还是压价冲量？ | seg_attain_com·priceWan1.8 | gap-data | AGENT | COMPLETED | ✅ | 65.71 | - | - |
| 9 | 营收700亿刚好达标，但结构里哪块在透支未来？ | revenue | gap-orch | WORKFLOW | COMPLETED | ◑ | 1.01 | 路由错配 | revenue"结构透支未来"被 metric_rollup 泛化应答；需 decision_play / finance_pnl 路径 |
| 10 | 毛利总额118.9亿超目标112，超额来自哪个细分？ | gross_profit·三细分marginWan | 正常 | AGENT | COMPLETED | ✗ | 28.36 | 缺 agent | gross_profit 问句落 AGENT 探索模式未能产出；应暴露 gap_attribution(metricKey=gross_profit) 为 agent tool |
| 11 | 把储能72.2的达成率沿链路拆到订单级，最深的叶子是哪几单？ | seg_attain_ess·24订单 | 正常 | WORKFLOW | COMPLETED | ◑ | 1.01 | 路由错配 | 订单级下钻问句被 metric_rollup 泛化；应在 ceo-route.ts 将"拆到订单级/最深叶子"导向 gap_attribution drill 或 order_fullchain |
| 12 | 这10个指标里同时越线的是哪几个，有没有共同根因？ | 全10指标 | gap-orch | WORKFLOW | COMPLETED | ✅ | 1.01 | - | - |
| 13 | 常州4680-NCM线，7月SO-3402(长安14518)+SO-3415(吉利4033)能按期交吗？瓶颈化成柜够吗？ | 常州util88·化成柜 | gap-route | AGENT | COMPLETED | ✗ | 155.52 | 缺 agent / 路由错配 | capacity_forecast / order_fullchain 未暴露给深问 agent； ceo-route.ts 未覆盖产能可承接意图，导致落探索模式超时/未产出 |
| 14 | 常州util已88%全网最高，再接20%订单要不要外协？ | 常州 | gap-route | AGENT | COMPLETED | ✗ | 47.48 | 缺 agent / 路由错配 | 同 Q13：外协/产能余量问句未路由到 capacity_forecast |
| 15 | SO-3391(广汽7259·due06-24)已逾期，还能救吗？调哪个基地？ | SO-3391·hefei/jinhua | 正常 | AGENT | COMPLETED | ◐ | 23.24 | 缺 agent | Agent 输出"我来查一下..."后无后续数据，说明 agent 接到意图但工具调用链断裂；需暴露 order_fullchain / affected_orders 为 agent tool |
| 16 | 邯郸util只70%最闲，能不能把储能订单调过去填？ | 邯郸·储能 | gap-route | AGENT | COMPLETED | ✅ | 92.9 | - | - |
| 17 | 4680-NCM全网哪个基地产能余量最大？ | 4680-NCM·MODEL_BASE_MAP | 正常 | AGENT | COMPLETED | ✗ | 24.19 | 缺 agent / 路由错配 | 4680-NCM 产能余量问句落探索模式；需 capacity_forecast / bottleneck_matrix 工具化 |
| 18 | 若常州停一条线检修两周，波及哪些在手订单？ | 常州·affected_orders | 正常 | AGENT | COMPLETED | ✗ | 36.28 | 缺 agent | affected_orders 求解器存在但 agent 探索模式未能调用；暴露为 tool 并加 ceo-route 意图 |
| 19 | 储能280Ah/314Ah在眉山/信阳/扬州的产能瓶颈分别是什么工序？ | 储能三基地·bottleneck | gap-route | AGENT | COMPLETED | ✗ | 109.51 | 缺 agent / 路由错配 | 储能三基地瓶颈问句未命中 bottleneck_matrix；扩 ceo-route 并暴露 bottleneck_matrix 工具 |
| 20 | 7月所有高优订单(pri=高)总量多少，全网产能接得住吗？ | Order.pri=高 | 正常 | AGENT | COMPLETED | ✗ | 69.79 | 缺 agent / 路由错配 | 高优订单聚合/产能承接问句落探索模式；需 order_fullchain + capacity_forecast 组合调用 |
| 21 | 厦门util85接近满，主产VDA-NCM，还能不能插单？ | 厦门 | gap-route | AGENT | COMPLETED | ✗ | 58.52 | 缺 agent / 路由错配 | 厦门插单问句未路由到 capacity_forecast；同 Q13 |
| 22 | 把24张在手订单按交期和产能做一次可承接性总评。 | 全24订单·order_fullchain | gap-route | AGENT | COMPLETED | ✗ | 40.43 | 缺 agent / 路由错配 | 24 订单可承接总评需 order_fullchain 但 agent 未命中；暴露为 tool |
| 23 | 哪个基地是储能线的产能天花板，扩产投哪最划算？ | 储能基地·capex | gap-route | AGENT | COMPLETED | ✗ | 28.34 | 缺 agent / 路由错配 | 储能产能天花板/扩产投资问句未路由到 capex_scenario；暴露 CapexProject 求解器 |
| 24 | 化成柜是常州/合肥/枣庄的共同瓶颈，挤占关系怎么排？ | 化成柜·shared_bottleneck | gap-route | AGENT | COMPLETED | ✗ | 55.47 | 缺 agent / 路由错配 | 化成柜共享瓶颈问句未命中 bottleneck_matrix / shared_bottleneck；扩 ceo-route |
| 25 | 三元正极缺1858吨(lta92%)，断供风险多大？备选顶得上吗？ | 三元正极·容百/当升/长远 | gap-route | AGENT | COMPLETED | ◐ | 97.88 | 缺 agent | Agent 输出"我来分析..."后无数据；supplier_disruption_radius / concentration_risk 未工具化 |
| 26 | 容百科技(最大正极供应商)断供两周，波及哪些型号、订单、缺口多少吨？ | 容百·SUP-001 | gap-route | WORKFLOW | COMPLETED | ◑ | 1.01 | 路由错配 | 容百断供问句被 metric_rollup 泛化；应路由到 supplier_disruption_radius / mrp_netting |
| 27 | 碳酸锂涨到9.6万/吨(+14%)，对储能线毛利现金冲击多大？ | 碳酸锂·margin | gap-orch | WORKFLOW | COMPLETED | ✅ | 1.01 | - | - |
| 28 | 长协覆盖不足的物料有哪些，缺口合计多少？ | MaterialBalance 9·ltaPct | 正常 | AGENT | COMPLETED | ✅ | 43.4 | - | - |

## 卡点归类汇总

（待跑完后按 6 类框架补全）

## Top-10 最该修

（待跑完后按影响面排序）