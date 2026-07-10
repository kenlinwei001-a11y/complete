# Q30-P1-Q01VERT · Live FDE 证据（接单挤占推演 + 多方案五维比较）——**KILL-MOCK-RED 返工#2·场景默认真触发**

> 真起 datacore(4001)+agentcore(4002)、真 invoke、**真 SEED_DEMO 种子世界**（scale=S·seed=42）。日期 2026-07-10。
> dataMode 显示 `SYNTHETIC`：SEED_DEMO 合成种子世界的诚实标注（求解值为真实确定性计算，非兜底魔数）。
> 启动：
> `PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-wt SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=<svc> node apps/datacore/dist/server.js`
> `PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=<svc> node apps/agentcore/dist/main.js`

---

## ⚠ 返工#2 缘由（reviewer BLOCKED 二次·同根 · KILL-MOCK-RED）+ 治本

**返工#1 残留造假（reviewer 二次 BLOCK）**：返工#1 已把**在手订单量 ×40000 缩放到电芯口径**（`battery.ts ORDER_QTY_CELLS_PER_LOT`·正确），
但**遗漏了 S26 场景卡自身的默认急单量**——`scenarios-catalog.ts:104` 的 `slotPresets.qty` 仍是**旧批次口径的 5000**（未随订单一起换算到电芯口径）。
于是真种子上「场景默认」急单 `qty=5000` → `dailyDemand=ceil(5000/42)=120` 只/日 «« 常州自由日产能 `freeDaily=4555.14` →
`feasibleWithoutDisplacement=true·totalDisplaced=0`（**结构性零挤占**，Q01「会挤占哪些单」在**场景默认路径**上失效）。
返工#1 的旧证据为掩盖此零挤占，改用**手挑 `qty=600000`**（一个任何工厂/场景路径都不会喂的值）强凑挤占 = **造假#5 换马甲**。

**根因定性**：口径混用——**订单量已缩放（电芯口径），但场景默认急单量未缩放（残留批次口径）**。挤占仅在 `qty≥~191316` 只（=常州 6 周窗口自由产能 `4555.14×42`）时出现。

**治本（reviewer Option A·沿本体·非兜底·无手喂）**：把 **S26 场景卡自身的默认急单量校正到与缩放后订单同一电芯口径**——
`scenarios-catalog.ts:104` `slotPresets.qty: 5000 → 520000`。
- **520000 的诚实依据（真实量级·非「压到刚好触发」的手挑最小值）**：520000 只 = `13 批次 × 40000 只/批`，**恰等于种子中最大在手 4680-NCM 单 `SO-3490`（海外车企E·高·13 批次）之量**——取自**真实订单量分布的上沿**（现有 4680-NCM 在手单为 8/10/10/13 批次 = 320k/400k/400k/520k 只），
  即「一张与最大在手 4680-NCM 单同量级的紧急大单」。它约为**触发阈 191316 只的 2.7×**——**明显不是**手挑的「刚好触发」最小值，而是锚定真实订单量级。
- 校正后**场景默认路径**（S26 slotPresets → workflow `{{slots.qty}}` → 求解器）在真种子上**自然产出挤占**，**无需任何 invoke 时手喂**。

**已核**（返工#1 结论沿用·未改）：`Line.capacityDaily` 经 grep 证实**仅 `what_if_displacement` 消费**（非跨求解器共享）；订单量均匀 ×40000 **保比率**（毛利率/达成率/利用率/相对序不变）→ 全量套件字节基线**零漂移**（见 §全量回归）。本次返工#2 **只改 agentcore 一处场景默认量**，未再动 datacore 任何求解器/合成逻辑。

---

## 0️⃣ 场景默认量来源自证（qty 来自 S26 卡·非手打）

`GET http://127.0.0.1:4002/b/v1/scenarios`（agentcore·真下发）→ `items[sNo=S26].presetContext.slotPresets`：

```json
{ "model": "4680-NCM", "qty": 520000, "advancePct": 0.2, "weeks": 6, "baseId": "changzhou" }
```

下方 §① 的 invoke 入参**由脚本从该 slotPresets 直接抽取管道喂入**（`--data-binary @s26preset.json`，`s26preset.json` 程序化提取自 `/b/v1/scenarios` 响应），
**非手打 `qty`**。源定义：`apps/agentcore/src/scenarios-catalog.ts:104`（`card("S26", …, { …, qty: 520000, … })`）。
workflow 侧 `apps/agentcore/src/mocks/seed.ts:356` `qty: "{{slots.qty}}"` 承接该 slot（路径A 真链路一致）。

