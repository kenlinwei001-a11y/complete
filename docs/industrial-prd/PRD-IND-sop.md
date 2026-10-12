# 工业级 PRD · 月度 S&OP 平衡台（sop · renderer `sop-balance`）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 数据）。**只读本文 + 像素参照 HTML 即可 1:1 实现**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`：种子 `SOP_MONTH/SOP_SEG/SOP_SUPPLY/SOP_MAT/SOP_FIN/SOP_VERS` **L4992-5019** · `buildSOP` **L5026** · 五步 `sopStep1` **L5051** / `sopStep2` **L5060** / `sopStep3` **L5072** / `sopStep4` **L5088** / `sopStep5` **L5096** · `sopFinalize` **L5113** · 步导航 `sopGo`/`sopSec` L5045-5050。本文已把全部常量/公式/字符串/交互转录,研发以本文为准、HTML 仅作像素核对。 |
| 落点（融入,不新建） | 前端 `apps/frontend-shell/src/views/sim/SopBalanceView.tsx`（737 行,renderer `sop-balance`,五步状态机 DRAFT→IN_REVIEW→EXEC_MEETING→FINAL **已成熟**）· 后端 `apps/datacore/src/sop.ts`（`SopService.step1..step5`/`finalize`/`advance`）· 种子 `apps/datacore/src/synthetic/battery.ts`（segments L1122-1126 · solverParams.sop L244 · planTarget 域 L1162+）· 契约 `packages/contracts/src/solvers.ts`（`SopVersionStatusSchema` L165）· 工作区配置 `packages/contracts/src/workspace.ts` + 前端 `apps/frontend-shell/src/api/types.ts` `sopConfig` L71-82 |
| 不变量 | R14（前端零写死,值来自管线/config/i18n/ViewDef）· R6（同 (industry,scale,seed) 字节一致）· R13（每数可溯,六卡 + 每表走 `<Provenance>`）· R4（**定稿才写真相**,Action EXECUTED→FINAL）· R-一致（产能口径/三线/财务口径跨视图同源 C02）· 1:1=结构/数据/交互 100%,**唯色调/字体可调** |
| 与结构 PRD 关系 | 本文**取代并细化** `docs/PRD-sop-balance-1to1.md`（其已做完缺口分析:缺 ②滚动P90列 / ③物料线MRP表 / ④量价本利科目表 / ⑤版本演进对比表）。本文把那 4 张表 + 全部精确常量转录到字段级。 |

> 一句话：系统 `SopBalanceView` 的**骨架已是 HTML 的超集**——它把 HTML 的"静态五步演示"升级为「**版本状态机 + C22 锁定 + 逐步走求解器 + 六卡 `<Provenance>` 溯源 + 定稿走 Action 审批**」。1:1 缺口是 **HTML 有、系统缺的四张明细表**:② 缺"滚动 P90"列 · ③ 缺"物料线 MRP 净需求表" · ④ 缺"量·价·本·利 科目表" · ⑤ 缺"版本演进对比表"。补这四表 + 把 HTML 精确种子值注入生成器(R14/R6),即 100% 1:1。**绝不退化系统超集。**

---

## 1. 视图概述
月度 S&OP 平衡台以**五步法**收敛单月度计划:**①产品评审**(可产矩阵=型号×产线认证边变化,定供应可行域边界)→**②需求评审**(三线对照 目标/滚动P50/滚动P90/上月实际,偏差>±10%触发 C21 自动进议程)→**③供应评审**(两条线并行:产能线=逐基地月聚合∥物料线=MRP 净需求)→**④财务整合**(量·价·本·利对预算,C15 毛利线/C18 现金垫校验,不过则阻断⑤)→**⑤高管决策会**(议程自动汇集 ②C21+③缺口+④越线 → 决议增量即时重算供给/缺口 → 版本演进对比 → 定稿走 Action,C22 锁定)。计划对象=**型号族×基地**;顶部六卡 KPI 实时呈现需求/供给/缺口/收入达成/毛利率/现金垫。**系统摆数据与命比、推议程,定稿由经营决策会拍板。**

## 2. UI 规格（布局 · 像素结构）
### 2.1 整页（`buildSOP` L5026 · 系统 `SopBalanceView`）
```
┌ rk-top ────────────────────────────────────────────────┐
│ <h3>S&OP 月度平衡台 · {SOP_MONTH}</h3>                    │
│ rk-sub: "五步法：产品→需求→供应→财务→高管决策会 · 计划对象 │
│   =型号族×基地 · 当前版本 V{n} 评审中/已定稿·C22 锁定"     │
│ rk-hsel: 5×tier-chip ①产品评审 ②需求评审 ③供应评审       │
│          ④财务整合 ⑤高管决策会（当前 .on,点击 sopGo(i)）  │
└─────────────────────────────────────────────────────────┘
┌ rk-kpi 六卡 ────────────────────────────────────────────┐
│ 需求P50(万套) │ 可供给(万套) │ 产销缺口(>2红) │ 收入预算  │
│   达成% │ 毛利率(预算X%) │ 现金安全垫 C18(达标)            │
└─────────────────────────────────────────────────────────┘
[左:版本列表 panel(新建+逐版本徽章) │ 右:#sopBody 当前步内容]
```
- 系统在 HTML 单栏基础上**多一左栏版本列表**(`styles.sopGrid`,`SopBalanceView.tsx:89`):新建版本输入(月份 YYYY-MM)+ 逐版本行(月份 mono + `待审批`徽章 + 状态徽章 DRAFT/IN_REVIEW/EXEC_MEETING/FINAL)。HTML 无此栏(单版本演示)——**保留系统超集**。
- 顶部右徽章 `styles.verBadge`(`:199`):未定稿=`V{n} 评审中`(紫),定稿=`🔒 V{n} 已定稿·C22 锁定`。HTML 同义文案在 rk-sub 内(`<b style=color:#B07FD8>` L5031)。

