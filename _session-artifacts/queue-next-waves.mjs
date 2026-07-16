// queue-next-waves.mjs
// 幂等队列补丁脚本 · 审核方 review 后自运行入队。
// 抽取来源:
//   批A · 真可信 fix-WO(审计已挖·除已入队 WO-FAKE-01/WO-FAKE-05 外全部):
//     docs/AUDIT-solver-fake-residues.md   (WO-FAKE-02/03/04)
//     docs/AUDIT-frontend-fake-residues.md (WO-FAKE-06/07/08/09/10)
//   批B · L1-L3 满配脊柱 WO(4 份施工 PRD 的 §WO 拆分节全部·统一 P3):
//     docs/PRD-L1A-requirement-graph-engine.md            (WO-L1A-1/2/3)
//     docs/PRD-L1B-execution-planner-workflow-runtime.md  (WO-L1B-1..5 + WO-L1B-SAGA)
//     docs/PRD-L2-decision-kernel.md                      (WO-L2-1..5)
//     docs/PRD-L1.5-enterprise-memory-cbr.md              (WO-L1.5-1..5)
// 纪律: 幂等(已存在 id 不覆盖) · at 用空对象 {} 避免 claim 崩 · 不改现有条目。
// ⚠ 已在队列的 id(勿覆盖): WO-FAKE-01/WO-FAKE-05/WO-CAP-*/WO-MERGE-*/QUERY30-ORCH。

import fs from "fs";

const p = "/home/user/complete/docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));

