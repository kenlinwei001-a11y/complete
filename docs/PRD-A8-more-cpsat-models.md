# PRD · A8 · 扩更多 CP-SAT 最优化模型（assignment / sequencing / packing）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 2 |
| 取代/扩展 | 扩 `PRD-addendum-solvers-and-gaps.md`（§8d CP-SAT）· 关联 `services/optimizer`（OR-Tools sidecar）· `PRD-A1-*`（新模型经 A1 暴露为 MCP 工具） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.E 求解器 · §5 R6） · `apps/datacore/src/solvers/service.ts:54`（selection_optimize sidecar 代理）`:359` · `services/optimizer/server.py`（CP-SAT 现有 0/1 背包） |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：现有 `selection_optimize` 经自托管 CP-SAT sidecar 做 0/1 背包族"可证最优"。A8 在同一 sidecar 加 **3 个新最优化模型**——**assignment（订单→基地/产线分配）**、**sequencing（换型排序，最小化换型损失）**、**packing（产能装箱/排产填充）**，作为 TS 贪心给不出的可证最优，确定性（R6），经 A1 暴露为 MCP 工具。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.E）：`Solver`（新 3 key：`assignment_optimize`/`sequencing_optimize`/`packing_optimize`）·`SolverParam`·`Order`/`Base`/`Line`/`Process`/`Model`（入参对象图）·`SOLVER_OUTPUT_SHAPES`。
- **触及链路**（§3）：`对象图 → loadContext → CP-SAT sidecar(OPTIMIZER_BASE_URL) → 可证最优解 → SOLVER_OUTPUT_SHAPES → render`；与 selection_optimize 同构（service.ts:359 模式）。
- **触及事件/数据流**（§4）：无新事件（求解器纯计算，可选落 ForecastSnapshot 类记录由调用方决定）。
- **触及不变量**（§5）：
  - **R6 确定性（核心）**：CP-SAT 固定 `random_seed` + 单线程 + 确定性停止条件（时间/最优 gap），同输入字节一致；`OPTIMIZER_BASE_URL` 未配 → 报"未接入"**不静默兜底**（同 selection_optimize 纪律）。
  - **R11 全链闭包**：3 新 key 注册 `SOLVER_KEYS` + `SOLVER_OUTPUT_SHAPES`，过 `chain:check`。
  - **R5/R8**：sidecar 自托管、数据不出边界；OBO 身份在 DataCore 侧已过滤后再发 sidecar。
- **关闭/影响断点**（§8）：扩"可证最优"能力面（贪心/启发式盲区）；为 A1 增 3 个高价值 MCP 工具、为 A14 evals 增可比对用例。
- **门禁**（§7）：`chain:check`（注册+形状）· sidecar 单测（`services/optimizer/test_optimizer.py` 扩）· `ontology:check` · 确定性回归（同输入重跑字节一致）。
- **回写承诺**：回写本体 §2.E（SOLVER_KEYS +3 + 三个模型 bound 口径）· §3（求解器注册表）。

## 1. 目标 / 非目标
### 目标
1. **assignment_optimize**：订单/需求 → 基地/产线 的**指派最优化**（最小化总成本/物流 + 满足产能/资格约束；可加均衡软目标）。
2. **sequencing_optimize**：一条产线上型号生产**排序最优化**，最小化换型损失（changeover-time 矩阵，C-换型规则约束），TSP/序列族。
3. **packing_optimize**：把生产任务**装入产能箱**（周/线产能为 bin，任务为 item，最小化 bin 数/溢出；bin-packing 族）。
4. 三者均经 CP-SAT sidecar 出**可证最优 + 最优性证书**（status OPTIMAL/FEASIBLE/INFEASIBLE），确定性，经 A1 成 MCP 工具。

