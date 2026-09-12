# PRD · 原型 intake 正门 + schema 对账 HITL（上传原型 → 抽数据/关系 → 数据构建发动机 → 字段不符弹人确认）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 |
| 取代/扩展 | 落地 `PRD-cockpit-capacity-1to1-parity.md` §A（原 §-1 通用前置能力）· 扩 `PRD-fullstack-story-build-g8.md`（数据构建发动机）· 关联 `PRD-synthetic-wizard-ontoprompt-chain.md`（Ontology Mapping 阶段同源）· `PRD-A15-*`（CLI `import/model`）· `PRD-A3-*`（域/切片） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.A/B · §3 构建链 · §5 R4/R6/R12 · §2.B 实体解析 MergeCandidate 范式） · `apps/datacore/src/databuilder/{comprehend.ts,service.ts}`（InputManifest/runStory）· `apps/datacore/src/entity-resolution.ts`（MergeCandidate HITL 范式）· `apps/datacore/src/modeling.ts`（deriveModelingSuggestion） |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：让"**上传一个 HTML/原型 → 复刻功能与数据**"成为可重复正门，而非每次派 agent 手抠。补两块绿地：① `prototype-intake`（解析原型内嵌数据表 + 关系 → `InputManifest`）② `schema-reconcile`（原型列 ↔ 既有本体字段对账 → 自动映射 + **`SchemaReconcileCandidate` 人确认**，类比实体解析 `MergeCandidate`）；其余复用既有数据构建发动机（comprehend→BuildPlan→closure→publish R4 + GapReport）。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.A/B）：`InputManifest`（伴生契约，已存）·`BuildPlan/StoryBuildRun/ClosureReport/GapReport`·`OntologyType/PropertyDef/OntologyLink`·`RawDataset`·**新增** `PrototypeArtifact`（上传的原型 + 解析结果）·`SchemaReconcileCandidate`（字段对账人确认候选，类比 `MergeCandidate`）。
- **触及链路**（§3 构建链）：`Prototype(HTML) → prototype-intake → InputManifest{dataSources(数据), links(关系)} → comprehend → BuildPlan → schema-reconcile(对账既有本体) → {自动映射 | SchemaReconcileCandidate(HITL)} → closure(R12) → publish(R4) → ObjectInstance`。
- **触及事件/数据流**（§4，D-29）：复用 `raw_dataset.uploaded`/`storybuild.run_recorded`；**新增** `prototype.intake_recorded`（解析完成）·`schema_reconcile.candidate_created`（对账候选待人确认，NOTIFY，失效对账队列/通知）。
- **触及不变量**（§5）：
  - **R6 确定性**：原型解析（正则/AST 抽 `const xxx=[...]` + 关系）是**确定性**纯函数（同原型同结果）；对账匹配（列名/类型/单位归一 + 容含率）确定，**真歧义不调 LLM → 生成候选给人**（同 A13 纪律）。
  - **R4 真值经 Action**：对账确认 + 建域 publish 经 `domainExecutor` 审批落真值。
  - **R12 双向闭包**：intake 产的对象/字段过闭包门（字段全建模覆盖）；映射不上 → GapReport/候选，不静默丢。
  - **R2** 租户隔离；**R5** 原型若含密钥不回显。
- **关闭/影响断点**（§8）：闭合 **G-6**（rawin 正门：原型也是一路 intake 源）+ **G-8**（构建闭包覆盖原型 intake）；登记并闭合新断点"**原型 intake 无自动正门 / 字段对账无 HITL**"。
- **门禁**（§7）：闭包门（intake 对象覆盖）· `field-coverage`（映射后 100%）· `ontology:check` · 跨服务冒烟 · **CLI 对等 R15**：`prototype-intake`/`schema-reconcile` 必有 CLI 命令（`import --prototype`/`reconcile`）。
- **回写承诺**：回写本体 §2.A/B（PrototypeArtifact + SchemaReconcileCandidate）· §3（`Prototype→InputManifest→BuildPlan` 链 + 对账分支）· §4（intake/candidate 事件）· §8（G-6/G-8 推进 + 新断点闭合）。

