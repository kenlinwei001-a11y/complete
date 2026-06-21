# TODO · 决策平台 PRD 套件（decision-platform-prd-pack）· 逐项追踪

> 来源：用户上传的 `decision-platform-prd-pack.zip`（25 文件 / 19 份 PRD + SOP + 路线图）。
> 施工规程 = `DEV-SOP-and-LOOP.md` 七步闭环（① READ → ② PLAN 契约先行 → ③ DEV 后端→前端→CLI →
> ④ T1–T12 工业级检测 → ⑤ 亲手跑通真服务/真 UI → ⑥ 回写本体 → ⑦ COMMIT），任一红回退。
> **波次 LOOP**：同波并行、跨波须前波 DoD 全绿才进。核心纪律：**绿测试 ≠ 能用**。
>
> 状态：✅ 完成（DoD 全绝 + 亲手跑通 + 本体回写）· 🔄 进行中 · ⬜ 未开始 · ⏸ 设计延后（裁决）
> 纪律：**完成一个标记一个，不能遗漏**。每轮回看本表，主动报"还差哪些"。
>
> ⚠️ 待负责人拍板（开工前置，SOP §0.5 / 五.1）：**基线分支** `wizardly-gauss`（推荐·超集）vs
> `vigilant-knuth`（当前工作分支）——涉 migration 序号 / `generateBattery` 字节回归 / `SyntheticPage` 分叉。
> 当前默认在 `claude/vigilant-knuth-b1nmxn` 推进（与既有指派一致）；如需切超集分支请明示。
>
> PRD 全文暂存于上传包；**实现某 PRD 时**再将其文本与《本体引用与影响》§0 落入本仓库 `docs/PRD-*.md`
> 并同步回写 §5 新不变量（R15 CLI 对等）等，避免 `prd:check` 悬空引用先红。

## 全局裁决（已定，写死）
- A9 仅设计延后（不引真依赖，守 R6）。
- A1 全部 **31** 求解器注册为 MCP 工具（业务场景 22 + 净室通用 9；与 SOLVER_KEYS 对齐，含 A8 CP-SAT 族）。
- A3 参考原型 16 域裁成 14 业务域（factory/product/process/equip/people/quality/capacity/forecast/sales/material/finance/plan/external/decision）。
- A11 连接 category 允许自定义值。
- A15 意图路由 = `POST /b/v1/operations/classify`；"求解器上传"不做 CLI 子命令 → CLI 输出深链跳 GUI。
- R15 CLI 对等 = 新不变量 + `cli-parity:check` 门 + PRD 模板必填（今后每功能必 CLI 打通或登记 GUI 深链）。

---

## Wave 1 · 基座（同波并行；A3 是 A4/A5/A10 前置）

- [~] ◐ **A3 · 14 域参考本体 + 域内/跨域两库 + 多跳切片规划器（图路径搜索）+ 切片索引**
  **A3.3 ✅（keystone）多跳切片规划器**：`ontology/slice-planner.ts planSlice` 在 OntologyLink 图上确定性
  BFS 最短路 + 固定 tie-break（跳数→域内边优先→toType 字典序→linkKey 字典序）→ SlicePlan（root→每目标
  最短路 + 路径证据 + 跨域集），搜不到→NO_PATH(unreachable[])；纯函数 R6 字节一致；`POST /a/v1/slices/plan`
  (R2 仅本租户图) + 契约 `contracts/slice-planner.ts` + 门 `pnpm slice-planner:check`。测试 a3-slice-planner ×9
  (链式/多目标/反向 in 边/NO_PATH/maxHops/R6/tie-break 域内优先 + 端点 root===target/未知类型/R2 空租户)。
  回写本体 §2/§10.1。
  **A3.1 ✅ 14 域注册表**：`graphmeta.ts BUSINESS_DOMAINS`(14 域 key/显示名/配色/primaryTypes，新增 sales/material/
  finance/external/decision 5 域，配置驱动 R14)+ `GET /a/v1/business-domains` + GRAPH_DOMAIN 补 ExternalSignal→external。
  测试 a3-business-domains ×4(恰好 14 域/无野域/primaryTypes 自洽/端点)。**A3.1 余**：参考本体基线(元租户 95 节点)数据量大待后续。
  **A3.4 ✅ 切片索引复用 + slice.planned 事件**：`ontology/slice-index.ts buildSliceIndex/resolveSpannedTypes/
  lookupReusable`(派生投影 R13——沿 link 图解析每切片覆盖类型集，按 rootType 索引)；`POST /a/v1/slices/plan`
  先查索引命中即复用(reused:true)、未命中才新规划 + `GET /a/v1/slices/index` + `slice.planned` 事件(§4 L1)。
  测试 a3-slice-planner +4(resolveSpannedTypes/lookup 复用/tie-break 最贴合/端点索引)。回写本体 §2/§4。
  **A3.2 ✅ 域内/跨域两库**：`ontology/slice-library.ts deriveSliceLibrary`(确定性——域内 `biz.<域>.<root>` 单域子图 +
  跨域 `biz.x.<from>_to_<to>` 每接缝单跳切片) + `GET /a/v1/slices/library?scope=` + `POST /slices/library/build`
  (幂等登记为一等切片→进 A3.4 索引、QOS 可调)。测试 a3-slice-library ×4(域内/跨域派生/R6/端点登记进索引)。回写本体 §2。
  **A3 仅余**：A3.1 参考本体基线(元租户 95 节点,数据量大,低优先)——A3 核心能力链(域→规划器→索引→两库)已闭合。
