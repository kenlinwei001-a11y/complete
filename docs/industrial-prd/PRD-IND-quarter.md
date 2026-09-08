# 工业级 PRD · 季度滚动看板（quarter / `quarterly-rolling`）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 数据）。**只读本文 + 像素参照 HTML 即可 1:1 实现**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`：种子 `Q_ROLL` L3187-3194 / `Q_LTA` L3195-3199 · 渲染 `buildQuarter` L3200-3218。本文已把其全部常量/公式/交互转录,研发以本文为准、HTML 仅作像素核对。 |
| 落点（融入,不新建） | 前端 `apps/frontend-shell/src/views/plan/QuarterlyRollingView.tsx`（renderer `quarterly-rolling`,154 行,**已近 1:1**）· 后端管线 `apps/datacore/src/planviews.ts:240 quarterlyFromContext` + `:350 ltaDeviation` · 种子 `apps/datacore/src/synthetic/battery.ts`（`planview` :171 / `shipments` :1128 / `scenarios.baseline.projects` :156 / `generatePlanDomain` :1174）· 契约 `packages/contracts/src/planviews.ts:76 QuarterlyResponseSchema` · 复用结构 PRD `docs/PRD-quarter-rolling-1to1.md` |
| 不变量 | R14（前端零写死,值来自管线;HTML 精确值仅作生成器种子）· R6（同 (industry,scale,seed) 季度曲线字节一致）· R13（每季 dem/sup 可溯 rollup/项目/决议;LTA 溯 Shipment）· R-一致（产能口径与 AOP/risk/S&OP 同源,一处 C02）· 1:1=结构/数据/交互 100%,**唯色调/字体可调** |

> **一句话定位**：本视图是全 19 视图里**离 1:1 最近的一个**——`QuarterlyRollingView` 已具备「需求/供给双条 + 缺口三档(>4红/>0黄/≤0绿) + 事件含规则深链 + 长协执行偏差表(首行越线→升级) + 行尾跳风险看板」,且**完全走管线**（`quarterlyFromContext`:rollup×认证×检修曲线 13 周聚合 + 已批准项目爬坡 + S&OP 决议增量 + PlanTarget 同源需求 ∥ Shipment 派生 LTA）。**缺口不在结构/交互,而在精确值与事件文案**:1:1=100% 要求 6 季 `dem/sup` 与事件叙事字字还原 HTML——做法是**调生成器种子**让管线实算出 HTML 的 382/376…452/448 与 LTA −8.0%,**而非前端写死**。本 PRD 把缺口拆成字段级可执行项。

---

## 0. 本体引用与影响（强制，沿链路走）

- **触及对象类型**（§2.E）：`CapexProject(枣庄储能线)`（生成器种子,承接 AOP/capex_scenario,现种子为合肥四期/盐城二期）· `PlanTarget(quarter level)`（需求同源,`generatePlanDomain` 派生）· `Shipment`（LTA 偏差派生,`battery.ts:1128`）· `SopVersion.resolutions`（FINAL 决议增量入季度供给）· `AnnualScenario(baseline finalized)`（决定已批准项目集）· `Rule(C03 交付高峰/C08 外协上限/C16 安全库存)`。
- **触及链路**（§3）：`computeRollup(产线→基地周产能 weeklyWan) ×认证系数 ×检修曲线 curveMult →13周季聚合 + Σ已批准项目爬坡(枣庄) + ΣS&OP决议增量 = 季供给` ∥ `PlanTarget年度分解(annualBase=weeklyTotalWan×52→季节化) + 滚动修正corr + 2027 YoY外推 = 季需求` → `缺口三档 + 事件注释` ∥ `Shipment → ltaDeviation(首行强制越线→跳风险看板)`。与 **AOP / 产能推演 / S&OP 同源**（一处产能口径 C02）。
- **触及事件/数据流**（§4）：只读查询面 `GET /a/v1/plan/quarterly?from&n`（`app.ts:2569`,entitlement tag `plan-quarterly`）;事件携 `ruleKey`,前端按 key 拉 `GET /a/v1/rules` 展开规则表达式;LTA 越线 → `scanSupplyRisk` 发 `supply_risk` 事件（与风险看板「到货间隙」同源）。
- **触及不变量**（§5）：R14（缺口阈值/物料/事件文案配置化,HTML 精确值仅作生成器种子,前端零业务常量）· R6（同 (industry,scale,seed) 季度曲线字节一致,无时钟/随机）· R13（每季 dem/sup 可溯 rollup/项目/决议;LTA 溯 Shipment）· R-一致（产能口径与 AOP/risk/SOP 同源,改种子需同跑这些视图防漂移）。
- **关闭/影响断点**（§8）：**G-5**——本视图已基本脱电池锁死（`gapTiers`/`ltaEscalatePct` 经 ViewConfig 下发,常量仅兜底）;本 PRD 补段头副标注与一处事件文案口径的最后硬编码。
- **门禁**（§7）：`debattery:check`（前端零业务常量）· `chain:check`（capacity_rollup/quarterly 已注册）· 前端回归（`f22.quarterly-rolling.test.tsx` + `quarterly-rolling-view` testid）· FDE 亲手跑（核对 6 季精确值）。
- **回写承诺**：若新增"枣庄储能线"为标准电池域 baseline CAPEX 项目种子 → 回写本体 §2.E 对象实例样例;若 `ltaMaterials` 调序/裁剪 → 回写 §2.E Shipment 物料样例。

