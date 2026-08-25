# PRD · 推演演习：真实业务的平行世界

> **仓主定的目标（原话）**：
> 「推演的目标是类似**演习**，扫描产销**端到端的环节卡点、堵点、脆弱点**。通过输入扰动因素预演可能的风险。」
> 「追求**真实业务的平行世界**」——要求**充分使用**求解器、本体切片、约束条件、规则、skill、agent，
> 而不是现在这样一个都没用。
>
> **本文档是设计，不是实现**。所有存量判定均为实测（起真 datacore + 读码追调用链），
> 逐条给出证据；缺口部分明确标注「待补」，不假装已有。

---

## 0 · 本体引用与影响（铁律 0 强制章节）

| 维度 | 触及内容 |
|---|---|
| **对象类型** | `SimSession` · `Perturbation` · `EnterpriseState` · `PropagationRule` · `Order` / `OrderLine` / `Material` / `PurchaseOrder` / `Equipment` / `Line` / `Process` |
| **链路** | 扰动输入 → 世界 fork → 传导/求解 → 卡点扫描 → 结论溯源 |
| **事件** | `sim.session_created` · `sim.perturbation_applied` · `sim.tick_advanced`（现有）；**待增** `sim.drill_completed` |
| **不变量** | **R4-sim**（仿真世界豁免边界）· R6（确定性）· R11（全链闭包）· R13（结论可溯源）· R14（应用层无业务常数） |
| **断点** | 本文档 §4 新登记 5 条 |

⚠ **本设计不放宽 R4-sim**：仿真世界的写入不经 Action 审批，但三条边界一条不越 ——
① 不回写真实世界；② 结论要生效必须生成 Action 提案走 R4 正门；③ 快照 `source.kind` 必须标 `FORKED`。

---

## 1 · 重大发现：平行世界的原语**已经建好了**

开工前先查存量，避免造轮子。实测结果：

| 层 | 存量 | 证据 |
|---|---|---|
| 契约 | `EnterpriseState`：`worldId` + `isSimulated` + `forkedFromStateId` 三件套 | `packages/contracts/src/enterprise-state.ts` |
| 服务 | `EnterpriseStateService`（capture / list / latest / get / **fork**） | `apps/datacore/src/twin/enterprise-state.ts` |
| 仓储 | 双实现齐备（R9） | `repo/pg.ts:919` · `repo/memory.ts:539` |
| 端点 | 4 个读端点 + **`POST /a/v1/twin/enterprise-states/:id/fork`** | `app.ts:3069-3099` |
| 前端 | `EnterpriseStatePanel` + `EnterpriseStateTwinPanel`，挂在沙盘右栏 | `SandboxView.tsx:61,62,1900,1907` |
| PRD | 47KB 完整设计 | `docs/PRD-enterprise-decision-twin.md` |

**结论：「平行世界」不用造，它已经是全链通的。** 本 PRD 要做的是**把演习能力接到这个已有的世界上**，
而不是另起炉灶。

---

## 2 · 存量能力盘点（实测，非推测）

### 2.1 求解器：**62 个，其中 22 个直接对口产销推演**

这批是演习引擎的现成零件，**今天沙盘一个都没调**（见 §3.1 证据）。按演习场景归类：

