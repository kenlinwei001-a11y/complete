# FDE 证据 · CAPACITY-BASECARDS-REALDATA（P1 回归·产能推演每基地卡消失）

用户亲报+亲定（2026-07-06）：产能推演（`/v/risk` = RiskBoardView）**每基地卡没了**。要求真实后端数据 / 前端可见 / 不写死；无真源→actionable 诚实空态（非静默跳过、非 hash 假红）。

## 根因（实测核实·非猜测）

KILL-MOCK-RED 去假后 `risk_timeline` 自动扫描口径 3 处叠加把每基地真瓶颈全排除：
1. 排除主因子（`if (f === primary) continue`）；
2. **跳过越线因子**（`if (ltv >= threshold) continue`）——每基地真瓶颈「瓶颈工序」（真 `util:line` 时序聚合 `Line.utilization` ~90 ≥ 阈值 85）恰被此句剔除；
3. 非越线因子 `crossDay===null` 又 `continue` 丢卡。

结果自动扫描 **0 卡**。**关键澄清**：设备时序**并非缺失**——`SEED_DEMO` 经 `generateHistory`（`oee:equip/yield:process/util:line`）+ `BATTERY_TS_AGG_SPECS` 走正门物化到 `Equipment.oee_current / Process.yield_baseline / Line.utilization`，`liveTightness` 对 12 基地全返真值（`bottleneck_matrix` LIVE 实测：瓶颈工序 89-92 / 设备OEE 82-87 / 良率 61-67）。根因在**卡选择口径**，非无真源。

## 修复（治本）

`risk.ts riskTimeline` 自动扫描改**每基地一卡**：每基地取**真张力最高的有真源因子**为代表 → LIVE 真值卡（可越线可不越线·如实显真张力，值由真 `oee_current/utilization/yield_baseline` 派生·**非 hash·非写死**）；某基地**任何因子皆无真源** → actionable 诚实空态卡（`hasData=false`·`noDataReason`·`deeplink→/admin/connections`）·**非静默跳过、非假红**。契约 `RiskCardSchema += deeplink{to,label}`（additive）；前端 `RiskBoardView` 空态卡渲染 CTA 深链（`stopPropagation`）。

## C1 · 真起后端 curl 逐值（内存 SEED_DEMO=1·seed42·端口 4011）

`POST /a/v1/solvers/risk_timeline/invoke {"args":{}}`（自动扫描）：

```
dataMode: SYNTHETIC(顶层·demo 合成对象)  threshold: 85  cards: 8  planRows: 17
信阳 | 瓶颈工序 | LIVE | hasData true | 实测当前 90 | peak 97 | crossDay 1
厦门 | 瓶颈工序 | LIVE | hasData true | 实测当前 90 | peak 95 | crossDay 1
合肥 | 瓶颈工序 | LIVE | hasData true | 实测当前 91 | peak 98 | crossDay 1
常州 | 瓶颈工序 | LIVE | hasData true | 实测当前 92 | peak 98 | crossDay 1
成都 | 瓶颈工序 | LIVE | hasData true | 实测当前 92 | peak 98 | crossDay 1
枣庄 | 瓶颈工序 | LIVE | hasData true | 实测当前 90 | peak 95 | crossDay 1
武汉 | 瓶颈工序 | LIVE | hasData true | 实测当前 92 | peak 96 | crossDay 1
江门 | 瓶颈工序 | LIVE | hasData true | 实测当前 91 | peak 91 | crossDay 1
```

- 每卡 `dataMode=LIVE·hasData=true·currentTightness.live=true·value 非 null`（真 `util:line` 时序派生·**非 hash**）。
- 卡附 `demandGap{gapWan,source:"DemandSegment(p50/p90)+SopVersionRow.demand−产能"}`（R13 可溯）。
- `planRows: 17`（处置计划表恢复，如「工艺路线调整（信阳·备份方案）· 基地负责人 · 王经理 · C05」）。
- **R6 确定性**：连续两次 invoke 字节一致（信阳 cur90/peak97/seriesHead[90,90,90,90,90] 两轮同）。

## C2 · 真浏览器逐值对照后端（Playwright chromium·真起 preview 前端 + 真 datacore 4011·登录 demo/admin/demo1234）

截图 `docs/evidence/CAPACITY-BASECARDS-REALDATA-risk.png`。真登录 → `/v/risk` → DOM 提取 8 张 `risk-card-*`：

