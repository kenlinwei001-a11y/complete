# PRD · QOS path-B Agent 推演延迟优化（导航切片 + 确定性优先 + 规划式执行）

> 触发：真 Kimi k2.5 复杂推演 20 题实测——单题 76~137s，**99% 时间不在系统干活、而在 LLM 逐跳"盲目 ReAct"选型推理**。
> 纪律：本 PRD 结论**全部经活系统真跑核实**（非臆断），含《本体引用与影响》。基线 canonical `claude/inspiring-gates-aqczjg`。

---

## §1 问题定量（活系统真跑·Q5/Q2 逐步解构）

**Q5「储能份额没达标·逐层拆根因」**：PASS·总时延 **137.7s**·17 工具步。

| 维度 | 实测值 |
|---|---|
| 工具执行总耗时（切片+源数据+规则+求解器 17 步 Σ durationMs） | **1.18s** |
| 总时延 | 137.7s |
| **LLM(kimi-k2.5) 推理总耗时** | **136.5s（99.1%）** |
| LLM round-trip 数 | 18（每步前一次决策 + 1 综合） |
| 平均每次 LLM 决策 | **~7.6s** |
| 其中「能力发现/选型」推理（5 次 discover 前后） | **~38s** |
| 最终「综合答案」推理 | 仅 ~8s（1 次） |

**Q2「物料齐套率+补齐」**：PASS·76.6s·11 步·工具总耗时 0.8s → 同样 ~99% 在 LLM 推理。

**核心真相**：agent 花 137s **手动重新编排的那条流水线，`gap_attribution` 一个确定性求解器内部早已封装**（自读 bottleneck_matrix/mrp/对象→出三层归因→缺口 27.8%，与 agent 答案一字不差）。17 跳里真正不可省的只 1 个求解器调用；**其余 16 跳全是 LLM 在"没有地图"的前提下逐步盲选**（该调哪个能力/对象/下一步）。

> 「能力发现」耗时 ≠ discover 工具（ms 级），而是 **LLM 判断"用哪个求解器"的选型推理**。这正是本 PRD 要消灭的成本。

---

## §2 根因（沿链路·file:line 坐实）

| # | 根因 | 位置 | 后果 |
|---|---|---|---|
| R1 | **确定性路由被 free-LLM 抢** | `orchestrator.ts:349`（`freeLlmEnabled && shouldUseFreeLLM` 命中即进 agent） | Q5/Q2 明明有对口确定性求解器（gap_attribution/kit_readiness），却被送进慢 agent |
| R2 | **agent 被 prompt 明令"盲目 discover"** | `prompts.ts:28`「先用 discover/query_objects 查清…再 invoke_solver」 | 手里无地图 → 逐跳 discover 选型 → ~38s 选型推理 |
| R3 | **无预注入「导航切片」** | agent 首轮 prompt（`buildAgentUser` `prompts.ts:167`）只带 PageContext，不带"本题相关对象/求解器/链路"地图 | LLM 只能拿到 22 个求解器的**扁平目录**，判不出哪个对口 → 反复试探 |
| R4 | **ReAct 逐跳而非规划式** | `agent/loop.ts` 循环：想→调**一个**工具→想→再调 | 17 步 = 17 次串行 LLM round-trip（×7.6s） |

---

## §3 方案（4 杠杆·按收益排序·P0=A+B）

### A · 确定性优先门（P0·治本·最大收益）
进 free-LLM 前先跑 `resolveCeoRoute`；若**高置信命中对口确定性求解器**（问句意图 + 求解器 catalog 匹配度 ≥ 阈值）→ 走 **path-A**（求解器 ~30ms + 一次 LLM 润色/或模板投影），**不进 agent**。仅"真开放/跨域/无对口 solver"（如 #20 综合分析）才落 path-B。
- 位置：`orchestrator.ts:349` 加前置判定 `preferDeterministicSolver(route, confidence)`。
- 效果实测锚：Q5 → gap_attribution path-A → **137s → ~3s**。
- 守则：低置信/无匹配**不劫持**（照落 path-B·字节兼容·绝不把开放题误降级）。

