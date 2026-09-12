# 前端屏幕盘点（只读取证 · 一屏一行）

## 报告头 · 树龄自证

| 项 | 值 |
|---|---|
| 开工时 `git rev-parse --short HEAD` | **778cc589** ⇒ `git merge-base --is-ancestor HEAD fbfa88f1` **成立 ⇒ 落后，必须 detach** |
| 树龄探针（旧树） | `wc -l apps/datacore/src/synthetic/battery.ts` = **1249** |
| detach 后 `git rev-parse --short HEAD` | **fbfa88f1** |
| 树龄探针（PIN） | `wc -l apps/datacore/src/synthetic/battery.ts` = **7053** ✅ 已移到 PIN |
| 取证时刻 | 2026-09-11 |
| 交单前 `git status --porcelain` | **0 行**（clean，一行源码未改，未起任何服务） |

---

## 全局数（全部亲手跑出）

| 量 | 数 | 出处（可复验） |
|---|---|---|
| 后端派单**内置**视图（`seed:true`） | **16** | `apps/datacore/src/synthetic/view-manifest.ts` `BUILTIN_VIEWS` — 16 条全部 `seed: true`；`grep -c '^  { key:'` = 16、`grep -o 'seed: true' \| wc -l` = 16 |
| 后端派单**增量**视图 | **18** | `synthetic/service.ts` `PLANVIEW_EXTRA_KEYS` **13** + `DARK_LAUNCH_EXTRA_KEYS` **5**（`process-stuck` + `SANDBOX_CONSOLE_VIEW_KEYS` 4） |
| 后端派单视图合计 | **34** | 16 + 18 |
| `App.tsx` 路由总条数 | **65** | 显式 `path:` **20** + `admin("…")` 助手 **45** |
| ↳ 其中业务专用 `/v/<静态段>` route | **8** | sim-sandbox · decision-play · disruption-radius · what-if · cleanroom-attr · optimize-whatif · sim-unified · decision-console |
| ↳ 其他业务 route（非 `/v/`） | **5** | `/`(首页) · `scenarios` · `tasks/:taskId` · `o/:typeKey/:objectKey` · `process-instances/:instanceId` |
| ↳ 管理屏 | **49** | `admin()` 45 + featureKey 显式 3（resources/plan-builder/org）+ 子页 1（`admin/connections/:connId/schema`） |
| ↳ 非屏的 route | **2** | `v/:viewKey`（通用分发器，不是屏）· `*`（404 兜底） |
| 登录屏 | **1** | `/login` |
| **合计屏数** | **97** | 34（后端派单）+ 8（专用 /v/ route）+ 5（其他业务 route）+ 49（管理）+ 1（登录） |

### 行数

| 范围 | 行数 | 文件数 |
|---|---|---|
| `apps/frontend-shell/src` 全部 `*.ts`/`*.tsx` | **127,403** | 303 |
| ↳ `src/views` | **71,934**（56.5%） | 136 |
| ↳ `src/pages`（含 49 个管理屏） | 22,306 | 68 |
| ↳ `src/mocks` | 15,713 | — |
| ↳ `src/components` | 7,061 | — |
| ↳ `src/api` | 4,217 | — |
| ↳ `src/locales` | 3,111 | — |
| ↳ `src/sse` | 1,731 | — |
| ↳ 其余（store/lib/workspace/config/根文件） | 1,330 | — |

复验：`find apps/frontend-shell/src \( -name '*.tsx' -o -name '*.ts' \) -print0 | xargs -0 wc -l | tail -1`

### 导航分组数与每组项数（实测自 `ShellLayout.tsx` 的 `NAV_GROUPS` 声明块）

**13 个分组 / 83 条声明项** ＋ 1 条组外硬编码 NavLink（`⚡ 场景启动器`，`ShellLayout.tsx` 侧栏顶部，游离于 NAV_GROUPS 之外）。

| # | 分组 | 声明项 | demo·admin 实际可见 | 备注 |
|---|---|---|---|---|
| 1 | （无标题·顶层） | 2 | **2** | dash · decision-console |
| 2 | 规划与平衡 | 6 | **6** | — |
| 3 | 推演 | 12 | **6** | 6 项被 `consolidatedWhen: sim.sandbox` 收编隐藏 |
| 4 | 归因与风险 | 5 | **0** | 5 项全部收编 ⇒ **整组自动隐藏** |
| 5 | 台账与地图 | 2 | **2** | — |
| 6 | 数据接入 | 5 | 5 | 全 admin 项 |
| 7 | 建模与图谱 | 11 | 11 | graph(view) + 10 admin |
| 8 | 图谱体系（默认折叠） | 8 | 8 | 八视角 |
| 9 | 规则与校准 | 2 | 2 | admin |
| 10 | 构建与成长 | 6 | 6 | admin |
| 11 | 编排与场景 | 10 | 10 | admin |
| 12 | 运营与审批 | 7 | 7 | admin |
| 13 | 平台与系统 | 7 | **6** | `tenants` 需 `platform_admin`，demo admin 无此角色 |
| | **合计** | **83** | **71**（12 组渲染，1 组空隐） | |

按角色实际可见项数（全部算上组外的「⚡ 场景启动器」再 +1）：

| 角色 | 可见导航项 | 可见分组 |
|---|---|---|
| `admin`（admin+planner+catalog_admin+tenant_admin） | **71** | 12 |
| `planner` | **29** | 9 |
| `base_manager:常州` | **9** | 4 |

---

## ⚠ 读本表前必须知道的两个开关态（demo 租户实测口径）

1. **`sim.sandbox` 对 demo 租户是「开」的**，尽管 `features.ts:93` 写着 `defaultOn: false`。
   `FeatureService.templateFeatures()`（`features.ts:466-484`）对 `industry === "battery-manufacturing"` 返回
   **`ALL_FEATURE_KEYS` 全开，只减四个暗发集**（QOS / PERF / WORLD / INCOMPLETE_DATA）——
   `sim.sandbox` 一个集合都不在 ⇒ **实际为开**。
   **后果是本盘点里最重的一条**：`consolidatedWhen: "sim.sandbox"` 的 **11 条导航项全部隐藏**，「归因与风险」整组消失。
2. **`process.runtime` 对 demo 租户是「关」的** —— 它在 `INCOMPLETE_DATA_DARK_LAUNCH_FEATURES`（`features.ts:295`）里。
   ⇒ `process-stuck` 连 `workspace.views` 都不下发，`/v/process-stuck` 404。
   同理 `org.world`（WORLD 集）与 `qos.dril-routing`（QOS 集）为关 ⇒ `/admin/org`、`/admin/resources` **导航里有条目但点进去 404**
   （`visibleAdminPages()` 只按角色过滤，**不看 entitlement**）。

---

# 主表 · 屏幕清单

**代码量口径**：「主 N 行」= 该 renderer 入口文件 `wc -l`；「子 M 行」= 从该入口出发、限制在 `src/views/**` 内的**传递 import 闭包**行数（`*.ts`/`*.tsx`，CSS Module 不计；遇到别的屏的主组件即停，不重复计入；`views/registry.ts` 不跟进 —— 它动态 import 全部 renderer，跟进去会把整棵树卷进来）。
金丝雀：`views/exportCsv.ts`（叶子）报 `主36 子0`；`views/sim/SandboxView.tsx` 报 168 个子件时说明 registry 被跟进了 ⇒ 已修正为不跟进。

**导航位置口径**：实测自 `ShellLayout.tsx` 的 `NAV_GROUPS`，按 **demo 租户当前开关态**（`sim.sandbox`=ON、`process.runtime`=OFF）算「此刻屏上第几项」。

## A. 后端派单内置视图（`BUILTIN_VIEWS`，`seed:true` × 16）

