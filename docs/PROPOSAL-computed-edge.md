# 提案 · 表达式产边（桶④「算端点 / 造叉积」）

> ## ✅ 已落地（`WO-COMPUTED-EDGE-IMPL` · 2026-09-07）
>
> 本提案的四组**全部闭合**，落地口径与本文推荐一致（仓主裁决：① 走「丙」· ② 加 anchor 侧谓词 · ③ 拆边 + 口径归一）。
> 落地后的机制说明、对照实验四数与限界证据 → `docs/SYSTEM-ONTOLOGY.md`
> 「结构边物化 · 算端点 `viaKeyExpr` / anchor 侧谓词 `viaWhereTo` / 叉积 `viaCross`」及其后三节。
>
> | 组 | 本文的推荐 | 实际落地 | 状态 |
> |---|---|---|---|
> | **A1** 条件常量/枚举映射（2 条） | A1-α `viaKeyExpr`，复用 `ontology-dsl`，零新 AST 节点 | 照此落地。`plantarget_ownedby` 0→**17** 条 · `model_in_segment` 0→**6** 条（`keyExprDistinctKeys=2`） | ✅ 已闭 |
> | **A2** 字符串手术（2 条） | 裁决点① 三选一 | 走**丙**：补列 `Line.workshopId` / `Order.dueMonth`，**没有**加 `SUBSTR`/`CONCAT`/`CONTAINS`（不外溢到派生属性子系统）。`line_belongs_to_workshop` 400→**130** · `order_to_plantarget` 400→**458** | ✅ 已闭 |
> | **B** 造叉积（2 条） | B-α `viaCross` + 强制边数预算 | 照此落地，`maxEdges` **必填无默认值**。`base_data_health` 0→**117**（13×9）· `scenario_to_capex` 0→**6**（候选 3×3=9 → `fromWhere` 筛 → 2×3） | ✅ 已闭 |
> | **C** 多态目标（1 条） | 「我给不出安全方案」，替代路=拆 5 条 | 走替代路。实测揭出比预期更硬的证据：**372 条实例写进 links、检索只看得见 166 条**，206 条静默不可达。原 key 留给 `EquipmentDowntime`，新增 4 条 | ✅ 已闭 |
> | 裁决点② anchor 侧谓词 | 推荐「乙 · 加 `viaWhereTo`」 | 照此落地（叉积的前置） | ✅ 已闭 |
> | 裁决点③ BOM 捷径边 | 推荐「乙 · 口径归一到 BOM 链」 | 照此落地：捷径边改从 BOM 四跳链派生，**24 条（4/型号）→ 42 条（7/型号）**，边 key/方向/端点零改动 | ✅ 已闭 |
> | §1.2b `model_in_segment` 退化 | 「不该由本提案顺手定死」 | 由本单裁决：按已有的 `pos` 口径归段（与 `Model.unitPrice` 共用 `segKeyOfModelPos`），`com` 分支**删除**（型号表零商用车型号，该细分由买方业态判定）。修后 `{pas:4, ess:2}` | ✅ 已闭 |
>
> **本文其余内容原样保留**（含被实测推翻的两处：§1.2 与 §1.2b）—— 它是当时的取证过程，不是现状描述。
> 现状以本体为准。

| | |
|---|---|
| **单号** | `WO-COMPUTED-EDGE-PROPOSAL`（只读单，零源码改动） |
| **base commit** | `06c5e4e6`（`origin/claude/inspiring-gates-aqczjg`，本文 HEAD 的父） |
| **取证方式** | **静态取证**（读源码 + 种子生成器）。本 worktree **无 `apps/datacore/dist/`**，派单禁 build/禁 vitest ⇒ **本文不含真起服务的读数**。凡引用的运行时数字均标注它的**既有出处**，不冒充本次实测。 |
| **树龄探针** | `wc -l apps/datacore/src/synthetic/battery.ts` = **6607**；`ontology.ts` = **1356** |

> **诚实边界（先说，免得后面被当成实测）**：本文所有「这条边今天卡在哪」的判定，
> 依据是**种子生成器的源码**（`synthetic/service.ts` 的 `putLink` 调用点）与**类型属性表**
> （`synthetic/battery.ts` 的 `*Props`）。种子是确定性的（R6），所以源码即数据形态；
> 但**边数**这类需要真跑才有的数，本文只在能追到既有出处时才给，其余一律写「未测」。

---

## §0 本体引用与影响

- **对象类型**：`Model` `Segment` `Order` `PlanTarget` `Principal` `Workshop` `Line` `Base`
  `DataSourceHealth` `AnnualScenario` `CapexProject` `Material` `BOMHeader` `BOMDetail`
  `ProductVersion` `ExceptionEvent`
- **链路**：本文评估的 9 条边（`model_in_segment` / `order_to_plantarget` / `plantarget_ownedby` /
  `line_belongs_to_workshop` / `base_data_health` / `scenario_to_capex` /
  `model_uses_material` / `material_used_by_model` / `exc_sourced_from`）
- **本体章节**：`docs/SYSTEM-ONTOLOGY.md` §「结构边物化 · 谓词筛行 `viaWhere`」
  （该节「诚实边界」段已点名本文这四类形态 —— 本文是**那一段的下一步**，不是新发现）
- **不变量**：**R6 确定性**（同 industry/scale/seed 重跑字节级一致）为本文 §4 的全部题目
- **本提案不改任何源码** ⇒ 本次**无需回写本体**。落地时才回写。

---

## §1 复测：这 9 条今天各自卡在哪

### 1.0 判定器（尺子）与金丝雀

**尺子**——对种子里的 `putLink(id, key, oid(FromT, A), oid(ToT, B))` 调用点，判三件事：

