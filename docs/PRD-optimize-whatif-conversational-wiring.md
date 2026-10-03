# PRD · 把 `optimize_whatif` 求解器接入人机对话（QOS）链路

> 状态：交付级 PRD（4 步接缝闭合 · 一个跨半特性 → 一张 WO 一个 dev 整单）
> 前置阅读：已完整阅读 `docs/SYSTEM-ONTOLOGY.md`（本体单一来源）；对齐 `docs/PRD-query-orchestration-service.md`（QOS 规格）与 `docs/PRD-multi-intent-L2-L3-coupled-solving.md`（多意图/耦合联合求解，见 §9 关系说明）。
> 命名红线：全文禁用外部产品名，一律用平台自有术语（优化融合域 / 优化目标级 what-if / 路径A / 路径B / 人机对话 / QOS）。
>
> **一句话**：CP-SAT 可证最优的 `optimize_whatif`（优化目标级 what-if）已注册、可跑，但**只有前端「优化推演」页能触达**，人机对话（对话坞/CEO 深问/块级深问）**根本调不到它**——三处接缝断裂让它落进「推演/假设」死角。本 PRD 定义把它接进 QOS 的四步修法，头号判据是**一条端到端接缝测**（人机对话问句 → optimize_whatif → 非空 Δ目标 + 决策切换）。

---

## 1. 背景与问题（含 file:line 现状证据）

### 1.1 现状：能力已在，链路半通

`optimize_whatif`（优化目标级 what-if：改一约束/系数 → CP-SAT 重解 → Δ目标值 + 可行性 + 冲突约束 IIS）是**已注册、可运行**的求解器：

- 注册：`apps/datacore/src/solvers/service.ts:121`（并入 `SOLVER_KEYS`）。
- 输出形状：`apps/datacore/src/solvers/service.ts:240` `SOLVER_OUTPUT_SHAPES.optimize_whatif = ["baselineObjective","perturbedObjective","deltaObjective","deltaByObjective","feasible","conflictConstraints","explanation","baselineSolution","perturbedSolution","summary"]`（**`baselineSolution`/`perturbedSolution` 是新加的「决策比对」透传字段**——让用户看到"改一个参数最优决策怎么切换"，而非只有一个 Δ 数字）。
- 引擎：`apps/datacore/src/solvers/opt-whatif.ts`（`runOptimizeWhatif` :141；DF.8 接地 `resolveTarget` :66；决策方案透传 `solutionOf` :37；扰动施加 `applyOne` :86）。
- invoke 拦截：`apps/datacore/src/solvers/service.ts:3714`（`optimize_whatif` → 私有方法 `optimizeWhatif` :3206，接受 `{family, perturbations, args | binding, seed}`，走 sidecar 重解，FUS1 不进 A18 沙箱）。
- entitlement：`apps/datacore/src/features.ts:92` `opt.whatif`（BLOCK，`defaultOn:false`，requires `opt.solver-pool`，binding `solverKeys:["optimize_whatif"]`）；`/a/v1/solvers/optimize_whatif/invoke` 经 `app.ts:2611 requireFeatureTag("solverKeys", solverKey)` → **关则 404 `FEATURE_NOT_FOUND`（R3）**。

**唯一触达入口**：前端「优化推演」页（`OptimizeWhatifView`，renderer `optimize-whatif`，route `/v/optimize-whatif`，驾驶舱入口 `dash-optimize-go`），发 `POST /a/v1/solvers/optimize_whatif/invoke`（WO-OPTIMIZE-WHATIF-FE，见本体 §8 G-12 行）。

### 1.2 问题：人机对话触达不到（三处接缝断裂）

本体 §3 优化融合链路（`docs/SYSTEM-ONTOLOGY.md:495-511`）声称链路是 `NL --comprehend⊕embedding--> OntologyBinding --> optimize_whatif 扰动重解 --> Δ目标 --R4--> 采纳`。**但 NL（人机对话）到 optimize_whatif 这一段根本没接线**——三处接缝断点：

**断点 1 · agent 看不见它（G-AGENT-BLIND-REACT 的残留）。**
路径B agent 的「本题导航图」求解器目录 `SOLVER_CATALOG`（`apps/agentcore/src/agent/navigation-slice.ts:71-180`）**不含 `optimize_whatif`**。域族键 `DomainFamilyKey`（:35-48）里的 `"whatif"` 族信号（:64 `/(扩\d通道|加\d夜班|加班|加\d%|外包\d+|降\d+%|如果.*会怎样|假设)/`）只映射到 `generic_inference`（:132-137，结构化杠杆前向重算）——**不是** CP-SAT 的 `optimize_whatif`。于是即便题落到路径B，agent 首轮导航图里**根本没有这个求解器**，无从选型。

**断点 2 · 路由把它压进路径B（RE_OPEN 抑制）。**
`apps/agentcore/src/router/domain-resolver.ts:25` `RE_OPEN = /(如果|假设|情景|推演|沙盘|会不会|怎么会|权衡|取舍|万一|要是)/`；命中 → `scoreFor` 里 `signals.open` 为真 → `:79 s -= 0.6` → 置信被强压到 `DETERMINISTIC_PREFERENCE_THRESHOLD=0.6`（:146）之下 → orchestrator（`orchestrator.ts:536-538`）不拉回路径A、照落路径B。而路径B agent 又因断点 1 看不见 optimize_whatif → **死角**：既进不了路径A直调，路径B又选不到它。
> 注：文件里已有先例 `:136 if (route === "generic_inference" || route === "capacity_forecast") signals.open = false;`——即"已被明确杠杆捕获的结构化 what-if 不该再被 RE_OPEN 压低"。**optimize_whatif 缺的正是这一句同类白名单**。

