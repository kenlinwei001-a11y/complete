#!/usr/bin/env node
/**
 * IndustryPack 目录约定门（INDUSTRY-PACK-CONVERGE · C2 真 0 码改 · 不变量 R14「换行业=加 pack·0码改」）。
 *
 * 断言（新增一个行业只需往 packs/** 放一个文件·既有代码零改）：
 *   ① PACK_REGISTRY 由**目录扫描派生**（registry 键集 === packs/ 扫描键集）——非手工登记数组。
 *   ② industry-pack.ts 源码**无手工 pack 登记数组**（`PACK_REGISTRY: … = [`），且确用 buildRegistry() 扫描。
 *   ③ 目录约定：文件名（去 .pack.<ext>）=== 该 pack.industryKey（键即路由·无映射漂移）。
 *   ④ battery/logistics 两内置行业均存在且通过 IndustryPackSchema 校验。
 *   ⑤ 0 码发现活证：往 dist packs 落一个 .pack.json → 同一 scanPackFiles 立即发现（=registry 依据的扫描）→ 复位。
 *
 * 用法：node scripts/check-industry-pack.mjs   （package.json: "industry-pack:check"；跑前需 pnpm -r build）
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps/datacore/src/synthetic/industry-pack.ts");
const DIST = join(ROOT, "apps/datacore/dist/synthetic/industry-pack.js");

const fail = (msg) => { console.error(`\n✗ industry-pack 门未通过：${msg}`); process.exit(1); };

if (!existsSync(DIST)) fail(`未找到 ${DIST}（先 \`pnpm -r build\`）`);

// ── ② 源码断言：无手工 pack 数组 + 确用目录扫描 ─────────────────────────────
const src = readFileSync(SRC, "utf8");
if (/PACK_REGISTRY[^\n]*=\s*\[/.test(src)) {
  fail("industry-pack.ts 出现手工 `PACK_REGISTRY = [ … ]` 登记数组——须由目录扫描派生（buildRegistry）。");
}
if (!/buildRegistry\(\)/.test(src) || !/readdirSync/.test(src)) {
  fail("industry-pack.ts 未见目录扫描（buildRegistry/readdirSync）——PACK_REGISTRY 必须目录派生。");
}

// ── 运行期加载（dist·与生产同源）────────────────────────────────────────
const mod = await import(DIST);
const { PACK_REGISTRY, scanPackFiles, keyFromFile, loadIndustryPack, PACKS_DIR } = mod;
const { IndustryPackSchema } = await import(pathToFileURL(join(ROOT, "packages/contracts/dist/index.js")).href);

// ── ① registry === 目录扫描 ────────────────────────────────────────────
const dirKeys = scanPackFiles().map(keyFromFile).sort();
const regKeys = PACK_REGISTRY.map((p) => p.industryKey).sort();
if (JSON.stringify(dirKeys) !== JSON.stringify(regKeys)) {
  fail(`PACK_REGISTRY 键集 ≠ 目录扫描键集：\n  registry=${JSON.stringify(regKeys)}\n  dirscan =${JSON.stringify(dirKeys)}`);
}

// ── ③ 文件名 === industryKey ───────────────────────────────────────────
for (const name of scanPackFiles()) {
  const key = keyFromFile(name);
  const p = loadIndustryPack(key);
  if (!p) fail(`packs/${name} 未被登记（industryKey 派生=${key}）。`);
  if (p.industryKey !== key) fail(`packs/${name}: 文件名派生键(${key}) ≠ pack.industryKey(${p.industryKey})——违目录约定。`);
}

// ── ④ battery/logistics 存在且合法 ─────────────────────────────────────
for (const need of ["battery-manufacturing", "logistics-warehouse"]) {
  const p = loadIndustryPack(need);
  if (!p) fail(`缺内置行业包：${need}`);
  const r = IndustryPackSchema.safeParse(p);
  if (!r.success) fail(`行业包 ${need} 未通过 IndustryPackSchema 校验：${r.error.issues[0]?.message}`);
}

// ── ⑤ 0 码发现活证：落一个 .pack.json → 被同一扫描发现 → 复位 ─────────────
const probeKey = "_gate-probe-industrypack";
const probeFile = join(PACKS_DIR, `${probeKey}.pack.json`);
const before = scanPackFiles().map(keyFromFile);
if (before.includes(probeKey)) fail("残留探针文件——请清理 dist packs。");
try {
  writeFileSync(probeFile, JSON.stringify({ industryKey: probeKey }));
  const after = scanPackFiles().map(keyFromFile);
  if (!after.includes(probeKey)) fail("落一个 packs/*.pack.json 未被扫描发现——目录 auto-discover 失效（0 码改不成立）。");
} finally {
  rmSync(probeFile, { force: true });
}
if (scanPackFiles().map(keyFromFile).includes(probeKey)) fail("探针复位后仍残留——扫描非确定性。");

console.log(`✓ industry-pack 门通过：PACK_REGISTRY 目录派生（${regKeys.length} 行业：${regKeys.join(", ")}）·文件名即键·battery/logistics 合法·0 码发现活证过（加 packs/** 一个文件即被发现·既有代码零改）。`);
