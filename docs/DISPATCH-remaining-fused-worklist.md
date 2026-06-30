# 派发总单（融合）· 剩余未开发 WO + 运营/合规/商业化 4·5·6

> 把**此前已设计未开发**的 WO + 本轮 gap-scan 的 **④决策实验 / ⑤数据留存 / ⑥审计追踪**（§4/5/6）融合成一份**可直接派 dev agent** 的总单。每单：目标 + 改哪些文件:行 + FDE 真值判据 + 边界 + 粘贴即用提示词。
> 已闭合的不再列（P0-LOCK/T5/GATE-B/DM 全族/SCENE-A/B+真Kimi/SHARE17/AStar/CSS/SCENE-CD门/PIPE-INCR①②/SopBalance）。
> **通用红线**（每单适用·prompt 内已含）：`pnpm -r build`(全4包) + `pnpm -r test` 全绿 + 按 FDE 判据**真跑自验贴证**（绿测试≠能用）；只推 `claude/vigilant-knuth-b1nmxn`；密钥仅 env(R5)；`tenant_id` everywhere(R2)；改链路/事件/对象/不变量/门禁**回写 `docs/SYSTEM-ONTOLOGY.md`**；命名禁外部产品名；模型标识不入任何提交物。

---

# 甲 · 新增（运营/合规/商业化 4·5·6）

## WO-EXPERIMENT（④·P1·决策 A/B·冠军-挑战者）

- **目标**：让"改了求解器参数怎么知道更好"可被**受控实验**回答。求解器参数已按租户版本化（`solvers/service.ts:1369` getParams / `:1377` paramsVersion / `:1383` paramsAt），但调用恒取**当前版本**。加冠军-挑战者：按确定性分流把一部分 invoke 路由到挑战者参数版本、记录两臂结果、可比较。
- **改哪些**：
  1. **契约** `packages/contracts/src/solvers.ts`：新增 `SolverExperiment{ id, tenantId, solverKey, championVersion, challengerVersion, splitPct(0-100), metricKey, status:DRAFT|RUNNING|CONCLUDED, startedAt }` + `ExperimentArm{ experimentId, arm:CHAMPION|CHALLENGER, paramsVersion, invokeCount, metricSum }`。
  2. **求解器分流** `solvers/service.ts invoke/invokeRaw`：取该 solverKey 的 RUNNING 实验→按**确定性 hash(tenantId+solverKey+请求键) % 100 < splitPct** 选挑战者臂→`paramsAt(tenantId, challengerVersion)` 取参（否则 champion 当前版本）；输出附 `__experiment{id, arm}`（不污染主结果·R13 诚实标）。
  3. **结果记录**：`ontology.recordExperimentOutcome(expId, arm, metricValue)`——metric 来自该求解器输出的 metricKey 字段（确定性·R6）；累加到 ExperimentArm。
  4. **路由/读** `app.ts`：`POST /a/v1/experiments`(建·admin)、`POST /a/v1/experiments/:id/{start,conclude}`、`GET /a/v1/experiments/:id`(回执两臂 invokeCount/均值/胜负)。
  5. **仓储**：memory+pg 双实现 + migration（`solver_experiments`/`experiment_arms` doc-table·R2 租户列）。
- **FDE 判据**：① 建实验(champion=v3,challenger=v4,split=50)→`start`→真 invoke 同一求解器 N 次→`GET /:id` 两臂 invokeCount 各约半(确定性分流·同请求键恒同臂)；② 两臂 metric 均值可比、`conclude` 落胜方；③ 关实验→恒走 champion(当前版本)·零影响既有。
- **边界**：是**参数版本** A/B（同求解器同输入不同参数版本），非影子部署/真流量重放；metric 是求解器**确定性输出字段**（非真业务结果回采——那是 M11 校准回采的事·正交）。分流确定性(hash)保 R6 可复现、不引随机。
- **本体回写**：§6 求解器链新增"实验分流"边；§4 新增 `experiment.concluded` 事件；可立门 `experiment-determinism:check`（同请求键恒同臂）。

## WO-RETENTION（⑤·P2·数据留存/TTL）

