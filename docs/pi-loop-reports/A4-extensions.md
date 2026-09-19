# A4 · 扩展 API（治理能否原样重建）

**一句话结论：能重建，但要换范式，而且必须跑 `--mode rpc`。** pi 的扩展 API 足以把我们 7 项治理里的 6 项做出来（硬上限 / 审批门 / 诚实降级 / entitlement / 行级脱敏 / 溯源），**全部亲手跑通并有落盘证据**；唯一真正缺失的是**多租户身份**——pi 类型系统里 tenant/user 零存在，只能由**进程边界**（一租户一进程 + `registerFlag`/env）补，这是架构级代价而非补丁。

四个致命坑，**踩中任何一个都会让"绿测试≠能用"重演**：
1. **诚实降级只有一条唯一通道**，而且是"在 `message_end` 里改写那条 aborted 的 assistant 消息"这种**依赖 print-mode 实现细节**的非直觉手法（四种自然写法全部失败，其中一种直接自激成 1015 轮无限循环）；
2. **`ctx.ui.confirm` 在 `-p` 下 0ms 静默返回 `false`**（deny-all 且零线索）——审批门**只能在 `--mode rpc` 下用，`-p` 下不存在**；
3. **契约校验是单向阀**：模型给的参数**有校验**（required/minimum/additionalProperties 都拦），扩展改过的参数**零重校验**（同样四类违规一条不拦）→ **R1「契约层不可绕过」在 pi 上不成立**；
4. **扩展可无校验地重写会话历史**（`session_before_compact`/`session_before_tree` 完全接管，我用 12 个字垃圾摘要顶掉 605 tokens 原文且原文永久丢失）→ 直接冲击结论溯源。

**另外必须纠正一个可能的乐观推论**：`docs/usage.md:301` 把 **"permission popups" 明确列进 pi「故意不做」的清单**，`examples/extensions/permission-gate.ts` 只是 **34 行骨架 demo**（正则匹配 3 个危险模式 + 同步弹窗，`-p` 下直接 block），**没有任何"等人批"的机制**。"pi 有 permission-gate 所以审批门有着落"——不成立。

工作目录 `<scratch>/a4-work/`（探针扩展 16 个 + 假 LLM `fake-loop.py` + 5 个 RPC 驱动脚本）。全部日志在 `/tmp/a4-*.jsonl`。

---

## 一、能力清单（逐条带证据）

### 1.1 生命周期钩子 · 真发不发（`-p` 单次跑全量探针 `probe-all.ts`，挂 33 个事件）

命令：
```bash
node .../cli.js --model fakelocal/fake-1 --no-session -e ./probe-all.ts -p "请执行环境检查" < /dev/null
```
实测触发顺序（`/tmp/a4-probe.jsonl` 54 条，假 LLM 发 2 轮工具调用）：
```
__EXT_LOADED → session_start → resources_discover → input → before_agent_start → agent_start
→ turn_start → message_start → message_end → context → before_provider_headers
→ before_provider_request → after_provider_response → message_start → message_update ×2 → message_end
→ tool_execution_start → tool_call → tool_execution_update ×2 → tool_result → tool_execution_end
→ message_start → message_end → turn_end   （turn 循环 ×3）
→ agent_end → agent_settled → session_shutdown
```

| 钩子 | 真发不发 | 载荷 | 返回值能改变什么 | 判定 |
|---|---|---|---|---|
| `project_trust` | ✅ 发（需 cwd 有 `.pi`/`.agents/skills`；仅 user/global + CLI `-e` 扩展参与） | `{type,cwd}`；ctx **是阉割版**只有 `cwd/mode/hasUI/ui`（无 sessionManager/abort） | `{trusted:"yes"\|"no"\|"undecided", remember?}` 首个 yes/no 赢，压制内置提示。实测 `yes`/`no` 均生效 | ✅可用 |
| `session_start` | ✅ | `{type,reason:"startup"}`（fork/new 时带 `previousSessionFile`） | 无 | ✅ |
| `resources_discover` | ✅ | `{cwd,reason}` | `{skillPaths,promptPaths,themePaths}` 可注册外部技能目录 | ✅（返回值未单独验，标 [仅静态]） |
| `input` | ✅ | `{text,images,source,streamingBehavior}`。⚠ `-p` 下 `source` 报 `"interactive"`（RPC 下才是 `"rpc"`） | `{action:"transform",text}` **实测改写真到模型**（服务端 body：`"杂项钩子测试 【被扩展改写：只允许查询，不许写】"`）；`{action:"handled"}` **实测整轮 agent 不跑**，stdout 空 | ✅可用 |
| `before_agent_start` | ✅ | `{prompt, systemPrompt(2785字), systemPromptOptions{cwd,skills,contextFiles,selectedTools:4,toolSnippets,promptGuidelines}}` | 可注入 message / 换 systemPrompt | ✅（返回值未单独验） |
| `agent_start` | ✅ | `{type}` 空 | 无 | ✅ |
| `turn_start` | ✅ 每轮 | `{turnIndex,timestamp}` | 无 | ✅ |
| `context` | ✅ 每轮（主控已验，不重复） | `{messages}` | 已由主控验证注入到达模型 | ✅ |
| `before_provider_headers` | ✅ 每轮 | `{headers}`（**初始为空对象 `{}`**，API key 不在里面） | **就地 mutate 生效**：注入的 `X-Tenant-Id: demo` / `X-Debug-User: demo:admin:admin` / `Authorization: Bearer OBO-USER-JWT-A4` 假端点真收到。**返回值被忽略**（`X-From-Return` 未出现在服务端头列表）——与文档一致 | ✅可用 |
| `before_provider_request` | ✅ 每轮 | `{payload}` = 完整 provider body（`model/messages/stream/tools/max_completion_tokens/prompt_cache_key…`） | 就地 mutate ✅ + **返回值即新 payload**（非 `{payload:...}`！）实测服务端收到 `a4_replaced:true, max_completion_tokens:777` + 我 push 的红线消息 | ✅可用（有坑，见四） |
| `after_provider_response` | ✅ 每轮 | `{status:200, headers:{...}}` | 无（纯观测） | ✅ |
| `tool_execution_start` | ✅ | `{toolCallId,toolName,args}` | 无 | ✅ |
| `tool_call` | ✅（主控已验 block） | `{toolName,toolCallId,input}` | 见 1.3 | ✅ |
| `tool_execution_update` | ✅ 每工具 2 次 | `{toolCallId,toolName,args,partialResult}` | 无 | ✅ |
| `tool_result` | ✅ | `{toolName,input,content,details,isError,usage}` | `{content,details,isError,usage}` 均可改。**实测改写真到模型**：把含 `SECRET` 的行替换为「[已按行级权限过滤]」后，假端点收到的 tool 消息里 SECRET 已消失 | ✅可用 |
| `tool_execution_end` | ✅ | `{toolCallId,toolName,result,isError}` | 无 | ✅ |
| `turn_end` | ✅ 每轮 | `{turnIndex, message(含 usage:{input,output,cacheRead,cacheWrite,reasoning,totalTokens,cost}), toolResults[]}` | 返回值无用，但 **ctx.abort() 在这里是硬上限的唯一支点**（见 §四之 G1） | ✅可用 |
| `agent_end` | ✅ | `{messages[]}` 全量消息 | 无返回值语义。⚠ 此时 `ctx.isIdle()===false`（还在 streaming） | ⚠有限制 |
| `agent_settled` | ✅ | `{type}` 空 | 无 | ✅ |
| `session_shutdown` | ✅ | `{reason:"quit"\|"reload"\|"new"\|"resume"\|"fork"}` | 无 | ✅ |
| `session_before_switch` | ✅（RPC `new_session` 实测触发，`reason:"new"`） | `{reason,targetSessionFile?}` | `{cancel:true}` 可取消 | ✅（cancel 未单独验） |
| `session_before_fork` | ✅（RPC `fork` 实测触发，带 `entryId:"0adadca0"`） | `{entryId,position}` | `{cancel:true}` | ✅ |
| `session_before_compact` | ✅（需真够大的会话；6 轮对话 + `keepRecentTokens:30` 后触发） | `{reason:"manual",willRetry,branchEntries:16,preparation{firstKeptEntryId,messagesToSummarize,turnPrefixMessages,isSplitTurn,tokensBefore,previousSummary,fileOps,settings},signal}` | **`{cancel:true}` 实测生效** → RPC 回 `{"success":false,"error":"Compaction cancelled"}` | ✅可用 |
| `session_compact` | ✅ | `{compactionEntry{summary,firstKeptEntryId,tokensBefore,details,usage,fromHook},fromExtension,reason,willRetry}` | 无 | ✅ |
| `session_before_tree` / `session_tree` | 未触发（需 `/tree` 导航） | — | — | [仅静态] |
| `session_info_changed` | 未在 `-p` 触发（`pi.setSessionName()` 调了但事件没记到） | — | — | ⚠未验 |
| `model_select` | ✅（`-p` 启动时**不发**；`pi.setModel()` 才发） | `{model,previousModel,source:"set"}` | 无 | ✅ |
| `thinking_level_select` | ⚠ **有条件**：对 `reasoning:false` 的模型调 `pi.setThinkingLevel("medium")` → **事件不发、`getThinkingLevel()` 仍 "off"、零诊断**；换到 reasoning 模型后才补发 `{level:"medium",prev:"off"}` | `{level,previousLevel}` | 无 | ⚠有限制（静默钳位） |
| `message_start`/`message_update`/`message_end` | ✅ 均发 | `message_end` 给完整 AgentMessage | **`message_end` 返回 `{message}` 可整条替换**（角色必须一致，否则 runner 报错跳过）——**这是诚实降级的唯一出口**，见 §四 | ✅可用（关键） |
| `user_bash` | 未触发（需交互 `!` 前缀） | — | — | [仅静态] |

