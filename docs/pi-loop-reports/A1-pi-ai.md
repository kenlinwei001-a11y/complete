# A1 · 模型接入层（pi-ai / `@earendil-works/pi-ai` v0.83.0）

> 环境：`<pi2>/packages/ai`，全部结论走 **dist 产物**（出货件）或 pi 自己的 vitest。
> 自建混沌端点 `<scratch>/a1-work/zz-chaos-llm.py`（真 FIN / 真 RST / 429 / 5xx / 非法 JSON / 静默挂起 / 超长 / 慢握手 / 天价用量），
> 驱动脚本（全在 `<scratch>/a1-work/`，可复跑）：`zz-enum-providers.mjs`、`zz-authmap.mjs`、`zz-count.mjs`、`zz-stream-live.mjs`、`zz-abort.mjs`、`zz-compat.mjs`、`zz-finish.mjs`、`zz-handoff.mjs`、`zz-handoff2.mjs`、`zz-hash.mjs`、`zz-hooks.mjs`、`zz-hooks2.mjs`、`zz-cost.mjs`、`zz-auth.mjs`、`zz-faux.mjs`、`zz-determinism.mjs`。
> 复跑前置：`cd <scratch>/a1-work && CHAOS_PORT=8131 python3 zz-chaos-llm.py &`，各脚本均需 `NO_PROXY=127.0.0.1 no_proxy=127.0.0.1`。
> **未改 pi 仓任何文件**（探针全在 `<scratch>/a1-work/`）；我方仓只读。

---

## 一、能力清单（逐条带证据）

### 1.1 供应商真实清单

| 能力 | 实测结果 | 证据（命令 + 输出片段） | 判定 |
|---|---|---|---|
| 内置 provider 数 | **38 个 provider / 1125 个目录模型 / 9 种线协议**，目录快照 `generatedAt=2026-08-02T02:49:40Z`（构建期生成，非运行期拉取） | `node zz-count.mjs` → `built-in providers: 38 \| total catalog models: 1125` | ✅可用 |
| 「一等实现」有几种 | **9 种线协议 api 各自独立实现**，非全部转接：`openai-completions`(1523行)、`anthropic-messages`(1351)、`openai-codex-responses`(1650)、`bedrock-converse-stream`(1173)、`openai-responses`(360+`openai-responses-shared`756)、`mistral-conversations`(677)、`google-vertex`(591)、`google-generative-ai`(516+`google-shared`376)、`azure-openai-responses`(325)、`pi-messages`(433，仅 radius 用) | `wc -l src/api/*.ts \| sort -rn` | ✅可用 |
| 「一等 vs openai-compat 转接」逐个归属 | 实跑枚举得到（**38 行完整表见下**）：**25 个 provider 走 `openai-completions` 转接**、10 个走 `anthropic-messages`、6 个走 `openai-responses`、2 个 `google-generative-ai`；`azure-openai-responses`/`amazon-bedrock`/`google-vertex`/`mistral`/`openai-codex` 各自独占一种协议；`radius` 0 静态模型（纯动态拉取，走 `pi-messages`） | `node zz-enum-providers.mjs`（下方原文） | ✅可用 |
| 单 provider 多协议 | `opencode`(4种)、`github-copilot`/`cloudflare-ai-gateway`/`opencode-go`(各3种)、`fireworks`(2)、`xai`(2) —— **同一 provider 内按模型分流到不同 api**，不是「一个 provider 一种协议」 | 同上 | ✅可用 |
| 自动兼容识别机制 | **纯 `baseUrl.includes(...)` / `provider===` 字符串匹配**（`detectCompat()`，`src/api/openai-completions.ts:1395-1484`），共 12 个厂商判据。自建网关/自托管 URL 不匹配任一分支 → 落到「标准 OpenAI」默认档 | `sed -n '1395,1484p' src/api/openai-completions.ts` | ⚠有限制 |

**38 provider × 协议归属实测原文**（`node zz-enum-providers.mjs`）：

```
TOTAL PROVIDERS: 38
=== BY API ===
openai-completions (25): opencode, fireworks, cloudflare-ai-gateway, github-copilot, opencode-go, ant-ling,
  cerebras, cloudflare-workers-ai, deepseek, groq, huggingface, moonshotai, moonshotai-cn, nvidia, openrouter,
  qwen-token-plan, qwen-token-plan-cn, together, xiaomi, xiaomi-token-plan-ams, xiaomi-token-plan-cn,
  xiaomi-token-plan-sgp, zai, zai-coding-cn, xai
anthropic-messages (10): anthropic, kimi-coding, minimax, minimax-cn, vercel-ai-gateway, opencode, fireworks,
  cloudflare-ai-gateway, github-copilot, opencode-go
openai-responses (6): opencode, cloudflare-ai-gateway, github-copilot, opencode-go, xai, openai
google-generative-ai (2): opencode, google
azure-openai-responses (1) / bedrock-converse-stream (1) / google-vertex (1) / mistral-conversations (1)
  / openai-codex-responses (1) / [pi-messages] radius(0 静态模型)
```

> 结论：**「pi 支持 38 家」是真的，但其中 25 家是 openai-completions 转接 + compat 旋钮**。
> 真正逐协议手写的一等实现是 **9 套**（含 Anthropic / Bedrock / Google GenAI / Google Vertex / Mistral / OpenAI Responses / Codex Responses / Azure Responses / OpenAI Completions）。
> 对我们的意义：**我方只需要 anthropic + openai_compatible 两套时，pi 的 38 家并不是 38 倍价值，价值在那 25 家各自的 compat 差异知识**（见 §1.7）。

