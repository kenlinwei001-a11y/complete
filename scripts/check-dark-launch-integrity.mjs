#!/usr/bin/env node
/**
 * `dark-launch:check` —— 守「写了 `defaultOn:false` 就以为暗发了」这个静默陷阱。
 *
 * **病史（本门存在的全部理由 · 2026-08-09 两个独立 dev 同日各踩一次）**：
 * `defaultOn:false` **只挡 L1**。`templateFeatures()` 对 `battery-manufacturing` 行业返回 **all-on**，
 * 而 `layeredSet()` 的 **L2 无条件覆盖 L1** —— demo 租户恰是 battery。
 * ⇒ 只写 `defaultOn:false` 而不同时列进某个 `*_DARK_LAUNCH_FEATURES` 集合，
 * **该功能对 demo 其实是开的，且没有任何信号**。
 * 这不是小事：开关默认值是**产品决策**，dev 以为自己没开、实际开了 = 静默越权。
 *
 * WO-APPROVAL-POLICY 与 WO-ORG-WORLD 各自独立发现并各自加了一个集合
 * （`GOVERNANCE_` / `WORLD_`），加上既有的 `QOS_` / `PERF_` —— **四个集合做同一件事**，
 * 本身又是「同一件事多个真值源」。本门顺带把它们统一成一个可枚举面。
 *
 * **判据**：每个 `defaultOn:false` 的 feature key，必须出现在任一 `*_DARK_LAUNCH_FEATURES` 集合里。
 * **棘轮**：不合规数只减不增（存量太多，一次性清零会卡死所有人）。
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "apps/datacore/src/features.ts");
const BASELINE = resolve(ROOT, "scripts/dark-launch-baseline.json");

/** 抽取器 —— 金丝雀与主逻辑**共用这一份**（不许各抄一份正则：抄了就是装饰品）。 */
function extract(text) {
  const dark = new Set();
  for (const m of text.matchAll(/[A-Z_]*DARK_LAUNCH_FEATURES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/g)) {
    for (const k of m[1].matchAll(/"([^"]+)"/g)) dark.add(k[1]);
  }
  const offByDefault = [];
  for (const m of text.matchAll(/\{\s*key:\s*"([^"]+)"[^}]*?defaultOn:\s*false[^}]*\}/g)) offByDefault.push(m[1]);
  return { dark, offByDefault };
}

if (!existsSync(SRC)) { console.error(`⛔ 门自己瞎了：找不到 ${SRC} —— 这不是「代码干净」，是门没扫到东西。`); process.exit(2); }
const text = readFileSync(SRC, "utf8");
const { dark, offByDefault } = extract(text);

// ── 金丝雀（报否定结论前必跑；共用上面同一个 extract） ──
if (offByDefault.length === 0) { console.error("⛔ 门自己瞎了：抽到 0 个 defaultOn:false 的 feature —— 抽取器坏了，不许报「全部合规」。"); process.exit(2); }
if (dark.size === 0) { console.error("⛔ 门自己瞎了：抽到 0 个暗发集合成员 —— 抽取器坏了。"); process.exit(2); }
console.log(`金丝雀：抽到 defaultOn:false ${offByDefault.length} 个 · 暗发集合成员 ${dark.size} 个 ⇒ 抽取器有效`);

const violations = offByDefault.filter((k) => !dark.has(k));
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;

console.log(`\n扫描：${offByDefault.length} 个 defaultOn:false · ${dark.size} 个已列暗发 · **${violations.length} 个未列**`);
if (violations.length) {
  console.log("\n以下 feature 写了 defaultOn:false，但**没进任何暗发集合** ⇒ 对 battery/demo 租户其实是开的：");
  for (const v of violations) console.log(`   ${v}`);
  console.log("\n修法：把它加进 features.ts 里某个 `*_DARK_LAUNCH_FEATURES` 集合（按语义选，或新建并在此注明）。");
  console.log("     ⚠️ 不是改 defaultOn —— 改那个没用，L2 照样覆盖。");
}

if (process.argv.includes("--set-baseline")) {
  writeFileSync(BASELINE, JSON.stringify({ count: violations.length, keys: violations.sort(), note: "棘轮：只减不增。2026-08-09 建门时的存量。" }, null, 2) + "\n");
  console.log(`\n已写基线：${violations.length}`); process.exit(0);
}
if (!base) { console.error("\n⛔ 缺基线文件 —— 先跑 `node scripts/check-dark-launch-integrity.mjs --set-baseline`"); process.exit(2); }
if (violations.length > base.count) {
  console.error(`\n❌ dark-launch:check 未通过：不合规数 ${violations.length} > 基线 ${base.count}（棘轮只减不增）`);
  const added = violations.filter((v) => !base.keys.includes(v));
  if (added.length) console.error(`   新增不合规：${added.join(" · ")}`);
  process.exit(1);
}
if (violations.length < base.count) console.log(`\n✅ 好于基线（${base.count} → ${violations.length}）—— 记得跑 --set-baseline 收紧棘轮。`);
console.log(`\n✅ dark-launch:check 通过（不合规 ${violations.length} ≤ 基线 ${base.count}）`);
