# PRD · 技能编译器与技能注册中心（Skill Compiler & Skill Registry）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-08-03 |
| 取代/扩展 | 扩展 `docs/SPEC-industrial-skill.md`（§5 引用模式定案 / §6 开发模板 / §7 两项定案 / §8 SDK 规格与对照）；与 `docs/WO-ROUTING-RETRIEVAL-FIRST.md` Track E（Skill 吞并 ExecutionPlan）同栈；与 `docs/PRD-addendum-skill-authoring.md`（发布双门禁）互补不重叠 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `docs/SPEC-industrial-skill.md` · `docs/WO-ROUTING-RETRIEVAL-FIRST.md` |
| 本文只定义 | **编译器（静态校验）+ 注册中心（生命周期/版本）+ 包与签名 + API 面复用约束**。Skill 的**字段语义**（12 层/八层形态）由 SPEC 与 Track E 定，本文不重复定义、不另起第二份字段表 |

> **诚实前置**：本文所有「今天是 X」的断言均给 `file:line` 或可复跑命令；无法核实的一律写「未核实」。
> 本次工作**只读代码、只写文档**，未运行任何测试、未运行 `scripts/gate.sh`、未跑 `seedRegistry()`；
> 所有计数均由静态读源码/grep 得出，并在 §14 逐条标注核实方式。

---

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（本体 §2）：
  - H 域（AgentCore）：**Skill**（`SkillDefinition`）· **Intent** · **ExecutionPlan / Workflow** · **Agent** · **EvalSuite/EvalCase/EvalRunReport** · **ResourceDescriptor / SkillResource（DRIL 统一资源）** · **Scenario / SceneEntry**（只读消费方）
  - 被引用（校验目标，不改其真值源）：C 域 **Rule** · E 域 **Solver / SolverArtifact** · B 域 **ObjectType / SliceSpec** · H 域 **MCP tool**
  - 新增对象类型（本文提出）：**SkillRuntimePackage**（编译产物）· **SkillPackageManifest**（分发清单）· **SkillCompileReport**（诊断报告）。三者均为**派生投影/编译产物**，不是新真值源（R13）
- **触及链路**（§3）：
  - `Skill 引用链`：`Skill --references|dependsOn--> {rule|constraint|slice|ontologyType|solver|skill|workflow|agent}`（本文把这条链从「声明」升级为「发布期硬校验 + 可反查」）
  - `编排链`：`Query --classify--> Intent --planRef--> ExecutionPlan --step--> {Solver|SliceSpec|Rule|render}`（本文**不改**该链运行语义；编译产物在 Track E 迁移前**不接入运行时**）
  - `Skill --evaluatedBy--> EvalCase(suite=skill_quality)`（发布门第二关，复用不新建）
  - `Skill --projectedTo--> SkillResource(DRIL 统一资源)`（反向影响面查询的承载面，§2.3 发现该段今天**断了**）
  - 切片：`sys.orch.query_to_answer`（D7）· `sys.meta.change_loop`（D11，本 PRD 自身走这条）
- **触及事件/数据流**（§4）：
  - 复用既有 `skill.published`（L4 环，生产者 `POST /b/v1/skills/:id/publish`，`apps/agentcore/src/server.ts:1274`；订阅声明 `apps/agentcore/src/event-subscriptions.ts:41`）——**发布语义扩展但事件名不变**，`ontology:check` 事件集不动。
  - 新增 **1 个**事件 `skill.compiled`（编译成功落 `SkillRuntimePackage` → 失效 `skill-list` / `agent-editor.skill-bindings` / DRIL 资源缓存）。**新增事件即需同步回写本体 §4 表 + `event-subscriptions.ts`**，否则 `ontology:check` 红（该门断言「代码事件集 = 本体 §4 事件集」，`scripts/check-system-ontology.mjs:26-38`）。
  - **不新增**「注册/退役」事件：注册走 DRAFT 无外部可见效应；退役复用现有 `retire` 路径（今天 `POST /b/v1/skills/:id/retire` **不发事件**，`apps/agentcore/src/server.ts:1329-1340` —— 这是既有 D-29 缺口，本 PRD 记录但**不在本期修**，见 §14）。
- **触及不变量**（§5）：
  - **R1** contracts-only-shared：`SkillRuntimePackageSchema` / `SkillPackageManifestSchema` / `SkillCompileReportSchema` 一律落 `packages/contracts`；编译器**实现**只在 AgentCore，不跨包共享实现。
  - **R2** tenant_id everywhere：编译、注册、包、签名验签、反查全部带 tenantId；跨租户 404。
  - **R3** entitlement 先于 authz：新模块暗发 `skill.compiler`（`defaultOn:false`），**双注册** DataCore `apps/datacore/src/features.ts` + AgentCore `apps/agentcore/src/features/registry.ts`，关闭 = 404 `FEATURE_NOT_FOUND`。
  - **R4** 真值写入经 Action：编译/注册**不写业务真值**，故不入 Action 审批；但 `sideEffect=WRITE` 或 `approvalGate≠none` 的 Skill 其**运行时**仍走既有 `create_action_draft` 链（`isWriteModeSkill`，`packages/contracts/src/agentcore.ts:201`）。编译器只负责**声明与运行时一致性**的静态校验，不放宽 R4。
  - **R6** 确定性：编译是**纯函数**——同 (Skill 源, 引用快照, 编译器版本) → `SkillRuntimePackage` **字节一致**；`digest` 为规范化序列化后的 SHA-256。编译器内禁 `Date.now()`/随机（`compiledAt` 由调用方注入，不进 digest）。
  - **R7** 错误信封：编译失败 → `{error:{code:"SKILL_COMPILE_FAILED", message, requestId}}`；引用不可解析 → `SKILL_REF_UNRESOLVED`；签名不匹配 → `SKILL_SIGNATURE_INVALID`。均沿用既有信封。
  - **R9** 仓储双实现：新表 `skill_runtime_packages` 须**四处同改**（`apps/agentcore/migrations/*.sql` + `repo/pg` + `repo/memory` + repo 接口）。**可选降本方案**：不新建表，把编译产物挂在既有 `skills.definition` JSONB 内（`apps/agentcore/migrations/001_init.sql:118-126` 该表就是 `definition JSONB`）——见 §9 取舍。
  - **R10** D-29 数据流闭环：`skill.compiled` 必须有生产者 emit + `event-subscriptions.ts` 订阅声明 + 下游消费页失效，否则断链审计红。
  - **R11** 全链闭包：Skill 发布门是 R11 在 Skill 维的落点——**引用清单闭合**（rule/solver/objectType/tool/skill 全部可解析）才允许 PUBLISHED。
  - **R13** 结论可溯源：`SkillCompileReport` 逐条诊断必带 `{code, severity, path(JSON Pointer), evidence(引用键+查询来源端点)}`——「为什么拒绝」当场可亮，不只给一句「lint 未过」。
  - **R14** 应用层无业务常数：编译器/校验器**零业务常数**——规则码、求解器键、对象类型名一律从注册表查，不内联白名单（换行业换租户不改代码）。
  - **R15** CLI 对等：新增对外能力必须有 CLI 命令或 GUI 深链，见下条。
  - **R16** 发育闭环：Skill 编译/发布产物计入 `producedArtifacts` 与模块同步矩阵；引用缺失 → 不静默残缺，自动开 `GrowthTicket`（NEEDS-HUMAN 分支）。
  - **R18** 尺度自洽：本 PRD 不触及尺度层，无影响。
- **CLI 打通（R15，强制）**：`OPERATION_CATALOG`（`packages/contracts/src/operation-intent.ts:67`）已有 `op:"skill"` / `cliCommand:"skill"`（今天经 `platform do` 万能路由可达；`scripts/platform-cli.mjs:507` 的 `run{}` **不含** `skill` 子命令——`scripts/check-cli-parity.mjs:38-46` 因 `do` 路由存在而判为可达）。本 PRD 新增能力**沿用同一 `op:"skill"` 条目**，并**必须**在 `run{}` 落 `skill` 子命令实现 `create|validate|compile|package|publish|inspect`（SDK 规格的 `dos skill …` 一律映射到 `platform skill …`，**不另起第二个 CLI 二进制**）。
- **关闭/影响的已知断点**（§8）：
  - **G-1**（场景↔意图/计划闭包）：本 PRD 的引用可校验门把「声明的求解器/规则真存在」从 workflow/agent 扩到 skill，收窄同族缺口。
  - **G-4**（配置面）：Skill 编译/包管理需要前端入口（`/admin/skills`，`apps/frontend-shell/src/App.tsx:167`），否则又是「有端点无入口」。
  - **G-8**（构建闭包不跨栈）：`SkillRuntimePackage` 的引用闭合结果并入 `chain:check` 跨系统门。
  - **G-10**（规则即引用）：Skill 侧 `rule` 引用清单让「改 C08 影响哪些 Skill」可查，是 G-10 输出侧的补齐。
  - 命名断点（§8 非编号项，`prd:check` 不解析但本体登记在册）：
    - `G-SIDEEFFECT-VOCAB-SPLIT`（词表分裂致判定永不触发）——本 PRD 所有词表**一律从契约单一来源派生**，禁止在编译器里手抄枚举。
    - `G-SKILL-UNREACHABLE-FREE-QA`（Skill 对默认自由问答不可达，已暗发闭合）——编译产物**不得**新开第二条注入路径，必须复用 `selectTenantSkills` → `buildSkillSection` 那一条。
    - 新登记（本 PRD 发现，见 §2.3）：**`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`** —— Skill 引用边的抽取函数零生产调用方，本体 §2H 声称的「skill→refs 写入 `resource_relations`」在**已接线的那条路上不成立**。
- **需走的检测门禁**（§7）：`ontology:check`（事件/锚点不漂）· `prd:check`（本文 §0 可解析、R/G 不悬空）· `chain:check`（跨系统闭包）· `resource-descriptor:check`（新资源池 description 非空）· `cli-parity:check`（R15）· `rule-closure:check`（规则引用闭合）· 新增 **`skill-compiler:check`**（命名红线 + 词表单源 + fail-closed 静态断言，§12）。
- **回写承诺**：本 PRD 落地后须回写 `docs/SYSTEM-ONTOLOGY.md`：
  §2H（新增 `SkillRuntimePackage`/`SkillPackageManifest`/`SkillCompileReport` 三对象类型 + 修正 WO-SKILL-4 投影段的事实）·
  §3（Skill 引用链补「发布期硬校验」与「反查」两条边）· §4（新增 `skill.compiled` 事件行）·
  §7（新增 `skill-compiler:check` 门）· §8（登记 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）。
  **本体不回写即过期失效**。

---

## 1. 目标 / 非目标

### 1.1 目标

