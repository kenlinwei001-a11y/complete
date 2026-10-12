# PRD · A18 · 未审核态全栈建域闭环（LLM 临时件 · 沙箱 · 双模闭包 · 消灭"全 0"）

| 项 | 值 |
|---|---|
| 版本 | v0.2 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 5（**自包含总装 PRD**） |
| 合并 | **吸收并取代 A16（LLM 临时求解器）+ A17（未审核态全域构建）** —— 三合一，机制细节全在本文；A16/A17 文件已删 |
| 取代/扩展 | 关联 `PRD-A7`（B栈 scaffold 单机可见）·`PRD-A10`（终态验证）·`PRD-A5`（节点图显未审核态）；**修订**原"求解器/域不可由 LLM 生成、缺一环全 0"的 HARD 红线 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.E/H · §3 构建链 · §5 R4/R6/R11/R12/R13 · §7 VLE · §8 G-8） · `apps/datacore/src/databuilder/{service.ts,closure.ts,artifacts.ts}` · `apps/datacore/src/solvers/service.ts` · `services/optimizer`（自托管隔离范式） |
| 索引 | `PRD-A-series-roadmap.md` |

> **一句话**：开 **PROVISIONAL（未审核）模式**——闭包门从"HARD 原子闸（缺一环→全 0）"降为 **ADVISORY（如实记缺口、不阻断）**；缺求解器由 **LLM 生成临时件 + 锁死沙箱跑通**；本体/数据/规则/切片/B栈 全部以**未审核态**建出（隔离、强标）→ 端到端推演 **PROVISIONAL_ANSWER** → 人工**审核→发布**晋升为真值。**目标：那道"30% 储能→动力"问句再跑，实证表 6 行从 ❌/◐ 全翻 ✅（未审核态产出）+ 端到端出答案。**
>
> **设计哲学转向**：守"不谎报"靠 **标注 + 写真值门控 + 绝不报 ANSWERABLE/VERIFIED**，而**不**靠"阻断成 0"。STRICT 原子闸保留为"发布真值"默认；PROVISIONAL 为"未审核预览/推演"并行车道。

## §A 术语：「未审核态」定义（用户钉死 2026-06-21）
未审核 = **立即可用**（可被推演/预览/调用），但**尚未走完"全流程审核 → 发布"**。它是生命周期的**中间可用态**，不是终态：
```
生成(LLM/comprehend) → 【未审核·可用】 → 全流程审核(逐制品 review + 求解器过 VLE/校准 + 闭包缺口清零) → 发布(R4 审批落真值) → 【GOVERNED·真值】
```
即 `status=PROVISIONAL · trustLevel=UNVERIFIED`：**能用，但带"未走完审核发布"标，且不写真值**；走完审核+发布即晋升 GOVERNED。**LLM 生成的求解器/本体/数据皆是此态的实例。**

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.E/H/A/B）：
  - `StoryBuildRun`（加 `buildMode: STRICT|PROVISIONAL` + `domainTrustLevel`）；
  - `Solver`（扩 `origin: BATTERY|GENERIC|HUMAN|LLM`、`trustLevel: UNVERIFIED|ADVISORY_PASSED|VERIFIED|CALIBRATED`、`status` 见 §3.0）·**新增** `SolverArtifact`（LLM 生成代码，冻结+hash+版本）；
  - `OntologyType/Rule/SliceSpec/ObjectInstance(数据)/Agent/Workflow/Skill/Intent/ExecutionPlan/Scenario`（全部加 `origin/status` 同上状态机）；
  - `ClosureReport`（findings 加 `severity: HARD|ADVISORY`）·`ScaffoldManifest`(A7)·`ActionDraft`（写真值门控）·`VleReport`/`Calibration`（晋升前 advisory）。
