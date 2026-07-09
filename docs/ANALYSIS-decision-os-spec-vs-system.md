# 分析 · 《Decision OS 工业实现设计说明书》↔ 现系统 · 下一步计划

> 输入：用户上传的完整需求规格（Decision OS 说明书 Ch01–38 + 开发二/三/四卷）。方法：6 子代理逐章对照现系统 grep 判 HAS/PARTIAL/MISSING（记录 `/tmp/req-records/{A..F}`）。目标聚焦用户钉死的两问题：**①入口过多 ②倒推精度不高**。同时评估既有 `docs/PRD-gap-analysis-engine.md`。

## 0. 总体裁定（一句话）

**规格 = 现系统的"理想架构全集"；逐章比对后，引擎/运行时/数据/安全骨架大面积 HAS 或功能等价，两目标的真缺口不在"缺引擎"，而在"缺收口层 + 缺深层倒推器"——而这恰是 `PRD-gap-analysis-engine.md` 已设计但未落地的部分（近期）+ 一个规格点名、现系统缺位的 Execution Planner（中期）。**

现系统企业化程度比本体断点列表预设的更高——**校正**（子代理双证·母体 §8 已标 ✅）：
- `G-DR-1 无备份恢复` → **已闭**：`scripts/backup-pg.sh`/`restore-pg.sh` + DEPLOY.md §9 runbook。
- `G-SIEM-1 审计无外部对接` → **已闭**：`AuditSink` → 外部 SIEM NDJSON 旁路。
- `G-15 无分布式 trace` → **已闭**：OTel 全链 span → collector → Jaeger。

## 1. 六域对照计数

| 域（子代理） | HAS | PARTIAL | MISSING | 与两目标 |
|---|---|---|---|---|
| A Runtime 引擎 Ch01-12 | 8 | 4 | 0(整章) | ★直接·两目标真缺口都在此域的"收口层" |
| B 工业数据工程 Ch13-21 | 5 | 14 | 3 | ②数据侧天花板(Canonical/DQ) |
| C 治理+部署 Ch22-38 | 6 | 10 | 1 | 间接(企业级硬化·正交) |
| D 开发二卷·决策运行时 | 1 | 8 | 3 | ★★倒推精度深层根因 |
| E 开发三卷·Runtime/Event | 0/5核 | 3 | 2 | 无硬缺口(范式分歧非刚需) |
| F 开发四卷·安全 IAM | 6 | 10 | 6 | 正交(AI 原生安全另立 track) |

## 2. 两目标裁定（核心）

### ① 入口过多
- **现状**：缺口-补齐入口散 **8+ 处**——前端 GapCard / TicketCenterPage / DataBuilderPage / SandboxView + 后端 `growth/{ledger,tickets,worklist,board}`(server.ts:409-608)。
- **结构根因**（A+D 共识）：**无统一 Decision 内核**——决策台账(`decisions.ts` 2 态) / 推演任务(`QueryTask`) / 场景卡 / Action / growth 各自成对象、各自成入口，互不引用。
- **杠杆**：`PRD-gap-analysis-engine §5/§7` 已设计"**融合式收口 console·复用既有 worklist/ticket·零新页**"——**未落地**。落地即收敛（近期赢）。彻底根治 = 统一 Decision 内核（大工程·可缓）。

### ② 倒推精度不高 —— 分两个高度
**(a) 数据供给倒推（问题→缺哪些数据/本体/规则）= 现系统扎实资产**
- HAS：`SOLVER_DATADEP` 依赖闭包(datadep.ts:86) + `EntryReadiness` 倒推数据缺口(app.ts:2677) + PRD `deriveRequirements/expandHiddenRequirements`。
- 真缺口：`classifyGap`(probe.ts:126)「**一次只报一堵墙**」→ 升级为 `preAnalyzeQuery`「**全景预分析·本查询涉及 N 项缺口**」（PRD Phase2·未落地）。**近期高杠杆·低风险**。

**(b) 计划综合倒推（问题→需求图→执行计划 DAG→择优）= 真缺口（最大杠杆·最大工程）**
- MISSING（D）：`Requirement Graph`（全仓零命中）、`Execution Planner`（现 `ExecutionPlan` 是**预写模板** + `resolvePlanForIntent`·非从需求综合）、`Task 生成评分`（无 HistoricalSuccess/Cost 择优）。
- 现系统 `query→意图键→预写模板` 代偿，**倒推止步于"分类命中即用模板"**——这是倒推精度的天花板。

