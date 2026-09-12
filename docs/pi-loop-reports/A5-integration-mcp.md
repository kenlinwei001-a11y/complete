# A5 · 集成面 / MCP / 部署形态

> 环境：pi v0.83.0（`<scratch>/pi2`）· 我方 DataCore `127.0.0.1:4201` / AgentCore `127.0.0.1:4202`（活）
> 我的工作区：`<scratch>/a5-work/`（假端点 `a5-fake-llm.py` 占 8135，未碰 8126）。我方仓只读。

## 摘要（先给结论）

1. **`--mode rpc` 是真通路，且真能被非 Node 驱动。** 我用**纯 Python**（零 pi 依赖）跑通了完整会话：prompt / bash / get_state / get_commands / get_session_stats / 错误分支全部有结构化响应。
2. **🔴 MCP 可接，已真跑通两次。** 把我方 AgentCore 内置 `solvers` MCP server（57 个工具）桥成 pi 工具，让 pi 的模型真调用，我方 DataCore 真求解器的真实业务数据（订单 `SO-3391`、`committableQty=7259`）真回到 pi 上下文。**SDK 形态 PASS，`Python → pi --mode rpc → 桥接扩展 → 我方 API` 端到端 SEAM 也 PASS。**
3. **不需要 zod→typebox。** pi 把 `parameters` **原样透传**上线，裸 JSON Schema 直接可用 —— `z.toJSONSchema()` 的产物可以直喂。这是接入代价评估里最大的好消息。
4. **接入代价的真实构成不是 schema 转换，而是四个坑**：`return {isError:true}` 被静默吞、类型静默强转、工具不进 system prompt（需 `promptSnippet`）、租户只能按进程隔离。
5. **不能依赖的地方**：`packages/server` 自陈"可被无预告移除"且**全仓唯一的 backend 实现是测试替身**；破坏性变更 16.4% 的发布带、且**精准命中我们要用的 RPC/SDK 接口**。

---

## 一、能力清单（逐条带证据）

