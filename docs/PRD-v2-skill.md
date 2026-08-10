# PRD · Skill v2 —— 从「治理面」回到「推演力」

| 项 | 值 |
|---|---|
| 版本 | v2.0 · 状态 DRAFT · 日期 2026-08-10 |
| 取代 | 统一并**收窄** `docs/PRD-skill-compiler-registry.md`(907) · `docs/PRD-skill-runtime-orchestrator.md`(789) · `docs/PRD-skill-governance-learning.md`(747) · `docs/PRD-skill-contract-dsl.md`(751) · `docs/PRD-skill-migration.md`(660)。五份原文**不删**，作为设计细节的引用源；冲突时以本文为准 |
| 基线 | canonical `282b8239`（`origin/claude/inspiring-gates-aqczjg`，2026-08-10 亲手实测） |
| 本文只回答一个问题 | **每一条能力，让平台多推演出什么？** 答不出来的条款一律进 §5 砍/降级 |

> **这份 PRD 存在的理由**（仓主 2026-08-10 原话两句，即本文验收标准）：
> ① 「**这些不是我之前期望的**」—— 他在屏上看到的是编译按钮、门审计、运行观测，**全是治理面**；他要的是**推演能力**。
> ② 「**我发了很多关于 skill、agent、本体切片的 PRD，都没有做吗**」—— 此前答不上来，因为没有「PRD 条款 → 实现状态」的账。§2 就是那本账。
>
> **本文的写作纪律**：所有「今天是 X」的断言均给 `file:line` 或可复跑命令；所有**否定结论**（零调用方 / 不存在 / 没做）均**先跑金丝雀**证明工具是活的，并把金丝雀命中数写在结论旁（CLAUDE.md 铁律 0.6）。判不了的写「未判定 + 原因」，**不猜一个状态填进去**。

---

## §1 一页纸：Skill 到底为推演贡献什么

### 1.1 结论（先说，因为它不好听）

**今天 Skill 在「用户提一个问题 → 平台推演出答案」这条链上，站在「给模型看的提示词材料」这一环，不站在「决定怎么算」这一环。**

它对答案的贡献是**文本**，不是**推演**：

| Skill 今天真的能改变什么 | 生产落点 | 它算不算「推演」 |
|---|---|---|
| 往 system prompt 里插一段技能清单 | `engine.ts:412` · `router/orchestrator.ts:2000` | ❌ 提示词 |
| 模型主动 `load_skill(id)` 时返回技能正文 | `engine.ts:462` · `router/orchestrator.ts:2056` | ❌ 提示词 |
| `kind:"rule"` 的 precondition/postcheck 触发规则引擎，BLOCK 即拦答案 | `engine.ts:364` / `engine.ts:505` | ◐ 是**闸**，不是推演 |
| `kind:"solver"` 的 precondition：没跑过该求解器就不下发正文 | `engine.ts:471` | ◐ 是**闸**，且**出厂态不可达**（§2 A-3） |
| 聚合 `provenancePolicy` / `writeMode` 收紧答案形状 | `engine.ts:31-32` / `engine.ts:38` | ◐ 是**约束**，不是推演 |

**它今天不参与的**（这些才是「推演」）：调哪个求解器、求解器收什么入参、多步之间怎么串、结果怎么合成、渲染成什么。这些全部由 **path-A 的 `Intent → ExecutionPlan → PlanStep`** 决定，或由 **path-B 的模型自由工具选择**决定 —— **两条路都读不到 Skill 的任何执行声明**。

### 1.2 为什么会这样：唯一那件能让 Skill 推演的东西，两头都没接

平台**已经有**一个能跑推演图的调度器 —— `GraphScheduler`（`apps/agentcore/src/skill-orchestrator.ts:95`），支持拓扑分层 + 同层并发，`skill`/`solver` 两类节点、`seq`/`parallel` 两类边真能跑。**但它两头都是断的**：

- **上游断**：`SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:266-307`，18 个字段）**没有 `execution` 字段** —— 亲手实测 `grep -n "execution" packages/contracts/src/agentcore.ts` → **0 命中**（金丝雀：同文件 `grep -c "capability"` → **3** ⇒ 文件读得到，0 是真 0）。⇒ **没有任何一个存下来的 Skill 能携带自己的推演图。**
- **下游断**：`skill-graphs` 在整个前端**零命中** —— `grep -rn "skill-graphs" apps/frontend-shell/src | wc -l` → **0**（金丝雀：同目录 `grep -rn "b/v1/skills" | wc -l` → **15** ⇒ 前端确实在调 skill 端点，0 是真 0）。⇒ **用户在屏上没有任何入口能触发它。**

于是这条链的真实形状是：

```
用户问句
   │
   ├─ path-A（确定性主路）  Intent ──planRef──▶ ExecutionPlan ──steps──▶ Solver/Slice/Rule ──▶ render
   │                          ▲
   │                          └── Skill 在这条路上【完全不在场】（plan 不读 skill 的任何字段）
   │
   └─ path-B（Agent 自由路） runAgentLoop
          │
          ├── system prompt ◀── buildSkillSection(技能清单)         ← Skill 唯一的真实贡献：文本
          ├── load_skill(id) ──▶ 技能正文（文本）                    ← 第二个贡献：还是文本
          ├── rule precondition/postcheck ──▶ 规则引擎 BLOCK 拦答案   ← 闸
          └── 模型自己决定调什么工具 ────────▶ Solver               ← 推演在这里发生，但【不由 Skill 决定】

     ┌──────────────────────── 旁挂 · 与上面两条路不相连 ────────────────────────┐
     │  POST /b/v1/skill-graphs/run  ──▶ GraphScheduler ──▶ 真·分层并发跑推演图    │
     │      ▲ 请求体里显式传图                    ▲                                │
     │      │ 没有 Skill 能声明图（契约无 execution 字段）                          │
     │      └ 前端零调用方（0/15 金丝雀）                                          │
     └──────────────────────────────────────────────────────────────────────────┘
```

### 1.3 一句话

> **平台已经造好了「Skill 能推演」所需的引擎，但没给它装油箱（Skill 存不下图），也没装方向盘（用户点不到它）。**
> 过去这一轮把力气花在了引擎周边的仪表盘上 —— 编译报告、发布门、引用闭包、运行观测 ——
> 这些是**治理面**：它们让「Skill 写得对不对」可查，但**一条都不改变「平台能推演出什么」**。

**本 PRD 的 P0 就是装油箱 + 装方向盘**（§4），其余一律往后排或砍掉（§5）。

---

## §2 实测现状（四态对账表）

### 2.0 判定口径与金丝雀纪律

| 态 | 判据 | 本表标记 |
|---|---|---|
| **已实现且在生产链路上** | 有**非 test** 的 src 调用方，且能读到触发条件 | ✅ |
| **只有实现没接线** | 调用方集合里**只有 test**（「已排练 ≠ 已实现」） | ⚠️ |
| **接了线没数据 · 接错地方** | 有生产调用方，但输入恒空 / 挂在错误的路径上 | 🔗 |
| **没做** | 承载物不存在（**必须附金丝雀命中证据**） | ❌ |
| **未判定** | 需真跑才知道 / 本单未验 | ❓ |

> **⛔ 本表纪律**：`grep` 的直接命中数**不是结论**（铁律 0.5）。每条 ❌/⚠️ 都追过至少一层间接调用（re-export / 高阶函数 / 依赖注入 / 字符串键分发 / 事件订阅），并在「证据」列写明金丝雀。

### 2.1 A 组 · 推演能力（本表最重要的一组 —— 它决定屏上的答案变不变）

