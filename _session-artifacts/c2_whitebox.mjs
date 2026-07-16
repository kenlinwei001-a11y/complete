// Independent white-box C2 sensitivity: boot REAL seeded context from compiled dist,
// mutate REAL DemandSegment.p50/p90 in-memory, re-run the REAL demandCapacityTightness/liveTightness.
process.env.SEED_DEMO = "1";
process.env.JWT_SECRET = "dev";
process.env.BLOB_DIR = "/tmp/blobs-wb";
process.env.CREDENTIAL_KEY = "a".repeat(64);
process.env.LOG_LEVEL = "silent";
const D = "/home/user/complete/apps/datacore/dist";
const { loadConfig } = await import(`${D}/config.js`);
const { createMemoryRepos } = await import(`${D}/repo/memory.js`);
const { LocalFsBlobStore } = await import(`${D}/blob.js`);
const { createLlmClient } = await import(`${D}/llm.js`);
const { buildApp } = await import(`${D}/app.js`);
const { seedDemo, seedDemoSynthetic, seedDemoSopVersion } = await import(`${D}/seed.js`);
const { demandCapacityTightness, liveTightness } = await import(`${D}/solvers/risk.js`);

const config = loadConfig();
const repos = createMemoryRepos();
const blob = new LocalFsBlobStore(config.BLOB_DIR);
const llm = createLlmClient(config);
const logger = { info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, child() { return logger; } };
const { services } = await buildApp({ config, repos, blob, llm, logger, bootstrapRequired: false });
const adminCtx = await seedDemo(repos);
await seedDemoSynthetic(services.synthetic, adminCtx);
try { await seedDemoSopVersion(services.sop, services.solvers, adminCtx); } catch (e) { console.log("sop seed skip:", e.message); }

const ON = new Set(["view.risk-board", "qos.risk_realdemand"]);
const c = await services.solvers.loadContext("demo");
c.features = ON;
const bases = c.bases.map((b) => ({ id: String(b.props.baseId), name: String(b.props.name) }));
const cz = bases.find((b) => b.name === "常州");
console.log("bases:", bases.map((b) => b.id + ":" + b.name).join(", "));
console.log("常州 baseId:", cz && cz.id);
console.log("#demandSegments:", c.demandSegments.length, "| p50s:", c.demandSegments.map((d) => d.props.p50).join(","));

// snapshot originals
const orig = c.demandSegments.map((d) => ({ p50: d.props.p50, p90: d.props.p90 }));
function setFactor(F) {
  c.demandSegments.forEach((d, i) => { d.props.p50 = orig[i].p50 * F; d.props.p90 = orig[i].p90 * F; });
}
function probe(baseId) {
  const dc = demandCapacityTightness(c, baseId);
  const lt = liveTightness(c, baseId, "物料齐套");
  return { dc: dc.value, dcLive: dc.live, gap: dc.gap, ltMaterial: lt.value, ltSrc: lt.source };
}

console.log("\n=== C2 sensitivity: scale REAL DemandSegment.p50/p90 by F, observe 常州 demand-capacity tightness ===");
console.log("F      | dcTight | live | gapWan  | 物料齐套(liveTightness) | source");
for (const F of [0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0]) {
  setFactor(F);
  const r = probe(cz.id);
  console.log([String(F).padEnd(6), String(r.dc).padStart(7), String(r.dcLive).padStart(4), String(r.gap).padStart(7), String(r.ltMaterial).padStart(22), r.ltSrc].join(" | "));
}
// restore + show a second base for cross-check
setFactor(1.0);
console.log("\n=== same sweep for 合肥 (hefei) to confirm per-base demand response ===");
const hf = bases.find((b) => b.name === "合肥");
console.log("F      | dcTight | 物料齐套 | 设备OEE(should be flat·demand-independent)");
for (const F of [0.5, 1.0, 2.0, 5.0]) {
  setFactor(F);
  const dc = demandCapacityTightness(c, hf.id).value;
  const mat = liveTightness(c, hf.id, "物料齐套").value;
  const oee = liveTightness(c, hf.id, "设备OEE").value;
  console.log([String(F).padEnd(6), String(dc).padStart(7), String(mat).padStart(8), String(oee).padStart(30)].join(" | "));
}
console.log("\nDONE_C2_WHITEBOX");
