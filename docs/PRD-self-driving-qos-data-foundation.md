# PRD · 自驱动 QOS · 配置化/标注/受权数据底座 —— 评审批注 + 开发顺序（落档）

> 来源：用户上传 v0.2 DRAFT（`PRD-self-driving-qos-data-foundation.md`，2026-06-23）。本仓落档版 = **评审批注（grounded 到本分支实测）+ 本体引用与影响 + 开发顺序 To-Do + PRD 核心摘要**。
> 评审人：实现 agent（claude）；状态：**方向通过、按增量融合推进**（非自包含全量新建）。

---

## 0. 评审一句话结论（已按用户提醒纠正）

**能融合，但要点不是"C/D 已建"——C/D 只有*机制*（A18 沙箱/promote、自成长 LOOP/ledger），缺的正是 PRD 的核心论点：Part A 接地层。现有 growth 引擎是*无边界生成*（能跑通、会编造业务事实）；本 PRD 的真正价值 = 用业务词表(硬/软) + 语义目录 + 拉取靶把生成框住、使其不造业务事实，并把"改数据崩别处"从单一来源根治（根因 a）+ 影响图可分析（根因 b）。**

> **上一版自纠**：我曾把 Part C/D 收敛为"= A18 / = 自成长 P1–P6 已建"，**错在丢了 PRD 的整合主张**——实测确认 5 项即便本分支也没有（见 §2.1）：①生成接地 ②语义目录 ③拉取靶 keystone ④精确数据请求正门 ⑤A/B 归一+需求可溯。**Part A 不是配置数据的 nice-to-have，是让 C/D 安全/非编造的前置地基。**

## 1. 本体引用与影响（铁律0 · 强制）

- **触及断点**：**G-5「应用层电池锁死」**（§8）—— 业务主数据硬编码在 `synthetic/battery.ts`，是"改一处崩别处"的本体记账。本 PRD Part A 是其增量闭合路径。
- **触及不变量**：R14（无业务常数，battery.ts 现违反）· R6（同 (tenant,seed,边界版本,args) 字节一致）· R13（溯源，临时件/合成值标 origin）· 租户隔离 · Entitlement 先于 authz · no-secrets-echo。
- **触及对象类型/链路**：`RawDataset → ObjectType.sourceBindings → SliceSpec`（数据构建闭包链，§2 数据流）· `SolverArtifact`(A18 §2.H) · `GapReport`/`GrowthLedger`(自成长 §121) · `valueDomain`/`DataCategory`(A6/数据接入分类)。
- **若实现 Part A 改变了链路/对象 → 必须回写本体 §2.A（GenerationBoundary 对象）+ §8 G-5（断点收窄）。**

## 2. 现状对照：PRD 四部分有多少已建（grounded）

| PRD 部分 | 系统现状（本体/file 实测） | 结论 |
|---|---|---|
| **Part C** 临时能力 scaffold + 工业级替换 | A18 提供**机制外壳**（SolverArtifact + 锁死沙箱 + promote + 审核台）；**但生成未被业务接地**——`llm-gen.ts` 只注入「可用对象类型 schemaText」（类型级 schema），**无业务词表实例约束、无列目录、无硬/软越界拒绝** → 能引用真类型却**仍可编造实例/数值**（违 PRD 非目标"✗ 生成真实业务事实"）。沙箱只隔离副作用，不防造假。 | **机制已建 · 接地未建** |
| **Part D** 倒序成长引擎 | 自成长发动机有 probe/LOOP/ledger/ticket 机制；**但**：① 倒推不从「视图声明的输出字段」反推（**无 `VIEW_DEFS.outputFields` 拉取靶 keystone**，实测 0 命中）；② `growth/fill-data` 是**自动合成 CSV 后 `connectors.upload`**，**不是**反推一张精确导入工单（importName/描述/必填列）绑回真人正门；③ scaffold 同样未被 Part A 词表框住 | **机制已建 · 接地/拉取靶/正门未建** |
| **Part B** 意图↔绑定↔sourceBindings↔槽位 | `sourceBindings`/`SliceSpec`/A6 行级过滤已有；绑定面板 + BP-4 `objectRef` 槽解析是真缺口 | **大部已建** |
| **Part A** GenerationBoundary（10 类配置化边界）+ **语义目录(A3)** | `GenerationBoundary`/`BoundaryItem`/`ImportPort` **不存在**；`FieldProfile`/`PropertyDef` **无 `description`**、**无 `catalog/search` schema-linking**（实测 0 命中）；核心业务主数据仍硬编码于 `synthetic/battery.ts` | **真新增 · 全套对症件** |

