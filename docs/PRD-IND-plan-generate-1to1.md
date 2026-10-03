# 工业级 PRD · 规划建议 / 方案生成（plan-generate）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 数据）。**只读本文 + 像素参照 HTML 即可 1:1 实现**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`（`buildGenView` L4602 · `renderGenResult` L4652 · 数据 L4288-4559）——本文已把其全部常量/公式/交互转录,研发以本文为准、HTML 仅作像素核对。 |
| 落点（融入,不新建） | 前端 `apps/frontend-shell/src/views/sim/PlanGenerateView.tsx` + `RadarChart.tsx`（renderer `plan-generate`）· 后端求解器 `apps/datacore/src/solvers/plan.ts:188 planGenerate` · 种子 `apps/datacore/src/synthetic/battery.ts:217 planGenerate` · 契约 `packages/contracts/src/solvers.ts GenSchemeSchema` |
| 不变量 | R14（前端零写死,值来自管线）· R6（同 seed 字节一致）· R13（每数可溯）· R-一致（时序/KSF/财务口径跨视图同源）· 1:1=结构/数据/交互 100%,**唯色调/字体可调** |

---

## 1. 视图概述
CEO 输入 6 项经营目标（各可设硬约束/软偏好）→ 系统把 **5 条路径骨架**代入求解器+规则 → 按目标收敛为 **3 个方案**（稳健/均衡/进取）→ 每方案含五维取舍矩阵、雷达、目标达成、外部敏感性、问题传播链+时序、KSF 图 → 采纳 → 下发年度情景规划台。**系统只摆选项与命比,选哪个由决策者拍板。**

## 2. UI 规格（布局 · 像素结构）
### 2.1 整页（`buildGenView`）
```
┌ rk-top ────────────────────────────────────────────────┐
│ <h3>规划建议</h3>                                         │
│ rk-sub: "输入经营目标（每项可设 硬约束/软偏好），系统把 5 │
│   条路径骨架代入求解器+规则，按目标收敛为 3 个方案（稳健/ │
│   均衡/进取），每个方案内含五维取舍矩阵分析。选哪个由你拍 │
│   板，系统只摆选项与命比。"                                │
│ 右侧 hsel: [AI 对话条] [3 方案对比(on)] [重置目标]        │
└─────────────────────────────────────────────────────────┘
[AI 对话面板(折叠,见 §3.6)]
┌ grid: 330px │ 1fr ──────────────────────────────────────┐
│ 左:rk-det「🎯 输入经营目标」(副"2027 · 年度口径")        │ 右:genResult
│   6 × goalRow                                            │ (3 方案卡)
│   hint: "硬约束被违反 → 方案标红…基线取 2027 基准情景    │
│   （收入 3,400 亿 / 毛利 16.0% / 现金垫 58 亿）。目标改  │
│   动会实时重排三个方案。"                                 │
└─────────────────────────────────────────────────────────┘
```
- **goalRow**：`<label>{label}</label> <input number step={step} value={v}> <i>{unit}</i> <chip 硬约束/软偏好>`（chip on=硬,点击切换）。

### 2.2 右栏标题（`renderGenResult` 顶）
- rk-det 头「📐 系统推的 3 个方案」副"5 路径骨架 → 按目标收敛 · 点方案展开五维取舍矩阵分析"。
- **导引条**(底色=推荐方案色)："系统推荐 = 方案{no}「{name}」（基于路径 {id} {n}，{满足/仍有硬约束}，综合分 {total}）" + "最看重现金与盈利→壹;规模毛利平衡→贰;市场份额→叁。最终由你拍板,系统不替你选。"

### 2.3 方案卡（3 张,`gen3-card`,左边框 4px=路径色）
**折叠头 `gen3-head`**（点击展开/收起）：
- 序号圆 `gen3-no`(底色 p.c)：壹/贰/叁
- 标题：`<b>{name}{★}</b>` + 副"{intent} · 基于路径 {id}「{n}」"
- 徽章：★→"系统推荐"(p.c 描边);硬违规→"硬约束冲突"(红)
- 3 KPI `gen3-kpis`（**每个带悬停溯源 provSpan**,见 §4.5）：收入增长(meetRev 绿/黄)·毛利率(meetGm 绿/红)·现金垫(meetCash 绿/红)
- 综合分 `gen3-score`(viol→⛔不评分,带溯源)
- `gen3-exp`："▸ 取舍分析"/"▼ 收起"

