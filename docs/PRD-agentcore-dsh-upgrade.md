# PRD：AgentCore 执行内核升级 —— 接入外部 agent 运行时（dsh）

**版本**：v2.1 · 2026-08-16（v2.0 后追加 dsh web 真机实跑：§5.3 补证 3/4 + 前置 A/B/C 三处修正 + §15 升级——dsh 前端/能力面结论整体从 E2 审计升为 E1 实测；可行性裁决不变且论据加强）
**对象**：POC 分支 `claude/handoff-wo-dsh-poc-s1` @ `6b9a7558`（S0–S4，E1–E6 全绿）
**相关**（四份全是判断，本份是规格）：
- `docs/REPORT-harness-migration-feasibility.md`（能不能换）
- `docs/REPORT-dsh-poc-s0.md`（POC 做了什么）
- `docs/DECISION-dsh-fusion.md`（该不该并 / 什么条件下翻 flag —— 护栏分支，已裁决「**代码可以并，flag 不能翻**」）
- `docs/ASSESS-pi-agent-harness-replacement.md`（早期评估）
- ⚠️ `docs/PRD-agent-react-harness.md` **不是**本线的 PRD —— 它是升级我方自有 ReAct 循环的规格，全文 0 次提及 dsh，勿拿它当起点
- POC 测试结果报告 `dsh-poc-test-results.md`（**报告面**：只在对话流转、未提交进分支；引用本文一律标注「POC 分支 file:line」或「POC 报告 §N」）

**命名纪律**（审核方 §5.2）：`dsh` / `deepseek-harness` 是**被集成的外部运行时**，本文照实称呼；平台自有概念（适配层、门、事件、页面）一律不用外部产品名命名。

**前置状态**（2026-08-16 审核方实测订正，原文两处与现实不符）：
- **并线动作在审核方手上，不是「已派其他 dev 执行中」**。集成分支 `claude/verify-reclaim-6` 此刻领先 canonical **403 提交**，卡在治理门链上（已修绿：本体锚点门 · 迁移编号撞车 ×2 · 前端写死业务数据门 · PRD 数据承载门；当前红在 `factlock-anchor:check` 的 41 条位置锚事实锁，已派单分诊）。**POC 6 提交的 merge 排在集成分支并 canonical 之后**（直接并 dsh 进 canonical 会顺带偷渡 191 条未过门的集成提交 —— `canonical..dsh`=197 而 `集成..dsh`=6，那 191 条是分支点位置不是 POC 体量）。
- **`dsh-dormancy:check` 尚未在集成分支上**。它在 `claude/handoff-wo-dsh-fuse-guards` 分支上已建并已接 gates；**集成分支上该门文件不存在，`package.json` 的 gates 串里 `dsh-dormancy` 命中 0**（实测）。「已接进 pnpm gates（56 门）」这句要等该分支收编后才成立。
- 上述两条不改变本 PRD 任何技术结论，但**状态声称必须与现实一致** —— 本仓的教训是「我用『某处已登记』当作『它已生效』的证据，而前者并不度量后者」。
本 PRD 任何改动不许破坏 `dsh-dormancy:check` 的 D1/D2/D3 三判据（§7.4）。

---

## §0.0 审核方复验记录（2026-08-16）

**结论：过。** 格式判据 7 条全过，铁律 0 的《本体引用与影响》在 §10，命名纪律已声明。

**逐条复核了 5 项承重数据**：

| PRD 写的 | 审核方实测 | 判定 |
|---|---|---|
| `endpoints.ts` 2,540 行 | **2,540** | ✅ 逐字相符 |
| 58 个 admin 管理页 | **58** | ✅ 逐字相符 |
| `agentcore.ts:117` McpServerConfigSchema | 逐字相符 | ✅ |
| API 面 146 | **148** | 🟡 已漂，见 §1.2 订正 |
| 后端 173,671 + 前端 89,003 | 口径不一致 | 🔴 已订正，见 §0 |

**审核方核不了的**（如实标注，**不许读成「已确认」**）：§5.3 补证 3/4 的 dsh web 实跑证据（75 事件真轮次 · compaction 39 条/15491 tokens · 159 插件清单 · serverName 负向接缝六用例 · 本体切片 MCP 桥端到端）—— 审核方无 dsh 运行环境，**这些条目状态 = 未复验，不是已确认**。
本 PRD 自带的 §15 举证分级（E1/E2/E3）机制本身是对的，复验方按级抽查即可；但**举证等级由撰写方自评这一事实本身**要写在读者看得见的地方。

---

## §0 可行性裁决（先答「所有配置、API 都迁移到 dsh 上是否可以」）

**不能整体迁移，也不应整体迁移。正确的提法是「执行内核换芯」，不是「平台迁移」。**

dsh（`0.1.0-rc.6`，developer preview）是 agent 执行循环运行时：session/prompt、工具调用瀑布、MCP 客户端、LLM provider 适配口。它**没有**租户、鉴权、entitlement、审计、持久化、HTTP 管理面——这些概念在 dsh 无对应物；前端方面 dsh **有**单机开发者工具形态的前端（dsh web,2026-08-16 已实跑，§5.3 补证 3），但它是直插 Host 的单用户调试/工作台壳，无租户无鉴权，**不是多租户产品化前端**，不构成我方产品前端的可搬迁对应物（搬迁否决见 §5.3，E1 行为面印证）。现有系统表面对 dsh 是**三分**：

| 分档 | 表面 | 处置 |
|---|---|---|
| **A · 可映射**（POC 已证） | AgentDefinition 执行面 · McpServerConfig 连接面 · 规则 PRE_CHECK 闸（经裁决网桥） | 配置真相源不动，运行时编译为 SetupSpec（§4） |
| **B · 补缺口后可映射** | STALL_LOOP 降级理由 · 多租户 serverName · 真 LLM provider · 真规则裁决 · POST_CHECK/WORKFLOW 工具 | §6 三条前置 + §4 缺口行，各带销账判据与工单 |
| **C · 不可迁移**（dsh 无对应物） | 146 个 `/b/v1/*`+`/api/v1/*` 端点 · 租户/鉴权/审计 · persistence · workflow 引擎 · 规则引擎本体 · SSE 外壳 · **前端全表面 89,003 行实测：58 个 admin 管理页 + 7 个求解投影页 + Object360 + 登录/权限/暗发体系（`App.tsx:130-232` 55+ 路由、`api/endpoints.ts` 102 处端点引用）——其中仅会话面 ~2,800 行（3%）与 dsh 有讨论关系** · growth/ops/dril/plan-builder 业务域 | **永久保留我方外壳**。这是架构分工，不是妥协 |

**「dsh 可组合（cordis 插件模式），所以都能基于 dsh 重建」之辨（2026-08-16 实录）**：可组合性属实且已被本方案使用——harness 的 platform-world/platform-governance 就是我方 scoped 插件（治理闸/允许表/final_answer/load_skill 全是插件模式落地），本轮负向接缝与 MCP 桥测试也直接以 `provide/plugin/inject/effect/dispose` 驱动 cordis 4.0.1 成功。但要区分「**容器能装**」与「**容器提供**」：cordis 是 DI/生命周期容器，能装任何东西（任何插件框架都能）；dsh **提供**的领域能力只有 agent 执行域（loop/工具瀑布/MCP/skill/compaction/session）。我方平台域实测（**统一 src-only 口径**，2026-08-16 审核方复核）：**后端 103,030 行 + 前端 88,926 行 ≈ 19.2 万行**（租户/本体/切片/求解器/evals/R-write/审计/58 管理页）。⚠️ **口径订正**：本行初版写「后端 173,671 + 前端 89,003」，审核方复核发现**两个数口径不一致** —— 前端那个是 `src` 仅（复核 88,926，差 77），后端那个实为 `src+test`（复核 179,976）。拼成「26 万行」是苹果加橘子，而这个数正是本节反驳「基于 dsh 重建」的核心论据，**用混合口径会把整段论证的可信度一起带走**。统一 src-only 后仍是 19.2 万行，论点不变、论据更硬。复算：`find apps/{datacore,agentcore}/src -name '*.ts' | xargs wc -l | tail -1`（103,030）· `find apps/frontend-shell/src -name '*.ts' -o -name '*.tsx' | xargs wc -l | tail -1`（88,926），把这些重写成 cordis 插件在「能装」层面成立，但 dsh 对它们的贡献为零——那不是「基于 dsh 完成」，是「基于一个 0.1.0-rc.6 的 DI 容器重写 26 万行」。且 tenant_id everywhere 是横切不变量不是插件：dsh 核心数据结构（session/workspace/storage）无 tenantId 字段，补它 = fork 核心包而非写插件。**结论：插件模式用在 agent 执行域（本 PRD 的既有形态），平台域留在我方仓——可组合性改变集成深度，不改变三分归属。**