| # | 目标 | 判据（效果层，非运输层） |
|---|---|---|
| O1 | **引用可校验门成为必配硬门** | 造一个引用了不存在 rule/solver/objectType/tool/skill 的 Skill → `publish` **被拒**（非告警），错误里点名**哪个 key、在哪个注册表查不到、查询用的哪个端点** |
| O2 | **推理图静态可校验** | 图有环 / 异常路径未定义 / 终止节点缺失 → 编译期红，不到运行期才炸 |
| O3 | **命名红线不被突破** | 编译产物、AST 节点、契约导出名均不含 `ExecutionPlan` / `Execution Graph` 语义占用；静态门守 |
| O4 | **注册中心生命周期完整** | DRAFT→TESTING→PUBLISHED→DEPRECATED（+ 既有 RETIRED 终态）状态机，非法跃迁 409 |
| O5 | **版本演进有一等 `supersedes`** | 「新版本顶替旧版本」是可查询的一等事实，而非靠「同 key 更高 version」隐式推断；回滚可执行 |
| O6 | **包可自足分发且可验签** | `.skill` 包含完整 `requires` 声明 + `manifest.json` + `signature/`；宿主不满足 → **拒绝安装** |
| O7 | **API 面零重复** | ontology/mcp/rule/solver/workflow/context/agent 八组能力**一律代理既有端点**，新增实现为零；静态门守禁止清单 |

### 1.2 非目标（本期明确不做）

- **不做** Track E 的「Skill 吞并 ExecutionPlan」迁移本身。本 PRD 提供编译器与注册中心；迁移由 Track E 单独立单（其四条硬约束见 `docs/WO-ROUTING-RETRIEVAL-FIRST.md:415-429`）。
- **不做** Skill Orchestrator（多 Skill 编排/Skill Graph 运行时）。
- **不做** Learning Loop（人工采纳率回流）。SPEC §8 已判定其前置（跨租户混算指标 + `/metrics` 无鉴权）未解决，**在错的指标上建学习闭环，学到的也是错的**。
- **不改** 规则 DSL / 求解器 / 本体 / MCP 的任何语义与实现。编译器只**读**它们的注册表。
- **不引入**第二套规则语法、第二套约束语法、第二个 CLI 二进制、第二条 Skill 注入路径。
- **不夹带模型文件**（`.lp`/`.mps`）。SPEC §7 定案 2 已排除；编译器对包内出现此类文件**直接拒绝**。

---

## 2. 现状与缺口（对照代码，带 file:line）

### 2.1 今天真有的（可复用，不重造）

| 能力 | 位置 | 说明 |
|---|---|---|
| Skill 契约 | `packages/contracts/src/agentcore.ts:236-262` | `id/tenantId/key/version/name/summary/body/resources/status` + WO-SKILL-1 治理字段（`capability`/`sideEffect`/`inputSchema`/`outputSchema`/`references`/`dependsOn`/`approvalGate`/`provenancePolicy`/`maxBudgetRounds`，均 optional） |
| 引用词表单一来源 | `packages/contracts/src/agentcore.ts:216-217` | `SKILL_REFERENCE_KINDS = [rule, constraint, slice, ontologyType, solver, skill, workflow, agent]`（**注意：无 `tool`、无 `mcp`**）；`SKILL_REFERENCE_ROLES = [precondition, postcheck, context, fallback]` |
| 结构 lint | `apps/agentcore/src/skill-lint.ts:234-314` | summary 触发句/排除句/禁用词、body 七段骨架、正反例、resource 引用可解析、工具名注册表反查、JSON Schema 形状、引用列表合法性、`dependsOn` 可解析 + 需 PUBLISHED + 依赖图无环 |
| lint 干跑端点 | `apps/agentcore/src/server.ts:1292-1305` | `POST /b/v1/skills/lint`，不改状态 |
| 发布门（今天的） | `apps/agentcore/src/server.ts:1231-1289` | ① lint 必过（`force=true` 豁免，:1242-1245）② `skill_quality` 用例 ≥3（:1248-1251）③ 三类覆盖各 ≥1（:1254-1263）④ 探针实跑 passRate=1（:1264-1269）→ 置 PUBLISHED、emit `skill.published`、回影响面 |
| 探针 | `apps/agentcore/src/skill-probe.ts` · `deps.evals.runSkillProbe` | 挂载/不挂载孪生 agent 对照，走真实 `engine.runRegisteredAgent` |
| **引用存在性探针（已建，但没给 skill 用）** | `apps/agentcore/src/resources.ts:11-48` | `probeMissingRefs(dataCore, ctx, {solverKeys, ruleKeys, objectTypes})` → 已接 **workflow 发布**（`server.ts:1004`）与 **agent 发布**（`server.ts:686`） |
| 计划步骤校验 | `apps/agentcore/src/workflow/validate.ts:71-111` | `validatePlanSteps`：步骤 id 重复、前向引用、`render_answer` 末步、`create_action_draft` 越级、超时合计 ≤5min |
| 跨资源静态环检测 | `apps/agentcore/src/workflow/validate.ts:117-158` | `detectStaticCycle`（agent↔workflow 可达环） |
| 渲染绑定派生 | `apps/agentcore/src/workflow/validate.ts:42-68` | `deriveRenderBindings`：从 `render_answer` 反推每个 solver 步被引用的输出字段路径（= 渲染契约，与 DataCore `closure.ts` SHAPE 维同源） |
| 版本派生 | `apps/agentcore/src/server.ts:1308-1318` | `POST /b/v1/skills/:id/new-version`：同 key 最大 version+1，复制为 DRAFT |
| 反查（部分） | `apps/agentcore/src/resources.ts:101-140` | `computeReferences(kind="skill")` **只**返回挂载该 skill 的 agent |
| 资源投影 | `apps/agentcore/src/dril/resource-projector.ts:141-170` | `projectSkills` → `SkillResource`（含 `inputSpec`/`outputSpec` 由 `ioSpecFromJsonSchema` 派生） |
| 密码学原语 | `apps/agentcore/src/crypto.ts:1-19`（AES-256-GCM）· `apps/datacore/src/auth.ts:71-84`（RS256 签名）· `apps/datacore/src/app.ts:943`（JWKS 端点） | 签名/验签所需的非对称密钥基础设施**已在**（`node:crypto` + `jose`），无需新依赖 |

### 2.2 今天确实没有的

| 缺口 | 核实方式 |
|---|---|
| **Skill Compiler / AST / Optimizer / Runtime Package** | 全仓无对应模块：`apps/agentcore/src` 下仅 `skill-lint.ts` / `skill-probe.ts` / `agent/skill-router.ts` / `tools/skill-resources.ts` 四个 skill 相关文件（`find apps/agentcore/src -name '*skill*'`） |
| **`.skill` 包 / `manifest.json` / `signature/`** | `grep -rn 'manifest' --include='*.ts' apps/agentcore/src packages/contracts/src` 只命中 `scaffold.manifest_recorded` 事件与 StoryBuildRun 的 `stage:"manifest"`，与 Skill 无关 |
| **任何包签名机制** | `grep -rniE '\bsignature\b|cosign|sigstore|\.sig\b'`（排除 design/signal/assign/signoff）全仓仅 3 处命中：`apps/agentcore/src/auth.ts:48`（JWT 验签报错文案）、`apps/agentcore/src/metrics.ts:109`（loop 调用签名，与密码学无关）、`apps/datacore/src/auth.ts:83`（JWT 签发）。**结论：仓里今天无任何制品签名机制** |
| **YAML 解析器 / zip·tar 打包库** | `grep -rn 'yaml\|js-yaml' apps/*/package.json packages/*/package.json package.json` 零命中；同样无 `adm-zip`/`jszip`/`tar`。**任何 YAML 形态 DSL 或 zip 包格式都需新依赖** |
| **`supersedes` / `owner` / `domain` / `category` / `riskLevel`（Skill 侧）** | `SkillDefinitionSchema` 字段表（`packages/contracts/src/agentcore.ts:236-261`）逐字段核对，五项全无 |
| **`manifest runtime` 版本约束 / `dependencies`** | 同上；Skill 有 `version`（整数）但无运行时兼容声明 |
| **`SkillReference.kind` 覆盖 tool / mcp** | `SKILL_REFERENCE_KINDS`（`packages/contracts/src/agentcore.ts:216`）八种 kind 不含 `tool`/`mcp` → 「Skill 声明用哪些工具」**今天无处声明** |
| **`outputSchema` 的校验消费方** | `grep -rn 'outputSchema' apps/agentcore/src`（去测试）仅 3 处：`skill-lint.ts:23/300`（只校验**形状**是不是 JSON Schema）、`dril/resource-projector.ts:149`（投影展示）。**无一处拿它校验实际输出** |
| **Skill 发布的引用存在性探针** | `grep -rn 'probeMissingRefs' apps/agentcore/src` → 只有 `server.ts:686`（agent）、`server.ts:1004`（workflow）两个调用点；**skill 发布路径（`server.ts:1231-1289`）不调用** |
| **Skill 相关的任何 `*:check` 门** | 根 `package.json` 的 `gates` 串（16 个门）与 `:check` 脚本列表逐条核对，无 skill 门 |
| **skill retire 的领域事件** | `apps/agentcore/src/server.ts:1329-1340` 无 `emitDomainEvent`（对比 publish 路径 :1274 有）——既有 D-29 缺口 |

### 2.3 三处「声明了没接线」实测（本次新发现，直接影响本 PRD 设计）

> 本仓反复吃亏的形状是「机制在、没有真消费方」。本节三条都是**静态可复验**的，不是推测。

**（a） `probeMissingRefs` 已证可用，但 skill 发布路径没接。**
`resources.ts:11-48` 的探针已在 workflow 发布（`server.ts:1004-1013`）产出「求解器「X」在 DataCore 未注册（死路）」这类**精确到 stepId** 的拒绝理由，agent 发布（`server.ts:686-689`）同理守 `scopeDeclaration.objectTypes`。
**Skill 发布不调用它**——于是 `references:[{kind:"solver", key:"不存在的求解器"}]` 今天可以**一路发布成功**（`skill-lint.ts:176` 明写：`if (ref.kind !== "skill") continue; // 非 skill 引用由发布时的跨系统探针或各自注册表保证`——注释里承诺的那个探针，在 skill 这条路上没人调）。
→ **SPEC §5「这道门今天做不了（无任何一处声明）」需要修正**：声明**有一半**（`references[]` 字段在、`SkillReference` 契约在、七个出厂 skill 都填了 `references`），缺的是**把已有探针接上去**，且要把 fail-open 改成 publish 期 fail-closed。

**（b） `probeMissingRefs` 是 fail-open 的，直接当硬门会造出「DataCore 挂了就全部放行」。**
`resources.ts:22-46`：三段查询各自 `try{...}catch{ /* fail-open */ }`，且都带 `if (known.size > 0)` 守卫——**注册表查回空集也视为「不校验」**。
对 workflow/agent 这是合理的软策略；作为「不满足则拒绝安装」的硬门**必须改语义**（§4.3）。

