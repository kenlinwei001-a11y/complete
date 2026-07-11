# 本体切片 §3 · 关系图谱（链路 = 模块间关系）

<!-- 自动生成·勿手改 -->
> ⚠ **本文件由 `scripts/build-ontology-slices.mjs` 从母体 `docs/SYSTEM-ONTOLOGY.md §3` 派生**（本体克隆切片·层 2）。
> **改接线改母体 §3，再跑 `node scripts/build-ontology-slices.mjs` 同步**（勿直接改本文·门 `ontology-slices:check` 守漂移）。母体 hash `947bcbb6f178ae77`。

---

## 3. 关系图谱（链路 = 模块间关系）

> `A --关系--> B`。**⚠ = 已知断/弱链（见 §8）**。

**编排链（问句→答案）**
```
Query --classify--> Intent --planRef--> ExecutionPlan --step--> { Solver | SliceSpec | Rule | ActionType | render }
                       │                                              │
                       └─(路径B回退)──> Agent --uses--> Skill          ├ invoke_solver --OBO HTTP--> DataCore Solver
                                              │                        ├ query_objects --> ObjectInstance(A6过滤)
                                              ├ ruleBindings--> Rule    └ evaluate_rules --> Rule(BLOCK 短路)
                                              └ tools--> Solver/MCP
ExecutionPlan --render--> AnswerBlock{ table|kpi|text|rule_violation|action_draft } --SSE--> 前端
                       ├─**B→A 存在性探针（引用闭合·发布门）**：workflow 步骤 solverKey/ruleIds + agent scopeDeclaration.objectTypes
                       │  发布前经 DataCore 校验真实存在（probeMissingRefs，fail-open；不存在=死路拒发布）
                       ├─**agent→agent 交接落 Handoff（WO-C·可审计）**：`runPathB` 委派点——本入口配了场景 agent 但**不可用**
                       │  （未发布/缺失）→ 回落 `agt_universal` 时，`runUniversalAgent` 于 engine 运行**前**落一等 `Handoff`
                       │  { fromAgentId=场景 agent 真持久 id → toAgentId=agt_universal · carriedSlots/carriedEvidence 真值 · reason }
                       │  （AGENT-UNIVERSAL C2 `agentRun.agentId` 同坐标系）。事件 `agent.handoff`；decision-trace/推演 DAG 渲染交接节点。
                       │  记录早于下游运行 → 即便无 LLM/下游 FAILED 交接仍留痕（闭合"委派不可审计"缺口·§8 G-3 邻域）。
                       ├─**澄清传输链（CLARIFY-CHAIN-FIX·治簇⑨）**：缺槽 → `clarification.required` payload 走**单一契约**
                       │  `contracts/qos.ts ClarificationSlot/ClarificationRequiredPayload`（服务端 `slots.ts toClarificationSlot`
                       │  产出：人话 clarifyPrompt + enumValues + objectType[refType 归一]；前端 reducer 直引契约类型·禁 fork）
                       │  → 前端 Clarification 按 clarifyPrompt 渲 label、enum 渲真选项、按 round 重渲多轮（submitted 按轮记）
                       │  → 回填结构化对象引用归一**业务主键**（真 DataCore {id,props{modelId…}} 形·下游切片/求解器可用）。
                       │  红线：服务端有的人话 = 用户看到的（逐值）；门 `clarify-humanized:check` 守两端字段对齐。
                       ├─**澄清收敛终态（CLARIFY-LOOP-CONVERGE·P2·Kimi 端到端真跑发现·2026-07-06）**：低把握自由问句
                       │  （τ_low ≤ conf < τ_high）→ INTENT_CHOICE 澄清。同一 task 澄清轮次本已**有界**（INTENT_CHOICE 轮1 →
                       │  槽位反问轮2 → 耗尽·`clarificationRounds≤2`·非无限追问）——真根因非"重分类循环"（编排层无重入 classify），
                       │  而是**用户经 INTENT_CHOICE 显式锁定的意图在缺参耗尽时被静默丢进开放式路径 B 泛答**，丢弃了用户
                       │  "就问这个意图"的明确选择 → 用户感知为"选了白选·反复澄清不收敛"。治：`proceedWithIntent(…,locked)`
                       │  锁定标记随 INTENT_CHOICE 选定→槽位轮次传播（`PendingClarification.locked`）；锁定意图轮次耗尽 →
                       │  `completeLockedClarifyDegrade` **诚实降级终态**（COMPLETED·点名锁定意图+明说缺哪些参数+指路补齐·
                       │  绝不合成/兜底业务数字·非 FAILED），**绝不**静默转路径 B。非锁定（高把握纯槽位反问耗尽/"都不是"拒绝
                       │  全部候选）保持既有路径 B 语义（PRD §5.1.2-4·A5 不回归）。齿 `clarify-loop-converge.test.ts`
                       │  （锁定→诚实降级 path=WORKFLOW·revert→path=AGENT 红 ⊕ 对照非锁定→路径 B 不回归）。
                       └─**B→A 交叉验证（推演验证痕迹·运行时）**：用到 resolve_slice 的推演完成时，把结论对象断言
                          --OBO HTTP /a/v1/ontology/cross-validate--> DataCore 对照知识图谱已有事实核对（fail-open），
                          连同一致性检查组装为 Answer.validationTrace（前端 ValidationTracePanel 展示，让用户信任）
```
**求解器 MCP 暴露链（A1）**
```
DataCore SolverRegistry(全集 32 = 业务场景 22 + 净室通用 9 + 决策驾驶舱 1，feature 过滤) --GET /a/v1/solvers/registry-->
  AgentCore `solvers` MCP server(mcp/solvers-catalog.ts buildSolverMcpTools，确定性按名排序) --GET /b/v1/mcp/servers/solvers-->
    工具 mcp__solvers__{key}(治理页可见/mcp-router 可选) --Agent 调用--> executor A1 shim(零重写归一回 invoke_solver)
      --OBO HTTP /a/v1/solvers/{key}/invoke--> DataCore Solver
  · 收敛纪律：「无 LLM 描述不允许发布」→ 注册表每条带描述（catalog.test 守无漂移：注册表键集 === SOLVER_KEYS）
  · feature 过滤先于 authz（关 view.plan-audit → plan_audit 工具消失，R3）；与 QOS 场景 discover(22) 分列、互不影响
  · WO-RESOURCE-REF：MCP 页（McpPage）用户自建 MCP **之下**增「求解器（平台内置）·内置·READ」分区（fetchSolverMcpServer → GET /b/v1/mcp/servers/solvers），点开列 mcp__solvers__* 只读；agent/skill 的 MCP 引用（McpRefSelect）值域 = 用户自建 ∪ 内置 solvers server（mcpConfigId="solvers"）。「求解器即 MCP 的一种」前端接通。
```
**平台自身作为对外 MCP/A2A 服务端表面（WO-A · PLATFORM-AGENT-SURFACE·纯投影层·零新执行逻辑）**
```
外部 agent --GET /b/v1/mcp-server (+/api/v1 别名)--> AgentCore MCP server 表面(mcp-server/routes.ts + projection.ts)
  · tools/list = deriveSolverTools(SOLVER_REGISTRY 经 /a/v1/solvers/registry·OBO+entitlement 过滤) ∪ deriveOperationTools(OPERATION_CATALOG r4=false 只读项)
      工具名 platform__solver__{key}（可执行）/ platform__op__{op}（只读描述性路由·executable=false）；inputSchema 从 argHints 派生·outputShape 投影自 SOLVER_OUTPUT_SHAPES
  · tools/call platform__solver__{key} --归一到既有 REST--> deps.dataCore.solver.invoke = POST /a/v1/solvers/{key}/invoke（OBO·零新业务逻辑·逐值==REST invoke）
  · A2A：GET /b/v1/a2a/agent-card（技能=求解器工具·descriptor 派生）；POST /b/v1/a2a/tasks（task≈QueryTask）--映射既有--> orchestrator.submitQuery = POST /api/v1/queries；GET /b/v1/a2a/tasks/:id 映射 GET queries/:taskId
  · R14：新 solver / 新行业 pack 求解器进注册表 → 工具/技能自动现，无逐工具代码（buildSolverMcpTools 姊妹·对外方向）
  · 无匿名面：所有方法先 auth（Bearer JWKS 验签 / X-Debug-User）→ 401；OBO 透传用户身份，行级过滤/entitlement 由 DataCore 单一执行点权威裁决（R2/R3·不新增第二套 authz）；跨租户 task 查询 404
  · 与 A1 内部 `solvers` MCP server（mcp__solvers__{key}·平台作为消费方/客户端·B3）区分：本表面=平台作为被调用方/服务端，前缀 platform__，契约 contracts/agent-surface.ts
  · 齿检 test/platform-agent-surface.test.ts（12）· FDE 真起证据 docs/evidence/platform-agent-surface-fde.md（47 工具==注册表·逐值==invoke·401/404 门）
```
**场景/入口链**
```
ScenarioCard --view--> View(规划与平衡/推演与风险/…)
ScenarioCard --intentKey--> Intent          ✅ 20/20 接通（种子从目录派生意图+计划，G-1 已修）
ScenarioCard --presetContext--> SessionContext{selectedObjects, presetSlots} --POST /b/v1/scenarios/:key/launch--> Query
                                  ✅ P1 已接通（presetSlots 注入通道 + fillSlots 消费 + launch 端点；20/20 零反问门 scenarios-wiring）；前端启动器待 P3
  槽真相链（LAUNCHER-SLOT-TRUTH·治静默错答）: classification.extractedSlots --normalizeExtractedSlots(钉扁平·吸嵌套)--> 扁平{slotName:value}
      --fillSlots(优先级 本轮显式 extraction > 上一轮 chip defaultFrom > preset·记 sources/substitutions)--> slots
      --applyExtractedArgOverrides(仅 extracted 覆盖 invoke_solver 烘焙入参·objectRef压标量)--> 真进求解器
      --buildSlotTruthBlocks(④回显所用实体/参数 + ⑤substitution→诚实横幅『你说的X未能对应·本次按Y作答』)--> Answer
    根A(嵌套 {intentKey:{slot:v}} 原样传→扁平取全 miss→落旧 chip→问合肥答常州绿标) 与 根B(派生意图 slots:[]+入参种子期烘焙) 已治;
    红线: 本轮显式必胜 chip · 答案回显所用实体 · 无法映射诚实横幅非假绿 · 绝不静默换题 (齿 launcher-slot-truth.test·revert→red)
Scenario --intentKey--> Intent --planRef--> ExecutionPlan · --defaultAgentId--> Agent   ✅ P2 一等对象；**引用闭合「无死路」上架门**（scenarioClosure：意图存在+绑计划+AGENT模式agent已发布，断链拒发布 409）+ computeReferences 反查（Agent/Workflow 页可见"被场景引用"）。**WO ONTO-SCEN-GATE-WRITEBACK（收口门·§2.3）：scenarioClosure 从「查存在」升级为「查跑通」**——返回增 `{structuralOk,verified,runThrough}`：卡若已 grow 亲手跑过（有 lastOntogenesisRun 留痕=真实跑的凭据）→ readiness 反映**实跑结论**（未 VERIFIED 即诚实 not-ready + 实跑缺口挂 issue，不靠结构存在假绿）；未 grow 卡仍取结构地板 ready（向后兼容"先发布后发育"）；内部 verifyScenario/降级 rings 用 `structuralOnly`（只取存在环·避上一轮 run 陈旧缺口自污染）。齿 scenario-closure-runthrough.test.ts
MaterializedIntent --mode--> { workflow-first→Path A 工作流 | agent-first→Path B Agent } · --bindings--> { Solver·Rule(eval)·Constraint·Skill·SliceSpec·(Agent|Workflow) }   ✅ WO-INTENT-MATERIALIZE-BINDING-COMPLETE：20 场景 intentKey 全物化为一等 PUBLISHED Intent（mode 由审核方钉死·全绑定链 6 项齐）；**补齐链** `MaterializedIntent →(reconcile 缺项检测)→ scaffold DRAFT →审核发布`（接 sys.meta.change_loop·R4 不自动上真值·复用 self-growth scaffold）；全绑定链门 `scene-agent-config:check`（扩）守回潮。**MODE-DISPATCH-HONOR（审计簇⑦·mode 钉死表被场景实体架空·分发已尊重·2026-07-05）**：此前一等 Scenario 投影一揽子 `mode:"WORKFLOW_FIRST"`（`scenarios-catalog.ts scenarioFromCard`）且 orchestrator 只看 `scene.mode` → yield_diag/maint_stagger/outsourcing_q/capex_review/quarterly_gap_q（7 agent-first 之五·审计实测）分类命中后仍被压回 Path A 工作流表格，「为什么/哪个好/怎么选」永不触发 agent 推理——钉死表被架空。治（不重定 modes·只让派发尊重既有表）：① 钉死表移 `intents/intent-mode.ts` 为**唯一真相源**（materialize.ts re-export 兼容·scenarios-catalog `scenarioFromCard` 的 mode 改按 `intentModeFor(intentKey)` 派生 → 一等 Scenario 投影不再对 13/7 撒谎）；② **意图已解析的唯一分发点** `orchestrator.proceedWithIntent` 先查一等权威 `repos.materializedIntents.byKey(tenantId, intentKey)`（R14 数据驱动·读可编辑一等对象非硬编码表）——PUBLISHED 且 mode=AGENT_FIRST 且绑定 agent 已发布 → 委派 `runConfiguredAgent`（与 runSceneAgent 共用单一机制·routing.completed note=`意图权威模式 AGENT_FIRST（一等 Intent {key}）`·agentRun.agentId 持久化=绑定 agent·AGENT-UNIVERSAL C2 同坐标系可审计）；查无一等 Intent/绑定 agent 不可用 → 回落既有链（Path A·全 -first 保兜底）。workflow-first 13 意图零回归（仍 Path A）；scene.mode 链（runPipeline 入口级 AGENT_FIRST/WORKFLOW_ONLY）不变。齿 `mode-dispatch-honor.test.ts`（9 例·revert 分发/revert 场景一揽子→red 已自证）
SceneEntry --viewKey--> View · --defaultAgentId--> Agent · --intentCatalogFilter--> Intent   （降为投影）
**卡发育链（G-9·PRD-scenario-ontogenesis·WO ONTO-SCEN-GROW 收口）**
Scenario(卡=胚胎) --POST /b/v1/scenarios/:key/grow--> growScenario(server.ts·倒序发育，复用不重写：
    意图/计划=ensureScenarioPackageSeed per-id 幂等自愈(种子守卫根治·包存在意图空也重种) · 规则=injectScenarioRuleStep 自动插 evaluate_rules(O10)
    · 切片=OBO planSlice(A3.3 slice-planner·O11) · 缺件=buildGrowthLoopWiring 单源 probe/fill(与 /api/v1/growth/run 共用 RL3)
    · 缺数据=DF.9 正门(fill-data 经 connectors.upload / provision-world 经 synthetic.runJob·空租户安全门) · 缺求解器/计划=scaffold DRAFT(R4 不自动发布)或开 GrowthTicket)
  --A10 verifyScenario(triggerQuestion 经 QOS 正序实跑到终态·真答案=非空/非 gap/非探索兜底/dataBearing 承载数据)--> maturity{GOVERNED|ADVISORY|PROVISIONAL+gapCode}
  --留痕--> ScenarioOntogenesisRun(一等仓储 ontogenesisRuns·内存+PG migration 012·卡挂 lastOntogenesisRunId)
  --事件--> scenario.{growth_triggered|matured|gap_detected}(SSE 场景通道 ⊕ 域事件 outbox 双通道·§4 L4)
  --正序--> launch 确定性绑定(GOVERNED 卡 scenarioIntentKey → 跳过 LLM classify·deterministic:scenario-bind) --> answer(KPI/表投影)
  真 PG live-fire：包存在意图空的 PG 库 grow → ensureScenarios 懒自愈意图 → GOVERNED → 点卡出 KPI（test/scenario-grow-pg.integration.test.ts·env-gated DATABASE_URL_TEST）
  ⊕ WO ONTO-SCEN-RENDER-PROJ（P2 收口·16 卡占位根除·真投影）：
    ① 渲染投影绑定：contracts `SOLVER_RENDER_BINDINGS`(每求解器声明真实输出字段→kpi/table/text 块·零业务常数 R14)
       --驱动--> seed 派生循环 render 步(`solver_summary` 携 bindings·静态占位文案死) --> `summarizeSolverOutput(…,bindings)`
       绑定优先投影(bound-first KPI·绑定表即结果表·绑定字段缺席=抛错诚实红不占位)；genome.renderBindings=计划真实绑定派生
       (`genomeRenderBindingsOfSteps`·内置卡取模板引用/派生卡取 bindings)·⊆ SOLVER_OUTPUT_SHAPES 由门+真值齿双守(G-2 闭)
    ② 规则烘焙：injectScenarioRuleStep 从 dispatch 期扩到**种子期烘焙进派生计划本体**(S18 等 SOLVER_RULE_REFS 未覆盖卡
       得 evaluate_rules 步·自由问句同意图同样执行)·裁决进 answer.validationTrace(AXIOM)/BLOCK 拦截
    ③ 切片自动生成：卡未声明 sliceTargets → contracts `deriveSliceTargetCandidates`(SOLVER_DATADEP 角色→DATADEP_ROLE_CANONICAL
       规范类型·确定性 R6·非手焙) → planSlice(A3.3 BFS ⊕ A3.4 索引复用·planner=可达性唯一裁判) → 部分不可达以可达子集
       重规划收敛(无链路清单类型≠切片缺口·经就绪探测直读覆盖)·全不可达收敛空目标 → planner 校验过的覆盖回写卡+genome
    卡=胚胎携 genome(ensureScenarios 播种即挂·grow 对存量卡回填·deriveScenarioGenomes 单源派生)
**launch 确定性链 + 缺口诚实处置链（§2.4/§2.5 收口·WO ONTO-SCEN-LAUNCH-DET）**
launch/useScenarioLaunch(context 带 scenarioIntentKey+scenarioKey·前端接缝已补齐——此前 UI 点卡缺 scenarioKey 致 O10 规则注入与缺口链失联)
  --runPipeline: GOVERNED 卡(repos.scenarios.byKey 判相位)--> 全程零 classifier：
      候选命中 → deterministic:scenario-bind 绑意图→计划(槽位未满足也走确定性 SLOT_FILLING 澄清·不回落 LLM classify)
      意图不可绑定(退发布/删除/entitlement) → completeScenarioGap(INTENT_NOT_AVAILABLE·不落探索)   ← classify LLM 只服务自由问句(D8=发育自然结果)
  --不可答(Path A 运行失败如删求解器/路由死路)--> attachScenarioGapAnswer → scenarioGap 钩(server.ts 装配·orchestrator.setScenarioGap·task.internal=grow/probe 内部验证不触发):
      classifyGap(法定码·纯函数 R6) → GapReport
      GAP-ACTIONABLE(WO-3·PRD-trustworthy-self-accounting §3.4·修 P3 用户实测痛点「常州基地的瓶颈是?」→工单看不到补什么/在哪补):
        ① 去 OTHER catch-all「丢真相」：具体错因 `LLM_PURPOSE_UNBOUND`(orchestrator.sanitizeLlmAuthLeak 归一码/鉴权泄漏签名)
           **入正式缺口码表**(codeFromError 显式映射·gapDisposition=NEEDS_HUMAN 穷尽)；未映射码仍归 OTHER 但**保留 evidence 原文**。
        ② 每张缺口 finding 经 `actionableFill(code,question)` 派生 `{what 缺什么·where 补在哪·acceptance 验收=本问句 NL 真跑 E2E 答出}`(GapFinding additive 三元)
           → suggestedFill 含真修法(如「设置→LLM 用途绑定」)·**永不「人工核实内部错误」**(FILL.OTHER 亦改可行动导语)。
        ③ **视图键 ≠ 对象类型**：scenario-grow.ts DataRequest.typeKey 与 server.ts GrowthTicket.ontologyRefs.objectTypes
           只收**显式声明的对象类型**(selectedObjects[*].objectType)，缺失回落 "Object"·**绝不把视图键(dash/risk)冒充对象类型**(此前致工单页「对象类型=dash」)。
        齿 growth-probe.test.ts(LLM_PURPOSE_UNBOUND→actionable·revert 拍 OTHER 红) + growth-autofill.test.ts(view=dash/risk 不入 objectTypes·revert 红)·真验 docs/evidence/GAP-ACTIONABLE-fde.md
      → GrowthTicket(同卡同码 OPEN 幂等复用不刷屏) + growth.ticket_opened(outbox)
      → 通知+收件箱(仅新开票一次·B→A 服务间 POST /a/v1/notifications/notify-role[x-service-token·用户态 403] → NotificationService.notifyRole 角色扇出 admin → 前端铃铛/通知中心·refType=growth_ticket 深链)
      → 卡降级(GOVERNED/ADVISORY→PROVISIONAL) + ScenarioOntogenesisRun 留痕(launch 起源·verification.taskId 溯源·gaps[].ticketId) + scenario.gap_detected(SSE⊕outbox)
      → 答案=gap 块(契约 additive scenario{scenarioKey,name,maturity,ticketId}) → 前端 GapCard 复用渲染诚实发育卡「此卡发育中：缺 X · 已建工单 #N →/admin/tickets?ticket=（统一工单中心直开详情抽屉·additive searchParams）」
  全站零死答：agent/loop.ts degrade 空产出(无文本/无推理)→ 结构化 gap 块(OTHER·question=task.query 可续推)替死答串；grep 门 ontogenesis:check §2.5 守源码零「未能产出回答」回潮即红
  齿 scenario-launch-deterministic.test.ts(5·classifier 物理拔掉/revert 绑定即红/删求解器降级链/工单+通知幂等/internal 不触发) · 真验 docs/evidence/ONTO-SCEN-LAUNCH-DET-fde.md(无 LLM key 双服务+真浏览器三截图)
**§6 六断言收口门（WO ONTO-SCEN-GATE-WRITEBACK·真跑 vs 查存在）**
  运行期门 `ontogenesis-runtime:check`（scripts/check-scenario-ontogenesis-runtime.mjs·gates 链唯一**真起 agentcore 逐卡 grow** 的场景门·与 seed-demo-smoke 同范式）：
    §6.1 每 GOVERNED 卡 verification==VERIFIED + rings.data + 答案含承载数据块(kpi/table/action_draft/⟦ref⟧·投影真值非占位) ·
    §6.5 非 GOVERNED 卡必带 gaps[]，每条 disposition∈{AUTO_DERIVE,NEEDS_HUMAN}，NEEDS_HUMAN 必带 ticketId(无静默残缺) ·
    工作流地板：13 张 WORKFLOW_FIRST 卡确定性 GOVERNED(无 LLM 也必过·revert 渲染投影→PROVISIONAL/RENDER_NOT_PROJECTED 即红) ·
    §2.4 抽样 launch S01 → classification.model==deterministic:scenario-bind + Path A + 承载数据块(点卡真决策视图)
  §6.2/6.3/6.4/6.6 静态内核仍由 `ontogenesis:check`(check-ontogenesis.mjs) 守(renderBindings⊆SOLVER_OUTPUT_SHAPES·rules⊆已发布·目录派生)；
  两门互补：静态门守契约不漂 + 运行期门守真跑通。实测分布 20/20 GOVERNED（mock DataCore 合成世界 + 确定性 Path A）·真验 docs/evidence/ONTO-SCEN-GATE-WRITEBACK-fde.md
```
**数据→本体→推演链**
```
Connector --produces--> RawDataset --suggest/modeling--> OntologyDraft --publish--> OntologyType/Link/Version
RawDataset --materialize(幂等)--> ObjectInstance --runDerivations--> DerivedProperty
RawDataset --export(.xlsx/.csv)--> 下载文件(合成源标 .synthetic·真业务行·R6 字节稳)   ✅ WO-SOURCE-TRANSPARENCY（GET /a/v1/raw-datasets/:id/export·数据连接器页「下载 Excel」·消灭走捷径）
所有 RawDataset --export.xlsx(多 sheet:概览+每集一 sheet)--> 一张下载文件(真业务行·空集诚实标注·>5万行截断标 truncated·R6 内容无时钟·R2 仅本租户)   ✅ INTAKE-XLSX-EXPORT（GET /a/v1/raw-datasets/export.xlsx[?connId=]·数据连接器页「导出全部源数据(Excel)」/连接级「导出本连接源数据(Excel)」·闭 G-13①产品化）
SyntheticJob --gen(seed)--> Connection(合成源)+RawDataset/RawRow --materialize--> ObjectInstance(origin 溯回 rawDatasetId/rowIdx·**R-NO-ORPHAN-SOURCE 门守无凭空**)/Link   ✅ 活数据可溯 P1（synthetic/service.ts；不再凭空落对象）        IndustryTemplate --驱动--> SyntheticJob
ObjectType <--reads-- Solver(入参字段)     ObjectType <--scopes-- Rule     ObjectType --domain--> SliceSpec
DemandSegment(forecast·p50/p90/tgt) + SopVersionRow(plan·demand/supply) --需求侧--> risk_timeline(紧张度 tension)   ✅ WO-FORECAST-SIM（紧张度 = 真需求−产能 缺口·替 mockTightness 哈希）
capacity_rollup(基地周产能 weeklyWan) --供给侧--> risk_timeline   ·  `solvers/risk.ts demandCapacityTightness`（负载比=真需求÷真产能·量纲无关·R6 确定性·无 Math.random/Date.now）
  └ 需求驱动因素（瓶颈工序/人力工时/物料齐套）基线张力由此派生 → `dataMode=LIVE` + `demandGap{gapWan,source}`（缺口=预测需求−产能·可溯 R13）；无真预测回落 mockTightness → MOCK（诚实不冒充）。改 DemandSegment.p50/SopVersionRow.demand 真值 → 张力曲线随之变（非哈希恒定，门 solvers.test V5d 守）。`loadContext` 注入 DemandSegment/SopVersionRow（types.ts SolverContext）。
SolverParam <--adjusts-- Calibration       Action(EXECUTED) --writeback--> ObjectInstance(props,二次派生)
Action(APPROVED) --execute--> WritebackAdapter{MockWritebackAdapter | ErpRestWritebackAdapter} --出站--> 目标系统   ✅ WO-ACTUATE（决策出站写回适配器·G-14）
  └ **可插拔出站写回适配器**（`actions.ts ActionExecutor`=适配器接口[readonly kind:"MOCK"|"ERP_REST"+返回 target{kind,system?}]·`writeback.ts` 两实现·config `WRITEBACK_TARGET=mock|erp_rest` 默认 mock 经 `app.ts buildWritebackAdapter`→setExecutor）：
    ① **MockWritebackAdapter**（kind=MOCK·现期）：execute 成功**自动 `repos.writebackEchoes.put`** 落写回值（ref=targetRef·writtenValue=payload 快照）→ 闭 OC5 reconcile 半手动残口（不再靠手动 POST /a/v1/writeback-echoes）；targetRef/ref 由 draft.id hash 定（确定性 R6）·echo 带 tenantId（R2）。
    ② **ErpRestWritebackAdapter**（kind=ERP_REST·真 ERP 协议 stub）：未配 `WRITEBACK_ERP_BASE_URL`→`{ok:false,error:"WRITEBACK_NOT_CONFIGURED"}` 诚实降级（仿 optimizer-client 未配范式·绝不假装写成功 R13）；body 实现留 TODO（REST 契约 `POST {baseUrl}/writeback {actionId,tenantId,actionTypeKey,payload}` 定义清楚·待真 ERP 接入·凭据经 credentialRef AES-GCM 解密 no-secrets-echo R5）。
    Action 记 `writebackTarget`+`executionResult.target` → 前端 Action 详情「写回目标：MOCK（确定性·非真 ERP）」徽标（R13 诚实标·不冒充真写 ERP，复用 DataModeBadge 范式）。`GET /a/v1/writeback-echoes` 列 pending echo。沙盘采纳→Action 走正门 R4/RL4（模拟态不直写）经本适配器出站。
Rule(PUBLISHED 决策阈值) --RULE_SCAN 命中越线--> RuleAlert --mitigation_select--> 处置建议 --decision.alert(NOTIFY)+notifyRole(planner)--> 待办(PUSH)   ✅ WO-ALERT（D6 §3.7 主动决策推送·替纯 PULL；`scheduler.ts pushDecisionAlerts`；采纳经既有 adopt_mitigation Action 审批 R4）
SolverExperiment(RUNNING·冠军-挑战者) --实验分流(确定性 hash(tenantId+solverKey+请求键)%100<splitPct)--> Solver.invoke   ✅ WO-EXPERIMENT（④·决策 A/B）
  └ 命中挑战者臂 → `paramsAt(tenantId, challengerVersion)` 取该参数版本（否则 champion 当前版本·关实验=零影响既有）；
    输出附 `__experiment{id,arm}`（不污染主结果·R13 诚实标）；按 metricKey 输出字段值累加到对应 ExperimentArm（R6 确定性）；
    conclude 按两臂均值落胜方 → `experiment.concluded`（§4 L19）。`solvers/service.ts invoke/routeExperiment/chooseArm`。
    分流确定性（hash·非随机·R6）：同 (tenantId,solverKey,请求键) 必落同臂（门 `experiment-determinism:check` §7 守不回潮）。
Connector --upload(.csv/.json/⚠.xlsx-TODO)--> RawDataset    ⚠ 无"数据模版定义"；合成已并入连接器（产 Connection+RawDataset，活数据可溯 P1）
Connector(EXTERNAL/mock_external) --sync--> RawDataset(external_signals) --materialize--> ExternalSignal(domain=external)   ✅ EXT_SIG P1（一等对象+连接器+GET /a/v1/external-signals）
ExternalSignal --敏感性(elasticity)--> 规划指标(毛利/需求/出口营收/成本)   ✅ P2（POST /a/v1/external-signals/sensitivity：Δ指标pp=Δ信号%×elasticity 按 impact 聚合，确定性无副作用）
ObjectInstance --lineage 反查--> RawRow→RawDataset→Connection + 派生口径   ✅ P2 端点（GET /a/v1/lineage/object/:type/:id）+ P3 前端悬浮溯源（LedgerView `<Provenance>` 组件，数据源原始表经 FieldProfilePage 可见）；结果→求解器入参对象 lineage 待后续
```
**数据构建发动机链（需求拉动）**
```
StoryScript --comprehend(LLM)--> BuildPlan{dataSources,objectTypes,rules,solverNeeds(+args 倒推),kbDocs}
  └ **自造求解器名确定性收敛**（`comprehend.ts SOLVER_ALIASES/normalizeSolverKey`，R6）：思维型 LLM 即便给了已注册
    目录(`comprehendSystemWithSolvers`)，仍会按问句语义自造 capacity_feasibility/schedule_impact 等名 →
    闭包 SOLVER_NOT_FOUND、链路 BLOCKED。装配 `assemblePlanBody(...,SOLVER_KEYS)` 时把已知同义名硬收敛到
    平台真实 key（capacity_feasibility→capacity_forecast、schedule_impact→affected_orders、displacement→
    shared_bottleneck、profit_loss→margin_attribution…），使链路闭合不依赖 LLM 措辞；未命中者原样保留→仍作自成长工单浮现。
  └ **FDE 求解器参数自动倒推**（`databuilder/solver-args.ts deriveSolverArgs`，确定性 R6）：从对象类型字段/ref 结构推出
    多跳求解器路径/字段映射（shared_bottleneck/concentration_risk/margin_attribution），写入 `solverNeeds.args`→`planNeeds.args`
    →scaffold `ExecutionPlan invoke_solver step.params.args`→启动器跑此计划即真调求解器**出答案（非空答）**；
    需运行期标量(rootId/budget)的求解器诚实留空（不编造）。闭合 G-3"场景→答案"的求解器入参一环。
BuildPlan --validateClosure--> ClosureReport{反向-对象, 反向-data, 正向-求解器入参}  ⚠ 闭包不含 AgentCore 栈/全链
BuildPlan --gap(幂等)--> 复用已有/标缺  --rawin--> Connector/KB  --transform--> 本体/规则/派生  --publish(Action)--> 真值
  └ **工业级工作流运行时**（`workflow-engine.ts BuildWorkflowEngine`）：上述 HARD 门以**持久化步骤状态机**承载——
    StoryScript→[dry_build→cross_scaffold→publish_build→validation→inference→record] 每步落库检查点 →
    崩溃可 resume（已成功步跳过、context 复用）；瞬时失败有界退避重试；致命失败止于该步保留现场。
    `runStory` 与 `POST /a/v1/databuilder/workflow-runs` 共用同一组步骤（单一执行路径）。**不再是内存 try-块**。
  └ **比对现状 gap_analysis（一等步 · ModuleProvisioner 注册表）**：cross_scaffold 后插入——倒推 BuildPlan
    vs 系统现状 → 跨模块统一 diff（需要/复用/新建/缺）。这是"倒序"管线 query→倒推→**比对现状**→创建 的接缝。
    13 个 provisioner 覆盖 BuildPlan 全部 need 数组，覆盖门强制新模块纳入（`provisioners.ts analyzeGap`）。
  └ **统一 diff 纯核 + 预分析旁路（PRD-gap-analysis-engine §3/§5/§8）**：diff 纯核 `diffGap(required,existing,meta)`（落 `@platform/contracts`·R1/R6·`generatedAt` 由 meta 注入·同输入 byte 一致）**已落地（Phase0-1·UPG-L0-GAPCORE）**——`analyzeGap` 已改为「收集 required/existing → 调 `diffGap`」（无损改造·对外签名与输出 byte 与改造前一致·唯一调用点 `service.ts` 零改；cross_system 三态经 existing(REUSED)+missing(scaffold MISSING) 集忠实复现）；契约扩 `GapAnalysis.target?/coverageScore?/executionPlan?` + `GapItem.severity?/explanation?/remediation?`（全 optional 向后兼容）已冻结；有界快照端点 `GET /a/v1/databuilder/registry-snapshot`（仅 6 类 A 栈·复用 `provisioner.existing()`·SERVICE_TOKEN/OBO service·用户 JWT 403·entitlement `databuilder.registry-snapshot` `defaultOn:false` 暗发 RL2·关=404）**已落地**。script 目标（DataBuilder）与 query 目标（Growth·existing 来自 AgentCore 组装 `CapabilitySnapshot`）**共用同一核**产同形 `GapAnalysis`。🚧 **拟立·待落地（Phase2）**：query 目标预分析 `preAnalyzeQuery` 是**正序旁路**：Query --classify(复用 ClassificationResult)--> 显式需求 --expandHiddenRequirements--> 隐藏需求 --diffGap--> `PreAnalysisReport`（异步·不阻塞 SSE·咨询信号非判决·R13）。**隐藏需求依赖闭包（不造假 key·R14）**：`Solver --SOLVER_DATADEP.requires--> roleType --SolverBinding.resolve--> 租户真实类型`，并沿本体图 `ObjectType --linkKey--> ObjectType`（`GET /a/v1/ontology/graph` 真实边）走一跳扩展；每个 key 过三张真实白名单（本体图节点/边·`SOLVER_DATADEP` 键）→ 结构上不产幽灵 key，缺口只经 `checkReadiness` 报「真实数据不足」（G-8）。
  └ **B 栈 scaffold 单机可见（A7，可见/在线解耦）**：cross_scaffold 步**无条件**把倒推 B 栈需求落
    `StoryBuildRun.scaffoldManifest`（PENDING_BSTACK）→ 单机/未配 B 也看得到生成的 agent/plan/scene 定义；
    B 上线 `reconcile-scaffold` 幂等下发升 SCAFFOLDED/REUSED（`scaffold.manifest_recorded`/`reconciled`）。诚实 SOFT/HARD。
  └ **终态闭环验证（A10）**：publish（R4 EXECUTED 落真值）后 → workflow `onComplete` 自动把主问句经 QOS
    重跑（`verifyBuild`）→ `StoryBuildRun.verification` VERIFIED/NOT_VERIFIED/BUILD_STATIC + `build.verified`；
    亲手跑通 `POST /runs/:id/verify`。闭合"建域→答案"终态一环（绿测试≠能用），与 growth LOOP CONVERGED 归一。
  └ **FDE 编排节点化（A5，观测层）**：上述执行步**确定性投影**为 8 个 FDE 语义节点
    `意图→倒推→查能力→比差→各模块生成→闭包→publish→进启动器`（`fde-graph.ts projectFdeNodes`）→
    引擎 onAdvance 每步迁移发 `fde.node_advanced` 实时点亮 + 落 `StoryBuildRun.nodes` → 前端 `<FdeGraph>`
    一眼看建域走到哪/断在哪（FAILED 节点红 + 缺口码）。不改建域真值，仅把既有阶段表达成可观测节点图。
```
**平台横切**
```
Tenant --隔离--> 一切读写/事件/缓存键    FeatureConfig --门控(先于authz)--> 端点/视图/求解器
Policy(A6) --行级过滤--> {query_objects, executeSlice, solver 读出}
LlmPurposeBinding --路由--> { classifier:QOS分类 · agent:路径B · extraction:规则抽取/构建 · modeling:建模建议 · template_gen:行业模板 · compose:llm_compose }   ⚠ 用途枚举写死、不可扩展；model 下拉依赖先选 provider。每绑定可选 `disableThinking`（Moonshot kimi-k2.5/2.6 思考模型）→ 该用途调用注入 `thinking:{type:"disabled"}` 跳过思维链；classifier 默认开（真跑实证 12.7s→3.6s，~3.5×），agent 留思考。
OutboxEvent --驱动--> EventSubscription(§4) --失效--> 前端缓存
```

