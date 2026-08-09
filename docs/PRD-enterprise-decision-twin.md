# PRD · 企业经营决策数字孪生（Enterprise Decision Twin）

> 版本 v1.0 · 2026-08-09 · 状态：设计定稿待派工
> 上游需求原文：仓主 2026-08-09 两份补充需求（「端到端产销业务数字孪生流程」+「Enterprise Decision Twin」）
> 关联：`docs/PRD-platform-foundry-aip.md`（总纲，冲突以总纲为准）· `docs/PRD-sandbox-redesign.md` · `docs/SYSTEM-ONTOLOGY.md` §2.I 推演沙盘域

---

## 0. 一句话判断（本 PRD 的立足点）

**孪生对象不是 Workflow，而是 `Enterprise State + Process + Organization + Ontology + Decision + Action + Time`。**

推论——本次升级**不是**造一个流程图 Demo，而是让平台能回答这一句：

> 一个扰动进来之后，企业这个系统**如何被扰动、如何传播、如何决策、如何审批、如何执行，以及执行结果如何反过来改变企业状态**。

### 0.05 ⚠️ 定性：既有三种推演都是**局部推演**，决策沙盘是**全局推演**

仓主 2026-08-09 定性：「项目推演、全局推演、产能推演都是**局部推演**，决策沙盘推演是**全局推演**」。
这条**必须写在最前面**，因为它决定了本次升级是「再造一个推演」还是「造一个能指挥它们的层」。

**先说清一件反讽的事**：叫「全局推演」的那个（`global-sim`），按这条判据其实是**局部**的。
它的目标枚举 `GlobalSimObjectiveSchema`（`packages/contracts/src/global-sim.ts:86`）只有五个：
`max_ontime` / `min_delay` / `min_changeover` / `min_cost` / `min_fg_inventory` ——
**全部落在「订单 → 排产」这一层**。它确实覆盖整个订单簿（跨实例是全的），但它**不跨域**：
碰不到组织、碰不到批复、碰不到上游供应、更不改变企业状态。

#### 更精确的定性（仓主 2026-08-09 二次补充）：现有「全局推演」是**项目级别的全局推演**

实测坐实：`packages/contracts/src/global-sim.ts` 里 **`orderId` 是唯一的原子键**（8 处），
`GlobalSimDecisionItemSchema:46` 就是 `{orderId, model?, qty?}`，`priorityLocks` 也只到 `customer|segment`。
⇒ 它的**分析单元是订单/项目**，「全局」= **全部项目**，不是**全企业**。

所以本平台实际上有**四层推演**，必须分清楚，否则派单和 UI 都会串：

| 层 | 名称 | 分析单元 | 覆盖 | 改企业状态 |
|---|---|---|---|---|
| **L1 对象级** | 项目推演 `project-sim` | 单个项目/订单 | 一张单的全链 | ❌ |
| **L2 组合级** | 全局推演 `global-sim` | **订单簿（全部项目）** | 项目层变量（交付/排产/成本/库存） | ❌ |
| **L2′ 专业域级** | 产能推演 `capacity_*` | 基地/产线/工序 | 产能一个域，跨基地 | ❌ |
| **L3 企业级** | **决策沙盘推演** | **企业状态** | 跨域 + 组织 + 批复 + 时间 | ✅ |

L2 与 L2′ 是**并列**关系，不是包含关系：一个按「项目」横切，一个按「产能」纵切，
两者都在 L1 之上、L3 之下。**L3 才是唯一会让企业变成另一个样子的那一层。**

#### 🔴 由此产生的一条硬命名约束（不钉死必出事）

「全局」这个词**已经被 L2 占用**。如果 L3 也叫「全局推演」，就是本仓反复踩的**同名不同物**——
而且这次会踩在最贵的地方：dev 拿着「全局推演」四个字，可能去改 `global-sim`（L2 的订单簿优化器），
而需求说的是 L3 的企业孪生。两者在代码里毫无关系。

**裁定（写进本 PRD，dev 与 UI 一律照此）：**
- **代码标识符 `global-sim` / `GlobalSim*` 一律不得被 L3 复用。** L3 用 `twin` / `enterpriseState` / `stateDelta`。
- **L2 的既有 UI 文案「全局推演」暂不改名** —— 改一个已上线功能的名字会连带动路由键、视图注册、
  golden 计数与一批测试，属于产品决策，**不是 dev 决策**，需仓主另行拍板。
