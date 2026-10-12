# 工业级 PRD · 产能推演 / 风险（risk）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 数据）。**只读本文 + 像素参照 HTML 即可 1:1 实现**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`（`buildRisk` L2343 · `riskVal` 风险曲线引擎 L1627 · `openRiskCard` L2464 · `showDayTip` 逐日圆点轴悬停 L2512 · `buildRiskPlanRows` L3443 · 数据 `BASE_DATA` L1526 / `MODEL_DEF` L1542 / `ORDERS` L1558 / `BN_FACTORS` L2308 / `RISK_SOL` L1710）——本文已把其全部常量/公式/字符串/交互转录,研发以本文为准、HTML 仅作像素核对。 |
| 落点（融入,不新建） | 前端 `apps/frontend-shell/src/views/RiskBoardView.tsx`（renderer `risk-board`）+ `@/components/Risk/RiskPopover` · 后端求解器 `apps/datacore/src/solvers/risk.ts`（`riskTimeline` L185 · `tensionSeries` L138 · `riskEvents` L98 · `affectedOrders` L275 · `affectedOrdersAggregate` L366）· 种子 `apps/datacore/src/synthetic/battery.ts:50 BATTERY_SOLVER_PARAMS.risk/bottleneck/affected` + `BASES` L9 + `ORDERS` 种子 · 契约 `packages/contracts/src/solvers.ts:69 RiskCardSchema / RiskTimelineOutputSchema` |
| 不变量 | R14（前端零写死,值来自管线）· R6（同 seed 字节一致 · `riskVal/tensionSeries` 确定性,无时钟/随机）· R13（每数可溯）· R-一致（基地/因素/订单/时序口径跨视图同源,与 order-chain / dash 共用 `affectedOrders`）· 1:1=结构/数据/交互 100%,**唯色调/字体可调** |

---

## 1. 视图概述

产能推演（HTML 标题「产能推演」L2349）是**计划-执行之桥**：监测执行偏离 **月度计划 V7** 的风险，预测未来 H 天内哪些「基地 × 产能影响对象」会越线（紧张度≥85），把"非瓶颈但窗口内将越线"的因素提前暴露为风险卡，再沿 **风险卡 → 逐日圆点时序轴 → 对症处置方案 → 人机对话 → 采纳→工单/反提月度差异(C21)** 一条链给出处置闭环。

核心机制（HTML L1637 `buildRiskCards`）：对每个基地遍历 7 个产能影响对象（`BN_FACTORS`），**跳过该基地的"真正瓶颈"（`BN_PRIMARY`，已是瓶颈不算"将越线"）与当前已≥85 者**，用确定性风险曲线 `riskVal` 逐日推演，凡窗口内首次≥85 即生成一条风险因素 `{f,cur,peak,cross}`；多因素并入一张基地卡，按越线日排序，取前 8 张。**系统只摆"哪里会越线、何时、影响谁、有哪些对症方案"，处置与否由基地负责人 / 生产计划部拍板**（采纳生成预警处置 Action 写回工单 + 留审计）。

两个视角切换（`riskTab` L2338）：**瓶颈视角**（默认，风险卡网格 + 展开时序轴 + 处置方案 + 人机对话 + 处置行动计划表）与**订单聚合**（`buildOrderAgg` L2418，按应用/基地聚合受影响订单的产能·库存·财务看板 + 明细表）。

## 2. UI 规格（布局 · 像素结构）

### 2.1 整页（`buildRisk(H)` L2343，容器 `#riskwrap`）

```
┌ rk-top ────────────────────────────────────────────────────────────────┐
│ <h3>产能推演</h3>                                                          │
│ rk-sub: "计划-执行之桥：监测执行偏离 [月度计划 V7](色#B07FD8) 的风险 · 未来  │
│   {H} 天内预测越线（紧张度≥85）· 今天 {dateOf(0)} · 偏离 → 处置 Action 或  │
│   反提月度差异（C21）"                                                      │
│ 右 rk-hsel: [瓶颈视角(on)] [订单聚合]  ·gap·  [30天] [60天(on)] [90天]      │  ← H 切换
└──────────────────────────────────────────────────────────────────────────┘
┌ rk-kpi（5 KPI + 可选健康提示） ─────────────────────────────────────────┐
│ [风险基地 {cards.length}](#DD7E9E) [风险因素点 {Σfs}](#C470B8)              │
│ [受影响订单(批) {allOrd}](forecast) [涉及客户 {allCust}](capacity)          │
│ [最早越线日 T+{minCross}·{date}](solver)   {hp.note 数据健康度降级? }       │
└──────────────────────────────────────────────────────────────────────────┘
── 瓶颈视角 riskTab='risk' ──
┌ rk-grid（响应式卡网格） ────────────────────────────────────────────────┐
│ rk-card ×N（左边框 = riskColor(peak)55，点击展开 #rkDetail）              │
└──────────────────────────────────────────────────────────────────────────┘
[#rkDetail 展开体（见 §2.3）]
[planTableHTML('riskPlan', …, buildRiskPlanRows()) — 处置行动计划表（见 §2.4）]
── 订单聚合 riskTab='order' ──  buildOrderAgg(H)：基地筛选 + 经营看板 + 明细表（§2.5）
```

- `rk-sub` 中 `月度计划 V7` 用紫 `#B07FD8`；`H` 默认 **30**（`let riskH=30` L2338）但 HTML 初始按钮高亮 30/60/90 中 H 当前值。
- `hp.note`（`healthP90` L1603）：仅当 `DATA_HEALTH['IoT/SCADA'].status==='延迟'` 时出现 `⚠ 数据健康度：IoT/SCADA 延迟 4.2h → 产能置信度降级（P90 系数 0.93→0.90）`，否则不渲染（系统对应 `params.health.staleHours` + scenario）。

