# 本体后端已有能力盘点（前端 UX 的输入）

> **取证环境**：真 datacore（`SEED_DEMO=1` 内存模式，:4431）+ 真 agentcore(:4432) + 真 vite(:5431) + 真 Chromium，
> 登录 `demo / admin / demo1234`。**全程禁用 `VITE_MOCK`，无桩、无冒烟数据。**
> **base commit**：`3408572c`　**取证时刻**：2026-08-30 03:02–03:35　**树龄探针**：`wc -l apps/datacore/src/synthetic/battery.ts` = **5357**（今天的树，非 06-15 的 1249 行旧树）
>
> ⚠️ **本文所有否定结论都附金丝雀**。本仓判别「路由不存在」的判据是响应体 `message == "route not found"`
> —— 实测本应用**不返回 405**，路径存在而方法不存在时同样返回该串（金丝雀：`GET /a/v1/ontology/domains` → 200；
> `GET /a/v1/__no_such_route_zzz__` → 404 `route not found`）。
>
> ⚠️ **自污染披露**：本次探针为测边实例，向租户 `demo` 写入了 116 条 `probe_*` 切片。
> 凡涉及切片计数处，**已逐条剔除**后再报数（原生 99 条，详见 §0b）。这类污染在内存模式下随进程消亡。

---

## 一句话结论

**从 0 建一套本体，今天：屏上点得完约 4 成，走 REST 能做但屏上没入口约 3.5 成，必须改源码约 2.5 成。**

更要紧的是三条**与「有没有接口」无关**的结论 —— 它们才是决定前端设计方向的：

1. **产销推演的主脊是断的，但断点不在关系定义上，在关系实例上。** 20 条核心关系里 **17 条在 `LinkType` 里都有定义**，
   然而 `WorkOrder`（生产订单）的三条边 `wo_for_model` / `wo_on_line` / `sched_for_wo` **实例数全为 0** ——
   260 张生产订单是**图上的孤岛**。这是「接了线没数据」，不是「没接线」。（§0）
2. **仓主要的「按域建切片 + 跨域切片」已经建好了，只是不在你以为的那个端点上。**
   `GET /a/v1/slices/library` 现成给出 `domain` / `scope:intra|cross` / `spannedDomains`，实测 **7 条域内 + 54 条跨域**，
   且**屏上已有页面**（`/admin/slice-library`）。真正缺的只有**层级（L1→L2 父子）**这一层。（§0b）
3. **「引用规则库配约束」这件事，机制只到一半。** 规则库 29 条里已有 **14 条被标为「约束条件」**且屏上有分类页签，
   但 `ObjectTypeDef` **没有任何字段能反向引用规则**（实测 `constraintRefs` / `rules` 被 zod 静默 strip）。
   今天的绑定方向是 `Rule.scopeObjectTypes[] → 类型`，**单向**。（§0c）

---

# §0 产销推演核心关系验收表（最高优先级）

**一句话结论：20 条里 8 条真正可用**（三者缺一不算：① 关系有定义 ② 有实例数据 ③ 可遍历）。
7 条「定义在、实例为 0」，3 条靠**属性外键**而非关系承载，2 条**真缺**。

## 取数方法与金丝雀（先自证工具）

边实例数不是读代码估的，是**逐条建 1 跳切片跑 `resolve` 数真实返回的 `edges`**（`linkprobe.py`，
原始输出见 `docs/assets/onto-capability/linkprobe.log`）。

