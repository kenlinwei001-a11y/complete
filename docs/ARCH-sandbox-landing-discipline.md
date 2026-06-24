# 架构落地纪律 · 推演沙盘大改如何不破历史不变量（20 年架构师视角）

> 问题：推演沙盘 + 就绪认证 + 数据管道建模屏 + 5 屏 UI，是一次大面积 UI/UX + 后端改动。如何保住历史反复强调、不能变的事项——**本体回写（铁律0）/ CLI 打通（R15）/ data pipeline 打通（G-8）/ 胚胎到系统（R16）/ 系统稳定**？
> 结论先行：**风险不在设计，在落地顺序。设计本身是系统自有原则再走一层；只要"本体先行→操作先行(CLI)→surface 既有闭包→引擎扩展→UI 最后"，每个增量都被现有门夹住，大改就被拆成一串可回退的小增量。**

---

## 1. 诚实定性（不粉饰风险）

大面积改 UI/UX + 一堆后端，**正是**系统漂移的高发区：本体不回写就过期、新 UI 功能没 CLI = 功能洼地（违 R15）、新模块没进 chain 闭包 = 管道断（G-8 复发）、沙盘做成独立筒仓 = 绕过发育闭环（违 R16）、big-bang 重写 = 现有流程崩。**用户的担心 100% 成立。**

但——**这套设计与不变量不矛盾，它们是设计的轨道**。下面逐条证明，并给出"把大改变小、每步过门"的纪律。

---

## 2. 核心重构：这套设计是系统自有原则再走一层，不是新筒仓

| 看似"新增" | 其实是 | 含义 |
|---|---|---|
| 推演沙盘 | **R16「正序运作」相的产品化** | 发育（倒序）是为了用（正序）；沙盘就是"用"。不是新系统，是既有 develop-then-use 闭环的"use"半边 |
| 就绪认证(L0-L4/三件套门) | **既有闭包/三环闭合(R16) surfaced** | 不写新校验逻辑——把 `chain:check`/`ClosureReport`/A18 相位**显性化为产品面板**。认证=闭包验证换个壳 |
| 沙盘操作(init/tick/act/branch) | **OPERATION_CATALOG 新 op（R15）** | 沙盘首先是一组**操作**，UI/CLI/AI 指挥台是同一批 op 的**三个投影**（平行同源 REST） |
| 数据管道建模屏 | **既有 RawDataset→建模链 surfaced** | `ModelingPage.tsx:82` 已 `fetchRawDatasets`；只是把列表**显性化为管道视图**，不是新管道 |
| 时序传导引擎 | **派生引擎扩展 + 规则即引用** | 派生已有；加"系数+延迟沿 link"，系数=`rule.params`（可编辑），不是新机制 |

**一句话**：沙盘不是焊上去的，是系统"建好本体→用本体"这条命脉的下半截。**正序 GapReport（沙盘里发现缺规则/缺动作）→ 自动触发倒序生长**——正是 R16「越用越大」。沙盘**喂**发育闭环，不绕过它。

---

## 3. 逐不变量保全矩阵（每条历史强调 → 怎么不破 → 哪个门兜底）

| 历史强调 | 这套设计如何不破 | 兜底门（已存在） |
|---|---|---|
| **本体回写（铁律0）** | 每相位末把 `SimSession`/`PropagationRule`/`SimCertification` 写进 §2，沙盘链路写 §3，`sim.*` 事件写 §4，R6/R14 复用写 §5，新断点 **G-11** 写 §8 | `ontology:check`（漂移即红） |
| **CLI 打通（R15）** | 沙盘每个能力先注册进 `OPERATION_CATALOG`（带 `cliCommand`，如 `platform sim init/tick/act/branch/compare`）→ CLI 先能跑一遍沙盘**再做 UI**；UI/CLI/AI 三投影同一 `/a/v1/sim/*` REST | `cli-parity:check`（无 cliCommand/深链即红，棘轮基线） |
| **data pipeline 打通（G-8）** | 沙盘是管道**下游消费者**（读世界态=既有 连接器→RawDataset→物化→对象→派生）；**不新建管道**；就绪认证=`chain:check` 闭包 surfaced，未闭包不可进入推演 | `chain:check`（扩沙盘依赖维） |
| **胚胎到系统（R16）** | 沙盘=正序运作相；就绪认证=三环闭合(数据/本体/能力)；沙盘 `GapReport`→`runGrowthLoop` 倒序补齐；SimSession 从租户本体长出（无硬编码） | `ontogenesis:check`（三环+二分声明） |
| **去行业锁死（R14）** | 沙盘引擎只认"类型+link+状态变量"；前端 `SandboxViewConfig` 配置渲染；代码零业务常数 | `debattery:check`（扩沙盘维，grep 不到行业实体名） |
| 真值经审批（R4） | 沙盘态可变**不写真值**；"采纳"才转 R4 ActionDraft | （既有 R4 状态机） |
| 确定性（R6） | 同基准+范围+操作序列=字节一致；传导拓扑序+延迟队列确定 | 单测 + `sim-readiness:check`(新) |
| 租户隔离(R2)/Entitlement(R3) | `sim.*` 全带 tenantId；沙盘是 entitlement feature，关=404 FEATURE_NOT_FOUND | （既有 features 门） |