| 演习问题 | 求解器 | 入参 | 能答 |
|---|---|---|---|
| **订单改期能不能扛住** | `sop_reschedule` | `targetOrderId` · `newDueDate`/`advanceDays` · `objective` | 能否提前交 · **挤占谁** · 拆哪些基地 · 代价多大 |
| **这次扰动波及哪些单** | `affected_orders` | `baseId` | 受影响订单清单 |
| **这单卡在哪一判** | `order_fullchain` | `so` | 能不能接 · 为什么提价 · **卡在哪一判** |
| **工序排不排得下** | `job_shop_schedule` | `opType` · `jobField` · `machineField` · `durationField` | 小时级排程 · makespan 最小化 |
| **瓶颈在哪** | `bottleneck_matrix` | `baseId` | 哪个基地哪道工序 · 瓶颈强度矩阵 |
| **产能够不够** | `capacity_forecast` | `modelId` · `qty` · `weeks` · `base` | P50/P90 缺口率 · 主瓶颈工序 |
| **风险哪天越线** | `risk_timeline` | `base` · `factor` · **`horizon`（推演天数·默认 30）** | **越线点在哪天** · 逐日推演 |
| **谁在挤同一资源** | `shared_bottleneck` | `upstreamType` · `viaField` | 共享资源不够谁降级 · **隐性共享瓶颈** |
| **看似分散实则集中** | `concentration_risk` | `rootType` | **单点集中风险** · 暗线汇聚 |
| **供需为什么对不上** | `supply_demand_gap_attribution` | — | 需求虚高还是供不上 · 各占多少 |
| **前瞻产能与逐日处置** | `base_capacity_outlook` | `baseId` · `horizon` | 缺口哪天出现 · 逐日怎么处置 |
| **全局最优怎么排** | `portfolio` | `orderIds` · `frozenOrderIds` · `scenarios` | 跨基地跨时间最优 · 冻结这几单其余怎么排 |

> **仓主要的"30 天推演"后端已支持**：`risk_timeline.horizon` 原文即「推演天数（默认 30；也认 days）」。
> 缺的只是前端把「30 天」传下去，以及 tick↔天的换算基准（§4 G-DRILL-1）。

### 2.2 其余四样能力

| 能力 | 存量 | 沙盘用了吗 |
|---|---|---|
| **本体切片** | 有（`plan_slice` 步骤类型 · `sys.meta.*` 切片） | ❌ 未用 |
| **约束条件** | 在求解器内部（产能颗粒 `ΣcapacityDaily×(1−util/100)` · 换型矩阵 · 优先级排序） | ❌ 未用 |
| **规则** | `PropagationRule` 35 条（沙盘**只用了这一样**） | ✅ 唯一在用的 |
| **Skill / Agent** | B 侧完整（`Skill.execution.steps` · Agent 注册表 · QOS 编排） | ❌ 未用 |

---

## 3 · 差距：今天的"推演"是数值传导器，不是演习

### 3.1 证据（追一层调用链，非 grep 命中）

`SandboxView.tsx` 里：
- `solver` 命中 4 处 —— **全是溯源标签**，其中一条原文 `solver: "页面入参 · 未求解"`
- `slice` 命中 6 处 —— 全是 `Array.slice()` 数组方法
- `evaluateRules` / `ruleEngine` / `skill` —— **0 命中**
- `agent` 命中 2 处 —— AI 指挥台，与推演无关

后端 `sim/propagation.ts` 的 `propagateTick(graph, state, rules, …)` —— **零求解器调用**。

### 3.2 扰动契约表达力不足

契约只收 `targetObjectId` · `targetStateVar` · `magnitude`（+ `mode` / `durationTicks`），
即只能表达「**把某对象的某个数值变量拨动多少**」。

而演习需要的是**业务事件**：

| 仓主要的输入 | 契约能表达吗 | 原因 |
|---|---|---|
| 某客户某订单**改交期** | ❌ | 交期是日期，不是可拨的数值变量；且 `due` 不在 `world.state` |
| 订单**取消** | ❌ | 取消是状态跃迁，不是幅度 |
| 改**交付地点** | ❌ | 是关系变更（指向另一个 `CustomerLocation`） |
| 改**价格** | ◐ | `priceShock` 在 state 里，但那是"冲击压力"不是"单价" |
| 物料**采购到货延迟** | ❌ | 无此根源变量（见 `WO-SIM-ROOT-PERTURB-LAYER.md`） |

### 3.3 引擎只读 `world.state`

`propagateTick` 的入参是 `state`，**不读对象属性**。实测：`obj_equipment_*` 在 state 里有 780 个，
但只带 `loadPressure` 一个变量 —— OEE 四个字段一个都没进来。库存、BOM 同理。

