# PRD · 写死的诚实位反而在说谎（G-FRONTEND-HARDCODED-ABSENCE）

> **单号** WO-FRONTEND-HARDCODED-ABSENCE　**基线** `640acb74`　**分支** `claude/handoff-wo-hardcoded-absence`　**日期** 2026-08-08
> **范围边界**：只改 `apps/frontend-shell/src/views/sim/transitFlow.ts` ＋ 其配套测试 `apps/frontend-shell/test/transit-flow.seam.test.tsx` ＋ 本文件。

---

## 0. 一句话

界面上那两块「诚实缺席」面板，把**已经存在的数据**当面宣告为不存在 —— 不是因为判断逻辑错了，
而是因为**这个判断根本没在运行**：结论被写成了 `const` 字面量，它记录的是**写下它那一刻**的仓库状态。
上游补齐之后，那句"本体没有"就变成了假话，而**没有任何测试会红**，因为咬它的断言查的是
`evidence.length >= 3` —— **咬的是借口数量，不是借口真假**。

---

## 1. 复核结论（先推翻，再动手）

前一个 agent 承认自己"没起服务、纯静态追链"。本单按铁律 0.5 逐条追到定义处重验。
**结论：它的方向对、定性错了一半 —— 而错的那一半会把人引去修错的地方。**

### 1.1 五处「硬编码」逐条复核

| # | 位置 | 前一个 agent 的说法 | 复核结论 | 证据 |
|---|---|---|---|---|
| ① | `transitFlow.ts:123` `PROCUREMENT_BRANCH` | 硬编码 | ✅ **成立**。`status: "EMPTY" as const` ＋ 三条写死取证，**不接受任何输入** | 原文 `status: "EMPTY" as const` |
| ② | `transitFlow.ts:143` `CADENCE_ABSENCE` | 硬编码 | ✅ **成立**。同上 | 同上 |
| ③ | `TransitFlowLayer.tsx:830` 采购面板 JSX | 硬编码、不查数据 | ✅ **成立，且比说法更严重**：该 `<div>` **无条件渲染**，外面连一个条件表达式都没有 —— 无论有多少采购数据，它都在那儿 | `:830` 直接跟在 `)}` 之后，非三元分支 |
| ④ | `TransitFlowLayer.tsx:551` 节拍面板 JSX | 硬编码、不查数据 | ❌ **不成立（此处判错）**。渲染条件是 `{cadenceStations.length === 0 ? (…缺席…) : (…真闸门…)}` —— **这是数据派生的**。`:389` `cadenceStations = stations.filter((s) => s.cadence !== undefined)` | 已实测：喂带 `cadence` 的 `nodes` ⇒ 缺席块从 DOM 消失、`transit-cadence-live` 上屏 |
| ⑤ | `SandboxConsole.tsx:795/:802` | 硬编码 | ◐ **部分成立**：它渲染的是 `{CADENCE_ABSENCE.status}` / `{PROCUREMENT_BRANCH.status}`，**自身零文案**（该文件注释明写"本组件零自有文案"）。真正写死的是它读的那两个 `const`，不是它 | 消费方无辜，病灶在 ①② |

> **判错那一条为什么要紧**：④ 若真是写死的 JSX，修法是"给面板加条件"；实际它条件早就有了，
> 修法是**给它喂数据**。把"接了线没数据"错报成"没接线"，正是 CLAUDE.md 铁律 0.5 反复点名的那个病。

### 1.2 它宣告"不存在"的三样东西，今天到底在不在

**全部存在，且都是可经 `GET /a/v1/objects?type=…` 查到的在册对象类型。**

