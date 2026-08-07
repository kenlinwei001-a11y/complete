# PRD · 节点语义包最后四样（WO-NODE-SEMANTICS）

> 范围：`/v/sim-sandbox` 控制台右栏 与 独立页 `/v/node-inspector` 共用的**节点检视面板**。
> 上一单（`docs/PRD-sandbox-metro-semantics.md` §3）留了一张七件套字段来源表，其中四格是 ❌/◐：
> `evidence` / `kpi` / `pos` / `cf`。本单把这四格做完，并把**每一格的真源状态原样写在屏上**。
> 几何、五段瀑布、七类变量分类学这些既有件本单**一律复用未重造**。

---

## 0 · 一句话结论

**`evidence` 是本单唯一有真源的一件，也是最值钱的一件**：它让屏上每个天数都能指回
「哪个对象的哪个字段、原值多少、怎么换算成天」。另外三件里 `kpi` 只接到了流指标那几行、
`pos` / `cf` 是**前端编辑口径**（后端今天没有这两个字段），三者在屏上各自明标来源，不混。

---

## 1 · 四格逐格交代（真源 / 做法 / 诚实边界）

| 字段 | 真源状态 | 本单做法 | 诚实边界 |
|---|---|---|---|
| `evidence` | ✅ 引擎已有 · 未上屏 | `chain_loss_attribution.evidence[]` 逐条上屏：`drillType.drillId.drillField` + `drillValue`（原单位真值）+ 单位 + `conversion` 换算式 + 派生边 + 求解器 | **`drillValue` / `conversion` / `drillUnit` / `days` 一律原样透出**，前端零加法零换算；`conversion` 是引擎下发的串，前端不重写一遍 |
| `empty` | ✅ 已有（上一单已上屏一部分） | 同一区块内，没有证据的环节给 `reason` + `probe` 原文 | 不空着、不补 0；`NO_CARRIER` / `NO_INSTANCE` 分开标（修法不同） |
| `kpi` | ◐ 只有流指标接得到 | 6 行，全部来自引擎载荷 + S0 契约函数 | **设计稿里那些数字一个都没抄**（详见 §3）；接不到的指标**这一行根本不出现** |
| `pos` | ❌ 后端无 | 前端语义常量（12/12 在册节点） | 屏上常驻「这是编辑口径，不是引擎下发」 |
| `cf` | ❌ 后端无 | 前端语义常量（6 个节点 · 6 条冲突 · 21 条 `file:line` 依据） | **指不出代码依据的一条都没写**；已否掉一条设计稿里的（§4.3） |

---

## 2 · `evidence` —— R13 下钻三元组上屏（本单头号交付）

### 2.1 实测原文（内存态 `SEED_DEMO=1` · seed 42 · 锚点 `SO-3391`）

引擎实测返回 **26 条**证据 + **8 条**诚实缺席，覆盖 **11/12** 个在册节点 + 10 个动态工序节点。
三种换算档各取一条原文：

```json
{ "stepId":"order.settlement_terms","nodeId":"order.cash","label":"账期等待（回款）","kind":"queue",
  "days":60,"valueAdd":false,"solverKey":"chain_loss_attribution",
  "drillType":"Customer","drillId":"cust_0","drillField":"termDays","drillValue":60,"drillUnit":"day",
  "conversion":"days = Customer.termDays（本就是天，1:1）","derivationEdge":"order_of_customer" }

{ "stepId":"capacity.op.OP-008#work","nodeId":"capacity.op.OP-008","label":"化成·标准作业","kind":"work",
  "days":0.5,"valueAdd":true,"solverKey":"chain_loss_attribution",
  "drillType":"Operation","drillId":"RT-4680-NCM-V1.0-OP-008","drillField":"standardTime",
  "drillValue":720,"drillUnit":"min",
  "conversion":"days = Operation.standardTime / 1440（分钟 → 天）",
  "derivationEdge":"order_for_model → routing_belongs_to_model → operation_belongs_to_routing" }

{ "stepId":"demand.consensus__cadence","nodeId":"demand.consensus","label":"等S&OP 共识会节拍","kind":"cadence",
  "days":7,"valueAdd":false,"solverKey":"chain_loss_attribution",
  "drillType":"Cadence","drillId":"demand.consensus","drillField":"everyDays",
  "drillValue":14,"drillUnit":"cadence_day",
  "conversion":"days = Cadence.everyDays / 2（等待期望；均匀到达假设。offsetDays 是相位，不进公式）",
  "derivationEdge":"Cadence.everyDays → expectedCadenceWaitDays" }
```

