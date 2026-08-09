# WO-SIM-SCOPE-TRIAL 交付说明（沙盘 P3 + L3-a 合单）

> 分支 `claude/handoff-wo-sim-scope-trial`。开工时按**祖先关系**判定（不是文件存在性）：
> 原 HEAD 是 canonical 的祖先 ⇒ 落后 ⇒ 从 canonical `69804185` 重开。
> 交付前 canonical 已前移到 `431d9249`（新增 2 提交，**与本单 6 个文件零重叠**），
> 已 rebase 其上并**重跑 build + 门 + 测试**（rebase 会作废之前的绿，故重验）。
> 关闭欠账 **#129 / #130（`G-SIM-SCOPE-UNREAD`）** 与 **#152**。

---

## 1. 一句话

沙盘的「局部推演」此前在引擎层**根本不存在**（`SimSession.scope` 有写端无读端，tick 无条件跑全本体），
认证屏的「Trial Tick」跑的又是**另一套栈**（`recompute` 派生栈，传导栈恒记 0）。
本单给 `scope` 接上真读端（在**图物化那一步**裁剪），并让 Trial Tick 真跑传导栈、按**效果**计数。

---

## 2. 改了什么

### 2.1 `packages/contracts/src/sim.ts`

| 新增 | 说明 |
|---|---|
| `SimScopeKindSchema` / `ResolvedSimScope` / `SIM_SCOPE_DEFAULT_HOPS` | 推演范围的类型与默认跳数 |
| `resolveSimScope(raw)` | **`SimSession.scope` 这个 `record` 松口袋的唯一解释器** |
| `SimCertification.trialTick.derivationRulesFired` / `.propagationRulesFired` | 分栈明细（`optional`，理由见 §5.2） |

`SimSessionSchema.scope` 的类型**故意不动**（仍是 `z.record`）：它同时被 `WO-LIVE-ENDPOINTS`
的活方案快照借用（`snapshotKind`/`label`/`page`/`baseId` …），收窄成强类型对象会当场打断那条链。
`resolveSimScope` 的判据是「`kind` 不是字面量 `"LOCAL"` ⇒ 一律 GLOBAL」，
于是空对象、快照 bag、历史遗留会话**全部**落回旧行为（RL9 additive 可回退）。

**LOCAL 却给不出根 ⇒ `unresolved` 非空，绝不退回 GLOBAL。**
「我算不出局部」与「局部等于全局」是两个命题——把前者实现成后者，正是本单要根治的病。

### 2.2 `apps/datacore/src/sim/propagation.ts`

| 新增（纯函数 · R6） | 说明 |
|---|---|
| `scopePropagationGraph(graph, scope)` | LOCAL = 根类型对象 + `hops` 跳**无向**邻域 + **两端都在范围内**的边；GLOBAL 原样返回**同一引用** |
| `ScopeReport` | 诚实回执：算了几个对象/几条边、丢了多少、（若有）为什么范围拿不到 |
| `firedPropagationRuleKeys(trace, newPending)` | **按效果**数触发规则：真落即时贡献 或 真排进延迟队列才算 |

三个判据写在函数注释里，逐条有理由：
① GLOBAL 同引用（`===` 即可验旧行为零改动）；
② 边要求**两端**都在范围内（只留一端 ⇒ 贡献写到范围外对象上，是另一种静默错答）；
③ 展开**无向**（只沿出边展开会把上游整批排除，那不是局部世界，是半条尾巴）。

### 2.3 `apps/datacore/src/app.ts`

- **tick 路由**：图物化那一步消费 `s.scope`（此前 `graph = {objects, links}` 直接全本体）。
  响应在 `propagate` 分支里回带 `scope` 段（与既有 `cadence` 段同一条纪律）。
- **`assembleCertification`**：新增 `session` 入参；Trial Tick 从「只跑 `recompute`」改为**两栈都真跑** ——
  传导栈用**会话当前态克隆** + **本次认证所问的那个范围**跑一次 `propagateTick`（不落快照、不推进 `curTick`、不 emit）。
  范围解释同样走 `resolveSimScope`，与 tick 路由**同一支**，不另写一套 `if`。
