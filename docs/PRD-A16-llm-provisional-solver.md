# PRD · A16 · LLM 临时求解器（origin=LLM · 沙箱跑通 · 可溯可替换 · 受治理晋升）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 5（新增需求，修订设计红线） |
| 取代/扩展 | **修订** `PRD-A13`/原"求解器不可由 LLM 生成"红线 → 改为"可生成、作受治理临时件"；扩 `PRD-A5/A10`（建域可真出可跑求解器）· `PRD-A1`（MCP 暴露带 PROVISIONAL 标）· `PRD-demand-pulled-growth-engine`（缺求解器不再只开工单，可先出临时件跑通） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.E 求解器 · §5 R4/R5/R6/R11/R12/R13 · §7 VLE） · `apps/datacore/src/solvers/service.ts`（SOLVER_KEYS/loadContext/SOLVER_OUTPUT_SHAPES）· `services/optimizer`（自托管隔离范式） · `databuilder/comprehend.ts`（solverNeeds） |
| 索引 | `PRD-A-series-roadmap.md` |

> 用户裁决：**允许 LLM 生成求解器代码**，标 `来源=LLM`，**必须跑通才生效**，后续**人工可调整/替换**。本 PRD 把它做成：LLM 生成 → **冻结代码** → **沙箱跑通自检** → 注册为 **PROVISIONAL（临时）求解器** → 推演可用（**全程带"临时·未验证"标**，写真值受门控）→ 人工 **审阅/调整/替换/晋升为受治理确定性求解器**。**目标：闭环能跑完，且诚实标注可信级，不污染真值链。**

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.E）：`Solver`（扩 `origin: BATTERY|GENERIC|HUMAN|LLM`、`trustLevel: UNVERIFIED|ADVISORY_PASSED|VERIFIED|CALIBRATED`、`status` 状态机见 §3.0）·**新增** `SolverArtifact`（LLM 生成的求解器代码，冻结+版本化+hash）·`SolverParam`·`SOLVER_OUTPUT_SHAPES`·`ActionDraft`（写真值门控）·`GrowthTicket`（晋升/替换工单）·`VleReport`/`Calibration`（晋升前 advisory 验证）。**LLM 生成件即"临时求解器"，以状态/标签贯穿其全生命周期。**
- **触及链路**（§3）：`comprehend/growth 缺求解器 → LLM 生成 {compute代码 + 声明输出schema + rationale} → 冻结 SolverArtifact → 沙箱执行(governed loadContext, A6 过滤) → 输出校验 → 注册 PROVISIONAL → invoke_solver(带 trustLevel) → AnswerBlock(PROVISIONAL 标)`。晋升链：`PROVISIONAL → VLE+校准 advisory + 人工审批 → GOVERNED（可写真值）` 或 `人工替换为 origin=HUMAN 确定性求解器`。
- **触及事件/数据流**（§4，D-29）：**新增** `solver.provisional_generated`（生成+跑通，NOTIFY/IN_SESSION，失效求解器列表/MCP）· `solver.status_changed`（状态机推进 §3.0，失效列表/MCP/A4 浏览）· `solver.promoted`（晋升 GOVERNED）· `solver.replaced`（人工替换）。
- **触及不变量**（§5）——**重点：如何在"允许 LLM 求解器"的同时不破坏不变量**：
  - **R6 确定性 → 靠"生成一次即冻结 + 沙箱强制确定性"满足**：LLM **只在生成时调用一次**，产物 `SolverArtifact` **冻结存储（verbatim + hash + 版本）**；之后同 artifact = 同代码 = 同输出。沙箱**禁用** `Date/Math.random/网络/fs/env` → 运行期确定。**LLM 的不确定性被冻结隔离在"生成时刻"之外。**
  - **R5 安全 → 靠沙箱隔离满足**：LLM 代码在**锁死沙箱**（无网络/无文件/无环境变量/CPU+内存+时限）里跑，数据由 host 注入、只回结果（同 CP-SAT sidecar 的"数据不出边界"范式）。
  - **R4 真值经 Action → 临时求解器不可直接写真值**：`origin=LLM_PROVISIONAL` 的输出 `trustLevel=PROVISIONAL`，**禁止驱动 Action 真值写回**（或需人工二次确认）；晋升 GOVERNED 后才解锁。**保证"临时推演 ≠ 已验证真值"。**
  - **R11/R12 闭包 → 临时求解器必须声明输出形状**：LLM 必须同时产**输出 schema**（注册进 `SOLVER_OUTPUT_SHAPES`），过 SHAPE 闭包/渲染绑定；跑通自检即"正向闭包"。
  - **R13 可溯源 → 强标注**：答案/列表/MCP 全程显示 `来源=LLM·临时·未验证`，provenance 含"由 LLM 生成的临时求解器，代码可查、未经独立验证/校准、可当场替换"。
  - **R3/R2**：entitlement 门控 + 租户隔离。
