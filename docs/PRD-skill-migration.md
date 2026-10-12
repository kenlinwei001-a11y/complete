# PRD · 32 份 ExecutionPlan 升格进 Skill 的迁移路线（Track E 落地）

| 项 | 值 |
|---|---|
| 版本 | v1.0（2026-08-03） |
| 上游 | `docs/WO-ROUTING-RETRIEVAL-FIRST.md` 四之四 Track E（仓主已定案：**Skill 吞并 Plan，不并列**）· `docs/SPEC-industrial-skill.md`（12 层目标形态 + §5 引用而非内联 + §7 两项定案） |
| 解决问题 | 今天「这个意图怎么答」的权威在 `ExecutionPlan`（32/32 零缺），Skill（7 个）与意图**零引用边**。本文给出把 32 份 Plan 升格进 Skill 的**可执行迁移路线**：分期、每期的验收门、每道门的"有牙"证明、以及三件地基的前置关系 |
| 不解决 | 不定义 Skill 的完整 12 层形态（那是 `SPEC-industrial-skill.md` 的职责）；不做路由改造（那是 Track A）；不改执行语义（M1 的字节相等**要求**执行语义不变） |
| 交付形态 | 本文只写路线与验收判据。**零代码改动**——实施由后续 WO 承接，范围边界见 §12 |

> **本文的核心主张**：这次迁移最容易失败的方式，不是做不完，而是**做完了但门是恒真的**。
> 所以本文把最大篇幅给了 M1 的一致性门——它是整条路径的命门，一旦它没牙，
> 后面的"翻转成功"就只是把一份没人验证过的声明换到了权威位置上。

---

## 0. 本体引用与影响（铁律 0 · 强制）

- **触及对象类型**（`docs/SYSTEM-ONTOLOGY.md` §2.H 交互/编排域）：
  - `Intent`（`IntentDefinitionSchema`，`packages/contracts/src/qos.ts`）：`planId`/`planRef` 两个绑定字段在 M2 被 Skill 引用取代。
  - `ExecutionPlan`（同文件）：从**一等注册对象**降为 `Skill.execution.plan` 的一个字段；`PlanStep` 判别联合**保留不动**（步骤语义是资产，不是负债）。
  - `Skill` / `SkillReference` / `SkillAttachment`（`packages/contracts/src/agentcore.ts`）：新增 `execution`、`businessIntent` 两组字段。
  - `ScenarioPackage`（Plan 的 `packageId` 归属）· `Scenario`（`intentKey` 指向）· `QueryTask`（`resolvedRefs` 的 kind 从 `plan` 变 `skill`）。
  - `SkillResource`（DRIL 投影，`apps/agentcore/src/dril/resource-projector.ts`）：`boundPlanRef` 字段随之改语义。
- **触及链路**（§3 编排链）：
  `Query → [路由门] → classify → proceedWithIntent → fillSlots → **[本迁移改这一跳]** → 计划步（resolve_slice → invoke_solver → evaluate_rules → render_answer）`。
  改的只有「意图→可执行步骤」这一跳的**解析源**（`resolvePlanForIntent` → `resolveSkillForIntent`）；
  `proceedWithIntent`/`fillSlots` 与右侧步骤执行器**一行不动**（这是 M1 字节相等成立的前提）。
- **触及事件**（§4）：**不新增事件名**。`routing.completed` 载荷不变；`step.started`/`step.completed` 不变。
  M2 之后 `skill.published` 成为「答法变更」的唯一广播口（今天是 plan publish + skill publish 两处）。
- **触及不变量**（§5）：

  | 不变量 | 本迁移的影响 | 处置 |
  |---|---|---|
  | R1 contracts-only-shared | `execution`/`businessIntent` 一律在 `@platform/contracts` 定义 | 不新增跨包依赖 |
  | R2 tenant_id everywhere | **Skill 是 tenant 级、Intent/Plan 是 package 级**——键空间不同 | §7.3 显式定键；多租户播种缺口见 §11 R-B（**真风险**） |
  | R3 entitlement 先于 authz | 硬约束③：翻转后必须**一处判定** | §7.4 + 新门 `skill-entitlement-single:check` |
  | R4 真值经 Action | Skill 的 `approvalGate`/`sideEffect` 不得绕过既有 Action 审批链 | M3 才碰；`action-wiring:check` 仍为唯一判据 |
  | R6 确定性 | 字节相等验收的地基；但 `provId` 天然不稳定（`apps/agentcore/src/ids.ts`） | §6.3 规范化器 + 三条自证 |
  | R7 错误信封 | `PLAN_NOT_FOUND` → `SKILL_NOT_FOUND`（码变、信封形状不变） | 契约同步 |
  | R9 仓储双实现 | `plans` 表退役是**不可回退**动作 | §7.5：翻转与删表**分离**，删表须带 down |
  | R11 全链闭包 | `scenarioClosure` 的"意图未绑定执行计划"判据要改成"未绑定 Skill" | `apps/agentcore/src/server.ts` 两处（§7.2 清单） |
  | R13 结论可溯源 | provenance 是字节相等的比对对象之一 | §6.3 |
  | R15 CLI 对等 | Plan 的管理面若有 CLI 等价，须随之迁移或登记 GUI 深链 | M2 收口项，`cli-parity:check` 守 |
  | R16 发育闭环 | 生长回路 `growth/scaffold.ts` 今天 scaffold 的是 Plan | §7.2 第 6 号写入方，必须一起翻 |

- **触及门禁**（§7）：新增 **7 道**，全部进 `pnpm gates` → ~~聚合 **16 → 23**（当前 16 条，实测 `package.json:29`）~~
  → **⚠️ 2026-08-09 实测订正：当前 `pnpm gates` = 26 条 ⇒ 聚合应为 26 → 33**（见文末《基数订正总表》drift-a / drift-b）：

  | 期 | 门 | 守什么 |
  |---|---|---|
  | M0 | `skill-export:check` | 32/32 意图各有 Skill，用例集从注册表派生不手抄 |
  | M0 | `skill-ref-closure:check` | 每个 `references[]` 的 key 真已注册（今天做不了，见 §5.2） |
  | M0 | `skill-business-intent:check` | Business Intent TODO 数棘轮，只降不升 |
  | M1 | `skill-plan-parity:check` | **命门**：两条路真跑 + 执行源可判别 + 规范化后字节相等（test-backed，同 `provisional-honesty:check` 模式） |
  | M2 | `skill-single-source:check` | 硬约束②：无第三处真源、六个写入方全收口 |
  | M2 | `skill-entitlement-single:check` | 硬约束③：entitlement 一处判定（含非 demo 租户用例） |
  | M3 | `skill-budget-effect:check` | 硬约束④：改 `maxBudgetRounds` → 探索轮次**真变**（效果层） |

  七道门**必须逐条回写本体 §7**，否则 `ontology-writeback:check` 红。
- **触及断点**（§8）：
  - 直接相关既有断点：`G-9`（场景卡闭包靠一次性手装播种）· `G-4`（意图↔计划配置面）· `G-1`（20 场景端到端）——三条都建立在「Plan 是权威」的前提上，翻转后**其描述必须回写**。
  - 本迁移**新登记两条**（M0 立项时写入本体 §8，闭合时改状态）：

    ```
    | G-SKILL-PLAN-DUAL-AUTHORITY | 同一意图「怎么答」有两处可写：ExecutionPlan（32/32 绑定·6 个写入方）
      与 SkillDefinition（7 个·与意图零引用边）；两边都能改、都能发布、互不知情
      | Intent →(planRef)→ ExecutionPlan ⊥ Skill | 🔴 未修（本 PRD M2 治）|

    | G-SKILL-TENANT-SEED-ASYMMETRY | 意图/计划有任意租户懒播种通道（server.ts ensureScenarios → ensureScenarioPackageSeed），
      Skill **没有**——seedRegistry() 无 tenantId 入参、7 个种子 skill 全部硬编码 tenantId="demo"，
      只在 main.ts boot 时为 demo 播种。翻转后非 demo 租户必然「有意图·无 Skill」
      | main.ts 播种 ⊥ server.ts 懒播种 | 🔴 未修（本 PRD M2 硬前置）|
    ```
- **CLI 打通（R15）**：Plan 管理今天**无** CLI 等价命令——`OPERATION_CATALOG`（`packages/contracts/src/operation-intent.ts`，~~17 条~~ **⚠️ 2026-08-09 实测 39 条**）全文零处提及 plan（~~已核实：该文件 `plan` 命中数 = 0~~ **⚠️ 实测命中数 = 1**，见下）。故本迁移**不引入 CLI 洼地**（删掉的东西本来就没有 CLI 面）；但 M2 若给 Skill 侧新增管理入口，须同步登记 `cliCommand` 或 `uiDeepLink`，否则 `cli-parity:check` 红。
  > ⚠️ **2026-08-09 复验（drift-e）**：**结论仍成立，两个数都错。**
  > `OPERATION_CATALOG` 今天在 `packages/contracts/src/operation-intent.ts:53`，共 **39 条**（不是 17）。
  > 目录体内 `plan` **命中 1 处**（不是 0）：`:60` 的 `{ op: "build", … }`，描述里的是 **`BuildPlan`（数据构建发动机的建域计划）**，
  > **不是 `ExecutionPlan`** ⇒ 「Plan 管理无 CLI 等价命令」这个结论**不受影响**。
  > **但必须把这一处写出来**：下一个人自己跑一遍会得到 1 而不是 0，
  > 若文档写着「命中数 = 0」，他会以为自己搞错了工具、或以为代码变了——
  > **一个恰好为 0 的数字最脆弱，因为任何同形近义词都会把它顶成 1。**
