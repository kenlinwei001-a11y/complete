# AUDIT · `discoverLevers` 返回空 —— 真因取证

**工单**：WO-LEVERS-ROOTCAUSE · **日期**：2026-08-08 · **基线**：`claude/integration-sandbox-batch` @ `fb99c91c`
**取证方式**：真跑（内存模式 datacore·端口 4477·`SEED_DEMO=1`·demo/admin），非静态读码猜测。
**结论一句话**：`discoverLevers` 的**通用路径恒空**，真因是 **`derivationSpecs` 表在任何播种租户里都是空的**
（`service.ts:714` 读的那张表没有任何生产写入方），且**种子里的派生声明写的是另一套语法、进不了这张表**。
**形态 = ②「接了线没数据」**，但比普通的②更硬：**这份数据在现有代码里无法由种子产生**（双引擎不互通）。

---

## 0 · TL;DR（给排期用）

| 问题 | 形态 | 真因 `file:line` | Level-1 影响 |
|---|---|---|---|
| **A · 通用路径恒空**（无 `grain`） | ② 接了线没数据 | `service.ts:714` 读 `derivationSpecs`；该表唯一写入方 `ontology-core.ts:246` ← 唯一 src 调用方 `app.ts:2922`（HTTP 端点）；**种子零调用** | 🔴 **塌**。PRD §3.2 第 1 步拿不到杠杆 |
| **A′ · 而且补不上**（语法不通） | ② 的加重形态 | 种子 `battery.ts:650` 写 `AVG(Equipment.oee_current BY baseId)`；`ontology-core` 的 `parseFormula`（`ontology-dsl.ts:352`）只认 `out(L)/in(L)` 导航 → **实测 400** | 🔴 不是"补一行 seed"能了事 |
| **B · scope 用业务键必空** | ③ 接了线接错地方 | `service.ts:751` 是 `scope.includes(o.id)` **精确匹配 ontology objectId**；而 `ChainImpediment.locus.objectId` 是**业务键**（`elyte_b2` / `mbal-6`） | 🔴 即使修好 A，PRD §3.2 的 `scopeObjectIds:[locus.objectId]` 仍恒空 |
| **C · capacity 路径按 `设备OEE` 过滤必空** | ② 幽灵属性（`G-LEVER-PROP-PHANTOM`） | `service.ts:356` 声明 `设备OEE → ["Equipment.oee_current"]`，但 `CAPACITY_FACTOR_BINDINGS`（`capacity-factors.ts:50-74`）**无 `oee_current`**（只有 `oeeA/oeeP/oeeQ/ctSeconds`）→ `service.ts:851-854` 候选集空 | 🟡 只影响产能页，不挡 Level-1 |

> **注意 C 与 A 是两条独立的病**，分处 `discoverLevers` 的两个分支（`service.ts:703` 分流）。
> 上一个 dev 那句「连不带 scope 都是空」只覆盖了 A；**C 是本单新查出来的**。
> 而 **B 是本单最关键的新增发现**——它不在原工单的四种形态假设里，且**单修 A 不够**。

---

## 1 · 全部生产调用方（含"怎么确认没漏网"）

`discoverLevers` 是 `private`，**唯一入口是字符串键分发**：`service.ts:657`
```ts
if (str(args.mode) === "levers") return this.discoverLevers(ctx, args);
```
所以「调用方」= **任何以 solver key `generic_inference` + `args.mode==="levers"` 发起的请求**。
按铁律 0.5 第 3 条，这类分发 `grep discoverLevers` 一次是看不见的 —— 我追的是 `mode:"levers"` 这个键。

| # | 生产调用方 `file:line` | 走哪条分支 | 实参（真实形态） |
|---|---|---|---|
| 1 | `apps/frontend-shell/src/views/sim/ProjectSimView.tsx:877` → `DynamicLeverPanel.tsx:136` → `api/endpoints.ts:205-218` | **通用**（无 grain） | `{mode:"levers", factors:[⑤瓶颈], targetType:"Base", targetProp:"oeeIndex", topK:6}`·**无 scopeObjectIds** |
| 2 | `apps/frontend-shell/src/views/RiskBoardView.tsx:876` → 同上 `DynamicLeverPanel.tsx:136` | **capacity grain** | `{mode:"levers", grain:"process-model", targetType:"Base", targetProp:"weeklyCap", modelId:<基地名>, scopeObjectIds:["obj_base_…"], factors:[card.factor,…]}` |
| 3 | `apps/agentcore/src/server.ts:2015-2020` | **通用** | `{mode:"levers", scopeObjectIds:["changzhou"]?, factors:intent.factors, topK:5}`·**无 targetType/targetProp** |
| 4 | `apps/agentcore/src/router/ceo-route.ts:150`（`whatIfArgsFrom`，触发点 `:392`）＋ workflow 种子 `apps/agentcore/src/mocks/seed.ts:707-718` | **通用** | `{mode:"levers", targetType:"Line", targetProp:"utilization", topK:6, scopeObjectIds:["changzhou"]?, factors:[…]?}` |

