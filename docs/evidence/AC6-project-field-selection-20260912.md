# AC6 · project 列选现状取证（G6 已成立，无前后对比）

- 实测日：2026-09-12
- 环境：本机内存模式真后端（`SEED_DEMO=1`，datacore :4001），demo/admin
- 复验方式：`node /tmp/ac6-measure.mjs` + `node /tmp/ac6-bytes.mjs`（登录 → GET 切片 spec → POST resolve → 逐节点统计 props 键数与字节）
- 切片：`order_fulfillment_360`（root `so=SO-3391`，534 节点真图）

## 结论

1. **spec 列选声明在位**：9 跳全部带 `project`（`GET /a/v1/ontology/slices/order_fulfillment_360` 实测），
   Equipment 那跳 `equip_used_in.project = [equipId, processId, ctSeconds, availFactor, oeeA, oeeP, oeeQ]`（7 字段）。
2. **深层节点 props 仅含列选字段**：240/240 个 Equipment 节点 props 恰为上述 7 键，**无一越出列选**（⊆ 判据成立）。
3. **与对象仓全量对照**：同节点 `query_objects` 直查 = **18 props**（多出 lineId/baseId/oee_current/equipment_code/
   equipment_type/manufacturer/install_date/status/mtbf/mttr/health_score 共 11 个）——列选真实生效，不是全量透传。

## 字节口径（两个都量，钉死防口径漂移）

| 口径 | 均值 | 分布 |
|---|---|---|
| props-only JSON | **170.0 B** | 240 节点键数分布恰为 {7} |
| 整节点 JSON（含 id/typeKey/objectKey/origin 溯源块） | **464.7 B** | min 443 · max 491 |

> PRD AC6 原文的「每节点均值 448B」落在整节点口径的 443–491 分布内（448 ≈ 某采样点），
> props-only 口径为 170B。两个数都真实，**口径不同** —— 本文件把两个口径都钉死，后续引用不许只挑一个。

## 原始输出（2026-09-12 实测，RC=0）

```
Equipment 节点数=240 · props 键数分布=[7] · 每节点 props 均值=170.0B
样例 props 键: ["equipId","processId","ctSeconds","availFactor","oeeA","oeeP","oeeQ"]
对照（对象仓全量）: 18 props
判据（240/240 Equipment props ⊆ equip_used_in.project 7 字段）: true
整节点 JSON 均值=464.7B · min=443 max=491
```
