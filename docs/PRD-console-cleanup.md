# PRD · 推演沙盘控制台收口（WO-CONSOLE-CLEANUP）

> 分支 `claude/handoff-wo-console-cleanup` · 基线 `fb99c91c`（集成旁支 `claude/integration-sandbox-batch`，**不是 canonical**）
>
> 一句话：上一波四个 dev 都被禁碰 `SandboxConsole.tsx`，五笔欠账全堆在这一个文件上。本单只做这五笔 ——
> **不新增能力，只把「已经是真的」接上、把「已经不是真的」改掉。**
>
> 范围：`views/sim/SandboxConsole.tsx` + `SandboxConsole.module.css` + `sandboxConsole.ts` + `test/**` + 本文。
> `chainLineMap.ts` / `TransitFlowLayer.tsx` / `InspectorNodePanel.tsx` / `inspectorModel.ts` / `physicalTopology.ts`
> **一行未动**（当组件用、传 prop、读它们已发布的 DOM 属性，不改内部）。

---

## 0 · 本体引用与影响

### 触及的对象类型

| 对象类型 | 本单怎么用它 | 状态 |
|---|---|---|
| `ChainNode` / `ChainStep` / `LossAttribution` / `ChainScope` | 只读投影（新增「在册/有数据/在册不在场」三态派生） | S0 冻结，未改 |
| `ChainImpediment` | 只读（统计条与 stage 联动，判据未动） | 未改 |
| `InterBaseTransfer` / `Shipment` / `WIPLot` / `Cadence` | 在途图层自取，本单只改**挂载点** | 未改 |

**本单不新增对象类型、不新增字段、不改任何求解器、不改任何种子。** 新增的全部是前端派生与渲染。

### 触及的链路

- `ViewPage → registry("sim-sandbox") → SandboxView → SandboxConsole → ChainLineMapView`
  → `runSolver chain_loss_attribution`（**全页仍只此一次**）。
- **本单删掉的一条取数边**：`SandboxConsole → NodeInspectorView →（自取一次）chain_loss_attribution`。
  上一单（WO-NODE-SEMANTICS）为了让 R13 证据当天上屏而留的退路，宿主接上 `lossPayload` 后**当场消失**。
- **本单新增的一条几何依赖边（纯 DOM 读取，无取数）**：
  `SandboxConsole →（读）clm-stage / clm-canvas 的矩形与 data-zoom/data-pan-x/data-pan-y → transitOverlayBox → CSS 变量 → 钉住 transit-ring`。
  这条边**不 import 线路图的内部**，只消费它已经发布在 DOM 上的东西（那三个 `data-*` 本来就是它自己挂的）。

### 触及的事件

无。不发新事件、不改任何事件载荷、不改订阅。

### 不变量

| 编号 | 本单如何遵守 / 加强 |
|---|---|
| **R1** | 跨包仍只依赖 `@platform/contracts`（新增引用 `CHAIN_STAGES` / `CHAIN_NODE_REGISTRY`，段数与节点名零手抄）。 |
| **R6** | 新增派生全是纯函数、全序（灰卡片按 nodeId 字典序、行按 stepId 字典序、`emptyRowsByKind` 计数降序→kind 字典序、`absentNodes` 按注册表序）；`transitOverlayBox` 只做矩形相减，无时钟无随机。 |
| **R13** | **加强**：`empty[].reason` / `probe` 从「段尾一行只有 label+kind」升级为**卡上原文全文透传**；引擎载荷缺 `evidence[]` 这件事本身也被写上屏（见 §2 ⑭）。 |
| **R14** | 零硬编码色值（灰卡片全走 `tokens.css` 的 `--muted/--muted2/--danger/--line2`）；屏上所有数字均为载荷投影，前端零加法零换算。 |
| **R-ARG-FIDELITY** | 未动（`businessTypes`/`modelIds` 仍原样透传让引擎报 400）。 |

### 门禁