**怎么确认没有间接调用方漏网**（逐条自证，不是"我 grep 了"）：

1. **分发点唯一**：`discoverLevers` 只被 `service.ts:657` 调用；`genericInference` 只经求解器注册表按 key `generic_inference` 分发。
   ⇒ 任何调用方都必须同时满足「solver key = `generic_inference`」且「`args.mode="levers"`」。
2. **按 `mode` 键全仓扫**（不是扫函数名）：`apps/*/src` + `packages/*/src` 里 `"levers"`/`'levers'` 的全部命中已逐条读过，
   除上表 4 处外只剩注释、`outputShape` 声明（`navigation-slice.ts:139`，只是能力描述**不发起调用**）、
   `portfolio` 的**同名不同物** `args.levers`（`service.ts:2725`，是 `PortfolioInput.levers`，与 mode 无关）、以及 MSW mock（`handlers.ts`，非生产）。
3. **配置/数据面也扫了**：`apps`+`packages` 下 `*.json/*.jsonl/*.yaml/*.yml` 搜 `levers` → **零命中**
   ⇒ 不存在"从 JSON 工作流/技能定义里字符串注入 mode"的隐藏调用方（agentcore 的 `ceo_whatif` 是 TS 种子，即上表 #4）。
4. **前端侧收口**：`endpoints.ts` 的 `discoverLevers` 硬写 `mode:"levers"`，其 import 方只有 `DynamicLeverPanel.tsx:5`（用在 `:136`）。
   `DynamicLeverPanel.tsx:209` 的 `runSolver("generic_inference", …)` 是**拨杆重算（apply）路径**，不带 mode，不入本函数。
5. **工具自证**（铁律 0.5 第 5 条）：同一条 grep 命令对已知存在的符号（`LEVER_FACTOR_PROPS`、`discoverLevers`）均有命中，
   证明不是 pathspec 写法导致的假 0。

---

## 2 · 生产实参 vs 实验实参：差在哪

上一个 dev 的实验实参未留档。本单**照上表逐条复刻生产实参**重跑，并加两条对照。
**结论：不是"调用方式不对"** —— 生产实参、裸调、去掉 factors、去掉 scope，**七种打法全空**。

### 2.1 实测原文（请求 + 响应逐字）

服务：`PORT=4477 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-lv SEED_DEMO=1 CREDENTIAL_KEY=4×64 node apps/datacore/dist/server.js`
**自证是本份构建**：`ps` 全机仅一个 `apps/datacore/dist/server.js`（pid 30826），
`readlink /proc/30826/cwd` = 本 worktree，`dist/server.js` mtime = 03:56:10（本次 build 产物）。

```
=== PROD-1 ProjectSimView（DynamicLeverPanel 默认）===
ARGS: {"mode":"levers","factors":["设备OEE"],"targetType":"Base","targetProp":"oeeIndex","topK":6}
{"data":{"levers":[],"deltas":[],"rows":[],"affectedObjects":0,"count":0,"rootTypes":[]},"snapshotVersion":"1.1"}

=== PROD-2 agentcore server.ts:2015 带 scope ===
ARGS: {"mode":"levers","scopeObjectIds":["changzhou"],"factors":["设备OEE"],"topK":5}
{"data":{"levers":[],...,"count":0,...}}

=== PROD-2b agentcore server.ts:2015 无 baseId（scope 省略）===
ARGS: {"mode":"levers","factors":["设备OEE"],"topK":5}
{"data":{"levers":[],...,"count":0,...}}

=== PROD-3 ceo-route.ts:150 whatIfArgsFrom ===
ARGS: {"mode":"levers","targetType":"Line","targetProp":"utilization","topK":6,"scopeObjectIds":["changzhou"],"factors":["瓶颈工序"]}
{"data":{"levers":[],...,"count":0,...}}

=== CTRL-4 裸调 ===
ARGS: {"mode":"levers"}
{"data":{"levers":[],...,"count":0,...}}

=== CTRL-5 无 factors + Base.oeeIndex（排除 factors 过滤吞掉）===
ARGS: {"mode":"levers","targetType":"Base","targetProp":"oeeIndex","topK":6}
{"data":{"levers":[],...,"count":0,...}}

=== PROD-6 RiskBoardView grain 路径 ===
ARGS: {"mode":"levers","grain":"process-model","targetType":"Base","targetProp":"weeklyCap","modelId":"常州","scopeObjectIds":["base_changzhou"],"factors":["设备OEE"],"topK":6}
{"data":{"levers":[],...,"count":0,...}}
```

