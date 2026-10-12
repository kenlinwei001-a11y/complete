# WO-QOS-2 · path-B agent 提速（导航切片 + prompt 改造 + 规划式执行 + 模型分层）

> 治"落到 path-B 的真开放题"：agent 手里**没有地图**，逐跳盲选 ~7.6s×17 步。
> 合并自 PRD-agent延迟 的 WO-2（B 切片+prompt）+ WO-3（C 规划）+ D（模型分层）。
> **系统级改造**——`AGENT_SYSTEM_CORE` 被全部 agent 继承，本单动的是所有 agent。

---

## 🚦 范围边界（只碰这些·系统级·一个 dev 整单）

- **新增** `apps/agentcore/src/agent/navigation-slice.ts` —— NavigationSlice 投影器（复用 WO-QOS-1 的 `domain-resolver.ts`）。
- `apps/agentcore/src/agent/prompts.ts` —— 改 `AGENT_SYSTEM_CORE` 【工作方式】+ `CEO_DEEP_QUESTION_SYSTEM` 深问段（删"先盲目 discover"）。**⚠ 系统级：`engine.ts:203` 全部注册角色 agent + `orchestrator.ts:921/1039` 默认/深问 path 全继承。**
- `apps/agentcore/src/agent/loop.ts` —— 加 plan-then-execute 模式（保 ReAct 兜底）。
- `apps/agentcore/src/agent/skill-router.ts` / model 路由 —— D 模型分层。
- **禁止**：改答案口径、改 scopeDeclaration 隔离语义（越界拒不变）。

---

## 干什么

### B · NavigationSlice 注入（治盲选）
进 agent 前，据问句 domain（**复用 WO-QOS-1 `domain-resolver`**）投影一张本题地图：① 相关对象类型+关键属性 ② **对口求解器（key + 一句话能力 + 输出形状 `SOLVER_OUTPUT_SHAPES`）** ③ 链路（对象→求解器→答案）④ 相关规则。注入 agent 首轮 system/user。
- **按每 agent 的 `scopeDeclaration`（objectTypes/toolNames）投影**——不是 CEO 写死一张全局图（7 角色 agent 各自 scope 不同）。
- **确定性 R6**：同问句同 seed 字节一致（无 LLM）。

### prompt 改造（配合 B·单改文案无效）
- 删 `AGENT_SYSTEM_CORE` 【工作方式】/ `CEO_DEEP_QUESTION_SYSTEM` 里的"先 discover→逐跳（查对象→算求解器→再查）"盲目起手式。
- 改为："**已给你本题导航图；有对口求解器 → 直接调它一步到位、别逐跳重编排；只有真开放/无对口 solver 才多跳探索。**"
- **保留**：4 条红线 + 收尾纪律（final_answer 唯一出口）+ "只读工具同轮并行"+"事实已足立即收尾不空转"。thoroughness 留给真开放分支。

### C · plan-then-execute（治 17 次串行 round-trip）
ReAct → ① 一次 LLM 出完整 plan（基于 NavigationSlice 的工具序列）② 并行/批量执行工具（loop 已支持一轮多 tool_use）③ 一次 LLM 综合。
- **plan 自检**：plan 里引用的 solver 必须在 NavigationSlice 内，否则**回退 ReAct**（plan 覆盖不到再逐跳）。

### D · 模型分层（治每跳 ~7.6s）
路由/规划/选型用**快模型**（或确定性），`kimi` 推理档只做**最终综合**。选型不需要深推理。

---

## 《本体引用与影响》（铁律0）

> 开工前读 `docs/SYSTEM-ONTOLOGY.md §3/§8`。

- **对象/求解器**：`Slice`/`SliceSpec`（NavigationSlice 派生源）· solver catalog + `SOLVER_OUTPUT_SHAPES`（只读投影）。
- **链路**：path-B agent 循环——本单在**入口注入切片** + **循环改规划式**，不改求解器/答案口径。
- **闭断点**：**G-AGENT-BLIND-REACT**（agent 侧另一半）——无导航切片逐跳盲选。
- **不变量**：R6（切片确定性投影）· R13（溯源不劣化）· **系统级回归**（全部 agent 行为/溯源不变·只变快）· scopeDeclaration 越界拒不变。
- **回写**：切片注入 + 规划式 = path-B 链路结构变 → **必回写本体 §3 QOS 链路 + §8 G-AGENT-BLIND-REACT 闭合状态**。

## SEAM-GATE 组合测（真 20 题·全 agent·非各半绿）

1. **真需 agent 的题（如 #18 多求解器编排）** → agent 首轮 prompt **含 NavigationSlice**（相关 solver + 输出形状）· 运行轨迹 **discover 调用 4-5 → ≤1** · round-trip **17 → ≤4** · 答案不劣化。
2. **全 agent 不回归**（系统级铁证）：7 角色 agent（风险/产能/质量/供应链/财务/碳/通用）+ coordinator 扇出 + CEO 深问，改 `AGENT_SYSTEM_CORE` 后**行为/溯源不变、只变快**——各自现有测试全绿。
3. **R6**：NavigationSlice 同问句同 seed 字节一致（无 LLM）。

## DoD
1. **全 agent 回归绿**（改共享 core 的硬门·非只测 CEO 那条）。
2. NavigationSlice 确定性（R6）· round-trip ≤4 · discover ≤1。
3. **活系统真开放题真跑 <10s**（D 生效·绿测试≠能用·亲跑）。
4. 四包 gate 全绿；回写本体 §3/§8。

## 交付
- handoff 分支 **`claude/handoff-qos-agent-speed`**，不碰正线。
- 审核方隔离复验：四包 gate + 真 20 题 SEAM（切片注入·round-trip≤4·**全 agent 不回归**）+ 亲跑真开放题 <10s → cherry-pick。

**优先级** P0/P1（治剩下真需 agent 的题·结构性）。**依赖** WO-QOS-1 的 `domain-resolver`（切片投影复用）。
