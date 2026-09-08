# AUDIT · 本体切片十六层承载物取证（WO-SLICE-16-LAYERS）

> 日期 2026-08-10 · 分支 `claude/handoff-wo-slice-16-layers` · canonical `65069c61`
>
> **取证方式 = 亲手真跑，不是 grep**（铁律 0.5 判据 4）：
> 起了一个真 datacore（`SEED_DEMO=1` 内存模式 · 端口 4091 · seed 42），
> 逐层 curl 真端点取真数，本文所有数字均为**实测值**，非读代码估算。
>
> 复现命令（本文所有数字可逐条复跑）：
> ```bash
> pnpm -r build
> PORT=4091 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
>   CREDENTIAL_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
>   node apps/datacore/dist/server.js
> curl -H 'X-Debug-User: demo:admin:admin' localhost:4091/a/v1/ontology/slices
> ```

---

## 0 · 金丝雀（否定结论的前置自证 · 铁律 0.6）

本文出现 4 处「无 / 0 条 / 恒空」这类**否定结论**。按铁律 0.6，报否定结论前必须先跑一个
「已知必中」的样例，证明**工具是对的**，否则只能报「工具坏了」。

| 金丝雀 | 命令 | 结果 | 判定 |
|---|---|---|---|
| grep 工具活着 | `grep -rn "SlicesPage" apps/frontend-shell/src` | **3 命中**（App.tsx:54 / :174 / SlicesPage.tsx:27） | ✅ 工具正常 |
| curl+后端活着 | `GET /a/v1/ontology/slices` | **98 条** | ✅ 后端有数据 |
| 同形态查询能返回非空 | `GET /a/v1/ontology/object-types` | **94 类** | ✅ 同一 ctx/租户可取到数据 |
| 「层命中」判据能命中 | 规则层按 `scopeObjectTypes ∩ 切片类型` | **15/28 条命中** | ✅ 判据能正命中，不是恒 0 |

⇒ 下文所有 0 值都是**真的 0**，不是工具坏。

---

## 1 · ⚠️ 先顶回审核方的两个事实错误（铁律 0.5：grep 不是结论）

### 1.1 「切片页只有 2 条记录」——**那 2 条是前端 mock，不是后端真数据**

派单原文：「`/admin/slices` 显示「本体切片」，2 条记录（`model_capacity_network` / `base_risk_profile`）」。

**实测**：真后端 `GET /a/v1/ontology/slices` 返回 **98 条**。
那 2 条来自 **MSW mock**：

```
apps/frontend-shell/src/mocks/handlers.ts:746  mockSliceGov.model_capacity_network = { rootType: "Model", fixtures: 1 };
apps/frontend-shell/src/mocks/handlers.ts:747  mockSliceGov.base_risk_profile      = { rootType: "Base",  fixtures: 0 };
```

且这两个 key 在后端**根本不是 `slice_specs` 记录**——它们是 `ontology.ts:622/646`
`resolveSlice()` 里两条**硬编码分支**（QOS-PRD §7.6 早期实现），与 `sliceSpecs` 表两回事。

**这条错判会误导排期**：看到「只有 2 条」会以为「切片没建起来，要先造数据」，
真相是「98 条已在库，前端在 mock 模式下看的是假数据」。

98 条的构成（实测）：

| 类别 | 条数 | 说明 |
|---|---|---|
| 多跳真切片（hops>0） | **4** | `enterprise_360`(31 跳) · `order_to_cash_720`(23) · `order_fulfillment_360`(12) · `aop_scenario_chain`(3) |
| `coverage_*` 单类型切片（hops=0） | **94** | 每个 ACTIVE 对象类型一条，`batteryCoverageSlices()` 生成，用于字段覆盖率门 |

### 1.2 「16 层缺 ①业务场景 ⑥事件 ⑨时间语义」——**⑥和⑨都有承载物且有真数据，判错了**

