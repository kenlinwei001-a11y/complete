# 工业级 PRD · 规划体检 / 计划审计（plan-audit）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 数据）。**只读本文 + 像素参照 HTML 即可 1:1 实现**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`：`buildAuditView` L4910 · `renderAuditInput` L4923 · `renderAuditResult` L4947 · `runAuditDiag` L4813 · `buildAuditPlanRows` L3426 · `AUDIT_KIND` L4942 · `AUDIT_PRESETS` L4804 · `timelineFor` L4342 · `probSeqVal`/`probSeqHTML` L4453/4481 · `probDayTip` L4464 · `dateAxis` L2452 · `riskColor` L1632 · `hashN` L1605 · `dateOf` L1636 · `ksfSVG`/`KSF_DEF`/`KIND_KSF` L4415/4407/4414 · `radarSVG` L4594 · `provSpan`/`provTip` L4760 · `extStrip`/`EXT_SIG` L4798/4781 · `planTableHTML` L3402 · `tlOrders` L4328 · `SEG_MARGIN` L2380 · `T0` L1584 ——本文已把其全部常量/公式/交互转录，研发以本文为准、HTML 仅作像素核对。 |
| 落点（融入，不新建） | 前端 `apps/frontend-shell/src/views/sim/PlanAuditView.tsx`（renderer `plan-audit`，`registry.ts:44`）+ 重写 `PropagationTimeline.tsx`（消费 series）+ 新增 `<KsfGraph>`/`<RadarChart>` 复用 · 后端求解器 `apps/datacore/src/solvers/plan.ts:41 planAudit`（扩 X01–X05/R01–R02 + E01–E03 + kind）+ 新增 `audit_timeline` + `audit_ksf` · 种子 `apps/datacore/src/synthetic/battery.ts:198 audit` · 契约 `packages/contracts/src/solvers.ts AuditItemSchema:103 / PlanAuditOutputSchema:112 / RiskCardSchema:69` |
| 复用既有子 PRD | 本文**取代并扩展** `docs/PRD-plan-audit-1to1.md`（结构子 PRD，聚焦时序交互缺口）；其结论已并入本文 §2/§4.5。本文 audit_timeline / KsfGraph 与 `PRD-IND-plan-generate.md` 共用同一引擎（HTML 注释「规划体检 / 规划建议 共用」L4451/4778）。 |
| 不变量 | R14（前端零写死，值来自管线）· R6（同 seed + 同输入字节一致）· R13（每数可溯）· R-一致（时序/KSF/财务口径跨视图同源，体检与产能推演共用逐日 series 引擎）· 1:1=结构/数据/交互 100%，**唯色调/字体可调** |

---

## 1. 视图概述

规划体检 = CEO 输入一份月度计划（需求侧 4 项 / 供给侧 3 项 / 财务侧 3 项 = **10 字段**）→ 系统按本体 + 19 条规则（C01–C23）+ 四平衡求解器**全量扫描** → 三段输出：**硬矛盾 H**（站不住，规则阻断级，不消解不能定稿）· **软风险 M**（可定稿但需关注）· **建议修正 S**（含外部信号触发行动）。诊断结论给评分 0–100 + 总判定 verdict；细分结构反推毛利率上限与产销缺口悬停可溯源；每个 H/M 项可展开**与产能推演 1:1 的逐日圆点时序轴**（不解决会怎样 → 波及订单 + 财务击穿）。底部 **财务计划 KSF 图**（财务指标 ← KSF ← 待解决问题，问题节点点击联动其时序轴）+ **最终修正规划表**（诊断 + 外部信号确定性生成行动计划，含负责人/时间点/规则）。**系统只摆诊断与对策，定稿走 S&OP 议程 + Action 审批（C10/C22）。**

> 与「规划建议（plan-generate）」的分工：体检是**对一份既定计划做矛盾扫描**（输入计划 → 找断点）；建议是**给目标推三个方案**（输入目标 → 摆选项）。两者**共用** timelineFor / probSeqVal 时序引擎 + ksfSVG / KSF_DEF + radarSVG + EXT_SIG 外部信号 + planTableHTML 规划表。

---

## 2. UI 规格（布局 · 像素结构）

### 2.1 整页（`buildAuditView` L4910）
```
┌ rk-top ────────────────────────────────────────────────────┐
│ <h3>规划体检</h3>                                            │
│ rk-sub: "输入你的计划，系统按本体+19 条规则+四平衡求解器 全量 │
│   扫描 → 三段输出：硬矛盾(#DD7E9E) · 软风险(#E8B54A) ·        │
│   建议修正(#62BE77) · {linkRules}每项可追溯到 C01–C23 规则与  │
│   求解器"                                                    │
│ 右侧 rk-hsel: [AI 对话条 aiBar('audit')] [重置输入]          │
└─────────────────────────────────────────────────────────────┘
[AI 对话面板 aiPanelHTML('audit')（折叠，见 §3.6）]
┌ grid: 380px │ 1fr ──────────────────────────────────────────┐
│ 左:rk-det #auditInputBox「输入计划字段」                    │ 右:#auditResult
│   副"基线：2026-07 月度 V7（S&OP 定稿）· 改任意字段即时体检" │ (见 §2.3)
│   3 字段组 × N 行 aud-row                                    │
│   dl-hint: "改任意字段即时重算右侧结果。一键应用…实际工作流  │
│     仍走 S&OP 议程与 Action 审批 (C10/C22)。"                │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 左栏输入面板（`renderAuditInput` L4923）—— 3 组 10 字段
**aud-row** 模板（L4925）：`<span>{label}</span> <input type=number step value onchange=auditSet> <i>{unit}</i>`
| 组 `aud-grp-h` | 字段 label（行内缩进 `  · ` 为细分子项） | key | unit | step |
|---|---|---|---|---|
| **需求侧（万套）** | 月度需求总量 | `dem` | 万套 | 0.1 |
| | `  · 乘用车` | `seg_pas` | 万套 | 0.1 |
| | `  · 储能` | `seg_ess` | 万套 | 0.1 |
| | `  · 商用车` | `seg_com` | 万套 | 0.1 |
| **供给侧** | 月度可供给 | `sup` | 万套 | 0.1 |
| | 长协覆盖率 | `ltaCov` | % | 1 |
| | 正极物料缺口 | `kitGap` | 吨 | 10 |
| **财务侧** | 毛利率目标 | `gmTarget` | % | 0.1 |
| | 现金安全垫(13周最低点) | `cashCushion` | 亿 | 0.5 |
| | CAPEX 本月 | `capex` | 亿 | 0.5 |

### 2.3 右栏结论区（`renderAuditResult` L4947）—— 自上而下 7 块
1. **rk-det 头**「🎯 规划体检结论」副"评分 {d.score}/100 · {H} 硬矛盾 / {M} 软风险 / {S} 建议"。
2. **aud-verdict 判定条**（border/bg = `d.vc66`/`d.vc10`）：`<b color=vc size18>{d.verdict}</b>` + 第二行：
   - 「细分结构反推毛利率上限：**{gmStructPct}%**（乘 {wPas}% / 储 {wEss}% / 商 {wCom}%）」（`provSpan('aud-gmcap')` 悬停溯源，见 §4.5）
   - 「· 产销缺口：**{gap} 万套**」（`provSpan('aud-gap')` 悬停溯源；色 = gap>0.3? `#DD7E9E` : `--quality`）