- 两个端点（`/certification`、`/scope-precheck`）把已经 `getSimOr404` 拿到、此前随手丢掉的会话传进去。

### 2.4 `apps/datacore/src/sim/certification.ts`

`TrialTickInput` 加两个可选分栈字段并原样透传（**投影，不新算**；调用方没分栈时**不下发**，
不替它编一个 0 —— 编 0 等于宣称「传导栈没触发」，而事实是「没人告诉我」，那正是 #152 的形态）。
同时改正停在「传导 `propagateTick` 待增量3」的**过期注释**（注释说谎在本仓算缺陷）。

> 纯度门 `scripts/check-sim-readiness.mjs` 静态禁止 `certification.ts` 出现 `propagateTick(` /
> `recompute(` / `selfCheck`。故传导栈的调用**只**落在 `app.ts`，本文件仍是纯投影。实测 `GATE_RC=0`。

### 2.5 `apps/datacore/test/sim-scope-trial.seam.test.ts`（新增，8 例）

接缝 = **范围半（`SimSession.scope`）× 传导半（`propagateTick` 图物化）**。
刻意用**三点链** `a1(TypeA)→b1(TypeB)→c1(TypeC)`：两点图上 LOCAL(1 跳) 恰好圈住整图、
与 GLOBAL 逐字节相同 ⇒ 断言恒绿而缺陷仍在（那正是「咬的是函数不是链路」的形态）。

---

## 3. 效果层判据的实测输出原文

### 3.1 亲手真跑（**真 HTTP 服务**，不是 vitest inject）

```
PORT=4001 JWT_SECRET=dev SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
```
真链路（种子真数据，非构造）：`Supplier.deliveryDelay --supplier_supplies_material--> Material.shortageRisk
--material_used_by_model--> Model.supplyRisk --model_demanded_by_order--> Order.shortageRisk`。
同一份 `baseSnapshot = {obj_supplier_SUP-001: {deliveryDelay: 10}}`，同样跑 3 tick，**只换 `scope`**：

```
真链路起点：Supplier=obj_supplier_SUP-001  →  Material=obj_material_pos_ncm

── GLOBAL 全域推演  scope={"kind": "GLOBAL"}
   scope 回执: {"kind": "GLOBAL", "target": null, "hops": 1, "objects": 11320, "links": 4665, "droppedObjects": 0, "droppedLinks": 0, "unresolved": null}
   非零对象数 = 31（共 31 个对象在世界里）
     obj_material_pos_lfp: {'shortageRisk': 27}
     obj_material_pos_ncm: {'shortageRisk': 27}
     obj_model_4680-NCM: {'supplyRisk': 37.8}
     obj_model_方形-LFP: {'supplyRisk': 37.8}
     obj_model_方形-NCM: {'supplyRisk': 37.8}
     obj_order_SO-3391: {'shortageRisk': 10.08}

── LOCAL(Supplier) 局部推演  scope={"kind": "LOCAL", "target": "Supplier"}
   scope 回执: {"kind": "LOCAL", "target": "Supplier", "hops": 1, "objects": 53, "links": 76, "droppedObjects": 11267, "droppedLinks": 4589, "unresolved": null}
   非零对象数 = 11（共 11 个对象在世界里）
     obj_material_pos_lfp: {'shortageRisk': 27}
     obj_material_pos_ncm: {'shortageRisk': 27}
     obj_purchaseorder_po_0: {'expeditePressure': 13.5}
     obj_purchaseorder_po_1: {'expeditePressure': 13.5}
     obj_purchaseorder_po_16: {'expeditePressure': 13.5}
     obj_purchaseorder_po_17: {'expeditePressure': 13.5}

── LOCAL 无根（诚实缺席）  scope={"kind": "LOCAL", "target": null}
   scope 回执: {"kind": "LOCAL", "target": null, "hops": 1, "objects": 0, "links": 0, "droppedObjects": 11320, "droppedLinks": 4665, "unresolved": "会话范围自称 LOCAL 却没有根对象类型（scope.target 缺失或为空）⇒ 无法裁出子图。本次推演不按全域跑——拿全域结果冒充局部正是本项要根治的静默错答。"}
   非零对象数 = 1（共 1 个对象在世界里）
     obj_supplier_SUP-001: {'deliveryDelay': 10}

════════ 效果层判据 ════════
GLOBAL ≠ LOCAL ?           True   (非零对象 31 vs 11)
LOCAL(无根) ≠ GLOBAL ?     True   ← 不许静默退回全域
LOCAL(无根) 非零对象数      1  (只剩被扰动的源点本身)

Trial Tick [scope=GLOBAL]: passed=True rulesFired=1 派生栈=0 传导栈=1
Trial Tick [scope=LOCAL&target=Supplier]: passed=True rulesFired=1 派生栈=0 传导栈=1
```