- [x] ✅ **A6 · 拟真值域合成数据（值落业务区间 + 确定性植入越线样本）**（Wave1 尾巴已清：全服务 e2e 跑通）
  **A6.1 ✅** `GenSpec.valueDomain` + 值域库 `synthetic/value-domains.ts`(按属性语义配置化 R14) + `genValue`
  扩(normal/banded/uniform 确定性采样,落业务区间);**A6.2 ✅** `PlantSpec` + `applyPlantCrossings`(固定索引
  植入越线/近边界) + `autoPlant` 从 BLOCK 规则 `derivePlantFromRule` 反推 + `instantiateGeneric` opt-in 接入
  (护 R6 向后兼容) + `pnpm value-domain:check` 门(test-backed)。测试 a6-value-domains(×7:三形采样落区间+
  R6 字节一致+植入查准+lt 方向+规则反推)。datacore 470 全绿(+7,无字节回归:synthetic/genspec/scale-baseline 通过)。
  **A6 全服务 e2e ✅（Wave1 尾巴已清）**：注册自定义行业模板(util valueDomain + autoPlant + scenarioSeed)→
  真 synthetic job → 物化对象 util 落业务区间[0.62,0.95] + autoPlant 越线>0.95 ≥2 行 + **R6 同 seed 重跑字节一致**
  (a6-value-domains 第 8 测，亲手过真服务合成路)。`pnpm value-domain:check` 即跑此文件含 e2e。回写本体 §2.A/§8(G-5 8f)。
  **唯一余项(诚实)**：A6.3 电池路收编(让 generateBattery 也用共享机制)——纯内部 consolidation，**generateBattery 未改→
  电池字节保持(DoD"电池字节不变"已满足)**，收编是可选优化、不影响通用路价值，留作后续。
- [x] ✅ **A11 · 连接创建打 `Connection.category` 标签（per-instance 归类，可自定义值）**
  Connection 加可覆盖 category（默认取连接器类型 registry category）+ RawDataset 溯源继承 `sourceCategory` +
  `GET /a/v1/connector-categories`（内置并集 + 本租户已用值，R2 隔离）+ `connection.created` 事件（§4 L8）+
  前端归类列/筛选/向导可自由输入 category。**亲手验**：Playwright 截图 connections 页归类列 + MES 自定义徽章。
  测试：datacore a11(×5 含 R2) + frontend f56；ontology:check 过。**注**：Connection 是 JSONB doc 存储，
  无需 migration（PRD 的 ALTER TABLE 假设列式存储，实际架构是 doc store）。CLI/R15 待 A15 落地后补登记。

## Wave 2 · 引擎/能力（A1 是 A8/A7 暴露口；A13 让 A14 去抖；A4 依赖 A3/A11）