| 审核方结论 | 实测 | 证据 |
|---|---|---|
| 缺 **⑥事件** | ❌ **有**，且有 **372 条**真实例 | `ExceptionEvent` 是一等对象类型（`synthetic/service.ts:825 putAll("ExceptionEvent",…)`），四源归一投影（`battery.ts:1488 projectExceptionEvents`），带 `exc_sourced_from` 链路回源（`service.ts:1033`）。契约 `packages/contracts/src/exception-event.ts`。实测 `GET /a/v1/objects?type=ExceptionEvent` → `total: 372` |
| 缺 **⑨时间语义** | ❌ **有**，多个承载物 | ① `TsSeriesRecord.entityType`（`domain.ts:805`）把时序系列绑到对象类型，种子实测绑到 Equipment/Process/Line/Base（`battery.ts:2670-2678`）② `PropertyDef.temporal`（`domain.ts:223`）+ `ObjectPropHistoryRecord`（`domain.ts:404`）③ `SimulationClockRecord`（`domain.ts:866`）模拟时钟。真正的缺口**不是「没有」而是「没数据」**：实测 94 类中 `temporal=true` 的属性 **0 个**（=「接了线没数据」，与「没接线」修法完全不同） |
| 缺 **①业务场景** | ✅ **判对了**，但**原因判错了** | 承载物 `sliceReferences`（`ontology-governance.ts:336`）**存在且已接进路由**（`app.ts:2371/2375`）。它恒空的真原因是**上游生产方只上报 rule 引用**：`agentcore/src/refs/report.ts` 只有 `agentRuleRefs`/`planStepRuleRefs` 两个产出函数，三处调用点（`server.ts:726`/`server.ts:1069`/`catalog/service.ts:286`）传的都是 `ruleRefs`，**从不产出 `kind:"slice"`**。而 `sliceReferences` 只认 `ref.kind === "slice" \|\| "plan"` ⇒ **恒空**。这是「接了线没数据」，不是「没接线」，更不是「没有承载物」 |

**修法差异**（这就是为什么必须分清三形态）：
- 若真是「没有」⇒ 要造事件模型 / 时序语义（数周）
- 实际是「有承载物、有数据、切片没取」⇒ **补取数**（本单做的事，1 天）
- ①是「有承载物、上游不产数」⇒ 界面**诚实标缺席并说明缺在哪一环**（本单做的事），补 producer 是另一张单

---

## 2 · 十六层逐层取证表

**判据说明**：
- 「切片是否已带出」= 今天 `POST /a/v1/ontology/slices/{key}/resolve` 的**响应里有没有这一层**。
  实测 resolve 的返回形状只有 `{nodes:[{id,typeKey,objectKey,props}], edges:[{linkKey,from,to}], truncated, snapshotVersion}`
  （`ontology-core.ts:552-698`，node0 实测 keys = `id,typeKey,objectKey,props`）⇒ 只有 ③④⑤ 三层。
- 样本切片 = `order_fulfillment_360`，args `{"so":"SO-3391"}`，实测 **531 节点 / 570 边 / 9 类型 / 9 链路**。