| 东西 | 面板宣称 | 实测（基线 `640acb74`） |
|---|---|---|
| `Cadence` | "只有契约、没有对象、没有一条数据"；"`synthetic/cadence.ts` 在本基线不存在" | ❌ **假**。`apps/datacore/src/synthetic/cadence.ts` **存在**（29 KB）；`synthetic/service.ts:712` `putAll("Cadence", cadenceObjectRows(deriveChainCadences(g)), "nodeId")` **真落库**；`app.ts:1448` 推演 tick **已在读**它 |
| `CustomsClearance` | "在 `apps/datacore/src` 与 `packages/contracts/src` 均 0 命中 —— 两段完全无承载" | ❌ **假**。`battery-extended.ts:168` `def("CustomsClearance", …)` 带 `declaredDay`/`clearedDay`/`holdDays`；`service.ts:775` `putAll`；`data-categories.ts:64` 登记类目 |
| `IncomingInspection` | 同上 | ❌ **假**。`battery-extended.ts:181` 带 `arrivedDay`/`releasedDay`；`service.ts:776` `putAll`；`data-categories.ts:70` 登记类目 |
| `PurchaseOrder` | "实测字段仅 `poId/matId/qty/etaDay/delayed`，无发运日、无起运地、无目的地" | ❌ **假**。`battery-extended.ts:157-164` 现声明 `orderDay`/`shipDay`/`arriveDay`/`supplierId`/`sourceMode` —— **发运日与到货日都在** |
| `ASN` | "全仓仅出现在注释里，无对象、无 schema、无数据" | ✅ **仍成立**（现出现在两处注释：`chain-sim.ts:32` / `procurement.ts:3`）。但**采购段并不依赖它** —— 四段腿靠日戳就画得出来，所以它不构成缺席理由 |

**并且没有被契约 strip 掉**：`synthetic/service.ts:706` 物化时 `props: row` —— 整行原样落库，
不按声明字段裁剪；而那些新字段本来也都在 `def(...)` 里声明了。
（本会话踩过的"宿主那份载荷被 zod strip 掉 `evidence[]`"那种形态，**这里不成立**。）

### 1.3 那么，前端手里那份载荷里有没有？—— **没有。但原因和面板说的完全不是一回事。**

这是本单最关键的一步，也是 WO 特意要求分清的那一步：

```
TransitFlowLayer.tsx:255/261/267
    searchObjects("InterBaseTransfer") · searchObjects("Shipment") · searchObjects("WIPLot")
    ← 只有这三条查询。没有 Cadence，没有 CustomsClearance，没有 IncomingInspection。

TransitFlowLayer.tsx:934  （唯一生产调用方 TransitFlowView，registry 键 `transit-flow`）
    <TransitFlowLayer initialDay={initialDay} initialSpeed={initialSpeed} />
    ← **不传 nodes**。

⇒ resolveStations(undefined, batches) 只产出 origin:"data-row" 的站（:231 构造时**没有 cadence 字段**）
⇒ cadenceStations 恒为 []
⇒ `cadenceStations.length === 0` 恒真 ⇒ 节拍缺席面板**永远**在屏上
```

**所以"屏上是空的"这个结论碰巧是对的，但它说的病因是错的。**
数据在库里躺着，只是**这一层从来没问过**。

### 1.4 三种病因，我判成哪一种

按 CLAUDE.md 铁律 0.5 的三分法（并在 UI 侧补出第四档 `PRESENT`）：

| 形态 | 判据 | 本单是不是 |
|---|---|---|
| 没接线 | 符号的调用方集合里只有 test | ❌ 不是。两个 `const` 各有 2 个生产消费方（`TransitFlowLayer.tsx` / `SandboxConsole.tsx`） |
| 接了线没数据 | 有 src 调用方，但输入恒空/恒假 | ◐ **节拍面板是这一档**：条件是真的、数据恒空（宿主不传 `nodes`、本层不查 `Cadence`） |
| **接了线接错地方** | 有 src 调用方，但挂在错误的路径上 | ✅ **主判**：判据挂在"引擎 `nodes` 有没有 cadence"上，而真正的承载在**对象库的 `Cadence` 行**里 —— 查询清单里少了那一条 |
| 纯硬编码 | 无条件渲染、零输入 | ✅ **采购面板是这一档**（无条件 `<div>` ＋ `as const`） |

