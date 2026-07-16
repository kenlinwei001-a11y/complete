# PRD — 生成接地层 GenerationBoundary（给 R16 倒序发育装"业务接地脊柱"，闭 G-5）

> 版本 v1.0 · 状态 DRAFT · 落地分支 `claude/vigilant-knuth-b1nmxn`（A18/自成长/ModuleProvisioner 机制已在）· **增量融合（复用机制，非全新重建）**。
> 目标读者：本仓实现 agent。先读：根 `CLAUDE.md`、`docs/SYSTEM-ONTOLOGY.md`（本 PRD 已 grounded 于 v1.0）。
> 一句话：本体 **R16「发育闭环」**（倒序发育 ⊕ 正序运作）+ **A18/自成长**生成机制**已落**，但它是 **"无业务接地的生成"**——能 scaffold 跑通、却可**编造业务事实**（基地名/型号/数值，见 §1 实证 `llm-gen.ts`）。本 PRD = 加 **GenerationBoundary 接地层**（业务词表 硬/软 + 语义目录 + 拉取靶），把生成框成 **"只引用边界内实体、不造业务事实"**；同一份边界作**单一来源**根治 `synthetic/battery.ts` 硬编码（闭 **G-5/R14**）。**不重建 R16/A18 机制。**

---

## 本体引用与影响（铁律0 · `prd:check` 强制）

- **触及不变量**：**R14**（应用层无业务常数，`battery.ts` 现违反、守 G-5）· **R16**（发育闭环——本 PRD 是其"倒序发育生成接地"的缺失件）· **R6**（确定性，boundary seed+version 字节一致）· **R13**（溯源，临时件/合成值标 origin）· **R12**（双向闭包，拉取靶=输出侧反向-data）· **R4**（真值经 Action，boundary DRAFT→PUBLISH 经审批）· **R2**（租户隔离）· **R3**（entitlement 先于 authz）· **R9**（仓储双实现）· **R10**（D-29 事件）。
- **触及断点**：**G-5**（应用层电池锁死——`8b 业务数据写死` = 本 PRD 主修，收窄断点）· **G-8**（闭包跨栈——拉取靶 outputFields 补 SHAPE 维）。
- **触及对象类型（§2）**：**新增** `GenerationBoundary`/`BoundaryItem`/`ImportPort`（D1 接入域）；**扩** `FieldProfile`/`PropertyDef` += `description`（D2）；**复用** `SyntheticJob.valueDomain`+`value-domains.ts`（§56，RANGE 已配置化）· `DataCategory`/`DataCategorySetting`（§54，导入分类/系统对接·文件上传）· `Connection.category`（§53，A11 允许自定义值）· `SolverArtifact`/`llm-gen`（§2.H/§270，接地 hook 入口）· `SOLVER_OUTPUT_SHAPES`/`renderBindings`（§332/G-8）；**改** `ScenarioPackage`（§112 去 `pkg_battery_manufacturing` 写死）。
- **触及链路（§3）**：数据构建发动机链（§179）· 数据→本体→推演链（§167）· `SyntheticJob --gen(seed)--> Connection+RawDataset --materialize--> ObjectInstance`（§171）· `solver.provisional_generated`（§270，llm-gen 接地点）。
- **触及域（§10）**：D1 接入 · D2 本体 · D4 推演（生成接地）· D11 治理元（R16 三环）。
- **触及事件（§4 · D-29/R10）**：新增 `boundary.published` · `data_request.opened`/`data_request.fulfilled`（L 待登记）→ **实现后回写 §4**。
- **触及门禁（§7）**：`debattery:check`（R14 基线，battery 常数迁出后基线不回潮）· `ontogenesis:check`（R16 三环）· `provisional-honesty:check`（A18，接地后生成仍标 PROVISIONAL）· **新增** `boundary-singlesource:check`（battery.ts→boundary 迁移**字节一致 R6** 守门）。
- **回写承诺**：实现后必回写本体 **§2.A**（GenerationBoundary 对象）+ **§8 G-5**（断点收窄）+ **§4**（新事件）+ **§5 R16**（接地环补全）。

---

## 0. 核心论点（grounded）

