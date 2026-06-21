# PRD · 合成数据向导「生成进度」按 nano-ontoprompt 分阶段集成链重设计

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 **APPROVED（已评审通过 2026-06-21）** · 日期 2026-06-21 |
| 取代/扩展 | 扩展 `PRD-frontend.md` §7.7 合成数据向导 · `PRD-ontology-browser-field-coverage.md`（借鉴 nano-ontoprompt 的同源）· 关联 `PRD-cockpit-capacity-1to1-parity.md` §A（原型 intake 正门 / schema 对账 HITL） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§3 数据→本体链 / §5 R12 / §10.3 切片 `sys.ingest.data_to_object`） · 现有 `SyntheticPage.tsx` · `apps/datacore/src/modeling.ts` |
| 参考软件 | [`jingw2/nano-ontoprompt`](https://github.com/jingw2/nano-ontoprompt)（半自动·基于数据的本体建模；**精髓 = 数据分阶段集成链 Data→Raw→Transform→Curated→Ontology Mapping + 每阶段人在环策展 + 基数推断**） |

> **缘起（如实记录）**：此前系统**只借鉴了 nano-ontoprompt 的确定性映射算法**（`modeling.ts deriveModelingSuggestion`：dataset→ObjectType / column→PropertyDef / FK→link / PK + 基数推断），**未搬其精髓**——那条"看着数据、一阶段一阶段策展出本体"的**分阶段集成链 UX**。且合成数据向导「2·生成进度」目前是**通用六阶段 stepper，与 ontoprompt 无关**；前一会话（commit `658b94b`）想加的"合成流程图+提示词"实际只落成 `docs/synthetic-data-generation-flow.svg`，**从未嵌进页面**（全前端无引用）。本 PRD 把"生成进度"重设计为 ontoprompt 的**分阶段集成链**，把精髓真正落到 UX。

---

## 0. 本体引用与影响（强制）

- **触及对象类型**（§2）：`SyntheticJob`·`IndustryTemplate`/`GenSpec`·`RawDataset/RawRow`·`ObjectInstance`·`DerivationSpec/Run`·`PropertyDef`·`OntologyDraft`(modeling)·`SliceSpec`(字段覆盖)·`QuarantineRow`·**`SchemaReconcileCandidate`**（§A 同源，字段对账人确认候选）。
- **触及链路**（§3 / §10.3）：本页即切片 **`sys.ingest.data_to_object`**（`Connector→RawDataset→ObjectType→ObjectInstance→Derivation`）的**活可视化**。重设计 = 把这条切片的每一跳做成一个可视、可下钻、可策展的阶段。
- **触及事件/数据流**（§4，D-29）：消费 `raw_dataset.uploaded`·`materialize.completed`·`derivation.completed`·`dataset.regenerated`（合成 tick/作业产出 → 阶段实时推进）；`quarantine.row_added`（Curated 阶段异常）。**不新增事件**（纯前端消费既有阶段产物）。
- **触及不变量**（§5）：
  - **R12 双向闭包**：Curated/Mapping 阶段把"字段全建模覆盖"做成可见徽章（每字段∈≥1 切片，非派生字段 100%）。
  - **R13 可溯源**：每阶段数字/行可下钻到来源（RawRow→RawDataset→Connection + 派生公式）。
  - **R4 真值经 Action**：Mapping 阶段的"策展"（改名/新建/合并字段）若改本体/物化，经 `domainExecutor` 审批。
  - **R6 确定性**：阶段计数/映射建议同 (industry,scale,seed) 一致。
  - **R14 应用层无业务常数**：阶段名/文案/状态全来自配置 + i18n + 切片元数据，前端零内联业务常数；过 `debattery:check`。
- **关闭/影响的已知断点**（§8）：补 **G-6**（rawin 三路可视化）；夯实 **R12/G-8**（覆盖维上 UX）；登记并闭合新断点"**ontoprompt 精髓仅算法落、UX 未落**"。
- **需走的检测门禁**（§7）：`field-coverage`（覆盖徽章数据源）· 闭包门 · `debattery:check` · 前端回归（修订 F13 合成数据向导用例）。
- **回写承诺**：落地后回写本体 §3（`sys.ingest.data_to_object` 切片补"分阶段集成链"投影）· §8（G-6 推进 + 新断点闭合）· §10.3（切片说明加 UX 锚）。

---

## 1. 目标 / 非目标

### 目标
1. 把合成数据向导 **「2·生成进度」**从"通用六阶段 stepper + 行数校验"重设计为 nano-ontoprompt 的**五阶段数据集成链**：**Data → Raw → Transform → Curated → Ontology Mapping**。
2. 每阶段：① 状态/进度 ② 输入→输出计数 ③ **可下钻**（看该阶段真实产物：配方/逐行数据/物化对象/校验/映射建议）④ 适用阶段的**人在环策展**（确认/改名/新建/合并/丢弃）。
3. 真正"参考 ontoprompt 精髓"：**基数推断**（1:1 / 1:N）可见、**字段→属性映射**可见可改、**字段全建模覆盖徽章**（R12）可见、**流程+唯一提示词**（`TEMPLATE_SYSTEM`）嵌进页面（补回 `658b94b` 的遗漏）。
4. 与合成生成（确定性 GenSpec）与上传建模（`deriveModelingSuggestion`）**同一条链统一呈现**——无论数据来自合成还是上传，都走这五阶段。

### 非目标
- 不改后端生成/物化/派生算法（仅复用既有产物做新呈现）；不引入 nano-ontoprompt 的代码/依赖（只借范式）。
- 不在本 PRD 落 `SchemaReconcileCandidate` 后端（属 §A intake 正门 PRD；本页 Mapping 阶段先消费 `deriveModelingSuggestion` 现有输出 + 预留对账位）。
- 不决定基线分支（用户暂只要 PRD；实现前再定 wizardly-gauss / vigilant-knuth，见 §8 备注）。

---

## 2. 现状与缺口（对照代码 file:line）

| 维度 | 现状 | 缺口 |
|---|---|---|
| 阶段呈现 | `SyntheticPage.tsx:131 PhaseStepper`：通用六阶段（job.phases，✓/◌/✕） | 非 ontoprompt 链；阶段不可下钻、无策展、无映射/基数/覆盖 |
| 逐行数据 | `DataDetailPanel`（`:49`，仅生成成功后，平铺所有 RawDataset） | 未挂到"Raw"阶段；不分阶段 |
| 校验 | `Report`（`:151`，行数表/规则扫描/派生抽样/时序） | 未挂到"Curated"阶段 |
| 映射/基数 | 仅在**另一页** `ModelingPage`（`modeling.ts deriveModelingSuggestion`，已含 `cardinality:"1:N"`、FK 容含≥90%、PK 唯一≥0.95） | 未进合成向导；"Ontology Mapping"阶段缺 |
| 覆盖徽章 | 字段全建模覆盖（R12）在本体浏览器 | 未在向导 Curated/Mapping 阶段可见 |
| 流程+提示词 | `docs/synthetic-data-generation-flow.svg`（含 `TEMPLATE_SYSTEM` 全文） | **全前端无引用 → 页面看不到**（`658b94b` 遗漏） |

---

## 3. 设计（五阶段 = 切片 `sys.ingest.data_to_object` 的逐跳投影）

> 每阶段一张 `<StageCard>`：标题 + 状态 + I/O 计数 + 「下钻」抽屉 + （适用时）策展动作。阶段间用链式连接线（复用 docs SVG 的视觉语言）。链路顺序 = 切片 root→hops。

| # | 阶段（ontoprompt） | 映射系统真实产物（复用） | 下钻内容 | 人在环策展 |
|---|---|---|---|---|
| ① | **Data** 数据/配方 | `IndustryTemplate` + `GenSpec propGenerators`（合成）或上传 CSV；唯一提示词 `TEMPLATE_SYSTEM`（未知行业才用 LLM 生成一次模板结构） | 配方表（每类型 count{S/M/L} + 每字段 GenSpec）；**"为什么没配 LLM 也能生成"说明** + 提示词全文（嵌 docs SVG 内容） | 选模板/规模/seed（已有 StepOne） |
| ② | **Raw** 原始落库 | `RawDataset/RawRow`（合成或上传，`origin` 可溯，`service.ts putAll`） | **逐行明细**（复用 `DataDetailPanel`，挂到此阶段）；每集行数 + 来源连接 | — |
| ③ | **Transform** 转换/物化 | 物化 `RawRow→ObjectInstance`（origin=SYNTHETIC）+ **FK 一致**（`fkSample`/report.fkChecks）+ `runDerivations`（派生） | 物化计数（每类型）；FK 一致校验；派生公式 before/after | — |
| ④ | **Curated** 策展/校验 | `Report`（ruleScan/derivationSpotChecks/timeseries）+ **字段全建模覆盖**（R12 `field-coverage`）+ `QuarantineRow`（异常隔离） | 规则扫描/派生抽样/时序校验（复用 Report）；**覆盖徽章**（源/派生/手工占比）；隔离行 | 隔离行 reprocess/discard |
| ⑤ | **Ontology Mapping** 本体映射 | `deriveModelingSuggestion`：dataset→ObjectType / column→PropertyDef(类型推断) / FK→ref+LinkType / **PK** / **基数 1:N** | 映射表（每列→属性+类型+是否PK+ref目标）；**基数推断**；FK 容含率 | **字段策展**（沿用/改名/新建/合并/丢弃）；不符 → 预留 `SchemaReconcileCandidate` 对账位（§A）；改本体经 R4 审批 |

### 3.1 复用 / 绿地 / 门禁
- **复用**：`PhaseStepper` 的 job.phases 状态机 → 映射到五阶段进度；`DataDetailPanel`（→②）；`Report`（→④）；`deriveModelingSuggestion`（→⑤，把 ModelingPage 的能力以只读+策展嵌入）；`field-coverage` 端点（→④/⑤覆盖徽章）；docs SVG 的提示词/说明文案（→①）。
- **绿地（前端为主）**：`<StageChain>` / `<StageCard>` / 阶段→phase 映射表（配置驱动，R14）；①阶段配方+提示词面板；⑤阶段映射+基数+策展面板（消费既有端点）。
- **门禁**：`debattery:check`（阶段/文案零内联业务常数）；`field-coverage`（覆盖徽章真实数据）；前端回归更新 F13。

### 3.2 与 §A intake 正门的关系（同源，别重复造）
ontoprompt 精髓的"**Ontology Mapping + 人确认**"与 `PRD-cockpit-capacity-1to1-parity.md` §A 的 **schema 对账 HITL（`SchemaReconcileCandidate`）是同一件事**。本页⑤阶段是该能力的**前端落点**；后端候选/对账逻辑在 §A PRD。两者共用 `deriveModelingSuggestion` + 覆盖门 + R4 审批。**建议合并推进**：§A 出后端，本 PRD 出前端五阶段链 UX。

---

## 4. 契约 / 端点（多为复用）
- 复用端点：`POST /a/v1/synthetic/jobs`·`GET /a/v1/synthetic/jobs/:id`（phases/report）·`GET /a/v1/raw-datasets[/:id/rows]`·`POST /a/v1/modeling/derive`·`GET /a/v1/field-coverage`·`GET /a/v1/modeling/drafts/:id/coverage`·隔离区端点。
- 前端新增类型（`api/types.ts`）：`StageChainDef`（五阶段配置：key/label/phaseKeys[]/drilldownKind）——**配置驱动、非业务常数**。
- 无新后端端点 / 无新表（R9 免）。

## 5. 关键流程（端到端，沿切片）
合成作业启动 → 轮询 job.phases → `<StageChain>` 按 阶段→phase 映射推进（①Data 配方就绪 → ②Raw 落库行数 → ③Transform 物化+FK+派生 → ④Curated 校验+覆盖 → ⑤Mapping 映射+基数）→ 每阶段可展开下钻真实产物 → ⑤阶段策展（改名/新建/合并）经 R4 审批回写本体 → 完成态"已就绪，去驾驶舱/本体浏览器"。

## 6. 非功能（§5 不变量）
R6 确定性 · R12 覆盖可见 · R13 逐行/数字可溯 · R14 零业务常数 · R4 策展经审批。LLM 仅①阶段未知行业生成模板（mock 测试）。

## 7. 验收（DoD）
- 五阶段链渲染 + 每阶段可下钻真实产物（合成路 & 上传路同链）；①阶段嵌入提示词/流程说明（补 `658b94b` 遗漏）；⑤阶段显示基数推断 + 字段映射 + 覆盖徽章。
- `pnpm -r build && pnpm -r test` 全绿（frontend 回归含 F13 更新）；`debattery:check` / `field-coverage` 过。
- FDE 纪律：亲手跑一遍（mock + 真后端）确认每阶段下钻可达、覆盖徽章真实、策展经审批。
- 回写本体 §3/§8/§10.3。

## 8. 分期
- **S1 · 五阶段链骨架 + Data/Raw/Curated**（复用 PhaseStepper 映射 + DataDetailPanel + Report 挂阶段 + ①提示词嵌入）。
- **S2 · Transform 物化/FK/派生下钻 + Curated 覆盖徽章**。
- **S3 · Ontology Mapping 阶段**（映射表 + 基数 + 字段策展，消费 `deriveModelingSuggestion`；对账位预留 §A）。

> **基线分支备注**：用户本轮只要 PRD、未定基线。实现前须先定 **wizardly-gauss（超集，含 DataDetailPanel）** 还是 **vigilant-knuth（缺 DataDetailPanel，该页差 175 行）** 为准，否则"遗漏"会因分叉反复出现。建议 wizardly-gauss 为基线。

---

## 9. 本体引用与影响（机器索引锚，供 prd:check）
触及不变量：R4 R6 R12 R13 R14 · 触及断点：G-6（rawin 三路可视化）+ G-8 + 新断点「ontoprompt 精髓 UX 未落」· 触及切片：`sys.ingest.data_to_object`（分阶段集成链投影）· 关联对象：SyntheticJob RawDataset ObjectInstance DerivationRun SliceSpec QuarantineRow SchemaReconcileCandidate · 无新事件/无新表。
