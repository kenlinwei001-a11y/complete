# PRD · 推演沙盘「运营图主屏」重设计（COO 视角）

> **单号** WO-SANDBOX-METRO-PRD ·**日期** 2026-08-08 ·**基线 commit** `904c7b96`（canonical `claude/inspiring-gates-aqczjg`）
> **本文只改一个文件**：`docs/PRD-sandbox-metro-ops.md`。所有 `file:line` 锚点均在上述 commit 上实读，未跑任何测试。
> **前置阅读已完成**：`docs/SYSTEM-ONTOLOGY.md`（§2.I 推演沙盘域 / §3 / §5 R1–R19 / §8 断点表）——《本体引用与影响》见 §7。

---

## §0 问题陈述

### 0.1 仓主原话（唯一需求来源，不改写、不发挥）

> ① 「"推演沙盘"的布局有点混乱，你再从 COO 角度出发，考虑如何重新设计 UI 和 UX」
>
> ② 「页面里面除了"中央的线路图"外，其他信息太多了，让用户无法抓住重点」
>
> ③ 「中央位置需要保留类似地铁运营公司的"地铁路线"运转监控大屏，**可以不是环形设计**。用户可以按照**订单、产品线（乘用车，商用车。。），产品型号，不同基地**的筛选，**看到异常**，也可以**在每个节点输入扰动因素，看到输入后的财务指标的变化**」

### 0.2 「信息太多抓不住重点」的可度量口径

「混乱」不可判定，「多」可以。本节给三个**可机械复算**的口径，并标明每个值是**实测**还是**估算**——
本仓 2026-08-08 刚立过一笔账（`G-STALE-MEASURED-CLAIM` 同族：自称实测的假话），故此处逐项标注来源。

| 口径 | 定义（可机械复算） | 当前值 | 来源 |
|---|---|---|---|
| **M1 · 顶层信息块数** | `SandboxConsole.tsx` 渲染树里 `styles.root` 的**直接子块**数（非条件块 + 条件块分列） | **10 个常驻 + 1 个条件** | **实测**（逐块读 JSX，锚点见下表） |
| **M2 · 屏上锚点数** | 文件内**互异**的静态 `data-testid="sc-*"` 个数 | **62** | **实测**（脚本计数，金丝雀 `sc-topbar` 命中） |
| **M3 · 屏上散文字数** | 组件渲染体内 CJK 字符数（剔除 JSX 注释与块注释；不含宿主 `SandboxView` 传入的 `topTags`/`controlBar`/`rail`，也不含四个被嵌入的子视图各自的诚实横幅） | **1711 字**（主渲染体 1006 + 辅助组件 705） | **实测**（脚本计数，金丝雀同上） |
| **M4 · 中央画布面积占比** | 画布区像素面积 ÷ 首屏像素面积 | **未实测** | ⚠ **估算**：`SandboxConsole.module.css:166` 的 `.mid { grid-template-columns: 172px minmax(0,1fr) 300px }` ⇒ 1440px 视口下中栏横向占比 ≈ **66%**；但 `.mid` 只是 `.root` 的**其中一个**纵向块（上有顶栏 + 阻滞点条 + 2 条诚实横幅，下有控制条 + Pareto 面板 + 6 张指标卡），纵向占比无法从 CSS 静态推出。**故 M4 只有横向那一半是可推的，整体面积比本文不给数**——不跑浏览器就编一个百分比，正是本仓禁的那种假实测。

**M1 逐块清单（`apps/frontend-shell/src/views/sim/SandboxConsole.tsx`）**

| # | 块 | 行锚点 | 常驻? |
|---|---|---|---|
| 1 | 顶栏 `sc-topbar`（logo + 规模标 + 时窗三档 + 无ARGS徽标 + SEED 标 + 范围标 + 宿主 `topTags` + 前置期标 + 真实性开关 + 主题开关，共 10 项） | `:348` | 常驻 |
| 2 | 阻滞点统计条 `sc-impbar`（3 张阻滞点卡 + 1 张流动效率卡） | `:390` | 常驻 |
| 3 | 口径差横幅 `sc-imp-gap` | `:429` | `honesty` 开时 |
| 4 | 联动口径横幅 `sc-imp-join-gap` | `:452` | `honesty` 开时 |
| 5 | 左栏「范围」`sc-scope-pane`（3 个维度组 + 「范围能带到哪」+ 「阻滞点图例」= 5 组） | `:470` | 常驻 |
| 6 | 中栏画布 `sc-canvas-pane`（4 模式切换 + 2 个图层开关 + 缩放三键 + 提示标 + 4 个画布槽） | `:540` | 常驻 |
| 7 | 右栏「节点检视」`sc-inspect-pane`（2 页签 + 正文 + 宿主 `rail` 3 折叠区：就绪认证 / 多场景对比 / AI 指挥台） | `:752`；`rail` 定义在 `SandboxView.tsx:469,566,585` | 常驻 |
| 8 | 控制条（宿主 `controlBar`：推进 tick / 存档 / 分支 / 采纳 / tick 时间轴） | `:806`；`SandboxView.tsx:624` | 常驻 |
| 9 | 底部 Pareto 面板 `sc-pareto-pane` | `:809` | 常驻 |
| 10 | 底部指标卡片行 `sc-metrics`（6 张卡） | `:864` | 常驻 |
| 11 | 阻滞点取数失败提示 `sc-imp-error` | `:881` | 条件 |

### 0.3 病灶的准确命名（**不是「写得太啰嗦」**）

把 M3 那 1711 字读一遍就会发现：**它们绝大多数是对的、且是本仓用血换来的诚实位**——
`sc-imp-join-gap`（`G-IMPEDIMENT-LOSS-NOJOIN` 的当面披露）、`sc-scope-reach`（哪一维带得下去）、
`sc-chain-coverage`（在册 ≠ 有数据的三态）、`sc-inspect-evidence-gap`（`G-CONSOLE-EVIDENCE-STRIPPED`）。
**删掉它们 = 回到假绿**，本 PRD 一条都不删。

真正的病是**层级**：这些「为什么这个数不可信 / 这一维带不下去」的**工程真相**，与
「今天哪条线断了、断在哪一站、动一下会怎样」的**运营结论**，今天**平铺在同一层**，字号相近、位置相邻。
COO 打开这一屏，第一眼落在「chain_impediments 的 locus 是对象而 chain_loss_attribution 的节点是链路节点」上——
那是一句**给开发看的真话**，不是给决策者看的。

> **本 PRD 的核心主张**：诚实位不是要删的噪声，是要**分层**的证据。
> 结论在第一层，证据在第二层（一次点击可达），工程口径差在第三层（「真实性标注」开关下）。
> 判据：`honesty=off` 时屏上**不得出现任何数字**，只出现「本屏已隐去 N 条口径说明」——
> 关掉诚实位却照常显示数字，那才是把诚实位做成了装饰。

---

## §1 信息架构：三层