**断点 3 · 无「本体数据 → 基线 args」装配器。**
即便 agent 想调它，也得自己造出完整的 `{family, args, perturbations}`——一个**完整的 CP-SAT 基线模型**（如 `facility_location`：facilities + clients + assignCosts 及其成本）加一条 DF.8 接地的扰动。现有绑定机制 `bindToSolverArgs`（`apps/datacore/src/solvers/opt-binding.ts:106`）+ `OntologyBinding`（`packages/contracts/src/opt-template.ts:71`）**只服务批处理路**：它吃一个**已经构造好的 `OntologyBinding`**（role→objectType/property 映射），并读**全量**对象（`view.listByType`）。**没有**任何装配器能从「人机对话里选中/推断出的 基地/订单/型号 + 解析出的槽位 + NL 里的"改哪个参数到多少"」组装出基线 args + 扰动。对比 `capacity_forecast`/`atp_check`——它们声明 `reads` 对象类型、直接吃数据，无需调用方先造模型。

**分类**：这是经典「绿测试≠能用·断在接缝」——两半（前端优化推演页 + DataCore 引擎）各自绿，但人机对话这条链路从没接通。属**优化融合域 G-12** 的人机对话残口。

---

## 2. 目标与非目标

### 2.1 目标（本期范围）

- **G1 · 路由可达**：结构化的优化 what-if 问句（明确点名一个决策 + 一个参数改动，如「如果 f1 开设成本涨到 150，最优选址怎么变」）能确定性路由到路径A直调 `optimize_whatif`，秒级出 Δ目标 + 决策比对。
- **G2 · agent 可见**：路径B agent 的本题导航图包含 `optimize_whatif`（能力句 + 输出形状镜像 + 读取对象类型），即便题走路径B兜底也能选到它。
- **G3 · 本体数据 → 基线装配**：有一层确定性装配器，从选中/推断的 基地/订单/型号 + 槽位 + NL 扰动，组装出 `facility_location`（及适用时 `min_cost_flow`）基线 + DF.8 接地的 `OptPerturbation`——**复用** `OntologyBinding`/`bindToSolverArgs`/`resolveFieldRoles`/DF.8 `groundBinding`，不新造引擎。
- **G4 · 接缝守门**：一条端到端接缝测（SEAM-GATE）驱动全链，断言合并态行为（非空 Δ + 决策切换），作为头号验收判据。
- **暗发可回退**：全部改动经**暗发开关 `defaultOn:false`**，关闭时既有行为逐字节不变（R16 additive · RL2 · RL9）。

### 2.2 非目标（范围外）

- ❌ **不新造求解器、不改 CP-SAT 数学**——只做「人机对话查询 → 既有 optimize_whatif」的路由 + 装配层。`optimize_whatif` 已在 `SOLVER_KEYS`，**金值求解器计数不变**。
- ❌ **不做耦合多域联合求解**——「良率↓→转拨→延误→外协」这类耦合链是 L3 的领地（映射到 `portfolio_optimize` 守恒引擎，见 §9）；本 PRD 只接**单一决策**的优化 what-if。
- ❌ **不做 embedding 语义检索选型**（FUS2 advisory，非确定性路径）；本期选型走确定性关键词 + 结构信号（R6）。
- ❌ **不改 optimize_whatif 的 entitlement 语义**——`opt.whatif`（BLOCK）保持 defaultOn:false；本期新增的对话侧开关独立叠加（§8）。
- ❌ **不新增 §8.2 SSE 事件名**——复用 `step.completed` 伪 step（路径B）/ 正常路径A step 事件，保 `ontology:check` 事件计数不漂。
- ❌ **不做 binding 模式全 family 表单化前端**（那是 G-12 前端残口的后续单）；本期聚焦人机对话链路。

---

## 3. 《本体引用与影响》（强制 · 已读 `docs/SYSTEM-ONTOLOGY.md`）

### 3.1 触及对象类型

| 对象类型 | 本体位置 | 本 PRD 关系 |
|---|---|---|
| `Solver`（`optimize_whatif`） | §2.E / §2.J | 复用（已注册，不新增）；接入人机对话触达面 |
| `OptModelTemplate` | §2.J | 引用 family（`facility_location`/`min_cost_flow`）作基线族 |
| `OntologyBinding` | §2.J · `contracts/opt-template.ts:71` | **复用** role→本体类型/属性绑定 + DF.8 接地作装配落点 |
| `OptPerturbation` | §2.J · `contracts/opt-template.ts:84` | 装配器从 NL 抽「改哪个参数到多少」→ 结构化扰动 |
| `OptWhatifResult` | §2.J · `contracts/opt-template.ts:92` | 消费输出（Δ + `baselineSolution`/`perturbedSolution` 决策比对） |
| `Base` / `Order` / `Model` / `DemandSegment` | §2.B | 基线数据来源（facility/client/需求系数）；R2 只读本租户 |
| `SessionContext` / `PageContext` | §2.H · `contracts/qos.ts:201` | 装配器输入（`selectedObjects` 最多 10 · `presetSlots` · focus/block） |
| `NavigationSlice` | §2.H · `agent/navigation-slice.ts` | 步①加 `optimize_whatif` 目录条目（agent 可见） |
| `Intent` / `ExecutionPlan` / `Task`/`Query` | §2.H | 路径A绑定意图/计划；QOS 任务 SSE 流 |
| `FeatureConfig`（`opt.whatif` + 新对话开关） | §2.G · `features.ts:92` | R3 entitlement 先于 authz；新增暗发开关 defaultOn:false |

