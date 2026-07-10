# PRD · L1.5 企业记忆层 / 案例推理（CBR）/ 决策学习闭环 —— 施工级

> 状态：设计稿·**未实现**（诚实标注·非"已完成"）。审核方设计子代理产出，供 dev 建、审核方真跑复验（含回退演练）。
> 基线源：
> - `docs/req-inventory/SUPPLEMENT_RG-Engine-fullspec.md`（**Ch11 Graph Learning → 簇② 企业记忆/CBR/决策学习闭环** 映射行·L1.5 待）+ 台账 INDEX「最强两簇之一·Ch41.22/49.23/51.16 三处规格印证」（`docs/req-inventory/INDEX.md:28`）。
> - `/tmp/rge.txt` / `/tmp/rge_clean.txt`（**RG Engine docx V1.0·Ch11 Requirement Graph Learning 满配全文**·`rge_clean.txt:4745-5147`；已用于本 PRD §4 的 Graph Embedding / Similar Scenario Retrieval / Decision Pattern Mining / Human Feedback / Knowledge Evolution 具体算法与 §3 数据模型的诚实分源）。
> - `docs/DESIGN-decision-os-complete-upgrade.md` §4（**L1.5 企业知识与记忆层·簇②·一等新层**·`:49-53`）+ §3 脊柱图（Case Memory/学习闭环旁路·`:31`）+ `docs/DESIGN-refit-rollback-plan.md` 七原则（本 PRD 是其施工级展开·不推翻）。
> - `docs/PRD-L1A-requirement-graph-engine.md`（上游·`RequirementGraph`）/ `docs/PRD-L1B-execution-planner-workflow-runtime.md`（上游·`ExecutionGraph`/`WorkflowDagRun`）：L1.5 消费其"问题→需求图→执行"的**结构化上下文**作为案例特征来源，但不依赖其落地（缺则退化为纯文本 `Decision.context` 特征·§4.2）。
> - **L2 决策内核**：`docs/PRD-L2-decision-kernel.md` **尚未撰写**（本 PRD 撰写时不存在）。本 PRD 按"**L2 产决策制品**"抽象衔接——定义 `DecisionArtifact` 摄取端口（§2.3），今由现有 `Decision`（`apps/datacore/src/decisions.ts`）+ agent 终态决策供给；L2 的 `DecisionPackage`（`rge_clean.txt:5378` Ch12.9 / `:4642` Ch10.16）落地时插同一端口，零改 L1.5。
> 范围纪律：本 PRD 落 **企业记忆层 = ①经验/决策→结构化案例库(CBR)·②确定性相似场景检索·③确定性决策模式挖掘·④反馈学习闭环(接现校准·不自改真值)·⑤跨会话记忆(深化 G-3b)**。**RL/GNN（Ch11.6/11.15）离线可插拔·CI 确定性兜底·绝不进热路径随机**；自动 Rule/Skill 生成（Ch11.10/11.12）只做**候选浮现 → 人工闸/GrowthTicket**（Ch11.11 验证门），不自动上线。

---

## §0 本体引用与影响（铁律 0·强制）

> 本节先行（产出任何架构/PRD 前必读本体）。检索走克隆索引 `docs/ontology/INDEX.md`（层 1 路由 → 只读切片）；母体 `docs/SYSTEM-ONTOLOGY.md` 是唯一真相源 + 回写目标。改接线改母体、再 `node scripts/build-ontology-slices.mjs` 同步（门 `ontology-slices:check` 守漂移）。

### 0.1 对象类型（§2.H 交互编排域 / §2.E 求解推演域）
- **复用（现存·不重造）**：
  - **`ExperienceCase`（经验记忆库·含 OBSERVED 观察记忆写侧）**——`02-object-types.md:98` = `persistence/repos.ts:71` `ExperienceCaseRow`；读侧内置工具 `search_experience`（`tools/executor.ts:445`·pseudoEmbed 余弦·出厂 50 例 `origin:SEED`）；写侧 `orchestrator.recordExperience`（`:1338`·终态蒸馏 `origin:OBSERVED` 路径提示）。**L1.5 的检索层直接扩此机器**（Tier-1 路径提示不动·Tier-2 加结构化案例）。
  - **`Decision`（一等决策记录·问责+组织学习）**——`02-object-types.md:58` = 契约 `packages/contracts/src/decision.ts:67` `DecisionSchema`·服务 `apps/datacore/src/decisions.ts:21` `DecisionService`·`repos.decisions`（migration029 doc-table）。字段天然是**一条 CBR 案例**：问题特征(`title`/`context`) + 决策(`options`/`chosen`/`rejectedRationale`/`predictedOutcome`) + 结果(`realizedOutcome`·预测 vs 实现)。**L1.5 的案例库以 `Decision` 记录为一等真实来源**（真实累积·非合成）。
  - **`Calibration{Pairs,Proposals,History,Forecasts,Convergence}`（M11 校准引擎·EMA/重放归因/分位）**——`02-object-types.md:71` = `apps/datacore/src/calibration/`。`CalibrationProposalRecord`（`domain.ts:941`）**即现成的"自适应提案(AdaptationProposal)"**：`{parameter,paramPath,currentValue,proposedValue,basis,trigger,status(PENDING|APPLIED|ROLLED_BACK|REJECTED|HOLD),method,evidence,realizedMape…}`；回测门 `replayPairs`（`calibration/replay.ts:113`·仿真重放校验改进）= **Ch11.11 Rule Validation（Simulation Test/Historical Replay）已落地**；应用经 Action R4（`校准参数变更` Action·`autoApply` 默认 `false`·`calibration/config.ts:14`）。**L1.5 的反馈→调参闭环 100% 复用此引擎·不新造调参器**。
  - **`SolverParam/SolverParamsHistory`（版本化·校准可改）** `02-object-types.md:68`·`SolverExperiment/ExperimentArm`（冠军-挑战者 A/B·`02:47`·"改了参数怎么知道更好"的受控实验·L1.5 反馈闭环的正交证据面）·**`GrowthTicket`**（`contracts/growth.ts:180`·NEEDS_HUMAN 施工契约·规则发现的落点）。
- **拟立（落地回写母体 §2.H / §2.E）**：
  - **`DecisionCase`（决策案例·咨询性派生 index·AgentCore）**：结构化案例 = `{caseId, tenantId, source(DECISION|AGENT_TERMINAL|DECISION_PACKAGE|SEED), sourceRefId, problem{title,context,features[]}, decision{options,chosen,rejectedRationale}, predicted, realized?, quality?, embedding, provenance, origin(SEED|LEARNED)}`。**咨询性派生**（类比 `RequirementGraph`·可 drop 重生·从 `Decision` 记录 + 任务史重建）→ 关闸=空表·回退无业务真值损失。R2 tenant 随身·R13 溯源（`sourceRefId`→真 `Decision.id`/`taskId`）。
  - **`DecisionPattern`（决策模式·咨询性·确定性挖掘产物）**：`{patternId, tenantId, condition(特征桶), recommendedAction, support(命中案例数), confidence(众数占比), exampleCaseIds[]}`（Ch11.8 结构）。**咨询·非规则**（不自动裁决）——达阈值可**浮现为 `GrowthTicket` 候选**（人工闸·Ch11.11）。
  - **`FeedbackSignal`（反馈信号·归一化·瞬态/可派生）**：`{signalId, tenantId, kind(OUTCOME_DELTA|VOTE|CASE_REUSE), sourceRefId, metricDeltas?, verdict?, at}`——把三类现有反馈（`Decision.realizedOutcome` 预测vs实现 / agent 投票 `fallbackTraces.setFeedback` `repos.ts:195` / 案例复用命中）归一为**校准触发信号**。
  - **`AdaptationProposal` = 复用 `CalibrationProposalRecord`（不新立对象）**——契约层给一个 `AdaptationProposal` **别名/子集视图**（`CalibrationProposalRecord` 的跨包投影·§3），语义统一但落库仍是校准提案（守单一来源·不双写）。
  - 均 R2 带 tenantId、R6 确定性派生、R13 可溯源。

### 0.2 链路（§3 关系图 / §10.3 问句到答案链）
- 中枢链 `sys.orch.query_to_answer`（`10-self-domains.md:49`）：`Client→Query→Intent→Plan→Step*→{Solver｜Slice｜Rule}→AnswerBlock→SSE`。L1.5 在 **path B agent 的"探索前"** additive 插入「**先查案例库**」检索节点（与现「先查经验库」`agents/universal.ts:28` **并列**·`retrieve_similar_cases` 旁 `search_experience`）——**不改路由判决**（agent 循环内的读工具·消费态）。
- **新增旁路①（案例摄取·additive·观察态）**：任务达终态（决策承载答案）+ `Decision.recorded`/`Decision.outcome_recorded` 事件 → 结构化投影为 `DecisionCase` 落 AgentCore 案例 index。**回写**：§3 登记「决策→案例摄取链」。
- **新增旁路②（决策学习闭环·additive）**：`Decision.outcome_recorded`（预测vs实现偏差）→ `FeedbackSignal` → **现校准 `onCalibrationRequired`（`calibration/service.ts:283`）触发**→ `CalibrationProposalRecord`(PENDING) → **Action R4 审批**（`校准参数变更`·`app.ts:4243`）→ `mutateParams`（`solvers/service.ts:1616`·version+1）→ 下轮 `capacity_forecast` 用新参 → `calibration.convergence` 越用越准。**回写**：§3 登记「案例→反馈→校准调参」学习闭环链（判决地位不变·参数变更始终经 R4）。
- **判决地位不换手**：classify/proceedWithIntent/runPathA/runPathB **逐字节不变**（关闸可证）；案例检索是**咨询读**、案例摄取是**旁写**、调参是**现校准 R4 路径**——L1.5 全程零改现有裁决口。