## 1. 目标 / 非目标
### 目标
1. **原型 intake 正门**：上传 HTML 原型 → `prototype-intake` 解析内嵌**数据表**（`const ORDERS=[...]`、`BASE_DATA` 等）+ **关系**（`L(source,target,rel)` 边、`MODEL_DEF.bases` 映射）→ 写 `InputManifest.dataSources`（数据）+ 链路边（关系）→ 喂 comprehend。**数据与关系一次抽离、确定性生成一次。**
2. **schema 对账 HITL**：把原型列对账既有本体字段——能映射（列名/类型/单位归一 + 值集容含）→ 自动接；映射不上（新字段/类型/单位冲突）→ `SchemaReconcileCandidate` → 弹人确认（**沿用 / 改名 / 新建 / 合并 / 丢弃**），类比 `MergeCandidate` 人审范式。
3. **复用发动机**：comprehend / BuildPlan / closure(R12) / publish(R4) / GapReport / StoryBuildRun 全复用；intake 只在前端"喂料口"，对账在"映射口"。
4. **多源可扩**：intake 适配器接口化，未来 Figma/Excel/截图同一正门（本期落 HTML）。

### 非目标
- 不重写数据构建发动机；只补"喂料 + 对账"两口。
- 不做原型**视觉/交互**复刻（那是各模块 PRD 的事）；本 PRD 只抽**数据与关系**。
- 不引 LLM 做对账消歧（确定性 + 候选 HITL）；LLM 仅 comprehend 既有用法。

## 2. 现状与缺口（file:line / 证据）
| 维度 | 现状 | 缺口 |
|---|---|---|
| intake 源 | comprehend 吃**自然语言故事**；`InputManifest` 伴生契约已存（P2 倒推补录表单） | 无"HTML→InputManifest"自动解析正门（本次靠 agent 手抠，如 `REFERENCE-HTML-INVENTORY.md` 人工盘点） |
| 关系抽离 | 故事倒推链路 | 无从原型 `L()/MODEL_DEF` 抽关系边 |
| 对账 | 闭包门"缺了即 HARD 失败"；`deriveModelingSuggestion`（dataset→type/column→prop/FK/PK）已有 | 无"原型列↔既有字段自动映射 + 映射不上生成候选给人确认" |
| HITL 范式 | `entity-resolution.ts` MergeCandidate（归一匹配→人审合并）现成 | 未用于 schema 对账 |

## 3. 设计（两块绿地 + 复用发动机）
### 3.1 `prototype-intake`（HTML → InputManifest）
- `databuilder/prototype-intake.ts`（新）：
  - **数据抽取**：解析 HTML `<script>` 内 `const <NAME>=[...]`/`={...}` 字面量（JS AST 或受限正则 + JSON5 容错）→ 每个数组→候选数据集（NAME=表名，对象 key=列）。
  - **关系抽取**：识别关系构造（`L(src,tgt,rel,kind)` 调用、`{...bases:[...]}` 映射、ref 命名约定）→ 候选 `OntologyLink` 边。
  - 产 `InputManifest{dataSources:[{name,columns,rows样例}], links:[{from,to,rel}]}` + `PrototypeArtifact`（原文 + 解析血缘）。
  - **确定性**（R6）：同 HTML 同结果；解析不了的块入 `unparsed[]`（诚实，不静默丢）。
  - 接口化 `IntakeAdapter`（html 本期；figma/xlsx 预留）。
### 3.2 `schema-reconcile`（列 ↔ 既有字段对账 + HITL）
- `databuilder/schema-reconcile.ts`（新，复用 modeling 信号 + MergeCandidate 范式）：
  - **自动映射**：原型列 → 既有 `ObjectType.PropertyDef`——按 列名归一 + 数据类型画像 + 单位 + **值集容含率**（复用 `deriveModelingSuggestion` 的 FK/类型推断 + A13 命名表）。高置信 → 自动接到既有字段。
  - **候选生成**：映射不上 / 冲突（单位异、类型异、多候选同分）→ `SchemaReconcileCandidate{prototypeColumn, candidates:[{targetField,score}], action?:USE|RENAME|NEW|MERGE|DISCARD, status:PENDING}`，发 `schema_reconcile.candidate_created`。
  - **人确认**：DataBuilderPage / 合成向导 Ontology Mapping 阶段（`PRD-synthetic-wizard-ontoprompt-chain.md` ⑤）/ CLI `reconcile` 弹候选 → 人选 action → 经 R4 落本体变更。
  - **确定性**（R6）：匹配纯函数；真歧义给确定性排序候选，不 LLM。