**（c） Skill 引用边的抽取函数有测试、有实现、零生产调用方。**（→ 登记 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）
- `apps/agentcore/src/dril/resource-projector.ts:296` 的 `extractRelations` 里 :322-335 段**确实**把 `skill.references` / `skill.dependsOn` 抽成 `skill --references|dependsOn--> {rule|solver|slice|skill|workflow|agent}` 边（`ontologyType` 显式略过，:328-330）。
- 但生产投影路径 `apps/agentcore/src/dril/resource-registry.ts:220` 调的是 **另一个函数** `extractResourceRelations`（`apps/agentcore/src/dril/relations.ts:44-95`），该函数**只抽** workflow→solver/slice/rule 与 agent→skill 四类边，**完全不读 `skill.references`/`skill.dependsOn`**（:69-74 是它唯一涉及 skill 的分支）。
- `grep -rn '\bextractRelations\b' apps packages scripts` 全仓 4 处命中：定义 1 处（`resource-projector.ts:296`）+ 测试 3 处（`apps/agentcore/test/dril-registry.test.ts:11,177,204`）。**零生产调用方。**
- 影响：本体 §2H「Skill 资源投影（WO-SKILL-4）…并写入 `resource_relations`（skill→rule/solver/slice/skill/workflow/agent 的 references/dependsOn 关系），供统一资源检索与影响分析」——**在已接线的那条路上不成立**；`GET /b/v1/resources/rule/C08/relations` 的 `inbound` 里今天**不会**出现引用 C08 的 skill。SPEC §5 承诺的「反向收益：改 C08 会影响哪些 Skill 变成一次查询」今天**仍然只能 grep**。
- **额外注意**：即便接上，`resource-registry.ts:224-226` 会用 `present` 集合过滤掉「两端不在册」的边——**悬挂引用会从图里静默消失而不是被标红**。故**关系图不能当校验器用**，校验必须直接跑在原始 `references[]` 上（§4.2 RG 组）。

### 2.4 命名占用现状（红线依据）

- `ExecutionPlanSchema` 定义在 `packages/contracts/src/qos.ts:180`，`type ExecutionPlan` 在 :188。
- 该名字承载 **QOS 路径 A 的执行计划**语义：出厂种子里**每个意图绑一个 `ExecutionPlan`**。种子数量静态可数：`seedIntentsAndPlans`（`apps/agentcore/src/mocks/seed.ts:120`）= 手写 4 条 + `SCENARIO_CATALOG` 20 张卡去重后补 16 条（:490-516，代码注释「已有的 4 个跳过」）+ `ceoCaps` 12 条（:565-620）= **32 意图 / 32 计划**，与 `docs/WO-ROUTING-RETRIEVAL-FIRST.md:369-370` 的实测数一致。
- **仓里已有一次同名冲突的处置先例，且写在注释里**：`packages/contracts/src/execution-plan.ts:6-7` ——
  > 「契约 §1 称之为 ExecutionPlan；因 `qos.js` 已占用 `ExecutionPlanSchema`/`PlanStepSchema`（workflow 概念），本组合路径契约改用 **ComposePlan** 族命名…避导出冲突。」
  本 PRD 沿用同一处置法则：**新产物一律换名，不与已占用语义抢名。**

---

## 3. 命名红线与术语表

### 3.1 红线（违反即返工，静态门守）

1. **产物不得叫 `Execution Plan` / `ExecutionPlan` / `Execution Graph` / 「执行计划」/「执行图」**。这两个名字（及其中文）已被 QOS 路径 A 占用（§2.4），再占一次 = 制造第二份「这个意图怎么答」的真源，正是 Track E 明令禁止的（`docs/WO-ROUTING-RETRIEVAL-FIRST.md:398-400`）。
2. **禁用外部产品名**（根 `CLAUDE.md` 铁律 0）：`.skill` 包/CLI/编译器的任何术语不得引用外部产品名。SDK 规格里的 `dos skill …` 命令前缀**改为** `platform skill …`（复用既有 `scripts/platform-cli.mjs`，不新起二进制）。
3. **禁止手抄枚举**：编译器所有词表（引用 kind/role、副作用、能力、生命周期）一律 `import` 自 `@platform/contracts`。理由见 `G-SIDEEFFECT-VOCAB-SPLIT`（本体 §8）：同一概念三套词表、其中一套所在文件根本不在仓里 → 判定分支永不触发、测试自产自销照样绿。

### 3.2 术语表（本 PRD 引入的名字）

| 新名 | 语义 | 为什么不用别的名 |
|---|---|---|
| **SkillSource**（技能源） | 作者写的技能声明（包内 `skill.yaml`/`skill.json` 的规范化对象形态） | — |
| **SkillAst**（技能语法树） | Parser 产物：结构化但**未解析引用**的中间形态 | — |
| **SkillReasoningGraph**（技能推理图） | SPEC §1-⑥ 的 Reasoning Graph：节点 = 推理步骤，边 = 依赖/条件分支/汇流/异常路径 | 不叫 `ExecutionGraph`（红线 1） |
| **SkillRuntimePackage**（技能运行时包） | Validator+Optimizer 产物：引用已解析并**钉版**、图已拓扑排序、预算/出处策略已固化的可执行声明 | 不叫 `ExecutionPlan`/`CompiledPlan`（红线 1） |
| **SkillPackageManifest**（技能包清单） | `.skill` 包的 `manifest.json`：身份 + `runtime` 约束 + `dependencies` + `requires` 摘要 + 内容摘要 | — |
| **SkillCompileReport**（技能编译报告） | 逐条诊断（error/warning/info）+ 证据 + 修复指引 | — |
| **`skill.execution.steps`** | Track E 迁移后 Skill 内的确定性步骤字段，**类型复用既有 `PlanStepSchema`** | 复用既有类型是**单一来源**，不是重名；本 PRD 不新造步骤类型 |

> **口径**：`SkillRuntimePackage` **包含** `execution.steps`（若为确定性/混合题型），但它本身**不是** ExecutionPlan——它多出引用解析结果、推理图、预算与治理策略。运行时如何消费它由 Track E 定，本 PRD 不接运行时。

---

## 4. Skill Compiler

### 4.1 编译管线与产物

```
SkillSource（包 / 编辑器草稿 / 既有 SkillDefinition）
   │  ① Parser        —— 纯函数·无 IO·无网络（R6）
   ▼
SkillAst            —— 结构化 + 位置信息（JSON Pointer 路径，供诊断定位）
   │  ② Validator     —— 唯一需要 IO 的一段：向各注册表**只读**查询引用
   ▼
SkillAst + ResolvedRefs（每个引用 → {存在?, 状态, 解析到的版本, 查询来源端点}）
   │  ③ Optimizer     —— 纯函数（R6）
   ▼
SkillRuntimePackage —— 引用钉版 · 推理图拓扑序 · 预算/出处策略固化 · digest
   +
SkillCompileReport  —— 逐条诊断（含通过项，便于「为什么它过了」也可查）
```

**分层纪律**：① 与 ③ 是**纯函数**（无 `Date.now`、无随机、无网络），可在 contracts 层单测；② 的 IO 全部集中在一个可注入的 `RefResolver` 接口，测试注入内存实现——这样「编译确定性」可被牙测直咬。

### 4.2 Validator 能静态查出什么（本 PRD 的核心）

诊断码分五组。**severity=error 一律阻断 PUBLISHED**；`force=true` 走既有审计豁免口径（与 `server.ts:1243/1249/1254/1264` 一致），但 **RG 组不接受 force 豁免**（理由见 §4.3.4）。

#### RG 组 · 引用可校验门（SPEC §5 已定为必配硬门 · 不满足则拒绝安装）

| 码 | 断言 | 权威注册表 / 查询来源 | 今天有没有 |
|---|---|---|---|
| **RG-RULE** | 每个 `kind:"rule"` / `"constraint"` 的 `key` ∈ 本租户规则库，且状态 PUBLISHED | DataCore `GET /a/v1/rules`（探针已封装：`dataCore.rules.listRuleKeys`，`resources.ts:33`） | 探针在，skill 侧未接 |
| **RG-SOLVER** | 每个 `kind:"solver"` 的 `key` ∈ 求解器目录 | `dataCore.catalog.discover(ctx,"solvers")`（`resources.ts:24`）；内置集 `SOLVER_KEYS`（`apps/datacore/src/solvers/service.ts:44`，静态可数 **57** 条）∪ 租户临时求解器制品（`GET /a/v1/solvers/artifacts`） | 探针在，skill 侧未接 |
| **RG-SOLVER-TRUST** | 引用的求解器若是临时制品（provisional），必须显式声明容忍，否则拒绝 PUBLISHED | `SolverService.checkWriteTruth`（`apps/datacore/src/solvers/service.ts:559-568`）已有 trustLevel 概念 | 无 |
| **RG-TYPE** | 每个 `kind:"ontologyType"` 的 `key` ∈ 已发布本体 ACTIVE 类型 | `dataCore.ontology.listObjectTypeKeys`（`resources.ts:41`）；端点 `GET /a/v1/ontology/object-types` | 探针在，skill 侧未接 |
| **RG-TYPE-PROP** | `requires` 里声明的**必需属性**（SPEC §7 定案 1：「我需要 Factory，且它必须有 capacity」）在该类型的属性表里存在 | `GET /a/v1/ontology/object-types`（含属性）/ `GET /a/v1/ontology/type-semantics` | 无（契约无处声明） |
| **RG-SLICE** | 每个 `kind:"slice"` 的 `key` ∈ 切片库 | `GET /a/v1/ontology/slices` | 无 |
| **RG-TOOL** | 每个 `kind:"tool"` 的 `key` ∈ 工具注册表 | `BUILTIN_TOOLS` + `FINAL_ANSWER_TOOL` + `LOAD_SKILL_TOOL`（`apps/agentcore/src/tools/registry.ts`；`skill-lint.ts:53-60` 已有 `registeredToolNames()` 可直接复用；静态可数 **30** 个工具名） | **kind 不存在**，需扩契约 |
| **RG-MCP** | 每个 `kind:"mcp"` 的 `key`（`serverName.toolName`）∈ 本租户已发布 MCP 配置的工具清单 | `GET /b/v1/mcp-configs`（`server.ts:1411`）+ `refresh-tools`（:1525） | **kind 不存在**，需扩契约 |
| **RG-SKILL** | 每个 `dependsOn` 的 `kind:"skill"` 在本租户存在，且发布期须 PUBLISHED | `skill-lint.ts:166-193` `validateRefResolution(requirePublished=true)`（已接：`server.ts:1242` 传 `requirePublishedDeps:true`） | **已有**，直接复用 |
| **RG-WF/AGENT** | `kind:"workflow"` / `"agent"` 的 key ∈ 本租户注册表且非 RETIRED | `repos.workflows` / `repos.agents` | 无 |
| **RG-DUP** | 同一 `{kind,key}` 在 `references`/`dependsOn` 内不重复 | `skill-lint.ts:146-151` | **已有** |
| **RG-VOCAB** | `kind`/`role` ∈ 契约词表 | `skill-lint.ts:134-142`（从 `SKILL_REFERENCE_KINDS/ROLES` 派生，:49-50） | **已有** |
| **RG-OPTIONAL** | `required:false` 的引用解析失败 → **warning 不阻断**，但必须进报告与 manifest（诚实：包安装后知道自己少了什么） | `skill-lint.ts:179` 已有 `required !== false` 语义 | 部分有 |

> **口径统一**：RG 组不区分「lint」与「探针」——**一次编译产出一张引用解析表**，每行 `{kind,key,requestedVersion,resolved:{found,status,version},source:{endpoint}}`。这张表既是拒绝理由（R13：证据当场亮出），也是 §5.4 反查与 §6 manifest 的输入。

#### GR 组 · 推理图与执行图形

