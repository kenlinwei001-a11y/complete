# ONTOLOGY-7ELEM-AUDIT · 本体七要素四缺口盘点（WO-ONTOLOGY-7ELEM 盘点阶段 · 欠账 #69）

> **本文只做盘点，不改代码、不改本体。** 目标：把「Interface 零 / Security 列级零 / Action 无回写声明 / Function 无本体签名」四条从**结论**做成**逐条证据 + 可施工清单**。
>
> **取证基准 commit：`d4be4224`**（`d4be42241d1b48e9d3bf2d52703489aa4a0c970a`，2026-08-04）。
> ⚠️ **本次盘点在一个多人共用的工作区里进行**：`git status` 显示 `apps/datacore/src/{app,rules,ruledsl,scheduler,livedin/engine,solvers/service,synthetic/battery,synthetic/service}.ts` 与 `packages/contracts/src/{datacore,base-registry}.ts` 有**他人未提交的在制品改动**。
> **本文所有 `file:line` 一律以 `git show HEAD:<路径>` 的已提交版本为准**（我在写作前逐条重跑校准过一遍；工作区脏版本的行号与此不同，例如 `PermissionPolicySchema` 在工作区是 366 行、在 HEAD 是 337 行）。审核方在**干净 worktree** 上核对即可对上。
>
> 前置：已完整读 `docs/SYSTEM-ONTOLOGY.md`（§0–§10）。已读既有稿 `docs/WO-69-ONTOLOGY-PRIMITIVES.md`，本文对其中三处取证做了**更正**（见 §7）。

---

## 0. 一页结论

| # | 缺口 | 三分法定性 | 一句话真相 | 最小可施工增量 |
|---|---|---|---|---|
| ① | **Interface**（对象类型的接口/能力抽象） | **没接线**（抽象本身零契约）<br>＋ 三个"接口残片"字段属**接了线接错地方**（写入被持久化窄门吞掉、读出方为零） | `ObjectTypeDef` 早就有 `functions`/`actions`/`entityCategory`/`security` 四个"接口味"字段（`domain.ts:278/280/284/282`），唯一写入方 `pipeline/subgraph.ts:54-57`，但 `ontology.ts:188 upsertType` 逐字段列举构造 `def` 时**一个都没抄**→ 永远落不了库；全仓零读出方（含 test）。今天替代接口的是**正则猜字段名**。 | 不造 `ObjectInterface` 一等对象。先把 A13 的**角色推断**升格为**可持久化的显式能力绑定**，并让"绑不上"从静默变成报错。 |
| ② | **Security 列级** | 读出路径 **没接线**（`AccessDecision` 只有 `rowFilters`）<br>＋ 两处既存列级机制分别是**接了线没数据**（`MaskRule.scopeRoles` 零消费方）与**接了线接错地方**（`ObjectTypeDef.security` 注释写"读出层应用"，实际连库都进不去） | `authz.ts:10-16` 的 `AccessDecision` 没有列维度；`ontology.ts:307-332 queryObjects` 原样返回 `o.props`。demo 只种 **7 条 policy 覆盖 4 个对象类型**，而 demo 有 **~91 个 ACTIVE 类型** → 其余走 `authz.ts:52-55` "no policy attached; default allow"。 | `PermissionPolicySchema` additive `propertyPolicy.denyRead`，**只接四个读出汇聚点**，语义=**删键不置 null**。写维/白名单留后续。 |
| ③ | **Action 回写声明** | **接了线没数据**（10 个内置 ActionType 里 9 个真写真值，只有 1 个有 effects 声明）<br>＋ 读出口**没接线**（`describeImpact` 零生产调用方，只有 test —— 假绿第 9 形态） | 契约齐全（`contracts/actions.ts:121/149/177`）、读出函数齐全（`actions.ts:332/454`）、SEAM 测试齐全，但：`BUILTIN_ACTION_EFFECTS`（`actions.ts:263`）**只有 1 条**；`app.ts` **无任何 impact 端点**；`POST /a/v1/action-types`（`app.ts:3091`）的 body zod **不收 effects**；`check-action-wiring.mjs` **五条断言无一看 effects**。 | 先接**读出口 + 诚实门**（暴露 impact 端点 + body 收 effects + 门加"WIRED 必须有 effects"断言），再逐条补声明。**不要先批量补 8 条声明**（那就是又一份会过期的手写清单）。 |
| ④ | **Function 本体签名** | **接了线没数据**（A 侧权威零签名，三个生产消费方恒拿 `undefined`）<br>＋ **接了线接错地方**（唯一真存在的 solver→类型签名，手抄在 B 侧镜像里，权威侧反而没有） | `ResourceInputOutputSchema{objectTypes,linkKeys,requiredProps,shape}`（`intelligence-resource.ts:39-46`）**形状恰好就是所要的签名**，但 `projectSolvers`（`resource-projector.ts:52-67`）**不填** `inputSpec`/`outputSpec`（同文件 `projectObjectTypes:236` / `projectFields:280` / `projectSkills:148` 都填）→ `relations.ts:98-108` 对 solver 恒返 `[]`、`resource-router.ts:80-82` 恒取不到 `outputShape`。 | 在 **A 侧**（权威侧）给 `SOLVER_CATALOG` additive `ontologySignature`，**先只搬 B 侧已手抄的 19 条**（搬家不改值），B 侧改为从 A 投影并删手抄表；`projectSolvers` 顺手填 `inputSpec/outputSpec`。 |

---

## 1. 取证纪律（怎么读本文）

**三分法定义**（本仓 CLAUDE.md 铁律 0.5；混了必修错地方）：

| 形态 | 判据 | 修法 |
|---|---|---|
| **没接线** | 符号的调用方集合里只有 test（或干脆没有该符号） | 接线 |
| **接了线没数据** | 有 src 调用方且在生产路径上，但输入恒空/恒 undefined，分支从未进入 | 补数据或删死分支 |
| **接了线接错地方** | 有 src 调用方，但挂在错误的路径上 | 补/改挂载点 |

**本文每条结论都追了至少一层**，并在正文里注明"追到哪、看到什么条件"。凡我只做到读代码、没有实跑坐实的，一律在 §8 显式列为**不确定**。

---

## 2. 条① Interface —— 对象类型没有接口/能力抽象

### 2.1 现状取证

**(a) 接口抽象本身：零契约。** 全仓（含 test、含 `docs/`）搜 `implementsInterface` / `interfaceKey` / `InterfaceDef` / `ObjectInterface` / `typeImplements` → 0 命中。`ObjectTypeDef`（`apps/datacore/src/domain.ts:262-293`）无 `implements` 类字段；`LinkTypeDef`（同文件 `:295-305`）亦无。这一条与 WO-69 §一-C 的结论一致，**我复核确认**。

**(b) 但本体里躺着四个"接口残片"字段 —— 且它们的病不是"没写"，是"写了落不了库"。**

`apps/datacore/src/domain.ts`：

```
:278   functions?: { name: string; returns: string; builtin?: string; expr?: string }[];   // 类型级函数（推演可调用）
:280   actions?: { actionTypeKey: string }[];                                              // 绑定的行动
:282   security?: { prop: string; strategy: "HASH"|"REDACT"|"PARTIAL"; scopeRoles?: string[] }[];  // 逐属性脱敏（读出层应用）
:284   entityCategory?: string;                                                            // 语义分类标签（人/传感器/银行卡）
```

这正好是"一个接口应当声明的东西"：**要求实现者具备的行为（functions）＋ 可施加的行动（actions）＋ 读出策略（security）＋ 语义分类（entityCategory）**。

**追第一层 —— 谁写？** 唯一写入方是 `apps/datacore/src/pipeline/subgraph.ts:22 buildTypeDefs`：

```
:54      functions: m.functions,
:55      actions: m.actions,
:56      security: m.security,
:57      entityCategory: m.entityType,
```

契约侧也齐：`packages/contracts/src/pipeline.ts:61 FnDefSchema` / `:95-97 EntityModelingSchema.{functions,actions,security}`。

**追第二层 —— 写进去了吗？没有。** `buildTypeDefs` 的产物经 `pipeline/service.ts:140-141` 交给 `ontology.upsertType`，而 `apps/datacore/src/ontology.ts:183 upsertType` 在 `:188` 起**逐字段列举**构造 `def`：

```ts
const def: ObjectTypeDef = {
  id, tenantId, key, displayName, domain,
  properties, derivedProperties, sourceBindings,
  version, status, published, deprecation,
};
await this.repos.ontologyTypes.put(def);   // ontology.ts:202
```

