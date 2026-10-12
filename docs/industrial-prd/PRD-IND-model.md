# 工业级 PRD · 型号产能推演（model / project-sim）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 数据）。**只读本文 + 像素参照 HTML 即可把"型号产能推演"补到 1:1**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`：`renderProjModel` **L3728** · `PM_STEPS` **L3631**（六步：解析需求 / 收敛可产网络 / 装载驱动因子 / 聚合求解 / 瓶颈定位 / 结论对策）· `pmCalc` **L3632** · `pmStepBody` **L3689** · `pmDagSVG` **L3655** · `MODEL_DEF` **L1542** · `PM_ADDRS` **L3592** · `pmBatches/pmUpload/pmTemplate` **L3593–3630** · 助手 `cumCapP50` **L2934** / `baseWeeklyW` **L2922** / `certFactor` **L1595** / `maintWeek` **L2929** / `curveMult` **L2930** / `healthP90` **L1603** / `baseBN/bnTight` **L2881/L2313** / `reasonNoProduce` **L2923** / `certPendingList` **L1596** / `pickModel`+`expandModelTree` **L2798/L2834**。本文已转录其全部常量/公式/字符串/交互；HTML 仅作像素核对。 |
| 落点（融入,不新建） | 前端 `apps/frontend-shell/src/views/sim/ProjectSimView.tsx`（1049 行，renderer `project-sim`）+ `apps/frontend-shell/src/views/sim/PmDag.tsx`（202 行）· 求解器 `apps/datacore/src/solvers/capacity.ts capacityForecast`（L178）· 种子 `apps/datacore/src/synthetic/battery.ts`（MODELS L24 · 产能/认证/检修参数 L53/L260）· 契约 `packages/contracts/src/solvers.ts CapacityForecastOutputSchema`（L20）· ViewDef `apps/datacore/src/synthetic/service.ts`（L1014 `driverFactors`）· i18n `apps/frontend-shell/src/locales/zh.ts sim.proj`（L375） |
| 不变量 | R14（前端零写死,型号/地址/物流/因子来自管线）· R6（同 seed 字节一致,求解器确定性）· R13（每数可溯：P50/P90/瓶颈六要素）· R-一致（周供给/P50/P90/瓶颈口径跨产能推演·S&OP·季度·订单全链同源）· 1:1=结构/数据/交互 100%,**唯色调/字体可调** |
| 诚实声明 | **本视图系统已 ~70% 到位**：`ProjectSimView` 已有六步 stepper + 型号选择 + 整单/分批 + 批次编辑器 + what-if 三滑杆 + `PmDag` 步进点亮 + 瓶颈矩阵弹窗 + 节点点穿 + 采纳→Action，`capacity_forecast` 活算确定。**本文只规定剩余 ~30% 缺口**（§4.5 逐字段标"现状→须改/须加"），不重写已对齐的数学。缺口集中在：②"可产网络收敛"显式标注 + 不可产基地清单、CSV 上传/模板、型号 chem·pos 元信息、step6 对症对策表、"开始推演"门控。 |

---

## 1. 视图概述

**一个型号即一个项目级模拟**。CEO/计划员选一个型号（如 `4680-NCM`）+ 填需求量×交付窗口（或分批交货表，可 CSV 上传）→ 系统按 **六步透明推演**，每步标明所调用的「数据 · 求解器 · 规则」，配套 **DAG 随步骤逐层点亮**：

```
① 解析需求 → ② 收敛可产网络 → ③ 装载驱动因子 → ④ 聚合求解 → ⑤ 瓶颈定位 → ⑥ 结论与对策
```

**核心叙事 = 型号驱动的可产网络收敛**：`MODEL_DEF[型号].bases` 只含部分基地（如 `4680-NCM` 仅常州/成都/合肥 3 个，非全部 12 个）——推演**只点亮相关网络，不点亮全部工厂**（HTML `pmStepBody` step2 L3705：「{型号} 只在 {bases.length}/12 个基地可产」；图谱 `expandModelTree` L2834 用扇形布局只展开可产基地、dim 其余）。求解链：`型号 → 收敛可产网络（认证产线过滤）→ 装载因子（节拍×OEE×良率 × 爬坡 × 检修 × 认证 × 数据健康度）→ 聚合 P50/P90 → 瓶颈定位 → 结论与对策（夜班/扩通道/外协≤20% C08）`。任何参数变更即重演（debounce 300ms · 竞态最后发出者胜）。

**系统只透明地摆出推导，结论可采纳为 Action。**

---

## 2. UI 规格（布局 · 像素结构）

### 2.1 整页（`renderProjModel` L3728）

