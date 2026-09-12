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

> 这些 addendum 写过、可能已建到不同程度。**审核方起真系统 Pass-2 真跑定级，把"⬜待真跑"收敛成真缺口，再决定配 HANDOFF 还是只列收尾任务。**
>
> **第一波 6 块已定级（2026-06）：全部 72-95% 已建——又全是虚标！** 都是收尾活，统一收尾清单见 **`PASS2-wave1-finishing-tasks.md`**（P0×8 + P1×13），**不必各配整份 HANDOFF**。
>
> **第二波 6 块也定级完（2026-06）：5 块收尾（本体治理 92 / 管理平台 88 / livedIn 87**真缺口0完工** / LLM 75 / 能力路由 60）+ 驾驶舱数据层 25-30% 真半成品** → `PASS2-wave2-finishing-tasks.md`。**全 12 块 Pass-2 完毕——11 块收尾、1 块（驾驶舱）真要补且含高回归专项。**

| 项目 | 源 | Pass-2 判定 | 去向 |
|---|---|---|---|
| A8 时序数据层 | D10 | ◐ **90% 已建** | → `PASS2-wave1` 收尾清单 |
| M11 校准引擎 | D15 | ◐ **95%** | → `PASS2-wave1` |
| 回放编排器 | D18 | ◐ **92%** | → `PASS2-wave1` |
| Agent 运行时强化 | D16 | ◐ **85%**(余 v2 边界) | → `PASS2-wave1` |
| 运营完备性 | D20 | ◐ **72%** | → `PASS2-wave1` |
| 执行语义统一 | D19 | ◐ **72%**(核心锁/outbox/Saga 100%) | → `PASS2-wave1` |
| 运营态"拎包入住" | D26 | ◐ **87%·真缺口0** | ✅ 完工（仅人工盲测） |
| 本体治理与检索 | D14 | ◐ **92%** | → `PASS2-wave2` |
| 管理平台补全 | D22 | ◐ **88%** | → `PASS2-wave2` |
| LLM 多厂商+统一引用 | D21 | ◐ **75%** | → `PASS2-wave2` |
| 能力发现与路由 | D17 | ◐ **60%**（~1h 修） | → `PASS2-wave2` |
| 驾驶舱数据层颗粒 | backlog #34-42 | ◐ **25-30%·真半成品** | → `PASS2-wave2 §2`（高回归专项独立 PR） |

---

## 4. 顺序

1. **现在**：写 H3（北极星）→ H4 → H5 → H6 → H7（§2，确凿未建，逐份配，每份写完回写本表）。
2. **并行/穿插**：审核方做 Pass-2（`COMPLETION-LEDGER §6` Wave A/D），把 §3 的 ⬜ 逐域定级；定一个、出真缺口、配一份。
3. **开发 agent**：永远从 `START-HERE-dev-agent.md` 进，按指派领一份 HANDOFF 建，不照台账盲建。

---

> 维护：每份 HANDOFF 写完，把 §2 对应行状态从 `⬜待写/🚧起草中` 改为 `✅已就绪`，并在 `START-HERE-dev-agent.md §2` 增加该轨入口。