**推演沙盘链路（增量 0 立 · 设计待落，详 `docs/SPEC-sandbox-propagation-and-session.md` / `docs/SPEC-sandbox-readiness-certification.md`）**
```
决策视图(风险卡/规划体检…) --openWhatIf(presetContext,WO-E2)--> /v/sim-sandbox?whatif=1&… ┐
本体世界态(合成/连接器/切片物化,走正门 R16/R4) --init(scope=presetContext)--> SimSession  ┘
  --propagateTick(系数×延迟,沿 viaLink 复用 recompute 导航 + risk.ts 衰减,纯函数 R6)--> SimTickState
  --checkpoint--> SimCheckpoint --branch(以 cp 态为 base)--> SimSession'
  --compare(复用 counterfactual_timeline 双序列形状)--> KPI 对比
沙盘 act(模拟态,不写真值) --采纳--> ActionDraft(走正门 R4)         ⚠ 禁直写绕审批(RL4)
what-if 进决策日常(WO-E2): 决策入口一键「开 what-if」→ useOpenWhatIf 编 URL query(source/subject/factor/label,确定性 R6)
  → SandboxView parseWhatIfPreset 注入 SimSession.scope.presetContext + 展示 what-if 上下文条 → 复用既有沙盘链(不新建引擎)
  决策完即弃(新会话)或采纳(R4 正门)；R3 隔离主世界不被污染。前端 whatif.ts + RiskBoardView「就此问题开 what-if 推演」按钮
WO-SIM-PRESET-INJECT(命门·治 G-3 launcher→view 接缝·G-VIS-1·additive)：**真启动器点卡 → 落点推演视图入参对口**（此前 slotPresets 只进 QOS 对话坞·视图用 models[0]×40万·G-3 未治）。
  **单一通道(C4)**：`useQuickLaunch` 点卡时落 `sessionStore.scenarioPreset{targetView,slotPresets,label,nonce}`；落点视图经 `useScenarioPreset(viewKey)` 读之(`normalizeViewKey` 两侧归一·nonce 只消费一次)。
  **落点键修**：`useQuickLaunch` 导航用 `normalizeViewKey(targetView)`(project→project-sim)——ViewPage 按 workspace.views 规范键查视图,短键 /v/project 查不到→ForbiddenPage(真点卡落空白)。
  **参数对齐**：`scenarioSlotsToPreset` modelId→model·demandDelta(相对)→绝对 demand(以 DEFAULT_QTY=40 为基·0.2→48)·weeks 直传(治「名不同/相对vs绝对」)。**4 视图读通道**：project-sim(型号/需求/时窗→capacity_forecast)·plan-audit(cashCushion 元→亿→现金垫)·plan-generate(目标键 override)·sop-balance(C5 示例占位值未改→运行前软阻断防喂 C21)。URL 深链通道保留(deep-link 兼容·分享链接走 URL·launcher 走 sessionStore)。
  牙齿 `resolveSimPreset`/`scenarioSlotsToPreset` R14 型号白名单+R6 裁剪。真启动器点卡 e2e(真浏览器·点 S01 卡「4680-NCM 加 20% 六周」→落 /v/project-sim→型号 4680-NCM·需求 input=48(=40×1.2·非默认 40)·6周·前端 input==求解器入参·oracle qty=48)：docs/evidence/SIM-PRESET-INJECT-fde.md(v2·BLOCK 复修)
WO-CAP-07-MODEL-DIM(链路⑤·型号产能链前端 surface·additive·闭「后端有·前端未 surface」)：**型号维度切片进推演沙盘**——后端型号维度早现成（`capacity_forecast` 按 modelId 建·`catalog.ts`；型号可产基地网络 `PRODUCIBLE_AT`·Model 一等类型 `graphmeta.ts`），此前推演沙盘只基地/全局态视角、从不 surface 型号维度。
  **链路**：`SandboxView` 挂 `ModelCapacitySlice`(独立 panel·不动 KPI/命令条/DAG 区) → 型号下拉**来自本体 Model 对象** `GET /a/v1/objects?type=Model`(R14 配置驱动·非写死·what-if 带入型号作初值) → 选型号 `capacity_forecast(modelId,qty,weeks)`(经 `useLiveSolver`·同前端既有求解路径) → 展示该型号 **P50/P90/缺口/主瓶颈** + **型号可产基地网络**(perBaseRows=可产基地·带各基地瓶颈/紧张度；nonProducible=不可产基地；producibleCount/totalBases 收敛)。KILL-MOCK-RED：紧张度 `live!==true` → 灰「估算」不染决策红。
  牙齿 `test/wo-cap-07-model-dim.test.tsx`(型号列表来自 Model 对象非写死·选型号逐值出 P50/P90/缺口/主瓶颈+可产基地网络·切型号重调求解器·无 Model 诚实空态)。真起 datacore+agentcore·真浏览器逐值对照(admin/demo1234·/v/sim-sandbox 选 4680-NCM→P50 5.2/P90 4.9/缺口 35.1/主瓶颈 设备OEE·可产基地 常州/成都/合肥·3/12 收敛·逐值==capacity_forecast 端点·下拉==本体 Model 对象)：docs/evidence/wo-cap-07-model-dim-fde.md
LAUNCH-VIEW-KEY-ALIGN(治 G-3 落点断链·簇② 404/403·单一键口径·additive)：`normalizeViewKey`/`VIEW_ALIAS` 的口径须**唯一对齐 workspace.views 真实注册键**——dash/risk 的真键**就是短键本身**(`{key:"dash",renderer:"dashboard"}`/`{key:"risk",renderer:"risk-board"}`·datacore `synthetic/service.ts`+mocks/fixtures.ts)，曾误把 dash→dashboard、risk→risk-board 当"规范化" → 卡落 `/v/dashboard`(无 `view.dashboard` feature=404·S15/16/20) / `/v/risk-board`(无 `risk-board` view key=403·S12/13)。**修**：`VIEW_ALIAS` 只登记 workspace 键≠卡短键的视图(sim 类 sop→sop-balance/project→project-sim/audit→plan-audit/generate→plan-generate/quarter→quarterly-rolling)；dash/risk/graph/order 短键即真键**不得再别名**(一别名即回归 404/403)。渲染器解析(`getRenderer`)另走 `view.renderer` 长名·不依赖此表补 dash/risk。牙齿 `test/launch-view-key-align.test.ts`(逐卡 targetView→真键=真放行·revert 别名→404/403 复红)。真起 datacore+agentcore·真浏览器逐卡(admin/demo1234·点 S12/13/15/16/20→落 /v/risk·/v/dash 真渲染无 404/403)：docs/evidence/launch-view-key-align-results.json + launch-S{12,13,15,16,20}-{risk,dash}.png
closure(validateClosure 五维) ⊕ GapReport(selfcheck) ⊕ TrialTick(propagateTick/recompute 空跑1tick)
  --deriveCertification(纯投影,零新校验 RL3·增量2 已落)--> SimCertification --canEnterSimulation(L4∧trial∧gatePassed)--> 「可进入推演」
propagateTick(增量3 已落): rules.coefficient/coefficientRef→rule.params × 源态 ×(decay) 沿 viaLink → next 态 + 延迟队列(arriveTick>t) + trace；无 PUBLISHED 规则=恒等 tick(opt-in 可回退)
PropagationRule.coefficient/delayTicks --引用--> rule.params(G-10 P1 可编辑) ⚠ 改规则即改推演,禁内联常数(RL5)
```

