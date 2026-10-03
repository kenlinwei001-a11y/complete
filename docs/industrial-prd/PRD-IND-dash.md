# 工业级 PRD · 经营驾驶舱（dash）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 数据）。**只读本文 + 像素参照 HTML 即可 1:1 实现**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`：`buildDash` L3779-3823 · 八卡 L3781-3798 · `renderDashLedger` L3826-3854 · `renderDashDrill`（逐单根因 DAG）L3855-3901 · `renderProbDrill`（问题级 DAG）L3930-4003 · `renderDashPlan`/`renderPlanDag`/`renderPlanAgg`（规划决策推演 + 项目级聚合）L4160-4276 · AI 对话 dash 分支 `aiDef('dash')` L3463-3477 · 数据底座 `ledger/ordFull/problemAgg/ROOT_LIB/PROB_META` L3906-4067 · 常量 `ORDERS` L1558 / `SEG_*` L2379-2382 / `RK_COLOR/RK_KIND` L4157-4158 / `SOP_SEG` L5009 / `ORDER_OVR` L3222 / `BOM_T` L3220 / `MODEL_DEF` L1542。本文已把其全部常量/公式/字符串/交互转录；HTML 仅作像素核对。 |
| 落点（融入，不新建） | 前端 `apps/frontend-shell/src/views/DashboardView.tsx`（renderer `dashboard`，**增强不重建**）+ 新增 `LedgerProblemPanel.tsx` / `RootCauseDag.tsx`（SVG DAG，复用 risk-board DAG 渲染思路）· 后端 ViewDef 种子 `apps/datacore/src/synthetic/service.ts:894 DASH_LAYOUT` + `:1008 VIEW_DEFS.dash` · 问题求解器 `apps/datacore/src/solvers/risk.ts affectedOrders / affectedOrdersAggregate / buildOrderProblems`（L275/366/421）· 毛利归因 `service.ts:269 marginAttribution` · 种子 `apps/datacore/src/synthetic/battery.ts`（SOP_FIN 口径 `:244 sop` · 问题归并 `:130 affected`） · 契约 `packages/contracts/src/planviews.ts:254 OrderProblemGroupSchema` |
| 不变量 | R14（前端零写死，值来自管线）· R6（同 seed 字节一致）· R13（每数可溯，八卡 provTip 六要素）· R-一致（需求/供给/毛利/现金口径跨 dash/sop/audit/gen 同源）· 1:1=结构/数据/交互 100%，**唯色调/字体可调** |

---

## 1. 视图概述

经营驾驶舱是**集团一屏**：顶部八张 KPI 卡（需求/供给/收入/毛利/产能/齐套/现金/AOP）给当月总态势，每卡悬停出**六要素溯源**（一个事实一个出处）；中部「**待解决的问题**」自下而上把 **24 单全量订单逐单归因 → 汇成问题清单**，点问题卡展开**问题级归因 DAG**（结果→主因→受影响订单·可点→驱动事件→机制根因）；其下「**订单经营台账**」按承接状态筛选、点未达成单展开**逐单根因 DAG**；再下「**规划决策推演**」可按月/季/年切换、点任一未达成指标下钻成 DAG + **项目级聚合**（Σ勾稽到 −0.4pct）；底部「回采校准链」与「模块直达」。右上 **AI 对话条**（4 预设问答，答案取实时台账数据）+ 计划版本徽章。**所有数字派生自同一本体，自上而下（计划→项目）与自下而上（订单→问题）共用同一份 `ledger()` 数据。**

系统现状：`DashboardView.tsx` 已实现「声明式 widget 网格」（八卡的系统对应只覆盖 6 个 KPI + OEE 趋势 + 订单表 + 历史趋势/准交率/已交付台账），但**完全缺失**「待解决的问题 / 订单台账筛选 / 逐单 DAG / 问题级 DAG / 规划决策推演 / 项目级聚合 / 回采链 / 模块直达 / AI 对话」九大区块。本 PRD 把这些区块下沉为后端求解器输出 + ViewDef 结构，前端只渲染。

## 2. UI 规格（布局 · 像素结构）

### 2.1 整页骨架（`buildDash` L3807-3820，`#dashwrap`）
```
┌ rk-top ─────────────────────────────────────────────────────────┐
│ <h3>经营驾驶舱 · ${SOP_MONTH=2026-07}</h3>                          │
│ rk-sub:「集团一屏 · 三线差异入口 · 所有数字派生自同一本体（一个事实  │
│   一个出处）」                                                       │
│ 右 rk-hsel: [aiBar('dash')] [rk-fchip 计划版本 V7 已定稿/V5 评审中]  │
└──────────────────────────────────────────────────────────────────┘
[aiPanelHTML('dash') —— 折叠 AI 对话面板，见 §3.6]
<div class="dash-grid">  八卡，见 §2.2  </div>
<div id="dashLedger"> 待解决的问题 + 订单经营台账，见 §2.3/2.4 </div>
<div id="dashPlan">  规划决策推演 + 项目级聚合，见 §2.5  </div>
┌ rk-det 回采校准 · 逐级反馈链 (副"实际 → 月度 → 季度 → 年度") ───────┐
│ fb-chain: 实际产出/销量/到货/回款 →月度 S&OP 三线差异(V7 vs 实际)  │
│   →季度滚动重估(爬坡/长协偏差) →年度情景校准与触发监测              │
│   ↻精度校准器 C12 反向调参                                          │
└──────────────────────────────────────────────────────────────────┘
┌ rk-det 模块直达 (副"点击进入") ──────────────────────────────────┐
│ dash-mods: 6 个 dash-mod 卡（左 3px 边框=色），见 §2.6            │
└──────────────────────────────────────────────────────────────────┘
```
- `rk-fchip` 文案 = `sopFinal ? '计划版本 V7 已定稿' : '计划版本 V5 评审中 · 待S&OP定稿'`，描边/字色 `#B07FD8`（66 透明描边）。

