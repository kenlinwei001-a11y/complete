# Q30-P1-Q01VERT · Live FDE 证据（接单挤占推演 + 多方案五维比较）——**KILL-MOCK-RED 返工·真种子**

> 真起 datacore(4001)、真 invoke、**真 SEED_DEMO 种子世界**（scale=S·seed=42）。日期 2026-07-09。
> dataMode 显示 `SYNTHETIC`：SEED_DEMO 合成种子世界的诚实标注（求解值为真实确定性计算，非兜底魔数）。
> 启动：`PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-q30r SEED_DEMO=1 CREDENTIAL_KEY=$(printf '%064d' 1) SERVICE_TOKEN=svc node apps/datacore/dist/server.js`

---

## ⚠ 返工缘由（reviewer BLOCKED · KILL-MOCK-RED 违规）+ 治本

**旧 §① 造假**：此前证据 §① 用**手喂合成入参**（`lines`/`orders`：MX×4200·2100+2100 单）冒充挤占穿透 = 用合成冒充真值（违规）。
**真种子根因**：`Line.capacityDaily=61698 只/日`（旗舰常州线·真拓扑派生·化成/老化取小）远碾压任何现实急单，且**在手单 `qty` 记为个位/两位数**（HTML 24 单批次口径）——二者**相差约 4 个数量级的维度不一致**。真种子上 `POST what_if_displacement {model:"4680-NCM",qty:5000,advancePct:0.2,weeks:6,baseId:"changzhou"}` → `feasibleWithoutDisplacement=true·totalDisplaced=0`，Q01「会挤占哪些单」结构性失效。

**治本（沿本体·非兜底·reviewer 指定优先缩放订单）**：
- **①订单量维度校正**（`apps/datacore/src/synthetic/battery.ts`·`ORDER_QTY_CELLS_PER_LOT=40000`）：把订单量从批次口径换算到与 `capacityDaily` 同一**电芯口径（只/cell）**——`qty_cells = qty × 40000`。使**旗舰常州 4680 线在手单在 6 周窗口自然消费 ~93% 线产能**（57143/61698·常州本为全域瓶颈基地：化成瓶颈 92·在途覆盖<3 天，高负荷符合叙事）→ **现实急单真挤占真在手单**。仅缩放**订单量**；`capacityDaily` 及基地 `formationCapDaily/agingCapDaily`（capacity_rollup / vle-oracle 消费）**不动**（`Line.capacityDaily` 经 grep 证实**仅 `what_if_displacement` 消费**·非跨求解器共享）。`marginPct`/单价/各比率为每单位口径不随量变。
- **②逐被挤单 ≥2 备选**（`apps/datacore/src/solvers/extended.ts`·`freeBy`）：每被挤在手单输出 **`reSchemes[]`（恒 ≥2·互异·确定性派生自本单真值）**：延期 / 拆单并行 / 降级协商（可外协单则外协消化 + 延期 + 降级）。

**"5000 是不现实的急单量"诚实标注**：改后 `qty=5000`（=5000 只 ≈ 一台 4680 线 <5 分钟产量）仍 `feasibleWithoutDisplacement=true·free=4555.14·totalDisplaced=0`——**诚实**：5000 只对 6.17 万只/日的线是可忽略量。下方 §① 用**现实急单量 `qty=600000`（≈60 万只 / ~60MWh 新订单）** 真触发挤占（reviewer 授权 `qty:<realistic>`）。

---

## ① POST /a/v1/solvers/what_if_displacement/invoke （X-Debug-User: demo:admin:admin·HTTP 200·**真种子·零手喂**）

入参 **仅查询语义**：`{"args":{"model":"4680-NCM","qty":600000,"advancePct":0.2,"weeks":6,"baseId":"changzhou"}}`——`lines`/`orders` **不手喂**，由 registry `deriveArgs` 从**真本体对象图**（常州线 `capacityDaily/certifiedModels` + 常州在手单五件套）装配。急单 60 万只（提前 20%·6 周）单线争抢 → **挤占级联**（低pri SO-3476 先挤、仍不足→高pri SO-3391 亦挤）+ 四型方案 + **逐单 ≥2 再方案**：

