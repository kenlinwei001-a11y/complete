# PRD · 全域联合推演（GlobalSim）— 总纲 + §1 冻结契约 + 5-WO 分解 + 本体引用

> 状态：Phase 全链闭环（DATA · SOLVER · cell-pack 接真 · FRONTEND · ACTION 均在 canonical；AGENT NL 大脑另单在途）。
> 本文是 dev 反馈「§1 契约 PRD 仍不在仓库」的收口——**§1 冻结契约的唯一权威 = `packages/contracts/src/global-sim.ts`**（zod schema 即契约），本文为其总纲与本体接线记录。

## 0 · 一句话

在既有「联合守恒 portfolio 求解器」（`G-PORTFOLIO-LOCAL-ONLY` 已闭）之上，加**七维联合数学** + **洞察→行动写回闭决策环**，让「全订单 × 全基地 × 时间共享产能不重复占用」一次联合最优，且**采纳后基线真变、下一轮推演读到真变**（`G-LOOP-FEEDBACK`）。

## 1 · §1 冻结契约（权威 = `contracts/src/global-sim.ts`）

工单原稿把契约标为「§1」，但正线并无 §1 文本；按工单 **§3 冻结契约**为唯一权威落成 zod schema（字段形状一字不改·消费方 = datacore portfolio 求解器）。

### 1.1 请求 `GlobalSimRequest`（七维开关 + 决策集）

| 维 | 字段 | 语义 |
|---|---|---|
| ① 物料联合约束 | `materialConstraint` | 无物料数据 → `false` 诚实兜底不假装 |
| ② 产线粒度 + 换型按小时 | `lineGranularity` | `cap[b,t]→cap[b,line,t]`·换型读线上当前在跑型号 |
| ③ 电芯-Pack 两阶段网络 | `twoStage` | 电芯段→transit→Pack 段→交付=Pack 完工窗·两笔守恒 |
| ④ 订单分批 | `allowSplit` | `x∈{0,1}→y∈ℤ≥0`·`Σ_b,t y=qty`·加分批固定成本+最小批量 |
| ⑤ 杠杆再优化 | `levers[]` | 经 `capacity_forecast/generic_inference` 真派生调产能/物料→重解（灭 `G-WHATIF-HARDCODED-LEVERS`） |
| ⑥ 优先级硬锁 | `priorityLocks[]` | `must_serve` 硬约束·保护有代价·总代价真升 |
| ⑦ 递进批次承诺 | `committedBatches[]` | 转 portfolio `committed` 预扣净产能·固定背景 |

其余：`decisionSet`（缺省=全 OPEN 单）·`objectives`（≥1·缺省 `[max_ontime,min_cost]`）·`frozenOrderIds`/`frozenCapacityMode`·`seed`（R6·缺省 42）。

### 1.2 响应 `GlobalSimResponse`

- `scenarios[]`：一目标一联合解（`kpi` + `allocation` + `provenance`）。
- `schedule[]`：两阶段排产行（`batches`[电芯段] → `transitDays` → `packBase/packWindow` → `deliverDay=Pack完工+在途`·`freightCost`·`changeoverHours`）。
- `blocked[]`：被卡单归因（物料短缺→具体 Material+Supplier·R13）。
- `leverDeltas[]`：杠杆再优化每 KPI before/after。
- `reconciled` / `mockNotes[]` / `materialConstraint` / `status` / `optimal` / `summary`。

### 1.3 两条红线（写进契约头·门禁守）

- **单位红线（用户校正）**：换型全链 **小时** `changeoverHours`，不残留分钟（闭 `G-CHANGEOVER-MINUTES`）。
- **诚实红线（KILL-MOCK-RED）**：WO-DATA 未落的供给（`baseDistanceKm/transitDays/freightCost/cellSourceMap/Line.capacityDaily`）用 mock 时**标注来源**（`provenance.mockNote` + `mockNotes[]`）；`materialConstraint:false`/无线级实测→诚实回退全局值 + 标注，不假装真数据。R6 确定性（`forecastStart` 锚·禁 `Date.now/random`·同输入同杠杆两跑字节一致）。

