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

---

## 复验修（2nd round·S03 两处存活收口）真起双服务实证

datacore :14001 (memory·SEED_DEMO) + agentcore :14002 → POST /b/v1/scenarios/S03/launch（⑥点名卡·切片表路径）
→ GET /api/v1/queries/:taskId，逐值对照 datacore `/a/v1/objects?type=Order` 真值。

### 修①（⑥ cellOf 裸 JSON）：S03 切片表 cols=[id,type,props] props 列——修前 6 格整段裸 JSON（'{"so":"SO-3391","cust":"整车厂A"...'），修后紧凑人话（PK so 打头 + k=v 串）

```
### S03 risk_root_cause（常州物料齐套为什么这天越线？）
status COMPLETED | trust VERIFIED_WORKFLOW
  TEXT 本次回答所用参数：基地=常州、日期=2026-06-10。
  TEXT 基地风险画像（base_risk_profile 切片）：
  KPI  Base·Type = Base
  KPI  Risk·Level = MEDIUM
  KPI  Risk·Utilization = 0.83
  KPI  Risk·Bottleneck = 模组
  TABLE cols=[id,type,props]
    ROW [null, Order, SO-3391（cust=整车厂A，model=4680-NCM，qty=8，due=2026-06-24，pri=高，bases=changzhou、hefei，…等 7 项）]
    ROW [null, Order, SO-3420（cust=海外车企E，model=4680-NCM，qty=10，due=2026-07-09，pri=高，bases=changzhou、hefei，…等 7 项）]
    ROW [null, Order, SO-3445（cust=整车厂B，model=方形-NCM，qty=11，due=2026-07-05，pri=高，bases=changzhou，…等 7 项）]
    ROW [null, Order, SO-3476（cust=储能集成商D，model=4680-LFP，qty=8，due=2026-07-20，pri=中，bases=changzhou，…等 7 项）]
    ROW [null, Order, SO-3481（cust=整车厂A，model=4680-NCM，qty=10，due=2026-07-11，pri=高，bases=changzhou、hefei，…等 7 项）]
    ROW [null, Order, SO-3490（cust=海外车企E，model=4680-NCM，qty=13，due=2026-07-06，pri=高，bases=changzhou、hefei，…等 7 项）]
```

**形状扫描（程序断言·非目测）**：全 blocks 序列化后 `re.findall(r'obj_[\w-]+')` = **[]（零 obj_ 值）**；
全表格字符串单元格 `re.search(r'[{}\["]')` 命中 = **[]（零 JSON 形状格）**。

**逐值对照 datacore 真值**（GET /a/v1/objects?type=Order·同 SEED_DEMO seed 42）：

| 前端所见（props 格） | 后端真值 | 一致 |
|---|---|---|
| SO-3391 cust=整车厂A | props.cust="整车厂A" | ✓ |
| SO-3391 qty=8 | props.qty=8 | ✓ |
| SO-3391 due=2026-06-24 | props.due="2026-06-24" | ✓ |
| SO-3391 bases=changzhou、hefei | props.bases=["changzhou","hefei"] | ✓ |
| SO-3391 …等 7 项 | 省略 status/demandDelta/outsourceRatio/creditUsedRatio/leadDays/unitPrice/value 恰 7 键 | ✓ |
| SO-3490 qty=13 due=2026-07-06 | props.qty=13 due="2026-07-06" | ✓ |
| id 列 null | 真值 obj_order_SO-3391（内部 id·含下划线+连字符）→ 依红线不直出 | ✓ |

### 修②（④ INTERNAL_ID_RE 半漏）：尾段 [0-9a-zA-Z]+ → [\w-]+

真实 id 形态 `obj_base_changzhou`（下划线）/ `obj_model_4680-NCM`（连字符）修前漏网（'Base·Id = obj_base_changzhou' KPI 照出）；
修后 isInternalIdValue 收编，S03 全答案零 obj_ 值（上述程序断言）。齿：answer-projection-humanize.test.ts「⑥ S03 形状齿」4 例。

### 回归复核（round-1 全齿保绿·真跑）

- **S17 capex_review** 重跑：零裸 S/G/s0 label（基线供给(按季)/达成供给(按季)/季度缺口(按季)人话仍在）、
  ruleSetVersion/dataMode/confidence 仍在「口径与来源」脚注条、零 obj_、零 JSON 格。
- **S13 maint_stagger** 重跑：结果表并存 + 「子字段「待处理项」：无」人话披露（无 infeasible/unresolved 直出）、脚注条在。
- agentcore 全套 `npx vitest run`：**89 passed | 1 skipped（481 tests passed）**，round-1 的 11 齿 + 新 4 齿全绿。