```json
{
  "dataMode": "SYNTHETIC",
  "newOrder": { "model": "4680-NCM", "qty": 600000, "advancePct": 0.2, "weeks": 6, "dailyDemand": 14286 },
  "base": "changzhou",
  "feasibleWithoutDisplacement": false,
  "freeDaily": 4555.14,
  "shortfallDaily": 9730.86,
  "displacedOrders": [
    {
      "so": "SO-3476", "cust": "储能集成商D", "pri": "中", "qty": 320000,
      "marginPct": 23, "penaltyClause": 0, "substitutable": false, "unitPrice": 389,
      "displaceDays": 23, "penaltyWan": 0,
      "reScheme": "延期 23 天（违约金 0 万）",
      "reSchemes": [
        "延期 23 天（违约金 0 万）",
        "拆单并行（半量转副线·缓 12 天·违约金 0 万）",
        "降级协商（缩量交付·免违约）"
      ]
    },
    {
      "so": "SO-3391", "cust": "整车厂A", "pri": "高", "qty": 320000,
      "marginPct": 7, "penaltyClause": 0.03, "substitutable": true, "unitPrice": 550,
      "displaceDays": 23, "penaltyWan": 528,
      "reScheme": "外协消化（不延期·外协溢价 2640 万）",
      "reSchemes": [
        "外协消化（不延期·外协溢价 2640 万）",
        "延期 23 天（违约金 528 万）",
        "降级协商（缩量交付·免违约）"
      ]
    }
  ],
  "highPriDisplaceDays": 23,
  "totalDisplaced": 2,
  "schemes": [
    { "key": "delay", "name": "延期在手单", "feasible": true, "displacedCount": 2, "promiseDeltaDays": 23, "marginPct": 13.5, "outsourceRatio": 0, "penaltyTotalWan": 528, "cashOccupiedWan": 33000, "note": "位移 2 单" },
    { "key": "outsource", "name": "外协消化", "feasible": true, "displacedCount": 2, "promiseDeltaDays": 0, "marginPct": 11.5, "outsourceRatio": 0.3, "penaltyTotalWan": 0, "cashOccupiedWan": 38940, "note": "外协 2 单腾容" },
    { "key": "split", "name": "拆单分线", "feasible": false, "displacedCount": 2, "promiseDeltaDays": 0, "marginPct": 13, "outsourceRatio": 0, "penaltyTotalWan": 0, "cashOccupiedWan": 33000, "note": "认证线不足 2 条" },
    { "key": "downgrade", "name": "降级部分承接", "feasible": true, "displacedCount": 0, "promiseDeltaDays": 29, "marginPct": 13.5, "outsourceRatio": 0, "penaltyTotalWan": 0, "cashOccupiedWan": 10522.38, "note": "仅接 191316/600000 套" }
  ],
  "schemeCount": 3,
  "recommended": "downgrade",
  "comparison": {
    "columns": ["方案", "交期影响(天)", "毛利率(%)", "挤占单数", "外协比", "现金占用(万)"],
    "rows": [
      ["延期在手单", 23, 13.5, 2, 0, 33000],
      ["外协消化", 0, 11.5, 2, 0.3, 38940],
      ["拆单分线", 0, 13, 2, 0, 33000],
      ["降级部分承接", 29, 13.5, 0, 0, 10522.38]
    ]
  },
  "ruleRefs": ["C34", "C35"],
  "summary": "急单 4680-NCM ×600000（提前 20%·6 周）日产能缺口 9730.86，需挤占 2 单（高优先级最长位移 23 天）；3 个可行方案，推荐「降级部分承接」。",
  "evaluatedRules": [
    { "key": "C34", "name": "挤占优先级不变量", "severity": "BLOCK", "expression": "Displace.highPriDisplaceDays > maxDisplaceDays", "outcome": "BLOCK", "evidence": "命中违规条件（Displace.highPriDisplaceDays > maxDisplaceDays）" },
    { "key": "C35", "name": "重大变更须≥2方案", "severity": "BLOCK", "expression": "PlanSet.schemeCount < minSchemes", "outcome": "PASS", "evidence": "通过（PlanSet.schemeCount < minSchemes）" }
  ],
  "ruleSetVersion": "rsv_fcdb58db",
  "confidence": { "synthetic": true, "stale": false, "measurement": "LIVE", "note": "此决策基于合成数据（非真实接入）" }
}
```