- **L3 对外叫「决策沙盘推演 / 企业经营决策数字孪生」，不叫「全局推演」。**
- 若将来仓主决定给 L2 改名以消歧，建议改成「**项目组合推演**」（准确描述其分析单元），
  但那是独立一单，不塞进本次升级。

#### 「局部 / 全局」的分界不是对象数量，是这三条

| 判据 | 局部推演 | 全局推演 |
|---|---|---|
| **① 跨几个业务域** | 1 个（交付/产能/成本 三选一） | 多个，且必须包含**组织与批复** |
| **② 怎么算** | 一次求解器调用（输入→输出） | 沿**依赖图逐跳传播**，跨域扩散 |
| **③ 算完之后** | 纯只读投影，不改企业状态 | 产出 `StateDelta` → 经批复 → **改变企业状态** |

**按对象数量分是错的**：全局推演一次算几百张订单，对象数远多于决策沙盘的一次单点扰动；
但它算完企业还是原来那个企业。**决定性的是③** —— 局部推演回答「这一层现在怎么样」，
全局推演回答「**企业这个系统被扰动之后会变成什么样**」。

#### 因此：三种局部推演**不是要被替代，而是要被调用**

决策沙盘的运行序列里，那 10 步中有好几步**本身就是既有的局部推演**：

```
① 构建本体切片        ← slice-planner（已有）
② 分叉仿真世界        ← SimCheckpoint /branch（已有）
③ 传播扰动事件        ← propagateTick（已有，但每 tick 全量扫，见 §2.1）
④ 重算受影响流程      ← 本次新建（ProcessInstance）
⑤ 评估约束            ← RuleEntry + SolverContext.rules（已有）
⑥ 运行排产求解器      ← 就是「全局推演」global-sim ★ 局部推演在此被调用
⑦ 重算产能            ← 就是「产能推演」capacity_forecast ★
⑧ 重算财务            ← finance_pnl / quote_margin（已有）
⑨ 重估批复要求        ← 本次新建（ApprovalPolicyEngine）
⑩ 构建决策图          ← 本次新建（Decision Graph）
```

**局部推演 = 引擎；全局推演 = 指挥。** 这是本次升级的架构定位：
不重写 ⑥⑦⑧，而是补 ④⑨⑩，再把 ①②③ 的两栈缝合（§2.1）。
**任何要求「重做一遍排产/产能推演」的 WO 都是走错方向，直接退。**

#### 由此产生的一条硬约束（会影响 WO 边界）

局部推演今天各自**直接从真本体读数**。要被全局推演调用，它们必须能**在指定世界里跑**——
即入参要能接收「世界态快照」而不是永远读真库。这不是把它们重写，而是给它们**加一个数据源开关**。
这条落在 E5，**不在 D 层七单的范围内**，D 层的 dev 不要碰。

---

### 0.1 与既有结论的关系（必须先说清，否则会走错方向）

- 本 PRD **推翻**了 2026-08-09 早些时候「后端无需变、只改前端」的那条边界。那条边界当时成立，是因为需求只到「把后端已有字段展示完整」。本次需求要求的是**新增企业级状态与批复语义**，后端必须动。这是需求升级，不是返工。
- 本 PRD **不推翻**推演沙盘域（§2.I）的既有设计。恰恰相反：**仿真世界的骨架已经建成**，本次是接线与补面，不是重造。下面 §2 给实测证据。

---

## 1. 《本体引用与影响》（铁律 0 强制章节）

**触及的对象类型**
- 既有：`SimSession` / `SimTickState` / `SimCheckpoint` / `PropagationRule` / `SimCertification` / `ChainImpediment`（§2.I）· `Solver` / `SolverContext` / `SolverParam`（§2.E）· `RuleEntry`（§2.C）· `Action`（§2.D）· `ObjectType` / `LinkType` / `ObjectInstance`（§2.B）· `Skill` / `Workflow` / `Agent`（§2.H）· `SimClock`（§2.F）
- 新增：`EnterpriseState`（企业级常驻状态）· `StateDelta`（状态增量，一等对象）· `ProcessDefinition` / `ProcessInstance` / `ProcessTask`（流程世界）· `ApprovalPolicy` / `ApprovalInstance` / `ApprovalTask`（批复世界）· `OntologySlice`（本体切片一等实体）· `DecisionOption` / `DecisionEvidence` / `CausalEdge`（决策世界补面）· `Person` / `OrgRole` / `AuthorityLimit` / `Delegation`（组织世界）

