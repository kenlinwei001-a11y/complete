# PRD · A18 · 建域全栈产出闭环（消灭"全 0" · 未审核态端到端跑通）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 5（总装/交付 PRD） |
| 性质 | **总装 PRD**：以"那次建域全 0"实证表为问题清单，逐行给修法+验收，整合 A16/A17/A7 为单一可施工规格。**目标：同一道题再跑，表里 6 行从 ❌/◐ 全部翻成 ✅（未审核态产出）+ 端到端出答案。** |
| 取代/扩展 | 整合 `PRD-A16`（LLM 临时求解器）·`PRD-A17`（未审核态全域构建）·`PRD-A7`（B 栈 scaffold 单机可见）·`PRD-A10`（终态验证）·`PRD-A5`（节点图显未审核态） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§3 构建链 · §5 R4/R6/R11/R12/R13 · §8 G-8） · `PRD-A16/A17/A7/A10` · `apps/datacore/src/databuilder/{service.ts,closure.ts,artifacts.ts}` |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：这份 PRD 不发明新机制，而是把 A16/A17/A7 **总装**成"**让数据构建发动机在缺环时也能把本体/数据/规则/求解器/B栈 全部以未审核态建出来并端到端推演**"的交付规格——**逐行消灭实证表里的每一个 ❌/◐**，全程贴"未审核"标、不写真值、人工可审核发布。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.H/A/B/E）：`StoryBuildRun`(buildMode/domainTrustLevel)·`OntologyType/Rule/SliceSpec/ObjectInstance(数据)/Solver/Agent/Workflow/Skill/Intent/ExecutionPlan/Scenario`（全部统一 `origin/status: PROVISIONAL|GOVERNED`）·`ClosureReport`(双模)·`SolverArtifact`(A16)·`ScaffoldManifest`(A7)·`ActionDraft`(写真值门控)。
- **触及链路**（§3 构建链）：`comprehend → BuildPlan → 闭包(PROVISIONAL=ADVISORY) → 缺求解器=A16临时生成 → 合成数据(PROVISIONAL) → B栈 scaffold(A7 单机可见,PROVISIONAL) → 全栈以未审核态落库(隔离) → 端到端推演 PROVISIONAL_ANSWER → 人工审核发布晋升 GOVERNED`。
- **触及事件/数据流**（§4，D-29）：复用 A16/A17/A7 事件（`solver.provisional_generated`/`domain.provisional_built`/`scaffold.manifest_recorded`）+ 既有 `materialize.completed`/`storybuild.run_recorded`（PROVISIONAL 物化亦发，隔离标）。
- **触及不变量**（§5）：
  - **R6**：所有未审核件冻结即确定（A16/A17）；合成数据走确定性 GenSpec。
  - **R4**：未审核域**不写真值**，晋升 GOVERNED 解锁。
  - **R11/R12**：闭包 ADVISORY 如实记缺口（不阻断）。
  - **R13（红线）**：每制品+答案强标"未审核"；终态仅 `PROVISIONAL_ANSWER`，**绝不** ANSWERABLE/VERIFIED。
  - **R2**：未审核件 `origin=LLM_PROVISIONAL` + 隔离命名空间，不污染真值。
- **关闭/影响断点**（§8）：**收尾 G-8**——"缺一环全断、闭环跑不完"彻底闭合（未审核态总能跑完）；新风险（未审核误当真值）由 R4 门控+隔离+强标管住。
- **门禁**（§7）：双模 `closure` · A16 `solver-sandbox:check` · A17 `provisional-honesty:check` · `chain:check`(含 PROVISIONAL 维) · `debattery:check`。
- **回写承诺**：回写本体 §3（全栈未审核产出链）· §8（G-8 收尾）；其余随 A16/A17/A7 回写。

