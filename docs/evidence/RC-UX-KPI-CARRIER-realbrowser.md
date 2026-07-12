# WO-RC-UX-KPI-CARRIER · 真浏览器证据（2026-07-12 · dev3）

治「推了没反应·死的」错觉（审核一手证据 VERIFIED§1③）：tick 后主视觉 DAG 真变（Σ0→Σ358620），但 KPI 磁贴恒 0.0——
根因 `carrierMean` 只认**初始快照载体**，传导目标（Base.loadIndex/Model.demandLoad）初始无载体 → 磁贴恒 0。

## 修复（KILL-MOCK-RED·取真 post-tick 态·非补 0）
`carrierMean` 携带者集 = 初始快照载体 **∪ tick 后 world 有非零真值的对象**——传导目标 tick 后被引擎写入真值即纳入均值；
未触及对象（world 恒 0/缺）排除 → 不复稀释（守 WO-CAP-03）。

## 真浏览器逐值（3/3 全绿·真起双服务+真登录+真推 tick）
```
· tick0 磁贴: 需求负载 0.0 · 负载指数 0.0（传导目标·初始无载体=死的状态）
✅ 推进 3 tick → 需求负载 0.0 → 7.8（真动·磁贴随 DAG 传导）
   截图并见：负载指数 0.0 → 1793101.0（两传导目标磁贴均真动）
✅ 治「推了没反应·死的」——磁贴随 DAG 真动·KILL-MOCK-RED 取真 post-tick 态
```
截图 `RC-UX-KPI-CARRIER-realbrowser.png`：全局态(tick 3·第 3 天) 34.1 · 需求负载 **7.8**（系数未校准）· 负载指数 **1793101.0**（系数未校准）——
均从 tick0 的 0.0 真动；S2 诚信位徽标（系数未校准/来源待披露）+ CAPFORECAST 修复（capacity 行标「合成」）同页共存诚实。

## 配套单测（green→red 锁）
`test/sandbox-kpi-carrier.test.tsx`（3 测）：① 传导目标初始无载体·tick 后 world 非零 → 纳入均值（修前 ids 空→恒 0·红）；
② 不因 tick 后 0 值稀释（WO-CAP-03 守恒·未触及 0 对象不纳入）；③ tick0（world=初始快照）传导目标无值 → 诚实 0（不臆造）。
沙盘测组 31 测零回归。

## 诚实边界
- 纯前端派生（carrierMean·消费 tick 后真 world 态·引擎不动）；磁贴值系数未校准（S2 徽标已标·量级仅供参考）。
- 「负载指数 1793101」是 loadIndex 多顶 clamp 2M 的真 post-tick 态（冷启动系数偏饱和·S2 UNCALIBRATED 诚实标）——非造值，是真传导结果；已校准场景待 RC-2/S6。
