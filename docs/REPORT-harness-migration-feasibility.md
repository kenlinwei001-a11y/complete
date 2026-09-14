# REPORT · deepseek-harness 能否替换本平台 Agent 系统

> 本平台基线 `origin/claude/verify-reclaim-6` @ `a069c976` · 未改动任何代码 · 全程未跑测试/build/gate（轻画像）
> **对面基准 commit `47f943859bef60e4160492346772ded9b24f765a`（master, 2026-08-13）** —— 本报告全部对面证据的落款基准。

**需求来源（仓主原话）**：「你看一下 https://github.com/deepseek-ai/deepseek-harness，我期望用他替换掉目前系统的 agent 系统，是否可行，把相关的配置信息迁移到新的 agent 系统」

---

## 0 · 取证方法与工具自证

### 0.1 取证方式：整仓 clone（不是 WebFetch 猜）

```bash
git clone --depth 50 https://github.com/deepseek-ai/deepseek-harness.git dsh
cd dsh && git log -1 --format='SHA=%H%nDATE=%cI%nSUBJ=%s'
SHA=47f943859bef60e4160492346772ded9b24f765a
DATE=2026-08-13T19:38:46+08:00
SUBJ=Merge pull request #2519 from deepseek-harness/feat/npm-public
```

### 0.2 金丝雀（否定结论的前置证明）

| # | 金丝雀 | 命令 | 结果 |
|---|---|---|---|
| C1 | README 点名的 `dsh` 清单键 | `grep -rn '"dsh"' --include=package.json .` | **命中 20+ 个 package.json**（`packages/bundle/web-app/package.json:41`） |
| C2 | 核心类型 `SessionEvent` | `grep -rni "SessionEvent" packages --include=*.ts \| wc -l` | **1371** |
| C3 | crypto 符号 `createHash` | `grep -rn "createHash" packages --include=*.ts \| wc -l` | **30** |
| C4 | `application/json` | `grep -rn "application/json" packages --include=*.ts -l` | 命中多文件 |

**只有同一命令形态下金丝雀命中，才把「0 命中」读作「它没有」。**

### 0.3 取证过程中亲身踩到的一次假否定（写出来当判据）

首次搜 WebSocket 用 `grep -rn "WebSocket" packages/web --include=*.ts -l` → **0 命中**。
若就此收工会得出「它没有 WebSocket」。**错的不是符号，是靶子**：`packages/web/` 是联网工具
（web-search-exa / web-fetch-http），Web **服务器**不在那里。扩到全仓立刻命中
`packages/client/connection/src/websocket-downlink.ts`。

⇒ **「我在 X 里没找到」≠「仓里没有」，先确认 X 是不是它该在的地方。**

---

## 1 · 对面是什么：README 与源码差了一个数量级

### 1.1 ⚠️ 订正本单工单 §2 的判断（重要，方向反了）

工单写「插件/扩展 API 规格：README 无任何提及 ⇒ 这正是本单要去源码里挖的」。
**这一格不准确，且推论方向反了。** README 第 7 行就写明 "everything is a plugin"、点名框架 **Cordis**，
并在 Development 段直接链到 `docs/architecture.md`。
⇒ README 没写的是**规格细节**，但**指路牌是有的**，指向仓内 **215 篇 markdown**。

### 1.2 源码实测规模

```bash
git ls-files | wc -l                                 # 7412
git ls-files '*.ts' '*.tsx' | wc -l                  # 2578
git ls-files '*.ts' '*.tsx' | xargs wc -l | tail -1  # 564122 total
git ls-files '*/package.json' | wc -l                # 247
find docs -name '*.md' | wc -l                       # 215
```
**它比本平台 agentcore（32,722 行）大 17 倍。** MIT 许可。

### 1.3 三种「没有」——本单实测需要**第四种**

