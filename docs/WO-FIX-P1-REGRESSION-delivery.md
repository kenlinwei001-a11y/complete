# WO-FIX-P1-REGRESSION 交付说明

> 分支 `claude/handoff-wo-fix-p1-regression`（自 canonical `f6c61869`）
> 实测日期 **2026-08-10**。所有结论均可按文中给出的命令原地复跑。
> 范围边界遵守情况：只改了 `apps/datacore/test/` 两个测试文件 + 本文档。
> **`apps/datacore/src/` 一行未改**（诊断用的临时改动已全部回滚，`git status --porcelain` 空）。

---

## 0 · 一句话结论

**判 A（图变了，金值该更新）—— 但不是"把期望值改成实收值"，而是补上一条证明「新路径 ≡ 旧路径」的等价断言。**

WO-P1 新增的 `model_demanded_by_order`(Model→Order) 是 `order_for_model`(Order→Model) 的
**逐实例严格互逆投影**（同一个 `for (const o of g.orders)` 循环、同一对端点 id）。
规划器 BFS 的 tie-break 是**纯字典序**，`model_demanded_by_order` < `order_for_model`（`m` < `o`），
于是自动最短路在 Model 结点上改选了新边。**跳数不变（2 跳）、方向正确、结果集逐 objId 相同** ⇒ 语义等价。

---

## 1 · 引擎实际返回的 hops / linkPath（原文·未改写）

### 1.1 引擎层（经 HTTP `POST /a/v1/solvers/{ontology_query,generic_inference}/invoke` 真跑）

在**未改测试**的 canonical 状态下跑那两个测试文件，vitest 打出的 `Received` 就是引擎实收值：

```
FAIL test/ontology-query-engine.test.ts > ① 前向跨类型遍历（Base→Order 自动最短路）
AssertionError: expected [ 'model_producible_at', …(1) ] to deeply equal [ 'model_producible_at', …(1) ]
- Expected
+ Received
  [
    "model_producible_at",
-   "order_for_model",
+   "model_demanded_by_order",
  ]
 ❯ test/ontology-query-engine.test.ts:26:54

FAIL test/ontology-query-engine.test.ts > ② 反向遍历（Order→Base）方向真反转
AssertionError: expected [ …(2) ] to deeply equal [ 'order_for_model:forward', …(1) ]
- Expected
+ Received
  [
-   "order_for_model:forward",
+   "model_demanded_by_order:backward",
    "model_producible_at:forward",
  ]
 ❯ test/ontology-query-engine.test.ts:46:74

FAIL test/generic-inference-query.test.ts > apply 空 + rootType/select → fallback 到 Query Engine
AssertionError: expected [ 'model_producible_at', …(1) ] to deeply equal [ 'model_producible_at', …(1) ]
- Expected
+ Received
  [
    "model_producible_at",
-   "order_for_model",
+   "model_demanded_by_order",
  ]
 ❯ test/generic-inference-query.test.ts:22:54
```

复验命令（把两个测试文件退回 canonical 版再跑）：

```bash
git checkout f6c61869 -- apps/datacore/test/ontology-query-engine.test.ts \
                          apps/datacore/test/generic-inference-query.test.ts
cd apps/datacore && npx vitest run test/ontology-query-engine.test.ts test/generic-inference-query.test.ts
# → Tests 3 failed | 7 passed (10)
```

### 1.2 规划器层（纯函数复现·与引擎层逐字对上）

```bash
pnpm --filter datacore build
node - <<'EOF'
const R="apps/datacore/dist";
const {planSlice}=await import(`./${R}/ontology/slice-planner.js`);
const {batteryLinkTypes,batteryObjectTypes}=await import(`./${R}/synthetic/battery.js`);
const {extendedObjectTypes}=await import(`./${R}/synthetic/battery-extended.js`);
const types=[...batteryObjectTypes(),...extendedObjectTypes()].map(t=>({key:t.key,domain:t.domain}));
const links=batteryLinkTypes().map(l=>({linkKey:l.key,fromTypeKey:l.fromTypeKey,toTypeKey:l.toTypeKey}));
for(const [r,t] of [["Base","Order"],["Order","Base"]])
  console.log(r+"→"+t, JSON.stringify(planSlice(types,links,{rootType:r,targets:[t],maxHops:8}).plan.paths[0].hops));
EOF
```

实收：

