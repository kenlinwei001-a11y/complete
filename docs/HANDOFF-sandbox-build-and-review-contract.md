# 推演沙盘 · 开工与评审契约（实现 agent 照此开工 · 架构 agent 负责评审）

> 这是什么：把推演沙盘的全部设计/纪律串成**一张可交接、可评审的契约**。**实现 agent**：从本文开工，照增量顺序做、守红线、过门、附 FDE 证据，逐增量提 PR。**架构评审 agent（我）**：按本文第 5 节逐 PR 评审，对照红线/门/本体回写/不分叉，通过才合。
> 分支：只推 `claude/vigilant-knuth-b1nmxn`；模型标识不进提交物。
> 北极星：用户从 CLI 或 UI（任意行业租户）开沙盘 → tick → 传导 → 干预 → 分支 → 对比，全程配置驱动、确定性、可回退；历史不变量一条不破，每条有门兜底。
>
> ── **交接前最新状态（2026-06-24 · 必读）** ──
> 1. **增量 1/2/3 已有可照抄工程规格**（增量 0–3 图纸已全齐，对方可一路做完后端）：
>    - `SPEC-sandbox-propagation-and-session.md`（增量 1/3）：传导核纯函数+算法+确定性/时间信任 · SimSession 三表 DDL[pg+memory] · 系数=`PropagationRule` 结构+`rule.params` 引用 · **按租户 entitlement 暗发不同模块 lite/Pro/旗舰** · 端点+CLI · 两行业验收。
>    - `SPEC-sandbox-readiness-certification.md`（增量 2）：就绪认证=**投影既有 closure 五维，零新校验**；L0-L4 / 三维 / **L4三元组↔我方 closure 维** / Trial Tick / **世界完整度(范围预检)** 三张映射表钉死 + `deriveCertification` 纯函数签名 + `sim-readiness:check` 门。
> 2. **传导核模型已被竞品成品逐字验证**：竞品 UI 原文 `supplier.delay_risk -- SUPPLIES.risk_propagation 0.85 --> factory.supply_risk` = SPEC 的 `PropagationRule{sourceStateVar,viaLinkKey,coefficient,targetStateVar}`（对照见 `GROUNDING-MAP §F.2`）。
> 3. **G-10「规则即引用」P1 已落**（commit 261f29e，另一 agent）：`RuleEntry` 现有 `params`，沙盘传导**系数可直接引用 `rule.params`**（真正兑现"改规则即改推演"）；`pnpm gates` 已由 10 增至 **11**（加 `rule-closure:check`）。**别再把系数写成内联常数**。
> 4. **不需要时序图数据库**：图小（千级节点）、tick 是会话内模拟时间、传导是内存确定性计算（SPEC §0）。
> 5. **竞品全文×逐图对照已沉淀** `GROUNDING-MAP §F`（L0-L4/L4三元组/局部就绪/信任雷达/范围预检 的精确锚点 + 对本 HANDOFF 的审计：**增量序/红线/复用边界不需推翻**，五处细化 + 两处缺口已就地补）。

---

## 1. 先读这些（canonical · 按序）+ 对齐这些（在建 · 禁分叉）

**先读（本仓库 docs/，我已写好）**：
0. `GROUNDING-MAP-sandbox-review-baseline.md` — **接地地图（评审基线 · 已对源码核验，最先读）**：本设计文档群与真实代码/本体/门的逐条对齐；凡设计文档与它冲突，以它为准。**它纠了三处必须知道的接地真相**：① R17/G-11 尚未入本体（增量 0 硬前提）② 提议的 `ia-single-source:check` 与现存 `boundary-singlesource:check` 重叠（别造第二个，扩展它）③ `comprehend` 是关键词目录不是 LLM（新颖故事会静默退化）。
1. `ARCH-redlines-and-R17-decision-page.md` — **十红线 + R17 决策单页（最高约束）**
2. `PRD-simulation-sandbox.md` — 做什么（全栈设计，多行业可配）
3. `PRD-sandbox-ontogenesis-buildplan.md` — 怎么从一句场景倒序长出（数据闭环）
4. `RUNBOOK-sandbox-implementation.md` — **怎么一步步做 / 前后端怎么测 / 怎么回退（执行主依据）**
   - `SPEC-sandbox-propagation-and-session.md` — **增量 1/3 的可照抄工程规格**：传导核纯函数签名+算法+确定性/时间信任纪律、SimSession 三表 DDL(pg+memory)、`PropagationRule` 承载 source/target/link 结构 + 系数/延迟**引用 `rule.params`**(G-10 P1 已可用)、**按租户 entitlement 暗发不同模块(lite/Pro/旗舰)**、端点+CLI、两行业验收(证 R14 零行业锁死)
   - `SPEC-sandbox-readiness-certification.md` — **增量 2 的可照抄工程规格**：就绪认证=**投影既有 closure 五维(OBJECT/DATA/FORWARD/CHAIN/SHAPE)，零新校验逻辑(RL3)**；§2 三张映射表钉死(L0-L4 ← closure 状态 · **L4三元组 Fanout/Writeback/Observability ↔ 我方 closure 维** · 三维 结构/知识/行为 ← closure kind) + Trial Tick(空跑1tick) + **世界完整度=范围预检** + `deriveCertification` 纯函数 + 诚实门 + `sim-readiness:check`