```
┌ rk-top ─────────────────────────────────────────────────────────────┐
│ <h3>项目推演</h3>                                                       │
│ rk-sub: "型号产能推演：一个型号即一个项目级模拟——输入需求 → 一步一步推演    │
│   （每步标明数据·求解器·规则）→ 配套 DAG 随步骤点亮。"                      │
│ 右侧 rk-hsel: [🤖 AI 对话][⬇ 导出] [订单全链推演] [型号产能推演(on)]       │
└──────────────────────────────────────────────────────────────────────┘
[AI 对话面板(折叠) aiPanelHTML('proj')]
┌ rk-det「📝 输入需求」(副"型号 × 需求量 × 交付窗口 · 改输入即重演") ───────┐
│ [型号 chip × 6 (MODEL_DEF keys, on=当前)]  ‹8px间隔›                      │
│ [单批交付][分批交货]  [⬆ 上传表格(file)] [模板.csv] {pmUploadMsg}         │
│ 单批模式: 需求[num]万套  交期[num]周                                       │
│ pmStep===0: [开始推演 ▶]                                                 │
│ 分批模式: <table.cmp> 批次/数量/交付日期/交付地址/物流时长/净生产窗口/✕    │
│   [＋ 添加批次]  hint: "净生产窗口 = 交付日 − 该地址物流时长；每批按        │
│   「累计需求 ≤ 累计P90」校验。支持上传 CSV…列：数量 / 交付日期 / 交付地址。"│
└──────────────────────────────────────────────────────────────────────┘
pmStep>=1:
┌ rk-det「🧭 分步推演 · 第 {pmStep}/6 步：{PM_STEPS[pmStep-1]}」 ─────────┐
│   副"每步标明 调用的数据 · 求解器 · 规则"                                  │
│   [六步 tier-chip 横排, st>pmStep 的 opacity:.45]                        │
│   {pmStepBody(c)}  ← 每步一张数据表 + dl-hint                            │
│   [← 上一步]  [下一步 → / 重新输入]                                       │
└──────────────────────────────────────────────────────────────────────┘
┌ rk-det「🗺 推演 DAG」(副"随步骤逐层点亮：需求→型号→可产基地→驱动因子→     │
│   求解器→产能预测")  {pmDagSVG(c)}                                       │
└──────────────────────────────────────────────────────────────────────┘
pmStep===0 时改为: dl-hint "选择型号、填入需求与交期，点「开始推演」——系统将
  按 ⑥ 步透明推演并逐层点亮 DAG。"
```

### 2.2 型号选择器（`mChips` L3730）

- `Object.keys(MODEL_DEF).map` → 6 个 `tier-chip`，文本 = 型号 key（`4680-NCM` / `2170-NCM` / `方形-NCM` / `方形-LFP` / `圆柱-LFP` / `4680-LFP`），当前 `pmModel` 加 `.on`，点击 `pmSet('m',k)`。
- **系统现状差异**：系统型号下拉来自 `MODEL_DEF` 等价的 Model 对象（`searchObjects("Model")`），但 modelId 列表为 `4680-NCM/4680-LFP/L300-NCM/L148-LFP/P28-NCM/S192-LFP`（battery.ts L24）——**型号 key 与 HTML 不一致**（§4.5 决议：保留系统种子型号即可，1:1 要求的是"6 个型号 chip + chem·pos 元信息 + 型号驱动收敛"结构，不强求字符串逐字；但 chem·pos 元信息须补）。

### 2.3 批次编辑器（`pmMode==='batch'` L3750–3763）

`<table class="cmp">`，列：`批次 | 数量(万套) | 交付日期 | 交付地址 | 物流时长 | 净生产窗口 | ✕`。
- 数量 `<input number min=0.1 step=1>` → `pmBatchSet(i,'qty',v)`
- 交付日期 `<input date min="2026-06-15">` → `pmBatchSet(i,'date',v)`
- 交付地址 `<select>`（`Object.keys(PM_ADDRS)` 6 站点）→ `pmBatchSet(i,'addr',v)`
- 物流时长 = `PM_ADDRS[addr]` 天（只读）
- 净生产窗口 = `Math.max(1,Math.floor((dueDay(date)−logi)/7))` 周（已扣物流，只读）
- ✕ 删除（`pmBatches.length>1` 才显示）→ `pmBatchDel(i)`
- 下方：`[＋ 添加批次]` + hint。

### 2.4 六步表体（`pmStepBody` L3689）

每步一张 `<table class="cmp">` + 一条 `dl-hint`，逐字见 §4.4。**DAG 面板常显**（六层固定，随步骤点亮）见 §4.3。

---

## 3. UX 规格（交互 · 状态 · 流）

