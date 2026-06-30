# WO-SOURCE-TRANSPARENCY · 消灭"走捷径"——生成源数据必须「数据连接器页可见 Excel + 后端 DB 落地 + 无凭空门」

> 用户要求（原话）：解决系统"走捷径"的 bug——**所有数据，生成的源数据，都必须在"数据连接器"页面前端看得到 Excel、在后端数据库里**。
> 审核方自包含施工单（铁律0.5·先设计再派 dev）。**诚实定性**：后端"数据落 RawDataset+血缘"地基已大半在，"走捷径"真正指的是 **① 实际数据无 Excel 导出 ② 连接器页只露首个数据集、无下载 ③ ts 时序凭空无 RawDataset ④ 无结构门挡"凭空对象"**。本单补这四口 + 立"无凭空"不变量，使**每一行业务数据都能从"数据连接器"页下载成 Excel、可溯回 DB、且结构上不可能再走捷径**。

## §0 一句话目标 + DoD-as-experience（用户视角验收，非测试绿）

**目标**：任何在系统里的业务对象，其源数据必须 ① 在后端 DB 是一张 RawDataset 的真实行 ② 在前端"数据连接器"页可**逐数据集预览 + 一键下载 .xlsx** ③ 结构门保证**没有任何对象没有可见源**（无凭空）。合成生成≠走捷径——合成数据**照样**落 RawDataset、照样能下载 Excel、照样诚实标 SYNTHETIC。

**完成定义（亲手走一遍能用）**：
1. 用户登录 → 开"数据连接器"页 → 看到「合成数据源（确定性生成）· SYNTHETIC」连接。
2. 点它 → 看到**全部** N 张数据集（Order/Base/Line/Process/Equipment/MaterialBalance/DemandSegment/FinancePlan…），每张显行数。
3. 点任一数据集 → 表格预览真实行 → 点「下载 Excel」→ 得到 `.xlsx` → 用 Excel 打开 → 真实业务数据（非空、非模版）。
4. 后端：`GET /a/v1/raw-datasets/:id/export?format=xlsx` 直接回真 .xlsx；DB 里 `raw_datasets`/`raw_rows` 有这些行。
5. 门：`no-orphan-source:check` 绿；人为植入一个无 `origin.rawDatasetId` 的对象 → 门红（自证）。

## §1 现状盘点（钉 file:line·✅已在/◐部分/🔴缺）

| 维度 | 现状 | 证据 | 判定 |
|---|---|---|---|
| 合成数据落 RawDataset | 每对象类型一张 RawDataset·行落库 | `synthetic/service.ts:636-648 putAll`→`rawDatasets.put`；669-681 覆盖 Base/Model/Order/Line/Process/Equipment/MaintPlan/Segment/Shipment/DemandSegment/FinancePlan… | ✅ 已在 |
| 对象→源 血缘 backref | 每对象 `origin{sourceConnId,rawDatasetId,rawRowIdx}` | `service.ts:663`；lineage 端点 `app.ts:2143/2356` | ✅ 已在 |
| 合成连接器可见 | 名"合成数据源（确定性生成）"·`mock_erp`·`synthetic:true` | `service.ts:588-602`；`GET /a/v1/connections app.ts:2910` | ✅ 已在（诚实标） |
| 行预览 | FieldProfilePage 取**首个** RawDataset 渲染可编辑表 | `FieldProfilePage.tsx:83-112`（`ds-rows-table`） | ◐ 仅首个数据集 |
| 行端点 | list / rows / patch 行 | `app.ts:2960 raw-datasets`·`2964 /:id/rows`·`2972 PATCH` | ✅ 已在 |
| **Excel 导出实际数据** | 仅 CSV **模版**下载（列名·非数据） | `app.ts:1725/1770 template.csv` | 🔴 **缺**（无 .xlsx 实际数据导出） |
| **连接器页全数据集+下载** | ConnectionsPage 主体是连接列表+上传 | `ConnectionsPage.tsx:333 accept`；无 dataset 列表/下载 | 🔴 **缺** |
| **ts 时序源** | `origin:"SYNTHETIC"` 但**无 RawDataset** | `service.ts:292 tsSeries.list(origin==="SYNTHETIC")` | 🔴 **凭空**（时序不可见为 Excel） |
| **无凭空门** | 无门挡"无 rawDatasetId 的对象" | — | 🔴 **缺**（捷径可回潮） |

## §2 施工范围（dev 可直接照做）

### A. 后端 · 实际数据 Excel/CSV 导出（新端点）
- `GET /a/v1/raw-datasets/:id/export?format=xlsx|csv`：读 `repos.rawDatasets.get` + 行 → 序列化。
  - `xlsx`：用 **node-xlsx**（已是 datacore 依赖·见 `connectors/parsers.ts:2`）`xlsx.build([{name,data:[header,...rows]}])` → `reply.header("content-type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("content-disposition",attachment; filename="<connName>__<dsName>.synthetic.xlsx")`。
  - `csv`：复用模版下载的 header/disposition 范式（`app.ts:1725`），但出**行数据**非列名。
  - **确定性 R6**：同 RawDataset 同字节（行序稳定·无 Date.now）。**诚实**：文件名含 `.synthetic`（来自 `connection.config.synthetic||origin`）→ 导出物自带"这是合成数据"标识，**不冒充真实上传**。
  - 租户隔离 R2：经 `ctx(req)`；行级 A6 照既有 raw-datasets 端点口径。
- （可选·建议）`GET /a/v1/connections/:id/export.zip`：打包该连接全部数据集 .xlsx（一次拿全套）。

