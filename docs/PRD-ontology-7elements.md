# PRD · 本体七要素四缺口（欠账 #69）—— 取证复核 · 价值排序 · 最小落地

> **本单是 PRD，不改实现。** 产出只有这一份 markdown。落地另单。
>
> **取证基准 commit：`c0b7ee0d`**（`c0b7ee0d1f9785bf649d24dac7ec428fc10d8734`，分支 `claude/handoff-wo-ontology-7elements`，基线 `origin/claude/wave4-integration`）。
> 全部 `file:line` 以该 commit 的工作树为准，`git status --porcelain` 干净。
>
> **前置已读**：`docs/SYSTEM-ONTOLOGY.md` §0–§10 全文 · `CLAUDE.md` 铁律 0 / 0.5 / 1 / 2 ·
> 既有两稿 `docs/WO-69-ONTOLOGY-PRIMITIVES.md`（提出）与 `docs/ONTOLOGY-7ELEM-AUDIT.md`（`d4be4224` 盘点）。
>
> **本单相对既有两稿的定位**：`ONTOLOGY-7ELEM-AUDIT` 已把四条做成了扎实的逐条取证，**结论方向我复核后基本成立**。
> 本单不重复它，只做它没做的两件事，外加在新基准上复验：
> **① 每项的「谁读它」——真实消费方普查（这是决定做不做的唯一判据）；② 据此的诚实排序，含明确的「建议押后」。**
> 复验中发现 **6 处需要更新或更正**（§10），其中 **1 处直接改变了修法与工作量**。

---

## 0. 一页结论

### 0.1 四项的真实状态（`c0b7ee0d` 实测）

| # | 缺口 | 三分法定性 | **今天有没有活消费方** | 结论 |
|---|---|---|---|---|
| ④ | **Function 本体签名** | `outputSpec` = **接了线接错地方**（A 侧算好了，B 侧 HTTP 客户端 map 时丢弃）<br>`reads` = **接了线没数据**（权威侧空，镜像侧手抄 19/59） | ✅ **有，两个，且今天在 demo 上真跑**<br>`orchestrator.ts:332`（agent 首轮 prompt）· `ResourcesPage.tsx:99`（治理台关系图） | **P0 做**（`outputSpec` 半边是 3 处小改）<br>**P1 做**（`reads` 半边） |
| ③ | **Action 回写声明** | 声明数据 = 接了线没数据（1/10）<br>读出口 = **没接线**（零生产调用方） | ⚠️ **没有消费方，但有真实受害人**——审批 UI 真在跑、批准真写真值、审批人看不到写什么 | **P1 做**（先接读出口 + 立门，**不要先补 8 条声明**） |
| ② | **Security 列级** | 列级读出 = **没接线**（契约/执行/汇聚点三处皆无） | ❌ **零消费方、零配置面**<br>**但复验发现前提搞反了**：行级在求解器路径上覆盖 **1/10** 核心类型（§3.3） | **列级押后**；<br>**先修行级洞**（这是本次复验最重要的一条） |
| ① | **Interface** | 抽象本身 = 没接线（零契约零符号）<br>四个"接口残片"字段 = 接了线接错地方（被 `upsertType` 吞） | ❌ **零消费方、零 UI、零数据**（前端对 OntoFlow **零引用**，写入路径只能裸 REST 触达） | **押后**；<br>并建议把残片字段**删掉而非补上**（§2.5） |

### 0.2 诚实排序（含押后）

```
P0  ④-a  outputShape 接缝丢字段            ← 3 处小改 · 2 个活消费方 · demo 上今天就退化
P1  ④-b  solver→objectType 签名（reads）    ← 有活消费方 · 需 A 侧新增 19 条（搬家不改值）
P1  ③    Action 回写声明「读出口 + 门」      ← 先接口后数据 · 补声明立刻有消费方
P2  ②-a  求解器路径行级过滤洞（1/10）        ← 这是真洞 · 比列级急 · 与 R4/R2 直接相关
──────────────────── 以下建议押后 ────────────────────
P3  ②-b  列级 Security（propertyPolicy）     ← 今天零消费方；等真实多租户诉求再做
P3  ①-a  ObjectTypeDef 七个被吞字段          ← 建议「删」而非「补」（留着比没有更危险）
P4  ①-b  Interface 一等对象                  ← 纯死数据；依赖 ④-b 先落
独立  ①-c  deriveSolverArgs 兜底猜名止血      ← **不是 Interface**，别绑在一起；有活路径，可随时单独做
```

> **押后不是"不重要"，是"补了今天也没人读"。** 本仓已多次栽在「实现有、测试有、且是绿的，零生产调用方」
> （假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）。**②-b 与 ①-b 今天正好就是那个形状。**
> 反过来，④-a 的价值不在"补了本体七要素的一格"，而在**它今天正在让 demo 上的 agent 少看见一段真信息**。

---

## 1. 取证纪律

**三分法**（`CLAUDE.md` 铁律 0.5）：

| 形态 | 判据 | 修法 |
|---|---|---|
| **没接线** | 符号的调用方集合里只有 test（或没有该符号） | 接线 |
| **接了线没数据** | 有 src 调用方且在生产路径上，但输入恒空/恒 undefined | 补数据或删死分支 |
| **接了线接错地方** | 有 src 调用方，但挂在错误的路径上 | 补/改挂载点 |

**本单额外自加一条判据（"谁读它"普查）**，凡结论为"该补"的，必须答满三问：

> **谁会读它？在什么场景下读？不补的话今天谁受影响？**
> 三问答不满 → 结论一律写"建议押后"，不许为了填满四项硬凑方案。

**实测 / 推理 分界**：本单**未跑任何测试**（本单禁跑 datacore vitest、禁跑 gate）。
凡标 **[实测]** = 我在 `c0b7ee0d` 工作树上亲手 grep/读到该行；凡标 **[推理]** = 由已读代码推断、未实跑坐实，一律另列 §9。

---

## 2. 条① Interface —— 对象类型没有接口/能力抽象

### 2.1 应然（对照本体自己声明的元模型）

本体 §2.B 把 `OntologyType / OntologyLink / OntologyVersion / OntologyDraft` 列为本体域一等对象。
七要素里的 **Interface** 应当是：**一组"实现者必须具备"的属性 + 行为（可施加的 Action、可调用的 Function）**，
使得「所有实现 X 接口的类型」可查、可做影响分析、可让实现者自动获得一组行为。

### 2.2 实然 [实测]

**(a) 抽象本身：零。** 全仓搜 `implementsInterface` / `interfaceKey` / `InterfaceDef` / `ObjectInterface` → 0 命中。
`ObjectTypeDef`（`apps/datacore/src/domain.ts:262-293`）无 `implements` 类字段。

**(b) 四个"接口残片"字段真实存在，但落不了库。**

`apps/datacore/src/domain.ts`：
```
:274   storageMode?: "STATIC" | "ONTOLOGY";
:276   stateVariables?: {...}[];
:278   functions?:  { name; returns; builtin?; expr? }[];    // 类型级函数（推演可调用）
:280   actions?:    { actionTypeKey: string }[];             // 绑定的行动
:282   security?:   { prop; strategy: HASH|REDACT|PARTIAL; scopeRoles? }[];  // 「读出层应用」
:284   entityCategory?: string;
:286   description?: string;
```