### 2.2 风险卡 `rk-card`（L2366）

```
┌ rk-card（id=rkc{i}，border-color=riskColor(peak)55；.open 高亮） ───┐
│ rk-c-h:  <b>{base 去「·总部」}</b>   rk-own:{owner 去「基地负责人·」} │
│ rk-c-m:  rk-peak「T+{cross}」(色 riskColor(peak),17px) ·             │
│          rk-unit「{date} 最早越线」(11px,#DD7E9E)                     │
│ rk-chips: 每因素 rk-fchip「{FACTOR_OBJ[f]} T+{cross}」              │
│          (border/文字 = riskColor(x.peak))                          │
│ rk-c-f:  「{fs.length} 个风险因素」(#DD7E9E)  「{orders} 批订单受影响」 │
└────────────────────────────────────────────────────────────────────┘
```

> 注 `FACTOR_OBJ`（L1633）把"约束因素"映射为"产能影响对象"显示名：瓶颈工序→产线负载率 · 设备OEE→设备OEE · 人力工时→人力工时供给 · 物料齐套→物料供给齐套 · 物流时长→物流在途时效 · 换型损失→换型占用 · 良率波动→良率稳定性。

### 2.3 展开体 `#rkDetail`（`openRiskCard(i)` L2464，`scrollIntoView` 平滑定位）

```
┌ rk-det ────────────────────────────────────────────────────────────────┐
│ rk-det-h: <b>{base} · 产能影响对象全景</b>                                 │
│           <span>{owner} · 未来 {H} 天（{date1} ~ {dateH}）· 悬停任意点看  │
│             当日影响</span>                                                │
│ rk-tl（时间轴容器）:                                                       │
│   dateAxis(H): rk-ticks — 每日 1 格 rk-tick，d===1||d%5===0||d===H 显日期   │
│   factorRow × (风险因素 fs + 补全 others):                                │
│     rk-flab: <b 色riskColor(peak)>{FACTOR_OBJ[f]}</b>                     │
│              <span>{cur}→{peak} · {cross? T+cross date : 窗口内不越线}</span>│
│     rk-dots: H 个 rk-dot 圆点（背景 riskColor(riskVal(b,f,d))，悬停 showDayTip）│
│ rk-leg: [<70 正常#62BE77] [70-84 关注#D2B04C] [≥85 瓶颈#DD7E9E]            │
│         右「首要风险对象：{FACTOR_OBJ[c.f]}（{date} 越线）」                 │
│ rk-two（两栏）:                                                            │
│   ├ 左「💡 对症方案 · {FACTOR_OBJ[c.f]}（{sols.length} 个）」(色 quality)   │
│   │   rk-sol ×N: rk-sol-h「{k+1}. {s.n}」+ 按钮「采纳→工单」(adoptRiskSol) │
│   │             rk-sol-m「{eff} · {t} · 投入:{cost} · 风险:{risk}」         │
│   └ 右「💬 人机对话」(色 capacity)                                          │
│       qa-chips ×4（预设问题，点击 riskAsk）                                │
│       rk-ans「点击问题，或在下方输入追问。」                                 │
│       rk-ask: <input#rkInput placeholder> + 「问」按钮（riskFree）          │
│       审计区（auditHTML，id 改 riskAuditWrap/riskAuditList）               │
└──────────────────────────────────────────────────────────────────────────┘
```

- **行排序（关键 1:1 细节，L2466-2471）**：先渲染风险因素 `c.fs`（已 `cross` 升序），再补全 `others`＝该基地"非真正瓶颈 且 不在 fs 中"的其余因素（窗口内不越线，`cross:0`，仅展示曲线全景）。即一张卡展开后行数 = `7 − 1(主瓶颈) = 6` 行（主瓶颈本身不进时序，因它已是瓶颈非"将越线"）。
- **首要风险对象** = `c.f`（fs[0].f，越线最早者）。

### 2.4 处置行动计划表 `riskPlan`（`buildRiskPlanRows` L3443 + 通用 `planTableHTML`）

- 标题「产能风险处置 · 最终方案与行动计划」，副「按越线日前置 7 天排启动时间 · {N} 基地 · 峰值≥90 配备份方案」。
- 列：行动项 act / 详情 det / 责任人 owner / 启动 start / 完成 done / 预期 eff / 规则 rule。
- 行构造（逐条 1:1）：
  - 每基地主因素首选方案 `sols[0]`：`act={s0.n}（{base}）`、`det=峰值{peak}·{FACTOR_OBJ[f]}`、`owner={owner}`、`start=T+{cross−7}·{date}（越线前7天）`、`done=T+{cross}·{date}（越线日）`、`eff={s0.eff}·{s0.t}`、`rule=C05`。
  - 若 `peak≥90` 且有 `sols[1]`：追加备份行 `act={sols[1].n}（{base}·备份方案）`、`det=峰值≥90 双保险`、`start=T+{cross−3}`、`done=T+{cross+7}`、`rule=C05`。
  - 若存在 `cross≤14` 的基地（`early`）：追加一行 `act=反提月度计划差异（{基地列表}）`、`det=14 天内越线，需计划层资源协同`、`owner=计划中心 → S&OP`、`start=T+1·{date}`、`done=本周 S&OP`、`eff=计划-执行闭环，差异进入月度议程`、`rule=C21`。
  - 排序：按 `start` 字符串 `localeCompare(...,{numeric:true})`。

