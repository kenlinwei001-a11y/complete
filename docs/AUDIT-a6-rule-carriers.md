# AUDIT · 规则库 C01–C33 能不能担「跨 seg 争用」判据

> ## ⚠️ 过期横幅（收编时加·2026-08-13）
> - **基线 sha**：`4ae28e0e` — **canonical 已在其后 260 个提交**。
> - **本次有没有重跑**：**没有**（本文性质即「只出判定、不改生产代码」）⇒ 改做**抽查 `file:line` 锚点回代码核对**。
> - **抽查结论**：`apps/datacore/src/ruledsl.ts:11` = `` *   func       := SUM | MIN | MAX | COUNT | AVG `` —— **逐字命中，未漂移**。
>   ⇒ 本文最影响排期的那条推翻（§449 第 2 行：「DSL 本就支持聚合 ⇒ 是**接了线没数据**，不是结构性不可达」）**在收编日仍成立**。
> - 未复核：其余 39 个锚点（`chain-impediment.ts` / `battery.ts` 系列行号未逐条回核，行号可能已漂）。

**工单** WO-A6-RULE-SCAN（收 `AUDIT-sandbox-cross-seg.md` §7.3 ⅳ「全案剩下最大的未知」）
**日期** 2026-08-11 · **画像** 轻（只读 + 单实例真跑，未跑任何 vitest / gate）
**审计基线** `origin/claude/inspiring-gates-aqczjg`（canonical）= `4ae28e0e`
**分支** `claude/handoff-wo-a6-rule-scan`
**性质** 只出判定，**不改 `apps/**` 生产代码**（变异反证用的那处改动已逐字节还原，见 §7.4）

---

## TL;DR（复验方先读这 12 行）

1. **答案不是「有」也不是「没有」，是「一半有、一半没有」** —— 而这两半的修法差一个量级，
   混成一句就会把排期做歪。必须拆开说（§5）。
2. **判「保谁」= 有，且已经在生产里跑着。** 就是 **C15 经营毛利底线**。
   它的底线值来自 `SEG_REGISTRY.floorPct`（= A6 判据原文指定的那个册），
   **且真的按业务线解析**：三条业务线拿到三个不同的 (marginPct, floorPct)。
   **变异反证通过**（改册一个值 → 终判从「可接」翻成「提价12%接」，且只翻被改的那条线）—— §4.3。
3. **判「有争用」= 没有。28 条规则无一条是多主体谓词** —— 全部是「某一个对象的某个量越某条线」。
   「同一基地被两个 seg 争」需要**跨多个对象求和再比**，这个形状在规则库里一条都没有（§4.4）。
4. **但「没有」≠「结构性恒 UNKNOWN」——审核方设想的那个最坏情形不成立**（这条直接决定做不做）。
   规则 DSL **本来就支持聚合**（`SUM|MIN|MAX|COUNT|AVG`，`ruledsl.ts:11`），
   只是 **28 条规则里 0 条用过**（§4.4）。缺的是「一条新规则 + 一层 payload 组装」，
   **不是「本体不承载所以永远算不出来」**。
5. **「C01–C33」是个标签不是个数：实播 28 条**，`C07/C14/C17/C19/C20` **压根不存在**（§3.1）。
   凡按「33 条」估工的排期都要按 28 重算。
6. **两维从不在同一个对象上相遇** —— 这是全案真正的卡点形态（§4.2）：
   `Line`/`Process` 有 `baseId` 无业务线；`DemandSegment` 有 `businessType` 无 `baseId`；
   **唯一同时承载两维的是 `Order`**（`businessType` + `bases`）。⇒ 争用只能沿 Order 组装。
7. **BOTTLENECK 实况已真跑钉死：2 个，前人是对的。** `LINE-WS-jinhua-slitting`（金华分切线，C05 95.8912%）
   与 **`LINE-WS-zigong-grading`（自贡分容线，C05 95.358%）**。
   前一单说「自贡那个 canonical 上无出处」——**它存在，只是没人真跑过**（§6）。
8. **「争用面 ∩ 阻滞点面 = ∅」现在是已证事实，不再是待验。** 真跑：争用面 = {changzhou, wuhan, xiamen}，
   阻滞点面 = {jinhua, zigong}，**交集空**。前人的结论对，前一单的存疑可以关掉（§6.2）。
9. **但我推翻了前一单的两个数**：`zigong` 结构上可跨 seg、实际**只落了 commercial 一条线**；
   前一单的静态复算把 `SO-3452` 算成 handan/zaozhuang（**真值 meishan/zaozhuang**），
   并把 wuhan/xiamen 的单数**写反了**（真值 wuhan 4 / xiamen 3）——§7.2。
10. **我推翻了审核方一条**：派单说「唯一承载的 C22 恒 UNKNOWN」⇒ 暗示业务线维在规则库里只有一个死出口。
    **实际是 8 条规则的 scope 都挂着 `Order`**，其中 **C03/C08/C13 三条今天就真能评估**（§4.1）。
    C22 恒 UNKNOWN 是**它自己**的问题（`Order.changeoverMin` 不是属性），不是业务线维的问题。
11. **我推翻了前一单一条**：它判「A6 的判据出口 `segOfBusinessType` 生产零调用方 ⇒ A6 验收今天 0 分」。
    **零调用方成立，但结论不成立** —— `SEG_REGISTRY` 的经济参数经**另一条活着的路**
    （`SEG_REGISTRY → DemandSegment.floorPct → order_fullchain → C15`）**已经到了生产**（§7.3）。
12. **金丝雀全中**（§2）。凡本文报「0 条 / 不存在 / 无承载」处，均附同方法、同实现的已知必中样例。

---

## 0. 开工前置（照铁律 0.6 的祖先关系判据，不用文件存在性）

```
$ git merge-base --is-ancestor HEAD origin/claude/inspiring-gates-aqczjg ; echo $?
0                    ⇒ HEAD 是 canonical 的祖先 = 落后，已重开分支
$ git checkout -B claude/handoff-wo-a6-rule-scan origin/claude/inspiring-gates-aqczjg
$ git rev-parse HEAD
4ae28e0e14cbd4d78a6b24716552a31e5659b11b
```