### 2.2 排除"没数据"这个常见误判

数据是**齐的**，所以空不是因为对象缺失：

```
Base.derivedProperties = [{"propKey":"orderCount","formula":"COUNT(Order.so BY bases)"},
                          {"propKey":"committedQty","formula":"SUM(Order.qty BY bases)"},
                          {"propKey":"oeeIndex","formula":"AVG(Equipment.oee_current BY baseId)"}]
全本体 derivedProperties 总数 = 13 · 类型数 = 94
Equipment total = 780 · oee_current = 0.748266 (typeof number)
Base     total = 13  · oeeIndex     = 0.755451 …（13 个基地全部已算出真值）
```

⇒ **A4 的派生引擎（`ontology.ts`）确实跑过、确实算出了 `Base.oeeIndex`。**
但 `discoverLevers` 读的**不是**它。

---

## 3 · 真因 A：两套派生子系统互不相通，`discoverLevers` 站在空的那一边

仓里**并存两套派生实现**，各有各的**存储**和**语法**，**没有任何一处把前者编译进后者**：

| | **引擎①（种子在用）** | **引擎②（`discoverLevers` 在用）** |
|---|---|---|
| 声明落在 | `ObjectTypeDef.derivedProperties`（`domain.ts:270`） | `derivationSpecs` 表（`repo.ts:237`） |
| 播种写入 | ✅ `battery.ts:647-650` 等 13 条 → `ontology.ts:206` | ❌ **零**（见下） |
| 求值代码 | `ontology.ts:777-800`（`topoOrder`+`parseAggregate`+`evalArithmetic`） | `ontology-core.ts:340-360` `recompute()` |
| 语法 | `AVG(Equipment.oee_current BY baseId)`、`qty * unitPrice` | `AVG(out(L).prop)`、`this.qty * this.unitPrice`（`ontology-dsl.ts:352/379`） |
| 谁读它 | 对象 props 直接落值 | **`discoverLevers` `service.ts:714`** + `recompute` |

**`derivationSpecs` 的唯一写入方链路（追到底，不止一层）：**
```
repos.derivationSpecs.put(…)        ← 全仓唯一一处：ontology-core.ts:246
  ↖ compileSpecs()                  ← ontology-core.ts:219
      ↖ src 调用方：app.ts:2922      ← 仅此一个，HTTP: POST /a/v1/ontology/derivation-specs/compile
      ↖ 其余调用方：全部是 test（ontology-core.test.ts ×7、generic-inference-query.test.ts:31）
```

⇒ **除非有人手动 POST 那个端点，`derivationSpecs` 永远是空表。**
播种路径（`seed.ts` / `seed-cli.ts:33` / `synthetic/service.ts`）**一次都没调用 `compileSpecs`**。
这与仓储后端（memory / pg）**无关**——写入方在业务层，不在仓储层。

**于是 `service.ts:714-740` 的执行结果是：**
- `specs = []` → `specByNode` 空
- **无 `targetType/targetProp`**（调用方 #3、裸调）→ `roots = [...specByNode.keys()] = []` → 根本不 walk → `leaves` 空 → **空**
- **有 `targetType/targetProp`**（调用方 #1、#4）→ `roots=["Base.oeeIndex"]` → `walk` 在 `:722` 因 `!spec` 直接把**目标自己**当叶收下
  → 该叶 `+ε` 跑 `recompute`，而 `recompute` 读的也是这张空表 → `dryRunDeltas=[]` → `impact=0` → `sensitivity=0`
  → **`:770` `if (!best || best.sensitivity === 0) continue`** 丢弃 → **空**