---

## 1. 视图概述

**4–6 季滚动看板**（默认 `from=2026-Q3, n=6`）:把年度分解的目标线（PlanTarget）落到季度,与**实算供给曲线**（产能爬坡×认证×检修 13 周聚合 + 已批准项目投产 + S&OP 决议增量）逐季对照,产销缺口三档着色;每季挂事件注释（检修窗口/交付高峰/到货间隙/产能增量/决议增量,带规则深链）;下方「长协执行偏差表」对照 SRM 长协计划 vs WMS 实际到货,偏差 >±5% 的物料升级供应风险 Agent 并提供「跳风险看板」深链。**承接年度分解、向月度再分解,是 AOP→S&OP 的季度接缝视图。系统只摆缺口与偏差,决策(扩产/外协/加急)由人拍板。**

**系统超集**（不破坏 1:1,作为增强保留）:行尾「查看风险看板 →」按钮、规则表达式内联展开、动态季数(n 可 1–8)。

## 2. UI 规格（布局 · 像素结构）

### 2.1 整页（`buildQuarter` L3200,容器 `#qwrap`）
```
┌ rk-top ─────────────────────────────────────────────────┐
│ <h3>季度滚动看板 · {首季} ~ {末季}</h3>                    │
│ rk-sub: "4–6 季滚动 · 产品族×基地 · 产能爬坡 vs 需求曲线   │
│   · 承接年度分解、向月度再分解"                            │
│ 右 rk-hsel: [■ 需求 (#7E8BEE)] [■ 供给 (#54B5C4)]  (图例)  │
└──────────────────────────────────────────────────────────┘
┌ rk-det「产能爬坡 vs 需求（万套/季）」 ────────────────────┐
│  副标: "枣庄储能线 2027-Q3 投产 +22 万套/季 · 与年度基准  │
│        情景同源"                                          │
│  qbars: 6 × qbar（每季一组,见 2.2）                       │
└──────────────────────────────────────────────────────────┘
┌ rk-det「长协执行偏差 · 本季」 ────────────────────────────┐
│  副标: "SRM/长协 vs WMS 实际到货 · 偏差>±5% 升级供应风险" │
│  table.cmp: 表头[物料|长协计划|实际到货|执行偏差|说明]     │
│    3 行（三元正极 / 隔膜 / 电解液,见 2.3）                 │
│  dl-hint: "正极 −8.0% 偏差与预警大屏「到货间隙」事件同源; │
│    已在月度 S&OP 第⑤步决议加急 200 吨对冲。"             │
└──────────────────────────────────────────────────────────┘
```
- HTML 标题写死"2026-Q3 ~ 2027-Q4"(L3210),系统已改为动态 `{rows[0].q} ~ {rows[n−1].q}`(`QuarterlyRollingView.tsx:48-50`)——结果同,**保留动态**。

