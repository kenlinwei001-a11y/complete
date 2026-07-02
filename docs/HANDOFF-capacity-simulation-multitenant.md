# HANDOFF · 产能推演系统（多租户 · 通用产能预测引擎）

> 施工合同 · 分发：开发 agent。审核方出设计，dev 照建，审核方真跑复验（curl oracle + 真浏览器）。
> 分支只推 `claude/vigilant-knuth-b1nmxn`。**产能预测是多租户需求——引擎/通用对象/通用场景零电池，锂电仅作一个租户的绑定样例。**
> 来源 PRD：`scratchpad/PRD-extracted.txt`（锂电通用版）；现状盘点：`scratchpad/capacity-gap-summary.md`（file:line 坐实）。

## 0. 第一性（用户亲定·凌驾一切）

**一切以"解决根本问题"为原则，不以"省事/快速见效"为原则。** 本 HANDOFF 的根问题 = **产能推演链从对象字段→求解器公式→数据模板→场景目录全线写死电池**（`capacity.ts` 读 `channels/agingSlots/formationCapDaily/packCellCount/chem/pos` 全程绕过 `resolveField`→非电池租户 `capacity.ts:184` 抛异常）。故 **W0 去电池化是解锁一切的宪法前提**，不可跳、不可用 demo-first 空壳绕过。

## 1. 本体引用与影响（铁律0）

- **对象类型（§2.E 求解/推演域 · §2.A 数据接入域）**：改造 capacity 求解器族（去电池化，走 `resolveField`）；新增通用对象 `Routing`/`Store`/`Lane`/`Labor`；扩 `Line`/`Order` 字段。→ **回写 §2.E/§2.A**。
- **链路（§3）**：新增"产能四器编排链"`爬坡→齐套→跨基地供需→瓶颈→DecisionOutcome(可行解+代价)`；产能问句经 QOS 单管线路由到此链（复用 Intent/ExecutionPlan/Scenario）。→ **回写 §3**。
- **事件（§4）**：产能推演产出经既有 outbox（不新增事件名，复用 solver invoke + `*.updated` 失效）。
- **不变量**：**R14 零业务常数**（去电池化主线·目标函数可配）· **R6 确定性**（蒙特卡洛须种子化 PRNG·禁 Math.random/Date.now）· **R13 结论可溯源**（DecisionOutcome 溯源信封）· **R11 全链闭包**（四器编排闭合）· **R2 租户隔离** · **R4 真值经 Action**（采纳走正门）· **R10 D-29**（产出事件→前端失效）。
- **断点（§8）**：闭合新断点 **G-CAP-1（产能链多租户断裂）**；关联 G-3（场景入口→QOS 注入产能上下文）。→ **回写 §8 登记 G-CAP-1 + 闭合过程**。

## 2. 多租户宪法（贯穿全波·违反即返工）

1. **引擎零电池**：`Routing/Store/Lane/Labor` 及所有 capacity 求解器只认抽象 `(typeKey, role, field, 系数)`；电芯/Pack/化成/分容/磷酸铁锂等**一律不进引擎代码**（`debattery:check` 兜底）。
2. **锂电=绑定样例**：电池世界经 `SolverBinding.roleBindings[{role,typeKey,fieldMap}]` + 锂电租户 seed 绑上去（化成→通用"静置工序"、电芯基地→"上游基地"、Pack 基地→"下游基地"）。锂电 demo 不丢，但只活在锂电租户。
3. **两行业验收**：每个 capacity 求解器改造后，**锂电租户 + 一个非电池制造租户（新 seed）** 同一 solver 各出正确结果（仿 `opt-two-industry.test.ts`）——这是"多租户"的硬证，非口号。
4. **目标函数可配（R14）**：多基地分配/订单取舍的"按成本/毛利/物流/客户分级"择优，权重是**可编辑规则 `rule.params`**（G-10「改规则即改推演」），不写死。

## 3. 波次施工（严格依赖序 · 每波交付完整可用能力）