**怎么读这份输出**：
- GLOBAL 下扰动走满三跳（Material 27 → Model 37.8 → Order 10.08）；
- LOCAL(Supplier, 1 跳) 下**只到 Material / PurchaseOrder 为止**，Model 与 Order **根本没参与**
  （不是算成 0，是不在图里）。修之前这两份结果**完全一样** —— 那就是 #129 的病样。
- 范围回执把「11320 个对象裁到 53、4665 条边裁到 76」摆在明面上，用户不必从一个安静的数字里去猜。

`/certification` 端点原文（同一台真服务）：

```
{"passed": true, "rulesFired": 1, "at": "2026-08-09T14:00:52.285Z", "error": null, "derivationRulesFired": 0, "propagationRulesFired": 1}
level: L4_CERTIFIED
```

**这行就是 #152 的病历与药方同框**：`derivationRulesFired = 0` 而 `propagationRulesFired = 1`。
修之前 `rulesFired = rc.order.length` —— 即**恒等于这里的 `derivationRulesFired`，也就是 0**。
屏上会写「规则触发 0 条」，而传导栈明明有一条在跑。

`/scope-precheck` 同步复核（改了签名，必须证明没打断）：`HTTP=200`，
`keys: ['canEnterSimulation','gaps','scope','targetRef','worldCompleteness']`，`wc.pct: 47`。

### 3.2 接缝门（8 例，全绿）

```
 ✓ test/sim-scope-trial.seam.test.ts (8 tests) 6150ms
   ✓ ① 同 base 同规则同 tick：scope=LOCAL(TypeA) 与 scope=GLOBAL **结果不同**——被裁掉的那条边的下游没被算  1086ms
   ✓ ② 换根 ⇒ 换子图：scope=LOCAL(TypeC) 保住 B→C、裁掉 A→B  986ms
   ✓ ③ 诚实缺席：自称 LOCAL 却没有根（或根类型无已物化对象）⇒ 报缺 + 不传导，**绝不退回 GLOBAL**  829ms
   ✓ ④ 可回退（RL9）：不写 scope / 写活方案快照 bag 的老会话 —— 与 GLOBAL 逐字节相同  866ms
   ✓ ⑤ 纯函数直证：GLOBAL 返回**同一引用**（`===`）
   ✓ ④' Trial Tick 之后**传导计数 > 0**（此前恒 0）  774ms
   ✓ ⑤' 接缝合流：认证的 LOCAL 范围**同样作用于 Trial Tick** ⇒ 传导计数随范围变（2 → 1）  755ms
   ✓ ⑥' 零传导规则的租户：传导计数诚实为 0（不虚报，也不因此判 FAIL）  848ms
 Test Files  1 passed (1)   Tests  8 passed (8)
```

### 3.3 变异反证（两处，均先 commit 再变异，贴失败原文）

**① 撤掉范围裁剪**（`scopePropagationGraph` 的 LOCAL 分支改成原样返回 `graph`，= 本单之前的行为）：

