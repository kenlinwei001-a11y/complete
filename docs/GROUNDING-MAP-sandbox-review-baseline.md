# 推演沙盘 · 接地地图（评审基线 · 已对源码核验 · 读这份再读其余沙盘文档）

> 这是什么：我（架构评审 agent）在**通读分支全部文档 + 核验最新代码**后，把"图纸（我那 8 份沙盘设计文档）"与"地基（仓库真实代码/本体/门）"逐条对齐的**单一接地真相**。凡我设计文档与本表冲突，**以本表为准**（本表每条都引了源 `file:line` 或 `SYSTEM-ONTOLOGY.md` 行号）。
> 给实现 agent：这是 `HANDOFF` 阅读清单的**第 0 项**，先读。它告诉你"哪些是真的、哪些我之前写岔了、复用点的确切坐标在哪"。
> 给我自己：这是逐 PR 评审时手里的**核验基线**——评审项锚定的是本表的**真实门**，不是我设计文档里提议但尚不存在的门。

---

## §0 我通读了什么（诚实清单）

- ✅ 宪法层：`SYSTEM-ONTOLOGY.md`（§2 对象 / §3 链路 / §4 事件 / §5 不变量 R1–R16+R-一致 / §7 门 / §8 断点 G-1..G-10 / §10 系统自我域 11 域）、`OPERATING-MODEL.md`、`CLAUDE.md` 铁律 0。
- ✅ 代码地基：`ontology-core.ts recompute`、`solvers/risk.ts tensionSeries/counterfactualTimeline`、`simclock.ts`、`databuilder/{service.ts runStory, comprehend.ts, provisioners.ts, closure.ts}`、`synthetic/service.ts`、`connectors/registry.ts`、`agentcore workflow/checkpoint.ts`、前端 `views/sim/{RadarChart,PropagationTimeline,PmDag,useLiveSolver,shared,ProjectSimView}`。
- ✅ 门：`package.json` scripts（实际门清单见 §A.2）。
- ✅ 在建工作：场景卡发育闭环 G-9 P1+P2（已落）、守卫 bug 修复、S03/S06 断点修复。
- ⚠️ 诚实边界：本表的 `file:line` 取自核验当下；实现 agent 动手前若分支已前移，以 `git blame`/当前文件为准——坐标是路标不是契约。

---

## §A 已核验的宪法脊柱（直接引源 · 评审锚这里）

### A.1 不变量 R1–R17（`SYSTEM-ONTOLOGY.md` §5，行号实测）

| # | 不变量（摘） | 本体状态 |
|---|---|---|
| R1 | contracts-only-shared | ✅ 在表（:291） |
| R2 | tenant_id everywhere | ✅ 在表（:292） |
| R3 | entitlement 先于 authz → 404 FEATURE_NOT_FOUND | ✅ 在表（:293） |
| R4 | 真值写入经 Action 审批（含 selfApprove 留痕例外） | ✅ 在表（:294） |
| R5 | no-secrets-echo | ✅ 在表（:295） |
| R6 | 确定性（seed 字节一致 / 求解器同输入同输出 / 测试不依赖时钟随机） | ✅ 在表（:296） |
| R7 | 错误信封统一 | ✅ 在表（:297） |
| R8 | 认证（JWT / X-Debug-User / SERVICE_TOKEN） | ✅ 在表（:298） |
| R9 | 仓储双实现，新表四处同改 | ✅ 在表（:299） |
| R10 | D-29 数据流闭环（产出发事件、下游订阅） | ✅ 在表（:300） |
| R11 | 全链闭包（卡须 Intent+Plan+Solver+render 全接通） | ✅ 在表（:301，状态注"⚠ 16/20 违反"——**此状态注本身已被 G-9 P2 部分超越**，见 §D 校正） |
| R12 | 双向闭包（数据构建） | ✅ 在表（:302） |
| R13 | 结论可溯源（数字带出处/公式/规则/新鲜度） | ✅ 在表（:303） |
| R-一致 | 一个事实一个出处 | ✅ 在表（:304） |
| R14 | 应用层无业务常数（多租户配置驱动）→ `debattery:check` | ✅ 在表（:305） |
| R15 | CLI 对等 → `cli-parity:check` + OPERATION_CATALOG | ✅ 在表（:306） |
| R16 | 发育闭环（倒序发育⊕正序运作 · 三环 · PROVISIONAL→ADVISORY→GOVERNED）→ `ontogenesis:check` | ✅ 在表（:307） |
| **R17** | **决策单页（Decision-on-one-page）** | 🚧 **不在本体**（表止于 R16）。**= 提议，未立。** 增量 0 必须把它写进 §5 才生效。 |