### 0.3 事件（§4 数据流事件图）
- **复用（零新 SSE 事件名·守 QOS-PRD §8.2 一字不差）**：agent 检索案例复用现 `step.*` 伪步帧（`{stepId,type,outcome?,durationMs?}`）；沿 `experience.distilled`（`04-dataflow.md:87` L-mem·SSE·`orchestrator.ts:1385`）范式。
- **复用（现有域事件·驱动闭环）**：`decision.recorded`/`decision.outcome_recorded`（`04-dataflow.md:35-36` L5·`decisions.ts:63/104`）· `calibration.applied`（L6·`event-subscriptions.ts:53`→失效 `calibration-report`/`solver-params`）· `calibration.swept`（L6b）· `calibration.proposed`/`calibration.rolled_back`（F1 失效表）。
- **新增域事件（非 SSE·跨会话·经 outbox·additive）**：`decision_case.learned`（案例摄取落库后发·载 `{caseId,source,sourceRefId}`·**不含业务数字**）· 可选 `decision_pattern.mined`（模式挖掘批次）。**必须**在 `EVENT_SUBSCRIPTIONS`（`agentcore/src/event-subscriptions.ts:28`）登一行（D-29·消费者=案例面失效）——否则守门失。**回写**：§4 登记这两条（与 `experience.distilled` 并列）。

### 0.4 不变量（§5·改动不可违反）
- **R6 确定性（`05-invariants.md:20`·检测点 `freezePlan`）——本 PRD 头号铁律**：
  - **检索纯函数**：同 (query, 案例集快照, 权重版本) → **字节级同命中序**（pseudoEmbed 余弦 + 确定性场景/业务维·`util/embedding.ts:22` 已 R6·无 `Date.now`/随机/LLM 热路径）。
  - **特征抽取/模式挖掘纯函数**：同 `Decision` → 同 `CaseFeature[]`；同案例集 → 同 `DecisionPattern[]`（频次计数·稳定排序·`caseId` 决胜）。
  - **RL/GNN 离线·可插拔·CI 兜底**：`CaseEmbeddingProvider`/`CaseReranker` 接口，**默认 = pseudoEmbed / identity 重排**（R6）；离线 GNN 嵌入/RL 重排是**可换装的离线制品**（`QOS_CBR_RERANK` gated·失败/未装配回退确定性）——**绝不进热路径随机**（对齐 `QOS_MEMORY_LLM` gated 范式 `config.ts:37`、校准 seeded-MC 范式 `replay.ts:122`）。
  - 调参决策/回测 MAPE 恒经现校准确定性数学（`calibration/methods.ts`·sim-clock 非墙钟·`pairing.ts:23`）。
- **R1 contracts-only（`05:15`）**：`Case`/`CaseFeature`/`SimilarityQuery`/`FeedbackSignal`/`AdaptationProposal` 全进 `@platform/contracts`（新文件 `cbr.ts`·因跨 A/B 边界·`ExperienceCaseRow` 那种 B-only 内联 TS 不适用）；前端/跨包不重定义。
- **R2 tenant everywhere（`05:16`）**：案例/模式/信号读写全带 tenantId；跨租户读案例 → 404（`FEATURE_NOT_FOUND` 先于 authz 时更早）。
- **R4 真值写入经 Action 审批（`05:18`）·本 PRD 关键红线**：**任何求解器参数/规则变更绝不无人值守自改真值**——`AdaptationProposal` 恒 PENDING、经 `校准参数变更` Action R4 审批 EXECUTED 才落（`autoApply` 默认 `false` 不动）；规则发现只出 `GrowthTicket`（NEEDS_HUMAN）。案例/模式是**咨询派生非业务真值**。
- **R6/KILL-MOCK-RED 诚实边界**：案例里的数字**永不冒充已核验业务真值**（沿 `OBSERVED_DISCLAIMER` `repos.ts:100` 单一来源·检索每条+顶层带免责）；**出厂 SEED 案例诚实标 `origin:SEED`·真确定性派生·绝不合成冒充真实累积**（抄 `seedDemoCalibrationConvergence` 真引擎产物范式·`02-object-types.md:71`·废弃"手绘冒充真值"红线）。
- **R9 仓储双实现（`05:23`）**：AgentCore `decision_cases` 表**四处同改**（`persistence/repos.ts` 接口 + `memory.ts` + `pg.ts`[JSONB doc 列] + `migrations/014_decision_cases.sql`）。反馈闭环不新建 datacore 表（复用校准表）。
- **R10 / D-29（`05:24`）**：新域事件 `decision_case.learned` 必进 `EVENT_SUBSCRIPTIONS`。
- **R13 溯源（`05:27`）**：案例带 `provenance`/`sourceRefId`（→真 `Decision.id`/`taskId`）；答案数字仍走 `⟦ref⟧`（案例只作路径/方案参考·不作数字来源）。
- **R16 发育闭环（`05:32`）**：企业记忆是"越用越大"的一相——案例累积/模式浮现喂 `GrowthTicket`（倒序发育信号）；区别于 R16 能力发育（本层是**决策认知**积累·非对象/规则生长）。
- **发布律·十红线**：RL2 暗发（`memory.cbr` `defaultOn:false`·关=404）· RL6 确定性 · RL9 additive 可回退（契约字段全 optional·migration 带 down·**旧 `search_experience`/`recordExperience`/校准路径永不删**）· RL10 不与在建分叉（复用经验机器 + 校准引擎·不平行造第二套记忆/调参）。

### 0.5 断点（§8 断点登记）
- **G-3b（`08-breakpoints.md:18`·本 PRD 主治·深化非重开）**：G-3b 原文=`agt_universal` 无跨会话记忆；已 **✅ 闭写侧**（WO-B AGENT-OBSERVATIONAL-MEMORY·OBSERVED 路径提示蒸馏）。**诚实定位**：现闭合是**"路径提示"保真度**（工具序列 `toolPath` + 结论首段），**非结构化决策案例**——同域问题能借"走过哪些工具"，但**借不到"面对什么问题→在哪些方案里选了谁→预测vs实现如何"的结构化决策经验**，也无跨决策复用与结果学习闭环。**L1.5 深化 G-3b**：路径提示(Tier-1·`ExperienceCase`) → **结构化案例(Tier-2·`DecisionCase`：问题特征+决策+结果)** + 跨决策相似检索复用 + 结果→校准学习闭环。**回写（不撤 ✅）**：在 G-3b 行**追加**「read/write 双侧已深化至结构化 CBR + 决策学习闭环（L1.5）」，不改其已闭状态。
- **G-RET（增长表留存·参照）**：`decision_cases` 与 `experience_cases` 同为 append 型增长表 → 归 G-RET 哲学（upsert-by-caseId 天然去重·不逐任务累积；硬留存扫比照 datacore `RETENTION_SWEEP` 登记·本 PRD 不新建 agentcore sweep）。
- **衔接 G-1/G-3/G-4**（预诊断/场景启动/入口收口）：案例检索为统一入口提供**历史决策记忆层**·强化倒推②精度（DESIGN §8「②倒推精度」映射·`DESIGN-decision-os-complete-upgrade.md:101`）；判决口不动。

### 0.6 门禁（§7）
- 新增 `decision-case:check`（`scripts/check-decision-case.mjs`·并入 `pnpm gates`·登母体 §7·遵 `<name>:check` 范式 `07-gates.md`）：静态+teeth 守 ① 案例特征键 ∈ 真实注册表（problemClass ∈ `INTENT_PROBLEM_CLASS`/solverKey ∈ `SOLVER_REGISTRY`/ontologyType ∈ 已发布类型·**零幽灵特征**·复用 `chain:check` 同源白名单）② 检索确定性（同 query 双跑同命中序·**改随机/时钟源即红**）③ 模式挖掘确定性 ④ **SEED 案例带 `origin:SEED` 标**（green→red：植入无标/合成冒充真实累积的案例 → 门红·KILL-MOCK-RED）⑤ 契约漂移守 ⑥ **RL/GNN provider 关=确定性兜底**（未装配离线制品时命中序=纯 pseudoEmbed·CI 不变）。

---

## §1 目标 / 非目标

### 1.1 目标（G）
- **G1 · 经验/决策→结构化案例库（CBR·Ch11.1-11.4）**：确定性把 `Decision` 记录（+ agent 终态决策 + L2 `DecisionPackage`）投影为 `DecisionCase`（问题特征 + 决策 + 结果），落 AgentCore 案例 index（咨询派生·可重建）。**真实累积**（源=真 `Decision`）·出厂 SEED 诚实标。
- **G2 · 确定性相似场景检索（Similar Scenario·Ch11.7）**：`retrieveSimilarCases(query)` = **三维确定性相似**（Graph/文本 Embedding 相似 pseudoEmbed 余弦 ⊕ Scenario 相似 problemClass/intentKey 分类匹配 ⊕ Business 相似 base/model/segment/metric 特征匹配）→ 加权（定权版本·R6）→ topK 命中。喂新问句复用。
- **G3 · 确定性决策模式挖掘（Pattern Mining·Ch11.8/11.9）**：`mineDecisionPatterns(cases)` = 按 (problemClass + 特征桶) 分组 → 众数 chosen action + support/confidence → `DecisionPattern`（`condition→recommended_action`）。达阈值**浮现候选**（→ `GrowthTicket` 人工闸·Ch11.10/11.11·不自动上线）。
- **G4 · 反馈学习闭环（Human Feedback + Knowledge Evolution·Ch11.14/11.16·接现校准）**：`Decision.realizedOutcome`（预测vs实现）/ agent 投票 / 案例复用 → 归一 `FeedbackSignal` → **现校准触发**→ `AdaptationProposal`(=`CalibrationProposalRecord`·回测门·Action R4) → 调参真生效（下轮 MAPE 降·`calibration.convergence`）+ 案例 `quality` 更新。**绝不自改业务真值**。
- **G5 · 跨会话记忆·深化 G-3b（Ch11.13 Agent Learning Loop）**：`agt_universal` 探索前「先查案例库」（`retrieve_similar_cases` 旁 `search_experience`）→ 结构化决策经验跨会话可借（同域问题免从零决策）。
- **G6 · 确定性 + 可回退 + RL 离线可插拔**：R6 双跑字节一致；全程暗发·关闸=改造前系统 + 空表；RL/GNN 离线制品可换装·CI 确定性兜底。

