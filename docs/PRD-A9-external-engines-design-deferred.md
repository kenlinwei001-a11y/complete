# PRD · A9 · 外部引擎接入点设计（Datalog 传导 / 图库 / 因果）— 仅设计 · 按需延后

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT（**设计 only · 不实现**）· 日期 2026-06-21 · 波次 Wave 4 |
| 取代/扩展 | 关联 `services/optimizer`（CP-SAT sidecar 范式 = 本 PRD 的接入点样板）· `PRD-A13-*`（确定性求解器）· `PRD-A3-*`（图/切片） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R6 自包含/确定性 · §2.E 求解器） · `apps/datacore/src/solvers/service.ts`（selection_optimize sidecar 代理范式） |
| 索引 | `PRD-A-series-roadmap.md` |

> **裁决（用户）：A9 仅出设计 PRD、标记"按需延后"**——三个外部引擎都设计齐"接入点"，**不现在引真依赖**，守系统自包含 / R6 确定性 / 部署轻。需要时按 **CP-SAT sidecar 同款范式**（自托管、数据不出边界、未配则显式"未接入"不兜底）接入。本 PRD 是**接入契约 + 取舍说明**，非施工单。

## 0. 本体引用与影响（强制 · 设计层）
- **触及对象类型**（§2.E）：未来可能新增 `Solver`（datalog 传导 / 图查询 / 因果 三类，注册为 SOLVER_KEYS）·`OntologyType/OntologyLink`（输入图）。**本 PRD 不落任何对象**。
- **触及链路**（§3）：设计 `对象图/规则 → 外部引擎 sidecar(自托管) → 结果 → SOLVER_OUTPUT_SHAPES → render`，与 selection_optimize 同构；未配 → 显式"未接入"。
- **触及不变量**（§5）：
  - **R6 确定性（红线）**：三引擎都须**确定性可复算**才允许进真值链——Datalog（确定性求值，天然满足）；图库（只读查询确定）；**因果（DoWhy）默认非确定 → 仅作"解释/辅助"非真值，或固定随机种子 + 标注置信，不进 Action 写回**。
  - **R5/R8**：sidecar 自托管、数据不出边界；OBO 身份在 DataCore 侧过滤后再发。
  - **R11**：若接入，须注册 + 形状绑定，过 chain:check。
- **关闭/影响断点**（§8）：为远期"传导推理 / 图查询 / 因果归因"留**不破坏自包含**的接入点；本 PRD 不闭合任何断点（设计储备）。
- **门禁**（§7）：本 PRD 过 `prd:check`（§0 完整）；实现时才触发 chain:check / sidecar 测试。
- **回写承诺**：**实现时**才回写本体 §2.E（新求解器）/§3（sidecar 链）；本设计 PRD 暂只在 §9 路线图登记"延后"。

## 1. 目标 / 非目标
### 目标（设计层）
1. 为三类能力各定**接入点契约**（输入/输出/部署/确定性约束/未配行为），可即取即用。
2. 明确**取舍**：每引擎"解决什么 TS/CP-SAT 解不动的问题、代价、为何延后"。
3. 给**触发条件**：何种需求出现才值得真接入（避免过早引重依赖）。

### 非目标
- **不实现、不引依赖、不部署**。不改任何现有代码。

## 2. 现状（为何延后）
- 系统当前自包含：纯函数求解器（R6）+ 唯一外部 sidecar = CP-SAT（OR-Tools，Apache-2.0，自托管，未配显式报错）。三外部引擎暂无足够强需求压过"自包含/确定性/部署"成本 → 延后。
- 已有替代：传导/多跳 → A3 切片规划器（图 BFS）+ 派生 DSL；图查询 → 内存对象图 + executeSlice；归因 → margin_attribution/concentration_risk + counterfactual_timeline（结构化、确定）。**多数需求现有手段够用**，故 A9 延后合理。

## 3. 接入点设计（三引擎，统一 sidecar 范式）
> 统一范式（同 `selection_optimize`）：自托管 sidecar + `<ENGINE>_BASE_URL` 发现；DataCore 取对象图/规则组装请求；未配 → "未接入"显式错误**不兜底**；结果绑 SOLVER_OUTPUT_SHAPES。