### 2.2 八卡 KPI（`dash-grid` · 每卡 `dash-k pv`，顶 `3px solid` 色条；HTML L3781-3798）
每卡结构：`<span>{k 标题}</span><b style=color:{c}>{v 大数}</b><i>{s 副标题}</i>`，`onmouseenter="provTip('dash-k{i}',event)"`、`onmouseleave="hideDayTip()"`。逐字：

| i | k 标题 | v | s 副标题 | c 色 |
|---|---|---|---|---|
| 0 | 月度需求 P50 | `dem.toFixed(0)+' 万套'`（=132） | `目标 {tgt.toFixed(1)} · +{((dem-tgt)/tgt*100).toFixed(1)}%`（目标 127.6 · +3.4%） | #7E8BEE |
| 1 | `可供给（V7 决议后）`/`可供给（V5 评审中）` | `sup.toFixed(1)+' 万套'`（=131.2 或 129.5） | `产销缺口 {(dem-sup).toFixed(1)}`（0.8 / 2.5） | #C470B8 |
| 2 | 收入预算达成 | 103% | 248 / 240 亿 | #62BE77 |
| 3 | 毛利率 | 16.0% | 预算 16.4% · −0.4pct（细分结构） | #E8B54A |
| 4 | 产能利用率 | 86% | 瓶颈：常州化成 92 · 江门齐套 90 | #54B5C4 |
| 5 | 齐套预警 | 2 项 | 正极 654 吨 · 电解液 222 吨（在途覆盖） | #D08A66 |
| 6 | 现金安全垫 C18 | 达标 | 13 周最低点 58 亿 > 垫 50 亿 | #36BFA5 |
| 7 | AOP 2027 基准 | 1,580 万套 | 枣庄线 Q4 动工 · 触发项监测中 | #9D8BF0 |

- `dem=sopDemand()`（=Σ SOP_SEG.p50 = 71.0+49.0+12.0 = 132.0）；`tgt=sopTarget()`（=Σ tgt = 69.0+45.0+13.6 = 127.6）；`sup=sopFinal?131.2:129.5`。
- 每卡 `pv`（六要素溯源浮层 `PROV['dash-k'+i]`，逐字见 §4.3）：`{t 标题, v, src 来源, formula 推导, inputs[], rule, note?}`。

### 2.3 待解决的问题（`renderDashLedger` 顶 · `rk-det` + `prob-grid`；L3847-3848）
- 头 `<b>🧩 待解决的问题（{probs.length}）· 全部订单根源归并</b>`，副「自下而上：{L.length} 单逐单归因 → 汇成问题清单 · 点卡片看详情与归因 DAG」。
- `prob-grid` = `problemAgg()` 每问题一张 `prob-card`（点击 toggle `dashProbOpen`）：`<b>{p.problem}<span class="pc-exp">{on?'▼ 收起':'▸ 详情·DAG'}</span></b><span>影响 {p.orders.length} 单 · {p.rev.toFixed(0)}亿</span><i>根源：{p.root}</i>`，展开时其下渲染 `renderProbDrill(p)`（§2.7）。

### 2.4 订单经营台账（`renderDashLedger` · L3849-3853）
- 头 `<b>📋 订单经营台账 · {L.length} 单（收入 {totRev.toFixed(0)}亿 · 毛利 {totGp.toFixed(0)}亿 · 综合毛利率 {(totGp/totRev*100).toFixed(1)}%）</b>`，副「点未达成订单 → 逐单根因 DAG」。`totRev=ΣL.f.rev`，`totGp=ΣL.f.rev*L.f.m0/100`。
- 筛选 chips（`tier-chip`，5 个，`dashFilter` 控制 on）：`全部 {all}`/`未接 {未接}`/`提价接 {提价接}`/`交期风险 {交期风险}`/`已接 {已接}`（计数 `cnt`）。
- `led-head`：订单 / 客户 / 细分 / 数量 / 收入 / 毛利率 / 交期 / 交付 / 承接 / （空展开列）。
- `led-row`（每单，点击 toggle `dashDrillSo`）：`agg-so={o.so}` · `agg-cust={o.cust}` · 细分（色 `SEG_COLOR[f.seg]`）· `{o.qty}万套` · `{f.rev.toFixed(1)}亿` · 毛利率（`f.m0<f.floor` 红 `#DD7E9E`，否则 `--txt`）· `{o.due.slice(5)}` · 交付（`f.delayDays?'迟'+d+'天'`色 `#D08A66`，否则「准时」色 `--quality`）· `agg-st {stc}`（已接 agg-ok / 提价接 agg-margin / 交期风险 agg-deliver / 未接 agg-credit）显 `f.status` · `agg-exp ▸/▼`。展开时其下渲染 `renderDashDrill(o,f)`（§2.7）。

### 2.5 规划决策推演 + 项目级聚合（`renderDashPlan` L4160 · `#dashPlan`）
- `rk-det` 头 `<b>🧭 规划决策推演 · 未达成指标根因下钻</b>`，副「点任一未达成指标 → 沿本体关系反向下钻成 DAG → 排除非主因、定位主因、追到具体项目、推演到机制本质根因」。
- 层级 chips（`tier-chip`，`planLevel`）：月度 S&OP / 季度滚动 / 年度情景（`ROOT_CHAINS[planLevel]`）。
- `plan-kpis` = `lv._kpi` 每条 `plan-kpi`（`.miss` 红 / `.on` 高亮）：`<span>{k.k}</span><b color={miss?#DD7E9E:--quality}>{k.v}</b><i>{k.tgt} · {k.d}</i>` + 尾标（miss→`追根源 →` / 否则 `达成 ✓`）；可点（有 chain）切 `planChain`。月度四指标：毛利率 16.0%/产销缺口 0.8 万套/收入达成 103%(达成)/正极齐套 92%。
- `#planDag` = `renderPlanDag()`：选中 chain 时渲染 5 层 DAG（§2.7）+ 根因对策卡 `rkdag-root`（`ch.fix` + 两按钮「→ 规划建议」「→ 规划体检」）+ `renderPlanAgg()` 项目级聚合表（仅 month+gm 链有：`agg-head` 列=订单/客户/细分/数量/收入/毛利率/毛利率贡献/承接，行=`agg-row` 负贡献在前、Σ勾稽 −0.40pct、长尾合并、正贡献提示）。

