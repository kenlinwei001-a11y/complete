# PRD · 自驱动 QOS · 配置化/标注/受权数据底座 —— 评审批注 + 开发顺序（落档）

> 来源：用户上传 v0.2 DRAFT（`PRD-self-driving-qos-data-foundation.md`，2026-06-23）。本仓落档版 = **评审批注（grounded 到本分支实测）+ 本体引用与影响 + 开发顺序 To-Do + PRD 核心摘要**。
> 评审人：实现 agent（claude）；状态：**方向通过、按增量融合推进**（非自包含全量新建）。

---

## 0. 评审一句话结论

**能融合，但不是"新建一套"——PRD 的 Part C/D 在系统里已 ~90% 建好（A18 + 自成长发动机），真正新且真正对症"改数据崩其他模块"的是 Part A（GenerationBoundary）。诚实边界：Part A 能大幅缓解但不能消灭"崩"。**

## 1. 本体引用与影响（铁律0 · 强制）

- **触及断点**：**G-5「应用层电池锁死」**（§8）—— 业务主数据硬编码在 `synthetic/battery.ts`，是"改一处崩别处"的本体记账。本 PRD Part A 是其增量闭合路径。
- **触及不变量**：R14（无业务常数，battery.ts 现违反）· R6（同 (tenant,seed,边界版本,args) 字节一致）· R13（溯源，临时件/合成值标 origin）· 租户隔离 · Entitlement 先于 authz · no-secrets-echo。
- **触及对象类型/链路**：`RawDataset → ObjectType.sourceBindings → SliceSpec`（数据构建闭包链，§2 数据流）· `SolverArtifact`(A18 §2.H) · `GapReport`/`GrowthLedger`(自成长 §121) · `valueDomain`/`DataCategory`(A6/数据接入分类)。
- **若实现 Part A 改变了链路/对象 → 必须回写本体 §2.A（GenerationBoundary 对象）+ §8 G-5（断点收窄）。**

## 2. 现状对照：PRD 四部分有多少已建（grounded）

| PRD 部分 | 系统现状（本体/file 实测） | 结论 |
|---|---|---|
| **Part C** 临时能力 scaffold + 工业级替换 | = **A18 全部已落**（本体 §2.H）：`SolverArtifact` + 锁死沙箱（独立子进程）+ LLM 临时求解器生成跑通 + `PROVISIONAL→GOVERNED` promote + `provisional-honesty:check` 门 + 求解器审核台 `/admin/solver-review` | **已建** |
| **Part D** 倒序成长引擎 | = **自成长发动机 P1–P6 已落**（§121）：`packages/contracts/src/growth.ts`（GapReport/7 码/`classifyGap`）+ `growth/probe` + `growth/fill-data`(真人正门) + `growth/run` LOOP(CONVERGED/BOUNDARY/MAX_ROUNDS) + GrowthLedger + GrowthTicket；**+ ModuleProvisioner**(§59 倒推 EXISTS/TO_CREATE/MISSING 统一 diff)+ **A10 verifyBuild**(§64) | **已建**（形态略异） |
| **Part B** 意图↔绑定↔sourceBindings↔槽位 | `sourceBindings`/`SliceSpec`/A6 行级过滤**已有**；绑定面板 + BP-4 `objectRef` 槽解析是**真缺口** | **大部已建** |
| **Part A** GenerationBoundary（10 类配置化边界） | `GenerationBoundary`/`BoundaryItem`/`ImportPort` **不存在**；相邻基建已有 A6 `valueDomain`(RANGE 已配置化)、`DataCategory`+`DataCategorySetting`、`Connection.category`。**核心业务主数据（BASES/MODELS/SEG_PRICE/ROOT_LIB/ORDERS/bottleneck.primary/capexScenario）仍硬编码于 `synthetic/battery.ts`** | **真新增 · 对症件** |

> **最大整合风险**：PRD 自称"自包含"、重新规定了一套 `growth.ts`/scaffold 契约（PRD 的 `GrowthLoopRun`/`CapabilityNeed` ≠ 现存 `GrowthRunReport`/`GapFinding`）。**照字面建会与 A18/自成长双重实现 + 契约打架。Part C/D 必须按"已建、PRD 是查漏文档"处理，只取真缺 delta。**

