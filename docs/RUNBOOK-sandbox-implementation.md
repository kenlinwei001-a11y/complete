# 实施手册 · 推演沙盘（5 增量 · 每步怎么做 / 前后端怎么测 / 怎么回退）

> 受众：实现 agent。**照增量顺序逐个领，不要跳、不要并 UI 提前。** 每增量自带"做什么 / 后端测 / 前端测 / 过哪些门 / 完成定义 / 回退"。任一门红 = 不合并。
> 总纪律（来自 `ARCH-sandbox-landing-discipline.md`）：**本体先行 → CLI 操作先行 → surface 既有闭包 → 引擎 → UI 最后**；entitlement 暗发、additive-only、reuse-first、gates 全绿才合。
> 配套：设计=`PRD-simulation-sandbox.md`、数据=`逐图分析`、纪律=`ARCH-sandbox-landing-discipline.md`、本文=怎么安全地落。

---

## 0. 总则（每增量都适用）

- **暗发**：沙盘是 entitlement feature。`apps/datacore/src/features.ts FEATURE_REGISTRY` 加 `{ key: "sim.sandbox", defaultOn: false }`（agentcore 同步 `features/gate.ts`）。关 = 所有 `/a/v1/sim/*`、`/b/v1/sim/*`、前端入口 **404 FEATURE_NOT_FOUND**（先于 authz，R3）。**现有租户/流程零影响。**
- **Additive-only**：只新增对象/端点/迁移；不改既有 schema 字段语义；`Action` 双态默认 `sandbox=false`=现状（R6 字节不变）。
- **Reuse-first**：复用 `simclock.ts`/`generic_inference`/`asOfEpoch`/`slice-planner`/`RadarChart`/`PropagationTimeline`/`useLiveSolver`；UI 是新 route + 既有页 additive 增强，**不删旧路径**。
- **每增量过门**：`pnpm -r build && pnpm -r test && pnpm gates` 全绿才合；外加该增量的命名测试门。
- **每增量回写本体**：改了链路/事件/对象/门 → 同 PR 回写 `docs/SYSTEM-ONTOLOGY.md`，`pnpm ontology:check` 绿。
- **分支**：只推 `claude/vigilant-knuth-b1nmxn`；模型标识不进提交物。

---

## 增量 0 · 本体先行（纯图纸，零代码）

**目标**：先把沙盘的"接线"写进系统本体，后面每行代码都对图施工。

**做什么**（改 `docs/SYSTEM-ONTOLOGY.md`）：
1. §2 新增对象类型：`SimSession`、`SimCheckpoint`、`PropagationRule`、`SimCertification`、`SandboxViewConfig`（各一句话 + 预留锚点）。
2. §3 新增沙盘链路：`本体世界态 --init/范围预检--> SimSession --tick--> 传导(系数+延迟沿link) ⊕ 沙盘态Action --> 状态更新 --checkpoint/branch--> 多时间线 --compare--> KPI`；`沙盘结论 --采纳--> R4 ActionDraft`；`沙盘GapReport --> runGrowthLoop(倒序生长)`。
3. §4 新增事件：`sim.session_created/ticked/acted/checkpointed/branched/goal_evaluated/certified`。
4. §5 标注复用不变量：R6（确定性仿真）/R4（采纳经审批）/R13（每tick溯源）/R14（去行业锁死）/R2/R3/R16（正序运作相）。
5. §7 登记新门：`sim-readiness:check`。
6. §8 登记新断点 **G-11「有仿真积木无交互沙盘；沙盘若硬编码行业则违 R14」**，本手册即其修法。

**后端测**：无代码。**前端测**：无。
**门**：`pnpm ontology:check` 绿；3 份 PRD 的《本体引用与影响》与本体一致（`prd:ontology`/`meta:sync`）。
**完成定义**：本体含 5 新对象 + 沙盘链路 + sim 事件 + G-11；`ontology:check` 绿。
**回退**：`git revert` 该 doc commit（纯文档，零风险）。

---

## 增量 1 · CLI 操作先行（后端 + CLI，**无 UI**）

**目标**：CLI 能**无头跑通一遍沙盘**（init→tick→act→checkpoint→rollback→branch→compare），证明操作层成立。