**触及的链路**（§3）
- 既有并复用：`扰动 → propagateTick → SimTickState → 阻滞点判定 → 候选枚举`
- 新增：`扰动 → StateDelta → 受影响对象闭包 → 受影响流程实例 → 触发的批复策略 → 批复链实例化 → 决策 → 行动 → EnterpriseState'`
- 新增：`Decision Intent → Slice Expansion → OntologySlice → SolverContext 裁剪`

**触及的事件**（§4，命名须与 QOS PRD §8.2 同风格）
- 新增：`enterprise_state.snapshotted` · `state_delta.computed` · `process_instance.started` / `.advanced` / `.blocked` / `.completed` · `approval_instance.raised` / `.approved` / `.rejected` / `.timeout` · `ontology_slice.expanded` · `decision.recorded` · `world.forked`
- **每个新事件必须有下游订阅方**（D-29），否则按 `G-EVENT-*` 家族记为断点，不得声称已接线。

**触及的不变量**（§5）
- **R1 tenant_id everywhere**：五张新表全部带 `tenant_id`，跨租户 403/404。
- **R4 真值经 Action**：`EnterpriseState` 的**真实世界**写入必须经 Action 审批；**仿真世界**（fork 出来的）写入不经 Action，但必须物理隔离、不得回写真实世界。这是本 PRD 最重要的一条不变量，见 §4.1。
- **R6 确定性**：同 `(baseStateId, changeSet, ruleSetVersion)` 重跑，`StateDelta` 字节级一致。
- **R11 全链闭包**：`OntologySlice` 展开结果必须闭包（引用到的对象类型/关系/规则/求解器全部存在），否则发布即失败——复用已有 `probeMissingRefs`（`apps/datacore/src/resources.ts:11`）。
- **R14 行业无关**：批复策略、传导规则、切片展开策略一律**配置驱动、零业务常数**；锂电只是第一个模板。

**关闭或影响的断点**（§8）
- 直接关闭：`G-SIM-SCOPE-UNREAD`（欠账 #130，`SimSession.scope` 有写端无读端 → 本 PRD 的 Slice Expansion 就是它的读端）· `G-ACTION-NOOP-EXEC` 最后 1 条（欠账 #71/#81，「采纳经营方案」缺语义正确的已接线动作类型 → 本 PRD 的 `Decision → Action` 给它落点）
- 新增登记：`G-TWIN-STATE-NO-CARRIER`（企业级状态无常驻承载体）· `G-APPROVAL-STATIC-CHAIN`（批复链写死而非规则+权限动态生成）· `G-SLICE-NOT-AN-ENTITY`（切片是计划不是实体）
- 必须避免复发：`G-EVENT-GATE-MEASURES-SUBS-NOT-EMITS`（新事件既要 emit 也要有订阅方，且门要能同时量到两端）

---

## 2. 七个世界 → 平台实测落点（不是规划，是今天 grep 得到的事实）

> 判据用本仓强制五分法：`未实现` / `只有test引用` / `没接线` / `接了线没数据` / `已实装`。
> 金丝雀：`grep -rn "CHAIN_NODE_REGISTRY" packages/contracts/src` = 7 命中（工具正常，否定结论才可信）。

| # | 世界 | 需求原文的概念 | 平台今天的承载体 | 形态 | 证据 |
|---|---|---|---|---|---|
| ⑥ | Scenario / Simulation | SimulationWorld | `SimSession`（状态机 DRAFT→READY→RUNNING→PAUSED→ENDED） | 已实装 | 生产调用方 41 |
| ⑥ | Scenario / Simulation | StateSnapshot | `SimTickState.state`（对象→状态变量值）+ `SimSession.base_snapshot` tick0 | 已实装 | 生产调用方 15 |
| ⑥ | Scenario / Simulation | **World Fork** | `SimCheckpoint` + `SimSession.parent_checkpoint_id`（branch = 以 cp 处 tick 态开新 session） | 已实装 | 生产调用方 22 |
| ⑥ | Scenario / Simulation | **Dependency Graph** | `PropagationRule`(`sourceTypeKey/sourceStateVar/viaLinkKey/targetTypeKey/targetStateVar` + `coefficient/delayTicks/combine/decay/clamp`) | 已实装 | 生产调用方 46 |
| ⑥ | Scenario / Simulation | Delta Simulation | `propagateTick` 合体算法 | 已实装 | 生产调用方 12 |
| ⑤ | Decision | Rule / Constraint | `RuleEntry` + `SolverContext.rules` + `ruleSetVersion` 指纹 | 已实装 | §2.E G-10 P2/P4 |
| ⑤ | Decision | Solver | `SOLVER_KEYS` 38 个（含 `risk_timeline`/`affected_orders`/`mitigation_select`/`capacity_forecast`…） | 已实装 | `solvers/service.ts:14` |
| ⑤ | Decision | Decision | `027_decisions.sql` | 待复核字段够不够 | 迁移存在 |
| ③ | Ontology | Object/Relation/Event/State | A4 本体/对象域 | 已实装 | §2.B |
| ⑦ | Execution | Action + 审批 | S2 Action 审批（R4 真值经 Action） | 已实装 | §2.D |
| — | Time | 模拟时钟 | `SimClock`（**单租户全局时钟，非多会话**） | 已实装但语义不足 | §2.I 原文自述 |

