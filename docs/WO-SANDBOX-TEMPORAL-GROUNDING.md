# WO · SANDBOX-TEMPORAL-GROUNDING（时序推演接地：外生驱动+模拟态求解+守恒+约束+回放校验）· 详细施工单

> 状态：**待派单**（给 dev 的施工规格；作者不实现）。编号 **S6**——**S1 的"hold/60天/利好利空"承诺的接地前置**。
> 一句话：补齐时序推演的五项接地配套——**①外生驱动序列**（未来需求/在途/检修真源逐 tick 喂进引擎）**②求解器模拟态 overlay**（决策维在模拟世界上算，非 live 库）**③hold 守恒诚实**（钉住水位必报"隐含净补/日"）**④约束层**（非负/上限/规则违例逐 tick 暴露）**⑤回放校验**（传导规则拿 A8 历史验证·UNCALIBRATED 有转正路径）。缺任一 → "60 天利好利空"是在真引擎上做假推演。
> 依据：配套审计（2026-07-11·用户钉"否则又是基于写死的数据做假推演"）。所有锚点已核对真实存在。
> 纪律：`DESIGN-refit-rollback-plan.md` 七原则 + KILL-MOCK-RED（无真源 → 诚实缺口卡,绝不假跑）。

---

## §0 本体引用与影响（铁律 0 · 门 `prd:check` 机器解析）

**触及对象类型（母体 §2）**：`SimSession`/`PropagationRule`/`PropagationTrace`/`TickState`（§2.I·`contracts/sim.ts`）· `DemandSegment`/`SopVersionRow`（§2·需求预测真源）· `PurchaseOrder`/`MaintPlan`/`Shipment`（§2·SOLVER_DATADEP 真角色）· `TsSeries/TsPoint`（§2.A8·历史时序）· `CalibrationPairRecord`（§2.E·回放机器）· 拟立 `ExogenousFeed`/`SimContextOverlay`（§2.I）。
**触及链路（母体 §3）**：沙盘链扩三节——真源→**ExogenousFeed（冻结进会话）**→逐 tick 注入 `propagateTick`；SimSession tick 态→**overlay**→SolverContext→决策维求解器；A8 历史→**replay**→传导规则校验→就绪认证 L3。
**不变量（母体 §5）**：R2 tenant · **R6 确定性**（feed 序列在 init 冻结进会话·同会话同 feed·回放纯重算） · **R13 溯源**（每 tick 注入量带 feed 来源·守恒差量可亮出） · R14 零业务常数（feed 映射抽象 CellRef·分摊复用真产能份额先例） · R16（缺 feed=生长信号→工单） · **KILL-MOCK-RED**（无真预测→诚实缺口卡·绝不合成未来）。
**断点（母体 §8）**：G-8（数据接入/就绪·horizon 覆盖检查）· G-10（改规则即改推演·回放校验闭环）· G-1（预诊断扩时序就绪）· G-3（scope 注入）。
**回写母体**：落地后 §2.I 登记 `ExogenousFeed`/`SimContextOverlay`、§3 补三节链路、§8 G-10 状态补"回放校验已接"；跑 `pnpm ontology:slices`。

---

## §1 问题（五个接地窟窿·均已代码核实）

| # | 窟窿 | 证据 | 不修的后果 |
|---|---|---|---|
| G-A | **无外生驱动通道** | `sim/propagation.ts` 只吃 `(graph,state,rules,pending)`——需求预测（`DemandSegment` p50/p90·`risk.ts:68-72` 带诚实位）/在途 ETA（purchaseOrder）/检修窗口（maintPlan）都在库里，**没有任何机制逐 tick 喂进引擎** | 60 天推演=初态衰减 60 步·假"未来" |
| G-B | **求解器读 live 非模拟态** | `datadep-context.ts loadContext` 迭代 `CONTEXT_ROLES` 从 **repos** 加载;无 sim overlay | ImpactAssessment 基线==情景（都读真库）·假评估 |
| G-C | **hold 违守恒** | §2.1 v1.1 的 `hold` 只钉值,不记维持它的流量 | "库存保持 X"凭空变料·魔法推演 |
| G-D | **无约束层** | `propagation.ts` grep clamp/nonneg/constraint **零命中** | 库存推成负数不报·物理不可能轨迹静默当真 |
| G-E | **回放校验未接线** | `calibration/replay.ts` M11 历史重放机器在,**从未对传导规则跑过**;A8 `ts_points`(365 天留存)在 | 系数永远 UNCALIBRATED·无转正路径·L3"已验证"无实义 |

---

## §2 范围与非范围

**In scope**：①ExogenousFeed（契约+init 冻结+引擎注入口）②SimContextOverlay（求解器模拟态适配·复用 replay 替换先例）③hold 守恒输出（隐含净补/日）④约束层（bounds+violations 入 trace）⑤回放校验接线（规则→A8 历史→容差→VALIDATED）+ S0 预检扩 **horizon 覆盖**（"需求预测覆盖 60 天吗"）。

