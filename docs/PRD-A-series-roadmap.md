# PRD 索引 · A 系列待办依赖路线图（工程施工总纲）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 ACTIVE · 日期 2026-06-21 |
| 性质 | **索引/总纲**——统辖 A 系列 13 项工程 PRD 的依赖关系、产出顺序、评审节奏 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · 各子 PRD `docs/PRD-A{n}-*.md` |
| 评审节奏 | **逐波产出、每波评审**（用户裁决）：Wave N 评审通过 → 产出 Wave N+1 |

> 本文是 13 项工程的**接线总纲**：每项一行（范围/依赖/产出对象/关键不变量/子 PRD 文件）。其他 agent 先读本文定位自己那项的上下游，再读对应子 PRD 开工。

## 0. 已确认的全局裁决（影响多项，写死在此）
- **A9 外部引擎（Soufflé/Neo4j/DoWhy）**：**仅出设计 PRD、标记"按需延后"**——不现在引真依赖，守 R6 确定性/系统自包含（接入点设计齐备，需时如 CP-SAT sidecar 那样接）。
- **A1 引擎→MCP**：**全部 28 求解器（SOLVER_KEYS）注册为 MCP 工具**，MCP 页可见/可治理、agent 经 mcp-router 可调。
- **A3 参考本体域**：**参考原型 16 域裁成 14 业务域**（去 solver/agent 计算元域）：`factory/product/process/equip/people/quality/capacity/forecast/sales/material/finance/plan/external/decision`。
- **产出**：14 份子 PRD（13 工程项 + 本索引）逐波交付。

## 1. 依赖 DAG（箭头 = 前置依赖）

```
Wave1 基座            Wave2 引擎/能力              Wave3 编排/闭环          Wave4 验证/扩展
┌─────────┐
│ A3 本体+ │──┬─────────────► A4 类型浏览器 ──────────────────────────► A12 hand-run 补全
│ 切片规划 │  │                                  ▲
└─────────┘  ├─► A5 FDE 编排工作流 ──────────────┤
             │        ▲                          │
┌─────────┐  │        │                          ▼
│ A6 拟真  │──┼────────┼──────────────► A10 终态闭环（建域→R4→publish→重跑验证）
│ 值域合成 │  │        │                          ▲
└─────────┘  │        │                          │
┌─────────┐  │   ┌────┴─────┐                     │
│ A11 连接 │──┘   │ A1 引擎  │─► A7 B栈scaffold ───┤
│  归类    │      │ →MCP(28) │   单机可见          │
└─────────┘      └──────────┘                     │
                 ┌──────────┐                     │
                 │ A8 扩CP-SAT│────────────────────┤
                 │ 模型      │                     │
                 └──────────┘            ┌─────────┴──┐
                 ┌──────────┐            │ A14 agent  │
                 │ 地板语义  │───────────►│ evals 比对 │
                 │ 去Kimi   │            └────────────┘
                 └──────────┘
                                         （A9 外部引擎：设计延后，旁路，不阻塞主链）
```

## 2. 逐项登记表

| 波 | 项 | 范围一句话 | 依赖（前置） | 产出供（下游） | 关键不变量 | 子 PRD |
|---|---|---|---|---|---|---|
| 1 | **A3** | 14 域参考本体 + 域内/跨域两库 + **多跳切片规划器（图路径搜索）** + 切片索引复用 | —（基座） | A4/A5/A10 | R1 R2 R6 R12 R14 | `PRD-A3-reference-ontology-slice-planner.md` |
| 1 | **A6** | 拟真值域合成数据（值落业务区间 + 植入恰当越线样本，去通用 hash） | —（基座） | A14/A10/求解器质量 | R6 R12 VLE | `PRD-A6-realistic-value-domain-synthesis.md` |
| 1 | **A11** | 连接创建时打 `Connection.category` 标签（per-connection 归类，覆盖连接器类型默认） | — | A4/数据分类 | R2 R9 | `PRD-A11-per-connection-category.md` |
| 2 | **A1** | 28 求解器注册为 MCP 工具，MCP 页可治理、mcp-router 可调 | —（求解器已在） | A5/A7 | R3 R5 R8 R11 | `PRD-A1-solvers-as-mcp-tools.md` |
| 2 | **A8** | 扩 CP-SAT 最优化模型：assignment（订单分配）/ sequencing（换型排序）/ packing | A1（暴露口） | A1/A14 | R6（sidecar 确定性） | `PRD-A8-more-cpsat-models.md` |
| 2 | **地板语义** | concentration_risk / supplier_disruption_radius 多源/标量歧义**确定化去 Kimi** | —（求解器已在） | A14 | R6 | `PRD-A13-floor-semantics-deterministic.md` |
| 2 | **A4** | 对象/类型浏览器管理页（列已发布类型 + 物化计数 + 下钻实例） | A3（类型/切片）·A11（归类） | A12 | R2 R3 R14 | `PRD-A4-object-type-browser.md` |
| 3 | **A5** | FDE 编排工作流·可观测节点状态图（意图→倒推→查能力→比差→各模块生成→进启动器） | A3（查能力/比差/多跳） | A10/A12 | R10 R11 R13 | `PRD-A5-fde-orchestration-workflow.md` |
| 3 | **A7** | B 栈 scaffold 单机可见（不配 AGENTCORE_BASE_URL 也能看到生成的 agent） | A1（mcp）·A5 | A10 | R8 R11 | `PRD-A7-bstack-scaffold-standalone.md` |
| 3 | **A10** | 终态闭环末步：建域→R4 审批→publish→**自动重跑问句验证**（全自动 + 亲手跑通） | A3·A5·A6 | A12/A14 | R4 R11 R13 | `PRD-A10-build-to-verify-closure.md` |
| 4 | **A14** | 亲手跑 agent evals 比对 PRD（已可接真 Kimi） | A6·地板语义·A8 | — | R6 R8 | `PRD-A14-agent-evals-handrun.md` |
| 4 | **A12** | 其余模块逐一 hand-run 补全（连接器/对象浏览/Agent 页） | A4·A5 | — | FDE 纪律 | `PRD-A12-module-handrun-completion.md` |
| 4 | **A9** | Datalog(Soufflé)/图库(Neo4j/Gremlin)/因果(DoWhy)接入点**设计延后** | —（旁路） | — | R6（守自包含） | `PRD-A9-external-engines-design-deferred.md` |