### 2.1 ⚠️ 最重要的一条实测发现：**平台里有两套彼此不通的仿真栈**

上表把「世界隔离」和「增量传播」并列成「已实装」，这句话**对，但会误导**。逐行追调用之后的真相是：

| | **栈 A · 沙盘传导** | **栈 B · 本体增量重算** |
|---|---|---|
| 入口 | `apps/datacore/src/sim/propagation.ts:221 propagateTick` | `apps/datacore/src/ontology-core.ts:341 recompute()` |
| 世界 | ✅ **真独立世界**：`SimSession.baseSnapshot` + `sim_tick_state` 逐 tick 落库；`/act` 明确「模拟态，不写真值（R4）」（`app.ts:1484`） | ❌ **就地算**：`ontology-core.ts:365` dryRun 时深拷贝全图，非 dryRun **直接 mutate 真对象并 `repos.objects.put`**（:499） |
| 分叉 | ✅ `app.ts:1506 POST /sim/sessions/:id/branch` | ❌ 无 |
| 传播算法 | ❌ **每 tick 全量扫**：`:228` 深拷贝整个世界态 → `:272` 遍历全部规则 → `:302` 每条规则遍历该类型全部对象（唯一剪枝是值为 0 才跳） | ✅ **真增量**：`:383` 脏集播种 → `:400 resolveAffectedTargets` 反向链路导航 → `:355 topoSort` 拓扑序 → `:509` 派生值没变就不往下传 |
| 增量语义 | 只是**时间增量**（t→t+1 累加贡献），不是变更驱动 | 正是**变更驱动的依赖传播** |

**结论一句话：想要的 `impact-analysis` = 栈 B 的传播算法 × 栈 A 的世界隔离。两边各有一半，缝在中间。**

最接近的现成品是 `POST /a/v1/inference/whatif`（`app.ts:2943`），它的缺口精确到字段：
- 入参 `apply[{objectType,objectId,prop,value}]` —— **没有 `world_id`**（直接在真本体的克隆上算），**没有 `old_value`**；
- 出参 `{deltas, affectedObjects}` —— `affectedObjects` 是**一个数字**（`ontology-core.ts:536` 的 `affected.size`），**没有 processes / decisions / kpis 的分项计数**。

这决定了 E5 不是「造一个新引擎」，而是**把栈 B 的传播跑在栈 A 的世界里**，再把计数按四类分项。这是本次升级技术含量最高、也最容易被低估的一单。

### 2.2 其余实测缺口（逐条有 file:line）