| # | PRD 条款 | 出处 | 态 | 证据（file:line · 金丝雀） |
|---|---|---|---|---|
| **A-1** | Skill 能声明自己的执行步骤 / 推演图（`Skill.execution.steps` / `.graph`） | migration §4-② · compiler §3.2 · runtime §3.2 | ❌ **没做** | `SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:266-307`）无 `execution` 字段：`grep -n "execution" packages/contracts/src/agentcore.ts` → **0**（金丝雀：同文件 `grep -c "capability"` → **3**）。契约自己把这句钉死了：`packages/contracts/src/skill-graph.ts:349-352`「在挂上去之前，`Skill.execution` 这条路恒空……**不是「已实现」**」 |
| **A-2** | 推演图能真并发执行（`GraphScheduler` 拓扑分层） | runtime G1 前半 | ✅ **已实现且在生产链路上** | `apps/agentcore/src/skill-orchestrator.ts:95 (GraphScheduler)` ← 非 test 调用方 `apps/agentcore/src/server.ts:1432 (new GraphScheduler)`，端点 `server.ts:1424 POST /b/v1/skill-graphs/run`。**但见 A-1/A-4：它是旁挂路，喂不进 Skill 的数据、也没有 UI** |
| **A-3** | `kind:"solver"` 的 precondition 真被执行（#154） | 本仓欠账 #154 | 🔗 **接了线接错地方** | 修**已落**：`apps/agentcore/src/engine.ts:59-66 (ENFORCED_SKILL_REF_SLOTS)` + `:106 (unmetSolverPreconditions)` + `:471`（`runRegisteredAgent` 的 `loadSkill` 里求值）。**但只挂了两条 `loadSkill` 里的一条** —— 自由问答路的 `loadSkill`（`apps/agentcore/src/router/orchestrator.ts:2056-2070`）**直接 `return skill.body`，无任何 precondition 求值**。⇒ 同一个技能走哪条路，门开不开是两个答案 |
| **A-4** | 那条 precondition 在**生产链路**上真可达（#156） | 本仓欠账 #156 | 🔗 **接了线没数据** | 出厂 7 个技能（`grep -c 'id: "skl_' apps/agentcore/src/mocks/seed.ts` → **7**），挂到 agent 上的只有 3 个 key（`skl_seed_capacity` ×4 · `skl_seed_supply_chain` · `skl_seed_mcp_guide`，`seed.ts:1395/1425/1443/1461/1555/1576`）。**唯一带 precondition 的 `skl_seed_capacity_action`（`seed.ts:1294` · `references` 在 `:1342`）挂在 0 个 agent 上** ⇒ A-3 修好的那道门，出厂态**一次都不会被求值** |
| **A-5** | `dependsOn` 有真运行时语义（多 Skill 编排） | runtime G6 · §8.1 | 🔗 **接了线没数据（已从 0 条改善到 1 条，但仍无运行时语义）** | 数据侧已补：`seed.ts:1350` 唯一一条 `capacity_action_draft --dependsOn--> capacity_analysis`。消费方**只有静态校验**：`skill-lint.ts` 的引用可解析/依赖图环检测。**运行时零消费** —— `GraphScheduler` 只认请求体传进来的图，不读 `skill.dependsOn`（`skill-orchestrator.ts:110 compileExecution(input)`，input 来自 HTTP body） |
| **A-6** | `maxBudgetRounds` 从「字段存在」变成「改这个数 → 该类题实际轮次真变」 | runtime G3 · migration 硬约束④ | 🔗 **接了线接错地方** | 唯一 src 消费方 = `apps/agentcore/src/skill-probe.ts:133 (skillBudgetOverride)` —— **发布探针**，不是生产答题路。`grep -rn "maxBudgetRounds" apps/agentcore/src --include='*.ts' \| grep -v test` → 仅 `skill-probe.ts:129` 注释 + `mocks/seed.ts:1284,1286`。⇒ 用户改这个数，**屏上答案一个字不变**；只有点「发布」时的探针会变 |
| **A-7** | `execution.mode: DETERMINISTIC` 红线（图内不得出现 LLM 节点） | runtime §3.3-1 | ⚠️ **只有声明，零读点（契约注释在说谎）** | 声明在 `packages/contracts/src/skill-graph.ts:395`，注释写「PRD §3.3-1：DETERMINISTIC 图内不得出现 LLM 节点（agent/compose）」。**全仓无任何读点** —— `grep -rn "DETERMINISTIC" apps packages --include='*.ts'` 的命中里，与 skill-graph 相关的**只有这一行声明 + 它自己的注释**；其余全是无关的 `WO-DETERMINISTIC-CROSS-DOMAIN` 与 `DETERMINISTIC_PREFERENCE_THRESHOLD`（router 常量）。金丝雀：同文件 `SkillExecutionSchema` 全仓 **4** 命中 ⇒ 文件可读。⇒ 写 `mode:"DETERMINISTIC"` 再往图里塞 `agent` 节点，**没有任何一处会红** |
| **A-8** | Skill 参与 path-A（确定性主路）的选路或执行 | migration M2「权威翻转」 | ❌ **没做** | `workflow/executor.ts` 的 `PlanStep` 执行链上零 skill 读点；path-A 的 `Intent.planRef → ExecutionPlan` 与 Skill 无任何交集（`SkillDefinitionSchema` 无 `planRef`/`intentKey`，`IntentDefinition` 无 `skillKey`）。⇒ **32 个出厂意图，0 个由 Skill 驱动** |
| **A-9** | Skill 对默认自由问答路径可达 | 本体 §8 `G-SKILL-UNREACHABLE-FREE-QA` | 🔗 **接了线，默认关** | 已闭（暗发）：`selectTenantSkills`（`router/orchestrator.ts:257`）→ `buildSkillSection`（`:2000`）。**但门 `agent.skill-on-free-qa` 是 `defaultOn:false`**（`apps/agentcore/src/features/registry.ts:120` + `apps/datacore/src/features.ts:120`，且列入 `QOS_DARK_LAUNCH_FEATURES` `features.ts:166`）⇒ **出厂态用户在对话坞随便问一句，仍然一个技能都看不见** |

> **A 组小结（一句话）**：**9 条里，能改变屏上答案的是 0 条。**
> A-2 是真的、能跑的、有生产调用方的 —— 但它跑的是 HTTP 请求体里传进来的图，而**没有 Skill 能声明图**（A-1）、**没有前端会调它**（§1.2）。这不是「差一点」，这是**两端都断**。

### 2.2 B 组 · 治理面（做得最多的一组 —— 也是仓主说「不是我期望的」那一组）