- **范畴**：把「一个意图怎么答」的权威从 ExecutionPlan 迁到 Skill，且保证迁移过程零行为漂移、迁移之后单一真源。

---

## 1. AS-IS 事实基线（本会话静态读码核实 · 每条带 file:line）

### 1.1 基数与绑定

| 事实 | 值 | 证据 |
|---|---|---|
| 意图目录 | **32** | `apps/agentcore/src/mocks/seed.ts:120` `seedIntentsAndPlans`：5 条显式意图 + `SCENARIO_CATALOG` 派生 16 条（20 张卡去掉与显式意图重名的 4 条，`seed.ts:490` `seededKeys` 守卫）+ `ceoCaps` 11 条（`seed.ts:537-563`） |
| ExecutionPlan | **32** | 同一函数同一循环，plan 与 intent 一一生成 |
| Skill | **7** | `seed.ts:864` skills 数组：`capacity_analysis` / `sop_meeting` / `risk_analysis` / `supply_chain_mgmt` / `quality_control` / `mcp_integration` / `capacity_action_draft` |
| 场景卡 | **20** | `apps/agentcore/src/scenarios-catalog.ts:60` `SCENARIO_CATALOG` |
| 场景入口 | **9** | `seed.ts:659` `seedSceneEntries`（9 个 `viewKey`） |
| 场景卡 `intentKey` 缺意图 | **0** | 派生逻辑保证（`seed.ts` 循环体对每张卡建意图） |
| 意图无 planId | **0** | 每条意图构造时都写 `planId`（`seed.ts:360/385/…`） |
| **意图 → Skill 的引用边** | **不存在** | `IntentDefinitionSchema`（`packages/contracts/src/qos.ts:43-62`）只有 `planId`/`planRef`，无任何 skill 字段 |

### 1.2 为什么「自动导出」可行：现成的机械来源

| Skill 字段 | 自动来源 | 证据 | 覆盖度 |
|---|---|---|---|
| `execution.plan[]` | `ExecutionPlan.steps` 原样搬 | `seed.ts:126` plans 数组 | 32/32 |
| `references[kind=solver]` | plan 步里的 `invoke_solver.params.solverKey` | `seed.ts` 每条 plan 都有 s1 invoke_solver（少数含 `resolve_slice`/`evaluate_rules`/`plan_slice`/`create_action_draft`） | 32/32 |
| `references[kind=rule]` | `SOLVER_RULE_REFS[solverKey]` ∪ `SCENARIO_CATALOG[].rules` | `packages/contracts/src/datacore.ts:127`（19 个 solver 的规则引用）+ `scenarios-catalog.ts:61-80` | 高（19 solver 覆盖；CEO 域 solver 未登记 → 该项为空） |
| `references[kind=slice]` | plan 步里的 `resolve_slice.params.sliceKey` | `seed.ts:175/229` | 仅少数 plan 有 |
| `references[kind=ontologyType]` | `SOLVER_CATALOG[solverKey].reads` | `apps/agentcore/src/agent/navigation-slice.ts:25-34`（19 条目，字段 `reads`） | 19 solver 覆盖 |
| `inputSchema` | `Intent.slots[]`（名/类型/必填/描述）机械转 JSON Schema | `qos.ts` `SlotDefSchema` | **仅 15/32**（见下） |
| `examples` | `Intent.examples` + 措辞金标集 | `seed.ts` 各意图 `examples`；`apps/agentcore/test/fixtures/scenario-phrasing-goldset.ts`（20 场景 × 3 变体 = 60 条，题干从 `SCENARIO_CATALOG` 派生不手抄） | 20/32 有金标变体 |

> **⚠ 自动导出的两个诚实边界（不写清就会被当成"这块做完了"）**
>
> 1. ~~**`inputSchema` 有 17/32 是空壳**：`SCENARIO_CATALOG` 派生的 16 条意图一律 `slots: []`（`seed.ts` 循环体），
>    加上 `ceo_finance_pnl`（`slotNames: []`，`seed.ts:547`），共 17 条 `slots` 为空。~~
>
>    > ### ⚠️ 2026-08-09 复验订正（drift-d）· **实测是 5/32，不是 17/32**
>    >
>    > 依据 `docs/CHECK-MIG-XR.md` §5 附表 **d**。本单**亲手真跑了 `seedIntentsAndPlans("demo")`**
>    > （非静态推算 —— 原文 §13 自己也承认那 17 是推算出来的）：
>    >
>    > ```
>    > node -e '…require("./apps/agentcore/dist/mocks/seed.js").seedIntentsAndPlans("demo","2026-01-01T00:00:00.000Z")…'
>    > → intents = 32  plans = 32
>    > → empty-slot intents = 5 / 32
>    > → keys: plan_recommend, inventory_opt, maint_stagger, sop_status, ceo_finance_pnl
>    > ```
>    >
>    > **错因（推算的前提已被上游修掉）**：原文的前提是「`SCENARIO_CATALOG` 派生的 16 条意图**一律** `slots: []`」。
>    > 这条前提**今天不成立** —— `WO-DERIVED-INTENT-SLOT-DEAF` 已把它改成从卡声明的求解器入参**派生槽位**：
>    > `apps/agentcore/src/mocks/seed.ts:634` `const derivedSlots = deriveIntentSlots(effectiveSolver, declaredArgs);`
>    > → `:666` `slots: derivedSlots`（`deriveIntentSlots` 定义在 `:95`），
>    > 代码里那行注释写得很清楚：「★ `slots: []` 是本病的病灶（声明无槽 ⇒ 用户实体无处可落）。现在从卡已声明的求解器入参派生」。
>    > 只有 `declaredArgs` 本身为空的那几张卡才落回空槽 —— 实测就是上面那 4 张 + `ceo_finance_pnl`。
>    >
>    > **形态（照 CLAUDE.md 铁律 0.6 的句式）**：
>    > 「我用**一个静态推算**当作**运行时事实**的证据，而前者并不度量后者。」
>    > 推算本身在写下的那天可能是对的，但**它的输入前提会被上游改掉，而推算不会自己失效**。
>    >
>    > **本条的诚实边界仍然完全成立**：这 5 条**不是"这题不需要输入"**，导出时**必须**打标 `x-derived: "empty-slots"`。
>    > 只是**基数从 17 降到 5**，工作量与风险面都小了一大截 —— 排期该按 5 算。
>    它们**不是"这题不需要输入"**，而是"槽从未声明、参数由路由 args 直灌"（`resolveCeoRoute` → `proceedWithIntent(…, route.args)`，
>    `apps/agentcore/src/router/orchestrator.ts:837/854/2041/2053`）——这正是 `R-ARG-FIDELITY` / `G-ARG-DROP-SEAM` 治的那个面。
>    导出时**必须**打标 `x-derived: "empty-slots"`，不许静默输出一个 `{type:"object",properties:{}}` 冒充契约。
> 2. **`navSlice` 不是"每意图的资源声明"**：`projectNavigationSlice(query, pageContext, scope)`（`navigation-slice.ts:283`）
>    是**按问句实时投影**的，不是按意图存的。所以 §1.2 表里 `ontologyType` 那行的真来源是
>    `SOLVER_CATALOG[solverKey].reads` 这张静态表，**不是** navSlice 本身。原路线骨架里写的
>    "navSlice/DRIL → 引用清单"要按这个口径落，否则实现时会去找一个不存在的东西。

### 1.3 Business Intent：为什么必须人填，以及工作量到底多大

`SPEC-industrial-skill.md` §2 把 ② Business Intent 判为 🔴「几乎全缺」，§3 进一步指出「意图 = 一种客户的需求场景」，
所以四项（用户角色 / 决策场景 / 触发条件 / KPI）**是意图的定义本身**，不是装饰。今天仓里能自动拿到的只有线索，不是答案：

| 需人填的字段 | 今天最接近的物 | 为什么不是答案 |
|---|---|---|
| 用户角色 | `Scenario.targetView`（`project`/`risk`/`dash`/…） | 视图 ≠ 角色。同一张风险看板，基地主管与制造副总看的是两件事 |
| 决策场景 | `VIEW_DOMAIN`（`scenarios-catalog.ts:89`，6 个域名） | 域名是分组标签（"产能与项目"），不是"在哪个会上、什么节点用" |
| 触发条件 | `Intent.examples` / `ScenarioCard.triggerQuestion` | 那是**触发问句**（词法面），不是**触发条件**（业务事件面：如"月度 S&OP 会前 3 天""齐套率跌破阈值时"） |
| KPI | 无任何来源 | 最接近的 `PLAN_GOAL_TARGETS`（`packages/contracts/src/base-registry.ts:105`）是**全公司目标**，不是"这个 Skill 成功与否的度量" |