3. **外部信号条** `aud-sec-h`(色 `#D08A66`)「🌐 外部信号（环境感知 · 已纳入下方诊断）」+ `extStrip()`（8 条 EXT_SIG，悬停溯源，见 §4.7）。
4. **⛔ 站不住的点 ({H})** `aud-sec-h`(色 `#DD7E9E`) + `HBox`：每项 `aud-card hard`：
   - `aud-cd-h`：`<b>⛔ {title}</b>` + `{rule?linkRules(rule)}`（规则徽章）
   - `aud-cd-m`：`{why}`（含代入数值的长文）
   - `{fix? aud-fix 按钮}`：「一键应用：{fix.label}」（onclick `applyAuditFix(fix.action)`）
   - `tlBlock(x)`：仅当 `AUDIT_KIND[x.id]` 存在 → 「⏱ 时序推演（不解决会怎样 → 波及订单与财务指标）」可点开（见 §2.4）
5. **⚠ 风险点 ({M})** `aud-sec-h`(色 `#E8B54A`) + `MBox`：`aud-card med`（结构同 hard，但**无 fix 按钮**，有 tlBlock）。
6. **💡 建议修正 ({S})** `aud-sec-h`(色 `#62BE77`) + `SBox`：`aud-card sug`：`<b>💡 {title}</b>` + `aud-cd-m {detail}`（**无 rule 徽章、无 fix、无 tlBlock**）。
   - 三段全空 → dl-hint「全部通过。可走 Action 进 S&OP 定稿流程（C10/C22）。」
7. **🗺 财务计划 KSF 图**（`ksf` 块，仅 `probs.length>0` 时显示，见 §2.5）。
8. **📋 规划修正 · 最终方案与行动计划**（`planTableHTML('auditPlan',…)` + `buildAuditPlanRows`，见 §2.6）。

### 2.4 时序推演展开（`tlBlock` L4949 + `probSeqHTML` L4481）—— 1:1 逐日圆点轴
点击 `aud-tl-t`（"⏱ 时序推演…" / "▼ 收起时序推演"）→ 渲染 `probSeqHTML(kind, ctx, 'aud-'+x.id)`：
```
┌ ptl-h: "⏱ 风险传播时序（与产能推演同一交互：悬停任意日点看当日传导、阶段事件与受影响订单）"
├ rk-tl:
│   dateAxis(90): rk-ticks 行 —— d=1..90，每格 rk-tick；d===1||d%5===0||d===90 显 MM-DD，否则空
│   rk-frow:
│     rk-flab: <b color=riskColor(peak)>问题传导度</b>
│              <span>{cur}→{peak} · {cross? 'T+'+cross+' '+dateOf(cross)+' 越线' : '窗口内不越线'}</span>
│     rk-dots: 90 × <span class="rk-dot" style="background:riskColor(v)"
│                     onmouseenter="probDayTip(uid,d,event)" onmouseleave="hideDayTip()">
└ rk-leg: <i #62BE77><70 正常 · <i #D2B04C>70-84 关注 · <i #DD7E9E>≥85 越线
          · "未来 90 天（{dateOf(1)} ~ {dateOf(90)}）{maxDd>90? ' · 远期阶段已压缩入轴':''}"
```
- 展开后 `setTimeout` 60ms `scrollIntoView({behavior:'smooth',block:'center'})` 到 `#audtl-{id}`（L4945）。
- 一次只展开一个：`auditTlOpen` 单值，再点同项收起（L4944）。

### 2.5 财务计划 KSF 图（`ksfSVG` L4415）—— 3 层有向图
```
rk-det「🗺 财务计划 KSF 图（关键成功要素）」副"财务指标 ← KSF ← 待解决问题 · 问题节点可点 → 联动时序推演"
ksf-wrap: <svg viewBox 0 0 1080 H>  (H = 26 + 3×86 + 8 = 292)
  顶层 fins(3):    收入/产销 · 毛利率目标 · 现金安全垫 —— rect 填 #9D8BF014 描边 #9D8BF0，角标"财务计划"
  中层 usedK(5):   KSF_DEF 全列 —— rect 填 #54B5C414 描边 #54B5C4，角标"KSF"
  底层 probs(H+M): 诊断问题 —— rect 填 {sev=='H'?#DD7E9E:#E8B54A}10，角标"待解决问题"，
                   副文案"点击展开时序推演 ⏱"，onclick=auditToggleTl('{id}')，cursor:pointer
  边 ed:
    KSF→fin:   实线 stroke #54B5C4 width1.3 opacity.55 marker-end ksfar（支撑）
    prob→KSF:  虚线 stroke #DD7E9E width1.4 dasharray"5 3" opacity.7 marker-end ksfar（威胁）
ksf-note: 读法："底层待解决问题(虚线=威胁) → 中层KSF(实线=支撑) → 顶层财务计划指标。点任一问题节点展开其时序传播推演。"
```
- 布局：每层 `g=W/(arr.length+1)`，节点 x=`g*(i+1)`，y=`26 + L*86`；宽 `min(L===2?190:200, g-12)`；NH=44。
- 问题标题 >16 字截断为 `slice(0,15)+'…'`（L4443）。