- [x] ✅ **A1 · 31 求解器暴露为 `solvers` MCP 工具**（MCP 页可治理 + agent 经 mcp-router 可调，OBO 代理到 /a/v1/solvers）。R3 R5 R8 R11。
  契约 `solvers.ts`：`SOLVERS_MCP_SERVER` + `solverMcpToolName(key)→mcp__solvers__{key}` + `parseSolverMcpToolName`（双向）。
  供给侧 `catalog.ts`：业务场景 `SOLVER_CATALOG`(22，QOS discover 不变) **分列** 净室通用 `GENERIC_SOLVER_CATALOG`(9：
  generic_inference/shared_bottleneck/concentration_risk/margin_attribution/supplier_disruption_radius/selection/
  assignment/sequencing/packing_optimize，均带 LLM 描述「无描述不允许发布」) → `CatalogService.solverRegistry`(31，**同走
  feature 过滤**：关 view.plan-audit → plan_audit 工具消失，R3 先于 authz) + `GET /a/v1/solvers/registry`(附 outputShape)。
  AgentCore `mcp/solvers-catalog.ts buildSolverMcpTools`(确定性按名排序) + `GET /b/v1/mcp/servers/solvers`(源=注册表 31) +
  **executor A1 shim**(mcp__solvers__{key} 调用零重写归一回 invoke_solver 走既有 OBO 路径) + Http/Mock CatalogClient.solverRegistry。
  测试：datacore catalog(+2：注册表=SOLVER_KEYS 全集无漂移·每条带描述·feature 过滤) + a1-solvers-mcp ×3(L1) +
  **xservice-smoke L2**(真 AgentCore HTTP 客户端 ↔ 真 DataCore 端口：注册表 31 构 31 工具，assignment/supplier_disruption 并入)。
  **T12 亲手验 L2**：起真 DataCore:4001 + 真 AgentCore:4002 → curl /b/v1/mcp/servers/solvers → count=31，全 mcp__solvers__ 前缀。
  gates 全绿（SOLVER_KEYS 31 = 注册表 31 = R11-SHAPE 31/31）。回写本体 §3（求解器 MCP 暴露链）。
- [x] ✅ **A8 · 扩 CP-SAT 模型**：assignment（订单→基地/产线）/ sequencing（换型排序）/ packing（产能装箱）。R6。
  **A8.1 assignment_optimize · A8.2 sequencing_optimize · A8.3 packing_optimize 均 ✅**：Python sidecar 三模型
  (assignment 每 item 一指派+容量+成本; sequencing AddCircuit 开放路径最小化换型; packing bin-packing 最小箱数+对称破除)
  + DataCore 代理(loadContext 组请求，未配 OPTIMIZER_BASE_URL 显式"未接入"不兜底) + SOLVER_KEYS 31 + 输出形状 +
  `solve{Assignment,Sequencing,Packing}` client。测试 a8-assignment ×4 + a8-sequencing-packing ×3(mock 接线) +
  Python test_optimizer ×8(真 ortools 9.15：三模型可证最优 + R6 字节一致 + 不可行)。回写本体 §2.E(31 求解器)。
  **余(低优先)**：经 A1 MCP 暴露(待 A1 落地后自动覆盖,3 个新求解器即成 mcp__solvers__ 工具)。
- [x] ✅ **A13 · 通用图求解器地板语义确定化**（concentration_risk/supplier_disruption_radius 去 Kimi）。R6。
  `solvers/field-roles.ts resolveFieldRoles`：纯函数 + 结构信号(扇入/扇出/PK/数值) + 配置词库(`field-role-lexicon.ts` R14)
  + 固定 tie-break → root/sink/resource/priority(地板)/leaf 角色解析，**去 LLM 消歧(R6 字节一致)**；真歧义返回确定性排序候选
  + 置信度 + ambiguous(取 top1 默认/喂 A5 比差/A4 让人选,绝不调 Kimi)。覆盖 4 个通用图求解器(supplier_disruption_radius
  断供根=被 ref 终端汇点)。契约 FieldRoleResolutionSchema + `GET /a/v1/solvers/:key/field-roles` + 门 `floor-semantics:check`。
  测试 a13-field-roles ×6(断供根/R6 字节一致/真歧义候选/shared_bottleneck 角色/覆盖集/端点)。solver-args 未改(byte-compat)。回写本体 §2.E。