### 2.6 模块直达（`mods` L3799-3806，6 卡，左 `3px` 色边，点击切 tab）
| data-k | 标题 | 副 | 色 |
|---|---|---|---|
| aop | 年度情景规划台 | 三情景 · 触发挂牌 · 目标分解 | #9D8BF0 |
| quarter | 季度滚动看板 | 爬坡 vs 需求 · 长协偏差 | #5E8FE8 |
| sop | 月度 S&OP | 五步法 · 三线差异 · 版本管理 | #B07FD8 |
| risk | 产能推演 | 计划-执行之桥 · 8 风险基地 | #DD7E9E |
| order | 项目推演 | 订单全链 + 型号产能模拟 | #36BFA5 |
| all | 业务建模全景 | 14 域 · 含外部域与决策应用域 | #54B5C4 |

### 2.7 三种 DAG（SVG，节点 kind 配色复用 `RK_COLOR`/`RK_KIND` L4157-4158）
- **`RK_COLOR`**：result `#DD7E9E` / excluded `#7C8896` / factor `#E8B54A` / project `#5E8FE8` / event `#54B5C4` / rootcause `#DF747E`。**`RK_KIND`**：result 结果 / excluded 反事实排除 / factor 主因 / project 影响项目 / event 驱动事件 / rootcause 本质根因。节点矩形 `rx`、`fill={c}14`（透明）、`stroke={c}`，rootcause 描边 2px 加宽；边贝塞尔曲线 `M x1 y1 C ...`，rel 标签着色（含「主因」黄 / 指向 rootcause 红 `#DF747E` / 否则 `--line2` 虚线）；箭头 marker。
- **逐单根因 DAG**（`renderDashDrill` L3855，W=1080 NH=46 LH=80）：层 0 结果（按 status 文案，见 §4.5 head 规则）→ 层 1 关联判（财务/交期）→ 层 2 项目（客户·型号，可点→跳 order tab）→ 层 3 根源（`ROOT_LIB[rk].root`）；已接单只两节点（结果→三判通过）。尾 `agg-prob`：「→ 要解决的问题：{lib.problem}」。
- **问题级 DAG**（`renderProbDrill` L3930，W=1080 NH=46 LH=80，5 层）：result（按 p.rk 映射计划指标，见 §4.6 head 规则）→ factor（`PROB_META[rk].judge`）→ projects（受影响订单最多 6，每个 `订单·可点` → `probJumpOrder`，+N 单更多）→ event（`PROB_META[rk].ev`）→ rootcause（`p.root`）。头 `prob-stats`：影响订单/涉及收入/毛利率贡献/平均延迟 + 状态 chips。尾 `prob-fix`：「→ 要解决的问题：{p.problem}」+ 按钮「去规划建议 · 推对策路径 →」。
- **规划推演 DAG**（`renderPlanDag` L4179，W=1120 NW=176 NH=50 LH=92）：`ROOT_CHAINS[planLevel][planChain].nodes/edges`，6 类节点（含 excluded 反事实排除：虚线描边 + 删除线文字）；图例 `rkdag-leg` 六色。

## 3. UX 规格（交互 · 状态 · 流）

| # | 交互 | 触发 | 行为 |
|---|---|---|---|
| 1 | 悬停八卡 | `dash-k onmouseenter provTip('dash-k{i}',event)` | 出六要素溯源浮层（t/v/src/formula/inputs/rule/note）；离开 `hideDayTip()` |
| 2 | 切问题卡 | `prob-card onclick` | `dashProbOpen = on?null:rk` → `renderDashLedger()`；展开渲染问题级 DAG |
| 3 | 切台账筛选 | `tier-chip onclick` | `dashFilter=k; dashDrillSo=null` → 重渲；行集 = `L.filter(status===k或all)` |
| 4 | 展开订单行 | `led-row onclick` | `dashDrillSo = on?null:so` → 渲逐单根因 DAG |
| 5 | 点 DAG 项目节点（逐单） | `<g onclick stopPropagation>` | 跳 `order` tab（`document.querySelector(".tab[data-k='order']").click()`） |
| 6 | 点 DAG 订单节点（问题级） | `probJumpOrder(so,'dash')` | `dashFilter='all';dashDrillSo=so;renderDashLedger()` + 平滑滚到 `.led-row.open` |
| 7 | 点「+N 单」节点 | onclick | 滚到 `.led-head`（台账头） |
| 8 | 问题卡按钮 | `prob-fix button` | 切 `generate` tab（去规划建议） |
| 9 | 切推演层级 | `planSetLevel(l)` | `planLevel=l;planChain=null` → 重渲 |
| 10 | 点未达成指标 | `plan-kpi onclick planSetChain(c)` | `planChain=c` → 渲对应 DAG + 项目聚合；初始自动取首个 `miss` 链 |
| 11 | 点推演 DAG 项目节点 | `planNodeInfo(id)` | `alert` 节点详情（label/obj/sub + 订单字段 + 上游来源说明） |
| 12 | 展开聚合行 | `agg-row onclick planAggOpen` | 渲 `agg-drill`（订单→单价/毛利率→根源 链 + 要解决的问题） |
| 13 | 对策卡按钮 | `rkdag-root button` | 切 `generate` / `audit` tab |
| 14 | 点模块直达卡 | `dash-mod onclick` | 切对应 tab |
| 15 | AI 对话条 | `aiBar('dash')` / `aiToggle('dash')` | 展开预设 QA（§3.6），追问走 `free(t)` |
| 状态 | V7/V5 | `sopFinal` | 影响卡 1 标题/供给值/缺口、卡顶徽章 |