| 门 | 影响 |
|---|---|
| `sandbox-console.seam` | **本单头号判据**：新增 §9（13 例）；既有 24 例**一条未改、全绿** ⇒ 37/37。 |
| `node-semantics.seam` | 未改；`§1「宿主传 lossPayload ⇒ 不发第二次请求」`（`:191`）现在**在控制台里也真的成立**了（此前只在裸渲染面板时成立）。 |
| `chain-line-map.seam` / `metro-semantics.seam` / `transit-flow.seam` / `transit-geometry.seam` / `physical-topology.seam` | 未改，全绿（全量 175 文件 / 809 例）。 |

### 断点（G-x）

- **本单没修、也不许修的**：`G-IMPEDIMENT-LOSS-NOJOIN`（`chain_impediments` 的 locus 是**对象**、
  `chain_loss_attribution` 的节点是**链路节点**，无共同 id 维度）。本单只把它**从源码注释搬到屏上**。
  硬映射会是一个"看着合理"的编造，明确不做。
- **本单新登记的一条（实测）**：`G-CONSOLE-EVIDENCE-STRIPPED` ——
  宿主手里那份载荷是经 `chainLineMap.ts` 的 `ChainLossPayloadSchema` 解析的，
  该 schema **没有声明 `evidence[]`** ⇒ zod `object` 的 strip 语义把它**剥掉**。
  实测：真抓下来的 26 条 `evidence` 过一遍该 schema 后**键都不在了**（`empty[]` 声明过，原样活着）。
  ⇒ 右栏 R13 下钻三元组在**控制台内**没有数据。补齐 = 该 schema 加一行 `evidence`
  （该文件在本单 🚦「绝对不碰」清单里）；加上后本文件**一行不用改**。详见 §1 ①。
- **仍在**：线路图与在途层**没有共同的站点 id 维度**（`PRD-transit-geometry.md` §4）——
  本单把两图叠到了同一块画布上，**这条缺口一个字都没变**，两句常驻诚实位原样在屏。

---

## 1 · 五件事逐条

### ① `NodeInspectorView` 多发的那一次求解器请求 —— **已消除**，但代价必须一起说

做了什么：`SandboxConsole.tsx` 右栏改传 `lossPayload={loss ?? undefined}`。

- `?? undefined` 不是修饰：载荷还没回来（或线路图取数失败）时 `loss === null`，
  传 `null` 会让面板**以为宿主已给**（`hasInjected` 判的是 `!== undefined && !== null`），
  屏上说着"复用宿主那一份"却一格证据都没有 —— 那是把"还没有"画成"已经有"。故退回自取。
- 实测（`sandbox-console.seam §9 ①`）：进页面 1 次 → 点「变量输入」页签后**仍是 1 次**；
  面板那句常驻文案同时从「本视图自取一次…」翻成「未发第二次请求」。真浏览器里也复核了这句话（§6）。

**没做到的那一半（本单最重要的一条发现，不遮）**：

传下去的这一份**不带 `evidence[]`**。`ChainLossPayloadSchema` 只声明了
`nodes / attribution / empty / totals / conservation / anchor / summary`，
zod 把未声明的键**剥掉**。拿真抓下来的取证 fixture 实测：

```
RAW evidence len = 26 | PARSED has evidence = false
parsed keys = nodes,attribution,empty,totals,conservation,anchor,summary
```

后果是**具体**的：`InspectorNodePanel` 在 `evidence` 与 `empty` 都为空时会打出
「本节点没有下钻证据：**本节点在载荷里只有诚实缺席行、没有可算的环节**」——
对 `order.cash` 这种明明有环节的节点，这句话是**假的**。它由禁改文件产出，我改不了它，
于是把真相**贴在它正上方**（`sc-inspect-evidence-gap`）：是宿主这一份缺字段，**不是引擎没给**；
`empty[]` 声明过、诚实缺席行原样都在；补齐是一行 schema。

并把这件事**钉进门**：§9 有一例断言「该 schema 今天确实剥掉 evidence」。
哪天有人把 `evidence` 补进 schema，这条断言**当场红**，逼着把屏上那段说明一起改掉 ——
而不是留一句已经过期的话在页面上。

> 交给复验方的取舍：**要不要用一行 schema 换回控制台里的 R13 证据**，是禁改文件里的决定。
> 本单执行工单指令（消掉第二次请求）+ 把代价明写，不替下一张单做主。

### ② 10 个 `NO_CARRIER` 节点 —— **已改成灰卡片**，且与有数据卡**形状**分家

