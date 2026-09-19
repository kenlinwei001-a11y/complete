# GOALMAP-3 · 客户 COO 项目目标 3「经营决策支撑」取证

**取证时刻** 2026-09-11 · **base commit** `fbfa88f1`（= canonical tip `origin/claude/inspiring-gates-aqczjg`）
**树龄探针** `wc -l apps/datacore/src/synthetic/battery.ts` = **7053**
**取证方式** 全程只读；未起任何服务。数字由 `pnpm --filter datacore build` 后 **直接 import `dist/synthetic/*.js` 跑纯函数**得到（`generateBattery(42,"S")` / `generateExtended(42,…,"S")` / `batteryObjectTypes()+extendedObjectTypes()`）。

---

## ⚠️ 开工第一件事：派单的 PIN 与 worktree 实际不符（已纠正，但必须记账）

| | 值 |
|---|---|
| 派单写的 PIN | `fbfa88f1` |
| **我的 worktree 实际 HEAD** | **`778cc589`（2026-06-15）** |
| `git merge-base --is-ancestor HEAD $CANON` | **YES ⇒ 落后** |
| 树龄探针 `battery.ts` | **1249 行**（PIN 上是 **7053 行**，差 **5.6×**） |

派单原文「你的 worktree 已在此 commit」**是错的**。`778cc589` 正是 CLAUDE.md 铁律 3 里记载的 **LOOP10 那棵把「20 单」与「500 单」读出 25× 差异的旧树**。
我按铁律 3 的判据（祖先关系，非文件存在性）判定落后，`git checkout --detach fbfa88f1` 后重测。
**本报告全部数字取自 `fbfa88f1`。** 若不纠正，下面每一个数都会错。

> 形态（0.6 句式）：「我用『派单里写了 PIN』当作『worktree 真在那个 commit 上』的证据，而前者并不度量后者。」

---

## ⚠️ 派单给的三个「已知线索」全部与实测不符

派单原文要求我亲手复核，复核结果是**三个数全错**：

| 维度 | 派单线索 | **我实测** | 出处 |
|---|---|---|---|
| `Base` | 39 | **13** | `battery.ts` `generateBattery(42,"S").bases.length` |
| `Model` | 50 | **6** | 同上 `.models.length` |
| `Customer` | 15 | **20** | `battery-extended.ts` `generateExtended(…).customers.length` |
| `BusinessUnit`/`Division` | 疑为 0 条 | **0 条，且类型压根不在册** | 见 3.4(a) |

只有第 4 条方向对。`Base=13`/`Model=6` 与 scale 无关（`S`/`M`/`L` 三档实测同值，订单数才随 scale 变：500/500/825）。

---

## 📊 判定表