- **目标**：杜绝 outbox 事件/tasks/ts 点无界增长 + 满足合规留存上限。加**留存策略 + 定时清理作业**。
- **改哪些**：
  1. **契约**：`RetentionPolicy{ tenantId, table:"outbox_events"|"tasks"|"ts_points"|..., keepDays, status }`（平台默认 + 租户可覆盖·R2）。
  2. **调度作业** `scheduler.ts`：新增 `ScheduledJobKind "RETENTION_SWEEP"`（contracts 枚举同补）+ `on("RETENTION_SWEEP", handler)`；boot 注册默认 cron(如每日)。
  3. **清理实现**：handler 按 policy 对各表删 `createdAt < now-keepDays`——复用既有 `removeWhere`(repo.ts:115/119/177)；outbox 用 `outboxEvents` store 加 `purgeOlderThan`。**只删已 DISPATCHED 的 outbox**（PENDING 不删·防丢未投递事件）。
  4. **回执/可观测**：清理计数发 metric `dc_retention_purged_total{table}` + log；`GET/PUT /a/v1/retention-policies`(admin)。
- **FDE 判据**：① 设 outbox keepDays=0 + 跑 RETENTION_SWEEP→旧 DISPATCHED 事件真删(`GET /a/v1/outbox` 计数降)、PENDING 保留；② tasks/ts 同理按 createdAt 删；③ 未配 policy 的表不动(向后兼容·不误删)。
- **边界**：删的是**过期+已处理**行（PENDING/未投递/temporal 当前值不删·R13 历史另有快照语义需保留则排除）；先做软上限(按时间)·分区/冷归档属后续。**务必 tenant_id 限定**(R2·勿跨租户删)。
- **本体回写**：§2 各增长对象加留存语义；新不变量 **R-RETENTION**（每增长表有留存上限）入 §5；门 `retention-coverage:check`（每无界增长表在 policy 注册表有项）入 §7。

## WO-AUDIT-OBS（⑥·P2·统一审计 + 跨服务追踪）

- **目标**：把散点的 who-did-what 收成**统一 append-only 审计日志**（每变更带 actor+动作+目标+前后），并让 `requestId` **跨两系统透传**便于排障/合规。
- **改哪些**：
  - **审计**：① `adminplatform.ts:131` 的 `audit()`（现仅 `outbox.emit`）升级为写**专用 append-only `audit_log`**（`{id,tenantId,actorId,action,targetKind,targetId,before?,after?,at,requestId}`·只插不改不删·R13）+ 仍发 outbox(向后兼容)；② 把 features.ts(`:332/:349` updatedBy)、连接器/规则/视图配置等**所有 admin 变更路径**统一经 `audit()`(actor=ctx.userId)；③ `GET /a/v1/audit-log?since=&actor=&target=`(只读·platform_admin/审计员角色)。
  - **追踪**：④ agentcore 出站调 DataCore(`tools/datacore-http.ts` / OBO 客户端) 透传 `x-request-id`（无则生成）；DataCore `app.ts:642` 优先取入站 `x-request-id` 再回退 `req.id`；两系统日志均打 requestId；错误信封已含(`app.ts:646`)→端到端一线贯穿。
- **FDE 判据**：① 真改一项配置(如关某 feature)→`GET /a/v1/audit-log` 现该条带 actor+before/after+requestId；② 审计日志**只增不可改**(无 PUT/DELETE 路由·尝试改报错)；③ 从前端发一个 QOS 问句→同一 requestId 在 agentcore 日志→DataCore 日志→错误信封一线可追(实拍贴日志)。
- **边界**：审计覆盖**admin/写路径**(非每只读)；before/after 取关键字段非全 doc(避免膨胀);审计员角色是**新增只读角色**(不破 A6 行级)。追踪是 requestId 透传(轻量)·非全 OpenTelemetry span 树(那是 WO-OBS-2)。
- **本体回写**：§4 审计事件登记；新不变量 **R-AUDIT**(每写路径带 actor)入 §5；门 `audit-actor:check`(admin 路由经 audit())入 §7；§（运维）requestId 跨服务透传语义。

---

# 乙 · 此前已设计未开发（母单链接 + 提示词）

