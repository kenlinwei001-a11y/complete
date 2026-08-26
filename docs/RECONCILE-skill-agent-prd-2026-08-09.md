# RECONCILE · Skill / Agent PRD 与两份外部规格的对账（2026-08-09）

| 项 | 值 |
|---|---|
| 工单 | WO-SKILL-AGENT-PRD-RECONCILE |
| 性质 | **纯对账 · 只读取证 · 不改一行代码** |
| 取证基线 commit | **`319d6e94df008b19b600e7b0361176122599397b`**（= `origin/claude/inspiring-gates-aqczjg`，canonical） |
| 分支 | `claude/handoff-skill-agent-reconcile` |
| 被对账规格 | ①《Skill Runtime Engine 内部 DDD 设计说明书 V1.0》 ②《Industrial Skill SDK + Runtime API Design Specification V1.0》 |

> **所有 `file:line` 只对 `319d6e94` 有效。** 换 commit 必须重取证。

## 0. 起手纪律与工具自证（铁律 0.5 / 0.6）

### 0.1 我一开始站错了分支 —— 这步救了整单

默认 worktree 停在 `778cc589`（= `refs/heads/main`）。`git merge-base --is-ancestor` 实测该 commit
**是 canonical 的祖先**，即我比 canonical **落后**。若就地取证，会把 canonical 上已并线的东西读成"不存在"。
已从 `origin/claude/inspiring-gates-aqczjg` 重开分支后再取证。

### 0.2 金丝雀（报任何否定结论前的强制自证）

| 工具 | 金丝雀（已知必中） | 结果 | 反向金丝雀 | 结果 |
|---|---|---|---|---|
| `git rev-parse --verify -q` | `HEAD:CLAUDE.md` | `c7ad41a1` RC=0 ✅ | `HEAD:apps/agentcore/src/THIS-FILE-DOES-NOT-EXIST.ts` | 无输出 RC=1 ✅ |
| `grep -rn` 符号扫描 | `SkillDefinitionSchema` in src | **6** ✅ | `ZZZ_NOT_A_REAL_SYMBOL_ZZZ` | **0** ✅ |
| 路由抽取 | `/api/v1/queries` | 命中 ✅ | — | — |
| `outbox.emit` 第 2 实参抽取 | 48 个事件名 | 命中 ✅ | — | — |
| agentcore `emit` 第 2 实参 | `answer.final` | **25** ✅ | — | — |
| 表名抽取 | `CREATE TABLE` in migrations | **27 张** ✅ | — | — |

**⚠ 本单我自己踩中并当场纠正的三个工具陷阱**（照铁律 0.6 记账）：

1. **`emit` 的事件名不在固定位置**。`this.deps.events.emit(taskId, "x", p)` 名字在第 2 位，
   但 `opts.emit("step.started", p)` 名字在**第 1 位**。只扫第 2 位会漏掉 `step.started`。
   → 必须两个位置都扫再取并集。
2. **`outbox.emit` 全是 DataCore 的**。全仓 62 处非测试命中，**agentcore 一处都没有**——
   B 侧用的是另一套 `TaskEvents.emit`。拿 A 侧词表去判 B 侧事件必然全错。
3. **我自己用错了符号名**：查"空响应护栏"时先 grep `emptyResponse` → 0 命中，
   差点报"未实现"；真实符号是 `LlmEmptyResponseError`，**实际 10 处 src 引用、完整接线**。
   这正是"我没找到 ≠ 它不存在"的当场复现。

---

## 1. 第 1 步 · Skill / Agent PRD 全集（14 份，全部存在）

工单点名的 14 份**全部存在**于 `319d6e94`，文件名无误。我另扫出 5 份强相关文档一并列出。

| # | 文件 | 性质 |
|---|---|---|
| 1 | `docs/PRD-skill-runtime-orchestrator.md` | 设计（Reasoning Graph 运行时） |
| 2 | `docs/PRD-skill-compiler-registry.md` | 设计（编译器/CLI/包格式） |
| 3 | `docs/PRD-skill-contract-dsl.md` | 设计（Skill 契约字段） |
| 4 | `docs/PRD-skill-crossreview.md` | **审查报告**（审上面 5 份，非可施工 PRD） |
| 5 | `docs/PRD-skill-governance-learning.md` | 设计（治理/学习/Prompt 版本） |
| 6 | `docs/PRD-skill-migration.md` | 设计（迁移分期） |
| 7 | `docs/PRD-addendum-skill-authoring.md` | 增量（编写规范/lint/发布门） |
| 8 | `docs/SPEC-industrial-skill.md` | 上游 SPEC（12 层结构） |
| 9 | `docs/PRD-addendum-agent-runtime.md` | 增量（MCP 命名空间/上下文治理） |
| 10 | `docs/PRD-agent-execution-governance-loop-control.md` | 设计（Loop Detector/升级阶梯） |
| 11 | `docs/PRD-agent-react-harness.md` | 设计（反思闭环/七要素 Harness） |
| 12 | `docs/PRD-agent-data-generation-tools.md` | 设计（3 把产数据工具） |
| 13 | `docs/PRD-agent-navigation-slice-latency.md` | 设计（导航切片/时延） |
| 14 | `docs/PRD-llm-agent-empty-response-guard.md` | 修复（空响应护栏） |
| +1 | `docs/ASSESS-pi-agent-harness-replacement.md` | 评估（换 harness，结论：不换整体） |
| +2 | `docs/PRD-addendum-replay-orchestrator.md` | ⚠ **不是 Decision Replay**，见 §3.4 |
| +3 | `docs/WO-QOS-2-AGENT-SPEEDUP.md` / `docs/00-START-HERE-AGENT-CONTRACT.md` / `docs/PARALLEL-AGENT-PROTOCOL.md` | 工单/协议 |

---

## 2. 第 2 步 · 逐份对账

判据：**「有生产调用方」= 在 `apps/*/src`、`packages/*/src`、`scripts/` 下的非测试引用，且已追一层确认真会被调到。**

### 2.1 `PRD-skill-runtime-orchestrator.md` —— 核心交付物**零实现**

该 PRD 自我定位就是「把目标形态**翻译成**可施工设计」，不是完工记录。其核心构件：

| PRD 声称的构件 | 契约里有吗 | 代码里有吗 | 生产调用方 | 三分法定性 | 测试咬函数还是链路 |
|---|---|---|---|---|---|
| `compileGraph`（plan.steps→图） | ❌ | ❌ **0 命中** | — | **未实现** | 无测试 |
| `GraphScheduler`（拓扑波前并行） | ❌ | ❌ **0 命中** | — | **未实现** | 无测试 |
| `ReasoningGraph` 对象 | ❌ | ❌ **0 命中** | — | **未实现** | 无测试 |
| `reasoningGraphRun` 留痕 | ❌ | ❌ **0 命中** | — | **未实现** | 无测试 |
| 暗发键 `qos.reasoning-graph` | ❌ | ❌ **0 命中** | — | **未实现** | 无测试 |
| `Skill.maxBudgetRounds` 接真消费方 | ✅ `agentcore.ts:260` | 仅契约声明 | **0**（唯一 src 命中是声明本身） | **没接线（只有 test 引用）** | 咬**函数**（`skill-contract.test.ts:65,77` 只断言字段能存能读） |
| `routing.completed` 补 `routeSource` | ✅ | ✅ 15 处 src | ✅ | **已实现已并线**（但由 WO-DETERMINISTIC-CROSS-DOMAIN 交付，非本 PRD） |

> 金丝雀：同一 glob/路径下 `PlanStep` = **37 命中**，证明扫描工具正常；上表 5 个 0 是真 0。

**`maxBudgetRounds` 是本仓「假绿第 9 形态」的活样本**：契约有字段、测试有断言且是绿的、
**零生产消费方**——测试咬的是"这个字段能被 zod 解析"这个**函数**行为，不是"预算真的被执行器用上"这条**链路**。
PRD 明写要把它"由零消费方接上真消费方"，至今**仍是零**。

