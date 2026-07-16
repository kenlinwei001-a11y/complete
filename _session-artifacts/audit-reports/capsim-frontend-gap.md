# CAPSIM 前端UI/交互/视图模式差距 — 用户评估 + 审核方真代码核验 (RiskBoardView.tsx 960行 @ 059874f0)

用户评估补齐了我 backend-scoped gap 分析漏掉的前端维度。逐项真读代码核验，三类：

## ✅ 用户CORRECT — 我真漏了（真实gap）
- **[P0] 时间轴逐日 rich hover 降级为原生 title** — CONFIRMED tsx:730 `title={D+${i+1}·${value}}` 纯原生 HTML title；无 showDayTip 富弹窗（无事件脉冲/无受影响订单明细表）。参照 HTML:2547 onmouseenter=showDayTip。**真gap。**
- **[P2·铁律0.4命门] QA面板=本地正则假对话·非真agent** — CONFIRMED tsx:811-814 `/客户|谁/.test(q)` 等纯前端正则，答案派生自本地 card 对象，**零 agent 调用**。参照 qa-chip→riskAsk→真agent。→ **这是"前端写死冒充真后端"的直接违背**（agt_risk 真存在但前端根本没调它）。**我最大的漏——这正是你"后端必须真"原则要抓的。**
- **[P1] 四增强 未评估** — CONFIRMED：InferenceProcessPanel 存在(tsx:452 solved)但**未验其内容是否接真provenance**；RiskHoverTrigger 存在(tsx:325)但只包 factor chip 非"全元素"；缺失分类面板 grep 0命中=**未实现**；多方案topN+比较=MitigationCards 无对比矩阵/topN=**未实现**。我只数了 plan row 数量。
- **[P1] QOS 分类器误路由（原始bug根因）** — 我的 density 分析完全没涉及。用户精确根因：what_if_displacement_q 有3条示例·signal_propagation_q/shared_bottleneck_q 各只1条 → 语义重叠 → 问句误路由 plan_what_if_displacement_q_v1 → multi_plan_compare 报"缺乏方案比对"。**功能链路bug·与density无关·同一问题的另一半根因。**（修正我早前"LLM凭据/分类接缝"的粗诊断→更精确是示例数不均致误路由）
- **[P2] 导出最终规划 button** — grep 无"导出"/exportPlanTable 文本(仅`export function`)→ **疑缺失**（待定点确认；参照 HTML:3491 exportPlanTable）。
- **[P3] 配色档位≠参照** — 正常#43B7D7 vs 参照#62BE77；关注#E8B54A vs #D2B04C；瓶颈#E0626C vs #DD7E9E。注：CAPSIM 铁律原是"颜色走平台tokens.css·不搬参照"→此为**刻意偏离**；若要像素1:1含配色，需把 tokens 调成参照绿/粉档（待你定）。

## ⚠ 用户评估基于旧版RiskBoardView — 当前V2代码其实已有（附证）
- **[P0] "订单聚合"Tab** — 你读的是旧版(tsx:207静态chip)。**当前V2已接线**：tsx:154 `riskTab` state；tsx:257-260 瓶颈视角/订单聚合 双chip 均可点(onClick/onKeyDown)；tsx:289 `OrderAggView` riskTab==='order' 渲染；组件 tsx:484。→ **视图模式已实现**（非未实现）。
- **[P1] "受影响订单·经营数据看板"inline段落** — 同样已在 V2：tsx:516 §6a 经营数据聚合表+分类维度切换、tsx:519 "受影响订单·经营数据看板"（在 OrderAggView 内 inline）。→ **inline 经营看板已在**（非仅modal）。

## 结论：CAPSIM 1:1 拆成3条workstream（我原分析只覆盖A）
- **A 后端密度**（我原gap·正确）：种真OEE/利用率/良率+抬需求缺口→8越线卡/多因素/17行。[sub-agent 正跑]
- **B 前端交互/视图 parity**（用户补·真漏）：QA→真agt_risk调用(铁律0.4命门) · 富逐日hover showDayTip(事件脉冲+订单明细) · 四增强(多方案比较/缺失面板/全元素溯源/过程图真provenance) · 导出button · 配色档位裁定。→ **建 WO-CAPSIM-FRONTEND-PARITY → dev1**。
- **C QOS分类器**（原始bug）：rebalance 分类示例(signal_propagation_q/shared_bottleneck_q 补足示例)解误路由"缺乏方案比对"。→ 建 WO-QOS-CLASSIFY-REBALANCE。