```
R16 发育闭环：倒序发育（场景/需求 → 倒推长出 数据/对象/规则/求解器/Agent）⊕ 正序运作（问句→答案）
   倒序发育的"生成"机制 = A18(SolverArtifact+沙箱+promote) + 自成长(GapReport/LOOP/ledger) + ModuleProvisioner(EXISTS/TO_CREATE/MISSING)  ✅ 已落
   但生成 prompt 只注入"类型级 schema"（typeKey{props}）——无实例词表、无列目录、无越界拒绝 → 能引用真类型，却可编造 基地名/型号/数值  ❌

本 PRD = 给这套已落机制装【生成接地层 Part A】：
   业务词表(硬:只能引用 / 软:可提议待确认) + 语义目录(列描述) + 拉取靶(视图声明要的字段)
   → 生成"只取边界内实体、不造业务事实"  ⊕  同一份边界=单一来源 根治 battery.ts 硬编码(G-5/R14)
```

**两条价值（正交）**：① **生成不造假**（接地 R16 的生成端）；② **改数据不崩别处**（单一来源根治 G-5）。同一份 `GenerationBoundary` 双消费：合成数据生成 ⊕ LLM 生成接地。

## 1. 现状对照：机制已建 vs 接地未建（实测 file:line）

| 部分 | 机制现状（grounded） | 结论 |
|---|---|---|
| 临时能力 scaffold + 替换 | **A18 已落**（§2.H）：`SolverArtifact`+锁死沙箱+`PROVISIONAL→GOVERNED promote`+`provisional-honesty:check`+求解器审核台 | 机制已建 |
| 倒序成长引擎 | **自成长已落**（§121）：`growth.ts`(GapReport/7码/`classifyGap`)+`growth/probe`+`growth/fill-data`+`growth/run` LOOP(CONVERGED/BOUNDARY/MAX_ROUNDS)+`GrowthLedger`+`GrowthTicket`+`ModuleProvisioner`(§59) | 机制已建 |
| 意图↔绑定↔切片↔槽位 | `sourceBindings`/`SliceSpec`/A6 行级过滤已有；绑定面板 + BP-4 `objectRef` 槽解析是真缺口 | 大部已建 |
| **生成接地（Part A）** | `GenerationBoundary`/`BoundaryItem`/`ImportPort` **0 文件**；`FieldProfile`/`PropertyDef` **无 description**；核心主数据硬编码 `synthetic/battery.ts`（BASES/MODELS/SEG_PRICE/ROOT_LIB/ORDERS/bottleneck.primary） | **真新增·对症 G-5** |

**实证（核心断言，逐行验过）**：`apps/datacore/src/solvers/llm-gen.ts`
```ts
objectTypes: { typeKey: string; props: string[] }[];
const schemaText = spec.objectTypes.map((t) => `${t.typeKey}{${t.props.join(",")}}`).join(" · ");
// prompt: 求解器key/意图/可用对象类型：${schemaText}\n生成 {computeSource,outputShape,argHints,rationale}
```
→ 只注入**类型名+属性名**，**没有实例词表/列描述/值域/越界拒绝** → 生成可引用真类型却**编造实例与数值**（违 R13 诚实的源头、违本 PRD 非目标"✗ 生成真实业务事实"）。沙箱(A18)只隔离副作用、**不防造假**。

**ModuleProvisioner 倒推源**（`databuilder/provisioners.ts`）：从 **BuildPlan 13 个 need 数组**比对现状，**不从** `VIEW_DEFS.outputFields` 反推 → 拉取靶 keystone（§3.3）是真缺口、与它互补。

### 1.1 即便本分支也缺的 5 项（接受用户提醒，非"已建"）
| # | PRD 主张 | 现状 | 性质 |
|---|---|---|---|
| ① | 生成接地：LLM 只能引用业务词表(硬)实体、列只能取目录，越界拒绝 | `llm-gen` 仅类型 schemaText | **核心论点·缺** |
| ② | 语义目录：`FieldProfile`/`PropertyDef`+`description`+`/catalog/search` | 两者均无 description | 缺 |
| ③ | 拉取靶 keystone：`VIEW_DEFS.outputFields`，从"视图要什么字段"反推 | 0 命中；ModuleProvisioner 从 BuildPlan-need 反推 | 缺（倒推地基） |
| ④ | 真人正门精确数据请求：反推 `DataRequest{importName,描述,必填列}`→导入→fulfill→重跑 | `fill-data` 自动合成 CSV 上传 | 缺（语义不同） |
| ⑤ | A/B 归一 + 需求可溯：§EV 10 卡→D1–D7→落点 | 未处理 | 缺 |

