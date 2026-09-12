# AUDIT · 三板块 vs 设计母版 · 全栈差距对齐（驾驶舱 / 规划决策推演 / 项目决策推演）

> **怎么读**：拿设计母版 HTML（单文件 SPA，5540 行，含双主题）逐元素 × 现系统前端 × 后端数据，按"全栈 6 项法"逐元素列差距。每条差距带**母版数据值**（数据级对比）+ **现系统锚点**（file:line）+ **真值判据**（FDE oracle，钉 demo 真实态——评审/验收对它）。
>
> **方法来源**：母版逐元素清单 + 现系统前后端映射（两路深读 agent，源码直证）+ 主题开关源码抠取。**我出分析/SPEC，dev 实现**。
>
> **一句话结论**：三板块**外壳与求解器接线大体已建、且多为真算**（项目板块最完整 ~90%，规划 ~80%，驾驶舱壳 ~70% 但数据层 ~30-40%）。差距**不在"没建"，在三处**：① 数据颗粒（八根因 4/8、毛利勾稽求解器缺、provenance 富度）② 母版的**同源本体底座**（决策应用域 5 一等对象，现系统各板块各自算、未必"一个事实一个出处"）③ **无 light/dark 主题开关**（母版有，系统基建半到位）。

---

## 0. 板块映射（中文名 → 现系统页面）

| 母版板块 | 现系统 renderer / 路由 | 文件 | 后端求解器 |
|---|---|---|---|
| **经营驾驶舱** | `dashboard`（`/v/dashboard`，别名 `/v/dash`） | `views/DashboardView.tsx`(556行) | `affected_orders` / `metric_rollup` / `plan_rootcause` |
| **规划决策推演** | `plan-audit`(体检·根因下钻) + `plan-generate`(建议) + `annual-scenario`/`quarterly-rolling`(年/季) | `views/sim/PlanAuditView.tsx` / `PlanGenerateView.tsx` / `views/plan/*` | `plan_audit` / `audit_timeline` / `plan_generate` / `capex_scenario` |
| **项目决策推演** | `project-sim`(订单/型号推演) + `risk-board`(产能/风险推演) | `views/sim/ProjectSimView.tsx`(1178行) / `views/sim/RiskBoardView.tsx` | `capacity_forecast` / `bottleneck_matrix` / `risk_timeline` |

> **注**：母版"项目决策推演"≠ 暗发的"推演沙盘 `SandboxView`(`/v/sim-sandbox`)"——后者是行业无关的通用本体态传导沙盘（轨 A），与本审计三板块正交，不在此列。

---

## 1. 经营驾驶舱（差距最大在数据层）

| 母版元素（含数据值·行号） | 现系统（file:line·状态） | 差距 | 真值判据（FDE oracle） |
|---|---|---|---|
| **八卡 KPI**（需求136万/供给131.2万/收入103%/毛利16.0%/利用率86%/齐套2项/现金达标/AOP1580万，line 3869-3886），**每卡挂 provenance：公式+输入+来源系统+新鲜度+规则号 C01-C25** | KPI 网格声明式（`DashboardView.tsx:71-81`，8 widget feature `features.ts:34-45`），`metric_rollup` 真算 | ◐ 卡在、真算；**provenance 富度未对齐**（规则号/来源系统/新鲜度/公式串逐卡挂载未确认）；八卡口径（K2 收入/K7 AOP 体系）部分未对齐 | demo 打开驾驶舱，**逐卡悬停出"公式+输入数组+来源系统+新鲜度+规则号"**，与母版同口径 |
| **待解决的问题（8 根源→问题，line 4097 ROOT_LIB）**：crm/push/frame/credit/lta/ramp/maint/cost 八类 | `ProblemPanel`（`:84,122`）调 `affected_orders`，**根因种子仅 4 条**（`battery.ts:1512-1517`：profit-mix/profit-material/scale-demand/material-gap） | **❌ 八根因只 4/8** | demo 问题面板出 **8 类**根源-问题卡（补 4 条根因链种子） |
| **订单经营台账（24 单，列：订单/客户/细分/数量/收入/毛利率/交期/交付/承接，4 态承接色，line 3940）** | `OrderLedger`（`:163`）调 `affected_orders`，逐单根因下钻 DAG（`:218,260`），细分筛选 + 综合毛利率 | ◐ 台账+逐单下钻在；**综合毛利率"归一勾稽"（Σ负贡献=−0.4pct 闭合）求解器缺** | 台账综合毛利率 = 逐单贡献求和**勾稽闭合到 −0.4pct**（非各算各的） |
| **毛利勾稽**：母版毛利率 −0.4pct = 储能结构 −0.38pct… 归一 Σ=−0.40（line 4315 planAggData） | 仅旧 `margin_attribution`（`service.ts:533`） | **❌ `order_margin_contrib` 新求解器不存在**（PASS2 要求"不改旧 marginAttribution 另起") | 新求解器输出逐单毛利率贡献，Σ 勾稽闭合 |
| **问题级归因 DAG（5 层：result→factor→project→event→rootcause，含 event 驱动事件层+受影响订单，line 4018）** | `ProvenanceDag`（`:10`）+ `plan_rootcause`（`:218`） | ◐ DAG 在；**event 层（驱动事件，如 CRM 合同变更 06-05）+ 受影响订单聚合**完整度未确认 | 点问题卡出 5 层 DAG，event 层有真驱动事件 + 受影响订单可点跳 |
| **page 级 AI 对话栏**（aiBar，4 预设问 + 自由追问，基于实时数据算，line 3550） | 驾驶舱未见 AI 对话栏 | **❌ 待确认缺**（母版每板块都有） | 驾驶舱顶有 AI 栏，问"本月最大经营风险"出基于真数据的答 |
| **回采校准链 5 段 / 模块直达 6 卡 / 导出 CSV** | `:87-116` 真能用（节点文案 `FEEDBACK_CHAIN` 写死可覆盖） | ✅ 基本齐 | — |