- **触及链路**（§3 构建链）：`comprehend → BuildPlan → 闭包(PROVISIONAL=ADVISORY) → 缺求解器=LLM临时生成+沙箱跑通 → 本体/数据/规则/切片/B栈 以未审核态落库(隔离) → 端到端推演 PROVISIONAL_ANSWER → 人工审核 → 晋升 GOVERNED(发布真值)/替换/丢弃`。
- **触及事件/数据流**（§4，D-29）：**新增** `solver.provisional_generated`·`solver.status_changed`·`domain.provisional_built`·`domain.promoted`·`solver.promoted/replaced`；复用 `materialize.completed`(隔离标)·`storybuild.run_recorded`·A7 `scaffold.manifest_recorded`。
- **触及不变量**（§5）——**重点：怎么"全用未审核件"又不破不变量**：
  - **R6 确定性 → "生成一次即冻结 + 沙箱强制确定"**：LLM 只在生成时调一次，产物冻结（verbatim+hash+版本）；沙箱禁 `Date/random/网络/fs/env` → 运行期确定；合成数据走确定性 GenSpec。**LLM 不确定性被冻结隔离在"生成时刻"之外。**
  - **R5 安全 → 锁死沙箱**：LLM 代码在隔离 worker/进程跑（无网络/无 fs/无 env + CPU/内存/时限），数据注入、只回结果（同 CP-SAT sidecar"数据不出边界"）。
  - **R4 真值经 Action → 未审核件不写真值**：`status=PROVISIONAL` 的求解器/本体/数据/规则/Agent **只供推演/预览，禁止驱动 Action 真值写回**；晋升 GOVERNED 解锁。**这是守"不污染真值"的关键门，不靠阻断构建。**
  - **R11/R12 闭包 → PROVISIONAL 下转 ADVISORY**：照常检测并如实记录所有缺口/断链（CHAIN/SHAPE/OBJECT/DATA/FORWARD），记 `severity=ADVISORY`（不阻断）；**STRICT 模式仍 HARD 阻断（发布真值默认）**；临时求解器必须声明输出 schema（进 `SOLVER_OUTPUT_SHAPES`，跑通即正向闭包）。
  - **R13 可溯源/不谎报（红线）**：每制品+答案强标 `status=PROVISIONAL · trustLevel=UNVERIFIED · origin=LLM`；终态 verdict 只能 **`PROVISIONAL_ANSWER`，绝不 ANSWERABLE/VERIFIED**（守 AUDIT-hand-run"谎报 ANSWERABLE"不复发）。
  - **R2 隔离 → 未审核件命名空间隔离**：PROVISIONAL 对象/数据打 `origin=LLM_PROVISIONAL` + 隔离视图，**不混入受治理真值查询/推演**（governed 默认排除 PROVISIONAL），防污染真值库。
- **关闭/影响断点**（§8）：**收尾 G-8**——"缺一环全断、闭环跑不完"彻底闭合（未审核态总能跑完）；新风险（未审核误当真值）由"写真值门控 + 隔离 + 强标 + 绝不谎报"管住。
- **门禁**（§7）：双模 `closure`（STRICT=HARD / PROVISIONAL=ADVISORY）· **新增 `solver-sandbox:check`**（沙箱无逃逸）· **新增 `provisional-honesty:check`**（PROVISIONAL 域答案不得标 ANSWERABLE/VERIFIED、不得写真值、所有制品带未审核标）· `chain:check`（含 PROVISIONAL 维）· `debattery:check`。
- **回写承诺**：回写本体 §2.E/H（buildMode/domainTrustLevel + 各制品 origin/status + SolverArtifact）· §3（未审核全栈产出链 + 晋升链）· §4（新事件）· §5（R4/R6/R11/R13 在未审核态下措辞）· §7（双模闭包 + 两新门）· §8（G-8 收尾 + 新风险登记）。

## 1. 问题清单（= 那次建域"全 0"实证表，逐行待消灭）+ 目标/非目标
| # | 类别 | 实证结果 | 根因 |
|---|---|---|---|
| P1 | **数据(datasets)** | ❌ `producedDatasets=0` | 物化在闭包后，闸门没过 → 没物化 |
| P2 | **本体(对象类型)** | ◐ 仅 DRAFT、未发布、整体 BLOCKED | DRAFT 不可用 + 闸门阻断 |
| P3 | **切片** | ◐ DRAFT 未发布 | 同 P2 |
| P4 | **规则/约束** | ◐ DRAFT 未生效 | 同 P2 |
| P5 | **求解器** | ❌ 没新建；缺 `capacity_switch_optimizer`/`delivery_delay_forecast`→致 BLOCKED | comprehend 只产需求不产代码 + 缺件卡闭包 |
| P6 | **Agent/工作流/技能/意图/计划/场景(B栈)** | ❌ 0 个 | B栈 scaffold 在闭包后，闸门没过 |

> 共同根因：**HARD 原子闸**——缺一环 → 闸后(物化/scaffold/发布)全断 → 全 0。

**目标**：① 全域未审核态可用（含 LLM 临时求解器）；② 缺环时闭环总能跑完出 `PROVISIONAL_ANSWER`；③ 诚实不谎报；④ 真值受控（不写真值/隔离，人工审核→发布晋升）。
**非目标**：不把 PROVISIONAL 当发布默认（STRICT 仍是写真值唯一路径）；不允许未审核件自动写真值或混入受治理推演；不取消闭包检测（只降阻断为告警）；不开放沙箱网络/fs/env。

