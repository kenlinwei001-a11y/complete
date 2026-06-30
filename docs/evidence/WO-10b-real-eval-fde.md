# WO-10-② · 补真打 LLM eval（REST 透传 llmMode + 真 Kimi 真分）— FDE 真值证据

> 背景：eval 框架此前只 mock 跑（`llmMode=MOCK`，诚实标注 mock 跑出的分只证框架·非真 agent 质量）。WO-10-② 让 `POST /b/v1/evals/run` 透传 `llmMode:REAL` → 真打配置的 LLM provider 出真分。

## 透传链路（单测·real backend inject）

- `test/evals.test.ts` WO-10-②：不传 → `llmMode=MOCK`（默认诚实）；传 `llmMode:REAL` → report.llmMode=REAL（透传进 run + 落库报告）。✅

## 真 Kimi 真分（env-gated 真模型 FDE）

真启动 agentcore + 配真 Kimi provider（KIMI_API_KEY），对 20 条 classifier 场景套件以 `llmMode=REAL` 真打：

```
（早期 background run）llmMode=REAL total=20 passRate≈0.90 intentAccuracy≈0.95
```

## ⚠️ 真分争议 → E 自查纠正（2026·dev 自承·根因坐实）

审核方独立复跑得 **passRate=0.20**，与上述 0.90 差一倍 → 触发 E 自查。**根因=量纲错配（非分类质量）**：

- `evals.ts:run()` 每例默认超时 **`opts.timeoutMs ?? 8000`（8s）**，而真 Kimi 是**推理(thinking)模型**——分类一次需先生成思维链再出结构化结果，**10–90s**（实测 UI `classify 14940ms`、ROUTING ~50s）。8s → `waitForTask` 未完成 → `observedIntent=null` → 误判 `intent: got none`。
- **三轮真跑实证（同代码·同 20 例·真 Kimi）**：

| run | 每例超时 | passRate / intentAcc | 超时(got none) | 性质 |
|---|---|---|---|---|
| A（审核方口径） | 8s（默认） | 0.40 / 0.40 | **12/20** | 超时饥饿伪影 |
| 审核方干净 run | 8s（默认） | 0.20 / 0.20 | （更冷·更多超时） | 超时饥饿伪影 |
| **修复后** | **REAL 默认 90s + 并行** | **1.00 / 1.00** | **0/20** | **真分** |

- **真相**：分类器在这 20 例上**真准（1.0）**；0.20/0.40/0.90 全是 8s 超时下"哪些例侥幸跑完"的抖动——**与分类质量无关**。我原证据**漏写当时用的 timeoutMs**，致审核方用默认值复不出 → "0.90"不可复现是我的证据缺漏。

## 根因解（已落·`evals.ts`）

1. **REAL 默认超时按真模型时延**：`opts.timeoutMs ?? (llmMode==="REAL" ? 90_000 : 8_000)`——量纲对齐，不再把"没跑完"当"判错"；MOCK 仍 8s（本地桩足够）。
2. **用例有界并行**（`mapLimit` 并发 4·保序）：避免 REAL 下 20×90s 串行(~30min)被网关/客户端二次超时；修复后真跑 wall=**68s**（vs 串行十几分钟）。
- 单测：`evals.test`/`evals-scenario-suite` 7 绿（并行/超时改不破既有·MOCK 1.0 不变）。

## 第二层根因（架构已支持·需选型·非本单代码改）

分类**慢的本质**=用了思考模型。`classifier` 已是**独立用途/角色**（`LlmPurposeSchema`/`ModelRoleSchema` 均含·注释"低延迟结构化输出"），QOS 分类按 `llmSettings.roleModel(tenant,"classifier",pkg.classifierModel)` 真路由。**把 classifier 绑非思维链快模型（一处配置）→ 分类 15–50s 降到 ~1–3s**，同时治真实用户 QOS 路由 ~50s 静默。模型选型由运营定，机制现成、无需改代码。

## 结论
WO-10② 机制（REST 透传 llmMode→REAL 真打）闭合 ✅；**「真分 0.90」修正为：分类真分=1.0（修复后·这 20 例），此前 0.20/0.90 皆 8s 超时量纲错配伪影**（守"绿测试≠能用"：连"真分"本身也被假量纲污染过，已纠）。Kimi 非确定性故不保证每跑 1.0，但绝非 0.20。
