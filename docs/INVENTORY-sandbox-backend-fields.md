# 推演沙盘 `/v/sim-sandbox` · 后端可展示字段全台账

> **本单存在的理由**（仓主定的边界）：
> 「**后端无需变，前端需要变，展示的信息需要完整，只是 UI 和 UX 需要重新设计，不能遗漏后端可展示的信息**」
>
> 要判定「有没有遗漏」，就必须先有一份「后端能给什么」的完整台账。这就是本文件。
> **本文件只清点，不改代码。**

## 取证基准（所有 `file:line` 只对这一个 commit 有效）

| 项 | 值 |
|---|---|
| **取证 commit** | `866b6840de4501bedb29a6df2028e19fcfd5df82` |
| 来源分支 | `origin/claude/handoff-sandbox-batch-a2s3` |
| 本单分支 | `claude/handoff-sandbox-field-inventory` |
| 日期 | 2026-08-08 |

**为什么要写这一条**：本仓的沙盘代码**不在 `origin/main`**。默认 worktree 停在
`778cc589c6c06089304ddbc666cf7d0721ad492d`，在那个 commit 上
`apps/frontend-shell/src/views/sim/SandboxConsole.tsx` **不存在**（`git rev-parse --verify -q` RC=1，
而同一条命令对 `CLAUDE.md` RC=0 —— 金丝雀证明工具没坏，是文件真不在）。
在那个 commit 上干活会把整套沙盘读成「不存在」，得出与事实完全相反的结论。

---

## 0 · 一句话结论

后端在这一页上**能给 237 个字段**（叶子级，含可选字段），**今天屏上有 88 个**。
剩下 149 个里，**113 个是「取到了但没显示」**（纯前端渲染缺口，后端一行不用改），
**36 个是「根本没取」**——**36/36 全部断在前端自己的 zod schema 上**：响应里有，
被 `z.object` 的 strip 语义当场剥掉，补齐平均每个 1 行。

**没有一个字段是「后端没有」。** 这与仓主的判断一致：后端无需变。

| 能力 | 契约字段总数 | 已显示 | 取到了但没显示 | 根本没取 |
|---|---:|---:|---:|---:|
| A · `chain_loss_attribution`（E1 求解器） | 68 | 34 | 6 | 28 |
| B · `chain_impediments`（E3 求解器） | 96 | 12 | 76 | 8 |
| C · `GET /a/v1/sim/view-config` | 9 | 5 | 4 | 0 |
| D · `GET /a/v1/sim/sessions/{id}/certification` | 31 | 28 | 3 | 0 |
| E · 会话族（建会话 / tick / checkpoint / branch / compare） | 33 | 9 | 24 | 0 |
| **合计** | **237** | **88** | **113** | **36** |

> 三态的定义（**修法完全不同，不许混为一谈** · CLAUDE.md 铁律 0.5 同源）：
> - **已显示** —— 屏上有可读的呈现（文本 / 图元 / 徽标）。
> - **取到了但没显示** —— 值已进到某个 JS 变量，组件本可以读，但没有任何 JSX 渲染它。**修法 = 加渲染。**
> - **根本没取** —— 值从未进到任何 JS 变量。本页**全部**属于「前端 zod schema 未声明 ⇒ 被 strip 剥掉」，
>   **不是**后端没给。**修法 = schema 补一行，然后加渲染。**

---

## 1 · 范围界定：这一页今天**真调用**的后端能力

判据是**追到发请求那一行**，不是「看起来相关」。

### 1.1 页面入口链

`App.tsx:128` `{ path: "v/sim-sandbox", element: <SimSandboxGuard /> }`
→ `App.tsx:110-116` `SimSandboxGuard`（entitlement `sim.sandbox` 关 ⇒ 404）
→ `SandboxView.tsx:228` `SandboxView`（会话与推演逻辑 + 取数）
→ `SandboxView.tsx:593` `<SandboxConsole>`（布局 + 两个链路求解器）

### 1.2 真调用清单

| # | 能力 | 端点 / 求解器 key | 发起处（file:line） | 触发条件 |
|---|---|---|---|---|
| C | 沙盘视图配置 | `GET /a/v1/sim/view-config` | `SandboxView.tsx:231` | 挂载即取 |
| E1 | 建会话 | `POST /a/v1/sim/sessions` | `SandboxView.tsx:308` | `cfg && !sessionId` |
| D | 就绪认证 | `GET …/certification?scope&target` | `SandboxView.tsx:317` / `:365` | 建会话后 / 切范围 |
| E2 | 推进 tick | `simTick` | `SandboxView.tsx:380` | 点「推进 tick」 |
| E3 | 存检查点 | `simCheckpoint` | `SandboxView.tsx:395` / `:407` | 点「存档」/「分支」 |
| E4 | 分支 | `simBranch` | `SandboxView.tsx:408` | 点「分支」 |
| E5 | 多场景对比 | `fetchSimCompare` | `SandboxView.tsx:410` / `:424` | 分支后 / 点刷新 |
| B | **阻滞点扫描** | 求解器 `chain_impediments` | `SandboxConsole.tsx:263` | 挂载即取（`baseIds` 变即重取） |
| A | **全链损失归因** | 求解器 `chain_loss_attribution` | `ChainLineMapView.tsx:404` | metro 模式默认挂载 |
| A′ | 产品族同心环（每族一次） | 同上 | `ChainLineMapView.tsx:455` | 勾「产品族同心环」 |
| — | 族锚点发现 | `searchObjects("Order")` | `chainFamilyLines.ts:105` | 勾「产品族同心环」 |
| — | 物理拓扑 | `searchObjects("Workshop")` | `PhysicalTopologyView.tsx:75` | 切「物理拓扑」模式 |
| — | 在途图层 ×7 | `searchObjects` × 7 类对象 | `TransitFlowLayer.tsx:311/317/323/346/352/358/364` | 勾「在途批次图层」 |
| — | AI 指挥台 | `POST` QOS `submitQuery` | `SandboxView.tsx:186` | `sim.commander` 开 且 点「指挥」 |
| — | 采纳 → Action 草稿 | `useActionDraft` | `SandboxView.tsx:433` | 点「采纳」（**写路径，非展示**） |

**本台账逐字段展开 A / B / C / D / E 五项**（= 沙盘自有的展示型契约）。
`searchObjects` 系（族线 / 物理拓扑 / 在途图层）是**复用组件自带的取数**，
它们的字段账已由各自组件的诚实位承担（`TRANSIT_SOURCE_SPECS` 三档可算性 / 物理拓扑占位横幅），
且**都不是沙盘独有的契约**，故本单不重复展开 —— 这是一条**明说的边界**，不是遗漏。

### 1.3 一条必须点名的取数结构

`chain_loss_attribution` **不由 `SandboxConsole` 自己发**：
它由画布里的 `ChainLineMapView` 取（`ChainLineMapView.tsx:404`），
经 `onPayload` 回抛给宿主（`ChainLineMapView.tsx:426` → `SandboxConsole.tsx:605` `onPayload={setLoss}`）。
底部 Pareto、顶栏前置期/流动效率、链路阶段画布、右栏节点检视**共用这一份**。

**这个结构本身是对的**（口径单源、不发第二次请求），
**但它同时是本页最大单点信息损失的所在** —— 见 §3.1。

---

## 2 · 逐能力字段台账

### A · `chain_loss_attribution`（E1）

- **后端输出形状单源**：`apps/datacore/src/solvers/chain-loss.ts:224` `ChainLossResult`
- **前端读取层**：`apps/frontend-shell/src/views/sim/chainLineMap.ts:86` `ChainLossPayloadSchema`（`z.object` ⇒ **strip**）
- **契约级 schema**：`packages/contracts/src/chain-sim.ts` 的 `ChainNodeSchema` / `ChainStepSchema` / `LossAttributionSchema`
  （`nodes[]` / `attribution[]` 走契约；`anchor` / `evidence[]` / `empty[]` / `totals` / `conservation` / `summary` **没进 contracts**，是求解器侧形状）

#### A.1 `anchor`（13 字段）