> **评审硬判据**：实现 agent 在代码里引用 R17 前，PR 必须先在增量 0 把 R17 写进 `SYSTEM-ONTOLOGY.md §5` 且 `ontology:check` 绿。否则 RL1（本体先行）红。

### A.2 真实门清单（`package.json`，实测 · 这是评审项②的锚）

**`pnpm gates` 聚合门 = 11 个**（全绿才算过 gates；2026-06-24 由 10 增至 11，G-10 P1 加了 `rule-closure:check`）：
1. `check-system-ontology.mjs`（`ontology:check`）
2. `check-chain-closure.mjs`（`chain:check`）
3. `check-debattery.mjs`（`debattery:check` / R14）
4. `check-prd-ontology.mjs`（`prd:check`）
5. `check-prd-coverage.mjs`（仅在聚合里，无独立 `:check` 别名）
6. `check-meta-sync.mjs`（`meta:sync`）
7. `check-cli-parity.mjs`（`cli-parity:check` / R15）
8. `check-ontogenesis.mjs`（`ontogenesis:check` / R16）
9. `check-boundary-singlesource.mjs`（`boundary-singlesource:check`）
10. `check-cockpit-widgets.mjs`（`cockpit-widgets:check`）
11. `check-rule-closure.mjs`（`rule-closure:check` / G-10 规则即引用 P1，**2026-06-24 新增**：求解器/场景引用的规则码须有一等定义）

**聚合外的独立命名门**（CI 另跑，沙盘也要守）：`value-domain:check`、`slice-planner:check`、`floor-semantics:check`、`provisional-honesty:check`、`solver-sandbox:check`（均为 vitest）、`ui-smoke` + `ui-smoke:ontogenesis`（门B Playwright）、`cli:smoke`（bash）。

> **⚠️ 沙盘文档里出现的这些门"都还不存在"**——是增量产物，实现时须新建脚本 + 注册：
> - `sim:check`、`propagation:check`、`sim-readiness:check`、`ui-smoke:sandbox` → 全新，须写脚本并**并入 `pnpm gates` 聚合 + 回写本体 §7**。
> - `decision-page:check`（R17 配套门）→ 全新。
> - **`ia-single-source:check`（IA 文档提议）→ 与现存 `boundary-singlesource:check` 职责重叠！** 不得新造第二个单源门（违 RL3/RL10）。**裁决：扩展 `boundary-singlesource:check`**，不新建 `ia-single-source:check`。这是我自己文档里的一处分叉，本表纠正。

### A.3 断点 G-1…G-10（`SYSTEM-ONTOLOGY.md` §8，实测）

| 断点 | 状态（实测） |
|---|---|
| G-1 | ◐ 投影渲染 P2 已闭静态残面（卡 render 走 `solver_summary`） |
| G-3 | ◐ 大部修（P1+P2 SessionContext / presetContext 注入） |
| G-4 | ✅ 已修 |
| G-5 | ◐ 大部修（`debattery:check` 基线 0） |
| G-6 | ✅ 收口（三路 parser + FK 一致生成 + 数据模版） |
| G-7 | ◐ 部分修 |
| G-8 | ◐ 大部闭合（CHAIN+SHAPE+跨系统 scaffold + 工作流化执行） |
| G-9 | ◐ **P1+P2 已落**（多租户播种 + 确定性绑定 + grow 验证门 + 留痕 + 投影渲染 + 诚实门）——**这是沙盘卡→推演的直接地基** |
| G-10 | ◐ **P1 已落（2026-06-24, commit 261f29e by 另一 agent）**：`RuleEntry+params`(命名阈值) + 13 条规则一等化 + `SOLVER_RULE_REFS`(求解器→规则引用单一来源) + `rule-closure:check` 门 + 前端 RuleRef 显真定义。**沙盘传导系数现可经 `rule.params` 引用（已解锁，不再阻塞）**。待 P2：求解器改读 `rule.params` 去硬编码。⚠ **该 PR 漏回写本体**（§8 G-10 状态原仍写"⬜未修"、§7 缺 `rule-closure:check`）——本轮我已代为回写。 |
| **G-11** | 🚧 **不在本体**（§8 止于 G-10）。我沙盘文档把 G-11 当"沙盘整合层断点"引用——**= 提议，未立**。增量 0 须把 G-11 写进 §8。 |

