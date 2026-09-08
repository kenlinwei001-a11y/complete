# pi 框架依赖性判决（LOOP 六 agent 实测汇总）

> 仓主问：**PI 是否是一个可以依赖的框架，我们系统的 agent 未来是否基于它开发；已有的 agent / MCP / skill 等功能如何与其连接。**
>
> 方法：六个 agent 分互不重叠边界并行实测（`scratchpad/LOOP-BRIEF.md` 为共享简报），全部要求**真跑带命令与输出**，仅静态证据须标 `[仅静态]`。
> 明细报告：`scratchpad/loop-reports/A1..A6.md`（1508 行）。本文件只留判决与依据。
> pi 版本 v0.83.0。我方 canonical `88f584ec`。

---

## 一、判决（先给结论）

**① pi 不能作为我们生产 agent 的运行时底座。** 不是因为它差，是因为它**刻意不提供**我们赖以存在的那一层，且其中三处缺失恰好落在我们吃过大亏的脆弱点上。

**② pi 可以作为「受管执行沙盒」被我们调度。** AgentCore 仍是编排 / 治理 / 溯源主体，pi 当可控子进程 —— 这条路 A5 已端到端跑通，不是设想。

**③ pi 有四样东西现在就该拿。** 都不需要引入 pi 代码，抄知识或抄设计即可。

**④ 本轮 LOOP 最出乎意料的产出：抓到我们自己四条「声明了没接线」。** 见 §六。**这比 pi 的任何结论都更该先处理。**

---

## 二、可信度声明（先说这份判决建立在什么上）

| 项 | 事实 |
|---|---|
| 实测规模 | 6 agent · 705 次工具调用 · ~140 万 token · 累计约 2.5 小时并行 |
| pi 自测基线 | `pi-agent-core` 282 passed；`pi-coding-agent` 1697 passed / 16 failed（**16 红全为环境**：本机 root → `chmod 000` 仍可读，EACCES 前提不成立；`fd` 未装）；`pi-ai` 777 passed / 24 failed / **755 skipped** |
| ⚠ **pi 测试可信度边界** | **`pi-ai` 755/1556（48.5%）用例无 API key 即 skip**；跨 provider 接力这条最关键的测试在无 key 环境 `0/38 contexts` 直接 FAIL。**「pi 测试绿」≠「pi 这条路径被验证过」** —— 正撞我们「绿测试≠能用」的老坑 |
| ⚠ 我们没连过真厂商 | 全部对着自建 chaos / faux 端点。验的是**协议层健壮性与治理接缝**，不是「pi 对真实响应的解析正确性」 |

---

## 三、判决依据 · 五条硬伤

按「若基于 pi 开发，会在哪炸」排序。每条都有实测。

### 硬伤 1 · 流开后 provider 静默 = 无限挂死，`timeoutMs` 管不着 〔A1〕

```
timeoutMs:3000 + 服务端开流后不说话
  +95ms    text_delta（收到一帧）
  +20012ms {"WATCHDOG":"still alive -> STREAM NEVER TERMINATED"}
```

`timeoutMs` 是**连接/首包超时，不是流空闲超时**（对慢握手准时生效：2080ms）。
对我方：path-B 是长跑循环，一次挂死 = 工单永久卡死，而 `maxDurationMs` 在我们循环层，**pi 的 `await` 根本不返回**。
逃生口存在：`abort()` 实测 6ms 干净收敛、局部文本保留 —— **但帧间看门狗必须我们在 pi 外面自建**。

### 硬伤 2 · 契约校验是单向阀，R1 在 pi 上不成立 〔A4，澄清我此前的矛盾记录〕

同一严格 schema，两个环结果相反：

| 环 | 结果 |
|---|---|
| **① 模型侧实参** | ✅ **有校验拦得住**：缺必填 / 违反 minimum / 多字段 / string→number 全拦，错误原文回传模型。⚠ 唯一的洞：**number→string 静默强转** |
| **② 扩展 `tool_call` 里 mutate 之后** | ❌ **零重校验**，同样四类违规**一条不拦**，全部直达 `execute()` 且 `isError:false`，连强转都不做 |

