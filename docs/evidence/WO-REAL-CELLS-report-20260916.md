# WO-SIM-REAL-DATA · 交付报告（2026-09-16）

> 分支 `claude/handoff-real-cells` · 复验 dev 复验本代码。基线 `0207b9c6`。
> 主判据 **已达**（**4,171 ≥ 3,896**，余 +275）—— 仓主 2026-09-16 ③全批 A⚠ 6 条，落 5 条（+480 格）；
> 第 6 条 orderChurn 实测无诚实源字段，按「不硬凑」红线停笔（证据见 §2 末段）。

---

## 1 · 主判据（验收判据 1）

活服务 `SEED_DEMO=1`：`GET /a/v1/sim/sessions` 的 `scope.baseSnapshotOrigin.measuredCells`

| 态 | measuredCells | 证据 |
|---|---:|---|
| 改前（WO 基线） | **450** | WO §7 实测 |
| §1+§3（Customer 活样本） | 470 | 台账 §3 段 |
| §2 全量（20 条 A 档物化） | 3,691 | 真服务烟囱 47114/47115 + seam ⓒ |
| **③ A⚠ 5 条（仓主全批落 5）** | **4,171** | **真服务烟囱 47119（本机实测）+ seam ⓒ** |
| **反向臂（去掉 §1 recompute）** | **退回 450 整** | `/tmp/reverse-arm.mjs` |

- **正向**：450 → 4,171（+3,721 = 25 条规格 3,701 格 + Customer 20 格基线差）。
- **反向臂 ✓**：去掉 §1 recompute ⇒ **退回 450 整**（只名字撞真值 Order.qty/unitPrice/leadDays，
  一个不多一个不少）。证明 3,721 格全靠 recompute 物化，**不是写死的**（WO：只测正向不算）。
- ✅ **主判据 ≥3,896 达成（4,171，余 275）**。A⚠ 第 6 条 orderChurn 停笔不减格 —— 它从未物化，
  传导链 orderChurn → Model.demandLoad 走哈希基线值不受影响。

## 2 · 逐条判据（验收判据 2 + §6.6 九列张表）

20 条 A 档规格，物化 **N/N 全满**（`/tmp/per-spec-cells.mjs` 现算，总和 3,241 = 3691 − 450 基线自洽）：

| specKey | targetType.prop | formula | 物化 N/N |
|---|---|---|---|
| customer_receivable_pressure | Customer.receivablePressure | `COALESCE(this.receivables*100/this.creditLimit,0)` | 20/20 |
| equipment_failure_rate | Equipment.equipmentFailure | `100 - this.health_score` | 780/780 |
| equipment_load_pressure | Equipment.loadPressure | `(1 - this.oee_current)*100` | 780/780 |
| process_queue_pressure | Process.queuePressure | `this.utilization*100` | 650/650 |
| wiplot_feed_pressure | WIPLot.feedPressure | `COALESCE(SUM(in(work_order_yields_wip_lot).qtyPlanned)*100/this.qty,0)` | 260/260 |
| workorder_release_pressure | WorkOrder.releasePressure | `COALESCE((this.qtyPlanned-this.qtyActual)*100/this.qtyPlanned,0)` | 260/260 |
| line_blocked_pressure | Line.blockedPressure | `COALESCE(SUM(out(line_runs_work_order).qtyPlanned)*100/this.max_capacity_day,0)` | 130/130 |
| line_util_pressure | Line.utilPressure | `this.utilization` | 130/130 |
| defect_record_pressure | DefectRecord.defectPressure | `COALESCE(this.qty*100/SUM(in(wip_lot_found_defect).qty),0)` | 85/85 |
| purchaseorder_expedite_pressure | PurchaseOrder.expeditePressure | `COALESCE(this.shipDay*100/(this.etaDay-this.orderDay),0)` | 30/30 |
| purchaseorder_procurement_delay | PurchaseOrder.procurementDelay | `this.arriveDay - this.etaDay` | 30/30 |
| supplier_delivery_delay | Supplier.deliveryDelay | `(1 - this.onTimeRate)*100` | 15/15 |
| supplier_procurement_delay | Supplier.procurementDelay | `this.leadTime - this.transitDays` | 15/15 |
| base_load_index | Base.loadIndex | `COALESCE(this.committedQty*100/(this.formationCapDaily+this.agingCapDaily),0)` | 13/13 |
| materialbalance_gap_pressure | MaterialBalance.gapPressure | `COALESCE(this.gapTon*100/this.netDemandTon,0)` | 9/9 |
| material_price_shock | Material.priceShock | `this.devPct*100` | 8/8 |
| material_shortage_risk | Material.shortageRisk | `COALESCE((this.dailyUse*this.leadTime-this.onHand-this.inTransit)*100/(this.dailyUse*this.leadTime),0)` | 8/8 |
| model_cost_pressure | Model.costPressure | `COALESCE(this.unitCost*100/this.unitPrice,0)` | 6/6 |
| model_forecast_bias | Model.forecastBias | `COALESCE((this.totalDemand-SUM(in(order_for_model).qty))*100/this.totalDemand,0)` | 6/6 |
| model_supply_risk | Model.supplyRisk | `COALESCE(AVG(out(model_uses_material).shortageRisk),0)` | 6/6 |

