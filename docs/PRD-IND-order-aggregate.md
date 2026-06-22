# 工业级 PRD · 受影响订单 · 聚合看板（order-aggregate）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 数据）。**只读本文 + 像素参照 HTML 即可 1:1 实现**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`：`buildOrderAgg` **L2418-2451**（受影响订单 · 聚合看板主体）· `buildRisk` 顶 KPI 摘要条 **L2348-2363**（订单聚合 Tab）· `econTable` **L2389-2417**（经营数据看板）· 数据 `ORDERS` **L1558-1583** · `MODEL_DEF` **L1542-1548** · 判定辅助 `ordSeg/ordEcon` **L2382-2388**、`SEG_*` **L2379-2381**、`riskOrders` **L1652-1655**。本文已转录全部常量/公式/字符串/交互，研发以本文为准、HTML 仅作像素核对。 |
| 落点（融入,不新建） | 前端 `apps/frontend-shell/src/views/plan/OrderChainView.tsx`（renderer **`order-chain`**，registry.ts:50）· 后端求解器 `apps/datacore/src/solvers/risk.ts:366 affectedOrdersAggregate` + `:439 buildOrderProblems` · 种子 `apps/datacore/src/synthetic/battery.ts:130 affected` · 契约 `packages/contracts/src/planviews.ts:253 OrderProblemGroupSchema` + VM `apps/frontend-shell/src/api/types.ts:274 AffectedOrdersOutputVM` |
| 不变量 | R14（前端零写死,值来自管线）· R6（同 seed 字节一致）· R13（每数可溯）· R-一致（风险时序/分段口径跨视图同源,与 `产能推演`/`订单全链` 共用 affected_orders）· 1:1=结构/数据/交互 100%,**唯色调/字体可调** |

---

## ⚠ 视图边界（必读 · 与 order 视图的拆分，本 PRD 全程贯穿）

原型 `产能推演` 页（`buildRisk`）有两个 Tab：**瓶颈视角**（`riskTab='risk'`）与 **订单聚合**（`riskTab='order'` → `buildOrderAgg`）。本 PRD **只覆盖「订单聚合」Tab 这一个视图**：跨订单的受影响聚合 = 摘要条 + 经营数据看板 + 受影响明细表 + 基地筛选 + 风险点 chip 悬停。

**不在本 PRD 内（由 `PRD-IND-order.md` 覆盖，尚未落地）：**
- 逐单 11 节点全链 DAG（`odNodes` L3263+、`ordFull/orderJudge` L3230/4020）——单订单 → 可产网络/BOM/单价细分 → 三关联判 → 结论 → 跳转。那是 **per-order** 视角。
- 逐单"提价接/未接/交期风险/已接"承接判定（`status`）与 `ROOT_LIB` 8 根源归因。

**系统现状的耦合事实（诚实声明，研发须知）：** 系统里 **`OrderChainView.tsx`（renderer `order-chain`）当前同时承载了"聚合"与"4 类问题卡"两件事**——它有摘要条 + 明细表 + **problems[] 4 类问题卡（DELIVERY/MARGIN/KIT/CREDIT）**。而原型的 `buildOrderAgg`（本视图）**没有 4 类问题卡**，问题卡是原型另一处 `problemAgg`（L4064，基于 `ROOT_LIB`，挂在 order 全链页）的产物。两边把"问题归并"放在了不同视图。本 PRD 的判定：**4 类问题卡保留在本聚合视图内**（系统已实现、且对"受影响订单"看板有决策价值），但须补齐原型聚合视图独有的 **经营数据看板（econTable）**——这是当前系统最大缺口（§4.5）。逐单 11 节点 DAG 不进本视图。详见 §6 拆分表。

---

## 1. 视图概述

基地负责人 / 计划经理视角：把"产能风险"翻译成"**牵动哪些订单、哪些客户、多少钱**"。从全部风险基地的风险点出发，反查交期落入越线窗口 `[T−7, T+14]` 的订单，**按订单去重聚合**（同一订单可关联多个风险基地的多个风险点，延误取最大估计）→ 输出：①摘要条（受影响订单数/合计数量/涉及客户数/营收暴露）②经营数据看板（这些订单牵动的产能与成品/半成品/原材料库存、未结金额、毛利额、毛利率，可按应用细分 / 按基地切换）③受影响订单明细表（订单/客户/应用/型号/数量/交期/关联风险点 chips/延误）④基地筛选下拉（聚焦单基地）⑤4 类待解决问题卡（交期/毛利/齐套/信用归并 + 逐单根因链）。**系统只摆事实与影响面，处置由决策者在风险卡 / 问题卡里拍板。**

## 2. UI 规格（布局 · 像素结构）