| 交互 | 触发（HTML） | 行为 |
|---|---|---|
| 选型号 | `pmSet('m',k)` L3654 | `pmModel=k; pmStep=Math.min(pmStep,1)`（已开始则退回第1步）→ 重演 |
| 改需求量 | `pmSet('q',v)` | `pmQty=Math.max(0.1,+v||40)` → 重演 |
| 改交期 | `pmSet('w',v)` | `pmWeeks=Math.max(1,Math.min(52,+v||6))` → 重演 |
| 切单批/分批 | `pmModeSet(m)` L3597 | `pmMode=m; pmStep=Math.min(pmStep,1)` → 重演 |
| 开始推演 | `pmGo(1)`（仅 pmStep===0 显示） | 进入第 1 步，分步面板 + DAG 出现 |
| 步骤 chip | `pmGo(i)`（仅 `pmStep>=1` 可点） | `pmStep=clamp(0..6,i)` → 重渲染该步表 + DAG 点亮到 i |
| 上一步/下一步 | `pmGo(pmStep±1)` | 步进；末步按钮变「重新输入」`pmGo(0)` |
| 添加批次 | `pmBatchAdd()` L3594 | push `{qty:10,date:'2026-08-21',addr:'华中 · 武汉'}` |
| 删批次 | `pmBatchDel(i)` | splice（保底 1 行） |
| 改批次字段 | `pmBatchSet(i,k,v)` | qty `max(0.1,+v||1)`；date/addr 直接写 |
| 上传 CSV | `pmUpload(event)` L3618 | FileReader 读 utf-8 → `parseBatchTable` → 成功则 `pmBatches=rows; pmMode='batch'; pmStep=min(pmStep,1)`，`pmUploadMsg='✓ 已导入 N 批…'`；失败 `pmUploadMsg='⚠ 未识别…'` |
| 下载模板 | `pmTemplate()` L3626 | 生成 `分批交货模板.csv`（BOM + 3 列 + 3 示例行）下载 |
| 在图谱查看可产网络 | step2 dl-hint `setView('model');pickModel(m)` L3705 | 跳图谱视图并 `pickModel` → `expandModelTree` 扇形展开可产基地、dim 其余、瓶颈节点闪烁 |
| 主瓶颈高亮 | step5 行 `r.b===c.mainBn.b` L3714 | 该行底色 `rgba(214,83,107,.05)` + `◉ 主瓶颈` |
| P50/P90 溯源 | step6 `provSpan` L3722 | 悬停浮层：值 + 来源 + formula + inputs + rule（六要素） |
| AI 对话 | `aiBar('proj')`/`aiToggle('proj')` | 展开预设 QA（§4.6） |
| 导出 | `exportPage('proj')` | 导出当前页 |
| **状态:pmStep===0** | 初始 | 仅显示输入区 + "开始推演 ▶" + 引导 hint；无分步/DAG |
| **状态:认证中** | `certFactor<1` | step2/3 标 "B线认证中 · 产能按 60% 计"；DAG 基地节点副标 "· B线认证中" |
| **状态:数据健康度降级** | `healthP90().f===0.90` | step3/6 显降级说明；P90 系数 0.93→0.90 |
| **状态:分批越线** | `!c.ok` 分批 | step6 结论 "✗ 有批次越线 · 最大缺口 X"；越线批次行红 "✗ 缺 X" |

> 系统已实现：型号/数量/交期/单批分批/步进/批次增删改/瓶颈矩阵弹窗/节点点穿/P50P90 溯源/采纳。**未实现（须补，§8）**：CSV 上传 + 模板下载、"开始推演" 门控（系统直接展示六步）、step2 不可产基地清单 + "图谱查看可产网络"跳转、型号 chem·pos 元信息、step6 对症对策表。

---

## 4. 数据规格（值 + 来源 + 系统字段级落地）

> 前端**零写死**(R14)。每个数据分五类落地：①Model 实例 → 合成种子物化 ②阈值 → config/种子参数 ③公式 `capacity_forecast` → 求解器 ④文案 → i18n ⑤结构（DAG 六层/六步）→ ViewDef。

### 4.1 型号定义 `MODEL_DEF`（①种子 · Model 对象 + `model_producible_at` 边）

HTML L1542（逐字）：

| key | chem | pos | bases（可产基地） |
|---|---|---|---|
| 4680-NCM | NCM | 动力 | 常州基地·总部, 成都基地, 合肥基地 |
| 2170-NCM | NCM | 动力 | 厦门基地, 武汉基地, 自贡基地 |
| 方形-NCM | NCM | 动力 | 常州基地·总部, 成都基地 |
| 方形-LFP | LFP | 储能 | 江门基地, 眉山基地, 邯郸基地, 枣庄基地 |
| 圆柱-LFP | LFP | 储能 | 信阳基地, 洛阳基地 |
| 4680-LFP | LFP | 动力+储能 | 常州基地·总部, 枣庄基地 |

- **系统映射**：`battery.ts` MODELS（L24）已有 6 型号 + 每型号 `bases` 子集（`generateModels` L981 `bases: shuffled.slice(0,n)`）+ `model_producible_at` 边（L500）；`certByModel`（capacity.ts）只让**已认证基地**进入预测——**收敛已天然实现**。`chem/pos` 须补到 Model props（§4.5）。

### 4.2 交付地址 → 物流时长 `PM_ADDRS`（②config · `simConfig.logistics`）

HTML L3592（逐字）：`{'华东 · 上海':2,'华南 · 深圳':3,'华中 · 武汉':2,'华北 · 北京':3,'西南 · 成都':2,'海外 · 欧洲（海运）':35}`。
- **系统现状**：`ProjectSimView` `DEFAULT_LOGISTICS={上海:3,广州:5,北京:4,成都:6,海外:14}`（L28，电池兜底），优先 `simConfig.logistics`。**1:1 须把 6 站点 + 物流天数对齐 HTML**（含"海外 · 欧洲（海运）":35 这种大物流时长——决定净生产窗口收窄的关键演示）。求解器 `logisticsDays(p,address)`（capacity.ts）已按地址取参数。

