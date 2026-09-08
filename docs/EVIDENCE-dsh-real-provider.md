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

### 2.1 实测：**一路通到真供应商，只被鉴权挡** ⇒ 定性为 (b)「只缺凭据」

三家真供应商，各跑一次 `runDshAgent`（`provider=platform`，生产档 `cordis.l2.yml`，真子进程）：

| 目标 | 鉴权拒绝特征（命中） | 连接层失败特征 | 定性 |
|---|---|---|---|
| `api.moonshot.cn/v1` | `401` · `authentication` | **（无）** | 到达供应商，被其鉴权拒绝 |
| `api.openai.com/v1` | `401` · `invalid_api_key` · `invalid_request_error` | **（无）** | 同上（OpenAI 自己的错误体形态） |
| `api.deepseek.com/v1` | `401` · `authentication` · `invalid_request_error` | **（无）** | 同上 |

**连接层特征全部零命中**（扫的是 `ENOTFOUND` / `ECONNREFUSED` / `EAI_AGAIN` / `ETIMEDOUT` /
`CERT_` / `self-signed` / `unable to verify`）⇒ **DNS、TLS、代理、出网都是通的**。

**⇒ 已被证明打通的链段**：
`runDshAgent` → env 注入（`PLATFORM_LLM_*`）→ 真子进程 → 真 DNS/TLS/HTTPS 出网 →
**真外部供应商** → 供应商自己的错误体回灌进 harness 事件流。
**唯一未验证的链段**：鉴权通过之后的「供应商正常应答 → 解析 → 收尾」。

**红线**：假 key 是字面量，**未发送任何真凭据**；断言 `wire` 不含该假 key 串，三臂全绿。

### 2.2 顺带澄清一条**差点被我误报成 fail-open 的**

三臂的 `result.ok` 都是 `true`，乍看像「401 了还报成功」。**再追一层即推翻**：

```
result = {"ok":true,"outcome":"FAILED","answer":{...markdown:"（探索模式未能产出回答）"},
          "stats":{"tokenUsage":{"uncachedInputTokens":0,"outputTokens":0,...}}}
```

`ok` 度量的是**会话协议跑完了**，`outcome:"FAILED"` 才是裁决 ⇒ **语义自洽，不是 fail-open。**
（若只看 `ok` 就下结论，就是本仓记过的那个病。）

**并且这给出一条重要订正**：401 路径上 `tokenUsage` 是 **0/0**。
⇒ `tokenUsage>0` 这个断言**确实能分**「拿到带 usage 的应答」与「没拿到应答」，
**但分不了**「真外部供应商」与「本地 stub / 固定端点 / 回放」——**§3 的结论要按这个精度读，别扩大。**

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

## 4 · 改了什么（**产品源码 0 行**）

`git diff --stat canonical...HEAD` = **3 个文件**，其中 `docs/DECISION-dsh-fusion.md` 是并 handoff
分支带进来的（非本单改动）。本单实际改动**两个文件，零 `src/`**：

### 4.1 `apps/agentcore/test/dsh-e2e-real-triad.test.ts`

| 改动 | 为什么（都是实测驱动，不是偏好） |
|---|---|
| **① 门控改厂商中立** | 原门控 `KIMI_API_KEY`/`KIMI_BASE_URL` + **硬编码 `MODEL_ID="kimi-k3"`** ⇒ 持别家 key 也跑不了。现 `DSH_REAL_API_KEY` / `DSH_REAL_BASE_URL` / `DSH_REAL_MODEL` / `DSH_REAL_KIND` 四个通用名，**旧名保留向后兼容**（旧配方原样可跑） |
| **② L2.A1 判据换成判别力金丝雀** | 原判据 `tokenUsage>0` 无判别力（§3）。现改为**两问对照**：同链路问两个只差一个记号串的问题，**回答必须跟着变**；并断言各自回显各自的记号。token 账降级为「次要观测」并**在注释里写明它证明不了什么** |
| **③ 新增 L2.A1′ 变异反证（免凭据·本机已跑绿）** | 金丝雀自己也要被证明会说话。该臂拿**同一个 `isDiscriminating`** 去量一个固定应答端点，断言判 `false`。**共用同一份实现**，不另抄（抄了就是装饰品） |
| **④ 记号用「回显」不用「算术」** | 若让真跳臂去问一道要模型自己算的题，等于在验收里鼓励它违反「求解器算数、agent 只编排」。回显记号既能验输入依赖性，又**不产生任何数值** ⇒ 绕开验收判据 3 的陷阱 |