### 1.2 非目标（NG·守边界·防膨胀）
- **NG1 · 不新造调参器 / 不改校准数学**：反馈→调参 100% 复用 `calibration/`（EMA/重放/分位 + Action R4 + 回测门）；L1.5 只**新增触发信号源**（决策结果/投票/复用），不动校准算法、不绕 R4。
- **NG2 · 不自动上线规则/技能（守 R4/Ch11.11）**：Rule Discovery（Ch11.10）/ Skill Learning（Ch11.12）只做**确定性候选浮现 → `GrowthTicket`（NEEDS_HUMAN）/ 校准提案（Action R4）**；绝不 AI 直接生成生产规则/技能。
- **NG3 · 不引 GNN/RL/向量库进热路径**：热路径检索=确定性 pseudoEmbed（`util/embedding.ts`）+ 分类/特征匹配；GraphSAGE/R-GCN/Temporal GNN（Ch11.6）与 RL 奖励模型（Ch11.15）=**离线可插拔占位**（接口 + CI 确定性兜底）·非本 PRD 实现体（母体分歧登记：向量库/GNN=DEFER·`PRD-L1A §NG5`）。
- **NG4 · 不重造经验记忆 / 不双写决策真值**：Tier-1 `ExperienceCase`/`search_experience`（路径提示）**原样保留**；`DecisionCase` 是**其上的结构化派生 index**（不迁移、不替换）。`Decision` 真值单一来源在 datacore（案例 index 只读投影·可 drop 重建）。
- **NG5 · additive 铁律·不改判决**：classify/proceedWithIntent/runPathA/runPathB/校准 R4 判决地位**逐字节不换手**；`memory.cbr`/`QOS_CBR_*` 全关 = 改造前系统 + 休眠代码 + 空表。

---

## §2 与现系统接缝（file:line·复用/新增/暗发/回退）

### 2.1 检索侧接缝（`retrieve_similar_cases` 旁 `search_experience`·Tier-2 旁 Tier-1·additive）
现读侧（path B agent·探索前先查经验库）：
```
agents/universal.ts:28  "0. 先查经验库：… search_experience …"
tools/registry.ts:204   search_experience（BUILTIN·READ·CHEAP）
tools/executor.ts:445   searchExperience(query,topK) → repos.experience.listByTenant → pseudoEmbed 余弦
```
**接缝**：新增内置读工具 `retrieve_similar_cases`（`registry.ts` 追一条·READ·CHEAP·`defaultOn` 由 `memory.cbr` 治），executor 分派（`executor.ts` `switch` 追一 case·§4.3）；`agt_universal` systemPrompt 第 0 步扩为「先查**经验/案例**库」（`search_experience` 取路径提示 ⊕ `retrieve_similar_cases` 取结构化决策案例·**并列·additive**）。关 `QOS_CBR_RETRIEVAL`/`memory.cbr` → 工具不注册/404 → agent 行为 = 仅路径提示（改造前·回退杠杆①）。

### 2.2 案例存储接缝（AgentCore 案例 index·镜像 `experience` repo 双实现）
镜像现 `experience` 仓储（**R9 四处同改**）：
| 现 `experience`（模板） | 新 `decisionCases` |
|---|---|
| 接口 `repos.ts:289` `experience:{upsert,listByTenant}` | `decisionCases:{upsert,get,listByTenant,listBySource?}` |
| 行 `repos.ts:71` `ExperienceCaseRow`（内联 TS） | 契约 `DecisionCase`（`@platform/contracts/cbr.ts`·跨 A/B 边界·R1） |
| memory `memory.ts:410`（Map·clone-on-read） | 同法新 Map |
| pg `pg.ts:478`（`INSERT … doc JSONB … ON CONFLICT`） | 同法·JSONB doc 列 |
| migration `agentcore/migrations/004_experience_cases.sql` | `agentcore/migrations/014_decision_cases.sql`（doc 列 + `idx_..._tenant`·`-- down:` drop） |
- **咨询派生·可重建**：案例 index 可从 datacore `Decision` 记录 + 任务史**确定性重放重建**（rebuild 端点 admin·§5）→ migration down/空表零业务损失。

### 2.3 摄取侧接缝（`DecisionArtifact` 端口·三源·L2 抽象衔接）
统一摄取端口（纯函数投影·R6）：
```ts
// growth/decision-case.ts（新·纯函数·无 IO 除本体读）
interface DecisionArtifact {                     // L2 抽象衔接点（今三源实现·L2 DecisionPackage 插同口）
  source: "DECISION" | "AGENT_TERMINAL" | "DECISION_PACKAGE";
  refId: string; title: string; context: string;
  options: {key,label}[]; chosen: string; rejectedRationale?: {optionKey,rationale}[];
  predicted?: {summary,metrics?}; realized?: {summary,metrics?};
  ctx?: { taskId?; intentKey?; problemClass?; entities?; requirementGraphId? };  // L1-A/B 结构化上下文（有则用·无则退纯文本）
}
projectCase(a: DecisionArtifact): DecisionCase   // 特征抽取 + pseudoEmbed → 案例
```
三源接线（暗发 `QOS_CBR_INGEST`）：
1. **`DECISION`（真实主源）**：datacore 发 `decision.recorded`/`decision.outcome_recorded`（`decisions.ts:63/104`）→ AgentCore 经 **B→A OBO 读** `GET /a/v1/decisions/:id`（新 `HttpDecisionClient`·`tools/datacore-http.ts:348` 工厂加一客户端·`call()` 模板 `:26`）→ `projectCase` → `decisionCases.upsert` → 发 `decision_case.learned`。**或**启动/定时 **backfill** 全量 `GET /a/v1/decisions`。
2. **`AGENT_TERMINAL`（agent 决策）**：扩 `orchestrator.recordExperience`（`:1338`）——在写 `ExperienceCase`(OBSERVED) **之后**，若答案含决策承载（action_draft/多方案对比）additive 再投影一条 `DecisionCase`（`source:AGENT_TERMINAL`·`provenance=taskId`）。**不改现 OBSERVED 写**（并列）。
3. **`DECISION_PACKAGE`（L2·抽象·待 L2 落地）**：L2 产 `DecisionPackage` 时映射 `DecisionArtifact` 插同口（本 PRD 只定端口·不实现 L2）。
- 关 `QOS_CBR_INGEST` → 不摄取（案例 index 空·agent 仅路径提示·回退杠杆②）。

### 2.4 反馈→调参接缝（复用现校准·Action R4·不新造）
现校准闭环（**完整已在·L1.5 只加信号源**）：
```
calibration/pairing.ts:32  runPairing（predicted vs actual A8 聚合配对）
calibration/service.ts:283 onCalibrationRequired（RULE_SCAN C12 钩·app.ts:397）
calibration/service.ts:291 generateForSlice → methods.ts（EMA/分位/重放）→ 回测门 replay.ts:113
calibration/service.ts:580 buildRecord → CalibrationProposalRecord(PENDING)
app.ts:4243 POST /a/v1/calibration/proposals/:id/approve → 校准参数变更 Action（R4·202）
app.ts:443  Action EXECUTED → CalibrationService.applyAction → performApply → solvers.setParam/mutateParams(:1616·version+1)
calibration/service.ts:798 runMetaLoop（realizedMape 回写·越用越准）
```
**接缝（additive·新信号源→现触发口）**：
- `Decision.outcome_recorded`（预测vs实现·天然反馈）→ 归一 `FeedbackSignal(kind:OUTCOME_DELTA)` → 经 **B→A OBO 写** `POST /a/v1/calibration/feedback`（**新端点**·把决策结果偏差登记为额外校准触发·内部转 `onCalibrationRequired`）·或 datacore 侧直接订阅 `decision.outcome_recorded` 触发（更省一跳·优选）。
- agent 投票 `fallbackTraces.setFeedback`（`repos.ts:195`·`feedback.recorded` 事件）→ `FeedbackSignal(kind:VOTE)` → 更新案例 `quality`（不直接调参·投票是软信号）。
- **提案应用不变**：始终经 `校准参数变更` Action R4（`autoApply` 默认 `false` 不动）→ **不自改真值**（R4）。`calibration.applied` 事件已失效 `solver-params`（`event-subscriptions.ts:53`）→ 下轮 forecast 用新参。