## 2. 现状与根因（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| 闭包门 | `closure.ts` HARD 阻断 → 缺一环 FAILED/BLOCKED（实证全 0） | 无 PROVISIONAL/ADVISORY 双模 |
| 求解器来源 | `SOLVER_KEYS` 全代码内置；缺则开工单/generic_inference | 无 `origin=LLM` 临时件 + 沙箱 + 生命周期 |
| 制品状态 | producedArtifacts DRAFT/PUBLISHED | 无统一 origin/status=PROVISIONAL + 隔离 + 写真值门控 |
| 数据 | 闭包过才物化 | 无 PROVISIONAL 合成数据（隔离标） |
| 执行隔离 | CP-SAT 走自托管 sidecar | 无"跑 LLM 任意 JS"的锁死沙箱 |
| 终态 | FAILED/BLOCKED 或 VERIFIED/ANSWERABLE | 无 `PROVISIONAL_ANSWER`；A5 矩阵把未注册求解器乐观标 REUSED（实证 bug） |

## 3. 设计

### 3.0 未审核态状态机 / 标签（贯穿所有制品；求解器为典型）
`status` 为可观测生命周期；每态一标签，在列表/MCP/答案/溯源处可见。LLM 生成件从 `GENERATED` 起即"临时件"，靠状态推进而非另起类型。

| status（标签） | 含义 | 可被推演调用 | 可写真值(R4) | 谁推进 |
|---|---|---|---|---|
| `GENERATED` 已生成 | LLM 产出代码/定义，**未跑通/未注册** | ✗ | ✗ | LLM 生成 |
| `UNREGISTERED` 未注册 | 跑通自检失败或人工暂存 | ✗ | ✗ | 沙箱自检/人工 |
| `PROVISIONAL` 临时·**未验证** | 跑通+形状有效 → 已注册临时件 | ✅（带 UNVERIFIED 标） | ✗ | 跑通自检 |
| `ADVISORY_PASSED` 自检通过 | 过 VLE/校准 advisory（仍未人工固化） | ✅（建议级标） | ✗ | VLE/校准 |
| `GOVERNED` 已固化 | 人工审批晋升 / 被手写确定版替换 | ✅（正式） | ✅ | 人工审批 |
| `RETIRED` 退役 | 被替换或废弃 | ✗ | ✗ | 人工 |

铁律：只有 `GOVERNED` 能写真值（R4）；`GENERATED/UNREGISTERED` 不可调用；中间态全部**可推演但强标"未验证/临时"**（R13）。推进发 `solver.status_changed`/`domain.*`。

### 3.1 双模闭包（STRICT / PROVISIONAL）
- `runStory(..., { buildMode })`。STRICT=现状（HARD 闸、原子、0-或-全、写真值，**发布默认**）。PROVISIONAL=新（闭包照常算所有维 → 缺口记 `severity=ADVISORY` 不阻断、建透、全标未审核、不写真值）。

### 3.2 LLM 临时求解器（消灭 P5）：生成 → 冻结 → 沙箱 → 注册 → 跑通自检
- **生成**（`solvers/llm-gen.ts`）：缺求解器 → 给 LLM（对象图 schema + BuildPlan I/O 契约）→ 产 `{ computeSource(JS 纯函数 `(ctx,args)=>output`), outputSchema, argsSchema, rationale }`；强约束：禁 import/网络/Date/random，只用注入 `ctx`。
- **冻结**（`SolverArtifact`，R6）：verbatim+hash+版本存储，**不可变**；改=新版本。
- **沙箱**（`solvers/sandbox.ts`，R5/R6）：锁死隔离执行（默认 `isolated-vm`；候选独立子进程/容器）——无网络/fs/env/Date/random，CPU+内存+时限；输入=loadContext(A6 过滤)，输出=JSON。
- **跑通自检**：注册前必须用样例 ctx 执行成功 + 输出过 `outputSchema`；失败→拒（status=UNREGISTERED，可有界重生成）。
- **注册**：`origin=LLM, status=PROVISIONAL, trustLevel=UNVERIFIED`，写 `SOLVER_OUTPUT_SHAPES`；发 `solver.provisional_generated`。
- 解你那题：临时生成 `capacity_switch_optimizer`（CapacityAllocation/Order/Product→储能→动力 重分配→Δ收入/Δ毛利）+ `delivery_delay_forecast`（Order/Equipment→受影响订单+延迟）。

