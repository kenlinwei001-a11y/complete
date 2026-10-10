# PRD · 达成率/偏差归因路由（"未达成原因" → plan_audit · discover 暴露 · 基线兜底）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 后端（QOS 路由 + discover + 求解器入参兜底）|
| 取代/扩展 | 新建 · 修"agent 去找切片、找不到归因能力"的路由缺口 · 接 `PRD-attainment-base-daily-timeseries`（逐日归因数据）+ `PRD-empty-tenant-bootstrap`（计划版本来源）|
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R6/R13 · §7 chain · §10.3 `sys.orch.query_to_answer`）· `apps/datacore/src/solvers/plan.ts:5`（`plan_audit` X01–X05/R01–R02 诊断）· `packages/contracts/src/solvers.ts:170-179`（`PlanVersionCurrentSchema`：**无 FINAL 时由 PlanTarget/场景包基线确定性派生**）· `apps/datacore/src/catalog.ts`（`plan_audit` 目录）· `apps/agentcore/src/router/orchestrator.ts`（classify）· `apps/agentcore/src/databuilder/comprehend.ts:299-313`（关键词→solverKey + SOLVER_TARGET_VIEW）· `apps/agentcore/src/tools/executor.ts:199`（`discover`）|

> 一句话：用户问"本月计划未达成原因"，agent 的 `discover` 去找一个**"计划达成率归因"切片**——找不到，于是卡住。但**归因能力本就在 `plan_audit` 求解器**（做 X01–X05 偏差诊断），不是切片。这是**路由/暴露缺口**：① QOS/comprehend 没把"达成率归因/偏差根因/未达成原因"这类问句**路由到 `plan_audit`**；② `discover` 没把 `plan_audit` 暴露为"达成率/偏差归因"的入口；③ agent 误以为 plan_audit 必须传 `plan_version_id`，**不知道它有"无 FINAL 版本时由 PlanTarget 基线确定性派生"的兜底**（solvers.ts:170）。本 PRD 补这三点：**关键词路由 + discover 暴露 + 入参兜底（currentPlanVersion 缺则走 PlanTarget 基线）**，让"未达成原因"问句**直达 plan_audit 出诊断**，配合日达成率序做时间维度归因。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.D7/D4）：`Intent/Query`（QOS）·`Solver(plan_audit)`·`PlanVersionCurrent`（入参，含基线兜底）·`SliceSpec`（discover 暴露）·`Tool(discover)`。
- **触及链路**（§3 / §10.3）：`问句"未达成原因/达成率归因" → classify/comprehend(关键词→plan_audit) → 入参解析(currentPlanVersion ?? PlanTarget 基线) → plan_audit(X01–X05) → 归因(+逐日时序) → 答案`。
- **触及事件/数据流**（§4）：无新增；复用求解器调用。
- **触及不变量**（§5）：R6（plan_audit 确定性诊断 + 基线派生确定）· R13（归因结论可溯：到 PlanTarget/SopVersion/规则 X01–X05）· R-一致（达成率口径同 Metric/驾驶舱）· R11/chain（路由命中已注册求解器）。
- **关闭/影响断点**（§8）：**G-3**（对话/QOS 未把问句路由到已有能力 → 误判"无切片"）——本 PRD 让"归因"问句直达 plan_audit，闭合"能力存在却路由不到"的接缝。
- **门禁**（§7）：`chain:check`（路由命中真实 plan_audit）· `pnpm -r build && test`（路由 + 基线兜底回归）· FDE 亲手跑（"本月未达成原因"→ 出 X01–X05 + 逐日）。
- **数据闭环合规**：`// 不涉数据闭环`（路由/暴露/入参；不新增数据/对象/字段。归因数据由 `attainment-base` PRD 提供）。
- **回写承诺**：关键词→plan_audit 路由 + discover 暴露 + 基线兜底约定 → 回写本体 §3（归因链）+ §10.3（query_to_answer 补归因路由）。

## 1. 目标 / 非目标
### 目标
1. **关键词路由**：comprehend/classify 把"计划达成率归因 / 计划偏差根因 / 本月未达成原因 / 为何没达标"等 → `plan_audit`（comprehend.ts:299-313 KEYWORD_SOLVER 加条目 + SOLVER_TARGET_VIEW `plan_audit→audit`）。
2. **discover 暴露**：`discover`（executor.ts:199）对"归因/达成率/偏差"类查询，返回 `plan_audit` 作为候选能力（带入参说明），不让 agent 空找切片。
3. **入参兜底**：plan_audit 调用时 `plan_version_id` 缺 → **自动取 `currentPlanVersion`；再缺 → 由 PlanTarget/场景包基线确定性派生**（solvers.ts:170 已支持，补到**调用路径/agent 工具**，让 agent 不因"无版本"而放弃）。
4. **时间维度归因**：plan_audit 结论 + `attainment:base` 日序（另一 PRD）→ 逐日达成率 + 偏差归因（X01–X05 落到具体日/基地）。
5. **诚实兜底**：连 PlanTarget 都空（真空租户）→ 返回结构化缺口"计划域为空,请先引导"（接 in-dialog gap-fill / bootstrap），不空转。