| 码 | 断言 | 复用什么 |
|---|---|---|
| **GR-ACYCLIC** | `SkillReasoningGraph` 无环 | 复用 `detectSkillDependencyCycle`（`skill-lint.ts:196-232`）的 DFS 三色法形状；跨资源环复用 `detectStaticCycle`（`workflow/validate.ts:117-158`） |
| **GR-REACH** | 每个节点从入口可达；每条路径终止于**已定义的终止节点**（正常出口 / 异常出口） | 新增 |
| **GR-EXCEPTION**（模板 §17 发布检查清单） | **异常路径已定义**：每个可失败节点（invoke_solver / evaluate_rules / MCP 调用 / 审批节点）必须声明 `onError`（fail / fallback→节点 / degrade），否则拒绝 | `OnErrorSchema` 已在契约（`apps/agentcore/src/catalog/service.ts:9,32` 引用）；扩到图节点 |
| **GR-APPROVAL**（模板 §17） | `sideEffect=WRITE` 或 `approvalGate≠none` 的 Skill，图里必须有审批节点或产 `action_draft` 的终止节点；判定**只用** `isWriteModeSkill`（`packages/contracts/src/agentcore.ts:201`）这一处 | 单源判定已有（`G-SIDEEFFECT-VOCAB-SPLIT` 已闭的成果，不得再造第二处判定） |
| **GR-STEPS** | 若含 `execution.steps`（确定性题型），逐条跑 `validatePlanSteps`：id 不重复 / 无前向引用 / `render_answer` 末步 / `create_action_draft` 不越 `riskLevel` / 超时合计 ≤5min | **直接调用** `workflow/validate.ts:71` `validatePlanSteps`，一行不重写 |
| **GR-SHAPE** | `render` 节点引用的求解器输出字段 ⊆ 该求解器输出形状 | `deriveRenderBindings`（`workflow/validate.ts:42`）派生 + DataCore `SOLVER_OUTPUT_SHAPES`（`apps/datacore/src/solvers/service.ts:235`）比对；与 `chain:check` 的 SHAPE 维同源 |
| **GR-BUDGET** | `maxBudgetRounds` 若声明，须为正整数且 ≤ 平台上界；**且必须能被运行时读到**（否则等于 D5「填了字段没消费方」）——本期只做**声明期校验 + 写入 runtime package**，运行时消费由 Track E 接（见 §14 诚实边界） | 契约已有字段（`agentcore.ts:260`） |

#### IO 组 · 输入输出契约

| 码 | 断言 |
|---|---|
| **IO-SHAPE** | `inputSchema`/`outputSchema` 是合法 JSON Schema 对象（至少含 `type`/`$ref`/`oneOf`/`anyOf`/`allOf` 之一）——复用 `validateJsonSchemaShape`（`skill-lint.ts:104-115`） |
| **IO-SLOT-ALIGN** | 若 Skill 绑定意图，`inputSchema.required` ⊆ 意图 `slots[]`（否则运行时必然填不满而静默降级）；两份声明必须**指向同一组槽**，编译期即对账 |
| **IO-ARG-FIDELITY**（R-ARG-FIDELITY） | `inputSchema` 里声明的**过滤维**（客户/基地/订单等）必须在 `execution.steps` 的求解器入参里出现，或列入显式豁免表并写理由——防「路由解析出来了、求解器收不到」的静默错答 |
| **IO-OUTPUT-CONSUMER** | `outputSchema` 声明后，`SkillRuntimePackage` 必须记录**谁来校验它**（渲染绑定 / 运行时后置校验）；无消费方 → **warning 并在报告里点名**「此声明目前无人消费」（SPEC D5：填了字段却没有消费方，比不填更危险） |

#### GV 组 · 治理与红线

| 码 | 断言 |
|---|---|
| **GV-LINT** | 全量复用 `lintSkill`（summary 触发/排除句、body 七段、正反例、resource 可解析、工具名拼写、引用列表）——**不重写**，编译器把它作为一个诊断源接入 |
| **GV-NO-MODEL-FILE** | 包内出现 `.lp`/`.mps`/`.nl` 等模型文件 → **拒绝**（SPEC §7 定案 2：带模型文件 = 绕过求解器注册表自带引擎） |
| **GV-NO-INLINE-DEF** | 包内 `rules/*.yaml`、`ontology/*.yaml`、`tools/*.yaml`、`solver/*.yaml` 只允许 `requires` 形态（引用 + 需求声明）；出现 `condition:`/`formula:`/`properties:`/`input:`/`output:` 这类**定义**结构 → 拒绝（SPEC §6 落地口径表） |
| **GV-NO-BIZ-CONST**（R14） | Skill 声明里不得内联业务常数（基地名/型号/阈值）；沿用 `debattery:check` 的棘轮式白名单思路，逃生舱须写理由 |
| **GV-NAMING**（红线 1） | 编译产物/AST/契约导出名不得出现 `ExecutionPlan`/`ExecutionGraph`/「执行计划」/「执行图」；由 `skill-compiler:check` 静态扫源码断言 |
| **GV-TENANT**（R2） | 所有引用解析在 tenantId 作用域内完成；跨租户 key 一律判 not found（非 403 泄漏存在性） |

#### DT 组 · 确定性（R6）

| 码 | 断言 |
|---|---|
| **DT-PURE** | Parser/Optimizer 源码不含 `Date.now(`/`Math.random(`/`new Date()`（`skill-compiler:check` 静态扫；同 `loop-control:check` 对 `classifyRetryable` 的做法） |
| **DT-DIGEST** | 同 (source, refSnapshot, compilerVersion) 两次编译 `digest` 相同、`SkillRuntimePackage` 序列化字节相同 |
| **DT-STABLE-ORDER** | 引用表、图节点、诊断条目均按稳定键字典序排序（同 `relations.ts:76-88` 的去重+确定序做法） |

### 4.3 引用可校验门的四条硬语义（决定它是真门还是装饰）

1. **发布期 fail-closed，草稿期 fail-open。**
   `probeMissingRefs` 今天三段全 `catch{ /* fail-open */ }` 且 `known.size > 0` 才判（`resources.ts:22-46`）。
   - **草稿 lint / 编辑器干跑**：保持 fail-open（DataCore 抖动不该挡住编辑），诊断标 `severity:"unknown"` 并显式写「未能校验：注册表不可达」。
   - **`publish` / `install`**：注册表不可达 → **拒绝**，`503` + `DATACORE_UNAVAILABLE`（既有码，`packages/contracts/src/common.ts:51`）。**注册表返回空集也视为不可达**（不是「没有规则」）。
   - 判据：拔掉 DataCore 后 `publish` 必须红。这条**必须有变异反证测试**，否则门在真环境是哑弹。
2. **版本钉在编译产物里。**
   引用可写 `version`（`SkillReferenceSchema.version`，`agentcore.ts:222`）或省略（= latest）。编译时把 latest **解析成具体版本号**写进 `SkillRuntimePackage.resolvedRefs[].resolvedVersion`，并同时保留 `requestedVersion:"latest"`——运行时按 latest 语义取新版（与 `resolvePlanByRef` 的 latest 口径一致，`catalog/service.ts:64-80`），但**审计可回答「发布那天它指向的是哪一版」**。
3. **必配硬门 ≠ 一刀切。** `required:false` 的引用解析失败只降级为 warning（RG-OPTIONAL），但**必须落进 manifest 的 `unresolvedOptional[]`**，安装方一眼看见自己缺什么（SPEC §5 的 `required` 字段本就是为此设计）。
4. **RG 组不接受 `force=true` 豁免。**
   既有三个 skill 发布门都留了 `force=true` 审计豁免（`server.ts:1243/1249/1254/1264`）——那三个门守的是**质量**（写得好不好、测够不够）。RG 守的是**可达性**（引用的东西存不存在）：豁免一个悬空引用等于发布一个**必然运行时炸**的技能，且炸点在用户问句上而非发布时。故 RG 组硬拒；确需放行的路径是**先把被引用的资源注册出来**，或把该引用标 `required:false`。

### 4.4 Optimizer 做什么、不做什么

**做**（全部为确定性重写，且**不改变语义**）：
- 图拓扑排序 + 无依赖节点标同一 `parallelGroup`（形状可参照既有 `ComposeStepSchema.parallelGroup`，`packages/contracts/src/execution-plan.ts:18`）。
- 引用去重与合并（同一 rule 在 precondition/postcheck 双角色 → 合并为一条带两个 role）。
- 死节点剪除（不可达节点 → 剪除并记 `info` 诊断，不静默丢）。
- 常量折叠：`requires` 中已解析的版本号内联；`resources[]` 的 blobKey 归一。
- 预算下推：`maxBudgetRounds` / `maxDiscoverCalls` 写入图的根节点预算槽。

**不做**（明确排除，避免变成第二个执行引擎）：
- 不改写求解器入参、不选型、不做任何 LLM 调用。
- 不做跨 Skill 内联/展开（`dependsOn` 保持引用语义——展开就等于把「引用而非内联」的定案在编译期悄悄推翻）。
- 不做性能启发式重排（会破坏 R6 的可解释性与字节一致性判据）。

### 4.5 编译产物的确定性指纹

`digest = sha256(canonicalJson(SkillRuntimePackage without {compiledAt, digest}))`，`canonicalJson` = 键字典序 + 无多余空白 + UTF-8。
`node:crypto` 内置，**无新依赖**。该 digest 同时是 §6 签名的被签内容。

---

## 5. Skill Registry（注册 / 查询 / 发布 / 版本 / 生命周期）

### 5.1 生命周期状态机

**今天**：`SkillDefinitionSchema.status = DRAFT | PUBLISHED | RETIRED`（`packages/contracts/src/agentcore.ts:247`），跃迁点：
- DRAFT→PUBLISHED：`POST /b/v1/skills/:id/publish`（`server.ts:1231`）
- 任意→RETIRED：`POST /b/v1/skills/:id/retire`（`server.ts:1329`，带引用方确认 `assertRetireOrDelete`）
- 只有 DRAFT 可 PUT（`server.ts:1224`，否则 409 `IMMUTABLE_VERSION`）

**目标**（任务要求的 Draft→Testing→Published→Deprecated 与既有终态并存）：

```
DRAFT ──compile ok──▶ TESTING ──eval gate pass──▶ PUBLISHED ──supersede/手动──▶ DEPRECATED ──▶ RETIRED
  │                     │                            │                              │
  └───── PUT 可改 ──────┘  （TESTING 起不可改，       └─ rollback ─▶ PUBLISHED       └─ 不可再被新绑定
                            改须 new-version）           （仅当被顶替版仍在保留期内）
```

| 状态 | 语义 | 可编辑 | 可被 agent 绑定 | 可被 `selectTenantSkills` 选中（自由问答池） |
|---|---|---|---|---|
| DRAFT | 起草 | ✅ PUT | ❌ | ❌ |
| **TESTING**（新） | 编译已过、正在跑评测/探针；可被**探针 agent** 绑定，不进生产池 | ❌（须 new-version） | 仅探针 | ❌ |
| PUBLISHED | 生产可用 | ❌ | ✅ | ✅（`selectTenantSkills` 只收 PUBLISHED、同 key 取最高版本、按 key 字典序 —— `apps/agentcore/src/router/orchestrator.ts:232-239`） |
| **DEPRECATED**（新） | 仍可运行（老绑定不断），但**禁止新绑定**、发现层降权、UI 标弃用 | ❌ | 仅存量 | ❌（不进新会话技能池） |
| RETIRED | 终态，不可运行 | ❌ | ❌ | ❌ |