### 4.3 默认分批 `pmBatches` + CSV（①种子默认 · ②模板）

HTML L3593：`[{qty:15,date:'2026-07-10',addr:'华东 · 上海'},{qty:25,date:'2026-08-07',addr:'华南 · 深圳'}]`。
- 添加批次默认 L3594：`{qty:10,date:'2026-08-21',addr:'华中 · 武汉'}`。
- **CSV 模板** `pmTemplate` L3627（逐字，含 `﻿` BOM）：
  ```
  数量(万套),交付日期,交付地址
  15,2026-07-10,华东 · 上海
  25,2026-08-07,华南 · 深圳
  10,2026-09-04,海外 · 欧洲（海运）
  ```
  文件名 `分批交货模板.csv`。
- **CSV 解析** `parseBatchTable` L3604：分隔符自动识别（`\t`/`，`/`,`）；表头识别（含"数量|qty|日期|date|地址|addr"）→ 映射列序，否则默认 `q=0,d=1,a=2`；日期归一 `pmNormDate`（`./年月日`→`-`，补零）；地址模糊匹配 `pmMatchAddr`（精确 → 包含 → 站点后半段）；`qty>0 && date && addr` 才入，否则 skip 计数。

### 4.4 六步表体（③求解器口径 + ④文案，逐字 `pmStepBody` L3689）

**① 解析需求**（L3691）
- 单批：`<table>` 字段/值/来源 → `型号 {m}（{chem} · {pos}）｜产品域 · PLM` / `需求量 {qty} 万套｜用户输入 → 结构化预测场景对象` / `交付窗口 {weeks} 周（至 {dateOf(weeks*7)}）｜规则 C10 校验场景字段完整性 ✓` / `候选对策 加夜班 / 扩化成通道 / 外协｜方案库（按约束因素对症）`。
- 分批：表 批次/数量/交付日/交付地址/物流时长/净生产窗口 + 合计行 "规则 C10 校验场景字段完整性 ✓ · 物流时长来自 物料/物流域（按地址）"。
- hint：「意图解析Agent 将需求映射为结构化预测场景{分批：（分批：每批净窗口=交付日−物流时长）}；下一步由检索Agent 按「型号→可产基地→产线→工序」收敛子图。」

**② 收敛可产网络**（L3701）★1:1 关键缺口
- 表 基地/可产/说明：`c.bases` 逐行 "✓ 可产"，说明 = 认证中则 "B线认证中 · 产能按 60% 计"，否则 "产线已认证量产"。
- **再列 `c.noB`（不可产基地，前 4 个）**：`opacity:.55`，"✗"，说明 = `reasonNoProduce(m,b)`（L2923）：
  - NCM 型号 + 储能基地 → "化学体系不兼容：该基地仅储能(LFP)产线，无三元/动力产线"
  - LFP 型号 + 动力基地 → "化学体系不兼容：该基地仅动力(NCM)产线，无 LFP/储能产线"
  - 其余 → "未布产该型号：产线兼容但尚未认证/导入该型号工艺"
  - `noB.length>4` 时追加 "…另 N 个基地不可产（同类原因）"。
- hint（★显式收敛标注）：「{m} 只在 **{bases.length}/12** 个基地可产——推演只点亮相关网络，不点亮全部工厂。**在图谱中查看可产网络 ↗**（`setView('model');pickModel(m)`）」。

**③ 装载驱动因子**（L3706）
- 表 可产基地/周产能(万套)/认证系数/检修窗/瓶颈候选：`周产能=fmt(baseWeeklyW(b)*certFactor)`；`认证系数` 认证中显 "0.6（B线认证中）" 否则 "1.0"；`检修窗 第 {maintWeek(b)} 周（×0.72）`；`瓶颈候选 = baseBN(b).factor`。
- hint：「驱动因子带来源系统与时序：节拍×OEE（IoT/MES）· 良率（QMS）· 爬坡曲线 前4周 0.88→1.0 · 认证系数（PLM）。{healthP90().note}」。

**④ 聚合求解**（L3709）
- 表 基地 / `{weeks}周累计 P50{分批：（最晚批净窗口）}` / 口径：每基地 `cumCapP50([b],weeks,m)`，口径 "Σ周 周产能×爬坡×检修×认证"；合计行 "P90 = ×{hp.f} → {p90}"，口径 "聚合求解器 · 规则 C01/C02"。
- hint：「聚合求解器按「设备→工序(串 min/并 Σ)→产线→工厂→基地」逐级核算，每级可下钻到公式与输入因子。」

