# AUDIT · 假推演全清单 2026-07-24 复审（对抗式·三 finder 真后端取证）

> **缘起**：用户彻查「查询对话/推演结果哪些是 mock/写死/哈希冒充真算」。三路只读 finder（后端求解器 / 前端现编 / mock 层）交叉取证 + 真 seed datacore curl 坐实。本文更新 `AUDIT-fake-simulation-inventory.md`（原假1-假7 状态）+ 登记新发现。
>
> **一句话**：原 7 假**假2 真修、假1 半修（红曲线仍哈希）、假3/4/5/6/7 全 live**；**新头号病 = `generic_inference apply` 对全部产能/良率/物料原子因子恒返 0 deltas（唯 `Equipment.oee_current` 有派生边）——"发现说高杠杆、应用说改了没用"**，这正是本会话 caplive-cockpit 判退的根因，也是 CLAUDE.md 警示的"两半用两套机制不对接"。

---

## 0. 优先级总表（按"用户最可能误信 × 影响面"排序）

| P | 病 | 类别 | 锚点 | 修路 |
|---|---|---|---|---|
| **P0** | **hollow recompute**：13 产能原子 apply 恒 0 | 引擎·静默空冒充"重算了没变" | `service.ts:470-493`+`ontology-core.ts:391` | 补派生边 OR apply 无下游 spec→抛错/`dataMode:EMPTY`（禁静默 0）+ 拨杆改走 capacity_forecast 真链 |
| **P0** | **audit_timeline 纯哈希假**：series/peak/crossDay 100% `hashString(kind)`·恒越线红·零 dataMode·genuine-sim 门漏网 | 假·哈希冒充 | `risk.ts:452-483` | 真算 OR dataMode + 扩门 |
| **P1** | **假1 半修**：risk 红曲线 `tensionSeries` baseline 参**死代码**（3 调用点无一传）→ peak/crossDay 仍 charCode 哈希·`currentTightness` 披露旁挂不喂曲线 | 假·哈希（披露≠曲线源） | `risk.ts:223,286,315,204` | 传 `lt.value`(live 时)入 baseline·锚实测 |
| **P1** | **假3** OrderChainView econTable：库存=营收×写死系数+`hashN`·毛利率 client 现编·裸渲染 | 前端现编·无披露 | `OrderChainView.tsx:30,35,110-120,262` | 杀 hashN+coef·库存诚实"—"·毛利读 metric_rollup·抄 LedgerView |
| **P1** | **假4** PropagationTimeline 财务击穿：`Σqty×0.6万`·≥1亿裸触发红 | 前端现编·无披露 | `PropagationTimeline.tsx:59-60,95-96`（+`PlanGenerateView:382`） | 敞口移后端真算+dataMode·或标"估算·假设0.6万/套" |
| **P1** | **对话答案 100% 脚本化 canned**：9 分支→5 写死 fixture·含**伪造 provenance** | 假·脚本冒充真算 | `sseScripts.ts:26,30-205`·`fixtures.ts:1142-1209` | 镜像真 QOS·或诚实标"脚本演示"·（VITE_MOCK 才触发·但用户在 mock 态误信） |
| **P2** | **假5** DashboardView 毛利率 client 现编·`{price:0.6,margin:13}` 兜底 | 前端现编·无披露 | `DashboardView.tsx:411-424` | 读 metric_rollup·或抄 RiskBoardView `??0`+脚注 |
| **P2** | **假6** deriveExtendedArgs 空对象现编·**14 extended solver silent fallback**（num/str 缺数默认值·永不抛） | 假·静默现编 | `extended.ts:434,453,457,463,468,472,477`·根 `types.ts:249` | 缺真对象抛错/标 provenanceSynthetic（抄 capex）·删 maintenance/yield 写死 series |
| **P2** | **假7** PlanGenerateView 收入增/份额魔法基线 `(rev-100)%`/`(share-17)pct` | 前端现编 | `PlanGenerateView.tsx:234,236,270` | 求解器回显基线（PLAN_GOAL_TARGETS 已引·唯增长基线仍写死） |
| **P2** | **multi_objective mock 全 0 退化桩**冒充"可证最优" | mock 假口径 | `simSolvers.ts:915-924` | 镜像真 CP-SAT 解·或标"未实现" |
| **P2** | **MultiObjWhatifPanel toy fixture**：SO-A/B/C 写死三元·徽标不标"输入示意" | toy 断连 | `MultiObjWhatifPanel.tsx:20-35` | 接真 order/line/contract·或标"示意样例" |
| **P3** | **mock-only 端点真后端 404**：`/b/v1/sim/compose`·`/a/v1/sim/scenarios`·`/a/v1/sim/live-scenarios` | mock-only | `handlers.ts:2216,3201,3246` | 补真端点（WO-LIVE-SCENARIO/compose-path key）·否则前端 NL/存比部署态断 |
| **P3** | **假 NL** RiskBoardView QaPanel 正则冒充问答（已并列真 `CapacityLiveDialog` 但正则仍渲染） | 假 NL | `RiskBoardView.tsx:1030-1036` | 删正则切真 NL（注释已承诺·未执行） |
| **P3** | **死按钮** CustomerImpactBar「协调加产/通知客户」占位（已诚实披露） | 死按钮 | `CustomerImpactBar.tsx:87-88` | 接 plan_change Action·或删 |