| 编号 | 能力项 | 判定 | 实测证据（file + 符号 + 我亲手跑出来的数） | 金丝雀 |
|---|---|---|---|---|
| **3.1** | 全链路指标集中展示 | **部分** | **链路骨架齐、指标只覆盖前三段。** `packages/contracts/src/chain-sim.ts` `CHAIN_NODE_REGISTRY` = **24 节点 / 5 段**（DEMAND 3 · ORDER 3 · CAPACITY 7 · MATERIAL 8 · DELIVERY 3），`order.cash`「订单回款」**在册**。但 `synthetic/cadence.ts` `deriveChainCadences(g)` 实跑只产 **8 行**，其中 **只有 4 行有 `everyDays` 真值**（`demand.consensus`=14 / `capacity.schedule`=1 / `capacity.qc_batch`=1 / `capacity.maint`=77），**20/24 节点无节拍**；整段缺失的是 **DELIVERY 3/3**、**MATERIAL 8/8**、**ORDER 3/3（含 `order.cash` 连一行都没有）**。屏侧：`synthetic/service.ts` 的 dash `widgets` = **12 个 KPI + 1 个 DAG**，逐条点名后**交付段 0 个、回款段 0 个**（有 `gwh`/`util`/`util-peak`/`attain`/`supply-v7`/`demand-p50`/`orders`/`gross-margin`/`material-gap`/`rev-attain`/`aop-base`/`cash-cushion`；`cash-cushion` 按其 `Metric.basis` 自述是「baseline 年度情景现金安全垫·**非银行流水实测余额**」，不是回款）。**缺的是「交付」与「回款」两段**。 | 同一 widget 块内 grep `毛利` **命中 14**（证明我的扫法有鉴别力），而 `DSO\|应收\|回款\|准时\|OTD` 在 widget **title** 上 0 命中（仅注释里出现） |
| **3.2** | 需求-供给动态平衡 | **部分** | **数是真算的，但推不动。** `solvers/service.ts` `supplyDemandGapAttribution`：`G = Σ max(0, demand−supply)` 读 `SopVersionRow`。我复算 4 行 S&OP → **G = 81.0 万套**（V1 36 + V3 26 + V5 15 + V7 4）。**它确实随数据变**（非写死）。但同一函数头注明写「本求解器消费的入参集 = **∅**」，并用 `ignoredSolverArgs(args, …)` 把调用方传的每一个键都回成 `ignoredArgs` ⇒ **改任何入参/杠杆，这个数逐字节不动**；只有改种子对象才会变。⚠ 另有口径疑点：G **把同一年度计划的 4 个连续版本的缺口累加**，而终版 V7 的缺口只有 **4 万套** —— 「当前供需缺口」若读 81，是把已被后续版本修正掉的缺口重复计了。 | 同文件 `capBase` 处注释称「demo `Line.capacityDaily` 未落」→ **实测已过期**：130/130 条线全有值，Σ=12160 套/日 ⇒ 年化 364.8 万套，`capGap = 383 − 364.8 = 18.2` 真的在算（注释不算数，实测为准） |
| **3.3** | 辅助策略制定 | **部分** | **有动作，缺「什么时候」。** `datacore/src/actions.ts` `ACTION_WIRING` = **12 个型，全部 `WIRED`**；`app.ts` `domainExecutor` 逐型有真写入分支（`sop.applyChangeAction` 真改 S&OP inputs、`applyLeverWrites` 真写本体属性 + `runDerivations`），兜底是 `UnwiredActionExecutor`（显式失败），且 `actions.ts` 明令 **`new MockActionExecutor()` 在 `app.ts`/`actions.ts` 必须出现 0 次**。⇒ **产出的是动作不只是指标**。但 `packages/contracts/src/actions.ts` `ActionDraftSchema` 字段实测 = `{id, tenantId, actionTypeKey, actionTypeVersion?, payload, origin{taskId?,agentId?,userId}, status, approvalSteps, executionResult?, createdAt, updatedAt}` —— **做什么 ✓**（`actionTypeKey`）、**谁审 ✓**（`ApprovalStep.approverId`），**「谁执行」与「什么时候完成」两格不存在**：全文件唯一的 `dueDate`（:383）属于 `ForecastAdoptionBatchSchema`，是**交付批次的交货日**，不是动作的截止日。 | `grep -n "assignee\|owner\|dueDate\|deadline"` 在该文件命中 `approverId`(:22) 与 `dueDate`(:383) 两处 —— 扫法有效，故「无 assignee / 无动作级 deadline」是实测否定结论而非工具失灵 |
| **3.4 (a)** | **事业部维度** | **整条缺** | 对象类型总数 **97**（`batteryObjectTypes()` 61 + `extendedObjectTypes()` 36）。`BusinessUnit`/`Division`/`BU`/`ProductLine`/`Company` **一个都不在册**；按 `key+displayName+description` 做中文模糊扫（`事业部|分部|板块|业务单元`）**命中 0 个类型**。`Base`/`Model`/`Order` 三个承载对象的属性全表里也**没有任何事业部外键**。全仓 `事业部` 二字只出现 **2 处**，且都不是代码：`contracts/src/object-ref-resolve.ts` 的一句注释、`docs/LOOP4-ceo-decisions.md` 的一条议题。**最接近的替身是 `Order.businessType`（3 值：passenger/commercial/storage）与 `Base.kind`（动力/储能/动力+储能），但这是产品应用细分与工厂类型，不是组织维度。** | 同一份 97 类型清单里 `Base`/`Model`/`Customer`/`Order` **四个已知类型全部命中**；中文金丝雀 `基地` 在 `apps/*/src` 命中 **1270 行**（`事业部` 命中 2）⇒ 中文扫法有效 |
| **3.4 (b)** | **基地维度** | **部分**（有维度，无利润） | `Base` **13 条**（`changzhou/xiamen/chengdu/meishan/wuhan/jiangmen/hefei/xinyang/zaozhuang/handan/zigong/jinhua/yangzhou`）。**能按它聚合的是量不是钱**：`Base.derivedProperties` 实测 = `orderCount(=COUNT(Order.so BY bases))`、`committedQty(=SUM(Order.qty BY bases))`、`oeeIndex(=AVG(Equipment.oee_current BY baseId))` —— 三条全是数量/效率。`Base` 上的金额字段只有 `openCost`/`serveCost`（万元，选址用），**无任何收入字段** ⇒ 利润无法按基地拆。财务侧 `FinanceAccount` 确实是 **13 条·按 baseId**，但字段是 `cashOnHand/receivable/payable/workingCapital`（资金占用），**不是损益**。 | 我对 97 个类型做「同时具备收入类 ∩ 成本类属性」的扫描，**只命中 2 个**（见下 (c)）；该扫描在 `Model` 上正确命中 ⇒ 扫法有效，故「`Base` 无收入字段」是实测结论 |
| **3.4 (c)** | **型号维度** | **部分**（唯一算得出利润的维度） | `Model` **6 条**（`4680-NCM / 4680-LFP / 2170-NCM / 方形-LFP / 方形-NCM / 圆柱-LFP`）。**全仓 97 个类型里，只有 `Model` 与 `OrderLine` 同时具备收入类与成本类属性**（均为 `unitPrice` + `unitCost`）⇒ 单位毛利算得出。`Model.derivedProperties` = `totalDemand(=SUM(Order.qty BY model))`、`orderCount(=COUNT(Order.so BY model))` ⇒ 量能按型号聚合。**但没有一条派生把两者相乘**：`Σ qty×(unitPrice−unitCost) BY model` 全仓无人算。且 `unitPrice`/`unitCost` 的**分母不同**（见 3.5），相减本身今天被系统判为不可信。 | `OrderLine` **873 行**全部可算比值，`unitPrice/unitCost` ∈ **25.7×–40.6×**，互异值 **6 个** —— 与 `opt-assemble.ts` 注释自述的「25.7×–40.6×」**逐字吻合**，证明我读的是同一条链 |
| **3.4 (d)** | **客户维度** | **部分**（有维度，无利润） | `Customer` **20 条**（`cust_0…cust_19`），且 500 张订单上的 `customerId` **去重恰好 20** ⇒ 维度真的连着订单。**但 `Customer` 属性实测 = `[custId, custName, orderCustNames, creditLimit, termDays, receivables, wipUnbilled, maxOverdueDays]`，`derivedProperties` = 空数组** ⇒ **无收入、无成本、零派生**。能按客户拆的只有**应收敞口与账期**，**不是利润**。订单侧可算 `Σ value BY customerId`（`Order.value` 是派生 `qty*unitPrice`），但成本侧要跨到 `Model.unitCost` 才有，**今天没有这条聚合**。 | `Customer` 的 `receivables`/`creditLimit` 单位实测 `万元`，而 `Order.unitPrice` 是 `元` —— 两者量纲不同，进一步说明没有现成的客户级损益 |
| **3.4 总** | 四维利润与成本透视 | **整条缺（作为"四维透视"）** | **今天没有任何一个求解器按这四维出损益。** `finance_pnl`（`solvers/service.ts` `financePnl`）读 `FinancePlan`（**实测 3 条**）只回 **3 行**：`收入/销售成本/毛利`，**零维度**（无 groupBy 参数、无维度字段），外加一句结构归因串。唯一的通用维度器 `margin_attribution` 吃 `{targetType, revenueField, costFields}` **理论上任意维**，但：① 它**只回倒挂行**（`if (marginRate >= marginThreshold) continue`），是异常发现器不是利润立方体；② 全仓**零生产调用方**（`catalog.ts` 登记 + `sim-planner.ts:66` 明写「填不满 targetType ⇒ 诚实落选」）；③ `databuilder/comprehend.ts` 给它的绑定是 `Order.revenue` / `Order.rawCost`，而 **`Order` 这两个字段都不存在**（实测 `Order.revenue=false`、`Order.rawCost=false`）。我按它的真实过滤逻辑对 500 张单复跑：**inverted = 0 / 500** ⇒ 照台账绑定调用，**它恒返回空**。 | 同一探针里 `Order.qty=true`、`Order.value(派生)=true` ⇒ 字段存在性判定有鉴别力，故 `revenue`/`rawCost` 的 false 是实测缺失 |
| **3.5** | 推演利润最优方案 | **部分（利润轴今天被系统自己下架）** | **候选有、排序键有，唯独没有利润。** 两套寻优：① `solvers/portfolio.ts` `PortfolioObjectiveKey` 实测 = **5 个**：`max_ontime \| min_delay \| min_changeover \| min_cost \| min_fg_inventory` —— **无 profit/margin 目标**（`min_cost` 只压成本，不看收入结构）。② Pareto 装配 `solvers/opt-assemble.ts`：轴集本应 **毛利打头**（`objectives` 前两根被前端 `useParetoFrontier.ts projectPareto` 取作散点 X/Y），但毛利轴受**第 4 张准入证 `denomCoherent`** 把关 —— 我实测该证**不成立**：`OrderLine.unitPrice` 与 `unitCost` 声明单位**都是裸 `元`**，两格都没声明「每什么」，而真实分母是 **套 vs 电芯**（实测比值 25.7×–40.6×，**6 个互不相同的比值** ⇒ 按注释自己的判据「比值逐行不同 ⇒ **方案之间的名次也会被扭曲**」）。故毛利轴今天进 `unavailableObjectives`，带原因串上屏。**⇒ 屏上的候选方案按获排率/营收/成本/违约排序，不按利润。** 这是铁律 0.5 **第四态（接对了、跑通了、但算错了）被当场抓住并主动下架**，不是假绿。 | 我算出的 **25.7×–40.6× / 6 个互异值**与源码注释自述**完全一致**；且 `DENOMINATED_CURRENCY_UNITS` 这条恢复路实测是通的（`domain.ts PROPERTY_UNITS` 已含 `元/kWh`），说明我读的是活代码不是死分支 |
| **3.6** | 输出优化建议 | **部分（句子写死，数字真算，且有证据闸）** | **「做什么」是写死的 3 条，「值多少」是真算的。** `solvers/service.ts` `decisionPlay` 的 `allOptions` 是**字面量数组，3 条固定 label**：`缩短备份供应商认证周期` / `长协加价格联动条款`（三元表达式二选一）/ `上游自采矿+战略储备`。源码自己承认：「上面这三条的**身份恒定** —— `cash`（根因 应收账龄恶化）与 `market_share`（根因 大客户丢标）拿到的也是这三条…**方案与根因语义无关**，这比"数值写死"更坏」。**已加的补救是证据闸而非生成**：每条方案的 `provenance.drillType/drillId` 必须在本次归因树落点集里核得到（`OBJECT` 强 / `TYPE` 弱 / 都够不着 ⇒ 进 `optionsOmitted` **诚实不下发**）⇒ 现金域与份额域**一条都不发**。数值侧确为真算：`closesGap = min(addressable, addressable × eff × (0.6+0.4×shortfallFrac))`，`effBackup = max(0.2, 1−certWeeks/26)` 读 `BackupSupplierPool.certWeeks` 真值。另接了真枚举器 `impediment-options.ts enumerateImpedimentOptions`（864 行），但它产的是**阈值型数值候选**（`CandidateRungKind = THRESHOLD…`），**不产策略句**。**⇒ 判定：模板句 + 变量插值，不是生成。** | 3 条 label 在源码里是字面量字符串（非拼接、非查表、非 LLM），且 `solvers/llm-gen.ts` 仅 68 行、导出 `generateSolverDraft`（**造求解器草稿**用），与 `decision_play` 无调用关系 ⇒ 建议路径零 LLM |
| **3.7** | 经营结果可预判 | **部分（口径已修正且已标注，但"预判"仍是查表）** | **⚠ 派单给的「700 亿标成实际·已知谎言」这条线索在 `fbfa88f1` 上已过期。** 实测 `Metric.kpi-revenue` = `{name:"营收", actual:**415.6**, target:**700**, unit:"亿", floorVal:686}`。我独立复算：计划年（`planYearOf()`=**2026**）窗内 **458 张单 Σ qty×unitPrice = 415.58 亿**，与 `actual` 吻合。**对照实验（铁律 1.5 判据一）**：把订单簿从 500 砍到 250，同口径 Σ 从 **415.58 → 220.67 亿** ⇒ **这个数真的随订单簿动**，不再是那个恒等式。四个数今天各就各位且**标签都对**：**454.64 亿** = 全簿 500 单 Σ（我复算 `Σ qty×unitPrice = 45,464,327,004`，与 CLAUDE.md 记载**逐位相同**）· **415.6 亿** = 计划年窗成交侧，挂 `kpi-revenue.actual` · **700 亿** = 需求 P50（我复算 `Σ demandP50×priceWan` = **700.00** 整），今天只当 `target`，另在 `demand-p50` widget · **601.50 亿** = `cockpit_kpi.aopBaseRev`（读 `AnnualScenario(baseline).revenue`），widget 标题「AOP 基准营收 (亿)」+ caption「年度计划口径 · baseline 情景全年营收目标（**≠ 订单簿已签金额加总**）」—— **明确标注，不冒充实际**。且每条 `Metric` 都带 `basis` 口径串（如毛利那条明写「与同屏营收的成交侧口径不同源，**两者不可相除**」）。**但「今天做这个决定 → 未来某期结果是多少」这一问，今天答不出**：`AnnualScenario` 只有 conservative/baseline/aggressive **三个预置情景**，`FinanceMetric` 对应 **3 行**（`netMargin` 12.5/14/13.2、`irr` 9.5/14.2/18.6、`cashCushion` 72/58/42），**是查表不是推演**；能把决策变量映射到未来期损益的那条路（毛利轴）正是 3.5 里被下架的那根。 | `kpi-share` 的 `basis` 自述「无外部市场规模真数据源，本值是**确定性合成常数（非实测、非派生）**」—— 系统会主动给自己的数标「这不是实测」，说明 `basis` 这一层是真话不是装饰；`kpi-revenue.actual` 与我独立复算的 415.58 吻合 ⇒ 我读的是生产口径 |