---

## §1 现状盘点（每条带 file:line 或可复算命令）

### 1.1 配置面（真相源 = 我方 persistence，contracts zod 单源）

| 配置 | Schema 出处 | 关键字段 |
|---|---|---|
| AgentDefinition | `packages/contracts/src/agentcore.ts:60`（Schema 自 L23） | tools 三态 `BUILTIN/MCP/WORKFLOW`（L9-20）· ruleBindings `PRE_CHECK/POST_CHECK/BOTH`（L33-36）· skills+mcpServers+scopeDeclaration+budget+role |
| McpServerConfig | `packages/contracts/src/agentcore.ts:117` | transport `streamable_http/stdio` · credentialRef · serverName `^[a-z0-9_]{2,24}$` · toolTimeoutMs≤60s · status/lifecycle 版本化 |
| Skill/Workflow/规则/LLM 绑定矩阵 | contracts 同包 | 规则引擎、workflow 引擎 = C 档；LLM 绑定矩阵 → 外部运行时 provider 适配 = §6 前置 A |

### 1.2 API 面（`apps/agentcore/src/server.ts`，复算：`grep -cE 'app\.(get|post|put|delete|patch)\("' apps/agentcore/src/server.ts` —— **2026-08-16 审核方实测 148**（本 PRD 初版写 146，其后 `server.ts` 又并入两次，数已漂）。⚠️ 此处**给了复算命令是正确实践**——数会漂，命令不会；引用时一律以现算为准，不以本文写死的数为准）

管理面 `/b/v1/*`：skills×12 · mcp-configs×12 · workflows×11 · scenarios×11 · plan-builders×9 · agents×9 · resources×7 · evals×7 · llm×5 · rules/intents/skill-graphs/outbox/operations…
运行时面 `/api/v1/*`：queries×11（提交/SSE 事件流/clarification/cancel/feedback/decision-trace/trace/agent-run）· catalog×9 · growth×7 · ops…

**处置：全部 C 档，零变更。** 外部运行时只替换 `POST /api/v1/queries` 内部 `engine.ts` 的执行路径；端点契约、SSE 事件名、`AgentRunRecord` 写库全部保持。

### 1.3 前端面（`apps/frontend-shell`）

- **管理页**（`src/pages/admin/`，40+）：AgentsPage · McpPage · SkillsPage · SkillStructure · LlmProvidersPage · RulesPage · CatalogPage · ConnectionsPage · PermissionsPage · EvalsPage · PlanBuilderPage…
- **执行轨迹 UI**：`src/pages/TaskDetailPage.tsx` + `src/sse/` 消费链（QOS SSE 事件驱动）
- **处置**：页面零迁移零改造（§5 列唯一新增项）。

### 1.4 POC 已交付面（分支 `handoff-wo-dsh-poc-s1`）

- 适配层 `apps/agentcore/src/dsh-runtime/`：`index.ts / setup-spec.ts / runner.ts / reassemble.ts`（四文件，`git ls-tree` 可复算）
- 外部闭包 `packages/dsh-harness/`：cordis.yml + 插件 platform-sdk-server / platform-governance / platform-world / mock-llm / echo-tool
- 休眠分叉 `apps/agentcore/src/engine.ts:497-498`（`if (process.env.DSH_HARNESS === "1")` + 动态 import）；provider 缺省 `engine.ts:509` `DSH_HARNESS_PROVIDER ?? "mock"`
- 验收 `apps/agentcore/test/dsh-poc-acceptance.test.ts`：E1 配置驱动 · E2 规则闸 · E3/E3′ 租户凭据路由 · E4 工具名逐字节 · E5 flag-off 全量回归 1079 绿 · E6 SSE 三层裁决 + mutation 反证（POC 报告 §3–§5）

---

## §2 范围

**In**：① 执行运行时替换面（`runAgentLoop` 那一层）；② 三件套治理面逐字段映射；③ 前端融合面（§5）；④ 灰度与回退（§8）。
**Out**：配置数据搬家（无库可搬）· 前端暴露外部运行时概念 · 替换 workflow/规则引擎/plan-builder/datacore · 追外部运行时上游 master（版本钉死，升级走 §9 契约测试）。

---

## §3 目标架构

```
前端 40+ 页面（零变更，§5 仅 1 个只读新增）
   │ REST /b/v1/* · /api/v1/* · SSE                 ← C 档：永远我方
AgentCore 外壳：租户/鉴权/entitlement/审计/persistence/规则引擎/workflow 引擎
   │ engine.ts 执行分叉（三级灰度开关，§8）
   ├─ 关 → runAgentLoop（旧路，退役前保留）
   └─ 开 → dsh-runtime 适配层（POC 已建，A 档）
             │ SetupSpec 编译（配置映射，内存瞬态，不落库）
             │ JSON-RPC stdio
        外部运行时子进程（闭包收在 packages/dsh-harness）
             │ tools/pre-execute → 裁决网桥 → 我方规则引擎（前置 A 同批落地）
             │ MCP 客户端 → 真实 MCP servers（凭据父进程解密过 wire，不落日志）
             │ LLM provider 适配器 → 我方 LLM 绑定矩阵（前置 A）
```

配置流向不变：管理页面 → `/b/v1/*` → 我方库（真相源）→ 运行时映射（内存）→ setup 帧（瞬态，不持久化）。

---

## §4 三件套逐字段映射（审核判据：哪些有对应、哪些没有、没有的怎么办）

### 4.1 AgentDefinition → SetupSpec（`dsh-runtime/setup-spec.ts`）

| 我方字段 | 外部运行时侧 | 状态 | 没有的怎么办 |
|---|---|---|---|
| `model`（空=租户绑定矩阵回落） | provider/model 选择 | ✅ E1 | — |
| `systemPrompt` | setup `header.system` | ✅ E1（persona 差分+还原逐字节） | — |
| `tools[BUILTIN/MCP]` + `scopeDeclaration.toolNames` | 允许表 = scope∪授予∪{final_answer, load_skill}，只加不减 | ✅ E2 | — |
| `skills[]` + `arguments` 默认值 | skills 映射 + `load_skill` 过 wire | ✅（S3 缝） | scope 语义：仅允许表内可调，越界 deny |
| `ruleBindings` **PRE_CHECK** | `tools/pre-execute` 闸 → deny 即 `tool/result isError` | ✅ E2（deny 计数 0/基线 1） | — |
| `ruleBindings` **POST_CHECK / BOTH** | 对面有 `tools/post-execute` 瀑布，**POC 未接** | ⛔ 缺口 | **WO-DSH-P1-MAP**：接 post-execute → 同一裁决网桥；验收=POC E2 对位副本（POST 段 deny 可观测、execute 已发生的诚实标注） |
| `tools[WORKFLOW]` 引用 | 对面无 workflow 概念 | ⛔ 缺口 | **WO-DSH-P1-MAP**：workflow 工具经 BUILTIN 桥暴露，仍由我方引擎执行；验收=跨系统 SEAM 用例（dsh 触发 → 我方 workflow 真跑 → 结果回帧） |
| `budget`（steps/seconds/tokens） | turn budget | ⚠ 部分 | 与前置 B 的 watchdog 同批（环检测=第三层，超时=第一层，互不顶账） |
| `provenancePolicy/writeMode` 拒绝语义 | 重组装侧严校验（AnswerBlockSchema 单源） | ✅ S3 同口径 | — |
| `role` / `status` / `version` / `key` | 对面无（治理元数据） | ✅ 设计如此 | 不进 setup 帧；留在外壳（C 档） |
| `tenantId` | **对面没有** | ⛔ 前置 C | §6 前置 C 命名空间方案 |

