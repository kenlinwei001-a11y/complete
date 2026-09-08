# WO-DSH-REAL-PROVIDER · 真外部供应商一跳 · 可行性判定与取证

> **取证头**
> · base commit：`75d9b222`（canonical `origin/claude/inspiring-gates-aqczjg`）merge `d08a3e13`（`claude/handoff-wo-dsh-unfreeze`，快进，仅带一份文档）
> · 取证时刻：2026-09-08 04:29–05:0x UTC
> · `dsh-dormancy:check` **RC=0**（金丝雀 28/28；扫描面 部署面 8 / 源码面 705）
> · **本机能不能跑真供应商一跳：❌ 跑不了。缺的是凭据，不是接线，也不是网络。**
> · ⛔ 本单未翻 flag；产品源码 0 行改动。

---

## 0 · 一句话结论（比「跑不了」更重要的那句）

**就算现在把凭据插上，今天这条臂也证明不了「真供应商应答」——因为它的判据没有判别力。**

L2.A1/L2.A4 拿 `stats.tokenUsage.uncachedInputTokens>0 ∧ outputTokens>0` 当「真跳证据」，
注释原文写「**stub/剧本给不出非零真值口径**」。**实测：给得出，而且是逐字透传。**

照铁律 0.6 句式：

> **「我用『stats.tokenUsage 非零』当作『打到了真外部供应商』的证据，而前者并不度量后者
> —— 同一个文件里的本地 stub 声明 `usage:{prompt_tokens:50,completion_tokens:10}`，
> 原样透传成 `uncachedInputTokens=50 / outputTokens=10`，断言 `>0` 照样绿。」**

⇒ 按本单验收判据 2 的处置规定：**报「量法坏了」，不许报「真路通了」。**

---

## 1 · 三点可行性判定

### 1.1 凭据：❌ 没有（这是唯一的真阻塞）

| 查的地方 | 结果 |
|---|---|
| 进程 env | **无** `KIMI_API_KEY` / `KIMI_BASE_URL` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `MOONSHOT_API_KEY` / `DEEPSEEK_API_KEY` |
| 仓内明文 key | **0 个文件**命中 `sk-[A-Za-z0-9]{20,}`（**金丝雀**：同一条命令命中 `l2-e2e-fake-key` 于 `dsh-e2e-real-triad.test.ts` ⇒ 扫描器是好的，"0 命中"是真的零） |
| `.env*` 文件 | 仓内 maxdepth 3 **零个** |
| datacore 加密凭据库 | `llmproviders.ts` 的 `apiKey` 是 write-only + AES-GCM（`cipher.encrypt`），只经服务间路由 `/a/v1/llm-providers/{id}/credential`（`requireServiceToken`）解密。**但 `SEED_DEMO=1` 不播种任何 LlmProvider** ⇒ 库里没有可解的密文。**「取不到明文」不是本单的障碍——障碍是压根没有明文被存进去过。** |
| 本会话自身的模型通道 | `ANTHROPIC_BASE_URL=https://api.anthropic.com/`（无 userinfo），`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1` ⇒ 会话自身的鉴权由宿主注入、**不以任何 env 形态出现**。它是会话的凭据，**不是产品可用的供应商凭据**，本单不动它。 |

### 1.2 出站网络：✅ 通（不是阻塞）

`curl https://<host>/v1/models`（无凭据）实测：

| host | HTTP | 判读 |
|---|---|---|
| `api.anthropic.com` | **401** | 到得了，缺鉴权 |
| `api.openai.com` | **401** | 到得了，缺鉴权 |
| `api.moonshot.cn` | **401** | 到得了，缺鉴权 |
| `api.deepseek.com` | **401** | 到得了，缺鉴权 |
| `generativelanguage.googleapis.com` | 403 | 到得了 |
| `dashscope.aliyuncs.com` | 404 | 到得了 |
| `open.bigmodel.cn` | ~~200~~ | **假阳性**：`content-type: text/html`，回的是官网营销页不是 API 应答。**「HTTP 200」不度量「这个端点能用」** |

⚠ `noProxy` 含 `api.anthropic.com` ⇒ 该 host 直连不过代理。其余走 `HTTPS_PROXY`，**全程未关 TLS 校验、未 unset 代理**。

### 1.3 env 门控清单：`dsh-e2e-real-triad` L2.A1/L2.A4 要什么

`apps/agentcore/test/dsh-e2e-real-triad.test.ts:57-59`

```
const KIMI_KEY  = process.env.KIMI_API_KEY;
const KIMI_BASE = process.env.KIMI_BASE_URL;
const KIMI_READY = 两者皆为非空字符串;
describe.skipIf(!KIMI_READY)(...)   // L2.A1 :321   L2.A4 :515
```

**只有两个 env 是门控**：`KIMI_API_KEY`、`KIMI_BASE_URL`。但要真跑通还隐含第三件事：

