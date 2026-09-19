# GOALMAP-SUP-A · 四级数字镜像补充需求取证

> 需求原文：构建**集团-基地-车间-产线四级数字镜像**，实时映射订单状态、产出偏差、库存水位等现场业务态势

---

## ✅ 取证基准：全部数据均在 PIN `fbfa88f1` 上取得（已双路复核）

### 派单那句话是错的，但我在测量前就发现并绕开了

派单写「canonical = `fbfa88f1`，你的 worktree 已在此 commit」。**这句话不成立。**

| 项 | 实测 |
|---|---|
| worktree 初始 HEAD | `778cc589`（2026-06-15） |
| `git merge-base --is-ancestor 778cc589 fbfa88f1` | **RC=0 ⇒ 严格祖先，即落后近 3 个月** |
| 树龄探针 `wc -l .../synthetic/battery.ts` | 旧树 **1249** 行 vs PIN **7053** 行（**5.6×**） |

`778cc589` 正是 CLAUDE.md 铁律 3 点名的那棵树（原文：「LOOP10 五个角色里有一个钉在 `778cc589`（06-15 的树，`battery.ts` **1249 行**）」），当时造成同一问题得到相差 **25 倍**的两个「都正确」的答案。
（协调方后来实测：**8 个取证 worktree 起点全是 `778cc589`**，属工具的系统性问题。）

### 处置与复核（两条独立读路，结果逐字节一致）

| 阶段 | 读路 | 结果 |
|---|---|---|
| 测量期（checkout 尚被禁止） | `git archive fbfa88f1 \| tar -x -C <scratchpad>/pin`，**全部测量在该副本上做** | 探针 `battery.ts` = **7053** 行 ✓ |
| 复核期（协调方准许 detach 后） | `git checkout --detach fbfa88f1` | HEAD = `fbfa88f1`、`battery.ts` = **7053** 行、`git status` 空 ✓ |
| **两路比对** | `diff -rq` 覆盖 `apps/datacore/src` + `packages/contracts/src` + `test/fixtures` | **零差异（byte-identical）**；diff 金丝雀证明该工具能检出差异 |

⇒ **本报告没有任何一个数来自过期树，无一条需降级「未测」。**

**复核清单（协调方要求的 1–3 步，全部已做）**
1. **7 条否定结论在 PIN 真 checkout 上逐条重跑，金丝雀全部命中**（见各行「金丝雀」列，数字即本次复跑值）。
2. **引用的 19 个文件在 PIN 上逐个 `-f` 验在**：**19/19 OK，零 MISSING**；关键符号按名复验在位（`batteryObjectTypes` / `WORKSHOP_REGISTRY` / `BATTERY_TS_AGG_SPECS` / `deriveFulfills` / `BASE_REGISTRY` 合计 30 命中），且四处被我逐字引用的表达式原样存在：`forecastStart: "2026-06-10"` · `nLinesPerBase = WORKSHOP_DEFS.length` · `dataMode: anyLive ? "LIVE" : "MOCK"` · `provenanceSynthetic ? "合成" : r.live ? "实测" : "估算"`。
3. 未 commit、未 push、未改任何产品源码、未起服务（detach 只换只读视角，不产生提交）。

---

## 📤 结论表