| # | 屏名 | 路由 | 导航位置 | 绑的求解器（manifest / 组件实调） | 主要组件形态 | 代码量 | 谁会看见它 | 服务哪条 COO 目标 |
|---|---|---|---|---|---|---|---|---|
| 1 | 经营驾驶舱 | `/v/dash` | 顶层无标题组 → 第 1 项 | manifest：无 solverKeys（只有 `apiTags:["dash"]`）<br>实调 **8 个**：后端 `DASH_LAYOUT` 以**数据**形态声明 5 个（`cockpit_kpi`×5 个 KPI · `metric_rollup` · `plan_rootcause`×2 · `affected_orders` · `counterfactual_timeline`），由 `DashboardView.tsx:712` `invokeSolver(q.solverKey, q.args)` 字符串键分发；组件代码里另直调 3 个（`risk_timeline` `gap_attribution` `supply_demand_gap_attribution`）<br>**⚠ 不一致：manifest 一个 solverKey 都没绑，实调 8 个**<br>**⚠ 这 5 个是「字符串键分发」——纯代码扫描一个都看不见，必须从后端 layout 读** | 后端 layout 下发 **20 个 widget**（KPI 卡×12 + 指标条×1 + 归因 DAG×1 + 订单台账内嵌×1 + 规划下钻×1 + S&OP 版本切换×1 + 反事实双轨×1 + 折线×1 + 表格×1）；另有 4 个 widget 仅 `SEED_LIVED_IN=1` 时注入（12 月产出柱、准交率 KPI、年度工单 KPI、已交付台账表） | 主 1,404 + 子 35 | admin ✅ planner ✅ base_manager ❌（`roleViews` 显式排除）<br>功能位 `view.dash`（默认开） | 目标3 ✅ 经营数据可视化（全链路指标集中展示）· 目标3补充（四类偏差根因） |
| 2 | 本体图谱 | `/v/graph` | 建模与图谱 → 第 1 项 | manifest：无；实调：无（走 `GET /a/v1/ontology/graph`） | 力导向节点图（内联 SVG）+ 右侧节点检查器 + 视角描述卡 + 表格×1 + 按钮×5；`options.graphOptions` = 14 业务域 allowlist + `dimOthers` | 主 610 + 子 440 | admin ✅ planner ✅ base_manager ❌<br>`view.ontology-graph`（默认开） | **挂不到任何有金额场景**（见后文）— 它是平台自我元模型浏览器 |
| 3 | 产能推演（风险看板） | `/v/risk` | 推演 → 第 5 项 | manifest：`risk_timeline` ✅<br>实调：`risk_timeline` `affected_orders` `bottleneck_matrix` `gap_attribution` `mitigation_select` `base_capacity_outlook` `generic_inference`<br>**⚠ manifest 只绑 1 个，实调 7 个** | 表格×9 + EChart 折线×1 + 逐日点轴 + DAG 过程图×6 + 步骤条 + 传导边开关面板 + 杠杆面板 + 弹窗×5 + 浮层说明×13 + 溯源角标×10 + 导出按钮 | 主 2,484 + 子 4,508（20 个子件） | admin ✅ planner ✅ base_manager ✅<br>`view.risk-board`（默认开） | 目标2 ✅（多基地负荷监控/供需匹配）· 目标3 ✅（需求-供给动态平衡态势）· 目标3补充 ✅（风险预警与溯源） |
| 4 | 订单台账 | `/v/order` | 台账与地图 → 第 1 项 | manifest：无；实调：无（`queryObjectsPaged(Order)` + `fetchNeighbors` 下钻） | 服务端分页表格（7 列：SO/客户/型号/数量/交期/基地/状态）+ 行展开下钻 + 列筛选 + 溯源角标<br>**⚠ 后端 `LEDGER_LAYOUT` 的 7 列里一列金额都没有** | 主 261 + 子 0 | admin ✅ planner ✅ base_manager ✅ | 目标1 ✅（交付环节可视）· 目标3 ✅（经营数据可视化）<br>金丝雀：订单簿 Σ`Order.value` = **454.64 亿 / 500 单**（`battery.ts:5362`），本屏就是这 500 单的台账 |
| 5 | 规划体检 | `/v/plan-audit` | 规划与平衡 → 第 4 项 | manifest：`plan_audit` ✅；实调：`plan_audit` `audit_timeline` `risk_timeline` `ksf_graph`（后两个经共享件 `components/KsfGraph.tsx`）（+3） | 输入表单（需求侧字段组）+ 逐日点轴 + KSF 三层有向图 + 推理过程面板 + 传导时间线 + DAG 过程图 + 溯源角标×3 | 主 360 + 子 728 | admin ✅ planner ✅ base_manager ❌ | 目标1 ✅（销售计划/供应计划体检）· 目标2 ✅（产销匹配） |
| 6 | 规划建议 | `/v/plan-generate` | 规划与平衡 → 第 5 项 | manifest：`plan_generate` ✅；实调：`plan_generate` `risk_timeline` `ksf_graph` `audit_timeline`（后两个经 `KsfGraph.tsx`）（+3） | 目标字段表单 + 雷达图×3 + 方案卡 + KSF 图 + 传导时间线 + 步骤条 + 传导边开关面板 + DAG 节点检查器 + 导出按钮 | 主 572 + 子 2,135 | admin ✅ planner ✅ base_manager ❌ | 目标2 ✅（多目标优化算法计划方案）· 目标3 ✅（模型算法输出优化建议） |
| 7 | 接单可行性 | `/v/project-sim` | 推演 → 第 3 项 | manifest：`capacity_forecast` ✅；实调：`capacity_forecast` `bottleneck_matrix` `generic_inference`（+2） | 表格×10 + 杠杆面板（动态因子）+ PmDag 派生图 + 推理过程面板 + 规则引用/已评规则块 + 弹窗×3 + 浮层说明×7 + 导出按钮 | 主 1,459 + 子 2,341 | admin ✅ planner ✅ base_manager ✅ | 目标2 ✅（产能模型/产销快速匹配/业务变动实时响应）· 目标1 ✅ |
| 8 | 月度规划（S&OP） | `/v/sop-balance` | 规划与平衡 → 第 3 项 | manifest：`sop_balance`<br>**⚠ `sop_balance` 根本不在 `SOLVER_KEYS`（63 个）里** —— 它是 workflow 级 solver（`databuilder/closure.ts` `WORKFLOW_SOLVERS`），`agentcore/mocks/seed.ts:634` 把它实际映到 `mrp_netting`<br>实调：`mrp_netting` `finance_pnl` `sop_reschedule` | 表格×8 + 版本状态徽标（DRAFT/IN_REVIEW/EXEC_MEETING/FINAL）+ 输入框×8 + 改期面板 + DAG 过程图×3 + 步骤条 + 传导边开关面板 + 浮层说明×5 + 导出按钮 | 主 1,111 + 子 2,237 | admin ✅ planner ✅ base_manager ✅ | 目标2 ✅✅（线上 S&OP · 产销协同主屏）· 目标1 ✅ |
| 9 | 接单组合优选 | `/v/global-sim` | 推演 → 第 4 项 | manifest：`portfolio` ✅；实调：`portfolio` `cross_object_occupancy`（+1） | 表格×7 + 杠杆面板 + 情景快照条 + 排程表 + 客户影响条 + 多目标 what-if 面板 + 帕累托前沿 + DAG 过程图×3 + 步骤条 + 浮层说明×15 + 重算确认弹窗 + 导出按钮 | 主 1,470 + 子 4,450（17 子件） | admin ✅ planner ✅ base_manager ❌（`roleViews` 显式排除） | 目标2 ✅✅（跨基地多工厂多目标优化 · 最优计划）· 目标3 ✅（利润最优方案） |
| 10 | 全链线路图 | `/v/chain-line-map` | **无导航入口**（`CONSOLIDATED_INTO_SANDBOX` 无条件收编 ⇒ 分组与 leftover 两处同时滤掉） | manifest：`chain_loss_attribution` ✅；实调：同 ✅（经常量 `CHAIN_LOSS_SOLVER_KEY`） | 地铁线路图（内联 SVG×7，站圈大小 ∝ 环节损失占比）+ 产品族并行线 + 图层勾选 + 浮层说明 | 主 1,008 + 子 3,675 | 后端仍下发给 admin/planner/base_manager，但**只能从沙盘中栏画布默认模式「线路图」到达** | 目标3补充 ✅（四级数字镜像 · 产出偏差映射） |
| 11 | 在途与在制 | `/v/transit-flow` | **无导航入口**（同上） | manifest：无；实调：无（`fetchAllObjects` 读 `/a/v1/objects`） | 线路图上的**图层**（内联 SVG×2 + 批次点）+ 图层开关 | 主 1,202 + 子 2,655 | 同上；到达路径 = 沙盘线路图上的「在途批次图层」勾选框 | 目标3补充 ✅（实时映射库存水位/在制） |
| 12 | 物理拓扑 | `/v/physical-topology` | **无导航入口**（同上） | manifest：无；实调：无（`fetchAllObjects` + `fetchTopologyFacts`） | 13 基地 × 10 工序**热力矩阵**（div 网格）+ 悬停详情面板 + 每格三态来源角标（真值/占位/EMPTY）+ 顶部常驻诚实横幅 | 主 530 + 子 891 | 同上；到达 = 沙盘画布模式条 →「物理拓扑」 | 目标3补充 ✅（集团-基地-车间-产线四级数字镜像） |
| 13 | 节点检视 | `/v/node-inspector` | **无导航入口**（同上） | manifest：无；实调：`chain_loss_attribution`（经常量）<br>**⚠ manifest 未绑而实调 1 个** | 右栏常驻检视面板：瀑布图（五段聚合）+ 属性/来源/规则/派生公式分节 + 浮层说明×6 + 下拉 | 主 1,052 + 子 2,906 | 同上；到达 = 沙盘右栏检视面板 → 页签「变量输入」 | 目标3补充 ✅（偏差根因分析） |
| 14 | 全链阻滞点 | `/v/chain-impediments` | **无导航入口**（同上） | manifest：`chain_impediments` ✅；实调：`chain_impediments` + `decision_play`（经内嵌 `DecisionPlayPanel`） | 分节卡片列表（三类互斥：卡点/堵点/断点）+ 每条：判定依据/阈值出处/dataMode 四态徽标 + 表格×1 + 内嵌决策推演面板 | 主 459 + 子 3,703 | 同上；到达 = 沙盘主屏阻滞点统计条 + 逐条清单 | 目标3补充 ✅✅（供应链风险预警与溯源定位 · 自动识别根因驱动处置） |
| 15 | 流程等待态 | `/v/process-wait` | **无导航入口**（「归因与风险」组第 1 项，但带 `consolidatedWhen:"sim.sandbox"`，沙盘开 ⇒ 隐藏） | manifest：无；实调：无（`fetchProcessDefinitions` / `fetchProcessInstances` / `fetchStuckProcesses`） | 表格×2（65 条流程定义按 `waitKind` 四态）+ KPI 条×2 + 浮层说明 + 逐站下钻链接 | 主 630 + 子 756 | admin ✅ planner ✅ base_manager ✅（**沙盘关时**才在导航单列）<br>到达 = 沙盘「归因」模式 → 档「流程等待态」 | 目标1 ✅（端到端流程体系的等待态可视）· 目标3补充 ✅ |
| 16 | 采购四段腿分解 | `/v/procurement-legs` | **无导航入口**（「归因与风险」组第 2 项 + `consolidatedWhen`，同上） | manifest：**刻意不绑**（注释写明 `kit_readiness` 是多路共用，绑上会连坐）<br>实调：`kit_readiness`（经常量 `KIT_READINESS_SOLVER_KEY`） | 「该找谁」总榜 + 逐缺料项：关键段横幅 → 四段瀑布条（span×52 拼出）→ 合计 → 责任方汇总 → MOQ/准时率；三态四重编码（`data-status` + 文案 + 形状纹理 + 功能后果） | 主 489 + 子 3,165 | admin ✅ planner ✅ base_manager ✅<br>到达 = 沙盘「归因」→ 档「采购四段腿」 | 目标3补充 ✅✅（供应链风险溯源定位 · 「今天该打哪通电话」） |