**三档必须都在**，否则「透传」与「恰好等于原值」分不开：`day` 档 `days === drillValue`（1:1），
`min` 档差 1440 倍，`cadence_day` 档差 2 倍。门（§5）对这三档逐条对拍。

### 2.2 屏上怎么呈现

一条证据 = 一张卡：

```
账期等待（回款）   [queue]                      60 天
Customer.cust_0.termDays
字段真值  60   [day]
days = Customer.termDays（本就是天，1:1）
派生边：order_of_customer
算出它的求解器：chain_loss_attribution
```

- `drillValue` 与 `conversion` **逐字符是载荷原文**，机器可校（`data-drill-value` / `data-days` 双写）；
- 单位 `drillUnit` 当**不透明串**原样透出：它是求解器侧的枚举（跨包不可 import·R1），
  前端**不复写一份中文词表、更不据它做任何换算** —— 换算的解释由 `conversion` 逐字承担；
- 缺载环节另起一组虚线卡：`EMPTY` + `emptyKind` + `reason` 原文 + `probe` 取证原文。

### 2.3 与设计稿 `o`（承载对象）的关系

设计稿手写的 `o: "LongTermAgreement / DemandSegment"` 这类字符串是 `evidence` 的**弱版本**
（只有对象名、没有实例、没有字段、没有值、没有换算）。本单**不实现 `o`** ——
它已被 `evidence` 完全覆盖，再写一份就是第二个真相源。

---

## 3 · `kpi` —— 接到了什么、没接到什么

### 3.1 接到的（6 行，全部真值）

| 行 | 出处 |
|---|---|
| 本节点前置期 | 契约 `nodeLeadTimeDays(nodes[])` |
| 其中增值 | 契约 `nodeValueAddDays(…)`（增值判据走 `isValueAddKind`） |
| 本节点流动效率 | 契约 `nodeFlowEfficiency(…)`；契约返回 `null` ⇒ **本行不出现** |
| 占全链损失 | `Σ attribution[].pctOfChainLoss`（本节点各段）—— **百分比是引擎给的**，前端只做同节点求和，不定义分母 |
| 本节点环节数 | `nodes[].steps.length` |
| 诚实缺席段 | `empty[]` 条数（>0 ⇒ 本节点前置期是被**低估**的） |

「占全链损失」那一行的出处文案里挂了一句常驻警告：**分母是全链共享的**
（契约 `chainNonValueDays`），任一其它环节的非增值天数一变，本读数跟着变。
这是本单发现的最普遍的一条跨节点耦合，因为它对每个节点都成立，故放在 KPI 出处里而非 `cf` 里
（做成每节点一条 `cf` 只会变成噪音）。

### 3.2 **没接到的（明说）**

设计稿在这一格给的是 `预告量 18,400` / `可信度 未建模` / `毛利率 14.8%` / `底线 11%` /
`在评 24 张` / `信用占用 0.62` / `占用 87.4%` / `延期单 3` / `净需求 1,240吨` / `缺口 86吨` /
`瓶颈 涂布` / `张力峰 97.95` / `换型 12次` / `班次 2班` / `待配 6 单` / `缺件 2 项` ——
**逐条查过后端，没有任何字段承载它们，全部是画稿时编的。一个都没抄。**
门里钉了一条黑名单扫描（`14.8%` / `18,400` / `87.4%` / `97.95` / `1,240吨` / `0.62`），
抄进源码正文即红。

节点不在本次载荷里时（实测 12 个在册节点中 `capacity.maint` 一个如此），
KPI **一行都不出**，代之以一句：「载荷取回来了，但**本节点不在这一次的载荷里**
（锚点订单那条链没有经过它）—— 这不是 0，是没有这个节点。」