- **`MODEL_ID = "kimi-k3"` 是文件级硬编码常量**（`:55`），经 `kimiDirectory()` 写进 provider 的
  `models[].modelId`，再经 `resolveConnectionFacts` 出来注入 `PLATFORM_LLM_MODEL`。
  ⇒ **换一家供应商（OpenAI / DeepSeek / Anthropic）即便有 key 也跑不了**，因为模型名对不上。
  这条臂名义上叫「真 LLM」，实际**只对一家供应商成立**。
- 供应商 API 形态由 `facts.kind` 派生（`kimiDirectory()` 写死 `kind:"openai_compatible"`）⇒
  Anthropic 形态的 key 走不进这条臂（`kimiPlatformEnv()` 虽有 `anthropic-messages` 分支，
  但 directory 里 kind 是写死的，分支进不去）。

**⇒ 要在有凭据的环境跑通，需要注入的完整 env（今天的形态）**：

```
KIMI_API_KEY=<某 openai_compatible 供应商的 key>
KIMI_BASE_URL=<该供应商的 /v1 基址>
# 且该供应商必须真的提供名为 kimi-k3 的模型，否则要改源码常量 MODEL_ID
```

---

## 2 · 「跑不了」的定性：只缺凭据，不缺接线

「跑不了」有两种，修法完全不同：**(a) 链路更早就断** vs **(b) 一路通到供应商、只被鉴权挡**。
探针 `zz-probe-realegress.test.ts` 把 `PLATFORM_LLM_BASE_URL` 指向**真外部供应商**、配一把
**明知无效的字面量假 key**（不发送任何真凭据），看回来的是供应商自己的 401 还是连接层错误。

（结果见 §2.1，随实测回填。）

---

## 3 · 判别力实测（本单最硬的一格）

**探针**：`apps/agentcore/test/zz-probe-tokenusage.test.ts`（临时件，交付前删）
**做法**：完全复用仓内 `startStubOpenAi` 的形态（有限剧本 + 用尽返 500），跑 `runDshAgent`，把
`result.stats.tokenUsage` 打出来。

| 观测 | 值 |
|---|---|
| `stubRequests` | **2**（第 2 次即剧本用尽 500，这就是 stub 臂的终止机制） |
| `result.ok` | `true` |
| `stats.tokenUsage` | `{"uncachedInputTokens":50,"outputTokens":10,"cacheReadTokens":0,"cacheWriteTokens":0}` |
| L2.A1/A4 断言 `uncachedInputTokens>0` | **true** |
| L2.A1/A4 断言 `outputTokens>0` | **true** |

**stub 声明的 `USAGE` 是 `{prompt_tokens:50, completion_tokens:10}`** ⇒ **50/10 逐字透传**。

### 3.1 被这条实测推翻的原文（点名，不改正文）

| 出处 | 原文 | 实测 |
|---|---|---|
| `dsh-e2e-real-triad.test.ts:353` | 「真跳证据：answer.stats… 携带真模型 token 账——**stub/剧本给不出非零真值口径**」 | **给得出**：50/10，断言 `>0` 绿 |
| 同文件头 `:7-8` | 「`answer.stats.tokenUsage.uncachedInputTokens>0`（**真模型回包 token 痕迹**）」 | 不是「真模型」痕迹，是**端点自报的 usage 字段**，谁都能自报 |
| `docs/DECISION-dsh-fusion.md` §13.2 前置 A 判据② 证据列 | 以 A3/L2 臂作为「端到端跑通」的销账证据 | 该臂的**真实性判据**不成立；**接线**仍成立（A3 打的是本地 stub，本来也没声称是真供应商） |

⚠ **界定清楚，别扩大**：这条推翻的是**「怎么证明打到了真供应商」**，
**不是**推翻 §13.2 前置 A 的接线结论（`?? "mock"` 已根除、缺省 `platform` 等，那些另有断言支撑）。

### 3.2 顺带实测到的一条（不是本单目标，但值得记）

第一版探针用**无限剧本**（每次都回同一个 final_answer）⇒ 循环 **2015 / 2109 次**（两跑不同数）
才被 `requestTimeoutMs=60s` 截断，且 `result.ok=true`。
⇒ 该配置下（未给 watchdog cap，watchdog 缺省 opt-in 禁用）**没有轮次上限**。
**若这跑在真供应商上，就是 2000+ 次真实计费调用。**
这不与前置 B 矛盾（watchdog 是 opt-in、本探针没开），但**翻 flag 前值得确认生产路是否恒有 cap**。

---

## 4 · 剩余风险清单（R1 更新版）

| # | 原文 | 本单之后 |
|---|---|---|
| **R1** | 「真实外部供应商一跳从未跑过…翻 flag 前建议在有凭据的环境跑一次 L2.A1/A4」 | **仍未跑**（本机无凭据）。**且这条建议本身要改**：照今天的 L2.A1/A4 跑，**跑绿了也不构成证据**（§3）。R1 应拆成两条：<br>**R1a 判据缺陷**：真供应商臂的判据无判别力 ⇒ 先修判据，再谈跑。<br>**R1b 凭据缺口**：修好判据后，仍需一把真 key 才能跑。 |
