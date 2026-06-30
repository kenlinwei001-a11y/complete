# PRD · 决策支撑成熟化（多源态势 / 置信度 / 场景决策对话 / 生产韧性 / 自进化闭环）

> 在平台总纲（`PRD-platform-foundry-aip.md`）与 QOS（`PRD-query-orchestration-service.md`）之上的**成熟化增量**：把系统从"骨架齐、能跑 demo"推进到"**真多源态势 + 可信决策 + 生产扛得住**"的成熟决策支撑态。
> 依据：审核方本会话真跑/读源（hollow-data 冰山 / 推演单维 / 场景对话拒答 / 生产 PG 三坑）+ 成熟度对照（`ANALYSIS-maven-capability-maturity-gap.md`）。实现分解见派发表 `DISPATCH-dev-agent-worklist.md` 与施工单 `WO-design-landing-*.md`。
> **命名红线**：本 PRD 用平台自有术语，禁外部产品名。

---

## 0. 本体引用与影响（强制）

- **对象类型（§2）**：`DemandSegment`(forecast 域 p50/p90)·`SopVersion`/`AnnualScenario`(plan 域)·`ExternalSignal`(external)·`Solver`(risk_timeline/capacity_forecast/audit_timeline/13 extended)·`Scenario`(一等·defaultAgentId/presetContext/rules/mode)·`SceneEntry`(投影)·`Agent`/`Skill`/`Rule`/`SliceSpec`·`ActionType/ActionDraft`·`Calibration`·`ExecutionLockRecord`·`QuarantineRow`·`OntologyType/Link`(图谱)。
- **链路（§3）**：`Query→classify→Intent→Plan→Step{Solver|Slice|Rule}→AnswerBlock→SSE`（编排链/`sys.orch.query_to_answer`）；`数据→本体→推演链`（**本 PRD 新增 `DemandSegment/SopVersion→risk_timeline` 边**）；`场景/入口链`（Scenario→Agent/presetContext）；`ActionType→ActionDraft→approval→writeback→Derivation`（行动闭环）。
- **不变量（§5，逐条满足见 §6）**：R2(租户隔离)·R3(entitlement 先于 authz)·R4(真值经 Action 审批)·R6(确定性)·R13(溯源诚实/渲染派生非新真值)·R14(零业务常数/配置驱动)·R16(倒序发育)。
- **检测/门禁（§7）**：`no-silent-mock:check`(新)·`scene-agent-config:check`(新)·`css-vars:check`(新)·`repo-pg-notnull:check`(已落)·`debattery:check`·`ontology:check`·四包构建+测全绿。
- **触及/推进断点（§8）**：**G-5**(应用层电池锁死·图谱/视图配置驱动)·**G-9**(场景发育闭环·场景 agent 配置完整性纳入 GOVERNED)·**G-10**(规则即引用·场景 ruleBindings)·**G-11**(沙盘活体)·hollow-data 冰山(诚实位)·P0-LOCK/T5(生产韧性)。
- **回写计划**：落地后回写 §3 数据→推演链（新增 forecast→risk_timeline 边）·§2.E 求解器输出 dataMode 语义·§2.H Scenario 配置完整性·§7 新增三门·§8 各断点进度。

---

## 1. 目标 / 非目标

**北极星**：用户在任一业务页问任意决策问句，得到**基于本页真实多源数据**（订单+销售预测+外部信号+产能）、**带置信度与溯源**、**可一键转审批行动**的答复；推演曲线随真数据变、生产环境多实例稳定可信。

