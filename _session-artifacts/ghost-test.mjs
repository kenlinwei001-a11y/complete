// Adversarial red-path proof for solver-coverage:check.
// Uses the EXACT compiled functions the real gate imports, injects a ghost
// solverKey into the live SOLVER_COVERAGE, and replays the gate's ghost/exit logic.
import { SOLVER_COVERAGE, coveredSolverKeys, ghostSolverKeys } from "/home/user/complete/packages/contracts/dist/index.js";
import { REGISTRY_SOLVER_KEYS } from "/home/user/complete/apps/datacore/dist/solvers/solver-registry.js";

// Baseline (matrix as-shipped): must be zero ghosts.
const before = ghostSolverKeys(REGISTRY_SOLVER_KEYS);
console.log("ghosts BEFORE injection:", JSON.stringify(before), "(refCount=" + coveredSolverKeys().length + ")");

// Inject a phantom solverKey that is NOT in SOLVER_REGISTRY.
SOLVER_COVERAGE["adversary_probe_class"] = ["totally_fake_ghost_solver"];

const after = ghostSolverKeys(REGISTRY_SOLVER_KEYS);
console.log("ghosts AFTER injecting 'totally_fake_ghost_solver':", JSON.stringify(after));

// Replay the gate's exact red logic (scripts/check-solver-coverage.mjs lines 42-68).
let red = false;
if (after.length > 0) red = true;
console.log("gate would set red =", red, "-> process.exit(" + (red ? 1 : 0) + ")");
process.exit(red ? 1 : 0);
