# PRD · 本体浏览器 + 字段全建模门 + 半自动建模引擎（确定性优先）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-15 |
| 取代/扩展 | 合并 TODO #10（参考 `jingw2/nano-ontoprompt`）+ 参考原型 UI 策展（`docs/reference-prototype-decision-platform.html`）；强化本体 §5 **R12** |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.A/B / §3 数据→本体链 / §5 R12 / §10 D1/D2） · 现有 `apps/datacore/src/modeling.ts`（A3）· `apps/datacore/src/databuilder/closure.ts` |

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（§2）：`RawDataset/RawRow`（A 接入域）· `OntologyType/OntologyLink/OntologyDraft/OntologyVersion` · `PropertyDef/DerivedPropertyDef` · `DerivationSpec` · `SliceSpec` · `ModelingSuggestion`（A3）· `ClosureReport`（构建发动机）· `Connection/Connector`（数据源）· `IndustryTemplate`（模板/合成）。
- **触及链路**（§3 "数据→本体→推演链"）：
  - `Connector --produces--> RawDataset --suggest/modeling--> OntologyDraft --publish--> OntologyType/Link/Version`（现 `suggest` 为 LLM-only → 本 PRD 补**确定性映射管线**）。
  - `RawDataset --materialize--> ObjectInstance`：**每个 RawDataset.column 必须映射到某 OntologyType.PropertyDef**（新覆盖约束）。
  - `ObjectType <--reads-- Solver(入参字段)`：覆盖门保证求解器入参字段有出处（与正向闭包呼应）。
- **触及事件/数据流**（§4）：复用 `raw_dataset.uploaded`（L1，触发建模建议）· `ontology.published`（L1）；新增 **`field_coverage.evaluated`**（IN_SESSION，失效下游 `ontology-browser` / `modeling` / `closure-report`）；遵守 D-29。
- **触及不变量**（§5）：
  - **R12 强化**：现"反向-data（字段必被消费）"为 **SOFT**；本 PRD 新增**建模覆盖维（导入 column 必映射到 PropertyDef 或显式 waive）为 HARD**，未覆盖即拦发布/隔离。
  - **R6 确定性**：映射管线确定性优先（dataset→type、column→property、FK/值重叠→link、基数推断均为纯函数）；LLM 仅补语义命名/歧义，且走用途绑定 `modeling`、测试 mock。
  - **R4 真值经 Action**：本体发布/物化仍经 `domainExecutor`（Phase9B）。
  - **R5 no-secrets-echo**：CSV 模板/样例不含任何凭据明文。
  - **R2 tenant_id**：建模、覆盖评估、浏览器查询全程带租户。
- **关闭/影响的已知断点**（§8）：推进 **G-6**（rawin 三路 = nano-ontoprompt 的 structured/semi-structured/unstructured 三 transform 路，对齐）；夯实 **R12/G-8**（闭包补"字段建模覆盖"维）。
- **需走的检测门禁**（§7）：闭包门（扩"建模覆盖"维）· validate（本体 DAG/类型）· 准备度评分 · A6 行级过滤 · `ontology:check`（事件/锚点不漂）· 新增 `coverage:check`（CI 门，见 §7）。
- **回写承诺**：落地后回写本体 §2.A/B（建模引擎产物 + 覆盖报告）· §3（suggest 链补确定性管线、补"column→PropertyDef 覆盖"边）· §4（新增 `field_coverage.evaluated`）· §5（R12 升级措辞）· §7（coverage 门）· §8（G-6 推进）· §10.3（切片 `sys.ingest.data_to_object` 补覆盖约束）。

## 1. 目标 / 非目标

**目标**
1. **半自动建模引擎（确定性优先）**：把 A3 `modeling.ts` 的 `suggest()` 从 LLM-only 升级为"确定性映射管线为主、LLM 兜底语义"——`dataset→ObjectType · column→PropertyDef · FK/值重叠→LinkType · 基数推断 + 字段类型/质量推断`。
2. **字段全建模门（你的硬要求）**：导入数据源的**每个 column 必须被本体建模覆盖**——映射到某 `PropertyDef` 或被显式 `waive`（带理由）。未覆盖即拦发布、入隔离区提示。可视化为节点级"覆盖徽章"。
3. **本体浏览器（参考原型 UI 策展）**：按域分组的本体图谱 → 点节点右侧检视器出【数据源系统 + 字段 schema(名/类型/示例/单位) + 样例行 + 派生公式 + 规则/约束 + 被谁操作（solver/agent 反向引用）】＋**每节点"下载 CSV 导入模板"**。
4. **出处与新鲜度（小增量）**：字段/KPI 悬浮出处（来源系统+公式+输入+规则）；源系统数据新鲜度徽章。

