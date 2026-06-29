# 1C · 规则文档抽取解析率（A2 extraction · Kimi 复杂 schema 保真）— FDE 证据

> 目标（HANDOFF-1C）：真打 Kimi 时复杂嵌套抽取 schema 解析不出候选（candidateCount=0·段 FAILED「unparseable」）→ 修到 candidateCount≥3、段非 FAILED、候选可进规则库。红线：绝不塞假候选过门。

## 根因（对码定位）

- 抽取走原生结构化 `OpenAiLlmClient.parse()`（`packages/llm-adapters/src/openai.ts`）：单次 `JSON.parse(extractJsonText)` + 单次 `schema.safeParse` → 任一失败即 `return null` → 段 FAILED。**该路径零重试**（对比 classify 有重试）。Kimi-k2.6 对复杂嵌套候选数组 json_schema 保真不足 → 单次失败概率高。

## 修法（HANDOFF ②为主 + ③辅；① 未触发）

- **② parse 有界纠错重试 ≤2**（治本兜底）：`parse()` 改循环——safeParse/JSON.parse 失败时，把上次输出 + 具体 zod 校验错误回灌，要求「严格按 schema 重出、只输出 JSON、无围栏」，最多 3 次（首次+2 重试）；仍失败才 null（保留诚实降级·不塞假数据）。与 classify 重试范式对齐。
- **③ 抽取 prompt JSON 纪律**（`ruledocs.ts EXTRACTION_SYSTEM`）：补「严格只输出符合 schema 的 JSON、无解释无围栏；单条也放进 candidates 数组；无规则返回 {"candidates":[]} 不省字段」，提升首次保真。
- ① 降 schema 复杂度（拆分步）**未触发**——②③ 后真 Kimi 已达标（见下），不引入更重的链路改造（避免过度工程）。

## 单测（mock·证重试机制）

`packages/llm-adapters/src/openai.test.ts`（+3）：
- 首次 shape 不合 schema → 纠错重试 → 第二次有效（calls.n=2）✅
- 连续 3 次不合 → null（有界 ≤2·不塞假数据，calls.n=3）✅
- 首次有效 → 不重试（成功路径零额外调用，calls.n=1）✅
- 既有 5 classify/extractJsonText 测试不退化（15/15 绿）。

## 真 Kimi 实跑 FDE（env-gated·真 moonshot·judging oracle）

真起 datacore(:4201,SEED_DEMO=1,KIMI_API_KEY 真 Kimi)，POST /a/v1/rule-docs 3 条中文业务规则（需求波动>50%人工复核 / 利用率>95%产能预警 / 库存周转<7天补货审批）：

**结果（真 Kimi·HTTP 202 in 314s·doc_2hp0kjz4qnv1bggq）**：
```
candidateCount=4   droppedCandidates=0   status=IN_REVIEW（非 FAILED）
候选（3/4 含可解析 DSL 表达式·sourceQuote 全过子串校验）：
  • 需求波动阈值              expr=Order.demandDelta > 0.5            sev=BLOCK
  • 电芯产线产能超载预警阈值  expr=ProductionLine.cellUtilizationRate > 0.95  sev=WARN
  • 产能超载调度介入要求      expr=(空·叙述性无法形式化·按规约置空)  sev=WARN
  • 关键物料低库存周转补货审批 expr=Material.inventoryTurnoverDays < 7  sev=BLOCK
```
- **判据① 达标**：candidateCount=4 ≥ 3（修前 =0），段状态 IN_REVIEW 非 FAILED「unparseable」。
- **判据② 达标**：候选结构合法——3 条带规则 DSL 可解析 expression（`Type.field <op> number`）+ severity + sourceQuote 逐字命中（子串校验 0 dropped）→ 可进规则库被引用；第 4 条叙述性内容按规约 expression 置空（诚实，非塞假）。
- **判据③ R6/诚实**：retry 是确定性纠错策略（回灌错误·非时钟随机）；解析失败仍 null 不塞假候选（单测证）。

**诚实缺口（真跑暴露·已记 §HANDOFF 边界外）**：抽取为**同步 HTTP**，3 段 × Kimi reasoning（含重试）耗 **314s** → 首次客户端 2min 超时把同步 handler 中断（doc 停 PARSED）。本轮持连 600s 才拿到 202。**根因建议（另列单·非本单范围）**：rule-docs 抽取应转**异步 job**（与连接器 sync 一致·前端轮询），否则长 LLM 抽取阻塞 HTTP、易被任何客户端/网关超时中断。本单只解「解析率 0→4」，不改同步/异步架构。

## 本体回写

- 无：只改抽取解析鲁棒性（parse 重试 + prompt），未改链路/对象/门禁/schema 形状/事件（符合 HANDOFF「预计不回写」）。