## B. 后端派单增量视图（`PLANVIEW_EXTRA_KEYS` 13 + `DARK_LAUNCH_EXTRA_KEYS` 5）

| # | 屏名 | 路由 | 导航位置 | 绑的求解器（manifest / 实调） | 主要组件形态 | 代码量 | 谁会看见它 | 服务哪条 COO 目标 |
|---|---|---|---|---|---|---|---|---|
| 17 | 年度规划（AOP） | `/v/annual-scenario` | 规划与平衡 → 第 1 项 | 无 manifest bindings；实调：无（`fetchAop` → `/a/v1/plan/aop`） | EChart（柱×1 + 折线×2）+ 表格×1 + 情景拍板按钮（`actionTypeKey: AOP情景拍板`，`finalizeFeature: act.aop-finalize`） | 主 346 + 子 0 | admin ✅ planner ✅ base_manager ❌（不在 `baseManagerExtras` 白名单） | 目标1 ✅✅（预测→销售计划链条起点）· 目标2 ✅ |
| 18 | 季度规划 | `/v/quarterly-rolling` | 规划与平衡 → 第 2 项 | 无；实调：无（`fetchQuarterly` + `fetchRules`） | 表格×1（6 期滚动，gapTiers red≥4 / yellow≥0）+ 按钮×2 | 主 156 + 子 0 | admin ✅ planner ✅ base_manager ❌ | 目标1 ✅（滚动计划）· 目标2 ✅ |
| 19 | 订单进展与卡因 | `/v/order-chain` | 推演 → 第 6 项 | 无 manifest bindings；实调：`order_fullchain` `affected_orders` `kit_readiness` `quote_margin` `chain_loss_attribution` `decision_play`（**6 个**）<br>**⚠ manifest 零绑定，实调 6 个** | 表格×4 + 四分类下拉（交期/毛利/齐套/信用）+ 细分色带 + DAG 过程图×2 + 步骤条 + 传导边开关面板 + 内嵌决策推演面板 + 溯源角标×7 + 导出按钮 | 主 1,438 + 子 5,127（11 子件） | admin ✅ planner ✅ base_manager ✅（在白名单内） | 目标1 ✅✅（交付全链）· 目标3 ✅（四维利润与成本透视）· 目标3补充 ✅（偏差根因） |
| 20 | 基地地理视图 | `/v/geo-map` | 台账与地图 → 第 2 项 | 无；实调：无（`fetchAllObjects(Base)`） | 地理散点/气泡（内联 SVG×1，size ∝ gwh，color ∝ kind，利用率阈值 92/85/78）+ 按钮×4 | 主 240 + 子 0 | admin ✅ planner ✅ base_manager ❌ | 目标2 ✅（多基地负荷监控） |
| 21 | 运营复盘 | `/v/review` | 规划与平衡 → 第 6 项 | 无；实调：无（`fetchHistoryBundle` → `/a/v1/history/bundle`） | EChart 折线×1（MAPE 收敛曲线 + 危机回弹点标注）+ 表格×4（参数校准史/S&OP 版本史/Action 审计史分页/规则演进） | 主 280 + 子 0 | admin ✅ planner ✅ base_manager ✅ | 目标3补充 ✅✅（业务闭环持续改进 · 反向迭代优化模型 · 沉淀决策资产） |
| 22 | 图谱·全景 | `/v/graph-all` | 图谱体系（默认折叠）→ 第 1 项 | 无；渲染器 = `ontology-graph` | 同 #2（力导向图），差异仅 `graphOptions`：`colorBy:domain, layoutSeed:42` | 复用 #2 的 610+440 | admin ✅ planner ✅ base_manager ❌ | **挂不到任何有金额场景** |
| 23 | 图谱·主干分级 | `/v/graph-backbone` | 图谱体系 → 第 2 项 | 同上 | 同上，`nodeFilter.tiers:[0,1] + dimOthers` | 复用 | 同上 | **挂不到** |
| 24 | 图谱·产能推演网络 | `/v/graph-flow` | 图谱体系 → 第 3 项 | 同上 | 同上，`linkKinds:["flow","agg"]` | 复用 | 同上 | **挂不到**（叙事描述提到产能金字塔，但屏上无任何金额/数量读数） |
| 25 | 图谱·数据来源 | `/v/graph-source` | 图谱体系 → 第 4 项 | 同上 | 同上，`colorBy:"source"` | 复用 | 同上 | **挂不到** |
| 26 | 图谱·求解器 | `/v/graph-solver` | 图谱体系 → 第 5 项 | 同上 | 同上，`nodeFilter.domains:["solver"] + linkKinds:["calc"]` | 复用 | 同上 | **挂不到** |
| 27 | 图谱·MVP | `/v/graph-mvp` | 图谱体系 → 第 6 项 | 同上 | 同上，`mvpOverlay:true` | 复用 | 同上 | **挂不到** |
| 28 | 图谱·智能体网络 | `/v/graph-agent` | 图谱体系 → 第 7 项 | 同上 | 同上，`nodeFilter.domains:["agent","solver"] + linkKinds:["orch"]` | 复用 | 同上 | **挂不到** |
| 29 | 图谱·学习闭环 | `/v/graph-loop` | 图谱体系 → 第 8 项 | 同上 | 同上，`nodeFilter.ids:LOOP_NODE_IDS + linkKinds:["fb","orch"]`，描述卡带链接 → `/admin/calibration` | 复用 | 同上 | 目标3补充 ◐（叙事指向「越用越准」，但本屏本身只是一张静态视角图） |
| 30 | 流程卡点（实例层） | `/v/process-stuck` | **无导航入口 ×2 重**：① 「归因与风险」组第 3 项但带 `consolidatedWhen`（沙盘开⇒隐藏）② `process.runtime` 暗发关 ⇒ 后端根本不下发 ⇒ `/v/process-stuck` **404** | 无；实调：无（`fetchStuckProcesses` → `/a/v1/process-instances/stuck`） | 卡片列表（每条 = 一张正在跑的单卡在第几步/等谁/等多久）+ 五等待态计数条 + 诚实位空态（区分「本投影算不出」vs「真的没有」）+ 按模板起实例的表单 | 主 355 + 子 362 | **今天谁都看不见**（功能位 `process.runtime` 默认关）<br>开通后：admin ✅ planner ✅ base_manager ❌ | 目标3补充 ✅（四类偏差根因分析）— 但**今天零可见性** |
| 31 | 推演指控台 | `/v/sim-console` | **无导航入口**（推演组第 3 项 + `consolidatedWhen:"sim.sandbox"`，沙盘开⇒隐藏） | 无 manifest；实调：`chain_loss_attribution` | 沙盘首页「指控台」：流向图 + 指标时序 + 世界态版本条 | 主 99 + 子 7,255（16 子件） | admin ✅ planner ✅ base_manager ✅（受 `sim.sandbox` 一把闸）<br>到达 = 统一推演控制台首档「指标态势」（**版面替代**：37 张指标卡墙取代旧首屏），`/v/sim-console` 深链仍可直达旧版面 | 目标2 ✅（What-if 仿真入口）· 目标3 ✅ |
| 32 | 传导识别 | `/v/sim-conduction` | **无导航入口**（同上，推演组第 4 项） | 无 manifest；实调：`chain_loss_attribution` `bottleneck_matrix` `mitigation_select` | 扰动树 + 影响锥 + 热力矩阵 + 甘特 + 瀑布图 + 策略卡 | 主 288 + 子 4,438 | 同上；到达 = 统一推演控制台顶部页签「传导识别」 | 目标2 ✅（业务变动实时响应）· 目标3补充 ✅ |
| 33 | 损失归因 | `/v/sim-attribution` | **无导航入口**（同上，推演组第 5 项） | 无 manifest；实调：`chain_loss_attribution` | 瀑布图 + 热力矩阵 + 归因分档表 | 主 154 + 子 3,254 | 同上；到达 = 页签「损失归因」 | 目标3 ✅（四维利润与成本透视）· 目标3补充 ✅ |
| 34 | 方案寻优 | `/v/sim-optimize` | **无导航入口**（同上，推演组第 6 项） | 无 manifest；实调：无（会话态取数 `useParetoFrontier` / `useConsoleSession`） | 帕累托前沿散点 + 权衡雷达 + 策略卡 + 方案对比表 | 主 211 + 子 3,774 | 同上；到达 = 页签「方案寻优」 | 目标2 ✅（多目标优化）· 目标3 ✅（算法仿真推演利润最优方案） |

