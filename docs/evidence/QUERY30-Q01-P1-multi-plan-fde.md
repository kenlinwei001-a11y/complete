# Q30-P1-Q01VERT · Live FDE 证据（接单挤占推演 + 多方案五维比较 + S26 NL 路由）

> 真起 datacore(4001)+agentcore(4102)、真 invoke、真 NL 路由确认。日期 2026-07-09。**无密钥**。
> dataMode 显示 `SYNTHETIC`：SEED_DEMO 合成种子世界的诚实标注（求解值为真实确定性计算，非兜底魔数）。

## ① POST /a/v1/solvers/what_if_displacement/invoke （X-Debug-User: demo:admin:admin·HTTP 200）
急单 MX×4200（提前20%·6周）单线争抢 → **挤占级联**（低pri A2 先挤、仍不足→高pri A1 亦挤）+ 四型方案 + 逐单再方案：

```json
{
  "feasibleWithoutDisplacement": false,
  "shortfallDaily": 80,
  "displacedOrders": [
    {
      "so": "A2",
      "cust": "客户2",
      "pri": "低",
      "qty": 2100,
      "marginPct": 20,
      "penaltyClause": 0.05,
      "substitutable": false,
      "unitPrice": 500,
      "displaceDays": 21,
      "penaltyWan": 5.25,
      "reScheme": "延期 21 天（违约金 5.25 万）"
    },
    {
      "so": "A1",
      "cust": "客户1",
      "pri": "高",
      "qty": 2100,
      "marginPct": 10,
      "penaltyClause": 0.1,
      "substitutable": false,
      "unitPrice": 500,
      "displaceDays": 21,
      "penaltyWan": 10.5,
      "reScheme": "延期 21 天（违约金 10.5 万）"
    }
  ],
  "highPriDisplaceDays": 21,
  "schemes": [
    {
      "key": "delay",
      "name": "延期在手单",
      "feasible": true,
      "displacedCount": 2,
      "promiseDeltaDays": 21,
      "marginPct": 13.5,
      "outsourceRatio": 0,
      "penaltyTotalWan": 15.75,
      "cashOccupiedWan": 252,
      "note": "位移 2 单"
    },
    {
      "key": "outsource",
      "name": "外协消化",
      "feasible": false,
      "displacedCount": 0,
      "promiseDeltaDays": 0,
      "marginPct": 11.5,
      "outsourceRatio": 0,
      "penaltyTotalWan": 0,
      "cashOccupiedWan": 252,
      "note": "可外协单不足"
    },
    {
      "key": "split",
      "name": "拆单分线",
      "feasible": false,
      "displacedCount": 2,
      "promiseDeltaDays": 0,
      "marginPct": 13,
      "outsourceRatio": 0,
      "penaltyTotalWan": 0,
      "cashOccupiedWan": 252,
      "note": "认证线不足 2 条"
    },
    {
      "key": "downgrade",
      "name": "降级部分承接",
      "feasible": true,
      "displacedCount": 0,
      "promiseDeltaDays": 34,
      "marginPct": 13.5,
      "outsourceRatio": 0,
      "penaltyTotalWan": 0,
      "cashOccupiedWan": 50.4,
      "note": "仅接 840/4200 套"
    }
  ],
  "schemeCount": 2,
  "recommended": "downgrade",
  "comparison": {
    "columns": [
      "方案",
      "交期影响(天)",
      "毛利率(%)",
      "挤占单数",
      "外协比",
      "现金占用(万)"
    ],
    "rows": [
      [
        "延期在手单",
        21,
        13.5,
        2,
        0,
        252
      ],
      [
        "外协消化",
        0,
        11.5,
        0,
        0,
        252
      ],
      [
        "拆单分线",
        0,
        13,
        2,
        0,
        252
      ],
      [
        "降级部分承接",
        34,
        13.5,
        0,
        0,
        50.4
      ]
    ]
  }
}
```

## ② POST /a/v1/solvers/multi_plan_compare/invoke （schemes = ① 输出四型方案·HTTP 200）
**五维比较矩阵**（交期Δ/毛利/挤占数/外协比/现金占用）+ 确定性择优（毛利优先·可行前置）：

```json
{
  "dataMode": "SYNTHETIC",
  "matrix": [
    {
      "key": "delay",
      "name": "延期在手单",
      "feasible": true,
      "promiseDeltaDays": 21,
      "marginPct": 13.5,
      "displacedCount": 2,
      "outsourceRatio": 0,
      "cashOccupiedWan": 252
    },
    {
      "key": "outsource",
      "name": "外协消化",
      "feasible": false,
      "promiseDeltaDays": 0,
      "marginPct": 11.5,
      "displacedCount": 0,
      "outsourceRatio": 0,
      "cashOccupiedWan": 252
    },
    {
      "key": "split",
      "name": "拆单分线",
      "feasible": false,
      "promiseDeltaDays": 0,
      "marginPct": 13,
      "displacedCount": 2,
      "outsourceRatio": 0,
      "cashOccupiedWan": 252
    },
    {
      "key": "downgrade",
      "name": "降级部分承接",
      "feasible": true,
      "promiseDeltaDays": 34,
      "marginPct": 13.5,
      "displacedCount": 0,
      "outsourceRatio": 0,
      "cashOccupiedWan": 50.4
    }
  ],
  "recommendedKey": "downgrade",
  "dims": [
    {
      "key": "promiseDeltaDays",
      "label": "交期Δ(天)"
    },
    {
      "key": "marginPct",
      "label": "毛利(%)"
    },
    {
      "key": "displacedCount",
      "label": "挤占数"
    },
    {
      "key": "outsourceRatio",
      "label": "外协比"
    },
    {
      "key": "cashOccupiedWan",
      "label": "现金占用(万)"
    }
  ],
  "comparedCount": 2,
  "note": "2 个可行方案可比·推荐「降级部分承接」（毛利优先·可行前置）",
  "ruleSetVersion": "rsv_fcdb58db",
  "confidence": {
    "synthetic": true,
    "stale": false,
    "measurement": "LIVE",
    "note": "此决策基于合成数据（非真实接入）"
  }
}
```

## ③ multi_plan_compare 独立派发（无 schemes → deriveArgs 复用 what_if_displacement 自对象图装配）
`POST /a/v1/solvers/multi_plan_compare/invoke {"args":{"model":"4680-NCM","qty":5000,"weeks":6,"advancePct":0.2,"baseId":"changzhou"}}` →
HTTP 200 · comparedCount=3 · recommendedKey=delay · matrixRows=4 · dataMode=SYNTHETIC（证纯聚合层可独立 /invoke·非只在编排内）。

## ④ GET /b/v1/scenarios → S26 接单挤占推演（NL 入 QOS 场景路由·HTTP 200）
total scenarios = **26**（原 25 + S26）。S26 卡：
```json
{ "scenarioKey": "S26", "name": "接单挤占推演", "intentKey": "what_if_displacement_q",
  "solver": "what_if_displacement",
  "triggerQuestion": "4680-NCM 加 20% 六周插进来能不能接·会挤占哪些单·有哪些方案？" }
```
接单全链推演 workflow（plan_what_if_displacement_q_v1）：s1 what_if_displacement → s2 multi_plan_compare（链式 {{steps.s1.output.data.schemes}}）→ render 两块 solver_summary（真实字段投影）。

## 全量测试
- datacore full suite / agentcore full suite：见提交说明（均全绿；evals 场景套件 25→26·求解器目录 +1）。