### 3.2 触及链路

- **优化融合链路**（§3 · `SYSTEM-ONTOLOGY.md:495-511`）：`NL → OntologyBinding → optimize_whatif 扰动重解 → Δ目标 → R4 采纳`。本 PRD **接通其 NL 入口段**（此前断裂）。
- **QOS 问句→答案链路**（切片 `sys.orch.query_to_answer`）：分类 → 路径A工作流 / 路径B Agent → SSE（`PRD-query-orchestration-service.md` §3/§5）。
- **确定性优先门路由链**（G-AGENT-BLIND-REACT 已闭部分）：`domainResolve → preferDeterministicSolver → tryDeterministicBind → 路径A invoke_solver`（`domain-resolver.ts:88/163` + `orchestrator.ts:536-538`）。本 PRD 在此链上加 optimize_whatif 分支。
- **优化采纳链路**（下游·已在）：`OptWhatifResult → R13 解释 → R4 采纳（ActionDraft 走正门）`——模拟态禁写真值（RL4）。

### 3.3 触及事件（一字不差 · 复用不新增）

QOS §8.2 SSE 事件（`PRD-query-orchestration-service.md` §8.2，verbatim）：`step.started` · `step.completed`（路径B工具调用映射为伪 step，stepId=toolCallId）· `answer.final` · `clarification.required` · `task.failed` · `task.cancelled`。
**本 PRD 不新增任何 §8.2 事件名**（保 `ontology:check` 事件计数不漂，同 WO-REASONING-TRACE / WO-DETERMINISTIC-CROSS-DOMAIN 纪律）。`classification.model` 拟新增字段值 `deterministic:opt-whatif`（**字段值非事件名**，不计入事件闭包）。

### 3.4 触及不变量（R1–R18）

- **R2 tenant_id everywhere**：`OntologyBinding.tenantId === ctx.tenantId`（`service.ts:3218` 已硬校验）；`view.listByType` 只读本租户；AgentCore 经 OBO 透传用户 JWT → DataCore A6 行级过滤。
- **R3 entitlement 先于 authz**：`opt.whatif`（BLOCK，defaultOn:false）关 → invoke 404；对话侧新开关关 → 路由不激活（既有行为不变）。
- **R4 真值写入经 Action 审批**：what-if 走 `recompute(dryRun)` 克隆图**不落真值**（RL4）；采纳才经 ActionDraft 正门。
- **R6 确定性**：装配器 + 扰动解析纯函数（稳定排序 `.sort` by id、正则抽数、无 `Date.now`/随机）；CP-SAT seed+单线程（`opt-determinism:check` 守）；同问句同选中同本体 → 字节一致。
- **R13 结论可溯源**：Δ + `baselineSolution`/`perturbedSolution` + provenance；解释「新解 vs 原解」。
- **R14 应用层无业务常数（行业无关）**：role→对象类型映射**不硬编码「Base→facility」**，经 A13 `resolveFieldRoles`（结构信号 + 配置词库）推断；系数取绑定的类型化字段（可选 `coeffSource=rule_params`）。
- **R1 contracts-only-shared**：navigation-slice 的 `outputShape` 是 DataCore `SOLVER_OUTPUT_SHAPES` 的**只读投影/镜像**（非跨包共享实现，权威在 A 侧）。
- **R16 发育闭环 / RL2 暗发 / RL9 可回退**：全暗发 additive。
- **DF.8 接地**：`groundBinding`（`opt-binding.ts:52`）校验绑定类型/属性存在于已发布本体；`resolveTarget`（`opt-whatif.ts:66`）校验扰动 target 可寻址；缺失 → 诚实报缺（仿 `bindCrossObjectOccupancy` 的 `contractBound:false`/`eligibilityDefaulted`），**绝不凭空造实体**。

### 3.5 触及断点（G-*）—— 精确引用