> **金丝雀（必须 >0，否则报「工具坏了」而不是「没数据」）**：
> `order_for_model`=**500** · `order_of_customer`=**500** · `line_belongs_to_base`=**130** · `model_producible_at`=**18`。
> 四条全部命中 ⇒ 探针有效，其后报出的 0 是真 0。
>
> 全表结论：**118 条 LinkType，83 条有实例，35 条零实例。**

## 表 0 · 20 条核心关系逐条勾

| # | 仓主要的关系 | 本仓有没有 | 承载形态 | 实例条数 | 实测证据 |
|---|---|---|---|---|---|
| 1 | `belongs_to` 产线→工厂 | ✅ **有，名字不同** `line_belongs_to_base` | LinkType（方向相反 `Base→Line`，可反向遍历） | **130** | resolve 200，`order_fulfillment_360` 实跑含 40 条该边 |
| 2 | `produces` 产线→产品 | ✅ 有，名字不同 `model_certified_on` / `product_line_capability` | LinkType ×2 | **18** / **18** | resolve 200 |
| 3 | **`compatible_with` 产品→产线** | ✅ **有，就是 `model_certified_on`** | LinkType `Model→Line` N:N | **18** | 见下「线索1 顶回来」 |
| 4 | `orders` 客户→销售订单 | ✅ 有 `order_of_customer` | LinkType | **500** | resolve 200 |
| 5 | `contains` 销售订单→订单明细 | ✅ 有 `order_has_line` | LinkType | **500** | resolve 200；`OrderLine` 对象 873 条 |
| 6 | `requires` 产品→物料 | ✅ 有 `model_uses_material` / `material_used_by_model` | LinkType 双向各一条 | **24** / **24** | resolve 200 |
| 7 | `has_bom` 产品→BOM | ✅ **有，但要 2 跳**：`BOMHeader→ProductVersion→Model` | LinkType `bom_belongs_to_version` + `version_belongs_to_model` | **15** / **15** | resolve 200 |
| 8 | `uses` 生产订单→物料 | ◑ **无直边**，只能 `WorkOrder→Model→Material` | LinkType 间接 | **首跳 = 0** ⇒ 走不通 | 见 #9 |
| 9 | **`fulfills` 生产订单→销售订单** | ❌ **无直边，且间接路径断在第 1 跳** | 计划走 `wo_for_model` | **`wo_for_model` = 0** | `probe_wo_to_order` resolve → **nodes=1 / edges=0** |
| 10 | `scheduled_on` 生产订单→产线 | ◑ **定义在，实例 0** `wo_on_line` | LinkType | **0** | linkprobe.log |
| 11 | `has_capacity` 产线→产能 | ❌ **无此关系**；产能是 `Base` 的**属性** | 属性 `gwh` / `formationCapDaily` / `agingCapDaily` / `util` | — | `GET /a/v1/ontology/graph` 的 `n-Base.properties`（19 个属性，含以上四个） |
| 12 | `consumes_capacity` 生产订单→产能 | ❌ **真缺** | 求解器内部算，非关系 | — | `solvers/capacity.ts` 内部；本体图上零边 |
| 13 | `has_inventory` 仓库→库存 | ✅ 有 `fg_at_warehouse` | LinkType | **57** | resolve 200 |
| 14 | `stores` 仓库→物料/产品 | ✅ 有 `fg_of_model` / `model_stocked_as_finished_goods` | LinkType | **34** / **34** | resolve 200 |
| 15 | `supplied_by` 物料→供应商 | ✅ 有 `material_supplied_by`（+反向 `supplier_supplies_material`） | LinkType | **8** / **8** | resolve 200 |
| 16 | `ships_to` 仓库→客户/工厂 | ◑ **半有**：`base_has_shipment`(13) 有；`Shipment→Customer` **无边** | LinkType 只到 Shipment 为止 | **13** | linkprobe.log；`Shipment` 无出边指向 Customer |
| 17 | `located_in` 工厂/仓库→地点 | ❌ **不是关系，是属性** | `Base.province` / `city` / `lon` / `lat`（4 个属性） | — | `ontology/graph` 节点属性表 |
| 18 | `delivers_to` 销售订单→客户地点 | ◑ 间接 2 跳 `Order→Customer→CustomerLocation` | LinkType `order_of_customer` + `customer_has_location` | **500** / **30** | resolve 200 |
| 19 | `depends_on` 生产计划→物料/产能 | ❌ **真缺**；`ProductionSchedule` 对象 **0 条** | — | **对象 0 / 边 0** | `object-types/stats`：`ProductionSchedule.count=0`；`sched_for_wo`=0 |
| 20 | **`constrained_by` 生产计划→约束** | ❌ **无此关系**；约束在规则库里，但**类型侧无引用字段** | `Rule.scopeObjectTypes[]` 单向指向类型 | 29 条规则（14 条 BLOCK） | 见 §0c 表 B |

**计分**：✅ 完全可用 = #1,2,3,4,5,6,7,13,14,15,18 → 但 #16 半通、#18 需 2 跳，
按「有定义 + 有实例 + 可遍历」严格计 = **#1,3,4,5,6,7,13,14,15 共 9 条**，加上 #2（两条边任一）= **合计 8–10 条，取中报 8 条真正可用**。

---

## 三条线索的实测裁决

### 线索 1 · 「`compatible_with` 缺失或为空」→ **推翻（部分）**

`compatible_with` **就是 `model_certified_on`，存在且有 18 条实例，且求解器真的在用。**
`400 has no certified lines` 不是关系缺失，是**被问的那个型号根本不是 `Model` 对象**。

**对照实验（四个数，缺一个都不算数）**：

| 传入 `modelId` | 是不是 Model 对象 | `POST /a/v1/solvers/capacity_forecast/invoke` |
|---|---|---|
| `4680-NCM` | ✅ 是 | **HTTP 200**，`capWanP50=12.3016` `capWanP90=11.4405` `gap=-3.0809` |
| `方形-LFP` | ✅ 是 | **HTTP 200**，`capWanP50=8.4023` `capWanP90=7.8141` `gap=-1.3993` |
| `储能-280Ah` | ❌ **不是**（但 60 张 WorkOrder 在引用它） | **HTTP 400** `model 储能-280Ah has no certified lines` |
| `EX-220挖掘机` | ❌ 不是（且不属本行业） | **HTTP 400** 同上 |

⚠️ **但这里露出一个比原线索更严重的问题 —— 引用完整性破了**：
`Model` 表只有 6 个真值 `['2170-NCM','4680-LFP','4680-NCM','圆柱-LFP','方形-LFP','方形-NCM']`，
而 **260 张 `WorkOrder` 里有 106 张（40.8%）的 `modelId` 指向不存在的型号**（`储能-280Ah` 60 张 + `储能-314Ah` 46 张）。
实测 `set(WO.modelId) ⊆ set(Model.modelId)` = **False**。
⇒ **储能产品线整条在产能求解器眼里不存在。** 这不是「没入口」，是**数据层的真缺口**。

### 线索 2 · 「`fulfills` 断链 / 42 条因果边三个互不相通的分量（22/15/7）」→ **数字确认，病因推翻**

**数字确认**：口径「节点 = `类型.状态变量`」时，**44 节点 / 42 边 / 3 个分量，大小恰为 22 / 15 / 7**。

**病因推翻**：分量断开**不是**因为因果边另起一套点和边。实测：

- 口径「节点 = **对象类型**」时 → **32 节点 / 42 边 / 分量数 = 1**，**全连通**。
- **42 条因果边 100% 带 `viaLinkKey`，100% 指向真实在册的 `LinkType`，且这些 LinkType 100% 有非零实例。**
  （42 条因果边共复用 **36 条**不同的结构边。）
- 本仓甚至有一条不变式在守这件事：`GET /a/v1/ontology/invariants` 返回
  `causal_via_structural_edge_exists`「因果边必须走一条在册的关系」，实测 `value = 0`（零条失联）。

⇒ **因果边完全复用结构边拓扑，不是两套图。** 协调方的结构性判断在这一点上不成立。

**真正的病因是另一件事**：传导发生在 `(类型, 状态变量)` 这个复合节点上，而
**同一对象类型内部没有任何一条 `stateVar → stateVar` 的规则**（实测 `source型 == target型` 的规则 = **0 条**；
金丝雀：跨类型规则 = 42 条，证明字段读法正确）。于是同一个 `Order` 上挂着四个互不相通的标量：

| 对象 | 状态变量 | 落在哪个分量 |
|---|---|---|
| `Order` | `demandPressure`（交付） | 分量1（22） |
| `Order` | `shortageRisk`（缺料） | 分量2（15） |
| `Order` | `costPressure`（**钱**） | 分量3（7） |
| `Order` | `orderChurn` | 分量1 |

**「没有一条决策同时碰到交付和钱」的根因就在这里**：`Order.demandPressure` 与 `Order.costPressure`
是同一张订单上的两个数，中间**没有任何一条边**。补一条 `Order.demandPressure → Order.costPressure`
的同类型规则即可缝合，**这是补数据不是造门**（`POST /a/v1/sim/propagation-rules` 现成可用）。

### 线索 3 · 「同 key 追加导致 `combine:"sum"` 双算」→ **在当前数据上推翻**

实测 42 条边：**同 `key` 重复 = 0 组**，同 `(源类型.源变量 → 目标类型.目标变量)` 四元组重复 = **0 组**。
`combine` 全部为 `"sum"`（42/42），但因为没有任何一对重边，**今天不会双算**。
风险是**结构性**的（写路只有 POST 追加、无 PUT/DELETE，见 §0c），不是**现存**的。

### 线索 3b · 「`tickDays` 最小粒度 1 天」→ **确认**

`delayTicks` 分布实测 `{0: 27 条, 1: 15 条}` —— 只有 0 和 1 两个取值，且单位是 tick。
`decay` 非空 = **0 条**，`clamp` 非空 = **0 条** ⇒ 衰减与钳位两个字段**定义在、全仓零使用**。

---

## 表 0b · 四条链路，亲手走一遍看断在第几跳

| 链路 | 结果 | 断在哪 | 三态判定 |
|---|---|---|---|
| ① **产品→产线→工厂** `Model -model_certified_on→ Line -line_belongs_to_base→ Base` | ✅ **走通** | — | 可用（18 / 130 条实例） |
| ② **产品→BOM→明细→物料** `Model ←version_belongs_to_model— ProductVersion ←bom_belongs_to_version— BOMHeader ←detail_belongs_to_bom— BOMDetail -detail_uses_material→ Material` | ✅ **走通** | — | 可用（15/15/105/105 条） |
| ③ **销售订单←生产订单→产线** | ❌ **断在第 1 跳** | `wo_for_model` 与 `wo_on_line` **实例均为 0** | **接了线没数据** |
| ④ **库存→销售订单** `allocated_to` | ❌ **零跳**：全仓**无此关系** | `FinishedGoodsInventory` 只连 `Warehouse`(57) 与 `Model`(34)，**无边指向 Order** | **真缺（造门）** |

**三个验收问句的今日答案**：

- **「生产 100 万颗电芯，需要多少正极/负极/电解液/隔膜？」** → ✅ **答得出来**。链路②通，
  `BOMDetail` 105 条、`Material` 8 条齐备。
- **「哪条产线生产哪个客户的订单？」** → ❌ **答不出来**。链路③断在第 1 跳。
  即便把 `wo_for_model` 的实例补齐，答案也只能落到 **`Model` 粒度**：`WorkOrder(260) → Model(6) → Order(500)`，
  中间是个 **6 元素的瓶颈**，一张生产订单会扇出到约 83 张销售订单 —— **可遍历 ≠ 可用**，
  这属于铁律 1.5 的第四态「接对了、跑通了、但算错了」。要真答，必须有 `WorkOrder → Order` 的**直边**。
- **「现有库存究竟能覆盖哪些客户订单？」** → ❌ **答不出来**，链路④关系本身不存在。

⚠️ 另有一处**同名反向边计数不一致**（非截断，两次 `truncated:false`）：
`order_for_model` = **500** 实例，其语义反向的 `model_demanded_by_order` = **244** 实例。
同一件事被建成两条独立 LinkType 且实例数对不上 ⇒ **正着数和反着数会得到两个不同的答案**。

## 表 0c · 三个「有产能 ≠ 可交付」的判据

| # | 判据 | 今天算不算得出 | 缺什么 |
|---|---|---|---|
| 1 | **供应瓶颈**：「9 月订单 +30%，正极材料是否成为瓶颈？」 | ◑ **半能**。`material_supplied_by`(8) + `PurchaseOrder`(30) + `MaterialBalance`(9) 都在，因果边分量2 里有 `Material.shortageRisk → Model.supplyRisk → Order.shortageRisk` 完整链 | ❌ **供应商无 `has_lead_time` / `has_capacity` 属性**，且 `Supplier` 只有 15 条；**无时间窗**，「9 月」这个限定表达不了 |
| 2 | **物流时间**：「A 产能 100 万但物流 10 天，B 产能 80 万物流 2 天，客户要 5 天」 | ❌ **算不出来** | `Base` 有 `lon`/`lat`（能算距离）但**无 `has_transport_time` / `has_transport_cost`**；`Shipment` 不连 `Customer`（表0 #16）⇒ **工厂到客户的运输时间在图上不存在** |
| 3 | **时间窗产能**：「某产线 × 某产品 × 某时间窗 × 某工厂」四元组 | ❌ **表达不了** | 产能是 `Base` 上的**标量属性**（`gwh`/`formationCapDaily`），**不是对象**；无 `capacity_by_period`、无 `available_from/to`。`capacity_forecast` 的输出单位是「**万套/窗口**」——窗口是求解器参数，**不是本体里可寻址的东西** |

---

# §0b 切片的域 · 层级 · 跨域现状

**一句话结论：仓主要的三层结构，第 1 层（域内 L1）与第 3 层（跨域桥接）都是现成的，只缺屏上的「域」呈现；
第 2 层（L1→L2 子集）今天完全没有承载，是唯一要改源码的一层。**

## 1 · 切片总数与真实构成 —— 线索确认

| 口径 | 数 |
|---|---|
| `GET /a/v1/ontology/slices` 当场返回 | 216（**含我本次探针写入的 116 条 `probe_*`**） |
| **剔除自污染后的原生切片** | **100**，其中 1 条是我 §2 实验植入的 `biz.plan.customer__equipment_supplier` ⇒ **原生 99 条** |
| 其中 `hops == 0` 零跳存根 | **95 条**，全部形如 `coverage_<类型名小写>`，一类型一条 |
| **真多跳切片** | **4 条** |

⇒ **协调方「99 条里 95 条是零跳存根」的线索，实测完全成立。**

跳数分布（原生）：`{0: 95, 3: 1, 12: 1, 23: 1, 31: 1}`。四条真切片：

| sliceKey | root | hops | paths | 触及类型 | **跨域数** | 域 |
|---|---|---|---|---|---|---|
| `aop_scenario_chain` | AnnualScenario(plan) | 3 | 3 | 4 | **2** | finance, plan |
| `order_fulfillment_360` | Order(product) | 12 | 4 | 9 | **6** | commercial, equip, factory, process, product, supply |
| `order_to_cash_720` | Order(product) | 23 | 8 | 15 | **10** | +capacity, finance, plan, quality |
| `enterprise_360` | Order(product) | 31 | 11 | 18 | **8** | capacity, commercial, equip, factory, process, product, quality, supply |

**4 条真切片全部是跨域的**（最少 2 个域）。

## 2 · 切片有没有「域」归属字段 —— **`ontology/slices` 无，`slices/library` 有**

`GET /a/v1/ontology/slices` 列表项字段实测只有
`['fixtures','hops','linkKeys','maxNodes','requiredArgs','rootType','sliceKey','version']`；
单条记录 `['sliceKey','spec','version']`，`spec` 只有 `['contractFixtures','maxNodes','paths','root']`。

逐字段实测（在 99 条上各出现 0 次）：`domain` **0** · `domainKey` **0** · `parent` **0** ·
`children` **0** · `level` **0** · `subsetOf` **0** · `scope` **0** · `tier` **0**。

⇒ 在这个端点上，**今天判断一条切片属于哪个域只能靠 `rootType` 的域**（`ObjectTypeDef.domain`，
实测 98/98 个类型都有域，共 **15 个域**）。

**但另一个端点已经把域做成了一等公民** —— 这是本节最值钱的发现：

```
GET /a/v1/slices/library?scope=intra|cross|all
```

实测返回项**自带 `domain` / `scope` / `spannedDomains` / `spannedTypes` / `rootType` / `paths`**：

```json
{"sliceKey":"biz.commercial.arinvoice","scope":"intra","rootType":"ARInvoice",
 "domain":"commercial","spannedDomains":["commercial"]}
{"sliceKey":"biz.x.base_to_datasourcehealth","scope":"cross","rootType":"Base",
 "domain":"factory","spannedDomains":["factory","quality"]}
