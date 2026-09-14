# 工业级 PRD · 年度情景规划台（aop / AnnualScenario）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 数据）。**只读本文 + 像素参照 HTML 即可 1:1 实现**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`：`buildAOP` **L3163-3185** · 数据常量 `AOP_SCEN` **L3150-3154** / `AOP_TRIGGERS` **L3155-3158** / `AOP_DECOMP` **L3159-3162** · `linkRules` **L5198-5199** · `showRulePop` **L5201-5209**——本文已把其全部常量/公式/字符串/交互转录，研发以本文为准、HTML 仅作像素核对。 |
| 落点（融入，不新建） | 前端 `apps/frontend-shell/src/views/plan/AnnualScenarioView.tsx`（renderer `annual-scenario`）+ `PlanViews.module.css` + `RuleRef.tsx`（复用）· 后端 `apps/datacore/src/planviews.ts` `PlanService.aop` **L46-181** · 种子 `apps/datacore/src/synthetic/battery.ts` `generatePlanDomain` **L1174-1272** + `BATTERY_SOLVER_PARAMS.planview` **L171-197** + `capexScenario` **L148-169** · 契约 `packages/contracts/src/planviews.ts` `AnnualScenarioSchema/AopResponseSchema` **L8-73** · 求解器 `apps/datacore/src/solvers/capex.ts` `capexScenario` **L152+** |
| 不变量 | R14（前端零写死，值来自管线）· R6（同 seed 字节一致）· R13（每数可溯 targetRef→S&OP 目标线）· R4（拍板真值经 Action 审批）· R-一致（分解=S&OP 目标线同源、规则真引擎 C18/C23）· R5（视图配置经 ViewDef，年份不前端写死）· 1:1=结构/数据/交互 100%，**唯色调/字体可调** |
| 取代/合并 | 吸收并取代结构 PRD `docs/PRD-aop-annual-scenario-1to1.md`（其 gap 分析全部并入本文 §2/§4.5；该文可归档）。 |

> **一句话**：年度情景规划台**系统已实现且多处强于 HTML**（活 `capex_scenario` 求解器 / 真规则引擎 C18·C23 explanation / Action 拍板审批 / TRIGGERED 触发态 + 通知 / 分解 targetRef 溯源 / 项目级 IRR·util24·C23 测算）。本 PRD 把**与 HTML 1:1 的视觉/数据差异补齐**（`note` 行、"三情景对比"chip、分解段 header "基准情景 1,580 万套"、prose 内 C18/C21/C23 行内规则悬浮、缺口/过剩窗口曲线渲染），并**修一个年份接线 bug**（前端写死 `YEAR=2027`，ViewDef 与种子均 2026 → 视图可能空数据 + 违 R5/R14），同时**保留系统全部超集能力**——不做"把活的退回静态"。所有对齐数据经**电池域合成生成器**产出（R14 零前端写死、R6 确定性）。

---

## 0. 本体引用与影响（强制 · 铁律 0）
- **触及对象类型**（§2.B/E，plan 域）：`AnnualScenario`（**扩 `note` 字段**）·`ScenarioTrigger`·`PlanTarget`（目标分解=目标线，targetRef 同源）·`Solver(capex_scenario)`·`ActionType(AOP情景拍板)`·`FeatureConfig(view.annual-scenario / act.aop-finalize)`·`Rule(C18/C21/C23)`。
- **触及链路**（§3）：`合成 generatePlanDomain(seed) → AnnualScenario/ScenarioTrigger/PlanTarget 物化 → GET /a/v1/plan/aop（PlanService.aop 跑 capex_scenario + 规则引擎 C18/C23）→ ViewDef layout → AnnualScenarioView 渲染`；拍板支链 `→ ActionDraft(AOP情景拍板) → 审批 EXECUTED → aop.finalized`。
- **触及事件/数据流**（§4）：复用 `aop.finalized`（拍板落库）·`materialize.completed`/`dataset.regenerated`（合成重生成失效本视图缓存）。**无新事件**。
- **触及不变量**（§5）：
  - **R14 应用层无业务常数（核心）**：HTML 的演示字符串/数值（note/产能决策/长协/触发条件/分解值/dem 1420·1580·1760）**全作为电池域生成器种子配置**（`battery.ts planview` config）产出，**不前端写死**。过 `debattery:check`。
  - **R5 视图配置经 ViewDef**：年份由 ViewDef `layout.year` 下发，前端**不得**写死 `YEAR=2027`（当前 bug）。
  - **R6 确定性**：对齐 HTML 的数值经固定种子产出，同 (industry, scale, seed) 字节一致。
  - **R4 真值经 Action**：拍板（finalize）走 `AOP情景拍板` ActionDraft 审批（系统超集，保留）。
  - **R13 / R-一致**：分解节点 `targetRef` 指向 S&OP 平衡台目标线（2026-07 = 127.6 同源勾稽）；C18/C23 走真引擎 explanation。
