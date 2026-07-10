# 审计 · 前端假数据/绿测试≠能用残口（真可信·不打折·2026-07-10）

> 审核方只读审计（静态三角确诊：契约 + 真后端路由 + 前端消费点三方对齐·部分需真跑坐实）。已排除两个已知项（沙盘 KPI÷575·WO-CAP-03；OntoFlow publish types 契约漂移·WO-MERGE-02）。
> **根因**：`apps/frontend-shell/src/api/apiClient.ts:117` `(await res.json()) as T` **零运行时校验** → 任何 mock↔后端形状漂移在真后端下**静默坏、测试却绿**。这是前端版"门盲区"·堵它=治本。

## 确诊残口（分级·file:line）
| # | 控件/视图 | file:line | 病 | 证据 | 级 |
|---|---|---|---|---|---|
| F1 | 推演历史「意图/分类」列**真后端整列空白** | `QueryHistoryPage.tsx:66` + mock `handlers.ts:2607` + 本地类型 `endpoints.ts:863` | MSW偏离真后端(同 B4) | 前端读 `classification.intentKey`(顶层)·契约 `qos.ts:225` intentKey 嵌在 `candidates[0].intentKey`·真后端 server.ts:880 返完整契约形→真后端每行该列 undefined→「—」 | **P1** |
| F2 | SimComparePanel tickMean 跨维扁平均 | `SimComparePanel.tsx:16-29` | 误导聚合(同÷575) | 所有对象×所有 stateVar 原始值 sum/cnt·喂 A/B 对比表+heat strip 作权威 KPI·与已修 globalKpi 不一致 | **P1** |
| F3 | SandboxRunHistory tickMean | `SandboxRunHistory.tsx:17-24` | 误导聚合 | 同 F2·驱动全局态逐 tick 轨迹/sparkline | **P1** |
| F4 | 外部信号 strip 捏值冠真机构名 | `ExternalSignalStrip.tsx:29-37` | mock冒充LIVE | 碳酸锂96000「上海有色网」/镍「LME」/汇率「中国外汇交易中心」/电价「国网」…零 provenance/SYNTHETIC 徽章·挂 PlanGenerate:148/PlanAudit:124 喂决策(字段名不漂移·纯 provenance 病) | **P1** |
| F5 | ProjectSim 写死 batches 喂裁决·零徽标 | `ProjectSimView.tsx:251-254` | 写死冒充 | 写死 batches(qty18/22万套)渲成可编辑批次喂求解器裁决交期/缺口·全 ProjectSimView 零 DataModeBadge(姊妹 SopBalanceView 有徽标+运行闸) | P1/P2 |
| F6 | 校准 baselineOnly 诚实态 mock 从不触发 | `CalibrationPage.tsx:139/226/239` + mock `handlers.ts:1268` | 绿测试盲区/mock乐观 | 真后端(app.ts:4219/service.ts:208)无真配对时输出 baselineOnly:true(诚实"静态基线未测得改进")·mock 从不设→demo/测试永远显健康收敛曲线·诚实降级分支从不被测 | P2 |
| F7 | queries mock path="PATH_A" 陈旧枚举 | `handlers.ts:2607-2609` | MSW偏离真后端 | 契约 path∈{WORKFLOW,AGENT}(qos.ts:433)·真后端返之·mock list 陈旧 | P2 |
| F8-12 | ×0.6 敞口(PropagationTimeline.tsx:71)·gm重算魔法0.6/13(DashboardView.tsx:215)·瓶颈硬编码阈 t>=85/75/60(ProjectSimView.tsx:638)·??85 阈(RiskPopover.tsx:34)·外信管理页伪断言"经连接器同步·可溯"(ExternalSignalsPage.tsx:52) | 见列 | 误导聚合/mock冒充LIVE | P2 |

## 明确排除（真·非假·契约守同形）
cockpit_kpi(service.ts:853↔mock同形)·counterfactual_timeline(risk.ts:819↔mock逐字段同形)·/a/v1/objects {items,total}·sim/view-config(真后端SandboxViewConfigSchema.parse+mock镜像)·sim tick {curTick,state}·AnswerSchema/queries detail(受契约类型约束)·external-signals 字段名同源(仅 provenance 病见F4)。

## fix-WO（待安全入队·⚠at 用对象）
- **WO-FAKE-06（P1·堵根·最重要）**：`apiClient.ts:117` 关键端点响应加 zod 运行时校验(或至少 QOS/objects/sim/calibration 主链)·mock↔后端漂移**编译/运行即暴**而非静默坏。此单=前端版门加固·治整类。
- **WO-FAKE-07（P1·契约漂移三修）**：①F1 QueryHistoryPage 读 `candidates[0].intentKey`+mock list 改契约形 ②F7 path 枚举 WORKFLOW/AGENT ③F6 mock 增 baselineOnly 分支令测试覆盖诚实态。
- **WO-FAKE-08（P1·并入或紧随 WO-CAP-03）**：F2/F3 SimComparePanel+SandboxRunHistory tickMean 统一到分维/归一(同 WO-CAP-03 KPI 口径·一处修双处引)。**注**：WO-CAP-03(WIP)目前只改 SandboxView KPI·未含这两个对比控件·复验 CAP-03 时须核并要求覆盖或另开本单。
- **WO-FAKE-09（P1）**：F4 ExternalSignalStrip 捏值去真机构名或挂 SYNTHETIC/provenance 徽标(不拿 mock 冒充权威实测喂决策)+F5 ProjectSim 写死 batches 挂 DataModeBadge+运行闸(对齐 SopBalanceView)。
- **WO-FAKE-10（P2）**：F8-12 魔法系数/硬编码阈收口(阈由后端下发·敞口/毛利去魔法折算)。

## 诚实边界
F1/F6/F7 为静态三角确诊(契约+真后端路由+前端消费点)·未真起双服务端到端·fix 前建议真起 datacore+agentcore curl 坐实(尤其 F1 真后端 classification 实返)。F2-F5 稀释幅度/是否染决策红部分标"疑似·需真跑确认"(取决真租户各类型是否携带该 stateVar)。核心新洞：**F1 意图列真后端整列空白** + **F2/F3 tickMean(÷575 同类·活在两可见对比控件·WO-CAP-03 当前没覆盖)**。