**两条路殊途同归到空 —— 这正是"连不带 scope 都是空"的机理。**

### 3.1 真因 A′：就算想补，种子那套语法进不了这张表（实测）

```
① POST …/derivation-specs/compile  {"targetType":"Base","targetProp":"oeeIndex",
                                     "formula":"AVG(Equipment.oee_current BY baseId)"}   ← 种子原文
   → {"error":{"code":"VALIDATION_ERROR","message":"expected out(...) or in(...) navigation"}}

② …  {"targetType":"Order","targetProp":"value","formula":"qty * unitPrice"}             ← 种子原文
   → {"error":{"code":"VALIDATION_ERROR","message":"unexpected identifier \"qty\" in formula"}}

③ …  {"targetType":"Order","targetProp":"value","formula":"this.qty * this.unitPrice"}   ← 引擎②语法
   → 201 {"order":[{"typeKey":"Order","prop":"value"}],
          "specs":[{"specKey":"order_value","deps":[{"typeKey":"Order","prop":"qty"},
                                                    {"typeKey":"Order","prop":"unitPrice"}]}]}
```

⇒ 种子那 13 条 `derivedProperties` **一条都不能原样喂进 `compileSpecs`**：
`BY <字段>` 的聚合语法 vs `out(链接)/in(链接)` 的导航语法是**两套不兼容的 DSL**；
裸标识符 `qty` 也必须写成 `this.qty`。**这不是"忘了调一次编译"，是两套模型没对接。**

### 3.2 反证：一旦表里有货，机制立刻就活（同一进程、同一份数据）

装上 ③ 那一条 spec 后**立即**重打 `discoverLevers`：

```
ARGS: {"mode":"levers","targetType":"Order","targetProp":"value","topK":6}
{"data":{"levers":[
  {"objectType":"Order","objectId":"obj_order_SO-3445","prop":"qty",
   "currentValue":12098,"sensitivity":22022,"consumers":["Order.value"],
   "provenance":{"src":"generic_inference · recompute(dryRun,+ε)",
                 "formula":"∂(Order.value) / ∂(Order.qty)（ε=0.05）","inputs":["Order.value"]}},
  {"objectType":"Order","objectId":"obj_order_SO-3458","prop":"unitPrice",
   "currentValue":13916,"sensitivity":21777,"consumers":["Order.value"], …}],
  "count":2,"rootTypes":["Order"]},"snapshotVersion":"1.1"}

ARGS: {"mode":"levers"}   ← 裸调也活了（roots 不再为空）
{"data":{"levers":[…同上两根…],"count":2,"rootTypes":["Order"]}}
```

⇒ **反向 walk、±ε 敏感度探针、排序、provenance、R6 确定性 —— 全部是好的。**
唯一坏的是「这张表没人往里写」。**形态 ②「接了线没数据」实锤**，不是①没接线，也不是④调用方式不对。

---

## 4 · 真因 B（本单新发现·PRD 未预见）：`scopeObjectIds` 精确匹配 ontology objectId

`service.ts:751`：
```ts
.filter((o) => (scope ? scope.includes(o.id) : true) && typeof o.props[leaf.prop] === "number")
```
**`o.id` 是 ontology 对象 id，不是业务键。** 实测对比（同一进程、spec 已装）：

```
scope=["obj_order_SO-3445"]  （真 objectId）  → count=2 :: Order.qty@obj_order_SO-3445 | Order.unitPrice@obj_order_SO-3445
scope=["SO-3445"]            （业务键）      → count=0 ::
```

而 PRD §3.2 要传的 `ChainImpediment.locus.objectId` **就是业务键**。实测 demo 租户 `chain_impediments`（15 条）：

```
locus = {"objectType":"MaterialBatch","objectId":"elyte_b2","label":"elyte_b2"}
locus = {"objectType":"MaterialBalance","objectId":"mbal-6","label":"铜箔"}
```
对应的真 ontology id 是：
```
MaterialBatch   total=24 · ids = obj_materialbatch_al_foil_b0, obj_materialbatch_al_foil_b1, …
MaterialBalance total=9  · ids = obj_materialbalance_mbal-1, obj_materialbalance_mbal-2, …
```