环境两条前置**都真的绊到了**（派单模板里写的那两条是对的）：
worktree 无 `node_modules`（`pnpm install --prefer-offline`）；
`@platform/contracts` 未 build ⇒ 还要先 build `@platform/llm-adapters`，
否则 datacore build 报 `TS2307 Cannot find module '@platform/llm-adapters'` —— **与本单无关的假红**。

---

## 1. 本单要回答的那一个问题

> 前一单（`AUDIT-sandbox-cross-seg.md` §7.3 ⅳ）自己点名的全案最大未知：
> **规则库 C01–C33 里，有没有任何一条能担「跨 seg 争用」的判据？**
> 若落空 ⇒ 新判据会**结构性恒 UNKNOWN**，A6 依旧不过，只是报错更诚实。

**为什么这个问题必须先答**：`chain-impediment.ts:104–106` 的纪律写死了——
`ruleKey` 一律指向**已在规则库定义**的规则码，不虚构规则码；
`:5` 的铁律是「引擎里一个业务阈值都没有」。
⇒ **没有承载规则，就不许在引擎里编一条 `contention > 阈值`**。所以这不是实现细节，是**能不能开工**的前置。

---

## 2. 方法与金丝雀（铁律 0.6：报否定结论前先自证工具）

判定分**三层**，每层各自带金丝雀。三层的金丝雀**与主逻辑共用同一份实现**（不许各抄一份）：
扫描器 `scan.mjs` / `scan2.mjs` 里 `carriesDim()` 与 `fieldExists()` 就是主逻辑本身，
金丝雀只是换一组入参调它。

### 2.1 第一层金丝雀：规则与属性表抽取

| 金丝雀 | 实测 | 期望 | 来源 |
|---|---|---|---|
| 规则条数 | **28** | 28 | `decision-info.ts:201` **独立记载**（不是我自己的数） |
| C01 的 expression 逐字 | `Line.weeklyCapacityWan > Line.designCeilingWan` | 同 | 已知值对拍 |
| C05 的 scope | `["Line"]` | 同 | 已知值 |
| **`Line` 属性表含 `baseId`** | **true** | true | `chain-impediment.ts:573` 的 baseIds 过滤**今天真能用** |
| `Order` 属性表含 `businessType` | true | true | WO-W5 已加 |
| 属性表抽取非空集 | 60+ 张 | >40 | 非空集自证 |

### 2.2 第二层金丝雀：字段存在性（`fieldExists`）

| 金丝雀 | 实测 | 期望 | 为什么这条能当金丝雀 |
|---|---|---|---|
| `Line.utilization` 存在 | true | true | C05 今天**真产出 BOTTLENECK**（§6），故必存在 |
| `Line.baseId` 存在 | true | true | baseIds 过滤今天真能用 |
| `Order.businessType` 存在 | true | true | 真跑回包里逐条可见 |
| **`Order.changeoverMin` 不存在** | **false** | false | 前一单已坐实 C22 恒 UNKNOWN —— **反向金丝雀** |
| `Process.requiredThroughput` 存在 | true | true | D3 已补，C02 第一次真能判 |

> ⚠ 第 4 条是**反向金丝雀**：它验的是「我的工具会不会把不存在的字段报成存在」。
> 只放正向金丝雀会漏掉「函数恒返回 true」这一族坏法。

### 2.3 第三层金丝雀 —— **本单否定结论的护身符**（派单 §4 明令要求的那个）

派单要求：*报「C01–C33 无一条能担」之前，拿一条你确定**能**按某维裁的规则跑同样的判定方法，
它若也报「不能」⇒ 是方法坏了。*

**照办。金丝雀维 = 基地维（`baseIds`）** —— 这一维**今天真的能裁**（`chain-impediment.ts:573–576`，
且 §6 的真跑里 `scope.baseIds` 确实生效）。**同一个函数 `carriesDim()`，只换字段集**：

```
carriesDim(t, ["businessType","segment","segId","applicationDomain"])   ← 主逻辑（业务线维）
carriesDim(t, ["baseId","bases","base"])                                ← 金丝雀（基地维）
```

| 维 | 结果 | 判读 |
|---|---|---|
| **基地维（金丝雀）** | **15/28 条命中** → C01,C02,C03,C04,C05,C08,C11,C12,C13,C15,C22,C24,C29,C30,C33 | ✅ **非零 ⇒ 方法本身是好的** |
| 业务线维（主逻辑） | 9/28 条命中 → C03,C08,C12,C13,C15,C22,C24,C29,C33 | 这个数**不是 0**，见 §4.1 |

⇒ **本单的否定结论（§4.4「无一条是多主体谓词」）不是工具报的 0，是逐条读完 28 条 expression 得到的。**
金丝雀证明扫描面正常；否定结论另有出处（表达式形状），两者不混用。

---

## 3. 规则库全表（真跑态·非静态抽取）

### 3.1 先订正一个基数：**「C01–C33」是标签，实播 28 条**

```
$ curl -s localhost:4093/a/v1/rules -H 'X-Debug-User: demo:admin:admin'
n = 28   status 全 PUBLISHED = true          ← 与静态抽取一致（金丝雀 ✅）
```

缺号 **C07 / C14 / C17 / C19 / C20 —— 全仓无定义**。
仅有的命中是 `agentcore/test/ontology-context.test.ts:49/182`（测试自造的假规则）
与 `frontend-shell/src/views/sim/ProjectSimView.tsx:992`（**引用了一个不存在的 C07**，顺手账）。
`decision-info.ts:201` 早已独立记下这一点，本单予以确认。

> **凡按「33 条」估工的排期都要按 28 重算。**

### 3.2 C01–C33 逐条表

**列的定义**：
- **读哪些对象/属性** = expression 里出现的 `对象.属性` 全集。
- **判定对象承载业务线？** = 该规则 `scopeObjectTypes` 里，**有没有一个类型的属性表带业务线字段**
  （判据：能不能说「这条违规属于乘用车还是储能」）。