### 1.2 ExtensionAPI 方法（逐个真跑）

`pi` 对象实测暴露 26 个成员（`__EXT_LOADED` 日志）：`on/registerTool/registerCommand/registerShortcut/registerFlag/registerMessageRenderer/registerMarkdownTransformer/registerEntryRenderer/getFlag/sendMessage/sendUserMessage/appendEntry/setSessionName/getSessionName/setLabel/exec/getActiveTools/getAllTools/setActiveTools/getCommands/setModel/getThinkingLevel/setThinkingLevel/registerProvider/unregisterProvider/events`。

| 方法 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| `registerTool`（加载期） | ✅ 模型当场看得见 | `getActiveTools()` = `[read,bash,edit,write,gov_query]`；假端点收到的 `tools` 数组 = 同 5 个 | ✅ |
| **`registerTool`（运行期·不 reload）** | ✅ **下一次 provider 请求当场可见** | 在 `turn_end` 里 `registerTool("gov_runtime_tool")` → 紧随其后的 `before_provider_request` 的 tools 从 5 变 6：`[read,bash,edit,write,gov_query,gov_runtime_tool]` | ✅可用（很强） |
| `prepareArguments` | ✅ **在 schema 校验之前真跑，且真能救** | 假 LLM 发 `{"m":"gap_attribution","scope":"tenant-demo"}`（schema 要 `metric`）→ 垫片折成 `{metric,scope}` → `tool_call` 收到已修正的 input，`execute` 收到 `{scope,metric}`，工具正常返回 | ✅可用 |
| `renderCall` / `renderResult` | ✅ TUI 真生效 | pty+pyte 真屏截图：`◆◆ A4-RENDER-CALL 治理域查询: 外协比例 ◆◆` / `▓▓ A4-RENDER-RESULT 已按租户脱敏: RESULT-PLAIN-外协比例 ▓▓` 逐字上屏。⚠ `renderCall` 被调 **11 次**（每次重绘），必须无副作用 | ✅可用 |
| `registerCommand` + `getCommands` | ✅ | `getCommands()` = `["gov-status","llama"]`（`llama` 是内置扩展；**内置 slash 命令不在此列表**）。RPC 发 `/gov-status 参数abc` → handler 真跑，`args="参数abc"` | ✅ |
| `sendMessage`（默认） | ⚠ **在 `agent_end` 里调 = 自激无限循环** | 见 §四 G3。默认在 streaming 中走 `steer` → 触发新一轮 agent run。实测 1015 轮 / 999 次工具执行，直到 120s 超时被杀 | ⚠致命坑 |
| `sendMessage({deliverAs:"nextTurn"})` | ⚠ 不炸但**永不送达**（会话随即结束） | `-p` 模式日志 `sendMessage_nextTurn_ok` 后无任何输出，stdout 仍 `Request aborted` | ⚠有限制 |
| `sendUserMessage` | ❌ 在 `agent_end` 里**抛错** | `Extension error (<runtime>): Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.` | ❌（该时机） |
| `appendEntry` | ✅ 不抛错、落会话 | `appendEntry_ok`。但 **不进 LLM 上下文、不进 `-p` stdout**——纯 TUI/会话文件用 | ⚠有限制 |
| `setSessionName` / `getSessionName` | ✅ | `setSessionName("A4-治理会话")` → `getSessionName()` 回同值 | ✅ |
| `setLabel` | ✅ 且**坏 id 会抛错**（非静默） | `setLabel("no-such-entry-id","A4")` → `Entry no-such-entry-id not found` | ✅ |
| `exec` | ✅ | `pi.exec("echo",["A4-exec-ok"])` → `{code:0, stdout:"A4-exec-ok"}` | ✅ |
| `getActiveTools`/`getAllTools`/`setActiveTools` | ✅ | `getAllTools()` = 8 个（含未激活的 grep/find/ls） | ✅ |
| `registerFlag` / `getFlag` | ✅ | `--tenant demo --gov-strict` → `{tenant:"demo", strict:true}`。**这是把租户身份带进扩展的唯一 pi 原生通道** | ✅可用 |
| `setModel` | ✅ 立刻生效（甚至 agent run 中途） | `modelRegistry.getAll()` 返回 **1126 个模型**；`setModel(bedrock/nova-2-lite)` → `model_select` 发、下一轮请求真打到 bedrock（返回 `UnrecognizedClientException`） | ⚠可用但无护栏 |
| `setThinkingLevel` | ⚠ 静默钳位 | 见上表 | ⚠ |

### 1.3 ExtensionContext（逐个真跑）

`ctx` 实测 18 个键：`ui, mode, hasUI, cwd, sessionManager, modelRegistry, model, scopedModels, thinkingLevel, isIdle, isProjectTrusted, signal, abort, hasPendingMessages, shutdown, getContextUsage, compact, getSystemPrompt`。

