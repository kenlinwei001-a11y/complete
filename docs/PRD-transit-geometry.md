# PRD · 在途图层几何与线路图站点对齐（WO-TRANSIT-GEOMETRY）

> 范围：`/v/transit-flow` 与「推演沙盘控制台 → 线路图模式 → 在途批次图层」共用的
> `TransitFlowLayer` **内部几何**，以及它的坐标来源 `chainLineMap.ts`。
> 本文只写**判据与边界**；几何常量与实现的唯一出处是
> `apps/frontend-shell/src/views/sim/chainLineMap.ts` §5.1/§5.2，本文不复述以免漂移。

---

## 1 · 欠账原文与它到底是什么问题

WO-SANDBOX-METRO-SEMANTICS 交付时写下：

> 在途批次 = 线路图上的图层 —— ◐ 做成图层开关（`sc-transit-toggle`），
> 但**几何未与线路图站点坐标对齐**——屏上明写。

这不是"两块样式不统一"。线路图是**椭圆环**（`RING_LAYOUT`），
而在途图层自绘一套**直线**几何：一条 26px 高的横轨 + `left: p%` 的绝对定位方块。
两者**没有共同坐标系** ⇒ 同一个基地在两张图上不是同一个点，
用户没法把「这批货现在在哪」与「这条链堵在哪」放在一起读 —— 图层的信息价值被几何吃掉了。

---

## 2 · 坐标单源：`chainLineMap.ts` §5.2

新增一节**纯数据**出口（零 JSX、零 React），由线路图与在途层**共用**：

| 导出 | 作用 |
|---|---|
| `ringStationAnchors(nodeIds, k?)` | 一组不透明 key → 环上锚点（`ringAngle` 均分 + `ringPoint`，与 `buildChainLineMap` 主干站位同一条规则） |
| `forwardAngle(a0, a1)` | 顺行（顺时针）规范化，与 `ringArcPath` 的 `sweep=1` 同向；自环 ⇒ 整圈而不是长度 0 |
| `ringSegmentArc(from, to, id?)` | 两锚点之间的顺行弧（`path` 走 `ringArcPath`，`lengthPx` 走下面的弧长积分） |
| `ringArcLength(a0, a1, k)` | 椭圆弧长（复合 Simpson，`RING_ARC_SAMPLES=128`） |
| `ringArcPointAt(a0, a1, k, t)` | ★ **弧长参数化**：`t` = 走完的弧长比例 → 环上那一点（二分反解，`RING_ARC_BISECTIONS=40`） |
| `ringTangent(angle, k)` | 单位切向（图元朝向） |
| `radialOffsetFrom(x, y, angle, d)` / `ringRadialOffsetPoint(angle, k, d)` | 沿半径离开环（正=环外 / 负=环内）。**「离开环」的唯一实现** |

`ChainLineMapView.labelAnchor` 也改走 `radialOffsetFrom` ——
这条导出因此**不是只给在途层用的**，两个消费方共用一份实现。

**门**：`transit-geometry.seam.test.tsx` §5 有一条源码级判据 ——
在途层源码里不许出现 `RING_LAYOUT.(cx|cy|rx|ry)` 参与算术，
即不许再长出第二份「极坐标 → 画布坐标」推导。

### 2.1 为什么必须是弧长参数，不是弦、也不是角度

| 画法 | 4 站整圈均分、`t=0.5` 时的实测 | 判决 |
|---|---|---|
| **弦的线性插值** | 离弧上真点 **85.3px**，椭圆残差 **0.707**（明显在环内）；**2 站时弦中点恰好是环心** | 拒绝：车从环心穿过去 |
| **角度的线性插值** | 落点仍在环上，但离弧长参数点 **29.8px**；等时步的角度步长最大/最小比 **1.209** | 拒绝：时间均匀而路程忽快忽慢 |
| **弧长参数（本单实现）** | 椭圆残差 1.000000000000；等时步 ⇒ 等弧长步（三段皆 123.657542px） | 采用 |

椭圆弧长无初等闭式（第二类椭圆积分），故用数值积分 + 二分反解。
**公开容差 `RING_ARC_TOLERANCE_PX = 0.01px`**（实测残差 ~1e-10px，留三个数量级余量）；
门直接引用该常数，测试里不另写一个数。