**向后兼容**：状态是 `z.enum`，扩枚举是 additive；存量数据无 TESTING/DEPRECATED。**降级读兼容**：任何只认三态的消费方遇到 TESTING 应按「非 PUBLISHED」处理、遇到 DEPRECATED 应按「PUBLISHED 但不推荐」处理——为避免「新增枚举把老消费方打崩」，本 PRD 要求：**引入新状态的同一 PR 必须把所有 `status === "PUBLISHED"` 的判定点收敛为契约导出的谓词**（如 `isRunnableSkill()` / `isDiscoverableSkill()`），而不是让每个消费方自己写字符串比较（同 `isWriteEffectSkill` 的单源做法，`agentcore.ts:185`）。消费方清单须在实施时用 `grep -rn 'status === "PUBLISHED"' apps/agentcore/src` 穷举后逐个改。

### 5.2 Skill 发布门：扩展 `publishIntent` 还是另起？

**结论：另起 Skill 自己的发布门，但强制复用 `publishIntent` 已证明的三段校验器，不复制其代码，也不把 Skill 挂到意图发布路径上。**

先看 `publishIntent`（`apps/agentcore/src/catalog/service.ts:179-216`）今天到底校验什么：

| 校验 | 位置 | 与 Skill 的关系 |
|---|---|---|
| 仅 DRAFT 可发布（否则 409 `INVALID_STATE`） | :182-184 | **同构**——Skill 已有等价逻辑（`server.ts:1224` 对 PUT），发布侧需补 |
| `slots` 非空 | :186-188 | **概念对应但不同字段**：Skill 侧对应物是 `inputSchema`；两份并存正是 Track E 要收敛的（SPEC §2-④「两处未统一」）。**本期不合并**，改为 IO-SLOT-ALIGN 对账（§4.2） |
| `examples` 非空（≥1 条示例问句） | :189 | **应当照搬到 Skill**：Skill 今天没有 `examples`（触发面缺失，Track E ② 层判「全缺」）。本期作为**编译期 warning**，字段落地由 Track E 做 |
| 绑定的执行计划存在（`resolvePlanByRef(forValidation:true)`） | :190-199 | **形状可复用**：Skill 侧对应「引用可解析」，即 RG 组。`forValidation` 的「latest 允许回落到未发布最高版」这一放宽**不得**照搬进 RG——发布期必须要求 PUBLISHED（同 `requirePublishedDeps` 的教训，`skill-lint.ts:31-37`） |
| `validatePlanSteps(plan.steps, {riskLevel, requireRenderAnswer:true})` | :200 | **直接复用同一函数**（GR-STEPS） |
| 同 key 旧 PUBLISHED 自动 RETIRED | :206-212 | **不照搬**——这正是「没有 `supersedes` 只能靠隐式顶替」的病灶（§7）。Skill 侧改为**显式 supersedes + DEPRECATED**，保留期后才 RETIRED |

**为什么不扩展 `publishIntent` 本身**：
1. `publishIntent` 作用于 `IntentDefinition`（`packageId` 作用域、按场景包组织），Skill 是**租户级**资源（`tenantId` 作用域、`repos.skills.listByTenant`）——两者作用域与主键不同，硬合并会造出「意图包里的租户资源」这种四不像。
2. Skill 发布门今天已有三关（lint / 评测数量与三类覆盖 / 探针实跑），意图发布门没有；反向合并会把 Skill 的门稀释掉。
3. Track E 的方向是 **Skill 吞并 ExecutionPlan**，即最终 `publishIntent` 会退化。现在把 Skill 挂到 `publishIntent` 上，等于把要被吞并的一方设成宿主，迁移时得拆两次。

**Skill 发布门最终装配顺序**（`POST /b/v1/skills/:id/publish` 扩展；新增段落标 ✚）：

```
0. auth + requireCatalogAdmin              （既有 server.ts:1232-1233）
1. 存在性 + 租户隔离                        （既有 :1235-1236·R2）
2. ✚ 状态机：仅 TESTING 可 → PUBLISHED      （新；DRAFT 直发保留为兼容路径，走 2' 全量门）
3. GV 组：lintSkill(含 allSkills + requirePublishedDeps)  （既有 :1242-1245，force 可豁免）
4. ✚ RG 组：引用可校验门 · fail-closed · **不接受 force**   （新，§4.3）
5. ✚ GR/IO/DT 组：编译必过，产 SkillRuntimePackage         （新）
6. 评测门：skill_quality ≥3 + 三类各 ≥1     （既有 :1248-1263，force 可豁免）
7. 探针实跑 passRate=1                       （既有 :1264-1269，force 可豁免）
8. ✚ supersedes 处理：被顶替版 → DEPRECATED（非直接 RETIRED）（新，§7）
9. 置 PUBLISHED + emit skill.published       （既有 :1270-1274）
10. ✚ emit skill.compiled + 触发 DRIL 重投影 （新）
11. 回影响面 impact + lint                    （既有 :1276-1288）
```

### 5.3 注册与查询（端点见 §8.1）

- **注册** = 创建 DRAFT（既有 `POST /b/v1/skills`，`server.ts:1202`）。SDK 规格的 `/api/v1/skills/register` **映射到它**，不新增第二个创建入口。
- **查询**：既有 `GET /b/v1/skills`（列表 + `x-total-count`）与 `GET /b/v1/skills/:id`（含同 key 版本列表，:1195-1199）。新增查询维度（`status=TESTING|DEPRECATED`、`supersedes` 链、`digest`）走**同一端点的过滤参数**，不新起端点。
- **发现层**：Skill 已经是 DRIL 统一资源的一类（`projectSkills`，`resource-projector.ts:141`），发现走 `GET /b/v1/resources?kind=skill` 与 `POST /b/v1/resources/search`。新增字段须同步进投影，且**必须有非空 description**，否则 `resource-descriptor:check` 红。

### 5.4 反向影响面查询（「改 C08 影响哪些 Skill」）

SPEC §5 把这条列为「比正向更值钱」的收益。§2.3(c) 已实测**今天不成立**。落地方案：

1. **修好投影**：把 `resource-projector.ts:296 extractRelations` 里的 skill 引用抽取**合并进已接线的** `relations.ts:44 extractResourceRelations`（**合并，不是两份都留**——两个函数并存正是本病的成因），并删除死函数或让它成为前者的唯一实现。
2. **悬挂边不许静默消失**：`resource-registry.ts:224-226` 的 `present` 过滤会吞掉「引用了不存在资源」的边。改为：过滤仍保留（图只连真节点），但**同时**产出 `danglingRelations[]` 供 `GET /b/v1/resources/{kind}/{key}/relations` 与编译报告使用——**图是图，校验是校验，不能拿图当校验器**。
3. **反查端点复用**：`GET /b/v1/resources/rule/C08/relations` 的 `inbound`（`server.ts:867-870`）自然包含引用 C08 的 skill。**不新建反查端点。**
4. **牙测**：种一个引用 C08 的 skill → `inbound` 必含它；删掉抽取分支 → 测试必须变红（变异反证）。

---

## 6. 包与签名（`.skill` + `manifest.json` + `signature/`）

> **本节最大的诚实边界：仓里今天没有任何制品签名机制**（§2.2 核实：全仓 signature 相关命中仅 JWT 签发/验签与一处无关的 `callSignature`）。本节是**设计**，不是对现状的描述。

### 6.1 包结构（SPEC §6 模板 + §7 定案 1 的 `requires` 改造）

```
<skill-key>@<version>.skill        ← 单文件（见 6.2 格式取舍）
├── manifest.json                  ← SkillPackageManifest（唯一必需文件）
├── skill.json                     ← SkillSource 主定义（规范化对象；YAML 为可选作者态，见 6.2）
├── metadata.json                  ← business_owner / target_users / business_value / frequency
├── ontology/requires.json         ← 需要哪些对象类型 + 每类必需属性（RG-TYPE / RG-TYPE-PROP）
├── rules/requires.json            ← 需要哪些 rule key + 须已 PUBLISHED（RG-RULE）
├── tools/requires.json            ← 需要哪些 tool / mcp key（RG-TOOL / RG-MCP）
├── solver/requires.json           ← 需要哪个 solver + **本 Skill 专属 objective/weights（内联）**（RG-SOLVER）
├── reasoning/graph.json           ← SkillReasoningGraph（GR 组）
├── reasoning/prompts/*.md         ← 独立提示词文件（解 SPEC D2「body 平均 441 字」）
├── evaluation/testcases.json      ← 自带验收 → 直接种成 skill_quality EvalCase（解「金标集与目录漂移」）
├── output/schema.json             ← outputSchema
└── signature/                     ← manifest.sig + signer.json（见 6.3）
```

**接线点已在，不需新造承载机制**：包内每个文件天然映射到既有 `SkillDefinitionSchema.resources[]`（`SkillAttachmentSchema{name,blobKey,mime,description}`，`agentcore.ts:228-234`），agent 经 `read_skill_resource` 渐进披露（`tools/skill-resources.ts`）。该字段今天出厂 7 个 skill **全空**（`docs/SPEC-industrial-skill.md:164-176` 实测表；本次未复跑）。

### 6.2 包格式取舍（受真实依赖约束）

**约束（已核实）**：全仓**无 YAML 解析器、无 zip/tar 库**（§2.2）。

| 方案 | 依赖 | R6 确定性 | 结论 |
|---|---|---|---|
| A. zip/tar 归档 | 需新增 `adm-zip`/`tar` | 归档元数据（mtime/权限）易破坏字节一致 | **本期不选**（新依赖 + R6 风险） |
| B. **单文件规范化 JSON bundle** `{manifest, files:{path:{mime,encoding,content}}}`，键字典序 | **零新依赖**（`node:crypto` + `JSON`） | 天然字节一致 | **选它** |
| C. YAML 作者态 + JSON 分发态 | YAML 解析器（新依赖），仅 CLI 侧需要 | 分发态仍是 B | **二期可选**：CLI 端加 YAML→JSON 转换，服务端只认 JSON |

**AgentCore 今天不能收文件上传**：`@fastify/multipart` 只在 DataCore 注册（`apps/datacore/src/app.ts:7,804`），AgentCore 无 multipart。故 `.skill` 包**以 JSON body 提交**（方案 B 天然满足），或走 DataCore 已有的 blob 通道后由 AgentCore 按 blobKey 读（`tools/skill-resources.ts:23-31` 已是这个形态：共享 `BLOB_DIR` 卷）。**两条路二选一，不要都建。**

### 6.3 签名（`signature/`）

- **被签内容** = `manifest.json` 的规范化序列化（其中含 `contentDigest` = 全部包文件的 Merkle 摘要），即「签清单、清单锁内容」。
- **算法**：RS256 或 Ed25519，`node:crypto` 内置，**零新依赖**。
- **密钥与信任根**：复用既有非对称基础设施——DataCore 已持 RSA 私钥并暴露 JWKS（`apps/datacore/src/auth.ts:71-84`、`apps/datacore/src/app.ts:943`），AgentCore 已能拉取并缓存 JWKS（`apps/agentcore/src/auth.ts:28-36`，TTL 300s）。
  - **平台自签包**（出厂技能）：用平台签名密钥，`kid` 走 JWKS 发布。
  - **租户/第三方包**：租户在 `signer.json` 登记公钥；安装时校验 `kid` ∈ 该租户已登记信任集。
  - **不复用 JWT 签发密钥本体**（职责分离）：新增独立签名密钥对，但复用同一 JWKS 发布与拉取机制。