> 规格已在 `docs/WO-design-landing-batch2.md` / `docs/WO-design-landing-items-1-2-3.md`，此处给一句话 + 提示词，详规见母单。

## WO-FORECAST-SIM（P1·最该先做·态势真源地基）
推演紧张度从 `risk.ts:28 mockTightness` 哈希改由**真需求(DemandSegment/SopVersion p50/p90)−产能(capacity_forecast)缺口**派生；`RiskTimelineOutputSchema.dataMode` 接真源置 LIVE/无真预测 PARTIAL；前端 `RiskBoardView.tsx:462-491` 点红→真受影响订单 OR 诚实"mock 基线"面板(禁裸 `zh.common.none:491`)。详规 `WO-design-landing-batch2.md §WO-FORECAST-SIM`。

## WO-SCENE-C Phase C（P2·铺开场景 agent）
以 agt_plan_audit(WO-SCENE-B 模板)把场景 agent 铺到 dash/risk/order/sop-balance… 各入口(各自数据上下文/规则/求解器子集)；门 `scene-agent-config:check` 已立(WO-SCENE-D)·新配入口自动受校验。详规 `WO-design-landing-items-1-2-3.md item3`。

## WO-GRAPH-1 / GRAPH-2（P2·图渲染融合·先 1 后 2·低风险先做）
GRAPH-1 抽统一「过程 DAG」共享渲染组件(InferenceProcessDag/ProvenanceDag/FdeGraph/LayeredDag 四处同组件·入口数据语义不动)；GRAPH-2 抽「本体图谱引擎」(OntologyGraphView forceLayout 复用·实时派生)。详规 `WO-design-landing-batch2.md §图谱融合`。

## WO-NAV-DATA / WO-NAV-SANDBOX（P2·IA 小改）
NAV-DATA：`ShellLayout.tsx:38` 组名「数据接入」→「数据」+ 收编 order/data-builder/外部数据。NAV-SANDBOX：游离 sim-sandbox/sim-init 并入「推演」组(保 entitlement 门控)。详规 `WO-design-landing-batch2.md`。

## WO-QUARANTINE（P3·隔离区诚实文案）
空态文案改「无异常行(合成数据洁净；真坏行将在此排队修复)」+ 可选真值演示(传坏行 CSV→materialize→落隔离区→reprocess)。详规 `WO-design-landing-batch2.md §WO-QUARANTINE`。

---

# 丙 · 建议施工顺序

1. **WO-FORECAST-SIM**（P1·态势地基·解锁"决策算得准"最后一环）。
2. **WO-RETENTION**（⑤·P2·低风险·防长跑爆库·先立门）→ **WO-AUDIT-OBS**（⑥·P2·合规+排障地基）。
3. **WO-EXPERIMENT**（④·P1 但依赖 M11 校准在·决策自证闭环）。
4. **WO-SCENE-C / GRAPH-1→2 / NAV-* / QUARANTINE**（P2-P3·UI/IA·可并行速胜）。

---

# 粘贴即用提示词（逐单）