- **关闭/影响断点**（§8）：闭合"缺求解器 → 推演断链"（如本会话演示的 `mix_reallocation`）——**临时件先跑通让闭环完成**，再人工固化；推进 G-8。
- **门禁**（§7）：**新增 `solver-sandbox:check`**（沙箱无逃逸：禁网络/fs/clock/random，时限内停）· 输出形状校验 · 跑通自检（生成即必须产 shape-valid 输出，否则拒注册）· VLE/校准（**晋升时** advisory，非临时件强制）· `chain:check`（含 PROVISIONAL 标维度）。
- **回写承诺**：回写本体 §2.E（Solver.origin/trustLevel/status + SolverArtifact）· §3（生成→冻结→沙箱→注册→晋升链）· §4（solver.provisional_generated/promoted/replaced）· §5（R4/R6 在临时求解器下的措辞补充）· §7（solver-sandbox:check）· §8（G-8 推进）。

## 1. 目标 / 非目标
### 目标
1. **LLM 可生成求解器**：缺求解器时，LLM 产 `{compute(纯函数: (context,args)=>output), outputSchema, rationale}`。
2. **跑通才生效**：生成后**必须在沙箱用样例数据真跑、产出 shape-valid 输出**，否则不注册（"跑通才行"）。
3. **标注来源 + 可信级**：注册为 `origin=LLM_PROVISIONAL, trustLevel=PROVISIONAL, status=PROVISIONAL`；列表/MCP/答案/溯源全程显式标"临时·未验证"。
4. **推演可用但真值受控**：QOS/Agent 可调用 → 闭环能出答案；但**临时求解器输出不可直接写真值**（R4），仅供推演/参考。
5. **人工可调/可换/可晋升**：审阅代码 → 编辑 / 替换为手写确定性求解器 / 跑 VLE+校准 advisory 通过 + 审批 → 晋升 `GOVERNED`（解锁写真值）。
6. **确定性不破**：生成一次即冻结；沙箱强制确定执行。

### 非目标
- 不让临时求解器**默认进真值写回**（必须晋升）。
- 不要求临时件一上来就过 VLE/校准（那是**晋升**门槛，不是**生成**门槛）——但生成门槛是"沙箱跑通 + 输出形状有效"。
- 不开放沙箱的网络/文件/环境访问（安全红线不松）。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| 求解器来源 | `SOLVER_KEYS` 全为代码内置（确定性） | 无 `origin=LLM` 临时件 + 生命周期 |
| 缺求解器 | 开 GrowthTicket / generic_inference 兜底 | 不能"先生成临时件跑通让闭环完成" |
| 执行隔离 | CP-SAT 走自托管 sidecar | 无"跑 LLM 任意 JS"的锁死沙箱 |
| 可信标注 | answer trustLevel 有 AGENT_EXPLORATORY 等 | 无 solver 级 origin/trustLevel + 写真值门控 |