**目标（本期 6 维 · D0 为地基）**
0. **D0 数据管线（地基）**：真增量同步（CDC/watermark·非全量重灌）+ 运营态持续刷新（定时增量→事件→派生重算）+ **数据构建发动机职责收敛**（onboarding 建域 vs 运营态数据流分清）+ 数据新鲜度贯通置信度。决策质量被管线质量封顶（garbage in → garbage out）。
1. **D1 多源态势**：时序推演由「真需求(销售预测)−产能」派生，替哈希；接 `DemandSegment`/`SopVersion`/`ExternalSignal` 多源。
2. **D2 置信度诚实**：全求解器输出带 `dataMode` 诚实位；点击落点不裸空、可溯源（信任命门）。
3. **D3 场景决策对话**：每个人机对话入口=配置完整的场景接地 agent（本页数据+规则+skill+MCP+求解器+本体切片）。
4. **D4 生产韧性**：多实例锁/重启续跑稳定；本地构建门=CI 口径；可观测。
5. **D5 自进化闭环**：校准（越用越准）+ 沙盘活体 + 自成长 成日常。
6. **D6–D8 决策闭环完整性（完整性复审补·§3.7）**：D6 主动决策推送（监控→告警→处置建议→待办，替纯 PULL）·D7 决策执行闭环（出站 actuation 到 ERP/MES·替"停在建议层"）·D8 企业级（协同/延迟 SLA/可观测/治理/决策记录/真实连接器）。**D6/D7 是"决策支撑 vs 问答看板"的命门。**

**非目标**
- 不重定义平台总纲/QOS（本 PRD 是增量）。
- 不做行业专属视图 layout 全量去电池（G-5 8a 另期）。
- 不引入新外部数据采集硬件/实时流中间件（接现有 `/a/v1` 数据）。
- 真 LLM 富答案依赖租户配置真 provider（mock 环境只验路由/接地 plumbing）。

---

## 2. 现状与缺口（对照代码·带 file:line·诚实标 dev 已提交/待审核方复验）

| 维 | 现状（file:line） | 缺口 |
|---|---|---|
| **D0 数据管线** | 同步**全量重灌**（`connectors/service.ts:253 rawRows.replace`·`:210 cursor` 仅分页非 CDC·`registry.ts` incremental 是声明能力未真实现）；**数据构建发动机七阶段是 build-time**（`databuilder/service.ts:53` intake→…→publish·无 continuous/refresh）；`SchedulerService`(cron)在但未接连接器增量同步；生产源走 mock_erp/crm/external；新鲜度**部分**接决策（`capacity.ts:189 C09` 关键源滞后→P90 降级·**仅 capacity·risk/态势未接·未呈现给用户**） | 真增量同步(CDC) + 运营态持续刷新管线 + 发动机职责收敛(onboarding vs operational) + 真实源 + 新鲜度贯通全决策&UI |
| **D1 多源态势** | `risk.ts:28/189` 紧张度恒 `mockTightness`(charCode 哈希)；`capacity.ts` 产能 P50/P90 由订单批次算 + what-if delta——**均不读销售预测**。`DemandSegment`(forecast)/`SopVersion`/`AnnualScenario` 真值在 DataCore、规划与平衡组可见、**但推演不消费** | 推演单维（只订单+哈希）→ 接销售预测真源、时序由真需求-产能派生 |
| **D2 置信度** | ✅dev 已提交待复验：`plan.ts:286 shareDelta`(同闸门源·删 -17 魔数)·`RiskBoardView:466` 死路诚实文案·`extended.ts` dataMode(3f0d30c)。◐ 余：audit_timeline/SopBalance 兜底等接真源或标 PARTIAL | dataMode 贯通全求解器 + `no-silent-mock` 门 |
| **D3 场景对话** | `seed.ts:512 scn_plan_audit mode:"WORKFLOW_ONLY"`(全表唯一)→开放式问句 `orchestrator.ts:864` 拒答；SceneEntry 均无 `defaultAgentId`→回落通用 agent 不接本页 | 每入口 SceneAgentSpec（mode+agent+本页数据+规则+skill+MCP+切片）+ `scene-agent-config` 门 |
| **D4 生产韧性** | ✅P0-LOCK 已修核发(`pg.ts` extraColumns)；❌T5 续跑被死锁 60min 租约挡(`execlock` lease·真 PG 实拍坐实)；构建门本地仅 2/4 包(`package.json gates`)→tsc-red 漏 | 续跑 steal 陈旧锁 + 本地 gates 全 `pnpm -r build` + 可观测 |
| **D5 自进化** | M11 校准引擎已建(D10)；沙盘后端 0–4 齐、UI ~部分、demo 世界曾空；growth LOOP 已建 | 校准/沙盘/自成长 活体常态化 |