- **断点（§8）**：修 **G-（年份接线）**：前端 `AnnualScenarioView.tsx:13 YEAR=2027` ≠ ViewDef `service.ts:1020 year:2026` ≠ 种子 `battery.ts:1183 year=2026` → 请求 2027 时 `PlanService.aop` 按 `year` 过滤得空数组（`planviews.ts:48-50`），三情景全空。
- **门禁（§7）**：`debattery:check`（无前端内联）· `chain:check`（capex_scenario 注册）· `ontology:check` · 前端回归（`f21.annual-scenario.test.tsx` + 角色门）· FDE 亲手跑。
- **回写承诺**：`AnnualScenario` 加 `note` 字段 → 回写本体 §2.B；其余复用既有，无新链路/事件。

## 1. 视图概述
年度情景规划台把**产能建设求解器（C1 / capex_scenario）**的输出摆成**三个并列情景**（保守 / 基准★ / 激进），每情景给出年需求、产能决策、长协锁量、财务测算（收入/CAPEX/IRR）、规则校验（C18 现金安全垫 / C23 产能建设门槛），其下挂**触发条件监测表**（条件满足→自动升级情景并通知投资委员会）与**目标分解引擎**（年→季→月，分解值=S&OP 平衡台目标线同源勾稽）。HTML 是纯静态三卡 + 2 触发 + 6 跨年季度；**系统是活求解器 + 真规则 + Action 拍板 + 4 触发 + 单年 12 月分解 + 项目级测算**。本 PRD 令**可见输出与 HTML 100% 一致**，底层保留系统超集。**系统只摆情景与命比，拍板谁来由 catalog_admin 决策者定。**

## 2. UI 规格（布局 · 像素结构 · HTML vs 系统）
### 2.1 整页（`buildAOP` L3163-3185）
```
┌ rk-top ─────────────────────────────────────────────────────────────┐
│ <h3>年度情景规划台 · AOP 2027</h3>                                     │  ← HTML 标题写 2027（L3176）
│ rk-sub: "产能建设求解器：情景需求曲线 vs 投产时点 → 缺口/过剩窗口 ·    │
│   IRR · 利用率预测（{linkRules('C23 门槛校验')}）· 情景挂触发条件活在   │
│   系统里"                                                              │
│ 右 rk-hsel: [<span class="tier-chip on">三情景对比</span>]            │  ← ❌ 系统未渲染（缺口#2）
└──────────────────────────────────────────────────────────────────────┘
[ scen-grid：3 × scen-card（保守 / 基准★ / 激进），见 §2.2 ]
[ rk-det「情景触发条件 · 挂牌监测（情景规划Agent）」+ cmp 表（3 列），见 §2.3 ]
[ rk-det「目标分解引擎 · 基准情景 1,580 万套（年→季→月）」+ dec-flow，见 §2.4 ]
```

### 2.2 情景卡 `scen-card`（3 张 · 顶边 3px = 情景色 · 基准 `.pick` 高亮）（L3164-3172）
逐元素（HTML 行内）：
1. `scen-h`：`<b style="color:c">{n}</b>` + 若 `pick`：`<span class="rk-fchip" 描边#54B5C466>已拍板 AOP</span>`。
2. `scen-big`：`{dem.toLocaleString()} <small>万套/年</small>`（保守 1,420 / 基准 1,580 / 激进 1,760）。
3. **`scen-note`**（❌ 系统缺，缺口#3）：保守"乘用车增速放缓 +8%" · 基准"+18% · 储能放量" · 激进"+31% · 海外大单落地"。`.scenNote` CSS 已存（`PlanViews.module.css:39-43`）但未渲染。
4. `scen-row` 产能决策：`<span>产能决策</span>{cap}`。
5. `scen-row` 长协锁量：`<span>长协锁量</span>{lta}`。
6. `scen-row` 财务测算：`<span>财务测算</span>收入 {rev.toLocaleString()} 亿 · CAPEX {capex} 亿{irr!=='—'?' · IRR '+irr:''}`。
7. `scen-row` 规则校验：`<span>规则校验</span>{linkRules('C18 现金安全垫：'+c18+(c23!=='—'?' · C23 产能建设门槛：'+c23:''))}`——**HTML 是 prose 行内 `linkRules` 悬浮**（缺口#8/#14：系统改成了可点徽章+真 explanation，丢了行内悬浮）。
8. ➕**系统独有**：`项目测算（C1）` 行（每项目 IRR/24月利用率/C23 徽章）——HTML 无，**保留**。
9. ➕**系统独有**：基准情景 catalog_admin 见**「拍板情景」按钮**（act.aop-finalize）；拍板后转"已拍板 AOP" chip——**保留**。