`functions` / `actions` / `security` / `entityCategory` / `storageMode` / `stateVariables` / `description` **七个字段全部被丢弃**。`repos.ontologyTypes.put` 的其余三处调用（`ontology.ts:214/243`、`ontology-governance.ts:177/201`）都是「读出既有记录改一两个字段再写回」，不构成新的写入通道。

**追第三层 —— 谁读？零。** `grep -rnE "\.(functions|actions|security|entityCategory)\b" apps/*/src packages/*/src` 对这四个字段**只命中 subgraph.ts 的写入行本身**；`apps/*/test`、`packages/*/test` 亦零命中。（`actionTypeKey` 的大量 grep 命中全部是 `ActionDraft.actionTypeKey`，同名不同物。）

**(c) 今天的替代物 = 结构信号 + 正则猜名。**

- `apps/datacore/src/solvers/field-roles.ts:29 SOLVER_FIELD_ROLES` + `:67 resolveFieldRoles`：用扇入/扇出 + 配置词库确定性猜"哪个类型是 resourceType、哪个字段是 priorityField"，真歧义时返回候选 + `ambiguous:true`。**这就是接口本该声明、现在只能推断的那件事。**
- **追一层：它接在哪？** 只接了一个**只读调试端点** `apps/datacore/src/app.ts:2736 GET /a/v1/solvers/:solverKey/field-roles`。`SolverService.invoke` **不用它** —— `solvers/service.ts:30` 只 import 了 `lexiconHit`，`resolveFieldRoles` 在 service.ts 里仅出现在 `:3494/:3496/:3515` 三处**注释**中。即：推断出的角色**没有喂回求解器的实际参数绑定**。
- 真正给通用求解器填参的是 `apps/datacore/src/databuilder/solver-args.ts:109 deriveSolverArgs` —— 正则匹配字段名：

```
:15   const CAPACITY_RE = /产能|capacity|cap|容量|上限|可用|额定/i;
:48   capacityField: (capProp ?? num(R)[0])!.propKey,   // ← 猜不中就取第一个数值字段
```

### 2.2 三分法定性

- **接口抽象本身：没接线**（零契约、零符号）。
- **四个接口残片字段（`functions`/`actions`/`security`/`entityCategory`）：接了线接错地方** —— 写入侧真实存在且在生产路径上（工作流发布），但**在持久化边界被 `upsertType` 静默吞掉**；读出侧一个都没有。这是最坏的一种：契约在、UI 契约在、写入代码在，看起来"这个能力有"，实际上从头到尾没有任何一个字节能走完全程。
- **A13 角色推断（`resolveFieldRoles`）：接了线接错地方** —— 挂在只读调试端点上，没挂在求解器参数绑定路径上。

### 2.3 影响面（具体的错，不是"不够完善"）

**错法一：静默给出 plausible-but-WRONG 的"一切正常"。**
`shared_bottleneck`（`apps/datacore/src/solvers/service.ts:981`）要求调用方用 6 个字符串手工把 typeKey/propKey 绑上去：

```
:985   const capacityField = args.capacityField ? str(args.capacityField) : "capacity";
:986   const demandField   = args.demandField   ? str(args.demandField)   : "qty";
:988   if (!resourceType || !sharedByType || !viaField) throw validationError(...)   // ← 只对三个必填报错
:1016  const capacity = res ? Number(res.props[capacityField]) : NaN;
:1020  if (Number.isFinite(capacity) && demand > capacity && demanders.length >= 2) { ...记为瓶颈... }
```

`capacityField` 绑错（或用了默认值 `"capacity"` 而该类型没有这个属性）→ `Number(undefined) = NaN` → `Number.isFinite` 假 → 该资源**永远不进瓶颈分支** → 输出 `bottlenecks: []` + `summary: "0 个共享瓶颈,0 张单争用,0 张被降级"`。**不报错，答案是"没有瓶颈"。**

这不是假设：出厂本体的 `Process`（`apps/datacore/src/synthetic/battery.ts:901 processProps`）**没有 `capacity` 属性**（它有 `yield/yield_baseline/shiftHours/shifts/attendance/utilization/channels/channelOutputDaily/agingSlots/agingDays`）。而它的第一个数值字段是 `yield`（0–1 的比率）—— 一旦经 `deriveSolverArgs:48` 的兜底路径，`Process` 的"产能"就会被判成 `yield`，然后拿它去和 Σ 需求比大小。

对照 `Line`：`max_capacity_day` 含 `capacity` 子串 → 命中 `CAPACITY_RE` → 绑对。**同一个平台里，绑对绑错取决于字段名有没有恰好包含 `capacity` 这个词。**

这与 §5 R-ARG-FIDELITY（"求解器缺过滤维不得静默返全域"）是同族病，但在**类型/字段绑定维**上，今天既无不变量也无门。

**错法二：新建业务域的能力不能复用。** 一个新对象类型要参与 `shared_bottleneck`/`concentration_risk`/`margin_attribution` 这类通用族，唯一途径是调用方在 args 里手填 typeKey/propKey，或者祈祷字段名撞上正则。类型自己**无法声明**"我具备被这类求解器消费的能力"。

### 2.4 最小可施工增量（只做一步的话）

**做"能力绑定"，不要先做 Interface 一等对象。**

理由：Interface 的价值大头在**行为继承**（WO-69 §四已论证），而行为继承需要 Function 签名先落（条④）。但**今天就在流血的**是"绑不上就静默答错"，这一步不需要等 Interface。

触及文件与形状：

1. `apps/datacore/src/domain.ts` · `ObjectTypeDef` additive（缺省 undefined = 逐字节沿用现状）：
   ```ts
   /** 能力绑定：本类型对哪些通用求解器角色可用，以及各角色落到哪个 propKey。
    *  role 名取自 field-roles.ts SOLVER_FIELD_ROLES 的角色词表，不另造命名空间。 */
   capabilities?: { capabilityKey: string; roleBindings: Record<string, string> }[];
   ```
   例：`{ capabilityKey: "shared_resource", roleBindings: { capacityField: "max_capacity_day" } }`
2. **`apps/datacore/src/ontology.ts:188` 必须同时修** —— 把 `capabilities` 加进 `def`。**不修这一处，新字段会重蹈 `security` 的覆辙**（见 §2.1(b)）。这是本增量里最容易漏、也最致命的一行。
3. `apps/datacore/src/solvers/service.ts:981 sharedBottleneck`：args 缺 `capacityField` 时先查本类型 `capabilities`；**args 与声明都没有 → 抛 `validationError`（或返回显式 `AMBIGUOUS_BINDING`），不许再落 `"capacity"` 这个默认值**。
4. `apps/datacore/src/databuilder/solver-args.ts:48`：兜底 `?? num(R)[0]` 改为「有 `capabilities` 声明取声明；没有则**不产出该 arg**（让 3 去报错）」。
5. 仓储四处（R9）：`ObjectTypeDef` 存的是 doc 列 / structuredClone，**大概率无需迁移**，但需实测确认（见 §8 不确定项 U1）。

### 2.5 验收判据（效果层）

| # | 判据 | 变异反证（必须变红） |
|---|---|---|
| A1 | 给 `Line` 声明 `capabilities:[{shared_resource, {capacityField:"max_capacity_day"}}]` 后，`shared_bottleneck` **不传 `capacityField`** 的输出与**传了**的输出**逐字节相同** | 让声明不生效（读不到）→ 两者不同 → 红 |
| A2 | 把声明指向一个**不存在**的 propKey → 求解器**报错**，而不是返回 `bottlenecks: []` | 保留 NaN 静默路径 → 红（这是本条的头号判据） |
| A3 | **落库真验**：`POST` 一个带 `capabilities` 的类型 → `GET /a/v1/ontology/object-types` 响应里**读得回来** | 只改 `domain.ts` 不改 `upsertType:188` → A3 红（专门堵 `security` 那个坑复发） |
| A4 | 不声明 `capabilities` 的既有类型行为**逐字节不变** | 缺省变成"必须声明否则拒绝" → 红（向后兼容底线） |

---

## 3. 条② Security —— 有行级（A6），列级/字段级为零

### 3.1 现状取证

**(a) 契约与执行都只有行维度。**