### 1.2 流式 · 事件粒度

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| `streamSimple` 事件序列 | `start(partial:true)` → `text_start(contentIndex)` → `text_delta×N` → `text_end` → `done(message)` ／ 失败时 `error(error)` | `node zz-stream-live.mjs ok` → `+128ms {"type":"start"}` / `+129ms {"type":"text_start"}` / `+129ms {"type":"text_delta","delta":"Hel"}` / `+131ms {"type":"text_end"}` / `+131ms {"type":"done","stopReason":"stop",...}` | ✅可用 |
| `stream` vs `streamSimple` | `streamSimple` = `stream` 的**厂商无关外壳**：把 `reasoning: ThinkingLevel` 映射成各家字段 + `clampMaxTokensToContext()` 按**估算**剩余上下文压 maxTokens；`stream` 暴露厂商原生 option 面 | `sed -n '612,629p' src/api/openai-completions.ts`；`src/api/simple-options.ts` | ✅可用 |
| 用量与成本随 done 返回 | `done.message.usage = {input,output,cacheRead,cacheWrite,reasoning,totalTokens,cost{input,output,cacheRead,cacheWrite,total}}` | 同上 ok 用例 → `"usage":{"input":11,"output":2,...,"cost":{...,"total":1.4999e-5}}` | ✅可用 |
| 请求出站改写钩子 | `onPayload(p)` 返回新对象 → **整包替换真落到线上**（改 model 名 + 改 system 均生效） | `node zz-hooks2.mjs` → `ON-THE-WIRE BODY: {"model":"REWRITTEN-MODEL","messages":[{"role":"system","content":"REWRITTEN SYSTEM"},...]}` | ✅可用 |
| 全量拦截点 | `options.fetch` 可注入自定义 fetch（拿到 URL / headers / body 全量） | `node zz-hooks.mjs` → `custom fetch saw: {"url":"http://127.0.0.1:8131/ok/v1/chat/completions","method":"POST","auth":"Bearer dummy","bodyModel":"m"}` | ✅可用 |
| 响应头钩子 | `onResponse({status,headers})` 在消费 body 前触发 | `node zz-hooks.mjs` → `onResponse saw: {"status":200,"hasHeaders":true,"ct":"text/event-stream"}` | ✅可用 |
| 超长响应 | 50×4KB 帧全收，`stopReason` 由 `finish_reason:length` 正确映射为 `"length"`，成本算出 $0.102405 | `node zz-stream-live.mjs huge` → `{"type":"done","stop":"length","usage":{...,"output":51200,...,"total":0.102405}}` | ✅可用 |

### 1.3 断流 / 重连 / 超时（真造断开验，不读注释）

**混沌矩阵实测原文**（服务端命中计数由 `zz-chaos-llm.py` stderr 佐证）：

| 场景 | pi 的行为 | 证据（真实输出） | 判定 |
|---|---|---|---|
| 流中途 **FIN** 断开（无 `[DONE]`） | `error` 事件 + `stopReason:"error"`、`errorMessage:"terminated"`、**已收到的局部文本保留在 content 里** | `node zz-stream-live.mjs cut` → `+109ms text_delta "partial-"` … `+113ms {"RESULT":{"stop":"error","err":"terminated","text":"partial-text-then-cut"}}` | ✅可用 |
| 流中途 **RST**（SO_LINGER 0） | 同 FIN，`"terminated"`，局部文本保留 | `zz-stream-live.mjs cutrst` → `{"stop":"error","err":"terminated","text":"partial-text-then-rst"}` | ✅可用 |
| 已发 header、**零帧**即断 | `start` → `error "terminated"`，content 空 | `zz-stream-live.mjs cut0` → `+93ms {"RESULT":{"stop":"error","err":"terminated","text":""}}` | ✅可用 |
| 有 `[DONE]` 但**缺 `finish_reason`** | `error "Stream ended without finish_reason"`，文本保留 | `zz-stream-live.mjs cutdone` → `{"stop":"error","err":"Stream ended without finish_reason","text":"no-finish-reason"}` | ✅可用 |
| **自动重连 / 断点续传** | **不存在**。断流一律上抛为 error，恢复完全交给上层（`utils/retry.ts` 的 `retryAssistantCall`，coding-agent 才调）；`isRetryableAssistantError` 的模式表含 `"terminated"` 故上层会重试**整轮**（非续传） | `src/utils/retry.ts` RETRYABLE 模式表；api 层实测无重连（服务端 hit 计数恒为 1） | ⚠有限制 |
| **429**（默认） | **不重试**，86ms 单发即失败 | `zz-stream-live.mjs 429` → `+86ms {"stop":"error","err":"429: {...rate_limit_error}"}`；chaos.log `429 hit#1` | ⚠有限制 |
| **429 + `maxRetries:3`** | 尊重服务端 `Retry-After: 1` → 共 **4 次请求**、3.1s 后放弃 | `zz-stream-live.mjs 429 - 3` → `+3102ms {"stop":"error",...}`；chaos.log `429 hit#2..hit#5` | ✅可用 |
| **429 + `Retry-After: 120`** | **立即失败并把服务端要求的等待时长写进错误**（默认 `maxRetryDelayMs=60000` 上限），供上层可见地决策 | `zz-stream-live.mjs 429slow - 3` → `+92ms {"err":"Server requested 120s retry delay (max: 60s). 429 Rate limit reached"}` | ✅可用 |
| **500** | 立即失败，错误体原样透传 | `zz-stream-live.mjs 500` → `{"err":"500: {\"message\":\"upstream exploded\",\"type\":\"server_error\"}"}` | ✅可用 |
| **非法 JSON 帧** | 整流失败（`error`），**局部文本保留**；但把 `Could not parse message into JSON: {not json at all` 直接 `console.error` 打到 stderr —— **无可注入 logger** | `zz-stream-live.mjs badjson` → stderr 出现该行 + `{"stop":"error","err":"Expected property name or '}' in JSON at position 1"}` | ⚠有限制 |
| **慢握手**（10s 才回 header）+ `timeoutMs:2000` | 2080ms 准时 `"Request timed out."` | `zz-stream-live.mjs slowheaders 2000` → `+2080ms {"stop":"error","err":"Request timed out."}` | ✅可用 |
| **流开后静默挂死** + `timeoutMs:3000` | ❌ **一直挂着不返回**。看门狗 20s 仍未终止，`timeoutMs` 完全不覆盖「已开流后的帧间空闲」 | `zz-stream-live.mjs hang 3000` → `+95ms text_delta` … `+20012ms {"WATCHDOG":"still alive -> STREAM NEVER TERMINATED"}` | ❌不可用 |
| 挂死 + `signal` 中断 | `abort()` 在 6ms 内收敛：`stopReason:"aborted"`、局部文本保留、`text_end` 先于 `error` 发出 | `zz-abort.mjs hang 2000` → `+2002ms ABORT_FIRED` / `+2008ms {"RESULT":{"stop":"aborted","err":"Request was aborted","text":"one-frame-then-silence"}}` | ✅可用 |