> **一句话定性**：`G-FRONTEND-HARDCODED-ABSENCE` = **缺席声明被冻成常量**。
> 它不是逻辑写错，是**判断根本没运行**；而咬它的测试查的是借口数量，于是永远绿。

### 1.5 后端 `chain-loss.ts` 的 `STRUCTURAL_GAPS` 是怎么治的，前端该不该照抄

**前一个 agent 这句判断不只成立，而且后端那边已经把病历写在代码里了。**
`apps/datacore/src/solvers/chain-loss.ts:286-290` 原文：

> ⚠ 这三行是**一条过期诊断的修正**，不是新功能：本文件 §3 的 `STRUCTURAL_GAPS` 直到本单之前
> 还写着「清关段在本体里完全不存在：没有对象、没有字段、没有链路承载它 · grep 0 命中（2026-08-05 实测）」，
> 而 D2 在那之后落了 `CustomsClearance` / `IncomingInspection` / `PurchaseOrder` 四段日戳。
> **那句取证在写下的当天是真的，今天是假的** —— 表头自己写着「一旦有了承载物必须从本表删掉并接真数据，
> 否则就变成明明有数据却硬标 EMPTY」。本单执行的就是这句话。

**同一个病、同一份取证、同一天失效**，只是后端已经治完、前端这半还病着。
所以前端**该走同一条路**，而且有现成判例可循。

同族纪律在 `synthetic/cadence.ts:487` 写得最清楚 ——
> "**EMPTY 行照样输出**：诚实缺席要能被查询到（带 `emptyReason`），
> 否则「查过没有」和「压根没登记」在下游分不开 —— 那正是本仓反复栽跟头的地方。"

**该照抄的是这条纪律本身，不是照抄它的实现**：前端不该把"缺席"当成一句结论，
而该把它当成一个**带病因的判定结果**。故本单落成 `AbsenceCause` 四档
（后端那句"查过没有 vs 压根没登记"，在前端正对应 `TENANT_EMPTY` vs `NOT_FETCHED`）。

---

## 2. 改动（治本，不是打补丁）

### 2.1 缺席声明由 `const` 改为**派生函数**

```ts
export type AbsenceCause = "PRESENT" | "NOT_FETCHED" | "CONTRACT_REJECTED" | "TENANT_EMPTY";

export function deriveCadenceAbsence(input?: CadenceAbsenceInput): AbsenceRecord;
export function deriveProcurementBranch(input?: ProcurementAbsenceInput): AbsenceRecord;
```

- `reason` / `evidence` / `unblockedBy` **随病因变**，不再是一句写死的话。
- `probe: { fetched: number | null; usable: number }` —— **`fetched === null` 是"没问过"，`0` 是"问了回 0 条"**。
  这两者此前被混成同一句"没有"，而它们的修法一个是接线、一个是种数据。
- 四档各自给**不同的 `unblockedBy`**：接线 / 修数据或修 schema / 种数据 / 无需补齐。

### 2.2 `parseCadenceRows` —— 让"接线后不改本文件即点亮"成为真话

新增对象库 `Cadence` 行 → 契约 `Cadence` 的读回口，**逐字镜像**
`apps/datacore/src/synthetic/cadence.ts:512 cadenceFromProps`（D1 声明的唯一读回口）：

- `dataMode !== "SYNTHETIC"` ⇒ 无节拍（**不是 0** —— 0 的语义是"随到随办"，等于把节拍当不存在）；
- 落库字段名是 `cadenceKind` **不是** `kind`（摊平时改过名），拼错就恒 0 条；
- 校验走契约 `CadenceSchema`，前端不另写一套判据。

datacore 那个模块前端不可 import（R1 contracts-only-shared），故此处是**受控镜像**，
并配一条门盯着那个函数还在、字段名没漂。

