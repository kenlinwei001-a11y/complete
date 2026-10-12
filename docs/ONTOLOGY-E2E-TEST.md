# 亲手从 0 建一套跨域本体 · 真实交付测试（ONTOLOGY-E2E）

## 报告头

| 项 | 值 |
|---|---|
| **base commit** | `3408572c`（`origin/claude/inspiring-gates-aqczjg`，开工时 tip） |
| **取证时刻** | 2026-08-30 05:28（datacore 起）～ 08:15（收尾），单次会话连续取证 |
| **树龄探针** | `wc -l apps/datacore/src/synthetic/battery.ts` = **5357** ✅（1249 = 06-15 旧树） |
| **环境** | datacore `:4451`（内存模式 `SEED_DEMO=1`）· agentcore `:4452` · vite `:5451`，**`VITE_MOCK` 未设** |
| **浏览器** | `playwright-core` 驱动的真 chromium（`/opt/pw-browsers/chromium`，Chrome/141），headless=new，1600×1000 |
| **入口** | 全程从 `http://127.0.0.1:5451/login` 点进去，**一次都没有手敲过 URL**（唯一的地址栏动作是 F5 刷新，用于从崩溃态恢复） |
| **账号** | demo / admin / demo1234 |
| **角色** | 使用者，不是开发者。屏上做不到的，记下来，没有绕到代码里补 |

---

## 一句话结论

**10 个节点全部建成，而且 10 个全是在屏上点出来的 —— 建本体这一段 0 处必须走 REST、0 处根本做不到。
但「建起来」和「用起来」是两件事：本体结构 100% 建成、10 个类型全部灌上了真实例（合计 2,494 个对象），
而多跳检索拿回来的边是 0 条，推演连落点都选不到 —— 也就是说，我建的这套本体今天只是一张<u>没有一条边有实例的类型表</u>。
收工时还多了一件事：唯一能建边的那个页面（本体关系）在我全部动作做完之后变成了永久崩溃页。**

| 维度 | 结果 |
|---|---|
| 10 个对象类型 | ✅ **10 / 10 屏上点得完**（0 走 REST，0 做不到）· 平台类型数 98 → 108 |
| 11 条结构边 + 1 条跨域因果边 | ✅ **12 / 12 屏上点得完** · 结构边 122 → 133，生效因果边 42 → 43 |
| 灌数据（≥3 个类型有真实例） | ✅ **10 / 10 有真实例**，屏上一个「对象化」按钮完成，共 2,494 个对象 |
| 用起来 · 多跳检索 | ❌ **断在第 1 跳**：500 个根节点、**0 条边**。三态定性 = **接了线没数据** |
| 用起来 · 推演 | ❌ **进不去第一个控件**：扰动落点下拉只有 100 项且被字母序截断，我的对象一个都不在（金丝雀：平台自己种的落点 `obj_material_sep_film` **也不在**） |
| 收工状态 | ⚠ `/admin/ontology-relations` **永久崩溃**（障碍 A8）—— 它是全平台唯一能建结构边/因果边的入口，崩了就再也加不了边 |
| 交互数 | **最短可复现路径 151 次**；我这次实际走了 **229 次**（含找入口与验证） |

### 步数账（最短可复现路径 · 不含探索与验证）

| 段 | 交互数 |
|---|---|
| 登录（3 个输入框 + 1 次点击） | 4 |
| 建 4 个域（导航 1 + 4×（2 输入 + 1 点）） | 13 |
| 起草案（导航 1 + 开弹窗 1 + 勾 10 个数据集 + 生成 1） | 13 |
| 改名 10 个类型（10×（选 + 输 + 点）） | 30 |
| 归域 10 个类型 | 10 |
| 发布 | 1 |
| 对象化 | 1 |
| 建 11 条结构边（导航 1 + 11×（1 输 + 3 选 + 1 点）= 56）+ 1 条因果边（10） | 66 |
| 建切片（导航 1 + 选根 1 + 选 7 个目标 + 规划 1 + 命名 1 + 入库 1 + 试切 1） | 13 |
| **合计** | **151** |

> 其中 **105 次（70%）花在「一个字段一个字段地填」**：改名 30 + 归域 10 + 建边 65。
> 没有批量、没有导入、没有粘一份 JSON 进去的入口。
> 逐步表那一列的合计 **229**，差额 78 次全部花在**找入口**（步 2–5，其中 45 次是把 45 个后台页挨个点开）
> 和**排除假设**（步 17–22、24）上。

---

## 我建的是什么

**主题：工程机械整机制造全链**（与平台预置的锂电数据错开，便于分辨新旧）。

**10 个节点，横跨 5 个域：**

