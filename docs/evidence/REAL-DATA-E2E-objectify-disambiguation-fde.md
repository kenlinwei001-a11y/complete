# 真目标验证 · 真实业务数据真走真实管道（第一次·钉断点+根因修）· FDE

> 触发：用户「把尾巴都收尾，不要偷懒走捷径」+ 审核方 `SELF-AUDIT-proxy-substitution` §1#1（真接入臂从未真验·历次回应都是代理替换）。
> 方法：审计 §4——**不再写文档代理，立刻真做一次真目标验证**：造真实业务文件→真起服务→真走 upload→objectify→对象→求解器，每步真响应录证，钉死真断点。

## 用户动作（亲手·curl 真验·非读 dev 声明）
真起 datacore（内存 SEED_DEMO=1·:4081），造**真实新订单** `real-orders.csv`（宁德时代储能/比亚迪乘用车/蔚来能源/国家电网储能/理想汽车 5 单·真 qty/单价/交期/状态），走：
```
POST /a/v1/uploads            → RawDataset 5 行（/raw-datasets/:id/rows 真读 so=SO-2026-7001 ✓）
POST /a/v1/databuilder/intake/objectify {connId}
                              → materialized Order×5 · Order 计数 24→29
GET  /a/v1/objects/Order/obj_order_SO-2026-7001
```

## 钉出的真断点（代理"count++"掩盖空壳）
**修前**对象只剩 6 字段、业务数值全丢：
```
props: { so, cust, model, due, leadDays, value:0 }   ← qty/status/unitPrice 不见了！value=0
```
对照 demo 种子订单 SO-3391 有全 14 字段（qty/status/unitPrice/…）。**"Order 计数+5" 看着像成功，但对象是空壳**——求解器算 `value=qty×unitPrice=0` → 上传的真实业务数据**没有驱动任何决策数字**。这就是审计钉的"真接入臂未验·proxy-only"。

**根因**（读源坐实）：`reconcileIntake`（`databuilder/prototype-intake.ts`）**逐列**判歧义——一列名在 ≥2 个对象类型都有同名字段就判歧义、落 candidates、物化时丢：
- `qty` → Order/MaterialBatch/PurchaseOrder（3 类型）→ 丢
- `status` → Order/Shipment/ScenarioTrigger/Certification（4）→ 丢
- `unitPrice` → Model/Order/Material（3）→ 丢
- `so/cust/model/due/leadDays` → 仅 Order（唯一）→ 留

## 根因修（`modeling.ts materializeFromReconcile`·确定性·不猜·不调 LLM）
数据集已被**无歧义列**唯一指认主类型（5/8 列 →Order）。故加**数据集级消歧**：取 autoMapped 最多列的主类型（≥2 列方 confident），把"列名精确命中主类型字段(score=1)"的歧义列归入主类型。歧义仅靠"该数据集是什么表"这一既有事实化解，无新猜测。

## 修后真目标证据（同 curl 亲验）
5 单对象全带业务数值 + 派生 `value` 真算（= qty×unitPrice 万元）：
```
SO-2026-7001 qty=4200 unitPrice=1.38 status=CONFIRMED value=5796
SO-2026-7002 qty=2600 value=5590
SO-2026-7003 qty=1800 value=4176
SO-2026-7004 qty=9500 value=12825
SO-2026-7005 qty=3100 value=6758
```
`value` 从恒 0 → 真实营收值。**真实业务数据现在真驱动了对象的派生数值。**

## 回归门（防回潮）
`apps/datacore/test/modeling.test.ts OM4b`：seedBattery 造真歧义（qty/status 多类型）→ 上传 ORDERS_CSV → objectify → 断言对象真带 `qty=1200/status=OPEN`（修前必失败）。datacore 全套绿。

## 诚实边界（不冒充·REQ-LEDGER#1 仍 ◐ 非 ✅）
- 本次**钉死并修了管道上的第一个真断点**（上传业务数据真带全字段进对象、派生真算）。
- **尚未验证的下游**：① 求解器/驾驶舱**消费**这些真对象端到端算出的决策数字正确；② 真实连接器（非手动 upload）的运营态活水；③ 同名多列若分属真不同类型（如订单表里混了 MaterialBatch 列）的边界——当前消歧偏向主类型，极端混表需人确认（reconcile candidates 仍在）。下次真目标验证继续往下游钉。
- 这是审计 §1#1 从 🔴 → ◐ 的第一步真推进，**不是 ✅**。
