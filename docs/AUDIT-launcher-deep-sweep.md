# 审计 · 场景启动器 20 卡改写问句全链穿透（用户指令·2026-07-05）

> 方法：真浏览器逐卡 ▶启动 → 第 2 轮输入**改写问句**（实体/数字/时间扰动·保持词表内）→ 穿透澄清/终态/KPI/ⓘ溯源/叙事五维。S11-S20 已完成（下表）；S01-S10 进行中，回报后补齐。

## 总卡点（S11-S20·按根因聚类）

### 簇① 改写参数 10/10 全不进求解器（结构性根·最高优）
意图播种 `slots:[]` + 执行计划 solver 入参**种子期静态烘焙**（`mocks/seed.ts:407-445`·ARG_OVERRIDE > groundedSlots > 卡 slotPresets）→ 自由问句**无槽可填→永不澄清→实体/数字/时间全被无声丢弃→答案与问句参数无关且多数不回显所用实体**。
铁证：S20 问武汉·2170 → KPI 原样回显 4680-NCM/成都；S19 问 2026Q3 → quarter=2026Q2；S14 缺口改 12万/4周 → 表合计恰=预置 80000/6周；S16 问海外车企E → 逾期发票是商用车集团G 的种子专属；S15 问储能集成商D → 烘焙 custName=电网公司F；S17 问江门 → 评的是占位项目 {id:"P"}。
**危害定级：静默错答（比报错严重）**——违反"推演基于真实数据/不作假"的精神层：答的是别的问题还不说。

### 簇② 落点视图断链 5/10（404/403）
dash 卡(S15/S16/S20)→ `/v/dashboard` **404**；risk 卡(S12/S13)→ `/v/risk-board` **403**。根因：workspace.views 短键(dash/risk) 与 useScenarioLaunch 的 VIEW_ALIAS 规范化两侧口径打架；真视图 /v/dash、/v/risk 均正常。

### 簇③ 答案渲染层（全卡）
KPI label=裸英文 solver key（极端例 "S"/"G"/"s0"）；dataMode/ruleSetVersion/confidence.* 元数据当 KPI 展示；数值普遍无单位；solver_summary 通用投影**无叙事结论**——"为什么/怎么排/值得吗/到哪一步"类问句得不到一句话回答；模板尾巴错位（S13 unresolved 写成 infeasible）。

### 簇④ 同卡自相矛盾 / 与视图矛盾
S20 verdict=超标(349.6 vs 70) 而规则表 C33 outcome=PASS；S15 evidence="通过（margin<floor）"把违规表达式当通过证据；S19 residualGap=50 与身后看板 Q2=4.96/Q3=8.9 对不上；S18 用 2026-06 数据回答 2026-07 问句。

### 簇⑤ 开发残留泄漏
S19 规则表 evidence 直出 TODO 原文"（P2 续：补 payload 映射）"×2（C08/C29）。

### 簇⑥ 溯源粗粒度 + hover 失效
每卡全部 KPI 共用**单一 provId**·计算恒=`$.data`·关联规则恒=无命中（哪怕脚注写"依据规则 C22/C29"）——无逐指标口径；滚动区下半 KPI hover 不出浮层须点击固定（10 卡复现）。

### 簇⑦ 模式配置冲突
`intents/materialize` 标 5 意图 AGENT_FIRST（yield_diag/maint_stagger/outsourcing_q/capex_review/quarterly_gap_q），但场景实体一律 mode=WORKFLOW_FIRST 且 orchestrator 只看场景 mode → 实测 10/10 走 Path A，真 Kimi 仅参与 classify。审核方裁定的 13/7 分派在启动器入口被架空。

### 簇⑧ 口径漂移
dataMode 在 SYNTHETIC/MOCK 间漂移无解释；confidence.measurement LIVE/MOCK/PARTIAL 三态无说明；"⚠部分数字未能溯源"条出现规律不明。

## S11-S20 逐卡记录
| 卡 | 改写句(要点) | 澄清 | 终态 | 核心卡点 |
|---|---|---|---|---|
| S11 | 武汉一号线换型 | 0 | WF·4s | 答常州(参数吞)·7KPI裸key·savedVsDueMin裸0 |
| S12 | 武汉涂布良率为何掉 | 0 | WF·1s | 无baseName回显·MOCK漂移·落点403·零因果 |
| S13 | 2026-07错峰 | 0 | WF·4s | 无决策KPI·字段错位·月无锚·落点403 |
| S14 | 缺口12万/4周 | 0 | WF·2s | 数字吞(合计=预置8万)·未答加班vs外协 |
| S15 | 储能集成商D毛利 | 0 | WF·1s | 问D答F(烘焙custName)·evidence矛盾·落点404 |
| S16 | 海外车企E新单 | 0 | WF·2s | 问E答G(种子专属发票)·错误冻结结论·落点404 |
| S17 | 江门值得投吗 | 0 | WF·4s | 评占位项目"P"·无verdict/IRR·KPI label极端裸 |
| S18 | 2026-07产销平衡 | 0 | WF·2s | 答6月数据·答非所问(问步骤答物料)·求解器与卡不符 |
| S19 | Q3缺口组合 | 0 | WF·2s | 答Q2·combo空·TODO泄漏·gap与看板矛盾 |
| S20 | 武汉2170碳足迹 | 0 | WF·1s | 回显4680/成都(双实体吞)·verdict与规则表互斥 |

（S01-S10 待补）