> **`timeoutMs` = 连接/首包超时，不是流空闲超时。** 这是我实测中最硬的一条：`timeoutMs:3000` 对慢握手准时生效（2080ms），对「已开流后 provider 静默」**零作用**。唯一逃生口是调用方自建帧间看门狗 + `signal.abort()`。

### 1.4 认证

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| apiKey | 38 家全支持；37 家有交互式 `login()`，`openai-codex` 仅 OAuth | `node zz-authmap.mjs`（38 行表） | ✅可用 |
| OAuth | **7 家**：`anthropic`(Claude Pro/Max)、`github-copilot`、`kimi-coding`、`openai-codex`(ChatGPT Plus/Pro)、`openrouter`、`radius`、`xai` | 同上 | ✅可用 |
| OAuth 流程类型 | PKCE+authorization_code：anthropic / openrouter / openai-codex / radius；device_code：github-copilot / kimi-coding / xai / openai-codex / radius；refresh_token：anthropic / kimi-coding / openai-codex / radius / xai | `grep -oE "device_code\|authorization_code\|refresh_token\|pkce\|code_challenge" src/auth/oauth/*.ts` | [仅静态] |
| bearer / 自定义头 | `ModelAuth = {apiKey?, headers?, baseUrl?}`；Anthropic 支持 `ANTHROPIC_AUTH_TOKEN` → 直接 `Authorization: Bearer`；`headers` 值为 `null` 可**抑制**厂商默认头 | `src/providers/anthropic.ts:20-27`；`src/types.ts` ProviderHeaders 注释 | [仅静态] |
| 刷新并发安全 | `Models.getAuth()` 在 `CredentialStore.modify()` 的**per-provider 串行链**内跑 refresh，杜绝并发双刷 | `src/auth/credential-store.ts` enqueue 链；`src/auth/types.ts` 契约注释 | [仅静态] |
| **凭据落盘形态** | ❌ **明文 JSON**，`~/.pi/auth.json`，`mode 0600`，**无任何加密** | `node zz-auth.mjs` 后 `cat authtest/auth.json` → 见下方原文 | ❌不可用（对我方铁律） |
| 凭据不回显 | `list()` **只回 `{providerId,type}`**（不含 secret）；但 `read()` 直接返回明文 key | `zz-auth.mjs` → `list(): [{"providerId":"anthropic","type":"api_key"},{"providerId":"openai-codex","type":"oauth"}]` / `read('anthropic'): {"type":"api_key","key":"sk-ant-SUPER-SECRET-1234567890"}` | ⚠有限制 |

```
$ ls -l authtest/auth.json
-rw------- 1 root root 236 Aug  2 11:50 authtest/auth.json
$ cat authtest/auth.json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-SUPER-SECRET-1234567890" },
  "openai-codex": { "type": "oauth", "access": "ACCESS-TOKEN-XYZ",
                    "refresh": "REFRESH-TOKEN-ABC", "expires": 1800000000000 }
}
```

> pi-ai 自带的只是 `InMemoryCredentialStore`；**持久化是"app-owned"** —— `CredentialStore` 是可注入接口（`read/list/modify/delete`）。
> 也就是说：**我方要接 pi，可以直接实现一个 AES-GCM 版 `CredentialStore` 塞进去，不用改 pi 源码。** 这是接入面上最友好的一处设计。

### 1.5 Token 与成本（最关键一条）

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| `count_tokens` 真调 provider？ | ❌ **整个 pi 仓（含 coding-agent）零处调用**。Anthropic SDK 明明有 `messages.countTokens`，pi 不用 | `grep -rn "countTokens\|count_tokens" packages/*/src` → **无任何命中** | ❌不可用 |
| token 估算方式 | **本地启发式**：`CHARS_PER_TOKEN = 4`，图片按 `4800 chars` 折算；有真实 usage 时用「最近一条 assistant usage + 其后消息估算增量」的混合口径 | `src/utils/estimate.ts:15-16` + `estimateContextTokens()` | ⚠有限制 |
| 估算被用在哪 | ① `clampMaxTokensToContext()` 直接按估算压 `maxTokens`（估偏 → 静默削 output 上限）；② coding-agent 的压缩触发判据 | `src/api/simple-options.ts:15-19` | ⚠有限制 |
| 成本**被计算** | ✅ 逐次请求算，含**分档计价**（`ModelCostTier.inputTokensAbove`）。我造 500k in / 60k out + 200k 分档 → 精确 $24.00（0.5M×$30/M + 0.06M×$150/M） | `node zz-cost.mjs` → `round 1: stop=stop usage.input=500000 usage.output=60000 cost.total=$24.00` | ✅可用 |
| 成本**被执行**（预算上限） | ❌ **完全没有**。连跑 3 轮共 $72 全部正常完成，无异常、无回调、无阻断；整个包**导出面里没有任何 budget/limit/spend/quota 符号**；累计成本也**根本不被 pi-ai 跟踪**（只有每条 AssistantMessage 自带的单次 cost） | `zz-cost.mjs` → `EXPORTS of index.js containing 'budget'/'limit'/'spend'/'cap': []` + `round 1/2/3` 全 `stop=stop`；`grep -rn "budget" src/` 命中的全是 **thinking budget（思考 token 预算，模型参数）**，与花费无关 | ❌不可用 |
| 唯一的「花超」防线 | 只有**错误串匹配**：`insufficient_quota` / `out of budget` / `quota exceeded` / `billing` 被判为**不可重试**（避免烧钱重试）。这是事后止损，不是事前预算 | `src/utils/retry.ts:17-24` NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN | ⚠有限制 |

