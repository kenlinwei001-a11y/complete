# PRD · 推演指挥官：意图分类 → Skill → Plan 定版 → ReAct 调度

> 仓主 2026-09-15：「需要一个意图分析+分类的 agent，需要配套一个对应的 skill，然后做 Plan，然后开始 react 模式调度资源完成复杂推演」
>
> **状态：提案。⛔ 未开工。** 触及 `apps/frontend-shell/src/views/sim/` 的部分属禁令 2 范围，需仓主逐案批准。

---

## 0 · 读本体的诚实边界（⚠ 先说清，否则本节自己就是假绿）

`docs/SYSTEM-ONTOLOGY.md` 今天 **3,844 行 / 1,845,720 字节**（≈ CLAUDE.md 的 24.7 倍）。
本 PRD **没有**逐行读完它 —— 读的是：不变量表（R3/R4/R6/R11/R13/R14/R16/R19 原文）、
`### E. 求解/推演域`（:135）、`### I. 推演沙盘域`（:229）、以及四条推演相关的会话上下文链路
（:1109 / :1169 / :2112）。**凡本 PRD 未引用到的章节，本 PRD 不为其正确性背书。**

理由写在这儿是因为它本身是本轮的结论之一：一条「必须完整阅读 1.85MB」的铁律**不可能被执行**，
于是它被跳过，而它的存在造成「读过了」的假象。诚实的做法是**说清读了哪几段**。

---

## 1 · 实测现状：四块**全都已经存在**，「指挥台」甚至已接线

⚠ 本节每一条都是 2026-09-15 在 `070f21da` 树上实测，**不是从台账抄的**（铁律 0.6 第 5 条）。

| 仓主要的 | 今天真实状态 | 证据 |
|---|---|---|
| ① 意图分析+分类 agent | QOS classifier **在**；但意图目录里**零条推演意图** | `grep 'intentKey:.*"(sim\|推演)'` → 0 命中 |
| ② 配套 skill | Skill 全生命周期**在**（compiler / lint / publish-gate / probe / orchestrator / summary-review 六个模块）；`load_skill`、`read_skill_resource` 是 agent 工具 | 种子里只有 2 个 skill：`capacity_analysis`、`sop_meeting`，**无推演方法论** |
| ③ Plan | `compileSolverPlan` **在**（`router/compile-plan.ts:61`） | 但它是**确定性模板编译**（候选取自 navSlice ∩ 已登记 args schema），**不是 agent 产的**，**不定版落盘** |
| ④ ReAct 调度资源 | `runAgentLoop` **在**（`agent/loop.ts:472`，path-B）；**30 个工具**，含 `sim_init` / `sim_tick` / `sim_world` / `sim_certify` | 常量名就叫 `SIM_COMMANDER_TOOLS`（`tools/registry.ts:457`） |

**而且它已经接了线**：`router/orchestrator.ts:647`
```
if (isSimCommanderNl(task) && simCommanderEnabled(enabledFeatures)) {
  await this.runPathB(taskId, auth, { …, model: "agent:sim-commander-nl" });
  return;
}
```
工具可见性由 entitlement **权威裁决**（`orchestrator.ts:1865-1875`：关则不存在，R3 暗发）。

**闸门**：`sim.commander` · `level: BLOCK` · **`defaultOn: false`** · `stage: tiered`
（`apps/datacore/src/features.ts:104`、`scripts/feature-rollout.json:33`）。

> ⚠ 我在实测过程中**差点报出相反结论**：第一次用 `grep … | sort -u | head -25` 数工具，
> 按字母序把最后 5 个截掉了，正要报「agent 没有任何推演工具」。金丝雀（专查 `sim|tick|perturb|world`）
> 当场纠正。**照那个错误结论派单，会把「补四个缺口」错报成「从零造一个指挥台」。**

---

## 2 · 四个缺口（有名有姓，不是「大体上还差些东西」）

### G-SIM-INTENT-FAKE · 分类是假的
`isSimCommanderNl`（`orchestrator.ts:351`）全文三行：
```ts
function isSimCommanderNl(task: QueryTask): boolean {
  const sid = task.context.filters?.simSessionId;
  return typeof sid === "string" && sid.length > 0;
}
```
**它不做意图分析、不分类、不看用户说了什么。** 只要沙盘屏的 NL 框带了 sessionId，
问「今天天气怎么样」也会被判为「推演指挥」并送进 path-B。

