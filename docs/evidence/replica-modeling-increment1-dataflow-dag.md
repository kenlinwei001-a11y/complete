# 轨P 增量1 · 数据流 DAG（复刻竞品 image2「架构本体设计」横向 ETL · 承轨A P1 #37 升级）验证

> 两 watch（审核方盯）：① 中间「数据处理」层 = 真 fieldMappings（dataset.field→type.prop），非编造 transform；
> ② 像素 1:1 竞品 image2 横向分层 ETL（5 链 + 节点连接桩 + 正交折线箭头 + 最右汇本体库）。#37 升级承接。

## 实现（承接 #37·不另起·本体专用 SVG）
- `ModelingPage.DataPipelineDag` 从 #37 的 LayeredDag(bezier) **升级为竞品像素级 ETL SVG**：4 列横向
  `数据集(事件表) → 数据处理_XX → 实体/关系 → 本体库`；正交折线箭头(`M…L mx,y1 L mx,y2 L x2,y2`)+
  左右连接桩(circle)+ 箭头 marker；实体节点带 `[模][动]` 双徽(模=已发布·动=有派生属性)；最右本体库汇聚。
- **数据处理节点 = 真 sourceBindings.fieldMappings**：点开出 Modal 真映射表（dataset.field→type.prop）。
- 5 代表链取真类型(Order/Base/Model/Line/Material→销售订单/生产基地/电池型号/产线/物料)，零写死(R14)、确定性(R6)、缺 sourceBindings 标橙(诚实)。LayeredDag 不再用→移除该 import；**未改任何共享组件**(自建 SVG)。

## FDE（真浏览器·`replica-modeling-p1-etl-dag.png`）
`/admin/modeling` 展开数据流 DAG：
- 4 列 ETL：数据集 / 数据处理 / 实体 / 本体库；实体节点 `生产基地Base模动`、`电池型号Model模动`、`产线Line模`、`物料Material模`；本体库节点在最右汇聚。
- **watch①+② 坐实**：点「数据处理_Order」→ Modal「数据处理：Order → 销售订单（真字段映射 · 13 条）」
  逐行 `Order.so→so / Order.cust→cust / Order.model→model / … / Order.unitPrice→unitPrice`——
  **全来自 sourceBindings.fieldMappings（轨L 真建模链 publish 产出·R13），非凭空造 transform**。
- 无写死/假数据：节点名=真类型名、映射=真 fieldMappings、缺 sourceBindings 标橙。

## 审核方复核判据对照
① 像素核对竞品 image2：横向 ETL 4 列 + 连接桩 + 正交箭头 + 本体库汇聚 ✓
② DAG 节点溯真 RawDataset→ObjectType fieldMappings（点节点看真映射）✓（13 条真映射）
③ 无写死/假数据 ✓
CLI/测试：pnpm -r build 绿；f10.modeling 测绿。