### 2.5 订单聚合视角 `buildOrderAgg(H)`（L2418）

```
rk-basesel: 「基地筛选：<select>」全部风险基地({n}) / 各风险基地（onchange setOrderBase）
            选中态额外 rk-fchip「✕ 清除（当前：{base}）」
econTable（受影响订单 · 经营数据看板）:
  rk-det-h: <b>受影响订单 · 经营数据看板</b> + 副（按整车/储能应用 或 按基地 · 亿元）
  rk-segsel: 分类维度 [乘用车/商用车/储能(app)] [按基地(base)]（setOrderSeg）
  table.cmp: 列 = 分类 | 受影响产能(万套) | 成品库存 | 半成品库存 | 原材料库存 |
             未结订单金额(forecast色) | 毛利额(quality色) | 毛利率
             末行合计；dl-hint 口径说明
明细表（受影响订单 · 明细）:
  rk-det-h: <b>受影响订单 · 明细（{scope}）</b> 副「{n} 批 · 合计 {totQ} 万套 · {custs} 家客户 · 按交期排序」
  table.cmp: 订单 | 客户 | 应用(seg fchip) | 型号 | 数量 | 交期 |
             关联风险点（基地·对象·越线日，最多4 chip+「+more」，悬停 showRiskPop）| 延误(#DD7E9E)
  dl-hint: 聚合口径说明（[T−7,T+14] 窗口、多基地均摊、延误取最大）
```

### 2.6 浮层 / 弹框（共 4 个）

| 浮层 | 触发 | 结构（HTML） |
|---|---|---|
| **逐日 tip** `#rkTip.rk-tip` | 圆点 `onmouseenter showDayTip` L2512 | rk-tip-h「{date}（T+{d}）· {FACTOR_OBJ[f]} 紧张度 {v}(色)」· rk-tip-ev（当日事件或"基线负荷自然爬升（无事件脉冲）"）· table.cmp 受影响订单前 4 行（订单/客户/数量/交期/影响[≥85 延误X天 / 关注]）+「…等 N 批」 |
| **风险点弹框** `#rkPop.rk-pop` | 明细表风险 chip `onmouseenter showRiskPop` L2605 | rk-pop-h（基地·对象 + 峰值·越线）· 风险描述 desc · 根因分析 cause（事件「来源」可点 openSrcModal）· 时序推演依据 basis（公式文字版）· 「💬 就该风险点发起人机对话」→ pin 后展开 4 预设问题 + 输入框 |
| **来源系统详情** `#srcModal` | 弹框内「来源 ⤢」`openSrcModal` L2553 | 来源系统 / 数据表 / 数据明细字段表（`srcDetailRows`）/ 采集频率·最近更新·责任人·血缘（`SRC_META`） |
| **采纳工单** `#actModal` | rk-sol「采纳→工单」`adoptRiskSol` L2644 | 预警工单草稿 MO-2026-0610-NN · 触发 · 行动项 · 发起人/审批人「规划员·王工 → 生产计划部·张经理」+「▶ 提交审批（写回·留审计）」submitRiskAction |

> 系统现状已有 `RiskPopover`（`RiskHoverTrigger` + `heatColor`），`AffectedOrdersModal`（订单弹窗），但**逐日 tip 内容、风险点弹框三段式、来源系统详情、采纳工单弹框、订单聚合视角、处置行动计划表均缺**（见 §4.5）。

## 3. UX 规格（交互 · 状态 · 流）

| 交互 | 触发 | 行为 |
|---|---|---|
| 切视角 | rk-hsel chip `setRiskTab('risk'/'order')` L2342 | `riskTab=t` → `buildRisk(riskH)` 重建（瓶颈视角 ↔ 订单聚合） |
| 切窗口 H | [30/60/90天] `buildRisk(x)` | `riskH=x` → 全量重算（卡/时序/订单/计划表都随 H 变） |
| 点风险卡 | rk-card `openRiskCard(i)` | `riskOpen=i`，所有卡 toggle `.open`，渲染 `#rkDetail`，平滑滚动定位 |
| **悬停逐日圆点** | rk-dot `onmouseenter showDayTip(b,f,d,ev)` / leave `hideDayTip` | 复用/创建 `#rkTip`，填日期+T+d+紧张度 v + 当日事件 + 受影响订单前4 行；定位在圆点下方（溢出则翻到上方），夹在视口内 |
| 点处置方案采纳 | rk-sol「采纳→工单」`adoptRiskSol(i,k)` | 填 `#actModal`：MO 草稿 + 触发 + 行动项 + 审批链 → 提交 `submitRiskAction` |
| 提交审批 | actModal「提交审批」`submitRiskAction` | `AUDIT.unshift(...)` 状态「待审批 → 生产计划部·张经理」，关弹框，刷新风险审计区 + 全局审计区 |
| 人机对话-预设 | qa-chip `riskAsk(i,k)` | `#rkAns` 填 Q/A（A 来自 `window.__riskQA` 实时算）4 问见 §4.6 |
| 人机对话-追问 | `#rkInput` Enter / 「问」`riskFree(i)` | 正则路由：客户\|订单 / 方案\|建议\|怎么办 / 为什么\|原因 / 最坏\|后果\|不处理 / 兜底；填 `#rkAns` |
| 悬停明细风险 chip | rk-fchip-i `showRiskPop(b,f,cross,ev)` | 创建 `#rkPop`，三段（描述/根因/时序依据）+「发起对话」；hover 离开 240ms 后隐藏（pin 后常驻） |
| 风险点弹框-pin | 「💬 发起对话」`pinRiskPop` | `_rkPopPinned=true`，重渲染含 4 预设问题 + 输入框 + ✕；`riskPopAsk(k)`/`riskPopFree()` |
| 点「来源 ⤢」 | src-link `openSrcModal(b,f,d)` | 取 `riskEvents` 中 ±4 天事件，按来源系统派生字段明细（`srcDetailRows`）填 `#srcModal` |
| 订单聚合-切分类 | rk-segsel `setOrderSeg('app'/'base')` | `orderSegMode` 切换，重建经营看板（应用维度 / 基地均摊维度） |
| 订单聚合-筛基地 | select `setOrderBase(b)` | `orderBaseFilter` 过滤订单 + 仅显示该基地风险点 |
| 状态:无风险 | `riskCards.length===0` | KPI 显 0，网格空；最早越线日 `T+0`（minCross=0） |
| 状态:健康降级 | IoT/SCADA 延迟 | rk-kpi 末追加 rk-health 提示条（P90 0.93→0.90） |
| 状态:峰值≥90 | `peak>=90` | 计划表追加备份方案行（双保险） |
| 状态:越线≤14 天 | `cross<=14` | 计划表追加「反提月度计划差异（C21）」行 |