### 2.6 最终修正规划表（`planTableHTML` L3402 + `buildAuditPlanRows` L3426）
```
rk-det「📋 规划修正 · 最终方案与行动计划」副"由 {H+M} 项诊断 + 外部信号确定性生成 · 含时间点与负责人　[⬇ 导出最终规划]"
table.cmp 列: # | 行动项 | 负责人 | 启动 | 完成 | 预期效果 | 依据/规则
  行动项: <b>{act}</b><br><span 小字>{det}</span>
  预期效果: color=--quality
  依据/规则: linkRules(rule)
dl-hint: "行动项按启动时间排序；采纳后经 C10 审批留痕下发为 Action/工单。导出含口径与时间戳…"
```
**行集 = 条件触发并集**（`buildAuditPlanRows`，`has(id)=H∪M 含 id`）：见 §4.6 完整 11 行映射表。

---

## 3. UX 规格（交互 · 状态 · 流）

| # | 交互 | 触发 | 行为 |
|---|---|---|---|
| 1 | 改字段值 | aud-row input onchange `auditSet(k,v)` L4811 | 写 `auditIn[k]=parseFloat(v)||0` → **renderAuditResult 即时重算右侧**（不重建左侧面板）。系统侧 debounce 300ms，竞态最后发出者胜（useLiveSolver） |
| 2 | 重置输入 | "重置输入" `auditReset()` L4812 | `auditIn = AUDIT_PRESETS['V7']` 拷贝 → buildAuditView 重建。系统：回填 `baseline.data.input`（PlanAuditView.tsx:110） |
| 3 | 一键应用 fix | aud-fix 按钮 `applyAuditFix(action)` L4900 | 按 action 改 auditIn 对应字段（rescaleSeg/addNightShift/fitGM/addRushBuy/cutCapex）→ 重算。系统：`setForm({...form, ...item.fix.patch})`（PlanAuditView.tsx:94，需 feature `act.plan-audit.apply-fix`） |
| 4 | 展开/收起时序 | aud-tl-t onclick `auditToggleTl(id)` L4944 | `auditTlOpen = (==id? null : id)` → 重渲染 + 60ms 平滑滚到 `#audtl-{id}`；一次只一个展开 |
| 5 | 悬停时序日点 | rk-dot onmouseenter `probDayTip(uid,d,ev)` L4464 | 浮层 `#rkTip`：`{dateOf(d)}（T+d）· 问题传导度 {v}`（色 riskColor(v)）+ 就近阶段事件（`probStageNear`，`|sd−d|≤5`）+ 受影响订单表（≤4 行：订单/客户/数量/交期/影响；影响=`v≥85?'传导命中':'关注'`）；离开 `hideDayTip()` L2530 |
| 6 | KSF 问题节点点击 | svg `<g onclick="auditToggleTl('{id}')">` L4441 | 展开该问题对应 H/M 卡的时序轴（联动 §2.4），并滚动定位 |
| 7 | 悬停溯源 span | provSpan onmouseenter `provTip(id,ev)` L4762 | 浮层：标题+值+来源+新鲜度+推导公式+输入因子+关联规则（毛利率上限 / 产销缺口 / 外部信号各条） |
| 8 | 导出规划 | tier-chip `exportPlanTable('auditPlan')` L3410 | 生成独立 HTML（含口径/时间戳）下载 |
| 9 | AI 对话 | `aiBar('audit')` / `aiToggle('audit')` L3460 | 展开预设 QA（§3.6），答案取实时 runAuditDiag 数据 |

### 3.1 verdict 状态机（`runAuditDiag` L4893–4897，4 态，**系统当前仅 3 态——须扩**）
| 条件 | verdict | vc 色 |
|---|---|---|
| `H.length>0` | 站不住 | `#DD7E9E` |
| `H==0 && M>=3` | 可定稿但有重要风险 | `#E8B54A` |
| `H==0 && 0<M<3` | 可定稿 · 关注 {M} 项风险 | `#54B5C4` |
| `H==0 && M==0` | 全部通过 · 可直接定稿 | `#62BE77` |

### 3.2 评分（L4892）：`score = max(0, 100 − 22×|H| − 7×|M|)`（**系统当前 25/8——须改为 22/7**）。

### 3.3 时序日点确定性（`probSeqVal` L4453）
- 阶段锚点：`anchors = [[0,58]] ++ stages.map(st => [st._sd, SEV_V[sev](+bump)])`，`SEV_V={0:64,1:79,2:90}`，sev===2 时 `v+=bump; bump+=3`（多个击穿阶段递增）。
- 逐日值：分段线性插值（`d<=an[0]`→首值，`d>=末`→末值，否则两锚点间线性）+ 微抖动 `hashN(uid+'#'+d, 5)−2` + `clamp[40,97]` + round。
- 远期压缩：`maxDd = max(st.dd)`，若 `maxDd>90` 则 `k=(90-4)/maxDd`，`st._sd = max(1, round(st.dd*k))`（年末/次年阶段压进 90 天轴，L4484）。
- `riskColor(v) = v>=85?#DD7E9E : v>=70?#D2B04C : #62BE77`（L1632）。
- `hashN(s,mod)`：`x=0; for c in s: x=(x*31+code)%997; return x%mod`（L1605，确定性，R6）。
- `dateOf(d)`：`T0 + d 天`，`T0='2026-06-10'`（L1584/1636），返回 `MM-DD`。