const wos = [
  // ========================= 批A · 真可信 fix-WO =========================
  {
    id: "WO-FAKE-02",
    title: "plan_rootcause 季/年下钻读真 per-level Metric 或投影档标 PARTIAL(去魔数 PERIODIC 投影冒充实测)",
    priority: "P1",
    deps: [],
    doc: "docs/AUDIT-solver-fake-residues.md",
    acceptance: {
      goal: "plan_rootcause 季/年下钻不再用 PERIODIC 魔数(quarter0.97/year1.04)把月值编造成季/年·而是读真 per-level Metric(对齐 metric_rollup service.ts:1057)或诚实标 dataMode=PARTIAL 披露月值粒度投影(service.ts:861-871)。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真起 SEED_DEMO datacore·curl plan_rootcause 季/年下钻→若走投影则响应 dataMode=PARTIAL 且披露 月值粒度投影非实测季年·不再默认 LIVE 无披露。" },
        { id: "C2", type: "真跑", assert: "季/年 actual 值不再等于月值×PERIODIC 魔数(quarter0.97/year1.04)·或读真 per-level Metric 逐值对照·offTarget RED/AMBER/GREEN 判级基于真值。" },
        { id: "C3", type: "gate", assert: "genuine-sim/no-fake-data 门绿·母体 §8 相关断点更新·四包回归全绿(datacore 69/agentcore 66/frontend 25+)。" }
      ]
    },
    discipline: "additive·去魔数投影或诚实降级 PARTIAL·不拿月值×系数冒充实测季/年(KILL-MOCK-RED)。"
  },
  {
    id: "WO-FAKE-03",
    title: "risk_timeline 处置责任人去 hash(riskHashN 伪造·读真责任对象或显未指派)",
    priority: "P2",
    deps: [],
    doc: "docs/AUDIT-solver-fake-residues.md",
    acceptance: {
      goal: "risk_timeline 处置责任人不再由 riskHashN(基地名 hash)从 RISK_OWNER_NAMES 伪造·改读真责任对象或诚实显 未指派(risk.ts:553-556 与 :588)。",
      criteria: [
        { id: "C1", type: "真跑", assert: "curl risk_timeline→责任人字段来自真责任对象(有真源)或显 未指派(无真源)·不再是 hash(基地名) 映射的伪造姓名。" },
        { id: "C2", type: "gate", assert: "check-no-fake-data 门覆盖本地 hash(riskHashN)信号·对该类伪造报红(与 WO-FAKE-05 门加固协同)。" },
        { id: "C3", type: "test", assert: "solvers 单测放开对 hash 责任人的钉死·断言无真源时显 未指派·确定性守。" }
      ]
    },
    discipline: "additive·去本地 hash 伪造·无真源诚实空态(未指派)不冒充谁负责(KILL-MOCK-RED)。"
  },
  {
    id: "WO-FAKE-04",
    title: "order_fullchain 交期 P90 收口到 mcP90Single(去固定 ×0.9 haircut 伪分位)",
    priority: "P2",
    deps: [],
    doc: "docs/AUDIT-solver-fake-residues.md",
    acceptance: {
      goal: "order_fullchain 交期 P90 不再用 producibleWeekly×0.9 固定 haircut 伪造分位·收口到种子化 MC 的 mcP90Single(对齐 capacity_forecast 已走的 MC 分位·service.ts:1177)。",
      criteria: [
        { id: "C1", type: "真跑", assert: "curl order_fullchain→P90 来自 mcP90Single 种子化 MC·不再是 producibleWeekly×0.9·deliveryOk 判定基于真分位。" },
        { id: "C2", type: "真跑", assert: "同输入同种子重跑 P90 字节一致(确定性 MC·非随机)·R6 守。" },
        { id: "C3", type: "gate", assert: "check-no-fake-data 门覆盖固定 haircut(×0.9)信号·四包回归全绿。" }
      ]
    },
    discipline: "additive·去固定 haircut·收口既有种子化 MC 单点分位·确定性(KILL-MOCK-RED)。"
  },
  {
    id: "WO-FAKE-06",
    title: "apiClient 关键端点响应加 zod 运行时校验堵根(mock↔后端漂移即暴非静默坏)",
    priority: "P1",
    deps: [],
    doc: "docs/AUDIT-frontend-fake-residues.md",
    acceptance: {
      goal: "apiClient.ts:117 的 res.json() as T 零运行时校验根病·给关键端点(QOS/objects/sim/calibration 主链)加 zod 运行时校验·令 mock↔真后端形状漂移在运行即暴露而非静默坏测试却绿。此单=前端版门加固治整类。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真起双服务·对 QOS/objects/sim/calibration 主链端点·注入一处形状漂移→前端 zod 校验抛错/告警可见·不再静默 as T 吞掉。" },
        { id: "C2", type: "test", assert: "前端单测覆盖校验分支·契约漂移用例 green→red(漂移即红·修正即绿)。" },
        { id: "C3", type: "gate", assert: "frontend 25+ 回归全绿·新增校验不破坏既有正常响应解析。" }
      ]
    },
    discipline: "additive·前端版门加固堵整类漂移·治本(KILL-MOCK-RED 前端同源)。"
  },
  {
    id: "WO-FAKE-07",
    title: "契约漂移三修:QueryHistory 读 candidates[0].intentKey + queries path 枚举 WORKFLOW/AGENT + calibration mock 增 baselineOnly 分支",
    priority: "P1",
    deps: [],
    doc: "docs/AUDIT-frontend-fake-residues.md",
    acceptance: {
      goal: "修三处契约漂移——①F1 QueryHistoryPage 读 classification.candidates[0].intentKey(非顶层·对齐 qos.ts:225 真后端契约形)使意图列不再整列空白 ②F7 queries mock path 枚举改 WORKFLOW/AGENT(qos.ts:433) ③F6 calibration mock 增 baselineOnly:true 分支令诚实降级态被测。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真起双服务·真后端 classification→QueryHistoryPage 意图/分类列逐行有值(读 candidates[0].intentKey)·不再整列显长横线(F1·真后端每行该列曾 undefined)。" },
        { id: "C2", type: "test", assert: "queries mock path 返 WORKFLOW/AGENT(非陈旧 PATH_A)·前端逐值对照契约枚举(F7)。" },
        { id: "C3", type: "test", assert: "calibration mock 覆盖 baselineOnly:true 诚实降级分支·测试断言 静态基线未测得改进 态被渲染(F6·不再永远显健康收敛)。" }
      ]
    },
    discipline: "additive·契约形对齐真后端·诚实降级态入测(KILL-MOCK-RED)。"
  },
  {
    id: "WO-FAKE-08",
    title: "SimComparePanel+SandboxRunHistory tickMean 统一到分维/归一(并入或紧随 WO-CAP-03 KPI 口径)",
    priority: "P1",
    deps: ["WO-CAP-03-KPI-FIX"],
    doc: "docs/AUDIT-frontend-fake-residues.md",
    acceptance: {
      goal: "F2/F3 SimComparePanel(SimComparePanel.tsx:16-29)与 SandboxRunHistory(SandboxRunHistory.tsx:17-24)的 tickMean 跨维扁平均(所有对象×所有 stateVar sum/cnt·同÷575 病)统一到分维/归一 KPI 口径(与 WO-CAP-03 一处修双处引)·不再喂 A/B 对比表/heat strip/sparkline 作权威 KPI。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真渲染 SimComparePanel/SandboxRunHistory·tickMean 值按 stateVar 分维或归一·逐值对照后端真值·不再跨维扁平均。" },
        { id: "C2", type: "真跑", assert: "与已修 globalKpi 口径一致(同 WO-CAP-03)·A/B 对比表/heat strip 不再显误导聚合值。" },
        { id: "C3", type: "gate", assert: "frontend 回归全绿·复验 WO-CAP-03 时核并本两控件已覆盖(CAP-03 当前只改 SandboxView KPI 未含此二)。" }
      ]
    },
    discipline: "additive·统一 KPI 口径·去跨维扁平均误导聚合(KILL-MOCK-RED)。注:须与 WO-CAP-03 协调避重复/漏覆盖(deps 挂 WO-CAP-03-KPI-FIX)。"
  },
  {
    id: "WO-FAKE-09",
    title: "外部信号 provenance:ExternalSignalStrip 捏值去真机构名/挂 SYNTHETIC 徽标 + ProjectSim 写死 batches 挂 DataModeBadge+运行闸",
    priority: "P1",
    deps: [],
    doc: "docs/AUDIT-frontend-fake-residues.md",
    acceptance: {
      goal: "F4 ExternalSignalStrip 捏值(碳酸锂/镍/汇率/电价冠真机构名·ExternalSignalStrip.tsx:29-37)去真机构名或挂 SYNTHETIC/provenance 徽标·不拿 mock 冒充权威实测喂决策;F5 ProjectSim 写死 batches(ProjectSimView.tsx:251-254)挂 DataModeBadge+运行闸(对齐姊妹 SopBalanceView)。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真渲染 PlanGenerate/PlanAudit·ExternalSignalStrip 每信号带 provenance/SYNTHETIC 徽标或去真机构名·不再零 provenance 冠真机构名喂决策。" },
        { id: "C2", type: "真跑", assert: "真渲染 ProjectSimView·写死 batches 带 DataModeBadge + 运行闸(对齐 SopBalanceView 徽标+运行闸)·裁决交期/缺口前诚实标数据模式。" },
        { id: "C3", type: "gate", assert: "frontend 回归全绿·徽标/provenance 组件复用既有 DataModeBadge 非新造。" }
      ]
    },
    discipline: "additive·provenance 诚实标注·mock 不冒充 LIVE 权威实测喂裁决(KILL-MOCK-RED)。"
  },
  {
    id: "WO-FAKE-10",
    title: "魔法系数/硬编码阈收口(阈由后端下发·敞口/毛利去魔法折算·去伪溯源断言)",
    priority: "P2",
    deps: [],
    doc: "docs/AUDIT-frontend-fake-residues.md",
    acceptance: {
      goal: "F8-12 魔法系数与硬编码阈收口——PropagationTimeline ×0.6 敞口(:71)/DashboardView gm 重算 0.6/13(:215)/ProjectSimView 瓶颈阈 t>=85/75/60(:638)/RiskPopover ??85 阈(:34)改由后端下发阈值·敞口/毛利去前端魔法折算;ExternalSignalsPage 去伪断言 经连接器同步可溯(:52)。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真渲染相关视图·瓶颈/风险阈值来自后端下发(非前端硬编码 85/75/60 或 ??85)·敞口/毛利折算系数去魔法。" },
        { id: "C2", type: "真跑", assert: "ExternalSignalsPage 去伪断言 经连接器同步可溯(无真连接器时)·诚实标数据来源。" },
        { id: "C3", type: "gate", assert: "frontend 回归全绿·阈值下发契约 additive。" }
      ]
    },
    discipline: "additive·阈值后端下发·去前端魔法折算与伪溯源断言(KILL-MOCK-RED)。"
  },

  // ===================== 批B · L1-A 需求图引擎(P3) =====================
  {
    id: "WO-L1A-1",
    title: "RequirementGraph 契约 + QuestionAST 确定性解析器(纯函数·无接线)",
    priority: "P3",
    deps: [],
    doc: "docs/PRD-L1A-requirement-graph-engine.md",
    acceptance: {
      goal: "落 packages/contracts/src/requirement-graph.ts 全 schema + index.ts 导出 + QOS_REQUIREMENT_GRAPH 暗发 + QuestionAST 确定性解析器(复用 normalizeQuery/problemClassForIntent/slots 三阶梯实体解析)·纯函数+单测·不接线编排。",
      criteria: [
        { id: "C1", type: "typecheck", assert: "契约 zod 编译过·pnpm -r typecheck 绿。" },
        { id: "C2", type: "unit", assert: "喂真意图+真上下文→AST(V1·实体 objectId 对照 mock 本体真值·不造假)。" },
        { id: "C3", type: "unit", assert: "R6 双跑字节一致(V4·parser 级·generatedAt 固定·LLM mock)·无 LLM/时钟/随机(静态扫+单测)。" },
        { id: "C4", type: "test", assert: "契约字段全 optional/additive·旧消费方零感知·pnpm -r test 现有全绿。" }
      ]
    },
    discipline: "暗发(QOS_REQUIREMENT_GRAPH)·契约全 optional additive·确定性无随机(KILL-MOCK-RED green→red)。"
  },
  {
    id: "WO-L1A-2",
    title: "Graph Builder(node/edge/property/event 推导)+ 三白名单门(纯函数·无接线)",
    priority: "P3",
    deps: ["WO-L1A-1"],
    doc: "docs/PRD-L1A-requirement-graph-engine.md",
    acceptance: {
      goal: "落 requirement-graph.ts builder 段(八段 Pipeline·复用 SOLVER_DATADEP/DATADEP_ROLE_CANONICAL/SOLVER_COVERAGE/expandHiddenRequirements/deriveSliceTargetCandidates/LinkType 图)+ scripts/check-requirement-graph.mjs 门并入 pnpm gates·仍不接线编排。",
      criteria: [
        { id: "C1", type: "unit", assert: "AST→RG(V2·object 节点 ontologyType 全∈已发布类型·solver 节点∈SOLVER_REGISTRY·data 节点 roleType∈DATADEP_ROLE_CANONICAL·边经真 LinkType 断链止步)。" },
        { id: "C2", type: "gate", assert: "三白名单测谎 green→red(V3·注入幽灵 solverKey/ontologyType→requirement-graph:check 红·修正→绿)。" },
        { id: "C3", type: "unit", assert: "下游投影 solverCandidates/dataRequirements/sliceTargets 与 SOLVER_COVERAGE/SOLVER_DATADEP/deriveSliceTargetCandidates 逐值对账。" },
        { id: "C4", type: "unit", assert: "R6 双跑字节一致(V4·builder 级)·隐性需求经 expandHiddenRequirements 复用 L0 不新造。" }
      ]
    },
    discipline: "暗发·additive·builder 越界产幽灵 key 视为红(KILL-MOCK-RED)。"
  },
  {
    id: "WO-L1A-3",
    title: "编排接线(暗发·观察态)+ 持久化 + 读端点 + 下游 I/O",
    priority: "P3",
    deps: ["WO-L1A-2"],
    doc: "docs/PRD-L1A-requirement-graph-engine.md",
    acceptance: {
      goal: "orchestrator buildRequirementGraph 插入点(:673·try/catch 吞·emit step.completed stepId:requirement-graph)·PreAnalysisReport 扩 requirementGraph optional·GET /b/v1/queries/:taskId/requirement-graph(growth.requirement_graph 门·双注册·defaultOn:false)·观察态。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真起双服务真 curl/真浏览器:真问句→落 RG(V1/V2 真值对照)→取 solverCandidates 真调求解器出真答案(V5 闭环)。" },
        { id: "C2", type: "真跑", assert: "回退演练(V6·被证明):关 QOS_REQUIREMENT_GRAPH→pipeline 逐值同改造前+QOS 回归全绿(agentcore 66)·关 growth.requirement_graph→端点 curl 404。" },
        { id: "C3", type: "真跑", assert: "观察态零回归——RG 开关不改 answer(同问句 answer 字节一致·证 NG6 additive)·R2 跨租户 404(V7)。" },
        { id: "C4", type: "gate", assert: "pnpm -r test + pnpm gates 全绿(V8·含 requirement-graph:check)·母体回写§6 + pnpm ontology:slices。" }
      ]
    },
    discipline: "暗发观察态(真正翻闸在 L1-B)·additive 不改 answer/路由(NG6)·母体回写(铁律0)·真跑铁律0.4。"
  },

  // ============ 批B · L1-B 执行规划器 + Workflow 运行时(P3) ============
  {
    id: "WO-L1B-1",
    title: "ExecutionGraph 契约 + 线性 lift + 门(无接线)",
    priority: "P3",
    deps: [],
    doc: "docs/PRD-L1B-execution-planner-workflow-runtime.md",
    acceptance: {
      goal: "落 packages/contracts/src/execution-graph.ts 全 schema(内嵌复用 PlanStepSchema)+ index.ts 导出 + fromLinearPlan/toLinearSteps 纯函数 + QOS_WORKFLOW_DAG/QOS_EXEC_PLANNER 暗发 + scripts/check-workflow-dag.mjs 门并入 pnpm gates·不接线执行/编排。",
      criteria: [
        { id: "C1", type: "typecheck", assert: "zod 编译·pnpm -r typecheck 绿。" },
        { id: "C2", type: "unit", assert: "线性 lift 往返无损(toLinearSteps∘fromLinearPlan ≡ steps·单测)。" },
        { id: "C3", type: "test", assert: "契约字段全 optional/additive·旧消费方零感知·pnpm -r test 现有全绿。" },
        { id: "C4", type: "gate", assert: "workflow-dag:check 对合法图绿、对注入环/幽灵步/幽灵 solverKey 必红(green→red 测谎)。" }
      ]
    },
    discipline: "暗发双闸·契约全 optional additive·图测谎 green→red(KILL-MOCK-RED)。"
  },
  {
    id: "WO-L1B-2",
    title: "DAG 执行器(拓扑并行 + Gateway + 步级重试·无 durable·无接线编排)",
    priority: "P3",
    deps: ["WO-L1B-1"],
    doc: "docs/PRD-L1B-execution-planner-workflow-runtime.md",
    acceptance: {
      goal: "落 apps/agentcore/src/workflow/dag-executor.ts runWorkflowDag(Kahn 并发+Gateway+重试·复用 GuardedToolExecutor 与 render 投影)+ engine.ts:382 执行器派发(QOS_WORKFLOW_DAG 暗发)·durable/补偿留 WO-3。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真 DAG 并行+扇入(V1·真求解器真答案·两分支 step.started 交错·扇入等两前驱皆 DONE)。" },
        { id: "C2", type: "真跑", assert: "条件 Gateway 确定性择支(V2·命中支运行未命中支 SKIPPED)·步级重试幂等守卫(V4·create_action_draft 不二次出站)。" },
        { id: "C3", type: "真跑", assert: "影子对照旧串行等价(V6·纯线性 lift 逐字节 parity·a14-parity 报告)。" },
        { id: "C4", type: "真跑", assert: "R6 并行双跑字节一致(V7②·改随机源即红)·回退关 QOS_WORKFLOW_DAG→串行·agentcore 66 绿(V8①)。" }
      ]
    },
    discipline: "暗发·additive·并行破坏确定性/parity 分歧→关闸回串行(KILL-MOCK-RED·真跑铁律0.4)。"
  },
  {
    id: "WO-L1B-3",
    title: "durable checkpoint 续跑 + 补偿引擎(移植 BuildWorkflowEngine)",
    priority: "P3",
    deps: ["WO-L1B-2"],
    doc: "docs/PRD-L1B-execution-planner-workflow-runtime.md",
    acceptance: {
      goal: "落 workflow/checkpoint.ts DurableWorkflowCheckpointStore(保留 NoopStore)+ workflow_dag_runs 表(migration 014·pg.ts+memory.ts+repos.ts·R9 四处同改)+ resumeWorkflowDag + 补偿反向序 + ops/sweep.ts 续跑分支 + 续跑/读端点(qos.workflow_dag 门·双注册)。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真崩溃续跑(V3·stopAfterNode 真停·续跑答案逐字节等价·resumedCount·跳过 DONE 节点不重跑)。" },
        { id: "C2", type: "真跑", assert: "补偿反向序·出站经 S2(V5·R4·不可逆步 COMPENSATED=false 诚实记录不伪装)。" },
        { id: "C3", type: "真跑", assert: "回退演练(V8·关闸→NoopStore+INTERRUPTED_BY_RESTART 不变·migration down→up 幂等)·R2 跨租户 404(V9)。" },
        { id: "C4", type: "unit", assert: "镜像 BuildWorkflowStep 契约对账(status/attempts/checkpoint 同形)。" }
      ]
    },
    discipline: "暗发·additive(旧 executor 永不删)·补偿不静默反转真实效果(R4·KILL-MOCK-RED)。"
  },
  {
    id: "WO-L1B-4",
    title: "Execution Planner synthesizePlan(Ch10 满配)+ 影子接线(shadow only)",
    priority: "P3",
    deps: ["WO-L1B-3", "WO-L1A-3"],
    doc: "docs/PRD-L1B-execution-planner-workflow-runtime.md",
    acceptance: {
      goal: "落 apps/agentcore/src/growth/execution-planner.ts synthesizePlan(消费 L1-A RequirementGraph 投影·纯函数)+ orchestrator.ts:1058 影子段(QOS_EXEC_PLANNER=shadow·落 PreAnalysisReport.planner)+ parity 门(a14-parity 扩)·只影子不 serve。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真需求图→synthesizePlan 综合图(节点全∈注册表·依赖拓扑无环·Skill/Agent 择优逐值对账 Ch10.8/10.9)。" },
        { id: "C2", type: "真跑", assert: "R6 规划器双跑字节一致(V7①)·覆盖门<0.8 回落模板(诚实·不产非法图)。" },
        { id: "C3", type: "真跑", assert: "影子期零用户可见变化(同问句 answer 与改造前逐字节一致·NG6 additive·回归全绿)。" },
        { id: "C4", type: "真跑", assert: "parity 报告按 intent 聚合 divergence。" }
      ]
    },
    discipline: "暗发影子先行·additive·影子改变 answer/路由(NG6)→关 QOS_EXEC_PLANNER(KILL-MOCK-RED)。跨层依赖 L1-A(WO-L1A-3·RequirementGraph 运行绿)。"
  },
  {
    id: "WO-L1B-5",
    title: "Planner SERVE 翻闸(STAGE-1 fall-through→STAGE-2 白名单)+ 全链真跑",
    priority: "P3",
    deps: ["WO-L1B-4", "WO-L1B-2", "WO-L1B-3"],
    doc: "docs/PRD-L1B-execution-planner-workflow-runtime.md",
    acceptance: {
      goal: "orchestrator serve 分支(QOS_EXEC_PLANNER=serve):STAGE-1 只服务现 fall-through intent·STAGE-2 parity 连绿 intent 进白名单(配置态·摘除秒级回退)·综合图→runWorkflowDag(WO-2/3 执行器)。",
      criteria: [
        { id: "C1", type: "真跑", assert: "STAGE-1:一条现状 fall-through 真问句→RequirementGraph→synthesizePlan→runWorkflowDag(真并行/durable)→出真求解器真答案(R11 闭包·前端真看到 UI 逐值对照后端)。" },
        { id: "C2", type: "真跑", assert: "STAGE-2:白名单 intent 综合图执行·parity 绿。" },
        { id: "C3", type: "真跑", assert: "回退(V8·白名单清空→模板·关 QOS_WORKFLOW_DAG→串行·关 qos.workflow_dag→404)。" },
        { id: "C4", type: "gate", assert: "pnpm -r test + pnpm gates 全绿(V10)·母体回写§6 + node scripts/build-ontology-slices.mjs。" }
      ]
    },
    discipline: "暗发翻闸·additive·parity 分歧超阈/首包延迟回归→摘白名单秒级回退(KILL-MOCK-RED·真跑铁律0.4)。"
  },
  {
    id: "WO-L1B-SAGA",
    title: "跨系统 Saga 一致性(单列·延后 L1.5·NG2)",
    priority: "P3",
    deps: ["WO-L1B-3"],
    doc: "docs/PRD-L1B-execution-planner-workflow-runtime.md",
    acceptance: {
      goal: "MES/ERP/WMS 出站步跨系统事务一致性——外部幂等键、对账补偿、部分失败重放·独立排期不阻塞 L1-B 核心 5 单·暗发 qos.workflow_saga defaultOn:false。",
      criteria: [
        { id: "C1", type: "真跑", assert: "跨系统部分失败→幂等重放 + 对账补偿一致(真外部或真 sandbox·非 mock 冒充)。" }
      ]
    },
    discipline: "暗发(qos.workflow_saga)·additive·真外部/真 sandbox 非 mock 冒充(KILL-MOCK-RED)。注:PRD §8 仅给单条 acceptance(延后 WO·外部连接器依赖)·未细分多 criteria·此处保真不编造。"
  },

  // ===================== 批B · L2 决策内核(P3) =====================
  {
    id: "WO-L2-1",
    title: "决策制品契约 + CounterfactualResult 补 schema + 暗发双闸",
    priority: "P3",
    deps: [],
    doc: "docs/PRD-L2-decision-kernel.md",
    acceptance: {
      goal: "落 packages/contracts/src/decision-kernel.ts 全 schema(复用 qos.ProvenanceRef)+ index.ts 导出 + QOS_DECISION_KERNEL 暗发 + decision.kernel 双注册(agentcore registry + datacore features·defaultOn:false)·不接线编排。",
      criteria: [
        { id: "C1", type: "typecheck", assert: "zod 编译过·pnpm -r typecheck 绿。" },
        { id: "C2", type: "unit", assert: "CounterfactualResult 能承载 counterfactual_timeline 真输出(真 solver 输出→映射入 schema 无损·填补无 schema 缺口证据)。" },
        { id: "C3", type: "test", assert: "契约字段全 optional/additive·旧消费方零感知·pnpm -r test 现有全绿。" },
        { id: "C4", type: "gate", assert: "双注册守(decision.kernel 在 agentcore registry + datacore features 同 defaultOn:false·防未注册键恒真陷阱)。" }
      ]
    },
    discipline: "暗发双闸·契约全 optional additive·双注册防恒真陷阱(KILL-MOCK-RED)。"
  },
  {
    id: "WO-L2-2",
    title: "Reasoning Engine + Counterfactual 编排(沿因果重算)",
    priority: "P3",
    deps: ["WO-L2-1"],
    doc: "docs/PRD-L2-decision-kernel.md",
    acceptance: {
      goal: "落 decision/kernel.ts reasoning+counterfactual 段(经 B→A 调 affected_orders/plan_rootcause/counterfactual_timeline/inference-whatif/sim compare/method-mc)→产 ReasoningTrace+CounterfactualResult[]·纯编排+真求解调用·仍不接主链。",
      criteria: [
        { id: "C1", type: "unit", assert: "三模式 ReasoningTrace(Path/Impact/Counterfactual·chain 有据)。" },
        { id: "C2", type: "unit", assert: "反事实 World A/B/Δ 逐值等于求解器输出(V1·counterfactual_timeline 双序列+delta 逐值·非近似)。" },
        { id: "C3", type: "unit", assert: "沿因果重算经 inference/whatif dryRunDeltas(V1·对象级 delta 非造)·R6 双跑字节一致(V6)。" },
        { id: "C4", type: "unit", assert: "dataMode 诚实透传(无真源=PARTIAL·不造 delta/峰值·KILL-MOCK)。" }
      ]
    },
    discipline: "additive·反事实沿真派生重算非新引擎·无真源 PARTIAL 不造 delta(KILL-MOCK-RED)。"
  },
  {
    id: "WO-L2-3",
    title: "Decision Package 装配 + Pareto 推荐 + ExplanationChain",
    priority: "P3",
    deps: ["WO-L2-2"],
    doc: "docs/PRD-L2-decision-kernel.md",
    acceptance: {
      goal: "落 kernel.ts assembly 段(方案枚举 what_if_displacement/plan_generate/mitigation_select·推荐复用 multi_plan_compare 确定性 tiebreak+可选加权 F(x)·解释 Why/Evidence/Alternative)→产完整 DecisionPackage + scripts/check-decision-kernel.mjs 门并入 pnpm gates·仍不接主链。",
      criteria: [
        { id: "C1", type: "unit", assert: "scenarios[](量化+挤占+毛利+受影响+逐单再方案·V2 逐值对账求解器字段·≥1 不可行则 feasible=false+hardViolations 诚实列出)。" },
        { id: "C2", type: "unit", assert: "推荐确定性 + recommendedKey=null if <2 可比方案(V3·不硬推)。" },
        { id: "C3", type: "gate", assert: "KILL-MOCK 测谎 green→red(V5·注入幽灵方案/无 provId 数字/伪造 delta→decision-kernel:check 红·修正→绿)。" },
        { id: "C4", type: "unit", assert: "explanation 每数字有 provId·alternatives 有据(V4)·R6 双跑字节一致(V6)·凑不出 provId=null 诚实空态不合成。" }
      ]
    },
    discipline: "additive·每 metric/delta/recommendedKey 必可溯 provId·凑不出 null 诚实空态(KILL-MOCK-RED)。"
  },
  {
    id: "WO-L2-4",
    title: "QOS 旁挂接线(暗发·观察态)+ 持久化 + 读端点 + 事件",
    priority: "P3",
    deps: ["WO-L2-3", "WO-L1A-3"],
    doc: "docs/PRD-L2-decision-kernel.md",
    acceptance: {
      goal: "落 decision/hook.ts startDecisionKernel(对齐 pre_analysis server.ts:208·entitlement 短路+fire-and-forget)+ server.ts:~306 旁挂 + decision_packages 表(R9 四处·down)+ GET /b/v1/queries/:taskId/decision-package(decision.kernel 门·404)+ decision.package_started/built/failed 事件·观察态。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真起双服务真 curl:真问句→落 DecisionPackage(V1/V2/V3/V4 真值对照)。" },
        { id: "C2", type: "真跑", assert: "回退演练(V8):关 QOS_DECISION_KERNEL→pipeline 逐值同改造前+旧答案合成字节保留+QOS 回归全绿·关 decision.kernel→端点 curl 404。" },
        { id: "C3", type: "真跑", assert: "观察态零回归——决策内核开关不改 answer(同问句字节一致·NG1 additive)·R2 跨租户 404(V9)。" },
        { id: "C4", type: "真跑", assert: "首包延迟无回归(fire-and-forget 不阻塞 SSE)。" }
      ]
    },
    discipline: "暗发观察态·additive·fire-and-forget 不阻塞首包·不改 answer/路由(NG1·KILL-MOCK-RED)。跨层:依赖 L1-A(WO-L1A-3·需求图可读若开);L1-B 就绪度可选(兜底求解器直算·PRD §9 NG4)。"
  },
  {
    id: "WO-L2-5",
    title: "采纳正门(Decision+ActionDraft·R4)+ 本体回写",
    priority: "P3",
    deps: ["WO-L2-4"],
    doc: "docs/PRD-L2-decision-kernel.md",
    acceptance: {
      goal: "落 POST /b/v1/queries/:taskId/decision-package/adopt(decision.kernel+act.adopt-to-draft 双门·B→A 建 Decision(DecisionLink 回链)+ ActionDraft(S2·adopt_mitigation)·回填 decisionRef/actionDraftRefs·status=ADOPTED)+ 母体 §6 回写 + pnpm ontology:slices。",
      criteria: [
        { id: "C1", type: "真跑", assert: "真采纳闭环(V7):真 adopt→真 Decision(GET 见记录+回链)+真 ActionDraft(S2 审批链·GET 见 draft)→制品回填·status=ADOPTED。" },
        { id: "C2", type: "真跑", assert: "不直写真值(业务真值表未动·仅经 R4 审批链·RL4)·跨租户采纳 403/404。" },
        { id: "C3", type: "gate", assert: "母体回写§2.H/§3/§4/§7/§8 + ontology-slices:check 绿·pnpm -r test+pnpm gates 全绿(V10)。" }
      ]
    },
    discipline: "additive·采纳经 R4 正门不直写真值(RL4)·与既有 Decision 台账不双份(RL3)·母体回写(铁律0·KILL-MOCK-RED)。"
  },

  // ================ 批B · L1.5 企业记忆 CBR(P3) ================
  {
    id: "WO-L1.5-1",
    title: "CBR 契约 + 确定性特征抽取 + 案例投影器(纯函数·无接线)",
    priority: "P3",
    deps: [],
    doc: "docs/PRD-L1.5-enterprise-memory-cbr.md",
    acceptance: {
      goal: "落 packages/contracts/src/cbr.ts 全 schema + index.ts 导出 + growth/decision-case.ts 纯函数 projectCase/extractFeatures(复用 pseudoEmbed+确定性实体解析·消费 DecisionArtifact 端口)+ QOS_CBR_INGEST/RETRIEVAL/RERANK 暗发 + scripts/check-decision-case.mjs 门并入 pnpm gates·不接线摄取/检索/端点。",
      criteria: [
        { id: "C1", type: "typecheck", assert: "zod 编译·pnpm -r typecheck 绿。" },
        { id: "C2", type: "unit", assert: "projectCase R6 双跑字节一致(V6①)。" },
        { id: "C3", type: "gate", assert: "特征键恒∈真实注册表(problemClass/solverKey/ontologyType·decision-case:check 对注入幽灵特征必红·green→red)。" },
        { id: "C4", type: "test", assert: "契约字段全 optional/additive·现有 pnpm -r test 全绿·零消费方感知。" }
      ]
    },
    discipline: "暗发(QOS_CBR_*)·additive·特征∈注册表 green→red 测谎(KILL-MOCK-RED)。"
  },
  {
    id: "WO-L1.5-2",
    title: "案例库落库 + 确定性相似检索 + 读端点(暗发·治 G-3b 读侧底座)",
    priority: "P3",
    deps: ["WO-L1.5-1"],
    doc: "docs/PRD-L1.5-enterprise-memory-cbr.md",
    acceptance: {
      goal: "persistence repos.ts/memory.ts/pg.ts 加 decisionCases(R9 四处·migrations/014_decision_cases.sql·镜像 experience)+ retrieveSimilarCases(三维确定性)+ GET /b/v1/memory/cases/similar 与 /:id(memory.cbr 门·双注册)·用直接插入案例测(暂不接真实摄取·WO-3 接)。",
      criteria: [
        { id: "C1", type: "真跑", assert: "插入案例→similar?q= 三维检索命中(breakdown 对得上·V2 精神)。" },
        { id: "C2", type: "真跑", assert: "R6 检索双跑字节一致(V6②·改权重/随机源即红)·R2 跨租户 404(V2)。" },
        { id: "C3", type: "真跑", assert: "回退:关 memory.cbr→端点 404(V8③)·migration 014 down→up 幂等(V8⑤)。" },
        { id: "C4", type: "gate", assert: "decision-case:check 检索确定性维绿。" }
      ]
    },
    discipline: "暗发·additive·检索确定性 R6·跨租户隔离(KILL-MOCK-RED)。"
  },
  {
    id: "WO-L1.5-3",
    title: "案例摄取接线(DataCore Decision→案例·agent 终态旁路·L2 端口)+ agent 先查案例库(治 G-3b 读写闭合)",
    priority: "P3",
    deps: ["WO-L1.5-2", "WO-L2-5"],
    doc: "docs/PRD-L1.5-enterprise-memory-cbr.md",
    acceptance: {
      goal: "落 tools/datacore-http.ts HttpDecisionClient + datacore decision.recorded/outcome_recorded→AgentCore 摄取 upsert(或 backfill)+ 发 decision_case.learned + recordExperience:1338 additive 加 agent 终态 DecisionCase 投影(source:AGENT_TERMINAL)+ retrieve_similar_cases 工具 + universal.ts:28 先查案例库(QOS_CBR_RETRIEVAL 门)。",
      criteria: [
        { id: "C1", type: "真跑", assert: "一决策落案例:真 POST /a/v1/decisions+outcome→摄取→GET /b/v1/memory/cases/:id 逐值对照 datacore 真值(V1·origin:LEARNED·provenance 真 dec_id)。" },
        { id: "C2", type: "真跑", assert: "相似新问句检索到它(V2)·跨会话二次跑命中。" },
        { id: "C3", type: "真跑", assert: "agent 真复用:QOS path B 同域新问句→首步真调 retrieve_similar_cases 命中→引用决策结构+免责·业务数字仍经工具溯源(V3·前端真看到步帧)。" },
        { id: "C4", type: "真跑", assert: "回退:关 QOS_CBR_RETRIEVAL→仅路径提示+agentcore 66 绿(V8①)·关 QOS_CBR_INGEST→不摄取(V8②)·rebuild 真重建(V8④)。" }
      ]
    },
    discipline: "暗发·additive(旧 search_experience/recordExperience 不删)·案例数字不当真值·经工具溯源(KILL-MOCK-RED)。跨层:消费 L2 DecisionArtifact 端口(WO-L2-5·PRD §9 缺则退纯文本特征·软依赖)。"
  },
  {
    id: "WO-L1.5-4",
    title: "反馈信号闭环 + 决策模式挖掘→接现校准 Action R4(feedback→调参真生效·不自改真值)",
    priority: "P3",
    deps: ["WO-L1.5-3"],
    doc: "docs/PRD-L1.5-enterprise-memory-cbr.md",
    acceptance: {
      goal: "FeedbackSignal 归一(Decision.realizedOutcome 预测vs实现 + agent 投票 + 案例复用)+ datacore 订阅 decision.outcome_recorded→onCalibrationRequired(service.ts:283)+ mineDecisionPatterns(确定性)+ GET /b/v1/memory/patterns + 达阈值模式→GrowthTicket(RULE_CANDIDATE·NEEDS_HUMAN)·校准数学/应用路径零改(经 R4·autoApply 恒 false)。",
      criteria: [
        { id: "C1", type: "真跑", assert: "反馈→调参真生效:capacity_forecast 域 Decision 真偏差→现校准出真提案(PENDING·回测 simulatedMapeAfter<mapeBefore)→Action R4 审批→paramsVersion 真+1→下轮 forecast 用新参→convergence mapeAfter 真降(V4·越用越准非手绘)。" },
        { id: "C2", type: "真跑", assert: "无人值守零自改(autoApply 关·提案不 auto-apply·R4·断言)。" },
        { id: "C3", type: "真跑", assert: "模式挖掘确定性+达阈值出真 GrowthTicket(V5·不自动上线规则)·R6 双跑(V6③)。" }
      ]
    },
    discipline: "additive·校准数学零改·参数变更经 R4 正门 autoApply 恒 false 不自改真值(KILL-MOCK-RED)。"
  },
  {
    id: "WO-L1.5-5",
    title: "出厂种子案例(诚实标 SEED)+ RL/GNN 离线可插拔占位 + 全链真跑 + 母体回写",
    priority: "P3",
    deps: ["WO-L1.5-4"],
    doc: "docs/PRD-L1.5-enterprise-memory-cbr.md",
    acceptance: {
      goal: "落 mocks/seed.ts 出厂 SEED 案例(真确定性派生·抄 seedDemoCalibrationConvergence/经验 50 例范式·全 origin:SEED)+ growth/decision-case.ts CaseEmbeddingProvider/CaseReranker 接口(默认 pseudoEmbed/identity·QOS_CBR_RERANK 装配位·离线占位)+ 母体 §2/§3/§4/§7/§8 回写 + node scripts/build-ontology-slices.mjs。",
      criteria: [
        { id: "C1", type: "真跑", assert: "全链:一决策落案例→相似新问句检索到→agent 复用→反馈→调参真生效(V1-V4 串跑·R11 闭包意义)。" },
        { id: "C2", type: "gate", assert: "SEED 诚实(V7·植入合成冒充即门红·green→red)·SEED 数字不被当已核验业务真值。" },
        { id: "C3", type: "真跑", assert: "RL/GNN provider 关=确定性兜底命中序(V6·CI 不变)·装配离线制品仍 R6(纯查表)。" },
        { id: "C4", type: "gate", assert: "pnpm -r test+pnpm gates 全绿(V9)·母体回写§6+切片重生成·ontology-slices:check 绿。" }
      ]
    },
    discipline: "additive·SEED 真确定性派生不冒充真实累积·RL 不引入热路径随机(KILL-MOCK-RED green→red)·母体回写(铁律0)。"
  }
];