### 2.1 摘要 KPI 条（`buildRisk` L2356-2363，订单聚合 Tab 共用同一条）
> 原型在 `buildRisk` 顶部统一渲染 5 个 KPI（瓶颈视角与订单聚合 Tab 共享），订单聚合 Tab 走 `buildOrderAgg` 时这条仍在上方。系统 `OrderChainView` 已有 4 KPI 摘要条（`oc-summary` L103），**须对齐为 5 项**。
```
┌ rk-kpi（横向 5 + 可选健康度告警）─────────────────────────────────┐
│ [风险基地 N]  [风险因素点 fpts]  [受影响订单(批) allOrd]            │
│ [涉及客户 allCust]  [最早越线日 T+minCross · MM-DD]                 │
│ {healthP90().note 存在 → rk-health 黄条}                            │
└────────────────────────────────────────────────────────────────────┘
```
- 颜色（原型）：风险基地 `#DD7E9E` · 风险因素点 `#C470B8` · 受影响订单 `var(--forecast)` · 涉及客户 `var(--capacity)` · 最早越线日 `var(--solver)`。
- **系统现状对齐**：`oc-summary`（L103-137）当前为 4 项「受影响订单数 / 合计数量(万套) / 涉及客户数 / 营收暴露(亿)」。原型这条是 5 项且口径不同（含风险因素点、最早越线日，不含数量/营收）。**取舍见 §4.5**：保留系统 4 项业务摘要（含营收，决策价值高）并**补 2 项**（风险因素点、最早越线日），最终 6 KPI；或维持两条（KPI 摘要 + 数量/营收）。研发以"信息不丢"为准，§7 验收按"5 原型项 + 营收/数量项均在页面可见"勾。

### 2.2 基地筛选条（`baseSel` L2434-2435）
```
基地筛选：[<select> 全部风险基地（{riskBases.length}） | {基地名(去·总部)}… ]
  {筛选≠全部 → ✕ 清除（当前：{基地名}） chip(border/color=var(--capacity))}
```
- `riskBases` = 所有受影响订单关联到的去重风险基地集合（**仅含真正有受影响订单的基地，非全部基地**，L2425）。
- 选项文案去掉 `·总部` 后缀（`b.replace('·总部','')`，L2433）。
- 若当前 `orderBaseFilter` 已不在 `riskBases` 中（数据变动）→ 自动回退 `__all__`（L2426）。
- **系统现状**：`OrderChainView` 已有 `oc-base-filter` 下拉（L80-93）+ `oc-clear-filter` chip（L96），`riskBases` 由 `allData` 派生（L56-59，固定选项不随过滤收窄 ✓）。**一致，仅须核对去 `·总部`、计数文案**。

### 2.3 经营数据看板 `econTable`（L2389-2417）★系统缺失
```
┌ rk-det「受影响订单 · 经营数据看板」 副"这些订单牵动的产能与库存·财务（{按整车/储能应用 | 按基地}分类）· 金额单位 亿元" ┐
│ rk-segsel 分类维度：[乘用车/商用车/储能 (on)] [按基地]                                                       │
│ table.cmp                                                                                                     │
│  表头：应用分类|受影响产能(万套)|成品库存|半成品库存|原材料库存|未结订单金额|毛利额|毛利率                  │
│   （按基地时第一列改"基地"）                                                                                  │
│  每行：[●dot bg=分段色/基地定位色] {名称}  cap  fg  wip  rm  [sales 色var(--forecast)] [gp 色var(--quality)] gm% │
│  合计行（border-top var(--line2)）：Σ 各列 + 合计毛利率                                                        │
│ dl-hint 口径脚注（见 §4.4 文案）                                                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- 数值保留 1 位小数（`a1=v=>(+v).toFixed(1)`，L2390）；毛利率 = `gp/sales×100` 保留 1 位，sales=0 时显 `0`。
- dot 颜色：app 模式 = `SEG_COLOR[seg]`；base 模式 = `POS_COLOR[BASE_DATA[b].pos]`（基地定位色，缺省 `#888`）。
- 排序：app 模式按 `['乘用车','商用车','储能']` 固定序；base 模式按 `sales` 降序。