5. `ARCH-sandbox-landing-discipline.md` — 落地纪律（本体先行→CLI→surface→引擎→UI）
6. `ARCH-global-ia-consolidation.md` — 全局 IA 合并（推演收敛/就绪folded/单源深链）
7. `ARCH-sandbox-reconciliation.md` — **与在建工作对齐（必读，防分叉）**

**对齐（已有 PRD/实现，沙盘扩展不另起，违反=RL10 红）**：
- `PRD-frontend-addendum-sim-views`（交互重算 + `/b/v1/solvers/:key/run`，ProjectSimView 已建）
- `PRD-addendum-a8-timeseries`（模拟时钟 tick，simclock.ts 已建）
- `PRD-addendum-replay-orchestrator`（走正门虚拟操作，禁直写）
- `PRD-scenario-ontogenesis`（卡 grow，**P1+P2 已实现**，复用 `ScenarioOntogenesisRun`）
- `PRD-rules-as-references`（传导系数=`rule.params` 可编辑）
- `TODO-fde §8b`（传导=`recompute` 反向闭包雏形扩系数+延迟）

> ⚠ 注：`LOOP-scenario-launcher-sweep` 是历史诊断，其 S03/S06/16 占位**已被修复**，**别照修**。

---

## 2. 建什么（范围）

**建**：把已有零件（sim-views 重算 / A8 时钟 / recompute 传导 / replay 走正门 / ontogenesis 卡grow）整合升级为**有状态、可分支、统一 UI、行业无关、配置驱动的推演沙盘**。沙盘真正新增**只三件**：① `SimSession` 会话状态机 ② 系数+延迟传导规则 ③ 统一沙盘前端（+数据管道建模屏/就绪认证面板，复用组件）。

**不在范围**（诚实边界，别做）：连续微分方程级物理仿真；非本体可表达的外部黑盒；实时多人协同编辑（OT/CRDT）；一次性重排全部页面（决策页优先、CRUD 渐进）。

---

## 3. 怎么建（增量顺序 · 每增量 DoD · 详见 RUNBOOK）