**非目标**
- 不引入 Neo4j/ChromaDB 等外部存储（参考产品技术栈，不照搬）；图谱前端用成熟库（Cytoscape/d3），不手写力导向。
- 不做通用 what-if（G-5，另 PRD）。
- 不在本期重写连接器（仅补 column 级建模覆盖；xlsx 解析归 G-6）。

## 2. 现状与缺口（对照代码）

| # | 现状（file:line） | 缺口 |
|---|---|---|
| C-1 | A3 `suggest()` 直接 `llm.parseStructured(... purpose:"modeling")`（`apps/datacore/src/modeling.ts:64,78-83`） | **LLM-only**：无确定性 column→property / FK→link / 基数推断；不可复现风险、且无 LLM 时不可用 |
| C-2 | 闭包"反向-data（字段被消费）"为 SOFT（本体 §5 R12；`databuilder/closure.ts`） | **无"字段建模覆盖"维**：导入 column 可以完全不被任何 ObjectType 建模而照样过 |
| C-3 | 本体/对象有 `OntologyType` + `PropertyDef`，但**无"按域分组图谱 + 节点检视器"前端**（前端有 modeling 页但非浏览器形态） | 本体是抽象资产、不可点查；用户看不到"每字段建到哪" |
| C-4 | 合成器可确定性产数（A7，同 seed 一致），但**无"按 ObjectType schema 下载 CSV 导入模板"** | 用户拿不到"该类型该填哪些字段"的模板出口 |
| C-5 | `refs.ts` 已有出向引用图谱（rule/skill/workflow/plan/agent/mcp/intent） | 未在浏览器节点检视器以"被谁操作"呈现 |

## 3. 设计（复用优先；标清 复用 / 绿地 / 门禁）

### 3.1 确定性映射管线（修 C-1）【绿地 + 改造 A3 suggest】
在 `modeling.ts` 新增 `deterministicSuggest(rawDatasets)`，产出 `ModelingSuggestion`：
- **dataset → ObjectType**：每张 RawDataset 候选一个 ObjectType（typeKey 由表名规范化）。
- **column → PropertyDef**：列名→属性名；**类型推断**（采样列值：int/num/pct/date/enum/code/str）；单位/枚举从值域归纳。
- **FK / 值重叠 → LinkType**：跨数据集列值重叠率 ≥ 阈值 → 候选 link，**基数推断**（1:1 / 1:N / N:M 由唯一性比率定）。
- **质量评分**：每列空值率/唯一率/格式一致率 → 质量分（供准备度 §7）。
- `suggest()` 改为：先确定性管线 → 再（可选）LLM 仅对"歧义命名/语义聚类"补建议（`purpose:"modeling"`，mock 可关）。确定性结果**不依赖 LLM 即可用**。

### 3.2 字段全建模门（修 C-2，强化 R12）【门禁新增】
- 新增覆盖评估 `evaluateFieldCoverage(rawDatasetIds, ontologyVersion)`：对每个导入 column 判定 `MAPPED`（落到某 PropertyDef）/ `WAIVED`（显式豁免+理由）/ `UNMAPPED`。
- **HARD 门**：存在 `UNMAPPED` → 本体发布/物化被拦（`ClosureReport` 增 `fieldCoverage` 段，HARD 失败）；提示落"待建模/隔离"。
- 产出 `field_coverage.evaluated` 事件 → 浏览器/建模/闭包报告失效。
- 与现有三向闭包并列：object(反向-对象 HARD) · data(反向-data SOFT) · **fieldModel(建模覆盖 HARD，新增)** · forward(求解器入参 HARD)。

### 3.3 本体浏览器（修 C-3/C-5）【绿地前端 + 复用契约】
- 新页 `本体浏览器`（D2）：左域图例 + 中域分组图谱（Cytoscape/d3，节点=`OntologyType`，按 `domain` 着色/聚类）+ 右节点检视器。
- 检视器（移植参考原型 `renderInspector` `:1851-2123` 的信息架构）：
  - **数据源系统**：节点的来源 Connection/源系统。
  - **字段 schema**：该 ObjectType 的 `PropertyDef[]`（名/类型/示例/单位/描述）。
  - **样例行**：5 行确定性合成样例（走 A7，同 seed 一致）。
  - **派生公式**：`DerivedPropertyDef` 表达式。
  - **规则/约束**：scope 该类型的 `Rule`（C01…）。
  - **被谁操作**：`refs.ts` 反查指向该类型的 Solver/Agent/Workflow。
  - **覆盖徽章**：该类型字段覆盖率（MAPPED/总），未满标红。
- **下载 CSV 导入模板**（修 C-4，移植 `downloadTemplate` `:2246-2253`）：表头=`PropertyDef`(名+单位) + 3 行确定性合成样例 + UTF-8 BOM；后端 `GET /a/v1/ontology/types/:typeKey/template.csv`（模板从 schema 生成、样例走合成器，R6 一致）。