| 字段路径 | 类型 | 含义 | 屏上显示了吗 | 显示在哪 | 若没显示，为什么 |
|---|---|---|---|---|---|
| `anchor.so` | string | 锚点订单号 | **已显示** | `ChainLineMapView.tsx:674`（`clm-anchor`）；`InspectorNodePanel.tsx:259` | — |
| `anchor.selection` | string | 锚点**怎么选出来的**（R6 可复现） | 取到了但没显示 | — | schema 声明了（`chainLineMap.ts:108`）故值在，但无任何 JSX 读它 |
| `anchor.cust` | string | 客户名 | **根本没取** | — | `chainLineMap.ts:108` 的 `anchor` 子 schema 只声明 `so`/`selection` ⇒ 其余 11 键被 strip |
| `anchor.customerId` | string\|null | 客户对象 id | 根本没取 | — | 同上 |
| `anchor.modelId` | string\|null | 型号 id | 根本没取 | — | 同上 |
| `anchor.routingId` | string\|null | 工艺路线 id | 根本没取 | — | 同上 |
| `anchor.materialId` | string\|null | 关键物料 id | 根本没取 | — | 同上 |
| `anchor.supplierId` | string\|null | 主供供应商 id | 根本没取 | — | 同上 |
| `anchor.baseId` | string\|null | 基地 id | 根本没取 | — | 同上 |
| `anchor.agingProcessId` | string\|null | 老化工序 id | 根本没取 | — | 同上 |
| `anchor.purchaseOrderId` | string\|null | 采购三腿所锚采购单 | 根本没取 | — | 同上 |
| `anchor.customsClearanceId` | string\|null | 清关单 id | 根本没取 | — | 同上 |
| `anchor.incomingInspectionId` | string\|null | 到货检验 id | 根本没取 | — | 同上 |

> **这一格的价值被低估了**：`anchor` 的 12 个 id 是「这条链是沿哪些真对象算出来的」的**完整溯源锚**
> （`chain-loss.ts:197-222`）。今天屏上只有一个订单号。
> 后端甚至在注释里专门记了一笔**种子里的真实不一致**（主供 ≠ 实际承接方，`chain-loss.ts:208-215`）——
> 那条诚实位今天在屏上**完全看不见**，因为承载它的两个 id 都被 strip 了。

#### A.2 `nodes[]`（15 字段，含 `steps[]` 与 `cadence` 展开）

| 字段路径 | 类型 | 含义 | 屏上显示了吗 | 显示在哪 | 若没显示，为什么 |
|---|---|---|---|---|---|
| `nodes[].nodeId` | string | 节点 canonical id | **已显示** | `SandboxConsole.tsx:762`（`sc-inspect-node-id`）；`InspectorNodePanel.tsx:560` | — |
| `nodes[].label` | string | 节点人读名 | **已显示** | `SandboxConsole.tsx:693` 卡片名；metro 站名 | — |
| `nodes[].stage` | enum(5) | 所属链段 | **已显示** | `SandboxConsole.tsx:1264` 「所属段」；lane 分组 | — |
| `nodes[].scope.businessTypes` | string[]? | 该节点归属业务线 | **已显示** | `ChainLineMapView.tsx:884-885` **悬浮提示**（换乘站 `sharedBasis`） | 仅 hover 可见 |
| `nodes[].scope.baseIds` | string[]? | 该节点归属基地 | **已显示** | 同上 | 仅 hover 可见 |
| `nodes[].scope.modelIds` | string[]? | 该节点归属型号 | **已显示** | 同上 | 仅 hover 可见 |
| `nodes[].steps[].stepId` | string | 环节 id | 取到了但没显示 | 仅作 React key / `data-testid` | 不透明键，无可读呈现 |
| `nodes[].steps[].nodeId` | string | 冗余回指 | 取到了但没显示 | — | 与父节点重复 |
| `nodes[].steps[].label` | string? | 环节名 | **已显示** | `SandboxConsole.tsx:1321` 逐环节表「环节」列 | — |
| `nodes[].steps[].kind` | enum(5) | 五段类型 | **已显示** | `SandboxConsole.tsx:1322` 「类型」列 | — |
| `nodes[].steps[].days` | number | 该段天数（期望态） | **已显示** | `SandboxConsole.tsx:1323` 「天数」列 | — |
| `nodes[].steps[].valueAdd` | boolean | 是否增值 | **已显示** | `SandboxConsole.tsx:1320` `data-value-add` + 增值徽标 | — |
| `nodes[].steps[].cadence.everyDays` | number | 节拍周期 | **已显示** | `ChainLineMapView.tsx:873-877` 悬浮；`SandboxConsole.tsx:1321` `title` 属性 | **仅 hover / title**，无常驻呈现 |
| `nodes[].steps[].cadence.kind` | enum(4) | 节拍类型 | **已显示** | `sandboxConsole.ts:280` `cadenceLabel` → `title` 属性 | 仅 title |
| `nodes[].steps[].cadence.offsetDays` | number? | 周期内**相位** | 取到了但没显示 | — | `sandboxConsole.ts:280` 拼 `cadenceLabel` 时**只取 `kind` 与 `everyDays`**，漏了它 |

#### A.3 `attribution[]`（3 字段）

| 字段路径 | 类型 | 含义 | 屏上显示了吗 | 显示在哪 | 若没显示，为什么 |
|---|---|---|---|---|---|
| `attribution[].stepId` | string | 关联环节 | 取到了但没显示 | 仅作 join 键 | 不透明键 |
| `attribution[].nonValueDays` | number | 该环节非增值天数 | **已显示** | `SandboxConsole.tsx:840` Pareto 柱 `title` | **仅 title** |
| `attribution[].pctOfChainLoss` | number | 占全链损失% | **已显示** | `SandboxConsole.tsx:843` Pareto；`:1330` 逐环节表「影响率」 | — |

#### A.4 `evidence[]`（17 字段）—— **本页信息损失的重灾区**

**在沙盘页上：17/17 全部「根本没取」。**
断点：`chainLineMap.ts:86` 的 `ChainLossPayloadSchema` **没有声明 `evidence` 键**，
zod `z.object` 按 strip 语义在 `ChainLineMapView.tsx:407` 解析时当场剥掉，
`:426` 回抛给宿主的已经是剥过的那一份。

| 字段路径 | 类型 | 含义 | 沙盘页 | 独立页 `/v/node-inspector` |
|---|---|---|---|---|
| `evidence[].stepId` | string | 环节 id | 根本没取 | 取到了但没显示（仅 key） |
| `evidence[].nodeId` | string | 节点 id | 根本没取 | 取到了但没显示（用于筛选） |
| `evidence[].stage` | enum | 所属段 | 根本没取 | **根本没取**（`inspectorModel.ts:971` 也没声明） |
| `evidence[].label` | string | 环节名 | 根本没取 | 已显示 `InspectorNodePanel.tsx:282` |
| `evidence[].kind` | string | 五段类型 | 根本没取 | 已显示 `:283` |
| `evidence[].days` | number | 该段天数 | 根本没取 | 已显示 `:285` |
| `evidence[].valueAdd` | boolean | 是否增值 | 根本没取 | 已显示 `:284` |
| `evidence[].solverKey` | string | 算出它的求解器 | 根本没取 | 已显示 `:307` |
| `evidence[].drillType` | string | **下钻三元组①** 对象类型 | 根本没取 | 已显示 `:288` |
| `evidence[].drillId` | string | **下钻三元组②** 对象 id | 根本没取 | 已显示 `:288` |
| `evidence[].drillField` | string | **下钻三元组③** 字段名 | 根本没取 | 已显示 `:288` |
| `evidence[].drillValue` | number | 该字段在仓储里的**真值本身** | 根本没取 | 已显示 `:292-294` |
| `evidence[].drillUnit` | string | `drillValue` 的单位 | 根本没取 | 已显示 `:295-297` |
| `evidence[].drillFieldEnd` | string? | 日戳跨度**终点字段名** | 根本没取 | **根本没取**（`inspectorModel.ts:971` 未声明） |
| `evidence[].drillValueEnd` | number? | 终点字段真值 | 根本没取 | **根本没取**（同上） |
| `evidence[].conversion` | string | `drillValue → days` 换算式 | 根本没取 | 已显示 `:299-301` |
| `evidence[].derivationEdge` | string | 沿本体走到该对象的派生边 | 根本没取 | 已显示 `:302-305` |

> **实测数据支撑**（`apps/frontend-shell/test/fixtures/chain-loss-real.json`，seed 42 真载荷）：
> `evidence` **28 行**，`drillUnit` 四种（`day` / `min` / `cadence_day` / `day_stamp_span`）都出现了，
> 其中 **2 行带 `drillFieldEnd` + `drillValueEnd`**（采购三腿的日戳跨度）。
> ⇒ `drillFieldEnd`/`drillValueEnd` **不是理论上的可选字段，是真实存在的数据**，
> 而它们在**两条前端路径上都被剥掉**了。

#### A.5 `empty[]`（9 字段）—— 本页做得最好的一块

| 字段路径 | 类型 | 含义 | 屏上显示了吗 | 显示在哪 |
|---|---|---|---|---|
| `empty[].stepId` | string | 环节 id | 取到了但没显示 | 仅 key / testid |
| `empty[].nodeId` | string | 节点 id | **已显示** | `SandboxConsole.tsx:1095` 灰卡片节点名 |
| `empty[].stage` | enum | 所属段 | **已显示** | lane 归属 `sandboxConsole.ts:343` |
| `empty[].label` | string | 环节名 | **已显示** | `SandboxConsole.tsx:1106` |
| `empty[].kind` | string | 五段类型 | **已显示** | `InspectorNodePanel.tsx:319` |
| `empty[].dataMode` | `"EMPTY"` | 诚实位 | **已显示** | `SandboxConsole.tsx:1098` EMPTY 徽标 |
| `empty[].emptyKind` | `NO_CARRIER`\|`NO_INSTANCE` | 缺席形态 | **已显示** | `SandboxConsole.tsx:1106`、`:1104` `data-empty-kind` |
| `empty[].reason` | string | 为什么算不出来 | **已显示** | `SandboxConsole.tsx:1109`（**原文透传**） |
| `empty[].probe` | string? | 怎么确认它没有的 | **已显示** | `SandboxConsole.tsx:1110`（**原文透传**） |