| 项 | 实测 | 证据 | 判定 |
|---|---|---|---|
| **`ctx.ui.confirm` 在 `-p`** | ❌ **不弹，0ms 返回 `false`，零日志零提示** | `{"ev":"ui.confirm","result":false,"elapsedMs":0}`；源码 `runner.ts:237 confirm: async () => false`（`noOpUIContext`） | ❌不可用（静默 deny-all） |
| `ctx.ui.confirm` 在 TUI | ✅ 真弹对话框 | pty 真屏：`A4 人工审批门 / 放行 bash？(y/n) / → Yes / No`，选 No → 工具 0 次执行、转录显示 `TUI 审批未通过` | ✅ |
| **`ctx.ui.confirm` 在 RPC** | ✅ **真挂到外部客户端** | 服务端收到 `{"type":"extension_ui_request","id":"7a8c…","method":"confirm","title":"人工审批","message":"放行 bash: {\"command\":…}?"}`；回 `{"confirmed":false}` → 工具 0 次执行，模型收到 `isError:true` + 我的理由 | ✅可用（关键） |
| RPC confirm **无 timeout 且客户端不回** | ❌ **永久挂死** | 29s 无 `turn_end`/`agent_end`，事件流停在 `extension_ui_request` | ❌致命 |
| RPC confirm **带 `{timeout:5000}`** | ✅ 5s 后自动 resolve 为 `false`（fail-closed） | `{"ev":"confirm_result","ok":false,"elapsedMs":5002}` | ✅（必须显式传） |
| `ctx.abort()` | ✅ 真停 | 见 §四 G1 | ✅ |
| `ctx.isIdle()` | ✅ 但 `agent_end` 时仍为 `false` | `{"ev":"agent_end","isIdle":false}` | ⚠ |
| `ctx.signal` | ✅ `turn_end` 时可读，abort 后 `aborted:true` | `{"ev":"after_abort","signalAborted":true}` | ✅ |
| `ctx.getContextUsage()` | ✅ | `{tokens:305, contextWindow:128000, percent:0.238}` 逐轮增长 | ✅ |
| `ctx.compact()` | ⚠ **`-p` 里在 `turn_end` 调 = 整轮被中断** | stdout `Request aborted`、exit 1、**`session_before_compact` 完全没发、`agent_end` 也没发**（直接 `agent_settled`）。RPC 里同样调用则 4s 后才补发 compact 钩子 | ⚠有坑 |
| `ctx.fork` / `navigateTree` / `newSession` / `switchSession` / `waitForIdle` / `reload` / `getSystemPromptOptions` | ❌ 普通事件 ctx 上**全是 `undefined`**；✅ **只在 `registerCommand` 的 handler ctx 上存在** | 事件 ctx 探针：`{"fork":"undefined","newSession":"undefined",…}`；命令 ctx 探针：`{"fork":"function","navigateTree":"function","newSession":"function","switchSession":"function","waitForIdle":"function","reload":"function"}`，且 `ctx.newSession()` 真跑通（`session_before_switch`→`session_shutdown`→新 runtime→`{cancelled:false}`） | ✅（仅命令上下文） |
| `ctx.sessionManager` | ✅ 只读 API 丰富（49 个方法：`getBranch/getEntries/getTree/getLabel/buildSessionContext/getHeader/…`） | 原型链探针 | ✅ |
| **`ctx` 里的租户/用户** | ❌ **零存在** | 探针 `identityKeys: []`（对 18 个键做 `/user\|tenant\|ident\|auth\|princip\|role\|org/i` 匹配，`session_start`/`turn_end`/`agent_end`/工具 `execute` 四处均为空） | ❌不存在 |

### 1.4 扩展失败模式（**这一节推翻了我原以为的 "统一 fail-open"**）

| 场景 | 实测 | 证据 | 判定 |
|---|---|---|---|
| `tool_call` 里抛错 | **fail-closed（工具不执行）+ 零运维诊断 + 错误原文泄进模型上下文 + 后续扩展被跳过** | 0 次工具执行；stdout **没有** `Extension error` 行；模型收到的 tool 消息 = `"A4 故意抛错 · tool_call"`；扩展 B 的 `tool_call` 日志完全缺失。源码 `runner.ts:932 emitToolCall` **无 try/catch**，由 `agent-session.ts:476` 兜底 → `throw` → 阻断执行 | ⚠ 安全语义对（fail-closed），可观测性为 0 |
| `context` 里抛错 | fail-open，**有诊断** | stderr `Extension error (…/fail-a.ts): A4 故意抛错 · context`；A 的注入被丢弃（B 看到 `n:1` 而非 `n:2`），B 照跑，会话正常 exit 0 | ✅ |
| `turn_end` 里抛错 | fail-open，有诊断，B 照跑 | 同上 | ✅ |
| `tool_call` 里 hang（30s/45s） | ✅ **不超时、不中断，整个循环等它** | 45s 外部审批实测：`{"ev":"APPROVAL","decision":"APPROVE","waitedMs":43840}`，之后工具正常执行，pi exit 0，总耗时 45s | ✅（既是能力也是风险） |
| 两个扩展抢同一钩子 | ✅ 顺序 = `-e` 声明顺序，**链式传递** | `A.context(n=1)` → `B.context(n=2, lastText:"A4-MARK-FROM-A")`；`A.tool_call` → `B.tool_call(inputSeenFromA=…)`。`tool_call` 一旦有人 `block:true` 立即短路返回，后续扩展不再跑 | ✅确定性 |
| `before_provider_request` 返回错误形状 | ❌ **静默毁掉每一次请求 + 4 次重试 + 无扩展诊断** | 误返回 `{payload:{...}}` → 服务端 body 变成 `{"payload":{…}}` → `Stream ended without finish_reason`，exit 1，日志里同一轮 headers/payload 钩子重复 **4 次**（重试），全程无 `Extension error` | ❌高危 |

### 1.5 🔴 参数校验精确划环（主控点名要求：澄清"有校验"与"零校验"的矛盾）

**两条记录不矛盾，它们是两个不同的环。我用同一个严格 schema 的自定义工具把两环分别打穿了。**

探针 `<scratch>/a4-work/validate.ts` 注册工具 `gov_strict`，schema：
```ts
Type.Object({ metric: Type.String(), n: Type.Number({ minimum: 10 }) }, { additionalProperties: false })
```

**环① 模型侧实参（LLM → 工具）：✅ 有校验，拦得住，错误还回传给模型**
（假 LLM 直接发违规 arguments，扩展不做任何改动）

| LLM 发的 arguments | 结果 | 模型收到的 tool 消息（原文） |
|---|---|---|
| `{"metric":"gap","n":42}` | ✅ 放行，`execute` 收到 `{metric:"gap"(string), n:42(number)}` | — |
| `{"metric":"gap"}` 缺必填 | ❌ **拦住**，`tool_call` 钩子都没触发 | `Validation failed for tool "gov_strict": - n: must have required properties n` |
| `{"metric":"gap","n":1}` 违反 minimum | ❌ **拦住** | `- n: must be >= 10` |
| `{"metric":"gap","n":42,"extra":"x"}` 多字段 | ❌ **拦住** | `- root: must not have additional properties` |
| `{"metric":"gap","n":"NOT_A_NUMBER"}` string→number | ❌ **拦住** | `- n: must be number` |
| `{"metric":12345,"n":42}` number→string | ⚠ **静默强转**：`execute` 收到 `metric:"12345"`（typeof **string**），`isError:false` 照常执行 | 无任何提示 |

→ **校验发生在 `tool_call` 钩子之前**（拦住的用例连 `tool_call` 日志都没有）。**A5 的"有校验且拦得住"成立，number→string 静默强转的洞也成立**（我复现了）。

**环② 扩展 mutate 之后（`tool_call` 里改 input → 工具）：❌ 零重校验，一条都拦不住**
（LLM 一律发合法参数 `{"metric":"gap","n":42}`，由扩展在 `tool_call` 里改坏）