## 2 · 5-WO 分解与集成状态

| WO | 半 | handoff | canonical | SEAM-GATE | 断点 |
|---|---|---|---|---|---|
| GSIM-1-DATA | 数据 | `130e3576` | `3b14e321` | `global-sim-data.test.ts` | 闭 `G-TRANSIT-NOT-GEO`·`G-NO-FREIGHT-COST`·`G-CELL-PACK-2STAGE`(数据半) |
| GSIM-2-SOLVER | 引擎 | `wo-gsim-solver` | `d292765f` | 8 SEAM（变异反证非重言） | 七维联合数学·换型小时 |
| cell-pack 接真收口 | 接缝 | 审核方收口 | `2819e99d` | `gsim-integrate.test.ts`（`mockNotes` 清空证 mock 回退未走到） | 闭 `G-CELL-PACK-2STAGE` **全接缝** |
| GSIM-3-FRONTEND | 前端 | `wo-gsim-frontend` | `7731d7c7` | `global-sim-cockpit.test.tsx`（5 绿） | 决策驾驶舱五区七块 |
| GSIM-5-ACTION | 行动 | `e7e8600b` | `76e6db8e` | `gsim-action-loop.test.ts`（采纳前≠执行后·端到端） | 闭 `G-DECISION` 行动半 / `G-LOOP-FEEDBACK` |
| GSIM-4-AGENT | NL 大脑 | `5e1af4f3` | ⏳在途 | `compose-sim-seam.test.ts` | §3.1 骨架·消费 Phase2-C 组合器 |

> **接缝纪律教训**：跨「数据+引擎」两半的特性（换型口径、电芯来源）必须**一人整单**——SOLVER 独立 PASS ≠ 能用，真闭要靠 cell-pack 接真收口的 integration門（`mockNotes` 清空 = 证 solver 内 mock 回退未被走到）。这正是「绿测试≠能用·断在接缝」堵死处。

## 3 · WO-GSIM-5-ACTION 规格（洞察→行动写回·闭决策环）

**🚦范围边界**：`datacore/src/actions.ts`（`GlobalSimPlanExecutor`）·`app.ts`（`setExecutor` 真装配）·`domain.ts`（`ActionDraft.fingerprint` + `ObjectOrigin` ACTION 变体）·`contracts/src/actions.ts`（`GlobalSimPlanPayloadSchema/GlobalSimServedItemSchema` additive）·`GlobalSimView.tsx`（`onAdopt` additive 附 `served`·**不改渲染·不碰 portfolio 路由**）。

**S2 引擎复用（非重建）**：`actions.ts` 已有全态机 `DRAFT→PENDING_APPROVAL→APPROVED→EXECUTING→EXECUTED`、审批链、发起人不得自批、`useActionDraft()` hook。本单只加：① `plan_change(source:"global-sim")` 真实执行器 ② `onAdopt` 附 `served` 分配 ③ 执行时回灌基线。

**回灌闭环**：采纳 → `plan_change` ActionDraft → S2 审批 → 执行时物化在产 `WorkOrder`（承诺占用·portfolio 读为 committed WIP·预扣净产能）+ served 订单 `status→已排产`（移出 OPEN 决策集）+ 跨基地分配物化 `InterBaseTransfer` 两段就近调运 leg（`origin=ACTION`·R13 溯回方案）→ 发 `action.executed` → **下一轮 portfolio 读到真变基线**。

**幂等**：`planFingerprint=hash(source|objective|sorted(displaced)|summary)` 同方案二次采纳返既有草稿不重复生成（R6）。