### 3.6 AI 对话 dash 分支（`aiDef('dash')` L3463-3477，答案取实时数据）
- 标题「经营驾驶舱」。`gapKpi = '产销缺口 '+(sopDemand()-(sopFinal?131.2:129.5)).toFixed(1)+' 万套'`。
- 4 预设 QA（逐字见 §4.7）：①本月最大的经营风险是什么？②哪些问题影响收入最大？③毛利率为什么低于预算？④现在该做什么决策？
- `free(t)` 路由（正则 → 答案）：`缺口|供给|交付` / `毛利|利润` / `订单|客户` / `问题|根源` / 兜底。

## 4. 数据规格（值 + 来源 + 系统字段级落地）
> 前端**零写死**（R14）；每个数据分类并路由：①业务数据实例→合成种子/物化 ②阈值/默认→config（solverParams）③公式→求解器 ④文案→i18n ⑤结构→ViewDef。

### 4.1 共享数据底座（HTML L3906-4067，①合成种子 + ③求解器）
- **`ORDERS`**（①，24 单，L1558-1582）：`{so,cust,model,qty,due,pri}`。逐字录入种子 Order 表（系统现 Order 生成为随机 `SO-{seq:5}` + CUSTOMERS 枚举 + 随机 qty/due，与 HTML 的具名 24 单**完全不一致** → 见 §4.5）。
- **`SEG_PRICE`**（②，L2379）`{乘用车:2.2,商用车:1.8,储能:1.4}` 万元/套；**`SEG_MARGIN`**（②，L2380）`{乘用车:0.18,商用车:0.15,储能:0.13}`；**`SEG_COLOR`**（②，L2381）`{乘用车:#5E8FE8,商用车:#D08A66,储能:#54B5C4}`；**`SEG_FLOOR`**（②，L3221，C15 接单线 %）`{乘用车:12,商用车:11,储能:11}`；**`BOM_T`**（②，L3220 正极吨/万套）`{4680-NCM:6.2,2170-NCM:5.8,方形-NCM:6.0,方形-LFP:4.6,圆柱-LFP:4.4,4680-LFP:4.8}`。
- **`ORDER_OVR`**（①越线注入，L3222-3229）：6 单 override —— SO-3470 `{mAdj:-3.2}`、SO-3437 `{credit:true}`、SO-3506 `{credit:true}`、SO-3458 `{mAdj:-3.0}`、SO-3518 `{mAdj:-2.6}`、SO-3540 `{credit:true}`（含 why 文案）。这是让台账出现「未接/提价接」的确定性种子。
- **`ordFull(o)`**（③逐单判定，L4020-4060）：
  - `seg=ordSeg(o)`（客户名含「商用车」→商用车；含「储能|电网」→储能；否则乘用车）；`price=SEG_PRICE[seg]`；`rev=qty*price`。
  - `m0 = SEG_MARGIN[seg]*100 + (hashN(so+'m',5)-2)*0.4 + (ovr.mAdj||0)`；`floor=SEG_FLOOR[seg]`。
  - 交期：`wk=max(1,round(dueDay(due)/7))`（`dueDay` 相对 `T0=2026-06-10`，L1583-1584）；`wkCap=bases.length*1.6+hashN(so+'c',8)/10`（bases=MODEL_DEF[model].bases）；`need=qty/wk`；`capOK=wkCap>=need`、`capP90=wkCap*0.9>=need`。
  - 齐套：`tons=qty*(BOM_T[model]||5.5)`；`cover=0.78+hashN(so+'k',18)/100`；`gapT=max(0,round(tons*(1-cover)))`；`kitOK = gapT===0 || dueDay>=12`。
  - 承接状态优先级：`creditBad → 未接` > `m0<floor → 提价接` > `!capOK||!kitOK → 交期风险` > 否则 `已接`。
  - 根源归因 `roots`：储能&电网客户→`frame`；储能&m0<floor→`push`；储能其它→`cost`；creditBad→`['credit']`（覆盖）；!kitOK→`+lta`；!capOK→`+ (wk<=4?ramp:maint)`；空且储能→`['cost']`；去重。
  - `gmContrib = +((m0-16.4)*rev/248).toFixed(3)`（相对预算 16.4 的加权偏差，归一基数 248 亿）。
  - `delayDays = capOK?0:max(1,round((need-wkCap)*3))`。
- **`ledger()`**（③，L4062）= `ORDERS.map(o=>({o,f:ordFull(o)}))`（不缓存，保证 gmContrib 归一不累积）。
- **`problemAgg()`**（③，L4064-4067）：按 `ROOT_LIB[rk].problem` 归并 → `{problem,root,rk,orders[],rev}`，按 `orders.length` 降序。

### 4.2 `ROOT_LIB`（8 根因字典，L4009-4018，④文案 root/problem · ⑤结构 rk）
| rk | root（机制根因） | problem（要解决的问题） |
|---|---|---|
| crm | 需求评审用月初预测，未接 CRM 实时商机 | 需求感知机制：接入 CRM 实时商机阶段 |
| push | 销售为冲量主动压价，未受毛利线约束 | 销售 KPI 导向：接单毛利线纳入考核(C15) |
| frame | 框架协议低价条款，价格联动滞后 | 大客户框架协议：补价格联动与最低毛利条款 |
| credit | 客户回款周期长，信用额度未动态复核 | 信用动态管理：应收周期与额度联动(C13) |
| lta | 长协锁量比例偏低，未覆盖储能放量 | 年度长协：锁量 80%→88% + 现货对冲 |
| ramp | 产能爬坡曲线假设激进，认证/调试未计入 | 产能规划：爬坡曲线计入认证调试缓冲 |
| maint | 检修窗口与交付高峰叠加，未做产能错峰 | 检修排程：与交付高峰错峰编排 |
| cost | 储能 BOM 成本未随规模下降，降本滞后 | 储能降本：正极/结构件规模化降本 |