---

## 需起服务复核

1. **屏上真的显示这些数吗（3.1 / 3.7）** —— 我量的是**生成器与求解器的输出**，没量**渲染结果**。
   要跑：`SEED_DEMO=1` 起 datacore(4001) + agentcore(4002) + 真前端，登录 `demo/admin/demo1234`，打开 `v/dash`。
   期望看到：**12 个 KPI 卡**；「营收」卡读 **415.6**（不是 700）、「AOP 基准营收」卡读 **601.5** 且 caption 含「≠ 订单簿已签金额加总」；**找不到任何 DSO / 应收 / 回款 / 准时率卡**。
   若「营收」卡读 700 ⇒ 我对 3.7 的判定错，前端另有取数路。

2. **毛利轴是否真的以"报缺"形态上屏（3.5）** —— 我是从 `denomCoherent` 的判据**静态推断**它今天为 false，没看到实际回包。
   要跑：调 Pareto 寻优（`v/optimize-whatif` 或 `sim-unified`），查回包 `unavailableObjectives`。
   期望看到：含 `key:"margin"` 一条，reason 串里带「**25.7×–40.6×**」与「**6 个互不相同的比值**」（这两个数我已离线算出，可直接对）。若毛利仍出现在 `objectives` 里 ⇒ 我判反了。