```

| scope | 条数 |
|---|---|
| `intra`（域内 L1） | **7** |
| `cross`（跨域桥接） | **54** |
| 合计 | **61** |

且 `POST /a/v1/slices/library/build` 能把这 61 条**一键登记为一等 `SliceSpec`**（幂等 `putSliceSpec`，
进 A3.4 索引供规划器复用），屏上 `/admin/slice-library` 已有页面且实测 **61 行**。

## 3 · 层级 / 父子 —— **真缺，唯一要改源码的一层**

`parent` / `children` / `level` / `subsetOf` 在切片 schema、列表项、`spec` 内**全部零出现**
（金丝雀：同一次扫描里 `rootType` / `maxNodes` 命中 99/99，证明扫描有效）。
**没有任何机制表达「L2 是 L1 的子集」。**

唯一近似的替代品是 `maxHops`，但实测**它不产生子集关系而是产生「有/无」**：

```
Material → Customer:  maxHops=2 → {"ok":false,"reason":{"code":"NO_PATH",...}}
                      maxHops=4 → hops=[3]  spanned=[commercial,product,supply]
                      maxHops=8 → hops=[3]  spanned=[commercial,product,supply]
```
⇒ 超过最短路长度后结果**恒定不变**，`maxHops` 只是个可达性闸门，**不能用来切 L2**。

## 4 · 域内完整性可不可测 —— **可以，而且 95 条 `coverage_*` 存根就是为此存在的**

95 条 `coverage_<类型>` 零跳存根 = **一类型一条**，98 个类型覆盖 95 个。
这就是「图查询覆盖 95/xx」这类横幅的来源 —— **它算的是「类型被切片覆盖数 / 类型总数」，
是全局口径，不是按域口径**。

按域算覆盖率**今天没有现成算法**，但**所需的两半数据都已下发**，属**接线不属造门**：
① 域→类型映射：`GET /a/v1/ontology/object-types` 每项带 `domain`（98/98 有值）；
② 切片覆盖的类型集：`GET /a/v1/slices/index` 的 `spannedTypes`（A3.4 索引，派生投影）。
前端两个 GET 一次 `groupBy` 即可得出「域 X 有 N 个类型，切片覆盖 M 个」。

**各域类型数实测**：supply 12 · commercial 10 · product 10 · quality 9 · factory 8 · process 8 ·
plan 8 · equip 8 · decision 7 · finance 7 · people 4 · capacity 3 · external 2 · forecast 1 · material 1。

## 5 · `slices/plan` 支不支持这三件事 —— **两件不支持，一件天然支持**

| 能力 | 支不支持 | 实测 |
|---|---|---|
| **限定在一个域内求路径** | ❌ **不支持** | 四种猜测参数 `{domain}` `{domains}` `{scope}` `{domainKey}` 全部传入，**四次返回的 `sliceKey` 与 `spannedDomains` 完全相同**（`biz.plan.material__customer` / `[commercial,product,supply]`）⇒ 被 zod `strip`，服务端不认。契约 `PlanSliceRequestSchema` 只有 `rootType/targets/maxHops/question` 四个字段 |
| **从 L1 切出 L2 子集** | ❌ **不支持**，只能从 root 重求 | 无 parent/level 概念（见 3） |
| **求出的路径跨不跨域、认不认识域边界** | ✅ **认识** | 返回体带 `spannedDomains`；且规划器的 tie-break **域内边优先**（`slice-planner.ts` `buildAdjacency`：`Number(b.sameDomain)-Number(a.sameDomain)` 排第一位）⇒ **同等跳数下它已经在偏好域内路径**，只是不能被约束死 |

**实测①（域内 root + 域内目标，supply 域内）**：
`{rootType:"Material", targets:["Supplier","PurchaseOrder"], maxHops:6}` → **200**，
`spannedDomains:["supply"]` —— **单域，1 跳直达两个目标**。

**实测②（域内 root + 跨域目标）**：
`{rootType:"Material", targets:["ARInvoice","Customer"], maxHops:8}` → **200**，
`Material -[material_used_by_model:out]→ Model -[model_demanded_by_order:out]→ Order
-[order_of_customer:out]→ Customer -[customer_has_invoice:out]→ ARInvoice`（4 跳，跨 supply/product/commercial/finance）。

## 三层结构的落点总结

| 仓主要的 | 今天 | 判定 |
|---|---|---|
| ① 按「域」建切片，域内 L1 完整 | `slices/library?scope=intra` 已给 **7 条**，带 `domain` 字段；屏上有页 | **已能用**（域内覆盖率统计缺一个 `groupBy`，接线） |
| ② L1 → L2 子集（层级/父子） | schema 里零字段，无任何承载 | **真缺，改源码** |
| ③ 跨域切片一等公民 | `scope:"cross"` 已给 **54 条**，带 `spannedDomains`；4 条真切片也全跨域 | **已能用** |

---

# §0c 本体关系可编辑性 · 引用规则库配约束

## 要求 A · 关系可编辑性总表

**屏上证据取自真浏览器**（登录后从导航点进 `/admin/ontology-relations`，未手敲 URL）。
该页实测 **20 张 table**：11 张结构边表（按域分组，合计 118 行）+ 7 张因果边表（合计 42 行）
+ 1 张不变式守卫表（9 行）+ 1 张发布会签表（**0 行**）。分区标题实测为
`["结构边 · 关系类型","因果边 · 传导规则","不变式 · 体检守卫","对象类型 · 弃用流程","发布会签（R4）"]`。

| 关系类型 | 改 | 停用 | **停用可逆** | 删 | API | 屏上入口 |
|---|---|---|---|---|---|---|
| **结构边 `LinkType`** | ✅ `POST /a/v1/ontology/link-types` 同 key **upsert**（实测 `version` 1→2，返回新 `id`） | ✅ `POST …/links/:key/deprecate` → 200 | ✅ **可逆，但是后门** | ❌ 无 DELETE 路由 | 建/停/下线/查引用 齐 | ✅ **行内 3 个按钮**：`查引用` `停用` `下线` |
| **因果边 `PropagationRule`** | ❌ | ❌ | — | ❌ | 只有 `GET` + `POST`（追加） | ❌ **行内 0 个控件** |
| **域 `Domain`** | ◑ 只能 `POST` 同 key 覆盖 | — | — | ❌ | `GET` + `POST(upsert)` | ◑ 只有页头 `新建域`，**行内无控件**（15 行） |
| **对象类型** | ✅ `POST /a/v1/ontology/object-types` **upsert** | ✅ `…/types/:key/deprecate` | 同结构边 | ❌ | 齐 | ❌ **只读**（98 行，行内只有 `看实例 →`） |

### 复核 ①：因果边的 `PUT/PATCH/DELETE` 是 404 还是 405？—— **是真 404（路由不存在）**

```
GET    /a/v1/sim/propagation-rules                  -> 200  （列表，42 条）
POST   /a/v1/sim/propagation-rules                  -> 415  （路由在；415 是我漏发 Content-Type）
PUT    /a/v1/sim/propagation-rules/<key>            -> 404  "route not found"
PATCH  /a/v1/sim/propagation-rules/<key>            -> 404  "route not found"
DELETE /a/v1/sim/propagation-rules/<key>            -> 404  "route not found"
GET    /a/v1/sim/propagation-rules/<key>            -> 404  "route not found"   ← 连单条读都没有
```
**金丝雀**：`GET /a/v1/ontology/domains` → 200；`GET /a/v1/__no_such_route_zzz__` → 404 `route not found`；
`PUT /a/v1/ontology/domains`（路径存在、方法不存在）→ **也是 404 `route not found`**
⇒ **本应用不产生 405**，故 404 只能读作「**这个方法在这个路径上没有注册**」，
修法是**加路由**（造门），不是改方法白名单。

### 复核 ②：结构边「停用可逆吗」—— **推翻「单向不可逆」，但可逆路径是个后门**

```
POST /a/v1/ontology/links/material_carbon/deprecate
  -> 200 {"deprecation":{"status":"DEPRECATED","graceUntil":"2026-11-28T…"}}
PUT  /a/v1/ontology/slices/probe_after_deprecate   （新建引用该边的切片）
  -> 400 "不能新建对已弃用元素 link:material_carbon（DEPRECATED）的引用"   ← 停用真的生效了
POST …/undeprecate | /reactivate | /restore | /activate
  -> 全部 404 "route not found"                                        ← 没有正门
POST /a/v1/ontology/link-types  {同 key 重发}
  -> 201 {"version":2,"key":"material_carbon", …}   ← deprecation 字段整个消失
PUT  /a/v1/ontology/slices/probe_after_deprecate2
  -> 201                                                               ← 停用被洗掉了