// ---------------- 幂等入队(已存在 id 不覆盖·at 用空对象) ----------------
function groupOf(id) {
  if (id.startsWith("WO-FAKE")) return "批A-fix";
  if (id.startsWith("WO-L1A")) return "L1A";
  if (id.startsWith("WO-L1B")) return "L1B";
  if (id.startsWith("WO-L1.5")) return "L1.5";
  if (id.startsWith("WO-L2")) return "L2";
  return "其他";
}

const defsByGroup = {};
const defsByPrio = {};
for (const o of wos) {
  defsByGroup[groupOf(o.id)] = (defsByGroup[groupOf(o.id)] || 0) + 1;
  defsByPrio[o.priority] = (defsByPrio[o.priority] || 0) + 1;
}

let added = 0;
const addedByGroup = {};
const skipped = [];
for (const o of wos) {
  if (!q.items.find((x) => x.id === o.id)) {
    q.items.push(Object.assign({ status: "TODO", owner: "", at: {} }, o));
    added++;
    addedByGroup[groupOf(o.id)] = (addedByGroup[groupOf(o.id)] || 0) + 1;
  } else {
    skipped.push(o.id);
  }
}

fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");

console.log("[queue-next-waves] 待入队定义总数:", wos.length, "(批A 8 + 批B 19)");
console.log("[queue-next-waves] 本次新增:", added, "· 跳过(已存在):", skipped.length, skipped.length ? JSON.stringify(skipped) : "");
console.log("[queue-next-waves] 定义分层计数:", JSON.stringify(defsByGroup));
console.log("[queue-next-waves] 本次新增分层:", JSON.stringify(addedByGroup));
console.log("[queue-next-waves] 定义优先级计数:", JSON.stringify(defsByPrio));
console.log("[queue-next-waves] 队列现总条目:", q.items.length);