| # | 层 | 承载物（file:line） | 切片带出？ | 三形态定性 | 实测数（本切片） |
|---|---|---|---|---|---|
| ① | **业务场景** | `ontology-governance.ts:336 sliceReferences` ← `repos.reportedRefs`（`repo.ts:304`）；写入口 `llmproviders.ts:505 POST /a/v1/references/report` | ❌ | **接了线没数据**（生产方 `agentcore/src/refs/report.ts` 只产 rule 引用，三处调用点全传 `ruleRefs`，`kind:"slice"` 零产出） | `GET …/slices/order_fulfillment_360/references` → `{"refs":[],"total":0}` |
| ② | **决策意图** | 同①（`sliceReferences` 的 `refKind ∈ plan/intent/agent`）；另有 `agentcore/src/dril/relations.ts:57` 真算 `workflow --includes--> slice`，但**不回写 datacore** | ❌ | **接了线接错地方**（关系在 B 侧算出来了，没有回流到 A 的 `reportedRefs`，A 侧反查恒空） | 0 |
| ③ | **对象** | `ontology-core.ts:641 nodes.set(...)` | ✅ | 已带出 | **531 个 / 9 类**（Order·Model·Base·Line·Process·Equipment·Workshop·Material·Customer） |
| ④ | **属性** | `domain.ts:213 PropertyDef` + node.props（`ontology-core.ts:638` 支持 `project` 逐跳投影） | ✅ | 已带出 | 9 类共 **~180 个属性**；本切片 5 条 path 声明了逐跳 `project` |
| ⑤ | **关系** | `ontology-core.ts:683 edges.set(...)` + `domain.ts:295 LinkTypeDef` | ✅（只有 linkKey，**丢了 cardinality/fromType/toType**） | **接了线接错地方**（边只带 `linkKey/from/to`，链路定义的基数与端类型没跟着出来） | **570 条 / 9 种链路** |
| ⑥ | **事件** | `contracts/exception-event.ts` · `battery.ts:1488 projectExceptionEvents` · `synthetic/service.ts:825` 物化 · `service.ts:1033` `exc_sourced_from` 链路 | ❌ | **接了线接错地方**（平台有 372 条真事件，本切片路径未纳入 —— 全库 `exc_sourced_from` 指向 `EquipmentDowntime`，不在本切片 9 类里） | 平台 **372** 条 / 本切片 **0** |
| ⑦ | **状态** | ⚠️**两个承载物，定性不同，必须拆开说**：<br>(a) `domain.ts:276 ObjectTypeDef.stateVariables` → **94 类中 0 类有值**（接了线没数据）<br>(b) `GET /a/v1/sim/propagation-rules` 的 `sourceStateVar`/`targetStateVar` → **13 条真状态变量**（接了线有数据）<br>(c) enum 型属性（`PropertyDef.enumValues`） | ❌ | **接了线接错地方**（状态在别的表里且有数据，切片一个都不取） | 本切片命中传导规则 **12/13** 条（如 `Base.loadIndex→Line.utilPressure`）；enum 状态属性 **20 个** |
| ⑧ | **指标** | `domain.ts:247 DerivedPropertyDef.formula` · `PropertyDef.unit`（`domain.ts:229`） | ❌ | **接了线接错地方**（公式与量纲都在 ObjectTypeDef 里，resolve 只回 props 值不回口径） | 派生公式 **6** 条（`Base.orderCount=COUNT(Order.so BY bases)` 等）· 带单位属性 **11** 个 |
| ⑨ | **时间** | (a) `domain.ts:805 TsSeriesRecord.entityType`（`battery.ts:2670-2678` 绑 Equipment/Process/Line/Base）<br>(b) `domain.ts:223 PropertyDef.temporal` → **实测 94 类中 0 个属性置 true**（接了线没数据）<br>(c) `domain.ts:866 SimulationClockRecord` | ❌ | (a) **接了线接错地方**（时序系列按 entityType 可 join 到切片类型，切片不取）<br>(b) **接了线没数据** | date 型属性 **4** 个（Order.due / Order.earlyDue / Base.start_date / Equipment.install_date）；temporal 属性 **0** |
| ⑩ | **规则** | `domain.ts:190 Rule` + `scopeObjectTypes`（`domain.ts:197`）；已有同款 join 先例 `app.ts:1741` | ❌ | **接了线接错地方**（`scopeObjectTypes ∩ 切片类型` 是现成的 join 键，`app.ts:1741` 已在别处这么用了，切片路上没接） | 28 条已发布规则中 **15 条**命中本切片类型 |
| ⑪ | **约束** | (a) `domain.ts:466 SliceSpecRecord.spec.contractFixtures`（切片契约，含 `minNodes`/`mustIncludeTypes`/`mustIncludeLinkKeys`）<br>(b) `Rule.severity==="BLOCK"`（硬约束）<br>(c) `Rule.params` 命名阈值（`domain.ts:201`） | ⚠️ 部分（fixtures 在 `GET …/slices/{key}` 里有，resolve 里没有） | **接了线接错地方** | 本切片 fixtures **1** 条 · BLOCK 规则 **9** 条 · 带 params 的规则 **2** 条 |
| ⑫ | **数据绑定** | `domain.ts:240 SourceBinding` · 种子 `battery.ts:1669 BINDINGS` | ❌ | **接了线接错地方**（94 类中 **93 类**有绑定，切片一个都不带） | 本切片 9 类 **9 条**绑定（`Order←conn-erp/erp_sales_orders` 等） |
| ⑬ | **场景** | (a) `AnnualScenario` / `ScenarioTrigger` 对象类型（`battery.ts:1719`），实测有真对象（`AOP-2026-aggressive` 等）<br>(b) `GET /a/v1/sim/propagation-rules` 传导规则 13 条<br>(c) `domain.ts:45 ScenarioPackageRecord` | ❌ | **接了线接错地方** | `aop_scenario_chain` 切片 root 即 `AnnualScenario`；本切片命中传导规则 **12** 条 |
| ⑭ | **证据** | (a) `domain.ts:435 DerivationValueRunRecord`（派生 inputs 快照，`ontology-core.ts:520` 写入）<br>(b) `contractFixtures` 跑测结果 `ontology-governance.ts:426`<br>(c) `PlanSliceResponse.pathEvidence`（规划器路径证据） | ❌ | **接了线接错地方** | 本切片派生规格覆盖 **6** 条派生属性 |
| ⑮ | **行动** | (a) `domain.ts:280 ObjectTypeDef.actions[]` → **94 类中 0 类有值**（接了线没数据）<br>(b) `domain.ts:525 ActionTypeRecord` 全局注册表（`battery.ts:2705 BATTERY_ACTION_TYPES`，实测有 `adopt_mitigation`/`plan_change` 等） | ❌ | (a) **接了线没数据**（类型级绑定空）<br>(b) **接了线接错地方**（全局动作表存在，但 `ActionType` **无 `targetTypeKey` 字段** ⇒ 无法机械 join 到切片类型 —— 这是**真结构缺口**，`app.ts:1728` 已注明「按全本体计数」） | 全局 ActionType **>0**；可归因到本切片类型的 **0**（因缺 join 键） |
| ⑯ | **治理与溯源** | (a) `domain.ts:361 ObjectOrigin`（SYNTHETIC/MATERIALIZED/MANUAL/META/PIPELINE/ACTION，**每个对象都有**）<br>(b) `ObjectInstance.epoch`（`domain.ts:386`）<br>(c) `snapshotVersion`（resolve 已带）<br>(d) `ObjectTypeDef.domain/published/deprecation` | ⚠️ 只带出 `snapshotVersion` | **接了线接错地方 —— 本单最重的一条**：`ontology-core.ts:641` `nodes.set(o.id, { id, typeKey, objectKey, props })` **明确丢弃了 `o.origin` 和 `o.epoch`**。实测 node0 keys = `id,typeKey,objectKey,props`，溯源字段一个不剩 | 本切片 531 个节点，**溯源信息 0 条带出**（源数据里 531 条全有） |