```
┌─────────────────────────────────────────────────────────────────────┐
│ 第 0 层 · 结论条（一行，≤6 个数）  前置期 / 增值占比 / 阻滞点 2·5·5 / 在险  │
├──────────┬──────────────────────────────────────────────┬───────────┤
│ 边缘轨   │            ★ 中央运营图 = 主角 ★               │  边缘轨   │
│ (次要)   │      站 = 环节 · 线 = 五条业务链 · 站上出异常     │  (次要)   │
│ 折叠     │      四维筛选在顶栏，不占画布                    │  折叠     │
├──────────┴──────────────────────────────────────────────┴───────────┤
│ 第 2 层 · 抽屉（点站才出）：逐环节表 · 扰动旋钮 · 财务对比 · 传导路径 · 证据 │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.1 逐块处置（一个都不许静默消失）

**处置只有三种**：`保留在中央` / `降级到抽屉`（点击可达）/ `降级到开关`（`honesty` 打开才出）。
**没有「删除」一档**——本仓的诚实位删一条就是一次回潮。凡本表写「降级」的，
S1 交付时必须能在 UI 上**两步之内**找回来，且门里咬住（§5 A4）。

| 现块 | 行锚点 | 处置 | 理由 |
|---|---|---|---|
| 顶栏 logo / 规模标 `sc-scale` | `:349,:352` | **保留**（合并成一行） | 规模标是「后端 N 段 / 本次载荷 M 节点」，属结论 |
| 时窗三档 + `sc-window-badge` | `:357,:365` | **降级到开关** | 三个按钮全 `disabled`——两个求解器都没有时间窗入参（实测口径见 `:131` 注释）。**一个恒禁用的控件占着顶栏是纯负担**；改为：`honesty` 开时以一行文字说明「时窗未接线」，控件本身撤下 |
| `sc-seed` / `sc-scope` / `sc-leadtime` 三标 | `:370,:373,:378` | `sc-leadtime` **升到第 0 层结论条**；另两个**降级到开关** | 前置期是 COO 要的数；SEED 与范围回显是工程口径 |
| 真实性标注开关 + 主题开关 | `:382,:386` | **保留** | 它是三层架构的总闸，必须常驻 |
| 阻滞点统计条 `sc-impbar` 4 卡 | `:390` | **升到第 0 层结论条**（压成一行徽标） | 「几个卡点 / 堵点 / 断点」就是仓主要的「看到异常」，是本屏最该被一眼看到的东西。四张大卡改成四枚可点徽标，点击 = 在图上高亮该类 |
| 口径差横幅 `sc-imp-gap` | `:429` | **降级到开关** | 内容是 `IMPEDIMENT_DESIGN_GAP`（`sandboxConsole.ts:149`）——设计稿措辞 vs 引擎判据的差异，工程真相，不是运营结论 |
| 联动口径横幅 `sc-imp-join-gap` | `:452` | **降级到开关 + 就地降级标** | `G-IMPEDIMENT-LOSS-NOJOIN` 的披露必须留着，但位置改为：点某类阻滞点徽标做高亮时，在**高亮那一处**挂一个「段级精度」小标，点开才出全文。理由见 §2.4 |
| 左栏三个范围维度组 `sc-dim-*` | `:475–511` | **上移到顶栏，成为四维筛选**（§3） | 仓主明确要「按订单/产品线/型号/基地筛选」。筛选器属顶栏，不该吃掉画布左侧 172px |
| 左栏「范围能带到哪」`sc-scope-reach` | `:517` | **降级到开关**（挂在筛选器的展开态里） | 「哪一维带得下去」是必须保留的诚实位，但它属于筛选器的说明，不属于常驻栏 |
| 左栏「阻滞点图例」`sc-legend` | `:528` | **降级到画布内浮层图例** | 图例应贴着图，不该单独占一栏 |
| ⇒ **左栏整体撤除** | `:470–537` | 172px 全部还给画布 | 三组内容分别去了顶栏筛选器 / 开关 / 画布浮层，**无一丢失** |
| 中栏画布 4 模式 `sc-mode-*` | `:544` | **保留，但改默认与主次**：`metro` 为主，`topo`/`chain`/`ontology` 降为「切换视角」下拉 | 仓主说的是「中央位置需要保留地铁路线大屏」——那是**一个主视图**，不是四个并列 tab |
| 在途图层 / 产品族同心环 两开关 | `:552,:556` | **保留**（移入画布右上角图层控件） | 都是叠加在主图上的图层，属于图的控件 |
| 链路阶段缩放三键 + 读数 | `:564–577` | **保留**（仅 `chain` 视角出现，行为不变） | |
| `sc-chain-coverage` 覆盖度长横幅 | `:629` | **降级到开关，且文案须改** | 它今天算出的 `missingStageCount`/`missingNodeCount` **都是 0**（§2.2 注）⇒ 「还差几段几个没建模」这半句已过期，该说的是「在册 24 个里 N 个有数据 / M 个诚实缺席 / K 个在册不在场」。**降级时顺手改文案，不许把一句过期的话折进抽屉继续正确**（`G-STALE-MEASURED-CLAIM` 同族） |
| 右栏「节点检视」两页签 | `:761–768` | **降级到抽屉**（点站才出，从右侧滑入） | 这正是仓主要的「点节点 → 看扰动与影响」的载体，但它不该在没选节点时就占 300px |
| 宿主 `rail` 三折叠区（就绪认证 / 多场景对比 / AI 指挥台） | `SandboxView.tsx:469,566,585` | **就绪认证降级到第 0 层一枚徽标**（`✓可进入推演` / `L1_CONFIGURED · N 个缺口`，点开出全表）；**多场景对比 / AI 指挥台降级到抽屉页签** | 就绪认证的**结论**是一个字（能不能推演），它的**明细**才是一张表 |
| 控制条（tick / 存档 / 分支 / 采纳） | `:806` | **保留**，压成一行贴底 | 这是会话状态机的操作面，COO 会用 |
| 底部 Pareto 面板 | `:809` | **降级到抽屉**（结论条上留「前 5 环节吃掉 X%」一句，点开出全图） | 原型也是这么做的（底部 30px 迷你条 + 「点开逐环节 ▸」） |
| 底部 6 张指标卡 `sc-metrics` | `:864` | **前置期 / 流动效率升到结论条；其余 4 张降级到抽屉** | 「环节 / 诚实缺席 = 12/3」这种数是工程口径 |
| `sc-imp-error` 取数失败提示 | `:881` | **保留**（错误永远是第一层） | 「四张卡显示『—』而不是 0」这条纪律不动 |

### 1.2 三层的硬判据（可机械判定）

- **L0 结论条**：≤ 1 行、≤ 6 个数、零散文。任何一个数点开必须能到 L1。
- **L1 抽屉**：一次点击可达；抽屉打开时**不遮挡中央图的异常站**（原型做法：画布右侧 `--rw` 收缩而非浮层覆盖，`sandbox-metro-ops.html` 的 `.mapwrap{inset:0 var(--rw) 30px 0}`）。
- **L2 开关**：`honesty=off` 时全部消失；**且此时屏上不得出现任何数字**（§0.3 的判据）。

---

## §2 中央运营图规格

### 2.1 数据来源（逐字段说清「今天真有 / 今天没有」）

三分法照 `CLAUDE.md 铁律 0.5` 判据①，**不许混为一谈**：

| 图元 | 需要的数据 | 今天的状态 | 三分法归类 | 出处 |
|---|---|---|---|---|
| **站（node）** | `nodeId` + `label` + `stage` | ✅ **真有** | — | `packages/contracts/src/chain-sim.ts:185–213` `CHAIN_NODE_REGISTRY`（**nodeId 的单一来源**，24 条静态节点 + `capacity.op.*` 动态工序命名空间） |
| **线（line）** | 站归属哪条业务链 | ✅ **真有** | — | `packages/contracts/src/chain-sim.ts:61` `CHAIN_STAGES = ["DEMAND","ORDER","CAPACITY","MATERIAL","DELIVERY"]` ⇒ **正好 5 段**。**「五条线」是 stage 的一一投影，不是新数据**（§2.2） |
| **站的半径** | 该节点吃掉的全链损失占比 | ✅ **真有** | — | `chain_loss_attribution` → `attribution[].pctOfChainLoss`；前端派生层 `sandboxConsole.ts buildStageBoard` 已算好 `NodeCardVM.pctOfChainLoss`（控制台 `:690` 已在用） |
| **站的异常态**（卡点/堵点/断点） | 该节点上有没有阻滞点 | 🔴 **接不上** | **接了线接错地方** | `chain_impediments` 的 `locus` 是**对象**（`chain-sim.ts:544 ChainLocusSchema {objectType,objectId,label}`，实测取值 `MaterialBatch`/`Line`/`Process`），**不是 nodeId**。详见 §2.4 |
| **换乘站** | 两条链在此交汇 | 🔴 **没有** | **没接线** | 全仓无「节点↔节点」的邻接表。`CHAIN_NODE_REGISTRY` 只有 `(nodeId,label,stage)` 三元组，**没有 `next`/`prev`/`edges`**。换乘站要么由 stage 边界推出（弱），要么新增一张边表（§2.5） |
| **站的顺序 / 坐标** | 画在哪 | 🔴 **没有** | **没接线** | 同上。原型的 `ST` 表 24 行坐标是**手绘的**，不是任何后端输出 |

> **金丝雀证据（否定结论必附，`铁律 0.6` 落地机制）**：
> 判「`ChainImpediment.nodeId` 引擎不填」用的命令是
> `grep -n 'nodeId' packages/contracts/src/chain-sim.ts apps/datacore/src/solvers/chain-impediment.ts`。
> **金丝雀 = 同一条命令在 `chain-sim.ts` 上命中 40+ 行**（含 `:615 nodeId: z.string().min(1).optional()`），
> 证明工具没坏；而 `chain-impediment.ts` **零命中**。
> 再追一层（`铁律 0.5` 判据④）：全仓 `impedimentId:` 的赋值点**只有一处** ——
> `apps/datacore/src/solvers/chain-impediment.ts:625`，即 `ChainImpediment` 的**唯一生产者**，
> 它不写 `nodeId`。⇒ **结论成立：`nodeId` 是 optional 且引擎恒不填。**
> 这一条同时**回答了本体 §8 `G-IMPEDIMENT-LOSS-NOJOIN` 里挂着的那个未决问**
> （原文：「`ChainImpediment.nodeId` 已在契约里是 optional，**但引擎实际填不填未核实**——若已填则本条严重度降一档，动工前先核这一条」）。
> **答案：没填。严重度不降。** 本 PRD 据此把 §7 的本体回写列为 S1 的交付物之一。

### 2.2 线 / 站 / 换乘站的画法

**线 = stage 的一一投影，不新造分类维**（R14：不许在前端内联一张业务词表）。

| 线 | 取自 | 站数（本次载荷口径） |
|---|---|---|
| 需求线 | `stage === "DEMAND"` | 3（`demand.consensus` / `demand.forecast` / `demand.quote`） |
| 订单线 | `stage === "ORDER"` | 3（`order.review` / `order.cash` / `order.settlement`） |
| 制造线 | `stage === "CAPACITY"` | 7 静态（`schedule`/`qc_batch`/`quality`/`aging`/`maint`/`rccp`/`wo_release`）+ `capacity.op.*` 动态工序 |
| 物料线 | `stage === "MATERIAL"` | 8（`mrp`/`replenish`/`shipping`/`kitting`/`purchase_req`/`purchase_order`/`inbound_transit`/`iqc`） |
| 交付线 | `stage === "DELIVERY"` | 3（`fg_stock`/`transit`/`acceptance`） |
| — | **合计** | **3+3+7+8+3 = 24 = `CHAIN_NODE_REGISTRY.length`**（逐行数，`chain-sim.ts:185–213`） |

> ✅ **「注册表还差多少」这个老口径今天已经归零，别照旧文案立单。**
> `sandboxConsole.ts:392` 的设计目标是 `{stageCount:5, nodeCount:24}`，而后端
> `CHAIN_STAGES.length === 5`（`chain-sim.ts:61`）、`CHAIN_NODE_REGISTRY.length === 24` ⇒
> `chainStageCoverage()`（`sandboxConsole.ts:424–425`）算出的 `missingStageCount = 0`、`missingNodeCount = 0`。
> 控制台 `:630` 那段横幅是**带变量的模板**，读源码时容易把模板里的例子当成实测值——我自己第一遍就读错了（见 §8.4 第 7 条）。
> **今天真正的缺口不是「注册表没建模完」，而是「在册 ≠ 有数据」的三态**
> （`withSteps` / `emptyOnly` / `absent`，`sandboxConsole.ts:439–443`；实测 `capacity.maint` 恰是那个「在册不在场」）。
> 中央图必须把这三态**画成三种形状**，而不是拿「24 个站」冒充「24 个算得出来的站」。

> ⚠ **与原型的差异必须当面说**：原型手绘的是「需求 / 物料 / 制造 / 交付 / 资金」五条，
> 其中**「资金线」在后端没有对应 stage** ——`inv`(开票)/`term`(账期)/`cash`(回款) 三站在契约里归 `ORDER`
> （`order.settlement` / `order.cash`）。
> **处置**：按后端 stage 画 5 条（需求/订单/制造/物料/交付），**不画一条后端没有的资金线**。
> 若产品上确需「资金」这条视觉线，那是**新增一个 stage**，必须先回写契约 + 本体，不能在前端硬分。

**站半径**：`r = f(pctOfChainLoss)`，`f` 必须单调且有下界（防 `G-PMDAG-NEGATIVE-WIDTH` 复发：
该断点的判据升级原文就是「凡 SVG 几何由容器尺寸除算得来的组件，必须有下界夹取 + 一条真浏览器 console 零错断言」）。
`pctOfChainLoss === 0` 的站画**最小半径**，不画成 0（0 半径 = 站消失 = 把「没损失」画成「没这个站」）。

**站颜色**：编码**阻滞点类别**（卡点红 / 堵点橙 / 断点紫 / 正常＝所属线的线色）。
类别取 `ChainImpedimentKindSchema`（`BOTTLENECK` / `CONGESTION` / `BREAK`），标签取
`chainImpediment.ts` 的 `IMPEDIMENT_KIND_LABEL` / `IMPEDIMENT_KIND_MEANING`（`sandboxConsole.ts:41` 已在复用），
**前端不重写一句**。

**换乘站**：今天**没有邻接表**（§2.1）。**S1 不画换乘站**，改画「跨段衔接位」——
即某 stage 的**最后一个有数据的站**与下一 stage 的**第一个有数据的站**之间画一条虚线。
**并在图上标注这是段级推断、不是实体邻接**。理由：硬编一张 24 站邻接表就是
`G-CHAIN-NODEID-FREESTRING` 那一课的原样复发（两个 dev 各造一套词表，交集 0）。
真换乘站见 §2.5 的补齐路径。

### 2.3 异常态怎么画（三类互斥，画法必须**形状分家**）

引擎侧三类互斥已由 `arbitrateByLocus` 单点裁决（本体 §2.I：「裁决只在 `arbitrateByLocus` 一处，
不靠 if 顺序的巧合」），前端**不重判**，只渲染。

| 类 | 引擎枚举 | 画法 | 为什么不能只差颜色 |
|---|---|---|---|
| 卡点 | `BOTTLENECK` | 站圈**加粗 + 内填充 + 辉光**，站名加粗 | 三类是**三种事实**（能力不够 / 流不动 / 接不上），不是强弱三档。控制台已立过同款判据（`SandboxConsole.tsx:679` 的 `data-card-shape` 实心卡 vs 缺角卡，注释原文：「形状必须分家、**不许只靠颜色深浅**」）——本图沿用同一纪律 |
| 堵点 | `CONGESTION` | 站圈**双环**（外环虚线） | |
| 断点 | `BREAK` | 站圈**缺口环**（弧线断开），并按 `breakSubtype`（`MATERIAL`/`LEADTIME`/`DATA`）在缺口处出小角标 | `breakSubtype==="DATA"` ⟹ `dataMode==="EMPTY"`（契约 `chain-sim.ts:595` 硬约束）——**「算不出来」也要画出来**，不许静默跳过 |
| 判不出来 | `unresolved[]` | 站画**问号态**（灰虚线圈），点开出 `unresolved` 原因原文 | 控制台底部指标卡已在显示「阻滞点 / 判不出 = N / M」（`:874`），本图把 M 那部分**画到具体的站上** |

> **对齐口径的诚实位（必须常驻，不进 `honesty` 开关）**：
> 原型顶栏那枚 `⚠ 证据 · 部分判定 2` 徽标在本设计里**保留且升级为常驻**——
> 扫描含 `PARTIAL` / `MOCK` / `EMPTY` 任一诚实位时它必须显眼（口径见控制台 `:434` 的 `honestyCounts` 分布）。
> **折叠的是位置，不是可见性**（仓主在原型注里点名的那一条）。
> 具体到本仓已知实例：`C05` 产线利用率红线**只读红线、不校验持续天数**（`SolverContext` 无时序访问）
> ⇒ 结论恒标 `dataMode=PARTIAL` + `caveats[]`（本体 §2.I 原文）。这个 `PARTIAL` 必须画在站上，不能只写在横幅里。

### 2.4 「站上出异常」这条线今天断在哪（本节是全篇第二要害）

**断点 = `G-IMPEDIMENT-LOSS-NOJOIN`**（本体 §8，状态 🟡 诚实降级中）。

- `chain_impediments` 的定位维：`locus{objectType,objectId,label}`（`chain-sim.ts:544`），实测取值 `MaterialBatch`/`Line`/`Process`。
- `chain_loss_attribution` 的定位维：`nodeId`（`CHAIN_NODE_REGISTRY` 取值域）。
- **两者没有共同 id 维度**，今天只有 `stage` 能对上（控制台 `stagesOfKind()` `:906` 就是这个降级，注释与屏上文案都写着）。

⇒ **S1 的画法只能是段级高亮**：点「卡点」徽标 → 该类落在哪些 stage → 那几条线整体高亮。
**不能按站精确点亮**。硬映射 locus→nodeId 会是一个「看着合理」的编造（本体原文用词）。

**补齐路径（S2，两条择一，本 PRD 建议 B）**

| 方案 | 做法 | 代价 | 风险 |
|---|---|---|---|
| A | 引擎侧给 `ChainImpediment` 填 `nodeId`（字段已在契约里，`chain-sim.ts:615`，只是恒不填） | 需要一张 `objectType → nodeId` 的映射，且**该映射本身就是要证的东西** | 高：等于把编造挪进引擎 |
| **B（建议）** | 反向：给 `chain_loss_attribution` 的每个节点补 `loci[]`（该节点由哪些对象承载） | 节点→对象是**生成侧就知道的**（环节是从对象算出来的），不是事后猜 | 低：是「把已知的写出来」，不是「把未知的补出来」 |

> **务必别判错量级**（本体 §8 `G-IMPEDIMENT-OPTION-NOJOIN` 行原文的教训：
> 「把『接一条线 + 一个枚举器』错报成『造决策引擎』，差一个数量级」）。
> 本条同理：这是**给已有输出加一个字段**，不是造第二个求解器。

### 2.5 换乘站的补齐路径（S3）

真换乘站需要**节点邻接**。今天 `CHAIN_NODE_REGISTRY`（`chain-sim.ts:185`）只有 `(nodeId,label,stage)`。
建议在**契约侧**（单一来源，两半共用）给注册表加 `downstream?: readonly string[]`，
并在 `chain-node-singlesource:check`（本体 §7 已有的门，覆盖 `synthetic/cadence.ts` + `solvers/chain-loss.ts` + 前端整树）
里加一条：**邻接表里出现的每个 id 必须在册**（复用 `isKnownChainNodeId()` `chain-sim.ts:243`，不另写判据）。
换乘站 = 入度 ≥ 2 或出度 ≥ 2 的节点，**由邻接表算出来，不手工标**。

---

## §3 四维筛选（订单 / 产品线 / 型号 / 基地）

### 3.1 逐维现状

| 维 | ①前端参数名 | ②契约字段 | ③引擎今天支不支持 | ④缺口 file:line |
|---|---|---|---|---|
| **订单** | `so` | 不在 `ChainScope` 里；是 `chain_loss_attribution` 的**锚点订单**入参 | ✅ **支持**（唯一支持的「订单维」，但语义是**锚定一张单算它的全链**，不是「筛一批单」） | 控制台今天**根本没暴露这个入参**（`SandboxConsole.tsx:288` 的 `lineMapView` 只传 `baseIds`）⇒ 仓主要的「按订单筛选」今天**在 UI 上不存在** |
| **产品线** | `scope.businessTypes` | `ChainScopeSchema`（`chain-sim.ts:291`），值域 `BusinessTypeSchema`（`passenger`/`commercial`/`storage`） | 🔴 **`chain_impediments` 显式 400 拒绝** | `apps/datacore/src/solvers/service.ts:3129–3134`（详见 §3.2） |
| **型号** | `scope.modelIds` | 同上 | 🔴 **同一处 400 拒绝** | 同上 |
| **基地** | `scope.baseIds` | 同上 | ✅ **真过滤**（实测：`baseIds=changzhou` 时 total 15→13，见控制台 `:518` 的实测记录） | 无缺口。实现在 `apps/datacore/src/solvers/chain-impediment.ts:544` |

### 3.2 产品线这一维：正面处置那道 400（**不许假装前端加个下拉就完了**）

**原文（`apps/datacore/src/solvers/service.ts:3127–3134`，实读）：**

```ts
private async chainImpediments(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rawScope = (args.scope ?? {}) as Record<string, unknown>;
  if (rawScope.businessTypes !== undefined || rawScope.modelIds !== undefined) {
    throw validationError(
      "chain_impediments 暂不支持 scope.businessTypes / scope.modelIds 维度过滤 —— " +
        "拒绝静默返全域（R-ARG-FIDELITY）；业务线 scope 入口见 WO-SANDBOX-E2",
    );
  }
```

**这道 400 是对的，不许拆。** 它是 `R-ARG-FIDELITY` 的正确实现，前身病灶
`G-PORTFOLIO-BT-SILENT-ALL`（实测 `businessTypes:["氢能"]` 与不传**逐字节同结果**）就是拆了它的样子。
前端 `sandboxConsole.ts:94–99` 的注释也记着同一条纪律：「前端悄悄吞掉一个维度才是 plausible-but-WRONG 的病根」。

**那么真缺口在哪？追了三层，答案是「一条 join 边」，不是「一个引擎」：**

1. **归一器已存在且已上生产**。`solvers/scope.ts:75 normalizeChainScope` 认三维、非法枚举值当场抛 400 并列出合法值。
   **生产调用方 5 处**（`service.ts:2734`、`service.ts:3226 orderFullchain`、`service.ts:3329 atpCheck`、`risk.ts:1148`、`risk.ts:1270`）——
   金丝雀：同一条 grep 命令在这 5 处命中，证明工具没坏。⇒ **归一这一层零新代码**。
2. **订单级三维过滤器也已存在**。`solvers/scope.ts:144 orderInChainScope`，三维全 AND：
   `businessTypes`（`:149`，经 `portfolio.ts:719 businessTypeOfOrder` 单源判定）∧ `modelIds`（`:150`）∧ `baseIds`（`:151`）。
3. **但它过滤的是 `Order`，而阻滞点的 locus 是 `Line`/`Process`/`MaterialBatch`。** 这才是真缺口。
   `chain-impediment.ts:544` 的基地维之所以能过滤，是因为**这些对象身上直接带 `baseId`**：
   `const scoped = wantBases ? objs.filter((o) => o.baseId === undefined || wantBases.includes(o.baseId)) : objs;`
   而它们身上**没有 `modelId`，也没有 `businessType`** ——
   实读种子字段映射（`apps/datacore/src/synthetic/battery.ts:1673,1675`）：
   - `Line` = `{lineId, baseId, name, line_code, max_capacity_day, target_yield, status}`
   - `Process` = `{processId, lineId, name, kind, yield}`

**补齐路径（有数据、有边、可做，但**不是**一个下拉框）**

`WorkOrder` 同时带 `lineId` 与 `modelId`（`battery.ts:1687`：
`{woId, moNo, modelId, lineId, baseId, qtyPlanned, qtyActual, startDate, endDate, status}`）⇒ 存在这条 join：

```
Line  ←lineId—  WorkOrder  —modelId→  Model            （型号维：1 跳，可做）
Line  ←lineId—  WorkOrder  —modelId→  Order.model  →  businessTypeOfOrder()   （产品线维：2 跳，M:N）
```

| 维 | 跳数 | 难点 | 建议 |
|---|---|---|---|
| **型号 `modelIds`** | 1 跳 | 无歧义 | **S2 做**。语义 = 「本产线/工序上跑过所选型号的工单」 |
| **产品线 `businessTypes`** | 2 跳，且 M:N | 一个型号可卖给多种业务线 ⇒ 「这条产线属于哪条业务线」**没有唯一答案**。必须先定语义：`ANY`（跑过任一所选业务线即命中）还是 `ONLY`（只跑该业务线才命中）？两者结论会不同 | **S3 做**，且**语义必须回带在 `scope` 里**让前端看得见（R-ARG-FIDELITY） |

> ⚠ **一条必须记进单子的数据事实**：本体 §8 `G-SOLVER-SCOPE-ECHO` 行已实测记载
> ——`WorkOrder` 的型号取值集含 **`储能-280Ah` / `储能-314Ah` 两个不在 `Model` 六型号内的孤儿**。
> ⇒ 上面这条 join 会有**接不上的行**。处置纪律照本仓既有样板：
> **接不上的 locus 必须显式列入 `unjoinable[]` + `dataMode` 标注，不许静默丢弃**
> （静默丢弃 = 用户以为筛了、其实少了一批站，正是 `G-PORTFOLIO-BT-SILENT-ALL` 的形态）。

### 3.3 订单维：今天 UI 上根本没有

仓主第一个要的筛选维，恰恰是**引擎支持最好、UI 暴露最差**的一维。

- `chain_loss_attribution` 认 `so`（锚点订单），控制台 `:519` 的诚实位原文写着：「它只认锚点订单 `so`」。
- 但控制台**没有任何地方让用户选 `so`** —— `lineMapView`（`:288`）只组装 `baseIds`。
- ⇒ 今天全屏的前置期 / Pareto / 五条线，算的都是**引擎默认选的那一张单**。

**S1 必须补上订单选择器**，且必须显示「当前锚点订单是哪一张、是用户选的还是引擎默认的」。
今天这个数没标出处，属 R13 违反（结论可溯源）。

> **另一层要说清**：`so` 的语义是**锚定一张单**，不是**筛一批单**。
> 仓主原话「按订单筛选」若指后者（比如「仅逾期风险 17 张」，原型 `sandbox-metro-ops.html:127` 就是这么画的），
> 那**引擎今天给不了**——`chain_loss_attribution` 的输出是单锚点的全链，不是订单集合的聚合。
> **S1 只做前者并把差异写在选择器上**；后者是 S4（需要引擎侧支持订单集合，属新能力）。

---

## §4 节点扰动 → 财务指标（全篇最容易造假绿的一节）

### 4.1 先把原型里的东西定性

原型 `sandbox-metro-ops.html` 的 `calc()`（`:323–345`）是这样的：

```js
const KNOBS={ slit:[["产能（班次）","%",0,-20,60, 1.9,-.55,-.9,2.1], ... ] };
const BASE={ontime:91.2,gm:18.6,ccc:112,risk:2.4,lt:85.4};
ks.forEach((k,i)=>{const t=(vals[i]-k[2])/Math.max(1,(k[4]-k[3]))*100/10;
  d.ontime+=t*k[5]; d.gm+=t*k[6]; d.ccc+=t*k[7]*3; d.risk+=t*k[8]*-.06; d.lt+=t*k[7]*2.2;});
```

**定性：这是一个写死系数的线性近似。** 每个旋钮的 4 个尾数（`1.9,-.55,-.9,2.1`）就是四条斜率，
`BASE` 五个基线数也是字面量。**本 PRD 明确：这套东西一行都不许进产品代码。**
它违反 R14（应用层无业务常数）、R13（结论可溯源）、以及 `KILL-MOCK-RED`。
它在原型里的作用是**表达交互形态**（拖一下，五个数当场变，并列出传导路径），
形态要，数不要。

### 4.2 分界线：今天能真算的 vs 今天算不出来的

**关键发现：「旋钮 → 重算」这条路本仓早已建成，且是真的。** 不需要造。

`apps/frontend-shell/src/views/sim/DynamicLeverPanel.tsx`（组件头注释 `:13–22`，闭 `G-WHATIF-HARDCODED-LEVERS`）：

- ① 旋钮**从本体派生 DAG 反推**（`generic_inference` `mode:"levers"`，服务端算敏感度，**杠杆随瓶颈变，非写死**）——`:133`
- ② top-K 动态滑杆 + tornado 条（按真敏感度 ∂目标/∂杠杆 降序）
- ③ 拖动 → `generic_inference` recompute **真重算** → before/after `deltas` + 每值 `Provenance`（R13）——`:152,:209`
- ④ 边界自规则闸（外协上限读 C08 规则表，非内联）——`:48–61,:87`
- ⑤ 多方案利弊矩阵（每方案真算，一键采纳走 `ActionDraft`，R4）

它的入参形状（`:94–128`）恰好就是本图需要的：`targetType` / `targetProp` / `scopeObjectIds` / `factors` / `grain`。
**而阻滞点的 `locus{objectType,objectId}`（`chain-sim.ts:544`）正是 `scopeObjectIds` 要的那个形状**
——§2.4 里接不上的是 locus↔nodeId，**locus↔杠杆是接得上的**。

⇒ **能真算的那一半 = 「点一个有阻滞点的站 → 用它的 locus 喂 `DynamicLeverPanel` → 拖旋钮 → `generic_inference` 真重算 → 出 before/after」。这是接线，不是造引擎。**

### 4.3 算不出来的那一半：五个财务指标里，四个今天没有单一真值源

`generic_inference` 的输出是 `deltas: {objId,type,prop,before,after}[]`（`DynamicLeverPanel.tsx:24–37`）
——即**对象属性**的前后值，**不是**原型顶栏那五个经营指标。逐个查：

| 指标 | 今天有没有真值源 | 出处 / 缺口 |
|---|---|---|
| **全链前置期** | ✅ **有** | `chain_loss_attribution.totals.leadTimeDays`，控制台 `:865` 已在渲染。**这一个可以真算真变** |
| **增值占比 / 流动效率** | ✅ **有** | 同上 `totals.flowEfficiency`（`:868`） |
| **准时交付率** | ◐ **有实现，但不在这条链上** | `apps/datacore/src/solvers/aggregates.ts:68 otdBatchRate`（WO-SANDBOX-D4 聚合层，唯一实现）。它吃的是 `risk_timeline` 的 `affectedOrders[]` + `crossDay`，**不吃 `chain_loss_attribution`**。要在本屏用，需要多调一个求解器并说清两者口径不同 |
| **毛利率** | ◐ **有实现，但与扰动不联动** | `finance_pnl`（`service.ts:3146`）读 `FinancePlan` 对象出预算/滚动毛利率。它**读的是计划对象，不是推演结果** ⇒ 拖旋钮**不会**让它变。要联动必须让 `generic_inference` 的 `deltas` 能传导到 `FinancePlan`，那是新的派生边 |
| **现金周期 / 现金流** | 🔴 **今天算不出来，且已被引擎显式登记为 EMPTY** | `apps/datacore/src/solvers/aggregates.ts:355 chainOperatingCashflow` —— **恒 `dataMode:"EMPTY"`**（`:392`）。原文注（`:402–405`）：「全链经营现金流今日 EMPTY：**收现腿无时间轴**（`ARInvoice` 无开票/到期/回款日）、**付现腿无账期**。手上仅有的两个现金口径分量在计量种类·量纲·时间颗粒·活动分类**四处全冲突**，相加得到的数没有会计含义。」`missingInputs` 逐条点名（`:397–401`）：`ARInvoice.invoiceDate\|dueDate\|settledAt` · `FinanceAccount.period` · `PurchaseOrder.paymentTermDays` |
| **在险营收** | ◐ **有近亲** | `solvers/decision-info.ts:360 revenueAtRiskYi`（来自 `exposure`）。属另一条链，与扰动不联动 |

> **⚠ 这是本 PRD 最重要的一句**：原型顶栏那个「现金周期 **112 天**」是**编的**。
> 引擎不但算不出来，还**主动把「为什么算不出来」逐条登记了**（`notSummable` + `missingInputs`）。
> 把它渲染成一个会随旋钮变的数字，等于把引擎已经诚实标 EMPTY 的地方**重新造假**——
> 这正是 `genuine-sim` 那场战役打的东西。**S1 起，本屏的现金周期一律显示 `EMPTY` + 点开出 `missingInputs` 三条**，
> 直到那三个字段真被建模。

### 4.4 结论：S1 的扰动面板长什么样（诚实版）

点一个站 → 右抽屉「扰动」页签：

1. **旋钮区**：`DynamicLeverPanel`，`scopeObjectIds` = 该站上阻滞点的 `locus.objectId` 集合，
   `targetType`/`targetProp` 由该站的阻滞点 `evidence.derivationEdge` 推出。
   **旋钮本身由 `generic_inference mode:"levers"` 服务端派生，前端零写死**。
   该站**没有**阻滞点 locus ⇒ 显示「本站今天没有可拨的杠杆（无 locus）」，**不给假旋钮**
   （同 `SandboxConsole.tsx:357` 那三个 disabled 时窗按钮的既有纪律）。
2. **影响区（分两栏，栏名就是分界线）**：
   - 左栏「**真重算**」：`generic_inference` 的 `deltas` 逐行 before→after，每行挂 `<Provenance>`；
     加上 `chain_loss_attribution` 重取后的**前置期 / 流动效率**真值前后对比。
   - 右栏「**今天算不出来**」：准时交付率 / 毛利率 / 现金周期 / 在险营收 四项一律显示
     `EMPTY` + 一行原因（现金周期直接透传引擎 `note` 原文，不改写）。
3. **传导路径**：原型画的是 `HOP` 手绘表（`sandbox-metro-ops.html:337`）。
   产品里改取 `generic_inference` 的 `deltas[].objId` **真影响面**（`affectedObjects` 已在输出里，`:34`），
   **不手绘下游站名**。

> **不许做的三件事（写进工单，退单判据）**：
> ① 不许在前端定义任何「旋钮→指标」的系数；
> ② 不许把「算不出来的四项」显示成 0 或灰掉的具体数字（要么真值，要么 `EMPTY` + 原因）；
> ③ 不许把 `generic_inference` 的 `deltas` **改名**成经营指标去凑五个数
> （那是 `G-SOLVER-SCOPE-ECHO` 的「只回显不重算」换个马甲）。

---

## §5 验收判据（复验方逐条核，缺一不算过）

| # | 判据 | 可机械判定的形式 | 由谁验 |
|---|---|---|---|
| **M1** | **三层架构成立**：`honesty=off` 时屏上出现的**数字字符**（`/[0-9]/`）总数 = 0，且出现一行「已隐去 N 条口径说明」 | 渲染后取 `textContent` 正则计数 | `frontend/test/sandbox-metro-ia.test.tsx` |
| **M2** | **诚实位一条不丢**：§1.1 表里标「降级」的每一块，都能在 ≤2 次交互后出现；逐块断言其**关键字符串**仍在 DOM 里（取自单一来源常量，不在测试里抄字面量） | 逐 testid 展开 + 断言 | 同上 |
| **M3** | **中央图占主**：`metro` 视角下画布容器的 `clientWidth` ≥ 页面宽 × 0.75（左栏撤除后） | jsdom 拿不到布局 ⇒ **必须真浏览器**（Playwright），且同一跑加一条 **console 零错**断言（`G-PMDAG-NEGATIVE-WIDTH` 判据升级要求） | `e2e/sandbox-metro.spec.ts` |
| **M4** | **站半径有下界**：`pctOfChainLoss === 0` 的站，其 `<circle r>` ≥ `MIN_STATION_R` 且 > 0 | 直接读 SVG 属性 + 真浏览器 console 零错 | 同上 |
| **M5** | **异常态形状分家**：三类阻滞点站的 `data-station-shape` 三值互异（不是三个颜色 token） | DOM 属性断言 | `frontend/test/sandbox-metro-abnormal.test.tsx` |
| **M6** | **不画后端没有的线**：图上线数 === `CHAIN_STAGES.length`（派生，非字面量）；且不存在名为「资金」的线 | 从契约派生对比 | 同上 |
| **M7 · 接缝（SEAM-GATE）** | **四维筛选跨「前端 × 引擎」端到端真收窄**（见 §5.1 详述） | 见下 | `apps/datacore/test/sandbox-metro-scope.seam.test.ts` |
| **M8 · 接缝（SEAM-GATE）** | **扰动跨「阻滞点 × 杠杆引擎」端到端真变**（见 §5.2 详述） | 见下 | `apps/datacore/test/sandbox-metro-lever.seam.test.ts` |
| **M9 · 变异反证** | 掐掉 M7/M8 各自的那条接线 → 对应断言**必须变红**，且报告里贴红的原文（见 §5.3） | 变异脚本 | 复验方手跑 |
| **M10** | **现金周期不许出数**：断言该格文本 === `EMPTY` 且包含引擎 `missingInputs` 里的三个对象类型名；**若哪天引擎不再 EMPTY，这条断言必须红**（逼人回来改 UI，而不是让一句过期的话永远正确） | 双向断言 | `frontend/test/sandbox-metro-cash-empty.test.tsx` |
| **M11** | **R6 确定性**：同 seed 同筛选连跑两次，`chain_impediments` + `chain_loss_attribution` 两份输出字节一致 | `diff` | 既有 `chain-impediment-seam.test.ts` 扩条 |
| **M12** | **零业务常数**：`debattery:check` 与 `boundary-singlesource:check` 绿；新组件里不得出现 `乘用车`/`商用车`/`储能` 字面量与任何斜率数字 | 既有门 | `pnpm gates` |
| **M13** | **本体已回写**：§7 列出的每一条（含 `G-IMPEDIMENT-LOSS-NOJOIN` 那个未决问的答案）都进了 `docs/SYSTEM-ONTOLOGY.md` | `ontology-writeback:check` | 门 |

### 5.1 M7 接缝测试（跨「数据 × 引擎」，不是各半 unit）

**为什么必须是接缝测**：本仓 `metric-aware` 反复炸的根就是「拆两半用不同机制不对接」。
四维筛选恰好是两半：前端组 args（`SandboxConsole` 的 `impArgs` `:255`）× 引擎解析（`normalizeChainScope` / `chain-impediment.ts:544`）。

断言（一条测试里全跑，任一半漏即红）：

1. `scope.baseIds=["changzhou"]` → `total` 严格小于不传时（**效果层**，非「参数传下去了」）；
2. `scope.baseIds=["常州"]` 与 `["changzhou"]` 结果**逐字节相同**（中文名归一走 `resolveScopeBaseIds` 单源）；
3. `scope.baseIds=["火星"]` → **400**，且错误信息里列出合法值（不静默返全域）；
4. `scope.modelIds=[...]`（S2 后）→ 真收窄，且 `unjoinable[]` 非空时**必须回带**（§3.2 的孤儿型号）；
5. 返回的 `scope` 回带**等于**解析后的 canonical 值（`echoChainScope`，`scope.ts:167`），前端据此渲染「你筛的是什么」。

### 5.2 M8 接缝测试（跨「阻滞点 × 杠杆引擎」）

1. 取一条真阻滞点的 `locus{objectType,objectId}`；
2. 用它调 `generic_inference` `mode:"levers"` → 断言返回的杠杆集**非空**且每条带 `sensitivity`；
3. 拖动其中敏感度最高的一条 → `generic_inference` recompute → 断言 `deltas` **非空**；
4. **效果层**：重取 `chain_loss_attribution` → `totals.leadTimeDays` **真的变了**（不是「调用发生了」）；
5. 断言那四个「今天算不出来」的指标**没有**出现在 `deltas` 里（防有人偷偷造出来）。

### 5.3 M9 变异反证（必须贴红的原文）

| 变异 | 掐哪一根 | 期望红的断言 | 期望报出的原文（示例格式，实测时以真输出为准） |
|---|---|---|---|
| **变异 1** | 把 `chain-impediment.ts:544` 的 baseIds 过滤改回 `const scoped = objs`（不过滤） | M7 断言 1 | `expected 13 to be less than 15` —— 即「筛了基地但总数没变」，正是 `G-PORTFOLIO-BT-SILENT-ALL` 的形态 |
| **变异 2** | 把 `service.ts:3129` 那个 400 改成静默丢弃 `businessTypes` | M7 断言 3 | `expected [Function] to throw error` —— 门必须咬住「这道 400 不许被拆」 |
| **变异 3** | 把扰动面板的 `scopeObjectIds` 传成空数组 | M8 断言 2 | `expected levers.length to be greater than 0, got 0` |
| **变异 4** | 把「现金周期」那一格改成渲染任意数字 | M10 | `expected "112" to be "EMPTY"` |

> **变异反证的纪律（`铁律 0.6` 已落地机制）**：门脚本里的金丝雀**必须与主逻辑共用同一份实现**，
> 不许各抄一份正则——抄了就是装饰品。M1/M6 的「从契约派生」正是为此。

---

## §6 分期

| 期 | 内容 | 出口判据 | 是否依赖引擎侧改动 |
|---|---|---|---|
| **S1 · 三层重排 + 中央图立起来** | ① 撤左栏、四维筛选上顶栏（订单维**首次**暴露）；② 结论条 L0；③ 中央 metro 图按 stage 画 5 条线 + 站半径 ∝ 损失 + 段级异常高亮；④ 抽屉化（节点检视 / Pareto / rail 三区）；⑤ 扰动面板接 `DynamicLeverPanel`，五指标分「真重算 / 算不出来」两栏 | M1 M2 M3 M4 M5 M6 M8 M10 M11 M12 | **否**。全部是前端重排 + 复用既有求解器。**这是本 PRD 的主体，且不被引擎侧阻塞** |
| **S2 · 型号维 + 阻滞点落到站** | ① `chain_impediments` 接 `modelIds`（经 `Line ←lineId— WorkOrder —modelId→`，孤儿行进 `unjoinable[]`）；② `chain_loss_attribution` 每节点补 `loci[]`（§2.4 方案 B）→ 异常态**从段级精度升到站级精度** | M7（含断言 4）M9 变异 1/2 | **是**。改 `apps/datacore/src/solvers/chain-impediment.ts` + `chain-loss.ts` + 契约 |
| **S3 · 换乘站 + 产品线维** | ① 契约 `CHAIN_NODE_REGISTRY` 加 `downstream[]`，换乘站由入/出度算出；`chain-node-singlesource:check` 加一条；② 产品线维（2 跳 M:N），语义 `ANY`/`ONLY` 二选一并回带在 `scope` 里 | M6 扩条 + M7 扩条 | **是**。契约 + 引擎 + 门三处 |
| **S4 · 订单集合筛选 + 财务联动** | ① 「仅逾期风险 N 张」这类**订单集合**筛选（引擎需支持集合锚点，非单 `so`）；② 让 `generic_inference` 的 `deltas` 传导到 `FinancePlan` ⇒ 毛利率随扰动真变 | 新接缝测 | **是，且是新能力**，不是接线 |
| **S5 · 现金维解封** | 建模 `ARInvoice.invoiceDate/dueDate/settledAt` + `FinanceAccount.period` + `PurchaseOrder.paymentTermDays`（引擎 `missingInputs` 已逐条点名）⇒ 现金周期从 `EMPTY` 变成真值 | M10 **反向红**（EMPTY 断言必须失败，逼着改 UI） | **是**。是数据建模工作，不是 UI 工作 |

> **分期纪律**：S1 **不等** S2–S5（`铁律 2`：gate 只挡「推正线」，不挡「开工」）。
> S1 独立可验收、独立可上线，且它已经解决了仓主提的三条里的两条半
> （布局混乱 ✅ / 抓不住重点 ✅ / 中央运营图 ✅ / 四维筛选 ◐ 订单+基地真、型号+产品线诚实标未接线 / 节点扰动 ◐ 一半真算一半诚实 EMPTY）。

---

## §7 本体引用与影响（`铁律 0` 强制）

### 7.1 触及的对象类型

| 对象类型 | 域 | 本 PRD 怎么用 | 是否新增 |
|---|---|---|---|
| `ChainImpediment` | §2.I 推演沙盘域 | 站的异常态来源；locus 用作扰动面板的 `scopeObjectIds` | 否（`chain-sim.ts:601`） |
| `ChainLocus` / `ChainImpedimentEvidence` / `ChainManifestation` | §2.I | locus 是 §4 接线的关键；evidence 是 R13 下钻 | 否 |
| `ChainNode` / `ChainStep` / `CHAIN_NODE_REGISTRY` | §2.I | 站与线的单一来源 | 否；**S3 拟加 `downstream[]` 字段**（届时回写本体 §2.I） |
| `SandboxViewConfig` | §2.I | 三层布局的配置驱动载体（R14：换租户=换配置） | 否 |
| `SimSession` / `SimTickState` / `SimCheckpoint` | §2.I | 控制条（tick/存档/分支）不动，仅位置下移 | 否 |
| `SimCertification` | §2.I | 就绪认证从 rail 折叠区升为 L0 徽标 | 否 |
| `Line` / `Process` / `WorkOrder` / `Order` / `Model` | §2.B/§2.F | §3.2 那条 join 的四个端点 | 否 |
| `ARInvoice` / `FinanceAccount` / `PurchaseOrder` | §2.B | S5 现金维解封要补的三处字段 | 否（字段新增，见 `aggregates.ts:397`） |

### 7.2 触及的链路（§3）

```
① chain_loss_attribution --nodeId--> 中央运营图（站/线/半径） --pctOfChainLoss--> 站半径
② chain_impediments --locus{objectType,objectId}--> 站异常态
   ⚠ 断在这里：locus ⊗ nodeId 无共同 id 维（G-IMPEDIMENT-LOSS-NOJOIN）→ S1 段级降级 / S2 补 loci[]
③ 顶栏四维筛选 --args.scope--> normalizeChainScope(scope.ts:75) --> chain_impediments(chain-impediment.ts:544)
   ⚠ businessTypes/modelIds 在 service.ts:3129 显式 400（正确，不许拆）→ S2/S3 补 join 边
④ 站 --locus--> DynamicLeverPanel --generic_inference mode:levers--> 杠杆集
   --recompute--> deltas --> 重取 chain_loss_attribution --> totals 真变（效果层）
⑤ 扰动采纳 --> ActionDraft --> Action 审批（R4，沙盘只推演不写真值 · RL4）
```

### 7.3 触及的事件（§4）

- `sim.*` 六事件（`app.ts:1397` 起）：本 PRD **不新增事件**。
- ⚠ 但必须记账：`G-SIM-EVENT-NOSUB`（🔴 未修）——`sim.*` 真 emit、**零消费方**
  （`agentcore/event-subscriptions.ts` 与前端 `store/eventInvalidation.ts` 两处 grep `sim.` 均零命中）。
  ⇒ 本屏的控制条推进 tick / 存档 / 分支后，**跨页数据不会失效**。
  本 PRD 不修它（超范围），但 S1 交付时**必须在控制条上标出这条已知边界**，不许让用户以为推进 tick 会刷新别的页。

### 7.4 触及的不变量

| 不变量 | 本 PRD 的落点 |
|---|---|
| **R6 确定性** | M11：同 seed 同筛选两跑字节一致；旋钮值进 args，不进随机 |
| **R13 结论可溯源** | §3.3 锚点订单必须标出处；§4.4 每个 delta 挂 `<Provenance>`；「算不出来」必须给 `missingInputs` 原文 |
| **R14 应用层无业务常数** | §4.1：原型的写死系数一行不许进；线名由 `CHAIN_STAGES` 派生；三业务线标签取契约 |
| **R17 决策单页** | 本 PRD 就是 R17 的正面实施：数据→推演→溯源→动作→AI 一页内就地下钻不跳页 |
| **R-ARG-FIDELITY** | §3.2：那道 400 不许拆；§5.1 断言 5：`scope` 必须回带 canonical 值 |
| **R4 / RL4 走正门** | §6 S1 ⑤：扰动采纳只产 `ActionDraft`，沙盘不写真值 |
| **RL3 单一来源** | 阻滞点标签/含义取 `chainImpediment.ts` 既有两张表；节点取 `CHAIN_NODE_REGISTRY`；不在前端抄第二份 |
| **RL9 additive 可回退** | 三层重排走 `SandboxViewConfig`，旧布局保留为配置的一档 |

### 7.5 触及的断点（§8）

| 断点 | 状态 | 本 PRD 的关系 |
|---|---|---|
| `G-IMPEDIMENT-LOSS-NOJOIN` | 🟡 诚实降级中 | **本 PRD 回答了它挂着的那个未决问**：`ChainImpediment.nodeId` 引擎**恒不填**（唯一生产者 `chain-impediment.ts:625` 不写该字段）⇒ **严重度不降**。S2 按方案 B 补齐。**S1 必须回写本体这一条** |
| `G-IMPEDIMENT-OPTION-NOJOIN` | 🔴 未修 | 同族。本 PRD 不修，但 §2.4 引用它的教训（别把「接一条线」错报成「造引擎」） |
| `G-SIM-EVENT-NOSUB` | 🔴 未修 | §7.3：不修，但必须在控制条上标明 |
| `G-SIM-SCOPE-UNREAD` | 🔴 未修 | `SimSession.scope` 有写端无读端。本屏的四维筛选走的是**求解器 args**，不是会话 scope ⇒ **不受影响**，但 UI 上不得暗示筛选被会话记住了 |
| `G-CONSOLE-EVIDENCE-STRIPPED` | 🟡 已当面说明 | `ChainLossPayloadSchema` strip 掉 `evidence[]`。S1 重排时**顺手补这一行**（`chainLineMap.ts`），补完 `SandboxConsole.tsx:933` 那段文案与门断言要同时改 |
| `G-PMDAG-NEGATIVE-WIDTH` | ✅ 已闭 | 判据升级适用于本图：M4 站半径下界 + M3 真浏览器 console 零错 |
| `G-PORTFOLIO-BT-SILENT-ALL` | ✅ 已闭 | §3.2 的反面教材；变异 1/2 就是防它复发 |
| `G-STALE-MEASURED-CLAIM` | — | §0.2 逐项标注实测/估算，即为此条 |
| `G-CHAIN-NODEID-FREESTRING` | ✅ 已闭 | §2.2/§2.5：不手抄节点词表，一律从 `CHAIN_NODE_REGISTRY` 派生 |

### 7.6 需要回写本体的内容（S1 交付物，`RL1` 本体先行）

1. §8 `G-IMPEDIMENT-LOSS-NOJOIN` 行：把「引擎实际填不填未核实」改成「**已核实：恒不填**（唯一生产者 `chain-impediment.ts:625`）」，并记补齐方案 B。
2. §2.I：`SandboxViewConfig` 条目下补三层 IA 的口径。
3. §5：若 S1 立「诚实位分层」为可判定纪律（`honesty=off` 时零数字），登记为新检测点。
4. §7：新增门 `sandbox-metro-ia:check` 与两条 SEAM 测试进 `scripts/gate-ledger.json`。

---

## §8 诚实边界

> 本节是复验入口。三类分开列，**不混**。

### 8.1 我**亲手读代码验过**的（有 file:line，可当场复算）

1. **`chain_impediments` 显式 400 拒绝 `businessTypes`/`modelIds`** —— 实读 `apps/datacore/src/solvers/service.ts:3127–3134`，原文已在 §3.2 逐字引用。（工单给的锚点是「~`service.ts:3125`」，**实际 `if` 在 `:3129`，`:3124–3125` 是那段注释** ——差 4 行，结论一致。）
2. **`chain_impediments` 的 baseIds 过滤只按对象自带的 `baseId` 属性做** —— `apps/datacore/src/solvers/chain-impediment.ts:544`，原文已引。
3. **`ChainImpediment.nodeId` 是 optional 且引擎恒不填** —— 契约 `packages/contracts/src/chain-sim.ts:615` 声明 optional；`grep nodeId` 在 `chain-impediment.ts` **零命中**（金丝雀：同命令在 `chain-sim.ts` 命中 40+ 行）；再追一层，全仓 `impedimentId:` 赋值点**唯一**在 `chain-impediment.ts:625`。⇒ **这直接回答了本体 §8 里挂着的未决问，答案是「没填」。**
4. **三维 scope 归一器与订单级过滤器已存在且已上生产** —— `apps/datacore/src/solvers/scope.ts:75 normalizeChainScope`（生产调用方 5 处：`service.ts:2734/3226/3329`、`risk.ts:1148/1270`）、`scope.ts:144 orderInChainScope`（三维全 AND，`:149/:150/:151`）。**故产品线筛选不是「零基础造」。**
5. **`Line`/`Process` 对象身上没有 model/businessType，`WorkOrder` 上两者都有** —— `apps/datacore/src/synthetic/battery.ts:1673`（Line）、`:1675`（Process）、`:1687`（WorkOrder）。这是 §3.2 那条 join 的全部依据。
6. **全链经营现金流恒 EMPTY，且引擎已逐条登记缺什么** —— `apps/datacore/src/solvers/aggregates.ts:355–406`，`dataMode:"EMPTY"` 在 `:392`，`missingInputs` 三条在 `:397–401`，`note` 原文在 `:402–405`。
7. **OTD 准时率有唯一实现但吃的是 `risk_timeline` 的输入** —— `aggregates.ts:68 otdBatchRate`。
8. **`DynamicLeverPanel` 已实现「本体派生旋钮 + `generic_inference` 真重算 + Provenance」** —— `apps/frontend-shell/src/views/sim/DynamicLeverPanel.tsx:13–22`（头注释）、`:94–128`（props）、`:133`（杠杆发现）、`:152/:209`（recompute）、`:24–37`（`deltas` 形状）。
9. **`SandboxConsole.tsx` 的逐块行锚点** —— §1.1 表里每一行的行号都是逐块读 JSX 数出来的（文件 1227 行，全文读完）。
10. **M2=62、M3=1711** —— 脚本计数，金丝雀 `sc-topbar` 命中后才取数。
11. **`.mid` 三栏宽度 `172px / 1fr / 300px`** —— `SandboxConsole.module.css:166`。
12. **宿主 `SandboxView.tsx` 的三个 rail 区** —— `:469 readiness` / `:566 compare` / `:585 commander`，`<SandboxConsole` 在 `:593`。
13. **`CHAIN_NODE_REGISTRY` 24 条静态节点** —— `chain-sim.ts:185–213`，逐行数（按 stage：3/3/7/8/3）。
14. **`CHAIN_STAGES` 正好 5 段** —— `chain-sim.ts:61`，实读枚举。
15. **「设计目标 vs 后端注册表」的差额今天是 0** —— `sandboxConsole.ts:392` 设计目标 `{stageCount:5,nodeCount:24}`，与 `CHAIN_STAGES.length===5`、`CHAIN_NODE_REGISTRY.length===24` 相减，`chainStageCoverage()` `:424–425` ⇒ `missingStageCount=0`、`missingNodeCount=0`。**这条推翻了我自己初稿里「后端 4 段 12 节点」的写法**（见 §8.4 第 7 条）。

### 8.2 我**从原型推的**（不是代码事实，是设计意图）

1. **三层 IA（L0 结论 / L1 抽屉 / L2 开关）** —— 从原型的形态推：原型把 KPI 压成一行 `.verdict`、把明细放进右抽屉 `.dw`、把 Pareto 压成 30px 迷你条。这是**我对该形态的归纳**，原型里没有写「三层」这个词。
2. **「站半径 ∝ 损失、颜色 ∝ 异常类」的双通道编码** —— 取自原型图例（`sandbox-metro-ops.html:206`：「站点大小 ∝ 吃掉的全链损失」）。
3. **抽屉不遮挡异常站（画布收缩而非浮层覆盖）** —— 取自原型 `.mapwrap{inset:0 var(--rw) 30px 0}` 的做法。
4. **「⚠ 证据 · 部分判定」徽标必须常驻** —— 取自仓主写在原型注里的那句「折叠的是位置，不是可见性」。
5. **扰动面板的两栏分法（真重算 / 算不出来）** —— 这是**我的设计**，原型是五个数一起变。

### 8.3 **未验证的假设**（复验方请重点打这里）

1. ~~「五条线 = 5 个 stage」是否够用 / `CHAIN_STAGES` 到底几段~~ —— **已在本单内自查掉，见 §8.1 第 14–15 条**（5 段 / 24 节点 / 差额 0）。**留下的真问题换成了**：24 个在册节点里，本次载荷实际**有数据**的是几个？我只知道形态三分（`withSteps`/`emptyOnly`/`absent`）与 `capacity.maint` 是那个 `absent`，**没有真跑取到计数**。中央图的「站」到底画几个，取决于这个数——S1 立单前须真跑一次 `chain_loss_attribution` 数出来。
2. **原型的 24 站与注册表的 24 节点是不是同一批**。两个 24 相等（§2.2），且 `sandboxConsole.ts:392` 的设计目标就写着 `nodeCount: 24` —— 但**我没有逐个比对过集合**。原型站名是「分切 / 涂布 / 辊压」这类**工序**，在契约里属于 `capacity.op.*` **动态**命名空间，不是那 24 个静态节点。⇒ **数目相等很可能是巧合或同源设计稿，不代表可以一一对应**。谁按「反正都是 24」去做映射，就是 `G-CHAIN-NODEID-FREESTRING` 的原样复发。
3. **`generic_inference mode:"levers"` 用 `locus.objectType/objectId` 当 `scopeObjectIds` 到底返不返回杠杆**。我只读了 props 形状匹配，**没有真调过**。若返回空集，§4.4 的整个扰动面板要退回「本站无杠杆」诚实态——M8 断言 2 就是为了当场逼出这个事实。
4. **§3.2 那条 join 在 seed 42 上的实际覆盖率**。`Line ←lineId— WorkOrder` 到底能覆盖多少条产线？孤儿型号有几个？我只知道**孤儿存在**（引自本体 §8 已有实测），**没有自己数过**。S2 立单前须实测并把 `unjoinable[]` 的预期规模写进工单。
5. **M3 「真浏览器画布宽 ≥ 75%」这个阈值**。0.75 是我拍的，没有依据。S1 应先量一次实际值再定阈，否则这条门要么恒绿要么恒红。
6. **原型的异常态标记与引擎实测数对不上**。我数了原型 `ST` 表：**24 站**（不是工单说的 25），其中标了异常的 12 站 = 卡点 2 + 堵点 5 + 断点 5；但原型顶栏徽标写的是 **2 / 6 / 7 = 15**。⇒ **原型的徽标数与它自己的站表不一致**。15 这个数与控制台实测的「本次扫描 15 条」吻合，说明徽标取的是真扫描数、站上的标记是手绘的。**我没有验证哪 15 条阻滞点分别落在哪些站上**——事实上 §2.4 已经证明今天**根本落不到站上**（locus↔nodeId 无 join）。
7. **「现金周期」是否在别处另有实现**。我只查了 `solvers/` 目录下的 `aggregates.ts`。若某个我没读到的求解器内部含 CCC 逻辑，§4.3 那一行要按事实修正。**我的 grep 覆盖的是 `apps/datacore/src/solvers/*.ts`，不是全仓。**
8. **本 PRD 没有真跑过沙盘页**（`sim.sandbox` 是暗发，默认关，`App.tsx:111` entitlement 关 → 404）。所有关于「屏上长什么样」的判断都是**读 JSX 推的**。这与既有 `docs/PRD-sandbox-redesign.md:429` 的诚实边界同款——S1 立单前应先真开一次、亲手点一遍，与本文不符**以真跑为准并回改本文**。

### 8.4 我在过程中发现的「与工单描述不符」之处

1. **工单说锚点是 `service.ts:3125`，实际 `if` 在 `:3129`**（`:3124–3125` 是那段注释的两行）。结论不变。
2. **工单说原型是「5 条线 25 站」，实测 24 站**（脚本解析 `ST` 表：L1=4 / L2=7 / L3=8 / L4=2 / L5=3）。换乘站 4 个（`rev`/`kit`/`pack`/`acc`），与工单一致。
3. **原型顶栏徽标 2/6/7=15 与它自己站表的 2/5/5=12 不一致**（见 §8.3 第 6 条）。
4. **我的 worktree 初始 HEAD 是 `778cc589`（OntoFlow P3），该 commit 上 `docs/SYSTEM-ONTOLOGY.md`、`docs/PRD-sandbox-redesign.md`、`apps/frontend-shell/src/views/sim/SandboxConsole.tsx` 三个文件全部不存在。** 我按金丝雀纪律先用 `git rev-parse --verify -q HEAD:CLAUDE.md` 自证工具没坏（命中），再确认三个目标路径确实 ABSENT，然后从 canonical `claude/inspiring-gates-aqczjg`（`904c7b96`）重开分支。**若不做这一步，本单会得出「这些文件都不存在」的相反结论** —— 正是 `铁律 0.6` 表里第 3 行那个形态（「扫的是停在旧分支的工作目录」）。
5. **工单把「产品线筛选」称作「拦路石」，措辞会让人低估也会让人高估。** 精确说法是：那道 400 **是对的、不许拆**；真缺口是一条 `Line→WorkOrder→Model` 的 join 边（型号维 1 跳可做，产品线维 2 跳 M:N 要先定语义）。**既不是「加个下拉」，也不是「造引擎」。**
6. **我自己犯了一次，当场记账（`铁律 0.6` 第 1 次 = 修 + 记账）。** 初稿 §2.1/§2.2 我写「`CHAIN_STAGES` 今天 4 段、后端 12 节点」——**错的**。真值是 **5 段 / 24 节点，且与设计目标的差额已归零**（`chain-sim.ts:61`、`sandboxConsole.ts:392,424–425`）。
   **错因写成标准句式**：**「我把 `SandboxConsole.tsx:630` 那段横幅**模板文本里的示例数字**当作**该横幅运行时的实测值**，而模板并不度量运行值。」**
   —— 与 `铁律 0.6` 表里那 5 次**同构**（拿一个看起来相关的数字当判据，没验证它度量的是不是我要度量的东西）。
   **这也正是本 PRD §1.1 把该横幅列为「降级时必须改文案」的原因**：一句会骗人的话，折进抽屉里照样骗人。
7. **工单说「§4 换算必须可溯源，不许写死系数」——方向完全正确，但它低估了已有资产。** `DynamicLeverPanel` 已经把「本体派生旋钮 + 真重算 + Provenance」整条做完了（闭 `G-WHATIF-HARDCODED-LEVERS`）。真正的缺口不在「换算」，在**目标指标**：五个财务指标里只有前置期/流动效率有真值源，现金周期已被引擎显式判 EMPTY。

---

## 附录 · 本 PRD 用到的金丝雀证据（否定结论的举证）

按 `铁律 0.6` 已落地机制：**报「零命中 / 不存在 / 零调用方」时必须同时给出金丝雀的命中证据。**

| # | 否定结论 | 用的命令 | 金丝雀（同命令必中的样例） | 结果 |
|---|---|---|---|---|
| 1 | `chain-impediment.ts` 不写 `nodeId` | `grep -n 'nodeId' packages/contracts/src/chain-sim.ts apps/datacore/src/solvers/chain-impediment.ts` | `chain-sim.ts` 同命令命中 40+ 行（含 `:615`） | 工具正常；`chain-impediment.ts` 零命中 ⇒ 结论成立 |
| 2 | `ChainImpediment` 只有一个生产者 | `grep -rn "impedimentId:" apps/datacore/src` | 该命令有 1 处命中（`chain-impediment.ts:625`），非 0 ⇒ 工具正常 | 唯一生产者 |
| 3 | `Line`/`Process` 无 model 字段 | `grep -n 'lineId:\|model:' apps/datacore/src/synthetic/battery.ts` | 同命令在 `:1687 WorkOrder` 上命中 `modelId` ⇒ 工具能匹到 model 类字段 | `Line`(`:1673`)/`Process`(`:1675`) 的字段列表里确无 |
| 4 | `SandboxConsole.tsx` 的 testid 计数 | python 脚本 `re.findall(r'data-testid="(sc-[\w-]+)"')` | 断言 `'sc-topbar' in s` 通过后才取数 | 62 |
| 5 | 三个目标文件在 `778cc589` 上不存在 | `git rev-parse --verify -q <rev>:<path>` | `HEAD:CLAUDE.md` 命中（返回 blob sha） | 三路径 ABSENT ⇒ 换基线 |

> **注**：`git grep -- "apps/*/src"` 这类 pathspec **一律未使用**（`铁律 0.6` 表第 1 行：其中的 `*` 不跨 `/`，恒 0 命中）。
> 本文所有跨目录搜索一律用 `grep -rn <目录> <目录>` 的形式。