| # | typeKey | 段 | 归到的域 | 源数据集 | 属性数 | 实例数 |
|---|---|---|---|---|---|---|
| 1 | `EmCustomer` | 需求 | `sales` ⚠ | Customer | 8 | 20 |
| 2 | `EmSalesOrder` | 需求 | `sales` ⚠ | erp_sales_orders | 17 | 500 |
| 3 | `EmOrderLine` | 需求 | `sales` ⚠ | OrderLine | 8 | 873 |
| 4 | `EmPlant` | 产能 | `factory` | mes_base_master | 19 | 13 |
| 5 | `EmProdLine` | 产能 | `capacity` | mes_lines | 8 | 130 |
| 6 | `EmEquipment` | 产能 | `equip` | iot_equipment | 18 | 780 |
| 7 | `EmMaterial` | 物料 | `material` ⚠ | Material | 19 | 8 |
| 8 | `EmBomItem` | 物料 | `material` ⚠ | BOMDetail | 12 | 105 |
| 9 | `EmSupplier` | 物料 | `material` ⚠ | Supplier | 19 | 15 |
| 10 | `EmDeliveryPromise` | 交付 | `sales` ⚠ | OrderPromise | 10 | 50 |

⚠ = **落在一个域注册表里根本不存在的域上**（见障碍 A5）。

**11 条结构边 + 1 条跨域因果边（全部屏上建成）：**

```
em_orderline_belongs_to_order      EmOrderLine       → EmSalesOrder      N:1   belongs_to
em_customer_orders_salesorder      EmCustomer        → EmSalesOrder      1:N   orders
em_order_contains_line             EmSalesOrder      → EmOrderLine       1:N   contains
em_line_requires_material          EmOrderLine       → EmMaterial        N:N   requires
em_material_supplied_by            EmMaterial        → EmSupplier        N:1   supplied_by
em_prodline_belongs_to_plant       EmProdLine        → EmPlant           N:1   belongs_to
em_equipment_belongs_to_prodline   EmEquipment       → EmProdLine        N:1   belongs_to
em_bomitem_contains_material       EmBomItem         → EmMaterial        N:1   contains
em_promise_belongs_to_order        EmDeliveryPromise → EmSalesOrder      1:1   belongs_to
em_orderline_produced_on_line      EmOrderLine       → EmProdLine        N:1   （需求→产能 跨域）
── 跨域因果边 ──────────────────────────────────────────────────────────
em_supplier_delay_to_promise_risk
   EmSupplier.deliveryDelay --em_supplier_affects_promise--> EmDeliveryPromise.promiseRisk
   系数 0.8 · 延迟 1 拍 · 启用（物料域 → 交付域）
```

另有 **8 条平台在发布时自动派生的结构边**（由 `ref` 属性反推，键名形如 `<数据集>_to_<数据集>`）：
`erp_sales_orders_to_Customer` · `OrderLine_to_erp_sales_orders` · `OrderPromise_to_erp_sales_orders` ·
`mes_lines_to_mes_base_master` · `iot_equipment_to_mes_lines` · `iot_equipment_to_mes_base_master` ·
`BOMDetail_to_Material` · `Material_to_Supplier`。
⇒ **我手建的 11 条里有 5 条和它们语义重复**，而屏上没有任何地方提示「这条边平台已经替你建了」。

---

## 逐节点/逐步记录（交付物主体）

「入口」列写的是**从左导航点进去的路径**。「REST?」列 = 是否不得不绕开屏幕。

