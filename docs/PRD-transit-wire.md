# PRD · 把「在途/在制」图层真接上已经存在的数据（WO-TRANSIT-WIRE）

> **单号** WO-TRANSIT-WIRE　**基线** `8c9b2264`（＝ WO-FRONTEND-HARDCODED-ABSENCE 的产出）
> **分支** `claude/handoff-wo-transit-wire`　**日期** 2026-08-08
> **范围边界**：`apps/frontend-shell/src/views/sim/TransitFlowLayer.tsx`（含同文件内的宿主视图 `TransitFlowView`）·
> `apps/frontend-shell/src/views/sim/transitFlow.ts` · `apps/frontend-shell/src/views/sim/inspectorModel.ts`（**仅** `CADENCE_ABSENCE_REASON` 一处）·
> 上述文件配套的既有/新建测试 · 本文件。
> **未动**：`SandboxView` / `App` / `ShellLayout` / `mocks/handlers.ts` / `SimInitWizard` / `SimReadinessPanel` /
> `chainNodeSemantics.ts` / `SandboxConsole.*` / `sandboxConsole.ts` / `physicalTopology.ts` /
> 任何 `apps/datacore/` 文件 / `docs/SYSTEM-ONTOLOGY.md`。

---

## 0. 一句话

上一单把病因说准了：**数据在库里，是这一层从来没问过**。
本单就是去问 —— 图层补上四条 `searchObjects`（`Cadence` / `PurchaseOrder` / `CustomsClearance` / `IncomingInspection`），
把结果喂进 `deriveCadenceAbsence(…)` / `deriveProcurementBranch(…)` 现算，
于是那两块面板**从「一句永远为真的话」变成「一个每次渲染重判的结论」**：
取到就让位给真内容，取不到照样缺席但病因分档说清。
上一单挂的「接线即红」缺口锁在接线当天真的红了一次（原文见 §3.2），然后被它自己的失败信息收掉。

---

## 1. 复核上一单结论（自己验一遍，不照抄）

按铁律 0.5 逐条追到定义处重验。**上一单的五条判断我全部认，其中它推翻前人的那一条（④）我复核后同样认。**

| # | 上一单的结论 | 我的复核 | 亲手看到的证据 |
|---|---|---|---|
| ① | `PROCUREMENT_BRANCH` 是写死常量 | ✅ 成立 | 基线 `640acb74` 原文 `status: "EMPTY" as const` ＋ 三条写死取证（`git show 640acb74:…/transitFlow.ts:123-137`） |
| ② | `CADENCE_ABSENCE` 同上 | ✅ 成立 | 同上 `:143-152` |
| ③ | 采购面板 JSX **无条件渲染** | ✅ 成立，且比"硬编码"更重 | 接线前 `TransitFlowLayer.tsx:830` 那个 `<div>` 直接跟在 `)}` 之后，外面**没有任何条件表达式** —— 无论有多少采购数据它都在屏上 |
| ④ | **节拍面板本来就有条件**，前人判"硬编码 JSX"是错的；真因是宿主不传 `nodes` | ✅ **我也认**（这是它推翻前人的那一条） | 接线前 `:551` 原文就是 `{cadenceStations.length === 0 ? (…缺席…) : (…真闸门…)}`，而 `:389` `cadenceStations = stations.filter((s) => s.cadence !== undefined)`；唯一宿主 `TransitFlowView` 在 `:930` 渲染 `<TransitFlowLayer initialDay={…} initialSpeed={…} />` —— **确实不传 `nodes`**。⇒ `resolveStations(undefined, batches)` 只产 `origin:"data-row"` 的站（`:563` 构造时根本没有 `cadence` 字段）⇒ `cadenceStations` 恒 `[]`。**是"接了线没数据"，不是"没接线"，修法完全不同。** |
| ⑤ | 三样"不存在"的东西今天都在 | ✅ 成立 | `synthetic/service.ts:712` `putAll("Cadence", cadenceObjectRows(deriveChainCadences(g)), "nodeId")`；`:773/:775/:776` 三条采购段 `putAll`；`battery-extended.ts:157-164`(`orderDay/shipDay/arriveDay`) / `:169`(`declaredDay/clearedDay`) / `:182`(`arrivedDay/releasedDay`)；下游 `app.ts:1447 buildCadenceGates(await repos.objects.listByType(c.tenantId,"Cadence"))` **已在读** |