| 增量 | 内容 | 完成定义（DoD，FDE 亲手） |
|---|---|---|
| **0 本体先行** | 把 SimSession/**SimTickState**/SimCheckpoint/PropagationRule/SimCertification/SandboxViewConfig/`sim.*`事件/G-11/**R17/十红线** 写进 `SYSTEM-ONTOLOGY.md §2/§3/§4/§5/§7/§8`（会话/传导 4 对象 schema 见 `SPEC §1-2/§7`；认证/视图配置对象见 `RUNBOOK 增量0`） | `ontology:check`+`prd:check` 绿；本体含全部新对象/链路/事件/R17/G-11 |
| **1 CLI 操作先行** | `/a/v1/sim/*`(init/tick/act/checkpoint/rollback/branch/compare)+迁移026+OPERATION_CATALOG+`platform sim`；entitlement **分模块暗发**(`sim.sandbox`/`.propagation[.delay]`/`.checkpoint`/`.branch`/`.certification`/`.commander`，按租户给不同档)。**三表DDL+repo+端点+CLI 详 `SPEC §2/§4/§5`** | **CLI 无头跑通一遍沙盘**（贴输出）；确定性重跑字节一致；`sim:check`(新建·并入gates)+`cli-parity:check` 绿 |
| **2 就绪认证=surface闭包** | L0-L4 / **L4三元组(Fanout/Writeback/Observability → 对齐我方 closure 维)** / 三维(结构/知识/行为) / **全局⊕局部(逐对象)就绪** / **范围预检(世界完整度+将进入状态变量清单)** 从既有 closure 投影（**零新校验逻辑**；三张映射表+`deriveCertification` 纯函数详 `SPEC-sandbox-readiness-certification §2/§5`） | 完整本体认证 L4；缺件诚实 FAIL；`sim-readiness:check`(新建·并入gates)+`chain:check` 绿 |
| **3 传导引擎** | 新写纯函数 `propagateTick`（系数+延迟沿 link；**系数引用 `rule.params`**—G-10 P1 已可用；复用 recompute 链路导航+risk.ts 衰减+延迟队列）；**Temporal Trust：tick 只读 ≤t 态**。详 `SPEC §1` | 传导跑通；改系数即改结果；**两行业验收**；`propagation:check`(新建·并入gates)+`debattery:check` 绿 |
| **4 UI（最后·暗发）** | 5屏(数据管道/逐实体/就绪/初始化/沙盘)，配置驱动；复用 RadarChart/PropagationTimeline；ModelingPage additive | 起前端+真后端**亲手点一遍**(截图)；**两行业各跑通**(证R14)；`ui-smoke:sandbox`+`debattery:check` 绿 |

增量 2、3 可在 1 后**并行**；4（UI）**必须最后**且暗发。**倒序发育起步**（增量1 init 读的世界态经连接器/合成/runStory 长出，禁硬编码 seed，详 `PRD-sandbox-ontogenesis-buildplan`）。

---

## 4. 红线（越线即停）+ R17（设计宪法）

**十红线**（详 `ARCH-redlines-and-R17`，任一违反=打回）：
RL1 本体先行 · RL2 暗发 · RL3 单一来源(不出双份) · RL4 走正门 · RL5 零业务常数 · RL6 确定性 · RL7 CLI先于UI · RL8 倒序长出 · RL9 additive可回退 · RL10 不与在建分叉。

**R17 决策单页**（前端宪法，决策页须遵循）：一页看全 数据→推演→溯源→动作→AI，就地下钻不跳页，配置驱动密度。新决策页（沙盘/建模/就绪）天然遵循；改动到的现有决策页对齐（不主动重排全部）。

---

## 5. 评审协议（我怎么 review · 实现 agent 据此自检）

**每增量一个 PR**。我对每个 PR 逐项核对，**全过才"可合"，任一红列具体红线/门打回**：

| 评审项 | 通过判据 | 不过即打回 |
|---|---|---|
| **① 红线** | 十红线逐条不违反 | 引具体 RLx + 证据 |
| **② 门全绿** | `pnpm -r build && pnpm -r test && pnpm gates` + 该增量命名门(`sim:check`/`propagation:check`/`sim-readiness:check`/`ui-smoke:sandbox`) | 贴红的门输出 |
| **③ 本体回写** | 改了链路/事件/对象/门 → 已回写 §2/§3/§4/§7/§8，`ontology:check` 绿 | 代码先行未回写 |
| **④ CLI 对等** | 新能力有 `cliCommand`，`cli-parity:check` 绿，CLI 先于 UI | UI-only/CLI 洼地 |
| **⑤ 不分叉** | 复用既有 PRD/代码(sim-views/A8/recompute/replay/ontogenesis/closure)，未平行造第二套 | 引被重复的既有实现 |
| **⑥ FDE 证据** | 附"以用户身份亲手跑一遍"证据(CLI 输出/截图)，非只单测绿 | 只有绿测试、无亲手证据 |
| **⑦ 北极星距离** | PR 描述含"还差什么 + 哪些是 happy-path/合成" | 自证"完美"无诚实盘点 |
| **⑧ 可回退** | entitlement 关=404/入口消失；迁移有 down；旧路径在 | 删旧页/不可回退 |
| **⑨ UI 设计对齐（两轴 · UI 增量强制）** | **轴1**=对照竞品 `GROUNDING §F` 逐元素（健康雷达6维/信任雷达4维/L0-L4 stepper/L4三元组/初始化向导/逐对象就绪/AI指挥台/数据管道节点图）；**轴2**=对照设计 mockup 逐元素是否真实现（非只"渲染了诚实数据"）。**两轴逐元素核对、缺项列清单**，并真启动系统 Playwright 实拍佐证 | 只验功能不验设计完整性 / 用"happy-path 渲染了数据"冒充"设计砌齐"（见 `AUDIT-sandbox-ui-design-alignment.md` 教训） |

**评审产物**：我在 PR 上给 ✅可合 / 🔴打回(列项+红线+建议)。打回项修复后重提。**我不替实现，只评审 + 守纪律。**
**⚠ 评审教训（2026-06）**：增量 2/4 曾被我误判"✅可合/全闭"——只验了功能与 happy-path 渲染，**未做 ⑨ 两轴核对**，实拍才发现 UI 仅 ~30-40% + demo 空世界。故 ⑨ 为 UI 增量**硬门**，详见 `docs/AUDIT-sandbox-ui-design-alignment.md`。

---

## 6. 实现 agent 提交规范（让评审高效）

> **同分支协同纪律（多 agent 同推 `claude/vigilant-knuth-b1nmxn`，必守，违反=评审打回）**：
> 1. **不开新分支、不开 PR**：每增量 = 直接 commit + push 到 `claude/vigilant-knuth-b1nmxn`；评审在分支上按 §5 做。
> 2. **每次 push 前先 rebase**：`git fetch origin claude/vigilant-knuth-b1nmxn && git rebase origin/claude/vigilant-knuth-b1nmxn`（现有规则线等多 agent 同推此分支，不 rebase 必非 fast-forward / merge 冲突）。冲突自行解、解完复跑 `pnpm -r build && pnpm -r test && pnpm gates` 再 push。
> 3. **三类"高冲突文件"改动须在 commit 描述单独点名**（多 agent 抢改重灾区）：`packages/contracts/**`（新 sim schema）· `package.json`（新门并入 `pnpm gates`）· `docs/SYSTEM-ONTOLOGY.md`（本体回写）。点名让评审重点核"无双份门 / 无双份契约 / 本体回写不撞规则线"。

每 commit 描述按此模板：
```
增量N · <标题>
- 做了什么（对照 RUNBOOK 增量N）
- 复用了什么既有 PRD/代码（证不分叉）
- 本体回写：§? 改了什么
- 高冲突文件：contracts? / package.json? / SYSTEM-ONTOLOGY.md? （改了哪个点名）
- CLI：新增 platform sim ... （cli-parity 绿）
- 测试：命名门 + pnpm gates 输出（贴绿）
- FDE 亲手证据：CLI 输出 / 截图
- 北极星距离：还差___ · happy-path/合成的部分：___
- 回退：flag 关 / 迁移 down / 旧路径
```
自检清单（push 前逐条勾，= 评审协议 8 项 + 同分支纪律）：**rebase干净✓** 本体回写✓ CLI注册✓ 命名门✓ gates✓ chain✓ 零业务常数✓ 暗发✓ FDE亲手✓ 北极星✓ 回退✓ **高冲突文件点名✓**。

### 6.1 评审 follow-up（非阻断 · 评审记录在此，做对应增量时带走，做完划掉）

> 评审中发现的"不打回、但该改"的小项记这里，避免散落在对话里丢失。实现 agent 做到对应增量时**一并处理并在 commit 描述里说明已处理**。

- [ ] **增量 4 · `sim compare` CLI 人体工学**（增量 1 评审遗留）：现用法 `sim compare <占位> --a <A> --b <B>`，第一个位置参被忽略、真正读 `--a/--b`，反直觉（评审时实测踩空）。收 CLI 人体工学时改成 `sim compare <A> <B>`（两个位置参直取），或让位置参即 A。
- [ ] **增量 4 · `entering[].source` 标签真实化**（增量 2 评审遗留）：`certification.ts:~176` 把"将进入沙盘的状态变量"来源**硬编码成 `FULFILLS r_<type>_<prop>`**，与真实派生/链路无关（仅占位标签，显示用）。UI 落地时改成反映真实 link/派生来源（否则前端清单会一律显 FULFILLS，误导）。
- [ ] **增量 2/3 数据齐时 · 传导 live-fire FDE**（增量 3 评审遗留）：本轮评审已核传导核（9 单测覆盖 改coef改果/delay/decay/clamp/Temporal Trust/coefficientRef）+ live 接线（真本体图 + ruleParams + opt-in），但**未亲手在真种子对象上点燃一次跨对象传导**（种子对象 id 与会话态难手工对齐）。倒序发育/两行业数据接齐后，补一条"发布 PropagationRule → 真对象 tick → 目标态变化"的 FDE 证据（commit 已诚实标 happy-path）。

---

#### 6.1.A UI 设计对齐缺口（2026-06 实拍审计 · `AUDIT-sandbox-ui-design-alignment.md §3.5` · 按优先级，做 UI 增量时按 §5⑨ 两轴核对带走）

> 来源：真启动系统 Playwright 三路实拍（竞品/我的设计/实际）。实际 UI 仅实现设计 ~30-40% 且 demo 沙盘是空世界。下列**前端砌齐 + demo 种数据**，非后端契约缺（契约齐）。

**P0（红线/北极星 · 不砌齐不判"可用"）**
- [ ] **采纳 → R4 Action 草稿**（沙盘 RiskBoardView/SandboxView 均无采纳按钮）：模拟态须走"采纳才写真值"正门（RL4），现完全缺。
- [ ] **分支 → 多场景 KPI 对比 UI**（北极星）：后端 `sim branch`/`sim compare` 有，前端**无对比面板**；分支→对比断在 UI。
- [ ] **初始化向导 + 范围预检**（竞品 image7）：现 `SandboxView` 挂载即自动 `init()` 建会话，**无 3 步向导（时间→范围→预检）+ 世界完整度/将进入清单**确认步。
- [ ] **就绪面板砌齐**（竞品 image6，后端 `deriveCertification` 数据全在）：L0-L4 stepper / L4 三元组卡 / Trial Tick 卡 / 全局↔局部(逐对象)切换（现写死 GLOBAL）/ 完整度 gauge / entering 清单 —— **6 项前端未渲染**，现仅小三维三角 + canEnter 文字。
- [ ] **给 demo 租户种 PropagationRule + 状态变量**：实拍 demo 沙盘 `0 状态变量/0 传导规则`=空世界（引擎真过 live-fire，是种子缺口）。种几条让沙盘开箱有内容可推。

**P1（设计完整度 · 部分是我 PRD 自身漏的）**
- [ ] **健康雷达 6 维 + 信任雷达 4 维**（竞品 image1；**我 SPEC 自己漏了**，先回写 `SPEC-sandbox-readiness-certification` 再交付）。
- [ ] **AI 推演指挥台**（竞品 image1 右栏：主动提待办 + 生成查询代码）：现仅底部被动输入框，无主动配置。
- [ ] **逐对象就绪 %**（竞品 image5）：`ObjectTypesBrowserPage` 现只有物化数，无逐对象 75/100 + 结构/知识/行为分解。
- [ ] **ModelingPage 数据源面板 + 就绪面板 + 数据管道节点图**（竞品 image2；`PmDag`/`FdeGraph` 现成未复用）：现为文本映射 + 空状态。
- [ ] **R13 溯源悬浮**（KPI 上规则/源系统来源，`Provenance`/`RuleRef` 现成未用）。


---

## 7. 禁止清单（避免搞乱，速查）

❌ 代码先行、本体不回写 ❌ 默认开、影响现有租户 ❌ 第二个数据源/就绪/审批/对话实现 ❌ 沙盘直写真值绕审批 ❌ 代码出现行业实体名 ❌ 仿真核用随机/时钟 ❌ UI-only 无 CLI ❌ 硬编码 seed 起步 ❌ 删旧页/big-bang ❌ 平行造与在建冲突 ❌ 一次性重排全部页面 ❌ 拿绿测试冒充能用。

---

## 8. 起步第一步（建议立刻做）

**增量 0（零代码、最先、立得住）**：把 **R17 + 十红线 + 新对象(`SimSession`/`SimTickState`/`SimCheckpoint`/`PropagationRule`/`SimCertification`/`SandboxViewConfig`) + `sim.*` 事件(`sim.session_created`/`sim.tick_completed`/`sim.checkpoint_saved`/`sim.branched`) + 新门(`sim:check`/`sim-readiness:check`/`propagation:check`；**单源门复用现存 `boundary-singlesource:check` 勿新造**；R17 配套 `decision-page:check`) + G-11** 写进 `docs/SYSTEM-ONTOLOGY.md §2/§3/§4/§5/§7/§8`（**链路/`sim.*`事件/门 + 会话传导对象照抄 `SPEC §7 本体引用与影响`；认证/视图配置对象见 `RUNBOOK 增量0`**）→ 跑 `ontology:check` + `prd:check` 绿（**`prd:check` 当前因两份沙盘 PRD 悬空引用 G-11 而红，此步入 G-11 即转绿**）→ 提 PR。这一步立"宪法 + 图纸"，后面每增量才有据可依、有门可守。我评审这第一个 PR 时，重点核对 R17/红线/G-11 入本体且 `ontology:check`+`prd:check` 绿。

> 契约生效：实现 agent 从增量 0 起逐增量提 PR；我逐 PR 按第 5 节评审。**有疑义先问，不猜；越红线先停，不硬上。**