## 3. 它真能解决"改数据崩其他模块"吗？（诚实，最关键）

"崩"有**两个不同根因**，PRD 疗效不同：

- **根因 (a) 数据重复/漂移**：同一份数据要在 `battery.ts`(datacore) + `fixtures.ts`/`simSolvers.ts`(前端 mock) 同时改并手动保持一致（本会话 SEG_PRICE/BASES/audit config/MODEL_CAP_NET 均改 2–3 处），漏一处即 mock/真值漂移。
  → **GenerationBoundary 作单一来源、前后端同一份消费，直接根治。** 最大、最具体的赢面。
- **根因 (b) 跨视图值耦合**：多视图从同一基数据确定性派生，测试断言派生值（score 79 / 28px / M=3），改基数据→派生值变→断言崩。
  → **GenerationBoundary 不能消灭**（确定性派生固有）。它给的是：① 改动集中一处；② 语义目录 + sourceBindings 让**影响图可查**（改前知崩哪些）；③ 边界版本化 = R6 确定性契约（值变=显式版本号，测试按版本钉）。

**结论**：把"改散落常数、靠跑测试发现崩"升级为"改一处版本化边界、查影响图、更新钉住的期望"——**治标（单一来源/漂移）彻底，治本（跨视图耦合）变可控可分析、不变免费**。值断言测试在有意改值时仍要更新。

---

## 4. 开发顺序 · To-Do（依赖排序，grounded）

> 总原则：① **C/D 不重建只对账**；② Part A 从最常崩的高频数据起步、**单一来源优先**；③ **全程守 R6**（boundary seed=42 字节复现当前值，否则是破坏性 re-baseline）；④ 每步守绿（datacore 607 / frontend 214 / agentcore 299 基线不回潮）。

### Phase 0 — 对账 + keystone（最快见效 · 解阻断）
- [ ] **DF.0 C/D 现状对账**（无代码）：盘点 PRD Part C(=A18)/D(=自成长) vs 现存契约（`growth.ts`/`SolverArtifact`/`ModuleProvisioner`/`classifyGap`），产出「已建 / 真缺 delta」清单，写回本档附录。**依赖**：无。**风险**：低。
- [ ] **DF.1 Boundary 契约 + 单一来源读取层（keystone）**：新建 `contracts/databuilder.ts` 的 `GenerationBoundary/BoundaryItem/ImportPort`（对齐现存 `valueDomain`，**不撞** `growth.ts`）；建 `synthetic/boundary.ts` 单一来源 module，`battery.ts` + 前端 `fixtures.ts`/`simSolvers.ts` 改为从它读，**值不变（R6 字节一致）**。**依赖**：无。**风险**：R6 字节回归（必须全绿）。**验收**：同 seed 字节一致 + 前后端读同一份。

### Phase 1 — 提升高频数据（直击根因 a · 漂移）
- [ ] **DF.2 提升 BASES**（VOCAB+TOPOLOGY 硬）：`BASES` + `MODEL_BASE_MAP` + `bottleneck.primary` 入 boundary，datacore+前端同源。**依赖**：DF.1。*本会话崩最多的数据。*
- [ ] **DF.3 提升 SEG_PRICE/SEG_MARGIN/SEG_FLOOR**（RANGE/ENUM）：入 boundary，`risk.ts` + 前端 econ 同源 → 顺带闭 order §4.5-C SEG 口径分歧。**依赖**：DF.1。
- [ ] **DF.4 提升 ROOT_LIB/PROB_META + audit ext 阈值 + ORDER_OVR**（VOCAB+POLICY）：入 boundary。**依赖**：DF.1。

### Phase 2 — 语义目录 + 影响图（根因 b · 可分析）
- [ ] **DF.5 FieldProfile/PropertyDef += `description`** + `GET /a/v1/catalog/search`（schema-linking）。**依赖**：无（可与 Phase 1 并行）。
- [ ] **DF.6 影响图**：boundary item → 消费者（sourceBindings/solver/view）反向索引，"改前查崩哪些"。**依赖**：DF.1+DF.5。

