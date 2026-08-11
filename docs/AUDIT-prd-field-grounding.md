# AUDIT · PRD 字段级引用的落地性存量清单（PRD Field Grounding）

> 编号：WO-PRD-FIELD-AUDIT · 类型：存量审计（只读取证，不改任何 PRD / 代码）
> 作者：dev（画像=轻） · 日期：2026-08-11
> 分支：`claude/handoff-wo-prd-field-audit` · 基线：`origin/claude/inspiring-gates-aqczjg`
> 真值源：**运行态 datacore 实例**（memory 模式 · `SEED_DEMO=1` · seed 42 · port 4094）

---

## 0. 执行摘要（TL;DR）

**病由（派单原文）**：PRD 里字段级引用很多，但「提到了字段，却从没问过这个字段今天有没有值」。
已坐实的后果是 A6 三业务跨 seg —— 判据建立在 `Line`/`Process` 上一个**根本不存在的业务线字段**上。

**本次全量扫描结论**：

| 结论 | 数 |
|---|---|
| 扫描语料 | **129** 份 `docs/PRD-*.md` ＋ **12** 份 `docs/industrial-prd/PRD-*.md` |
| 原始 `` `Type.field` `` 命中 | **1122**（main 1002 / industrial 120） |
| 其中**属于本体对象字段**这一命题的（在范围内） | **189** |
| 🔴 **类型不存在**（以现状口吻） | **0 条确认** |
| 🔴 **字段不存在**（以现状口吻） | **7 处 / 6 个 `Type.field` / 5 份 PRD** |
| 🟡 **字段在但恒空** | **0 条** |
| ✅ **有值** | **129 处 / 61 个 `Type.field` / 28 份 PRD** |
| 🎯 目标（PRD 提议新增，不算缺陷） | 20 处 / 4 份 |
| 📌 已知（PRD 自陈「没定义/无对象承载」） | 13 处 / 7 份 |
| 🧪 仿真状态变量（**第三命名空间**，见 §6） | 15 处 / 1 份 |
| ⚪ 未判定 | 4 处 |

**三句话总结**：

1. **最坏的一档（🔴 类型不存在）是空的**，🔴 字段不存在只有 **6 个**。存量比派单预期**干净得多**。
2. **但派单的定性是对的，只是位置不同**：真正的风险不是「引用了不存在的字段」，而是
   **`Type.field` 这个记法在本仓同时指四种互不相干的东西**（本体属性 / 仿真状态变量 /
   规则求值命名空间 / 前端原型全局变量），其中**两种完全无人校验**，写错静默读作 0/undefined。
   见 §6 —— 这是本次审计最有价值的产出。其中 **§6.3 是最值钱的一条**：
   顺着一个「未判定」多追一层，抖出 `BATTERY_RULE_SCOPES` 四条规则的作用域名的不是对象类型
   （`Batch`/`Cert`/`Lta`/`Outsource`），而真承载者 `MaterialBatch`（`idleDays` **24/24 满覆盖**）等
   就在本体里 —— **数据 100% 齐备，却因为一个名字对不上而在 databuilder 路径上被静默丢弃**
   （`comprehend.ts:214` 已实测）。
3. **派单里的「86%」我复算不出来**，实测 **55%**；「93 份有验收判据章」实测 **103** 份。见 §8。

---

## 1. 工具自证（铁律 0.6 · 报结论前先跑已知必中的样例）

本节所有金丝雀**与主逻辑共用同一份实现**（`hits_in_text()` / `classify()` 本体，不另抄正则）。

### 1.1 派单指定的两个金丝雀（原文）

**金丝雀 A · 确定存在且有值 → 必须判 ✅**

```
--- Base.baseId ---
  type exists: YES | instanceCount=13 sampled=13
  field in properties: True
  coverage: 13
  all props: ['baseId', 'name', 'kind', 'util', 'bottleneck', 'gwh', 'formationCapDaily',
              'agingCapDaily', 'lon', 'lat', 'position', 'factory_code', 'province', 'city',
              'factory_type', 'status', 'start_date', 'openCost', 'serveCost']
```
→ 判 **✅ 有值 · 覆盖率 13/13**。✔

**金丝雀 B · 确定不存在（A6 已坐实）→ 必须判 🔴**