形态：**「我用『这句话是从沙盘屏发出来的』当作『这是一条推演指令』的证据，而前者并不度量后者。」**

### G-SIM-ENTRY-NARROW · 入口要求会话已存在
同上那三行 ⇒ **用户必须先自己把沙盘开好**。说不出「帮我推演一下原材料涨价 15% 的影响」
从零开始的这一句 —— 那正是仓主要的那个入口。

### G-SIM-NO-SKILL · 没有推演方法论 skill
agent 有 `load_skill`，但没有任何一份「怎么做一次复杂推演」的方法论可加载。
它今天全靠 system prompt 里那两行（`agent/prompts.ts:184-188`）。

### G-SIM-NO-ESCALATION · 系统已经知道自己够不着，却不请 agent（⭐ 本 PRD 的要害）

> 仓主 2026-09-15 订正：「这个不冲突，如果输入的信息是在确定性之外，再启动 agent，
> 通过 react 模式解决预设规则之外的情况。」**订正成立，本节按它重写。**

**我原先的判断（「agent 指挥与 R6 直接冲突」）是错的。** R6 管的是「**同输入同输出**」，
而**规则外的情况本来就没有一个确定性答案要去保持一致** —— R6 在那里不是被违反，是**不适用**。

真正的缺口是另一件事，而且它今天就在屏上：
**系统已经算得出「这次够不着」，但它只拿这个结论去道歉，没拿去触发 agent。**

实测证据（2026-09-15，真服务真调用，demo 租户）：
`enumerateImpedimentOptions` 逐条算「阻滞点落点类型 ∩ 因子册可拨动落点」：
```
阻滞点落点类型    {MaterialBalance×7, MaterialBatch×6, Base×3, Line×2}
因子册可拨动落点  {Equipment×4, Process×5, Line×5, Material×3, ChangeoverMatrix×1, MaintPlan×1, Order×1}
⇒ 交集只有 Line；ruleGate 侧 {C28,C34,C06,C05} ∩ {C03,C06,C16,C08} 交集只有 C06
⇒ 18 处受阻环节：4 处有对策、14 处「今天一条对策也给不出」
```
这**就是**「预设规则之外」的判据，而且是确定性的、可复算的。
今天它的唯一去向是 `noCandidateReason` 那句话。

⇒ 正确的下一步**不是把缺席去掉**，是 **缺席 + 请 agent**。

### G-SIM-PLAN-UNFROZEN · agent 路的那一次结论无法再现

（本条降级：**不再**是「违反 R6」，R6 不适用于规则外。）
真正的理由是**审计**：一个经营决策若基于某次 agent 推演做出，事后必须能把**那一次**原样再现。
今天 ReAct 自由多跳、不留版本 ⇒ 复算不出来。

---

## 3 · 设计

**总纲（仓主定的架构）**：
> **确定性优先 —— 输入落在预设规则内 ⇒ 走确定性路，零 LLM；
> 落在规则外 ⇒ 启动 agent，ReAct 现解。**

⚠ **这不是新范式，是本仓自己的范式**，只是从没用在推演上。已有三处同构先例（实测）：

| 已有机制 | 出处 |
|---|---|
| 真 LLM 失败 → **落确定性兜底 · 诚实标降级** | `orchestrator.ts:656`；发 `routing.degraded` / `agent_degraded` 事件 |
| PROVISIONAL 域终态**恒 `PROVISIONAL_ANSWER`、绝不 VERIFIED** | `databuilder/provisional-honesty.ts` 有专门的门守它 |
| 双模闭包 `STRICT` / `PROVISIONAL` | 缺口降 ADVISORY、不阻断、**不谎报已闭合** |

### ⭐ 融合模式：规则 + 求解器 + ReAct 的**四级阶梯**（仓主 2026-09-15 定）

> 「**规则 + 求解器 + react 融合模式**」
> 「**当求解器不足的时候，agent 可以自行 coding，生成新的求解器**」

**四级全部是现成的**（2026-09-15 逐条实测，非台账转述）：