### 2.1 关键纠正（接受用户提醒）：C/D「机制已建」≠「PRD 已建」

我上一版把 Part C/D 收敛成「= A18 / = 自成长 P1–P6」是**错的收敛**——丢了本 PRD 的**整合主张：生成必须被 Part A 接地/框住**。机制（scaffold/LOOP/promote）存在，但**接地层不存在**，而接地层正是 PRD 的核心论点。实测确认 **5 项即便本分支也没有**：

| # | PRD 主张（被我漏掉） | 现状实测 | 性质 |
|---|---|---|---|
| ① | **生成接地**：LLM 只能引用业务词表(硬)内实体、列只能取语义目录(A3)，越界标红/拒绝；软默认可提议待确认 | `llm-gen.ts` 仅注入类型 schemaText，无实例词表/列目录/越界拒绝 → 可造业务事实 | **核心论点 · 缺** |
| ② | **语义目录 A3**：`FieldProfile`/`PropertyDef` 加 `description` + `GET /catalog/search`（text2SQL schema-linking 那一半） | 两者均无 description；无 catalog/search | **缺** |
| ③ | **拉取靶 keystone（G-h）**：`VIEW_DEFS` 每条声明 `outputFields`，倒推从"视图要什么字段"反推 | 0 命中；ModuleProvisioner 从 BuildPlan need 反推，**非**从视图输出字段反推 | **缺（倒推地基）** |
| ④ | **真人正门精确数据请求**：反推 `DataRequestTicket{importName,描述,必填列}` → 连接器导入 → 按名匹配 fulfill → 重跑 | `fill-data` 自动合成 CSV 上传（可造数据），非精确导入工单绑回 Part A | **缺（语义不同）** |
| ⑤ | **A/B 归一 + 需求可溯**：§EV 10 卡→D1–D7→落点 的需求索引；引擎一套不按服务切分 | 未处理 | **缺** |

> **修正后的整合判断**：Part C/D 的**机制**可复用（不重建），但 PRD 的**真正价值 = 给这套机制装上 Part A 接地层** —— 没有 Part A，现有 growth 引擎是**无边界生成**（能跑通、会造假、违"不造业务事实"）。所以 **Part A 不是"配置数据的 nice-to-have"，而是让 C/D 安全/非编造的前置地基**。这与 R13（诚实）正交且更强：A18 标 PROVISIONAL 是"诚实告诉你不可信"，Part A 接地是"从源头不让它编造"。


## 3. 它真能解决"改数据崩其他模块"吗？（诚实，最关键）

"崩"有**两个不同根因**，PRD 疗效不同：

- **根因 (a) 数据重复/漂移**：同一份数据要在 `battery.ts`(datacore) + `fixtures.ts`/`simSolvers.ts`(前端 mock) 同时改并手动保持一致（本会话 SEG_PRICE/BASES/audit config/MODEL_CAP_NET 均改 2–3 处），漏一处即 mock/真值漂移。
  → **GenerationBoundary 作单一来源、前后端同一份消费，直接根治。** 最大、最具体的赢面。
- **根因 (b) 跨视图值耦合**：多视图从同一基数据确定性派生，测试断言派生值（score 79 / 28px / M=3），改基数据→派生值变→断言崩。
  → **GenerationBoundary 不能消灭**（确定性派生固有）。它给的是：① 改动集中一处；② 语义目录 + sourceBindings 让**影响图可查**（改前知崩哪些）；③ 边界版本化 = R6 确定性契约（值变=显式版本号，测试按版本钉）。

**结论**：把"改散落常数、靠跑测试发现崩"升级为"改一处版本化边界、查影响图、更新钉住的期望"——**治标（单一来源/漂移）彻底，治本（跨视图耦合）变可控可分析、不变免费**。值断言测试在有意改值时仍要更新。

**第三维（接地，本是 PRD 论点的另一面）**：除"改数据崩别处"外，PRD 还治"生成造业务事实"——现有 growth/A18 能 scaffold 出跑通的能力，但不防它引用虚构基地/型号/列。Part A 的词表(硬)+目录把生成框住，与"崩"问题共用同一份边界（双消费者：合成数据生成 ⊕ LLM 生成接地）。**这正是我上一版漏掉、用户提醒补回的核心。**