### 2.4 受影响订单明细表（`buildOrderAgg` L2441-2449）
```
┌ rk-det「受影响订单 · 明细（{scope}）」 副"{rows.length} 批 · 合计 {totQ} 万套 · {custs.size} 家客户 · 按交期排序" ┐
│ table.cmp                                                                                                          │
│  表头：订单 | 客户 | 应用 | 型号 | 数量 | 交期 | 关联风险点（基地·对象·越线日） | 延误                            │
│  每行：                                                                                                            │
│   订单 <b>{so}</b> | {cust} | [chip 应用 bg=SEG_COLOR[seg]] | {model} | {qty} 万套 | <b>{due.slice(5)}</b> |        │
│   关联风险点（flex-wrap, max-width 480）：每 link chip                                                             │
│     [chip-i bg=riskColor(peak) onmouseenter=showRiskPop(b,f,cross)]{b去基地/总部}·{FACTOR_OBJ[f]} {dateOf(cross)}  │
│     最多显示前 4 个，超出 → [+{more} chip(灰)]                                                                     │
│   延误 <td 色#DD7E9E,粗>{delay} 天</td>                                                                            │
│ dl-hint 聚合口径脚注（见 §4.4）                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- `scope` = 全部时"全部风险基地"，单基地时基地名（去·总部）。
- **空态**：`rows.length===0` → `rk-det` 内 dl-hint「该基地在当前窗口内无受影响订单。」（L2439），无表格。
- **系统现状**：`oc-detail-table`（L144-210）已 1:1（8 列、chip 限 4 + `+more`、风险 chip 用 `RiskHoverTrigger` 悬停、延误红色）。差异：列副标题（"X 批 · 合计 Y 万套…"）由系统 `summary` 派生须核对；`due.slice(5)` ✓；risk chip 文案系统用 `{base}·{factor} D+{crossDay}`（"未越线"），原型用 `{b}·{FACTOR_OBJ[f]} {dateOf(cross)}`（**日期 vs D+天**，色/字可调范围内，但越线日表达须二选一并在 i18n 固化）。

### 2.5 4 类待解决问题卡（系统 `OrderChainView` L218-236，原型同义出处 `problemAgg`/`buildOrderProblems`）
```
┌ panel「{problemSection}」┐
│ probGrid（4 卡）：每卡 probCard（按钮，点击开 DAG Modal）                       │
│   probTitle：[badge red {交期/毛利/齐套/信用}] {title}                          │
│   probMeta：{orderCount} 单 · 涉及 {financeImpact} 亿                           │
│            {rootCauseSummary}                                                   │
└────────────────────────────────────────────────────────────────────────────┘
点卡 → Modal「{title} · 根因链」：LayeredDag 4 层（订单→判定→根因→对策），逐单一条链
  层色：订单#7E8BEE / 判定#E8B54A / 根因#DD7E9E / 对策#62BE77（CHAIN_COLORS）