| 步 | 想做什么 | 屏上入口在哪 | 点了几下 | 成功? | REST? | 卡在哪 / 只能怎么绕 |
|---|---|---|---|---|---|---|
| 1 | 登录 | `/login`（起点） | 4 | ✅ | 否 | — |
| 2 | 找「新建对象类型」 | 建模与图谱 → 对象/类型浏览 | 1 | ❌ | — | **这页是只读的**：124 个按钮全是「看实例 →」，0 个新建入口 |
| 3 | 再找 | 建模与图谱 → 本体建模 | 1 | ❌ | — | 工作台只有 1 个动作按钮「AI 建议草案」，数据集行不可点（`cursor:auto`、无 onclick） |
| 4 | 再找 | 构建与成长 → 数据构建发动机（故事建域） | 3 | ❌ | — | 输入工程机械故事脚本 → 系统读出「对象类型 6 项，**可复用 6 · 待建 0**」。它把我点名要的 10 个新类型**全部映射到已有类型**上，**一个新类型都不建** |
| 5 | **全量确认没有这个入口** | 遍历全部 45 个 `/admin/*` 页，抓每页动作按钮 | 45 | ✅（结论成立） | — | 第一次跑**金丝雀失败**（域管理没抓到「新建域」）→ 报「我的工具坏了」，查明是隔离区崩溃污染（障碍 A1），排除后重跑，金丝雀通过。**45 页里 0 个「新建对象类型」**；有 新建域/创建接口/建结构边/建因果边/＋新建切片/新建规则/新建视图/新建用户 |
| 6 | 建 4 个业务域 | 建模与图谱 → 域管理 → 内联表单 | 13 | ✅ | 否 | 「新建域」按钮**默认 disabled**，要先填两个输入框才亮。对照实验：域表 **15 → 19 行** |
| 7 | 起 10 个类型的草案 | 本体建模 → AI 建议草案 → 勾 10 个数据集 → **确定性建模（全字段）** | 13 | ✅ | 否 | 这才是真正的建类型入口，**它藏在一个叫「AI 建议草案」的弹窗里**。旁边的「生成建议」才是 LLM 路；「确定性建模」是零 LLM 的确定性路。**弹窗标题完全没提示这里能建新类型** |
| 8 | 把 10 个类型改成我的名字 | 草案页 → 操作面板 → 改名 → 应用 | 30 | ✅ | 否 | 改的是 **typeKey**。生成出来的键是 `Customer` / `Material` / `Supplier` / `OrderLine` / `BOMDetail` / `OrderPromise` —— **6 个和平台已有类型同名**，不改就要覆盖生产本体，而屏上**没有任何冲突提示** |
| 9 | 给 10 个类型归域 | 草案页 → 映射画布 → 每张卡的「归域…」下拉 | 10 | ⚠ 部分 | 否 | **我第 6 步刚建的 4 个域，一个都不在下拉里**（刷新前后都是同一批 14 项 · 见障碍 A3）。只能挂平台预置域 |
| 10 | 发布本体 | 草案页 → 发布 | 1 | ✅ | 否 | `POST /modeling/drafts/:id/publish` → **200，不问会签**（陷阱 4 的一个形态）。对照：对象类型 **98 → 108**，10 个全部屏上可见 |
| 11 | 建 11 条结构边 | 建模与图谱 → 本体关系 → 建结构边 | 56 | ✅ | 否 | 表单只收 key / 来源 / 去向 / 基数 —— **没有「这条边由哪个属性实现」的输入**（这是后面 0 条边的根）。对照：结构边 **122 → 133**。⚠ 这个页面收工时已崩（障碍 A8） |
| 12 | 建 1 条跨域因果边 | 本体关系 → 建因果边 | 10 | ✅ | 否 | 状态变量是自由文本框，我填的 `deliveryDelay` / `promiseRisk` 恰好命中平台 40 项白名单；**填错不会报错，只会永远不触发**。对照：生效因果边 **42 → 43** |
| 13 | 灌数据（对象化） | 本体建模 → 对象化 | 1 | ✅ | 否 | `POST /modeling/drafts/:id/materialize` → 202 → 「对象化作业进度: SUCCEEDED」。**10 个类型全部从 0 → 有实例**，合计 2,494 个 |
| 14 | 规划多跳路径 | 建模与图谱 → 本体切片 → 选根 → 选 7 个目标 → 规划路径（求最短路） | 11 | ✅ | 否 | 返回 7 条路径，跨域标注 `CAPACITY/FACTORY/MATERIAL/SALES`，全部走我建的边 |
| 15 | 切片入库 | 入库（注册切片） | 2 | ✅ | 否 | **`PUT /a/v1/ontology/slices/em_order_360` → 201**（不是传闻里的 400，见陷阱 3）。切片 99 → 100 |
| 16 | **跑多跳检索** | 试切预览（resolve 子图） | 1 | ❌ | 否 | **节点 200 个 · 边 0 条**。类型分布空 |
| 17 | 排除「预算不够」 | 切片行 → 看子图/编辑 → maxNodes 200→4000 → 保存切片 | 4 | ❌ | 否 | **节点 500 个 · 边 0 条** —— 不截断了，还是 0 |
| 18 | 排除「链路键不对」 | 编辑切片规格 → paths JSON 换成平台自动派生的 3 个键 → 保存 | 3 | ❌ | 否 | 还是 **0 条边** |
| 19 | 排除「根太多」 | 新建微型切片 `em_plant_lines`（根 EmPlant，13 个实例） | 9 | ❌ | 否 | **13 个节点 · 0 条边** |
| 20 | **金丝雀** | 展开出厂切片 `order_fulfillment_360` | 1 | ✅ | 否 | **531 节点 · 570 条边** ⇒ **我的观测没坏，0 条边是真的** |
| 21 | 换个屏再验一次 | 对象/类型浏览 → EmProdLine 看实例 → 360 → | 3 | ❌ | 否 | 我的对象 360 页：属性全在，**「关系：暂无数据」** |
| 22 | **同屏金丝雀** | 同上，改点出厂类型 `Line` 的同一个 objectKey | 3 | ✅ | 否 | 同一个 `LINE-WS-changzhou-assembly`，出厂类型显示 **4 组关系、真邻居**（基地/车间/5 道工序/2 张工单） |
| 23 | 跑一次推演 | 推演 → 推演沙盘 → 展开配置 | 3 | ❌ | 否 | ①就绪门先说话：`NO_SLICE · GLOBAL — 图查询覆盖 97/108 对象`（少的 11 个里就有我的 10 个）②**扰动落点对象下拉只有 100 项**，字母序从 `obj_araging_*` 到 `obj_bomdetail_*` 就截断了，我的 `obj_em*` 一个都不在 |
| 24 | **落点下拉金丝雀** | 同一个下拉里找平台自己种的扰动落点 | 0 | ✅（证伪成功） | 否 | `obj_material_sep_film`（种子扰动就落在它身上）**也不在这 100 项里** ⇒ 这是下拉的通用缺陷，不是「我的对象特殊」 |
| 25 | 发起发布会签 | 本体关系 → 发起发布会签 | 1 | ✅ | 否 | `POST /ontology/publish-requests` → 201，`PENDING_SIGNOFF`，**17 个域主签署全部未决**。其中 `em_demand` 的 `ownerUserId` 是 **null**（新建域没有 owner，屏上也没有设 owner 的入口） |