---

## 4 · `pos` / `cf` —— 前端语义常量的三条纪律

单一实现：`apps/frontend-shell/src/views/sim/chainNodeSemantics.ts`，文件头第一句就是
**「这是编辑口径，不是引擎下发」**，且该声明常驻上屏（`SEMANTICS_ORIGIN_NOTE`）。

### 4.1 键 ⊆ 契约注册表（编译期 + 运行期双保险）

```ts
export type RegisteredChainNodeId = ChainNodeDef["nodeId"];              // 派生自 CHAIN_NODE_REGISTRY
export const CHAIN_NODE_SEMANTICS: Partial<Record<RegisteredChainNodeId, ChainNodeSemantics>> = { … };
```

- **编译期**：`CHAIN_NODE_REGISTRY` 是 `as const`，故 `ChainNodeDef["nodeId"]` 是 12 个字面量的并。
  写一个不在册的键 → `tsc` 当场红（不用等运行时）。
- **运行期**：门断言 `Object.keys(…) ⊆ CHAIN_NODE_IDS`，**包含**关系不是相等。
- **优雅降级**：`Partial<…>` ⇒ 注册表里有、这里没写语义的节点返回 `undefined`，
  面板对 `pos` / `cf` **整块 `return null`**（不渲染标题、不渲染「暂无」占位）。
  另有一条单正在把注册表从 12 扩到 24 —— 扩表既不会让本文件红，也不会在屏上多出一排空壳。

> 为什么必须是「整块不出现」而不是「显示暂无」：空壳会被读成「系统认为它没有冲突」，
> 而真相是「还没人写」。两件事必须分得开，门的变异反证咬的就是这一条。

### 4.2 六条 `cf`（逐条附依据）

| 节点 | 冲突 | 依据 |
|---|---|---|
| S&OP 共识会 ⊕ 主计划排产 | 同一条规则 C18 的 `cashFloor` 投影到**两个**求解器参数路径（S&OP 版本校验 ⊕ 计划生成硬约束），改一处即改两处判定 | `packages/contracts/src/datacore.ts:206-207` · `apps/datacore/src/sop.ts:299` · `apps/datacore/src/solvers/plan.ts:292` |
| 老化静置 | `Process.agingDays` **一个字段两个消费方**：① 本段天数（1:1）② 老化库位单元速率（占用天数 ⇒ 1/agingDays ⇒ 硬容量）→ 再喂进 C02 卡点判定。压缩静置期同时减损失、抬产能；延长则同时造损失与造卡点 | `packages/contracts/src/process-capacity.ts:60/106/115` · `apps/datacore/src/solvers/chain-impediment.ts:107-120` · `apps/datacore/src/solvers/chain-loss.ts:37` |
| 关键物料补货 | 本段用的是供应商**承诺**前置期（乐观），采购计划那边对同一字段还叠了准时率风险（期望滑期 = 承诺天 ×(1−准时率)）⇒ 两处的数**本来就不相等** | `apps/datacore/src/solvers/chain-loss.ts:506` · `apps/datacore/src/solvers/extended.ts:635` · `packages/contracts/src/procurement.ts:291/295-297` |
| 订单回款 ⊕ 开票对账 | `Customer.termDays` 只承载账期，**不是**结算节拍；两节点字段看着可互换，挪用即口径错标（结算节拍今天诚实 EMPTY） | `apps/datacore/src/synthetic/cadence.ts:308/313/321` · `apps/datacore/src/solvers/chain-loss.ts:424` |
| 计划检修窗 | 它是**真周期但不是产品流的等待**（`flowGate:false`）⇒ 在这里调周期**不改**全链前置期读数，改的是产能侧；摊进环节会凭空多出几十天非增值时间并被归因成 Top1 损失 | `apps/datacore/src/synthetic/cadence.ts:337/344-348` |

门逐条把 `file:line` 拆开、核对**文件真的存在且行号不越界**（实测检到 21 条依据）。