| 形态 | 判据 | 迁移含义 | 本单落在这档的 |
|---|---|---|---|
| **真没有** | 源码确无此概念（配金丝雀） | 必须重建 | 多租户、JWT、Entitlement、加密落库、迁移机制 |
| **有但没文档** | 源码有、README/仓内都没写 | 可用要摸，版本风险高 | **几乎没遇到** |
| **有但形态不同** | 概念在、结构不同 | 需转换层 | Skill、MCP、Agent 定义、事件流 |
| **✅ 有且有完整文档，只是不在 README** | 源码 + 专章 + file:line 级事件表 | **可用可依赖**，成本最低 | 插件 API、扩展模型、事件图、API 网关 |

**第四种是本单最主要的实测结果。** 按工单原假设（README 没写 ⇒ 未知 ⇒ 要挖）会**系统性高估**对面的不确定性。

---

## 2 · 六问逐问回答（每条带落款）

### Q1 · 可扩展单元 = Cordis Plugin

`docs/architecture.md:11` 原文：
> plugins contribute services, typed events, and reversible effects to a shared context. Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and **the agent loop itself**… There is no privileged core to patch.

类型签名（逐字抄自 `packages/mcp/mcp-client/src/index.ts`）：
```ts
export const Config = z.union([ /* … */ ]) as unknown as z<Config>   // :107  schemastery，非 zod
export async function apply(ctx: Context, config: Config): Promise<void>  // :140
```
插件 = 一个 npm 包，导出 `apply(ctx, config)` + 可选 `Config` + 可选 `inject`。
装配靠配置不靠代码：`docs/architecture.md:19-25` 的 **profile / bundle** 两级，
在各自 `package.json` 的 **`dsh` 字段**声明（即金丝雀 C1 命中的键）。

⚠️ **校验器是 `@deepseek-ai/schemastery`，不是 zod**；我方契约全量 zod 4 ⇒ 契约层需转换。

### Q2 · 有多 agent 定义，两套正交机制

**Agent Preset**（`packages/preset/agent-presets/README.md:5`）：一个目录含一份 `agent.cordis.yml`。
服务 `ctx.agentPresets` 含 `list/resolve/mount/recompose/copy/remove`。
`AgentPreset` 仅四字段：`id`/`trust`/`path`/`broken?`。

**关键限制**（`README.md:41`）：「Authoring is copy-only… **no caller ever supplies composition text**」
⇒ 我方「管理台表单新建/发布 Agent」**对面没有对应 API**，只能写文件。

**Subagent**：`packages/subagent/` 11 包，provider 含 acp/claude-code/codex/dsh-sdk/fork-in-process/spawn-in-process。
事件 `subagent/start|end|provider-added|provider-removed`（`packages/subagent/subagent/src/index.ts:157/166/140/146`）。

**另有 Workflow**：`workflow/start|phase|log|agent-start|agent-end|end`
（`packages/workflow/workflow/src/index.ts:43/51/58/68/79/89`）。

### Q3 · MCP：只做 Client，不做 Server

- 包 `packages/mcp/mcp-client/`（4 源文件），依赖官方 SDK：`src/transport.ts:9-10`
- 传输两种与我方同构（`src/index.ts:107-125`）：`stdio` / `streamable-http`
- **工具命名逐字节一致**：对面 `src/index.ts:55` 注释 `mcp__<serverName>__<rawName>`；
  我方 `packages/contracts/src/agentcore.ts:100` `mcpToolFullName()` 返回 `` `mcp__${serverName}__${toolName}` ``
- **无 MCP Server**：`ls -1 packages/mcp/` 只有 `mcp-client`
- 只桥接 tools，与我方 `MCP_CONFIG_NOTES.capabilities` 同档

### Q4 · 持久化：内存为主 + 可插拔落盘（jsonl / sqlite），**无 pg、无迁移**

- `docs/architecture.md:33`：`core/session` owns append-only `SessionEvent` log + **in-memory store**，
  键 `ctx.sessions`；类型 `packages/core/session/src/types.ts:236`