| 基地 | 前端「实测当前」| 前端峰值 | 前端越线日 | 后端 curl | 对账 |
|---|---|---|---|---|
| 信阳 | 90 | 97 | D+1 | cur90/peak97 | ✅ |
| 厦门 | 90 | 95 | D+1 | cur90/peak95 | ✅ |
| 合肥 | 91 | 98 | D+1 | cur91/peak98 | ✅（首要风险标） |
| 常州 | 92 | 98 | D+1 | cur92/peak98 | ✅（首要风险标） |
| 成都 | 92 | 98 | D+1 | cur92/peak98 | ✅（首要风险标） |
| 枣庄 | 90 | 95 | D+1 | cur90/peak95 | ✅ |
| 武汉 | 92 | 96 | D+1 | cur92/peak96 | ✅ |
| 江门 | 91 | 91 | D+1 | cur91/peak91 | ✅ |

前端所见每值 === 后端真值（真值搬运·非前端写死）。红色 heat strip + 越线日 + 首要风险标恢复；顶层置信度横幅标「合成数据（非真实接入）」（demo 对象合成·诚实位），逐卡仍出真红（WO-RISK-FIX bug① 逐卡门·真数据出真红）。控制台 `ERR_CONNECTION_REFUSED` 仅指 agentcore(4012 未起)·与风险看板无关。

## C3 · 齿（真值驱动·非写死·revert 即红）

后端单测 `apps/datacore/test/capacity-basecards-realdata.test.ts`（3 齿·手构 SolverContext + `BATTERY_SOLVER_PARAMS`）：
- 齿①：设备 `oee_current=0.7` → 每基地一 LIVE 卡·`currentTightness.value = round(oeeBase+(1−0.7)×oeeK) = 96`（**来自真源公式·非常数**）·peak96·crossDay1。
- 齿②：改 `oee_current 0.7→0.85` → 卡值 `96→63`（**改真源即改值·证非写死**）；高 OEE 低张力 63<85 仍如实出卡（每基地一卡·非"非越线即丢卡"）。
- 齿③：**无任何真源**（revert 时序种子·空设备/产线/工序/需求）→ `cards.length===1`（基地未被静默丢弃）·`hasData=false`·`value/peak/crossDay` 全 null（不伪造）·`noDataReason` + `deeplink.to==="/admin/connections"`。

前端单测 `apps/frontend-shell/test/risk-basecards-realdata.test.tsx`（jsdom renderApp+MSW 回放真值）：
- 每 LIVE 卡「实测当前 N」+ 峰值逐值 === MSW 真值（改后端值→前端随之变）。
- 无源基地：`risk-nodata-*` + `risk-nodata-cta-*` href=`/admin/connections`·卡内 0 处 danger 红。

**revert 即红**：把自动扫描改回旧口径（排除主因子/跳越线/非越线丢卡）→ 齿①③ 0 卡红；把空态改回静默跳过 → 齿③ `cards.length===0` 红；`liveTightness` 若回 hash 伪值 → 齿③ 期望 `hasData=false` 红。

## C4 · KILL-MOCK-RED 不回退

- `node scripts/check-genuine-sim.mjs` → **EXIT=0**（推演 schema 带 dataMode·liveTightness 无源不伪造·前端消费诚实位·未重引 hash 假红）。
- `node scripts/check-no-silent-mock.mjs` → **EXIT=0**（48 求解器输出带 dataMode 诚实位）。
- 语义：无真源基地**新增诚实空态卡**（`hasData=false`），与 G-DM-1「无真源不上决策红」同向加强（非削弱）。

## 边界与诚实注

- **每基地一卡代表因子 = 真张力最高者**（demo 全 12 基地即「瓶颈工序」·真 util 时序 ~90 为各基地真实头号瓶颈）。此为**真数据的诚实结论**（利用率是全网头号约束），非人为统一；各基地全 7 因子细分在卡详情 `BottleneckDetailPanel`（bottleneck_matrix LIVE）逐项可见。
- 契约 `RiskCardSchema.cards.max(8)` 未改 → 12 基地按越线日/名排序取前 8 展示（与既有 `maxCards=8` 一致·非本单回归项）。
- demo 全基地皆有真源 → **诚实空态卡在 demo 不出现**（属正常·demo 数据完整）；空态路径由后端/前端单测（无源 context/MSW）覆盖，真实新租户「刚接入未上传实测」时前端可见。
- **未自跑全套 `pnpm gates`（主控收口）**；本单亲跑：datacore+contracts+frontend build 0 err、上述定向 vitest 全绿、genuine-sim/no-silent-mock EXIT=0、ontology-slices --check EXIT=0。