| # | HTML 元素 | 系统现状 | 动作 |
|---|---|---|---|
| 1 | 四块结构 + 头部 h3/sub | ✅ `AnnualScenarioView.tsx:33-40` | 保留 |
| 2 | 头部"三情景对比" tier-chip(on) | ❌ 未渲染 | **加** |
| 3 | `scen-note`（乘用车放缓+8%…） | ❌ `AnnualScenario` 无 `note` 字段 | **加字段+种子+渲染** |
| 4 | 三卡 + 顶边色 + 已拍板 chip | ✅ `SCEN_COLORS` 精确一致 | 保留 |
| 5 | dem 1420/1580/1760 万套 | ◐ 系统 `base×0.88/1/1.18` 派生，值≠演示 | **种子对齐**（§4.5） |
| 6 | 产能决策/长协锁量文案 | ◐ 串不同（合肥/盐城 vs 枣庄/江门） | **种子对齐**（§4.5） |
| 7 | 财务收入/CAPEX/IRR | ✅ IRR 求解器活算（超集） | 保留 |
| 8 | 规则校验 C18/C23 行内+悬浮 | ◐ 可点徽章 + 真引擎 explanation（超集），丢行内悬浮 | **加行内 `RuleRef` + 保留徽章** |
| 9 | 项目测算（C1）IRR/util24/C23 | ➕ 系统独有（活 capex_scenario） | **保留** |
| 10 | 拍板 finalize Action | ➕ 系统独有（AOP情景拍板 + aop.finalized） | **保留** |
| 11 | 触发表 3 列 + 2 条 | ◐ 系统 4 条不同 + expr + TRIGGERED（超集） | **种子对齐演示 2 条口径 + 保留超集**（§4.5/§9） |
| 12 | 分解：无 year 根、6 季跨 26/27、Q3-only 月 | ◐ 系统有 year 根 + 单年 4 季 12 月 + 溯源（超集） | **保留超集结构，header 数字对齐**（§9） |
| 13 | 缺口/过剩窗口曲线 | ◐ 数据已在 `capexScenario.windows/gap`，**前端未画** | **加曲线渲染** |
| 14 | prose 内 C18/C21/C23 行内规则链接 | ◐ header/footnote 纯文本 | **加 `RuleRef`** |
| 15 | **年份** 2027 | 🔴 前端写死 2027、ViewDef/种子 2026 → 空数据 + 违 R5 | **修接线**（§4.5） |

### 2.3 触发表（rk-det + cmp，3 列）（L3173 / L3180-3181）
- 头：`<b>情景触发条件 · 挂牌监测（情景规划Agent）</b><span>条件满足 → 自动升级情景并通知投资委员会</span>`。
- 列：`触发条件 | 升级动作 | 监测状态`。HTML 每行 `<td><b>{cond}</b></td><td>{act}</td><td><span class="rk-fchip" 琥珀>⏳ {state}</span></td>`（2 行，全监测中）。
- ➕**系统超集**：4 条 + 可执行 `expr` + `TRIGGERED` 态（高亮 `.trgTriggered` + 触发时间 + `notifiedTo`）——**保留**。`AnnualScenarioView.tsx:153-197` 已实现。

### 2.4 目标分解引擎（rk-det + dec-flow）（L3182-3184）
- 头：`<b>目标分解引擎 · 基准情景 1,580 万套（年 → 季 → 月）</b><span>分解口径：应用细分 → 产品族 → 型号族 · 2026-07 分解值 127.6 = S&OP 平衡台目标线（同源勾稽）</span>`——**header 内嵌 "1,580 万套"**（缺口：系统 header 无此数字；须取 `baseline.demand`，非写死）。
- `dec-flow`：`dec-q` 节点用 `<span class="dec-arrow">→</span>` 串联；节点 `<b>{q}</b><span>{v} 万套</span>` + 仅含 `months` 的节点带 `dec-m`（`<i>{m}月 {v}</i>`）。HTML：6 季跨 26/27，**仅 2026-Q3 有月明细**（127.6/128.0/126.4）。
- ➕**系统超集**：year 根节点 + 单年 4 季 + **每季 12 月全展开** + `targetRef` 悬停溯源 popup——**保留**（`AnnualScenarioView.tsx:200-268`）。
- footnote：`{linkRules('AOP 拍板即生成「目标线」：逐级分解为季度/月度目标，月度 S&OP 三线差异以此为基准（C21 偏差提报）；实际经计划差异逐级汇总回流。')}`——**含 C21 行内规则链接**（缺口#14：系统 footnote 为纯文本）。