> **评审硬判据**：G-10 P1 已落 → 沙盘"系数=可编辑规则引用"现**有 `rule.params` 真载体**可接（不再是画饼）；但 `PropagationRule` 仍需自己的结构字段(source/target/link)，系数/延迟可内联或引用 rule.params（详 `SPEC-sandbox-propagation-and-session §1.1`）。G-11 仍须在增量 0 入本体。

---

## §B 沙盘"站在肩上"的可复用基建（4 agent + 我核验 · file:line 是路标）

**前端（`apps/frontend-shell/src/views/sim/`）——基本不用重写：**

| 组件 | 复用做什么 | 锚点 |
|---|---|---|
| `RadarChart.tsx` | 就绪雷达 / 世界态健康度雷达（换 `RADAR_DIMS` 即换维度，纯展示） | `:22 radarPoint` `:35` |
| `PropagationTimeline.tsx` | tick 传导链可视化（仿写 `buildSandboxPropagation` 喂同组件） | `:45 buildPropagation` `:102` |
| `PmDag.tsx` | 传导依赖图 / 因果链 DAG（`step` 天然映射 tick——推进一 tick 点亮一层） | `:27` `:141 lit=step>=st` |
| `useLiveSolver.ts` | 拖滑杆即重算（debounce 300ms + AbortController 竞态，换 solverKey/args 即用） | `:19` |
| `shared.tsx` | `HeatStrip` 做 tick 热条；`useActionDraft` 做"沙盘结论→Action 草稿"（不直改数据） | `:22 HeatStrip` `:63 useActionDraft` |
| `ProjectSimView.tsx` | 单"假设页"结构母本（滑杆+DAG+求解器+采纳） | `:176 改参重算` `:418 <PmDag step>` `:947 buildDag` |

**后端——推进/传导雏形/倒序发育/数据闭环全有：**

| 组件 | 复用做什么 | 锚点 |
|---|---|---|
| `simclock.ts` | 沙盘 tick 引擎底座（tick=一模拟日，确定性可重放，有 `reset()`/`firedEvents`/TICKING 锁） | `:80 tick` `:175 tickOneDay` `:331 reset`；端点 `app.ts:3150-3180` |
| `ontology-core.ts recompute` | 一 tick 内**瞬时**跨对象前向闭包重算（dryRun+apply 不落库，R4） | `:341 recompute` `:367 dryRun` `:495 epoch` |
| `solvers/risk.ts tensionSeries` ★ | **逐 tick 系数×衰减传导的真雏形**：`pulse += amp×ps×(1−dist/pulseDecayDen)` + 脉冲窗 + mitigation 从第 tn tick 起削 eff | `:177 tensionSeries` `:195-197 衰减` |
| `solvers/risk.ts counterfactualTimeline` | 分支对比（do-nothing vs 干预）的现成双序列输出形状 | `:418` `:445-459 输出` |
| `databuilder/service.ts runStory` | 倒序发育发动机（7 步持久状态机：dry_build→scaffold→gap→publish→validate→inference→record，步级 checkpoint+resume） | `:323 buildStorySteps` `:496 runStoryWorkflow` `:753 runStory` |
| `databuilder/provisioners.ts analyzeGap` | "需要什么 vs 已有什么"统一 diff（13 need↔13 provisioner，新增 need 必注册否则门红） | `:35 注册表` `:106 analyzeGap` |
| `databuilder/closure.ts validateClosure` | 新建链路时复用闭包校验（挡接缝断） | `:19` |
| `synthetic/service.ts runJob` + `connectors/registry.ts` | 世界态由合成（确定性 industry×scale×seed 字节一致）或连接器导入长出 | `synthetic:144 runJob`；`registry.ts:308 createAdapter` |