### 2.2 `PRD-skill-compiler-registry.md` —— 七段流水线**只落地 1 段**

`DSL → Parser → AST → Validator → Optimizer → Execution Graph → Runtime Package`

| 段 | 今天的等价物 | 定性 |
|---|---|---|
| DSL | Markdown `body` + zod 校验的 `SkillDefinition` 字段 | **形状不同的等价物**（非独立 DSL） |
| Parser | `SkillDefinitionSchema.parse`（zod） | **等价物存在**（非独立 parser） |
| AST | 无 | **未实现**（0 命中） |
| **Validator** | **`lintSkill`（`apps/agentcore/src/skill-lint.ts:234`）** | ✅ **已实现已并线**（发布门 `server.ts:1246` 真调，且传了 `allSkills` + `requirePublishedDeps:true`） |
| Optimizer | 无 | **未实现**（0 命中） |
| Execution Graph | 无（= §2.1 的 `compileGraph`） | **未实现** |
| Runtime Package | 无 | **未实现**（`RuntimePackage`/`SkillManifest` 均 0 命中） |

**CLI（`dos skill create/validate/compile/test/package/deploy`）= 零实现。**
证据：`grep '"bin"' package.json apps/*/package.json packages/*/package.json` → **无输出**；
同一命令 `grep '"scripts"'` → `apps/agentcore/package.json:7` 命中（**金丝雀证明工具正常**）。
`.skill` 包格式 / `manifest.json` / `signature/` 亦全部零实现
（唯一形似命中 `callSignature` 是 `loop.ts:264` 的环检测哈希，与签名无关 —— 假阳性已排除）。

### 2.3 `PRD-skill-contract-dsl.md` —— **大部分已实现已并线**

`SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:236`）字段逐条：

| 字段 | 契约 | 生产消费方（追了一层） | 定性 |
|---|---|---|---|
| `capability` | ✅ :252 | `skill-router.ts:39` 相关性打分 → `prompts.ts:71` → `engine.ts:320` | **已实现已并线** |
| `sideEffect` | ✅ :253 | `isWriteEffectSkill`/`isWriteModeSkill` → `engine.ts:36 skillWriteMode` | **已实现已并线** |
| `inputSchema` | ✅ :254 | 53 处 src | **已实现已并线** |
| `outputSchema` | ✅ :255 | 4 处 src | **已实现已并线** |
| `references` | ✅ :256 | `skill-lint.ts:302` + 发布门；**种子 7/7 有数据** | **已实现已并线** |
| `dependsOn` | ✅ :257 | `skill-lint.ts:212`（环检测）/`:302` | **接了线没数据**（见下） |
| `approvalGate` | ✅ :258 | `isWriteModeSkill` → 探针 + 运行时同源判定 | **已实现已并线** |
| `provenancePolicy` | ✅ :259 | `engine.ts:30 skillProvenancePolicy` | **已实现已并线** |
| `maxBudgetRounds` | ✅ :260 | **0** | **没接线** |

**`dependsOn` 的精确定性（我修正了 `CLAUDE.md` 里一处已过期的表述）**：
`CLAUDE.md` 铁律 0.5 记「`dependsOn` … 7/7 数据为空」。实测 `319d6e94`：
- `dependsOn` 在种子里 **0 处**（`grep -c dependsOn seed.ts` = 0）→ **该结论仍成立**；
- 但 **`references` 已经有数据了**（`grep -c "references:" seed.ts` = **7**，其中 6 个非空，
  如 `seed.ts:1150` 的 `{kind:"solver", key:"risk_timeline"}`）。
  金丝雀：同命令量 `capability:` = 7 ✅。
→ 所以今天的准确说法是：**`references` 已"接了线有数据"，只有 `dependsOn` 还停在"接了线没数据"**。
两者修法不同（前者无需动作，后者要么补种子数据、要么删死分支），不该继续合并成一句话说。

### 2.4 `PRD-skill-crossreview.md` —— 非实现类文档；其结论**今天仍然成立**

这是一份**审查报告**（审 5 份 skill PRD），不产出代码，不适用三分法。
我独立复核了它最要害的一条，**结论一致**：

> 它说：`probeMissingRefs`（`apps/agentcore/src/resources.ts:11`）已接线两处，真实缺口是 **skill 发布路没接**。

我在 `319d6e94` 亲手复核：`probeMissingRefs` 的 src 调用方**恰好两处**——
`server.ts:690`（agent 发布，校验 `scopeDeclaration.objectTypes`）、
`server.ts:1008`（workflow 发布，校验 `solverKeys`/`ruleKeys`）；
而 `POST /b/v1/skills/:id/publish`（`server.ts:1235–1293`）**通篇没有调用它**。
→ **这是「接了线接错地方」（缺挂载点），不是「没实现」。** 后果：skill 的
`references:[{kind:"solver", key:"risk_timeline"}]` 若指向 DataCore 里**不存在**的求解器，
发布门**不会拦**（`lintSkill` 的跨资源校验按 `skill-lint.ts:165` 注释**仅覆盖 `kind=skill` 的本地资源**）。
**修法 = 在 1235 那个 handler 里加一次 `probeMissingRefs` 调用，不是造新门。**

### 2.5 `PRD-skill-governance-learning.md` —— Prompt 版本**部分实现**

| 构件 | 契约 | 代码 | 生产调用方 | 定性 |
|---|---|---|---|---|
| `PromptTemplate`（含 `version`） | ✅ `prompt-template.ts:23-31` | ✅ | `/a/v1/prompt-templates{,/:key,/:key/resolve}` 三条路由 | **已实现已并线** |
| `resolvePromptOverride` | — | ✅ `prompts.ts:240` | ✅ `orchestrator.ts:1255` | **接了线接错地方（覆盖面不全）** |
| Prompt A/B 测试 | ❌ | ❌ | — | **未实现** |
| Agent 主提示词版本化 | ❌ | ❌ | — | **未实现** |

**精确缺口**：`PROMPT_KEYS` 有 5 个键（`classifier`/`extraction`/`modeling`/`skill_summary_lint`/`answer_compose`），
但 `resolvePromptOverride` 的**唯一生产调用点只传了 `"classifier"`**（`orchestrator.ts:1255`）——
另外 4 个键**有契约、有存储、有 REST，就是没有消费方**。
且 agent 的主提示词 `AGENT_SYSTEM_CORE`（`prompts.ts:6`）是**源码字符串常量**，
不在 `PROMPT_KEYS` 里、不可版本化、不进 trace。
→ 该 PRD `:146` 自述的病灶（"Prompt 无版本，且是代码常量"）**至今未解**。

### 2.6 `PRD-skill-migration.md` —— **零实现**

`migrateSkill` 等迁移执行符号 **0 命中**（金丝雀 `SkillDefinitionSchema`=6 ✅）。
未见迁移脚本、未见 `skill.execution` 权威翻转。属**未实现**（文档在、代码零）。

### 2.7 `PRD-addendum-skill-authoring.md` —— **已实现已并线（本批最扎实的一份）**

`POST /b/v1/skills/:id/publish`（`server.ts:1235`）是**三重真门**，且每重都追过一层：

1. **结构 lint**（`:1246`）——`lintSkill(skill, {}, {allSkills, requirePublishedDeps:true})`。
   代码注释本身记着一次已修的假绿：不传 `allSkills` 时跨资源规则会 `return []` 静默恒过。
2. **评测覆盖门**（`:1252-1267`）——`skill_quality` 用例 ≥3 **且**
   `classifySkillEvalCases` 三类（应触发/不应触发/行为增益）各 ≥1。
   注释明写这是"门只数数 → 门真判别"的修正。
3. **评测真跑门**（`:1268-1273`）——`deps.evals.runSkillProbe(...)`，`passRate < 1` 直接 422。