| 编号 | 能力项 | 判定 | 实测证据（file + 符号 + 亲手跑出来的数） | 金丝雀 |
|---|---|---|---|---|
| **3.8** | 四层各有承载 + 可下钻 | **部分**（下三层全有且可下钻；**集团层整条缺**） | **对象层承载（`apps/datacore/src/synthetic/battery.ts` `batteryObjectTypes()`）**：`Base`「生产基地」**13** 条 · `Workshop`「车间」**130** 条 · `Line`「产线」**130** 条（另 `Process` 650 / `Equipment` 780）。**集团层：零对象类型**。<br>**下钻靠父子字段（非下拉）**：`Line.workshopId`→`refToTypeKey:"Workshop"` · `Line.baseId` · `Workshop.baseId` · `Process.lineId` · `Equipment.processId/lineId/baseId`；另有声明边 `workshop_belongs_to_base`(Base→Workshop 1:N) · `line_belongs_to_workshop`(Workshop→Line 1:N) · `line_belongs_to_base` · `line_has_process`。<br>**边已物化**（真跑 fixture 计数）：`workshop_belongs_to_base` **130** · `line_belongs_to_workshop` **130** · `line_belongs_to_base` **130** · `line_has_process` **650** · `equip_used_in` **780**。<br>**生成式**：`WORKSHOP_REGISTRY`（`packages/contracts/src/base-registry.ts`）**10** 个车间型（制浆/涂布/辊压/分切/卷绕/装配/注液/化成/分容/PACK）；`nLinesPerBase = WORKSHOP_DEFS.length` ⇒ 13×10=130 车间、每车间 1 线 ⇒ 130 线。 | **集团层否定结论的金丝雀**：对 fixture 全部 **87** 个 typeKey 跑同一条正则 `group\|corp\|enterprise\|company\|hq\|holding` ⇒ **0 命中**；**同一条命令**跑 `workshop\|line\|base` ⇒ **7 命中**（`OrderLine/Line/Workshop/ProductLineCapability/InterBaseTransfer/Base/PipelineOpportunity`）⇒ 搜法是活的。<br>另：`plain("Workshop"` 命中 `battery.ts:3523` ⇒ 类型注册搜法有鉴别力。 |
| **3.9** | 订单状态映射到现场 | **部分**（基地/产线答得出；**状态机是坏的**） | **① 指向基地**：有，但是 **`Order.bases` `dataType:"json"`**（baseId 数组）——**未声明 `refToTypeKey`** ⇒ 不是本体可遍历的 ref，引用解析器不认。Order 上仅 2 个真 ref：`customerId`→Customer、`model`→Model。<br>**② 指向产线/工序**：`Order` 上**没有任何**产线/工序字段。真实路径是**绕一跳**：`fulfills`(WorkOrder→Order,N:1) **260 条**，`WorkOrder.lineId`→`refToTypeKey:"Line"` ✓、`WorkOrder.baseId`→`Base` ✓，再 `Line`→`Workshop`→`Base`。工序级经 `wip_on_line`(260)/`WIPLot.currentProcess`。**接线是真的**：`deriveFulfills` 在 `battery.ts:6921` 有**生产调用方**（非仅 test）。<br>**覆盖率**：260 工单 / **500** 订单，`fulfills` 为 N:1 ⇒ **至多 52% 的订单**能追到线；`WorkOrder.orderRef` 自述**条件缺席**（「只有 (modelId, baseId) 与订单簿真对得上的工单才写这一格」）。随手指一张订单，约**一半**答不出在哪条线。<br>**③ 状态机：有枚举、无合法状态机，且常态下压根不流转**。`ORDER_STATUSES`(`packages/contracts/src/order-status.ts`) = **3 值** `OPEN / IN_PRODUCTION / COMPLETED`。全仓**唯一**的流转驱动是 `apps/datacore/src/simclock.ts` 的 `tickOneDay`：<br>`if (o.props.status === "OPEN" && dueDay < tickIndex) { o.props.status = "FULFILLED"; }`<br>**四处坏**：(a) `"FULFILLED"` **不在枚举里**（第④态·跑得通但写了非法值）；(b) 条件是**交期 vs tick 日历**，与工单完工/现场进度**无关**；(c) **跳过 `IN_PRODUCTION`**，该值永不被写入；(d) **这段代码常态下不执行** —— `simclock.tick` 的**唯一**调用方是 HTTP 路由 `POST /a/v1/synthetic/clock/tick`（`app.ts:8076`，须人手点），demo 播种期自动推的是**另一个子系统** `sim/seed-world.ts:765` `sim.tick(..., DEMO_SIM_WORLD_TICKS=3)`（沙盘 world-line，落 `sim_session`/`sim_perturbation`、发 `sim.*` 事件），**它不写 `Order.props.status`**。⇒ 新起的 demo 里订单状态**永远停在播种比例**（`OPEN:IN_PRODUCTION:COMPLETED = 10:20:70`），「做到哪一步」这一问**答的是播种时掷的骰子，不是现场**。 | **「Order 无产线字段」的金丝雀**：同一提取器在 `orderProps` 上抽出 **18** 个 propKey（与手工 grep 逐字一致），在 `lineProps` 上抽出 **12** 个 ⇒ 提取器有鉴别力，不是恒空。<br>**`FULFILLED` 越界的金丝雀**：`grep FULFILLED packages/contracts/src/order-status.ts` ⇒ **0**；**同一文件**搜 `OPEN\|IN_PRODUCTION\|COMPLETED` ⇒ **30** 命中 ⇒ 文件与 grep 都正常。<br>**⚠ 我差点报错一次**：`fulfills` 在 `sim-disclosure.real.json`（85 边型）里**缺席**，照那一份会报「整条缺」；换 `sim-disclosure.adversary.real.json`（**97** 边型）实测 `fulfills=**260**`、同份金丝雀 `line_belongs_to_workshop=130` ⇒ 前一份只是**切片窄**，不是边不存在。 |
| **3.10** | 产出偏差映射 | **已有**（两个量都在；**但带两处已登记量纲错**） | **计划这一半**：`Line.capacityDaily`（套/日）· `Line.max_capacity_day`（件/日）· `WorkOrder.qtyPlanned`。<br>**实际这一半**：`Line.actual_output_daily`（件/日）· `WorkOrder.qtyActual`。<br>**偏差量**：`Line.schedule_attainment`。<br>**不是死字段——有物化链**：`BATTERY_TS_AGG_SPECS`（`battery.ts`）声明 `line_output_daily`(seriesKey `output:line`, grain day, agg **sum**) → 回写 `Line.actual_output_daily`；`schedule_attainment`(seriesKey `attainment:line`, grain **week**, agg avg) → 回写 `Line.schedule_attainment`。**注册点有生产调用方**：`synthetic/service.ts:443` `for (const spec of BATTERY_TS_AGG_SPECS) await this.ts.upsertSpec(...)`。<br>**有真读数**（仓内自记的真起后端实测，SEED_DEMO=1·130 条 Line）：中位 `actual/max_capacity_day` = **4.665**、中位 `actual/capacityDaily` = **447.8**、`utilization` 中位 **92.1%**、`schedule_attainment` 实测区间 **0.879~0.949**。<br>**⚠ 两处第④态（跑得通但算错）**：(a) **聚合口径错配**——`output:line` 的尺度锚 `outputLineScaleForBase(baseFormationCapDaily)` 是**基地级**电芯产能，而 `max_capacity_day` 是**单线**级，一基地 ~10 线 ⇒ 比值 4.665 而非 ~1；(b) **100× 显示错**——`schedule_attainment` 是**小数比率**（0.9109）却在 widget 声明 `unit:"%"`，`DashboardView.tsx` 自记此事。 | 对 `max_capacity_day`（确知在 `lines.push` 写入）跑**同一条** grep ⇒ 命中生成处与声明处；`actual_output_daily` 跑同一条 ⇒ 命中**声明 + 物化 spec + 前端消费**三类位置，且**生成 `lines.push` 处确实不写它**（与 `lever-meta.ts` 自述「`lines.push` 处根本不写这个字段」一致）⇒ 证实它**不是播种期赋值而是时序物化**，两种「没有」被区分开。 |
| **3.11** | 库存水位映射 | **部分**（水位有、**基地维只有成品有**、**安全线整条缺**） | **水位（quantity 类）有**：`FinishedGoodsInventory` **57** 条 —— `qtyOnHand` / `qtyReserved`（+派生 `qtyAvailable`）/ `asOf`；`Material` **8** 条 —— `onHand` / `inTransit` / `dailyUse` / `leadTime`。另 `InventoryTxn` **128** 条、`MaterialBatch` **24** 条、`Warehouse` **34** 条。<br>**基地维**：**成品有** —— `FinishedGoodsInventory.warehouseId`→`Warehouse`，`Warehouse.baseId`→`Base`（`warehouse_of_base` 实测 **34** 条边）。**物料没有** —— `Material` 定义（`battery-extended.ts` `def("Material","物料","supply",[...])`）**无 `baseId`、无 `warehouseId`**，8 条物料是**全局单份**。⇒ 问「某**物料**在某**基地**的水位」**答不出**；只有「某**型号成品**在某基地」答得出。<br>**安全线整条缺（无存储字段）**：全仓 **418** 个 distinct propKey 里，**零个** safety/reorder/水位阈值字段。唯一的安全线是**查询期现算、不落库**：`solvers/extended.ts` `inventoryOptimize` 的 `const safety = num(args.safetyDays, **5**)`、`target = m.dailyUse * (m.leadTime + safety)`，带 `INVENTORY_BAND` 超储 **1.5×** / 欠储 **0.8×**。<br>**⚠ 易误判点**：`connectors/registry.ts` 里确有 `safetyStock: 120/200/80/60` —— 那是**连接器 mock 数据集的 schema**（`MAT-NCM-811` 等），**不是对象类型属性**，本体里读不到。 | **「Material 无基地维」的金丝雀**：在 `Material` 定义的**同一行区间**内 grep `baseId\|warehouse` ⇒ **0**；**同一区间**grep `supplierId` ⇒ **5** ⇒ 区间与 grep 都正常，不是扫空了。<br>**「无安全线字段」的金丝雀**：同一条 propKey 全扫先报 **418** 个 distinct key（证明扫得到），再按 `safety\|threshold\|reorder\|level\|水位` 过滤 ⇒ 命中的全是无关项（`alarmLevel`/`bomLevel`/`skillLevel`/`maxSpeed`/`target_yield`…），**零个**库存阈值。<br>**「无 (物料×基地) 载体」的金丝雀**：grep `matId.*baseId` ⇒ 仅 1 处**文档注释**（`app.ts` 的 keyProp 列表），非载体；同法 grep `fgId` ⇒ **11** 命中 ⇒ 证明「(型号×仓)载体」搜得到，故前者的 0 是真 0。 |
| **3.12** | 「实时」兑不兑现 | **部分**（**几点的**：写死 3 个月前；**多久刷**：业务视图不刷；**真假**：合成，但屏上**诚实标「合成」不冒充 LIVE**） | **① 屏上的数是几点的**：世界的「今天」是**写死常量** `forecastStart: "2026-06-10"`（`battery.ts:854`，`BATTERY_SOLVER_PARAMS`）。取证当日真实日期 **2026-09-11** ⇒ **差 93 天**。历史窗 `HISTORY_DAYS = 90`。回包里的 `snapshotVersion` 是**哈希** `5e1f365be4aa`，**不是时间戳**。<br>**② 多久刷一次**：业务视图**零自动刷新**。全前端非 test 的 `refetchInterval` 共 **10** 处，**9 处在 admin 作业轮询**（`DataBuilderPage`/`ModelingPage`/`SyntheticPage`/`SimClockConsole`，且条件为 `status==="RUNNING"/"TICKING"` 才 600–800ms，否则 `false`），仅 `HealthBadge` 与 `ConnectionsPage` 是常驻 **60s**（`HEALTH_POLL_MS = 60_000`）。推演沙盘 console 大量 `staleTime: **Infinity**`。<br>**世界时钟只能手推**：唯一入口 `POST /a/v1/synthetic/clock/tick`（`app.ts` → `simclock.tick(ctx, "1d"\|"7d")`）。**9 种** `ScheduledJobKind`（CONNECTOR_SYNC/DERIVATION_FULL/RULE_SCAN/WORKFLOW_RUN/TS_AGGREGATE/CALIBRATION_RUN/SCHEDULED_FORECAST/SOP_AUTO_OPEN/APPROVAL_REMINDER）**无一**推进世界时钟。<br>**③ 真数据还是合成**：**100% 合成**（`generateBattery`）。<br>**`dataMode` 赋值点（照要求抄条件）**：`solvers/capacity.ts:560` 与 `:721` —— `dataMode: anyLive ? "LIVE" : "MOCK"`；`anyLive` 由 `:506` `anyLive = anyLive \|\| lt.live` 累积；`lt` 来自 `solvers/risk.ts:156` `liveTightness()`，其 `live:true` 的**全部条件**是：<br>`const eq = c.equipment.filter(e => e.props.baseId === baseId && typeof e.props.oee_current === "number"); if (eq.length > 0) return { ..., live: true }`<br>⇒ **判据只是「该基地有设备且 `oee_current` 是个数字」**，与数据是否来自真实测**完全无关**。合成种子给 **780** 台设备**全部**写了 `oee_current`（`equipment.push({ oee_current: meanOfDaily(oeeDaily,"oee") })`）⇒ **合成数据恒判 `dataMode:"LIVE"`**。<br>**但屏上不冒充**：`ProjectSimView.tsx:899` 的三元 —— `{r.provenanceSynthetic ? "合成" : r.live ? "实测" : "估算"}`，**`provenanceSynthetic` 优先级最高** ⇒ demo 世界屏上显示 **「合成」**（灰），不是「实测」。该字段在 `RiskBoardView` / `ProjectSimView` / `ProvenanceDag` 三处真消费（徽章文案「合成·未接实测」）。⇒ **`G-DATAMODE-PROV` 在这条路径上已闭**：后端 `dataMode` 仍说 LIVE（measurement 维，有意保留），诚实位由**正交的** `provenanceSynthetic` 承担。<br>**④ 零 agent**：真跑 fixture `agent = {invoked: **false**, calls: **0**, provider: null, model: null}`；`timings` 合计 **533ms**（graph 157 / shadow 235 / engine 90 / persist 15）。 | **「业务视图零 refetchInterval」的金丝雀**：同目录同工具先数 `staleTime` ⇒ **55** 命中（证明扫得到该目录），再数 `refetchInterval` ⇒ 10 命中并**逐条列出**，肉眼可核 9 条在 `pages/admin/`。<br>**`dataMode` 不是靠注释下的结论**：从赋值点 `capacity.ts:560` **沿调用链追了两层**到 `risk.ts:156` 的 `live` 判据原文，并回到生成侧确认 `oee_current` 对 780 台全赋值 ⇒ 三点闭合，非 grep 单点。<br>**规模金丝雀**：fixture 自报 objects **12,745** / links **12,192**，与 87 类型逐条 count 求和**一致**。 |