### 4.3 被本单**否掉**的一条（记下来备查）

> ✗ 「补货段的供应商周期同时决定库存目标水位」
> —— `inventory_optimize` 的目标水位读的是 **`Material.leadTime`**
> （`apps/datacore/src/solvers/extended.ts:269`），而损失归因读的是 **`Supplier.leadTime`**
> （`apps/datacore/src/solvers/chain-loss.ts:506`）。**两个对象、两个字段**，不是同一个旋钮。
> 看着完全成立，追一层就不成立 —— 这条写进了常量表的文件头注释，免得下一个人再写一遍。

### 4.4 不给尚未在册的节点提前写语义

设计稿的 `N[]` 有 20+ 个节点（D1–D4 / P1–P5 / S1… ），其中大部分**不在** `CHAIN_NODE_REGISTRY`。
本单**一条都没提前写** —— 等注册表真扩了再补，另立单。提前写等于又在前端立第二套词表（#99 复发）。

---

## 5 · SEAM 门（`apps/frontend-shell/test/node-semantics.seam.test.tsx` · 26 例）

**头号判据**：喂一份**真实抓下来**的 `chain_loss_attribution` 响应
（`test/fixtures/chain-loss-live-evidence.json`，取证头写在 fixture 里），断言
`evidence[]` 里属于该节点的**每一条**都在屏上，且 `drillValue` / `conversion` / `drillUnit` / `days`
**逐字符等于载荷原文**。

| § | 咬什么 |
|---|---|
| §0 | fixture 自证（≥20 条证据 · ≥2 种单位 · 至少一条 `days ≠ drillValue`）—— 防「空数据上假绿」 |
| §1 | 6 个带证据的在册节点逐节点对拍；`drillValueText` 只做透传；宿主给载荷 ⇒ 零请求 |
| §2 | 5 个只有缺席行的节点：`reason` 原文 + `emptyKind` 透出 |
| §3 | `占全链损失 == Σ 引擎 attribution`；不在载荷 ⇒ KPI 一行不出；设计稿数字黑名单；取数失败写原因 |
| §4 | 键 ⊆ 注册表（包含非相等）；每条 `cf` 的 `file:line` 逐条核到文件存在且行号不越界；**没写语义的节点 `pos`/`cf` 整块不渲染** |
| §5 | `buildNodeLiveView` 纯度（两跑字节一致 · 顺序 == 引擎顺序 · `null` ⇒ 全空） |

### 5.1 变异反证（亲手注入 → 见红 → 撤回）

| # | 注入 | 结果 |
|---|---|---|
| ① | `drillValueText` 改成前端自己算一遍（`min` 档 `days×1440`，其余 `days`） | **红 4 例**，原文 `drillValue 被前端改写了：载荷 14 vs 屏上 7` |
| ② | 无语义节点渲染 `pos` 空壳（`?? { pos: "暂无节点定位" }`） | **红 1 例**，原文 `没写语义却渲染了节点定位空壳` |
| ②b | 只拆 `cf` 那道「空即不渲染」的闸 | **红 1 例**，原文 `没写语义却渲染了跨节点冲突空壳`（`data-cf-count="0"` 的空 `<section>` 被打印出来） |
| ③ | 前端把引擎下发的 `conversion` 顺手「润色」一下（全角括号换成斜杠） | **红 6 例**，原文 `conversion 被前端改写了` |

三次注入后均 `git checkout -- <file>` 撤回，`git status --porcelain` 干净，撤完重新 build RC=0。

---

## 6 · 取数路径的诚实交代（本单唯一的一处代价）

R13 证据只能来自 `chain_loss_attribution` 载荷。控制台今天把那份载荷留在 `SandboxConsole` 自己的
state 里（本单**不碰**那个文件，有别的 dev 在改），故 `NodeInspectorView` **自取一次**该求解器
（`{}` 无参 = 引擎按 `so` 字典序选锚点，R6 确定性）。

- 这一次请求的代价**明写在屏上**：「本区块的 R13 证据由本视图自取一次 `chain_loss_attribution`
  （宿主接上 `lossPayload` 后这次请求即消失）」；