| 扩展改法 | 环①同样的违规会被拦吗 | 环②实际结果（`execute` 真收到） | `isError` |
|---|---|---|---|
| `n="NOT_A_NUMBER"; metric=12345` | 环①拦 / 环①强转 | `{metric:12345(**number**), n:"NOT_A_NUMBER"(string)}` —— **连强转都不做了** | `false` |
| `delete input.n`（删必填） | 环①拦 | `{metric:"gap"}` 直达 | `false` |
| `input.__evil={x:1}`（多字段） | 环①拦 | `{metric,n,__evil:{x:1}}` 直达 | `false` |
| `input.n=1`（违反 minimum） | 环①拦 | `{metric:"gap", n:1}` 直达 | `false` |

**结论（可直接引用）：**
> pi 的契约校验是**单向阀**：只校验模型给的参数，**不校验扩展改过的参数**。
> `tool_call` 钩子在校验之后、执行之前，**处于契约保护区之外**。
> 对我们 R1「契约层不可绕过」的判断：**在 pi 上 R1 不成立**——任何一个扩展（含第三方扩展、含被 A 改过再被 B 看到的链式改写）都能把任意脏值送进工具执行体，且 pi 一个字都不会说。若基于 pi 开发，**每个 mutate input 的位置都必须自己 `zod.safeParse` 再写回**，这是纪律不是机制，纪律会被忘。

补充（内置 bash 工具上的同一实验，说明后果的严重性）：`command=12345` → `/bin/bash: line 1: 12345: command not found`；`delete input.command` → `/bin/bash: line 1: undefined: command not found`。**脏值不是"绕过校验"，是"字符串化后直接进 shell"。**

### 1.6 官方示例的完成度核查（主控转 A3 线索）

`<pi2>/packages/coding-agent/examples/extensions/` 共 70+ 个示例。逐条核如下：

| 示例 | 行数 | 是骨架还是完整实现 | 真跑结果 | 判定 |
|---|---|---|---|---|
| **`permission-gate.ts`** | **34 行 · 骨架 demo** | 只做正则匹配 3 个危险模式（`rm -rf`/`sudo`/`chmod 777`）→ `ctx.ui.select("Allow?", ["Yes","No"])` | ✅ **真跑通**。TUI 真屏：`⚠ / rm -rf /tmp/a4-danger-1; echo done / Allow? / → Yes / No`，选 No → 命令未执行。`-p` 下：危险命令**未执行**，模型收到 `Dangerous command blocked (no UI for confirmation)`；同一扩展下非危险命令**正常执行** | ✅可用但**不是审批系统** |
| `confirm-destructive.ts` | 61 行 | 骨架，演示 `session_before_switch`/`session_before_fork` 的 `{cancel:true}` | 未跑（机制我已单独验过） | [仅静态] |
| **`subagent/`** | **1015 + 126 行 · 完整实现** | `spawn` 子 `pi` 进程（`--mode json`）、解析 `message_end` 事件流、聚合 usage（turns/input/output/cacheRead/cost）、single/parallel(`MAX_PARALLEL_TASKS=8`,`MAX_CONCURRENCY=4`)/chain 三模式、`PER_TASK_OUTPUT_CAP=50KB`、响应 abort signal、TUI 渲染。agent 定义 = `.md` frontmatter（name/description/tools/model/systemPrompt） | 未端到端跑（需真模型 + agent 定义文件），**代码完整度已逐段核过** | [声明放弃]+完整自建参考 |
| **`sandbox/`** | **321 行 · 完整实现** | 用 `@anthropic-ai/sandbox-runtime`（Linux=bubblewrap，macOS=sandbox-exec）**替换内置 bash 工具**；配置文件 `~/.pi/agent/extensions/sandbox.json` + `<cwd>/.pi/sandbox.json` 合并；默认 `denyRead:[~/.ssh,~/.aws,~/.gnupg]`、`denyWrite:[.env,*.pem,*.key]`、域名白名单 | 未跑（需 `npm install` + 本机 bubblewrap/socat/ripgrep，本环境无） | [声明放弃]+完整自建参考 |
| **`custom-compaction.ts`** | 131 行 · 完整实现 | **与我测的 `session_before_compact` 是同一机制**：返回 `{compaction:{summary,firstKeptEntryId,tokensBefore,usage}}` 完全接管；示例还演示用另一个模型（Gemini Flash）做摘要 + `ctx.modelRegistry.getApiKeyAndHeaders/complete` | 机制我已真跑（见下） | ✅同一机制 |

**口径冲突核查结论：README 与示例不矛盾，README 措辞是精确的。**
- `README.md:497` 原文：**"No sub-agents.** There's many ways to do this. Spawn pi instances via tmux, or **build your own with extensions**, or install a package that does it your way."
- `docs/usage.md:301` 原文：**"It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash. You can build or install those workflows as extensions or packages…"**
- `docs/security.md:31-35`：**"No Built-in Sandbox … This is intentional."** 并明说"部分的进程内沙箱容易被误当成安全边界；真隔离必须来自操作系统或虚拟化/容器边界"。

→ 三处口径一致：**核心 `[声明放弃]`，示例目录提供"自己建"的参考实现**。`subagent/`（1015 行）和 `sandbox/`（321 行）是**完整实现**不是 demo；`permission-gate.ts`（34 行）是**骨架 demo**。
→ ⚠ **对我们最关键的一条：pi 把 "permission popups" 明确列在"故意不做"的清单里。** 也就是说我们的 S2 审批门在 pi 这里**没有官方能力，只有官方示例**，而那个示例（34 行）**没有任何"等人批"的机制**——它只能同步弹窗，`-p` 下直接 block。**"pi 有 permission-gate 所以审批门有着落"这个推论不成立。**

### 1.7 上下文控制权：扩展可以**完全接管**压缩与分支摘要（主控转 A3 线索，我真跑了）

比 `context` 注入强得多，两处都验到了 `fromExtension: true`：

| 机制 | 返回形状 | 实测 |
|---|---|---|
| `session_before_compact` 完全接管 | `{compaction:{summary, firstKeptEntryId, tokensBefore, usage?}}` | ✅ 我返回一句 **12 个字的垃圾摘要** `"A4-TAKEOVER-摘要：垃圾。"` → RPC 回 `{"success":true,"data":{"summary":"A4-TAKEOVER-摘要：垃圾。","tokensBefore":605,"estimatedTokensAfter":35}}`；`session_compact` 事件 `fromExtension:true`；**压缩后下一轮 `context` 的第一条消息就是 `{"role":"compactionSummary","summary":"A4-TAKEOVER-摘要：垃圾。","tokensBefore":605}`，原文已丢**。→ **扩展侧同样是"出口零校验"**（与主控测到的内置压缩出口零校验同构） |
| `session_before_tree` 完全接管 | `{summary:{summary,details?,usage?}, customInstructions?, replaceInstructions?, label?}` | ✅ 从命令上下文 `ctx.navigateTree(targetId,{summarize:true,customInstructions:"原始指令",label:"原始标签"})` → `session_before_tree` 收到 `preparation{targetId,oldLeafId,commonAncestorId,entriesToSummarize:5,userWantsSummary,customInstructions,label}` → 我返回自定义 summary → `session_tree` 事件 `fromExtension:true, summary:"A4-TREE-TAKEOVER 分支摘要（扩展全权接管）"`（默认摘要 `"The user explored a different conversation branch…"` 被完全替换） |

**对我们的含义（双刃）**：这是**唯一能把"压缩必须过红线守恒检查"做进去的位置**（正面）；同时也意味着**任何一个装进来的第三方扩展都能悄悄改写会话历史且无人校验**（负面，直接冲击我们的结论溯源）。