### B · 导航切片注入（P0·你要的"导航仪"·治剩下真需 agent 的题）
进 agent 前，据问句 focus/domain 预算一张 **NavigationSlice**——本题相关的：① 对象类型 + 关键属性 ② **对口求解器（key + 一句话能力 + 输出形状 SOLVER_OUTPUT_SHAPES）** ③ 链路（对象→求解器→答案）④ 相关规则。注入 agent 首轮 system/user prompt。
- agent 一眼见地图 → **跳过 discover round-trip + 一次性规划**工具序列。
- 删 `prompts.ts:28`「先 discover」盲目指令，改「已给你本题导航图，直接按图取证」。
- 复用既有：`catalog.ts discover` 供给侧 + `ontology/slice-index` 切片 + `SOLVER_OUTPUT_SHAPES`。NavigationSlice = 三者按问句 domain 的一次性投影（确定性 R6·非 LLM 生成）。
- 效果：省 4-6 跳（~40-60s）。

### C · 规划式执行 + 一轮多工具并发（结构性）
ReAct → **plan-then-execute**：① 一次 LLM 出完整 plan（工具序列，基于 NavigationSlice）② **并行/批量执行**工具（loop 支持一轮多 tool_use·~1s）③ 一次 LLM 综合。2 次 LLM(~20s) 替代 17 次(137s)。
- 位置：`agent/loop.ts` 增 plan 模式（保 ReAct 兜底：plan 覆盖不到再逐跳）。

### D · 模型分层（模型层）
路由/规划/选型用**快模型**（或确定性），`kimi-k2.5` 推理档只做**最终综合**。选型不需要深推理。

---

## §4 SEAM 验收（接缝驱动·活系统亲验·非各半绿）
1. **A**：Q5「储能份额逐层拆根因」→ 活系统真跑 → `classification.model=deterministic:ceo-route`（非 agent:ceo-free-llm）· 落 gap_attribution · **总时延 <5s** · 答案缺口 27.8% 对齐求解器。对照：#20「综合分析连锁影响」仍走 path-B（不误降级）。
2. **B**：真需 agent 的题（如 #18 多求解器编排）→ agent 首轮 prompt **含 NavigationSlice**（相关求解器 + 输出形状）· 运行轨迹 **discover 调用数从 4-5 降到 ≤1** · 总跳数明显降。
3. **C**：同题 plan 模式 → LLM round-trip 数 ≤4（vs ReAct 17）· 工具并发执行 · 答案不劣化。
4. R6：NavigationSlice 确定性投影（同问句同 seed 字节一致·无 LLM）。四包全绿 + 本体回写。

---

## §5《本体引用与影响》（铁律0）
- **对象类型（§2）**：`Metric`/`CausalFactor`（gap_attribution 归因）· `Order`/`MaterialBalance`（kit_readiness）· `Slice`/`SliceSpec`（NavigationSlice 派生源）· 各 `Solver`（catalog + SOLVER_OUTPUT_SHAPES）。
- **链路（§3·改动点）**：QOS 编排链 path-B —— `Query --classify--> {path-A 确定性求解器 | path-B agent}`。本 PRD：① **A** 在 `orchestrator.ts:349` 加"确定性优先门"，把高置信题从 path-B 拉回 path-A；② **B** 在 path-B 入口注入 NavigationSlice（`discover 供给侧 + slice-index + SOLVER_OUTPUT_SHAPES` 的确定性投影）；③ **C** path-B 循环改规划式。**不改求解器算法、不改答案口径**——只改"怎么更快到达同一答案"。
- **事件（§4）**：复用 `step.started`/`step.completed`（NavigationSlice 注入 = 首轮 prompt 内容·非新事件）· `answer.final`。**不新增事件名**。
- **不变量（§5）**：**R6**（NavigationSlice 确定性投影·无 LLM/时钟/随机）· **R7**（错误信封不变）· **R13**（答案溯源 ⟦ref⟧ 不劣化·path-A 走求解器 provenance 更强）· **绿测试≠能用**（活系统真跑时延·非只 unit）· **不劫持**（低置信照落 path-B·字节兼容）。
- **断点（§8·新登）**：**G-AGENT-BLIND-REACT**——「path-B agent 无导航切片·逐跳盲目 ReAct 选型·99% 时延在 LLM 选型推理而非系统干活；且有对口确定性求解器的题被 free-LLM 误降级到 agent」。修法 = A 确定性优先门 + B 导航切片注入 + C 规划式执行。关联 `WO-REAL-LLM-FREE-QUERY`（free-LLM 门·本 PRD 收窄它）、`G-9`（path-B 有界降级·本 PRD 让它更少触发）。