**工作量口径（老实说）**：
- 32 份 × 4 字段 = 128 个语义判断。其中 20 份有场景卡线索（成本较低），11 份 CEO 意图只有 `name` + 2~3 条 examples（线索最弱），
  1 份 `order_deep_360` 是**技术演示意图**（A3.3 动态切片示例，`seed.ts:459`）——它的 Business Intent 很可能**根本不成立**。
  诚实处置：给它 `businessIntent.kind: "technical_demo"`，而不是硬编一个假业务场景（编了就是 SPEC §4-D5 说的
  "填了字段却没有消费方，比不填更危险"）。
- **这不是 dev 工作量，是组织协调工作量**：KPI 与决策场景需要业务方确认，估每份 15–30 分钟业务方时间，
  合计 **8–16 人时的业务方时间** + dev 整理。它无法靠 dev 加班压缩。
- **这正是它不该挡在权威翻转前面的根本原因**（见 §9 的 (a)/(b) 抉择）。

### 1.4 已实测的三个"零消费方"（迁移必须一并了结，否则是搬运既有的债）

| 字段 | 状态 | 证据 |
|---|---|---|
| `maxBudgetRounds` | **7/7 未填 · 全仓零生产消费方** | 全仓命中仅 3 处：契约定义 `packages/contracts/src/agentcore.ts:260` + `apps/agentcore/test/skill-contract.test.ts:65/77`（测试自产自销） |
| `outputSchema` | 有值但**零校验消费方** | 仅两处读：`apps/agentcore/src/skill-lint.ts:300`（只校 JSON Schema **形状**）与 `apps/agentcore/src/dril/resource-projector.ts:149`（投影成 `outputSpec` 给检索看）。**没有任何一处拿它校验实际输出** |
| ~~`references` 的非-skill 引用~~ | ~~**不校验存在性**~~ 🔁 **2026-08-09 已部分闭合（反向过期）** | ~~`apps/agentcore/src/skill-lint.ts:177` 明写 `if (ref.kind !== "skill") continue;`——solver/rule/slice/ontologyType/workflow/agent 引用**一律不查是否已注册**~~ → 见下方订正 |

> ### 🔁 2026-08-09 复验订正 · 第三行「非-skill 引用不校验存在性」**已部分闭合**
>
> 依据 `docs/CHECK-MIG-XR.md` §5-4。**这一行今天读起来像"这块还没人管"，而实际上一半已经有人管了。**
>
> **闭合的那一半（`WO-SKILL-REFCLOSURE-A`，2026-08-09）**：
> `apps/agentcore/src/server.ts:1267-1269` 从 `references` ∪ `dependsOn` 里抽出
> **solver / rule / ontologyType** 三种 kind → `:1272 probeMissingRefs` 打到 DataCore 注册表
> → 不存在则 `:1279` `422 SKILL_REF_UNRESOLVED`，**拦在落库之前**、**fail-closed**（读不出/空集 ⇒ 503）、
> **`force` 不豁免**。有防退化门 `node scripts/check-ref-closure.mjs` 守着（摘掉那行 → 门当场红）。
>
> **仍然没闭的那一半（这才是今天该排期的东西）**：
> `apps/agentcore/src/skill-lint.ts:215-217` 的注释自承 —— **`constraint` / `slice` / `workflow` / `agent`
> 四种 kind 今天仍无人校验**（既不在本地 lint，也不在探针里）。
> 其中 `workflow` 已有活样本：`apps/agentcore/src/mocks/seed.ts:1106` 的 `sop_meeting` 声明了
> `{ kind:"workflow", key:"sop_balance_wf", required:true }` —— **声明了、没人查它存不存在**。
>
> **⛔ 两个方向都别读错**：
> - 别读成「所有非 skill 引用都有人管」 ⇒ 4/6 种仍裸奔；
> - 也别读成「这道门今天做不了」 ⇒ 那会**重复造一道已存在的门**（`docs/SPEC-industrial-skill.md` §5 的 **F8** 订正记的正是这个错）。
>
> **坐标订正**：`if (ref.kind !== "skill") continue;` 今天在 **`skill-lint.ts:218`**（原文 `:177` 已漂）。

### 1.5 三件地基的现状（供 §10 排期）

| 地基 | 现状 | 证据 |
|---|---|---|
| **G1 executor 并行边** | 严格串行：`for (const step of input.steps) { … await … }`，循环体内无 `Promise.all` | `apps/agentcore/src/workflow/executor.ts:104` |
| **G2 规则 DSL** | ~~28 条业务规则；`expression` **不能引用 `params`**，且**静默恒假不报错**~~ 🔁 **2026-08-09：已被修掉（反向过期）** | ~~机制：`Operand` 联合只有 `literal｜field｜user｜func`（`apps/datacore/src/ruledsl.ts:26`）→ `params.cashFloor` 被当 field path → `resolveField` 返 `undefined` → `compare()` 里 `if (typeof l !== "number" \|\| typeof r !== "number") return false`（`ruledsl.ts:458`）→ **恒 false，无异常**。活样本：C18 `expression:"AnnualScenario.cashCushion < 50"` 与 `params:{cashFloor: PLAN_GOAL_TARGETS.cashFloor}` 并存（`battery.ts:231`）~~ → 见下方订正 |

> ### 🔁 2026-08-09 复验订正 · **G2 已被 `WO-RULE-EXPR-PARAMS` 修掉 —— §10.2 的排期要跟着改**
>
> 依据 `docs/CHECK-MIG-XR.md` §5-5。**这一条的方向是反的：文档低估了进展。**
> 照原文排期，会去修一个已经修好的东西 —— 而**真正剩下的那一半会被漏掉**。
>
> **已修的那一半（`params` 不再是 field path，缺席不再静默）**：
>
> | 环节 | 今天 | 证据 |
> |---|---|---|
> | `Operand` 联合 | **已含 `{ kind:"param"; name:string }`** | `apps/datacore/src/ruledsl.ts:39` |
> | 解析 | `params.<名>` 解析成 `param` 操作数（必须恰好两段） | `ruledsl.ts:318-324` |
> | 求值 | 未在 `rule.params` 声明 ⇒ **`throw new DslError`** —— 注释原文：「诚实缺席：未声明的阈值**抛错**，不回退载荷、不取 0/undefined」 | `ruledsl.ts:491-499` |
> | 发布期校验料 | `collectParamRefs(ast)` 供「引用的阈值 ⊆ 声明的阈值」校验 | `ruledsl.ts:414-420` |
> | 活样本 | C18 已改用 `ruleParamRef("cashFloor")`，不再是"同一条规则两个可各自编辑的阈值" | `apps/datacore/src/synthetic/battery.ts` |
>
> **仍然没做的那一半（§10.2 的"真交付物 = 解析期门"只做了一半）**：
> **`kind:"field"` 拼错仍然静默恒假** —— `resolveField` 带前缀回退，写错字段名不报错、不抛异常。
> ⇒ 「静默恒假」这个**病灶形态并没有消失**，只是从 `params.*` 挪到了 `field` 路径上。
>
> ⇒ 正确读法：**「`params` 那一支已修（抛错）· `field` 拼错那一支仍静默恒假 · 解析期门只做了一半」**。
> 同一条订正另见 `docs/SPEC-industrial-skill.md` §2 第 ⑧ 层的 **F9**。
| **G3 命名** | 未定；且**已有一处词表冲突**：SPEC §7 定案 1 用 `requires`，而 `requires` 在本仓已被 `FeatureDef.requires`（entitlement 依赖级联，`apps/agentcore/src/features/registry.ts` `featureEnabled` 内 `def.requires`）占用 | 见 §10.3 |

---

## 2. 目标形态（本 PRD 只钉与迁移相关的那几层）

```
Skill（一意图一份 · 版本化 · entitlement 与意图同处判定）
├── key                     ← **必须 === intent.key**（任何映射表都是第三处真源）
├── businessIntent          ← 人填（§1.3）；契约必填、允许显式 TODO 哨兵
├── execution
│   ├── mode                ← DETERMINISTIC | EXPLORATORY | HYBRID（显式声明，不靠"有没有 plan"隐式推断）
│   ├── plan[]              ← 今日 ExecutionPlan.steps **逐字节不变**（PlanStep 判别联合复用，不新造 DSL）
│   └── body                ← 探索/兜底时注入 agent（今日 Skill.body 语义不变）
├── references[] / dependsOn[]  ← 引用清单（solver/rule/slice/ontologyType/tool/mcp/skill）
├── inputSchema / outputSchema
├── maxBudgetRounds / provenancePolicy / sideEffect / approvalGate
└── status                  ← **生命周期**（DRAFT/PUBLISHED/RETIRED），**不再兼任授权判据**（§7.4）
```