> 实测 16 行（`NO_CARRIER` 14 / `NO_INSTANCE` 2），16 行全带 `probe`。
> **这一块是全页的标杆**：三态形状分家（实心卡 / 缺角灰卡 / 在册不在场单列一行），
> 原文逐字透传，未补 0。重设计时**这套语义一个字都不能丢**。

#### A.6 `totals`（6）与 `conservation`（4）与 `summary`（1）—— 全部已显示

| 字段路径 | 屏上显示了吗 | 显示在哪 |
|---|---|---|
| `totals.leadTimeDays` | 已显示 | `SandboxConsole.tsx:381`(顶栏)、`:870`(指标卡) |
| `totals.valueAddDays` | 已显示 | `:424`、`:871` |
| `totals.nonValueDays` | 已显示 | `:872` |
| `totals.flowEfficiency` | 已显示 | `:381`、`:419`、`:873` |
| `totals.stepCount` | 已显示 | `:876` |
| `totals.emptyCount` | 已显示 | `:876` |
| `conservation.sumPct` | 已显示 | `:859`；`ChainLineMapView.tsx:676` |
| `conservation.residual` | 已显示 | `ChainLineMapView.tsx:677` |
| `conservation.tolerancePct` | 已显示 | `ChainLineMapView.tsx:678` |
| `conservation.ok` | 已显示 | `SandboxConsole.tsx:860`；`ChainLineMapView.tsx:675` |
| `summary` | 已显示 | `ChainLineMapView.tsx:926-928`（`clm-engine-summary`） |

---

### B · `chain_impediments`（E3）

- **后端输出形状单源**：`apps/datacore/src/solvers/chain-impediment.ts:447` `ChainScanResult`
- **前端读取层**：`apps/frontend-shell/src/views/sim/chainImpediment.ts:94` `ChainImpedimentPayloadSchema`
- **契约级 schema**：`packages/contracts/src/chain-sim.ts:832` `ChainImpedimentSchema`（`z.strictObject`）
- **视图模型**：`chainImpediment.ts:334` `buildChainImpedimentModel` → `ChainImpedimentModel`

> ⚠ **本能力是全页最严重的展示缺口**：96 个字段里只有 **12 个**上屏，**76 个「取到了但没显示」**。
> 派生层 `chainImpediment.ts` 把它们**全都算好了**（`ImpedimentVM` / `ImpedimentGroup` /
> `ChainImpedimentModel` 逐字段齐备、还带 `notes[]` 与 `countMismatch` 两条自检），
> 但 `SandboxConsole` 只消费了其中 12 个。**这是纯渲染缺口，不是数据缺口。**

#### B.1 顶层（35 字段）

| 字段路径 | 类型 | 含义 | 屏上显示了吗 | 显示在哪 / 为什么没显示 |
|---|---|---|---|---|
| `scanId` | string | 本次扫描 id | 取到了但没显示 | `model.scanId` 已备（`chainImpediment.ts:428`），无 JSX 读它 |
| `scope.businessTypes` | string[]? | 扫描范围·业务线 | 取到了但没显示 | `model.scope` 已备；`formatScope()` 已实现（`:451`）**但只有独立页 `ChainImpedimentView.tsx:312` 在用** |
| `scope.baseIds` | string[]? | 扫描范围·基地 | 取到了但没显示 | 同上 |
| `scope.modelIds` | string[]? | 扫描范围·型号 | 取到了但没显示 | 同上 |
| `scopeUnscoped` | boolean | 是否未限定（全域） | 取到了但没显示 | 后端确实回带（`chain-impediment.ts:797`） |
| `ruleSetVersion` | string? | 规则集版本 | 取到了但没显示 | `model.ruleSetVersion` 已备 |
| `counts.total` | number | 引擎计数·总 | 取到了但没显示 | 只用于算 `countMismatch`，而 `countMismatch` **也没渲染** |
| `counts.BOTTLENECK` | number | 卡点数 | **已显示** | `SandboxConsole.tsx:408`（`sc-imp-BOTTLENECK-count`） |
| `counts.CONGESTION` | number | 堵点数 | **已显示** | 同上 |
| `counts.BREAK` | number | 断点数 | **已显示** | 同上 |
| `unresolved[].bindingId` | string | 判不出的判据 id | 取到了但没显示 | 屏上**只有条数**（`:444`、`:881`） |
| `unresolved[].kind` | enum | 属哪一类 | 取到了但没显示 | 用于分组（`:381`），未渲染 |
| `unresolved[].breakSubtype` | enum? | 断点亚型 | 取到了但没显示 | — |
| `unresolved[].stage` | string? | 落在哪段 | 取到了但没显示 | — |
| `unresolved[].ruleKey` | string? | 规则码 | 取到了但没显示 | — |
| `unresolved[].status` | `"UNKNOWN"` | 状态 | 取到了但没显示 | — |
| `unresolved[].reason` | string | **为什么判不出来** | 取到了但没显示 | 这是「诚实缺席」的正文，今天只剩一个计数 |
| `caveats[].bindingId` | string | 被削弱判据 id | 取到了但没显示 | — |
| `caveats[].ruleKey` | string | 规则码 | 取到了但没显示 | 用于 join `honesty.detail`（`:349`），而 detail 未渲染 |
| `caveats[].note` | string | **削弱原因引擎原文** | 取到了但没显示 | `honestyOf()` 已把它装进 `honesty.detail`（`:243`），屏上无出口 |
| `thresholds[].bindingId` | string | 判据 id | 取到了但没显示 | — |
| `thresholds[].ruleKey` | string | 规则码 | 取到了但没显示 | — |
| `thresholds[].source` | `param`\|`literal`\|`field` | **旋钮在哪** | 取到了但没显示 | `THRESHOLD_SOURCE_LABEL` 中文表已写好（`:168`），零消费方 |
| `thresholds[].ruleParamKey` | string? | params 命名键 | 取到了但没显示 | — |
| `thresholds[].fieldPath` | string? | 对象属性路径 | 取到了但没显示 | — |
| `thresholds[].value` | number | 阈值 | 取到了但没显示 | — |
| `thresholds[].unit` | string | 单位 | 取到了但没显示 | — |
| `candidateStats[].impedimentId` | string | 候选枚举逐点账 | **根本没取** | `ChainImpedimentPayloadSchema` 未声明 ⇒ strip |
| `candidateStats[].anchors` | number | 探了几个杠杆锚点 | 根本没取 | 同上 |
| `candidateStats[].probes` | number | 几次试算 | 根本没取 | 同上 |
| `candidateStats[].effective` | number | 有效几个 | 根本没取 | 同上 |
| `candidateStats[].emitted` | number | 下发几个 | 根本没取 | 同上 |
| `candidateStats[].gaps` | string[] | **缺口原文** | 根本没取 | 同上 |
| `candidatesTruncated` | boolean | 探针预算耗尽·显式截断 | 根本没取 | 同上 |
| `candidateProbes` | number | 本次跑了几次探针 | 根本没取 | 同上 |

> `candidateStats` 的后端注释原文（`chain-impediment.ts:461`）：
> 「它是**「为什么这个阻滞点没有方案」的唯一可查处** —— 空白比错答更容易被当成「没问题」」。
> 这句话今天**在屏上一个字都没有**。

#### B.2 `impediments[]`（31 字段）