- **写入方**：唯一 `apps/datacore/src/pipeline/subgraph.ts:22 buildTypeDefs` → `:52-58` 全部写上。
- **持久化**：`pipeline/service.ts:141 → ontology.upsertType`。
  `apps/datacore/src/ontology.ts:194 upsertType` 在 `:199-212` **逐字段列举**构造 `def`，
  只抄 `id/tenantId/key/displayName/domain/properties/derivedProperties/sourceBindings/version/status/published/deprecation`
  —— 上面 **7 个字段一个都没抄**，`:213 repos.ontologyTypes.put(def)` 落库时已经没了。
- **其余三处 `ontologyTypes.put`**（`ontology.ts:225`、`ontology-governance.ts:177/201`）都是
  「读出既有记录改一两个字段再写回」，不构成新写入通道 [实测]。
- **读出方**：`grep -rnE "\.(security|entityCategory|stateVariables|storageMode)\b"` 全仓（含 test）
  对 `ObjectTypeDef` 这四个字段**只命中 subgraph.ts 的写入行本身**。
  （`pipeline/service.ts:85/124` 命中的是 **OntoFlow 节点** `n.storageMode`，不是 `ObjectTypeDef`——同名不同物。）
  `scopeRoles` 全仓仅两处**声明**（`contracts/pipeline.ts:34`、`domain.ts:282`），**零消费方**。

**(c) 关键新证据 —— 这条写入路径今天没有任何界面。** [实测]

`grep -rln "OntoFlow|ontoflow|SUBGRAPH_ENTITY|EntityModeling" apps/frontend-shell/src` → **0 命中**。
`/a/v1/ontology-workflows/*`（`app.ts:2210-2230`，含 `/publish`）存在，但**没有前端消费**。

> 也就是说：`buildTypeDefs` 只能被裸 REST 调用触达。**今天没有任何用户能配出这些字段，
> 因此也没有任何用户正在丢失他配的数据。** 这一点既有盘点没有查，而它直接决定了本条的优先级。

### 2.3 差在哪

- **Interface 抽象：完全没有**（零契约、零符号、零数据）。
- **四个残片字段：接了线接错地方** —— 写入在生产代码里，但在持久化窄门被静默吞掉；读出为零。

### 2.4 谁读它？—— **没有人。**

| 三问 | 答案 |
|---|---|
| 谁会读它？ | 全仓零读出方（含 test）。 |
| 在什么场景下读？ | 无。设想中的场景（"查所有实现 Approvable 的类型"）需要先有 Interface 契约，今天不存在。 |
| 不补的话今天谁受影响？ | **无人**。写入路径无 UI（§2.2c），无种子数据走这条路，字段从未被填过。 |

### 2.5 建议：押后；并建议「删」而非「补」

**造 `ObjectInterface` 一等对象 = 纯死数据**，且 `WO-69 §四` 已论证其价值大头在**行为继承**，
而行为继承依赖 Function 签名（条④）先落 —— 这一依赖方向我复核后同意。**排最后。**

但那七个被吞的字段**不该原样留着**：

> 契约在、写入代码在、注释白纸黑字写着"读出层应用"，实际零字节走完全程 ——
> **下一个人会以为这个能力已经有了。** 这比"没有"更危险。

**两条路，选一条，不许维持现状**：
- **(推荐) 删** —— 从 `domain.ts` 移除这 7 个字段 + `subgraph.ts:52-58` 的写入。动作最小，消灭误导。
  代价：OntoFlow 契约（`contracts/pipeline.ts` `EntityModelingSchema.{functions,actions,security}`）
  保留即可（那是**工作流设计稿**的合法字段），只是不再假装它会进本体。
- **补** —— 修 `ontology.ts:199` 让它抄全，并同时补至少一个读出方。
  **但在①没有消费方之前，补 = 把死数据从 0 条扩到 7 个字段。**

### 2.6 拆出来的独立止血单 ①-c（**不是 Interface，别绑在一起**）

既有盘点把「`deriveSolverArgs` 正则猜字段名 → 静默答"无瓶颈"」放在条①下。
**我复核该缺陷真实存在且在活路径上，但它不需要 Interface，也不该等 Interface。** [实测]

```
apps/datacore/src/databuilder/solver-args.ts:15   const CAPACITY_RE = /产能|capacity|cap|容量|上限|可用|额定/i;
apps/datacore/src/databuilder/solver-args.ts:48   capacityField: (capProp ?? num(R)[0])!.propKey,   // ← 猜不中就取第一个数值字段
apps/datacore/src/databuilder/solver-args.ts:49   demandField:   (demProp ?? num(S)[0])!.propKey,   // ← 同病
```

**追一层——在生产路径上**：`deriveSolverArgs` 的调用方是
`databuilder/comprehend.ts:220` 与 `:663`（BuildPlan 倒推），
而数据构建发动机**有真前端**（`apps/frontend-shell/src/pages/admin/DataBuilderPage.tsx`）。
`comprehend.ts:662` 的筛选是 `s.inputFields.every((f) => typeKeys.has(f.typeKey))` ——
**只查 typeKey 存在，不查 propKey**，所以绑错的字段名一路无人拦。

**危害形态**：`shared_bottleneck`（`solvers/service.ts:981` 起）拿到错的 `capacityField`
→ `Number(undefined) = NaN` → `Number.isFinite` 假 → 永不进瓶颈分支 → 输出 `bottlenecks: []`。
**不报错，答案是"没有瓶颈"** —— 与 `G-ARG-DROP-SEAM` / `R-ARG-FIDELITY`
（"求解器缺过滤维不得静默返全域/首个"）同族，但在**类型/字段绑定维**上今天既无不变量也无门。

**建议**：作为**独立工单**随时可做，验收判据只有一条硬的 ——
**绑不上时必须报错（`AMBIGUOUS_BINDING`），不许再落 `?? num(R)[0]` 这个兜底**。
变异反证：保留 NaN 静默路径 → 红。

---

## 3. 条② Security —— 有行级（A6），列级为零

### 3.1 应然

本体 §5 **R4「真值写入经 Action 审批」** 与 A6 行级过滤共同承诺"谁能看/改哪些数据"。
七要素的 Security 要素应覆盖**行**与**列**两维：既能限制"看哪些行"，也能限制"看/改哪些字段"。

### 3.2 实然 [实测]

**(a) 契约与执行都只有行维。**
- `packages/contracts/src/datacore.ts:366-380 PermissionPolicySchema`：
  `resource{kind ∈ [OBJECT_TYPE, CONNECTION, RULE_SET, ACTION_TYPE], key}` + `grants[{role, ops}]` + `:379 rowFilter?`。
  **`kind` 四值无属性档；无任何列级字段。**