```
CANARY objTypes=94 linkTypes=85          ← 金丝雀：两个抽取器都非空，工具没瞎

Base→Order  provenance.linkPath = ["model_producible_at:in","model_demanded_by_order:out"]
            queryPlan.hops      = ["model_producible_at:backward","model_demanded_by_order:forward"]
            evidence = Base -[model_producible_at:in]-> Model -[model_demanded_by_order:out]-> Order

Order→Base  provenance.linkPath = ["model_demanded_by_order:in","model_producible_at:out"]
            queryPlan.hops      = ["model_demanded_by_order:backward","model_producible_at:forward"]
            evidence = Order -[model_demanded_by_order:in]-> Model -[model_producible_at:out]-> Base
```

---

## 2 · 为什么是 A 不是 B —— 四条独立取证

### 证据 1 · 两条边的**实例集合逐条互逆**（不是"看起来像"）

`apps/datacore/src/synthetic/service.ts`：

| 边 | 建边循环 | fromId | toId |
|---|---|---|---|
| `order_for_model`（旧·归属 FK） | `for (const o of g.orders)` @ `service.ts:841` | `obj_order_${o.so}` | `obj_model_${o.model}` |
| `model_demanded_by_order`（P1 新·影响向） | `for (const o of g.orders)` @ `service.ts:973` | `obj_model_${o.model}` | `obj_order_${o.so}` |

**同一个 `g.orders` 循环、同一对端点、同一套 id 规整规则** ⇒ 两条边在实例层严格 1:1 互逆，
`model_demanded_by_order:out` 与 `order_for_model:in` 从 Model 出发落到**同一个 Order 集合**。
这不是靠读代码断言的——§4 的变异反证把这条互逆性**真掰断了一次**，等价断言当场变红（见下）。

### 证据 2 · 新路径方向语义正确（不是"方向反 / 绕远 / 走了不该走的关系"）

- `model_producible_at:in`：Base ← Model，取"能在该基地生产的型号"。✔
- `model_demanded_by_order:out`：Model → Order，取"需求该型号的订单"。✔
- 跳数 **2 → 2**（未绕远）；两跳都落在 Model/Order/Base 这三个本就该经过的类型上。

反向同理：`model_demanded_by_order:in`（Order ← Model 该单要的型号）→ `model_producible_at:out`（Model → Base 该型号可产基地）。

原测试②的**意图**是"方向真反转，证明引擎没把方向写死"。新计划反而更强地满足这个意图：
**同一对 linkKey，在①②里位置对调且各自方向恰好翻转**。本单把这个意图写成了机械判据（见 §3）。

### 证据 3 · P1 加这三条逆边**结构上必要**（不是随手加的冗余）

`apps/datacore/src/sim/propagation.ts:384-399`：传导核**只建 `navOut`**，
`targetsOf()` 只查 `navOut.get(navKey(rule.viaLinkKey, sourceId))` —— **没有 navIn**，
引擎在物理上无法逆向走一条边。所以"上游→下游"的影响传导必须有一条 `from=上游` 的边；
`seed.ts:350` 的 `demo_model_supply_risk_to_order_shortage` 正是靠 `model_demanded_by_order` 才走得到 Order。
⇒ **删掉这条边会打断 P1 交付的供应链传导，不能作为"修法 B"。**

照铁律 0.5 追一层核 P1 提交信息里的事实主张（不采信原文）：

```
in-edges → Order  [3]
   model_demanded_by_order(Model→Order)     ← P1 新增
   promise_for_order(OrderPromise→Order)
   line_of_order(OrderLine→Order)
in-edges → OrderPromise  [0]
in-edges → OrderLine     [0]
```

P1 原文「实测全本体无任何边的 toType 是 Order」**字面为假**（实有 3 条），
但它自己下一句的限定「`promise_for_order`/`line_of_order` 的 from 端自身零入边」**实测为真**
（两者 in-degree 均为 0）⇒ 结论仍成立。**记这一笔是因为原文的第一句会误导后来人。**

### 证据 4 · 触发机制可解释（不是玄学）

`apps/datacore/src/ontology/slice-planner.ts:21-27` 的邻边定序：

```
域内优先 → 目标类型 key 字典序 → linkKey 字典序 → direction 字典序
```

站在 `Model` 上通往 `Order` 的两条候选边 `order_for_model:in` / `model_demanded_by_order:out`：
Model 与 Order **同域**（实测均为 `product`）⇒ 第 1 项打平；`to` 都是 `Order` ⇒ 第 2 项打平；
第 3 项比 linkKey：`model_demanded_by_order` < `order_for_model`（`m` < `o`）⇒ **新边胜出**。

**这就是三条红的全部成因**：不是引擎坏了，是图上多了一条等价捷径，tie-break 恰好偏向它。

---

## 3 · 改了什么（两个测试文件·`src` 零改动）