- [x] ✅ **A4 · 对象/类型浏览器管理页**（按 14 域分组列已发布类型 + 物化计数 + 下钻实例）。R2 R3 R14。
  后端 `GET /a/v1/ontology/object-types/stats`(每类型 {域(归 14 域注册表)/属性数/派生数/PK/物化 count} 一次算)。
  前端 `ObjectTypesBrowserPage` `/admin/object-types`(adminRegistry+nav)：14 域分组 + 物化计数徽章 + 域/关键词/
  仅有物化 筛选 + 点「看实例」下钻实例表(queryObjectsPaged,A6 行级过滤) → Object360(`/o/:type/:key`)。零业务常数 R14。
  测试 f57(域分组/计数 Base=3·Order=20/域筛选/仅有物化去 count=0/实例下钻 360 链接)。**T12 亲手验**：Playwright 截图
  真 UI(14 域 + Base 实例 12 行下钻)。回写本体 §2.B。消费 A3 14 域 + A11 category(筛选可后续接)。

## Wave 3 · 编排/闭环

- [x] ✅ **A5 · FDE 编排工作流·可观测节点状态图**（意图→倒推→查能力→比差→各模块生成→闭包→publish→进启动器）。R10 R11 R13 R6。
  观测层（不重写建域逻辑，PRD-A5 §1 非目标）：把 BuildWorkflowRun 7 执行步**确定性投影**成 8 FDE 语义节点。
  契约 `storybuildrun.ts`：FDE_NODE_KEYS(8)/FdeNodeSchema/FDE_NODE_STATUS + `StoryBuildRun.nodes`（doc store 无 migration）。
  `databuilder/fde-graph.ts projectFdeNodes`（状态主判产物存在性 + 步状态叠加 RUNNING/计时 + 闭包断缺口码，R6 字节一致）+
  引擎 `onAdvance` 钩子（每步迁移回调）→ service 发 `fde.node_advanced`（L15 事件，event-subscriptions + 本体 §4）+ 落
  StoryBuildRun.nodes 快照 + `GET /a/v1/databuilder/workflow-runs/:id/fde-graph` 实时投影。
  前端 `DataBuilderPage <FdeGraph>`（8 节点横向 DAG，状态色 + 缺口码红标，配置化实时刷新轮询）+ MSW mock。
  测试：a5-fde-graph ×8（L0 投影：空/成功全 DONE/闭包断 FAILED+SKIPPED/步叠加/R6 · L1 真服务建域落 8 节点 + 端点 + 事件 + R2）·
  f58 前端 L3（8 节点 DAG + 失败节点缺口码）。gates 全绿（事件 35/35，含 fde.node_advanced）。回写本体 §2.H/§3/§4。
- [x] ✅ **A7 · B 栈 scaffold 单机可见**（不配 AGENTCORE_BASE_URL 也能看到生成的 agent；DataCore 侧持久可见）。R8 R11 R2。
  契约 `storybuildrun.ts`：ScaffoldManifestItem/Record（SCAFFOLD_ITEM_STATUS：PENDING_BSTACK/SCAFFOLDED/REUSED/MISSING）+
  `StoryBuildRun.scaffoldManifest`（挂 doc store 无 migration）。`databuilder/scaffold-manifest.ts buildScaffoldManifestRecord`
  （展平 7 类 B 栈需求 + 定义，receipt 缺省=全 PENDING_BSTACK·SOFT，在线=按 (kind,key) 覆盖·HARD，R6）。
  cross_scaffold 步**无条件**落清单 + 发 `scaffold.manifest_recorded`；record 落 StoryBuildRun.scaffoldManifest。
  `GET /a/v1/databuilder/runs/:id/scaffold-manifest` + `POST …/reconcile-scaffold`（B 上线幂等对账→升级 + `scaffold.reconciled`；
  未配 B 显式报错）。不在 DataCore 真建 B 栈真值（R8，真值归 AgentCore）。前端 `ScaffoldManifestTable`（cross_scaffold 下钻，
  pending-bstack 标 + 定义可看）+ MSW mock。测试：a7-scaffold-manifest ×6（L0 投影/receipt 覆盖/空/R6 · L1 单机落库+浏览+事件+
  reconcile 幂等）· f59 前端 L3。gates 全绿（事件 37/37）。回写本体 §2.H/§3/§4。