> **建本体这件事，REST 列全是「否」。** 我在报告里出现的所有 `curl`，只用于第 6 节验证五个陷阱，
> **一次都没有用来替屏幕补功能**。

---

## 屏上缺的入口清单（按「补一个解锁几步」排序）

| 排名 | 缺的入口 | 补上解锁 | 今天只能怎么办 | 证据 |
|---|---|---|---|---|
| **1** | **「关系 ⇄ 实现它的属性」的绑定入口**<br>`建结构边` 表单缺一个「这条边由 `<源类型>.<属性>` 实现」的字段 | **解锁第 16–23 共 8 步** —— 多跳检索、对象 360、就绪门、推演，全部由它一条卡住 | 没办法。屏上任何地方都建不出一条**有实例**的边 | 步 16–22；`em_order_360` / `em_plant_lines` 两个切片、三种链路键、四种预算，全部 0 条边；金丝雀 570 条边 |
| **2** | **「新建对象类型」的直入口** | 解锁第 2–7 共 5 步（省掉 3 次找错门 + 1 次全量遍历） | 只能靠「本体建模 → **AI 建议草案** → 勾数据集 → 确定性建模」这条**名字完全不像建类型**的路，而且**必须先有一个数据集**（凭空建一个类型做不到） | 步 2–7；45 页全扫 0 命中，金丝雀通过 |
| **3** | **对象类型的 displayName 编辑框** | 解锁「本体图谱能看懂」——今天图谱上我的 10 个节点显示为 `mes_base_master` / `erp_sales_orders` 这样的**原始数据集名** | 操作面板只有「改名（typeKey）」，没有改显示名的地方 | 步 8；`/v/graph` 里 10 个类型全在，但名字是数据集名（金丝雀：出厂类型显示「生产基地」「订单明细行」） |
| **4** | **归域下拉读域注册表** | 解锁第 6、9 两步的价值 —— 今天「新建域」建完就是个孤儿 | 只能挂 14 个写死的域；其中 `sales`/`material` **域注册表里根本没有**，而 API 直连会拒绝这两个值 | 步 6/9；障碍 A3、A5 |
| **5** | **扰动落点的搜索/筛选** | 解锁第 23 步（推演） | 100 项截断的 `<select>`，无搜索框 | 步 23–24，含金丝雀 |
| **6** | **重名冲突提示** | 省掉一次可能覆盖生产本体的事故 | 生成的 6 个键与在册类型同名，屏上零提示，全靠我自己逐个改 | 步 8 |
| **7** | **对象类型的删除入口** | 建错了能回滚 | 屏上只有「停用类型 / 下线类型」；`DELETE /a/v1/ontology/object-types/:key` = **404 route not found** | 障碍 A6 |
| **8** | **域 owner 的设置入口** | 让会签走得完 | 新建域 `ownerUserId=null`，会签单上这一格永远签不掉 | 步 25 |
| **9** | **错误页给个「回到上一个能用的状态」/ 说清是哪条数据崩的** | 不是解锁步数，是**别把已完成的工作锁死** | 今天只有一个「刷新」按钮，按了还是错误页 | 障碍 A1 / A2 / A8 三处同一个形态 |

---

## 五个已知陷阱 · 逐个实测

### 陷阱 1 · `ObjectType.constraintRefs` 被 zod 静默 strip 且返 201 → ✅ **成立**

金丝雀先行：用正确 schema（`key` / `properties[].propKey` / 已注册的域）建一个不带 `constraintRefs` 的最小类型
→ **201**，回读 `props=cid,amount` ✅ 工具好使。

```
POST /a/v1/ontology/object-types  {..., "constraintRefs":["rule_credit_limit","rule_qty_positive"]}
→ HTTP 201
→ 响应体：{"key":"EmTrapConstraint",...,"properties":[...],"derivedProperties":[],"sourceBindings":[],...}
                                            ↑ 没有 constraintRefs 这个键
→ 回读（GET object-types 全表）：constraintRefs 键不存在
→ 基线：全库 108 个类型里带 constraintRefs 键的 = 0 个
```

**配了约束、屏上/接口都说成功、实际整键丢弃。** 判据一次通过，无异议。

### 陷阱 2 · `POST object-types` 是部分合并 upsert，省略的可选键保留旧值 → ❌ **不成立，我顶回来**

实测是**完全相反的**：它是**整体替换（PUT 语义）**。

| 做法 | 预期（按陷阱说法） | 实测 |
|---|---|---|
| 传短一截的 `properties`（`cid,amount` → 只传 `cid`） | 旧的 `amount` 保留 | **201，`amount` 真被删掉了**（回读只剩 `cid`） |
| 显式传 `properties: []` | 才会清空 | 201，清空 —— 但这不是「才」，短数组已经清了 |
| **整个 `properties` 键省略不传** | 保留旧值 | **400 `VALIDATION_ERROR: properties: expected array, received undefined`** —— 这个键**是必填的，压根不许省略** |
| 省略一个**真·可选**键 `derivedProperties`（先建一条 `dbl = qty*2`，再省略它重发） | 保留旧值 | **201，回读 `derivedProperties: []`** —— 旧值**被抹掉了** |