## 3. UX 规格（交互 · 状态 · 流）
| 交互 | 触发 | 行为 | 现状 |
|---|---|---|---|
| 进入视图 | renderer mount | `useQuery(["a","plan-aop",{year}])` → `GET /a/v1/plan/aop?year=` | ✅ 但 year 写死 2027 → **须读 ViewDef layout.year** |
| 悬停规则编号 | `RuleRef` onmouseenter | 弹规则定义（key/name/expr/severity/scope/version）；onmouseleave 收 | ◐ 仅徽章点击有 explanation，缺 prose 行内悬浮 |
| 点规则徽章（超集） | `setOpenRule` | 展开真引擎 explanation（C23 由 capex 项目级驱动） | ✅ 保留 |
| 悬停分解节点 | decNode onMouseEnter `hover(e,targetRef)` | 浮层 `同源目标对象：{ref}（= S&OP 平衡台目标线）`；onMouseLeave 收 | ✅ 保留（超集） |
| 拍板情景 | `scen-finalize-{key}` onClick | `createActionDraft({actionTypeKey:'AOP情景拍板', payload:{scenarioId,scenarioKey,year,demand}, submit:true})` → toast + 进审批 | ✅ 保留（仅 catalog_admin ∧ act.aop-finalize） |
| 已拍板态 | `s.finalized` | 卡 `.pick` 高亮 + "已拍板 AOP" chip，无按钮 | ✅ 保留 |
| 触发态 | `t.status==='TRIGGERED'` | 行 `.trgTriggered` 绿底高亮 + "✓ 已触发" + 触发时间 + 已通知名单 | ✅ 保留（超集） |
| 窗口曲线 | render | 用 `capexScenario.demand/supply/gap/windows` 画季度需求/供给双线 + 缺口/过剩窗口着色带 | ❌ **加** |
| 角色门 | 非 catalog_admin / 功能关 | 无拍板按钮；`view.annual-scenario` 关 → 404 `FEATURE_NOT_FOUND`（先于 authz） | ✅ 保留 |

## 4. 数据规格（值 + 来源 + 系统字段级落地）
> 前端**零写死**（R14）；每个数据点分类：①实例→种子物化 ②阈值→config/ViewDef ③公式→求解器 ④文案→i18n ⑤结构→ViewDef。

### 4.1 三情景 `AOP_SCEN`（①种子 · battery.ts generatePlanDomain · HTML L3150-3154 逐字）
| key | n | c（②色）| dem（①）| note（①④）| cap 产能决策（①④）| lta 长协锁量（①④）| rev | capex | irr | c18 | c23 | pick |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| conservative | 保守 | `#7C8896` | 1420 | 乘用车增速放缓 +8% | 现有 12 基地 + 爬坡即可，不新增产线；利用率 81% | 正极锁 70%（8.8 万吨） | 3050 | 0 | — | 最稳 | — | false |
| baseline | 基准 ★ | `#54B5C4` | 1580 | +18% · 储能放量 | 枣庄 +1 条储能线（2026-Q4 动工 · 2027-Q3 投产）；Q2–Q3 6 周窗口缺口以外协过渡 | 锁 80%（11.2 万吨）+ 10% 价格联动 | 3400 | 14 | 19% | 达标 | 通过 | **true** |
| aggressive | 激进 | `#E8B54A` | 1760 | +31% · 海外大单落地 | 枣庄储能线 + 江门动力线（同步动工）；人力提前 2 季招训 | 锁 85% + 前驱体二级锁定 | 3780 | 27 | 17% | 黄色提示 | 通过 | false |
> 注：HTML 卡名带 `★`（"基准 ★"内嵌字符串 L3152）；系统用 `.pick` 描边 + "已拍板 AOP" chip 表达，名字段不含 ★（保留系统做法，§9 允许）。`SCEN_COLORS`（`AnnualScenarioView.tsx:16-20`）已与 c 精确一致。