⚠ 所以**硬把这些加进 UI = 造假界面**：请求成功、`state[id].oee_current` = `undefined`、
下游一动不动 —— 「静默错答的老形态」。

---

## 4 · 设计：演习 = 事件 → 世界 fork → 双引擎 → 卡点扫描

### 4.1 主链路

```
① 演习编排（用户输入）
   业务事件 + 时间窗（30 天）+ 范围
        ↓
② 世界 fork（复用已有原语·R4-sim）
   POST /a/v1/twin/enterprise-states/:id/fork
   → 新 worldId = SimSession.id · isSimulated=true · forkedFromStateId 指回真实快照
        ↓
③ 双引擎并行
   ├─ 传导引擎（现有）：35 条 PropagationRule 沿边扩散 → 压力/风险类变量
   └─ 求解器编排（新接）：按事件类型路由到对口求解器 → 排程/产能/挤占/瓶颈
        ↓
④ 卡点扫描（A 方案·仓主已定）
   卡点 = 越过 P90/P95 分位的变量 + 求解器报的不可行
   堵点 = 传导图必经节点（出度高 · 传递闭包大）
   脆弱点 = 当前值离阈值最近的
        ↓
⑤ 结论 + 溯源（R13）
   每个数字可悬浮出 {来源·公式·输入因子·关联规则}
        ↓
⑥ 采纳（R4 正门）
   结论要生效 → 生成 Action 提案 → S2 审批 → 才写真实世界
```

### 4.2 事件型扰动契约（新增，与现有数值型并存）

```ts
// 与 PerturbationSchema 并列，不替换它
DrillEventSchema = {
  kind: "ORDER_RESCHEDULE" | "ORDER_CANCEL" | "ORDER_INSERT"
      | "ORDER_RELOCATE" | "ORDER_REPRICE"
      | "MATERIAL_DELAY" | "MATERIAL_SHORTAGE" | "SUPPLIER_SWITCH"
      | "EQUIPMENT_FAILURE" | "CAPACITY_LOSS"
      | "FORECAST_BIAS",
  targetObjectId: string,     // 具体哪一单/哪批料/哪台设备
  payload: {...},             // 按 kind 判别联合：newDueDate / newLocationId / qtyDelta / delayDays …
  effectiveDay: number,       // 第几天发生（不是 tick）
}
```

**为什么不扩展 `PerturbationSchema`**：那是"拨数值"的语义，事件是"发生了一件事"。
硬塞进去会让两种语义共用 `magnitude` 字段 —— 下一个人读到 `magnitude: 3` 分不清是"+3 天"还是"×3"。

### 4.3 事件 → 求解器路由表

| 事件 | 主求解器 | 辅助 |
|---|---|---|
| `ORDER_RESCHEDULE` | `sop_reschedule`（已吃 `targetOrderId`+`newDueDate`） | `affected_orders` · `portfolio` |
| `ORDER_CANCEL` / `ORDER_INSERT` | `portfolio`（已吃 `frozenOrderIds`） | `capacity_forecast` |
| `ORDER_RELOCATE` | `portfolio`（跨基地重排） | `base_capacity_outlook` |
| `MATERIAL_DELAY` | `supply_demand_gap_attribution` | `order_fullchain` |
| `EQUIPMENT_FAILURE` | `bottleneck_matrix` | `job_shop_schedule` · `shared_bottleneck` |
| `FORECAST_BIAS` | `capacity_forecast` | `supply_demand_gap_attribution` |
| **任何事件** | `risk_timeline`（`horizon` = 用户输入的天数） | `concentration_risk` |

**这张表是数据驱动的**（登记在契约里），不是引擎 if 链 —— 否则违反 R14 且加事件要改引擎。

### 4.4 时间语义（tick → 天）