**优化融合链路（G-12 · 增量 0 立契约/本体/许可证 · 设计待落，详 `docs/SPEC-optimization-template-pool.md`）**
```
OptModelTemplate(抽象 9 核心,零业务常数) --OntologyBinding(A13 角色+slice 范围+DF.8 接地,每租户绑同模板到自己本体)--> 可解模型
  --optimizer-client sidecar 求最优(CP-SAT,R6 seed+单线程)--> 最优解(目标值/决策变量)        ⚠ 未配 OPTIMIZER_BASE_URL 显式"未接入"不兜底
NL --comprehend ⊕ embedding 复用检索(advisory,不入确定性路径 R6 地板,FUS2)--> 复用现有模板/补缺信号
optimize_whatif: OptPerturbation(结构化扰动,非裸代码) --DF.8 接地--> optimizer-client sidecar 重解(不进 A18 沙箱 FUS1,复用 recompute(dryRun) 不落真值)
  --> OptWhatifResult{Δ目标,可行性,冲突约束 IIS} --R13--> 解释 --R4--> 采纳(ActionDraft 走正门)   ⚠ 模拟态禁写真值(RL4)
行业模型 --派生(CDLA Results,不转发上游 .py LIC4)--> 行业租户(synthetic 合成→runStory 建本体→OntologyBinding→求解器注册→沙盘可推演,R14 两行业证)
系数 --OntologyBinding 类型化字段,可选 coeffSource=rule_params 引--> rule.params(G-10) ⚠ 规则是 gate 非系数源(FUS4)
```