- 派生层新增 `StageLaneVM.emptyNodes`（`orphanEmpty` 按 nodeId 归拢，**保留** `orphanEmpty` 字段本身，
  既有断言零改动），节点名取 `CHAIN_NODE_REGISTRY` 单源。
- 渲染成 `EmptyNodeCard`：与有数据卡**同级进 `laneGrid`**（不再是段尾一行小字），
  卡上写清 `EMPTY` / `emptyKind` / `未补 0` / **`reason` 原文全文** / `probe` 原文。
- **形状分家三层判据**（只改颜色深浅过不了门）：
  | 层 | 有数据卡 | 灰卡 |
  |---|---|---|
  | DOM | `data-card-shape="solid-block"` | `data-card-shape="notched-tag"` |
  | class | `.nodeCard` | `.emptyCard`（两者**不共用任何 class**） |
  | 几何 | 无 `clip-path`，实线，圆角 3px | `clip-path: polygon(…)` 切掉右上角，**虚线**，圆角 0 |
- 真浏览器现算的 computed style（不是只看测试）：
  `solid {clipPath:"none", borderStyle:"solid", borderRadius:"3px"}` ·
  `gray {clipPath:"polygon(0px 0px, calc(100% - 12px) 0px, 100% 12px, 100% 100%, 0px 100%)", borderStyle:"dashed", borderRadius:"0px"}`。
- 实拍计数：**灰卡 15 张 / 实心卡 18 张**。
  （工单说的是「新增 12 个里 10 个 `NO_CARRIER`」；本单**不只处理那 10 个** ——
  凡是「在册且本次载荷只有 EMPTY 行」的节点一律出灰卡，实测 15 个：那 10 个 + 早就存在的
  `order.review` / `order.settlement` / `material.mrp` / `material.shipping` / `capacity.quality`。
  只挑新增的 10 个做会在同一条泳道里造出两种画法。）
- 灰卡**可点**：点了右栏切到「变量输入」页签（那里才有缺席证据；「逐环节」对它是一张空表 ——
  把"没有"画成"空"是另一种说谎）。

### ③ 诚实位文案 —— **改口径不删**，并补上 `capacity.maint`

`sc-chain-coverage` 现在说的是：

- **保留一字未动**：`设计目标 5 段 24 节点（…）` / `后端单源 CHAIN_STAGES 今天是 5 段（…）` /
  `CHAIN_NODE_REGISTRY 是 24 个静态在册节点` / **`差 0 段 0 个节点尚未建模`**
  （差额句留着 —— 它是"哪天设计稿又加一段"的探测器，既有断言也咬着它）；
  `本画布按后端真有的渲染（本次载荷 18 个节点，其中 10 个来自动态工序命名空间 capacity.op.*）` /
  `也不在前端手抄一份 24 节点词表`。
- **删掉**：`扩注册表要连引擎一起改，不在本单边界` —— 扩完了，这句已过期。
- **改写**：`不拿 24 个冒充 24 个` → `不拿「在册数」冒充「有数据数」`
  （原句在 24 vs 24 时字面读作"不拿 24 个冒充 24 个"，是废话）。
- **新增（还账后剩下的真话）**：`但补齐注册表补不出数据` + 三态实测数，全部派生自载荷：

  > 本次载荷里在册节点只有 **8** 个算得出天数，**15** 个只有诚实缺席行
  > （引擎 `empty[]` 共 **16** 行：**NO_CARRIER 14 · NO_INSTANCE 2**），
  > 另有 **1** 个**在册不在场**（计划检修窗 `capacity.maint`）—— 引擎既不产环节也不产 `EMPTY` 行，
  > 屏上本来完全看不见，本画布把它单列出来。

  `NO_CARRIER 14 / NO_INSTANCE 2` 与工单给的数**逐字一致**，且是 `empty[]` 按 `emptyKind` 分组计数
  （分组计数不是对引擎数值做加法/换算）。三态互斥且穷尽：`8 + 15 + 1 = 24`（门里断言了这条恒等式）。