- **今天可评估？** = 表达式读的字段在对象上**真存在**（属性表 ∪ 派生表），或有**求值期注入**方。
  三态照铁律 0.5 三分法标注。

| # | key | 名称 | expression | scope | 读哪些对象/属性 | 判定对象承载业务线？ | 今天可评估？ | **能不能按业务线裁** |
|---|---|---|---|---|---|---|---|---|
| 1 | **C01** | 产线设计产能上限 | `Line.weeklyCapacityWan > Line.designCeilingWan` | Line | Line.weeklyCapacityWan / designCeilingWan | ❌ Line 无业务线字段 | ❌ 两个字段**都不在** lineProps | **不能**·需给 Line 加业务线别名（本体级改动） |
| 2 | **C02** | 化成/老化串并产能口径 | `Process.parallelThroughput < Process.requiredThroughput` | Process | Process.parallelThroughput / requiredThroughput | ❌ Process 无业务线字段 | ⚠ requiredThroughput 有；parallelThroughput **由 `loci()` D3 读数注入**（`chain-impediment.ts:513–519`） | **不能**·Process 只有 baseId/lineId |
| 3 | **C03** | 产能上限约束 | `Order.demandDelta > 0.5` | Order | Order.demandDelta | ✅ **Order 带 businessType** | ✅ 声明属性，真跑可见 | **能**（今天就能按业务线分组裁，零改动） |
| 4 | **C04** | 仅认证产线计入产能 | `Line.certStatus != '量产'` | Line | Line.certStatus | ❌ | ❌ `certStatus` 不在 lineProps（认证态在 `model_certified_on` **边**上） | **不能** |
| 5 | **C05** | 产线利用率持续越线 | `SUSTAIN(Line.utilization > 95, 3)` | Line | Line.utilization | ❌ | ✅ **今天唯一真产出 BOTTLENECK 的规则**（§6） | **不能**·⚠ 这正是 A6 最想裁的那条，偏偏 Line 不承载业务线 |
| 6 | **C06** | 物料齐套缺口口径(MRP) | `MaterialBalance.gapTon > 0` | MaterialBalance | MaterialBalance.gapTon | ❌ 全局物料，无基地维也无业务线维 | ✅ 真产出 7 条 BREAK | **不能** |
| 7 | **C08** | 外协比例红线 | `Order.outsourceRatio > params.outsourceRatioMax`（`params.outsourceRatioMax=0.2`） | Order | Order.outsourceRatio | ✅ **Order** | ✅ 声明属性 | **能**（零改动） |
| 8 | **C09** | 数据时延临时降级 | `DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > params.staleHours` | DataSourceHealth | 2 个属性 | ❌ | ✅ | **不能** |
| 9 | **C10** | 场景必填+行动审批留痕 | `Action.approver == NULL OR Action.audited == FALSE` | Action, Scenario | Action.approver / audited | ❌ | ❌ **Action/Scenario 未注册为本体对象类型** | **不能** |
| 10 | **C11** | 检修窗口与交付高峰错峰 | `MaintPlan.bufferDays < 3` | MaintPlan | MaintPlan.bufferDays | ❌（MaintPlan 有 baseId，无业务线） | ❌ `bufferDays` 不在 maintPlanProps | **不能** |
| 11 | **C12** | 预测偏差触发重校 | `SUSTAIN(Model.forecast_deviation > 0.08, 1)` | Model | Model.forecast_deviation | ⚠ **Model 带 `applicationDomain`＝第二套词表** | ❌ `forecast_deviation` 不在 modelProps | **不能**·前一单已证 `applicationDomain` 不可替代（缺「商用车」·错标 3/24 单） |
| 12 | **C13** | 客户信用额度 | `Order.creditUsedRatio > 1` | Order | Order.creditUsedRatio | ✅ **Order** | ✅ 声明属性 | **能**（零改动） |
| 13 | **C15** | **经营毛利底线** | `Order.marginPct < Order.floorPct` | **Order, DemandSegment** | Order.marginPct / floorPct | ✅✅ **两个 scope 类型都带业务线**（Order.businessType + DemandSegment.businessType） | ⚠ Order 上**无**此二字段；**但有两条求值期解析路**（§4.3） | **能，且今天已在生产按业务线真解析** ⇐ **本单头号发现** |
| 14 | **C16** | 齐套缺口预警 | `MaterialBalance.gapTon > 0` | MaterialBalance | gapTon | ❌ | ✅ | **不能**（与 C06 同表达式同 scope，重复登记） |
| 15 | **C18** | 现金垫底线 | `AnnualScenario.cashCushion < params.cashFloor`（50） | AnnualScenario | cashCushion | ❌ 公司级情景 | ✅ | **不能**（口径上也不该有业务线维） |
| 16 | **C21** | 产销平衡偏差 | `SopVersionRow.balanceDeviationPct > params.balanceDeviationPct`（0.1） | SopVersionRow | balanceDeviationPct | ❌ | ❌ 字段不在 sopVersionRowProps；由 `plan_audit` 注入（`service.ts:4515`） | **不能** |
| 17 | **C22** | 换型损失/排产约束 | `Order.changeoverMin > 120` | Order | Order.changeoverMin | ✅ **Order** | ❌ 非 Order 属性；由 `changeover_sequence` 注入（`service.ts:4500`） | **需要**：换型求解器把逐单换型分钟落到订单维（今天注入的是**全序列最大值**一个标量，无订单维） |
| 18 | **C23** | CAPEX 情景测算门槛 | `AnnualScenario.capex >= 10` | AnnualScenario | capex | ❌ | ✅ | **不能** |
| 19 | **C24** | 接单毛利过线 | `Quote.marginPct < Quote.floorPct` | **Order, DemandSegment** | Quote.marginPct / floorPct | ✅✅ 同 C15 | ⚠ `Quote` **非本体对象类型**（scope 已归真实类型 Order/DemandSegment）；由 `quote_margin` 注入（`service.ts:4460–4461`） | **能**（C15 的镜像·同口径同值） |
| 20 | **C25** | 外部终端需求假设偏离 | `ExternalSignal.deviationPct > 0.05` | ExternalSignal | deviationPct | ❌ | ❌ **ExternalSignal 未注册为本体对象类型** | **不能** |
| 21 | **C26** | 认证资源上限 | `Cert.parallelTasks > Cert.engineerGroups` | Cert | 2 属性 | ❌ | ❌ Cert 未注册；由 `cert_schedule` 注入（`service.ts:4540`） | **不能** |
| 22 | **C27** | 长协执行偏差 | `Lta.deviationPct > 0.05` | Lta | deviationPct | ❌ | ❌ `Lta` 未注册（真类型叫 `LongTermAgreement`） | **不能** |
| 23 | **C28** | 呆滞预警 | `Batch.idleDays > 90` | Batch | idleDays | ❌ | ✅ **真产出 6 条 CONGESTION**（locus 走 `MaterialBatch`，见 §6） | **不能**·MaterialBatch 无业务线也无基地维 |
| 24 | **C29** | 排产冻结期 | `Order.daysToStart < 3` | Order | Order.daysToStart | ✅ **Order** | ❌ **非属性、且全仓无任何注入方**（`service.ts:4568` 自己写明 quarterly_gap 也给不出） | **需要**：先补 `Order.daysToStart` 承载（开工日−today） |
| 25 | **C30** | 良率连降停线评审 | `SUSTAIN(Process.dailyYield < Process.yieldFloor, 3)` | Process | dailyYield / yieldFloor | ❌ | ❌ 两字段都不在 processProps（有 `yield` / `yield_baseline`，**名字对不上**） | **不能** |
| 26 | **C31** | 外协质量门 | `Outsource.yieldRate < Outsource.minYieldRate` | Outsource | 2 属性 | ❌ | ❌ Outsource 未注册 | **不能** |
| 27 | **C32** | 逾期冻结 | `Customer.maxOverdueDays > 30` | Customer | maxOverdueDays | ❌ | ❌ Customer 未注册；由 `credit_exposure` 注入（`service.ts:4470`） | **不能** |
| 28 | **C33** | 碳护照前置 | `NOT (Order.destination == 'EU' IMPLIES Order.carbonFootprint <= Order.euCarbonThreshold)` | Order | 3 属性 | ✅ **Order** | ❌ 三字段都非 Order 属性；由 `carbon_footprint` 注入（`service.ts:4475`） | **需要**：注入层带上订单维（今天注入的是标量） |

