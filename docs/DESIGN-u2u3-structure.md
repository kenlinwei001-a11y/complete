# 设计裁决 · U2 步骤条与 U3 过程图的**同一份结构**

> **单号** `WO-U3-DAG-DESIGN`（2026-08-17）
> **触发** 仓主问「**决策推演的 UX 调整了吗**」——没调。`decision-play` 的 U2/U3 两格当时都是「不符合」。
> **形态** 先出**设计裁决**，再谈落地：本单只做 **2 页样板**，其余 4 页逐页写清差什么，挂 `WO-U3-DAG-REST`。
>
> ⛔ **本单刻意不做的事**：给 6 页各画一个 DAG。
> 一天内硬铺 6 页，产出的会是 6 个「**步骤态不真正驱动结果分段 / 点了没有凭什么**」的装饰件 ——
> 那正是判据 U2/U3 自己点名要排除的东西。

---

## 0 · 三句话结论

1. **U2 与 U3 是同一份结构的两种画法**（排成线 / 摊成网），**必须共用一份结构**。
   落地件 `apps/frontend-shell/src/views/sim/reasoningGraph.ts`：一份 `ReasoningGraph`，三个投影。
2. **该画图还是该画步骤条，判据只有一个：有没有分叉/汇合**（`isLinearChain`）。
   纯线性 ⇒ 步骤条够用，画图是装饰；**有并列层 ⇒ 必须画图**，因为步骤条会把并列压成一格。
3. **6 页里没有一页该改判「不适用」**。逐页追下来，6 页**都有中间量**（详见 §2）。
   但其中 **1 页（`decision-play`）此前的判定理由「连图都没有」不准确** —— 它有一张
   `CausalGraphPanel`，只是**要先提交决策才出现、且节点不可点、没有规则**。见 §1 的顶回。

---

## 1 · ⚠ 顶回上一张单的一条判定理由（结论不变，**理由要改**）

派单里写：这 6 页「**连图都没有**」。我按铁律 0.5 沿 import 链**逐层追了一遍**（不是只 grep 顶层文件），
结论是：**格子判「不符合」是对的，但 `decision-play` 的病因说错了**。

| 项 | 派单里的说法 | 实测 |
|---|---|---|
| `decision-play` 有没有图 | 「连图都没有」 | **有**。`views/DecisionPlayPanel.tsx:6` 导入 `CausalGraphPanel`，`:1628`（改前行号）真渲染 `<CausalGraphPanel source={{kind:"decision", refId: committedId}}>` |
| 那张图是什么 | — | 后端 `GET /a/v1/causal-graphs/decision/:id` 的 `DecisionGraph`（`packages/contracts/src/causal-graph.ts:255`），**带 `nodes` + `edges` + 逐节点 `provenance`** |
| 为什么判据仍不符合 | — | 三条，缺一条都不成立：① **要先提交决策**（`committedId != null`）**再点开**才出现 ⇒ 推演过程中根本看不到；② 渲染成**五段轨道**（`CausalGraphPanel.tsx:74` 的 `grid`），**边只显示条数**（`:70` `边 {g.edges.length} 条`）不画；③ **节点不可点**（`:95` 那个 `div` 没有任何 `onClick`），面板无从谈起，且节点上只有 `provenance`（来源）**没有规则** |

**这条更正为什么重要（不是措辞洁癖）**：
「没有图」和「有图但点不了」是铁律 0.5 里**两种不同的不工作**，**修法完全不同**——
前者要造，后者要接。若照「连图都没有」去做，会有人**再造一张**决策推演过程图，
与已有的 `CausalGraphPanel` 并列两张图说同一件事（RL3 单一真相源当场破）。

**本单的处置**：`CausalGraphPanel` 讲的是「**决策提交之后**，这条决策为什么被触发」（台账视角，
五段 Cause→Impact→Decision→Action→Result）；本单新加的过程图讲的是「**决策提交之前**，
这几个方案是怎么算出来的」（求解链视角）。**两者时点不同、数据源不同、回答的问题不同**，
故**并存不冲突**，且本单在代码注释里写明了这条边界。真正该合并的是「同一件事两种画法」，
不是「两件事看起来都像图」。