- [x] ✅ **A10 · 终态闭环末步**（建域→R4 审批→publish→**自动重跑问句验证** "现在真能答了"）。R4 R11 R13 R6 R10。
  契约 `storybuildrun.ts`：BuildVerification（VERIFIED/NOT_VERIFIED/BUILD_STATIC/PENDING）+ `StoryBuildRun.verification`。
  `service.ts verifyBuild`：主问句经 QOS 实跑（inferenceProbe）→ 可答 VERIFIED(RUNTIME_PROBE 活证据)/不可答 NOT_VERIFIED+gapCode/
  未配 QOS 兜底 BUILD_STATIC；复用 inference 步已 probe 结果避免双跑；不越界覆盖 run.answer（归 inference 步）。
  **双路**：引擎 `onComplete` 钩子 publish 后自动触发 + `POST /runs/:id/verify` 亲手跑通。回灌 FDE launcher 节点（VERIFIED 绿/
  NOT_VERIFIED 红+缺口码）+ 发 `build.verified`（runId 与 growth LOOP CONVERGED 归一）。前端 `VerificationPanel`（终态徽章 + 重跑按钮）+ MSW mock。
  测试：a10-build-verify ×5（VERIFIED/NOT_VERIFIED/BUILD_STATIC/自动触发/R2）· f60 前端 L3；修 3 处既有测试回归（verifyBuild 不越界写 answer）。
  gates 全绿（事件 38/38）。回写本体 §2.H/§3/§4。

## Wave 4 · 验证/扩展

- [x] ✅ **A14 · 亲手跑 agent evals 比对 PRD**（真 Kimi env-gated，观测 vs 期望 diff，parity 报告）。R6 R8 R13。
  现状基建已在（evals.ts 逐 case 跑真 QOS + expect.intentKey/toolSequence/answerMust + EvalRunReport.metrics + MOCK/REAL）。
  本轮补 parity 层：契约 `EvalCaseResult.failKind`(INTENT/TOOLSEQ/ANSWER/OTHER) + `EvalRunReport.parity`(byFailKind 直方图 +
  byCase 逐 case 偏差)。`evals.ts classifyFailKind`(首要失因) + `buildParity` + `seedParityCases`(从 20 场景派生 intent+工具序列
  PRD 期望，`POST /b/v1/evals/seed-parity`)。真 Kimi **env-gated**（R6 不进默认 CI），mock 证框架。前端 `EvalsPage` parity 失因列。
  测试：a14-parity ×3（classifyFailKind/run 产 parity 与 results 一致/seed-parity 20 场景幂等）· f43 +parity 列断言。gates 全绿。回写本体 §2.H/§7。