### 3.3 全域未审核件（消灭 P2/P3/P4/P6）
- 本体/规则/切片 → 创建 `status=PROVISIONAL`（**可用，非仅 DRAFT-blocked**）。
- 数据 → 确定性 GenSpec 合成为 **PROVISIONAL ObjectInstance**（`origin=LLM_PROVISIONAL`，隔离命名空间）→ 发 `materialize.completed`(隔离标)。**消灭 P1。**
- B栈（Agent/工作流/技能/意图/计划/场景）→ scaffold `status=PROVISIONAL`（可调用，标未审核）；**不配 AGENTCORE_BASE_URL 也单机可见**（A7 `ScaffoldManifest` 落 DataCore）。

### 3.4 隔离（防污染真值，R2）
PROVISIONAL 制品全打 `origin=LLM_PROVISIONAL`；受治理查询/推演默认排除 PROVISIONAL；仅显式 provisional 上下文（该 run 预览/推演）可见可跑。

### 3.5 端到端推演（PROVISIONAL_ANSWER）+ 写真值门控
- 未审核域上跑主问句 → 出答案，`trustLevel=UNVERIFIED`，每数字 provenance 标"基于未审核临时件（本体/数据/求解器皆未审核）"。
- 终态 `verdict=PROVISIONAL_ANSWER`（**绝不** ANSWERABLE/VERIFIED）；ADVISORY 缺口随答案显示（"未验证：求解器逻辑、细分经济性数据"）。
- 写真值门控（R4）：基于 PROVISIONAL 域的 ActionDraft 一律拒/需先晋升。

### 3.6 人工审核 → 发布晋升
- 审核台（DataBuilderPage/A4）：逐制品看 origin/status + 代码/定义 + rationale + ADVISORY 缺口 + 试运行。
- **晋升**：逐制品或整域 `promote` → 对象/规则/切片发布真值（R4 审批）、求解器过 VLE/校准、数据物化为真值、B栈 DRAFT→PUBLISHED → `status=GOVERNED`；发 `domain.promoted`。亦可**替换**（手写确定版）/ **丢弃**。
- A5 节点图显 PROVISIONAL 态 + ADVISORY 缺口；A10 验证区分 `PROVISIONAL_ANSWER` vs `VERIFIED`。

### 3.7 逐行修法矩阵（对照实证表）
| # | 修法 | 来源章 | 该行验收（再跑同题，buildMode:PROVISIONAL） |
|---|---|---|---|
| P1 数据 | PROVISIONAL 确定性合成数据物化(隔离) | §3.3 | `producedDatasets>0`，未审核数据可被该 run 推演读到 |
| P2 本体 | 建为 PROVISIONAL 可用 | §3.3 | 7 类型 PROVISIONAL 可查可推演 |
| P3 切片 | 建为 PROVISIONAL，可执行 | §3.3 | 7 切片 PROVISIONAL 可执行 |
| P4 规则/约束 | 建为 PROVISIONAL，推演中可评估 | §3.3 | 4 规则 PROVISIONAL 生效于推演（非真值） |
| P5 求解器 | LLM 临时生成 2 缺件+沙箱跑通；复用 3 个；修 A5 矩阵注册核验 bug | §3.2 | 5 求解器全可调（2 临时+3 复用）；闭包 CHAIN 转 ADVISORY/PASS |
| P6 B栈 | 闭包 ADVISORY 后照常 scaffold PROVISIONAL，单机可见 | §3.3+A7 | 6 类 B栈各 ≥1 PROVISIONAL（含倒推 agent） |

> 附带修：A5 模块同步矩阵把未注册求解器乐观标 `REUSED/PUBLISHED` 的 bug → `deriveProducedArtifacts` 对 solver 做注册存在性核验，状态取闭包真相。

## 4. 契约 / 端点
- `contracts`：`StoryBuildRun.buildMode/domainTrustLevel`；各制品 `origin/status`（§3.0 枚举）；`SolverArtifactSchema`；`ClosureFinding.severity:HARD|ADVISORY`；`verdict` 加 `PROVISIONAL_ANSWER`；`ProvisionalSolverOutput`(含 trustLevel)。
- 端点：`POST /a/v1/databuilder/runs`(body 加 `buildMode`)· `POST /a/v1/solvers/generate`(LLM 生成+沙箱跑通+注册 PROVISIONAL)· `GET /a/v1/solvers/:key/artifact`(看代码+rationale)· `POST /a/v1/databuilder/runs/:id/promote` 与 `POST /a/v1/solvers/:key/promote`(晋升)· `PUT /a/v1/solvers/:key/artifact`(编辑/替换)· 复用 A7 `ScaffoldManifest`/`reconcile-scaffold`。
- 事件入 `event-subscriptions.ts`；仓储：`SolverArtifact` + 各制品 origin/status + PROVISIONAL 隔离标（R9 四处 + migration）。