### 3.6 AI 预设 QA（`aiDef('audit')` L3478，④i18n，答案取实时 d=runAuditDiag）
| 问题 | 答案逻辑 |
|---|---|
| 我的计划站得住吗？ | `<b color=vc>{verdict}</b>（评分 {score}/100）：{H} 项硬矛盾、{M} 项软风险。{H?'硬矛盾不消解不能定稿…':'无阻断项。'}` |
| 最大的硬矛盾是什么？ | `H[0]? '<b>{H[0].title}</b>：{H[0].why}' : '当前无硬矛盾；最需关注软风险：{M[0]?.title}'` |
| 怎么修最快？ | 有 fix 的 H 按序「{fix.label}」→…；否则「无需修正，可走 C10/C22 定稿」 |
| 改哪个数影响最大？ | 「①储能占比（每 +1pct 结构毛利约 −0.05pct）②可供给（直接决定缺口与 X02）③现金安全垫（<50 即 C18 阻断）」 |
| 自由追问 free(t) | 正则路由：`/缺口/`→产销缺口口径；`/毛利/`→目标 vs 上限自洽判定；`/现金/`→现金垫 vs 红线；`/齐套|物料|正极/`→正极缺口 vs 长协覆盖（>800 触发 C06 冻结） |

---

## 4. 数据规格（值 + 来源 + 系统字段级落地）
> 前端**零写死**（R14）；每个数据分类：①合成种子→物化 ②阈值→config/种子参数 ③公式→求解器 ④文案→i18n ⑤结构→ViewDef。

### 4.1 输入字段集 `AUDIT_FIELDS`（⑤ViewDef · `view.layout.fieldGroups`，系统已支持兜底）
即 §2.2 三组 10 字段；前端 `FIELD_GROUPS`（PlanAuditView.tsx:22）仅兜底，权威来自 `ViewConfig.layout.fieldGroups`。

### 4.2 基线预设 `AUDIT_PRESETS`（①AOP 派生种子 · `plan-versions/current`）
| 预设 | dem | seg_pas | seg_ess | seg_com | gmTarget | sup | ltaCov | kitGap | cashCushion | capex | note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **V7**（默认基线）| 132 | 71 | 49 | 12 | 16.0 | 131.2 | 92 | 654 | 58 | 0 | 2026-07 月度 V7（S&OP 定稿基线）|
| AOP | 1580/12≈131.67 | 79 | 43 | 10 | 17.0 | 130 | 80 | 0 | 62 | 14 | 2027 年度基准情景（年化均摊）|
| CEO | 140 | 72 | 56 | 12 | 17.5 | 131.2 | 80 | 1200 | 48 | 8 | CEO 直球：再加 10% 量 + 抬 1.5pct 毛利率 + 现金更紧 |
- 系统基线经 `GET /a/v1/plan-versions/current`（sop.ts:416，返回 `{versionId, versionLabel, input}`），`versionLabel="2026-07 V7"`。**须使 input 字段值与 V7 预设逐一对齐**（见 §4.5）。

### 4.3 诊断常量 `t = params.audit`（②config · battery.ts:198，系统已有）
| 常量 | HTML 值 | 系统现值 (battery.ts) | 一致? |
|---|---|---|---|
| segTolerance（细分自洽容差）| 0.5 万套（L4818 `>0.5`）| `0.5` | ✓ |
| gapHard | 2 万套（L4825 `>2`）| `2` | ✓ |
| gapSoft | 0.3 万套（L4829 `>0.3`）| `0.3` | ✓ |
| gmHardOver | +0.3pct（L4836 `>gmStructPct+0.3`）| `0.3` | ✓ |
| gmSoftUnder | 0.5pct（L4840 `>gmStructPct−0.5`）| `0.5` | ✓ |
| kitHard | 800 吨（L4845 `>800`）| `800` | ✓ |
| kitFixTons | 200 吨（fix）| `200` | ✓ |
| cashHard | 50 亿（L4854 `<50`）| `50` | ✓ |
| cashSoft | 55 亿（L4858 `<55`）| `55` | ✓ |
| **essShareBaseline** | **49/132 ≈ 0.371**（L4863 `baseEss=49/132`）| **`0.32`** | **✗ 须改** |
| essShareTol | 0.05（L4864 `>0.05`）| `0.05` | ✓ |
| capexSoft | 10 亿（L4869 `>=10`）| `10` | ✓ |
| segMargins | 乘 0.18 / 储 0.13 / 商 0.15（`SEG_MARGIN` L2380，pct=18/13/15）| `{pas:18,ess:13,com:15}` | ✓ |
| **scoreH** | **22**（L4892）| **`25`** | **✗ 须改** |
| **scoreM** | **7**（L4892）| **`8`** | **✗ 须改** |
| passScore / condScore | （HTML 用 verdict 状态机，非分数阈值）| `85 / 60` | 须改为 verdict 状态机（§3.1）|

### 4.4 诊断求解器口径（③`runAuditDiag` L4813 ↔ `planAudit` plan.ts:41，确定性 R6）
- 派生：`segTot=seg_pas+seg_ess+seg_com`；`wPas/wEss/wCom = seg_x/segTot`（**注意：HTML 权重分母是 `segTot`，系统 plan.ts:84 用 `input.dem`——口径不同，须统一为 `segTot`**）；`gmStruct = wPas×18 + wEss×13 + wCom×15`（%）；`gap = dem − sup`。
- **诊断项全集**（id / 级别 / rule / 阈值，HTML L4813–4890）：