> **对我方 7 维预算的直接结论：pi-ai 这一层一分钱预算能力都不提供，只提供「算得准的账单数据」。** 我们的 `BudgetTracker` / `LlmBudget` 必须**整套保留在 pi 之外**。好消息是 `done.message.usage.cost` 精度足够（含分档计价），可直接喂我们的计量。

### 1.6 模型元数据 · models.json override · 运行中换模型

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| `modelOverrides` 改内置模型 | ✅ 真生效。bedrock `claude-sonnet-4-5` 的 `200K/64K` → `4.3K/321` | `--list-models` 前后对比：`amazon-bedrock anthropic.claude-sonnet-4-5-... 200K 64K` → `... 4.3K 321` | ✅可用 |
| override **能改什么** | `name / reasoning / thinkingLevelMap / input / cost(含 tiers) / contextWindow / maxTokens / headers / compat` | `ModelOverrideSchema`（`coding-agent/src/core/model-config.ts:168-186`） | ✅可用 |
| override **不能改什么** | ❌ `id` / `api` / `baseUrl` / `provider` 不在 override 白名单（只有「新定义模型」`ModelDefinitionSchema` 才有 `api`/`baseUrl`）。**想把内置 anthropic 模型改指到自建网关 → 只能整个新建 provider** | 同上两个 schema 对比 | ⚠有限制 |
| 自定义 provider | ✅ 完整可用：`baseUrl / api / apiKey / oauth / headers / compat / authHeader / models[]` | `agentdir/models.json` 定义 `zzcustom` → `--list-models` 出现 `zzcustom zz-1 12.3K 678` | ✅可用 |
| **未知 compat 键的处理** | ⚠ **静默吞掉、零诊断**。typebox schema 只列了 22 个 completions 旋钮中的 20 个（缺 `supportsFinishReason`、`zaiToolStream`），但它**不拒绝额外属性**：我塞 `totallyBogusKnob: 12345` 照样加载运行 | `agentdir/models.json` 含 bogus 键 → `--list-models` 正常输出 `zzcustom zz-1`，无任何 warning | ⚠有限制 |
| **schema 外的旋钮反而生效** | ✅ A/B 实证：`supportsFinishReason:false` 虽不在 schema 里，**确实透传生效** | 对照组（无旋钮）→ `Stream ended without finish_reason`, `EXIT=1`；实验组（有旋钮）→ `no-finish-reason`, `EXIT=0` | ✅可用 |
| **拼错旋钮 = 静默失效** | ❌ 把 `supportsFinishReason` 拼成 `supportsFinishReasson` → **无任何提示**，行为回退到默认，报错在三层之外的运行期 | `agentdir4` → `Stream ended without finish_reason`, `EXIT_TYPO=1`（与对照组一模一样） | [有但无效] |
| 运行中换模型（跨 provider 接力） | 上下文**能过**，但**思考态必丢**。Anthropic 历史 → openai-completions：`thinking` 块的 `thinkingSignature` **被丢弃**，思考正文降级成普通 assistant `content` 文本 | `node zz-handoff.mjs` → `{"role":"assistant","content":"I should call the tool.","tool_calls":[{"id":"toolu_01ABCdefGHIjklMNOpqrST",...}]}` | ⚠有限制 |
| 反向接力 | OpenAI-Responses 历史 → anthropic-messages：`thinking` 同样降级为 `{"type":"text","text":"openai reasoning text"}`，openai 风格 tool id 原样保留，wire 格式合法 | `node zz-handoff2.mjs` → `{"role":"assistant","content":[{"type":"text","text":"openai reasoning text"},{"type":"tool_use","id":"call_openaiStyleId1",...}]}` | ⚠有限制 |
| 超长 tool id 归一化 | ✅ OpenAI-Responses 的 `call_x\|rs_...`（400+ 字符）→ `call_abc123_1qus6mc4`，**且 tool_call 与 tool_call_id 两处一致改写**；哈希是纯函数、**跨进程稳定** | `zz-handoff.mjs` 第 3 组；`node zz-hash.mjs` 跑两个独立进程均得 `bq8u0y10n5edx` | ✅可用 |
| 跨 provider 接力的**自动化验证** | ⚠ pi 自己的 `cross-provider-handoff.test.ts` **必须有真 key 才跑**，无 key 时 `0/38 contexts available` 并 FAIL —— 该能力在 CI 无 key 环境下**从未被验证过** | `npx vitest run test/cross-provider-handoff.test.ts` → `=== 0/38 contexts available ===` + `AssertionError: expected 0 to be greater than or equal to 2` | ⚠有限制 |

### 1.7 compat 旋钮

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| 旋钮总数 | **39 个**：`OpenAICompletionsCompat` **22** / `OpenAIResponsesCompat` **7** / `AnthropicMessagesCompat` **9** / `BedrockCompat` **1** | 脚本按 interface 精确计数（见下） | ✅可用 |
| 逐旋钮真实效果（实跑 13 组，看出站 payload） | 见下方对照，**全部按文档生效**（`supportsStore`/`supportsStrictMode` 的"看似没变"已核实为语义正确） | `node zz-compat.mjs` | ✅可用 |

```
OpenAICompletionsCompat: 22 -> supportsStore, supportsDeveloperRole, supportsReasoningEffort,
  supportsUsageInStreaming, supportsFinishReason, maxTokensField, requiresToolResultName,
  requiresAssistantAfterToolResult, requiresThinkingAsText, requiresReasoningContentOnAssistantMessages,
  thinkingFormat, chatTemplateKwargs, openRouterRouting, vercelGatewayRouting, zaiToolStream,
  supportsOpenAIGrammarTools, supportsStrictMode, cacheControlFormat, sendSessionAffinityHeaders,
  deferredToolsMode, sessionAffinityFormat, supportsLongCacheRetention
OpenAIResponsesCompat: 7 / AnthropicMessagesCompat: 9 / BedrockCompat: 1
```

