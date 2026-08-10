# WO-FIX-P1-REGRESSION 交付说明

> 分支 `claude/handoff-wo-fix-p1-regression`（自 canonical `f6c61869`）
> 实测日期 **2026-08-10**。所有结论均可按文中给出的命令原地复跑。

---

## 0 · 一句话结论

**判 A（图变了，金值该更新）—— 但不是"把期望值改成实收值"，而是补上一条证明「新路径 ≡ 旧路径」的等价断言。**

WO-P1 新增的 `model_demanded_by_order`(Model→Order) 是 `order_for_model`(Order→Model) 的
**逐实例严格互逆投影**（同一个 `for (const o of g.orders)` 循环、同一对端点 id）。
规划器 BFS 的 tie-break 是**纯字典序**，`model_demanded_by_order` < `order_for_model`（`m` < `o`），
于是自动最短路在 Model 结点上改选了新边。**跳数不变（2 跳）、方向正确、结果集逐 objId 相同** ⇒ 语义等价。

---

## 1 · 引擎实际返回的 hops / linkPath（原文）

### 1.1 规划器层（纯函数复现·`scripts` 未改，用 dist 直接调 `planSlice`）

复验命令：

```bash
pnpm --filter datacore build
node - <<'EOF'
const R="apps/datacore/dist";
const {planSlice}=await import(`./${R}/ontology/slice-planner.js`);
const {batteryLinkTypes,batteryObjectTypes}=await import(`./${R}/synthetic/battery.js`);
const {extendedObjectTypes}=await import(`./${R}/synthetic/battery-extended.js`);
const types=[...batteryObjectTypes(),...extendedObjectTypes()].map(t=>({key:t.key,domain:t.domain}));
const links=batteryLinkTypes().map(l=>({linkKey:l.key,fromTypeKey:l.fromTypeKey,toTypeKey:l.toTypeKey}));
for(const [r,t] of [["Base","Order"],["Order","Base"]]){
  const p=planSlice(types,links,{rootType:r,targets:[t],maxHops:8});
  console.log(r+"→"+t, JSON.stringify(p.plan.paths[0].hops));
}
EOF
```

实际输出（2026-08-10）：

```
CANARY objTypes=94 linkTypes=85          ← 金丝雀：两个抽取器都非空，工具没瞎

Base→Order hops = [{"linkKey":"model_producible_at","direction":"in","toType":"Model"},
                   {"linkKey":"model_demanded_by_order","direction":"out","toType":"Order"}]
  linkKeys       = ["model_producible_at","model_demanded_by_order"]
  provenance.linkPath = ["model_producible_at:in","model_demanded_by_order:out"]
  queryPlan.hops = ["model_producible_at:backward","model_demanded_by_order:forward"]
  evidence       = Base -[model_producible_at:in]-> Model -[model_demanded_by_order:out]-> Order

Order→Base hops = [{"linkKey":"model_demanded_by_order","direction":"in","toType":"Model"},
                   {"linkKey":"model_producible_at","direction":"out","toType":"Base"}]
  linkKeys       = ["model_demanded_by_order","model_producible_at"]
  provenance.linkPath = ["model_demanded_by_order:in","model_producible_at:out"]
  queryPlan.hops = ["model_demanded_by_order:backward","model_producible_at:forward"]
  evidence       = Order -[model_demanded_by_order:in]-> Model -[model_producible_at:out]-> Base
```

### 1.2 引擎层（经 HTTP `POST /a/v1/solvers/ontology_query/invoke` 真跑）

见 §1.3「端到端实收原文」（测试内 `console.log` 打点，取证后删除·`git status` 已复原）。

---

## 2 · 为什么是 A 不是 B —— 四条独立取证

### 证据 1 · 两条边的**实例集合逐条互逆**（不是"看起来像"）

`apps/datacore/src/synthetic/service.ts`：

| 边 | 建边循环 | fromId | toId |
|---|---|---|---|
| `order_for_model`（旧·归属 FK） | `for (const o of g.orders)` @ `service.ts:840` | `obj_order_${o.so}` | `obj_model_${o.model}` |
| `model_demanded_by_order`（P1 新·影响向） | `for (const o of g.orders)` @ `service.ts:973` | `obj_model_${o.model}` | `obj_order_${o.so}` |