> **另一条顺带的更正**：探针也要自证。我第一版探针只扫**顶层视图文件**，6 页全报「零命中」——
> 与派单结论一致，**但那是巧合**。改成沿 import 传递闭包后，`decision-play` 立刻抖出
> `DecisionPlayPanel.tsx` → `CausalGraphPanel.tsx` 两处命中。
> 金丝雀（判据表已判「符合」的 `project-sim` / `plan-generate`）两版都中 ⇒ 工具没瞎，**是扫描面选窄了**。
> 教训照 0.6 句式：**「我用『顶层文件里没有图组件』当作『这一页没有图』的证据，而前者并不度量后者。」**

---

## 2 · 6 页逐页三问裁决表

三问逐页答，每条带 `file:line`。**「不适用」一格都不发**——理由见每行末列。

### 2.1 `decision-play` 决策推演 ✅ **本单样板**

| 问 | 答 |
|---|---|
| **过程是什么** | **求解链**。越线指标 →(`gap_attribution` 分摊)→ 根因 →(`decision_play` 生成)→ **N 个候选方案** →(组合选取)→ 推荐组合 →(触发规则守着)→ 行动。真值出处：`DecisionPlayPanel.tsx:810` `invokeSolver("decision_play")`；输出分段字段 `:260-264`（`rootCause` / `options` / `matrix` / `triggers` / `recommendedPlan`） |
| **图 vs 步骤条** | **图**。中间层是 N 个**互不依赖**的候选（真分叉），之后**汇合成子集**（`recommendedPlan.optionIds` ⊂ `options`）。步骤条压成一格 ⇒ 看不出「哪几个进了推荐、哪几个没进」，而那是决策者唯一要做的判断 |
| **点节点出什么** | 出该环的**来源 + 规则**，三档不混：方案环 = 引擎 `provenance.kind · basis` 原文（前端不改写）＋下钻三元组；**触发环 = 本页唯一的 `ruleKey` 档**（`thresholdSource === "rule.params"` ⇒ 规则库里查得到；`trigger.default` ⇒ 引擎兜底、规则库里没有这个键）；越线/根因/组合环 = `projection` |

**落地**：`DecisionPlayPanel.tsx:470` `decisionPlayGraph()` · `:1357` `dp-process-graph`。

### 2.2 `optimize-whatif` 优化推演 ✅ **本单样板**

| 问 | 答 |
|---|---|
| **过程是什么** | **求解链**。入参与扰动 →（**基线解 ∥ 扰动后解**：两次互相独立的 CP-SAT 重解）→ 比对判定（Δ/切换/可行性）→ 解读。真值出处：`OptimizeWhatifView.tsx:293` `queryKey:["a","optimize_whatif",…]`；分段字段 `baselineObjective`/`perturbedObjective`/`deltaObjective`/`feasible`/`conflictConstraints`/`explanation` |
| **图 vs 步骤条** | **两个都要**。它此前 U2 已符合（`OW_STEPS` 四步），但那四步的第 2 步「两次求解」**把一个并列层压成了一格** ⇒ 屏上看不出这是两次独立求解，而「两次同 seed 同模板族所以可比」正是本页全部结论的立足点。压掉它，用户就没法判断 Δ 是真的还是求解器在飘 |
| **点节点出什么** | 基线环 / 扰动后环各自的**读的字段 + 判定口径**（`baselineSolution/baselineObjective` vs `perturbedSolution/perturbedObjective`；「另解一次·不是在基线解上改数」）。全档 `projection`（本页无业务规则库） |

**落地**：`OptimizeWhatifView.tsx:161` `OW_GRAPH` · `:214` `OW_STEPS = toSolverSteps(OW_GRAPH)` · `:673` `ow-process-graph`。
**这一页是本设计的自证**：步骤条与图**同源一份结构**，存量 U2 测试 4/4 零改动仍绿 ⇒ 投影忠实。

### 2.3 `what-if` 假设推演 ⏸ 挂账