- **`StateDelta` 已存在但异名且站错了栈**：`ontology-core.ts:57,497` 的 `dryRunDeltas{objId,type,prop,before,after}` 就是语义增量——但它只在栈 B，而栈 A 每 tick 存的是**全量 state，没有 delta 行**。
- **`Decision` 表够记「选项/因果/结果」，不够记「证据」和「决策之间的关系」**：`027_decisions.sql` 只有 5 列零业务列，真结构在 `doc` jsonb（`decision-kernel.ts:99-118`）。`rootRef`/`optionsRef`/`chosenOptionIds`/`trace`/`outcome` 齐全，但**没有 `parentDecisionId` / `supersedes` / `conflictsWith` 任何一个** ⇒ **Decision Graph 无处安放**；也没有独立 evidence 数组，证据只能靠下钻三元组间接指。
- **Causal Graph 反而是全链贯通的**（这条超出预期）：`CausalFactor` + `caused_by` N:N 真物化（`battery.ts:2380`）→ `gap_attribution` BFS 真遍历产 `causalEdges`（`solvers/service.ts:1780-1790`）→ `Decision.trace` 四步溯源 → `DecisionOutcome`（实测 vs 预言）。**因果链不用重造，要造的是决策与决策之间的边。**
- **批复链是**写死的**，精确到一行**：`apps/datacore/src/actions.ts:562` `const chain = type?.approvalChain ?? [{ role: "admin" }]`。契约 `actions.ts:145` 里 `approvalChain` 只有 `role`，**没有条件、没有金额、没有组织维度**；种子 10 条全是字面量（`battery.ts:2696` 起）。唯一的动态成分是「角色→人」的解析（`actions.ts:576-590`），**链的形状在此之前已经定死**。
- **`ApprovalLimit` 是「接了线没数据」且还接错了地方**：`replay-ops.ts:127 maxAmount` 只管**自动批白名单**（`opsteam/schedule.ts:194`），**不参与选链**；且唯一写入方是 tenant_admin REST，合成种子零写入 ⇒ demo 租户恒为 null。
- **审批超时同病**：handler 完整、真接 S3 调度器（`opsteam/schedule.ts:145-167`），但配置源零种子 ⇒ **生产路径永不触发**。
- **审批被拒 = 终态，无重提路径**：`actions.ts:737` 置 `REJECTED` 后无任何 → DRAFT 转移，`submit` 硬门 `actions.ts:530` 拦死。现实里「驳回→改方案→重报」这条最常见的路，今天走不通。
- **五种 WAITING 一个都没有**：全仓 `\bWAITING_(USER|APPROVAL|DATA|EXTERNAL_SYSTEM|SCHEDULE)\b` = 0；粗扫到的 49 处 `WAITING_` 全是 `AWAITING_CLARIFICATION` 的子串误命中。最近的近亲是 `PENDING_APPROVAL`，而它**挂在 ActionDraft 上，不在任何流程/任务状态机上**。
- **流程节点没有 Owner**：`BuildWorkflowStepSchema` / `FdeNodeSchema` / `ChainStepSchema` 三处 schema **全无** owner/actor/assignee 字段 ⇒ 「卡在谁那里」今天在数据层就答不出。
- **B2 Workflow executor 确认是同名不同物**：`executor.ts:104` 一条 for 循环，无 `Promise.all`、无调度队列；契约 `qos.ts:109-179` 的 `PlanStepSchema` **没有** `condition/when/dependsOn/next/parallel/branch/join`；校验器 `validate.ts:80-86` 强制 `steps[i]` 只能引用 `j<i`，DAG 被压成链；上限 12 步。它是 QOS 查询编排的线性执行器，**不是业务流程引擎**。
- **传导规则只有 3 条 demo 种子**（`seed.ts:198-256`），且 `cadenceNodeId` 全为 null（种子注释自述是「诚实缺席」）。除 demo 种子外全仓无任何自动派生——`databuilder/comprehend.ts:228` 明确写「绝不派生 propagation_rule/state_var（防双写）」。**依赖图的边今天只有 3 条，这是 E5 最现实的瓶颈。**

**以上是「已经有的」。下面是「真的没有的」——本次升级的全部工作量集中在这里。**

| # | 世界 | 缺的东西 | 为什么不能用现成的顶替 |
|---|---|---|---|
| ① | Business | `EnterpriseState`（企业级常驻状态） | `SimSession.base_snapshot` 是**会话内**的：一次推演结束，世界态随会话消失。企业「现在是什么状态」没有常驻承载体，因此「执行结果反过来改变企业状态」这一句今天**无处落笔** |
| ⑥ | Scenario | `StateDelta`（一等对象） | `SimTickState.trace` 记的是**传导轨迹**（哪条规则烧了哪条边），不是**语义增量**（哪个业务对象的哪个属性从 X 变成 Y、因为哪个决策）。两者不同：前者面向算法调试，后者面向「这个决定让企业发生了什么变化」 |
| ④ | Process | `ProcessInstance` / `ProcessTask` | B2 Workflow 是**编排执行器**（跑 Agent/Solver 的步骤），不是**业务流程实例**（订单评审走到哪一步、卡在谁那里、等了多久）。同名不同物 |
| — | Approval | `ApprovalPolicy` 动态生成批复链 | S2 Action 审批是**单点审批**（一个动作要不要批），不是**条件驱动的多级批复链**（`capacity_gap>10% → 计划总监+制造总监+总经理`） |
| ② | Organization | `Person`/`OrgRole`/`AuthorityLimit`/`Delegation` | 平台有 RBAC 角色（用于鉴权），没有**审批权限模型**（谁能批多大金额、超限如何升级、休假如何委托）。鉴权角色 ≠ 审批权限 |
| ③ | Ontology | ~~`OntologySlice` 一等实体~~ **← 此条我判错了，已撤销，见 §2.3** | — |
| ⑤ | Decision | `DecisionOption`/`DecisionEvidence`/`CausalEdge` | 决策表可能只记了结论，没记**为什么**（候选方案、证据、因果链）。管理层要的正是这个 |