⚠ **诚实边界**：② 我**跑不了**（无凭据），只经 `tsc --noEmit` RC=0 + 人工核对 `Answer.blocks[].markdown`
形态（`packages/contracts/src/qos.ts` `AnswerSchema`，两条路同一个 `Answer` 类型）。
**③ 是跑绿的**，且它用的正是 ② 依赖的那两个函数（`answerText` / `isDiscriminating`）⇒
**取值器与金丝雀逻辑已被机器验过**，未验的只剩「把它指向真供应商」这一步。

### 4.2 `docs/EVIDENCE-dsh-real-provider.md`（本文件，新增）

### 4.3 临时探针**已删**（不留在套件里）

`zz-probe-tokenusage.test.ts` / `zz-probe-realegress.test.ts` 已删除。
后者**必须删**：它真打外部网络，而本仓铁律是「测试不依赖网络/时钟随机性，LLM 一律 mock」。
它们的结论已固化进本文件与 L2.A1′。

---

## 5 · 定向测试结果

| 项 | 命令 | 结果 |
|---|---|---|
| 真三实套件（全文件） | `npx vitest run test/dsh-e2e-real-triad.test.ts` | **6 passed / 2 skipped**（skip = L2.A1、L2.A4，无凭据）· Test Files 1 passed |
| ├ L2.A1′ 变异反证（**本单新增**） | 同上 | ✅ `A=<<固定端点写死串>> B=<<固定端点写死串>>` ⇒ `isDiscriminating` 判 `false` |
| ├ L2.A2 真规则 allow / deny 两臂 | 同上 | ✅ ✅ |
| ├ L2.A3 真 MCP | 同上 | ✅ |
| └ L2.A5 ⑤a/⑤b 变异负向两臂 | 同上 | ✅ ✅ |
| agentcore 类型 | `npx tsc -p tsconfig.json --noEmit` | **RC=0** |
| 休眠门 | `node scripts/check-dsh-dormancy.mjs` | **RC=0**，金丝雀 **28/28**，与改动前**逐项同值**（部署面 8 / 源码面 705 · D1 0 · D2 0 · D3 动态 1 静态 0） |

⛔ 未跑 `pnpm -r test` / `gate.sh`（收编方正独占三包测试；且 `gate.sh` 有已知管道死锁）。

### 5.1 五格验收判据 · 逐格如实交代

| # | 判据 | 结果 |
|---|---|---|
| **1** | 真供应商应答（两段回答原文） | ❌ **做不到，无凭据**。⛔ 未用 stub 冒充、未把 mock 回答包装成真跑。**已做到的是**：链路打到三家真供应商并拿回它们**自己的 401**（§2.1） |
| **2** | 判别力金丝雀 | ⚠ **量法已修好并验过，但没有真路可量**。现状按 WO 规定口径：**报「量法坏了」**——原判据无判别力（§3），现已换成两问对照并用变异反证证明它抓得住固定端点（§5 L2.A1′ 绿） |
| **3** | 数字纪律（真路回答里的数必须可追） | ⏸ **无真路回答可查**。本单**主动避开**这个陷阱：金丝雀用记号回显不用算术，**不诱导 agent 自己产数**（§4.1 ④）。§13.5 那条「有检测有标注、无无条件阻断」仍是候选前置，本单未改变 |
| **4** | 休眠不变 | ✅ **产品源码 0 行改动**（diff 仅 `test/` + `docs/`）⇒ `DSH_HARNESS=0` 全链逐字节相同**不是推断是事实**；`dsh-dormancy:check` **RC=0**，金丝雀 28/28 |
| **5** | 凭据不外泄 | ✅ 全程无真凭据可用故无从泄露；探针用的是**字面量假 key** 且断言帧流不含它（三臂绿）。**本报告与本文件零凭据明文** |