1. **金值更新**：三处 `order_for_model` → `model_demanded_by_order`（含 `linkPath` 的 `:in`/`:out`），
   并在 `ontology-query-engine.test.ts` 顶部写了完整成因注释（含实测日期 2026-08-10 + 复验命令）。
2. **等价断言（防「改金值洗白」的主锁）**：三条测试各追加
   「自动最短路的 `provenance.objId` 集合 + `rows` 必须与**显式走旧边 `order_for_model`** 的一致」。
   附**金丝雀**：先断言对照组非空（否则"空集 == 空集"会让断言变成装饰品）。
3. **「方向真反转」的机械判据**（②）：把 Base→Order 的计划整条倒过来、每跳方向逐个取反，
   必须恰好等于 Order→Base 的计划。
   这条与「用哪条边」**无关**——P1 之前（`order_for_model`）与之后（`model_demanded_by_order`）都成立，
   才是①②这对测试原本要咬的东西；把它写成机械判据后，以后换边不会再误伤这条意图。

---

## 4 · 变异反证（红/绿两次·两个方向都做了）

### 4.1 回退修复 → 必须红 ✅

| 状态 | 命令 | 结果 |
|---|---|---|
| 退回 canonical 版测试文件 | `npx vitest run test/ontology-query-engine.test.ts test/generic-inference-query.test.ts` | **Tests 3 failed \| 7 passed (10)**（RC=1） |
| 本单修复 | 同上 | **Tests 10 passed (10)**（RC=0） |

三条红逐条对上 WO 点名的三条，一条不多一条不少。

### 4.2 反向变异：把「互逆性」真掰断 → 新增的等价断言必须红 ✅（这条才是防洗白的证明）

只改一行**生产种子**（`service.ts:973`，让影响向逆边只投影一半订单）：

```diff
-    for (const o of g.orders) {
+    for (const o of g.orders.filter((_, i) => i % 2 === 0)) {
       await putLink(`lnk_mdbo_${o.so}`, "model_demanded_by_order", oid("Model", o.model), oid("Order", o.so));
```

实收：

```
Tests  3 failed | 7 passed (10)
AssertionError: expected [ 'obj_order_SO-3391', …(7) ] to deeply equal [ 'obj_order_SO-3391', …(11) ]
 ❯ test/ontology-query-engine.test.ts:70:55      ← 本单新增的等价断言
 ❯ test/generic-inference-query.test.ts:42:55    ← 本单新增的等价断言
 ❯ test/ontology-query-engine.test.ts:129:28     ← 既有③附带咬到
```

**关键在于这次变异下，被我更新的那几行金值断言（`hops`/`linkPath`）全程是绿的**——
路径没变，变的是结果集。即：
> **光钉 hops 的金值，抓不住"边加错了/投影漏了"这一类真错；抓住它的是本单新增的等价断言。**
> 这就是"更新金值"没有把回归洗白的证据。

变异已回滚，`git status --porcelain` 为空（见 §7）。

---

## 5 · datacore 整包红数对账

| 状态 | commit | Test Files | Tests |
|---|---|---|---|
| **基线**（canonical，未改任何东西） | `f6c61869` | 2 failed \| 238 passed \| 2 skipped | **3 failed** \| 1424 passed \| 16 skipped |
| **修后**（本单交付态） | `64cbaa56` | **240 passed \| 2 skipped (242)** | **0 failed** \| **1427 passed** \| 16 skipped (1443) |

⇒ **修好 3 条，零新增红**。1424 + 3 = 1427，通过数逐条对上，没有测试被删或被跳过换绿。

### 5.1 ⚠️ 基线口径说明 —— 我自己犯了一次「gate 跑着时改工作目录」，据实记账

第一次整包基线跑的是 `pnpm --filter datacore test`（全量 1443 条，耗时 1425s）。
**我在它跑到一半时改了那两个测试文件**，而 `generic-inference-query.test.ts` 还没轮到执行——
于是它读到的是**我改后的版本**并报绿。那一跑的汇总 `Tests 2 failed | 1425 passed | 16 skipped (1443)`
里，"2 failed" 是**被污染的数字**：它少算了 `generic-inference-query.test.ts` 那一条。

这正是 CLAUDE.md 里「起 gate 前先记 HEAD，gate 完确认 `git status` 为空且 HEAD 未变」那条铁律
警告的形态——**信号本身是真的，只是它不指向我要断言的那个对象**。我踩了，记在这里。