⇒ `discoverLevers({scopeObjectIds:["elyte_b2"]})` **恒空，与真因 A 是否修好无关**。
同一个坑也扎在**生产调用方 #3/#4**：agentcore 传的是 `normalizeBaseId()` 的产物 `"changzhou"`（`ceo-route.ts:87-91`、
`seed.ts:715` 注释亦写明「有基地 → `["changzhou"]`」），而 Base 对象 id 是 `obj_base_changzhou` ⇒ **scope 永远滤空**。
（`RiskBoardView.tsx:880` 的注释「必须是真 objectId」说明前端这一侧**已经知道**这条规矩并做了 `baseObjectId()` 转换；
**agentcore 两处没有做**。）

> **对比佐证**：capacity 分支**做了**归一化 —— `service.ts:871` `normalizeBaseRef(r).replace(/^base-/,"")`
> 认 `obj_base_<id>` / `<id>` / 中文名三种写法。**通用分支没有这一层**，这是两分支的能力落差。

---

## 5 · 真因 C：capacity 分支的幽灵属性（`G-LEVER-PROP-PHANTOM` 又一实例）

PROD-6 空的原因**与 A 无关**（该分支不读 `derivationSpecs`）。矩阵实测：

```
grain=process-model, scope=[obj_base_changzhou], modelId=常州
  factors=["设备OEE"]  → count=0  （空）
  factors=["瓶颈工序"]  → count=0  （空）
  factors=["良率波动"]  → count=1  Process.yield_baseline@obj_process_LINE-WS-changzhou-pack-winding (sens=245278.02)
  无 factors           → count=6  Material.leadTime@obj_material_pos_lfp(-385119.39) |
                                   Process.utilization@…pack-winding(249156.435) |
                                   Process.yield_baseline@…(245278.02) |
                                   Equipment.ctSeconds@…-E1(-241032.825) |
                                   Process.attendance@…(240175.83) |
                                   Process.shifts@…(116605.365)
```

⇒ **capacity 分支本身是好的（6 根真杠杆、敏感度非零、scope 生效）**，只在 `factors` 过滤时塌。逐因子对账：

| `LEVER_FACTOR_PROPS` 因子（`service.ts:356-362`） | 映射到的属性 | 在 `CAPACITY_FACTOR_BINDINGS` 里？ | 结果 |
|---|---|---|---|
| **`设备OEE`** | `Equipment.oee_current` | ❌ **不存在**（表里是 `oeeA`③/`oeeP`④/`oeeQ`⑦/`ctSeconds`①） | **候选集空 → 恒空** |
| **`瓶颈工序`** | `Line.utilization` | ✅ 在（⑩ `capacity-factors.ts:62`） | 但 `sensitivity===0` → `service.ts:924` 诚实丢弃（`computeByProcessModel` 不读 `Line.utilization`；实测 Line 对象 `utilization=92.5496` **是** number，所以不是缺数据） |
| `良率波动` | `Process.yield_baseline` | ✅（⑥） | ✅ 出 1 根 |
| `物料齐套` | `MaterialBalance.coverage`❌ / `Material.onHand`✅⑬ / `Material.leadTime`✅⑮ / `Order.outsourceRatio`❌ | 部分 | 部分有效 |
| `人力工时` | `Process.attendance`✅⑰ / `Process.shifts`✅⑯ / `Process.shiftHours`❌ | 部分 | 部分有效 |
| `换型损失` | `ChangeoverMatrix.changeoverMin`✅⑤ / `Order.outsourceRatio`❌ | 部分 | 部分有效 |
| `物流时长` | `Shipment.etaDay`❌ / `Material.leadTime`✅⑮ | 部分 | 部分有效 |

**`设备OEE` 是唯一整组落空的因子** —— 而它恰恰是产能页最常见的主瓶颈之一
（`RiskBoardView.tsx:879` 把 `card.factor` 直接当 factors 传下去）⇒ **用户点开该基地卡，杠杆盘静默全空。**

**为什么不会被宽容兜底救回**：通用分支在 `service.ts:745` 有「映射全空 → 退化为不过滤」的兜底，
但 capacity 分支 `service.ts:851` **没有这一层**，`wantProps` 直接用；且此处 `设备OEE` 是**被识别的键**
（映射非空，只是映射到的属性不在绑定表里），即便有兜底也不会触发。

---

## 6 · 形态判定（对工单四表逐条落槌）

