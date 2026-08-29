# AUDIT · 因子作用域词表取证（WO-FACTOR-SCOPE-SINGLESOURCE 件一）

> 病灶一句话：**「我用『前端有 chip 且请求确实带了 `scope.factorId`』当作『按因子细分生效了』的证据，
> 而两个词表交集为空 ⇒ 它一次都没生效过。」**（铁律 0.6 句式）
> 同族老病：欠账 #99（S0 节点 ID 缺单源，D1/E1 各造一套词表）。

日期：2026-08-10 · 分支 `claude/handoff-wo-factor-scope-singlesource`

---

## 0 · 工具自证（金丝雀 · 铁律 0.6 已落地机制）

任何「交集 = 0」这类**否定结论**都必须先跑一个「已知必中」的样例。本次金丝雀与主逻辑共用同一份实现
（脚本一次性 import 两个真词表，先查金丝雀再算交集）：

```
CANARY(cf-capacity-short)  in CausalFactor vocab = true      ← 引擎侧词表可读，工具没坏
CANARY2(设备OEE)            in BN_FACTORS         = true      ← 前端侧词表可读，工具没坏
交集 = 0 条 []
CausalFactor.label ∩ BN_FACTORS = 0 条 []                     ← 连 label 都不重合
```

两只金丝雀都命中 ⇒ **「交集 0」是真 0，不是「我没找到」**。

复验命令（本仓可重跑）：

```bash
pnpm -r build
node - <<'EOF'
import { CAUSAL_FACTORS } from "./apps/datacore/dist/synthetic/battery-extended.js";
import { BN_FACTORS } from "./apps/datacore/dist/synthetic/battery.js";
const ids = new Set(CAUSAL_FACTORS.map(c => c.factorId));
console.log("canary", ids.has("cf-capacity-short"), "交集", [...BN_FACTORS].filter(f => ids.has(f)).length);
EOF
```

---

## 1 · 两张词表全量对照

### 1.1 引擎认的 `CausalFactor.factorId`（28 条 · `apps/datacore/src/synthetic/battery-extended.ts:319-379`）

| # | factorId | label | drill（Type.Id.Field） | metricKey | isRoot |
|---|---|---|---|---|---|
| 1 | `cf-cathode-shortage` | 正极粉短缺 | MaterialBalance.mbal-2.gapTon | (共享) | false |
| 2 | `cf-upstream-cut` | 上游减供 | Supplier.SUP-003.actualSupplyTon | (共享) | false |
| 3 | `cf-lta-breach` | 长协违约 | LongTermAgreement.lta-lfp-cylk.actualDeliveredTon | (共享) | false |
| 4 | `cf-ore-price` | 锂价上涨 | CommodityPriceTrend.licarb-w4.pctChange | (共享) | false |
| 5 | `cf-geopolitical` | 地缘冲突推升矿价 | ExternalSignal.li_carbonate_price.value | (共享) | false |
| 6 | `cf-backup-thin` | 备份池不足 | BackupSupplierPool.pool-cathode.memberCount | (共享) | false |
| 7 | `cf-cert-cycle` | 认证周期长(root) | BackupSupplierPool.pool-cathode.certWeeks | (共享) | true |
| 8 | `cf-decision-gap` | 价格预判缺失(root) | DecisionGap.dgap-forecast.severity | (共享) | true |
| 9 | `cf-share-gap` | 市场份额缺口 | CompetitorShare.share-global.sharePct | market_share | false |
| 10 | `cf-competitor-price` | 竞品价格压制(root) | CompetitorPrice.price-ess-a.pricePerKwh | market_share | true |
| 11 | `cf-bid-loss` | 大客户丢标(root) | BidRecord.bid-ess-1.win | market_share | true |
| 12 | `cf-delivery-reputation` | 交付声誉受损(root) | OverdueRecord.od-cg.overdueDays | market_share | true |
| 13 | `cf-revenue-gap` | 营收缺口 | PipelineOpportunity.pipe-total.amount | revenue | false |
| 14 | `cf-pipeline-shrink` | pipeline 收缩(root) | PipelineOpportunity.pipe-ess-q3.amount | revenue | true |
| 15 | `cf-price-erosion` | 价格侵蚀(root) | PriceRealization.pr-ess-1.realizedPrice | revenue | true |
| 16 | `cf-churn` | 客户流失(root) | Customer.cust_0.maxOverdueDays | revenue | true |
| 17 | `cf-cash-gap` | 经营现金缺口 | ARAging.ar-total.amount | cash | false |
| 18 | `cf-ar-aging` | 应收账龄恶化(root) | ARAging.ar-90plus.amount | cash | true |
| 19 | `cf-dso-stretch` | DSO 拉伸(root) | DSO.dso-ess.days | cash | true |
| 20 | `cf-customer-concentration` | 客户集中度(root) | Customer.cust_0.receivables | cash | true |
| 21 | `cf-demand-attain-gap` | 需求达成缺口 | MaterialBalance.mbal-2.gapTon | demand_attain | false |
| 22 | `cf-forecast-bias` | 预测偏差(root) | DecisionGap.dgap-forecast.severity | demand_attain | true |
| 23 | `cf-capacity-short` | 产能瓶颈(root) | Equipment.\<seed 回填真 equipId\>.oee_current | demand_attain | true |
| 24 | `cf-material-short` | 物料短缺(root) | MaterialBalance.\<seed 回填真 matBalId\>.gapTon | demand_attain | true |
| 25 | `cf-gm-gap` | 毛利缺口 | GrossMarginBridge.gmb-total.impactYi | gross_profit | false |
| 26 | `cf-volume-shortfall` | 销量未达(root) | GrossMarginBridge.gmb-volume.impactYi | gross_profit | true |
| 27 | `cf-price-erosion-gm` | 价格侵蚀(root) | GrossMarginBridge.gmb-price.impactYi | gross_profit | true |
| 28 | `cf-cost-inflation` | 成本上涨(root) | GrossMarginBridge.gmb-cost.impactYi | gross_profit | true |