**两条边界（防长成上帝对象，沿用 Track E 与 SPEC §5 判据）**

- **引用**（这东西变了，所有用它的 Skill 都该跟着变）：规则 / 求解器及其数学约束 / 本体类型与切片 / 工具与 MCP / 其他 Skill。
- **内联**（变了只有这一个 Skill 该变）：`businessIntent` / `maxBudgetRounds` / `provenancePolicy` / `antiExamples` / 求解器的**本 Skill 专属 objective 与权重**（SPEC §7 定案 2）。
- **明确不放进 Skill**：真值数据（R4）· 租户阈值（rule params / feature config）· 业务常数（R14）· 模型选择（LLM 用途绑定）。

---

## 3. 分期总览

> **期号命名空间（`docs/PRD-skill-crossreview.md` C5 收口）**：本套 PRD 里「Phase N」曾同时指三件不同的事，
> 已拆成三个互不相撞的前缀 —— **M0–M3** 迁移线（`PRD-skill-migration`）· **R0–R4** 路由线（WO Track A）
> · **T1–T2** 运行时线（`PRD-skill-runtime-orchestrator` 自身范围）。**本文之后不再出现裸「Phase N」。**


```
G3 命名定死 ──▶ M0 影子声明 ──▶ M1 一致性门 ──▶ M2 权威翻转 ──┬─▶ G1 并行边 ──┐
   (§10.3)          (§5)                (§6 · 命门)          (§7)            └─▶ G2 规则 DSL ─┴─▶ M3（§8）
```

| 期 | 一句话 | 线上行为 | 可回退 | 出口判据 |
|---|---|---|---|---|
| M0 | 为 32 意图各生成一份**影子** Skill，内容从现有物机械导出 | **一字节不变**（无人消费） | 删数据即回退 | 32/32 生成 + 引用闭包门绿 + Business Intent 全部为显式 TODO 哨兵（不是缺字段） |
| M1 | 建一致性门：**两条路真跑**，规范化后 answer + provenance 字节相等 | 不变 | — | 32/32 逐意图过 + 门自带三条"有牙"自证 + 两条变异反证按预期红 |
| M2 | 执行改读 `Skill.execution.plan`；删 Plan 的独立注册/播种/查询入口 | 用户感知为零（M1 保证） | feature flag 一键回退；**表不删** | 双源红门绿 + entitlement 一处判定门绿 + **非 demo 租户**用例绿 |
| M3 | 扩 Skill 独有能力，**一次一项、每项配效果层门** | 逐项暗发 | 每项独立 flag | 每项：改声明 → 行为**真变**（不是只读出来） |

---

## 4. 硬约束 → 可验收判据（Track E 四条 · 已定不得推翻）

| # | 硬约束原文 | 落成什么门 | 什么样算过 | 什么样是**假过** |
|---|---|---|---|---|
| ① | 零行为漂移：迁移前后 answer 与 provenance **字节相等** | `skill-plan-parity:check`（M1 · test-backed + 薄脚本入 gates） | 32/32 意图、两条路**各自真跑**、规范化后字符串全等 | 只比对"Skill 里的 plan 字段 === Plan 的 steps"——**恒真**，因为影子声明本来就是从 Plan 导出的（同一份数据自己跟自己比） |
| ② | 单一真源硬门：不得存在第三处描述"这个意图怎么答"的注册表 | `skill-single-source:check`（M2，进 `pnpm gates`） | 任一意图同时解析出 Plan 与 Skill → 红；且**6 个写入方全部收口**（§7.2） | 只删 REST 端点、留着 `seed.ts` / `growth/scaffold.ts` / `ops/fallback.ts` / `internal/scaffold` 继续写 plan——端点测试全绿，真源仍是两份 |
| ③ | entitlement 一处判定 | `skill-entitlement-single:check`（M2） | 全 32 意图 × {feature 开, 关} 四象限，不存在"意图开着但 Skill 关着"或反之 | 只在 demo 租户测——**多租户维必然半开**（§11 R-B），单租户测不出来 |
| ④ | 探索 Skill 的 `maxBudgetRounds` 必须有真消费方 | `skill-budget-effect:check`（M3 首项 · test-backed） | 同一开放题，`maxBudgetRounds: 2` vs `6` → 观测到的 **LLM 往返次数真的不同**，且 2 的那次落 `degrade` | 断言"字段被读出来了 / 被传给 BudgetTracker 了"——那是运输层断言（#92 同族：账本记得对，没人读） |

---

## 5. M0 · 影子声明（不改一行执行代码）

### 5.1 做什么

写一个**确定性导出器**（建议落点 apps/agentcore/src/mocks/skill-export.ts · 纯函数，R6：同输入字节一致），
输入 = `seedIntentsAndPlans(tenantId)` + `SCENARIO_CATALOG` + `SOLVER_RULE_REFS` + `SOLVER_CATALOG`，
输出 = 32 份 `SkillDefinition`（`status: "DRAFT"`，key === intentKey）。映射规则见 §1.2 表。

**这一期结束时**：Skill 表里多了 32 份 DRAFT 影子；**没有任何执行路径读它们**；线上行为逐字节不变。

### 5.2 M0 的三道门（都不涉及执行）

1. **导出完备**：`seedIntentsAndPlans().intents.map(i => i.key)` 逐条必须有对应 Skill——**用例集从注册表派生不手抄**
   （沿用 `scenario-phrasing-goldset.ts` 的防漂移纪律）。新增意图不配 Skill → 红。
2. **引用闭包**（SPEC §5「必配硬门：引用可校验」的第一次落地）：
   每个 `references[]` 条目的 key 必须真已注册——`kind=solver` ∈ DataCore `SOLVER_KEYS`、`kind=rule` ∈ 已发布规则、
   `kind=ontologyType` ∈ 已发布本体、`kind=slice` ∈ 切片库、`kind=skill` ∈ skills。
   ⚠️ **原稿写「这道门今天做不了」，经审核方逐条核对后更正**（`docs/PRD-skill-crossreview.md` C4）：
   `skill-lint` 确实只校验 `kind=skill` 的引用（属实），**但由此推出"做不了"不成立**——
   `probeMissingRefs`（`apps/agentcore/src/resources.ts`）**已经能校验非 skill 引用，且已接线两处**：
   **workflow 发布**（`solverKeys`/`ruleKeys`）与 **agent 发布**（`objectTypes`）。
   真实缺口只有两条：**① skill 发布路没接**（`POST /b/v1/skills/:id/publish` 只调 `lintSkill`）；**② 它自身 fail-open**。
   → 本期的工作是**接一条已有的线 + 关掉 fail-open**，**不是从零造一道门**——
   这条口径直接影响排期与风险评估，原稿的说法会把工作量整体高估。
3. **Business Intent 棘轮**（`skill-business-intent:check`，见 §9）：
   `businessIntent` 契约上**必填**，允许值为显式哨兵 `{ status: "TODO", owner: "<待指派>" }`；
   棘轮基线文件记录当前 TODO 数（M0 结束时 = 32），**只许降不许升**（同 `scripts/debattery-baseline.json` 模式）。

### 5.3 M0 的诚实边界（必须写进导出器注释）

- ~~17/32~~ **5/32**（⚠️ 2026-08-09 实测订正 drift-d，见 §1.2 边界 1）的 `inputSchema` 是空壳，已打标 `x-derived: "empty-slots"`；
- 12/32 无金标变体（11 CEO 意图 + `order_deep_360`），`examples` 只有各自 2~3 条；
- CEO 域 solver 未登记在 `SOLVER_RULE_REFS`（`packages/contracts/src/datacore.ts:127` 只有 19 条），
  故这些 Skill 的 `references[kind=rule]` 为空——**空是事实，不是遗漏**，但要标出来，否则下一个人会以为"这题不涉及规则"。

---

## 6. M1 · 一致性门（**整条路径的命门**）

### 6.1 为什么"Skill 里有 plan 字段且内容相同"是恒真断言

M0 的影子声明就是**从 Plan 机械导出**的。拿导出物跟源物比对，比的是"复制成功"，不是"执行等价"。
这类断言在**任何**实现下都绿——**包括执行链根本没读 Skill 的实现**。
（审核方本会话建探索门时，前四版全栽在这一类问题上，第五版才成。这不是理论风险。）

### 6.2 门的形状：四条**同时**成立才算过

**判据 1 · 两条路都真跑到底。**
同一 `createTestApp` 进程、同一 query、同一 presetSlots、同一 mock DataCore（同 seed），跑两次：
- `run-OLD`：暗发门 `qos.skill-execution-authority` **关** → 现状路径 `resolvePlanForIntent`（`apps/agentcore/src/catalog/service.ts:83`）→ `runWorkflowSteps`
- `run-NEW`：门 **开** → `resolveSkillForIntent` → `skill.execution.plan` → **同一个** `runWorkflowSteps`

两次都必须 `task.status === "COMPLETED"` 且 `task.path === "WORKFLOW"`。任一为 `FAILED`/`AWAITING_CLARIFICATION` → 红。