### 4.2 触发条件 `AOP_TRIGGERS`（①种子 · HTML L3155-3158 逐字 · 2 条）
| cond 触发条件（①④）| act 升级动作（①④）| state 监测状态（①④）| on |
|---|---|---|---|
| 海外大单签约（≥80 万套/年）| 激进情景升级：江门动力线动工 | 监测中 · CRM 商机阶段 B | false |
| 储能需求连续 2 季 > 基准 +8% | 枣庄二期评审启动 | 监测中 · 当前 +5.2% | false |
> 系统现有 4 条（不同口径 + expr + 一条 TRIGGERED，battery.ts:1239-1270）。§9 裁决：**演示口径以 HTML 2 条为准对齐**，保留 expr/状态机超集；如保留系统 4 条则须在 §9 记差异。

### 4.3 目标分解 `AOP_DECOMP`（①种子 · HTML L3159-3162 逐字 · 6 季跨年）
| q | v（万套）| months |
|---|---|---|
| 2026-Q3 | 382 | 07月 127.6 · 08月 128.0 · 09月 126.4 |
| 2026-Q4 | 398 | —（仅季）|
| 2027-Q1 | 372 | — |
| 2027-Q2 | 404 | — |
| 2027-Q3 | 428 | — |
| 2027-Q4 | 452 | — |
> HTML 无 year 根节点、6 季跨 2026/2027、仅 Q3 有月。**关键勾稽**：2026-07 = **127.6** = S&OP 平衡台目标线（`AOP_DECOMP[0].months[0].v` L3160 注释）。系统是 year 根 + 单年 4 季 12 月全展开（超集），值由 `seasonal[]` 派生。§9 裁决严格度。

### 4.4 求解器口径（③ · 确定性 R6）
- **needs 派生**（HTML 静态，系统活算）：`revenue = demand × avgUnitPrice / 10000`（万套×元/套→亿，`battery.ts:1186`）；保守/激进 dem = `annualBase × {0.88 | 1.18}`（`battery.ts:1203-1205`，§4.5 须对齐到演示 1420/1760）。
- **capex_scenario（C1）**（`capex.ts:152+` · `planviews.ts:118-181`）：需求曲线 `D[q] = annualDemand × Σseasonal(该季3月)/12`；供给 `S[q] = S0[q] + Σ项目爬坡`（S0 由 `deriveS0` 月聚合×3 上卷）；缺口 `G[q] = D[q] − S[q]`；窗口 `连续≥gapMin 季 G>0 → kind:'gap'`、`G < −surplusPct·S（默认 0.05）→ kind:'surplus'`（`capex.ts:182-199`）。
- **C23 判定**（`planviews.ts:67-73`）：有项目情景 → `每项目 IRR≥irrMin(0.15) ∧ util24≥util24Min(0.75)`，全过才 C23 通过；explanation 由项目级实测拼装。无项目（保守）沿用规则引擎 explanation。
- **portfolioIrr**（`planviews.ts:171-173`）：`Σ(irr×cap) / Σcap`（产能加权），`finance.irr = portfolioIrr/100`（前端 ×100 显示）。
- **C18**：走真规则引擎 `rules.evaluate(['C18','C23'], {AnnualScenario:props,...props})`（`planviews.ts:61-65`）；现金安全垫输入来自种子 `cashCushion`。

### 4.5 ★系统字段级落地（现状 → 须改/须加，精确）
> 系统已活、参数化、超集；缺口是**视觉/数据对齐 + 1 个接线 bug**。逐条：

**A. 修年份接线 bug（🔴 P0，§0 断点 G-年份）**
- 现状：前端 `AnnualScenarioView.tsx:13` `const YEAR = 2027;` 硬编码，`useQuery` 用它请求 `?year=2027`；但种子只种 `year=2026`（`battery.ts:1183`），ViewDef `service.ts:1020` `layout.year:2026`，端点默认 `y = year ?? 2026`（`planviews.ts:47`）。请求 2027 → `scenarioObjs` 过滤 `num(year)===2027` 得空（`planviews.ts:48-50`）→ 三卡全空。
- 改：**前端读 ViewDef `layout.year`**（经 `ViewRendererProps`，不再写死）；缺省回退种子年。同时 i18n `zh.aop.title` 已是 `(year)=>…`（L171），传入对齐后的年。**禁止**简单把前端改成 2027 或把种子改 2027——须三处一致且经 ViewDef 下发（R5/R14）。**HTML 标题文案是 "AOP 2027"（L3176）**：若 1:1 要求标题显 2027 而数据为 2026，§9 须裁决（推荐：种子年与 ViewDef 同步成演示年，标题随之）。