**做什么**：
1. **契约**（`packages/contracts`）：`SimSessionSchema`/`SimCheckpointSchema`/`PropagationRuleSchema`/`SandboxViewConfigSchema`（zod）。
2. **后端**（新 `apps/datacore/src/simsession/`）：
   - `service.ts`：SimSession 状态机（init 读租户本体按 scope 裁世界态；tick 调 `simclock` 推进 + 传导桩[增量3 实现真传导，本增量先恒等]；act 改 worldState；checkpoint/rollback/branch 存取快照[复用 `asOfEpoch`]；compare 跨 timeline 对齐 KPI）。
   - 端点：`POST /a/v1/sim/sessions`、`/:id/{tick,act,checkpoint,rollback,branch,goals}`、`GET /:id/{world,compare}`。**全挂 `sim.sandbox` entitlement（关=404）**。
   - **仓储双实现**：`migrations/026_sim_sessions.sql` + `repo/pg.ts` + `repo/memory.ts` + `repo.ts` 接口（四处，纪律）。
3. **CLI 对等（R15）**：`packages/contracts/src/operation-intent.ts OPERATION_CATALOG` 加 `sim` op（关键词/端点/`cliCommand:"sim"`）；`scripts/platform-cli.mjs` 加 `cmdSim`（`sim init/tick/act/branch/compare`，经同一 REST + R3/R4/事件，不本地直写）。
4. **AI 指挥台接线（最小）**：AgentCore 注册沙盘 MCP 工具 `sim.*`（path A/B 可调），本增量先透传到 `/a/v1/sim/*`。

**后端测**（`apps/datacore/test/sim-session.test.ts` + 命名门 `sim:check`）：
- 状态机：init→tick→act→checkpoint→rollback→branch 全路径；**确定性 R6**：同基准+范围+操作序列重跑字节一致。
- 隔离：跨租户 403/404；`sim.sandbox` 关时全 404。
- curl 实跑：起 datacore（`SEED_DEMO=1`），curl 全端点贴响应。
**前端测**：本增量无 UI → **CLI 即验收**：`platform sim init <pkg> && platform sim tick && platform sim act ... && platform sim compare` 无头跑通一遍，贴输出。
**门**：`sim:check`（新 vitest 门）+ `cli-parity:check`（sim op 有 cliCommand）+ `ontology:check` + `pnpm -r test`。
**完成定义（FDE）**：**以用户身份用 CLI 跑通一遍沙盘**（贴 CLI 输出）；同操作序列重跑字节一致；gates 绿。
**回退**：`sim.sandbox` entitlement 关（瞬时，端点即 404）→ revert commit → `migrations/026` 配 `down`（drop table，additive 可逆）。

---

## 增量 2 · 就绪认证 = surface 既有闭包（后端 + CLI，**不写新校验逻辑**）

**目标**：把既有 `ClosureReport`/`chain:check`/A18 相位**投影**成 L0-L4 + 三件套门 + 三维评分；**不发明新判定**。

**做什么**：
1. `apps/datacore/src/simsession/certification.ts`：纯函数从既有产物算——
   - **三件套门**：本体须有 派生/传导规则 ∧ 可执行动作 ∧ 图谱查询/状态变量（缺则不可进入推演）。
   - **L0-L4**：Invalid→Configured→Runnable→Verified(Trial Tick 通过)→Certified(Fanout/Writeback/Observability)。**Trial Tick = 空跑 1 tick 触发规则验证可跑**（复用 `verifyBuild` 思路）。
   - **三维评分**（结构/知识/行为）+ Health/Trust 雷达维度：从 `ClosureReport` + 对象/规则/动作聚合算（确定性 R6）。
2. 端点 `GET /a/v1/sim/sessions/:id/certification`；CLI `platform sim cert <id>`。
3. **复用 G-9 的 `ScenarioOntogenesisRun`/三环**（已 P1+P2 落）——不另起一套就绪逻辑，`meta:sync` 门防漂。

**后端测**（`certification.test.ts`）：完整本体→认证 L4；删一件套→三件套门 FAIL + 显式缺件码；确定性。
**前端测**：无 UI → CLI `platform sim cert` 打印 L0-L4 + 缺口，贴输出。
**门**：`chain:check`（扩沙盘依赖维）+ `ontogenesis:check`（三环复用）+ 新 `sim-readiness:check` + 既有。
**完成定义**：认证从既有闭包算出 L0-L4；缺件本体**诚实 FAIL**（非静默绿）；CLI 可见。
**回退**：纯只读端点 + 纯函数 → revert 即可，无状态、无迁移。

