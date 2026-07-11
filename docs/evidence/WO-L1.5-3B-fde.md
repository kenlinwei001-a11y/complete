# WO-L1.5-3B · retrieve_similar_cases 薄 OBO 工具适配器 — FDE 交付证据

**交付者**：Dev-1 / Lane A（agentcore）  ·  **日期**：2026-07-11  ·  分支：`claude/vigilant-knuth-b1nmxn`

## 交付物摘要

在 agentcore 新增 `retrieve_similar_cases` 工具——一个**薄 OBO 适配器**：透传用户 JWT（OBO）调
DataCore `POST /a/v1/memory/cases/retrieve-similar`，原样返回 DataCore 侧计算的相似案例。
**AgentCore 绝不重算相似度**（pseudoEmbed/cosine/加权打分全在 DataCore·retrieveSimilarCases）。

暗发键 **`memory.cbr_retrieve`**（`defaultOn:false`）**双注册**：
- agentcore `features/registry.ts`（本 WO 新增·镜像）
- datacore `features.ts`（line 136·权威·Dev-2 已建）

该键门控 **agent 工具面可见性**：关闸 → `retrieve_similar_cases` 从 agent 暴露工具列表剔除（模型看不到=不存在·NG6·翻闸=字节一致）；开闸 → 工具可用，agent 可先查案例库再决策。

## 本体引用与影响

- 对象类型：`DecisionCase` / `SimilarityHit`（§2.H memory/CBR）·只读检索，不新增对象类型。
- 链路：AgentCore path-B agent 工具面 → OBO → DataCore `/a/v1/memory/cases/retrieve-similar`（§7 接缝）。
- 事件：无新增。
- 不变量：R1（跨包契约进 `@platform/contracts`·新文件 `cbr-retrieve.ts`）· R2（tenantId 由 DataCore 据 OBO 上下文注入·工具入参不含 tenantId·跨租户取不到）· R3（暗发·关=工具不存在·先于 authz）· R6（相似度确定性·DataCore 侧纯函数）· KILL-MOCK-RED（命中随行 origin+disclaimer·案例数字不冒充业务真值）。
- 门禁：`memory.cbr_retrieve`（新·双注册）。与 datacore 端点自身的 `memory.cbr_retrieve` 门**双保险**。
- 本体母体行为面无变化（工具集是既有 path-B 暴露列表的 additive 扩展·暗发关时字节一致），未回写母体、切片 hash 不变（`ontology-slices:check` 绿）。

## 真跑证据（铁律 0.4·真起服务·真数据·真看结果·LLM 隔离）

真起 datacore（`SEED_DEMO=1`·出厂 5 例 origin:SEED CBR 决策案例·端口 4001）。

### ① DataCore 端点直调（真值基线·DataCore 侧计算）
`POST /a/v1/memory/cases/retrieve-similar`  body `{"text":"常州产能缺口怎么办","problemClass":"capacity_gap","topK":3}` → HTTP 200：
```
total=5  hits=3
case_cd195923  score=0.211555  breakdown.embed=0.423109  origin=SEED  provenance=seed_cap_delay
case_7804d728  score=0.170581  origin=SEED  provenance=seed_displace_outsource
case_f2b9b984  score=0.139943  origin=SEED  provenance=seed_credit_hold
disclaimer=案例仅供决策路径/结构参考·业务数字以工具结果/审批真值为准（不作数字来源）
```

### ② AgentCore OBO 客户端（我新增的 HttpMemoryClient）→ 真 DataCore
用 agentcore `dist/tools/datacore-http.js` 的 `createHttpDataCore(...).memory.retrieveSimilar(ctx, input)`
（ctx 携 `debugUser: "demo:admin:admin"`·与执行器透传语义一致）打真 DataCore，输出与①**逐字节相同**：

```
BYTE-IDENTICAL(agentcore OBO output === direct datacore output) = true
```
→ **证明 agentcore 是纯透传**：分数/breakdown/origin/provenance/disclaimer 全部逐字来自 DataCore，
agentcore 未做任何相似度重算（无 embedding/cosine/加权）。

### ③ 暗发关闸 → DataCore 端点 404（双保险·Dev-2 网关）
新租户（无 override·`memory.cbr_retrieve` defaultOff）直调端点 → HTTP 404 错误信封：
```
{"error":{"code":"FEATURE_NOT_FOUND","message":"feature not found","requestId":"req_t41jq06fxhg96c65"}}
```
（注：demo 租户在 SEED_DEMO 下被出厂强开大量 defaultOff 功能，故用**新租户**演示原生关闸态。）

### ④ AgentCore 工具面可见性暗发（集成测试·真 orchestrator + 真 feature 解析 + mock LLM）
`apps/agentcore/test/retrieve-similar-cases-tool.test.ts`（5 tests·全绿）：
- 开闸（`memory.cbr_retrieve` 在 tenant 已解析集）→ `retrieve_similar_cases` **在**喂给 LLM 的 tools 列表 + OBO 真打到 DataCore memory 端点（透传 args）。
- 关闸（解析集不含该键）→ 工具**完全不在** agent tools 列表（暗发·工具不存在·agent 行为字节一致 NG6）。
- 契约边界：缺 `text` → 工具回 ERROR（contracts zod 强校验·不静默）。
- 薄 OBO：exec.run 转发入参到 `memory.retrieveSimilar`（topK 生效）·分数/origin/disclaimer 原样回传（非 AgentCore 造）。

## 门 / 测试结果

- `pnpm --filter @platform/contracts build` ✅ · `pnpm --filter agentcore build` ✅ · `pnpm --filter datacore build` ✅
- `ontology-writeback:check` ✅ · `ontology-slices:check` ✅（母体未改·hash a7c714ad9b7f80ed 不变）
- `pnpm --filter agentcore test` ✅ **730 passed | 4 skipped**（既有 725 + 新 5·零回归）
- 双注册 check：`key: "memory.cbr_retrieve"` 在 agentcore registry.ts 恰 1 次 + datacore features.ts 恰 1 次。
- package.json `gates` 未改（check-decision-kernel/-case/-workflow-dag/-requirement-graph/-execution-planner 全在）。

## 诚实边界 / 声明

- MockMemoryClient（agentcore 测试替身）**不做相似度数学**——返回确定性固定夹具（同 MockSolverClient 范式），
  真相似度真值以真 DataCore OBO 联调为准（本文 ①②）。这是 DataCore 的测试替身，非 agentcore 重算。
- agent 端到端真跑（真 LLM 驱动 agent 主动调该工具）未做：本部署无 LLM 密钥·LLM 一律 mock（铁律 0.4）。
  工具可见性/OBO 透传/不重算三点均以真 DataCore + 真 orchestrator/真 feature 解析（mock LLM）证实（①②④）。