| 字段路径 | 类型 | 含义 | 屏上显示了吗 | 显示在哪 / 为什么没显示 |
|---|---|---|---|---|
| `impedimentId` | string | 阻滞点 id | 取到了但没显示 | 作 key/testid，并进跳转 href |
| `tenantId` | string | 租户（R2） | 取到了但没显示 | 契约解析后从未被读 |
| `scanId` | string | 所属扫描 | 取到了但没显示 | — |
| `kind` | enum(3) | 卡点/堵点/断点 | **已显示** | `SandboxConsole.tsx:979`（`im.kindLabel`） |
| `breakSubtype` | enum(3)? | 断点三亚型 | 取到了但没显示 | `breakSubtypeLabel` 已备（`chainImpediment.ts:355`），零渲染 |
| `stage` | enum(5) | 落在哪段 | **已显示** | `SandboxConsole.tsx:984` |
| `scope.businessTypes` | string[]? | 该条的范围 | 取到了但没显示 | 未进 `ImpedimentVM` |
| `scope.baseIds` | string[]? | 同上 | 取到了但没显示 | 同上 |
| `scope.modelIds` | string[]? | 同上 | 取到了但没显示 | 同上 |
| `nodeId` | string? | 落在哪个链路节点 | 取到了但没显示 | **`toVM` 未搬运**（`chainImpediment.ts:350-371`） |
| `stepId` | string? | 落在哪个环节 | 取到了但没显示 | 同上 |
| `locus.objectType` | string | 落点对象类型 | **已显示** | `SandboxConsole.tsx:981` |
| `locus.objectId` | string | 落点对象 id | 取到了但没显示 | 进了跳转 query（`sandboxConsole.ts:778`），屏上不可读 |
| `locus.label` | string | 落点对象名 | **已显示** | `SandboxConsole.tsx:981` |
| `severity` | number 0–100 | **严重度** | 取到了但没显示 | 已在 VM、且驱动排序（`compareChainImpediment`），**屏上无数** |
| `evidence.solverKey` | string | 求解器 key | 取到了但没显示 | — |
| `evidence.ruleKey` | string? | 规则码 | **已显示** | `SandboxConsole.tsx:984` |
| `evidence.ruleParamKey` | string? | **改哪个旋钮** | 取到了但没显示 | 已在 VM（`:361`），零渲染 |
| `evidence.derivationEdge` | string? | 派生边 | 取到了但没显示 | 已在 VM（`:362`），零渲染 |
| `evidence.metricValue` | number | 实测值 | **已显示** | `SandboxConsole.tsx:984` |
| `evidence.threshold` | number | 阈值 | **已显示** | `SandboxConsole.tsx:985` |
| `evidence.unit` | string | 单位 | **已显示** | `SandboxConsole.tsx:984-986` |
| `dataMode` | enum(4) | 诚实位 | **已显示** | `SandboxConsole.tsx:994`（`DATA_MODE_LABEL` 徽标） |
| `manifestations[].stage` | enum | 同根因在别处的表现 | 取到了但没显示 | `toVM` 未搬运 |
| `manifestations[].nodeId` | string? | 同上 | 取到了但没显示 | 同上 |
| `manifestations[].stepId` | string? | 同上 | 取到了但没显示 | 同上 |
| `manifestations[].locus.objectType` | string | 同上 | 取到了但没显示 | 同上 |
| `manifestations[].locus.objectId` | string | 同上 | 取到了但没显示 | 同上 |
| `manifestations[].locus.label` | string | 同上 | 取到了但没显示 | 同上 |
| `rootCauseImpedimentId` | string? | 归并到哪个根因 | 取到了但没显示 | 同上 |
| `noCandidateReason` | string? | **为什么没有方案** | 取到了但没显示 | 同上 |

> `manifestations[]` 的契约注释（`chain-sim.ts:576-578`）：归并是为了避免
> 「逐段独立扫描把同一个根因数成三个问题（`G-EXCEPTION-SCATTER` 复发）」。
> 引擎已经归并好了，**前端把归并结果丢了** —— 屏上看到的仍是扁平的 N 条。

#### B.3 `impediments[].candidates[]`（30 字段）—— 整块「取到了但没显示」

`SolutionCandidateSchema`（`chain-sim.ts:702`）已被 `ChainImpedimentSchema` 声明并解析，
**值全在**，但 `toVM`（`chainImpediment.ts:350-371`）**不搬运 `candidates`**，
`ImpedimentVM` 里没有这个字段 ⇒ 屏上零出口。

30 个叶子：
`candidateId` · `impedimentId` · `label` ·
`lever.{objectType, objectId, prop, factorName, factorMark, grain, unit, valueKind}` ·
`fromValue` · `toValue` · `join.{kind, path}` · `rungKind` · `rungSource` · `effectKind` ·
`dims[].{key, label, value, baseline, unit, betterWhen, dataMode, reason}` ·
`provenance.{solverKey, formula, inputs}` · `dataMode`

> 这是「阻滞点 → 能怎么办」的**全部内容**。沙盘今天给用户的是一个跳转
> （`/v/decision-play`，`SandboxConsole.tsx:962-999`）而不是就地的方案对比 ——
> 而方案数据**本来就在这次响应里**。

---

### C · `GET /a/v1/sim/view-config` → `SandboxViewConfig`

契约：`packages/contracts/src/sim.ts:175`

| 字段路径 | 类型 | 含义 | 屏上显示了吗 | 显示在哪 / 为什么没显示 |
|---|---|---|---|---|
| `tenantId` | string | 租户 | 取到了但没显示 | 无消费方 |
| `nodeTypes` | string[] | 拓扑节点=已发布对象类型 | **已显示** | `SandboxView.tsx:598` 计数；`:654` PmDag 节点；`:494` 局部范围下拉 |
| `linkTypes` | string[] | 传导边=已发布链路 | 取到了但没显示 | **只显示了条数**（`:598`）；`buildEdges`（`:107-112`）**根本不读它**，按 `nodeTypes` 顺序兜底相邻 |
| `stateVars` | string[] | 状态变量 | **已显示** | `SandboxView.tsx:611-619` 逐变量 KPI |
| `radarDims[].key` | string | 雷达维键 | **已显示** | `SandboxView.tsx:152` `data-testid` + 取值 |
| `radarDims[].label` | string | 雷达维名 | **已显示** | `SandboxView.tsx:154` |
| `screens` | enum[] | 该租户开哪几屏 | 取到了但没显示 | 零消费方 |
| `propagationCount` | number | 传导规则数 | **已显示** | `SandboxView.tsx:599` |
| `nodeObjectIds` | Record<string,string[]>? | 每类型的真物化对象 id | 取到了但没显示 | 驱动 tick0 快照键与节点着色（`:68`/`:98`），**id 本身不上屏** |

> **`linkTypes` 值得单独点名**：屏上写着「N 类链路」，但画布上的边**不是**按这 N 类链路画的
> （`buildEdges` 只是把 `nodeTypes` 顺序相邻连起来，注释里也写明是「兜底」）。
> 这是一处**数字与图形不同源**：数字来自 `linkTypes`，图形来自 `nodeTypes` 顺序。

---

### D · `GET /a/v1/sim/sessions/{id}/certification` → `SimCertification`

契约：`packages/contracts/src/sim.ts:133`。渲染方：`SimReadinessPanel.tsx`（右栏「就绪认证」，默认展开）。

**本能力是全页覆盖最好的（28/31）**，故只列未显示的三个与需要注意的一处：

| 字段路径 | 屏上显示了吗 | 说明 |
|---|---|---|
| `scope` | 取到了但没显示 | 后端**回带**的范围（R-ARG-FIDELITY）。屏上那个 GLOBAL/LOCAL 档位读的是**前端自己的 state**（`SandboxView.tsx:554` 传 `scope={certScope}`），不是后端回带的这一个。⇒ 两者若不一致，屏上看不出来 |
| `trialTick.at` | 取到了但没显示 | 试跑时间戳 |
| `computedAt` | 取到了但没显示 | 认证计算时间戳（「这个结论是什么时候算的」） |
| `gaps[]` | **已显示但被静默截断** | `SimReadinessPanel.tsx:264` `cert.gaps.slice(0, 8)`，**没有「还有 N 条」的提示** —— 缺件超 8 条时用户不知道自己没看全 |

其余 28 个字段（`targetRef` / `level` / `dims.*4` / `l4Checks.*3` / `trialTick.{passed,rulesFired,error}` /
`worldCompleteness.pct` / 四项 `{present,needed}` / `entering[].{key,kind,source}` / `canEnterSimulation` /
`gaps[].{gapCode,ref,detail}`）均已显示，出处见 `SimReadinessPanel.tsx:136-270`。

---

### E · 会话族（建会话 / tick / checkpoint / branch / compare）

契约：`packages/contracts/src/sim.ts:88`（`SimSession`）/ `:101`（`SimTickState`）/ `:112`（`SimCheckpoint`）；
端点签名：`apps/frontend-shell/src/api/endpoints.ts:545-578`。

#### E.1 `createSimSession` → `SimSession`（8 字段，**0 已显示**）

| 字段路径 | 屏上显示了吗 | 说明 |
|---|---|---|
| `id` | 取到了但没显示 | `SandboxView.tsx:309` `setSessionId(s.id)`，仅作后续入参 |
| `tenantId` | 取到了但没显示 | 从未被读 |
| `baseSnapshot` | 取到了但没显示 | `:311` 用的是**前端本地的 `base`**，不是 `s.baseSnapshot` |
| `scope` | 取到了但没显示 | 见下方「必须点名的一处」 |
| `status` | 取到了但没显示 | 会话状态（DRAFT/…）从不上屏 |
| `curTick` | 取到了但没显示 | `:312` **硬写 `setCurTick(0)`**，不读 `s.curTick` |
| `parentCheckpointId` | 取到了但没显示 | 「本会话是某检查点的分支」这件事，屏上无出口 |
| `createdAt` | 取到了但没显示 | — |