**A⚠ 档 5 条（仓主 2026-09-16 ③全批落 5，口径=对现有真业务字段的代理，建模判断）：**

| specKey | targetType.prop | formula | 物化 N/N |
|---|---|---|---|
| order_cost_pressure | Order.costPressure | `COALESCE(this.creditUsedRatio*100,0)`（实测 40–115，>100=超授信如实） | 150/150 |
| order_demand_pressure | Order.demandPressure | `COALESCE(this.demandDelta*100,0)`（实测 0–60） | 150/150 |
| order_shortage_risk | Order.shortageRisk | `COALESCE(this.outsourceRatio*100,0)`（实测 0–35） | 150/150 |
| materialbatch_procurement_delay | MaterialBatch.procurementDelay | `this.ageDays`（实测 1–154 天，天数族不夹） | 24/24 |
| model_demand_load | Model.demandLoad | `COALESCE(this.orderCount*100/this.capacity,0)`（实测 23.6–138，>100=超负荷如实） | 6/6 |

**③批第 6 条 orderChurn 停笔（顶回来，不扣分）**：Order 数值字段经 `/tmp/a6-probe.mjs` 实测
（n=150，进世界过滤）——ratio 族只有 3 个（demandDelta/outsourceRatio/creditUsedRatio），
已按仓主批的映射各归其主；给它复用 demandDelta ⇒ 与 demandPressure **字节级复制 = 硬凑**（WO 红线 3）。
`early`/`pri` 非数值（n=0，DSL 只算数值）；leadDays/qty/unitPrice 是 WO 红线真值字段且语义非「变更」。
仓里无第 4 个诚实源 ⇒ 不写。主判据 4,171 ≥ 3,896 不靠它过线。

**臂1–臂5 逐条过**（seam 16 臂 + 台账 §2 段全表）。抽验代表（自属性/单跳聚合/链方向易错/AVG 归一/反向线性各覆盖）：

| specKey | 臂1 手算 | 臂1 实测 | 臂2 对照真值 | 臂3 敏感 | 臂4 反向 | 臂5 变异 |
|---|---|---|---|---|---|---|
| customer_receivable_pressure | 22.67(WO范本) | 22.67 | WO 实测 22.67 ✓ | ×2⇒×2 ✓ | 删分母⇒兜0 ✓ | 改*为/⇒臂1红 ✓ |
| equipment_failure_rate | 100−83=17 | 17 | 域[0,100] ✓ | hs↓10⇒↑10 ✓ | 删hs⇒退回 ✓ | 100-改100+⇒红 ✓ |
| line_blocked_pressure | 36.2571 | 53.13/27.72 | 实测27–182 ✓ | cap×2⇒÷2 ✓ | 删cap⇒兜0 ✓ | out改in⇒全undefined红 ✓ |
| model_cost_pressure | 2.9085 | 2.91/2.47 | 口径2.5–3.9 ✓ | cost×2⇒×2 ✓ | 删price⇒兜0 ✓ | 改*为/⇒红 ✓ |
| model_supply_risk | −29.44 | −29.44 | 物料均值域内 ✓ | risk↑⇒↑ ✓ | 断链⇒兜0 ✓ | in改out⇒红 ✓ |