> 支撑项（IA/基建）：导航「数据接入」分散（`ShellLayout:38`）·图谱 8+ 套手搓渲染分散·隔离区真接线但 demo 空（`modeling.ts:537`）——见 §3.6。

---

## 3. 设计（复用现有接缝优先 · 标 复用/绿地/门禁）

### 3.0 D0 · 数据管线成熟化（地基·含数据构建发动机改造）
> 决策质量的封顶层。当前管线是"批量全量重灌 + build-time 建域"，撑 demo 够、撑运营态决策不够。改造分四：

- **① 真增量同步（CDC·绿地小增）**：把 `registry.ts` 声明的 `incremental` 能力落地——adapter 带 `since`/watermark，`connectors/service.ts:192 sync` 由 `rawRows.replace`（全量）改 **delta upsert/合并**（按 PK·只灌新增/变更行）；端点 `POST /a/v1/connections/:id/sync?since=<watermark>`，回执带新 watermark。无 incremental 能力的源回退全量（向后兼容）。
- **② 运营态持续刷新（复用 Scheduler+事件）**：连接器接既有 `SchedulerService`(cron·`app.ts:334`)定时增量同步 → 发 `dataset.synced` 事件（outbox·§4 失效流）→ 触发**受影响切片/派生/对象增量重算**（复用 `recompute`，不全量重建）→ 决策层数据自动新鲜。**这把"一次性建域"补成"持续数据流"。**
- **③ 数据构建发动机职责收敛（改造核心·非重写）**：把 `databuilder` 七阶段定位明确为 **冷启动/onboarding 建域引擎**（故事→建域→closure→publish·保留全部能力，含 BuildWorkflowRun/scaffold/growth）；**运营态数据流走 ①②**（增量同步+事件刷新），发动机**不背运营态持续职责**。前端"数据构建发动机"页同步呈现两态：建域（onboarding）/ 运营管线（持续同步看板：各源 last sync/新鲜度/增量量/隔离行数）。**避免用 build-time 引擎冒充 operational 管线**（当前隐患）。
- **④ 新鲜度→置信度贯通（扩 capacity C09·与 D2 合流）**：把 `capacity.ts:189 C09`（关键源滞后→P90 降级）的 `dataHealth.lagHours` 升为**跨求解器的新鲜度维**——并入 `dataMode`（LIVE 但滞后 → `PARTIAL/STALE`）；risk_timeline/态势/驾驶舱消费；UI 标「此决策基于 N 小时前的数据（源 X 滞后）」。**新鲜度是置信度的一个维度，不是隐含假设。**
- **⑤ 合成数据模块同步改造（定位收敛 + 诚实标注贯通·非重写）**：
  - **现状**：`origin=SYNTHETIC` 标注**已存在**（`synthetic/service.ts:174/217/290` 对象/链/规则/时序皆标·幂等清理）；合成↔真实**边界已存在**（provision-world `TENANT_NOT_EMPTY` 守卫·`app.ts:1093` 不 clobber 真数据 + HARD/SOFT 闭包 `:1339` + DF.8/9 接地：真业务实体走真人正门、generic 走 SOFT 合成）。**但 `origin=SYNTHETIC` 不贯通到决策置信度**——求解器在合成对象上算结论却不标"基于合成数据"，用户分不清合成 vs 真实。
  - **定位收敛（并入 WO-BUILDER-ROLE）**：合成 = **冷启动/onboarding（provision-world）+ 演示 + 测试确定性 + 有界 generic gap-fill** 源；**不做运营态真实数据替身**。运营管线看板标各源 synthetic / real-sourced。A6 拟真值域（`value-domains.ts` 业务区间+越线植入）保留——是"让合成够真以测推演/VLE"的质量特性、非真实数据。
  - **诚实标注贯通（并入 WO-DM/WO-FRESHNESS·关键修）**：把 `origin=SYNTHETIC` 织进决策 `dataMode`——合成对象算的结论 → `dataMode: SYNTHETIC/PROVISIONAL`（与既有 `domainTrustLevel=UNVERIFIED` 同源）；置信度成**三维**：`真实↔合成 × 新鲜↔陈旧 × 实测↔估算`；UI 标「此决策基于**合成数据**（非真实接入）」。**= 把 demo 全合成的现状对用户诚实化**（与 hollow-data 同纲：不让合成冒充真实接入）。