---

### 2.3 我在本 PRD v0 稿里判错的一条，与由此挖出的一个真 bug

**撤销的判断**：我原写「`OntologySlice` 不是一等实体，算完即弃」。**这是错的。** 逐层复核后：

| 层 | 证据 |
|---|---|
| 表 | `apps/datacore/migrations/008_ontology_core.sql:43` `slice_specs` + 租户索引 |
| 记录型 | `apps/datacore/src/domain.ts:450-478` `SliceSpecRecord{sliceKey, version, spec{root, paths[][], maxNodes, contractFixtures}}` |
| 运行时 | `ontology-core.ts:552 executeSlice`（逐跳 navOut/navIn）· `:703 putSliceSpec` · `ontology/slice-planner.ts planSlice` |
| 端点 | `app.ts:2622 POST /a/v1/slices/plan` · `:2658` 登记并发 `slice.planned` · `:3033 PUT` · `:2262` 切片契约跑测 |
| 种子 | `battery.ts:2426 batteryBuiltinSlices()` **4 条**（`order_fulfillment_360` / `order_to_cash_720` / `enterprise_360` / `aop_scenario_chain`）+ 逐类型覆盖切片，落库 `service.ts:1136` |
| 跨服务消费方 | agentcore DRIL 用 `planSlice` 的 BFS 做检索打分（`dril/resource-registry.ts:317,323`）；`resolve_slice`/`plan_slice` 是执行计划里的一等 step 类型 |

**所以 E4 的范围要大幅收窄**：不是「把切片做成实体」（已经是了），而是**只补一件事——按 Decision Intent 做语义裁剪**。
现状 `planSlice` 入参是 `{rootType, targets, maxHops(默认6), question?}`，是**确定性 BFS 最短路**；`question` 只做 Jaccard 词重叠找已有切片复用。全仓 `DecisionIntent` **0 命中**。
⇒ 真缺口 = 「同一订单、不同决策意图 → 不同切片」这一条语义，**其余全部现成**。这一改把 E4 从「重」降到「中」。

**顺带挖出的真 bug（本次盘点最值钱的一条）**：`OntologyState` 是**「接了线接错地方 —— 写入被吞」**。

- `ObjectTypeDef.stateVariables` 定义在 `apps/datacore/src/domain.ts:276`，唯一写入方 `pipeline/subgraph.ts:53`；
- 但 `apps/datacore/src/ontology.ts:197-212` 的 `upsertType` **逐字段列举**构造 `def`，把 `stateVariables` / `functions` / `actions` / `security` / `entityCategory` / `storageMode` / `description` **七个字段一个都没抄** ⇒ **永远落不了库**；
- 五处 `repos.ontologyTypes.put` 调用点已全部追完（`ontology.ts:213/225/254`、`ontology-governance.ts:177/201`），其余四处都是「读回改一两字段再写回」，**没有一处能把这七个字段带进去**。

**这正是欠账 #69「本体七要素缺口：Interface 零 · Security 列级零 · Action 无回写声明 · Function 无本体签名」的根因。**
之前一直当成「没人填数据」，实测是**填了也存不进去**——典型的「接了线接错地方」，与「没接线」修法完全不同。修法是补全那一次字段拷贝（约 7 行），不是去补数据。**这条单独成单，见 WO 包 D6。**

---

## 3. 五张 MVP 表（仓主指定的最小闭环）

仓主原话：「如果做 MVP，我甚至建议先抓住这五张：`Enterprise_State` / `Process_Instance` / `Ontology_Slice` / `Decision` / `State_Delta`」。