`force=true` 为审计豁免口。发布后 `emitDomainEvent(tenant, "skill.published", …)`（`:1278`）+ 影响面回包。
→ **测试咬的是链路**（发布 HTTP 路径上的真门），不是孤立函数。

### 2.8 `SPEC-industrial-skill.md` —— 上游 SPEC，**部分落地**

12 层结构中：契约层/注册层/校验层/执行层/权限层**有等价物**；
编译层/包格式层/CLI 层/签名层**零实现**（同 §2.2）。

### 2.9 `PRD-addendum-agent-runtime.md` —— **已实现已并线**

| 构件 | 代码 | 生产调用方 | 定性 |
|---|---|---|---|
| MCP 命名空间 `mcp__{server}__{tool}` | `agentcore.ts:100 mcpToolFullName` | 3 处 src | **已实现已并线** |
| 上下文三刀（fold/compact/force_finalize） | `ContextOpSchema`（`qos.ts:703`）；`context.ts` `ContextBudgeter`(3)/`foldOldestFrame`(4) | ✅ | **已实现已并线** |
| `AgentRunRecord.contextOps` 留痕 | `qos.ts:721` | 写端 ✅ | **已实现**（读端受限，见 §3.1） |

### 2.10 `PRD-agent-execution-governance-loop-control.md` —— **已实现已并线（部署态启用）**

Loop Detector：`loop.ts:264 callSignature`（FNV-1a）+ `:987-995` 累计判环 → `STALL_LOOP` 优雅降级。
接线：`orchestrator.ts:2046` / `engine.ts:360` 读 `config.QOS_AGENT_LOOP_REPEAT_CAP`。

> **我在这里差点误判，追一层后自纠**：`config.ts:46` 该 env 是 `.optional()` **无默认值**，
> 代码 `loop.ts:377` 明写 `repeatCap ≤ 0 = 禁用`，我几乎要判"接了线没数据"。
> 再追一层到部署态：**`docker-compose.yml:129` 写着 `QOS_AGENT_LOOP_REPEAT_CAP: ${…:-3}`** ——
> 容器部署里它**是开的**。正确定性是 **已实现已并线（容器态默认 3；裸 `node dist/main.js` 不设则禁用）**。

`agent.escalation` 升级阶梯：`features/registry.ts:108` `defaultOn:false` → **接了线·暗发默认关**。

### 2.11 `PRD-agent-react-harness.md` —— **接了线·默认关（暗发）**

`reflectAnswer`（`agent/reflect.ts:73`）→ `loop.ts:21` import → `loop.ts:312` 调用 → `loop.ts:878` 收尾前反思步。
生产接线点 `orchestrator.ts:2024 reflect: true`，但**被 `reflectEnabled(enabledFeatures)` 包着**（`:2022`），
而 `features/registry.ts:104` 的 `agent.critic` 是 **`defaultOn: false`**。
→ **定性：接了线，但默认租户走不到这条分支。** 这与"没实现"修法不同（开关即可，无需施工）。
七要素 Harness 提示词升级：`AGENT_SYSTEM_CORE` 存在但未见七要素结构化改造，**部分实现**。

### 2.12 `PRD-agent-data-generation-tools.md` —— **已实现已并线**

PRD 要的 3 把工具**全部注册且真分派**：

| 工具 | 注册 | 分派 |
|---|---|---|
| `fill_data` | `tools/registry.ts:295` | `tools/executor.ts:413` |
| `run_synthetic` | `tools/registry.ts:312` | `tools/executor.ts:422` |
| `build_domain` | `tools/registry.ts:329` | `tools/executor.ts:431` |

PRD 立论的病灶（"`BUILTIN_TOOLS` 里根本没有产数据工具"）**已消除**。

### 2.13 `PRD-agent-navigation-slice-latency.md` —— **已实现已并线（含 1 处死代码）**

`projectNavigationSlice` / `renderNavigationSlice` / `navigationSliceSolverKeys`
被 `orchestrator.ts:39` 与 `engine.ts:4` 双双 import → **已并线**。

⚠ **但 `buildNavigationSliceSection`（`navigation-slice.ts:384`）的引用方集合里只有 test**
（`apps/agentcore/test/qos-agent-slice-seam.test.ts:9,125`），零生产调用方。
→ **「没接线」·假绿第 9 形态**：函数在、测试绿、没人用。测试咬的是**函数**（断言两条渲染路径同源），
不是链路。属可清理的小死代码，**不影响该 PRD 主体交付**。

### 2.14 `PRD-llm-agent-empty-response-guard.md` —— **已实现已并线**

| 构件 | file:line | 定性 |
|---|---|---|
| `LlmEmptyResponseError` 定义 | `packages/llm-adapters/src/types.ts:172` | ✅ |
| loop 早失败护栏 | `apps/agentcore/src/agent/loop.ts:821` | ✅ |
| toolLoop 同款护栏 | `packages/llm-adapters/src/toolloop.ts:25` | ✅ |
| R7 信封映射（`code=LLM_EMPTY_RESPONSE`） | `apps/agentcore/src/router/orchestrator.ts:2740` | ✅ |
| 兜底路由（真 LLM 失败 → 确定性兜底） | `orchestrator.ts:2266` | ✅ |

**全链闭合，10 处 src 引用。** 这是 14 份里实现度最高的一份。

---

## 3. 第 3 步 · DDD 说明书 12 领域总覆盖表

| 领域 | PRD 覆盖? | 实现? | 接线? | 缺口一句话 |
|---|---|---|---|---|
| **Skill** | ✅ 6 份 | ✅ `SkillDefinitionSchema`(`agentcore.ts:236`) + `skills` 表 + 三重发布门 | ✅ | 状态机只有 `DRAFT/PUBLISHED/RETIRED` 三态（DDD 要五态）；无 `SkillManifest`/`SkillPermission`；`maxBudgetRounds` 零消费方 |
| **Execution** | ✅ QOS-PRD | ✅ `query_tasks`+`query_events`+`execution_plans` 三表 | ✅ | 表名/状态名与 DDD 全不同：**7 个状态里只有 `COMPLETED`/`FAILED` 两个同名**，阶段态（CONTEXT_LOADING/REASONING/TOOL_EXECUTION/SOLVING/VALIDATION）在本仓是**SSE 事件**不是**任务状态**；无 `TIMEOUT` 独立态 |
| **Agent** | ✅ 6 份 | ✅ `AgentDefinition`+`agents`+`agent_runs`+`fallback_traces` | ⚠ **写端有、用户读端无** | **`agent_trace` 表不存在**；`AgentRunRecord` 七件套只覆盖约 3.5 件；写端 `orchestrator.ts:2075/2364/2614`，**读端只有 `evals.ts:237`（无任何用户可见 API 读它）** |
| **Context** | ⚠ 部分 | ⚠ 有等价物但**不是五段流水线** | ✅（内部模块） | Retriever≈`ontology-context.ts`/`navigation-slice.ts`；**Ranker=`skill-router.ts:51 rankSkills`（真有）**；Compressor=`context.ts ContextBudgeter`；Assembler≈`prompts.ts`；**Validator 缺**（`ValidationTrace` 验的是**答案**不是**上下文**）。**无 HTTP 出口** |
| **Ontology** | ✅ | ✅ DataCore A4 | ✅ | 无（`/a/v1/ontology/*` 40+ 路由，能力最完整的一域） |
| **Tool** | ✅ | ✅ `BUILTIN_TOOLS`(30)+`tools/executor.ts` | ✅ | **无缺口，反而超出规格**：executor 有 8 道关卡（scope→objectType→OBO 过期→IAM→探索配额→预算→执行→本体校验），比规格的 6 段更细 |
| **Rule** | ✅ | ✅ `/a/v1/rules/evaluate` + `evaluate_rules` 步 | ✅ | 无 |
| **Solver** | ✅ | ✅ 57 求解器 + `/b/v1/solvers/:key/run` | ✅ | 无 |
| **Workflow** | ✅ | ✅ `workflows` 表 + `/b/v1/workflows/:id/run` + `workflow/executor.ts` | ✅ | 执行仍是**线性串行 `for…await`**，Reasoning Graph 并行调度零实现 |
| **Memory** | ⚠ 部分 | ✅ `experience_cases` 表 + `search_experience` 工具 + 出厂 50 例 | ✅ | 有等价物但**只读**：读端 `registry.ts:276`/`executor.ts:469`，写端在 `orchestrator.ts:2226` 蒸馏；**无 `/memory/store` HTTP 出口** |
| **Evaluation** | ✅ | ✅ `eval_cases`/`eval_runs` + `EvalService` | ✅ | **接得很深**：`server.ts:1269` 技能发布门、`server.ts:703` agent 发布门都真跑评测 |
| **Runtime（平台层）** | ⚠ 部分 | ⚠ | ⚠ | Skill 版本隔离 ✅ 真有；**Decision Replay ❌ 零实现**；Prompt 版本 ⚠ 只 1/5 键有消费方；执行快照恢复 ❌ 零实现 |

