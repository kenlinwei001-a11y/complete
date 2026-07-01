# WO 集 · 数据流可见性断层总攻（IPO 逐页：后端有 X → 前端对应页显同 X + 上下游可导航）

> **由来 + 审核方反思**：用户用 **IPO 方法**（看每个展示数据的 Input 上游页 / Process 处理过程页 / Output 下游页，逐页问"上下游在不在、过程全不全"）抓出我漏的断层——「上传后看不到导入数据」。我此前用「模块/规格」镜头（验单功能像素级），继承了每张 WO 的范围盲区，把"组件各自正确"当"整体能用"（合成谬误）。本体明写"**断点常在接缝而非模块内部**"，我验了模块没验接缝。**采纳 IPO 方法逐页审计。**
> **3 路审计合并 = 17 断层（5 P0 · 7 P1 · 5 P2）**，均"后端 curl 得 X、前端整块无处可看/藏别处/导航走"。拆 5 WO 入 dev loop。

## §0 全景（3 路合并·排序·file:line·后端 oracle 已 curl 实证）

### 数据接入→建模→物化 簇（路1）
- **[P0] 上传导航走·行不就地显** `DataCategoriesPanel.tsx:58`/`ConnectionsPage.tsx:69`：上传 onSuccess 无条件 `navigate('/schema')`，行其实在同页下方 `ConnectionDatasetsPanel` 但用户被弹走。后端有 `raw-datasets?connId`+`/rows`（实测真行）。
- **[P0] objectify→reconcile→SchemaReconcile 链断** `app.ts:3528/3535`：objectify 只物化列名精确命中的；fresh 租户全 skip→`materialized:[]`；skip 的列**不入 `reconcile-candidates` 队列**；该队列**前端零 API 零页面**（`SchemaReconcile` 页在 `pages/admin/` 无文件·`fetchReconcileCandidates` 不存在）→ 空态死路，无"去确认 N 列→"出口。**= §10.3 `OntologyDraft→ObjectInstance` 接缝真断（G-8 邻域）**。
- **[P1] 行藏三级展开后** `ConnectionsPage.tsx:330-378`（预览 open 初始 false）· **字段核对只编第一张表** `FieldProfilePage.tsx:88`（硬取 `[0]`）· **fresh 租户 0 类型空态无「你有 N 张未建模→去建模」回接** `ObjectTypesBrowserPage.tsx:131`/`SlicesPage.tsx:166`。
- **[P2] 图谱只显类型不显实例数** `OntologyGraphView`/`SourceSystemOverviewPage.tsx:69`· **同步 rowCounts 瞬时非实况** `ConnectionsPage.tsx:172`· **分类面板只显 schema 不显已导入 N 行** `DataCategoriesPanel.tsx:129`。

### 生成物落地 簇（路2）
- **[P0] 知识库 S4 前端零页零绑定零导航**：后端 `kb.ts`+3 活路由（`app.ts:3905/3912/3930`·`/kb/search`/`/kb/:connId/docs`/`sync`）+ `knowledge_base` 连接器齐备，前端 `endpoints.ts`/`adminRegistry.ts` **零 kb 引用**·`ConnectionsPage` 无 knowledge_base 分支。建了知识库灌了文档**完全看不到**。
- **[P1] launcherEnabled 死数据**（`endpoints.ts:738` 取了零组件读·功能关时前端不区分"无卡"vs"未开通"）· **兜底统计页无空态** `OpsFallbackPage.tsx`· **通知未读无全局徽章**（`unread` 仅页内·`ShellLayout` 顶栏无铃）。
- **[P2] 推演历史导航落「其它」组** `ShellLayout.tsx:66`（NAV_GROUPS 缺 query-history）。

### 决策/推演/写回 簇（路3）
- **[P0] 合规审计日志 audit_log 前端零入口零页面**：后端 `GET /a/v1/audit-log`（`adminplatform.ts:585`·curl 返真条目 actorId/action/before/after）·前端 `audit-log` **零命中**（无页无路由无 endpoint）。产品内看不到"谁何时改了什么"。
- **[P0] 校准收敛史 convergence「越用越准」看板前端缺失**：后端 `GET /a/v1/calibration/convergence`（`app.ts:3844`·curl 返逐轮 mapeBefore/After/converging）+ `sweep`·前端 CalibrationPage 只调 report/proposals/history（"history"是逐提案·**非**逐轮收敛记录）·收敛看板与 sweep 按钮都没有。
- **[P1] 写回落地对账 echoes/reconcile 只显主信号不显对账**：ActionsPage 显 targetRef/写回目标徽标（主信号✓），但 `GET /a/v1/writeback-echoes`+reconcile 判定（同值抑制/异值背离）前端零消费。
- **[P2] 沙盘 R13 溯源半真**（G-11·机制在需 demo 世界更丰富·非阻断）。