### 4.3 八卡六要素溯源 `PROV['dash-k'+i]`（④i18n + ②阈值；HTML L3783-3797 逐字）
- **k0** t=月度需求 P50 · src=S&OP/ERP · formula=`P50 = Σ细分需求评审值（乘用车+储能+商用车）· 版本 {V7 定稿/V5 评审中}` · inputs=[`细分占比：乘 60% / 储 37% / 商 3%`,`需求评审会议产物（五步法第②步）`] · rule=C10 / C21。
- **k1** t=可供给 · src=决策中台派生 · formula=`供给 = Σ基地（周产能×爬坡×检修×认证）{ + S&OP决议增量（常州夜班 +1.2 / 江门加急 +0.5）当 V7}` · inputs=[聚合求解器逐级核算,12 基地产能对象] · rule=C01 / C02。
- **k2** t=收入预算达成 · src=FIN/总账·预算 · formula=`达成率 = 确认收入 248 亿 ÷ 预算 240 亿` · inputs=[总账确认收入（日结）,年度预算分解到月] · rule=C21 三线差异。
- **k3** t=综合毛利率 · src=FIN/总账·预算 · formula=`综合毛利率 = Σ(细分收入×细分毛利率) ÷ Σ收入` · inputs=[乘用车 18% · 储能 13% · 商用车 15%,储能占比 37%（预算假设 33%）→ 结构拉低 −0.38pct] · rule=C15 接单毛利线。
- **k4** t=产能利用率 · src=IoT/SCADA · formula=`利用率 = 实际负荷 ÷ 可用产能；瓶颈 = 多维约束矩阵最紧因子` · inputs=[常州化成紧张度 92,江门物料齐套 90] · rule=C05 利用率>95% 持续3日升级 · **note=IoT 延迟 4.2h → 置信度降级已计入（P90 0.93→0.90）**。
- **k5** t=齐套预警 · src=WMS/ERP · formula=`缺口 = MRP 净需求 − 在库 − 在途（ETA 内）` · inputs=[正极缺口 654 吨（长协外）,电解液 222 吨（在途批次覆盖）] · rule=C06 覆盖<5天冻结排产。
- **k6** t=现金安全垫 · v=`58 亿（达标）` · src=决策中台派生 · formula=`滚动 13 周现金流 = 回款 − 付款 − 资金占用变化；取最低点 vs 安全垫` · inputs=[应收账期 T+60（FIN）,CAPEX 支付节奏,最低点出现在第 6 周] · rule=C18 最低点≥50 亿。
- **k7** t=AOP 2027 基准情景 · src=决策中台派生 · formula=`三情景（保守/基准★/激进）之基准；情景触发条件挂牌监测` · inputs=[年度经营计划 AOP 对象,触发项：海外大单签约→升级激进] · rule=C23 产能建设门槛。

### 4.4 `PROB_META`（问题级 DAG 的 judge/ev 节点文案，L3906-3923，④i18n · ⑤结构）
8 个 rk 各 `{judge:{l,s}, ev:{l,s}}`（逐字录入种子）：crm（细分结构超配·储能放量 / CRM 合同变更 06-05 电网公司F 追量 8 万套）、push（C15 毛利不达线 / 销售冲量压价）、frame（C15 毛利不达线 / 框架协议低价条款执行）、credit（C13 信用超限 / 客户回款逾期）、lta（齐套到货覆盖不足 92% / 到货间隙 06-21 正极降至 2 天）、ramp（周供给<周需求 / 产能爬坡滞后 常州动力线-B 60% vs 70%）、maint（周供给<周需求 / 年度检修窗口 常州第 8 周化成停机）、cost（储能毛利结构性偏低 / 降本节奏滞后）。

### 4.5 ★系统字段级落地（现状 → 须改/须加，精确）

> **核心缺口诊断**：系统的 `DASH_LAYOUT`（service.ts:894-954）是「声明式 widget 网格」，与 HTML 的「八卡 + 台账 + 三种 DAG + 规划推演」是**两套不同的信息架构**。系统已有的问题归并求解器（`affected_orders`）按 **4 类**（DELIVERY/MARGIN/KIT/CREDIT）归并，而 HTML 按 **8 根因**（crm/push/frame/credit/lta/ramp/maint/cost）归并、且额外要逐单 DAG + 项目级 Σ勾稽 —— **系统现有 4 类是 8 根因的粗粒度子集，必须扩展**。下列为精确改动清单。