**结论：不存在「省略 = 保留」这回事。省略必填键 400，省略可选键抹平，传短数组真删。**
（顺带：`derivedProperties[].formula` 才是字段名，不是 `expression`。）

### 陷阱 3 · `slices/plan` 输出与 `PUT /ontology/slices/:key` 形状不兼容（400） → ⚠ **API 层成立，但屏上一次点击就过，用户完全遇不到**

**API 层（成立）**：

```
POST /a/v1/slices/plan → 200
  {ok, plan:{ sliceKey, rootType, paths:[{target,hops:[{linkKey,direction,toType}]}], pathEvidence, spannedDomains, reused }}

(a) 把 plan 原样 PUT     → 400  "spec: expected object, received undefined"
(b) 把 {version,spec:plan} PUT → 400  "spec.root: expected object, received undefined;
                                        spec.paths.0: expected array, received object;
                                        spec.paths.1: expected array, received object"
```

要手工改**四处**：① 外面套 `{version, spec}` ② `rootType` → `root:{typeKey, selector:{filter:{}}}`
③ 每条路径从 `{target, hops:[{linkKey,direction,toType}]}` 压成裸数组 `[{linkKey,direction}]`（丢掉 `target`/`toType`）
④ 丢掉 `pathEvidence`/`spannedDomains`/`reused`。

**屏上（不成立）**：点「规划路径」→ 点「入库（注册切片）」，前端自己把形状转好了，
实测发出的是 `PUT /a/v1/ontology/slices/em_order_360` → **201**，切片 99 → 100。
**要不要手工改形状：不要。改几个字段：0 个。**

### 陷阱 4 · 发布可绕过会签 → ✅ **成立，而且比描述的更彻底**

我做了最尖锐的那个版本 —— **先在屏上把会签开起来，再从旁边绕过去**：

```
1) 屏上点「发起发布会签」
   POST /a/v1/ontology/publish-requests → 201
   { id: preq_demo_1788070309438_17, ontologyVersion: 4, status: "PENDING_SIGNOFF",
     signoffs: [17 个域 · decision 全为 null] }          ← 17/17 全未决

2) 会签还挂着 PENDING 的同时，拿一个普通用户 JWT 直接打裸路由：
   POST /a/v1/ontology/publish  {}   → HTTP 200
   → { version: 4, snapshot:{ objectTypes: 112 个 }, ... }
              ↑ 正是会签单要卡的那个版本，0 个签署，照发不误
```

**会签单锁的是 v4，裸路由把 v4 发了出去，会签单还在那儿 PENDING。**
另外，屏上主路径 `POST /modeling/drafts/:id/publish`（第 10 步的「发布」按钮）**也不问会签**，直接 200。
⇒ 会签对这两条路都是装饰品。

### 陷阱 5 · `wo_for_model` / `wo_on_line` / `sched_for_wo` 实例全 0 → ⚠ **一半成立；我建的本体里是「全 0」，但结论要改写**

**出厂本体侧（部分证伪）**：点开一个 WorkOrder 的 360 页 `/o/WorkOrder/WO-LINE-WS-changzhou-assembly-0`：

```
关系
  line_runs_work_order · ← · 1        常州装配线(Line)          ← 生产订单确实连得上产线
  txn_from_wo · ← · 1                 TXN-RCPT-…(InventoryTxn)
  work_order_sampled_by_quality_lot · → · 1
  work_order_yields_wip_lot · → · 1
```

`wo_on_line` / `wo_for_model` / `sched_for_wo` 三个键**确实一条实例都没有**（360 页上完全不出现），
但「生产订单连不连得上产线」这个**业务问题的答案是「连得上」** —— 走的是**另一个键** `line_runs_work_order`。
⇒ 真实形态是**同一层语义有两套并存的关系键，一套接了实例、一套没有**，不是「连不上」。
（`wo_for_model`「工单→型号」这一跳则确实没有任何替代键接上，那一条是真缺口。）

**我建的本体侧（完全成立，而且更糟）**：
`em_orderline_produced_on_line`（EmOrderLine → EmProdLine，我的「生产订单→产线」）**0 条实例**。
不止它 —— 我的 **19 条边（11 条手建 + 8 条平台自动派生）全部 0 条实例**。

---

## 另找到的障碍（我没被告知的 8 条）

### A1 · 隔离区把整个后台钉死在错误边界，只有 F5 能救 —— 而且它先毁掉了我的测量工具

对照实验（同一次会话，只改一个变量）：

| 阶段 | 动作 | 屏上 |
|---|---|---|
| A | F5 后点「域管理」 | 正常，「新建域」按钮在 |
| B | 点左导航「隔离区」 | `⚠ 页面出错了 / (data ?? []).filter is not a function / 刷新` |
| C | **再点「域管理」** | **还是错误页**，「新建域」按钮消失 |
| D | F5 | 恢复正常 |