**合计**：能按业务线裁 **5 条**（C03 / C08 / C13 / C15 / C24，其中 C15/C24 同口径互为镜像）·
需要补东西才能裁 **3 条**（C22 / C29 / C33）· 不能 **20 条**。

---

## 4. 三个结论，各自的证据

### 4.1 结论一：业务线维**不是**只有一个死出口 —— 推翻派单的暗示

派单原话：*「`Line`/`Process` 属性表里无业务线别名字段，唯一承载的 `Order` 那条 C22 恒 UNKNOWN」*
—— 这句话读起来像「业务线维在规则库里只有 C22 一个出口，而它是死的」。

**实际**：`Order` 挂着 **8 条**规则（C03/C08/C13/C15/C22/C24/C29/C33），
其中 **C03 / C08 / C13 三条今天就真能评估**（字段是 Order 的真属性，真跑回包里逐条可见）：

```
Order 真跑 props（24 单，逐单相同键集）：
  bases, businessType, creditUsedRatio, cust, demandDelta, due, early,
  leadDays, model, outsourceRatio, pri, qty, so, status, unitPrice, value
```

⇒ **C22 恒 UNKNOWN 是 C22 自己的病**（`changeoverMin` 不是 Order 属性），
**不是「业务线维只有这一个出口」**。形态照 0.6 句式：
> 「我用『C22 恒 UNKNOWN』当作『业务线维无可用出口』的证据，而前者并不度量后者。」

### 4.2 结论二：**两维从不在同一个对象上相遇** —— 这才是真正的卡点

这是全案的结构性事实，比「哪条规则能用」更根本：

| 对象类型 | 业务线维 | 基地维 | 说明 |
|---|---|---|---|
| **`Order`** | ✅ `businessType` | ✅ `bases`（json 数组） | **唯一同时承载两维的对象** |
| `DemandSegment` | ✅ `businessType`/`segment` | ❌ **无 baseId** | 只有 3 行，**公司级**，不分基地 |
| `Line` | ❌ | ✅ `baseId` | 争用发生的地方，但说不出「谁在争」 |
| `Process` | ❌ | ✅ `baseId` + `lineId` | 同上 |
| `MaintPlan` | ❌ | ✅ `baseId` | — |
| `MaterialBalance` / `MaterialBatch` / `DataSourceHealth` | ❌ | ❌ | 全局，两维都没有 |
| `Model` | ⚠ `applicationDomain`（第二套词表·**不可用**） | ✅ `bases` | 前一单已证：缺「商用车」+ 错标 3/24 单 |

**真跑证据**（`DemandSegment` 全表，3 行，键集完整）：

```
{segId:dseg-1, segment:乘用车, businessType:passenger, marginPct:19, floorPct:12, priceWan:2.2, tgt/p50/p90/act…}
{segId:dseg-2, segment:储能,   businessType:storage,   marginPct:13, floorPct:11, priceWan:1.4, …}
{segId:dseg-3, segment:商用车, businessType:commercial,marginPct:15, floorPct:11, priceWan:1.8, …}
                                    ⇒ 无 baseId、无 lineId：这三行**不落地**
```

⇒ **争用只能沿 `Order` 组装**（`Order.bases` × `Order.businessType`），
这与前一单「粒度只能是基地级」的结论一致，但**理由更硬**：不是「Model 层不可达」，
而是**除 Order 外没有任何对象同时知道「哪条业务线」和「哪个基地」**。

### 4.3 结论三：**判「保谁」的判据有，就是 C15，而且是活的** ⇐ 本单头号发现

A6 判据原文：*「保谁的判据来自 `SEG_REGISTRY.marginPct/floorPct`」*。
前一单判定该判据「今天 0 分」，理由是 PRD 指定的出口 `segOfBusinessType` **生产零调用方**。