### 3.1 Datalog 传导（Soufflé）— "传导/递归闭包"
- **解决**：规则的**递归传导闭包**（如"供应商断供→沿 BOM/订单多层传导到哪些客户"的可证完备闭包），TS 多跳遍历写起来易错、Datalog 一条递归规则搞定且**确定性**。
- **接入点**：`solver datalog_transitive`；输入 = 事实集（对象图边）+ Datalog 程序（从 Rule/派生 DSL 编译）；sidecar 跑 Soufflé → 闭包关系集；输出 `{relation, tuples, derivedFrom}`。
- **确定性**：Datalog 求值确定（R6 天然满足）。
- **触发条件**：出现"需可证完备的多层递归传导"且 A3 BFS/派生不够表达时。

### 3.2 图库（Neo4j / Gremlin）— "大图查询/路径"
- **解决**：对象图**规模化**后的复杂路径/中心性/社区查询（当前内存图 + BFS 够用；百万级节点或频繁复杂图查询时才需）。
- **接入点**：`graph_query` 适配器（只读）；输入 = Cypher/Gremlin 查询模板 + 参数；sidecar/外部图库返回路径/度量；输出绑只读形状。**写仍走平台真值（R4），图库仅查询副本**（避免双真值源）。
- **确定性**：只读查询确定（排序固定）。
- **触发条件**：对象图规模/查询复杂度压垮内存图 + executeSlice 时。

### 3.3 因果（DoWhy）— "因果归因/反事实（统计）"
- **解决**：从观测数据估计**因果效应**（如"夜班真因吗、效应多大"），超出 counterfactual_timeline 的结构化前向重算，进入统计因果。
- **接入点**：`causal_estimate`（**解释/辅助层，不进真值写回**）；输入 = 观测样本 + 因果图（DAG）+ 处理/结果变量；sidecar 跑 DoWhy → 效应估计 + 反驳检验；输出 `{estimate, ci, refuters, confidence}` **标注"统计估计·非确定真值"**。
- **确定性（关键约束）**：DoWhy 含抽样 → **默认非确定** → 仅作解释/置信标注，**不进 Action 写回链**；若必须可复算则固定随机种子 + 标 P 置信，且**不计入 R6 字节一致的真值链**。
- **触发条件**：有真实历史样本 + 需"因果效应量化"且结构化反事实不足时。

## 4. 契约（设计稿，实现时落地）
- `contracts/external-engines.ts`（**实现时新建**）：`DatalogTransitiveOutput` / `GraphQueryOutput` / `CausalEstimateOutput`（含 confidence/非真值标注）+ 各 `<ENGINE>_BASE_URL` 配置项。
- 部署：各引擎 `services/<engine>/`（Dockerfile + 自托管），同 `services/optimizer` 结构。

## 5. 触发与决策门（何时从"延后"转"实现"）
- 出现明确需求 + 现有手段（A3 BFS/派生/结构化归因）证不够 → 起对应子 PRD（实现版）→ 评 R6 影响（尤其因果非确定）→ 自托管 sidecar → 注册 + 形状 + chain:check。
- **因果引擎额外门**：只允许进解释层，禁入真值写回（R4/R6 保护）。

## 6. 非功能（§5）
本 PRD 不触代码；实现时守 R6（datalog/图查询确定；因果隔离在解释层）· R5/R8（自托管不出边界）· 未配不兜底。

## 7. 验收（DoD · 设计 PRD）
- 三引擎接入点契约 + 取舍 + 触发条件齐备；过 `prd:check`（§0 完整）。
- 路线图 §2/§4 标 A9 = 设计延后（不计入实现波次）。
- **不产生任何代码改动**。

## 8. 分期（延后）
- **A9.0（本 PRD）** 设计 + 接入点 + 触发条件（完成）。
- **A9.1+（按需）** 任一引擎需求触发时起实现版子 PRD（Datalog 优先级 > 图库 > 因果，因果受确定性约束最严）。

> 与其它项关系：A3 切片规划器/派生 DSL 是 Datalog 的当前替代；A13 结构化归因/counterfactual_timeline 是因果的当前替代。**多数场景无需 A9**——这正是延后的依据。