## C. 前端专用静态 route（`App.tsx` `{ path: "v/<静态段>" }` × 8 · 不依赖 workspace 下发）

| # | 屏名 | 路由 | 导航位置 | 绑的求解器（实调） | 主要组件形态 | 代码量 | 谁会看见它 | 服务哪条 COO 目标 |
|---|---|---|---|---|---|---|---|---|
| 35 | 推演沙盘 | `/v/sim-sandbox` | 推演 → 第 2 项 ✅ | `chain_impediments` `chain_loss_attribution` `concentration_risk` `margin_attribution` `shared_bottleneck` `supplier_disruption_radius` `optimize_whatif` `generic_inference` `decision_play` `finance_world_projection`（**10 个**，含收编进来的 12 页） | 五模式切换（现状→归因→试一手→求最优→影响半径，`SANDBOX_MODES`）× 画布五模式（`CANVAS_MODES`: metro/topo/chain/ontology/process）+ 右栏常驻检视 + 归因模式四档（净室归因/流程等待态/流程卡点/采购四段腿）+ 就绪认证栏 + 影响带 + 打法面板 | 主 2,630 + 子 25,457（39 子件） | admin ✅ planner ✅ base_manager ✅<br>route 带 `feature:"sim.sandbox"` + `SimSandboxGuard` 页面侧守卫（关⇒入口消失+404）；demo 租户该位**实际为开** | 目标2 ✅✅（What-if 仿真主屏）· 目标3 ✅✅ · 目标3补充 ✅✅ |
| 36 | 统一推演控制台 | `/v/sim-unified` | 推演 → 第 1 项 ✅（本组主入口） | `chain_impediments` | 五区外壳：左栏扰动导轨（可收合）+ 中栏模式页签（指标态势/传导识别/损失归因/方案寻优/演习结论/产销线路图/传导边册/本体与就绪）+ 指标卡墙（37 张）+ 右栏检视 + 底部抽屉 + 披露面板 + 帕累托图 | 主 1,101 + 子 10,465（25 子件） | admin ✅ planner ✅ base_manager ✅<br>**无 entitlement Guard**（实测 `grep -c "feature\|Guard"` = 0），人人可进 | 目标2 ✅✅ · 目标3 ✅✅ |
| 37 | 事件影响与对策（决策台） | `/v/decision-console` | 顶层无标题组 → 第 2 项 ✅（刻意放顶层：分组折叠态持久化会让它消失） | `chain_impediments` `finance_world_projection` `risk_timeline` | **一页六区**：区①左栏「加几件事」+ 唯一的〔算一下〕· 区②算的时候（一行+进度条）· 区③钱上差多少 · 区③b 客户与订单 · 区④哪儿会出事 · 区⑤有几条路 · 区⑥这次算的时候做了什么（可披露的演算过程） | 主 2,355 + 子 345 | admin ✅ planner ✅ base_manager ✅（`kind:"route"` 无 feature 无 consolidatedWhen ⇒ 三个角色都看得到） | 目标3 ✅✅（支撑管理层科学决策 · 经营结果可预判）· 目标2 ✅（业务变动实时响应） |
| 38 | 决策推演 | `/v/decision-play` | **无导航入口**（显式声明在 `ShellLayout.ROUTE_NO_NAV`，仓主裁决：「不该占导航位，应嵌入每个需要决策的点」） | `decision_play` | 5 区决策产物面板（`DecisionPlayPanel`）：方案对比表 + 弹窗×7 + 按钮×6 | 主 46 + 子 3,867（9 子件） | 三角色都可进（route 无 feature），但**只能靠深链/嵌入点**：已嵌入 `OrderChainView` 订单面板 · `ChainImpedimentView` 逐条阻滞点 · `ShellLayout` 对话坞上方 · `DashboardView` 入口 · `SandboxConsole` 方案对比那一跳 | 目标3 ✅（模型算法输出优化建议） |
| 39 | 假设推演 | `/v/what-if` | **无导航入口**（推演组 `kind:"route"` + `consolidatedWhen:"sim.sandbox"`，沙盘开⇒隐藏） | `generic_inference` | 四级表单（类型→对象→属性→假设值）+ 影响传播面板 + deltas 表 + 过程图 + 步骤条 + 溯源角标 | 主 818 + 子 2,550 | 三角色都可进（无 entitlement）<br>到达 = 沙盘模式切换 →「试一手」 | 目标2 ✅（What-if 仿真）· 目标3 ✅ |
| 40 | 优化推演 | `/v/optimize-whatif` | **无导航入口**（同上） | `optimize_whatif` | opt-template 族选择 + 参数扰动表单 + 目标 Δ 表 + 分层 DAG + 步骤条 + 传导边开关面板 + 导出按钮 | 主 924 + 子 1,876 | 同上；到达 = 沙盘 →「求最优」 | 目标2 ✅（多目标优化算法计划方案） |
| 41 | 净室归因 | `/v/cleanroom-attr` | **无导航入口**（「归因与风险」组第 4 项 + `consolidatedWhen`） | `shared_bottleneck` `concentration_risk` `margin_attribution`（3 个通用求解器） | 三页签（共享瓶颈/隐性集中度/毛利倒挂归因）+ 表格 + 参数派生表单 | 主 795 + 子 1,146 | 同上；到达 = 沙盘「归因」→ 档「净室归因」 | 目标3 ✅✅（四维利润与成本透视）· 目标3补充 ✅ |
| 42 | 断供影响半径 | `/v/disruption-radius` | **无导航入口**（「归因与风险」组第 5 项 + `consolidatedWhen`） | `supplier_disruption_radius` | 断供来源选择器 + 分层 DAG 扇出图（逐层）+ DAG 节点检查器 + 步骤条 + 传导边开关面板 + 导出按钮 | 主 887 + 子 1,661 | 同上；到达 = 沙盘 →「影响半径」 | 目标3补充 ✅✅（供应链风险预警与溯源定位） |

