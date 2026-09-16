# WO-REAL-CELLS · 开工笔记（2026-09-16）

> 基线：`claude/handoff-sim-world-single-source` @ `0207b9c6`（WO 真正的母树；canonical 8775dc67d 上的
> 数 0/7295 与工单 450/6363 不符，全部判据以本树为准）。
> 本文件替代被 `reset --hard` 抹掉的 20260916 旧版笔记；旧版基线（canonical）作废。

---

## 补充 ① · 红门诊断（开工第一件事，已做完）

**实测结论：`apps/datacore/test/sim-order-real-fields.seam.test.ts` 在本树（0207b9c6）6/6 全绿，RC=0。**
（命令：`npx vitest run test/sim-order-real-fields.seam.test.ts --no-file-parallelism`，39.3s，机器当时零 vitest。）

**「6 tests / 3 failed」不成立 ⇒ 按工单「顶回来不扣分」纪律，改台账不改代码。** 证据链：

1. **门不在 desat3 上**。`git cherry HEAD FETCH_HEAD(claude/handoff-desat3 @ f072c8dc)`：10 个提交
   （41176774 e18e1eed 81bd772e 21bd880a c7520cd2 f5cfb931 fafd88d4 1b21abf6 ab579cc8 f072c8dc），
   `git diff --stat HEAD...FETCH_HEAD -- <门文件>` **空** —— desat3 一行没碰这道门。
2. **红是 desat3 自己 worktree 的本地态**。门被 desat3 在 `seed.ts` / `synthetic/battery.ts` /
   `propagation-inputs.ts` 里动的系数、域表、权重、刻度撞红；那些改动**不在我基线上**。
   WO 增补（`0207b9c6`）写下「6/3 红」时看的是那个 worktree。
3. **门的性质决定它不可能在本树红**：它断言「1.0 系数原样透传 + max」——
   `expect(readBefore).toBe(top.props.unitPrice)` 这种**逐字节等式**（测试 ②③⑤）。
   这恰好是本单要守的语义；desat3 的 `inflowCoefficient` 系数化（提交 81bd772e）撞的正是它。
4. **合并 desat3 后会再红吗**：门的 `runWorld` 走 tick1/3/5，全部 ≤ 5 拍，**绕开 TICKS 3→96**
   （提交 21bd880a）与 budgetTicks 2→95 的裁决面；max 语义不随拍数漂（测试 ⑤ 咬死）。
   风险面集中在 desat3 是否改这三条边的**系数**——三条边 `coefficient:1.0 / coefficientRef:null`
   且带「⛔ 不写 0.8」的护注释。合并时复跑本门即可，本单不提前背这口锅。

**三条 X⇒Y（按工单格式，针对「红」这个台账陈述本身）**：

| # | 台账说（X） | 实测（Y） |
|---|---|---|
| 1 | 门今天红（6/3） | 门在本树 6/6 绿；红面 = desat3 的 10 个未并提交，不在本树 |
| 2 | 红说明「传导标定」和「真值进世界」撞了 | 两线在本树未交汇（desat3 未并入）；撞点在 desat3 本地，撞的是 1.0 系数透传语义 |
| 3 | 开工前必须先修门 | 无门可修；要守的是「本单任何改动不得让这 6 条转红」 |

## 补充 ① 的衍生约束（写进本单验收）

- §1/§2/§3 每一步交付都必须**复跑本门保持 6/6** —— 它是 450 格真值的守门员，也是本单增量格的守门员。
- desat3 收编（仓主裁决 A/B/C 后）时，**并线方须复跑本门**；红了归并线方，不归本单。

## 补充 ③ · 第 1 步状态复核（与 WO 增补一致）

desat3 @ f072c8dc 仍未并入本树（`git merge-base --is-ancestor` = false，上同）。
⇒ 按增补纪律：**先做 §1（播种 recompute）与 §3（valueRef），§2 的 32 条式子可以写但验收要等裁决**。