## 3. 设计（生成→冻结→沙箱→注册→晋升）

### 3.0 临时求解器状态机 / 标签（你的"未验证·未注册…等状态"，显式化）
`Solver.status` 为一条可观测生命周期；每态一个**标签**，在列表/MCP/答案/溯源处可见。LLM 生成件从 `GENERATED` 起，**默认就是"临时求解器"**，靠状态推进而非另起类型。

| status（标签） | 含义 | 可否被推演调用 | 可否写真值(R4) | 谁推进 |
|---|---|---|---|---|
| `GENERATED` 已生成 | LLM 产出代码+schema，**尚未跑通** | ✗ | ✗ | LLM 生成 |
| `UNREGISTERED` 未注册 | 跑通自检**失败**或人工暂存，未入注册表 | ✗ | ✗ | 沙箱自检/人工 |
| `PROVISIONAL` 临时·**未验证** | 沙箱跑通 + 输出形状有效 → 已注册为临时件 | ✅（带 UNVERIFIED 标） | ✗ | 跑通自检 |
| `ADVISORY_PASSED` 自检通过 | 跑过 VLE/校准 advisory 且通过（仍未人工固化） | ✅（带"建议级"标） | ✗ | VLE/校准 |
| `GOVERNED` 已固化 | 人工审批晋升 / 被手写确定性求解器替换 | ✅（正式） | ✅ | 人工审批 |
| `RETIRED` 退役 | 被替换或废弃 | ✗ | ✗ | 人工 |

- **trustLevel** 与 status 平行标注可信度：`UNVERIFIED`(临时) → `ADVISORY_PASSED` → `VERIFIED`/`CALIBRATED`(固化)。答案 provenance 同时显示 `origin=LLM · status=PROVISIONAL · trustLevel=UNVERIFIED · 代码可查 · 可替换`。
- **铁律**：只有 `GOVERNED` 能写真值（R4）；`GENERATED/UNREGISTERED` 不可被调用；中间态全部**可推演但强标"未验证/临时"**（R13）。状态推进发 `solver.status_changed`（并入 §4 事件）。

### 3.1 生成（LLM，一次）
- `solvers/llm-gen.ts`：缺求解器场景 → 给 LLM 提示（对象图 schema + 需求 + I/O 契约要求）→ 产 `{ computeSource(JS 纯函数文本), outputSchema(zod/JSONSchema), argsSchema, rationale }`。
- 强约束提示：函数签名固定 `(ctx, args) => output`；**禁用** import/网络/Date/random；只用注入的 `ctx`（对象数组，已 A6 过滤）。
### 3.2 冻结（R6）
- 存 `SolverArtifact{ id, key, version, computeSource, hash, outputSchema, argsSchema, origin:LLM, createdBy, rationale }`（仓储双实现 R9）。**生成后不可变**；改 = 新版本。
### 3.3 沙箱执行（R5/R6）
- `solvers/sandbox.ts`：在**锁死沙箱**执行 `computeSource`——隔离 worker/进程（候选 `isolated-vm` / `worker_thread`+冻结全局 / 子进程 seccomp），**无网络/无 fs/无 env/无 Date/无 random**，注入确定性 stub；CPU+内存+时限；输入=loadContext 数据，输出=JSON。
- **跑通自检**：注册前必须用样例 ctx 执行成功 + 输出过 `outputSchema`；失败 → 拒绝（可回带错误让 LLM 重生成 N 次，有界）。
### 3.4 注册（PROVISIONAL）
- 注册进求解器注册表（`SOLVER_KEYS` 或并行 provisional 表），`origin=LLM_PROVISIONAL, status=PROVISIONAL, trustLevel=PROVISIONAL`；输出 schema 进 `SOLVER_OUTPUT_SHAPES`。
- 发 `solver.provisional_generated`。
### 3.5 推演使用（带标 + 写真值门控）
- `invoke_solver` 可调；`SolverService.invoke` 对 PROVISIONAL 走沙箱执行；输出附 `trustLevel=PROVISIONAL` + provenance("LLM 临时求解器·未验证·代码可查·可替换")。
- **写真值门控（R4）**：基于 PROVISIONAL 求解器输出的 `ActionDraft` **被拒/强制人工二次确认**（不进自动写回）。
### 3.6 人工生命周期
- **审阅页**（A4/求解器页）：看 `computeSource` + rationale + 跑通记录 + 试运行。
- **调整**：人工编辑 → 新版本（origin 可转 HUMAN）。
- **替换**：用手写确定性求解器替换同 key（origin=HUMAN，status=GOVERNED）。
- **晋升**：跑 **VLE 七段 + 校准** advisory → 通过 + 人工审批 → `status=GOVERNED, trustLevel↑`（解锁写真值）；发 `solver.promoted`。
### 3.7 暴露（A1 MCP）
- PROVISIONAL 求解器在 MCP 页/discover 带**醒目"临时·LLM"标**；entitlement 可单独关。