**驾驶舱小结**：壳 ~70% 可用、求解器真接；**数据层 ~30-40%**——补齐 **①八根因(4→8) ②毛利勾稽求解器 ③provenance 富度 ④问题级 DAG event 层 ⑤AI 对话栏** 才到母版。

---

## 2. 规划决策推演（核心三视图在，建议/勾稽偏简）

| 母版元素（行号） | 现系统（file:line·状态） | 差距 | 真值判据 |
|---|---|---|---|
| **未达成指标根因下钻 DAG（6 层：result→excluded(反事实排除)→factor→project→event→rootcause，line 4256）** | `PlanAuditView` 挂 `KsfGraph`（问题→KSF→财务 **3 层**，`:177`）+ `DailyDotAxis` + `PropagationTimeline`（`:347,357`） | ◐ 根因可视在；**母版的"反事实排除层"（单价/BOM 反算达标→排除，虚线删除）+ project/event 两层**比现系统 KSF 3 层更深 | 点 miss KPI 出 **6 层** DAG，含"反事实排除"节点（单价/BOM 已排除） |
| **项目级聚合表（归一勾稽 Σ=−0.40 闭合，负贡献排前+长尾+正贡献提示，line 4315/4331）** | 现系统根因侧未见等价"项目聚合勾稽表" | **❌ 聚合勾稽表缺**（与驾驶舱毛利勾稽同源） | 根因 DAG 下出聚合表，负+正勾稽闭合到 −0.4pct |
| **规划体检（X01-X05 校验 + 一键 fix + 最终修正规划表，line 4901/3514）** | `PlanAuditView` `plan_audit` live，输出 **H 硬矛盾/M 软风险/S 建议三段**（`:250`），可应用修正/采纳 Action | ◐ 三段在、live 真算；**X01-X05 具体校验 ID + 一键 fix action + buildAuditPlanRows 最终修正表**完整度未确认 | 改输入即重检，出 X01-X05 命名校验 + 每项一键 fix + 最终修正规划表（负责人/T+n/依据规则） |
| **规划建议（3 案：稳健/均衡/进取；每案 五维雷达+目标达成判定+五维取舍矩阵+KSF图+外部敏感性+风险传播链，line 4690/4746）** | `PlanGenerateView` `plan_generate`（后端已注册 `service.ts:1471`，前端渲染完整度**待补**） | **◐ 大概率简于母版**：3 案对比 / 五维取舍矩阵 / 外部信号敏感性 / 风险传播链 未确认齐 | 输入经营目标出 **3 案**，每案五维雷达 + 取舍矩阵 + KSF 图 + 外部敏感性 |
| 年/季态势（三情景双线+缺口柱 / 6 季滚动爬坡） | `AnnualScenarioView`/`QuarterlyRollingView` 真算（`fetchAop`/`fetchQuarterly`） | ✅ 真能用 | — |

**规划小结 ~80%**：体检+年+季+根因可视真能用；差**①根因 DAG 反事实排除层 ②项目聚合勾稽表 ③规划建议 3 案对比矩阵/雷达/敏感性 ④体检 X01-X05 命名校验+一键 fix**。

---