| 问 | 答 |
|---|---|
| **过程是什么** | **求解链**，且**已有一段结构化渲染**（顶回一条：这页不是完全没有结构）。`WhatIfView.tsx:161` `generic_inference` 前向重算下游派生链 → `deltas`（`{objId,type,prop,before,after}`）；另 `:369` 挂 `ImpactAnalysisPanel`，其 `:536` `impact-chain` 已经用 CSS 连接线画出「对象 ─┬→ 流程 └→ KPI ─→ 决策」的**递进树** |
| **图 vs 步骤条** | **图**（有分叉：一个改动同时扇出到 流程 / KPI，KPI 再推出决策） |
| **点节点出什么** | **⚠ 这里是真缺口**：`deltas` 只有逐行 before/after，**响应里没有边**（哪个派生字段是从哪个字段算出来的、经哪条派生规则），所以「点一个下游字段 → 它凭哪条派生规则算出来」今天**答不出来**。`impact-chain` 那三块倒是有各自的连接键口径（`:545` `carrierTypeKey`、`:559` target∧actual 结构判据、`:574` 锚定指标∩KPI），可以先接这三个节点 |
| **差什么才能做** | 二选一：① 只接 `impact-chain` 三节点（口径已有、能立刻给来源+规则，但**覆盖不到 deltas 主表**，等于只闭一半）；② 要闭全，需 `generic_inference` 在 `deltas` 里带上**派生边**（`fromProp` + `derivationRuleKey`）——那是后端改动，归 `WO-U2-SOLVER-STEPS` 同族 |

### 2.4 `global-sim` 全局项目推演 ⏸ 挂账

| 问 | 答 |
|---|---|
| **过程是什么** | **不是链，是一次联合求解 + 一张分配流图**。`GlobalSimView.tsx:309` `useLiveSolver("portfolio", args)`；输出 `:49` `PortResult`：`allocation[]`（每条带 `provenance`）、`displaced[]`（被挤出的订单，带 `provenance`）、`capacityLedger[]`、`objectiveValues`、`reconChecks[]` |
| **图 vs 步骤条** | **图，但不是「过程图」而是「分配流图」**（订单 ⇄ 基地×时间窗 的二部图，边 = 分配量）。⚠ 这是本表**唯一一页**「过程」的形态与其余五页不同：它没有先后阶段，只有一次守恒解 —— 硬套「入参→求解→结论」三步会得到一个**假的**过程 |
| **点节点出什么** | 分配边 / 被挤出订单**已有 `provenance`**（`:827`/`:844`/`:860` 已在用 `src=求解器 portfolio · 快照`），差的是**规则**那一栏：守恒约束（Σ 分配 ≤ 净产能）与目标函数权重口径今天不在响应里 |
| **差什么才能做** | ① 产品裁决：这一页画「分配流图」还是「求解过程三段」——**本单不替产品拍板**，但给论据：分配流图对用户有用（看得见谁被挤了），求解过程三段是编的；② 若画分配流图，需 `portfolio` 输出带上**每条分配边命中的约束/目标项**，否则规则栏只能写投影口径 |

### 2.5 `cleanroom-attr` 净室归因 ⏸ 挂账

| 问 | 答 |
|---|---|
| **过程是什么** | **三个互不相干的分析，不是一条链**。`CleanroomAttrView.tsx:187` `shared_bottleneck` · `:332` `concentration_risk` · `:441` `margin_attribution` —— 三次**各自独立**的 `invokeSolver`，彼此无输入输出关系 |
| **图 vs 步骤条** | **三张小图，不是一张大图**。⚠ 判据反过来用在这里：**没有分叉的地方不许硬造分叉**，没有链的地方更不许硬串成一条链。三块各自内部**确有图结构**：`:151` `contention:{resourceId, sharers[]}`（资源↔共享者星形）、`:288` `ConcRow:{rootType, rootId, dependents[], count}`（根↔依赖者星形） |
| **点节点出什么** | 能出。三个求解器的判定口径都是**确定性投影规则**且屏上已有文字（如「资源类型有产能字段 ∩ 被另一类型 ref」），接过来即可，全档 `projection` |
| **差什么才能做** | 不差数据，差**产品裁决**：一页三张小图会不会把这页变成图墙？建议**只给「隐性集中度」一张**（它的 `dependents[]` 扇入最有解释力），另两块保持表格。这条要仓主/产品点头，不是工程判断 |
| **为什么不是「不适用」** | 因为它**有中间量**（`contention` / `dependents` 都是可点的结构），判据预设的对象在这一页上存在。判「不适用」的门槛是「这页只有终态、无任何可分段字段」，本页不符合该门槛 |

### 2.6 `sop-balance` 月度规划 ⏸ 挂账（**本表最该慎重的一页**）

