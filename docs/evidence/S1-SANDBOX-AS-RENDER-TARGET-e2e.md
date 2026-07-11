# S1 · WO-SANDBOX-AS-RENDER-TARGET 真跑 E2E 证据（2026-07-11 · dev3 · MVP=shock 短程+状态级结论）

真起双服务（datacore:4001 内存 SEED_DEMO=1 + agentcore:4002·真 orchestrator·真确定性分类器），
脚本 `s1-e2e.mjs` 经**真 HTTP 正门**逐值断言（铁律 0.4·非单测冒充·真 NL 命中真 orchestrator 路由）。

## 环境说明（诚实边界）
- 本环境**无 LLM provider**（内存模式）→ 多候选 classify 的 LLM 消歧不可用。用 `QOS_CLASSIFY_FUSE=1`（意图内置
  确定性⊕LLM 融合精度机制）+ 低 tau 让**确定性词法分类器**（`classify-preview` 实测把 `sim.shock_whatif` 判为
  top·score 0.24）路由到 Path A，演示渲染端到端。**生产**由 LLM 或兄弟单A（classify 精度）决定命中——属 WO §1.3/§3.3
  明示依赖，非本 S1 渲染机制。渲染机制本身由集成测（scripted 分类·`sim-render-hook.test.ts` 3 测）+ 本 E2E 双证。

## 验收逐条 ↔ 真跑输出

### §5.1a 人机对话 E2E · shock 型（真渲染进沙盘·逐值对照）
提交 NL「常州二线停3周，交付缺口多大？」+ selectedObjects=[{Base:常州二线}] → 真 orchestrator classify 命中
`sim.shock_whatif` → Path A → `maybeRenderSandbox` 钩子 → 归一 SimulationRequest → sandbox_render 答案块：
```
✓ shock 任务 COMPLETED
✓ 含 sandbox_render 答案块（NL 真命中 sim.shock_whatif → 渲染进沙盘）
✓ source=dialogue          ← 五触发归一·对话侧
✓ targetView=sim-sandbox
✓ scope 含 常州二线 {"objectType":"Base","objectIds":["常州二线"]}   ← 从 selectedObjects 归一
✓ scenario[0]=shock
✓ compareBaseline=false     ← MVP shock 短程（双跑 ImpactAssessment 求解器维待 S6）
✓ headline 非空: 已就「常州二线·load」建立 14 tick 短程推演（当前态演化）——逐 tick 出状态级结论。
```
（前端：sandbox_render 块 → 「打开推演沙盘」经 scenarioPreset 通道 → SandboxView 渲染器·由 `sandbox-render-block.test.tsx`
2 测锁定块渲染+preset 落库+registerRenderer 解析；SandboxView 消费 preset 按对象裁剪起跑。）

### §2.1/§2.5 hold 型 · 诚实 DEFERRED（MVP 边界·S6 门·绝不假跑）
提交「成品库存水位保持5000，未来60天利好利空？」→ 命中 `sim.hold_whatif` → DEFERRED：
```
✓ hold 不渲染沙盘（诚实·无 sandbox_render 块）
✓ hold 诚实答"时序接地建设中": ⏳「hold」类时序推演…需时序接地配套（外生驱动·守恒·overlay）——由 WO-SANDBOX-TEMPORAL-GROUNDING（S6）提供…
```
→ 兑现"hold/60天/ImpactAssessment 求解器维待 S6 才上线，中间期诚实答'时序接地建设中'+工单"（KILL-MOCK-RED）。

### §5.6 回退演练（真跑·暗发关闸）
关 `sim.sandbox_render`（真 JWT·权威 entitlement 写·等 60s agentcore 缓存 TTL 过期）→ 同问句重跑：
```
✓ 回退演练：关闸→无 sandbox_render（暗发关=能力不存在·回落既有路径·旧路径未删 RL9）
```

## 其余验收覆盖
- **§5.5 R6 确定性**：装配器 `sim-request.ts` 同输入字节一致（`sim-request.test.ts` 9 单测·含 R6 双跑）。
- **§5.2 配套缺诚实**：`sandboxConfigPrecheck`（复用 S0 registry-snapshot + 意图声明配套）缺→gap 文本不渲染静止沙盘（钩子集成测覆盖机制；真 gap 需租户声明配套·R14 租户数据）。
- **§5.7 入口收敛**：沙盘已由 WO-NAV-SANDBOX 降级（非一级项·并入推演组）+ sim.sandbox defaultOff 默认隐藏 + sandbox_render 答案路径（从推演答案→沙盘）；独立路由 `/v/sim-sandbox` 保留为工作台副态（WO §3.2 明确保留·不加 tombstone）。

## 明确未落（诚实·后续增量）
- **§5.3 多轮追问→分支（simBranch）**："那外协呢?"恢复场景 + A/B 对比——本 MVP 未实现（渲染核心先行）。
- **五触发的另 3 触发（场景卡/告警/工作台）→ SimulationRequest 完全归一**：dialogue 已归一；what-if URL 通道保留、场景卡 presetContext 在场，完全折叠为 SimulationRequest 属后续。

## 单测/门
- agentcore 718 测零回归（加 4 sim 意图后）· 前端 553 测零回归（加渲染器后）· 契约装配器 9 测 · 钩子 3 集成测 · 前端块 2 测。
- sim:check / genuine-sim:check / ontogenesis-runtime:check / system-ontology / slices / prd:check 绿。