```
- 4 类固定顺序 DELIVERY/MARGIN/KIT/CREDIT；某类无订单则不出卡（`buildOrderProblems` L521-523）。
- **系统现状**：完整实现（`oc-problems` L220-235 + `ProblemDag` L248）。**保留**。原型对应物 `ROOT_LIB`（8 根源）粒度更细，本视图以系统 4 类为准（§4.5 说明粒度差）。

## 3. UX 规格（交互 · 状态 · 流）

| 交互 | 触发（原型 fn / 系统 testId） | 行为 |
|---|---|---|
| 选基地筛选 | `setOrderBase(v)`（L2378）/ `oc-base-filter` onChange | 写 `orderBaseFilter`/`baseFilter` → 重算聚合（仅保留关联该基地订单，且其风险点只显示该基地，L2428-2431；系统重新 `runSolver('affected_orders',{base})`）|
| 清除筛选 | `setOrderBase('__all__')` / `oc-clear-filter` | 还原全部 → 重建 |
| 切分类维度（经营看板）★ | `setOrderSeg('app'/'base')`（L2377） | 切 `orderSegMode` → 重建 econTable（app=按应用细分 / base=按基地均摊）|
| 悬停风险点 chip | `showRiskPop(b,f,cross,ev)`（L2605）/ `RiskHoverTrigger` | 浮层：描述（当前紧张度→越线日/峰值）+ 根因（量化事件 + 来源链接）+ 时序依据公式 + "💬 发起人机对话"；移出 `scheduleHideRiskPop` 240ms 延迟隐藏 |
| 钉住风险浮层 | `pinRiskPop()`（L2611） | 固定浮层 + 展开 QA chips（影响哪些订单/客户·推荐处置·为何越线·最坏后果）+ 自由追问输入 |
| 点风险浮层来源 | `openSrcModal(b,f,d)`（L2553） | 来源系统数据详情 Modal（系统/表/字段/采集频率/责任人/血缘）|
| 行点击（系统） | `oc-row-{so}` onClick | 订单写入 `selectedObjects` 对话上下文（系统增强，原型无；保留）|
| 点问题卡 | `oc-problem-{cat}` onClick → `setOpenProblem` | 开根因链 DAG Modal |
| 空态 | `rows.length===0` | "该基地在当前窗口内无受影响订单。" |
| 自动回退 | `orderBaseFilter` 不在 `riskBases` | 静默回退 `__all__`（L2426）|

> **风险浮层 / 来源 Modal / 人机对话** 是与 `产能推演`（瓶颈视角）完全共享的子系统（`buildRiskPop`/`showDayTip`/`openSrcModal`），系统侧已抽为 `RiskHoverTrigger`/`RiskPopover` 组件复用。本视图复用，不重写。

## 4. 数据规格（值 + 来源 + 系统字段级落地）
> 前端**零写死**(R14)；每个数据按来源归类：①`ORDERS` 实例→合成种子物化 ②阈值/窗口→config(SolverParam) ③公式(affected_orders/aggregate)→求解器 ④文案→i18n ⑤结构→ViewDef/ViewConfig。逐条标注。

### 4.1 ORDERS 订单实例（①种子 · `ORDERS` L1558-1583，24 单，逐字物化）
| so | cust | model | qty(万套) | due | pri |
|---|---|---|---|---|---|
| SO-3391 | 整车厂A | 4680-NCM | 8 | 2026-06-24 | 高 |
| SO-3402 | 整车厂B | 4680-NCM | 12 | 2026-07-02 | 高 |
| SO-3415 | 整车厂C | 4680-NCM | 6 | 2026-07-18 | 中 |
| SO-3420 | 海外车企E | 4680-NCM | 10 | 2026-07-09 | 高 |
| SO-3431 | 整车厂A | 2170-NCM | 9 | 2026-06-28 | 中 |
| SO-3437 | 商用车集团G | 2170-NCM | 7 | 2026-07-14 | 中 |
| SO-3445 | 整车厂B | 方形-NCM | 11 | 2026-07-05 | 高 |
| SO-3452 | 储能集成商D | 方形-LFP | 14 | 2026-06-30 | 高 |
| SO-3458 | 电网公司F | 方形-LFP | 18 | 2026-07-12 | 高 |
| SO-3464 | 储能集成商H | 方形-LFP | 9 | 2026-07-25 | 中 |
| SO-3470 | 电网公司F | 圆柱-LFP | 6 | 2026-07-08 | 中 |
| SO-3476 | 储能集成商D | 4680-LFP | 8 | 2026-07-20 | 中 |
| SO-3481 | 整车厂A | 4680-NCM | 10 | 2026-07-11 | 高 |
| SO-3486 | 整车厂C | 方形-NCM | 7 | 2026-07-22 | 中 |
| SO-3490 | 海外车企E | 4680-NCM | 13 | 2026-07-06 | 高 |
| SO-3495 | 电网公司F | 方形-LFP | 15 | 2026-07-16 | 高 |
| SO-3501 | 储能集成商H | 方形-LFP | 11 | 2026-07-28 | 中 |
| SO-3506 | 商用车集团G | 2170-NCM | 8 | 2026-07-19 | 中 |
| SO-3512 | 整车厂B | 方形-NCM | 9 | 2026-07-03 | 高 |
| SO-3518 | 储能集成商D | 方形-LFP | 13 | 2026-07-24 | 中 |
| SO-3523 | 整车厂A | 4680-NCM | 11 | 2026-07-13 | 高 |
| SO-3529 | 电网公司F | 圆柱-LFP | 7 | 2026-07-10 | 中 |
| SO-3534 | 海外车企E | 4680-NCM | 12 | 2026-07-27 | 高 |
| SO-3540 | 商用车集团G | 2170-NCM | 6 | 2026-07-17 | 低 |
- 基准日 `T0 = 2026-06-10`（L1584）；`dueDay(due) = max(1, round((due−T0)/86400e3))`（L1585）。`dateOf(d)` = T0+d 天的 MM-DD（L1636）。
- `MODEL_DEF`（①种子 L1542-1548）：型号→{chem,pos,bases}。订单分配到基地 = `MODEL_DEF[model].bases`（同一型号可在多基地生产）。
  - 4680-NCM→[常州·总部,成都,合肥] · 2170-NCM→[厦门,武汉,自贡] · 方形-NCM→[常州·总部,成都] · 方形-LFP→[江门,眉山,邯郸,枣庄] · 圆柱-LFP→[信阳,洛阳] · 4680-LFP→[常州·总部,枣庄]。

### 4.2 阈值 / 窗口常量（②config · SolverParam.affected，battery.ts:130-143）
| 常量 | 值 | 含义 | 原型出处 |
|---|---|---|---|
| windowBefore | 7 | 越线窗口前界 `[T−7,…]` | `riskOrders` L1654 `o.d>=day-7` |
| windowAfter | 14 | 越线窗口后界 `[…,T+14]` | L1654 `o.d<=day+14` |
| delayDiv | 8 | 延误估计分母 | L1655 `(85-70)/8` |
| jitterMod | 3 | 延误抖动模 | 原型用 `hashN(so+b,4)`（模 4）→ **系统用 3，差异见 §4.5** |
| fallbackMax | 5 | 条件命中空回退 max 单 | 原型聚合无 condition 分支 |
| risk.threshold | 85 | 越线阈值（紧张度≥85）| `riskColor` L1632 / `riskVal` `Math.min(98,…)` |
| risk colors | <70 `#62BE77` / 70-84 `#D2B04C` / ≥85 `#DD7E9E` | 三档紧张度色 | L1632 |