`progress` 是**时间比例**（`(day − dispatchDay) / (etaDay − dispatchDay)`），
所以它必须映到**路程比例**——这就是"弧长参数"在业务上的理由，不是数学洁癖。

---

## 3 · 三类批次 = 三种图元（形状分家，不是颜色深浅）

时序可算性三级判据（`TRANSIT_SOURCE_SPECS`，一个字未动）**几何化**为：

| 档 | 位置精度 | 图元 | 落点 | `data-glyph` / `data-glyph-shape` |
|---|---|---|---|---|
| `InterBaseTransfer` | 区间位置**可算** | **三角形车头**（朝顺行切向） | 沿区间弧、按弧长参数 | `transit-car` / `triangle` |
| `Shipment` | 位置**算不出来** | **菱形到站徽标** + 倒计时 | 站上、沿半径**朝环外** 26px | `arrival-badge` / `diamond` |
| `WIPLot` | 位置**算不出来** | **横条堆叠** | 站上、沿半径**朝环内** 22px | `resident-stack` / `bar-stack` |

后两类的锚点**在几何上不可能落在弧上**（离环 ≥12px 是门的判据，实测 ≈22–26px）。
于是「不画一辆匀速前进的车」不再靠自觉 —— **画法本身做不到**。
这是本单相对上一单的实质推进：判据从"文案 + 约定"变成"几何不可达"。

形状必须不同而不是深浅不同：深浅会被读成「同一种东西弱一点」，
而这三档是三种**位置精度**，不是三档强弱（与上一单处理闭环段的纪律同源）。

---

## 4 · 诚实边界：**几何同源 ≠ 实体对齐**（本单没做到的那一半）

- 线路图的站 = 引擎 `chain_loss_attribution` 的**链路节点**（`ChainStep.nodeId`）；
- 在途层的站 = 批次数据行自带的**基地 / 工序 key**（`fromBase`/`toBase`/`baseId`/`currentProcess`）。

两套 key **今天没有共同的 id 维度**（与 `PRD-sandbox-metro-semantics.md` §5 记的
"两个求解器 locus 对不上"同族）。所以本单交付的是：
**同一个椭圆、同一条 `ringAngle` 均分规则、同一个 `ringArcPath` 弧生成器、同一套弧长参数**，
**不是**"同一个 key 在两张图上落到同一个角度"。

界面上常驻两处原文（`transit-geometry-source` / `transit-flow-host-nodes`），
门 `transit-geometry.seam §4` 与 `sandbox-console.seam §6` 各咬一次，
**不许因为"看起来对齐了"把这句删掉**。

补齐路径：引擎给在途层下发 `nodes[]`（图层 `nodes` prop 已就位、`resolveStations` 已支持），
或给两个求解器一个共同的 id 维度。二者任一到位，本层代码不用改就真对齐。

### 4.1 顺带修掉的一个真缺口：`resolveStations` 补并集

此前「引擎给了 `nodes[]` ⇒ 站点集合 = 引擎的」，于是一条 `A→B` 的调拨里
若引擎没登记 A，A 就从站点集合里消失 —— 落到环上就成了「车从一个不存在的点出发」。
现在改为**并集**：引擎站排前（`origin:"engine"`），数据行里出现而引擎没列的排后
（`origin:"data-row"`、字典序、**永远没有 `cadence`**）。
「哪个站是限流站只认引擎」这条红线原样成立。

---

## 5 · 门禁

新增 `apps/frontend-shell/test/transit-geometry.seam.test.tsx`（17 例）：

- §1 车的屏上坐标 = `ringArcPointAt` 逐字节；椭圆残差 == 1；弧长比例 == `progress`（≤ `RING_ARC_TOLERANCE_PX`）；**不是弦**；**等时步 = 等弧长步且角度步不等**。
- §2 `Shipment` / `WIPLot` 的图元到每条弧的最近距离 > 12px、不在环上、`progress`/`segmentId` 皆空、不存在 `transit-car-*`；到站徽标在环外、驻留堆叠在环内。
- §3 三类 `data-glyph` / `data-glyph-shape` 三值互异 + 底层图形结构不同（3 顶点 / 4 顶点 / `rect`）。
- §4 三档 `modeReason` 逐字等于 `transitFlow.ts` 单源；节拍 / 采购两条 `EMPTY` 原样在；「同一个环 ≠ 同一套站」在屏上。
- §5 源码级坐标单源；区间两端必须都有站；R6 两次渲染逐字节一致。