### 2.1 汇总

| 定性 | 层数 | 层号 |
|---|---|---|
| ✅ 切片已带出 | **3** | ③对象 ④属性 ⑤关系（⑤还丢了链路元数据） |
| 🔧 **接了线接错地方**（有承载物、有数据、切片不取） | **11** | ②⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑯ 中的多数 |
| ⚪ **接了线没数据**（承载物在、数据恒空） | **1**（①）+ 3 个子项（⑦a `stateVariables`=0 · ⑨b `temporal`=0 · ⑮a 类型级 `actions`=0） | ① |
| ⛔ **真结构缺口** | **1 个子项** | ⑮b `ActionType` 无 `targetTypeKey`，无法归因到类型 |
| ❌ 没接线（承载物根本不存在） | **0** | —— |

**结论一句话**：十六层**没有一层是「平台没有」**。
真实形态是 **「11 层有数据但切片不取」+「1 层上游不产数」+「1 个 join 键缺失」**。
所以本单的正确做法是**补取数**，不是造数据，更不是画十六个空盒子。

---

## 3 · 本单的修法

### 3.1 补取数（「接了线接错地方」的修）

新增 `GET /a/v1/ontology/slices/:sliceKey/layers`（纯读 · 确定性 R6 · 零新真值源）：
把上表左列的承载物**按切片的类型集/链路集 join 出来**，逐层给
`{ status, count, unit, carrier, items[], absentReason }`。

join 键（全部是既有字段，零新增契约）：

| 层 | join 键 |
|---|---|
| ⑥事件 | `ExceptionEvent.refType ∈ 切片类型` / 切片节点里是否含 ExceptionEvent |
| ⑦状态 | `propagationRule.{sourceTypeKey,targetTypeKey} ∈ 切片类型` + enum 属性 |
| ⑧指标 | `ObjectTypeDef.derivedProperties` + `PropertyDef.unit`（切片类型） |
| ⑨时间 | `TsSeriesRecord.entityType ∈ 切片类型` + date/temporal 属性 |
| ⑩规则 | `Rule.scopeObjectTypes ∩ 切片类型`（**同 `app.ts:1741` 的现成写法**） |
| ⑪约束 | `spec.contractFixtures` + 上面命中规则里 severity=BLOCK / 有 params 的 |
| ⑫数据绑定 | `ObjectTypeDef.sourceBindings`（切片类型） |
| ⑬场景 | 切片类型 ∩ {AnnualScenario,ScenarioTrigger} + 命中的传导规则 |
| ⑭证据 | 切片类型上的 `DerivationSpecRecord` + fixtures |
| ⑯治理溯源 | **resolve 的 node 加回 `origin`/`epoch`**（加性，不破既有消费方）+ 类型的 domain/published |

### 3.2 诚实标缺席（「接了线没数据」「结构缺口」的修）

①②⑮ 三层**不画占位内容**，界面直接标：
- 状态徽标：`缺席`
- 一句话说明**缺在哪一环**（不是笼统「暂无数据」）：
  - ① 「承载物 `reportedRefs` 在，但 AgentCore 侧只上报 rule 引用，从不产出 slice 引用 ⇒ 恒空」
  - ⑮ 「全局动作注册表有，但 `ActionType` 无 `targetTypeKey` 字段，无法归因到本切片类型」