**零调用方我复核了，成立**（金丝雀：`businessTypeOfOrder` 非 test 命中 13 处 ⇒ 扫描面正常；
`segOfBusinessType` 9 处命中全是定义/注释/test）。

**但「那个函数没人调」推不出「那些参数没到生产」——`SEG_REGISTRY` 有第二条活着的路**：

```
packages/contracts/src/base-registry.ts:46–50   SEG_REGISTRY = [乘用车 19/12, 储能 13/11, 商用车 15/11]
        │
        ▼  battery.ts:3961–3963   SEGMENTS = SEG_DEMAND.map(d => {...SEG_REGISTRY.find(x=>x.seg===d.segment)})
        ▼  battery.ts:3965–3969   demandSegments = SEGMENTS.map(...marginPct: s.margin, floorPct: s.floor,
                                                                 businessType: businessTypeOfSegment(...))
        ▼  种子落库 → 对象类型 DemandSegment（3 行·真跑可见·值与册**逐字节相同**）
        ▼  solvers/service.ts:3237   const seg = BUSINESS_TYPE_LABEL[businessTypeOfOrder(op)]
        ▼  solvers/service.ts:3238–3241  dseg = dsegs.find(d => d.props.segment === seg)
                                          marginPct = dseg.props.marginPct ; floorPct = dseg.props.floorPct
        ▼  solvers/service.ts:3258   const marginOk = marginPct >= floorPct        ← **C15 的判定**
        ▼  solvers/service.ts:3262   financeJudge{..., ruleRefs: ["C15","C13","C18"]}
```

**真跑（`order_fullchain`，每业务线取 2 单）**：

```
SO-3391 passenger  → segment=乘用车 marginPct=19 floorPct=12  ruleRefs=["C15","C13","C18"]
SO-3402 passenger  → segment=乘用车 marginPct=19 floorPct=12
SO-3437 commercial → segment=商用车 marginPct=15 floorPct=11
SO-3506 commercial → segment=商用车 marginPct=15 floorPct=11
SO-3452 storage    → segment=储能   marginPct=13 floorPct=11
SO-3458 storage    → segment=储能   marginPct=13 floorPct=11
不同取值组数 = 3/3  ⇒ 底线**真按业务线解析**，不是恒定一个值
```

**变异反证（照本仓纪律：不改数就不算证明依赖）** ——
把 `SEG_REGISTRY` 储能 `floorPct` **11 → 25**，rebuild contracts + datacore，另起一个实例对拍：

| 业务线 | 原始 | 变异后 | 判读 |
|---|---|---|---|
| passenger | floor=12 · 可接 | floor=12 · 可接 | ⚪ **不该变，没变** ✅ |
| commercial | floor=11 · 可接 | floor=11 · 可接 | ⚪ **不该变，没变** ✅ |
| **storage** | floor=11 · **可接** | floor=**25** · **提价12%接** | 🔴 **该变，变了** ✅ |

```
SO-3458 原始: fin=通过     verdict=可接
        变异: fin=需提价12% verdict=提价12%接
              conds 多出一条：「毛利率 13% < 细分底线 25%（C15），提价 12% 达线」
SO-3464 / SO-3470 同样翻转
```

⇒ **改册一个值 → 终判翻转，且只翻被改的那条业务线。这是真依赖，不是装饰品。**
（变异已逐字节还原，`git status --porcelain` 空 —— §7.4。）

**所以**：A6 的「保谁」判据**不需要新造**，C15 就是它，且已零字面量地接在 `SEG_REGISTRY` 上。
真正缺的只是**把它接到 `chain_impediments` 这条路上**（今天它只服务 `order_fullchain`）。

### 4.4 结论四：判「有争用」的判据**没有**，但**不是结构性恒 UNKNOWN**

**28 条 expression 逐条读完，形状只有五种，无一是多主体谓词**：

| 形状 | 条数 | 例 |
|---|---|---|
| `X.a  op  X.b`（同对象两字段比） | 6 | C01 C02 C15 C24 C26 C31 |
| `X.a  op  字面量/params.x` | 19 | C03 C05 C06 C08 C09 C11 C12 C13 C16 C18 C21 C22 C23 C25 C27 C28 C29 C30 C32 |
| `X.a != 枚举值` | 1 | C04 |
| NULL / 布尔 | 1 | C10 |
| `NOT ( … IMPLIES … )` | 1 | C33 |

**「跨 seg 争用」的判定形状是**：`Σ(某基地上·按业务线分组的需求) > 该基地产能`
—— **需要跨多个对象求和再比**。上表**一条都不是这个形状**。

**但最坏情形（结构性恒 UNKNOWN）不成立** —— 两条硬证据：

**① 规则 DSL 本来就支持聚合**（`apps/datacore/src/ruledsl.ts:11`）：

```
func := SUM | MIN | MAX | COUNT | AVG            ← 文法里写着
:66   const FUNCS = new Set(["SUM","MIN","MAX","COUNT","AVG"]);
:502  case "func": { const values = resolveCollection(ctx.payload, op.arg.path); … }
```

**而 28 条规则里 0 条用过**（金丝雀对照：`SUSTAIN` 3 条 / `IMPLIES` 1 条 / `params.` 4 条 —— 非零，
证明我在同一份 expression 集合上数得出东西）：

```
SUSTAIN  3 条  C05,C12,C30          ← 金丝雀：数得出来
IMPLIES  1 条  C33                  ← 金丝雀：数得出来
params.  4 条  C08,C18,C09,C21      ← 金丝雀：数得出来
SUM/MIN/MAX/COUNT/AVG   0 条        ← 结论（工具已自证）
```

三分法定性 = **接了线没数据**（能力在 DSL 里，零规则消费），**不是「没接线」**，更不是「不可能」。

**② 承载物在**：`Order` 同时带 `businessType` 与 `bases`（§4.2），
`DemandSegment` 带 tie-break 基准 `marginPct/floorPct`（§4.3 已证是活的）。

**所以缺的是两样具体东西，不是一个不可逾越的本体缺陷**：