### 2.2 单季条组 `qbar`（`buildQuarter` L3202-3206;系统 `QuarterlyRollingView.tsx:62-100`）
```
┌ qbar ──────────────────────────────────────┐
│ qbar-lbl: <b>{q}</b>  <span 缺口徽章>        │  ← 徽章色=三档(见 §4.1)
│ qbar-tr:  [■■■■■■■■░░] 需求条 #7E8BEE        │  ← width=dem/maxV×100%,title="需求 {dem}"
│ qbar-tr:  [■■■■■■■░░░] 供给条 #54B5C4        │  ← width=sup/maxV×100%,title="供给 {sup}"
│ qbar-ev:  {事件文案} [规则徽章 ruleKey]      │  ← linkRules() 把 Cxx 转可点深链
└─────────────────────────────────────────────┘
```
- **缺口徽章文案**：`gap>0 ? "缺 "+gap : "冗余 "+(−gap)`（HTML L3203;系统 `zh.quarter.gap/surplus` :202-203）。
- **缺口徽章色**：`gap>4 → #DD7E9E(红) · gap>0 → #E8B54A(黄) · gap≤0 → var(--quality)(绿)`（HTML L3203;系统 `TIER_COLOR`+`tierOf` :19/:25,阈值取 `view.layout.gapTiers`）。
- **maxV**：HTML 固定 `470`（L3201）;系统动态 `Math.max(...all dem/sup)×1.06`（:36）。**比例视觉接近**,1:1 不要求 maxV 一致(纯渲染缩放,§7 列为"色/字可调"同级)。
- **事件多条**：系统 `r.events[]` 数组逐条 `<div>`;每条若带 `ruleKey` 渲染规则徽章按钮(点击展开表达式,§3)。HTML 每季单串文案,内嵌 `linkRules` 自动识别 Cxx。

### 2.3 长协偏差表行（`buildQuarter` L3207-3208;系统 :119-147）
| 列 | 内容 | 色/格式 |
|---|---|---|
| 物料 | `<b>{material}</b>` | — |
| 长协计划 | `{planned.toLocaleString()} 吨/季` | 千分位 |
| 实际到货 | `{actual.toLocaleString()}` | 千分位 |
| 执行偏差 | `{dev>0?'+':''}{dev.toFixed(1)}%` | `|dev|>5 → 红(#DD7E9E) 否则绿`,**font-weight:700**;系统越线追加 `升级供应风险` 红徽章 |
| 说明 | `{note}` | — |
| (超集) | 越线行尾 `查看风险看板 →` 按钮 | 系统 `gotoRisk(baseId)` |

## 3. UX 规格（交互 · 状态 · 流）

| 交互 | 触发 | 行为 |
|---|---|---|
| 加载 | 挂载 | `useQuery(["a","plan-quarterly",{from:"2026-Q3",n:6}])` → `fetchQuarterly` → `GET /a/v1/plan/quarterly`;loading 出 `zh.common.loading` |
| 看缺口 | 渲染 | 每季缺口徽章按三档着色 + 文案"缺/冗余 N";条宽按 dem/sup÷maxV |
| 悬停条 | hover `<i title>` | 原生 tooltip"需求 {dem}"/"供给 {sup}" |
| 展开规则 | 事件规则徽章 onClick `setOpenRule` | 切换 `openRule=q:ruleKey`;展开拉 `GET /a/v1/rules` 找 `key===ruleKey` 显 `expression`(mono);再点收起。HTML 同效 `linkRules`→`ruleTip` |
| 看偏差 | 渲染 LTA 表 | 三行;`|dev|>5` 行偏差列变红+`升级供应风险`徽章 |
| 跳风险看板（超集） | 越线行 `查看风险看板 →` onClick `gotoRisk(baseId)` | `setSelectedObjects([{Base, base-{id}}])` → `navigate(/v/risk?focus={baseId})`,把基地写入对话上下文 |
| 空/错误 | `isLoading||!data` | 占位 loading;契约校验失败由全局错误信封兜底 |

- **状态**：唯一交互态 `openRule`(当前展开的规则)与查询缓存;无表单/可变输入(纯只读看板)。
- **确定性**：同 seed 下 6 季曲线、LTA 三行字节一致(R6),无时钟依赖。

## 4. 数据规格（值 + 来源 + 系统字段级落地）

> 前端**零写死**(R14);所有值来自:①合成种子→管线实算物化 ②config/种子参数(`planview`) ③求解器口径(`quarterlyFromContext`/`ltaDeviation`) ④i18n(`zh.quarter`) ⑤ViewDef(`layout.gapTiers`/副标注)。HTML 的 `Q_ROLL`/`Q_LTA` 精确值**仅作生成器对齐目标,不入前端**。

