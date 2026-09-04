# 提案 · 结构边物化的残口（`viaProperty` 表达不了的那一批）

> **WO-EDGE-MATERIALIZE-GAP** · 只读取证 + 提案，零源码改动。
> **base commit**：`bf8338a0`（`wo-edge-gap`，切自 `origin/claude/handoff-integ-batch-3`）
> **取证方式**：TS AST 静态抽取（`ts.createSourceFile`）+ 逐条读种子写入方源码。**未起服务、未跑测试套件。**
> **树龄探针**：`wc -l apps/datacore/src/synthetic/battery.ts` = **6013**

**一句话**：`viaProperty` + `viaSide` 把「建完的边用不了」从 **100% 治到 80%**；
剩下的 **21/104 条（20.2%）** 不是「没人去声明」，是**元模型里没有能表达它们的形状**。
本提案给出这 21 条的分桶、每桶的候选机制与代价，以及仓主要拍的 3 个板。

---

## §0 · 本体引用与影响（铁律 0 要求）

- **对象类型**：`LinkTypeDef`（声明层）· `LinkInstance`（实例层）· `ObjectTypeDef.properties[].isPrimaryKey` / `.refToTypeKey`
- **链路**：`POST /a/v1/ontology/link-types` → `upsertLinkType` → `materializeDeclaredLinks` → `repos.links` → `executeSlice` 多跳检索
- **不变量**：R6（确定性·重跑字节一致）· R2（tenant 隔离）
- **断点**：`G-LINKTYPE-DECL-ONLY`（声明层与实例层之间无桥）——`viaProperty` 已闭其 **80%**，本文件登记**未闭的 20%**
- **本提案不改本体**：一行源码不动 ⇒ 无需回写 `SYSTEM-ONTOLOGY.md`。**若仓主批准第 5 节任一裁决点，届时必须回写。**

---

## §1 · 先复测派单里给的每一个数（台账说的不度量真实）

### 1.1 取数方法与金丝雀

判据必须与生产实现同口径。生产实现是
`apps/datacore/src/ontology.ts:326` `materializeDeclaredLinks`：

```
apps/datacore/src/ontology.ts:330   if (!def.viaProperty) return { created: 0, ... };   // 不声明 ⇒ 0 实例
apps/datacore/src/ontology.ts:342   const anchorPk = anchorType.properties.find((p) => p.isPrimaryKey)?.propKey ?? "id";
apps/datacore/src/ontology.ts:360   const anchorId = anchors.get(String(raw));         // carrier.props[via] === anchor 的**业务主键值**
```

⇒ 一条边「能被 `viaProperty` 表达」的充要条件：
**carrier 侧存在一个属性，其值等于 anchor 侧的业务主键值（`objectKey ?? props[pk]`）。**

静态可判定的近似：carrier 上存在属性名 === anchor 的主键名，**或**该属性声明了 `refToTypeKey === anchor 类型`。
（`refToTypeKey` 是 `PropertyDef` 上已存在的字段，见 `apps/datacore/src/synthetic/battery-extended.ts:104` `rd()`。）
⚠ 这个近似**会漏报**——属性名不同但值对得上的照样能用。第 2 节对全部漏报逐条读源码复核，结果见 §2.8。

**金丝雀（不中就报「工具坏了」，不许报数）**

| 金丝雀 | 目的 | 实测输出 |
|---|---|---|
| A · `ProductSeries.platformId` 抽得到 | 证明 `battery.ts` 属性抽取没坏 | `ProductSeries: 9 props, pk=seriesId` ✅ |
| B · `Material.supplierId` 抽得到 | 证明 `battery-extended.ts` 第二个类型源也被扫了 | `Material: 19 props, pk=matId` ✅ |
| C · `series_belongs_to_platform` 判为 source 侧 | 该边被 `linktype-via-property.seam.test.ts:56` 实跑验证过 | `srcFk=platformId tgtFk=null` ✅ |
| D · `line_belongs_to_base` 判为 target 侧 | 该边被同一测试 `:113` 以 `viaSide:"to"` 实跑验证过 | `srcFk=null tgtFk=baseId` ✅ |
| E · `material_supplied_by` 经 `refToTypeKey` 命中 | 证明 ref 通道也在工作 | `srcFk=supplierId (byRef)` ✅ |
| F · 边用到的 73 个类型里，属性表为空 / 无主键的个数 | 空表会造出**假的**「两侧都没 FK」 | **0 / 0** ✅ |

**第一版工具是坏的，被金丝雀当场抓住**：只扫 `batteryObjectTypes()` 时，
104 条边里 **29 条**的端点类型「不存在」（`Material` / `Supplier` / `Customer` …）。
真相是类型有**两个源**——`batteryObjectTypes()`（`battery.ts:2931`，61 个）与
`extendedObjectTypes()`（`battery-extended.ts:115`，34 个），
分别由 `synthetic/service.ts:691` 与 `:808` 种下。补上第二个源后 95 个类型全齐、缺失端点归零。
**若当时就报数，会得出「28% 的边端点类型不存在」这个与事实相反的结论。**

### 1.2 复测结果 vs 派单前提

| 量 | 派单里写的 | **我实测** | 差异原因 |
|---|---|---|---|
| 真实边总数 | 114 | **104**（`batteryLinkTypes()`，`battery.ts:3037–3225`） | 见下 |
| FK 在 source 侧 | —— | **55**（52.9%） | —— |
| FK 在 target 侧 | 20.2% | **28（26.9%）** | 与 `domain.ts:481` 注释里的「116 条 / 23 条 / 19.8%」也对不上 |
| **两侧都没有 FK** | **35（30.7%）** | **21（20.2%）** | 见下 |

