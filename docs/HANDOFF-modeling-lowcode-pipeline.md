# HANDOFF · 本体建模「创建过程」低代码 Pipeline（审核方逐元素对齐核发 · 任务#2）

> **这份是什么**：审核方对**竞品建模管道 ↔ 系统 `/admin/modeling`** 做完逐元素真渲染对齐（见 `docs/AUDIT-ui-master-comparison-verified.md` §「竞品两段↔系统两页」A 节）后，把**唯一净新增缺口**整理成 dev 可直接照建的施工单：**让"创建本体模型的过程"显示为低代码 Pipeline**。
>
> ⛔ **接这份先做增量0**：起真系统（datacore 4001 + agentcore 4002 + vite 5173）+ 真浏览器登录 demo/admin/demo1234 打开 `/admin/modeling`，亲眼确认现状（见下「现状锚点」），再动手。**完成=真浏览器实拍能用，非测试绿**（FDE 铁律）。

---

## 1 · 缺口（逐元素对齐的唯一净新增）

竞品建模页把"建模"呈现为一条**活的低代码数据管道**：源表节点 → 处理节点 → 实体节点，边建边连线，AI/认证在侧。系统**数据与能力已全有**（L0-L4 认证 ✓ / 结构知识行为评分 ✓ / AI 建议草案 ✓ 已用 Kimi 真跑 / 字段全建模门 ✓ / `DataPipelineDag` SVG 节点图 ✓），**但**：

- 已有的 `DataPipelineDag`（`ModelingPage.tsx:407`）是**「已发布成品本体的静态架构图」**：① **默认折叠**（`useState(false)` :408）② 仅 `publishedTypes.length>0` 才渲染（:99）→ **不画"草案创建过程"**。
- 主创建区是**列式表单**（数据源 ｜ 源字段 ｜ 映射画布 ｜ 操作面板），用户看不到"我正处在建模流程的哪一步、下一步是什么"。

**一句话**：缺一条贯通的**「创建过程」Pipeline/进度流**——从 选数据源 → 派生/AI建议 → 审字段映射 → 改名归域 → 发布(R12门) → 物化，每阶段是带状态的节点，驱动自**真草案进度**。

## 2 · 现状锚点（真渲染实拍 + 源码）

- 页面：`apps/frontend-shell/src/pages/admin/ModelingPage.tsx`（888 行）。实拍：`scratchpad/cur-modeling.png`。
- 已有 SVG 管道组件：`DataPipelineDag`（:407-477）——4 列 数据集→数据处理→实体→本体库，正交折线箭头，点处理节点出真 `sourceBindings.fieldMappings` modal。**复用它，别重写**。
- 草案数据形状（`GET /a/v1/modeling/drafts/:id`，审核方真测）：`{ id, status, rawDatasetIds[], fkCandidates[], suggestion:{objectTypes[]}, operationLog[], datasets[] }`。
- 顶部已有：草案选择下拉（`draft_xxx · DRAFT`）+「AI 建议草案」按钮 + 「全局仿真准备度」就绪认证 L0-L4 + 字段全建模门 57/57。
- 后端端点（全已存在·审核方真跑过）：`POST /a/v1/modeling/derive {rawDatasetIds}`（确定性·201）· `POST /a/v1/modeling/suggest {rawDatasetIds}`（Kimi·202）· `PATCH /a/v1/modeling/drafts/:id {operations:[…]}` · `publish` · `materialize`。

## 3 · 怎么建（接现成·照建）

### 3.1 顶部「创建过程」Pipeline（核心交付）

在 ModelingPage 顶部（草案选择器下方、就绪认证上方）加一条**横向贯通管道** `<ModelingCreationPipeline draft={activeDraft} />`，6 阶段节点 + 连线箭头：