★ = 沙盘传导引擎**从 `risk.ts` 长，不从 `recompute` 长**（见 §C-4）。

---

## §C 沙盘真正要新写的（已 grep 核验"全代码库不存在"）

1. **`SimSession` 会话状态机** — 全代码库零命中（`grep SimSession apps/*/src` 空）。现有 `simclock` 是**单租户单一全局时钟**（key=tenantId 自身），不是多会话。**全新。**
2. **checkpoint / 快照-回滚** — `agentcore workflow/checkpoint.ts` 是**显式 `NoopWorkflowCheckpointStore` / `/* no-op by design (v2) */`**（核验：`:21-32`）；simclock 只有 `reset()` 回 t0，无任意 tick 存档/读档。**全新。**
3. **branch / 分支推演树** — 无 fork-session 实现；`counterfactualTimeline` 只是单求解器内双轨，不是世界态级可持久化分支树。**全新**（可借其双序列输出形状）。
4. **系数×延迟逐 tick 跨域**通用传导核 — `recompute` **无时间轴**（核验：`epoch` 是写版本计数器 `snapshotVersion="{ov}.{epoch}"`，零 tick/delay/coefficient/decay 命中）；`risk.ts` 有逐 tick 衰减但**单链路单因子电池语境**。**中间那块"任意本体×逐 tick×系数×延迟×多跳"不存在 = 沙盘核心算法，全新**（站在 recompute 反向闭包定位 + risk.ts 逐 tick 衰减公式两个肩上）。

> 一句话给规划：**沙盘 = 七八个现成肩膀（simclock/recompute/risk_timeline/runStory/RadarChart/PropagationTimeline/PmDag/useLiveSolver）+ 新写两层（SimSession 会话/checkpoint/branch 状态机 ⊕ 通用逐 tick 系数延迟传导核）。前端可视化基本不重写；后端传导核 + 会话层是真正的新工程。**

---

## §D 我 8 份沙盘文档的逐条校正（已实现 / 已过期 / 需对齐）

| 我的文档 | 判定 | 必改/必读校正（以本表为准） |
|---|---|---|
| `HANDOFF-sandbox-build-and-review-contract` | **需对齐** | 阅读清单加**第 0 项=本接地地图**；评审项② 的门名按 §A.2 区分"真实 10 门 vs 待建沙盘门"；增量 0 必须同时入 **R17+G-11**（二者皆未在本体）。 |
| `ARCH-redlines-and-R17-decision-page` | **需对齐** | R17/G-11 标"拟立未入本体"（§A.1/§A.3）；提议的 `ia-single-source:check` 改为**扩展现存 `boundary-singlesource:check`**（§A.2，否则自我违 RL3/RL10）；`decision-page:check` 标全新待建。 |
| `PRD-sandbox-ontogenesis-buildplan` | **⚠ 有过度承诺** | **`comprehend` 不是 "LLM 听懂"**——核验为**确定性关键词目录匹配**（`comprehend.ts:481 comprehendScript`，`:490 matches(script,e.keywords)`），**无命中即兜底 `Order+Base`（:491，电池味最小集）**。**新颖业务故事会静默退化成稀薄/错误 BuildPlan**——这是沙盘"一句场景→倒推全部所需"的**头号诚实缺口**，必须显式标注（已就地修正该文档，见提交）。 |
| `PRD-simulation-sandbox` | **需对齐** | §0/§7 复用点改引 §B 的确切 `file:line`；"新增只三件"与 §C 一致（SimSession+传导核+统一前端）。 |
| `ARCH-sandbox-reconciliation` | ✅ **方向对，坐标补全** | "整合既有零件"判断正确；其泛指的复用件用 §B 的 `file:line` 钉死；传导雏形指向**应是 `risk.ts:177` 而非笼统的 `recompute`**（§C-4 核验：recompute 无延迟）。 |
| `ARCH-global-ia-consolidation` | **需对齐** | `ia-single-source:check` → 改为扩展 `boundary-singlesource:check`（同上，单源门已存在）。 |
| `ARCH-sandbox-landing-discipline` / `RUNBOOK-sandbox-implementation` | ✅ **仍成立，门名待校** | 落地纪律/增量顺序成立；增量门名按 §A.2 标"待建并入 gates"；增量 1 复用 `simclock`/`generic_inference` 坐标补 §B。 |
| `LOOP-scenario-launcher-sweep` | ⚠ **历史快照已过期** | S03/S06/16 占位**已被 `e274fb5`/`deec28e` 修复**，**别照修**（已就地加过期横幅，见提交）。 |