实跑 payload 差分（`zz-compat.mjs` 原文摘要）：

| 旋钮 | 出站 payload 的真实变化 | 解决的真实兼容问题 |
|---|---|---|
| `maxTokensField:"max_tokens"` | `max_completion_tokens:1000` → `max_tokens:1000` | 老式 /v1/chat/completions（Moonshot/Together/NVIDIA/z.ai/Cloudflare GW）不认新字段 |
| `requiresToolResultName:true` | tool 消息多出 `"name":"t"` | 部分兼容网关强制 tool 结果带函数名 |
| `requiresAssistantAfterToolResult:true` | roles 由 `[...,tool,user]` → `[...,tool,assistant,user]`（**插入空 assistant**） | 某些实现禁止 tool 结果后直接跟 user |
| `supportsUsageInStreaming:false` | 删除 `stream_options:{include_usage:true}` | 不支持该字段的端点会 400 |
| `thinkingFormat:"openrouter"` | `reasoning_effort:"high"` → `reasoning:{effort:"high"}` | OpenRouter 思考参数形态 |
| `thinkingFormat:"zai"` | 增 `thinking:{type:"enabled",clear_thinking:false}` | z.ai/智谱形态 |
| `thinkingFormat:"qwen"` | 增顶层 `enable_thinking` | 阿里千问形态 |
| `openRouterRouting` | 增 `provider:{only:["deepinfra"],zdr:true}` | 上游选路 / **ZDR 零留存**（合规相关） |
| `supportsFinishReason:false` | 缺 finish_reason 时不再报错，推断为 `stop` | 大量自建 vLLM/Ollama 不发 finish_reason |
| `supportsStore:true` | 显式发 `store:false` | **主动退出 OpenAI 侧存储**（合规相关） |
| `supportsStrictMode` | 控制 tool 定义里 `strict` 字段**是否出现**（`zz-strict.mjs` 实测：true→`...,"strict":false}`；false→该键整个消失） | 部分网关对未知字段直接 400 |
| `supportsDeveloperRole` | system→`developer` 角色切换 | o1/推理系模型的角色要求 |
| `cacheControlFormat:"anthropic"` | 给 system/最后 tool 定义/最后文本块打 `cache_control` | OpenRouter 上跑 Anthropic 模型的缓存 |

> `openRouterRouting.zdr` + `supportsStore:false` 这两条是**合规旋钮**（零数据留存 / 不落存上游），对我们的多租户数据边界有直接价值。

### 1.8 确定性（对照我方 R6：同输入字节级一致）

| 能力 | 实测结果 | 证据 | 判定 |
|---|---|---|---|
| 可注入时钟 | ❌ **不存在**。`grep` 全包无 `now?:` / clock / timeProvider 类注入点；`Date.now()` 直接散落 49 处 | `grep -rn "now?:\|clock\|timeProvider\|randomSource" src/` → 仅命中注释 | ❌不可用 |
| 可注入随机源 | ❌ **不存在**。`Math.random()` 5 处：`utils/uuid.ts:10`（crypto 缺失时的 uuidv7 兜底）、`utils/provider-retry.ts:66`（重试抖动）、`providers/faux.ts:145,257`、`compat.ts:162` | `grep -rn "Math.random" src/` | ❌不可用 |
| **出站请求** 是否字节一致 | ✅ **是**。两个独立进程、间隔 1.2s，payload 完全逐字节相同 | `diff d1.txt d2.txt` → 只有 MSG 行不同，PAYLOAD 行相同 | ✅可用 |
| **返回消息** 是否字节一致 | ❌ **否**。`AssistantMessage.timestamp = Date.now()` 无法注入 → 两次跑 `1785671424006` vs `1785671425475` | 同上 diff 输出 | ❌不可用 |
| `prompt_cache_key` | ✅ 纯由调用方 `options.sessionId` 派生（`clampOpenAIPromptCacheKey` 截断到 64 字符），不引入随机 | `src/api/openai-prompt-cache.ts` + payload 实测 | ✅可用 |
| tool id 归一化哈希 | ✅ `shortHash` 纯函数，跨进程稳定 | `node zz-hash.mjs` ×2 → 均 `bq8u0y10n5edx` | ✅可用 |
| **pi 自带的 mock provider 也不确定** | ❌ `fauxProvider` 用 `Math.random()` 决定分块大小，**同一段文本三次跑出三种 delta 切分**，且**无 seed 参数** | `node zz-faux.mjs` ×3 → `["The quick br","own fox jump",...]` / `["The quick brown ","fox jumps ov",...]` / `["The quick brown ","fox jumps over the l",...]` | ❌不可用 |
| ↑ 的可用绕法 | ✅ `fauxProvider({tokenSize:{min:4,max:4}})` → 三次跑**完全一致** | 同脚本改 min==max → 三次均 `["The quick brown ","fox jumps over t","he lazy dog repe",...]` | ✅可用 |

### 1.9 pi-ai 自测基线

```
$ cd <pi2>/packages/ai && npx vitest run
 Test Files  11 failed | 97 passed | 14 skipped (122)
      Tests  24 failed | 777 passed | 755 skipped (1556)
   Duration  43.21s
```

- **755/1556 ≈ 48.5% 的用例在无 API key 时直接 skip** —— pi-ai 的厂商集成面**几乎全靠真网络验证**，本地零 key 环境跑不到。
- 11 个红文件（`abort / bedrock-thinking-payload / context-overflow / cross-provider-handoff / image-tool-result / interleaved-thinking / stream / tokens / tool-call-without-result / total-tokens / unicode-surrogate`）**全部是网络依赖**，主因 Bedrock 的 `hasBedrockCredentials()` 在本机误判为"有凭据"后真发请求失败：`AssertionError: expected 'error' to be 'stop'`。**非代码缺陷**，但说明其"绿"高度依赖外部环境。
- 我挑的 10 个纯离线相关文件全绿：
```
$ npx vitest run test/provider-retry.test.ts test/retry.test.ts test/providers.test.ts test/env-api-keys.test.ts \
    test/oauth-auth.test.ts test/models-runtime.test.ts test/context-estimate.test.ts test/faux-provider.test.ts \
    test/overflow.test.ts test/error-body.test.ts
 Test Files  10 passed (10)      Tests  143 passed (143)
```

