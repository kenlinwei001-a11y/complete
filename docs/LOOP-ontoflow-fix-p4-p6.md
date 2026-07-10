# LOOP 提示词 · OntoFlow 决策价值尾段 4 BLOCK 闭合（发给 Dev）

分支：`claude/parallel-agent-tasks-d3xmzn`（在此之上继续，勿并 main，勿重做已绿的 P4/P5/P6 核心）。
依据：`docs/WO-ontoflow-fixes-p4-p6.md`（审核方真跑复验 4 BLOCK 回单）。
当前基线（隔离重跑已复核）：build 干净 · datacore 281 · agentcore 197 · frontend 108 · contracts 过 · parity 129/129。

## 任务
逐单闭合 WO-OF-01..04，把「发布→生成应用→推演」决策价值链跑通。**一单一提交**，additive，旧路径保留：

1. **WO-OF-01（P0）feature.data-builder 门控**
   - `features.ts` FEATURE_REGISTRY 注册 `data-builder`（暗发 defaultOn 按平台约定）；`/a/v1/ontology-workflows/*` 全路由挂 `requireFeature`。
   - 收：feature 关 → 端点 404 `FEATURE_NOT_FOUND` + 前端诚实降级；开 → 可用。

2. **WO-OF-02（P0）scaffold 真落库**
   - `scaffold.ts` 蓝图经 Action 门控真持久化（视图 seedViewConfigs / scene-entries / 默认 Agent / 场景包 / 求解器绑定，泛化自 seedViewConfigs）。
   - 收：scaffold 后 `/b/v1/agents`、`/b/v1/scene-entries`、view-config **真查到新产物**，前端对应页真渲染，逐值对照后端。

3. **WO-OF-03（P1）通用推演前端入口**
   - 前端动作栏加「推演」→ 消费 `POST /a/v1/ontology-workflows/:id/inference`；某属性 Δ 输入 + 受影响对象**前后对比 UI**（复用主线沙盘前后对比视觉语言）。
   - 收：前端施加 Δ → 真看到前后对比，逐值对照后端 generic-inference 真值。

4. **WO-OF-04（P1）发布面板契约对齐**
   - 前后端 `WfPublishResult` 统一（`types:string[]` ↔ `{typeKey}[]` 择一）；MSW handler 与真后端**同形**；`f41` **校验真类型名值**（非只断言 sliceKey）。
   - 收：真发布 → 面板显示真类型/链路名；MSW 与真后端同形。

## 纪律（钉死）
- **KILL-MOCK-RED**：每单真起服务、真浏览器、逐值对照真后端；禁止用 MSW/mock 形状掩盖真后端偏差（WO-OF-04 就是被 mock 掩盖的活教材）。
- **Entitlement 先于 authz**、tenant_id everywhere、no-secrets-echo、错误信封统一、contracts-only-shared、确定性（LLM mock）。
- 每单闭合即 `pnpm -r build && pnpm -r test` 全绿 + parity 129 + 该单回归锁；commit（一单一提交）后 `git push -u origin claude/parallel-agent-tasks-d3xmzn`。
- 4 单全绿 → 通知审核方（独立 worktree 真跑真浏览器逐值复验）判 DONE；未闭合再 BLOCK。

## 旁注（非本轮 BLOCK，可另开债单）
dev 态跨源直连下 DataCore CORS 只放 GET/HEAD/POST（`app.ts:527`）→ 19 个 PUT/PATCH/DELETE 被拦；生产走 nginx 同源无此问题。