**判据 2 · 执行源可判别（缺这条整个门恒真）。**
`run-NEW` 的 `task.resolvedRefs` 必须含 `{kind:"skill", key:<intentKey>}` 且**不含** `{kind:"plan", …}`；`run-OLD` 反之。
`RefKindSchema` 已含 `"skill"`（`packages/contracts/src/refs.ts:9`），**无需改契约**。
> 这条是"两条路真的走了不同的解析源"的唯一证据。没有它，一个"新路悄悄回落读 plan"的实现会让判据 3 完美通过。

**判据 3 · 规范化后字节相等。**
`canonicalizeAnswer(run-OLD.answer) === canonicalizeAnswer(run-NEW.answer)`（**字符串全等**，不是 deep-equal 的宽松比较）。

**判据 4 · 覆盖 32/32，用例集从注册表派生。**
用例 = `seedIntentsAndPlans().intents`；槽位取 `SCENARIO_CATALOG[].presetContext.slotPresets`（20 条）
+ CEO 路由 args 的固定 fixture（12 条，写在 fixture 里并注明每个值的来源）。缺一即红——新增意图自动进门。

### 6.3 规范化器：这道门唯一的单点故障，必须自带牙齿

**为什么必须有规范化**：`provId` 由 `newId("prov")` 生成（`apps/agentcore/src/workflow/executor.ts:217/367`），
而 `newId` → `ulid()` = `Date.now()` 时间片 + `crypto.randomBytes`（`apps/agentcore/src/ids.ts:15-23`）。
**同一个 plan 自己跑两次，provId 都不相等**。不规范化 → 门恒红（无用）；规范化过头 → 门恒绿（更糟）。

`canonicalizeAnswer` 必须是一个 ≤40 行的纯函数，**只允许做三件事**：
1. `provId` 按**首次出现顺序**重编号为 `p0/p1/…`，同时改写 `blocks[].provId` 与 `provenance[].id`（保持引用一致性）；
2. `validationTrace.generatedAt` 置空；
3. `action_draft` 块的 `draftId` 按同样的首现顺序重编号。

**规范化器的三条自证（与主断言写在同一个测试文件里）**：

| 自证 | 断言 | 它防什么 |
|---|---|---|
| ① 自反 | `run-OLD` 连跑两次 → canonical 相等 | 证规范化**确实**抹平了不稳定位（否则门恒红，会被人用"放宽比较"修掉） |
| ② 敏感 | 把 `run-NEW` 的 skill `execution.plan` 里任一 solverArg 改掉（如 `weeks: 6 → 7`）→ canonical **必须不等** | 证规范化**没有**把真差异一并抹掉（防"抹到只剩结构"） |
| ③ 结构 | canonical 输出中不得出现 `/^prov_[0-9A-Z]{26}$/` 形态 | 证第 1 条真的执行了，而不是"正则没匹配上所以什么都没改" |

### 6.4 变异反证（复验方必跑 · 两条都红对了，门才算有牙）

- **M1**：打掉 `run-NEW` 的执行源分支，让它回落读 plan → **判据 2 必红、判据 3 反而绿**。
  这条变异的价值不在于测通过，而在于**当场演示"只比字节不验执行源"为什么恒真**。
- **M2**：改 skill 的一个 solverArg → **判据 3 必红**。

### 6.5 这道门证不了什么（写进门的注释，别让绿色被当成"全都对"）

1. **真 DataCore 下的字节相等**——本门跑在 `createMockDataCore` 上。跨服务面须补一条 `apps/datacore/test/xservice-smoke.test.ts` 同款用例（至少覆盖 `capacity_feasibility` 与 `affected_orders` 两条历史上真炸过接缝的链，见本体 §8 G-2）。
2. **未覆盖的槽位组合**——32 条用例是每意图一组槽位，不是全组合。
3. **探索/path-B 路径**——M1 只管确定性题；探索侧到 M3 才有 Skill 参与。

---

## 7. M2 · 权威翻转

### 7.1 必须改的读取点（本分支实测清单，逐条 file:line）

| # | 位置 | 今天读什么 | 翻转后 |
|---|---|---|---|
| 1 | `apps/agentcore/src/router/orchestrator.ts:1412` `runPathA` | `resolvePlanForIntent` | `resolveSkillForIntent` → `skill.execution.plan` |
| 2 | `apps/agentcore/src/router/orchestrator.ts:1061` `solverKeyForIntent` | 从 plan 首个 `invoke_solver` 步取 solver 真名（⑤ 多意图路径用） | 同上；**注意它是结构依赖，不是简单读取** |
| 3 | `apps/agentcore/src/server.ts:460` trace 端点 | `resolvePlanForIntent(…)?.plan` 喂 `projectTrace` | 同上 |
| 4 | `apps/agentcore/src/server.ts:1995` `scenarioClosure` | 「意图未绑定执行计划」判据 | 改判「未绑定 Skill」（R11 闭包口径） |
| 5 | `apps/agentcore/src/server.ts:2136` scaffold 闭包判定 | `resolvePlanByRef(… forValidation)` | 同上 |
| 6 | `apps/agentcore/src/server.ts:2247` `verifyScenario.capabilityOk` | `resolvePlanForIntent` | 同上 |
| 7 | `apps/agentcore/src/server.ts:2248` `ontologyOk` | **直接读 `intent.planId`** | 改读 Skill 绑定 |
| 8 | `apps/agentcore/src/server.ts:2520` 场景发布链 | `resolvePlanByRef` + `publishPlan` | 改为 publish Skill |
| 9 | `apps/agentcore/src/dril/resource-projector.ts:135` `projectIntents` | `boundPlanRef: i.planRef ? … : i.planId` | 改 `boundSkillRef`（DRIL 检索里"这个意图绑了什么"的显示口径） |
| 10 | `apps/agentcore/src/catalog/service.ts:83/190` | `resolvePlanForIntent` / publish 校验 | 翻转后此函数只保留兼容读（M2 观察期），观察期后删 |

### 7.2 **六个** ExecutionPlan 写入方（硬约束②的真实工作量 · 原路线骨架只点了前两个）

| # | 写入方 | 位置 | 翻转后 |
|---|---|---|---|
| 1 | 出厂播种 | `apps/agentcore/src/mocks/seed.ts:120` `seedIntentsAndPlans` 的 plans 分支 + `seed.ts:641` `ensureScenarioPackageSeed` 的 `plans.insert` 循环 | 改播 Skill |
| 2 | 目录 REST | `apps/agentcore/src/server.ts:544/550/558/566`（list/create/update/publish plans） | 删（前端同步删，见下） |
| 3 | 跨系统 scaffold | `apps/agentcore/src/server.ts:2028-2035` `POST /b/v1/internal/scaffold` 内 `deps.catalog.createPlan` | 改 scaffold Skill |
| 4 | 生长回路 | `apps/agentcore/src/growth/scaffold.ts:29-38` `scaffoldDraftPlan` | 改 scaffold Skill（R16 发育闭环） |
| 5 | 孵化闭环 | `apps/agentcore/src/ops/fallback.ts:129` `repos.plans.insert(promoted_*)` | 改产 Skill |
| 6 | 冒烟脚本 | `apps/agentcore/src/scripts/smoke-llm.ts:38` | 随播种改 |

前端同步删除面：`apps/frontend-shell/src/api/endpoints.ts:767-770`（`fetchPlans`/`createPlan`）·
`apps/frontend-shell/src/pages/admin/CatalogPage.tsx:126/285`（`createPlanMut` + `plan-create` 按钮）·
`apps/frontend-shell/src/mocks/handlers.ts:3044/3046`（mock handler）。
> ⚠ G-4（本体 §8）当年正是为了消"意图绑定的执行计划无前端创建入口"这条死路才加的这个按钮。
> 删它**必须同时**给出 Skill 侧的等价入口，否则是把一条已修的死路重新挖开。

### 7.3 键空间：必须显式决定，不能默认

`SkillDefinition` 是 **tenant 级**（有 `tenantId`、无 `packageId`，`packages/contracts/src/agentcore.ts:236-247`）；
`ExecutionPlan`/`IntentDefinition` 是 **package 级**（有 `packageId`）。翻转把解析键从 `(packageId, planKey)` 变成 `(tenantId, skillKey)`。

- **既有隐含假设**：`server.ts:2021/2245/2516` 都在做 `repos.packages.listByTenant(tenantId)[0]`——**一租户一包**。
  这是**今天就存在**的假设，不是本迁移引入的；但翻转把它从"取第一个包"升级成**键唯一性要求**。
- **处置（不许静默）**：M2 加一条启动期断言——`每租户 package 数 ≤ 1` **或** `intentKey 在该租户全局唯一`；
  不满足则**拒绝启用翻转 flag** 并打诚实日志，而不是取第一个包接着跑。

### 7.4 entitlement 一处判定（硬约束③）

- **今天两处**：意图走 `intentAllowed(set, intentKey)`（`apps/agentcore/src/features/registry.ts:201`）；
  Skill 走自己的 `status` + `agent.skill-on-free-qa` 暗发门（`features/registry.ts:118`）。