---

## 二、我方对照

| pi 的能力 | 我方是否有 | 我方实现位置 / 证据 | 谁强 |
|---|---|---|---|
| 38 内置 provider / 1125 模型 / 9 线协议 | ⚠ **3 种可用 kind**：`anthropic` / `openai` / `openai_compatible`；`custom_http` 是**抛错的占位**（`CUSTOM_HTTP_NOT_IMPLEMENTED`） | `packages/llm-adapters/src/custom-http.ts:20-26`；`apps/agentcore/src/llm/providers.ts:56-100` | **pi 强**（数量级差距） |
| 内置模型目录（cost/contextWindow/maxTokens/reasoning 元数据） | ❌ 无内置目录，模型 id 由 provider 配置 + 用途绑定给出 | `apps/agentcore/src/llm/providers.ts` 解析顺序 §注释 | **pi 强** |
| 39 个 compat 兼容旋钮 | ❌ 无。`openai_compatible` 只有 `baseUrl` + `defaultHeaders` 两个开关 | `defaultAdapterFactory` case `"openai_compatible"` | **pi 强** |
| **provider 级流式**（token 粒度 SSE） | ❌ **完全没有**。适配器全是阻塞 `create()`/`parse()`，`grep -rn "stream" packages/llm-adapters/src/` **零命中** | `openai.ts:185,234,292,314,335` / `anthropic.ts:123,167,195,236` 全是非流式 | **pi 强** |
| 断流/超时/中断语义 | ⚠ 有 per-call `signal`（G-9）透传到 SDK；无 SSE 层，故无"帧间空闲"问题 | `openai.ts:73,247`；`anthropic.ts:166` | 平（各自缺一半） |
| 重试 / 熔断 / 故障切换 | ✅ **我方更强**：`CircuitBreaker`（滚动 1min 窗口、失败率 >50% 且样本 ≥5 → OPEN、30s 半开探测）+ provider fallback + 200 条尝试审计环，且**区分"该切"（超时/5xx/429）与"不该切"（4xx/内容拒绝）** | `apps/agentcore/src/llm/breaker.ts:1-45`；`providers.ts` `pushAttempt` | **我方强** |
| 凭据加密落库 | ✅ **我方强**：AES-256-GCM（`iv.tag.data` base64），响应只回 `hasApiKey:true` | `apps/agentcore/src/crypto.ts`；实测 `POST /a/v1/llm-providers` 传 `sk-PLAINTEXT-PROBE-9999` → 返回体与 `GET` 列表**均只有 `"hasApiKey":true`，无 key** | **我方强** |
| 凭据存储可插拔 | ⚠ pi 的 `CredentialStore` 是可注入接口（我方能塞加密实现）；我方是硬编码 repo | `pi src/auth/types.ts` CredentialStore | pi 架构更活 |
| `count_tokens` 真调 provider | ✅ **我方强**：`client.messages.countTokens(...)` 真调 Anthropic；openai 侧声明 `countTokens:false` 落回 chars/3.5；**每 2 轮实测一次**，期间增量估算 | `packages/llm-adapters/src/anthropic.ts:99-100`；`apps/agentcore/src/agent/context.ts:8-9,337,353` | **我方强** |
| 成本计算精度（分档计价） | ⚠ pi 有 `ModelCostTier` 分档；我方只按 token 数计量、未见 $ 分档 | `pi src/models.ts:639-658` | **pi 强** |
| **成本/预算被执行** | ✅ **我方强**：7 维 `AgentBudget`（maxIterations/maxToolCalls/maxSolverCalls/maxDurationMs/maxClarifications/maxDiscoverCalls/maxRoundTrips）+ per-tool cap，**真在 executor/engine 消耗并置 `exhausted` 触发降级** | `apps/agentcore/src/tools/executor.ts:191,211`；`engine.ts:469`；`tools/budget.ts` | **我方强** |
| 租户级 token 配额 | ⚠ 存在且状态机正确，但**没有消费方** | 实测 `PUT /a/v1/llm-budgets {hard:1000}` → `POST /record {900}` → `SOFT_EXCEEDED,degrade:true` → `{200}` → `HARD_EXCEEDED,degrade:true`；但 `grep -rn "llm-budgets" apps/agentcore/src apps/frontend-shell/src` **零命中** [仅静态] | 我方"半强"（有账本无闸门） |
| 结构化输出降级 | ✅ **我方强**：`parseWithJsonModeDegradation` — JSON-mode 提示 + zod 校验失败重试 ≤2 + 代码栅栏容错，失败落 `ClassifierParseError` → 路径 B | `packages/llm-adapters/src/degrade.ts` | **我方强**（pi 无对应物） |
| 上下文超窗识别 | ⚠ 我方 3 个正则；pi **30+ 厂商的实测错误串库**（含 z.ai 静默不报错、小米 MiMo 截断后 `finish_reason:length`+output=0 这类阴间 case） | 我方 `types.ts:isContextWindowExceededError`；pi `src/utils/overflow.ts` | **pi 强很多** |
| 可注入时钟（确定性） | ✅ **我方强**：`CircuitBreaker` 有 `now?: () => number` 注入点；`BudgetTracker` 计数纯函数（注释显式标 R6） | `breaker.ts:18,38`；`budget.ts` `tryConsumeTool` 注释 | **我方强** |
| 出站 payload 改写钩子 | ❌ 我方无 `onPayload` 等价物 | — | **pi 强** |
| 多租户 tenantId 贯穿 | ✅ **我方强**：`LlmAgentRequest.tenantId`、provider 按租户解析、`dcp:` 服务间凭证拉取 | `providers.ts` 解析顺序 §2 | **我方强**（pi 是单用户 CLI 模型，无租户概念） |

---

## 三、我方没有、pi 有的 —— 逐条判价值