### W0 · 产能链去电池化（P0 · 宪法前提 · 解锁一切）
**目标**：现有 5 个 capacity 求解器（`capacity_forecast`/`capacity_rollup`/`risk_timeline`/`bottleneck_matrix`/`kit_readiness`）行业无关化，非电池租户可跑。
- 纳入 `SOLVER_CANONICAL_TYPES`（`solvers/solver-binding.ts:20`）；求解器内**所有 `proc.props.X`/`b.props.X` 改走 `resolveField(idx,solverKey,role,field)`**（`solver-binding.ts:118`），禁裸读电池字段名。
- `resolveTemplate`（`synthetic/service.ts:123`）/`dataCategoriesForIndustry`（`data-categories.ts:71`）**认 industry 参数**，不再恒返电池。
- 新增**一个非电池制造租户 seed**（如 `seedGenericManufacturingTenant`，通用注塑/装配之类·零电池词）带最小 Base/Line/Process/Equipment/Order 拓扑。
**验收 C**：
- C1 curl：非电池租户跑 `capacity_forecast` **不再抛 `has no certified lines`**，返正常 `{p50,perBaseRows,gap,ok,dataMode}`。
- C2 curl：锂电租户同 solver 结果**与去电池化前字节一致**（回归不破·SolverBinding 默认回退 canonical）。
- C3 gate：`debattery:check` 绿（capacity 求解器无内联电池常数）；`grep channels|agingSlots|formationCapDaily|packCellCount apps/datacore/src/solvers/capacity.ts` **零裸读**（全走 resolveField）。
- C4 test：新增 `capacity-two-industry.test.ts` 锂电+通用租户各出正确产能。
- C5 gate：`pnpm -r build && test && gates` 绿；本体 §2.E 回写去电池化 + §8 登记 G-CAP-1。