### 3.4 出处 + 新鲜度（小增量）【复用】
- 字段/KPI 悬浮出处：复用 `resolvedRefs`/lineage（来源系统+公式+输入+规则引用）。
- 源系统新鲜度徽章：绑 `connection.sync_completed`（§4 DL9）+ 数据流 SLO，●正常 / ⚠延迟Nh。

## 4. 契约 / 端点 / 数据模型（双仓储四处同改；contracts-only-shared）

**契约（`packages/contracts`）**
- `ModelingSuggestion` 扩：column 级 `{ column, inferredType, unit?, enumValues?, qualityScore, mappedProperty? }`；link 候选 `{ from, to, cardinality, overlapRatio }`。
- 新 `FieldCoverageReport`：`{ rawDatasetId, columns: [{ column, status: MAPPED|WAIVED|UNMAPPED, mappedTo?, waiveReason? }], coverageRatio }`。
- `ClosureReport` 增 `fieldCoverage` 段（HARD）。

**端点（DataCore）**
- `POST /a/v1/modeling/suggest`（复用，内部改确定性优先）。
- `POST /a/v1/modeling/coverage`（新，评估字段覆盖）· `POST .../coverage/waive`（豁免某列+理由，经 Action）。
- `GET /a/v1/ontology/types/:typeKey/template.csv`（新，CSV 模板下载）。
- `GET /a/v1/ontology/browser`（新，按域分组的 types+links+schema+引用，供浏览器渲染）。

**数据模型（R9 四处同改）**：`migrations/*.sql` + `pg.ts` + `memory.ts` + `repo` 接口新增 `fieldCoverageReports`；列级映射存于 modeling draft/version。

## 5. 关键流程（端到端，沿链路）
```
连接器上传 → raw_dataset.uploaded(L1)
  → deterministicSuggest: dataset→Type, column→Property(类型/单位/枚举/质量), FK/值重叠→Link(基数)
  → (可选) LLM 补语义命名/聚类(mock 可关)
  → 人 PATCH 草稿（增删改类型/属性/链路）
  → evaluateFieldCoverage: 每 column ∈ {MAPPED|WAIVED|UNMAPPED}
       └─ 有 UNMAPPED → ClosureReport.fieldCoverage HARD 失败 → 拦发布 + 提示待建模
  → publish(经 Action/domainExecutor) → ontology.published(L1)
  → 本体浏览器：域分组图谱 → 点节点 → 数据源+schema+样例+公式+规则+被谁操作+覆盖徽章
       └─ ⬇ 下载 CSV 导入模板（schema→表头 + 合成样例，R6 一致）
```

## 6. 非功能与约定（§5 不变量逐条）
- **R6**：映射管线纯函数、合成样例同 seed 一致；LLM 仅兜底、测试 mock。
- **R12**：fieldModel 维 HARD，未覆盖即拦——可视化覆盖率徽章。
- **R4**：发布/物化/豁免经 Action 审批。
- **R2/R3**：建模、覆盖、浏览器、模板下载全程 tenantId + entitlement + A6。
- **R5**：CSV 模板/样例无凭据明文。
- **R10/D-29**：`field_coverage.evaluated` 发事件，浏览器/建模/闭包报告订阅。
- **R1**：前端引契约类型，不重定义。

## 7. 验收（DoD）
- `pnpm -r build && test` 全绿；新测试净增（确定性管线 / 覆盖门 / 模板 CSV / 浏览器渲染）。
- **`coverage:check`**（新 CI 门）：构造一份含未映射列的样例 → 闭包 fieldCoverage HARD 必红；全映射 → 绿。故障注入可验。
- 确定性：同一组 RawDataset 重跑 `deterministicSuggest` 字节级一致（不依赖 LLM）。
- 本体浏览器：点节点出 schema+数据源+样例+公式+规则+被谁操作；CSV 模板下载列与 schema 一致、样例确定性一致。
- `ontology:check` 绿（`field_coverage.evaluated` 登记进 §4 与 `event-subscriptions.ts` 一致）。
- 本体 §2/§3/§4/§5(R12)/§7/§8/§10.3 已回写。

## 8. 分期
- **P1**：确定性映射管线 `deterministicSuggest`（column→property/类型/质量；不依赖 LLM）+ 单测。
- **P2**：字段全建模门（覆盖评估 + ClosureReport.fieldCoverage HARD + `coverage:check` 门 + 事件）。
- **P3**：CSV 模板端点 + FK/值重叠 link 推断 + 基数。
- **P4**：本体浏览器前端（域分组图谱 + 节点检视器 + 覆盖徽章 + CSV 下载按钮）。
- **P5**：出处悬浮 + 新鲜度徽章（小增量）；与 G-6 rawin 三路对齐收口。