## 4. 契约 / 端点
- `contracts/solvers.ts`：`Solver` 扩 `origin/trustLevel/status`；新增 `SolverArtifactSchema`、`ProvisionalSolverOutput`(含 trustLevel)。
- 端点：`POST /a/v1/solvers/generate`(缺求解器→LLM生成+沙箱跑通+注册PROVISIONAL，admin/service)· `GET /a/v1/solvers/:key/artifact`(看代码+rationale)· `POST /a/v1/solvers/:key/promote`(晋升，跑 VLE/校准+审批)· `PUT /a/v1/solvers/:key/artifact`(人工编辑/替换)。
- 事件 `solver.provisional_generated/status_changed/promoted/replaced` 入 `event-subscriptions.ts`。
- 仓储：`SolverArtifact` 双实现 + migration（R9）。

## 5. 关键流程（端到端 · 对齐真实实证的 gap）
本流程**直接续上 §5.1 实证里被 BLOCKED 的那次建域**——数据构建发动机已把缺口精确定位为 `capacity_switch_optimizer`（+`delivery_delay_forecast`）：

```
数据构建发动机建域 → 闭包 CHAIN 维 BLOCKED：SOLVER_NOT_FOUND(capacity_switch_optimizer, delivery_delay_forecast)
  → A16 介入：POST /a/v1/solvers/generate（对每个缺失 solverNeed）
  → LLM 按 BuildPlan 的 I/O 契约 + 对象图 schema 产 {compute 纯函数, outputSchema, argsSchema, rationale}
      · capacity_switch_optimizer：读 CapacityAllocation/ProductionOrder/Product → 储能→动力 重分配 → Δ收入/Δ毛利
      · delivery_delay_forecast：读 ProductionOrder/Equipment(瓶颈) → 受影响订单 + 延迟天数
  → 冻结 SolverArtifact（verbatim+hash+版本，R6）
  → 锁死沙箱用样例 ctx 跑通 + 输出过 outputSchema（跑不通则拒，status=UNREGISTERED）
  → 注册 PROVISIONAL(origin=LLM, trustLevel=UNVERIFIED)，写 SOLVER_OUTPUT_SHAPES
  → 闭包 CHAIN 维转 PASS（求解器已注册，临时件亦满足"已注册"）→ 建域从 FAILED→闭合
  → A10 重跑主问句 → 路径A 出答案（收入↑/毛利↑/延迟客户），全程标 `临时·LLM·未验证`，写真值被 R4 门挡
  → 人工审阅 capacity_switch_optimizer 代码 + rationale → 跑 VLE/校准 advisory → 晋升 GOVERNED 或替换为手写确定性版 → 此后可写真值
```