| # | PRD 条款 | 出处 | 态 | 证据 |
|---|---|---|---|---|
| **B-1** | 引用可校验门成为必配硬门（发布期 fail-closed，`force` 不豁免） | compiler O1 · §4.3 | ✅ **已实现且在生产链路上** | `probeMissingRefs`（`apps/agentcore/src/resources.ts`）接上 skill 发布路；判据抽成单一实现 `apps/agentcore/src/skill-publish-gate.ts (runSkillPublishGate)`，**发布路与启动期种子审计两个调用点共用同一份**（该文件头注释即为此立）。守门 `scripts/check-ref-closure.mjs`（存在，且在 `pnpm gates` 链内） |
| **B-2** | 技能编译（Parser→AST→推理图）+ 编译报告可见 | compiler §4.1 | ✅ **已实现且在生产链路上** | 引擎 `apps/agentcore/src/skill-compiler.ts` · 契约 `packages/contracts/src/skill-compile.ts` · 端点 `apps/agentcore/src/server.ts:1465 POST /b/v1/skills/:id/compile` · 前端**真有 UI**：`apps/frontend-shell/src/pages/admin/SkillStructure.tsx:302`（编译报告面板）+ `apps/frontend-shell/src/api/endpoints.ts:949` |
| **B-3** | 编译端点必须暗发（`skill.compiler` · `defaultOn:false` · entitlement **先于** authz） | compiler §0 R3（自标 🔴 已违反） | ❌ **没做 · 且已并入 canonical** | `server.ts:1466-1467` handler 前两行只有 `const a = await auth(req); requireCatalogAdmin(a);` —— **无 entitlement**。`grep -rn "skill.compiler" apps/agentcore/src apps/datacore/src packages/contracts/src` → **0**（金丝雀：同一批文件 `SkillDefinitionSchema` → **10** 命中）。⇒ 违反 **R3**：`requireCatalogAdmin` 量的是「角色够不够」，R3 要的是「功能开没开」，且必须**先于** authz。对任何 `catalog_admin` 恒开，暗发等于没做 |
| **B-4** | 发布双门禁（结构 lint + `skill_quality` 评测 ≥3 + 探针实跑 passRate=1） | addendum-skill-authoring | ✅ **已实现且在生产链路上** | `apps/agentcore/src/skill-lint.ts (lintSkill)` · `apps/agentcore/src/skill-probe.ts (SkillProbeRunner)`，均由发布路调用 |
| **B-5** | Skill 引用边进资源关系图（「改 C08 影响哪些 Skill」一次查询） | compiler §5.4 · 本体 §8 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ① | ⚠️ **只有 test 引用（零生产调用方）** | `apps/agentcore/src/dril/resource-projector.ts:296 (extractRelations)` 的调用方集合 = 定义 1 + `test/skill-partial-a-seam.test.ts` + `test/dril-registry.test.ts`，**src 侧 0**。**金丝雀（同文件同类函数）**：`projectSkills` 有 2 处 src 调用方（`dril/resource-registry.ts:17,188`）⇒ 工具没坏，是它真没人调。生产真用的是 `dril/relations.ts extractResourceRelations`，**整段不读 `skill.references/dependsOn`** |
| **B-6** | 指标补租户维（学习闭环 P0-A 硬前置） | governance §2.1 | ❌ **没做** | `grep -rn "tenant" apps/datacore/src/metrics.ts apps/agentcore/src/metrics.ts` → **RC=1（零命中）**（金丝雀：同两文件 `grep -c "inc("` → **5 / 1** ⇒ 文件读得到，0 是真 0） |
| **B-7** | `/metrics` 鉴权（学习闭环 P0-B 硬前置 · 现存信息泄漏面） | governance §2.2 | ❌ **没做** | DataCore：`/metrics` 在 `PUBLIC_PATHS`（`apps/datacore/src/app.ts:851`），鉴权钩子第一行 `if (PUBLIC_PATHS.has(path)) return;`（`:863`）**在任何认证之前**；handler `:930` 签名 `async (_req, reply)` 不看 req。AgentCore：`apps/agentcore/src/server.ts:211` handler `async (_req, reply)`，**不调 `auth(req)`**（金丝雀：同文件相邻业务端点第一行即 `const a = await auth(req);`）。**⚠️ PRD 漏写的坑，本文补上**：只改 handler **无效** —— DataCore 侧 `onRequest` 在 `:863` 已 `return`，请求根本走不到 handler。**`PUBLIC_PATHS` 与 handler 两处必须同改** |
| **B-8** | 门 `metrics-tenant:check` | governance §2.3 | ❌ **没做** | `ls scripts/check-metrics-tenant.mjs` → No such file（金丝雀：同目录 `ls scripts/check-ref-closure.mjs` → **存在** ⇒ 目录读得到） |
| **B-9** | Skill 权限三面（data / tool / action）一处判定 | governance §3 | ❌ **没做** | `SKILL_REFERENCE_KINDS`（`packages/contracts/src/agentcore.ts:246`）= 8 种，**无 `tool` / `mcp` / `actionType`**；`SkillDefinitionSchema` 无任何权限字段。⇒ 「这个 Skill 能用哪些工具、能发哪些 Action」在契约层**无处可写** |
| **B-10** | Prompt 版本化（Execution Trace 缺的那一维） | governance §4.2 | ❌ **没做** | `grep -rn "promptVersion\|promptHash" apps packages --include='*.ts'` → 0（口径同 governance §1.2-1，本单未重跑该 grep，标注为**引用他人实测**，见 §7） |
| **B-11** | 生长回路补角色门 + R4 审批位 | governance §6 | ❓ **未判定** | 本单未验（时间边界，见 §7）。governance §1.4 给的锚点是 `apps/agentcore/src/server.ts:236` 无 `requireRole` |

### 2.3 C 组 · 契约与迁移

| # | PRD 条款 | 出处 | 态 | 证据 |
|---|---|---|---|---|
| **C-1** | `requires` 结构（`objectTypes[].properties` / `minStatus` / `required`）—— **仓主 2026-08-03 已裁决采纳** | contract §4.5 · crossreview C1 · SPEC §9.1 | ❌ **裁决进了文档，没进代码** | `grep -n "requires" packages/contracts/src/agentcore.ts` → **RC=1（零命中）**（金丝雀：同文件 `grep -c "capability"` → **3**）。⇒ 扁平的 `references[]{kind,key}` 表达不了「Factory 必须有 capacity 属性」，SPEC §7 定案 1 的语义**落不了地** |
| **C-2** | `businessIntent`（12 层第②层：这个技能解决什么业务问题） | contract §4.2 · migration §1.3 | ❌ **整层无承载物** | `grep -rn "businessIntent" apps packages --include='*.ts' --include='*.tsx'` → **RC=1（零命中）**（金丝雀同上 = 3） |
| **C-3** | `trigger` 触发面（`examples[]` 示例问句，供分类器选型） | contract §4.3（自标「今天全缺」） | ❌ **没做** | `SkillDefinitionSchema` 18 字段无 `examples`/`triggerPatterns`。触发信息今天只藏在 `summary` 的自然语言里（`agentcore.ts:284`，上限 200 字） |
| **C-4** | `outputSchema` 有真消费方（校验实际输出） | contract §4.6 · crossreview 族④ | 🔗 **接了线接错地方** | 两处消费方都在，但量的不是这件事：`skill-lint.ts` 只跑 `validateJsonSchemaShape`（验「它是不是一个合法 JSON Schema」）· `dril/resource-projector.ts:149` 只做投影展示。**无一处拿它校验 Skill 的实际输出** |
| **C-5** | M0 影子声明：32 意图各生成一份 Skill | migration §5 | ❌ **没做** | 出厂 Skill 数 = **7**（`grep -c 'id: "skl_' apps/agentcore/src/mocks/seed.ts`），意图数 = 32。无导出器（`find apps/agentcore/src -iname '*skill*'` 的 6 个文件里无 export/migration 模块） |
| **C-6** | M1 一致性门 `skill-plan-parity:check` | migration §6（自称「整条路径的命门」） | ❌ **没做** | 脚本不存在（金丝雀见 §2.4） |
| **C-7** | M2 权威翻转 + 双源红门 `skill-single-source:check` | migration §7 | ❌ **没做** | 同上。且 M2 依赖 A-1（`execution` 字段），A-1 未做 ⇒ **M2 结构上不可能开工** |
| **C-8** | 命名红线（产物不得叫 `ExecutionPlan`/`ExecutionGraph`） | compiler O3 · §3.1 | ✅ **已遵守（但靠人不靠门）** | 产物取名 `SkillReasoningGraph` / `SkillRuntimePackage`（`packages/contracts/src/skill-compile.ts`），**守它的静态门 `skill-compiler:check` 不存在**（§2.4）⇒ 今天靠 code review，不靠机器 |

### 2.4 D 组 · 门账（欠账 #95：五份 PRD 的共同前置 = 合并门账）

**五份 PRD 新提的门（去重后 17 道），今天一道都不存在。**

复跑（本单亲手，2026-08-10）：