**展开体 `gen3-body`**（三栏 `gen3-cols` + 下方区块）：
1. **五维画像**：`radarSVG(scores,p.c,150)` + path.desc
2. **目标达成判定**：6 行 `meetRow`（收入增长/毛利率底线/现金安全垫/市场份额增长/CAPEX/库存周转,各显 值 + "目标 X·硬?" + ✓/✗）;viol→红 hardViol(linkRules)
3. **得/舍与风险**：得=三案最高维(Δ≥1)·舍=三案最低维(Δ≥1)·风险 path.risk·rules(linkRules)
4. **五维取舍矩阵表** `gx-table`：行=5维+综合分,列=三方案(本案高亮)+「本方案取舍」(领先·得/让步·舍/持平,阈值 mx−mn>1)
5. **KSF 图**：`ksfSVG(fins,probs)`（财务指标←KSF←问题,问题点击滚动定位 `#genprob-{id}-{qi}`）
6. **外部信号敏感性**：`GEN_EXT_SENS[id]` 每行 `<b color=信号色>{信号}</b> {解读}`
7. **执行关键点**：`keys` + 每问题卡 `gen3-prob`：必须解决「{n}」+rule 徽章 + "为什么必须解决（推演）：{why}" + 风险传播链(4 节点 `agg-dn`[标签/对象/色]→) + `probSeqHTML`(逐日时序,§4.6)
8. **采纳**：按钮"采纳本方案（路径 {id}）→ 下发年度情景规划台细化"(`genAdopt`)

## 3. UX 规格（交互 · 状态 · 流）
| 交互 | 触发 | 行为 |
|---|---|---|
| 改目标值 | goalRow input onchange `genSet(k,v)` | 写 genGoals[k].v → **实时重算重排 3 方案**(renderGenResult) |
| 切硬/软 | chip onclick `genToggleHard(k)` | 翻转 genGoals[k].hard → 重建(buildGenView) |
| 重置目标 | "重置目标" `genReset()` | 还原 GEN_GOALS 默认 → 重建 |
| 展开/收起方案 | gen3-head onclick `genTogglePlan(key)` | 切当前展开卡;`genPlanOpen='__auto'` 初始=推荐卡 |
| 选路径(高亮) | `genSelectPath(id)` / `genPick` | 高亮对应路径 |
| 悬停时序日点 | rk-dot onmouseenter `probDayTip(uid,d,ev)` | 浮层:日期+T+d+传导度+阶段事件+受影响订单表(4行);离开 hideDayTip |
| 问题节点点击 | KSF 图问题节点 | 滚动定位到 `#genprob-{id}-{qi}` |
| 采纳 | `genAdopt(key,id,name)` | 提交 Action「下发年度情景规划台细化」+ 提示;跳/联动 aop |
| AI 对话 | `aiBar('gen')`/`aiToggle('gen')` | 展开预设 QA(§3.6) |
| 状态:硬违规 | hardViol.length>0 | 卡标红 viol·综合分⛔·徽章"硬约束冲突" |
| 状态:推荐★ | 可行且 total 最高 | 徽章"系统推荐"+导引指向 |

## 4. 数据规格（值 + 来源 + 系统字段级落地）
> 前端**零写死**(R14);所有值来自:①合成种子→物化 ②config/种子参数 ③求解器口径 ④i18n ⑤ViewDef。

### 4.1 6 项目标 `GEN_GOALS`（②config · ViewConfig.layout.goalFields,用户可改）
| key | label | 默认v | unit | hard |
|---|---|---|---|---|
| revGrow | 收入增长率 | 18 | % | 软 |
| gmFloor | 毛利率底线 | 15.5 | % | 硬 |
| cashFloor | 现金安全垫底线 | 50 | 亿 | 硬 |
| shareGrow | 市场份额增长 | 12 | % | 软 |
| capexCap | CAPEX 上限 | 20 | 亿 | 硬 |
| invTurns | 库存周转(次/年) | 6.0 | 次 | 软 |

### 4.2 基线 `GEN_BASE`（①AOP 2027 基准情景派生,勿另写）
rev 3400(亿) · gm 16.0% · share 18.0 · capex 14 · turns 5.6 · cash 58 · demBase 1580。