### 2.2 六卡 KPI 条（`rk-kpi` L5033-5040 · 系统 `SopKpiBar` `:268`）
| # | 卡 | 值/公式 | 色规则(HTML) | 溯源(系统 `<Provenance>`) |
|---|---|---|---|---|
| 1 | 需求 P50(万套) | `dem=Σ SOP_SEG.p50`,`toFixed(0)` | `#7E8BEE` 定 | rule C21 · note "任一细分\|滚动 vs 目标\|>10%→C21" |
| 2 | 可供给(万套) | `sup`,`toFixed(1)` | `#C470B8` 定 | source ③+⑤ · note "⑤决议编辑即时重算(display),落库走第⑤步" |
| 3 | 产销缺口(万套) | `gap=dem−sup`,`toFixed(1)` | `>2 → #DD7E9E红` / 否则 `var(--forecast)` | note "缺口>2万套→红标,自动进⑤议程" |
| 4 | 收入预算达成 | `rev.roll/rev.bud*100`,`toFixed(0)%` | `var(--quality)` 定 | source ④ · inputs 收入预算 |
| 5 | 毛利率(预算 X%) | `gmRoll=gm.roll/rev.roll*100`,`toFixed(1)%`;label 含 `预算 ${gmBud.toFixed(1)}%` | `gmRoll<gmBud → #E8B54A黄` / 否则 `var(--quality)` | rule C15 · 容差 0.5pp |
| 6 | 现金安全垫 C18 | 文案 `达标`(HTML 静态) / 系统 `{cash}亿 ✓/✗` | `var(--capacity)` | rule C18 · 底线 50 亿 |
- HTML L5028-5029:`rev=SOP_FIN[0]`(收入),`gm=SOP_FIN[2]`(毛利),`gmRoll=gm.roll/rev.roll*100`,`gmBud=gm.bud/rev.bud*100`。
- 系统第 6 卡已升级为 `{cashCushion}亿 ✓/✗`(取 s4),优于 HTML 静态"达标"——**保留**。

### 2.3 五步面板（`#sopBody`,`sopGo(i)` 切换 → `sopSec(title,sub,inner)` 包裹 L5050）
每步 `rk-det` 块:头 `rk-det-h`(`<b>{title}</b><span>{sub}</span>`)+ 内容表。系统对应 `Step1..Step5`(`:363/:417/:538/:594/:652`),`styles.stepper` chips。逐步 UI:

**① 产品评审 · 可产矩阵变化**(`sopStep1` L5051 · `Step1` `:363`)
- 头 sub:`输入：型号×产线认证关系（边属性）+ 新品/退役计划`
- 表 `cmp` 5 列「变化 / 型号×产线 / 状态 / 对 {SOP_MONTH} 供给影响 / 来源」,3 行(见 §4.2)
- 底 `dl-hint`:`产品评审先行：可产矩阵是供应评审的边界条件——认证关系（边属性）变化直接改变 ②③ 的可行域。`
- 系统现 `Step1` 通用 `s1.changes` + 合计行"供给可行域边界变化合计 +{boundaryDelta}"——**须注入 3 精确行 + 退役 EOL 语义**(见 §4.5)。

**② 需求评审 · 三线对照**(`sopStep2` L5060 · `Step2` `:417`)
- 头 sub:`需求预测求解器：自下而上滚动 · 按应用细分聚合 · {linkRules('偏差>±10% 触发 C21')}`
- 表 `cmp` **7 列**「应用细分 / 目标(年度分解) / 滚动 P50 / **滚动 P90** / 上月实际 / 滚动 vs 目标 / 规则」,3 细分行 + 合计行
- 偏差列:`dv=(p50−tgt)/tgt*100`,`dv>=0?var(--quality):#DD7E9E`,`flag=|dv|>10`,flag 显 ` ⚑` + 规则 chip `C21 差异提报 → 进议程`(`#E8B54A`)
- 底 hint(`linkRules`):`商用车滚动 −11.8% 触发 C21，由 S&OP 主持Agent 自动写入第⑤步议程；储能上修来自电网公司F追量（CRM 合同变更）。合计 +{dv}% 未过线，不强制提报。`
- **系统现 `Step2` 仅 6 列,缺"滚动 P90"列**(`:480-483` 表头无 P90;`s2.rows` 无 p90 字段)——**最小缺口之一**。