| 维度 | 取值 |
|---|---|
| **端点表达式 A/B** | `裸读`（`l.baseId` 这类对行的直接属性读 / 行自身主键）﹒`算`（模板串 / `.replace` / `.slice` / 三元 / 函数调用） |
| **外层迭代** | `单行`（遍历一个集合）﹒`叉积`（两层 `for` 遍历两个**互不引用**的集合） |
| **守卫** | 有无 `if (<carrier 字段>)` 前置条件 |

**判定**：`两端都裸读` ∧ `单行` ⇒ **五种声明够用**（守卫 ⇒ 加 `viaWhere`）。
任一端为`算`、或迭代为`叉积` ⇒ **今天表达不了**。

**金丝雀（先证明尺子是好的，再报否定结论）**——挑三条我确定五种声明够用的边，
分别压 `viaProperty` / `viaWhere` / `viaBridge` 三条不同的路，尺子必须全判「够用」：

```bash
grep -n 'putLink(`lnk_lbb_\|"material_carbon"\|type: "model_certified_on"' \
  apps/datacore/src/synthetic/service.ts
```

| 金丝雀 | 出处 | 尺子读数 | 尺子判定 | 对应声明 |
|---|---|---|---|---|
| `line_belongs_to_base` | `service.ts:1005` `putLink(…, oid("Base", l.baseId), oid("Line", l.lineId))`，遍历 `g.lines` | 裸读 / 裸读 · 单行 · 无守卫 | **够用** ✅ | `viaProperty:"baseId", viaSide:"to"` |
| `material_carbon` | `service.ts:1110` `for (const cf of ext.carbonFactors) if (P(cf).kind === "material") putLink(…, oid("Material", P(cf).key), oid("CarbonFactor", P(cf).factorId))` | 裸读 / 裸读 · 单行 · **有守卫** | **够用** ✅ | `viaProperty:"key", viaSide:"to", viaWhere:"CarbonFactor.kind == 'material'"` |
| `model_certified_on` | `service.ts:909-918`，遍历 `g.certLinks`，两端 `cl.modelId` / `cl.lineId` | 裸读 / 裸读 · 单行（桥） | **够用** ✅ | `viaBridge{typeKey:"Certification", fromProperty:"modelId", toProperty:"lineId"}` |

**三只金丝雀全中**（且第 2 条与 `ontology-link-predicate.ts:10` 头注里写死的那条声明**逐字一致**，
是独立复核不是自证）⇒ **尺子可用**，下面的否定结论才允许下。

### 1.1 逐条复测（6 条桶④ + 2 条多跳桥链 + 1 条多态目标）

取数命令（全部 `apps/datacore/src` 内，读的是 `service.ts` 的 `putLink` 调用点）：

```bash
grep -n 'putLink(`lnk_mis_\|putLink(`lnk_otp_\|putLink(`lnk_pto_\|putLink(`lnk_lbw_\|putLink(`lnk_bdh_\|putLink(`lnk_s2c_\|putLink(`lnk_mum_\|putLink(`lnk_mubm_\|putLink(`lnk_exc_' \
  apps/datacore/src/synthetic/service.ts