### B. 前端 · "数据连接器"页露全数据集 + 预览 + 下载
- `ConnectionsPage.tsx`：点连接 → 展开**该连接全部 RawDataset**（`GET /a/v1/raw-datasets?connId=`，**不再只首个**），每行显 `name · rowCount · fields 数`。
- 每数据集：「预览」（复用 `FieldProfilePage` 的 `ds-rows-table` 抽成 `<RawDatasetRowsTable datasetId>` 组件·渲染前 50 行）+「下载 Excel」「下载 CSV」按钮 → 命中 §A 端点（`window.open`/fetch blob）。
- 合成连接显眼标 `SYNTHETIC` 徽标（复用 `DataModeBadge`）+ 文案"确定性生成·可下载为 Excel 审计"——**透明 ≠ 冒充**。
- i18n 文案入 `locales/zh.ts`（连接器/数据集/下载）。

### C. 结构门 · 立"无凭空源"不变量（防捷径回潮·这才是治本）
- 新不变量 **R-NO-ORPHAN-SOURCE**：凡 `origin.type==="SYNTHETIC"` 的 ObjectInstance **必有** `origin.rawDatasetId` 且该 RawDataset 存在。（外部连接器/上传对象同理有 rawDatasetId；纯派生 DerivedProperty 不算对象、豁免。）
- 门 `scripts/check-no-orphan-source.mjs`（并入 `pnpm gates`）：起内存 SEED_DEMO 或读固定夹具 → 遍历 objects → 断言每个有可解析 rawDatasetId → 有凭空即红。**green→red 自证**：测试里塞一个无 rawDatasetId 对象 → 门红。
- 回写本体 §5 不变量表 + §7 门禁表。

### D. 覆盖 · ts 时序的源透明（闭凭空残口）
- 二选一（dev 按工作量定·WO 推荐 D1）：
  - **D1（推荐·轻）**：ts 时序**派生自对象**（util/oee/良率随时间），**诚实归类为"派生指标"非"源数据"** → 在"数据连接器"页**不**伪装成上传源，而在时序/驾驶舱页标注"派生自 Base/Line/Process 对象·非独立源"。同时 §C 的门**豁免 ts**（ts 不是 ObjectInstance）。→ 满足"所有**源**数据可见 Excel"的诚实口径（ts 非源）。
  - **D2（重·若用户坚持 ts 也要 Excel）**：为 ts 生成一张 `ts_points` RawDataset（time,seriesKey,value 列）+ 同 §A 可导出。代价：ts 体量大、与 tsSeries 双写需一致性守。
- **本 WO 默认 D1**（诚实分类），D2 列为可选增量。

### E. 诚实守卫（R13·审核方红线·dev 必须遵守）
- 本 WO **不**把合成数据"洗成"真实上传——连接 `connectorTypeKey` 保持 `mock_erp`/`synthetic:true`、对象 `origin.type` 保持 `SYNTHETIC`、导出文件名带 `.synthetic`、前端 SYNTHETIC 徽标常驻。**目标是"透明可审计"，不是"伪装成真"**。
- 真实上传路径（`POST /a/v1/uploads`+parseXlsx）已在、**不动**；本 WO 只让**合成源也达到同等透明度**（可见+可下载+可溯）。

## §3 验收（FDE 亲手·三层都要证据）
1. **后端 curl**：`GET /a/v1/connections`→合成源在；`GET /a/v1/raw-datasets?connId=…`→N 张；`GET /a/v1/raw-datasets/:id/export?format=xlsx`→真 .xlsx（`file` 看 MIME·`xlsx` 能解开见真行）；DB（pg 模式）`SELECT count(*) FROM raw_rows` 有行。
2. **前端真浏览器**：开"数据连接器"→合成源→全 N 数据集→预览真行→下载 Excel→Excel 打开见真业务数据→SYNTHETIC 徽标在。截图录证。
3. **门**：`no-orphan-source:check` 绿；植入凭空对象→红（green→red 自证）。
4. **回归**：`pnpm -r build && pnpm -r test` 四包全绿（datacore 含新导出端点测 + 门测）。

## §4 不在本次范围（诚实边界·别让用户以为做了）
- 不把 demo 默认数据源从合成换成真实上传（那是另一单·选项 C·本单只做"合成源透明化"）。
- 不做真 ERP/MES 实时拉数（连接器仍离线·见 WO-ACTUATE）。
- D2（ts 也落 RawDataset）默认不做，列可选增量。
- 不改真实上传链（已在·不动）。

## 本体引用与影响
- **链路**：`Connector(合成源/上传)→RawDataset(DB·可导出 .xlsx)→materialize→ObjectInstance(origin.rawDatasetId 必有)`（本体§3:199/205）——本单补"导出 .xlsx"边 + "无凭空"约束。
- **对象类型**：Connection/RawDataset/RawRow/ObjectInstance（origin backref）。
- **不变量**：**新增 R-NO-ORPHAN-SOURCE**（每 SYNTHETIC/上传对象必有 rawDatasetId·门守）；R13（诚实位 SYNTHETIC·导出标 .synthetic 不冒充）；R6（导出字节确定）；R2（租户隔离）；R16（合成走正门不变）。
- **断点**：G-6（三路上传已收口）**之上补"数据导出 Excel"**；闭"合成对象源不透明/凭空 ts"残口 → 建议登记 **G-13「源数据透明化」收口**。
- **回写**：dev 落地后回写本体 §3（导出边）+ §5（R-NO-ORPHAN-SOURCE）+ §7（no-orphan-source 门）+ §8（G-13 收口）。

---
*审核方自包含施工单（design+review·铁律0.5 先设计再派 dev·钉真实 file:line·非真起服务实拍——验收 §3 由 dev 亲手 FDE）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