- 落盘插件组 `packages/session/`：`session-persistence-jsonl`、`session-persistence-sqlite` 等
- KV 枢纽 `packages/storage/`：`storage-json`、`storage-sqlite`

**⚠️ 最关键一句**（`packages/storage/storage-sqlite/README.md:11`）：
> The physical layout version lives in `PRAGMA user_version`; any other stamped value rejects (**unreleased format, no migrations**).

**无 pg**：`grep -rni "postgres|pg-pool|node-postgres" packages --include=*.ts` = **0**。

### Q5 · 有可编程 API，且不止一种 —— 这一问对结论影响最大

**(a) HTTP RPC 网关**（专章 `docs/api-gateway.md` 164 行）。`:120`：
> the HTTP carrier maps this to **`POST /api/<namespace>/<method>`**

分层 `remotes → gateway → connection → webserver`（`:160`），编程模型是装饰器 `@Remote`/`@RemoteScope`（`:9-11`）。

**(b) JSON-RPC over stdio 的 SDK 服务端**（`packages/sdk/server/README.md:5`）：
> serves newline-delimited JSON-RPC over stdio so **out-of-process SDK clients can drive harness agents**

协议表（`packages/sdk/protocol/README.md:15-24`）：`initialize` / `session/prompt` / `shutdown`；
通知 `session.event`（unfiltered）/ `session.status` / `subagent.started` / `subagent.finished`。
客户端有 TS + **Python**（`python/sdk`）。

**(c) headless 无端口运行器**（`packages/bundle/headless/README.md:5`）：「**The process opens no listening port.**」

⇒ 工单「服务端部署 README 无提及」为真，但**「所以没有可编程 API」这个推论是错的**。

### Q6 · 下游 WebSocket，SSE 只在「对上游 LLM」一侧

- **WebSocket 下行**：`packages/client/connection/src/websocket-downlink.ts`
- **SSE 真实位置**：`packages/llm/llm-deepseek/src/sse.ts`、`adapter.ts` —— 是它**作为 LLM 客户端消费上游**，
  不是向浏览器推流。我方恰好相反：`apps/agentcore/src/api/sse.ts:26` 用 `text/event-stream` 对前端推流。
  **形态差异，不是缺失。**
- 仓内有脚本生成的完整事件表 `docs/event-producer-consumer.md`（76 行），每行带 file:line：

| 事件 | 落款 |
|---|---|
| `session/created\|disposed\|event\|flush` | `packages/core/session/src/index.ts:54/64/76/85` |
| `turn/start\|end` · `step/start\|end` · `user/message` · `assistant/chunk\|message` · `tool/call\|result` | `packages/core/session/src/types.ts:236`（SessionEventMap） |
| `agent/created\|disposed\|status\|error` | `packages/core/agent/src/runtime-types.ts:159/168/178/290` |
| `agent/pre-step`(waterfall)·`agent/request`(waterfall)·`agent/turn-stopping`(serial) | `runtime-types.ts:231/244/278` |
| **`tools/pre-execute`·`execute`·`post-execute`（waterfall）** | `packages/core/tools/src/index.ts:152/163/175` |
| **`approval/request`（waterfall）** | `packages/interaction/user-approval/src/index.ts:30` |
| `credentials/updated` | `packages/credentials/credentials/src/types.ts:29` |

**`approval/request` 与三个 `tools/*` waterfall 是最有价值的发现**：
我方 S2 审批门、R4「真值经 Action」在对面**有天然挂载点**，不必改它的核心。

---

## 3 · 逐字段对照（三档判定：直接映射 / 需转换 / 对面没有）

### 3.1 `AgentDefinitionSchema`（`packages/contracts/src/agentcore.ts:24`）→ Agent Preset