- **`capacity.maint` 单列**（工单 ⚠ 那条）：`sc-lane-CAPACITY-absent` 一行，
  实拍原文「在册不在场：本段另有 1 个节点在 `CHAIN_NODE_REGISTRY` 里，但本次载荷既没有环节、也没有 EMPTY 行
  （引擎一个字都没提它）—— 计划检修窗（capacity.maint）。…它既不是「0 天」也不是「算不出来」，是**没进这次输出**。」

### ④ 在途图层与线路图 —— **已叠在同一块画布上**

改的是**挂载点**，几何一行没重算：

- 画布槽里新增 `sc-metro-stack`（`position: relative`），线路图与在途层都在它里面；
- `transitOverlayBox`（纯函数，`sandboxConsole.ts`）把在途层那张环 SVG 钉到**线路图舞台 SVG 的同一个屏上矩形**，
  并按画布可视区 `clip-path: inset(...)` 裁掉溢出；
- **为什么这样就对得上**：两图 `viewBox` 都是 `0 0 980 680`（`RING_LAYOUT` 单源）。
  SVG 把 viewBox 等比映到自己的边框盒 ⇒ **盒子逐像素重合，同一坐标就是同一屏点**。
  上一单交付语里那句「叠加时坐标即刻对得上，无需再改几何」，兑现方式就是这个。
- **缩放平移天然跟随**：`getBoundingClientRect()` 返回的是**变换之后**的矩形，
  本函数不认识 `k/x/y`。重测的触发源 = 容器尺寸变化（`ResizeObserver`）+ 线路图**自己发布**的
  `data-zoom / data-pan-x / data-pan-y` 变化（`MutationObserver`）——**不读它的 state、不改它一行**。
- **量不到就不假装**：jsdom / 未布局 / `display:none` 时 `data-overlay-measured="0"`，
  CSS 选择器不命中 ⇒ 图层按常规块排在下方，屏上明写「画布尺寸不可测 ⇒ 本次没有叠加」。
  （与线路图 `doFit` 那句「画布尺寸不可测 → 已复位」同一条纪律。）
- 真浏览器实测（1600×1000 · Chromium）：

  | | left | top | width | height |
  |---|---|---|---|---|
  | 线路图舞台 `clm-stage` | 450 | 513.38 | 980 | 680 |
  | 在途环 `transit-ring` | 450 | 513.38 | 980 | 680 |
  | **放大到 1.20× 后** 舞台 | 398.2 | 445.38 | 1176 | 816 |
  | **放大到 1.20× 后** 在途环 | 398.2 | 445.38 | 1176 | 816 |

  `viewBox` 两图同为 `0 0 980 680`；ring 的 computed `position: absolute`、`clip-path: inset(0px 461px 0px 0px)`。
  **逐值重合，且跟着缩放走。**
- **两句常驻诚实位一个字没丢**：`transit-flow-host-nodes` 仍是
  「几何已**与线路图同源**…但两图**站点 key 宇宙不同**⇒**同角度不代表同一个实体**」，
  既有断言（`sandbox-console.seam:507-509`）原样绿，§9 再咬一次。
  叠加**没有**让那条缺口变小 —— 叠上去的是**同一个椭圆**，不是同一套站。

### ⑤ 阻滞点只能按 stage 联动 —— 缺口不修，但**它此前根本没在屏上**

复核结果（工单要求"确认屏上那句口径差说明还在且仍准确"）：

- `sc-imp-gap`（`IMPEDIMENT_DESIGN_GAP`）**还在、仍准确**：它说的是「设计稿把卡点注为规则/审批闸，
  而引擎 BOTTLENECK 两条判据都是产能/利用率打满」——**不涉及段数**，故 4→5 不影响它，**一字未动**。
- 但**「只能按 stage 联动、不能按节点精确点亮」这条口径差，此前只写在 `stagesOfKind` 的 JSDoc 里** ——
  **源码看得见，屏上看不见**。这是"诚实位只存在于注释里"的形态。
- 本单把它搬上屏（`sc-imp-join-gap`），段数写成 `共 {CHAIN_STAGES.length} 段`
  **派生**（写死"4 段"的话，chain-24 那天就过期了；现在实拍显示"共 5 段"）。
- **接缝本身一行未动** —— 硬映射会是一个"看着合理"的编造。

---