```
--- Line.businessType ---
  type exists: YES | instanceCount=130 sampled=130
  field in properties: False
  coverage: N/A
  all props: ['lineId', 'baseId', 'name', 'utilization', 'actual_output_daily',
              'schedule_attainment', 'line_code', 'max_capacity_day', 'capacityDaily',
              'target_yield', 'status']
  extraPropsSeen(undeclared on instances): {'__prov': 130}
```
→ 判 **🔴 字段不存在**。✔ **A6 的定性当场复现**：`Line` 有 130 个实例、11 个属性，**没有任何业务线字段**。
顺带实测 `Process`（650 实例、17 属性）**同样没有**；而 `Order.businessType` **存在且 24/24 满覆盖**。
即：业务线归属**只挂在订单上，产线/工序侧完全没有这条关系** —— A6 结论坐实。

### 1.2 四档各自的可检出性金丝雀（防「因为检不出所以是 0」）

🟡 恒空档报 0 是**否定结论**，必须先证明这一档能被检出：

```
  ProductionSchedule.qty  -> EMPTY    (0/0)      want=EMPTY     OK
  BOMDetail.parentItemId  -> EMPTY    (0/105)    want=EMPTY     OK
  Base.baseId             -> OK       (13/13)    want=OK        OK
  Line.businessType       -> NO_FIELD (11 props) want=NO_FIELD  OK
  ZzzFakeType.nope        -> NO_TYPE  ()         want=NO_TYPE   OK
```

全库实测：**813 个已声明属性中 75 个覆盖率为 0**，**94 个对象类型中 8 个实例数为 0**
（`AdoptedMitigation` / `ProductionSchedule` / `ShiftPlan` / `WIPMove` / `WIPQualityCheckpoint` /
`SparePartConsumption` / `OperatorAttendance` / `OperatorSkillCert`）。
**这一档确实存在、确实可检出，只是没有任何 PRD 的 `Type.field` 引用落在上面** —— 故 🟡 = 0 是真结论。

### 1.3 抽取器金丝雀（正 3 反 1）

```
CANARY OK: '`Base.baseId` 是主键'                              -> [('Base','baseId')]
CANARY OK: '判据来自 `Line.businessType` 与 `SEG_REGISTRY.marginPct`'
                                                -> [('Line','businessType'),('SEG_REGISTRY','marginPct')]
CANARY OK: '`CausalFactor.metricKey === m.key && !isRoot`'     -> [('CausalFactor','metricKey')]
CANARY OK (negative, 无反引号 → 不该命中):
           '见 apps/datacore/src/solvers/service.ts:1340 和 Base.baseId 裸文本'  -> []
```

反向金丝雀专治两个已知骗法：**表达式里的多 token**（第 3 条，`===` 右边的 `m.key` 不许污染）与
**裸文本/路径误报**（第 4 条）。

### 1.4 符号索引金丝雀

```
scanned 534 source files; 4068 symbols; 216 key:"X" literals
  CANARY symbol ObjectTypeDef: OK
  CANARY symbol FeatureDef: OK
  CANARY negative ZzzNotARealSymbolXyz: OK (absent)
```

**这个索引是防误判的关键**：`ObjectTypeDef.properties` / `FeatureDef.key` 这类是 **TS 契约类型**，
有编译器兜底，**不该**被报成「本体里没这个类型」。少了这一步，🔴 类型不存在会被虚报 **331 条**。

---

## 2. 真值源与方法

### 2.1 为什么用运行态而不是文档/契约

派单要求「优先用运行态接口 —— 那是唯一的真现状」。本次照做，并且**自证了服务确实是我起的、且是新构建的**：

```bash
pnpm --filter @platform/llm-adapters build      # 先补：datacore 依赖它，缺了会报与本单无关的假红
pnpm --filter datacore build ; echo "DATACORE_BUILD_RC=$?"   # → 0（显式捕获退出码，不走管道）
PORT=4094 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-audit SEED_DEMO=1 CREDENTIAL_KEY=<64hex> \
  node apps/datacore/dist/server.js
curl -s http://127.0.0.1:4094/readyz        # → {"status":"ready"}
curl -s -H 'X-Debug-User: demo:admin:admin' http://127.0.0.1:4094/a/v1/ontology/object-types
```

**三个踩过的坑，记在这里省下次的时间**：

1. **`pnpm --filter datacore build` 会因 `@platform/llm-adapters` 未构建而失败**
   （`error TS2307: Cannot find module '@platform/llm-adapters'`）。
   派单模板里只写了「`@platform/contracts` 可能未 build」——**实测 `llm-adapters` 也要**。
2. **后台起服务用 `&` 会被回收**：第一次起的实例活过了三次工具调用后静默消失，
   下一次 `urllib` 直接 `Connection refused`。必须真正 detach。
3. **构建失败会被包装层的退出码盖住**：后台任务报 `exit code 0`，而日志里 tsc 明写 `Exit status 2`。
   这正是本仓「门必须显式捕获退出码」那条铁律的同形复发 —— **点开日志才看见**。

