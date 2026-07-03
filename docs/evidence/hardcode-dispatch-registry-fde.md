# HARDCODE-DISPATCH-REGISTRY · 真起服务 FDE 逐值对照（registry 派发·语义零变证）

> 2026-07-03T12:12:48Z · datacore in-memory (SEED_DEMO=1·tenant demo) · 端口 4051 · X-Debug-User admin
> 覆盖三派发路由：context（loadContext+compute）/ graph（invokeRaw registry 拦截+graphHandlers）/ extended（compute default+EXTENDED_REGISTRY）。
> 每例经 SOLVER_REGISTRY 派发出真实计算结果（非 SOLVER_NOT_FOUND），dataMode 诚实位在位——证 registry 派发 == 重构前行为。

## [context] capacity_rollup  (HTTP 200)
- args: `{}`
- dataMode=SYNTHETIC topkeys=bases,ruleRefs,evaluatedRules,ruleSetVersion,dataMode,confidence
```json
{
  "data": {
    "bases": [
      {
        "baseId": "changzhou",
        "base": "常州",
        "dailyCells": 57490.59,
        "weeklyWan": 0.4192,
        "lines": [
          {
            "key": "LINE-changzhou",
            "name": "常州一号线",
            "capacityPerDay": 57490.59,
            "formula": "产线产能 = min(串行段) ⊕ 并行段汇合（化成/老化）—— C02 串/并口径",
            "inputs": [
              {
                "name": "serialMin",
                "value": 65032.83
              },
              {
                "name": "formationCap",
                "value": 57490.59
              },
              {
                "name": "agingCap",
                "value": 58868.4
```

## [context] risk_timeline  (HTTP 200)
- args: `{}`
- dataMode=MOCK topkeys=horizon,threshold,dataMode,cards,mitigationLibrary,planRows
```json
{
  "data": {
    "horizon": 30,
    "threshold": 85,
    "dataMode": "MOCK",
    "cards": [],
    "mitigationLibrary": {
      "物料齐套": [
        {
          "key": "early_stock",
          "name": "提前备料",
          "eff": 12,
          "tn": 2,
          "cost": "中",
          "risk": "低"
        },
        {
          "key": "alt_supplier",
          "name": "备选供应商切换",
          "eff": 9,
          "tn": 5,
          "cost": "高",
          "risk": "中"
        },
        {
          "key": "air_freight",
```

## [context] plan_audit  (HTTP 200)
- args: `{"dem":100,"seg_pas":40,"seg_ess":30,"seg_com":30,"sup":95,"ltaCov":0.8,"kitGap":5,"gmTarget":0.15,"cashCushion":60,"capex":12}`
- dataMode=SYNTHETIC topkeys=H,M,S,score,verdict,gmStruct
```json
{
  "data": {
    "H": [
      {
        "id": "X02",
        "title": "产销缺口",
        "why": "需求 100 − 供给 95 = 缺口 5 万套，超过硬阈值 2 万套",
        "fix": {
          "label": "夜班+加急采购供给增量包",
          "patch": {
            "sup": 100
          }
        },
        "kind": "产销"
      }
    ],
    "M": [
      {
        "id": "X04",
        "title": "物料齐套",
        "ruleRef": "C06/C16",
        "why": "关键材料缺口 5 吨（>0），需关注",
        "fix": {
          "label": "加急采购 200 吨",
          "patch": {
            "kitGap": 0
```

## [graph] cockpit_kpi  (HTTP 200)
- args: `{}`
- dataMode=SYNTHETIC topkeys=supplyV7,revAttainPct,utilPeak,aopBaseRev,cashCushion,dataMode
```json
{
  "data": {
    "supplyV7": 130,
    "revAttainPct": 102,
    "utilPeak": 90,
    "aopBaseRev": 13.9,
    "cashCushion": 58,
    "dataMode": "SYNTHETIC",
    "confidence": {
      "synthetic": true,
      "stale": false,
      "measurement": "LIVE",
      "note": "此决策基于合成数据（非真实接入）"
    }
  },
  "snapshotVersion": "1.2"
}
```