- `apps/datacore/src/authz.ts:10-16 AccessDecision` = `{allowed, matchedPolicies, rowFilters, reason}` —— **只有 rowFilters**。
- `apps/datacore/src/ontology.ts:318 queryObjects` → `:335 data: visible.map((o) => ({ id, type, props: o.props }))` —— **props 整份返回**。
- REST 面 `POST /a/v1/policies`（`app.ts:1340-1358`）body zod 同样只收 `{resource, grants, rowFilter}`。
- 前端 `pages/admin/PermissionsPage.tsx` 的策略编辑器只有 `资源 + role↔ops + rowFilter` 三段（`:27/:43/:61/:70`）。

**(b) 覆盖面。** `synthetic/service.ts:1690 seedPolicies` 种 **7 条 policy / 4 个对象类型**（Base×2、Order×2、Model×1、Line×2）。
其余类型走 `authz.ts:53-55` **"No policy attached … default allow"**。
`Customer`（`synthetic/battery-extended.ts:141`，含 `creditLimit/receivables/maxOverdueDays`）**不在这 4 类里**。

**(c) 两处既存"列级味"机制均不生效**（既有盘点已述，我复核确认）：
`MaskRule.scopeRoles` 零消费方（`processing.ts:50 applyMask` 无角色参数）；
`ObjectTypeDef.security` 被 `upsertType` 吞掉（§2.2b）。

### 3.3 ⚠️ 复验最重要的一条：**行级在求解器路径上覆盖 1/10 核心类型** [实测]

既有盘点把这条列为不确定项 U2（"未逐行核实 `loadContext`"）。**我坐实了，结论比预期严重：**

```
apps/datacore/src/solvers/service.ts:4003   async loadContext(
:4004     tenantId: string,                     // ← 只收 tenantId，**不收 AuthCtx**
:4005     visibleOrders?: ObjectInstance[],
...
:4014     const loadCore = (t) => ... this.repos.objects.listByType(tenantId, t)   // ← 直连仓储，零 authz
:4024     visibleOrders ? Promise.resolve(visibleOrders) : loadCore("Order"),
```

`loadContext` 的核心 10 类是 `Base / Line / Process / Equipment / MaintPlan / Model / Order / Shipment / DemandSegment / DataHealth`。
**只有 `Order` 一类可以由调用方传入已过滤集合**（`visibleOrders`），其余 9 类一律 `listByType(tenantId, t)`。

**追调用方——17 处，只有 1 处传 `visibleOrders`** [实测]：

| 传了 `visibleOrders` | 未传（→ Order 也走全量） |
|---|---|
| `solvers/service.ts:4302`（`invoke` 主路，由 `ontology.ts:700 invokeSolver` 供给） | `solvers/service.ts:852 / 964 / 2806 / 3127 / 4227` · `simclock.ts:289` · `sop.ts:86/176/471` · `calibration/service.ts:232/639` · `calibration/pairing.ts:66` · `planviews.ts:52/199/377/410` |

而**即使那唯一一处**，`ontology.ts:690-699` 也只对 `Order` 做行级过滤（`catch → visibleOrders = []`，注释自陈
"no READ grant on Order → solvers see no orders"），**另外 9 类照样全量**。

**具体后果**：demo 种了 `Base` 的行级策略 `Object.baseId IN ${user.attributes.baseScope}`（`service.ts:1702`）。
`base_manager:常州` 走 `GET /a/v1/objects?type=Base` 只看到常州；
**但只要触发任何一个求解器，`loadContext` 就把 12 个基地全载进上下文。** [推理·见 §9 U-1]

> **这把条②的前提掉了个头。** `WO-69 §四` 主张的顺序是「先做列级 Security，顺手把 `类型.属性` 寻址做扎实」。
> 但**行级本身在求解器路径上就是漏的**——在一个行级都拦不住的路径上加列级，等于给没锁的门配第二把锁。
> **先修行级洞（②-a），列级（②-b）押后。**

### 3.4 谁读它？

| | ②-a 行级洞 | ②-b 列级 |
|---|---|---|
| 谁会读它？ | `authz.rowAllowed` 已存在且被 8 处消费；缺的是**求解器路径把它接上** | **无人**。`AccessDecision` 无该维度，四个读出汇聚点无投影逻辑，无 test，无配置面 |
| 什么场景？ | 任何多基地租户 + 任何求解器调用（demo 每天都在跑） | 设想场景（"看得到客户但看不到 creditLimit"）今天无人提出过实际诉求 |
| 不补谁受影响？ | **`base_manager` 角色**：REST 面受限、求解器面不受限，两面不一致 | 无人。demo 只有 3 个角色，且 `Customer` 连行级 policy 都没配 |

### 3.5 建议

- **②-a（P2·做）**：给 `loadContext` 收 `AuthCtx`（或在 `ontology.invokeSolver` 正门把 9 类一并按 `rowAllowed` 过滤后传入）。
  这是**补齐一个已声明的不变量**，不是新造能力。
- **②-b（P3·押后）**：`propertyPolicy.denyRead` 的 additive 契约设计（既有盘点 §3.4）我复核后**认为形状是对的**
  （删键不置 null、只做读维黑名单、四个汇聚点全接），**但今天没有消费方，做了就是死契约**。
  **触发条件**：出现真实的多租户/多角色部署诉求，或出现第一个"看得到行、不该看到列"的具体场景。
  届时**必须与 ②-a 同一单做**（同一套 `类型.属性` 寻址与同一批汇聚点，拆两半必然只接一半 —— 本仓高频病）。

---

## 4. 条③ Action 无回写声明

### 4.1 应然

本体 §6「行动」+ §5 **R4**：真值变更经 Action 审批。
七要素的 Action 要素应当声明**这个动作会写哪些对象类型的哪些属性** —— 供审批人在批准前看见，供影响分析回答铁律 0 的「改 X 影响什么」。

### 4.2 实然 [实测]

**契约齐全、读出函数齐全、SEAM 测试齐全 —— 唯独没有出口，也没有数据。**

- 契约：`packages/contracts/src/actions.ts:121 ActionEffectSpecSchema{writes[], coverage, undeclared[]}`
  挂 `:149 ActionType.effects?`；纯函数 `:177 actionWriteTargets` / `:190 actionEffectCoverage`。
- **数据面**：`apps/datacore/src/actions.ts:263 BUILTIN_ACTION_EFFECTS` —— **仍然只有 1 条**（`plan_change`，`coverage: "PARTIAL"`）。
  而 `:35-60 ACTION_WIRING` = **9 `WIRED` + 1 `NOT_IMPLEMENTED`（`采纳经营方案`）+ 0 `NO_WRITE`**。
  → **9 个真写真值的动作里，8 个没有任何回写声明。**
- **读出口：零生产调用方。**
  `actions.ts:332 describeActionImpact` / `:454 ActionService.describeImpact`；
  全仓调用方只有 `apps/datacore/test/action-type-evolution.test.ts:126/146/224`。
  `app.ts` 无任何 action impact 端点（`impact` 的命中全是 `/a/v1/meta/impact`、`/a/v1/boundary/impact` 等别的东西）。
  → **假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：实现有、测试有、且是绿的，零生产调用方。**