实测口径：**94 个对象类型 · 813 个已声明属性 · 0 个拉取错误**。

### 2.2 判据（逐条可复验）

| 档 | 机器判据 |
|---|---|
| 🔴 类型不存在 | LHS 不在 94 个运行态 objectType 中，**且**不在 4068 个代码符号中，**且**不是文件名/JS 内置/原型全局/占位符 |
| 🔴 字段不存在 | LHS 是 objectType，RHS 不在 `properties` 也不在 `derivedProperties`，也不在实例上出现 |
| 🟡 恒空 | RHS 在 `properties`，但全部实例上该值为 `null`/`""`/`[]`/`{}` ⇒ 覆盖率 0 |
| ✅ 有值 | 覆盖率 > 0，给出 `覆盖数/实例数` |

**现状 vs 目标**按派单要求人工判读上下文措辞（「新增/补/加属性/应当」= 目标；
「取自/读/已有/=值」= 现状）。**判不准的一律进 §7 未判定，不塞进 🔴。**

---

## 3. 🔴 字段不存在 —— 逐条（7 处 / 6 个 `Type.field` / 5 份 PRD）

**这一档就是 A6 那个形态：类型在、字段不在、PRD 以现状口吻引用。**

| # | PRD 文件:行 | `Type.field` | 真值实测 | 定性 |
|---|---|---|---|---|
| 1 | `docs/PRD-capacity-live-cockpit.md:72` | `Base.weeklyCap` | `Base` 有 19 属性 / 13 实例，**无 `weeklyCap`**（产能类只有 `gwh`/`formationCapDaily`/`agingCapDaily`） | 现状口吻：「`targetType/targetProp` **传**产能目标（`Base.weeklyCap`…）」 |
| 2 | `docs/PRD-capacity-live-cockpit.md:174` | `Material.coverage` | `Material` 有 19 属性 / 8 实例，**无 `coverage`**；且**同名字段在 `MaterialBalance` 上也不存在**（该类型只有 `matBalId/material/unit/netDemandTon/ltaPct/gapTon/etaDate`） | **类型名可能也写错了**。这条是 SEAM-GATE 的**验收判据本身**：「改一个 `Process×Model` 的 `Material.coverage` → …」——**改无可改，这条门今天写不出来** |
| 3 | `docs/PRD-capacity-inference-completion.md:75` | `Metric.gap` | `Metric` 有 14 属性 + 2 派生（`delta`/`gapPct`）/ 10 实例，**无 `gap`** | 现状口吻：「**链路**：**归因链**（§3）`Metric.gap → 结构反向分摊…`」。真名是 `delta` 或 `gapPct` —— **命名漂移** |
| 4 | `docs/PRD-lever-binding-drift.md:233` | `ChangeoverMatrix.changeoverMin` | `ChangeoverMatrix` 有 6 属性 / **30 实例**：`pairId/fromModel/toModel/**minutes**/hours/lineId`，**无 `changeoverMin`** | PRD 诊断它「双重死」，但归因于「`capacity.ts` 全文不出现 `ChangeoverMatrix`」——**漏了一层：属性名本身就是错的**（真名 `minutes`）。**数据其实有 30 条**，不是没数据 |
| 5 | `docs/PRD-lever-binding-drift.md:246` | `ChangeoverMatrix.changeoverMin` | 同上（`G-LEVER-BINDING-DRIFT` 断点登记原文） | 同上 |
| 6 | `docs/PRD-sandbox-redesign.md:375` | `Order.changeoverMin` | `Order` 有 16 属性 + 1 派生 / 24 实例，**无 `changeoverMin`** | 现状口吻断言取值：「**C22** `Order.changeoverMin`=120。」**同仓 `PRD-sandbox-a2.md:50` 已明写它「无对象承载而 UNRESOLVED」** —— 两份 PRD 自相矛盾 |
| 7 | `docs/PRD-stale-claims.md:82` | `Cadence.kind` | `Cadence` 有 11 属性 / **8 实例**，真名是 **`cadenceKind`**，无 `kind` | 双重过期：① 属性名错；② 同句断言「今天 `Cadence` 对象 **0 条**」——**实测 8 条**。文件名叫 `stale-claims`，自己成了 stale claim |

### 3.1 按 PRD 汇总

| PRD | 处数 |
|---|---|
| `docs/PRD-capacity-live-cockpit.md` | 2 |
| `docs/PRD-lever-binding-drift.md` | 2 |
| `docs/PRD-capacity-inference-completion.md` | 1 |
| `docs/PRD-sandbox-redesign.md` | 1 |
| `docs/PRD-stale-claims.md` | 1 |

### 3.2 六条里有**四条**是「命名漂移」不是「真缺字段」

