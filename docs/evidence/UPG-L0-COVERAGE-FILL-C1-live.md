# UPG-L0-COVERAGE-FILL · C1 live NL evidence (causal_attribution)
date: 2026-07-09T16:50:41Z
services: datacore :4011 (SEED_DEMO), agentcore :4112 (memory) — own worktree build; no secrets captured
query(NL): 为什么这项经营指标越线恶化？根因主驱动是哪个？
taskId: task_01KX3WJJD23S3C4E202MSCQBCV

## terminal state (path A · not Path B)
{
  "status": "COMPLETED",
  "path": "WORKFLOW",
  "classification": {
    "candidates": [
      {
        "intentKey": "causal_attribution_q",
        "confidence": 1
      }
    ],
    "outOfCatalog": false,
    "extractedSlots": {},
    "latencyMs": 0,
    "model": "deterministic:example-match"
  },
  "trustLevel": "VERIFIED_WORKFLOW",
  "blockTypes": [
    "text",
    "kpi",
    "kpi",
    "kpi",
    "kpi",
    "kpi",
    "table",
    "table",
    "text",
    "text"
  ]
}

## answer attribution chain (real fields · Metric.actual/floorVal + MaterialBalance.gapTon)
[text] 1 项「Metric.actual」越线（最重「物料保障率」缺口 0.4，实测 94.6 vs 阈值 95） ⟦ref⟧；根因主驱动「三元正极」（gapTon 654·占 74.7%），沿 2 个真实驱动对象量化取证 ⟦ref⟧
[kpi] Crossed Count = "1"
[kpi] Total Gap = "0.4"
[kpi] Direction = "below"
[kpi] Value Field = "actual"
[kpi] Driver Field = "gapTon"
[table] rows=1 [["kpi-material","物料保障率",94.6,95,0.4,0.42,"是",0.9957894736842104]]
[table] rows=2 [["三元正极",654,1,0.7466],["电解液",222,1,0.2534]]
[text] 口径与来源：数据模式：SYNTHETIC；置信度：LIVE·此决策基于合成数据（非真实接入）。
[text] **方法论口径**（确定性组装口·非模型注入）
〔风险诊断方法论〕按风险诊断法解读：先定位风险时序越线峰值，再分层排除根因（齐套/良率/检修），最后按交期/齐套/良率归类受影响订单并量化敞口。
  判定口径：越线峰值时点；根因分层（齐套/良率/检修）；受影响订单归因分类；营收/毛利敞口量化。

## honest note: dataMode SYNTHETIC = demo seed 合成数据 (非捏造·非兜底)；每个归因数溯源真字段。