> **必须点名的一处（本单新发现）**：屏上那句「本会话建立于范围 `GLOBAL`/`LOCAL:x`」
> （`SandboxView.tsx:517-523`）读的是 `sessionScope` 这个**前端本地 state**，
> 而它在 `:310` 被赋成 `:307` 构造的**前端自己那份 `scope`** —— **不是** `s.scope`（后端回带的那一份）。
> ⇒ 屏上显示的是「**我发过去什么**」，不是「**后端记下了什么**」。
> 两者若不一致（后端忽略/改写了 scope），屏上**看不出来**。
> 这与 §2D 的 `cert.scope` 未上屏是**同一族**问题：R-ARG-FIDELITY 的回带值**全都没被用来对账**。
> `init` 全函数只从响应里读了 `s.id` 一个字段。

#### E.2 `simTick` → `{curTick, state, trace?}`（7 字段，2 已显示）

| 字段路径 | 屏上显示了吗 | 说明 |
|---|---|---|
| `curTick` | **已显示** | `SandboxView.tsx:606` |
| `state` | **已显示** | 聚合成全局态 + 逐 stateVar 均值 + PmDag 节点着色（`:611-619`、`:96-104`）。**逐对象逐变量原值从不上屏**，只有均值 |
| `trace[].ruleKey` | 取到了但没显示 | `PropagationTrace`（`sim.ts:29-35`）契约注释原文：「喂前端**三级风险轨迹**可视化」 |
| `trace[].fromObjectId` | 取到了但没显示 | 同上 |
| `trace[].toObjectId` | 取到了但没显示 | 同上 |
| `trace[].amount` | 取到了但没显示 | 同上 |
| `trace[].viaLinkKey` | 取到了但没显示 | 同上 |

> **传导轨迹整块未上屏**：`onTick`（`SandboxView.tsx:376-390`）只读 `res.state` 与 `res.curTick`。
> 「哪条规则把多少量从哪个对象传到哪个对象、经哪条链路」—— 这正是沙盘**推演**的核心可解释性，
> 后端算好并下发了，屏上一个字都没有。tick 之后用户只看到一个数变了，**看不到为什么变**。

#### E.3 `simCheckpoint` → `SimCheckpoint`（6 字段，2 已显示·仅 toast）

`label` / `tick` 进 toast（`:396`，转瞬即逝）；`id`/`sessionId`/`tenantId`/`createdAt` 取到了但没显示。

> **点名**：检查点**没有列表**。用户可反复「存档检查点」，但屏上只有一句会消失的 toast ——
> 既看不到存了几个、在哪些 tick，也**无法回到任何一个**（没有 restore 入口）。

#### E.4 `simBranch` → `SimSession`（8 字段，1 已显示·仅 toast）

`child.id` 进 toast（`:412`）；其余 7 个同 E.1 全部未显示。

#### E.5 `fetchSimCompare` → `{a, b}`（4 字段，全部已显示）

`a[].tick` / `a[].state` / `b[].tick` / `b[].state` 经 `SimComparePanel` 上屏。

---

## 3 · 重点核查（WO 第 3 步逐条结论）

### 3.1 `chain_impediments` 的 `thresholds[]` / `evidence` / `locus` / `dataMode` / `caveat` 系

| 字段族 | 结论 |
|---|---|
| `thresholds[]`（7 字段） | **取到了但没显示 · 7/7**。`ChainImpedimentPayloadSchema:107` 声明了，`model.thresholds` 装好了（`chainImpediment.ts:433`），中文标签表 `THRESHOLD_SOURCE_LABEL` 也写好了（`:168`）—— **零渲染**。`SandboxConsole` 全文无 `thresholds` 字样（金丝雀见 §5）。 |
| `evidence`（7 字段） | **已显示 4 / 取到了但没显示 3**。上屏：`ruleKey`、`metricValue`、`threshold`、`unit`（`SandboxConsole.tsx:984-986`）。未上屏：`ruleParamKey`（改哪个旋钮）、`derivationEdge`（派生边）、`solverKey`；派生量 `breach`（超阈幅度）也已算好未渲染。 |
| `locus`（3 字段） | **已显示 2 / 取到了但没显示 1**。`objectType`+`label` 上屏（`:981`），`objectId` 只进跳转 query。 |
| `dataMode` | **已显示**（`:994` 徽标，四态词表完整）。但 `honesty.claim`（四态各自断言了什么）与 `honesty.detail`（PARTIAL 的引擎原文削弱说明）**都没上屏** —— 徽标说了「部分判定」，**没说为什么**。 |
| `caveats[]`（3 字段） | **取到了但没显示 · 3/3**。`honestyOf()` 已把 `note` 原文装进 `honesty.detail`（`chainImpediment.ts:243`），屏上无出口。 |

**一条必须点名的**：`ChainImpedimentModel` 自带两条**自检输出**，也都没上屏 ——
- `notes[]`（`chainImpediment.ts:388-419`）：「0 条不代表没有」「N 条是 PARTIAL 不可当实测」「引擎未回带阈值出处」「范围未限定」等**诚实边界正文**；
- `countMismatch`（`:422-425`）：引擎 `counts.total` 与 `impediments.length` **不一致**时的告警。
派生层把「引擎自相矛盾」都算出来了，屏上看不见。

### 3.2 `chain_loss_attribution` 的 `evidence[]` R13 三元组 与 `empty[]`

**`evidence[]` 三元组：`docs/PRD-sandbox-metro-semantics.md` §3 那句「`evidence[]` 未上屏」——
今天对沙盘页仍然成立，但那份文档的「原因」已经过期，而且这个区别是本条的全部价值。**

三分法定性（CLAUDE.md 铁律 0.5）：

| 形态 | 是不是 | 证据 |
|---|---|---|
| 没接线 | ❌ 不是 | `InspectorNodePanel.tsx:244-311` `DrillEvidenceSection` **完整实现且有生产调用方**（`:644`），逐条渲染 `drillType.drillId.drillField` / `drillValue` / `drillUnit` / `conversion` / `derivationEdge` |
| **接了线没数据** | ✅ **就是这个** | 沙盘页宿主传下去的那一份**没有 `evidence` 键** |
| 接了线接错地方 | ❌ 不是 | 挂载点是对的 |

断点链路（逐跳可复验）：
1. `ChainLineMapView.tsx:407` `ChainLossPayloadSchema.safeParse(...)`
2. `chainLineMap.ts:86-110` 该 schema 是 `z.object`，**未声明 `evidence`** ⇒ strip 语义剥掉
3. `ChainLineMapView.tsx:426` `onPayloadRef.current?.(payload)` 回抛的是 **`parsed.data`**（已剥）
4. `SandboxConsole.tsx:605` `onPayload={setLoss}` → `SandboxConsole.tsx:796` `lossPayload={loss ?? undefined}`
5. `InspectorNodePanel.tsx:771` `NodeSemanticPayloadSchema.safeParse(injected)` —— 该 schema **声明了** `evidence`（`inspectorModel.ts:1018`），但输入里已经没有这个键 ⇒ `undefined`
6. `inspectorModel.ts:1146` `(payload.evidence ?? []).filter(...)` ⇒ `live.evidence = []`
7. `InspectorNodePanel.tsx:263-267` ⇒ 显示「本节点没有下钻证据」

**补齐路径 = 1 行**：`chainLineMap.ts` 的 `ChainLossPayloadSchema` 里加 `evidence`。
`SandboxConsole.tsx:1041-1055` 的 `InspectorEvidenceGapNote` 已经把这件事**当面写在屏上**了 —— 诚实位到位。

**两个 WO 未提及、但同族更深的缺口**（本单新发现）：
- `evidence[].drillFieldEnd` / `evidence[].drillValueEnd` 在**两条路径上都被剥**
  （`inspectorModel.ts:971-996` 也没声明它们）⇒ 即使补了第 1 处，**日戳跨度那 2 行证据仍然只有起点没有终点**，
  而 `conversion` 文案写的是 `days = X.arriveDay − X.dispatchDay` —— 屏上会出现「换算式提到两个字段，但只给得出一个值」。
- `evidence[].stage` 同样两处都未声明。

`empty[]`：**9/9 全部上屏**（含 `NO_CARRIER`/`NO_INSTANCE`/`reason`/`probe`），
`reason` 与 `probe` **逐字原文透传**（`SandboxConsole.tsx:1109-1110`）。
⇒ PRD §3 那句「`empty[]` 已上屏」**仍然准确**。

### 3.3 节点语义「七件套」—— PRD §3 那张表**已过期，4/8 行不准**

以代码为准，逐行核对（PRD 文件：`docs/PRD-sandbox-metro-semantics.md:82-91`）：