- **翻转后**：`intentAllowed` 仍是**唯一** entitlement 判据；`Skill.status` 降为**生命周期**（发布/退役），不再兼任"这题能不能答"。
  `resolveSkillForIntent` 内**先** `intentAllowed`、后取 skill；skill 不参与授权。
- **门 `skill-entitlement-single:check`**：注入真 `FeatureGate`（`createTestApp({features})` 已支持，`apps/agentcore/test/helpers.ts:43`），
  跑全 32 意图 × {feature 开, 关} 四象限，断言不存在"意图允许但 Skill 不可解析"或反之。
  **必须含一条非 demo 租户用例**（`apps/agentcore/test/scenario-seed-multitenant.test.ts` 已有同款先例）。

### 7.5 双源红门 `skill-single-source:check`（进 `pnpm gates`）

1. **运行期**：对每个 PUBLISHED intent，`resolveSkillForIntent` 必须命中、`resolvePlanForIntent` 必须**未命中**；两份同时解析出 → 红。
2. **静态**：除 `apps/agentcore/migrations/*.sql` 与 `apps/agentcore/src/persistence/**` 外，全仓不得再出现 `repos.plans.insert(`（新写入方即红，堵 §7.2 的六个口子被人重新打开）。
3. **静态**：`ExecutionPlanSchema` 只允许被 `SkillDefinitionSchema.execution` 引用；`PlanStepSchema` 判别联合**保留**（步骤语义复用，不是负债）。

### 7.6 回退与删表：**分离**（这是我加的一条，原骨架未写）

- 翻转由暗发 flag `qos.skill-execution-authority` 控制（`defaultOn:false` → 灰度开 → 全开），**任何时候一键回退**。
- 回退可行的前提是 `plans` 表**还在**。故：**M2 不删表**。
- 表级退役排到翻转后**连续两个发布周期无回滚**，且 migration 必须带 `down`（R9 可回退），
  memory/pg 双实现 + repo 接口四处同改。删表是不可回退动作——把它和"翻转"绑在一起，等于把回退开关焊死。

---

## 8. M3 · Skill 独有能力（一次一项 · 每项配效果层门）

排序按"今天真在流血"，不按"字段表顺序"：

| 序 | 扩展项 | 效果层门（改声明 → 行为**真变**） | 前置 |
|---|---|---|---|
| 1 | `maxBudgetRounds` 接消费方（硬约束④） | 同一开放题 `2` vs `6` → **LLM 往返次数真的不同**（用 `ScriptedLlmClient` 计数，`apps/agentcore/test/agent-budget.test.ts` 有同款先例），且 `2` 那次落 `degrade`（`apps/agentcore/src/agent/loop.ts` 唯一降级出口，`loop-control:check` 守）。接线点：`runPathB` 的 `new BudgetTracker(this.residualBudgetFromConfig())`（`apps/agentcore/src/router/orchestrator.ts:1617`）；`BudgetTracker` 构造为 `{...DEFAULT_AGENT_BUDGET, ...overrides}`（`apps/agentcore/src/tools/budget.ts:30-31`，默认 `maxRoundTrips: 24`，`packages/contracts/src/qos.ts:616-625`）。**优先级：env 硬预算 > skill 声明 > DEFAULT**（env 是运维闸，不能被声明绕过，立场同 `deploy-governance:check`） | 无 |
| 2 | `antiExamples[]` + `exclusivity` | S12「涂布良率为什么掉了？」不再被判跨域会诊、S13 不再被「交付」拉走——`apps/agentcore/test/scenario-phrasing-seam.test.ts` 现有 6 条失败用例转绿即效果 | Track A R2/R3（路由改造） |
| 3 | `acceptance.goldenCases[]` 自带验收 | 门**从注册表生成**：新增 skill 不配用例即红。替代今天"测试文件手写 80 条 + 特意从 catalog 派生防漂移"的做法 | 1 |
| 4 | `outputSchema` 接消费方**或删**（SPEC §4-D5） | 故意让求解器返回缺字段的输出 → 必须被拒或被诚实标注，而不是照单渲染。**做不到就删字段**——留一个不校验的形状声明 = 制造"这件事做过了"的错觉 | 无 |
| 5 | `progress.emitsNarration` / `phases[]` | 多角色 Coordinator 路径上旁白**真到达**（E9，今天真跑实测 0 条） | Track C1 |
| 6 | Reasoning Graph（条件分支/汇流） | 「瓶颈识别的结果决定要不要走扩产建议」这类拓扑真能表达并执行 | **G1 并行边**（§10.1）+ 新 step 类型 |

---

## 9. 开放问题 (a)/(b)：先填 Business Intent 再翻转，还是先翻转后补？

### 9.1 推荐：**(b) 的加固版** —— 先用自动导出骨架翻转，Business Intent 后补，但用「必填 + 显式 TODO 哨兵 + 棘轮门」锁死不许回潮

### 9.2 理由（三条，按分量排）

1. **Business Intent 与命门正交。** 硬约束①的验收对象是 `execution.plan` 的执行等价性；
   `businessIntent` 不参与执行（它是给人和检索层看的）。把它列为翻转前置，等于把一条**与命门无关的人工输入**放进关键路径。
   这是本仓吃亏模式的镜像版：不是"声明了没接线"，而是"为了声明完整而推迟接线"——同样是让真正该跑起来的东西继续不跑。
2. **(a) 的真实成本是双写期变长，而双写期正是漂移的温床。**
   M0 的影子声明与 Plan 并存期间，任何对 Plan 的改动都要**手动**同步到 Skill（Skill 还没有权威，没有门守）。
   等 128 个语义判断（§1.3）走完组织流程，双写期会长到以周计。**而这次迁移的全部意义就是消灭"两处描述同一件事"**。
   把它拖长来换"声明完整"，是拿本金换利息。
3. **(a) 会把一条技术迁移挂在一条组织流程上。** KPI 与决策场景需要业务方确认（§1.3），dev 编不出来——
   编了就是 SPEC §4-D5 的原话：**"填了字段却没有消费方，比不填更危险"**。

### 9.3 但裸版 (b) 有真风险，所以必须加固

**证据**：本仓"以后再填"的历史成功率很低——7 个既有 Skill 的 `dependsOn` **7/7 空**、`maxBudgetRounds` **7/7 空**、
`resources` **7/7 空**（`SPEC-industrial-skill.md` §4 实测）。这三项都是当年"字段先放着、以后再填"的遗物。

加固三件套：

| 件 | 做法 | 防什么 |
|---|---|---|
| **契约必填 + 显式哨兵** | `businessIntent` 在 zod 上**必填**，但允许 `{ status:"TODO", owner:"<待指派>" }` | 缺字段可以被忽略，显式 TODO 不能——它会出现在每一次序列化里 |
| **棘轮门** `skill-business-intent:check` | 基线文件记 TODO 数（翻转时 = 32），**只许降不许升**；新增 Skill 带 TODO 即红，已填的退回 TODO 即红。模式同 `scripts/debattery-baseline.json` | 防"填了一半就停"和"新 Skill 又开始欠债" |
| **需求拉动，不行政摊派** | M3 的每一项扩展，**必须先把它依赖的那几份 Skill 的 businessIntent 填掉**（谁用谁填），而不是"某天有人一次填 32 份" | R16 发育闭环的口径：由真实需求拉动补齐，一次填 32 份的批处理任务永远排不上优先级 |

**外加一条诚实处置**：`businessIntent.status === "TODO"` 的 Skill 在资源目录 / DRIL 检索里**降权但不隐藏**。
不假装完整，也不制造"看不见就等于不存在"。

### 9.4 什么情况下我会改推荐

如果仓主的验收口径是「Skill 目录要能直接给客户/投委会看」（即 Business Intent 是**对外交付物**而非内部元数据），
那 (a) 更合适——因为那种情况下"骨架先上线"会产生一份对外可见的半成品目录，代价不在技术侧。
**这一条需要仓主确认口径**，我按内部工程口径推荐 (b)。

---

## 10. 三件地基的排期与前置关系

### 10.1 G1 · executor 并行边 —— 必须排在 **M2 之后**、M3 之前

- **与 M0/1/2 完全不依赖**：迁移不改执行语义，串行照旧。
- **⛔ 且必须不与 M1 同期**：M1 的验收是**字节相等**。若在对照期间动 `apps/agentcore/src/workflow/executor.ts:104` 的执行次序，
  两个变量同时动 —— 字节不等时**分不清是谁干的**。这是最典型的自毁对照组。
- **是 M3 序 6（Reasoning Graph 条件分支/汇流）的地基**：没有并行/汇流能力，Reasoning Graph 只能表达线性图，等于没做。
- **⚠ 真互斥（须点名）**：Track B1（Coordinator 角色并行扇出）落在**同一个文件同一段**。
  两单若并行推进会撞同一处改法 → **必须串行化，或一个 dev 整单做两者**。