### 4.3 分段口径 SEG_*（②config · 原型按客户名，系统按型号——核心分歧见 §4.5）
| 分段 | SEG_COLOR | SEG_PRICE(万元/套) | SEG_MARGIN | 判定规则(`ordSeg` L2382) |
|---|---|---|---|---|
| 乘用车 | `#5E8FE8` | 2.2 | 0.18 | 默认（非商用车/储能）|
| 商用车 | `#D08A66` | 1.8 | 0.15 | cust 含「商用车」|
| 储能 | `#54B5C4` | 1.4 | 0.13 | cust 含「储能」或「电网」|
- 营收 = `qty × SEG_PRICE`（亿元，万套×万元/套口径）；毛利额 = 营收 × SEG_MARGIN。
- **系统现状（risk.ts `segmentOf` L432）按 `model` 分段**：`essModels=["S192-LFP"]`、`comModels=["L148-LFP"]`、其余 pas——这是**别的型号命名**（电池增量），与原型 `ORDERS` 的 `方形-LFP/圆柱-LFP/2170-NCM` 不匹配，且**口径错位**（原型按客户、系统按型号）。必须改齐（§4.5）。

### 4.4 求解器口径（③确定性 R6）

**① 聚合 `affectedOrdersAggregate`（risk.ts:366）：**
- 遍历全部基地（或 `args.base` 单基地，`resolveBaseId` 归一），对每基地调 `affectedOrders({baseId,toDay:180})` 取受影响订单 + `tensionSeries` 取首要因子风险曲线 → `AggRiskRef{base,factor,peak,crossDay,threshold}`。
- **按 `so` 去重合并**（`byOrder` Map L381）：`delay=max(各基地 delay)`（L399，对齐原型 L2422 `Math.max`）；`risks` 去重（同 base 不重复，L400）。
- 排序 `rows` 按 `so` 升序（L413）——**原型按交期 `dueDay` 升序排（L2423）**，差异见 §4.5。
- `summary`：orderCount=rows 数 · totalQty=Σqty(2位) · custCount=去重客户数 · revenue=Σ(qty×SEG_PRICE[seg])（2位，L415-416）。`SEG_PRICE` 系统内为 `{pas:0.6,com:0.55,ess:0.5}`（L364）——**与原型 {2.2,1.8,1.4} 不同口径**（§4.5）。

**② 单基地 `affectedOrders`（risk.ts:275）：**
- 窗口 `[day−windowBefore, day+windowAfter]`，聚合调用走 `toDay:180`（全窗口）；交期 `dueDay = dayFrom(forecastStart, due)` 落窗内。
- 延误 `delay = max(1, round((peak−threshold)/delayDiv) + jit)`，`jit = hashString(so) % jitterMod`（L323-324）。原型 `riskOrders`（L1655）`delay = max(1, round((85-70)/8) + hashN(so+b,4))` = `max(1, 2 + hashN(so+b,4))`——**系统 jit 只 hash so（不含 base）且模 3，原型 hash so+b 模 4 → 多基地下同单延误派生不同**（§4.5）。

**③ 4 类问题归并 `buildOrderProblems`（risk.ts:439）：**
- 优先级（互斥，先命中先归类）：CREDIT（creditRatio>1）> MARGIN（seg.gm<gmFloor 13.5）> KIT（到货晚于交期）> DELIVERY（窗内兜底，分越线前/尾段两文案）。
- creditRatio = `round(creditBase 0.7 + (hashString(cust|so)%creditMod 60)/100, 2)`（L478）——**派生信用占用比，非原型 `ORDER_OVR` 显式标注**（原型 SO-3437/3506/3540 信用、SO-3470/3458/3518 压价，L3222-3229）。差异见 §4.5。
- financeImpact = `Σ qty×10000×unitPrice(默认600)/1e8` 亿（L524）。
- 每单根因链 4 层（order→judgement→rootCause→remedy，L460-468），文案见 risk.ts L487-517 逐字。

**econTable 口径（③+原型 L2383-2417，系统须补）：**
- `ordEcon(o)`：sales=qty×SEG_PRICE[seg]；gp=sales×SEG_MARGIN[seg]；`h=hashN(so,10)/10`；fg=sales×(0.22+h×0.12)；wip=sales×(0.30+h×0.15)；rm=sales×(0.18+h×0.10)；cap=qty。
- app 模式：按 seg 分组累加（权重 1）；base 模式：每单按关联去重基地数 `bs.length` 均摊（`w=1/bs.length`，L2396）。
- 合计行 = Σ 各组；毛利率 = gp/sales×100。
- **dl-hint 文案（④i18n 逐字）**：
  - econTable：「口径：仅统计本页受影响订单。成品/半成品/原材料库存为支撑这些订单交付的在库资产（亿元）；未结订单金额=数量×应用单价，毛利额=未结金额×应用毛利率。按基地分类时，跨多基地订单按关联基地数均摊。」（L2416）
  - 明细表（全部）：「聚合口径：订单分配至风险基地，且交期落入该风险点越线窗口 [T−7, T+14]；同一订单可关联多个风险点，延误取最大估计。按基地分类时跨多基地订单按关联基地数均摊。」（L2449）
  - 明细表（单基地）：「…延误取最大估计。已筛选至 {scope}，仅显示该基地相关订单与风险点。」

### 4.5 ★系统字段级落地（现状 → 须改/须加，精确 · 诚实标注不确定）
> 系统 `order-chain`（OrderChainView + affectedOrdersAggregate + buildOrderProblems）**已实现本视图的 60%**：摘要条(部分)、基地筛选、明细表、4 类问题卡 + 根因链 DAG 均在，且参数化(R14)。缺口与分歧如下，**逐项研发须裁决**：