**「104 vs 114/116」的成因（已追到）**：demo 租户的结构边有**两个来源**——
`batteryLinkTypes()` **104 条**（`synthetic/service.ts:697`）＋
`processLayerLinkTypes()` **11 条**（`process/ontology.ts:149`，2 条固定 + 9 个承载类型，
`seed.ts:1792` 种下）＝ **115**。`domain.ts:481` 写的 116 与此差 1，且该注释写死了「23 条 / 19.8%」
——**行号会漂，写死的比例同样会漂**。

⚠ **11 条流程层边是第三种机制，不该和这 104 条混在一起算**：
`process/ontology.ts:167` 原文「**只写定义，不写实例行（R4）**…实例行由反推器写进
`process_instances` 派生投影表」。它们的 `LinkInstance` 数**恒为 0**，
而这不是缺陷——它们本来就走另一条渲染路。**混算会让分母虚高、结论虚低。**

**「35 vs 21」的成因**：我的判定器把 `refToTypeKey` 也算作 FK 通道
（`Order.model→Model`、`InventoryTxn.woRef→WorkOrder` 这类**名字与主键不同**的引用属性，共 **24 条边**靠它命中）。
只按「属性名 === 对侧主键名」判，会多报 24 条为「没有 FK」——那正是 35 这个量级。
**`refToTypeKey` 是 `PropertyDef` 上已经存在的字段，生产 `materializeDeclaredLinks` 今天不读它，
但它的存在证明「这条边由哪个属性实现」在元模型里已有一半答案。** 这是第 3 节候选 D 的全部由来。

### 1.3 复现命令