**⑤ 瓶颈定位**（L3713）
- 表 基地 / 主约束因素 / 紧张度(0-100)：行 = `baseBN(b).factor` + `bnTight(b,factor)`；紧张度色 `≥85 红 #DD7E9E / ≥70 黄 #E8B54A / 否则绿 quality`；主瓶颈行（`mainBn` = 紧张度最大）底色 `rgba(214,83,107,.05)` + `◉ 主瓶颈`。
- hint：「瓶颈求解器按工艺链最小割定位；约束不只看工序——人力/物料齐套/物流时长同列入多维矩阵（规则 C05：利用率>95% 持续 3 日升级告警）。」

**⑥ 结论与对策**（L3716）
- 分批：先一张批次表（批次/数量/交付日·地址/净窗口/累计需求/累计P90/结论），结论 "✓ 按期" / "✗ 缺 {gap}"。
- 结论框 `aud-verdict`（边色 `ok?#62BE77:#DD7E9E`）：
  - 单批 OK：`✓ 可按 {weeks} 周交付（P90 口径）`；分批 OK：`✓ 全部批次可按期交付（P90 口径，已扣物流时长）`。
  - 单批缺口：`✗ P90 缺口 {gap} 万套`；分批越线：`✗ 有批次越线 · 最大缺口 {gap} 万套`。
  - 副行："需求 {qty} · P50 {provSpan} · P90 {provSpan}（×{hp.f}）· 主瓶颈 {base}「{factor}」紧张度 {tight}{认证中追加}"。
- **不达标时对症对策表** `acts`（L3716，逐字）：
  | 对症对策 | 效果（场景求解器口径） |
  |---|---|
  | 加 2 夜班 | +12% 产能 · 当周见效 · 低成本 |
  | 扩化成通道 | +20% · 直击主瓶颈 · 含 2 周爬坡 |
  | 部分外协 | +15% · 受 C08 ≤20% 约束 |
- 达标时 hint："✓ 产能可满足，建议按各基地产能占比分配排产；解释校验Agent 已按 C01–C12 校验留痕。"
- 末 hint：「完整 what-if 调参（夜班/扩通道/外协滑杆）与 Action 写回工单可 **在图谱视图继续 ↗**（同一套数学，结果一致）。」

> **系统映射**：系统 step6 直接给 what-if 三滑杆 + A/B 对比 + 采纳（ProjectSimView L673–807），**比 HTML 更进一步**（HTML 这里只给静态对策表，把滑杆放在图谱视图）。1:1 决议：**保留系统滑杆**（这是增量 §7.13 的合理收口），但须**补 HTML 的静态对症对策表**（acts 三行，缺口时显示，作为"按约束因素对症"的方案库展示，与滑杆并存）。

### 4.4 求解器公式（③`capacityForecast` capacity.ts L178，确定性 R6，已对齐）

| 量 | 公式 | HTML 出处 | 系统出处 |
|---|---|---|---|
| 周产能 | `baseWeeklyW(b)=baseDailyReal(b)*7/(SET_CELLS*10000)`，`SET_CELLS=100` | L2922 | `computeRollup` weeklyWan |
| 认证系数 | 认证中 0.6 / 量产 1.0 | `certFactor` L1595 | `p.certFactors{量产:1.0,认证中:0.6}` battery.ts L53 |
| 爬坡曲线 | `w≤4: 0.88+0.03(w−1); w≥5: 1.0` | `curveMult` L2930 | `p.ramp{base:0.88,step:0.03,fullWeek:5}` L54 |
| 检修窗 | `maintWeek(b)=(charCode+len*3)%8+3`（第3~10周）× 0.72 | L2929 | `maintWeekOf(c,baseId)` × `p.maintMult` |
| P50 | `Σ可产基地 Σ周(周产能×认证×curveMult)` | `cumCapP50` L2934 | capacity.ts L226–233 |
| 健康度系数 | IoT/SCADA 延迟→0.90，否则 0.93 | `healthP90` L1603 | `p.health{normal,degraded,staleHours}` |
| P90 | `P50 × healthFactor` | L3645 | L253 |
| 缺口/可达 | 单批 `gap=qty−p90, ok=gap≤0`；分批 每批 `累计需求 ≤ 累计P90`，`gap=max(...批gap)` | L3646–3648 | L256–274 |
| 净生产窗口 | `Math.max(1,Math.floor((dueDay(date)−logi)/7))` | L3638 | `logisticsDays` + L207 |
| 紧张度 | `bnTight(b,f)`：主因 `min(97,88+seed%9)`；非主 `min(83,55+seed+util偏移)` | L2313 | `mockTightness(c,baseId,bn)` risk.ts |
| 主瓶颈 | 紧张度最大的基地×因素 | L3651 | L235–240 `mainBn` |
| what-if | `min(基线P50×(1+0.06×夜班+0.05×通道)+qty×外协%, 物理上限)` | `wfAdjusted` L2924 | capacity.ts L290–310（外协≥20% C08 红线） |

### 4.5 ★系统字段级落地（现状 → 须改/须加,精确）