### 2.5 复用清单（不重造·file:line）
| 能力 | 复用的现有制品 | 锚点 |
|---|---|---|
| 确定性伪嵌入 / 余弦 / 质心 | `pseudoEmbed` · `cosine` · `centroid`（FNV-1a·L2 归一·R6） | `agentcore/src/util/embedding.ts:22/39/56` |
| 经验检索机器（Tier-1 保留） | `searchExperience` · `search_experience` 工具 · systemPrompt 先查经验库 | `tools/executor.ts:445` · `tools/registry.ts:204` · `agents/universal.ts:28` |
| 经验写侧 / 终态蒸馏（扩点） | `recordExperience`（OBSERVED·`provenance=taskId`·`stripRefMarks`） | `router/orchestrator.ts:1338` |
| 诚实边界免责（单一来源） | `OBSERVED_DISCLAIMER`「仅供路径参考·业务事实以工具结果为准」 | `persistence/repos.ts:100` |
| **决策记录（案例真实主源）** | `DecisionService`(create/list/get/recordOutcome) · `DecisionSchema`(问题+方案+预测+实现) | `datacore/src/decisions.ts:21` · `contracts/decision.ts:67` |
| **反馈→调参引擎（全套·不重造）** | `CalibrationService`(pairing/generate/回测/apply/metaLoop) · `CalibrationProposalRecord` · Action R4 `校准参数变更` | `datacore/src/calibration/*` · `domain.ts:941` · `battery.ts:1340`/`app.ts:4243` |
| 回测门（=Ch11.11 验证） | `replayPairs`（仿真重放校验改进 ≥ minImprovementPct·确定性 seeded-MC） | `calibration/replay.ts:113` · `:122` |
| 参数版本化（单写通道） | `mutateParams`/`setParam`/`paramsVersion`（version+1·history 快照） | `solvers/service.ts:1616/1646/1600` |
| 冠军-挑战者 A/B（正交证据面） | `SolverExperiment`/`ExperimentArm`（确定性分流·参数版本 A/B） | `02-object-types.md:47` |
| 规则发现落点（NEEDS_HUMAN） | `GrowthTicket` · `gapDisposition`(AUTO_DERIVE/NEEDS_HUMAN 二分) | `contracts/growth.ts:180` · `growth/probe.ts:76` |
| B→A OBO 读写（案例源/反馈写） | `datacore-http.ts call<T>`（Bearer OBO/x-debug-user）· `createHttpDataCore` 工厂 | `tools/datacore-http.ts:26/348` |
| B→A 服务态缓存 + 失效（可选） | `DataCoreProviderDirectory getCached`(TTL60s) · `POST /b/v1/internal/invalidate` | `llm/datacore-directory.ts:53` · `server.ts:2124` |
| 域事件 / SSE 事件 | `emitDomainEvent`（outbox·跨会话）· `events.emit`（SSE 步帧）· `EVENT_SUBSCRIPTIONS` | `server.ts:199` · `events.ts:13` · `event-subscriptions.ts:28` |
| 出厂种子诚实范式（SEED 非冒充） | `seedDemoCalibrationConvergence`（真引擎产物·非手绘·自曝检验） · 经验 50 例 `SCENE_APPROACH`/`EXPERIENCE_VARIANTS` | `02-object-types.md:71` · `mocks/seed.ts:1478/1488` |
| feature 双注册 / 404 门 | datacore `features.ts` FEATURE_REGISTRY · agentcore `features/registry.ts`(未注册键陷阱) · `FeatureGate.isEnabled` | `datacore/features.ts:13/330` · `agentcore/features/registry.ts:9/150` · `features/gate.ts:106` |

### 2.6 新增清单
- **契约**（`@platform/contracts`·R1）：新文件 `packages/contracts/src/cbr.ts`（§3 全 schema·模板 `decision.ts`）+ `index.ts` 末尾追 `export * from "./cbr.js"`。
- **案例层**（AgentCore）：`growth/decision-case.ts`（纯函数 `projectCase`/`extractFeatures`/`retrieveSimilarCases`/`mineDecisionPatterns`·§4）；`persistence/{repos.ts,memory.ts,pg.ts}` 加 `decisionCases`（R9 四处·`migrations/014_decision_cases.sql`）；`tools/{registry.ts,executor.ts}` 加 `retrieve_similar_cases` 工具；`router/orchestrator.ts:1338` 扩 agent 终态投影（additive）；`agents/universal.ts:28` 扩「先查案例库」。
- **B→A 客户端**（AgentCore）：`tools/datacore-http.ts` 加 `HttpDecisionClient`（`GET /a/v1/decisions{,/:id}`）+ 反馈写（`POST /a/v1/calibration/feedback`·若走 B→A）。
- **反馈端点/触发**（DataCore·优选 datacore 侧就近）：`decisions.ts`/`calibration/service.ts` 订阅 `decision.outcome_recorded` → `onCalibrationRequired`（额外触发·`app.ts:397` 钩范式）；`POST /a/v1/calibration/feedback`（可选·登记外部反馈信号·catalog_admin/service）。**校准应用路径零改**。
- **端点**（AgentCore·暗发 `memory.cbr` 门·经 nginx `/b/v1`）：`GET /b/v1/memory/cases/similar?q=&topK=`（读检索·404 若关/跨租户）· `GET /b/v1/memory/cases/:id`（读单案例·R13 溯源）· `GET /b/v1/memory/patterns`（读挖掘模式）· `POST /b/v1/memory/cases/rebuild`（admin·从 datacore Decision 重建 index·回退演练用）。
- **配置**（AgentCore `config.ts`·暗发·对齐 `QOS_MEMORY_LLM` 范式 `:37`）：`QOS_CBR_INGEST`（`=1` 摄取）· `QOS_CBR_RETRIEVAL`（`=1` 检索工具）· `QOS_CBR_RERANK`（离线重排装配·默认关=identity·R6 兜底）。
- **门**：`scripts/check-decision-case.mjs` → `decision-case:check`（§0.6）并入 `pnpm gates`。

### 2.7 暗发 feature key（双闸·对齐两系统暗发范式）
- **`memory.cbr`（用户面 entitlement·per-tenant·`defaultOn:false`·本 PRD 主键）**——控**案例读端点/检索工具是否存在**（关=404 `FEATURE_NOT_FOUND`·先于 authz·R3）。**双注册**：**权威** datacore `features.ts:13`（`{key:"memory.cbr",name:"企业记忆·案例推理",level:"BLOCK",defaultOn:false}`·对齐 `growth.pre_analysis` `:113`）+ **镜像** agentcore `features/registry.ts:9`（同键同 `defaultOn:false`·**防"未注册键恒 true"陷阱** `registry.ts:150`）。可选 `memory.pattern_mining` 同法（治模式面）。
- **内部算法闸（env·进程级·deploy 控制）**：`QOS_CBR_INGEST`/`QOS_CBR_RETRIEVAL`/`QOS_CBR_RERANK`（`=1` 开）——控摄取/检索/离线重排。关=内部行为回旧路（对齐 `QOS_CLASSIFY_FUSE`/`QOS_MEMORY_LLM` 内部切换范式）。
- **回退杠杆（§9 详列）**：关 `QOS_CBR_RETRIEVAL`→agent 仅路径提示；关 `QOS_CBR_INGEST`→案例 index 空；关 `memory.cbr`→读端点 404；关 `QOS_CBR_RERANK`→纯 pseudoEmbed 确定性命中；migration 014 down→drop `decision_cases`（咨询派生·业务真值零损）；**校准 `autoApply` 恒 false 不动·提案永经 R4**。

---

## §3 统一数据模型（zod 契约草案·`packages/contracts/src/cbr.ts`）

> 设计：**案例 `DecisionCase`（结构化 CBR 案例·咨询派生）** + **检索 `SimilarityQuery`/`SimilarityHit`** + **反馈 `FeedbackSignal`** + **模式 `DecisionPattern`** + **自适应提案 `AdaptationProposal`（= `CalibrationProposalRecord` 的跨包投影·不双写落库）**。全 R6（`generatedAt`/`weightsVersion` 注入·内部不取时钟）、R13（`provenance`/`sourceRefId`）、R14 抽象（problemClass/ontologyType/roleType 是键·非「常州」/「NCM4680」字面量）。模板 = `decision.ts`（id 前缀注释 + `tenantId: z.string() // R2` + `z.infer` 紧随）。