> 另：`DATA-rules-13-undefined-definitions` / `DATA-scenario-genome-20cards` / `PRD-rules-as-references` / `PRD-scenario-ontogenesis` — **仍有效**（规则即引用 + 卡 genome 数据未被覆盖；ontogenesis P1+P2 已实现，复用 `ScenarioOntogenesisRun`）。

---

## §E 我作为评审者的核验基线（锚真实门 · 逐 PR 用）

逐 PR 八项核对（同 `HANDOFF §5`），但门名按**本表 §A.2 真实门**校准：

1. **红线**（十条 RL1–RL10）逐条不违反——**RL1 本体先行**对沙盘=增量 0 必须把 R17+G-11+SimSession/sim 事件写进本体且 `ontology:check` 绿。
2. **门全绿**：`pnpm -r build && pnpm -r test && pnpm gates`（真实 10 门）+ 该增量**新建门**（须已并入 gates 聚合或 CI，不能只在 PR 描述里声称）。
3. **本体回写**：改链路/事件/对象/门 → 已回写 §2/§3/§4/§7/§8，`ontology:check` 绿。
4. **CLI 对等**：新沙盘 op 有 `cliCommand` 注册 `OPERATION_CATALOG`，`cli-parity:check` 绿，CLI 先于 UI。
5. **不分叉**：复用 §B 的确切件（尤其传导**从 `risk.ts:177` 长**、会话别碰 `checkpoint.ts` noop 占位之外另造）；单源门别新造（用 `boundary-singlesource:check`）。
6. **FDE 证据**：附"以用户身份亲手跑一遍"（CLI 输出/截图），非只单测绿。
7. **北极星距离**：PR 描述含"还差什么 + 哪些是 happy-path/合成"——**尤其须诚实标注 comprehend 关键词目录对新颖故事的退化**。
8. **可回退**：`sim.sandbox` entitlement 关=404/入口消失；迁移有 down；旧路径在。

---

## §F 竞品参考全文×逐图对照锚点（已核验 · 平台术语 · 禁外部产品名不入仓库）

> 来源：用户上传的参考文档，**全文（146 段/6305 字）逐句 + 7 张真图逐张视觉、文字与图对照读**。此处只留对我方设计有用的**精确事实**，并标"我方映射/状态"。竞品产品名/查询语言名（AbutionQL 等）不入本仓库。

### F.1 逐图×文本对照（image→文本锚→精确事实→我方映射）

| 竞品图 | 文本锚 | 逐图读到的精确事实 | 我方映射/状态 |
|---|---|---|---|
| 沙盘屏 | §2.2 三栏 + 18题 | 三栏：左图谱(Supplier→Factory→Order) · 中 **Runtime Health Radar**(Rule Coverage/Utilization/Closure/Cycle Safety/Observability/Activation 综合84) + **Runtime Trust Radar**(Runtime Trust/Explainability/**Temporal Trust 防未来窥视**/**Data Trust 数据血缘**) · 右 AI 指挥台。**指挥台主动提"待办动作"+自动生成查询代码+绑定 Skill/MCP**（非被动问答） | 三栏=R17.2 · 雷达=RadarChart(维度名补全) · Trust=R13 溯源+as-of-epoch · **指挥台"主动配置"比我方 QOS 被动问答更进，记为增量4 富交互目标** |
| 初始化向导 | §2.1 三步 | ①世界基准时间(实时快照/历史存档) ②推演范围(主体对象/时序记录/关系类型/属性过滤/**关系扩展深度 slider**/每类最多实体数) ③范围预检：**世界完整度 100% + "将进入沙盘的状态变量"清单**(状态变量38/38·派生规则4/4·Action7/7) | init=我方"读物化世界+slice范围"✓ · **③范围预检的"世界完整度+将进入清单"= closure 覆盖展示，我 SPEC 没显式接（属增量2 就绪认证），需补** |
| 全局认证屏 | §1.3 合并发布 | **Runtime Certification L0-L4**：L0 Invalid/L1 Configured/L2 Runnable/L3 Verified/L4 Certified。**L4=L3 Verified + Fanout安全 + Writeback完整 + Observability达标**；**Trial Tick**=空跑触发规则(PASS 留痕)；L3 认证审计(当前3·历史已修5)。**仿真准备度100/100→可进入推演** | L0-L4+TrialTick 我方有 ✓ · **但 L4 三元组(Fanout/Writeback/Observability) ≠ 我写的"三件套(派生∧动作∧查询)"——两套口径需在增量2 对齐映射** |
| 逐对象建模 | §1.2 三大能力 | 对象编辑(Order: 字段/**行动 delayOrder**/派生/安全 tab) + **局部仿真准备度 75/100 待补全**(结构100/知识67/行为90/综合86) | **逐对象(局部)就绪——我方只有全局，确认缺口（grounding §D 已记）** · delayOrder=ActionType ✓ |

