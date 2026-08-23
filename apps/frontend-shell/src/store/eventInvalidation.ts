import { queryClient } from "./queryClient";

/**
 * 响应式失效环（前端消费端，对应本体 §4 / AgentCore event-subscriptions.ts）：
 * 一处配置发布 → 失效下游引用方缓存 → 引用它的页面自动重取（"修改了数据/规则 →
 * 引用的 workflow/agent 自动更新 → 调用它们的场景推演逻辑/数据也自动更新"）。
 *
 * 后端 event-subscriptions 是事件→语义标签的单一来源；前端只负责把语义标签映射到
 * 实际 TanStack queryKey 前缀（这是前端缓存策略，天然属前端）。改了后端 invalidates
 * 语义标签时，同步增补 LABEL_TO_KEYS 即可。
 */
const LABEL_TO_KEYS: Record<string, readonly (readonly string[])[]> = {
  "rule-library": [["a", "rules"]],
  "agent-editor.rule-bindings": [["b", "agents"]],
  "workflow-editor.rule-bindings": [["b", "workflows"]],
  "agent-editor.tool-bindings": [["b", "agents"]],
  "intent-editor.workflow-bindings": [["b", "intents"], ["b", "workflows"]],
  "workflow-list": [["b", "workflows"]],
  scenarios: [["b", "scenarios"]],
  "scene-entries": [["b", "scenes"], ["b", "scenarios"]],
  "scene-entry.intent-filter": [["b", "scenes"], ["b", "scenarios"]],
  "intent-catalog": [["b", "intents"]],
  // 数据/本体环：场景推演数据随之失效（一键推演结果、对象库、驾驶舱）。
  "scenario-data": [["b", "scenarios"], ["a", "objects"], ["b", "queries"]],
  "object-types": [["a", "object-types"], ["a", "view-configs"]],
  "object-queries": [["a", "objects"]],
  dashboard: [["a", "dashboard"]],
  "solver-params": [["a", "calibration"], ["b", "scenarios"]],
  "story-runs": [["a", "story-runs"], ["a", "build-jobs"]],
  "growth-ledger": [["b", "growth-ledger"]],
  "growth-tickets": [["b", "growth-tickets"]],
  // 沙盘方案快照环（A10）：存方案/存分支（POST /a/v1/sim/live-scenarios、POST /a/v1/sim/scenarios）
  // → 方案列表 + 横比矩阵失效。两个 key 都取自 RiskBoardView 的真实 useQuery（见 SIM_CONSUMER_KEYS）：
  //   ["a","live-scenarios", baseId]                 RiskBoardView.tsx:1073
  //   ["a","live-scenario-compare", baseId, ids]     RiskBoardView.tsx:1086
  // 前缀失效（TanStack 前缀匹配）故此处只写到 baseId 之前那一段。
  "sim-scenarios": [["a", "live-scenarios"], ["a", "live-scenario-compare"]],
  // WO-L4B 沙盘会话环（欠账 #145）：世界列表 / 当前世界态两条真 useQuery（SandboxView）。
  //   ["a","sim-sessions"]            SandboxView.tsx sessionsQuery（世界列表 rail）
  //   ["a","sim-world", sessionId]    SandboxView.tsx worldQuery（当前世界态·前缀失效盖住所有会话）
  "sim-sessions": [["a", "sim-sessions"]],
  "sim-world": [["a", "sim-world"]],
  // WO-ENTERPRISE-STATE · 企业状态快照（真消费方 = views/sim/EnterpriseStatePanel.tsx 的
  // `useQuery(["a","enterprise-states", worldId])`；前缀失效盖住所有世界）。
  "enterprise-states": [["a", "enterprise-states"]],
  // WO-SIM-PERTURB-TIMELINE：扰动清单/时间轴（PerturbationTimeline 的 listQuery）。
  //   ["a","sim-perturbations", sessionId]   PerturbationTimeline.tsx listQuery
  // 真 key 尾带 sessionId，靠前缀失效盖住（与 sim-world 同款）。
  "sim-perturbations": [["a", "sim-perturbations"]],
  // WO-EVENT-SUB-CLOSURE：存档清单（SandboxView 的 checkpointsQuery，WO-BEFE-E 建的缓存）。
  //   ["a","sim-checkpoints", sessionId]   SandboxView.tsx checkpointsQuery
  // 真 key 尾带 sessionId，靠前缀失效盖住（与 sim-world / sim-perturbations 同款）。
  "sim-checkpoints": [["a", "sim-checkpoints"]],
  // WO-FLOWTIME · 流程实例与站间流转时长。
  // 真消费方 = `views/process/ProcessWaitView.tsx` 的 `InstancePanel`：
  //   ["a","process-instances", processKey]   useQuery（下钻面板）
  // 真 key 尾带 processKey，靠前缀失效盖住全部流程（与 sim-world 同款）。
  // ⚠ 这一行是 `process.instance_entered` / `process.instance_stuck` 两个事件**唯一**的
  //    落地点：删了它，那两条订阅就退化成「有事件没人听」的假接线。
  "process-instances": [["a", "process-instances"]],
};