| 我方字段 | 对面对应物 | 判定 |
|---|---|---|
| `id`(`agt_`) | preset 目录名 | 需转换 |
| `tenantId` | 无 | **对面没有** |
| `key` | 目录名兼任 | 需转换 |
| `version` | 无，只有组合文件 mtime+size 戳（`README.md:33`） | **对面没有** |
| `name` / `description` | preset metadata（`src/metadata.ts`） | 直接映射 |
| `model` | `ctx.agentDefaultModel` + 组合行适配器 | 需转换（无租户级用途绑定矩阵） |
| `systemPrompt` | `ctx.systemPrompt` section 注册 | 需转换（单字符串 → 多插件拼装） |
| `tools[].BUILTIN` | `ctx.tools` 注册项 | 直接映射 |
| `tools[].MCP` | mcp-client 插件实例 | 需转换（无 `mcpConfigId` 外键） |
| `tools[].MCP.toolFilter` | 无（全量同步该 server tools） | **对面没有** |
| `tools[].WORKFLOW` | `packages/workflow/tool-workflow` | 需转换 |
| `ruleBindings.*` | 无（仅 `tools/*` waterfall 挂载点） | **对面没有** |
| `skills[].skillId`/`.version` | `ctx.skills` 按 **name** 解析（`skill/src/index.ts:58`） | 需转换（无 id、无 version） |
| `skills[].arguments` | 无 | **对面没有** |
| `mcpServers[]` | 组合文件里的插件行 | 需转换 |
| `scopeDeclaration.objectTypes` | 无（无本体/对象层） | **对面没有** |
| `scopeDeclaration.toolNames` | `dsh-scope`（注册可见性 ≠ 声明式白名单） | 需转换 |
| `budget` | 仅 `InitializeParams.maxTokens` 单维 | 需转换 |
| `status` | 无（只有 `broken?`） | **对面没有** |
| `role` | 无 | **对面没有** |

**24 字段：直接映射 3 · 需转换 11 · 对面没有 10**

### 3.2 `SkillDefinitionSchema`（`:266`）→ 对面 `SkillDefinition`