**关键状态机**：`riskTab ∈ {risk, order}` · `riskH ∈ {30,60,90}` · `riskOpen ∈ {-1, 0..N-1}`（仅一卡展开）· `orderSegMode ∈ {app, base}` · `orderBaseFilter ∈ {__all__, baseId}` · `_rkPopPinned ∈ {false,true}`。

## 4. 数据规格（值 + 来源 + 系统字段级落地）

> 前端**零写死**(R14)；所有值来自：①合成种子→物化 ②config/求解器参数 ③求解器口径 ④i18n ⑤ViewDef。

### 4.1 基地 `BASE_DATA`（①合成种子 · battery.ts `BASES` L9）

HTML 12 基地（L1526，字段 pos/lines/gwh/year/prod/util/bn），逐字：常州基地·总部(动力+储能,8线,35gwh,util88,bn化成) · 厦门(动力,6,28,85,化成) · 成都(动力+储能,7,30,82,老化) · 眉山(储能,5,22,79,化成) · 武汉(动力,5,20,80,涂布) · 江门(储能,6,26,83,老化) · 合肥(动力,5,20,78,化成) · 信阳(储能,4,16,75,涂布) · 枣庄(动力+储能,4,15,73,化成) · 邯郸(储能,3,12,70,老化) · 自贡(动力,4,16,77,化成) · 洛阳(储能,3,12,68,涂布)。`POS_COLOR`：动力#5E8FE8 / 储能#62BE77 / 动力+储能#D2B04C。

### 4.2 因素与主瓶颈（②求解器参数 · battery.ts `bottleneck`）

- `BN_FACTORS`（L2308 / battery.ts:40 已一致）：瓶颈工序·设备OEE·人力工时·物料齐套·物流时长·换型损失·良率波动。
- `BN_PRIMARY`（L2310）每基地真正瓶颈：常州/厦门/成都/江门/合肥/枣庄→瓶颈工序 · 眉山/洛阳→物料齐套 · 武汉→人力工时 · 信阳/邯郸→物流时长 · 自贡→换型损失。系统 `params.bottleneck.primary`（battery.ts:61）。
- `FACTOR_OBJ`（L1633，④i18n）显示名映射（见 §2.2 注）。

### 4.3 订单 `ORDERS`（①种子 · battery.ts `ORDERS`）

HTML 24 单（L1558，字段 so/cust/model/qty/due/pri），逐字录入种子（SO-3391…SO-3540）。`MODEL_DEF`（L1542）型号→可产基地：4680-NCM→[常州,成都,合肥] · 2170-NCM→[厦门,武汉,自贡] · 方形-NCM→[常州,成都] · 方形-LFP→[江门,眉山,邯郸,枣庄] · 圆柱-LFP→[信阳,洛阳] · 4680-LFP→[常州,枣庄]。`T0=2026-06-10`（系统 `params.forecastStart`，注意系统现值 `2026-07-01` — 见 §4.5）。`dueDay(d)=max(1,round((due−T0)/天))`（系统 `dayFrom`）。

### 4.4 求解器口径（③ · risk.ts，确定性 R6）

**bnTight（L2313 / `mockTightness` risk.ts:15）**：`seed=(b.charCodeAt(0)+f.charCodeAt(0)×7)%9`；若 `f===BN_PRIMARY[b]`→`min(97,88+seed%9)`；否则→`min(83,55+seed+(util>82?6:2))`。系数全在 `params.bottleneck.mock`（mod9/factorMult7/primaryBase88/primaryCap97/secondaryBase55/secondaryCap83/utilHigh0.82/utilHighAdd6/utilLowAdd2 ✓ 与 HTML 一致）。

**riskTarget（L1626 / risk.ts:131）**：HTML `h=hashN(f.charCodeAt(0)+'#'+b+f,10); h<4?86+h*2:58+h`。**系统现用** `lift=((b首码+f首码)%mod)+base`（`min(96,cur+lift)`，targetLift{base:8,mod:13}）—— **口径不同**（系统是"基线+lift"、HTML 是"绝对目标位"，且 HTML 有 ~40% 组合落在 86-92 高位）。见 §4.5 缺口。