/**
 * 沙盘方案环的**真实消费方查询键前缀**（A10 接缝的另一端）。
 * 这不是给运行时用的——它是给接缝测试用的锚：测试同时咬住"表里写了什么"与
 * "视图真的用什么 key 注册 useQuery"，视图改名而表没跟 → 测试红（防表漂移）。
 */
export const SIM_CONSUMER_KEYS = {
  /** RiskBoardView · CapacityScenarioPanel 方案列表。 */
  liveScenarioList: ["a", "live-scenarios"],
  /** RiskBoardView · CapacityScenarioPanel decision_play 横比矩阵。 */
  liveScenarioCompare: ["a", "live-scenario-compare"],
  /** SandboxView · 世界列表（主线 + 各分支子会话）。 */
  simSessionList: ["a", "sim-sessions"],
  /** SandboxView · 当前世界态（tick + state）；真 key 尾带 sessionId，靠前缀失效盖住。 */
  simWorld: ["a", "sim-world"],
  /** PerturbationTimeline · 扰动清单/时间轴；真 key 尾带 sessionId，同样靠前缀失效盖住。 */
  simPerturbations: ["a", "sim-perturbations"],
  /** SandboxView · 存档清单（WO-BEFE-E 的 checkpointsQuery）；真 key 尾带 sessionId，前缀失效盖住。 */
  simCheckpoints: ["a", "sim-checkpoints"],
} as const;

/**
 * `sim.*` 缺口台账（A10 诚实报缺）——**故意不接线**的事件及其理由。
 *
 * 判据不是"懒得接"，是**今天前端根本没有承载它的缓存**。给它们硬塞一个订阅 = 假接线
 * （#90/#92 同族），比不接更坏——所以在此登记，并由 `sim-event-invalidation.seam` 测试
 * 逐条守住：新增 `sim.*` emit 而两边都没登记 → 红。
 *
 * ── WO-L4B（欠账 #145）：本台账从 4 条缩到 1 条 ────────────────────────────────
 * 原先 4 条共用一个理由「沙盘态全落在 SandboxView 的 useState，不经 Query 缓存」。
 * 那不是"改不了"，那是**缺前端这一跳**——后端 `GET /a/v1/sim/sessions`（app.ts:1405）
 * 与 `GET /a/v1/sim/sessions/:id/world`（app.ts:1410）一直都在。本单把这两条接成真
 * useQuery（SandboxView 的 sessionsQuery / worldQuery），于是
 * `sim.session_created` / `sim.branched` / `sim.tick_completed` **三条转为真接线**，
 * 见 EVENT_INVALIDATES。
 *
 * ── WO-EVENT-SUB-CLOSURE（2026-08-20）：本台账**今日为空** ──────────────────────────
 * 最后一条 `sim.checkpoint_saved` 已按前任写死的出台账条件逐条达成后转出：
 *   ① 后端读端 `GET /a/v1/sim/sessions/:id/checkpoints` —— WO-ENGINE-2 件二（2026-08-13）已开；
 *   ② 前端真缓存 —— WO-BEFE-E 的 `checkpointsQuery`（`["a","sim-checkpoints",sessionId]`，
 *      SandboxView「存档与回滚」格）早已挂载，本单之前它只靠发起方本地失效，跨标签页收不到；
 *   ③ agentcore event-subscriptions 同步登记 —— 本单补上。
 * 三件齐备 ⇒ 硬接不再是假接线，本条挪进 EVENT_INVALIDATES 接 `["sim-checkpoints"]`。
 * ⚠ 台账机制**保留**：今后新增 `sim.*` emit 而当天没有可失效的缓存，先登记进本台账
 *   并写清「为什么今天不接线」（`sim-event-invalidation.seam` 测试④⑤守着：要么接线要么记账）。
 */