---

## 前置验证（任务 #8，本树重测）

| WO 断言 | 实测（本树） | 出处 |
|---|---|---|
| 播种期零 recompute | ✅ 确认：`seedDemoDerivationSpecs` 只 compileSpecs + indexDerivationRefs；`server.ts` :101→:107 之间无任何 recompute 调用 | `server.ts` 播种序列 / `seed-derivation-specs.ts` |
| 绑定判据 = 名字撞 + 有限数 | ✅ 确认：`o.props[v]` typeof number && isFinite ⇒ measuredCells++，否则 hash 兜底 | `sim/seed-world.ts` `deriveSeedBaseSnapshot` |
| DSL 够用（A 档） | ✅ 确认能力面：单跳 out(L)/in(L) · SUM/MIN/MAX/AVG/COUNT .prop WHERE== · IF/COALESCE/CLAMP · ≤2000 字符 · 逐算子 4 位定点（⇒ 先乘后除）· div-zero→null+warning | `ontology-dsl.ts` |
| 450 格只喂 3 条边 | ✅ 确认：Order.qty/unitPrice/leadDays →（order_for_model）→ Model.backlogQtyTop/backlogPriceTop/backlogHorizonDays，`combine:"max"`、`coefficient:1.0`、`coefficientRef:null`、`weightRef:null` | `seed.ts` :1661-1750 |
| 那 3 个 target asSource=0 | ⏳ 待 ② 全表（51 对逐变量 asSource/asTarget 现算）确认 | 补充 ② |
| recompute 增量语义 | ✅ 确认：changes 空 ⇒ dirty 空 ⇒ 零计算；全量初算 = 每个 dep 的 (typeKey, prop, 全对象 id) | `ontology-core.ts` :341/:400-470 + `ontology-core.test.ts` 模式 |
| DEMO_SIM_WORLD_TICKS | 本树 = 3（desat3 改 96 未并） | `sim/seed-world.ts` :106 |

## 补充 ② · asSource 死胡同判据（已现算，51/51 全表）

工具 `/tmp/as-source-table.mjs`（进程内真播种，与 `seed-world.ts varsByType` 同算法 + `entersSimWorld`
同过滤），输出 `/tmp/as-source-table.json`。**三金丝雀全中：pairs=51 · cells=6363 · measuredCells=450**
（第一版漏 `entersSimWorld` 过滤报 8813 —— 工具修好后才对上账，8813 ≠ 6363 时按「量法坏了」处置，没报树坏）。

**口径**：asSource = 已发布规则里以该 (类型,变量) 为 **source** 的边数；asTarget = 以它为 **target** 的边数。
asSource=0 ⇒ 真值进世界后**走一步就停**，不影响任何下游读数。

**总账**：

| 池 | 对数 | 格数 |
|---|---:|---:|
| asSource>0（写了有下游） | 28 | 4,312 |
| 其中已真值（Order.qty/unitPrice/leadDays） | 3 | 450 |
| **可写池（asSource>0 且非真值）** | **25** | **3,862** |
| asSource=0（死胡同，先接边） | 23 | 2,051 |

对账：WO A 档 32 条 / 3,446 格 ≤ 可写池 3,862 格 ⇒ **主判据 3,896 在 asSource 判据下依然可达**
（3,896 = 450 + 3,446；A 档是 WO 按「原料齐+DSL 够」选的子集，asSource 是追加的第一判据，
A 档内若有 asSource=0 的条目须逐条标注「写了也看不见」）。