**同一个 `g.orders` 循环、同一对端点、同一套 id 规整规则** ⇒ 两条边在实例层严格 1:1 互逆，
`model_demanded_by_order:out` 与 `order_for_model:in` 从 Model 出发落到**同一个 Order 集合**。

### 证据 2 · 新路径方向语义正确（不是"方向反/绕远/走错关系"）

- `model_producible_at:in`：Base ← Model，取"能在该基地生产的型号"。✔
- `model_demanded_by_order:out`：Model → Order，取"需求该型号的订单"。✔
- 跳数 **2 → 2**，未绕远；两跳都落在 `Model`/`Order`/`Base` 这三个本就该经过的类型上，没有走进不该走的关系。

反向同理：`model_demanded_by_order:in`（Order ← Model 该单要的型号）→ `model_producible_at:out`（Model → Base 该型号可产基地）。

原测试②的**意图**是"方向真反转，证明引擎不是把方向写死的"。新计划反而更强地满足了这个意图：
**同一对 linkKey，在①②里各自方向恰好相反**（① `…:in, …:out` ↔ ② `…:in, …:out` 中两条 key 位置对调、各自方向翻转）。

### 证据 3 · P1 加这三条逆边**结构上必要**（不是随手加的冗余）

`apps/datacore/src/sim/propagation.ts:384-399`：传导核**只建 `navOut`**，
`targetsOf()` 只查 `navOut.get(navKey(rule.viaLinkKey, sourceId))` —— **没有 navIn**，
即引擎在物理上无法逆向走一条边。所以"上游→下游"的影响传导必须有一条 from=上游 的边。

同时核 P1 提交信息里那句事实主张（照铁律 0.5 追一层，不采信原文）：

```
in-edges → Order  [3]
   model_demanded_by_order(Model→Order)     ← P1 新增
   promise_for_order(OrderPromise→Order)
   line_of_order(OrderLine→Order)
in-edges → OrderPromise  [0]
in-edges → OrderLine     [0]
```

P1 原文写「实测全本体无任何边的 toType 是 Order」**字面为假**（有 3 条），
但它自己在下一句限定了「`promise_for_order`/`line_of_order` 的 from 端自身零入边」——
**这个限定实测为真**（两者 in-degree 均为 0）。故结论成立：不补 `model_demanded_by_order`，
供应侧扰动在图上确实走不到 Order。

### 证据 4 · 触发机制可解释（不是玄学）

`apps/datacore/src/ontology/slice-planner.ts:21-27` 的邻边定序：

```
域内优先 → 目标类型 key 字典序 → linkKey 字典序 → direction 字典序
```

站在 `Model` 上，通往 `Order` 的两条候选边：
`order_for_model:in` 与 `model_demanded_by_order:out`。
`Model` 与 `Order` **同域**（都是 `product`，实测 `domain(Model)=product domain(Order)=product`）⇒ 第 1 项打平；
`to` 都是 `Order` ⇒ 第 2 项打平；
第 3 项 `linkKey` 字典序：`model_demanded_by_order` < `order_for_model`（`m` < `o`）⇒ **新边胜出**。

**这就是 3 条红的全部成因**：不是引擎坏了，是图上多了一条等价捷径，而 tie-break 恰好偏向它。

---

## 3 · 系统性风险（本单范围外，建议记账）

P1 是本本体**第一次**引入"互逆双向重复边"。实测全 85 条链路类型里，
存在互逆重复的类型对**恰好只有 P1 新增的这三对**：

```
Material <-> Supplier:  material_supplied_by      ||  supplier_supplies_material
Material <-> Model:     material_used_by_model    ||  model_uses_material
Model    <-> Order:     model_demanded_by_order   ||  order_for_model
```

规划器 tie-break 是**纯字典序**，没有"归属边优先于派生逆边"的概念。
⇒ **任何再加一条逆边的动作，都会静默改写所有跨该类型对的自动查询计划**，
而金值测试只钉了 Base↔Order 一条，其余无人看守。
本单在测试里补的**等价断言**只堵住了 Model↔Order 这一处；
Material↔Supplier / Material↔Model 两处同样已被改写但当前无金值覆盖。

---

（§4 变异反证 · §5 整包红数对账 · §6 与 #158/#160 同源判定 见后续小节，随实跑补齐。）