| 级 | 干什么 | 确定性 | 信任相位 | 今天在哪 |
|---|---|---|---|---|
| **L0 规则** | 已发布传导规则按图推 | ✅ 完全 | GOVERNED 真值 | `partitionPropagationRules` · `propagateTick` |
| **L1 求解器** | 已注册求解器算 | ✅ 完全 | GOVERNED 真值 | 63 条目录 · `invoke_solver` |
| **L2 ReAct 编排** | agent **调工具，不算数** | ❌ agent 侧 | 结论须标「规则外」 | dsh `kernel=EXTERNAL`；工具走反向通道 `/b/v1/dsh/tool-execute`，**与原生路同一个 `executor`** |
| **L3 生成求解器** | agent 自行 coding 出新求解器 | ✅ **产物是纯函数** | **PROVISIONAL**，人审才升 GOVERNED | `llm-gen.ts::generateSolverDraft`（已接线，`service.ts:891`） |

**L3 的完整流水（`service.ts:838` 注释原文「LLM 生成临时求解器 → 冻结(hash+版本) → 锁死沙箱跑通自检 → 注册 PROVISIONAL（或 UNREGISTERED）」）**：

```
agent 出 computeSource
  → DF.8 接地校验（**在沙箱之前**，service.ts:913）
        引用了边界外业务实体（编造的基地/型号名）⇒ 直接 UNREGISTERED，不进沙箱
  → 冻结：verbatim + hash + 版本（不可变，改 = 新版本 ⇒ R6）
  → 锁死沙箱：**真子进程** spawn（`solvers/sandbox.ts`，杀掉即停，不是"不再等它"）
  → 跑通自检 ⇒ SolverArtifact.status = PROVISIONAL
  → 人审 POST /a/v1/solvers/:solverKey/promote ⇒ GOVERNED
```

相位枚举在契约里写死：`SOLVER_STATUSES = [GENERATED, UNREGISTERED, PROVISIONAL, ADVISORY_PASSED, GOVERNED, RETIRED]`，
注释原文：**「只有 GOVERNED 能写真值」**（`packages/contracts/src/solvers.ts:648/654`）。

⇒ **agent 可以现写一个求解器并当场用它推演，但那个结论恒为 `PROVISIONAL_ANSWER`，绝不 VERIFIED，
除非有人审过。** 这就是「让 agent 自由」与「不许它编数」同时成立的机制 —— 不靠约束 agent 的嘴，
靠**把它的产出关进相位**。

**⚠ 掉级必须有确定性判据，且掉级必须上屏。** 每往下一级，可信度降一档，屏上必须看得出来。
判据见下一节；相位文案复用 `provisional-honesty.ts` 那一套，⛔ 不另起词汇。

---

### ⭐ 要害：**分流判据本身必须是确定性的**

若「这算不算规则外」是让 LLM 判的，整套当场塌 —— 连「**为什么这次走了 agent**」都复算不出来，
更无从审计。分流判据必须是纯函数、可复算、结论可上屏。

**好消息是它不用新造 —— 四问全是现成的**（§2 `G-SIM-NO-ESCALATION` 给了第三问的实测）：

| # | 判据 | 今天在哪 |
|---|---|---|
| 1 | 意图在册吗 | QOS classifier（**需补 `sim.*` 意图，今天零条**） |
| 2 | 槽位填得满吗 | `harvestClassificationSlots`（单源收割器，已在） |
| 3 | 落点类型 ∩ 因子册 ≠ ∅ 吗 | `enumerateImpedimentOptions` **已经在算**，结论今天只进 `noCandidateReason` |
| 4 | 有没有规则覆盖这条边 | `partitionPropagationRules` + `ruleGate`，已在 |
| 5 | **目录里有没有能算这件事的求解器** | 63 条目录 + `solverArgsSchema` 已登记者；无 ⇒ **掉到 L3，agent 自行 coding** |

**判据全过 ⇒ L0/L1 确定性路，零 LLM（既有行为逐字节不变）。
第 1–4 问任一不过 ⇒ L2 ReAct。第 5 问不过 ⇒ L3 生成求解器。**

⚠ 五问全是**纯函数、可复算、结论可上屏** —— 掉到哪一级、为什么掉，事后都能原样再现。

### ⭐ 屏上必须分得开（`PROVISIONAL_ANSWER` 同构）

agent 路的结论**不许与规则路的结论长得一样**。用户要一眼看出这个数是
「按已发布规则算的」还是「agent 在规则外现想的」。文案、事件、谎报判据全部复用
`provisional-honesty.ts` 那一套，⛔ 不另起一套词汇。

