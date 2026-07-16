# AUDIT: Agents & Multi-Agent — REQUIRED vs BUILT @ HEAD (user's named concern)

## Direct answer: NO agt_ceo, NO base-planner agent — but nuanced
- **"CEO"** = design persona (human decision-maker, DESIGN-maven-mode-CEO-daily-10q.md), NOT a spec'd AI agent. Agent-equivalent = "Executive/Chief" role in 5-role spec → NOT BUILT.
- **"base planner/基地经理"** = demo login role (base_manager:常州), maps to Planning/SupplyChain role agents → NOT BUILT as agents.
- What IS built: 17 scene-bound assistant agents (real/published/live) — broader than single agent, DIFFERENT shape than spec's role-based coordinated team.

## Required → built
| Required | Source | Built? | Evidence |
|---|---|---|---|
| Ref header "10 智能体" (Orchestrator+9 specialists) | reference topology | NO (narrative) — most are tools inside single-agent loop | capacity-sim-obsidian-target.html:1156-1176 |
| 岗位化 5-Agent (Planning/SupplyChain/Manufacturing/Finance/Executive) | Ch51.6 | MISSING | SUPPLEMENT_Chapter51:9 |
| 5 typed Agents (Planning/DataAnalyst/Optimization/Simulation/Decision) | V2-1-139 | MISSING | LEDGER-V2-1.md:145 |
| Chief/CEO-level agent (角色化AI员工) | Ch63/Ch34 | NOT-BUILT | CHAPTER-TEST-MATRIX:96 |
| Multi-Agent orchestration/Coordinator | Ch51.19-21/V2-1-155/Ch34 | MISSING | SUPPLEMENT_Chapter51:16 |
| A2A protocol (bidirectional) | V2-1-156/Ch34 | STUB — external interop only, no internal team, handoff=404 | LEDGER-V2-1.md:162 |
| invoke_agent workflow step | Platform §8.2 | STUB — executor returns UNSUPPORTED_STEP | apps/agentcore/src/workflow/executor.ts:374-377 |
| Agent 3-layer memory/Learning | Ch51.16-18 | STUB (OMISSION★) — read-only, no cross-session (G-3b) | SUPPLEMENT_Chapter51:15 |
| Safety agent (AI-native security/agent identity/injection defense) | Ch65 | MISSING | CHAPTER-TEST-MATRIX:26 |
| Generic B1 Agent registry (agt_ prefix, CRUD/publish, scope) | Platform §8.1 | YES real — but schema has NO role/persona/coordinator field | packages/contracts/src/agentcore.ts:42-62; GET /b/v1/agents |
| 17 scene assistant agents | WO-SCENE-B/C/D (not a PRD req) | YES real (all PUBLISHED live) | apps/agentcore/src/mocks/seed.ts:1182+; agents/universal.ts:18 |

## 17 live agents (GET /b/v1/agents, tenant demo)
agt_universal, agt_seed_analyst, agt_seed_explore, agt_plan_audit, agt_dash, agt_risk, agt_order, agt_sop_balance, agt_plan_generate, agt_project_sim, agt_review, agt_annual, agt_quarterly, agt_order_chain, agt_geo_map, agt_order_advisor, agt_supply_risk_control. All single scene-bound assistants (one per dashboard view), real systemPrompt/tools/scope/budget. None is a role-based org persona; none coordinates a team.

## Verdict
Of specifically-required role & multi-agent items, essentially ALL missing/stub: 5-role AI employees (incl Executive/CEO-equiv), Chief/CEO agent, base-planner role agent, Coordinator, bidirectional A2A, 3-layer agent memory, Safety agent. NOT a wholesale omission — 17 real agents exceed a naive single-agent reading, but they're scene assistants not the spec'd role team. To make "10智能体" real: master Orchestrator plan→delegate→assemble across specialist sub-agents (Diagnostician/Learning/Action as first-class agents), internal A2A/handoff + Coordinator (today invoke_agent=UNSUPPORTED, handoff=404), 3-layer cross-session memory (today read-only G-3b), first-class Safety agent.