- **门禁新增**：`pipeline-freshness:check`（关键源 dataHealth 接进决策置信度·缺即红）；真实数据源/隔离区真值演示（WO-QUARANTINE 合流）。
- 工单：**WO-PIPE-INCR（①②·P1）· WO-BUILDER-ROLE（③⑤定位·P1·发动机+合成定位改造）· WO-FRESHNESS（④⑤诚实·P2·并入 WO-DM·dataMode 加 SYNTHETIC 维）**（新增·见 §8）。

### 3.1 D1 · 多源态势感知（核心·复用为主）
- **复用**：`SolverContext.loadContext` 注入 `DemandSegment`/`SopVersion`/`ExternalSignal`（对象库已有，`/a/v1/objects?type=`、`/a/v1/sop/versions`、`/a/v1/external-signals` 已可取）。
- **改 `risk.ts`**：`tensionSeries`(`:177`)/`mockTightness`(`:28`) 的紧张度种子改由**真需求-产能缺口**派生——需求侧 `DemandSegment.p50/p90`(前向) + `SopVersion.demand` + 订单近期实需；供给侧 `capacity_forecast` 产能曲线；`tension = clamp(缺口/产能)` over horizon（确定性 R6·零写死 R14）。无真预测则回落 `dataMode:PARTIAL`（诚实）。
- **门禁新增**：纳入 `no-silent-mock`（紧张度走哈希必标 MOCK）。
- 工单：**WO-FORECAST-SIM**（合并 A★ 死路·已 dev 部分提交）。

### 3.2 D2 · 置信度与诚实（结构性根因·部分 dev 已提交）
- **契约（绿地小增）**：`packages/contracts/src/solvers.ts` 给 `audit_timeline`/`plan_generate`/13 extended 输出 schema 补 `dataMode: enum(LIVE/MOCK/PARTIAL)`（同 `RiskTimelineOutputSchema`）。
- **求解器**：走真数据置 LIVE、兜底魔数/哈希置 MOCK/PARTIAL。**UI 复用** `RiskBoardView:79-90` 徽章范式铺到 audit/generate/extended 落点。
- **门禁新增** `no-silent-mock:check`：每 `SOLVER_KEYS` 输出 schema 必含 dataMode。
- 工单：**WO-DM / WO-DM-tail**（A0 dev 已提交·待复验）。

### 3.3 D3 · 场景决策对话（复用 Scenario 一等对象·填配置）
- **复用**：`Scenario{defaultAgentId/presetContext/rules/mode/intentCatalogFilter}` 槽位已全（治理铁律"所有用 workflow/agent 的场景在此完整可配"），本期**填满**。
- **Phase A**：`seed.ts:512` plan-audit `WORKFLOW_ONLY`→`WORKFLOW_FIRST`（解拒答），审计其余入口。
- **Phase B（绿地·SceneAgentSpec）**：定义场景级 agent（systemPrompt 基于本页数据·tools 限该场景求解器 MCP 子集·ruleBindings 该场景规则·presetContext+sliceTargets 注入本页本体切片），出厂幂等播种；先试点规划体检做模板，再铺 20+ 入口。答案带诚实位（D2）。
- **门禁新增** `scene-agent-config:check`：PUBLISHED 入口须{mode≠WORKFLOW_ONLY 或显式只读+defaultAgentId 已发布+rules⊆已发布+solverMcpAllow⊆注册表+sliceTargets 可达}，纳入场景 `maturity=GOVERNED`(G-9)。
- 工单：**WO-SCENE-A/B/C/D**。

