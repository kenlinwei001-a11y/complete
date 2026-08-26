# PRD · 规划体检（plan-audit）参考原型 1:1 复刻（聚焦时序推演交互）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 前端+后端 |
| 取代/扩展 | 扩 `PRD-frontend.md`（§7 规划体检）· 子 PRD（隶属 `PRD-reference-views-1to1-roadmap.md`，1:1 尺度=100%，色调/字体可调） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R6/R13/R14 · §8 G-2 绿测试≠能用） · `docs/reference-prototype-decision-platform.html`（dot 轴 L4451-4500 · `dateAxis` L2452 · `showDayTip` L2512 · `riskVal` L1627 · `timelineFor` L4342 · `ksfSVG` L4415 · `runAuditDiag` L4813）· `apps/frontend-shell/src/views/sim/PlanAuditView.tsx`（:314）· `apps/frontend-shell/src/views/sim/PropagationTimeline.tsx`（:45/:102）· `apps/datacore/src/solvers/risk.ts`（:138 series · :185 · :439 根因链）· `apps/datacore/src/solvers/plan.ts:41`· `packages/contracts/src/solvers.ts`（:69 RiskCard.series · :103 AuditItem 无 kind） |

> 一句话：规划体检的诊断（H/M/S + 结构毛利率溯源）系统**已对齐**；但其**时序推演交互与 HTML 不同**——HTML 是「**与产能推演 1:1 的逐日圆点轴 + 日期刻度 + 悬停日点详情 + 三档图例**」+ 财务 KSF 图，系统却渲染成 **4 节点横向 stepper**。**关键真相：后端 `risk_timeline` 早已产出逐日 `series[]`+事件+越线日+受影响订单，前端 `PropagationTimeline` 把 series 丢了**（典型"绿测试≠能用"接缝）。本 PRD 100% 1:1 复刻该时序交互 + KSF 图。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.E）：`Solver(plan_audit, risk_timeline)`·`AuditItem`（扩 `kind` 字段 + 时序锚点）·`RiskCard`（`series/events/crossDay/affectedOrders` 已在）·**新增** KSF 图结构（`KSF_DEF/KIND_KSF/fins/problems` 边集，求解器输出）。
- **触及链路**（§3）：`plan_audit(诊断 H/M/S, 每项带 kind) → audit_timeline(按 kind 出逐日 series/stages, 同 HTML timelineFor+probSeqVal 口径) → 前端逐日圆点轴 + 悬停日点详情 + KSF 图`。**复用既有 `risk_timeline` 的逐日 series 引擎**（公式同 HTML `riskVal`）。
- **触及事件/数据流**（§4）：无新事件（即时重检走 useLiveSolver；纯读）。
- **触及不变量**（§5）：
  - **R14 应用层无业务常数**：阈值/三档色带/KSF 文案/9 种 kind 口径来自求解器配置 + i18n，前端零内联；过 `debattery:check`。
  - **R6 确定性**：逐日 series 由阶段锚点分段线性插值 + 固定 `hashN` 微抖动（同 HTML `probSeqVal`），同输入字节一致。
  - **R13 可溯源**：悬停日点详情显示当日传导度 + 阶段事件 + 受影响订单（取 `affectedOrders` 窗口），与产能推演 `showDayTip` 同源同款。
  - **R-一致**：体检与产能推演**共用同一逐日 series 引擎**（同一事实一个出处）。
- **关闭/影响断点**（§8）：闭合 **G-2 类接缝**——"后端 series 已产、前端不消费"（数据在 `risk_timeline` 输出里，`buildPropagation` 丢弃）。
- **门禁**（§7）：`debattery:check`·`chain:check`（audit_timeline/plan_audit 注册）·`ontology:check`·前端回归（逐日轴/悬停/图例/KSF）·FDE 亲手跑。
- **回写承诺**：`AuditItem.kind` + KSF 输出 schema → 回写本体 §2.E（plan_audit 输出扩展）。