示例（治 §2 那 14 处「0 种对策」）：
> 因子册里没有 `MaterialBatch` 的可拨动落点（**规则内无解**）—— 已请 agent 就本次世界态现出对策。
> 以下 N 条为 **规则外建议**，未经规则校验。

⚠ 缺席位**保留**：不是「请了 agent 就把缺席去掉」，而是「缺席 **+** agent 建议」两样都给。
去掉缺席就等于谎报「规则内有解」。

---

### A. 意图分析 + 分类（接线，不新建分类器）

走**既有** QOS classifier（`classify` + `harvestClassificationSlots`，单源收割器），
只补**意图目录**与**槽位**：

| intentKey | 一句话 | 必填槽 |
|---|---|---|
| `sim.what_if` | 「X 变了会怎样」 | 落点类型 · 落点对象 · 因子 · 幅度 |
| `sim.root_cause` | 「为什么这个数是这样」 | 目标读数 · 观察窗 |
| `sim.compare_plans` | 「A 方案和 B 方案哪个好」 | ≥2 组扰动 · 对比维度 |
| `sim.stress_test` | 「最坏能坏到什么程度」 | 因子集合 · 上界来源 |

`isSimCommanderNl` 改判据：**分类命中 `sim.*` ∨ 已有 sessionId**（后者保留，向后兼容逐字节不变）。
⛔ 槽填不满**不许猜** —— 走既有 `AWAITING_CLARIFICATION`（已有超时与取消，见 R19 先例）。

### B. 推演方法论 Skill（新建一份内容，复用既有 skill 机制）

新增 `sim_methodology` skill，经既有 `skill-publish-gate` 发布、agent 经 `load_skill` 加载。
**内容不是套话，是本仓真金白银的教训**（每条都带可复验的出处）：

1. **对照实验是必答题**（铁律 1.5）：任何结论都要能回答「把 X 换成 X′，Y 会怎么变」。
   写不出这一句 ⇒ 这次推演不算完成。封装已在：`@platform/contracts` 的 `respondsToInput`。
2. **区分「全集」与「这次的影响」**：`diffWorld(eps=1e-9)` 只问「动没动」不问「动了多少」，
   传导必然推到全网 ⇒ 那个数恒等于全集。必须按幅度分档（噪声门槛 = 满量程 0.01%）。
3. **已完成的单不进推演世界**：扰动改不了已交付已结款的结果（`entersSimWorld`）。
4. **推几拍要有依据**：最深真链 3 跳；推到「不再变」为止，而不是固定 3。
5. **诚实缺席优于凑数**：有效候选 < 2 ⇒ 报 `noCandidateReason`，不编。

### C. Plan 定版（新建对象 + 端点；**模式直接抄已验证的那条路**）

⚠ **定版解决的不是 R6**（分流已经让 R6 不适用于规则外），它解决的是**审计与复算**：
一个经营决策若基于某次 agent 推演做出，事后必须能把**那一次**原样再现。
本仓已有现成模式 —— `POST /a/v1/sim/optimize-pareto/propose`：
> **agent 决定做什么 → 决定定版落盘 → 之后只读定版、求解路径零模型调用**
> （`app.ts:3380` 注释原文：「指纹命中已有版 ⇒ 直接复用，**不再调模型**」）

同一模式搬到指挥层：

```
POST /a/v1/sim/plans            agent 产 SimPlan → 指纹去重 → 定版落盘
POST /a/v1/sim/plans/:id/run    只读定版执行；同 planId 重跑逐字节相同
```

`SimPlan` 字段（草案）：`intentKey` · `scope` · `perturbations[]` · `horizonTicks` ·
`compareArms[]`（对照实验的另一臂）· `readouts[]`（推完看哪几个量）· `rationale` ·
`fingerprint` · `version` · `frozenAt`。

⇒ **那一次可复算**：给定 `planId`，重跑逐字节相同，审计能把当时那一跑原样再现。
⚠ 它**不**声称「agent 是确定的」—— agent 每次可能产出不同的 plan，那本来就是规则外该有的样子；
定版只保证「**已经产出的这一版**，之后谁跑都一样」。两件事别混。

### D. ReAct 调度（接线 + 补两条纪律）

`runAgentLoop` 已在，工具已在，entitlement 已在。补两样：

1. **终态责任人（R19 硬要求）**：复杂推演会长跑。进 `EXECUTING_AGENT` 的唯一入口
   `orchestrator.ts:1375 enterExecuting` 已挂看门狗 ⇒ **走它即自动有责任人**，
   ⛔ 不许手写 `patch({status:"EXECUTING_*"})`。
