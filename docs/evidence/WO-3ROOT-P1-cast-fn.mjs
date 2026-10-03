/**
 * P1 负边 · A1 判据（**函数级 · 决定性 · 不依赖抽签**）
 *
 * 直连**生产实现体**（`apps/datacore/dist/synthetic/battery.js` 的 `castSeedBaseValue`，已 build），
 * 不复制式子（第二套真相源），也不经 HTTP。
 * 样本 = 2000 个确定性 id（同 seed 重跑逐字节同）。
 *
 * 三臂：
 *   ① 形状谓词选中的域（restPoint 严格内点）⇒ 2000 样本**两侧非空**；
 *   ② 其余域（压力族 restPoint = min 等）⇒ 与旧式 `round(u×100)` **逐字节相同**；
 *   ③ 反向金丝雀：旧式在同一批样本上**必须单侧**（证明①真的在度量「两侧可达」这件事，不是恒真）。
 *
 * ⛔ 只读；不起服务、不 PATCH、不写世界。
 */
const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const batt = await import(`${ROOT}/apps/datacore/dist/synthetic/battery.js`);
const sw = await import(`${ROOT}/apps/datacore/dist/sim/seed-world.js`);
const { castSeedBaseValue, stateVarDomains } = batt;
const { seedHash01 } = sw;
if (typeof castSeedBaseValue !== "function" || typeof seedHash01 !== "function") {
  console.log("❌ 铸造器/哈希函数不在 dist 里（build 没跑或导出被改名）—— 工具坏了，不是「世界干净」");
  process.exit(2);
}

const N = 2000;
const ids = Array.from({ length: N }, (_, i) => `obj_probe_${String(i).padStart(5, "0")}`);
const domains = stateVarDomains();
const entries = Object.entries(domains);

// 形状谓词 —— 与实现体同一判据（⛔ 不按量纲名特判）
const interior = entries.filter(([, d]) => d.max !== null && d.restPoint > d.min && d.restPoint < d.max);
const rest = entries.filter(([, d]) => d.max === null || d.restPoint === d.min || d.restPoint === d.max);

console.log(`样本 n=${N} · 域表 ${entries.length} 键 · 形状谓词选中「严格内点」 ${interior.length} 个：${interior.map(([k]) => k).join(",") || "(无)"}`);
console.log(`其余（压力族/端点静息/无界） ${rest.length} 键`);
if (interior.length === 0) { console.log("❌ 形状谓词一个都没选中 ⇒ 谓词坏了"); process.exit(2); }

let fails = 0;

// ── 臂① 内点域：两侧非空 ─────────────────────────────────────────────────────
for (const [sv, d] of interior) {
  const vals = ids.map((id) => castSeedBaseValue(d, seedHash01(`${id}|${sv}`)));
  const below = vals.filter((v) => v < d.restPoint).length;
  const above = vals.filter((v) => v > d.restPoint).length;
  const ok = below > 0 && above > 0;
  if (!ok) fails++;
  console.log(`臂① ${sv} 域[${d.min},${d.max}] rest=${d.restPoint} ⇒ 负侧 ${below} / 正侧 ${above} ${ok ? "✅" : "❌"}`);
  console.log(`     极值 min=${Math.min(...vals)} max=${Math.max(...vals)} 前 8 值 ${JSON.stringify(vals.slice(0, 8))}`);
}

// ── 臂② 其余域：与旧式逐字节相同 ─────────────────────────────────────────────
let same = 0, diff = 0;
for (const [sv, d] of rest) {
  for (const id of ids) {
    const u = seedHash01(`${id}|${sv}`);
    const now = castSeedBaseValue(d, u);
    const old = Math.round(u * 100); // 旧式（X）
    if (now === old) same++; else { diff++; if (diff <= 5) console.log(`   ✗ ${sv} id=${id} u=${u} now=${now} old=${old}`); }
  }
}
console.log(`臂② 其余域 ${rest.length} 键 × ${N} 样本 ⇒ 与旧式相同 ${same} / 不同 ${diff} ${diff === 0 ? "✅" : "❌"}`);
if (diff !== 0) fails++;

// ── 臂③ 反向金丝雀：旧式在内点域上必须**单侧**（否则臂①是恒真的装饰品）──────────
for (const [sv, d] of interior) {
  const old = ids.map((id) => Math.round(seedHash01(`${id}|${sv}`) * 100));
  const below = old.filter((v) => v < d.restPoint).length;
  const above = old.filter((v) => v > d.restPoint).length;
  const oneSided = !(below > 0 && above > 0);
  console.log(`臂③(金丝雀) 旧式在 ${sv} 上 ⇒ 负侧 ${below} / 正侧 ${above} ⇒ ${oneSided ? "单侧 ✅（臂①有鉴别力）" : "两侧都非空 ❌（臂①恒真，没在度量可达性）"}`);
  if (!oneSided) fails++;
}

// ── 臂④ 未登记域 / 无界域：旧占位跨度（逐字节同 X）─────────────────────────────
const undef = ids.map((id) => castSeedBaseValue(undefined, seedHash01(`${id}|___undeclared___`)));
const undefOld = ids.map((id) => Math.round(seedHash01(`${id}|___undeclared___`) * 100));
const undefSame = undef.every((v, i) => v === undefOld[i]);
console.log(`臂④ 未登记域 ⇒ 与旧式逐字节相同 ${undefSame ? "✅" : "❌"}`);
if (!undefSame) fails++;

console.log(fails === 0 ? "\nA1 PASS ✅" : `\nA1 FAIL ❌（${fails} 臂红）`);
process.exit(fails === 0 ? 0 : 1);