- **验签时机**：`install`（导入包）时**必验**；`publish` 时复验 digest 与库内内容一致。验签失败 → `SKILL_SIGNATURE_INVALID`，**拒绝安装**（不是警告）。
- **未签名包**：默认拒绝；租户可开启 `skill.package.allow-unsigned`（entitlement，`defaultOn:false`）用于开发态，且**必须在 UI/CLI 与 manifest 记录上标「未签名」**（R13 诚实，不静默放行）。
- **诚实边界**：密钥轮换、吊销列表（CRL）、离线验签、供应链来源证明（provenance attestation）**本 PRD 不设计**，标注为二期。

### 6.4 manifest 的 `runtime` 约束与 `dependencies`

```jsonc
{
  "schemaVersion": "1",
  "skill": { "key": "capacity_analysis", "version": 3, "supersedes": 2, "owner": "…", "domain": "…", "category": "…", "riskLevel": "COMPUTE" },
  "runtime": { "compiler": ">=1.0 <2.0", "platform": ">=1.4" },   // 语义化范围
  "dependencies": [ { "kind": "skill", "key": "material_kitting", "range": ">=2" } ],
  "requires": {                                                    // RG 组的机器可读输入
    "rules":   [{ "key": "C03", "status": "PUBLISHED" }],
    "solvers": [{ "key": "capacity_forecast" }],
    "objectTypes": [{ "key": "Base", "props": ["gwh"] }],
    "slices":  [{ "key": "model_capacity_network" }],
    "tools":   [{ "key": "invoke_solver" }],
    "mcp":     [{ "key": "mes.query" }]
  },
  "contentDigest": "sha256:…",
  "unresolvedOptional": []
}
```

- `runtime.compiler` / `runtime.platform` 用**范围表达式**；宿主版本不在范围内 → 拒绝安装（`SKILL_RUNTIME_INCOMPATIBLE`）。
- **版本范围求解器自己写**（不引 semver 依赖）：只支持 `>=`/`<`/`=`/`^` 四种，纯函数、可牙测。**注意**：Skill 的 `version` 今天是**整数**（`agentcore.ts:240` `z.number().int()`），不是 semver。故 `dependencies[].range` 作用于**整数版本**（`>=2` = version ≥ 2），`runtime.*` 才用 `major.minor`。这条**必须写死在契约注释里**，否则会有人拿 semver 语义去解整数版本。
- `dependencies` 与 `SkillDefinition.dependsOn` 的关系：**manifest 的 `dependencies` 是 `dependsOn` 的分发态投影**，不是第二份真源；安装时二者不一致 → 拒绝（`SKILL_MANIFEST_MISMATCH`）。

---

## 7. 版本演进（`supersedes` / 顶替 / 回滚）

### 7.1 今天的演进语义（已核实）

- 意图池：`updateIntent` **仅允许 DRAFT**（`apps/agentcore/src/catalog/service.ts:166-168`，否则 409 `INVALID_STATE`「仅 DRAFT 状态的意图可修改」）。
- Skill 同构：`PUT /b/v1/skills/:id` **仅允许 DRAFT**（`apps/agentcore/src/server.ts:1224`，否则 409 `IMMUTABLE_VERSION`「仅 DRAFT 状态的 skill 可修改（请用 new-version 派生）」）。
- 计划同构：`updatePlan` 仅 DRAFT（`catalog/service.ts:246`）。
- 于是**已发布的东西只能靠「建新版本顶掉旧的」演进**：`POST /b/v1/skills/:id/new-version`（`server.ts:1308-1318`）复制成 `version = max+1` 的 DRAFT。
- **顶替今天是隐式的**：意图侧 `publishIntent` 把同 key 的旧 PUBLISHED **直接置 RETIRED**（`catalog/service.ts:206-212`）；Skill 侧发布**连这一步都没有**（`server.ts:1270-1271` 只置自己 PUBLISHED），即**同 key 多个 PUBLISHED 版本可以并存**。
  - 消费侧靠「同 key 取最高版本」兜底：`selectTenantSkills`（`apps/agentcore/src/router/orchestrator.ts:232-239`）只收 PUBLISHED、同 key 留 `version` 最大者。
  - 结论：**「谁顶替了谁」今天在数据里根本不存在**，只能从版本号大小反推——这正是 SPEC §2-① 判 `supersedes` 必须是一等字段的依据。

### 7.2 `supersedes` 一等字段语义

```
supersedes?: number   // 本版本顶替的同 key 版本号；缺省 = 不顶替任何版本（首版或并行分支）
```

规则：
1. **同 key、同租户**。`supersedes` 只能指向同 key 的**已 PUBLISHED**（或 DEPRECATED）版本；指向 DRAFT/TESTING/不存在 → 拒绝发布。
2. **不可成环、不可自指**：`supersedes < self.version` 强制成立。
3. **发布副作用**：`publish` 成功后，被顶替版 `PUBLISHED → DEPRECATED`（**不是** RETIRED）。理由：RETIRED 是终态且今天带引用方确认（`assertRetireOrDelete`，`server.ts:1336`）；顶替不该悄悄把还有人绑着的版本打成终态。
4. **保留期**：DEPRECATED 版本保留 N 天（租户可配，缺省 30）内可**回滚**；到期由运维显式 retire（**不做自动 retire 定时任务**——R6：不引入时钟驱动的隐式状态变更）。
5. **链可查**：`GET /b/v1/skills/:id` 的 `versions[]`（`server.ts:1195-1199`）补 `supersedes` 与 `supersededBy`，形成可视链。

### 7.3 回滚语义

`POST /b/v1/skills/:id/rollback`（新增，见 §8.1）：
- 前置：目标版本状态 = DEPRECATED 且在保留期内；当前 PUBLISHED 版本的 `supersedes` 恰为目标版本（**只能回退一格**，不允许跨版跳回——跨版回退请用 new-version 重发）。
- 效果：目标版 DEPRECATED→PUBLISHED；当前版 PUBLISHED→DEPRECATED，并记 `rolledBackFrom`。
- **不重跑发布门**（目标版发布时已过门），但**必须重跑 RG 组**：引用的规则/求解器可能在这期间被退役了——回滚到一个引用已失效的版本是新的坑。RG 失败 → 拒绝回滚并点名失效引用。
- **不删除任何版本**，回滚是状态迁移不是删除（审计可追）。
- 事件：复用 `skill.published`（下游失效语义相同），**不新增 `skill.rolledback`**（避免 §4 事件表膨胀，`ontology:check` 也少一次漂移面）。

### 7.4 与「不可变版本」的关系

`IMMUTABLE_VERSION`（`packages/contracts/src/common.ts:58`）语义保持：**PUBLISHED/TESTING/DEPRECATED 一律不可 PUT**。演进唯一路径是 new-version + supersedes。这条**不放宽**——放宽即失去「发布那天跑的是哪一份」的可审计性（R13）。

---

## 8. API 面（硬约束：代理复用，不另起实现）

### 8.0 硬约束（本 PRD 最高优先级条款）

> **审核方已指出：SDK 规格 12 组 API 里多数在仓里已有对应端点，各建一套 = 两处会漂**（SPEC §8「头号风险：API 面重复」）。
>
> **本 PRD 立为硬约束（违反即返工）**：
> **只有 Skill Registry / Skill Compiler / Skill Package 三块是真新增实现。**
> **ontology / mcp / rule / solver / workflow / context / agent 八组能力一律代理复用既有端点，新增实现为零。**
> 「代理」的准确含义：SDK/CLI 层可以有一个**转发外壳**（做参数整形、鉴权透传、错误信封归一），但**不得**有第二份业务逻辑、第二份租户过滤、第二份权限判定、第二个持久化。
> 静态门 `skill-compiler:check` 守禁止清单（§12）。

### 8.1 真新增端点（Registry / Compiler / Package）

| 端点 | 方法 | 说明 | 与既有的关系 |
|---|---|---|---|
| `/b/v1/skills` | GET/POST | 列表 / 注册（创建 DRAFT） | **既有**（`server.ts:1182,1202`）；SDK 的 `/skills/register` 映射到 POST，不新建 |
| `/b/v1/skills/:id` | GET/PUT/DELETE | 详情（含版本链）/ 改草稿 / 删 | **既有**（:1190,1218,1342） |
| `/b/v1/skills/:id/compile` | POST | ✚ 编译：产 `SkillRuntimePackage` + `SkillCompileReport`；`?dryRun=true` 不落库 | 新增 |
| `/b/v1/skills/compile` | POST | ✚ 无 id 的临时体编译（编辑器实时反馈）；与既有 `POST /b/v1/skills/lint`（:1292）同族，**lint 保留为轻量子集**，不重复实现 lint 逻辑 | 新增薄层 |
| `/b/v1/skills/:id/package` | GET | ✚ 导出 `.skill` 包（含 manifest + 签名） | 新增 |
| `/b/v1/skills/install` | POST | ✚ 安装 `.skill` 包：验签 → 编译 → RG 硬门 → 落 DRAFT/TESTING | 新增 |
| `/b/v1/skills/:id/promote` | POST | ✚ DRAFT→TESTING（编译必过） | 新增 |
| `/b/v1/skills/:id/publish` | POST | 发布（门装配见 §5.2） | **既有**（:1231），扩展 |
| `/b/v1/skills/:id/deprecate` | POST | ✚ PUBLISHED→DEPRECATED（手动弃用） | 新增 |
| `/b/v1/skills/:id/rollback` | POST | ✚ 回滚（§7.3） | 新增 |
| `/b/v1/skills/:id/retire` · `/new-version` · `/references` · `/resources/:name` | POST/GET | 退役 / 派生新版 / 反查 / 读附件 | **全部既有**（:1329,1308,1320,1355） |

**别名**：AgentCore 既有 `/api/v1` 原生 + `/b/v1` 重写别名双前缀。新端点沿用同一注册方式，不新造第三前缀。

### 8.2 八组必须代理复用的既有端点（逐条给出目标）