**对我此前给你的两条建议的校正（更准）：**
- 「强化确定性分类兜底」：比预想更到位——`deterministicMatchScore` 地板**已 wired**(orchestrator.ts:291) + 无 LLM 兜底路由(:516)。→ 不是"接上"，是"**加强覆盖/校准**"。
- 「补求解器覆盖·因果归因无专属 path」：**非零**——`plan_rootcause`/`margin_attribution`/`counterfactual_timeline` 已在。缺的是"**通用因果归因 path + NL 路由覆盖**"，非从零建。
- 新增（B）：**数据侧天花板** = 无 Canonical Data Model + 字段级 Data Quality → 倒推到不了"缺哪个源系统的哪个字段·质量/新鲜度多少"。PRD 显式不建·是互补空白。

## 3. PRD-gap-analysis-engine.md 评估

- **它是现系统最接近"真倒推器"的设计**（D）：`deriveRequirements/expandHiddenRequirements/buildExecutionPlan` 沿 `SOLVER_DATADEP` + 本体图闭包倒推。
- 与规格关系：**强重叠** Ch19/20（统一 GapAnalysis + 拓扑序 + remediation）；**显式不建** Ch13 数据规范/DQ 层（B 互补空白）；**不含** Ch-level Execution Planner（D 更深的倒推器）。
- **裁定**：方向正确、是两目标的正确载体；但需 (a) **真落地 Phase2/3**（全景预分析 + console 收口）；(b) 认清它只是"数据供给倒推"，**"计划综合倒推"(Execution Planner) 是更大的下一步**。

## 4. 下一步计划（分层·排优先级）

### 第 0 层 · 立即（两目标近期赢 · PRD 落地 · 低风险）
- **WO-GAP-PREANALYSIS**：`classifyGap`→`preAnalyzeQuery` 全景预分析（复用 `SOLVER_DATADEP` 闭包·PRD Phase2）。→ 命中 ②近期。
- **WO-GAP-CONSOLE**：融合式收口 console（复用 worklist/ticket·零新页·PRD §5/§7）。→ 命中 ①收敛。
- 二者 = PRD 已设计未落地的 Phase2/3·直命两目标·风险最低。

### 第 1 层 · 中期（倒推精度深化）
- **WO-REQ-GRAPH**：落地统一 `RequirementGraph` 产物/DSL（合 design-time `comprehend` + runtime QOS classify 两套·B+D）。
- **WO-EXEC-PLANNER**：从 PRD `buildExecutionPlan` 种子长出真 Execution Planner（SkillGraph/ToolGraph + Task DAG 合成·非预写模板；含 Task 评分 HistoricalSuccess/Cost 择优·D）。
- **WO-CAUSAL-PATH**：通用因果归因 path A + NL 路由覆盖（复用 `plan_rootcause`/`margin_attribution`·非从零）。

### 第 2 层 · 结构根治（可缓 · 大工程）
- **统一 Decision 内核 + 生命周期状态机**（合决策台账/QueryTask/场景卡·D#4）——入口过多的结构根因·但重构量大。

### 第 3 层 · 企业级硬化（正交独立 track · 非本两目标）
- K8s/helm 部署（C·刚需）· AI 原生安全（Prompt 注入防护/输出安全/Agent 一等身份/数据分级·F）· Agent 五维评估卡（C）· Canonical Data Model + 字段级 DQ（B·倒推数据侧天花板）。

### 建议排序
先派 **第 0 层 2 条**（PRD Phase2/3·直命两目标·低风险）→ 我复验绿 → 再评估 **第 1 层**（倒推深化·较大）。第 2/3 层登记为路线图，按企业化节奏推进。

## 5. 本体引用与影响

- **对象类型**：Decision（现脑裂 decisions.ts/QueryTask·D#1）、RequirementGraph（MISSING·拟立）、ExecutionPlan（现为模板·拟升级）。
- **链路**：L-QOS（问→答·收口层在此）、L-SOLVER（求解链·datadep 倒推）、L-SLICE（本体切片·数据供给倒推）。
- **事件**：growth 三环（console 复用）；PreAnalysis（PRD 已回写母体 §4 `growth.pre_analysis_*`）。
- **不变量**：R6 确定性（预分析/planner 必守）、R3 视图过滤（NL 路由）。
- **断点**：G-3（presetContext 注入·console 关联）、G-9（场景发育闭环）；**已闭校正** G-DR-1/G-SIEM-1/G-15。
- **回写**：第 1 层 RequirementGraph/ExecutionPlanner 落地时回写母体 §2 对象/§3 链路。
