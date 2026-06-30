# 派发清单 · 待开发 agent 施工的全部工单（链接 + 提示词）

> 审核方已成文施工单的**可直接派发**清单。每单：优先级 / 一句话 / 详细单链接（GitHub blob，分支 `claude/vigilant-knuth-b1nmxn`）/ 复制即用的提示词。
> **链接 base**：`https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/`（下表 `docs/X.md` 即拼此前缀）。
> **通用红线（每单适用·已写进各提示词）**：`pnpm -r build`(全4包·非本地半门) + `pnpm -r test` 全绿 + 按该单 FDE 真跑自验贴证（绿测试≠能用）；只 commit/push 到 `claude/vigilant-knuth-b1nmxn`；密钥仅 env 不入 git（R5）；改链路/事件/对象/不变量/门禁须回写 `docs/SYSTEM-ONTOLOGY.md`；命名禁外部产品名；模型标识不入任何提交物。

## §1 · 派发总表（按建议施工顺序）

| # | WO | 优先级 | 一句话 | 详细单（链接） |
|---|---|---|---|---|
| ~~1~~ | ~~**WO-P0-LOCK**~~ | ✅闭 | PG execution_locks 写入崩——**审核方真 PG 复验核发闭合** | [`REVIEW-WO-P0-LOCK-closure…md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/REVIEW-WO-P0-LOCK-closure-and-resume-finding.md) |
| 1b | **WO-T5-RESUME-LEASE** | **P1** | 重启续跑被死锁 60min 租约阻断→doc 卡 EXTRACTING（续跑机制本身对·被陈旧租约挡）。修：续跑前 steal 陈旧锁 | [`REVIEW-WO-P0-LOCK-closure…md` §2](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/REVIEW-WO-P0-LOCK-closure-and-resume-finding.md) |
| 2 | **WO-SCENE-A** | P1·速胜 | 规划体检对话入口 `WORKFLOW_ONLY`→`WORKFLOW_FIRST`（1 行解拒答） | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) |
| 3 | **WO-SHARE17** | P1·小 | 方案份额/收入魔数(-17/-100)→求解器下发 shareDelta/revGrowthPct（消自相矛盾） | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) |
| 4 | **WO-CSS** | P2 | DAG 深字 typo `--text`→`--txt` + `css-vars:check` 门 + 全站对比度审计 | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) |
| 5 | **WO-DM** | P1·keystone | dataMode 诚实位推广到全求解器契约 + `no-silent-mock` 门（hollow-data 地基） | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) · [`REVIEW-hollow-data…md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/REVIEW-hollow-data-iceberg-and-requeue.md) |
| 6 | **WO-AStar** | P1 | 洛阳红色点开「暂无数据」死路（红=哈希非真订单·点击落诚实面板，禁裸空） | [`REVIEW-hollow-data…md` §A-旗舰](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/REVIEW-hollow-data-iceberg-and-requeue.md) |
| 7 | **WO-SCENE-B** | P1·核心 | 规划体检配成完整场景 agent（本页数据+规则 C15-C23+求解器 MCP 子集+本体切片） | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) · [`HANDOFF-scene…md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/HANDOFF-scene-entry-agent-config.md) |
| 8 | **WO-DM-tail** | P2 | A1-A4/B-MED 各求解器接真源或标 PARTIAL（audit_timeline 哈希/yield/credit/loadByWeek/SopBalance） | [`REVIEW-hollow-data…md` §A1-A4/§B-MED](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/REVIEW-hollow-data-iceberg-and-requeue.md) |
| 9 | **GATE-B** | P2 | 本地 `pnpm gates` 只构建 2/4 包→改全 `pnpm -r build`（tsc-red 当绿出的根因解） | [`DEV-TODO…md` §GATE-B](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/DEV-TODO-reviewer-open-items.md) |
| 10 | **WO-SCENE-C/D** | P2/P3 | 场景 agent 铺到 20+ 入口 + `scene-agent-config:check` 门 | [`docs/WO-design-landing-items-1-2-3.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-items-1-2-3.md) |
| 11 | **WO-FORECAST-SIM** | P1·中 | 推演接销售预测真源（紧张度由真需求-产能派生·替 mockTightness 哈希）+ 合并 A★ 洛阳死路 | [`docs/WO-design-landing-batch2.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-batch2.md) |
| 12 | **WO-NAV-DATA** | P2·小 | 导航「数据接入」→「数据」，收编 订单台账/数据构建发动机/外部数据 | [`docs/WO-design-landing-batch2.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-batch2.md) |
| 13 | **WO-NAV-SANDBOX** | P2·小 | 推演沙盘/沙盘初始化并入「推演」组（保留 entitlement 门控） | [`docs/WO-design-landing-batch2.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-batch2.md) |
| 14 | **WO-QUARANTINE** | P3·小 | 隔离区空态诚实文案 + 真值演示（真接线·空因合成洁净·勿删） | [`docs/WO-design-landing-batch2.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-batch2.md) |
| 15 | **WO-GRAPH-1** | P2·先做 | 抽统一「过程 DAG」渲染组件（InferenceProcess/Provenance/FDE/Layered 共用·语义不动） | [`docs/WO-design-landing-batch2.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-batch2.md) |
| 16 | **WO-GRAPH-2** | P2 | 抽统一「本体图谱引擎」（OntologyGraphView forceLayout 复用·实时派生） | [`docs/WO-design-landing-batch2.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-batch2.md) |
| 17 | **WO-GRAPH-3/4** | P3·依赖16 | 融合主入口（切片/血缘/KSF 接引擎·建模=编辑态）+ 沙盘/元本体/边界/图查询接同引擎 | [`docs/WO-design-landing-batch2.md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/WO-design-landing-batch2.md) · [`ANALYSIS-graph…md`](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/ANALYSIS-graph-modules-consolidation.md) |
| 18 | **WO-PIPE-INCR** | **P1·地基** | 数据管线真增量同步(CDC/watermark·非全量重灌) + 运营态持续刷新(Scheduler+dataset.synced 事件→增量派生重算) | [`PRD-decision-support-maturity.md` §3.0①②](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/PRD-decision-support-maturity.md) |
| 19 | **WO-BUILDER-ROLE** | **P1·改造** | 数据构建发动机职责收敛：建域(onboarding) vs 运营态数据流分清；运营走 WO-PIPE-INCR；前端呈现两态 | [`PRD-decision-support-maturity.md` §3.0③](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/PRD-decision-support-maturity.md) |
| 20 | **WO-FRESHNESS** | P2·并入DM | 新鲜度→置信度贯通：扩 capacity C09 的 dataHealth.lagHours 为跨求解器新鲜度维·并入 dataMode(STALE)·UI 标"基于 N 小时前数据" | [`PRD-decision-support-maturity.md` §3.0④](https://github.com/kenlinwei001-a11y/complete/blob/claude/vigilant-knuth-b1nmxn/docs/PRD-decision-support-maturity.md) |

> **③类·需审核方先行后再派**（不在上表直派）：**轨O 主题/配色开关**（`HANDOFF-theme-switch-…md`·先由审核方真浏览器核"真缺到哪步"再交 dev，grep 可能漏报）· **WO-10② 真分核查**（`REVIEW-WO11-WO10b-verdict.md`·dev 复核分类器真分证据）。
> **审核方自留·非派发**（dev 修完后由审核方真跑）：P0-LOCK 修复复验 + T5 续跑真 PG 实拍 + d8498ae（§3③ 证据）复验。

## §2 · 逐单提示词（复制即用·发给开发 agent）

**WO-P0-LOCK（P0）**
```
你是开发 agent。实现 WO-P0-LOCK：修 PG 模式 execution_locks 写入崩（resource_kind NOT NULL）导致 rule-doc 抽取全失效。规格见 docs/WO-P0-lock-pg-fix.md（自包含·含根因/改 apps/datacore/src/repo/pg.ts 的 PgExecutionLockStore super() 补 extraColumns:{resource_kind,resource_key,holder_id,lease_until}/真 PG 回归测试/FDE 判据）。完成判据：真 PG 起 datacore，POST /a/v1/rule-docs(3 规则)→IN_REVIEW·candidateCount≥3 不再 PARTIAL；心跳真更新 lease_until 列；新增真 PG live-fire 回归并入 CI。红线：pnpm -r build(全4包)+pnpm -r test 全绿+真 PG 判据自验贴证；只推 claude/vigilant-knuth-b1nmxn；密钥仅 env；改锁语义回写 SYSTEM-ONTOLOGY.md；模型标识不入提交物。
```

**WO-T5-RESUME-LEASE（P1）**
```
你是开发 agent。实现 WO-T5-RESUME-LEASE：修 rule-doc 抽取重启续跑被死锁租约阻断。规格见 REVIEW-WO-P0-LOCK-closure-and-resume-finding.md §2。根因：进程崩在抽取中途，其 execution_locks 租约(rule_extraction=60min)未过期→重启时 resumeInflightExtractions→fireExtraction→withLock→acquire 命中未过期租约→SKIPPED→doc 卡 EXTRACTING 最长 60min。修向①(根因解)：resumeInflightExtractions 对每个遗留 EXTRACTING doc 先强制过期/夺取其锁再 fireExtraction（新进程启动时"在抽取中"doc 的锁必属已死进程·fencing 已防僵尸写），或给 withLock 续跑路径传 steal/force 选项。完成判据(真 PG)：杀 datacore 抽取中→立即重启→doc ≤一个抽取周期续到 IN_REVIEW（无需手动过期租约）·候选幂等不重复·fence 递增。红线：pnpm -r build+test 全绿+真 PG 续跑自验贴证(绿测试≠能用)；只推 claude/vigilant-knuth-b1nmxn；续跑须 steal 陈旧锁回写 SYSTEM-ONTOLOGY.md 执行语义；模型标识不入提交物。
```

**WO-PIPE-INCR（P1·地基）**
```
你是开发 agent。实现 WO-PIPE-INCR：数据管线真增量同步 + 运营态持续刷新。规格见 PRD-decision-support-maturity.md §3.0①②。① 把 connectors/registry.ts 声明的 incremental 能力落地：adapter 带 since/watermark，connectors/service.ts:192 sync 由 rawRows.replace(全量)改 delta upsert/合并(按 PK 只灌新增/变更行)；端点 POST /a/v1/connections/:id/sync?since=<watermark> 回执带新 watermark；无 incremental 能力的源回退全量(向后兼容)。② 连接器接既有 SchedulerService(cron·app.ts:334)定时增量同步→发 dataset.synced 事件(outbox)→触发受影响切片/派生增量重算(复用 recompute 非全量重建)。完成判据(真 PG/内存)：二次 sync?since= 只灌新增/变更行(watermark 前移·非全量)；定时增量同步真触发派生刷新。红线：pnpm -r build+test 全绿+真跑自验；双仓储四处同改;只推 claude/vigilant-knuth-b1nmxn；回写 SYSTEM-ONTOLOGY.md 数据流/事件章节(dataset.synced)；模型标识不入提交物。
```

**WO-BUILDER-ROLE（P1·发动机改造）**
```
你是开发 agent。实现 WO-BUILDER-ROLE：数据构建发动机职责收敛(改造非重写)。规格见 PRD-decision-support-maturity.md §3.0③。把 databuilder 七阶段(intake→comprehend→gap→rawin→transform→closure→publish)定位明确为冷启动/onboarding 建域引擎(保留全部能力含 BuildWorkflowRun/scaffold/growth)；运营态数据流走 WO-PIPE-INCR(增量同步+事件刷新)，发动机不背运营态持续职责；前端"数据构建发动机"页(DataBuilderPage)同步呈现两态：建域(onboarding)/运营管线(持续同步看板：各源 last sync/新鲜度/增量量/隔离行数)。完成判据：发动机职责文档+UI 两态清晰；运营态刷新不再误经一次性建域引擎；既有建域链回归不破。红线：pnpm -r build+test 全绿+真浏览器自验；只推 claude/vigilant-knuth-b1nmxn；回写 SYSTEM-ONTOLOGY.md §2.A 数据构建发动机职责；模型标识不入提交物。
```

**WO-FRESHNESS（P2·并入 WO-DM）**
```
你是开发 agent。实现 WO-FRESHNESS：数据新鲜度→置信度贯通。规格见 PRD-decision-support-maturity.md §3.0④。把 capacity.ts:189 C09(关键源 dataHealth.lagHours 滞后→P90 降级)的新鲜度维升为跨求解器：并入 dataMode(LIVE 但滞后→PARTIAL/STALE)；risk_timeline/态势/驾驶舱消费；UI 标「此决策基于 N 小时前的数据(源 X 滞后)」；立 pipeline-freshness:check 门(关键源 dataHealth 接进决策置信度·缺即红)。完成判据：关键源人为滞后→决策标 STALE+UI 显新鲜度；门红能挡未接新鲜度的关键源。红线：pnpm -r build+test 全绿+真跑自验；与 WO-DM(dataMode)协同；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-SCENE-A（P1·速胜）**
```
你是开发 agent。实现 WO-SCENE-A：规划体检对话入口不再「请换个问法」拒答。规格见 docs/WO-design-landing-items-1-2-3.md 的 item3·WO-SCENE-A。改 apps/agentcore/src/mocks/seed.ts:512 scn_plan_audit mode "WORKFLOW_ONLY"→"WORKFLOW_FIRST"（全表唯一 WORKFLOW_ONLY）；并审计其余入口 mode/defaultAgentId。完成判据：真浏览器规划体检入口问开放式管理问句不再拒答、回落 agent。红线：pnpm -r build+test 全绿+真浏览器自验；只推 claude/vigilant-knuth-b1nmxn；改场景/入口链回写 SYSTEM-ONTOLOGY.md §8 G-3；模型标识不入提交物。
```

**WO-SHARE17（P1·小）**
```
你是开发 agent。实现 WO-SHARE17：消除 PlanGenerateView 份额/收入显示值与求解器 ✓/✗ 闸门自相矛盾。规格见 docs/WO-design-landing-items-1-2-3.md 的 item1·WO-SHARE17。求解器 apps/datacore/src/solvers/plan.ts 在 outcome 下发 shareDelta(outcome.share-base.share)+revGrowthPct，契约补字段；前端 apps/frontend-shell/src/views/sim/PlanGenerateView.tsx:238/240/275 渲染该字段、删 -17/-100 魔数。完成判据：方案 C 显示份额 +Npct 逐位=闸门所用值；改 base.share 前端跟随。红线：pnpm -r build+test 全绿+真跑自验；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-CSS（P2）**
```
你是开发 agent。实现 WO-CSS：修 DAG 深字深底 + 立门防同类。规格见 docs/WO-design-landing-items-1-2-3.md 的 item2·WO-CSS。① apps/frontend-shell/src/components/InferenceProcessDag.module.css:60 fill:var(--text)→var(--txt)（--text 全仓零定义）；② 新增 scripts/check-css-vars.mjs（扫所有 .css 的 var(--X)，X 须∈tokens.css 定义集，否则红）并入 pnpm gates；③ 全站对比度审计（硬编码深 hex 作文本/fill 的低对比处改 token）。完成判据：真浏览器 DAG 标签浅色清晰；css-vars:check 故意引 var(--nope)→门红。红线：pnpm -r build+test 全绿；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-DM（P1·keystone）**
```
你是开发 agent。实现 WO-DM：dataMode 诚实位推广到全求解器契约（hollow-data 根问题解）。规格见 docs/WO-design-landing-items-1-2-3.md 的 item1·WO-DM（背景 REVIEW-hollow-data-iceberg-and-requeue.md §A0）。① packages/contracts/src/solvers.ts 给 PlanAuditOutputSchema/PlanGenerateOutputSchema 补 dataMode（同 RiskTimelineOutputSchema）；② 为 extended.ts 13 求解器建最小输出 schema(含 dataMode)并入 SOLVER_OUTPUT_SHAPES；③ 求解器走兜底魔数/哈希置 MOCK/PARTIAL、走真数据置 LIVE；④ UI 复用 RiskBoardView:79-90 徽章范式铺到 audit/generate/extended 落点；⑤ 新增 scripts/check-no-silent-mock.mjs（每 SOLVER_KEYS 输出 schema 须含 dataMode）并入 pnpm gates。完成判据：audit 卡带 dataMode 徽章、兜底数标 PARTIAL、漏 dataMode 的求解器门红。红线：pnpm -r build+test 全绿+真跑自验；只推 claude/vigilant-knuth-b1nmxn；回写 SYSTEM-ONTOLOGY.md §2.E/§7；模型标识不入提交物。
```

**WO-AStar（P1）**
```
你是开发 agent。实现 WO-AStar：预判推演看板「洛阳红色点开暂无数据」死路。规格见 REVIEW-hollow-data-iceberg-and-requeue.md §A-旗舰。根因：红/越线日源自 risk.ts:28 mockTightness charCode 哈希、非真订单；点红→RiskBoardView.tsx:462-491 AffectedOrdersModal searchObjects(base=洛阳,day) 命 0→裸 zh.common.none。修向：给 mock 因素补真数据源 OR 点击落「该红基于 mock 基线·无真订单」诚实面板，禁裸「暂无数据」。完成判据：洛阳 D+13 红→点开→真受影响订单非空 OR 明确诚实文案、绝不裸空。红线：pnpm -r build+test 全绿+真浏览器实拍自验；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-SCENE-B（P1·核心）**
```
你是开发 agent。实现 WO-SCENE-B：把规划体检配成完整场景 agent（试点·做模板）。规格见 docs/WO-design-landing-items-1-2-3.md 的 item3·WO-SCENE-B + HANDOFF-scene-entry-agent-config.md §3。定义场景级 agent agent_plan_audit（systemPrompt 基于本页规划/财务/物料数据·tools 限 plan_audit/plan_generate/mrp_netting/query_objects/get_object/discover·ruleBindings[C15,C16,C18,C21,C23]·skills 解读规划体检），出厂幂等播种；scn_plan_audit 设 defaultAgentId+presetContext(view:plan-audit,planVersion)+sliceTargets(plan 域切片)+intentFilter；答案带「部分数字未能溯源」诚实位。完成判据（真 Kimi 真浏览器）：问「需要做哪些管理事项才能完成？」→接地结构化答复(引本页真值+调 plan_audit/plan_generate+透出 C15/C18 裁决+三条管理事项)，非拒答/非泛答/非预算耗尽。红线：pnpm -r build+test 全绿+真浏览器实拍；只推 claude/vigilant-knuth-b1nmxn；回写 SYSTEM-ONTOLOGY.md §2.H/§3/§8 G-3；模型标识不入提交物。
```

**WO-DM-tail（P2）**
```
你是开发 agent。实现 WO-DM-tail：hollow-data A1-A4/B-MED 各求解器接真源或诚实标。规格见 REVIEW-hollow-data-iceberg-and-requeue.md §A1-A4/§B-MED。逐项：audit_timeline(risk.ts:392-424 哈希曲线)、yield_diagnosis(extended.ts:477 良率台阶)、credit_exposure/quote_margin(extended.ts:457/463 魔数)、maintenance_stagger(extended.ts:472 负荷)、SopBalance 兜底簇(SopBalanceView.tsx:26/288/615)——有真数据源就接、无则置 dataMode PARTIAL+UI 标「示例/部分估算」。依赖 WO-DM(契约 dataMode)先落。完成判据：各项 UI 带诚实徽章、无凭空业务数。红线：pnpm -r build+test 全绿+真跑自验；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**GATE-B（P2）**
```
你是开发 agent。实现 GATE-B：本地构建门补全（tsc-red 当绿出的根因解）。规格见 docs/DEV-TODO-reviewer-open-items.md §GATE-B。本地 pnpm gates 当前只构建 contracts+datacore(2/4)→前端/agentcore tsc-red 漏过；改 package.json gates 把两处 --filter ... build 换成 pnpm -r build；并确认 CI gates.yml(已跑 pnpm -r build)为分支保护必过项。完成判据：本地 pnpm gates 能复现前端 tsc-red(不再 2/4 漏)。红线：pnpm -r build+test 全绿；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-SCENE-C/D（P2/P3）**
```
你是开发 agent。实现 WO-SCENE-C/D：以 WO-SCENE-B 为模板把场景 agent 铺到 dash/risk/order/sop-balance… 各入口（各自数据上下文/规则/求解器子集），并立 scene-agent-config:check 门（每 PUBLISHED 视图对话入口须 mode≠WORKFLOW_ONLY 或显式只读+defaultAgentId 已发布+rules⊆已发布+solverMcpAllow⊆注册表+sliceTargets 可达，否则红），纳入场景 maturity=GOVERNED。规格见 docs/WO-design-landing-items-1-2-3.md 的 item3·WO-SCENE-C/D。完成判据：抽样≥3 入口接本页数据真答；半截配置入口→门红。红线：pnpm -r build+test 全绿+真浏览器抽验；只推 claude/vigilant-knuth-b1nmxn；回写 SYSTEM-ONTOLOGY.md G-3/G-9；模型标识不入提交物。
```

**WO-FORECAST-SIM（P1·合并 A★）**
```
你是开发 agent。实现 WO-FORECAST-SIM：推演接销售预测真源 + 合并 A★ 洛阳死路。规格见 docs/WO-design-landing-batch2.md 的 WO-FORECAST-SIM。① 求解器 apps/datacore/src/solvers/risk.ts 的 mockTightness(:28)/tensionSeries(:189 baseline) 紧张度改由真需求-产能缺口派生：需求侧 DemandSegment(forecast 域 p50/p90)+SopVersion.demand+订单近期实需，供给侧 capacity_forecast 产能曲线，紧张度=缺口/产能 over horizon（确定性 R6）；loadContext 注入 DemandSegment/SopVersion；RiskTimelineOutputSchema 已有 dataMode→接真源置 LIVE/无真预测 PARTIAL。② 前端 A★：RiskBoardView.tsx AffectedOrdersModal(:462-491) 点红→真订单非空 OR 诚实「mock 基线无真订单」面板，禁裸 zh.common.none(:491)。完成判据：改 DemandSegment/SopVersion→预判看板曲线变(非哈希)；洛阳 D+13 红点开真订单或诚实文案非裸空；缺口=预测需求−产能可溯。红线：pnpm -r build+test 全绿+真浏览器实拍；只推 claude/vigilant-knuth-b1nmxn；回写 SYSTEM-ONTOLOGY.md §3 数据→推演链(DemandSegment→risk_timeline)；模型标识不入提交物。
```

**WO-NAV-DATA（P2·小）**
```
你是开发 agent。实现 WO-NAV-DATA：导航「数据接入」→「数据」并收编源数据模块。规格见 docs/WO-design-landing-batch2.md 的 WO-NAV-DATA。改 apps/frontend-shell/src/pages/ShellLayout.tsx NAV_GROUPS：组名「数据接入」→「数据」(:38)，移入 order(从台账与地图:37)、data-builder(从构建与成长:53)；zh.ts external-signals label「外部信号」→「外部数据」；test/f61.admin-nav-groups.test.tsx 同步。完成判据：真浏览器「数据」组含 连接器/外部数据/规则文档/合成数据/数据构建发动机/订单台账/隔离区；空组隐藏正常。红线：pnpm -r build+test 全绿+真浏览器自验；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-NAV-SANDBOX（P2·小）**
```
你是开发 agent。实现 WO-NAV-SANDBOX：推演沙盘并入「推演」组。规格见 docs/WO-design-landing-batch2.md 的 WO-NAV-SANDBOX。改 ShellLayout.tsx：把游离的 sim-sandbox/sim-init 特殊 nav 项并入「推演」组(NAV_GROUPS 推演组 :36)，保留 sim.sandbox entitlement 门控显隐(SimSandboxGuard 不动)。完成判据：真浏览器「推演」组=项目沙盘/预判看板/订单全链/交互沙盘/沙盘初始化；关 sim.sandbox→沙盘项消失(R3 不破)。红线：pnpm -r build+test 全绿+真浏览器自验；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-QUARANTINE（P3·小）**
```
你是开发 agent。实现 WO-QUARANTINE：隔离区空态诚实文案 + 真值演示。规格见 docs/WO-design-landing-batch2.md 的 WO-QUARANTINE。背景：隔离区真接线(modeling.ts:537-557 坏行真路由)、空因合成数据洁净(R6)、勿删。① QuarantinePage 空态文案改「无异常行（合成数据洁净；真实上传的坏行将在此排队修复）」；② 可选真值演示：传含重复+缺主键行的 CSV→connectors.upload→materialize→坏行落隔离区→reprocess 修好，或 seed 2-3 条 demo 隔离行(诚实标示例)。完成判据：空态文案诚实；真值演示则坏行真落隔离区(GET /a/v1/quarantine 非空)可 reprocess。红线：pnpm -r build+test 全绿+真浏览器自验；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-GRAPH-1（P2·先做·低风险）**
```
你是开发 agent。实现 WO-GRAPH-1：抽统一「过程 DAG」渲染组件。规格见 docs/WO-design-landing-batch2.md 的图谱融合·WO-GRAPH-1（母单 ANALYSIS-graph-modules-consolidation.md 类型B）。把 components/InferenceProcessDag.tsx / ProvenanceDag.tsx / DataBuilderPage FdeGraph / components/Dag/LayeredDag.tsx 的 SVG 渲染抽成一个共享组件（统一 par/conv/seq/aux/fb 边样式+节点 IPO 抽屉 DagNodeDrawer+缺口红标+缩放），四处入口/数据/语义不动、只换渲染层。完成判据：四处 DAG 同组件渲染、视觉/交互一致(截图对比)、各自入口/数据不变；InferenceProcessDag 对比度修(WO-CSS)随迁不回潮。红线：pnpm -r build+test 全绿+真浏览器截图对比；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-GRAPH-2（P2）**
```
你是开发 agent。实现 WO-GRAPH-2：抽统一「本体图谱引擎」。规格见 docs/WO-design-landing-batch2.md 的 WO-GRAPH-2。把 views/OntologyGraphView.tsx 的 forceLayout 抽成可复用图引擎（节点/边/力导布局/DagNodeDrawer/域配色[14域 R14 配置驱动]/缩放/框选），数据实时派生自本体发布(fetchOntologyGraph)；OntologyGraphView 改用新引擎。完成判据：OntologyGraphView 用新引擎渲染、实时取已发布本体不变；引擎可被 WO-GRAPH-3 复用。红线：pnpm -r build+test 全绿+真浏览器自验；只推 claude/vigilant-knuth-b1nmxn；模型标识不入提交物。
```

**WO-GRAPH-3/4（P3·依赖 WO-GRAPH-2）**
```
你是开发 agent。实现 WO-GRAPH-3/4：融合本体图谱主入口 + 沙盘/元本体/边界/图查询接同引擎。规格见 docs/WO-design-landing-batch2.md 的 WO-GRAPH-3/4 + ANALYSIS-graph-modules-consolidation.md §6。依赖 WO-GRAPH-2 图引擎先落。SlicesPage/Object360 血缘/KsfGraph 接入图引擎(模式切换 结构/切片/血缘/域)，ModelingPage 改为图编辑态；PmDag 沙盘传导=引擎+state 叠加；MetaPage 元本体/BoundaryPage 边界=同引擎换数据源；图查询 U12(PlatformConsole)=图上查询模式(后端建好后)。完成判据：本体图谱主入口模式切换覆盖结构/切片/血缘、各入口渲染一致数据各自真实。红线：中等重构·先 GRAPH-1/2 验证可行再做(START-HERE §3 不盲建)；pnpm -r build+test 全绿+真浏览器自验；只推 claude/vigilant-knuth-b1nmxn；回写 SYSTEM-ONTOLOGY.md §2.B/§10.3；模型标识不入提交物。
```

---
*审核方派发清单（design+review·非 dev 实装）· dev 实装贴证后审核方按各单 FDE 判据独立真跑复验核发 · 仅 `claude/vigilant-knuth-b1nmxn`*