**B. 加 `note` 字段（缺口#3）**
- 契约：`planviews.ts AnnualScenarioSchema`（L8-47）加 `note: z.string().optional()`（additive；回写本体 §2.B）。
- 端点：`planviews.ts:79-92` scenario 推送对象加 `...(s.props.note ? { note: str(s.props.note) } : {})`。
- 种子：`battery.ts:1187-1201` `scenario()` 工厂加 `note` 参数 → 三调用（L1203-1205）填 §4.1 note 串（保守"乘用车增速放缓 +8%" / 基准"+18% · 储能放量" / 激进"+31% · 海外大单落地"）。物化路径须把 note 写入 `AnnualScenario` 对象 props（查 `materializePlanDomain` 落库映射，确保 note 透传）。
- 前端：`AnnualScenarioView.tsx` `scen-big` 下加 `<div className={styles.scenNote}>{s.note}</div>`（`.scenNote` 已存 CSS L39-43，仅未用）。

**C. 加 "三情景对比" chip（缺口#2）**
- 纯 ⑤结构 + ④文案：`AnnualScenarioView.tsx:33-40` head 右侧加 `rk-hsel` 容器 + `<span class="tier-chip on">{zh.aop.tierChip}</span>`。i18n 加 `tierChip:"三情景对比"`。CSS 须加 `.tierChip`（参照 HTML `.tier-chip.on` 描边态）——`PlanViews.module.css` 无此类，补一条（色可调）。

**D. 加行内规则悬浮（缺口#8/#14）**
- **复用现成 `RuleRef`**（`components/RuleRef.tsx`，悬浮弹真规则定义 = HTML `showRulePop` 等价超集）。
- rk-sub「C23 门槛校验」：把字面 `C23` 包成 `<RuleRef code="C23" />`（`AnnualScenarioView.tsx:37` 当前纯文本）。
- 规则校验行：保留可点徽章（超集 explanation），**额外**在 c18/c23 文案处用 `RuleRef`，或将 prose "C18 现金安全垫 · C23 产能建设门槛" 渲染为含 `<RuleRef>` 的行内串（与 HTML `linkRules` 等价）。
- 分解 footnote：`zh.aop.decompFootnote`（L193 "分解值 = S&OP 平衡台目标线…"）扩成 HTML L3184 全文，内嵌 `<RuleRef code="C21" />`。

**E. 分解 header 数字（缺口·HTML L3182）**
- `AnnualScenarioView.tsx:214` `section-title` 当前 `zh.aop.decompSection`（"目标分解流（年→季→月）"）。改为含 **"基准情景 {baseline.demand.toLocaleString()} 万套"**——`baseline = data.scenarios.find(s=>s.key==='baseline')`，**取数据非写死**。i18n 加 `decompTitle:(dem)=>…`。

**F. 缺口/过剩窗口曲线（缺口#13）**
- 数据**已在** `data.scenarios[baseline].capexScenario.{quarters,demand,supply,gap,windows}`（契约 L23-46 已含，端点 L163-170 已产）。
- 前端**未画**。新增轻量 SVG 折线组件（或复用 `ProjectSimView.tsx` 若已有 capex 曲线渲染——已确认其 import capexScenario，研发先查可复用度）：横轴=`quarters`、需求线（蓝）、供给线（青）、`windows` 按 `kind` 着色带（gap 红 / surplus 绿）。挂在基准卡下或分解段上方。**零写死**：全部读 `capexScenario`。
- 兑现 rk-sub "缺口/过剩窗口" 承诺（当前文案有、图无）。

**G. 种子值对齐演示口径（缺口#5/#6/#11/#12，§9 裁决严格度）**
- `battery.ts:1203-1205` 三情景 dem 现 `annualBase×{0.88|1.18}`（依 `weeklyTotalWan×52`）→ 若严格 1:1，须令物化 dem = **1420/1580/1760**（经种子参数，非前端）。
- 产能决策/长协串现"合肥四期/盐城二期/锂盐长协 60/70/85%"→ 对齐 HTML"枣庄/江门/正极锁 70%·锁 80%+价格联动·锁 85%+前驱体"。
- 触发 4 条 → 对齐 HTML 2 条口径（或保留 4 条 + §9 记差异）。
- 分解：HTML 6 季跨年 + Q3-only 月 vs 系统单年 12 月——§9 已定"保留系统超集结构，header 数字对齐"。
- **2026-07 = 127.6** 须可勾稽（系统 `seasonal` 派生月值须令 2026-07 ≈ 127.6，或将该锚作为种子约束）。