### 3.3 串进发动机
- `InputManifest`（含 reconcile 结果）→ comprehend → BuildPlan → closure(R12，未对账列入 GapReport `NO_SLICE`/`SHAPE_MISMATCH`) → publish(R4) → StoryBuildRun（记 PrototypeArtifact + reconcile 决议）。
### 3.4 入口
- CLI（A15）：`import --prototype <file.html>`（intake）→ `reconcile`（对账人确认）→ `build`（建域）。
- GUI：DataBuilderPage 加"上传原型"入口 + 对账候选面板（复用 MergeCandidate UI 范式）。

## 4. 契约 / 端点 / 数据模型
- `contracts/prototype-intake.ts`（新）：`PrototypeArtifactSchema`、`IntakeResult`（dataSources+links+unparsed）、`SchemaReconcileCandidateSchema`、`ReconcileAction`。
- 端点（DataCore）：`POST /a/v1/databuilder/intake`（上传原型→IntakeResult）· `GET/POST /a/v1/databuilder/reconcile-candidates[/:id/resolve]`（对账队列 + 人确认）。
- 仓储：`PrototypeArtifact` + `SchemaReconcileCandidate` 双实现（R9 四处；可挂 story_build_runs 或新表）。
- 事件 `prototype.intake_recorded`/`schema_reconcile.candidate_created` 入 `event-subscriptions.ts`。

## 5. 关键流程（端到端）
上传 `reference-prototype.html` → `prototype-intake` 抽出 `ORDERS/BASE_DATA/…` 24+ 数据表 + `MODEL_DEF.bases` 等关系 → InputManifest → comprehend → BuildPlan → `schema-reconcile`：`ORDERS.qty` 自动映射到既有 `Order.qty`；原型新列 `ORDERS.pri` 无对应 → `SchemaReconcileCandidate` 弹人确认 → 选"新建 Order.priority" → R4 审批 → closure 通过 → publish → 对象落库（与手抠等价但可重复、可审计、人确认兜底）。

## 6. 非功能（§5）
R6（解析/对账确定，单测对固定 HTML 字节锁）· R4（对账/建域经审批）· R12（覆盖闭包）· R2/R5 · R15（CLI 命令齐备）。

## 7. 验收（DoD）
- 上传参考原型 → 自动抽出数据表 + 关系 → InputManifest；未解析块诚实列出。
- 对账：能映射自动接、不能映射生成候选 → 人确认 4 类 action → R4 落地。
- 经发动机建域 → closure 通过 → publish；与手工盘点结果一致（对参考原型回归）。
- CLI `import --prototype`/`reconcile` 与 GUI 同效（R15）。
- `pnpm -r build && pnpm -r test` 全绿（intake/reconcile 双仓储 + 解析字节锁 + 对账候选 + 跨服务冒烟）；`field-coverage`/闭包门/`ontology:check`/`cli-parity:check` 过。
- 回写本体 §2.A/B/§3/§4/§8。

## 8. 分期
- **P1** `prototype-intake`（HTML 数据+关系抽取 → InputManifest）+ `PrototypeArtifact` + 端点 + CLI `import --prototype`。
- **P2** `schema-reconcile`（自动映射 + `SchemaReconcileCandidate` + HITL 确认 + R4）+ 对账面板/CLI `reconcile`。
- **P3** 串进发动机闭环（comprehend→closure→publish）+ 参考原型回归 + Ontology Mapping 阶段对接（合成向导 PRD ⑤）。

> 与其它 PRD 协同：本 PRD 的 `schema-reconcile` = 合成向导 ontoprompt 链 ⑤ Ontology Mapping 的后端 + A15 CLI `model/reconcile` 的后端，三处共用一套候选/对账逻辑（单一来源）。基线分支：新文件 + 新仓储(migration)，对准基线。