```
 × ① 同 base 同规则同 tick … AssertionError: expected 5 to be +0 // Object.is equality
 × ② 换根 ⇒ 换子图 …        AssertionError: expected 10 to be +0 // Object.is equality
 × ③ 诚实缺席 …             AssertionError: 无 target: expected 3 to be +0 // Object.is equality
 × ⑤ 纯函数直证 …           AssertionError: expected [ 'a1', 'b1' ] to deeply equal [ 'a1' ]
 × ⑤' 接缝合流 …            AssertionError: expected 2 to be 1 // Object.is equality
      Tests  5 failed | 3 passed (8)
```
失败原文里直接打印出**病灶数字本身**：`expected 5 to be +0` —— LOCAL 下 `c1.load` 拿到了 GLOBAL 的 5。

**② 传导计数硬写 0**（`propagationRulesFired: 0 * propFired`，= 本单之前的行为）：

```
 × ④' Trial Tick 之后**传导计数 > 0** … AssertionError: expected +0 to be 2 // Object.is equality
 × ⑤' 接缝合流 …                        AssertionError: expected +0 to be 2 // Object.is equality
      Tests  2 failed | 6 passed (8)
```

两处变异**各自只杀自己那一半**（5 红 / 2 红，互不重叠），说明两半的门是分开咬住的，不是靠一条断言兜底。
均已 `git checkout --` 撤回，`git status --porcelain` 空。

### 3.4 回归（只跑与本单相关的最小范围，未跑 `pnpm -r test`）

| 命令 | 结果 |
|---|---|
| `pnpm --filter @platform/contracts build` | RC=0 |
| `pnpm --filter datacore build` | RC=0 |
| `pnpm --filter datacore typecheck` | RC=0 |
| `pnpm --filter agentcore typecheck` | RC=0 |
| `npx eslint src/sim src/app.ts test/sim-scope-trial.seam.test.ts` | RC=0 |
| `node scripts/check-sim-readiness.mjs` | RC=0（投影纯度守住） |
| `vitest run sim-certification / sim-session / sim-propagation / sim-perturbation` | **48 passed** |
| `vitest run sandbox-e4-cadence-propagation.seam / a18-sandbox / sandbox-chain-scope.seam / sandbox-d4-aggregates.seam` | **38 passed** |
| `vitest run live-scenarios-seam / seed-demo-propagation` | **13 passed** |

`live-scenarios-seam` 是**必须绿的那一个**：活方案快照借用同一个 `scope` 列，
它绿才能说明「不认识的 bag 读作 GLOBAL」这条兼容判据在真链路上成立，而不只是在我的测试里成立。

---

## 4. 没做的部分与原因（诚实清单）

1. **前端没接**（边界外）。`SandboxView` 今天已经把 `{kind, target}` 真写进会话
   （`WO-SIM-SCOPE-LOCAL` 已落），所以**读端一接上，前端那个开关立刻真的生效** —— 不需要前端改动即可闭环。
   但前端有一处**诚实位现在过期了** —— `apps/frontend-shell/src/views/sim/SandboxView.tsx:587-589`
   （`data-testid="sandbox-scope-reach-note"`）原文一字不改如下：

   > ⚠ 范围选择当前**只作用于就绪认证口径**，**尚未裁剪推演本身**——推演引擎按整租户本体传导，不读会话范围。

   这三句本单之后**全部不再成立**（范围已裁剪推演本身；引擎已读会话范围）。
   属「屏上文案说谎」，与本仓把「注释说谎算缺陷」同源，需另一单（前端包）改掉。
   **我不能碰 `apps/frontend-shell/**`。** 建议改成陈述真实作用面 + 指明 `hops` 默认 1。
2. **本体未回写**（边界外，工单明令不许碰 `docs/SYSTEM-ONTOLOGY.md`）。
   §8 断点表里 `G-SIM-SCOPE-UNREAD` 那一行仍标「🔴 未修」，且描述「读：全仓仅 3 处且只读 `snapshotKind`」
   已不成立。建议审核方回写为 ✅ 已闭，并补记本单的读端位置与语义。