`Metric.gap`→`delta/gapPct` · `ChangeoverMatrix.changeoverMin`→`minutes` · `Cadence.kind`→`cadenceKind`。
**数据都在**（10 / 30 / 8 条实例），只是 PRD 抄错了名字。

这比「字段真缺」**更阴险**：真缺字段做的时候会撞上「没这列」，立刻暴露；
而名字写错的，读出来是 `undefined` → 走 `?? 0` 兜底 → **静默算成 0，全程无报错**。
`PRD-lever-binding-drift.md` 自己描述的 `G-LEVER-BINDING-DRIFT` 断点
（「交集空则该瓶颈层永远拨不出候选、**且全程无报错**」）就是这个病的实例 ——
只是那份 PRD 归因到了 join 的另一侧，没归到属性名。

---

## 4. 🔴 类型不存在 —— 0 条确认

**扫描确实抽出了 68 个「LHS 不是运行态 objectType」的候选，逐条追下去后全部归入别处**：

| 去向 | 处数 | 说明 |
|---|---|---|
| 越界·代码符号 | 331 | `ObjectTypeDef.properties` / `FeatureDef.key` 等 **TS 契约类型**，编译器兜底 |
| 越界·AgentCore 实体 | 27 | `Skill.execution` / `Intent.slots` / `SkillExecutionTrace.humanFeedback` 等，**B 系统**的域对象，不归 DataCore 本体管 |
| 越界·前端原型全局 | 17 | `AUDIT.push` / `SOP_SEG.p50` / `MODEL_DEF.bases` / `AI_REBUILD.proj` 等 —— 已逐个在 `docs/reference-prototype-decision-platform.html` 核到定义行（`AUDIT` L2957 · `SOP_SEG` L4993 · `STORY_POS` L5119 · `VIEWS` L1353 · `MODEL_DEF` L1542 · `AI_REBUILD` L3459）。**PRD 引的行号是对的** |
| 越界·占位符 | 6 | `Type.prop`（字面意义的「某类型的某属性」）、`OLD.answer`/`NEW.answer`（run-OLD/run-NEW） |
| 🎯 目标 | 7 | `Group.blendedMarginPct` 等提议新建的聚合类型 |
| 📌 已知 | 3 | `Quote.marginPct/floorPct`（PRD 明写「Quote 仅 eval 期注入命名空间**非本体对象类型**」）、`ApprovalPolicyEngine.resolve`（PRD 明写「**不做**」） |
| ⚪ 未判定 | 4 | 见 §7 |

**⚠️ 这个 0 有一个重要的但书 —— 见 §6.3。**
顺着 `PRD-sandbox-a2.md:43` 的 `Batch.idleDays` 多追一层，抖出
`BATTERY_RULE_SCOPES` 里**四条规则作用域名的不是对象类型**（`Batch`/`Cert`/`Lta`/`Outsource`），
而真承载者 `MaterialBatch`(24 实例·`idleDays` 24/24) / `Certification`(18) / `LongTermAgreement`(3)
就在本体里躺着。**按本审计判据（判 PRD 不判规则表）本档记 0，但那个缺口是真的，且比 PRD 侧的更值钱。**

---

## 5. ✅ 有值 —— 129 处 / 61 个 `Type.field` / 28 份 PRD

覆盖率全部实测（`覆盖数/实例数`）。61 个去重 `Type.field` 中 60 个带比值、1 个是派生属性
（`Order.value`）；**带比值的 60 个里 56 个满覆盖**，非满覆盖 4 个：

| `Type.field` | 覆盖率 | 备注 |
|---|---|---|
| `Metric.businessType` | **3/10** | 只有 3 个细分指标带业务线；其余 7 个（`gm_rate`/`material_cov` 等）是全域指标，**空得有道理** |
| `Cadence.offsetDays` | **4/8** | |
| `CausalFactor.metricKey` | **20/28** | 8 条为空 = 共享因果域（`battery-extended.ts:205` 明写「metricKey 为空表示共享域」）——**这就是 A6 那份 PRD 里 `seg_attain_ess` 路由不到专用域的原因**，空值是设计 |
| `Process.requiredThroughput` | **260/650** | 只有瓶颈工序落值 |

引用最密的 5 份（`✅` 处数）：`PRD-inference-line.md` 22 · `PRD-lever-binding-drift.md` 21 ·
`PRD-segment-scoped-gap-attribution.md` 15 · `PRD-topo-realdata.md` 10 ·
`PRD-capacity-feasibility-demanddelta-fix.md` / `PRD-node-semantics.md` 各 8。