### 3.4 D4 · 生产韧性（根因解·复用既有锁/门）
- **续跑 steal 陈旧锁（绿地小改）**：`resumeInflightExtractions` 对每个遗留 `EXTRACTING` doc 先强制过期/夺取其锁再 fireExtraction（新进程启动时"在抽取中"doc 的锁必属死进程·fencing 已防僵尸写）。
- **构建门（改 `package.json`）**：本地 `gates` 两处 `--filter ... build`→`pnpm -r build`（=CI 口径）；新增 `css-vars:check`。
- 工单：**WO-T5-RESUME-LEASE / GATE-B / WO-CSS**（P0-LOCK 已闭）。

### 3.5 D5 · 自进化闭环（复用既有引擎·常态化）
- **校准**：M11 引擎已建——本期接进决策日常（推演结论回采→校准提案→审批→参数版本+1→后续推演用新值），暴露在运营回顾/驾驶舱。
- **沙盘活体**：给 demo 种传导规则+状态变量、采纳→Action 草稿、分支→对比 UI 砌齐（G-11 P0/P1 大部已落·补活体）。
- 工单：沿用 `HANDOFF`/G-11 既有项（本 PRD 不新拆，标常态化目标）。

### 3.6 支撑项（IA/基建·低风险并行）
- **导航成熟化**：「数据接入」→「数据」收编源数据模块（WO-NAV-DATA）；沙盘并入推演（WO-NAV-SANDBOX）；隔离区空态诚实+真值演示（WO-QUARANTINE）。
- **图谱融合**：本体图(类型A)收敛为一个图引擎+主入口（实时派生自 建模+切片）；过程DAG(类型B)语义分散但共用渲染（WO-GRAPH-1/2/3-4·别一次性大重构）。

---

### 3.7 D6–D8 · 决策闭环完整性（完整性复审补 · 原 PRD 遗漏）
> 自我对抗复审发现：原 D0–D5 偏"**数据进来 + 算得对 + 问得到**"，漏了"**主动推 + 真执行 + 协同/治理**"——决策支撑系统区别于问答看板的命门。下列均**真读源**：多数有原语、缺完整闭环。

- **D6 · 主动决策推送（监控→告警→处置建议→待办）◐**
  - 现状：`RuleScanService`(`scheduler.ts:181`) 扫 SUSTAIN 规则→`RuleAlert`→发 `rule.alert` outbox + `NotificationService` 在——**但只原语**：窄（仅 SUSTAIN）、未接成完整 push 闭环。
  - 缺口：全决策阈值监控规则 + Scheduler 定时扫 + **告警→自动调求解器出处置建议→推用户待办/通知**。当前是 PULL（问才答）；缺 PUSH（系统主动盯+提）。
  - 设计（复用）：扩 `RuleScanService` 覆盖关键决策规则（C 系列阈值）→ 命中 → 联 `mitigation_select`/`adopt_mitigation` 产处置建议草稿 → `NotificationService` push + 驾驶舱"待处置"。工单 **WO-ALERT**(P1)。
- **D7 · 决策执行闭环 / 出站执行（actuation）◐**
  - 现状：`writeback-echoes`(`app.ts:940-953`) reconcile 原语在（回写记录 + ECHO_SUPPRESSED + `writeback.divergence`）——但 Action 执行(`actions.ts:349 EXECUTED`)写**内部 props**(Phase9B)，**无"批准 Action→push 回 ERP/MES 连接器"出站执行**（连接器全只读 ingest）。
  - 缺口：**写回适配器**（连接器加 outbound：approved Action→外部系统建单/改排程）+ 经 `writeback-echoes` 防回环 + 失败补偿。**决策不真正执行=系统停在"建议"层。**
  - 设计：连接器 `SourceAdapter` 加可选 `writeBack(op)`；`adopt_mitigation` EXECUTED 后经 outbound adapter push + echo 登记 + 散度对账。工单 **WO-ACTUATE**(P1·真实连接器后置)。