---

## 二、我方对照

| pi 的能力 | 我方是否有 | 我方实现位置 / 证据 | 谁强 |
|---|---|---|---|
| `tool_call` 前置拦截（block + reason） | ✅ 有且更厚 | `apps/agentcore/src/tools/executor.ts:91` `GuardedToolExecutor.run()`：scope 门(0) → objectType 门(0.1) → **OBO token 剩余 <60s 拒开新调用**(0.5) → IAM `check()`(1) → discover 专用配额(2.0) → 通用预算(2) → dispatch(3) → `expectsObjectType` **出参本体校验** | **我方**（pi 只有一道 hook，无 IAM/无出参校验） |
| 工具参数校验 | ✅ zod 契约层，改完必过 | `packages/contracts` + executor 内 `expectsObjectType` 运行时强制 | **我方**（pi 是 `prepareArguments` 之后**零重校验**） |
| 预算 | ✅ **7 维** | `apps/agentcore/src/tools/budget.ts` `BudgetTracker`：`maxDurationMs / maxToolCalls / maxSolverCalls / maxIterations / maxDiscoverCalls / maxRoundTrips / perToolCallCap`（+ `toolCallCounts` 逐工具计数 + `exhaustedReason` 溯源） | **我方**（pi 一维都没有，只能自己在 `turn_end` 数） |
| 硬迭代上限 | ✅ 循环内置 | `apps/agentcore/src/agent/loop.ts:734-739` 每轮迭代前查 `budget.exhausted/roundTripsExceeded/durationExceeded` → `degrade()` | **我方**（pi 需扩展自建，见 §四 G1） |
| 诚实降级 | ✅ **一等公民** | `loop.ts` 里 **11 处** `degrade(...)` 出口：`BUDGET_EXHAUSTED / TIMEOUT / STALL_LOOP / FAILED / ANSWERED`，带 `exhaustedReason` 溯源、确定性（R6 无时钟/随机） | **我方**（pi 里这是"改写 assistant 消息"的偏方，见 §四 G4） |
| 人工审批门 | ✅ 完整审批链 | `apps/datacore/src/actions.ts:408+` `DRAFT→PENDING_APPROVAL→APPROVED→EXECUTING`，1–3 步 `approvalChain`、**自审批守卫**（每步 role 的批准人 ≠ 发起人）、`action.pending_approval` 事件、失败/拒绝计量 | **我方**（pi 的 `ui.confirm` 只是"一次性弹窗"，无链、无角色、无持久化） |
| 诚实失败（未接线动作） | ✅ | `actions.ts:81` `UnwiredActionExecutor`：`NOT_IMPLEMENTED → ok:false`；`NO_WRITE → targetRef:"NO_WRITE:<key>"` **自证没写入**，绝不产假 MO 单号（G-ACTION-NOOP-EXEC） | **我方**（pi 无此概念） |
| 行级权限过滤 | ✅ 取数时过滤 | DataCore A6 行级过滤 + executor 走 OBO 用户 JWT | **我方**（pi 的 `tool_result` 是**执行后事后脱敏**——数据已被读出来了，只是没给模型看，语义完全不同） |
| Entitlement（功能关闭=不存在） | ✅ | `apps/agentcore/src/features/gate.ts` + datacore `features.ts`，404 `FEATURE_NOT_FOUND` | **我方**（pi 可用 `tool_call` block 模拟，但无 404 语义、无 registry） |
| 多租户 `tenant_id everywhere` | ✅ 全链路 | 所有仓储读写/事件/缓存键带 tenantId，跨租户 403/404 | **我方压倒性**（pi 零存在） |
| 运行期动态注册工具 | ❌ 我方无（工具集在 registry 里静态解析 + entitlement 前置过滤） | — | **pi**（`registerTool` 运行期即时可见，不 reload） |
| 自定义工具渲染 | ❌ 我方前端自己写 renderer 分发（PRD-frontend §7） | — | 平手（关注点不同） |
| provider 请求头/体改写钩子 | ⚠ 我方有 LLM adapter 层但无"每次请求可插手"的统一 hook | `packages/llm-adapters` | **pi**（`before_provider_headers/request` 是很干净的切面） |
| 压缩可否决 | ❌ 我方无压缩（走 `context.ts` 自己组上下文） | — | **pi**（`session_before_compact` 可 cancel、可自定义摘要） |
| 会话树 / fork / navigateTree | ❌ 我方无 | — | **pi** |

---

## 三、我方没有、pi 有的 —— 逐条判价值

| 能力 | 对我们的价值 | 理由（结合多租户/审批/溯源/确定性约束） | 建议 |
|---|---|---|---|
| **运行期 `registerTool`（不 reload 即可见）** | 高 | 我们的 A4 本体/求解器是**租户自注册**的（`registerType`、solver 新增即改 golden）。现在新增对象类型/求解器要重启或重建 registry；pi 这套"注册即下一轮可见"正好治这个。且 `getAllTools()/setActiveTools()` 让 entitlement 可以**动态收放工具集**而非启动时定死 | **值得学不取代码**（学机制，工具仍须过我们的 entitlement + zod） |
| **`prepareArguments`（schema 校验前的兼容垫片）** | 高 | 我们踩过 `PRD-seam-arg-drop-audit` 那类"参数在接缝掉了"的坑。一个**显式的、在校验前的**归一化钩子，比在 zod schema 里堆 deprecated 字段干净得多，而且**保持公开契约严格** | **立即取**（在 GuardedToolExecutor 的 dispatch 前加一层 `prepareArguments(toolName, raw)`，垫片本身也要单测） |
| `before_provider_headers` / `before_provider_request` 切面 | 中高 | 我们的多 LLM 供应商路由 + 凭据 AES-GCM + `no-secrets-echo` 需要"每次请求前统一插手"的位置（注入 tenant 追踪头、脱敏、审计整包）。pi 这两个钩子的**签名设计**（headers 就地改 / payload 返回即替换）值得抄 | **值得学不取代码**（注意：返回值形状必须严格类型化，否则重演 §一.4 那个静默毁请求的坑） |
| `session_before_compact` 可 cancel / 可自定义摘要 | 中 | 主控已验 pi 压缩**出口零校验**（8 字垃圾摘要原样注入且原文永久丢弃）。但**"压缩前必须过一道守恒检查、不过就否决"这个门的形状**正是我们需要的（对应我们的红线守恒 / 不变量 R1–R12） | **值得学不取代码** |
| **`ctx.ui.*` 的 RPC 子协议（`extension_ui_request`/`extension_ui_response`）** | **高** | **这是 pi 唯一能接我们 S2 审批门的东西**：进程内一个 await，外部一个 JSON 往返，把"等外部批准"变成同步调用。实测 **180 秒**外部延迟应答稳、拒绝路径干净。桥接方式：`tool_call` → AgentCore 收到 `extension_ui_request` → 建 ActionDraft 走 1–3 步 `approvalChain` → 回 `extension_ui_response`。⚠ 必须传 `{timeout}`（否则永久挂死），且**只能承载分钟级同步审批** | **必须取**（若基于 pi 开发）；否则**值得学不取代码** |
| `subagent/` 示例的"进程即 agent"编排范式 | 中高 | pi 明写 `[声明放弃]` 内置子 agent，但给了 **1015 行完整参考实现**：`spawn` 子 pi + `--mode json` 事件流 + usage 聚合 + 并发上限 + abort 传播。这与我们的多 agent 编排（B1 Agent / B2 Workflow）是**不同范式**：我们是进程内共享 `BudgetTracker` 的编排，它是"每个子 agent 一个 OS 进程、靠 JSON 事件流回收结果"。**它的隔离性天然解决了上下文污染，但预算/租户要靠 IPC 自己传** | **观望**（范式值得看；但共享 7 维预算 + tenant 透传在它这套里要重做） |
| `registerFlag` / `getFlag` | 中 | 如果走"一租户一进程"，这是把 `tenantId/userId/roles` 注进扩展的最干净入口（比 env 有类型、有 default、在 `--help` 里可见） | **立即取**（若基于 pi） |
| 会话树 / fork / navigateTree / 分支摘要 | 低 | 我们是"一次查询编排一条链路 + SSE"，没有交互式分支需求；引入会话树反而让溯源（结论→证据→事件）多一个维度要对齐 | **不要** |
| `renderCall` / `renderResult` 自定义渲染 | 低 | 我们的渲染在 React 前端（PRD-frontend §7 renderer 分发），TUI 组件树对我们无用 | **不要** |
| `setModel` 运行期换模型（1126 模型目录） | 低-中 | 模型目录本身有参考价值；但"agent run 中途换模型、无护栏、立刻生效"与我们的**确定性种子**（同输入同参数版本同输出）直接冲突 | **观望**（目录可参考，机制不要） |
| `project_trust` | 低 | 我们没有"信任本地项目目录"的威胁模型（数据从 DataCore REST 来，不从 cwd 来） | **不要** |