| id | 触发条件 | H/M | rule | kind (AUDIT_KIND) | fix.action |
|---|---|---|---|---|---|
| X01 | `\|segTot−dem\|>0.5` | H | — | struct | rescaleSeg |
| X02 | `gap>2` / `0.3<gap≤2` | H / M | — | gap | addNightShift（仅 H 有 fix）|
| X03 | `gmTarget>gmStructPct+0.3` / `>gmStructPct−0.5` | H / M | C15 | margin | fitGM（仅 H）|
| X04 | `kitGap>800` / `kitGap>0` | H / M | C06 / C16 | kit | addRushBuy（仅 H）|
| X05 | `cashCushion<50` / `<55` | H / M | C18 | cash | cutCapex（仅 H）|
| R01 | `\|wEss−49/132\|>0.05` | M | C21 | margin | — |
| R02 | `capex>=10` | M | C23 | capex23 | — |
| **E01** | `gmStructPct−gmTarget<1.2`（碳酸锂上行挤压缓冲）| M | C24 | margin | — |
| **E02** | `dem>=130`（终端上险低于假设）| M | C25 | gap | — |
| **E03** | 恒成立（重点客户负面舆情）| M | C13 | cash | — |
- **建议修正 S[]**（HTML L4874–4890）：`if(H.length)` 推「消解硬矛盾后再定稿」；`if(dem>135)` 推「量增高于 S&OP 共识，需求评审重开」；`if(gmStructPct>=gmTarget+0.5 && diff<2)` 推「毛利率有可提升空间」；恒推「欧盟电池法碳足迹」「四川迎峰度夏限电预案」两条外部建议（无 rule/无 tlBlock）。**系统当前 S[] 仅机械复制 fix——须改为上述条件逻辑。**
- `AUDIT_KIND` 映射（L4942，**只有这些 id 才出时序轴**）：`{X01:'struct', X02:'gap', X03:'margin', X04:'kit', X05:'cash', R01:'margin', R02:'capex23', E01:'margin', E02:'gap', E03:'cash'}`。
- 时序上下文 `auditTlCtx(x,p,d)` L4946：`{gap:d.gap, kitGap:p.kitGap, cash:p.cashCushion, capex:p.capex}`。

### 4.5 ★系统字段级落地（现状 → 须改/须加，精确）

**A · 诊断求解器 `planAudit`（plan.ts:41）**
1. **权重分母**：plan.ts:84 用 `input.dem`，HTML L4816 用 `segTot`。统一为 `segTot=seg_pas+seg_ess+seg_com`（否则 X01 不自洽时 gmStruct 失真）。
2. **改 3 个种子常量**（battery.ts:208/212/213）：`essShareBaseline 0.32→49/132(≈0.3712)`、`scoreH 25→22`、`scoreM 8→7`。
3. **verdict 4 态**：plan.ts:183 现为 `score≥85?通过:score≥60?有条件通过:不通过`（3 态、按分数）。改为 §3.1 状态机（按 H/M 计数，4 态文案：站不住 / 可定稿但有重要风险 / 可定稿·关注 N 项风险 / 全部通过·可直接定稿）。**契约 `verdict` 枚举须同步扩**（solvers.ts:117）。
4. **加 E01–E03 外部信号诊断项**（plan.ts，按 §4.4 条件追加到 M[]），引用 EXT_SIG（C24/C25/C13）。
5. **S[] 条件化**：按 §4.4 三条 + 两条外部建议生成（非机械复制 fix）。
6. **每项打 kind**：`AuditItem` 加 `kind`（plan.ts 给 X01–X05/R01–R02/E01–E03 按 AUDIT_KIND 赋值）。
7. **why 文案对齐**：plan.ts 现 why 文案（"三细分合计…超过容差"）与 HTML（"乘用车 X + 储能 Y + 商用车 Z = … 与总需求 … 不一致（差 …）"）不同——**改为 HTML 逐字文案**（含代入数值），④i18n。
8. **fix.action ↔ patch**：HTML 用 action 名（rescaleSeg…），系统用 patch（已对齐：rescaleSeg=比例缩放细分、addNightShift=sup+gap、fitGM=gmTarget→gmStruct、addRushBuy=kitGap−200、cutCapex=capex 缩减+cashCushion 回补）。保留 patch 形态，label 改为 HTML 文案。

**B · 契约 `solvers.ts`**
- `AuditItemSchema`（:103）加 `kind: z.enum(['gap','margin','kit','cash','share','ramp','outsource','capex23','struct']).optional()` + `detail: z.string().optional()`（S[] 用 detail 非 why）。
- `PlanAuditOutputSchema`（:112）加 `gmStructPct/gap/wPas/wEss/wCom`（已有 gmStruct，补 wPas/wEss/wCom 供溯源面板）；`verdict` 枚举改 §3.1 四值。
- 新增 `AuditTimelineOutputSchema`（series/stages/peak/crossDay/affectedOrders/cur）+ `AuditKsfOutputSchema`（fins/ksfNodes/problems/edges）+ `AuditPlanRowsSchema`（act/det/owner/start/done/eff/rule）。

**C · 时序求解器 —— 关键缺口（PRD-plan-audit-1to1 §2 已定位）**
- **现状**：后端 `risk_timeline`（risk.ts:185）**已产出逐日 `series[]`+events+crossDay+affectedOrders**（契约 RiskCardSchema:69 已含）；但前端 `PropagationTimeline.tsx:45 buildPropagation` **丢弃 series**，仅用 events/crossDay/affectedOrders 渲染 **4 节点横向 stepper**（PropagationTimeline.tsx:102）。`RiskPropagation`（PlanAuditView.tsx:310）对所有 item 调 `risk_timeline({})` 拿同一 `cards[0]`——**所有项共用一条通用曲线，且无 kind 路由**。
- **须新增 `audit_timeline` 求解器**：入参 `{kind, ctx:{gap,kitGap,cash,capex}}` → 按 HTML `timelineFor(kind)`（§4.5-D 9 kind × 4 阶段）+ `probSeqVal`（阶段锚点分段线性 + hashN 抖动 + clamp[40,97] + 远期压缩）输出 `{series:number[90], stages, peak, crossDay, cur, affectedOrders}`。复用 risk.ts 的 `affectedOrders`（risk.ts:275）+ 同 `hashN`（须确保前后端 hashN 字节一致：`x=(x*31+code)%997; x%mod`）。注册 `SOLVER_KEYS` + chain:check 输出形状。
- **须重写 `PropagationTimeline.tsx`**：消费 `series[]` → 逐日圆点轴（90 × Dot 背景 riskColor）+ `<DateAxis>`（首/尾/每 5 日 MM-DD）+ 三档图例条 + 顶部摘要（`cur→peak · T+cross 越线`）+ `<DayTip>`（悬停日点：当日 `日期·T+d·传导度` + 就近阶段事件 `|sd−d|≤5` + 受影响订单表 ≤4 行）。**与 RiskBoardView 逐日交互共用同一组件**（R-一致）。4 节点 stepper 降级为「概览」折叠项或删除。
- **前端 `RiskPropagation`** 改为 `runSolver('audit_timeline', { kind: item.kind, ctx })`（不再 `risk_timeline({})` 空参拿 cards[0]）。

