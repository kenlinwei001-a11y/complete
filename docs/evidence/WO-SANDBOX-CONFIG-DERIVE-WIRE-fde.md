# FDE 证据 · WO-SANDBOX-CONFIG-DERIVE-WIRE（Dev-1·活路径竞态修复）

CONFIG-DERIVE 的 `deriveSandboxConfigNeeds` 派生逻辑已 DONE 且正确，但**活 POST 路径**有竞态：派生的沙盘配套 need（propagation_rule/state_var）落空、不抵达 S0 覆盖报告。本 WO 治竞态根因（非 seed 绕竞态·"绿测试≠活路径"）。

## 铁律 0 · 本体引用与影响
- 链路：`POST /api/v1/queries` → `submitQuery`(`setImmediate(runPipeline)`) → `runPipelineInner`（classification 先落 → RG sideband 后 upsert）→ 后台 `startPreAnalysis`（`server.ts`）轮询 → `preAnalyzeQuery` → `deriveSandboxConfigNeeds`。
- 断点：§8 新登 **G-SANDBOX-DERIVE-RACE ✅ 已闭**。§3 沙盘配套派生活路径竞态闭合。
- 不变量：R6（等待只改**何时读**·不改报告内容·`generatedAt` 注入·双跑一致）；KILL-MOCK-RED（无传导语义→零派生·无假阳）。
- 暗发闸：`growth.sandbox_config_derive`（双注册·已在 enforced parity 列表）·关闸 = S0 字节一致。
- 门：`genuine-sim:check`、`feature-parity:check`、`requirement-graph:check`、`ontology-writeback:check`。

## 根因诊断（竞态）
1. `submitQuery` 插 task 后 `setImmediate(runPipeline)`（`orchestrator.ts:535`）即返回。
2. `runPipelineInner` 内 classification **先** patch（`:707`），RG **后** 由 `buildRequirementGraphSideband` upsert（`:713→:797`·`QOS_REQUIREMENT_GRAPH=1` 门控）。
3. 后台 `startPreAnalysis`（在 `server.ts`·非 WO 所述 orchestrator.ts）只轮询 `task.classification`。classification 一落它就醒 → 调 `preAnalyzeQuery` → `requirementGraphs.getByTaskId` 读**空** → 派生 need 丢失 → gap 不抵达 live 报告。旧 dev 用 T6 seed RG 掩盖（假绿）。

## 修复（时序根因·additive·可回退·全在允许的 pre-analyze.ts）
- 新 `waitForRequirementGraph(deps, tenantId, taskId)`：`sandboxConfigDeriveEnabled` 时，预分析**自己等待 sideband RG 就绪**（不依赖外部调度顺序）。RG 已在→立返；`QOS_REQUIREMENT_GRAPH=1` 且缺→有界轮询直至就绪；task 到终态仍无 RG（短路管线不建 RG·或 QOS 关）→ RG 永不来→停并返 `undefined`（空派生·零假阳）。
- `PreAnalyzeDeps.config` Pick 加 `QOS_REQUIREMENT_GRAPH`。**无需改 `server.ts`**（已传全 `deps.config`）。**未碰 orchestrator.ts / maybeRenderSandbox / databuilder / frontend / datacore sim**——与并行 SHOCK-NO-FLOOR agent 零文件域冲突。

## green→red 齿（test/sandbox-config-derive-wire.test.ts · 3/3 绿·真走活 POST 路径）
真起 HTTP stub 扮 DataCore（ontology-graph + registry-snapshot），并**在 ontology-graph 端点注入 500ms 真网络时延**使 RG upsert 确定性落在预分析首读**之后**——让生产竞态在测试中可观测（镜像真 OBO REST 时延·无 RG 预 seed）。
- 齿①：真 POST 传导问句（设备停机…销售订单延期）→ 派生 `pr_Base__base_supplies_order__Order` MISSING/WARNING + `Base.load` EXISTS / `Order.load` MISSING 落预分析报告·GrowthTicket 带 `[sandbox-config:*]` 锚开票。
- 齿②：纯罗列问句 → 无 propagation_rule/state_var 条目·无票（无假阳）。
- 齿③ R6：同问句双跑（活路径各自建 RG）→ 派生 need 键一致。
- **红牙验证**：临时把 `waitForRequirementGraph` 退回修前单读 → 齿①失败（`kinds.has("propagation_rule")` false·派生 need 缺席）→ 恢复即绿。确认齿咬真竞态·非 seed 绕过。

## 门 / 测试
- 单文件 3/3；回归 `sandbox-config-derive`/`pre-analyze`/`pre-analysis-endpoint`/`requirement-graph-*`/`execution-planner-serve` 全绿。
- `pnpm --filter agentcore build`：绿。agentcore 全量：见收口（SHOCK+CONFIG-DERIVE 合并态一次干净跑）。
- `genuine-sim:check`/`feature-parity:check`/`requirement-graph:check`/`ontology-writeback:check` exit 0·`ontology-slices --check` exit 0。

## 诚实边界
- WO 定位 `startPreAnalysis` 在 orchestrator.ts·实际在 server.ts。更干净的修在允许的 pre-analyze.ts（WO 自荐"预分析内部自等 RG"），故未碰 server.ts/orchestrator.ts。
- orchestrator.ts `setImmediate` ~1104/1118（澄清续跑）非竞态源·未动。无超时序范围的改动。