`QuarantinePage.tsx:31` 抛 `TypeError`，错误边界在 `AdminGuard` 之上，**任何后续客户端路由跳转都换不掉它**。
**这一条是我第一次全量扫描 45 个后台页时的真实事故**：扫到隔离区之后，剩下 40 页全部只抓到一个「刷新」按钮，
差点让我报出「全平台没有任何管理入口」这个恰好相反的结论 —— 是**金丝雀（域管理必须有「新建域」）当场报假**才拦住的。

### A2 · 闭环验证(VLE) 同样崩，且刷新也救不回来

`/admin/validation` → `TypeError: runs.map is not a function`（`ValidationPage.tsx:196`）。
与 A1 不同的是，**F5 之后照崩** —— 这一页今天完全打不开。

### A3 · 「新建域」建出来的域，建模画布里用不了（两份不同的域清单）

| 来源 | 内容 |
|---|---|
| 域管理表（我建完之后 19 行） | capacity · commercial · decision · equip · external · factory · finance · forecast · people · plan · process · product · quality · supply · unassigned · **em_capacity · em_delivery · em_demand · em_material** |
| 建模画布「归域…」下拉（14 项，F5 前后一模一样） | factory · product · process · equip · people · quality · capacity · forecast · **sales** · **material** · finance · plan · external · decision |

**两份清单互相都有对方没有的项**：下拉缺我新建的 4 个域，还缺 `commercial`/`supply`/`unassigned`；
反过来下拉里的 **`sales` 和 `material` 在域注册表里根本不存在**。这不是缓存问题（F5 验过），是两个真相源。

### A4 · 推演沙盘的扰动落点下拉被截断到 100 项，连平台自己种的落点都选不到

`sandbox-perturbation-object` 共 **100 个 option**，字母序 `obj_araging_ar-90plus` … `obj_bomdetail_BDTL-…` 就没了。
**金丝雀**：平台 `SEED_DEMO` 自己把种子扰动落在 `obj_material_sep_film` 上 —— 这个对象**也不在这 100 项里**。
⇒ 屏上无法复现平台自己的演示扰动，更不用说落到我的对象上。没有搜索框。

### A5 · 两条写入路径的域校验不一致 —— 屏上建出来的类型挂在不存在的域上

```
走草案发布（屏上主路径）：domain:"sales" → 落库成功，6 个类型今天就挂在 sales/material 上
走直连 API：POST /a/v1/ontology/object-types  domain:"sales"
   → 400  "未知域 'sales'（需先在 /a/v1/ontology/domains 注册）"
```
同一个值，一条路放行一条路拒绝。**屏上那条路是不校验的那条。**

### A6 · 对象类型建错了删不掉

屏上：`/admin/ontology-relations` 只有「停用类型 / 下线类型」，没有删除。
API：`DELETE /a/v1/ontology/object-types/:key` → **404 route not found**（4 个都试过）。
⇒ 我这次测试留下的 4 个 `EmTrap*` 试探类型今天清不掉；它们连同别的孤立类型一起，
让不变式「对象类型必须至少连着一条关系」处于**不成立**状态（实测 `participants` 20 条，其中就有这 4 个）。

### A8 · 收工时「本体关系」页变成永久崩溃页 —— 而它是全平台唯一能建边的入口

```
/admin/ontology-relations
  → TypeError: Cannot read properties of undefined (reading 'join')
     at OntologyRelationsPage (OntologyRelationsPage.tsx:50)
  → ⚠ 页面出错了 / 刷新     ← 按「刷新」还是这一页，F5 也一样
```

**它在本次会话里成功渲染过两次**（截图 `58-countersign.png`、`59-trap5-refs.png`），
所以是被我这一路建模留下的某个状态触发的，不是一开始就坏。
**影响是硬的**：建结构边、建因果边、停用/下线关系、发起发布会签 —— 这四件事**只有这一页有入口**。
这一页崩了，这套本体今天就**再也加不了任何一条边**。

我作为使用者做了 5 次排除，全部不是原因（每一次都做成了对照实验）：

| 排除的假设 | 做法 | 结果 |
|---|---|---|
| 会话过期 / 401 | 同一会话看别的页 | 域管理 19 行、对象/类型浏览 112/112，**都正常** |
| 某个类型 `properties` 为空 | 全表扫出唯一一个（`EmTrapCanary`），补回一条属性，再发布一版快照 | **照崩** |
| 已发布快照不完整 | 逐版查 v1–v5：`objectTypes` / `linkTypes` 都在，边的两端类型都在册 | **快照是完整的** |
| 某个接口回了 `undefined` 数组 | 逐条扫 `ontology/invariants`（8 条 · `participants` 全是数组）、`sim/propagation-rules`（43 条 · 键完全一致）、`ontology/domains`（19 条） | **没有缺数组的条目** |
| 陈旧会签单（v4 那张被裸发布抢发了，见陷阱 4） | 再建一张指向 v6 的新会签单 | **照崩** |