### 4.1 缺口三档阈值（⑤ViewConfig.layout.gapTiers · ②种子兜底）
| 档 | 条件 | 色（HTML / 系统 token） |
|---|---|---|
| 红 | gap>4 | `#DD7E9E` / `var(--danger)` |
| 黄 | gap>0 | `#E8B54A` / `var(--amber)` |
| 绿 | gap≤0(冗余) | `var(--quality)` / `var(--ok)` |
- 系统 `gapTiers={red:4,yellow:0}`(`QuarterlyRollingView.tsx:24`),由 `view.layout.gapTiers` 下发,常量仅兜底——**已 R14**。

### 4.2 ★HTML 6 季精确值 `Q_ROLL`（L3187-3194,**生成器对齐目标,逐字**）
| qi | 季 | dem | sup | gap | 事件叙事(HTML `ev`) |
|---|---|---|---|---|---|
| 0 | 2026-Q3 | **382** | **376** | 缺 6 | 常州夜班常态化 · 江门齐套治理 |
| 1 | 2026-Q4 | **398** | **390** | 缺 8 | 枣庄储能线动工（CAPEX 14亿） |
| 2 | 2027-Q1 | **372** | **392** | 冗余 20 | 春节检修季 · 供给冗余回补库存 |
| 3 | 2027-Q2 | **404** | **396** | 缺 8 | 6 周窗口缺口 → 外协过渡（≤20% **C08**） |
| 4 | 2027-Q3 | **428** | **430** | 冗余 2 | 枣庄线投产 +22/季 · 爬坡 60%→90% |
| 5 | 2027-Q4 | **452** | **448** | 缺 4 | 枣庄满产 · 江门线视触发条件 |

### 4.3 ★HTML 长协偏差 `Q_LTA`（L3195-3199,逐字）
| 物料 | plan(吨/季) | act | dev | note |
|---|---|---|---|---|
| **三元正极** | 2800 | 2576 | **−8.0%** | 到货延迟 · 触发到货间隙事件（首行越线→升级→跳风险看板） |
| 隔膜 | 820 | 828 | +1.0% | 正常 |
| 电解液 | 1900 | 1862 | −2.0% | 正常 |
- 校验：2576 = round(2800×(1−0.08),1) ✓ · 828 = 820×1.01 ✓ · 1862 = 1900×0.98 ✓ → **act 由 plan×(1+dev/100) 派生,种子只需对 plan 与 dev 下手**。

### 4.4 求解器口径（③`quarterlyFromContext` plan.ts→planviews.ts:240,确定性 R6）
- **供给** `sup`(:285-307)：Σ_base [ weeklyWan × certFactor × Σ_{w∈季13周} curveMult(p,w,maintWeek) ] + Σ项目爬坡净增量(cap×ramp[k]−cap×ramp[k−1]) + Σ本季 S&OP FINAL 决议增量。
  - `curveMult`(capacity.ts:158)：`w<5 → ramp.base+ramp.step×(w−1)`,`w≥5 → 1`;检修周 ×`maintMult(0.72)`。即季首 4 周爬坡(0.88→0.97),第 5 周起满载。
  - `certFactor`：每基地取已认证型号最优系数(`量产=1.0`/`认证中=0.6`)。
- **需求** `dem`(:308-318)：季度 PlanTarget(level=quarter) × (1+`rollingCorrPct[qi]`);2027+ 无目标季按 `2026 同季 ×(1+growthYoY)^yearsAhead` 外推;无目标兜底 = sup。
  - PlanTarget 来源(`generatePlanDomain` :1208-1222)：`annualBase = weeklyTotalWan×52` → 月值 = annualBase×seasonal[m]/12（末月吸收舍入）→ 季值 = 三月和。
- **缺口** `gap = dem − sup`(:318)。
- **事件**(:295-343,生成顺序)：① `unshift` 检修窗口(本季有检修基地,文案"检修窗口：{基地}（产能 ×0.72）") ② 项目爬坡增量("产能增量：{name} +{Δ} 万套（已批准项目爬坡投产）") ③ S&OP 决议增量 ④ 交付高峰(本季到期单 ≥`deliveryPeakMin(5)` → ruleKey **C03**) ⑤ 仅 qi=0 到货间隙("到货间隙：{ltaMaterials[0]} 长协实际到货偏差 {ltaForcedPct}%,升级供应风险",ruleKey **C16**)。

### 4.5 ★系统字段级落地（现状 → 须改/须加,精确）