- 契约加 `SimSession.tickDays`（默认 1）
- UI 收「推演 30 天」→ `ceil(30 / tickDays)` 个 tick
- 求解器侧的 `horizon` / `advanceDays` / `weeks` 直接吃天，**不换算**
- ⚠ 判据：两条路（传导 tick 与求解器 day）**必须锚在同一个逻辑时钟**（A8 模拟时钟），
  否则「第 12 天越线」和「第 12 个 tick 越线」会是两个不同的日子

---

## 5 · 待补齐（按依赖排序）

| # | 缺口 | 层 | 依赖 |
|---|---|---|---|
| **G-DRILL-1** | `SimSession.tickDays` + UI 天数输入 + 与 A8 逻辑时钟对齐 | 契约+前后端 | 无 |
| **G-DRILL-2** | 卡点扫描器：P90/P95 分位判定 + 堵点（传递闭包）+ 脆弱点 | datacore | 无（用现有 state） |
| **G-DRILL-3** | `DrillEventSchema` 事件型扰动契约 | 契约 | 无 |
| **G-DRILL-4** | 事件→求解器路由表 + 编排执行器 | datacore | G-DRILL-3 |
| **G-DRILL-5** | 根源扰动层（预测偏差/插单取消/采购到货/设备故障）+ 传导边 | 种子+规则 | 见 `WO-SIM-ROOT-PERTURB-LAYER.md` |
| **G-DRILL-6** | 库存/BOM/OEE 投进 `world.state` | 种子 | 需先测规模影响 |
| **G-DRILL-7** | 演习结论 → Action 提案（R4 正门） | datacore | G-DRILL-4 |
| **G-DRILL-8** | Skill/Agent 接入：把演习结论交给 Agent 做自然语言解读与追问 | agentcore | G-DRILL-4 |

### 数据补齐明细

| 数据 | 现状 | 补什么 |
|---|---|---|
| 订单可扰字段 | state 里只有 `demandPressure`/`costPressure`/`shortageRisk` | `due` / `unitPrice` / `status` / 交付地点关系 —— **走事件不走 state** |
| 物料 | state 里只有 `priceShock`/`shortageRisk` | 采购到货延迟（事件）+ `onHand`/`inTransit` 进 state |
| BOM | **0 个对象进 state** | `Material.bomUnit` + `BOMDetail`(105) |
| 设备 OEE | state 里 780 个设备只带 `loadPressure` | `oee_current`/`oeeA`/`oeeP`/`oeeQ` |
| 阈值 | 无 | **A 方案**（仓主已定）：取该变量在世界里的 P90/P95 分位，零配置 |

---

## 6 · 分期

**第一期（用现有零件，不动种子）**
G-DRILL-1（天数）+ G-DRILL-2（卡点扫描）+ 三层重排 UI
⇒ 用户能输「30 天」、能看到卡点/堵点/脆弱点。**传导引擎单跑**。

**第二期（接求解器 —— 这才是"演习"）**
G-DRILL-3（事件契约）+ G-DRILL-4（路由编排）+ G-DRILL-7（Action 出口）
⇒ 能输「把 SO-3391 交期提前 10 天」，`sop_reschedule` 算出**挤占谁、代价多大**。

**第三期（根源层 + 数据补齐）**
G-DRILL-5 + G-DRILL-6
⇒ 能扰真正的根源（采购、插单、设备故障），而不只是压力类衍生量。

**第四期（Agent 解读）**
G-DRILL-8 ⇒ 演习结论交给 Agent 做解读与追问。

---

## 7 · 判据（怎么算做成了）

1. **不是绿测试，是真跑**：输入「SO-3391 提前 10 天」→ 屏上给出被挤占的具体订单号 + 代价数字，
   且每个数字能悬浮出溯源（R13）。
2. **两个世界物理隔离**：演习后 `worldId=REAL` 那一行**逐字节不变**（世界隔离反证）。
3. **确定性**（R6）：同输入同种子重跑，结论逐字节一致。
4. **求解器真被调用**：网络面板能看到 `POST /a/v1/solvers/sop_reschedule/invoke`，
   而不是前端自己算的数。