```
ls scripts/check-{skill-compiler,graph-runtime,progress-reachability,metrics-tenant,skill-permission,
                  growth-hitl,skill-trace,skill-refs,skill-ref-closure,skill-export,
                  skill-business-intent,skill-plan-parity,skill-single-source,
                  skill-entitlement-single,skill-budget-effect,skill-eval,skill-lint}.mjs
→ 17/17 "No such file or directory"
金丝雀：ls scripts/check-ref-closure.mjs scripts/check-loop-control.mjs → 两个都在
⇒ 目录读得到，17 个 0 是真 0
```

**「33 道门」这个数今天两个加数都要订正**（`docs/PRD-skill-crossreview.md` §3 已订过一次，本单再订一次 —— 因为它**又漂了**）：

| 加数 | crossreview 原文 | 2026-08-09 订正 | **2026-08-10 本单实测** | 复跑命令 |
|---|---:|---:|---:|---|
| 现有门（`pnpm gates` 链） | 16 | 26 | **29** | `node -e "console.log(require('./package.json').scripts.gates.split('&&').length)"` |
| 五份 PRD 新提门 | 17（写法暗示「已计入」） | **0 已落地** | **0 已落地** | 上面那条 ls |
| 合计 | 33 | 26 今天 / 43 全落地后 | **29 今天 / 46 全落地后** | — |

> **这个数一年漂三次，本身就是判据**：它每被人抄一次就过期一次，而**没有任何门在守它**。
> ⇒ 本 PRD 的处置（§5-D）：**不追求把 17 道门补齐**，而是**只保留 3 道能咬住推演行为的门**，其余砍掉；并要求门数**从注册表派生**，不再写死在文档里。

### 2.5 对账小结

| 组 | 条数 | ✅ 生产链路上 | 🔗 接错/没数据 | ⚠️ 只有 test | ❌ 没做 | ❓ 未判定 |
|---|---:|---:|---:|---:|---:|---:|
| **A 推演** | 9 | **1**（A-2，且两端断） | 5 | 1 | 2 | 0 |
| **B 治理** | 11 | 3 | 0 | 1 | 6 | 1 |
| **C 契约/迁移** | 8 | 1（靠人不靠门） | 1 | 0 | 6 | 0 |
| **D 门账** | 17 道门 | 0 | — | — | 17 | — |

**一句话读法**：治理面**真的有东西落地了**（B-1/B-2/B-4 三条是实打实的、有生产调用方、有 UI 的）；
**推演面一条都没落地** —— A 组唯一的 ✅ 是个两端悬空的旁挂 API。
**这就是「不是我期望的」那句话的机械解释。**

---

## §3 目标能力（按用户可见的推演价值排序）

> 排序判据只有一条：**做完之后，用户在屏上看到的答案会不会变？** 会变的排前面，不会变的排后面或砍掉（§5）。
> 每条必须回答「它让平台多推演出什么」；答不出来的不许进本节。

### K1 · 让 Skill 能声明并跑出自己的多步推演（**最高优先级**）

| 项 | 内容 |
|---|---|
| **用户能多做什么** | 今天问「常州基地 4680-NCM 未来 6 周能不能接？」，path-B 靠模型自己想调什么工具，每次可能不一样；做完之后，命中该技能的问句会**确定性地**跑出「查产能 → 评规则 → 算缺口 → 渲染」这条固定推演链，并把每一步亮在屏上。**同一个问题，两次问，推演路径一样。** |
| **它让平台多推演出什么** | 从「模型即兴调一两个工具」变成「按声明跑一张多步图，含并发分支」。这是 Skill 第一次**决定怎么算**，而不是只**建议怎么想** |
| **依赖 §2 的哪些缺口** | **A-1**（契约无 `execution` 字段，硬前置）· A-2（引擎已就绪，直接复用不重造）· A-7（`mode` 红线要么接读点要么砍） |
| **机器可验证的验收判据** | ① 造一个带 `execution.graph`（2 个 solver 节点 + 1 条 parallel 边）的 Skill → 经**用户问句**（不是直调 `/skill-graphs/run`）触发 → 响应的 `source` 字段为 `"execution.graph"` 且两个 solver 节点在同一层并发；② **变异反证**：把 `execution` 字段从契约摘掉 → 该测试必须红；③ R6：同 Skill 同问句两次跑，图编译产物逐字节一致 |

> ⚠️ **K1 的范围边界（防长成 M2）**：**只做「Skill 能带图并被跑」，不做「Skill 吞并 ExecutionPlan」**。
> 32 个出厂意图的 path-A 一行不动。migration M2 的权威翻转是 P2 的事（§4），K1 不碰。

### K2 · 让「先跑推演，再下结论」成为硬约束（补完 #154/#156）

| 项 | 内容 |
|---|---|
| **用户能多做什么** | 问「按这个方案生成行动计划」而**没先跑过推演**时，平台会明确回「先跑 `capacity_forecast`，拿到结论再来」，而不是让模型凭空编一份行动计划 |
| **它让平台多推演出什么** | 把「推演是结论的前置」从**技能正文里的一句人话**变成**平台执行的门**。这直接对应 R13（结论可溯源）：没有推演就没有可溯源的数字 |
| **依赖 §2 的哪些缺口** | **A-3**（门只挂了两条 `loadSkill` 的一条）· **A-4**（唯一带 precondition 的技能挂在 0 个 agent 上） |
| **机器可验证的验收判据** | ① `skl_seed_capacity_action` 挂到至少一个出厂 agent 上（`seed.ts`），且 `skill-lint` 侧加断言「声明了 `precondition` 的技能必须至少被一个 agent 或租户技能池可达」；② **两条路各一条 SEAM**：注册 agent 路 + 自由问答路，未跑求解器时 `load_skill` 均返回门禁说明而非正文；③ **变异反证**：把自由问答路的 precondition 求值删掉 → ② 的第二条必须红 |

> **为什么 A-3 是「接错地方」而不是「没做」**（修法完全不同）：门的实现是对的、有生产调用方、有测试。
> 问题是**平台有两个 `loadSkill` 出口**，门只装在其中一个上。修法是**把两个出口收敛成一个**（或让第二个调同一份判据），
> **不是**重写门。抄一份判据到第二个出口 = 装饰品（铁律 0.6）。

### K3 · 让 Skill 参与选路（题型 → 推演路径）

| 项 | 内容 |
|---|---|
| **用户能多做什么** | 写一个新技能并给它 3 条示例问句，**不改一行代码**，用户问类似问题就走这条技能的推演链 |
| **它让平台多推演出什么** | 把「新增一类推演」的成本从「改代码 + 加意图 + 加计划 + 加求解器」降到「写一个技能」。**这是 Skill 相对 ExecutionPlan 唯一真正的增量价值** —— 否则 Skill 只是 ExecutionPlan 的一个更啰嗦的写法 |
| **依赖 §2 的哪些缺口** | **C-3**（无 `examples`/触发面）· A-9（自由问答路暗发默认关，需评估是否转正） |
| **机器可验证的验收判据** | ① 新建技能带 `examples:["常州能不能接这批单"]` → 发同义问句 → `ValidationTrace`/`routeSource` 里能看到「由技能 X 选中」；② **效果层**：不挂该技能 vs 挂该技能，答案的**推演路径**不同（不是只有措辞不同）；③ 变异反证：清空 `examples` → ① 必须红 |

### K4 · 让预算声明在生产路上真生效（A-6）

| 项 | 内容 |
|---|---|
| **用户能多做什么** | 给「快速核查类」技能声明 `maxBudgetRounds: 2`，用户问这类题时**真的**只跑 2 轮就收敛给答案，而不是烧满 8 轮 |
| **它让平台多推演出什么** | 推演的**深度可按题型调**，而不是全局一个常数。快题快答、深题深挖 |
| **依赖 §2 的哪些缺口** | **A-6**（唯一读点是发布探针，不是答题路） |
| **机器可验证的验收判据** | migration 硬约束④原文即可直接用：同一开放题，`maxBudgetRounds: 2` vs `6` → **观测到的 LLM 往返次数真的不同**，且 2 的那次落 `degrade`。**明确拒收运输层断言**（「字段被读出来了 / 被传给 BudgetTracker 了」不算） |