---

## 增量 3 · 时序传导引擎（后端；接「规则即引用」）

**目标**：状态变量沿本体 link 按 **系数 + 延迟** 逐 tick 传导；系数=`rule.params`（可编辑，改即推演变）。

**做什么**：
1. `ontology-core.ts` 旁路加 `propagate(session, ticks)`：拓扑序 + 延迟队列；环用 `combine`(max/sum/last) + 阻尼收敛；**确定性 R6**。
2. `PropagationRule`（派生扩展）：`{sourceStateVar, viaLinkType, direction, targetStateVar, coefficient(param), delayTicks(param), combine}`；系数/延迟存 `rule.params`（接 `PRD-rules-as-references`，可编辑）。
3. 增量1 的 tick 桩换成真 `propagate`。

**后端测**（`propagation.test.ts`）：
- 传导：风险 SUP→Factory→Order 按系数+延迟逐 tick，字节一致（R6）。
- **改规则即改传导**：编辑某 PropagationRule 系数 0.85→0.6 → 同沙盘传导结果随之变。
- 环收敛：有环时阻尼收敛不发散。
- **去行业锁死**：引擎只认 类型/link/状态变量，grep 不到行业实体名（`debattery:check` 沙盘维）。
**前端测**：无 UI → CLI `platform sim tick` 显传导；`platform rule edit <key> --coef 0.6` 后重跑显变化。
**门**：`ontology:check` + `debattery:check`（沙盘维）+ `propagation:check`(新) + 既有。
**完成定义**：传导在 ≥1 租户本体跑通；系数可编辑改结果；确定性。
**回退**：传导 opt-in（无 PropagationRule 则不触发，退回增量1 恒等 tick）→ revert。

---

## 增量 4 · UI（**最后**，复用组件 + 新 route + entitlement 暗发）

**目标**：5 屏 UI（数据管道建模/逐实体/就绪认证/沙盘初始化/沙盘运行），**配置驱动、行业无关**。

**做什么**：
1. **配置**：`SandboxViewConfig` + `GET /a/v1/sim/view-config`（按租户/本体）。
2. **前端**（`apps/frontend-shell/src/views/sim/`）：
   - 新 route `/v/sim-sandbox`（entitlement `sim.sandbox` 关→隐藏/404）。
   - `SandboxView`（拓扑+时间轴+指挥台）**复用** `RadarChart`(就绪雷达改维)/`PropagationTimeline`(进化为tick轴)/`PmDag`/`useLiveSolver`。
   - `ModelingPage` **additive 增强**：左加"数据源面板"(列「连接器与上传」RawDataset 分组+provenance+覆盖度) + 管道视图——**不删既有 dataset 列表**。
   - 就绪认证面板 + 初始化向导 + AI 指挥台（**复用对话坞** QueryDock + `sim.*` MCP 工具）。
   - **零业务常数**：节点/边/着色/动作/KPI 全从 `SandboxViewConfig` 渲染。
   - UI 原型参照 `竞品对标方案包/UI原型/*.html`（可经"原型导入正门"反推 schema）。
3. SSE：`sim.*` 事件 → 前端实时刷新节点色/传导动画/KPI/时间轴。

**后端测**：view-config 端点 + SSE（vitest）。
**前端测（门B 真浏览器，复用 `ui-smoke` 范式）**：
- 新 `scripts/ui-smoke-sandbox.mjs`（仿 `ui-smoke-ontogenesis.mjs`）：chromium(`/opt/pw-browsers`) + 真后端 → 打开沙盘 → 点"推进 tick" → 断言节点色/KPI 变；无 chromium→SKIP(exit0)。`pnpm ui-smoke:sandbox`。
- **两行业断言（证 R14）**：同一前端，喂租户A(供应链)与租户B(另一行业)的 `SandboxViewConfig` 各跑一遍，都渲染+tick 成功；**grep 前端 sandbox 代码无行业实体名**。
- 组件测：`SandboxView` 从 mock config 渲染（vitest + RTL），node 数/边数/着色断言。
**门**：`debattery:check`（前端沙盘维零业务常数）+ `ui-smoke:sandbox` + `cockpit-widgets:check`（若动 DASH_LAYOUT）+ 前端 25+ 测试。
**完成定义（FDE 亲手）**：**起前端+真后端，以用户身份打开沙盘点一遍**（截图）：tick→节点变色→KPI 变；**两行业各跑通**（截图）；entitlement 关→入口消失。
**回退**：① entitlement `sim.sandbox` 关（**瞬时**，入口即消失，无需部署）② 新 route 删除 ③ ModelingPage 增强在子 flag 后或纯 additive（旧列表保留）→ 旧页不受影响。