## 1. 目标 / 非目标（1:1 尺度 = 100%，色调/字体可调）
### 目标
1. **时序推演时间轴 100% 1:1**（与产能推演同款）：① **逐日圆点轴**（d=1..90 每天一 dot，`riskColor` 三色）② **日期刻度行**（首/尾/每 5 日显 MM-DD）③ **悬停日点详情**（日期·T+d·传导度 + 当日阶段事件文案 + 受影响订单表）④ **三档图例**（<70 正常 / 70-84 关注 / ≥85 越线）⑤ 顶部摘要（`cur→peak · T+cross 越线`）。
2. **每审计项独立时序**：H/M/S 每项按其 `kind`（产销/毛利/齐套/现金/份额/爬坡/外协/capex23/struct 9 种）展开**各自的逐日 series**（非所有项共用一条通用曲线）。
3. **财务计划 KSF 图 1:1**：3 层有向图（待解决问题 → 关键成功要素 KSF → 财务计划指标），**问题节点点击联动其时序轴**。
4. **风险传播链**：每问题"因素→对象→传导→指标/规则"。
5. 数据走管线（R14/R6），保留系统已对齐的诊断/溯源超集。

### 非目标
- 不改诊断规则数学（H/M/S/结构毛利率已对齐，仅补时序+KSF）。
- 不在前端写死曲线/订单（取自求解器）。

## 2. 现状与缺口（HTML vs 系统，file:line）
| HTML 时序交互 | 系统 | 缺口 |
|---|---|---|
| 逐日圆点轴（d=1..90 dot）L4491 | ❌ 4 节点 stepper（`PropagationTimeline.tsx:102`） | **后端 series[] 已有，前端 `buildPropagation:45` 丢弃** |
| 日期刻度行 `dateAxis` L2452 | ❌ | 无 tick 行 |
| 悬停日点详情 `probDayTip/showDayTip` L4464/2512 | ◐ 仅"波及订单"节点点开 Modal | 无逐日 hover、无当日传导度/事件 |
| 三档图例 L4499 | ❌ | 仅 data-sev 着色，无图例/阈值带 |
| 每问题独立时序（9 kind） | ❌ | `RiskPropagation` 对所有 item 调 `risk_timeline({})` 拿同一 card[0]（`PlanAuditView.tsx:314`）；`AuditItem` 无 `kind`（`solvers.ts:103`） |
| 逐日传导度 `probSeqVal`（阶段锚点插值+抖动+远期压缩）L4453 | ◐ | 后端 `tensionSeries`（risk.ts:138）是 base+factor 口径，无 plan-audit kind 口径 |
| 顶部摘要 `cur→peak·T+cross` L4496 | ◐ | 后端有 peak/crossDay，前端未展示 |
| 财务 KSF 图 L4406 | ❌ | 完全无（后端无 KSF 结构） |
| 风险传播链 因素→对象→指标/规则 | ◐ | 后端有逐单 4 层根因链（订单粒度），无问题级 chain |

> 数据现状：逐日 dot 轴所需**全部数值后端已具备**（`risk_timeline` series/events/crossDay/affectedOrders，契约 `solvers.ts:69` 已含）——主缺口在**前端不消费 + plan_audit 无 kind 路由 + 无 KSF**。