| 缺什么 | 今天的事实 | 属于哪一半 |
|---|---|---|
| **一条聚合型规则** | 规则库 28 条全是单主体；DSL 的 `SUM/COUNT` 零消费方 | 规则库（数据半） |
| **一层 payload 组装（按基地分组、按业务线分桶）** | `chain-impediment.ts:512` 的 `loci()` **只有 6 个 case**（Process/Line/Order/MaterialBatch/MaterialBalance/DataSourceHealth），**无 DemandSegment、无任何产出「集合」的 case**；`resolveCollection` 要求 payload 里已经是数组 ⇒ **DSL 不做 join/group by，组装是调用方的活** | 引擎半 |

> ⚠ **给排期的一句话**：这不是「加一道门」，是「立一条规则 + 补一个 locus 组装器」。
> 而 §4.3 已经把最贵的那块（保谁的判据 + 零字面量取值链）**证明为现成的**。

**顺带记一笔（不在本单范围，但会影响选型）**：仓里已有一个**通用争用求解器**
`shared_bottleneck`（`solvers/service.ts:1006–1062`），产出 `bottlenecks / contention / downgraded`。
**但它不能直接拿来做 A6**，三个硬伤：
① **零规则引用** —— 阈值即 `capacityField` 数据本身，不读规则库，违反 `chain-impediment.ts:5` 的铁律；
② **`priorityField` 走 `Number(props[k])`** ⇒ `businessType` 是字符串枚举 → NaN → 全体 0 → 退化成按 key 字典序，
   **无法按业务线排优先级**；
③ **分组键 `viaField` 取标量** ⇒ `Order.bases` 是**数组**，`String(["changzhou","wuhan"])` 拼成 `"changzhou,wuhan"`，
   与任何 Line/Base 主键都对不上。⇒ 直接用会**静默返 0 瓶颈**（`ONTOLOGY-7ELEM-AUDIT.md:113` 记的正是这一族）。

---

## 5. 所以：**有还是没有**（这一节直接回答仓主的排期问题）

**拆成两半答，合起来答必错。**

| A6 的两半 | 有无承载规则 | 证据 | 若要做，缺什么 |
|---|---|---|---|
| **判「保谁」**（争起来保哪条业务线） | ✅ **有 —— C15**（镜像 C24） | §4.3：`SEG_REGISTRY → DemandSegment.floorPct → order_fullchain:3241 → C15`，**变异反证通过** | **只缺挂载点**：把这条已有的取值链接到 `chain_impediments`（今天只服务 `order_fullchain`）。三分法 = **接了线接错地方** |
| **判「有争用」**（同一基地被 ≥2 seg 争） | ❌ **没有 —— 28 条无一条是多主体谓词** | §4.4 逐条形状表 | ① 规则库立一条聚合规则（DSL 已支持 `SUM/COUNT`，今天 0 条用）② `loci()` 补一个产出「按基地分组的订单集合」的 case |

### 5.1 给仓主的裁定建议（**不是 dev 决策，本单只摆事实**）

- **「排期做」是可行的**，因为最贵的一块（保谁的判据 + 零字面量取值链）**现成且已验证**。
  不存在「新判据加了也永远算不出东西」这个最坏情形 —— **派单假设的那条否定路径，经查不成立**。
- **但「今天放开跨 seg 过滤」仍然只会得到诚实的空**：
  真跑 15 条阻滞点里，locus 落 `Line` 2 条 / `MaterialBatch` 6 条 / `MaterialBalance` 7 条，
  **没有一条 locus 承载业务线** ⇒ 单放开 `businessTypes` 维，作用面 **0/15**（与前一单结论一致）。
- **争用面与阻滞点面今天不相交**（§6.2 已证）⇒ 若做成 annotate（在既有阻滞点上打争用标注），
  **产出恒空**。**这条现在是已证事实，可以据此定形态 = produce（新判据）**，
  不再是前一单说的「未坐实、不许当依据」。

---

## 6. BOTTLENECK 实况（收派单 §3 那条疑点）

**真跑**，不是读代码：datacore 内存模式 `SEED_DEMO=1` seed 42，端口 4093，
`POST /a/v1/solvers/chain_impediments/invoke {"args":{"scope":{}}}` → HTTP 200。

### 6.1 canonical 上到底有几个 BOTTLENECK、分别在哪

```
总阻滞点 = 15        （与前一单/审核方记的 15 一致 ✅）
按 kind：CONGESTION 6 · BREAK 7 · BOTTLENECK 2

BOTTLENECK 逐条（全部 2 条）：
  Line / LINE-WS-jinhua-slitting  「金华分切线」 rule=C05 metric=95.8912% th=95 sev=1 dataMode=PARTIAL
  Line / LINE-WS-zigong-grading   「自贡分容线」 rule=C05 metric=95.3580% th=95 sev=0 dataMode=PARTIAL

CONGESTION 6 条：MaterialBatch × {elyte_b2, cu_foil_b2, pos_lfp_b2, pos_ncm_b2, neg_graphite_b2, sep_film_b2}  rule=C28
BREAK      7 条：MaterialBalance × {mbal-1,2,3,5,6,7,8}  rule=C06
```

**⇒ 「自贡分容」这个 BOTTLENECK 是真的，前人没记错。**
前一单说它「canonical 上无出处」——**出处就是真跑；那份审计没跑过，只在文档里找**。
形态照 0.6 句式：
> 「我用『grep 不到出处文档』当作『该阻滞点不存在』的证据，而前者并不度量后者。」

它的确切 id 是 **`LINE-WS-zigong-grading`（分容 grading）**，不是任何文档里写的别的名字；
`dataMode=PARTIAL` 是因为 C05 含 `SUSTAIN` 而 SolverContext 无时序访问（`chain-impediment.ts:617–625` 的诚实 caveat）。

### 6.2 `zigong` 到底跨不跨 seg —— 「交集为空」现在是**已证事实**

派单特别提醒：*`zigong` 恰是结构上可跨 seg 的四个之一，不许把「annotate 恒空」当已证事实用。*
**照办，真跑查实**（金丝雀：订单总数 24、业务线分布 `passenger 12 / commercial 3 / storage 9`
—— 与 `apps/datacore/test/sandbox-chain-scope.seam.test.ts:24` 的实测基线**逐值相同** ✅）：