**WO-EXPERIMENT**
```
你是开发 agent。实现 WO-EXPERIMENT（决策 A/B·冠军-挑战者）。求解器参数已按租户版本化（solvers/service.ts:1369 getParams/:1377 paramsVersion/:1383 paramsAt）。加：①契约 SolverExperiment{id,tenantId,solverKey,championVersion,challengerVersion,splitPct,metricKey,status,startedAt}+ExperimentArm{experimentId,arm,paramsVersion,invokeCount,metricSum}；②solvers/service.ts invoke 取该 solverKey RUNNING 实验→确定性 hash(tenantId+solverKey+请求键)%100<splitPct 选挑战者→paramsAt 取参→输出附 __experiment{id,arm}(R13 诚实标)；③recordExperimentOutcome 累加 metricKey 字段值到对应臂；④app.ts POST /a/v1/experiments(admin)+/:id/{start,conclude}+GET /:id(两臂 invokeCount/均值/胜负)；⑤memory+pg 双实现+migration(solver_experiments/experiment_arms·R2 租户列)。完成判据：建实验(split50)→start→invoke N 次→GET 两臂各约半(同请求键恒同臂)；conclude 落胜方；关实验恒走 champion 零影响。回写 SYSTEM-ONTOLOGY.md §6 实验分流边+§4 experiment.concluded 事件+门 experiment-determinism:check。通用红线：pnpm -r build+test 全绿+真跑自验贴证；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-RETENTION**
```
你是开发 agent。实现 WO-RETENTION（数据留存/TTL）。①契约 RetentionPolicy{tenantId,table,keepDays,status}(平台默认+租户覆盖·R2)；②scheduler.ts 新增 ScheduledJobKind "RETENTION_SWEEP"(contracts 枚举同补)+on(handler)+boot 注册每日 cron；③handler 按 policy 对 outbox_events/tasks/ts_points 删 createdAt<now-keepDays(复用 removeWhere repo.ts:115/119/177；outbox 仅删已 DISPATCHED·PENDING 不删)；④metric dc_retention_purged_total{table}+GET/PUT /a/v1/retention-policies(admin)。完成判据：outbox keepDays=0 跑 sweep→旧 DISPATCHED 真删(GET /a/v1/outbox 计数降)·PENDING 保留；未配 policy 的表不动(不误删)；务必 tenant_id 限定(R2 勿跨租户删)。回写 SYSTEM-ONTOLOGY.md §2 留存语义+不变量 R-RETENTION 入§5+门 retention-coverage:check 入§7。通用红线：pnpm -r build+test 全绿+真跑自验贴证；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-AUDIT-OBS**
```
你是开发 agent。实现 WO-AUDIT-OBS（统一审计+跨服务追踪）。审计：①adminplatform.ts:131 audit() 升级为写专用 append-only audit_log{id,tenantId,actorId,action,targetKind,targetId,before?,after?,at,requestId}(只插不改删·R13)+仍发 outbox；②features.ts:332/349 及所有 admin 变更路径统一经 audit()(actor=ctx.userId)；③GET /a/v1/audit-log?since=&actor=&target=(只读·platform_admin/新增审计员只读角色)。追踪：④agentcore 出站调 DataCore(tools/datacore-http.ts)透传 x-request-id(无则生成)；DataCore app.ts:642 优先取入站 x-request-id 再回退 req.id；两系统日志打 requestId。完成判据：改一项配置→GET /a/v1/audit-log 现该条带 actor+before/after+requestId；审计日志只增(无 PUT/DELETE)；一个 QOS 问句同一 requestId 贯穿 agentcore→DataCore→错误信封(实拍贴日志)。回写 SYSTEM-ONTOLOGY.md §4 审计事件+不变量 R-AUDIT 入§5+门 audit-actor:check 入§7。通用红线：pnpm -r build+test 全绿+真跑自验贴证；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-FORECAST-SIM / SCENE-C / GRAPH-1 / GRAPH-2 / NAV-DATA / NAV-SANDBOX / QUARANTINE**：提示词见 `docs/DISPATCH-dev-agent-worklist.md`（母单未变）；本总单仅更新优先级与依赖。

---

## 本体引用与影响（总）

- **新增不变量**（落地时回写 §5）：R-RETENTION（留存上限）· R-AUDIT（写路径带 actor）· 实验分流确定性（归 R6）。
- **新增事件**（§4）：`experiment.concluded` · 审计事件族 · （留存清理走 metric 非事件）。
- **新增门禁**（§7）：`experiment-determinism:check` · `retention-coverage:check` · `audit-actor:check`。
- **新增断点**（§8·与 G-1…G-12 并列）：G-OPS（无 DR——本单未含·①已剔除）· G-EXP（无决策实验·WO-EXPERIMENT 闭）· G-RET（无留存·WO-RETENTION 闭）· G-AUD（审计散点·WO-AUDIT 闭）。
- **正交性**：甲（运营/合规/商业化）与乙（决策闭环 FORECAST/SCENE/GRAPH/NAV）正交——前者"卖得出/审得过/运维得了"、后者"算得准/接得地/看得清"。dev 交付后审核方按各单 FDE **真起服务/真 PG 独立复验核发**。

---
*审核方派发总单（design+review·非 dev 实装·融合此前未开发 + gap-scan 4/5/6）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
