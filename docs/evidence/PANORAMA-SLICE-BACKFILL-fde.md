# PANORAMA-SLICE-BACKFILL · FDE 真浏览器实证（铁律 0.4）

**全景→字段→切片 链条第三环**：七视角（GRAPH-PANORAMA-ONLY 已删）域知识以「切片形态」存续 —— 五域各配一张声明式多跳切片，`/admin/slices` 升级为「切片 × 图谱」融合页。

## 真起环境（非 mock·非冒烟）

- **真后端 datacore**：`PORT=4051 SEED_DEMO=1` 内存模式真起（真合成 demo 租户数据）。
- **真前端**：`pnpm --filter frontend-shell build` 产物经同源 static+proxy（`/a/v1/*` → 127.0.0.1:4051）真起于 `:5199`。
- **真浏览器**：Playwright + Chromium（`--no-sandbox`）真登录 `demo / admin / demo1234` → 真渲染 `/admin/slices`。
- **逐值对照**：前端所见 `slice-fusion-nodes` 计数 == 后端 `POST /a/v1/ontology/slices/:key/resolve` 返回 `data.nodes.length`（同租户 admin·同确定性 R6）。

## ① 页顶全景（默认视图·复用全景渲染件 OntologyGraphView）

截图 `pb-shots/00-panorama-default.png`：页首「切片 × 图谱」→「本体图谱全景」区块渲染整本体**类型图**（力导布局·14 域配色图例 工厂/产品/工艺/设备/产能/质量/计划/外部/求解器/Agent）。全景归此页，无独立图谱导航。`panoramaSection=true · panoramaSvg=true`。

## ② 选中 3 切片 → 页内渲染 resolve 真值子图 · 节点数逐值 == 后端

| 切片 | 入参 | 后端 resolve 节点数 | 前端 UI 节点数 | SVG 子图节点数 | 逐值一致 | 截图 |
|---|---|---|---|---|---|---|
| `panorama.backbone` 推演主干链 | `{so:"SO-3391"}` | **45** | **45** | 45 | ✅ | `pb-shots/01-panorama_backbone.png` |
| `panorama.dataflow` 数据流/来源域 | `{so:"SO-3391"}` | **58** | **58** | 58 | ✅ | `pb-shots/02-panorama_dataflow.png` |
| `panorama.orchestration` 编排/决策域 | `{key:"baseline"}` | **24** | **24** | 24 | ✅ | `pb-shots/03-panorama_orchestration.png` |

选中切片行 → 页内 `slice-fusion` 面板渲染该切片 resolve 真子图（复用 `SubgraphPanel` 同引擎），入参用 `GET /a/v1/catalog?kind=slices` 的 argHints 示例值自动构造。**三切片节点数前端所见逐值 == 后端 resolve 真值**（45/58/24）。

## 五域切片 resolve 真值（后端 curl 复核·spannedTypes≥3·多跳）

| 切片 | 节点 | 覆盖类型 |
|---|---|---|
| panorama.backbone | 45 | Order,Model,Base,Line,Process,Equipment,Material（7·5 跳主干） |
| panorama.dataflow | 58 | Order,Model,Material,MaterialBatch,LabTest,PurchaseOrder,Base,DataSourceHealth（8·4 跳） |
| panorama.solver_binding | 24 | Base,Line,Process,Equipment,Shipment,MaintPlan,DataSourceHealth（7·3 跳） |
| panorama.orchestration | 24 | AnnualScenario,PlanTarget,Principal,CapexProject,FinanceMetric（5·2 跳） |
| enterprise_360 | 101 | 18 类跨八域 |

## 齿（revert→red 亲验·铁律 3）

`apps/datacore/test/panorama-slice-backfill.test.ts` PB1/PB2/PB4：把 `panorama.backbone` 主干路径截为单跳（仅 `order_for_model`）→ 亲测 **red**：`panorama.backbone 缺深层类型 Base`、`多跳锚点 Equipment 应可达: expected 0 to be greater than 0`、契约 fixture `typesOk=false linksOk=false`。已 revert。多跳非单跳守住。

## 诚实边界

- resolve 空 → `slice-fusion-empty` 诚实空态（不造占位节点），指明核对入参/去补数据。
- 全景为**类型图**（已发布本体派生投影 R13），切片子图为**实例真值**（executeSlice·A6 逐跳过滤）；两级不同层，页内并置。
- 数据流/求解器绑定/编排域以业务真值切片承载（原七视角本为业务本体图 nodeFilter/着色 lens）；平台自我元本体（`__platform__` 元租户 sys.* 切片）R2 隔离、不在业务租户 resolve，故不并入本页真值子图。
