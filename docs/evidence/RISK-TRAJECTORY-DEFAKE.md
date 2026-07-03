# RISK-TRAJECTORY-DEFAKE — 真实测试证据（真起 datacore in-memory·SEED_DEMO=1·2026-07-03）

启动：`PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-risk SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js`
调用：`POST /a/v1/solvers/{key}/invoke`（X-Debug-User: demo:admin:admin|planner|catalog_admin）

## 1. 真数据仍出真红（KILL-MOCK-RED 基线不破·crossDay 真算非 hash）
risk_timeline horizon=90 自动扫描 → 4 张真 LIVE 卡，越线日绑定**真检修周**（MaintPlan.week）：
```
常州 设备OEE cur 82 peak 92 crossDay 30 LIVE   (检修 week5 → day32)
洛阳 设备OEE cur 83 peak 92 crossDay 50 LIVE
眉山 设备OEE cur 83 peak 92 crossDay 50 LIVE
武汉 设备OEE cur 82 peak 92 crossDay 58 LIVE
```
基线=真张力（liveTightness 读真 equipment.oee_current）保持水平；真检修事件脉冲把张力顶过阈值 85 才越线。
horizon=30 时同 4 基地检修窗（week5-8→day32+）落在窗外 → 0 卡（**诚实**：30 天内无排定检修、真张力 82-83 未及 85 → 不越线不造红）。

## 2. B1 crossDay 不再编（flat baseline·删 riskTarget hash 爬坡）
洛阳·设备OEE forced（h=30）：cur 83 → peak 83 → crossDay **None**（真张力 83 < 85·无窗内检修事件 → 诚实不越）。
旧码：`vb=cur+(tgt−cur)×ramp`，tgt=cur+hash(名首码+因子首码)，把 83 爬到 96+ 制造假越线 → 已删。

## 3. B2/B3/B4/B6 事件具体值 + 假源归因（41 事件全检）
```
events WITH src field: 0        （删 EVENT_SRC：不再标 EAM/CMMS·S&OP/ERP·WMS/ERP 假源）
descs 谎称真实系统源: 0          （无实测量化一律标「需接入…实测·当前无实测值」）
```
- maint_window：`年度检修窗口（第5周）…（计划停机天数与 OEE 影响需接入 EAM/CMMS 实测，当前无实测值）` — 无 hash 停机天/OEE 下调 pt。
- delivery_peak：`SO-3391·整车厂A 交付 8 万套到期（交期 D+14）…预计额外工时约 13 人·班（按 1.6 人·班/万套估算·非实测）` — qty 真、工时明标估算(系数入 param)、删 hash 负载 pt。
- arrival_gap：`关键物料到货周期节点（每14天·第14天）…（安全库存覆盖天数与齐套率需接入 WMS/ERP 实测，当前无实测值）` — 无 hash 齐套率/覆盖天。
  （延误在途批事件用真 Shipment.coverageDays + 真在途批计数，非 hash lead/nb。）

## 4. B5 信用占用比（删 hash·真数据算或真叙述·无假红裁决）
affected_orders horizon=90 → CREDIT 判定文案取**真实敞口叙述**（override.why），非 hash 占用比：
```
信用判定：客户 商用车集团G 信用敞口超过额度上限（商用车集团G 在手应收 9.8 亿 + 新单 12.6 亿 > 信用额度 21 亿；规则 C13）
信用判定：客户 商用车集团G 信用敞口超过额度上限（商用车集团G 低优先级单，信用额度已被占满；规则 C13）
```
旧码 `creditBase + hash(cust|so)%creditMod/100` 编造占用比、`>1` 驱动信用阻断裁决（假红）→ 删。
无 override 且无真 Customer 信用数据 → 不分类 credit（诚实·不伪造）。真 Customer 数据在场则算 (应收+在制未开票)÷信用额度。

## 5. 洛阳·设备OEE 无真源诚实空态（G-DM-1 假红原案确认修复）
force 常州·换型损失（无逐设备实测源）：`dataMode=MOCK · hasData=false · currentTightness.value=null · crossDay=null · series=[]`
noDataReason：「该基地×因子无真实数据源…请接入真实设备/订单数据」——**不出红**。

## 6. B8/B9/G1/G2/G3
- B8 severity 阈值 92/78/加成12 → params.risk.caseSeverity（默认=CASE_SEVERITY_DEFAULT 命名常量·可校准）。
- B9 tension 常数 62/70/0.6/0.8/40 → params.risk.demandTension（数值仍由真 load/share/util 驱动）。
- B6 工时系数 1.6 → params.risk.deliveryLaborPerWan。
- G1 `SEG_PRICE ?? 0.6` 假单价兜底（不可达）→ segPriceWan() 失败响亮（抛错·非静默假值）。
- G2 outsourcing_split 默认 gap=totalDemand×0.15 → 命名 DEFAULT_GAP_FRACTION·extendedDataMode 由 LIVE 降 PARTIAL（诚实标估算）。
- G3 yield_diagnosis 合成默认序列断点 `source:"MES"`（假源）→ `source:"SYNTHETIC"`+synthetic:true（mode 已 MOCK）。