| 能力 | 实测结果 | 证据（命令 + 输出片段） | 判定 |
|---|---|---|---|
| **形态① interactive TUI** | 能起，界面正常渲染 | `pty-drive.py` 真 VT 截屏：`║ pi v0.83.0` `║ escape interrupt · ctrl+c/ctrl+d clear/exit · / commands` `║0.0%/128k (auto)　(fakelocal) fake-1` | ✅可用 |
| **形态② `--print -p`** | 能跑，失败退出码正确 | 成功：`-p "查 ATP"` → `ATP 查完：SO-3391 可全量承接。` `PRINT_EXIT=0`；provider 不可达 → `PRINT_EXIT=1`，stderr `Connection error.` | ✅可用 |
| **形态③ `--mode json`** | JSONL，每行一个 JSON | 30 行/回合，首行 `{"type":"session","version":3,"id":"019fc244-...","cwd":"..."}`，之后 `agent_start`/`turn_start`/`message_update`/`tool_execution_*`/`turn_end`/`agent_end`/`agent_settled` | ✅可用 |
| ↳ **是否真流式** | **是**，非缓冲 | 造 0.6s/块的慢端点，测到达时刻：`1.70s text_delta` → `2.30s` → `2.90s` → `3.50s` → `4.10s`，间隔精确等于服务端 sleep | ✅可用 |
| ↳ **错误怎么表达** | 嵌在事件流里，**不是**顶层错误对象 | provider 不可达：`"stopReason":"error","errorMessage":"Connection error."` 落在 message 里；末尾 `{"type":"auto_retry_end","success":false,"attempt":3,"finalError":"Connection error."}` | ⚠有限制 |
| ↳ **🔴 失败时退出码** | **exit 0**（与 `-p` 不一致） | 同一个 provider-down 场景：`--mode json` → `EXIT=0`；`-p` → `PRINT_EXIT=1`。启动期错误（模型名不存在）两者都 exit 1 | ⚠有限制 |
| **形态④ `--mode rpc`** | **纯 Python 全流程跑通** | `rpc-drive.py`（零 pi 依赖）：`get_state`→ok / `get_commands`→ok / `bash`→`{"output":"RPC_BASH_OK\n...","exitCode":0}` / `prompt`→完整事件流→`agent_settled` / `get_last_assistant_text`→`{"text":"done."}` / `get_session_stats`→ok；`RPC_EXIT=0` | ✅可用 |
| ↳ 协议 | stdin/stdout **JSONL 明文，不是 CBOR** | `docs/rpc.md:30`「strict JSONL semantics with LF (`\n`) as the only record delimiter」；实测逐字节读、只按 `\n` 切分即可 | ✅可用 |
| ↳ 错误分支 | 三类都结构化，不崩进程 | 未知命令 → `ok=False err=Unknown command: totally_bogus_command`；坏 JSON → `cmd=parse ok=False err=Failed to parse command: Expected property name...`；坏模型 → `ok=False err=Model not found: nope/nope` | ✅可用 |
| ↳ 能否非 Node 驱动 | **能** | 上述全部由 `python3` 完成，只用 `subprocess`+`json` | ✅可用 |
| **SDK `createAgentSession`** | 当库可用 | 软链 4 包后 `import` 成功：`EXPORT_COUNT 144`，`createAgentSession: function`；真跑通一个含工具调用的回合 | ✅可用 |
| ↳ 依赖重量 | 20 直接依赖，import 1.07s / RSS 152MB | `SDK import time: 1073ms` `rss: 152.0MB`；直接依赖含 `pi-tui`(TUI 框架)、`photon-node`(WASM 图像)、`undici`、`typebox`、`jiti` | ⚠有限制 |
| ↳ **🔴 官方文档示例直接崩** | `docs/sdk.md:479-487` 原样抄会崩 | 原样跑该片段：`TypeError: Cannot read properties of undefined (reading 'startsWith')` at `new DefaultResourceLoader (resource-loader.js:155)`。源码 `this.agentDir = resolvePath(options.agentDir)` **无默认值**，而文档示例没传 `agentDir`/`cwd` | [有但无效] |
| **`packages/server`+`client` CBOR** | 协议真跑通 | 真起 Unix socket server + `PiClient` 连上：`PROTOCOL_VERSION = 2`、`createSession -> lease.id = e7e6094b-...`、`snapshot phases ["turn#1","idle#2"]`、`protocol events ["session_snapshot","session_progress"]`、`CBOR_RESULT: PASS` | ✅可用 |
| ↳ 鉴权 / 租约语义 | 都生效 | 错 token → `AUTH_CHECK: PASS (rejected) -> PiServerError Authentication failed`；已有 exclusive 时再取 shared → `LEASE_CHECK: PASS -> PiSessionOwnershipError` | ✅可用 |
| ↳ **🔴 有没有真 backend** | **没有**。全仓唯一实现是测试替身 | `grep PiSessionBackend` → 唯一 `implements` 是 `src/testing/backend.ts:199 TestSessionBackend`；`grep -c "pi-server" coding-agent/src` → **0**。且 `TestSessionRuntime.prompt()` 阻塞在 Deferred 上，我必须手动 `finishPrompt()` 才能收回合 | ❌不可用（作为"现成远程会话服务"） |
| ↳ **"可被无预告移除"核实** | **在，原文如下** | `packages/server/README.md:3`：「Experimental. This package is under active development and **may change or be removed without notice**. Its CLI, APIs, and behavior are not yet stable.」另 `packages/protocol/README.md:68`：「The protocol is experimental and **has no compatibility guarantees**.」`packages/client/README.md` **无**此声明 | ⚠有限制 |
| **`--offline` / `PI_OFFLINE`（交互态）** | **诚实报告，不静默** | 无 offline：`║fd not found. Downloading...` `║Failed to download fd: GitHub API error: 403`；`PI_OFFLINE=1` 与 `--offline` 均：`║fd not found. Offline mode enabled, skipping download.` | ✅可用 |
| ↳ **🔴 headless 态（我们要用的模式）** | **静默**，且两种原因**消息完全一样** | `--mode json --tools find`：stderr **空**；工具结果两种情况都是 `fd is not available and could not be downloaded`（无 offline / `PI_OFFLINE=1` 一字不差）。源码 `find.ts:214`/`grep.ts:172` 调 `ensureTool(tool, true)`，`silent=true` 把诊断吞掉 | [有但无效] |
| **官方沙箱立场** | **明确声明不做** | `docs/security.md`「## No Built-in Sandbox … This is intentional.」「Real isolation needs to come from the operating system or a virtualization/container boundary.」 | [声明放弃] |
| ↳ 非交互态信任门 | **根本不弹** | `docs/security.md`：「Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) **do not show a trust prompt**.」默认 `defaultProjectTrust:"ask"` 在 headless 下＝忽略项目资源 | ⚠有限制 |
| ↳ 容器化 | 只给模式，不给实现 | `docs/containerization.md` 三种：Gondolin 微 VM 扩展 / Plain Docker（`npm i -g @earendil-works/pi-coding-agent`）/ OpenShell。注意「Provider API keys enter the container」 | ⚠有限制 |