2. **披露层（R13 + 铁律 1.5 判据二）**：回包必须能逐项列出
   引用的数据（对象类型 + 条数 + 快照版本）· 走过的切片 · 命中的规则 key 与系数 ·
   **调了哪些工具、各几次** · 各环节耗时 · **agent 是否参与**（未调必须明写，不许留白）。

---

## 3.5 · dsh 路实测（2026-09-15，真 Kimi key + 真 Moonshot 端点）

仓主 2026-09-15：「**都用 DSH 的 agent，不要系统原生的 agent**」。
⇒ §3 的 L2 落在 dsh（`kernel=EXTERNAL`），不是 `runAgentLoop`。

`DECISION-dsh-fusion.md` §13.4 登记的 **R1「真实外部供应商一跳从未跑过」** 本轮已跑：

| 臂 | 结果 |
|---|---|
| **L2.A4 组合臂**（真 LLM × 真规则 × 真 MCP，同一会话） | ✅ **14.8s** · ANSWERED ∧ whoami:t1 ∧ 真 token 账 ∧ 裁决计数≥1 ∧ **零 key 泄漏** |
| L2.A2 真规则 allow / deny 两臂 | ✅ deny 臂**工具体不执行** ∧ reason 是真 verdict（无 mock 前缀） |
| L2.A3 真 MCP（stdio 真子进程） | ✅ pidFile=1 ∧ 审计名 `mcp__erp__whoami` 在帧流 |
| L2.A5a 治理端点关闭 | ✅ **fail-closed deny** ∧ 工具体不执行 |
| L2.A5b 缺凭据 | ✅ `MISSING_CREDENTIAL` ∧ **stub 零请求（fail 在出网前）** |
| L2.A1 两问判别力金丝雀 | ❌ `FAILED`（**见下，是护栏工作，不是缺陷**） |

### ⚠ 一条实测推翻了 §13.4 R3 的描述（照铁律 0.6 记账）

§13.4 写「数字红线是**标注**不是**阻断**，没有任何机制无条件阻止模型把编出来的数字写进答案」。
**实测推翻**：A1 的 `FAILED` 正是被它拦下的，回包原文：

> 「未采纳本次回答：答案里的数字没有标注数据来源，无法核实真伪，**已按数字红线拦下**。
> 业务数字必须来自求解器计算或对象数据，并标注出处，不能由模型自行估算。」

⇒ 在 dsh 路 + `provenancePolicy=required` 档上，它**真的阻断**（拒收尾 ⇒ outcome=FAILED），
并给出用户可读的拦截文案。**「只标注」这个描述至少在这一档上不成立。**

形态：**「我用『文档里写着只标注』当作『它不阻断』的证据，而前者并不度量后者。」**
—— 我上一轮就是这么转述给仓主的，转述时没实测。

⚠ **但别过度解读**：这只证明了 `required` 档会拒。「缺省档也拦不拦」「非数字的编造拦不拦」
本轮**未测**，不在此背书。

### 本轮新发现的观测面缺口（登记，不夸大）

同一份结果里：`iterations: []` · `totalInputTokens: 0` · `totalOutputTokens: 0`，
而 A4 断言「真 token 账」是过的 ⇒ **dsh 路的「拒收尾」分支上，运行明细与 token 账没回填**。
这是**记账缺口**，不是护栏问题；但它会让「这次烧了多少、走了几轮」在被拦下的那些 run 上查不到。
与 `DECISION-dsh-fusion.md` §13.4 R2（`sliceSolverKeys` 在 dsh 路恒空）同族：
**翻 flag 后有两处指标会静默变空**，⛔ 不许当成「指标下降」读，也⛔ 不许当成没有。

---

## 4 · 本体引用与影响（铁律 0 强制节）

**对象类型（§2）**：新增 `SimPlan`（定版计划）。复用 `SimSession` / `Perturbation` / `PropagationRule`。

**链路（§3）**：新增一条
`NL 问句 → QOS classify(sim.*) → 槽位收割 → load_skill(sim_methodology) → SimPlan 定版
→ sim_init → sim_tick×N → sim_world → 披露回包`
断点候选：classify 与槽位之间（槽填不满）、SimPlan 与执行之间（定版漂移）。