---

## 四、🔴 治理重建可行性 —— 核心交付

我用扩展真写了一个「最小治理层」`<scratch>/a4-work/gov-layer.ts`（约 100 行），把我们 8 条治理逐条重建并**跑通**。一次运行的真实 stdout（`A4_CAP=3 A4_TENANT=demo`，假 LLM 无限发工具调用）：

```
pi EXIT=0
【诚实降级 · 未完成】触发：迭代上限 3 轮
已完成 4 轮、3 次工具调用、拦截 0 次、入 600 / 出 30 tokens、耗时 255ms。
以下为已验证的部分结论（未覆盖的部分明确未知）：
  - t+118ms 执行 bash
  - t+179ms 执行 bash
  - t+239ms 执行 bash
=== tools executed: 3
```
（同一份扩展在 `--mode json` 下也验过：外部消费者收到 `message_end` / `stopReason:"stop"` / 携带同一段降级文本 → 服务端可消费。）

### G1 硬迭代上限 —— ✅ **能**

`turn_end` + `ctx.abort()`。假 LLM 每轮都发工具调用、永不收尾，CAP=3：
```
turn_end #1 tools=1 aborted=false
turn_end #2 tools=2 aborted=false
turn_end #3 tools=3 aborted=false → CAP_HIT_ABORT
turn_start #4 → turn_end #4 tools=3 aborted=true   ← 这一轮工具没执行
agent_end → agent_settled → session_shutdown
```
**真停了**（3 次工具执行封顶）。
> ⚠ 三个必须知道的细节：① abort 后**还会多跑一个空 turn**（turnIndex 3），计数器要按此校准；② 裸 abort 的用户可见结果是 stderr `Request aborted` + **exit 1**，必须配 G4 才算"诚实"；③ 主控的结论在扩展层同样成立——**`tool_call` 的 `block:true` 拦工具不拦循环**：我用 entitlement 拒 bash，5 轮全被拒，循环照跑 5 轮（`ENTITLEMENT_DENY` ×5，工具 0 次执行）。**上限必须挂 `turn_end`，不能指望 block。**

### G2 人工审批门 —— ✅ **能，但只有两种形态且各有硬约束**

**形态 A · 扩展内异步等外部（推荐给服务端）**：在 `tool_call` 里 `await` 到外部系统回写。实测**等 45 秒无任何内部超时**：
```
{"ev":"APPROVAL","decision":"APPROVE","waitedMs":43840,"tool":"bash"}   → 工具随后正常执行，pi exit 0
```
拒绝路径：`return {block:true, reason:"..."}` → 工具 0 执行，模型收到 `isError:true` + 我们的理由原文（假端点实收 `"FEATURE_NOT_FOUND: bash 未对租户 demo 开放"` ×5）。
**异步等待不会把循环卡死，也不会超时。** 但它**独占整个 agent 循环**——审批期间这个 session 什么都干不了（并行工具调用同样被串住）。我们的审批链是"落库后异步、可跨天"，直接搬会把一条 SSE 连接挂几小时。**结论：pi 的审批门只能承载"分钟级同步审批"，跨天审批必须在 pi 之外做（先落 ActionDraft → 返回"已提交待批"给用户 → 另一次运行再执行）。**

**形态 B · `ctx.ui.confirm` / `ctx.ui.select` 的 RPC 子协议（主控点名要求真跑，已跑）**

这是"自建审批闸门"的真正挂载点，我用一个独立 Python 进程（`<scratch>/a4-work/rpc-drive.py`）当外部驱动方，全链路跑通：

| 问题 | 实测答案 | 证据 |
|---|---|---|
| `--mode rpc` 下 `ctx.ui.confirm` 是否走子协议 | ✅ 是 | 外部进程 stdout 收到 `{"type":"extension_ui_request","id":"7a8c8053-…","method":"confirm","title":"人工审批","message":"放行 bash: {\"command\":…}?"}`；`ctx.mode==="rpc"`、`ctx.hasUI===true` |
| 外部方能否接住并**延迟应答** | ✅ 能 | 回 `{"type":"extension_ui_response","id":"7a8c…","confirmed":false}` → 工具 **0 次执行**，模型收到 `isError:true` + 我的理由 |
| **延迟能撑多久** | ✅ **实测 20s / 180s（3 分钟）都稳**，无任何内部超时 | 3 分钟档：`{"ev":"confirm_result","ok":true,"elapsedMs":180003}` → 随后工具正常执行、`agent_end` 正常到达。另一条路径（不用 confirm、在 `tool_call` 里自己 `await` 轮询外部文件）实测 **43.8s** 同样稳 |
| 等待期间循环是卡死还是挂起 | **挂起（正确行为）**：整个 agent 循环停在那儿等，不是死锁也不是超时；但**这个 session 期间干不了别的** | 3 分钟里事件流一条不发，恢复后 `turn_end`/`agent_end` 正常 |
| ⚠ 长等待的副作用 | **provider HTTP 连接会变陈** | 180s 档的事件统计里出现 `auto_retry_start`，且最终 assistant 消息 `content:[]`、`usage` 全 0 —— 长按住之后的下一次 provider 请求触发了自动重试。生产上意味着**长审批会多烧一次 provider 调用，或在真 provider 上直接失败** |
| 客户端**永不应答**且未传 timeout | ❌ **永久挂死** | 29s 内无 `turn_end`/`agent_end`，事件流停在 `extension_ui_request` |
| 传 `{timeout: 5000}` | ✅ 5s 后自动 resolve 为 `false`（fail-closed） | `{"ev":"confirm_result","ok":false,"elapsedMs":5002}` |
| 与 `-p` 的差别 | **天壤之别** | `-p` 下 `ctx.hasUI===false`，`ctx.ui.confirm` **0ms 静默返回 `false`**（`runner.ts:237` `noOpUIContext.confirm: async () => false`）——不弹窗、不报错、不写日志。写成 `if(!await ctx.ui.confirm(...)) block` 的扩展在 `-p` 下退化成 **deny-all**，表现为"agent 什么都干不了"且零线索。官方 `permission-gate.ts` 的写法说明了正确姿势：**先查 `ctx.hasUI`，无 UI 就直接 block** |
| TUI | ✅ 真弹（pty 真屏截图为证），选 No → 工具 0 执行、转录显示我的拒绝理由 | — |