| 阶段 | 节点判活/判完（**全取真草案态·R14 零写死**） | 点击 |
|---|---|---|
| ① 选数据源 | `draft.rawDatasetIds.length` 个；>0 = ✓ | 跳「数据源」区 |
| ② 派生/AI建议 | `draft.suggestion?.objectTypes?.length>0` = ✓；区分确定性(derive)/AI(suggest，看 operationLog 来源或 status) | 跳建议区/触发按钮 |
| ③ 字段映射审核 | `suggestion.objectTypes` 含 `sourceBindings.fieldMappings`；字段全建模门 % | 展开 `DataPipelineDag` |
| ④ 改名/归域/PATCH | `draft.operationLog.length` 条；有 setDomain/renameType 等 = 进行中 | 跳操作面板 |
| ⑤ 发布(R12门) | `draft.status==='PUBLISHED'` 或字段全建模门 100% 可发布 = 就绪/✓ | 触发发布 |
| ⑥ 物化 | 已发布类型数 / materialized count >0 = ✓ | 跳已发布本体 |

- 每节点三态：`done ✓` / `active ◉`（当前最靠前的未完成阶段）/ `pending ○`，连线随完成进度高亮。
- 与既有 `DataPipelineDag` 的关系：本 Pipeline 是**纵向"流程进度"**（建到第几步），`DataPipelineDag` 是**横向"数据架构"**（字段怎么映射）——两者互补，③阶段点击即展开后者。

### 3.2 让 `DataPipelineDag` 也画"在建草案"（次要）

- 解除「仅 published」限制：当有 active draft 且 `suggestion.objectTypes.length>0` 时，用 **draft 的 objectTypes**（含 `sourceBindings.fieldMappings`）喂同一个 `DataPipelineDag`，让创建中就能看到管道成形。
- active draft 时**默认展开**（`open=true`），published-only 时维持折叠。
- 复用现有 SVG 渲染逻辑，仅改数据源 + 默认展开态。

## 4 · 真值判据（FDE oracle · 审核方将真浏览器逐条复验）

1. demo 打开 `/admin/modeling` → 顶部出**贯通创建管道**（6 阶段节点 + 连线），**非折叠、一眼可见**。
2. 阶段状态**反映真草案进度**：新建空草案→只①亮；选数据源→①✓②◉；派生/AI建议出类型→②✓③◉；PATCH 改名归域→④亮；发布→⑤✓；物化→⑥✓。
3. **切换草案下拉** → 管道各阶段状态**随之变**（证明接真 draft 态非写死·R14）。
4. 点阶段节点 → 跳/展开对应区（③→`DataPipelineDag` 展开看真字段映射）。
5. 草案态 `DataPipelineDag` 真渲染**在建管道**（数据集→处理→实体节点带真 `fieldMappings`）。
6. 全链数据溯后端（`draft.rawDatasetIds/suggestion/operationLog/status`），**响应里能指出每个 count 的来源端点**；无任何业务常量写死。
7. `pnpm -r build`（tsc + vite）**真绿**；新增组件有 `data-testid`（如 `modeling-creation-pipeline`、`mcp-stage-{n}`）便于复验。

## 5 · 红线（违反即返工）

- **R14 零业务常量**：阶段数/完成判定全取真 draft 态，禁止写死"已完成 N 步"。
- **contracts-only-shared**：草案/类型形状用 `@platform/contracts` 既有类型，前端不重定义。
- **真数据非编造**：字段映射取真 `sourceBindings.fieldMappings`（R13），缺则诚实标（橙），不凭空造 transform。
- **复用不并行**：接现有 `DataPipelineDag` + draft 端点，**不新起**平行管道组件/端点。
- **完成=真浏览器实拍能用**，非 vitest 绿；汇报附"距北极星还差什么"。
- 平台术语（禁写竞品产品名）；模型标识不进任何提交物；只推指定开发分支。

## 6 · 本体引用与影响

- **链路**：本任务是 `Connector→RawDataset→derive/suggest→OntologyDraft→PATCH→publish→materialize→ObjectInstance` 建模链的**纯前端可视化层**，不新增/改变链路、事件、对象类型、不变量、门禁。
- **不变量**：触及 R12（字段全建模门·只读展示其 %）、R13（真字段映射溯源·复用）、R14（零业务常量·必须遵守）。
- **本体回写**：**无需**——未新增链路/事件/对象类型/不变量/门禁，仅 UI 呈现既有链。（若构建中发现需新增草案态字段或事件，则回写 `docs/SYSTEM-ONTOLOGY.md` 对应章并在 PR 说明。）