> **注意这份名单和 §3 的名单高度重合**：`PRD-lever-binding-drift.md` 同时是 ✅ 最多（21）
> 和 🔴 之一（2）。**「引用得多」不等于「引用得准」，但也不等于「引用得不准」** ——
> 92% 的准确率来自它真的去核过，剩下 2 条是核到了 join 的一侧没核另一侧。

---

## 6. 🧪 本次最重要的发现 —— `Type.field` 是一个**四义词**，其中两义无人校验

派单假设 `` `Type.field` `` 指的是「本体对象的属性」。**实测不是。** 同一个记法在本仓指四种东西：

| # | 含义 | 真值源 | 有没有人校验？ | 写错了会怎样 |
|---|---|---|---|---|
| 1 | **本体对象属性** | `/a/v1/ontology/object-types` | ⚠️ 无静态校验（本审计就是在补这一层） | 读出 `undefined` |
| 2 | **仿真状态变量** | `sim_propagation_rule.sourceStateVar/targetStateVar` | ❌ **完全无校验** | **静默读作 0** |
| 3 | **规则求值命名空间** | 规则 DSL `expression` + `scopeObjectTypes` | ⚠️ 运行期 UNRESOLVED（有信号但弱） | 该规则静默不生效 |
| 4 | **前端原型全局变量** | `docs/reference-prototype-decision-platform.html` | ✅ 引用行号，人工可核 | 无（只是文档） |

### 6.1 第 2 义的取证（沿链路追到底，不停在 grep）

`PRD-UPGRADE-decision-sandbox-v2.md` §2.2④ / §3.1.4 里的 15 处 `Type.field`
（`Base.load` / `Supplier.deliveryDelay` / `Material.available` / `Order.shortage` /
`Line.downtime` / `Base.capacity` / `Order.lateRisk` / `Shipment.leadTime` / `Order.otd` /
`Material.price` / `Order.cost` / `Receivable.days`）**没有一个是本体属性**。

追进种子（`apps/datacore/src/seed.ts:236-252`）才看清它们的真身：

```ts
{
  key: "demo_model_demand_to_base_load",
  sourceTypeKey: "Model",  sourceStateVar: "demandLoad",
  viaLinkKey:    "model_producible_at",
  targetTypeKey: "Base",   targetStateVar: "loadIndex",   // ← PRD 写作 “Base.load”
  ...
}
```

即 `Base.load` = `targetTypeKey:"Base"` + `targetStateVar:"loadIndex"` ——
**是仿真状态变量，不是 `Base` 的属性**（`Base` 的 19 个属性里确实没有 `load`）。

再追一层到引擎（`apps/datacore/src/sim/propagation.ts:367`）：

```ts
function readVar(state: TickState, objectId: string, stateVar: string): number {
  const v = state[objectId]?.[stateVar];
  return typeof v === "number" ? v : 0;          // ← 名字写错 = 静默 0，无任何报错
}
```

写侧同样自由：`bucket[targetStateVar] = round12(value)`（`:478`）——
**`stateVar` 是一个自由字符串键，全仓没有任何地方把它校验回本体属性。**

### 6.2 由此得到两条 PRD 之外的实质结论

**① §3.1.4「补边 = 补种子，不改引擎」这句话，字面上成立，但会造出一张自欺的图。**
那六条边确实可以纯靠插 `sim_propagation_rule` 行建出来（stateVar 随便命名都不报错）。
但 `readVar` **永远不从对象属性读初值** —— 状态变量是一个**闭世界**，只被扰动写入。
于是 `Supplier.deliveryDelay` 这条边建好之后，**它跟真实供应商的交期没有任何关系**：
`Supplier` 有 15 个属性（含 `leadTime`/`transitDays`/`onTimeRate`）却一个都不会被读进来。
**这正是「接了线没数据」的升级版：线接了、数据也有，但两者之间没有连接件。**

**② 这是 A6 那个坑的同源体，而且更隐蔽。**
A6 是「PRD 假设了一个不存在的归属关系（Line→业务线）」；
这里是「PRD 假设了一个不存在的**读取关系**（状态变量→对象属性）」。
两者都不是模块内部的错，都在**接缝**上 —— 与本仓「断点常在接缝而非模块内部」一致。

### 6.3 追一个「未判定」多追一层，抖出四条规则作用域的命名漂移

`PRD-sandbox-a2.md:43` 引了规则 C28 `Batch.idleDays > 90`。**PRD 引得一字不差**，
但 `Batch` 不是对象类型。按铁律 0.5 再追一层（grep 不是结论），抖出的东西比原问题大：

`apps/datacore/src/synthetic/battery.ts:2816` `BATTERY_RULE_SCOPES` 里**四条作用域名不是对象类型**，
而真正的承载者就在本体里、且**数据满覆盖**：