> 系统已 R14 参数化,结构/三档/双条/LTA 表/跳风险/规则深链**全部到位**。缺口集中在**生成器种子对齐**让实算值=HTML,共 5 块。**做法是调种子让管线实算,严禁前端写死 6 季数值/事件文案。**

**(A) 季度需求/供给曲线对齐 → 调 `planview` 参数（`battery.ts:171-187`）·主块**
- 现状：`dem` 实算自 `annualBase=weeklyTotalWan×52` 季节化 ×(1+corr) ×YoY,`sup` 实算自 rollup 13 周×认证×检修——值取决于 weeklyWan/certFactors/maintWeek/seasonal,与 HTML 的 382…452 **未必相等**(且随 scale 变)。
- 须改（整定使实算=HTML 6 季,确定性可复现）：
  - `rollingCorrPct[6]`(:175,现 `[0.02,0.08,−0.06,0,0,0]`)：按"季度目标→dem"反解,使 qi=0..5 dem 命中 **382/398/372/404/428/452**。注意 372(2027-Q1=2026-Q1 同季×1.08^1 再×corr)需校 YoY 链。
  - `growthYoY`(:177,现 0.08)：2027 四季相对 2026 同季的同比;由 372/404/428/452 vs 2026-Q1..Q4 目标线反解一致系数(若四季不能同系数,改为按季 `rollingCorrPct` 吸收差额,保 growthYoY 为整体口径)。
  - `weeklyTotalWan` 基线（来自 rollup,经线/工序产能种子）+`certFactors`+`maintMult`+检修周(`maintWeekOf`)：整定使 13 周聚合供给逐季 = **376/390/392/396/430/448**。其中 2027-Q1=392(冗余,春节检修季供给回补)、2027-Q3=430(枣庄投产+爬坡)需与 (D) 项目增量联动。
  - `seasonal[12]`(:173)：保持季节形态(影响季内分配),主要由 corr/YoY 收敛绝对值。
- **不变量守护**：改 weeklyWan/certFactors/maintMult 会**同时影响 AOP/risk/S&OP/产能推演**(R-一致,共享 rollup);**必须同跑这些视图回归**,优先用 `rollingCorrPct`(本视图独占)吸收差额,最小化对共享口径的扰动。
- 诚实标注不确定性：6 季精确值是**多参数联立反解**,可能无法用纯连续参数严格命中整数 382/376…;**可接受策略**:把"目标线"(PlanTarget quarter 值)与 `rollingCorrPct` 作为本视图专属自由度,实算 dem 精确命中;sup 用 weeklyWan+项目增量逼近,残差≤1 万套视为达标(色档/叙事不变)。若需绝对精确,在 `planview` 增 `quarterOverride?:{q:{dem,sup}}` 配置位(仅本视图读,仍属②种子非前端写死)兜底——**优先反解,override 为最后手段**。

**(B) 枣庄储能线 CAPEX 项目种子（`battery.ts:156` baseline.projects)·关键**
- 现状：baseline finalized 项目集 = `[{id:"HF4",name:"合肥四期",q0:3,cap:3.5,ramp 缺省[0.5,.75,.9,1]}]`(经 `approvedCapacityProjects` :219 → `quarterlyFromContext` projInc)。
- 须改：把 baseline 项目改/增为 **枣庄储能线**,使其爬坡增量落在 2027-Q3/Q4 且文案=HTML:
  ```
  { id:"ZZ-ESS", name:"枣庄储能线", q0:4, cap:?, ramp:[0.6,0.9,1.0], capex:[14], m:1700, salvageRate:0.05, lifeQuarters:40 }
  ```
  - `q0=4`：相对窗口起点 2026-Q3(baseStartQ) 第 4 季 = **2027-Q3** 投产(`addQuarters("2026-Q3",4)`)。校 `quarterlyFromContext` projInc 标签算法(:265 `addQuarters(baseStartQ, proj.q0+k)`)。
  - `ramp:[0.6,0.9,1.0]`：2027-Q3 净增量 = cap×0.6,2027-Q4 净增量 = cap×(0.9−0.6),与 HTML"爬坡 60%→90%"(L3192)/"满产"(L3193)叙事一致;`cap` 取值使 2027-Q3 增量配合 (A) 命中 sup=430、2027-Q4 配合命中 448(净增量约 +22/季对应 HTML L3192 文案,实际入 sup 的是 cap×ramp 差值,需与基线供给联立)。
  - **动工注记 2026-Q4(CAPEX 14 亿)**(HTML L3189)：投产在 2027-Q3 但"动工"在 2026-Q4——项目种子无"动工季"字段;在 `planview` 增配置位或借 `capex:[14]` 与一条 2026-Q4 注记事件(经种子文案,非前端拼)。最简：在 `quarterlyFromContext` 项目循环外,对有 capex 的项目在 `q0−2`(动工季)注入"产能增量：{name}动工（CAPEX {capex}亿）"事件(口径同 §4.4②,文案由项目种子派生)。