**从屏上没有任何办法再往下查，也没有任何办法恢复** —— 错误页上只有一个「刷新」按钮，按了还是错误页。
这正是使用者视角下最糟的形态：**一个我自己的正常操作把关键入口弄没了，而屏幕既不告诉我为什么，也不给我退路。**

### A7 · 类型显示名写死成原始数据集名，改不了

10 个类型的 `displayName` 是 `mes_base_master` / `erp_sales_orders` / `iot_equipment` 这种源数据集名。
操作面板的「改名」改的是 **typeKey**，屏上没有第二个改显示名的地方。
后果：`/v/graph` 本体图谱里我的 10 个节点全部显示成数据集文件名
（金丝雀：出厂类型在同一张图上显示为「生产基地」「订单明细行」这样的中文业务名）。

---

## 收尾 A · 灌数据 —— ✅ 超额完成

要求「至少 3 个类型有真实例」。实测 **10 / 10**，一个「对象化」按钮完成（`POST /modeling/drafts/:id/materialize` → 202 → SUCCEEDED）：

```
EmSalesOrder 500 · EmOrderLine 873 · EmEquipment 780 · EmProdLine 130 · EmBomItem 105
EmDeliveryPromise 50 · EmCustomer 20 · EmSupplier 15 · EmPlant 13 · EmMaterial 8      合计 2,494
```

抽查实例内容（`/o/EmProdLine/LINE-WS-changzhou-assembly`）：
`lineId / baseId=changzhou / name=常州装配线 / max_capacity_day=16896 / target_yield=0.978 …` —— **是真数据，不是占位**。

---

## 收尾 B · 用起来 —— ❌ 断在第 1 跳

### 断点定位（四次排除法 + 两次金丝雀）

| # | 排除的假设 | 做法 | 结果 |
|---|---|---|---|
| 1 | 预算不够（maxNodes 截断） | 200 → 4000 | 500 节点 · **0 边** |
| 2 | 链路键选错（手建的 `em_*` 不认） | 换成平台自动派生的 3 个键 | **0 边** |
| 3 | 根节点太多挤爆遍历 | 换微型切片：根 EmPlant（13 个实例） | 13 节点 · **0 边** |
| 4 | 是不是切片解析器本身坏了 | **金丝雀**：出厂切片 `order_fulfillment_360` | **531 节点 · 570 边** ✅ |
| 5 | 是不是切片这一个屏的问题 | 换屏：我的对象 360 页 | 「关系：暂无数据」 |
| 6 | 是不是 360 页对新类型都这样 | **金丝雀**：同一个 objectKey 的出厂类型 `Line` 的 360 页 | **4 组关系、真邻居** ✅ |

### 三态定性

> **接了线没数据。** 不是「没接线」，也不是「接了线接错地方」。

依据（逐条对上 CLAUDE.md 铁律 0.5 的三分法判据）：

- **不是「没接线」**：19 条关系类型在册且状态「启用」，`/admin/ontology-relations` 表里逐条可见；
  切片规划器 `POST /a/v1/slices/plan` 沿它们**真的算出了 7 条最短路**并标注跨域 `CAPACITY/FACTORY/MATERIAL/SALES`；
  切片解析器接受这些键，返回 200 而不是「未知链路」。**消费方是有的，而且真的跑到了。**
- **不是「接了线接错地方」**：换成平台自己派生、由 `ref` 属性反推的那 8 条键，挂载点是平台自己选的，照样 0 条边。
- **是「接了线没数据」**：`ref` 属性本身**值是全的**（`EmOrderLine.orderRef → refToTypeKey: "EmSalesOrder"`，
  实例上 `baseId=changzhou` 这样的外键值都在），但**没有任何一步把这些外键值变成 link 实例**。
  「对象化」作业只物化**对象**，不物化**边**；而屏上的「建结构边」表单只登记 `key/from/to/基数`，
  **没有一个字段说「这条边由哪个属性实现」**。两头都不产边，于是边永远是 0。

### 推演路

同样跑不起来，而且更早一步就断：
1. 就绪门先说话：`NO_SLICE · GLOBAL — 图查询覆盖 97/108 对象，切片 101 < minQueries 1` —— 差的 11 个里就有我的 10 个；
2. 就算不管就绪门，**扰动落点下拉里没有我的任何一个对象**（障碍 A4，带金丝雀）。
   我建的那条跨域因果边 `EmSupplier.deliveryDelay --0.8--> EmDeliveryPromise.promiseRisk`
   在「传导边 43 条（其中启用 43 条）」里被算进去了，**但今天没有任何屏上办法给它一个起点**。

---

## 我做过的金丝雀（报否定结论前的自证）