**A. 缺失：经营数据看板 econTable（最大缺口，须新增）**
- 原型 `buildOrderAgg` 在明细表之上**先渲染 `econTable(rows)`**（L2440），系统 `OrderChainView` **完全没有**。须：
  1. 契约 `AffectedOrdersOutputVM`（types.ts:274）+ `OrderProblemGroupSchema` 同文件加 `econ` 输出：
     ```
     econ: {
       segMode: "app" | "base";              // 仅声明默认，前端可切
       groups: { key:string; color:string; cap:number; fg:number; wip:number; rm:number; sales:number; gp:number; gmRate:number }[];
       total:  { cap; fg; wip; rm; sales; gp; gmRate };
     }
     // 同时返回 app + base 两组（前端切换不再 round-trip），或前端纯派生（见下）
     ```
  2. **建议前端纯派生**（econ 全由 `rows` + SEG 常量/config 推导，无新求解器状态）：在 `affectedOrdersAggregate` 输出已含 `rows[seg,qty]`，前端 `OrderChainView` 用 `view.layout.segPrice/segMargin/econCoef` 配置 + `hashN(so)` 复算 econ。**但 `hashN`/`fg/wip/rm` 系数须入 config（②）以保 R14 零写死**——加 `SolverParam.affected.econ = { coef:{fg:[0.22,0.12],wip:[0.30,0.15],rm:[0.18,0.10]} }` + `segPrice/segMargin`。
  3. 前端加 `setOrderSeg` 切换（app/base）、`rk-segsel` chips、`econTable` 渲染（dot/合计行/毛利率），i18n 文案 §4.4。

**B. 分段口径分歧（须改齐，确定性受影响）**
- 原型 `ordSeg` **按客户名**（商用车/电网·储能/默认乘用车，L2382）；系统 `segmentOf` **按型号**（essModels/comModels，L432）。两者对同一订单可给出不同分段 → 营收/毛利/分组全错位。
- **裁决**：以原型为准——`segmentOf` 改为**按 cust 正则**（`/商用车/→com、/储能|电网/→ess、else pas`），或在 config 加 `segByCust:{comPattern,essPattern}`（②）。`essModels/comModels`（电池型号）与本原型 `ORDERS` 型号不匹配，须废弃或仅作 fallback。**这是 1:1 的硬伤，必须改。**

**C. SEG_PRICE/SEG_MARGIN 数值分歧**
- 系统 `SEG_PRICE={pas:0.6,com:0.55,ess:0.5}`（risk.ts:364，单位口径不同）；原型 `{乘用车:2.2,商用车:1.8,储能:1.4}` 万元/套 + `SEG_MARGIN{0.18,0.15,0.13}`。
- 二者营收口径不一致（系统 revenue 偏小）。**裁决**：把 SEG_PRICE/SEG_MARGIN 移入种子 config（②，battery.ts），取原型值 `{pas:2.2,com:1.8,ess:1.4}` / `{0.18,0.15,0.13}`；KPI 营收随之对齐。声明：原型注释标「示意」，研发可在 config 调值但**默认须=原型**以过 1:1 像素核对。

**D. 排序分歧**
- 原型明细按**交期 `dueDay` 升序**（L2423 `sort((a,c)=>dueDay(a.o.due)-dueDay(c.o.due))`）；系统 `affectedOrdersAggregate` 按 **`so` 升序**（L413）。**裁决**：改系统排序为 `dueDay` 升序（与原型一致，决策语义=最早到期最先看）。

**E. 延误派生分歧（轻微，确定性差异）**
- 原型 `delay = max(1, 2 + hashN(so+b, 4))`（含 base，模 4）；系统 `delay = max(1, round((peak−85)/8) + hashString(so)%3)`（不含 base，模 3，且 peak 动态）。聚合后都取 max，但**逐基地值会不同**。**裁决**：可接受差异（聚合取 max，最终可视值近似），但须在 §4.6 与 i18n 标注"延误为估计区间"。若要严格 1:1，改 jit 为 `hashString(so+baseId)%4` 且 base 项 = `round((85-70)/8)=2` 常量。**标注：此项 1:1 不严格，建议对齐。**

**F. 信用/压价归因分歧**
- 原型 `ORDER_OVR`（L3222）**显式标注** 6 单（SO-3437/3506/3540 信用超限、SO-3470/3458/3518 框架压价），有明确 `why` 文案；系统 creditRatio 由 `hashString(cust|so)%60` 随机派生，**不一定命中同样 6 单**。
- **裁决**：把 `ORDER_OVR` 6 单作为种子覆盖项（①，加入订单实例 props 或 `affected.problems.overrides`），buildOrderProblems 优先读显式 override 再 fallback hash。否则问题卡的 CREDIT/MARGIN 归类与原型不一致。**标注：影响问题卡内容 1:1，建议补 override 种子。**

