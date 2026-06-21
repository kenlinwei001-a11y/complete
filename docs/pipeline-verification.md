# 数据流转·真实性核验（连线不是假的 / 数据真在流转）

> 回应质疑："连线是不是假的？数据是否真在前端 UI 可见，而不是只写在后端代码里、写死了？实际数据是不是真在流转，还只是设计假设？"
>
> 方法：起**真服务**（datacore:4021 SEED_DEMO + agentcore:4022 OBO 指向 datacore），以**前端页实际调用的同一批端点**打真请求，核对返回是否为**真实合成派生数据**（可溯源、动态计算），而非 mock/写死。**非单测、非 MSW mock**（MSW 只在 VITE_MOCK 开发模式用；部署态前端打真后端，即下表端点）。

## 逐条核验（前端页 → 其数据端点 → 真后端返回）

| 前端页/模块 | 实际调用端点 | 真实返回（实测） | 状态 |
|---|---|---|---|
| 连接器页 ConnectionsPage | `GET /a/v1/connections` | 1 条「合成数据源（确定性生成）」 | ✅ 真实 |
| 数据分类面板 | `GET /a/v1/data-categories` | 12 分类；销售订单类含 Order 类型 | ✅ 真实 |
| 数据详单 | `GET /a/v1/raw-datasets/:id/rows` | Order 20 行，首行 so=SO-10001 | ✅ 真实逐行 |
| 对象查询页 | `GET /a/v1/objects?type=Order` | total=20，首条 obj_order_SO-10001 | ✅ 真实 |
| 驾驶舱/风险（派生） | `GET /a/v1/objects?type=Base` | 派生属性**动态算出**：orderCount=3, oeeIndex=0.754757, committedQty=5988 | ✅ 真实计算 |
| 时序/曲线 | `GET /a/v1/timeseries/agg-specs` | 6 个时序聚合规约 | ✅ 真实 |
| 推演/切片 | `POST /a/v1/slices/order_fulfillment_360/resolve` | 跨域子图 46 节点 / 45 边（真解析，非空） | ✅ 真实 |
| 字段覆盖 | `GET /a/v1/field-coverage` | 181/181 | ✅ 真实 |
| 规则库 | `GET /a/v1/rules` | 15 条规则（C03…） | ✅ 真实 |

## 端到端推演（最关键：源→对象→求解器→答案 真的跑通，非假设）

`POST /b/v1/scenarios/S02/launch`（agentcore，绑真 Kimi 分类器）：

```
status: COMPLETED · path: WORKFLOW · matchedIntent: affected_orders（真 Kimi 分类）
answer.block[table] columns=[订单号,客户,型号,数量,交期]
  rows=[["SO-10003","晨风车业","L148-LFP",1800,"2026-07-09"],
        ["SO-10005","云岭新能源","L148-LFP",8...]]
answer.block[text] "受影响订单共 2 张，明细见上表"
```

**这条证明全链真实流转**：真 Kimi 把问句分类成 affected_orders → 工作流计划 → `invoke_solver` 经 OBO 调
datacore → 在**真实合成 Order 对象**上计算 → 受影响订单 **SO-10003/SO-10005 是算出来的**（常州基地的真实订单），
**不是写死的**。前端风险页/对话坞渲染的就是这个 answer。

## 诚实边界
- 核验到 **HTTP/API 层**（前端 fetch 的就是这些端点的真返回）；**未到浏览器像素层**（沙箱无浏览器）。
- 端到端推演用真 Kimi 分类器（key 由用户提供，用后即删临时文件，未入任何提交）——**请轮换该 key**。
- `agentcore` 单测仍用 MockDataCore（其主键已对齐生产）；本核验用的是**真 datacore**，非 mock。