export const SIM_EVENT_GAPS: Record<string, string> = { // hardcoded-data-allow —— 缺口台账（散文），非业务数据：值是「今天为什么不接线」的说明文字，探测器 B 数到的数字全部来自其中的 file:line 引用。
  // ── 历史留档（理由原文已随条目出台账而移除，来龙去脉见上方头注与 git 历史）──────────────
  // · sim.session_created / sim.branched / sim.tick_completed —— WO-L4B（2026-08-09）接线转出；
  // · sim.perturbation_created —— WO-SIM-PERTURB-TIMELINE（2026-08-10）先读端后事件转出；
  // · sim.checkpoint_saved —— WO-EVENT-SUB-CLOSURE（2026-08-20）三件齐备转出（见头注）。
};

/**
 * 事件 → 其失效的语义标签（与后端 event-subscriptions 同源；此处内联 L3/L4 + 数据环的关键事件）。
 * 缺失的事件直接忽略（不抛错）。
 */
export const EVENT_INVALIDATES: Record<string, readonly string[]> = { // hardcoded-data-allow —— 事件→语义标签的路由表，非业务数据：键是领域事件名、值是缓存标签，与 agentcore event-subscriptions 单源同步。探测器 B 数到的「数值字面量」来自事件名/标签里的序号，不是业务数字。
  "rules.updated": ["rule-library", "agent-editor.rule-bindings", "workflow-editor.rule-bindings", "scenario-data"],
  "workflow.published": ["intent-editor.workflow-bindings", "agent-editor.tool-bindings", "workflow-list", "scenario-data"],
  "agent.published": ["agent-editor.tool-bindings", "scenario-data"],
  "intent.published": ["scene-entry.intent-filter", "scenarios", "intent-catalog"],
  "scenario.published": ["scenarios", "scene-entries", "intent-catalog"],
  "scenario.retired": ["scenarios", "scene-entries", "intent-catalog"],
  "ontology.published": ["object-types", "dashboard", "scenario-data"],
  "derivation.completed": ["dashboard", "scenario-data", "object-queries"],
  "materialize.completed": ["object-queries", "scenario-data"],
  // D-29 实时环 F2：以下事件由后端 outbox 真实发出（datacore），经 F1 全局轮询交付到被动页面。
  "synthetic.tick_completed": ["dashboard", "object-queries", "scenario-data"],
  "action.executed": ["object-queries", "dashboard", "scenario-data"],
  "calibration.proposed": ["solver-params"],
  "calibration.rolled_back": ["solver-params"],
  "objects.merged": ["object-queries", "scenario-data"],
  "storybuild.run_recorded": ["story-runs"],
  "growth.gap_detected": ["growth-ledger"],
  "growth.fill_proposed": ["growth-ledger"],
  "growth.ticket_opened": ["growth-tickets", "growth-ledger"],
  "growth.converged": ["growth-ledger", "growth-tickets"],
  // A10 沙盘方案环：datacore app.ts:1725（/a/v1/sim/scenarios）与 app.ts:1781（/a/v1/sim/live-scenarios）
  // 两处 emit 同名事件。补这条修的是**真陈旧**：RiskBoardView 存方案后只本地失效了 live-scenarios，
  // 横比矩阵 ["a","live-scenario-compare",…] 从来没人失效过（连发起方那一页都陈旧）；
  // 且经 F1 全局轮询，别的标签页/别的用户现在也能收到。
  "sim.scenario_saved": ["sim-scenarios"],
  // ── WO-L4B 沙盘会话环（欠账 #145）：三条此前"发了没人收"的事件转真接线 ──────────────
  // 建会话（datacore app.ts:1397）→ 世界列表多一行。
  "sim.session_created": ["sim-sessions"],
  // 分支（app.ts:1516）→ 世界列表多一个子世界。这条修的是**真丢**：此前子会话 id 只落
  // SandboxView 的 useState(branchId)，刷新即丢、别的标签页根本看不见分叉出来的世界。
  "sim.branched": ["sim-sessions"],
  // 推进 tick（app.ts:1467）→ ① 当前世界态变了；② 会话行本身也变了——同一处理器在 emit 前
  // 写了 `s.status = "RUNNING"` + `curTick`（app.ts:1465 putSession），世界列表显示的就是这两个字段。
  // 所以两个标签都失效，不是凑数。
  "sim.tick_completed": ["sim-world", "sim-sessions"],
  // ── WO-ENTERPRISE-STATE 企业状态快照环 ─────────────────────────────────────────
  // 这两条**不是"发了没人收"**：真消费方是 `views/sim/EnterpriseStatePanel.tsx` 的
  // `useQuery(["a","enterprise-states", worldId])`（沙盘右栏「企业状态快照」，SandboxView rail 挂载）。
  // 捕获（datacore twin/enterprise-state.ts capture）→ 该世界多一份快照 ⇒ 面板重取显示新的逻辑时刻；
  // fork（同文件 fork）→ 仿真世界多一份快照 ⇒ 同一缓存前缀失效（key 尾带 worldId，靠前缀盖住所有世界）。
  // ⚠ 若将来把面板删了/改了 queryKey，这两条就变成假接线，必须同时从这里挪进 SIM_EVENT_GAPS 台账。
  "enterprise_state.snapshotted": ["enterprise-states"],
  "enterprise_state.forked": ["enterprise-states"],
  // ── WO-SIM-PERTURB-TIMELINE：施加/排期一条扰动（datacore app.ts:1626）───────────────
  // 两个标签都不是凑数，各有各的实据：
  //  · `sim-perturbations` —— 清单真的多一条（本单新建的 PerturbationTimeline listQuery 承载它）；
  //  · `sim-world`         —— 同一个处理器在 emit 前会**改世界态**：`isPerturbationActiveAt(p, curTick)`
  //    为真时走 `simApplyAtCurrentTick` → `putTickState`（app.ts:1624），于是别的标签页的
  //    `GET …/world` 已经陈旧。诚实说清代价：**排期到未来 tick 的扰动不改世界态**，
  //    而 `invalidateForEvent(event)` 只收事件名、拿不到 payload 里的 `startTick`，
  //    无法只对"已生效"那半失效 ⇒ 这种情况下的重取是一次空跑。
  //    两害相权取"多一次重取"，不取"屏上停在一个已经不对的世界"。
  "sim.perturbation_created": ["sim-perturbations", "sim-world"],
  // ── WO-EVENT-SUB-CLOSURE（2026-08-20）：存档检查点 —— 最后一个 sim.* 缺口闭环 ─────────
  // 存档（datacore app.ts POST …/:id/checkpoint）→ 那个会话的存档清单多一行。
  // 出台账三条件（读端路由 WO-ENGINE-2 · 真缓存 WO-BEFE-E checkpointsQuery · 本登记）逐条达成后才接，
  // 接之前它在 SIM_EVENT_GAPS 里记了 11 天——不是偷懒，是此前硬接 = 假接线。
  // 发起方本页不等这条事件（onCheckpoint 里本地失效），它管的是**别的标签页/别的用户**。
  // ⚠ 若将来把 checkpointsQuery 删了/改了 queryKey，本条退化成假接线，必须挪回 SIM_EVENT_GAPS 台账。
  "sim.checkpoint_saved": ["sim-checkpoints"],
  // ── WO-GATE-ONTOLOGY-DRIFT（2026-08-23）：会话生命周期迁移 —— 修的是**真陈旧**，不是补记账 ──
  // 生产者：`setSimSessionStatus`（datacore app.ts:1989）**唯一**的 emit（app.ts:2002），在
  // `repos.sim.putSession(s)` 之后发；两个入口共用它 —— `PATCH /a/v1/sim/sessions/:id/status`
  // （app.ts:2031）与产能页 `POST /a/v1/sim/live-scenarios/:id/pause|end`（app.ts:3255/3260）。
  //
  // 为什么是 `sim-sessions` 这个键（"真正该失效的那个缓存"，不是随便挂一个）：
  // 会话列表投影 `listSessionSummaries` 逐项带 `status`，而 `["a","sim-sessions"]` 是五处共用的
  // **同一份**缓存（SandboxView / EdgeActivePanel / EnterpriseStateTwinPanel / ImpactAnalysisPanel /
  // console 的 useConsoleSession）。其中两处真会把陈旧的 status 摆到用户面前：
  //   ① `views/sim/SandboxView.tsx:1373` —— 世界列表 rail 直接渲染 `{s.status} · tick {s.curTick}`；
  //   ② `views/sim/console/useConsoleSession.ts:111` —— 那条 useQuery 是 **`staleTime: Infinity`**，
  //      不失效就永不重取；而它用 `pickLatestRunningSession`（只认 `status === "RUNNING"`）替四个
  //      控制台页挑「当前世界」。别处把会话迁成 PAUSED/ENDED 后，这四页会继续拿一个**已冻结**的世界
  //      冒充「当前」，用户再点 tick/act/扰动只会撞上后端 `assertSimSessionWritable` 的 409，
  //      屏上却没有任何东西解释原因 —— 该 hook 自己的头注就写着「拿 PAUSED/ENDED 冒充『当前』会让
  //      屏上的数与用户正在推的那个世界对不上」，本条就是让那句话不再发生。
  //
  // 刻意**不**挂的两个标签（各有实据，防下一个人"顺手补齐"）：
  //   · `sim-world` —— `setSimSessionStatus` 只写 `s.status` 再 `putSession`，tick 态一个字节没动
  //     ⇒ `["a","sim-world",…]` 内容不变，挂上去是纯空跑（与 `sim.perturbation_created` 不同，
  //     那条在 emit 前真的 `putTickState` 了）。
  //   · `sim-scenarios` —— 产能页 pause/end 也走本事件，但前端 `LiveScenario` 类型
  //     （`api/endpoints.ts:2044`）**没有 `status` 字段**、`RiskBoardView` 一处都不读它
  //     ⇒ 今天没有承载它的屏，硬挂 = 假接线。方案列表哪天真把生命周期上屏，再补进来（先读端后事件）。
  "sim.session_status_changed": ["sim-sessions"],
};

/** 失效一个领域事件下游的所有引用方缓存（响应式 Loop 的"自动更新"）。 */
export function invalidateForEvent(event: string): void {
  for (const label of EVENT_INVALIDATES[event] ?? []) {
    for (const key of LABEL_TO_KEYS[label] ?? []) {
      void queryClient.invalidateQueries({ queryKey: key as string[] });
    }
  }
}