## 3. 设计
### 3.1 前端 `PropagationTimeline` 改造（消费已存在的 series，主体）
- 读 `card.series[]`（已在）渲染**逐日圆点轴**（每日 `<Dot>` 背景 `riskColor(v)`）+ **`<DateAxis>`** 刻度行（首/尾/每5日 MM-DD）+ **三档图例条** + **顶部摘要**（`cur→peak·T+cross`）。
- **悬停日点详情** `<DayTip>`（复刻 `showDayTip`）：当日 `日期·T+d·传导度 v` + 就近阶段事件文案（`|stage.d−d|≤5`）+ 受影响订单表（取 `affectedOrders` 落在 `[d-7,d+12]` 窗口；列 订单/客户/数量/交期/影响，影响=`v≥85?命中:关注`）。与 `RiskBoardView` 的逐日交互**共用同一组件**（R-一致）。
- 4 节点 stepper 可保留为"概览"折叠项；1:1 主体是 dot 轴。
### 3.2 后端/契约（每审计项独立时序）
- `contracts/solvers.ts` `AuditItem` 加 `kind`（9 种枚举）。`plan_audit`（`plan.ts:41`）诊断时给每项打 `kind`。
- 新增 **`audit_timeline`**（或扩 `risk_timeline` 接 `{kind, ctx}`）：按 HTML `timelineFor(kind)` 的 **4 阶段（事件窗→约束越线→波及订单→财务击穿）** + `probSeqVal`（阶段锚点分段线性插值 + 固定 `hashN` 微抖动 + clamp[40,97] + 远期阶段压缩进 90 天）输出 `{series[], stages[], peak, crossDay, affectedOrders[]}`。复用 `risk_timeline` 的 series 引擎与 `affectedOrders`（risk.ts:138/439）。注册 `SOLVER_KEYS`+输出形状（chain:check）。
- 前端 `RiskPropagation` 改为 `runSolver("audit_timeline", { kind: item.kind })`（不再空参）。
### 3.3 财务 KSF 图（新）
- 求解器输出 `{ksf:{problems[], ksfNodes(KSF_DEF 5), finNodes, edges:[问题→KSF, KSF→财务指标]}}`（口径取 HTML `KSF_DEF/KIND_KSF`）。
- 前端 `<KsfGraph>` 复刻 3 层有向图（问题虚线威胁 / KSF 实线支撑 / 财务指标）；**问题节点点击 → 展开其 `audit_timeline` dot 轴**（联动）。
### 3.4 风险传播链（问题级）
- 每问题附 `chain: 因素→对象→传导→指标/规则`（求解器派生，复用规则目录），随时序/KSF 展示。

## 4. 契约 / 端点
- `contracts/solvers.ts`：`AuditItem.kind`；`AuditTimelineOutput`（series/stages/peak/crossDay/affectedOrders）；`KsfGraphOutput`。
- 端点：复用 `POST /a/v1/solvers/:key/invoke`（plan_audit / audit_timeline）。
- 前端：`PropagationTimeline` 重写为 dot 轴 + DayTip + 图例；新增 `KsfGraph`；与 RiskBoard 共用逐日组件。

## 5. 关键流程
体检表单即时重检 `plan_audit`（每项带 kind）→ 卡片"▶ 时序推演" → `audit_timeline({kind})` 出逐日 series → 渲染逐日圆点轴 + 日期刻度 + 三档图例 + 悬停日点详情（事件+受影响订单）→ KSF 图问题节点点击联动该项时序。

## 6. 非功能（§5）
R14（阈值/色带/KSF 文案配置化）· R6（series 确定）· R13/R-一致（悬停可溯 + 与产能推演共用引擎）。

## 7. 验收（DoD = 与产能推演同款 + HTML 100% 对齐，色字可调）
- 逐日圆点轴 + 日期刻度 + 三档图例 + 悬停日点详情（当日传导度/事件/受影响订单）全到位，**交互与 RiskBoard 一致**。
- 每审计项按 kind 展开各自时序（非共用通用曲线）。
- 财务 KSF 图 3 层渲染，问题节点点击联动时序。
- 数据走管线、前端零写死（`debattery:check`）；同输入字节一致（R6）。
- `pnpm -r build && pnpm -r test` 全绿（时序组件 + audit_timeline + KSF 回归）；`chain:check`/`ontology:check` 过。
- FDE：起真后端 + 前端亲手悬停逐日点、点 KSF 节点联动，截图留证。
- 回写本体 §2.E（AuditItem.kind + audit_timeline/KSF 输出）。

## 8. 分期
- **AUDIT.1** 前端 `PropagationTimeline` 消费已有 series → 逐日圆点轴 + 日期刻度 + 三档图例 + 悬停日点详情（**最快见效：后端数据已在，纯前端**）+ 与 RiskBoard 共用组件。
- **AUDIT.2** `AuditItem.kind` + `audit_timeline`（9 kind 口径，timelineFor+probSeqVal）→ 每项独立时序。
- **AUDIT.3** 财务 KSF 图（求解器输出 + `<KsfGraph>` + 问题节点联动）+ 问题级风险传播链。

> 规划建议（generate/方案生成）与本视图**共用同一时序引擎 + KSF 图**（HTML 注释"规划体检/规划建议共用"）→ 本 PRD 的 audit_timeline/KsfGraph 复用到 generate 子 PRD。基线分支：前端为主 + 契约/求解器小改，冲突小。