### 4.2 Skill → 外部运行时 skill

| 项 | 状态 |
|---|---|
| 描述/参数 schema 映射 | ✅ `mapSkill`（POC 分支 `setup-spec.ts`） |
| `load_skill` scope | ✅ 允许表只加不减；越 scope 调用 = deny（E2 同机制） |
| inputSchema 默认值（WO-SKILL-1 arguments） | ⛔ 未验 → 随 WO-DSH-P1-MAP 补断言 |

### 4.3 MCP → server 注册 / 凭据 / serverName

| 我方字段 | 状态 | 说明 |
|---|---|---|
| transport（streamable_http/stdio） | ✅ | POC 已映射 |
| credentialRef → 凭据注入 | ✅ E3/E3′ | 父进程映射期解密 → stdio wire → 子进程内存；**绝不落日志/持久化**；响应只回 credentialRef；跨租户解析 = undefined → fail-closed |
| 工具可见名 | ✅ E4 | `publicToolName` 8 语料逐字节（含 64 字符截断+hash 边界） |
| `serverName` 命名空间 | ⛔ **前置 C** | 对面 root 级预约，与 tenant_id everywhere 直接冲突（§6） |
| `toolTimeoutMs`（≤60s） | ⛔ 未验 | **WO-DSH-P1-MAP**：过 setup/会话参数；验收=超时覆盖生效断言 |
| `status/lifecycle`（DRAFT/PUBLISHED/RETIRED） | ✅ 不进对面 | 版本治理留外壳（C 档） |

---

## §5 前端融合面（现有四份文档一个字都没写的那一半）

### 5.1 执行轨迹 UI ↔ 外部运行时帧流（页/组件级）

| 页面/组件 | 现消费 | 换芯后 | 工作量 |
|---|---|---|---|
| `src/pages/TaskDetailPage.tsx` + `src/sse/` | QOS SSE 事件流 | **零改动** —— 适配层重组装回同名事件（§5.2 表） | 无 |
| `TaskDetailPage` 降级理由展示位 | `agent_degraded` 的 reason 枚举 | ⚠ `STALL_LOOP` 态在前置 B 销账前**重组装不出来**（POC 分支 `reassemble.ts:10` 逐字自陈） | 屏上文案：前置 B 未销账期间 dsh 路不出现该态=护栏净减少，**不许用别的理由顶替显示**；销账后恢复 |
| `pages/admin/AgentsPage.tsx` | AgentRunRecord.attribution | **新增只读徽标**「执行内核：原生 / 外部运行时」（取既有 attribution 字段，additive） | 半张单（WO-DSH-P2-UX） |
| `pages/admin/McpPage.tsx` / `SkillsPage.tsx` / `AgentsPage.tsx` 编辑面 | `/b/v1/*` CRUD | **零字段变化** —— 配置真相源不动，无任何字段因换芯变只读或新增 | 无 |

### 5.2 SSE 事件名逐条对照表（QOS 事件名一字不差）

来源：POC 分支 `dsh-runtime/reassemble.ts`（行号可复算）+ E6 三层裁决（POC 报告 §3-E6）。

| 外部运行时帧 | 我方 SSE 事件 | 档位 |
|---|---|---|
| `tool/call` | `step.started`（stepId=toolCallId, type=工具名） | ① 逐帧直映（reassemble.ts:187-191） |
| `tool/result` | `step.completed`（status OK/ERROR） | ① 逐帧直映（:194-198） |
| `assistant/chunk` | `step.completed`（type=agent_narration） | ① 逐帧直映（:200-205） |
| `assistant/message` + `turn/end` | `final_answer`（Answer 重组装，AnswerBlockSchema 严校验） | ② 末尾重组装 |
| `request/*` · `session/created` | —（不映射，观测帧不进 QOS 面） | ③ 不映射 |
| 环检测早停 | `agent_degraded` reason=`STALL_LOOP` | ⛔ **重建不了** → 前置 B |

**判据**：翻 flag 前后，同一任务的事件名序列逐项相等；唯一允许的差 = 前置 B 销账前 `STALL_LOOP` 态缺失（这正是前置 B 构成闸的原因，不是可接受的漂移）。

### 5.3 裁决 · 是否采用外部运行时的自带前端替换我方页面

**问**：dsh 有自带前端（npm 实测：`@deepseek-ai/dsh-web-frontend` 0.1.0-rc.6，自陈「vite build over `dsh-client-web` shell lib；dist 由 dsh 自家 CLI 的 `dsh web` 伺服」），能否用它替换目前系统对应功能的页面？

**答：不能替换，本 PRD 不采用。** 三条证据级理由：

0. **它的全部页面名录已实测**（2026-08-16 拆包 `@deepseek-ai/dsh-web-app` 的 `cordis.patch.yml` 浏览器名录，逐条为包内实物）：
   - **主面**：`ui-conversation`（会话主页）· `ui-sidebar`（会话侧栏）· `ui-layout` / `ui-theme` / `ui-locale`
   - **设置**（终端用户级，非平台管理级）：`ui-settings-general` · `ui-settings-models` · `ui-settings-plugin-inventory` · `ui-permission-presets` · `ui-agent-preset`
   - **会话内面板**：`ui-tool`（工具调用树+业务工具视图）· `ui-workflow-run` · `ui-deliverables`（产物文件行）· `ui-jobs` · `ui-goal`（GoalBar）· `ui-message-feedback`（赞/踩）· `ui-model-selection` · `ui-input-trigger`+`ui-commands`（`/`、`@` 管线）· `ui-skill` / `ui-subagent`（引用源）· `ui-cordis`（插件检视）· `ui-workspace` · 会话导出 · 全文会话搜索（opt-in）· 目录选择器
   - **关键事实：名录里没有任何 agent/skill/MCP/规则的配置管理页**——dsh 的配置面是 cordis.yml 文件，不是 GUI。它是一个 **coding agent 聊天客户端**（其 persona 原文「You are a coding agent…」），会话页是真材实料，管理页不存在。
   - **dsh 也不带技能内容集**：全 scope 唯一的 bundled skill 是 `dsh-skill-badge`（「powered by dsh」徽章，品牌自演示件，已拆包核实内容）；`dsh-skill` 只是 provider 注册表（机制无内容）。技能内容全由使用方供给——对我方即 SkillDefinition 经映射注入（E 套件已验）。

1. **它不是我方页面的对应物**。dsh web 前端是 **dsh 运行时自己的 agent 会话壳**（bootWebShell 两阶段引导 + AppRoot gate + 直连 dsh server 讲 dsh 协议）。我方 40+ 管理页管的是租户/AgentDefinition/McpServerConfig/规则/技能/权限/评估/plan-builder——这些对象在 dsh 里不存在，dsh 的前端**无页面可对应**。「对应功能的页面」这个前提只在**一处**表面成立：执行轨迹/会话视图。
2. **唯一重叠处替换 = 净损失**。执行轨迹视图（我方 `TaskDetailPage` + `src/sse/`）承载的不只是帧展示，还有诚实层：scope 诚实徽标、降级理由展示、⟦ref:N⟧ 溯源、R13 输出纪律可视化——dsh 的 UI 对这些概念一无所知，换上它 = 诚实层静默消失，而诚实层正是本仓门禁体系要守的东西。
3. **代价是把我方前端嫁接到 dsh 的 boot 上**。采用它 = 把 `dsh-client-web` 的两阶段引导/种子表变成我方前端的运行时依赖，且它消费的是 dsh 协议而非我方 `/api/v1/*`+SSE 契约——要么双协议并存，要么把我方契约翻译成 dsh 协议再翻译回来，两个方向都制造第二真相源。另：该包**不在**钉死的 43 包闭包内，采用它 = 扩大闭包与供应链面。