---

## 4. 开发顺序 · To-Do（依赖排序，grounded）

> 总原则：① **C/D 机制不重建，只对账 + 装接地层**；② **接地（grounding）是脊柱，不是收尾**——PRD 价值 = 把现有无边界生成框进 Part A；③ Part A 从最常崩的高频数据起步、**单一来源优先**；④ **全程守 R6**（boundary seed=42 字节复现当前值，否则破坏性 re-baseline）；⑤ 每步守绿（datacore 607 / frontend 214 / agentcore 299 不回潮）。

### Phase 0 — 单一来源 keystone（解阻断 · 根因 a 漂移）
- [ ] **DF.0 C/D 现状对账**（无代码）：盘点 PRD Part C(机制=A18)/D(机制=自成长) vs 现存契约，产出「机制已建 / 接地·拉取靶·正门 真缺」清单（含 §2.1 五项）。**依赖**：无。
- [ ] **DF.1 Boundary 契约 + 单一来源读取层（keystone）**：新建 `GenerationBoundary/BoundaryItem/ImportPort`（对齐 `valueDomain`，**不撞** `growth.ts`）；建 `synthetic/boundary.ts` 单一来源，`battery.ts`+前端 `fixtures.ts`/`simSolvers.ts` 改从它读，**值不变（R6 字节一致）**。**依赖**：无。**验收**：同 seed 字节一致 + 前后端同源。
- [ ] **DF.2 提升 BASES**（VOCAB+TOPOLOGY 硬）· **DF.3 提升 SEG_PRICE/MARGIN/FLOOR**（RANGE/ENUM，顺带闭 order §4.5-C）· **DF.4 提升 ROOT_LIB/PROB_META/audit ext 阈值/ORDER_OVR**（VOCAB+POLICY）。**依赖**：DF.1。*本会话崩最多的数据。*

### Phase 1 — 接地地基：语义目录 + 拉取靶（grounding 前置，对应 §2.1 ②③）
- [ ] **DF.5 语义目录 A3（②）**：`FieldProfile`/`PropertyDef` += `description`；`GET /a/v1/catalog/search`（表/列/描述/枚举检索 = text2SQL schema-linking 那一半）。**依赖**：无（可与 Phase 0 并行）。
- [ ] **DF.6 拉取靶 keystone（③ · G-h）**：`VIEW_DEFS` 每条声明 `outputFields`（该视图渲染需要的求解器输出字段路径）；无 outputFields 的视图倒推 verdict=BLOCKED。**这是"从视图要什么字段反推"的地基**，与 ModuleProvisioner 的 BuildPlan-need 反推互补。**依赖**：无。
- [ ] **DF.7 影响图**：boundary item → 消费者（sourceBindings/solver/view.outputFields）反向索引，"改前查崩哪些"（根因 b 可分析）。**依赖**：DF.1+DF.5+DF.6。

### Phase 2 — 接地核心（PRD 论点 · 对应 §2.1 ①④）：把生成框进 Part A
- [ ] **DF.8 生成接地 hook（① · 核心论点）**：`solvers/llm-gen.ts` + scaffold 生成时，把 prompt 从"类型 schemaText"升级为注入 **已发布业务词表(硬)实例 + 语义目录(A3)列**；产物**实体只能取词表、列只能取目录**，越界标红/拒绝；软默认可提议待确认。**使现有 A18 生成从"能引用真类型"升到"不造业务事实"**。**依赖**：DF.2–DF.5。**验收**：注入虚构基地名 → 拒绝/标红；同 seed 确定性。
- [ ] **DF.9 真人正门精确数据请求（④）**：从 need 的 `sourceBindings` 期望列**反推** `DataRequestTicket{importName,描述,必填列}` → 连接器导入 → 按 importName 匹配 fulfill → 重跑（与现 `fill-data` 自动合成分流：**HARD 数据走正门、SOFT 才合成**，`boundaryCanSynthesize` 判定）。**依赖**：DF.1(HARD/SOFT) + 自成长(已有)。**验收**：HARD 缺 → BOUNDARY + 精确列工单，非静默合成。