## 2 · 诚实位逐条清点（工单硬约束 1）

本页自有诚实位 **17 条**（复用组件自带的另计，见表末）。逐条核对"今天还是不是真的"：

| # | testid | 内容 | 本单处置 | 依据 |
|---|---|---|---|---|
| ① | `sc-window-badge` | 时窗 30/60/90D 无 ARGS | **一字未动** | 两个求解器仍无时间窗入参 |
| ② | `sc-dim-businessTypes-badge` / `-note` | 业务线无 ARGS + 后端 400 原文 | **一字未动** | `service.ts:3125` 仍显式拒绝 |
| ③ | `sc-dim-modelIds-badge` / `-note` | 产品无 ARGS + 后端 400 原文 | **一字未动** | 同上 |
| ④ | `sc-dim-baseIds-badge` | 基地已接线 | **一字未动** | 勾选仍真进 `args.scope`（门里咬着） |
| ⑤ | `sc-scope-reach` | `chain_loss_attribution` 不吃任何范围维度 | **一字未动** | 求解器未改 |
| ⑥ | `sc-imp-gap` | 卡点口径差（设计稿 vs 引擎判据） | **一字未动** | 不涉段数，仍准确（见 §1 ⑤） |
| ⑦ | `sc-imp-join-gap` | stage 联动口径差 | **本单新增（此前只在注释里）** | 本体 `G-IMPEDIMENT-LOSS-NOJOIN`；段数派生 |
| ⑧ | `sc-chain-coverage` | 链路阶段诚实边界 | **改口径不删**：删 1 句过期、改写 1 句废话、新增三态真话 | 见 §1 ③ |
| ⑨ | `sc-lane-*-absent` | 在册不在场 | **本单新增** | 载荷里 registry∖(nodes∪empty) |
| ⑩ | 灰卡片 `sc-empty-node-*` | EMPTY / kind / `未补 0` / **reason 原文** | **升级**（原为段尾一行 `sc-lane-*-orphan`，只有 label+kind） | 信息量增加，不是删除 |
| ⑪ | `sc-lane-*-empty` | 本次载荷这一段没有节点（不是 0 天） | **一字未动**（触发条件收紧为「节点与灰卡都没有」） | — |
| ⑫ | `sc-pareto-note` | 影响率分母由引擎给 · 守恒 Σ | **一字未动** | — |
| ⑬ | `sc-step-detail-note` | 天数取 `ChainStep.days`；三处同一份响应 | **一字未动** | — |
| ⑭ | `sc-inspect-evidence-gap` | 传下去的那份被 strip 掉 `evidence[]` | **本单新增** | 实测（§1 ①）；门里钉死 |
| ⑮ | `sc-transit-tiers`（时序可算性五档） | 三档 `modeReason` 逐字透传 + 节拍/采购 EMPTY | **一字未动** | 全部取自 `transitFlow.ts` 单源 |
| ⑯ | `sc-transit-overlay-note` | 叠加说明 + **量不到就不假装** | **本单新增** | — |
| ⑰ | `sc-metric-*` / `sc-imp-error` / `sc-family-error` / `sc-*-waiting` | EMPTY 不写 0 / 四卡显「—」不是 0 / 不画三个一样的环 / 等载荷不发第二次请求 | **一字未动** | — |

**删掉的文字只有两处，都在 ⑧ 里，且都不是"删诚实位"**：
1. 「扩注册表要连引擎一起改，**不在本单边界**」—— 该边界所指的那张单（WO-CHAIN-24）已交付，句子过期；
2. 「不拿 **24** 个冒充 **24** 个」—— 差额归零后字面是废话，改写成仍然为真的
   「不拿「在册数」冒充「有数据数」」（这正是本单要立的那个区别）。

复用组件自带的诚实位（**本单一个没碰、门里逐条复核仍在**）：物理拓扑「格内数值为占位值」横幅 ·
节点检视「段耗时为占位值·不是实测」· 线路图 AND≠OR 警示 + 停运站位 + 闭环结构推定 ·
在途层 `transit-geometry-source` + `transit-flow-host-nodes` + 节拍缺席 + 采购支线缺席。

---

## 3 · 既有断言：**红了 0 条**

