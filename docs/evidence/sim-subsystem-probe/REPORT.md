# 子系统存在性·亲测验证报告（2026-09-18）

仓主令：「不要仅仅基于 grep，而是亲自输入扰动因素去验证」。
对象：grep 轮 claim 过「存在/缺席」的子系统。方法：真登录、真施扰、双臂对照（能双臂绝不单臂），
异常原文落盘不绕行。驱动：`probe.mjs`（第一击）+ `probe2.mjs`（第二击），逐步 .json+.rc。

## 总裁决表

| # | 子系统（grep 轮 claim） | 亲测裁决 | 决定性证据 |
|---|---|---|---|
| 1 | 演习 drill（事件→fork→双引擎→扫描） | ✅ **真跑** | 对路事件 MATERIAL_REPRICE@铝箔+15%：`appliedStateEffects` 非空（priceShock delta **3.3**，rawMagnitude 15→rangePct 15×observedRange 22，换算依据明文；downstream 系数 ×0.15651 点名）；**worldCellsMoved 254/6,363**；一个事件真调 **3 个求解器**（quote_margin / supply_demand_gap_attribution / risk_timeline 全 ok:true）；**只读**（curTick 100→100） |
| 2 | drill 诚实位 | ✅ | 错配事件（ORDER_REPRICE@Material）：appliedStateEffects=[]、moved 0、求解器回 `ok:false + "缺必填字段 pctChange…"`、totalByKind 含 **未能评估:2**、summary trustworthy:true dataMode:LIVE；`forkedFromStateId:null` 诚实（无企业快照可 fork，不现场偷捕） |
| 3 | counterfactual 反事实是产品 API | ✅ **真双臂** | 关 `demo_material_price_to_model_cost` n=2 → **差分 564 格**；`suppressedRulesFiredInBaseline=[该键]`（「它真在跑」与「关了没影响」显式分开）；未知键 → **400 拒跑**（不静默忽略） |
| 4 | 对抗方还手（ABM 树桩） | ✅ **活着且开关真控** | 双臂（同快照、同扰动：最大单 SO-3490 东风汽车 costPressure+80）：臂A(关) 还手 **0** 行 / 臂B(开) **119** 行；trace 规则键 47→48 种（多出的就是还手规则）；delayTicks=1 以 `(delayed)` 在途形态入账；力度按订单金额拉开（0.33/0.77/1.75/2.17…）；目标格 orderChurn 从占位 45 被真和 **14.58** 洗掉；receivablePressure 两臂同为 13.52（>容忍线 12，确由本次扰动推过线） |
| 5 | 校准/回测 | ✅ **管线活**；本世界实料 0，如实回零 | GET report/proposals/history 全 200；手动 runAll 真跑回 `paired:0…slicesEvaluated:0`（没拿种子冒充新算）；2 条提案+14 天 MAPE 曲线+history 均为**种子演示数据**（`calp_demo_seed_*`/`calh_demo_seed_*`）——结构上 proposals 带 method:EMA、nPairs:96、mapeBefore/simulatedMapeAfter/bias 全字段 |
| 6 | 场景目录 20 卡 | ✅ | agentcore `/b/v1/scenarios` 真下发 20 卡，带 presetContext（targetView/selectedObjects/slotPresets） |
| 7 | base_capacity_outlook | ✅ 真求解 | 逐行 **provenance**（kind:实测/派生 + drillType/drillId/drillField/drillValue）；horizons/dayPlan/byModel 齐；P50 口径命中 |
| 8 | 引擎级 UQ 缺席 | ✅ **亲测坐实** | tick 塞 `ensemble:3, distribution:"p90", seeds:[1,2,3]` → 200 收下、**零回声、静默忽略**（tick 体手读 n，非 zod 解析）；与 counterfactual 未知键 400 拒跑成**两套拒绝纪律**（不一致，记一笔） |

## 探针自身缺陷记录（与产品裁决分开）

1. **第一击 S5 双臂作废**：新建会话不带 baseSnapshot ⇒ 两臂跑在空世界里（trace 仅 6 行），
   「开关不控还手」的中间读数是**探针 premise 错误**，非产品结论；第二击带 demo 快照重测才有效。
2. **第一击 S3 事件错配**：正则先中 ORDER_REPRICE（期望订单）却打在 Material 上 —— 意外成了
   drill 诚实位的活测试（缺字段被点名、未能评估入账）。
3. 第一击客户匹配 `===` 全等失败；第二击改 includes 命中 `obj_customer_cust_18`。

## 本轮被推翻/精化的既有说法（照实入账）

- 「会话分叉不存在」→ **推翻**：drill 编排器 + enterpriseState.fork 在跑（本世界无快照 ⇒ 诚实 null）。
- 「对照实验不是产品能力」→ **推翻**：counterfactual 就是产品级双臂 API，且带 firedInBaseline 诚实位。
- 「校准闭环不存在」→ **推翻**：管线在跑，含 C12→calibration.required→提案钩子；本内存世界无配对料。
- 「世界里行为体一个都没有」→ **精化**：有**且仅有一个**（Customer CUT_ORDER，开关默认关、延迟 1 拍、
  单边封顶 40、力度按敞口加权）——ABM 种群=1，有物种没生态。

## 亲测后仍成立的「真未见」

- **引擎级 UQ**：单确定性轨迹；无 ensemble/分布/敏感度 knob（S9 坐实，且未知参数被静默吞）。
- **proposedBy 分账**：扰动契约无施加者字段（契约层核验）。
- **扰动归因维**：chain_impediments 按 scope 全扫，不答「哪几条是本次扰动造成」（上轮已坐实）。
- **ABM 生态**：行为体仅 1 种。
- **tick 与 counterfactual 的未知参数拒绝纪律不一致**（静默吞 vs 400）——小额不一致账。

## 环境复原

对抗方开关已 PUT 回 false；UQ 探针使 demo 会话 curTick 100→101（测试世界，如实登记）；
探针新建会话 4 条（内存模式，随进程生灭）。