```ts
import { z } from "zod";

// ── 案例特征（问题特征·确定性抽取·相似检索维度）─────────────────────────
export const CaseFeatureSchema = z.object({
  /** 特征维度：problem_class/scenario/entity/metric/constraint/action_type/temporal（Ch11.5 Node/Edge/Temporal Feature 的确定性投影）。 */
  dim: z.enum(["PROBLEM_CLASS", "SCENARIO", "ENTITY", "METRIC", "CONSTRAINT", "ACTION_TYPE", "TEMPORAL"]),
  /** 归一化键（R14 抽象·∈ 真实注册表：problemClass ∈ INTENT_PROBLEM_CLASS / ontologyType ∈ 已发布类型）。 */
  key: z.string(),
  /** 展示值（R13·保留原文·如 "常州基地"；不参与 R6 哈希外的判定）。 */
  value: z.string().nullable().default(null),
  /** 数值特征（可比·如 capacity_gap=0.12·用于模式挖掘特征桶）。 */
  num: z.number().nullable().default(null),
});
export type CaseFeature = z.infer<typeof CaseFeatureSchema>;

// ── 决策案例（Ch11.4 decision_history + graph_learning_sample 合并·咨询派生）──
export const DecisionCaseSourceSchema = z.enum(["DECISION", "AGENT_TERMINAL", "DECISION_PACKAGE", "SEED"]);
export const DecisionCaseSchema = z.object({
  caseId: z.string(),                                 // case_
  tenantId: z.string(),                               // R2 租户隔离
  source: DecisionCaseSourceSchema,
  /** R13 溯源：真 Decision.id / taskId / packageId（SEED 为确定性种子键）。 */
  sourceRefId: z.string(),
  /** 出厂 SEED vs 运行积累 LEARNED（诚实位·SEED 绝不冒充真实累积·KILL-MOCK-RED）。 */
  origin: z.enum(["SEED", "LEARNED"]),
  // 问题特征（Ch11.4 question / input_graph）
  problem: z.object({
    title: z.string(),
    context: z.string(),                              // 源 Decision.context（自由文本·退化特征源）
    problemClass: z.string().nullable(),              // ∈ INTENT_PROBLEM_CLASS（有 L1-A 上下文时填）
    features: z.array(CaseFeatureSchema).default([]),
  }),
  // 决策（Ch11.4 solution / output_decision）
  decision: z.object({
    options: z.array(z.object({ key: z.string(), label: z.string() })).default([]),
    chosen: z.string().nullable(),
    rejectedRationale: z.array(z.object({ optionKey: z.string(), rationale: z.string() })).default([]),
  }),
  predicted: z.object({ summary: z.string(), metrics: z.record(z.string(), z.number()).optional() }).nullable().default(null),
  /** 结果（后填·Ch11.4 feedback / quality_score 的事实侧·预测vs实现）。 */
  realized: z.object({ summary: z.string(), metrics: z.record(z.string(), z.number()).optional(), recordedAt: z.string() }).nullable().default(null),
  /** 案例质量（Ch11.4 quality_score·由反馈派生·0-1·预测vs实现吻合度 + 复用/投票·R6 确定性公式）。 */
  quality: z.number().min(0).max(1).nullable().default(null),
  /** pseudoEmbed(problem.title + context + features 键)（默认确定性·可换离线嵌入·R6 兜底）。 */
  embedding: z.array(z.number()),
  /** 免责（沿 OBSERVED_DISCLAIMER 单一来源·案例数字不冒充业务真值）。 */
  disclaimer: z.string(),
  provenance: z.string(),                             // = sourceRefId（可回溯 Decision/tool_calls 审计）
  weightsVersion: z.string(),                         // 特征/嵌入口径版本（R6 可重放）
  createdAt: z.string(),                              // 调用方注入（内部不取时钟·R6）
  updatedAt: z.string(),
});
export type DecisionCase = z.infer<typeof DecisionCaseSchema>;

// ── 相似检索（Ch11.7 Similar Scenario Retrieval·三维确定性）────────────────
export const SimilarityQuerySchema = z.object({
  tenantId: z.string(),
  /** 新问句/新问题文本（喂 pseudoEmbed）。 */
  text: z.string(),
  /** 可选结构化上下文（有则精化 Scenario/Business 维·无则纯 Embedding 维）。 */
  problemClass: z.string().nullable().default(null),
  entities: z.array(z.string()).default([]),          // 已解析本体键（base/model/segment…）
  metrics: z.array(z.string()).default([]),
  topK: z.number().int().min(1).max(20).default(5),
  /** 定权版本（R6·`w_embed:0.5,w_scenario:0.3,w_business:0.2` 之类·固定·非随机）。 */
  weightsVersion: z.string().default("v1"),
});
export type SimilarityQuery = z.infer<typeof SimilarityQuerySchema>;

export const SimilarityHitSchema = z.object({
  caseId: z.string(),
  /** 组合分（Ch11.7 = Embedding ⊕ Scenario ⊕ Business·加权·R6·四舍五入定精度）。 */
  score: z.number(),
  breakdown: z.object({ embed: z.number(), scenario: z.number(), business: z.number() }),
  origin: z.enum(["SEED", "LEARNED"]),                // 命中透 SEED/LEARNED（诚实位）
  provenance: z.string(),
  disclaimer: z.string(),                            // 每条随行免责
});
export type SimilarityHit = z.infer<typeof SimilarityHitSchema>;

// ── 反馈信号（Ch11.14 Human Feedback·三源归一·校准触发）────────────────────
export const FeedbackSignalSchema = z.object({
  signalId: z.string(),
  tenantId: z.string(),
  kind: z.enum(["OUTCOME_DELTA", "VOTE", "CASE_REUSE"]),
  /** 溯源：Decision.id（OUTCOME_DELTA）/ taskId（VOTE/CASE_REUSE）。 */
  sourceRefId: z.string(),
  /** 预测vs实现偏差（OUTCOME_DELTA·指标名→delta·喂校准触发·R6）。 */
  metricDeltas: z.record(z.string(), z.number()).optional(),
  verdict: z.enum(["UP", "DOWN", "REUSED", "REJECTED"]).nullable().default(null),
  at: z.string(),
});
export type FeedbackSignal = z.infer<typeof FeedbackSignalSchema>;

// ── 决策模式（Ch11.8 Decision Pattern·确定性挖掘·咨询非规则）──────────────
export const DecisionPatternSchema = z.object({
  patternId: z.string(),                              // pat_
  tenantId: z.string(),
  /** 条件（Ch11.8 condition·特征桶·如 {problemClass:"capacity_shortage", capacity_gap:">10%"}）。 */
  condition: z.record(z.string(), z.string()),
  recommendedAction: z.string(),                      // 众数 chosen action（∈ 真实 action_type/solverKey）
  support: z.number().int(),                          // 命中案例数
  confidence: z.number().min(0).max(1),               // 众数占比
  exampleCaseIds: z.array(z.string()).default([]),
  /** 达阈值浮现候选（→ GrowthTicket 人工闸·Ch11.10/11.11·不自动上线）。 */
  surfaced: z.boolean().default(false),
  weightsVersion: z.string(),
});
export type DecisionPattern = z.infer<typeof DecisionPatternSchema>;

// ── 自适应提案（= CalibrationProposalRecord 的跨包投影·不双写落库·单一来源在 datacore）──
export const AdaptationProposalSchema = z.object({
  proposalId: z.string(),                             // = CalibrationProposalRecord.id
  tenantId: z.string(),
  target: z.enum(["SOLVER_PARAM", "RULE_CANDIDATE"]), // 参数（走校准 R4）/ 规则候选（走 GrowthTicket）
  parameter: z.string().nullable(),                   // SOLVER_PARAM：paramPath
  currentValue: z.number().nullable().default(null),
  proposedValue: z.number().nullable().default(null),
  trigger: z.string(),                                // 触发信号（OUTCOME_DELTA/PATTERN/…）
  status: z.enum(["PENDING", "APPLIED", "ROLLED_BACK", "REJECTED", "HOLD"]),
  /** 回测证据（Ch11.11·= CalibrationEvidenceRecord·mapeBefore→simulatedMapeAfter）。 */
  evidence: z.object({ mapeBefore: z.number(), simulatedMapeAfter: z.number(), nPairs: z.number() }).nullable().default(null),
  ticketId: z.string().nullable().default(null),      // RULE_CANDIDATE → GrowthTicket.id
});
export type AdaptationProposal = z.infer<typeof AdaptationProposalSchema>;
```
> **单一来源纪律**：`AdaptationProposal` 是 datacore `CalibrationProposalRecord`（`domain.ts:941`）的**只读跨包投影**——L1.5 不新建提案表、不双写；SOLVER_PARAM 提案落库/审批/应用全在校准；RULE_CANDIDATE 落 `GrowthTicket`。契约在 `@platform/contracts` 供两系统消费（R1）。

---

## §4 关键算法（据 rge.txt Ch11 满配 + 确定性优先·纯函数除本体/校准读）

> **诚实分源（铁律 0.4）**：§4.1-4.4 的**结构与目标** = rge.txt **Ch11 满配**（`rge_clean.txt:4745-5147`：Embedding/Similar Scenario/Pattern Mining/Human Feedback/Knowledge Evolution）；但 Ch11 的**实现体是 GNN 嵌入(11.6)+RL 奖励(11.15)+AI 直接生成规则(11.10)**——本 PRD **按"确定性优先·R6"落地**：热路径用 pseudoEmbed + 分类/频次（非 GNN/RL），规则/技能生成降级为**候选浮现→人工闸**（Ch11.11 验证门·= 现校准回测），GNN/RL 为离线可插拔占位（§4.5·§10 诚实边界穷举 Ch11 有/无）。

### 4.1 案例结构化（`projectCase`·Ch11.1-11.5·纯函数·R6）
输入 `DecisionArtifact`（§2.3·三源），输出 `DecisionCase`：
1. **特征抽取 `extractFeatures`**（Ch11.5 Node/Edge/Temporal Feature 确定性投影）：从 `context`(自由文本) + `ctx`(L1-A/B 结构化上下文·有则用) 派生 `CaseFeature[]`——
   - `PROBLEM_CLASS`：`ctx.problemClass ?? problemClassForIntent(intent)`（∈ `INTENT_PROBLEM_CLASS`·`solver-coverage.ts`）；无则确定性关键词映射（复用 `deterministicMatchScore` 范式·`orchestrator.ts:291`）。
   - `ENTITY`：`ctx.entities` 或对 `context` 走**确定性实体解析阶梯**（复用 L1-A `fillSlots`/`resolveUniqueByName`·`slots.ts`·**no LLM/no network**·R6）→ ontologyType/objectId。
   - `METRIC`/`CONSTRAINT`/`ACTION_TYPE`/`TEMPORAL`：从 `predicted.metrics` 键、`options`/`chosen`、日期锚确定性抽取（保留原文·`num` 供特征桶）。
   - **零幽灵**：特征键恒 ∈ 真实注册表（门 `decision-case:check` 守）。