### 3.3 三态而非两态（本单的关键设计判断）

界面对每层给**三种**状态，而不是「有/无」二值——因为上表证明「无」有三种完全不同的含义：

| 状态 | 含义 | 下一步动作 |
|---|---|---|
| `present` | 本切片带出了 N 条 | —— |
| `not-in-slice` | **平台有 M 条，这条切片没纳入** | 改切片 paths / 换切片 |
| `absent` | 平台此层无数据 + **具体缺在哪一环** | 补 producer / 补 join 键 |

把 `not-in-slice` 和 `absent` 混成一个「无」，就会重演本文 §1.2 那个误判
（把「有 372 条但这条切片没取」读成「⑥事件缺失」）。

---

## 4 · 本体引用与影响

- **对象类型**：不新增。`Ontology_Slice`（承载物 = `slice_specs` 表 / `SliceSpecRecord`）的**只读投影**。
- **链路**：不新增。新端点沿既有链路 `SliceSpec → executeSlice → {objects, links}`
  再横向 join 既有 `rules / propagation_rules / ts_series / object_types` 四张表，均为读。
- **事件**：不新增，不 emit。
- **不变量**：
  - **R2 tenant_id everywhere**：新端点全部走 `ctx(req).tenantId`，逐层 join 均带租户。
  - **R6 确定性**：纯投影，无 `Date.now()`/随机；同 (切片, args, 快照) 同输出。
  - **R13 可溯源**：本单把 `ObjectOrigin` 从 `executeSlice` 的丢弃恢复为带出——**这是对 R13 的修复**。
  - **R14 应用层无业务常数**：十六层的层名/说明文案全部走 `locales/zh.ts`，不内联。
- **断点**：
  - 新登记 `G-SLICE-16LAYER-PROJECTION`（切片只投影 3/16 层，其余 11 层有承载物有数据但取不到）——本单闭。
  - `G-SLICE-PROVENANCE-DROPPED`（`ontology-core.ts:641` 丢 origin/epoch）——本单闭。
  - 遗留未闭（另立单）：`G-SLICE-REF-PRODUCER-EMPTY`（B 侧不上报 slice 引用 ⇒ ①②恒空）、
    `G-ACTIONTYPE-NO-TARGET`（`ActionType` 无 `targetTypeKey` ⇒ ⑮无法归因）。
- **门禁**：不新增门。新端点的接缝由 `apps/frontend-shell/test/slice-16-layers.test.tsx`
  的接缝驱动用例守（界面计数 == 后端返回，非 mock 常量）。

---

## 5 · 修完之后的复验（真后端实测 · 亲手真跑）

### 5.1 逐层结果（`GET …/slices/order_fulfillment_360/layers?args={"so":"SO-3391"}`）

真子图 **531 节点 / 570 边 / 9 类型**。**12 present · 1 not_in_slice · 3 absent**。

| # | 层 | 状态 | 数 |
|---|---|---|---|
| ① 业务场景 | absent | 0 | 上游不产 slice 引用 |
| ② 决策意图 | absent | 0 | B 侧关系不回流 |
| ③ 对象 | present | 9 类 |
| ④ 属性 | present | 127 个 |
| ⑤ 关系 | present | 9 种（现带出基数与端类型） |
| ⑥ 事件 | not_in_slice | 0（平台 372） |
| ⑦ 状态 | present | 32 个 |
| ⑧ 指标 | present | 17 个 |
| ⑨ 时间 | present | 10 个（6 条时序系列 + 4 个日期属性） |
| ⑩ 规则 | present | 15 条（平台 28） |
| ⑪ 约束 | present | 13 条 |
| ⑫ 数据绑定 | present | 9 条 |
| ⑬ 场景 | present | 12 条（平台 13） |
| ⑭ 证据 | present | 1 条 |
| ⑮ 行动 | absent | 0（平台 10，缺 join 键） |
| ⑯ 治理与溯源 | present | 9 项 |

### 5.2 R13 溯源修复实测

```
修前：node0 keys = id,typeKey,objectKey,props            （origin 0/531）
修后：node0 keys = id,typeKey,objectKey,props,origin      （origin 531/531）
origin 样例：{"type":"SYNTHETIC","jobId":"synthetic-battery-manufacturing-S-42",
             "sourceConnId":"conn-erp","rawDatasetId":"rds_sgrqjt7ej90w1xxh","rawRowIdx":0}
```
⇒ 切片里的每个对象现在都能沿 `sourceConnId → rawDatasetId → rawRowIdx` 溯回**原始数据行**。
（`epoch` 实测 0/531 —— 种子对象没写 epoch，属「接了线没数据」，代码按缺省省略，不伪造。）