```bash
# 1) 抽 batteryLinkTypes() 的 104 条声明（括号配平抽数组字面量后 eval）
node -e 'const s=require("fs").readFileSync("apps/datacore/src/synthetic/battery.ts","utf8");
  const i=s.indexOf("export function batteryLinkTypes(");console.log(s.slice(i,s.indexOf("\n}",i)).match(/key: "/g).length)'
# → 104

# 2) 金丝雀：确认 pathspec 没骗人（本仓 `apps/*/src` 恒 0，必须写 `apps/*/src/*`）
git ls-files -- 'apps/*/src/*' | wc -l          # → 671（非 0 ⇒ 工具是好的）

# 3) 两个类型源各自的条目数
grep -cE '^\s*(plain\(|plainD\(|\{ key:)' <(sed -n '2947,3035p' apps/datacore/src/synthetic/battery.ts)   # → 60(+1 spread) 
grep -c '^    def("' apps/datacore/src/synthetic/battery-extended.ts                                       # 第二源

# 4) 流程层 11 条（2 固定 + 9 承载类型）
grep -o 'typeKey: "[A-Za-z]*"' apps/datacore/src/process/flow-rules.ts | sort -u | wc -l                   # → 9
```

完整分类脚本（AST 版，含全部 6 个金丝雀）不落仓（范围边界只许新建本文件），
逐条输出已内联在下面各节，可按上表的 file:line 独立复核。

---

## §2 · 21 条按「为什么没有 FK」分桶

先说结论：**派单预判的 4 个桶里，① 多对多与 ② 规则决定 命中；③ 跨系统边界 实测 0 条；
④ 时序/事件产生 实测 0 条（`scheduled_on`/`consumes_capacity` 今天压根没被声明成边，见第 4 节）。
另外实测出 3 个派单没预判到的桶：② 非主键外键（5 条，最大的一桶）、③ 多态外键、⑤ 数组值外键。**

| 桶 | 条数 | 一句话病因 |
|---|---:|---|
| ① 关系即实体（FK 在桥实体上 / 边自带属性） | 4 | 关系有自己的身份，两端谁都装不下 |
| ② **外键指向的不是对侧业务主键**（自然键 / 名称键 / 别名键） | **5** | 值对得上，但对的是**名字列**不是主键列 |
| ③ 多态 / 条件外键（目标类型随行变，或要谓词过滤） | 3 | 一列 `refId` 装 5 种目标 |
| ④ 关系由规则/函数决定，不存在任何外键列 | 6 | 边是**算**出来的，不是**查**出来的 |
| ⑤ 数组值外键（一个属性装多个对侧主键） | 1 | `String(["B1","B2"])` 匹配不上任何主键 |
| ⑥ 经第三方键 join，而那个第三方不是对象类型 | 1 | 两侧都有 `operatorId`，但没有 `Operator` 类型 |
| ⑦ 边即数据（硬编码常量边表） | 1 | 边本身就是源数据，不派生自任何对象 |
| **合计** | **21** | |

### ① 关系即实体 — 4 条

| 边 | 桥实体 / 证据 |
|---|---|
| `model_certified_on` Model→Line [N:N] | 桥 `Certification(certId, modelId, lineId, status)` **已是一等类型**，且已声明 `model_has_cert`。边本身还带 `props:{status, modelId, baseId}`（`synthetic/service.ts:906`）——**`materializeDeclaredLinks` 写出的边一律无 `props`（`ontology.ts:365`），认证状态会整个丢掉** |
| `model_uses_material` Model→Material [N:N] | 桥 `BOMDetail(bomDetailId, bomId, materialId)`，三跳 `bom_belongs_to_version`→`detail_belongs_to_bom`→`detail_uses_material` 都在。⚠ 实测种子**没走这条桥**：`service.ts:1019` 用 `matIds[(mi*2+k) % matIds.length]` 的**下标算术**造 BOM |
| `material_used_by_model` Material→Model [N:N] | 同上逆向（`service.ts:1025`，与正向共用同一个 `bom` 变量） |
| `model_changeover` Model→ChangeoverMatrix [N:N] | `ChangeoverMatrix(pairId, fromModel, toModel, minutes, lineId)` 是 **pair 实体**：两个 FK 同指 Model。种子只连了 `fromModel` 一侧（`service.ts:1107`）⇒ **`toModel` 那半语义今天在图上不存在** |

### ② 外键指向的不是对侧业务主键 — 5 条（最大的一桶）

`materializeDeclaredLinks` 只认 anchor 的**主键值**（`ontology.ts:342`）。这 5 条的外键列存的都是**别的列**：

| 边 | 外键列装的是 | 证据 |
|---|---|---|
| `customer_has_invoice` Customer→ARInvoice | `ARInvoice.custName`（Customer 主键是 `custId`） | `service.ts:1067` `custByName` 反查表 |
| `customer_has_overdue_record` Customer→OverdueRecord | `OverdueRecord.customerRef` **存的是 custName** | `service.ts:1306` 注释原文：「`od.customerRef` 是 custName ⇒ 经 `custByName` 换 `custId`」 |
| `material_has_balance` Material→MaterialBalance | `MaterialBalance.material` **是物料中文名** | `service.ts:1299` `matIdByName`；注释原文「MaterialBalance 只有 `material` 中文名，没有 `matId`」 |
| `scenario_to_target` AnnualScenario→PlanTarget | `PlanTarget.scenarioKey` → `AnnualScenario.key`（主键是 `scnId`），且要**拼串** `AOP-2026-${scenarioKey}` | `service.ts:1189` |
| `scenario_to_finance` AnnualScenario→FinanceMetric | `FinanceMetric.scenarioKey` → `AnnualScenario.key` | `service.ts:1198` |

⚠ **这一桶最值钱，因为它离能用最近**：外键**在**，值也**对得上**，
差的只是「对得上的那一列不是主键」。同一件事，代价见第 3 节候选 A。

⚠ 同一桶里还有一个已经被种子**主动拒绝**的教训（不算在 5 条里，但同源）：
`service.ts:1307` 注释原文——`OverdueRecord.invoiceRef` 形如 `INV-CG-001`，
而真 `ARInvoice` 主键是 `arinvoice_<i>_<j>`，**对不上任何一张真发票**，
于是种子**改走客户这一层**而不是照名字猜着连。**「张冠李戴的数比没有更危险」。**

### ③ 多态 / 条件外键 — 3 条

| 边 | 形态 | 证据 |
|---|---|---|
| `exc_sourced_from` ExceptionEvent→EquipmentDowntime [N:1] | `ExceptionEvent(refType, refId)` 是**多态外键**：`refType` 决定 `refId` 指向 5 种类型中的哪一种，边上还回写 `props:{refType, refId}` | `service.ts:1124` `oid(refType, refId)` |
| `defect_raises_exception` DefectRecord→ExceptionEvent [1:N] | 只在 `refType === "DefectRecord"` 时才建 | `service.ts:1129` |
| `material_carbon` Material→CarbonFactor [N:N] | `CarbonFactor(kind, key)` 是**通用查表**：`kind==="material"` 时 `key` 才是 `matId` | `service.ts:1103` |

⚠ 后两条**技术上今天就能用 `viaProperty` 表达**（`refId` / `key` 装的确实是对侧主键值），
但**会连出多余的边**——没有谓词过滤，`refType==="EquipmentAlarm"` 的行也会被连进
`defect_raises_exception`。**「能连出边」和「连对了边」是两个命题**（铁律 1.5）。

### ④ 关系由规则/函数决定，不存在任何外键列 — 6 条

| 边 | 边是怎么算出来的 | 证据 |
|---|---|---|
| `model_in_segment` Model→Segment | 型号串匹配：`modelId.includes("S192")→"ess"｜"L148"→"com"｜else→"pas"` | `service.ts:1113` |
| `order_to_plantarget` Order→PlanTarget | `due.slice(0,7)` 取月份，再拼 `PT-${month}` | `service.ts:1202–1205` |
| `plantarget_ownedby` PlanTarget→Principal | `level==="month" ? "prin-plan" : "prin-coo"` | `service.ts:1216` |
| `line_belongs_to_workshop` Workshop→Line | `lineId.replace("LINE-","")` 派生 workshopId；**Line 上没有 `workshopId` 属性** | `service.ts:993` |
| `base_data_health` Base→DataSourceHealth | **笛卡儿全连接**：每基地 × 每数据源 | `service.ts:1116`（双重 for） |
| `scenario_to_capex` AnnualScenario→CapexProject | 笛卡儿积**按条件裁剪**：`key==="conservative"` 的情景跳过 | `service.ts:1193–1194` |

判据：**这 6 条的「边」不是数据里的一列，是一段表达式**。补外键列 = 把计算结果冻结成数据（会腐化）。

### ⑤ 数组值外键 — 1 条

`model_producible_at` Model→Base [N:N]：`Model.bases` 是**字符串数组**。
`materializeDeclaredLinks` 走 `String(raw)`（`ontology.ts:360`）⇒ `"B1,B2"` 匹配不上任何 `baseId`。
种子绕开 `putLink`、直接双层 for 手写 `repos.links.put`（`service.ts:881–890`）。

### ⑥ 经第三方键 join，第三方不是对象类型 — 1 条

`cert_for_operator` OperatorSkillCert→OperatorAttendance [N:1]：
两侧**都有 `operatorId`**，但两侧主键分别是 `certId` / `attId`，
**`Operator` 不是对象类型**（95 个类型里没有它）。

⚠ **这条边全仓零个实例写入方**：

```bash
grep -rn 'cert_for_operator' apps/datacore/src apps/agentcore/src apps/frontend-shell/src packages/contracts/src apps/datacore/test
#  battery.ts:3151                     ← 声明
#  agentcore/src/mocks/ontology-graph.ts:183 ← mock 图里也画了一笔
#  （零个 putLink / links.put）
# 金丝雀：同法查一条我确定有写入方的边
grep -rn 'material_has_balance' apps/datacore/src ... | wc -l   # → 8（含 service.ts:1303 的 putLink）✅
```

**它是「声明了、mock 里画了、真图上一条实例都没有」的边。** 与本单主题同源但更早一步：
不是「元模型表达不了」，是**连种子都没连**。

### ⑦ 边即数据（硬编码常量边表）— 1 条

`caused_by` CausalFactor→CausalFactor [N:N]：边来自常量数组 `CAUSAL_EDGES`
（`battery-extended.ts` 导出，`service.ts:1221` 遍历）。
`CausalFactor` 的属性表里**一个引用属性都没有**（`factorId/label/drillType/drillId/…`，`refs: (none)`）。

⚠ **这是我的判定器唯一一处假阳性，必须点名**：自环边（`from === to`）上，
「carrier 有一个属性名 === anchor 的主键名」恒成立——因为那就是它自己的主键。
自动判定器会说「两侧都有 FK」，若照它去物化，会给**每个节点连一条指向自己的自环**。
**我把它从「两侧都有 FK」改判进本桶，`caused_by` 是全仓唯一一条自环边。**

### 2.8 · 判定器漏报的复核（对全部 21 条逐条读源码）

我的静态判据是「属性**名**」层面的，而生产判据是「属性**值**」层面的 ⇒ 必然漏报。
逐条读种子写入方后，**3 条**确认「今天用 `viaProperty` 就能连出边、只是没人声明」：

| 边 | 能用的声明 | 但会错在哪 |
|---|---|---|
| `material_carbon` | `viaProperty:"key", viaSide:"to"` | 连上 `kind!=="material"` 的因子行 |
| `defect_raises_exception` | `viaProperty:"refId", viaSide:"to"` | 连上另外 4 种 `refType` 的异常 |
| `model_changeover` | `viaProperty:"fromModel", viaSide:"to"` | `toModel` 那一半语义丢失 |

⇒ **21 条里 3 条是「差一个谓词」，18 条是「元模型形状不够」。** 这个 3/18 的切分决定第 3 节的排序。

### 2.9 · 另一类今天就在骗人的形态：**候选属性有歧义**

不在 21 条里，但同一次扫描抖出来，且**比 21 条更危险**（它会静默给出错误拓扑）：

```
候选属性 >1 个的边 = 6 条
  detail_uses_material       BOMDetail->Material           候选=[materialId, parentItemId]
  alt_for_material           MaterialAlternative->Material 候选=[primaryMaterialId, alternativeMaterialId]
  transfer_from_base         InterBaseTransfer->Base       候选=[fromBase, toBase]
  transfer_to_base           InterBaseTransfer->Base       候选=[fromBase, toBase]   ← 与上一行候选集**完全相同**
  material_has_alternative   Material->MaterialAlternative 候选=[primaryMaterialId, alternativeMaterialId]
  base_dispatches_transfer   Base->InterBaseTransfer       候选=[fromBase, toBase]
```

`InterBaseTransfer` 的 refs 实测：`fromBase->Base, toBase->Base, model->Model`。
**我的确定性推断器在 `transfer_from_base` 与 `transfer_to_base` 上都选了 `fromBase`**
——即把「调出基地」和「调入基地」连成了同一个端点，**其中一条的拓扑方向是反的，而且不会报错。**
这正是派单里点名禁止的那件事，**在我自己的工具上原样复现了一遍**。

> **判据（写进任何未来的推断器）**：候选属性 >1 时**必须拒绝推断并要求人工指定**，
> 不许「取第一个」。`viaProperty` 今天要求显式填写，**这个「麻烦」是它的正确性来源，不是它的缺陷。**

---

## §3 · 每桶的候选机制与代价

**三问纪律**（`scripts/wo-value-check.mjs`）：答不上就不写进提案。

### 候选 A · 锚点键放宽：`anchorProperty`（对 ② 5 条，兼收 ①的一部分）

**机制**：`LinkTypeDef` 增一个可选字段 `anchorProperty`——把「carrier.props[via] 去匹配 anchor 的**主键**」
放宽成「去匹配 anchor 的 `anchorProperty`」。缺省 = 主键 ⇒ **零回归**（与 `viaSide` 同型的加性扩展）。

- **谁会看见它**：建模台建边的人（`/admin/ontology-relations` 表单多一个下拉）；下游**所有**看图/多跳检索的人。
- **不做会缺什么**：客户的**发票、逾期、物料平衡、情景目标、情景财务**五类关系全部只能靠出厂硬编码存在。
  用户自己建同形状的边 ⇒ 0 实例，回到「建完用不了」。
- **删掉会不会有人发现**：会。这 5 条边今天出厂种子里**有实例**，切片检索能拿到；
  换成用户自建就拿不到——**同一条边，出厂的能用、自建的不能用，这个不一致本身就是缺陷。**
- **代价**：① 元模型加一个字段（可选，老快照不破）；② 校验要覆盖「`anchorProperty` 真是 anchor 的属性」
  （复用 `ontology.ts:277` 已有的打错字 400 逻辑）；③ **唯一性风险**——按非主键列匹配可能**一对多**
  （两个客户同名 ⇒ 一张发票连两个客户）。`ontology.ts:352` 现在是 `if (!anchors.has(k)) anchors.set(k, o.id)`
  即**静默取第一个**，放宽后必须改成**如实回报冲突数**，不许静默。

### 候选 B · 谓词过滤：`viaWhere`（对 ③ 3 条，其中 2 条今天就差这一个）

**机制**：`LinkTypeDef` 增可选 `viaWhere`（复用 A5 规则 DSL 的表达式求值），
物化时对每个 carrier 先过一遍谓词，假则跳过。`material_carbon` = `kind === "material"`；
`defect_raises_exception` = `refType === "DefectRecord"`。

- **谁会看见它**：碳排/异常溯源两条链上的人；以及任何用**通用查表**（`kind`+`key` 形态）的租户。
- **不做会缺什么**：这两条边今天要么不声明（=图上没有），要么声明后**连出脏边**——
  异常溯源下钻会把设备告警混进缺陷链。
- **删掉会不会有人发现**：会，且是**错得无声**的那种：图上多出来的边不会报错，只会让下钻结果变多。
- **代价**：① 引入表达式求值到本体物化路径（今天这条路是纯字段比对，零求值）；
  ② 求值要 R6 确定性（DSL 已有此约束）；③ **多态那一条（`exc_sourced_from`）它治不了**——
  谓词能筛行，不能让**目标类型随行变**。

### 候选 C · 桥实体投影：`viaBridge`（对 ① 4 条 + ⑥ 1 条）

**机制**：`LinkTypeDef` 声明「本边经桥类型 `B` 的两个属性 `bFrom` / `bTo` 实现」，
物化时扫 B 的每一行，两端各查一次锚点，**并把 B 的其余属性写进 `LinkInstance.props`**。
`model_certified_on` = 经 `Certification(modelId, lineId)`，`props.status` 自然带上。
`cert_for_operator` = 经一个尚不存在的 `Operator`。

- **谁会看见它**：认证/BOM/换型三条链；**以及任何做「关系带属性」建模的租户**（这是本体建模的常规形态）。
- **不做会缺什么**：**关系上的数据整个丢失**。今天 `materializeDeclaredLinks` 写出的边**没有 `props`**
  （`ontology.ts:365` 逐字段可查）⇒ 认证状态、换型分钟数、BOM 用量**一个都带不过来**。
  ⚠ 这一条与铁律 1.5 那次事故**同源**：`propagation.ts` 的传导公式里没有用量项，
  于是碳酸锂和铝箔涨价产生相同成本压力。**用量长在边上；边没有 props，传导就永远只能用常数系数。**
- **删掉会不会有人发现**：会。这是三个候选里**唯一能改变推演数值**的一个。
- **代价**：最大。① 物化循环从「扫一侧」变成「扫桥 + 双查」；② 幂等 id 要从「key+carrier.id」
  改成「key+bridge.id」（`ontology.ts:366` 现在的拼法）；③ 桥实体本身也是一个类型，
  **同一份数据会同时以「节点」和「边」两种面貌出现在图上**——这是本提案里唯一一处真正的信息架构取舍（裁决点 2）。

### 候选 D · 消费已有的 `refToTypeKey`（横切全部桶，**代价最低**）

**机制**：`PropertyDef.refToTypeKey` **今天已经存在且已被填写**——实测 **24 条边**的 FK 是靠它认出来的
（`Order.model→Model`、`InventoryTxn.woRef→WorkOrder`、`OrderLine.orderRef→Order`…）。
而 `materializeDeclaredLinks` **一次都没读它**。让建边表单在用户选定两个类型后，
**把 `refToTypeKey` 指向对侧的属性排在下拉最前面**（仅做默认值，不做自动接线）。

- **谁会看见它**：每一个建边的人——下拉从「全部属性」缩到「真正指向对侧的那几个」。
- **不做会缺什么**：用户面对一个几十项的属性下拉自己猜。猜错 ⇒ 400（`ontology.ts:284` 会点名），
  猜对但选了同类型的另一个 ⇒ **静默连错**（`transfer_from_base/to_base` 那个形态）。
- **删掉会不会有人发现**：会，但只有建边的人发现——**它不改变任何已建成的边**。
- **代价**：**最小**（纯读端、纯 UI 默认值、零元模型改动、零回归）。
  ⚠ **但必须带 2.9 的那条硬约束**：候选 >1 时**不许**自动选，必须让人选。

### 候选 E · 「表达式边」/「事件物化边」—— **本提案建议不做**

对 ④ 6 条与 ⑦ 1 条，理论上的机制是「边由 DSL 表达式产出」或「边由事件流物化」。
**三问答不上第三问**：这 7 条边今天**全部由出厂种子确定性写出、屏上已有**，
把它们改成表达式驱动，**用户看到的东西一模一样**——
它只把「谁来算这条边」从 TypeScript 挪到 DSL。按仓主判据（「这道门/这笔账删了，用户会不会看到坏东西？」）
这属于**不会**那一档。**故本提案不为 ④⑦ 提候选，只登记形态。**

⚠ 例外要单独看：**如果目标是让用户在自己的租户里建这类边**（不是复现出厂那 7 条），
那 ④ 就从「记账」变成「能力缺口」。这是裁决点 3。

---

## §4 · 20 条第一优先级关系 · 逐条「今天能不能表达」

**判据**：
✅ = 今天用 `viaProperty`(+`viaSide`) 就能声明并物化出**正确**的边；
⚠️ = 能连出边，但**语义有损**（丢属性 / 丢一半 / 会多连），损在哪逐条写明；
❌ = 元模型表达不了，归到 §2 的哪个桶。

| # | 关系 | 今天的承载 | 判定 | 依据 / 损在哪 |
|---:|---|---|:---:|---|
| 1 | `belongs_to` | `series_belongs_to_platform` `model_belongs_to_series` `version_belongs_to_model` `bom_belongs_to_version` `detail_belongs_to_bom` `routing_belongs_to_model` `operation_belongs_to_routing` `capability_belongs_to_operation` `standard_belongs_to_model` `char_belongs_to_standard` `process_belongs_to_line` `workshop_belongs_to_base` `warehouse_of_base` `line_belongs_to_base` | ✅ | 归属类共 **14 条**，全部单 FK、单候选。`series_belongs_to_platform` 已被 `linktype-via-property.seam.test.ts:56` 端到端实跑验证 |
| 1b | `belongs_to`（车间层） | `line_belongs_to_workshop` | ❌ | **桶 ④**：`Line` 上没有 `workshopId`，靠 `lineId.replace("LINE-","")` 派生（`service.ts:993`）。四层结构 Base→Workshop→Line 的**中间那一跳今天建不出来** |
| 2 | `produces` | `line_runs_work_order`(TGT `WorkOrder.lineId`) `work_order_yields_wip_lot`(TGT `WIPLot.woId`) `wo_for_model`(SRC `modelId`) | ✅ | 工单产出链三跳齐全，全单候选 |
| 2b | `produces`（型号↔基地产能资格） | `model_producible_at` | ❌ | **桶 ⑤**：`Model.bases` 是**数组**，`String(raw)` 匹配不上（`ontology.ts:360`）。⚠ 这是**产销推演最核心的一条边**——「这个型号能在哪些基地生产」 |
| 3 | `compatible_with` | `alt_for_material`(SRC `primaryMaterialId`) `product_line_capability`(SRC `lineId`) `product_equip_capability`(SRC `equipmentId`) | ⚠️ | 三条**能连出边**，但 `alt_for_material` / `material_has_alternative` 的候选集是 `[primaryMaterialId, alternativeMaterialId]` **两个同型 FK**（§2.9）⇒ 选错即**主/替物料接反**，且不报错 |
| 3b | `compatible_with`（型号↔产线认证） | `model_certified_on` | ❌ | **桶 ①**：桥 `Certification(modelId, lineId, status)` 已存在；且边带 `props.status`（量产/认证中），而物化边**无 props**（`ontology.ts:365`）⇒ **认证状态整个丢失** |
| 4 | `orders` | `order_of_customer`(SRC `customerId`·ref) `po_from_supplier`(SRC `supplierId`) `po_replenishes_material`(SRC `matId`) `order_has_line`(TGT `orderRef`) | ✅ | 销售侧与采购侧各自成链，全单候选 |
| 5 | `contains` | `order_has_line`(TGT `OrderLine.orderRef`) `detail_belongs_to_bom`(SRC `bomId`) `line_has_process`(TGT `Process.lineId`) | ✅ | —— |
| 6 | `requires` | `detail_uses_material`(SRC `materialId`) `spare_for_maint`(SRC `moId`) | ⚠️ | `detail_uses_material` 的候选集是 `[materialId, parentItemId]`（§2.9）——`parentItemId` 是**父项号**，选错即把 BOM 层级当成用料。**能连，但选错不报错** |
| 7 | `has_bom` | `bom_belongs_to_version`(SRC `versionId`) + `detail_belongs_to_bom`(SRC `bomId`) | ⚠️ | 两跳都 ✅，**但 BOM 用量 `BOMDetail.qty` 留在节点上，边上没有**。铁律 1.5 那次事故的根因正是「用量不在传导公式里」⇒ 这条链今天**只能表达结构，不能表达配比** |
| 8 | `uses` | `equip_used_in`(SRC `processId`) `process_uses_equipment`(TGT `processId`) | ✅ | 设备↔工序双向都在，单候选 |
| 8b | `uses`（型号↔物料） | `model_uses_material` / `material_used_by_model` | ❌ | **桶 ①**：FK 在桥 `BOMDetail` 上。⚠ 且实测种子**没走桥**——`service.ts:1019` 用下标算术 `matIds[(mi*2+k)%len]` 造 BOM，即屏上这条边**不是真 BOM** |
| 9 | `fulfills` | **无** | ❌ | **图上不存在 Order→WorkOrder 边**。实测 Order 的全部 8 条边：`order_for_model` `model_demanded_by_order` `order_of_customer` `order_to_plantarget` `promise_for_order` `line_of_order` `order_has_line` `order_has_promise` ——**没有一条通向生产**。今天只能 Order→Model→(反向)WorkOrder 绕两跳。⚠ 若要直连：`WorkOrder` 上**没有** `orderRef`/`so` 属性 ⇒ 不是「没声明」，是**没有可用的外键列** |
| 10 | `scheduled_on` | `ProductionSchedule(schedId, woId, lineId, shift, scheduledDate, qty)` | ⚠️ | `sched_for_wo`(SRC `woId`) 已声明 ✅；**`ProductionSchedule→Line` 这条边压根没声明**，但 `lineId` 在，声明即可用。真正的 ❌ 在**时间维**：95 个类型里**没有 Calendar/TimeBucket/Period 类型**（金丝雀：`Line`/`Order` 在列表里为真），`scheduledDate` 只是一个 date 属性 ⇒ 「排在哪一天」**连不成边** |
| 11 | `has_capacity` | `Line.capacityDaily` `Line.max_capacity_day` `Base.gwh` `Base.formationCapDaily` `Warehouse.capacityUnits` `Process.channelOutputDaily` | ❌ | **产能全部是节点上的标量属性，没有任何一条产能边**，也没有 `Capacity` 对象类型。`viaProperty` 只能连**对象到对象**，连不到一个数 ⇒ 「产能」今天在图上不是一等公民 |
| 12 | `consumes_capacity` | `ProductionSchedule(woId, lineId, qty)` | ⚠️ | 承载在：`ProductionSchedule.lineId` 有 FK ⇒ **声明 `sched_on_line` 即可物化**（今天没声明）。**但 `qty`（消耗多少）留在节点上，边上带不了**（`ontology.ts:365` 无 props）⇒ 只能表达「用了这条线」，不能表达「吃掉多少产能」 |
| 13 | `has_inventory` | `model_stocked_as_finished_goods`(TGT `FinishedGoodsInventory.model`·ref) `fg_of_model`(SRC) `txn_for_fg`(SRC `fgRef`) | ✅ | 库存三层闭环齐全，单候选 |
| 14 | `stores` | `fg_at_warehouse`(SRC `warehouseId`) `warehouse_of_base`(TGT `Warehouse.baseId`) | ✅ | —— |
| 15 | `supplied_by` | `material_supplied_by`(SRC `supplierId`·ref) `supplier_supplies_material`(TGT) `material_supplied_by_po`(TGT `PurchaseOrder.matId`) `batch_replenishes_material`(SRC `matId`) | ✅ | 四条全单候选。金丝雀 E 就是这条 |
| 15b | `supplied_by`（长协层） | `LongTermAgreement(ltaId, supplierId, materialType, contractedQtyTon…)` | ⚠️ | `supplierId` 在，**但 104 条边里没有任何一条以 LTA 为端点** ⇒ 「合同→供应商」今天声明即可用（属「没声明」不是「表达不了」）。⚠ `materialType` 是**类别**不是 `matId` ⇒ LTA→Material 落在**桶 ②** |
| 16 | `ships_to` | `base_has_shipment`(TGT `Shipment.baseId`) | ❌ | `Shipment` 实测属性 = `shipId, baseId, etaDay, status, qtyTons, coverageDays`——**只有发出方，没有目的地**。「运到哪」在数据里就不存在 ⇒ 不是元模型问题，是**数据缺列** |
| 16b | `ships_to`（跨基地调拨） | `transfer_from_base` / `transfer_to_base` | ⚠️ | 两条都 SRC 有 FK（`fromBase`/`toBase`），**但候选集完全相同**（§2.9）⇒ 自动推断必接反一条，且不报错。**必须人工指定 `viaProperty`；今天的表单没有任何东西提示这两个不能混** |
| 17 | `located_in` | `Base.province/city/lon/lat` `CustomerLocation.province/city/lon/lat` `Warehouse.province/city` | ❌ | **没有 Region/Geo 对象类型**（95 个类型全表已核）⇒ 地理归属是**字符串属性**，连不成边。⚠ 这也意味着「华东产能」这类按地域的聚合今天**不能沿图走**，只能按字段过滤 |
| 18 | `delivers_to` | `customer_has_location`(TGT `CustomerLocation.customerRef`·ref) + `CustomerLocation.isDeliveryDefault` | ⚠️ | 客户→收货地点 ✅ 单候选；**但「哪一批货送到哪个地点」不存在**——`Shipment` 没有 `locId`（同 16）⇒ 交付链**断在最后一跳** |
| 19 | `depends_on` | `Operation.operationSeq`（工序序号）· `caused_by`(CausalFactor 自环) | ❌ | 工序先后靠**序号**表达，没有前驱 FK ⇒ 要「seq 的前一个」这种**关系型比较**，`viaProperty` 只做等值匹配。`caused_by` 是**桶 ⑦** 硬编码常量边表，且是全仓唯一自环边（§2.7 假阳性来源） |
| 20 | `constrained_by` | `capability_belongs_to_operation`(SRC `operationId`·ref) · `ProcessCapabilityWindow(minValue/maxValue/ucl/lcl)` | ⚠️ | 工艺窗口→工序 ✅ 单候选；**但「规则约束了什么」不在图上**——`TriggerRule(signalRef, op, threshold, cfgRuleKey)` 有 `signalRef`，却**没有任何一条以 TriggerRule 为端点的边**（104 条已全表核）⇒ 规则与它约束的对象之间**零连接** |

### 4.1 计分

| 判定 | 条数（按 20 个主行计） |
|---|---:|
| ✅ 今天就能表达 | **8**（belongs_to · produces · orders · contains · uses · has_inventory · stores · supplied_by） |
| ⚠️ 能连但语义有损 | **7**（compatible_with · requires · has_bom · scheduled_on · consumes_capacity · delivers_to · constrained_by） |
| ❌ 表达不了 | **5**（fulfills · has_capacity · ships_to · located_in · depends_on） |

**含 6 个细分行（1b/2b/3b/8b/15b/16b）一起算：✅ 8 · ⚠️ 9 · ❌ 9。**

### 4.2 对「产销推演今天做不做得成」的直接回答

**做不成的是这三条，且都在 ❌ 档**：

1. **`model_producible_at`（型号↔基地）** —— 数组值外键。「这个型号能在哪些基地做」是**产销匹配的第一跳**。
   今天出厂种子有实例（手写双层 for），**但用户自己建同形状的边 ⇒ 0 条**。
2. **`has_capacity` / `consumes_capacity`** —— 产能是标量属性、消耗量带不上边。
   ⇒ **「这条线还剩多少产能」沿图走不出来**，只能按字段读数。
   ⚠ 这与铁律 1.5 那次事故**完全同源**：`propagation.ts` 的 `amount = coeff × sourceVal × factor` 没有用量项，
   因为**用量本来该长在边上，而边上没有 props**。
3. **`fulfills`（订单↔工单）** —— 图上不存在这条边，`WorkOrder` 上也没有订单外键列。
   ⇒ 「这张单排给了哪几张工单」今天**追不了**。

**能做成的**：BOM 结构（⚠ 无配比）、库存三层、供应链归属、订单明细 —— 这 4 条链今天完整。

---

## §5 · 裁决点（3 个，只问互斥的架构取舍）

> 不问「要不要做」。以下每条都是**二选一且做错要返工**的取舍。

### 裁决点 1 · 「边能不能带属性」——现在定，还是先出一版不带属性的

**互斥在哪**：候选 C（桥实体投影）会给 `LinkInstance` 写 `props`。
一旦下游（切片检索、传导求解器、前端图谱）开始读边上的 `props`，
**再改就是破坏性变更**（老边没有 props ⇒ 读端要么崩要么静默取 0——后者正是铁律 1.5 那个事故形态）。

- **选项 A（推荐）· 一次做到带属性**：`materializeDeclaredLinks` 从第一天就写 `props`，
  候选 A/B/D 也统一按「边可以有属性」的形状落。
  **理由**：`model_certified_on` 的 `status`、`ChangeoverMatrix` 的 `minutes`、`BOMDetail` 的用量，
  **三个已经在种子里、已经被手写边带着的属性**（`service.ts:906` 的 `props:{status,...}`）——
  自建边不带，就出现「出厂边有状态、自建边没状态」的分裂。而**用量不上边 = 推演永远只能用常数系数**。
- **选项 B · 先只做拓扑，属性以后再说**：更快，但下游一旦按「边无属性」写死回落逻辑，
  第二次改要同时改读端与写端。

### 裁决点 2 · 桥实体的**双重身份**——它同时是节点还是只是边

**互斥在哪**：`Certification` / `ChangeoverMatrix` / `BOMDetail` 今天**都是一等对象类型**，
在图上以**节点**出现。候选 C 会让同一份数据**再以边的形式出现一次**。

- **选项 A（推荐）· 双重身份，但边默认隐藏**：桥类型继续是节点（不破坏 `model_has_cert` 等已有边），
  同时允许声明一条「经桥」的直连边；图谱默认渲染直连边、把桥节点折叠。
  **理由**：两种视角各有真实消费方——审计要看桥节点（谁在什么时候认证的），
  推演要看直连边（型号能不能上这条线）。**删掉任一个都有人发现。**
- **选项 B · 桥降级为纯边**：图更干净，但 `model_has_cert`（今天 TGT 有 FK、能用）会失去端点类型，
  且桥自己的属性（`certHours` `gapContribution`）无处安放。**这是不可逆的信息架构决策。**

### 裁决点 3 · ④ 桶 6 条（规则决定的边）—— 只求复现出厂，还是要让租户自己建

**互斥在哪**：这决定要不要把**表达式求值**引进本体物化路径。

- **选项 A（推荐）· 只做谓词过滤（候选 B），不做表达式产边**：
  `viaWhere` 只能**筛掉**行，不能**算出**端点。够用于 ③ 桶 3 条，且求值只在布尔位置、可控。
  **理由**：④ 桶 6 条今天全部由出厂种子确定性写出、屏上已有 ⇒ 复现它们**用户看不到任何变化**（按仓主判据是 B 类）。
  而「让租户自己建规则边」目前**没有任何一个已知场景带金额**——按场景敞口这把尺子，它排不进前列。
- **选项 B · 上「表达式边」全量能力**：本体物化路径变成一个小型求解器，
  R6 确定性、循环依赖、求值预算全部要重新守。**代价与 ①②③ 三桶加起来相当，而覆盖的是最不缺的那一桶。**

---

## §6 · 本提案明确**不做**的事（防止被当成待办）

1. **不对现存 104 条边做批量自动推断。** §2.9 已用实测证明：`transfer_from_base` / `transfer_to_base`
   候选集完全相同，确定性推断器会接到同一个属性上，**并把其中一条的拓扑方向静默接反**。
   6 条边有歧义，任何「取第一个」的推断器都会造出错边。
2. **不改 `docs/SYSTEM-ONTOLOGY.md`、不改 `docs/REQUIREMENTS-TRACE.md`。** 本单零源码改动 ⇒ 无需回写；
   若裁决点获批，回写在实施单里做。
3. **不为桶 ④/⑦ 提候选机制。**（理由见候选 E，三问答不上第三问。）
4. **不收 `cert_for_operator` 那条零实例边。** 它是「连种子都没连」，不是「元模型表达不了」——
   两件事修法不同，混在一起会修错地方。

---

## §7 · 证据索引（可独立复核）

| 论断 | file:line |
|---|---|
| 物化只在声明 `viaProperty` 时动手 | `apps/datacore/src/ontology.ts:330` |
| 匹配的是 anchor 的**主键**值 | `apps/datacore/src/ontology.ts:342` `:352` `:360` |
| 物化写出的边**没有 `props`** | `apps/datacore/src/ontology.ts:365–372` |
| `viaProperty` 打错字当场 400 并列可选属性 | `apps/datacore/src/ontology.ts:277–288` |
| 104 条结构边声明 | `apps/datacore/src/synthetic/battery.ts:3037–3225` |
| 类型有两个源（61 + 34） | `battery.ts:2931` · `battery-extended.ts:115`；种下于 `synthetic/service.ts:691` `:808` |
| `PropertyDef.refToTypeKey` 已存在且已填 | `battery-extended.ts:104`（`rd()` 助手）· `battery.ts:1169` 等 |
| 流程层 11 条边**只写定义不写实例** | `apps/datacore/src/process/ontology.ts:149` `:167` `:181`；`seed.ts:1792` |
| `model_producible_at` 走数组 `m.bases` | `synthetic/service.ts:881–890` |
| `model_certified_on` 边带 `props.status` | `synthetic/service.ts:906` |
| `customer_has_invoice` 走 `custByName` | `synthetic/service.ts:1067–1070` |
| `material_carbon` 条件外键 `kind==="material"` | `synthetic/service.ts:1103` |
| `model_in_segment` 串匹配规则 | `synthetic/service.ts:1113` |
| `base_data_health` 笛卡儿全连接 | `synthetic/service.ts:1116` |
| `order_to_plantarget` 取月拼串 | `synthetic/service.ts:1202–1205` |
| `plantarget_ownedby` 条件常量 | `synthetic/service.ts:1216` |
| `caused_by` 硬编码常量边表 | `synthetic/service.ts:1221`；常量在 `battery-extended.ts` `CAUSAL_EDGES` |
| `material_has_balance` 走物料中文名 | `synthetic/service.ts:1299–1304`（注释含原因） |
| `customer_has_overdue_record` 走 custName + 拒绝按名猜连发票 | `synthetic/service.ts:1306–1313` |
| `line_belongs_to_workshop` 串变换派生 | `synthetic/service.ts:993` |
| `cert_for_operator` 零实例写入方 | 声明 `battery.ts:3151`；mock `agentcore/src/mocks/ontology-graph.ts:183`；无 putLink |
| 接缝门（建边 × 多跳检索）实跑证据 | `apps/datacore/test/linktype-via-property.seam.test.ts:56` `:76` `:113` |