| 基地 | 真实承载业务线 | 落单数 | 跨 seg？ |
|---|---|---|---|
| **changzhou** | passenger + storage | 8 | ✅ |
| **wuhan** | commercial + passenger | 4 | ✅ |
| **xiamen** | commercial + passenger | 3 | ✅ |
| **zigong** | **commercial 单线** | **1** | ❌ |
| jinhua | passenger | 7 | ❌ |
| chengdu / hefei | passenger | 4 / 4 | ❌ |
| handan / zaozhuang | storage | 4 / 4 | ❌ |
| jiangmen / meishan | storage | 2 / 2 | ❌ |
| xinyang / yangzhou | storage | 1 / 1 | ❌ |

```
真实跨 seg 争用面 = {changzhou, wuhan, xiamen}
阻滞点面(BOTTLENECK) = {jinhua, zigong}
交集 = ∅                      ⇐ **真跑所得，不再是推测**
```

**关键区分（前一单混了，这里拆开）**：
`zigong` **结构上**可跨 seg（可产 `2170-NCM`，该型号订单含 commercial+passenger），
**但实际只落了 1 张 commercial 单**（`SO-3506`，bases=`["wuhan","zigong"]`）。
⇒ **「结构上界 4 个」与「实际争用面 3 个」是两个不同的数**，
前一单把上界当成了「可能推翻交集为空」的理由 —— 真跑之后，**推翻不了**。

**结论**：前人的「交集为空 ⇒ annotate 恒空」**成立**，
前一单挂起的三条待验（§7.3 ⅰ/ⅱ/ⅲ）**本单全部关闭**。

---

## 7. 我推翻 / 订正了谁的哪几条

### 7.1 推翻/订正**审核方派单**

| # | 派单原话 | 裁定 | 证据 |
|---|---|---|---|
| 1 | 「唯一承载的 `Order` 那条 C22 恒 UNKNOWN」（暗示业务线维只有一个死出口） | ❌ **推翻** | `Order` 挂 8 条规则，**C03/C08/C13 三条今天真能评估**；C22 恒 UNKNOWN 是它自身 `changeoverMin` 无承载，与业务线维无关（§4.1） |
| 2 | 「若落空 ⇒ 新判据结构性恒 UNKNOWN，加了也永远算不出东西」 | ❌ **推翻（这条最影响排期）** | DSL **本就支持** `SUM/MIN/MAX/COUNT/AVG`（`ruledsl.ts:11/66/502`），只是 28 条规则 0 条用；且 `Order` 同时承载两维。⇒ 是**接了线没数据**，不是结构性不可达（§4.4） |
| 3 | 「两种结论都要能下：有 / 没有」 | ⚠ **二选一本身是错的框** | 真实答案是**一半有一半没有**，且两半修法差一个量级。合起来答必歪排期（§5） |
| 4 | 「C01–C33」 | ⚠ **订正基数** | **实播 28 条**，C07/C14/C17/C19/C20 全仓无定义（§3.1）。按 33 估工要重算 |

### 7.2 推翻/订正**前一单**（`AUDIT-sandbox-cross-seg.md` @ `2f54e84d`）

| # | 前一单原话 | 裁定 | 证据 |
|---|---|---|---|
| 1 | §7.3 ⅱ「第二个 BOTTLENECK 是哪条线 —— canonical 上只有 jinhua 一个出处」 | ❌ **推翻** | 真跑：**2 个**，第二个是 `LINE-WS-zigong-grading` 自贡分容线（C05 95.358%）。前人没记错，是那份审计没真跑（§6.1） |
| 2 | §3.3「SO-3452 → 我算 handan/zaozhuang，实测记录说 meishan，无法证实证伪」 | ❌ **推翻·实测记录是对的** | 真跑 `SO-3452` bases=**`["meishan","zaozhuang"]`** ⇒ `chainFamilyLines.ts:15–17` 正确，**前一单的静态复算错了** |
| 3 | §3.3「changzhou 8 / wuhan 3 / xiamen 4」 | ⚠ **订正** | 真跑：changzhou 8 ✅ / **wuhan 4** / **xiamen 3** —— 后两个**写反了** |
| 4 | §3.4「交集为空证据链不完整，不许当已证事实」 | ✅ **当时对，现已可关闭** | 本单真跑坐实：争用面 {changzhou,wuhan,xiamen} ∩ 阻滞点面 {jinhua,zigong} = ∅（§6.2） |
| 5 | §2.3「`segOfBusinessType` 生产零调用方 ⇒ **A6 的验收判据今天是 0 分**」 | ⚠ **前半成立·后半推翻** | 零调用方我复核成立；但 `SEG_REGISTRY` 的 marginPct/floorPct **经另一条活路已到生产**（→ DemandSegment → `service.ts:3241` → C15），**变异反证通过**。⇒ 判据不是 0 分，是**挂错了地方**（§4.3、§7.3） |
| 6 | §3.2「结构上可跨 seg 的基地 = 4 个（含 zigong）」 | ✅ **成立，但须与实际面区分** | 结构上界 4 ≠ 实际争用面 3。`zigong` 实际只落 1 张 commercial 单（§6.2）。两个数不可混用 |

### 7.3 我自己抓到的一个形态（照 0.6 记账）

前一单的 §2.3 是一次**教科书式的「X 不度量 Y」**，值得单独记，因为它差点让 A6 被判死：

> **「我用『桥函数 `segOfBusinessType` 零调用方』当作『`SEG_REGISTRY` 的经济参数没到生产』的证据，
> 而前者并不度量后者。」**

同一份数据可以有**多条到达路径**；只追 PRD 点名的那一条，就会把「换了条路走」误读成「没走」。
**排除法必须枚举路径，不能只枚举符号。**
本单的做法：不追函数名，**追那三个数值**（19/12、13/11、15/11）在真跑回包里出现没有 —— 出现了，链就是活的。

### 7.4 本单自己的诚实边界