> **现状盘点（已对齐，勿动）**：六步 stepper（i18n `steps` L388：① 场景解析/② 可产基地收敛/③ 驱动因子装载/④ 逐级聚合 P50/⑤ 瓶颈定位/⑥ 结论与对策）✓ · 型号选择（Model 对象/simConfig/兜底三级 L71-75）✓ · 整单/分批 + 批次增删改 + 物流时长（L222-287）✓ · `capacity_forecast` 活算 debounce 300ms（L99-108）✓ · 六步表（step1-6 StepBody L401-809）✓ · `PmDag` 六层步进点亮 + 缩放/平移/节点点穿（PmDag.tsx）✓ · 瓶颈矩阵弹窗 bottleneck_matrix（L340-383）✓ · P50/P90 六要素溯源 Provenance（L684-706）✓ · what-if 三滑杆 + C08≥20% 提示 + A/B 对比 + 采纳→Action（L714-806）✓ · ViewDef `driverFactors`（service.ts L1014）✓。

**缺口 1 · ② 收敛可产网络的"显式收敛标注 + 不可产基地清单"**（最高优先 · 1:1 核心叙事）
- 现状：`StepBody` step2（L515-553）只列 `out.perBaseRows`（可产基地，求解器已按 `certByModel` 过滤），**无不可产基地、无 "N/12 收敛" 注解、无图谱跳转**。
- 须加（前端 ProjectSimView step2）：
  - 注解行（i18n ④）："{modelId} 只在 **{producibleCount}/{totalBases}** 个基地可产——推演只点亮相关网络，不点亮全部工厂。"
  - 不可产基地清单（前 4 + 折叠）：`opacity:.55`、"✗"、`reasonNoProduce` 文案。
  - **求解器须输出 `nonProducible`**：`capacityForecast` 加 `nonProducible: [{base, reason}]`（reason 三档同 `reasonNoProduce`，由 `chem`(Model.props) × `kind`(Base.props) 判定）+ `totalBases`、`producibleCount`。
  - 契约：`CapacityForecastOutputSchema` 加 `nonProducible: z.array(z.object({base:z.string(),reason:z.string()})).optional()` + `totalBases: z.number().optional()` + `producibleCount: z.number().optional()`。
  - 图谱跳转："在图谱中查看可产网络 ↗" → 切 graph 视图 + 选中型号（写 `selectedObjects`，`pickModel` 等价）。graph 视图须能按 `model_producible_at` 收敛布局（若 graph 视图已有则复用，否则记为依赖项）。

**缺口 2 · CSV 上传 + 模板下载**（HTML L3742-3743 / L3618-3630）
- 现状：批次编辑器**无** "⬆ 上传表格" / "模板.csv" / `pmUploadMsg`。
- 须加（前端，纯客户端，无后端）：
  - `<label>⬆ 上传表格<input type=file accept=".csv,.txt,.tsv" hidden></label>` → `onChange` 读 utf-8 → `parseBatchTable`（移植 L3604 逻辑：分隔符识别/表头映射/`pmNormDate`/`pmMatchAddr`/skip 计数）→ 成功 setBatches + setMode('batch') + 提示 "✓ 已导入 N 批（{name}）{· 跳过 M 行无效数据}"；失败提示 "⚠ 未识别到有效批次行（需列：数量 / 交付日期 / 交付地址，地址须在 6 个站点内）"。
  - "模板.csv" 按钮 → Blob 下载 `分批交货模板.csv`（含 `﻿` BOM + 3 列 + 3 示例行，逐字 §4.3）。
  - i18n ④：`uploadTable:"⬆ 上传表格"` / `template:"模板.csv"` / `uploadOk:(n,name,skip)=>…` / `uploadFail:"⚠ 未识别…"`。
  - 地址站点须与 `simConfig.addresses` 对齐（6 站点含海外·欧洲（海运）35 天）。

**缺口 3 · 型号 chem·pos 元信息**（HTML step1 "型号 {m}（{chem} · {pos}）" L3696 · DAG mdl 节点 "{chem} · {pos} · 型号对象" L3662）
- 现状：Model 对象无 `chem`/`pos` props；step1 来源列写死 "产品域 · PLM"；DAG mdl 节点 sub 写死 "型号对象（产品域 · PLM）"（ProjectSimView L840）。
- 须加：
  - 种子 `battery.ts` MODELS 加 `chem`("NCM"|"LFP") + `pos`("动力"|"储能"|"动力+储能") 字段 + `modelProps`（service.ts L295）加 `chem`/`pos` 属性。
  - step1 单批型号行值显 `{modelId}（{chem} · {pos}）`；DAG `buildDag` mdl 节点 sub = `{chem} · {pos} · 型号对象`（取 Model 对象 props，R14 不写死）。

**缺口 4 · step6 对症对策表**（HTML acts L3716）
- 现状：系统 step6 只给 what-if 滑杆，**无静态对症对策表**。
- 须加：缺口时（`!out.ok`）在结论框下显 3 行表（加 2 夜班 +12%·当周见效·低成本 / 扩化成通道 +20%·直击主瓶颈·含 2 周爬坡 / 部分外协 +15%·受 C08 ≤20% 约束）。文案 i18n ④；与 what-if 滑杆并存（滑杆=可交互调参，表=方案库展示）。可由求解器输出 `remedies:[{name,effect}]`（按主瓶颈类型对症），或前端从 i18n 取定值（系数 12/20/15% 入 config）。