- `packages/contracts/src/datacore.ts:337 PermissionPolicySchema`：`resource{kind∈[OBJECT_TYPE,CONNECTION,RULE_SET,ACTION_TYPE], key}` + `grants[{role, ops∈[READ,WRITE,EXECUTE]}]` + `:350 rowFilter?: string`。**`kind` 四值无属性档；无任何列级字段。**
- `apps/datacore/src/authz.ts:10 AccessDecision` = `{allowed, matchedPolicies, rowFilters: string[], reason}` —— **只有 rowFilters**。`:91 rowAllowed(ctx, rowFilters, props)` 返回 `boolean`（整行去留），**不是投影**。

**(b) 读出路径原样返回全部列。** `apps/datacore/src/ontology.ts:307 queryObjects`：

```
:314   const rowFilters = await this.authz.require(ctx, "OBJECT_TYPE", objectType, "READ");
:318     .filter((o) => this.authz.rowAllowed(ctx, rowFilters, o.props))
:324   data: visible.map((o) => ({ id: o.id, type: o.type, props: o.props })),   // ← props 整份返回
```

`rowAllowed` 的所有调用点（`ontology.ts:318/383/404`、`ontology-core.ts:579`、`timeseries.ts:382`、`ontology-governance.ts:690`、`livedin/bundle.ts:40/110`）**无一处做列投影**。

**(c) WO-69 §一-A 的 grep 漏了两处真实存在的列级机制 —— 必须更正。**

原稿写「全仓 grep `maskedProps`/`hiddenProps`/`allowedProps`/`propMask`/`columnPolicy` → 0 命中」。这五个名字确实 0 命中，但本仓的列级机制**不叫这些名字**：

- **机制一 · `MaskRule`（写入期脱敏，且 `scopeRoles` 是死字段）**
  `packages/contracts/src/pipeline.ts:31 MaskRuleSchema = { prop, strategy∈[HASH,REDACT,PARTIAL], scopeRoles?: string[] }`
  `apps/datacore/src/pipeline/processing.ts:50 applyMask` ← 由 `:103 applyMask(props, spec.masking)` 在 `runProcessing` 里调用。
  **追一层看条件**：`applyMask`（`:50-58`）的函数体**没有任何 ctx / 角色参数**，`scopeRoles` 在整个函数里**从未被读**。全仓 `scopeRoles` 的 src 命中只有两处**声明**（`contracts/pipeline.ts:34`、`domain.ts:282`），零消费方。
  → 语义上这是**写入期一次性破坏性脱敏**（值在物化时就被改成 `***`/`h:xxx`），不是读出期按角色脱敏；`scopeRoles` 属**接了线没数据**（有契约、能落盘、永不生效）。
- **机制二 · `ObjectTypeDef.security`（注释白纸黑字写"读出层应用"）**
  `apps/datacore/src/domain.ts:282`，写入方 `pipeline/subgraph.ts:56`，**持久化被 `ontology.ts:188` 吞掉**，读出方零。详见 §2.1(b)。属**接了线接错地方**。

**(d) 覆盖面数据。** `apps/datacore/src/synthetic/service.ts:1674 seedPolicies` 一共种 **7 条 policy**，覆盖 **4 个对象类型**：`Base`×2 / `Order`×2 / `Model`×1 / `Line`×2（其中 3 条带 `rowFilter`，全部形如 `Object.baseId IN ${user.attributes.baseScope}`）。
demo 的 ACTIVE 对象类型数是 **~91**（金值见 `apps/datacore/test/demo-chain-provenance.test.ts:31-40` 的逐条累加注释）。其余 ~87 类在 `authz.ts:52-55` 命中 **"No policy attached … default allow"**。

### 3.2 三分法定性

- **列级读出：没接线** —— 契约无该维度，`AccessDecision` 无该维度，读出汇聚点无投影逻辑，无 test。
- **`MaskRule.scopeRoles`：接了线没数据** —— 契约在、能落盘、`applyMask` 在生产路径上被调用，但该字段在函数体里从未被读，分支从未存在。
- **`ObjectTypeDef.security`：接了线接错地方** —— 写入挂在工作流发布路径上，但被持久化窄门截断。

> 三者修法完全不同：列级要**新建**（契约 + 执行点）；`scopeRoles` 要么**补角色判定**要么**删死字段**；`ObjectTypeDef.security` 要么**修 `upsertType:188` 让它落库并补读出**要么**删掉**（留着最危险 —— 下一个人会以为列级已经有了）。

### 3.3 影响面（具体的错）

**场景一（可当场复现）：`base_manager:常州` 看得到全部客户的授信与逾期。**
`Customer` 定义在 `apps/datacore/src/synthetic/battery-extended.ts:114`：
`custId / custName / creditLimit / termDays / receivables / wipUnbilled / maxOverdueDays`。
`Customer` **不在 seedPolicies 的 4 个类型里** → `authz.decide` 走 default allow → `GET /a/v1/objects?type=Customer`（`app.ts:2314`）返回全部 8 个客户的**全部 7 列**，含授信额度、应收、最大逾期天数。行级权限在这里**一行都拦不住**（因为压根没有 policy），而即使补一条行级 policy，也只能限制"看哪些客户"，**没有任何机制能表达"看得到客户但看不到 creditLimit"**。

**场景二：连"在 UI 层藏列"这个下策都不成立。**
`app.ts:2314 GET /a/v1/objects` 的全文检索：

```
:2323   rows = rows.filter((o) => JSON.stringify({ id: o.id, ...o.props }).toLowerCase().includes(needle));
```

即使前端不渲染 `creditLimit`，用它的值当 `?q=` 依然能命中该行 —— **值仍然在响应里、且可被检索**。列级必须落在读出层，UI 层遮挡是无效的。

**场景三：求解器路径是第二个绕过点。** `SolverService.loadContext` 读对象走的是仓储/查询路径，即便将来只在 REST 层加列级过滤，求解器上下文仍会读到全列（这正是 WO-69 §八 S3 点名的高频病）。本次盘点**未逐行核实 `loadContext` 的全部读法**，列为不确定项 U2。

**与用户原话的对应**：「Agent 不能改"别人的数据"」——在**行**维度今天有保证（A6 rowFilter + R4 Action 审批），在**列**维度今天**零保证**：既不能限制读到哪些列，也不能限制写哪些列。

### 3.4 最小可施工增量

**只做"读维 + 黑名单"一维**（写维、白名单、`ActionType` 协同全部留后续）：

1. `packages/contracts/src/datacore.ts:337 PermissionPolicySchema` additive：
   ```ts
   /** 列级（属性级）读策略。缺省不配 = 逐字节沿用现状（向后兼容硬要求）。 */
   propertyPolicy: z.object({
     /** 不可读属性：命中的属性从结果里**删键**（不是置 null —— 置 null 会被下游读成"业务上没有值"，那是伪造数据）。 */
     denyRead: z.array(z.string()).optional(),
   }).optional(),
   ```
2. `apps/datacore/src/authz.ts`：`AccessDecision` 加 `deniedProps: string[]`（多条 policy 取并集）；新增 `projectProps(deniedProps, props)` 纯函数（删键）。
3. **四个读出汇聚点接上**（先只接读，写维不动）：`ontology.ts:318`（queryObjects）、`ontology.ts:383/404`（列表/单取）、`ontology-core.ts:579`（切片）、`SolverService.loadContext`（求解器上下文 —— **这一处是本增量的成败手**，见 §3.5 A3）。
4. 仓储：`PermissionPolicy` 落 doc 列，预计无迁移；需实测确认（U1）。

**刻意不做**：`writable/denyWrite`、`readable` 白名单、`resource.kind` 加 `PROPERTY` 档。理由：写维需要同时改 Action 提交/执行、对象 PATCH、求解器回写四条路，与条③强耦合，一单做完必然只接一半（本仓高频病）。

### 3.5 验收判据（效果层）

| # | 判据 | 变异反证 |
|---|---|---|
| B1 | 给 `Customer` 配 `denyRead:["creditLimit"]` 并授 `base_manager` READ → 该角色 `GET /a/v1/objects?type=Customer` 的响应 JSON 里**不存在 `creditLimit` 这个键** | 实现改成 `props.creditLimit = null` → B1 红 |
| B2 | 同一角色 `GET /a/v1/objects?type=Customer&q=<某客户 creditLimit 的字面值>` → **搜不到**（证明剔除发生在读出层而非渲染层） | 只在响应序列化处遮挡、检索仍走全 props → B2 红 |
| B3 | **求解器路径同受约束**：同一角色触发一个会读 `Customer.creditLimit` 的求解器 → 该值不可达 | 只接 REST 层不接 `loadContext` → B3 红（**头号判据**） |
| B4 | 未配 `propertyPolicy` 的既有 7 条 policy 行为**逐字节不变** | 缺省变成"全部不可读" → B4 红 |
| B5 | `admin` 短路分支（`authz.ts:43-47` 租户超管全量访问）与列级的关系被显式判定并测到（是豁免还是同样受限，**必须有一个明确答案而不是没想过**） | 无该用例 → 视为未做 |