- 面板已开好 `lossPayload` prop：宿主一传，自取路径当场关闭，屏上文案切换为
  「复用宿主已取回的那一份 —— 未发第二次请求」，门里有一例专门咬这条（`net.calls` 必须为空）；
- 无 debounce、无定时器（避免 leak-guard 那类残留句柄），卸载即 `abort`；
- 取数失败**不弹 toast**，就在这一格里写清失败原因 —— 右栏的一格不该打扰整页。

**遗留**：等 `SandboxConsole` 那边把 `loss` 传下来（一行 prop），这次请求即可消除。已在报告里点名。

---

## 7 · 本体引用与影响

- **对象类型**：`ChainNode` / `ChainStep` / `LossAttribution` / `ChainScope`（S0 冻结，**只读不改**）；
  `Cadence`（D1 已落库，本单实测到 3 条 `cadence_day` 证据）；
  `Customer.termDays` / `Operation.standardTime|setupTime` / `Process.agingDays` / `Supplier.leadTime`
  （证据的四类承载对象）。**本单零新增对象类型。**
- **链路**：
  `ViewPage → registry("sim-sandbox") → SandboxView → SandboxConsole → NodeInspectorView`
  → `runSolver → B /b/v1/solvers/chain_loss_attribution/run → OBO → A /a/v1/solvers/.../invoke`
  （**本单新增的一条取数边**，见 §6；宿主传 `lossPayload` 即消失）。
  独立页 `ViewPage → registry("node-inspector") → NodeInspectorView` 同链。
- **事件**：无新增、无订阅变更。
- **不变量**：
  - **R1** 跨包只依赖 `@platform/contracts`：`drillUnit` 是求解器侧枚举，故当**不透明串**处理，
    前端不复写词表、不据它换算；
  - **R6** `buildNodeLiveView` / `buildNodeKpis` 全纯函数，无时钟无随机，不排序（保留引擎给的顺序）；
  - **R13** `drillValue` / `conversion` / `drillUnit` / `days` **逐字符透传**，前端零加法零换算；
    `pos` / `cf` 明标编辑口径，与引擎证据在屏上分得开；
  - **R14** 零业务常数、零硬编码色值（全走 `tokens.css` 的 `:root` token）；
  - **RL3 / RL5** 复用既有派生层（`inspectorModel` / `chainNodeSemantics`），前置期 / 增值 /
    流动效率 / 增值判据一律走 S0 契约的唯一实现，前端不写第二份除法。
- **门禁**：新增 `node-semantics.seam`（26 例）。既有 `inspector-node-panel.seam`（38 例）/
  `node-inspector-reachable`（6 例）/ `chain-line-map.seam` / `metro-semantics.seam` /
  `sandbox-console.seam` / `sandbox-view` 全绿未回归。
- **断点**：
  - 既有 `G-RENDERER-UNREGISTERED` 不受影响（registry 键未动）。
  - 既有「两求解器无共同 id 维度」（上一单记的）不受影响：本单只用 `chain_loss_attribution` 一个源。
  - **新记一条（本单实测）**：`chain_loss_attribution` 的 `evidence[]` / `empty[]`
    **没有进 contracts**（形状只在 `apps/datacore/src/solvers/chain-loss.ts` 里）。
    于是前端有**两处**各自宽松读取它（`chainLineMap.ts` 读 `empty[]`，
    `inspectorModel.ts` 读 `evidence[]` + `empty[]`）。今天两处只读自己要的那几列、互不冲突，
    但这是「同一个形状两处各声明一份」的形态 —— 它进 contracts 那天，两处应一起换成契约 schema。
    本单**不擅自**把它搬进 contracts（跨包改动不在本单边界）。

> ⚠ 本文档新增了一条链路边与一道门禁，按铁律 0 应回写 `docs/SYSTEM-ONTOLOGY.md` §3/§7/§8。
> 本单工单明令 `docs/SYSTEM-ONTOLOGY.md` 属「绝对不碰」（有别的 dev 同时在改），故**未回写**，
> 在交付报告里点名交由审核方并线时补。