| 形态 | 判？ | 证据 |
|---|---|---|
| ① 没接线 | ❌ **否** | 4 处生产调用方（§1），非只有 test |
| ② **接了线没数据** | ✅ **是 —— 真因 A/A′ 属此**（也是主因） | `derivationSpecs` 唯一写入方 `ontology-core.ts:246` 无播种调用方；装一条 spec 后立刻非空（§3.2）。**加重项**：种子语法与该表 DSL 不兼容（§3.1 实测 400），补数据 ≠ 补一行 seed |
| ③ 接了线接错地方 | ✅ **是 —— 真因 B 属此** | `service.ts:751` 精确匹配 `o.id`，而生产（agentcore #3/#4）与 PRD §3.2 计划传的都是**业务键**；capacity 分支 `service.ts:871` 做了归一化、通用分支没做（§4） |
| ④ 调用方式不对 | ❌ **否** | 照 4 处生产实参逐条复刻 + 裸调 + 去 factors + 去 scope，**七打七空**（§2.1）。不是参数没传对 |

**另加真因 C**（capacity 分支）属 ②「接了线没数据」的**幽灵属性**子形态：声明的落点在绑定表里根本不存在。

---

## 7 · 最小可复现

```bash
# 1) 起服务（端口按空闲改；务必自证响应的是本份 dist）
cd <repo>
pnpm --filter @platform/contracts build && pnpm --filter @platform/llm-adapters build && pnpm --filter datacore build
PORT=4477 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-lv SEED_DEMO=1 \
  CREDENTIAL_KEY=$(printf '4%.0s' {1..64}) node apps/datacore/dist/server.js &
curl -s http://127.0.0.1:4477/readyz          # {"status":"ready"}

# 2) 登录取 accessToken
T=$(curl -s -X POST http://127.0.0.1:4477/a/v1/auth/login -H 'content-type: application/json' \
    -d '{"tenantId":"demo","username":"admin","password":"demo1234"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).accessToken))')

# 3) 复现「恒空」（生产实参·ProjectSimView）
curl -s -X POST http://127.0.0.1:4477/a/v1/solvers/generic_inference/invoke \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"args":{"mode":"levers","factors":["设备OEE"],"targetType":"Base","targetProp":"oeeIndex","topK":6}}'
#   → {"data":{"levers":[],...,"count":0,...}}

# 4) 反证真因 A：装一条 ontology-core 语法的 spec，同一进程立刻非空
curl -s -X POST http://127.0.0.1:4477/a/v1/ontology/derivation-specs/compile \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"specs":[{"specKey":"order_value","targetType":"Order","targetProp":"value","formula":"this.qty * this.unitPrice"}]}'
curl -s -X POST http://127.0.0.1:4477/a/v1/solvers/generic_inference/invoke \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"args":{"mode":"levers","targetType":"Order","targetProp":"value","topK":6}}'
#   → count=2（Order.qty sens=22022 / Order.unitPrice sens=21777）

# 5) 反证真因 B：同一条，换成业务键就空
curl -s -X POST http://127.0.0.1:4477/a/v1/solvers/generic_inference/invoke \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"args":{"mode":"levers","targetType":"Order","targetProp":"value","scopeObjectIds":["SO-3445"],"topK":6}}'
#   → count=0   （换成 "obj_order_SO-3445" → count=2）

# 6) 真因 C：capacity 分支按因子对账
curl -s -X POST http://127.0.0.1:4477/a/v1/solvers/generic_inference/invoke \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"args":{"mode":"levers","grain":"process-model","scopeObjectIds":["obj_base_changzhou"],"modelId":"常州","factors":["设备OEE"],"topK":6}}'
#   → count=0 ；去掉 factors → count=6
```

---

## 8 · Level-1 到底能不能继续做

### 🔴 **按 PRD `docs/PRD-sandbox-multiplan.md` §3.2 现在这个写法：不能。**

PRD §3.2 的第 1 步是
```
L = discoverLevers({ scopeObjectIds:[im.locus.objectId], factors: FACTORS_OF_KIND[im.kind], topK:K })
```
这一步**同时踩中 A 和 B 两个真因**，实测恒空 ⇒ 整个候选枚举器 `enumerateCandidates` 输出恒 `[]`，
Level-1 的 `candidates` 会 100% 走 `noCandidateReason` 分支。**PRD §8-2「未实测」那条风险已被本单坐实为红。**

### 卡在哪 / 要先补什么（按投入从小到大）