对面全貌（逐字抄自 `packages/skill/skill/src/index.ts:56-94`）：
```ts
export interface SkillSummary {
  readonly name: string; readonly description: string; readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicy   // { modelInvocable, userInvocable }
  readonly source: SkillSource; readonly provider: string
  readonly resourceBase?: SkillResourceBase
}
export interface SkillDefinition extends SkillSummary {
  readonly content: string; readonly path?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

| 我方字段 | 对面 | 判定 |
|---|---|---|
| `id`/`key`/`name` | `name` 一个字段兼三职（kebab-case） | 需转换 |
| `tenantId` · `version` · `status` | 无 | **对面没有** |
| `summary`(max200) | `description` + `whenToUse?` | 直接映射 |
| `body`(max50000) | `content` | 直接映射 |
| `resources[]`(blobKey/mime) | `resourceBase?`：是**基址**不是**清单** | 需转换 |
| `capability`·`sideEffect`·`inputSchema`·`outputSchema`·`references[]`·`dependsOn[]`·`approvalGate`·`provenancePolicy`·`maxBudgetRounds` | 无 | **对面没有**（9 条） |
| — | 对面独有 `invocation.modelInvocable/userInvocable`、`source`、`provider`、`rank` | 我方无对应 |

**19 字段：直接映射 2 · 需转换 5 · 对面没有 12**

⚠️ **关于 `metadata` 逃生舱（按铁律 0.5 追了一层）**：`metadata` 在 `SkillCandidate:82` 与
`SkillDefinition:92` 都是**只读透传**，`SkillRegistry:357` 不解释、不校验、不基于它分发。
⇒ **塞进去 = 数据在行为不在**（本仓「接了线没数据」的镜像形态）。
**不能把「能塞进 metadata」当作「已映射」。**

### 3.3 `McpServerConfigSchema`（`:118`）→ 对面 `Config`

| 我方字段 | 对面 | 判定 |
|---|---|---|
| `id` / `name` | 无（插件实例即身份） | 需转换 |
| `tenantId` | 无 | **对面没有** |
| `serverName` | `serverName`(`:57`, `[A-Za-z0-9_-]{1,32}`)；我方更严是其子集 | 直接映射 |
| `transport.streamable_http`+`url` | `'streamable-http'`+`url`(`:78/:85`) | 直接映射 |
| `transport.stdio`+`command`+`args` | 同名(`:61/:63`) | 直接映射 |
| `toolTimeoutMs` | `toolCallTimeoutMs`(`:69`) | 直接映射 |
| `credentialRef` | `headers` **明文字典**(`:83`)；或 `ctx.credentials` | 需转换 |
| `credentialKind` · `version` · `lifecycle` | 无 | **对面没有** |
| `status`(5 连败→ERROR) | `failOnStartupError`+`reconnect{...}` | 需转换 |
| — | 对面独有 `env`(`:65`)、`cwd`(`:67`) | 我方无对应 |

**13 字段：直接映射 5 · 需转换 4 · 对面没有 4** —— 三表中迁移成本最低。

### 3.4 汇总

| 契约 | 字段数 | 直接映射 | 需转换 | 对面没有 |
|---|---|---|---|---|
| AgentDefinition | 24 | 3 | 11 | **10** |
| SkillDefinition | 19 | 2 | 5 | **12** |
| McpServerConfig | 13 | 5 | 4 | 4 |
| **合计** | **56** | **10 (18%)** | **20 (36%)** | **26 (46%)** |

**近一半字段对面没有**，且缺的是 `tenantId`/`version`/`status` 这三组**每张表都缺的贯穿维度**，
以及 Skill 整套工业化契约。

---

## 4 · 必须重建清单（人日按方案分列）

**口径**：以我方实测行数为锚，异构架构重表达按 1.0–1.5 倍折算，含测试。**A = 直接替换；B = 当执行运行时。**

| # | 能力 | 形态 | 丢了会怎样 | A 人日 | B 人日 | 依据 |
|---|---|---|---|---|---|---|
| 1 | 多租户 tenantId（R2） | **真没有** | 跨租户串号；R2 失守 | **40–70** | **5–10** | 我方 **855 处**；对面需在 session/storage/preset/credentials/tools 五子系统同时加维度并 fork 破坏兼容的上游。B 下按租户隔离实例/HOME |
| 2 | Entitlement 先于 authz | **真没有** | 「关闭=不存在」退化成 403，暴露功能存在性 | **8–14** | **2–4** | `features/gate.ts` 152 + `registry.ts` 239 = 391 行 |
| 3 | JWT RS256+JWKS+OBO+X-Debug-User | **真没有**（`jwt\|jsonwebtoken\|JWKS` 全仓 **0**） | 无用户身份；OBO 断链后 DataCore A6 行级权限失去主体 = 全量放开 | **15–25** | **3–6** | `auth.ts` 117 行 + 148 条路由校验；**对面 `packages/identity/` 下唯一的包叫 `anonymous-user-id`** |
| 4 | SERVICE_TOKEN | **真没有** | 服务间敏感端点失去唯一保护 | **4–7** | **1–2** | 16 处引用 |
| 5 | 凭据 AES-GCM + no-secrets-echo | **形态不同**（`credentialRef` 在、`describe()` 不回值，但 **零加密**：`createCipheriv\|aes-` 全仓 **0**，C3=30 有效） | 退化为明文 YAML+0600；库泄露即全量凭据泄露 | **10–16** | **3–5** | 对面 `credentials-local/src/index.ts:52` 存 `.credentials.yaml`、`:394` mode 0o600 |
| 6 | 迁移/仓储双实现(memory+pg) | **形态不同 + 一处真没有** | 无迁移⇒升级即数据不可用；无 pg⇒放弃现有生产库 | **25–40** | **6–10** | `persistence/` 1,793 行 + **14 个 .sql**；对面 "no migrations"、pg 命中 0 |
| 7 | DataCore REST 接缝(QOS→SSE) | **形态不同** | 编排链断；前端拿不到既有 SSE | **20–35** | **8–14** | 我方 SSE 推前端 vs 对面 WebSocket/JSON-RPC，**方向与协议都不同**，需事件名映射层 |
| 8 | 审计/outbox | **形态不同** | 审计链断；60s 缓存失效 SLO 守不住 | **8–14** | **3–5** | 对面有事件总线+otel，但**无事务性 outbox**、无租户维度 |
| 9 | 现有测试资产 | 我方资产 | 替换 = **25,679 行**测试失去被测对象 | **50–90** | **10–18** | 实测 170 文件 / 25,679 行；B 下外壳测试大部分存活 |
| 10 | 26 个「对面没有」字段 | **真没有** | 版本化发布、Skill 工业化契约、scopeDeclaration 全失效 | **30–50** | **8–15** | §3.4 |
| | **合计** | | | **210–361** | **49–89** | |

**备注（挂载点 ≠ 能力，已追一层）**：第 2、8 条在对面有天然挂载点
（三个 `tools/*` waterfall + `approval/request`），这**降低 B 的实现风险**，
但它们只是挂载点——策略体系、规则 DSL、审批状态机仍在我方，**不能因此把工作量记为 0**。

---

## 5 · 结论：**选 B —— 当执行运行时，保留我方外壳**

（A = 直接替换整体退役 · B = 保留我方租户/鉴权/entitlement/审计/SSE/契约治理外壳，把它塞进去当 agent 执行引擎 · C = 不引入）

### 判据

1. **成本差 4 倍以上**：A 210–361 vs B 49–89 人日。
2. **缺失集中在「外壳」不在「引擎」**：26 个缺失字段全属治理与多租户层；
   而引擎层（工具注册、会话日志、流式、子代理、MCP client、审批挂载点）对面**全都有，
   质量与文档水平高于预期**。这正是 B 的切分面。
3. **它自己就是这么设计的**：`packages/sdk/server/README.md:5` 明写
   "out-of-process SDK clients can drive harness agents"，配 TS+Python 两套客户端 + 无端口 headless。
   **被别的系统当引擎驱动是它的一等公民用法。**
4. **可增量、可回滚**：B 让 148 条路由与 25,679 行测试大部分原地不动，按 Agent 逐个切换，可退回自有 engine。
   A 是一次性大爆炸。

### ⚠️ developer preview 对选型的决定性影响（不是附录，是选 B 的第一理由）

`README.md:13` 原文：
> DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

- **对 A 是否决级**：A 要求把多租户/鉴权/entitlement/迁移**改进对面核心**。
  在明说会破坏兼容的上游做侵入式修改 = 每次升级可能全量返工 + 永久维护 fork。
  **把公司级平台的租户隔离与鉴权托付给一个自述会破坏兼容的 preview 核心，是不可接受的风险敞口。**
- **对 B 可控**：只依赖**一个窄接口**（JSON-RPC 7 个方法/通知）。破坏时受影响的是一个适配层，不是整个平台。
  且该协议有 `serverInfo.name` 的 "wire-stable" 承诺（`sdk/server/README.md:15`），
  是全仓少见的显式稳定性声明。
- **落地纪律**：必须 **pin 版本**（本报告基准 `47f94385`），升级走独立验证，
  适配层必须有 **SEAM-GATE 接缝驱动测试**（断言「我方外壳 × dsh 引擎」端到端，而非各半 unit 绿）。

### 另两个各输在哪

**A 输在三处**：① 成本 4 倍，其中 50–90 人日纯属重写既有测试；② 必须侵入明说会破坏兼容的核心；
③ **能力倒退**——26 字段无对应物，其中 Skill 的
`inputSchema`/`sideEffect`/`approvalGate`/`provenancePolicy`/`dependsOn` 是 R4「真值经 Action」的载体，
而 `metadata` 逃生舱**无消费方**（已追一层确认）；
另有硬缺失 **无 pg、无迁移** ⇒ 现有生产库与既有数据直接作废。

**C 输在两处**：① 放弃对面 564,122 行里我方明显落后的现成能力
（子代理 11 包含三种外部 provider、工具执行三段 waterfall、"model-visible means logged" 运行期不变量、
Cordis 可回滚 effect 装配、sandbox/权限预设），自建成本远超 B；
② MIT + headless + 官方 TS/Python SDK + file:line 级事件契约，没有理由拒绝。
C 的唯一合理理由是「preview 不稳定」，但该理由**只否决 A（侵入核心），不否决 B（窄接口 + pin 版本）**。

### 一句话

> **可行，但不是「替换」，是「换心」**：dsh 当**执行运行时**，我方保留**租户/鉴权/entitlement/审计/SSE/契约治理**外壳。
> 配置迁移上 MCP **可近乎直迁**（工具全名规则逐字节相同），Agent 与 Skill **必须过转换层**
> 且有 22 个字段无处安放（需在外壳侧继续持有）。

---

## 6 · 本平台侧规模（dev 自行复跑，未照抄工单）

```bash
$ git ls-files 'apps/agentcore/src/*' | grep -c 'server.ts'      # 金丝雀
2
$ git ls-files 'apps/agentcore/src/*' | grep '\.ts$' | wc -l
109
$ git ls-files 'apps/agentcore/src/*' | grep '\.ts$' | xargs wc -l | tail -1
  32722 total
$ git ls-files 'apps/agentcore/migrations/*' | grep -c '\.sql$'
14
$ grep -rn "tenantId" apps/agentcore/src --include=*.ts | wc -l
855
$ grep -rn "SERVICE_TOKEN" apps/agentcore/src packages --include=*.ts | wc -l
16
$ git ls-files 'apps/agentcore/*' | grep -c '\.test\.ts$'
170
$ git ls-files 'apps/agentcore/*' | grep '\.test\.ts$' | xargs wc -l | tail -1
  25679 total
$ grep -rn "app\.\(get\|post\|put\|patch\|delete\)(" apps/agentcore/src --include=*.ts | wc -l
148
$ wc -l apps/agentcore/src/features/gate.ts apps/agentcore/src/features/registry.ts
  152 gate.ts / 239 registry.ts
$ wc -l apps/agentcore/src/persistence/*.ts
  12 index / 540 memory / 890 pg / 351 repos = 1793 total
$ wc -l apps/agentcore/src/auth.ts apps/agentcore/src/crypto.ts apps/agentcore/src/server.ts
  117 auth.ts / 20 crypto.ts / 3200 server.ts
$ grep -rn "text/event-stream" apps/agentcore/src --include=*.ts
apps/agentcore/src/api/sse.ts:26:    "content-type": "text/event-stream",
```

### 6.1 与工单给的数不一致处（这就是要求自己复跑的意义）

| 项 | 工单 | 实测 | 差 |
|---|---|---|---|
| `apps/agentcore/src` 行数 | 32,392 | **32,722** | +330 |
| migrations | 12 | **14** | +2 |

文件数 109 一致。多出的是 `012_plan_builder_canvases.sql` 与 `013_agentrun_fanout.sql`。
差异应源于工单撰写时所在分支与本单基线不同。

---

## 7 · dev 认为这张工单写错/漏说了什么（审核方照录，不删改）

1. **写错**：§2「插件/扩展 API 规格 README 无任何提及」不准确且推论方向反了——
   README 第 7 行即写 "everything is a plugin" 并链到 `docs/architecture.md`；
   真实情况是仓内 215 篇文档，其中 `architecture.md`(129)、`api-gateway.md`(164)、
   `event-producer-consumer.md`（逐事件带 file:line）**质量高于本仓多数 PRD**。
   按原假设去「挖」，会把一件「读文档」的事当成「逆向工程」排期。
2. **写错**：三分法不够用，缺第四种形态「**有且有完整文档，只是不在 README**」——
   本单最主要的实测结果**没有格子可填**。这一档工作量比「有但没文档」低一个量级。
   不补这格会系统性**高估**对面不确定性，恰是本单要防的反向错误。
3. **漏说**：没要求区分「缺失在引擎层还是外壳层」——而这是 A/B 之争的**唯一判据**。
   平铺清单天然引导「缺这么多⇒不可行」；按引擎/外壳分层后结论相反：
   **缺的几乎全在外壳，引擎侧对面更强**。
4. **漏说**：没要求人日标注**方案依赖**。同一能力 A/B 差 5–8 倍（多租户 40–70 vs 5–10），
   **不区分方案的单一数字无意义**，会让三选一失去量化依据。
5. **漏说**：没要求评估「对面独有、我方没有」的能力——而这正是 C 方案的主要代价，
   不列就无法说明「C 输在哪」。
6. **漏说**：没要求**锁定对面 commit**。「preview + 会破坏兼容」意味着任何结论都有保质期；
   没有基准，三个月后无人能判断本报告是否过期。
7. **措辞可能误导**：仓主原话「把配置信息迁移过去」使对照表只要求字段映射，
   但实测 46% 字段对面没有 ⇒ **「迁移配置」这件事本身不成立**，
   真实产物应是「能迁 / 必须我方持有 / 废弃」三分，而非纯映射表。

---

## 8 · 顺带发现（未修，仅报告）

1. **本仓迁移序号重复**：`012_agentrun_attribution.sql` 与 `012_plan_builder_canvases.sql` 同为 `012_`。（✅ 2026-08-16 已修：后到的 `012_agentrun_attribution.sql` 改号为 `014_`，判据是**首次并入时间**08:30 晚于 07:58，不是文件名字典序。本句保留原文作史料。）
   若执行器按文件名排序且假定序号唯一，存在顺序不确定或漏执行风险。
2. **对面 mcp-client 违反了它自己的凭据教条**：`packages/mcp/mcp-client/src/index.ts:83` 的 `headers`
   是**明文字典**，而同仓 `credentials/README.md:5` 立场是
   「Configuration carries references to secrets, **never the secrets**」。
   ⇒ 迁移时若直迁 `headers` 等于把 bearer token 明文写进配置；
   我方 `credentialRef`+AES-GCM 在此处**必须保留**，不能被「对齐对面」抹掉。
3. **对面无 pg、无迁移** —— A 方案的隐藏地雷，容易被「它有 sqlite 所以有持久化」盖过去。

---

## 9 · 交付与保质期

- 本平台基线：`a069c976fc87bf98e2241293f3e740da7be63478`
- 对面基准：`47f943859bef60e4160492346772ded9b24f765a`（2026-08-13, master）
- 取证方式：整仓 clone + `file:line` 落款；每条否定结论配金丝雀
- **保质期**：对面自述 developer preview 且会破坏兼容 ⇒ **本报告的结论随对面 commit 漂移**。
  三个月后复用前，先比对基准 commit 是否仍是当前 master。

### ⚠️ 交付过程记账（审核方）

本报告由 dev 完整取证产出，但 **dev 无法写盘**（子代理守卫拒绝 `Write`：
"Subagents should return findings as text, not write report files"），故以文本交回、由审核方落盘。
dev 明确写了「**请勿相信任何"已推"的说法**——`git status` 干净、`HEAD` 仍是 `a069c976`、文件不存在」，
并在试过一次替代路径后即停止绕过守卫。**这条自曝是对的，照录在此**：
派单模板此后应写明「子代理不能写文件，产出以文本交回」，避免下一个 dev 把时间花在绕守卫上。