## D. 其他业务 route（非 `/v/` × 5）

| # | 屏名 | 路由 | 导航位置 | 绑的求解器 | 主要组件形态 | 代码量 | 谁会看见它 | 服务哪条 COO 目标 |
|---|---|---|---|---|---|---|---|---|
| 43 | 首页 | `/` | 无导航条目（logo/根路径落点；**侧栏无 `to="/"` 链接**，实测 `grep 'to="/"' ShellLayout.tsx components/` 零命中） | 无 | 热门场景卡墙（`rankHotScenarios`）+ route 入口块（与侧栏共用 `isViewConsolidatedAway`/`isRouteRefHidden` 同一份收编判定）+「全部场景 →」链接 | 主 198 + 子 0（同目录 `rankHotScenarios` 36 / `useScenarioLaunch` 114） | 三角色 ✅ | 目标3 ◐（入口聚合，不产出决策） |
| 44 | 场景启动器 | `/scenarios` | **侧栏顶部硬编码 NavLink「⚡ 场景启动器」**（在 13 个分组之上，游离于 `NAV_GROUPS` 之外 ⇒ 不在 83 项里） | 无（卡片按 `card.solver` 分派） | 场景目录墙（**20 张卡**，`agentcore/scenarios-catalog.ts`）+ ⌘K 命令面板快搜 | 主 71 + 子 0（命令面板 97） | 三角色 ✅ | 目标3 ◐（导航装置） |
| 45 | 查询任务详情 | `/tasks/:taskId` | **无导航入口**（深链页，从 QueryDock/历史面板跳入） | 无 | SSE 事件流回放 + 阶段时间线 + 结果渲染 | 主 135 | 三角色 ✅ | 目标3 ◐ |
| 46 | 对象 360 | `/o/:typeKey/:objectKey` | **无导航入口**（溯源链终点，从各表格行下钻进入） | 无 | 对象属性卡 + 邻居关系 + 溯源链 | 主 96 | 三角色 ✅ | 目标3补充 ✅（数据资产沉淀 · 溯源定位） |
| 47 | 流程实例详情 | `/process-instances/:instanceId` | **无导航入口**（刻意不走 `v/` 前缀，见 `App.tsx:169-175` 的长注；入口在卡点卡片与实例下钻行） | 无（`fetchProcessInstance` + `advance`） | 步骤时间线×6 + 推进表单（输入框×4）+ 检视面板 | 主 561 + 子 355 | 三角色 ✅（但上游 `process-stuck` 页今天不可达 ⇒ 实际只剩 `process-wait` 那条下钻） | 目标1 ✅（端到端流程执行）· 目标3补充 ✅ |

## E. 管理屏（49 个 · `/admin/*`）

> 形态高度同构，故合并描述：**表格 + 表单 + 弹窗**为主（CRUD 台），少数带图（`OntologyRelationsPage` 关系编辑器、`DataBuilderFlow` 流程图、`PlanBuilderPage` 画布、`CalibrationPage` MAPE 趋势图、`MetaPage` 元模型视图）。
> **谁会看见它**：`visibleAdminPages(roles)` 只按角色过滤，**不看 entitlement**。demo 三角色实测：admin **46/47**、planner **4/47**（calibration · external-signals · notifications · org）、base_manager:常州 **0/47**。