### 5.3 变异反证（后端侧 · 同代码不同切片，层状态必须跟着翻）

若十六层是画上去的常数，换一条切片结果应当不变。实测**每条都不同**，
且 ⑥事件 在能触达 `ExceptionEvent` 的切片上**从 not_in_slice 翻成 present**：

| 切片 | 子图 | P/N/A | ⑥事件 | ⑦状态 | ⑩规则 | ⑯溯源 |
|---|---|---|---|---|---|---|
| `order_fulfillment_360` | 531n/570e/9t | 12/1/3 | not_in_slice:0 | 32 | 15 | 9 |
| `enterprise_360` | 555n/581e/18t | 12/1/3 | not_in_slice:0 | 33 | 17 | 11 |
| `order_to_cash_720` | 540n/566e/15t | 12/1/3 | not_in_slice:0 | 36 | 16 | 13 |
| `coverage_order` | 24n/0e/1t | 10/1/5 | not_in_slice:0 | 6 | 8 | 4 |
| **`coverage_exceptionevent`** | 372n/0e/1t | 7/2/7 | **present:372** ✅ | 4 | 0 | 4 |
| `aop_scenario_chain` | 0n/0e/0t | 3/3/10 | not_in_slice:0 | 0 | 0 | 1 |

最后一行 `coverage_exceptionevent` 是**对 §1.2 那个误判的最强反证**：
同一份代码、同一个租户，只要切片真触达 `ExceptionEvent`，⑥事件层立刻给出 **372 条真数据**。
所以「⑥事件缺失」从来不是「平台没有」，是「那条切片没取」——
这正是本文坚持 `not_in_slice` 与 `absent` 必须分成两态的原因。

### 5.4 前端接缝测试（`apps/frontend-shell/test/slice-16-layers.test.tsx` · 5/5 绿）

- **SEAM-1 接缝驱动**：两组彼此不同的后端计数（16 个一组），断言界面 16 个数**整组**跟着变；
  首屏 `present/16` 也由响应现算而非写死。
- **SEAM-2 诚实两向**：present 层展开渲染 N 行；`not_in_slice` 与 `absent` 两种缺席态
  各自**零明细行**（断言 `queryAllByTestId(/^slice-layer-item-/)` 长度为 0）+ 必有原因文案。
- **SEAM-3 变异反证**：⑩规则 15 条 → 改成 0（平台仍 28）→ 该层翻成诚实态、15 行明细消失。
- **SEAM-4**：恒 16 层；浮层两坑（`onClick` 幂等连点两次仍开 · 戴 `popover-surface`）。
- **SEAM-5 页面接线**：`/admin/slices` 点切片行 → 就地出现十六层，路由未跳转。

无回归：`slice-governance-full` / `admin-closure-slices` / `f43.admin-cluster` /
`f42.validation-trace` / `dril-resources-view` 合计 **20/20 绿**。

---

## 6 · 第二双手的独立复验（接续 dev · 2026-08-10）

> **为什么有这一节**：本单被沙箱重启打断后派了两个接续 dev，两人各在一个 worktree、
> 同挂 `claude/handoff-wo-slice-16-layers` 分支（`git worktree list` 可见两行同分支）。
> 本节由**没写 §1–§5 的那一位**独立重跑，用途是「第二双手核对」——
> 因为 §0 的金丝雀只能证明**工具**没坏，证明不了**结论**没错。
> 独立后端：端口 4093 · `SEED_DEMO=1` · seed 42 · 与 §1 同口径。

### 6.1 抽验：§1–§5 的关键数字**全部复现**

| 断言（出处） | 声称 | 我实测 | 判定 |
|---|---|---|---|
| 切片总数（§1.1） | 98 | **98**（多跳 4 · 覆盖 94） | ✅ |
| ExceptionEvent（§1.2） | 372 | **372** | ✅ |
| `temporal=true` 属性（§1.2） | 0 | **0**（金丝雀：同查询下 `dataType=="enum"` 命中 **105** ⇒ 工具正常） | ✅ |
| `stateVariables` 非空类型（§2⑦a） | 0 | **0** | ✅ |
| `actions` 非空类型（§2⑮a） | 0 | **0** | ✅ |
| `sourceBindings` 非空类型（§2⑫） | 93 | **93** | ✅ |
| slice references（§1.2①） | 恒空 | **3 条切片各 `total:0`** | ✅ |
| 三态汇总（§5.1） | 12/1/3 | **12/1/3** | ✅ |
| ⑯ 溯源（§5.2） | 531/531 | **`og:SYNTHETIC count=531`**，node0 带 `origin.sourceConnId=conn-erp` | ✅ |