## §1 WO 拆分（5 单入 loop·IPO 验收锚）

### WO-INTAKE-VISIBILITY（P0·上传→建模→物化 一条龙可见+引导·对应用户两问）
- 修：①上传 onSuccess **就地**（invalidate raw-datasets + 自动展开/滚动到该连接数据集面板+默认打开新数据集预览·toast 给软链非强制跳）②objectify 把 skipped 列**写入 reconcile-candidates**③新建 **SchemaReconcile 页**（列候选+USE/RENAME/NEW/MERGE/DISCARD→resolve→重跑物化·挂「建模与图谱」组）④0 类型/未建模空态深链「N 张已导入未建模→去建模(?datasets=)」⑤字段核对多表选择器⑥首张数据集默认展开。
- IPO 验收：真浏览器上传含新字段文件→**当页就看到导入的行**（不跳走）→空态给"N 列待确认→"深链→点进 SchemaReconcile 确认→物化→对象浏览器见实例。后端 raw-datasets/rows 真值=前端所见同值。

### WO-KB-UI（P0·知识库 S4 前端落地）
- 修：新增 `/admin/knowledge` 页（知识库列表+文档表+搜索）·`endpoints.ts` 补 kb 绑定·`adminRegistry` 注册（S4 组）·后端补 `GET /a/v1/kb/:connId/docs` 列表路由（现仅 ingest/sync/search）。
- IPO 验收：建 knowledge_base 连接+灌文档→curl `/kb/:connId/docs` 返 N 文档→前端知识库页显同 N 文档+可搜索。

### WO-AUDIT-LOG-UI（P0·合规审计日志前端落地）
- 修：新增 `AuditLogPage`（at/actorId/action/targetKind/before-after diff+筛选）·`endpoints.ts` 补 `fetchAuditLog`·`adminRegistry` 注册（admin/auditor·平台治理组）·`App.tsx` 加路由。
- IPO 验收：做一次管理变更→curl `/audit-log` 返该条→前端审计页显同条（actor/action/before/after）。

### WO-CALIB-CONVERGENCE-UI（P0·「越用越准」证据看板前端落地）
- 修：CalibrationPage 加「收敛史」面板（逐轮 mapeAfter 折线+converging/improvedPct 徽章·消费新 endpoint `/calibration/convergence`）+「跑收敛清扫(sweep)」按钮→`POST /calibration/sweep`。
- IPO 验收：跑 sweep→curl `/calibration/convergence` 返逐轮 mapeAfter→前端收敛面板画同曲线（越用越准可见）。

### WO-VIS-SIGNALS（P1·状态/空态/导航透出批）
- 修：①launcherEnabled===false 专用"未开通"空态②OpsFallbackPage 空态③顶栏通知铃+未读角标（`fetchNotifications().unread`）④`ShellLayout:66` 编排组加 query-history⑤ActionsPage 加「写回对账」面板（echoes/reconcile verdict）⑥图谱 Inspector 加「已物化 N 实例→」徽章⑦分类面板每类型加「已导入/已物化 N」徽章。
- IPO 验收：逐条真浏览器验（未开通显专用空态·通知铃显未读数·写回对账显 echo·图谱/分类显实例数）。

## §2 IPO 逐页审计（持续机制·喂 loop）
审核方接管 74 页的 IPO 遍历（每页：展示数据的 I 上游页/P 处理过程/O 下游页是否可见可导航），发现即立 WO 入队。本 WO 集是首批（3 路自动扫）；后续逐页人工 IPO 补漏。

## 本体引用与影响
- **链路**：§10.3 数据构建链 `RawDataset→OntologyDraft→ObjectInstance→切片/图谱`（补断裂的可见接续）·Action→WritebackEcho·CALIBRATION_SWEEP→convergence·audit_log→SIEM。
- **断点**：G-8（闭包不跨域·此处"产物真存前端不接续显"）·G-14(writeback 对账)·G-SIEM-1(audit 前端)·G-11(sim UI)·**新增 G-VIS-1「后端产物真存·前端无处可见/导航走/藏别处」**（本体自身洞图缺此类·同 G-DM-1 的可见性版）。
- **不变量**：R11/R12 全链闭包（对象必落切片/字段必被消费——UI 须把"已落/未落·数据走到哪"显性化）·R13（结论可溯源·审计/收敛/写回可见）。
- **回写**：本 WO 集落地后回写 §8 新增 G-VIS-1 + §10.3 可见接续。

---
*审核方数据流可见性总攻（IPO 方法·3 路审计合并 17 断层·5 WO 入 loop·后端 oracle 已实证·含审核方方法论反思）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