### 10.2 G2 · 规则 DSL 定去留 —— 必须先于 **M3 的任何"规则维"扩展**

- **M0**：不受影响。`references[kind=rule]` 导出的是 **rule key**，不是 expression。
- **M1/2**：不受影响。plan 的 `evaluate_rules` 步语义原样搬运。
- **M3**：一旦 Skill 开始声明"这类题的阈值口径 / 规则 params 覆写"，就**直接踩上 `G-C08-EXPR-PARAM-SPLIT`**——
  Skill 里写的 param 会**静默恒假**（机制见 §1.5），而且**比今天更糟**：
  今天只是 `rule.params` 无人读（一处诱饵），之后会变成"Skill 声明了、规则引擎读不到、四包测试全绿"（两处诱饵 + 假绿）。
- **给决策的判据（不是本 PRD 定案）**：
  - **DSL 留，不引第二套语法**（SPEC §5 已定：Skill 只列 rule key，规则本体与语法保持 `apps/datacore/src/ruledsl.ts` 唯一权威）；
  - 但必须补 `params.<name>` 为一等 operand kind（`ruledsl.ts:26` 的 `Operand` 联合加 `{kind:"param"}`）；
  - **并加一道解析期门**：expression 里出现的标识符若既不是已发布对象类型的属性路径、也不是已声明 param → **解析期报错**。
    把"静默恒假"改成"发布期红"。**这道门才是 G2 的真交付物**——只加个 operand kind 而不加门，
    下一个拼错字段名的人照样静默恒假。

### 10.3 G3 · 命名定死 —— 必须先于 **M0 开工**（成本最低点）

M0 一次生成 32 份声明。名字定错 = 32 份全返工；且影子一旦有消费方（DRIL / 资源目录）就更贵。
**要定的名（我的建议，请仓主裁决）**：

| 名 | 建议 | 理由 |
|---|---|---|
| `execution` / `execution.mode` / `execution.plan` / `execution.body` | **采用**（同 Track E 表述） | 与已定案措辞一致 |
| `businessIntent` | **采用** | SPEC §1-② 原词 |
| 引用清单字段名 | ✅ **仓主已裁决（2026-08-03）：采纳 `requires`，本偏离不成立** —— 运行时唯一真源为 `skill.requires{...}`（contract PRD §4.5 形状，含 `required`/`minStatus`/`properties[]`）；`references[]`/`dependsOn[]` **降为解析期输入别名**，读入即归一折进 `requires`，不作为运行时字段存在（故存量 7 个 Skill 与两处读取点无需大爆炸迁移）。裁决理由见 `docs/SPEC-industrial-skill.md` §9.1 与 `docs/PRD-skill-crossreview.md` C1：`FeatureDef.requires` 是**另一个对象的字段**、非顶层导出撞车（与 `ExecutionPlanSchema` 那次性质不同，先例不适用）；且扁平 `references[]` **表达不了** 「Factory 必须有 capacity 属性」这类契约式需求 —— 照原提案，定案 1 的语义落不了地。<br><s>原提案（存档）：保留契约现名 `references[]` / `dependsOn[]`，不改叫 `requires`</s> | SPEC §7 定案 1 的**语义**（声明需求、不定义、装载期校验、不满足拒装）**全盘采纳**；但 `requires` 这个**词**在本仓已被 `FeatureDef.requires`（entitlement 依赖级联，`apps/agentcore/src/features/registry.ts`）占用。再用一次 = 同名不同义的第三套词表，正是 `G-SIDEEFFECT-VOCAB-SPLIT` 那一族的病（同一概念三套互不相识的词表 → 判定分支永不触发，测试照样绿）。**定案要的是语义不是词**。SPEC §6 包结构里的 `ontology/requires.yaml` 等**文件名**不受影响——文件名与运行时契约字段名是两回事 |
| Skill key | **`skill.key === intent.key`**（不另起命名空间） | 任何"意图 key ↔ skill key"映射表都是第三处真源 |
| 探索 Skill key | 前缀 `explore.`（如 `explore.cross_base_compare` / `explore.default` 兜底） | Track E 说"未命中意图也单设一个探索 Skill"，但硬约束④要"跨基地对比给 6 轮、单点归因给 3 轮" → **必然多于一个**。基数目标 `\|Skill\| ≥ \|意图\|` 由 32 + N(explore) + M(dependsOn 子能力) 满足 |
| 暗发 flag | `qos.skill-execution-authority`（BLOCK 级 · `defaultOn:false` · 双注册 datacore `features.ts` + agentcore `features/registry.ts`） | 沿用既有暗发纪律 |

### 10.4 排期结论一句话

- **必须先于 M0**：G3。
- **必须先于 M3**：G1（若含条件分支/汇流）、G2（若含规则维）。
- **必须不与 M1 同期**：G1（污染对照组）。
- G2 与 M0/1/2 **可完全并行**（不同文件、不同系统：G2 在 `apps/datacore`，迁移在 `apps/agentcore`）。

---

## 11. 风险登记（含本会话新发现的三条）

| # | 风险 | 严重度 | 证据 | 止损 |
|---|---|---|---|---|
| **R-A** | **规范化器是 M1 的单点故障**：过松则门恒绿，过紧则门恒红 | 🔴 | `provId` 天然不稳定（`apps/agentcore/src/ids.ts:15-23`） | §6.3 三条自证 + §6.4 两条变异反证 |
| **R-B** | **多租户 Skill 播种缺口**（新发现，已登记为断点 `G-SKILL-TENANT-SEED-ASYMMETRY`）：`seedRegistry()` 无 `tenantId` 入参、7 个种子 skill 硬编码 `tenantId: SEED_TENANT`，只在 `apps/agentcore/src/main.ts:29` 为 demo 播种；而意图/计划有任意租户懒播种（`apps/agentcore/src/server.ts:1966` → `seed.ts:641`）。**翻转后非 demo 租户必然"有意图·无 Skill"**，且**单租户测试全绿测不出来** | 🔴 | 见左 | M2 硬前置：`seedRegistry` 接 `tenantId` 并接进 `ensureScenarioPackageSeed`；门必须含非 demo 租户用例 |
| **R-C** | **六个 Plan 写入方**（新发现，原路线骨架只点了两个）：目录 REST / 出厂播种 / `internal/scaffold` / `growth/scaffold` / `ops/fallback` / 冒烟脚本 | 🟠 | §7.2 逐条 file:line | `skill-single-source:check` 静态断言 2（禁 `repos.plans.insert(`） |
| **R-D** | **键空间收窄**：Skill 是 tenant 级、Plan 是 package 级；翻转把"取第一个包"的隐含假设升级成键唯一性要求 | 🟠 | `server.ts:2021/2245/2516` 的 `listByTenant(…)[0]` | §7.3：启动期显式断言，不满足则拒绝启用翻转 flag |
| **R-E** | **`requires` 词表冲突** | 🟠 | `FeatureDef.requires` 已占用（`features/registry.ts`） | §10.3 定名 |
| **R-F** | ~~**17/32**~~ **5/32** `inputSchema` 是空壳（⚠️ 2026-08-09 实测订正 drift-d），不标注会被当成"这题不需要输入" | 🟡 | §1.2 边界 1 | 导出打标 `x-derived: "empty-slots"` |
| **R-G** | **G1 与 Track B1 撞同一段** `executor.ts:104` | 🟡 | §10.1 | 串行化或一 dev 整单 |
| **R-H** | **删 `plan-create` 按钮 = 重新挖开 G-4** | 🟡 | 本体 §8 G-4 | §7.2：必须同时给 Skill 侧等价入口 |

---

## 12. 交付物 / WO 拆分 / 金值

### 12.1 WO 拆分（每张一条 handoff 分支，🚦范围边界必须写在 WO 顶部）

| WO | 内容 | 范围边界（只碰这些） | 依赖 |
|---|---|---|---|
| **WO-SKILL-MIG-G3** | 命名定案回写（契约字段名 + 本体 §2.H 措辞） | `packages/contracts/src/agentcore.ts` · `docs/SYSTEM-ONTOLOGY.md` | 仓主裁决 §10.3 |
| **WO-SKILL-MIG-P0** | 导出器 + 三道 M0 门 | 新建 apps/agentcore/src/mocks/skill-export.ts · `apps/agentcore/src/mocks/seed.ts` · apps/agentcore/test/ 下新增用例 · 新建 scripts/check-skill-export.mjs、scripts/check-skill-ref-closure.mjs、scripts/check-skill-business-intent.mjs | G3 |
| **WO-SKILL-MIG-P1** | 一致性门（**数据侧 + 引擎侧同一 dev 整单**——判据 2 与判据 3 分开做必然出现"新路悄悄回落"却测不出来） | `apps/agentcore/src/router/orchestrator.ts`(仅加解析分支+flag) · `apps/agentcore/src/catalog/service.ts` · 新建 apps/agentcore/test/skill-plan-parity.seam.test.ts · `apps/datacore/test/xservice-smoke.test.ts`(补 2 条) | P0 |
| **WO-SKILL-MIG-P2** | 权威翻转 + 六写入方收口 + 双源门 + entitlement 一处 + 多租户播种（**跨 A/B 与前后端两半，必须一 dev 整单**） | §7.1/§7.2 全清单 · 前端三处 · 新建 scripts/check-skill-single-source.mjs | P1 |
| **WO-SKILL-MIG-P3-x** | M3 逐项（每项一张 WO，一项一个效果层门） | 按项定 | P2（+ G1/G2 按 §10） |