---

## 6 · 剩余风险清单（翻 flag 前要看的·更新版）

| # | 风险 | 本单之后的定性 |
|---|---|---|
| **R1a** | **真供应商臂的判据无判别力**（原 R1 里没写这条，是本单新发现） | ✅ **已修**：判据换成两问对照，且变异反证已绿。⚠ 但**修好的判据本机没能对着真供应商跑过一次** |
| **R1b** | **真外部供应商一跳仍未跑通** | ❌ **未闭**。缺的**只有凭据**：`DSH_REAL_API_KEY` + `DSH_REAL_BASE_URL`（+ 对得上的 `DSH_REAL_MODEL`）。网络、出网、TLS、代理、env 注入、子进程全部实测已通（§2.1） |
| **R1c** | **旧的销账证据链要打折**（新增） | `DECISION-dsh-fusion.md` §13.2 前置 A 判据②「端到端跑通」引的是打在**本地 stub** 上的臂 —— **接线结论仍成立**，但**不构成「真供应商」证据**。⚠ 本单**未改** §13 正文（只在此点名），避免「改台账掩盖事实」 |
| **R2** | `sliceSolverKeys` 规划自检不过 dsh 路 | 本单未触及，维持原判（观测面缩小，非阻断） |
| **R3** | 数字红线只标注不阻断（两路皆然） | 本单未触及，维持原判；§13.5 的「第 4 条前置候选」仍待仓主裁决 |
| **R4** | **无轮次上限时可跑出 2000+ 次真实调用**（新增·观察项） | 实测：不给 watchdog cap（缺省 opt-in 禁用）+ 端点恒回同一轮 ⇒ 循环 **2015 / 2109 次**才被 60s 超时截断，且 `outcome` 仍报 ok。**接真供应商时这是真实计费**。⚠ 未定性为缺陷（watchdog 是 opt-in，生产路是否恒给 cap 未在本单验证），**建议翻 flag 前确认一次** |

---

## 7 · 一句准话（仓主要的那句）

> **真供应商一跳在本机跑不了。缺的是「凭据」这一样，且只有这一样。**
> 具体到 env：**`DSH_REAL_API_KEY` + `DSH_REAL_BASE_URL`**（旧名 `KIMI_API_KEY` / `KIMI_BASE_URL` 同样接受），
> 外加一个与该供应商对得上的 **`DSH_REAL_MODEL`**（缺省 `kimi-k3`）。
> **网络出口不缺**：`api.openai.com` / `api.moonshot.cn` / `api.deepseek.com` / `api.anthropic.com`
> 本机全部可达，且 dsh 路真的打到了它们、拿回了它们自己的 401。
> **凭据来源**：本容器内无任何可用的供应商凭据 —— env 没有、仓里没有、`SEED_DEMO` 不播种、
> 加密库里没有密文可解；会话自身的模型通道由宿主管理、不以 env 形态存在，**且它是会话的凭据不是产品的**。
>
> **⚠ 附带的那半句同样重要**：**就算把 key 插上，也别拿今天 canonical 上那版 L2.A1/A4 去销账** ——
> 它的判据在本地 stub 上照样绿。本单已把判据换成两问对照并用变异反证验过；
> **插上 key 之后跑的应当是这一版。**

### 7.1 有凭据的人怎么跑（一条命令）

```bash
DSH_REAL_API_KEY='<该供应商的 key>' \
DSH_REAL_BASE_URL='https://<供应商>/v1' \
DSH_REAL_MODEL='<该供应商真实存在的模型名>' \
npx vitest run test/dsh-e2e-real-triad.test.ts -t "判别力"
```

跑完看两件事，**缺一件都不算真供应商跑通**：
1. `[L2.A1 判别力] A=<<…>> B=<<…>>` **两段必须不同**，且各自含 `ALPHA-7Q3` / `BRAVO-2X8`；
2. 该臂**不再 skip**（skip 说明 env 没被读到）。
若两段相同 ⇒ **报「量法坏了 / 打到固定端点」，不许报「真路通了」。**