- 项目增量事件现文案"产能增量：枣庄储能线 +{Δ} 万套（已批准项目爬坡投产）"——与 HTML"枣庄线投产 +22/季 · 爬坡 60%→90%"叙事**接近但不逐字**;需在事件模板中暴露 ramp 百分比(经种子),或调模板文案口径(④i18n,§4.5(E))。

**(C) 长协偏差 3 行对齐（`shipments` 种子 `battery.ts:1128` + `ltaMaterials` :184 + `ltaForcedPct` :186）**
- 现状：`ltaDeviation`(:350) 取前 `ltaMaterials.length` 条 Shipment(按 shipId 排序),首行 dev=`ltaForcedPct(−8)`、其余 `(hash%9)−4`(−4..4);`planned=qtyTons`(种子 `randInt(60,240)`);`material=ltaMaterials[i]`(现 `["碳酸锂","正极材料","负极材料","电解液","隔膜","铜箔"]` 共 6 条)。
- 须改(命中 HTML 三行 2800/820/1900 与 dev −8/+1/−2):
  1. `ltaMaterials` 裁/调为 **`["三元正极","隔膜","电解液"]`**(:184,只 3 物料 → LTA 表 3 行,与 HTML 一致;`ltaDeviation` 自动只取 3 条 Shipment)。
  2. 三行 `planned`(=`qtyTons`)须 = **2800/820/1900**:现 `qtyTons=randInt(60,240)` 量级不符。改 Shipment 种子使**前 3 条**(按 shipId 排序最小的 3 个基地)qtyTons = 2800/820/1900,或在 `planview` 增 `ltaPlanned:[2800,820,1900]` 配置位供 `ltaDeviation` 读(②种子,优先后者——明确专属、不扰动 Shipment 的 C16 齐套逻辑)。
  3. dev：首行 `ltaForcedPct=−8`(:186 已是 −8 ✓);第 2/3 行现走 `(hash%9)−4` 随机,须固定为 **+1.0/−2.0**——在 `planview` 增 `ltaDevPct:[-8,1,-2]` 配置位,`ltaDeviation` 第 i 行 dev 取 `ltaDevPct[i] ?? 原 hash 逻辑`(②种子,确定性,R6)。
  4. `actual` 由 `planned×(1+dev/100)` 实算(:356,已对) → 自动得 2576/828/1862 ✓。
  5. `note`：HTML 首行"到货延迟 · 触发到货间隙事件",其余"正常";系统现"到货缺口,升级供应风险(…)"/"正常波动"——口径对齐(④i18n,可调文案,语义已同)。
  6. `baseId`：首行(三元正极)须携基地(跳风险看板),取排序首 Shipment 的 baseId(现已带,:364)。

**(D) sup 与项目增量联动校验**：2027-Q3 sup=430、Q4=448 由"基线供给 + 枣庄爬坡净增量"构成;(A)定基线、(B)定增量,二者须联立反解。建议：先固定枣庄 cap/ramp(B),再用 weeklyWan/corr(A) 补足其余四季,最后微调使两季精确命中。

**(E) 事件文案口径对齐（④i18n / 事件模板，非前端拼写死）**
- 2027-Q2(qi=3) HTML 事件"6 周窗口缺口 → 外协过渡（≤20% C08）"携 **C08** 深链:系统现自动事件无此条。须经种子使该季触发"外协过渡"事件并挂 ruleKey=C08——最直接:在 `quarterlyFromContext` 对"缺口持续且需外协"的季注入一条 C08 事件(口径化:`if 本季 gap>0 且属外协窗口 → push {label:外协过渡文案, ruleKey:"C08"}`),文案与窗口由 `planview` 配置(②),非前端硬编码。
- 2026-Q3"常州夜班常态化 · 江门齐套治理"、2027-Q1"春节检修季 · 供给冗余回补库存"、2027-Q4"枣庄满产 · 江门线视触发条件":系统现生成"检修窗口/交付高峰"等口径化事件,文案与 HTML 叙事**不逐字**。1:1 要求叙事一致——通过(检修季配置使 2027-Q1 出检修事件 + 文案模板对齐)逼近;**诚实标注**:HTML 这些是手写叙事,系统是规则化生成,做到"语义+规则深链一致"是 1:1 底线,**逐字一致需把 HTML 叙事作为 ViewConfig 事件文案模板下发**(⑤,仍非前端写死)。

