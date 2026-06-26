# 轨P · 复刻建模族 · 增量0 基线（真跑现 ModelingPage + 逐①元素 pipeline 端到端验证·只看不改）

> SPEC-replica-modeling-family §增量0 + design-system §10.2。起 demo 真跑 `/admin/modeling`（常驻 admin 页·无开箱门），
> 实拍现态 + 逐①元素验数据 pipeline 源→端点→前端 API→渲染端到端通。分层交付 b：只做①接现成 full 1:1，③类登记 TO-DO。

## 1. 现 ModelingPage 态（轨L 真值闭合 + 轨A P1 #37 DAG·实拍 `p0-modeling-baseline.png`）
- **接着用**：三栏（数据源面板「34 数据集·已建模」+ 中心已发布本体 PublishedOntologyView「34 类·可溯 sourceDataset」+ 草案工作台）；轨A P1 #37「数据管道 DAG」（LayeredDag·sourceBindings 真血缘·简版）。
- **真后端 API（实拍 network）**：`GET /a/v1/{raw-datasets, ontology/object-types, modeling/drafts, modeling/drafts/:id/coverage}`。
- **现缺（轨P 要补·竞品 image2/6/5）**：L0-L4 认证面板 ❌ · 世界完整度绿环 ❌ · 逐对象 gauge ❌ · 数据流 DAG（竞品横向 ETL 5 链·本体专用组件）· 中栏 6 子 tab · Agent 指挥台。

## 2. 逐①元素 pipeline 端到端验证（真后端 curl·都通·无需建后端）
| ①元素 | 源→端点 | 真跑结果 | 前端要补（增量内） |
|---|---|---|---|
| ② 数据流 DAG | `GET /a/v1/ontology/graph` | **通**：nodes 54 + edges + **含 `fieldMappings`** | 建**本体专用 DAG 组件**消费 fieldMappings（PmDag/FdeGraph 形状不直接适用·竞品横向 ETL） |
| ① L0-L4 认证 | `POST /sim/sessions` → `GET /sim/sessions/:id/certification?scope=GLOBAL` | **通**：session `sims_*` 建成 → cert `level=L1_CONFIGURED`（真态·非 L4） | ModelingPage 从零接（现零 cert）：建/复用 SimSession + 接 deriveCertification |
| ⑤ 逐对象 gauge | `…/certification?scope=LOCAL&target=Order` | **通**：LOCAL(Order) `level=L1_CONFIGURED` | 对象配置抽屉接 `fetchSimCertification(sid,"LOCAL",type)` + 半圆 gauge |
| ⑥ Agent 指挥台 | `POST /b/v1/queries`（presetContext 注入·G-3 后端段） | **通**（轨M 增量2b 已坐实提交+presetContext+对话坞；真答案受 demo 无 LLM 限） | 两页嵌 QueryDock 类面板 + `setSelectedObjects`→SessionContext |

## 3. 关键 pipeline 发现（§10.2 级·指导增量2/3）
- **cert 需 SimSession**：`fetchSimCertification(sessionId,...)` 必带 sessionId（端点 `/sim/sessions/:id/certification`）。ModelingPage（admin 页）现无 session → **「从零接」含建/复用一个 SimSession**（非仅调端点）。demo 真跑 `POST /sim/sessions` 成功（admin 可建·sim entitlement 通）→ **无阻断**，增量2/3 可做。
- **#37 DAG 是简版前驱**：轨A P1 #37 用 LayeredDag + sourceBindings；轨P 增量1 要换**竞品像素级横向 ETL DAG**（消费 `/ontology/graph` fieldMappings，含中间「数据处理_XX」层）——增量1 升级它（非另起，承接）。
- **cert 真态 = L1_CONFIGURED**（非 L4 Certified）：demo 本体已配置未做 Trial Tick → 认证面板按**真级**渲染（绿环非 100/100），**禁写死 100**（防假推演·SPEC 红线）。

## 4. ③类（不做·登记 TO-DO·design-system §10.1）
图查询页（构建器/查询语言/codegen/Query→Skill/Query→MCP）· 6维健康雷达 · 4维信任雷达 · 4业务动作+RL4运行态 · 分层目标 · 类型化约束/GEO · A–C分级 · L4 子项 Schema lint/已持久化 —— **后端未建，本轮不画假壳**（画了=假推演·打回）。

## 5. 增量计划（分层交付 b·只看不改已完成）
增量1 数据流 DAG（本体专用组件·/ontology/graph fieldMappings）→ 增量2 L0-L4 认证面板（deriveCertification·真级）→ 增量3 对象配置抽屉+逐对象 gauge（cert scope=LOCAL）→ 增量4 中栏 6 子tab + Agent 指挥台(QOS·G-3) + 主题接轨O。本增量0 零代码改动。
