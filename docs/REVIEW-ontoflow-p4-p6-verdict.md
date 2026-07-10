# 复验裁决 · OntoFlow (Data Builder Studio) 三段 P4/P5/P6

> 审核方 2026-07-10 真跑复验。分支 `claude/parallel-agent-tasks-d3xmzn`（验时 HEAD 已前移至 facb3dc·P5/P6 前端在 bf4ca35..facb3dc 零改动·等价）。方法：2 个 worktree 隔离代理真起服务(非MSW)+真浏览器逐值对照后端(KILL-MOCK-RED)+真 HTTP 黑盒。**与主线零共祖·独立 lineage·不在 work-queue**。

## 总裁决：核心地基真·非造假·但"发布→生成应用→推演"决策价值尾段断 → 作为「完成交付」= **BLOCK（4 缺口）**
建模、准备度、画布落库、发布建本体、通用推演后端**都是真后端真值**（逐值证·108 测绿·非造假）；但 OntoFlow 的核心卖点「发布后生成应用即可用 + 推演」在 UI 上**到不了**——scaffold 只出蓝图不落库、推演前端缺席、发布面板契约漂移显示坏、feature 门控整个不存在。

## ✅ PASS（真后端真值·逐值证）
| 项 | 证据 |
|---|---|
| 入口/导航 | adminRegistry.ts:18 + App.tsx:93·真浏览器进入全渲染零 console 错·加载出 curl 建的工作流=真读后端非 MSW |
| 准备度 readiness | 后端 readiness.ts:148-156 7 维加权纯函数真算(手算逐值吻合 Supplier 19=34×0.2+60×0.2·剥数据真变)·前端 DOM 与后端 JSON **逐值全等**(overall24=24/100·grade NASCENT=初生·每维度全等) |
| 通用推演 generic-inference（**后端**） | generic-inference.ts:168-227 读真物化对象·Δqty+5@O1→四跳沿链路真重算(revenue derived/S1.total_qty link:SUPPLIES SUM/load2 二跳)·改 Δ 改目标真变·确定性 byte-identical |
| 画布 WorkflowCanvas 真编辑真落后端 | onNodeMove/onAddNode/onConnect→commit()→PUT·**生产拓扑(同源网关)逐值证**:entity-1 落库{x:418,y:314}·新登录会话重开画布 4 节点/3 边逐值一致=真落库非空转 |
| NodeConfigPanel 三页签+存储模式 | 三页签渲染真内容·子图建模 6 页齐·storageMode STATIC→ONTOLOGY 切换 PUT200 真落后端(被 readiness 重算反映) |
| 发布真产本体 | 图谱先行发布 types[Supplier,Order]+link[SUPPLIES]·数据先行[Order]·后端 /a/v1/ontology/object-types 确认真在可查(27 类型) |
| 既有前端不破 | frontend 42 文件/108 测全绿(DoD 基线 106+OntoFlow 新增 2·含 f41/f11 专测) |
| R6+多租户 | 三端 byte-identical·跨租户全 404 |

## ⛔ BLOCK（4 功能缺口·非造假·file:line 可直接修）
| # | 缺口 | 根因 file:line | 违反 |
|---|---|---|---|
| **B1** | feature.data-builder 门控**根本不存在**·端点恒 200 无法关 | features.ts:12-69 无此键·app.ts:1337-1365 无 requireFeature·endpoints.ts:582 注释是空头支票 | PRD §4/§9.3「关→404」+ CLAUDE.md **Entitlement 先于 authz 铁律** |
| **B2** | scaffold「生成应用」**死路·零落库** | scaffold.ts:55 buildScaffold 纯函数无 repo 写·service.ts:162-165 只返蓝图 | scaffold 后 /b/v1/agents 仍 2·scene-entries 仍 9·所列产物指向不存在·PRD §8.1「生成应用」未兑现 |
| **B3** | 通用推演**前端缺席** | pipeline.ts:164 明写"前端不消费"·endpoints.ts 无 inference 端点·动作栏 6 键无「推演」 | 后端真算(B4跳)但 UI 无入口无前后对比·PRD §8.2「发布后即可用推演」经 UI 未达成 |
| **B4** | 发布面板**契约漂移**·类型/链路显示空白(用户可见) | 前端 WfPublishResult(endpoints.ts:608)期望 `types:{typeKey}[]`·真后端返 `string[]`(service.ts:140,152)·t.typeKey 落空 | **教科书级"绿测试≠能用"**：被 MSW mock 掩盖(handlers.ts:970 返对象形匹配前端)+f41 只断言含"sliceKey"不校验类型值 |

## 诚实边界与旁注
- **画布落库的 CORS 拦截是 dev 拓扑工件·非产品缺陷**：任务指定跨源 dev(vite 5232→DataCore 4032 直连)下 DataCore CORS 只放 GET/HEAD/POST(app.ts:527)→PUT 被拦→编辑丢失。影响全站 19 个 PUT/PATCH/DELETE·**非 OntoFlow 独有**·生产走 nginx 同源无此问题(O2 起同源网关 5300 复刻生产拓扑证实真落库)。→ 归"dev 拓扑/CORS"债·不算 OntoFlow BLOCK。
- **真值分层**：readiness/画布持久化/发布建类型=真后端真值；发布面板类型链路=仅 MSW"能看"·真后端下坏(B4)；scaffold=真调用但蓝图空转(mock/真都无落库·B2)；inference=前端写都没有(B3)。

## 建议 fix-WO（交 OntoFlow dev·P0→P1）
- **P0 B1**：注册 feature.data-builder 到 FEATURE_REGISTRY + 路由挂 requireFeature（关→404）。
- **P0 B2**：scaffold apply——buildScaffold 蓝图经 Action 门控真落库(seedViewConfigs/scene-entries/agents 泛化)·发布后应用真产可查产物。
- **P1 B3**：前端补「推演」入口——消费后端 /:id/inference·Δ 输入+前后对比 UI。
- **P1 B4**：修 WfPublishResult 契约对齐真后端 string[]（或后端返 {typeKey}[]）+ MSW handler 与真后端同形 + f41 校验类型值（堵"绿测试≠能用"）。