---

## 4. 条③ Action 无回写声明

### 4.1 现状取证 —— 先读懂 `G-ACTION-NOOP-EXEC` 这张账

本体 §8 `G-ACTION-NOOP-EXEC` 记的是**执行侧**的病（审批走完、真值零写、返回假单号 `MO-2026-xxxx`）。它已经被一道门堵住：`scripts/check-action-wiring.mjs`（本体 §7 已登记，已并入 `pnpm gates`），五条断言把每个已注册 ActionType 逼进 `WIRED` / `NO_WRITE` / `NOT_IMPLEMENTED` 三态之一，兜底执行器换成 `apps/datacore/src/actions.ts:83 UnwiredActionExecutor`（诚实失败，不再回假单号）。

HEAD 上的三态账（`apps/datacore/src/actions.ts:35-60 ACTION_WIRING`，共 10 条）：

| 状态 | 数量 | 键 |
|---|---|---|
| `WIRED`（真写真值） | **9** | `AOP情景拍板`、`校准参数变更`、`定稿月度计划版本`、`计划版本变更`、`对象数据变更`、`流水线发布物化`、`plan_change`、`采纳产能保障方案`、`adopt_mitigation` |
| `NOT_IMPLEMENTED` | **1** | `采纳经营方案` |
| `NO_WRITE` | **0**（`actions.ts:71 NO_WRITE_RATIONALE` 为空对象，注释说明这是现状事实而非疏漏） |

**⚠️ 本体 §2.D 与 §8 的这张账已过期**：本体仍写「`adopt_mitigation`/`采纳经营方案`/`采纳产能保障方案`/非 global-sim 的 `plan_change` **四型**落 `MockActionExecutor` 实际零回写」。HEAD 上只剩 `采纳经营方案` 一条，且兜底执行器已不是 `MockActionExecutor`。（见 §6 建议回写。）

**"回写声明"这条缺口，与上面那张账是正交的另一半：**

- **契约齐全**：`packages/contracts/src/actions.ts:121 ActionEffectSpecSchema{writes[], coverage∈[COMPLETE,PARTIAL,NONE], undeclared[]}`，挂在 `:149 ActionType.effects?`；纯函数读出口 `:177 actionWriteTargets` / `:190 actionEffectCoverage`。`ActionEffect` 的 `objectType`/`properties` 明确复用本体既有 `typeKey`/`propKey` 命名（`:76-79` 注释），不造第二套命名空间。**契约设计本身是对的。**
- **数据面：`apps/datacore/src/actions.ts:263 BUILTIN_ACTION_EFFECTS` 只有 1 条** —— `plan_change`（且 `coverage: "PARTIAL"`，`undeclared` 诚实交底 `runDerivations` 的二阶写入枚举不了）。
  → **9 个 WIRED（真在写真值）里，8 个没有任何回写声明。**
- **读出面：`describeImpact` 零生产调用方。**
  - `apps/datacore/src/actions.ts:332 describeActionImpact` / `:454 ActionService.describeImpact`。
  - **追一层**：`app.ts` 里 `impact` 的全部命中是 `:1827 /a/v1/meta/impact`（元本体）、`:1933 /a/v1/boundary/impact`（边界册）、`:2240 governance.publishImpact`（本体发布）、`:2429`（外部信号敏感性）—— **没有任何 action impact 端点**。
  - `apps/agentcore/src` + `apps/frontend-shell/src` 搜 `effects` / `actionImpact` / `writeTargets` → **0 命中**。
  - 唯一调用方：`apps/datacore/test/action-type-evolution.test.ts:126/146/224`。
  → 这正是 CLAUDE.md 点名的**假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：实现有、测试有、且是绿的，零生产调用方 —— 测试咬的是函数不是链路。**
- **登记面：租户根本注册不进 effects。** `apps/datacore/src/app.ts:3091 POST /a/v1/action-types` 的 body zod 只收 `{key, name, paramsSchema, checkRules, approvalChain}` —— **不含 `effects`，也不含 `version` / `selfApproveAllowed`**。而 `actions.ts:459 registerType` 用 `...type` 展开、是能存的。
  → `actions.ts:261` 注释写的「租户经 `POST /a/v1/action-types` 注册的 `effects` 优先级高于本表」这句话，**在 REST 面上今天不成立**。
- **门面：无门守。** `scripts/check-action-wiring.mjs` 五条断言（①三态归类 ②WIRED 必有 domainExecutor 分支 ③兜底不得是 MockActionExecutor ④与 mapping.ts 写回声明不得打架 ⑤NO_WRITE 必须签实名理由）—— 搜 `effects` → **0 命中**。没有任何门在管"真写真值的动作有没有声明它写什么"。
- **业务侧另有一份不可机读的登记**：`apps/datacore/src/mapping.ts:84 ACTION_TYPE_REG` 的 `target` 字段是自由文本（如 `"生产工单MO（写回）"`），且条目名与 ActionType key **不是 1:1**（`预警处置方案` vs `adopt_mitigation`，`actions.ts:48-49` 已诚实注明这一点）。门的断言④只用它做"不得标 NO_WRITE"的反向校验，不能当签名用。

### 4.2 三分法定性

- **声明数据：接了线没数据** —— 机制全通（契约 + 内置表 + 解析函数 + SEAM 测试），但 `BUILTIN_ACTION_EFFECTS` 只有 1/10，8 个真写真值的动作是空的。
- **读出口：没接线** —— `describeImpact` 的调用方集合里**只有 test**。
- **登记口：接了线接错地方** —— 服务层 `registerType` 能存 effects，REST 层 body schema 把它挡在门外。

### 4.3 影响面（具体的错）

**审批人在批准前无法知道会写什么，只能读执行器源码。**
以 `采纳产能保障方案` 为例：`ACTION_WIRING` 标 `WIRED`（`actions.ts:45`，注释说明它"杠杆落成本体属性真值 + runDerivations"），审批链走完会**真的改本体对象属性**。但：`BUILTIN_ACTION_EFFECTS` 里没有它 → `describeActionImpact` 返回 `coverage: NONE`（按契约语义 = **"根本没声明"，不是"无副作用"**）→ 而且这个结果**根本没有出口**（无端点、无 UI、无 agent 工具）。审批人在界面上看到的只有 payload。

`G-ACTION-NOOP-EXEC` 的教训是「审批链走完、审计留痕齐全，真值一个字节没动 —— 绿状态 ≠ 生效」。**它的对称面同样成立且今天正在发生：真值动了，但没有任何人能在批准前知道动了什么。** 前者已经有门堵，后者一道门都没有。

**次生影响**：铁律 0 的核心问题「改 X 会影响什么」在 Action 维度答不出来。`GET /a/v1/meta/impact`（元本体 BFS）能答"改哪条链路影响谁"，但**答不了"批准这个 Action 会动到哪些对象的哪些属性"** —— 那份数据只在 8 个执行器分支的源码里。

### 4.4 最小可施工增量

**关键判断：不要先批量补那 8 条 effects 声明。**
理由有二：(1) 补完之后仍然零消费方，等于把死代码从 1 条扩到 9 条；(2) 手写清单必然过期 —— 本仓已有多例，而且今天**没有任何门**能发现它过期了。

**先接读出口 + 立门，让缺口可计数、可拦截；再逐条补声明（每补一条立刻有消费方）。** 三处改动：

1. **`apps/datacore/src/app.ts`** 新增（紧邻 `:3090` 的 action-types 段）：
   ```
   GET /a/v1/action-types/:key/impact   →  actions.describeImpact(ctx, key)
   ```
   把已经"排练好"的 `describeImpact`（`actions.ts:454`）接上生产线。
2. **`apps/datacore/src/app.ts:3094-3103`** body zod 补：
   ```ts
   effects: ActionEffectSpecSchema.optional(),
   ```
   （让 `actions.ts:261` 那句"租户注册优先"成为事实。`version` / `selfApproveAllowed` 同属该缺口，可一并补，但不是本增量必需。）