**逐值溯真种子**（`generateBattery(42,"S")`）：常州线 `capacityDaily=61698`·`certifiedModels=[4680-NCM,4680-LFP,方形-NCM]`；被挤 `SO-3476`（储能集成商D·中·4680-LFP·raw 8→320000·不可外协）、`SO-3391`（整车厂A·高·4680-NCM·raw 8→320000·可外协·违约率 0.03·单价 550）。C34 真裁决 **BLOCK**（高优先级位移 23 天 > 上限 5）——规则真进求解器结论。

## ② POST /a/v1/solvers/multi_plan_compare/invoke （schemes = ① 输出四型方案·HTTP 200·真种子）

**五维比较矩阵**（交期Δ/毛利/挤占数/外协比/现金占用）+ 确定性择优（毛利优先·可行前置）：

```json
{
  "dataMode": "SYNTHETIC",
  "recommendedKey": "downgrade",
  "comparedCount": 3,
  "note": "3 个可行方案可比·推荐「降级部分承接」（毛利优先·可行前置）",
  "dims": [
    { "key": "promiseDeltaDays", "label": "交期Δ(天)" },
    { "key": "marginPct", "label": "毛利(%)" },
    { "key": "displacedCount", "label": "挤占数" },
    { "key": "outsourceRatio", "label": "外协比" },
    { "key": "cashOccupiedWan", "label": "现金占用(万)" }
  ],
  "matrix": [
    { "key": "delay", "name": "延期在手单", "feasible": true, "promiseDeltaDays": 23, "marginPct": 13.5, "displacedCount": 2, "outsourceRatio": 0, "cashOccupiedWan": 33000 },
    { "key": "outsource", "name": "外协消化", "feasible": true, "promiseDeltaDays": 0, "marginPct": 11.5, "displacedCount": 2, "outsourceRatio": 0.3, "cashOccupiedWan": 38940 },
    { "key": "split", "name": "拆单分线", "feasible": false, "promiseDeltaDays": 0, "marginPct": 13, "displacedCount": 2, "outsourceRatio": 0, "cashOccupiedWan": 33000 },
    { "key": "downgrade", "name": "降级部分承接", "feasible": true, "promiseDeltaDays": 29, "marginPct": 13.5, "displacedCount": 0, "outsourceRatio": 0, "cashOccupiedWan": 10522.38 }
  ]
}
```

## ③ R6 确定性（真跑核验）

- `what_if_displacement` 同入参连续两次 invoke → **JSON 字节一致**（IDENTICAL）。
- `generateBattery(42,"S")` 连续两次生成 orders → **字节一致**（SEED-ORDERS-IDENTICAL）。

## 全量回归

- **datacore 全量套件**：`pnpm --filter datacore test` → **1031 passed · 15 skipped · 0 failed**（181 文件通过·含新增 C4 断言 ③b）。
- 均匀缩放订单量（×40000）**保比率**（毛利率/达成率/利用率/相对序均不变）→ 现有字节基线**零漂移**（无一被打破）。
- 新增测试：`query30-orch.test.ts ③b`——每被挤单 `reSchemes.length≥2`·互异·`reScheme===reSchemes[0]`（C4）。
