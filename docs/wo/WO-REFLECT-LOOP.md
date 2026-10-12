# WO-REFLECT-LOOP · Agent 反思/重规划闭环（理解-计划-分解-执行-反思）

> 一句话：agent 循环现在靠模型自己调 final_answer 收尾、失败无复盘。加一道**反思步**——收尾前自检，不过关就重规划重试。

## 背景
`agent/loop.ts` 现状 = plan→execute→synthesize，靠模型自调 final_answer 或预算耗尽收尾，**无显式反思**。失败时缺"复盘→重试"。补它 = 补齐「理解-计划-分解-执行-**反思**」闭环。

## 🚦 文件边界（只碰这些）
- `apps/agentcore/src/agent/loop.ts`
- `apps/agentcore/src/agent/reflect.ts`（新）
- `apps/agentcore/test/**`
- **禁碰** `router/orchestrator.ts`/`domain-resolver.ts`（WO-0 领域）。

## 产出
1. **`reflectAnswer(task, runRecord, answer)`**（R6 复盘清单为主）挂在收尾判定处（模型将调 final_answer 时先过一遍）：
   - 答了吗（blocks 非空·非"未能产出回答"占位）
   - 数字落地（每业务数字有 ⟦ref:N⟧ 且 N 在 provenance 范围）
   - 工具静默失败（runRecord 有 error/EMPTY 但答案没体现）
   - 越 scope（引用了 scopeDeclaration 外对象域）
   - 口径一致（复用 `ontology.crossValidate`）
2. **重规划-重试**（硬有界·默认 replanBudget=1）：不过关 ∧ 预算未尽 → 把"不过关原因"回注 loop 重规划一轮 → 再 reflect；预算尽 → 走现有 `synthesizePartialFindings` 诚实收尾并标"反思发现的缺口"。
3. **Solver-first 打回**（同 dev 整单·别拆）：排产/优化题没调过 solver，或数字未 ⟦ref⟧ → reflect 判"数字红线违规"→ 打回重规划（强制走 solver）。
4. **观测**：`AgentRunRecord.reflected/replanReason`（不改数字/溯源·对齐 planFellBackToReAct 手法）。
5. entitlement `agent.critic`（defaultOff·暗发）守可选 LLM critic（fail-open 退纯确定性）。

## 硬约束
- **仅 path-B `runAgentLoop` 生效**；path-A 确定性/compose 直出**不进反思**（字节兼容零回归）。
- **R6**：复盘以确定性检查为主；LLM critic 为 advisory·fail-open。
- 复用既有 `crossValidate`/`synthesizePartialFindings`（不新造校验/兜底）。

## SEAM 门 / 验收（头号判据）
- `reflect-loop-seam.test.ts`：构造"工具静默失败"场景 → reflect **拦下并重规划一次**（对比关闭 reflect 时会漏发半成品）；Solver-first：排产题没调 solver → 打回。
- **字节兼容**：关 reflect / path-A 命中题零回归。
- 四包全绿；handoff `claude/handoff-wo-reflect-loop`。

## 依赖
- WO-0 已落（避 orchestrator 接缝）。与 **CONTEXT-COMPRESSION 都碰 loop.ts → 同 dev 整两单 或先后串行**。

## 参考
`docs/PRD-agent-react-harness.md` §7（反思闭环全文）；`docs/BLUEPRINT-DRIL-decision-dialogue.md` §1 阶段④。