3. **`scripts/check-action-wiring.mjs`** 加**断言⑥**：
   > 每个标 `WIRED` 的**已注册内置**键，必须在 `BUILTIN_ACTION_EFFECTS` 有条目且 `coverage !== "NONE"`；否则红并打印键名。
   棘轮式落地：先把当前 8 个缺口写进 baseline（**只降不升**），新增 WIRED 动作必须带声明。这样既不阻塞现状，又让欠账从"看不见"变成"账上有数、且不可增长"。

**为什么这一步最值**：它把一个**不可见、无人负责、会静默增长**的缺口，变成**可计数、可拦截、每补一条立刻有消费方**的欠账。1 和 2 加起来大约几十行；3 是纯脚本。

### 4.5 验收判据（效果层）

| # | 判据 | 变异反证 |
|---|---|---|
| C1 | 用 demo admin 真发一次某 WIRED 动作的 draft → **批准之前** `GET /a/v1/action-types/<key>/impact` 返回的 `writes[].{objectType, properties}`，与**批准之后**真实发生的对象变更**逐条对拍相等**（照 `action-type-evolution.test.ts:224` 已有的 `plan_change × GlobalSimPlanExecutor` 逐属性对拍 SEAM 同款做法） | 在 effects 里删掉一个实际会写的属性 → C1 红 |
| C2 | 给一个 WIRED 动作**故意不写** effects → `pnpm gates` **红**并打印该键 | 断言⑥ 只数数不判 coverage（`coverage:"NONE"` 也放行）→ C2 红 |
| C3 | 经 `POST /a/v1/action-types` 带 `effects` 注册一个租户动作 → `GET .../impact` 读得回来，**且优先于内置表** | body zod 仍不收 effects → C3 红（专门咬 §4.1 那句失实注释） |
| C4 | `coverage: "NONE"` 在 impact 响应里必须被表述为**"未声明（不知道 ≠ 无副作用）"**，不得渲染成"无副作用" | 把 NONE 显示成"无写入" → C4 红（契约 `actions.ts:118-119` 的诚实纪律） |

---

## 5. 条④ Function 无本体签名

### 5.1 现状取证

**(a) 契约早就存在，而且形状恰好就是所要的签名。**

`packages/contracts/src/intelligence-resource.ts:39`：

```ts
/** 输入/输出规格（§5.3）：读写的本体对象类型/链路/属性口径 + 输出顶层字段。 */
export const ResourceInputOutputSchema = z.object({
  objectTypes: z.array(z.string()).optional(),
  linkKeys: z.array(z.string()).optional(),
  requiredProps: z.record(z.string(), z.string()).optional(),
  shape: z.array(z.string()).optional(),
  example: z.unknown().optional(),
});
```

挂在基类 `:116-117 inputSpec / outputSpec`。**注释就写着"读写的本体对象类型/链路/属性口径"。**

**(b) 但 solver 那一路从不填。** `apps/agentcore/src/dril/resource-projector.ts:52 projectSolvers`（`:53-67`）产出 `{kind, key, label, description, answersQuestions, tags, argHints, domain, capability, isDeterministic, requiresSidecar, runtime}` —— **既无 `inputSpec` 也无 `outputSpec`**。

对照同文件其它投影：`:148-149 projectSkills` 两个都填；`:236 projectObjectTypes` 填 `inputSpec:{objectTypes:[t.key]}`；`:280 projectFields` 同理。**唯独 solver 空着。**

**(c) 追一层 —— 消费方在生产路径上，且恒拿到 undefined。**

- `apps/agentcore/src/dril/relations.ts:98 declaredObjectTypes` 读 `scopeObjectTypes ?? [] + includedTypes ?? [] + inputSpec?.objectTypes ?? []`。
  对 `kind:"solver"` 三者全 undefined → 恒返 `[]` → `:115 objectTypeRelations` 对 solver 恒返**零条边**。
  而同文件 `:21` 的抬头注释明写「`solver/slice --reads--> objectType`（inputSpec.objectTypes / includedTypes）」—— **这条边在结构上不可能产生**。（slice 同病：`:76 projectSlices` 把 `includedTypes` 硬置 `[]`，注释自陈"留 P3 从本体图补齐"。）
- `apps/agentcore/src/dril/resource-router.ts:80-82`：
  ```ts
  const shape = (base.results.find(...)?.resource as { outputSpec?: { shape?: string[] } })?.outputSpec?.shape;
  return shape ? { key: k, outputShape: shape } : { key: k };
  ```
  → **永远走 `{ key: k }` 分支**，agent 拿不到求解器输出形状。
  **再追一层确认它在生产路径上**：`ResourceRouter.buildResourcePackage` 由 `apps/agentcore/src/router/orchestrator.ts:82/403/415/1688` 在 path-B 组包时调用（feature `qos.dril-routing` 门后）。**是真路径，不是死代码。**
- `apps/agentcore/src/dril/resource-registry.ts:40-41`、`search-engine.ts:289-293`、`tag-taxonomy.ts:112` 同样读 `inputSpec.objectTypes`，对 solver 同样恒空。

**(d) 唯一真实存在的 solver→本体签名，手抄在 B 侧镜像里。**

`apps/agentcore/src/agent/navigation-slice.ts:31`：

```ts
/** 该 solver 读取的对象类型（用于 scope.objectTypes 相交判定：越界不投影）。 */
reads: string[];
```

`:76 SOLVER_CATALOG` 共 **19 条** `reads`（如 `gap_attribution: reads:["Metric","RootCauseChain","CausalFactor","Base"]`），被 `:303/:310/:330` 真消费（scope 相交、对象集派生），并经 `orchestrator.ts:1627` / `engine.ts:325` 进 path-B 生产路径。

**但该文件 `:22-24` 抬头自述**：「⚠ 输出形状**镜像** DataCore `solvers/service.ts SOLVER_OUTPUT_SHAPES`（权威在 A 侧·R1 不跨包共享实现）」。
→ 实情是：**A 侧权威根本没有 `reads` 这份数据，B 侧手写了一份"镜像"。** 无门守它与求解器实现一致，也无门守它随 `SOLVER_KEYS` 增长。

**(e) A 侧其它候选逐一排除（都不是本体签名）。**

| 位置 | 覆盖 | 为什么不算签名 |
|---|---|---|
| `packages/contracts/src/solver-args.ts:111 SOLVER_ARGS_SCHEMAS` | **11 / 57** | 字段类型是 `z.string()`/`z.number()` 这类原语。`targetOrderId: z.string()` 不说明它是 `Order.so` 还是 ref 到 `Order`。**无任何本体绑定。** |
| `apps/datacore/src/solvers/service.ts:235 SOLVER_OUTPUT_SHAPES` | 多数 | `string[]` 顶层 key。不说明"这一行是一个 `Order`"，也不说明数字量纲。 |
| `apps/datacore/src/catalog.ts:14 CatalogItem.argHints` | 全部 | `Record<string,string>` **自由文本**（如 `{modelId:"型号 ID，如 4680-NCM"}`），给人/LLM 读的提示。 |
| `apps/datacore/src/graphmeta.ts:52 SOLVER_GRAPH` | **8** | 每 solver 一个 `target` typeKey，仅供 `mapping.ts` 映射表展示。 |
| `apps/datacore/src/solvers/field-roles.ts:29 SOLVER_FIELD_ROLES` | **4** | 声明的是"需要哪些**角色**"，不是"读哪个类型的哪个属性"；且只接调试端点（见 §2.1c）。 |

`SOLVER_KEYS`（`solvers/service.ts:44-153`）实测 **57** 个。（本体 §2.E 仍写"38 个" —— 见 §6 建议回写。）

**(f) 全仓唯一带 `{typeKey, propKey}` 的签名，是 BuildPlan 的每次运行产物，且其真值源手写了 4 条、其中 2 条指向不存在的属性。**

- 契约：`packages/contracts/src/databuilder.ts:123 PlanSolverNeedSchema = { solverKey, inputFields: [{typeKey, propKey}], args?, renderBindings? }` —— **这就是本体术语的输入签名**。
- 消费方真实存在：`apps/datacore/src/databuilder/closure.ts:81-96` 的 FORWARD 闭包用 `propExists(typeKey, propKey)` 逐条校验，HARD 模式下缺失即拒发布（R12 正向闭包）。
- **但它的真值源是手写的 4 条**：`apps/datacore/src/databuilder/comprehend.ts:511-517 SOLVERS`：
  ```
  affected_orders     → Order.due, Order.qty
  capacity_forecast   → Base.gwh, Base.util
  shared_bottleneck   → Process.capacity, Order.qty
  margin_attribution  → Order.revenue, Order.rawCost
  ```