**G. 摘要条 KPI 项差异**：见 §2.1。系统 4 项 vs 原型 5 项，口径部分不同。**裁决**：合并为 6 项（原型 5 + 营收），或保留系统 4 + 补「风险因素点/最早越线日」2 项。

**H. 4 类问题卡 vs 原型 `problemAgg` 8 根源粒度差**
- 系统 4 类（DELIVERY/MARGIN/KIT/CREDIT，risk.ts）；原型聚合视图本身**不渲染问题卡**，问题归并在 order 全链页 `problemAgg`（ROOT_LIB 8 根源：crm/push/frame/credit/lta/ramp/maint/cost）。**裁决**：本视图保留系统 4 类（决策面足够、已实现）；ROOT_LIB 8 根源属 order 视图（PRD-IND-order.md）。**不强行合并**——诚实承认两边设计取向不同，本视图以系统 4 类交付。

### 4.6 数据资产（完整，作种子/i18n;研发逐字录）
- **ORDERS 24 单**（§4.1，①种子，battery.ts 物化，须与现有种子对账：`c.orders[*].props{so,cust,model,qty,due,pri,bases,unitPrice}`）。
- **ORDER_OVR 6 覆盖**（①，§4.5-F）：SO-3470{mAdj:-3.2,why:'电网公司F 框架价压价'} · SO-3437{credit,why:'商用车集团G 在手应收 9.8亿 + 新单 12.6亿 > 信用额度 21亿'} · SO-3506{credit,why:'商用车集团G 二次追单…'} · SO-3458{mAdj:-3.0,why:'电网公司F 框架协议低价…'} · SO-3518{mAdj:-2.6,why:'储能集成商D 价格战跟价'} · SO-3540{credit,why:'商用车集团G 低优先级单，信用额度已被占满'}（逐字 L3222-3229）。
- **SEG 常量**（②config）：§4.3 价/利/色 + econ 系数（fg 0.22/0.12·wip 0.30/0.15·rm 0.18/0.10，L2386）。
- **FACTOR_OBJ**（④i18n，L1633）：瓶颈工序→产线负载率·设备OEE→设备OEE·人力工时→人力工时供给·物料齐套→物料供给齐套·物流时长→物流在途时效·换型损失→换型占用·良率波动→良率稳定性（风险 chip 标签用）。
- **PROBLEM_TITLES**（④i18n，risk.ts:425）：DELIVERY 交期风险订单·MARGIN 毛利承压订单·KIT 齐套缺口订单·CREDIT 信用额度超限订单。`CATEGORY_LABEL`（OrderChainView L21）：交期/毛利/齐套/信用。`ruleKeys`（②）：{DELIVERY:C03,MARGIN:C15,KIT:C06/C16,CREDIT:C13}。
- **根因链文案**（④i18n）：risk.ts L460-517 逐句（订单/判定/根因/对策四层），数值取 ORDERS(①) + cfg。
- **dl-hint 三条**（④i18n，§4.4 逐字）。
- **风险浮层/来源 Modal**（与产能推演共享）：`SRC_META`（L2532-2539，EAM/S&OP/WMS 三系统血缘）、`buildRiskPop` desc/cause/basis 模板（L2574-2596）、QA 4 问。复用 `RiskPopover`，不重录。

## 5. 契约 / 端点
- `contracts/planviews.ts`：`OrderProblemGroupSchema` 保持；**新增 `AffectedOrdersEconSchema`**（econ.groups/total，§4.5-A）并入聚合输出 schema；或前端纯派生 + config 提供系数（推荐，schema 不变）。
- VM `api/types.ts:274 AffectedOrdersOutputVM`：加可选 `econ`（若走求解器输出）。
- 种子 config `battery.ts:130 affected`：加 `econ.coef`、`segPrice`、`segMargin`、`segByCust`（pattern）、`problems.overrides`（ORDER_OVR 6 单）。改 `segmentOf` 按 cust（§4.5-B）。
- 端点：`POST /a/v1/solvers/affected_orders/invoke`（无 `baseId` → 走 `affectedOrdersAggregate`，service.ts:572；`{base}` 过滤单基地）。OBO 透传用户 JWT。**无新端点**。
- ViewDef `synthetic/service.ts:1027 order-chain`：`layout` 已含 `{solverKey:'affected_orders', window:{before:7,after:14}, problemCategories, categoryLabels, segColors}`；**加 `segPrice/segMargin/econCoef/segMode默认`** 供前端 econTable 零写死。

## 6. 融合集成点（拆分表 · 不绕过）