## 2. 它治"改数据崩别处"吗（诚实）

- **根因 a 数据重复/漂移**：同一数据要在 `battery.ts` + 前端 `fixtures.ts`/`simSolvers.ts` 多处手改保持一致，漏一处即漂移。→ **GenerationBoundary 单一来源、前后端同源消费 = 根治。** 最大赢面。
- **根因 b 跨视图值耦合**：多视图从同一基数据确定性派生，测试钉派生值（score 79 等），改基数据→断言崩。→ **不能消灭**（确定性派生固有）；给的是 ① 改动集中一处 ② 语义目录+sourceBindings 让**影响图可查**（改前知崩哪些）③ 边界版本化=R6 契约（值变=显式版本号）。
- **第三维 生成造假**：A18/自成长能 scaffold 跑通，但不防引用虚构基地/型号/列。Part A 词表(硬)+目录把生成框住，与"崩"共用同一份边界。

**结论**：治标（漂移）彻底；治本（耦合）变可分析可控；并补上"生成不造业务事实"。

---

## 3. 设计（统一·不按服务侧切分；代码落点见 §5 锚点表）

### 3.1 GenerationBoundary：10 类边界（硬/软）—— 复用现有基建
- 一等配置 `GenerationBoundary`（按租户 R2，`DRAFT→PUBLISHED→RETIRED`，经 R4 审批发布），**取代** `battery.ts` 硬编码主数据。
- **硬约束**（VOCAB/TOPOLOGY/ENUM/UNIT）：LLM/合成**只能引用**，越界标红/拒绝；**软默认**（RANGE/SCALE/POLICY/EXTERNAL/TEMPORAL/META）：可被真实数据覆盖、LLM 可提议待确认。
- **复用**：RANGE 直接接 `SyntheticJob.valueDomain` + `synthetic/value-domains.ts`（§56，已配置化）；导入分类接 `DataCategory`/`DataCategorySetting`（§54）；来源类接 `Connection.category`（§53）。
- 10 类详见 **附录 A**（★=易漏 4 项：认证网络可产矩阵 / 多层 BOM / 产能爬坡+检修窗口 / 数据新鲜度 profile）。

### 3.2 语义目录（②）—— text2SQL schema-linking 的"检索"那半
- `FieldProfile`/`PropertyDef` += `description`（来源：导入口命名+描述，§3.7 ImportPort）。
- `GET /a/v1/catalog/search?q=`：表/列/描述/枚举检索 → 候选表-列。**只做检索定位/schema-linking，不运行时生成 SQL**（护 R6）。

### 3.3 拉取靶 keystone（③·补 G-8 SHAPE 维）
- `VIEW_DEFS`（`synthetic/service.ts`）每条加 `outputFields: string[]`（该视图渲染要的求解器输出字段路径）。
- 与既有 `SOLVER_OUTPUT_SHAPES`/`renderBindings`（§332）对齐：outputFields 即"视图侧声明"，喂 `validateClosure` SHAPE 维 + 喂倒推。
- **与 ModuleProvisioner 接缝（我增量，前置不后置）**：outputFields → 填 BuildPlan 的 view/solver need → ModuleProvisioner 据此判 EXISTS/TO_CREATE。即"从视图要什么字段反推"喂进既有 BuildPlan-need 倒推，不另起并行倒推。