> **臂2 无独立源式子**（feedPressure/expeditePressure/releasePressure/gapPressure/loadIndex 等派生压力族）：明写「无独立源」—— 它们是本单新建口径，仓里无第二来源，已列入业务确认清单（悬置项 ③ 同批）。

## 3 · 口径判据（验收判据 3 · 5 抽样样张）

5 条抽样全部落在各自业务域内，**零越域**（越域 = 量纲错配 = 退回重写）：
Equipment.equipmentFailure∈[0,100] · Line.utilPressure∈[0,100] · Process.queuePressure∈[0,100] ·
Model.costPressure∈[0,100] · Model.forecastBias∈[−100,100]。无一差一个数量级。

## 4 · R6 确定性（验收判据 4）

同 `(seed=42)` 重铺世界 ⇒ measuredCells / totalCells / **逐格 state JSON** 字节级一致（seam R6 臂）。
派生为纯函数，⛔ 无时钟无随机（seedHash01 金丝雀确定性兜底）。

## 5 · 绑定判据（验收判据 5 · §3）

`valueRef` 指向不存在的 specKey ⇒ **当场抛错变红**（`绑定断裂…⛔ 不许静默回落哈希`），
⛔ 不静默回落。变异复原后播种恢复 3691（seam §3 臂 + mutate-ref.mjs 双证）。
**校验收窄**（9ae540859）：规格库非空才强制 —— 生产路径断引用必红，不播种规格的单元接缝测试不误伤。

## 6 · 四包门（验收判据 6）

| 门 | RC | 说明 |
|---|---|---|
| `pnpm -r build` | **0** | 四包全绿 |
| datacore 全量（362 文件 / 2557 条） | 1 | **4 红全有归属**：3 条负载抖落（隔离全绿）+ 1 条**基树前置红**（下表） |
| frontend 全量（321 文件 / 2292 条） | 1 | **24 红全负载抖落**：隔离重跑 19/20 文件绿（121/122 条）；余 1 = stale-claims 门脚本直跑 **8.8s RC=0 绿**，20s 测试帽在负载下不够 |
| agentcore（四包门那次） | 1 | 唯一红 = solver-cancel 时序抖落（隔离 3/3 绿）；本单 `git diff --stat 0207b9c6 HEAD -- apps/agentcore/` **空** |
| `pnpm -r typecheck` | 2 | **恰 4 条前置红**，全在 `apps/agentcore/test/`（capability-map-live-seam ×1 · rule-discovery-seam ×3）|

**datacore 4 红逐条归属**（全量墙钟 3.1h，load avg 200–330，负载来自门外 DingMeeting/WindowServer 等；同文件实测负载 187s vs 平静 79s = **2.4×**）：

| 红 | 全量中形态 | 平静机隔离复跑 | 定性 |
|---|---|---|---|
| vle-acceptance VL2 | 120s 超时 | 93s **绿** | 负载抖落 |
| vle-acceptance VL5 | 120s 超时 | 98s **绿** | 负载抖落 |
| empty-tenant-bootstrap CL.4 | 180s 超时（跑到 247s） | 75.9s **绿**（基树同绿） | 负载抖落 |
| object-constraint-refs ⑤b | 断言错值（jinhua≠zigong） | **同错复现** | **基树 0207b9c6 逐字节同错 = 前置红**（悬置项 ⑥）|

**本单交付件在全量里的成绩**（③ 前 16 臂）：`sim-real-cells` 16/16 · 守门员 `sim-order-real-fields` 6/6 ·
`slice-deriv-empty` 4/4，全绿。**③ 增量（仓主全批）的变更面重验**：seam **19/19** · slice **4/4**（金值 28）·
守门员 **6/6**，三文件串行 `--maxWorkers=1` 全 **RC=0**（`/tmp/a6-tests.txt+.rc` / `/tmp/a6-guard.txt+.rc`），
`pnpm --filter datacore build` **RC=0**，真服务烟囱 47119 **measuredCells=4,171 / cells=6,363**。
四包全量（L2 集成门）按分层方案留给并 canonical 的安静时间窗（§6 末段）。

**typecheck 4 红 base 对照 ✓**：base 的 `rule-discovery-seam.test.ts:274-275` / `capability-map-live-seam.test.ts:398` 与当前报错行号一字不差。
⇒ 4 红前置、与本单无关，按 WO 判据 6「在 base 上确认同样 4 条，别去修它」执行，**未修**。