**(A) 八卡 KPI —— 改 widget 定义（service.ts:895-953 `DASH_LAYOUT.widgets`）**
HTML 八卡 ≠ 系统现 6 KPI（gwh/util/attain/orders/oee-trend/orders-table）。须把 widgets 替换/补齐为 HTML 八卡口径：
- **卡0 月度需求 P50**：系统无。须加 widget `{kind:"solver",solverKey:"sop_demand"...}` 或读 `Segment.p50` 求和；**新增种子** `Segment` 对象 `p50`/`tgt`/`act` 字段（现 segmentProps 只有 `gmRate`/`baselineShare`，battery.ts:373-378 → 加 `p50,tgt,act` 三字段 + 用 SOP_SEG 值播种：乘用车 69/71/66.8、储能 45/49/41.9、商用车 13.6/12/12.9）。
- **卡1 可供给/缺口**：系统无供给口径 KPI。须接 `sop` 求解器或 `plan_versions/current`（battery.ts:266 planBaseline 已有 `cashCushion:58/gmTarget:16.0` 等，缺 `supply`）。加 config `sop.supplyV5=129.5 / supplyV7=131.2`（现 `sop` 仅 `gapRed/cashFloor/revBudget...`，battery.ts:244 → 加 `supplyV5/supplyV7`）。
- **卡2 收入达成 103% (248/240)**：系统 `sop.revBudget=248`（battery.ts:244）是**口径混淆**——HTML 里 248=确认收入、240=预算。须区分：加 `sop.revConfirmed=248 / sop.revBudget=240`（现 revBudget=248 须改为 240，另加 revConfirmed=248）。
- **卡3 毛利率 16.0%/预算 16.4%/−0.4pct**：系统 `planBaseline.gmTarget=16.0`（battery.ts:266）、`audit.segMargins`（pas18/ess13/com15）齐备；缺「预算 16.4%」常数 → 加 `sop.gmBudget=16.4`。−0.4pct 由 `marginAttribution` 输出（见 §4.5-F）。
- **卡4 产能利用率 86%/瓶颈常州92·江门90**：系统 `Base.util`（0.62~0.97 随机）+ `bottleneck` 枚举，但 HTML 是固定 86% + 具名瓶颈。须用 `capacity_rollup` 输出平均利用率；瓶颈文案取 `bottleneck.primary`（battery.ts:60，常州=瓶颈工序）—— **注意系统瓶颈名/紧张度与 HTML「常州化成92/江门齐套90」不一致**，须在种子里把常州 util/紧张度对齐 92、加江门基地（系统现 BASES 无「江门」，有「惠州/福州」；HTML SOP_SUPPLY 用「江门」）→ 须在 BASES 增设或映射江门基地。（**此处系统与 HTML 基地命名体系不同，须做一次基地名对齐决策；建议以 HTML SOP_SUPPLY 五行为准下发种子常量，不强行复用随机 Base.util。**）
- **卡5 齐套预警 2 项/正极654·电解液222**：系统 `planBaseline.kitGap=654` 有正极，缺电解液 222；HTML 取自 `SOP_MAT`（L5015：三元正极 gap654、电解液 gap222、隔膜 0）→ **新增种子** `SOP_MAT` 3 行（可落 `Shipment`/`Material` 或 config `sop.materials`）。
- **卡6 现金垫 C18 达标/58>50**：系统 `planBaseline.cashCushion=58` + 规则 C18（AnnualScenario.cashCushion<50 BLOCK，battery.ts:757）齐备 ✓，只须 KPI widget 读 `58` 与阈值 `50` 比较出「达标」。
- **卡7 AOP 2027 基准 1,580 万套**：系统有 `AnnualScenario` 对象（battery.ts:397）但 demand 由 capexScenario 派生，**值与 HTML 1,580 不一致** → 须把基准情景 demand 种子对齐 1580、触发文案「枣庄线 Q4 动工」（系统用「合肥四期/盐城二期」，**命名不同**，须按 HTML 文案下发 ScenarioTrigger）。

> 诚实标注（不确定项）：系统的基地集（常州/合肥/西安/宜宾/溧阳/青岛/南京/成都/福州/长沙/惠州/盐城）与 HTML（常州/成都/合肥/江门/枣庄/眉山/邯郸/信阳/洛阳…）**不是同一套基地**，且产能项目命名（合肥四期/盐城二期 vs 枣庄线）不同。1:1 复刻要求显示「江门齐套90 / 枣庄线 Q4」等文案 → **必须以 HTML 的基地/项目命名为种子真相源重播 BASES + AnnualScenario + ScenarioTrigger**，否则八卡 K4/K7 副标题无法 1:1。这是一次种子层的命名体系对齐，工作量集中在 battery.ts BASES/capexScenario/planview。

**(B) 待解决的问题 + 8 根因 —— 扩展 `affected_orders` 求解器（risk.ts:421 buildOrderProblems）**
- 现 `PROBLEM_TITLES`/`OrderProblemGroupOut.category` 是 4 类（risk.ts:266/426）。HTML 是 8 根因（含 crm/push/frame/lta/ramp/maint/cost 细分）。**须把 category 从 4 类细化为 8 rootKey**，或保留 4 类大类并在每组下挂 8 个 rootKey 的明细。建议：契约 `OrderProblemGroupSchema`（planviews.ts:264）**加 `rootKey` 字段**（crm|push|frame|credit|lta|ramp|maint|cost）+ `root`（机制根因文案）+ `problem`（要解决的问题文案）。
- `rootChains`（risk.ts:272 已是 `{orderId,layers:[{kind,label}]}`）口径与 HTML 逐单 DAG 4 层（order→judgement→rootCause→remedy）**已对齐** ✓，只须补 `event`（驱动事件）层 → layers kind 加 `event`，文案取 `PROB_META[rk].ev`。
- **新增种子** `ROOT_LIB`（8×{root,problem}）+ `PROB_META`（8×{judge,ev}）→ 落 `solverParams.affected.rootLib`/`affected.probMeta`（现 `affected.problems` 只有 4 类 ruleKeys，battery.ts:137-144 → 扩为 8 根因表）。

**(C) 逐单根因 DAG —— 新增求解器输出**
- HTML `renderDashDrill`（逐单 4 层 DAG）口径 = `ordFull` 的 status/judge/root。系统 `affectedOrders` 已逐单输出 `rootChains`（risk.ts:538），但**只对「受影响订单」生成，不覆盖全量 24 单的已接单**（HTML 已接单也展开两节点 DAG）。须让 `affected_orders` 对**全量**订单出逐单链（或前端按 ledger 行 status 本地映射文案，文案来自 i18n，不写死数值）。

**(D) 订单经营台账 + 筛选/汇总 —— ViewDef + ledger 求解器**
- 系统 `LEDGER_LAYOUT`（service.ts:955）是给 `order` 视图（renderer `ledger`）的，**不在 dash 内**。HTML 台账是 dash 的子区。须在 `DASH_LAYOUT` 加一个新 widget `{type:"ledger-problems", query:{kind:"solver", solverKey:"affected_orders", args:{}}}`，由前端 `LedgerProblemPanel` 消费 `{problems[], rows[]}`，渲染问题卡 + 筛选 + 逐单 DAG。汇总（收入/毛利/综合毛利率/各 status 计数）由求解器 `summary` 给（risk.ts:416 已有 `summary{orderCount,revenue}`，须补 `gp/gmPct/statusCounts`）。
- `WidgetQueryDef`/`DashboardWidgetDef`（types.ts:100-122）须加 `type:"ledger-problems"` 与对应 query 分支；`DashboardView.tsx` Widget 分发加该 case。

