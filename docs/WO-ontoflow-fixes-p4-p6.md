# WO · OntoFlow P4/P5/P6 fix（审核方真跑复验 BLOCK 回单）

> 审核方（独立复验方·主线 `claude/vigilant-knuth-b1nmxn`）2026-07-10 对本分支 P4/P5/P6 三段真跑复验（2 个 worktree 隔离代理·真起服务非 MSW·真浏览器逐值对照后端·真 HTTP 黑盒·KILL-MOCK-RED）。
> **总裁决：核心地基真·非造假**（准备度 readiness / 画布 WorkflowCanvas 真编辑真落后端 / 发布真产本体 / 通用推演 generic-inference 后端真算，均真后端真值·逐值证·frontend 108 测全绿）。**但「发布→生成应用→推演」决策价值尾段断** → 作为「完成交付」BLOCK。以下 4 单修复后 → 三段可判 DONE。
> 完整裁决与逐值证据：主线 `docs/REVIEW-ontoflow-p4-p6-verdict.md`。

## WO-OF-01（P0）feature.data-builder 门控（违 Entitlement 铁律）
- **问题（真跑）**：`feature.data-builder` 根本不存在——`apps/datacore/src/features.ts:12-69` FEATURE_REGISTRY 无此键；`/a/v1/ontology-workflows/*` 路由 `apps/datacore/src/app.ts:1337-1365` 无任何 `requireFeature`/`requireFeatureTag`；`apps/frontend-shell/src/api/endpoints.ts:582` 注释"feature.data-builder 门控"是空头支票。端点恒 200/201 可达、`PUT features {data-builder:false}` → `VALIDATION_ERROR unknown feature key`。违 PRD §4/§9.3「关→404 FEATURE_NOT_FOUND」+ CLAUDE.md **Entitlement 先于 authz 铁律**。
- **改**：注册 `data-builder`（或 `ontology-workflow`）到 FEATURE_REGISTRY；`/a/v1/ontology-workflows/*` 全部路由挂 `requireFeature`；关 → 404 FEATURE_NOT_FOUND。
- **验收（真跑）**：feature 关 → 端点 404 FEATURE_NOT_FOUND + 前端诚实降级；开 → 可用。additive·暗发 defaultOn 按平台约定。

## WO-OF-02（P0）scaffold「生成应用」真落库（现死路·零产物）
- **问题（真跑·前后端双证）**：`apps/datacore/src/pipeline/scaffold.ts:55` `buildScaffold` 纯函数**零 repo 写入**；`service.ts:162-165` 只返计算蓝图。真跑 scaffold 后 `/b/v1/agents` 仍 2（无 agent_BOrder）、`/b/v1/scene-entries` 仍 9（无 scene_BOrder）、view-config 无新视图——**所列产物指向不存在的东西·用户拿到 JSON 计划但应用里查不到任何产物**。PRD §8.1「生成应用（复用 seedViewConfigs 泛化）」未兑现。
- **改**：scaffold 蓝图经 Action 门控**真落库**（视图 seedViewConfigs / scene-entries / 默认 Agent / 场景包 / 求解器绑定 泛化持久化）；发布后应用真产可查产物。
- **验收（真跑真浏览器）**：scaffold 后去 `/b/v1/agents`、`/b/v1/scene-entries`、view-config 真查到新产物（非只回 JSON），前端对应页真渲染新视图/场景入口·逐值对照后端。

## WO-OF-03（P1）通用推演前端入口（后端真算·UI 缺席）
- **问题（真跑）**：后端 `apps/datacore/src/pipeline/generic-inference.ts:168-227` 真算（Δqty→四跳沿派生/link/二跳真重算·确定性·审核方已逐值验），**但前端无入口**——动作栏仅 6 键（校验/预览/提升/准备度/发布/生成应用）无「推演」；`endpoints.ts` 无 inference 端点；`packages/contracts/src/pipeline.ts:164` 明写"generic-inference…前端不消费"。PRD §8.2「发布后即可用推演」经 UI 未达成。
- **改**：前端加「推演」入口——消费 `POST /a/v1/ontology-workflows/:id/inference`；某属性 Δ 输入 + 受影响对象**前后对比 UI**（复用主线沙盘前后对比视觉语言）。
- **验收（真跑真浏览器）**：前端施加 Δ → 真看到受影响对象前后对比·**逐值对照后端 generic-inference 真值**。

## WO-OF-04（P1）发布面板契约对齐（堵"绿测试≠能用"）
- **问题（真跑·用户可见 BUG）**：发布成功（后端真建类型），但结果面板显示「类型：、」「链路：—」**空白**。根因契约漂移：前端 `WfPublishResult`（`endpoints.ts:608`）期望 `types:{typeKey}[]`，真后端返 `string[]`（`service.ts:140,152`），`t.typeKey` 落空。**被 MSW mock 掩盖**（`handlers.ts:970` 返对象形正好匹配前端）+ `f41.ontoflow-databuilder.test` 只断言含"sliceKey"、**不校验类型值** → 教科书级「绿测试≠能用 / mock 偏离真后端」（违 KILL-MOCK-RED）。
- **改**：契约对齐（前端读 `string[]` 或后端返 `{typeKey}[]`·择一统一）；MSW handler 与真后端**同形**；f41 **校验类型值**（断言真类型名·非只 sliceKey）。
- **验收（真跑真浏览器）**：真后端发布 → 面板类型/链路真显示真类型名；MSW 与真后端同形；f41 校验类型值真断言。

---
**纪律**：每单真跑真浏览器逐值对照后端（KILL-MOCK-RED·钉死）·additive·门控暗发·旧路径保留。修复推 BUILT 后，审核方将在独立 worktree 真起服务+真浏览器逐值复验 → PASS 判 DONE / 未闭合再 BLOCK。
> 旁注（非 BLOCK）：跨源 dev 拓扑（vite→DataCore 直连）下 DataCore CORS 只放 GET/HEAD/POST（`app.ts:527`）→ 全站 19 个 PUT/PATCH/DELETE 被拦（非 OntoFlow 独有·生产走 nginx 同源无此问题）。若要 dev 态直连可写，另开 CORS 债单。
