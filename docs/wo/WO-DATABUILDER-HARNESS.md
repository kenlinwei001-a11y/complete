# WO-DATABUILDER-HARNESS · 数据构建发动机升级为会诊断+补齐的 harness agent

> 一句话：数据构建"agent"现在是**一次性 LLM 抽取（comprehend）+ 关键词地板**，不是会推理的 agent。真跑证明它卡在 NO_INTENT 不自补、灰节点（OEE/物流时长）永远补不上。本 WO 让引擎真"知道如何补齐"。

## 背景（真跑铁证·DATABUILDER-SELFIMPROVE-LOG 迭代0）
- `comprehend`（`datacore/databuilder/comprehend.ts:12-14`）= 一次性 LLM 产"对象/规则/solver 三件" + 缺 LLM 关键词地板兜底·还"偶发自造语义名"（:143）。**不是完整 harness agent**（无 ReAct/工具/反思/自检）。
- **真跑 Q1**"OEE/物流时长时序推演"→ `growth/probe` 诊断 **NO_INTENT**（非 EMPTY_DATA）→ `growth/run` `advanced:false`（`scenario-grow.ts:32,93-95`：NO_INTENT 不在 SCAFFOLDABLE→只开工单）→ BOUNDARY。**引擎根本没走到数据层**。
- 灰节点（RiskBoardView 物流时长/设备OEE·"合成·未接实测"）= EMPTY_DATA，**该被引擎自动诊断+补，现停在诚实灰**。

## 🚦 文件边界（跨 A+B·一个 dev 整单·别拆）
- `apps/agentcore/src/growth/scenario-grow.ts`（fill 分派·NO_INTENT/EMPTY_DATA 自补）
- `apps/agentcore/src/growth/scaffold.ts`（+`scaffoldDraftIntent`）
- `apps/agentcore/src/growth/data-boundary.ts`（decideDataGap·时序维度接地）
- `apps/datacore/src/databuilder/comprehend.ts`（comprehend 升级为多步·可选）
- `apps/*/test/**`
- 禁碰：DRIL 检索实现（本 WO 消费其结果·见依赖）。

## 产出（三层弱点逐一补·每层含 SEAM）
1. **NO_INTENT 自补**（第一弱点·loop 迭代1 起点）：`scaffoldDraftIntent(deps,tenantId,query)` scaffold DRAFT 意图（绑 `scaffoldDraftPlan` 计划·query 触发例·status DRAFT 待审批 R4）；`scenario-grow.ts` fill 让 NO_INTENT → 自补 → `advanced:true`（同 NO_PLAN 口径）。
2. **EMPTY_DATA 时序自补**（灰节点·第二弱点）：`decideDataGap` 支持"时序维度"（物流时长/OEE 逐日）——真实基地实体 → **HARD 真人正门 DataRequest**（KILL-MOCK·不伪造真实体时序）；无具体实体 → **SOFT 合成 PROVISIONAL 时序**。补后灰节点从"诚实灰"变"PROVISIONAL 有数（标未接实测）"或"精确 DataRequest 待人工补"。
3. **comprehend 升级为 harness**（第三弱点·可分期）：从一次性抽取升为**多步**（复用 DRIL 检索找对口 solver/slice + reflect 自检"补的对不对"），消"自造语义名"。

## 硬约束（KILL-MOCK 是本 WO 的命门）
- **真实业务实体的数据绝不静默伪造**：走 HARD 真人正门（`decideDataGap`）出精确 DataRequest·人工/连接器导入。SOFT 合成仅限无具体实体·且标 PROVISIONAL。
- **R6 确定性**：classifyGap/decideDataGap/scaffold 全确定性纯函数（同输入同输出）。
- **R14 零业务常数**：补的数据结构从本体派生·不写死电池数字。
- **R4**：scaffold 产 DRAFT·不自动发布。

## SEAM 门 / 验收（头号判据 = 真跑 gapCode 前进）
- `growth-autofill-seam.test.ts`：① NO_INTENT query → run → `advanced:true` + 意图草稿产出；② EMPTY_DATA 时序 query（无具体实体）→ SOFT 合成 PROVISIONAL；③ EMPTY_DATA + 真实基地 → HARD DataRequest（不静默合成）。
- **真跑收敛（env-gated）**：Q1"OEE/物流时长时序" 经 growth/run → gapCode 从 NO_INTENT 一路前进（NO_INTENT→NO_PLAN/EMPTY_DATA→…），不再恒 BOUNDARY。
- 四包全绿；handoff `claude/handoff-wo-databuilder-harness`。

## 依赖
- **DRIL**（开放长尾检索·PRD-decision-resource-intelligence-layer）：comprehend 升级消费其检索结果找对口 solver/slice。
- **WO-0/WO-CLASSIFIER-PROMPT**：让 NO_INTENT 从源头减少（自补是兜底·路由准是治本）。

## 参考
`docs/DATABUILDER-SELFIMPROVE-LOG.md`（真跑证据 + 自完善 loop 逐轮）；`docs/BLUEPRINT-DRIL-decision-dialogue.md` §3（数据接地环·被 NO_INTENT 上游阻断实测）。
