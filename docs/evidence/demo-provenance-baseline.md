# 轨L 增量0 · demo provenance 基线（字节不变红线的标尺 · 只看不改）

> HANDOFF §2 增量0：起真 `SEED_DEMO=1` datacore（seed 42），导出下游基线三件。增量2 后这三件须**逐字节相等**（最高红线）。
> 复现：`PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobsX SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js`，再 curl 下述端点。

## 1. 全 type key 集（34）
SHA256（sorted JSON）：`cc787b32d4c609b673342878082716d891326668bc35fe732bd63c1ef60920b6`
```
ARInvoice, AnnualScenario, Base, CapexProject, CarbonFactor, Certification, ChangeoverMatrix,
Customer, DataSourceHealth, DemandSegment, EnergyMeter, Equipment, ExternalSignal, FinanceAccount,
FinanceMetric, FinancePlan, KSF, Line, MaintPlan, Material, MaterialBalance, MaterialBatch, Metric,
Model, Order, PlanTarget, Principal, Process, PurchaseOrder, RootCauseChain, ScenarioTrigger,
Segment, Shipment, SopVersionRow
```
来源：`GET /a/v1/ontology/object-types`（34 个）。

## 2. 全 obj id 集（467）
- **objids SHA256（扁平排序 JSON）**：`8277a5a7f67cec90c13c41032475547f3ea3113d533f316cb14babed20fc9832`
- 全量列表（字节标尺）：`docs/evidence/demo-provenance-baseline-objids.json`（467 项，排序）。
- obj id 形态 = `obj_${type}_${pk}`（业务主键），样例：`obj_base_changzhou`、`obj_model_2170-NCM`、`obj_order_SO-3391`、`obj_annualscenario_AOP-2026-baseline`。
- 逐类型计数：
```
ARInvoice:24 AnnualScenario:3 Base:12 CapexProject:3 CarbonFactor:14 Certification:18
ChangeoverMatrix:30 Customer:8 DataSourceHealth:9 DemandSegment:3 EnergyMeter:12 Equipment:72
ExternalSignal:6 FinanceAccount:12 FinanceMetric:3 FinancePlan:3 KSF:5 Line:12 MaintPlan:12
Material:8 MaterialBalance:3 MaterialBatch:24 Metric:3 Model:6 Order:24 PlanTarget:17 Principal:4
Process:60 PurchaseOrder:30 RootCauseChain:4 ScenarioTrigger:4 Segment:3 Shipment:12 SopVersionRow:4
```

## 3. 沙盘 view-config nodeObjectIds（每 type → 真物化对象 id）
- **noi SHA256（按 type 排序 JSON）**：`a958632a7755d8bb54b4faef7e566df6165ef1f4fa4063578e162715a5135f45`
- 全量：`docs/evidence/demo-provenance-baseline-noi.json`。
- 来源：`GET /a/v1/sim/view-config`（轨A P0 修后该字段为引擎 idsByType 同源）。

## 4. R6 确定性核验（同 seed 重跑字节一致）
同 (SEED_DEMO=1, seed 42) **两次独立起服务**（不同 BLOB_DIR），重导出：
- type keys SHA256：两次均 `cc787b32…` ✓
- objids SHA256：两次均 `8277a5a7…` ✓
- noi SHA256：两次均 `a958632a…` ✓
→ 确定性成立，基线稳定可作字节标尺。

## 5. 红线判据（增量2 后复核）
增量2（demo 改走真建模链）完成后，重复 §1–§3 导出，三个 SHA256 **必须逐字节相等**；沙盘 tick 传导节点 Σ 仍真变（轨A P0 不破）。任一不等 = 打回。