### 1.2 前端 chip 传的 `card.factor`（7 条 · `apps/datacore/src/synthetic/battery.ts:225 BN_FACTORS`）

`瓶颈工序` / `设备OEE` / `人力工时` / `物料齐套` / `物流时长` / `换型损失` / `良率波动`

出处链（**已追到调用点，不是 grep 猜的**）：

```
battery.ts:225 BN_FACTORS
  → battery.ts:393  params.bottleneck.factors
    → risk.ts:222   bottleneckMatrix  factors
    → risk.ts:582   riskTimeline      pairs[].factor      → cards[].factor
      → RiskBoardView.tsx:854  factorOptions=[card.factor, ...others.map(o=>o.factor)]
        → RiskBoardView.tsx:727 scope.factorId = rcFactor
          → solvers/service.ts:1426 scopedFactorId
            → solvers/service.ts:1480 causalFactorIds.has(scopedFactorId)  ← 恒 false
```

### 1.3 交集

**0**。且 `CausalFactor.label ∩ BN_FACTORS` 也是 **0**（连中文名都不重合）。
于是 7 个 chip 全部落进 `service.ts:1485` 的兜底：`factorApplied=false` + `factorNote` ⇒ **7 个按钮返回同一棵基地树**。

### 1.4 三种「不工作」的定性（铁律 0.5 判据 1）

| 形态 | 本例是否 | 依据 |
|---|---|---|
| 没接线 | ✗ | 前端真传 `scope.factorId`（`RiskBoardView.tsx:727`），引擎真读（`service.ts:1426`），两侧都有 src 调用方 |
| 接了线没数据 | ✓ **正是本例** | 词表交集为空 ⇒ `causalFactorIds.has(...)` 分支**一次都没进过**；产能域一条 `CausalFactor` 都没有 |
| 接了线接错地方 | ✗ | 挂载点是对的 |

修法因此是「**补数据 + 换单源**」，不是「接线」。

### 1.5 顺带查实的两处同族假绿（本单一并修）