**asSource=0 死胡同全名单（23 对，按格数排序）**：
OrderLine.splitPressure(873) · ExceptionEvent.handlingBacklog(372) · QualityLot.inspectBacklog(260) ·
MaintenanceOrder.repairBacklog(193) · ARInvoice.overduePressure(60) · OrderPromise.promiseRisk(50) ·
ChangeoverMatrix.changeoverPressure(30) · CustomerLocation.deliveryHoldRisk(30) ·
IncomingInspection.queueDays(30) · MaterialBatch.turnoverPressure(24) · Certification.qualificationQueue(18) ·
FinishedGoodsInventory.drawdownPressure(18) · InterBaseTransfer.transferPressure(17) ·
Supplier.reviewPressure(15) · MaintPlan.windowSqueeze(13) · Shipment.inboundExpeditePressure(13) ·
MaterialBalance.gapPressure(9) · Model.backlogHorizonDays(6) · Model.backlogPriceTop(6) ·
Model.backlogQtyTop(6) · MaterialAlternative.switchPressure(5) · OverdueRecord.collectionPressure(2) ·
CustomsClearance.clearanceQueueDays(1)

**WO 已验证范本的两条都在活池**：Line.blockedPressure(asSrc=1) · Customer.receivablePressure(asSrc=4) ✓

⚠ **A⚠ 档 5 条里的 C 类嫌疑**（WO 已标语义存疑，②再补一刀）：
`ExceptionEvent.handlingBacklog` 与 `MaintenanceOrder.repairBacklog` 是 WO 的 D 档（零数值属性），
它们 asSource 也 = 0 —— 双重死路，本单不碰，与 WO 一致。

⚠ **先接边再写式子的边界**：23 条死胡同里，若 A 档 32 条含其中任何一条，接边动作
**大概率越出本单边界**（`05cca413f` 台账：11 条边需 ① 先落地）。处置 = 该条标注
「阻塞在 ①，式子照写、验收等 ①」，不硬凑格数。

## §2 候选式量纲实测（任务 #9 收尾 · 2026-09-16）

工具 `/tmp/candidate-truths.mjs` + `/tmp/recheck-candidates.mjs`（独立手算分布，臂1锚定原料）。
**三个致命量纲病提前抓住**（没写式子就先排掉）：

1. **`Line.blockedPressure` 的链方向 WO 写反了**。WO 草案 `SUM(in(line_runs_work_order))` 实测全 0；
   真实方向是 `Line --out(line_runs_work_order)--> WorkOrder`（260 实例，`from=Line`）。
   ⇒ 须用 `SUM(out(line_runs_work_order).qtyPlanned)`。
   且 WO 的 22.9285 = 3874×100/16896，分母是 `max_capacity_day`(16896) 不是 `capacityDaily`(176)。
   实测样张 slurry 线 out-sum=6126（≠WO 的 3874，因取的可能不是同一张单），6126×100/16896=36.2571。
   **WO 那条 22.9285 不可复算** ⇒ 台账照实记，以本树实测为准。
2. **`Model.forecastBias` 分母必须换**。WO 草案 `/SUM(in(order_for_model).qty)` 实测 97–338，
   越出 [-100,100] 域；换 `/this.totalDemand` 实测 **49.4–77.2**，在域内。
3. **`Model.costPressure = (1-unitCost/unitPrice)*100` 虚高 96–97**（毛利率接近 100%，seed 里
   unitCost≈unitPrice×0.97 是巧合）。换 `unitCost*100/unitPrice` 实测 **2.5–3.9**（成本占售价比，口径正）。

**终选 25 对活池定档**（扣 Order 3 真值 + Customer 已交付 20）：