| # | 屏名 | 路由 | 导航位置 | 代码量 | 谁会看见它 | 服务哪条 COO 目标 |
|---|---|---|---|---|---|---|
| 48 | 数据接入 | `/admin/connections` | 数据接入 → 1 | 394 | admin | 目标1 ◐（数据底座） |
| 49 | 字段画像 | `/admin/connections/:connId/schema` | **无导航入口**（连接页子页） | 242 | admin | 目标1 ◐ |
| 50 | 规则文档审核 | `/admin/rule-docs` | 数据接入 → 2 | 257 | admin | 目标1 ◐ |
| 51 | 合成数据 | `/admin/synthetic` | 数据接入 → 3 | 240 | admin | **挂不到**（演示装置） |
| 52 | 外部信号 | `/admin/external-signals` | 数据接入 → 4 | 139 | admin · planner | 目标2 ◐（需求预测输入） |
| 53 | 隔离区 | `/admin/quarantine` | 数据接入 → 5 | 158 | admin | 目标1 ◐ |
| 54 | 本体建模 | `/admin/modeling` | 建模与图谱 → 2 | 576 | admin | 目标1 ◐ |
| 55 | 对象类型浏览 | `/admin/object-types` | 建模与图谱 → 3 | 195 | admin | **挂不到** |
| 56 | 业务域 | `/admin/domains` | 建模与图谱 → 4 | 54 | admin | **挂不到** |
| 57 | 对象接口 | `/admin/interfaces` | 建模与图谱 → 5 | 428 | admin | **挂不到** |
| 58 | 本体关系编辑器 | `/admin/ontology-relations` | 建模与图谱 → 6 | **1,892**（全仓最大管理页） | admin | 目标2 ◐（传导规则是 What-if 的配置面）· 目标3补充 ◐ |
| 59 | 切片 | `/admin/slices` | 建模与图谱 → 7 | 356（+ `SliceLayersPanel` 542 / `SliceInspector` 373） | admin | **挂不到** |
| 60 | 切片库 | `/admin/slice-library` | 建模与图谱 → 8 | 262 | admin | **挂不到** |
| 61 | 合并 | `/admin/merge` | 建模与图谱 → 9 | 107 | admin | **挂不到** |
| 62 | 边界册治理 | `/admin/boundary` | 建模与图谱 → 10 | 61 | admin | **挂不到** |
| 63 | 原型 intake | `/admin/prototype-intake` | 建模与图谱 → 11 | 357 | admin | **挂不到** |
| 64 | 规则库 | `/admin/rules` | 规则与校准 → 1 | 551（+ `DslTextarea` 166） | admin | 目标1 ◐ · 目标2 ◐ |
| 65 | 校准报告 | `/admin/calibration` | 规则与校准 → 2 | 318 | admin · planner | 目标3补充 ✅（反向迭代优化模型 · MAPE 趋势） |
| 66 | 数据构建器 | `/admin/data-builder` | 构建与成长 → 1 | 1,421（+ `DataBuilderFlow` 500 / `templateSuggest` 26） | admin | **挂不到** |
| 67 | 管线配置 | `/admin/pipelines` | 构建与成长 → 2 | 219 | admin | **挂不到** |
| 68 | 成长驾驶舱 | `/admin/growth` | 构建与成长 → 3 | 265 | admin | **挂不到** |
| 69 | 评测 | `/admin/evals` | 构建与成长 → 4 | 159 | admin | **挂不到** |
| 70 | 求解器目录 | `/admin/solvers` | 构建与成长 → 5 | 344 | admin | **挂不到** |
| 71 | 求解器审核 | `/admin/solver-review` | 构建与成长 → 6 | 219（+ `PromotePrecheckPanel` 202） | admin | **挂不到** |
| 72 | 意图目录 | `/admin/catalog` | 编排与场景 → 1 | 495 | admin | **挂不到** |
| 73 | Agent 注册表 | `/admin/agents` | 编排与场景 → 2 | 1,042（+ `VirtualOpsTeamPanel` 178 / `KnowledgeBasePanel` 206） | admin | **挂不到** |
| 74 | Workflow | `/admin/workflows` | 编排与场景 → 3 | 873 | admin | **挂不到** |
| 75 | Skill | `/admin/skills` | 编排与场景 → 4 | 205（+ `SkillStructure` 594） | admin | **挂不到** |
| 76 | MCP 服务器 | `/admin/mcp` | 编排与场景 → 5 | 137 | admin | **挂不到** |
| 77 | 场景入口 | `/admin/scenes` | 编排与场景 → 6 | 493 | admin | **挂不到** |
| 78 | 智能资源治理台 | `/admin/resources` | 编排与场景 → 7（**条目在、点进去 404**：`qos.dril-routing` 在 `QOS_DARK_LAUNCH_FEATURES` ⇒ 对 demo 关） | 369 | 导航：admin；实际：**无人**（404） | **挂不到** |
| 79 | 计划构建器 | `/admin/plan-builder` | 编排与场景 → 8 | 846 | admin（`admin.plan-builder` defaultOn:true ⇒ 可进） | 目标2 ◐（no-code 组 solver 链） |
| 80 | 兜底运营 | `/admin/ops/fallback` | 编排与场景 → 9 | 82 | admin | **挂不到** |
| 81 | 视图配置 | `/admin/views` | 编排与场景 → 10 | 344 | admin | **挂不到** |
| 82 | Action 审批中心 | `/admin/actions` | 运营与审批 → 1 | 324 | admin | 目标1 ✅（计划落地的审批闭环）· 目标3补充 ✅ |
| 83 | 组织世界 | `/admin/org` | 运营与审批 → 2（**条目在、点进去 404**：`org.world` 在 `WORLD_DARK_LAUNCH_FEATURES`） | 387 | 导航：admin · planner；实际：**无人**（404） | 目标1 ◐（该谁批）— 今天零可见性 |
| 84 | 运营编排 | `/admin/ops-schedule` | 运营与审批 → 3 | 263（+ `SimClockConsole` 144） | admin | **挂不到** |
| 85 | 定时任务台 | `/admin/scheduler` | 运营与审批 → 4 | 152 | admin | **挂不到** |
| 86 | 工厂日历 | `/admin/calendars` | 运营与审批 → 5 | 183 | admin | 目标2 ◐（产能模型的可用工时输入） |
| 87 | 通知 | `/admin/notifications` | 运营与审批 → 6 | 56 | admin · planner | 目标3补充 ◐（预警送达） |
| 88 | 校验 | `/admin/validation` | 运营与审批 → 7 | 149 | admin | **挂不到** |
| 89 | 租户管理 | `/admin/tenants` | 平台与系统 → 1（**demo admin 看不到**：需 `platform_admin`） | 163 | 无（demo 无 platform_admin 账号） | **挂不到** |
| 90 | 用户管理 | `/admin/users` | 平台与系统 → 2 | 254 | admin | **挂不到** |
| 91 | 权限策略 | `/admin/permissions` | 平台与系统 → 3 | 190 | admin | **挂不到** |
| 92 | 功能开通 | `/admin/features` | 平台与系统 → 4 | 275 | admin | **挂不到** |
| 93 | LLM 供应商 | `/admin/llm-providers` | 平台与系统 → 5 | 712 | admin | **挂不到** |
| 94 | 配置迁移 | `/admin/config-migration` | 平台与系统 → 6 | 198 | admin | **挂不到** |
| 95 | 系统自我（元模型） | `/admin/meta` | 平台与系统 → 7 | 101（+ `DataCategoriesPanel` 144） | admin | **挂不到** |
| 96 | 推演历史 | `/admin/query-history` | **完全到不了**（详见《到不了的屏》①） | 85 | **无人** | **挂不到** |
| 97 | 登录 | `/login` | 无（未登录落点） | 65 | 全部 | — |

---

# 《挂不到任何有金额经营场景的屏》

**金丝雀先行**（证明我的追法是好的，不是追不动）：
- 订单台账（#4）→ 后端 `LEDGER_LAYOUT.objectType = "Order"` → `battery.ts` 订单簿 Σ`Order.value` = **454.64 亿 / 500 单**（`battery.ts:5362`，`ORDER_BOOK_SIZE=500` 在 `:603`）。✅ 追得到。
- 接单组合优选（#9）→ `portfolio` 求解器 → 方案寻优毛利 **250.60 亿**。✅ 追得到。
⇒ 追法有鉴别力。下面报的「追不到」是测量结果，不是工具坏了。

### 第一档 · 业务屏里追不到金额场景的（9 个）

| 屏 | 为什么追不到 |
|---|---|
| 本体图谱 `/v/graph`（#2） | 屏上是对象类型与结构边，没有任何一个读数带单位或金额。实测：`grep` 金额词（亿元/万元/毛利/营收/成本/金额/现金/利润…）**0 命中**、订单/客户词 **0 命中**（金丝雀：`risk` 同一把尺子 44 / 68 命中）。它回答的是「平台是怎么接线的」，不是「这单值多少钱」。 |
| 图谱·全景 `/v/graph-all`（#22） | 同上，且与 #2 **同一个 renderer、同一份组件**，差别只在 `graphOptions`。 |
| 图谱·主干分级 `/v/graph-backbone`（#23） | 同上 |
| 图谱·产能推演网络 `/v/graph-flow`（#24） | 叙事描述里提到产能金字塔与节拍，但屏上**一个真实读数都没有**（配置只有 `linkKinds` 过滤） |
| 图谱·数据来源 `/v/graph-source`（#25） | 同上 |
| 图谱·求解器 `/v/graph-solver`（#26） | 同上 |
| 图谱·MVP `/v/graph-mvp`（#27） | 同上 |
| 图谱·智能体网络 `/v/graph-agent`（#28） | 同上 |
| 合成数据 `/admin/synthetic`（#51） | 它生产演示数据本身，不服务任何经营决策 |

**⚠ 这一档最重的一句**：八张「图谱体系」视角（#22–#29）**共用同一个组件、同一份代码**，差别只在一个 `graphOptions` 字面量 —— 它们在导航里占了**一个完整分组的 8 个位置**（`图谱体系`组，全部声明项的 9.6%），而与 `/v/graph`（#2）相加共 **9 个入口指向同一个 610 行组件**。

### 第二档 · 管理屏里追不到的（34 个）

`object-types` · `domains` · `interfaces` · `slices` · `slice-library` · `merge` · `boundary` · `prototype-intake` · `data-builder` · `pipelines` · `growth` · `evals` · `solvers` · `solver-review` · `catalog` · `agents` · `workflows` · `skills` · `mcp` · `scenes` · `resources` · `ops/fallback` · `views` · `ops-schedule` · `scheduler` · `validation` · `tenants` · `users` · `permissions` · `features` · `llm-providers` · `config-migration` · `meta` · `query-history` = **34**（`synthetic` 已计入第一档，不重复）

这些是**平台自身的建设/治理台**，不是客户 COO 的经营场景。它们不该按「有没有金额场景」判生死 —— 但它们占了 **49 个管理屏中的 34 个**；在 `NAV_GROUPS` 83 条声明项里，admin 类条目共 **47 条**，其中 **32 条**属于这一档（`query-history` 不在 NAV_GROUPS、`connections/:connId/schema` 是子页）⇒ **导航面积的 38.6%（32/83）对 COO 的四组目标零贡献**。

---

# 《重复与重叠》

## 1) 求解器 → 消费它的视图（反向表 · 只列被 ≥2 张屏消费的）