1. **前端 MSW 桩比真后端更糟**：`apps/frontend-shell/src/mocks/handlers.ts:1679` 的 `gap_attribution`
   **完全忽略 `scope.factorId`**，且响应**不带 `scope` 字段**。前端 `RiskBoardView.tsx:1000` 的判据是
   `scope?.factorApplied !== false` ⇒ mock 模式下 7 个 chip 一律显示「**已按因子细分**」——
   真后端至少诚实说了「未细分」，mock 反而**静默错答**。
2. **测试实参与生产实参交集为空**（铁律 0.5 判据 6 的形态）：
   `apps/frontend-shell/test/caplive-cockpit.test.tsx:92` 的 SEAM② 咬的是 `rootcause-factor-化成柜张力`，
   而 `化成柜张力` 只存在于 `mocks/fixtures.ts:808`，**BN_FACTORS 里没有、CausalFactor 里更没有**；
   桩又对**任意** factorId 都追加一个 `factor:<id>` 节点。⇒ 这条 SEAM 三周来一直是绿的，
   而它验的那条路生产上不存在。

---

## 2 · 7 个产能因子逐个查承载物

判据：`drillType` 必须是**已物化**的对象类型（`synthetic/service.ts` 里有 `putAll(...)`），
`drillField` 必须是该对象**真实存在且为数值**的字段，且能按 `baseId` 落到本基地。
下表的 count/数值全部来自**真跑一遍种子**（`makeApp() + seedBattery()` 后 `listByType` 实测，seed=42），
不是读代码猜的。

| BN 因子 | 承载物（drillType.drillField） | 物化处 | 实测 | 按基地 | 结论 |
|---|---|---|---|---|---|
| **瓶颈工序** | `Line.utilization` | `synthetic/service.ts:731` | 130 行 · 常州 10 条 util 90.47–93.14 | ✅ `Line.baseId` | ✅ 可建 |
| **设备OEE** | `Equipment.oee_current` | `synthetic/service.ts:733` | 780 行 · 数值 | ✅ `Equipment.baseId` | ✅ 可建 |
| **人力工时** | `Process.shiftHours` | `synthetic/service.ts:732` | 650 行 · 常州取值 {11,24} | ✅ `Process.baseId` | ✅ 可建 |
| **物料齐套** | `Shipment.coverageDays`（齐套覆盖天数） | `synthetic/service.ts:736` | 13 行（每基地 1）· 常州 2、其余多为 5 | ✅ `Shipment.baseId` | ✅ 可建 |
| **物流时长** | `Shipment.etaDay`（到货天） | `synthetic/service.ts:736` | 13 行 · 2–16 天，逐基地不同 | ✅ `Shipment.baseId` | ✅ 可建 |
| **换型损失** | `EquipmentDowntime.durationMin`（`reason=换型`） | `synthetic/service.ts:803` | 166 行 · 换型 28 条 | ⚠️ 12/13 基地有，**眉山 0 条** | ✅ 可建（眉山按数据缺席处理） |
| **良率波动** | `Process.yield_baseline` | `synthetic/service.ts:732` | 650 行 · 常州 min 0.9324 | ✅ `Process.baseId` | ✅ 可建 |

`EquipmentDowntime(reason=换型)` 逐基地实测条数：

```
changzhou 3 · xiamen 4 · chengdu 2 · meishan 0 · wuhan 3 · jiangmen 2 · hefei 1
xinyang 4 · zaozhuang 1 · handan 1 · zigong 2 · jinhua 2 · yangzhou 3
```

### 2.1 被排除的候选（诚实标「无承载物」）