**D · 9 kind 时序口径 `timelineFor`（L4342–4404，③求解器 + ④i18n，逐字录）**
每 kind 4 阶段 `{w(周标), d(MM-DD), dd(天偏移), t(标题), m(描述), orders?, fin?(财务文案), sev(0/1/2)}`：

| kind | 阶段 dd / sev（关键数字逐字见 HTML 行）|
|---|---|
| `gap` (L4347) | T+0/0(s0 缺口潜伏)·12/1(检修窗叠加, 86→92 越线)·26/2(集中爆发)·40/2(财务击穿 收入 103%→99% 毛利 −0.3pct)；ctx.gap |
| `margin` (L4354) | 0/0(结构侵蚀 单均毛利13%)·18/1(集中交付 占比40%+)·40/2(逼近底线 缓冲<0.3pct)·75/2(击穿 C15 季度毛利−1.2亿)|
| `kit` (L4360) | 0/0(缺口确认 {ctx.kitGap}吨)·11/1(到货间隙 覆盖降至2天)·20/2(C06 冻结 周供给−1.5万套)·34/2(双损 材料+6% 毛利−0.4pct)|
| `cash` (L4367) | 0/0(起点 {ctx.cash}亿)·wk−3/1(支付高峰)·wk/2(击穿50亿 C18 阻断)·wk+3/2(被动融资 财务费用+0.4亿/季)；`wk=max(2,round((cash−50)/2)+2)` |
| `share` (L4374) | 0/0(退单 毛利+1.4pct)·28/1(转单确认)·75/2(框架重谈 −2~3%)·180/2(份额+6%不达·守价瓦解)|
| `ramp` (L4380) | 0/0(理论爬坡)·20/1(认证延期 60% vs 70%)·42/2(累缺6万套)·63/2(外协兜底 毛利−0.4pct C08)|
| `outsource` (L4386) | 0/0(占比12%)·21/1(12%→18%)·35/2(触C08红线 不良+1.5pct)·56/2(封顶·商誉受损)|
| `capex23` (L4392) | 0/0(未过C23即写入 {ctx.capex}亿)·14/1(被退回 延误2–4周)·42/2(动工窗口错过)·200/2(产能缺口兑现 AOP下修)|
| `struct` (L4397) | 0/0(口径不一致)·12/1(排产冲突 MRP错配)·26/2(交付库存双错)·30/2(三线无法勾稽)|
- `tlOrders(filter,fromD,toD,max)` L4328：从 ORDERS 按交期窗口 + 业务条件确定性筛选（命中为空回退窗口内交期最近单），与台账 ordFull 同源；前端用 affectedOrders 窗口 `[d−7, d+12]`。

**E · 前端组件复用**
- `<RadarChart>`（plan-generate 已建，radarSVG L4594）—— 体检本视图**不直接用雷达**（无五维评分），仅 plan-generate 用；保留共享。
- `<KsfGraph>`（新建，ksfSVG L4415）—— 体检与 plan-generate **共用**；入参 `{fins, ksfNodes, problems, edges, onProblemClick}`。
- `<PropagationTimeline>` / `<DayTip>` / `<DateAxis>` —— 与 RiskBoard 共用。

### 4.6 最终修正规划表 `buildAuditPlanRows`（L3426，③确定性映射，逐字录）—— 11 条条件行
`has(id) = (H∪M).some(x=>x.id===id)`；`dateOf(n)` 同 §3.3。每行 `{act, det, owner, start, done, eff, rule}`：

| 触发条件 | act（行动项）| owner | start / done | eff（预期效果）| rule |
|---|---|---|---|---|---|
| `has(X01)` | 统一需求口径：细分之和=总需求 | S&OP 计划中心 | T+1·dateOf(1) / T+2·dateOf(2) | 消除排产/MRP 双口径错配 | C10 |
| `has(X02) \|\| gap>0.3` | 采纳供给决议：常州化成加 2 夜班 + 江门正极加急 200 吨 | 常州/江门基地 + 计划中心 | T+1·dateOf(1) / T+7·dateOf(7) | 产销缺口 {gap} → ≤0.3 万套 | C02 / C05 |
| `has(X03) \|\| has(R01)` | 细分结构修正：储能占比 −4pct 或储能报价 +2~3% | 销售管理部 + S&OP | 本周评审·dateOf(3) / 月末·dateOf(20) | 毛利目标恢复自洽（缓冲 ≥0.5pct）| C15 |
| `has(X04) \|\| kitGap>400` | 正极保供双轨：长协追量 + 现货锁价 {kitGap} 吨 | 采购部 / SRM | T+1·dateOf(1) / T+5·dateOf(5) | 到货覆盖 ≥5 天，解除 C06 冻结风险 | C06 / C16 |
| `has(X05) \|\| cashCushion<55` | 现金垫修复：CAPEX 分两期 + 冲量客户账期管控 | 财务部 + 投资委 | T+3·dateOf(3) / T+14·dateOf(14) | 13 周最低点回升至 ≥52 亿 | C18 |
| `has(R02)` | 补 CAPEX 门槛测算（IRR / 24月利用率）| 投资委 + 战略部 | T+3·dateOf(3) / T+10·dateOf(10) | 解除 C23 阻断，计划可定稿 | C23 |
| `has(E01)` | 碳酸锂锁价对冲：长协比例上调 + 期货套保 30% | 采购部 + 财务部 | T+2·dateOf(2) / T+7·dateOf(7) | BOM 成本波动敞口 −60%，护住毛利缓冲 | C24 |
| `has(E02)` | 需求重审会：对照上险数据下修 P50 区间 | S&OP 需求评审 | 本周五·dateOf(4) / 当日 | 需求侧虚高消除，库存风险前置规避 | C25 / C21 |
| **恒**（L3437）| 信用动态复核：储能集成商D 额度下调 + 预付条款 | 财务信用管理 | T+1·dateOf(1) / T+3·dateOf(3) | 在手单 SO-3452 应收风险受控 | C13 |
| **恒**（L3438）| 欧盟碳足迹护照项目启动 | 质量/合规 + 海外销售 | T+30·dateOf(30) / 2026-Q4 | 海外订单合规无断点 | 政策触发项 |
| **恒**（L3439）| 川区限电预案：供给口径加电力折减 + 检修错峰 | 基地运营 + 计划中心 | T+14·dateOf(14) / 6 月底 | 供给口径真实化，避免旺季被动 | C02 |
> **系统当前完全缺此表**——须新增 `audit_plan_rows`（求解器或随 plan_audit 输出 `planRows[]`）+ 前端 `planTableHTML` 等价表组件 + 导出。det/owner 等长文 ④i18n。