| # | 我要报的否定结论 | 金丝雀 | 结果 |
|---|---|---|---|
| 1 | 「45 个后台页里没有新建对象类型入口」 | 域管理必须抓到「新建域」 | 第一次 **false → 判「我的工具坏了」**，查明是 A1 污染；排除后 **true**，结论才敢报 |
| 2 | 「我的切片 0 条边」 | 出厂切片 `order_fulfillment_360` | 531 节点 / 570 边 ✅ |
| 3 | 「我的对象 360 没有关系」 | 同一个 objectKey 的出厂类型 `Line` | 4 组关系、真邻居 ✅ |
| 4 | 「沙盘落点选不到我的对象」 | 平台自己的种子落点 `obj_material_sep_film` | **也不在** ⇒ 是下拉的通用缺陷 ✅ |
| 5 | 「constraintRefs 被丢弃」 | 不带 constraintRefs 的同款 POST | 201 且回读正常 ✅ |
| 6 | 「`deliveryDelay` 这种状态变量不合法」 —— **没敢报** | 先查 40 项白名单 | `deliveryDelay` / `promiseRisk` **都在** ⇒ 这条不成立，没写 |
| 7 | 「我的类型在图谱里不存在」 —— **没敢报** | 改用 displayName（数据集名）再搜一次 | **10 个全在** ⇒ 改写成 A7「显示名不可改」 |

> 第 6、7 条是两次**差点报出去的假结论**，都是金丝雀拦下来的。

---

## 环境与可复现性

```bash
# 三个服务（端口都与出厂默认错开，避免撞车）
PORT=4451 JWT_SECRET=dev BLOB_DIR=/tmp/onto-blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
PORT=4452 DATACORE_BASE_URL=http://127.0.0.1:4451 JWT_SECRET=dev node apps/agentcore/dist/main.js
VITE_DATACORE_URL=http://127.0.0.1:4451 VITE_AGENTCORE_URL=http://127.0.0.1:4452 \
  npx vite --port 5451 --host 127.0.0.1     # VITE_MOCK 未设
```

⚠ 起前置：`pnpm --filter @platform/contracts build` 和 `pnpm --filter @platform/llm-adapters build` 必须先跑，
否则报 `TS2307` 这种与本单无关的假红。

**最终落库状态**（收工时逐项实测，可直接复核）：

| 项 | 值 | 起始值 |
|---|---|---|
| 对象类型 | **112 / 112**（108 建模产物 + 4 个 `EmTrap*` 陷阱试探类型） | 98 |
| 结构边 | **133** | 114（起始）→ 122（发布后自动派生 +8）→ 133（我手建 +11） |
| 生效因果边 | **43** | 42 |
| 已注册切片 | **101**（多跳业务切片 6 条 · 单类型覆盖切片 95 条） | 99（多跳 4 条） |
| 域 | **19** | 15 |
| 已发布本体版本 | **v5** | v1（61 类型 / 103 边） |
| 会签单 | **2 张全部 `PENDING_SIGNOFF`**（v4 那张已被裸发布抢发，成了孤儿） | 0 |
| 我的 10 个类型的实例 | **2,494 个** | 0 |

> ⚠ 这是内存模式，进程一停全没。要复核请照上面的命令重起并**按逐步表重走一遍**。
> ⚠ `/admin/ontology-relations` 在这个终态下是**崩溃**的（障碍 A8）。

## 截图

全部 62 张在 `docs/assets/onto-e2e/`，关键几张：

| 文件 | 看什么 |
|---|---|
| `29-domains-created.png` | 域 15 → 19 行（对照实验） |
| `31-draft-10-generated.png` | 10 个类型的草案生成出来 |
| `32-renamed.png` | 10 个 typeKey 改成 Em* |
| `36-objecttypes-after-publish.png` | **108 / 108 类型**，我的 10 个全部在册且有实例数 |
| `37-edges-created.png` · `40-causal-created.png` | 结构边 133 · 因果边 43 |
| `42-objectified.png` | 「对象化作业进度: SUCCEEDED」 |
| `45-slice-planned.png` | 7 条跨域最短路 |
| `47-slice-preview.png` · `49-slice-preview-4000.png` · `52-tiny-slice.png` | **0 条边** ×3 种条件 |
| `50-canary-order-fulfillment.png` | **金丝雀 570 条边** |
| `54-object-360.png` vs `55-canary-360-Line.png` | 同一个 objectKey：我的「关系 暂无数据」 vs 出厂的「4 组关系」 |
| `22-quarantine-crash.png` · `23-domains-broken-after-quarantine.png` | 障碍 A1 的 B 态与 C 态 |
| `57-sim-perturb.png` | 落点下拉 100 项截断 |
| `58-countersign.png` | 会签单 17/17 未决（这张同时是**本体关系页最后一次正常渲染**的证据） |
| `62-final-state.png` | 障碍 A8：收工时本体关系页的崩溃态 |

---

## 我作为使用者的一句话感受

**这套系统能把一个本体从零建起来 —— 而且比我预期的完整得多：10 个类型、12 条边、2,494 个实例，
全部是点出来的，一次都没求助过 REST。**
**但它建完之后不会自己接起来。** 关系是登记在册的名字，实例之间没有一条真边；
于是「多跳检索」返回 0 条边、「推演」连落点都选不到、就绪门说「图查询覆盖 97/108」。
**我建的是一张精确的地图，上面没有一条路是通的。**
最扎心的是最后：把地图画完之后，画地图的那支笔（本体关系页）自己坏了，屏上不告诉我为什么，也不给我退路。