| 档 | 条数 | 格数 | 成员 |
|---|---:|---:|---|
| A（原料齐+DSL够+量纲过） | 18 | 3,215 | Equipment.equipmentFailure/loadPressure(780×2) · Process.queuePressure(650) · WIPLot.feedPressure(260) · WorkOrder.releasePressure(260) · Line.blockedPressure/utilPressure(130×2) · DefectRecord.defectPressure(85) · PurchaseOrder.expeditePressure/procurementDelay(30×2) · Supplier.deliveryDelay/procurementDelay(15×2) · Base.loadIndex(13) · MaterialBalance.gapPressure(9) · Material.priceShock/shortageRisk(8×2) · Model.costPressure/forecastBias(6×2) |
| A⚠（写得出但语义存疑） | 6 | 630 | Order.costPressure/demandPressure/orderChurn/shortageRisk(150×4，全是对现有 ratio 字段的口径代理) · MaterialBatch.procurementDelay(24, ageDays 冒充且无链) · Model.demandLoad(6, orderCount/capacity 量纲勉强) |
| C（链未核实/原料待补） | 1 | 6 | Model.supplyRisk（`model_uses_material` 链存在性未验，先查再定） |

**主判据对账**：基线 470 + A 档 3,215 = **3,685 < 3,896，差 211 格**。
A+A⚠ = 3,845，470+3,845 = 4,315 ≥ 3,896 ✓。
⇒ **WO 的「A 档 32 条/3,446 格全做即达 3,896」在本树的实算口径下，纯 A 档只差 211 格**；
要过 3,896 必须至少补 211 格 A⚠（语义存疑档），或把 A⚠ 口径扶正。
**这是要顶回仓主的第二本账**（继红门之后）：WO 把 A 档算成 32 条/3,446，本树实算是 18 条/3,215，
差的 211 格 WO 算进了哪些对，需复核它的 32 条清单里有没有我判成 asSource=0 死胡同或 C 档的条目。

### A⚠ 档的诚实处置（不硬凑，红线 3）

Order 那 4 个（costPressure/demandPressure/orderChurn/shortageRisk）是 450 格真值订单的**同一张单**上的
语义代理量 —— 原料（creditUsedRatio/demandDelta/outsourceRatio）是真业务数，但「成本压力←授信占用率」
这类口径是**建模判断不是业务事实**。照 WO「A⚠ 需业务确认口径」与红线「不许硬凑」，
这 4 条 + MaterialBatch.procurementDelay + Model.demandLoad **单列出来给仓主裁决**，
不擅自写进 §2。若仓主认可口径，+630 格，主线 4,315 远超 3,896。

## 未了

- [x] ② asSource 全表（上文；任务 #15 闭）
- [x] 51 对分档 + 候选式量纲实测（上文 §2 段；任务 #9 闭）
- [x] §1 播种 recompute（4b2271f8c；烟囱 535 对象物化，valueRuns=535 指纹确认引擎②）
- [x] §3 valueRef（0934d8622；活样本 Customer.receivablePressure 450→470，红态正确抛错）
- [ ] **顶回仓主**：①红门台账（本树 6/6 绿）②A 档 3215+211 缺口 vs WO 3446 ③A⚠ 6 条口径裁决
- [ ] §2 A 档 18 条式子落 seed-derivation-specs.ts（验收等裁决；量纲已实测过）
- [ ] §2 每条登记的 valueRef 补进 STATE_VAR_VALUE_REFS
- [ ] 五道臂测试 + 接缝组合测试 + 变异反证（任务 #13）
- [ ] 真服务验收：主判据 + 反向臂 + 活服务金丝雀（任务 #14）
- [ ] slice-deriv-empty.seam.test.ts:214/216/220 三处金值 3→3+N（每条写理由，⛔不删断言）

---

## §2 落地（2026-09-16 · 任务 #11 闭 · 提交 4bb63fbc1 + 9ae540859）

**A 档 19 条规格落 `seed-derivation-specs.ts`，20 键 valueRef 登记 `battery.ts`。**
真服务烟囱（自证实例 47114/47115，端口回显 + readyz）：**measuredCells 470 → 3691（+3,221 格）**。

| 式子 | 实测值抽验 | 手算对照 | 判 |
|---|---|---|---|
| Equipment.equipmentFailure | 17 / 3 | 100−83=17, 100−97=3 | ✓ |
| Line.blockedPressure | 53.13 / 27.72 | 在实测 27–182 区间 | ✓ |
| Line.utilPressure | 92.5496 | = utilization 逐字节 | ✓ |
| Model.costPressure | 2.91 / 2.47 | 在 2.5–3.9 口径 | ✓ |
| Model.supplyRisk | −29.44 / −28.86 | 物料平均超储，域内 | ✓ |