| 候选 | 为什么不能用 |
|---|---|
| `ShiftPlan.hours` / `.plannedHeadcount`（人力工时的"正牌"承载物） | **对象数 = 0**。`synthetic/service.ts:807` 明写「高量低值执行类(ShiftPlan/ProductionSchedule/WIPMove/操作工考勤等)保持模型态不物化」⇒ 本体类型在、实例不在，`drillId` 无处可指 |
| `OperatorAttendance.hoursWorked` | 同上，**对象数 = 0** |
| `ChangeoverMatrix.changeoverMin`（`contracts/capacity-factors.ts:71` 登记的落点） | **该字段不存在**。实测 `ChangeoverMatrix` 属性 = `{pairId, fromModel, toModel, minutes, hours, lineId}`，且 `lineId` 恒 `null` ⇒ **既无该字段、也无法按基地落**。⚠️ 这是 `CAPACITY_FACTOR_BINDINGS` 里一条已经悬空的登记（本单不改它，只是不采用它，另账上报） |
| `Material.onHand`（`capacity-factors.ts:66` 物料齐套落点） | 字段真实存在，但 `Material` **无 `baseId`**（全局物料主数据）⇒ 做不到「本基地的齐套」，会退化成 13 张卡同一个数——正是 R1「8/8 基地卡全同」那类病 |

> ⚠️ 全程**没有**为了凑数把 `drillField` 指向不存在的字段。上面 4 条被排除的候选，
> 排除理由全部是**实测**（对象数 0 / 字段不存在 / 无 baseId），不是「感觉不合适」。

---

## 3 · 结论（决定件三怎么做）

**7 个里 7 个今天真能建**（其中「换型损失」在 13 个基地里有 12 个有数据，眉山按**数据缺席**据实不下发）。

⇒ **件三选 A：补 `CausalFactor` 种子数据**，不走「把按钮拿掉」那条。

但补数据不足以修好病，还差三件（否则补完仍然是「点了没反应」）：

1. **单源**：chip 的 value 必须绑 `CausalFactor.factorId`（显示用 `label`），
   且候选集从**引擎回执**取（`scope.availableFactors`），前端不得再从 `card.factor` 拼。
2. **per-base 解析**：`CausalFactor.drillId` 是**单值**，而这 7 个因子必须落到**本基地**的对象
   （否则 13 张卡同一份证据 = R1 老病复发）。故新增 `baseScopeField/drillPick/drillNorm` 三个
   **数据驱动**的解析声明，由引擎在查询期按 `scope.baseId` 解析出该基地的真实对象。
   —— 绝不在引擎里内联「哪个因子查哪张表」的 if 链（那就是第二套词表）。
3. **前端投影**：`components/ProvenanceDag.tsx:163 gapAttributionToBaseRootCause` 只认
   `base:<基地>` 这一种 L1 节点。而现有 factorId 命中路（`service.ts:1481`）走的是
   `gapAttributionMetricDomain`，其 L1 是 `metricgap:<key>` ⇒ **即便词表对上，树也会整棵消失成"诚实灰"**
   （`service.ts:1470-1474` 的注释里已写明这条，但没人把它和"7 个 chip"这件事连起来）。
   故产能因子走**保基地树 + 追加 depth-3「因子细分」层**，不走 metricDomain 早返回。

---

## 3.5 · 交付后的亲手复验（绿测试 ≠ 能用）

起真服务跑（`node apps/datacore/dist/server.js` · `POST /a/v1/synthetic/jobs` 种 seed=42 ·
`POST /a/v1/solvers/gap_attribution/invoke` 逐因子真调）。`CausalFactor` 行数 28 → **35**（+7）。

`scope.baseId=常州` 下发的 chip 候选（全部**真解析到承载对象**）：

| factorId | label | 下钻 | 本基地对象数 |
|---|---|---|---|
| cf-cap-bottleneck-process | 瓶颈工序 | Line.utilization | 10 |
| cf-cap-changeover-loss | 换型损失 | EquipmentDowntime.durationMin | 3 |
| cf-cap-equipment-oee | 设备OEE | Equipment.oee_current | 60 |
| cf-cap-labor-hours | 人力工时 | Process.shiftHours | 50 |
| cf-cap-logistics-leadtime | 物流时长 | Shipment.etaDay | 1 |
| cf-cap-material-kitting | 物料齐套 | Shipment.coverageDays | 1 |
| cf-cap-yield-variance | 良率波动 | Process.yield_baseline | 50 |