| 七件套 | PRD §3 写的状态 | 代码实测状态 | 差异 |
|---|---|---|---|
| `vars` 七类变量 | ✅ 复用 | ✅ 复用 · `InspectorNodePanel.tsx:649` + `inspectorModel.ts:63-94` | **一致** |
| 五段瀑布 + 流动效率 | ✅ 复用 | ✅ 复用 · `InspectorNodePanel.tsx:595-638` | **一致**（但见 §3.4 的口径问题） |
| `rules` 规则码+阈值 | ◐ 变量级已接，节点级清单未接 | ◐ 同左 · R 类 `ruleRef` 已渲染（`:377`）；`thresholds[]` 节点级清单仍零渲染 | **一致** |
| `im` 阻滞点解释 | ◐ 已按 stage 联动 | ◐ 同左 · `SandboxConsole.tsx:1014-1017` `stagesOfKind` | **一致** |
| `o` 承载对象 + 诚实缺席 | ◐ `empty[]` 已上屏；**`evidence[]` 三元组未上屏** | ◐ 结论仍成立，**但原因变了**：组件已实现并在独立页真渲染，沙盘页是**宿主 schema 剥字段** | **过期**（结论对，归因错 —— 修法从「做功能」变成「补 schema 一行」） |
| `pos` 节点定位白话 | ❌ 未做 | ✅ **已做** · `chainNodeSemantics.ts:81-237`（12 节点）+ `InspectorNodePanel.tsx:156-159` 渲染 | **过期** |
| `cf` 跨节点冲突 | ❌ 未做 | ✅ **已做** · `chainNodeSemantics.ts` 6 条 `cf`，逐条带 `basis` file:line + `InspectorNodePanel.tsx:164-190` 渲染 | **过期** |
| `kpi` 流指标 | ❌ 未做 | ✅ **已做** · `inspectorModel.ts:1071-1133` `buildNodeKpis`（6 行真值指标）+ `InspectorNodePanel.tsx:198-215` 渲染 | **过期** |

**结论：七件套今天 5 件已做、3 件半做，PRD §3 那张表低估了 3 件、并把第 5 件的归因写反了。**
重设计时**不要**以那张表为输入 —— 它会让人去重做已经做完的 `pos`/`cf`/`kpi`。

补充一条 PRD 未记的实测：`chainNodeSemantics.ts` 的语义覆盖是 **12/24**
（`chainNodeSemanticsCoverage()`，注册表扩到 24 后分母跟着变了，分子没动）。
未写语义的 12 个节点**整块不渲染、不留空壳**（`InspectorNodePanel.tsx:154`），
且覆盖率**当面写在屏上**（`:851-855`）—— 这个降级姿势是对的。

### 3.4 五段瀑布与七类变量：哪些已渲染、哪些取到没渲染

**先说一个必须点名的口径问题**（本单新发现，比字段清点更重要）：

`InspectorNodePanel` 的 **① 五段瀑布** 与 **② 流动效率** 读的**不是引擎载荷**，
而是 `buildPlaceholderInspectorInput`（`inspectorModel.ts:586-613`）的
**seed 派生占位值**（`jitter(seed, ...)`，seed=42）：

- `InspectorNodePanel.tsx:544` `readout = computeInspectorReadout(input, values)`，`input` 来自 `NodeInspectorView.tsx:801` 的 `buildPlaceholderInspectorInput(...)`
- 而 **③ 节点级流指标** 与 **④ R13 证据** 读的是 `liveView`（真引擎载荷，`:641`/`:644`）

⇒ **同一个面板里，① 的「前置期」与 ③ 的「本节点前置期」是两个不同来源的数**，
且 ① 恒为占位值。面板挂了常驻 `PLACEHOLDER` 横幅当面说明（`:579-583`），
控制台的页签也叫「变量输入 · **占位**」（`SandboxConsole.tsx:770`）—— **诚实位是到位的**，
但重设计时必须知道：**引擎真实的逐段 `steps[]` 并没有喂进这个瀑布**。

（引擎真段确实上屏了，在**另一个页签**：「逐环节 · 实测归因」`StepDetail`，`SandboxConsole.tsx:1250-1316`，
读的是 `buildStageBoard(loss)` 的真 `steps`。所以数据没丢，只是**两个页签各用一套口径**。）

#### 五段瀑布（`WaterfallBucket`，8 字段 × 5 桶）

| 字段 | 已渲染吗 | 出处 |
|---|---|---|
| `kind` | 已渲染 | `InspectorNodePanel.tsx:96` `data-kind` |
| `label` | 已渲染 | `:102` |
| `valueAdd` | 已渲染 | `:103` 增值徽标 |
| `days` | 已渲染 | `:113`（`null` ⇒ EMPTY，**不显示 0**） |
| `pctOfLead` | 已渲染 | `:114` |
| `pctOfChainLoss` | 已渲染 | `:117` |
| `provenance` | **取到了没渲染** | `:98` 只落 `data-provenance` 属性，**屏上无可读徽标**；而 `PROVENANCE_LABEL` 中文表已写好（`inspectorModel.ts:121`） |
| `absenceReason` | 已渲染 | 经 `StepAbsence.reason` 上屏 |

> `provenance` 是四档（`LIVE`/`PLACEHOLDER`/`WHATIF`/`EMPTY`）的**逐桶**读数来源标注，
> 契约注释明写「合并 PLACEHOLDER 与 WHATIF 会让『系统给的占位』和『我自己拨的』分不清 —— 那正是静默错答的温床」
> （`inspectorModel.ts:110-117`）。今天它**只在 DOM 属性里，不在屏上** ——
> 面板顶部有一条整体的 PLACEHOLDER 横幅，但**逐桶**的四档区分用户看不到。

#### 七类变量（T/K/B/C/P/R/S，`InspectorVariable` 11 字段）

七类**全部已渲染**（`InspectorNodePanel.tsx:649-660` + `VAR_CLASSES` 遍历），
每类控件形态由 `VAR_CONTROL_BY_CLASS` 单源决定（S 类渲染 `role="radio"`，**绝不渲染 range**）。

| 字段 | 已渲染吗 | 出处 |
|---|---|---|
| `varId` / `cls` / `label` / `unit` | 已渲染 | 分组头 + 行 |
| `carrier`（有/薄/缺） | 已渲染 | `:77-83` `CarrierTag` |
| `evidence`（承载取证 file:line） | 已渲染 | `:454-455` |
| `baseline` | 已渲染 | `fmtVarValue`（`null` ⇒ EMPTY） |
| `domain.{min,max,step}` | 已渲染 | 滑杆属性 |
| `effect` | 取到了没渲染 | 作用算子本身不上屏（其**后果**通过读数变化体现） |
| `inertReason` | 已渲染 | `drivesReadout` 为假时当面写原因 |
| `options[].{optionId,label,note}` | 已渲染 | S 类离散选项 + `note` |
| `ruleRef.{ruleKey,param,path,note}` | 已渲染 | `:377` |

⇒ **七类变量这一块基本无遗漏**，是全页做得最完整的部分之一。

### 3.5 `CHAIN_NODE_REGISTRY` 24 个节点在主屏上呈现了几个

**结论：没有「两套词表」问题。主屏画的节点集与注册表是同一个集合，且由注册表派生、前端零手抄。**
（这是本仓 D1/E1 交集为 0 那次事故的**正确修复形态**，值得记一笔。）

判据（逐处指到代码）：
- `sandboxConsole.ts:31` 直接 `import { CHAIN_NODE_REGISTRY, CHAIN_STAGES } from "@platform/contracts"`
- `:343` lane 数 = `CHAIN_STAGES.map(...)`（**5 段**，随契约走）
- `:325` 节点名 `CHAIN_NODE_REGISTRY.find(...)`，不在册就用 `nodeId` 原样，**不编名字**
- `:354` `absentNodes` = 注册表里有、但本次载荷既无环节也无 EMPTY 行的节点
- `:468-487` `chainNodePresence` 出「在册 / 有数据 / 在册不在场」三态

**实测覆盖**（`apps/frontend-shell/test/fixtures/chain-loss-real.json`，seed 42 真载荷）：

| 态 | 数量 | 是哪些 | 主屏画成什么 |
|---|---:|---|---|
| **有数据**（有环节） | **8** | 需求共识、订单回款、主计划排产、过程质检攒批、老化静置、关键物料补货、入厂在途与清关、到货检验 | 实心卡 `data-card-shape="solid-block"` |
| **诚实缺席**（只有 EMPTY 行） | **15** | 订单评审、开票对账、质量与返工、MRP 运行、发运节拍、客户预告接收、询报价、产能与瓶颈复核、工单下达、齐套发料、请购、采购下单、成品入库、干线运输在途、客户验收 | 缺角灰卡 `data-card-shape="notched-tag"` + 引擎 `reason`/`probe` 原文 |
| **在册不在场** | **1** | 计划检修窗（`flowGate:false` ⇒ 引擎既不产环节也不产 EMPTY 行） | 段尾单列一行 |
| **合计** | **24 / 24** | | **全部有呈现，一个不漏** |
| 另有动态工序节点 | 10 | `capacity.op.OP-001…OP-010`（`capacity.op.*` 命名空间，不在静态表） | 实心卡 |