### 3.4 生成接地 hook（①·核心论点）—— 扩 llm-gen，不重建
- 扩 `solvers/llm-gen.ts SolverGenSpec`：除 `objectTypes` 外注入 **已发布业务词表(硬)实例 + 语义目录(③)列**；prompt 升级为"实体只能取词表、列只能取目录"；产物经**确定性校验**——引用词表外实体/目录外列 → 拒绝或标红（软默认可提议待确认）。
- 同样应用于 scaffold 生成路径。**使现有 A18 生成从"能引用真类型"升到"不造业务事实"**——与 R13 诚实正交且更强（A18 标 PROVISIONAL 是"诚实告诉你不可信"；接地是"从源头不让它编造"）。

### 3.5 真人正门精确数据请求（④）—— 复用 growth/fill-data 分流
- 从 need 的 `sourceBindings` 期望列**反推** `DataRequestTicket{importName,description,requiredColumns}`（精确："请导入名为 X、描述 Y、含列 Z 的文件"）。
- **分流**（`boundaryCanSynthesize`）：边界标 **HARD 的数据走真人正门**（开 DataRequest→连接器导入→按 importName 匹配 fulfill→重跑 LOOP）；**SOFT 才走现有 `fill-data` 自动合成**（确定性、可溯源）。
- 复用既有 `growth/run` LOOP：HARD 缺 → 终态 `BOUNDARY` + 精确工单，而非静默合成。

### 3.6 单一来源 + 影响图 + 版本化（R6）
- `synthetic/boundary.ts` 单一来源；`battery.ts` + 前端 `fixtures.ts`/`simSolvers.ts` 改从它读，**值字节不变**（R6，否则破坏性 re-baseline）。
- 影响图：boundary item → 消费者（sourceBindings/solver/`view.outputFields`）反向索引，"改前查崩哪些"。
- 版本化：`GenerationBoundary.version` 进 R6 key（测试按版本钉，值变=显式版本号）。

### 3.7 Part B 绑定补缺 + BP-7 + 前端可见 + 需求可溯（⑤）
- **绑定面板**：意图↔workflow/agent↔切片↔`sourceBindings`↔槽位↔A6 权限（B2）。
- **BP-4 objectRef 槽解析（本分支已建，不做）**：`orchestrator.ts:295/438 proceedWithIntent` 已以 `classification.extractedSlots` 回灌 `fillSlots` —— 这是我在 `inspiring-gates` 的探测发现（那条断），`vigilant-knuth` 已修；余项仅 B3 字段级权限（如需）。
- **BP-7 意图 scaffold（我增量）**：未预设意图 → path-B 跑通后**补成 DRAFT 意图**，下次走确定性路径A（复用自成长 ticket + Scenario 一等对象）。
- **前端文件↔表可见（我增量·需求 5/6）**：连接器/数据构建发动机页列"已导入文件 ↔ 原始表 ↔ 命名/描述"。
- **需求可溯（⑤）**：§EV 10 卡→D1–D7→落点 建 demand-indexed 索引，连 `GrowthLedger`（问句=需求索引）。

---

## 4. 契约（全量 zod）

```ts
// packages/contracts/src/boundary.ts（新）
export const BoundaryCategorySchema = z.enum(["VOCAB","TOPOLOGY","ENUM","RANGE","TEMPORAL","UNIT","SCALE","POLICY","EXTERNAL","META"]);
export const BoundaryItemSchema = z.object({
  category: BoundaryCategorySchema,
  key: z.string(),                          // 如 "Base.name" / "cert_network" / "yield.range"
  mode: z.enum(["HARD","SOFT"]),
  value: z.unknown(),                        // 名单/枚举集/关系表/区间分布(接 valueDomain)/日历/seed
  source: z.enum(["DERIVED","MANUAL"]),
});
export const GenerationBoundarySchema = z.object({
  id: z.string(), tenantId: z.string(),
  status: z.enum(["DRAFT","PUBLISHED","RETIRED"]),
  items: z.array(BoundaryItemSchema),
  seed: z.number().default(42),             // R6
  version: z.number(),
});
export const ImportPortSchema = z.object({
  id: z.string(), tenantId: z.string(),
  kind: z.enum(["FILE","PASTED_TEXT"]),
  name: z.string(), description: z.string(),// → 语义目录
  rawDatasetId: z.string().optional(),
  createdAt: z.string(),
});
export const DataRequestTicketSchema = z.object({
  id: z.string(), tenantId: z.string(), forNeedKey: z.string(),
  importName: z.string(), description: z.string(),
  requiredColumns: z.array(z.object({ name: z.string(), type: z.string(), note: z.string() })),
  status: z.enum(["OPEN","FULFILLED"]),
  fulfilledByRawDatasetId: z.string().optional(), createdAt: z.string(),
});
// 既有扩展：FieldProfileSchema(contracts/datacore.ts:38) += description?: string · PropertyDef(apps/datacore/src/domain.ts,§71) += description?: string
// 既有扩展：solvers/llm-gen.ts SolverGenSpec += { vocab: {type:string, instances:string[]}[]; columns: {table:string,column:string,desc:string}[] }
// 既有扩展：VIEW_DEFS[k] += outputFields: string[]
```