## 3. 评审门（每波交付即过）
- 每子 PRD 必含《本体引用与影响》§0；过 `prd:check`（R/G 引用真实存在）。
- 实现期门禁在各子 PRD §7 列明（chain:check / ontology:check / debattery:check / field-coverage / VLE / 前端回归）。

## 4. 状态
- ✅ Wave 1 PRD 产出（A3 / A6 / A11 + 本索引）→ **已评审通过**。
- ✅ Wave 2 PRD 产出（A1 / A8 / A13 地板语义 / A4）→ **已评审通过**。
- ✅ Wave 3 PRD 产出（A5 FDE 编排工作流 / A7 scaffold 单机可见 / A10 终态闭环验证）→ **已评审通过**。
- ✅ Wave 4 PRD 产出（A14 agent evals parity / A12 模块 hand-run 补全 / A9 外部引擎设计延后）→ **待评审**。
- 🎉 **A 系列 13 项工程 PRD 全部产出**（14 文件 = 13 子 PRD + 本索引）。逐项子 PRD 见 §2 登记表。
- ✅ **Wave 5（新增需求）A15 · CLI 通用操作外壳** PRD 产出 → 待评审。`PRD-A15-cli-universal-operation-shell.md`：意图识别→模块路由→CLI 交互→触发模块；含查询/推演类问答（QOS ask）；**全模块→CLI 覆盖矩阵**（附录 A，与 GUI 功能对等）。依赖 A1/A3/A5/A10，可独立先做 import/model/rule。
- ✅ **Wave 5（新增需求·修订红线）A17 · 未审核态全域构建（PROVISIONAL 模式）** PRD 产出 → 待评审。`PRD-A17-provisional-domain-build.md`：把 A16"临时件"推广到整条域——本体/数据/规则/Agent/工作流/技能/意图/计划/场景 皆可作"未审核态"先用（可推演、不写真值、强标未审核、绝不报 ANSWERABLE）；闭包门 STRICT(HARD 写真值默认) / PROVISIONAL(ADVISORY 未审核可跑) 双模；人工审核→发布全流程晋升 GOVERNED。**未审核=可用但未走完审核+发布。** A16 为其"求解器维"特例。
- ✅ **Wave 5（新增需求·修订红线）A16 · LLM 临时求解器** PRD 产出 → 待评审。`PRD-A16-llm-provisional-solver.md`：LLM 生成求解器代码 → 冻结 → **锁死沙箱跑通才注册** → 状态机标签（GENERATED/未注册/PROVISIONAL未验证/ADVISORY_PASSED/GOVERNED/RETIRED）→ 推演可用但**临时件不写真值**（R4）→ 人工调/换/晋升。**确定性靠"生成一次即冻结+沙箱强制确定"满足，安全靠沙箱隔离**。落地后前述"收入/毛利 what-if"可端到端跑完（临时件）。依赖 A1（MCP 标）/A5/A10（建域出可跑临时求解器）。

> 基线分支：A 系列实现前需定准 `wizardly-gauss`（推荐，超集）vs `vigilant-knuth`，见各子 PRD §8 备注。