**⚠ 耗时教训（仓主定性「模式太传统」后的分层方案，记入台账待裁）**：全量门回答的是「4 个文件的 diff 弄坏了什么」这个局部问题，却重证了 2537 条已绿测试 3.1h。
后续按 **L1 变更面（`vitest related` ∪ 金丝雀清单 ∪ 本单 seam，分钟级）/ L2 集成门（并 canonical 时全量 + 安静时间窗 + maxWorkers=2）/ L3 漂移巡检（全量定时扫，今天的 ⑤b 就是它抓的）** 分层；
结构性大杠杆 = **确定性快照还原**（R6 字节一致 ⇒ 播种一次、各文件从快照还原代替重合成，套件级 ÷5–10），待派 WO。

## 7 · 接缝驱动（验收判据 7）

`sim-real-cells.seam.test.ts`（**19/19 绿**，③ 后）驱动整条链：编译规格 → recompute → 播种世界 →
`deriveSeedBaseSnapshot` measuredCells。非只测 `parseFormula` 函数。**19 臂全过**：
ⓒ 接缝（4,171）+ ⓑ 逐条物化（25 条）+ 臂1×8（含 A⚠ 3 条：shortageRisk×100 / procurementDelay 恒等 /
demandLoad 先乘后除）+ 臂2（+Order.demandPressure/shortageRisk 入域）+ ⓐ 引擎归属（清规格⇒25属性全消失）+
臂3×2 + 臂4 + 臂5 + R6 + §3 + 金丝雀。守门员 `sim-order-real-fields` **6/6** · `slice-deriv-empty` **4/4**（金值 28+名单）。

---

## 悬置项（验收前需仓主裁决，不阻塞本报告其余判据）

| # | 事项 | 影响 |
|---|---|---|
| ~~②~~ | **已闭**：主判据差 205 格 ⇒ ③ 落 5 条后 **4,171 ≥ 3,896 过线** | — |
| ~~③~~ | **已闭**：仓主 2026-09-16 **全批** A⚠ 6 条 ⇒ 落 5 条（+480）；orderChurn 无诚实源停笔（§2 末段） | — |
| ① | 红门台账更正（WO 称 6/3 红是 desat3 本地态，本树 6/6 绿） | 无，仅台账 |
| ④ | forecastBias 本树恒 0（真值：seed 的 totalDemand≡Σqty 恒等，WO 的 49–77 在 desat3 树） | 保留死口径 or 换式 |
| ⑤ | desat3 门 ⑤e 裁决（budgetTicks 2→95）→ 验收基线或需重算 | 不属本单，等裁决 |
| ⑥ | **⑤b 基树前置红**（object-constraint-refs §⑤b）：基树 0207b9c6 与本树**逐字节同错**（期望 zigong-pack 实得 jinhua-calendering）；本单代码解析上不在其链路（该测试不播种规格 ⇒ §3 校验跳过、不调 recompute、比较器与 Line 播种零改动）。不属本单修，**需要 WO-CONSTRAINT-REFS 的主人裁决** | 集成线上一条确定性语义红 |

## 落地时抓到的 WO 陷阱表之外的坑（第 11、12 个）

- **⑪ 聚合内不许算术**：`SUM(x.prop + 100)` 抛 `expected ")" got "+"` ⇒ supplyRisk 用 AVG 不用 SUM/(SUM+100)。
- **⑫ 链方向必须逐条实测，不能抄草案**：5 链方向全表（probe-dir2.mjs），`model_uses_material` 是
  Model→Material（从 Model 看用 `out()`），初版抄 in() 全 undefined。

## 停在哪 / 还差什么

- **停在哪**：分支 tip（见下方 push 记录）。§1/§2/§3/五道臂/接缝测试/反向臂/四包门（含 4+24 红逐条归属）
  全部交付；**③（仓主全批）已落：主判据 4,171 过线**，变更面三门 + build + 真服务烟囱全 RC=0。
- **还差什么**：① forecastBias 处置（悬置项④，建议保留死口径）② 悬置项⑥ 的 ⑤b 前置红派修
  （仓主已授权我按铁律决断 ⇒ 派单）③ L2 集成门（并 canonical 时安静时间窗全量）。其余判据已全绿。