### W1 · 新对象 + 数据接入（P0 · PRD M1）
**目标**：补齐 PRD §3 缺失的通用对象 + §4 缺失的 3 维数据上传。
- 新对象（`packages/contracts` + `domain.ts` + repo 双实现四处 + migration）：
  - `Routing`（工序 DAG：`processSeq[]` + 前后置边 + 各工序 节拍/良率/**静置时长 holdTicks**）
  - `Store`（统一库：`kind∈{FG,WIP,MATERIAL}` + `capacityCeiling` + `safetyFloor` + `holdOccupancy` 静置占用）
  - `Lane`（物流通道：`fromNode/toNode/transitDays/capacityPerShipment/batchInteger/frequency`）
  - `Labor`（人力：`skillMatrix[]` + `availHours` + `multiSkillCap` + `shift`）
- 扩字段：`Line.designCapacity`（修 C01 悬空引用 `battery.ts:1014`）+ 逐线爬坡曲线 `rampCurve`；`Order.deliveryWindow`（区间非单 due）+ `customerTier`（存储字段非名字派生）。
- 连接器与上传补 3 维：新 DataCategory + 上传模板 + 连接器类型 **④中间库(WIP/静置占用) / ⑤物流TMS(Lane) / ⑥人力HR(技能矩阵)**（`data-categories.ts` + `connectors/registry.ts`）。
- 数据字典：`docs/data-dictionary-capacity.md`，逐字段标 类型/来源系统(ERP/MES/WMS/TMS/SRM/HR)/更新频率/**是否【待填】占位**（PRD §7.2：不可核实值一律【待填】不杜撰）。
**验收 C**：
- C1 curl：4 新对象类型 `GET /a/v1/ontology/object-types` 可见，各带 PRD 关键属性。
- C2 browser：连接器与上传页出现 ④⑤⑥ 三类新模板可下载/上传（此前零入口）。
- C3 curl：非电池租户可 seed/上传 Routing/Store/Lane/Labor 实例（多租户·R2）。
- C4 gate：新表四处同改（migrations+pg+memory+repo 接口）；`pnpm gates` 绿；数据字典交付。

### W2 · 爬坡 + 齐套器（P1 · PRD M2）
**目标**：5.1/5.2 补真语义。
- 5.1：`capacity_rollup`/`capacity_forecast` 有效产能 **减换型损失**（并入 `sequencing_optimize`/C22 结果）+ 逐线爬坡曲线（读 `Line.rampCurve` 非全局参数）+ 良率时变（爬坡阶段良率）。
- 5.2：`kit_readiness` 升级为**时间轴约束传播 CP**（多周期逐 tick 判各周期可投产量受限于哪一齐套要素）+ **半成品 WIP + 静置占用**（读 `Store{WIP}.holdOccupancy`）。
- 约束成可编辑规则：`静置不可压缩` / `库容上限` / `安全水位` / `最小/经济批量`（A5 DSL + `SOLVER_RULE_REFS`）。
**验收 C**：C1 curl 有效产能显式含 −换型 −静置 逐档（可加总反算）；C2 curl 齐套器返逐周期瓶颈物料/半成品清单（非单周期 min）；C3 静置工序占用可查（Q7）；C4 两行业验收；C5 gates 绿 + 本体回写。

### W3 · 跨基地供需 + 瓶颈 + 编排 + 决策/代价层（P1 · PRD M3 · 决策引擎核心）
**目标**：5.3/5.4 + §6.1 编排 + §6.2 溯源信封 + **决策/代价层**。
- 5.3 **跨基地供需平衡+物流时移**（新求解器 `crossbase_balance`·over `Lane`·上游→下游通用·目标最小缺料/滞留/物流成本·满足库容/运力/批量整数）——复用 `min_cost_flow` CP-SAT 原语但接 `Lane` 对象 + **通用绑定**（非仅 sidecar：未配 `OPTIMIZER_BASE_URL` 时确定性启发式兜底 + 诚实标，不抛）。
- 5.4 瓶颈补**松弛建议 + 敏感度排序**，物流/换型/人力 tightness 接 W1 真源（不再回落 MOCK）。
- §6.1 **四器编排链**：ExecutionPlan `爬坡→齐套→跨基地供需→瓶颈`（`workflow/executor.ts`）。
- §6.2 + 决策层 **`DecisionOutcome`**（新契约）：`{feasible, deliverable, gapByBaseByPeriod[], bindingConstraint, cost{delivery,margin,customerRel}, sacrificed[], slackAdvice[], solverTrace[], sourceData[], constraintsApplied[]}` —— 把求解器输出转成 CEO 可拍板的"可行解+代价"（缺口对账 Q1 / 挤兑清单 Q4 / 折损分解 Q3 / 松弛 Q2 / 多基地分配 Q6 / 订单取舍代价 Q10）。
- **可配置多目标**：分配/取舍目标权重读 `rule.params`（成本/毛利/物流/客户分级·G-10）。
**验收 C**：C1 curl 跨基地供需返各基地各周期可交付+转运计划+缺口时点（Q1/Q6）；C2 curl 瓶颈返松弛增量+敏感度排序（Q2）；C3 curl `DecisionOutcome` 含 sacrificed/cost/solverTrace 溯源信封（Q3/Q4/Q10）；C4 curl 改 `rule.params` 目标权重→分配结果随之变（G-10·多目标可配）；C5 两行业验收；C6 gates 绿 + 本体 §3 回写编排链。

### W4 · 改名 + 人机问答 + 场景/意图/入口 wiring（P1 · PRD M4a · 全入口复用）
**目标**：预判推演看板→产能推演；产能推演页承载人机互动推演问答；QOS 单管线全入口复用。
- **改名**：后端 `synthetic/service.ts:1331`"预判推演看板"→"产能推演" + `features.ts:17` + 面包屑 `RiskBoardView.tsx:62` + renderer 标签（**通用文案·零电池**）。
- **产能推演页承载问答**：页内接壳层 `QueryDock` 同源问答（或嵌入），`suggestedQuestions` 来自产能 Scenario；问句经 QOS 走产能编排链出 `DecisionOutcome`。
- **场景/意图/入口（多租户）**：`SCENARIO_CATALOG` + Intent seed 加**通用产能场景/意图**（真 slots·非派生空 slots），每条 targetView=产能推演页；**22 问题（12 操作 + 10 CEO）落为一等 Scenario/Intent**（通用语义·锂电经绑定填实体）。SceneEntry 投影 + 意图目录页 + 场景启动墙 出通用产能场景。
- **全入口复用证**：全局 QueryDock、产销推演入口 问同一产能问句→都路由到同一编排链出同一 `DecisionOutcome`。
**验收 C**：C1 browser 页名"产能推演"（零"风险/预判"残留·零电池字面量）；C2 browser 产能推演页内问"未来N周期能否按时交掉·缺口在哪"→出 `DecisionOutcome`（真浏览器·非空壳）；C3 curl 意图目录含通用产能 Intent 带真 slots；C4 browser 全局 QueryDock 问同问句 → 同链路同答案（全入口复用）；C5 多租户：非电池租户场景启动墙出通用产能场景（无电池词）；C6 gates 绿 + G-3 邻域回写。

### W5 · 情景分析 + 敏感性 + 反推（P2 · PRD M4b）
**目标**：5.5 蒙特卡洛(种子化) + 4 类 what-if 情景 + 扩产反推。
- 5.5 **种子化蒙特卡洛**：新 `seeded PRNG` 工具（固定 seed→确定性采样·**禁 Math.random**·同输入同分布字节一致 R6）；对良率/提前期/物流时长分布采样→跑编排链批量→**达成率置信区间 + 敏感度排序**（Q9/Q10）。
- 4 类 what-if 一等情景（`OptPerturbation`/沙盘复用）：**插单/急单**(挤兑+被牺牲清单 Q4)、**断供**(折损+首当其冲订单 Q5)、**扩产时点**(投产时点边际贡献 Q8)、**订单取舍**(多目标策略代价对比 Q10)。
- **扩产 CAPEX 反推**：以产能缺口反推扩产必要性（扩哪个/多少/何时投），扩 `capex_scenario`（Q8）。
- 前端下钻溯源：任一预测数值点击 → 逐层展开 `DecisionOutcome.solverTrace/sourceData/constraintsApplied`。
**验收 C**：C1 curl 蒙特卡洛同 seed 重跑置信区间**字节一致**（R6）；C2 curl 4 情景各出代价对比；C3 curl 扩产反推返必要性+时点边际；C4 browser 数值下钻到源数据+约束+求解链；C5 `experiment-determinism:check`/`opt-determinism:check` 绿；C6 gates 绿。

## 4. 场景/意图源清单（W4 落地 · 22 问题 · 通用语义）
12 操作问题（Q1–Q12 见 `capacity-gap-summary` 邻域）+ 10 CEO 决策问题（全局交付力/瓶颈定位/真实vs名义/插单/供应韧性/多基地分配/新线爬坡/扩产CAPEX/年度达成把握/订单取舍）——**每条落一等 Scenario+Intent**，语义通用（"上游基地/静置工序/关键设备/单一供应商"），锂电经绑定填"电芯基地/化成/涂布机/某材料商"。

## 5. 里程碑映射（PRD §7.3）
M1=W0+W1（本体+数据接入+去电池化）· M2=W2（爬坡+齐套）· M3=W3（供需+瓶颈+编排+决策层）· M4=W4+W5（改名+问答+情景+敏感性+溯源下钻）。

## 6. 红线速查
去电池化绝对（引擎零电池·锂电仅绑定）· R14 目标函数可配 · R6 蒙特卡洛种子化 · R13 DecisionOutcome 溯源 · R11 编排闭包 · 两行业验收硬证 · 不重写现有净室通用 solver（shared_bottleneck/min_cost_flow 复用）· 每波真跑复验非绿测试冒充。