- **D8 · 企业级成熟度（多项·中后期）**
  | 维 | 现状 | 缺口 |
  |---|---|---|
  | 协同决策/待办/委派 | Action 审批+角色+通知 ◐ | 决策协同台（待我审批/处置/委派/超时升级） |
  | 决策延迟 SLA | classifier 关思考 12.7→3.6s · 10⁴ 规模 ◐ | 答复 P50/P95 SLA + 缓存 + 性能回归门 |
  | 平台可观测/SLO | `dc_*` metrics·FDE 图·growth 台 ◐ | 运维态可观测（平台健康/SLO/告警·非业务） |
  | 数据治理/合规/PII/留存 | 租户隔离+entitlement+R5 加密 ❌ | 数据分级/PII/留存策略/合规审计 |
  | 决策记录/复盘 | 运营回顾+ValidationTrace+M11 realizedMape ◐ | 一等 `Decision` 记录（上下文/备选/否决理由/预测 vs 实现） |
  | 真实连接器深度 | 框架+file/rest/jdbc+mock_erp/crm/external ❌ | 真 ERP/MES/SCADA/CRM 适配器（无则全合成·D0 已标） |
  - 工单：**WO-DECISION-RECORD**(P2·一等 Decision 记录)·**WO-OBSERVABILITY**(P2·平台 SLO)·其余按企业落地分期。

## 4. 契约 / 端点 / 数据模型（contracts-only-shared · 双仓储四处同改）