2. **嵌入**：`embedding = embeddingProvider(problem.title + context + 特征键连接)`（默认 `pseudoEmbed`·`util/embedding.ts:22`·R6；离线 provider 可换·§4.5）。
3. **免责/溯源**：`disclaimer = OBSERVED_DISCLAIMER`；`provenance = sourceRefId`；`origin = source===SEED?SEED:LEARNED`。
- **R6**：同 `DecisionArtifact` → 字节级同 `DecisionCase`（`createdAt`/`weightsVersion` 注入·无时钟/随机/LLM）。

### 4.2 确定性相似检索（`retrieveSimilarCases`·Ch11.7·三维·R6）
Ch11.7：`Similarity = Graph Embedding Similarity + Scenario Similarity + Business Similarity`。确定性实现：
```
qv = pseudoEmbed(query.text)                              // 文本/图嵌入维
for each case c in listByTenant(tenantId):                // R2
  embed    = cosine(qv, c.embedding)                       // ∈[0,1]·util/embedding.ts:39
  scenario = jaccard({query.problemClass} , {c.problemClass}) 归一（分类精确/近邻·确定性）
  business = jaccard(query.entities∪metrics , c 特征 ENTITY∪METRIC 键)   // 业务特征重叠
  score    = W.embed*embed + W.scenario*scenario + W.business*business    // W=weightsVersion 定权·R6
hits = sort by (score desc, caseId asc) 取 topK                            // caseId 决胜·稳定序
```
- 每条带 `breakdown`（三维分·R13 可当场亮出"为何相似"）+ `origin`(SEED/LEARNED) + `disclaimer`。
- **R6**：无随机/时钟/LLM；`weightsVersion` 钉权重版本 → 同 (query,案例集,权重版本) 双跑字节一致命中序。**离线重排（§4.5）关时命中序=纯上式**（CI 兜底）。

### 4.3 检索工具接线（`retrieve_similar_cases`·path B·消费态）
`registry.ts` 追一条内置读工具（READ·CHEAP·`memory.cbr` 治），`descriptionForLLM`：「案例库检索：按问题检索历史**结构化决策案例**（问题特征+备选+所选+否决理由+预测vs实现）；探索前调用借鉴过往决策；**结果仅供决策参考·业务数字仍须经工具溯源**。topK≤10」。executor 分派 `retrieveSimilarCases` → 返 `{hits:SimilarityHit[], total, disclaimer}`（形如 `searchExperience` `executor.ts:445`·每条+顶层免责）。`agt_universal` systemPrompt 第 0 步并列（`search_experience` 路径提示 ⊕ `retrieve_similar_cases` 结构化案例·明标 SEED 不引真值）。

### 4.4 反馈→调参闭环（`Knowledge Evolution`·Ch11.16·接现校准·不新造）
Ch11.16：`Decision Execution → Result Collection → Pattern Mining → Rule/Param Generation → Simulation Validation → Knowledge Base Update`。落地映射（**每段接现制品·零新调参器**）：
1. **Result Collection**：`Decision.recordOutcome`（`decisions.ts:87`·预测vs实现）→ `FeedbackSignal(OUTCOME_DELTA·metricDeltas)`。
2. **触发**：偏差 → 现校准 `onCalibrationRequired`（`service.ts:283`·今由 RULE_SCAN C12 触发·L1.5 加"决策结果偏差"为并列触发·datacore 订阅 `decision.outcome_recorded` 或 `POST /calibration/feedback`）。
3. **Param Generation**：现 `generateForSlice`（`service.ts:291`）EMA/分位/重放 → `CalibrationProposalRecord`(PENDING)。
4. **Simulation Validation（= Ch11.11）**：现回测门 `replayPairs`（`replay.ts:113`·仿真重放·改进 ≥ `minImprovementPct` 才过·确定性 seeded-MC）——**已是 Ch11.11 的 Simulation Test/Historical Replay**。
5. **Human Approval → Knowledge Base Update（Ch11.11·R4）**：`校准参数变更` Action R4 审批（`app.ts:4243`·`autoApply` 默认 false）→ `mutateParams`(version+1) → `calibration.applied` 失效 `solver-params` → 下轮 forecast 用新参 → `runMetaLoop`(realizedMape·越用越准)。
6. **模式挖掘 `mineDecisionPatterns`（Ch11.8/11.9·确定性·咨询）**：按 (problemClass + 数值特征分桶) 分组 → 每组众数 `chosen`/action + `support`/`confidence` → `DecisionPattern`。达阈值（如 support≥N ∧ confidence≥0.7·Ch11.17 锂电例"成功率 95%"精神）→ `surfaced=true` → **浮现为 `GrowthTicket`（RULE_CANDIDATE·NEEDS_HUMAN·Ch11.10 Rule Discovery + Ch11.11 验证）**——绝不自动生成生产规则（R4）。
- **案例质量回填**：`quality` = f(预测vs实现吻合度, 复用命中, 投票)（R6 确定性公式）→ 影响检索排序（高质量案例优先·非随机）。

### 4.5 RL/GNN 离线可插拔（Ch11.6/11.15·占位·CI 确定性兜底·绝不进热路径随机）
- **接口**：`CaseEmbeddingProvider{ embed(text):number[] }`（默认 `pseudoEmbed`）· `CaseReranker{ rerank(hits, query):SimilarityHit[] }`（默认 identity）。
- **离线制品**：GNN 图嵌入（Ch11.6 GraphSAGE/R-GCN/Temporal GNN）/ RL 奖励重排（Ch11.15 `Reward=0.4·Delivery+0.3·Cost+0.2·Carbon+0.1·Stability`）**离线批算**（喂历史案例·产静态权重/重排表）→ 装配为 provider（`QOS_CBR_RERANK` gated）。
- **R6 兜底**：未装配/关闭 → 命中序 = §4.2 纯确定式（CI 恒定）；装配后**离线制品是纯查表**（无在线随机·同输入同输出）→ 仍 R6。门 `decision-case:check` 守"关=确定性兜底"。

---

## §5 端点 / 模块落点
- **案例层落 AgentCore `growth/`**：`apps/agentcore/src/growth/decision-case.ts`（纯函数 `projectCase`/`extractFeatures`/`retrieveSimilarCases`/`mineDecisionPatterns`·与 L1-A `growth/requirement-graph.ts` / L1-B `growth/execution-planner.ts` 同域·消费其结构化上下文）。
- **摄取/检索接线**：`router/orchestrator.ts:1338`（agent 终态案例投影·additive）+ `tools/{registry,executor}.ts`（`retrieve_similar_cases`）+ `agents/universal.ts:28`（先查案例库）+ `tools/datacore-http.ts:348`（`HttpDecisionClient`）。
- **反馈闭环落 DataCore（就近校准·零改校准数学）**：`decisions.ts`/`calibration/service.ts` 订阅 `decision.outcome_recorded` → `onCalibrationRequired`；可选 `POST /a/v1/calibration/feedback`（登记外部反馈信号）。
- **契约落 `@platform/contracts`**（R1）：`cbr.ts`（§3）+ `index.ts` 导出。
- **持久化**（R9 四处·AgentCore）：`decision_cases`（`migrations/014_decision_cases.sql` + `repos.ts` 接口 + `memory.ts` + `pg.ts`）。反馈**不新建 datacore 表**（复用校准表）。
- **端点**（AgentCore·暗发 `memory.cbr` 门·`/b/v1`）：`GET /b/v1/memory/cases/similar` · `GET /b/v1/memory/cases/:id` · `GET /b/v1/memory/patterns` · `POST /b/v1/memory/cases/rebuild`(admin)。
- **门**：`scripts/check-decision-case.mjs` → `decision-case:check` → `pnpm gates`。
- **前端**：**零新页（本期）**——案例检索是 agent 内部读工具（推理过程步帧经现 `view.task-dag` 呈现）；决策案例回看面板/模式面板延后（minor·可并入现推演历史/校准收敛面·对齐 DESIGN §4 记忆层"后续增量"）。

---

## §6 《本体引用与影响》回写清单（落地即回写母体）
> 母体 `docs/SYSTEM-ONTOLOGY.md` 是唯一真相源·改接线改母体·再 `node scripts/build-ontology-slices.mjs` 同步切片（门 `ontology-slices:check` 守漂移）。
- **§2.H 交互编排域 / §2.E 求解推演域**：登记 `DecisionCase`（咨询派生案例 index·标"扩 `ExperienceCase` 机器·Tier-2 结构化"）· `DecisionPattern`（确定性挖掘·咨询非规则）· `FeedbackSignal`（三源归一）· `AdaptationProposal`（**标注=`CalibrationProposalRecord` 跨包投影·不双写**）。
- **§3 关系图 / §10.3 问句到答案链**：中枢链 agent 探索段标「先查案例库」（`retrieve_similar_cases` 旁 `search_experience`）；登记「决策→案例摄取链」（`decision.recorded`→案例 index）与「案例→反馈→校准调参」学习闭环链（`decision.outcome_recorded`→FeedbackSignal→校准提案→Action R4→paramsVersion→下轮 forecast）。**判决地位不变**（案例读/旁写·调参经 R4）。
- **§4 数据流事件图**：登记域事件 `decision_case.learned`（+ 可选 `decision_pattern.mined`）经 outbox·进 `EVENT_SUBSCRIPTIONS`（D-29·消费=案例面失效）；注记检索复用 `step.*`（零新 SSE 名）；复用 `decision.*`/`calibration.*` 驱动闭环。
- **§5 不变量**：无新不变量（R1/R2/R4/R6/R9/R10/R13/R16 均守）；发布律 RL2/RL6/RL9/RL10 适用登记；**KILL-MOCK-RED 案例维**（SEED 诚实标·案例数字不冒充真值）登记。
- **§7 门禁**：登记 `decision-case:check`。
- **§8 断点**：G-3b 行**追加**「read/write 双侧已深化至结构化 CBR + 决策学习闭环（L1.5）」（**不撤已闭 ✅**·诚实标"路径提示→结构化案例"的保真度升级）；G-RET 注记 `decision_cases` 增长表。
- **feature 注册**：datacore `features.ts`（权威）+ agentcore `features/registry.ts`（镜像）同注 `memory.cbr`（+ 可选 `memory.pattern_mining`）·`defaultOn:false`。