| 问 | 答 |
|---|---|
| **过程是什么** | **两件事，必须拆开说**。① 屏上那个「五步法」（`SopBalanceView.tsx:136` 产品→需求→供应→财务→高管决策会 · `:433` `sop-run-1`）是 **S&OP 业务流程**，判据 U2 **显式排除**（「事情分几步做」不是「这个数分几步算出来的」）；② 真求解只有**两次各自独立**的调用：`:833` `mrp_netting` 与 `:872` `finance_pnl`，**之间没有顺序分段语义** |
| **图 vs 步骤条** | **两个都不该现在做**。把业务流程画成过程图 = 判据点名的装饰件；把两次独立求解画成一条链 = 编造它们不存在的先后关系 |
| **点节点出什么** | 两个求解器各自出得来（`mrp_netting` → 净需求/长协覆盖/现货缺口，C06/C16；`finance_pnl` → 收入/成本/毛利 + 结构归因，C15），但那是**两张互不相连的小图** |
| **差什么才能做** | 要么后端给这条链补**分段语义**（同 `WO-U2-SOLVER-STEPS`），要么**产品裁决**「月度规划该不该有推演分步」。与 `WO-U2-STEPWISE-1` 对这一页的结论**一字不差**（那单也把它评估后暂缓），本单不推翻 |
| **为什么不是「不适用」** | 两个求解器的输出**都是中间量**（净需求、缺口、毛利分解），判据预设的对象存在。它是**欠账**，不是问错了对象 |

---

## 3 · 共享结构（一份结构，三个投影）

**落地件**：`apps/frontend-shell/src/views/sim/reasoningGraph.ts`

```
                    ┌──→ toSolverSteps()   ──→ SolverStepBar      （U2 步骤条）
ReasoningGraph ─────┼──→ toDagNodes/Edges() ──→ LayeredDag         （U3 过程图）
（唯一真相源）       └──→ toDagNodeFacts()  ──→ DagNodeInspector   （U3 点节点面板）
```

一个 `ReasoningNode` 携带的正是 U2 与 U3 **共同要的那三样**：
`data`（数据·**写字段名**）· `solver`（求解器）· `rule`（规则）＋ 诚实位 `ruleKind`，
外加图才需要的 `layer` / `state` 与面板才需要的 `verdict` / `formula` / `inputs` / `note`。

### 3.1 能不能复用 `SolverStepBar`？——**组件复用，类型不够**

| 项 | 判定 | 理由 |
|---|---|---|
| `SolverStepBar` **组件** | ✅ **复用** | 它把步骤态与「数据·求解器·规则」口径行做对了，且 `upto` 分段闸已被 `sim-ux-u2-stepwise` 咬死。重造一个只会多一处漂移点 |
| `DagNodeInspector` **组件** | ✅ **复用** | `src`/`rule` 必填 + 空值 `assertDagNodeFacts` 直接抛，判据写在生产入口。本单**一行没改** |
| `LayeredDag` **组件** | ✅ **复用** | `onNodeClick` 可选、节点带 `layer`/`state`，正是画分层 DAG 要的。本单**一行没改** |
| `SolverStep` **类型当共享结构** | ❌ **不够用** | 它是**平铺列表**：没有 `layer`、没有边 ⇒ **表达不了分叉与汇合**。而分叉恰是 U3 存在的理由。若拿它当共享结构，`optimize-whatif` 的「两次独立求解」就永远只能是一格 |

⇒ **结论**：在 `SolverStep` 之上加一层带 `layer` + `edges` 的结构，再把 `SolverStep[]` **投影**出来。
存量两页的步骤条因此**一个字节不用改**（`optimize-whatif` 存量 U2 测试 4/4 零改动仍绿 = 实测证据）。

### 3.2 步骤条是图的**有损**投影 —— 损失必须写在脸上

一层有多个并列节点时，`toSolverSteps` 只能给出**一格**。逐节点规则各不相同，压成一句就会说谎。
故投影在并列层**明说**「本层 N 个并列环，规则逐环不同 ⇒ 在过程图上点各环看」，
而**不是**挑第一个节点的规则冒充全层。数据栏仍**逐环列全字段名**（防漂移机制靠字段名，不许因并列就省）。

> 这条有牙：变异反证 B（把并列层改成挑首节点的规则）⇒ 恰 `U3D-C6` 一条红。

### 3.3 沿用（不另起）上一张单的防漂移机制

求解器输出**今天没有 `steps[]`**。上一张单已判过：真改 = 求解器分步计算大改（超前端边界）；
服务端重排 = 同一投影做两遍（违 RL3）。它选的是「前端按已有分段字段推导 + **步骤契约强制声明源字段**」。
**本单照它的机制走**：`ReasoningNode.data` 必须写**字段名**，字段没了/改名了引用当场断。
跨页统一的后端 `steps[]`（带逐段哈希）仍挂账 **`WO-U2-SOLVER-STEPS`**，本单不做、也不假装替代。