### 4.7 KSF 数据资产（②结构 + ④i18n，逐字录）
- **fins**（3，L4967，财务指标，值取实时输入）：`f_rev 收入/产销`（"需求 {dem} · 供给 {sup} 万套"）· `f_gm 毛利率目标`（"{gmTarget}%（结构上限 {gmStructPct}%）"）· `f_cash 现金安全垫`（"{cashCushion} 亿（红线 50）"）。
- **KSF_DEF**（5，L4407，全列）：`k_dem 需求结构管控`(细分占比·接单毛利线→f_gm,f_rev)· `k_bal 产销平衡与爬坡`(瓶颈·检修错峰·爬坡校准→f_rev,f_gm)· `k_kit 物料齐套保障`(长协锁量·现货对冲→f_rev,f_gm)· `k_cash 信用与现金管控`(应收账期·CAPEX节奏→f_cash)· `k_cost 成本与外协管控`(降本·C08红线·质量→f_gm)。
- **KIND_KSF**（L4414，问题 kind → KSF）：`{gap:k_bal, margin:k_dem, kit:k_kit, cash:k_cash, share:k_dem, ramp:k_bal, outsource:k_cost, capex23:k_cash, struct:k_bal}`。
- **probs**（L4972）：`H ++ M`，每项 `{id, n:title, kind:AUDIT_KIND[id]||'gap', sev:'H'|'M'}`。

### 4.8 外部信号 `EXT_SIG`（8 条，L4781，①种子 + ④i18n + ②色，`extStrip` L4798 渲染 + 悬停溯源）
逐字录（id / k 名 / v 值 / d 描述 / sev / src / tag / impact）：`lith 碳酸锂(电池级) 8.6万/吨 周+4.2%·月+9.8% s1 行情数据/SMM 大宗` · `foil 铜箔加工费 1.95万/吨 持平 s0` · `oem 主机厂上险(终端) +11%YoY 低于假设+16% s1 上险/乘联会 终端` · `senti 客户舆情 储能集成商D·负面2条 拖欠传闻 s2 舆情监测 舆情` · `eu 欧盟电池法 碳足迹2027-02 s1 政策法规库 政策` · `fx 汇率/海运 USD/CNY7.18·SCFI周+6% s0 汇率/运价指数 汇率` · `power 区域电力(四川) 迎峰度夏限电 s1 政策法规库 电力` · `comp 竞争动态 二线储能报价−6% 利用率71% s1 行情数据/SMM 竞争`。色：`sev2→#DD7E9E / sev1→#E8B54A / sev0→#62BE77`。悬停溯源含 impact + 自动抽取的 `C\d{2}` 规则。
> **系统当前 plan-audit 无外部信号条**——须接 `POST /a/v1/external-signals` 或随 plan_audit 输出 `extSignals[]`；与 plan-generate 共用同一 EXT_SIG 种子。

---

## 5. 契约 / 端点

- `contracts/solvers.ts`：
  - `AuditItemSchema`（:103）加 `kind?`（9 枚举）+ `detail?`；`PlanAuditOutputSchema`（:112）加 `gmStructPct/gap/wPas/wEss/wCom`，`verdict` 枚举改 4 值（§3.1）。
  - 新增 `AuditTimelineOutputSchema` `{series:number[], stages:[{w,d,dd,t,m,orders?,fin?,sev}], peak, crossDay, cur, affectedOrders}`。
  - 新增 `AuditKsfOutputSchema` `{fins:[{id,n,v}], ksfNodes:KSF_DEF, problems:[{id,n,kind,sev}], edges:[{from,to,type:'support'|'threat'}]}`。
  - 新增 `AuditPlanRowsSchema` `[{act,det,owner,start,done,eff,rule}]`。
  - `RiskCardSchema.series`（:74）已在——前端须开始消费。
- 端点：
  - `POST /a/v1/solvers/plan_audit/invoke`（useLiveSolver 即时重检，纯读）。
  - `POST /a/v1/solvers/audit_timeline/invoke`（入参 `{kind, ctx}`）。
  - `POST /a/v1/solvers/audit_ksf/invoke` 或随 plan_audit 输出 `ksf`。
  - `POST /a/v1/solvers/audit_plan_rows/invoke` 或随 plan_audit 输出 `planRows`。
  - `GET /a/v1/plan-versions/current`（sop.ts:416，基线，已在）。
  - `POST /a/v1/action-drafts`（一键应用 / 采纳，feature `act.plan-audit.apply-fix` / `act.adopt-to-draft`）。
  - 复用 `POST /a/v1/external-signals`（EXT_SIG，与 plan-generate 共用）。