### 非目标
- 不改 plan_audit 诊断算法（X01–X05 复用）。
- 不新建归因切片（能力在求解器,不造冗余切片）。
- 不绕过 seed（真空仍需 bootstrap，本 PRD 让路由+兜底正确,而非凭空造数据）。

## 2. 现状与缺口（带 file:line）
| 元素 | 现状 | 缺口 |
|---|---|---|
| 归因能力 | ✅ `plan_audit`（plan.ts:5，X01–X05/R01–R02）| 存在但**路由不到** |
| 关键词路由 | comprehend.ts:299-300（risk/forecast 有，**无 plan_audit 归因词**）| **加"达成率归因/未达成原因"→plan_audit** |
| discover | executor.ts:199 找切片/求解器 | **未对"归因"暴露 plan_audit** |
| 入参兜底 | solvers.ts:170 基线派生**已支持** | **调用/agent 路径没用上** → agent 因"无 plan_version_id"放弃 |
| 时间维度 | — | 接 `attainment:base` 日序 |
| 现象（截图）| agent 找"归因切片"失败 + "需 plan_version_id 无法调用" | 本 PRD 修路由 + 兜底 |

## 3. 设计
### 3.1 关键词路由（comprehend/classify）
- `KEYWORD_SOLVER` 加：`{ keywords:["达成率归因","未达成原因","计划偏差","为何没达标","偏差根因"], solverKey:"plan_audit", inputFields:[{typeKey:"PlanTarget"},{typeKey:"SopVersion"}] }`；`SOLVER_TARGET_VIEW.plan_audit="audit"`（comprehend.ts:312 补）。
### 3.2 discover 暴露
- `discover` 对归因类 query 返回 `plan_audit`（候选能力 + "入参 plan_version_id 可选,缺则用当前版本/基线"说明）——agent 直接调,不找切片。
### 3.3 入参兜底（关键）
- plan_audit 调用封装：`plan_version_id ?? currentPlanVersion(sop) ?? deriveBaseline(PlanTarget/场景包)`（solvers.ts:170 口径），三级兜底确定性（R6）；agent 工具 `invoke_solver(plan_audit)` 走同封装。
- 全空（无 PlanTarget）→ 返 `GapReport{code:EMPTY_DATA, hint:"计划域为空,先引导"}`（接 bootstrap/gap-fill）。
### 3.4 时间维度归因
- plan_audit 输出 + `attainment:base` 日序 → 逐日达成率曲线 + X01–X05 归因落到日/基地（驾驶舱/体检渲染）。

## 4. 契约 / 端点
- `agentcore/comprehend.ts`：KEYWORD_SOLVER + SOLVER_TARGET_VIEW 加 plan_audit 归因。
- `discover`：归因 query → plan_audit 候选。
- plan_audit 调用封装：入参三级兜底（复用 `PlanVersionCurrentSchema`/baseline）。
- 复用 `invoke_solver`/`/a/v1/solvers/plan_audit/invoke`、`query_timeseries_agg`（日序）。无新真值源。

## 5. 关键流程
"本月未达成原因" → classify/comprehend → plan_audit → 入参兜底(当前版本/PlanTarget 基线) → X01–X05 诊断 + attainment:base 日序 → 逐日达成率+偏差归因答案(溯源)；真空 → 结构化缺口提示引导。

## 6. 非功能（§5）
R6（诊断+基线确定）· R13（归因可溯到目标/版本/规则）· R-一致· R11/chain（命中已注册求解器）· 诚实（空则提示引导,不空转）。

## 7. 验收（DoD）
- "本月计划未达成原因 / 达成率归因"问句 → **直达 plan_audit**（不再找切片失败）。
- plan_audit 入参缺 plan_version_id → **自动用当前版本/PlanTarget 基线**跑出 X01–X05（不再因"无版本"放弃）。
- 配 `attainment:base` 日序 → 给出**逐日达成率 + 时间维度偏差归因**。
- 真空租户 → 返结构化缺口提示引导（接 bootstrap），不伪造不空转。
- `chain:check`/`pnpm -r build && test` 过；FDE 亲手跑（seed 后问"未达成原因"出诊断）。
- 回写本体 §3/§10.3。

## 8. 分期
- **AR.1** 关键词路由 + discover 暴露 + 入参三级兜底（核心，让问句直达 plan_audit）。
- **AR.2** 接 `attainment:base` 日序 → 逐日时间维度归因 + 真空缺口提示（接 bootstrap/gap-fill）。

> 闭环：本 PRD（路由+兜底）+ `attainment-base`（日序数据）+ `empty-tenant-bootstrap`（有计划版本）+ `agent-data-generation-tools`（对话触发）+ `admin-self-approval`（定稿）= 驾驶舱问"本月未达成原因"**端到端可答**（数据→版本→路由→归因→逐日时序）。基线分支：agentcore 路由 + 求解器入参封装,冲突小。