## 3. 项目决策推演（最接近母版 ~90%）

| 母版元素（行号） | 现系统（file:line·状态） | 差距 | 真值判据 |
|---|---|---|---|
| **C-2 型号产能推演（6 步：解析→可产网络→驱动因子→聚合 P50→瓶颈→结论；配套 DAG 逐层点亮；分批交货 CSV，line 3816）** | `ProjectSimView` 六步 stepper（`:490`）+ 常显 PmDag（`:417`）+ 分批 CSV（`:64`）+ what-if 三滑杆（`:842`），`capacity_forecast` 真算 | ✅ **真能用**（最完整） | demo `/v/project-sim` 选型号→6 步真算→DAG 点穿→what-if 实时重算 |
| **C-1 订单全链推演（订单驱动：6 KPI + 4 层 DAG + 三关联判 交期/齐套/财务 + 4 态 verdict + 对冲条件，line 3429）** | ProjectSimView 有订单列表回填，但主体是**型号驱动六步**；**订单驱动的"交期/齐套/财务 三关联判 + 4 态承接 verdict"**未确认完整 | **◐ 订单驱动三判可能缺/简**（母版 C-1 是逐单 C02/C03/C06/C16/C13/C15/C18 三判出 verdict） | 选一单→出 ①交期判 ②齐套判 ③财务判 三表 + 可接/提价接/不接 verdict + 对冲条件 |
| **C-3 产能推演 risk timeline（基地×因素风险卡 + 逐日传导曲线 + 处置方案 + 历史案例，line 2431）** | `RiskBoardView` 风险卡网格 + MiniStrip 逐日 heat + 受影响订单 + `mitigation_select` 对症方案 + 历史回放，`risk_timeline` 真算 | ✅ **真能用**（瓶颈基线含 MOCK 兜底已诚实标 dataMode） | demo `/v/risk` 出风险卡→点开逐日传导+处置方案 |
| **问题传播时序（逐日 0-100 传导：事件窗→约束越线→波及订单→财务击穿，line 1283 一等对象）** | `PropagationTimeline.tsx` **组件建好但未被任何 view import（孤儿）**，财务系数 `0.6万/套`/`1亿` 前端写死（`:60,96`） | **❌ 组件未挂载 + 系数写死** | 风险/规划页挂载传导时序，财务击穿系数来自求解器非写死 |

**项目小结 ~90%**：型号产能 + 风险推演真能用；差**①订单驱动三关联判 verdict ②问题传播时序组件挂载+去写死系数**。

---

## 4. 跨板块最深差距 · 同源本体底座（决策应用域 5 一等对象）

母版把三板块产物**本体化为「决策应用域」5 个一等对象**（line 1273-1321），并锚定 **"一个事实一个出处"**——三板块共用一份 `ledger()`/`ROOT_LIB`，台账（自下而上）与聚合（自上而下）是**同一份数据两个遍历方向**：

| 一等对象 | 母版构成 | 现系统现状 | 差距 |
|---|---|---|---|
| **经营KPI** | 八卡 + 三线差异 | `metric_rollup` 算，但非一等对象 | 各板块各取，未声明为共享对象 |
| **待解决问题** | 订单归并 8 根源 | `affected_orders`（4 根源） | 非一等对象 + 根因 4/8 |
| **KSF要素** | 5 要素（财务←KSF←问题） | `KsfGraph` 有 5 要素图 | ◐ 有图、未必一等对象 |
| **经营方案** | 3 案（目标→求解器→后果） | `plan_generate` | ◐ 完整度待补 |
| **问题传播时序** | 逐日传导（基线+事件脉冲） | `PropagationTimeline` 孤儿 | ❌ 未挂载 |

> **结构性风险**：母版的可信靠"**24 单 `ORDERS` + 6 细分常量 + `ROOT_LIB` 8 根源 = 三板块所有数字唯一来源**"。现系统三板块**各自调各自求解器**，台账毛利率、规划聚合勾稽、问题归并若**不同源**，会出现"驾驶舱台账综合毛利率 ≠ 规划聚合 ≠ 各单求和"——即母版极力避免的"多个出处"。**这是把三板块从"各自能用"提升到"母版级一个事实一个出处"的关键**，建议立"决策应用域一等对象 + 同源底座" SPEC。

---

## 5. 主题 / 配色开关（母版有 · 系统无 · 基建半到位）