| 求解器 | 被几张屏消费 | 哪些屏 |
|---|---|---|
| `chain_loss_attribution` | **7** | chain-line-map · node-inspector · order-chain · sim-console · sim-conduction · sim-attribution · sim-sandbox |
| `risk_timeline` | **5** | dash · risk · plan-audit · plan-generate · decision-console |
| `chain_impediments` | **4** | chain-impediments · sim-unified · sim-sandbox · decision-console |
| `decision_play` | **4** | chain-impediments · order-chain · sim-sandbox · decision-play |
| `generic_inference` | **4** | risk · project-sim · sim-sandbox · what-if |
| `affected_orders` | 3 | dash · risk · order-chain |
| `bottleneck_matrix` | 3 | risk · project-sim · sim-conduction |
| `concentration_risk` | 2 | sim-sandbox · cleanroom-attr |
| `finance_world_projection` | 2 | sim-sandbox · decision-console |
| `gap_attribution` | 2 | dash · risk |
| `kit_readiness` | 2 | procurement-legs · order-chain |
| `margin_attribution` | 2 | sim-sandbox · cleanroom-attr |
| `mitigation_select` | 2 | risk · sim-conduction |
| `optimize_whatif` | 2 | sim-sandbox · optimize-whatif |
| `shared_bottleneck` | 2 | sim-sandbox · cleanroom-attr |
| `supplier_disruption_radius` | 2 | sim-sandbox · disruption-radius |
| `audit_timeline` | 2 | plan-audit · plan-generate（经共享件 `components/KsfGraph.tsx`） |
| `ksf_graph` | 2 | plan-audit · plan-generate（同上） |

单消费方（各 1 张）：`base_capacity_outlook`(risk) · `capacity_forecast`(project-sim) · `cockpit_kpi`(dash·后端 layout 声明) · `counterfactual_timeline`(dash) · `cross_object_occupancy`(global-sim) · `finance_pnl`(sop-balance) · `metric_rollup`(dash) · `mrp_netting`(sop-balance) · `order_fullchain`(order-chain) · `plan_audit`(plan-audit) · `plan_generate`(plan-generate) · `plan_rootcause`(dash) · `portfolio`(global-sim) · `quote_margin`(order-chain) · `sop_reschedule`(sop-balance) · `supply_demand_gap_attribution`(dash)。

**覆盖率**：`SOLVER_KEYS` 共 **63** 个，前端有消费方的 **34** 个 ⇒ **29 个求解器在前端零消费方**：

`capacity_rollup` `capacity_ledger` `capex_scenario` `cert_schedule` `lta_gap` `inventory_optimize` `changeover_sequence` `yield_diagnosis` `maintenance_stagger` `outsourcing_split` `credit_exposure` `quarterly_gap` `carbon_footprint` `countermeasure_combo` `supply_vulnerability` `atp_check` `ontology_query` `process_flow_time` ＋ **CP-SAT 可证最优族 11 个全数零消费**（`selection_optimize` `assignment_optimize` `sequencing_optimize` `packing_optimize` `job_shop_schedule` `facility_location` `min_cost_flow` `set_cover` `independent_set` `combinatorial_auction` `multi_objective`）。

⚠ **三条口径必须说清楚，否则这个数会被读反**：
1. 此数只算**前端屏**的消费方（组件调用位 + 后端 layout 的 `solverKey` 声明两条路）。
2. **QOS 问答路径不在射程**：`agentcore/scenarios-catalog.ts` 的 20 张场景卡各自绑一个 `card.solver`，用户在对话坞问问题也会打到求解器 —— 那批不经任何「屏」。
3. 我已被工具骗过两次，两次都靠金丝雀抓回来：① 字面量正则看不见 `useLiveSolver("portfolio")` 与三个常量传入的 key；② 闭包若只限 `views/**` 就漏掉 `components/KsfGraph.tsx`，而若放开到全 `src` 则 `api/endpoints.ts:483` 里那条 `"/a/v1/solvers/generic_inference/invoke"` 会让 **35 张屏全部误报消费 `generic_inference`**（因为每张屏都 import endpoints）。最终口径 = views 闭包 + 手工核过的共享件 + 后端 layout 声明。

## 2) 三套「推演控制台」在做同一件事

| 屏 | 收编了谁 | 代码量 |
|---|---|---|
| **推演沙盘** `/v/sim-sandbox`（#35） | **12 页**：chain-line-map · transit-flow · physical-topology · node-inspector · chain-impediments · cleanroom-attr · what-if · optimize-whatif · disruption-radius · process-wait · process-stuck · procurement-legs | 主 2,630 + 子 25,457 |
| **统一推演控制台** `/v/sim-unified`（#36） | **4 页**：sim-console · sim-conduction · sim-attribution · sim-optimize | 主 1,101 + 子 10,465 |
| **事件影响与对策** `/v/decision-console`（#37） | 0（自成一页六区） | 主 2,355 + 子 345 |

三者**并排挂在导航最显眼的位置**（顶层第 2 项 + 推演组第 1、2 项），各有各的模式/页签体系：
- 沙盘 = 五问（现状/归因/试一手/求最优/影响半径）× 五画布（metro/topo/chain/ontology/process）× 归因四档
- 统一壳 = 八页签（指标态势/传导识别/损失归因/方案寻优/演习结论/产销线路图/传导边册/本体与就绪）
- 决策台 = 六区（加事情/算的时候/钱上差多少/客户与订单/哪儿会出事/有几条路/演算过程）

**「现状」这一问在三处各有一个实现**：沙盘 `now` 模式 · 统一壳 `now` 档（37 张指标卡墙）· 决策台区③。
`CONSOLIDATED_INTO_SANDBOX` 这张表里 **16 个键、两个不同的收编宿主**（`host: "sim-sandbox"` 12 条 / `host: "sim-unified"` 4 条）。

## 3) 「流程」这条线上的三张屏

| 屏 | 答什么 | 数据源 |
|---|---|---|
| `process-wait`（#15） | 这**类**流程通常在等哪一类东西（65 条模板的 `waitKind`） | `/a/v1/process-definitions` |
| `process-stuck`（#30） | **这一张单**此刻卡在第几步、等谁、等多久 | `/a/v1/process-instances/stuck` |
| `process-instances/:id`（#47） | 这一张单的完整步骤时间线 + 推进 | `/a/v1/process-instances/:id` |

三者**没有重复**（模板层 / 实例层汇总 / 单实例详情），但**三者今天在导航里的可见性都是 0**：#15 被收编、#30 暗发关、#47 是深链页。

## 4) 「归因」这一问在五处各有一张屏

`cleanroom-attr`（净室三通用求解器）· `sim-attribution`（链路损失瀑布）· `chain-impediments`（三类阻滞）· `node-inspector`（节点五段瀑布）· `dash` 的归因 DAG widget。其中 `chain_loss_attribution` 这一个求解器就被其中三张屏各画了一遍（瀑布/线路图/矩阵）。

## 5) 图谱九入口一组件

`/v/graph` + `graph-all/backbone/flow/source/solver/mvp/agent/loop` = **9 个 viewKey、1 个 renderer（`ontology-graph`）、1 个组件（`OntologyGraphView.tsx` 610 行）**。后端 `VIEW_FEATURE_MAP` 甚至为 `graph` 额外注册了一个同名别名 `"ontology-graph": "view.ontology-graph"`（两个 viewKey 指同一功能）⇒ 实际是 **10 个键**。

---

# 《到不了的屏》（实测，不是猜）

## ① 真·死屏（route 存在，但任何路径都进不去）——1 个

**`/admin/query-history`（推演历史，85 行）**

三条证据链，缺一条这个结论都不成立：
1. `App.tsx:252` 有 `admin("query-history", <QueryHistoryPage />)` ⇒ route 存在；
2. 该 route 走 `AdminGuard path="query-history"`，而 `AdminGuard.tsx:19-20` 是
   `const page = ADMIN_PAGES.find(p => p.path === path); if (!page) return <NotFoundPage />;`
   —— `query-history` **不在** `adminRegistry.ADMIN_PAGES`（47 条）里 ⇒ **手敲 URL 也 404**；
3. 全仓前端 `grep -rn "admin/query-history" apps/frontend-shell/src` ⇒ 除 `App.tsx` 那行 route 定义外**零命中**，没有任何 `<Link>`/`<NavLink>` 指向它。
   **金丝雀**：同一把尺子跑 `admin/calibration` 命中 3 处（`CalibrationPage.tsx` / `NotificationsPage.tsx` / `fixtures.ts`）⇒ grep 是活的。