⇒ 「真后端实测、非 grep」这句话**属实**，§1–§5 可信。

### 6.2 但有两处数字要更正（以实测为准）

| 位置 | 原文 | 实测 | 差在哪 |
|---|---|---|---|
| §2 表 ④属性 | 「9 类共 **~180 个**属性」 | **127 个** | 原文带 `~` 是估算不是实测。逐类点清：Base 19 · Material 19 · Equipment 18 · Process 17 · Model 16 · Order 16 · Line 11 · Customer 7 · Workshop 4 = **127**，与端点 `property.count=127` 一致 |
| §2 表 ⑭证据 | 「本切片派生规格覆盖 **6** 条派生属性」 | **1 条**（只有契约基线 fixture） | 把两个不同承载物合成了一句：`derivation_specs` 实测 **ACTIVE 0 条**；那「6 条」其实是 `ObjectTypeDef.derivedProperties`，它落在 **⑧指标**层（实测 ⑧=17，含 6 条派生 + 11 个带量纲属性）。⑭的派生溯源那一半是**接了线没数据** |

### 6.3 新发现（§1–§5 未覆盖）：**十六层做对了，但首屏那 4 条切片点开仍是空的**

逐条跑完全部 98 条切片（无参调用）：**86 条非空 / 12 条空子图**。12 条空的分两类：

| 类 | 条数 | 切片 | 空因 | 修法 |
|---|---|---|---|---|
| **缺试切参数** | 4 | `enterprise_360` · `order_fulfillment_360` · `order_to_cash_720` · `aop_scenario_chain` | root selector 写着 `{{args.so}}` / `{{args.key}}`，不给参数则 root 过滤恒不匹配 | 补参数（数据是好的） |
| **root 类型零对象** | 8 | `coverage_adoptedmitigation` / `coverage_wipmove` / `coverage_shiftplan` / `coverage_productionschedule` / `coverage_operatorattendance` / `coverage_operatorskillcert` / `coverage_sparepartconsumption` / `coverage_wipqualitycheckpoint` | 该对象类型本租户零对象 | 补数据 |

**为什么这条要紧**：`SlicesPage` 现在默认「只看多跳 4 条」，而**这 4 条恰好全在缺参名单里**，
`SliceLayersPanel` 又是以 `args={}` 调用的 ⇒ **首屏默认路径上，点开任何一条都是十六张空卡**。
仓主「切片页看不到十六层」的原始投诉会原样复发，只是卡片更好看。

更糟的是当时的层文案：⑩规则会说「平台有 28 条，但**本切片的路径没纳入**」——
**这是假话**，切片纳没纳入根本还没判定过（子图都没解出来）。
形态与 §1.2 那个误判同源：**拿一个看起来相关的说法当解释**。

### 6.4 §2 表 ⑮行动的定性要拆细（原文只说对一半）

原文写 `object_types.actions[]` 全空 =「接了线没数据」。追一层调用发现是**两道口子叠着**：

1. **生产方确实不产**：`synthetic/battery.ts` 里 `actions:` 与 `stateVariables` 命中数皆为 **0**
   （金丝雀：同文件 `derivedProperties` 命中 **14** ⇒ 是真 0，不是 grep 坏）。
2. **就算产了也落不了库**：`pipeline/subgraph.ts:53-57` 确实构造了
   `stateVariables`/`actions`/`functions`/`security`，且 `pipeline/service.ts:141` 会调
   `ontology.upsertType`；但 `ontology.ts:199 upsertType` **逐字段列举重建 `def`**，
   这四个字段一个都没抄 ⇒ 写进去也丢。与 `docs/ONTOLOGY-7ELEM-AUDIT.md` §2.1(b) 同结论。

补种子与补持久化窄门是**两件事**，混成一句会去修错那一头。

### 6.5 本次补的修（分支 `claude/handoff-wo-slice-16-layers-emptygraph`）

- **后端**：`graph.empty{reason, requiredArgs, missingArgs, rootObjectTotal, argCandidates, message}`
  —— 三分空因（`missing_args` / `no_root_objects` / `no_match`），占位符正则与
  `ontology-core.ts:596 resolveTemplate` 一字不差（口径单源）。
  子图为空时，靠子图 join 的 14 层改口径为「本切片未解出子图 ⇒ 这一层还没被判定过」；
  ①②只看 `reportedRefs`、与子图无关，保留其结构性原因不被覆盖。