### 3.1 AgentTrace 逐件核（工单点名 + 规格二 §F 合并说）

DDD 的 `AgentTrace` 七字段 vs `AgentRunRecordSchema`（`qos.ts:711`）+ 邻表：

| DDD 字段 | 今天的等价物 | 有吗 |
|---|---|---|
| input prompt | **无**（只存 `model`，不存实际 system/user 文本） | ❌ |
| context snapshot | `contextOps`（`qos.ts:721`）记的是**操作**（fold/compact），不是**快照** | ❌ |
| reasoning steps | `iterations[].index` 有序号；叙述经 SSE `step.completed{type:"agent_narration"}`（`loop.ts:848`）**但不入 `agent_runs`** | ⚠ 半 |
| tool calls | `iterations[].toolCalls[]`（含 `input`/`outcome`/`durationMs`） + `tool_calls` 表 | ✅ |
| tool results | `tool_calls.output` + `output_digest`（`001_init.sql:65-75`） | ✅ |
| decision | `QueryTask.answer` + `DecisionTrace`（`qos.ts:628`） | ✅ |
| confidence | `classification.confidence` —— 但那是**意图分类置信度**，不是**决策置信度** | ⚠ 半 |

**关键接缝断点**：`agent_runs` 的**读端只有 `evals.ts:237`**。
用户可见的三条 trace 路由（`/queries/:taskId/trace`、`/decision-trace`、`/lineage`）
读的是 `repos.toolCalls.listByTask`（`server.ts:427`、`server.ts:460`）与 task 本体，
**从不读 `agent_runs`**。→ **`agent_runs` 对最终用户实质是只写不读**。
这是「接了线接错地方」：写链完整、读链没接到用户面。

### 3.2 Execution 状态机差多少

| DDD 期望 | 本仓 `QueryTaskStatusSchema`(`qos.ts:269`) | 对应 |
|---|---|---|
| `CREATED` | `ROUTING` | 近似 |
| `CONTEXT_LOADING` | — | ❌ 无（是事件不是状态） |
| `REASONING` | `EXECUTING_AGENT` | 近似 |
| `TOOL_EXECUTION` | — | ❌ 无（`step.started/completed` 事件） |
| `SOLVING` | `EXECUTING_WORKFLOW` | 近似 |
| `VALIDATION` | — | ❌ 无（`ValidationTrace` 是产物不是状态） |
| `COMPLETED` | `COMPLETED` | ✅ 同名 |
| `FAILED` | `FAILED` | ✅ 同名 |
| `WAITING_HUMAN` | `AWAITING_CLARIFICATION` | ⚠ 语义不同（澄清≠审批） |
| `TIMEOUT` | — | ❌ 折叠进 `FAILED` |
| — | `CANCELLED` | 本仓多出的一态 |

**10 个期望态里 2 个同名、3 个近似、4 个缺、1 个语义偏；本仓多 1 个。**
根因是**设计取向不同**：DDD 把阶段建模成**状态**，本仓建模成**事件流**（SSE）。
不是"没做"，是"做在另一个维度"——但代价真实：**无法按阶段查询/统计卡在哪一步**。

### 3.3 8 个领域事件真 emit 了几个

⚠ 先按工单要求自证工具：`outbox.emit` 全仓非测试命中 **62**（两位数 ✅），
其中 **agentcore 0 处、datacore 17 个文件**——B 侧用的是 `TaskEvents.emit`。
两套都扫、两个实参位都扫，得到本仓事件全集：

- **AgentCore SSE（16 个）**：`task.accepted`/`task.failed`/`task.cancelled`/`routing.completed`/
  `routing.degraded`/`clarification.required`/`step.started`/`step.completed`/`answer.final`/
  `action_draft.created`/`decision.created`/`decision.committed`/`coordinator.planned`/
  `entity.out_of_domain`/`feedback.recorded`/`scenario.growth_triggered`
- **DataCore outbox（48 个）**：`action.approved`/`ontology.published`/`sim.*`/… 等

**DDD 的 8 个事件名逐字命中 = 0/8**（金丝雀：同扫描下 `answer.final` = 25 命中 ✅）。
按语义找等价物：

| DDD 事件 | 今天的等价物 | 定性 |
|---|---|---|
| `SkillStarted` | 无 skill 粒度事件；最近的是 `task.accepted` | ❌ **未实现**（skill 启停不可观测） |
| `ContextLoaded` | 无 | ❌ **未实现** |
| `AgentThinking` | `step.completed{type:"agent_narration"}`（`loop.ts:848`） | ⚠ **等价物存在·形状不同** |
| `ToolCalled` | `step.started`/`step.completed`（伪 step，`stepId=toolCallId`） | ✅ **等价物存在** |
| `SolverStarted` | 无独立事件（求解并进 `step.completed`） | ⚠ **粒度不足** |
| `DecisionGenerated` | `decision.created` / `decision.committed` | ✅ **等价物存在** |
| `HumanApproved` | DataCore outbox `action.approved` | ✅ **等价物存在（跨系统）** |
| `SkillCompleted` | `answer.final` | ⚠ **等价物存在·粒度是"任务"不是"技能"** |

**真 emit 的语义等价物：4 个明确 + 3 个粒度不符 + 1 个完全缺。逐字命中 0 个。**

### 3.4 Decision Replay —— **零实现**（且勿与本仓的 "Replay" 混淆）

`decision.?replay|replayDecision|re-?execute` 全仓 **0 命中**。
金丝雀：泛词 `replay` 在 agentcore 有 **5 处命中**（`api/sse.ts:8/56/69`、`events.ts:7/33`），
证明扫描正常——但那 5 处全是 **SSE 断线重连的事件流重放**（`Last-Event-ID` → `replayAfter`），
**与"重放历史决策"是两码事**。

⚠ **`docs/PRD-addendum-replay-orchestrator.md` 也不是 Decision Replay。**
读其契约 `packages/contracts/src/replay-ops.ts:1-14`：它是**虚拟操作团队回放**
（`VirtualPersona` 按 `OpsPlaybook` 模拟真人日常提问/审批/S&OP，用于把租户"养活"），
红线还明写"编排器禁止直写任何结果表"。**同名不同物，不能拿它充数。**

→ **Decision Replay 入口：不存在。** 今天最接近的是三条**只读** trace 路由
（`/queries/:taskId/trace`、`/decision-trace`、`/lineage`），只能**看**历史决策，不能**重跑**。

### 3.5 Skill 版本隔离 / Prompt 版本控制