- **契约增**（`packages/contracts/src`）：`solvers.ts` 各求解器输出 +`dataMode`；`plan_generate` +`shareDelta/revGrowthPct`（dev 已提交）；`SceneAgentSpec`（场景 agent 配置：systemPrompt/solverMcpAllow/ruleBindings/skillRefs/sliceTargets/intentFilter）。**前端不得重定义契约已有类型。**
- **端点**：复用既有 `/a/v1/{objects,sop/versions,plan/{aop,quarterly},external-signals,quarantine}`（D1 接线，不新建）；场景 CRUD 复用 `/b/v1/scenarios`；无新增数据库表（场景配置进 `scenarios` 仓储 doc）。
- **数据模型**：`risk_timeline` 输出 dataMode（已有）；新增 forecast→risk 的派生**不落新真值对象**（R13 投影）。**若新增表**（如沙盘种子）须 migrations/*.sql + repo/pg.ts + repo/memory.ts + repo.ts 四处同改 + 过 `repo-pg-notnull:check`。

---

## 5. 关键流程（端到端·沿链路）

**决策问句全链（成熟态）**：
```
用户在「规划体检」问"达成目标需做哪些管理事项？"
 → SceneEntry(plan-audit·WORKFLOW_FIRST) → classify
 → 命中预设意图? 走 Path A 秒答(确定性)
 → 未命中 → 场景接地 agent(Path B)：注入 presetContext+本页切片(DemandSegment/SopVersion/Order)
   → 调 plan_audit/plan_generate 求解器(读真多源·tension 由真需求-产能派生·非哈希)
   → evaluate_rules C15/C18(场景 ruleBindings) → 透出 PASS/WARN/BLOCK
   → AnswerBlock{结论+三条管理事项+[n]溯源+dataMode 诚实徽章}
   → SSE 逐字流 → 用户"采纳" → ActionType→ActionDraft→审批(R4)→writeback→二次派生→回采校准(D5)
```
断点守护：场景配置半截→`scene-agent-config` 门拦；求解器走哈希→`no-silent-mock` 门拦；点红落点空→诚实文案不裸空（A★）。

---

## 6. 非功能与约定（§5 不变量逐条）

- **R2**：场景配置/切片/forecast 读写带 tenantId；跨租户 403/404。
- **R3**：场景 agent 走 entitlement（关→404 FEATURE_NOT_FOUND）；`qos.agent-fallback` 不变。
- **R4**：对话内"采纳"只产 ActionDraft 待审批，不直改真值。
- **R6**：tension 由真需求-产能确定性派生（同输入同曲线）；无网络/时钟随机；LLM mock 化测试。
- **R13**：dataMode 诚实位；forecast→risk 是派生投影非新真值；答案 [n] 溯源。
- **R14**：tension 公式/场景配置/图引擎域配色 配置驱动·零写死电池（`debattery:check` 绿）。
- **生产**：多实例锁 steal 陈旧；本地 gates=CI 口径；密钥仅 env（R5）；模型标识不入提交物。

---

## 7. 验收（DoD·全自动化 + 审核方真跑 FDE）

0. **D0**：连接器二次 `sync?since=` **只灌新增/变更行**（非全量重灌·watermark 前移）；定时增量同步真发 `dataset.synced` → 受影响派生**增量重算**（非全量重建）；关键源滞后 → 决策置信度标 `STALE`、UI 显「基于 N 小时前数据」；脏行落隔离区（真值演示）；数据构建发动机页同时呈现 建域/运营管线 两态。
1. **D1**：真 datacore 改 `DemandSegment`/`SopVersion` 真值→预判看板紧张度曲线随之变（非哈希·可溯源）；洛阳 D+13 红点开真订单或诚实文案、绝不裸空；缺口=预测需求−产能逐日可溯。
2. **D2**：audit/generate/extended 各卡带 dataMode 徽章；兜底数标 PARTIAL；`no-silent-mock:check` 漏 dataMode 即红；`PlanGenerate` 份额显示值=闸门所用值。
3. **D3**：真浏览器规划体检问开放式管理问句→接地结构化答复（调 plan_audit+评估 C15/C18+引本页真值+三条管理事项），非拒答/非泛答；`scene-agent-config:check` 半截配置即红；抽样≥3 入口同款。
4. **D4**：真 PG 杀 datacore 抽取中→立即重启→doc ≤一抽取周期续到 IN_REVIEW（无需手动过期租约·fence 递增·候选幂等）；本地 `pnpm gates` 能复现前端 tsc-red。
5. **D5**：改规则/良率→校准提案→审批→后续推演用新值（越用越准可见）；沙盘 demo 非空世界可 tick+采纳→Action 草稿。
6. **底线**：`pnpm -r build`(全4包)+`pnpm -r test` 全绿 + 三新门绿 + `ontology:check` 绿 + 本体回写。**审核方按上述逐项真浏览器/真 PG 实拍复验核发（绿测试≠能用）。**

---

## 8. 分期（波次·标依赖·每波跨过的成熟度台阶）

| 波 | 工单 | 跨过的台阶 |
|---|---|---|
| **W0 已落/在途** | P0-LOCK✅ · WO-SHARE17/AStar/DM(dev 提交·待复验) · classifier 关思考 | 信任裂缝起步收口 + 生产 P0 拆除 |
| **W1 数据管线地基** | **WO-PIPE-INCR**(真增量+运营刷新) + **WO-BUILDER-ROLE**(发动机职责收敛) | 管线从"批量建域"→"持续数据流·新鲜可信"（D0·**D1 的前提**） |
| **W1.5 信任+态势** | WO-DM 复验闭 + **WO-FORECAST-SIM**(核心) + WO-DM-tail + WO-FRESHNESS | 决策由**真多源·新鲜**数据驱动、带置信度（D1+D2·依赖 D0） |
| **W2 决策对话** | WO-SCENE-A(速胜)→WO-SCENE-B(试点)→C/D(铺开+门) | 任一入口**就本页接地决策对话**（D3） |
| **W3 生产韧性** | WO-T5-RESUME-LEASE + GATE-B + WO-CSS（与 W1 并行） | 多实例**生产扛得住**（D4） |
| **W4 IA/图谱** | WO-NAV-* + WO-QUARANTINE + WO-GRAPH-1/2(→3/4) | 信息架构成熟 + 图谱收敛 |
| **W5 自进化** | M11 活体 + 沙盘活体常态化 | **越用越准**闭环（D5） |

> 实现细节逐单见 `DISPATCH-dev-agent-worklist.md`（链接+提示词）+ `WO-design-landing-items-1-2-3.md` / `WO-design-landing-batch2.md` / `WO-P0-lock-pg-fix.md`。dev 实装贴证后审核方按 §7 FDE 判据独立真跑复验核发。

---
*审核方设计交付 PRD（design+review·非 dev 实装）· 基于本会话真跑/读源 + 本体 + 已派工单 · 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
