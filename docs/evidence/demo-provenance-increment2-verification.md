# 轨L 增量2 验证证据（demo 走真建模链 · 亲手真跑 FDE）

> 根因方案落地后逐门真跑。命令：起真 `SEED_DEMO=1` datacore（chainMode 现为 demo 默认路径），脚本见 `scratchpad/byte-gate2.mjs`/`prov-check.mjs`（随附）。

## 1. 字节红线（最高红线）— 三件逐字节相等 ✅
真跑 `GET /a/v1/ontology/object-types` + `GET /a/v1/sim/view-config`，与增量0 基线对：

| 件 | 基线 SHA256 | 增量2 chainMode SHA256 | 结果 |
|---|---|---|---|
| 全 type key 集（34） | `cc787b32…` | `cc787b32d4c609b673342878082716d891326668bc35fe732bd63c1ef60920b6` | ✅ 相等 |
| 全 obj id 集（467） | `8277a5a7…` | `8277a5a7f67cec90c13c41032475547f3ea3113d533f316cb14babed20fc9832` | ✅ 相等（added=0 removed=0） |
| 沙盘 nodeObjectIds | `a958632a…` | `a958632a7755d8bb54b4faef7e566df6165ef1f4fa4063578e162715a5135f45` | ✅ 相等（34 类 0 mismatch） |

## 2. R6 确定性 ✅
第二个**独立**起服务（端口 4011·不同 BLOB_DIR·同 seed 42·chainMode）重导出三件 → 三 SHA256 与 §1 **逐字节相同**。链走确定性 `deriveModeling`，无 LLM/时钟/随机。

## 3. provenance 因果真实（R13 修建模层断点）✅
`GET /a/v1/ontology/object-types` 抽查：**34/34 类型有真 sourceBindings**（指向真合成连接 `connId` + `dataset=typeKey` + 真 `fieldMappings`，**非硬编码模板**）；**6 类派生属性保留**（Base: orderCount/committedQty/oeeIndex、Model: totalDemand/orderCount、Order: value、DemandSegment/Metric/SopVersionRow…）；**34/34 真归域**；中文 displayName 保留（生产基地/电池型号/销售订单…）。对象 `origin.type=MATERIALIZED` 可溯 `datasetId`。

样例：
```
Base ['生产基地' domain=factory]
  sourceBindings=[{"connId":"conn_…","dataset":"Base","fieldMappings":{"baseId":"baseId",…}}]
  derived=["orderCount","committedQty","oeeIndex"]
Order ['销售订单' domain=product]  derived=["value"]   sourceBindings→dataset=Order ✓
```

## 4. 零回归 ✅
`pnpm -r build && pnpm -r test` 全绿：contracts 1 · llm-adapters 1 · agentcore 74(+1skip) · frontend-shell 115 · datacore 137(+1skip)。
新增 `test/demo-chain-provenance.test.ts`（2 测）锁定 chainMode：①34 类经链 CREATE+真 sourceBindings+派生属性/中文名/域保留+`obj_base_changzhou` 字节同 A 路+origin=MATERIALIZED ②R6 同 seed 两跑类型键/对象 id 字节一致（467）。

## 5. 为何非捷径/非盖戳（审核方裁"解决根本问题不走捷径"）
类型由 `publishDraft` **真 CREATE**（存在性因果由链导致，满足红线 §3.3）；sourceBindings 由 publish **真读真 rawDataset 算**（非被否的硬编码模板）。确定性策展 PATCH 改的是**类型定义**（属性/名/域/派生——人工不可自动推导的业务语义，A3 半自动建模"人工 PATCH"半），**不碰 provenance**。根因 = 补全链表达力（增量2a：契约 += derivedProperties/json）使链能产生产级策展类型——这正是 demo 当初短路链的原因，今补齐后让 demo 真走链。

## 6. 待办（增量3）
ModelingPage UI 真值闭合：中心显真本体（34 类·可溯 sourceDataset）、左侧 34 数据集显"已建模"（coverage 认已发布类型 sourceDataset，非仅草案）、点数据集溯到其类型。真浏览器 FDE 实拍。