**(E) 规划决策推演 DAG + 项目级聚合 —— `ROOT_CHAINS` 下发为结构**
- HTML `ROOT_CHAINS`（L4072+，month/quarter/year × 各 chain 的 nodes/edges/fix）是**纯结构化数据**（⑤ ViewDef + ④文案）。系统无对应物。须把 `ROOT_CHAINS` 完整下发到 `VIEW_DEFS.dash.layout.rootChains`（service.ts:1008），前端 `RootCauseDag` 按 layer/kind 渲染。月度 gm 链的项目级聚合（`planAggData` L4227：归一因子 `k=TARGET/raw`、负贡献在前、前 8 + 长尾、正贡献提示）由 `marginAttribution` 输出承载（见 F）。

**(F) 毛利归因 Σ勾稽 −0.40pct —— 复用 `marginAttribution`（service.ts:269）**
- 系统已有 `margin_attribution` 求解器，输出 `{inverted,rootDrivers,invertedCount,summary}`（service.ts:77）。HTML 的项目级聚合需要：每单 `gmContrib`（相对预算 16.4 加权偏差）→ 归一到 Σ=−0.40 → 排序 → 前 8 + 长尾 + 正贡献。须确认 `marginAttribution` 是否已出**逐单 contrib + 归一勾稽**；若未（其当前面向 `targetType+costFields`），须**新增轻量求解器 `order_margin_contrib`** 或扩 `marginAttribution` 输出 `{orders:[{so,seg,rev,m0,gmContrib}], target:-0.40, normalized:true, pos:[], tail:{count,sum}}`。归一公式逐字：`k = -0.40/Σraw`，每单 `gmContrib*=k`，阈值 `|contrib|>=0.005` 入表。（**诚实标注：marginAttribution 现有口径与 HTML gmContrib 公式不同，建议新增专用求解器而非强改，避免破坏现有 margin_attribution 调用方。**）

**(G) 回采校准链 + 模块直达 —— 纯结构/文案（⑤+④）**
- `fb-chain` 5 节点 + `dash-mods` 6 卡 = 静态结构 + 文案，下发 `VIEW_DEFS.dash.layout.feedbackChain[]` 与 `layout.moduleLinks[]`（service.ts:1008），前端渲染。模块卡 data-k → 前端路由（aop/quarter/sop/risk/order/all 对应系统视图 key：annual-scenario/quarterly-rolling/sop-balance/risk/project-sim/graph-all）。

**(H) AI 对话 dash 分支 —— 复用 QOS QueryDock**
- HTML `aiBar/aiPanel/aiDef('dash')` = 4 预设 + free 路由。系统对应 = AgentCore QOS（QueryDock 组件）。预设问答**不写死答案**：4 个 preset 作为 `presetContext.slotPresets`（types.ts:573 已有 presetContext 形态）注入 QueryDock，答案由 QOS 实时编排（读 affected_orders/margin 数据）。i18n 仅存 4 个**问句**文案（§4.7），答句由后端算。

### 4.6 关键公式与阈值（集中，③求解器口径 · ②config）
- 综合毛利率 `(totGp/totRev*100)`；`totGp=Σ rev*m0/100`。
- `gmContrib=(m0-16.4)*rev/248`，归一 `k=-0.40/Σraw`（项目聚合），Σ勾稽闭合到 −0.4pct。
- 缺口 `dem-sup`（132 − 131.2/129.5）；需求 `Σp50`、目标 `Σtgt`。
- 承接判定阈值链：creditBad > m0<SEG_FLOOR > !capOK||!kitOK > 已接（确定性，`hashN` 派生，R6）。
- `delayDays=max(1,round((need-wkCap)*3))`；`wkCap=bases.length*1.6+hashN(so+'c',8)/10`；`need=qty/wk`。
- 问题 head 文案映射（renderProbDrill L3940-3944）：credit→`未承接收入{rev}亿`、lta→`齐套受限{n}单`、ramp/maint→`交期风险{n}单·平均迟{avgD}天`、其它→`综合毛利率{±gm}pct`。

### 4.7 AI 4 预设问句（④i18n，答句后端算；L3467-3470 逐字）
①「本月最大的经营风险是什么？」②「哪些问题影响收入最大？」③「毛利率为什么低于预算？」④「现在该做什么决策？」（答案模板与 free 路由文案逐字录入，但**变量值实时取**，不写死）。

## 5. 契约 / 端点

- `packages/contracts/src/planviews.ts:264 OrderProblemGroupSchema`：加 `rootKey: z.enum([...8])`、`root: z.string()`、`problem: z.string()`；`rootChains.layers.kind` 加 `"event"`。
- `risk.ts OrderProblemGroupOut`（:266）同步加 `rootKey/root/problem`；`affectedOrdersAggregate.summary`（:416）补 `gp/gmPct/statusCounts`。
- `apps/frontend-shell/src/api/types.ts`：`DashboardWidgetDef.type` 加 `"ledger-problems"`；`WidgetQueryDef` 已含 `solver` 分支可复用；`VIEW_DEFS.dash.layout` 加 `rootChains/feedbackChain/moduleLinks` 字段类型。
- 端点：`POST /a/v1/solvers/affected_orders/invoke`（problems + rows + summary）· `POST /a/v1/solvers/margin_attribution/invoke`（或新 `order_margin_contrib`）· `POST /a/v1/solvers/capacity_rollup/invoke`（利用率/瓶颈）· `GET /a/v1/me/workspace`+`GET /a/v1/views/dash`（ViewDef 含八卡 widgets + rootChains）· `GET /a/v1/objects/aggregate`（Segment p50 求和等）· AI 走 AgentCore `POST /api/v1/qos/ask`（QueryDock）。