`sandbox-console.seam` 既有 24 例、`node-semantics.seam` 全部、其余五道沙盘门全部 —— **一条未改、一条未红**。

设计上刻意避开了改动既有断言的两处：

1. `StageLaneVM.orphanEmpty` **保留**（新增的 `emptyNodes` 是它的另一种投影），
   于是 `:334`（DELIVERY 段 `nodes+orphanEmpty > 0`）与 `:585`（新节点在段内）零改动；
2. 灰卡片文案里保留了 `EMPTY` 与 `未补 0` 两个词，于是 `§4「链路阶段的 EMPTY 环节如实列出」`
   与 `§8「算不出来的段必须写明 EMPTY 与未补 0」`零改动。

`sc-chain-coverage` 那几条既有断言（`差 0 段 0 个节点尚未建模` / `5 段 24 节点` / `24 个静态在册节点`）
也**全部保留原文**，故 `§4` 那条金值用例一字未动。

---

## 4 · 门（新增 `sandbox-console.seam §9`，13 例）

| 组 | 咬什么 |
|---|---|
| ① ×3 | 点「变量输入」页签后 `chain_loss_attribution` **仍恒 1 次** + 面板文案翻成「未发第二次请求」；`ChainLossPayloadSchema` **确实 strip 掉 evidence**（拿真抓下来的 26 条过一遍）；屏上那段代价说明在 |
| ② ×3 | 每个「只有 EMPTY 行」的在册节点都有灰卡 + `reason` **逐字**对拍 + `emptyKind` 上屏；形状三层判据（`data-card-shape` 互异 / 不共用 class / CSS 里只有 `.emptyCard` 有 `clip-path`）；灰卡可点且右栏跟着切 |
| ③ ×2 | 三态互斥且穷尽（和 == 在册总数）+ 屏上数字与派生函数逐个对拍 + 「在册 ≠ 有数据」在 + 过期句已无；「在册不在场」在自己泳道里单列 |
| ④ ×4 | 两图同容器 + `viewBox` 逐字符相同；`transitOverlayBox` 用**真浏览器量到的矩形**逐值对拍（含放大平移与"量不到"两档）；CSS 钉钉子声明源码级咬死；两句常驻诚实位仍在 |
| ⑤ ×1 | stage 联动口径差在屏上 + 段数 == `CHAIN_STAGES.length` |

**为什么这些是接缝而不是各半 unit**：①数的是**跨组件的请求次数**（宿主 × 面板）；
②咬的是**引擎原文 → 屏上文字**的逐字传递；③咬的是**契约注册表 × 引擎载荷**两个集合的差；
④咬的是**两个独立组件的 DOM 矩形与 viewBox 是否落在同一套坐标**；⑤咬的是两个求解器之间那条对不上的缝。

---

## 5 · 变异反证（逐条真跑、真红、`git checkout --` 撤回、撤后 `git status --porcelain` 干净、撤完重新 build RC=0）

| # | 变异 | 打哪条 | 实测失败原文 | 红几例 |
|---|---|---|---|---|
| **A** | 右栏**不传** `lossPayload` | §9 ① | `右栏又自取了一次 chain_loss_attribution ⇒ 同一个问题问了两遍（宿主没把 lossPayload 传下去）: expected [ { …(2) }, { …(2) } ] to have a length of 1 but got 2` | 1 |
| **B** | 诚实位删掉「在册 ≠ 有数据」 | §9 ③ | `「在册 ≠ 有数据」这个区别不许从屏上消失: expected '诚实边界：设计目标 5 段 24 节点 …' to contain '在册 ≠ 有数据'` | 1 |
| **C** | 灰卡片改成与有数据卡**同一种形状**（`styles.nodeCard` + `solid-block`） | §9 ② ×2 | `demand.forecast 的灰卡片没有形状标识: expected 'solid-block' to be 'notched-tag'` ＋ `灰卡片与有数据卡用了同一个形状标识 ⇒ 屏上只剩颜色深浅的差别…: expected 'solid-block' not to be 'solid-block'` | 2 |
| **D** | 把 `.emptyCard` 的 `clip-path` 换成 `opacity: .6`（= **只靠深浅**分家） | §9 ② 几何层 | `灰卡片没有 clip-path ⇒ 它跟实心卡是同一个矩形，形状没分家: expected '.emptyCard {…' to contain 'clip-path'` | 1 |
| **E** | 把在途图层挪回 `sc-metro-stack` **外面**（复现"上下两个兄弟节点"） | §9 ④ | `叠加层钉的是 transit-ring 这个 testid；它不在同一个容器里 ⇒ CSS 选择器已经落空: expected +0 to be 1` | 1 |