| 规则 | 声明的 scope | 真实对象类型 | 实测数据 |
|---|---|---|---|
| C28 呆滞预警 | `["Batch"]` | **`MaterialBatch`** | 24 实例，`idleDays` **24/24 满覆盖** |
| C26 | `["Cert"]` | **`Certification`** | 18 实例 |
| C27 | `["Lta"]` | **`LongTermAgreement`** | 3 实例 |
| C31 | `["Outsource"]` | 未找到对应类型 | — |

`battery.ts:2819` 的注释写着「与 expression 对象前缀一致」——
**这句话正是病根**：它把「规则表达式里的注入命名空间」和「本体对象类型键」**当成了同一个东西**，
于是照着表达式前缀抄进了 `scopeObjectTypes`。二者恰好同名时没事，
`Batch`/`MaterialBatch` 这种不同名的就悄悄错开。

**已验证的后果**（真跑，非推断）：`apps/datacore/src/databuilder/comprehend.ts:214`

```ts
const rules: PlanRule[] = core.rules.filter((r) => r.scopeObjectTypes.every((t) => typeKeys.has(t)));
```

**scope 里有一个不认识的类型键，整条规则被静默丢掉** —— 无日志、无报错。
这四条规则在 databuilder 路径上过不去这道 filter。

**必须说清楚我验证到哪、没验证到哪**（不许把推断说成实测）：

- ✅ **已实测**：`Batch`/`Cert`/`Lta`/`Outsource` 不在 94 个运行态对象类型里；
  `MaterialBatch.idleDays` 24/24；`comprehend.ts:214` 确实按 scope 过滤丢弃。
- ✅ **已实测**：`POST /a/v1/rules/evaluate {"ruleIds":["C28"],"payload":{"Batch":{"idleDays":120}}}`
  → `passed:false`，**规则本身能正常求值** —— 因为 DSL 吃的是**调用方注入的 payload 命名空间**，
  不是对象库。这与 `PRD-chain-24nodes.md:149` 对 `Quote` 的描述（「仅 eval 期注入命名空间非本体对象类型」）**同构**。
- ❌ **未验证**：demo 租户运行期到底有没有人给 C28 喂 `Batch` payload
  （即这条 WARN 今天会不会真的响）。要定这个得跑 `chain_impediments` 全链，
  **本单画像=轻，不跑**。留给引擎侧一单。
- ❌ **未验证**：`PRD-sandbox-a2.md:43` 同段「静态口径 4、实测只见 3」这个计数是否受本条影响。

**这一条是本次审计里唯一「数据 100% 齐备、却因为一个名字对不上而可能白白用不上」的实例 ——
形态与 §3 那六条命名漂移完全一致，只是发生在规则表而不是 PRD 里。**

---

**建议（不在本单范围，仅记录）**：给 `sim_propagation_rule` 的
`sourceStateVar`/`targetStateVar` 加一道发布期校验（要么必须是 `targetTypeKey` 的已声明属性、
要么必须登记在一张显式的「纯仿真变量」白名单里）。今天这两者混在一个自由字符串里，
**从数据上分不出「我故意用仿真变量」和「我把属性名打错了」。**

---

## 7. ⚪ 未判定（4 处 · 不塞进 🔴）

| PRD 文件:行 | `Type.field` | 为什么判不准 |
|---|---|---|
| `docs/PRD-goal-metric-owner-spine.md:19` | `Metric.miss` | **同一句话里两种口吻**：`Metric{target←目标树, actual←数据源派生, **delta/miss←派生**}` 是在**声明模型**（目标），紧接着「越线 `Metric.miss → plan_rootcause 推演`」又像在描述**现状**。实测 `Metric` 有派生 `delta`/`gapPct`、**无 `miss`**。是「提议新增派生属性」还是「把 `delta` 写成了 `miss`」，从文本判不出 |
| `docs/PRD-sandbox-a2.md:43` | `Batch.idleDays` | **PRD 的引用准确**（逐字引规则 C28）。追下去发现缺陷在规则表不在 PRD —— **单列成 §6.3**，那里给了完整取证 |
| `docs/PRD-sandbox-metro-semantics.md:34` | `AndJoin.basis` | `AndJoin` 既不在本体也不在符号索引；上下文「与 `AndJoin.basis`（齐套 AND 也是结构推定）同族纪律」像在指一个已有概念，但找不到落点 |
| `docs/industrial-prd/PRD-IND-order-aggregate.md:213` | `SolverParam.affected` | 出现在「建议前端纯派生」的方案描述里，无法判断是既有求解器参数还是提议新增 |

---

