# 本体切片 §4 · 数据流与事件失效图（模块间数据关系的单一来源）

<!-- 自动生成·勿手改 -->
> ⚠ **本文件由 `scripts/build-ontology-slices.mjs` 从母体 `docs/SYSTEM-ONTOLOGY.md §4` 派生**（本体克隆切片·层 2）。
> **改接线改母体 §4，再跑 `node scripts/build-ontology-slices.mjs` 同步**（勿直接改本文·门 `ontology-slices:check` 守漂移）。母体 hash `4a716f9ebf014aa8`。

---

## 4. 数据流与事件失效图（模块间数据关系的单一来源）

> 来源：`apps/agentcore/src/event-subscriptions.ts`（经 `GET /b/v1/event-subscriptions` 下发前端缓存失效路由）。**D-29 铁律**：任何产出型操作（上传/发布/生成/审批/tick）完成**必须**发对应领域事件，下游消费页**必须**订阅并在 SLO（事件 60s / 配置 TTL 5min）内反映。
>
> **F1 全局领域事件交付通道（实时环地基，2026 收口）**：前端 `useDomainEventStream`（挂 `ShellLayout`，登录后常驻）按 `?since` 游标轮询 `GET /a/v1/outbox`（datacore 真实 outbox 馈源，租户隔离 R2），对**任何来源**的领域事件调 `invalidateForEvent`——补上此前"`invalidateForEvent` 仅由发起方自己 mutation 本地触发、跨用户/被动页不更新"的缺口（PROP-1 不重登反映）。`store/eventInvalidation.ts` 的 `EVENT_INVALIDATES` 扩入真实发出的 `synthetic.tick_completed/action.executed/calibration.proposed/calibration.rolled_back/objects.merged`。**E-c 双源（已落）**：AgentCore 新建 `domain_events` 持久化（migration008，R9 四处）+ 发布时 `emitDomainEvent`（intent/agent/workflow/scenario.published+retired）+ `GET /b/v1/outbox` 馈源；前端 `useDomainEventStream` 同时轮询 `/a` 与 `/b` 两源（独立游标、跨源 eventId 去重），B 侧管理配置变更从此也跨会话传播。**E-a（已落）**：`storybuild.run_recorded`。