**我另外追的一层（上一单没写、但影响我怎么接）**：
`deriveChainCadences`（`synthetic/cadence.ts:393`）对每个 `CADENCE_NODES` 节点要么产 `dataMode:"SYNTHETIC"` 的真周期、
要么产 `dataMode:"EMPTY"` + `emptyReason` 的**诚实缺席行**，两种**都落库**（`cadenceObjectRows:488` 明写"EMPTY 行照样输出"）。
⇒ 前端接线后必然会同时拿到这两类行，所以**「取回来读不成」这一档不是理论分支，是生产必然会走的分支** ——
本单的 `CONTRACT_REJECTED` 有真实生产实参（mock 态实测即命中，见 §3.3）。

---

## 2. 改动

### 2.1 ① 接线 —— 图层真去取那四个对象

```
TransitFlowLayer.tsx
  接线前：searchObjects("InterBaseTransfer" | "Shipment" | "WIPLot")            ← 只有三条
  接线后：＋ searchObjects("Cadence" | "PurchaseOrder" | "CustomsClearance" | "IncomingInspection")
```

配方与既有三条**逐字同款**（`enabled: wantFetch` · `retry:false` · 原因原样透出，不吞成"暂无数据"）。

**新增 `RowsProbe`（本单的关键抽象）**：一份判定输入的**真实来路**。

| `rows` | 语义 | 派生病因 | 修法 |
|---|---|---|---|
| `undefined` | **没拿到**（上层没喂 / 查询没回来 / 失败了） | `NOT_FETCHED` | 接线 |
| `[]` | 问了，回 0 条 | `TENANT_EMPTY` | 种数据 |
| `[…]` 但一条都读不成 | 取回来了，用不了 | `CONTRACT_REJECTED` | 修数据 / 修 schema |
| `[…]` 有可用行 | 不是缺席 | `PRESENT` | 无需补齐 |

外加两个**此前根本没有的诚实位**：
- `loading` —— 查询还在飞时屏上显示「正在取 …」，**不在那一刻宣告"本层没去取"**（那是那一刻的假话）；
- `fetchError` —— 取数失败显式写"判为**没拿到**（不是本租户没有）"，不让失败伪装成业务空结论。

### 2.2 `engineNodes` = 宿主 `nodes[]` ⊕ 对象库 `Cadence` 行

```ts
const engineNodes = 宿主 nodes[] 与 parseCadenceRows(cadenceRows).nodes 的并集（同 nodeId 时保住宿主站序与 label，只补它缺的 cadence）
const stations   = resolveStations(engineNodes, batches)   // ← 此前是 resolveStations(nodes, batches)
```

**红线②原样成立**：两路**都是引擎侧**承载（`nodes[]` 由 F1 线路图下发；`Cadence` 行由种子推导后落库、
`app.ts` 的推演 tick 读的就是同一批）。前端依旧**不从批次数据行推断限流站**、不维护任何名单。
两路都空时保持 `undefined` 而**不退化成 `[]`** —— 后者会让下游把"没问过"读成"问了没有"。

### 2.3 两块面板改为每次渲染现判

- 节拍面板：渲染条件 `cadenceStations.length === 0` **保持不变**（它本来就是对的，见 §1 ④），
  但读的记录换成现算的 `cadenceAbsence`，并把 `cause` / `probe` 挂到 DOM（`data-cause` / `data-fetched` / `data-usable`）。
- 采购面板：由**无条件 `<div>`** 改为按 `status` 分支 —— `EMPTY` 出缺席块，`PRESENT` 出实况块
  `transit-branch-procurement-live`（点名覆盖了哪几条腿 + `data-usable`）。
- 传给 `deriveCadenceAbsence` 的是**原始 `nodes` prop**（不是合并后的 `engineNodes`）：
  probe 是给人复验用的计数，必须对应"我分别问了什么、各回了几条"，合并后会重复计数。

### 2.4 ③ 清掉过期声明