**填不满这张表的增量 = 不合并。**

---

## 4. 稳定性纪律：strangler-fig，绝不 big-bang

1. **Entitlement 暗发**：沙盘是 feature flag，默认**关 = 不存在（404）**。现有租户/流程**零影响**，按租户灰度开。
2. **Additive-only**：新对象 + 新 `/a/v1/sim/*` 端点；**不改既有 schema**；`Action` 双态默认 `sandbox=false` = 现状（向后兼容，R6 字节不变）。
3. **Reuse-first**：复用 `RadarChart`/`PropagationTimeline`/`simclock`/`generic_inference`/`slice-planner`/`asOfEpoch`（retrofit 清单 ~80% 复用）；UI 是**新 route + 既有页 additive 增强**（ModelingPage 加数据源面板，**不删旧列表**），**非重写**。
4. **CLI-first then UI**：每个沙盘能力**先做成 op（CLI 可达）再做 UI**——天然防"功能洼地"，且 CLI 无头可自动化测试，UI 出问题可退回 CLI。
5. **每相位独立可发**：每个增量自带 本体回写 + CLI 注册 + chain 扩 + 工业级测试 + `pnpm gates` 全绿，**才合**；任一门红 = 不合。
6. **棘轮防回潮**：`cli-parity-baseline`/closure baseline 只增不减——新能力漏 CLI/漏闭包即红。

---

## 5. 落地顺序的架构重排（关键：不从 UI 开始）

> 大改翻车几乎都因"先撸 UI"。把顺序倒过来，UI 改动落在**最后、最小、可回退**，前面全是 additive 后端+本体+CLI。

| 增量 | 内容 | 过什么门 | 风险 |
|---|---|---|---|
| **0 · 本体先行** | 把 SimSession/PropagationRule/SimCertification/`sim.*`/G-11 写进 `SYSTEM-ONTOLOGY.md`（先有图纸，无代码） | `ontology:check` | 极低 |
| **1 · 操作先行(CLI)** | `/a/v1/sim/*`（init/tick/act/checkpoint/branch/compare）+ `OPERATION_CATALOG` 注册 + `platform sim ...` CLI；**CLI 能无头跑通一遍沙盘**（无 UI） | `cli-parity:check`+单测 | 低（无 UI，纯后端+CLI） |
| **2 · 就绪认证 = surface 既有闭包** | 把 `chain:check`/`ClosureReport`/A18 投影成 L0-L4 + 三件套门 + 三维评分（**不写新校验逻辑**） | `chain:check`/`ontogenesis:check` | 低（复用既有判定） |
| **3 · 传导引擎** | 派生扩展（系数+延迟沿 link，系数=`rule.params` 接「规则即引用」） | `ontology:check`+单测 | 中（新引擎，确定性需测） |
| **4 · UI（最后）** | 沙盘视图 + 数据管道屏 + 就绪面板——**复用组件、新 route、entitlement 暗发** | `ui-smoke`+`debattery:check`（沙盘维） | 中（但暗发+可回退+不动旧页） |

> 这样：**UI 是最后一环、最小、可关**；前 4 环纯 additive，每环过门，随时可停在一个稳定态。

---

## 6. 诚实残余风险 + 缓解

- **UI/UX 学习成本**：渐进迁移，旧视图（ProjectSimView 等）保留，沙盘作新入口并存；不强迁。
- **传导引擎性能**（大图逐 tick）：范围预检 + 实体数限（向导已有）+ 增量传导（仅脏节点）；超限显式降级不静默。
- **多行业抽象未经第二行业验证**：P3 设"两行业验收门"（同引擎+换本体跑通），grep 不到行业实体名才算 R14 达标——**不验第二行业不算抽象成立**（fde-delivery 诚实）。
- **与并行开发的协调**：G-9（发育闭环）已"P1+P2 已落"——沙盘的就绪认证须**复用**其 `ScenarioOntogenesisRun`/三环，不另起；meta:sync 门防两套漂。

---

## 7. 给决策者的一句话

**不要把这当"一个大功能"上。把它拆成"本体→CLI操作→surface闭包→引擎→UI"五个增量，每个增量都回写本体、注册 CLI、过 chain 闭包、entitlement 暗发、gates 全绿。** 这样：历史不变量一条不破（且每条有门兜底），系统每一步都停在稳定态，UI 大改落在最后且可回退。**设计不需要新治理——它需要被现有治理逐增量夹住。** 这正是平台"绿测试≠能用、断点在接缝、本体是单一来源"自我纪律的又一次应用。

> 配套：PRD `PRD-simulation-sandbox.md`（全栈设计）+ `逐图分析`（场景映射）+ 本文（落地纪律）。三者关系：分析说"为什么"、PRD 说"做什么"、本文说"怎么安全地落"。