### 4.6 数据资产（完整 · 作种子/i18n；研发逐字录）
- **AOP_SCEN**（①④②）：HTML L3150-3154 三对象逐字，含 c/dem/note/cap/lta/rev/capex/irr/c18/c23/pick（§4.1 全表）。
- **AOP_TRIGGERS**（①④）：HTML L3155-3158 二对象逐字（§4.2）。
- **AOP_DECOMP**（①）：HTML L3159-3162 六季 + Q3 月（§4.3），勾稽 127.6。
- **i18n 新增**（④ · `locales/zh.ts` aop 块 L170-195）：`tierChip:"三情景对比"` · `decompTitle:(dem)=>\`目标分解引擎 · 基准情景 ${dem} 万套（年 → 季 → 月）\`` · `decompFootnote` 扩为 HTML L3184 全文（含 C21）· rk-sub 文案已基本一致（L37）须内嵌 `RuleRef`。
- **窗口曲线文案**（④）：轴标 "万套/季" · 图例 "需求 / 供给 / 缺口窗口 / 过剩窗口"。

## 5. 契约 / 端点
- `contracts/planviews.ts`：`AnnualScenarioSchema` 加 `note?: string`（L8-47，唯一契约新增，additive）。`AopResponseSchema`/`capexScenario`（含 quarters/demand/supply/gap/windows/projects）**已就绪**，不改。
- 端点：复用 `GET /a/v1/plan/aop?year=`（`app.ts:2564` → `PlanService.aop` L46）；前端 year 来自 ViewDef `layout.year`（`service.ts:1020`），不写死。
- 拍板：复用 `POST /a/v1/action-drafts`（`actionTypeKey:'AOP情景拍板'`，`app.ts:335-339` 真实落库 → `aop.finalized`）。
- 仓储：`AnnualScenario` 加 `note`（合成产出，无新表；查 `repo/pg.ts` + `repo/memory.ts` 若 AnnualScenario 走通用 ObjectInstance props 则无需迁移，否则同步两实现）。
- Feature：`view.annual-scenario`（bindings: plan-aop / capex_scenario，`features.ts:23`）· `act.aop-finalize`（requires view.annual-scenario，`features.ts:70`）——不动。

## 6. 融合集成点（5 处，不绕过）
1. **Renderer**：`registry.ts`（renderer key `annual-scenario` → `AnnualScenarioView`）——增强不重建。
2. **ViewDef**：`synthetic/service.ts:1017-1021`（`layout.{endpoint,year,actionTypeKey,finalizeFeature}`）——前端须**消费 year**（修接线）。
3. **Feature/Entitlement**：`features.ts:23/70`（view.annual-scenario / act.aop-finalize 级联）——关闭→404 先于 authz（`planviews.test.ts:159`）。
4. **种子/物化**：`battery.ts generatePlanDomain` + `materializePlanDomain`（note 透传落 props）。
5. **Action 写回**：`app.ts:335-339` `AOP情景拍板` 真实落库 + `aop.finalized` outbox。
**复用现有 AnnualScenarioView + RuleRef，增强不重建。**