### 12.2 金值 / 注册即更（LOOP 纪律 ④ · 漏一处即退）

- `pnpm gates` 聚合计数：~~**16 → 23**（`package.json:29` 当前 16 条~~ → **⚠️ 2026-08-09 实测：当前 26 条 ⇒ 应为 26 → 33**（drift-a/b，见文末《基数订正总表》）；七道新门见 §0）。每加一门须同步 §7 本体登记，否则 `ontology-writeback:check` 红。
- 本体回写：§2.H（`ExecutionPlan` 降为字段）· §3（编排链那一跳的解析源）· §7（四道新门）· §8（两条新断点 + G-1/G-4/G-9 的描述随之改）。
- 计数金值：M2 后 `plans` 32 → 0（播种侧）、`skills` 7 → 39+（7 既有 + 32 迁移）。
  `docs/SPEC-industrial-skill.md` §4 的「7 个 Skill 实测表」必须同步更新，否则那张表立刻过期。
- 场景相关金值（20）**不变**——`SCENARIO_CATALOG.length` 派生的断言（如 `apps/agentcore/test/scenarios-wiring.test.ts:24`）不受影响。

### 12.3 复验判据（审核方头号依据）

1. **SEAM-GATE**：M1 的门本身就是接缝门（数据侧影子声明 × 引擎侧解析源）。**判据 2 与判据 3 必须在同一条测试里**——拆开就是"各半绿"。
2. **变异反证**：§6.4 的 M1/M2 必须当场跑给复验方看，且先证 `tsc --noEmit` RC=0（否则红是编译红）。
3. **四包全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest）。
4. **门显式捕获退出码**：一律走 `bash scripts/gate.sh`；失败须打印 `error TS|FAIL|AssertionError` 原文，**禁止** `cmd | tail -n` 把错误挤掉。
5. **亲手真跑**：翻转后至少手动跑通 3 条场景卡（建议 S01 产能可承接 / S02 受影响订单 / S06 处置采纳——分别覆盖多步 plan、表格渲染、`create_action_draft` 三种形态），确认答案与翻转前**肉眼一致**。绿测试 ≠ 能用。

---

## 13. 诚实边界（本文哪些是核实的、哪些不是）

**已核实（本会话静态读码，逐条给了 file:line，可复跑 `grep`/`sed` 复核）**
- §1.1 全部基数与绑定事实；§1.2 自动导出的来源表；§1.4 三个零消费方；§1.5 三件地基现状；
- §7.1 十个读取点、§7.2 六个写入方（全部逐条定位到 file:line）；
- `pnpm gates` 当前聚合 ~~16~~ **26** 条（⚠️ 2026-08-09 实测订正 drift-a；`package.json` 的 `gates` 脚本，行号已漂，别写死行号——用下面这条命令现算）；
- `provId` 不可字节稳定的机制链（`executor.ts` → `ids.ts`）；
- `ruledsl.ts` 的 `params` 静默恒假机制链（`Operand` 联合 → `resolveField` → `compare` 早退）；
- R-B 多租户 Skill 播种缺口（`seedRegistry` 签名 + `main.ts:29` + `server.ts:1966` 三处对照）。

**未核实（不许当成事实用）**
- **本文一个测试、一个 gate 都没有跑**（本单纪律：只读代码、只写文档）。所有"今天是 X"均为**静态读码**结论，非运行时实测。
- ~~17/32 `inputSchema` 空壳的计数是**静态推算**（5 显式 + 11 CEO 中 10 条有槽 → 15 有槽；32−15=17），未跑 `seedIntentsAndPlans()` 实测。~~
  → **✅ 2026-08-09 已实测（`WO-DOCFIX-SKILL-CLAIMS`）：真跑 `seedIntentsAndPlans("demo")` 得 **5/32**（不是 17）。**
  推算之所以错，是因为它的前提「`SCENARIO_CATALOG` 派生的 16 条一律 `slots: []`」已被 `WO-DERIVED-INTENT-SLOT-DEAF` 修掉
  （`apps/agentcore/src/mocks/seed.ts:634/666` 改为 `deriveIntentSlots`）。详见 §1.2 边界 1 的就地订正。
  **本条自身即是「诚实标注救了自己」的正面样例**：正因为原文老实写了「这是推算不是实测」，
  复验时才知道该去实测哪一条。**如果当初写成"实测 17/32"，今天没有人会去重跑。**
- 本体 §7 声称"已并入 `pnpm gates`"的 `sim:check` / `propagation:check` / `sim-readiness:check` / `solver-license:check` / `opt-template:check` / `opt-determinism:check` **在本分支 `package.json` 中无对应 script**（`package.json:9-38` 全文核对）。这是本体与 package.json 的一处漂移，**原因未核实**（可能在别的分支、可能是本体过期）。§12.2 的"16 → 23"以 `package.json` 实测为准。
- 部署库（PG）里已有的 `plans`/`skills` 真实数据分布未核实——本会话无法访问部署库。§7.6"不删表"的建议部分基于这个不确定性。
- 真 DataCore（非 mock）下 32 条 plan 是否全部能跑通、跑通后的答案形态，未核实。M1 §6.5 边界 1 正是为此留的口子。
- Track A/B/C/D 各期的落地状态未核实（本文只引用 WO 文本，未验证其"已完成"章节的当前真伪）。

---

## 附 · 2026-08-09 基数订正总表（`WO-DOCFIX-SKILL-CLAIMS`）

> 依据 `docs/CHECK-MIG-XR.md` §5 附表。**这些数今天全部进不了任何门，靠人读 —— 读一次错一次。**
> 每条都给了**可复跑命令**；命令跑出来的数与本表不符时，**以命令为准并回来改本表**。

| # | 出处 | 文档原写 | 2026-08-09 实测 | 复跑命令 |
|---|---|---:|---:|---|
| **drift-a** | §0 触及门禁 · §12.2 · §13 | `pnpm gates` = **16** 道 | **26** 道 | `node -e 'console.log(require("./package.json").scripts.gates.split("&&").length)'` |
| **drift-b** | §0 · §12.2 | 迁移后聚合 **16 → 23** | **26 → 33** | 同上 + 本文 §0 的七道新门 |
| **drift-d** | §1.2 · §5.3 · §11 R-F · §13 | `inputSchema` 空壳 **17/32** | **5/32**（`plan_recommend` · `inventory_opt` · `maint_stagger` · `sop_status` · `ceo_finance_pnl`） | 真跑 `seedIntentsAndPlans("demo")`，见 §1.2 边界 1 |
| **drift-e** | §0 CLI 段 | `OPERATION_CATALOG` **17 条**、`plan` 命中 **0** | **39 条**、`plan` 命中 **1**（`op:"build"` 的 **BuildPlan**，非 `ExecutionPlan` ⇒ **结论仍成立**） | 见 §0 CLI 段的就地订正 |
| **drift-f** | 跨文档行数表（`PRD-skill-crossreview.md`） | migration **534** 行 · runtime **720** 行 | **545** · **725**（其余三份 643/741/722 全对） | `wc -l docs/PRD-skill-*.md` |

**另有两条不在本表、但同批复验出来的（已在正文就地标注）**：
- §1.4 第三行「非-skill 引用不校验存在性」—— **已部分闭合**（solver/rule/ontologyType 三种已守，四种仍裸奔）；
- §1.5 G2「`expression` 不能引用 `params` 且静默恒假」—— **已被 `WO-RULE-EXPR-PARAMS` 修掉**（剩 `kind:"field"` 拼错那一支）。

### 为什么这些数会一起漂 —— 一条值得写进流程的判据

**写死在正文里的计数，保质期等于写下它的那一天。**
`drift-a/b/e` 三条的共同形态是：**引用了一个会长的东西（门数 / 目录条数），却把当时的快照写成了常数**；
`drift-d` 的形态是**把静态推算当成了运行时事实**（而它的输入前提被上游改掉了，推算却不会自己失效）。

**机制（不是"下次注意"）**：
1. **能现算就别写死** —— 本仓 `scripts/check-gate-ledger.mjs` 已是正面样例（数字由门自己普查，不许固化自证）；
   `scripts/gate.sh` 里 `GATES_N` 也是现算的，其注释写着「这行标签曾长期写着 13 条，而实际已涨到 15」。
2. **必须写死时，同一行给出复跑命令**（本表每行都给了）——没有命令的数字等于没有保质期。
3. **凡自称"实测"的数字，必须带日期**（本仓已有机械门：`node scripts/check-stale-claims.mjs`，
   本体 §8 `G-STALE-MEASURED-CLAIM`）。