---

## ① POST /a/v1/solvers/what_if_displacement/invoke （X-Debug-User: demo:admin:admin·HTTP 200·**真种子·场景默认量·零手喂**）

入参 = **S26 场景默认 slotPresets**（`{"model":"4680-NCM","qty":520000,"advancePct":0.2,"weeks":6,"baseId":"changzhou"}`）——
`lines`/`orders` **不手喂**，由 registry `deriveArgs` 从**真本体对象图**（常州线 `capacityDaily/certifiedModels` + 常州在手单五件套）装配。
急单 52 万只（提前 20%·6 周）单线争抢 → **挤占级联**（低 pri `SO-3476` 先挤、仍不足→高 pri `SO-3391` 亦挤）+ 四型方案 + **逐单 ≥2 再方案**：

```json
{
  "dataMode": "SYNTHETIC",
  "newOrder": { "model": "4680-NCM", "qty": 520000, "advancePct": 0.2, "weeks": 6, "dailyDemand": 12381 },
  "base": "changzhou",
  "feasibleWithoutDisplacement": false,
  "freeDaily": 4555.14,
  "shortfallDaily": 7825.86,
  "displacedOrders": [
    {
      "so": "SO-3476", "cust": "储能集成商D", "pri": "中", "qty": 320000,
      "marginPct": 23, "penaltyClause": 0, "substitutable": false, "unitPrice": 389,
      "displaceDays": 26, "penaltyWan": 0,
      "reScheme": "延期 26 天（违约金 0 万）",
      "reSchemes": [
        "延期 26 天（违约金 0 万）",
        "拆单并行（半量转副线·缓 13 天·违约金 0 万）",
        "降级协商（缩量交付·免违约）"
      ]
    },
    {
      "so": "SO-3391", "cust": "整车厂A", "pri": "高", "qty": 320000,
      "marginPct": 7, "penaltyClause": 0.03, "substitutable": true, "unitPrice": 550,
      "displaceDays": 26, "penaltyWan": 528,
      "reScheme": "外协消化（不延期·外协溢价 2640 万）",
      "reSchemes": [
        "外协消化（不延期·外协溢价 2640 万）",
        "延期 26 天（违约金 528 万）",
        "降级协商（缩量交付·免违约）"
      ]
    }
  ],
  "highPriDisplaceDays": 26,
  "totalDisplaced": 2,
  "schemes": [
    { "key": "delay", "name": "延期在手单", "feasible": true, "displacedCount": 2, "promiseDeltaDays": 26, "marginPct": 13.5, "outsourceRatio": 0, "penaltyTotalWan": 528, "cashOccupiedWan": 28600, "note": "位移 2 单" },
    { "key": "outsource", "name": "外协消化", "feasible": true, "displacedCount": 2, "promiseDeltaDays": 0, "marginPct": 11.5, "outsourceRatio": 0.3, "penaltyTotalWan": 0, "cashOccupiedWan": 34540, "note": "外协 2 单腾容" },
    { "key": "split", "name": "拆单分线", "feasible": false, "displacedCount": 2, "promiseDeltaDays": 0, "marginPct": 13, "outsourceRatio": 0, "penaltyTotalWan": 0, "cashOccupiedWan": 28600, "note": "认证线不足 2 条" },
    { "key": "downgrade", "name": "降级部分承接", "feasible": true, "displacedCount": 0, "promiseDeltaDays": 27, "marginPct": 13.5, "outsourceRatio": 0, "penaltyTotalWan": 0, "cashOccupiedWan": 10522.38, "note": "仅接 191316/520000 套" }
  ],
  "schemeCount": 3,
  "recommended": "downgrade",
  "comparison": {
    "columns": ["方案", "交期影响(天)", "毛利率(%)", "挤占单数", "外协比", "现金占用(万)"],
    "rows": [
      ["延期在手单", 26, 13.5, 2, 0, 28600],
      ["外协消化", 0, 11.5, 2, 0.3, 34540],
      ["拆单分线", 0, 13, 2, 0, 28600],
      ["降级部分承接", 27, 13.5, 0, 0, 10522.38]
    ]
  },
  "ruleRefs": ["C34", "C35"],
  "summary": "急单 4680-NCM ×520000（提前 20%·6 周）日产能缺口 7825.86，需挤占 2 单（高优先级最长位移 26 天）；3 个可行方案，推荐「降级部分承接」。",
  "evaluatedRules": [
    { "key": "C34", "name": "挤占优先级不变量", "severity": "BLOCK", "expression": "Displace.highPriDisplaceDays > maxDisplaceDays", "outcome": "BLOCK", "evidence": "命中违规条件（Displace.highPriDisplaceDays > maxDisplaceDays）" },
    { "key": "C35", "name": "重大变更须≥2方案", "severity": "BLOCK", "expression": "PlanSet.schemeCount < minSchemes", "outcome": "PASS", "evidence": "通过（PlanSet.schemeCount < minSchemes）" }
  ],
  "ruleSetVersion": "rsv_fcdb58db",
  "confidence": { "synthetic": true, "stale": false, "measurement": "LIVE", "note": "此决策基于合成数据（非真实接入）" }
}
```