**事件（§4）**：新增 `sim.plan.frozen` · `sim.plan.executed`。
下游消费页（统一推演控制台）须订阅，否则违 D-29。

**不变量（§5）**
- **R3**：`sim.commander` 暗发默认关，关 ⇒ 工具**不存在**（不是 403）。已成立，不动。
- **R4**：sim 工具全程模拟态，**绝不写真值**；落地必须经 `create_action_draft` 走审批。已成立。
- **R6**：⚠ **本条于 2026-09-15 被仓主订正，原文写错过一次，照 0.6 记账**：
  原文写「agent 指挥与 R6 直接冲突，定版是它成立的唯一机制」——**不成立**。
  R6 管的是「同输入同输出」，而**规则外本来就没有确定性答案要保持一致**，R6 在那里**不适用**。
  正确的分工：**分流**让确定性路逐字节不变（R6 在它管的范围内照常成立）；
  **定版**让 agent 路的**那一次**可复算（审计要它，与 R6 无关）。
  形态：「我用『这条路上有 LLM』当作『R6 被违反了』的证据，而前者并不度量后者。」
- **R11**：全链闭包 —— Intent + Plan + Solver + render 四段必须全接通才可上架。
- **R13**：披露层是硬要求，不是加分项。
- **R14**：意图目录 / 槽位 / 方法论全部走配置与本体，⛔ 不得内联业务常数。
- **R19**：非终态状态必须有终态责任人（走 `enterExecuting`）。

**断点（§8）**：本 PRD 立四条 —— `G-SIM-INTENT-FAKE` · `G-SIM-ENTRY-NARROW` ·
`G-SIM-NO-SKILL` · **`G-SIM-NO-ESCALATION`**（要害）· `G-SIM-PLAN-UNFROZEN`（定义见 §2）。

**回写承诺**：若本 PRD 落地，必须回写 `docs/SYSTEM-ONTOLOGY.md` 的 §2（`SimPlan`）、
§3（新链路）、§4（两个事件）、§8（四条断点的闭合）。**不回写即过期失效。**

---

## 5 · 验收判据（⛔ 没有这些就不算交付，铁律 1.5）

1. **对照实验**：同一句 NL 问句跑两次 ⇒ 同一个 `planId`、逐字节相同的结果（R6）。
   换一个因子 ⇒ `SimPlan.perturbations` 不同、读数不同。**两条都要，缺一条不算。**
2. **分流判据有鉴别力**（⭐ 本 PRD 的头号验收项，双向金丝雀）：
   - **规则内必须不请 agent**：拿一个四问全过的题（落点 `Line`、规则 C06 覆盖）跑 ⇒
     披露层必须写「**本次未调用 agent**」，且结果与开 feature 前**逐字节相同**。
     报「零 LLM」而拿不出这条对照 ⇒ 不许信。
   - **规则外必须请 agent**：拿 `MaterialBatch` 落点（实测交集为空）跑 ⇒
     必须触发 agent，且屏上同时出现**缺席位**与**「规则外建议」标**，两样缺一即判负。
   - **分流理由必须可复算**：同一题跑两次，分流判据的四个布尔值逐字节相同
     （⚠ 这一条与 agent 是否给出相同答案**无关** —— 分流确定，内容可以不确定）。
3. **意图分类有鉴别力**（双向金丝雀）：
   - 正向：「原材料涨价 15% 会影响多少订单」⇒ 命中 `sim.what_if`
   - 反向：「今天天气怎么样」**从沙盘屏发出** ⇒ **不得**命中 `sim.*`
     （这一条专治 G-SIM-INTENT-FAKE；今天它必红）
4. **槽填不满不许猜**：缺落点 ⇒ 进 `AWAITING_CLARIFICATION`，不得默认成全域。
5. **披露可读**：一个看不到代码的人，读完披露层应能自己判断「这是真推演还是查表」。
6. **零 LLM 回退**：provider 不可用 ⇒ 落既有确定性路径并**诚实标降级**，不得空答案。

## 6 · 不做什么（边界，防止范围蔓延）

- ⛔ 不动 `sim.commander` 的 `defaultOn`（产品决策，仓主定）
- ⛔ 不新增门 / 棘轮 / 基线 JSON（禁令 3）
- ⛔ 不动沙盘 UX / 信息架构（禁令 2；如需入口改动，逐案报批）
- ⛔ 不碰那 11 道存量红（另行立账，与本 PRD 无依赖）