### 2.3 红线原样保留

「**哪个站是限流站只认引擎侧数据**」这条红线不动：`nodes[]` 与对象库 `Cadence` 行**都是引擎侧**，
前端依旧不从批次数据行推断限流站、不维护任何名单。

### 2.4 兼容性

`CADENCE_ABSENCE` / `PROCUREMENT_BRANCH` **保留同名、同字段集**，改为
「本层今天什么都没查」这份**真实输入**的派生结果 ⇒ `cause === "NOT_FETCHED"`。
两个视图文件（本单范围边界外）**零改动**即可编译；
而屏上那句话**病因从假变真**（旧："本体没有" → 新："数据在库里，本层没去取"）。

---

## 3. 证据

### 3.1 接缝驱动（SEAM-GATE）· 两个方向都咬

| 方向 | 断言 |
|---|---|
| **有数据 ⇒ 不出缺席行** | 节拍走 **DOM**：`<TransitFlowLayer nodes={[{nodeId:"b", cadence:{everyDays:5,kind:"shipping"}}]}>` ⇒ `transit-cadence-absence` **从 DOM 消失**、`transit-cadence-live` 上屏、chip 显"每 5 天开闸"。采购走派生层：喂四段日戳 ⇒ `PRESENT` 且 `probe.usable === 4`、`reason` 点名四条腿 |
| **没数据 ⇒ 出缺席行且病因正确** | `cause === "NOT_FETCHED"`、`probe === {fetched: null, usable: 0}`、屏上写"本层没去取"、点名 `PurchaseOrder`/`CustomsClearance`/`IncomingInspection` |
| **三档必须分得开** | `NOT_FETCHED`(fetched=null) ≠ `TENANT_EMPTY`(fetched=0) ≠ `CONTRACT_REJECTED`(取回来读不成)，且三者 `unblockedBy` 各不相同（接线 / 种数据 / 修数据） |

**不是"文案里有某几个字"**：断言的是 DOM 元素的**出现与消失**、`cause` 枚举值、`probe` 计数、
以及 `evidence` 里**来自数据本身**的原因串（如 `emptyReason` 原文"推不出周期"）。

### 3.2 生产实参覆盖（铁律 0.5 第 6 条）

生产渲染的就是 `CADENCE_ABSENCE` / `PROCUREMENT_BRANCH` 这两个值，
故测试**显式对这两个常量**断言 `cause === "NOT_FETCHED"` —— 不是只测函数的其它分支。
（本仓刚吃过 `G-SEED-PROVENANCE-BACKFILL-UNASSERTED` 那个亏：测试三周验的是生产已放弃的那条路。）

### 3.3 事实锁（会红的断言）

文案里引用的每条上游事实，**当场从仓库读出来复验**：

- `apps/datacore/src/synthetic/cadence.ts` 存在 · `service.ts` 含 `putAll("Cadence"` · `cadenceFromProps` 与 `cadenceKind` 字段名没漂；
- `battery-extended.ts` 含 `orderDay`/`shipDay`/`arriveDay` 与 `def("CustomsClearance"`/`def("IncomingInspection"` · `service.ts` 含两条对应 `putAll` · `contracts/procurement.ts` 含四段腿。

⇒ **上游哪天把承载删了，这里当场红，逼着把文案改回去；反向也一样。**
另加反向锁：屏上**不得**出现"本体缺在途承载物"/"节拍在数据层无承载"/"0 命中"。

### 3.4 变异反证 · 失败原文

把派生改回 `const` 字面量（＝病灶原貌），**5 条断言当场红**（`ONEFILE_TEST_RC=1`，`5 failed | 40 passed`）：