A/B/C 是工单点名必须证的三条；D/E 是我另加的两条 —— D 专门证「只调颜色深浅过不了这道门」，
E 专门证「叠加的挂载点真的被咬着，改回兄弟节点会当场红」。
五条全部 `git checkout -- <file>` 撤回，撤回后 `git status --porcelain` 为空，撤完 `pnpm -r build` RC=0 重跑过。

---

## 6 · 真浏览器实拍（绿测试 ≠ 能用）

内存态 datacore(4001·`SEED_DEMO=1`·seed 42) + agentcore(4002) + `vite preview`(5401)，
Chromium(`/opt/pw-browsers/chromium-1194`) 登录 `demo/admin/demo1234` → **点左侧导航「推演沙盘」**（不 `page.goto`）。

⚠ 端口是 `curl` 探出来的：**4321 / 4322 被别的 agent 占着**（`curl` 拿到 404 而不是 refused），
故本次用 4001/4002/5401 —— `ss` 在本沙箱不报任何监听，"端口空着"只能靠真连一次判定。

**产物身份自证**（响应回来的那份 chunk 里真有本单新加的东西）：

```
chunk js  = SandboxView-lQDitnBY.js (59459 bytes)
  sc-empty-node- = 1 · sc-metro-stack = 1 · sc-imp-join-gap = 1
  sc-inspect-evidence-gap = 1 · notched-tag = 1 · solid-block = 1 · 在册 ≠ 有数据 = 1
chunk css = SandboxView-CNA8b-sG.css (14036 bytes)
  clip-path = 2 · transit-ring 钉钉子 = 1 · --sc-ov-left = 1
```

覆盖动作：四个画布模式逐个切 · 开在途图层 · 放大一档 · 点一个 `NO_CARRIER` 灰卡片。

**页面错误：2 条 console.error，逐条定性后 = 0 条与本单相关。**
CDP `Network` 域抓到的 ≥400 只有 `404 http://127.0.0.1:5401/favicon.ico`（请求两次 ⇒ 两条 console.error），
与 `PRD-transit-geometry.md` §5.1 记的那条同源，属 preview server 自身，无 `pageerror`、无失败请求。

---

## 7 · 本单**没**做到的（明说）

1. **控制台内的 R13 下钻三元组没有数据**（`G-CONSOLE-EVIDENCE-STRIPPED`）。
   这是①的代价，已上屏、已入门；补齐 = `chainLineMap.ts` 的 schema 加一行 `evidence`（禁改文件）。
   独立页 `/v/node-inspector` 不受影响。
2. **阻滞点仍只能按 stage 联动**（工单明令不许修）。
3. **线路图与在途层仍没有共同的站点 id 维度** —— 叠上去的是同一个椭圆，**不是同一套站**。
   两句诚实位原样在屏。补齐 = 引擎给在途层下发 `nodes[]`（图层 prop 已就位）。
4. **叠加靠 CSS 属性选择器咬在途层的 `transit-ring` testid** —— 因为不许改那个文件，
   拿不到它的 ref。testid 一旦改名，叠加会**静默失效**；已加一条门断言（`stack` 里必须恰有 1 个
   `transit-ring`）把"静默"变成"当场红"，但这仍是一处跨组件耦合，记在这里。
5. **`ResizeObserver` 在 jsdom 里不存在**，故 jsdom 下叠加只测一次、且必然 `measured=0`。
   叠加的真实证据来自真浏览器实拍（§6）与纯函数逐值对拍，不是 jsdom。
6. **设计稿每张卡的 `vars` / `rules` / `im` / `kpi` 四样仍未做**（沿用 `PRD-sandbox-metro-semantics.md` §3 的状态），
   本单只碰了"在册 / 有数据 / 不在场"这一层。
