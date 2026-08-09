/**
 * 数据流闭环与联动刷新（PRD-addendum-dataflow-loop-closure，裁决 #28 / W45）。
 *
 * 此前缺失的"消费页订阅声明 + 刷新路由"接线层：每个领域事件 → 应失效/刷新的下游消费视图
 * （前端 TanStack Query 缓存按 invalidates key 失效）。本注册表是该接线的**单一来源**，
 * 经 GET /b/v1/event-subscriptions 下发给前端缓存失效路由。不新建消息系统——事件由既有
 * outbox（执行语义）+ 通知中心（运营完备性）产出，本层只声明"谁订阅谁、怎么反映"。
 *
 * D-29：任何"产出型操作"（上传/发布/生成/审批/tick）完成必须发对应领域事件，其下游消费页
 * 必须订阅并在 ≤SLO（事件 60s / 配置 TTL 5min）内反映；禁止"需重登/手动重查才更新"。
 */

/** 前端反映三档（§3-2）。 */
export type PropagationTier = "IMMEDIATE" | "IN_SESSION" | "NOTIFY";

export interface EventSubscription {
  /** 领域事件名（与 outbox/通知中心一致）。 */
  event: string;
  /** 产出型操作（D-29 的"谁发的"）。 */
  producer: string;
  tier: PropagationTier;
  /** 下游应失效/刷新的消费视图或查询 key（前端缓存失效路由消费）。 */
  invalidates: string[];
  /** 关联断链审计项（§4 DL#）。 */
  dl?: string;
}