**随机模拟链路（G-12 · METHOD-MC-STOCHASTIC · 已落·R6 确定性/R13 可溯源/R14 零业务常数）**
```
StochasticMethodTemplate(抽象·零业务常数) --MethodBinding(角色→本体属性,DF.8 接地)--> 逐迭代采样(seeded mulberry32·rngFromInput)
  --∏不确定因子相对乘子(cv=SolverParam mc.dispersion.*,陈旧×staleDispersionMult)--> 聚合 --经验分布 samples.sort--> type-7 分位
  --> {P90=升序0.10分位(保守下限),P50=0.50,P10=0.90(乐观上限)}+{method,iterations,seed,dispersionSource} --R13--> 前端诚实标「真实分位(蒙特卡洛 N·seed·离散度源)」
capacity_forecast: p50/p90 由「点估计×0.93 常数(伪分位)」→ 上链真分位；批次/what-if/校准 predictedP90 用 MC 派生 mcDispRatio(真实分位口径,非固定 haircut)
  ⚠ MC 作用域禁 Math.random/Date.now/new Date(RL·method-determinism:check 守)；cv→0 塌回点估计(=旧 p50)
```
> 许可证红线：MIT 署名 / CDLA 取派生 Results / **Gurobi 不碰** / **不训练**（喂上游内容进训练管线=禁），门 `solver-license:check`（§7）。