## 6. 融合集成点（不绕过）
1. **Renderer** `apps/frontend-shell/src/views/registry.ts`（`dashboard` 仍指 `DashboardView`，内部增 `LedgerProblemPanel`/`RootCauseDag` 子组件）。
2. **ViewDef** `service.ts:1008 VIEW_DEFS.dash`（layout 加 rootChains/feedbackChain/moduleLinks；widgets 替换为八卡口径）。
3. **求解器** `risk.ts`（affected_orders 扩 8 根因）+ `service.ts marginAttribution`（或新 order_margin_contrib）+ `capacity.ts capacity_rollup`（八卡利用率）。
4. **种子** `battery.ts`（BASES/Segment/SOP_MAT/AnnualScenario 对齐 HTML 命名 + `solverParams.affected.rootLib/probMeta` + `sop.supplyV5/V7/gmBudget/revConfirmed`）。
5. **Feature** `features.ts`（八卡 `view.dash.widget.*` 已有 capacity；按需加 `view.dash.problems` 等）。
6. **AI** AgentCore QueryDock presetContext 注入 dash 4 预设。
7. **导航** ShellLayout dash 入口；模块直达卡 → 各视图路由。

## 7. 验收（DoD = 真 1:1）

- **像素核对**（与 HTML dash 页并排逐元素勾）：八卡（标题/大数/副标题/色条/悬停六要素溯源）· 待解决的问题卡（problem/影响N单/亿/根源 + 展开问题级 5 层 DAG）· 订单台账（5 筛选 chip 计数 + 10 列表头 + 24 行 + 行内色规则 + 展开逐单 4 层 DAG + 「→ 要解决的问题」）· 规划决策推演（月/季/年 chip + plan-kpi + DAG 6 类节点含反事实排除删除线 + 对策卡两按钮 + 项目级聚合 Σ勾稽 −0.40pct + 长尾/正贡献提示）· 回采链 5 节点 · 模块直达 6 卡 · AI 4 预设。**结构/值/字符串/交互全一致**（色/字可不同）。漏一项不过。
- **交互**（逐项 FDE 亲手跑，见 /fde-delivery）：悬停八卡出溯源 · 点问题卡展 DAG · 切台账筛选重渲 · 点订单行展逐单 DAG · 点 DAG 项目/订单节点跳转/滚动 · 切推演层级 · 点未达成指标下钻 · 展开聚合行 · 对策/模块卡跳 tab · AI 预设问答取实时值。
- **数据**：前端零写死（`debattery:check`）；种子值 = HTML 精确（ORDERS 24 单 / SEG_* / ORDER_OVR / SOP_SEG / ROOT_LIB / PROB_META 逐字）；同 seed 字节一致（R6）；八卡每数可溯（R13，六要素）；台账综合毛利率与项目聚合 Σ勾稽闭合到 −0.4pct；问题归并 8 根因与 HTML problemAgg 同结果。
- `pnpm -r build && pnpm -r test` 全绿；`chain:check` / `ontology:check` 过。
- **回写本体**：dash 视图新增「8 根因归并链 / 项目级毛利勾稽链 / 规划推演 ROOT_CHAINS 结构」→ 回写 `docs/SYSTEM-ONTOLOGY.md` 对应链路/对象/不变量章节（本体不回写即失效）。

## 8. 实施任务（研发可直接拆）

1. **种子对齐（battery.ts）**：① ORDERS 24 具名单 + ORDER_OVR 6 越线（替换随机 Order 生成器）② Segment 加 p50/tgt/act 字段 + SOP_SEG 三行值 ③ 加 SOP_MAT（正极654/电解液222/隔膜0）④ BASES/AnnualScenario/ScenarioTrigger 按 HTML 命名（江门、枣庄线 Q4）重播 ⑤ `solverParams`：`affected.rootLib`（8×root/problem）+ `affected.probMeta`（8×judge/ev）+ `sop.supplyV5=129.5/supplyV7=131.2/gmBudget=16.4/revConfirmed=248`（revBudget 改 240）。
2. **求解器扩展**：① `risk.ts buildOrderProblems` 4 类→8 根因（rootKey/root/problem + event 层）② `affectedOrdersAggregate.summary` 补 gp/gmPct/statusCounts ③ 新增/扩 `order_margin_contrib`（逐单 gmContrib + 归一 −0.40 + 排序 + 长尾/正贡献）④ `capacity_rollup` 出八卡利用率/瓶颈。
3. **契约**：`planviews.ts OrderProblemGroupSchema` 加 rootKey/root/problem + layers.kind event；types.ts widget 加 ledger-problems。
4. **ViewDef（service.ts）**：DASH_LAYOUT widgets 替换为八卡口径；`VIEW_DEFS.dash.layout` 加 rootChains（month/quarter/year 全量逐字）/feedbackChain（5 节点）/moduleLinks（6 卡）。
5. **前端（DashboardView.tsx 增强）**：① 八卡 KpiWidget 接六要素 Provenance ② 新增 `LedgerProblemPanel`（问题卡 + 筛选 chip + 24 行台账 + 汇总）③ 新增 `RootCauseDag`（SVG，复用 RK_COLOR/RK_KIND，三形态：逐单/问题级/规划推演）④ 项目级聚合表（agg-row + Σ勾稽 + 长尾/正贡献）⑤ 回采链 + 模块直达（点击路由）⑥ AI 对话条接 QueryDock。
6. **i18n（locales）**：ROOT_LIB root/problem、PROB_META judge/ev、八卡标题/副标题/PROV 文案、AI 4 预设问句、回采链/模块卡文案逐字入 `zh`。
7. **AI**：AgentCore QueryDock presetContext 注入 dash 4 预设，答句实时算（affected_orders/margin 数据）。
8. **验收 + 回写本体**：FDE 亲手跑全部交互；回写 SYSTEM-ONTOLOGY.md。

> **范式说明**：本文与 `PRD-IND-plan-generate.md` 同为工业级样板。dash 的特殊性在于它是**两套信息架构的对齐**（系统声明式 widget 网格 vs HTML 八卡+台账+三 DAG），§4.5 已逐项给出「现状字段 → 须改/须加」的精确落点与诚实的不确定标注（基地/项目命名体系差异）。索引见 `PRD-verbatim-1to1-replication.md §2`。
