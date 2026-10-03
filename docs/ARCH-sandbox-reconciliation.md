# 推演沙盘 · 与现有 PRD/实现的对齐与去重（避免与其他 agent 并行开发打架）

> 为什么写：分支在动——**其他 agent 已基于我的历史 PRD 在开发**（守卫 bug 修复 `77f2775`、场景卡发育闭环 P1 `e06b8c8`/P2 `e274fb5`、S03/S06 断点修复 `deec28e` 全部已落）；且**沙盘的多数零件早有 PRD、部分已实现**。若把"沙盘"当绿地新设计推，会与正在建的东西冲突。本文把沙盘**重新定位为既有零件的整合层**，明确归属，并标注我哪些文档已过期。
> 一句话：**沙盘 = 把已有的 sim-views（交互重算）+ A8（模拟时钟）+ recompute（传导雏形）+ replay-orchestrator（走正门回放）+ ontogenesis（卡 grow）整合升级为"有状态、可分支、统一 UI"的交互沙盘——不是另起一套。**

---

## 1. 能力归属矩阵（沙盘每块 → 谁已经拥有 → 沙盘只补什么）

| 沙盘能力 | 已有 PRD/实现（owner，**沙盘必须复用/扩展，不重写**） | 实现状态 | 沙盘**新增**的（且仅此） |
|---|---|---|---|
| 交互"改参即重算" | **`PRD-frontend-addendum-sim-views`**：project-sim 渲染器 + `POST /b/v1/solvers/:key/run` 同步重算 + debounce 300ms + 采纳→action-drafts | ✅ ProjectSimView/useLiveSolver 已建 | 把"单发重算"升为**多 tick 有状态**会话 |
| 模拟时钟 / 时间推进 | **`PRD-addendum-a8-timeseries`**：推进模拟时钟→全链(聚合→派生→规则→看板)活起来；`SimulationClock.tick` | ✅ simclock.ts 已建 | 把"全局时钟"作**沙盘会话内的 tick**（scoped，不污染真值） |
| 风险传导/影响半径 | **TODO-fde §8b**：`recompute`(反向依赖闭包重算)=传导雏形；规模不够再封 Soufflé/Datalog；`supplier_disruption_radius`/`concentration_risk` 已落 | ◐ recompute 雏形已有 | **系数+延迟**沿 link 的逐 tick 传导（接「规则即引用」rule.params） |
| 走正门、确定性回放 | **`PRD-addendum-replay-orchestrator`**：虚拟操作团队经真实 API 跑人环，**禁直写结果表**，可下钻可审计 | ◐ PRD 在 | 沙盘态 Action 复用此"走正门"红线（采纳才 R4 写真值） |
| what-if（不提交重算） | `generic_inference`/`recompute(dryRun+apply)` `/a/v1/inference/whatif` | ✅ 已建 | 沙盘 act 复用此引擎 |
| 时序曲线 | `risk_timeline`/`counterfactual_timeline`/`audit_timeline` | ✅ 已建 | 作沙盘单 tick 计算核 |
| 卡→推演 grow | **我的 `PRD-scenario-ontogenesis`** | ✅ **P1+P2 已实现**（确定性绑定+grow 验证门+投影渲染+留痕） | 卡 launch 语义→进沙盘 scope（复用 `ScenarioOntogenesisRun`，不另起） |
| 就绪/缺陷 | `GapReport`/`classifyGap` + 自成长驾驶舱 + closure | ✅ 已建 | L0-L4/雷达=**surface 既有 closure**（folded 进 modeling/growth，不新页） |
| 前端组件 | `RadarChart`/`PropagationTimeline`/`PmDag` | ✅ 已建 | 复用（雷达改维、传导轴进化为 tick 轴） |

> **结论**：沙盘真正"新"的只有三件——**① 有状态会话 SimSession（init/tick/act/checkpoint/branch/compare）② 系数+延迟的传导规则 ③ 统一沙盘前端**。其余全是**已有 PRD 的零件**，沙盘**整合**它们，绝不平行重写。

---

## 2. 对我已交付文档的修订（保持自洽）