```

| # | 边 | 种子 file:line | 端点表达式（原文片段） | 尺子读数 | **今天卡在哪** |
|---|---|---|---|---|---|
| 1 | `model_in_segment` | `service.ts:1121` | `oid("Segment", segOf(String(m.modelId)))`，`segOf = m => m.includes("S192")?"ess":m.includes("L148")?"com":"pas"`（`:1120`） | **算** / 单行 | 目标端由 `modelId` **串匹配**算出。`Model` 属性表（`battery.ts:1126-1160`）**无 `segKey`**：只有 `modelId/name/chem/pos/bases/unitPrice/unitCost/carbonFootprint`。**⚠ 且这条边今天是退化的，见 §1.2b** |
| 2 | `order_to_plantarget` | `service.ts:1212` | `oid("PlanTarget", \`PT-${month}\`)`，`month = o.due.slice(0,7)`（`:1211`）；外加 `:1210` 的 `monthTargets` 预筛 `t.level === "month"` | **算** / 单行 | 目标端 = **前缀 + 日期截断**。且 `level==="month"` 是**锚点侧**过滤，而 `viaWhere` 只对 carrier 求值（`ontology.ts:515-522` 用 `carrierTypeKey` 编译、`o.props` 求值）⇒ **两个独立缺口叠在一条边上** |
| 3 | `plantarget_ownedby` | `service.ts:1224` | `owner = P(t).level === "month" ? "prin-plan" : "prin-coo"`（`:1223`） | **算**（条件常量） / 单行 | `PlanTarget` 属性表（`battery.ts:2352-2359`）只有 `tgtId/period/level/value/year/scenarioKey`，**无 `ownerRef`**。⚠ 同文件 `Metric` **有** `ownerRef`（`battery.ts:1752`，`refToTypeKey:"Principal"`）⇒ `metric_ownedby`（`service.ts:1219`）是**裸读、五种声明够用**。**同形状两条边，一条够用一条不够用，差的只是一个属性** |
| 4 | `line_belongs_to_workshop` | `service.ts:1001` | `workshopId = l.lineId.replace("LINE-", "")`（`:1000`） | **算**（串变换） / 单行 | `Line` 属性表（`battery.ts:1411+`）**无 `workshopId`**。生成侧 `battery.ts:5457` 是 `const lineId = \`LINE-${workshopId}\`` ⇒ **workshopId 本来就在 lineId 里，只是没落成列** |
| 5 | `base_data_health` | `service.ts:1123` | `for (const b of g.bases) for (const dh of g.dataHealth)` —— 两层 for，**两集合互不引用** | 裸读 / 裸读 · **叉积** | 无外键可依。规模：`BASE_REGISTRY` **13** 条（`packages/contracts/src/base-registry.ts:101+`）× `dataHealth` **9** 条（`battery.ts:5765-5773`，XL 档另加每基地 IoT）⇒ **117 条边** |
| 6 | `scenario_to_capex` | `service.ts:1201` | `for (const s of pd.scenarios) { if (P(s).key === "conservative") continue; for (const cp of ext.capexProjects) …}`（`:1199-1201`） | 裸读 / 裸读 · **叉积 + 源侧守卫** | 同上。规模：scenarios **3**（`battery.ts:6453-6457`）减 conservative = 2 × capexProjects **3**（`battery-extended.ts:950-954`）= **6 条边** |
| 7 | `model_uses_material` | `service.ts:1029` | `bom = Array.from({length:4}, (_,k) => matIds[(mi*2+k) % matIds.length])`（`:1027`） | **算**（模运算选料） / 单行 | 详见 §1.2 —— **不是多跳桥链问题** |
| 8 | `material_used_by_model` | `service.ts:1032` | 与 7 **共用同一个 `bom` 变量**（`:1030-1031` 注释明写「不是抄一遍派生式」） | 同 7 | 同 7 |
| 9 | `exc_sourced_from` | `service.ts:1131` | `oid(refType, refId)`，`refType = String(ev.refType)`（`:1129`）—— **类型名本身是变量** | 裸读 / 单行，但 **toType 随行变** | `LinkTypeDef.toTypeKey` 是**单个固定串**（`domain.ts` 声明 + `ontology.ts:504` 物化时单值取用）。5 个 refType（`battery.ts:2194/2210/2231/2247/2264`：`EquipmentDowntime` / `EquipmentAlarm` / `DefectRecord` / `TriggerRule` / `MaterialBalance`）⇒ **一条声明装不下 5 个目标类型** |

### 1.2 ⚠ 第 7/8 条的前提被实测推翻：**它不是「多跳桥链」问题**

派单写「`BOMDetail` 没有 modelId，单跳桥做不了」——**前半句属实，后半句的推论不成立**。三条实测：

**(a) `BOMDetail` 确实没有 `modelId`，但 `BOMHeader` 有。**
```bash
sed -n '1211,1236p' apps/datacore/src/synthetic/battery.ts
```
`bomHeaderProps`（`:1211-1221`）含 `{ propKey: "modelId", dataType: "ref", refToTypeKey: "Model" }`（`:1215`）；
`bomDetailProps`（`:1223-1236`）12 个属性 `bomDetailId/bomId/materialId/sequence/quantity/lossRate/unit/level/parentItemId/isKeyComponent/effectiveDate/expireDate` —— **无 modelId**。✅ 前提属实。

**(b) 但那条多跳链**已经**作为真实边存在了，四跳全通。**
```bash
grep -n "version_belongs_to_model\|bom_belongs_to_version\|detail_belongs_to_bom\|detail_uses_material" \
  apps/datacore/src/synthetic/service.ts
```
> `943:` `version_belongs_to_model` ProductVersion→Model
> `945:` `bom_belongs_to_version` BOMHeader→ProductVersion
> `947:` `detail_belongs_to_bom` BOMDetail→BOMHeader
> `949:` `detail_uses_material` BOMDetail→Material

四条**全部是裸读、单行** ⇒ 五种声明**全都够用**。且 `battery.ts:3823` 的切片
`mustIncludeLinkKeys` 里白纸黑字列着这四条的链 ⇒ **多跳检索今天就能从 Model 走到 Material**。
⇒ **`model_uses_material` 不是「缺一种机制」，是一条跨过已有四跳链的捷径边。**

**(c) 更要紧：捷径边与 BOM 链**今天算的不是同一件事**。**
- 捷径边（`service.ts:1027`）：`matIds[(mi*2+k) % 8]`，**每型号取 4 种**，与 BOM 表**无关**。
- BOM 链（`battery.ts:5224-5240`）：走 `BOM_ITEM_TEMPLATES`（`:5190-5199`，**8 行**），
  按 `modelId.includes("LFP"|"NCM")` 跳掉对侧正极 ⇒ **每型号 7 行**。

**⇒ 同一个问题「这个型号用哪些料」，图上有两个都在被消费的答案：4 种 vs 7 种。**
这不是本提案要新造的机制能治的，也不该被一个新机制**掩盖**掉。

### 1.2b ⚠ 顺手撞出来的缺陷：`model_in_segment` 的两个分支今天是**死的**

写 §2 的例子时要举「`segOf` 会算出哪几个键」，一查目录 —— **算不出 `ess` 也算不出 `com`**。

```bash
sed -n '60,67p' apps/datacore/src/synthetic/battery.ts   # MODELS 全表
grep -n "const models = MODELS" apps/datacore/src/synthetic/battery.ts   # → 5068
```
> `MODELS`（`battery.ts:60-67`）**恰好 6 型**：`4680-NCM` `4680-LFP` `2170-NCM` `方形-LFP` `方形-NCM` `圆柱-LFP`
> `battery.ts:5068` `const models = MODELS.map(…)` —— 全文件**无 `models.push`** ⇒ **任何 scale 都是这 6 型，不增不减**

`segOf`（`service.ts:1120`）判的是 `includes("S192")` / `includes("L148")`。
**6 个 modelId 里没有任何一个含这两个子串** ⇒ **6 条边全部指向 `Segment "pas"`，`ess`/`com` 两个分支从未进入。**

`S192-LFP`/`L148-LFP` 这两个名字的真出处是求解器参数
`battery.ts:903-904`（`problems.essModels` / `comModels`），**不是 `Model` 目录**。
且本体（`docs/SYSTEM-ONTOLOGY.md` §「订单/型号/客户集」）已写明细分判定
**「按客户名判定（`segOfCust`）……替代旧按型号 essModels/comModels」** ——
即 `segOf` 是**已被取代的旧口径**，在这条边上留成了退化实现。

**形态（铁律 0.5 三分法的第二态）**：这是「**接了线没数据**」，不是「没接线」——
边有实例、检索能遍历、四包全绿，只是**三个细分坍缩成一个**。

**⇒ 对本提案的直接影响**：`model_in_segment` **不能**当作「给它一个 `viaKeyExpr` 就好了」的例子。
把今天的行为逐字搬进表达式，等于**把这个缺陷固化进声明**。见 §2 组 A1 与 §5 裁决点 ①。

### 1.3 复测结论表（与派单前提的差异，逐条点名）

| 派单说 | 复测 |
|---|---|
| 6 条桶④要「算端点/造叉积」 | ✅ 成立，但**分成三档不是两档**（见 §2） |
| 多跳桥链 2 条（`BOMDetail` 没 modelId） | ⚠ **前提对、结论错**：四跳链已全通且五种声明够用；真问题是**捷径边与 BOM 链口径不一致（4 vs 7）** |
| 多态目标 1 条 | ✅ 成立，`toTypeKey` 固定于 `LinkTypeDef` |
| —（派单未提） | 🆕 **`viaWhere` 只能筛 carrier，筛不了 anchor** —— `order_to_plantarget` 卡在这上面的那一半，和「算端点」是**两个独立缺口** |
| —（派单未提） | 🆕 **`model_in_segment` 今天是退化边**：6 型号全落 `"pas"`，`ess`/`com` 分支从未进入（§1.2b）⇒ **不能拿它当「照搬进表达式即可」的样板** |

---

## §2 按「需要什么能力」分组

**分成 4 组**（不是派单预期的 2 组）。分界不是「哪条边」，是「**要不要给求值器加新语法**」。

### 组 A1 · 条件常量 / 枚举映射 —— **今天的表达式设施已经够，只差接线**

| 涉及边 | 2 条 |
|---|---|
| | `plantarget_ownedby` · `model_in_segment` |

**最小能力描述**：对 carrier 行求值一个**返回字符串**的表达式，把结果当作锚点键去查 anchor 索引。

**关键实测（这一组存在的全部理由）**——本仓**已经有**一个返回值的求值器，只是不在 `ruledsl.ts` 里：

```bash
grep -n "^export function evaluate\|^export function parseFormula\|^export type Scalar\|kind: \"if\"\|kind: \"string\"" \
  apps/datacore/src/ontology-dsl.ts
```
> `13:` `export const MAX_FORMULA_LENGTH = 2000`
> `29:` `export type Ast = … | { kind: "string"; value: string } | { kind: "propref"; prop: string } | { kind: "if"; cond; then; else } | { kind: "coalesce"; args } | …`
> `352:` `export function parseFormula(formula: string): Ast`
> `447:` `export type Scalar = number | string | boolean | null`
> `492:` `export function evaluate(node: Ast, ctx: EvalContext): Scalar`

**对照 `ruledsl.ts`**（`viaWhere` 复用的那一份）：
```bash
grep -n "^export function evaluateAst" apps/datacore/src/ruledsl.ts   # → 543
```
> `543:` `export function evaluateAst(node: AstNode, ctx: EvalContext): boolean`

⇒ **派单问的「让同一套表达式求值输出一个 key」——答案是「能，但要复用的是 `ontology-dsl.ts` 不是 `ruledsl.ts`」。**
`ruledsl.evaluateAst` 返回 `boolean`，天生产不出 key；`ontology-dsl.evaluate` 返回 `Scalar`，
且 `Ast` 里**已有** `if`（三元）、`string`（串常量）、`cmp`、`coalesce` 四个节点。
它今天服务于 `DerivedPropertyDef`（`domain.ts:376`），公式如 `this.qty * this.unitPrice`
（`seed-derivation-specs.ts:36`）。

**具体例子（输入 → 输出）· `plantarget_ownedby`**

- 声明：`viaSide:"from"`，`viaKeyExpr: 'IF(this.level == "month", "prin-plan", "prin-coo")'`，
  anchor = `Principal` 主键
- 输入行 `PlanTarget{ tgtId:"PT-2026-03", period:"2026-03", level:"month" }` → 求值 `"prin-plan"`
  → 命中 `Principal{principalId:"prin-plan"}`（`battery.ts:5839`）→ 边 `PT-2026-03 → prin-plan`
- 输入行 `PlanTarget{ tgtId:"PT-2026-Q1", level:"quarter" }` → 求值 `"prin-coo"`
  → 命中 `battery.ts:5838` → 边 `PT-2026-Q1 → prin-coo`
- **与种子逐字同构**：`service.ts:1223` 就是 `level === "month" ? "prin-plan" : "prin-coo"`

**`model_in_segment` 是另一回事，不要照搬** —— 按 §1.2b，它今天 6 条边全落 `"pas"`。
`viaKeyExpr` 能**逐字复刻**这个行为（`IF(CONTAINS(this.modelId,"S192"), "ess", …)`，
需 A2 的 `CONTAINS`），也能**写成正确的**（如按 `Model.pos` 或 `Model.chem` 分档，两者都是现成属性，
`battery.ts:1126-1160`），但**机制本身不会告诉你哪一个才对**。
⇒ 这条边的裁决点**不在「有没有表达式」，在「细分到底该由什么决定」**（型号？`pos`？还是本体已采用的客户名 `segOfCust`？）——
那是业务口径问题，属 §5 裁决点 ① 的附带说明，**不该由本提案顺手定死**。

### 组 A2 · 字符串手术 —— **必须给求值器加新节点**

| 涉及边 | 2 条（+ A1 里 `model_in_segment` 的通用化） |
|---|---|
| | `line_belongs_to_workshop`（`replace`）· `order_to_plantarget`（`slice` + 前缀拼接） |

**最小能力描述**：`ontology-dsl` 的 `Ast` 增串操作节点（至少 `SUBSTR` / `CONCAT`，
`model_in_segment` 通用化还要 `CONTAINS`）。

**为什么今天做不了（实测，不是推想）**：`ontology-dsl` 的 `binary "+"` **两侧强制转数**：
```
apps/datacore/src/ontology-dsl.ts:513-519（evaluate 的 "binary" 分支）
  case "binary": {
    const l = evaluate(node.left, ctx);  const r = evaluate(node.right, ctx);
    if (l === null || r === null) return null;
    const ln = asNumber(l);  const rn = asNumber(r);
    if (ln === null || rn === null) return null;      // ← 串进来到这里就没了
```
`asNumber`（`:458-461`）只认 `typeof v === "number" && Number.isFinite(v)`
⇒ **`"PT-" + this.period` 求值为 `null`，不是拼接、也不报错**。
这正是 `ontology-link-predicate.ts:30-39` 头注反复警告的那一态：**静默的 0 实例死边**。

**具体例子（输入 → 输出）· `order_to_plantarget`**

- 今天种子：`PT-${o.due.slice(0,7)}`（`service.ts:1211-1212`）
- **观察**：若锚点走 `anchorProperty:"period"`（`PlanTarget.period` = `"2026-03"`，`battery.ts:2354`）
  而不是主键 `tgtId`（`"PT-2026-03"`），**前缀 `PT-` 整个消失** ⇒ 只剩 `SUBSTR`：
  `viaKeyExpr: 'SUBSTR(this.due, 0, 7)'` + `anchorProperty:"period"`
- 输入 `Order{ so:"SO-3391", due:"2026-03-18" }` → `"2026-03"` → 命中 `PlanTarget.period=="2026-03"`
- **⚠ 但仍差一半**：种子只连 `level==="month"` 的目标（`service.ts:1210`）。
  `PlanTarget` 的 `period` 在 year/quarter/month 三档间**不撞值**（`"2026"` / `"2026-Q1"` / `"2026-03"`，
  `battery.ts:2354` 注释即此三形），所以**这条边侥幸不需要 anchor 谓词**；
  但这是**数据形态的巧合，不是机制保证** —— 换个客户、period 编码一变就静默多连。
  ⇒ **anchor 侧谓词是这一组的独立第二需求**（见 §5 裁决点 ②）。

### 组 B · 造叉积

| 涉及边 | 2 条 |
|---|---|
| | `base_data_health`（13 × 9 = **117** 边）· `scenario_to_capex`（2 × 3 = **6** 边） |

**最小能力描述**：不经外键，对 `from` 全集 × `to` 全集连边；每侧各可挂一个谓词收窄。

**具体例子（输入 → 输出）· `scenario_to_capex`**
- 声明：`viaCross:{ fromWhere: 'AnnualScenario.key != "conservative"', toWhere: null }`
- 输入：`AnnualScenario` 3 行（`conservative`/`baseline`/`aggressive`，`battery.ts:6453-6457`）
  × `CapexProject` 3 行（`capex_zaozhuang`/`capex_jiangmen`/`capex_virtual`，`battery-extended.ts:951-953`）
- 输出：6 条边（保守情景被 `fromWhere` 筛掉）——与 `service.ts:1199-1201` 逐条同构

**⚠ 性能红线（派单要求说清怎么限界，这里给硬数）**
本仓真实规模的既有出处：`docs/LOOP-architect-round1.md:72` 的 GLOBAL 回执
`{"objects":11337,"links":6791}`。**叉积是全仓唯一一个边数不由数据量线性决定的声明** ——
`Order`(500) × `OrderLine`(873) 一条声明就是 **436,500** 条边，是现有全图边数（6,791）的 **64 倍**，
且写入走的是 `repos.links.put` **逐条 await**（`ontology.ts:539/588`）。
**一次误声明就能把内存仓储写爆，而且它不会红，只会变慢。**
限界方案见 §3 组 B。

### 组 C · 多态目标

| 涉及边 | 1 条 · `exc_sourced_from` |
|---|---|

**最小能力描述**：一条 `LinkTypeDef` 的 `toTypeKey` 随行取值。
**这不是求值器问题，是类型契约问题** —— `toTypeKey` 是 `LinkTypeDef` 的**单值字段**，
下游 `executeSlice` 的 `mustIncludeTypes`（如 `battery.ts:3822`）与 `ontology.ts:504` 的 `anchorTypeKey = side === "from" ? def.toTypeKey : def.fromTypeKey`（单值取用）
都按「一条边一个目标类型」写的。改它 ≠ 加个表达式。

---

## §3 每组的候选机制 + 代价（三问：谁会看见它 · 不做会缺什么 · 删掉会不会有人发现）

### 组 A1 —— 候选 A1-α：`viaKeyExpr`（复用 `ontology-dsl` 的 `parseFormula`/`evaluate`）

新增一个可选字段 `LinkTypeDef.viaKeyExpr?: string`，与 `viaProperty` **互斥二选一**：
物化时对 carrier 行求值，结果 `String()` 后当锚点键走**已有的** `buildAnchorIndex`（`ontology.ts:469`）。

- **谁会看见它**：建模页里建这两条边的建模人员（`catalog_admin`）；下游是所有走
  `model_in_segment` 的切片消费者 —— `battery.ts:3627` 的订单→细分→毛利链、
  `:3642` 的 `mustIncludeLinkKeys`（该链断了，毛利率归因少一跳）。
- **不做会缺什么**：这两条边**用户自建时永远 0 实例**，而出厂种子里它们有实例
  ⇒ 同一条边两种命运（`domain.ts:526` 已把这个不一致定性为「缺陷」）。
- **删掉会不会有人发现**：**会**。删了 `plantarget_ownedby`，`PlanTarget` → `Principal`
  的责任闭环断在计划域，SPINE 骨架图上目标树挂不到人。
- **代价**：`ontology-dsl` 的 `Ast`/`evaluate` **一个节点都不用加**；主要成本是
  ① 写入期校验（`propref` 必须真是 carrier 属性、禁 `agg`（要 `navigate`，物化期没有）、禁公式返回 `null`）
  ② 与 `viaWhere` 的**两套 DSL 并存**（见 §5 裁决点 ①）。
- **⚠ 已知反对意见**：这引入本仓**第二套**边声明用的表达式语言（`viaWhere` 用 `ruledsl`，
  `viaKeyExpr` 用 `ontology-dsl`）。两套语法、两套错误话术、两处白名单 —— 这是真代价，不粉饰。

### 组 A1 —— 候选 A1-β：**补列，不加机制**（`PlanTarget.ownerRef`）

给 `PlanTarget` 加一个 `ownerRef`（`refToTypeKey:"Principal"`），种子按现行三元式填值。
则 `plantarget_ownedby` 退化成 `viaProperty:"ownerRef"` —— **与 `metric_ownedby` 逐字同构**。

- **谁会看见它**：同上；额外地，**API 消费方能直接读到「这个目标归谁」而不必走图**。
- **不做会缺什么**：同上。
- **删掉会不会有人发现**：**会**（同上）。
- **代价**：改 `battery.ts` 的 `planTargetProps` + 种子 —— **动 R6 基线**（对象多一个属性 ⇒ 指纹变）。
  但**零新机制、零新语法**。
- **⚠ 这个候选只覆盖 `plantarget_ownedby`**，覆盖不了 `model_in_segment`
  （给 `Model` 加 `segKey` 也能覆盖，但 `Model` 属性表是原型单一真相源，改动面更大）。

### 组 A2 —— 候选 A2-α：给 `ontology-dsl` 加 `SUBSTR`/`CONCAT`/`CONTAINS` 三个节点

- **谁会看见它**：建 `line_belongs_to_workshop` / `order_to_plantarget` 的建模人员。
- **不做会缺什么**：`line_belongs_to_workshop` 断 ⇒ `battery.ts:3534` 的
  订单→基地→车间→产线→工序→设备链**在车间那一跳断掉**（该链的 `mustIncludeLinkKeys` 里有它）。
- **删掉会不会有人发现**：**会**（同上，工厂域下钻少一层）。
- **代价**：`ontology-dsl` 是**派生属性**的求值器，加串函数会同时让**派生属性**能产字符串 ——
  影响面**超出本提案**（派生属性的类型/单位/量纲体系是另一套约束，`domain.ts:385` 一带）。
  ⇒ 这是本文里**唯一一个会外溢到无关子系统**的候选。

### 组 A2 —— 候选 A2-β：**补列**（`Line.workshopId`）

`battery.ts:5457` 生成侧本来就是 `const lineId = \`LINE-${workshopId}\``，`workshopId` 是**现成变量**，
在 `lines.push({...})`（`:5459`）里多写一个 `workshopId,` 即可。
则该边退化成 `viaProperty:"workshopId", viaSide:"to"`。

- **三问**：同 A2-α。
- **代价**：一行种子 + 一条 `PropertyDef`；动 R6 基线。**零新语法。**
- **⚠ 覆盖不了 `order_to_plantarget`** —— 那条的 `due→period` 是**跨类型的值域换算**，
  不是「某个已存在的变量忘了落列」。这是 A2 两条边的**本质差别**，不该被一个候选糊住。

### 组 B —— 候选 B-α：`viaCross` + **强制边数预算**

`viaCross:{ fromWhere?, toWhere?, maxEdges }`。物化前先各自筛选并**取两侧计数**，
`|from| × |to| > maxEdges` ⇒ **写入期 400 点名**，报文里带上实算的三个数（`|from|`、`|to|`、乘积）。

- **谁会看见它**：建 `base_data_health` / `scenario_to_capex` 的建模人员。
- **不做会缺什么**：`base_data_health` 断 ⇒ `battery.ts:3582/3602/3631` 三条切片
  的数据健康度下钻全部拿不到源（「这个基地的数为什么滞后」答不了）。
- **删掉会不会有人发现**：**会**（三条切片的 `mustIncludeLinkKeys` 里都有它）。
- **限界怎么算才不是装饰品**：预算**必须在物化前用真实计数算**，不能事后统计 ——
  事后统计意味着 436,500 条已经写进去了。两侧计数走已有的
  `repos.objects.listByType(...).length`（`ontology.ts:479/521` 同款调用）。
  **默认上限建议 10,000**（≈ 现有全图边数 6,791 的 1.5 倍，超过它就该被人看一眼）。
- **⚠ 诚实**：这个上限是**我拍的**（有出处的只有 6,791 这个基数）。它是个治理旋钮不是物理常数。

### 组 C —— **我给不出安全方案**

`toTypeKey` 随行变会让下面这些**全部失去意义**：切片的 `mustIncludeTypes` 断言、
`ontology.ts:504` 的 `anchorTypeKey = side === "from" ? def.toTypeKey : def.fromTypeKey`（单值取用）、以及「一条边两端类型确定」这个被 `executeSlice` 依赖的前提。
把它改成多值，等于改 `LinkTypeDef` 的**类型契约**，不是加一个可选字段。

**替代路（不新造机制）**：把 `exc_sourced_from` **拆成 5 条边**，每条一个固定 `toTypeKey`，
各自用 `viaWhere:"ExceptionEvent.refType == '<X>'"` 筛行 —— **五种声明今天就够。**
代价：本体上多 4 条边 key，下钻要写 5 个 `linkKey`。
⚠ 但这撞上**禁令 3（新增门/棘轮/基线冻结）的邻域**与「边数膨胀」的治理面 ⇒ 属产品决策，
故收进 §5 裁决点 ③。

### 组 —— `model_uses_material` / `material_used_by_model`：**不给候选机制**

按 §1.2，这两条**不缺机制**。真问题是「型号用哪些料」有两个不一致的答案（捷径边 4 种 / BOM 链 7 种）。
新造一个多跳桥链机制会**再生出第三个答案**。**这一条我明确建议不做机制，见 §5 裁决点 ③。**

---

## §4 确定性风险（R6：同 industry/scale/seed 重跑字节级一致）

**本仓已有的教训**（派单点名的实例）：`must_be_before` 比较器用 `num()` 对非数字回落 `0`，
**排序塌成 id 序，四包全绿、无报错，但它挑的是「最小 id」不是「最大值」**。
下面逐候选照这把尺子过 —— 问的都是同一句：**「有没有一个静默回落把结果塌成遍历顺序？」**

| 候选 | 遍历顺序依赖？ | 具体风险 & 对策 |
|---|---|---|
| **A1-α `viaKeyExpr`** | **否**（求值是 `self` props 的纯函数，不 navigate） | ⚠ **但有一个与 `num()→0` 同形态的坑**：`evaluate` 在 `propref` 取不到值时返回 `null`（`ontology-dsl.ts:500-505`），在 `binary` 两侧非数时也返回 `null`（`:513-519`）。`String(null)` = `"null"` ⇒ **所有坏行塌到同一个键 `"null"`**，若恰好有对象主键是 `"null"` 就全连过去，否则全进 `unresolved`。**两种都不报错。** 对策：求值得 `null` 必须**当场计数并单列**（不能混进 `unresolved`），且写入期用真实行**试算一次**，恒 `null` 即 400。 |
| **A1-α（锚点撞车）** | **是，但已被现有代码兜住** | 算出的键落到多对象桶时，`buildAnchorIndex` 取 `[...ids].sort()[0]`（`ontology.ts:494`）并把撞车数记进 `ambiguousAnchors`（`:493`）。⇒ **确定性有保证，且不静默**。这是现成设施，新机制**必须走它，不许另写索引**。 |
| **A1-β / A2-β 补列** | **否** | 纯数据，走既有 `viaProperty` 路。**唯一影响：对象多一个属性 ⇒ 合成指纹变** ⇒ 需同步金值（`synthetic.test.ts` SY1 逐字节重跑那条）。这是**一次性**的基线更新，不是持续风险。 |
| **A2-α 串函数** | **否** | 同 A1-α 的 `null` 坑。额外：`SUBSTR` 的越界语义必须**写死**（`SUBSTR("2026", 0, 7)` 返回 `"2026"` 还是 `null`？）—— 不写死就会在不同 Node 版本/不同实现下漂。建议：显式定义为「截到串尾」，并在写入期校验。 |
| **B-α `viaCross`** | **⚠ 是 —— 这是本文最危险的一条** | 现有属性形态的边 id 是 `lnk_via_${key}_${c.id}${i}`（`ontology.ts:541`），其中 `i` 是**数组下标**。叉积若照抄，`i` 就变成 **anchor 在 `listByType` 返回序里的位置** ⇒ **仓储遍历顺序一变，边 id 全变，R6 当场破**，而且**边数不变、四包全绿**（正是「塌成 id 序」的同族病）。**对策（硬要求）**：叉积边 id 必须为 `lnk_cross_${key}_${fromId}_${toId}` —— **只由两个对象 id 决定，不含任何序号**。 |
| **B-α（预算判定）** | **否** | `|from| × |to|` 是集合大小，与顺序无关。 |
| **C 拆 5 条边** | **否** | 走既有 `viaWhere`，`ontology.ts:508-511` 已论证过纯函数、零时钟、零随机。 |

**⚠ 一个不属于 R6 但同族的风险：确定性的**退化**。**
`model_in_segment`（§1.2b）今天 6 条边全落 `"pas"` —— **它完全确定性、重跑字节一致、四包全绿**，
只是**算错了**。这正是铁律 1.5 说的第四态（接对了、跑通了、但算错了），R6 一个字都管不了它。
⇒ **把「算端点」做成机制，等于把这类错误从种子代码搬到声明里，且更难看见**（声明在数据库里，不在 diff 里）。
**对策**：`viaKeyExpr` 落地时必须回报**键的分布**（算出了几个不同的键、各命中多少行），
让「三个细分坍缩成一个」在物化回执上**当场看得见**，而不是要等有人去数边。

**一条贯穿全文的对照实验（铁律 1.5 判据一）**——任何候选落地时的验收标准，
**不是「跑得起来」而是「改了输入，输出按可预言的方式变」**：

> 取 `plantarget_ownedby`：把某一行 `PlanTarget.level` 由 `"month"` 改成 `"quarter"`，
> 该行的边**必须**从 `→prin-plan` 变成 `→prin-coo`，且**其余行一条不动**。
> **修前**（今天用户自建此边）：`created:0` —— 四个读数里前两个根本不存在。
> **四个读数（改前 month/quarter × 改后 month/quarter）缺一个都不算交付。**

---

## §5 裁决点（3 个，全是互斥的架构取舍；「要不要做」不在此列）

### 裁决点 ① · 「算端点」用**表达式**还是**补列**？

⚠ 先说清覆盖面：**这一组名义 4 条边，实际只有 3 条是「机制问题」** ——
`model_in_segment` 按 §1.2b 是**业务口径问题**（细分该由型号 / `pos` / 还是客户名决定），
任何机制都答不了它，故不计入下表分母。

| 选项 | 覆盖（分母 3） | 代价 |
|---|---|---|
| **甲 · 只补列**（A1-β + A2-β） | `plantarget_ownedby` · `line_belongs_to_workshop` = **2/3** | 零新语法；动 R6 基线；**`order_to_plantarget` 无解** |
| **乙 · 只上表达式**（A1-α + A2-α） | **3/3** | 本仓**第二套**边用表达式语言；A2-α 外溢到派生属性子系统 |
| **丙 · 补列 2 条 + A1-α（不加串函数）** | 补列 2 条即 **2/3**，另**白得** `plantarget_ownedby` 的声明式表达 | 零新 AST 节点（`if`/`string`/`cmp` 已有）；`order_to_plantarget` 留口 |

**我的推荐：丙。**
**理由**：① `line_belongs_to_workshop` 的 `workshopId` 在生成侧**已是现成变量**（`battery.ts:5457`），
把它落成列是**补一个本来就该有的属性**，不是绕过机制 —— 与 `Metric.ownerRef`（`battery.ts:1752`）
是同一个建模习惯；② A1-α **一个 AST 节点都不用加**，是四个候选里唯一「复用现成设施且不外溢」的；
③ A2-α 会让 `ontology-dsl` 同时改变**派生属性**的能力边界，那是另一个子系统的决策，
不该被一条边的需求顺手带出来。
**两处留口，都明说**：`order_to_plantarget` 在丙方案下**仍然做不了**（需 `SUBSTR`）；
`model_in_segment` 需要先有人裁决细分口径，**再**谈用哪种机制表达。

### 裁决点 ② · `viaWhere` 要不要长出 **anchor 侧**谓词？

今天 `viaWhere` 只对 carrier 求值（`ontology.ts:515-522`）。`order_to_plantarget` 的
`level==="month"` 是 anchor 侧条件；`base_data_health`/`scenario_to_capex` 若走叉积，
**两侧都要能筛**。

| 选项 | 说明 |
|---|---|
| **甲 · 不加**，靠 anchor 键天然不撞（如 period 三档不同形） | 零改动；但**依赖数据形态的巧合**，换客户即静默多连 |
| **乙 · 加 `viaWhereTo`**，与 `viaWhere` 对称 | 属性形态与叉积形态**共用**；写入期校验多一份 |

**我的推荐：乙。**
**理由**：§2 组 A2 已实测出这是**独立于「算端点」的第二个缺口**
（`order_to_plantarget` 一条边同时踩两个）。更要紧的是**叉积没有外键可依，两侧谓词是它唯一的收窄手段** ——
组 B 若落地而只有单侧谓词，`scenario_to_capex` 的 `conservative` 排除**无处可写**。
⇒ 这不是锦上添花，是组 B 的**前置**。

### 裁决点 ③ · 多态目标 (`exc_sourced_from`) 与 BOM 捷径边 (`model_uses_material`)：**拆边 / 补机制 / 不动**？

两条都不是「加个表达式」能解的，且都撞治理面（边数膨胀），故合并成一个裁决。

| 选项 | `exc_sourced_from` | `model_uses_material` |
|---|---|---|
| **甲 · 都不动** | 保持种子硬编码，用户自建不了 | 保持 4 种 vs 7 种两个答案并存 |
| **乙 · 拆边** | 拆 5 条 + `viaWhere`（五种声明**今天就够**），本体多 4 个边 key | 捷径边**改为从 BOM 链派生**（口径归一到 7 种），不新造机制 |
| **丙 · 造多跳/多态机制** | 改 `LinkTypeDef` 类型契约 | 造多跳桥链 |

**我的推荐：乙（拆边 + 口径归一），且这两件里 `model_uses_material` 的口径归一优先。**
**理由**：① `exc_sourced_from` 拆 5 条**不需要任何新机制**，纯声明，风险最低；
丙要动 `LinkTypeDef` 的类型契约，`executeSlice` 的 `mustIncludeTypes` 全线受影响 —— 代价与收益不成比例。
② `model_uses_material` 的真问题**不是缺机制**（四跳链 `service.ts:943/945/947/949` 全通），
是**同一个业务问题有两个在被消费的答案**（4 种 / 7 种）。
**造多跳桥链机制会生出第三个答案，把问题做大而不是做小。**

⚠ **这一条我把话说死**：`BOMDetail` **该不该有 `modelId`** —— **不该。**
`BOMDetail` 的父是 `BOMHeader`，`BOMHeader` 已有 `modelId`（`battery.ts:1215`）；
给明细行再挂一个型号是**冗余外键**，两处一旦不同步就是第三个真相。
⇒ **这既不是「新机制问题」也不是「补数据问题」，是「捷径边口径不一致」问题**，
修法是让捷径边从既有 BOM 链派生（或直接退役捷径边、下钻走四跳），**不是补列、也不是造多跳桥链**。

---

## 附 · 复核命令清单（任何人可原地复跑，全部只读）

```bash
# §1 金丝雀（三条不同声明各一）
grep -n 'putLink(`lnk_lbb_\|"material_carbon"\|type: "model_certified_on"' apps/datacore/src/synthetic/service.ts
# §1 九条目标边的种子调用点
grep -n 'putLink(`lnk_mis_\|putLink(`lnk_otp_\|putLink(`lnk_pto_\|putLink(`lnk_lbw_\|putLink(`lnk_bdh_\|putLink(`lnk_s2c_\|putLink(`lnk_mum_\|putLink(`lnk_mubm_\|putLink(`lnk_exc_' apps/datacore/src/synthetic/service.ts
# §1.2 BOM 四跳链已存在
grep -n "version_belongs_to_model\|bom_belongs_to_version\|detail_belongs_to_bom\|detail_uses_material" apps/datacore/src/synthetic/service.ts
# §1.2 BOMDetail 无 modelId / BOMHeader 有
sed -n '1211,1236p' apps/datacore/src/synthetic/battery.ts
# §2 两个求值器的返回类型（本提案的枢纽）
grep -n "^export function evaluate\b\|^export type Scalar" apps/datacore/src/ontology-dsl.ts
grep -n "^export function evaluateAst" apps/datacore/src/ruledsl.ts
# §4 现有边 id 的序号来源（叉积不许照抄）
sed -n '539,549p' apps/datacore/src/ontology.ts
# §1.2b model_in_segment 退化：6 型号无一含 S192/L148 ⇒ 全落 "pas"
sed -n '60,67p' apps/datacore/src/synthetic/battery.ts
grep -n "const models = MODELS" apps/datacore/src/synthetic/battery.ts   # 且全文件无 models.push
```
