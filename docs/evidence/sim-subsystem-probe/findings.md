# 子系统存在性·亲测探针 findings（2026-09-18）

[09:14:16] 登录 OK（demo/admin）token 634 字符
[09:14:16] 会话列表 1 条；demo 会话 curTick=100 status=RUNNING adversaryEnabled=undefined suppressed=null
[09:14:16] features registry 命中 adversary 片段：lse,"requires":["sim.propagation"]},{"key":"sim.propagation.adversary","name":"对抗方反应","level":"BLOCK","defaultOn":false,"requires":["sim.propagation"]},{"key":"sim.checkpoint","name":"检查点/回滚","level":"BLOCK","defaultOn":
[09:14:16] drill 目录 11 类事件：ORDER_RESCHEDULE+stateEffect | ORDER_CANCEL+stateEffect | ORDER_INSERT+stateEffect | ORDER_RELOCATE+stateEffect | ORDER_REPRICE+stateEffect | MATERIAL_DELAY+stateEffect | MATERIAL_SHORTAGE+stateEffect | MATERIAL_REPRICE+stateEffect | EQUIPMENT_FAILURE+stateEffect | CAPACITY_LOSS+stateEffect | FORECAST_BIAS+stateEffect
[09:14:35] drill 事件=ORDER_REPRICE@铝箔(+15) status=200 forkedFromStateId="（键缺席）"
[09:14:35] drill 结论键：worldId,forkedFromStateId,horizonDays,tickDays,ticks,events,findings,totalByKind,truncated,appliedLimitPerKind,degraded,appliedStateEffects,worldCellsMoved,worldCellsTotal,findingsChanged,findingsBaseline,solverRuns,summary ；findings 概览={}
[09:14:35] drill 只读核验：curTick 100 → 100（不变=演习没推歪世界线）；扰动账 ?→?
[09:14:59] 反事实（关 demo_material_price_to_model_cost, n=2）status=200 差分格数=564 firedInBaseline=["demo_material_price_to_model_cost"]
[09:14:59] 未知键对照臂 status=400 code=UNKNOWN_PROPAGATION_RULE_KEY msg=未知传导规则 key：zz_no_such_rule。对照跑同样拒绝静默忽略——否则差值恒 0，而你会以为"关掉这条边没有影响"。
[09:15:00] 最大订单：obj_order_SO-3490 cust=东风汽车 value=352397826
[09:15:01] 臂A(关)：会话 sims_x2d82t6sne23vhe4 施扰 status=201 tick status=200 trace=6行 还手规则行数=0 disclosure.adversaryEnabled=null
[09:15:01] 臂A(关)：客户=（未匹配） receivablePressure=undefined（容忍线 12） 订单 orderChurn=undefined
[09:15:01] PUT features 开对抗方 status=200 回包含 adversary 片段：{"features":["act.adopt-to-draft","act.aop-finalize","act.export","act.plan-audit.apply-fix","admin.meta-ontology","admin.plan-builder","ceo.dataset.generate","data-import.record-materialize","decisio
[09:15:02] 臂B(开)：会话 sims_mj3pkmg6xf7acp26 施扰 status=201 tick status=200 trace=6行 还手规则行数=0 disclosure.adversaryEnabled=null
[09:15:02] 臂B(开)：客户=（未匹配） receivablePressure=undefined（容忍线 12） 订单 orderChurn=undefined
[09:15:02] 已复原开关 status=200。双臂对照：A 还手 0 行 / B 还手 0 行 ⇒ ⚠ 开了也不还手（容忍线未越/链路未通，逐行查样本）
[09:15:03] 校准 GET：report=200 proposals=200 history=200；proposals 条数=2
[09:15:03] 校准 runAll status=200 回包前 600 字：{"paired":0,"deferred":0,"staleDeferred":false,"slicesEvaluated":0,"created":0,"autoApplied":0,"held":0,"dropped":0,"insufficient":0}
[09:15:03] 场景目录 status=200 卡数=20；首卡=S01 订单可承接性评审 solver=capacity_forecast(undefined) presetContext键=targetView,selectedObjects,slotPresets
[09:15:03] 基地候选 13 个，取 changzhou（常州）
[09:15:03] outlook status=200 顶层键=baseId,baseName,forecastStart,horizons,dayPlan,summary,byModel；置信口径命中=P50
[09:15:13] UQ 探针 status=200 回包顶层键=curTick,state,trace,cadence,scope,stateVarReport,pairWeighting,signalToNoise,appliedPerturbations；UQ 字段回声=（零） ⇒ knob 不存在且被静默忽略（tick 体是手读 n，非 zod 解析）