实测：`grep` 全部 migrations，**只有 `Decision` 有承载体**（`027_decisions.sql`），其余四张 0 命中。

```
enterprise_state: 0      process_instance: 0      ontology_slice: 0
state_delta:      0      decision:         4 ✅
```

这五张串起来才叫孪生：

```
Enterprise_State   企业现在是什么状态
      │
      ├── Process_Instance   业务现在走到哪里
      │
      ├── Ontology_Slice     这次决策涉及哪些业务对象
      │
      ├── Decision           为什么做这个决定
      │
      └── State_Delta        这个决定让企业发生了什么变化 ──┐
                                                          │
      ┌───────────────────────────────────────────────────┘
      ▼
Enterprise_State'  （下一轮的起点）
```

**闭环判据（SEAM-GATE）**：一条组合测试必须能走通
`扰动 → StateDelta → 受影响闭包 → ApprovalPolicy 命中 → 批复链实例化 → Decision → Action → EnterpriseState'`，
且 `EnterpriseState'` ≠ `EnterpriseState`。任一环节断开即红。**各半 unit 全绿不算数**（绿测试 ≠ 能用）。

---

## 4. 硬架构决策（这几条定错了后面全白做）

### 4.1 真实世界与仿真世界的物理隔离（最重要）

```
EnterpriseState(REAL, is_simulated=false)   ←── 只能由 Action 审批后写入（R4）
        │ fork
        ▼
EnterpriseState(SIM,  is_simulated=true, forked_from=<real_state_id>)
        └── 推演随便写，永不回流真实世界
```

- **禁止**用同一张表的同一行承载两个世界。fork 必须产生**新行**，并带 `forked_from` 与 `world_id`。
- **禁止**仿真世界的写入走 Action 审批（会污染真实审批队列）；同时**禁止**仿真世界直接写真实对象实例。
- 采纳一个仿真结论 = 生成一个 **Action 提案**，走 R4 正门审批后才改真实世界。这条同时给欠账 #71/#81「采纳经营方案」一个语义正确的落点。

### 4.2 批复链是**算出来的**，不是**写死的**

```
ApprovalPolicy(condition_expr, required_roles[], escalation, timeout)
        +  Organization(Person, OrgRole, AuthorityLimit, Delegation)
        ↓  ApprovalPolicyEngine.resolve(context)
   ApprovalInstance(chain=[task1..taskN])   ← 每次条件不同，链就不同
```

- `condition_expr` **必须复用既有规则 DSL**（A5），不许另造一套表达式语言。这是本仓踩过的坑（`G-C08-EXPR-PARAM-SPLIT`，欠账 #77）。
- 阈值一律从规则读回，引擎内零阈值——与 `ChainImpediment` 的 `readRuleThreshold` 同一纪律。
- **零业务常数（R14）**：不许在代码里写 `capacity_gap > 0.10` 或 `margin < 0.08`，一律进规则表。

### 4.3 切片是**实体**，不是**一次性计算**

`OntologySlice` 必须可存储、可版本化、可闭包校验：

```
Slice Expansion Engine
  输入: (decisionIntent, rootObjectRef)
  策略: 1-hop → 2-hop → 决策相关 → 约束相关 → 风险相关   ← 按 Intent 语义裁剪，不是无脑 BFS
  输出: OntologySlice { objects[], relations[], events[], states[], metrics[], rules[], constraints[], bindings[], evidence[], actions[], governance }
  校验: probeMissingRefs 全闭包，缺一个即发布失败（fail-closed，不许 fail-open）
```

- 同一个订单，**不同 Decision Intent 产生不同切片**（交付风险 vs 利润风险，两套对象集）。这是「Slice ≠ Subset」的实质。
- 这同时是欠账 #130 `G-SIM-SCOPE-UNREAD` 的读端：`SimSession.scope` 终于有人读了。

### 4.4 Agent 不是主角

```
Ontology → Context → Rule → Constraint → Agent → Solver → Decision → Approval → Action
```

- Agent 负责**理解、分析、解释、提方案**；Solver 负责**在约束下找可行/最优解**；Rule 负责**判断企业政策**；Runtime 负责**真执行**。
- **禁止** `LLM → 自己决定 → 执行` 的捷径。任何 Agent 产出必须落成 `DecisionOption`，经规则与约束筛过，才能进 `Decision`。

### 4.5 「等待」是一等状态