**逐单根因链节点可导航（前端下钻链·WO-ORDERCHAIN-DAG-DRILL·闭 G-death-interaction）**
```
affected_orders.problems[].rootChains[].layers[] --后端 typed ref(R6 确定·so/cat/base 派生)--> {
  order.ref{object,so}       --onNodeClick--> /o/Order/{so}（订单 360·R17 DrillBack 可回）
  judgement.ref{judge,so,judge:cap|kit|fin} --> order_fullchain 三关联判（关弹窗+设 OFC so+滚动高亮对应判）
  rootCause.ref{risk,cat,base} --> /v/risk?category={cat}&focus={base}（风险看板对应瓶颈类）
  remedy.ref{action,plan_change,so} --> adopt.mutate(plan_change)（行动审批·C10 留痕·R4 走草稿不直改）
}
order_fullchain.dag.nodes[] --前端按 kind+so 派生 ref--> { order/建模facet→订单360 · judge→三判高亮 · verdict→采纳工单 }
  ⚠ 曾断：LayeredDag 节点条件式交互，problem-dag/ofc-dag 未传 onNodeClick → 静态 <g> 空操作（死交互·已闭）
```

**工单中心聚合链（TICKET-CENTER-UNIFIED·G-9 邻域·2026-07-05）**：

```
{ growthWorklist:WorklistItem(DATA_GAP·含 B3 HARD dataRequest 描述单) ⊕ growthTickets:GrowthTicket(FEATURE/PLAN_SCAFFOLD/SOLVER_GAP·gtk_) }
  --统一 kind 标只读投影(R13 零造行·kind 开放扩展位)--> TicketBoardRow --GET /b/v1/growth/board--> /admin/tickets 工单中心
  --Tab 全部|待认领|我的在办(认领后默认落此)|已完成 · 点行--> TicketDetail(GET /b/v1/growth/tickets/:id/detail)
      通用段{fromQuestion/gapCode/kind/状态时间线/认领人} + 补充内容清单段{
        DATA_GAP→fillPlan(typeKey/字段/行数/seed R6)+requires(fromQuestion 携 solver: entryRef 时经 checkReadiness manifest 实测 present-vs-needed)+B2 结论
        DATA_REQUEST→dataRequest(columns/entities/descriptionSchema 字段清单/人工描述)+B3 结论+去导入正门 /connections
        SOLVER_GAP|FEATURE→ioContract.inputs/outputShape+ontologyRefs+acceptance · PLAN_SCAFFOLD→scaffoldedDrafts 步序+去审批 /admin/actions }
  --行内操作 kind-first 分流--> { source=WORKLIST(claimable)→既有 claim/release/fill 闸(R4/R6 零改) | source=GROWTH_TICKET→只读/深链(误认领 409 WORKLIST_ITEM_READONLY 不绕) }
  ⚠ 接缝语义：聚合面是**投影不是新真值仓**——生命周期仍归各真源(worklist 闸/工单流程)；/admin/growth 驾驶舱保留为诊断运行视图(操作列保留+跳转)
```