```
FAIL  test/transit-flow.seam.test.tsx > 采购支线今天仍为空，但**病因必须说准**：是本层没去取，不是本体没有（D2 已并线）
Error: expect(element).toHaveTextContent()
Expected element to have text content:
  本层没去取
Received:
  采购在途支线 · EMPTY本体缺在途承载物：无 ASN、无清关段、无到货检验段，PurchaseOrder 也没有发运日与起终点。…
  清关（customs）与到货检验（IQC）在 apps/datacore/src 与 packages/contracts/src 均 0 命中 —— 两段完全无承载。…
 ❯ test/transit-flow.seam.test.tsx:312:20

FAIL  test/transit-flow.seam.test.tsx > 节拍：引擎没下发 cadence ⇒ 界面明说 EMPTY，且病因是「本层没去取」而非「数据层无承载」
Expected element to have text content:
  本层没去取
Received:
  节拍闸门 · EMPTY节拍在数据层无承载：Cadence 只有契约、没有对象、没有一条数据。…
 ❯ test/transit-flow.seam.test.tsx:396:21

FAIL  ... > 事实锁 · 节拍承载**确实已在**数据层（上游哪天删了，这里红 ⇒ 逼着把文案改回去）
AssertionError: expected '契约在：CadenceSchema / expectedCadenceWa…' not to match /0 命中|不存在（D1 未并线）/
 ❯ test/transit-flow.seam.test.tsx:545:53

FAIL  ... > 事实锁 · 采购段四段承载**确实已在**（PurchaseOrder 有日戳 · 清关/到货检验是在册对象类型）
AssertionError: expected 'PurchaseOrder 实测字段仅 poId/matId/qty/et…' not to match /0 命中/
 ❯ test/transit-flow.seam.test.tsx:564:56

FAIL  ... > 源码级门 · 缺席文案不许再退回 `const` 字面量（回归锁）
AssertionError: expected 'import {\n  BASE_REGISTRY,\n  Cadence…' to match /export const CADENCE_ABSENCE[^\n]*=\s*deriveCadenceAbsence\(/
 ❯ test/transit-flow.seam.test.tsx:570:19

 Test Files  1 failed (1)      Tests  5 failed | 40 passed (45)
```

变异**已撤回**（先 commit 再变异，`git checkout --` 从 HEAD 恢复，修复未被一起撤掉）。

---

## 4. 没做到的部分（诚实交代）

**视图侧的查询还没接** —— 因为 `TransitFlowLayer.tsx` 不在本单允许改动清单里（越界即退单）。
所以今天屏上依旧是"空"，只是**病因说准了**。真正让面板自愈还差两步，都在视图文件里：

```tsx
// apps/frontend-shell/src/views/sim/TransitFlowLayer.tsx
// ① 补查询（与既有三条同款）
const qCadence = useQuery({ queryKey: [...], queryFn: () => searchObjects("Cadence", ""), enabled: wantFetch });
// ② 把两个 const 换成现算
const cadenceAbsence = deriveCadenceAbsence({ engineNodes: nodes, cadenceRows: qCadence.data?.items });
//   并把 parseCadenceRows(qCadence.data?.items ?? []).nodes 并进 resolveStations 的 engineNodes
```

采购段同理（`PurchaseOrder` / `CustomsClearance` / `IncomingInspection` 三条查询 → `deriveProcurementBranch({…})`）。

**为此留了一条"已知缺口锁"**：测试断言图层**尚未**含这些查询；
**接线那天这条当场红**，红信息里直接写明要同时做什么、并让下一个人删掉它。
—— 这样这个缺口不会靠人记性守着。

另外未做（超出范围，建议另立单）：

- 采购段四条腿目前只判定"画不画得出"，**没有**接成第四个 `TRANSIT_SOURCE_SPEC` 真画车 ——
  那会改动 `TRANSIT_SOURCE_SPECS`，而 `metro-semantics.seam.test.tsx` / `transit-geometry.seam.test.tsx` 都在逐条遍历它。