- **登记口：租户注册不进 effects。** `app.ts:3124 POST /a/v1/action-types` 的 body zod（`:3128-3134`）
  只收 `{key, name, paramsSchema, checkRules, approvalChain}` —— **不含 `effects`**。
  而服务层 `actions.ts:459 registerType` 用 `...type` 展开、本可以存。
  → `actions.ts:261` 那句"租户经 POST 注册的 effects 优先级高于本表"的注释，**在 REST 面上今天不成立**。
- **门面：无门守。** `scripts/check-action-wiring.mjs` 全文 `grep -c effects` = **0**。

### 4.3 谁读它？—— 没有消费方，**但有真实受害人**

| 三问 | 答案 |
|---|---|
| 谁会读它？ | 今天**零**（无端点 / 无 UI / 无 agent 工具）。 |
| 在什么场景下读？ | **审批。** 而审批面真实存在且在跑。 |
| 不补谁受影响？ | **审批人。** [实测] `apps/frontend-shell/src/pages/admin/ActionsPage.tsx` 的审批详情只渲染 `:99-101` `JSON.stringify(draft.payload)` + `:115 审批链` + `:146 approve-btn`。**批准按钮真的会写真值，而界面上只有 payload。** |

> `G-ACTION-NOOP-EXEC` 记的是「审批链走完、审计留痕齐全，真值一个字节没动 —— 绿状态 ≠ 生效」，已被
> `check-action-wiring.mjs` 堵住。**它的对称面同样成立且今天正在发生：真值动了，但批准前没有任何人能知道动了什么。**
> 前者已有门堵，后者一道门都没有。

### 4.4 建议：P1 做 —— **先接读出口 + 立门，不要先补那 8 条声明**

理由（我复核后同意既有盘点的判断，并补一条）：
1. 补完之后仍然零消费方 = 把死代码从 1 条扩到 9 条；
2. 手写清单必然过期，而今天**没有任何门**能发现它过期了；
3. **补一条声明的边际价值，取决于有没有出口**。先有出口，则每补一条立刻可见、可对拍。

**三处改动（合计约几十行 + 一个纯脚本断言）**：

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `apps/datacore/src/app.ts`（紧邻 `:3123` action-types 段） | 新增 `GET /a/v1/action-types/:key/impact` → `actions.describeImpact(ctx, key)`。把已排练好的 `actions.ts:454` 接上生产线 |
| 2 | `apps/datacore/src/app.ts:3128-3134` | body zod 补 `effects: ActionEffectSpecSchema.optional()`，让 `actions.ts:261` 那句注释成为事实 |
| 3 | `scripts/check-action-wiring.mjs` | **断言⑥**：每个标 `WIRED` 的已注册内置键，必须在 `BUILTIN_ACTION_EFFECTS` 有条目且 `coverage !== "NONE"`。**棘轮式**：当前 8 个缺口写进 baseline（只降不升），新增 WIRED 动作必须带声明 |

**（可选，同单顺手）** 4. `ActionsPage.tsx` 审批详情加一段"本次批准将写入"，消费端点 1。
这一条把"有出口"变成"审批人真看得见"，是本条价值的兑现点；但如按范围边界不碰前端，可拆下一单。

**验收判据（效果层）**

| # | 判据 | 变异反证（必须变红） |
|---|---|---|
| C1 | 真发一次某 WIRED 动作 draft → **批准前** `GET /a/v1/action-types/<key>/impact` 的 `writes[].{objectType, properties}`，与**批准后**真实发生的对象变更**逐条对拍相等**（照 `action-type-evolution.test.ts:224` 已有的 `plan_change × GlobalSimPlanExecutor` 逐属性对拍 SEAM 同款） | effects 里删掉一个实际会写的属性 → C1 红 |
| C2 | 给一个 WIRED 动作故意不写 effects → `pnpm gates` **红**并打印该键 | 断言⑥ 只数数不判 coverage（`"NONE"` 也放行）→ C2 红 |
| C3 | 经 `POST /a/v1/action-types` 带 `effects` 注册租户动作 → `GET .../impact` 读得回来，**且优先于内置表** | body zod 仍不收 effects → C3 红 |
| C4 | `coverage: "NONE"` 必须表述为**"未声明（不知道 ≠ 无副作用）"**，不得渲染成"无副作用" | 把 NONE 显示成"无写入" → C4 红 |

---

## 5. 条④ Function 无本体签名

### 5.1 应然

本体 §2.E 求解/推演域 + §3「求解器目录 → DRIL 投影 → Agent 选型」链路。
Function 要素应声明：**读哪些对象类型/属性（inputSpec）** 与 **输出什么形状（outputSpec）**，
供 ① Agent 选型与结果取字段、② 影响分析（"改 `Line.max_capacity_day` 影响哪些求解器"）。

### 5.2 实然（分两半，病不同）

契约形状**早就存在且恰好就是所要的签名** [实测]：
`packages/contracts/src/intelligence-resource.ts:39 ResourceInputOutputSchema{objectTypes, linkKeys, requiredProps, shape, example}`，挂 `:116-117 inputSpec/outputSpec`。

#### ④-a `outputSpec` —— **接了线接错地方，且丢弃点比既有盘点认定的更靠上游**

这是本单**最重要的一条更正**（既有盘点写"`projectSolvers` 不填"，只对了一半）：

```
A 侧算好了 ──► 端点返回了 ──► ✗ B 侧 HTTP 客户端 map 时丢弃 ──► projectSolvers 无从填 ──► 消费方恒空
```

| 环节 | 实况 [实测] |
|---|---|
| A 侧权威 | `apps/datacore/src/solvers/service.ts:258 SOLVER_OUTPUT_SHAPES` |
| A 侧端点 | `apps/datacore/src/app.ts:2685`：`return { solvers: items.map((it) => ({ ...it, outputShape: SOLVER_OUTPUT_SHAPES[it.key] ?? [] })) }` ← **已经返回了** |
| **B 侧丢弃点** | `apps/agentcore/src/tools/datacore-http.ts:360 solverRegistry`，`:373-381` 的 map **逐字段列举 7 个字段，没有 `outputShape`**；返回类型（`:363`）也没声明它 |
| 契约接口 | `apps/agentcore/src/tools/clients.ts:195-198 CatalogClient.solverRegistry` 返回类型同样无 `outputShape` |
| 投影 | `apps/agentcore/src/dril/resource-projector.ts:52 projectSolvers`（`:53-66`）不填 `outputSpec`（它也拿不到） |

> **反讽实证**：**紧邻该 map 上方**的 `datacore-http.ts:371` 注释原文是
> 「WO-DRIL-PRECISION：透传 answersQuestions/tags（DataCore 目录已产出），供 DRIL 语义检索 —— **勿在接缝丢弃**」，
> 而 `:379-380` 正是那两个字段的透传行。
> **`outputShape` 就在同一个 map 里、被同一种方式丢弃。** 上一次修的是那两个字段，这一个漏了。

**消费方（两个，今天在 demo 上真跑）** [实测]：

