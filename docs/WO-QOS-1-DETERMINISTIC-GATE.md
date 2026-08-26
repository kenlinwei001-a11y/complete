# WO-QOS-1 · 确定性优先门（含 domain 解析地基）· path-B 延迟治本

> 源：真 Kimi 20 题实测——单题 76~137s，**99% 时延在 LLM 盲目选型推理**，不在系统干活。
> 本单治本头号杠杆：**有对口确定性求解器的题，别送进慢 agent。**
> 合并自 PRD-agent延迟 的 WO-0（地基）+ WO-1（A 门）。

---

## 🚦 范围边界（只碰这些）

- `apps/agentcore/src/router/orchestrator.ts` —— 在 `:350` free-LLM 门**之前**加确定性优先判定。
- **新增** `apps/agentcore/src/router/domain-resolver.ts` —— 问句 → {domain, focus, intent, 候选对口 solver + match 置信}。
- **新增** `apps/agentcore/test/fixtures/qos-20q-goldset.ts` —— 20 题打标金标（三类）。
- **禁止**：改求解器算法、改 path-B agent 本体、改答案口径。只改"路由到哪条"。

---

## 干什么

### ① domain 解析器（QOS-1/2 共用地基·确定性 R6）
输入问句（+ PageContext）→ 输出 `{ domain, focus, intentKey, candidateSolvers: [{key, matchScore}] }`。
- 复用既有：`ceo-route.ts` 意图模式 + solver catalog（`SOLVER_OUTPUT_SHAPES`/catalog）。
- **确定性**：同问句同 seed 字节一致（无 LLM / 无时钟 / 无随机）。
- 这是 A 门置信 **与** WO-QOS-2 导航切片投影的**单一来源**——两处不许各写一份。

### ② 20 题金标（三类·A 门校准的标尺）
把 20 题打标为：① 有对口确定性 solver（应 path-A）② 需多 solver 编排（应 path-B）③ 真开放无 solver（应 path-B）。作为 A 门 precision 的量尺。

### ③ A 确定性优先门（治本）
`orchestrator.ts:350` free-LLM 门**之前**插：
```
const det = preferDeterministicSolver(domainResolve(query, pageContext));
if (det.confidence >= THRESHOLD && det.solverKey) {
  // 走 path-A：invoke_solver(det.solverKey) + 一次 LLM 润色/模板投影
  return runDeterministicSolverPath(taskId, auth, det);
}
// 否则照落下方 free-LLM / classifier —— 不劫持、字节兼容
```
- **fail-safe 铁律**：低置信 / 无匹配 → **照落 path-B**（绝不把开放题误降级给窄 solver 出"自信错答"）。
- THRESHOLD 用 ② 金标校准，使**误降级（本该 path-B 却被拉去 path-A）= 0**。

---

## 《本体引用与影响》（铁律0）

> 开工前读 `docs/SYSTEM-ONTOLOGY.md §3（QOS 编排链）/§8`。

- **对象/求解器**：`gap_attribution` / `kit_readiness` 等确定性求解器（只读消费·不改算法）；solver catalog + `SOLVER_OUTPUT_SHAPES`。
- **链路**：`Query --classify--> {path-A 求解器 | path-B agent}`——本单在 path-B 入口**前**加确定性优先门，把高置信题拉回 path-A。
- **闭断点**：**G-AGENT-BLIND-REACT**（路由侧一半）——有对口 solver 的题被 free-LLM 误降级到慢 agent。
- **不变量**：R6（解析确定性）· R13（path-A 走求解器 provenance 更强）· **不劫持**（低置信照落 path-B·字节兼容·既有行为不回归）· Entitlement 先于 authz。
- **回写**：新增"确定性优先门"节点 → 回写本体 §3 QOS 链路 + §8 断点状态。

## SEAM-GATE 组合测（真 20 题·活系统亲验·非各半绿）

1. **Q5「储能份额逐层拆根因」** → 活系统真跑 → `classification.model = deterministic`（非 `agent:ceo-free-llm`）· 落 `gap_attribution` · **总时延 <5s** · 答案缺口 27.8% 与求解器对齐。
2. **#20「综合分析连锁影响」（真开放）** → **仍走 path-B**（不误降级）。
3. **precision**：跑全 20 题金标 → **误降级 = 0**（本该 path-B 的一个都没被拉去 path-A）。

## DoD
1. 20 题金标稳定复现（R6）。
2. A 门 precision 误降级 = 0（硬门）。
3. **活系统 Q5 真跑 <5s + 答案 27.8% 不变**（绿测试≠能用·亲手真跑）。
4. 四包 gate 全绿；既有 QOS 路由测试不回归（字节兼容）。
5. 回写本体 §3/§8。

## 交付
- handoff 分支 **`claude/handoff-qos-det-gate`**，不碰正线。
- 审核方隔离复验：四包 gate + 真 20 题 SEAM（Q5<5s·#20 不降级·误降级=0）+ 亲跑 → cherry-pick。

**优先级** P0（最大收益·改动最小·先落）。**依赖** 无。**下游** WO-QOS-2 复用本单 domain 解析器。
