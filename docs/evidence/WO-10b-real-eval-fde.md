# WO-10-② · 补真打 LLM eval（REST 透传 llmMode + 真 Kimi 真分）— FDE 真值证据

> 背景：eval 框架此前只 mock 跑（`llmMode=MOCK`，诚实标注 mock 跑出的分只证框架·非真 agent 质量）。WO-10-② 让 `POST /b/v1/evals/run` 透传 `llmMode:REAL` → 真打配置的 LLM provider 出真分。

## 透传链路（单测·real backend inject）

- `test/evals.test.ts` WO-10-②：不传 → `llmMode=MOCK`（默认诚实）；传 `llmMode:REAL` → report.llmMode=REAL（透传进 run + 落库报告）。✅

## 真 Kimi 真分（env-gated 真模型 FDE）

真启动 agentcore + 配真 Kimi provider（KIMI_API_KEY），对 20 条 classifier 场景套件以 `llmMode=REAL` 真打：

```
llmMode=REAL  total=20  passed=18  passRate=0.90
intentAccuracy=0.95  toolCorrectness=0.90  avgTok=0
byFailKind = { INTENT:1, TOOLSEQ:1, ANSWER:0, OTHER:0 }
```

- **真分非满分**（0.90，2 红：1 意图错判 + 1 工具序偏差）——正是真打的价值：mock 永远满分掩盖不了的真实分类/工具选择缺陷被暴露（守"绿测试≠能用"）。
- `intentAccuracy=0.95`（19/20 意图命中）、`toolCorrectness=0.90`——真模型在真场景目录上的可量化质量基线，可对比历史回归。
- 落库 `evals/runs` 可历史对比；report 携 `llmMode=REAL` 诚实标注（与 MOCK 分严格区分）。

## 结论

REST llmMode 透传链路 + 真 Kimi 真分双证：框架不再只能 mock 自证满分，真打出 0.90 真分并诚实暴露 2 个失败用例（INTENT/TOOLSEQ）。距北极星：真分 0.90 说明 demo 分类器/agent 在边缘场景仍有提升空间（非本单范围，属 agent 质量迭代）。