| G-code | 本体位置 | 状态 | 与本 PRD 关系 |
|---|---|---|---|
| **G-12 优化融合域** | §2.J · §3(495-511) · §7 · §8(`SYSTEM-ONTOLOGY.md:804-805`) | ◐ | **本 PRD 主战场**。§8 G-12 行明列前端半已补（WO-OPTIMIZE-WHATIF-FE），**残口 = "binding 模式全 family 表单化 + demo 租户 opt.* 暗发开门列后续单"**；且链路列写着 `NL→…→optimize_whatif` 但 NL 段从未接线 = 本 PRD 要闭的对话残口 |
| **G-WHATIF-HARDCODED-LEVERS** | §8(`SYSTEM-ONTOLOGY.md:799`) | ✅ 已收 | **兄弟接缝**（区分引擎）：它是把项目推演⑥杠杆从焊死迁到 `generic_inference`（前向重算），**正因它，navigation-slice 的 "whatif" 族才映到 generic_inference**（:132-137）。optimize_whatif 是**另一台引擎**（CP-SAT 重解 vs 前向重算），从未接进 NL |
| **G-AGENT-BLIND-REACT** | §2.H · §8(`SYSTEM-ONTOLOGY.md:834`) | ✅（对当前目录内 solver）全闭 | 断点 1 是它的**残留**：其"agent 侧半"只覆盖 `SOLVER_CATALOG` 里的 solver，而 optimize_whatif 不在目录 → 对它 agent 仍盲。步①把它补进目录 |

**拟新增断点子码**：`G-WHATIF-NL-UNREACHABLE`（人机对话无法触达 optimize_whatif · 归 G-12 族）。回写时二选一（§7）：新增该子码行，或直接在 G-12 行的「残口」追加并标闭合。

---

## 4. 详细设计（4 步 · 每步含 file 级改动点 + 契约/事件影响）

> 总原则：四步是**一个跨「数据装配半 + 路由/引擎半」的特性**，按铁律必须**一个 dev 整单做**（§10）。步①②③④分述便于验收，非拆给不同 dev。

### 步① · navigation-slice 加 `optimize_whatif` 能力条目（闭断点 1）

**改动点**：`apps/agentcore/src/agent/navigation-slice.ts`

1. `DomainFamilyKey`（:35-48）新增族键 `"opt_whatif"`（与既有 `"whatif"` **区分**——后者归 generic_inference 杠杆，前者归 CP-SAT 优化重解）。
2. `FAMILY_SIGNALS`（:51-65）追加一条 `opt_whatif` 信号：命中「优化决策族关键词」∩「参数改动信号」——如 `/(选址|设施|开设|布点|最优选址|最优指派|指派|覆盖|集合覆盖|独立集|竞价|调拨网络|运输网络|流量)/` 且含 `/(涨到|降到|设为|改到|提高到|下调到|=\s*\d|到\s*\d)/`。**结构化高精度**（决策族 + 目标值双命中才拉入图）。
3. `SOLVER_CATALOG`（:71-180）新增条目 `optimize_whatif`：
   - `capability`：「优化目标级 what-if：改一约束/系数 → CP-SAT 重解 → Δ目标 + 可行性 + 冲突约束 + 决策方案切换（开哪些设施/怎么指派怎么变）」。
   - `outputShape`：**镜像** `SOLVER_OUTPUT_SHAPES.optimize_whatif`（`service.ts:240`）= `["baselineObjective","perturbedObjective","deltaObjective","deltaByObjective","feasible","conflictConstraints","explanation","baselineSolution","perturbedSolution","summary"]`（含新加的 `baselineSolution`/`perturbedSolution`）。
   - `reads`：`["Base","Order","Model","DemandSegment"]`（facility_location 基线常见来源；均已在 `OBJECT_KEY_PROPS` :183-209）。
   - `families`：`["opt_whatif"]`。
4. `SOLVER_RULE_HINTS`（:211-220）可选加一句：「what-if 为模拟态·不落真值（RL4）；采纳走 ActionDraft 正门（R4）」。

**契约/事件影响**：无契约变更；`outputShape` 为投影（R1）。加**镜像漂移守护**：单测断言 `SOLVER_CATALOG.optimize_whatif.outputShape` 与 A 侧 `SOLVER_OUTPUT_SHAPES.optimize_whatif` 逐项一致（A 侧权威，漂移即红）。

**子验收**：
- 对结构化优化 what-if 问句（+ 含 Base 的 scope）→ `projectNavigationSlice` 产出的图**含 `optimize_whatif`**，outputShape 镜像正确。
- 对普通杠杆 what-if 问句（「加一个夜班产能少多少」）→ 图仍先出 `generic_inference`（**无回归**）。
- 空图不注入（字节兼容）。

### 步② · 「本体数据 → optimize_whatif 基线 args」装配器（闭断点 3）

**定位**：一个跨半装配器（**逻辑上一个单元，实现跨接缝，一个 dev 整单**）。

**AgentCore 半**（新模块 `apps/agentcore/src/router/opt-whatif-route.ts` · R6 纯函数）——负责**意图识别 + family 选择 + 扰动抽取 + 选中→role 提示**：
- **输入**：NL query · `SessionContext`（`contracts/qos.ts:201`：`selectedObjects` ≤10、`presetSlots`、view/focus/block）· `presetContext`（`contracts/agentcore.ts:212`）· 已解析槽位（`fillSlots` 产物）。
- **family 选择**（确定性）：`选址/设施/开设/布点` → `facility_location`；`调拨网络/运输网络/流量/多源多汇` → `min_cost_flow`。
- **扰动抽取**（确定性）：从「改哪个参数到多少」抽 `OptPerturbation{kind,target,value}`。示例：「f1 开设成本涨到 150」→ `{kind:"data_override", target:"facilities.f1.openCost", value:150}`（target 语法对齐 `opt-whatif.ts:56-64` 的 `<collection>.<id>.<field>`）。`涨到/提高到`→`data_override` 增；`降到/放松`→`relax_constraint`；`容量收紧到`→`add_constraint`。
- **选中 → role 提示**：把 `selectedObjects` 的对象类型标注为候选 role（哪些是 facility/client），供 DataCore 半绑定推断（不硬编码类型名，仅传"选中了这些类型"）。
- **输出**：`{family, selection: ObjectRef[], perturbations: OptPerturbation[], roleHints?}` 或 `{applicable:false, reason}`（无 family/无扰动/无选中 → 诚实落回，不硬凑）。