### 4.3 5 路径 `GEN_PATHS`（②种子 SolverParam · battery.ts planGenerate.paths）
| id n | 色 | eff{rev,gm(pct),share,capex,turns,cash} | rules | risk |
|---|---|---|---|---|---|
| A 保毛利型 | #62BE77 | 1.12,+1.4,+6,0,+0.6,+6 | C15 上浮1pct | 规模不达;流失储能份额 |
| B 保规模型 | #5E8FE8 | 1.22,−0.8,+16,2,−0.4,−4 | C13从严·C18复核 | 毛利击穿;现金压力 |
| C 扩产型 | #9D8BF0 | 1.20,+0.2,+22,27,−0.2,−12 | C23·C18 | C23校验;现金逼近红线 |
| D 外协型 | #D08A66 | 1.16,−0.5,+12,0,+0.2,+2 | C08红线 | C08≤20%;质量波动 |
| E 混合型★ | #54B5C4 | 1.18,+0.4,+14,14,+0.3,−2 | C23枣庄·C08·C15守价 | 执行复杂度最高 |
- desc/tag 逐字 HTML L4301-4325（④i18n）。

### 4.4 求解器口径（③`planGenerate` · plan.ts:188,确定性 R6）
- outcome：rev=base.rev×eff.rev·gm=base.gm+eff.gm·share=base.share+eff.share·turns=base.turns+eff.turns·cash=base.cash+eff.cash·capex=eff.capex。
- 达成(容差)：meetRev revGrowAbs≥revGrow−0.5·meetGm gm≥gmFloor·meetShare (share−base.share)≥shareGrow·meetCapex capex≤capexCap·meetCash cash≥cashFloor·meetTurns turns≥invTurns。
- 硬违规：hard.gm&gm<gmFloor→"C15…";hard.cash&cash<cashFloor→"C18…";hard.capex&capex>capexCap→"CAPEX…"。
- **五维评分(clamp 0-100)**：盈利=50+(gm−gmFloor)×22·规模=40+shareGrow×3·现金=50+(cash−cashFloor)×4·**增长=30+revGrowAbs×2.5**(revGrowAbs=(eff.rev−1)×100)·稳健=90−capex×2.2。**total=round(Σ/5)−15×hardViol**(≥0)。
- gen3Plans：稳健=`盈利+现金+稳健`max(可行优先)·进取=`规模+增长`max·均衡=`total`max;去重;★=可行且 total 最高。3 方案名/intent：壹 稳健·守盈利(盈利质量与现金安全优先,增长适度让位)/贰 均衡(规模与毛利平衡,可行域内综合最优)/叁 进取·冲规模(份额与增长优先,接受盈利/现金承压)。

### 4.5 ★系统字段级落地（现状 → 须改/须加,精确）
> 系统 `plan_generate` 已参数化(R14)、**评分系数与 HTML 完全一致**(profitBase50/profitK22/scaleBase40/scaleK3/cashBase50/cashK4/growthBase30/growthK2.5/stabBase90/stabK2.2/hardPenalty15 ✓)。缺口:
- **改种子值**(battery.ts:218-219)：base.gm 0.142→**0.16**·base.share 17→**18**·base.turns 6.0→**5.6**·base.cash 70→**58**·targets.gmFloor 0.135→**0.155**·targets.cashFloor 45→**50**;base.rev 100(归一)→显示口径统一(KPI 显绝对亿元用 3400 或派生,声明清楚)。
- **加目标字段 invTurns**：`PLAN_GENERATE_GOAL_FIELDS`(service.ts:993)+前端 `GOAL_FIELDS`(PlanGenerateView.tsx:45)各加 `{key:"invTurns",label:"库存周转",unit:"次",step:0.5}`(求解器 turnsFloor/meetTurns 已支持,只缺面板暴露)。
- **加输出字段 extSensitivity**：`GenSchemeSchema`(solvers.ts) 加 `extSensitivity:[{signal,impact,color}]`(GEN_EXT_SENS 5×3)+ 种子;接 ExternalSignal。
- **结构化 problems**：`problems:array(record)`→`{n,kind,rule,why,chain:[[标签,对象,色]×4]}`(GEN_FOCUS 5×2)+ 种子 why/chain。
- **改 1 处口径**：growth 评分系统用 `(outcome.rev−base.rev)×K`(绝对)→改 `revGrowAbs×2.5`(%,plan.ts:256)。
- **复用 audit**：`audit_timeline`(timelineFor 9×4 口径)+`ksfSVG/KSF_DEF`(见 audit 子 PRD)。