### 非目标
- 不做连续 LP/MIP 之外的元启发式；聚焦 CP-SAT 可建模的离散最优化。
- 不引入新外部依赖（复用既有 OR-Tools sidecar 镜像）。
- 不替换 capacity/affected 等领域求解器；A8 是"可证最优"补充层。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| sidecar | `services/optimizer/server.py`（0/1 背包 CP-SAT）+ `test_optimizer.py` | 仅背包；无 assignment/sequencing/packing |
| 代理 | `service.ts:359` selection_optimize 经 OPTIMIZER_BASE_URL 代理 | 3 新模型无代理 |
| 注册 | `SOLVER_KEYS`(28) + `SOLVER_OUTPUT_SHAPES` | 缺 3 新 key + 形状 |
| 入参倒推 | `solver-args.ts`（多跳路径倒推） | 3 新模型入参/标量倒推待补 |

## 3. 设计（sidecar 加模型 + DataCore 代理 + 注册）
### 3.1 sidecar（services/optimizer/server.py）
- 加 3 endpoint（或单 endpoint + `model` 判别）：
  - `/assignment`：变量 x[i,j]∈{0,1}（item i→bin/base j），约束 Σ_j x=1（每 item 一指派）、Σ_i x·w ≤ cap_j（产能）、资格 mask；目标 min Σ cost·x（+ 均衡软项）。
  - `/sequencing`：序列变量 + changeover 矩阵；目标 min Σ changeover(prev,cur)；可加交期/优先级约束（circuit/AddCircuit 或 interval）。
  - `/packing`：bin-packing，items→bins(产能)，min bins 或 min 溢出。
- 全部固定 `random_seed`、`num_search_workers=1`、确定性停止（`max_time_in_seconds` + 最优即停）；返回 `{status, optimal:bool, solution, objective, certificate}`。
### 3.2 DataCore 代理（solvers/service.ts）
- 3 新 key 走 selection_optimize 同款代理（OPTIMIZER_BASE_URL 发现；未配 → "未接入"显式报错，不兜底）。
- `loadContext` 取对象图组装 items/bins/matrix（如 assignment: Order→候选 Base + 产能；sequencing: Line 上 Orders + 换型矩阵 from Process/Model）。
- 注册 `SOLVER_KEYS` += 3；`SOLVER_OUTPUT_SHAPES` 加 3 形状。
### 3.3 入参倒推（solver-args.ts）
- 为 3 新模型加确定性 args 倒推（候选集/产能/成本/换型矩阵从对象图 ref 结构推；运行期标量如 lineId/budget 诚实留空 → 对接 A13）。
### 3.4 暴露
- 经 A1 自动成 `mcp__solvers__{assignment_optimize|sequencing_optimize|packing_optimize}`。

## 4. 契约 / 端点
- `contracts/solvers.ts`：`AssignmentOptimizeOutput`/`SequencingOptimizeOutput`/`PackingOptimizeOutput` + 对应 input schema（入 A1 `SOLVER_INPUT_SCHEMAS`）。
- DataCore：`POST /a/v1/solvers/{key}/invoke`（既有通道）。
- sidecar：新 endpoint（内部）。

## 5. 关键流程（端到端）
"这批订单怎么分配到基地最省" → assignment_optimize → loadContext 组 items(订单)/bins(基地产能)/cost(物流+成本) → sidecar CP-SAT → OPTIMAL 指派 + 目标值 + 证书 → 渲染分配表；OPTIMIZER 未配 → 显式"未接入"。

## 6. 非功能（§5）
R6（seed + 单线程 + 确定性停止，单测字节锁）· 不出边界 · 未配不兜底。

## 7. 验收（DoD）
- 3 模型 sidecar 可解、返回 OPTIMAL/证书；DataCore 代理 + 注册 + 形状；经 A1 成 MCP 工具可调。
- 确定性：同输入重跑字节一致（sidecar test 扩 + datacore 求解器回归）。
- `pnpm -r build && pnpm -r test` 全绿；`services/optimizer/test_optimizer.py` 扩绿；`chain:check`/`ontology:check` 过。
- 回写本体 §2.E/§3。

## 8. 分期
- **A8.1** assignment_optimize（sidecar + 代理 + 注册 + 形状 + 入参倒推）。
- **A8.2** sequencing_optimize（换型矩阵）。
- **A8.3** packing_optimize + 三者经 A1 MCP 暴露验证。

> 依赖：A1（暴露口）；可与 A1 并行，A1.2 形状契约就绪后并入。基线分支：sidecar + 新 key 文件冲突小。