**订正后的真基线 = 3 failed**：
- 未受污染的部分（除那两个文件外的 240 个测试文件）在那一跑里**全绿**，可直接采信；
- 那两个文件的基线用干净的定向跑单独测得：**3 failed | 7 passed (10)**（§4.1 第一行）。
- 两者相加 ⇒ canonical 整包基线红数 = **3**，且**全部**是 WO 点名的这三条，无其它历史红。

### 5.2 修后整包实收（原文）

```
$ pnpm --filter datacore test          # 在 64cbaa56，工作树全干净
 ✓ test/generic-inference-query.test.ts (3 tests) 15851ms
 ✓ test/ontology-query-engine.test.ts (7 tests) 35197ms
 …
 Test Files  240 passed | 2 skipped (242)
      Tests  1427 passed | 16 skipped (1443)
   Duration  1955.13s
FINAL_RC=0
```

**零 `×`、零 `failed`**（`grep -nE "^ *× |failed\)"` 在整份日志上零命中；
金丝雀：同一把 grep 在基线日志上命中 3 行 ⇒ 工具是好的，这个 0 是真的 0）。

---

## 6 · 与 #158 / #160 是否同源 —— **不同源**（形态不同，修法也不同）

照 CLAUDE.md 铁律 0.6 的判据（把两次错各写成「我用 X 当作 Y 的证据，而 X 并不度量 Y」，比结构）：

| | 形态 | 判据现场 | 修法 |
|---|---|---|---|
| **#158** | **声明的方向与本体单源相反 ⇒ 规则恒不触发**（"接了线接错方向"） | `demo_line_util_to_base_load` 声明 `Line--line_belongs_to_base-->Base`，而本体声明是 `Base→Line`（`battery.ts:2321`）；`propagateTick` 只走 `fromId→toId` ⇒ 恒取不到 target | 改规则方向（P1 已做） |
| **#160** | **同一形态的前端副本**：`apps/frontend-shell/src/mocks/handlers.ts:1404` 写 `{ key:"line_belongs_to_base", fromType:"Line", toType:"Base" }`，与本体 `Base→Line` 相反 | 前端 mock 与本体单源打架 | 改 mock 方向（本单范围外·未动） |
| **本单三条红** | **图上多了一条语义等价的捷径边，改写了自动最短路的 tie-break**（不是方向错，方向是对的） | `slice-planner.ts:21-27` 纯字典序 | 更新金值 + 补等价断言 |

**#158 与 #160 彼此同源**（同一句：「我用『某 linkKey 的名字读起来像 A→B』当作『它在本体里就是 A→B』的证据」）——
**建议把 #160 与 #158 合并成一条账，用同一道门收口**（见 §8 建议）。
**本单这三条与它们不同源**：这里没有任何一条边的方向是错的，错的是"没人预料到等价捷径会改写既有计划"。

---

## 7 · 交付守卫检查

| 检查 | 命令 | 结果 |
|---|---|---|
| 整包跑期间工作树未被动过 | `git status --porcelain`（跑完立即） | **空** ✅ |
| 整包跑期间 HEAD 未变 | `git rev-parse HEAD` | `64cbaa56`，与起跑时一致 ✅ |
| `src` 零改动 | `git diff f6c61869..HEAD -- apps/datacore/src` | **空** ✅ |
| 改动面 | `git diff --stat f6c61869..HEAD` | 2 个测试文件 + 1 份交付文档 ✅ |
| 诊断临时改动已回滚 | 变异反证用的 `service.ts` 一行改动 | 已 `git checkout HEAD --` 复原 ✅ |
| 远端已落盘 | `git ls-remote origin claude/handoff-wo-fix-p1-regression` | 见文末 ✅ |

### 7.1 关于「整包跑的 commit」与「最终交付 commit」的差一位，据实交底

整包全绿那一跑跑在 `64cbaa56`。此后我只追加了**一处注释行号订正**（`service.ts:840` → `:841`，
因为 `order_for_model` 的循环实际起于第 841 行）。该 diff `1 file changed, 1 insertion(+), 1 deletion(-)`，
**整条 diff 落在 `//` 注释行内**（`git diff` 原文见提交记录），不可能改变行为；
并且**在订正后重跑了那两个测试文件确认仍 10 绿**：

```
$ npx vitest run test/ontology-query-engine.test.ts test/generic-inference-query.test.ts
 Test Files  2 passed (2)
      Tests  10 passed (10)          RC=0
```

写下这一段是因为本仓的判据是「**gate 证明的必须是我要并线的那个 commit**」——
差一位就得说清楚差在哪、为什么不影响，而不是默默让读者以为是同一个。

---

## 8 · 范围外发现（本单不许碰，据实上报·全部附复验锚点）