**QUERY30 多跳对象图边（QUERY30-ONTOLOGY-EXT · §2.K 类型的连边 · `batteryLinkTypes()` + 物化 `synthetic/service.ts`）**
30 问多跳链缺失接缝的 6 条新边，由对象 FK 确定性派生（同 seed 字节一致 R6），`/a/v1/objects/:id/neighbors` 可解引用真跳：
```
Order --order_allocated_on(N:N)--> Line          （占线明细·挤占锚·Q01/Q03 · allocatedLineIds 派生）
Order --order_displaces(N:N)--> Order             （加单挤占同基地低优先级订单·Q01/Q03 · demandDelta>0.5 派生）
Material --material_supplied_by(N:N)--> Supplier   （断供半径/集中度锚·Q04 · 一料一主供应商）
MaterialBatch --batch_reserved_for(N:N)--> Order   （呆滞批次↔订单绑定·Q05）
Model --model_bom_line(1:N)--> BomLine --bomline_material(N:N)--> Material  （BOM 两跳传导桥·Q11/Q28）
DataSourceHealth --datasource_feeds_type(N:N)--> ObjectType  （源→类型血缘·降级下游定位·Q30 · 实例边 toId=该源所喂类型代表对象·真跳；schema 级 n-ObjectType 元节点见 /a/v1/ontology/graph）
```

---