## 8. 我推翻了派单里的哪几条

### 8.1 「93 份有验收判据章，其中 80 份（86%）零数据前置/缺口讨论」—— **复算不出来**

| 口径 | 派单 | 实测 |
|---|---|---|
| `docs/PRD-*.md` 总数 | 129 | **129** ✔ |
| 有「验收*」章的 | 93 | **103** |
| 其中验收章内零数据/缺口讨论 | 80（86%） | **57（55%）** |

复验命令与判据（金丝雀：`PRD-data-backfill.md` 的验收章**必须**命中数据讨论 —— 实测命中）：

- 「有验收章」= 存在标题含「验收」的 markdown heading。
- 「有数据讨论」= **该验收章正文内**出现
  `种子|seed|覆盖率|没数据|无数据|零数据|字段缺失|属性缺失|数据前置|接了线没数据|恒空|空表|0 条|没有值|无对象承载|未落值|缺口|数据缺|NO_CARRIER|没定义` 之一。

**⚠️ 我自己第一版也踩了铁律 0.6 的坑，一并记账**：第一次我扫的是**整份文档**而不是验收章，
得到「零讨论的只有 6 份（6%）」—— 数字漂亮但**度量的不是要度量的东西**
（正文里一句 `SEED_DEMO=1` 的 bash 片段就能让整份文档「有数据讨论」）。
形态正是那句：**「我用 X 当作 Y 的证据，而 X 并不度量 Y。」** 改成只扫验收章，55% 才是可比的数。

**结论**：**定性方向一致（多数验收章确实不谈数据前置），但 86% 这个数偏高，实测 55%。**
且我这个 55% 仍是**宽松上界口径**（关键词命中一次即算「谈了」，哪怕只是提了句 seed），
真正**逐字段核过覆盖率**的 PRD 远少于 46 份 —— 目测只有 `PRD-data-backfill.md` 一份做到了。

### 8.2 「那 80 份里字段级引用很多（`PRD-skill-contract-dsl` 引了 49 个 `Type.field`，`PRD-skill-governance-learning` 40 个）」—— **数字对不上，且这两份不该算在本命题里**

实测（反引号内 `Type.field` 原始命中数）：`PRD-skill-contract-dsl.md` **33** 处、
`PRD-skill-governance-learning.md` **48** 处。派单是 49 / 40 —— 后者接近，前者对不上。

> **⚠️ 这里我又踩了一次同一个坑，第三次了，照铁律 0.6 记账**：我第一版写的是「16 / 37」，
> 那是 `grep -c` 的输出 —— **它数的是「含命中的行数」，不是「命中次数」**。
> 一行里写三个 `Type.field`（本仓表格里极常见）就少数两个。
> 形态还是那句：**「我用 X 当作 Y 的证据，而 X 并不度量 Y。」**
> 本节和 §8.1 是同一天内同一个病的两次复发 —— **凡计数，必须确认计数单位就是结论的单位。**

更要紧的是**定性**：这两份**几乎全部**是 `Skill.execution` / `Intent.slots` /
`SkillExecutionTrace.humanFeedback` 这类 **AgentCore 实体**与 **TS 契约类型**，
**不是 DataCore 本体对象属性**。它们背后有 zod schema 和编译器，
**不存在「提到字段但没值」这个风险类别** —— 拿它们当「字段级引用很多却没核过」的例证，
指错了对象。本审计把这 27 处归入「越界·AgentCore 实体」。

### 8.3 「存量清单会很长」—— **实测很短**

派单的预期（基于 A6 一例外推）是大面积失地。实测在范围内的 189 处引用里，
**真缺陷 7 处、恒空 0 处**，✅ 129 处。**本仓 PRD 的字段引用准确率约 96%。**
风险不在「量」，在 §6 那个**记法歧义**上 —— 那才是 A6 能发生的结构性原因。

---

## 9. 复验命令（逐条可重跑）