内置 bash 上同一实验：`command=12345` → `/bin/bash: line 1: 12345: command not found`；`delete command` → `undefined: command not found`。

> **`tool_call` 钩子处于契约保护区之外。** 而我们要重建治理，全部动作都发生在这个钩子里 —— 等于**治理层与契约层互相排斥**。

### 硬伤 3 · 诚实降级只有一条非直觉通道，且依赖实现细节 〔A4〕

四种自然写法全败：`appendEntry`（看不到）/ `sendMessage` 默认（**自激成 1015 轮无限循环**）/ `nextTurn`（永不送达）/ `sendUserMessage`（抛错）。

唯一可行：在 `message_end` 里把 `stopReason:"aborted"` 的 assistant 消息**整条替换**。跑通了（exit 0 + 文本真上 stdout + JSON 模式外部消费者也收到），但**利用的是 `print-mode.ts:130-140` 的实现细节，不是 API** —— 上游任何重构都会无声打断它。

我方 `degrade()` 是**唯一诚实出口**、11 处调用、四种形态、有未验证数字护栏。这是我们与 pi 差距最大的一处，也是最不能赌在实现细节上的一处。

### 硬伤 4 · 多租户在 pi 里无处可挂 〔A4〕

`ctx` 18 个键对 `/user|tenant|ident|auth|role|org/i` 匹配**结果为空**；`identityKeys: []`。
三条替代路（env / `registerFlag` / `before_provider_headers` 注入）**均实测可达服务端**，但**共同前提都是「一进程一租户」**。
代价实测：冷启 ~1.2s、RSS ~165MB/进程 → **100 并发 ≈ 16GB**〔A5〕。

「跨租户一律 403/404」这条铁律在 pi 层面**没有挂载点**，只能靠进程边界。这是架构级代价，不是补丁。

### 硬伤 5 · 压缩出口零校验（两条路都是） 〔主控 + A3 + A4〕

| 路径 | 实测 |
|---|---|
| LLM 摘要器 | 8 个字的垃圾摘要被原样注入 `<summary>好的，我记下了。</summary>` |
| 扩展接管 | `{summary:"", firstKeptEntryId:"deadbeef", tokensBefore:-999}` **全盘接受、原样落盘**，5 轮历史从上下文消失，**零告警** |
| 分支摘要 | 3 个字 `收到。` 原样注入 |

> **A3 修正我一条**：我说「原文永久丢弃」—— **对模型上下文成立，对会话文件不成立**。原文全部留在 JSONL，且靠 `parentId` 链能查出「这条结论产生于第几次压缩之后」。**这一项是 pi 有、我们没有。**

---

## 四、pi 值得拿的（分级 · 均不引入 pi 代码）

### 立即取（零架构影响）

| 项 | 依据 |
|---|---|
| **`ai/src/utils/overflow.ts` 超窗错误串库** 〔A1〕 | 30+ 厂商实测错误文案 + 两类「不报错」阴间 case（z.ai 静默、小米 MiMo 截断后回 `length`+output=0）。**我方只有 3 条正则** → 漏判 = 超窗当普通错误 = 不触发压缩 = 死循环烧钱 |
| **`ai/src/utils/retry.ts` 重试分类器** 〔A2〕 | 40+ 条从真实 issue（#2264/#733/#3317/#4433/#3594/#6019）长出来的故障文本正则 + quota/billing 明确不重试 |
| **会话树设计**（`parentTaskId` + `branch(fromTaskId)` 契约） 〔A3〕 | pi 的 fork **保留祖先 entry ID 逐字不变**，`/tree` 能在同一文件做出真「一父两子」。我方 `grep parentId` = **0** —— 这是「方案对比 / 反事实双轨推演」缺的地基。**取设计不取代码**（我方 pg 双实现，不照搬 JSONL） |
| **39 个 compat 旋钮的知识** 〔A1〕 | Kimi/千问/智谱/MiniMax/小米各自的字段名与思考形态，pi 已踩完并逐条给了开关 |