**③ 供应评审 · 产能 ∥ 物料 两条线**(`sopStep3` L5072 · `Step3` `:538`)
- 头 sub:`聚合+瓶颈求解器 ∥ MRP 求解器 · {linkRules('引用 C02 聚合口径 / C06 齐套冻结 / C16 安全库存')}`
- 双栏 `grid 1fr 1.2fr`:
  - **左 产能线**(`wf-t` "产能线 · 基地供给（万套）"):表 3 列「基地 / 本月供给 / 瓶颈(紧张度)」,5 行 + 合计行(`Σcap` + `决议后 {sopSupply()}`)。瓶颈 chip 色:`tight>=85?#DD7E9E:#E8B54A`,`bn==='—'`→`—`。
  - **右 物料线 MRP**(`wf-t` "物料线 · MRP 净需求（= 需求×BOM单耗 − 库存 − 在途）"):表 5 列「物料 / 净需求 / 长协覆盖 / 缺口 / 最早齐套」,3 行;缺口色 `gap?#DD7E9E:var(--quality)`,`gap?{gap} {unit}:'无'`;右栏底 hint `正极缺口 654 吨：长协外现货采购 + 江门加急 200 吨（第⑤步决议）；电解液缺口在途已覆盖。`
- 底 hint(`linkRules`):`两个瓶颈与决策推演大屏同源：常州·化成通道 92、江门·物料齐套 90；齐套率为 MRP 计算值而非估计值（C06 口径）。`
- **系统现 `Step3` 只有左产能线 perBase 表**(`:562-583`),**右物料线 MRP 表全缺**——**最大缺口**。

**④ 财务整合 · 量·价·本·利 对预算**(`sopStep4` L5088 · `Step4` `:594`)
- 头 sub:`财务测算求解器：收入=Σ(量×细分单价) · 成本=BOM+制造费用 · {linkRules('C15 接单毛利线 / C18 现金安全垫')}`
- 表 `cmp` 4 列「科目(亿元) / 月度预算 / 滚动测算 / 差异」,3 科目行(收入/销售成本/毛利)+ 毛利率行
  - 科目行差异 `dv=roll−bud`,色:`(k==='销售成本'?dv<=0:dv>=0)?var(--quality):#E8B54A`(成本降为好,收入/毛利升为好),`{dv>0?'+':''}{dv}`
  - 毛利率行:`16.4%`(bud)→`16.0%`(roll)→`−0.4pct`(`#E8B54A`)
- 底 hint(`linkRules`):`毛利率差 −0.4pct 归因：<b>细分结构</b>——储能占比 37%（预算 33%），储能毛利率 13% 拉低综合；单价与成本线均未恶化。13 周滚动现金流最低点 58 亿 > 安全垫 50 亿，C18 达标；所有数字派生自 量×细分价/BOM 成本，与订单聚合看板同口径。`
- **系统现 `Step4` 只有 form + C15/C18 校验结果**(`:623-647`,毛利率_roll/现金垫两行),**缺量价本利科目表 + 归因 hint**——**缺口之一**。

**⑤ 高管决策会 · 差异议程 → 决议 → 定稿**(`sopStep5` L5096 · `Step5` `:652`)
- 头 sub:`S&OP 主持Agent 自动生成议程 · {linkRules('定稿走 Action（C10 审批留痕）· 定稿后锁定 C22')}`
- 双栏 `grid 1.05fr 1fr`:
  - **左 差异议程**(`wf-t` "差异议程（主持Agent 生成）"):3 个 `rk-sol` 卡(头 `rk-sol-h <b>` + `rk-sol-m`):
    1. `产销缺口 4.0 万套` → 决议 `常州化成夜班×1（+1.7）+ 江门正极加急200吨（+1.8）→ 缺口收敛 0.8 万套，按客户优先级取舍（C04 仅认证产线）`
    2. `商用车需求 −11.8%（C21）` → 决议 `维持目标线不下调；商用车集团G 渠道库存消化，8 月回补；列入下月跟踪项`
    3. `毛利率 −0.4pct（细分结构）` → 决议 `接受结构性差异；储能新单执行 C15 毛利线下限上浮 1pct 对冲`
  - **右 版本演进与对比**(`wf-t` "版本演进与对比"):表 `cmp` 6 列「版本 / 日期 / 需求 / 供给 / 缺口 / 变化」,4 版本行(V1/V3/V5/V7),`缺口=dem−sup`(`>2?#DD7E9E:var(--forecast)`),V7 行高亮 `background:rgba(124,45,146,.05)`,V7 未定稿时版本名后缀`（待定稿）`;表下 `#sopFinBox`:
    - 未定稿:按钮 `定稿 V7 → 写回 Action（C10/C22）`(`fc-go`,`onclick=sopFinalize()`)
    - 已定稿:框 `V7 已定稿并锁定（C22）· 定稿 Action 已留审计…下月评审以「V7 vs 实际」三线差异开场`