### 5.1 实证（2026-06-21 真服务 + 真 Kimi 实跑，本 PRD 的动机证据）
把那道"30% 储能→动力 切换、60 天收入/毛利、延迟客户"问句当故事跑 `POST /a/v1/databuilder/runs`（comprehend 绑真 Kimi）：
- **comprehend 真听懂**：倒推 7 对象类型（含自创 `CapacityAllocation`）+ 4 规则（含 `grossMarginRate>0.3`、`isBottleneck && utilizedHours>maxDailyCap` 表达"不新增设备"约束）+ 7 数据源 + **5 求解器需求**；storyCoverage 2/2 句全覆盖。
- **诚实 BLOCKED**：`status=FAILED`、gapReport `verdict=BLOCKED`，2 条 `SOLVER_NOT_FOUND`：`capacity_switch_optimizer` / `delivery_delay_forecast` 未注册 → 路径A 全链断；`suggestedFill=注册求解器/出骨架工单`。**未谎报 ANSWERABLE。**
- **数据未生成**（`producedDatasets=0`）：build 在闭包即停，未物化。
- → **结论**：系统能理解并倒推到精确缺口，就差这两个求解器。**A16 正是把"缺口"补成"可跑临时件"的那一步**——补上即闭合。
- **附带发现的真实小 bug**（已转 A5）：`producedArtifacts` 模块同步矩阵把 2 个不存在的求解器乐观标成 `REUSED/PUBLISHED`，与闭包门 `SOLVER_NOT_FOUND` 矛盾 → 矩阵 solver 状态应取闭包真相（A5 FDE 节点图修）。

## 6. 非功能（§5）
R6（冻结+沙箱确定）· R5（沙箱隔离不出边界）· R4（PROVISIONAL 不写真值）· R13（全程可信级标注+代码可查）· R3/R2。

## 7. 验收（DoD）
- 缺求解器可由 LLM 生成 → **沙箱跑通才注册**；跑不通诚实拒绝。
- 注册件标 `origin=LLM, PROVISIONAL`；推演可出答案且**显式标"临时·未验证"**；其输出**无法自动写真值**（R4 门）。
- `solver-sandbox:check` 证沙箱无逃逸（禁网络/fs/clock/random、时限停）。
- 人工可看代码 / 编辑 / 替换 / 晋升（晋升过 VLE+校准 advisory + 审批）。
- 同 SolverArtifact 重跑**字节一致**（R6）。
- `pnpm -r build && pnpm -r test` 全绿（生成+沙箱+晋升+双仓储测试 + 沙箱逃逸用例 + 字节一致回归）；`chain:check`/`ontology:check` 过。
- 回写本体 §2.E/§3/§4/§5/§7/§8。

## 8. 分期
- **A16.1** SolverArtifact + 锁死沙箱执行器 + `solver-sandbox:check`（先能安全跑一段冻结 JS 纯函数）。
- **A16.2** LLM 生成 + 跑通自检 + 注册 PROVISIONAL + origin/trustLevel 标注 + 写真值门控（R4）。
- **A16.3** 人工生命周期（看代码/编辑/替换/晋升 VLE+校准+审批）+ MCP 标 + 接 A5/A10（建域出可跑临时求解器）。

## 9. 需你确认（2 点）
1. **沙箱技术**：跑不可信 LLM JS，默认用**进程内 `isolated-vm`（V8 隔离，强隔离、禁全局）**；若你倾向**独立子进程/容器**（更强隔离、稍重，复用 CP-SAT sidecar 范式）或 **Python sidecar**（若要 numpy 类数值），告诉我。默认 isolated-vm。
2. **临时求解器能否写真值**：默认 **不能**（PROVISIONAL 仅推演，晋升 GOVERNED 后才解锁写真值，守 R4/R6）。若你要"临时件也能写真值（带强标 + 人工二次确认）"，请明示——但这会让未验证逻辑进真值链，需你确认接受该风险。

> 基线分支：sandbox/artifact 为新文件 + Solver 扩字段(migration)；对准基线。本 PRD 一旦落地，前面演示的"收入/毛利 what-if"即可端到端跑完（临时件），再人工固化。
