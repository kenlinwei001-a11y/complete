# PRD 增量 · 前端剩余视图与页面补全（PRD-frontend §7.14–7.22）

| 项 | 值 |
|---|---|
| 版本 | v1.0（增量：renderer 枚举扩至 12；图谱配置化七视角；任务详情编排 DAG；映射表；校准报告与数据健康度两个管理页） |
| 设计基准 | 原型 HTML：buildAOP / buildQuarter / buildOrderAgg / 地理视图(mapsvgwrap) / VIEWS 七种图谱视角 / 编排推演 story / openMap 映射表 |
| 决议 | 编排推演 DAG 与业务建模映射表**确认要做**（推翻此前"可不做"建议）；其余按上轮缺口清单 |

## 0. 契约补充

1. **renderer 枚举扩至 12**：新增 `"annual-scenario" | "quarterly-rolling" | "order-chain" | "geo-map"`。
2. **新数据端点**（DataCore 计划域，contracts 包同步）：
```
GET /a/v1/plan/aop?year=                 → { scenarios[], triggers[], decomposition[] }（年度情景对象，见 §7.14）
GET /a/v1/plan/quarterly?from=&n=6       → { rows[{q,dem,sup,events[]}], ltaDeviation[] }
GET /a/v1/ontology/mapping?packageId=    → 映射表行集（见 §7.20）
GET /a/v1/calibration/report?objectType=&from=  /  GET /a/v1/calibration/proposals
GET /a/v1/data-health                    → 源系统新鲜度清单（A1 健康度指标的查询面）
```
3. **共享组件升级**：`LayeredDag`（分层 DAG SVG，§7.13 项目推演已实现）抽为通用组件，§7.19 复用；`PropagationTimeline` 不变。

## 7.14 年度情景规划台（renderer="annual-scenario"）

三区块（对齐 buildAOP）：
1. **三情景卡**（保守/基准/激进，顶边色条；已拍板情景带「已拍板 AOP」chip + 描边）：年需求大数字、产能决策、长协锁量、财务测算（收入/CAPEX/IRR）、规则校验行（C18/C23 结果，规则徽章可点开 expression）。情景数据为计划域对象（`AnnualScenario`），非前端常量。
2. **触发条件挂牌表**：条件 / 升级动作 / 监测状态（⏳ 监测中 / ✓ 已触发）。已触发行高亮并显示触发时间与通知记录——"情景活在系统里"的展示面；触发判定由后端规则扫描完成，前端只读。
3. **目标分解流**：年 → 季 → 月 横向流（dec-flow 形态，月份 chips），尾注"分解值 = S&OP 平衡台目标线（同源勾稽）"——分解节点可悬停溯源（指向同一目标对象，验证与 §7.12 同源）。
**操作**：「拍板情景」按钮（仅 `catalog_admin`+feature `act.aop-finalize`）→ actionType=`AOP情景拍板`。

## 7.15 季度滚动看板（renderer="quarterly-rolling"）

1. **需求 vs 供给双条图**（4–6 季，每季两根横条 + 缺口/冗余徽章：缺口>4 红 / >0 黄 / ≤0 绿）+ 每季事件注释行（关联规则可点）。数据 = `plan/quarterly` 端点（供给来自 S1.2 季度聚合 + 已决策产能项目投产增量，需求来自年度分解+滚动修正）。
2. **长协执行偏差表**：物料 / 长协计划 / 实际到货 / 偏差%（|偏差|>5% 红 + "升级供应风险"标记）/ 说明；偏差行与风险看板"到货间隙"事件同源——行尾链接跳转 risk-board 对应基地。

## 7.16 订单全链聚合（renderer="order-chain"）