1. **agent 首轮 prompt**：`apps/agentcore/src/router/orchestrator.ts:324 renderDrilPackage` →
   ```
   :332  const withShape = pkg.solvers.map((s) => (s.outputShape && s.outputShape.length > 0
                                                    ? `${s.key}（输出 ${s.outputShape.join("/")}）` : s.key));
   ```
   → **恒走 `: s.key` 分支**，prompt 从「`gap_attribution`（输出 …）」退化成裸 key。
   调用点 `orchestrator.ts:1965` / `:2497`（path-B 与子 agent 两处），
   数据来源 `dril/resource-router.ts:80-82`（`outputSpec?.shape` 恒 undefined）。
2. **治理台关系图**：`apps/agentcore/src/server.ts:871 getRelations` →
   `GET /b/v1/resources/:kind/:key/relations` → 前端 `pages/admin/ResourcesPage.tsx:47/99-110`。

**门是开的**：`qos.dril-routing` 虽 `defaultOn:false`（`agentcore/src/features/registry.ts:113`、`datacore/src/features.ts:111`），
但 **demo 租户 override 为 `true`**（`apps/datacore/src/seed.ts:65`）。
→ **这不是暗发死路，是 demo 部署上的活路径。** [实测]

#### ④-b `reads`（solver → objectType）—— 接了线没数据（权威侧空，镜像侧手抄）

- 消费方 `apps/agentcore/src/dril/relations.ts:98 declaredObjectTypes` 读
  `scopeObjectTypes ?? [] + includedTypes ?? [] + inputSpec?.objectTypes ?? []`，对 solver 三者全 undefined → 恒 `[]`
  → `:115 objectTypeRelations` 对 solver 恒**零条边**。
  而同文件 `:21` 的抬头注释明写 `solver/slice --reads--> objectType` —— **这条边结构上不可能产生**。
- 该函数在生产路径上：`relations.ts:126 relationsOf` ← `server.ts:871`（REST）+ `dril/resource-registry.ts:226`。
- **唯一真实存在的 solver→类型清单手抄在 B 侧镜像里**：
  `apps/agentcore/src/agent/navigation-slice.ts:31 reads`，`:76 SOLVER_CATALOG` 共 **19 条** [实测：`grep -cE '^\s+reads:'` = 19]，
  被 `:303/:310/:330` 真消费。而该文件 `:22-24` 自述"输出形状**镜像** DataCore（权威在 A 侧）" ——
  **实情是 A 侧权威根本没有 `reads` 这份数据。**
- **覆盖率**：`SOLVER_KEYS`（`solvers/service.ts:49-167`）实测 **59** 个 → **19/59 = 32%**，且无门守其增长。
  （既有盘点在 `d4be4224` 记 57，两日内新增 `chain_loss_attribution` / `chain_impediments` 两个，正好印证"无门守增长"。）

### 5.3 谁读它？—— **有，两个，且今天在 demo 上真跑**

| 三问 | 答案 |
|---|---|
| 谁会读它？ | ①`renderDrilPackage`（`orchestrator.ts:332`）→ agent 首轮 prompt；②`getRelations`（`server.ts:871`）→ 治理台 `/admin/resources` 关系图 |
| 什么场景？ | demo 租户任何走 path-B 的深问（`qos.dril-routing` 已开）；admin 打开资源治理台看任一 solver |
| 不补谁受影响？ | **agent**（只能从自由文本 `description` 猜结果字段 —— `G-2` 记录的正是这一族病：plan 读 `data.rows/count`、真实返回 `affected/total` → 跨服务 FAIL）；**做影响分析的人**（"改某字段影响哪些求解器"这个铁律 0 的核心问题，资源关系图答得出 rule/slice/agent，**答不出 solver**——而求解器恰恰是数字的产地） |

### 5.4 建议：④-a 列 **P0**，④-b 列 **P1**（同一单做完更好）

**④-a（3 处小改，纯"别丢字段"，不引入新概念）**

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `apps/agentcore/src/tools/clients.ts:195-198` | `CatalogClient.solverRegistry` 返回类型补 `outputShape?: string[]` |
| 2 | `apps/agentcore/src/tools/datacore-http.ts:373-381` | map 里补透传 `...(s.outputShape?.length ? { outputShape: s.outputShape } : {})`（与同处 `:379-380` `answersQuestions/tags` 同款写法）；`:363-366` 返回类型同步 |
| 3 | `apps/agentcore/src/dril/resource-projector.ts:33 CatalogItem` + `:52 projectSolvers` | 目录项形状补 `outputShape?`；投影填 `outputSpec: { shape: s.outputShape }` |

> ⚠️ 同时须核对 **mock/in-memory 的 `solverRegistry` 实现**是否也需补（`clients.ts` 是接口，HTTP 是一种实现）——见 §9 U-2。

**④-b（搬家不改值优先）**

4. `apps/datacore/src/catalog.ts:14 CatalogItem` additive：
   ```ts
   /** 本体级签名：这个求解器读什么。typeKey 必须能在已发布本体解析到。 */
   ontologySignature?: { reads: { typeKey: string; propKeys?: string[] }[]; writes?: {...}[] };
   ```
5. **只搬 B 侧已有的 19 条**（`navigation-slice.ts:76` 的 `reads`）到 A 侧对应目录项，**值逐字节不改**（R6 可对拍）。
6. `navigation-slice.ts` 的 `reads` 改为从 A 侧投影，**删掉手抄表**（消灭第二份真值源）。
7. `projectSolvers` 顺手填 `inputSpec: { objectTypes: sig.reads.map(r => r.typeKey) }`。

**刻意分期**：`propKeys` 级（属性级签名）与"实跑比对"门留后续 —— 它需要稳定的 `类型.属性` 寻址，
与 ②-b 列级共用同一套地基（`WO-69 §四` 的依赖方向，我复核后同意）。

**验收判据（效果层）**

| # | 判据 | 变异反证（必须变红） |
|---|---|---|
| D1 | **头号判据**：demo 租户（`qos.dril-routing` 开）path-B 深问一次 → 首轮 user prompt 的【DRIL 智能资源包】行里，solver **带「（输出 …）」**（今天恒无） | `datacore-http.ts` 不透传 → D1 红（专咬本条真正的丢弃点） |
| D2 | `GET /b/v1/resources/solver/gap_attribution/relations` 返回的 `reads` 边**非空**，且集合等于 A 侧声明（今天恒空） | A 侧删掉某类型 → D2 集合不等 → 红 |
| D3 | **单源红咬**：全仓只剩一份 solver→类型清单。静态断言 `navigation-slice.ts` 里**不存在**手写 `reads: [` 字面量 | 保留 B 侧手抄表 → D3 红 |
| D4 | **一致性红咬**：对已声明的 19 个 solver，静态扫其实现里 `listByType("X")` / `objectsByType.X` 的类型字面量，与声明 `reads` 比对；**声明漏掉一个实际会读的类型即红** | 声明少写一个实际读的类型 → D4 红（没有它，签名就是又一份会过期的手写清单） |
| D5 | 签名里的 `typeKey` 必须能在出厂本体解析到 | 写一个不存在的类型 → D5 红 |
| D6 | **零回归**：`qos.dril-routing` 关 → path-B 首轮 prompt **逐字节等同现状** | 把透传做成无条件改写 prompt → D6 红 |

---

## 6. 价值排序与排期建议（汇总）