| SDK 规格 API | **必须代理到（仓内既有）** | 位置 | 绝不允许 |
|---|---|---|---|
| `/api/v1/ontology/object/{type}/{id}` | `GET /a/v1/objects/:type/:id`；类型清单 `GET /a/v1/ontology/object-types`；图 `GET /a/v1/ontology/graph`；切片 `GET /a/v1/ontology/slices` | `apps/datacore/src/app.ts`（路由表见 `grep -oE '"/a/v1/(ontology\|objects)[^"]*"' apps/datacore/src/app.ts`） | 第二条本体读路径（会各判一次 A6 行级过滤与租户隔离 → 权限漂移） |
| `/api/v1/mcp/register` · `/invoke` | 配置 `POST/PUT /b/v1/mcp-configs`（`server.ts:1424,1487`）· 发布 `:1542` · 工具刷新 `:1525` · 调用走 agent 工具执行链（`tools/executor.ts`） | AgentCore | 第二个 MCP 注册表（stdio 红线 `enforceStdioPolicy`（`server.ts:1400-1409`）只在既有路径上，绕过 = RCE 风险） |
| `/api/v1/rule/evaluate` | `POST /a/v1/rules/evaluate`（另有 `/a/v1/rules/dry-run`）· agent 侧 `evaluate_rules` 工具（`tools/registry.ts`） | DataCore + AgentCore 工具 | 第二套规则解释器（`ruledsl.ts` 是唯一权威） |
| `/api/v1/solver/run` | `POST /b/v1/solvers/:key/run`（`server.ts:1746`）→ 转 `POST /a/v1/solvers/:solverKey/invoke` | AgentCore→DataCore | 第二条求解调用路径（取消/超时语义要维护两份） |
| `/api/v1/workflow/start` · `/{id}` | `POST /b/v1/workflows/:id/run`（`server.ts:1138`）· 事件流 `GET /b/v1/workflow-runs/:runId/events`（:1170）· 审批链走 Action `approvalChain`（DataCore） | AgentCore + DataCore | 第二个流程状态机 |
| `/api/v1/context/query` | DRIL 检索 `POST /b/v1/resources/search`（`server.ts:851`）· 资源关系 `GET /b/v1/resources/:kind/:key/relations`（:874）· 会话摘要 `orchestrator.conversationSummary`（`router/orchestrator.ts:1224`） | AgentCore | 第二份上下文组包（会与 DRIL 打架） |
| `/api/v1/agent/task` | `POST /api/v1/queries`（`server.ts:211`）+ SSE `GET /api/v1/queries/:taskId/events`（:372）；注册 agent 走 `engine.runRegisteredAgent` | AgentCore | 第二个 agent 入口（预算/降级/旁白治理全在既有 loop 里，绕过 = 无死循环铁保证失效） |
| `/api/v1/evaluation/feedback` | `POST /b/v1/evals`（`server.ts:1859`）· 跑 `POST /b/v1/evals/run`（:1931）· 报告 `GET /b/v1/evals/runs`（:1937） | AgentCore | 第二套评价体系。**且本 PRD 明确不接 Learning Loop**（前置未解，见 §1.2） |

### 8.3 禁止清单（`skill-compiler:check` 静态断言）

新模块目录下**不得出现**：
- 新的 `app.post("/b/v1/ontology…"` / `"/b/v1/rules…"` / `"/b/v1/solvers/…/run"` 等与上表重复的路由注册；
- 直接 `import` DataCore 源码（R1：跨包只依赖 `@platform/contracts`）；
- 自建 HTTP 客户端绕过既有 `DataCoreClient`（`apps/agentcore/src/tools/clients.ts`）；
- 手抄任何契约枚举（`SKILL_REFERENCE_KINDS` / `SkillSideEffectSchema` / `SkillCapabilitySchema` / 生命周期枚举）；
- 标识符或中文字符串含 `ExecutionPlan` / `ExecutionGraph` / 「执行计划」/「执行图」。

---

## 9. 契约 / 数据模型（双仓储四处同改；contracts-only-shared）

### 9.1 契约新增（`packages/contracts/src/`）

| 契约 | 内容 | additive? |
|---|---|---|
| `SkillReferenceSchema` 扩 kind | `SKILL_REFERENCE_KINDS` 加 `"tool"`、`"mcp"` | additive（枚举扩展）。**关键**：`skill-lint.ts:49-50` 从该常量派生词表，故 lint 自动跟随——这正是 `G-SIDEEFFECT-VOCAB-SPLIT` 已闭合的成果，不得倒退 |
| `SkillDefinitionSchema` 扩字段 | `supersedes?: number` · `owner?` · `domain?` · `category?` · `riskLevel?`（复用既有 `READ\|COMPUTE\|ACTION_DRAFT` 词表，不新造） · `status` 扩 `TESTING`/`DEPRECATED` | additive（全 optional；status 是枚举扩展，消费方收敛见 §5.1） |
| `SkillRequiresSchema` | `requires{rules,solvers,objectTypes{key,props[]},slices,tools,mcp}` | 新 |
| `SkillReasoningGraphSchema` | `nodes[]{id,type,onError,…}` · `edges[]{from,to,condition?}` · `entry` · `exits[]{kind:normal\|error}` | 新 |
| `SkillRuntimePackageSchema` | `{skillKey,skillVersion,compilerVersion,resolvedRefs[],graph,execution?{steps:PlanStep[]},budget,provenancePolicy,digest}` | 新 |
| `SkillPackageManifestSchema` | §6.4 结构 | 新 |
| `SkillCompileReportSchema` | `{ok,diagnostics[]{code,severity,path,message,evidence},resolvedRefs[],digest?}` | 新 |
| `isRunnableSkill()` / `isDiscoverableSkill()` | 状态谓词单一来源（§5.1） | 新（纯函数） |
| `ErrorCodes` 扩 | `SKILL_COMPILE_FAILED` · `SKILL_REF_UNRESOLVED` · `SKILL_SIGNATURE_INVALID` · `SKILL_RUNTIME_INCOMPATIBLE` · `SKILL_MANIFEST_MISMATCH` | additive（`packages/contracts/src/common.ts:44-63`） |

### 9.2 持久化（R9）

**方案 A（推荐·本期）**：**不新建表**。`SkillRuntimePackage` 与最近一次 `SkillCompileReport` 存进既有 `skills.definition` JSONB（`apps/agentcore/migrations/001_init.sql:118-126`，该表就是 `id/tenant_id/key/version/status/definition JSONB`）。
- 代价：`definition` 变大；查询「按 digest 找包」需扫描。
- 收益：**零迁移、零四处同改**，符合本体 R9 精神里「复用既有表不新建」（同 dogfooding 元层复用 objects/links 的做法）。

**方案 B（若需按 digest/包独立检索）**：新增 `skill_runtime_packages(id, tenant_id, skill_key, skill_version, digest, package JSONB, created_at)`，则**必须四处同改**：新建迁移 **apps/agentcore/migrations/011_skill_packages.sql**（新建·今日不存在，编号需按落地时的实际最大编号顺延） + `repo/pg` + `repo/memory` + repo 接口。

本 PRD 取 **A**；若二期 Marketplace 需要包级检索再升 B（升级路径 additive）。

---

## 10. 关键流程（端到端，沿链路）

### 10.1 作者态：写 → 编译 → 测 → 发

```
作者(GUI /admin/skills 或 CLI platform skill)
 └─ create ────────────────▶ POST /b/v1/skills              → DRAFT
 └─ compile --dry ─────────▶ POST /b/v1/skills/compile      → SkillCompileReport（RG 软判·标"未能校验"若 A 不可达）
      ↳ 诊断逐条带 JSON Pointer + 证据（哪个 key·查哪个端点·查到什么）
 └─ promote ───────────────▶ POST /b/v1/skills/:id/promote  → TESTING（编译必过·RG 硬判）
 └─ 评测 ──────────────────▶ 复用 POST /b/v1/evals + /evals/run（skill_quality 三类各 ≥1）
 └─ publish ───────────────▶ POST /b/v1/skills/:id/publish  → 门 0-11（§5.2）→ PUBLISHED
      ↳ emit skill.published（既有 L4 环）+ skill.compiled（新增）
      ↳ 被顶替版 → DEPRECATED（supersedes）
      ↳ DRIL 重投影 → skill→refs 边入 resource_relations（§5.4 修好后）
```

### 10.2 分发态：打包 → 签名 → 安装

```
源租户: GET /b/v1/skills/:id/package
   → 规范化 JSON bundle → contentDigest → 签名(node:crypto, kid 走 JWKS) → .skill

目标租户: POST /b/v1/skills/install
   → ① 验签（kid ∈ 租户信任集；失败 → SKILL_SIGNATURE_INVALID·拒绝）
   → ② manifest.runtime 兼容（不兼容 → SKILL_RUNTIME_INCOMPATIBLE·拒绝）
   → ③ requires 逐条跑 RG 组（fail-closed；缺 required → SKILL_REF_UNRESOLVED·**拒绝安装**）
   → ④ dependencies 与 dependsOn 一致（不一致 → SKILL_MANIFEST_MISMATCH·拒绝）
   → ⑤ 落 DRAFT（不自动发布——发布仍须过本租户的评测门与探针，绿测试≠能用）
   → ⑥ 报告里列出 unresolvedOptional[]（诚实：装进来了但少了什么，当场可见）
```

### 10.3 运行态（本期只到「产物就绪」，不接运行时）

`SkillRuntimePackage` 落库后，**本期不改任何运行时路径**：
- 自由问答池仍走 `selectTenantSkills` → `buildSkillSection`（暗发 `agent.skill-on-free-qa`）。
- 注册 agent 仍走 `engine.runRegisteredAgent` 挂 `agent.skills[]`。
- **`maxBudgetRounds` 的运行时消费**由 Track E 落（本 PRD 只保证它被校验并写进产物）——**这一点必须在验收里诚实标注为「未接」**，否则又是一次 D5 式的「填了字段没消费方」。

---

## 11. 非功能与不变量逐条满足

| 不变量 | 本 PRD 的满足方式 | 验证点 |
|---|---|---|
| R1 | 契约全落 `packages/contracts`；编译器实现只在 AgentCore；禁 import DataCore 源码 | `skill-compiler:check` 静态断言 |
| R2 | 引用解析、包安装、反查全带 tenantId；跨租户 key 判 not found | 牙测：A 租户的 rule 不能被 B 租户 skill 解析成功 |
| R3 | `skill.compiler` 暗发（`defaultOn:false`），DataCore/AgentCore 双注册；关 → 404 `FEATURE_NOT_FOUND` | 门关时新端点 404，既有端点行为逐字节不变 |
| R4 | 编译不写业务真值；`isWriteModeSkill` 单源判定不改；GR-APPROVAL 只加严不放宽 | 牙测：WRITE 型 skill 图里无审批/草稿出口 → 拒绝发布 |
| R6 | Parser/Optimizer 纯函数；digest 字节一致；DT 组静态扫无 `Date.now`/随机 | 牙测：两次编译字节相等；注入 `Date.now` → 门红 |
| R7 | 五个新错误码走既有信封 | — |
| R9 | 方案 A 不新建表；若走 B 则四处同改 | — |
| R10 | `skill.compiled` 有生产者 + 订阅声明 + 下游失效；同 PR 回写本体 §4 | `ontology:check`（事件集 = 本体 §4 事件集） |
| R11 | RG 组 = Skill 维的全链闭包门；结果并入 `chain:check` | `chain:check` |
| R13 | 诊断带 path + evidence + 来源端点；`supersedes` 链可查；未签名/未解析显式标注 | 牙测：拒绝理由必含被引用 key 与查询端点 |
| R14 | 编译器零业务常数；不内联规则码/求解器键白名单 | `debattery:check` 思路的棘轮扫描 |
| R15 | `platform skill create/validate/compile/package/publish/inspect` 落 `run{}`；沿用 `OPERATION_CATALOG` 的 `op:"skill"` | `cli-parity:check` |
| R16 | 编译/发布产物计入 `producedArtifacts`；引用缺失自动开 `GrowthTicket`（NEEDS-HUMAN），绝不静默残缺 | `ontogenesis:check` |
| R-一致 | 状态判定收敛为 `isRunnableSkill/isDiscoverableSkill`；词表全从契约派生；引用抽取只留一个函数 | `skill-compiler:check` |