- **⚠ 已确认还有一处同族病灶，且它现在就在说假话** ——
  `apps/frontend-shell/src/views/sim/inspectorModel.ts:558 CADENCE_ABSENCE_REASON` 原文：

  > "缺承载：`Cadence` 对象全仓 0 条（**运行态实测** `GET /a/v1/objects?type=Cadence` → total 0，**对象类型尚不存在**）。"

  这句话在 D1 并线（`synthetic/service.ts:712` `putAll("Cadence", …)`）之后**已经是假的**，
  而且它比本单治的那两处更容易骗人 —— 它自称是"**运行态实测**"。
  该文件不在本单允许改动清单内，**建议立刻另立一单**，用本单同款 `deriveCadenceAbsence` 收编
  （同文件 `:562 REWORK_ABSENCE_REASON` 经比对与后端 `chain-loss.ts:352` 口径一致，**暂仍成立**，不必动）。

- 全仓未做同形态普查。建议的机械判据：`grep` 取证文案里出现 `0 命中` / `全仓 0 条` / `尚不存在` / `不存在（.*未并线）`
  的 `const`，逐条回仓复验一次 —— 这类句子的保质期等于写下它的那一天。

---

## 5. 本体引用与影响

> 依铁律 0：本节列出触及的对象类型 / 链路 / 事件 / 不变量 / 断点。
> **本单不直接改 `docs/SYSTEM-ONTOLOGY.md`**（WO 明令），以下为**建议措辞**，供审核方回写。

### 5.1 触及的对象类型（§2）

| 对象类型 | 关系 |
|---|---|
| `Cadence` | 读侧新增前端受控读回口 `parseCadenceRows`；落库口 `synthetic/service.ts:712` 不变 |
| `CustomsClearance` · `IncomingInspection` · `PurchaseOrder` | 仅作为**判定输入**被探测（四段腿日戳齐全性），未新增写入 |
| `InterBaseTransfer` · `Shipment` · `WIPLot` | 不变 |

### 5.2 触及的链路（§3）

```
synthetic/cadence.ts deriveChainCadences
  → cadenceObjectRows → service.ts:712 putAll("Cadence")            【已通·D1】
  → objects 库
  → app.ts:1448 cadenceFromProps → buildCadenceGates → 推演 tick    【已通·E4】
  → ✗ 前端 TransitFlowLayer                                        【本单未接通·缺口锁已挂】
      → transitFlow.ts parseCadenceRows → resolveStations → 节拍闸门显示
```

采购段同构：`battery-extended.ts` → `service.ts:773/775/776 putAll` → objects 库 → ✗ 前端。

**断点位置 = 前端查询清单**，不在模块内部 —— 又一次落在接缝上。

### 5.3 事件

无新增、无改动。

### 5.4 不变量

| 不变量 | 本单关系 |
|---|---|
| **R1 contracts-only-shared** | ✅ 遵守。新依赖只取自 `@platform/contracts`（`CadenceSchema` / `DerivedDataModeSchema` / `PROCUREMENT_LEGS`）；datacore 的 `cadenceFromProps` 不可 import，故为**受控镜像 + 门守字段名** |
| **R6 确定性** | ✅ 纯函数、无 `Date.now`、无随机；`parseCadenceRows` 输出按 `nodeId` 全序（测试含打乱输入用例） |
| **R13 结论可溯源** | ✅ **本单核心**。缺席结论现在自带 `cause` + `probe` + 逐条可按 `file:line` 复验的 `evidence`；"为什么这里是空的"从一句写死的话变成**可追的判定** |
| **R14 应用层无业务常数** | ✅ 采购四段腿名取自契约单源 `PROCUREMENT_LEGS`，前端不另立名字 |
| **RL3 单一来源** | ✅ 不造第二套判据：校验走 `CadenceSchema`，段名走 `PROCUREMENT_LEGS` |

### 5.5 断点 —— 建议新增

> **`G-FRONTEND-HARDCODED-ABSENCE`｜假绿第 11 形态：诚实位被冻成常量，于是它成了唯一必然过期的那种谎**