### 值得学不取代码

`onPayload` 出站改写钩子（租户标记/脱敏/出站审计挂载点，实测整包替换真落线）· provider 级流式细粒度事件（中文分片实测无乱码，我方旁白只能整段发）· `turn_end{message,toolResults}` 作 Loop Control 挂载点 · `afterToolCall{terminate}` 干净早停 · 压缩滚动合并（`<previous-summary>` + UPDATE 提示词）· `retainedTail` 自包含检查点 · `--export` 自包含 HTML（审批证据包范式）· `promptSnippet`（工具描述与 schema 分离）

### 明确不要

`packages/server` CBOR（**全仓唯一 backend 是测试替身**，README 自陈「may be removed without notice」）· 7 家订阅制 OAuth（单机开发者模型，与服务端多租户根本不兼容）· `AuthStorage` 明文落盘 · `fauxProvider`（无 seed，比我方 mock 更不确定）· 上下文文件沿祖先链（**不过信任门** = 不受 entitlement 管的提示注入口）· `--skill <path>` 直载（绕过全部发布治理）

---

## 五、已有 agent / MCP / skill 怎么接（A5 已跑通）

**MCP —— 可接，代价比预期低得多。** 端到端 SEAM 真跑通：

```
纯 Python → pi --mode rpc 子进程 → 桥接扩展 → 我方 AgentCore 目录 + DataCore 真求解器 → 回 pi 上下文
TOOL_RESULT_TEXT: {"orderRef":"SO-3391","committableQty":7259,"promiseDate":"2026-06-10",...}
SEAM_RESULT: PASS
```

三条推翻预设：

| 预设 | 实测 |
|---|---|
| zod→typebox 转换是主要成本 | **不用转**。pi 原样透传 `parameters`，抓到的上线请求与输入字节级一致 → `z.toJSONSchema()` 可直喂 |
| 每工具一层胶水 | **桥接扩展全文 41 行**，从 catalog 自动生成 57 个工具，新增求解器零改动自动出现 |
| 官方「No MCP」是死路 | 原文 `coding-agent/README.md:495`：「**No MCP.** …**or build an extension that adds MCP support**」——**官方指的就是这条路** |

**四条必守纪律**（每条都有实测教训）：
1. **桥接必须 `throw` 不能 `return {isError:true}`** —— `return` 被静默吞成 `isError:false`，模型会把我们的 400/403 错误信封**当业务数据继续推理**
2. **桥接层自补 zod 校验** —— pi 对 number→string 静默强转，订单号被模型发成数字会静默变形进求解器
3. **加 `promptSnippet`** —— 0.59.0 起工具不自动进 system prompt（在 wire `tools[]` 里可调用，但模型不知道有它）
4. **保留我方 `mcp-router.ts` top-k 筛选** —— pi 全量塞，57 个中文长描述会撑爆上下文

**skill —— 不建议迁到 pi 侧。** pi 只认 3 个 frontmatter 字段且**写进自己的测试**（`it("should ignore unknown frontmatter fields")` 断言 `diagnostics` 为空），`allowed-tools` 被丢弃 → **skill 无法自带权限边界**。我方 `sideEffect`/`approvalGate`/`references.required`/版本/发布门在 pi 里**没有落点**。

**agent 编排 —— pi 有完整的自建参考。** `examples/extensions/subagent/` 是 **1015+126 行完整实现**（spawn 子 pi + `--mode json` 事件流 + usage 聚合 + 并发上限 8/4 + abort 传播 + `.md` frontmatter 定义 agent）。README 说「No sub-agents」指的是**核心不内置**，措辞是精确的，不矛盾。

---

## 六、⚠ LOOP 反过来抓到的我们自己四条债（比 pi 的结论更该先处理）