**riskVal（L1627 / `tensionSeries` risk.ts:138）**：
```
cur = bnTight(b,f); tgt = riskTarget(b,f)
v(d) = cur + (tgt−cur)·min(1, d/(H·0.72))           // 基线爬升（rampDen=0.72）
ps   = max(0.25, 1−(v−68)/45)                        // 高位脉冲衰减（psFloor.25/psStart68/psDen45）
for each event e where |d−e.day|≤3:                  // pulseWindow=3
  v += e.amp · ps · (1 − |d−e.day|/4)                // pulseDecayDen=4
return min(98, round(v))                             // cap=98
```
系统 `tensionSeries` 系数全 ✓ 一致；额外支持 `mitigation`（d≥tn 起 `v−eff`，HTML 无消解曲线但有 §4.6 处置方案 eff 文案）。

**riskEvents（L1606 / risk.ts:98）**：三类事件 —
- `maint_window`（amp14）：仅 设备OEE/瓶颈工序，日 `maintWeek(b)×7−3`（`maintWeek=(b首码+len×3)%8+3`，第3~10周）。
- `delivery_peak`（amp9）：瓶颈工序/人力工时，每张可产订单交期日。
- `arrival_gap`（amp10）：物料齐套/物流时长，自 `arrivalCycleDays=14`（HTML `c0=11+hashN(b,4)` 起、步进14；系统简化为固定 14 起步 — 见 §4.5）+ DELAYED 在途追加脉冲。
事件系数全在 `params.risk.eventAmps`（maint14/delivery9/arrival10 ✓）。

**riskColor（L1632）**：`v≥85?#DD7E9E:v≥70?#D2B04C:#62BE77`（≥threshold 红 / threshold−15 黄 / 绿；系统 RiskBoardView 用 #E0626C/#E8B54A/#43B7D7，**色可调**）。

**buildRiskCards（L1637 / `riskTimeline` risk.ts:185）**：遍历基地×因素，跳过 `BN_PRIMARY` 与 `cur≥85`，逐日推演取 `cross`（首个≥85），有 cross 则入 fs；fs 按 cross 升序，多因素并基地卡，卡按 cross 升序取前 `maxCards=8`。系统 ✓（含 `forced` 直查模式）。

**riskOrders / affectedOrders（L1652 / risk.ts:275）**：该基地、交期落 `[day−7, day+14]`；`delay=max(1, round((85−70)/8)+hashN(o.so+b,4))`（系统 `round((peak−threshold)/delayDiv)+jit`，delayDiv8/jitterMod3）。**注意 HTML delay 用固定 (85−70)/8=1.875≈2，系统用 (peak−85)/8 动态** — 见 §4.5。

### 4.5 ★系统字段级落地（现状 → 须改/须加,精确）

> 系统 `risk_timeline / affected_orders` 已**高度参数化**(R14)，`tensionSeries/riskEvents/bnTight` 系数与 HTML **逐字一致**（见 §4.4 标 ✓）。但存在以下 1:1 缺口，逐条精确列出：

**① 基地与型号命名错位（最大缺口，影响全链可溯）**
- 系统 `BASES`（battery.ts:9）= 常州/合肥/西安/宜宾/溧阳/青岛/南京/成都/福州/长沙/惠州/盐城（12 个，无「·总部」）。HTML = 常州基地·总部/厦门/成都/眉山/武汉/江门/合肥/信阳/枣庄/邯郸/自贡/洛阳。**须将种子 `BASES` 改为 HTML 12 基地**（含 `常州基地·总部` 带后缀，前端 `.replace('·总部','')` 显示），同步 `bottleneck.primary` 键、`MODEL_DEF` 可产基地、地图 `lon/lat`。
- 系统 `MODELS`（battery.ts:24）= 4680-NCM/4680-LFP/L300-NCM/L148-LFP/P28-NCM/S192-LFP。HTML = 4680-NCM/2170-NCM/方形-NCM/方形-LFP/圆柱-LFP/4680-LFP。**须改种子型号集 + `affected.problems.essModels/comModels`** 由 `["S192-LFP"]/["L148-LFP"]` 改为 HTML 应用映射（储能：方形-LFP/圆柱-LFP/4680-LFP；商用车按客户名含「商用车」判定）。
- 系统 `ORDERS` 须替换为 HTML 24 单（so/cust/model/qty/due 逐字），含客户名 整车厂A/B/C·海外车企E·商用车集团G·储能集成商D/H·电网公司F（应用分类 `ordSeg` 依赖：含「商用车」→商用车，含「储能\|电网」→储能，否则乘用车）。

**② forecastStart / T0 不一致**
- 系统 `params.forecastStart="2026-07-01"`，HTML `T0=2026-06-10`。**须统一为 `2026-06-10`**（否则 `dueDay`、越线日、`dateOf` 全偏 21 天，KPI「今天」「最早越线日」全错）。

**③ riskTarget 口径须改为 HTML 绝对目标位**
- 系统（risk.ts:131）`lift=((b首码+f首码)%13)+8` → `min(96,cur+lift)`。HTML（L1626）`h=hashN(f首码+'#'+b+f,10); h<4?86+h*2:58+h`，且不加 cur（是绝对目标位，~40% 组合落 86-92 高位 → 才有足够基地越线）。**须把 `riskTarget` 改为 HTML hash 公式**，新增 `params.risk.targetHash:{mod:10, hiThresh:4, hiBase:86, hiStep:2, loBase:58}`，使越线分布与 HTML 一致。**这是"卡片数量/越线日"能 1:1 的根因**——当前系统口径下越线基地数与 HTML 不同。

**④ delay 公式对齐**
- HTML（L1655）`delay=max(1, round((85−70)/8)+hashN(o.so+b,4))`＝固定 `(85−70)/8` + 抖动。系统（risk.ts:324）`round((peak−85)/delayDiv)+jit`＝动态 peak。**须改系统为 HTML 固定差**（或在种子加 `affected.delayConst=15` 显式声明），否则同窗口不同峰值的 delay 不同于 HTML。`jitterMod` HTML=4、系统=3 → **改为 4**。