---

## 测试策略总览（前后端 + 确定性 + 多行业）

| 层 | 工具 | 怎么测 |
|---|---|---|
| 后端单元 | vitest（`pnpm -r test`） | 每增量命名门 `sim:check`/`propagation:check`/`sim-readiness:check`（仿 `slice-planner:check` 范式） |
| 后端实跑 | curl + CLI | 起 datacore(`SEED_DEMO=1`)，curl 端点；`platform sim ...` 无头跑通 |
| 确定性 R6 | vitest | 同基准+范围+操作序列重跑字节一致；分支独立 |
| 前端组件 | vitest + RTL | SandboxView 从 config 渲染断言 |
| 前端 E2E（门B） | Playwright(`/opt/pw-browsers` chromium) | `ui-smoke:sandbox` 真浏览器+真后端，点 tick 断言变化；无 chromium→SKIP |
| 多行业（R14） | ui-smoke + grep | 两租户 config 各跑通 + `debattery:check` grep 无行业实体名 |
| 全链 | `e2e:realbackend` | `scripts/run-l4-realbackend.sh` 范式扩沙盘 |

---

## 回退策略总览（每层都可退）

1. **Entitlement flag（瞬时、零部署）**：`sim.sandbox` 关 → 所有沙盘端点/UI 入口 404/消失 → **回到沙盘不存在的稳定态**。这是第一道、最快的回退。
2. **Additive 迁移可逆**：`migrations/026_sim_sessions.sql` 配 `down`(drop)；新表不影响既有。
3. **Reuse-not-rewrite**：UI 是新 route + 既有页 additive 增强，**旧路径(ProjectSimView/ModelingPage 旧列表)原样保留** → 退回旧 UI 零成本。
4. **Action 双态向后兼容**：默认 `sandbox=false`=现状 → 退回即现有行为。
5. **逐增量 revert**：每增量独立 PR、独立可发 → 出问题只 revert 该增量，不牵连前面已稳定的增量。
6. **棘轮基线**：`cli-parity-baseline`/closure baseline 只增不减 → 回退后基线不污染。

---

## 每增量验收清单（合并前逐条勾）

- [ ] 本体已回写（§2/§3/§4/§7/§8），`ontology:check` 绿
- [ ] 新能力已注册 CLI（`OPERATION_CATALOG` + cliCommand），`cli-parity:check` 绿
- [ ] 该增量命名测试门绿（`sim:check`/`propagation:check`/`sim-readiness:check`/`ui-smoke:sandbox`）
- [ ] `pnpm -r build && pnpm -r test && pnpm gates` 全绿
- [ ] 沙盘依赖未引入管道断（`chain:check` 绿）
- [ ] 零业务常数（`debattery:check` 沙盘维绿）
- [ ] entitlement 暗发验证（关=404/入口消失）
- [ ] **FDE 亲手验**：以用户身份（CLI 或 UI）真跑一遍，贴证据（CLI 输出/截图）
- [ ] 汇报含"距北极星还差什么 + 哪些是 happy-path"
- [ ] 回退路径已验证（flag 关 / revert / 旧路径仍在）

---

## 增量依赖与并行

```
增量0(本体) ──> 增量1(CLI操作) ──> 增量2(就绪认证) ──┐
                      └──────────> 增量3(传导引擎) ──┴──> 增量4(UI,最后)
```
- 增量2、3 可在增量1 后**并行**（一个 surface 闭包、一个做引擎，互不依赖）。
- 增量4（UI）**必须最后**，且暗发——前面都是 additive 后端+CLI，系统每步停在稳定态。

> 北极星：用户从 CLI 或 UI（任意行业租户）开沙盘→tick→传导→分支→对比，全程配置驱动、确定性、可回退；历史不变量一条不破，每条有门兜底。