**补证 · 组件级采用评估**（2026-08-16 二次审计，修正上一版「整壳」单一口径；证据 = 拆包 `@deepseek-ai/dsh-client-ui-conversation` / `dsh-client-ui-tool` 的 README+包元数据）：dsh 的 UI 件是**独立 npm 包**（逐件列在 `dsh-web-app` dependencies，MIT，导出 lib+src；`ui-conversation` 的 `lib/client.js` 426KB React），且**扩展缝干净**——会话行是注册表贡献（声明合并 `ChatNodeDataMap` + `ctx.conversationEvents` 注册 + `conversation.chat.node` keyed 渲染器），工具视图走 `tool.call.toolview` 槽。推论：我方诚实层元素（scope 徽标/⟦ref:N⟧/降级理由）**可以**以注册自定义节点方式注入，诚实层不是组件级采用的硬障碍。**组件级采用仍判不采用**，障碍在数据权威与依赖面：
- **组件不独立运行**：README 原话「Components are pure: the framework standard kit supplies `useSession`/`sessionId`, global `useSessions`/`useWorkspaces`, and the input machine's `useInput`/`inputActions`」——它们消费 dsh client runtime 的 session 模型与 Host 快照（`session/queue`、Host 回调、`$DSH_HOME` 偏好）。我方数据喂进去 = 前端造「伪 Host」适配层把 `/api/v1/*`+SSE 翻译成其 store 模型 ⇒ 翻译层 = 第二真相源，工作量≈重建，还白背框架依赖。
- **直连 dsh runtime 不可行**：绕开 agentcore = 绕开 tenant/authz/entitlement/审计，直接违反 tenant_id everywhere 与 Entitlement 先于 authz（§10.4）。
- **闭包膨胀**：每 ui 包 + client runtime 全系 `0.1.0-rc.6`，钉版闭包 43 → 60+ 且全是预览版。

结论维持「交互模式参照」（处置 2）：值钱的是交互设计（工具树形态、steer/queue、compaction 行、赞踩），读其 README 与骨架行为即可学到，零依赖零风险；组件实现搬过来要连框架一起搬，不值。**E1 行为面印证（2026-08-16 实跑）**：耦合深度从结构推理升级为行为实证——斜杠命令是客户端 matchEnter 拦截（不过 RPC，直发即穿透成用户消息）、compaction 请求由浏览器页面持有 abort 开关（页面一关压缩即 abort）、侧栏/工作区/composer 状态直读 Host 内存。dsh 前端不是渲染层，是半个运行时；组件级搬迁否决据此从 E2 升 E1。

**补证 2 · 我方会话面实测清单**（2026-08-16 读源码，终结「代价≈重建」的拍脑袋形态——该说法初版无我方侧证据，现补上）：**全前端 89,003 行 TS/TSX，其中会话面 ≈2,800 行（3%)**(`QueryDock.tsx` 175 · `TaskRun.tsx`+`useTaskStream.ts`+`taskStreamReducer.ts` 529 · `Timeline.tsx` 218 · `Clarification.tsx` 200 · `Answer` 族 ~1,500 · `TaskDetailPage.tsx` 135)；其余 97% = 58 个 admin 管理页 + 7 个求解投影页 + 通用 ViewPage + Object360 + 登录/权限/暗发横切，全部直调我方 102 处端点（`api/endpoints.ts` 2,540 行），过 AdminGuard 暗发 404/角色 403 双闸（`App.tsx:111-114`)——**「前端整体迁移到 dsh」经全表面实测否决：97% 的页面其后端服务在 dsh 侧零对应物，迁移 = 在 rc 框架里重写 8.6 万行且数据仍全出我方后端，dsh 仅贡献框架本身**。**会话面形态判定：它不是聊天客户端，是 QOS 任务轨迹+结构化答案查看器**——「会话」= zustand 平铺任务数组、无 session 概念（`QueryDock.tsx:49-52` conversationId=首个 taskId 的权宜）；无 queue/steer 语义。概念对照：routing 徽章/澄清轮/角色分栏/Answer 块族/⟦ref:N⟧+scope 诚实徽章/建议问句/历史信任徽章 = 我方渲染面大头且 dsh 零对应（精确表述：dsh 的 ChatNode 声明合并缝**允许**注册自定义节点实现这些，但等于在别人的 runtime 里重写我们最难的渲染，外加 fork 60+ rc 包）；session 侧栏/queue/steer/compaction = dsh 独有但我方任务模型无对应语义；**唯一真重叠 = 步行↔工具调用树，且 dsh 明显更好**。故「搬组件」账单 = 框架 + 伪 Host 适配层 + 大头重写 > 原地重建；净收益仅工具树/composer 交互形态。此对照表即 WO-DSH-P3-CHATUX 的范围输入（重建时步行→工具树形态、流式尾隔离为必借项；我方独有概念为不可裁减项）。另记 POC 范围事实：POC（E1–E6）验的是「换芯不动壳」（E4 SSE 逐字节基线 + E5 前端 1111 绿），**从未运行过 dsh 自家前端**，dsh 前端全部结论来自拆包审计（E2 级）——2026-08-16 已实跑升级为 E1，见补证 3。

**补证 3 · dsh web 实跑记录（2026-08-16，全部 E1 级，真 Kimi K3 provider）**：独立 DSH_HOME + 独立端口 3080 起 `dsh web`，绑真 Moonshot/kimi-k3 key，Playwright 驱动系统 Chrome 实测（截图 pw-2~pw-46，轨迹 JSON 存档 /tmp/dsh-web-run/）。逐条结论：① **会话事件流**：完整 75 事件真轮次（reasoning-delta→tool/call read→tool/result→usage→turn/end completed)，事件名与 §5.2 对照表逐名吻合，另见 `request/context`(contextWindow 262144）与 **`contextPressure` 投影**(pressureTokens 实数）——后者是我方 reassemble/loop 侧需要的原生压力信号源；② **上下文压缩**:patch 启用 compaction-basic+command-compact 后，UI 斜杠菜单拦截 `/compact`(**客户端拦截，不过模型轮次**；走 session.prompt RPC 直发会穿透成普通用户消息——命令解析在壳层，复用命令体系时此为其一事实），成功回执「已压缩 39 条历史记录（约 15491 tokens)」，生命周期事件 command/run→compaction/start→compaction/end 齐全；默认停用；③ **skill**：工作区 `.dsh/skills/weather-lookup/SKILL.md` 被 skill-filesystem 发现（rank 100 根），模型主动调 `skill` 工具加载并遵循其指令（web_search 缺 key 时按技能要求如实降级）;④ **多跳**:6 文件依赖链（每跳内容决定下一跳文件名）单轮 6 步严格按依赖序读完、零猜测，答案拼接正确；⑤ **memory**：无此子系统（159 插件清单无任何条目，无包无 RPC);⑥ **规则/约束对应物** = Agent 预设（4 内置，本质=cordis 插件组装+提示词，非字段 schema)+权限预设+approval/policy+sandbox 模式，无规则引擎对应物；⑦ **本体**：零对应物；⑧ **MCP**:dsh-mcp-client 包在但未装配，仅 cordis.yml 手工配置，无 GUI;⑨ **插件清单** 159 件全量 dump(plugin-list.txt)，启用机制=用户 patch 层 `disabled:false` 覆盖。