**⑤ arrival_gap 起点对齐**
- HTML（L1618）首个到货间隙 `c0=11+hashN(b,4)` 起、步进 14。系统（risk.ts:116）固定 `d=14` 起、步进 14。**须加 `params.risk.arrivalStart:{base:11, hashMod:4}`** 并用 `c0=base+hashN(b)%hashMod`，否则物料齐套/物流时长越线日相对 HTML 偏移。

**⑥ 须加输出字段（契约扩展，见 §5）**
- `RiskCardSchema` 须加：`baseId`（已有于 solver 输出但未入 schema）、`owner`（`baseOwner`：`基地负责人 · ${OWNER_NAMES[hashN(b,8)]}`，OWNER_NAMES=王/李/张/刘/陈/杨/赵/黄经理）、`cur`（fs[0].cur）、`fs:[{f,cur,peak,cross}]`（一卡多因素，**当前 schema 一卡一因素，须改为基地维度多因素**）、`ordersCount`。
- `RiskTimelineOutputSchema` 须加：`minCrossDay`、`factorPointCount`（Σfs）、`affectedOrderCount`、`custCount`、`health:{degraded,note}`、`planRows`（处置行动计划表，buildRiskPlanRows 口径）、`mitigationLibrary`（已在 solver 返回但未入 schema）。

**⑦ 须加求解器输出（前端零写死）**
- **逐日 tip 内容**：`showDayTip` 的当日事件文案（`riskEvents` desc/src）+ 受影响订单前 4 行 — 须由 `affected_orders`（带 `day` 参数）+ `risk_timeline`（events 带 desc/src）输出，**当前 `RiskEventSchema` 缺 `desc/src/tag/obj` 字段**（HTML L1610-1624 事件描述含量化指标）。须扩 `RiskEventSchema` 加 `tag/obj/desc/src`。
- **风险点弹框三段式**（desc/cause/basis，L2574-2581）+ **来源系统详情**（`SRC_META` 3 来源 + `srcDetailRows` 派生字段，L2532-2552）：须新增求解器输出或专用端点（见 §5）。
- **处置行动计划表 `planRows`**：当前前端无此表 — 须 solver 输出 `planRows[]`（§2.4 口径）。
- **订单聚合经营看板**（`econTable`：SEG_PRICE/SEG_MARGIN/SEG_COLOR + 产能/成品/半成品/原料/未结金额/毛利，L2379-2417）：系统 `affectedOrdersAggregate`（risk.ts:366）已有 summary+rows+problems 但**缺库存资产（fg/wip/rm）与按应用/基地双维聚合**。须扩 `affectedOrdersAggregate` 加 `econ:{byApp,byBase,totals}`（`ordEcon` 口径：sales=qty×SEG_PRICE，gp=sales×SEG_MARGIN，fg/wip/rm=sales×(系数+hashN 抖动)），种子加 `affected.seg:{price:{乘用车2.2,商用车1.8,储能1.4}, margin:{乘用车.18,商用车.15,储能.13}, color}`。

**⑧ 前端组件须补**（RiskBoardView.tsx）
- 当前用 EChart bar 渲染 heat strip + `dayCell` 按钮（点击开订单弹窗）。**须改为 1:1 圆点轴**：`rk-tl`（dateAxis + factorRow×6）逐日圆点，`onmouseenter` 出 `showDayTip` 浮层（非点击弹窗）。当前缺：多因素行、补全 others 行、对症方案区、人机对话区、风险点弹框、来源详情、订单聚合视角、处置计划表、采纳工单弹框。**复用现有 RiskBoardView，增强不重建**。

### 4.6 数据资产（完整,作种子/i18n;研发逐字录）

- **RISK_SOL**（L1710，③种子 · `params.risk.mitigations` 已存在但**方案名/eff/cost/risk 与 HTML 不同**）：HTML 每因素 3 方案 `{n,eff,t,cost,risk}`，逐字录。如 物料齐套：[关键正极提前3周备料/峰值−12/T+5起效/低·占用周转/呆滞风险低]、[近端仓+供应商VMI/峰值−9/T+10/中·仓储费/需供应商配合]、[替代料并行认证/峰值−15(长效)/T+20/中·认证费/认证周期不确定]。**须把系统 `mitigations` 7×3 替换为 HTML 文案**（系统现用 提前备料/备选供应商切换/空运补料… 是简化版，名/eff/cost 不同）。瓶颈工序作 fallback（`RISK_SOL[c.f]||RISK_SOL['瓶颈工序']`）。
- **人机对话 4 预设**（`openRiskCard` L2475-2480，④文案+③实时数据）：
  1. `为什么 {date} 会越线？` → `riskWhy(c)`（L2496）：`{对象} 基线 {cur} → 测算目标位 {tgt}{?；叠加事件 <b>{tag}：{desc}（来源：{src}）</b>}；逐日序列于 {date} 首次 ≥85。`
  2. `订单再加 10% 会怎样？` → `需求脉冲叠加趋势，越线日预计提前 3~5 天（约 {date(cross−4)}），峰值升至 {min(98,peak+3)}；建议提前启动方案 1。`
  3. `哪个方案性价比最高？` → `综合消解幅度/起效时间/投入：<b>{sols[0].n}</b>（{eff}，{t}，{cost}）。若需长效，叠加方案 3。`
  4. `不处置的最坏后果？` → `riskWorst(c)`（L2499）：`若不处置：{N} 批订单存在延误风险（最受影响：{top2}），峰值 {peak} 将持续约 1 周，按现有排产估计影响交付 {round(Σqty×0.18)} 万套。`
