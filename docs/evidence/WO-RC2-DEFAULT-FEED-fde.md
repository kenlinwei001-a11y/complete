# WO-RC2-DEFAULT-FEED · FDE 真起服务真跑真数据（co-closes WO-CAP-09-SANDBOX-TICK-LIVE）

铁律 0.4：真起 `apps/datacore/dist/server.js`（SEED_DEMO=1）· curl 真跑 · 逐 tick 真数字 · 关闸对照。

## 起服务

```
PORT=4011 JWT_SECRET=dev SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
# 刻意 **不设** SIM_TEMPORAL_GROUNDING —— 证明接地由**会话级 body.grounding** 决定（decouple），
# 而非租户级 feature（demo 的 sim.temporal_grounding 被 battery-all-on 排除·恒关）。
GET /healthz → {"status":"ok"}
租户 demo overrides 无 sim.temporal_grounding 键（= 默认关，certification 读的租户档不动）
```

## 诊断验证（demo 真对象字段·curl /a/v1/objects?type=…）

| 源类型 | 真声明字段 | resolver 需要 | 结论 |
|---|---|---|---|
| PurchaseOrder | `etaDay`(1–20 相对 forecastStart) + `qty` | `arriveTick` + `qty` | **可真映射** etaDay→arriveTick（日粒 sim 时钟 1 tick=1 日）|
| DemandSegment | 聚合 `p50`（无 dailyP50/coverageDays）| dailyP50 + coverageDays | 无真时序 → 诚实 EMPTY_DATA（聚合 p50 铺日曲线=禁止的伪曲线）|
| SopVersionRow | 总 `demand`/`supply`（无 dailyDemand/coverageDays）| dailyDemand + coverageDays | 无真时序 → 诚实 EMPTY_DATA |
| MaintPlan | `week`（可映射 tick）但**无 capacityDelta 幅值** | tick + capacityDelta | 无真幅值 → 诚实 EMPTY_DATA |
| ts_series | demo 90 天历史点 tick=0（无前向真点）| tick+value 真点 | 无前向真点 → 诚实 EMPTY_DATA |

**唯一真源 = PurchaseOrder.etaDay**（其余四源据实缺口·绝不合成）。

## A) 接地会话（body.grounding=true·租户 feature 关）→ 冻结真 PO feed

```
POST /a/v1/sim/sessions
{ "baseSnapshot":{"inv1":{"level":0}},
  "feedSpecs":[{"feedKey":"po_arrivals","target":{"objectType":"Inventory","objectIds":["inv1"],"stateVar":"level"},"source":{"kind":"purchase_order_eta"}}],
  "horizonTicks":30, "grounding":true }
→ feed live=true  coverageTicks=21  series 长度=15
  series(前8): [{t1:1442},{t2:1436},{t5:3293},{t6:1859},{t7:2609},{t9:1069},{t11:1124},{t12:700}]
  逐值可溯真 PO：tick5 delta 3293 = po_1(1055)+po_11(848)+po_22(463)+po_26(927)（真 etaDay=5 的 PO qty 之和）
```

## B) 接地会话 tick ×21 → 目标格 inv1.level 逐 tick 真动（非静止·非零）

| tick | inv1.level | Δ本tick(真 PO qty) |
|---|---|---|
| 2 | 1442 | 1442 |
| 3 | 2878 | 1436 |
| 6 | 6171 | 3293 |
| 7 | 8030 | 1859 |
| 8 | 10639 | 2609 |
| 10 | 11708 | 1069 |
| 12 | 12832 | 1124 |
| 14 | 16015 | 2483 |
| 15 | 18105 | 2090 |
| 20 | 24909 | 3241 |
| 21 | **25269** | 360 |

**开箱推演真动：0 → 25269**（21 tick 累计入库·每 tick 增量=该日真 PO qty 之和·无到货日 Δ=0 诚实静止）。
（注：引擎在 `beforeTick` 注入·显示 tick 有 +1 位移·增量逐值与冻结 series 一一对应。）

## C) 关闸对照（同 feedSpecs·**不传 grounding**·租户 feature 关）→ feeds 空·tick 静止 v1.1

```
POST /a/v1/sim/sessions { …同上 feedSpecs, horizonTicks:30 }   ← 无 grounding 字段
→ frozen feeds = []   feedGaps = (none)
POST …/tick {n:21} → curTick=21  inv1.level=0   ← 静止（v1.1 恒等桩·无 feed 注入）
```

## D) KILL-MOCK-RED 诚实（DemandSegment 仅聚合 p50·grounded）→ EMPTY_DATA·不合成

```
feedSpecs=[{feedKey:"demand", source:{kind:"demand_segment", segmentKeys:["dseg-1"]}}], grounding:true
→ feeds = []
  feedGaps = [{ feedKey:"demand", gapCode:"EMPTY_DATA",
    detail:"需求细分仅有聚合 p50、无逐日预测率(dailyP50)+覆盖天数(coverageDays) 声明 → 无时序·不铺伪日曲线" }]
```

## E) 解耦实证（certification 不受会话接地影响）

```
存在一个 grounded 会话时 GET /a/v1/sim/sessions/{sid}/certification?scope=GLOBAL
→ keys = [canEnterSimulation,computedAt,dims,gaps,l4Checks,level,scope,targetRef,trialTick,worldCompleteness]
  replayValidation = (absent)   l3Validated = (absent)   ← 租户档关·certification 仍 L2·未误加 replay/l3
```

## 结论

- **Gap A（接地默认关）闭**：接地改**按会话 opt-in**（`temporalGroundingOn` OR `body.grounding`），`/tick` 注入会话已冻结 `s.feeds`（不再读租户 feature）→ 与 certification 读的租户档**解耦**；demo 开箱会话真动而不翻租户默认。`sim-certification.test` 恒绿（11/11）+ runtime E 实证。
- **Gap B（字段错配）闭**：`purchase_order_eta` 读真 `etaDay`（恒等映射 arriveTick·日粒时钟）→ demo 真动；其余四源无真时序据实 EMPTY_DATA（不合成）。
- **CAP-09 tick-live 闭**：grounded demo sandbox tick 前进 → 真 KPI/目标格 stateVar 非静止非零轨迹（0→25269），由真 PO 驱动·非兜底 delta。关闸 v1.1 字节一致（R6）。
