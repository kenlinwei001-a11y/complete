# PANORAMA-FIELD-INTAKE · FDE 实证（真起服务·真浏览器·逐值对照·不作假）

日期 2026-07-05 · WO：全景驱动数据字段补齐（用户亲定链条第二环·闭 G-6 邻域）。

## 环境（真起·非 mock）
- datacore :4001（内存模式 `SEED_DEMO=1`）+ agentcore :4002 + 前端 vite :5200 **真后端模式**（`VITE_DATACORE_URL/VITE_AGENTCORE_URL`，非 VITE_MOCK）。
- 真 Chromium（playwright chromium-1148）+ 真登录 admin/demo1234。脚本：`fde-panorama-field-intake.mjs`（scratchpad）。

## 后端真值（curl 独立 oracle）
- `GET /a/v1/ontology/graph`：全景对象节点 **35**；`GET /a/v1/intake-coverage`：items **35**（同源同数）、
  `summary = { types:35, templateComplete:35, typesWithTemplateGap:[], uncategorized:[] }` —— **全景每类型模版完备**（矩阵口径）。
- Order：`intakeTotal=13, suppliable=13, template.missing=[], primaryKey=so, refColumns=[{model→Model}]`（FK 列标注）。
- `GET /a/v1/data-templates/Order` → 表头 13 列：`so,cust,model,qty,due,pri,bases,status,demandDelta,outsourceRatio,creditUsedRatio,leadDays,unitPrice`。
- curl 预演往返：上传 FDE-SO-1（13 列全填）→ `POST /a/v1/databuilder/intake/objectify` → `materialized:[{type:Order,count:1}], skipped:[], candidates:0`（**无静默丢列**）→ `GET /a/v1/objects?type=Order` 该实例 13 字段逐值 == 上传值，且派生 `value=2442`（=888×2.75，系统按公式算出——上传字段喂真派生）。

## 真浏览器 FDE（9/9 通过）
1. **登录成功**（admin/demo1234 → 工作台）。
2. **数据连接器页渲染**（`/admin/connections` 数据分类面板 13 类）。
3. **覆盖徽章逐值对后端**：销售订单展开 → `dc-cov-Order` 显「可供给 13/13」== 后端 `suppliable/intakeTotal`（截图 1）。
4. **真下载模版**（浏览器 blob 下载 `Order.template.csv`）→ 表头 **字节级 ==** `GET /a/v1/data-templates/Order`（13 列）。
5. **填样**：按模版 13 列全填 1 行（FDE-SO-2 / 远山重工 / 2170-NCM / 612 / 2026-10-01 / 中 / 宜宾 / CONFIRMED / 5 / 0.08 / 0.61 / 25 / 1.9）。
6. **真上传**（切文件上传 → file input）→ 上传预览就地显示 FDE-SO-2 行（截图 2）。
7. **当页 objectify** → 回显「已物化 1 个对象实例」+ 对象浏览器深链（截图 3）。
8. **对象 360 逐字段对照**（`/o/Order/FDE-SO-2`）：**13/13 字段前端所见 == 上传值**（逐值打印于脚本输出·截图 4）。
9. **连接字段映射面板**：35 类型绑定逐一暴露全景字段全集（已映射 propKey←源字段·缺源诚实标未映射）（截图 5）。

截图：`PANORAMA-FIELD-INTAKE-{1-coverage,2-upload-preview,3-objectify,4-object360,5-fieldmap}.png`。

## 齿检（真实测试·违红）
- `apps/datacore/test/intake-coverage.test.ts`（5 用例）：
  - **矩阵齿**：全景（graph 对象节点）逐类型——模版存在 + 模版列 ⊇ 非派生 props（少一列即红）+ PK 在列 + ref 列标 FK 父类型 + gaps==[]；summary 与逐项勾稽。
  - **连接器诚实**：Order 出厂绑定 mapped∪unmapped == 全部非派生 props（分区完整·unitPrice/pri 等缺源字段逐个列出·非隐藏）。
  - **上传往返齿 ×2**：Order 模版 13 列手填往返（对象每字段严格==上传值）+ Base `withSamples=2` FK 一致样例 CSV 原样上传往返（逐字段一致）。
  - **全景自动完备**：POST 新类型 PanoProbe → 立即有模版（列含 ref FK 标注）+ 覆盖行 + 诚实 `categoryKey:null` 进 `summary.uncategorized` + `GET /a/v1/data-templates/PanoProbe` 真可下载。
- `apps/frontend-shell/test/intake-coverage.test.tsx`（4 用例）：覆盖徽章 N/M 逐值==后端、未映射徽章 title 逐字段+深链 schema-reconcile、未归类全景类型区诚实透出、上传→objectify 回显+深链（MSW 同形）。

## 诚实边界
- demo 租户出厂类型 sourceBindings 映射完备（物化 provenance 全字段）→ 连接器「未映射」徽章在 demo 显示为绿 13/13（真值如此·非隐藏）；**部分映射的诚实未映射展示**由 datacore 齿②（seedBattery 路：Order 绑定仅 6 字段 → unmapped 7 字段逐个列出）与前端齿③（mock 同形 unitPrice 未映射）钉死。
- 未归类类型区在 demo 为空（35 类型恰好全部归类·真值）；机制由齿④（新发布类型 → uncategorized）+ 前端齿②（LabTest mock）钉死。