**但有一个必须点名的前提**：以上三态齐全**只在「链路阶段」画布模式**下成立
（`SandboxConsole.tsx:632-743`）。而**默认模式是「metro 线路图」**（`:143` `useState<CanvasMode>("metro")`），
线路图只画本次载荷里真有的站（有数据的 + `empty[]` 的停运站位），
**「在册不在场」那 1 个在默认视图里看不见**。
⇒ 用户进页面第一眼看到的节点集 ≠ 注册表全集。这不是词表问题，是**默认视图选择**的问题。

---

## 4 · 「不遗漏」的可机械判定门（设计，本单不实现）

### 门 G-SANDBOX-FIELD-COVERAGE

**判据一句话**：*后端契约里的每一个叶子字段，要么在屏上有出口，要么在一张显式豁免表里带理由登记。*

#### 机制（三步，全部机器可判）

**① 抽取「后端能给什么」** —— 从**契约/求解器输出类型**抽叶子路径集 `BACKEND`
- 对已进 contracts 的：直接遍历 zod schema（`_def` 递归）拿全路径，含 `.optional()` 分支。
- 对仍在求解器侧的（`ChainLossResult` / `ChainScanResult`）：用 TS 编译器 API（`ts-morph`）遍历 interface 成员。
- **金丝雀**：断言 `BACKEND` 含 `evidence[].drillValue` 与 `empty[].probe`（两个已知必中）。不中 ⇒ 报**工具坏了**，不报「后端没字段」。

**② 抽取「前端读到了什么」** —— 从前端读取层 schema 抽 `PARSED`
- 遍历 `ChainLossPayloadSchema` / `ChainImpedimentPayloadSchema` / `NodeSemanticPayloadSchema` 等。
- `BACKEND − PARSED` = **「根本没取」集**（= 被 zod strip 掉的）。**这一步就能自动抓出本文件 §3.2 那 17+3 个字段**，而且是**编译期数据**，不需要跑浏览器。

**③ 抽取「屏上有什么」** —— 渲染态覆盖
- 用既有 vitest + RTL 把 `<SandboxConsole>` 挂起来，喂 `chain-loss-real.json` + `chain-impediment-baseline.json` 两份**真载荷 fixture**；
- 对每个 `PARSED` 叶子，取其在 fixture 里的**具体值**，在 `container.textContent` ∪ 全部 `data-*`/`title`/`aria-*` 属性值里找；
- 命中 ⇒ 已显示；未命中 ⇒ 「取到了但没显示」。
- **金丝雀**：`totals.leadTimeDays` 的值必须命中（已知必中）；`impediments[].severity` 必须**不**命中（已知必不中）。**两个方向都要有金丝雀**，否则匹配器写歪了会全绿或全红。

#### 输出与失败条件

产出 `sandbox-field-coverage.json`：每字段一行 `{path, state, evidence}`。
门失败当且仅当：**出现了一个既不在屏上、又不在 `docs/sandbox-field-waivers.yml` 豁免表里的字段**。
豁免表每行必须带 `reason` 与 `owner`，**空 reason 直接判红**。

#### 它能抓什么

- ✅ 后端加了新字段，前端 schema 没跟上（**新增即红** —— 这正是「不遗漏」的机器保证）
- ✅ 前端 schema 声明了但没渲染（本文件 117 个「取到了但没显示」全部可自动列举）
- ✅ 有人把 schema 里某个字段删了 / 改名了 ⇒ 覆盖率突变
- ✅ 渲染被删掉（重构时误删一段 JSX）⇒ 该字段从「已显示」掉到「没显示」

#### 它**抓不到**什么（必须写在门的文件头，否则又是一个假绿）

- ❌ **「显示了但显示错了」** —— 值命中文本只证明这个串在页面上，不证明它挂在正确的标签下。
  （把 `threshold` 显示成「实测值」照样绿。）
- ❌ **「只在 hover / title / `data-*` 里」** —— 本文件 §2 里 `cadence.everyDays`、`attribution[].nonValueDays`、
  `scope.*` 都属此类。若匹配器扫属性，它们会被判「已显示」，但用户要悬浮才看得到。
  **对策**：state 细分成 `VISIBLE_TEXT` / `ATTR_ONLY` / `HOVER_ONLY` 三档，门只对 `VISIBLE_TEXT` 记满分。
- ❌ **「显示了但被截断」** —— 如 `gaps.slice(0, 8)`：前 8 条命中即绿，后面的静默丢失抓不到。
  **对策**：另加一条「列表渲染不得出现无提示的 `.slice(`」的静态检查。
- ❌ **fixture 里恰好为空的可选字段** —— 值为 `undefined` 时无从匹配。
  **对策**：fixture 必须**逐字段非空**（用一份合成的「全字段齐备」载荷做覆盖门，
  用真载荷做行为门，两份分开）。这一条不做，门在可选字段上恒绿 —— 正是本仓「7/7 数据为空所以从没触发」那族病。
- ❌ **默认视图 vs 非默认视图** —— §3.5 那个「metro 模式下看不见在册不在场节点」的问题，
  字段覆盖门抓不到（切到 chain 模式就命中了）。**对策**：覆盖门按 `CanvasMode` 分别跑，报表按模式分列。

---

## 5 · 金丝雀证据（报否定结论前的自证）

本文件多处下了「零渲染 / 根本没取 / 无消费方」这类**否定结论**。按铁律 0.6，逐条附金丝雀：

| # | 否定结论 | 金丝雀（已知必中） | 金丝雀结果 | 否定项结果 |
|---|---|---|---|---|
| 1 | `SandboxConsole` 不渲染 `severity`/`thresholds`/`caveats`/`notes`/`countMismatch`/`scanId`/`scope`/`ruleSetVersion`/`breakSubtype`/`thresholdSource`/`honesty.claim`/`honesty.detail`/`objectId`/`ruleParamKey`/`derivationEdge`/`breach`/`candidates`/`manifestations`/`noCandidateReason` | `model\.(total\|honestyCounts\|unresolved)` | **4 处命中**（`:439/:440/:444/:881`） | **0 处命中** |
| 2 | 沙盘页的 `SandboxConsole.tsx` 在默认 worktree 上不存在 | `git rev-parse --verify -q HEAD:CLAUDE.md` | **RC=0，有 sha** | **RC=1，无输出** |
| 3 | `SimReadinessPanel` 不渲染 `trialTick.at` / `computedAt` | `grep -c "cert.level"` | **3 处命中** | **0 处命中** |
| 4 | `evidence[]` 未被 `ChainLossPayloadSchema` 声明 | 同文件 `empty:` 键**在** schema 里（`chainLineMap.ts:89`） | **在**（故 `empty` 存活） | `evidence` **不在**（故被剥） |

> **pathspec 陷阱已规避**：全程使用 `git grep -- 'apps/frontend-shell/src'`（目录形式）
> 或 `Grep` 工具的 `path` 参数，**未使用** `git grep -- "apps/*/src"` 这种 `*` 不跨 `/` 的写法。
> 判据 #1 的金丝雀 4 处命中即证明工具本身工作正常。

---

## 6 · 诚实边界（四档）

### 6.1 亲手读代码验的（逐行读过，可指 file:line）

- 页面入口链 `App.tsx:110-128` → `SandboxView.tsx` 全文（666 行）→ `SandboxConsole.tsx` 全文（1335 行）
- `packages/contracts/src/chain-sim.ts` 全文（924 行）—— A/B 两能力的契约字段全部逐行读出
- `apps/datacore/src/solvers/chain-loss.ts:128-249`（`ChainLossResult` 输出形状）
- `apps/datacore/src/solvers/chain-impediment.ts:447-475`（`ChainScanResult` 输出形状）
- `apps/frontend-shell/src/views/sim/chainImpediment.ts` 全文（459 行）
- `apps/frontend-shell/src/views/sim/chainNodeSemantics.ts` 全文（251 行）
- `apps/frontend-shell/src/views/sim/inspectorModel.ts` 的 §1/§2/§3 与 960-1158
- `apps/frontend-shell/src/views/sim/InspectorNodePanel.tsx:1-120, 236-331, 520-660, 700-867`
- `apps/frontend-shell/src/views/sim/ChainLineMapView.tsx:395-437, 655-712, 915-941`
- `apps/frontend-shell/src/views/sim/sandboxConsole.ts:180-330, 398-490`
- `apps/frontend-shell/src/views/sim/SimReadinessPanel.tsx:136-275`
- `packages/contracts/src/sim.ts:133-188`
- **§3.2 的 7 跳断点链路是逐跳读到调用点条件的**，不是从注释抄的
  （`SandboxConsole.tsx:1041-1055` 的注释也这么说，但我**没有**以它为证据，而是自己走了一遍 schema → parse → onPayload → prop → safeParse → `?? []` → JSX）