- **系统现 `Step5`**:议程汇集(`v.agenda`,`:676`)✅ + 决议增量编辑器(即时重算)✅ + 定稿走 Action(`:725`)✅,**但缺左栏 3 个 rk-sol 静态议程文案 + 右栏版本演进对比表**——**缺口之一**。系统议程是动态汇集(优于 HTML 静态),须**叠加** HTML 的版本对比表与决议文案(取种子)。

## 3. UX 规格（交互 · 状态 · 流）
| 交互 | 触发(HTML / 系统) | 行为 |
|---|---|---|
| 切步 | tier-chip onclick `sopGo(i)` / `Step` chip `:229` | 切 `sopStep`/`step` → 渲染对应步;`#sopBody` 重绘 |
| ⑤ 入口禁用 | — / `step5Blocked=s4.pass!==true` `:182` | ④ 未通过 → ⑤ chip `disabled` + title「④未通过阻断」(系统超集,HTML 无门禁) |
| ① 执行 | 静态 / `run({})` → `advance(step1)` `:238` | 跑 PLM 认证边 diff,DRAFT→IN_REVIEW |
| ② 改三线值 | 静态 / Step2 input onchange `:461` | 编辑 target/rolling/lastActual(+**新增 p90**),`run({segments})` 重算 dv/flag |
| ② C21 chip 跳议程 | 静态 / `onJumpAgenda(segKey)` `:501` | 切 step=5 + 高亮对应议程项(系统超集) |
| ③ 加供给增量 | 静态 / `setIncs` `:548` | 决议外常规对策行;`run({increments})` |
| ④ 执行校验 | 静态 / `run(form)` `:618` | 毛利率_roll/现金垫 C15·C18,pass 决定⑤是否解禁 |
| ⑤ 加决议 | 静态 / `setResolutions` `:703` | **添加后顶部供给/缺口即时重算**(display 侧,`SopKpiBar liveResolutions` `:280`);`run({resolutions})` 落库→版本演进 |
| 定稿 | `sopFinalize()` L5113(直接 push AUDIT) / `finalize()` `:147`(走 Action) | **系统:**POST `/a/v1/action-drafts` actionType=`定稿月度计划版本` → 待审批徽章 → Action EXECUTED → FINAL(C22);**HTML:**直接置 `sopFinal=true` + `AUDIT.push` + `sopGo(4)`。系统超集,保留 |
| 锁定后改字段 | — / `patchDemo` `:169` → 409 PLAN_LOCKED `:176` | FINAL 后改字段 → 横幅兜底 `lockedFallback` + 「发起变更」按钮(actionType=`计划版本变更`)(系统超集,演示 C22) |
| 六卡溯源 | — / `<Provenance>` `:351` | 悬停/focus 出六要素浮层(来源/新鲜度/推导/输入因子/关联规则/备注)(系统超集,优于 HTML 无溯源) |
| 状态机徽章 | — / STATUS_BADGE `:15` | DRAFT/IN_REVIEW(blue)/EXEC_MEETING(amber)/FINAL(green)(系统超集) |

**状态流(系统超集,HTML 仅 `sopFinal` 布尔)**:`DRAFT —step1→ IN_REVIEW —step2/3/4→ IN_REVIEW —step5→ EXEC_MEETING —定稿Action EXECUTED→ FINAL(C22锁定)`。HTML 是其特例(无中间态、定稿即布尔翻转)。

## 4. 数据规格（值 + 来源 + 系统字段级落地）
> 前端**零写死**(R14);每个数据分类:①实例→合成种子(battery.ts) · ②阈值→config(solverParams.sop / sopConfig) · ③公式→求解器(sop.ts step1..5) · ④文案→i18n(zh.ts sop) · ⑤结构→ViewDef/renderer。

### 4.1 顶部常量与公式（②config + ③求解器）
| 量 | HTML | 系统现状 | 分类 |
|---|---|---|---|
| `SOP_MONTH` | `'2026-07'` | `newMonth` 默认 `"2026-07"`(`:42`) | ①种子(版本.month) |
| `sopDemand()` | `Σ SOP_SEG.p50` = 71.0+49.0+12.0 = **132.0** | `s2.total.rolling`(`:277`) | ③求解器 step2 |
| `sopTarget()` | `Σ SOP_SEG.tgt` = 69.0+45.0+13.6 = **127.6** | `s2.total.target` | ③求解器 |
| `sopSupply()` | `sopFinal? V7.sup : 129.5` = **129.5/131.2** | `s5.supFinal ?? s3.sup`(`:278`) | ③求解器 step3/step5 |
| `gap` | `dem−sup` = 132.0−129.5 = **2.5**(未定稿) | `dem−supply`(`:282`) | ③求解器 |
| 缺口红线 | `gap>2` 红 | `sopConfig.gapRed ?? 2`(`:271`,solverParams.sop.gapRed=2 L244) | ②config |
| 收入预算达成 | `rev.roll/rev.bud*100`=248/240=**103%** | `s4.revSum/revBudget*100`(`:283`,revBudget=248) | ②config+③ |
| 毛利率口径差 | bud `gm.bud/rev.bud`=39.4/240=**16.4%** · roll `gm.roll/rev.roll`=39.7/248=**16.0%** | s4.gmRoll/gmBudget | ③求解器 |
| 现金底线 | C18 达标(静态) | `sopConfig.cashFloor ?? 50`(solverParams.sop.cashFloor=50) | ②config |
> ⚠️ **收入预算口径双值**:HTML `SOP_FIN[0].bud=240`,系统 `revBudget=248`。系统 `revBudget` 实际是 HTML 的 `SOP_FIN[0].roll=248`(滚动收入),非预算。**统一口径:取生成器派生的预算 240,勿双值**(见 §4.5)。