| 档 | 项 | 工作量 [推理] | 活消费方 | 不做的代价 |
|---|---|---|---|---|
| **P0** | ④-a outputShape 接缝透传 | 3 处小改（一个 map 加一行同款透传） | **2 个，demo 上在跑** | agent 少看见一段真信息，只能猜结果字段（G-2 同族） |
| **P1** | ④-b solver→objectType 签名 | A 侧 additive + 搬 19 条 + 删镜像 + 1 门 | **2 个，demo 上在跑** | 影响分析对 solver 恒答空 |
| **P1** | ③ Action impact 读出口 + 门 | 2 处端点/schema + 1 个脚本断言 | 0（但审批面真实） | 审批人批准前不知道会写什么 |
| **P2** | ②-a 求解器路径行级洞 | `loadContext` 签名 + 17 处调用方 + 正门补 9 类过滤 | 已有（`rowAllowed`） | 已声明的行级不变量在求解器面被绕过 |
| **P3** | ②-b 列级 Security | 契约 + 4 汇聚点 + 迁移核对 | **0** | 今天无人受影响 |
| **P3** | ①-a 七个被吞字段 | 删：小；补：中 | **0** | 误导下一个人（"这个能力已经有了"） |
| **P4** | ①-b Interface 一等对象 | 大 | **0** | 无 |
| **独立** | ①-c `deriveSolverArgs` 兜底止血 | 小（改兜底为报错 + 门） | 已有（DataBuilder 前端） | 静默答"无瓶颈" |

**并行/串行建议**
- ④-a + ④-b **一个 dev 整单做**（同一条 DRIL 链路的两半；拆开必然只接一半 —— 本仓 metric-aware 反复炸的根）。
- ③ 与 ④ **文件边界不重叠**（③ 只碰 `datacore/actions|app` + `scripts/`；④ 只碰 `agentcore/dril|tools` + `datacore/catalog`），可并行。
- ②-a 与 ①-c 都碰 `datacore/solvers`，**建议串行或同单**。
- ②-b / ①-a / ①-b **本轮不派单**，登记为已定性欠账，等触发条件。

---

## 7. 《本体引用与影响》

> 铁律 0 强制章节。本单**不改本体正文**（范围外），以下为"触及了什么"与"落地单必须回写什么"。

### 7.1 触及的对象类型（本体 §2）

| 域 | 对象类型 | 本单关系 |
|---|---|---|
| §2.B 本体/对象域 | **OntologyType / ObjectTypeDef** | ① 的七个字段落在 `upsertType` 持久化窄门内；④-b 的 `typeKey` 解析目标 |
| §2.D 行动/权限域 | **ActionType**（`effects`）· **PermissionPolicy** | ③ 的声明载体；② 的策略载体 |
| §2.E 求解/推演域 | **Solver / CatalogItem**（`SOLVER_KEYS` 实测 **59**） | ④ 的签名载体 |
| §2.H 交互/编排域 | **IntelligenceResource / ResourceDescriptor**（DRIL 五级资源） | ④ 的投影与消费面 |
| §2.A 数据接入域 | **BuildPlan / PlanSolverNeed** | ①-c 的 `inputFields` 校验面（`closure.ts` FORWARD 闭包） |

### 7.2 触及的链路（本体 §3）

| 链路 | 本单动到哪一段 |
|---|---|
| **编排链 · path-B 组包注入**（`runPathB → buildResourcePackage → renderDrilPackage → runAgentLoop`，暗发 `qos.dril-routing`） | ④-a：`outputShape` 在 `datacore-http.ts` 这一跳被丢；补上后 prompt 段内容变化（**关门时须逐字节零回归**） |
| **求解器目录 → DRIL 投影 → Agent 选型**（`solverRegistry → projectSolvers → resource-registry → resource-router`） | ④-a/④-b 全段 |
| **资源关系图**（`relationsOf → GET /b/v1/resources/:kind/:key/relations → ResourcesPage`） | ④-b：solver `reads` 边从恒空变为真集合 |
| **authz 链**（`authz.decide → rowFilters → rowAllowed → 对象查询/切片/时序`） | ②-a：把求解器上下文接进这条链（今天旁路） |
| **求解器上下文加载**（`ontology.invokeSolver → solvers.invoke → loadContext → repos.objects.listByType`） | ②-a 的落点；**本单认定这是一条既有链路的未登记旁路** |
| **工作流发布**（`buildTypeDefs → upsertType → ontologyTypes.put`） | ①：七字段在此断 |
| **Action 审批链**（`ActionDraft → approvalChain → domainExecutor → 真值`） | ③：并联一条**只读**的 `describeImpact` 出口，不改审批链本身 |
| **数据构建发动机**（`comprehend → deriveSolverArgs → PlanSolverNeed → closure FORWARD`） | ①-c 的落点 |

### 7.3 触及的事件（本体 §4）

| 事件 | 关系 |
|---|---|
| `L11 policy.updated` | ②-a/②-b 若改策略语义，此事件的失效下游（dashboard/search/scenario-data/history）语义随之扩展 |
| `L5 action.pending_approval` · `L5 action.executed` | ③ 的读出口服务于 `action.pending_approval` **之后、`action.executed` 之前**这个时间窗（审批窗） |
| `L1 ontology.published` | ④-b 的 `typeKey` 解析基准随本事件变；签名校验门须在发布后重跑 |
| **不新增事件** | 本单四项均为**读出口/声明/过滤**，无产出型操作 → 依 **R10（D-29）** 无需发新事件 |

### 7.4 触及的不变量（本体 §5）

| 不变量 | 本单关系 |
|---|---|
| **R1 contracts-only-shared** | ④-a 的 `outputShape` 透传必须经 `@platform/contracts` 形状或 `CatalogClient` 接口，不得跨 app import 源码 |
| **R2 tenant_id everywhere** | ②-a：`loadContext(tenantId)` 租户隔离**是有的**，缺的是**租户内的行级**——两者别混 |
| **R3 entitlement 先于 authz** | ④ 全程在 `qos.dril-routing` 门后；门关 → 行为逐字节不变（D6） |
| **R4 真值写入经 Action 审批** | ③ 直接服务于 R4 的**可解释性**：R4 保证"经审批"，本单补"审批时看得见写什么" |
| **R6 确定性** | ④-b「搬家不改值」可逐字节对拍；④-a 透传纯投影；①-c 报错路径确定性 |
| **R9 仓储双实现** | ②-b 若做 `propertyPolicy` additive → 需核对 `PermissionPolicy` 落法（四处同改，见 §9 U-3） |
| **R13 结论可溯源** | ④-b 的 `reads` 是"这个数字读了哪些对象"的结构化出处；③ 的 `writes` 是"这个批准动了哪些真值"的出处 |
| **R14 应用层无业务常数** | ④-b 删 B 侧手抄表 = 消灭第二份真值源，正是 R14/单一来源纪律 |
| **R-一致（一个事实一个出处）** | ④-b 的核心：solver→类型清单全仓只许剩一份（D3） |
| **R-ARG-FIDELITY** | ①-c 同族：「求解器缺过滤维不得静默返全域/首个」在**类型/字段绑定维**上的延伸 |