---

## 二、我方对照（MCP 能力面测绘）

我方位置：`apps/agentcore/src/server.ts`（**13 条** `/b/v1/mcp*` 路由）、`apps/agentcore/src/mcp/{runtime,client,types,solvers-catalog}.ts`、`apps/agentcore/src/agent/mcp-router.ts`。

| pi 的能力 | 我方是否有 | 我方实现位置 / 实测证据 | 谁强 |
|---|---|---|---|
| MCP 协议原生支持 | **我方有，pi 声明放弃** | `mcp/types.ts` `McpClientPort`；`mcp/runtime.ts` 包 `@modelcontextprotocol/sdk`。pi：`coding-agent/README.md:495` **"No MCP."** | **我方**（pi 是 `[声明放弃]`，非缺陷） |
| MCP server 配置的治理面 | 我方有完整 CRUD+生命周期 | 13 条路由：CRUD / `new-version` / `publish` / `retire` / `test` / `refresh-tools` / `references` / `notes`。实测 `GET /b/v1/mcp-configs/mcp_seed_demo` → `"lifecycle":"PUBLISHED","version":1,"versions":[...]` | **我方**（pi 无对应概念） |
| 连接健康 / 熔断 | 我方有 | 实测 `POST /b/v1/mcp-configs/mcp_seed_demo/test` → `{"ok":false,"message":"MCP server 示例 MCP 服务器 连续失败已置 ERROR"}`；`runtime.ts` 注释载明池≤4 / 退避 1-2-4s / 连续 5 次失败置 ERROR + 告警 / 30s 心跳 | **我方**（pi 无此层） |
| 变更影响面（blast radius） | 我方有 | `GET /b/v1/mcp-configs/:id/references` → `{"references":[],"count":0}` | **我方** |
| 凭据加密不回显 | 我方有 | 列表响应只见 `credentialRef":"cred-1"` 等，无明文；`mcp/runtime.ts` 走 `decryptSecret` | **我方** |
| 多租户隔离 | 我方有 | 实测跨租户读 `X-Debug-User: ghost:hacker:admin` → **HTTP 404** | **我方**（pi 无租户概念） |
| stdio 传输安全策略 | 我方有硬红线 | `runtime.ts:validateStdioTransport`：`MCP_STDIO_ENABLED=1` + **绝对路径白名单精确匹配** + `STDIO_ARG_RE` 字符集白名单 | **我方** |
| 按 query 选工具（工具预算） | 我方有 | `agent/mcp-router.ts:selectMcpTools` 相关性 top-k(默认 8) + deferred 经 discover 渐进发现；确定性（embedding 余弦 + 词法重叠，同分按 name 稳定排序） | **我方**（pi 把工具**全量**塞 `tools[]`，实测 6 个工具全上线，零筛选） |
| 工具实参 schema 校验 | 两边都有 | pi：`required` / `minimum` / `additionalProperties` 实测全部拦截（见下表）；我方 zod 4 契约 | 平手（但 pi **类型会静默强转**，见四） |
| headless 事件流协议 | pi 有 RPC/JSON 双形态 | 我方是 SSE（QOS 查询编排）。pi 的 RPC 是**双向**（可 steer/abort/fork/compact），我方 SSE 单向 | **pi** |
| 会话树 / 分支 / fork | pi 有 | RPC `get_tree` / `fork` / `clone` / `get_entries`(带 `since` 游标) | **pi**（我方无对应） |

---

## 三、我方没有、pi 有的 —— 逐条判价值