**(F) 段头副标注（⑤ViewConfig.layout.subNote · 前端微调）**
- 现状：产能爬坡卡副标缺失(系统 `section-title` 仅"产能爬坡 vs 需求（万套/季）",`QuarterlyRollingView.tsx:60`)。
- 须加：补副标 **"枣庄储能线 2027-Q3 投产 +22 万套/季 · 与年度基准情景同源"**(HTML L3213),取 `view.layout?.subNote`(后端 VIEW_DEFS 下发),前端零硬编码;`zh.quarter` 增 `subNote` 兜底键。同理 LTA 表副标"SRM/长协 vs WMS 实际到货 · 偏差>±5% 升级供应风险"已有(`zh.quarter.ltaHint`)。
- `dl-hint`/`noteInfo`"正极 −8.0% 偏差与预警大屏「到货间隙」事件同源；已在月度 S&OP 第⑤步决议加急 200 吨对冲。"——系统 `:150` **已硬编码该串**;须迁 `view.layout` 或 `zh.quarter.ltaFootnote`(R14,去最后硬编码)。

### 4.6 数据资产（完整,作种子/i18n;研发逐字录）
- **`Q_ROLL` 6 季**(§4.2,作 (A)(D) 反解目标 + (E) 事件叙事模板)。
- **`Q_LTA` 3 行**(§4.3,作 (C) `ltaMaterials`/`ltaPlanned`/`ltaDevPct` 种子)。
- **i18n `zh.quarter`**(`locales/zh.ts:197-213,已存在`)：title/sub/demand/supply/gap/surplus/ltaSection/ltaHint/ltaMaterial/ltaPlanned/ltaActual/ltaDev/ltaNote/escalate/gotoRisk;**须增** `subNote`(段头副标)、`ltaFootnote`(脚注)、事件文案模板键(检修/外协/产能增量,供模板对齐 HTML 叙事)。
- **规则深链**：C03(交付高峰)/C08(外协上限,2027-Q2)/C16(到货间隙,qi=0) → 前端按 ruleKey 拉 `GET /a/v1/rules` 的 `expression` 展开(已实现,:88-92)。

## 5. 契约 / 端点
- `packages/contracts/src/planviews.ts:76 QuarterlyResponseSchema`：`rows[{q,dem,sup,gap,events[{label,ruleKey?}]}] + ltaDeviation[{material,planned,actual,deviationPct,note?,baseId?}]`——**结构无需改,仅种子对齐**。
- 端点：`GET /a/v1/plan/quarterly?from=2026-Q3&n=6`(`app.ts:2569`,entitlement tag `plan-quarterly`)· `GET /a/v1/rules`(规则展开)· 跳转 `/v/risk?focus={baseId}`(超集)。
- ViewConfig.layout 增 `subNote`(段头副标)、`ltaFootnote`(脚注)文案位;`gapTiers` 已有。
- 种子改动(无契约变更)：`battery.ts` `planview.rollingCorrPct/growthYoY/seasonal/ltaMaterials` + 新增 `ltaPlanned`/`ltaDevPct` + `scenarios.baseline.projects`(枣庄) + `shipments` qtyTons(若不走 ltaPlanned 配置)。

## 6. 融合集成点（5 处,不绕过）
1. **Renderer** `registry.ts`(`quarterly-rolling` → `QuarterlyRollingView`)——已注册,增强不重建。
2. **管线** `planviews.ts:240 quarterlyFromContext` + `:350 ltaDeviation`——只调种子读取,不改算法骨架(项目增量事件/C08 事件注入为口径化增补)。
3. **种子** `synthetic/battery.ts`(planview/shipments/baseline.projects/generatePlanDomain)——主工作量。
4. **Feature** `features.ts:24`(`view.quarterly-rolling`,tag `plan-quarterly`,defaultOn)——已有。
5. **ViewDef/i18n** 后端 VIEW_DEFS(layout.subNote/ltaFootnote/gapTiers) + `locales/zh.ts:197`(增键)——补副标与脚注去硬编码。
- **复用现有 `QuarterlyRollingView`,增强不重建;改共享 rollup 口径须同跑 AOP/risk/S&OP 回归(R-一致)。**

