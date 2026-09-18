# 探针第二击 findings（2026-09-18）

[09:19:39] 登录 OK
[09:20:04] drill MATERIAL_REPRICE@铝箔+15% status=200
[09:20:04] appliedStateEffects=[{"eventKind":"MATERIAL_REPRICE","targetObjectId":"obj_material_al_foil","targetStateVar":"priceShock","mode":"delta","magnitude":3.3,"startTick":103,"applied":true,"rawMagnitude":15,"magnitudeBasis":"幅度键本身即百分点，1:1 不换算","targetLabel":"铝箔","rangePct":15,"observedRange":22,"downstream":["Model.costPressure ×0.15651"]}]
[09:20:04] worldCellsMoved=254/6363 findingsChanged=0 totalByKind={"卡点":273,"脆弱点":312,"堵点":28}
[09:20:04] solverRuns=[{"solverKey":"quote_margin","eventKind":"MATERIAL_REPRICE","ok":true,"dataMode":"UNDECLARED","error":null,"findingCount":1},{"solverKey":"supply_demand_gap_attribution","eventKind":"MATERIAL_REPRICE","ok":true,"dataMode":"UNDECLARED","error":null,"findingCount":1},{"solverKey":"risk_timeline","eventKind":"MATERIAL_REPRICE","ok":true,"dataMode":"PARTIAL","error":null,"findingCount":8}]
[09:20:04] 对照第一击（错配事件）：moved 0→254、changed 0→0 ⇒ ✅ 对路事件真打进世界态
[09:20:04] demo baseSnapshot 取到，格数=4425
[09:20:04] 最大订单=obj_order_SO-3490（东风汽车 value=352397826）→ 客户对象=obj_customer_cust_18
[09:20:05] 臂A(关)：trace=7120行 规则键=47种 还手行数=0 | 订单costPressure=37.622621951208 客户receivablePressure=13.523339092277(线12) orderChurn=45
[09:20:05] PUT 开对抗方 status=200 回包含该键=true
[09:20:07] 臂B(开)：trace=7241行 规则键=48种 还手行数=119 | 订单costPressure=37.622621951208 客户receivablePressure=13.523339092277(线12) orderChurn=14.576239114569
[09:20:07] 臂B(开) 还手样本=[{"ruleKey":"demo_customer_reaction_cut_order","fromObjectId":"(delayed)","toObjectId":"obj_order_SO-3391","amount":0.330156271372,"viaLinkKey":"(pending)"},{"ruleKey":"demo_customer_reaction_cut_order","fromObjectId":"(delayed)","toObjectId":"obj_order_SO-3402","amount":2.171746731639,"viaLinkKey":"(pending)"},{"ruleKey":"demo_customer_reaction_cut_order","fromObjectId":"(delayed)","toObjectId":"obj_order_SO-3415","amount":0.765172447798,"viaLinkKey":"(pending)"},{"ruleKey":"demo_customer_reaction_cut_order","fromObjectId":"(delayed)","toObjectId":"obj_order_SO-3420","amount":1.752216119983,"
[09:20:07] 已复原开关
[09:20:07] 双臂裁决：A=0 / B=119 ⇒ ✅ 开关真控还手：关=0、开>0（ABM 树桩活着且受控）
