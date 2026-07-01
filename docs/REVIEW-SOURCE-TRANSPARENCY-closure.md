# REVIEW · SOURCE-TRANSPARENCY 复验闭环（数据源透明化·消灭走捷径·cd90287）

> 审核方按 ACCEPTANCE-CONTRACT **逐条亲手跑 + 前后端闭环 + 像素级**（用户令）。本 WO 直击用户原话 bug：**所有源数据须在"数据连接器"页前端看得到 Excel、在后端库里**。审核不 rubber-stamp dev 的 FDE，独立真跑（尤其 C6 真浏览器真下载）。
> 环境：真 datacore（`dist` rebuilt @ c7c5e5e · SEED_DEMO · 127.0.0.1:4001）+ 真 vite（`127.0.0.1:5177` · 非 mock · 指真后端）。

## 判决：✅ DONE（源数据前后端可见·真下载 .xlsx 见真业务数据·SYNTHETIC 诚实不冒充·no-orphan 门治本）

## 契约 7 条逐条真跑证据

| # | 断言 | 类型 | 实测证据 | 判 |
|---|---|---|---|---|
| C1 | 合成连接诚实标(mock_erp·synthetic=true·不洗成真实) | curl | GET /a/v1/connections → `{id:conn_yj2…,name:"合成数据源（确定性生成）",connectorTypeKey:"mock_erp",synthetic:true}` | ✅ |
| C2 | ≥8 张 RawDataset·每张 rowCount>0·覆盖 Order/Base/Line/Process | curl | GET /a/v1/raw-datasets?connId=… → **35 张** `Base(12) Model(6) Order(24) Line(12) Process(60) Equipment(72) MaintPlan(12) Segment(3) Shipment(12) DataSourceHealth(9)…`·全 rowCount>0·覆盖 Order/Base/Line/Process | ✅ |
| C3 | export xlsx→200·xlsx content-type·filename .synthetic.xlsx·PK 魔数·行非空真数据 | curl | GET /a/v1/raw-datasets/:id/export?format=xlsx → **200**·`content-type: …spreadsheetml.sheet`·`content-disposition: …filename="source__Order.synthetic.xlsx"`·PK 魔数✓·27176B·unzip 解出 **25 行**(表头+24真订单)：header `[so,cust,model,qty,due,pri,bases,status,…]`·row1 `SO-3391,整车厂A,4680-NCM,8,2026-06-24,高,["changzhou","hefei"],OPEN,550…`(非模版列名) | ✅ |
| C4 | R6 确定性：同数据集连两次 export 字节一致(sha256) | curl | 两次 export sha256 均 `ecd7a95cdfeb051d…` **identical**·无 Date.now/行序漂移 | ✅ |
| C5 | 结构门 no-orphan-source:check 绿；植入 SYNTHETIC 缺 rawDatasetId 对象→红(green→red 自证) | gate | `pnpm no-orphan-source:check` → **exit 0**·6 测过(green:合成正门 orphans=[] + red:植凭空对象→抓出 reason=MISSING_RAW_DATASET_ID + red:dangling + xlsx/csv 导出 + R2 隔离)·并入 `pnpm gates` | ✅ |
| C6 | 真浏览器：连接器页→展开全部数据集→预览真行→点下载 Excel→真落 .xlsx→见真业务数据→SYNTHETIC 徽标常驻 | browser | **Playwright 真 Chromium**(登录 demo/admin/demo1234·真后端)：`/admin/connections` → **SYNTHETIC 徽标可见**(text="合成数据") → **35 数据集行全露** → 点预览→真行可见(SO-*/changzhou/常州) → 点「下载 Excel」→**真下载** `source__Base.synthetic.xlsx`(20439B·PK 魔数·.synthetic✓) → unzip 见 **Base 12 行真数据** header `[baseId,name,kind,position,lon,lat,util,bottleneck,gwh…]` row `changzhou,常州,动力+储能,119.95,31.78,0.83,模组…`。截图 `docs/evidence/st-c6-connectors.png`(像素级：Base 表 12 行全值 changzhou→luoyang + 下载 Excel/CSV 按钮 + 合成数据徽标 + 诚实文案) | ✅ |
| C7 | 回归四包全绿 | gate | `pnpm -r build`(BUILD_OK) `&& pnpm -r test` → **exit 0**·datacore **844 passed**\|15 skipped(较 SOLVER-BINDING 时 838 **+6** no-orphan-source.test.ts)·agentcore 356·frontend **299**(ConnectionsPage 改未破前端测)·contracts 3·llm-adapters 15 → **全绿零回归** | ✅ |