**变异反证**（每条都真跑过、真红过、`git checkout --` 撤回后树干净）：

| 变异 | 红在哪 |
|---|---|
| 给 `Shipment` 编起运地 + 发运日（`mode:"interpolated"`） | `metro-semantics.seam`「不该被补一个发运日」+ `transit-flow.seam`「expected 'interpolated' to be 'arrival-only'」+ 本门 §2 全组（`transit-arrival-*` 消失）＝ **9 例红** |
| `ringArcPointAt` 换成弦的线性插值 | 本门 5 例红（含「车不在环上（残差 0.707）」、2 站时残差 0 = 环心） |
| `ringArcPointAt` 换成角度线性插值 | 本门 2 例红（「走过弧长 277.13 ≠ 半程 247.32」「等时步没走出等弧长步」）；"落在椭圆上"仍绿 —— 正是这条门必须验弧长而不只验"在不在环上"的原因 |
| 到站徽标改用三角形 | 本门 §3 红（「到站徽标不是菱形: expected 3 to be 4」） |

既有门 `transit-flow.seam`(37) / `metro-semantics.seam`(17) / `chain-line-map.seam`(33) /
`sandbox-console.seam`(22) / `transit-flow-reachable`(5) 全绿，
其中 `metro-semantics.seam:322` 那条「只有 `etaDay` ⇒ `progress===null` 且 `segmentId===null`」
**一个字未改弱**。

`sandbox-console.seam:483` 原本咬的是欠账原文「未与线路图站点坐标对齐」——
该欠账已还，故**改口径不改强度**：改咬还账后剩下的半句真话（几何同源 + 同角度不代表同一个实体）。

---

## 6 · 本体引用与影响

- **对象类型**：`InterBaseTransfer` / `Shipment` / `WIPLot`（在途三源，只读，字段口径未动）；
  `Cadence`（仍只有契约无承载 ⇒ `EMPTY` 原样）；`ChainNode` / `ChainStep`（线路图侧，未改）。
- **链路**：`ViewPage → registry("sim-sandbox") → SandboxView → SandboxConsole → 线路图模式`
  ⊕ `sc-transit-toggle → TransitFlowView(chrome="embedded") → TransitFlowLayer`
  → 自取 `GET /a/v1/objects?type=InterBaseTransfer|Shipment|WIPLot`；
  独立页 `ViewPage → registry("transit-flow")` 同一组件。
  **本单新增的是"几何依赖边"**：`TransitFlowLayer → chainLineMap.ts §5.2`（纯函数，无取数）。
- **事件**：无新增、无订阅变更。
- **不变量**：
  - **R1** 跨包只依赖 `@platform/contracts`（本单未新增跨包依赖）；
  - **R6** 几何全为纯函数、全序、无时钟无随机；两次渲染 DOM 逐字节一致（门 §5）；
  - **R13** 三档 `modeReason` 逐字透传；「几何同源 ≠ 实体对齐」原文常驻；
  - **R14** 零硬编码色值（新图元全走 `tokens.css`，`transit-flow.seam` 的三色系门覆盖）；
  - 前端零清单：`nodeId` 仍是不透明 key，几何只拿它当「排第几个 / Map 键」。
- **门禁**：新增 `transit-geometry.seam`（17 例）；既有五道门全绿。
- **断点**：
  - **仍在**（本单不解决、已在 §4 明写）：线路图与在途层**没有共同的 id 维度** ⇒
    同角度不代表同一个站。补齐 = 引擎给在途层下发 `nodes[]`。
  - **本单未做**：图层与线路图**没有叠在同一块画布上**（控制台把两者渲染成上下两个兄弟节点，
    改挂载点要动 `SandboxConsole.tsx`，在本单边界外）。今天做到的是
    「两张图坐标系相同、viewBox 相同」——叠加时坐标即刻对得上，无需再改几何。