3. **`hops` 无生产写端**。只有默认值 1 在生产路径上生效；`hops: 0/2` 只有测试传过。
   按本仓判据这属「已排练，不是已实现」，**故意不声张**：它是一个有默认值的参数，不是一条死分支，
   但要给它一个前端入口需另开单。
4. **逐对象范围（`targetObjectIds`）没做**。`docs/PRD-enterprise-decision-twin.md §4.3` 的
   Slice Expansion Engine 要「只推演这个订单相关的那部分世界」= 按**对象**而非按**类型**收窄。
   我刻意没加这个字段：今天没有任何写端，加了就是制造一个只有测试引用的字段。
   本单的 `scopePropagationGraph` 已经是按 **id 集合**做裁剪的，加根来源只是改 `roots` 那一行。
5. **传导仍是全量重建索引**（欠账 L3-b）。LOCAL 是在**全量物化之后**再裁，不是「只读范围内的对象」。
   对当前规模（11320 对象 / 4665 边）无感，但真要省 IO 得改仓储查询，那是 L3-b 的单。
6. **Trial Tick 不含扰动**。传给 `propagateTick` 的扰动列表是空的 —— 认证问的是「这个世界能不能跑」，
   不是「加上这些扰动会怎样」。如果将来要把扰动纳入试算，需先想清楚它算哪一个 tick 的扰动。

---

## 5. 需要审核方知道的两个裁决点

### 5.1 LOCAL 默认展开 **1 跳**，不是 0 跳

`target` 是**单个对象类型**，而 `PropagationRule` 是 `sourceTypeKey ─viaLinkKey→ targetTypeKey` 的
**跨类型**边（demo 13 条全是跨类型）。0 跳的子图里只有一种类型 ⇒ 一条跨类型边都成立不了
⇒ **LOCAL 恒等于「什么都不动」**，那是把「局部推演」实现成「不推演」，属于另一种静默错答。
1 跳 = `PRD-enterprise-decision-twin §4.3` 策略表的第一档（`1-hop → 2-hop → 决策相关 → …`），有出处、非我发明。
默认值随 `scope` 回执下发，不藏。

### 5.2 分栈明细字段是 `optional` 而非必填

`SimCertification` 在前端被当**字面量**构造（`sandbox-p0.test.tsx:25` 的
`const CERT_GLOBAL: SimCertification = {…}`），置为必填会打红边界外的包。

**这个数是实测的，不是估的**（先把两个字段改成必填、重 build 契约、跑前端 typecheck，再撤回）：

```
test/sandbox-p0.test.tsx(29,3): error TS2739: Type '{ passed: true; rulesFired: number; at: string; error: null; }'
  is missing the following properties from type '{ passed: boolean; rulesFired: number;
  derivationRulesFired: number; propagationRulesFired: number; at: string | null; error: string | null; }':
  derivationRulesFired, propagationRulesFired
```

**新增 1 条**（另两条是 §6 第 3 项那两条既有红）。
我最初在本节写的是「等 6 处」——那是把「文件里出现 `SimCertification` 的次数」当成了
「置为必填会红的处数」，**而前者并不度量后者**（其余多是 `vi.mock` 工厂里的**无类型标注**字面量，
结构上不参与该检查）。按铁律 0.6 的句式记此账并当场改正为实测值。

DataCore 侧**恒填**，故服务端答复里它们总在。若审核方希望改成必填，
只需一并放开 `apps/frontend-shell/test/sandbox-p0.test.tsx` 一个文件的改动权（1 行）。

---

## 6. 发现但超出边界的问题（只列不修）