---

## 6. 融合集成点（6 处，不绕过）

1. **Renderer** `registry.ts:44`（`plan-audit` → PlanAuditView）—— 复用，不新建。
2. **ViewDef** `service.ts`（`view.layout.fieldGroups` 声明 10 字段三组；R14）。
3. **Feature** `features.ts`（`view.plan-audit`、`act.plan-audit.apply-fix`、`act.adopt-to-draft`）。
4. **导航** ShellLayout（推演组）。
5. **场景启动器** `battery.ts:772 scenarioSeed.views` 已含 `plan-audit`。
6. **共用引擎**（R-一致）：`audit_timeline` 复用 risk.ts series 引擎 + affectedOrders；`<PropagationTimeline>/<DayTip>` 复用 RiskBoardView；`<KsfGraph>` 复用到 plan-generate；EXT_SIG 复用到 plan-generate。**增强现有组件，不重建。**

---

## 7. 验收（DoD = 真 1:1，色/字可调）

- **像素核对**（与 HTML audit 页并排，逐元素勾）：10 字段三组输入 / 4 态 verdict + 评分 / 毛利率上限 + 产销缺口悬停溯源 / 外部信号 8 条条带 / H·M·S 三段卡（含 fix 按钮 / rule 徽章 / why 文案）/ **逐日圆点时序轴**（90 dot + 日期刻度 + 三档图例 + 顶部摘要 + 悬停日点详情）/ 每项按 kind 出各自时序（9 kind 口径，非共用一条）/ KSF 三层图（问题点击联动）/ 最终修正规划表 11 条件行 + 导出。漏一项不过。
- **关键缺口闭合**（G-2 类接缝）：`PropagationTimeline` 不再 4 节点 stepper、不再丢弃 series、不再 `risk_timeline({})` 空参共用 cards[0]——**逐日轴消费 series + 按 item.kind 路由 audit_timeline**。
- **交互**（FDE 亲手跑）：改字段即时重检 · 一键应用 fix 即时降级 · 展开/收起时序滚动定位 · 悬停逐日点出浮层（当日传导度/事件/受影响订单）· KSF 问题节点点击联动该项时序 · 溯源悬停 · 导出规划。
- **数据**：前端零写死（`debattery:check`）；种子常量 = HTML 精确（essShareBaseline=49/132、scoreH=22、scoreM=7、verdict 4 态、权重分母=segTot）；同 seed + 同输入字节一致（R6，含 hashN 前后端一致）；每数可溯（R13）。
- `pnpm -r build && pnpm -r test` 全绿（audit_timeline / audit_ksf / planRows / 逐日时序组件回归）；`chain:check`（plan_audit/audit_timeline 注册 + 输出形状）/ `ontology:check` 过。
- 回写本体 §2.E：`AuditItem.kind` + E01–E03 诊断项 + verdict 4 态 + audit_timeline / audit_ksf / audit_plan_rows 输出 schema + KSF_DEF/KIND_KSF/AUDIT_KIND/timelineFor/EXT_SIG 种子；链路 `plan_audit(诊断+kind) → audit_timeline(逐日 series) → 逐日圆点轴 + KSF 联动`。

---

## 8. 实施任务（研发可直接拆）

1. **种子**（battery.ts:198）：改 `essShareBaseline 0.32→49/132`、`scoreH 25→22`、`scoreM 8→7`；加 KSF_DEF / KIND_KSF / AUDIT_KIND / timelineFor 9 kind 阶段 / EXT_SIG 8 条 / AUDIT_PRESETS（使 plan-versions/current 的 V7 input 与预设逐一对齐）/ buildAuditPlanRows 文案。
2. **契约**（solvers.ts）：`AuditItemSchema` 加 kind?/detail?；`PlanAuditOutputSchema` 加 gmStructPct/gap/wPas/wEss/wCom + verdict 4 值；新增 AuditTimelineOutputSchema / AuditKsfOutputSchema / AuditPlanRowsSchema。
3. **诊断求解器**（plan.ts:41）：权重分母改 segTot；verdict 4 态状态机；加 E01–E03；S[] 条件化；每项打 kind；why/label 文案对齐 HTML；输出 gmStructPct/wPas/wEss/wCom + ksf + planRows。
4. **时序求解器**：新增 `audit_timeline({kind,ctx})`，按 timelineFor + probSeqVal（前后端 hashN 一致）输出 series/stages/peak/crossDay/cur/affectedOrders；复用 risk.ts affectedOrders；注册 SOLVER_KEYS。
5. **前端 PropagationTimeline 重写**（PropagationTimeline.tsx）：消费 series → 逐日圆点轴 + DateAxis + 三档图例 + 顶部摘要 + DayTip（悬停日点详情）；与 RiskBoard 共用组件；4 节点降级为概览。
6. **前端 PlanAuditView 补全**（PlanAuditView.tsx）：verdict 4 态 + 毛利率上限/产销缺口溯源 + 外部信号条 extStrip + RiskPropagation 改 `audit_timeline({kind:item.kind})` + KsfGraph（问题点击联动）+ 最终修正规划表 + 导出。
7. **前端组件**：新增 `<KsfGraph>`（ksfSVG，复用 plan-generate）；`<DateAxis>/<DayTip>` 提取为 RiskBoard 共用。
8. **i18n**：timelineFor 阶段文案 / KSF_DEF / EXT_SIG impact / buildAuditPlanRows det·owner·eff / verdict 4 态 / why 逐字入 locales。

> 本文与 `PRD-IND-plan-generate.md` 同为工业级样板，**共用** audit_timeline / KsfGraph / radarSVG / EXT_SIG / planTableHTML 引擎。先做任务 4–5（最快见效：后端 series 已在，前端不消费是主断点），再补 KSF 与规划表。