## 7. 验收（DoD = 真 1:1）
- **像素核对**：与 HTML quarter 页并排,逐元素勾——6 季双条/三档缺口色/缺口文案/6 段事件叙事(含 2027-Q2 C08 深链)/枣庄段头副标/LTA 3 行(正极 −8.0% 越线+升级徽章)/脚注,**结构/值/字符串/交互全一致**(色/字、maxV 缩放可不同)。漏一项不过。
- **数据**：6 季 dem/sup/gap **逐项=HTML 382/376…452/448**(管线实算,非写死;残差≤1 视通过,诚实记录命中方式)· LTA 三行=2800/2576/−8.0%、820/828/+1.0%、1900/1862/−2.0% · 枣庄项目接 baseline 基准情景。
- **交互**：缺口三档着色·规则徽章展开表达式·LTA 越线升级·跳风险看板(超集)——逐项 FDE 亲手跑。
- **不变量**：前端零写死(`debattery:check`,脚注/副标已迁 ViewConfig)· 同 (industry,scale,seed) 字节一致(R6)· 每数可溯(R13)· 产能口径与 AOP/risk/S&OP 同源(改种子后**同跑这四视图回归无漂移**,R-一致)。
- `pnpm -r build && pnpm -r test` 全绿(`f22.quarterly-rolling.test.tsx` + 种子回归)· `chain:check`/`ontology:check` 过。
- 回写本体 §2.E(枣庄储能线 CAPEX 项目实例 + Shipment 物料样例)。

## 8. 实施任务（研发可直接拆）
1. **种子·LTA**(C)：`ltaMaterials→["三元正极","隔膜","电解液"]` + 新增 `ltaPlanned:[2800,820,1900]`/`ltaDevPct:[-8,1,-2]`;`ltaDeviation` 读取这两配置(确定性);校 actual/note/baseId。
2. **种子·枣庄项目**(B)：`scenarios.baseline.projects` 改为枣庄储能线(q0=4、ramp[0.6,0.9,1.0]、capex[14]、动工注记 2026-Q4);项目增量事件文案暴露 ramp%。
3. **种子·季度曲线**(A)(D)：整定 `rollingCorrPct`/`growthYoY`/`seasonal`/weeklyWan,联立枣庄增量,使实算 6 季 dem/sup 命中 HTML;优先用本视图专属自由度,最小化对共享 rollup 的扰动;残差与命中方式如实记录。
4. **事件口径**(E)：2027-Q2 注入 C08 外协过渡事件(口径化+ruleKey);检修季/产能增量文案模板对齐 HTML 叙事(ViewConfig/i18n,非前端拼)。
5. **前端微调**(F)：段头补 `view.layout.subNote` 副标 + LTA 脚注迁 `view.layout.ltaFootnote`(去 :150 硬编码);`zh.quarter` 增 `subNote`/`ltaFootnote`/事件模板键兜底。
6. **回归**：同跑 AOP/risk/S&OP/产能推演防漂移;`f22` + 种子回归;FDE 亲手核对 6 季值与 LTA 三行。
7. **回写**：本体 §2.E(枣庄项目/Shipment 物料) + 结构 PRD `docs/PRD-quarter-rolling-1to1.md` 标记已实施。

> **诚实声明**：本视图结构/交互已 1:1,工作量集中在**生成器调参**。6 季整数精确值是多参数联立反解,**优先**用 PlanTarget 目标线 + `rollingCorrPct`(本视图专属)精确命中 dem、用 weeklyWan+枣庄增量逼近 sup(残差≤1);若纯连续参数无法严格命中,允许 `planview.quarterOverride`/`ltaPlanned`/`ltaDevPct` 等**专属种子配置位**兜底(仍属②种子、非前端写死,守 R14/R6)。叙事逐字一致需把 HTML 文案作 ViewConfig 事件模板下发。**绿测试 ≠ 能用——交付前 FDE 必须亲手核对 6 季值与跳风险链路。**