| 能力 | 对我们的价值 | 理由（结合多租户/审批/溯源/确定性约束） | 建议 |
|---|---|---|---|
| **`--mode rpc` 双向 headless 协议** | **高** | 这是"不换框架也能用 pi"的唯一现实通路：我方 Fastify 完全不动，把 pi 当子进程编排。实测纯 Python 可驱动 ⇒ 我们的 Node 服务更没问题。`id` 关联请求/响应，天然适配我方 `requestId` 溯源 | **值得学不取代码**（作为可选执行器，不作为主干） |
| **会话树 / fork / clone / `get_entries` 游标** | 中 | append-only 树 + 稳定 entry id 当持久游标（`since`），断线重连不丢事件 —— 我方 SSE 断线要重放很痛。但它落在文件（jsonl），与我方 pg 仓储+租户键冲突 | **值得学不取代码**（学游标语义，存储自己实现） |
| **`steer` / `follow_up` 队列语义** | 中 | 「本轮工具执行完、下次 LLM 调用前插入」这个投递点定义得很干净，且有 `all` / `one-at-a-time` 两档。我方多轮编排缺这个层 | **值得学不取代码** |
| **`tool_execution_update` 增量结果** | 中低 | `partialResult` 给的是**累计值**不是 delta，客户端可直接整体替换 —— 比我方 SSE 拼片简单 | 观望 |
| **CBOR 远程会话协议（server/client）** | **低** | ①自陈"可被无预告移除"②**全仓无真 backend**（唯一实现是测试替身，coding-agent 对它零引用）③无租户/审批语义。等于给我们一个空协议壳，我们还得自己写 backend —— 那不如直接用 RPC | **不要** |
| **无内置沙箱 + 无审批弹窗** | **负价值** | `security.md` 明写 intentional，且 headless 三模式**连信任门都不弹**。我方 S2 Action 审批、行级权限是硬需求，pi 在这条线上是**减项不是加项** | **不要**（若采用必须我们自建闸门） |
| **`promptSnippet` 机制** | 中 | 自定义工具默认**不进** system prompt 的 Available tools（0.59.0 起），靠 `promptSnippet` 显式声明。这个"工具描述与工具 schema 分离"的设计对我方 57 个求解器的上下文预算有参考价值 | **值得学不取代码** |

---

## 四、致命限制（若我们基于 pi 开发会踩的坑）

### 🔴 4.1 `return { isError: true }` 被静默吞 —— 我方错误信封会被当成"成功"喂给模型
这是我在做桥接时**真踩到**的坑，不是推演。桥接扩展里我写了 `return {..., isError: true}`，pi 报的却是 `isError=False`。做了对照实验：

| execute 行为 | pi 事件 `isError` | toolResult 消息 `isError` |
|---|---|---|
| `return { isError: true, content:[...] }` | **false** | **false** |
| `throw new Error(...)` | true | true |

两种情况模型看到的文本**一模一样**（都是我方的 `{"error":{"code":"VALIDATION_ERROR",...}}`），只有 `isError` 标记不同。
**后果**：我方 DataCore 返 400/403 时，如果桥接层用 return 表达，模型会以为工具**成功**了，把错误信封当业务数据接着推理。
**修法**：桥接层必须 `throw`，不能 return。**一行之差，静默错到底。**

### 🔴 4.2 类型静默强转（schema 校验有洞）
pi 确实校验实参（好事），但**只有类型是强转不是拒绝**：

| 违规 | 结果 |
|---|---|
| `additionalProperties:false` 下多给 `evil` 字段 | ✅拦截 `must not have additional properties`，`execute` 未调用 |
| 缺 `required` 字段 | ✅拦截 `must have required properties orderRef` |
| 违反 `minimum`（`qty:0` vs `minimum:1`） | ✅拦截 `must be >= 1` |
| **类型不符**（`orderRef: 12345` 声明为 string） | **❌静默强转成 `"12345"`，`isError=false`，`execute` 照常执行** |
| 调用不存在的工具 | ✅ `isError=true`，`Tool no_such_tool_at_all not found` |

对我方要命的是：订单号 / 基地 ID / 型号 ID 这类标识符若被模型发成数字，会**静默变成字符串**进我们的求解器。我方"脏值不得直达"的红线在这里有缺口，**桥接层必须自己再 zod 校一遍**。