### Phase 3 — 版本化 + 自动抽
- [ ] **DF.7 Boundary DRAFT→PUBLISH + version**；`boundaryVersion` 进 R6 determinism key（测试按版本钉）。**依赖**：DF.1。
- [ ] **DF.8 A5 边界自动抽**（FieldProfile 抽候选枚举/范围 → 人工定稿）。**依赖**：DF.5+DF.7。

### Phase 4 — Part B 绑定补缺（真缺口）
- [ ] **DF.9 绑定面板**（意图↔workflow/agent↔切片↔sourceBindings↔槽位↔权限）。**依赖**：sourceBindings(已有)。
- [ ] **DF.10 BP-4 objectRef 槽解析**（`classification.extractedSlots` 回灌 `fillSlots` + `selectedObjects` 解析 + 受 B3 权限过滤）。**依赖**：无。*闭 §EV BP-4。*

### Phase 5 — Part C/D delta（接 boundary，按 DF.0 对账只补真缺）
- [ ] **DF.11 `boundaryCanSynthesize` 接入**（SOFT 可合成 / HARD 真人正门），接现存 growth LOOP `fill-data`。**依赖**：DF.7 + 自成长(已有)。
- [ ] **DF.12 补 C/D 真缺 delta**（如形式化 `SCAFFOLD_ORDER/DEPS` 拓扑常量 / `reverseDerive` 若 ModuleProvisioner 未等价覆盖）。**依赖**：DF.0。

### 关键依赖边
`DF.1(keystone) → {DF.2,DF.3,DF.4}`（提升数据）· `DF.1+DF.5 → DF.6`（影响图）· `DF.1 → DF.7 → {DF.8,DF.11}`（版本化/合成）· `DF.9/DF.10/DF.5` 可与 Phase 1 并行。**DF.0 先于 DF.12。**

### 建议起手
**P0 = DF.0 + DF.1 + DF.2/DF.3**（对账 + keystone + 提升 BASES/SEG）——直接消掉"改一处崩前后端不同步"的根因 a，是投入产出比最高的一刀；其余按依赖逐 Phase 推。

---

## 5. 附：原 PRD v0.2 核心摘要（完整文本见上传 `1f86ad5d-PRDselfdrivingqosdatafoundation.md`）

- **核心思想（§0）**：硬编码业务主数据+求解逻辑 → DataBuilder 里**配置/导入、带语义备注、受权**的数据底座；其上 LLM 受边界约束生成缺失能力（临时件→工业级 drop-in 替换）。
- **Part A** 数据构建发动机：导入口（命名+描述）→ RawDataset + 语义目录（schema-linking）→ `GenerationBoundary`（10 类，硬/软，DRAFT→PUBLISH）→ 本体类型+sourceBindings+切片+规则。**10 类边界**（§A4-T）：VOCAB/TOPOLOGY(认证网络·多层BOM)/ENUM/RANGE/TEMPORAL(爬坡·检修)/UNIT/SCALE/POLICY/EXTERNAL/META(数据新鲜度)。
- **Part B** 运行期绑定：意图↔workflow/agent↔切片/sourceBindings↔权限↔槽位（`DataBindingSchema`）；修 BP-4 槽解析。
- **Part C** 临时能力 scaffold：`PROVISIONAL_SOLVERS` + 信任降级 + 冻结契约=验收+债务 + promote。
- **Part D** 倒序成长引擎：缺口 DAG(7 类)+`classifyGap`(7 码)+`reverseDerive`+有界收敛 LOOP(4 终态)+真人正门 DataRequest+逐层 promote+成长账本+门禁。
- **需求源（§EV）**：10 卡探测 7 断点（BP-1 sop_balance 缺失 / BP-4 objectRef 槽 / BP-3 入参契约 …）→ D1–D7。

> **注**：本档为评审+开发顺序落档，按"先定稿不实现"节奏；DF.* 待办与 `docs/TODO-prd-pack.md` 联动。
