# AUDIT: dark-shipped upgrade engines — wiring status @ 059874f0 (=d7bbe86a+PM-notes)

**BIG CORRECTION: the 07-11 CHAPTER-TEST-MATRIX is STALE** — it snapshotted earlier commit d9b2b44 (cited in matrix) BEFORE the L1/L2/L1.5 wiring commits (a5923b39, e398c0ff, f3286262, 04f3d7a5, 9702527e) merged. Those WOs (L1A-3/L1B-4-5/L2-4-5/L1.5-3) are now DONE in work-queue.json + verified ancestors of HEAD.

**All 4 engines moved from "dark-shipped/zero-callsite/404" → GENUINELY WIRED into real request paths. BUT all gated OFF by default (defaultOn:false + QOS_* env unset). "usable" = flip-gate-and-it-works-e2e (proven), not on-in-prod.**

| engine | built | WIRED call site | gate (OFF default) | mode |
|---|---|---|---|---|
| L1-A 需求图 buildRequirementGraph | YES | orchestrator.ts:817 (from QOS :734 sideband, persists :818); read GET /b/v1/queries/:taskId/requirement-graph | `growth.requirement_graph` + QOS_REQUIREMENT_GRAPH | observation (never changes answer) |
| L1-B synthesizePlan + DAG runtime | YES | shadow orch:852, serve :898→:1294→executePathATail→runWorkflowDag (engine.ts:448). DAG=dag-executor.ts REAL parallel Kahn + gateways EXCL/PAR/INCL + durable checkpoint + retry + reverse compensation + Saga(saga.ts). NOT serial. | `qos.exec_planner` + `qos.workflow_dag` (+QOS_EXEC_PLANNER) | **serve mode CAN change execution** (staged intent whitelist); else serial byte-parity |
| L2 决策内核 | YES (datacore decision/kernel.ts +~30 tests) | server.ts:280 startDecisionKernel called :379 post-answer → datacore POST /a/v1/queries/:taskId/decision-package (app.ts:3538 real solvers); adopt正门 :3566 B→A creates Decision+ActionDraft(R4)+pg TOCTOU lock | `decision.kernel` (double-reg non-fail-open) + QOS_DECISION_KERNEL | observation; 脑裂 Ch35 now resolved |
| L1.5 CBR/enterprise memory | YES (+50 seed cases) | INGEST app.ts:389 caseIngest.ingestFromDecision→decision_cases(LEARNED)+decision_case.learned event. REUSE tool retrieve_similar_cases(registry.ts:224)→datacore POST /a/v1/memory/cases/retrieve-similar(app.ts:3506). Real ingest→case→reuse loop, NOT read-only-static. | `memory.cbr`/`memory.cbr_retrieve` + QOS_CBR_INGEST/RETRIEVAL | Ch17 "无摄取·库空" now built |

**Verdict:** zero still dark-shipped-with-no-callsite; all 4 real-but-dormant (gated OFF). Default runtime unchanged, endpoints 404 when off. Only L1-B has a serve mode that alters execution; L1-A/L2/L1.5 are pure observation-mode (never alter answer even ON).