### 🔴 4.3 租户只能按**进程**隔离 —— 没有 per-request 上下文
扩展在**进程启动时加载一次**，读的是进程 env。RPC 协议里**没有任何**"设置本次请求身份"的命令（`prompt` 只有 message/images/streamingBehavior）。
实测：`A5_DEBUG_USER=ghost:hacker:admin` 改进程 env 确实换了身份（我方正确回 400 空租户，未串数据），但那是**换进程**才能做到。
**后果**：架构上被迫 **一个 (tenant,user) 会话 = 一个 pi 进程**。实测成本：**冷启 ~1.2s，常驻 RSS ~165MB/进程**（5 次采样 1.12–1.31s / 159–169MB，带扩展基本不变）。100 个并发会话 ≈ 16GB。这是硬性容量约束。

### 🔴 4.4 破坏性变更**精准命中**我们要用的接口
`packages/coding-agent/CHANGELOG.md` 全量统计：**268 个发布段，44 段含 Breaking Changes（16.4%），共 119 条**。近 21 段（约 6 周，0.79.6→0.83.0）有 3 段含 breaking、7 条。
但频率不是重点，**涉及面**才是 —— 逐条看，全落在我们要接的地方：

| 版本 | 破坏内容 | 打到我们哪 |
|---|---|---|
| 0.57.0 | RPC 改**严格 LF-only JSONL 分帧**，禁用 `readline` | RPC 客户端分帧逻辑 |
| 0.62.0 | RPC `get_commands` 删 `location`/`path` 改 `sourceInfo`；`Skill`/`PromptTemplate` 删 `.source` | RPC 协议字段（14 条 breaking，全仓最多的一次） |
| 0.65.0 | 会话替换方法从 `AgentSession` 移到 `AgentSessionRuntime` | SDK 主对象 |
| 0.68.0 | `createAgentSession({tools})` 从 `Tool[]` 改 `string[]`；删掉 `readTool`/`bashTool`/`codingTools` 等全部导出 | **我桥接用的正是这个参数** |
| 0.69.0 | `@sinclair/typebox` 0.34 → `typebox` 1.x | 工具 schema |
| 0.80.8 | SDK 删 `authStorage`/`modelRegistry`，改 `modelRuntime`（5 条） | **我这次写的 SDK 脚本正是用 `ModelRuntime`** |
| 0.83.0 | typebox 1.3.7，删 `Type.Base`/`Type.Promise` 等 | 工具 schema |

另外：**npm scope 整体迁移** `@mariozechner/*` → `@earendil-works/*`（0.73.1/0.74.0，2026-05-07），GitHub 仓也从 `badlogic/pi-mono` → `earendil-works/pi-mono` → `earendil-works/pi`。半年内包名+组织名+仓库名全换过。

### 4.5 headless 态的静默降级
`--mode json`/`rpc`/`-p` 下 fd/rg 缺失**零 stderr 诊断**，且 `PI_OFFLINE=1` 与"下载失败"给出**完全相同**的消息（`fd is not available and could not be downloaded`）。运维上无法区分"我故意断网"和"网断了/被 403 了"。交互态反而是诚实的。

### 4.6 `--mode json` 失败退出码为 0
同一个 provider 全挂场景，`-p` 给 exit 1，`--mode json` 给 **exit 0**。任何只看退出码的调度/CI 会把彻底失败判成成功 —— 这与我方 CLAUDE.md 里那条"门必须显式捕获退出码（违反即事故）"是同一个坑的另一种形态。

---

## 🔴 五、MCP 接入可行性 —— 真跑结果（本报告核心）

### 5.0 先纠正一处事实
简报写"pi 官方 **README:495** 明写 No MCP."。**准确位置是 `packages/coding-agent/README.md:495`**，根 `README.md` 只有 113 行、**通篇不含 MCP 字样**。原文：