- **7 个按钮两两比对：相同对数 = 0**（修前是 7 个逐字节全同）。
- 每个因子的 L1/L2 与 base-only **逐字节相同**（细分是加出来的占比层·R6 零回归）。
- 换基地 → 下钻到**不同**对象（常州 `LINE-WS-changzhou-formation…` / 信阳 `LINE-WS-xinyang-calendering…`）。
- 传 BN 中文名「瓶颈工序」→ `factorApplied=false` + note，基地树保住。
- 眉山不下发「换型损失」chip；硬点它 → `factorApplied=false` + 「本基地 0 条」原话。

### ⚠ 这一步抓出了 9 条绿断言都咬不到的一个数值退化（记账）

归一底原取「**本基地内**最大值」，而 `Shipment` 每基地恰好 1 条 ⇒
`popMin`（物料齐套）恒 `1−v/v = 0` → **整层 contribution 全 0**（界面读作"没影响"）；
`popMax`（物流时长）恒 `v/v = 1` → 把**整个基地缺口 9.0076** 都算到一条在途单上。两个方向都错，而**测试全绿**——
因为断言咬的是「树不同 / 能下钻到真对象」，**没有一条咬数值是否退化**。

> 形态：**「我用『树变了且能下钻到真对象』当作『数值算对了』的证据，而前者不度量后者。」**

修法：`popMax`/`popMin` 的归一底改取**全网同字段最大绝对值**（`ratio`/`inverseRatio` 不受影响——
值本身就是 0–1 绝对量）。实测：物料齐套 `0 → 5.4046`（并带出 8 跳 `caused_by` 到 `cf-geopolitical`）；
物流时长 `9.0076 → 7.8817`。新增门 ⑧「数值不退化」逐因子锁死；变异反证：底退回本基地内 → 当场红。

---

## 4 · 《本体引用与影响》

- **对象类型**：`CausalFactor`（+3 个可选解析属性 `baseScopeField`/`drillPick`/`drillNorm`
  + 2 个可选过滤属性 `drillFilterField`/`drillFilterValue`）· 新增 7 个产能域实例（`metricKey="capacity"`）。
  被下钻的真对象类型：`Line` / `Equipment` / `Process` / `Shipment` / `EquipmentDowntime`（均已物化，零新对象类型）。
- **链路**：`风险看板卡 → gap_attribution(scope.baseId[,factorId]) → 根因推演树`。
  本单在该链路上补的是**因子维**：`scope.availableFactors`（引擎下发可细分因子集）
  + `levels[depth=3]`「因子细分」层。
- **事件**：`gap.attributed` 增加 `factorId` / `factorApplied` 两个负载字段（不新增事件名）。
- **不变量**：
  - **R6 确定性**：新增解析全部走「本基地对象按 (pick 字段, 主键) 全序排序取首」，无 rng/时钟；
    base-only 树**逐字节不变**（因子细分只加 depth-3，不动 L1/L2 与 recon）。
  - **R13 可溯源**：每个因子细分叶都带 `provenance{drillType,drillId,drillField,drillValue}`，
    drillId 是**真实对象主键**（`LINE-WS-changzhou-formation` 这种），可点开。
  - **R14 数据驱动**：因子→对象.字段的绑定落在**种子数据**（`CausalFactor` 行）里，不在引擎代码里。
- **断点**：
  - `G-GAP-SCOPE`（base×factor 作用域）此前记为「已闭」——**实测只闭了一半**：入参接住了，
    但产能域没有任何 `CausalFactor` ⇒ 因子维恒不生效。本单补齐数据侧后才真闭。
  - 新登记 `G-CAPFACTOR-VOCAB-SPLIT`：BN 张力词表 vs CausalFactor 词表两套、交集 0。
    机制：`scope.availableFactors` 单源下发 + 契约层 `CausalFactorId` 具名（品牌）类型，
    使「把 BN 因子名当 factorId 传」在**编译期**就红。
- **假绿形态登记**：
  - `G-MOCK-FACTORSCOPE-ECHO`（MSW 桩忽略 factorId 且不回 scope ⇒ mock 模式静默声称"已细分"）。
  - `G-SEAM-FACTOR-TESTARG-DISJOINT`（SEAM 测试用 `化成柜张力`，与生产两套词表**都**不交）。