---

## §7 验收齿（真跑·铁律 0.4·KILL-MOCK-RED）
> 一切以真实测试为原则：真起双服务（datacore `SEED_DEMO=1` + agentcore）、真跑、真数据、真看结果；LLM mock（R6）；**绝不合成/兜底/哈希冒充真值**；前端所见/agent 所引逐值对照后端真值。
- **V1 · 一决策落案例（真实累积）**：真起 datacore·`POST /a/v1/decisions` 建一条真 `Decision`（context+options+chosen+predicted）→ `POST /a/v1/decisions/:id/outcome` 补 realized → AgentCore 摄取（`QOS_CBR_INGEST=1`）→ `GET /b/v1/memory/cases/:id` **逐字段对照** datacore Decision 真值（title/options/chosen/predicted/realized）·`origin:LEARNED`·`provenance=真 dec_id`。
- **V2 · 相似新问句检索到它（Ch11.7·真检索）**：换一个**同域近义新问句** → `GET /b/v1/memory/cases/similar?q=` → 上条案例为 **topK 命中**（`breakdown` 三维分可解释）；**改问句为异域** → 不再高位命中（确定性·非恒返）。R2：tenantB 查 tenantA 案例 → 空/404。
- **V3 · agent 真复用（G-3b 深化·真 UI/真推理）**：`memory.cbr` 开 + `QOS_CBR_RETRIEVAL=1`·经 QOS path B 真跑同域新问句 → agent 探索首步真调 `retrieve_similar_cases` 命中上条结构化案例 → 推理引用其**决策结构**（方案/否决理由·带免责）→ **业务数字仍经工具溯源**（案例数字未被当真值·`⟦ref⟧` 指真工具结果）。前端真看到该推理步帧（`view.task-dag`）。
- **V4 · 反馈→调参真生效（Ch11.16·真闭环）**：造一条 `capacity_forecast` 域的 `Decision`，realized 与 predicted 有**真实偏差** → 触发现校准 → `GET /a/v1/calibration/proposals` 出真提案(PENDING·带回测 `simulatedMapeAfter<mapeBefore`) → `POST /a/v1/calibration/proposals/:id/approve` 走 `校准参数变更` Action R4 审批 EXECUTED → `paramsVersion` **真 +1**（`GET` 校准 history）→ 下轮 forecast 用新参 → `GET /a/v1/calibration/convergence` mapeAfter **真下降**（越用越准·非手绘）。**断言 `autoApply` 关时无人值守零自改**（提案不 auto-apply·R4）。
- **V5 · 确定性模式挖掘（Ch11.8·真数据）**：真积累多条同 problemClass 决策 → `GET /b/v1/memory/patterns` 出确定性 `DecisionPattern`（support/confidence 对得上真案例）；达阈值 → **浮现为真 `GrowthTicket`（NEEDS_HUMAN）**·不自动上线规则（R4）。
- **V6 · R6 确定性双跑**：① `projectCase` 同 Decision 双跑 → `DecisionCase` JSON 字节一致；② `retrieveSimilarCases` 同 (query,案例集,weightsVersion) 双跑 → 命中序字节一致；③ `mineDecisionPatterns` 双跑一致；改一处随机/时钟/离线重排装配即验命中序变（`decision-case:check` green→red）。
- **V7 · 出厂 SEED 诚实（KILL-MOCK-RED）**：空租户出厂 SEED 案例全 `origin:SEED`·**真确定性派生**（抄 `seedDemoCalibrationConvergence` 范式·非合成冒充真实累积）；断言检索命中透 SEED 位、SEED 数字不被当已核验业务真值；**植入无 `origin:SEED` 标 / 合成冒充 LEARNED 的案例 → 门红**（green→red 自证）。
- **V8 · 回退演练（被证明·非声称）**：① 关 `QOS_CBR_RETRIEVAL` → agent 探索仅 `search_experience`（路径提示·改造前行为）+ agentcore 66 回归绿；② 关 `QOS_CBR_INGEST` → 案例 index 空·摄取不发生；③ 关 `memory.cbr` → 四个 `/b/v1/memory/*` 端点 curl **404**；④ `POST /b/v1/memory/cases/rebuild` 从 datacore Decision **真重建** index（证咨询派生可重生）；⑤ migration 014 down→up 幂等·drop `decision_cases` 无业务真值损·校准表零动。
- **V9 · gates 全绿**：`pnpm -r build && pnpm -r test`（datacore 69 / agentcore 66 / frontend 25+·新增测试计入）+ `pnpm gates`（含新 `decision-case:check` + `ontology-slices:check` + `chain:check`）全绿。

---

## §8 WO 拆分（5 张·带 acceptance·守 KILL-MOCK-RED·严格依赖序）
> 铁则（DESIGN §7·P6）：一期一单 → dev BUILT → 审核方真跑复验（含回退演练）→ DONE → 派下一期。

### WO-L1.5-1 · CBR 契约 + 确定性特征抽取 + 案例投影器（纯函数·无接线）
- **改**：`packages/contracts/src/cbr.ts`（§3 全 schema）+ `index.ts` 导出；`apps/agentcore/src/growth/decision-case.ts` 纯函数 `projectCase`/`extractFeatures`（§4.1·复用 pseudoEmbed + 确定性实体解析·消费 `DecisionArtifact` 端口 §2.3）；`config.ts` 加 `QOS_CBR_INGEST`/`QOS_CBR_RETRIEVAL`/`QOS_CBR_RERANK`（暗发）；`scripts/check-decision-case.mjs` + 并入 `pnpm gates`（先守特征∈注册表 + 确定性 + 契约漂移）。**不接线摄取/检索/端点**。
- **依赖**：无（可即启）。
- **acceptance**：① zod 编译·`pnpm -r typecheck` 绿；② `projectCase` R6 双跑字节一致（V6①）；③ 特征键恒 ∈ 真实注册表（problemClass/solverKey/ontologyType·`decision-case:check` 对**注入幽灵特征必红**·green→red·KILL-MOCK-RED）；④ 契约字段全 optional/additive（现有 `pnpm -r test` 全绿·零消费方感知）。
- **中止/回退（P7）**：契约破坏现有测/特征非确定 → 回退（纯新增·不动旧 schema）。

### WO-L1.5-2 · 案例库落库 + 确定性相似检索 + 读端点（暗发·治 G-3b 读侧底座）
- **改**：`persistence/{repos.ts,memory.ts,pg.ts}` 加 `decisionCases`（R9 四处·`migrations/014_decision_cases.sql`·镜像 `experience` §2.2）；`growth/decision-case.ts` `retrieveSimilarCases`（§4.2 三维确定性）；`GET /b/v1/memory/cases/similar`、`GET /b/v1/memory/cases/:id`（`memory.cbr` 门·**双注册** datacore `features.ts` + agentcore `features/registry.ts`）。**检索用直接插入案例测（暂不接真实摄取·WO-3 接）**。
- **依赖**：WO-L1.5-1 DONE。
- **acceptance（真跑）**：① 插入案例 → `similar?q=` 三维检索命中（`breakdown` 对得上·V2 精神）；② **R6 检索双跑字节一致**（V6②·改权重/随机源即红）；③ R2 跨租户 404（V2）；④ 回退：关 `memory.cbr` → 端点 404（V8③）·migration 014 down→up 幂等（V8⑤）；⑤ `decision-case:check` 检索确定性维绿。
- **中止/回退**：检索非确定/跨租泄漏 → 关 `memory.cbr`·drop 表。

### WO-L1.5-3 · 案例摄取接线（DataCore Decision→案例·agent 终态旁路·L2 端口）+ agent「先查案例库」（治 G-3b 读写闭合深化）
- **改**：`tools/datacore-http.ts` `HttpDecisionClient`（`GET /a/v1/decisions{,/:id}`·OBO·`:26/348`）；datacore `decision.recorded`/`outcome_recorded` → AgentCore 摄取 upsert（或启动 backfill）+ 发 `decision_case.learned`（进 `EVENT_SUBSCRIPTIONS`）；`orchestrator.recordExperience:1338` **additive** 加 agent 终态 `DecisionCase` 投影（`source:AGENT_TERMINAL`·不改 OBSERVED 写）；`tools/{registry,executor}.ts` `retrieve_similar_cases` 工具；`agents/universal.ts:28` 扩「先查案例库」（并列 `search_experience`·`QOS_CBR_RETRIEVAL` 门）。
- **依赖**：WO-L1.5-2 DONE。
- **acceptance（真跑·G-3b 深化）**：① **一决策落案例**：真 `POST /a/v1/decisions`+outcome → 摄取 → `GET /b/v1/memory/cases/:id` 逐值对照 datacore 真值（V1·`origin:LEARNED`·`provenance` 真 dec_id）；② **相似新问句检索到它**（V2）；③ **agent 真复用**：QOS path B 同域新问句 → 首步真调 `retrieve_similar_cases` 命中 → 引用决策结构 + 免责·业务数字仍经工具溯源（V3·前端真看到步帧）；④ 跨会话（二次跑）命中；⑤ 回退：关 `QOS_CBR_RETRIEVAL`→仅路径提示 + agentcore 66 绿（V8①）·关 `QOS_CBR_INGEST`→不摄取（V8②）·`rebuild` 真重建（V8④）。
- **中止/回退**：摄取阻断答题/改判决 → 关 `QOS_CBR_INGEST`；检索改路由 → 关 `QOS_CBR_RETRIEVAL`。