| 位置 | 旧文案（今天为假） | 新文案 |
|---|---|---|
| `inspectorModel.ts:558 CADENCE_ABSENCE_REASON` | 「缺承载：`Cadence` 对象全仓 0 条（**运行态实测** `GET /a/v1/objects?type=Cadence` → total 0，对象类型尚不存在）」 | 「**没接线**（不是没承载）」＋ 指出真缺口在 `buildPlaceholderInspectorInput`（零查询、零 `Cadence` 入参）＋ 写明接线后仍须分开"真周期"与"带 `emptyReason` 的诚实缺席（**无节拍 ≠ 0**）」 |
| `transitFlow.ts` 文件头 ⚠ 两条 | 「本层不查 `Cadence`，宿主也不传 `nodes`」「本层从来没去取过它们」 | 二次修正：这两句**也已过期**，图层现在真的发了那些查询 |
| `transitFlow.ts` `NOT_FETCHED` 两处 `evidence` / `unblockedBy` | 「缺口在前端这一侧：`TransitFlowLayer` 只发了三条 `searchObjects`…」「图层加一条 `searchObjects("Cadence")`…」 | 改成**调用方视角**："本次判定拿到的输入是空的"＋"图层这条路已经接通，落到本档只可能是这次渲染真的一条输入都没拿到" |
| `TransitFlowLayer.tsx` 红线① / 宿主注释 / 宿主屏上文案 | 「采购支线**画不出来**」「引擎未下发站点 ⇒ 站点现场发现、**节拍缺席**」「**节拍一律缺席**」 | 采购段四条腿**算得出来**，今天不画的真实原因换成更小的实话（画车支线只有三条，接第四条是另一单）；宿主改成"**宿主**不下发站点，但节拍改由图层自取 `Cadence` 行" |

⚠ `inspectorModel.ts:562 REWORK_ABSENCE_REASON` 与后端 `chain-loss.ts` 口径一致、**仍然成立** —— **一个字没动**。

### 2.5 兼容性

`CADENCE_ABSENCE` / `PROCUREMENT_BRANCH` 两个模块级导出**保留**：唯一剩下的生产消费方是
`SandboxConsole.tsx:795/:802` 的可算性图例（本单范围边界不许改）。它们的语义被**改窄并写进注释**：
从"生产实际渲染的值"降级为**零输入基线** —— 谁读它，谁就必须承认自己没喂输入。
图层**不许**再读它们（源码级回归锁咬这一条，见 §3.4）。

---

## 3. 证据

### 3.1 接缝驱动（SEAM-GATE）· 两个方向都咬

| 方向 | 断言（`test/transit-flow.seam.test.tsx` 新增 8 例） |
|---|---|
| **有数据 ⇒ 不出缺席行** | 喂 `sources.cadence=[真行]` ⇒ `transit-cadence-absence` **从 DOM 消失**、`transit-cadence-live[data-count=1]` 上屏、chip 显"每 5 天开闸"、`transit-station-b[data-cadence=1][data-origin=engine]`、图层 `data-station-origin="engine"`。喂采购段三类 ⇒ `transit-branch-procurement` **消失**、`…-live[data-usable=4]` 上屏且点名四条腿 |
| **没数据 ⇒ 出缺席行且病因正确** | 三档**在 DOM 上**分得开：`data-cause` ∈ {NOT_FETCHED, TENANT_EMPTY, CONTRACT_REJECTED} × `data-fetched` ∈ {`""`, `"0"`, `"1"`}，且三档屏上不许说同一句话（`TENANT_EMPTY` 显式断言 `not.toHaveTextContent("本层没去取")`） |
| **接线本身**（最要害的一条） | `render(<TransitFlowLayer />)` 走**真取数**（MSW）：props 里**没喂任何东西**，病因却从 `NOT_FETCHED` 变成 `CONTRACT_REJECTED`，且 `data-fetched > 0` —— 这是"那条查询真的发出去了"的活证据，不是我在 props 里自说自话 |
| **诚实位** | 查询在飞的那一刻屏上是 `transit-cadence-fetching` + `data-loading="1"`，**不是**"本层没去取" |
| **不许自相矛盾** | 缺席块在 ⟺ `data-usable === 0`；缺席块不在 ⟺ 实况块在 |