| # | 问题 | 证据 | 为什么不在本单修 |
|---|---|---|---|
| 1 | 前端诚实位过期：`sandbox-scope-reach-note` 仍写「尚未裁剪推演本身……不读会话范围」 | `apps/frontend-shell/src/views/sim/SandboxView.tsx:587-589` | 边界外（前端包） |
| 2 | 本体 §8 `G-SIM-SCOPE-UNREAD` 行描述已过期且状态仍是 🔴 | `docs/SYSTEM-ONTOLOGY.md:1093` | 工单明令不许碰 |
| 3 | **`frontend-shell typecheck` 在 canonical 上就是红的**（2 处，与本单无关） | `test/chain-impediments-route.test.tsx(48,18) TS18048` · `test/sim-event-invalidation.seam.test.ts(32,3) TS2322` | 已用金丝雀坐实：把 `packages/contracts/src/sim.ts` 换回 canonical 版重 build 后**报同样两条**，故为既有红，非本单引入 |
| 4 | `apps/datacore` 全包 `lint` 有 **32 个既有 error**（如 `synthetic.test.ts` 的 `BASE_REGISTRY` 未使用） | `pnpm --filter datacore lint` | 我改的文件单独跑 eslint 是 RC=0；其余是既有账 |
| 5 | `/a/v1/objects/:id/neighbors` 的响应是 `{groups:[{linkKey,direction,items}]}`，**不是** `{items}` | 我的第一版探针读 `nb["items"]` 恒空，差点把「链路不存在」当结论 | 非缺陷，是我探针写错。记在此提醒下一个人：**报否定结论前先拿已知必中的样例自证工具** |
| 6 | `worldCompleteness.pct` 在 demo/GLOBAL 下实测 **47** | 真服务实测 | 与 `PRD-sim-scope-local.md §4.5` 里「复现不出 47」那条存疑记录对上了，可销账 |
| 7 | **`git diff canonical..HEAD` 不度量「我改了什么」** —— canonical 会在我干活期间前移 | 交付前该命令报我删了 `scripts/check-verdict-rollup.mjs`、改了 `docs/SYSTEM-ONTOLOGY.md` 等 6 个我从没碰过的文件；实为 canonical 从 `69804185` 前移到 `431d9249`（新增 2 提交），那 6 个文件是**它加的、我没有** | 非缺陷，是判据选错。正确判据 = `git diff <我的基点>..HEAD`。已按铁律 0.6 句式记账：**「我用 `diff canonical..HEAD` 当作『我的改动集』的证据，而前者并不度量后者。」** 差点据此以为自己违反了「不许碰 SYSTEM-ONTOLOGY.md」的边界 |

---

## 7. 《本体引用与影响》

> 本单**不改** `docs/SYSTEM-ONTOLOGY.md`（工单禁改）。以下为需回写内容。

### 7.1 对象类型（§2 I 推演沙盘域）

- **SimSession** —— `scope` 字段**首次获得引擎读端**。类型未变（仍 `record`），语义由
  `resolveSimScope()` 单源解释：`{kind:"LOCAL", target, hops?}` 为推演范围；其余键（含活方案快照 bag）读作 GLOBAL。
- **SimCertification** —— `trialTick` 增两个可选分栈字段；`rulesFired` 语义从「派生栈」变为「两栈合计」。

### 7.2 链路（§3）

```
沙盘控制台范围选择 → SimSession.scope {kind,target}
  → app.ts POST /a/v1/sim/sessions/:id/tick
    → resolveSimScope(s.scope)                  ← 本单新增读端（此前此处不存在）
      → scopePropagationGraph(graph, scope)     ← 本单新增裁剪（LOCAL 只留根+hops 跳邻域+两端在内的边）
        → propagateTick(裁剪后的图, …)
          → sim_tick_state 快照 + 响应 scope 回执
```

```
GET /a/v1/sim/sessions/:id/certification?scope=&target=
  → assembleCertification(…, session)           ← 本单新增 session 入参
    → ① ontologyCore.recompute（派生栈，原有）
      ② resolveSimScope → scopePropagationGraph → propagateTick（传导栈，**本单新增**）
        → firedPropagationRuleKeys（按效果计数）
          → deriveCertification → SimCertification.trialTick
```