**DataCore 半**（扩 `service.ts` 私有 `optimizeWhatif` :3206，**additive**）——负责**从选中装配基线 args**，复用既有机制：
- 新增 `assembleBaselineFromSelection(ctx, family, selection, roleHints)`：
  1. **role 推断**：复用 A13 `resolveFieldRoles`（`solvers/field-roles.ts`，结构信号 + 配置词库 · R6 · 零 LLM · 零业务常数 R14）把选中对象类型/属性映射到 family 要求的 role（facility/client/open_cost/capacity/demand…）——**不硬编码「Base→facility」**。
  2. **构造 `OntologyBinding`**：`{tenantId: ctx.tenantId, templateKey: family, roleBindings, scope(选中子图·复用 slice-planner), coeffSource:"property"}`。
  3. **DF.8 接地 + 装配**：调既有 `bindToSolverArgs`（`opt-binding.ts:106`）——内部 `groundBinding`（:52）校验绑定类型/属性存在于**已发布本体**（越界报错，不造实体），并按 id 稳定排序读对象（R6）装配出 `{facilities, clients, assignCosts, …}`。
  4. **选中范围收窄**：装配只纳入 selection 覆盖的对象（经 binding.scope 过滤；未选中 → 诚实取 family 所需最小子图或报"需选中决策对象"）。
- **诚实报缺**：某 role 的支撑属性不存在（如本体无 `openCost` 字段）→ 仿 `bindCrossObjectOccupancy`（:227）返回 `{applicable:false, missingRoles:[...]}`，orchestrator 据此落回路径B（agent 用步①的图接管）或出诚实缺口，**绝不伪造系数**。
- **invoke 入参扩展**（additive）：`optimizeWhatif` 除既有 `args.args`（直接给基线）/ `args.binding`（已建绑定）外，新增 `args.selection` + `args.autoBind:true` 分支 → 内部走 `assembleBaselineFromSelection`。旧两分支逐字节不变。

**确定性/隔离**：R6（稳定排序 + 纯抽取 + seed+单线程）；R2（binding.tenantId===ctx.tenantId 已校验 :3218；OBO → A6 行级过滤）。

**契约/事件影响**：`optimize_whatif` invoke body 增可选 `selection`/`autoBind`/`roleHints`（additive，向后兼容）；`OntologyBinding`/`OptPerturbation`/`OptWhatifResult` 契约**不改**。无新事件。

**子验收**：
- 选中 基地(Base)/订单(Order)/型号(Model) → `facility_location` 基线 `facilities/clients/assignCosts` 非空、系数取自真实本体属性。
- NL「开设成本涨到 150」→ 正确 `OptPerturbation`。
- DF.8：绑定/扰动指向本体外类型或属性 → `validationError`（不造实体）。
- R6：同输入两跑字节一致；R2：跨租户绑定 → 拒（`service.ts:3218`）。

### 步③ · domain-resolver 让结构化优化 what-if 走路径A（闭断点 2）

**改动点**：`apps/agentcore/src/router/domain-resolver.ts`（+ 路由映射复用 `ceo-route.ts`）

- **区分信号**（高精度，防误伤真开放）：新增确定性判定「结构化优化 what-if」= **命中优化决策族关键词**（同步①的 `opt_whatif` 决策词表）**且** **含可抽取的「目标参数 + 数值」**（`涨到/降到/设为/=/到 N`）**且**（选中优化决策对象 或 问句点名具体决策对象）。
- **路由**：命中 → `route = "optimize_whatif"`、`solverKey = "optimize_whatif"`、`args = {family, selection, autoBind:true, perturbations}`（由步②装配器填）。
- **清 open 惩罚**：镜像既有先例（:136）追加 `if (route === "optimize_whatif") signals.open = false;`——使它不再被 `RE_OPEN`（:25）经 `:79 s -= 0.6` 压到阈下。
- **置信**：`scoreFor` 基础 0.6（:74）+ 锚加成（选中/focus → +0.1..0.25）≥ 0.6 阈值（:146）→ orchestrator（:536-538）`tryDeterministicBind` 拉回路径A。
- **保留其余惩罚**：`RE_ORCHESTRATION`（:22 综合/连锁/传导/波及）`-0.6`（:78）与 `domainFamilies>=2`（:80）`-0.4` **不动**——耦合多域/需编排题仍落路径B或 L3（§9）。

