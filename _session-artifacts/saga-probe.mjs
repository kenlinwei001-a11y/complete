// Independent verification probe for WO-L1B-SAGA (imports COMPILED dist, not dev's test).
// Drives real ExternalSystemSandbox stateful ledger; prints before/after value-by-value.
import {
  ExternalSystemSandbox,
  deriveIdempotencyKey,
  reconcileAndCompensate,
  runOutboundSaga,
} from "/tmp/saga-verify/apps/agentcore/dist/workflow/saga.js";
import { SagaRunStateSchema } from "/tmp/saga-verify/packages/contracts/dist/index.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  PASS", msg); } else { fail++; console.log("  ***FAIL***", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}  [got=${JSON.stringify(a)} want=${JSON.stringify(b)}]`);

const NOW = () => "2020-01-01T00:00:00.000Z";
const T = "demo", TASK = "task_probe";
const steps = () => [
  { nodeId: "mes", externalSystem: "MES", operation: "create_work_order", payload: { orderId: "O-9", qty: 42 } },
  { nodeId: "erp", externalSystem: "ERP", operation: "post_cost", payload: { orderId: "O-9", cost: 777 } },
  { nodeId: "wms", externalSystem: "WMS", operation: "goods_issue", payload: { orderId: "O-9", sku: "SKU", qty: 42 } },
];
const kOf = (nodeId, externalSystem, operation, payload) => deriveIdempotencyKey({ tenantId: T, taskId: TASK, nodeId, externalSystem, operation, payload });

// ═══ R6 · deterministic idempotency key (double-derive, key-order independent) ═══
console.log("\n[R6] idempotency key determinism");
{
  const base = { tenantId: T, taskId: TASK, nodeId: "mes", externalSystem: "MES", operation: "create_work_order", payload: { a: 1, b: { c: 2, d: 3 } } };
  const k1 = deriveIdempotencyKey(base);
  const k2 = deriveIdempotencyKey({ ...base, payload: { b: { d: 3, c: 2 }, a: 1 } }); // reordered keys
  ok(k1 === k2, `double-derive byte-identical + key-order independent (${k1})`);
  ok(k1.startsWith("idem_MES_"), "key namespaced by external system");
  ok(deriveIdempotencyKey({ ...base, payload: { a: 1, b: { c: 2, d: 4 } } }) !== k1, "payload change -> key change");
  ok(deriveIdempotencyKey({ ...base, nodeId: "erp" }) !== k1, "node change -> key change");
  ok(deriveIdempotencyKey({ ...base, tenantId: "other" }) !== k1, "tenant change -> key change (R2)");
}

// ═══ CHECK 1 + 2 · CORE: partial failure -> compensation really reverses -> NG2 no half-commit ═══
console.log("\n[CHECK1+2] WMS fails after MES+ERP land -> reconcile-compensate reverses prior steps");
{
  const sb = new ExternalSystemSandbox();
  const s = steps();
  const wmsKey = kOf("wms", "WMS", "goods_issue", { orderId: "O-9", sku: "SKU", qty: 42 });
  sb.injectSubmitFault(wmsKey);
  const run = runOutboundSaga({ sagaId: "sg1", tenantId: T, taskId: TASK, steps: s, sandbox: sb, now: NOW });
  eq(run.status, "PARTIAL_FAILURE", "run status PARTIAL_FAILURE");
  eq(run.failedAtNode, "wms", "failedAtNode=wms");
  eq(run.steps.map(x => `${x.nodeId}:${x.action}`), ["mes:SUBMITTED", "erp:SUBMITTED", "wms:FAILED"], "step actions");
  // BEFORE compensation — value-by-value ledger snapshot
  const beforeActive = sb.activeKeys(), beforeReversed = sb.reversedKeys(), beforeApplied = sb.appliedCount();
  console.log(`    LEDGER BEFORE: appliedCount=${beforeApplied} active=${JSON.stringify(beforeActive.map(k=>k.slice(0,12)))} reversed=${JSON.stringify(beforeReversed)}`);
  eq(beforeApplied, 2, "BEFORE: exactly 2 real landings (MES+ERP); WMS fault never landed");
  eq(beforeActive.length, 2, "BEFORE: 2 active landed keys");
  eq(beforeReversed.length, 0, "BEFORE: 0 reversed");

  const s2calls = [];
  const compensate = async ({ nodeId, action }) => { s2calls.push({ nodeId, kind: action.kind }); return { compensated: true, detail: "S2 approved" }; };
  const comp = await reconcileAndCompensate({ sagaState: run, steps: s, sandbox: sb, compensate, now: NOW });

  // AFTER compensation — value-by-value ledger snapshot
  const afterActive = sb.activeKeys(), afterReversed = sb.reversedKeys();
  console.log(`    LEDGER AFTER:  appliedCount=${sb.appliedCount()} active=${JSON.stringify(afterActive)} reversed=${JSON.stringify(afterReversed.map(k=>k.slice(0,12)))}`);
  eq(comp.status, "COMPENSATED", "run -> COMPENSATED (all consistent)");
  eq(s2calls.map(c => c.nodeId), ["erp", "mes"], "S2 called in REVERSE topological order (erp before mes)");
  eq(s2calls.every(c => c.kind === "REVERSING_ACTION"), true, "every S2 action is REVERSING_ACTION (never silent)");
  eq(comp.compensations.map(c => `${c.nodeId}:${c.compensated}`), ["erp:true", "mes:true"], "both prior steps compensated=true");
  // NG2 core: after compensation, external ledger has ZERO active landings -> no half-commit
  eq(afterActive, [], "NG2: ZERO active landed keys after compensation (no half-commit)");
  eq(afterReversed.length, 2, "NG2: both landed keys REVERSED in external ledger");
  eq(comp.compensations.every(c => c.reconciliation.status === "REVERSED"), true, "reconciliation confirms REVERSED (real ledger truth, not faked)");
  ok(SagaRunStateSchema.safeParse(comp).success, "compensated state passes SagaRunStateSchema (contract)");
}

// ═══ CHECK 3 · compensation re-entrancy / idempotence (dev suite does NOT cover this) ═══
console.log("\n[CHECK3-a] reconcileAndCompensate is re-entrant (retry-safe, no double reversal)");
{
  const sb = new ExternalSystemSandbox();
  const s = steps();
  sb.injectSubmitFault(kOf("wms", "WMS", "goods_issue", { orderId: "O-9", sku: "SKU", qty: 42 }));
  const run = runOutboundSaga({ sagaId: "sg2", tenantId: T, taskId: TASK, steps: s, sandbox: sb, now: NOW });
  let calls1 = 0, calls2 = 0;
  const comp1 = await reconcileAndCompensate({ sagaState: run, steps: s, sandbox: sb, compensate: async () => { calls1++; return { compensated: true }; }, now: NOW });
  const reversedAfter1 = sb.reversedKeys().slice().sort();
  // Re-run compensation on the SAME (immutable) run state -> steps still show SUBMITTED, but ledger already REVERSED
  const comp2 = await reconcileAndCompensate({ sagaState: run, steps: s, sandbox: sb, compensate: async () => { calls2++; return { compensated: true }; }, now: NOW });
  const reversedAfter2 = sb.reversedKeys().slice().sort();
  eq(comp1.status, "COMPENSATED", "1st run COMPENSATED");
  eq(comp2.status, "COMPENSATED", "2nd run still COMPENSATED (idempotent terminal)");
  eq(calls1, 2, "1st run: S2 hook called twice (erp+mes)");
  eq(calls2, 0, "2nd run: S2 hook NEVER called again (no duplicate side-effect)");
  eq(reversedAfter1, reversedAfter2, "reversed-key set unchanged across retry (no double reversal)");
  eq(comp2.compensations.every(c => c.compensated === true && c.reconciliation.status === "REVERSED"), true, "2nd run reports already-reversed as consistent");
}

console.log("\n[CHECK3-b] partial-failure replay: already-landed steps skipped, zero double-landing");
{
  const sb = new ExternalSystemSandbox();
  const s = steps();
  const erpKey = kOf("erp", "ERP", "post_cost", { orderId: "O-9", cost: 777 });
  sb.injectSubmitFault(erpKey);
  const first = runOutboundSaga({ sagaId: "sg3", tenantId: T, taskId: TASK, steps: s, sandbox: sb, now: NOW });
  eq(first.status, "PARTIAL_FAILURE", "first run PARTIAL_FAILURE (ERP fault)");
  eq(first.steps.map(x => `${x.nodeId}:${x.action}`), ["mes:SUBMITTED", "erp:FAILED"], "MES landed, ERP failed, WMS not reached");
  eq(sb.appliedCount(), 1, "only MES landed so far");
  sb.clearSubmitFault(erpKey);
  const replay = runOutboundSaga({ sagaId: "sg3", tenantId: T, taskId: TASK, steps: s, sandbox: sb, now: NOW, resumeFrom: first });
  eq(replay.status, "COMPLETED", "replay COMPLETED");
  eq(replay.resumedCount, 1, "resumedCount incremented");
  eq(replay.steps.map(x => `${x.nodeId}:${x.action}`), ["mes:SKIPPED_ALREADY_APPLIED", "erp:SUBMITTED", "wms:SUBMITTED"], "MES skipped (already landed), ERP+WMS submitted");
  eq(sb.appliedCount(), 3, "ZERO double-landing: 3 keys each landed exactly once (not 4)");
  eq(sb.dedupHitCount(), 0, "MES skipped via reconcile BEFORE submit -> no dedup path hit either");
}

// ═══ CHECK 2 (honesty) · irreversible + UNCERTAIN never faked, never blind-reversed ═══
console.log("\n[CHECK2-honesty-a] no S2 hook -> irreversible steps honestly compensated=false, ledger NOT reversed");
{
  const sb = new ExternalSystemSandbox();
  const s = steps();
  sb.injectSubmitFault(kOf("wms", "WMS", "goods_issue", { orderId: "O-9", sku: "SKU", qty: 42 }));
  const run = runOutboundSaga({ sagaId: "sg4", tenantId: T, taskId: TASK, steps: s, sandbox: sb, now: NOW });
  const res = await reconcileAndCompensate({ sagaState: run, steps: s, sandbox: sb, now: NOW }); // NO compensate hook
  eq(res.status, "RECONCILIATION_PENDING", "no hook -> RECONCILIATION_PENDING (not faked COMPENSATED)");
  eq(res.compensations.every(c => c.compensated === false), true, "every landed step compensated=false (honest)");
  eq(sb.activeKeys().length, 2, "ledger STILL has 2 active landings (not silently reversed)");
  eq(sb.reversedKeys().length, 0, "ledger 0 reversed (no phantom reversal)");
}

console.log("\n[CHECK2-honesty-b] reconcile UNCERTAIN -> pending, never blind-reversed");
{
  const sb = new ExternalSystemSandbox();
  const s = steps();
  sb.injectSubmitFault(kOf("wms", "WMS", "goods_issue", { orderId: "O-9", sku: "SKU", qty: 42 }));
  const run = runOutboundSaga({ sagaId: "sg5", tenantId: T, taskId: TASK, steps: s, sandbox: sb, now: NOW });
  const mesKey = kOf("mes", "MES", "create_work_order", { orderId: "O-9", qty: 42 });
  sb.injectReconcileFault(mesKey); // MES reconcile unreachable
  const res = await reconcileAndCompensate({ sagaState: run, steps: s, sandbox: sb, compensate: async () => ({ compensated: true }), now: NOW });
  eq(res.status, "RECONCILIATION_PENDING", "UNCERTAIN -> RECONCILIATION_PENDING");
  const mesC = res.compensations.find(c => c.nodeId === "mes");
  eq(mesC.compensated, false, "MES compensated=false (uncertain, honest)");
  eq(mesC.reconciliation.status, "UNCERTAIN", "MES reconciliation UNCERTAIN");
  eq(sb.isApplied(mesKey), true, "MES NOT blind-reversed (still applied in ledger)");
  // ERP was reversible & reconcilable -> should have been reversed
  const erpC = res.compensations.find(c => c.nodeId === "erp");
  eq(erpC.compensated, true, "ERP (reconcilable) reversed=true even though MES uncertain");
}

// ═══ CHECK 3-c · applyReversal idempotence (direct) ═══
console.log("\n[CHECK3-c] applyReversal direct idempotence");
{
  const sb = new ExternalSystemSandbox();
  const k = kOf("mes", "MES", "create_work_order", { orderId: "O-9", qty: 42 });
  sb.submit("MES", k, "create_work_order", { orderId: "O-9", qty: 42 });
  eq(sb.applyReversal(k), true, "1st applyReversal returns true");
  eq(sb.applyReversal(k), false, "2nd applyReversal returns false (idempotent, no-op)");
  eq(sb.reversedKeys().length, 1, "still exactly 1 reversed");
  eq(sb.applyReversal("never_submitted"), false, "reversal of never-landed key = false (no phantom)");
}

console.log(`\n══════ PROBE RESULT: ${pass} PASS, ${fail} FAIL ══════`);
process.exit(fail === 0 ? 0 : 1);