| 能力 | 对我们的价值 | 理由（结合多租户/审批/溯源/确定性约束） | 建议 |
|---|---|---|---|
| **39 个 compat 兼容旋钮 + `detectCompat` 厂商判据表** | **高** | 我们要接国产模型（Kimi/千问/智谱/MiniMax/DeepSeek/小米）时，每家的 `max_tokens` 字段名、思考参数形态、tool 结果要不要带 `name`、要不要插空 assistant —— 这些坑 pi 已经踩完并且**逐条给了旋钮**。我方现在只有 `baseUrl`+`headers`，遇到一家不兼容就得改 adapter 代码 | **值得学不取代码**（把 §1.7 表格搬成我方 `openai_compatible` 的 compat 字段） |
| **`src/utils/overflow.ts` 超窗错误串库** | **高** | 30+ 厂商实测错误文案 + 两类"不报错"的阴间 case（z.ai 静默截断、小米 MiMo 截断后 length+output=0）。我方只有 3 条正则，换厂商就漏判 → 上下文超窗被当成普通错误 → 不触发压缩 → 死循环烧钱 | **立即取**（直接抄正则表进 `isContextWindowExceededError`，零依赖、零架构影响） |
| **provider 级流式（token 粒度 SSE + 细粒度事件）** | **高** | 我方 QOS 有 SSE，但是**编排层事件**；模型 token 是攒齐了一次性出的。要做「边想边显示」「首字延迟」体验必须补这层。pi 的 `AssistantMessageEventStream` 事件设计（start/text_start/text_delta/text_end/done/error + 局部内容在 error 时保留）成熟 | **值得学不取代码**（我方要在 tool-loop 内加流式，牵动 `LlmAgentResponse` 契约与审批链，不宜整包引入） |
| **`onPayload` 出站改写 + `fetch` 注入** | **中高** | 这是天然的**租户标记 / 脱敏 / 出站审计**挂载点，且我实测「返回新对象即整包替换、真落到线上」。我方现在要做出站审计只能改 adapter | **值得学不取代码**（在我方 adapter 加同名钩子，成本极低） |
| `openRouterRouting.zdr` / `supportsStore:false` 合规旋钮 | 中 | 零数据留存 / 不落存上游 —— 多租户客户数据边界的硬要求，将来一定会被问到 | **值得学不取代码** |
| `ModelCostTier` 分档计价 | 中 | 长上下文分档计价（>200k 翻倍）是真实计费规则，我方按 token 数记账会低估成本 | **值得学不取代码** |
| 内置 1125 模型目录（构建期生成、离线可用） | 中 | 省掉我们维护 contextWindow/maxTokens/价格的活。但目录 `generatedAt` 是**构建期**快照，要跟版本升级，且我方模型面窄 | **观望** |
| 7 家 OAuth（订阅制登录：Claude Pro/Max、ChatGPT Plus/Pro、Copilot、Kimi） | **低** | 我方是**服务端多租户**：凭据由租户管理员配置、AES-GCM 落库、服务间凭证分发。订阅制 OAuth 是**单机开发者**模型（浏览器回调 + 本地 token 刷新），与我们的部署形态根本不兼容 | **不要** |
| `InMemoryCredentialStore` / `AuthStorage` | **低** | 明文 JSON 落盘，直接违反我方 no-secrets-echo + CREDENTIAL_KEY 铁律 | **不要**（但 `CredentialStore` **接口形状**值得学：`read/list/modify/delete`，`modify` 是唯一写路径且 per-provider 串行，天然防并发双刷 token） |
| `fauxProvider` 假模型 | **低** | 我方 `apps/agentcore/src/llm/mock.ts` 已有确定性 mock（与循环侧同一 chars/3.5 公式）；pi 的 faux 反而**不确定**（无 seed），不如我方 | **不要** |
| pi-ai 整包作为我方 LLM 层 | **中，但有前提** | 见 §四 | **观望**（真要用，必须自带 CredentialStore + 帧间看门狗 + 预算层，三件都在 pi 之外） |

---

## 四、致命限制（若我们基于 pi 开发会踩的坑）

1. **【最致命】流开后 provider 静默 = 无限挂死，`timeoutMs` 管不着。**
   实测 `timeoutMs:3000` 下 `/hang` 场景挂满 20s 仍未终止（`WATCHDOG: still alive -> STREAM NEVER TERMINATED`）。
   我方 path-B agent 是长跑循环，一次挂死 = 一条工单卡死、预算里的 `maxDurationMs` 也**管不到**（它在我们循环层，而 pi 的 await 根本不返回）。
   → **接入前置条件：必须在 pi 外面套帧间空闲看门狗 + `signal.abort()`。** 已验证 abort 6ms 内干净收敛（`stopReason:"aborted"` + 局部内容保留），所以这个补丁可行，但**必须我们自己做**。

2. **零成本闸门。** pi-ai 导出面里 `budget/limit/spend/quota` 一个符号都没有；我造 $24/轮连跑 3 轮无任何阻拦。**我方 7 维预算 + 租户 token 配额必须 100% 留在 pi 之外**，不能指望 pi 提供任何一层。

3. **`count_tokens` 根本不调。** 全仓 `grep countTokens|count_tokens` **零命中**，一律 `chars/4` 本地估算，且这个估算**直接被用来压 `maxTokens`**（`clampMaxTokensToContext`）。我方 Anthropic 侧现有的真实 `messages.countTokens` 是**净损失**，接 pi 会退化。

4. **凭据明文落盘。** `auth.json` 明文 + 0600，无加密。直接撞我方 `no-secrets-echo` / `CREDENTIAL_KEY` 铁律。**必须自实现 `CredentialStore`**（接口是开放的，能做，但这是接入必做项而非可选项）。

5. **确定性两处硬伤（R6）。**
   - `AssistantMessage.timestamp = Date.now()` 不可注入 → **返回消息永远不字节一致**（出站 payload 是一致的，实测过）。要做会话重放/黄金用例，得在我方边界剥掉 timestamp。
   - 连 pi 自带的 mock provider 都用 `Math.random()` 切块、无 seed（实测三次三种切法）。绕法是 `tokenSize:{min:N,max:N}`，但这属于"知道了才躲得开"的坑。

