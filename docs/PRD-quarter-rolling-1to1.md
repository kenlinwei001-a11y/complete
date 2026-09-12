# PRD · 季度滚动看板（quarter）参考原型 1:1 复刻

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 前端微调 + 生成器对齐为主 |
| 取代/扩展 | 子 PRD（隶属 `PRD-reference-views-1to1-roadmap.md`，1:1=100%、色调/字体可调） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R6/R13/R14）· `docs/reference-prototype-decision-platform.html`（`Q_ROLL`/`Q_LTA` 种子 L3187-3199 · `buildQuarter` L3200）· `apps/frontend-shell/src/views/plan/QuarterlyRollingView.tsx`（154 行，已近 1:1）· `apps/datacore/src/planviews.ts`（`quarterlyFromContext` :240 · `ltaDeviation` :350，全管线派生）· `apps/datacore/src/synthetic/battery.ts`（projects/scenario 种子 :181/:1204） |

> 一句话：本视图是**全 19 视图里离 1:1 最近的一个**——系统 `QuarterlyRollingView` 已有「需求/供给双条 + 缺口三档(>4红/>0黄/≤0绿) + 事件含规则深链 + 长协执行偏差表 + 行尾跳风险看板」，且数据**完全走管线**（`quarterlyFromContext`：rollup×认证×检修曲线 13 周聚合 + 已批准项目爬坡 + S&OP 决议增量 + PlanTarget 同源需求 + Shipment 派生 LTA）。缺口**不在结构/交互，而在精确值与事件文案**：1:1=100% 要求 6 个季度的 `dem/sup` 与事件叙事**字字还原 HTML**——做法是**调生成器种子**（电池域 planview 参数 + 把 HTML 的"枣庄储能线"作为 CAPEX 项目种子），让管线**实算出 HTML 的精确数**，而非前端写死（R14/R6）。另补 2 处小项：①段头副标注"枣庄储能线 2027-Q3 投产 +22 万套/季 · 与年度基准情景同源" ②事件文案口径对齐。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.E）：`CapexProject(枣庄储能线)`（生成器种子，承接 AOP/capex_scenario）·`PlanTarget(quarter level)`（需求同源）·`Shipment`（LTA 偏差派生）·`SopVersion.resolutions`（决议增量入季度供给）·`Rule(C03 交付高峰/C08 外协上限/C16 安全库存)`。
- **触及链路**（§3）：`computeRollup(产线→基地周产能) ×认证系数×检修曲线 →13周季聚合 + Σ已批准项目爬坡(枣庄) + ΣS&OP决议增量 = 季供给` ∥ `PlanTarget年度分解 + 滚动修正(+2027外推) = 季需求` → `缺口三档 + 事件注释` ∥ `Shipment → ltaDeviation(首行强制越线→跳风险看板)`。**与 AOP/产能推演/S&OP 同源**（一处产能口径 C02）。
- **触及事件/数据流**（§4）：只读查询面 `GET /a/v1/plan/quarterly`；事件携 `ruleKey` 前端展开规则表达式。
- **触及不变量**（§5）：R14（缺口阈值/物料/事件文案配置化，HTML 精确值仅作生成器种子，前端零写死）· R6（同 (industry,seed) 季度曲线字节一致）· R13（每季 dem/sup 可溯到 rollup/项目/决议；LTA 溯到 Shipment）· R-一致（产能口径与 AOP/risk/SOP 同源）。
- **关闭/影响断点**（§8）：G-5——本视图已基本脱电池锁死（gapTiers/ltaEscalatePct 经 ViewConfig 下发），本 PRD 仅补段头副标注与事件文案的最后一处硬编码。
- **门禁**（§7）：`debattery:check`·`chain:check`（capacity_rollup/quarterly 已注册）·前端回归（quarterly-rolling-view testid）·FDE 亲手跑（核对 6 季精确值）。
- **回写承诺**：若新增"枣庄储能线"为标准电池域 CAPEX 项目种子 → 回写本体 §2.E 对象实例样例。

## 1. 目标 / 非目标（1:1=100%，色调/字体可调）
### 目标
1. **6 季精确值还原**（生成器种子对齐，管线实算）：
   | 季 | 需求 | 供给 | 缺口 | 事件叙事 |
   |---|---|---|---|---|
   | 2026-Q3 | 382 | 376 | 缺 6 | 常州夜班常态化 · 江门齐套治理 |
   | 2026-Q4 | 398 | 390 | 缺 8 | 枣庄储能线动工（CAPEX 14亿） |
   | 2027-Q1 | 372 | 392 | 冗余 20 | 春节检修季 · 供给冗余回补库存 |
   | 2027-Q2 | 404 | 396 | 缺 8 | 6 周窗口缺口 → 外协过渡（≤20% **C08**） |
   | 2027-Q3 | 428 | 430 | 冗余 2 | 枣庄线投产 +22/季 · 爬坡 60%→90% |
   | 2027-Q4 | 452 | 448 | 缺 4 | 枣庄满产 · 江门线视触发条件 |