| 前置 | 内容 | 落点 | 备注 |
|---|---|---|---|
| **P1（必须）** | **scope 归一化**：通用分支照抄 capacity 分支的 `normalizeBaseRef` 思路，让 `scopeObjectIds` 同时认 `obj_<type>_<key>` / 裸业务键 / 名称 | `service.ts:751` 附近（+ 复用 `:871` 已有能力） | **最小、最确定的一步**；顺带修好 agentcore #3/#4 两处久悬的 scope 滤空 |
| **P2（必须·二选一）** | **让 `derivationSpecs` 在播种态非空**。<br>**选项 A**：写一个「`derivedProperties` → `ontology-core` DSL」的转译并在播种末尾调 `compileSpecs`（要跨 `BY 字段` → `out(链接)` 两套语义，**工作量不小，且 13 条里有几条未必可译**）。<br>**选项 B**：为 Level-1 真正需要的那几条链路**直接手写 `ontology-core` 语法的 spec** 并在播种时 `compileSpecs`（窄、快、可控）。 | `apps/datacore/src/seed.ts` / `synthetic/*`（**均在本单范围外**） | **这是 Level-1 的真正瓶颈**。建议**选项 B**：Level-1 只需要 `MATERIAL`/`CAPACITY` 两类阻滞点 locus 上的少数杠杆 |
| **P3（建议）** | `设备OEE → Equipment.oee_current` 幽灵落点：要么在 `CAPACITY_FACTOR_BINDINGS` 补 `oee_current` 绑定，要么把 `LEVER_FACTOR_PROPS.设备OEE` 改指 `oeeA/oeeP/oeeQ` | `service.ts:356` 或 `packages/contracts/src/capacity-factors.ts` | 不挡 Level-1，但挡产能页；**需一次口径裁决**（两处都是"单源"声明，改哪边要定） |
| **P4（建议）** | `瓶颈工序 → Line.utilization` 敏感度恒 0：要么把它从该因子映射里摘掉（诚实），要么让 capacity 链真读 `Line.utilization` | `service.ts:357` / `chain` 侧 | 现状是"诚实丢弃"，不算 bug，但用户看到的是空 |

### ✅ 能先做、不被上面卡住的

- **WO-MP-1（契约冻结）** 与本单结论**零依赖**，可立即开工。
- **WO-MP-5（`SimComparePanel` N 路）** 不经 `discoverLevers`，可并行。
- **WO-MP-2** 的**枚举器骨架 + `FACTORS_OF_KIND` 派生 + 全序比较器**可以先写，
  但**验收测试必须等 P1+P2 落地**，否则只能写出「恒空也绿」的假绿测试（正是本仓最痛的形态）。

> **给下一单的硬判据（防假绿）**：WO-MP-2 的 SEAM 测**不得**接受 `candidates:[]` 为通过。
> 必须断言「某个真实 `impedimentId` 上枚举出 ≥2 个**效果层互异**的候选」，
> 且做**变异反证**（改一根杠杆的种子值 → 候选的 KPI 真变）。
> 否则这条测试在 A/B 未修时**照样全绿**，而功能是塌的。

---

## 9 · 本体引用与影响

**触及对象类型**：`Base` · `Equipment` · `Line` · `Process` · `Order` · `Material` · `MaterialBatch` · `MaterialBalance` ·
`DerivationSpec`（`derivationSpecs` 表 / `domain.ts:421`）· `ObjectTypeDef.derivedProperties`（`domain.ts:270`）· `ChainImpediment`（`locus`）。

**触及链路**：
- `种子（battery.ts derivedProperties）→ ontology.ts 派生求值 → 对象 props` —— **通**（实测 `Base.oeeIndex` 有真值）
- `compileSpecs → derivationSpecs → ontology-core.recompute → discoverLevers` —— **断在第一跳**（播种零调用 `compileSpecs`）
- `ChainImpediment.locus.objectId → discoverLevers.scopeObjectIds → objects.listByType 过滤` —— **断在 id 口径**（业务键 vs ontology id）
- `LEVER_FACTOR_PROPS → CAPACITY_FACTOR_BINDINGS → computeByProcessModel ±ε` —— **`设备OEE` 一支断在幽灵属性**

**触及不变量**：
- **R6 确定性**：未破坏（两次同参调用逐字节一致；`discoverLevers` 无 Date/random）。
- **R13 溯源**：未破坏（非空时 `provenance.formula` 真实下发，见 §3.2 原文）。
- **R-ARG-FIDELITY**：**真因 B 是它的一个反例** —— `scopeObjectIds` 传了业务键时不是"报错/归一"，而是**静默滤空**，
  外观与"该作用域确实没有杠杆"不可分辨（诚实性缺陷，非静默返全域）。