## 前后端闭环·数据前后端可见（后端库 = 前端页 = 下载文件·三处同值）
| 数据 | 后端(raw-datasets/export curl) | 前端页(连接器页像素级) | 下载 .xlsx(浏览器真落) |
|---|---|---|---|
| Base changzhou | baseId=changzhou name=常州 util=0.83 bottleneck=模组 lon=119.95 | 表 row0：changzhou 常州 动力+储能 119.95 31.78 0.83 模组 36.7 63265 | source__Base.synthetic.xlsx row：changzhou 常州 动力+储能… |
| Order SO-3391 | so=SO-3391 cust=整车厂A model=4680-NCM qty=8 | Order 24行(面板列出) | source__Order.synthetic.xlsx：SO-3391 整车厂A 4680-NCM 8… |
→ 三处逐字段一致·**源数据前端可见 Excel + 后端库有**（用户原话 bug 闭）。

## 代码评审 + 本体回写（铁律0）
- **导出端点**：`app.ts` `GET /a/v1/raw-datasets/:id/export?format=xlsx|csv`(读库 raw_rows·R6 确定序·R2 跨租户404)。合成源文件名带 `.synthetic`(R13 诚实位·`classifySourceOrigin`)。
- **结构门**：`no-orphan-source.ts` `auditNoOrphanSource`——凡 origin.type∈{SYNTHETIC,MATERIALIZED} 必有可解析 rawDatasetId(豁免 MANUAL/META/ts 派生)·`check-no-orphan-source.mjs`+6 测·并入 gates。
- **前端**：`ConnectionsPage.tsx` 每连接全部数据集逐张预览(前50行真数据)+下载 Excel/CSV·合成源常驻 `DataModeBadge SYNTHETIC`+诚实文案。
- **本体回写齐**：SYSTEM-ONTOLOGY.md §2 RawDataset(导出+透明化)·§3 export 边·§5 不变量 R-NO-ORPHAN-SOURCE·§7 no-orphan-source 门·§8 G-13 收口。
- **诚实边界(dev 标·认同)**：透明化**不把合成洗成真实**(SYNTHETIC 徽标常驻·导出标 .synthetic·mock_erp/synthetic:true 不动)；不换 demo 默认源为真实上传(另单)；不做真 ERP 实时拉数(连接器仍离线·WO-ACTUATE)；ts 时序诚实归类派生非源(D1)。

## 距北极星（诚实）
- ✅ **用户原话 bug 闭**：源数据（合成生成的）在"数据连接器"页前端**看得到 Excel**(35 数据集预览+真下载 .xlsx 见真业务数据) + 后端库里(raw_datasets/raw_rows)。透明可审计。
- ✅ **治本防回潮**：no-orphan-source 门(green→red 自证)挡"凭空对象走捷径"·并入 gates。
- ⚠️ 透明 ≠ 真实接入：这是**把已有合成源透明化审计**(诚实标 SYNTHETIC)，**非**接真实 ERP/MES(仍离线)、**非**换 demo 默认源为真实上传——那是 B3(SOLVER-BINDING✅已闭)/ACTUATE/上传流的范围。用户"源数据须在库+前端可见"的透明诉求已闭；"接真实数据出真答案"由 SOLVER-BINDING 另闭。

---
*审核方 SOURCE-TRANSPARENCY 复验闭环（前后端闭环 + C6 真浏览器真下载 .xlsx 像素级 + no-orphan 门 green→red + 7 契约逐条）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