### F.2 关键验证：我方 `PropagationRule` 模型 = 竞品 UI 逐字命中

沙盘屏指挥台原文：`supplier.delay_risk -- SUPPLIES.risk_propagation 0.85 --> factory.supply_risk`；初始化屏命名规则 `r_supply_risk_from_supplier`(SUPPLIES)、`r_order_risk_from_factory`(FULFILLS)。
→ **= `SPEC §1.1 PropagationRule{sourceStateVar, viaLinkKey, coefficient, targetStateVar}` 一字不差**。系数 0.85/0.7×延迟1 是"沿 link 命名传导规则"，**正是我方传导核设计**——SPEC 方向已被竞品成品验证。

### F.3 一处竞品自相矛盾（我方取诚实那一面）

§2.2 运行前置条件：「**所有风险传导规则需提前自定义配置，系统无默认内置规则**」 vs 紧接「注意：**推演系统不需要做任何配置**…」——**自相矛盾**。真相是**前者**（规则必须先配/长出）。**我方取诚实面**：规则经倒序发育/规则即引用**显式长出或开工单**，绝不宣称"零配置魔法"（守 fde-delivery「绿测试≠能用」）。

### F.4 重新审视 HANDOFF + 我的结论（对照全文后）

- ✅ **成立（且被竞品成品验证）**：三栏/L0-L4/TrialTick/三维就绪/init=范围+预检/采纳审批/checkpoint-branch/"须配置规则非魔法" 全部对；**传导核模型逐字命中**（F.2）。HANDOFF 的增量序/红线/复用-vs-新写**不需推翻**。
- 🔧 **需细化（已记本节，増量2/4 落地时对齐）**：① L4 三元组 vs 我"三件套"口径映射 ② 局部(逐对象)就绪 ③ 雷达精确维度名 ④ 指挥台"主动配置" ⑤ 范围预检的"世界完整度+将进入清单"。
- ⚠ **真缺口**：SPEC(增量1/3)未显式接"init-time 范围预检/世界完整度展示"（属增量2 就绪认证 surface closure）；Temporal Trust(防未来窥视)我只隐含在 R6 确定性、未点名 → 増量3 传导核应显式"tick 不读未来态"。
- 📏 **诚实距离**：竞品是**已跑通成品**（L4 认证/信任雷达/主动配置 AI/可进入推演）；我方是**零件齐 + 图纸(本规格)，零沙盘实现**。差距真实——我方优势是站在已有本体/closure/recompute/risk.ts/QOS 肩上，劣势是会话层+传导核+统一前端**一行未写**。

---

## §G 一句话

**我已通读分支文档+核验代码+全文逐图对照竞品：沙盘"图纸"方向对，传导核模型被竞品成品逐字验证；三处必钉接地真相不变（R17/G-11 未入本体·单源门勿重造·comprehend 非 LLM）；竞品比我方多的是"已跑通"——L4 认证/信任雷达/主动配置 AI，我方零件齐但沙盘一行未写。** 本表是评审基线，我据此逐 PR 守纪律。