**缺口 5 · "开始推演" 门控（pmStep===0 初始态）**
- 现状：系统初始即 `step=1`（ProjectSimView L88 `useState(1)`），直接展示六步——**缺 HTML 的"先选型号填需求 → 点开始推演"门控**。
- 决议（1:1 但允许收口）：补可选门控——初始 `step=0` 时输入区显 "开始推演 ▶"（`pmGo(1)` 等价），分步面板/DAG 显引导 hint "选择型号、填入需求与交期，点「开始推演」…"。若团队判定"直接展示"体验更好，可保留现状但须在验收记差异（HONEST：此为唯一"结构性"可商榷点，其余须 1:1）。

**缺口 6 · 顶部双子模式 tab + AI/导出 + 标题/副标题**
- HTML 顶部：`[🤖 AI 对话][⬇ 导出] [订单全链推演] [型号产能推演(on)]`，标题"项目推演"、副标题型号产能叙事。
- 现状：系统标题/副标题在 zh.sim.proj（L376/L159），**无子模式 tab（订单全链/型号产能）切换、无 AI/导出条**。订单全链是另一视图（OrderChainView，见 `PRD-order-project-sim-1to1.md`）——本 PRD 只管型号产能面；子模式 tab 作为两视图的汇合入口，记为**跨视图依赖**（与 order PRD 协调），本视图须保留"型号产能推演"为当前态标识。

### 4.6 数据资产（完整,作种子/i18n/config）

- **`PM_ADDRS`**（②config `simConfig.logistics`）：6 站点物流天数，逐字 §4.2。
- **`MODEL_DEF`**（①种子）：6 型号 chem/pos/bases，逐字 §4.1。
- **认证边**（①种子 `model_certified_on`/`certByModel`）：约 3 成 B 线"认证中"→0.6（`certOf` L1588 `isB&&h>=7`）；系统 certLinks（battery.ts L934）已等价。
- **数据健康度**（②config + ③求解器）：`DATA_HEALTH['IoT/SCADA']` 延迟 4.2h → P90 系数 0.93→0.90（L1601/L193）。
- **检修周**（③求解器）：`maintWeek(b)` 第 3~10 周 × 0.72。
- **what-if 系数**（②config）：夜班 +0.06/班、通道 +0.05/条、外协 +qty×% ≤20%（C08）。
- **对症对策**（④i18n + ②config）：12%/20%/15%（§4.4 ⑥）。
- **AI QA**（④i18n）：4 预设（本月最大风险 / 影响收入最大 / 毛利为何低于预算 / 现在该做什么决策），答案取实时 `pmCalc` 数据（HTML aiPanelHTML）。系统现无 proj 页 AI——记为可选增量（与 plan-generate AI QA 同源实现）。

---

## 5. 契约 / 端点

- `packages/contracts/src/solvers.ts CapacityForecastOutputSchema`（L20）：
  - 加 `nonProducible: z.array(z.object({ base: z.string(), reason: z.string() })).optional()`
  - 加 `producibleCount: z.number().optional()` · `totalBases: z.number().optional()`
  - （可选）加 `remedies: z.array(z.object({ name: z.string(), effect: z.string() })).optional()`
  - 既有 `perBaseRows / batchRows / mainBn / pendingCertList / degradeNote / healthFactor / p50 / p90 / gap / ok` 不变。
- `Model` 对象 props（service.ts `modelProps` L295 + 种子 L981）：加 `chem` / `pos`。
- 端点：`POST /a/v1/solvers/capacity_forecast/invoke`（`useLiveSolver` debounce 重算，已在）· `POST /a/v1/solvers/bottleneck_matrix/invoke`（瓶颈矩阵弹窗，已在）· `POST /a/v1/action-drafts`（采纳产能保障方案，已在 `useActionDraft`）。
- ViewDef `service.ts` L1014：`{ renderer:"project-sim", layout:{ solverKey:"capacity_forecast", driverFactors } }` 不变；（可选）加 `layout.remedyCoeffs`（夜班/通道/外协系数）+ `layout.models`（chem/pos 元信息若不入 Model props 则入此）。

---

## 6. 融合集成点（5 处,不绕过）

1. Renderer：`registry.ts` L46 `registerRenderer("project-sim", …)`——复用 `ProjectSimView`，增强不重建。
2. ViewDef：`service.ts` L1014 `project-sim` layout——`driverFactors` 已在；按 §4.5 补 chem/pos / remedy 系数。
3. Feature：`features.ts` L21 `view.project-sim`（绑 `capacity_forecast` + `capacity_*` intents）+ L32 `view.project-sim.whatif`——已在。
4. 导航：ShellLayout 推演组（`project → project-sim` registry.ts L30）。子模式 tab（订单全链/型号产能）与 order 视图汇合点——跨视图协调（`PRD-order-project-sim-1to1.md`）。
5. 求解器：`capacity.ts capacityForecast`——补 `nonProducible/producibleCount/totalBases/remedies`，**不改既有 P50/P90/瓶颈/批次数学**（R6）。