### K5 · 让「改一条规则/求解器，影响哪些推演」可查（B-5）

| 项 | 内容 |
|---|---|
| **用户能多做什么** | 改外协红线 C08 之前，一次查询看到「这条规则被 3 个技能的 precondition 引用」，而不是靠 grep |
| **它让平台多推演出什么** | 严格说**它不增加推演**，它增加**改推演之前的可预见性**。之所以还留在 §3 而不是进 §5，是因为它是 K1 的**安全带**：Skill 一旦能决定怎么算，「改这条会影响哪些答案」就从治理需求变成安全需求 |
| **依赖 §2 的哪些缺口** | **B-5**（死抽取器，零 src 调用方） |
| **机器可验证的验收判据** | ① 种一个引用 C08 的 skill → `GET /b/v1/resources/rule/C08/relations` 的 `inbound` 必含它；② **变异反证**：删掉抽取分支 → ① 必须红；③ **合并而非并存** —— 把 `extractRelations` 的 skill 分支并进已接线的 `dril/relations.ts extractResourceRelations`，**两个函数并存正是本病的成因** |

### K6 · 修补当下就在漏的安全面（B-3 / B-7）

| 项 | 内容 |
|---|---|
| **它让平台多推演出什么** | **不增加任何推演。** 之所以进 §3 而不是 §5：这两条是**已经在漏的**，与 Skill 做不做无关 |
| **B-3** | `POST /b/v1/skills/:id/compile` 无 entitlement，对任何 `catalog_admin` 恒开 ⇒ 暗发形同虚设（违 R3） |
| **B-7** | `/metrics` 两服务均无鉴权公开，携带中文业务动作名与全租户合并调用量 ⇒ R2 在可观测面的完整豁免。**这是当下可被利用的信息泄漏面，一天不修风险就在一天** |
| **验收判据** | B-3：功能关 → `404 FEATURE_NOT_FOUND`（不是 403），且 entitlement 检查**在 `auth`/`requireCatalogAdmin` 之前**。B-7：`curl /metrics` 两服务均 **401/403**；**且必须同改 `PUBLIC_PATHS`（`app.ts:851`）与 handler** —— 只改 handler 无效（`onRequest` 在 `:863` 已 return） |

---

## §4 分期交付

> **P0 的判据只有一条**：做完之后，**用户当天能在屏上看到推演结果变了**。
> 「治理更完整了」「门更多了」「报告更详细了」**一律不算 P0**。

### P0 · 让 Skill 真的推演一次（目标：屏上可见）

| WO | 一句话 | 🚦 范围边界（一 WO 一条文件边界） | 出口判据 |
|---|---|---|---|
| **WO-V2-SKILL-EXEC-FIELD** | 给 `SkillDefinitionSchema` 挂上 `execution`（复用**已有**的 `SkillExecutionSchema`，不新造形状） | `packages/contracts/src/agentcore.ts` · `packages/contracts/test/` | 契约含 `execution?: SkillExecution`；存一个带图的 Skill 再读出来，图逐字节相等；**变异反证**：摘掉字段 → 测试红 |
| **WO-V2-SKILL-EXEC-RUN** | 让用户问句能触发 Skill 自带的图（`GraphScheduler` 从旁挂接进答题路） | `apps/agentcore/src/router/orchestrator.ts` · `apps/agentcore/src/engine.ts` · `apps/agentcore/src/skill-orchestrator.ts` · `apps/agentcore/test/` | **SEAM**：用户问句 → 响应 `source==="execution.graph"` + 两节点并发；**不直调** `/skill-graphs/run`（直调不算） |
| **WO-V2-SKILL-EXEC-FE** | 屏上能看见这张图跑起来（步骤/状态/耗时） | `apps/frontend-shell/src/pages/admin/SkillStructure.tsx`（或新建 SkillRunPanel）· `apps/frontend-shell/src/api/endpoints.ts` · `apps/frontend-shell/test/` | 前端 `skill-graphs`/图执行的消费方 **从 0 变成 ≥1**（今日金丝雀 0/15，见 §1.2）；真浏览器可见节点状态 |
| **WO-V2-SKILL-PRECOND-2PATH** | K2：precondition 门收敛到**唯一**判据，两条 `loadSkill` 共用 | `apps/agentcore/src/engine.ts` · `apps/agentcore/src/router/orchestrator.ts` · `apps/agentcore/src/mocks/seed.ts` · `apps/agentcore/test/` | 两条路各一条 SEAM 均绿；`skl_seed_capacity_action` 挂到 ≥1 个 agent；变异反证删掉自由问答路求值 → 红 |

> **P0 一句话验收**（给仓主的**亲手真跑**判据，不接受截图/测试绿）：
> 登录 demo → 对话坞问一句命中新技能的话 → **屏上出现多步推演过程，且两次问路径相同**；
> 再问一句「按这个方案生成行动计划」而没先跑推演 → **平台明确说「先跑推演」**，不编计划。

### P1 · 让 Skill 值得写（选路 + 预算 + 影响面）

| WO | 一句话 | 🚦 范围边界 | 出口判据 |
|---|---|---|---|
| **WO-V2-SKILL-TRIGGER** | K3：`examples[]` 触发面 + 选路接线 | `packages/contracts/src/agentcore.ts` · `apps/agentcore/src/router/` · `apps/agentcore/src/skill-lint.ts` | 效果层：挂/不挂技能，**推演路径**不同 |
| **WO-V2-SKILL-BUDGET-EFFECT** | K4：`maxBudgetRounds` 接进答题路（**只收紧不放宽**，复用 `skillBudgetOverride` 单源） | `apps/agentcore/src/router/orchestrator.ts` · `apps/agentcore/src/engine.ts` · `apps/agentcore/test/` | `2` vs `6` → 真实往返次数不同 + `2` 落 `degrade`；拒收运输层断言 |
| **WO-V2-SKILL-REFGRAPH** | K5：把 `extractRelations` 的 skill 分支**合并进** `relations.ts`（不是两份都留），删死函数 | `apps/agentcore/src/dril/relations.ts` · `apps/agentcore/src/dril/resource-projector.ts` · `apps/agentcore/src/dril/resource-registry.ts` · `apps/agentcore/test/` | C08 反查 `inbound` 含 skill；变异反证红；**`extractRelations` 的 src 调用方从 0 变 ≥1，或该函数消失** |
| **WO-V2-SKILL-SEC** | K6：B-3 entitlement + B-7 `/metrics` 鉴权（**两处同改**） | `apps/agentcore/src/server.ts` · `apps/datacore/src/app.ts` · `apps/datacore/src/features.ts` · `apps/agentcore/src/features/registry.ts` | 功能关 → 404；`/metrics` → 401/403；**变异反证**：只改 handler 不改 `PUBLIC_PATHS` → DataCore 侧必须仍红 |

### P2 · 结构性收敛（大、慢、且不改变当天屏上的东西）

| WO | 一句话 | 前置 | 备注 |
|---|---|---|---|
| **WO-V2-SKILL-REQUIRES** | C-1：落 `requires` 结构（仓主 2026-08-03 已裁决），`references[]`/`dependsOn[]` 降为**解析期输入别名** | K1 完成 | 裁决已两年悬空；但它**不改变屏上任何东西**，所以排 P2 |
| **WO-V2-SKILL-FANOUT-MERGE** | runtime G1 后半：把 4 套扇出（`workflow/executor.ts` 串行 · `multi-route.ts` · Coordinator · `GraphScheduler`）收敛 | K1 完成 | S1 为交付把扇出从 3 套变 4 套，**债挂在这**（本体 §8 `G-SERIAL-GRAPH-EXECUTION`） |
| **WO-V2-SKILL-M2** | migration M2 权威翻转（32 意图改读 `Skill.execution`） | K1 + `skill-plan-parity` 门 | **只有在 K1 跑通、且一致性门有牙之后才允许开工**。否则是在没有油箱的车上换发动机 |