**SEAM-GATE 头号判据**（`gsim-action-loop.test.ts`·接缝驱动·端到端）：`before=runPortfolio` → 采纳 → 断言 `status==="PENDING_APPROVAL"`（真审批·非 toast）→ approve → `EXECUTED` → 物化 `WorkOrder(origin=ACTION, status="生产中")` → `after=runPortfolio` → **断言 `after.occupancy≠before.occupancy`**（真基线变）+ 被追踪单不再自由 + 新 committed `WO-GS-*` 入基线 + `freeOrdersAfter<freeOrdersBefore` + 仍 `reconciled`；幂等（1 Action + 1 物化）；R6 字节一致 + 跨租户 404。

## 4 · 故事脚本倒推缺口册（本 PRD 的驱动源）

沿九幕故事脚本倒推，识别每环节配套数据缺口：

| 缺口 | 病根 | 收口 |
|---|---|---|
| `G-CELL-PACK-2STAGE` | 纯 PACK 基地（如邯郸·`factory_type==="PACK"`）装配用芯从何而来无数据 | 供芯图 `cellSourceMap(bases)`（就近·nearest-first）+ 引擎两段网络 + 接真 integration門 |
| `G-TRANSIT-NOT-GEO` | 跨基地在途 = 哈希常量·与地理无关（`2+floor(h/46)%12`） | `baseDistanceKm` 哈弗辛距离派生在途（`ceil(km/dailyTruckKm)`·近基地真更快） |
| `G-NO-FREIGHT-COST` | 跨基地调拨无运费·经济性不可推演 | `freightCost=km×tonKmRate×qtyToTon`·计入 `cost` 目标 |
| `G-CHANGEOVER-MINUTES` | 换型口径分钟 + home-base 近似（非线级实测） | 全链改**小时** `changeoverHours` + 产线粒度读线上在跑型号 |

## 5 · 《本体引用与影响》（铁律 0 强制）

- **对象类型**：`Order` · `WorkOrder`（回灌物化·`origin=ACTION`）· `InterBaseTransfer`（两段调运 leg）· `Line`（产线粒度）· `Action/ActionDraft`（S2）· `DemandSegment`（客户级影响细分）。
- **链路（§3）**：`全订单×全基地联合最优 → 方案对比 → 采纳 → S2 审批 → 执行回灌基线（WorkOrder/InterBaseTransfer 物化）→ 下一轮联合推演读真变`（新增「洞察→行动写回·闭决策环」链路·已回写本体 §3）。
- **事件**：`action.executed`（回灌后发·驱动下一轮基线）· `{kind}.updated`（对象物化失效缓存·传播 SLO ≤60s）。
- **不变量**：R6（确定性·`forecastStart` 锚·禁时钟/随机）· R13（每 KPI/分配/被挤/物化带 provenance）· R14（BASE_REGISTRY/SEG_REGISTRY 单一来源·禁焊死·debattery 门守）· R4（采纳走审批·不静默写回真值）。
- **断点**：闭 `G-PORTFOLIO-LOCAL-ONLY`（前置）· `G-CELL-PACK-2STAGE`（全接缝）· `G-CHANGEOVER-MINUTES`· `G-TRANSIT-NOT-GEO`· `G-NO-FREIGHT-COST`· `G-DECISION`(行动半)· `G-LOOP-FEEDBACK`· `G-WHATIF-HARDCODED-LEVERS`（杠杆真派生）。

## 6 · 已知诚实边界（不假装闭）

- 前端 `GlobalSimView` 当前驱动经典 `portfolio` 解（`PortResult`），**SOLVER 的七维 `GlobalSimResponse` 尚未上屏**（引擎+数据层已闭·integration門绿）；上屏为独立 follow-up WO（surface-7dim），不阻塞 ACTION（ACTION 靠 `orderId` 咬合·两种解形都带）。
- `freightCost/cellSourceMap` 两段就近供芯 enrichment 的前端展示留 WO-GSIM-1-DATA 接缝（ACTION 本单不硬依赖）。