### 7.3 不变量

| 编号 | 关系 |
|---|---|
| **R-ARG-FIDELITY** | **本单是它的引擎半**。既有条文覆盖求解器/编排侧、`WO-SIM-SCOPE-LOCAL` 覆盖前端半；本单补上「推演引擎收到的过滤维必须真的作用于图，且结果回带自己的范围」。 |
| R6 | 确定性：`scopePropagationGraph` 纯函数、邻接表按 id 排序、`filter` 保留输入序（裁剪不引入新的顺序来源）；Trial Tick 不落任何持久化 |
| R14 | 零业务常数：范围只认抽象 `typeKey`，测试用 `TypeA/TypeB/TypeC` |
| RL3 | `certification.ts` 仍是纯投影（传导栈调用落在 `app.ts`，纯度门 RC=0） |
| RL9 | additive 可回退：GLOBAL 返回同一引用；不写 scope / 快照 bag 逐字节同旧；无 PUBLISHED 规则时响应不含 `scope` 段 |
| R2 | 租户隔离：范围裁剪发生在**已按 tenantId 取回**的图上，不新增跨租户读 |

### 7.4 断点登记（§8）

**`G-SIM-SCOPE-UNREAD` → ✅ 已闭。**

> 原文：「`SimSession.scope` **有写端、无读端**……tick 路遍历全本体，从不看 `session.scope`
> ⇒ 用户选的推演范围**不会真的裁剪推演**。属『接了线、有数据、但没有读端』的第四形态。」
>
> → **✅ 已闭**：读端落在 `app.ts` tick 路由的**图物化那一步**（`resolveSimScope` → `scopePropagationGraph`），
> 认证的 Trial Tick 走**同一支**范围解释。
> 门 = `apps/datacore/test/sim-scope-trial.seam.test.ts`（8 例，效果层判据），
> 变异反证真红并打印病灶数字原文（`expected 5 to be +0`）。
> 真服务实测：同一扰动同样 3 tick，GLOBAL 非零对象 31 个、LOCAL(Supplier) 11 个，Model/Order 未参与。

**欠账 #152（Trial Tick 跑错栈）→ ✅ 已闭。**

> 原文：「认证屏上『Trial Tick 通过 · rulesFired=N』度量的是派生栈；**传导栈恒记 0**。
> 且注释停留在传导未实装的时代。」
>
> → **✅ 已闭**：两栈都真跑，按**效果**计数；注释已改正。
> 真服务实测原文：`{"passed":true,"rulesFired":1,"derivationRulesFired":0,"propagationRulesFired":1}`
> —— 老口径 `rulesFired = rc.order.length` 恒等于这里的 `derivationRulesFired`，即 **0**。

**建议新登记一条（本单未犯，但差点犯，值得留账）：**

> **`G-LOCAL-SCOPE-DEGENERATE`（预防性）** —— 「局部范围」若按**单类型 0 跳**实现，
> 子图里只有一种类型的对象，而传导规则全是跨类型边 ⇒ **LOCAL 恒等于什么都不动**。
> 屏上写着「局部推演已生效」，实际是「推演没发生」。
> 这与 `G-SIM-SCOPE-LOCAL-DEGRADE`（说 LOCAL 算 GLOBAL）是**同一枚硬币的两面**：
> 一个多算，一个不算，都长着「界面上完全看不出来」的脸。
> 判据：**凡新增「收窄」类能力，必须给出一条『收窄后仍有非平凡结果』的实测**，
> 而不只是『收窄后与全域不同』——`{}` 与全域也不同。

### 7.5 门禁（§7）

- 新增接缝门 `apps/datacore/test/sim-scope-trial.seam.test.ts`（随 `pnpm --filter datacore test` 跑）。
- 既有纯度门 `scripts/check-sim-readiness.mjs` 未改，且**继续咬住** `certification.ts` 不许调用重算器（RC=0）。