**回归守护（regression-guard）**：
1. **双命中门**：仅「决策族关键词 + 目标值 + 决策对象」三者齐备才触发；纯 `如果…会怎样` / `情景/沙盘/权衡` 无命名决策 → open 惩罚**保留** → 照落路径B（fail-safe 铁律不破）。
2. **金标不回归**：扩 `test/fixtures/qos-20q-goldset.ts` 加结构化 optimize_whatif 正例，断言「误降级=0」性质仍成立（真开放题恒路径B）。
3. **暗发门**：新对话开关关闭时，本分支**不激活**，`domainResolve` 输出逐字节不变。
4. **优先级**：置于 L3 耦合检测**之后**（耦合链优先走 portfolio 守恒）、单域确定性门之内（与 generic_inference/capacity_forecast 同层）。

**契约/事件影响**：无契约变更；`classification.model` 出 `deterministic:opt-whatif`（字段值）。路径A照发 `step.started`/`step.completed`/`answer.final`。

**子验收**：
- 「如果 f1 开设成本涨到 150，最优选址怎么变」（+ 选中基地）→ 路径A，`solverKey=optimize_whatif`，置信 ≥0.6。
- 「如果市场变化未来会怎样」（真开放，无命名决策+值）→ **仍路径B**（route≠optimize_whatif）。
- 开关关 → `domainResolve` 输出字节不变。

### 步④ · 一条接缝测（SEAM-GATE · 头号判据）

**测试文件**：`apps/agentcore/test/optimize-whatif-conversational-seam.test.ts`（遵 `apps/agentcore/test/*-seam.test.ts` 约定，同 `qos-det-gate-seam` / `qos-cross-domain-seam` / `qos-agent-slice-seam`）。

**驱动**：经**真** `submitQuery → orchestrator.runPipeline`（非各半 unit），带 `SessionContext{ selectedObjects:[基地×N], … }`。

**问句**：`"如果 f1 的开设成本涨到 150，最优选址方案怎么变？"`

**期望路由**：路径A · `classification.model = "deterministic:opt-whatif"` · `solverKey = "optimize_whatif"`（经 OBO 真打 DataCore `/a/v1/solvers/optimize_whatif/invoke`，真 `bindToSolverArgs` 装配 + 真扰动重解）。

**断言（合并/集成态行为，非各半绿）**：
1. **非空 Δ目标**：`deltaObjective !== null`（且随扰动方向符号正确）。
2. **决策切换（头号）**：`baselineSolution ≠ perturbedSolution`——具体断言 `baselineSolution.openFacilities`（或 `assignments`）与 `perturbedSolution.openFacilities` **不同**（f1 成本抬高 → 最优选址翻到别的设施）。这是「数据装配 × 路由 × 引擎」三半驱动接缝的证据。
3. **对照回归**：真开放题「如果市场变化未来会怎样」→ **路径B**（route≠optimize_whatif）——证不误伤。
4. **暗发字节兼容**：开关关 → 同问句落路径B、无 optimize_whatif 路由。
5. **R6**：两跑字节一致。

**求解器真解口径**：头号断言（决策切换）必须跑在**真会重优化**的求解器上——默认 CI 用 opt 测试族既有的 JS MockFive（`opt-whatif.test.ts` 同款，baseline/扰动各真"重解"返不同方案）；真 CP-SAT 决策切换由 **env-gated** `OPTIMIZER_BASE_URL` 集成断言坐实（同 `apps/datacore/test/opt-real-sidecar.integration.test.ts`）。**绝不**用返回同一方案的桩冒充"决策切换"（那就是绿测试≠能用）。

---

## 5. 验收标准（SEAM 测为头号判据 + 每步子验收）

**头号判据（SEAM-GATE，亲手真跑）**：步④接缝测通过——人机对话问句 → 路径A → `optimize_whatif` → 非空 Δ + `baselineSolution≠perturbedSolution` 决策切换；对照真开放题仍路径B；开关关字节兼容；R6 两跑一致。**审核方复验以此为头号，不以各半绿为准。**

**四包全绿底线**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest）四包全绿（含新接缝测 + 各步子测）。

**逐步子验收**：见 §4 各步「子验收」小节（步①镜像不漂 + 无回归；步② DF.8 报缺不造实体 + R6/R2；步③ 结构化→路径A、真开放→路径B、开关关字节兼容；步④ 接缝断言）。

**门禁**：`opt-template:check` / `opt-determinism:check` / `solver-license:check` / `chain:check` / `ontology:check` 全绿（本 PRD 不新增求解器/事件，金值计数不变）。

---

## 6. 与前端优化推演页的对齐（复用不分叉）

人机对话侧路径A产出 `OptWhatifResult` 后，答案渲染**复用**既有 renderer `optimize-whatif`（`OptimizeWhatifView`，本体 §8 G-12 行）——Δ目标三联 + feasible 徽标 + conflictConstraints + explanation + 决策比对（`baselineSolution`/`perturbedSolution`）。对话答案与优化推演页**同一渲染契约、同一输出形状**（R-一致），避免第二套渲染（RL3/RL10）。诚实徽标沿用「CP-SAT 可证最优 · 推演结果非数据库事实」；未接 sidecar → 诚实提示不假渲 Δ。

---

## 7. 回写本体清单（`docs/SYSTEM-ONTOLOGY.md`）

落地后**必须**回写（本体不回写即过期失效 · RL1）：