**给我方的可落地结论**：若基于 pi 做 S2 审批，**运行模式必须是 `--mode rpc`，AgentCore 当那个"外部驱动方"**：收到 `extension_ui_request` → 建 ActionDraft → 走我们既有的 1–3 步 `approvalChain` → 批完回 `extension_ui_response`。**三分钟量级已实测可行**；但**跨天审批不能这么做**（连接陈化 + 一个 SSE 连接挂几小时），必须改成"先落草稿、当次返回『已提交待批』、批准后另起一次运行"。

### G3 诚实降级 —— ⚠ **能，但只有一条非直觉的通道；四种"自然写法"全部失败**

这是本次评估**风险最高**的一条。我把四种想得到的写法全试了：

| 写法 | 结果 | 证据 |
|---|---|---|
| `agent_end` + `appendEntry` | ❌ 调用方**什么也看不到** | stdout 仍 `Request aborted`，exit 1；`appendEntry` 不进上下文也不进 stdout |
| `agent_end` + `sendMessage`（默认） | 💥 **自激无限循环** | `agent_end` 时 `isStreaming===true` → 默认走 `steer` → **起了一整轮新 agent run**。实测跑到 **1015 轮 / 999 次工具执行**，被 120s 超时杀掉 |
| `agent_end` + `sendMessage({deliverAs:"nextTurn"})` | ❌ 不炸但永不送达 | 会话随即结束，stdout 仍 `Request aborted` |
| `agent_end` + `sendUserMessage` | ❌ 抛错 | `Extension error (<runtime>): Agent is already processing. Specify streamingBehavior…` |

**唯一可行解：在 `message_end` 里把那条 `stopReason:"aborted"` 的 assistant 消息整条替换掉**——换 content 为降级文本、把 `stopReason` 改成 `"stop"`：
```ts
pi.on("message_end", async (e) => {
  if (e.message.role !== "assistant") return;
  if (!degradeReason || (e.message.stopReason !== "aborted" && e.message.stopReason !== "error")) return;
  return { message: { ...e.message, content: [{type:"text", text: 降级文本}], stopReason: "stop", errorMessage: undefined } };
});
```
实测：**pi exit 0 + 降级文本真上 stdout**（见本节开头），`--mode json` 下外部消费者也收到。

**代价 / 风险（必须写进任何基于 pi 的设计）**：
1. 这不是 API，是**利用 print-mode 只打印"最后一条非 error assistant 消息"的实现细节**（`print-mode.ts:130-140`）。pi 改这段实现，我们的诚实边界就静默失效——典型的"绿测试≠能用"陷阱。
2. 改完 `stopReason` 后，**中断与正常完成在协议层无法区分**了。必须自己在 payload 里留显式标记（我用了「【诚实降级 · 未完成】」前缀 + `appendEntry` 审计条目双写）。
3. pi 没有 `degrade()` 那样的**枚举化降级原因**。我们 `loop.ts` 有 11 处出口、`exhaustedReason` 可溯源；pi 里这些全要自己维护在扩展的闭包变量里，**不持久、不进事件流、跨进程即丢**。

### G4 多租户 —— ❌ **不能。这是唯一真正过不去的一条。**

实测：`ctx` 的 18 个键里对 `/user|tenant|ident|auth|princip|role|org/i` 匹配 **结果为空**（`session_start` / `turn_end` / `agent_end` / 自定义工具 `execute` 四处都验过，`identityKeys: []`）。pi 的整个类型系统里 tenant/user 是零存在——它的世界观是"**一个人、一台机器、一个 cwd**"。

扩展只有三条路知道"当前是谁"：
1. **进程环境**（`process.env.A4_TENANT`）——实测可用，我的 `gov-layer.ts` 就这么干的。
2. **`pi.registerFlag("tenant", {type:"string"})` + `getFlag()`**——实测可用（`--tenant demo` → `getFlag("tenant")==="demo"`），比 env 干净。
3. `before_provider_headers` 注入下游头——实测 `X-Tenant-Id` / `X-Debug-User` / `Authorization: Bearer OBO-…` **真到达服务端**，可以把 OBO 透传给受管网关。

**这三条的共同前提是：一个 pi 进程 = 一个租户 = 一个用户。** 也就是说**「tenant_id everywhere」在 pi 里只能靠进程隔离实现，不能靠数据隔离**。后果要摊开讲：
- 多租户并发 = 多进程（内存/启动成本 ×N，我们现在是单 AgentCore 进程多租户并发）；
- **一旦有人在同一进程里跑两个租户，pi 一层拦不住**——没有任何 API 会告诉你"这条工具调用属于谁"；跨租户 403/404 这条铁律在 pi 层面**无处可挂**；
- 我们的缓存键/事件/仓储都带 tenantId，pi 的 sessionManager / 会话文件 / trust.json **全都不带**，会话文件本身就是一个跨租户泄漏面。

### G5 Entitlement —— ✅ 能（`tool_call` block + `setActiveTools`）
拒绝理由原文送达模型（假端点实收 ×5）。更好的做法是 `setActiveTools()` 让关闭的功能**根本不出现在 tools 数组里**（= 我们的"功能关闭=不存在"语义），实测 `getActiveTools/setActiveTools` 可用。

### G6 行级过滤 —— ⚠ 能，但**语义降级**
`tool_result` 改写实测真生效（假端点收到的 tool 消息里 `SECRET` 行已变成「[已按行级权限过滤]」）。**但这是执行后的事后脱敏**：数据已经被工具读出来、进过进程内存、可能进过日志。我们的 A6 是**取数时**按行过滤。基于 pi 时，行级权限必须仍然由 DataCore 侧完成，`tool_result` 只能当第二道网，**不能当第一道**。

### G7 参数重校验 —— ❌ **单向阀：只校验模型给的，不校验扩展改的**
见 §一.5 的两环实测。对我们（zod 契约层 / R1「契约层不可绕过」）的含义：
- 环①（模型→工具）**有校验且够硬**（required/minimum/additionalProperties/不可强转的类型全拦，错误原文回传模型）——这一半可以信；
- 环②（扩展 mutate→工具）**零重校验**，环①拦得住的四类违规在环②一条都拦不住，`isError` 仍是 `false`；
- 所以 **R1 在 pi 上不成立**：`tool_call` 钩子位于校验之后、执行之前，是契约保护区**外**的一段。我们如果在 pi 上挂治理扩展，**每个改写 input 的位置都必须自己 `zod.safeParse` 再写回**——这是纪律不是机制；
- 叠加"多扩展链式改 input"（B 看到 A 改过的 input）**谁都不负责最终形状**，尤其危险；
- 另有一个**环①自己的洞**：number→string 静默强转（`metric:12345` → `"12345"`，`isError:false`）。我们如果把"参数类型"当成语义信号（比如 `orderRef` 必须是外部单号字符串），pi 会把一个数字悄悄变成看起来合法的字符串。

### G8 结论溯源 —— ⚠ 半能
`appendEntry` 可以把审计条目落进会话文件（实测不抛错），`sessionManager` 只读 API 丰富（`getBranch/getEntries/getTree`）。但：不进 LLM 上下文、不进 `-p` stdout、**没有 tenantId**、没有我们的 `requestId` 错误信封。真溯源仍必须落我们自己的库。