- **追问路由 `riskFree`**（L2503）：`/客户|订单/`→列订单 · `/方案|建议|怎么办/`→首选方案 · `/为什么|原因/`→riskWhy · `/最坏|后果|不处理/`→riskWorst · 兜底引导语。**须入 i18n + agentcore 风险问答 intent**（与 dash/gen 人机对话同构）。
- **风险点弹框 4 预设**（`riskPopAsk` L2614）：影响哪些订单/客户？ / 推荐处置方案？ / 为什么这天越线？ / 不处置最坏后果？（A 同上口径）。
- **SRC_META**（L2532，③种子）：3 来源系统逐字 —— `EAM/CMMS 检修计划`（设备资产·检修管理 / PM_ORDER·EQUIP_STATUS / 设备工程·赵工 / 变更触发+每日批 / 血缘…）、`S&OP/ERP 订单交期`、`WMS/ERP 采购与在途`。`srcDetailRows`（L2540）按事件 desc 正则派生字段明细。
- **事件描述模板**（L1610-1624，④i18n + ③量化）：检修窗口 `年度检修（第{w}周）：计划停机 {days} 天，设备OEE 由基线下调 {oee} 个百分点…`（来源 EAM/CMMS）；交付高峰 `{so}·{cust} 交付 {qty} 万套到期：当周产线排产负载 +{load} 个百分点，需额外工时 {qty×1.6} 人·班`（S&OP/ERP）；到货间隙 物料 `关键正极安全库存覆盖降至 {cover} 天（阈值 5 天），物料齐套率 {kit}%（阈值 80%）` / 物流 `在途到货延迟 {lead} 天，待检在途 {n} 批`（WMS/ERP）。量化量用 `hashN` 派生（确定性）。
- **econTable 系数**（L2379-2386，③种子）：SEG_PRICE{乘用车2.2,商用车1.8,储能1.4} 万元/套 · SEG_MARGIN{.18,.15,.13} · SEG_COLOR{#5E8FE8,#D08A66,#54B5C4}；`ordEcon`：sales=qty×price、gp=sales×margin、fg=sales×(0.22+h×0.12)、wip=sales×(0.30+h×0.15)、rm=sales×(0.18+h×0.10)，h=hashN(so,10)/10。
- **KPI 颜色**（L2356-2361，⑤ViewDef）：风险基地#DD7E9E / 风险因素点#C470B8 / 受影响订单var(--forecast) / 涉及客户var(--capacity) / 最早越线日var(--solver)。

## 5. 契约 / 端点

- `contracts/solvers.ts`：
  - `RiskEventSchema` 扩 `tag/obj/desc/src`（事件可解释文案，§4.6）。
  - `RiskCardSchema` 扩 `baseId/owner/cur/ordersCount` + 改 `factor→fs[]`（基地维度多因素：`fs:z.array(z.object({f,cur,peak,cross}))`），保留 `factor`（=fs[0].f 别名，向后兼容）。
  - `RiskTimelineOutputSchema` 扩 `minCrossDay/factorPointCount/affectedOrderCount/custCount/health/planRows/mitigationLibrary`。
  - 新增 `RiskPointDetailSchema`（弹框三段 desc/cause/basis + sources[]）与 `RiskSourceDetailSchema`（SRC_META + 派生字段表）。
  - `AffectedOrdersAggregate` 扩 `econ:{byApp[],byBase[],totals}`（库存资产 fg/wip/rm + 金额/毛利）。
- 端点：
  - `POST /a/v1/solvers/risk_timeline/invoke`（已存在；扩输出）·参数 `{horizon, base?, factor?, mitigation?}`。
  - `POST /a/v1/solvers/affected_orders/invoke`（已存在；逐日 tip 传 `{baseId, day}`，聚合传 `{base?, horizon}` 扩 econ）。
  - `POST /a/v1/action-drafts`（采纳预警处置方案 → 写回工单 MO + 留审计，类型「预警处置方案」ACTION_TYPES L1701，校验 C06/C11，发起:基地负责人·审批:生产计划部）。
  - 风险点弹框/来源详情：复用 `risk_timeline`（events 带 desc/src）+ 新增 `POST /a/v1/solvers/risk_point_detail/invoke`（或在 risk_timeline 输出内联）。
  - 人机对话：AgentCore 风险问答 intent（`risk_why/risk_orders/risk_plan/risk_worst`），OBO 透传读 DataCore 求解器，文案口径同 §4.6。

## 6. 融合集成点（5 处,不绕过）

- **Renderer** `registry.ts`：`risk-board → RiskBoardView`（已注册，L31/L42），别名 `risk`。
- **ViewDef** `service.ts`：风险视图 layout（H 默认/视角 chip/KPI 配色键 → ViewConfig，前端零写死）。
- **Feature** `features.ts`：`view.risk-board`（entitlement 先于 authz，关闭→404）。
- **导航** ShellLayout：推演组「产能推演」入口。
- **场景启动器**：`risk_*` intents（瓶颈视角/订单聚合/逐日影响/处置方案）→ 选中实体写 `sessionStore.selectedObjects`（base），随问句提交。
- **复用现有 `RiskBoardView` + `RiskPopover` + `affectedOrders` 求解器，增强不重建**；与 order-chain（`affectedOrdersAggregate`）/ dash（problemAgg）/ history（risk cases）共用同一风险口径（R-一致）。

## 7. 验收（DoD = 真 1:1）

- **像素核对**：与 HTML 产能推演页并排，逐元素勾 —— rk-top/rk-sub/H 切换/视角切换 · 5 KPI(+健康提示) · 风险卡(基地名/owner/T+cross/因素 chip/订单数) · 展开时序轴(dateAxis + 风险因素行 + 补全行 + 圆点配色) · 图例 · 对症方案 3 卡 · 人机对话 4 预设+追问 · 处置行动计划表(主+备份≥90+反提C21) · 逐日 tip(日期/T+d/紧张度/事件/订单4行) · 风险点弹框三段 · 来源详情 · 采纳工单弹框 · 订单聚合(经营看板双维+明细表)。**结构/值/字符串/交互全一致**（色/字可不同）。漏一项不过。
- **交互**：切 H 全量重算 · 切视角 · 点卡展开滚动定位 · **悬停圆点出逐日浮层**（非点击）· 采纳→工单→提交→审计刷新 · 人机对话预设+追问路由 · 明细 chip 悬停风险弹框 + pin 对话 · 来源 ⤢ 详情 —— 逐项 FDE 亲手跑。
- **数据**：前端零写死(`debattery:check`)；基地/型号/订单/RISK_SOL 文案=HTML 精确（§4.5①、§4.6）；`riskTarget` 口径=HTML hash（§4.5③）；越线基地数/最早越线日与 HTML 一致；同 seed 字节一致(R6)；每数可溯(R13)；逐日序列首个≥85 = cross。
- `pnpm -r build && test` 全绿；`chain:check`/`ontology:check` 过。
- 回写本体 §2（risk_timeline / affected_orders 扩展：事件可解释字段、基地多因素卡、econ 聚合、处置 Action 链）。

## 8. 实施任务（研发可直接拆）

1. **种子对齐**（battery.ts）：`BASES`→HTML 12 基地（含·总部 + lon/lat）· `MODELS`→HTML 型号集 · `ORDERS`→HTML 24 单 · `bottleneck.primary` 键改中文基地名 · `forecastStart→2026-06-10` · `MODEL_DEF`/可产基地。
2. **求解器口径修正**（risk.ts）：`riskTarget`→HTML hash 绝对目标位（加 `targetHash` 参数）· `delay`→固定 (85−70)/8 + jitterMod4 · `arrival_gap` 起点 `c0=11+hashN(b)%4`。
3. **RISK_SOL 文案**：`params.risk.mitigations` 7×3 全替换为 HTML 方案名/eff/t/cost/risk（§4.6 逐字）。
4. **契约扩展**（solvers.ts）：RiskEventSchema 加 tag/obj/desc/src · RiskCardSchema 加 baseId/owner/cur/fs[]/ordersCount · RiskTimelineOutputSchema 加 minCross/factorPoint/affected/cust/health/planRows/mitigationLibrary · 新增 RiskPointDetail/RiskSourceDetail · AffectedOrdersAggregate 加 econ。
5. **求解器输出补全**（risk.ts）：events 注入 desc/src 模板（§4.6 量化）· `planRows`（buildRiskPlanRows 口径）· `affectedOrdersAggregate` 加 econ 双维（SEG_PRICE/MARGIN/COLOR + fg/wip/rm）· `riskPointDetail`（desc/cause/basis + SRC_META 派生）。
6. **前端 1:1**（RiskBoardView.tsx）：heat strip 改逐日圆点轴 `rk-tl`（dateAxis+factorRow×6+补全行）· 圆点 `onmouseenter showDayTip` 浮层(日期/T+d/紧张度/事件/订单4行) · 对症方案区(3 卡+采纳→工单) · 人机对话(4预设+追问) · 风险点弹框(三段+pin 对话) · 来源详情弹框 · 采纳工单弹框 · 订单聚合视角(经营看板双维+明细表+基地筛选) · 处置行动计划表 · KPI 配色键 · 健康降级提示。
7. **AOP/Action**：采纳预警处置 → `POST /a/v1/action-drafts`（类型 ACTION_TYPES L1701，C06/C11，审批链）+ 审计刷新。
8. **i18n**：FACTOR_OBJ/RISK_SOL/人机对话 QA/SRC_META/事件描述模板/订单聚合口径文案逐字入 locales。
9. **AgentCore**：风险问答 intent（risk_why/orders/plan/worst）OBO 接 DataCore，口径同 §4.6。

### 不确定性 / 待澄清（诚实标注）

- **越线分布**：§4.5③ `riskTarget` 改为 HTML hash 后，越线基地数/具体越线日**需用 HTML 同基地名实跑核对**——HTML 基于 `BASE_DATA` 12 基地名首字符码，系统改名后 hash 输入变 → 须以"改名后的种子"为准核对，不可假设与 HTML 截图逐基地相同（HTML 用基地中文名计算，改名一致即可复现）。
- **`hashN` vs `hashString`**：HTML `hashN(s,mod)`（`x=(x*31+code)%997`）与系统 `hashString` 实现须核对一致（§4.6 量化量、delay 抖动依赖）；若不同须统一为 HTML 算法，否则量化文案数字不 1:1。
- **健康降级 hp.note**：HTML 由 `DATA_HEALTH` 静态触发；系统须接 scenario（IoT 延迟）才出现，验收时确认默认态不显、注入延迟后显。
- **订单聚合 economic 系数**为 HTML"示意"值（注释「万元/套（示意）」），属①实例数据，须入种子声明口径，非业务真实定价。

> 本文与 `PRD-IND-plan-generate.md` 同为工业级深度样板；风险视图与 order-chain / dash / history 共用同一风险口径，改动须沿链路核对跨视图一致性（本体 §3）。