## 5. 关键流程（端到端 · 再跑那道题，6 行全产出）
`runStory("30% 储能→动力…", buildMode:PROVISIONAL)`：
1. comprehend(Kimi) → BuildPlan（7 类型/4 规则/5 求解器需求/7 数据源/B栈需求）。
2. 闭包 ADVISORY：记 `capacity_switch_optimizer`/`delivery_delay_forecast` 缺（不阻断）。
3. **P5**：LLM 临时生成这 2 求解器 + 沙箱跑通（PROVISIONAL）。
4. **P2/P3/P4**：本体/切片/规则建为 PROVISIONAL（隔离、强标）。
5. **P1**：确定性合成 PROVISIONAL 数据落库（隔离）。
6. **P6**：scaffold B栈为 PROVISIONAL（A7 单机可见）。
7. 端到端推演 → **`PROVISIONAL_ANSWER`**：收入↑X/毛利↑Y/延迟客户 Z（全标"未审核·基于临时件"，写真值被挡）+ ADVISORY 缺口列表。
8. 人工审核 → 整域晋升 GOVERNED（发布真值、求解器过 VLE/校准）/替换/丢弃。

## 6. 非功能（§5）
R4（未审核不写真值/晋升解锁）· R6（冻结+沙箱+GenSpec 确定，字节一致）· R5（沙箱隔离不出边界）· R11/R12（闭包 ADVISORY 如实记缺口）· R13（强标未审核+绝不谎报）· R2（隔离防污染）。

## 7. 验收（DoD = 那张表全部翻 ✅·PROVISIONAL）
| # | 验收（再跑同题，buildMode:PROVISIONAL） |
|---|---|
| P1 | `producedDatasets>0`，未审核数据可被推演读到 |
| P2/P3/P4 | 7 类型 + 7 切片 + 4 规则 PROVISIONAL 可查/可执行/可评估 |
| P5 | 5 求解器全可调（2 临时跑通+3 复用）；A5 矩阵不再乐观误报 |
| P6 | 6 类 B栈各 ≥1 PROVISIONAL，单机可见 |
| 全局 | 终态 `PROVISIONAL_ANSWER`（**绝不** ANSWERABLE/VERIFIED）；全制品+答案强标"未审核"；不写真值；隔离不污染真值；人工可整域晋升 |
| 工程 | `pnpm -r build && pnpm -r test` 全绿；双模闭包 + `provisional-honesty:check` + `solver-sandbox:check`（沙箱无逃逸）+ chain:check + debattery:check 过；同 (script,seed) 字节一致（R6）；STRICT 模式行为不变 |

## 8. 分期
- **A18.1** 双模闭包 + buildMode 开关 + `PROVISIONAL_ANSWER` + 未审核件 origin/status/隔离 + `provisional-honesty:check`（消灭 P2/P3/P4 + 解阻断）。
- **A18.2** `SolverArtifact` + 锁死沙箱 + `solver-sandbox:check` + LLM 生成+跑通自检+注册 PROVISIONAL + 写真值门控（消灭 P5）+ 修 A5 矩阵 bug。
- **A18.3** PROVISIONAL 合成数据物化（消灭 P1）+ B栈 PROVISIONAL scaffold（A7，消灭 P6）。
- **A18.4** 端到端 PROVISIONAL 推演 + 人工审核台 + 逐项/整域晋升（VLE/校准+R4）+ A5/A10 接入。

## 9. 需你确认
1. **沙箱技术**：默认 `isolated-vm`（V8 进程内强隔离）；或独立子进程/容器（更强、稍重）/ Python sidecar（要 numpy）。默认 isolated-vm。
2. **未审核数据可见范围**：默认**隔离**（不进受治理查询/推演）；若要也进对象库供普通查询（有污染风险）请明示。建议隔离。
3. **默认模式**：默认 **STRICT**（写真值），PROVISIONAL **opt-in**；是否要数据构建发动机页默认 PROVISIONAL？默认 STRICT。
4. **晋升粒度**：默认**整域一键 + 逐制品**两者；求解器晋升过 VLE/校准。同意？

> 基线分支：跨 closure/service/solvers/contracts/仓储多处 + 制品加字段(migration)，对准基线。本 PRD 自包含，无需再读 A16/A17（已并入）。