- **其中 3 个属性在出厂本体里不存在**（我逐条核对了属性表）：
  - `Process.capacity` —— `battery.ts:901 processProps` 无 `capacity`（有 `yield/yield_baseline/shiftHours/shifts/attendance/utilization/channels/channelOutputDaily/agingSlots/agingDays`）。
  - `Order.revenue`、`Order.rawCost` —— `battery.ts:861 orderProps` 无这两个（有 `so/cust/model/qty/due/pri/bases/status/demandDelta/outsourceRatio/creditUsedRatio/leadDays/unitPrice/businessType/early/earlyDue`，派生只有 `value = qty * unitPrice`）。
- **为什么没人发现**：`comprehend.ts:662` 的筛选条件是 `s.inputFields.every((f) => typeKeys.has(f.typeKey))` —— **只查 typeKey 存在，不查 propKey**；FORWARD 闭包只针对 plan 自己的 `objectTypes`（故事建出来的域），**管不到出厂本体**。

### 5.2 三分法定性

- **A 侧权威签名：接了线没数据** —— `ResourceInputOutputSchema` 契约在、`projectSolvers` 在生产路径上被调、三个消费方（`relations`/`resource-router`/`declaredObjectTypes`）在生产路径上被调，但 solver 那一路的 `inputSpec`/`outputSpec` **恒 undefined**，分支从未进入。
- **`navigation-slice.reads`：接了线接错地方** —— 数据真实、真被消费、在生产路径上，但**挂在 B 侧镜像上而非 A 侧权威上**，且只到 typeKey 级、无门守一致性。
- **`PlanSolverNeed.inputFields`：接了线没数据（在出厂本体这一面）** —— 机制齐全且被 FORWARD 闭包真消费，但它只在 BuildPlan 运行期存在，真值源是 4 条手写、且有 3 个属性指向不存在的字段而无人报错。

### 5.3 影响面（具体的错）

**错法一：铁律 0 的核心问题今天答不出来。**
`GET /b/v1/resources/solver/<key>/relations` 对任何 solver 返回的对象类型边**恒为空**（§5.1c）。所以「改 `Line.max_capacity_day` 会影响哪些求解器」这个问题，资源关系图**答得出 rule / slice / agent 三类，答不出 solver 一类**。而求解器恰恰是数字的产地 —— 这是影响分析里最该答上的一类。

**错法二：agent 拿不到输出形状，只能从自由文本猜结果字段。**
`resource-router.ts:80-82` 恒退化 → path-B 组包给 agent 的 solver 候选**不带 `outputShape`** → agent 只能读 `description`（自由文本）猜"结果里有哪些字段"。本体 §8 `G-2` 记录的正是这一族病（"plan 读 `data.rows/count`，真实返回 `affected/total` → 跨服务 FAIL"），今天在 DRIL 组包这条路上仍是敞开的。

**错法三：签名与实现不一致没有任何机制会发现。**
`navigation-slice.ts` 的 19 条 `reads` 是手写的，`SOLVER_KEYS` 是 57 个 —— **38 个求解器连手抄的签名都没有**，而且新增求解器时没有任何门要求补。`comprehend.ts:511-517` 那 3 个不存在的属性能一直躺着，正是同一个原因。

### 5.4 最小可施工增量

**把签名搬到 A 侧权威，且第一步"搬家不改值"。**

1. `apps/datacore/src/catalog.ts:14 CatalogItem` additive：
   ```ts
   /** 本体级签名：这个求解器读什么。typeKey/propKeys 必须能在已发布本体解析到。 */
   ontologySignature?: {
     reads: { typeKey: string; propKeys?: string[] }[];   // propKeys 省略 = 类型级（第一步只做到这一层）
     writes?: { typeKey: string; propKeys: string[] }[];  // 求解器多为只读；留位不填
   };
   ```
2. **只搬 B 侧已有的 19 条**（`navigation-slice.ts:76 SOLVER_CATALOG` 的 `reads`）到 `catalog.ts:47 SOLVER_CATALOG` 对应条目，**值逐字节不改**（R6 可对拍）。
3. `apps/agentcore/src/agent/navigation-slice.ts`：`reads` 改为从 A 侧目录投影，**删掉手抄表**（消灭第二份真值源；这一点是 WO-69 §六硬要求③"对齐而非重复"的直接兑现）。
4. `apps/agentcore/src/dril/resource-projector.ts:52 projectSolvers`：填
   `inputSpec: { objectTypes: sig.reads.map(r=>r.typeKey) }` +
   `outputSpec: { shape: SOLVER_OUTPUT_SHAPES[key] }`（形状已有权威，只是从没接到这里）。
   → **一次性把三个恒空消费方全部喂上真数据。**

**刻意分期**：`propKeys` 级（属性级签名）与"实跑比对"门留 P2 后续 —— 它需要一套稳定的 `类型.属性` 寻址与校验，与条②列级权限共用同一套地基（WO-69 §四已论证这个依赖方向，我复核后同意）。

### 5.5 验收判据（效果层）

| # | 判据 | 变异反证 |
|---|---|---|
| D1 | `GET /b/v1/resources/solver/gap_attribution/relations` 返回的 `reads` 边**非空**，且集合等于 A 侧声明（今天恒空） | A 侧删掉某类型 → D1 集合不等 → 红 |
| D2 | path-B 组包（`buildResourcePackage`）返回的 solver 项**带 `outputShape`**（今天恒无） | `projectSolvers` 不填 `outputSpec` → D2 红 |
| D3 | **单源红咬**：全仓只剩一份 solver→类型清单。静态断言 `navigation-slice.ts` 里**不存在**手写 `reads: [` 字面量 | 保留 B 侧手抄表 → D3 红 |
| D4 | **一致性红咬（类型级）**：对已声明的 19 个 solver，静态扫其实现里 `listByType("X")` / `objectsByType.X` 的类型字面量，与声明 `reads` 比对；**声明漏掉一个实际会读的类型即红** | 声明少写一个实际读的类型 → D4 红（这是本条的头号判据；没有它，签名就是又一份会过期的手写清单） |
| D5 | 签名里的 `typeKey` 必须能在出厂本体解析到 | 写一个不存在的类型 → D5 红（顺带堵住 §5.1f 那 3 个不存在属性的同族问题） |

---

## 6. 建议审核方回写本体的章节与内容

> 我**不改** `docs/SYSTEM-ONTOLOGY.md`（超出本单范围）。以下逐条给出"写到哪一节、写什么"。
> 前 4 条是本次盘点的**新增登记**；后 4 条是本次盘点顺带发现的**存量过期**，与四缺口无关但同样使本体失真。

### 6.1 §8 已知断点登记 —— 建议新增 4 行