```bash
# 0) 起真值源（注意：llm-adapters 必须先 build，否则 datacore build 报 TS2307）
pnpm install --prefer-offline
pnpm --filter @platform/contracts build
pnpm --filter @platform/llm-adapters build
pnpm --filter datacore build ; echo "RC=$?"      # 必须 0；别用管道，$? 会被 tail 吃掉
PORT=4094 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-audit SEED_DEMO=1 \
  CREDENTIAL_KEY=$(python3 -c "print('a'*64)") node apps/datacore/dist/server.js &
curl -s http://127.0.0.1:4094/readyz                        # {"status":"ready"}

# 1) 金丝雀 A（必须 ✅ 13/13）与金丝雀 B（必须 🔴 无此字段）
curl -s -H 'X-Debug-User: demo:admin:admin' \
  'http://127.0.0.1:4094/a/v1/ontology/object-types' \
  | python3 -c "import json,sys;d=json.load(sys.stdin);\
p={t['key']:[x['propKey'] for x in t['properties']] for t in d};\
print('Base.baseId  in props:', 'baseId' in p['Base']);\
print('Line.businessType in props:', 'businessType' in p['Line']);\
print('Line props:', p['Line'])"

# 2) A6 定性复验：业务线字段只挂订单，不挂产线/工序
#    → Order.businessType 24/24 ; Line/Process 无该字段
curl -s -H 'X-Debug-User: demo:admin:admin' \
  'http://127.0.0.1:4094/a/v1/objects?type=Order&pageSize=500' \
  | python3 -c "import json,sys;d=json.load(sys.stdin)['items'];\
print('Order.businessType 覆盖:', sum(1 for o in d if o['props'].get('businessType')), '/', len(d))"

# 3) §6 的第三义取证：状态变量不是属性，且写错静默读 0
sed -n '236,252p' apps/datacore/src/seed.ts        # targetStateVar: "loadIndex"
sed -n '367,370p' apps/datacore/src/sim/propagation.ts   # readVar → 0 兜底

# 4) §3 六条命名漂移的真名
#    Metric: delta/gapPct（非 gap/miss） · ChangeoverMatrix: minutes（非 changeoverMin）
#    Cadence: cadenceKind（非 kind） · Cadence 实例数 8（非 0）

# 5) §6.3 规则作用域命名漂移（金丝雀：key:"Base" 必中，中了才信 Batch 的 0 命中）
grep -rn 'key: "Base"'  apps/datacore/src --include=*.ts | head -2   # 金丝雀，必须有命中
grep -rn 'key: "Batch"' apps/datacore/src --include=*.ts             # 预期 0 命中
sed -n '2816,2830p' apps/datacore/src/synthetic/battery.ts           # BATTERY_RULE_SCOPES
sed -n '214p'       apps/datacore/src/databuilder/comprehend.ts      # scope 不认识 → 整条丢弃
curl -s -H 'X-Debug-User: demo:admin:admin' -H 'Content-Type: application/json' \
  -X POST 'http://127.0.0.1:4094/a/v1/rules/evaluate' \
  -d '{"ruleIds":["C28"],"payload":{"Batch":{"idleDays":120}}}'      # → passed:false（注入即可求值）
```

扫描脚本留在会话 scratchpad（`extract.py` / `symbols.py` / `classify.py` /
`adjudicate.py` / `recount2.py`），**未落库** —— 本单范围边界只允许写本文件。
若要把它固化成门，建议归入 `scripts/` 另开一单（见 §6.2 建议）。

---

## 10. 本体引用与影响

- **触及对象类型**：`Base` · `Line` · `Process` · `Order` · `Metric` · `Material` ·
  `MaterialBalance` · `Customer` · `MaintPlan` · `Cadence` · `Segment` · `DemandSegment` ·
  `Supplier` · `Shipment` · `ChangeoverMatrix` · `CausalFactor`（**只读，未改任何类型定义**）。
- **触及链路**：归因链（`Metric → 结构反向分摊 → CausalFactor`）· 沙盘传导链
  （`sim_propagation_rule → propagateTick → TickState`）· 产能拨杆链
  （`LEVER_FACTOR_PROPS × CAPACITY_FACTOR_BINDINGS`）。
- **触及事件**：无。
- **触及不变量**：R6 确定性（本审计全程 seed 42，可字节级重跑）· R13 出处透明
  （§6 指出仿真状态变量一路无出处校验）· R14 应用层无业务常数。
- **触及断点**：`G-LEVER-BINDING-DRIFT`（§3 #4/#5 给它补了**属性名错误**这一层根因，
  原登记只归因到 join 的另一侧）。**§6.3 的规则作用域命名漂移当前无断点编号**，
  若确认要修，建议新登记一条（形态：「规则 scopeObjectTypes 与本体类型键不同名 ⇒ 规则被静默丢弃」）。
- **是否需要回写 `docs/SYSTEM-ONTOLOGY.md`**：**本单不回写**（范围边界明令别碰，且另有 dev 在写）。
  **但 §6 那条建议若被采纳（给 stateVar 加发布期校验），届时必须新增一个断点编号并回写 §8。**
  本文件先把取证留在这里，供本体维护方取用。

---

*本审计只读取证，未修改任何 PRD、代码、种子或本体。全部否定结论（🟡=0、🔴类型不存在=0）
均附金丝雀命中证据（§1.2 / §1.3），符合铁律 0.6「报 0 命中必须同时给出金丝雀」。*