| 关注点 | order-aggregate（本 PRD） | order（per-order，PRD-IND-order.md） |
|---|---|---|
| Renderer | `order-chain`（registry.ts:50，**复用增强**）| 待定（per-order DAG renderer，新）|
| 求解器 | `affectedOrdersAggregate` + `buildOrderProblems`（risk.ts）| `ordFull/orderJudge/odNodes`（原型 L3230/4020，系统未落地）|
| 主体内容 | 摘要条 + econTable + 明细表 + 基地筛选 + 4 问题卡 | 单订单 11 节点全链 DAG + 承接判定 + ROOT_LIB 8 根源 |
| ViewDef | `service.ts:1027 order-chain.layout` | 新 ViewDef |
| Feature | `view.order-chain`（features.ts）| 新 feature gate |
| 导航 | 基地负责人工作台（baseManagerExtras，service.ts:1073）| 推演组 |
| 共享 | 风险浮层/来源Modal/RiskPopover · affected_orders 求解器 · SEG 口径 · ORDERS 种子 | 同左（同源）|

**5 融合点（本视图）**：① Renderer 复用 OrderChainView（增 econTable + segMode 切换）② ViewDef layout 补 econ 配置 ③ 求解器对齐分段/排序/营收口径（§4.5 B/C/D）④ 种子补 ORDER_OVR + econ 系数 ⑤ i18n 补 econTable/segsel 文案。**复用现有 order-chain，增强不重建。**

## 7. 验收（DoD = 真 1:1）
- **像素核对**（与 HTML `产能推演 → 订单聚合 Tab` 并排，逐元素勾）：摘要 KPI 条（5 原型项 + 营收/数量可见）/ 基地筛选（去·总部+计数+清除 chip）/ **经营数据看板（应用 vs 基地切换、8 列、dot、合计行、毛利率、口径脚注）** / 受影响明细表（8 列、应用 chip、风险 chip 限 4+more、悬停浮层、延误红）/ 4 问题卡 + 根因链 DAG / 空态文案——**结构/值/字符串/交互全一致**（色/字可不同）。漏一项不过。
- **交互**（逐项 FDE 亲手跑）：选基地→重算并收窄·清除→还原·切应用/基地→econTable 重算·悬停风险 chip→浮层（描述/根因/来源链接/对话）·点问题卡→DAG Modal·空基地→空态。
- **数据**：前端零写死（`debattery:check` 过，econ 系数/SEG 价利均来自 config/ViewDef）；ORDERS 24 单 = HTML 精确；同 seed 字节一致（R6）；营收/分段口径已按 §4.5-B/C 对齐原型；延误/信用归因分歧已按 §4.5-E/F 裁决并记录。
- **拆分诚实性**：本视图不含逐单 11 节点 DAG；4 类问题卡 vs ROOT_LIB 8 根源差异已在 §4.5-H 声明。
- `pnpm -r build && test` 全绿；`ontology:check` 过。
- 回写本体：affected_orders 聚合输出新增 econ 字段 → 更新对应章节（对象类型 Order/分段口径、链路"风险→订单→财务暴露"）。

## 8. 实施任务（研发可直接拆）
1. **种子/config**（battery.ts:130）：加 `segPrice{pas2.2,com1.8,ess1.4}`、`segMargin{pas0.18,com0.15,ess0.13}`、`segByCust{comPattern:'商用车',essPattern:'储能|电网'}`、`econ.coef{fg,wip,rm}`、`problems.overrides`(ORDER_OVR 6 单)。
2. **求解器对齐**（risk.ts）：`segmentOf` 改按 cust（§4.5-B）；`affectedOrdersAggregate` 排序改 `dueDay` 升序（§4.5-D）；revenue 用新 segPrice；`buildOrderProblems` 优先读 override（§4.5-F）；（可选）jit 对齐 `hashString(so+base)%4`（§4.5-E）。
3. **契约/VM**：决定 econ 走"求解器输出"还是"前端派生"；若输出则加 `AffectedOrdersEconSchema` + VM `econ`。
4. **前端 econTable**（OrderChainView）：新增 `rk-segsel` 切换（app/base，`setOrderSeg`）+ econ 渲染（dot/8 列/合计/毛利率）+ 口径脚注；econ 全由 config + rows 派生（零写死）。
5. **前端摘要条**：补「风险因素点 / 最早越线日」2 KPI（§2.1），与营收/数量并存。
6. **前端明细表**：核对 risk chip 文案（基地去·总部 + FACTOR_OBJ + 越线日表达，i18n 固化）；列副标题"X 批·合计 Y 万套·Z 家客户"由 summary 派生。
7. **i18n**：econTable/segsel/dl-hint 三条 + PROBLEM_TITLES + 根因链文案 + FACTOR_OBJ 入 `locales/zh`（`zh.orderChain.*` 扩展）。
8. **验收**：FDE 亲手跑 §7 交互全表；像素并排核对订单聚合 Tab；回写本体。

> **拆分提醒**：本 PRD = 跨订单聚合/问题视图（order-aggregate）。逐单 11 节点全链推演（ordFull/orderJudge/odNodes/ROOT_LIB）属 `PRD-IND-order.md`，**勿在 order-chain renderer 里塞单订单 DAG**——两者共享 affected_orders 求解器与 SEG 口径，但 UI/交互/求解面不同。索引见 `PRD-verbatim-1to1-replication.md §2`。