### 4.6 数据资产（完整,作种子/i18n;研发逐字录）
- **GEN_EXT_SENS**(5×3,④i18n+②色)：HTML L4501-4517 逐字（A:碳酸锂+9.8%/竞对储能−6%/上险+11%;B/C/D/E 各 3 条,含解读文案与色 #E8B54A黄/#DD7E9E红/#62BE77绿）。
- **GEN_FOCUS**(5×2,④i18n)：每问题 {n,kind,rule,why(长文),chain[4]}（HTML L4518-4559 逐字,如 A 储能客户份额流失/share/C21/why…/chain[拒低毛利储能单→电网F转单→框架议价权弱化→份额不达]）。
- **KSF_DEF**(5,②)：k_dem 需求结构管控/k_bal 产销平衡与爬坡/k_kit 物料齐套保障/k_cash 信用与现金管控/k_cost 成本与外协管控（各 sub+fin 链,L4407-4413）。
- **timelineFor**(③求解器,9 类×4 阶段,L4342-4405)：gap/margin/kit/cash/share/ramp/outsource/capex23/struct,各 4 阶段{w,d,t,m,orders?,fin?,sev}逐字;数字取自 ORDERS(①)。
- **probSeqHTML**(③+⑤)：SEV_V{0:64,1:79,2:90}·anchors[[0,58]]+阶段·probSeqVal 分段线性+hashN 抖动 clamp[40,97]·三档<70绿/70-84黄/≥85红·90 天轴远期压缩。
- **AI QA**(④)：4 预设(本月最大风险/影响收入最大/毛利为何低于预算/现在该做什么决策——gen 页:推荐哪个/三案差异/进取受限/重现金),答案取实时 gen3Plans 数据(L3493-3498)。

## 5. 契约 / 端点
- `contracts/solvers.ts`：`GenSchemeSchema` 扩 `extSensitivity[]`、`problems` 结构化、`outcome` 已含 turns；`PlanGenerateOutputSchema` 不变(3 schemes+recommend)。
- `service.ts:993`：`PLAN_GENERATE_GOAL_FIELDS` 加 invTurns。
- 端点：`POST /a/v1/solvers/plan_generate/invoke`(useLiveSolver 即时重算)·`POST /a/v1/action-drafts`(采纳)·复用 `audit_timeline`/`POST /a/v1/external-signals/sensitivity`。

## 6. 融合集成点（5 处,不绕过）
Renderer `registry.ts`(plan-generate) · ViewDef `service.ts`(layout.goalFields) · Feature `features.ts`(view.plan-generate) · 导航 ShellLayout(推演组) · 场景启动器(plan_generate_* intents)。**复用现有 PlanGenerateView,增强不重建。**

## 7. 验收（DoD = 真 1:1）
- **像素核对**：与 HTML generate 页并排,逐元素勾——6 目标/5 路径/3 方案/雷达/六行达成/取舍矩阵/KSF/外部敏感性/问题卡 why+链+时序/采纳/导引,**结构/值/字符串/交互全一致**(色/字可不同)。漏一项不过。
- **交互**：改目标实时重排·切硬软·折叠·悬停时序日点出浮层·问题点击定位·采纳出 Action——逐项 FDE 亲手跑。
- **数据**：前端零写死(`debattery:check`);种子值=HTML 精确;同 seed 字节一致(R6);每数可溯(R13);五维评分与 HTML 同值。
- `pnpm -r build && test` 全绿;`chain:check`/`ontology:check` 过。
- 回写本体 §2.E（plan_generate 扩展）。

## 8. 实施任务（研发可直接拆）
1. 种子：battery.ts 改 6 个 base/targets 值 + 加 GEN_EXT_SENS/GEN_FOCUS/KSF_DEF 种子。
2. 契约：GenSchemeSchema 加 extSensitivity + 结构化 problems。
3. 求解器：plan.ts growth 口径改 revGrowAbs;输出 extSensitivity/problems 结构。
4. 目标面板：service.ts + 前端加 invTurns 字段。
5. 前端：PlanGenerateView 补 五维取舍矩阵表/雷达(RadarChart)/目标达成 6 行/外部敏感性/问题卡(why+chain+时序)/KSF 图(复用 audit)/采纳→AOP/导引/AI QA。
6. 时序/KSF：接 audit 的 audit_timeline + ksfSVG。
7. i18n：GEN_PATHS desc/risk、GEN_FOCUS why/chain、文案逐字入 locales。

> **这是工业级深度的样板**。其余 11 视图(dash/risk/aop/sop/quarter/audit/order/model/story/map/聚合)各须一份本文这样的完整工业 PRD(UI 布局 + UX 交互 + 数据字段级落地 + 融合点 + 验收)。索引见 `PRD-verbatim-1to1-replication.md §2`。