建议措辞（可直接入 §8 表）：

| 编号 | 断点 | 链路位置 | 性质 |
|---|---|---|---|
| `G-FRONTEND-HARDCODED-ABSENCE` | **假绿第 11 形态：诚实位被写成 `const`，从"当时为真"沉默地变成"现在为假"**。`transitFlow.ts` 的 `PROCUREMENT_BRANCH` / `CADENCE_ABSENCE` 把"为什么这块是空的"冻成字面量（`status:"EMPTY" as const` ＋ 三条写死取证），采购面板更是**无条件渲染**。D1（节拍落库 `service.ts:712`）与 D2（采购四段腿 `battery-extended.ts:157-181` ＋ `service.ts:773/775/776`）并线后，屏上那三句"本体没有 / 0 命中"**全部变成假话**，而咬它的断言是 `evidence.length >= 3` —— **查的是借口数量、不是借口真假**，所以永远绿。它与第 9 形态（零生产调用方）、第 10 形态（门的视野被截断）都不同：**代码在跑、门在跑、断言也真的在断言**，只是它断言的那个命题**与真假无关**。⇒ 后果：界面用最理直气壮的语气报了一条假情报，还附三条 `file:line` 让人相信它。**根因判据**：缺席是**每次渲染都要重判的判定**，不是一次性写对的文案；凡把判定结论写成常量，它的保质期就等于"写下它的那一刻"。**修法**：缺席声明一律由输入派生，并**必须区分三档病因** —— 没去取(`NOT_FETCHED`, `fetched===null`) / 取回来被契约剔掉(`CONTRACT_REJECTED`) / 本租户真没有(`TENANT_EMPTY`, `fetched===0`)：**三档修法完全不同**（接线 / 修数据 / 种数据），混成一句"没有"必定修错地方。**给下一个人的判据**：断言"缺席文案里有某几个字"或"取证条数 ≥ N"**一律不算门**；门必须①喂含数据的载荷断言缺席行**消失**，②喂不含的断言**病因正确**，③把文案引用的上游事实**当场从仓库读出来复验**（上游一变即红）。 | `synthetic/service.ts:712` `putAll("Cadence")` · `battery-extended.ts:157-181` --> objects 库 --> ✗ `TransitFlowLayer.tsx` 查询清单 --> `transitFlow.ts` 缺席声明 --> 屏 | ◐ **模型半已闭**（`deriveCadenceAbsence`/`deriveProcurementBranch` ＋ SEAM ＋ 事实锁 ＋ 回归锁，`transit-flow.seam.test.tsx`）；**视图半未接**（图层仍未查 `Cadence`/采购段，已挂"接线即红"的缺口锁） |

### 5.6 对既有断点的影响

- **G-5（前端硬编码业务数据）同族**：本单是它在"诚实位"这个面上的变体 —— 硬编码的不是业务数字，是**关于数据存在性的结论**。建议在 G-5 条目补一句交叉引用。
- **G-SKILL-REFGRAPH-DEAD-EXTRACTOR（第 9 形态）**：不同。那个是零生产调用方；本条**有**生产调用方，只是被调用的东西是个过期常量。
- **G-GATE-PARSER-TRUNCATED-VIEW（第 10 形态）**：不同。那个是门的视野残缺；本条门的视野完整，**是断言的命题本身与真假无关**。

---

## 6. 门与验收

| 项 | 命令 | 结果 |
|---|---|---|
| BUILD | `pnpm --filter frontend-shell build` | **RC=0** |
| TEST（全包） | `pnpm --filter frontend-shell test` | 见交付报告 |
| 变异反证 | 派生 → 写死 `const` | **RC=1，5 failed / 40 passed**（原文见 §3.4） |

> 未跑（工单明令禁止，避免与审核方的四包 gate 互踩）：`scripts/gate.sh`、`pnpm -r test`、任何 `apps/datacore` vitest。