| 能力 | 今天 | 定性 |
|---|---|---|
| **Skill 版本隔离（v1/v2 同时跑）** | ✅ 存储层 `skills UNIQUE(tenant_id, key, version)`（`001_init.sql:125`）→ 多版本行共存；运行时 `engine.ts:178 resolveSkill(tenantId, skillId, version)` 支持 `pin 数字版本` 与 `latest`（取未 RETIRED 最高版）；agent 绑定处 `engine.ts:371` 读 `agent.skills[].version ?? "latest"` | ✅ **已实现已并线** |
| **执行时版本留痕** | ✅ `engine.ts:263` 与 `:374` push `{kind:"skill", key, version}` → `QueryTask.resolvedRefs` → `DecisionTrace.resolvedRefs`（`qos.ts:637`） | ✅ **已实现已并线** |
| **`SkillVersion` 独立聚合** | ❌ 无独立对象；version 是 `SkillDefinition` 上的一个 `number` 字段 | **形状不同** |
| **Prompt 版本控制** | ⚠ `PromptTemplate.version`（`prompt-template.ts:29`）+ 3 条 REST 存在，但 5 个键只有 `classifier` 有消费方；agent 主提示词是硬编码常量 | **部分实现** |
| **Prompt A/B** | ❌ 0 命中 | **未实现** |
| **Prompt 版本进 trace** | ❌ `RefKindSchema`（`refs.ts:9`）七种 kind 里**没有 `prompt`** | **未实现** |

---

## 4. 规格二《Industrial Skill SDK + Runtime API》对账

### 4.1 端点清单（17 条）· 逐字 0/17，按能力 14 全 + 2 半 + 1 无

**我独立复核了审核方给的起点，结论一致**（路由抽取金丝雀 `/api/v1/queries` 命中；
agentcore 110 条路由字面量）。**逐字路径命中 0/17 属实**——本仓前缀是 `/a/v1`（DataCore）与
`/b/v1` + `/api/v1`（AgentCore），无任何 `/api/v1/skills/register` 形态。
但**路径不同 ≠ 能力缺失**，逐条给等价物：

| # | 规格端点 | 今天的能力等价物（file:line / 路由） | 定性 |
|---|---|---|---|
| 1 | `POST /skills/register` | `POST /b/v1/skills`（`server.ts` skills 段） | **等价·形状不同** |
| 2 | `GET /skills/{id}` | `GET /b/v1/skills/:id`；另有 `/new-version`·`/retire`·`/references`·`/resources/:name`·`/lint` | **等价·且更全** |
| 3 | `POST /skills/publish` | `POST /b/v1/skills/:id/publish`（`server.ts:1235`，三重门） | **等价·且更严** |
| 4 | `POST /runtime/execute` | `POST /api/v1/queries`（QOS 提交） | **等价·语义偏**（见下） |
| 5 | `GET /runtime/execution/{id}` | `GET /api/v1/queries/:taskId` + `/events`(SSE) + `/trace` + `/decision-trace` + `/lineage` | **等价·且更全** |
| 6 | `POST /agent/task` | `POST /api/v1/queries` 走路径 B（无独立端点，由分类器择路） | **等价·无独立出口** |
| 7 | `POST /context/query` | **无 HTTP 出口**；内部模块 `agent/context.ts`·`ontology-context.ts`·`navigation-slice.ts`·`skill-router.ts` | **内部模块·无 HTTP 出口** |
| 8 | `GET /ontology/object/{type}/{id}` | `GET /a/v1/objects/:type/:id`（+ `/query` `/search` `/aggregate` `/neighbors`） | **等价** |
| 9 | `POST /mcp/register` | `POST /b/v1/mcp-configs`（+ `/test` `/refresh-tools` `/publish`） | **等价·且更全** |
| 10 | `POST /mcp/invoke` | **无 HTTP 出口**；内部 `agent/mcp-router.ts` → `tools/executor.ts` 分派 | **内部模块·无 HTTP 出口** |
| 11 | `POST /rule/evaluate` | `POST /a/v1/rules/evaluate`（+ `/dry-run`） | **等价** |
| 12 | `POST /solver/run` | `POST /b/v1/solvers/:key/run`（57 求解器） | **等价** |
| 13 | `POST /workflow/start` | `POST /b/v1/workflows/:id/run`（+ `/validate`） | **等价** |
| 14 | `GET /workflow/{id}` | `GET /b/v1/workflows/:id` + `GET /b/v1/workflow-runs/:runId/events` | **等价·且更全** |
| 15 | `GET /orchestrator/graph` | **无任何等价物**（`compileGraph`/`GraphScheduler` 零实现） | ❌ **未实现** |
| 16 | `POST /memory/store` | **无写端 HTTP**；读端是 agent 内置工具 `search_experience`，写端在 `orchestrator.ts:2226` 内部蒸馏 | **半·只读无写出口** |
| 17 | `POST /evaluation/feedback` | `POST /api/v1/queries/:taskId/feedback` + `POST /b/v1/evals` 全套 | **等价·且更全** |

**关于 #4「`/api/v1/queries` 是不是 `runtime/execute` 的等价物」——我的判断是「是，但语义有真实偏差」**：
- 相同：都是"提交一个待执行的东西 → 拿 id → 轮询/订阅结果"，且 QOS 侧更完整（SSE + 断线重放 + 澄清轮）。
- **不同（且这个不同是实质的）**：规格的 `runtime/execute` 是**按 skillId 直接执行一个技能**；
  本仓 `/api/v1/queries` 收的是**自然语言问句**，先经分类器择路（路径 A 工作流 / 路径 B Agent），
  **技能是被 agent 在循环里选用的，不是被调用方指定的**。
  → **今天没有"指定 skill 直接执行"的 HTTP 入口**。最接近的是 `runSkillProbe`
  （`evals.ts:55`，发布门内部用），但它是**评测探针不是运行时入口**，且无独立路由。
  这是一条**真实能力缺口**，不只是形状差异。

**关于 #7「ContextManager 五段是否存在」——答案：三段有、一段部分、一段缺，且全无 HTTP 出口。**
（详见 §3 表 Context 行）。**是内部模块也算实现**，但缺口的修法是"补 Ranker 之外的 Validator + 决定要不要开出口"，
与"从零造 ContextManager"完全不同。

### 4.2 Skill CLI —— **零实现**

`dos skill create/validate/compile/test/package/deploy` 六个子命令**一个都没有**。
证据（含金丝雀）：`grep '"bin"' package.json apps/*/package.json packages/*/package.json` → **无输出**；
同批 `grep '"scripts"' apps/agentcore/package.json` → `:7` 命中 ✅。
`grep "dos skill\|dos-cli\|skill compile"` 全仓 → 0。
→ **零实现**。今天等价能力全部经 HTTP（`/b/v1/skills/lint` 可当 `validate` 用）。

### 4.3 Skill Compiler 流水线 —— 见 §2.2（7 段落地 1 段：Validator=`lintSkill`）

### 4.4 Skill Package / Manifest / 签名 —— **零实现**

`.skill` 包格式、`manifest.json`、`signature/`、`SkillManifest`(name/version/runtime/dependencies)
**全部 0 命中**（金丝雀 `SkillDefinitionSchema`=6 ✅；`callSignature` 假阳性已排除）。
今天 Skill 的"分发单元"就是**数据库一行 JSONB**（`skills.definition`），不是文件包，无签名无校验和。

### 4.5 权限模型 —— **形状差异最大的一块**

规格要 `Skill → Permission → {Data, Tool, Action}`，形如
`data.read: MES.production` / `tool.allow: solver.execute` / `action.deny: ERP.write`。

**实测：`SkillPermission` 0 命中；`data.read`/`tool.allow`/`action.deny` 三种字面量全 0。**
（金丝雀：同扫描下 `scopeDeclaration` 有 8 处 src 命中 ✅）

今天的等价物**存在但挂在 Agent 上，不在 Skill 上**，且是**三层叠加**：