| 项 | 状态 |
|---|---|
| 变异反证改过 `packages/contracts/src/base-registry.ts` | ✅ **已逐字节还原**，`git status --porcelain` 输出为空；`git diff --stat` 无输出 |
| 起过的两个 datacore 实例（4093 / 4094） | ✅ 已按确切 pid 杀净（未用会自匹的 `pkill -f`），复核 `ps` 命中 0 |
| 未跑 | `pnpm -r test` / `pnpm -r build` / `scripts/gate.sh` —— 派单明令禁止，**一次都没跑** |
| 只 build 过 | `@platform/llm-adapters`、`@platform/contracts`、`datacore`（tsc，非 vitest） |
| **未验证** | ① 若真去实现聚合规则，`resolveCollection` 在 `chain-impediment` 的 payload 形状下是否够用（**没写过原型，只读了实现**）② `shared_bottleneck` 的三个硬伤是**读代码所得**，未真跑打一发确认它会返 0 |

---

## 8. 待回写 `docs/SYSTEM-ONTOLOGY.md` 的清单

**本单不碰该文件（另有 dev 在写），清单交回审核方。**

1. **订正基数** —— 规则库是 **28 条**不是 33 条；`C07/C14/C17/C19/C20` 全仓无定义。
   建议在本体里把「C01–C33」标注为**编号区间**而非条数，并登记 5 个空号。
2. **新增本体事实（A6 的真正卡点）** —— **业务线维与基地维在本体上从不共存于同一对象**：
   `Order` 是唯一同时承载两维的对象（`businessType` + `bases`）；
   `DemandSegment` 有业务线无基地（公司级 3 行）；`Line`/`Process`/`MaintPlan` 有基地无业务线。
   ⇒ **任何按业务线定位到基地的判据，必须沿 `Order` 组装**。
3. **新增假绿实例（第 N 形态·「能力在、零消费方」）** —— 规则 DSL 的聚合算子
   `SUM/MIN/MAX/COUNT/AVG`（`ruledsl.ts:11/66/502`）**实现有、测试有、28 条规则 0 条用**。
   与 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 同族但**不同因**：那个是零生产调用方，这个是**零规则消费方**。
4. **订正既有断点记述** —— 前一单登记的「`segOfBusinessType` 零生产调用方 ⇒ A6 判据 0 分」
   应改为：**桥函数零调用方成立，但 `SEG_REGISTRY` 的经济参数经第二条路已到生产**
   （`SEG_REGISTRY → DemandSegment → service.ts:3241 → C15`，变异反证通过）。
   断点的准确描述是「**接了线接错地方**」（只服务 `order_fullchain`，没接 `chain_impediments`），
   不是「没接线」。**修法完全不同，必须改写。**
5. **新增不变量候选** —— 「规则的 `scopeObjectTypes` 必须是**已注册的本体对象类型**」。
   今天 **8 条规则挂着未注册类型**（`Cert` / `Lta` / `Batch` / `Outsource` / `Customer` /
   `Action` / `Scenario` / `ExternalSignal`），它们只能靠 `ruleEvalPayload` 的求值期注入才判得动；
   规则扫描器（`scheduler.ts:234`）对它们**恒静默跳过**（`catch {}`），**不报错也不计数**。
6. **新增裂缝登记** —— 规则有**三条互不相同的求值路**，同一条规则在三条路上结论可以不同：
   ① `scheduler.ts:234` 全量扫描（读**原始对象属性**）
   ② `service.ts:4441 ruleEvalPayload`（读**求解器输出**，19 处命名空间注入）
   ③ `chain-impediment.ts:512 loci()`（读 `metricPath` + 自带派生读数器，6 个 case）
   **同一条 C15，在 ① 恒不可评估、在 ② 由 `quote_margin`/`plan_audit`/`plan_generate` 三个求解器各喂一套口径、
   在 ③ 根本没绑。** 这是「一条规则三个真相源」的现成裂缝，建议单独立单。
7. **顺手账（文档漂移）** —— `frontend-shell/src/views/sim/ProjectSimView.tsx:992`
   引用了**不存在的规则 C07**（`rule: r.certFactor < 1 ? "C07" : undefined`）。

---

## 9. 复现命令（复验方照抄即可）

```bash
# 环境（worktree 无 node_modules；llm-adapters 必须先 build，否则 datacore build 假红）
pnpm install --prefer-offline
pnpm --filter @platform/llm-adapters build
pnpm --filter @platform/contracts build
pnpm --filter datacore build

# 起实例（换个没人占的端口；EADDRINUSE 会静默失败而旧进程继续答你）
PORT=4093 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=$(printf '0%.0s' {1..64}) node apps/datacore/dist/server.js &

H='X-Debug-User: demo:admin:admin'
# ① 规则全表（金丝雀：n 必须 = 28）
curl -s localhost:4093/a/v1/rules -H "$H" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log("n =",r.length);})'
# ② 阻滞点实况（金丝雀：15 条 = CONGESTION 6 + BREAK 7 + BOTTLENECK 2）
curl -s -X POST localhost:4093/a/v1/solvers/chain_impediments/invoke -H "$H" \
  -H 'Content-Type: application/json' -d '{"args":{"scope":{}}}'
# ③ 拒绝点仍在（期望 HTTP 400 VALIDATION_ERROR）
curl -s -X POST localhost:4093/a/v1/solvers/chain_impediments/invoke -H "$H" \
  -H 'Content-Type: application/json' -d '{"args":{"scope":{"businessTypes":["storage"]}}}' -w '\nHTTP=%{http_code}\n'
# ④ C15 按业务线解析（期望三线三组不同的 marginPct/floorPct）
curl -s -X POST localhost:4093/a/v1/solvers/order_fullchain/invoke -H "$H" \
  -H 'Content-Type: application/json' -d '{"args":{"so":"SO-3458"}}'
```

**变异反证的复现**：把 `packages/contracts/src/base-registry.ts:48` 储能 `floorPct: 11` 改成 `25`，
rebuild contracts + datacore，重跑 ④ —— `SO-3458` 应从 `verdict=可接` 翻成 `verdict=提价12%接`，
且乘用车/商用车两条线**逐字节不变**。**改完记得还原。**