对齐 buildOrderAgg + 待解决问题归并：
1. **基地筛选器**（下拉：全部风险基地/单基地，带清除 chip）。
2. **财务影响汇总条**（涉及订单数/合计万套/客户数/涉及收入）。
3. **受影响订单明细表**：订单/客户/应用细分 chip/型号/数量/交期/**关联风险点 chips**（基地·因素·越线日，≤4 个+折叠，悬停弹出 §7.3 风险弹窗——与 risk-board 共用 RiskPopover 组件）/延误天数。聚合口径脚注原样保留（交期 ∈ [T−7,T+14]，延误取最大）。
4. **待解决问题卡区**（4 类归并：交期/毛利/齐套/信用）：问题卡（标题/受影响单数/财务贡献/根因摘要）→ 点开**逐单根因 DAG**抽屉：`LayeredDag` 渲染 订单→判定（交期判/毛利判/信用判）→根因→对策建议 四层链（数据来自 `affected_orders` 求解输出的 rootCause 扩展字段——求解器增量 PRD §S1.5 补充输出 `problems[]` 分组与 `rootChain[]`，列入修订点）。
5. 行点击 → 订单写入 `selectedObjects`（对话上下文）。

## 7.17 地理视图（renderer="geo-map"）

- 中国地图轮廓（静态 geojson 资产打包进前端，不依赖外部瓦片服务——离线/私有化可用）+ 基地气泡：大小=GWh（线性映射 8–28px）、颜色=定位（动力蓝/储能绿/混合黄，图例固定）。
- 气泡点击 → 侧滑基地档案卡：产线数/GWh/投产年/主产品/利用率（色档同原型 utilColor 阈值 92/85/78）/当前瓶颈 + 「查看风险」跳 risk-board、「图谱中查看」跳 ontology-graph 定位节点；点击同时写入 `selectedObjects`。
- 数据 = `query_objects(Base)`，无专用端点。

## 7.18 本体图谱配置化（修订 §7.2，七视角变成配置）

`ViewConfig.graphOptions`（服务端下发，每个图谱类视图一份）：

```ts
interface GraphOptions {
  nodeFilter?: { ids?: string[]; domains?: string[]; tiers?: number[] };  // 子集
  colorBy: "domain" | "source";            // 数据来源视角=按源系统着色，派生/求解/agent 节点淡出
  linkKinds?: string[];                    // 仅渲染指定边类型（如 flow+agg = 产能推演网络）
  dimOthers?: boolean;                     // 子集外节点淡出(0.12)而非隐藏
  mvpOverlay?: boolean;                    // MVP 视角：核心实色、缺口节点 ⊕ 虚线
  layoutSeed?: number;                     // 力导向初始可复现
}
```

原型七视角（全景/主干分级/产能推演网络/数据来源/求解器/MVP/智能体网络）全部表达为七份 `ViewConfig(renderer="ontology-graph", graphOptions=…)` 进种子数据——**零新代码视角**，且每个视角可被 feature entitlement 单独开关。图例组件按 colorBy 自动切换（domain 图例 ↔ 源系统图例）。

## 7.19 任务详情页 · 编排推演 DAG（修订 §6.6 /tasks/:taskId）

任务详情页顶部新增 **编排 DAG 区**（复用 `LayeredDag`）：
- 路径 A：层 = 意图解析 → 槽位 → 各计划步骤（按 step type 着色：取数青/求解品红/规则紫/渲染灰）→ 回答；节点副标题=耗时与 outcome；失败步红色。
- 路径 B：层 = 意图分类(OUT_OF_CATALOG) → 各迭代的工具调用（每迭代一层，迭代内并列）→ final_answer；被拒/超预算调用橙色标注。
- 节点点击 → 下方事件回放表滚动定位到对应 step/toolCall 行（双向联动）；DAG 数据完全由已有 `query_events` 推导，**无新后端契约**。
- 该区受 feature `view.task-dag` 控制（默认开）。

## 7.20 业务建模映射表（图谱内功能，非独立路由）

- 入口：ontology-graph 工具栏「映射表」按钮 → 全屏弹层（对齐原型 map-overlay）。
- 表结构：按**数据域分组**（组头行），列 = 对象 / 类型 / 源系统 / 关键属性 / 适用规则（徽章可点）/ 派生公式 / 血缘（sourceBindings 摘要：连接器·数据集·字段数）。数据 = `GET /a/v1/ontology/mapping`（服务端由本体元数据+sourceBindings 拼装，分组排序后下发）。
- 行点击 → 关闭弹层并在图谱中定位高亮该节点。
- **导出**：CSV 与自包含 HTML 两种（HTML 复用原型导出报告样式：标题+导出时间+「所有数字派生自同一本体」脚注）；导出受 feature `act.export` 控制。

## 7.21 校准报告页（/admin/calibration，角色 `catalog_admin` 或 `planner`）

1. **精度趋势区**：MAPE 折线（echarts，按对象类型/基地/求解器 key 三级下钻筛选），叠加 C12 阈值线（8%）与触发标记点；数据 = `calibration/report`（M11 产出，A8 的 ts_agg_runs 为"实际"来源）。
2. **参数更新提案列表**：提案行 = 参数（节拍/良率/OEE 基线）/ 当前值 → 建议值 / 依据（偏差窗口与样本数，可点开溯源）/ 状态（PENDING/APPLIED/ROLLED_BACK）；「批准」「回滚」按钮 → actionType=`校准参数变更`（走 §S2 审批流，不直改）。
3. **校准历史**：时间线（每次校准：触发原因 C12/手动、变更参数集、前后 MAPE 对比）——"越用越准"的证据链页面，演示线 T9 的前端落点。

## 7.22 数据健康度（并入 /admin/connections + 全局徽章）

- 连接器控制台新增「健康度」列与汇总条：每源系统 新鲜度（最近数据时间距今）/ 延迟阈值 / 状态（正常/延迟/中断）/ **降级影响**（命中 C09 时显示"P90 系数 0.93→0.90"及受影响求解器列表——数据来自 FeatureRegistry 同款 bindings 反查）。
- 全局 Shell 顶栏新增健康度小徽章（任一源延迟 → 黄点；点击下拉清单跳连接器页）；推演类视图输出中出现降级说明时，文案与此处同源。

## 验收用例增量

| # | 用例 | 预期 |
|---|---|---|
| F21 | annual-scenario | 三情景卡渲染、已拍板态、触发条件已触发行高亮；分解节点溯源与 S&OP 目标线同源断言 |
| F22 | quarterly-rolling | 缺口徽章三档色；长协偏差 −8% 行红色且跳转 risk-board 正确基地 |
| F23 | order-chain | 基地筛选联动明细与汇总；风险点 chip 悬停弹窗（与 risk-board 同组件实例断言）；问题卡开根因 DAG 四层 |
| F24 | geo-map | 气泡大小/颜色映射正确；点击写入 selectedObjects 且档案卡跳转两处正确；离线断言（无外部网络请求） |
| F25 | 图谱七视角 | 七份 ViewConfig 渲染出与原型对应的子集/着色/边过滤；colorBy=source 时派生与 agent 节点淡出、图例切换；关闭某视角 feature 后导航消失 |
| F26 | 任务 DAG | 路径 A 与 B 各一任务：DAG 分层与事件一致；点节点回放表定位；失败步红色 |
| F27 | 映射表 | 分组/列齐全；行点击图谱定位；CSV 与 HTML 导出内容抽查；act.export 关闭后按钮消失 |
| F28 | 校准页 | MAPE 曲线含阈值线与触发点；提案批准走 Action（断言无直改 API 调用）；历史时间线渲染 |
| F29 | 健康度 | mock IoT 延迟 → 连接器页状态/降级影响、顶栏黄点、推演输出降级文案三处同时出现且文案一致 |

## 对既有文档的修订点

1. 求解器增量 PRD §S1.5：`affected_orders` 输出扩展 `problems[]`（4 类归并）与 `rootChain[]`（根因 DAG 数据）。
2. 平台 PRD §A4/计划域：新增 `AnnualScenario` / `ScenarioTrigger` / `QuarterlyPlan` 查询端点（§0-2）。
3. 前端 PRD §7.2 由 §7.18 取代其视角假设；§6.6 任务详情页并入 §7.19。
4. 功能开通增量：FeatureRegistry 新增 `view.annual-scenario` `view.quarterly-rolling` `view.order-chain` `view.geo-map` `view.task-dag` 与图谱七视角的 BLOCK 级 key。