## 5. 端点 + 现有文件插入锚点（exact）

| 方法 路由 | 作用 | 角色 |
|---|---|---|
| `POST /a/v1/databuilder/import` | 黏贴文字/文件 → ImportPort(命名+描述)→RawDataset | catalog_admin |
| `GET /a/v1/catalog/search?q=` | 语义目录检索（schema-linking） | 读 |
| `GET/PUT /a/v1/boundary` · `POST /a/v1/boundary/publish` | 边界 CRUD + DRAFT→PUBLISH(R4) | catalog_admin |
| `POST /a/v1/boundary/derive` | 从 FieldProfile 抽候选边界(A5) | catalog_admin |
| `GET /a/v1/growth/data-requests` · `POST …/:id/fulfill` | 真人正门看板 + 履约重跑 | catalog_admin |

| 现有文件 | 插入/改 |
|---|---|
| `apps/datacore/src/synthetic/battery.ts` → `synthetic/boundary.ts` | 主数据迁出为单一来源（值字节不变，R6） |
| 前端 `fixtures.ts`/`simSolvers.ts` | 改从 boundary 读（消根因 a 漂移） |
| `packages/contracts/src/datacore.ts:38` `FieldProfileSchema` + `apps/datacore/src/domain.ts` `PropertyDef`（§71） | += `description`（语义目录锚） |
| `apps/datacore/src/solvers/llm-gen.ts` | `SolverGenSpec` += vocab/columns；prompt 接地 + 越界拒绝（核心 hook） |
| `apps/datacore/src/synthetic/service.ts` | `VIEW_DEFS` 每条 += `outputFields`（拉取靶，补 G-8 SHAPE） |
| `apps/datacore/src/databuilder/provisioners.ts` | outputFields → 喂 BuildPlan view/solver need（接缝前置） |
| `apps/agentcore/src/growth/loop.ts`（LOOP 分流决策，`runGrowthLoop`）+ `apps/datacore/src/app.ts:1036` fill-data | HARD→新 `DataRequest` 正门（datacore）/ SOFT→现有 fill-data 合成（datacore） |
| `apps/datacore/src/repo.ts`(+memory+pg+`migration026_boundary.sql`) | `generation_boundary`/`import_ports`/`data_requests`（R9 四处；最新迁移 **025**，故 **026**） |
| `apps/datacore/src/app.ts` | 注册 §5 端点 |
| `apps/agentcore/src/router/orchestrator.ts` | **BP-7**：未命中→path-B 跑通→补 DRAFT 意图（**BP-4 已建**：`:295/:438` 已以 `extractedSlots` 回灌 `proceedWithIntent`→`fillSlots`，本分支不做） |

## 6. 开发顺序 DF.0–DF.16（依赖排序 · 复用机制不重建 · 接地为脊柱）

> 守 R6（boundary seed=42 字节复现当前值）+ 每步守绿（datacore/frontend/agentcore 测试不回潮）。

**Phase 0 — 单一来源 keystone（根因 a）**
- DF.0 C/D 现状对账（无代码）：A18/自成长/ModuleProvisioner 机制 vs §1.1 五缺口清单。
- DF.1 `GenerationBoundary/BoundaryItem/ImportPort` 契约 + `synthetic/boundary.ts` 单一来源；battery.ts+前端改从它读，**字节一致**；**`boundary-singlesource:check` 门**。
- DF.2 提升 BASES（VOCAB+TOPOLOGY）· DF.3 SEG_PRICE/MARGIN/FLOOR（RANGE/ENUM，接 valueDomain）· DF.4 ROOT_LIB/审计阈值/ORDER（VOCAB+POLICY）。