| 层 | 位置 | 作用 |
|---|---|---|
| ① **Entitlement**（功能级） | `features/registry.ts`（B）+ `features.ts`（A） | 功能关闭 = 404 `FEATURE_NOT_FOUND`，**先于 authz** |
| ② **Agent scopeDeclaration**（对象类型 + 工具名白名单） | `AgentDefinition.scopeDeclaration`（`agentcore.ts:47`）；执行器强制 `tools/executor.ts:135-137` 越界 `DENIED · AGENT_SCOPE_VIOLATION` | ≈ 规格的 `tool.allow` + `data.read` 的类型粒度 |
| ③ **A6 行级过滤**（用户 IAM） | `tools/executor.ts:171-179` 粗粒度 IAM → `PERMISSION_DENIED`；DataCore 侧行级过滤 | ≈ 规格的 `data.read` 的**行**粒度（规格没提这一层） |
| ④ **写侧闸门** | `isWriteModeSkill`（`agentcore.ts:201`）→ 写模式技能必须走 `create_action_draft` + 审批链（R4） | ≈ 规格的 `action.deny`，但是**流程门**不是**声明式拒绝表** |

**关系判定**：
- 本仓**有**与规格三类权限一一对应的能力，且多出"行级"与"Entitlement"两层（**比规格更严**）。
- 但**粒度主体错位**：规格把权限挂 **Skill**，本仓挂 **Agent**。
  后果是真实的：**同一个 agent 挂载的多个 skill 共享同一套 scope**，
  无法做到"技能 A 只能读 MES、技能 B 只能读 ERP"。
- → **定性：接了线接错地方（主体错位），不是未实现。** 修法是把 scope 下沉到 skill 粒度并做交集，
  不是从零造权限系统。

### 4.6 可观测性七件套（`Execution Trace = ...`）

| 规格要件 | 今天 | 定性 |
|---|---|---|
| Skill Version | ✅ `resolvedRefs{kind:"skill"}`（`engine.ts:263/374`）→ `DecisionTrace` | **已实现已并线** |
| Agent Trace | ⚠ `agent_runs` 写端全、**用户读端无**（只 `evals.ts:237` 读）；七字段覆盖约 3.5/7 | **接了线接错地方** |
| Prompt Version | ❌ `RefKindSchema` 无 `prompt` kind；agent 主提示词是常量 | **未实现** |
| Tool Calls | ✅ `tool_calls` 表 + `/trace` `/decision-trace` 读出（`server.ts:427/460`） | **已实现已并线** |
| Solver Result | ✅ `resolvedRefs{kind:"solver"}` + `AnswerBlock.provId` 溯源 | **已实现已并线** |
| Decision Result | ✅ `DecisionTrace`（`qos.ts:628`）含 `ontologyValidation`/`humanReviewRequired` | **已实现已并线·且超出规格** |
| Human Feedback | ✅ `POST /queries/:taskId/feedback` → `feedback.recorded` 事件 + `fallback_traces.feedback` | **已实现已并线** |

**七件里 5 件完整、1 件半（Agent Trace 读端断）、1 件缺（Prompt Version）。**

### 4.7 「规格点名 vs 今天实际」对照表（汇总）

| 规格构件 | 规格里的形状 | 今天的等价物(file:line) | 三分法定性 | 差距一句话 |
|---|---|---|---|---|
| Skill 聚合 | `Skill`+`SkillVersion`+`SkillManifest`+`SkillDependency`+`SkillPermission` 五对象 | `SkillDefinitionSchema`(`agentcore.ts:236`) 单对象含 version/dependsOn 字段 | **接了线接错地方**（聚合被压平） | 五对象压成一张 schema，Manifest/Permission 无对应物 |
| Skill 状态机 | `Draft→Validated→Published→Running→Deprecated` | `DRAFT/PUBLISHED/RETIRED`(`agentcore.ts:247`)；`Validated` 是**发布门**(`server.ts:1246-1273`)不是**状态** | **接了线接错地方** | 少 `Validated`/`Running` 两个可查询态 |
| ExecutionInstance/Task/Step/Event | 四张表 | `query_tasks`/`execution_plans`/`query_events`(`001_init.sql:33/23/55`) | **等价·命名不同** | 无 `execution_instance`/`execution_step` 表名 |
| Execution 状态机 | 7 态 + 3 异常 | `QueryTaskStatusSchema`(`qos.ts:269`) 7 态 | **接了线接错地方** | 2 同名/3 近似/4 缺；阶段建模为事件而非状态 |
| AgentProfile/Prompt/Memory/ToolBinding/Execution/**Trace** | 六对象 | `AgentDefinition`(`agentcore.ts:24`)+`AgentRunRecord`(`qos.ts:711`)+`experience_cases` | **接了线接错地方** | 无 `agent_trace` 表；`AgentPrompt` 是常量；Trace 读端不通用户 |
| Context 五段 | Retriever→Ranker→Compressor→Assembler→Validator | Ranker=`skill-router.ts:51`；Compressor=`context.ts:312 ContextBudgeter`；Retriever≈`ontology-context.ts`；Assembler≈`prompts.ts` | **部分实现·内部模块无 HTTP 出口** | Validator 缺；五段未收敛为一个 ContextManager |
| Tool 生命周期 | `Request→PermCheck→SchemaValid→Execute→Normalize→Return` 六段 | `tools/executor.ts:135/171/197/217/233` 八道关卡 | **已实现已并线** | 无缺口，本仓更细 |
| 8 领域事件 | `SkillStarted`…`SkillCompleted` | 本仓 16 个 SSE + 48 个 outbox，**逐字命中 0/8** | **部分实现** | 4 个语义等价、3 个粒度不符、`ContextLoaded` 完全缺 |
| 5 张表 | `skill_registry`/`execution_instance`/`execution_step`/`agent_trace`/`tool_execution` | `skills`/`query_tasks`/`query_events`/**（无）**/`tool_calls` | **4 等价 + 1 缺** | `agent_trace` 无对应表（`agent_runs` 是 JSONB 单行，非结构化 trace） |
| 17 个端点 | `/api/v1/...` 扁平 | `/a/v1`(A) + `/b/v1`·`/api/v1`(B) | **逐字 0/17；能力 14 全 + 2 半 + 1 无** | Runtime 直执行 skill / Context 查询 / Memory 写 三个出口缺 |
| Skill CLI | `dos skill` 六子命令 | **无** | **未实现** | 零 bin 入口 |
| Compiler 七段 | DSL→…→RuntimePackage | 仅 Validator=`lintSkill`(`skill-lint.ts:234`) | **未实现（6/7）** | AST/Optimizer/ExecutionGraph/Package 全零 |
| `.skill` 包/Manifest/签名 | 文件包 + 签名目录 | **无**（分发单元 = `skills.definition` JSONB 行） | **未实现** | 无包格式、无签名、无校验和 |
| Skill 权限三类 | `data.read`/`tool.allow`/`action.deny` 挂 Skill | `scopeDeclaration`(`agentcore.ts:47`)+A6 行级+Entitlement，**挂 Agent** | **接了线接错地方** | 主体错位：多 skill 共享 agent scope，无法按技能隔离 |
| Skill 版本隔离 | v1/v2 同时运行 | `skills UNIQUE(tenant,key,version)` + `engine.ts:178 resolveSkill` pin/latest | **已实现已并线** | 无（这条规格要求**真达成了**） |
| Prompt 版本控制 / A/B | 版本化 + A/B | `PromptTemplate.version`(`prompt-template.ts:29`)；5 键仅 `classifier` 有消费方 | **部分实现** | A/B 零；agent 主提示词不可版本化 |
| **Decision Replay** | 重放历史决策 | **无**（`replay` 5 处命中全是 SSE 断线重连） | **未实现** | 只能看 trace，不能重跑 |
| 执行快照恢复 | Execution 快照 | **无** | **未实现** | `human` 节点无 resume |

---

## 5. 第 4 步 · 分支侧对账（回答「复验了没合并」这半句）

**判据 = 分支新增/改动的文件在 canonical 里存不存在、内容一不一样。
明确拒绝用 `git log A..B | wc -l`（提交数）当判据**——rebase 后该数字无意义，本仓已因此误判过一次。
脚本：`branchaudit.sh`（对每个文件跑 `git rev-parse --verify -q <canonical>:<path>` 比对 blob）。