### 3.2 缺口锁被逼红的**失败原文**（接线当天，收掉它之前）

```
 ❯ test/transit-flow.seam.test.tsx (45 tests | 1 failed) 1803ms
   × G-FRONTEND-HARDCODED-ABSENCE · 缺席声明由数据派生，且病因分三档 > ⚠ 已知缺口锁 · 图层尚未查 Cadence/采购段；**接线那天本条当场红**，提醒改调派生函数 11ms

 FAIL  test/transit-flow.seam.test.tsx > G-FRONTEND-HARDCODED-ABSENCE · 缺席声明由数据派生，且病因分三档 > ⚠ 已知缺口锁 · 图层尚未查 Cadence/采购段；**接线那天本条当场红**，提醒改调派生函数
AssertionError: 本条红了 = 有人给图层接上了 Cadence / 采购段查询 —— 这是好事，但必须同时做两件事：
  ① 把 TransitFlowLayer 里的 CADENCE_ABSENCE / PROCUREMENT_BRANCH 换成
     deriveCadenceAbsence({ engineNodes: nodes, cadenceRows }) / deriveProcurementBranch({ … })；
  ② 删掉本条断言（它的唯一职责就是在这一刻红一次）。
否则面板会继续显示 NOT_FETCHED —— 又变回一句写死的假话。: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ test/transit-flow.seam.test.tsx:594:7

 Test Files  1 failed (1)
      Tests  1 failed | 44 passed (45)
```

⇒ **锁真的守住了缺口**：它红的那一刻，红信息本身就是接线清单。①② 两件事都做了，锁按它自己的要求收掉。

### 3.3 生产实参覆盖（铁律 0.5 第 6 条）

- 生产路是"图层自取"，故**测试必须有一条走真 fetch**（§3.1 第三行）—— 只喂 props 的用例**证明不了查询存在**（变异 1 实测正是如此，见 §3.4）。
- mock 态 `/a/v1/objects` 对 `Cadence` **无分支**，落 `else` 返回订单行 ⇒ 一条都读不成闸门 ⇒ 生产实参当场命中 `CONTRACT_REJECTED` 分支（而非只在单测里造一个 `dataMode:"EMPTY"` 行去测它）。

### 3.4 变异反证 · 三条，全部贴失败原文

> 纪律：**先 commit 再变异**（`git checkout --` 从 HEAD 恢复）。三条跑完全部撤销，`git status --porcelain` 空。

#### 变异 1 · 把 ① 的四条查询整体摘掉（回到"本层从来没问过"）

```
  const none = { data: undefined, error: null, isLoading: false };
  const qCadence = none; const qPurchaseOrder = none; const qCustoms = none; const qInspection = none;
```

```
 FAIL  test/transit-flow.seam.test.tsx > WO-TRANSIT-WIRE · … > 接线的活证据 · 真取数（mock 态）：屏上的病因由响应决定，不再是恒为真的 NOT_FETCHED
TestingLibraryElementError: Unable to find an element by: [data-testid="transit-cadence-fetching"]
 ❯ test/transit-flow.seam.test.tsx:750:19

 FAIL  test/transit-flow.seam.test.tsx > WO-TRANSIT-WIRE · … > 源码级门 · 四条查询 + 两处现算必须都在，且图层不许退回去读那两个模块级常量
AssertionError: 图层不再查 Cadence —— 那块面板又变回一句永远为真的话: expected 'import { useCallback, useEffect, useM…' to contain 'searchObjects("Cadence"'

 Test Files  1 failed (1)
      Tests  2 failed | 51 passed (53)
```

**这条变异同时暴露了一件必须写下来的事**：只喂 `sources` 的那批 SEAM 用例**全部还是绿的** ——
它们走 props 路，天然绕过取数。**能咬到"查询没了"的只有真取数那一条 + 源码级门。**
这正是本仓「生产实参必须被测试覆盖」那条戒律的又一个实例：
"这个组件有 SEAM 测试"证明不了"生产走的那条路有测试"。

#### 变异 2 · 把 ③ 的措辞改回旧文案（那句自称"运行态实测"的假话）