| # | 债 | 实测 |
|---|---|---|
| **#88** | **出货 compose 只带第一层治理** | `orchestrator.ts:1661` 传 `config.QOS_AGENT_LOOP_REPEAT_CAP`，env 未设 → undefined → 禁用；**`docker-compose.yml` 只有 4 个 QOS_ 变量，一个 loop-control 开关都没有**。对照：关=24 轮跑满，开(=3)=3 轮停。**不是打到零**（24 轮硬顶 + S01 早停 + 诚实降级默认在），但准确说法是「三层治理，出货只带第一层」 |
| **#89** | **Entitlement 在 `X-Debug-User` 链路完全失效** | 同租户配置：dev 头 **27** 工具 vs JWT **23** 工具。`gate.ts:88` fail-open 返 `"ALL"`。**我今天多次用这个头做验收，等于绕过了这道门** |
| **#90** | **Skill 对默认自由问答路径不可达** | `load_skill` 全仓只被 `skill-lint.ts` 引用；`loadSkillEnabled:true` 只在 `engine.ts:359`；通用 path-B 没传 → **7 个已发布 skill 默认路径一个都用不上** |
| **#92** | **租户级 token 配额零消费方** | 状态机实测完全正确（`OK → SOFT_EXCEEDED,degrade:true → HARD_EXCEEDED`），但 `grep -rn "llm-budgets"` 在 agentcore/frontend **零命中** |

外加 **#91**：我今天并入的压缩锚定防线，**在默认阈值（~140k token）下是死代码** —— 24 轮真跑只到 ~55k，「结果已折叠」出现 0 次。改动本身没错、变异反证 3/3 真红，但我在交付说明里写「闭合断点」时**没说明它多久才触发一次**。

---

## 七、建议路线

| 阶段 | 内容 | 状态 |
|---|---|---|
| **先做（与 pi 无关）** | 清 §六 四条自债。**一行 compose 收益最大**（#88） | 待仓主定优先级 |
| **立即取** | overflow 错误串库 + retry 分类器（抄常量表，MIT） | 待批 |
| **设计层取** | 会话树 `parentTaskId` + `branch()` 契约 | 待批 |
| **中间路线（推荐）** | pi 作**受管执行沙盒**：一租户一进程 + `--mode rpc` + `registerFlag` 注入身份 + `before_provider_headers` 透传 OBO。AgentCore 仍是编排/治理/溯源主体。四条硬伤全部退化成进程边界内的局部问题 | 待批 |
| **不做** | pi 当生产 agent 运行时底座 | — |

**若真要走底座路线，最低门槛是四个 upstream PR 被接受**（A4 判据）：(a) `ctx` 上开 `principal` 插槽；(b) 正式的 `agent_degrade`/`finalMessage` API；(c) `tool_call` 后 schema 重校验（哪怕 opt-in）；(d) `ui.confirm` 在 `hasUI===false` 时抛错而非静默 `false`。

**稳定性输入**：CHANGELOG 全量 **268 发布段，44 段含 Breaking（16.4%），共 119 条**，且**精准命中我们要用的接口**（`0.68.0` 改的 `createAgentSession({tools})` 正是桥接用的参数；`0.80.8` 删的 `modelRegistry` 正是 SDK 脚本在用的）。半年内 **npm scope + 组织名 + 仓库名全换过一遍**。

---

## 八、本判决未覆盖的（诚实边界）

- **真实厂商行为**：全部对着自建端点，38 家真 provider 一家没连过（无 key）
- **审批门只验到 180 秒**：小时级/跨天没验；180s 那次已出现 `auto_retry_start` + 空 assistant 消息（连接陈化征兆，未定因）。A4 倾向撑不住，但**这是推断不是实测**
- **`subagent/` 未端到端跑**：代码逐段核过，只能说「机制齐备且是官方完整实现」，不能说「我验过能跑」
- **真 MCP 协议 server 未接**：桥的是我方内置 `solvers`（走 HTTP REST），没接 streamable_http/stdio + SDK 握手的真 MCP server
- **sqlite 会话后端、WebSocket 传输、Bedrock/Vertex/Mistral/Azure 四条一等实现**：完全没碰
- **我方 AES-GCM 落库的密文形态**：只验了「响应不回显明文」，没看到 pg 库里的密文字节 `[仅静态]`