### 4.2 ① 可产矩阵 3 行（`sopStep1` L5054-5056 · ①种子 + ④i18n）
| 变化 | 型号 × 产线 | 状态(色) | 对本月供给影响(色) | 来源 |
|---|---|---|---|---|
| **转量产** | 4680-NCM × 合肥·动力线-B | 认证 T+20 → 量产(`var(--quality)`) | **+1.8 万套/月**(`var(--quality)`,700) | PLM 认证记录 |
| **爬坡中** | 4680-NCM × 常州·动力线-B | 已认证 · 60% 爬坡(`var(--forecast)`) | 计入产能口径（认证系数）| PLM / MES |
| **退役评审** | 2170-NCM × 眉山·产线2 | EOL 评审中(`var(--muted2)`) | Q4 起 −0.9 万套/月（不影响本月）(`#DD7E9E`) | PLM |
- 系统 `Step1` 当前从 `certByModel` 派生通用"认证转量产"行(`sop.ts:91-98`)。**须补:转量产精确影响 +1.8 + 退役评审 EOL 行(Q4 −0.9 不影响本月)**——种子化为 PLM 认证边 diff 的确定性输出。

### 4.3 ② 三线对照 `SOP_SEG`（L4993-4997 · ①种子 segments）
| seg | tgt | p50 | **p90** | act | dv=(p50−tgt)/tgt×100 | flag(\|dv\|>10) |
|---|---|---|---|---|---|---|
| 乘用车 | 69.0 | 71.0 | **66.5** | 66.8 | +2.9% | — |
| 储能 | 45.0 | 49.0 | **45.2** | 41.9 | +8.9% | — |
| 商用车 | 13.6 | 12.0 | **11.1** | 12.9 | **−11.8% ⚑** | C21 chip |
| **合计** | **127.6** | **132.0** | **122.8** | **121.6** | **+3.4%** | — |
- 合计 P90 = 66.5+45.2+11.1 = **122.8**;合计 act = 66.8+41.9+12.9 = **121.6**;合计 dv =(132.0−127.6)/127.6 = **+3.4%**。
- 系统 battery segments(L1122-1126):`{pas 乘用车 gmRate18 share.52}{ess 储能 gmRate13 share.32}{com 商用车 gmRate15 share.16}`——**无 p50/p90/act/target 三线值**(那些由 step2 payload 或 PlanTarget×share 派生)。前端 `DEFAULT_SEGMENTS`(`:26-30`)已含 target/rolling/lastActual 精确值(69/71/66.8 等),**但无 p90**。

### 4.4 ③ 供应 / 物料 `SOP_SUPPLY`(L4998-5004) + `SOP_MAT`(L5005-5009)
**产能线 5 基地(①种子)**
| 基地(去`·总部`) | cap | 瓶颈 bn | tight |
|---|---|---|---|
| 常州基地 | 31.0 | 化成通道 | 92(≥85 红) |
| 成都基地 | 18.4 | — | 74 |
| 合肥基地 | 16.2 | — | 78 |
| 江门基地 | 13.5 | 物料齐套 | 90(≥85 红) |
| 其余 8 基地 | 48.9 | — | 69 |
| **合计** | **128.0** | — | 决议后 **129.5** |

**物料线 MRP 3 物料(①种子,口径=需求×BOM单耗−库存−在途,C06)**
| 物料 | unit | net(净需求) | lta(长协覆盖%) | gap(缺口) | eta(最早齐套) |
|---|---|---|---|---|---|
| 三元正极 | 吨 | 8180 | 92 | **654**(红) | 06-28 |
| 隔膜 | 万㎡ | 2376 | 100 | 0(无,绿) | — |
| 电解液 | 吨 | 5544 | 96 | **222**(红) | 06-25 |
- 净需求显示 `net.toLocaleString()+' '+unit`(如 `8,180 吨`);缺口 `gap?gap.toLocaleString()+' '+unit:'无'`。
- 系统 `Step3`:产能线 perBase ✅(`sop.ts:184-195` Σ基地周产能×curveMult×certFactor),**物料线 MRP 全缺**。