### 5.1 母版机制（`toggleTheme` line 5524-5531）
- **双主题靠 CSS 变量切换**：`:root`=黑曜石(暗，默认)，`body.light`=浅色；切换只 `document.body.classList.toggle('light', on)`。
- **chrome 变量翻转**：`--bg`#1A2230→#F6F9FD / `--panel`#262F40→#FFFFFF / `--txt`#E9EEF5→#1B2733 / `--accent`#4C90F0→#2D8CF5 + `--ov-rgb`/`--sh-rgb`（叠加/阴影基色）浅↔深翻转。
- **语义域色 theme-invariant**（两主题不变）：factory#5E8FE8/product#36BFA5/process#DD9551/equip#9D8BF0/people#DD7E9E/quality#62BE77/capacity#43B7D7/forecast#E8B54A + solver#C470B8/agent#5FC2AE。
- **控件**：header 内 checkbox(`#themeToggle`)+轨/钮+标签(浅色/黑曜石)；**持久化 `localStorage('aip-theme')`**，初始化读回(line 5531)。
- **~30 条 `body.light X` 覆盖**：硬编码深底处（按钮/header/弹层/tab.active）单独翻浅。

### 5.2 系统现状
- `styles/tokens.css:1-31` `:root` 有全套 token（`--bg:#0d1117` **仅暗色基线** + 10 域色 `--c-factory…`）。
- `workspace/theme.ts:5-20` `applyTheme()` 经 `setProperty` 按租户覆盖 token（`ShellLayout.tsx:181`）——**仅按账号覆盖值，非 light/dark toggle**；无 `data-theme`、无 localStorage、无开关 UI。
- 颜色**大部分变量化**，但 ~10-20 处硬编码十六进制（`ProjectSimView.tsx:485-486,956-991` / `DashboardView.tsx:39-44`）。

### 5.3 系统落法 SPEC（中等工作量·无需重构 CSS 架构）
1. **加浅色 token 组**：`tokens.css` 加 `[data-theme="light"]`（或 `body.light`）重定义 chrome 变量（bg/bg2/panel/txt/muted/accent + 叠加/阴影基色），**语义域色 `--c-*` 不变**（theme-invariant，对齐母版）。映射母版浅色值（bg#F6F9FD/panel#FFFFFF/txt#1B2733/accent#2D8CF5）。
2. **开关 UI + 持久化**：`ShellLayout` header 加 toggle（复用母版轨/钮样式），`localStorage('aip-theme')` 持久化，启动读回设 `document.documentElement.dataset.theme`；与现 `applyTheme`（租户覆盖）**叠加不冲突**（主题切 chrome，租户覆盖品牌色）。
3. **收口硬编码**：把 ~10-20 处硬编码十六进制改 `var(--…)`（否则浅色切不动）——这是"像素级"复刻的主要工作量。
4. **红线**：语义域色两主题一致（RL5 零业务常数延伸）；切换纯前端、可回退；不破现租户 `applyTheme` 覆盖。

---

## 6. 优先级建议（→ 可拆 HANDOFF）

| 优先 | 项 | 为何 | 工作量 |
|---|---|---|---|
| **P1** | **全域可信溯源交互**（见 `SPEC-trust-traceability-interaction.md`） | 用户核心诉求:每个展示数据可就地溯源建信任;系统溯源基建已全、只缺"接全+扩规则provenance" | 中（接 RuleRef/Provenance 到裸渲染点 + 扩 Rule 谁定/何时/边界 + 下钻去死路 + 风险详情弹窗） |
| **P1** | **主题/配色开关** | 母版明确要、基建半到位、独立可交付、用户可感 | 中（token 浅色组 + toggle + 收口硬编码） |
| **P1** | **驾驶舱数据层**（八根因 4→8 / 毛利勾稽求解器 / provenance 富度 / AI 对话栏） | 驾驶舱是首页门面，差距集中且可数 | 中-大（含高回归求解器，独立 PR + FDE 逐值核） |
| **P2** | **决策应用域同源底座**（5 一等对象 + 一个事实一个出处） | 最深结构差距，防"三板块数字不一致" | 大（先 SPEC 再实现） |
| **P2** | 规划建议 3 案对比矩阵 + 根因反事实排除层 + 项目聚合勾稽 | 规划板块对齐母版 | 中 |
| **P3** | 项目板块订单驱动三关联判 + 问题传播时序挂载 | 项目板块已 ~90%，补尾 | 小-中 |

> **下一步**：本审计可拆成 **HANDOFF**（每项含 §1 全栈追溯 + 增量0 取基线 + 红线 + 真值判据），挂进 `START-HERE` 轨表派给 dev。**先建议从"主题开关"（独立、可感、中等量）+"驾驶舱数据层"（门面）两条起。**