### 7.5 触及的断点（本体 §8）

**引用既有断点**

| 编号 | 关系 |
|---|---|
| `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`（假绿第 9 形态） | ③ 的 `describeImpact` 是本形态又一实例；②-b/①-b 若现在就做**会主动制造**一个新实例 |
| `G-ACTION-NOOP-EXEC` | ③ 是它的**对称面**（前者"绿状态≠生效"，后者"生效了但没人知道生效什么"） |
| `G-ARG-DROP-SEAM` / `R-ARG-FIDELITY` | ①-c 同族（丢的不是过滤实参，是类型/字段绑定） |
| `G-DRIL-PATHB-INJECT`（标 ✅ P4 闭） | ④-a 说明该链路**接通了但载荷不全**；另见下方新增候选 |
| `G-RESOURCE-CATALOG-NO-DATA`（标 ✅ 已闭） | 它闭的是 `object_type`/`field` kind 投影；④-b 是**同一张资源图上 solver→objectType 这条边仍空** |
| `G-2` | ④ 的危害形态（跨服务输出形状不匹配） |
| `G-SOLVER-SCOPE-DEAF` / `G-SOLVER-SCOPE-ECHO` | ②-a 与之相邻但**不同**：那两条是"作用域实参被忽略"，本条是"行级策略在求解器路径上根本没接" |

**建议落地单回写本体 §8 的新增登记（本单不写，只给内容）**

| 建议编号 | 断点 | 链路位置 | 性质 |
|---|---|---|---|
| `G-SOLVER-OUTPUTSHAPE-SEAM-DROP` | **A 侧已算好并返回的 `outputShape`，在 B 侧 HTTP 客户端 map 时被丢弃**：`app.ts:2685` 返回 → `datacore-http.ts:373-381` 逐字段列举不含它（`clients.ts:195-198` 类型亦无）→ `projectSolvers` 无从填 → `renderDrilPackage:332` 恒退化成裸 key、`resource-router.ts:80-82` 恒取不到。**紧邻该 map 上方 `:371` 的注释正是「勿在接缝丢弃」**（上次修了 `answersQuestions/tags`，这个漏了）。demo 租户 `qos.dril-routing` 已开（`seed.ts:65`）→ **活路径**。 | `solverRegistry → datacore-http map → projectSolvers → resource-router → renderDrilPackage` | 🔴 未修 |
| `G-SOLVER-ONTOLOGY-SIGNATURE` | **求解器无本体签名，权威侧空、镜像侧手抄 19/59**：`declaredObjectTypes`（`relations.ts:98`）对 solver 恒 `[]`，使 `:21` 声明的 `solver --reads--> objectType` 边结构上不可能产生；唯一真实清单在 B 侧 `navigation-slice.ts:31 reads`，无门守其与实现一致、无门守其随 `SOLVER_KEYS` 增长（两日内 57→59 无人补）。 | `catalog → projectSolvers → relations → 资源关系图/agent 选型` | 🔴 未修 |
| `G-ACTION-EFFECTS-UNDECLARED` | **9 个真写真值的 ActionType 里 8 个无回写声明，且唯一读出口零生产调用方**：`BUILTIN_ACTION_EFFECTS`（`actions.ts:263`）仅 1 条；`describeImpact`（`:454`）只有 test 调用；`POST /a/v1/action-types`（`app.ts:3128`）body zod 不收 `effects`，使 `:261` 的"租户注册优先"失实；`check-action-wiring.mjs` 零处看 `effects`。审批 UI（`ActionsPage.tsx:99-101`）只渲染 payload。 | `ActionType.effects → describeActionImpact → ✗（无端点/无 UI/无 agent 工具）` | 🔴 未修 |
| `G-SOLVER-CTX-ROWFILTER-BYPASS` | **求解器上下文旁路行级过滤**：`loadContext`（`solvers/service.ts:4003`）只收 `tenantId` 不收 `AuthCtx`，核心 10 类里 9 类直连 `repos.objects.listByType`；17 处调用方仅 1 处（`:4302`）传 `visibleOrders`，且那一处（`ontology.ts:690-700`）也只过滤 `Order`。→ **行级在求解器面覆盖 1/10**，`Base` 等已配策略的类型在求解器路径上不受限。 | `ontology.invokeSolver → solvers.invoke → loadContext → repos.objects.listByType（无 authz）` | 🔴 未修 |
| `G-ONTOLOGY-FIELD-SINK` | **`ObjectTypeDef` 七字段有写入方、无持久化**：`storageMode/stateVariables/functions/actions/security/entityCategory/description`（`domain.ts:274-286`）由 `subgraph.ts:52-58` 写入，`upsertType`（`ontology.ts:199-212`）逐字段列举时全部丢弃；读出方为零（含 test）。**且前端对 OntoFlow 零引用 → 今天无 UI 可配 → 无人正在丢数据**（这一点决定它是"该删"而非"该急修"）。 | `buildTypeDefs → upsertType → ✗（字段被丢）→ ontologyTypes.put` | 🔴 未修（建议删而非补） |
| `G-DRIL-COMPOSE-MERGE-DEAD`（候选，见 §9 U-4） | **`mergeResourcePackage` / `compileWithResourcePackage`（`compile-plan.ts:181/196`）全仓零调用方（含 test）**，而 `:167-169` 的注释自陈"Compose 路径消费 DRIL 资源包"。若属实，则 `G-DRIL-PATHB-INJECT` 描述里"DRIL 只接了 Compose 路径（P3）"这个前提本身不成立。 | `buildResourcePackage → ✗ mergeResourcePackage（无调用方）→ compileSolverPlan` | 🟡 待判定 |

> **回写纪律提醒**：以上任一项落地后，**必须**同步更新本体 §2.E 的求解器计数（现文写 38，实测 **59**）
> 与 §2.D 的 Action 三态账（现文写"四型零回写"，HEAD 实为 **9 WIRED + 1 NOT_IMPLEMENTED + 0 NO_WRITE**，
> 兜底执行器已是 `UnwiredActionExecutor`）。这两处存量过期既有盘点已指出，至 `c0b7ee0d` **仍未回写**。

---

## 8. 🚦 落地单的范围边界（供派单直接抄）

| 单 | 允许改 | 禁止 |
|---|---|---|
| **WO-④ DRIL 求解器签名**（P0+P1，一个 dev 整单） | `apps/agentcore/src/tools/{clients,datacore-http}.ts` · `apps/agentcore/src/dril/{resource-projector,relations}.ts` · `apps/agentcore/src/agent/navigation-slice.ts` · `apps/datacore/src/catalog.ts` · 新增门脚本 + 测试 | `apps/frontend-shell/**` · `apps/datacore/src/solvers/**` · 破坏性契约改动 |
| **WO-③ Action impact 出口**（P1） | `apps/datacore/src/{actions,app}.ts`（仅 action-types 段） · `scripts/check-action-wiring.mjs` · 测试 | `packages/contracts/src/actions.ts`（契约已齐，不动） · `apps/agentcore/**` |
| **WO-②-a 求解器行级洞**（P2） | `apps/datacore/src/solvers/service.ts` · `apps/datacore/src/ontology.ts` · 17 处调用方 · 测试 | `packages/contracts/**` · 列级相关一切（**本单只修行级**） |
| **WO-①-c 绑定止血**（独立） | `apps/datacore/src/databuilder/solver-args.ts` · `apps/datacore/src/solvers/service.ts`（`sharedBottleneck` 段） · 测试 | 其余 databuilder 文件 · `domain.ts` |

