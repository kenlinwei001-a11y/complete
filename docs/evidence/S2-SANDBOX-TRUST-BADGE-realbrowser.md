# S2 · WO-SANDBOX-TRUST-BADGE（前端半·方案A）· 真浏览器证据（2026-07-11 · dev3）

沙盘每个数字绑诚信位徽标——补沙盘唯一缺的数据血缘披露面（G-DM-1 沙盘侧），让用户"敢信"。
真起双服务（datacore:4001 SEED_DEMO=1 + agentcore:4002）+ 真 chromium（chromium-1194）+ 真 vite dev（`.env.local` 指真后端·
同站 localhost 使 httpOnly refresh cookie 跨硬导航存活）+ 真 admin 登录（真 JWT）→ 真沙盘渲染器 → **逐枚徽标逐值对照后端**
`propagation-rules.coefficientRef` / `view-config.nodeObjectMode` 派生真值。**非 jsdom·非机制冒充**（铁律 0.4）。

## 后端真值（逐值对照 source of truth · 从活服务实拉派生）
```
· propagation-rules：3 条·全 coefficientRef=null（冷启动未校准）→ uncalSet={loadIndex, demandLoad}
· view-config.stateVars=[demandDelta, demandLoad, loadIndex, totalDemand, utilization]
· view-config.nodeObjectMode=undefined（对象 origin 血缘·Dev-1 域未补 → 非未校准变量退 UNKNOWN）
· 派生期望：overall=UNCALIBRATED · {demandDelta:UNKNOWN, demandLoad:UNCALIBRATED,
             loadIndex:UNCALIBRATED, totalDemand:UNKNOWN, utilization:UNKNOWN}
```
判据（`SimDataModeBadge` 纯派生·R6）：后端 `nodeObjectMode[oid][v]` 优先 > `coefficientRef` 空→UNCALIBRATED > UNKNOWN；
汇总取最不可信档（RANK `LIVE<UNKNOWN<UNCALIBRATED<SYNTHETIC<STALE`）。

## 真浏览器逐值断言（13/13 全绿）
```
✅ 真后端登录成功 → http://localhost:5173/
✅ 真浏览器渲染出沙盘 KPI 区（sandbox-kpis）
✅ 顶部汇总诚信位真渲染·data-sim-datamode=UNCALIBRATED == 后端派生 overall=UNCALIBRATED（逐值一致）
✅ 汇总位人话摘要真渲染：「本次推演：传导系数未校准（冷启动默认）——方向可参考，量级仅供参考。」
✅ 全局态 KPI 徽标 data-sim-datamode=UNCALIBRATED == overall（逐值一致）
✅ stateVar「demandDelta」KPI 徽标 UNKNOWN == 后端派生（源变量·非 target·无 origin → 来源待披露）
✅ stateVar「demandLoad」KPI 徽标 UNCALIBRATED == 后端派生（coefficientRef 空 target·真判据）
✅ stateVar「loadIndex」KPI 徽标 UNCALIBRATED == 后端派生（coefficientRef 空 target·真判据）
✅ stateVar「totalDemand」KPI 徽标 UNKNOWN == 后端派生
✅ stateVar「utilization」KPI 徽标 UNKNOWN == 后端派生
✅ §5.1/5.2 全部 stateVar KPI 诚信位逐值==后端 coefficientRef 派生
✅ 诚实边界：后端未提供 origin 血缘（nodeObjectMode 空）→ 零枚假标 LIVE/SYNTHETIC（KILL-MOCK-RED·绝不冒充实测）
```

截图 `S2-sandbox-trust-badge-realbrowser.png`：
- 顶部 amber「系数未校准」+ 摘要「本次推演：传导系数未校准（冷启动默认）——方向可参考，量级仅供参考。」
- 全局态 `47.3`「系数未校准」· demandDelta `0.3`「来源待披露」· 需求负载 `0.0`「系数未校准」· 负载指数 `0.0`「系数未校准」·
  totalDemand `1600000.0`「来源待披露」· 利用率 `94.3`「来源待披露」——**每枚徽标与后端派生真值逐值一致**。

## 回退演练（§5.6·feature sim.trust_badge 关）· 单测已覆盖
`test/sandbox-trust-badge.test.tsx` 集成用例：feature 关 → `sandbox-trust-summary`/`sandbox-kpi-*-datamode` 全部
`queryByTestId===null`、沙盘 KPI 主体照常渲染（页面 100% 原样）；契约字段 `dataMode?`/`cellDataMode?`/`nodeObjectMode?`
全 optional → 旧 SimTickState/SandboxViewConfig 反序列化零破坏。真浏览器 feature 开态见上（demo battery 模板 all-on 自动开）。

## 诚实边界（钉死·KILL-MOCK-RED）
- **UNCALIBRATED = 前端能独立真派生的一档**（`propRules.coefficientRef` 空·非造）——本单已完整交付。
- **SYNTHETIC/LIVE/STALE 需对象 origin/dataHealth 真判据 → 后端 `view-config.nodeObjectMode` 提供才升档**（datacore·Dev-1 域）。
  当前后端未补 → 非未校准变量诚实退 **UNKNOWN「来源待披露」**，**绝不假标 LIVE**（真浏览器实证零枚 LIVE/SYNTHETIC）。
  Dev-1 补 `nodeObjectMode` 后前端零改自动升档（`cellDataMode` 后端位优先）。

## 配套单测/门
- 前端 `test/sandbox-trust-badge.test.tsx`（9 测·全绿）：派生纯函数逐档 + 徽标渲染 + 集成开/关回退演练。
- 门 `genuine-sim:check §④.b`（新增·green→red 有牙实测·植假即红还原即绿）：断言 SandboxView 消费
  SimDataModeBadge/overallDataMode + SimDataModeBadge 由 coefficientRef 真派生 UNCALIBRATED + 无真源退 UNKNOWN。
- 全量前端 174 文件 / 569 测零回归。