1. **§8 断点**：
   - 在 **G-12 行**（`:804-805`）的「残口」追加并标闭：人机对话链路已接（步①②③④）；或新增子码 **`G-WHATIF-NL-UNREACHABLE`** 行并标 ✅（链路位置：`人机对话→domainResolve(opt-whatif)→路径A→bindToSolverArgs 装配→optimize_whatif→Δ+决策切换`；性质：跨「装配半+路由/引擎半」接缝，SEAM 守）。
   - 在 **G-AGENT-BLIND-REACT 行**（`:834`）备注：导航图目录已含 optimize_whatif（残留补齐）。
2. **§3 优化融合链路**（`:495-511`）：把 `NL → … → optimize_whatif` 的 NL 段从"设计待落"改为已接，标注确定性优先门分支 + 装配器。
3. **§2.J**：`optimize_whatif` 条目补一句「经人机对话确定性路由 + 选中→基线装配触达（暗发）」；§2.H navigation-slice 目录 +1（optimize_whatif）。
4. **§2.G / entitlement**：登记新增对话侧暗发开关（defaultOn:false）。
5. **§7 门**：若新增守护脚本（如镜像不漂断言并入门），在 §7 登记（`ontology-writeback:check` 要求每个并入 gates 的门在 §7 出现）。
6. **`prd:check`**：本 PRD 含《本体引用与影响》（§3），写入 `docs/prd-ontology-index.json`；引用的 R/G 均真实存在（G-12/G-WHATIF-HARDCODED-LEVERS/G-AGENT-BLIND-REACT 已在 §8）。

---

## 8. 风险与回滚

### 8.1 路由改动的回归风险（头号风险）

改 `domain-resolver` 置信打分是**高敏感**改动（20 题金标「误降级=0」是硬性质）。缓解：
- **高精度双命中门**（决策族 + 目标值 + 决策对象三者齐备才触发），把触发面收到极窄；真开放题的 open 惩罚**保持不动**。
- **优先级隔离**：置于 L3 耦合检测之后、与 generic_inference/capacity_forecast 同层，不抢耦合/编排题。
- **金标回归测**：qos-20q goldset 加结构化正例 + 真开放负例，断言误降级=0。
- **暗发默认关**：关闭时 `domainResolve`/`preferDeterministicSolver` 输出逐字节不变。

### 8.2 暗发开关建议（defaultOn:false）

- **新增对话侧暗发开关**（AgentCore features registry，`defaultOn:false`，与 DataCore `opt.whatif` 双注册对齐，仿 `qos.deterministic-multi-domain` / `ceo.free-llm`）：如 `qos.opt-whatif-route`。orchestrator 在装配/路由分支前查此开关（`enabled("ALL")=false` → 既有行为字节兼容）。
- **依赖链（R3）**：对话路由**即使开**，底层 `opt.whatif`（BLOCK，requires `opt.solver-pool`）在该租户**未开** → invoke 仍 404 `FEATURE_NOT_FOUND`。故 demo/试点租户需**同时**开 `opt.solver-pool` + `opt.whatif` + `qos.opt-whatif-route`（正是 G-12 残口「demo 租户 opt.* 暗发开门」）。开关关 = 该能力对该租户**不存在**（R3），入口不显、路由不激活。

### 8.3 回滚（RL9 additive 可回退）

- 关 `qos.opt-whatif-route` → 路由/装配分支全部旁路，人机对话恢复原「optimize_whatif 落路径B死角」态（无崩溃，只是不可达）。
- 步①navigation-slice 目录条目 additive，空图不注入；步②invoke 的 `selection`/`autoBind` 是可选分支，旧 `args`/`binding` 路径不变。
- 无迁移、无 schema break、无求解器数学改动 → 纯 additive，随时可摘。

### 8.4 诚实边界

- 本期确定性路由覆盖「结构化命名决策 + 参数改动」；自由 NL 的优化 what-if（措辞含糊、无命名决策）仍落路径B，由步①的导航图让 agent 自选（覆盖面渐进）。
- DF.8 报缺（本体无支撑属性）时诚实落回，不伪造系数——此时对话给"需选中决策对象/需补字段"提示，而非假 Δ。

---

## 9. 与多意图 L2/L3 耦合联合求解 PRD 的关系（不矛盾）

本 PRD 与 `docs/PRD-multi-intent-L2-L3-coupled-solving.md` **正交互补，边界钉死**：

| 维度 | 本 PRD（optimize_whatif 对话接线） | L2/L3 多意图耦合 |
|---|---|---|
| 触发 | **单一命名决策 + 参数改动**（选址/指派/流量 × 涨到/降到 N） | **耦合多域链**（良率↓→转拨→延误→外协）/ 补漏意图 |
| 引擎 | `optimize_whatif`（CP-SAT 重解，facility_location/min_cost_flow） | `portfolio_optimize`（联合守恒引擎，`portfolio.ts`） |
| 输出 | Δ目标 + 决策切换（`baselineSolution`/`perturbedSolution`） | 转拨+加班+外协组合方案（守恒解） |
| 断点 | G-12 · G-AGENT-BLIND-REACT 残留 | G-PORTFOLIO-LOCAL-ONLY · G-SOP-COMPOSE |