### Phase 3 — 版本化 + 自动抽
- [ ] **DF.10 Boundary DRAFT→PUBLISH + version**；`boundaryVersion` 进 R6 key（测试按版本钉）。**依赖**：DF.1。
- [ ] **DF.11 A5 边界自动抽**（FieldProfile 抽候选枚举/范围 → 人工定稿）。**依赖**：DF.5+DF.10。

### Phase 4 — Part B 绑定补缺
- [ ] **DF.12 绑定面板**（意图↔workflow/agent↔切片↔sourceBindings↔槽位↔权限）。**依赖**：sourceBindings(已有)。
- [ ] **DF.13 BP-4 objectRef 槽解析**（`extractedSlots` 回灌 `fillSlots` + `selectedObjects` 解析 + B3 权限）。*闭 §EV BP-4。*

### Phase 5 — A/B 归一 + 需求可溯（⑤）+ C/D delta 补缺
- [ ] **DF.14 需求可溯（⑤）**：§EV 10 卡→D1–D7→落点 建 demand-indexed 索引，连 `GrowthLedger`（问句=需求索引，可答率回溯到断点）。**依赖**：自成长(已有)。
- [ ] **DF.15 A/B 归一评估（⑤）**：引擎"一套不按服务切分"——现状 ModuleProvisioner(datacore) + cross-system scaffold(A→B) 已部分归一；评估与 PRD 主张差距，必要处补。**依赖**：DF.0。
- [ ] **DF.16 补 C/D 真缺 delta**（按 DF.0：如 `reverseDerive` 从 outputFields 反推 vs ModuleProvisioner 接缝、`SCAFFOLD_ORDER/DEPS` 形式化）。**依赖**：DF.0+DF.6。

### 关键依赖边（grounding 为脊柱）
`DF.1 → {DF.2,DF.3,DF.4}` · `{DF.2–DF.5} → DF.8(接地核心)` · `DF.5+DF.6 → DF.7(影响图)` · `DF.1 → DF.9(正门) / DF.10(版本化)`。**DF.6 拉取靶 + DF.8 接地 hook 是 PRD 论点的两块地基，不可后置为收尾。**

### 建议起手
**P0 = DF.0 对账 + DF.1 单一来源 keystone + DF.2/DF.3 提升 BASES/SEG**（灭根因 a）；**紧接 DF.5 目录 + DF.6 拉取靶 + DF.8 接地 hook**（PRD 真正论点：让生成不造业务事实）。前者投入产出比最高、后者是 PRD 不可省的核心。

---

## 5. 附：原 PRD v0.2 核心摘要（完整文本见上传 `1f86ad5d-PRDselfdrivingqosdatafoundation.md`）

- **核心思想（§0）**：硬编码业务主数据+求解逻辑 → DataBuilder 里**配置/导入、带语义备注、受权**的数据底座；其上 LLM 受边界约束生成缺失能力（临时件→工业级 drop-in 替换）。
- **Part A** 数据构建发动机：导入口（命名+描述）→ RawDataset + 语义目录（schema-linking）→ `GenerationBoundary`（10 类，硬/软，DRAFT→PUBLISH）→ 本体类型+sourceBindings+切片+规则。**10 类边界**（§A4-T）：VOCAB/TOPOLOGY(认证网络·多层BOM)/ENUM/RANGE/TEMPORAL(爬坡·检修)/UNIT/SCALE/POLICY/EXTERNAL/META(数据新鲜度)。
- **Part B** 运行期绑定：意图↔workflow/agent↔切片/sourceBindings↔权限↔槽位（`DataBindingSchema`）；修 BP-4 槽解析。
- **Part C** 临时能力 scaffold：`PROVISIONAL_SOLVERS` + 信任降级 + 冻结契约=验收+债务 + promote。
- **Part D** 倒序成长引擎：缺口 DAG(7 类)+`classifyGap`(7 码)+`reverseDerive`+有界收敛 LOOP(4 终态)+真人正门 DataRequest+逐层 promote+成长账本+门禁。
- **需求源（§EV）**：10 卡探测 7 断点（BP-1 sop_balance 缺失 / BP-4 objectRef 槽 / BP-3 入参契约 …）→ D1–D7。

> **注**：本档为评审+开发顺序落档，按"先定稿不实现"节奏；DF.* 待办与 `docs/TODO-prd-pack.md` 联动。