### 落地时抓到的两个 DSL 能力面坑（WO 陷阱表之外的第 11、12 个）

1. **聚合内不许算术**：`SUM(in(L).prop + 100)` 抛 `expected ")" got "+"`（`parseAgg` 在 `.prop` 后
   直接期待 `)`）。⇒ Model.supplyRisk 原草案「SUM/(SUM+100) 归一」改成 `AVG(in(...).shortageRisk)`，
   均值同样是「综合缺料风险」合法口径，且 DSL 原生支持。
2. **链方向必须逐条实测，不能按 WO 草案抄**：5 条链方向全表（probe-dir2.mjs）——
   `order_for_model` Order→Model（从 Model 看 in）、`model_uses_material` **Model→Material（从 Model 看 out）**、
   `work_order_yields_wip_lot` WorkOrder→WIPLot（in）、`wip_lot_found_defect` WIPLot→DefectRecord（in）、
   `line_runs_work_order` Line→WorkOrder（out）。初版 supplyRisk 抄 in() ⇒ 全 undefined，改 out() 即物化。

### forecastBias 本树恒 0 = 真值，非式子错

手算三个 Model：`sumQty === totalDemand` **逐字节相等**（490412/558109/315606 三处全中）。
seed 的 `totalDemand` 就是从这些订单汇总出来的 ⇒ `(totalDemand − Σqty) = 0` 恒成立 ⇒ forecastBias 恒 0。
**WO 台账的「实测 49.4–77.2」在这棵树上不成立** —— 那是 desat3 改了订单生成的那棵树。
本树 forecastBias 口径正确（一旦 totalDemand≠Σqty 即算真偏差）、量纲在域内，但**本树恒 0 无信息量**。
如实保留 + 标注，不硬凑一个非零值（红线 3）。

### §3 校验作用域收窄（守门员接缝冲突，9ae540859）

§3 原校验对「`byType` 里每个注册键」强制要 ACTIVE 规格 ⇒ 守门员 `sim-order-real-fields`
（`seedBattery` + `seedDemoPropagationRules`，**不播种规格**）20 键全判「查无规格」红 6/6。
**收窄：规格库非空才强制** —— 你播种了规格（生产 SEED_DEMO=1）就得绑得上，断引用必红；
没播种规格（只验名字撞的单元接缝测试）这条路对你不存在，不强制。
**双向变异反证**：规格库非空 + 断引用 ⇒ 红 ✓（mutate-ref.mjs，MUTATION KILLED）；守门员回绿 6/6 ✓。

## 未了（更新）

- [x] §2 A 档 19 条式子落 seed-derivation-specs.ts（4bb63fbc1）
- [x] §2 每条登记的 valueRef 补进 STATE_VAR_VALUE_REFS（20 键，4bb63fbc1）
- [x] §3 校验作用域收窄（守门员回绿，9ae540859）
- [ ] **顶回仓主**：①红门台账（本树 6/6 绿）②A 档 3691 格 vs 主判据 3896 **差 205**（supplyRisk 多 6 格补到 205）
      ③A⚠ 6 条口径裁决（Order 4 代理 + MaterialBatch.procurementDelay + Model.demandLoad，+630 格）
      ④forecastBias 本树恒 0 的处置（保留死口径 or 换式）
- [ ] 五道臂测试 + 接缝组合测试 + 变异反证（任务 #13）
- [ ] 真服务验收：主判据 + 反向臂 + 活服务金丝雀（任务 #14）
- [ ] slice-deriv-empty.seam.test.ts:214/216/220 三处金值 3→3+N（每条写理由，⛔不删断言）
