# HANDOFF-ROADMAP · 未完成项目的独立开工 HANDOFF 路线图

> **这份文件是什么**：把 `docs/COMPLETION-LEDGER.md` 里**确凿未完成的项目**，逐个拆成"各自需要一份独立开工 HANDOFF（像沙盘那份：增量 / 红线 / 评审协议）"的清单，并标明**现在就写 vs 待 Pass-2 先定级**。每写完一份就回写本表状态。
>
> **铁律（防重建已能用的东西）**：台账里"未完成"分两类——
> - **(a) 确凿未建**（backlog 里明写"零代码 / 待P3 / ❌未实现"）→ **现在就配 HANDOFF**。
> - **(b) ⬜待真跑**（addendum 写过、但不确定建到哪步）→ **不配"从零建"HANDOFF**，先由审核方 Pass-2 真跑定级出真缺口，**再按真缺口配 HANDOFF**。否则会让开发 agent 重建已能用的东西（`COMPLETION-LEDGER §3` 警告）。

---

## 1. 已有 HANDOFF（不重复造）

| H | 项目 | HANDOFF | 状态 |
|---|---|---|---|
| H1 | 推演沙盘 UI 收口 | `HANDOFF-sandbox-build-and-review-contract.md` | ✅ 已就绪（P0/P1 在 §6.1.A） |
| H2 | 优化求解器融合 | `HANDOFF-optimization-fusion-build-and-review-contract.md` | ✅ 已就绪（增量 0-6） |

---

## 2. 现在就配 HANDOFF（确凿未建 · 按优先级）

| H | 项目 | 源（确凿未建依据） | 优先级 | HANDOFF 状态 |
|---|---|---|---|---|
| **H3** | **🔴 数据构建发动机收尾**（comprehend 引擎 + 终态闭环）。**翻案**：真代码摸底发现引擎主体**已建**（非 TODO 说的"空骨架"），H3 = 收尾 3 真断点（用途→provider→model 路由 / 域运营本体不变量 / B栈制品入启动器）+ 先 FDE 真跑坐实 | `TODO-fde §2/§3` 目标 + 2026-06 真代码摸底（HANDOFF §1 现状表）。**注：TODO 状态字段已 stale，以现状锚点为准** | **P0（真北极星）** | ✅ 已就绪 → `HANDOFF-comprehend-engine-build-and-review-contract.md` |
| **H4** | **闭环验证引擎 VLE 收尾**。**翻案**：台账标❌错——`vle.ts` 七段 runner/三覆盖率/工程验证度/隔离租户/VL1-8 测试**已建~30-40%**；真缺=参照实现双算(桩)+CI门(缺)+前端段级矩阵 | 摸底实勘(HANDOFF §1)。`COMPLETION-LEDGER D24` 标❌**已 stale** | P1 | ✅ 已就绪 → `HANDOFF-vle-build-and-review-contract.md` |
| **H5** | **规则即一等引用 G-10 收尾(P3)**。**翻案**：本体说"待编辑器"错——编辑器/版本/事件失效**已建**；真缺=11/19 求解器没接 payload 映射(规则空过)+6 入口 FDE 验收 | 摸底实勘(HANDOFF §1)。本体 G-10「待编辑器」**已 stale** | P1 | ✅ 已就绪 → `HANDOFF-rules-firstclass-p3-build-and-review-contract.md` |
| **H6** | **场景发育 R16/G-9 收尾(P3)**。**翻案**：3 待办函数(runGrowthLoop/planSlice/规则解析)**全已存在**，缺的只是 growScenario 没调它们(wiring)+ADVISORY 相位 | 摸底实勘(HANDOFF §1) | P1 | ✅ 已就绪 → `HANDOFF-ontogenesis-p3-build-and-review-contract.md` |
| **H7** | **管理面引用闭合 + 编辑器补缺 + AC8 零代码自助**。**翻案**：41 admin 页都在；真缺=3 页(求解器目录/切片编辑器/评测 CRUD)+引用控件 5-7 不闭合+AC8 3-4 死路 | 摸底实勘(HANDOFF §1)。addendum「7整页缺失」**多数已 stale** | P2 | ✅ 已就绪 → `HANDOFF-admin-console-closure-build-and-review-contract.md` |

> **重要规律（实证 · 直接回答"如何不遗漏"）**：H3-H7 摸底**每一个**都翻案——真代码比文档/台账声称的**建得多得多**。"未完成"的真相**只能靠摸真代码**得到，文档全在虚标。所以 §3 那批坚持"先 Pass-2 再配 HANDOFF"，绝不照文档盲配。

---

## 3. 待 Pass-2 先定级，再配 HANDOFF（不确定建到哪步 · 别盲配）

> 这些 addendum 写过、可能已建到不同程度，`COMPLETION-LEDGER` 标 ⬜未跑/◐。**审核方先起真系统 Pass-2 真跑定级，把"⬜待真跑"收敛成"❌真缺/◐真半通"，再按真缺口配 HANDOFF。** 现在配"从零建"会撞已能用的实现。

| 项目 | 源 | LEDGER 判定 | 卡点 |
|---|---|---|---|
| A8 时序数据层 | addendum-a8 (D10) | ⬜ 未跑 | 模拟时钟/聚合/SUSTAIN 建没建未核 |
| M11 校准引擎 | addendum-m11-calibration (D15) | ⬜ 未跑 | 配对/三方法/回测门未核 |
| 运营完备性 | addendum-operational-completeness (D20) | ⬜ 未跑 | 实体解析/评测门禁/配置迁移/隔离区/通知未核 |
| 回放编排器 | addendum-replay-orchestrator (D18) | ⬜ 未跑 | 虚拟操作团队/OpsPlaybook 未核 |
| 运营态"拎包入住" | addendum-lived-in-state (D26) | ⬜ 未跑 | livedIn 出厂态未核 |
| Agent 运行时强化 | addendum-agent-runtime (D16) | ⬜ 未跑 | token 预算/三刀上下文/MCP 池未核 |
| 能力发现与路由 | addendum-capability-routing (D17) | ⬜ 未跑 | discover/load_tools 未核 |
| 执行语义统一 | addendum-execution-semantics (D19) | ⬜ 未跑 | 锁/fencing/outbox/Saga 未核 |
| LLM 多厂商+统一引用 | addendum-llm-providers (D21) | ◐ 部分 | 多 provider 路由/失效 SLO 未核 |
| 管理平台补全 | addendum-admin-platform (D22) | ⬜ 未跑 | bootstrap/角色/最小可用未核 |
| 本体治理与检索 | addendum-ontology-governance (D14) | ◐ 部分 | 八检索模式/会签/弃用流程未核 |
| 驾驶舱数据层颗粒 | backlog #34-42 | ◐ 部分 | dash 月季年对象化/取值对齐（高回归专项） |

---

## 4. 顺序

1. **现在**：写 H3（北极星）→ H4 → H5 → H6 → H7（§2，确凿未建，逐份配，每份写完回写本表）。
2. **并行/穿插**：审核方做 Pass-2（`COMPLETION-LEDGER §6` Wave A/D），把 §3 的 ⬜ 逐域定级；定一个、出真缺口、配一份。
3. **开发 agent**：永远从 `START-HERE-dev-agent.md` 进，按指派领一份 HANDOFF 建，不照台账盲建。

---

> 维护：每份 HANDOFF 写完，把 §2 对应行状态从 `⬜待写/🚧起草中` 改为 `✅已就绪`，并在 `START-HERE-dev-agent.md §2` 增加该轨入口。