**补证 4 · 本体切片 + 前置 C 负向接缝 + 重启重附（2026-08-16，均 E1 级）**：① **本体切片/切片检索 = 零原生支持，唯一路径 = MCP 桥且 slice 无语义**。三证：159 插件清单 grep ontology/knowledge/graph/retrieval/rag/slice/memory 零命中；实跑模型工具面全集 = read/write/edit/glob/grep/bash/skill/web_search/ralph/workflow（系统提示点名 + tool/call 观测双源），纯文件/Shell/Web 原语；搭 mock MCP 本体服务器（stdio，tools/list+tools/call）接入 dsh-mcp-client，工具以 `mcp__onto__ontology_query` 注册成功、带 slice 入参调用端到端返回切片数据——**但 slice 对 dsh 是不透明字符串**：无切片级上下文注入、无切片级权限/可见性、无切片感知排序，切片治理全在桥后面我方侧。迁移含义：本体切片检索不因换芯获得或丢失能力，它继续由我方 retrieval 层承载，dsh 只当工具管道；要防的是把切片语义错当成 dsh 能提供的能力而漏建我方侧闸。② **前置 C 负向接缝**：见 §6 前置 C「负向接缝实测」段（同 root 同名创建期响亮拒绝、独立 root 不撞、dispose 释放）。③ **重启重附语义**：重启后 `session.list/history/prompt` 从磁盘 jsonl **懒重附**（最早报 not-found 的会话亦重附成功且 prompt 全闭环）;**但 `skill.list` 不触发重附**，直接 `session-not-found (not attached)`——RPC 方法间重附覆盖不对称，生产 runner 层要么先 attach 再调、要么封装统一 attach 前门。④ 命令客户端拦截已双向 E1(RPC 直发 `/compact` 穿透成普通用户消息；UI 斜杠菜单走 command/run 不进模型轮次），补证 3② 不再是单方向观察。

**处置**：前端维持「零迁移」（§5.1）。三个衍生处置：
1. **只读调试旁挂**：三条前置销账后，可把 dsh web 作为**只读调试旁挂**（独立端口、不进我方 ShellLayout、不给终端用户），供开发观察原始帧流；它**不替换任何现有页面**。此项不进任何分期，需要时单独派单评估。
2. **会话页体验重建**（回应「人机会话页面很差」）：不采用 dsh 前端本体，但 **dsh `ui-conversation` 的交互模式可作设计参照**——工具调用树（`ui-tool`）、产物文件行（`ui-deliverables`）、目标条（`ui-goal`）、消息赞/踩（`ui-message-feedback`）、`/`+`@` 输入管线。重建在我方 SSE 契约（§5.2）与诚实层之上进行，四个组件逐一映射到我方既有事件流；诚实层元素（scope 徽标/⟦ref:N⟧/降级理由）为**不可裁减项**。工单 WO-DSH-P3-CHATUX，纯前端、不等任何前置销账、与 flag 分期正交。**E1 实跑补充输入（2026-08-16）**：① 参照清单追加——Think 折叠行、轮次统计条（X 轮·Y 步·首 token·缓存命中率）、compaction 回执行（「已压缩 39 条/约 15491 tokens」）、轨迹 tab；② 统计条/回执的数据源落实——dsh 原生投影 `sessionStats`/`tokenUsage`/`contextPressure`(pressureTokens）即够，重组装侧需透传；③ 斜杠命令若要在产品面出现，**解析必须在我方壳层实现**(dsh 侧命令不过 RPC，补证 3②)，不能等后端给。**执行方式修正（同日，应要求从「交互模式参照」升级为「实现级移植适配」——读 dsh 源码移植，不从 0 写）**：`dsh-client-ui-conversation/lib/client.js` 9,847 行实测结构——**可抽代码层** = 流式块组装状态机（`updateChunk`:assistant/chunk 的 block-start/reasoning-delta/text-delta/block-end + replayState 回放，client.js:7258-7441）、工具调用树装配器（tool/call→tool/result 配对与树构建，client.js:8294+）、追加面判定（`isAppendSurfaceEvent` 分流逻辑）——这些是事件流→渲染态的纯状态机，与我方 taskStreamReducer 同构可对照移植；**不可抽层** = 49 处 useSession/useHost/useWorkspace 运行时 hook（数据绑定层，须换绑我方 SSE/zustand）。移植纪律：状态机逐函数对照移植 + 我方事件名适配表，组件壳与数据绑定在我方栈内新写；诚实层渲染位在移植时预留，不后补。
3. **配置页字段对齐**（回应「配置页面也很差，确保两系统字段对齐」）：**对齐的前提不成立——dsh 侧没有配置页**（配置面 = cordis.yml 文件，见上 0 号证据），无字段可对。字段唯一真相源 = 我方 contracts schema（`packages/contracts/src/agentcore.ts:60` AgentDefinition、`:117` McpServerConfigSchema、SkillDefinition 同文件），配置页重建以 schema 逐字段为清单，不参照任何外部系统。此项不属本 PRD 交付面，单独立项；本 PRD 只保证换芯后这些 schema **零变更**（§4 映射表已逐字段核过）。

---

## §6 三条前置条件（各带方案 + 销账判据；未销账 flag 不许进部署面）

> 裁决原文与全部 file:line 证据见 `docs/DECISION-dsh-fusion.md` §3，本节是给落地方的方案面。

### 前置 A · 真 provider 从没跑过

**事实**（复核：`DECISION-dsh-fusion.md` §3-A）：`engine.ts:509` 缺省 mock；POC 测试每处 `provider:"mock"`；`cordis.yml` 自陈 POC 夹具，应答 = 写死剧本 `plugins/mock-llm.mjs`。**只翻 flag 上线 = 用户拿到剧本回答。** 形态 = 生产实参与测试实参交集为空（`G-SEED-PROVENANCE-BACKFILL-UNASSERTED` 同族，加重形态）。

**修正（2026-08-16 E1 实跑，风险收窄但不销账）**：dsh **原生栈** + 真 Moonshot/kimi-k3 已全链路工作态（reasoning 流、工具循环、多跳依赖链、缓存命中 87–93%、compaction、skill 加载遵循，见 §5.3 补证 3）——harness 的 provider 插口对真 LLM 成立，不是只在 mock 下成立。未证区间收窄为一段：**我方适配器**（接 LLM Provider 绑定矩阵）插进该插口的接缝。原事实陈述对「我方 POC 路径」仍然逐字为真（POC 每处 mock 未变），故三项销账判据不松动；变的是风险定级——从「可能翻车」降为「走流程确认」。

**方案**：harness LLM 插件换成我方适配器（接 LLM Provider 绑定矩阵，接口五方法 POC 已验证可插）；`DSH_HARNESS_PROVIDER` 出生产取值并进部署治理门扫描面。
**销账判据**（三条同时，照录裁决）：① cordis.yml 换真适配器且生产取值明确；② SEAM 组合测试断言「生产实际传的那个 provider 值」端到端跑通（非各半 unit）；③ 该测试实参=生产实参，**机器核**。
**工单**：WO-DSH-P1-PROVIDER。

### 前置 B · `STALL_LOOP` 护栏净减少

**事实**：我方 `loop.ts:1153/1180-1182` 同签名 ≥ `loopRepeatCap` ⇒ 优雅降级（出货 cap=3，`DEPLOY.md` 五开关，`check-deploy-governance.mjs` 守门）；dsh 无环检测（`reassemble.ts:10` 自陈「不可重建」）；POC 报告 §7 第 1 条原话「进生产需在 runner 侧补 watchdog」。既有回归 `deploy-governance-seam.test.ts:128` 只咬 `runAgentLoop` 那一半。

**修正（2026-08-16 E1 实跑 + 拆包复核，原「dsh 无环检测」过重）**：dsh **有**同族检测——`dsh-repeat-tool-reminder` 用与我方完全同构的指纹（工具名 + 入参 canonical JSON 串）在阈值 [3,5,8] 逐级升级提醒，但**全程 advisory、从不中断 turn**。即「检测有、打断无」：指纹算法可直接复用，缺口收窄为「升到 cap 时 advisory→interrupt + 按 degrade 语义重组装」一段。watchdog 工单范围据此缩减，不重造检测轮。

**方案**：`dsh-runtime/runner.ts` 侧补 watchdog —— 复用 `dsh-repeat-tool-reminder` 已有的同签名帧指纹（工具名+canonical JSON 入参，与我方算法同构），在累计 ≥ cap 时把 advisory 升级为中断 turn 并按 `degrade` 语义重组装；cap 值取与 `LOOP_REPEAT_CAP` 同一 env 源（不许第二处真值）。
**销账判据**（照录裁决）：① runner 侧环检测语义对齐 loopRepeatCap；② `deploy-governance-seam.test.ts:128` 存在 `DSH_HARNESS=1` 对位副本且能绿（超时≠环检测，不可互相顶账）；③ 若选「外壳保留」须写清外壳在哪一层拦+对应断言；「放弃该观测位」非法。
**屏上口径**：销账前 dsh 路不出现 `STALL_LOOP` 态=护栏缺失事实本身，AgentsPage 内核徽标同批加 tooltip「外部内核 · 环检测护栏待补」（WO-DSH-P2-UX 顺带）。
**工单**：WO-DSH-P2-WATCHDOG。

### 前置 C · MCP `serverName` root 级预约（架构级冲突，权重最高）

**事实**：`packages/dsh-harness/README.md:38` 自陈 root 级预约、同名撞 duplicate namespace；`plugins/platform-world.mjs:85-88` `activeServerNames` 按 `ctx.root` 键控；POC 靠「同 server 单 agent 直通」绕开。与本仓铁律 **tenant_id everywhere** 直接冲突：两租户各配 `serverName:"erp"` 必撞，结果只有「跨租户互相拒服务」或「跨租户数据串」两种，都不可接受。

**负向接缝实测（2026-08-16,E1 级，直驱 harness 同款 `@deepseek-ai/dsh-mcp-client` + `@deepseek-ai/cordis` 4.0.1，脚本 /tmp/dsh-web-run/test-servername-collision.mjs）**：① 同 root 挂 `erp` → 成；② 同 root 再挂同名 → **plugin load 期 reject**:`serverName "erp" is already in use by another mcp-client instance`——跨租户拒服务形态坐实，但**「数据串」形态不存在**（无静默遮蔽，失败响亮）；③ 异名 `crm` → 成；④ **独立 root 同名 → 成**(per-root WeakMap 键控实证，多 App 进程隔离可绕）；⑤ 同名失败者重试仍拒、不污染持有方；⑥ 持有方 dispose 后预约释放、同名可重挂（会话拆除语义干净）。判读：碰撞发生在**创建期**而非运行期，harness 语境下 = 租户 B 的 agent 出生即败；方案必须做到判据②的「两边都起得来 ∧ 互相不可见」。本实测在原生包上完成，判据③（`DSH_HARNESS=1` 下重跑）仍待 WO-DSH-P2-NAMESPACE 落地后执行。

**方案**：命名空间宿主从 root 下沉到携带 tenantId 的作用域。README 给的两条路选「**根级共享连接池 + scoped 可见性过滤**」——不选「会话后缀改名」（它破坏 `mcp__<serverName>__<tool>` 审计名，E4 逐字节基线会被打破）；连接键 = `tenantId+serverName`，可见性按键过滤。
**销账判据**（照录裁决）：① 宿主下沉至少携带 tenantId；② 负向接缝测试：租户 A/B 各配同名 serverName，断言**两边都起得来 ∧ A 看不见 B 的工具 ∧ 工具全名审计可归因**；③ 该测试必须在 `DSH_HARNESS=1` 下跑（原生 MCP 路绿不算）。
**工单**：WO-DSH-P2-NAMESPACE。

---

## §7 四条既有事实（照录 + 本 PRD 的处置）

| # | 事实（复验见 `DECISION-dsh-fusion.md` §5） | 本 PRD 处置 |
|---|---|---|
| 1 | `packages/dsh-harness` **无 build 无 test 脚本** ⇒ `pnpm -r build/test` 整包跳过，常设门永远看不见它 | **WO-DSH-P0-CI**：补 `test` 脚本挂 `smoke.mjs` + E 套件当契约测试，接进 workspace 执行面；验收=`pnpm -r test` 输出出现该包且失败能变红 |
| 2 | agentcore **`dependencies`**（非 dev）新增 2 个 `0.1.0-rc.6` preview 包 ⇒ flag 关着也进生产镜像；「零侵入」只在代码加载维成立 | **供应链策略**：全量钉 `0.1.0-rc.6`（dist-tag 分裂已实测，裸装必 ERESOLVE）+ 合并同批把包描述/README「零侵入」改成真话（裁决遗留 3）；升级只走契约测试，不追 dist-tag |
| 3 | 锁文件 `@deepseek-ai/*` 唯一包名实测 **43**（POC 报告写 38） | 合并同批订正包描述与报告数字（裁决遗留 4），本文统一写 43 |
| 4 | 休眠属实且已有门：静态 import 只 `runner.ts:13` 一处 · 唯一动态入口 `engine.ts:498` 带 flag 判断 · 部署面零处设 flag · `dsh-dormancy:check` 已建并已接 `pnpm gates`，**但仅在 `claude/handoff-wo-dsh-fuse-guards` 分支上；集成分支上该门尚不存在**（2026-08-16 实测：集成分支 gates 串里 `dsh-dormancy` 命中 0），收编后方成立 | **本 PRD 全部工作项不得破坏 D1/D2/D3**；新代码一律进 `dsh-runtime/` 白名单内、不添第二入口、部署面不设 flag（灰度经 §8 的运行时开关而非部署面常量） |

---

## §8 灰度与回退

| 项 | 规格 |
|---|---|
| **flag 粒度** | 三级：`off`（缺省）→ `canary:<tenantId>:<agentId>`（P1，单租户单 agent）→ `tenant:<tenantId>`（P2）→ `1`（P3 缺省开）。运行时 env 读取，**部署面只许出现显式 `off`/缺省**（D1 兼容：不设或设 0） |
| **回退路径** | env 回 `off` 即回旧路，零数据迁移（配置真相源从未动）；旧路保留至 P4 |
| **双跑对账口径**（P1 金丝雀） | 同 agent 同 50 任务双跑：Answer 结构 · 拒绝口径 · SSE 事件名序列（§5.2）· 审计记录逐字段对账；任一项漂移 → flag 回 off，旧路零成本接管 |

---

## §9 分期（每期独立验收 + kill 条件；接缝驱动，非各半绿）

| 期 | 内容 | 验收（SEAM-GATE） | kill 条件 |
|---|---|---|---|
| **P0 并线** | POC 6 提交 merge（其他 dev 执行中）+ WO-DSH-P0-CI | contracts build RC=0 + agentcore 全套（E5 回归）+ E1–E6 复跑全绿 + `pnpm -r test` 看得见 harness 包 | 任一红 → 不并 |
| **P1 金丝雀** | WO-DSH-P1-PROVIDER（前置 A）+ WO-DSH-P1-MAP（POST_CHECK/WORKFLOW/toolTimeoutMs/arguments 默认值） | 前置 A 三判据；POST 段 deny SEAM；dsh→我方 workflow 端到端用例；50 任务双跑对账一致 | 对账漂移 → 回 off |
| **P2 多租户** | WO-DSH-P2-WATCHDOG（前置 B）+ WO-DSH-P2-NAMESPACE（前置 C）+ WO-DSH-P2-UX（内核徽标） | 前置 B/C 各自销账判据（含 A/B 同名 serverName 负向接缝、病态循环早停对位副本） | 碰撞或降级理由丢失 → 回 P1 |
| **P3 默认开** | 缺省 `on`，旧路保留一版本周期 | 全量回归 + flag-on 全套绿 + 前端 1111 测试全绿（页面零感知为证） | 任一红 → 缺省回 off |
| **P4 退役** | 删 runAgentLoop 旧路径与分叉 | 全仓 grep 无引用；CHANGELOG 退役声明 | 发现引用 → 推迟 |

**每期铁律**：配置格式零迁移 · API/前端零变更（除 P2 只读徽标）· 明文凭据不过日志（红线）· D1/D2/D3 不破。

---

## §10 《本体引用与影响》（铁律 0）

### 10.1 对象类型（§2 目录）
- **H 交互/编排域**：`Skill/Agent`（loop 宿主，执行内核可替换）· `Task/Query`（QOS 任务，SSE 面不变）· `AgentRunRecord`（attribution 增内核标识读取位）。
- **MCP 治理**：`McpServerConfig`（serverName 命名空间宿主变更 = 前置 C）。
- **未新增对象类型**。

### 10.2 链路（§3）
- **编排链（问句→答案）**：`engine.ts` 执行分叉插第二条支路（POC 分支 `engine.ts:498`），**不改分水岭**——path-A 命中不落 agent、compose 命中 early-return 均不变；分叉只作用于真进 agent 的开放题。

### 10.3 事件（§4）
- **零新增零改名**。QOS SSE 事件面逐名保持（§5.2 对照表）；唯一受影响态 = `agent_degraded.reason=STALL_LOOP` 在前置 B 销账前于外部内核路缺失（护栏净减少，§6-B）。
- 本体回写注意：POC 侧路径在 canonical 存在前**不写锚点形态**（`DECISION-dsh-fusion.md` §5.3 已记两道本体门会判红），并线同批改回正规锚点（裁决遗留 6）。

### 10.4 不变量（§5）
- **tenant_id everywhere**：前置 C 与之直接冲突，是该前置存在的理由；P2 销账前外部内核路不许承载多租户负载。
- **Entitlement 先于 authz**：不受影响（换的是执行层，entitlement 在外壳）。
- **错误信封**：不受影响（reassemble 把帧重组装回我方 Answer）。
- **R 写降级/确定性地板/输出侧纪律**：不受影响（规则引擎与求解路径不动；裁决网桥 fail-closed 与既有拒绝语义同口径，E2/E3′ 已建基线）。

### 10.5 断点（§8）
| 断点 | 现状 | 本 PRD 推进 |
|---|---|---|
| **G-DSH-DORMANT-UNGUARDED** | 已落护栏（`dsh-dormancy:check` 进 gates） | 保持；全部工单以不破 D1/D2/D3 为验收前置 |
| **G-SEED-PROVENANCE-BACKFILL-UNASSERTED**（同族形态） | 已结案 | 前置 A 是其加重形态：销账判据③「测试实参=生产实参，机器核」即防再犯 |
| **G-AGENT-BLIND-REACT** 等 agent 链断点 | 不变 | 本线不换提示词/规划逻辑（那是 `PRD-agent-react-harness.md` 的线），两线正交 |

### 10.6 回写计划
落地后回写 `docs/SYSTEM-ONTOLOGY.md`：§3 编排链补「执行内核分叉」插入点（随 P0 并线同批，路径转正规锚点）；§4 不动（零事件变更）；§8 随 P1/P2 销账更新三条前置状态；§7 门账新增 `dsh-contract:check`（P0-CI 落地时）。

---

## §11 做不到的部分（每条写清差什么 + 可派工单）

| 项 | 差什么才能做 | 工单 |
|---|---|---|
| POST_CHECK / BOTH 规则段 | 适配层接 `tools/post-execute` 瀑布 + 同裁决网桥 + POST 段 SEAM 用例 | WO-DSH-P1-MAP |
| WORKFLOW 工具引用 | BUILTIN 桥 + dsh→我方 workflow 端到端用例 | WO-DSH-P1-MAP |
| toolTimeoutMs 生效 | setup/会话参数映射 + 超时覆盖断言 | WO-DSH-P1-MAP |
| 真 LLM provider | 适配器插件 + 生产取值 + 「实参=生产实参」机器核 | WO-DSH-P1-PROVIDER |
| STALL_LOOP 护栏 | runner 侧 watchdog + 对位回归副本 | WO-DSH-P2-WATCHDOG |
| 多租户 MCP | serverName 宿主下沉 + 负向接缝测试 | WO-DSH-P2-NAMESPACE |
| harness 包进 CI | test 脚本挂 smoke+E 套件 | WO-DSH-P0-CI |
| 内核可见性 | AgentsPage 只读徽标 + tooltip | WO-DSH-P2-UX |
| 会话页体验重建 | 不替换 dsh 前端（诚实层净损失，§5.3）；以其 ui-conversation 交互模式为参照在我方 SSE 契约+诚实层上重建 | WO-DSH-P3-CHATUX |
| 配置页字段对齐 | dsh 侧无配置页可对齐（§5.3-0）；以 contracts schema 为唯一字段源重建，不属本 PRD 交付面 | 单独立项（不挂 dsh 分期） |

## §12 验收总判据（一句话版）

**任意一次 run，把执行内核开关来回切，外部可观察面（API 响应、SSE 事件名序列、审计记录、前端页面、Answer 结构）逐字节一致——只有 `AgentRunRecord.attribution` 的内核徽标不同。** 三条前置未销账前，这句话里的「开关」只允许停在 off。

---

## §13 附录 · 外部运行时 43 包全量清单与逐包去留

> 复算命令（POC 分支）：`git show origin/claude/handoff-wo-dsh-poc-s1:pnpm-lock.yaml | grep -oE '@deepseek-ai/[a-z0-9._-]+' | sort -u | wc -l` → **43**。
> 分两层：**装配件**（`packages/dsh-harness/cordis.yml` 引用的插件，运行时真加载）与**闭包传递件**（随钉版闭包安装、装配单不引用 ⇒ 不加载）。

### 13.1 装配件（cordis.yml，11 块）

| 插件 | 来源 | 职能 | 去留 |
|---|---|---|---|
| `platform-sdk-server` | 我方 | JSON-RPC server 变体（收 setup 钩子） | **保留**（永久替换 stock——stock `createSession` 写死不收 setup） |
| `platform-governance` | 我方 | 治理裁决网桥（`tools/pre-execute` 闸） | **保留**，P1 `mode: mock → http` 接真规则引擎（前置 A 同批） |
| `platform-world` | 我方 | SetupSpec→AgentSetup 装配（persona/scoped MCP/允许表） | **保留** |
| `dsh-llm` · `dsh-session` · `dsh-system-prompt` · `dsh-tools` · `dsh-skill` · `dsh-agent` · `dsh-agent-loop` | stock | 运行核：LLM/会话/提示/工具瀑布/技能/agent/主循环 | **保留**——「换芯」换来的芯就是这几块 |
| `mock-llm` | 我方夹具 | 写死剧本 LLM | **替换**（WO-DSH-P1-PROVIDER → 真适配器插件，前置 A 销账动作） |
| `echo-tool` | 我方夹具 | 回声工具（E2 取证用） | **退役**，生产由真 MCP/BUILTIN 工具顶替 |

### 13.2 闭包传递件（32 包，cordis.yml 不引用 ⇒ 不加载）——逐包审计版

> 审计方法（2026-08-16 实审，非按名推断）：逐包取 `npm view @deepseek-ai/<pkg>@0.1.0-rc.6 description` 元数据 + 按描述分类。审计**推翻了第一版「按名推断」的结论**：这批包大多数是抽象 **seam（provider 契约），不是实现**——seam 不装配 = 能力缺席，不构成「双真相源」；装配 = **我方注册自己的 provider**。其中 4 包定性因此改变（标 ★）。

| 包 | 审计结论（包自陈） | 类别 | 去留（审计后） |
|---|---|---|---|
| cordis 框架 7 包（`cordis` / `cordis-plugin-group` / `-hmr` / `-include` / `-loader` / `cosmokit` / `schemastery`） | 插件体系本体 | 框架 | **保留** |
| `dsh-sdk-client` · `dsh-sdk-protocol` | agentcore 侧仅有的两个依赖 | 协议 | **保留** |
| `dsh-sdk-jsonrpc-server` | stock server（createSession 不收 setup） | 实现 | **不用**（我方变体已替换） |
| `dsh-sdk-jsonrpc-demo` | demo bin | 实现 | **P1 收敛**（POC 遗物，runner.ts:60 路径串） |
| `dsh-mcp-client` | MCP 客户端（在用） | 实现 | **保留**（MCP 通路物理承载） |
| `dsh-session-persistence` | 持久会话存储 seam（ctx.sessionPersistence） | seam·带自有持久化 | **不装配**（我方 persistence 是唯一真相源） |
| `dsh-session-projection(-cache)` | 会话投影 seam + 持久投影缓存（write-behind + 冷读梯） | seam·带自有持久化 | **不装配**（同上；我方无此概念） |
| `dsh-attachment` | 持久不可变附件存储 seam | seam·带自有持久化 | **不装配**（我方无附件域；引入前须先立我方真相源） |
| `dsh-credentials` | 凭据 seam：「settings 只存引用，provider 持有值」 | seam | ★ **候选装配**——模型与我方 credentialRef **同构**（引用/值分离），前置 C 同批评估：我方租户解析器注册为 provider（E3/E3′ 设计的天然落点） |
| `dsh-user-approval` | 审批 seam（ctx.approval，answerer 瀑布，fail-closed 缺省） | seam | ★ **候选装配**——POST_CHECK/审批桥的设计落点：我方裁决网桥注册为 answerer（WO-DSH-P1-MAP 评估） |
| `dsh-scope` | scoped-context 原语（scope 标签 + scope 过滤事件分发） | 原语 | ★ **候选装配**——前置 C 命名空间方案的底层机制候选（platform-world 的 scoped 监听器已隐含用其语义，WO-DSH-P2-NAMESPACE 评估） |
| `dsh-llm-deepseek` | DeepSeek chat-completions 真适配器 | 实现·适配器 | ★ **候选参考**——前置 A 的真 provider 参照物；我方绑定矩阵是多供应商，我方适配器仍必做（WO-DSH-P1-PROVIDER） |
| `dsh-jobs` | 后台任务注册表（长工具轮询/取消/监听，owner 隔离） | 实现·注册表 | **不装配**（我方 ops/schedule 已覆盖；引入=双任务口径） |
| `dsh-subagent` | 子 agent seam（命名 provider 注册表，委派子 agent） | seam | **暂不装配**（我方 nesting/Coordinator 已有；POC 未验嵌套，需要时再评） |
| `dsh-code-runtime` / `dsh-sandbox` / `dsh-sandbox-policy` / `dsh-subprocess` | 代码执行/进程沙箱/沙箱策略/子进程 seam 族 | seam | **不装配**（我方 agent 不开放任意代码执行；安全策略只许我方规则引擎一处裁决） |
| `dsh-settings` | 用户设置 seam（ctx.settings） | seam | **不装配**（我方 config 是唯一配置面） |
| `dsh-agent-presets` | 按 preset cordis.yml 组 per-session agent | 实现 | **不装配**（我方组 agent 的入口是 AgentDefinition→SetupSpec，已验） |
| `dsh-timeout` | 纯计时原语（clampTimeout/deadline/分类，**无终止语义**） | 原语·纯函数 | **不装配**（我方 budget/watchdog 自管） |
| `dsh-brand` | 类型级 Branded 名义类型原语 | 原语·编译期 | **不装配**（我方无此约定） |
| `dsh-home-paths` / `dsh-launch-environment` / `dsh-app-boot` / `dsh-anonymous-user-id` / `dsh-invariants` / `dsh-typert-protocol` | 路径助手 / 启动环境分层记录 / app 引导（.env 加载、Loader 守序）/ 遥测匿名身份 / 包级不变量注册表 / 类型协议 | 原语·框架内部 | **不装配**（dsh 自家 app 形态的内部件；我方只嵌入运行时，不采用其 app 形态） |

### 13.3 判定规则与审计修正记录

- **去留判据（三条，按序适用）**：① 带自有持久化状态 ⇒ 不装配（我方 persistence 是唯一真相源）；② 抽象 seam 且我方有对应治理能力 ⇒ **不装 dsh 实现，但评估把我方能力注册为 seam 的 provider**（seam 是挂点不是对手）；③ 框架内部件/纯原语 ⇒ 不装配。
- **审计修正**：本表第二版。第一版「按名推断」把 seam 误判为「我方已有对应物的实现」并套用双真相源理由——npm 元数据审计后纠正：seam 无实现，不构成第二真相源；★ 4 包定性由此改变。
- **审计深度声明**：本轮依据 = 各包自陈 description（npm 元数据），**未读各包源码**。标「候选」的 4 包在对应工单开工时必须先读源码复核，再决定装配。
- **「不加载」的证据**：cordis.yml 装配单 + D2 门（静态 import 只许白名单内）；未逐个追各包的被动加载路径。
- **换芯后 agent 的通路不受影响**：工具/技能/MCP/LLM 全走保留件（mcp-client、tools、skill、llm）；夹具两件替换是目的而非损耗；未装配件换芯前后都够不到，零变化。

---

## §14 交付闭环 · 每张工单的强制 loop（阅读→分析→计划→执行→完成→测试→判断→未成功则继续）

§11 的每张工单（WO-DSH-P0-CI / P1-PROVIDER / P1-MAP / P2-WATCHDOG / P2-NAMESPACE / P2-UX）**必须按同一闭环交付**，任一阶段产物缺失 = 工单不许标完成：

| 阶段 | 入口 | 必交产物 | 出口判据 |
|---|---|---|---|
| **① 阅读 PRD** | 工单派到 | 引用本 PRD 的具体小节号（不许只引工单标题） | 能说出本单在 §9 分期表里的 kill 条件 |
| **② 分析** | ①完成 | 现状取证：每个「现状」断言带 `file:line` 或可复算命令（照 §13.2 的审计方法）；受影响面清单（代码/配置/事件/页面） | 断言零「按名推断」——凡推断必标注并给出取证计划 |
| **③ 计划** | ②完成 | 改动点清单 + 每点对应的测试断言（先写断言后写码）；mutation 反证设计（变异哪一处、预期哪条红） | 计划里每条断言可映射到本 PRD 的某条销账判据 |
| **④ 执行** | ③完成 | 代码 + 测试同提交；不破 D1/D2/D3（dsh-dormancy:check 全绿） | build RC=0 |
| **⑤ 完成自陈** | ④完成 | 交付报告：做了/没做分两栏（照 `DECISION-dsh-fusion.md` §6 形态——「没做的不许被读成做了」） | 没做的每项已登记 §11 或新工单 |
| **⑥ 测试** | ⑤完成 | 目标套件全绿 + mutation 反证（neuter→红→还原→绿，读回文件确认变异落地） | 红区与变异点一一对应、零误伤 |
| **⑦ 判断** | ⑥完成 | **独立复验**（非开发者本人）：复跑套件 + 复核断言实参=生产实参（前置 A 判据③的同族要求） | 复验方贴原始输出，不接受转述 |
| **⑧ 未成功则继续** | ⑦不通过 | 回退到失败阶段的**上一**阶段重来（测试红→回④；断言没咬住→回③；现状判断错→回②）；连续 3 轮不过 ⇒ 工单升级评审，不许硬推 | 升级记录进工单 |

**跨单铁律**：每张单的 ⑦ 都必须证明「测试实参 = 生产实参」（本仓 `G-SEED-PROVENANCE-BACKFILL-UNASSERTED` 与前置 A 的共同教训）；凡引入新配置/新事件/新页面字段的单，⑥ 必须含端到端 SEAM 断言（跨 A/B 两系统或跨数据/引擎两半），各半 unit 绿不算数。

## §15 细节覆盖机制 · 本 PRD 每个细节结论的举证等级

为防止「手册级 PRD 的结论本身没有依据」，本 PRD 所有细节判断按三级举证登记，复验方可按级抽查：

| 级 | 含义 | 本 PRD 中的位置 |
|---|---|---|
| **E1 已验证** | POC/既有测试真跑过，证据可复跑 | §4 映射表 ✅ 行（E1–E6）· §5.2 事件对照表 · §7 四条事实 · §5.3 补证 3(dsh web 实跑：真 Kimi 轮次事件流/compaction 成功回执/skill 发现与模型调用/多跳依赖链/159 插件清单）· **§5.3 补证 4（本体切片 MCP 桥端到端 · 前置 C 同名负向接缝六用例 · 重启懒重附不对称）· §6 前置 C 负向接缝实测段** |
| **E2 已审计** | 读过原始材料（源码/元数据），结论带出处，未跑行为验证 | §13.2 逐包表（npm 元数据审计）· §5.3 前端裁决（包自陈 + 结构推理；其中前端行为面结论 2026-08-16 已由补证 3 升 E1) |
| **E3 设计判断** | 架构推理，未取证；开工时必须先取证再动手 | ★ 4 包候选装配 · §6 三条前置的方案面（销账判据已定、实现未验） |

**规则**：E3 级结论不许作为「已做到」引用；E2 级在对应工单 ② 阶段必须升为 E1（读源码/跑行为）或如实降级；任何复验发现级别标错 ⇒ 按 §14-⑧ 回退到②。