---

## 7. 验收（DoD = 真 1:1）

- **像素核对**：与 HTML "型号产能推演" 并排，逐元素勾——6 型号 chip / 单批·分批切换 / **CSV 上传 + 模板下载** / 批次编辑器(物流时长·净窗口) / 六步 stepper(step>pmStep 半透) / **②不可产基地清单 + "N/12 收敛"注解 + 图谱跳转** / ③驱动因子表(认证系数·检修窗) / ④聚合(P50→P90×系数) / ⑤瓶颈表(◉ 主瓶颈高亮) / ⑥结论框 + **对症对策表** + what-if / DAG 六层随步骤点亮 + "本步"角标 + 认证中副标 / P50P90 溯源浮层 / 采纳→Action。结构/值/字符串/交互全一致（色/字可不同）。
- **型号驱动收敛**（核心）：选 `4680-NCM` → 只点亮 3 个基地（常州/成都/合肥），其余 9 个列入"不可产"含 `reasonNoProduce` 文案；切 `方形-LFP` → 4 个储能基地点亮，NCM 基地标"化学体系不兼容"。FDE 亲手切型号验。
- **交互**：改型号/数量/交期实时重演 · 单批↔分批 · CSV 上传成功/失败提示 · 模板下载得正确 CSV · 步进 + chip 跳步 + "开始推演"门控 · 瓶颈矩阵弹窗 · 节点点穿抽屉 · what-if 三滑杆(外协≥20% C08 提示) · 采纳出 Action——逐项 FDE 亲手跑（走 `fde-delivery` 纪律，绿测试≠能用）。
- **数据**：前端零写死（`debattery:check`：型号/地址/物流/chem/pos/对策系数均来自管线）· 种子值=HTML 精确（MODEL_DEF/PM_ADDRS/认证比例/检修周/健康度）· 同 seed 字节一致（R6）· P50/P90/瓶颈每数可溯（R13）· P50/P90/净窗口公式与 HTML 同值。
- `pnpm -r build && pnpm -r test` 全绿（datacore 69 / agentcore 66 / frontend 25+ 不回退）· `chain:check` / `ontology:check` 过。
- 回写本体 §2（capacity_forecast 扩 nonProducible/producibleCount + Model.chem/pos + `model_producible_at` 收敛叙事）。

---

## 8. 实施任务（研发可直接拆）

1. **种子**（battery.ts）：MODELS 加 `chem`/`pos`；确认每型号 `bases` 子集与"NCM↔动力 / LFP↔储能"语义一致（使 `reasonNoProduce` 三档可判）；`simConfig.logistics`/`addresses` 对齐 PM_ADDRS 6 站点（含海外·欧洲（海运）35）。
2. **契约**（solvers.ts）：`CapacityForecastOutputSchema` 加 `nonProducible`/`producibleCount`/`totalBases`/（可选）`remedies`。
3. **求解器**（capacity.ts `capacityForecast`）：输出 `nonProducible`（按 Model.chem × Base.kind 判 reason）+ `producibleCount`/`totalBases`；（可选）按主瓶颈类型生成 `remedies`。**不改 P50/P90/批次/瓶颈数学。**
4. **ViewDef/props**（service.ts）：`modelProps` 加 chem/pos；（可选）layout 加 remedy 系数 / models 元信息。
5. **前端 ProjectSimView**：
   - step2：补"N/12 收敛"注解 + 不可产基地清单（reason）+ "图谱查看可产网络 ↗"跳转。
   - 批次区：补 CSV 上传（移植 parseBatchTable/pmNormDate/pmMatchAddr）+ 模板下载（Blob + BOM）+ uploadMsg。
   - step1 + DAG mdl 节点：显 chem·pos（取 Model props，去写死）。
   - step6：缺口时补对症对策表（与 what-if 滑杆并存）。
   - （可选）初始 step=0 + "开始推演 ▶" 门控 + 引导 hint。
6. **i18n**（zh.ts sim.proj）：加 `uploadTable/template/uploadOk/uploadFail`、收敛注解模板、不可产 reason 三档、对症对策 3 行、（可选）"开始推演"/引导文案。型号 chem/pos 取数据非 i18n。
7. **回归 + FDE**：project-sim testid 回归不回退；FDE 亲手跑六步 + 切型号验收敛 + CSV 导入 + 缺口对策（`fde-delivery` skill）。

> **诚实结论**：型号产能推演面**系统已 ~70% 完成且数学已 1:1**（P50/P90/瓶颈/批次/曲线全对齐）。剩余 ~30% 是**叙事性 UI 缺口**（可产网络显式收敛、CSV、chem/pos、对策表、门控），非数学缺口——工作量集中在前端 + 求解器输出字段 + 种子元信息，**无须重写 capacity_forecast 核心**。配套 order（订单全链）面是更大缺口，见 `PRD-order-project-sim-1to1.md`。