`git ls-remote --heads origin` 共 **310** 条分支，与 skill/agent 相关且非 `worktree-agent-*` 的 **18** 条。

### 5.1 五条 skill PRD 分支 —— **全部已被 canonical 收编**

| 分支 | sha | 提交数(误导指标) | 文件比对结果 | 定性 |
|---|---|---|---|---|
| `claude/handoff-prd-skill-compiler` | `373a84d9` | 1 | identical=1 differs=0 absent=0 | **已被收编** |
| `claude/handoff-prd-skill-contract` | `86a90bab` | 1 | identical=1 differs=0 absent=0 | **已被收编** |
| `claude/handoff-prd-skill-governance` | `4f3cfa70` | 1 | identical=1 differs=0 absent=0 | **已被收编** |
| `claude/handoff-prd-skill-migration` | `25ce5c6f` | 1 | **differs=1**（canonical 545 行 > 分支 534 行） | **更老的快照** |
| `claude/handoff-prd-skill-runtime` | `5b7a6e1d` | 1 | **differs=1**（canonical 725 行 > 分支 720 行） | **更老的快照** |

**两条 `differs` 的方向已判明（不是"未合并"）**：
- 分支提交时间 `2026-08-03 15:14:54`；
- canonical 对同一文件的最后一次改动 `2026-08-03 17:02:23`，
  提交标题 **「docs(PRD): 五份 Skill PRD 并线 + 对照审查三条收口（C1/C4/C5）」**。
→ **五份是一起并线的，并线后又被审查意见改过**，所以分支侧是更老的快照。
**结论：五条 skill PRD 分支零未合并内容。**

### 5.2 agent 侧分支

| 分支 | 文件比对 | 定性 |
|---|---|---|
| `claude/handoff-wo-agent-runtime-s01` | identical=2 differs=6 absent=**0** | **无未合并文件**（canonical 已演进） |
| `claude/handoff-qos-agent-speed` | identical=2 differs=8 absent=**0** | **无未合并文件** |
| `claude/handoff-wo-harness-prompt` | identical=2 differs=1 absent=**0** | **无未合并文件** |
| `claude/handoff-tier3-agent-timeout-fallback-v2` | identical=0 differs=10 absent=**0** | **无未合并文件**；抽验其测试文件 `apps/agentcore/test/qos-agent-timeout.test.ts` 在 canonical **存在**（blob `2ed93403`） |
| `verify-skill3` | identical=11 differs=15 **absent=2** | ⚠ **真有未合并文件** |

**唯一真有未合并内容的分支：`verify-skill3`（`de0a0a98`）**，缺的两个文件是：
- `apps/datacore/test/zz-adversary-adopt.test.ts`
- `apps/datacore/test/zz-adversary-golden-probe.test.ts`

→ 都是 **DataCore 对抗性测试**，**与 skill/agent 运行时无关**。
即：**skill/agent 主题下，没有任何一条分支带着 canonical 缺失的实现文件。**

### 5.3 对仓主质疑的直接回答

> 「都已经开发了，你没有复验或复验了没有合并」

**「没合并」这半句：不成立。** 18 条相关分支里 17 条零缺失文件，
唯一有缺失的 `verify-skill3` 缺的是两个 datacore 对抗测试，不是 skill/agent 实现。

**但「都已经开发了」这个前提本身需要修正**——五条 `handoff-prd-skill-*` 分支
**每条只有 1 个提交、只动 1 个 `docs/*.md` 文件**（脚本实测 `differs`/`identical` 均只有 1 个文件，
且全是 `.md`）。**它们是"写 PRD"的分支，不是"写实现"的分支。**
→ 真相不是"开发了没合并"，而是 **PRD 写完并线了，实现有相当一部分从来没开工**（见 §6 数字）。

---

## 6. 诚实边界（四档）

### 6.1 亲手读代码验的（打开文件、读到调用点与条件）

- `SkillDefinitionSchema` 全字段及其消费方（`agentcore.ts:236-262`；`engine.ts:30/36/41/178/263/320/371/374`）
- 技能发布三重门全文（`server.ts:1235-1293`）与 `skills/lint`（`:1296-1309`）
- `probeMissingRefs` 的两处调用点及其**上下文条件**（`server.ts:688-690`、`:1006-1008`），
  并逐行确认 `1235` 那个 handler 内无该调用
- `QueryTaskStatusSchema`（`qos.ts:269-278`）、`AgentRunRecordSchema`（`qos.ts:711-723`）、
  `DecisionTraceSchema`（`qos.ts:628-651`）、`ResolvedRefSchema`（`refs.ts:23-28`）
- `001_init.sql` 全表结构（27 张表，逐张读）
- `agent/skill-router.ts` 全文（80 行）→ `prompts.ts:69-79` → `engine.ts:320` 三层链路
- `agent/context.ts` 导出清单（`ContextBudgeter` 等）
- `prompt-template.ts` 全文 + `resolvePromptOverride`（`prompts.ts:240-255`）及其**唯一调用点**
  `orchestrator.ts:1255`（读到实参是 `"classifier"`）
- `orchestrator.ts:2010-2051`（reflect/critic/loopRepeatCap 的注入条件，读到 `reflectEnabled(...)` 三元）
- `features/registry.ts:104/108` 两个 `defaultOn:false`
- `docker-compose.yml:129` 的 `QOS_AGENT_LOOP_REPEAT_CAP: ${…:-3}`
- `replay-ops.ts:1-60`（据此判定它不是 Decision Replay）
- `PRD-skill-runtime-orchestrator.md` 头部 50 行、`PRD-skill-crossreview.md` 关键行、
  `PRD-agent-data-generation-tools.md` 头部、`PRD-agent-react-harness.md` 头部

### 6.2 只 grep 到符号 / 计数的（有金丝雀，但未逐一读调用点）

- 62 个 `outbox.emit`、48 个 DataCore 事件名、16 个 AgentCore SSE 事件名的**全集抽取**
  （逐个事件的触发条件未逐一读）
- agentcore 110 条路由字面量、datacore 路由的分组筛选
- 各 PRD 决定性符号的 src/test 命中数（`symcheck.sh` 批量）——
  其中 0 命中的（`compileGraph`/`SkillManifest`/`SkillPermission`/`migrateSkill`/CLI 等）
  **有正反双金丝雀**，我认为结论可靠；非 0 的多数已追一层，少数（如 `inputSchema` 53 处）**只看了计数**
- 57 个求解器、30 个 BUILTIN_TOOLS 的数量（引自代码注释与计数，未逐个点开）

### 6.3 从 PRD / 文档抄的（该文档可能已过期，我标注了但未全部独立复核）

- `SPEC-industrial-skill.md` 的"12 层结构"这一划分本身（我核了其中与代码相关的层，未核全部 12 层）
- `PRD-skill-crossreview.md` 对另外几份 PRD 的行数/分支归属统计
- `PRD-skill-governance-learning.md:146` 的自述病灶——**这一条我独立复核过**（见 §2.5），确认仍成立
- 各 PRD 自称的"现状"段落（我只抽验了 `probeMissingRefs`、`maxBudgetRounds`、
  `BUILTIN_TOOLS 无产数据工具` 三条，**三条抽验结果：前两条仍成立，第三条已被修复**）

### 6.4 未能验证的（明写，不装懂）

- **没跑过任何测试**（工单禁止；主线在跑 gate）。所以"测试咬函数还是链路"这一列，
  我是**读测试文件的断言内容**判定的，**不是看测试实际执行了什么**。
- **没起过服务、没发过一个真请求**。所有"能不能用"的判断都是**静态读码**，
  按本仓戒律这**不等于"亲手真跑"**——尤其 §4.1 那 17 条端点等价性，我核的是路由注册与 handler，
  未实际 curl 过。