### 4.5 ④ 财务 `SOP_FIN`(L5010-5014) + ⑤ 版本 `SOP_VERS`(L5015-5019)
**④ 量价本利科目表(①种子)**
| 科目(亿元) | bud(月度预算) | roll(滚动测算) | diff=roll−bud(色) |
|---|---|---|---|
| 收入 | 240.0 | 248.0 | **+8.0**(绿,升为好) |
| 销售成本 | 200.6 | 208.3 | **+7.7**(黄,升为差;`dv<=0` 才绿) |
| 毛利 | 39.4 | 39.7 | **+0.3**(绿) |
| **毛利率** | **16.4%** | **16.0%** | **−0.4pct**(黄) |
- 毛利率 bud=39.4/240=16.42%≈16.4%;roll=39.7/248=16.01%≈16.0%。**HTML 毛利率行 16.4%/16.0%/−0.4pct 直接硬写**(L5093),非派生——种子化时确保派生值与之一致。

**⑤ 版本演进 `SOP_VERS`(①种子)**
| v | d(日期) | dem | sup | gap=dem−sup(色) | note |
|---|---|---|---|---|---|
| V1 | 06-02 | 130.0 | 124.0 | 6.0(红) | 初稿：自下而上滚动需求 |
| V3 | 06-05 | 132.0 | 126.0 | 6.0(红) | 需求评审定数；储能上修 |
| V5 | 06-08 | 132.0 | 129.5 | 2.5(红) | 供应评审：批准常州化成夜班×1 |
| V7 | 06-10 | 132.0 | 131.2 | 0.8(绿,≤2) | 高管会：江门正极加急 200 吨 · 定稿 |
- V7 行高亮 + 未定稿后缀`（待定稿）`(L5097)。系统左栏版本列表是动态(`fetchSopVersions`),但**⑤右栏对比表全缺**——须以同月版本快照(dem/sup/note)渲染对比表。

### 4.5★ 系统字段级落地（现状 → 须改/须加,精确,**复用结构 PRD 缺口分析**）
> 系统骨架成熟(状态机/Action/C22/六卡溯源)。R14 已大部到位(sopConfig/segments/resolutions 配置化)。**四张表缺口 + 一处口径**:

1. **② 加"滚动 P90"列**(最小缺口):
   - 契约 `solvers.ts`:`SopVersion.steps.s2.rows[]` 加 `p90:number`,`s2.total` 加 `p90:number`。
   - 求解器 `sop.ts:step2`(`:145-164`):rows.map 加 `p90: num(s.p90)`(payload 透传)或需求预测求解器 P90 分位;total 加 `p90: rows.reduce((a,r)=>a+r.p90,0)`。
   - 前端 `Step2`(`:417`):编辑表加第 4 列 input(`p90`,step 0.1);结果表 `:476-483` 表头插「滚动 P90」、合计行加 P90 cell。
   - 种子 `sopConfig.segments`(types.ts `:77`)+ `DEFAULT_SEGMENTS`(`:26-30`)每行加 `p90`(66.5/45.2/11.1)。
2. **③ 加"物料线 MRP 净需求表"**(最大缺口):
   - 新对象类型 `MaterialBalance`(与 cockpit PRD 同定义,勿重复登记):`{material,unit,netDemand,ltaCoverPct,gap,earliestComplete}`,净需求=Σ(需求×BOM单耗)−库存−在途(C06/C16)。
   - 新求解器 `mrp_netting`:注册进 `SOLVER_KEYS`(service.ts L18 区)+ chain。输入需求三线 + BOM + 库存/在途(battery 派生)→ `MaterialBalance[]`。
   - 契约 `solvers.ts`:`s3.materials: MaterialBalanceSchema[]`(三元正极/隔膜/电解液 3 行)。
   - 求解器 `sop.ts:step3`(`:171`):输出 perBase(已有)+ `materials`(新)。
   - 前端 `Step3`(`:538`):改单栏为 `grid 1fr 1.2fr`,右栏渲染物料表 5 列 + 缺口 hint。
   - 种子 battery:加 BOM 单耗 + 各物料库存/在途,确保 net=8180/2376/5544、gap=654/0/222、eta=06-28/—/06-25 派生一致。
3. **④ 加"量价本利科目表 + 归因"**:
   - 契约 `solvers.ts`:`s4` 加 `pnl:[{subject,budget,rolling,diff}]`(收入/销售成本/毛利)+ `gmRow:{budgetPct,rollPct,diffPp}` + `attribution:string`(储能占比 37% vs 33% 归因文案)。
   - 求解器 `sop.ts:step4`(`:219`):现有 revSum/gmSum/cashCushion 之上,组装 pnl 三行(收入=Σ量×细分价,成本=BOM+制造费用)+ gmRow + attribution(取细分占比对比派生)。
   - 前端 `Step4`(`:594`):C15/C18 校验上方加科目表(4 列 + 毛利率行)+ 归因 hint。
   - 种子:`SOP_FIN` 预算/滚动(240/248,200.6/208.3,39.4/39.7)入 battery 财务种子;储能占比 37%(预算 33%)派生自 segments share。