---

## §5 砍掉与降级（不敢砍就是把决策推给仓主）

> 五份 PRD 3,854 行（本单 `wc -l` 实测：907+789+747+751+660）不可能全做。以下逐条给理由。
> **判据统一**：这一条**让平台多推演出什么**？答不出来 → 砍或降。

### 5.1 建议**直接砍掉**（本轮不做，且不再排期）

| # | 条款 | 出处 | 砍的理由 |
|---|---|---|---|
| **X-1** | `.skill` 包 / `manifest.json` / `signature/` / 验签 / 包分发 | compiler §6（O6） | **零推演价值 + 真实新依赖**。仓里今天**无任何制品签名机制**、**无 YAML 解析器、无 zip/tar 库**（compiler §2.2 自己核实的）。这套东西解决的是「Skill 跨租户/跨部署分发」，而平台今天**连一个 Skill 能推演都还没做到**。**先有能跑的东西，再谈怎么分发它。** |
| **X-2** | 生命周期扩到 DRAFT→TESTING→PUBLISHED→DEPRECATED→RETIRED | compiler §5.1（O4/O5）+ `supersedes` 一等字段 | **纯治理面**。新增两个枚举值要求「同一 PR 把所有 `status === "PUBLISHED"` 判定点收敛为契约谓词」（compiler §5.1 自己写的），成本高、风险实（漏一处消费方就把老路打崩），**换来的用户可见变化 = 0** |
| **X-3** | Learning Loop（人工采纳率回流 / `SkillOutcomeStat` / 自动调参） | governance §5 | **它的两个 P0 硬前置（B-6/B-7）都没闭**，且 governance 自己判定「在错的、且公开裸奔的指标上建学习闭环 = 学到的东西也是错的」。**同意这个判断，并把结论推到底：既然前置一年没闭，说明它优先级本来就不在这**。P0-B 单独提出来修（K6），因为它是安全面；学习闭环本体砍掉 |
| **X-4** | 17 道新门里的 14 道 | 五份 PRD 合计 | 见 §2.4。**门不是产出，门是产出的护栏**。今天的比例是「17 道门守 0 条推演能力」。**只留 3 道**（§5.4） |
| **X-5** | Skill 权限三面（data/tool/action）完整表 | governance §3 | 降级为**只保留判据单源的红线**（不许出现第二个判定出口），**不做**权限表本身。理由：Skill 今天能做什么由「挂在哪个 agent 上」决定，而 P0 之后会由「它的图声明了哪些节点」决定 —— **图本身就是权限声明**，再建一张权限表就是第二份真源 |
| **X-6** | `SkillRuntimePackage` / `digest` / 编译产物落库（新表 `skill_runtime_packages`） | compiler §4.5 / §9.2 | 编译产物今天是**只读投影**（`compile` 端点不落库，`server.ts:1463` 注释即「只读操作：不落库、不改状态、不发领域事件」）。**这是对的**。落库 + R9 四处同改，换来的是「编译结果可缓存」——**不是推演价值** |

### 5.2 建议**降级**（不砍，但排到 P2 之后 / 缩到最小形态）

| # | 条款 | 降成什么 | 理由 |
|---|---|---|---|
| **Y-1** | compiler 的 Optimizer（拓扑排序 / 并行分组 / 剪枝 / 常量折叠 / 预算下推） | **砍掉「优化」，只保留「拓扑分层」** —— 而这一条 `GraphScheduler` 已经做了 | 「优化」在一个还没跑起来的东西上是负价值：它会破坏 R6 的可解释性，且没有任何性能数据支持它必要 |
| **Y-2** | RG 组 13 条诊断码（RG-RULE/SOLVER/TYPE/SLICE/TOOL/MCP/…） | **缩到已经在跑的 3 种 kind**（solver/rule/ontologyType，`skill-publish-gate.ts crossSystemSkillRefs` 已实现）+ 新增 `slice` 一种 | 其余 4 种（constraint/workflow/agent/tool/mcp）今天**无人引用**：出厂 7 个技能的 `references` 里只出现 `solver` 与 `skill`。**先补有数据的那几种** |
| **Y-3** | `SkillCompileReport` 的逐条诊断 + 修复指引 | **保持现状不扩** | B-2 已落地且有 UI。够用了 |
| **Y-4** | migration M0 影子声明（32 意图 → 32 Skill 机械导出） | **降为「按需导出 3 个」** | 导出 32 份没人消费的影子声明，正是本仓反复吃亏的「填了字段没消费方」。**先让 3 个真的跑起来（K1），再决定要不要批量** |
| **Y-5** | `execution.mode: DETERMINISTIC` 红线（A-7） | **二选一，不许维持现状**：① K1 里接上读点（编译期断言「DETERMINISTIC 图内无 agent/compose 节点」）；② **删掉这个字段** | 现状是最坏的：**契约注释在说谎** —— 它承诺了一条红线，而没有任何一处会红。留着比删掉更危险 |

### 5.3 明确**不做**（反向断言：做了反而是缺陷）

- **不做**第二条 Skill 注入路径。K1 必须复用 `selectTenantSkills → buildSkillSection` 那一条（本体 §8 `G-SKILL-UNREACHABLE-FREE-QA` 闭合时立的规矩）。
- **不做**第二份步骤形状真源。`Skill.execution.steps` 的语义校验必须调 `workflow/validate.ts validatePlanSteps`，**一行不重写**。
- **不做**第五套扇出。K1 复用 `GraphScheduler`；**不许**因为「接进答题路不方便」而再写一个调度器。
- **不做**别名回退。`execution.plan[]` / `plan.steps` / 顶层 `steps` 一律不读 —— 名字对不上就该**空得刺眼**（`skill-graph.ts:329` 裁决原文）。

### 5.4 门账收口：17 道 → **3 道**

| 保留的门 | 守什么 | 为什么它值得存在 |
|---|---|---|
| **`skill-exec-effect:check`**（新） | K1 的**效果层**：存在 ≥1 个带 `execution` 的 Skill，且它经**用户问句**跑通过（不是直调端点） | 这是唯一一道能咬住「Skill 真的在推演」的门 |
| **`skill-budget-effect:check`**（新，migration 硬约束④原样保留） | K4：改 `maxBudgetRounds` → 真实往返次数真变 | 它自带「什么样是**假过**」的定义（拒收运输层断言），是本套 PRD 里写得最好的一条判据 |
| **`ref-closure:check`**（**已存在**，不新建） | B-1 引用闭包，已在 `pnpm gates` 链内 | 已落地、有牙、有变异反证 |

其余 14 道（`skill-compiler` / `graph-runtime` / `progress-reachability` / `metrics-tenant` / `skill-permission` / `growth-hitl` / `skill-trace` / `skill-refs` / `skill-ref-closure` / `skill-export` / `skill-business-intent` / `skill-plan-parity` / `skill-single-source` / `skill-entitlement-single`）**砍掉或延后**：

- `skill-plan-parity` / `skill-single-source` / `skill-entitlement-single` → **随 P2 的 M2 一起排**（M2 不做，它们无意义）。
- `metrics-tenant` → 随 X-3（学习闭环）一起砍；B-6 本身降为「修 B-7 时顺手加租户标签」，不单独立门。
- 其余 → 砍。