3. **`AnnualScenario` 实例数与 601.50 的出处（3.7）** —— `generateBattery` 产 **0 条** `AnnualScenario`，它由 `synthetic/service.ts:1323 putAll("AnnualScenario", pd.scenarios, "scnId")` 另路种入，我没跑到那条路。
   要跑：`GET /a/v1/.../objects?type=AnnualScenario`。期望 **3 条**（conservative/baseline/aggressive），`baseline.revenue` = **601.5**。

4. **`decision_play` 在现金域是否真的一条方案都不发（3.6）** —— 这是源码注释的自述 + 我读的过滤逻辑，未实跑。
   要跑：`invoke_solver decision_play {metricKey:"cash"}`。期望 `options` **为空**、`optionsOmitted` **3 条**且 reason 含「与本根因无可核对的依据关系」。若照发三条正极方案 ⇒ 证据闸没生效。

---

## 我可能错在哪

1. **我只量了 `(industry=battery, scale=S, seed=42)` 这一组种子。**
   `Base=13 / Model=6 / Customer=20` 是这一组的值。我验过 S/M/L 三档该三数同值、且 `extraCustomers` 仅在 `XL` 下 +54（⇒ XL 是 74 客户），但**没跑 XL**，也没跑非 battery 模板。若客户实际用别的 (industry, scale)，条数会变 —— **不过 3.4(a) 的「事业部类型不在册」与 scale 无关**（类型注册表是静态的），那条结论不受影响。