**逐值溯真种子**（`generateBattery(42,"S")`·常州在手 6 单 320k/400k/440k/320k/400k/520k 只·合计 240 万只 → `committedDaily=57142.86`·`freeDaily=61698−57142.86=4555.14`）：
- 被挤 `SO-3476`（储能集成商D·中·4680-LFP·8 批次→320000 只·不可外协·单价 389）先挤（优先级升序·先挤低 pri）；仍不足 → `SO-3391`（整车厂A·高·4680-NCM·8 批次→320000 只·可外协·违约率 0.03·单价 550）亦挤。
- `C34` 真裁决 **BLOCK**——高优先级 `SO-3391` 位移 26 天 > 上限（maxDisplaceDays）→ 不变量**真进求解器结论**并命中（决策支撑信号：此急单会把高优先级单挤过允许上限·需审批介入）。
- `C35` **PASS**（3 可行方案 ≥ 下限 2）。
- **每被挤单 `reSchemes.length=3 (≥2)`·互异·`reScheme===reSchemes[0]`（C4 满足·真种子结果非 fixture）**。

## ② POST /a/v1/solvers/multi_plan_compare/invoke （入参 = 同一 S26 场景默认·HTTP 200·真种子）

**五维比较矩阵**（交期Δ/毛利/挤占数/外协比/现金占用）+ 确定性择优（毛利优先·可行前置）：

```json
{
  "dataMode": "SYNTHETIC",
  "recommendedKey": "downgrade",
  "comparedCount": 3,
  "note": "3 个可行方案可比·推荐「降级部分承接」（毛利优先·可行前置）",
  "matrix": [
    { "key": "delay", "name": "延期在手单", "feasible": true, "promiseDeltaDays": 26, "marginPct": 13.5, "displacedCount": 2, "outsourceRatio": 0, "cashOccupiedWan": 28600 },
    { "key": "outsource", "name": "外协消化", "feasible": true, "promiseDeltaDays": 0, "marginPct": 11.5, "displacedCount": 2, "outsourceRatio": 0.3, "cashOccupiedWan": 34540 },
    { "key": "split", "name": "拆单分线", "feasible": false, "promiseDeltaDays": 0, "marginPct": 13, "displacedCount": 2, "outsourceRatio": 0, "cashOccupiedWan": 28600 },
    { "key": "downgrade", "name": "降级部分承接", "feasible": true, "promiseDeltaDays": 27, "marginPct": 13.5, "displacedCount": 0, "outsourceRatio": 0, "cashOccupiedWan": 10522.38 }
  ]
}
```

## ③ R6 确定性（真跑核验）

- `what_if_displacement`（S26 场景默认入参）同一 server 连续两次 invoke → **JSON 字节一致**（IDENTICAL）。
- **杀 datacore 进程 → 重启（BLOB_DIR 换新目录·全新 SEED_DEMO 重播）→ 同入参再 invoke → 字节一致**（RESEED-IDENTICAL）——种子世界确定性重建。

## 全量回归

- **datacore 全量套件**：`pnpm --filter datacore test`（见 §全量回归结果）。
- 本次返工#2 **仅改 agentcore `scenarios-catalog.ts` 一处默认量**（+ 注释）——**未动 datacore 任何求解器/合成/基线**，故 datacore 字节基线**零漂移**。
- C4 断言（`query30-orch.test.ts ③b`：每被挤单 `reSchemes.length≥2`·互异·`reScheme===reSchemes[0]`）沿用返工#1、本次真种子结果亦满足（见 §① `displacedOrders`）。