| 环 | 事件 | 生产者 | 层级 | 失效下游 | 断链审计 |
|---|---|---|---|---|---|
| L1 | `raw_dataset.uploaded` | 连接器上传 | IN_SESSION | raw-datasets, modeling.dataset-picker | DL1 |
| L1 | `ontology.published` | 本体发布 | IN_SESSION | object-types, dashboard, scenario-data, derivation | DL2 |
| L1 | `derivation.completed` | 派生管线 | IN_SESSION | dashboard, risk, scenario-data, object-queries | — |
| L1 | `materialize.completed` | 对象化作业 | IN_SESSION | dashboard, object-queries, scenario-data | — |
| L2 | `ts.ingested` | 时序上传 | IN_SESSION | dashboard.curves, solver-inputs | — |
| L3 | `rules.updated` | 规则发布 | IN_SESSION | rule-library, agent/workflow-editor.rule-bindings | DL3 |
| L4 | `workflow.published` | 工作流发布 | IN_SESSION | intent-editor.workflow-bindings, agent-editor.tool-bindings, workflow-list | — |
| L4 | `agent.published` | Agent 发布 | IN_SESSION | agent-editor.tool-bindings | — |
| L4 | `intent.published` | 意图发布 | IN_SESSION | scene-entry.intent-filter, scenarios, intent-catalog | — |
| L4 | `scene_entry.updated` | 场景入口编辑 | IN_SESSION | scenarios, scene-entries | — |
| L4 | `scenario.published` | 场景发布（升一等对象） | IN_SESSION | scenarios, scene-entries, intent-catalog | — |
| L4 | `scenario.retired` | 场景退役 | IN_SESSION | scenarios, scene-entries, intent-catalog | — |
| L4 | `scenario.growth_triggered` | 场景发育闭环·缺件卡 grow 自动触发 runGrowthLoop（O9：探针→补齐→重跑→收敛重验，缺则诚实定级 PROVISIONAL+开工单）。WO ONTO-SCEN-GROW：双通道=SSE 场景通道 ⊕ 域事件 outbox（`emitDomainEvent`→`/b/v1/outbox`） | IN_SESSION | scenarios, growth-ledger, growth-tickets | — |
| L4 | `scenario.matured` | 场景发育闭环·grow A10 验证 triggerQuestion 经 QOS 正序实跑真出答案（非空/非占位/非探索兜底·dataBearing）→ maturity=GOVERNED 上架（WO ONTO-SCEN-GROW：SSE ⊕ outbox 双通道） | IN_SESSION | scenarios, scene-entries, intent-catalog | — |
| L4 | `scenario.gap_detected` | 场景发育闭环·grow 验证未过 → PROVISIONAL/ADVISORY + gapCode（诚实缺口不静默，NEEDS_HUMAN 关联 GrowthTicket；WO ONTO-SCEN-GROW：SSE ⊕ outbox 双通道） | NOTIFY | scenarios, growth-tickets, notifications | — |
| L5 | `action.pending_approval` | Action 提交 | NOTIFY | notifications, approval-inbox | — |
| L5 | `action.executed` | Action 写回 | IN_SESSION | dashboard, object-queries | DL4 |
| L5 | `writeback.divergence` | 回声对账 | NOTIFY | notifications, dashboard | DL4 |
| L5 | `decision.recorded` | 一等 Decision 记录创建（WO-DECISION-RECORD·§3.7 D8·问责+组织学习；`DecisionService.create`→`POST /a/v1/decisions`，payload 带 decisionId/title/chosen/decidedBy） | IN_SESSION | decisions | — |
| L5 | `decision.outcome_recorded` | Decision 补录实现结果（`DecisionService.recordOutcome`→`POST /a/v1/decisions/:id/outcome`，realizedOutcome 后填→预测 vs 实现可对比复盘） | IN_SESSION | decisions | — |
| L6 | `calibration.applied` | 校准批准 | IN_SESSION | calibration-report, solver-params | DL5 |
| L6b | `calibration.swept` | 校准活体清扫每轮（WO-E1·CALIBRATION_SWEEP → runAll + 落收敛度 mapeBefore→mapeAfter） | IN_SESSION | calibration-convergence(GET /a/v1/calibration/convergence) | DL5 |
| L7 | `intent.promoted` | 兜底孵化 | IN_SESSION | intent-catalog, fallback-stats | DL6 |
| L8 | `synthetic.tick_completed` | 模拟时钟 tick | IN_SESSION | dashboard, risk, scenario-data, calibration-report | DL7 |
| L8 | `dataset.regenerated` | 合成生成 | IN_SESSION | dashboard, risk, scenario-data, ontology-graph, rule-library | — |
| L8 | `connection.sync_completed` | 连接器同步（**WO-PIPE-INCR ② 已真产出**：此前声明+订阅却从不发出·DL9 断链；现 `ConnectorService.onSyncCompleted` 钩子→`outbox.emit`，payload 带 connId/datasets/rowCounts/watermarks/incremental/changedRows，且 `changedRows>0` 触发 `ontology.runDerivations` 使同步数据自动流入派生） | IN_SESSION | dashboard, scenario-data, object-queries | DL9 ✅闭 |
| L8 | `connection.created` | 连接器创建（A11 带 category） | IN_SESSION | connectors, data-categories | — |
| L1 | `slice.planned` | 切片规划器（A3.4 规划/复用；E6 近似问句命中时 payload 附 `reuseMatch:QUESTION/score`） | IN_SESSION | slice-library, slice-index | — |
| L9 | `kb.indexed` | 知识库索引 | IN_SESSION | kb-search, search-test | DL10 |
| L10 | `objects.merged` | 实体合并 | IN_SESSION | object-queries, dashboard, search | DL8 |
| L10 | `merge_candidate.created` | 实体解析 | NOTIFY | notifications, merge-queue | — |
| L10 | `quarantine.row_added` | 隔离区入库 | NOTIFY | notifications, quarantine | — |
| L11 | `policy.updated` | 权限变更 | IN_SESSION | dashboard, search, scenario-data, history | DL11 |
| L12 | `features.updated` | 功能开通 | IN_SESSION | workspace, navigation, scenarios, intent-catalog | DL12 |
| L13 | `growth.gap_detected` | 自成长发动机·探针检出缺口（LOOP fill 内发） | IN_SESSION | growth-ledger | — |
| L13 | `growth.fill_proposed` | 自成长发动机·补法分派（缺数据 SOFT/空租户 = **登记在办项 WorklistItem·不自动补·待人工**载 `needsHuman/worklistItemId`；DF.9 HARD 真人正门[出 DataRequest]；缺求解器 generic_inference B 兜底） | IN_SESSION | growth-ledger, growth-worklist | — |
| L13 | `growth.fill_claimed` | 自成长发动机·在办项认领（人在看板认领缺数据缺口·记 owner=actor·`POST /b/v1/growth/worklist/:id/claim`） | IN_SESSION | growth-worklist | — |
| L13 | `growth.fill_triggered` | 自成长发动机·人工触发补数据缺口（认领人点「补数据缺口」→真跑 fillData/provisionWorld·R6 seed 确定性·`POST /b/v1/growth/worklist/:id/fill`→DONE） | IN_SESSION | growth-worklist, dashboard, risk, scenario-data, object-queries | — |
| L13 | `growth.ticket_opened` | 自成长发动机·缺功能落工单（带真实 I/O 契约+本体引用骨架；P5 推送触达；拉兜底=`GET /api/v1/growth/tickets`） | NOTIFY | growth-tickets, notifications | — |
| L13 | `growth.converged` | 自成长发动机·LOOP 收敛（问句现可答） | IN_SESSION | growth-ledger, growth-tickets | — |
| L14 | `meta.ontology_synced` | Dogfooding·系统本体自反投影重物化完成（`POST /a/v1/meta/sync`）→ 失效 `/a/v1/meta/*` 查询缓存 + meta MCP 工具结果 | INVALIDATE | meta-ontology(`/meta/*` 视图) | — |
| L15 | `storybuild.run_recorded` | 数据构建发动机·故事建域记录完成（`runStory`）→ 经 F1 全局通道失效历史推演记录/模块同步矩阵 | IN_SESSION | story-runs | — |
| L15 | `fde.node_advanced` | A5 FDE 编排工作流·节点状态推进（`fde-graph.ts projectFdeNodes` 投影 7 执行步→8 语义节点，引擎 onAdvance 每步迁移发）→ 实时点亮节点状态图（跨会话/被动页） | IN_SESSION | fde-graph, story-runs, workflow-runs | — |
| L15 | `scaffold.manifest_recorded` | A7 B 栈 scaffold 清单**无条件**落 DataCore（`scaffold-manifest.ts buildScaffoldManifestRecord`，单机/未配 AGENTCORE_BASE_URL 也可见倒推出的 agent/plan/scene 定义，状态 PENDING_BSTACK）→ 失效 scaffold 浏览 | IN_SESSION | scaffold-manifest, story-runs, workflow-runs | — |
| L15 | `scaffold.reconciled` | A7 B 上线幂等对账（`reconcileScaffold`，按 manifest 未对账项重下发 → 升 SCAFFOLDED/REUSED + fullChainOk HARD）→ 失效 scaffold 浏览 | IN_SESSION | scaffold-manifest, story-runs | — |
| L15 | `build.verified` | A10 终态闭环验证（`verifyBuild`：publish 后/手动把主问句经 QOS 重跑 → VERIFIED/NOT_VERIFIED/BUILD_STATIC，回灌 FDE 节点图末节点 + 经 runId 与 growth LOOP CONVERGED 归一）| IN_SESSION | story-runs, fde-graph, growth-ledger | — |
| L15 | `prototype.intake_recorded` | 原型 intake 正门（`prototype-intake.ts parsePrototypeHtml` 确定性抽数据表+关系 → `reconcileIntake` 对既有本体字段对账预览：映射不上生成 SchemaReconcileCandidate 给人确认，P2 落 HITL 队列）→ 失效 intake 预览/对账队列 | IN_SESSION | intake-preview, reconcile-queue | — |
| L15 | `prototype.materialized` | prototype-intake P3·HTML 导入正门物化进库（`intake/import` → prototype_html 连接器把内嵌多表全量落 RawDataset，数据连接器可见 + 在线查看从库读）→ 失效连接/原始表列表 | IN_SESSION | connections, raw-datasets | — |
| L15 | `prototype.objectified` | prototype-intake P3 闭环末步·导入表按确定性对账物化为既有类型 ObjectInstance（`intake/objectify` → modeling.materializeFromReconcile，仅 autoMapped 入物化、其余诚实跳过，幂等）→ 失效对象类型计数 | IN_SESSION | object-type-stats | — |
| L15 | `schema_reconcile.resolved` | prototype-intake P2·schema 对账候选人确认（`reconcile-candidates/:id/resolve` USE/RENAME/NEW/MERGE/DISCARD）→ 失效对账队列 | IN_SESSION | reconcile-queue | — |
| L15 | `domain.provisional_built` | A18 双模闭包·PROVISIONAL 未审核态建域完成（`closure.ts` HARD 缺口降 ADVISORY 不阻断、`buildMode=PROVISIONAL`，整域强标 `domainTrustLevel=UNVERIFIED`，终态 `PROVISIONAL_ANSWER` 绝不 VERIFIED）→ 失效历史/审核台 | IN_SESSION | story-runs, provisional-review | — |
| L15 | `solver.provisional_generated` | A18.2 LLM 临时求解器（`solvers/llm-gen.ts` 生成 → 冻结 hash+版本 → `sandbox.ts` 锁死子进程跑通自检 → 注册 SolverArtifact `status=PROVISIONAL/trustLevel=UNVERIFIED`）→ 失效求解器目录/审核台 | IN_SESSION | solver-registry, provisional-review | — |
| L15 | `solver.status_changed` | A18.4 临时求解器晋升（`promoteSolver` 人工审批 PROVISIONAL→GOVERNED，trustLevel→VERIFIED，解锁写真值 R4）→ 失效求解器目录/审核台 | IN_SESSION | solver-registry, provisional-review | — |
| L15 | `domain.promoted` | A18.4 整域晋升编排（`promoteDomain` 人工审批 PROVISIONAL 域→把隔离命名空间 `tenant::prov::runId` 的本体/对象/链路/原始表/连接器/规则/切片整体迁入真租户+发布版本+跑派生 ⊕ 逐制品晋升临时求解器 GOVERNED ⊕ 翻转 domainTrustLevel→GOVERNED）→ 失效历史/审核台/对象库/求解器目录 | IN_SESSION | story-runs, provisional-review, object-queries, solver-registry | — |
| L17 | `metric.snapshot_recorded` | SPINE.2 指标快照回采（`POST /a/v1/metrics/snapshot`：`metric_rollup` 实算 actual → 执行回采更新口径，派生投影非新真值 R13）→ 失效驾驶舱/各视图 KPI | IN_SESSION | metrics, dashboard, scenario-data | — |
| L17 | `metric.breached` | SPINE.2 指标越线（actual<floorVal → 触发 `plan_rootcause`/`risk_timeline` 推演、派 `Principal` 行动）→ 通知 + 失效风险页 | NOTIFY | metrics, dashboard, risk, notifications | — |
| L16 | `entity.out_of_domain` | 感知层·槽位解析裸串实体在本租户任何已发布类型都解析不到（`router/slots.ts fillSlots`）→ orchestrator 发任务事件 + `perception-metrics.ts` 记误触发率（域外/尝试）+ 取最近邻候选供澄清 | NOTIFY | perception-metrics | — |
| L18 | `decision.alert` | **WO-ALERT (D6 §3.7 主动决策推送·替纯 PULL)**：复用 RULE_SCAN 调度（`scheduler.ts RuleScanService.scan` → `pushDecisionAlerts`）——决策阈值规则越线命中（`DECISION_RULE_FACTORS` 登记 C01/C02/C03/C05/C06/C08/C11/C16/C29/C30/C31）→ 联 `mitigation_select` 出处置建议（注入 canonical 方案库 `params.risk.mitigations`，LIVE 真案，R6）→ 发本事件（载 ruleKey/factor/baseName/recommended/recommendedName/urgency/draftPayload）+ `NotificationService.notifyRole(planner)` push 待办。按 (ruleKey,baseName) 去重（R6 确定性），不直写真值（R4·用户经既有 `adopt_mitigation` Action 审批后才落草稿），租户隔离 R2 | NOTIFY | notifications, approval-inbox, risk, dashboard | — |
| L19 | `experiment.concluded` | WO-EXPERIMENT 决策 A/B·冠军-挑战者实验结束（`solvers/service.ts concludeExperiment`：按两臂 metricKey 均值落胜方 winner CHAMPION/CHALLENGER/null → status=CONCLUDED，停止分流）→ datacore outbox 馈源（经 F1 全局通道）失效实验回执 | IN_SESSION | experiments | — |
| L18 | `features.updated`（+ 同口径动作码 view_config.{created,updated,deleted} / scenario_package.{created,updated} / iam.{tenant.created,user.created,user.updated,user.password_reset}，均为 audit action 而非新订阅事件） | **WO-AUDIT-OBS 统一审计（AuditService.record · `apps/datacore/src/audit.ts`）**：每条 admin/写路径变更**既**写专用 append-only `audit_log`（{id,tenantId,actorId,action,targetKind,targetId,before?,after?,at,requestId}·只插不改不删·R13/R-AUDIT），**又**仍发同名 outbox 领域事件（向后兼容 F1 全局通道/管理台缓存失效）。`features.updated` 此前订阅却从不发出（DL12 断链）→ 现经审计写入器真产出，DL12 ✅闭。只读消费 `GET /a/v1/audit-log?since=&actor=&target=`（platform_admin / 新增 auditor 只读角色·无写路由·append-only） | IN_SESSION | workspace, navigation, scenarios, intent-catalog, audit-log | DL12 ✅闭 |
| L-sink | `AUDIT_SINK_FLUSH`（调度作业·非 outbox 事件——外送 NDJSON 到外部 SIEM，不发领域事件） | **WO-ENTERPRISE-DR-AUDIT·sub-B**：`AuditSinkService.flush` **消费**既有 append-only `audit_log` 馈源（`AuditService.record` 单一审计写路径的下游读者·不新建审计写路径）→ 以游标 `sinceAt` 增量组 NDJSON 旁路 POST 到外部 SIEM endpoint（secret 解密作 Authorization·`x-request-id` 两端对账）→ 成功前推游标。**旁路不阻主写**：投递失败吞（不抛）·游标不推进·下次续投（至少一次·可重复不丢）。boot `app.ts .on("AUDIT_SINK_FLUSH")` + `synthetic/service.ts` 每 5 分钟 cron 注册（同 RETENTION_SWEEP 范式·继承 G-CRON-1 边界） | 外送（无 IN_SESSION 订阅·外部系统消费） | 外部 SIEM/审计系统 | G-SIEM-1 ✅闭 |
| L20 | `solver.binding_suggested` | WO-SOLVER-ONTOLOGY-BINDING（B3/G-17）：建模发布后 `ontology.publishVersion` 自动建议 SolverBinding **DRAFT** 草案（canonical 求解器默认类型不在本租户本体内时·确定性词表·RL4 人工确认不自动生效）→ 失效求解器绑定列表 | IN_SESSION | solver-bindings | — |
| L18 | `fusion.suspect_detected` / `fusion.conflict_arbitrated`（audit action·复用 WO-AUDIT-OBS 统一 append-only 审计·非新订阅事件） | **WO-MULTISRC-FUSION-DOMAIN（N1·多源融合）**：`multisource_fusion` 求解器对每个 SUSPECT/冲突 FusedObject 经 `AuditService.record` 写 `audit_log`（actor/targetKind=FusedObject/targetId=`role:pk`/after={verdict,confidence,suspectFields,arbitration,sources}/requestId）——测谎命中/冲突仲裁全留痕问责（R13）。融合态快照另 append 落 `fused_objects`（`GET /a/v1/fused-objects?verdict=&role=` 复盘·与 audit_log 互补） | IN_SESSION | audit-log, fused-objects | — |
| L-sim | `sim.session_created` | 推演沙盘 init 建会话（增量 1，设计待落）→ 失效沙盘会话列表 | IN_SESSION | sim-sessions | — |
| L-sim | `sim.tick_completed` | 沙盘推进 1+ tick（`propagateTick` 传导落 SimTickState，增量 1/3）→ 失效沙盘态/轨迹可视化 | IN_SESSION | sim-session-view, propagation-timeline | — |
| L-sim | `sim.checkpoint_saved` | 沙盘命名存档（增量 1）→ 失效检查点列表/分支基点 | IN_SESSION | sim-checkpoints | — |
| L-sim | `sim.branched` | 以检查点态开新分支会话（增量 1）→ 失效会话树/对比视图 | IN_SESSION | sim-sessions, sim-compare | — |
| L-mem | `experience.distilled` | **WO-B AGENT-OBSERVATIONAL-MEMORY·观察记忆写侧**：path B / 场景 agent 任务达终态（COMPLETED+answer）时 `orchestrator.recordExperience` 把 decision-trace 确定性蒸馏为 `origin:OBSERVED` 经验条目落库后发（载 id/origin/provenance=taskId/intentKey/toolPath·**不含业务数字**）→ 供后续 `search_experience` 检索（带免责·OBSERVED 永不冒充真值 KILL-MOCK-RED）。R2 tenant 随身·R6 确定性蒸馏·留存走 G-RET 增长表哲学 | IN_SESSION | experience(`search_experience`) | — |

> B↔A 缓存：B 对 A 资源缓存 TTL 60s + `{kind}.updated` 事件失效（钩子 `POST /b/v1/internal/invalidate`），传播 SLO ≤60s。
>
> **横切·全链追踪边（WO-OBSERVABILITY OBS-2·G-15）**：在 requestId 透传 spine（WO-AUDIT-OBS）之上叠 W3C `traceparent` 分布式 span 树（**互补·非替换**）。一个请求沿链路产出一棵 trace：`HTTP root span(agentcore/datacore)→OBO 跨服务(tools/datacore-http.ts 双轨注入 traceparent + 保留 x-request-id)→solver.invoke span(attr solverKey/dataMode/tenantId R2)→repo pg(auto-instrument)→outbox.emit span`。**两关联键并存**：人读 `requestId`（落日志/错误信封 R7 + span attr `app.request_id`）↔ 机器读 `traceId`（OTel 续 trace + 逐段时延/错误定位）。`tracing.ts`（两服务·bootstrap 第一个 import）起 `NodeSDK`；**未配 `OTEL_EXPORTER_OTLP_ENDPOINT` → no-op 不导出（诚实降级·不假装）**。仅 traces 信号（metrics/logs 边界外）。

---
