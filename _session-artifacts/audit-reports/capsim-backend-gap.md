# AUDIT: CAPSIM 产能推演 backend-real GAP (target=reference density, honest)

## CENTRAL FINDING: reference FABRICATES density; real backend honestly can't (yet)
Reference riskTarget() (HTML:1714 = 86+hash(base+factor)) forces all 8 bases to 85-92 → all cross multi-factor. Real backend DELETED exactly this (risk.ts:312-316,369-375 RISK-TRAJECTORY-DEFAKE/KILL-MOCK-RED), reads real demand-capacity tightness (56-67) → only bases legitimately >85 cross. So risk_timeline emits 8 cards but only 2 cross (常州 peak91/T+29, 厦门 peak85/T+37); other 6 honest crossDay=null even at horizon=90. **Gap is real-data, not render.**

## Element classification
| ref element | real backend | verdict |
|---|---|---|
| 8 base cards | risk_timeline→8 cards; 12 Base objects exist; bottleneck_matrix→12 rows | EXISTS-REAL (grid=8✓) |
| multi factor-chips/card | 1 factor only (瓶颈工序); risk.ts:478-502 picks one representative | PARTIAL — needs factors[] |
| 20 风险因素点 | Σ=8 (1/card) | PARTIAL 8/20 |
| 14 受影响订单 | 7 unique (only 2 crossing contribute); affected_orders pool=24 | PARTIAL 7/14 |
| 6 涉及客户 | 5 (8 in seed) | PARTIAL |
| T+11 最早越线 | T+29 (honest) | DATA-DRIVEN diff |
| 17 处置计划 rows | 3 (2×C05 primary+1 backup; no C21 — fires only ≤14d cross, none do) | PARTIAL 3/17 |
| Rule C05 | EXISTS-REAL (产线利用率持续越线 WARN PUBLISHED, in appliedRules+ruleRef) | ✓ |
| Rule C21 | EXISTS-REAL (产销平衡偏差 ±10% match; not surfaced, no early cross) | ✓ |
| 数据健康度 banner | C09 rule EXISTS-REAL (数据时延临时降级 staleHours2/0.93→0.9 exact); confidence{synthetic,stale,measurement} on every solver (DATAMODE-UNIFY). BUT stale:false — no live stale signal firing | PARTIAL (mechanism real, no trigger) |
| QA agent/workflow/skill | agt_risk + wf_seed_risk_scan + skl_risk_diagnosis all EXIST-REAL | ✓ |
| 反提月度差异→S&OP | agt_sop_balance + wf_seed_sop_balance + C21 EXIST-REAL | ✓ |
| header 105对象 | ontology graph 65 nodes | PARTIAL 65/105 |
| header 194关系 | 66 edges | MISSING-bulk 66/194 (biggest structural gap) |
| header 4求解器 | 11 solver-nodes | exceeds (ref hardcodes 4) |
| header 10智能体 | graph 4 agent-nodes; registry 17 agents | PARTIAL |
| header 14数据域 | 15 domains | ✓ |

## Why only 瓶颈工序 LIVE: liveTightness (risk.ts:201-255) realDemand ON → 设备OEE/良率波动 source=SYNTHETIC (no real per-base OEE/yield/util measurements in seed) → excluded from decision-red; only demand-driven 瓶颈工序 returns LIVE. bottleneck_matrix entirely MOCK/null.

## PRIORITIZED BUILD LIST (honest, real-backend, zero frontend fake)
### DataCore (where density is produced — the real work)
1. **[P0] Seed real per-base OEE/line-utilization/yield time-series** → 设备OEE/良率波动 return source=LIVE → unlocks multi-factor cards. Files: seed.ts, synthetic/packs/battery-manufacturing.pack.ts, synthetic/tsgen.ts.
2. **[P0] Raise real demand-capacity gap for ≥8 base×factor** (higher DemandSegment p50/p90 or lower per-base capacity) so real tightness legitimately ≥85 → more crossing cards, 风险因素点→~20, orders→~14, customers→~6, 最早越线→~T+11. Verify risk_timeline shows dataMode=LIVE.
3. **[P1] Emit per-card factors[] in risk_timeline** (risk.ts:478-586) — all live+crossing factors, not single representative → multi-chip cards + 风险因素点>8.
4. **[P1] Seed real MaintPlan.week + Shipment{DELAYED,etaDay} per hot base** → event pulses in-window → feeds 17-row plan (C05 primary+backup, ≤14d→C21 反提 row).
5. **[P2] Seed real staleness signal** (source-freshness staleHours>2) → confidence.stale=true → C09 fires → 数据健康度 banner surfaces from real data.
6. **[P2] Enrich ontology graph 65→~105 nodes / 66→~194 edges** (+~128 relations; agent-type nodes→智能体≈10). 母体§2 write-back (铁律0).
### AgentCore (mostly done — verify binding only)
7. [P2] Confirm QA→agt_risk/wf_seed_risk_scan/skl_risk_diagnosis, 反提→agt_sop_balance/C21. All EXIST-REAL, binding verification only.
### Frontend (render only — RiskBoardView.tsx)
8. Render exactly what enriched backend emits: 8 cards multi-chip factors[], KPI 5 from real aggregates, planRows real ruleRef, C09 health banner, QA via agt_risk. NO hardcoded bases/factors/orders/rules. Honest 暂稳/stale:false render truthfully.

**BOTTOM LINE: chain is almost entirely real already (C05/C21/C09/agt_risk/wf/skill/mitigation_select/12 bases/24 orders/8-grid/provenance). Gap = insufficient real tightness in seed + 1 solver change (factors[]) + ontology-graph enrichment. P0-1 & P0-2 are load-bearing; everything downstream falls out once real solver has hot-enough real data.**
