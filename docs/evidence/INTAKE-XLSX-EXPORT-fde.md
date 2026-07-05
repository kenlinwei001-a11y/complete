# FDE 亲手证据 · INTAKE-XLSX-EXPORT（全数据集多 sheet Excel 导出）

用户亲定：『把数据连接器&上传里所有源数据输出一张可下载 excel，可多 sheet』。
本单产品化该能力：新增后端 `GET /a/v1/raw-datasets/export.xlsx`（多 sheet：概览 + 每数据集一 sheet）+ 前端「数据连接器&上传」页两处下载按钮。

铁律 0.4：真起服务、真跑真数据、真浏览器点按钮、前端所见逐值对照后端真值、诚实边界。以下均为**真实执行**记录（非冒烟）。

---

## 一、真起 datacore 服务 + 真 HTTP 导出 + 回读逐值对账（后端真值锚点）

- 启动：`PORT=4001 SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js`（内存模式，seed=42 电池合成数据，走"合成源→RawDataset→物化"正门）。
- 真 HTTP：`GET /a/v1/raw-datasets/export.xlsx`（`X-Debug-User: demo:admin:admin`）→ 用 `node-xlsx` 解回 workbook，逐项对账 `GET /a/v1/raw-datasets` 与 `GET /a/v1/raw-datasets/:id/rows` 真值。

```
真数据集数: 40
HTTP 200 · content-type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
content-disposition: attachment; filename="source-data-all_2026-07-05.xlsx"
回读 sheet 数: 41  (期望 数据集数+1 = 41)                     → PASS
sheet1 名: 概览                                              → PASS
概览行数: 40  (期望 == 数据集数 40)                          → PASS
概览逐行(ID/名/行数)== 真数据集清单                          → PASS
抽样数据集 "Base"(rds_t29yd1dwan34cb3y): xlsx 行=12 · GET rows=12 → PASS
逐值对账 132 个单元格全部 == 后端真值                        → PASS
  抽样首行(xlsx): [baseId,name,kind,position,lon,lat,util,bottleneck,gwh,formationCapDaily,agingCapDaily]
               => ["changzhou","常州","动力+储能","动力+储能",119.95,31.78,0.83,"模组",36.7,63265,61698]
  抽样首行(后端): {"baseId":"changzhou","name":"常州","kind":"动力+储能",...,"agingCapDaily":61698}
?connId=conn_... → sheet 数 41 (期望 40+1)                   → PASS
R2 跨租户 other → sheet 数 1 (仅概览·0 数据·不泄漏)          → PASS
```

结论：40 个真数据集 → 41 个 sheet（概览 + 每集一张）；概览每行的 ID/名/行数 == 真数据集清单；抽样 "Base" sheet 132 个单元格逐值 == `GET /rows` 后端真值（含 CJK 值 `常州`/`动力+储能` 字节保真）；`?connId=` 过滤正确；跨租户仅见空概览（R2 隔离，不泄漏别租户数据）。

## 二、真浏览器（Chromium/Playwright）点按钮下载（前端真 UI）

- 真起前端 dev（`VITE_MOCK=1 pnpm --filter frontend-shell dev`，localhost:5173）+ 真 Chromium 驱动。
- 登录 demo/planner → SPA 内导航到「连接器与上传」（`/admin/connections`）→ 真点两个按钮，捕获真 download 事件。

```
URL: http://localhost:5173/admin/connections
顶栏导出按钮可见: true · 文本: 导出全部源数据(Excel)
顶栏下载文件名: source-data-all_2026-07-05.xlsx                （真 download 事件·attachment）
连接级按钮(conn-erp)可见: true · 文本: 导出本连接源数据(Excel)
连接级下载文件名: source-data_conn-conn-erp_2026-07-05.xlsx    （真 download 事件·带连接段）
真发请求 URL: [ /a/v1/raw-datasets/export.xlsx ,
              /a/v1/raw-datasets/export.xlsx?connId=conn-erp ]
```

截图：
- `docs/evidence/INTAKE-XLSX-EXPORT/connections-page.png` — 顶栏「导出全部源数据(Excel)」按钮真渲染。
- `docs/evidence/INTAKE-XLSX-EXPORT/conn-panel.png` — 连接级「导出本连接源数据(Excel)」按钮真渲染。

结论：真浏览器中两处按钮真渲染、真点击、真触发浏览器下载；`connId` 正确透传到端点 query。

## 三、诚实边界（不作假）

- **本节二的 download 落盘为 4 字节**：那是 **MSW mock 模式**（`VITE_MOCK=1`）回的占位二进制，用于验证「真 UI 按钮→真 fetch→真 download 链路」；**真实的多 sheet 内容 + 逐值对账在本节一用真 datacore 服务完成**（真 xlsx、132 单元格逐值 == 后端）。二者合起来构成"前端真点 → 后端真产 → 逐值对账"的完整闭环。
- 空数据集在 sheet 内诚实标注「(此数据集无行数据)」+ 概览备注列标「空数据集（无行）」，不伪造行。
- 大表护栏：每 sheet 上限 50000 行截断，概览备注列标「已截断：仅前 50000 行（共 N）」，并在 sheet 末尾附截断脚注引导单集导出 `/raw-datasets/:id/export`——不静默丢数据。
- R6 确定性：workbook 内容仅取 `rawRows.list` 原序 + 字段画像列序，无时钟/随机入内容；文件名的日期段仅供人读、不进 workbook 内容。
- R2：`listRawDatasets(ctx)` 仅本租户；跨租户导出得空概览（已实测）。

## 四、齿（gear · revert→红亲验）

- **后端**（`apps/datacore/test/intake-xlsx-export.test.ts`）：临时把 `xlsx.build([{概览},...sheets])` 改为 `xlsx.build([...sheets])`（丢概览）→ 3 用例齐红：
  `expected 40 to be 41`（sheet 数）、`expected 40 to be 41`（connId）、`expected 500 to be 200`（空租户 build 0 sheet → 500）。还原后 3/3 绿。
- **前端**（`apps/frontend-shell/test/intake-xlsx-export.test.tsx`）：临时把 `downloadAllRawDatasets` 的 `export.xlsx` 改为 `BROKEN.xlsx` → 2 用例齐红（`expected false to be true`：fetch URL 断言）。还原后 2/2 绿。