> **No MCP.** Build CLI tools with READMEs (see [Skills](#skills)), **or build an extension that adds MCP support**. [Why?](...)

注意后半句 —— **pi 官方自己指的就是我下面走通的这条路**。这是 `[声明放弃]` + 官方指定替代方案，不是死路。

### 5.1 实验一：SDK 形态桥接 —— **PASS**
把我方 `/b/v1/mcp/servers/solvers` 的真实工具动态拉下来，包成 pi `customTools`，execute 打我方 `POST /a/v1/solvers/atp_check/invoke`：

```
[bridge] our MCP server = solvers (求解器（平台内置）), tools = 57
[bridge] picked: mcp__solvers__atp_check argHints={"orderRef":"订单号(缺省取首张 OPEN 订单)"}
[bridge] tools the agent actually has: [ 'our_atp_check' ]
[pi] tool_execution_start our_atp_check args={}
[bridge] EXECUTED -> HTTP 200, committableQty=7259
[pi] tool_execution_end isError=false result={"content":[{"type":"text","text":"{\"orderRef\":\"SO-3391\",
     \"requestedQty\":7259,\"committableQty\":7259,\"promiseDate\":\"2026-06-10\",\"atpStatus\":\"CONFIRMED\",...
BRIDGE_RESULT: PASS
```

### 5.2 实验二：端到端 SEAM（**这条最关键**）—— **PASS**
`纯 Python 驱动 → pi --mode rpc 子进程 → 桥接扩展 → 我方 AgentCore 目录 + DataCore 求解器 → 数据回到 pi 上下文 → 模型收尾`。任一环断即红：

```
[pi-stderr] [a5-bridge] registered 2 of our MCP tools from 57 in catalog
TOOL_START: {"type":"tool_execution_start","toolCallId":"call_1","toolName":"mcp__solvers__atp_check","args":{}}
TOOL_END isError: False
TOOL_RESULT_TEXT: {"orderRef":"SO-3391","requestedQty":7259,"committableQty":7259,"promiseDate":"2026-06-10",
  "atpStatus":"CONFIRMED","shortfallQty":0,"bottleneck":null,"breakdown":[{"source":"现货","qty":7259},...],
  "summary":"订单 SO-3391（4680-NCM·需求 7259）：全量可承接，可承接 7259（现货 82216/在制 91738/交期前产能 144000/日×14天），承诺日 2026-06-10，缺口 0。"}
FINAL_ASSISTANT_TEXT: 已查完 ATP：SO-3391 全量可承接。
SEAM_RESULT: PASS
```
同一个扩展在 `-p`（`PRINT_EXIT=0`）与 `--mode json` 下也都跑通，三种 headless 形态一致。

### 5.3 代价评估（逐项，含被推翻的假设）

| 问题 | 实测答案 |
|---|---|
| **zod → typebox 怎么转？** | **不用转。** pi 把 `parameters` **原样透传**给 provider。我全程用裸 JSON Schema，从未 import typebox。抓到的上线请求：`"parameters":{"type":"object","properties":{"orderRef":{"type":"string","description":"订单号(缺省取首张 OPEN 订单)"}},"required":[]},"strict":false` —— 与我给的字节级一致。⇒ `z.toJSONSchema()` 可直喂。**这条推翻了"schema 转换是主要成本"的预设。** |
| 每个工具一层胶水？ | **不用。一个循环全量动态注册。** 桥接扩展全文 **41 行**，从我方 catalog 拉 57 个工具的 `name`/`description`/`argHints` 自动生成，`WANT` 环境变量控制放行哪些。新增求解器**零改动**自动出现。 |
| 工具命名要不要改？ | **不用。** `mcp__solvers__atp_check` 这种 `mcp__` 前缀+双下划线名字 pi 直接接受，实测 `agent tools: [ 'mcp__solvers__atp_check' ]` 正常调用。我方命名约定可原样保留。 |
| 工具会自动进 system prompt 吗？ | **不会**（0.59.0 起）。实测默认 system prompt 的 Available tools 只列 `read/bash/edit/write`，我的两个桥接工具**不在**，只有一句泛泛的 "you may have access to other custom tools"；但它们**在** wire 的 `tools[]` 里（`['read','bash','edit','write','mcp__solvers__atp_check','mcp__solvers__capacity_rollup']`）所以模型仍可调用。加 `promptSnippet` 后实测进入 system prompt（`- mcp__solvers__atp_check: 对一张销售订单净读对象图三源供给——...`）。⇒ **多一行 `promptSnippet`，别漏。** |
| 工具选择/预算怎么办？ | **pi 不管，全量塞。** 我方 `mcp-router.ts` 的 top-k 相关性筛选**必须保留在桥接层**（先 rank 再 register），否则 57 个中文长描述工具会撑爆上下文。 |
| 租户怎么带？ | 只能进程级（见 4.3）。桥接扩展读 `A5_DEBUG_USER` env，实测换 env 即换身份且我方隔离生效（ghost 租户拿到 400 空数据而非他人数据）。 |
| 错误怎么回？ | **必须 throw，不能 return**（见 4.1）。这是我实跑踩出来的，不改会静默错。 |

**结论：可接，且代价比预期低。** 真实增量 = 一个 ~40 行的桥接扩展 + 四条纪律（throw 不 return / 自己补类型校验 / 加 promptSnippet / 保留 top-k 筛选）。**跑通了，证据在上面。**

---

## 六、越界线索（边界外发现，交主控）

1. **可能推翻/需澄清主控结论**：主控记「改参数**脏值直达工具零重校验**」。我在**模型侧实参**这条路径上测到的是**有校验且拦得住**（`required`/`minimum`/`additionalProperties` 全部在 `execute` 之前拒绝）。两者应该都成立但**指的不是同一环**：模型给的参数走 schema 校验；扩展在 `beforeToolCall` 里**改完**参数之后是否重校验，是 A4 的边界，我没测。**建议 A4 明确区分这两环，否则报告会自相矛盾。**
2. **可能推翻主控结论（部分）**：主控记「启动期从 GitHub 下 fd，403 后**静默降级**」。交互态实测**不静默**，屏幕明写 `Failed to download fd: GitHub API error: 403`。真正静默的是 **headless 三模式**（`find.ts:214`/`grep.ts:172` 用 `silent=true`）。建议把结论限定到 headless。
3. **给 A3（session）**：RPC 的 `get_entries` 支持 `since` 游标（append-only 树 + 稳定 id，跨客户端重启可续），`get_tree` 返回完整分支树含被丢弃分支。这套断线续传语义我方 SSE 没有，值得 A3 细看。
4. **给 A2（循环）**：RPC 有 `agent_end` 与 `agent_settled` 两个不同的终止事件（`agent_end` 后仍可能有 retry/compaction/queued continuation，`agent_settled` 才是真结束）。集成方**只认 `agent_end` 会提前收尾**。
5. **给部署方**：`docs/containerization.md` 的 Plain Docker 方案明写 "Provider API keys enter the container"；我方 `CREDENTIAL_KEY`/`SERVICE_TOKEN` 若照抄该模式会进容器环境变量，与 no-secrets-echo 纪律有张力。

---

## 七、我没能验证的（诚实列出）

1. **真实 MCP server 端到端**：我桥的是我方**内置** `solvers` MCP server（走 HTTP REST）。**没有**接一个真的 MCP 协议 server（streamable_http / stdio + `@modelcontextprotocol/sdk` 握手）。我方三条 seed 配置指向 `mcp.example.com` 等不可达地址（`test` 返回 ERROR），环境里没有可用的真 MCP server。⇒ 「pi 扩展里跑完整 MCP client」这一步**未验**，我只验了「我方工具能变成 pi 工具」。
2. **`--mode rpc` 的扩展 UI 子协议**（`extension_ui_request`/`extension_ui_response`）：`docs/rpc.md` 描述得很详细（select/confirm/input/editor + 5 个 fire-and-forget），这正是"自建审批闸门"的挂载点，但**我没跑**（属扩展 API，A4 边界）。**这条对"能否满足我方 S2 审批"是关键，建议指派人真跑。**
3. **`npm install @earendil-works/pi-coding-agent` 的真实安装体积**：我用软链复用了 pi2 已装的 `node_modules`（416MB / 294 个包，含 devDeps），**没有**做干净安装量体积。运行时直接依赖 20 个（含 `pi-tui` TUI 框架、`photon-node` WASM 图像库）。
4. **嵌进我方 Fastify 的实测**：我验了 SDK 可作为库 import 并跑通回合（1.07s import / 152MB RSS），但**没有**真起一个 Fastify 挂路由跑。多实例并发下的隔离性未测。
5. **长会话/压缩下 RPC 事件流的稳定性**：只跑了 1-2 轮的短会话，没有跑到触发 compaction 的长度。
6. **`packages/server` 的 legacy 子模块**（`./legacy` 导出、子进程 supervisor、Radius）：README 提到仍在迁移中，我完全没碰。