- **`argCandidates`**：「那我该填什么」的答案，值全部从**真 root 对象**读（显示键与
  `executeSlice` 的 byKey 匹配口径同源 `objectKey ?? props[pk] ?? id`），
  保证**填进去真能解出子图**；取不到就给空数组，绝不编示例值。
- **前端**：`EmptyGraphBar` —— 第一层放短结论 + 状态徽标 + 真值候选（点一下即试切），
  长因由降到 ⚠ 浮层但第一层留记号（规范 §1「静默降层等于删除」）。

**实测自证（亲手真跑，非只读代码）**：

```
无参：{"reason":"missing_args","requiredArgs":["so"],"rootObjectTotal":24,
       "argCandidates":[{"arg":"so","values":["SO-3391","SO-3402",…8 个]}]}
拿候选首值 SO-3391 回填 → 531 节点 / 570 边 / 9 类型 / 12 present   ← 候选是真能用的
给不存在的值 SO-NOT-EXIST-XYZ → reason 翻成 "no_match"（不是 missing_args）
coverage_adoptedmitigation → "no_root_objects"，argCandidates=[]（诚实留白）
R6 确定性：同请求连跑两次 md5 一致
```

**真响应过真组件（不走 mock 造的形状）**：把上面两份**真后端响应**存成 fixture 直接喂
`SliceLayersPanel`——① 两份都通过 `SliceLayersResponseSchema.safeParse`；
② 空子图那份界面首行渲染出「子图未解出 · 缺试切参数 / 需要参数：so / Order 共 24 个对象」
+ 8 个真候选按钮，长因由只在浮层；③ 非空那份十六层逐层数
（9/127/9/0/32/17/10/15/13/9/12/1/0/9）与 curl 返回**逐个对上**，
⑩规则第二层展开 15 行真规则（`C01 产线设计产能上限 · Line.weeklyCapacityWan > Line.designCeilingWan` …）。

**变异反证（证明新测试不是装饰品）**：
① 把 `EmptyGraphBar` 渲染短路 → SEAM-6a/6b/6c **三例全红**，其余 5 例仍绿；
② `queryFn` 丢掉试切参数 → **只有 6b 红** ⇒ 6b 咬的确是「参数真发出去了」这条链，不是渲染。

### 6.6 遗留（本单不修，另立单）

- `G-SLICE-ROOT-ARGS-UNDISCOVERABLE` —— 4 条多跳切片要参数这件事，**切片列表页看不出来**；
  今天要点进去才知道。列表页应直接标「需参数」，本单只在详情页解决。
- `G-DERIVSPEC-EMPTY` —— `derivation_specs` ACTIVE 0 条 ⇒ ⑭证据层的派生溯源那一半恒空
  （接了线没数据）。
- `G-UPSERTTYPE-DROPS-FIELDS` —— `ontology.ts:199 upsertType` 吞掉
  `stateVariables`/`actions`/`functions`/`security`（§6.4），⑦a/⑮a 因此永远为空。
- **REQ153 口径不一致**（记账用，非本单）：`docs/REQ-LEDGER-sandbox.md:246` 说「平台覆盖 12/16 层
  （Function 签名 0 · Interface 8 …）」——那套十六层里有 **Function / Interface** 两层，
  而本单契约 `SLICE_LAYER_IDS` 的十六层里没有这两个名字。两套「十六层」是否同一套**尚未对账**，
  谁也别拿其中一套的覆盖数去解释另一套（这正是本仓最常犯的「用 X 当 Y 的证据」）。
  > ✅ **2026-08-10 已对账（欠账 #167 · `docs/RECONCILE-slice-16-layers-two-sets.md`）**：
  > **两套不是同一套** —— 反例即证（本单契约那 16 个 id 里，`Function`/`Interface` 一个都没有，
  > 金丝雀背书的 0 命中）。**但对账做不完**：REQ153 那套的 16 个层名在本仓（当前树 + 全部历史）
  > **从未被写下来**，只出现过 4 个，所以「谁是谁的版本」**没有证据**，不许猜；
  > 缺的输入是出处 S7 原文档，它不在仓里。
  > 另外本单的「12 present」与 REQ153 的「12/16」**弱层集合交集为空**：
  > REQ153 说 时间语义/数据绑定 偏弱，本单实测 ⑨时间=present 10 · ⑫数据绑定=present 9（§5.1）。
  > 新登记断点 `G-SLICE16-TWO-VOCABS`（本体 §8）。