**共识（不冲突）**：
- 两者都在治「推演/假设」被 `RE_OPEN` 压进路径B的死角，都复用「清 open 惩罚」范式（本 PRD 镜像 :136 先例；L1 用 `perDomainScoreFor` 去 −0.4）。
- **优先级**：L3 耦合检测（`solverDepGraph` 依赖对 + 组合方案措辞）**优先**——耦合链走 portfolio 守恒；本 PRD 的单决策 optimize_whatif 分支置于其**之后**、与 generic_inference/capacity_forecast 同层。两者互不劫持（判据不同：耦合依赖对 vs 单命名决策+值）。
- 两者都**不新增 §8.2 事件名**（复用 `step.completed` 伪 step）、都**不新造 solver / 不改引擎数学**（只做「NL → 既有 solver」映射层）、都暗发 defaultOn:false（可独立开合）。

---

## 10. WO 拆分建议

**铁律**：本特性**跨「数据装配半（步②DataCore 装配 + 步①AgentCore 目录）」与「路由/引擎半（步③路由 + 步④接缝）」**——按 CLAUDE.md「跨数据/引擎两半的特性必须一个 dev 整单做（拆两半用不同机制不对接 = metric-aware 反复炸的根）」，**必须一张 WO、一个 fresh dedicated dev 整单做**，禁止拆成「AgentCore 路由单 + DataCore 装配单」两半各跑（那正是接缝断裂复发的根）。

**WO-OPTWHATIF-NL-WIRING**（单张 · 一个 dev 整单）
- 🚦**范围边界**（该 dev 本单"身份"）：
  - `apps/agentcore/src/agent/navigation-slice.ts`（步①目录 + 族信号）
  - `apps/agentcore/src/router/opt-whatif-route.ts`（新 · 步②AgentCore 半：意图/family/扰动/role 提示）
  - `apps/agentcore/src/router/domain-resolver.ts` + `ceo-route.ts`（步③路由 + open 惩罚清除 + 优先级）
  - `apps/agentcore/src/router/orchestrator.ts`（暗发门 + 分支接入，additive）
  - `apps/datacore/src/solvers/service.ts`（步②DataCore 半：`optimizeWhatif` 加 `selection/autoBind` 分支 + `assembleBaselineFromSelection`，复用 `bindToSolverArgs`/`resolveFieldRoles`，**不碰 CP-SAT 数学**）
  - `apps/datacore/src/features.ts` + AgentCore features registry（新暗发开关双注册）
  - 测试：`apps/agentcore/test/optimize-whatif-conversational-seam.test.ts`（头号 SEAM）+ navigation-slice/domain-resolver/装配器子测 + `qos-20q-goldset` 扩例
- **交付底线**：一条 handoff 分支 `claude/handoff-optwhatif-nl-wiring`；头号判据 = SEAM 接缝驱动通（决策切换）+ 四包全绿 + 亲手真跑；金值/门禁不漂（optimize_whatif 已注册 → SOLVER_KEYS 计数不变）。
- **复验纪律**：审核方隔离 worktree → 组合四包 gate（`pnpm -r build && pnpm -r --workspace-concurrency=1 test`）→ 亲手跑 SEAM（绿测试≠能用）→ cherry-pick 上 canonical。退则给精确 file:line + 最小修路径。
- **回写**：合并后按 §7 回写 `docs/SYSTEM-ONTOLOGY.md`（G-12 残口闭 / §3 链路 / §2 目录 / entitlement / §7 门），过 `ontology:check` + `prd:check`。

---

## 附:关键 file:line 索引（复验锚点）

- 求解器注册/输出/invoke：`apps/datacore/src/solvers/service.ts:121`(SOLVER_KEYS) · `:240`(SHAPES) · `:3206-3225`(optimizeWhatif) · `:3714`(拦截) · `:3218`(R2 校验) · `:2611`(entitlement)
- 引擎：`apps/datacore/src/solvers/opt-whatif.ts:141`(run) · `:66`(DF.8 resolveTarget) · `:37`(solutionOf) · `:86`(applyOne)
- 绑定：`apps/datacore/src/solvers/opt-binding.ts:106`(bindToSolverArgs) · `:52`(groundBinding DF.8) · `:227`(诚实报缺范式)
- 契约：`packages/contracts/src/opt-template.ts:14/71/84/92`(family/OntologyBinding/OptPerturbation/OptWhatifResult)
- entitlement：`apps/datacore/src/features.ts:92`(opt.whatif)
- 导航图：`apps/agentcore/src/agent/navigation-slice.ts:35-65`(族键/信号) · `:71-180`(SOLVER_CATALOG) · `:132-137`(generic_inference)
- 路由：`apps/agentcore/src/router/domain-resolver.ts:25`(RE_OPEN) · `:79`(open 惩罚) · `:136`(清除先例) · `:146`(阈值) · `:88/163`(domainResolve/prefer)
- 编排：`apps/agentcore/src/router/orchestrator.ts:536-538`(确定性优先门) · `:667`(tryDeterministicBind) · `:1107`(runPathA) · `:1235`(runPathB)
- QOS 会话：`packages/contracts/src/qos.ts:201`(SessionContext) · `:211`(presetSlots)
- 本体：`docs/SYSTEM-ONTOLOGY.md` §2.E/§2.J · §3(495-511) · §5(R1-R18) · §7 · §8(799/804-805/834)