### 3.4 结构自检写在生产入口

`assertReasoningGraph()` 在**模块加载/渲染时**抛，不只写在测试里 —— 与 `assertDagNodeFacts` 同一处理。
拦三件事：① 节点缺 `data`/`solver`/`rule`；② 节点键重复（边会连到错的那一个）；③ 边指向不存在的节点。
理由同 U3 的失败模式：**这三种坏法在屏上都看不出来**（步骤条照样渲、图照样画）。

---

## 4 · 验收判据与变异反证（本单的牙）

判据**不是**「图渲染出来了」，是三颗牙。测试 `apps/frontend-shell/test/sim-ux-u3-dag-design.test.tsx`（7 条）：

| 牙 | 咬法 | 用例 |
|---|---|---|
| ① 点节点能看到**它自己的**凭什么 | 面板同时有来源与规则；换个节点规则**真的不同**（不是一句盖全页的套话） | C1 / C2 / C5 |
| ② 规则性质**分档诚实** | `rule.params` ⇒ `data-rule-kind="ruleKey"` + 徽章「规则键」；`trigger.default` ⇒ `projection` + 诚实位「规则库里没有这个键」 | C3 |
| ③ **这一页凭什么该画图** | 分叉与汇合真的存在：1 根因 → 3 候选 → 只有进组合的 2 个不降级；两次求解真是同层两节点 | C4 / C5 |
| — | 有损投影明说损失 | C6 |
| — | 反向断言：Escape 后面板**真消失**（防「一直挂在 DOM 里」让上面几条白通过） | C7 |

**变异反证三组**（全部实跑，均已 revert，复跑 **7/7 绿**）：

| 变异 | 改了什么 | 结果 | 为什么这是对的失败模式 |
|---|---|---|---|
| **A** | 删 `DagNodeInspector` 的**规则行** | RC=1 · **4 条**红在 `Unable to find [data-testid="dag-node-inspector-rule-text"]`，而报错转储里 `data-testid="dag-node-inspector"` **仍在** | 红在「**面板在、规则不在**」，**不是**「组件不见了」——正是 WO 点名要的那条 |
| **B** | `toSolverSteps` 并列层挑首节点规则冒充全层 | RC=1 · **恰 C6 一条**红 | 有损投影必须明说损失，且这条断言只咬这一件事 |
| **C** | 抹掉「进没进推荐组合」的降级 | RC=1 · **恰 C4 一条**红 | 分叉汇合不是装饰；抹掉它图就退化成「全都一样」 |

**回归**（定点跑，非全量）：`sim-ux-u2-stepwise` 4/4 · `decision-play` 8/8 · `ui-layering.seam` 7/7 ·
`order-journey.seam` 10/10 · `decision-play-consume.seam` 6/6 · `imp2plan.seam` 11/11 ·
`befe-wire-d.seam` 19/19 · `nav-ia-decision-play.seam` 2/2 · `tsc --noEmit` RC=0。

### 4.1 ⚠ 一条被测试当场咬红的设计错误（记账，不藏）

第一版把触发规则节点的名字写成 `t.action`（规则那侧的措辞）。`ui-layering.seam` ④ 立刻红：
`expected true to be false` —— 因为 `t.action`（「启动备份供应商认证」）与方案 `label`
（「缩短备份供应商认证周期」）说的是**同一个行动、措辞却不一样**，两个一起上屏正是
`WO-UI-LAYERING` 合并④⑤要治的病（仓主原话「**为何不简化为 action list**」）。

**改法**：触发节点改用**它盯的那个信号**（`signalRef`）命名 —— 本层讲的本来就是「哪条规则在盯着它」，
行动的措辞只在**行动清单**里出现一次。**这是机器先说话、不是人想起来**（铁律 0.6 要的那种机制）。

---

## 5 · 挂账 `WO-U3-DAG-REST`（4 页 · 逐页差什么）