## §6 派发建议
- **WO-1（P0·A 确定性优先门）**：一个 agentcore dev·`orchestrator.ts` 路由门 + SEAM「Q5 走 path-A 秒回·#20 不误降级」。收益最大、改动最小、先落。
- **WO-2（P0·B 导航切片）**：一个 dev·NavigationSlice 投影器（datacore/agentcore 接缝）+ agent prompt 改造 + SEAM「agent 首轮见图·discover ≤1」。
- **WO-3（P1·C 规划式执行）**：一个 dev·loop.ts plan 模式 + 并发工具 + SEAM「round-trip ≤4」。依赖 WO-2 的 NavigationSlice。
- 复验头号判据：**活系统 Q5 真跑 <5s + 答案 27.8% 不变**（绿测试≠能用·亲手真跑）。

---

## §7 实现状态与审核精炼（入库时补·审核方）

> 本 PRD 为 QOS path-B 延迟优化的**设计存档**。设计经审核精炼、已实现落地、四包全绿并集成上 canonical。

### 7.1 审核精炼（叠加在原 §3/§6 之上）
- **WO-0 前置地基**：domain 解析器 + 20 题三分类金标，为 A 门置信与 B 切片投影的**共用单一来源**（原 PRD 未拆此地基 → A 门置信无处来）。
- **A 门 fail-safe（硬门）**：低置信/无匹配一律照落 path-B，precision **误降级=0**（宁慢，不误降级给窄 solver 出"自信错答"——慢是体验、错是信任）。
- **D 是乘数非可选**：快模型做选型/规划贯穿 B/C。
- **C plan 自检**：plan 内 solver 必在 NavigationSlice 内，否则回退 ReAct。

### 7.2 落地（已集成 canonical·四包全绿·SEAM 驱动通）
- **WO-QOS-1 确定性优先门**（`c1803364`）：`router/domain-resolver.ts` + `orchestrator.ts` 确定性优先门 + `test/fixtures/qos-20q-goldset.ts` + `test/qos-det-gate-seam.test.ts`（6/6）。SEAM：误降级=0 · Q5→path-A `deterministic:ceo-route` · #20→path-B · R6 · 字节兼容（不劫持）。
- **WO-QOS-2 导航切片+规划式**（`9a0ad16c`）：`agent/navigation-slice.ts`（按每 agent scopeDeclaration 投影） + `prompts.ts`（删"先盲目 discover"→切片驱动） + `loop.ts` plan 模式 + `engine.ts` 接线 + `test/qos-agent-slice-seam.test.ts`（11/11·全 agent 不回归）。
- **过渡创可贴**：free-LLM 预算 90s→600s（`0a054641`·`contracts/qos.ts`）。QOS-1/2 提速经 live 测确认后应回调此预算（勿长期以 600s 掩盖"agent 慢"）。

### 7.3 本体
- 闭 **G-AGENT-BLIND-REACT**（路由侧 QOS-1 + agent 侧 QOS-2）→ 已回写 `docs/SYSTEM-ONTOLOGY.md §8`。

### 7.4 待确认（绿测试≠能用·唯一未闭环）
- 终极提速确认 = **真 Kimi 20 题 live 重测**（原 §1 观测 137s → 目标 path-A <5s / path-B <10s）。SEAM 证机制对（路由/切片逻辑），**live 测证墙钟真降**。