**建议新登记的断点（我不动 `docs/SYSTEM-ONTOLOGY.md`，交审核方回写）**：

| 建议编号 | 一句话 | 位置 |
|---|---|---|
| **`G-DERIVATION-TWO-ENGINES`** | 派生有两套互不相通的实现与存储：种子只喂 `ObjectTypeDef.derivedProperties`（`ontology.ts` 求值），而 `recompute`/`discoverLevers` 读的 `derivationSpecs` 表**在播种态恒空**且**语法不兼容**，导致一切基于 `recompute` 的 what-if / 杠杆发现在 demo 上恒空 | `ontology-core.ts:246` · `app.ts:2922` · `ontology-dsl.ts:352` · `battery.ts:647-650` · `service.ts:714` |
| **`G-LEVER-SCOPE-IDKIND`** | `discoverLevers` 通用分支 `scopeObjectIds` 精确匹配 ontology `o.id`，而生产（agentcore ×2）与 PRD §3.2 计划传入的是**业务键**（`changzhou` / `elyte_b2`）→ 静默滤空；capacity 分支已有 `normalizeBaseRef` 归一，通用分支缺 | `service.ts:751`（缺）vs `service.ts:871`（有）· `ceo-route.ts:87` · `seed.ts:715` |
| **`G-LEVER-PROP-PHANTOM` 追加实例** | `LEVER_FACTOR_PROPS.设备OEE → Equipment.oee_current` 在 `CAPACITY_FACTOR_BINDINGS` 中不存在 → 产能页按该因子过滤时候选集恒空 | `service.ts:356` vs `capacity-factors.ts:50-74` |

---

## 10 · 我**没有**核实的（明说，不装作核过）

1. **没跑 pg 模式**。结论「播种不写 `derivationSpecs`」是从**写入方唯一性**推出的（写入方在业务层 `ontology-core.ts:246`，
   与 memory/pg 仓储实现无关），**逻辑上对 pg 同样成立，但我没有在 pg 上实跑验证**。
2. **没有实跑前端页面**。#1/#2 两个前端调用方的实参是**读代码**得到的（`ProjectSimView.tsx:877` / `RiskBoardView.tsx:876`），
   我用 curl 复刻了这些实参，但**没有在浏览器里点开 ProjectSim / 产能页**确认真实发出的请求体逐字一致
   （`factors` 的实际内容随 `out.mainBn` 变，我取的是代表值 `设备OEE`）。
3. **没有实跑 agentcore**。#3/#4 两个调用方我只读了代码并复刻实参打 datacore，**没有起 agentcore 走 `/b/v1` 全链**。
   因此「agentcore 侧 scope 恒滤空」是**代码推断 + datacore 侧等价复现**，不是端到端实测。
4. **没有逐条判定那 13 条 `derivedProperties` 是否都可译成 `ontology-core` DSL**（§8 P2 选项 A 的可行性未评估）。
   我只实测了其中 2 条**不可原样通过**。
5. **没有核实 `Level-1` 其余 5/6 个零件**的真实状态 —— PRD §2.2 的判定我沿用未复验（本单范围只到 `discoverLevers`）。
6. **没有核实 `chain_impediments` 的 15 条产出是否稳定/是否受 entitlement 影响**；我用默认 `args:{}` 打通了，
   但未验证 `sim.sandbox` 等开关关闭时前端能否走到这一步。
7. **未改任何代码**（见 §11），因此**没有回归测试**可言。

---

## 11 · 代码改动

**无。** 本单以取证为主；查明的三条真因，修法均落在**本单范围边界之外**：
- 真因 A/A′ 的修点在 `seed.ts` / `synthetic/*`（范围外）；
- 真因 B 的修点在 `service.ts:751`（范围内）**但**需与 capacity 分支的 `normalizeBaseRef` 统一口径、
  且会改变 4 处生产调用方的行为，属**接线决策**而非"明确的小 bug"，按工单纪律交审核方裁决后单独立单；
- 真因 C 需在 `service.ts:356` 与 `capacity-factors.ts` 之间**二选一裁决**（两处都自称单源）。

按工单「不扩范围」「改动越小越好」「不要顺手做 Level-1」，本单只交证据与判定。