> **并附一条机制**（铁律 0.6 二级处置 —— 「门数」这个数字已经漂了三次，第二次就该建机制）：
> **门总数不许再写死在任何文档里**。要报门数，一律用可复跑命令：
> `node -e "console.log(require('./package.json').scripts.gates.split('&&').length)"`。
> 本文 §2.4 的表格保留三列历史值，**是为了展示漂移本身**，不是为了被引用。

---

## §6 本体引用与影响（铁律 0 · 强制）

### 6.1 触及对象类型（本体 §2）

- **H 域（AgentCore）**：**Skill**（`SkillDefinition`）· **SkillGraph / Reasoning Graph** · **SkillAst / SkillReasoningGraph / SkillCompileResult** · **Agent** · **Intent** · **ExecutionPlan / Workflow**（只读，不改语义）· **ResourceDescriptor / SkillResource**（DRIL）· **EvalCase/EvalRunReport**
- **被引用（校验目标，不改其真值源）**：C 域 **Rule** · E 域 **Solver / SolverArtifact** · B 域 **ObjectType / SliceSpec**
- **本 PRD 不新增对象类型**。K1 复用已存在的 `SkillExecutionSchema` / `SkillGraphSchema`（`packages/contracts/src/skill-graph.ts`），**只是把它挂到 `SkillDefinitionSchema` 上** —— 这是**字段新增**，不是新对象类型。
  - ⚠️ **明确否决**新增 `SkillRuntimePackage` / `SkillPackageManifest` / `SkillCompileReport` 三个对象类型（compiler §0 提出），理由见 §5.1 X-1/X-6。

### 6.2 触及链路（本体 §3）

| 链路 | 本 PRD 的改动 |
|---|---|
| `编排链`：`Query --classify--> Intent --planRef--> ExecutionPlan --step--> {Solver\|SliceSpec\|Rule\|render}` | **P0/P1 不改**。K3 在**选路**这一跳**加一个来源**（技能触发面），不改 path-A 的执行语义 |
| `Skill 引用链`：`Skill --references\|dependsOn--> {rule\|constraint\|slice\|ontologyType\|solver\|skill\|workflow\|agent}` | K5 把这条链**接进资源关系图**（今天只在校验器里活着，图里一条边都没有） |
| **新增**：`Skill --execution--> SkillGraph --node--> {Solver\|Skill} --> Answer` | **这是本 PRD 的核心新链路**。今天 `Skill` 与 `SkillGraph` 之间**没有边**（契约无 `execution` 字段），K1 把这条边接上 |
| `Skill --evaluatedBy--> EvalCase(suite=skill_quality)` | 不改 |
| 切片 | `sys.orch.query_to_answer`（D7）· `sys.meta.change_loop`（D11，本 PRD 自身走这条） |

### 6.3 触及事件（本体 §4）

- **复用**既有 `skill.published`（L4 环，生产者 `POST /b/v1/skills/:id/publish`；订阅声明 `apps/agentcore/src/event-subscriptions.ts`）。**发布语义扩展但事件名不变**。
- **本 PRD 明确不新增事件名。** 特别是：
  - **否决** compiler §0 提出的 `skill.compiled`（编译不落库、无下游消费页失效需求 ⇒ 新增即违 R10 的「必有订阅方」）。
  - K1 的图执行进度**复用**既有 `step.completed` 伪 step 承载（同 `agent_escalated` 的做法，本体 §2.H Loop Control 段），**不新增 §8.2 事件名，前端零改**。
- **既有 D-29 缺口，本 PRD 记录但不修**：`POST /b/v1/skills/:id/retire` 不发领域事件（compiler §0 已登记）。

### 6.4 触及不变量（本体 §5）

| 不变量 | 本 PRD 的义务 |
|---|---|
| **R1** contracts-only-shared | `execution` 字段落 `packages/contracts`；调度器实现只在 AgentCore |
| **R2** tenant_id everywhere | 图执行的所有仓储读取经 `a.tenantId`（`GraphScheduler` 已守，`server.ts:1434` 注释在册） |
| **R3** entitlement 先于 authz | **K6 必修项**：`skill.compiler` 双注册 + 检查放在 `auth`/`requireCatalogAdmin` **之前** + 关闭返 **404**（不是 403）。K1 的图执行接线同样须暗发（`defaultOn:false`），**双注册** `apps/datacore/src/features.ts` + `apps/agentcore/src/features/registry.ts` |
| **R4** 真值写入经 Action | 图里的写节点一律走既有 `create_action_draft`；判定**只用** `isWriteModeSkill`（`packages/contracts/src/agentcore.ts:201`）这一处，不造第二个判定出口 |
| **R6** 确定性 | 图编译是纯函数；同 Skill 同问句两次编译逐字节一致。**Parser/调度器禁 `Date.now()`/`Math.random()`** |
| **R7** 错误信封 | 沿用；图编译失败 → 既有 `SkillGraphCompileError` → 422（`server.ts:1445-1449`） |
| **R9** 仓储双实现 | **本 PRD 不新建表**（X-6 砍掉 `skill_runtime_packages`）。`execution` 挂在既有 `skills.definition` JSONB 内 ⇒ **无 migration** |
| **R10** D-29 | 零新事件（§6.3），故无新订阅义务 |
| **R11** 全链闭包 | K1 的图**必须以 render 收口** —— 见 §6.5 对 `G-SKILL-GRAPH-NO-RENDER-CLOSURE` 的处置 |
| **R13** 结论可溯源 | K2 的本质就是 R13 的前置（没有推演就没有可溯源的数字）；图每个节点的输出须带 provenance |
| **R14** 应用层无业务常数 | 技能声明里不得内联基地名/型号/阈值 |
| **R15** CLI 对等 | K1 新增的对外能力须有 CLI 或 GUI 深链。**⚠️ 已知洼地**：`POST /b/v1/skills/:id/compile` 至今未进 `OPERATION_CATALOG`（`packages/contracts/src/skill-compile.ts:151` 自报 `R15 缺口`），`cli-parity:check` 因只从目录派生故不红 —— **这是「门量不到的洼地」**，K1 不得再制造第二个 |
| **R16** 发育闭环 | Skill 缺引用 → 不静默残缺，开 `GrowthTicket` |
| **R17** 决策单页 | WO-V2-SKILL-EXEC-FE 的图执行面板须就地下钻不跳页 |

### 6.5 触及断点（本体 §8）· **含新断点登记要求**

| 断点 | 现状 | 本 PRD 的影响 |
|---|---|---|
| `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` | ◐ 三处分别定性：① 死抽取器 🔴未修 · ② `dependsOn` 数据已从 0→1 · ③ 发布路探针 ✅已修 | **K5 关闭 ①**。关闭后须回写本体 §2.H「Skill 资源投影」订正段 + §8 本条状态 |
| `G-SKILL-UNREACHABLE-FREE-QA` | ✅ 已闭（暗发 · 默认关） | **K3 触及**：若决定把 `agent.skill-on-free-qa` 转正（默认开），须回写本条的「默认关」表述 |
| `G-SKILL-GRAPH-NO-RENDER-CLOSURE` | **开**（S1 刻意未做：`render` 节点本身仍 `NOT_IMPLEMENTED`） | **K1 必须同时处置**：要么实现 `render` 节点并补 R11 可达性校验，要么在 §8 明写「K1 的图仍不收口」。**不许沉默通过** |
| `G-SERIAL-GRAPH-EXECUTION` | ◐ 部分处置：S1 新增第 4 条独立路径，三处既有扇出一处没动 | P2 的 `WO-V2-SKILL-FANOUT-MERGE` 关它；**P0/P1 期间这条债只增不减，须在本体如实标注** |
| `G-BE-FE-SEAM-DEAD` | 开（`skill-graphs`/`compile`/`execution`/`dependsOn`/`maxBudgetRounds` 前端消费方全 0） | **WO-V2-SKILL-EXEC-FE 关掉 `skill-graphs` 那一条**（0 → ≥1）；其余仍开 |
| `G-SIDEEFFECT-VOCAB-SPLIT` | 已闭 | K1 所有词表一律 `import` 自 `@platform/contracts`，**禁止手抄枚举** |