---

## 🔢 两个可交叉验证的口径（两条独立方法互证）

四层实例数我用**两条互不依赖**的方法各算一遍，结果逐个相同：

| 层 | 方法A：读生成式静态推算 | 方法B：真起后端的 fixture 计数 |
|---|---|---|
| Base | `BASE_REGISTRY` 条目 = **13** | **13** |
| Workshop | 13 × `WORKSHOP_REGISTRY`(10) = **130** | **130** |
| Line | 每车间 1 线 = **130** | **130** |
| Process | 130 × (3 `SERIAL_STEPS` + formation + aging) = 130×5 = **650** | **650** |
| Equipment | 650 × 2 = **1300**？→ 实为 130×(3×2)= **780**（仅串行工序挂设备，formation/aging 不挂） | **780** |

> Equipment 一栏是我**第一次算错、被 fixture 纠正**的：`for (let e=1;e<=2;e++)` 只在 `SERIAL_STEPS` 循环体内，formation/aging 两个 `processes.push` 不带设备 ⇒ 130×3×2=780。两法对齐后才敢用。

## ⚠ 一个未被消费的口径冲突（顺带量到，不属 5 条之一）

`BASE_REGISTRY` 每条自带 `lines:` 字段（23/17/20/15/15/17/15/12/12/9/12/12/9，**Σ=188**），
而实际建模出的 `Line` 实例是 **130**（由 `nLinesPerBase = WORKSHOP_DEFS.length = 10` 决定）。
**188 ≠ 130**，两个数都在仓里、都被不同消费方读。本单只报事实，不提修法。