---

## 12. 门禁与 SEAM 验收

### 12.1 新增门 `skill-compiler:check`（静态，进 `pnpm gates`）

断言（逐条须能 green→red，即注入违规必须真变红）：
1. **命名红线**：编译器/契约新增导出名与中文串不含 `ExecutionPlan`/`ExecutionGraph`/「执行计划」/「执行图」。
2. **词表单源**：编译器源码不出现 `SKILL_REFERENCE_KINDS`/`SKILL_REFERENCE_ROLES`/生命周期枚举的**字面量重复定义**，只允许 `import` 自契约。
3. **fail-closed 在**：`publish`/`install` 路径上引用解析器不得有裸 `catch {}` 吞异常（对比草稿路径允许）。
4. **RG 不可 force**：`publish` 处理器中 RG 段不得出现在 `force !== "true"` 守卫内。
5. **DT 纯函数**：Parser/Optimizer 文件不含 `Date.now(`/`Math.random(`/`new Date(`。
6. **API 禁止清单**：新模块目录不注册 §8.3 列出的重复路由；不 import DataCore 源码。
7. **单一抽取器**：全仓 skill→refs 关系抽取函数**恰好一个**且有生产调用方（直接堵 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 回潮）。

### 12.2 SEAM 驱动测试（审核方复验头号判据）

**不接受各半 unit 绿。** 至少四条组合测试，每条驱动一个真接缝：

| # | SEAM | 断言 | 变异反证（打掉实现必须变红） |
|---|---|---|---|
| **S1** | **数据半 × 引擎半**：种一个 `references:[{kind:"solver",key:"<不存在>"}]` 的 skill → `POST /b/v1/skills/:id/publish` | 返 4xx `SKILL_REF_UNRESOLVED`，message 含该 key 与查询端点；skill 状态**未变** | 去掉 RG 段 → 变绿即测试失效 |
| **S2** | **fail-closed**：DataCore 不可达（注入抛错的 `DataCoreClient`）→ publish | 返 503 `DATACORE_UNAVAILABLE`，**不放行**；同场景下草稿 compile 返 200 且诊断标「未能校验」 | 把 catch 改回 fail-open → S2 红 |
| **S3** | **反查真通**：种一个引用 `C08` 的 skill → 重投影 → `GET /b/v1/resources/rule/C08/relations` | `inbound` 含该 skill（relType=references） | 删掉抽取分支 / 换回不抽 skill 的那个函数 → 红（直咬 §2.3(c)） |
| **S4** | **顶替与回滚**：v1 PUBLISHED → v2 带 `supersedes:1` 发布 → 回滚 | v2 发布后 v1=DEPRECATED（**非 RETIRED**）；回滚后 v1=PUBLISHED、v2=DEPRECATED；回滚前若 v1 引用的规则已退役 → 回滚被拒并点名 | 把 DEPRECATED 改回 RETIRED → 红 |
| **S5** | **包往返**：export → install 到另一租户 | 验签通过、digest 一致、RG 全绿则落 DRAFT；篡改一个字节 → `SKILL_SIGNATURE_INVALID` 拒绝 | 跳过验签 → 红 |
| **S6** | **确定性 R6** | 同输入两次 compile → `SkillRuntimePackage` 序列化字节相等、digest 相等 | 在 Optimizer 里插 `Date.now()` → 红（且门 5 也红） |

### 12.3 交付底线

- `bash scripts/gate.sh`：`pnpm -r build && pnpm -r --workspace-concurrency=1 test` 四包全绿（datacore 勿并发多 vitest）。
- `pnpm gates` 全过（含新增 `skill-compiler:check`）。
- `pnpm ontology:check` 绿（新事件已回写本体 §4）。
- `pnpm prd:check` 绿（本文 §0 无悬空 R/G 引用）。
- **禁止** `cmd | tail -n; echo "EXIT=$?"`（`$?` 取的是 `tail` 的退出码，恒 0——本仓已因此把一次编译失败判成「BUILD 通过」并入正线）。

---

## 13. 分期

| 期 | 内容 | 出口判据 |
|---|---|---|
| **P0 · 止血（最小可用硬门）** | ① 把 `probeMissingRefs` 接进 skill publish（solver/rule/objectType 三类，先复用现成的）② 改 publish 期 fail-closed ③ RG 不可 force ④ 修 §2.3(c) 的抽取器合并 | **S1 + S2 + S3 三条 SEAM 绿**；四包全绿。**这三条今天就在流血，且不依赖任何新契约** |
| **P1 · 契约与编译器骨架** | `SkillRequires` / `SkillReasoningGraph` / `SkillRuntimePackage` / `SkillCompileReport` 契约；Parser + Validator（RG/GR/IO/GV/DT 全组）+ Optimizer；`compile`/`promote` 端点；`skill-compiler:check` 门；`SKILL_REFERENCE_KINDS` 扩 `tool`/`mcp` | S6 绿；门 1-7 全部 green→red 自证 |
| **P2 · 注册中心生命周期与版本** | TESTING/DEPRECATED 状态 + 状态谓词收敛；`supersedes`/`deprecate`/`rollback`；版本链可视 | S4 绿；`grep 'status === "PUBLISHED"'` 清零（全走谓词） |
| **P3 · 包与签名** | JSON bundle 包格式；manifest + runtime 范围求解器；签名/验签（复用 JWKS 机制）；`package`/`install` 端点 | S5 绿 |
| **P4 · CLI 与前端** | `platform skill create/validate/compile/package/publish/inspect` 落 `run{}`；`/admin/skills` 页接编译诊断与版本链 | `cli-parity:check` 绿；`ui-smoke` 可点到诊断与回滚 |
| **二期（不在本 PRD）** | Skill Orchestrator（Skill Graph 运行时）· Learning Loop · 密钥轮换/吊销 · Marketplace 检索 · YAML 作者态 | — |

---

## 14. 诚实边界（单列）

### 14.1 本次工作方式的边界

- **只读代码、只写文档**。本次**未运行**任何测试、未运行 `scripts/gate.sh`、未运行 `pnpm gates`、未跑 `seedRegistry()`、未起任何服务。
- 所有计数（57 求解器 / 30 工具 / 28 出厂规则 / 7 出厂 Skill / 32 意图 / 32 计划 / 20 场景卡）均**静态读源码得出**，命令见 §14.3。与 SPEC/WO 文档的实测数一致，但**不等于运行时真值**（租户可自建规则/求解器制品）。

### 14.2 「未核实」清单（明确不装懂）

| 事项 | 状态 |
|---|---|
| 出厂 7 个 Skill 的 `body` 字数（441 平均）与「`dependsOn`/`maxBudgetRounds` 7/7 全空」 | **未复跑**。引自 `docs/SPEC-industrial-skill.md:164-176`（该文标为跑 `seedRegistry()` 实测）。本次只静态确认了「7 个 `id: "skl_"`」 |
| 「分类器排第 11 站、前有 10 道正则门抢答」 | **未核实**。引自 SPEC §8「两处必须先解决的前置」，本次未逐门清点 orchestrator 的分路顺序 |
| 「91 个 ACTIVE 对象类型 / 11,087 对象 / 771 属性」 | **未核实**（运行态数字，需起服务查） |
| `/metrics` 两服务 200 无鉴权、埋点跨租户混算 | **未核实**（引自 SPEC §2-⑫、§8） |
| 租户运行态实际可用的 rule / solver / MCP 工具集 | **未核实**（与出厂静态集不同；正因如此 RG 组必须查**运行态注册表**而非内联静态白名单） |
| DataCore `/a/v1/rules` 的 `listRuleKeys` 是否返回全部状态或仅 PUBLISHED | **未核实**（`resources.ts:33` 只调用，未展开 `DataCoreClient` 实现）。RG-RULE 要求「PUBLISHED」，实施时**必须先核对该客户端方法的过滤语义**，否则会出现「引用了 DRAFT 规则却判通过」 |
| 「MCP 工具 key 的命名空间形态是否为 `serverName.toolName`」 | **未核实**（据 `mcpServerNameSlug`/`MCP_SERVER_NAME_RE` 推断，未读工具装载实现） |

### 14.3 可复跑的核实命令（全部只读）

```bash
# 求解器 57
awk '/^export const SOLVER_KEYS = \[/,/^\] as const;/' apps/datacore/src/solvers/service.ts | grep -cE '^\s*"'
# 工具 30
grep -oE 'name: "[a-z_]+"' apps/agentcore/src/tools/registry.ts | sort -u | wc -l
# 出厂规则 28
grep -oE 'key: "C[0-9][0-9]"' apps/datacore/src/synthetic/battery.ts | sort -u | wc -l
# 出厂 Skill 7
grep -c 'id: "skl_' apps/agentcore/src/mocks/seed.ts
# 场景卡 20
grep -c 'card("S' apps/agentcore/src/scenarios-catalog.ts
# 无签名机制
grep -rniE '\bsignature\b|cosign|sigstore|\.sig\b' --include='*.ts' apps packages | grep -viE 'design|signal|assign|signif|signoff'
# 无 YAML / zip / tar 依赖
grep -rn 'yaml\|adm-zip\|jszip\|"tar"' apps/*/package.json packages/*/package.json package.json
# skill 发布不调引用探针（只有 agent/workflow 调）
grep -rn 'probeMissingRefs' apps/agentcore/src
# 引用抽取器零生产调用方
grep -rn '\bextractRelations\b' apps packages scripts
# outputSchema 无校验消费方
grep -rn 'outputSchema' apps/agentcore/src --include='*.ts'
```

### 14.4 设计层面的已知风险（不藏）

1. **RG 组硬门会挡住存量。** 出厂 7 个 skill 的 `references` 内容本次未逐条解析。若其中有指向未注册资源的引用，接门后**它们会发布不了**。实施 P0 时必须先跑一次「全量存量 dry-run 编译」列出违规清单，再决定是修数据还是给存量一次性豁免（**豁免须逐条登记理由，不许开全局开关**）。
2. **状态枚举扩展是最容易打崩下游的一步。** §5.1 已要求把 `status === "PUBLISHED"` 收敛为谓词；如果实施时偷懒不收敛，会出现「TESTING 的技能被自由问答池选中」这类半开态（`G-SKILL-UNREACHABLE-FREE-QA` 同族）。
3. **`maxBudgetRounds` 本期仍无运行时消费方。** 本 PRD 只保证它被校验并写进产物。若验收时宣称「预算按题型生效」而不做 Track E 的运行时接线，就是又一次 D5 式的假完成。**验收文案必须写「已声明·未接运行时」。**
4. **包签名的信任根是新的攻击面。** 本 PRD 复用 JWKS 分发机制但新增签名密钥；密钥保管、轮换、吊销未设计（二期）。在此之前，`install` 应默认只接受**平台自签**包，租户第三方包需显式开启。
5. **编译器与既有 lint 的边界必须一次划清。** 若 `POST /b/v1/skills/lint` 与 `POST /b/v1/skills/compile` 各自演化出一份规则，就是本文一直在防的「两处会漂」。落地口径：**lint 是 compile 的一个诊断源子集**（GV 组），不得有独立规则。