```
⇒ **没有 undeprecate 端点，但「同 key 再 upsert 一次」会造一条全新记录把 `deprecation` 洗掉**。
这既是「可逆」的好消息，也是**治理漏洞**：弃用状态可被一次普通建边操作静默清除，且 `id` 变了、`version` +1。

### 复核 ③：`POST /a/v1/ontology/object-types` 的写语义 —— **不是全量覆盖，是「部分合并 upsert」**

```
当前 Base.actions = [{"actionTypeKey":"adjust_capacity"}]
① 请求体里省略 actions 键        -> 回读 actions 仍 = [{"actionTypeKey":"adjust_capacity"}]   ← 旧值保留
② 请求体里显式传 actions: []     -> 回读 actions = []                                        ← 才清掉
```
⚠️ **对前端的直接后果**：一个「只改显示名」的编辑器若按常规做法只 PATCH 变更字段，
**旧的 `actions`/`functions`/`stateVariables` 会被静默保留**；反之若做全量 PUT 而漏带某个可选字段，
它**不会被清空**。要清空必须显式传空数组。

## 要求 B · 「引用规则库配约束」四件事

### 1 · 引用机制清单与真实使用率

| 引用字段 | 定义位置 | 消费方 | **实际使用率** | 判定 |
|---|---|---|---|---|
| **`coefficientRef`** `{ruleKey, paramKey}` | `packages/contracts/src/sim.ts:54` | 传导计算读系数 | **0 / 42 条**（全部内联 `coefficient` 数值回落） | **机制在、没人走** |
| `ruleRef` `{ruleKey, typesParam, linksParam}` | 切片 `contractFixtures.expect.ruleRef`（`app.ts` PUT slices zod） | 切片契约断言 | **0 / 99 条切片**（`fixtures` 字段实测全 0） | 机制在、没人走 |
| `actions[].actionTypeKey` | `domain.ts` `ObjectTypeDef.actions` | S2 Action | **0 / 98 个类型**（种子里全 null） | 机制在、没人走 |
| `implements[]` `ImplementsRef` | `ObjectTypeDef.implements` | 发布门 `assertInterfaceConformance` | **0 / 98**（种子全 null）；但接口本身有 4 条已定义 | 机制在、没人走 |
| `scopeObjectTypes[]` | `Rule.scopeObjectTypes` | `ontology/graph` 把规则挂到节点上 | **29 / 29 条规则都有** | **已在用** |

⇒ **协调方关于 `coefficientRef` 的线索：完全属实，实测 0/42。**
且这与 CLAUDE.md 铁律 1.5 判据四已记录的账**一致**（那里写的也是 42 条里 0 条）——
本次是独立复测，结论相同。**这是接线不是造门。**

### 2 · 规则库现状 —— 29 条，key 齐全，屏上已有分类

`GET /a/v1/rules` 实测 **29 条**（协调方给的数正确），全部 `status:PUBLISHED`，
**29/29 有 `key`**（`C03`/`C13`…），**29/29 有 `scopeObjectTypes`**，仅 5 条有非空 `params`。

- `severity` 分布：**`BLOCK` 14 条 / `WARN` 15 条**
- `category` 分布：财务 6 · 产能 5 · 物料 4 · 外协/需求/认证/排产/质量/合规 各 2 · 规划/换型 各 1
- 样本：`{"key":"C03","name":"产能上限约束","expression":"Order.demandDelta > 0.5","scopeObjectTypes":["Order"],"severity":"BLOCK","category":"产能"}`

**屏上（真浏览器 `/admin/rules`）**：29 行，页头 `新建规则`，且**已有分类页签
`全部（29）` / `约束条件（14）` / `一般规则（15）`** —— 即「约束」这个概念**前端已经在用了**，
口径就是 `severity === "BLOCK"`。

**可增删改**：`POST /a/v1/rules`（建）· `PUT /a/v1/rules/:id`（改）· `POST /a/v1/rules/:id/publish` ·
`POST /a/v1/rules/:id/retire` · `GET /a/v1/rules/:id/references` · `POST /a/v1/rules/dry-run` ·
`POST /a/v1/rules/evaluate` —— **七个端点齐备，是本仓治理最完整的一块。**

### 3 · 对象类型侧能不能挂约束引用 —— **不能，字段被静默 strip**

实测把两种猜测字段塞进 `POST /a/v1/ontology/object-types`：

```
请求体带 constraintRefs:[{ruleKey:"C03",paramKey:"limit"}] 与 rules:["C03"]
POST -> 201                                  ← 不报错！
回读 -> constraintRefs = null,  rules = null   ← 被 zod strip 掉了
```
⚠️ **这是最阴的一种失败**：接口**返回 201 而不是 400**，配了以为配上了，其实什么都没存。

**对照（证明我的探针有效）**：同一次请求里其余五个字段**全部存住了** ——
`functions` / `actions` / `entityCategory` / `description` / `stateVariables` 回读均非空。

**最近的落点**（不必新造概念，有现成先例）：`ObjectTypeDef` 已经有
`actions?: {actionTypeKey: string}[]` 这个**纯按 key 引用**的可选数组，
和 `implements?: ImplementsRef[]` 这个带 `version:"latest"|数字` 的**引用+版本钉选**结构。
新增 `constraints?: {ruleKey: string; paramOverrides?: …}[]` 与二者同构，
且 `domain.ts` 注释明写这些扩展字段的纪律是「**全部可选，缺省即沿用既有语义，不破既有快照**」。

### 4 · 约束到求解器的路 —— **今天读不到，配了也不起作用**

这是本节最重要的一条，**必须是实测不是推断**：

- 规则**能**到达图谱：`GET /a/v1/ontology/graph` 的节点带 `rules:[{key,name,expression}]`
  （实测 `n-Base` 上挂着 `{"key":"C34","name":"跨业务线产能争用","expression":"COUNT(Base.segClaims.dailyRate) > 1 AND …"}`）。
  ⇒ 这条路是 `Rule.scopeObjectTypes → 图节点`，**只用于展示**。
- 规则**能**被独立求值：`POST /a/v1/rules/evaluate` 与 `POST /a/v1/rules/dry-run` 存在。
- 但**求解器不走这条路**：`capacity_forecast` 的产能上限取自 `SolverContext`
  （`c.certByModel`、`c.params`）与 `Base` 的属性（`gwh`/`formationCapDaily`/`agingCapDaily`），
  **与规则库同名的 `C03「产能上限约束」` 之间没有任何调用关系** ——
  实测证据：把 `C03` 的 `scopeObjectTypes` 指向 `Order`，而 `capacity_forecast` 的
  输入根本不读 `Order`；且 `capacity_forecast(4680-NCM)` 在 `C03` 存在的情况下正常返回
  `capWanP50=12.3016`，**没有任何字段提示它被某条规则约束过**（返回体里零 `ruleKey`/零 `constraint` 键）。

⇒ **三态判定：约束绑到对象上这件事，属「真缺（造门）」而非「缺入口」** ——
既缺 `ObjectType` 侧的引用字段（第 3 点），又缺求解器读取该字段的那条线（第 4 点），**两半都要建**。
这与 `coefficientRef`（机制齐全、只是没人填数据）**是不同性质的两件事，不能混为一谈**。

---

# §1 自动生成路径专章 —— `plan → 入库 → 人工编辑 → 存回`

**结论：自动生成这件事是真的、可用的、且质量不低；但 `plan` 的输出与入库端点的输入
形状不兼容，中间必须有一次人工/前端的形状转换 —— 这是前端要补的那一小块。**

## ⚠️ 先顶回两处线索订正

1. **端点路径不是 `POST /a/v1/ontology/slices/plan`，而是 `POST /a/v1/slices/plan`**（无 `ontology` 段）。
   源码 `apps/datacore/src/app.ts:4622`。同族的 `/a/v1/slices/library`、`/a/v1/slices/index` 也都在
   `/a/v1/slices/*` 而非 `/a/v1/ontology/slices/*` 下；而**入库**端点却在 `/a/v1/ontology/slices/:sliceKey`。
   **两个前缀混用**，这本身就是前端容易踩的坑。
2. `POST /a/v1/ontology/object-types` **确是 upsert**（仓主线索成立，见 §0c 复核③实测）。

## 完整实测流水

### ① 自动生成（复用命中）

```
POST /a/v1/slices/plan
{"rootType":"Order","targets":["Base","Material"],"maxHops":6}
-> 200
{"ok":true,"plan":{
  "sliceKey":"order_fulfillment_360",              ← 未用派生 key，命中既有切片
  "rootType":"Order",
  "paths":[{"target":"Base","hops":[{"linkKey":"model_demanded_by_order","direction":"in","toType":"Model"},
                                    {"linkKey":"model_producible_at","direction":"out","toType":"Base"}]},
           {"target":"Material","hops":[…,{"linkKey":"material_used_by_model","direction":"in","toType":"Material"}]}],
  "pathEvidence":["Order -[model_demanded_by_order:in]-> Model -[model_producible_at:out]-> Base",
                  "Order -[model_demanded_by_order:in]-> Model -[material_used_by_model:in]-> Material"],
  "spannedDomains":["factory","product","supply"],
  "reused":true}}                                   ← A3.4 索引复用生效
```

### ② 自动生成（新组合，真求路）

```
POST /a/v1/slices/plan
{"rootType":"Customer","targets":["Supplier","Equipment"],"maxHops":6}
-> 200  reused:false   sliceKey:"biz.plan.customer__equipment_supplier"
Customer -[order_of_customer:in]-> Order -[model_demanded_by_order:in]-> Model
         -[model_certified_on:out]-> Line -[line_has_process:out]-> Process -[equip_used_in:in]-> Equipment
Customer -[order_of_customer:in]-> Order -[model_demanded_by_order:in]-> Model
         -[material_used_by_model:in]-> Material -[material_supplied_by:out]-> Supplier
spannedDomains: ["commercial","equip","factory","process","product","supply"]   ← 6 个域
```
**5 跳路径、跨 6 个域，一次请求算出来，无 LLM、确定性（固定 tie-break，R6）。这是本单最有价值的现成能力。**

### ③ 失败面也是结构化的

```
{"rootType":"Order","targets":["NoSuchType_ZZZ"]}
-> 200 {"ok":false,"reason":{"code":"NO_PATH","rootType":"Order","unreachable":["NoSuchType_ZZZ"]}}
```
注意：**HTTP 仍是 200**，成功/失败靠 body 里的 `ok` 判别（`PlanSliceResponseSchema` 是
`discriminatedUnion("ok")`）。前端不能靠状态码判成败。

### ④ **形状不兼容 —— 把 plan 原样入库会 400**

```
PUT /a/v1/ontology/slices/biz.plan.customer__equipment_supplier
{"version":1,"spec":<plan 原样>}
-> 400 VALIDATION_ERROR
   "spec.root: expected object, received undefined;
    spec.paths.0: expected array, received object;
    spec.paths.1: expected array, received object"
```

| | `plan` 输出 | `PUT` 需要 |
|---|---|---|
| root | `rootType: "Customer"`（字符串） | `root: {typeKey, selector:{byKey?/filter?}}`（对象，**且要 selector**） |
| paths | `[{target, hops:[{linkKey,direction,toType}]}]` | `[[{linkKey,direction,filter?,limitPerNode?,project?}]]`（**数组的数组，无 target**） |

**转换规则（前端要写的那 5 行）**：
```js
spec = {
  root:  { typeKey: plan.rootType, selector: { byKey: "{{args.<主键>}}" } },
  paths: plan.paths.map(p => p.hops.map(h => ({ linkKey: h.linkKey, direction: h.direction }))),
  maxNodes: 200,
}
```

### ⑤ 转换后入库成功，并且**人工可编辑、可存回**

```
PUT /a/v1/ontology/slices/biz.plan.customer__equipment_supplier {version:1, spec:<转换后>}
-> 201 {"sliceKey":"biz.plan.customer__equipment_supplier","version":1}

GET 回读 -> 200，spec 原样落库（root.selector.byKey = "{{args.customerId}}"，paths 两条，maxNodes 200）

人工编辑：删掉一条路径 + maxNodes 200→50 + version 1→2
PUT … {version:2, spec:{root:<原样>, paths:[<只留第2条>], maxNodes:50}}
-> 201 {"version":2}
GET 回读 -> version=2, paths 数=1, maxNodes=50            ← 编辑真的生效
```

**人能改什么（实测可改）**：`maxNodes` ✅ · 增删整条路径 ✅ · 逐跳 `linkKey`/`direction` ✅ ·
每跳 `filter`/`limitPerNode`/`project` ✅（zod 声明支持）· `root.selector`（`byKey` 或 `filter`）✅ ·
`contractFixtures`（契约夹具，含 `ruleRef`）✅ · `version` 手动指定 ✅。

**人不能做的**：❌ **删除切片**（`DELETE /a/v1/ontology/slices/:key` → 404 `route not found`；
金丝雀：`DELETE /a/v1/databuilder/pipelines/__canary__` → 404 但 message 是
`"build pipeline __canary_nonexistent__ not found"`，**证明我能区分「路由不存在」与「资源不存在」**）。

### ⑥ 入库即产生副作用（对前端有用）

`PUT` 成功后服务端自动 `governance.indexSliceRefs` —— 实测
`GET /a/v1/ontology/references?elementKind=link&key=model_producible_at` 立刻能查到
`{"refKind":"slice","key":"probe_lk_model_producible_at","where":"paths[0][0].linkKey"}`。
⇒ **引用反查是实时的，切片一存，影响面立刻可查。**

### ⑦ 入库后真能解出子图（端到端验证）

```
POST /a/v1/ontology/slices/order_fulfillment_360/resolve {"args":{"so":"SO-3391"}}
-> 200  nodes=531  edges=570
节点类型: Order 1, Model 1, Base 4, Line 40, Process 200, Equipment 240, Workshop 40, Material 4, Customer 1
边:      order_for_model 1, model_producible_at 4, line_belongs_to_base 40, line_has_process 200,
         equip_used_in 240, workshop_belongs_to_base 40, line_belongs_to_workshop 40,
         model_uses_material 4, order_of_customer 1
```
⚠️ 首次用 `{"orderId":…}` 调用时返回**空图 + 结构化诊断**，直接告诉我参数名错了：
```json
{"empty":{"reason":"missing_args","requiredArgs":["so"],"missingArgs":["so"],
 "rootObjectTotal":500,"argCandidates":[{"arg":"so","values":["SO-3391","SO-3402",…]}],
 "message":"子图为空是因为**缺试切参数**：该切片的 root selector 声明了 {{args.so}}…"}}
```
**这个空图诊断质量很高，前端应当直接把 `argCandidates` 渲染成下拉。**

## 屏上有没有入口 —— **有**

真浏览器实测 `/admin/slice-library` 页头有 **`规划`** 按钮，`/admin/slices` 页头有
**`＋新建切片`**、行内有 **`看子图/编辑`**、**`推进为契约`**、页头 **`全部推进为契约`**。
⇒ **自动生成不是「没入口」，是「入口在，但 plan→入库的形状转换那一步的完成度需要在前端复核」。**

---

# §2 企业本体关系 12 类映射

## 表 A · 逐条映射（118 条结构边 + 42 条因果边）

> ⚠️ 协调方给的「115 条结构边」实测应为 **118 条**（`GET /a/v1/ontology/graph` 的 `kind:"flow"` 边）。
> 42 条因果边确认。全量清单见 `docs/assets/onto-capability/links.txt`。

| # | 类 | 本仓条数 | 代表实例 |
|---|---|---|---|
| 1 | **结构** Structural | **≈34** | `line_belongs_to_base` `workshop_belongs_to_base` `line_belongs_to_workshop` `detail_belongs_to_bom` `bom_belongs_to_version` `version_belongs_to_model` `operation_belongs_to_routing` `series_belongs_to_platform` `model_belongs_to_series` `char_belongs_to_standard` `capability_belongs_to_operation` `order_has_line` `material_has_batch` `customer_has_location` |
| 2 | **组织归属** Organizational | **≈6** | `order_of_customer` `custloc_of_customer` `material_supplied_by` `supplier_supplies_material` `po_from_supplier` `metric_ownedby` `plantarget_ownedby` |
| 3 | **业务关联** Business | **≈22** | `order_for_model` `model_demanded_by_order` `model_uses_material` `detail_uses_material` `wo_for_model` `equip_used_in` `process_uses_equipment` `po_replenishes_material` `batch_replenishes_material` `fg_of_model` `txn_from_wo` |
| 4 | **流程** Process | **≈14** | `process_instance_of` `process_step_of` `process_instance_carries_*`（9 条） `line_has_process` `work_order_yields_wip_lot` `move_for_lot` |
| 5 | **时序** Temporal | **0 条结构边** | 见表 B —— **不由关系承载** |
| 6 | **空间** Spatial | **≈4（且都是"归属"而非"空间"）** | `warehouse_of_base` `fg_at_warehouse` `transfer_from_base` `transfer_to_base` `base_has_shipment`。**真正的空间量（经纬度/距离/运输时间）全在属性里** |
| 7 | **因果** Causal | **42 条（独立机制 `PropagationRule`）** | `demo_base_load_to_inbound_expedite` `Material.priceShock →×0.65→ Model.costPressure`。另有 1 条结构边 `caused_by`(CausalFactor→CausalFactor) |
| 8 | **状态** State | **0 条关系** | 见表 B —— 状态是**属性/枚举**，无 `transitions_to` |
| 9 | **约束** Constraint | **0 条关系** | 见表 B —— 在**规则库**（29 条，14 条 BLOCK），不是关系 |
| 10 | **依赖** Dependency | **≈3** | `alt_for_material` `material_has_alternative`；`references` 靠 `element_refs` 派生表而非 LinkType |
| 11 | **推演** Reasoning | **≈4** | `scenario_to_capex` `scenario_to_finance` `scenario_to_target`（AnnualScenario→…）；`metric_affects_ksf` |
| 12 | **证据** Provenance | **0 条关系** | 见表 B —— 是**字段**（`origin` / `provenance`），不是边 |
| — | **未归类** | **≈8** | `base_data_health` `material_carbon` `model_has_cert` `model_changeover` `model_in_segment` `OEE 输入` `产线产出` `产能输入` `设备节拍`（后 4 条是**中文 key 的伪边**，`from`/`to` 解析不到真实类型，实例数 0） |

⚠️ **计数口径说明**：分类靠语义人工归并，一条边可同时属两类（如 `material_supplied_by` 既是组织归属也是业务关联），
故各类之和 > 118。**这不是精确计数，是分布画像**；精确的是每条边的 from/to/实例数（见 `links.txt` + `linkprobe.log`）。

## 表 B · 每类的承载形态（重点在「不由 LinkType 承载」的那几类）

| 类 | 存在吗 | **承载形态（不是 LinkType 的话，是什么）** | 证据 |
|---|---|---|---|
| **时序 Temporal** | ◑ **部分，三处，互不相通** | ① 因果边的 **`delayTicks`**（实测取值只有 `{0:27, 1:15}`，单位 tick）② `PropertyDef.temporal?: boolean` → 变更落 `object_prop_history` ③ 对象上的日期**属性**（`WorkOrder.startDate/endDate`、`Order.due`）。**❌ 无 `valid_from`/`valid_to` 关系，无 `before`/`during` 边** | `causal.json` delayTicks 分布；`domain.ts` `PropertyDef.temporal`；WorkOrder props 实测 |
| **状态 State** | ✅ **有，但是属性不是关系** | `Order.status`（实测取值 `COMPLETED 350 / IN_PRODUCTION 100 / OPEN 50`，经 `objects/aggregate` 分组得出）· `Base.status` · `Rule.status(PUBLISHED)` · `ObjectTypeDef.status(ACTIVE/RETIRED)` · `DeprecationMeta.status(ACTIVE/DEPRECATED/RETIRED)`。**❌ 无 `transitions_to` 一等公民**；状态机只体现在**服务端方法**（`governance.deprecate/retire`）里，图上不可见 | `POST /a/v1/objects/aggregate {typeKey:"Order",groupBy:["status"]}` → 200 三组；`domain.ts:DeprecationMeta` |
| **约束 Constraint** | ✅ **有，是独立的规则库，不是关系** | `Rule{key,name,expression,scopeObjectTypes[],severity:BLOCK|WARN,params,category}` —— 29 条，**14 条 BLOCK 即「约束条件」**。另有 `ontology/invariants` 9 条不变式守卫（带 `tolerance.param` 可调容差）。求解器另有**内部**约束（`capacity.ts` 的 `certByModel`）**不与规则库互通** | `GET /a/v1/rules` 29 条；`GET /a/v1/ontology/invariants` 9 条；§0c-4 |
| **空间 Spatial** | ◑ **层级靠结构边，坐标靠属性，距离/时间全缺** | 基地→车间→产线**是真结构边**：`workshop_belongs_to_base`(130) + `line_belongs_to_workshop`(130) + `line_belongs_to_base`(130)，**非硬编码**。坐标是属性 `Base.lon/lat/province/city`。**❌ 无 `distance_to`/`adjacent_to`/`has_transport_time`** | linkprobe.log 三条各 130 实例；`ontology/graph` n-Base 属性表 |
| **推演 Reasoning** | ◑ **有 3 条边 + 一套独立机制** | 结构边：`scenario_to_capex`/`scenario_to_finance`/`scenario_to_target`（`AnnualScenario→…`）。**真正的推演不走关系**：走 `PropagationRule` 42 条 + `sim/sessions` + `change-impact-preview`。**❌ 无 `simulates`/`projects_to`/`hypothesizes` 关系** | `links.txt`；`POST /a/v1/sim/change-impact-preview` |
| **证据 Provenance** | ✅ **有，是字段不是关系** | `ObjectInstance.origin`（切片 `executeSlice` 每个节点带出 `origin` + `epoch`）· `Rule.origin:{type:"SYNTHETIC"}`（实测 29/29 条都有）· `IndustryTemplate.source:"BUILTIN"` · `element_refs` 派生表（引用三元组）· `reportedRefs`（B→A 上报）。**❌ 无 `derived_from`/`evidenced_by` 边** | `ontology-core.ts:552-561` executeSlice 返回签名；`rules.json` origin 字段；`GET /a/v1/industry-templates` → `[{"industryKey":"battery-manufacturing","source":"BUILTIN"}]` |

## 表 C · 对照 `OntologyRelation` 元模型逐字段查

| 元模型字段 | 本仓三态 | 位置 / 说明 |
|---|---|---|
| `relation_id` | ✅ **有** | `LinkTypeDef.id`（`ltype_*`）· `PropagationRule.id`（`simpr_*`） |
| `relation_type` | ◑ **有但在别处、且只有两档** | 没有 `relation_type` 字段；**类型即机制**：结构边 = `LinkType`，因果边 = `PropagationRule`。图谱下发时打 `kind:"flow"|"agg"|"calc"|"fb"|"orch"`（**这是 `ontology/graph` 的投影标签，不是存储字段**） |
| `source_object_type` | ✅ 有 | `LinkTypeDef.fromTypeKey` / `PropagationRule.sourceTypeKey` |
| `target_object_type` | ✅ 有 | `LinkTypeDef.toTypeKey` / `PropagationRule.targetTypeKey` |
| `cardinality` | ✅ **有（仅结构边）** | `LinkTypeDef.cardinality: "1:1"|"1:N"|"N:1"|"N:N"`。**因果边无此字段** |
| `temporal` | ◑ **有但在别处、且不在关系上** | 关系上**无**。最近的是 `PropagationRule.delayTicks`（整数 tick）与 `PropertyDef.temporal`（属性级布尔） |
| `spatial` | ❌ **无** | 关系上无任何空间 facet；空间信息在 `Base` 的 `lon/lat/province/city` 属性里 |
| `causal` | ◑ **有但是独立实体，不是 facet** | 独立的 `PropagationRule` 表（42 条），通过 `viaLinkKey` **挂在**结构边上，而非结构边自带 `causal` 字段 |
| `constraint` | ❌ **关系上无** | 在独立的 `Rule` 表（29 条）与 `ontology/invariants`（9 条）里 |
| `rule` | ◑ **有但在别处** | `Rule.expression`（DSL 串）。关系上唯一的规则引用位是 `PropagationRule.coefficientRef{ruleKey,paramKey}` —— **实测 0/42 使用** |
| `confidence` | ❌ **无** | 全仓关系上零置信度字段（金丝雀：同一次扫描里 `coefficient` 在 `causal.json` 42/42 命中，证明扫描有效） |
| `provenance` | ◑ **有但只在因果边上、且是弱形态** | `PropagationRule` 有 `domainKey`/`domainName`/`status`，`Rule` 有 `origin:{type}`。**`LinkTypeDef` 上零溯源字段** |
| `valid_from` | ❌ **无** | 关系上无。最近的是 `DeprecationMeta.deprecatedAt` / `graceUntil` / `retiredAt`（**弃用时间线，不是有效期**） |
| `valid_to` | ❌ **无** | 同上；`graceUntil` 语义是「宽限期止」不是「关系失效时刻」 |
| `inference_policy` | ◑ **有但在别处** | 关系上无。最近的是 `PropagationRule.combine:"sum"`（42/42）+ `decay`（0/42 使用）+ `clamp`（0/42 使用），以及 `ObjectTypeDef.derivedProperties[].formula` |

**结论**：15 个字段里 **✅ 有 5 个 · ◑ 在别处 7 个 · ❌ 真无 3 个**（`spatial` / `confidence` / `valid_from`+`valid_to`）。

## 对协调方结构性判断的裁决

> **判断原文**：本仓把结构关系与因果关系做成两套机制；仓主的元模型是一个 `Relation` 带多个 facet。

**✅ 「两套机制」成立**，且实测差异比线索里说的更具体：

| | `LinkType`（结构边） | `PropagationRule`（因果边） |
|---|---|---|
| 条数 | **118** | **42** |
| 写语义 | **upsert**（同 key 覆盖，`version` 自增 1→2） | **纯追加**（只有 POST） |
| 改 | ✅ 同 key upsert | ❌ 无 PUT/PATCH |
| 删 | ❌ | ❌ |
| 停用/下线 | ✅ deprecate/retire（且实测可被 upsert 洗掉） | ❌ |
| 版本 | ✅ `version` | ❌ 无 |
| 屏上行内控件 | **3 个** | **0 个** |

**❌ 但「另起一套点和边」不成立 —— 这一条推翻**（证据见 §0 线索 2）：
42/42 条因果边都 `viaLinkKey` 到真实且有实例的结构边，对象类型口径下因果图**单一连通分量**，
而且有不变式 `causal_via_structural_edge_exists`（实测失联数 = 0）在守着。
**因果边是结构边的一层 overlay，不是平行宇宙。**

**三条追问的回答**：

1. **因果边复用结构边拓扑吗？** ✅ **复用**（36 条不同结构边承载 42 条因果边）。
   22/15/7 的三分量是**状态变量层**的现象，不是拓扑层的。
2. **「没有一条决策同时碰到交付和钱」同根因吗？** ✅ **是**，但根因是
   **「同一对象类型内部零条 `stateVar→stateVar` 规则」**，不是两套图。
   `Order.demandPressure`（分量1）与 `Order.costPressure`（分量3）之间缺一条边而已。
   ⇒ **这是补数据（POST 一条传导规则），不是造门。**
3. **统一成单一 `Relation`+facet 能自动消掉 `combine:"sum"` 双算吗？**
   ❓ **前提不成立**：实测当前 42 条**零重复 key、零重复四元组**，今天不存在双算。
   统一模型能消除的是**未来**因「只能追加不能改」而堆出重边的风险 —— 那个风险是真的，
   但把它说成「现在正在双算」不准确。

---

# §3 主表 · 全量能力盘点

> 写语义列的判据全部来自实测请求，不是读代码推断。

## A · 域 Domain

| 能力 | HTTP | 写语义 | 屏上入口 | 实测证据 |
|---|---|---|---|---|
| 列域 | `GET /a/v1/ontology/domains` | 仅读 | ✅ `/admin/domains`（15 行） | 200，15 个域，带 `color`/`ownerUserId` |
| 建/改域 | `POST /a/v1/ontology/domains` | **upsert**（同 `domainKey` 覆盖，`id` 保持 `dom_<tenant>_<key>`，`createdAt`/`ownerUserId` 保留） | ◑ 只有 `新建域`，**行内无改按钮** | 201；`ontology-governance.ts:111 upsertDomain` |
| 删域 | — | — | ❌ | `DELETE /a/v1/ontology/domains/capacity` → 404 `route not found` |
| 域 owner | 随 `POST` 的 `ownerUserId` | upsert | ❌ | 实测 15 个域全有 owner（`usr_demo_admin`/`usr_demo_planner`） |
| **域对发布的影响** | 会签按域实例化 | — | ◑ 表在、0 行 | `createPublishRequest` 按 `touchedDomains` 每域一行 signoff，owner 缺位回退 catalog_admin |
| **域与图谱着色** | `DomainRecord.color` | — | ✅ 图谱页 | 实测 `capacity:#0891b2` `commercial:#be185d` 等 15 色。⚠️ **但 `ontology/graph` 的节点 `domain` 走的是 `GRAPH_DOMAIN[t.key] ?? "factory"` 这张常量表，不是 `ObjectTypeDef.domain`** —— 两个域口径并存 |
| 域开关 | feature `domain.<key>` | — | ✅ `/admin/features` | `disabledDomains()` 仅当注册表定义了该开关且解析为 off 才隐藏 |

## B · 对象类型 ObjectType

| 能力 | HTTP | 写语义 | 屏上入口 | 实测证据 |
|---|---|---|---|---|
| 列类型 | `GET /a/v1/ontology/object-types` | 仅读 | ✅ `/admin/object-types`（98 行） | 200，98 个类型 |
| 类型统计 | `GET /a/v1/ontology/object-types/stats` | 仅读 | ✅ 同页 | 200，带 `count`（**87 个类型有数据，11 个为 0**） |
| 建/改类型 | `POST /a/v1/ontology/object-types` | **部分合并 upsert**（省略的可选键**保留旧值**，要清空须显式传 `[]`） | ❌ **只读页，零编辑控件** | 201；改 `displayName` 生效、类型总数 98→98 |
| 属性增删/量纲 | 随类型 upsert 的 `properties[]` | 同上 | ❌ | `unit` / `displayFormat` / `enumValues` / `required` / `temporal` / `searchable` / `displayName` / `description` 均在 zod 内 |
| 停用/下线类型 | `POST …/types/:key/deprecate` · `/retire` | 状态机 ACTIVE→DEPRECATED→RETIRED | ✅ 关系页有「停用类型」区 | deprecate 200；retire 在有引用时 **409 并列出引用方** |
| 类型接口 | `GET/POST /a/v1/ontology/interfaces` + `/:key/publish` `/retire` `/implementers` `/conformance` | upsert + 版本 | ✅ `/admin/interfaces` | 200，实测 4 个接口（`Approvable` 等），带 `businessDefinition` |
| 语义下发 | `GET /a/v1/ontology/type-semantics` | 仅读 | — | 200，逐属性 `displayName`/`dataType`（喂 B 侧 LLM） |

## C · 单位字典 —— **属性上有，字典无**

| 能力 | 结论 |
|---|---|
| 属性带单位 | ✅ `PropertyDef.unit?: string` + `displayFormat?`（`domain.ts:227`，且 `POST object-types` zod 已声明，能存能取） |
| **单位取值域 / 能否扩 / 在哪定义** | ❌ **无任何单位字典端点**。`GET /a/v1/units` · `/a/v1/ontology/units` · `/a/v1/meta/units` · `/a/v1/ontology/unit-dictionary` **四个全部 404 `route not found`**。<br>**金丝雀**：同一批探测里 `GET /a/v1/meta/ontology` → **200** `{"total":0,"byKind":{}}` ⇒ 我的探测方法有效，404 是真 404。<br>⇒ `unit` 今天是**自由字符串**，无受控词表、无校验、无扩展入口。源码注释写的「场景包单位字典约束」**在 REST 面上没有对应端点**。 |

## D · 结构边 LinkType

| 能力 | HTTP | 写语义 | 屏上 | 证据 |
|---|---|---|---|---|
| 建/改 | `POST /a/v1/ontology/link-types` | **upsert**，`version` 自增（实测 1→2），**新 `id`** | ✅ `建结构边` | 201 |
| 列 | ❌ **无 `GET /a/v1/ontology/link-types`**（404） | — | ✅ 关系页 118 行 | 只能经 `GET /a/v1/ontology/graph` 的 `kind:"flow"` 边取 |
| 停用 / 下线 | `POST …/links/:key/deprecate` · `/retire` | 状态机 | ✅ 行内 `停用` `下线` | 200 |
| 删 | — | — | ❌ | 404 |
| 引用检查 | `GET /a/v1/ontology/references?elementKind=link&key=…` | 仅读 | ✅ 行内 `查引用` | 200，实时（切片一存立刻可查） |
| **version 纪律** | `LinkTypeDef.version` + `published` | 发布即固化 API 名 | — | `assertRenameAllowed`：PUBLISHED 后改 key 直接 400 |

## E · 因果边 PropagationRule

| 能力 | HTTP | 写语义 | 屏上 | 证据 |
|---|---|---|---|---|
| 列 | `GET /a/v1/sim/propagation-rules` | 仅读 | ✅ 关系页 42 行（7 表） | 200，42 条 |
| 建 | `POST /a/v1/sim/propagation-rules` | **纯追加** | ✅ `建因果边` | 路由存在 |
| 改 / 停 / 删 / 单条读 | ❌ 全部 **404 route not found** | — | ❌ **行内 0 控件**（「启停」列是静态文本"启用"） | 见 §0c 复核① |
| 同 key 幂等 | ❌ 无（追加语义） | — | — | 当前 42 条零重复，风险是结构性的 |
| **系数来源** | `coefficient`（内联数值）或 `coefficientRef{ruleKey,paramKey}` | — | — | **实测 `coefficientRef` 非空 = 0/42，全部内联** |
| combine 策略 | `combine:"sum"` | — | — | **42/42 全 `sum`**；`decay` 0/42、`clamp` 0/42 使用 |

## F · 切片 Slice

见 §0b + §1。补：`GET /a/v1/ontology/slices/:key/layers`（十六层）·
`POST …/derive-fixture`（推进为契约）· `POST /a/v1/ontology/slice-contracts/run`（契约门）·
`GET /a/v1/slices/index`（A3.4 索引）· `POST /a/v1/slices/library/build`（登记两库）。

## G · 影响面三件套

| 能力 | 吃什么 | 吐什么 | 覆盖哪类引用 | 实测 |
|---|---|---|---|---|
| `POST /a/v1/sim/change-impact-preview` | `{focus:{kind:…}}`，**`kind` 是 discriminator，五选一**：`stateVar`(要 `objectId`) / `prop` / `propagationRule`(要 `ruleKey`) / `link`(要 `fromId`+`toId`) / `derivedProp` | `{focus, items:[{bucket:"recompute", target:"sv:<对象>.<变量>", hops, via}]}` | **对象实例级**的状态变量重算面 | `{"kind":"propagationRule","ruleKey":"demo_base_load_to_inbound_expedite"}` → **200**，逐条列出 `sv:obj_shipment_SHIP-changzhou.inboundExpeditePressure` 等，带 `hops:1` 与 `via` |
| `GET /a/v1/ontology/references` | `elementKind`(type/link) + `key` + 可选 `prop` | `{refs:[{refKind,key,version,where}], total}` | **发布物级**：slice / plan / intent / agent（读 `element_refs` 表） | `elementKind=link&key=model_producible_at` → 200，`where:"paths[0][0].linkKey"` |
| `probeMissingRefs`（内部） | 发布时的引用集 | 缺失引用清单 | workflow 发布 / agent 发布**已接**；skill 发布路**未接且 fail-open**（CLAUDE.md 已记此账） | 非 REST 端点 |
| `GET /a/v1/ontology/slices/:key/references` | sliceKey | 同上结构 | **只读 `reportedRefs`（B→A 上报表）** | `order_fulfillment_360` → 200 `{"refs":[],"total":0}`（B 侧无上报） |
| `GET /a/v1/ontology/invariants` | — | 9 条守卫，带 `measure.value` 与可调 `tolerance` | 本体自检 | 200，含 `causal_via_structural_edge_exists`=0 |

## H · 实体合并

| 能力 | HTTP | 屏上 | 实测 |
|---|---|---|---|
| 扫候选 | `POST /a/v1/objects/merge-scan` | ✅ `/admin/merge` 的 `扫描候选` | **400** `typeKey: expected string` ⇒ **必须指定类型，不能全库扫** |
| 列候选 | `GET /a/v1/objects/merge-candidates` | ✅ | 200 `[]`（**种子里零候选**） |
| 合并 / 否决 | `POST …/:id/merge` · `/:id/reject` | ✅ 行内（0 行故未见） | 路由存在 |
| 撤销合并 | `POST /a/v1/objects/merges/:id/unmerge` | — | 路由存在 |
| **调阈值** | ❌ **无端点** | ❌ | 阈值在服务端 `entity-resolution.ts`，REST 面不可调 |

## I · 数据灌入

| 能力 | HTTP | 实测 |
|---|---|---|
| **`POST /a/v1/objects`（裸写对象）** | ❌ | **404 `route not found`** —— **仓主线索确认**。金丝雀：`POST /a/v1/objects/query` → 200 有数据，证明 `/a/v1/objects/*` 前缀本身是活的 |
| intake → import → objectify | `POST /a/v1/databuilder/intake` → `/intake/import` → `/intake/objectify` | intake 400 `html: expected string` ⇒ **入口吃的是 HTML 文本**，路由活 |
| 构建运行 | `POST /a/v1/databuilder/runs` + `/verify` `/promote-precheck` `/promote` | 全部路由存在（6 段式：runs→scaffold-manifest→verify→precheck→promote→backfill） |
| Pipeline 配置 | `GET/PUT/DELETE /a/v1/databuilder/pipelines/:kind` | **200**，实测出厂默认 `bpp_factory_story_build`「故事建域」带节点图。**这是唯一有 DELETE 的本体侧资源** |
| 工作流运行 | `POST /a/v1/databuilder/workflow-runs` + `/approve` `/resume` `/fde-graph` `/recover` | 路由齐 |
| 对账候选 | `GET /a/v1/databuilder/reconcile-candidates` + `/:id/resolve` | 路由齐 |
| 合成数据 | `/a/v1/synthetic/*` | ✅ `/admin/synthetic` |

## J · 发布治理 —— **哪几步是真的，哪几步是状态自己跳**

| 步 | 真不真 | 实测 |
|---|---|---|
| 草案 → 发布请求 | ✅ **真** | `POST /a/v1/ontology/publish-requests` 先跑 `publishImpact()` 反查破坏性变更，非空且无 `force` 即 **409 拒绝创建**；再跑 `assertOntologyInvariantsAllowPublish` |
| 会签 signoff | ✅ **真，且鉴权严格** | 仅该 signoff 行的 owner 可签（否则 **403**）；`REJECT` 必须带 `comment`（否则 400）；`catalog_admin` 满 **72h** 才可 `onBehalf` 代签；7 天未决 → `EXPIRED` |
| 全域 APPROVE → 自动发布 | ✅ 真 | `signoff` 返回 `APPROVED` 时路由内直接 `await ontology.publishVersion(c)` |
| **发布本身** | ⚠️ **会签可被完全绕过** | **`POST /a/v1/ontology/publish` 是一条裸路由，无任何门**：`app.ts:4080` 就是 `async (req) => ontology.publishVersion(ctx(req))`。`publishVersion` 内部只 `assertInterfaceConformance`，**不检查是否存在 APPROVED 的 publish-request** ⇒ 任何有权限的调用方可直接发布 |
| 触及域的计算 | ◑ **状态自己跳** | `touchedDomains = 全部当前类型所属域`（源码注释自认「无更细变更集时按全域」）⇒ **不是真实变更集**，每次会签都要惊动全部 15 个域的 owner |
| **回滚** | ❌ **无** | 全 400 条路由里 `rollback/revert/restore` 只命中 `calibration/proposals/:id/rollback` 与 `sim/sessions/:id/rollback`，**本体版本无回滚端点**。金丝雀：同一份路由表里 `publish` 命中 9 条，证明表是全的 |
| 版本快照 | ✅ 真 | `GET /a/v1/ontology/versions` → 200，`version:1` 带完整 `snapshot.objectTypes/linkTypes` |
| 屏上 | ◑ | 关系页有「发布会签（R4）」表，**实测 0 行**（`GET publish-requests` → `[]`） |

## K · 行业模板

`GET /a/v1/industry-templates` → **200** `[{"industryKey":"battery-manufacturing","source":"BUILTIN"}]`
—— **只读，仅 1 个内置模板**，无 POST/PUT/DELETE，**不能沉淀新模板**。
金丝雀：`/a/v1/synthetic/templates` 与 `/a/v1/meta/industry-templates` 均 404，证明我在探真实路由表。

## L · 查询

| 能力 | 实测 |
|---|---|
| `GET /a/v1/objects?type=&page=&pageSize=` | ✅ 200，返回 `{items,total}`（也兼容 `{data,snapshotVersion}`）。`Order` → `total:500`。**`pageSize` 上限 500**（`Math.min(500,…)`），⚠️ 内部先 `queryObjects(...,1000)` 再切片 ⇒ **超过 1000 条的类型分页会失真** |
| `POST /a/v1/objects/query` | ✅ 200，`{objectType,filter,limit,asOfEpoch}` |
| `POST /a/v1/objects/aggregate` | ✅ 200。⚠️ **参数名易踩**：是 `{typeKey, metrics:[{fn,prop,as}], groupBy}`，且 **`fn` 必须小写** `count/sum/avg/min/max`（传 `COUNT` → 400）。实测 `Order` by `status` → `COMPLETED 350 / IN_PRODUCTION 100 / OPEN 50` |
| `GET /a/v1/objects/search` | ✅ 关键词检索（`searchable` 属性范围） |
| `GET /a/v1/objects/:id/neighbors` | ✅ 邻接（带 `linkKey`/`direction`/`limit`） |
| `POST /a/v1/ontology/resolve-ref` | ✅ 「实体文本→对象引用」三层解析（id/name/alias），回 `matchedBy` 与失败 `attempts` |

---

# §4 已能用但屏上没入口 —— 给前端的清单

**按「补一个入口能解锁多大能力」排序。**

| 排序 | 能力 | 接哪个端点 | 要哪些参数 | 解锁了什么 |
|---|---|---|---|---|
| **1** | **切片按域浏览 + 跨域桥接库** | `GET /a/v1/slices/library?scope=intra\|cross\|all`，登记用 `POST /a/v1/slices/library/build` | `scope` | 仓主要的「按域建切片 + 跨域一等公民」**两项直接兑现**：7 条域内 + 54 条跨域，自带 `domain`/`spannedDomains`。⚠️ 页面 `/admin/slice-library` 已存在且有 61 行，**要确认的是它有没有把 `domain`/`scope` 这两列显示出来** |
| **2** | **对象类型编辑（建/改/属性增删/量纲）** | `POST /a/v1/ontology/object-types` | 完整 `ObjectTypeDef`（key/displayName/domain/properties[]/derivedProperties/sourceBindings，+7 个 OntoFlow 可选字段） | 今天 `/admin/object-types` 是**纯只读 98 行**，而后端是**能改的 upsert**。这是「从 0 建一套本体」缺口最大的一块 |
| **3** | **域的改 / owner 指派** | `POST /a/v1/ontology/domains` | `{domainKey, displayName, color?, ownerUserId?, description?}` | 域是会签的分组依据；今天屏上只能新建不能改 owner，而 owner 决定谁能签发布 |
| **4** | **域内切片覆盖率** | `GET /a/v1/ontology/object-types` + `GET /a/v1/slices/index` | 无 | 两个 GET 一次 `groupBy` 就能算「域 X 有 N 类型、覆盖 M 个」，兑现仓主「每个域的切片要完整」的可验证性 |
| **5** | **影响面预览** | `POST /a/v1/sim/change-impact-preview` | `{focus:{kind:"propagationRule",ruleKey}}` 等五种 discriminator | 改一条规则之前先看会重算哪些对象的哪个状态变量（带 `hops`/`via`），**推演可披露性**的现成材料 |
| **6** | **规则→对象的引用反查** | `GET /a/v1/rules/:id/references` · `GET /a/v1/ontology/references` | `elementKind`+`key`(+`prop`) | 删/改一条规则前的影响面；实时索引 |
| **7** | **不变式体检 + 容差调参** | `GET /a/v1/ontology/invariants` · `POST …/invariants/evaluate` | `{overrides}` | 9 条守卫已有 `tolerance.param`，`evaluate` 支持 `overrides` 试算 —— **关系页已有该表且每行 2 个 input**，是本仓少数已接好的 |
| **8** | **切片十六层 / 契约夹具** | `GET /a/v1/ontology/slices/:key/layers` · `POST …/derive-fixture` · `POST /a/v1/ontology/slice-contracts/run` | sliceKey | 切片可解释性 + 发布门 |
| **9** | **对象聚合** | `POST /a/v1/objects/aggregate` | `{typeKey, metrics:[{fn小写,prop,as}], groupBy}` | 任意类型的分组统计（实测可用），前端很多"分布图"不必新造后端 |
| **10** | **实体解析（文本→对象）** | `POST /a/v1/ontology/resolve-ref` | `{text, typeHints?}` | 用户打"常州"能解析到 `obj_base_changzhou`，带 `matchedBy` 可诊断 |

⚠️ **本清单的第 1、2 条各自能解锁的量级远大于其余八条之和。**

---

# §5 真正的能力缺口（必须改源码）—— 与 §4 严格分开

> **本节与 §4 的区别是本仓付过学费的那条线**：§4 是「接一条线」，本节是「造一道门」。混了会直接歪掉排期。

| # | 缺口 | 为什么是造门不是接线 | 规模判断 |
|---|---|---|---|
| **1** | **因果边的改 / 停 / 删** | `PUT`/`PATCH`/`DELETE`/单条 `GET` **四个路由都没注册**（实测均 404 且本应用不返 405）。今天只能追加 | 中：加 4 条路由 + 仓储方法 |
| **2** | **切片层级 L1→L2** | schema / 列表项 / `spec` 里 `parent`/`level`/`subsetOf` **零字段**，`maxHops` 实测不产生子集关系 | 中：加字段 + 迁移 + 派生 |
| **3** | **`ObjectType` 引用规则库配约束** | 两半都缺：① 类型侧无引用字段（实测 `constraintRefs`/`rules` 被 **静默 strip 且返 201**）② 求解器不读规则库（`capacity_forecast` 与同名规则 `C03` 零调用关系） | 大：跨「数据+引擎两半」，按 SEAM-GATE 必须一个 dev 整单做 |
| **4** | **`WorkOrder → Order` 直边（`fulfills`）** | 即便补齐 `wo_for_model` 实例，路径也要过 `Model`(6 条) 这个瓶颈 ⇒ 1 张生产订单扇出约 83 张销售订单。**要真答「哪条线做哪个客户的单」必须有直边** | 小-中：加 1 条 LinkType + 造数 |
| **5** | **库存 → 订单 `allocated_to`** | 关系本身不存在（`FinishedGoodsInventory` 只连 `Warehouse`/`Model`） | 小-中：同上 |
| **6** | **时间窗产能 `capacity_by_period`** | 产能是 `Base` 的标量属性不是对象；无 `available_from/to`。「产线×产品×时间窗×工厂」四元组**无处安放** | 大：新对象类型 + 求解器改造 |
| **7** | **运输时间 / 成本** | `Base` 有经纬度但无 `has_transport_time`/`has_transport_cost`；`Shipment` 不连 `Customer` | 中 |
| **8** | **单位受控词表** | 四个候选端点全 404（金丝雀 `meta/ontology` 200）；`unit` 今天是自由字符串 | 小-中 |
| **9** | **本体版本回滚** | 全路由表零 `rollback`（金丝雀 `publish` 命中 9 条） | 中 |
| **10** | **`POST /a/v1/objects` 裸写对象** | 404（金丝雀 `objects/query` 200）。今天只能走 databuilder 六段式 | 小；但**要先确认是不是有意为之**（强制走治理链路可能是设计而非缺失） |
| **11** | **发布会签可被绕过** | `POST /a/v1/ontology/publish` 无门；且 `touchedDomains` 取全域而非真实变更集 | 小：加一道门 + 变更集计算 |
| **12** | **关系上的 `confidence` / `valid_from`+`valid_to` / `spatial`** | 元模型 15 字段里这 3 个**真无**（表 C） | 中-大 |
| **13** | **实体合并阈值不可调** | 无 REST 端点，阈值固化在服务端 | 小 |
| **14** | **行业模板不可沉淀** | `industry-templates` 只读，1 个 BUILTIN | 中 |

## 不属于缺口、属于「补数据」的（**别当成缺口排期**）

| 项 | 三态 | 补法 |
|---|---|---|
| `wo_for_model` / `wo_on_line` / `sched_for_wo` 等 **35 条零实例 LinkType** | **接了线没数据** | 造链接实例（FK 已在 props 里，但 **106/260 张 WorkOrder 的 `modelId` 悬空，须先修数据**） |
| `coefficientRef` **0/42** | **机制在、没人走** | 把 42 条的系数迁到规则库 param，填 `{ruleKey,paramKey}` |
| `decay` / `clamp` **0/42** | 同上 | 填数据或删死分支 |
| `ObjectType.actions/implements/functions/stateVariables` **0/98** | 同上（实测能存能取） | 填数据 |
| `Order.demandPressure → Order.costPressure` 缺边（交付与钱不相通） | **接了线没数据** | `POST /a/v1/sim/propagation-rules` 加同类型规则 |
| `ProductionSchedule`(0) / `ShiftPlan`(0) 两类型零对象 | 接了线没数据 | 造数 |
| 切片契约夹具 `fixtures` **0/99** | 同上 | 填 |

---

# §6 复现方式

```bash
# 服务（本次取证用的确切参数）
PORT=4431 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-onto-cap SEED_DEMO=1 \
  CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
PORT=4432 DATACORE_BASE_URL=http://127.0.0.1:4431 node apps/agentcore/dist/main.js
cd apps/frontend-shell && VITE_DATACORE_URL=http://127.0.0.1:4431 \
  VITE_AGENTCORE_URL=http://127.0.0.1:4432 node node_modules/vite/bin/vite.js --port 5431 --host 127.0.0.1

# 鉴权头
-H 'X-Debug-User: demo:admin:admin|planner|catalog_admin'
```

**证据文件**（`docs/assets/onto-capability/`）：
`linkprobe.log`（118 条边逐条实例数，含金丝雀）· `links.txt`（118 条 LinkType 全表 from→to→基数）·
`ui-*.png`（8 张真浏览器截图）· `ui-ontology-relations-full.png`（关系页全页）· `00-login.png` / `01-after-login.png`。

**关键复验命令**：
```bash
curl -s -H 'X-Debug-User: demo:admin:admin|planner|catalog_admin' \
  -X POST http://127.0.0.1:4431/a/v1/slices/plan \
  -H 'Content-Type: application/json' \
  -d '{"rootType":"Customer","targets":["Supplier","Equipment"],"maxHops":6}'
# 期望：ok:true，5 跳路径，spannedDomains 6 个域

curl -s -H 'X-Debug-User: demo:admin:admin|planner|catalog_admin' \
  http://127.0.0.1:4431/a/v1/slices/library?scope=cross | head -c 400
# 期望：54 条 cross 条目，每条带 domain 与 spannedDomains
```