**Phase 1 — 接地地基（②③）**
- DF.5 语义目录：`description` + `/catalog/search`。
- DF.6 拉取靶 `VIEW_DEFS.outputFields`（**喂 BuildPlan-need，与 ModuleProvisioner 接缝前置，我增量**）。
- DF.7 影响图：boundary item → 消费者反向索引。

**Phase 2 — 接地核心（①④）**
- DF.8 生成接地 hook：扩 `llm-gen` 注入词表实例+目录列+越界拒绝（**让现有 A18 生成不造业务事实**）。验收：注入虚构基地名→拒绝/标红；同 seed 确定性。
- DF.9 真人正门：`DataRequest` 反推 + HARD/SOFT 分流（复用 fill-data）。验收：HARD 缺→BOUNDARY+精确列工单。

**Phase 3 — 版本化 + 自动抽**
- DF.10 boundary DRAFT→PUBLISH+version（进 R6 key）· DF.11 A5 自动抽（FieldProfile→候选→人工定稿）。

**Phase 4 — Part B 补缺**
- DF.12 绑定面板（意图↔切片↔sourceBindings↔槽位↔A6 权限） · **DF.13 BP-7 意图 scaffold（我增量）** · **DF.13b 前端文件↔表可见（我增量·需求5/6）**。（注：**BP-4 objectRef 槽解析本分支已建**，不列。）

**Phase 5 — 归一 + delta**
- DF.14 需求可溯（§EV→GrowthLedger，⑤）· DF.15 A/B 归一评估（⑤）· DF.16 C/D 真缺 delta。

**关键依赖**：`DF.1→{DF.2,3,4}` · `{DF.2–5}→DF.8(接地核心)` · `DF.5+6→DF.7` · `DF.1→DF.9/DF.10`。**DF.6 拉取靶 + DF.8 接地 hook = PRD 论点两块地基，不可后置。**
**起手 P0** = DF.0 对账 + DF.1 单一来源 + DF.2/3（灭漂移）→ 紧接 DF.5/6/8（生成不造假）。

## 7. 护栏 + 门禁 + 测试

- 护栏（§5 不变量）：R14（battery 迁出后 `debattery:check` 基线不回潮）· R6（同 (tenant,seed,version,args) 字节一致）· R13（临时件/合成标 origin，接地后生成仍守 A18 `provisional-honesty:check`）· R4（boundary 发布经审批）· R2/R3/R9/R10。
- 新门 `boundary-singlesource:check`：battery→boundary 迁移**字节复现当前值**，否则红（防破坏性 re-baseline）。
- 测试（确定性、LLM mock）：`boundary-*`（契约+单一来源字节一致）· `catalog-search`（schema-linking）· `grounding-hook`（注入虚构基地名→拒绝）· `pull-target`（outputFields→BuildPlan-need→ModuleProvisioner diff）· `data-request`（HARD→BOUNDARY+精确列；fulfill→重跑 ANSWERED）· `bp7-intent-scaffold`。

## 8. 验收

- A1 发布一版 `GenerationBoundary`：battery 主数据全出边界，`debattery:check` 基线 0、同 seed 字节一致（DF.1）。
- A2 `/catalog/search` 命中导入口描述（DF.5）。
- A3 **接地核心**：scaffold/生成注入虚构基地名 → 拒绝/标红；引用边界内实体 → 通过；同 seed 确定（DF.8）。
- A4 HARD 数据缺 → 终态 BOUNDARY + 精确列 DataRequest，非静默合成；导入 fulfill → 重跑可答（DF.9）。
- A5 拉取靶：`VIEW_DEFS.outputFields` 喂 ModuleProvisioner，缺求解器输出字段 → TO_CREATE（DF.6）。
- A6 四包 `pnpm -r build && test` 全绿 + `pnpm gates`（含新门）全过。
- A7 **回写本体** §2.A/§8 G-5/§4/§5 R16（否则 `ontology:check`/`prd:check` 红）。