---

## 《需起服务复核》

以下结论依赖「真起 datacore（`SEED_DEMO=1`）+ 真前端」才能钉死，本单**未起服务**（派单硬约束），故标此：

1. **3.9 的订单可追率**——我给的「至多 52%」是由 `fulfills=260` / `Order=500` 与 N:1 基数推出的**上界**，不是实测的 distinct 订单数。真值需 `GET /a/v1/objects?type=Order` 后按 `fulfills` 反查 distinct `so` 计数。若哈希碰撞多，真实覆盖率**低于** 52%。
2. **3.12 的「屏上到底显示什么」**——我读到的是 `ProjectSimView.tsx:899` 的三元表达式与 `provenanceSynthetic` 的三处消费点，属**代码级**证据。`provenanceSynthetic` 是否在**每一条**基地行上都为 `true`（而非某些路径漏传导致个别行显示「实测」）需真跑后端 + 真浏览器逐行核。本体 §8 亦自记曾有「`bottleneck_matrix` 矩阵级 dataMode LIVE 而 provenance 维未加」的残口。
3. **3.10 的两处量纲错是否已影响屏上读数**——`schedule_attainment` 的 100× 显示错由 `DashboardView.tsx` 自述，我**没有**亲眼见到屏。需真起后端后 `GET /a/v1/objects?type=Line` 看 `schedule_attainment` 真实取值区间（0~1 还是 0~100），再对屏核。
4. **3.12 的 `dataMode` 实际回包值**——赋值条件我抄了原文，但 `anyLive` 在**真实一次调用**里是否恒 true，需真打 `capacity` 类求解器接口看回包。
5. **3.9 的「订单状态在新 demo 里到底动不动」**——我从调用链推出「常态不流转、停在播种比例 10:20:70」（`simclock.tick` 唯一调用方是人手 HTTP 路由，demo 自动推的是另一个子系统且不写 `Order.props.status`）。这是**代码级推断**，需真起 `SEED_DEMO=1` 后 `GET /a/v1/objects?type=Order` 按 status 分组计数，确认三态比例并放置一段时间复查是否变化。
6. **3.8 中 `has_capacity` / `wo_on_line` / `base_located_in` 三条声明边是否真物化**——它们在我用的两份 fixture 里未出现计数。因未换第三份复核，我**没有**据此下任何判定；真值需 `GET /a/v1/links?type=<key>` 直接数。