4. **⑤ 加"版本演进对比表"**:
   - 前端 `Step5`(`:652`):用 `fetchSopVersions` 同月版本快照渲染对比表 6 列(版本/日期/需求/供给/缺口/变化);当前版本(或 V7)高亮,未定稿后缀`（待定稿）`。`note` 取 `version.inputs.note`(种子)或决议摘要。
   - **左栏 3 个 rk-sol 议程卡文案**(产销缺口 4.0/商用车 −11.8%/毛利率 −0.4pct + 决议)取 ④i18n 种子,叠加在系统动态 `v.agenda` 之上(系统议程汇集保留,文案补全)。
   - 种子 `SOP_VERS`(V1/V3/V5/V7 dem/sup/note)入 battery,作同月多版本快照(或 note 字段)。
5. **改 1 处口径(收入预算双值)**:`solverParams.sop.revBudget` 当前 248(实为滚动值)。HTML 预算=240(`SOP_FIN[0].bud`)、滚动=248(`.roll`)。**统一**:`revBudget` 取 **240**(真预算),收入达成 = 滚动收入248 ÷ 预算240 = **103%**(与 HTML L5037 `rev.roll/rev.bud` 一致)。前端 `SOP_KPI_P.revBudget=248`(`:23`)+ `sopConfig.revBudget` 同步改 240。
6. **① 退役 EOL 行**:`sop.ts:step1` 补退役评审行(2170-NCM×眉山·产线2,Q4 −0.9 不影响本月)——种子化 PLM 认证边 diff 的 EOL 分支。

### 4.6 文案数据资产（④i18n,逐字录入 zh.ts sop · 现状 `:409-435`）
- **已在**:title/steps(5)/runStep/locked/finalize/c21Chip/gapRed/kpi(6 卡 label)/reviewing/finalBadge 等(`zh.ts:409-435`)。
- **须补 i18n**:① 3 行可产矩阵文案(变化/状态/影响/来源) · ② 三线 hint(商用车 −11.8% 触发 C21 / 储能上修电网公司F追量 / 合计未过线) · ③ 物料线表头 + 正极缺口 hint + 两瓶颈同源 hint · ④ 科目表 hint + 毛利率 −0.4pct 归因(储能占比 37% vs 33%) · ⑤ 3 个 rk-sol 议程决议文案 + V7 定稿框文案。`linkRules(...)` 包裹规则引用(C21/C04/C06/C15/C18/C22/C02)。

## 5. 契约 / 端点
- `packages/contracts/src/solvers.ts`:`SopVersion.steps` 扩展(均 `.catchall(z.unknown())` 兼容):
  - `s2.rows[].p90: number` + `s2.total.p90: number`
  - `s3.materials: MaterialBalanceSchema[]`(新 schema:`{material,unit,netDemand,ltaCoverPct,gap,earliestComplete}`)
  - `s4.pnl: [{subject,budget,rolling,diff}]` + `s4.gmRow:{budgetPct,rollPct,diffPp}` + `s4.attribution: string`
  - `s5` 已有 supFinal/gapFinal;版本对比由前端聚合 `fetchSopVersions`(无需新字段)
- `packages/contracts/src/workspace.ts` + 前端 `api/types.ts` `sopConfig`(`:71-82`):`segments[]` 加 `p90`;`revBudget` 默认改 240。
- 端点(全部已存在,无新端点):
  - `POST /a/v1/sop/versions`(create)· `GET /a/v1/sop/versions`(list,⑤对比)· `GET /a/v1/sop/versions/{id}`(get)
  - `POST /a/v1/sop/versions/{id}/advance`(step1..5,step3 带 materials、step4 带 pnl)
  - `PATCH /a/v1/sop/versions/{id}`(FINAL → 409 PLAN_LOCKED 演示)
  - `POST /a/v1/action-drafts`(actionType=`定稿月度计划版本` / `计划版本变更`)→ EXECUTED → `applyFinalizeAction`/`applyChangeAction`(`sop.ts:383/:403`)
- 新求解器 `mrp_netting`(可选 `finance_pnl`,或扩 step4 内联):注册 `SOLVER_KEYS`(service.ts L18) + `chain:check`。

## 6. 融合集成点（不绕过 · 复用现有 `SopBalanceView`,增强不重建）
1. **Renderer**:`registry.ts` `sop-balance` → `SopBalanceView`(已注册)。
2. **ViewDef**:`service.ts` 视图 layout(版本台);**Feature** `features.ts` `view.sop-balance`(Entitlement 先于 authz)。
3. **导航**:`ShellLayout`(推演/S&OP 组);**场景启动器**(sop_* intents)。
4. **同源勾稽**:② 目标线 = `PlanTarget`(`sop.ts:targetLine` `:110`,AOP 年→季→月分解同源);③ 产能口径 = `computeRollup`(C02,与产能推演/驾驶舱同源);④ 现金垫 = 13 周滚动 min(C18,与体检/audit 同源)。
5. **定稿写真相**:`applyFinalizeAction` → `outbox.emit('sop.finalized')`(`:392`)→ R4;`currentPlanVersion`(`:419`)把 FINAL 版本解析为 plan_audit 基线(跨视图一致)。