export const EVENT_SUBSCRIPTIONS: EventSubscription[] = [
  // L1 数据接入环 / DL1 / DL2
  { event: "raw_dataset.uploaded", producer: "连接器·上传结构化文件", tier: "IN_SESSION", invalidates: ["raw-datasets", "modeling.dataset-picker"], dl: "DL1" },
  { event: "ontology.published", producer: "本体发布", tier: "IN_SESSION", invalidates: ["object-types", "dashboard", "scenario-data", "derivation"], dl: "DL2" },
  { event: "derivation.completed", producer: "派生管线", tier: "IN_SESSION", invalidates: ["dashboard", "risk", "scenario-data", "object-queries"] },
  { event: "materialize.completed", producer: "对象化作业", tier: "IN_SESSION", invalidates: ["dashboard", "object-queries", "scenario-data"] },
  // L2 时序环
  { event: "ts.ingested", producer: "时序上传/连接器", tier: "IN_SESSION", invalidates: ["dashboard.curves", "solver-inputs"] },
  // L3 规则文档环 / DL3
  { event: "rules.updated", producer: "规则发布", tier: "IN_SESSION", invalidates: ["rule-library", "agent-editor.rule-bindings", "workflow-editor.rule-bindings"], dl: "DL3" },
  // L4 配置发布环
  { event: "workflow.published", producer: "工作流发布", tier: "IN_SESSION", invalidates: ["intent-editor.workflow-bindings", "agent-editor.tool-bindings", "workflow-list"] },
  { event: "agent.published", producer: "Agent 发布", tier: "IN_SESSION", invalidates: ["agent-editor.tool-bindings"] },
  { event: "skill.published", producer: "技能发布（DF-5·补 B 栈资源发布信号）", tier: "IN_SESSION", invalidates: ["agent-editor.skill-bindings", "agent-editor.tool-bindings", "skill-list"] },
  { event: "intent.published", producer: "意图发布", tier: "IN_SESSION", invalidates: ["scene-entry.intent-filter", "scenarios", "intent-catalog"] },
  { event: "scene_entry.updated", producer: "场景入口编辑", tier: "IN_SESSION", invalidates: ["scenarios", "scene-entries"] },
  { event: "scenario.published", producer: "场景发布（升一等对象）", tier: "IN_SESSION", invalidates: ["scenarios", "scene-entries", "intent-catalog"] },
  { event: "scenario.retired", producer: "场景退役", tier: "IN_SESSION", invalidates: ["scenarios", "scene-entries", "intent-catalog"] },
  { event: "scenario.growth_triggered", producer: "场景发育闭环·缺件 grow 触发 runGrowthLoop（O9）", tier: "IN_SESSION", invalidates: ["scenarios", "growth-ledger", "growth-tickets"] },
  // L5 行动环 / DL4
  { event: "action.pending_approval", producer: "Action 草稿提交", tier: "NOTIFY", invalidates: ["notifications", "approval-inbox"] },
  { event: "action.executed", producer: "Action 写回执行", tier: "IN_SESSION", invalidates: ["dashboard", "object-queries"], dl: "DL4" },
  { event: "writeback.divergence", producer: "回声对账", tier: "NOTIFY", invalidates: ["notifications", "dashboard"], dl: "DL4" },
  // WO-C1 · L2 决策内核（根因→方案→选定→落 Action 一条龙）
  { event: "decision.created", producer: "WO-C1 决策内核·建 Decision(PROPOSED·bundling gap_attribution+decision_play)", tier: "IN_SESSION", invalidates: ["decisions", "decision-page"] },
  { event: "decision.committed", producer: "WO-C1 决策内核·commit Decision(COMMITTED·派 ActionDraft 走 S2)", tier: "IN_SESSION", invalidates: ["decisions", "decision-page", "approval-inbox"] },
  // L6 学习环 / DL5
  { event: "calibration.applied", producer: "校准提案批准", tier: "IN_SESSION", invalidates: ["calibration-report", "solver-params"], dl: "DL5" },
  // L7 孵化环 / DL6
  { event: "intent.promoted", producer: "兜底孵化 promote", tier: "IN_SESSION", invalidates: ["intent-catalog", "fallback-stats"], dl: "DL6" },
  // L8 合成环 / DL7
  { event: "synthetic.tick_completed", producer: "模拟时钟 tick", tier: "IN_SESSION", invalidates: ["dashboard", "risk", "scenario-data", "calibration-report"], dl: "DL7" },
  { event: "dataset.regenerated", producer: "合成数据生成", tier: "IN_SESSION", invalidates: ["dashboard", "risk", "scenario-data", "ontology-graph", "rule-library"] },
  { event: "connection.sync_completed", producer: "连接器同步", tier: "IN_SESSION", invalidates: ["dashboard", "scenario-data", "object-queries"], dl: "DL9" },
  { event: "connector.sync_failed", producer: "连接器同步失败", tier: "IN_SESSION", invalidates: ["connectors", "quarantine"], dl: "DL9" },
  { event: "connection.created", producer: "连接器创建（A11 带 category）", tier: "IN_SESSION", invalidates: ["connectors", "data-categories"] },
  { event: "slice.planned", producer: "切片规划器（A3.4 规划/复用）", tier: "IN_SESSION", invalidates: ["slice-library", "slice-index"] },
  // L9 知识环 / DL10
  { event: "kb.indexed", producer: "知识库上传索引", tier: "IN_SESSION", invalidates: ["kb-search", "search-test"], dl: "DL10" },
  // L10 实体解析环 / DL8
  { event: "objects.merged", producer: "实体合并", tier: "IN_SESSION", invalidates: ["object-queries", "dashboard", "search"], dl: "DL8" },
  { event: "merge_candidate.created", producer: "实体解析增量跑", tier: "NOTIFY", invalidates: ["notifications", "merge-queue"] },
  { event: "growth.gap_detected", producer: "自成长发动机·探针检出缺口", tier: "IN_SESSION", invalidates: ["growth-ledger"] },
  { event: "growth.fill_proposed", producer: "自成长发动机·补法分派（缺数据正门/缺求解器 B 兜底）", tier: "IN_SESSION", invalidates: ["growth-ledger"] },
  { event: "growth.ticket_opened", producer: "自成长发动机·缺功能落工单", tier: "NOTIFY", invalidates: ["growth-tickets", "notifications"] },
  { event: "growth.converged", producer: "自成长发动机·LOOP 收敛（问句现可答）", tier: "IN_SESSION", invalidates: ["growth-ledger", "growth-tickets"] },
  { event: "quarantine.row_added", producer: "隔离区入库", tier: "NOTIFY", invalidates: ["notifications", "quarantine"] },
  // L16 感知层环：用户实体在本租户任何已发布类型都解析不到 → 域外信号（最近邻候选 + 误触发率埋点）
  { event: "entity.out_of_domain", producer: "感知层·槽位解析（裸串实体域外）", tier: "NOTIFY", invalidates: ["perception-metrics"] },
  // L11 权限环 — 换账号即全链过滤（登录态切换，非事件）
  { event: "policy.updated", producer: "权限策略变更", tier: "IN_SESSION", invalidates: ["dashboard", "search", "scenario-data", "history"], dl: "DL11" },
  // L12 功能开通环
  { event: "features.updated", producer: "功能开通配置", tier: "IN_SESSION", invalidates: ["workspace", "navigation", "scenarios", "intent-catalog"], dl: "DL12" },
  // L15 数据构建发动机环：故事建域记录完成 → 失效历史推演记录/模块同步矩阵（经 F1 全局通道反映）
  { event: "storybuild.run_recorded", producer: "数据构建发动机·故事建域记录完成", tier: "IN_SESSION", invalidates: ["story-runs"] },
  // L15 A5 FDE 编排工作流：节点状态变更（comprehend/查能力/比差/生成/闭包/publish/进启动器）→ 实时点亮节点图
  { event: "fde.node_advanced", producer: "FDE 编排工作流·节点状态推进（A5 可观测节点图）", tier: "IN_SESSION", invalidates: ["fde-graph", "story-runs", "workflow-runs"] },
  // L15 A7 B 栈 scaffold 单机可见：清单落 DataCore（不依赖 B 在线）+ B 上线幂等对账
  { event: "scaffold.manifest_recorded", producer: "数据构建发动机·B 栈 scaffold 清单落库（A7 单机可见）", tier: "IN_SESSION", invalidates: ["scaffold-manifest", "story-runs", "workflow-runs"] },
  { event: "scaffold.reconciled", producer: "数据构建发动机·B 栈 scaffold 上线对账（A7）", tier: "IN_SESSION", invalidates: ["scaffold-manifest", "story-runs"] },
  // L15 A10 终态闭环：建域→publish→自动/手动重跑主问句验证"真能答了" → 回灌 FDE 节点图末节点 + 成长账本（runId 归一）
  { event: "build.verified", producer: "数据构建发动机·终态闭环验证（A10 publish 后重跑主问句）", tier: "IN_SESSION", invalidates: ["story-runs", "fde-graph", "growth-ledger"] },
  // L15 prototype-intake 正门：上传原型 → 确定性抽数据/关系 → 对账预览（映射不上生成候选给人确认）
  { event: "prototype.intake_recorded", producer: "原型 intake 正门·解析数据表+关系完成（schema 对账预览）", tier: "IN_SESSION", invalidates: ["intake-preview", "reconcile-queue"] },
  // L15 prototype-intake P2：schema 对账候选人确认（USE/RENAME/NEW/MERGE/DISCARD）→ 失效对账队列
  { event: "schema_reconcile.resolved", producer: "原型 intake·schema 对账候选人确认（P2 HITL）", tier: "IN_SESSION", invalidates: ["reconcile-queue"] },
  // L15 A18 未审核态：PROVISIONAL 建域完成（域强标 UNVERIFIED，闭包 ADVISORY 不阻断）→ 失效历史/审核台
  { event: "domain.provisional_built", producer: "数据构建发动机·PROVISIONAL 未审核态建域完成（A18 双模闭包）", tier: "IN_SESSION", invalidates: ["story-runs", "provisional-review"] },
  // L15 A18.2 LLM 临时求解器：生成 + 锁死沙箱跑通 → 注册 PROVISIONAL（未审核·UNVERIFIED）→ 失效求解器目录/审核台
  { event: "solver.provisional_generated", producer: "求解器·LLM 临时生成沙箱跑通注册 PROVISIONAL（A18.2）", tier: "IN_SESSION", invalidates: ["solver-registry", "provisional-review"] },
  // L15 A18.4 晋升：临时求解器人工审批 PROVISIONAL→GOVERNED（解锁写真值）→ 失效求解器目录/审核台
  { event: "solver.status_changed", producer: "求解器·临时件状态推进/晋升 GOVERNED（A18.4）", tier: "IN_SESSION", invalidates: ["solver-registry", "provisional-review"] },
  // L15 A18.4 整域晋升编排：PROVISIONAL 域人工审批 → 隔离数据迁入真租户 + 逐制品晋升求解器 → 失效历史/审核台/对象库
  { event: "domain.promoted", producer: "数据构建发动机·PROVISIONAL 整域晋升 GOVERNED（A18.4 编排：迁移隔离域+逐制品晋升）", tier: "IN_SESSION", invalidates: ["story-runs", "provisional-review", "object-queries", "solver-registry"] },
  // L17 SPINE 经营目标-指标-责任骨架：指标快照回采（actual 更新）/ 指标越线（触发推演）→ 失效驾驶舱/各视图 KPI/风险页
  { event: "metric.snapshot_recorded", producer: "SPINE·指标快照回采（metric_rollup 实算 actual → 执行回采更新口径，SPINE.2）", tier: "IN_SESSION", invalidates: ["metrics", "dashboard", "scenario-data"] },
  { event: "metric.breached", producer: "SPINE·指标越线（actual<floor → 触发 plan_rootcause/risk_timeline 推演，SPINE.2）", tier: "NOTIFY", invalidates: ["metrics", "dashboard", "risk", "notifications"] },
  // L18 推演沙盘环（A10 · 断点 G-SIM-EVENT-NOSUB）：datacore 六处 outbox.emit("sim.*")。
  { event: "sim.scenario_saved", producer: "推演沙盘·方案快照存盘/存分支（POST /a/v1/sim/scenarios · /a/v1/sim/live-scenarios）", tier: "IN_SESSION", invalidates: ["sim-scenarios"] },
  // ── WO-L4B（欠账 #145）：补订阅方 —— 上面那条注释原先写「另四个故意不登记，因为沙盘态全在 useState」。
  // 复核后那个理由只对了一半：后端 GET /a/v1/sim/sessions（app.ts:1405）与 …/:id/world（app.ts:1410）
  // 一直都在，缺的是**前端那一跳**（endpoints.ts 当时只有 POST createSimSession；simWorld 有定义，但 src 下没有任何调用点，只有测试桩）。
  // 现已接成 SandboxView 的 sessionsQuery / worldQuery 两条真 useQuery，故三条转正式登记。
  { event: "sim.session_created", producer: "推演沙盘·建会话（POST /a/v1/sim/sessions · app.ts:1397）", tier: "IN_SESSION", invalidates: ["sim-sessions"] },
  { event: "sim.branched", producer: "推演沙盘·从检查点分支出子世界（POST /a/v1/sim/sessions/:id/branch · app.ts:1516）", tier: "IN_SESSION", invalidates: ["sim-sessions"] },
  // tick 同一处理器在 emit 前写了 status=RUNNING + curTick（app.ts:1465），世界列表显示的正是这两个字段 → 两个标签都失效。
  { event: "sim.tick_completed", producer: "推演沙盘·推进 tick（POST /a/v1/sim/sessions/:id/tick · app.ts:1467）", tier: "IN_SESSION", invalidates: ["sim-world", "sim-sessions"] },
  // sim.checkpoint_saved **仍不登记**：datacore 没有列出检查点的路由（listCheckpoints 仓储层写好了，但 route 层从不调用），
  // 前端无列表可缓存。理由与解法逐条记在 frontend-shell/src/store/eventInvalidation.ts 的 SIM_EVENT_GAPS。
];

/** 按消费视图反查订阅（前端某页声明它依赖哪些事件）。 */
export function subscriptionsForView(view: string): EventSubscription[] {
  return EVENT_SUBSCRIPTIONS.filter((s) => s.invalidates.includes(view));
}