| 我的文档 | 状态 | 修订 |
|---|---|---|
| `PRD-simulation-sandbox` | **需对齐** | §0/§7 改为"整合既有 sim-views/A8/recompute/replay/ontogenesis"，明确各零件 owner PRD；"新增"只剩 SimSession+传导+UI 三件 |
| `ARCH-global-ia-consolidation` | ✅ 方向对 | 已说"合并不复制/复用现有页"，补一句：推演合并的对象就是 sim-views 的 project/risk 渲染器 |
| `ARCH-sandbox-landing-discipline` / `RUNBOOK` | ✅ 仍成立 | 增量 1 的"复用 simclock/generic_inference"= 对齐 A8/recompute；增量 3 传导=对齐 §8b |
| **`LOOP-scenario-launcher-sweep`** | ⚠ **部分过期** | 其记录的 **S03(TEMPLATE_RESOLUTION_ERROR)/S06(action-draft 400)/16 占位卡** 现已被 `e274fb5`/`deec28e` 修复（G-1 投影渲染闭、P2 续清 S03/S06）。**应标"历史诊断快照，断点已修"**，别让其他 agent 照着修已修的东西 |
| `DATA-rules-13-undefined` / `DATA-scenario-genome` | ✅ 仍有效 | 规则即引用 + 卡 genome 数据未被覆盖 |

---

## 3. 给其他 agent 的对齐指引（避免重复/冲突）

1. **沙盘不另起架构**：实现 `PRD-simulation-sandbox` 时，**先读** `PRD-frontend-addendum-sim-views`（重算端点/渲染器）、`PRD-addendum-a8-timeseries`（模拟时钟）、`PRD-addendum-replay-orchestrator`（走正门）、`TODO §8b`（传导）——沙盘**扩展**它们，不平行造。
2. **传导引擎对齐 §8b**：用 `recompute` 反向闭包雏形扩"系数+延迟"，规模不够再封 Soufflé（TODO 已定方向）；系数=`rule.params`（规则即引用）。
3. **卡→沙盘复用 ontogenesis**：场景卡进沙盘 scope，复用**已实现**的 `ScenarioOntogenesisRun`/grow 门，不另起卡-推演链。
4. **就绪认证 folded**：复用 closure/GapReport（已建），不新开就绪页（IA 合并方案 §2）。
5. **沙盘态 Action 守 replay 红线**：走正门、禁直写、采纳才 R4——与 replay-orchestrator 同红线。
6. **过期诊断别照修**：`LOOP-scenario-launcher-sweep` 的 S03/S06/16 占位已修，以当前代码为准。
7. **本体单一来源**：任何沙盘新增对象/事件回写 `SYSTEM-ONTOLOGY.md`，`ontology:check`/`meta:sync` 守不漂。

---

## 4. 本体引用与影响

- **链路**（§3）：沙盘链路是既有链路的**有状态包裹**——`sim-views 重算`(已有) ⊕ `A8 时钟 tick`(已有) ⊕ `recompute 传导`(§8b 雏形) ⊕ `replay 走正门`(已有) ⊕ `ontogenesis 卡 grow`(已实现) → SimSession 整合。
- **不变量**：R6（复用 A8/replay 的确定性）、R4（复用 replay/actions 走正门）、R14（复用 sim-views 配置驱动）、R16（复用 ontogenesis）。
- **断点**（§8）：G-11（沙盘整合层缺）；标注 G-1（16 占位）已由 `e274fb5` 投影渲染**闭合**——沙盘建在已修好的卡渲染之上。
- **回写**：沙盘立项时，§3 链路写明"整合既有 PRD 零件"，§8 G-11 注"非绿地，整合已有 sim-views/A8/recompute/replay/ontogenesis"。

---

## 5. 一句话给决策者

**沙盘不是又一个大新功能，是把系统里已经各自存在/在建的"推演零件"（交互重算 sim-views、模拟时钟 A8、传导 recompute、走正门回放、卡 grow ontogenesis）整合升级为一个有状态、可分支、统一 UI 的沙盘。** 其他 agent 正基于这些 PRD 开发——沙盘**站在它们肩上**，复用其引擎与红线，只补"会话状态+传导系数+统一前端"三件，并用 IA 合并方案收掉重复页。这样既不与在建工作冲突，又把散落能力收敛成一个产品。
