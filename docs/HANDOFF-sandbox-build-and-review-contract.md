# 推演沙盘 · 开工与评审契约（实现 agent 照此开工 · 架构 agent 负责评审）

> 这是什么：把推演沙盘的全部设计/纪律串成**一张可交接、可评审的契约**。**实现 agent**：从本文开工，照增量顺序做、守红线、过门、附 FDE 证据，逐增量提 PR。**架构评审 agent（我）**：按本文第 5 节逐 PR 评审，对照红线/门/本体回写/不分叉，通过才合。
> 分支：只推 `claude/vigilant-knuth-b1nmxn`；模型标识不进提交物。
> 北极星：用户从 CLI 或 UI（任意行业租户）开沙盘 → tick → 传导 → 干预 → 分支 → 对比，全程配置驱动、确定性、可回退；历史不变量一条不破，每条有门兜底。

---

## 1. 先读这些（canonical · 按序）+ 对齐这些（在建 · 禁分叉）

**先读（本仓库 docs/，我已写好）**：
1. `ARCH-redlines-and-R17-decision-page.md` — **十红线 + R17 决策单页（先读，最高约束）**
2. `PRD-simulation-sandbox.md` — 做什么（全栈设计，多行业可配）
3. `PRD-sandbox-ontogenesis-buildplan.md` — 怎么从一句场景倒序长出（数据闭环）
4. `RUNBOOK-sandbox-implementation.md` — **怎么一步步做 / 前后端怎么测 / 怎么回退（执行主依据）**
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
| **0 本体先行** | 把 SimSession/PropagationRule/SimCertification/SandboxViewConfig/`sim.*`事件/G-11/**R17/十红线** 写进 `SYSTEM-ONTOLOGY.md §2/§3/§4/§5/§7/§8` | `ontology:check` 绿；本体含全部新对象/链路/事件/R17/G-11 |
| **1 CLI 操作先行** | `/a/v1/sim/*`(init/tick/act/checkpoint/rollback/branch/compare)+迁移026+OPERATION_CATALOG+`platform sim`；entitlement `sim.sandbox` 暗发 | **CLI 无头跑通一遍沙盘**（贴输出）；确定性重跑字节一致；`sim:check`+`cli-parity:check` 绿 |
| **2 就绪认证=surface闭包** | L0-L4/三件套门/三维 从既有 closure 投影（不写新逻辑） | 完整本体认证 L4；缺件诚实 FAIL；`sim-readiness:check`+`chain:check` 绿 |
| **3 传导引擎** | 系数+延迟沿 link（系数=`rule.params`，接规则即引用）；扩 `recompute` | 传导跑通；改系数即改结果；`propagation:check`+`debattery:check` 绿 |
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

**评审产物**：我在 PR 上给 ✅可合 / 🔴打回(列项+红线+建议)。打回项修复后重提。**我不替实现，只评审 + 守纪律。**

---

## 6. 实现 agent 提交规范（让评审高效）

每 PR 描述按此模板：
```
增量N · <标题>
- 做了什么（对照 RUNBOOK 增量N）
- 复用了什么既有 PRD/代码（证不分叉）
- 本体回写：§? 改了什么
- CLI：新增 platform sim ... （cli-parity 绿）
- 测试：命名门 + pnpm gates 输出（贴绿）
- FDE 亲手证据：CLI 输出 / 截图
- 北极星距离：还差___ · happy-path/合成的部分：___
- 回退：flag 关 / 迁移 down / 旧路径
```
自检清单（合并前逐条勾，= 评审协议 8 项）：本体回写✓ CLI注册✓ 命名门✓ gates✓ chain✓ 零业务常数✓ 暗发✓ FDE亲手✓ 北极星✓ 回退✓。

---

## 7. 禁止清单（避免搞乱，速查）

❌ 代码先行、本体不回写 ❌ 默认开、影响现有租户 ❌ 第二个数据源/就绪/审批/对话实现 ❌ 沙盘直写真值绕审批 ❌ 代码出现行业实体名 ❌ 仿真核用随机/时钟 ❌ UI-only 无 CLI ❌ 硬编码 seed 起步 ❌ 删旧页/big-bang ❌ 平行造与在建冲突 ❌ 一次性重排全部页面 ❌ 拿绿测试冒充能用。

---

## 8. 起步第一步（建议立刻做）

**增量 0（零代码、最先、立得住）**：把 **R17 + 十红线 + SimSession/传导/sim事件/G-11** 写进 `docs/SYSTEM-ONTOLOGY.md §2/§3/§4/§5/§7/§8` → 跑 `ontology:check` 绿 → 提 PR。这一步立"宪法 + 图纸"，后面每增量才有据可依、有门可守。我评审这第一个 PR 时，重点核对 R17/红线/G-11 入本体且 `ontology:check` 绿。

> 契约生效：实现 agent 从增量 0 起逐增量提 PR；我逐 PR 按第 5 节评审。**有疑义先问，不猜；越红线先停，不硬上。**