| 编号 | 断点 | 链路位置 | 性质 |
|---|---|---|---|
| `G-ONTOLOGY-FIELD-SINK` | **本体类型的六个字段有写入方、无持久化**：`ObjectTypeDef` 的 `functions`/`actions`/`security`/`entityCategory`/`storageMode`/`stateVariables`（`domain.ts:278/280/282/284/274/276）由 `pipeline/subgraph.ts:54-57` 写入，但 `ontology.ts:188 upsertType` 逐字段列举构造 `def` 时全部丢弃 → 永远落不了库；读出方为零（含 test）。**契约在、UI 契约在、写入代码在，看起来"这个能力有"，实际零字节走完全程。** | 工作流发布：`buildTypeDefs → upsertType → ✗（字段被丢）→ ontologyTypes.put` | 🔴 未修（本次盘点登记） |
| `G-SECURITY-COLUMN-LEVEL` | **列级/字段级权限为零**：`PermissionPolicySchema`（`contracts/datacore.ts:337`）只有 `rowFilter`；`AccessDecision`（`authz.ts:10`）只有 `rowFilters`；`queryObjects`（`ontology.ts:324`）原样返回 `o.props`。既存两处列级机制均不生效：`MaskRule.scopeRoles`（`contracts/pipeline.ts:34`）零消费方（`processing.ts:50 applyMask` 无角色判定）；`ObjectTypeDef.security` 落入 `G-ONTOLOGY-FIELD-SINK`。demo 7 条 policy 覆盖 4/~91 类型，其余走 default allow（`authz.ts:52-55`）。`GET /a/v1/objects` 的 `q` 直接 `JSON.stringify(props)`（`app.ts:2323`）→ UI 层遮挡无效。 | 读出：`authz.decide → rowFilters → queryObjects → props（全列）` | 🔴 未修 |
| `G-ACTION-EFFECTS-UNDECLARED` | **9 个真写真值的 ActionType 里 8 个无回写声明，且唯一读出口零生产调用方**：`BUILTIN_ACTION_EFFECTS`（`actions.ts:263`）仅 1 条；`describeImpact`（`actions.ts:454`）只有 test 调用（假绿第 9 形态）；`POST /a/v1/action-types`（`app.ts:3091`）body zod 不收 `effects`，使"租户注册优先"（`actions.ts:261` 注释）失实；`check-action-wiring.mjs` 五条断言无一看 `effects`。**与 `G-ACTION-NOOP-EXEC` 是同一枚硬币的两面**：那条是"绿状态≠生效"，本条是"生效了但批准前没人知道生效什么"。 | 行动写回声明：`ActionType.effects → describeActionImpact → ✗（无端点/无 UI/无 agent 工具）` | 🔴 未修 |
| `G-SOLVER-ONTOLOGY-SIGNATURE` | **求解器无本体签名，权威侧空、镜像侧手抄**：`ResourceInputOutputSchema`（`intelligence-resource.ts:39`）形状齐全，但 `projectSolvers`（`resource-projector.ts:52`）不填 `inputSpec`/`outputSpec` → `relations.ts:98 declaredObjectTypes` 对 solver 恒 `[]`（使 `:21` 声明的 `solver --reads--> objectType` 边结构上不可能产生）、`resource-router.ts:80` 恒取不到 `outputShape`（两者均在 path-B 生产路径）。唯一真实签名是 B 侧手抄的 `navigation-slice.ts:31 reads`（19/57，仅类型级，无门守）。`PlanSolverNeed.inputFields`（`contracts/databuilder.ts:123`）是唯一 `{typeKey,propKey}` 形态，但真值源 `comprehend.ts:511-517` 只有 4 条手写、其中 `Process.capacity`/`Order.revenue`/`Order.rawCost` **在出厂本体里不存在**（筛选只查 typeKey 不查 propKey）。 | DRIL：`solver 目录 → projectSolvers（不填 spec）→ relations/router（恒空）→ agent 选型` | 🔴 未修 |

### 6.2 §2.D 行动/权限域 —— 三态账已过期

现文写「`adopt_mitigation`/`采纳经营方案`/`采纳产能保障方案`/非 global-sim 的 `plan_change` **四型**在 `domainExecutor` 无分支、落 `MockActionExecutor` 实际零回写」。
HEAD（`actions.ts:35-60`）实为：**9 `WIRED` + 1 `NOT_IMPLEMENTED`（只剩 `采纳经营方案`）+ 0 `NO_WRITE`**，兜底执行器已换成 `UnwiredActionExecutor`（`actions.ts:83`，诚实失败不回假单号）。
§8 `G-ACTION-NOOP-EXEC` 的状态描述同步更新（该行末尾的「并线复验补记」已记录 `adopt_mitigation` 转 WIRED，但表体本身未改）。

### 6.3 §2.E 求解/推演域 —— 求解器计数已过期

现文两处重复段均写「**Solver（SOLVER_KEYS，38 个）**」。HEAD 实测 `solvers/service.ts:44-153` = **57** 个。
（同段末尾另有 `SOLVER_KEYS 54→55（⚠ 与 WO-PORTFOLIO-OPTIMAL `portfolio` 双占 55·reviewer 合两条时 reconcile 到 56）` 的待办 —— 建议一并 reconcile 到实测值。）

### 6.4 §2.B 本体/对象域 —— demo 建模链路径与代码相反

现文写「**demo 本体经真建模链产出（轨L 增量2·R13 在建模层补断点）**：`seedDemoSynthetic` 不再 `runJob` 直注已发布类型+对象短路建模链，改 `viaModelingChain:true`」。
HEAD `apps/datacore/src/seed.ts:92` 实为 **`viaModelingChain: false`**（即走 A 路短路直注）。
`git log -S` 定位：commit `082186ef`（2026-07-14，标题「恢复工作区修改（vite proxy / seed fix / Phase2 扩展 / 本体同步）」）把 `true` 改成了 `false`，**而该行上方的注释仍在描述建模链路径**，本体也未同步。
→ 这条影响 R13 provenance 的一个具名主张（"类型 sourceBindings 真由 publish 读真 rawDataset 算出，非短路直注"）。**建议审核方先判定哪个是应然**（是代码回退了，还是本体写早了），再决定改代码还是改本体 —— 我不替这个决策下判断。

### 6.5 §7 检测/门禁 —— 建议追加一句射程说明

`ontology-anchors:check`（本体 §7 已详载）的扫描范围是 `scripts/check-ontology-anchors.mjs:41 ONTO_REL = "docs/SYSTEM-ONTOLOGY.md"` —— **只扫本体一篇**。
`prd:check` / `prd:coverage` 只扫 `docs/PRD-*.md`（`check-prd-ontology.mjs:39`、`check-prd-coverage.mjs:47`）。
→ **`docs/WO-*.md` / `docs/HANDOFF-*.md` 等文档里的 `file:line` 锚点无任何门守**，会静默漂移（实例见 §7）。建议在 §7 该门条目里明确写出这个射程边界，免得下一个人以为"锚点门管全 docs"。

---

## 7. 对 `docs/WO-69-ONTOLOGY-PRIMITIVES.md` 既有取证的三处更正

| # | 原稿 | HEAD 实况 | 影响 |
|---|---|---|---|
| 1 | §一-A：「`packages/contracts/src/datacore.ts:233-247` `PermissionPolicySchema`」 | 实为 **`:337-351`** | 锚点漂移，按原稿跳过去看到的是不相干代码 |
| 2 | §一-B：「最接近的是 DRIL 的 `ResourceInputOutput`（`intelligence-resource.ts:35`）」 | 实为 **`:39-46`** | 同上 |
| 3 | §一-A：「全仓 grep `maskedProps`/`hiddenProps`/`allowedProps`/`propMask`/`columnPolicy` → **0 命中**」→ 据此判"列级完全没有" | 这五个名字确实 0 命中，**但本仓的列级机制不叫这些名字**：`MaskRule{prop,strategy,scopeRoles}`（`contracts/pipeline.ts:31`）+ `applyMask`（`processing.ts:50`）+ `ObjectTypeDef.security`（`domain.ts:282`，注释写"读出层应用"） | **这是"grep 的结果不是结论"的一次实例**。真相不是"零"，而是**两种不同的"不工作"**：`scopeRoles` 是接了线没数据（零消费方），`ObjectTypeDef.security` 是接了线接错地方（被 `upsertType` 吞掉）。三者修法完全不同 —— 尤其 `ObjectTypeDef.security` **留着比没有更危险**（下一个人会以为列级已经有了）。 |

> 原稿的**结论方向**（列级为零、Function 无签名、Interface 不存在）我复核后**全部成立**；更正的是取证细节与"零"的具体形态。

---

## 8. 不确定项与卡点（不猜）

| # | 不确定的事 | 卡在哪 | 建议怎么坐实 |
|---|---|---|---|
| **U1** | 给 `ObjectTypeDef` / `PermissionPolicy` 加 additive 字段是否需要 SQL 迁移（R9 四处） | 我未读 `apps/datacore/src/repo/pg.ts` 的这两张表落法。若是整 doc JSON 列则无需迁移，若是逐列展开则需要 | 读 `repo/pg.ts` 对应 `put` 实现 + `migrations/*.sql`；一次 grep 即可判定（本单禁跑测试，故未验） |
| **U2** | `SolverService.loadContext` 读对象的**全部**路径 | 我核实了 `queryObjects`/`executeSlice`/`listByType` 三类读法，但没有逐行穷举 `loadContext` 及其下游（`ctx.objectsByType` 的所有填充点） | 条②的 B3 判据就是为此设的 —— **必须交出读写路径穷举清单**，不能靠读代码下结论（WO-69 §五已立此要求） |
| **U3** | 「`upsertType` 丢弃 `ObjectTypeDef.description` → `projectObjectTypes` 恒走 `descriptionSynthesized` 兜底」 | 这是**逐行读三处代码**得出的（`battery.ts:2092-2097 plainD` 带 description → `synthetic/service.ts:643 upsertType` → `ontology.ts:188` 不抄 → `ontology.ts:128 listTypes` 从库读 → `resource-projector.ts:227-233`）。**我未实跑坐实**（本单禁跑测试） | 起一次内存模式 datacore（`SEED_DEMO=1`），`curl /a/v1/ontology/object-types` 看返回里有没有 `description`。若确认，则 `ontology-descriptions:check` 是又一形态的假绿：**门读的是 dist 里的 `batteryObjectTypes()` 静态源，运行时读的是库，两者之间隔着一个丢字段的窄门** |
| **U4** | 属性级 `description`/`unit` 在 demo 里是否幸存 | 取决于 demo 走 A 路还是链路。HEAD `seed.ts:92` 是 `viaModelingChain:false` → 走 A 路 → `upsertType` 的 `properties: input.properties` 整份透传 → **属性级应当幸存**（只有类型级 `description` 被丢）。但若 §6.4 那个 flag 被改回 `true`，则 `buildCuratedSuggestionObjectTypes`（`synthetic/service.ts:1170` 起）只映射 `{propKey,sourceField,dataType,isPrimaryKey,refToTypeKey}`、`modeling.ts:433 publishDraft` 只重建 `{propKey,dataType,isPrimaryKey,refToTypeKey,searchable}` → **属性级 `description`/`unit`/`displayName` 也会全丢** | 与 §6.4 的判定绑定处理。若决定改回链路，必须同时补这两处的字段透传，否则 DF.5 语义目录 + 资源目录 field 量纲会整体失效 |
| **U5** | WO-69 §四主张的严格顺序「列级 Security → Function 签名 → Interface」 | 我的取证**支持**"Interface 排最后"（行为继承依赖 Function 签名），也**支持**"属性级签名与列级权限共用 `类型.属性` 寻址地基"。但我的证据同时显示：**条①里流血最狠的那一处（`solver-args.ts:48` 猜不中就取第一个数值字段 → 静默答"无瓶颈"）不依赖前两条**，可以独立止血 | 这是排期决策，不是取证结论，交审核方判。我的建议：把条①拆成「**能力绑定止血**（可立即做，独立）」与「**Interface 一等对象**（排最后）」两件事，不要因为后者排最后而让前者跟着等 |

---

## 9. 附：本次盘点用到的全部锚点（相对 `d4be4224`，逐条经 `git show HEAD:<路径>` 校准）

**条① Interface**
`apps/datacore/src/domain.ts:262`(ObjectTypeDef) `:274`(storageMode) `:276`(stateVariables) `:278`(functions) `:280`(actions) `:282`(security) `:284`(entityCategory) ·
`apps/datacore/src/pipeline/subgraph.ts:22`(buildTypeDefs) `:54-57` ·
`apps/datacore/src/pipeline/service.ts:140-141`(publish) ·
`apps/datacore/src/ontology.ts:183`(upsertType) `:188`(def 构造) `:202`(put) ·
`packages/contracts/src/pipeline.ts:61`(FnDefSchema) `:95-97`(EntityModelingSchema) ·
`apps/datacore/src/solvers/field-roles.ts:29`(SOLVER_FIELD_ROLES) `:67`(resolveFieldRoles) ·
`apps/datacore/src/app.ts:2736`(GET field-roles) ·
`apps/datacore/src/solvers/service.ts:981`(sharedBottleneck) `:985-988` `:1016` `:1020` ·
`apps/datacore/src/databuilder/solver-args.ts:15`(CAPACITY_RE) `:31`(deriveSharedBottleneck) `:48`(兜底) ·
`apps/datacore/src/synthetic/battery.ts:901`(processProps)

**条② Security 列级**
`packages/contracts/src/datacore.ts:337`(PermissionPolicySchema) `:350`(rowFilter) ·
`apps/datacore/src/authz.ts:10`(AccessDecision) `:43-47`(admin 短路) `:52-55`(default allow) `:91`(rowAllowed) ·
`apps/datacore/src/ontology.ts:128`(listTypes) `:307`(queryObjects) `:314` `:318` `:324` ·
`apps/datacore/src/app.ts:2314`(GET /a/v1/objects) `:2323`(q 全文检索) ·
`packages/contracts/src/pipeline.ts:31`(MaskRuleSchema) `:34`(scopeRoles) `:45`(ProcessingSpec.masking) `:97`(EntityModeling.security) ·
`apps/datacore/src/pipeline/processing.ts:50`(applyMask) `:103` ·
`apps/datacore/src/synthetic/service.ts:1674`(seedPolicies) ·
`apps/datacore/src/synthetic/battery-extended.ts:114`(Customer) ·
`apps/datacore/test/demo-chain-provenance.test.ts:31-40`(类型金值)

**条③ Action 回写声明**
`packages/contracts/src/actions.ts:121`(ActionEffectSpecSchema) `:149`(ActionType.effects) `:177`(actionWriteTargets) `:190`(actionEffectCoverage) ·
`apps/datacore/src/actions.ts:35`(ACTION_WIRING) `:71`(NO_WRITE_RATIONALE) `:83`(UnwiredActionExecutor) `:261`(注释) `:263`(BUILTIN_ACTION_EFFECTS) `:313`(resolveActionEffects) `:332`(describeActionImpact) `:454`(describeImpact) `:459`(registerType) ·
`apps/datacore/src/app.ts:3090`(GET action-types) `:3091-3105`(POST action-types) ·
`apps/datacore/src/mapping.ts:84`(ACTION_TYPE_REG) ·
`scripts/check-action-wiring.mjs`（五条断言，无 effects） ·
`apps/datacore/test/action-type-evolution.test.ts:126/146/224`

**条④ Function 本体签名**
`packages/contracts/src/intelligence-resource.ts:39`(ResourceInputOutputSchema) `:116-117`(inputSpec/outputSpec) `:130`(SolverResourceSchema) ·
`apps/agentcore/src/dril/resource-projector.ts:52`(projectSolvers) `:76`(projectSlices) `:148-149`(projectSkills) `:171`(ioSpecFromJsonSchema) `:223`(projectObjectTypes) `:236` `:280` ·
`apps/agentcore/src/dril/relations.ts:21`(抬头声明) `:98`(declaredObjectTypes) `:115`(objectTypeRelations) ·
`apps/agentcore/src/dril/resource-router.ts:80-82` ·
`apps/agentcore/src/dril/resource-registry.ts:40-41` `:193` ·
`apps/agentcore/src/agent/navigation-slice.ts:22-24`(镜像自述) `:31`(reads) `:76`(SOLVER_CATALOG) `:303/:310/:330`(消费) ·
`apps/agentcore/src/router/orchestrator.ts:82/403/415/1627/1688` · `apps/agentcore/src/engine.ts:325/332` ·
`apps/agentcore/src/tools/clients.ts:95`(ObjectTypeDefSummary) `:109-113`(linkKeys 预留恒 undefined) ·
`packages/contracts/src/solver-args.ts:111`(SOLVER_ARGS_SCHEMAS，11 条) ·
`apps/datacore/src/solvers/service.ts:44-153`(SOLVER_KEYS，57) `:235`(SOLVER_OUTPUT_SHAPES) ·
`apps/datacore/src/catalog.ts:14`(CatalogItem) `:47`(SOLVER_CATALOG) ·
`apps/datacore/src/graphmeta.ts:52`(SOLVER_GRAPH，8) ·
`packages/contracts/src/databuilder.ts:123`(PlanSolverNeedSchema) ·
`apps/datacore/src/databuilder/comprehend.ts:511-517`(SOLVERS 4 条) `:662`(只查 typeKey) ·
`apps/datacore/src/databuilder/closure.ts:81-96`(FORWARD) ·
`apps/datacore/src/synthetic/battery.ts:861`(orderProps) `:901`(processProps)

**§6 存量过期取证**
`apps/datacore/src/seed.ts:92`(viaModelingChain:false) · commit `082186ef` ·
`apps/datacore/src/synthetic/service.ts:639-645`(A 路) `:1152`(seedDemoOntologyViaChain) `:1170`(buildCuratedSuggestionObjectTypes) ·
`apps/datacore/src/modeling.ts:425/433`(publishDraft upsertType) ·
`apps/datacore/src/synthetic/battery.ts:2082`(batteryObjectTypes) `:2092-2097`(plainD) ·
`scripts/check-ontology-anchors.mjs:41` · `scripts/check-prd-ontology.mjs:39` · `scripts/check-prd-coverage.mjs:47` ·
`scripts/check-ontology-descriptions.mjs:50-52`