### 8.1 🔴 P1 的真实爆炸半径：**2162 / 8742 条类型对最短路被改写**，而只有 3 条有金值看守

用同一份 types，links 分别取「含 P1 三条新边」与「剔除这三条」，对全部 94×93 个类型对求最短路做差集：

```
CANARY links_all=85 links_without=82 diff=3     ← 金丝雀：剔除数正好 3，key 名对上了
  路径未变      : 6580
  路径被改写    : 2162          ← 占 24.7%
  由不可达变可达: 0
```

样例（每一条都是"某边 ↔ 它的互逆边"之间的字典序换位，语义等价）：

```
Base→Material    P1前: model_producible_at:in → model_uses_material:out
                 P1后: model_producible_at:in → material_used_by_model:in
Base→Supplier    P1前: … → model_uses_material:out → material_supplied_by:out
                 P1后: … → material_used_by_model:in → material_supplied_by:out
Base→PlanTarget  P1前: … → order_for_model:in → order_to_plantarget:out
                 P1后: … → model_demanded_by_order:out → order_to_plantarget:out
```

**⚠️ 这里有个容易读反的地方，先钉死**：上面 `由不可达变可达 = 0` 说的是 **`planSlice` 的可达性**——
`planSlice` 建的是**无向**邻接（每条 link 同时产 out 边和 in 边，`slice-planner.ts:17-18`），
所以对查询规划器而言方向从来不是障碍。
而 P1 补逆边是为了 **`propagateTick` 的有向可达性**（只有 `navOut`）。
**两者是两个不同的"可达"，不能用前者的 0 去否定后者的必要性**——否则就是"用 X 度量 Y"的老病。

**结论**：P1 的边该留；但它在**查询规划器**这一侧造成了一次 24.7% 的静默改写，
本单只补上了 Model↔Order 这一处的等价看守，其余 ~2159 条无人看守。

### 8.2 🔴 AgentCore mock 已与真引擎脱节（假绿·本单不许碰 `apps/agentcore/**`）

- `apps/agentcore/src/mocks/clients.ts:456`
  `const linkPath = rootType === sel.type ? [] : ["model_producible_at:in", "order_for_model:in"];`
- `apps/agentcore/test/navigation-ontology-query.test.ts:43`
  `expect(prov.linkPath).toEqual(["model_producible_at:in", "order_for_model:in"]);`

真 DataCore 引擎现在返回的是 `["model_producible_at:in", "model_demanded_by_order:out"]`。
该测试**咬的是 agentcore 自己的 mock，不是真引擎**，所以它现在是绿的、而且会一直绿——
典型的「绿测试 ≠ 能用」。建议单独派单同步 mock，并考虑给这条加一道跨系统一致性门。

### 8.3 🟡 契约注释示例过期（本单不许碰 `packages/contracts/**`）

`packages/contracts/src/ontology-query.ts:87`
`linkPath: z.array(z.string()), // ["model_producible_at:in", "order_for_model:in"]`
注释里的示例已不是引擎实际产出。只是注释，不影响行为，但会误导读者。

### 8.4 🟡 P1 未回写本体（违反铁律 0·本单不许碰 `docs/SYSTEM-ONTOLOGY.md`）

`docs/SYSTEM-ONTOLOGY.md` 对 P1 新增的三条链路类型
（`model_demanded_by_order` / `supplier_supplies_material` / `material_used_by_model`）**零处提及**。

> 金丝雀（照铁律 0.6，报否定结论必须自证工具）：
> 同一把 grep 在同一个文件里搜 `order_for_model` 命中 **2 处** ⇒ 工具是好的，"0 命中"是真的 0。

铁律 0 要求「新增链路 → 必须回写 SYSTEM-ONTOLOGY.md 对应章节」，P1 漏了。

### 8.5 🟢 建议（不在本单范围内，供排期参考）

1. **给规划器 tie-break 一个"归属边优先于派生逆边"的显式规则**，或给逆边打 `derivedInverseOf` 标记，
   让自动最短路稳定选归属边。这样再加逆边就不会静默改写既有计划。
   （代价：要动 `slice-planner.ts`，会一次性改回 2162 条路径，需配套金值盘点——故不该塞进本单。）
2. **把 #160 与 #158 合并**，加一道机械门：扫所有声明了 `fromType/toType` 的地方
   （前端 mock / 传导规则 / 切片 spec），与 `batteryLinkTypes()` 的单源声明对账，方向不符即红。
   这正好是铁律 0.6「第 2 次必须建机制」的落点——#158 和 #160 已经是同一个错的第二次了。