## 7. 验收（DoD = 真 1:1）
- **像素核对**：与 HTML aop 页并排，逐元素勾——三情景卡（含 **note 行**）/顶边色/已拍板 chip/**三情景对比 chip**/财务行/**规则校验行内悬浮**/触发表 3 列/**分解 header "基准情景 1,580 万套"**/年→季→月节点/**127.6 勾稽**/footnote 含 C21/**缺口窗口曲线**，**结构/值/字符串/交互全一致**（色/字可不同）。漏一项不过。
- **交互**：进入有数据（年份接线修复，**视图非空**）· 悬停规则编号弹定义 · 点徽章出真 explanation · 悬停分解节点出 targetRef 溯源 · 拍板出 Action 草稿进审批 · TRIGGERED 行高亮——逐项 FDE 亲手跑（起真后端 + 前端，截图留证）。
- **系统超集保留**：项目测算（C1 IRR/util24/C23）· 真规则 explanation · 拍板审批 · TRIGGERED+通知 · 分解 targetRef 溯源——全在不退化。
- **数据**：前端零写死（`debattery:check` 不超基线）· 种子值 = HTML 精确（§9 范围内）· 同 seed 字节一致（R6）· 每数可溯（R13，targetRef）· note/dem/触发/分解经合成→端点产出。
- **接线**：前端 year 经 ViewDef `layout.year`，三处（前端/ViewDef/种子）一致；请求年有数据。
- `pnpm -r build && pnpm -r test` 全绿（`planviews.test.ts` + `capex.test.ts` + `f21.annual-scenario.test.tsx` + AnnualScenario.note 双仓储 + 角色门）· `chain:check` / `ontology:check` 过。
- 回写本体 §2.B（AnnualScenario.note）。

## 8. 实施任务（研发可直接拆）
1. **契约**：`planviews.ts AnnualScenarioSchema` 加 `note?`（additive）。
2. **种子**：`battery.ts generatePlanDomain` `scenario()` 加 note 参数 + 三调用填值；dem/产能决策/长协对齐演示口径（§4.5 G + §9）；确认 `materializePlanDomain` 把 note 落 `AnnualScenario` props。
3. **端点**：`planviews.ts:79-92` 透传 `note`（条件 spread）。
4. **接线修复**：`AnnualScenarioView.tsx` 删 `const YEAR=2027`，改读 ViewDef `layout.year`（经 props）；i18n title 传对齐年；ViewDef `service.ts:1020` year 与种子同步成演示年（§9 定）。
5. **前端补齐**：① note 行（`.scenNote`）② 三情景对比 tier-chip（+CSS `.tierChip`）③ rk-sub/规则校验/footnote 用 `RuleRef`（C18/C21/C23 行内悬浮）④ 分解 header 取 `baseline.demand`⑤ **缺口/过剩窗口曲线**（消费 `capexScenario`，先查 `ProjectSimView` 可复用度）。
6. **i18n**：`zh.ts` aop 块加 `tierChip` / `decompTitle(dem)` / 扩 `decompFootnote`（含 C21）。
7. **仓储**：若 AnnualScenario 非纯 ObjectInstance props，同步 `repo/pg.ts` + `memory.ts` + 接口 + migration。
8. **回归**：`planviews.test.ts`/`capex.test.ts`/`f21.annual-scenario.test.tsx` 补 note + 年份接线断言；FDE 亲手跑 + 截图。

## 9. 1:1 尺度与不确定性（诚实声明）
- **裁决基线**（沿用结构 PRD §9，全局标准）：**100% 1:1 复刻** = HTML 精确演示数值/字符串/结构/交互逐项还原（dem 1420/1580/1760、note 三串、产能决策"枣庄/江门"、触发"海外大单≥80万套"、分解 382/398/127.6、Q3-only 月、三情景对比 chip、缺口窗口曲线、行内规则链接全对齐）；**唯色调/字体可调**。这些值/串作**电池域生成器种子配置**产出，走管线（R14/R6），系统超集保留为底层实现，**可见输出与 HTML 100% 一致**即可。
- **须人裁的 3 点不确定性**：
  1. **标题年份 2026 vs 2027**：HTML 标题硬编码 "AOP 2027"（L3176）但分解季多在 2026（2026-Q3/Q4）+ 系统种子/ViewDef 全 2026。建议：种子年 + ViewDef + 标题统一为**演示年**（取 2027 则种子须改种 2027 且分解锚 2026-07=127.6 的跨年逻辑保留；取 2026 则标题文案随 i18n 改）。**不可只改前端常量**（违 R5/R14）。
  2. **触发 2 条 vs 4 条**：HTML 2 条（海外大单 / 储能 2 季），系统 4 条（+ 长协偏差 / 锂价，且一条 TRIGGERED）。若严格 1:1，对齐 HTML 2 条；若保留 4 条超集，须在交付说明记差异并经用户确认。
  3. **分解结构**：HTML 6 季跨 26/27 + 仅 Q3 有月 vs 系统单年 4 季 + 12 月全展开 + 溯源。结构 PRD §9 已定"保留系统超集结构、header 数字对齐"——本文沿用；若用户要严格 6 季跨年布局，则前端分解渲染须重排（成本更高，记为可选项）。
- **已确认无歧义**：SCEN_COLORS 精确一致；capexScenario 曲线数据已就绪（仅缺前端画）；RuleRef 可直接复用替代 linkRules；note 字段 + 三情景对比 chip + footnote C21 为纯增量低风险。

> 本 PRD 是"参考原型全视图 1:1 复刻"队列项（aop）；样板深度同 `PRD-IND-plan-generate.md`。基线分支小（契约一字段 + 种子 + 前端补渲染 + 接线修复），冲突面低。
