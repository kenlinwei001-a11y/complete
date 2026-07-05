# 本体切片 §10 · 系统自我域 · 域内切片 · 跨域节点

<!-- 自动生成·勿手改 -->
> ⚠ **本文件由 `scripts/build-ontology-slices.mjs` 从母体 `docs/SYSTEM-ONTOLOGY.md §10` 派生**（本体克隆切片·层 2）。
> **改接线改母体 §10，再跑 `node scripts/build-ontology-slices.mjs` 同步**（勿直接改本文·门 `ontology-slices:check` 守漂移）。母体 hash `500284d3da08690f`。

---

## 10. 系统自我域 · 域内切片 · 跨域节点

### 10.1 两级域辨析（别混）

- **业务本体域**（`graphmeta.ts` GRAPH_DOMAIN + **A3.1 `BUSINESS_DOMAINS` 14 域参考注册表**）：14 业务域 = factory/product/process/equip/people/quality/capacity/forecast/**sales/material/finance**/plan/**external/decision**（配置驱动 R14，可被行业模板覆盖；参考原型 16 域去 solver/agent 计算元域）——给业务对象分组、A4 浏览器分组、切片规划器 tie-break（域内边优先）、跨域接缝识别共用。`GET /a/v1/business-domains`。**这不是本节对象（本节是系统自我域）。** A3.1 余：参考本体基线（元租户 95 节点）数据量大，待后续分期。
- **系统自我域**（本节）：平台**机器本身**的功能域——比业务域高一个抽象层，描述"系统由哪些功能簇构成、簇间怎么接线"。本节正式化 §2 的 A–H 分组为"域 + 域内切片 + 跨域节点"。

### 10.2 系统自我域清单（11 域）

| 域 | 范畴 | 主要对象类型（§2） |
|---|---|---|
| **D1 接入域 Ingest** | 数据/故事进系统 | Connector(含 EXTERNAL/mock_external)·RawDataset·**ExternalSignal(外部域 EXT_SIG)**·IndustryTemplate·SyntheticJob·BuildPlan/Job·DataBuilderAgent·ClosureReport·QuarantineRow |
| **D2 本体域 Ontology** | 类型/对象/派生/切片 | OntologyType/Link/Version/Draft·ObjectInstance·Link·PropertyDef·DerivationSpec/Run·SliceSpec·ObjectPropHistory |
| **D3 规则域 Rules** | 约束/规则 | Rule·RuleDoc·RuleCandidate·ExtractSegment·ruledsl |
| **D4 推演域 Solving** | 求解/校准/仿真 | Solver(SOLVER_KEYS)·SolverParam·Calibration*·ForecastSnapshot·RiskCase·SopVersion·generic-inference(TO-BE) |
| **D5 行动域 Action** | 真值写回 | ActionType·ActionDraft·approval·domainExecutor(Phase9B) |
| **D6 权限域 Access** | 隔离/鉴权/门控 | Tenant·User·IAM·Policy(A6)·Feature/Entitlement |
| **D7 编排域 Orchestration** | 问句→答案 | QOS·Intent·ExecutionPlan/Workflow·Skill·Agent·MCP·Task·classify/route/SSE |
| **D8 场景域 Scenario** | 场景/入口/视图 | ScenarioPackage·ScenarioCard·SceneEntry·View·presetContext（**接地化**：`groundScenario` 对租户真数据+sim-clock resolve·死对象→真实例·相对时间→具体值·needsData 待补区）·launcher·空结果→认领补数据(复用 GROWTH-WORKLIST) |
| **D9 信息流域 Flow** | 事件/失效/通知 | OutboxEvent·EventSubscription(§4)·Notification·B→A缓存失效·D-29 |
| **D10 运营时序域 Ops** | 时序/时钟/回放 | TsAggSpec/Run·SimulationClock·LivedInState·OpsSchedule·Replay。时序剧本 `tsGenerators`（battery）：oee:equip · yield:process · output:line · **attainment:line（产线日·真派生+逐设备勾稽 R13——非 flat seed/非镜像分布，由 `generateHistory.writeAttainmentRollup` 沿 Line→Process→Equipment 拓扑用该线**真实** oee:equip/yield:process rollup 算出：`达成率 = 设备效率达成(产线OEE/计划OEE) × 良率达成(产线良率/计划良率)`，产线OEE=Σ(oee:equip×产量)/Σ产量·产线良率=avg(yield:process)；计划基准 oeePlan/yieldPlan 从 `planBaseline` 注入 R14；周末/检修 OEE 经 oee:equip 的 weekend/maint_dip 自然传导（不重复相乘）；逐日持久化分量 `oeeAttain/yieldAttain/lineOee/lineYield/eventFlag`（measureFields）→ `agg-query` `measureField` 选择器可逐日拆因；周聚合回写 `Line.schedule_attainment`，驱动驾驶舱"计划达成率"KPI ≈ 90%，可点穿**四级下钻**（A2/A3）：逐日拆因 → **全线达成率排行（可点选任一线）** → 逐台 oee:equip/yield:process（定位停机/低效设备）→ **单设备 OEE 趋势（时间轴）**。**rollup 核心已抽 `rollupLineAttainment`/`attainEventFlag` 纯函数（`tsgen.ts` 单一来源 R6）：历史 `writeAttainmentRollup` + **前向 tick `simclock`** + **回放 `livedin`(engine/bundle)** 三处共用同口径（A1 消除"历史真 rollup、前向却镜像"裂缝，并修 livedin 因 attainment:line.base.mean=0 出 0.4 的潜伏 bug）** · util:line · **attainment:base（CL.5 基地级日达成率序，day grain，达成率=实际/目标 接 Metric achievement 口径，供"逐日时间维度归因"；末位追加保前序列 R6 字节一致）** |
| **D11 治理元域 Meta** | 管理其余 10 域 | 系统本体·PRD库·ontology:check·闭包/全链闭包门·CLAUDE.md/钩子/skill |

> D11 是"管理其它域"的元域——协同进化机制（§9 + 运行模型）就活在这里。

### 10.3 域内本体切片（= 可追溯子图，复用 SliceSpec 形态 root→hops）

命名 `sys.<域>.<形状>`；这些切片**就是各域的关键链路**，也是全链闭包门要逐条验证"端到端通"的对象。

| 切片键 | 域 | root → hops（子图） |
|---|---|---|
| `sys.ingest.data_to_object` | D1→D2 | Connector→RawDataset→ObjectType→ObjectInstance→Derivation |
| `sys.ingest.build_closure` | D1 | StoryScript→BuildPlan→ClosureReport→{ObjectType,Rule,Solver需求} |
| `sys.ontology.type_lineage` | D2 | ObjectType→PropertyDef→DerivationSpec→SliceSpec |
| `sys.rules.scope_binding` | D3 | Rule→ObjectType(scope) + Rule→agent/workflow.ruleBindings |
| `sys.solving.invoke` | D4 | Solver→ObjectType(读)→SolverParam（同输入同输出）。**入口输入契约段（DATADEP-MANIFEST-READINESS·脊）**：每 Solver 声明 `DataDependency` 清单（`SOLVER_DATADEP`·抽象角色·经 SolverBinding 解析真类型）= 输入侧覆盖门（与 `SOLVER_OUTPUT_SHAPES` 输出契约对偶）；`loadContext` **读清单并集**加载 ObjectType（迭代 `CONTEXT_ROLES ∩ ⋃(清单角色)`·治本杀写死 22 类·R6 字节一致）；invoke 前经 `checkReadiness` present-vs-needed 就绪探测（precondition-first·`POST /a/v1/solvers/:key/readiness`），未就绪产诚实 gap 喂 GROWTH-WORKLIST（不静默 run-first）。 |
| `sys.solving.calibration` | D4 | Calibration→SolverParam(版本化)→重放 |
| `sys.action.writeback` | D5 | ActionType→ActionDraft→approval→ObjectInstance(props)→Derivation(二次) |
| `sys.access.row_filter` | D6 | User→Role→Policy(A6)→ObjectInstance(过滤) |
| `sys.access.entitlement` | D6 | Feature→{endpoint,view,solver}(门控,先于authz) |
| **`sys.orch.query_to_answer`** | **D7** | **Client(Web对话坞/CLI/外部 A2A agent)→Query→Intent→Plan→Step*→{Solver\|Slice\|Rule}→AnswerBlock→SSE（中枢链=审核全链）**。**WO-A 对外进入表面**：外部 agent 经 `POST /b/v1/a2a/tasks`（task≈QueryTask·投影层 mcp-server/routes.ts）映射到既有 `orchestrator.submitQuery`（/api/v1/queries）进入本链——零新执行逻辑·同 OBO/entitlement/R2 门·查询回 `GET /b/v1/a2a/tasks/:id`（映射 queries/:taskId）。CL.7 缺口块：`AnswerBlock` 增 `gap` 类型（含 GapReport）——答案命中缺口时对话坞渲染 `<GapCard>`（缺口码 + 人话 + 按码「▶触发生成缺失数据」复用 growth/run LOOP + CONVERGED 后「继续推演」重跑原问句 + 需开发码诚实"不可达:断在<码>"+工单深链），闭 G-3 对话侧（GF.1 前端+契约 · GF.2 orchestrator 路径 B agent 失败时 `failTask` 并入 gap 块[answer.final 先于 task.failed]→对话坞出可点缺口卡而非红错，均已落；SSE 进度回灌深度/就地 R4 审批=GF.3 续）。CL.6 归因补丁：「未达成原因/达成率归因」问句 → path-B agent discover{solvers} 命中 `plan_audit` → `invoke_solver(plan_audit)` 入参三级兜底（`plan_version_id ?? currentPlanVersion ?? deriveBaseline(PlanTarget/场景包)`，`/a/v1/solvers/plan_audit/invoke` 自动补，sop.ts:419）→ X01–X05 诊断（配 attainment:base 日序做逐日时间维度归因），不再因"无版本"放弃。**inference-process 横切（已落）**：`<InferenceProcessDag>`（前端组件）把本链真实轨迹（routing.path/step 事件/answer/gap）投影为 HTML 同构的 10 节点非线性编排 DAG——边语义 `par(并行②∥③)/conv(汇聚→④)/seq/aux(历史校正旁路)/fb(执行回采⑩跨周期反馈回②④)`，点节点看逐节点 IPO（输入/过程/输出），缺口节点红（取答案 gap 块/失败态，守"绿测试≠能用"，无运行标"未跑"）；拓扑=编排定义结构 config（R14），状态由真实任务流派生（R13）；挂 QueryDock 答案块"推演过程"折叠（可复用嵌 risk/project/order/audit/generate）。SSE→DAG 节点状态映射纯渲染投影，不新增真值。**缺口处置总表（三出口·2026-07-03 FDE 真浏览器实证 dock-q-{vague,preset,novel}.png）**：命中缺口时**只走三种诚实出口、绝不编答案**——出口①确定性澄清 `AWAITING_CLARIFICATION`（Clarification UI「第 n/2 次确认·请提供 <槽>」+对象搜索框·实证「常州基地影响哪些订单？」）；出口②可安全补（EMPTY_DATA/NO_PLAN/NO_SLICE/OTHER=triggerable）→ `<GapCard>`「▶触发生成缺失数据」→growth LOOP→CONVERGED→「继续推演」（实证 novel 良率问句 gap 卡 OTHER）；出口③不可安全补（NO_RULE/SOLVER_NOT_FOUND/NO_CAPABILITY/SHAPE_MISMATCH=非 triggerable）→诚实「不可达:断在<码>」+工单深链 /admin/growth——判据=**数据可确定性合成（安全）可即时补；算法/规则逻辑不可凭空造（作假）诚实转工单**。**边界闸（✅ 已落·WO FILL-BOUNDARY-GUARDRAIL·用户钉「触发补须有边界防数据混乱」）**：FDE 坐实泛问题（「本月库存水位是否可以降低？」无月份/型号/仓类/物料）此前**未先澄清即出触发按钮**（仅词表 HARD/SOFT 一道闸）→ 现补三道内容闸（`agentcore/growth/data-boundary.ts decideTriggerBoundary` 确定性纯函数 R6·`POST /b/v1/growth/run` 带边界 gate·`contracts/boundary.ts TriggerBoundaryDecision`）：**B1 槽位完备闸**——触发按钮不再直接跑，先经后端判定；未接地（无对象域/实体/时间窗定位维度·维度枚举全取 BASE/SEG_REGISTRY R14）→ `CLARIFY` 复用 `<Clarification>` SLOT_FILLING「第 n/2 次确认」先澄清；槽位齐 → `PREVIEW` 出**生成计划预览**（将建类型/行数/值域来源/有界枚举取值·恒 PROVISIONAL/SYNTHETIC）人确认（confirmed=true）才跑；**B2 模式封闭闸**——只在已发布 ObjectType schema（listObjectTypes）+ 注册表值域内生成·枚举有界字段只取注册表既有值·显式目标类型 ∉ 已发布 schema → 拒；**B3 越界闸**——词表外新实体/新类型 → `HARD_BLOCK` 拒自动合成（confirmed 也不放行）+ 出 `DataRequest`（扩 `newEntity/descriptionRequired/descriptionSchema/description`）要求人工输入数据描述 → R4 审批物化值域模板才放行·人填描述后登记 HARD 在办项（importData 深链 /connections·可追溯）。与 GROWTH-WORKLIST 过程闸（认领）正交组合，产出恒 PROVISIONAL/origin=SYNTHETIC。**驾驶舱 LOOP（admin 显式运行）confirmed=true 跳过内容闸（SOFT/空租户仍登记在办看板人工闸）；对话坞 GapCard（终端用户）走完整 CLARIFY→PREVIEW→confirm 流**。teeth：`agentcore/test/boundary-guardrail.test.ts`（泛问题→CLARIFY 不合成不落账本·revert B1→直接跑即红·枚举越界→HARD_BLOCK·新实体→DataRequest+R4·纯函数确定性）。**兜底终段重接（AGENT-UNIVERSAL-FALLBACK）**：…→classify→{路径A | scene agent | **agt_universal（全域探索智能体·全工具面 BUILTIN+workflow+MCP·scope 全域·数字只引工具真值）**}→AnswerBlock——「命不中预设」从弱白名单升级为一等可配置全工具面 agent（D1/D2/D3 收口·G-3 兜底侧）；护栏（sim 暗发 R3·写仅 create_action_draft R4·FILL-BOUNDARY 三闸·限额·OBO/审计）随行；无 LLM 诚实降级不变 |
| `sys.scenario.launch` | D8 | ScenarioCard→View + →Intent + →presetContext→Query。**接地校验节点（LAUNCHER-GROUNDED-QUESTIONS）**：下发/启动前 presetContext 经 `groundScenario`(scenario-grounding.ts) 对租户真数据 resolve（死对象→真实例·相对时间→sim-clock 具体值·补必填槽·具象问句·零实例→needsData 待补区），派生计划 invoke_solver 死入参覆写为接地真值；空结果→`appendDataGapBlock`→答案坞 GapCard「认领并补数据」→ WorklistItem（复用 GROWTH-WORKLIST·human-gated·接 `sys.meta.change_loop`）→ 补数据页 → 继续推演。 |
| `sys.flow.event_to_refresh` | D9 | OutboxEvent→EventSubscription→ConsumerView（=§4 全表） |
| `sys.ops.tick` | D10 | SimulationClock→tick→{ObjectInstance,TS}→Derivation→dashboard |
| **`sys.meta.change_loop`** | **D11** | **Requirement(PRD)→Ontology(影响分析)→Code→回写→门禁→Release（=协同进化闭环）** |

**图谱统一接入进展（WO-GRAPH-2/3/4·见 §2.B「统一本体图谱引擎」）**：以上"可追溯子图/血缘/影响"类**类型A 图**前端已渐进收敛到单一引擎 `OntologyGraphEngine`（薄封装 `SubgraphPanel`）——切片子图（`sys.ontology.type_lineage` 形态·SlicesPage 试切）、实例血缘（Object360 邻接 ego 图）、元本体影响（`sys.meta.change_loop` 的"改 X 影响什么"·MetaPage）、边界影响（DF.7 `BOUNDARY_IMPACT`·BoundaryPage）四处**同引擎换数据源、数据各自真实、下钻统一 DagNodeDrawer**。**类型B 过程 DAG**（沙盘传导 PmDag / inference-process / 数据流 ETL DAG）走另一条线（WO-GRAPH-1 共享 DAG 组件），不并入力导引擎（分层/步态语义不可丢）；图查询 U12（PlatformConsole）后端未建，记后续。

### 10.4 跨域节点（接缝 = 断点高发区）

横跨多域的对象 = 系统的**接缝**。核心规律：**断点几乎全在跨域节点上**（"断点常在接缝"的形式化）。

| 跨域节点 | 桥接的域 | 关联断点 |
|---|---|---|
| **ObjectType / ObjectInstance** | D2↔D1↔D4↔D3↔D5↔D6（最横切） | 改动涟漪最广 |
| **Solver** | D4↔D7(invoke_solver)↔D2(读对象) | **G-2**（Solver↔Plan 输出形状） |
| **ExecutionPlan/Workflow** | D7↔D1(构建生成)↔D4(调solver) | **G-1**（Intent↔Plan 接线） |
| **Intent** | D7↔D8(场景) | **G-3/G-4** |
| **Rule** | D3↔D7(evaluate)↔D5(BLOCK)↔D4(约束) | — |
| **SliceSpec** | D2↔D7(resolve_slice)↔D6(逐跳过滤) | — |
| **OutboxEvent** | D9↔**所有域**→前端（信息流主干） | D-29 / DL1–DL12 |
| **ActionType/ActionDraft** | D5↔D2(物化)↔D7(create_draft) | R4 不变量 |
| **Policy(A6)** | D6↔D2/D4/D7（读出过滤横切） | — |
| **Feature(Entitlement)** | D6↔**所有域**（门控） | R3 |
| **Tenant** | D6↔**所有域**（隔离） | R2 |
| **BuildPlan/ClosureReport** | D1↔D2+D3+D4+(扩后)D7/D8 | **G-8**（闭包不跨到 D7/D8） |

### 10.5 与机制的联系（为什么这么切）

1. **跨域节点 = 全链闭包门(R11) 的守护焦点**：G-1/G-2/G-8 都坐在跨域节点上 → 闭包门重点验证这些接缝的"形状/接线/可运行"。
2. **跨域切片 = 闭包门的验证对象**：尤其 `sys.orch.query_to_answer`（中枢链）与 `sys.ingest.build_closure`（构建链）——全链闭包门就是"这两条切片必须端到端通"。
3. **域 = 影响分析的单位 + 权限/责任的边界**：一个需求先落到域 → 再沿域内切片定位 → 跨域节点提示涟漪范围。
4. **可落库 dogfooding**：这些切片用平台自己的 `SliceSpec`(root→hops) 形态写 → 未来把系统本体注册为平台对象后，可用平台的 `executeSlice` 真去"切系统自己"、用规则引擎校验系统不变量、用推演做"改这个节点影响哪些切片"的 what-if。**用平台分析平台自身的闭环在此落地。**