### WO-L1.5-4 · 反馈信号闭环 + 决策模式挖掘 → 接现校准 Action R4（feedback→调参真生效·不自改真值）
- **改**：`FeedbackSignal` 归一（`Decision.realizedOutcome` 预测vs实现 + agent 投票 `fallbackTraces.setFeedback` + 案例复用）；datacore 订阅 `decision.outcome_recorded` → `onCalibrationRequired`（`service.ts:283` 额外触发·可选 `POST /a/v1/calibration/feedback`）；`growth/decision-case.ts` `mineDecisionPatterns`（§4.4⑥·确定性）+ `GET /b/v1/memory/patterns`；达阈值模式 → `GrowthTicket`（RULE_CANDIDATE·NEEDS_HUMAN）。**校准数学/应用路径零改**（提案经 `校准参数变更` Action R4·`autoApply` 恒 false）。
- **依赖**：WO-L1.5-3 DONE。
- **acceptance（真跑·闭环）**：① **反馈→调参真生效**：`capacity_forecast` 域 Decision 真偏差 → 现校准出真提案(PENDING·回测 `simulatedMapeAfter<mapeBefore`) → Action R4 审批 → `paramsVersion` 真+1 → 下轮 forecast 用新参 → convergence mapeAfter 真降（V4·越用越准非手绘）；② **无人值守零自改**（`autoApply` 关·提案不 auto-apply·R4·断言）；③ 模式挖掘确定性 + 达阈值出真 `GrowthTicket`（V5·不自动上线规则）；④ R6 双跑（V6③）。
- **中止/回退**：出现无审批自改真值（R4 违例）→ 立即关反馈触发·校准回默认触发源；模式非确定 → 关模式面。

### WO-L1.5-5 · 出厂种子案例（诚实标 SEED）+ RL/GNN 离线可插拔占位 + 全链真跑 + 母体回写
- **改**：`mocks/seed.ts` 出厂 SEED 案例（**真确定性派生**·抄 `seedDemoCalibrationConvergence` / 经验 50 例 `EXPERIENCE_VARIANTS:1488` 范式·全 `origin:SEED`·**绝不合成冒充真实累积**·`decision-case:check` SEED-标维守）；`growth/decision-case.ts` `CaseEmbeddingProvider`/`CaseReranker` 接口 + 默认 pseudoEmbed/identity + `QOS_CBR_RERANK` 装配位（§4.5·离线制品占位·CI 确定性兜底）；母体 §2/§3/§4/§7/§8 回写（§6）+ `node scripts/build-ontology-slices.mjs`。
- **依赖**：WO-L1.5-4 DONE。
- **acceptance（真跑·全链闭环）**：① **全链**：一决策落案例→相似新问句检索到→agent 复用→反馈→调参真生效（V1-V4 串跑·中枢链 R11 闭包意义）；② SEED 诚实（V7·植入合成冒充即门红·green→red）；③ RL/GNN provider 关=确定性兜底命中序（V6·CI 不变）·装配离线制品仍 R6（纯查表）；④ `pnpm -r test` + `pnpm gates` 全绿（V9）；⑤ **母体回写**（§6）+ 切片重生成·`ontology-slices:check` 绿。
- **中止/回退（P7）**：SEED 冒充真值 / RL 引入热路径随机 / 全链 R6 不一致 → 关对应 flag 完整回退（关全部 `QOS_CBR_*` + `memory.cbr` = 改造前系统 + 空表）。

---

## §9 分期 / 回退纪律（沿 DESIGN-refit 七原则·收编）
- **排程（严格依赖序）**：`L1.5-1(契约+特征+投影·纯函数) → L1.5-2(案例库+检索+端点·读侧底座) → L1.5-3(摄取+agent 接线·治 G-3b) → L1.5-4(反馈闭环·接校准) → L1.5-5(SEED+RL 占位+全链+回写)`。**可与 L1-C（Graph RAG）并行**（DESIGN §7·`:94`·簇② 半）；不阻塞 L1-A/L1-B 脊柱主线（L1.5 消费其上下文·缺则退纯文本特征·不硬依赖）。
- **七原则逐条兑现**：P1 暗发（`memory.cbr` `defaultOn:false` + `QOS_CBR_*` env·demo 金丝雀先开）· P2 只加不改（契约全 optional·旧 `search_experience`/`recordExperience`/校准路径永不删·migration 带 down）· P3 旁路优先·权威不换手（案例读/旁写·调参经现校准 R4·判决口不动）· P4 影子/证据先行（案例 index 咨询派生·可 rebuild 对照·检索 green→red 测谎）· P5 回退演练入齿（每 WO acceptance 含真跑回退·V8）· P6 单期单单复验绿再下期 · P7 失败判据前置（每 WO 写死中止/回退）。
- **总不变式**：关 `QOS_CBR_INGEST` + `QOS_CBR_RETRIEVAL` + `QOS_CBR_RERANK` + `memory.cbr` = **改造前系统 + 休眠代码 + 空 `decision_cases` 表**（回退演练真跑证明）。案例/模式/信号均**咨询派生·可 drop 重生（从 datacore Decision + 任务史重建）**；**业务真值零动**——`Decision` 真值单一来源在 datacore，求解器参数变更始终经校准 Action R4（`autoApply` 恒 false·不自改）。
- **失败判据（中止即回退）**：R6 双跑不一致 / 案例含注册表外幽灵特征 / 检索非确定 / **SEED 合成冒充真实累积（KILL-MOCK-RED）** / 案例数字被当已核验业务真值 / **无审批自改求解器参数或规则（R4 违例）** / RL 引入热路径随机 / agent 检索改变路由或阻断答题 / QOS 回归测红 —— 任一命中 → 关对应闸完整回退。

---

## §10 诚实边界（铁律 0.4）
- **分源诚实（Ch11 有/无穷举）**：rge.txt Ch11（`rge_clean.txt:4745-5147`）**有**：Graph Embedding(11.5-6·GNN)、Similar Scenario(11.7·三维相似)、Decision Pattern/Motif Mining(11.8-9)、Rule/Skill Discovery(11.10/11.12)、Agent Learning Loop(11.13)、Human Feedback(11.14)、RL(11.15)、Knowledge Evolution(11.16)、Learning API(11.18)、质量指标(11.19)。本 PRD **确定性优先落**：§4.2 三维相似=**pseudoEmbed+分类/特征匹配（非 11.6 GNN）**；§4.4 模式=**频次计数（非 11.15 RL）**；Rule/Skill Discovery=**候选浮现→人工闸/GrowthTicket（非 11.10 AI 直接生成生产规则）**；11.6 GNN / 11.15 RL 为**离线可插拔占位**（§4.5·CI 确定性兜底·非本 PRD 实现体）。**未落地项诚实标 DEFER/占位**（不假装满配 Ch11 全部 ML 野心）。
- **G-3b 深化非重开**：G-3b 已 ✅ 闭写侧（路径提示保真度）；L1.5 **深化至结构化案例保真度 + 决策学习闭环**——回写**追加**说明、**不撤已闭 ✅**、**不谎称 G-3b 此前"未闭"**。诚实定位"路径提示→结构化决策经验"的能力升级。
- **反馈→调参不新造·不绕 R4**：闭环 100% 复用现校准（EMA/重放/分位 + 回测门 + Action R4）；L1.5 只加信号源（决策结果/投票/复用）与模式挖掘。**回测门 = Ch11.11 Simulation Validation 已落地**（非本 PRD 发明）；参数变更**绝不无人值守自改**（`autoApply` 默认 false 不动·R4）。
- **案例=咨询派生·非业务真值**：`DecisionCase` 是 datacore `Decision`（真值单一来源）+ 任务史的**只读派生 index**（可 drop 重建）；案例里的数字**永不冒充已核验业务真值**（沿 `OBSERVED_DISCLAIMER`·检索每条+顶层免责·业务数字恒经 `⟦ref⟧` 工具溯源）。
- **出厂 SEED 不冒充真实累积**：SEED 案例**真确定性派生**（抄 `seedDemoCalibrationConvergence` 真引擎产物范式）·全 `origin:SEED` 标·`decision-case:check` green→red 守（植入合成冒充 LEARNED→门红）；真实积累由真 `Decision` 摄取逐条累积（越用越大·R16）。
- **AdaptationProposal 单一来源**：= datacore `CalibrationProposalRecord` 跨包投影·**不新建提案表、不双写**（守 R-一致/单源）；契约层统一语义供两系统消费。
- **docx 是规格非代码**：Ch11 的 Property Graph Embedding→现 pseudoEmbed、decision_history/graph_learning_sample→现 `Decision`+`DecisionCase`、Learning API→现校准/GrowthTicket 的**桥接施工**已逐一手写落到 file:line，但仍需 dev 逐单实现 + 审核方真跑复验，不能直接落地。
- **命名禁用外部产品名**：用平台自有术语（企业记忆/决策案例/相似检索/决策模式/自适应提案/校准·非某参考产品名）。
