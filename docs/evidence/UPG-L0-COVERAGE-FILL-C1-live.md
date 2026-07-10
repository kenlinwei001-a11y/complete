# UPG-L0-COVERAGE-FILL · C1 live NL evidence (causal_attribution · 原痛点问句)

返工要点（用户钉死）：**用原痛点问句**「常州物料齐套为什么这天越线」跑真 seed 真求解器 —— 不用 S27 同义句
「为什么这项经营指标越线恶化」自匹配，不手喂合成入参。该问句分类到 **risk_root_cause**（S03），此前 AGENT_FIRST
无 LLM 恒 Path B FAILED；本单改 WORKFLOW_FIRST 并重定向到 path-A 通用 `causal_attribution` 求解器。

date: 2026-07-10
services: datacore :4501 (SEED_DEMO·own worktree build), agentcore :4502 (memory·DATACORE_BASE_URL=:4501) — no secrets captured (kill by PID)
query(NL·**原问句**): 常州物料齐套为什么这天越线
context: { view: "dash", selectedObjects: [], filters: {} }  ← 空 selectedObjects（无手喂锚点）
packageId: pkg_battery_manufacturing
taskId: task_01KX4Z4YR2WXX7W95Y3QCTP16B

## terminal state (path A · **not Path B**)
{
  "status": "COMPLETED",
  "path": "WORKFLOW",
  "classification": {
    "candidates": [{ "intentKey": "risk_root_cause", "confidence": 1 }],
    "outOfCatalog": false,
    "extractedSlots": {},
    "latencyMs": 0,
    "model": "deterministic:example-match"
  },
  "blockTypes": ["text","text","kpi","kpi","kpi","kpi","kpi","table","table","text","text"]
}

## answer attribution chain (real fields · Metric.actual/floorVal + MaterialBalance.gapTon·按 material 聚合)
[text] 物料齐套越线根因归因（causal_attribution 求解器·读真对象图）：
[text] 1 项「Metric.actual」越线（最重「物料保障率」缺口 0.4，实测 94.6 vs 阈值 95） ⟦ref⟧；根因主驱动「三元正极」（gapTon 654·占 74.7%），沿 2 个真实驱动对象量化取证 ⟦ref⟧
[kpi] Crossed Count = "1"
[kpi] Total Gap = "0.4"
[kpi] Direction = "below"
[kpi] Value Field = "actual"
[kpi] Driver Field = "gapTon"
[table] crossed rows=1 [["kpi-material","物料保障率",94.6,95,0.4,0.42,"是",0.9957894736842104]]
[table] rootDrivers rows=2 [["三元正极",654,1,0.7466],["电解液",222,1,0.2534]]
[text] 口径与来源：数据模式：SYNTHETIC；置信度：LIVE·此决策基于合成数据（非真实接入）。
[text] **方法论口径**〔风险诊断方法论〕先定位风险时序越线峰值，再分层排除根因（齐套/良率/检修）…

## 根因链真实性（KILL-MOCK-RED / R6）
- 越线目标 = Metric「物料保障率」actual 94.6 < floorVal 95（真 Metric 对象·物料齐套口径）。
- 根因主驱动 = MaterialBalance.gapTon 按 material 聚合：三元正极 654（占 74.7%）+ 电解液 222（占 25.3%）——真实驱动对象取证。
- dataMode SYNTHETIC = demo seed 合成数据（非捏造·非兜底值）；每个归因数溯源真字段（gapTon）。

## 复现（从 diff 可复现·R6）
1. intent-mode.ts: risk_root_cause AGENT_FIRST→WORKFLOW_FIRST。
2. scenarios-catalog.ts S03: solver risk_timeline→causal_attribution + slotPresets 映射为求解器真入参。
3. seed.ts plan_risk_root_cause: resolve_slice(base_risk_profile)→invoke_solver(causal_attribution) + base 槽 required→optional。
