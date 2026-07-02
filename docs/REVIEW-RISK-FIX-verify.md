# REVIEW · RISK-FIX 复验闭环（/v/risk crossDay 失真 + order-chain 采纳 CTA 400 + object-types 死按钮）

> 审核方真 curl + 真浏览器（chromium + 真 vite:5200 直连真 datacore:4001 / agentcore:4002·非 mock）逐条闭合。判决 **✅ DONE**（3 bug 全查实·C1-C6 真跑·容器重启后 rebuild 契约·牙齿测 2/2 复锚）。

## 判决：✅ DONE

| # | 断言 | 类型 | 证据 | 判 |
|---|---|---|---|---|
| C1 | risk_timeline 返 crossDay(3~19 非 null)+series 升+dataMode=LIVE | curl | 8 卡全 `dataMode=LIVE hasData=true`·crossDay=3/3/4/5/13/14/18/19·series len30 rising=true·**R6 两跑字节一致**（设备OEE:3/96…人力工时:19/92） | ✅ |
| C2 | /v/risk crossDay 有值卡显真越线日+火柴图真升+徽标与 dataMode 一致 | browser | 8 卡真渲 **D+3/D+3/D+4/D+5/D+13/D+14/D+18/D+19**·未越线数=0·**实测徽标**(实测当前 83/82/67/68…)·8 火柴图·顶徽"实测"·截图 `.rf-risk.png` | ✅ refute bug① |
| C3 | order-chain 采纳→工单 传 versionId→201（非 400） | browser+curl | 清栈真浏览器：ofc-so-select 选 SO-3391→ofc-adopt enabled→点击 **POST /action-drafts 201**·后端证:plan_change+versionId="plan-baseline"→201 / **缺 versionId(submit)→400**（旧 bug 实锤） | ✅ |
| C4 | object-types 看实例→跳 object-360/实例列表（非 no-op） | browser | **35/35 看实例按钮 enabled**·点击出 **24 条 `/o/` 实例链接**·bug③"死按钮"查实 **stale**（dev 未改码·如实记录·审核方独立复核实锤） | ✅ |
| C5 | 前后端一致 | browser | C2 前端 crossDay(3/3/4/5/13/14/18/19) ↔ C1 后端逐值对上·实测徽标值=liveTightness 真张力 | ✅ |
| C6 | gates 绿；自查 KILL-MOCK-RED 抑制是否对 LIVE 过度生效 | gate+unit | 牙齿测 `risk-live-under-synthetic.test.tsx` **2/2**：顶层 SYNTHETIC 下 LIVE 卡(武汉·设备OEE crossDay=4)出 D+4+danger 红+实测（**不被顶层过度抑制**）+ 反证 SYNTHETIC 卡仍 muted（**不回归 DATAMODE-SWEEP**） | ✅ |

## 根因与治法（bug①·命门）
`risk_timeline` 顶层 dataMode 由 `wantLive && anyLive` 算（demo 有真 ts_points → LIVE）。**bug① 根因**：原 `topLive && …` 逐卡门把顶层非 LIVE 时的 LIVE 卡（自报 `dataMode=LIVE`/真 OEE liveTightness）**一并 MUTED** → 真越线卡显"全未越线/火柴图全平/无实测徽标"。**治法**（`cardDecisionMode` 逐卡·RiskBoardView:59-63）：`hasData=false→MUTED · 卡 LIVE→LIVE(真 OEE 出红) · 卡 null→随 topLive(兼容) · 显式 MOCK/SYNTHETIC→MUTED`。承重非作假：liveTightness 无真源返 `{value:null,live:false}`（KILL-MOCK-RED 红线·绝不伪造），R6 确定性。
**bug②**：ofc-adopt plan_change 漏必填 versionId（schema `required:["versionId","reason"]`·submit 时校验）→ demo 当前版本 versionId=null → 旧码按钮 disabled/400。治法 `versionId ?? "plan-baseline"` fallback + 去 disable。
**bug③**：object-types 看实例——dev 查实 35/35 可点·非死按钮·stale 误报·不改码。

## 审核方自陷环境污染（诚实记录·非产品缺陷/非 RISK-FIX 缺陷）
复验 C3 首轮 order-chain 整页空白（affected_orders B 路 400 `unknown base: ""`）。根因排查：**审核方前序 INTAKE 复验上传 newfields.csv + objectify 物化出 2 个畸形 Base**（`obj_base_0/1` 仅 util·**baseId/name 空**·因该二列落 reconcile-candidates 未随物化）→ affected_orders 遍历基地命中空 baseId → 400 → 整页空。**重启干净内存 datacore（SEED_DEMO=1）→ 污染清（12 Base·0 畸形）→ order-chain 真渲·C3 201**。与 RISK-FIX 无关（RISK-FIX 纯前端·OrderChainView 仅改 adopt 按钮·line84 affected_orders 调用未动·git diff 实证）。
**副产真缺陷（已 WO 化 INTAKE-MATERIALIZE-KEY）**：objectify 在标识列(baseId)落 reconcile-candidates 未解析时仍物化该对象类型 → 生成无 key 的畸形对象 → 毒化 base 遍历型求解器(affected_orders/capacity_forecast 400 "unknown base")。低频（需上传标识列不精确命中的 CSV）·中 severity（毒化决策页）·非本单范围。

## 本体引用与影响
- 链路：`风险预判 RiskBoardView ← risk_timeline(liveTightness 真 OEE/利用率/良率) · 采纳 → ActionDraft(plan_change) → 审批`。
- 不变量：R6（risk_timeline 确定性·两跑一致）· R13/R14（LIVE 真源·无真→诚实 null 不伪造）· KILL-MOCK-RED（per-card 门不回归 SYNTHETIC muted）。
- 断点：G-DM-1（dataMode 逐卡消费·本单加固 per-card 门·顶层不过度抑制 LIVE）。