## 1. 问题清单（= 那次建域实证表，逐行待消灭）
| # | 类别 | 实证结果 | 根因 |
|---|---|---|---|
| P1 | **数据(datasets)** | ❌ `producedDatasets=0` | 物化在闭包后，闸门没过 → 没物化 |
| P2 | **本体(对象类型)** | ◐ 仅 DRAFT 骨架、未发布、整体 BLOCKED | DRAFT 不可用 + 闸门阻断 |
| P3 | **切片** | ◐ DRAFT 未发布 | 同 P2 |
| P4 | **规则/约束** | ◐ DRAFT 未生效 | 同 P2 |
| P5 | **求解器** | ❌ 没新建；缺 `capacity_switch_optimizer`/`delivery_delay_forecast` → 这俩导致 BLOCKED | comprehend 只产需求不产代码 + 缺件卡闭包 |
| P6 | **Agent/工作流/技能/意图/计划/场景(B栈)** | ❌ 0 个 | B栈 scaffold 在闭包后，闸门没过 → 没到 |

> 共同根因（已诊断）：**HARD 原子闸**——缺一环 → 闸后(物化/scaffold/发布)全断 → 全 0。

## 2. 总修法（一句话）
**开 PROVISIONAL 模式（A17）：闭包降为 ADVISORY 不阻断 → 缺求解器即 A16 临时生成 → 本体/数据/规则/B栈 全部以未审核态建出（隔离、强标）→ 端到端推演 PROVISIONAL_ANSWER → 人工审核发布晋升。** 下表逐行落到具体动作。

## 3. 逐行修法（每行 = 问题 → 修法 → 用哪个机制 → 验收）
| # | 修法（PROVISIONAL 模式下） | 机制来源 | 该行验收（再跑同题） |
|---|---|---|---|
| **P1 数据** | 闭包 ADVISORY 后继续走物化：用确定性 GenSpec 为各对象类型**合成 PROVISIONAL 数据**（`origin=LLM_PROVISIONAL`，隔离命名空间，R6 字节一致），发 `materialize.completed`(隔离标) | A17 §3.2 + A6 值域 | `producedDatasets > 0`，每对象类型有未审核数据行，可被该 run 推演读到 |
| **P2 本体** | 对象类型创建为 **`status=PROVISIONAL`（可用，非仅 DRAFT-blocked）**；隔离命名空间 | A17 §3.2/3.3 | 7 类型 PROVISIONAL 可查可推演，标未审核，不写真值 |
| **P3 切片** | 切片同建为 PROVISIONAL，`executeSlice` 在 provisional 上下文可跑 | A17 §3.2 | 7 切片 PROVISIONAL 可执行 |
| **P4 规则/约束** | 规则建为 PROVISIONAL，可在推演中评估（标未审核） | A17 §3.2 | 4 规则 PROVISIONAL 可评估，BLOCK/WARN 生效于推演（非真值） |
| **P5 求解器** | 缺的 2 个 → **A16 LLM 临时生成 + 沙箱跑通**（`capacity_switch_optimizer`/`delivery_delay_forecast`，PROVISIONAL）；已注册 3 个复用（修 A5 矩阵乐观误报 bug：未注册不得标 REUSED） | A16 + A5 bug 修 | 5 求解器全可调（2 临时 PROVISIONAL + 3 GOVERNED）；闭包 CHAIN 维转 PASS/ADVISORY |
| **P6 B栈** | 闭包 ADVISORY 后照常 scaffold Agent/工作流/技能/意图/计划/场景为 PROVISIONAL；**不配 AGENTCORE_BASE_URL 也单机可见**（A7 ScaffoldManifest 落 DataCore） | A17 §3.2 + A7 | 6 类 B栈制品各 ≥1 个 PROVISIONAL（含倒推的 agent）；单机可见 |

## 4. 契约 / 端点（多复用 A16/A17/A7）
- `POST /a/v1/databuilder/runs` body 加 `buildMode:"PROVISIONAL"`（A17）。
- 制品统一 `origin/status`（A16 枚举）；`ClosureFinding.severity:HARD|ADVISORY`；`verdict` 加 `PROVISIONAL_ANSWER`。
- `POST /a/v1/databuilder/runs/:id/promote`（全域/逐制品晋升，R4）。
- 复用 A16 `/solvers/generate`、A7 `ScaffoldManifest`/`reconcile-scaffold`。
- 仓储：各制品 origin/status + PROVISIONAL 隔离标（R9）。