## 7. 验收（DoD = 真 1:1,色/字可调）
- **像素核对**:与 HTML sop 页并排,逐元素勾——六卡 KPI / 五步 chips / ① 可产矩阵 3 行(含退役 EOL) / ② 三线对照**含滚动 P90 列** + C21 ⚑ + 合计 / ③ 产能线∥**物料线 MRP 表**(3 物料,net/lta/gap/eta) / ④ **量价本利科目表**(收入/成本/毛利 bud/roll/diff + 毛利率 −0.4pct + 归因 hint) / ⑤ 议程 3 卡 + **版本演进对比表 V1/V3/V5/V7** + 定稿。**结构/值/字符串/交互全一致**,漏一表不过。
- **交互**:切步 · ② 改三线(含 P90)重算 dv/flag · C21 chip 跳⑤议程高亮 · ③ 加供给增量 · ④ 校验 pass 解禁⑤ · ⑤ 加决议顶部供给/缺口即时重算 · 定稿走 Action 待审批 → EXECUTED → FINAL(C22)· 锁定后改字段 409 PLAN_LOCKED 横幅 + 发起变更——逐项 FDE 亲手跑(走 `fde-delivery` skill)。
- **数据**:前端零写死(`debattery:check`,DEFAULT_* 仅兜底 + `// debattery-allow`)· 种子值=HTML 精确(SOP_SEG/SUPPLY/MAT/FIN/VERS)· 同 (industry,scale,seed) 字节一致(R6)· 每数可溯(R13,六卡 + 物料/科目 `<Provenance>`)· 收入预算单一口径(240,非双值)。
- **门禁**:`pnpm -r build && pnpm -r test` 全绿(新增 `mrp_netting` + sop-view testid 回归)· `chain:check`(mrp_netting/finance_pnl 注册)· `ontology:check`(MaterialBalance 登记)。
- **回写本体**:`docs/SYSTEM-ONTOLOGY.md` §2.E(SopVersion 扩 s2.p90/s3.materials/s4.pnl + MaterialBalance 对象)· §3 链路(③ 物料线 mrp_netting)· §7 门禁(chain)。

## 8. 实施任务（研发可直接拆,4 期沿结构 PRD §8）
1. **SOP.1 ② 滚动 P90 + ① 三行精确化**(小):契约 `s2.rows[].p90`/`total.p90`;`sop.ts:step2` 输出 p90;前端 `Step2` 加列;`Step1`/`sop.ts:step1` 补 +1.8 转量产 + 退役 EOL 行;种子 segments 加 p90 + DEFAULT_SEGMENTS 加 p90;i18n 补 ②hint。
2. **SOP.2 ③ 物料线 MRP**(最大,依赖 cockpit `MaterialBalance`):新 `MaterialBalanceSchema` + `mrp_netting` 求解器 + 注册 SOLVER_KEYS/chain;`sop.ts:step3` 输出 materials;前端 `Step3` 改双栏 + 右物料表 + 缺口 hint;种子 BOM/库存/在途使 net/gap/eta 派生一致。
3. **SOP.3 ④ 量价本利科目表 + 归因**:契约 `s4.pnl/gmRow/attribution`;`sop.ts:step4` 组装 pnl + 归因;前端 `Step4` 加科目表 + hint;种子 SOP_FIN 入财务种子;**统一收入预算 240**(改 solverParams.sop.revBudget + sopConfig.revBudget + SOP_KPI_P.revBudget)。
4. **SOP.4 ⑤ 版本演进对比表 + 议程文案 + 全链回归**:前端 `Step5` 用同月版本快照渲染对比表(V1/V3/V5/V7 高亮 V7 + 待定稿后缀);补左栏 3 rk-sol 议程决议 i18n;种子 SOP_VERS 入 battery(多版本快照/note);FDE 亲手跑五步至定稿;回写本体。

> 依赖:`MaterialBalance` 对象类型与 cockpit PRD 共享(择一先落、另一引用)。冲突中等(集中在 sop.ts + battery plan 域 + SopBalanceView)。
>
> **诚实声明(不确定项)**:(a) HTML 毛利率行 16.4%/16.0%/−0.4pct 为硬写(L5093),种子派生须验证四舍五入后一致;(b) HTML `sopSupply()` 返回 129.5(未定稿)/V7.sup 131.2(定稿),系统 supFinal 由 step3.sup + Σ决议 派生,数值需对齐(常州夜班+1.7、江门加急+1.8 与 DEFAULT_RESOLUTIONS 现值 1.2/0.5 不一致,须改种子 delta 使 V5 129.5、V7 131.2 收敛);(c) `mrp_netting`/`MaterialBalance` 在系统中尚不存在(grep 确认),为真新增,工作量最大;(d) 收入预算 240 vs 系统 248 是口径错配,须人工确认取 240 为预算。