**⚠️ 需要新登记的断点（本 PRD 发现，须写进 `docs/SYSTEM-ONTOLOGY.md` §8）——本单只提出，不改本体文件：**

| 拟登记 ID | 断点描述 | 链路位置 | 拟定性质 |
|---|---|---|---|
| **`G-SKILL-EXEC-FIELD-ABSENT`** | `SkillDefinitionSchema` 无 `execution` 字段 ⇒ **没有任何 Skill 能携带自己的推演图**，`GraphScheduler` 只能吃 HTTP 请求体传进来的图。形态 = **接了线没数据**（引擎在、数据入口不在），**不是**「没实现」 | `SkillDefinition` ⊗ `SkillExecutionSchema` → `GraphScheduler` | 开（K1 关闭） |
| **`G-SKILL-PRECOND-ONE-PATH-ONLY`** | solver 类 precondition 的门只挂在 `engine.ts:471`（注册 agent 路的 `loadSkill`），自由问答路的 `loadSkill`（`router/orchestrator.ts:2056`）**无任何 precondition 求值** ⇒ 同一技能走哪条路，门开不开是两个答案。形态 = **接了线接错地方**（少一个挂载点） | `loadSkill` ×2 出口 → `unmetSolverPreconditions` | 开（K2 关闭） |
| **`G-SKILL-EXEC-MODE-LIES`** | `execution.mode: DETERMINISTIC` 在契约注释里承诺了「图内不得出现 LLM 节点」这条红线，**全仓零读点** ⇒ 注释在说谎。形态 = **只有声明没有实现**，且比「没写」更危险（读者会以为红线在守） | `packages/contracts/src/skill-graph.ts:395` → （无消费方） | 开（Y-5 二选一处置） |

> **回写承诺**：本 PRD 落地后须回写 `docs/SYSTEM-ONTOLOGY.md`：
> **§2.H**（`Skill` 条目补 `execution` 字段 + 修正「Skill 资源投影」订正段）·
> **§3**（新增 `Skill --execution--> SkillGraph` 链路）·
> **§5**（若 K4 落地，`maxBudgetRounds` 的「未接面（诚实边界）」段须改写）·
> **§7**（新增 `skill-exec-effect:check` / `skill-budget-effect:check` 两道门；**同时删除**本体里对已砍门的任何承诺）·
> **§8**（登记上表三个新断点 + 更新 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` / `G-BE-FE-SEAM-DEAD` 状态）。
> **本体不回写即过期失效。** 本单**不改本体文件**（范围边界），只在此写明须回写哪一节。

---

## §7 诚实边界

> 逐条列出：我没判定的、时间不够的、需要跑起来才知道的、以及引用他人实测未复跑的。

### 7.1 本单的工作方式边界

1. **只读代码 + 静态 grep，未跑任何测试套件，未跑 `scripts/gate.sh`，未起服务真跑一次问答。** 工单明令禁止（仓主在跑组合门，4 核机）。故本文**所有「能不能跑通」的判断都是结构性推断，不是实测**。
2. **未跑 `pnpm install`**（worktree 无 `node_modules`）。故未做任何 `tsc --noEmit` 验证；§4 的 WO 拆分中「改哪些文件」是按 import 关系推断的，实施时可能需要扩边界。
3. **§2 对账表覆盖的是各 PRD 自己声明的「目标 / 硬约束 / P0 前置」共 28 条 + 17 道门**，**不是** `docs/CHECKLIST-skill-4209.md` 提取的 **1365 条**。逐条复验 1365 条在本单时间内不可能完成 —— 我选择了**载荷最重的那 28 条逐条给证据**，而不是给 1365 条各写一个未经核实的状态。**这是有意的取舍，不是遗漏。**

### 7.2 明确**未判定**的条款

| 条款 | 为什么没判 |
|---|---|
| **B-11** 生长回路的角色门 / R4 审批位（governance §6） | 未验。需要读 `server.ts:236` 附近的实际中间件链 + `catalog/service.ts publishIntent`，本单时间用在 A 组了。governance §1.4 的锚点可信度未复核 |
| **B-10** Prompt 版本化 | **引用 governance §1.2 的实测（`promptVersion` 全仓 0 命中），本单未复跑该 grep**。标记为「引用他人实测」而非「本单核实」 |
| **A-9 的效果** | 我核实了 `agent.skill-on-free-qa` 是 `defaultOn:false`，但**没有核实**「demo 租户的 features 解析结果里它到底是开是关」—— DataCore 的 feature 解析有 `QOS_DARK_LAUNCH_FEATURES` 排除集与「all on」模板的交互（本体称 battery「all on」模板也不顺带开它）。**结论方向应该是对的，但我没亲手证到租户解析这一层** |
| **K1 的真实工作量** | 「把 `GraphScheduler` 接进答题路」我只读到了两条路径的入口（`engine.ts:412` / `orchestrator.ts:2000`），**没有读完** `runPathB` 的完整分支树。接线点可能不止一处，也可能有我没看到的前置（如 `expectsSchema` / `emitNarration` 之类的透传约定） |
| **K3 的可行性** | 「让 Skill 参与选路」需要读 `router/orchestrator.ts` 的 classify 段与 `domain-resolver.ts`，**本单完全没读**。K3 的验收判据是我按 K1 的形状类推写的，**实施前必须先做一次真正的选路链路调研** |

### 7.3 需要**跑起来才知道**的

1. **P0 的一句话验收（§4）我没法在本单验证。** 「登录 demo → 问一句 → 屏上出现多步推演」必须真浏览器跑。本文写的是**判据**，不是**结论**。
2. **`GraphScheduler` 今天到底能不能跑通一个两节点图** —— 我读到了它的结构与 SEAM 测试的存在（`skill-orchestrator.seam.test.ts`，18 条绿，引用自 compiler PRD §1.2 的复验段），**但本单没跑过它**。若它的 SEAM 是在 mock DataCore 上绿的，K1 接进真答题路时可能暴露新的接缝问题 —— **「绿测试 ≠ 能用」在这里完全适用**。
3. **A-6 的「屏上答案一个字不变」** 是结构推断（唯一 src 读点在 skill-probe）。严格证明需要「改 `maxBudgetRounds` 前后各跑一次同一问句，比对答案字节」，本单未做。

### 7.4 我可能错的地方（预先标注，便于被顶回来）

1. **§1 的定性「Skill 不在推演链上」可能过于绝对。** rule 类 precondition/postcheck 会真的拦答案（`engine.ts:364/505`），这在语义上是**参与了结论的形成**。我把它归为「闸」而非「推演」，是**我的口径选择**，可以被反对。若仓主认为「拦下一个错答案也是推演价值」，§3 的排序要改。
2. **§5 砍掉 X-2（生命周期扩展）可能过激。** 若已有租户在生产上依赖「顶替旧版本」的语义，DEPRECATED 就不是纯治理面。我**没有核实是否有这样的租户**。
3. **§2.4 的「17 道门」沿用 crossreview §3 的去重结果，本单只复验了它们「不存在」，没有复验「去重后确实是 17 道」。** 这个数本身可能也是错的 —— 而这正是 §5.4 那条机制要治的病。
4. **本文自己也写了一堆数字**（907/789/747/751/660 行、7 个技能、29 道门、0/15 金丝雀）。**这些数会漂。** 每个数我都给了复跑命令；**读到本文的下一个人，请先跑一遍再引用。**「我没找到」和「它不存在」是两个不同的命题 —— 同样，「文档里写着 29」和「今天是 29」也是。