- [x] ✅ **A12 · 其余模块逐一 hand-run 补全**（连接器/对象浏览/Agent 页/场景启动器…，系统化铺 hand-run 纪律）。FDE 纪律 · R10/R11/R13 实跑体检。
  起真服务 datacore:4001 + agentcore:4002（SEED_DEMO + SERVICE_TOKEN + AGENTCORE_BASE_URL 跨系统在线），admin 真请求逐模块复验：
  A12.1 连接器+A11（connector-categories ✅）· A12.2 对象浏览 A4（object-type-stats 26 类型真物化 Equipment=72，非 mock ✅）·
  A12.3 Agent/MCP A1（/b/v1/mcp/servers/solvers 跨服务 31 工具 ✅）· A12.4 场景启动器（**20 PUBLISHED 默认可见，首轮 🔴 闭合** ✅）·
  A10 终态闭环 cross-service（build {inference:true} → VERIFIED/**RUNTIME_PROBE** 真 QOS 实跑非兜底 ✅）。
  回写 `docs/AUDIT-hand-run.md`（A12 第二轮小节：验收项×实测×证据×Verdict + 诚实留账：Agent 真 Kimi 调用/规则 BLOCK/权限行级 体验级待滚动下批）。
  固化跨服务冒烟回归 xservice-smoke +1（对象类型跨服务可枚举，A4 数据路径守不回潮）。`pnpm -r test` 全绿。
- [x] ✅ **A9 · 外部引擎接入点设计（Datalog/图库/因果）— 仅设计延后**（不实现真依赖，守 R6 自包含；产设计 PRD 即算交付）。R6。
  设计 PRD 落 `docs/PRD-A9-external-engines-design-deferred.md`（含 §0 本体引用，过 prd:check 41 篇无悬空）：三引擎统一
  CP-SAT sidecar 范式接入点契约（datalog_transitive/graph_query/causal_estimate）+ 取舍 + 触发条件 + **R6 红线**（因果非确定→
  仅解释层不进真值写回）。**零代码改动**（裁决：按需延后；A3 BFS/派生 = Datalog 替代，A13 结构化归因 = 因果替代，多数场景无需 A9）。

## Wave 5 · CLI / intake

- [ ] ⬜ **A15 · CLI 通用操作外壳**（意图识别→模块路由→CLI 交互补参→触发模块；含 QOS 推演问答；全模块↔CLI 对等矩阵）。R15。
- [ ] ⬜ **prototype-intake · 原型 intake 正门 + schema 对账 HITL**（上传 HTML/原型→抽数据/关系→InputManifest→建域；列不符弹 SchemaReconcile 人确认）。
- [ ] ⬜ **A18 · 未审核态全栈建域闭环（吸收并取代 A16+A17，三合一自包含）**（用户新增需求 v0.2）：
  开 **PROVISIONAL 未审核模式**——闭包门从 HARD 原子闸(缺一环→全 0)降为 **ADVISORY**(如实记缺口不阻断)；缺求解器
  由 **LLM 生成临时件 + 锁死沙箱跑通**；本体/数据/规则/切片/B栈全以未审核态建出(隔离·强标 origin=LLM_PROVISIONAL/
  status=PROVISIONAL/trustLevel=UNVERIFIED) → 端到端 **PROVISIONAL_ANSWER**(绝不 ANSWERABLE/VERIFIED) → 人工审核→发布晋升 GOVERNED。
  目标：那道"30% 储能→动力"问句再跑，实证表 6 行(P1 数据/P2 本体/P3 切片/P4 规则/P5 求解器/P6 B栈)全翻 ✅(未审核态)。
  分期 A18.1 双模闭包+buildMode+PROVISIONAL_ANSWER+origin/status/隔离+`provisional-honesty:check`(消 P2/3/4+解阻断) ·
  A18.2 SolverArtifact+锁死沙箱+`solver-sandbox:check`+LLM 生成跑通注册+写真值门控(消 P5)+修 A5 矩阵乐观误报 bug ·
  A18.3 PROVISIONAL 合成数据物化(消 P1)+B栈 scaffold(消 P6,A7 单机可见) · A18.4 端到端推演+人工审核台+逐项/整域晋升(VLE/校准+R4)+接 A5/A10。
  **✅ 用户已裁决（2026-06-21，冲突已解）**：① 沙箱=独立子进程/容器。② **临时件可写真值——但限创建人**：PROVISIONAL
  求解器的输出**可驱动 Action 写真值，仅当 actor === createdBy（创建人本人）**，且**写入的真值带标签**（status=审核中/
  未认证 · trustLevel=UNVERIFIED · origin=LLM · 代码可查）。**这是 R4 的创建人作用域放宽 + 强标注代偿**：创建人自担风险用
  自己造的临时件写真值，他人/自动链仍需晋升 GOVERNED 才能写。实现：ActionDraft 门检查 `solver.createdBy === ctx.userId`
  → 放行写真值但打"未认证"标；非创建人 → 拒/需晋升。③ 未审核数据默认隔离；④ 默认 STRICT，PROVISIONAL opt-in；⑤ 晋升整域+逐制品。
  注：A16/A17 已被 A18 合并取代（原 A16 文件作废）。
- ~~A16 · LLM 临时求解器~~（**已并入 A18**）：
  缺求解器时 LLM 生成 `{compute 纯函数 + outputSchema + rationale}` → **冻结 SolverArtifact(hash+版本 R6)** → **锁死沙箱跑通自检**(无网络/fs/clock/random，R5) → 注册 `origin=LLM_PROVISIONAL, status=PROVISIONAL, trustLevel=UNVERIFIED` → 推演可调(全程标"临时·未验证" R13)，**输出不可自动写真值(R4)** → 人工 看代码/编辑/替换/晋升(VLE+校准 advisory+审批→GOVERNED 解锁写真值)。分期 A16.1 沙箱+SolverArtifact+`solver-sandbox:check` · A16.2 LLM 生成+跑通+注册+写真值门控 · A16.3 人工生命周期+MCP 标+接 A5/A10。
  **✅ 用户已裁决（2026-06-21）**：① **沙箱技术 = 独立子进程/容器**（复用 CP-SAT sidecar 隔离范式，数据不出边界，比进程内 isolated-vm 更强隔离）。② **临时求解器可写真值**——用户明确接受：只要**每个求解器有状态标签**标注其可信级（origin=LLM/status=PROVISIONAL/trustLevel=UNVERIFIED 全程显示）即可写真值。**这放宽了 R4（真值经 Action 审批）对 PROVISIONAL 件的默认禁写**：实现时 PROVISIONAL 输出驱动的 Action 草稿**允许执行写真值，但必须带醒目"临时·LLM·未验证"标 + provenance 代码可查（R13 强标注代偿）**；用户已知并接受"未验证逻辑可进真值链"的风险。晋升 GOVERNED 仍解除"临时"标。

## 特性（已 APPROVED，可独立排期）

- [ ] ⬜ **nav-reorg · 左侧导航信息架构整理 + 层级字号修正**（用户新增需求，纯前端 IA/样式，零业务常数 R14）：
  管理区 32 项扁平 → **按业务域统一分组**(NAV_GROUPS 配置驱动)；推演/数据/建模 立为一级；图谱并入「建模与图谱」组；
  补回 meta(系统自我)；字号改 **父≥子**(navGroupHeader 11→13px / section-title 10.5→12px，层级靠字重/大写/颜色)。
  逐项可见性仍按角色(visibleAdminPages)+entitlement 过滤、空组隐藏、折叠记忆保留。分期 N1 NAV_GROUPS 统一分组+渲染+meta ·
  N2 图谱并入建模组 · N3 字号方案 B。**确认点(默认取消)**：顶层"业务/管理"两 section-title 是否保留(默认全用域分组)。无需回写本体。

- [ ] ⬜ **cockpit · 经营驾驶舱 + 产能推演 参考原型 1:1 复刻**（数字全部从本体关系算出=数据闭环，非写死/非挪配置）。
- [ ] ⬜ **synthetic-wizard · 合成向导「生成进度」按 nano-ontoprompt 分阶段集成链重设计**（把"看数据逐阶段策展本体"的 UX 精髓真正落进页面，非仅算法）。

---

## 进度账（每完成一项回填）
- 合计：**23 项**（20 PRD[A16+A17 并入 A18] + A9 设计延后 + 2 特性 + nav-reorg 新增）。完成 **12 ✅ + 2 ◐ / 23**（A11/A6/A4/A13/A8/A1/A5/A7/A10/A14/A12/A9 ✅）。
- **Wave 1–4 全清**（A14 ✅ · A12 ✅ · A9 ✅ 设计延后）。
- 下一步：进 **Wave 5**（A15 CLI 通用操作外壳 / prototype-intake 原型 intake + schema 对账 HITL / A18 未审核态全栈闭环）。
- ✅ A11（per-connection 归类，Wave 1，亲手验过真 UI）。
- ✅ A6（拟真值域 + 越线植入；全服务 e2e 跑通，仅余 A6.3 电池内部收编=可选，电池字节已保持）。
- ◐ A3（A3.3 规划器 + A3.1 14 域注册表 + A3.4 索引复用 + A3.2 两库 **均 done**；仅余 A3.1 参考本体基线 95 节点，低优先 → A3 核心能力链已闭合）。
- 下一步：A3 核心已闭合（域→规划器→索引→两库）；可进 **Wave 2**（A1 求解器→MCP / A8 CP-SAT / A13 地板语义 / A4 对象浏览器），或补 A6 尾巴 / A3.1 参考基线。A16 决策已定可排期。