- **pg 模式未验**：只读了 `migrations/*.sql` 与 `persistence/pg.ts` 片段，
  未核 memory/pg 双实现是否在 skill/agent 相关表上完全等价。
- **前端侧几乎未核**：`apps/frontend-shell` 对 skill/agent 的消费面（编辑器、trace 展示）未系统检查。
- **310 条分支只审了 18 条**（按 skill/agent 关键词筛）。筛选用的是分支名关键词，
  **可能漏掉名字不含 skill/agent 但内容相关的分支**——这是本次分支结论的已知盲区。
- `verify-skill3` 那两个 absent 文件我**只确认了文件不存在于 canonical，没读其内容**，
  故"与 skill/agent 无关"是**据文件名判断**，未读码证实。

### 6.5 我发现的、与工单描述不符之处（纠正而非附和）

1. **工单说"`PRD-addendum-replay-orchestrator`…"** —— 工单没提这份，但我要主动指出：
   仓里叫 "Replay" 的那份文档**不是** Decision Replay，是虚拟操作团队回放。
   若照名字找 Decision Replay 会得出"已实现"的相反结论。
2. **工单第 3 步说「本仓已知有 `EXECUTING_AGENT`、`FAILED` 等」** —— 准确，但不完整：
   完整状态集是 7 个（含 `ROUTING`/`AWAITING_CLARIFICATION`/`EXECUTING_WORKFLOW`/`CANCELLED`），
   其中 `CANCELLED` 是 DDD 规格里**没有**的。
3. **`CLAUDE.md` 铁律 0.5 中「`dependsOn` … 7/7 数据为空」的表述今天已部分过期** ——
   `dependsOn` 确实仍 0，但同句暗含的 `references` 已有数据（7 条种子，6 条非空）。
   两者定性不同，建议拆开表述（详见 §2.3）。
4. **审核方给的起点「Runtime 执行、Context 查询、Memory 三块是 0 条」** —— 端点层面属实，
   但**能力层面 Memory 不是 0**：`experience_cases` 表 + `search_experience` 内置工具 + 出厂 50 例
   是**真跑着的**，只是没有 HTTP 写出口。按"这个能力今天能不能用"来问，
   **Memory 的读能力能用，写能力只在内部**。
5. **DDD 说明书把 Context 划为 `Retriever→Ranker→Compressor→Assembler→Validator`** ——
   本仓的 **Ranker 是真存在的**（`skill-router.ts:51 rankSkills`，embedding 余弦 + 词法平手裁决），
   容易因为文件名叫 `skill-router` 而被漏判成"没有 Ranker"。

---

## 7. 总判

### 7.1 14 份 PRD 的实现分布

| 档位 | 份数 | 是哪几份 |
|---|---|---|
| **已实现已并线（可用）** | **6** | skill-authoring(7) · addendum-agent-runtime(9) · loop-control(10) · data-generation-tools(12) · navigation-slice(13) · empty-response-guard(14) |
| **部分实现** | **4** | skill-contract-dsl(3，9 字段里 8 个接线) · governance-learning(5，5 键里 1 键有消费方) · SPEC-industrial-skill(8) · react-harness(11，接了线但 `defaultOn:false`) |
| **核心交付物零实现** | **3** | skill-runtime-orchestrator(1) · skill-compiler-registry(2，7 段落地 1 段) · skill-migration(6) |
| **非实现类文档** | **1** | skill-crossreview(4，审查报告；其结论今天仍成立) |

### 7.2 两个必须分开报的数（合成一个数会掩盖真相）

| 指标 | 数值 | 含义 |
|---|---|---|
| **① 能力覆盖率** | **14 全 + 2 半 = 15/17 ≈ 88%** | 规格点名的 17 个端点里，15 个今天**有能力等价物**（多数比规格更全） |
| **② 形状一致率** | **0/17 = 0%** | 端点路径逐字命中**一个都没有**；5 张表名 4 张不同名、1 张无对应；8 个事件名 0 命中；状态机 10 态里 2 个同名 |

**这两个数差 88 个百分点，正说明"合成一个数"会骗人**：
只报 ① 会让人以为"基本做完了"，掩盖掉 Runtime 直执行入口 / Compiler / CLI / 包格式 / Decision Replay
这些**真缺口**；只报 ② 会让人以为"什么都没做"，而实际上 Tool 生命周期、Skill 版本隔离、
发布三重门这些地方**本仓比规格做得更严**。

### 7.3 对仓主原话的最终判定

> 「搜索历史上关于 agent、skill 的 PRD，都已经开发了，你没有复验或复验了没有合并」

**分三段回答，用数字：**

1. **「没合并」——不成立。** 18 条 skill/agent 相关分支，按**文件存在性**（非提交数）判定，
   **17 条零缺失文件**；唯一有 2 个缺失文件的 `verify-skill3`，缺的是 DataCore 对抗测试，
   与 skill/agent 无关。五条 `handoff-prd-skill-*` **全部已并线**
   （canonical 有 `2026-08-03 17:02` 的「五份 Skill PRD 并线」提交为证）。

2. **「都已经开发了」——只对了约一半。** 14 份里 **6 份全实现、4 份部分、3 份核心零实现、
   1 份是审查报告**。更要紧的是：那五条 PRD 分支**每条只有 1 个提交、只改 1 个 `.md`**——
   **它们交付的是 PRD 本身，不是实现。** 所以准确的说法不是"开发了没合并"，
   而是**"PRD 写完并线了，其中 3 份的核心实现从未开工"**。

3. **「你没有复验」——这半句基本成立，且我这次补上了。**
   证据是本次实测抓到的三处**至今仍开着**的缺口，每一处都是"复验过就会发现"的：
   - `maxBudgetRounds`：契约有、测试绿、**零生产消费方**（PRD 明写要接，至今没接）；
   - `probeMissingRefs`：已接 agent/workflow 两处发布路，**skill 发布路仍没接**且 fail-open
     ——技能引用不存在的求解器可以照发；
   - `agent_runs`：写端三处齐全，**用户可见读端一个都没有**（只有 evals 内部读）。

**一句话总判**：**分支侧是干净的（没有"做了没并"），欠的是"写了 PRD 没做实现"，
以及三处"接了一半的线"——而这三处恰恰是靠 grep 一次看不出来、必须追一层调用才现形的那种。**

---

## 附 · 本单可直接开工的最小修路径（按性价比排序，供派单参考）

| # | 缺口 | 修法 | 工作量判断 |
|---|---|---|---|
| 1 | skill 发布不校验非 skill 引用 | 在 `server.ts:1235` handler 内加一次 `probeMissingRefs(deps.dataCore, a, {solverKeys, ruleKeys})`，复用 `:1008` 的取值写法 | **接一条线**（非造门） |
| 2 | `agent_runs` 用户读端不通 | 加 `GET /api/v1/queries/:taskId/agent-run`，或把 `AgentRunRecord` 并进已有 `/trace` 响应 | 接一条线 |
| 3 | `maxBudgetRounds` 零消费方 | 在 `engine.ts` 组装 budget 处按挂载技能取 min/max 覆盖 `maxRoundTrips`；**或**删字段 | 二选一，先定性 |
| 4 | `dependsOn` 恒空 | 给种子技能补一条 `dependsOn` 让环检测真跑一次；**或**确认不用则删分支 | 补数据 |
| 5 | Prompt 4/5 键无消费方 | `extraction`/`modeling`/`answer_compose`/`skill_summary_lint` 各接一处 `resolvePromptOverride` | 接四条线 |
| 6 | `buildNavigationSliceSection` 死代码 | 删，或接进 `prompts.ts` | 清理 |
| 7 | Runtime 直执行 skill 无入口 | 新增 `POST /b/v1/skills/:id/execute`（可复用 `runSkillProbe` 的执行体） | **真施工** |
| 8 | Decision Replay | 需先定语义（重跑取当时版本还是当前版本），再设计 | **真施工·需裁决** |
