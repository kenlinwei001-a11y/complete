# WO-SOURCE-TRANSPARENCY · FDE 亲手验收证据（消灭"走捷径"·数据源透明化）

> 用户目标（原话）：解决系统"走捷径"的 bug——**所有数据，生成的源数据，都必须在"数据连接器"页面前端看得到 Excel、在后端数据库里**。
> 验收判据（WO §3·亲手真跑·真浏览器）：真起前端 + Playwright 真 Chromium → 数据连接器页见全部数据集 + 行预览 → 点「下载 Excel」→ 真下载 .xlsx → 打开见真业务数据；合成集文件名带 `.synthetic`；`no-orphan-source:check` 门 green→red 自证。

## 1. 后端 · 源数据 Excel/CSV 导出（真 curl）

端点 `GET /a/v1/raw-datasets/:id/export?format=xlsx|csv`（内存模式 `SEED_DEMO=1` datacore:4001）。

Order 数据集导出 .xlsx（真 curl · node-xlsx 解回）：

```
content-type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
content-disposition: attachment; filename="source__Order.synthetic.xlsx"     ← 合成源诚实位 .synthetic（不冒充真实上传）
sheet Order | rows 25（表头 + 24 真业务行）
header ["so","cust","model","qty","due","pri","bases","status","unitPrice","demandDelta","outsourceRatio","creditUsedRatio","leadDays"]
row1   ["SO-3391","整车厂A","4680-NCM",8,"2026-06-24","高","[\"changzhou\",\"hefei\"]","OPEN",550,0.6,0.35,1.15,14]
```

- **R13 诚实**：来源合成（`classifySourceOrigin`=synthetic）→ 文件名带 `.synthetic` 段；SYNTHETIC 徽标常驻（透明 ≠ 洗成真实）。
- **R2 隔离**：跨租户拉别人数据集 → 404（`no-orphan-source.test.ts` R2 用例）。
- **R6 确定性**：行序稳定、列序 = 字段画像序、无 Date.now/随机 → 同数据集同字节。
- 后端 DB：`raw_datasets`/`raw_rows` 有这些行（导出即读库）；对象 `origin.rawDatasetId` 溯回该表。

## 2. 前端 · 真浏览器（Playwright 真 Chromium @ /opt/pw-browsers）

真起 vite:5199（`VITE_DATACORE_URL` 真后端模式）+ datacore:4001（`SEED_DEMO=1`），admin/demo1234 登录 → `/admin/connections`。
脚本 `scripts/fde-source-transparency.mjs`（编排 `scripts/run-source-transparency-fde.sh`）实测输出：

```
连接数据集面板：1
露出数据集数：35（全部·非仅首个）           ← ② 露全部数据集（不再只首个）
SYNTHETIC 徽标：1 ✓（诚实·透明≠冒充真实）    ← 合成源徽标常驻
行预览：表 1 · 真行 12 ✓                     ← 逐数据集行预览真数据
截图 → docs/evidence/WO-SOURCE-TRANSPARENCY-connectors-page.png
真下载文件：source__Base.synthetic.xlsx       ← 点「下载 Excel」→ 真下载 .xlsx
文件名含 .synthetic ✓（导出物自带来源诚实位·不冒充真实）
xlsx 解开：工作表「Base」· 12 行真业务数据    ← 打开 .xlsx 见真业务数据
表头：["baseId","name","kind","position","lon","lat","util","bottleneck"]
首行：["changzhou","常州","动力+储能","动力+储能",119.95,31.78,0.83,"模组"]
xlsx 含真业务值（非空模版）✓
```

- 截图：`docs/evidence/WO-SOURCE-TRANSPARENCY-connectors-page.png`（全部数据集 + 行预览 + SYNTHETIC 徽标 + 下载按钮）。
- 真下载样本：`docs/evidence/WO-SOURCE-TRANSPARENCY-sample-export.xlsx`（Base 表 12 行真业务数据）。
- FDE 脚本 **EXIT=0**（真下载 .xlsx + 内容校验非空业务数据 + 文件名 .synthetic 全通过）。

## 3. 门 `no-orphan-source:check` · green→red 自证（治本·防捷径回潮）

不变量 **R-NO-ORPHAN-SOURCE**：凡 `origin.type ∈ {SYNTHETIC, MATERIALIZED}` 的对象必有可解析 `rawDatasetId`（豁免 MANUAL/META/时序[派生非源·D1]）。

真种电池合成数据（走"合成源→RawDataset→物化"正门）跑 `auditNoOrphanSource`：

```
GREEN（正门种子）: checked=493 orphans=0
RED（植入凭空对象后）: orphans=1 首个={"objectId":"obj_shortcut_demo","type":"Order","originType":"SYNTHETIC","reason":"MISSING_RAW_DATASET_ID"}
```

- **green**：demo 全量 493 对象经正门落地，无一凭空（每对象可溯回 RawDataset）。
- **red 自证**：故意植入一个无 `rawDatasetId` 的凭空对象（模拟"走捷径"）→ 审计立刻抓出 → 门红。
- 门 `pnpm no-orphan-source:check`（`scripts/check-no-orphan-source.mjs` → `apps/datacore/test/no-orphan-source.test.ts` 6 用例：green + 2 red[MISSING/DANGLING] + xlsx/csv 导出 + R2）全绿，已并入 `pnpm gates`。

## 4. ts 时序 · 诚实归类（D1）

ts 时序（TsSeries/TsPoint）**诚实归类为派生指标非源数据**（派生自 Base/Line/Process 对象随时间·非 ObjectInstance），不伪装成"数据连接器"页的上传源；`no-orphan-source` 审计只查 ObjectInstance，天然豁免 ts。满足"所有**源**数据可见 Excel"的诚实口径（ts 非源）。

## 5. 诚实边界（不在本次范围·别让用户以为做了）

- 透明化**不把合成洗成真实**：SYNTHETIC 徽标常驻·导出标 `.synthetic`·`origin.type` 保持 SYNTHETIC·连接器 `mock_erp`/`synthetic:true` 不动（R13）。
- 不换 demo 默认源为真实上传（另一单）。
- 不做真 ERP/MES 实时拉数（连接器仍离线·见 WO-ACTUATE）。
- D2（ts 也落 RawDataset）默认不做。

## 6. 回归

- `pnpm -r build`（4 包）全绿；`pnpm --filter datacore test` 全绿（+ `no-orphan-source.test.ts` 6 用例）；`pnpm --filter frontend-shell test` 全绿。
- `pnpm gates` 含新门 `no-orphan-source:check` 全绿。
- 本体回写：§2 RawDataset（导出 + 透明化）、§3（export 边）、§5（R-NO-ORPHAN-SOURCE）、§7（no-orphan-source 门）、§8（G-13 收口）。