`ProcessTask.status` 必须包含：`WAITING_USER` / `WAITING_APPROVAL` / `WAITING_DATA` / `WAITING_EXTERNAL_SYSTEM` / `WAITING_SCHEDULE`。

没有这个，系统答不出「为什么这个流程现在卡住了」——而这恰恰是 COO 最想问的问题。

---

## 5. WO 分解

三层派工。**D 层（数据）不依赖任何契约决策，今天就能并行开工**；E 层依赖 §4 的架构决策；U 层依赖 E 层的接口。

| 层 | 代号 | 名称 | 依赖 | 画像 |
|---|---|---|---|---|
| D | D1 | 组织与审批权限种子 | 无 | 轻 |
| D | D2 | 批复策略种子（规则表达式） | 无 | 轻 |
| D | D3 | 产销主数据补齐（BOM/Routing/Supplier/Material） | 无 | 轻 |
| D | D4 | 流程定义与耗时种子（23 节点 × 时间） | 无 | 轻 |
| D | D5 | 异常事件剧本种子（销售/生产/供应链/物流/管理五类） | 无 | 轻 |
| E | E1 | `EnterpriseState` + `StateDelta` 两表与真实/仿真隔离 | §4.1 | 重 |
| E | E2 | `ProcessInstance`/`ProcessTask` + 五种 WAITING | §4.5 | 中 |
| E | E3 | `ApprovalPolicyEngine` 动态批复链 | §4.2 + D1 + D2 | 中 |
| E | E4 | `OntologySlice` 一等实体 + Slice Expansion Engine | §4.3 | 重 |
| E | E5 | Impact Propagation API `POST /a/v1/simulation/impact-analysis` | E1 + 既有 `PropagationRule` | 重 |
| E | E6 | `DecisionOption`/`DecisionEvidence`/`CausalEdge` 补面 | §4.4 | 中 |
| U | U1 | Enterprise Decision Timeline（不是 BPMN） | E1/E2/E3 | 中 |
| U | U2 | What-if Control + 两世界对比 | E5 | 中 |

**本次先发 D 层五张单**（仓主要的「数据补齐 WO」），单独成文见 `docs/WO-PACK-twin-data.md`。

---

## 6. 验收（SEAM-GATE 驱动接缝，不验各半）

1. **闭环组合测试**：§3 那条链端到端跑通，`EnterpriseState' ≠ EnterpriseState`，且中间每一跳都有事件 emit + 有订阅方。
2. **动态批复链反证**：改一条批复策略规则的阈值（不改代码），同一个扰动必须产生**不同长度**的批复链。改不动 = 链是写死的 = 红。
3. **切片语义裁剪反证**：同一订单、两个不同 Decision Intent，产出的 `OntologySlice.objects` 集合必须**不同**。相同 = 退化成了无脑 BFS = 红。
4. **世界隔离反证**：在仿真世界改一个属性，真实世界的同一对象**必须不变**。变了 = 红（这是最危险的一条，必须有对抗测试）。
5. **确定性（R6）**：同 `(baseStateId, changeSet, ruleSetVersion)` 重跑两次，`StateDelta` 字节级一致。
6. **零业务常数（R14）**：门扫描 `ApprovalPolicyEngine` 与 Slice Expansion 的实现文件，出现数值字面量阈值即红（棘轮，豁免数只减不增）。

---

## 7. 命名纪律

- 禁用外部产品名。「Enterprise Decision Twin」作为**产品定位**可以说，落到代码里一律用平台自有术语：`twin` / `enterpriseState` / `stateDelta` / `ontologySlice` / `approvalPolicy`。
- 事件名遵循 `<domain>.<past_tense_verb>`，与 QOS PRD §8.2 同风格，一字不差。
- 新表名一律 snake_case 单数域前缀：`enterprise_states` / `state_deltas` / `process_instances` / `process_tasks` / `approval_policies` / `approval_instances` / `approval_tasks` / `ontology_slices`。

---

## 8. 回写义务

本 PRD 落地后**必须**回写 `docs/SYSTEM-ONTOLOGY.md`：
- §2 新增「K. 企业孪生域」，登记 8 个新对象类型；
- §3 新增两条链路（扰动传播链 / 切片展开链）；
- §4 新增 12 个事件及其订阅方；
- §5 补 R4 在仿真世界的豁免条款（**必须写明豁免边界**，否则会被读成「仿真可以绕过审批写真实世界」）；
- §8 登记 3 个新断点并注明关闭条件。

**不回写即过期失效。**