2. **3.4 里「利润不能按 X 聚合」，我的判据是「类型上有没有收入+成本字段对 / 有没有对应 derivedProperty」，这不等于「跨对象 join 也算不出」。**
   譬如客户级毛利理论上可由 `Order →(model)→ Model.unitCost` join 出来。我确认的是**今天没有任何求解器或派生在做这个 join**（`finance_pnl` 零维度、`margin_attribution` 零生产调用方且绑定字段不存在），但我**没有穷举全部 42 个求解器的内部实现** —— 只精读了 `finance_pnl` / `margin_attribution` / `portfolio` / `opt-assemble` / `decision_play` / `supply_demand_gap_attribution` / `cockpit_kpi` 七个。若某个我没读的求解器里藏着按客户/基地的损益聚合，3.4(b)(d) 该从「部分」上调。

3. **3.1 的「交付段/回款段没有指标」是就"驾驶舱 widget + 链路节拍"两处说的，不是说全系统没有这类数。**
   实测对象层是有料的：`ARInvoice` **60 条**、`Shipment` **13 条**、`OrderPromise` **50 条**、`ARAging`/`DSO`/`OverdueRecord` 各 **2 条**、`InterBaseTransfer` **17 条**。所以更准的说法是「**数据在，指标与屏位不在**」（铁律 0.5 的第二态「接了线没数据」的**镜像**：这里是「有数据没接到指标层」）。若把「全链路指标集中展示」理解成「有没有这些底层数」，判定应是「部分」而非我写的缺两段。