### 6.2 只 grep 到符号 / 只做了结构性核对的

- `TransitFlowLayer` / `PhysicalTopologyView` / `chainFamilyLines` 的**字段级**账 —— 只 grep 到取数调用点（§1.2 表），
  **没有**逐字段展开。本文件 §1.2 已明说这是有意的边界，但它确实意味着
  **「在途图层 7 类对象 + 物理拓扑 Workshop」的字段遗漏情况本台账没有覆盖**。
  若重设计要动这两块，需要补一张同规格的表。
- `apps/agentcore` 侧的 QOS（AI 指挥台）响应字段完全未展开 —— 它经 `TaskRun` 流式渲染，是另一套契约。
- `SimSession.scope` 与 `SimTickState` 的 `pending`（`DelayedContribution`，5 字段）未计入总数：
  前者是 `z.record(z.string(), z.unknown())` 不可展开叶子，后者不在 `simTick` 的响应类型里
  （`endpoints.ts:549` 只声明 `{curTick, state, trace?}`）。若后端实际回带 `pending`，
  那是**又一族「根本没取」**，本台账未覆盖。

### 6.3 从文档抄的（并注明该文档可能已过期）

- `docs/PRD-sandbox-metro-semantics.md` §3 的「七件套」表 —— **本文件 §3.3 已逐行核对并判定其中 4 行过期**，
  抄的只是「PRD 当时怎么写的」这一列，**结论列一律以代码为准**。
- 同文档 §4 的在途三档判据 —— 未独立复核，仅用于说明 §1.2 里在途图层的诚实位由组件自带。
  **该表可能已过期**（`TransitFlowLayer` 在 WO-TRANSIT-WIRE 之后已自己发四条 `searchObjects`，
  `SandboxConsole.tsx:1191-1213` 的注释明确记载了「图例说没人去取、它下面的图层正在取」这个已被修掉的自打脸）。

### 6.4 未能验证的

- **zod strip 行为未实机跑通**：本机 `node_modules` 未安装（`find` 全盘无 zod），
  无法写脚本把 `chain-loss-real.json` 真过一遍 `ChainLossPayloadSchema` 来实证剥离。
  我的依据是：① 两个 schema 都用 `z.object`（非 `z.looseObject`/`passthrough`）；
  ② 两份源码的注释各自明写「zod `object` 默认剥离未知键」（`chainLineMap.ts:69`、`chainImpediment.ts:59`、`inspectorModel.ts:964`）；
  ③ `SandboxConsole.tsx:1027-1028` 记载了一次**实测**（26 条 evidence 过 schema 后键都不在了）。
  ⇒ 三条独立佐证 + zod 语义确定，**我判定为真**，但这是**推断不是实测**，特此标出。
  复验方式：`node -e` 把 fixture 过一遍 schema，一分钟即可证伪。
- **屏上到底长什么样没有跑起来看过**：本单禁跑测试/构建，全部「已显示」判定基于**JSX 静态阅读**。
  条件渲染（`honesty` 开关关掉时 `sc-imp-gap` 等大量诚实位整块消失）意味着
  **「已显示」的准确含义是「在 `honesty=true` 的默认态下有 JSX 出口」**。
  `honesty` 默认 `true`（`SandboxConsole.tsx:150`），故默认态成立。
- **237 这个总数依赖「叶子」的切法**：我把 `scope.{businessTypes,baseIds,modelIds}` 算 3 个、
  `manifestations[]` 的 6 个子字段各算 1 个、`trace[]` 的 5 个子字段各算 1 个。换一种切法总数会变。
  **结构性结论（哪些字段没上屏、断在哪）不受切法影响，比例数字受影响。**
- **toast 算不算「屏上显示」**：E.3/E.4 的 3 个字段我计入「已显示」，但它们是**转瞬即逝的 toast**，
  不是持久呈现。若按「持久可读」口径，E 的已显示应为 6 而非 9，总计应为 85 而非 88。
  这条口径分歧我**明写在此**而不是悄悄选一个。

### 6.5 发现的与工单描述不符之处（本仓要纠正不要附和）

| # | 工单/文档说法 | 实际 | 证据 |
|---|---|---|---|
| 1 | 工单把 `sandboxConsole.ts` 与 `SandboxConsole.tsx` 并列为沙盘页构成 | 属实，但工单**漏了 `SandboxView.tsx`** —— 它才是路由挂载的那个组件，且**所有 sim-session 系取数都在它里面**。只读工单列的 7 个文件会漏掉 C/D/E 三个能力 | `App.tsx:128` → `SandboxView`；`SandboxView.tsx:593` 才渲染 `SandboxConsole` |
| 2 | 工单：「`chain_impediments` 的 `thresholds[]`、`evidence`、`locus`、`dataMode`、`caveat` 系字段」 | 字段名应为 **`caveats[]`**（复数），不是 `caveat` | `chainImpediment.ts:106`、`chain-impediment.ts:456` |
| 3 | PRD §3：`pos` / `cf` / `kpi` 三件「❌ 未做」 | **三件都已做并已渲染** | `chainNodeSemantics.ts:81-237`；`InspectorNodePanel.tsx:156/164/198` |
| 4 | PRD §3：`evidence[]` 三元组未上屏 | 结论对，**归因错**：组件已实现、独立页真渲染，沙盘页是宿主 schema 剥字段（「接了线没数据」而非「没做」） | §3.2 七跳链路 |
| 5 | `SandboxConsole.tsx:79` 文件头注释：「设计目标 5 段 24 节点 vs **后端注册表 4 段 12 节点**」 | **注释已过期**：注册表今天是 **5 段 24 节点**（`chain-sim.ts:61` + `:183-214`）。屏上渲染的数是从 `CHAIN_STAGES.length` / `CHAIN_NODE_REGISTRY.length` **派生**的（`sandboxConsole.ts:427-431`），所以**屏上不会说错**，只有那句注释停在旧数上 | `chain-sim.ts:61`、`:183-214`；`sandboxConsole.ts:427-431` |
| 6 | 工单预期「主屏画的节点集与注册表可能不是同一个集合」 | **不成立**：主屏零手抄词表，全部派生自 `CHAIN_NODE_REGISTRY`，24/24 有呈现（三态） | §3.5 |

---

## 7 · 本体引用与影响

- **对象类型**：`ChainNode` / `ChainStep` / `LossAttribution` / `ChainImpediment` / `ChainScope` /
  `SolutionCandidate`（S0+S3 冻结，本单**只读不改**）；`SimSession` / `SimCertification` / `SandboxViewConfig`
- **链路**：`chain_loss_attribution`（E1）· `chain_impediments`（E3）· sim-session tick 链
- **不变量**：R6（确定性 · fixture 取自 seed 42）· R13（可溯源 —— 本单的核心缺口就在这条）·
  R14（零业务常数 · 节点词表全派生）· R-ARG-FIDELITY（scope 回带 —— §2D 发现回带值未上屏）
- **断点**：`G-IMPEDIMENT-LOSS-NOJOIN`（两求解器无共同 id 维度，已在屏上明写）·
  `G-SIM-SCOPE-UNREAD`（会话范围有写端无读端，已在屏上明写）
- **本单新记的账**（建议编号，待审核方确认后回写 `docs/SYSTEM-ONTOLOGY.md`）：
  - `G-SANDBOX-EVIDENCE-STRIPPED` —— 宿主读取层 schema 未声明 `evidence[]`，R13 三元组在沙盘页整块缺席（「接了线没数据」）
  - `G-SANDBOX-DRILLSPAN-STRIPPED` —— `drillFieldEnd`/`drillValueEnd` 在**两条**前端路径均未声明，日戳跨度证据只有起点
  - `G-IMPEDIMENT-VM-DROP` —— `toVM` 不搬运 `candidates`/`manifestations`/`nodeId`/`stepId`/`noCandidateReason`，
    76 个已解析字段无屏上出口
  - `G-CERT-GAPS-SILENT-TRUNCATE` —— `gaps.slice(0, 8)` 无「还有 N 条」提示
  - `G-SIM-TRACE-UNRENDERED` —— `simTick` 回带的 `trace[]`（传导轨迹 5 字段）零渲染，
    tick 之后「数变了」看得见、「为什么变」看不见
  - `G-SIM-ARGFIDELITY-UNCHECKED` —— 后端回带的 `SimSession.scope` 与 `SimCertification.scope`
    **都没被用来对账**，屏上显示的是前端自己发出去的那一份 ⇒ R-ARG-FIDELITY 的回带值形同虚设

> **本单不改代码，故不回写本体**；上列四条留给承接重设计的那张单，改动落地时一并回写。