---

## 附录 A · 生成边界 10 类详表（★=易漏项，全纳入）

| # | 类目 | 锂电 S&OP 具体项 | 硬/软 | 复用/落点 |
|---|---|---|---|---|
| 1 | VOCAB 命名词表 | 基地、产品/型号、客户、供应商、物料/料号、产线、工序、设备、仓库、细分、长协 | 硬 | 取代 battery.ts BASES/MODELS |
| 2 | TOPOLOGY 关系拓扑 | ★认证网络(型号×基地×产线 可产矩阵)、★多层 BOM、基地→线→工序→设备、客户→订单、换型矩阵 | 硬 | OntologyLink |
| 3 | ENUM 分类枚举 | 化学(NCM/LFP)、形态(4680/方/软包)、应用(动力/储能)、业态、风险因子、状态机、规则码 | 硬 | enumValues |
| 4 | RANGE 数值范围/分布 | 产能、良率、需求&增长、单价&毛利、成本、库存&周转、交期、投资额、现金垫、碳因子 | 软 | **接 valueDomain §56** |
| 5 | TEMPORAL 时间/日历 | 规划周期、财年/季度、★工厂日历(班次/节假日/检修)、★产能爬坡曲线 | 软 | **接 OC9 FactoryCalendar §104** |
| 6 | UNIT 单位/币种 | 产能(GWh/万只/Ah)、CNY、kg/kWh | 硬 | 单位声明 |
| 7 | SCALE 规模/容量 | 各实体数量 + 每表行数 | 软 | (industry,scale,seed) |
| 8 | POLICY 规则/政策门槛 | 毛利/现金/良率门槛、越线阈值(85)、审批门槛、安全库存、长协履约率 | 软 | 接 Rule C01–C33 §80 |
| 9 | EXTERNAL 外部信号 | 锂价/镍价/汇率/电价/需求指数/政策 基线+波动 | 软 | **接 ExternalSignal §51** |
| 10 | META 元边界 | seed+(industry,scale,seed)、命名/ID 规则、地理(区域+经纬度)、组织/角色/审批链、★数据新鲜度 profile | 混 | R6/地图/审批/C09 降级 |

## 附录 B · 需求源 §EV：10 卡探测断点账本

> 租户 `demo` · LLM Kimi `kimi-k2.5` · 直探针 `POST /b/v1/solvers/:key/run` + 全链 launch + ViewDef 判空。10 卡 = S18/S04/S05/S19/S01/S17 + S09/S10/S14/S11。

| 断点 | 卡 | 现象 | 闭于本 PRD |
|---|---|---|---|
| BP-1 `sop_balance` 缺失 | S18 | 404，核心 S&OP 视图无源（注：sop_balance 是工作流非求解器，§89） | 边界+接地后由 R16 倒序发育补 |
| BP-2 `quarterly_gap` 空组合 | S19 | 200 但 combo[] 空 | 点修 backlog |
| BP-7 分类未命中意图 | S10 | 触发问句→无候选→慢路径B | DF.13b 意图 scaffold |
| BP-4 objectRef 槽位 | S01 | 全链永久澄清（**inspiring-gates 探测发现；vigilant-knuth 已建**，本分支不修） | — |
| BP-5 `inventory_optimize` 释放资金=0 | S10 | idle[6] 但 releasableCash=0 | 点修 backlog |
| BP-3 入参契约不匹配 | S04/S17 | 400 slotPresets≠求解器输入 | DF.12 sourceBindings |
| BP-6 规则串截断 | S14 | qualityGate 阈值缺失 | 点修 backlog |

健康基线：`plan_generate`/`capacity_forecast`/`lta_gap`/`changeover_sequence`。开发需求 D1–D7 见正文 DF 落点（点修项 D2/D5/D6 入 backlog，非底座设计）。

---

> 状态：**v1.0 DRAFT，待评审**。grounded 于本体 v1.0；只定义设计，落地与否听指示。核心 = 给已落的 R16 倒序发育 + A18/自成长 装【生成接地层】，闭 G-5/R14。