2. **长协执行偏差 3 行精确**：三元正极 plan2800/act2576/**−8.0%**（首行越线→升级供应风险Agent→跳风险看板）；隔膜 820/828/+1.0%；电解液 1900/1862/−2.0%；hint"正极 −8.0% 与预警大屏「到货间隙」同源 + 已在 S&OP ⑤决议加急 200 吨对冲"。
3. **段头副标注**：产能爬坡卡副标"枣庄储能线 2027-Q3 投产 +22 万套/季 · 与年度基准情景同源"（系统现仅"产能爬坡 vs 需求（万套/季）"）。
4. **事件文案口径对齐**：系统现自动事件（检修窗口/交付高峰/到货间隙/产能增量/决议增量）→ 通过种子（枣庄项目命名、C08 外协、检修季）使**生成文案=HTML 叙事**；保留 ruleKey 深链（C03/C08/C16）。
5. **保留系统超集**：行尾"跳风险看板"按钮、规则表达式内联展开、动态季数（n=6）——作为不破坏 1:1 的附加增强保留。
6. **全程走管线**：dem/sup/events/LTA 全由 `quarterlyFromContext`/`ltaDeviation` 实算，前端零写死。

### 非目标
- 不重写季度算法（已对齐 AOP/SOP 口径）；仅调种子让实算值=HTML。
- 不前端写死 6 季数值/事件（取查询面）。

## 2. 现状与缺口（HTML vs 系统）
| HTML 元素 | 系统 | 缺口 |
|---|---|---|
| 需求/供给双条 + 缺口三档色 | ✅ `QuarterlyRollingView.tsx:62` | — |
| 事件 + 规则深链 | ✅（ruleKey 展开） | 事件**文案**需经种子对齐 HTML 叙事 |
| 6 季精确 dem/sup | ◐ 管线实算（值未必=HTML） | **调生成器种子**复现 382/376…452/448 |
| 枣庄储能线 CAPEX 项目 | ◐（现种子为合肥四期/盐城二期） | 增"枣庄储能线"项目种子（2027-Q3 +22/季 ramp 60→90） |
| C08 外协上限 引用（2027-Q2） | ◐ | 该季事件挂 C08 深链 |
| 长协偏差 3 行（正极 −8.0%） | ✅ `ltaDeviation`:350 | 调 Shipment 种子复现 2800/2576 等精确值 |
| 行尾跳风险看板 | ✅ 超集 | 保留 |
| 段头副标注（枣庄 +22/季） | ❌ | 补副标 |

## 3. 设计
### 3.1 生成器种子对齐（主工作量，R14/R6）
- 电池域 `planview` 参数（`weeklyWan` 基线、`growthYoY`、`rollingCorrPct[6]`、`weeksPerQuarter`、`maintMult`、检修周）整定，使 13 周聚合供给 + 需求外推 = HTML 6 季精确值。
- `battery.ts` projects 增 **"枣庄储能线"**：`q0` 对应 2027-Q3、`cap`/`ramp=[0.6,0.9,…]`（+22/季）、动工季 2026-Q4 注记 CAPEX 14 亿；承接 capex_scenario/AOP 基准情景（R-一致）。
- Shipment 种子整定使 `ltaDeviation` 首行=三元正极 −8.0%（`ltaForcedPct=-8`）、其余两行 +1.0/−2.0、plan/act 精确。
### 3.2 事件文案口径
- 通过项目命名（枣庄）+ 规则挂载（2027-Q2 → C08 外协）+ 检修季配置，使 `quarterlyFromContext` 生成的 `events[].label` 文案=HTML 叙事；不在前端拼写死文案。
### 3.3 前端微调
- `QuarterlyRollingView` 段头副标注补"枣庄储能线 2027-Q3 投产 +22 万套/季 · 与年度基准情景同源"（取 ViewConfig.layout 文案，勿前端硬编码）。
- 2027-Q2 事件 ruleKey=C08，复用现有规则展开。

## 4. 契约 / 端点
- 复用 `GET /a/v1/plan/quarterly?from=2026-Q3&n=6` · `QuarterlyResponse{rows[],ltaDeviation[]}`（无需改契约，仅种子）。
- ViewConfig.layout 增 `subNote` 文案位（段头副标注）。

## 5. 关键流程
种子(planview+枣庄项目+Shipment) → quarterlyFromContext 实算 6 季 → 三档缺口+事件深链 ∥ ltaDeviation → 前端渲染（双条+LTA表+跳风险）。

## 6. 非功能（§5）
R14/R6/R13/R-一致；季度曲线确定（同 industry,seed 字节一致）。

## 7. 验收（DoD = 100% 1:1，色字可调）
- 6 季 dem/sup/缺口/事件叙事**逐项=HTML**（管线实算，非写死）；枣庄项目种子接 AOP 基准情景。
- 长协 3 行（正极 −8.0% 越线→跳风险）精确；段头副标注到位；2027-Q2 挂 C08。
- 跳风险看板/规则展开 超集保留。
- `debattery:check` 过（前端零业务常量）；同 (industry,seed) 字节一致（R6）。
- `pnpm -r build && pnpm -r test` 全绿（quarterly + 种子回归）；`chain:check` 过。FDE 亲手核对 6 季值。

## 8. 分期
- **Q.1** 生成器种子整定（planview + 枣庄项目 + Shipment）复现 6 季 + LTA 精确值——主块。
- **Q.2** 事件文案口径 + C08 深链 + 段头副标注（前端微调）+ 回归。

> 风险/规模：本视图结构已 1:1，工作量集中在**生成器调参**（与 AOP/SOP/risk 共享 planview 口径，改动需同跑这些视图回归防漂移）。基线分支：生成器为主、前端极小，冲突小。