```
 FAIL  test/inspector-node-panel.seam.test.tsx > SEAM · K 类节拍：等待期望 = everyDays ÷ 2 > K 类承载 = 缺：初始值 EMPTY，**不给假默认**；拨出来的值一律标 what-if 不冒充实测
Error: expect(element).toHaveTextContent()

Expected element to have text content:
  没接线
Received:
  缺承载：`Cadence` 对象全仓 0 条（运行态实测 `GET /a/v1/objects?type=Cadence` → total 0，对象类型尚不存在）。等待期望公式已由 S0 冻结（`expectedCadenceWaitDays`），但**没有值可以喂给它**——滑杆留着供 what-if，当前值不给假默认。
 ❯ test/inspector-node-panel.seam.test.tsx:154:27

 Test Files  1 failed (1)
      Tests  1 failed | 37 passed (38)
```

#### 变异 3 · 把派生改回 `const` 字面量（＝病灶原貌，取自基线 `640acb74` 的原文），并让面板重新读它

**上一单那 5 条断言全部仍然红**（证明前人的门没被我弄钝），另带我新加的 5 条：

```
 FAIL  … > 采购支线今天仍为空，但**病因必须说准**：是本层没去取，不是本体没有（D2 已并线）        ← 前人①
Error: expect(element).toHaveTextContent()
Expected element to have text content:
  本层没去取
Received:
  采购在途支线 · EMPTY本体缺在途承载物：无 ASN、无清关段、无到货检验段，PurchaseOrder 也没有发运日与起终点。…清关（customs）与到货检验（IQC）在 apps/datacore/src 与 packages/contracts/src 均 0 命中 —— 两段完全无承载。…
 ❯ test/transit-flow.seam.test.tsx:312:20

 FAIL  … > 节拍：引擎没下发 cadence ⇒ 界面明说 EMPTY，且病因是「本层没去取」而非「数据层无承载」   ← 前人②
Expected element to have text content:
  本层没去取
Received:
  节拍闸门 · EMPTY节拍在数据层无承载：Cadence 只有契约、没有对象、没有一条数据。…
 ❯ test/transit-flow.seam.test.tsx:398:21

 FAIL  … > 事实锁 · 节拍承载**确实已在**数据层（上游哪天删了，这里红 ⇒ 逼着把文案改回去）        ← 前人③
AssertionError: expected '契约在：CadenceSchema / expectedCadenceWa…' not to match /0 命中|不存在（D1 未并线）/
 ❯ test/transit-flow.seam.test.tsx:547:53

 FAIL  … > 事实锁 · 采购段四段承载**确实已在**（PurchaseOrder 有日戳 · 清关/到货检验是在册对象类型） ← 前人④
AssertionError: expected 'PurchaseOrder 实测字段仅 poId/matId/qty/et…' not to match /0 命中/
 ❯ test/transit-flow.seam.test.tsx:566:56

 FAIL  … > 源码级门 · 缺席文案不许再退回 `const` 字面量（回归锁）                                  ← 前人⑤
AssertionError: expected 'import {\n  BASE_REGISTRY,\n  Cadence…' to match /export const CADENCE_ABSENCE[^\n]*=\s*deriveCadenceAbsence\(/
 ❯ test/transit-flow.seam.test.tsx:570:19

 ── 另加本单新门 5 条（略去正文，见 EVIDENCE-mut3.log）──
 × SEAM · 采购段三类日戳齐全 ⇒ 缺席块消失、实况块上屏且点名四条腿     → expected <div class="_absence_…"> to be null
 × SEAM · 三档病因在 DOM 上分得开                                    → Expected "本层没去取"，Received 旧写死文案
 × SEAM · 采购段同款三档（且「读不成」时逐条点名缺了哪个日戳）
 × 接线的活证据 · 真取数（mock 态）
 × 源码级门 · 四条查询 + 两处现算必须都在，且图层不许退回去读那两个模块级常量

 Test Files  1 failed (1)
      Tests  10 failed | 43 passed (53)
```

---

## 4. 没做到的部分（诚实交代）