**Out of scope（诚实边界）**：❌ 概率区间/蒙特卡洛带宽（单路径确定性推演·R6;不确定性带宽另立·**页面须标"单路径推演·非概率区间"**）❌ 造预测数据（无真预测=缺口卡+工单·绝不合成未来）❌ 改传导核数学（只加注入口/overlay/约束检查·全 additive）。

---

## §3 详细设计

### 3.1 ExogenousFeed（契约 + init 冻结·R6）
```typescript
// packages/contracts/src/sim.ts
export const ExogenousFeedSchema = z.object({
  feedKey: z.string(),
  target: CellRefSchema,                              // 注入到谁的哪个变量（复用 §2.1 CellRef）
  source: z.discriminatedUnion("kind", [              // 真源引用（R13·只认注册真源）
    z.object({ kind: z.literal("demand_segment"), segmentKeys: z.array(z.string()) }),   // p50 预测·按真产能份额分摊（复用 risk.ts:71 分摊先例）
    z.object({ kind: z.literal("sop_version"), versionRef: z.string() }),
    z.object({ kind: z.literal("purchase_order_eta") }),                                 // 在途→到达 tick 入库
    z.object({ kind: z.literal("maint_plan") }),                                         // 检修窗口→产能置 0/降
    z.object({ kind: z.literal("ts_series"), seriesKey: z.string() }),                   // A8 稀疏序列
  ]),
  series: z.array(z.object({ tick: z.number().int(), delta: z.number() })),              // **init 时从真源解出并冻结**（R6·会话内不再查库）
  live: z.boolean(),                                  // 真源存在才 true（沿 risk.ts:72 诚实位口径）
});
// SimSession additive: feeds: z.array(ExogenousFeedSchema).default([])
```
- **init 冻结**：`createSimSession` 时按 scope+horizon 从真源解出逐 tick 序列,**冻结进会话**（同会话同 feed·R6;真世界后续变化不影响已开会话——诚实标注"以 init 时点预测为准"）。
- **无真源 → 不造**：某 feed 无真数据 → 该 feed 不生成,预检（3.6）报缺口卡。

### 3.2 引擎注入口（`sim/propagation.ts`·additive 纯函数）
`propagateTick(graph, state, rules, pending, tick, feeds?)`——每 tick 开始把 `feeds` 中 `series[tick]` 的 delta 加到 target 格（排序确定·trace 记 `{feedKey, delta}` 来源·R13）。`feeds` 缺省空数组=现行为零变化（RL9）。

### 3.3 SimContextOverlay（求解器模拟态适配·G-B）
```typescript
// apps/datacore/src/sim/context-overlay.ts（新）
// buildSimSolverContext(tenantId, simState: TickState, base: SolverContext): SolverContext
// = loadContext(live) 之上，把 simState 覆盖到承载对象的对应 props（setByPath·复用 replay.ts M11 单因子替换同款机制）
```
- 求解器**零改**（照常吃 SolverContext）;ImpactAssessment/S3 决策维一律经 overlay 计算——**基线跑基线态、情景跑情景态**,才有真 delta。
- dryRun 语义（不落真值）沿 `app.ts:2864` recompute dryRun 先例（R4）。

### 3.4 hold 守恒诚实（G-C）
`applyScenarioOverlay` 执行 `hold` 时逐 tick 记录 `sustainingFlow[tick] = pinnedValue − naturalValue`（钉住值与自然演化值之差）：
- `ImpactAssessment` **必含**一维 `隐含净补/日 = mean(sustainingFlow)`（机械派生·它本身常是利空的一部分——维持高水位的代价）;
- 若 target 变量**无任何流入规则支撑**（图上没有指向它的传导边）→ 结果标注"**该水位无流入模型支撑·纯政策假设**"（诚实降级·不禁跑）。

### 3.5 约束层（G-D）
- `PropagationRule`/对象类型属性 meta 可声明 `bounds{min?,max?}`（配置·R14;如库存 min=0、产线利用率 max=100）;
- 引擎每 tick 后 clamp 并把**违例**记 `trace.constraintViolations[]`（`{objectId, stateVar, raw, clamped, boundRef}`）;
- horizon 末态经 overlay 调 `evaluate_rules`（A5 既有）——BLOCK 级违例进 ImpactAssessment（`违规数`维 + 结论标注）;
- 前端：S5 时间轴事件标记消费 violations（"W6 库容超限"）。