### G9 上下文/历史的完整性 —— ❌ **扩展可无校验地重写会话历史**
见 §一.7。`session_before_compact` / `session_before_tree` 都能被扩展**完全接管**（实测 `fromExtension:true`），我用 12 个字的垃圾摘要替换掉 605 tokens 的原文且**原文永久丢失**、pi 零校验零告警。这对"结论溯源"是直接冲击：**任何装进来的扩展都能改写证据链**。反面用法则是我们唯一的机会——把"压缩必须过红线守恒/不变量检查"挂在这里。

### 🧾 一句话判决

> **如果基于 pi 开发：治理的"控制面"（上限 / 审批 / entitlement / 脱敏 / 降级）能用扩展 API 原样重建，我已跑通；但"身份面"（多租户）重建不了，只能退化成进程隔离。**
> 而且重建出来的控制面里，**最关键的诚实降级依赖一个实现细节而非公开 API**，**审批门只在 `--mode rpc` 下存在**，**契约屏障对扩展这一侧是敞开的**——三条都正好落在我们已经吃过大亏的那类脆弱点上（"绿测试≠能用·断在接缝"）。
>
> 所以我的建议是：**pi 作为"交互式研发/运维终端"取，作为"生产 agent 运行时底座"不取。** 若仓主坚持底座路线，最低门槛是给 pi 提**四个** upstream PR 并被接受：
> (a) `ExtensionContext` 上开一个 `principal`/`identity` 插槽；
> (b) 一个正式的 `agent_degrade` / `finalMessage` API，取代"改写 aborted 的 assistant 消息"；
> (c) `tool_call` 之后对 `event.input` 做 schema 重校验（哪怕是 opt-in 的 `revalidate: true`）；
> (d) `ctx.ui.confirm` 在 `hasUI===false` 时**抛错或返回 `undefined`**，而不是静默 `false`。
> 四条都不进主线，就不要把治理压在扩展 API 上。
>
> **退一步的中间路线（我认为最现实）**：不把 pi 当底座，而是把 pi 当**受管的执行沙盒**——AgentCore 仍然是编排/治理/溯源的主体，按"一租户一 pi 进程 + `--mode rpc` + `registerFlag` 注入身份 + `before_provider_headers` 透传 OBO"的方式把 pi 当成一个可控子进程调用（这正是 `subagent/` 示例的范式）。这样上面 4 条缺陷都退化成"进程边界内的局部问题"，不再是治理的单点。

---

## 五、越界线索（边界外发现，交主控）

1. **`-p` 模式的 `input` 事件把 `source` 报成 `"interactive"`**（RPC 下才是 `"rpc"`）。`src/modes/print-mode.ts` 调 `session.prompt()` 时没传 source。任何"按来源做策略"的扩展在 `-p` 下会走错分支。→ 属 A3/harness 边界。
2. **provider 请求失败会静默重试 4 次**（我误返回错误 payload 时，同一轮 `before_provider_headers`/`before_provider_request` 各触发 4 次，全程只有一句 `Stream ended without finish_reason`）。**扩展层的预算计数会因此漏计 3 次真实 provider 调用**——任何按 `turn_end.message.usage` 计费/计预算的方案都会低估。→ 属 A2 agent-loop 边界，建议主控让 A2 确认重试次数与是否可配。
3. **`ctx.compact()` 在 `-p` 的 `turn_end` 里调用会直接中断整轮**（stdout `Request aborted`、exit 1、`session_before_compact` 与 `agent_end` 都不发）。同样调用在 RPC 下则 4s 后正常补发 compact 钩子。疑似 print-mode 生命周期与 compaction 抢占。→ 属 A3。
4. **`modelRegistry.getAll()` 返回 1126 个模型**，其中含 `amazon-bedrock/anthropic.claude-fable-5`、`claude-opus-4-6-v1`、`claude-opus-4-7` 等条目。若主控要做"模型目录"对照，这份内置 catalogue 是现成素材。
5. `pi.getCommands()` 在扩展里**只返回扩展命令**（`gov-status`、`llama`），**内置 slash 命令一个都不在**。若有人想做"命令白名单治理"，这个 API 覆盖不到内置命令。
6. **RPC 协议没有 `exit` 命令**：我发 `{"type":"exit"}` 得到 `{"success":false,"error":"Unknown command: exit"}`。若 AgentCore 要把 pi 当子进程管理，**优雅退出只能靠信号**（`SIGTERM`/`SIGHUP`，print-mode 注册了这两个）。→ 属 A5/RPC 边界。
7. **长时间挂起后 provider 连接会陈化触发自动重试**：180s 审批那次事件流里出现 `auto_retry_start`，且最终 assistant 消息 `content:[]` / `usage` 全 0。可能与我的假端点关连接有关，**没能定因**，但若属实则"长审批 = 多烧一次 provider 调用"。→ 建议主控派人在真 provider 上复核（属 A2 重试策略边界）。

---

## 六、我没能验证的（诚实列出）

1. **`user_bash`** —— 未触发。需要 TUI 里 `!`/`!!` 前缀，我的 pty 脚本没跑到这一步。
2. **`session_info_changed`** —— `pi.setSessionName()` 调用成功且 `getSessionName()` 回读正确，但**没记到该事件**。不确定是"`-p` 下不发"还是"我的探针注册晚于触发"。**没验就是没验，不当作 [有但无效]。**
3. **`resources_discover` 的返回值**（`skillPaths/promptPaths/themePaths` 真能不能加载外部技能）—— 只验了事件会发、载荷是什么，返回值链路没验。
4. **`before_agent_start` 的返回值**（注入 message / 换 systemPrompt）—— 只验了事件会发和载荷，返回值没验。
5. **`session_before_switch` / `session_before_fork` 的 `{cancel:true}`** —— 事件确认会发，cancel 路径没单独验（`session_before_compact` 的 cancel 已验真生效）。
6. **多扩展在 `tool_call` 里"前一个改 input、后一个 block"的组合语义** —— 顺序和链式传递验了，这个具体组合没构造。
7. **`registerProvider` / `unregisterProvider` / `registerShortcut` / `registerMessageRenderer` / `registerMarkdownTransformer` / `registerEntryRenderer`** —— 只确认了 API 存在（`typeof === "function"`），**没真跑**。
8. **审批门在真并发下的行为** —— 我的审批测试都是单工具串行。pi 默认 parallel 模式下"兄弟工具调用先串行 preflight 再并发执行"（docs 原文），**多个工具同时等审批**会怎样没验，这对我们的并行 READ 轮是关键问题。
9. **长会话/大上下文下 `turn_end.message.usage` 的准确性** —— 我的假端点自报 usage，没有对真 provider 验证过累加口径（cacheRead/cacheWrite 是否重复计）。另外 180s 审批那次出现了 `auto_retry_start` + 空 assistant 消息，**我没能确定这是我的假端点关连接导致、还是 pi 的通用行为**——只报现象不下结论。
10. **`subagent/` 端到端** —— 1015 行代码我逐段核过（`spawn` 子 pi + `--mode json` + 事件流聚合 + 并发上限 8/4 + abort 传播），但**没真跑**（需要真模型和 agent 定义文件）。所以"多 agent 编排能不能基于 pi"我只能说**机制齐备且是官方完整参考实现**，不能说"我验过它能跑"。
11. **`sandbox/`** —— 321 行读过，**没跑**（需 `npm install @anthropic-ai/sandbox-runtime` + 本机 bubblewrap/socat/ripgrep，本环境都没有）。
12. **审批门跨天/跨小时** —— 只验到 **180 秒**。小时级、跨天没验，且从 180s 就出现连接陈化征兆看，**我倾向认为撑不住，但这是推断不是实测**。