---

## 1. 头号病 · hollow recompute（P0·caplive-cockpit 退根因）

**机制**（F1 沿链坐实）：`genericInference`（`service.ts:470-493`）→ `ontologyCore.recompute`（`ontology-core.ts:341`）**只在 changed `Type.prop ∈ 某 ACTIVE derivationSpec.deps` 时产 delta**（`:391-398`），否则 dirty 集空 → `deltas=[] count=0`，**无 throw·静默空**。

demo 电池本体**派生边只有**：`Order.qty/so/unitPrice`·`Equipment.oee_current(→Base.oeeIndex)`·`DemandSegment.*`·`Metric.actual/target`·`InterBaseTransfer.*`·`FinishedGoodsInv.*`·`SopVersionRow.*`。**Process/Line/Material/Equipment(oeeA/P/Q)/ChangeoverMatrix 零派生边**。

**apply→0 的原子清单**（13 个 CapacityFactorBinding writable + LEVER_FACTOR_PROPS 落点·唯 oee_current 例外）：`Process.yield_baseline`⑥（curl 坐实 deltas=0）· `Line/Process.utilization`⑧⑩ · `Equipment.ctSeconds`①`oeeA`③`oeeP`④`oeeQ`⑦ · `Process.channels`②`shifts`⑯`attendance`⑰ · `Material.onHand`⑬`leadTime`⑮ · `ChangeoverMatrix.changeoverMin`⑤ · `Order.outsourceRatio`。

**自相矛盾接缝**：`discoverCapacityLevers`（`service.ts:613`）用 `computeByProcessModel` 克隆重算算**真敏感度（代码链）**→"发现"高杠杆；但拖动 apply 走 ontology-core recompute→**0**。`RiskBoardView.tsx:634` 挂 `targetProp="weeklyCap"`（非派生属性）→ 反推也 0。**发现≠应用·两套机制**（byProcessModel 代码链 vs recompute 派生图）**未对接**。

**真后端 curl 铁证**：`generic_inference apply Process.yield_baseline 0.94→0.85` → `deltas=0 count=0 affected=0`（正确 `.data` 解析）。

**修路**：① 拨杆重算改走 `capacity_forecast(granularity:process-model)` byProcessModel 真链（caplive-atom 已建·150 行真值·带 provenance）；② `generic_inference` apply 命中"无下游 spec"→**抛错或返 `dataMode:EMPTY`**（禁静默 0 冒充"重算了没变"）；③ 长期补 `Process.yield_baseline→Line.effectiveCapacity→capacity_rollup` 等派生边（闭 `G-CAPACITY-YIELD-DERIVATION`）。

---

## 2. 本次复审 vs 原假1-假7 状态

| 原编号 | 原病 | 2026-07-24 现状 | 证据 |
|---|---|---|---|
| 假1 | risk 红卡/峰值哈希 | **半修**·披露旁挂·红曲线仍 charCode 哈希（baseline 参死代码） | `risk.ts:223,286,315` |
| 假2 | capacity 紧张度裸 import mockTightness | **真修**·改走 liveTightness LIVE/MOCK 判别 | `capacity.ts:5,389,521` |
| 假3 | OrderChainView 库存/毛利现编 | **live** | `OrderChainView.tsx:30,110-120` |
| 假4 | PropagationTimeline ×0.6 敞口 | **live** | `PropagationTimeline.tsx:59-60` |
| 假5 | DashboardView 毛利率现编 | **live** | `DashboardView.tsx:411-424` |
| 假6 | deriveExtendedArgs 写死 series | **live** | `extended.ts:472,477` |
| 假7 | PlanGenerateView 魔法基线 | **live** | `PlanGenerateView.tsx:234,236` |

**诚实进展（对照组·非病）**：RiskBoardView/ProjectSimView 加 `dataMode` 三态徽章；DisruptionRadiusView/DecisionPlayView/BaseOutlookPanel/SopBalanceView 纯 solver 投影 + 诚实空态；`bottleneck_matrix.dataMode`/`mockSopReschedule`/`mockBaseOutlook`/`mockPortfolio` 逐口径移植 + 诚实标。

---

## 3. 修复纪律（抄诚实典范·每条真后端 SEAM 亲验）

- **典范**：`capex_scenario`（缺数抛错不兜底）· `LedgerView`（逐格 Provenance）· `cockpit_kpi`（空抛）· `bottleneck_matrix.dataMode`（诚实 LIVE/MOCK）。
- **每条修复 DoD**：真后端 curl 证"改输入→输出真变"或"缺数→抛错/EMPTY 不造假"（**非 mock 绿**）；扩 `genuine-sim:check` 覆盖（现只守 4 schema→扩 audit_timeline/extended/hollow-recompute）。
- **金值不动**：SOLVER_KEYS 57·契约 additive。