### 3.6 回放校验接线（G-E·给 UNCALIBRATED 转正路径）
- 新函数 `replayPropagationRules(tenantId, rules, window)`：取 A8 `ts_points` 近 N 天真实序列 → 以 N 天前态为初态、真实外生为 feed 跑传导 → 逐日对比预测 vs 实际 → 容差内 → 规则标 `VALIDATED`（复用 `calibration/replay.ts` M11 确定性重放机器）;
- 结果进就绪认证：**L3"已验证"获得实义**（=关键传导规则回放容差内）;S2 徽标 `UNCALIBRATED → VALIDATED` 的唯一转正路径;
- 无历史数据 → 诚实 `NO_HISTORY`（不假验证）。
- S0 预检扩 **horizon 覆盖检查**：hold/60 天类请求 init 前查"需求预测/在途是否覆盖 horizon"——不足 → 缺口卡（"预测仅覆盖 30 天,无法支撑 60 天推演"）+ GrowthTicket,**绝不静默截断或外推**。

---

## §4 触点清单
| 文件 | 改动 | 面 |
|---|---|---|
| `packages/contracts/src/sim.ts` | `ExogenousFeedSchema`·SimSession +feeds·trace +feed 来源/violations（全 additive） | 契约 |
| `apps/datacore/src/sim/propagation.ts` | +feeds 注入口·+bounds clamp+violations（缺省=现行为） | 引擎 |
| `apps/datacore/src/sim/context-overlay.ts` | **新**·模拟态 SolverContext（复用 replay setByPath） | 后端 |
| `apps/datacore/src/sim/replay-validate.ts` | **新**·传导规则回放校验（复用 calibration/replay M11） | 后端 |
| `apps/datacore/src/app.ts`（createSimSession/certification） | init 解 feed 冻结·L3 接回放结果·预检 horizon 覆盖 | 后端 |
| `docs/SYSTEM-ONTOLOGY.md` §2.I/§3/§8 | 回写 | 回写 |

---

## §5 验收（真跑·铁律 0.4·含回退演练）
1. **外生真驱动**：给租户真建 60 天 DemandSegment → hold 推演 60 tick,某需求承载格逐 tick 变化 === 冻结 feed 序列（逐值对）;**改真预测→重开会话→轨迹真变**（证非写死）。
2. **断真源诚实**：删该细分预测 → 同问句 → **缺口卡"预测未覆盖 60 天"+工单,不假跑**（green→red 自证·KILL-MOCK-RED）。
3. **overlay 真隔离**：同一决策维求解器,基线态 vs 情景态算出**不同值**（证读模拟态）;live 库数据在会话期间改动**不影响**已开会话（证冻结）。
4. **hold 守恒**：库存 hold X 推 60 天 → ImpactAssessment 含"隐含净补/日 N"且 N === mean(pinned−natural)（逐值对 trace）;对无流入边的变量 hold → 显"纯政策假设"标注。
5. **约束**：构造把库存推负的情景 → clamp 到 0 + trace 记违例 + 时间轴出"W?库存触底"标记（不静默）。
6. **回放校验**：对有 A8 历史的租户跑 `replayPropagationRules` → 容差内规则转 VALIDATED,S2 徽标随之变;无历史 → NO_HISTORY。
7. **R6**：同会话双跑（含 feeds/hold/violations）字节一致。
8. **回退演练**：feature `sim.temporal_grounding` 关 → feeds 不注入/overlay 不启用/约束不 clamp——回 v1.1 行为;契约 default([]) 旧会话零破坏。
9. **gates 全绿**。

## §6 失败判据（中止即回退）
- F1 无真源却生成 feed（合成未来·违 KILL-MOCK-RED）→ 关闸。
- F2 overlay 泄漏（情景计算污染 live 库/落真值）→ 违 R4,立即回退。
- F3 feed 未冻结（会话中查库·R6 破）→ 修 init 冻结。
- F4 hold 无守恒输出仍出"利好利空"→ 违诚实,ImpactAssessment 拒发布。
- F5 门红 → 不进下一期。

## §7 排序（改变 S1 的承诺边界）
- **S1 MVP（不依赖 S6）**：shock 短程推演 + 渲染器落地 + 基于**状态变量**的结论（缺口类·引擎直出·无需求解器 overlay）。
- **S6 解锁**：`hold`/长 horizon（60 天）/**求解器决策维 ImpactAssessment（利好利空）**——这三样在 S6 前**不得上线**（上线即假推演）;S1 期间对 hold 类问句诚实答"时序接地配套建设中"+工单。
- S6 与 S2 联动（VALIDATED 转正）、与 S5 联动（violations 时间轴标记）、与 S0 联动（horizon 覆盖预检）。

## 附录 · 证据锚点
`sim/propagation.ts`（无 feeds/无 clamp·grep 零命中）·`risk.ts:68-72`（DemandSegment/SopVersion 真源+诚实位+分摊先例）·`datadep.ts` r(maintPlan/purchaseOrder/shipment/demandSegment/sopVersion)·`app.ts:2246`（A8 ts_points）·`contracts/actions.ts:148`（ts_points 365 天留存）·`calibration/replay.ts`（M11 历史重放机器）·`datadep-context.ts`（loadContext 读 live repos）·`app.ts:2864`（recompute dryRun 先例）·母体 §5 R2/R6/R13/R14/R16/KILL-MOCK-RED · §8 G-1/G-3/G-8/G-10。