## 《我可能错在哪》（3 条）

1. **我全程把 `sim-disclosure` fixture 当作「实例数」的权威，而它是某一次推演披露的切片，不是 `GET /a/v1/objects?type=X` 的直接计数。** 若某类型在该切片里被过滤/截断，我就会把「切片里没有」读成「库里没有」。
   **这个坑我已经真踩中过一次**：`fulfills` 在窄 fixture（85 边型）里缺席，我差点报「整条缺」，换宽 fixture（97 边型）才见 **260**。这次靠换第二份兜住了，但**不能保证其余 86 个类型没有同样的切片效应** —— 尤其是我报「缺席」的 `has_capacity` / `wo_on_line` / `base_located_in` 三条边，我**没有**换第二份去复核，故它们只写在证据里、**没有**被我写成任何一行的判定依据。
   缓解：四层实例数（13/130/130/650/780）另有一条独立方法（读生成式静态推算）逐个吻合，两法同错概率低。

2. **「集团层整条缺」我只证到了「对象层没有 Group 类型」。** 金丝雀是硬的（87 类型零 group-ish，对照 7 命中），但集团视角**可能以非对象形态存在** —— 例如 `NETWORK_SCOPE_KEY = "__network__"`（label「全网」，`packages/contracts/src/capacity-factors.ts`）就是一个**作用域常量**，前端可能据此渲染「全网/集团」汇总层。我实测它在 `apps/datacore/src` 里**零命中**，故判定它不是对象承载；但若前端另有纯 UI 的集团汇总页，这条会从「整条缺」变成**「有视图无本体」** —— 对客户的答复完全不同。

3. **我对「实时」三问给的是代码级证据，一屏都没亲眼见过**（派单禁止起服务）。
   `forecastStart: "2026-06-10"` 是常量、业务视图 `refetchInterval` 计数为 0、屏上三元优先显示「合成」—— 这三条都从源码读出，**但没有一条经过真浏览器验证**。其中风险最高的是第三条：`provenanceSynthetic` 是否在**每一条**基地行上都为 `true`，我只能读到赋值点读不到实际取值；本体 §8 自记曾有「`bottleneck_matrix` 矩阵级 dataMode LIVE 而 provenance 维未加」的同类残口，说明这条链**历史上真的漏过**。

> **两条已在复核期关闭、不再列为风险**：① fixture 新鲜度（实测 `d79ae0f5`→PIN 共 270 提交，仅 2 个触及生成侧且均为注释/描述串，不改计数）；② 「状态机是否真被走到」（实测两种坏法同时成立，已并入 3.9 行 (d)）。