## 5. 关键流程（端到端 · 再跑那道题，6 行全产出）
`runStory("30% 储能→动力…", buildMode:PROVISIONAL)`：
1. comprehend → BuildPlan（7 类型/4 规则/5 求解器需求/7 数据源/B栈需求）。
2. 闭包 ADVISORY：记 `capacity_switch_optimizer`/`delivery_delay_forecast` 缺（不阻断）。
3. **P5**：A16 临时生成这 2 求解器 + 沙箱跑通。
4. **P2/P3/P4**：本体/切片/规则建为 PROVISIONAL（隔离、强标）。
5. **P1**：确定性合成 PROVISIONAL 数据落库（隔离）。
6. **P6**：scaffold B栈为 PROVISIONAL（A7 单机可见）。
7. 端到端推演 → **`PROVISIONAL_ANSWER`**：收入↑X / 毛利↑Y / 延迟客户 Z（**全标"未审核·基于临时件"**，写真值被挡）+ ADVISORY 缺口列表（"未验证：求解器逻辑、细分经济性数据"）。
8. 人工审核 → 整域晋升 GOVERNED（发布真值、求解器过 VLE/校准）/ 替换 / 丢弃。

## 6. 验收（DoD = 那张表全部翻 ✅·PROVISIONAL）
| # | 验收（再跑同题，buildMode:PROVISIONAL） |
|---|---|
| P1 | `producedDatasets > 0`，未审核数据可被推演读到 |
| P2 | 7 对象类型 PROVISIONAL 可查可推演 |
| P3 | 7 切片 PROVISIONAL 可执行 |
| P4 | 4 规则 PROVISIONAL 可评估 |
| P5 | 5 求解器全可调（2 临时跑通 + 3 复用）；A5 矩阵不再乐观误报 |
| P6 | 6 类 B栈制品各 ≥1 PROVISIONAL，单机可见 |
| 全局 | 终态 `PROVISIONAL_ANSWER`（**绝不** ANSWERABLE/VERIFIED）；全制品+答案强标"未审核"；**不写真值**；未审核件隔离不污染真值；人工可整域晋升 |
| 工程 | `pnpm -r build && pnpm -r test` 全绿；双模闭包 + provisional-honesty:check + solver-sandbox:check + chain:check + debattery:check 过；同 (script,seed) 字节一致（R6） |

## 7. 分期（按依赖，复用 A16/A17/A7 落地）
- **A18.1** A17 双模闭包 + buildMode 开关 + `PROVISIONAL_ANSWER` + 未审核件 origin/status/隔离（消灭 P2/P3/P4 的"DRAFT 不可用"+ 解阻断）。
- **A18.2** A16 临时求解器接入（消灭 P5）+ A5 矩阵注册核验 bug 修。
- **A18.3** PROVISIONAL 合成数据物化（消灭 P1）+ B栈 PROVISIONAL scaffold（A7，消灭 P6）。
- **A18.4** 端到端推演 PROVISIONAL_ANSWER + 写真值门控 + 人工审核台/整域晋升（A10/A17）。

## 8. 需你确认（沿用 A16/A17 的待确认，汇总）
1. **沙箱技术**（A16）：默认 isolated-vm。
2. **未审核数据隔离**（A17）：默认隔离（不进受治理查询）。
3. **默认模式**：数据构建发动机页是否默认 PROVISIONAL？（默认 STRICT、PROVISIONAL 显式选）
4. **临时件/未审核域写真值**：默认不能，晋升后才行。

> 与 A16/A17/A7 的关系：本 PRD 是它们的**总装交付规格**（按实证表逐行验收），不重复造机制；实现按 §7 分期，每步复用对应子 PRD。基线分支：跨 closure/service/contracts/仓储多处，对准基线。