1. **采购段仍不画车**。四条腿的区间位置**算得出来**了，但接成第四条 `TRANSIT_SOURCE_SPEC` 会动
   `TRANSIT_SOURCE_SPECS` 这张表，而 `metro-semantics.seam.test.tsx` / `transit-geometry.seam.test.tsx` 都在
   逐条遍历它 —— 那是另一单的工作量。**这句实话写在屏上**（`transit-branch-procurement-scope`）
   并有断言咬着，不许用旧的"画不出来"糊过去。
2. **取数失败那一档没有自动化测试**。`transit-cadence-fetch-error` / `transit-procurement-fetch-error`
   两个分支已实现且有 `data-loading` 兄弟分支的测试，但让 MSW 对某个 type 返 5xx 需要改
   `mocks/handlers.ts`（本单禁止改）。⇒ **代码在、门不在**，登记为本单的已知薄弱点。
3. **没起真 datacore 实测**。工单明令不许跑 datacore 测试；上游事实全部靠**读源码 + 事实锁断言**复验
   （事实锁会在上游删改时当场红）。真跑一遍 `GET /a/v1/objects?type=Cadence` 看 8 条行**没有做**。
4. **`resolveStations` 的站序影响未在真数据下观察**。接线后 `Cadence` 行会以引擎站身份进入站点集合
   （真 datacore 下约 4 个 SYNTHETIC 节点），环上会多出这几个站。mock 态下这些行全被拒、观察不到，
   **真实观感未验**。这是设计上正确的（闸门站就是站），但没有真跑过。

---

## 5. 本体引用与影响

> 依铁律 0：本节列出触及的对象类型 / 链路 / 事件 / 不变量 / 断点。
> **本单不改 `docs/SYSTEM-ONTOLOGY.md`**（工单明令），以下为**建议措辞**，供审核方回写。

### 5.1 触及的对象类型（§2）

| 对象类型 | 关系 |
|---|---|
| `Cadence` | **新增前端读侧消费方**：`TransitFlowLayer` 经 `GET /a/v1/objects?type=Cadence` 取行 → `parseCadenceRows`（受控镜像 `synthetic/cadence.ts:512 cadenceFromProps`）→ `resolveStations` 引擎侧站点。写侧 `service.ts:712` 不变 |
| `PurchaseOrder` · `CustomsClearance` · `IncomingInspection` | **新增前端读侧消费方**（判定输入：四段腿日戳齐全性）。未新增写入 |
| `InterBaseTransfer` · `Shipment` · `WIPLot` | 不变 |

### 5.2 触及的链路（§3）—— 本单把最后一跳接通

```
synthetic/cadence.ts deriveChainCadences
  → cadenceObjectRows → service.ts:712 putAll("Cadence")                【已通·D1】
  → objects 库
  → app.ts:1447 buildCadenceGates ← cadenceFromProps → 推演 tick        【已通·E4】
  → ✅ 前端 TransitFlowLayer searchObjects("Cadence")                   【本单接通】
      → transitFlow.ts parseCadenceRows → resolveStations(engineNodes) → 节拍闸门显示

battery-extended.ts:157-192 → service.ts:773/775/776 putAll → objects 库
  → ✅ 前端 TransitFlowLayer searchObjects(PurchaseOrder/CustomsClearance/IncomingInspection)  【本单接通】
      → transitFlow.ts deriveProcurementBranch → 采购支线 PRESENT/EMPTY 显示
```

**上一单登记的断点位置（"前端查询清单"）已消除**；剩余缺口下移为"采购段没有画车支线"（§4.1）。

### 5.3 事件

无新增、无改动。

### 5.4 不变量

| 不变量 | 本单关系 |
|---|---|
| **R1 contracts-only-shared** | ✅ 未新增跨包依赖；`parseCadenceRows` 仍是对 datacore 读回口的**受控镜像**，字段名由既有事实锁守着 |
| **R6 确定性** | ✅ 新增逻辑全是纯派生（`rowsProbe` / `engineNodes` 合并均为纯函数式 memo），无 `Date.now`、无随机；`parseCadenceRows` 输出按 `nodeId` 全序 |
| **R13 结论可溯源** | ✅ **本单核心**：缺席结论现在**每次渲染重判**，且 `cause` / `probe.fetched` / `probe.usable` 上 DOM，"为什么这里是空的"可当场亮出并可复验 |
| **R14 应用层无业务常数** | ✅ 采购四段腿名仍取自契约单源 `PROCUREMENT_LEGS`；本单新增的对象类型串（`"Cadence"` 等）是**查询 key 不是业务数据**，与既有三条同款 |
| **RL3 单一来源** | ✅ 不造第二套判据：闸门判据仍只认引擎侧，校验仍走 `CadenceSchema` |
| **红线②（前端零清单）** | ✅ 原样成立：`Cadence` 行是**引擎侧**承载（推演 tick 读的同一批），不是前端维护的名单 |

