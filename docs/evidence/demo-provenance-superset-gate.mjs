// 轨M 增量2（种子扩充）· 加性冻结超集门（审核方 refine 红线 1+2）
// 旧 467 对象 id 逐字节不变、一个不少；新集必须是旧集严格超集，delta 只能"新增"，不改/删任何旧 id。
// 用法：起 SEED_DEMO=1 datacore 于 :4001，node docs/evidence/demo-provenance-superset-gate.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const H = { "X-Debug-User": "demo:usr_demo_admin:admin" };
const B = "http://127.0.0.1:4001/a/v1";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const EV = new URL("./", import.meta.url).pathname;
// 冻结的旧基线（轨L 增量0 锁的 467）——永不变的下界。
const frozen = JSON.parse(readFileSync(EV + "demo-provenance-baseline-objids-frozen467.json", "utf8")).slice().sort();

const vc = await (await fetch(B + "/sim/view-config", { headers: H })).json();
const live = new Set(Object.values(vc.nodeObjectIds ?? {}).flat());
const frozenSet = new Set(frozen);

const removed = frozen.filter((id) => !live.has(id)); // 旧 id 丢失 = 破加性冻结
const added = [...live].filter((id) => !frozenSet.has(id)).sort(); // 新增 = 合法 delta

let red = false;
if (removed.length > 0) {
  console.error(`✗ 加性冻结破：旧基线 ${removed.length} 个 id 丢失（必须一个不少）：`, removed.slice(0, 10));
  red = true;
}
// 旧集逐字节相等（冻结子集的 SHA 与冻结文件一致）。
const frozenSha = sha(JSON.stringify(frozen));
const liveFrozenSubset = frozen.filter((id) => live.has(id)); // = frozen if removed===0
const subsetSha = sha(JSON.stringify(liveFrozenSubset));
if (subsetSha !== frozenSha) {
  console.error("✗ 旧基线子集字节不等（旧 id 集被改动）");
  red = true;
}

console.log(`加性冻结超集门：冻结旧基线=${frozen.length} · live=${live.size} · 旧丢失=${removed.length} · 新增=${added.length}`);
console.log(`  旧基线子集 SHA=${subsetSha.slice(0, 12)}（冻结 ${frozenSha.slice(0, 12)}）${subsetSha === frozenSha ? " ✓ 字节相等" : " ✗"}`);
if (added.length) console.log("  新增 delta（合法·只增不改）：", added);
if (red) { console.error("\n✗ 超集门未过：违反加性冻结（旧 id 被改/删）。"); process.exit(1); }
console.log("✓ 超集门通过：旧 467 逐字节不变且全在，新集为严格超集，delta 仅新增。");