⚠ 后端 `synthetic/service.ts` 的 `ADMIN_NAV` 里**有** `{ key: "query-history", label: "推演历史" }`，但左导航渲染读的是**前端** `visibleAdminPages()`，不是后端 `workspace.navigation` 的 admin 段 ⇒ 后端那一行下发了也没人读。

## ② 导航条目在、但点进去 404 ——2 个

| 屏 | 为什么 |
|---|---|
| `/admin/resources`（智能资源治理台，369 行） | 导航「编排与场景」第 7 项**在**（`visibleAdminPages` 只按角色过滤），而 route 挂 `featureKey="qos.dril-routing"`，该键在 `QOS_DARK_LAUNCH_FEATURES` ⇒ demo 租户为关 ⇒ `AdminGuard` 先判 feature，返回 404 |
| `/admin/org`（组织世界，387 行） | 同一形态，`org.world` 在 `WORLD_DARK_LAUNCH_FEATURES` |

## ③ 有 route/有下发，但导航里没有入口（**声明式的**，有登记表、有门对账）——16 个

**A. 无条件收编（`CONSOLIDATED_INTO_SANDBOX` 有、NAV_GROUPS 里根本没有条目）——5 个**
`chain-line-map` · `transit-flow` · `physical-topology` · `node-inspector` · `chain-impediments`
（`requires:["sim.sandbox"]` ⇒ 沙盘关时后端连下发都不下发，故不留回退条目）

**B. 条件收编（NAV_GROUPS 里有条目，但带 `consolidatedWhen:"sim.sandbox"`，而该位对 demo 为 ON ⇒ 此刻隐藏）——11 个**

| 组 | 键 |
|---|---|
| 推演 | `sim-console` · `sim-conduction` · `sim-attribution` · `sim-optimize` · `what-if` · `optimize-whatif` |
| 归因与风险 | `process-wait` · `procurement-legs` · `process-stuck` · `cleanroom-attr` · `disruption-radius` |

⇒ **「归因与风险」整组 5 项全隐藏 ⇒ 该组在 demo 租户屏上根本不渲染**（`resolved.filter(g => g.links.length > 0)`）。
⇒ **「推演」组声明 12 项、屏上只剩 6 项**。

**C. 显式登记的「不占导航位」（`ROUTE_NO_NAV`）——1 个**
`decision-play`（`/v/decision-play`）：仓主裁决「不该占导航位，应嵌入每个需要决策的点」，已嵌入 5 处。

## ④ 设计上就没有导航位的深链/子页 ——5 个
`/`（首页，侧栏无 `to="/"` 链接，实测零命中）· `/tasks/:taskId` · `/o/:typeKey/:objectKey` · `/process-instances/:instanceId` · `/admin/connections/:connId/schema`

## ⑤ 按角色不可见（不是「到不了」，是「不该看见」）
- `base_manager:常州`：`dash` · `graph` · `plan-audit` · `plan-generate` · `global-sim` 被 `roleViews` 显式排除；`annual-scenario` · `quarterly-rolling` · `geo-map` · 8 张图谱视角 · `process-stuck` 不在 `baseManagerExtras` 白名单 ⇒ 共 **17/34** 张后端视图可见、**9 条**导航项。
- `/admin/tenants`：需 `platform_admin`，demo 三个账号一个都没有 ⇒ 该屏在 demo 部署里**对所有人不可见**。

## 汇总：97 张屏里，demo·admin 此刻在左导航上点得到的是多少

| 类别 | 数 | 明细 |
|---|---|---|
| 导航上有条目且点得进去 | **70** | NAV_GROUPS 可见 71 − 2 个 404 ＝ 69，＋ 组外硬编码的「⚡ 场景启动器」1 |
| 导航上有条目但点进去 **404** | **2** | `/admin/resources`（`qos.dril-routing` 关）· `/admin/org`（`org.world` 关） |
| 导航里没有入口、但收编后有**真实**到达路径 | **16** | 无条件收编 5（沙盘画布/图层/右栏）＋ 条件收编 11（沙盘模式与档 / 统一壳页签）<br>⚠ 这 16 个里 `process-stuck` 是**假的**：`process.runtime` 关 ⇒ 沙盘那一档也不渲染 ⇒ 实际可达 15 |
| 导航里没有入口、靠**页内嵌入点** | **1** | `/v/decision-play`（`ROUTE_NO_NAV` 显式声明，已嵌入 5 处） |
| 导航里没有入口、也**没有任何**到达路径 | **1** | `/admin/query-history`（route 在，AdminGuard 必 404） |
| 角色不可见（对 demo 全体） | **1** | `/admin/tenants`（需 `platform_admin`，demo 三账号无一持有） |
| 深链 / 子页（设计如此，不算缺陷） | **5** | `/` · `/tasks/:taskId` · `/o/:typeKey/:objectKey` · `/process-instances/:instanceId` · `/admin/connections/:connId/schema` |
| 登录页 | **1** | `/login` |
| **合计** | **97** | 70+2+16+1+1+1+5+1 = 97 ✅ 与全局数「合计屏数 97」对上 |

**一句话**：97 张屏里，demo·admin 从左导航一眼看得到并点得进去的是 **70 张（72%）**；另有 **16 张**必须先进沙盘/统一壳、**1 张**只能从页内嵌入点、**2 张**点了会 404、**1 张**任何路径都进不去、**1 张**因功能位关而实际不存在。

---

# 《我可能错在哪》

1. **「谁会看见它」我是按代码算的，没有真起服务验。**
   `sim.sandbox` 对 demo 为「开」这一条，我的证据是 `templateFeatures()` 的代码路径 + `features.ts` 里两段逐字写明此坑的注释（`WORLD_DARK_LAUNCH_FEATURES` 那段自述「实测 `resolve("demo")` 里它在，即其实是开的」）。**若某处有租户级 override 把 `sim.sandbox` 关掉，本表「归因与风险」整组隐藏、11 条收编项隐藏的结论会整体反转** —— 那时它们全部单列可见，是另一幅导航。本单禁止起服务，这一条只能靠读码，未实测。

2. **「绑的求解器（组件实调）」是按调用位正则扫传递闭包算的，我已被它骗过三次，可能还有第四次。**
   ① 第一版正则只认字面量 ⇒ `useLiveSolver("portfolio", …)` 与三个常量传入的 key（`CHAIN_LOSS_SOLVER_KEY` / `CHAIN_IMPEDIMENT_SOLVER_KEY` / `KIT_READINESS_SOLVER_KEY`）**一个都没看见**，`global-sim`/`chain-line-map`/`chain-impediments`/`procurement-legs` 四屏当时全报「(无)」；
   ② 闭包限在 `views/**` ⇒ 漏掉 `components/KsfGraph.tsx`（`plan-audit`/`plan-generate` 的 `ksf_graph`+`audit_timeline`）；
   ③ 把闭包放开到全 `src` ⇒ `api/endpoints.ts:483` 那条 `"/a/v1/solvers/generic_inference/invoke"` 让 **35 张屏全部误报**（每张屏都 import endpoints）。
   **剩余风险最大的是「字符串键分发」这一类**：`dash` 的 5 个 solver 全在**后端 layout 的数据里**（`query:{kind:"solver",solverKey:"…"}`），代码扫描结构上就看不见。我是手工从 `DASH_LAYOUT` 读的；`service.ts` 全文另有 10 处 `solverKey:` 字面量（含 `risk`/`plan-audit`/`plan-generate`/`project-sim`/`global-sim` 的 `CORE_VIEW_LAYOUTS`），我逐条核过，但**若某个视图的 layout 用了派生写法而非字面量，我同样看不见**。

3. **「服务哪条 COO 目标」这一列是我的判断，不是测量。**
   我能测的只有「屏上有没有金额词 / 订单词 / 求解器」。「这张屏服务不服务目标2 的产销协同」是主观映射。最不确定的是**图谱八视角**那一档 —— 我判「挂不到任何有金额场景」，依据是它们屏上零读数、零金额词（金丝雀：`risk` 同尺 44 命中）；但若仓主认为「本体可视化本身就是目标3『全链路指标集中展示』的一部分」，这八条判定会全部翻转。同理管理屏那 34 条「挂不到」，判的是「对客户 COO 的四组目标」，不是「对平台建设有没有用」。
