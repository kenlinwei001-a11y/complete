# 验收日志 · QOS path-B 提速 真 Kimi 10 题 live 复测（一次性证据·非 CI）

> 目的：闭 QOS-1/2 + Phase4 的「绿测试≠能用」最后一环——真 Kimi 亲测墙钟真降 / 路由正确 / 诚实降级。
> 纪律：本文件是**一次性 live 验收证据**，**不进四包 gate / 不落网络测试**（CLAUDE.md 铁律：测试 LLM 一律 mock）。
> 基线：canonical `4ee94a94`（含 ACTION + Phase4 + global-sim PRD）。凭据经 provider AES-GCM 落库（`hasApiKey:true`·明文永不回显/提交），key 仅进程内解密调用。
> 服务：DataCore 4001 + AgentCore 4002（`SEED_DEMO=1`·inproc optimizer）。AgentCore residual 硬预算 env：`QOS_AGENT_MAX_ROUND_TRIPS=4`·`QOS_AGENT_MAX_DISCOVER_CALLS=1`·`QOS_AGENT_LLM_TIMEOUT_MS=60000`。

## 原始逐题数据（审核方认原始·非结论）

| # | 本体层·问句 | 视图 | path | model（求解器） | 墙钟 | discover | round-trip | refs | 答案状态 | 判 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | L1 化成 OEE+换型 | project-sim | A | deterministic:ceo-route(bottleneck_matrix) | 2.1s | 0 | 0 | 1 | 真答 | ✅ |
| 2 | L1 扩2通道补缺口 | project-sim | B(WORKFLOW/compose·kimi) | dcp:kimi-k2.5 | **56.1s** | 0 | 0 | 1 | **空(真无解)** | ❌ 慢+空 |
| 3 | L2 良率34天根因 | project-sim | A | deterministic:ceo-route(gap_attribution) | 2.0s | 0 | 0 | 1 | 真答(35叶/7边) | ✅ |
| 4 | L3 瓶颈工序 | project-sim | A | deterministic:ceo-route(bottleneck_matrix) | 2.0s | 0 | 0 | 1 | 真答 | ✅ |
| 5 | L4 正极长协覆盖 ★转圈回归 | dash | A | deterministic:ceo-route(decision_play) | 2.0s | 0 | 0 | 1 | 真答(matrix3/trig3)·**不转圈** | ✅（solver≠预期 supply_demand） |
| 6 | L4 夜班提前两周 | project-sim | A | deterministic:ceo-route(generic_inference) | 2.0s | 0 | 0 | 1 | **空(真无解)** | ❌ 空 |
| 7 | L5 4680+20%能接 | project-sim | A | deterministic:ceo-route(atp_check) | 2.0s | 0 | 0 | 1 | 真答 | ✅ |
| 8 | L5 SO-3402 全局重排 | global-sim | B(AGENT·free-llm) | agent:ceo-free-llm | 36.0s | 1(命中上限) | ≥1(降级) | 0 | **降级未答**·`[预算耗尽·诚实摘要]`+建 Action 草稿 | ❌ 未答（诚实降级） |
| 9 | L6 90天穿仓 | project-sim | A | deterministic:ceo-route(base_capacity_outlook) | 2.0s | 0 | 0 | 1 | 真答(dayPlan3/byModel3) | ✅ |
| 10 | 全链 储能份额逐层拆根因 ★Q5·137s 原例 | dash | A | deterministic:ceo-route(gap_attribution) | 2.0s | 0 | 0 | 1 | 真答(35叶/7边·缺口链) | ✅✅ |

**判定：7/10 通过 · 3 未过（#2 / #6 / #8）· 未达 ≥9/10。**

## 头号铁证（成立）
- **#10（Q5·原 137s 头号例）→ path-A `deterministic:ceo-route` gap_attribution · 2.0s**。137s → 2s，**QOS-1 确定性优先门生效**，逐层归因链在（atomicLeaves 35 / causalEdges 7）。
- 8/10 走 path-A 秒回 ≤2.1s；**误降级=0**（#2/#8 本就应 path-B，非窄 solver 自信错答）。
- **Phase4 硬预算生效**：#8 命中 `discover≤1` 上限 → 诚实降级 `[预算耗尽·诚实摘要]`（≤60s），不再是原 448s 挂死。

## 3 处真缺口（file:line·据实起 fix）
1. **generic_inference 空转（#2 扩通道 / #6 夜班·两题皆空）**
   - 路由正确：`apps/agentcore/src/router/ceo-route.ts:39` `RE_WHATIF` 命中 → `route=generic_inference`（:337）→ `whatIfArgsFrom`（:130·mode:"levers"·targetType:"Line"·targetProp:"utilization"·scopeObjectIds=base）。
   - 但求解器在 demo 数据/该 scope 下返回 `levers/deltas/rows` **全空（"真无解"）** → 答案空。**求解器/数据杠杆覆盖缺口**（非路由缺口）。#2 更叠加 56s（compose 路 kimi 综合一个空结果 → 慢且无用）。
   - 修向：generic_inference 的 Line.utilization 杠杆在 what-if scope 下需有可行项（扩通道/夜班 → 对应工序/产线杠杆），或路由把 scope 放宽到工序级；56s 需在 solver 空结果时短路 compose 综合。
2. **#8 global-sim 重排落 free-llm 降级**
   - SO-3402 全局重排（按期率）无对口 deterministic route（QOS-1 未命中）+ canonical `4ee94a94` **无 sim-compose 路由** → 落 `agent:ceo-free-llm` → 命中 discover≤1 → 诚实降级未答。
   - 根因：**sim-planner/compose 路由（WO-GSIM-4-AGENT·`apps/agentcore/src/agent/sim-planner.ts` + `orchestrator.ts:993 isSimComposeQuery→buildSimNavSlice`）尚未并入 canonical**（在 `claude/handoff-wo-gsim-agent`·已 rebase 到 4ee94a94 待合）。合并后 #8 应走 portfolio 组合路径而非 free-llm。

## 测量诚实交底
- `discover`/`round-trip` 取自 `/trace`——该端点返回 **FDE 节点图**（可视化），非 ReAct tool-steps。故 path-A/WORKFLOW（无 agent loop）= 0 为**构造性真值**；#8 的 `discover=1`（命中上限）由答案文本 `maxDiscoverCalls exceeded` 坐实，**精确 round-trip 需 SSE `agent.budget` 事件捕获·本轮未抓**（如实标注，不臆造数字）。