6. **配置错误零诊断。** models.json 的 compat 拼错（`supportsFinishReasson`）或塞完全不存在的键（`totallyBogusKnob`）→ **加载通过、运行正常、旋钮静默不生效**，故障在三层之外的运行期以厂商报错形式冒出来。多租户下每个租户能配自己的 provider，这种静默失效会变成难以定位的支持工单。

7. **兼容识别靠 URL 子串。** `detectCompat()` 是 `baseUrl.includes("api.moonshot.")` 这种匹配。我方生产大概率是**自建网关/反代**（域名是我们自己的）→ **所有厂商判据全部落空**，退回"标准 OpenAI"默认档，`maxTokensField`/`thinkingFormat` 等全错。必须逐 provider 显式写 `compat`，不能依赖自动识别。

8. **一半测试面靠真网络。** 755/1556（48.5%）用例无 key 即 skip；跨 provider 接力这种**恰恰最关键**的能力在无 key 环境 `0/38 contexts available` 直接 FAIL。**"pi 测试绿"不等于"pi 这条路径被验证过"** —— 正撞我方"绿测试 ≠ 能用"的老坑。

9. **换模型必丢思考态。** 双向实测：`thinking` 块的 signature 一律丢弃、思考正文降级为普通 `text`。两个后果：(a) 换模型后模型的私有推理**变成可见 assistant 文本**进入后续上下文和我们的审计留痕；(b) 扩展思考的多轮连续性中断。我方若做"路径 B 中途切换 provider 容灾"，得接受这个语义。

10. **错误诊断只走 `console.error`。** 非法 JSON 帧时直接打 stderr（`Could not parse message into JSON: ...`），无可注入 logger → 在我们的结构化日志/requestId 体系里是黑洞。

---

## 五、越界线索（边界外发现，交主控）

1. **`packages/coding-agent/src/core/auth-storage.ts` 有跨进程文件锁**（`proper-lockfile` + `lockSync` 10 次 20ms 重试 + `dev:ino:size:mtimeNs:ctimeNs` 版本号做缓存失效）。凭据存储的并发正确性做得比我方细，`CredentialStore.modify` 是唯一写路径的设计值得单独看一眼 —— 归 coding-agent 域，非我边界。
2. **`packages/ai/src/api/openai-codex-responses.ts` 1650 行是全包最大文件**，含 `transport: "websocket" | "websocket-cached"` 和 `websocketConnectTimeoutMs`。**pi 有 WebSocket 传输通道，不只是 SSE** —— 我这轮只验了 SSE 路径。谁做传输层可以深挖。
3. **`src/utils/deferred-tools.ts` + `compat.deferredToolsMode:"kimi"` + `supportsToolSearch` / `supportsToolReferences`** —— pi 有"延迟加载工具/工具检索"的机制（工具多到塞不下上下文时按需加载）。这直接对应我方工具目录膨胀问题，但属于工具层，交 B* 号。
4. **`src/api/constrained-sampling.ts` + `supportsOpenAIGrammarTools`（Lark/regex 语法约束采样）** —— 结构化输出的硬保证路径，比我方 JSON-mode + zod 重试强一个量级。属"输出契约"域。
5. **我方 `/a/v1/llm-budgets` 有完整状态机（实测 OK→SOFT_EXCEEDED→HARD_EXCEEDED，`degrade:true`）但 `grep -rn "llm-budgets" apps/agentcore/src apps/frontend-shell/src` 零命中** —— 账本记得对，但**没有任何调用方读它**。这是我方自己的接缝断点，建议主控立项。
6. **我方 `DELETE /a/v1/llm-providers/:id` 不存在**（实测 404）。我在活服务上留了一条测试数据 `llmp_rqxnvry78t2az0bd`（name=`zz-probe`，tenant=demo，key 已加密，删不掉）—— 内存态服务重启即清，但**"provider 只能建不能删"本身是产品缺口**。

---

## 六、我没能验证的（诚实列出）

1. **真实厂商行为**：全部实测都对着我自建的 chaos 端点。38 家真 provider 一家都没连过（无 key）。所以「pi 对 Anthropic/OpenAI 真实响应的解析正确性」我**没有验证**，只验了协议层的健壮性。
2. **WebSocket 传输**（`transport:"websocket"/"websocket-cached"`，openai-codex 专用）—— 完全没碰。
3. **Bedrock / Google Vertex / Mistral / Azure 四条一等实现**的行为 —— 只做了静态归属统计和 LOC 统计，没跑通任何一条（需要各自云凭据）。
4. **OAuth 全流程**（PKCE 回调、device_code 轮询、token 刷新竞态）—— 只有 `grep` 出的 grant type 与 `oauth-auth.test.ts`/`oauth-device-code.test.ts` 通过（143 绿里含这两个）。**没有真跑过一次登录**，标 [仅静态]。
5. **`AnthropicMessagesCompat` 的 9 个旋钮 + `OpenAIResponsesCompat` 的 7 个** —— 只做了 interface 精确计数；实跑 payload 差分只覆盖了 `OpenAICompletionsCompat`（13 组）。Anthropic 侧只验了跨 provider 接力那一次 payload。
6. **`models.json` 里 `oauth:"radius"` / `authHeader` 两个字段** —— 没测。
7. **我方 `custom_http` adapter** —— 确认是抛 `CUSTOM_HTTP_NOT_IMPLEMENTED` 的占位（静态读码 + 契约），没在活服务上触发过。
8. **我方 AES-GCM 落库的密文形态** —— 我只在活服务（内存态）验证了「响应不回显明文、只给 `hasApiKey:true`」。**没有看到 pg 库里的密文字节**，所以"加密落库"这半是 [仅静态]（`apps/agentcore/src/crypto.ts` 读码）。
9. **coding-agent 交互式 `/model` 中途换模型** —— 越界（属 coding-agent），我只在 pi-ai 层验了上下文转换语义。