## [graph] metric_rollup  (HTTP 200)
- args: `{}`
- dataMode=SYNTHETIC topkeys=metrics,missCount,byLevel,summary,dataMode,confidence
```json
{
  "data": {
    "metrics": [
      {
        "metricId": "kpi-attain",
        "key": "demand_attain",
        "name": "需求达成率",
        "unit": "%",
        "level": "op",
        "category": "scale",
        "target": 100,
        "actual": 95.3,
        "delta": -4.7,
        "miss": false,
        "floorVal": 95,
        "ksfRef": "ksf-bal",
        "ownerRef": "prin-plan",
        "chainKey": "rc-scale-demand"
      },
      {
        "metricId": "kpi-margin",
        "key": "gm_rate",
        "name": "毛利率",
        "unit": "%",
        "level": "op",
        "category": "profit",
```

## [graph] shared_bottleneck  (HTTP 200)
- args: `{"resourceType":"Process","sharedByType":"Order","viaField":"process","capacityField":"capacity","demandField":"qty"}`
- dataMode=SYNTHETIC topkeys=bottlenecks,contention,downgraded,summary,dataMode,confidence
```json
{
  "data": {
    "bottlenecks": [],
    "contention": [],
    "downgraded": [],
    "summary": "0 个共享瓶颈,0 张单争用,0 张被降级",
    "dataMode": "SYNTHETIC",
    "confidence": {
      "synthetic": true,
      "stale": false,
      "measurement": "LIVE",
      "note": "此决策基于合成数据（非真实接入）"
    }
  },
  "snapshotVersion": "1.2"
}
```

## [extended] quote_margin  (HTTP 200)
- args: `{"price":100,"bom":[{"unit":1,"spotPrice":40,"processRate":0.25}],"mfgRate":0.1,"logistics":5,"segmentFloor":0.1}`
- dataMode=SYNTHETIC topkeys=dataMode,margin,floor,diff,verdict,breakdown
```json
{
  "data": {
    "dataMode": "SYNTHETIC",
    "margin": 0.35,
    "floor": 0.1,
    "diff": 0.25,
    "verdict": "过线",
    "breakdown": {
      "bomCost": 50,
      "mfg": 10,
      "logistics": 5,
      "price": 100
    },
    "ruleRefs": [
      "C15",
      "C24"
    ],
    "evaluatedRules": [
      {
        "key": "C15",
        "name": "经营毛利底线",
        "severity": "BLOCK",
        "expression": "Order.marginPct < Order.floorPct",
        "outcome": "PASS",
        "evidence": "通过（Order.marginPct < Order.floorPct）"
      },
```

## [extended] carbon_footprint  (HTTP 200)
- args: `{"modelId":"M1","baseName":"B1","materials":[{"material":"pos","unit":1,"factor":50}],"processes":[{"process":"coat","energy":2,"gridFactor":15}],"euThreshold":70}`
- dataMode=SYNTHETIC topkeys=dataMode,modelId,baseName,total,breakdown,threshold
```json
{
  "data": {
    "dataMode": "SYNTHETIC",
    "modelId": "M1",
    "baseName": "B1",
    "total": 80,
    "breakdown": {
      "materialCarbon": 50,
      "energyCarbon": 30
    },
    "threshold": 70,
    "verdict": "超标",
    "maxLever": "物料:pos",
    "ruleRefs": [
      "C33"
    ],
    "evaluatedRules": [
      {
        "key": "C33",
        "name": "碳护照前置",
        "severity": "BLOCK",
        "expression": "NOT (Order.destination == 'EU' IMPLIES Order.carbonFootprint <= Order.euCarbonThreshold)",
        "outcome": "PASS",
        "evidence": "通过（NOT (Order.destination == 'EU' IMPLIES Order.carbonFootprint <= Order.euCarbonThreshold)）"
      }
    ],
```

## [extended] mitigation_select  (HTTP 200)
- args: `{"factor":"物料齐套","baseName":"常州","tightness":100}`
- dataMode=SYNTHETIC topkeys=dataMode,factor,baseName,urgency,plans,recommended
```json
{
  "data": {
    "dataMode": "SYNTHETIC",
    "factor": "物料齐套",
    "baseName": "常州",
    "urgency": 1,
    "plans": [
      {
        "key": "air_freight",
        "name": "空运补料",
        "eff": 15,
        "tn": 1,
        "cost": "极高",
        "risk": "低",
        "costRank": 4,
        "score": 3.75
      },
      {
        "key": "early_stock",
        "name": "提前备料",
        "eff": 12,
        "tn": 2,
        "cost": "中",
        "risk": "低",
        "costRank": 2,
        "score": 3
```

