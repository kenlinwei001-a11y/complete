# 轨L 增量3 验证证据（ModelingPage UI 真值闭合 · 真浏览器 FDE）

> 增量3：ModelingPage 中心显真本体、34 数据集显"已建模"、coverage 权威源 = 已发布类型 sourceBindings（非仅草案）。

## 1. 改了什么（融合·解决根本问题不走捷径）
- `coverageByDatasetName(drafts, publishedTypes?)`：**权威来源改为已发布对象类型的真 `sourceBindings.dataset`**（demo 经真链发布后 provenance 真实，34 类各绑其 rawDataset）——本体已存在的数据集不再依赖"草案是否还在"才显已建模；草案仍并入（建模中 in-progress 也计），(dataset→typeKey) 去重合并。
- `DataSourcePanel` 自取 `/a/v1/ontology/object-types`（含 sourceBindings）喂 coverage；call site 不变。
- `ModelingPage` 中心：`draft ? 工作台 : publishedTypes?.length ? <PublishedOntologyView> : 空态`——**有已发布本体但无活动草案时显已发布本体（绝不"暂无本体"）**，逐类型可溯 sourceDataset。
- `fetchObjectTypes` VM 补 `sourceBindings`/`derivedProperties`（后端早已返，前端类型补齐）。

## 2. 真浏览器 FDE（Playwright·真 datacore chainMode 种子·非 mock）✅
起真 vite dev（`VITE_DATACORE_URL=http://127.0.0.1:4001` 指向 chainMode 种子的真 datacore）→ 真登录 demo/admin/demo1234（LOGIN 200）→ `/admin/modeling`：

| 判据（HANDOFF §6） | 结果 |
|---|---|
| 中心显"暂无本体" | **false**（中心显真本体工作台，PUBLISHED 草案=链产，34 类型可编辑可溯） |
| 34 数据集覆盖徽章 | **34/34「N 个对象类型」（已建模）· 0「未建模」** |
| 中心含真类型名 | true（生产基地/销售订单… 中文 displayName） |

截图：`docs/evidence/demo-provenance-increment3-modeling-fde.png`（左数据源全绿"已建模" · 中心本体工作台 34 类 · 右 Base 属性 baseId/name/kind…）。

## 3. 测试 ✅
- 新增单测 `coverageByDatasetName` 已发布类型为权威源（无草案也认已建模 + 与草案去重合并）。
- `pnpm --filter frontend-shell test` 全绿（data-source-panel 4 / f10.modeling 2 / 全套）；`pnpm --filter frontend-shell build` 绿。
- 改动 additive：旧 coverage 单测（仅 drafts）+ 渲染测（oee 未建模）语义不变（publishedTypes 缺省→旧行为）。

## 4. 北极星（FDE·用户视角）达成
打开 demo ModelingPage：**中心显真本体（34 类·中文名·经链发布可溯 sourceDataset）· 左 34 数据源全"已建模"**；provenance 链真实可走通（数据源→建模→本体→对象化，R13）。"暂无本体/全未建模"的根因（demo 短路建模链）已从根上消除——非改文案，是 demo 真走链。
