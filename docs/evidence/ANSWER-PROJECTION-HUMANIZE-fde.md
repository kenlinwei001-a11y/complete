# ANSWER-PROJECTION-HUMANIZE 真起双服务实证

datacore :4001 (memory·SEED_DEMO) + agentcore :4055 → POST /b/v1/scenarios/:key/launch → GET /api/v1/queries/:taskId
逐值对照后端求解器真值（/a/v1/solvers/:key/invoke 同源·见下 raw 对照）。all unverified=false（Path A 数字全溯源）。

```
### carbon_q
status COMPLETED | unverified false
  TEXT 碳足迹核算（求解器 carbon_footprint）推演结果：
  TEXT 结论：判定为「超标」 ⟦ref:0⟧。
  KPI  型号  = 4680-NCM
  KPI  基地  = 成都
  KPI  碳足迹合计 (kgCO₂e) = 349.6151
  KPI  构成·物料碳排 (kgCO₂e) = 348.311
  KPI  构成·能耗碳排 (kgCO₂e) = 1.3041
  KPI  碳阈值 (kgCO₂e) = 70
  KPI  判定  = 超标
  KPI  最大可用杠杆  = 物料:al_foil
  TABLE cols=[key,name,severity,expression,outcome,evidence] rows=1
  TEXT 依据规则：C33 ⟦ref:0⟧
  TEXT 口径与来源：数据模式：SYNTHETIC；规则集版本：rsv_67abbdc9；置信度：LIVE·此决策基于合成数据（非真实接入）。

### capex_review
status COMPLETED | unverified false
  TEXT 产能投资评审（求解器 capex_scenario）推演结果：
  KPI  季度序列  = 4
  KPI  季度需求(按季)  = 50、48、49、51
  KPI  基线供给(按季)  = 45、45、45、45
  KPI  达成供给(按季)  = 45、47、48、48.6
  KPI  季度缺口(按季)  = 5、1、1、2.4
  KPI  C23·Irr Min  = 0.15
  KPI  C23·Util24 Min  = 0.75
  TABLE cols=[kind,fromQ,toQ] rows=1
  TEXT 另有明细：Projects（1 项）、Evaluated Rules（2 项）（详见步骤溯源） ⟦ref:0⟧。
  TEXT 口径与来源：规则集版本：rsv_67abbdc9；数据模式：SYNTHETIC；置信度：PARTIAL·此决策基于合成数据（非真实接入）。

### credit_check
status COMPLETED | unverified false
  TEXT 客户信用风险（求解器 credit_exposure）推演结果：
  TEXT 结论：判定为「冻结（存在逾期>30天）」 ⟦ref:0⟧。
  KPI  授信额度 (元) = 5782
  KPI  风险敞口 (元) = 2075
  KPI  可用额度 (元) = 3707
  KPI  敞口构成·应收账款 (元) = 1920
  KPI  敞口构成·在制未开票 (元) = 155
  KPI  新单判定  = 冻结（存在逾期>30天）
  TABLE cols=[invoiceId,overdueDays,amount] rows=1
  TEXT 依据规则：C13、C32 ⟦ref:0⟧
  TEXT 另有明细：Evaluated Rules（2 项）（详见步骤溯源） ⟦ref:0⟧。
  TEXT 口径与来源：数据模式：SYNTHETIC；规则集版本：rsv_67abbdc9；置信度：PARTIAL·此决策基于合成数据（非真实接入）。

### maint_stagger
status COMPLETED | unverified false
  TEXT 检修窗口错峰（求解器 maintenance_stagger）推演结果：
  TABLE cols=[base,fromWeek,toWeek,loadDrop] rows=12
  TEXT 依据规则：C11 ⟦ref:0⟧
  TEXT 另有明细：Evaluated Rules（1 项）（详见步骤溯源） ⟦ref:0⟧。
  TEXT 子字段「待处理项」：无——该项在当前结果下无内容，不影响上表结果。
  TEXT 口径与来源：数据模式：SYNTHETIC；规则集版本：rsv_67abbdc9；置信度：PARTIAL·此决策基于合成数据（非真实接入）。

### inventory_opt
status COMPLETED | unverified false
  TEXT 库存水位优化（求解器 inventory_optimize）推演结果：
  KPI  可释放现金 (元) = 0
  TABLE cols=[matId,underQty] rows=5
  TEXT 依据规则：C16、C28 ⟦ref:0⟧
  TEXT 另有明细：呆滞项（6 项）、Evaluated Rules（2 项）（详见步骤溯源） ⟦ref:0⟧。
  TEXT 子字段「超储项」：无——该项在当前结果下无内容，不影响上表结果。
  TEXT 口径与来源：数据模式：SYNTHETIC；规则集版本：rsv_67abbdc9；置信度：LIVE·此决策基于合成数据（非真实接入）。

```
## 后端 raw 对照（同参数直调求解器）
```json
cockpit_kpi:
{"data":{"supplyV7":130,"revAttainPct":102,"utilPeak":90,"aopBaseRev":13.9,"cashCushion":58,"dataMode":"SYNTHETIC","confidence":{"synthetic":true,"stale":false,"measurement":"LIVE","note":"此决策基于合成数据（非真实接入）"}},"snapshotVersion":"1.2"}
carbon_footprint:
{"data":{"dataMode":"SYNTHETIC","modelId":"4680-NCM","baseName":"成都","total":349.6151,"breakdown":{"materialCarbon":348.311,"energyCarbon":1.3041},"threshold":70,"verdict":"超标","maxLever":"物料:al_foil","ruleRefs":["C33"],"evaluatedRules":[{"key":"C33","name":"碳护照前置","severity":"BLOCK","expression":"NOT (Order.destination == 'EU' IMPLIES Order.carbonFootprint <= Order.euCarbonThreshold)","outcome":"PASS","evidence":"通过（NOT (Order.destination == 'EU' IMPLIES Order.carbonFootprint <= Order.euCarbonThreshold)）"}],"ruleSetVersion":"rsv_67abbdc9","confidence":{"synthetic":true,"stale":false,"measurement":"LIVE","note":"此决策基于合成数据（非真实接入）"}},"snapshotVersion":"1.2"}```