| 页 | 差什么才能做 | 谁来定 |
|---|---|---|
| `what-if` | ① 只接 `impact-chain` 三节点 = 立刻能做但**只闭一半**（覆盖不到 `deltas` 主表）；② 要闭全需 `generic_inference` 的 `deltas` 带**派生边**（`fromProp` + `derivationRuleKey`）= 后端改动 | 工程可先做①；②归后端单 |
| `global-sim` | 画「分配流图」还是「求解过程三段」——**产品裁决**。本单给论据：分配流图有用（看得见谁被挤了），求解过程三段是编的。若画流图，还需 `portfolio` 输出带上每条分配边命中的约束/目标项，否则规则栏只能给投影口径 | **产品** |
| `cleanroom-attr` | 数据不缺（`contention` / `dependents` 都是可点结构）。缺**产品裁决**：一页三张小图会不会变成图墙？建议只给「隐性集中度」一张 | **产品** |
| `sop-balance` | 要么后端给 `mrp_netting`＋`finance_pnl` 这条链补**分段语义**（同 `WO-U2-SOLVER-STEPS`），要么**产品裁决**「月度规划该不该有推演分步」。与 `WO-U2-STEPWISE-1` 的结论一字不差 | 后端单 / **产品** |

**顺带挂账**：`WO-U2-SOLVER-STEPS`（后端 `steps[]` 跨页统一 + 逐段哈希）——
本单与上一张单的前端推导方案都是它落地前的**诚实过渡，不是替代**。

---

## 6 · 《本体引用与影响》

### 6.1 触及的对象类型
- **无新增**。读侧触及：`Decision`（`rootRef`/`optionsRef`/`chosen`）· `DecisionOption` ·
  `ActionDraft`（经 `triggers` 的行动语义）· `RuleEntry.params`（`thresholdSource="rule.params"` 那一档的落点）。
- 前端新增的 `ReasoningGraph` 是**纯前端投影结构**，不是本体对象类型 —— 它不落库、不产生真值，
  只把已有求解器输出重新组织给屏幕。**故本体 §2 不需要新增条目**。

### 6.2 触及的链路
- `gap_attribution → decision_play → recommendedPlan → ActionDraft → S2 审批` 的**读侧投影**（不写入）。
- `optimize_whatif` 的 baseline/perturbed 双解链（**读侧**）。
- ⚠ **不触及**「决策台账因果图」链路（`GET /a/v1/causal-graphs/decision/:id`）——
  它与本单的过程图是**两个时点**（提交后 vs 提交前），见 §1。

### 6.3 触及的事件
- **无**。本单零事件发射、零真值写入。

### 6.4 触及的不变量
- **RL3 单一真相源**（本单的核心动因）：U2 与 U3 **不许各持一份结构**；
  规则↔方案的对法**不许重写第二份**（复用 `buildActionRows`）。
- **R13 结论可溯源**：判据 U2/U3 是 R13 在推演页上的具体化 —— 每环标 数据·求解器·规则。
- **KILL-MOCK**：图上每个节点的数**全部**来自引擎真值（`out.rootCause` / `options[].provenance` /
  `recommendedPlan` / `triggers`），前端零臆造。

### 6.5 触及的断点
- 无新增断点；本单关闭 U3 判据在 2 页上的欠账（见 §7）。

### 6.6 需要回写本体的部分
- **不需要**。未新增/改变链路、事件、对象类型、不变量或门禁 —— 纯前端投影层。

---

## 7 · 判据表改动（`docs/PRD-harness-ux-adoption.md` §4）

| 格 | 改前 → 改后 | 凭什么 |
|---|---|---|
| **U3 × `decision-play`** | 不符合 → **符合** | `DecisionPlayPanel.tsx:470` `decisionPlayGraph()` + `:1357` `dp-process-graph` 挂 `LayeredDag`（传 `onNodeClick`）+ `DagNodeInspector`；规则三档：方案环取引擎 `provenance.basis` 原文、触发环 `rule.params ⇒ ruleKey`、其余 `projection`。测试 `sim-ux-u3-dag-design` C1–C4 |
| **U3 × `optimize-whatif`** | 不符合 → **符合** | `OptimizeWhatifView.tsx:161` `OW_GRAPH` + `:673` `ow-process-graph`；步骤条与图**同源**（`:214` `OW_STEPS = toSolverSteps(OW_GRAPH)`）。测试 C5–C7 |

**方向**：两格均 不符合 → 符合（棘轮只升不降，无一格反向）。
**合计**：符合 84 → **86** · 不符合 28 → **26** · 不适用 8（未动）· 判不了 0（未动）· 和 = 120。
**「不适用」本单无新增** —— 6 页一格都没改判，理由逐页写在 §2（每页都有中间量，是欠账不是问错了对象）。