**共同纪律**：每张 WO = 一条 `claude/handoff-<wo>` 分支；每完成一个可命名单元立刻 commit + push
（**push 与过 gate 是两回事**，铁律 1-5）；门必须显式捕获退出码（`out=$(cmd 2>&1); rc=$?`）。

---

## 9. 不确定项（不猜，一律列出来）

| # | 不确定的事 | 卡在哪 | 怎么坐实 |
|---|---|---|---|
| **U-1** | §3.3 的"`base_manager` 触发求解器就看到全部 12 基地"是**读代码推断**，未实跑 | 本单禁跑 datacore vitest / gate | 起内存模式 datacore（`SEED_DEMO=1`），以 `X-Debug-User: demo:u1:base_manager:常州` 调一次读 `Base` 的求解器，看返回里基地数是 1 还是 12 |
| **U-2** | ④-a 除 `datacore-http.ts` 外，`CatalogClient` 是否还有**内存/mock 实现**也需补 `outputShape` | 我只读了 HTTP 实现；`clients.ts` 注释提到"HTTP impl (OBO passthrough) or in-memory mock" | `grep -rn "solverRegistry" apps/agentcore/src apps/agentcore/test` 逐个实现补齐；**漏了 mock 会让测试与生产不同源**（本仓高频假绿源） |
| **U-3** | ②-b 若做 `propertyPolicy` additive 是否需要 SQL 迁移（R9 四处） | 未读 `apps/datacore/src/repo/pg.ts` 的 `policies` 落法 | 读 `repo/pg.ts` 对应 `put` + `migrations/*.sql`：整 doc JSON 列 → 无需迁移；逐列展开 → 需要 |
| **U-4** | `mergeResourcePackage`/`compileWithResourcePackage` 零调用方，**是欠账还是有意留的扩展点** | 全仓 grep（含 test、含 `.mjs`）确认零调用方 [实测]，但**动机**读不出来 | 查 `git log -S mergeResourcePackage` 找引入 commit 与 WO 号，判定是"接了一半"还是"P3 预留" |
| **U-5** | ④-b 那 19 条 `reads` 与求解器**实际**读的类型是否一致 | 手抄表无门守；我未逐个求解器核对 | 这正是 D4 判据要建的门；落地时必须先跑一遍再决定"搬家不改值"是否成立（若已漂，则搬的是错值） |
| **U-6** | ①-c 中 `Process.capacity` 等属性缺失的具体波及面 | `deriveSolverArgs` 作用于 **plan 的 objectTypes**（故事建出的域），是否会撞上出厂本体的 `Process`，取决于 plan 是否复用同名 typeKey | 造一个含 `Process` 的故事跑 `POST /a/v1/databuilder/runs`，看 `gapAnalysis`/`args` 里 `capacityField` 绑到了什么 |

---

## 10. 对既有两份文档的更新与更正

> `docs/ONTOLOGY-7ELEM-AUDIT.md`（基准 `d4be4224`）的**结论方向我复核后基本成立**。以下 6 条是在 `c0b7ee0d` 上的更新/更正。

| # | 既有稿 | `c0b7ee0d` 实况 | 影响 |
|---|---|---|---|
| **1** | §5.1(b)「`projectSolvers` 不填 `inputSpec`/`outputSpec`」→ 据此把 ④ 的 `outputSpec` 修法定为"投影层填上" | **只对了一半。** `outputShape` 的真正丢弃点在更上游：`app.ts:2685` **已返回**，`datacore-http.ts:373-382` 的 map **丢掉了**（`clients.ts:196-199` 类型也没有）。`projectSolvers` 就算想填也**拿不到** | **改变修法与工作量**：从"投影层补一处"变成"接缝透传三处"；也把本条从"造签名"降级为"别丢字段"，是四项里最便宜的一项 |
| **2** | §5.1(c)「`buildResourcePackage` …是真路径，不是死代码」 | 成立，**且需补一句关键限定**：`qos.dril-routing` `defaultOn:false`，但 **demo 租户 override 为 true**（`seed.ts:65`） | 不补这句，读者会以为"暗发=没人用"而低估 ④ 的优先级。**这是 ④ 从 P2 升到 P0 的直接依据** |
| **3** | §5.1(e)「`SOLVER_KEYS` 实测 57」 | HEAD 实测 **59**（两日内新增 `chain_loss_attribution`、`chain_impediments`） | 覆盖率 19/57 → **19/59**；同时**实证了"无门守增长"**这一论点 |
| **4** | §8 U2「`SolverService.loadContext` 的全部读法未穷举」（列为不确定） | **已坐实**：`loadContext:4003` 不收 `AuthCtx`，17 处调用方仅 1 处传 `visibleOrders`，且那一处也只过滤 `Order` → **行级在求解器面覆盖 1/10 核心类型** | **把条②的前提掉了个头**：不是"先补列级顺手做寻址"，而是"行级先有洞"。②-a 升 P2、②-b 降 P3 |
| **5** | §2 条① 未查"这条写入路径今天有没有界面" | `grep -rln "OntoFlow\|SUBGRAPH_ENTITY\|EntityModeling" apps/frontend-shell/src` = **0** | ① 从"该修"进一步降为"**该删**"：无 UI → 无人正在丢数据 → 修的收益为零，而误导风险仍在 |
| **6** | §6.1 建议新增 4 条 §8 断点 | 至 `c0b7ee0d` **一条都未写入本体**（实测 §8 无 `G-ONTOLOGY-FIELD-SINK` / `G-SECURITY-COLUMN-LEVEL` / `G-ACTION-EFFECTS-UNDECLARED` / `G-SOLVER-ONTOLOGY-SIGNATURE`）；§2.E 求解器计数、§2.D 三态账两处存量过期同样未回写 | 本单 §7.5 重新给出（并按新证据拆分/改名为 6 条），**留待落地单回写** |

**对 `docs/WO-69-ONTOLOGY-PRIMITIVES.md` 的一条方向性异议**（对既有盘点 §8 U5 的收口）：

> 该稿 §四主张严格顺序 **列级 Security → Function 签名 → Interface**，理由是"签名要说读 `Order.qty`，需要 `类型.属性` 寻址，列级正好要建同一套"。
> **这个论证在"属性级签名"这一层成立，但它把整条 ④ 都押在了 ② 后面。**
> 实测：④ 的两个活消费方要的是**类型级** `reads` 与 `outputShape`，**都不需要属性级寻址**。
> 而 ② 今天**零消费方**。
> **建议改为**：`④（类型级）→ ③ → ②-a 行级洞 → ②-b 列级 ⊕ ④（属性级，共用寻址地基）→ ①`。
> 即：把 `WO-69` 的顺序论证**限定在属性级那一段**，不要让类型级的 ④ 陪 ② 一起等。