### 5.5 断点 —— 建议更新 `G-FRONTEND-HARDCODED-ABSENCE`

上一单提议新增该条目（假绿第 11 形态：诚实位被冻成常量）。**建议在回写时直接带上本单的收口状态**：

| 编号 | 建议状态 |
|---|---|
| `G-FRONTEND-HARDCODED-ABSENCE` | ✅ **已闭（模型半 + 视图半）**。模型半：`deriveCadenceAbsence`/`deriveProcurementBranch` 四档病因（WO-FRONTEND-HARDCODED-ABSENCE）。视图半：`TransitFlowLayer` 补四条 `searchObjects` + 每次渲染现算 + 采购面板由无条件 `<div>` 改为条件渲染（**本单**）。门：`transit-flow.seam.test.tsx` 53 例，含**真取数**接缝（props 路证明不了查询存在——变异 1 实测坐实）、三档病因 DOM 可分、源码级双向回归锁（四条查询必须在 ⊕ 图层不许再读那两个模块级常量）。三轮变异反证真红（摘查询→2 红 · 改回旧文案→1 红 · 冻回 `const`→10 红，含前人 5 条全红）。**剩余**：采购段未接成画车支线；取数失败档无门（需改 mock handler，越界）。 |

**给下一个人的判据（建议一并写进条目）**：
> 「缺席」是**判定**不是**文案**。判定必须有输入；输入的三种缺法（没拿到 / 拿到 0 条 / 拿到但读不成）
> 修法完全不同，混成一句"没有"必定修错地方。
> 而且——**只喂 props 的组件测试永远证明不了"那条查询存在"**：必须有一条走真取数的用例，
> 否则把查询整条删掉，SEAM 依然全绿（本单变异 1 实测：51/53 绿）。

### 5.6 对既有断点的影响

- **`G-CHAIN-NODEID-FREESTRING`（✅ 已闭）**：该条目原文记录了 E1 `STRUCTURAL_GAPS` "硬编码诊断"这个同族病灶。
  本单是**同一个病在前端第三处**（前两处：后端 `chain-loss.ts` 已治、前端派生层上一单已治）的收口。建议交叉引用。
- **`G-RENDERER-UNREGISTERED`**：其中"⚠ 另记（本单实测·非本单修）"那段说 mock 态三条支线全 EMPTY
  是 **mock 的缺口不是接线的缺口** —— 本单接线后新增的四条查询在 mock 态同样落 `else` 返回订单行，
  结论一致（`CONTRACT_REJECTED`），该注记依然成立且覆盖面扩大到七个对象类型。
- **`G-PROCUREMENT-OPAQUE`（✅ 已闭）**：其产出（四段腿承载）现在有了**前端消费方**。

---

## 6. 门与验收

| 项 | 命令 | 结果 |
|---|---|---|
| BUILD | `pnpm --filter frontend-shell build` | **RC=0** |
| TEST（全包） | `pnpm --filter frontend-shell test` | **RC=0** · 175 files / **815 tests 全绿** |
| 缺口锁逼红 | 接线后、收锁前 | **RC=1**，`1 failed / 44 passed`（原文 §3.2） |
| 变异 1（摘查询） | — | **RC=1**，`2 failed / 51 passed`（原文 §3.4） |
| 变异 2（改回旧文案） | — | **RC=1**，`1 failed / 37 passed`（原文 §3.4） |
| 变异 3（冻回 `const`） | — | **RC=1**，`10 failed / 43 passed`，含前人 5 条全红（原文 §3.4） |

> 未跑（工单明令禁止，避免与审核方的四包 gate 互踩）：`scripts/gate.sh`、`pnpm -r test`、任何 `apps/datacore` vitest。
