#!/usr/bin/env node
/**
 * FAKEDATA-SWEEP · check-no-fake-data（决策路径假数据残口扫描器·确定性纯静态 R6）
 * ───────────────────────────────────────────────────────────────────────────
 * 第一性（用户亲定·铁律0.6）：推演必基于真实数据。决策级数值**绝不**用 hash(名)/写死系数/兜底值
 * 冒充真实——无真源 → 诚实空态/诚实标注合成（dataMode），不哈希造伪。
 *
 * 本门扫**决策路径**（datacore 求解器 + 前端决策视图）中"由 hash 现编数值"的最强残口信号：
 *   `hashString(...)` 用于**派生业务数值**（`% N` 造数 / 参与算子）。
 * 每处判定：
 *   - **合法**（ID/版本/AB 分流）：`hashString` 结果进 id/version/bucket（非业务量）→ 放行。
 *   - **诚实标注合成**：±HONESTY_WINDOW 行内有诚实标记（dataMode/诚实/估算/无实测/合成/SYNTHETIC/MOCK）
 *     → 计入 LABELED 清单（审计追踪·补真源子 WO 在办·非红）。
 *   - **裸冒充**（既非合法用途·又无诚实标记）→ **SUSPECT**（本体谎言：hash 数值冒充真实决策值）→ 红。
 *
 * 棘轮：LABELED 残口记入 `no-fake-data.baseline.json`（诚实记录·待补真源子 WO），门只在出现
 * **基线外的新 SUSPECT** 或**新 LABELED**（未登记的 hash 数值残口）时红——防新增假数据回潮。
 *
 * 用法：node scripts/check-no-fake-data.mjs [--json] [--update]
 *   默认非零退出即红（可纳 gates）。--update：把当前 LABELED 集写入基线（诚实记录·非洗白）。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const UPDATE = argv.includes("--update");

// 扫描面（决策路径·非抽样）：datacore 全量求解器 + 前端全量决策视图。
const SCAN_GLOBS = ["apps/datacore/src/solvers", "apps/frontend-shell/src/views"];
const HONESTY_WINDOW = 30; // 诚实标记函数级窗口（行）——合成值的 dataMode 诚实位常在函数尾部 return，非紧邻 hash 行
const HONESTY_RE = /dataMode|诚实|估算|无实测|合成|SYNTHETIC|MOCK|PARTIAL|debattery-allow|绝不|不哈希|不合成|去掉/;
// 合法 hash 用途：结果进 id/version/bucket 分流（非业务量）。
const LEGIT_RE = /(_?id\b|Id\b|version|rsv_|bucket|splitPct|`e\$\{|toString\(\s*36\s*\)|toString\(\s*16\s*\))/;
// 残口信号：hashString 参与派生数值（% N 造数 / 直接入算式）。
const SMELL_RE = /hashString\s*\(/;

function listFiles() {
  const out = [];
  for (const g of SCAN_GLOBS) {
    const abs = join(ROOT, g);
    if (!existsSync(abs)) continue;
    const found = execSync(
      `find ${abs} -type f \\( -name '*.ts' -o -name '*.tsx' \\) -not -name '*.test.*' -not -name '*.spec.*'`,
      { encoding: "utf8" },
    ).trim().split("\n").filter(Boolean);
    out.push(...found);
  }
  return out.sort();
}

const labeled = []; // { loc, snippet }
const suspect = []; // { loc, snippet }

for (const file of listFiles()) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!SMELL_RE.test(line)) return;
    if (LEGIT_RE.test(line)) return; // id/version/bucket → 合法
    const from = Math.max(0, i - HONESTY_WINDOW);
    const to = Math.min(lines.length, i + HONESTY_WINDOW + 1);
    const ctx = lines.slice(from, to).join("\n");
    const loc = `${rel}:${i + 1}`;
    const snippet = line.trim().slice(0, 120);
    if (HONESTY_RE.test(ctx)) labeled.push({ loc, snippet });
    else suspect.push({ loc, snippet });
  });
}

const basePath = join(ROOT, "scripts", "no-fake-data.baseline.json");
const baseline = existsSync(basePath) ? JSON.parse(readFileSync(basePath, "utf8")) : { labeled: {} };
const baseKeys = new Set(Object.keys(baseline.labeled ?? {}));

if (UPDATE) {
  const next = { _comment: baseline._comment ?? "FAKEDATA-SWEEP 棘轮基线：决策路径诚实标注的 hash 合成残口（待补真源子 WO）。门只在出现基线外的新 SUSPECT/LABELED 时红。", labeled: {} };
  for (const l of labeled) next.labeled[l.loc] = l.snippet;
  writeFileSync(basePath, JSON.stringify(next, null, 2) + "\n");
  console.log(`✓ no-fake-data 基线已更新：${labeled.length} LABELED（诚实记录·待补真源）。`);
  process.exit(0);
}

const newLabeled = labeled.filter((l) => !baseKeys.has(l.loc));

if (JSON_OUT) {
  console.log(JSON.stringify({ scanned: SCAN_GLOBS, labeled, suspect, newLabeled: newLabeled.map((l) => l.loc) }, null, 2));
  process.exit(suspect.length || newLabeled.length ? 1 : 0);
}

console.log("check-no-fake-data · 决策路径 hash 数值残口扫描\n");
console.log(`  扫描面（非抽样）: ${SCAN_GLOBS.join(" + ")}`);
console.log(`  LABELED（诚实标注合成·基线追踪·补真源在办）: ${labeled.length}`);
for (const l of labeled) console.log(`    · ${l.loc}  ${l.snippet}`);
if (suspect.length) {
  console.error(`\n✗ SUSPECT（hash 数值裸冒充真实决策值·无诚实标记）: ${suspect.length}`);
  for (const s of suspect) console.error(`    ✗ ${s.loc}  ${s.snippet}`);
}
if (newLabeled.length) {
  console.error(`\n✗ 新增未登记 LABELED（基线外·须登记或补真源）: ${newLabeled.map((l) => l.loc).join(", ")}`);
}
if (!suspect.length && !newLabeled.length) {
  console.log("\n✓ 无基线外的新 SUSPECT/LABELED：决策路径无 hash 数值裸冒充；诚实标注合成均在基线追踪（待补真源子 WO）。");
  process.exit(0);
}
process.exit(1);
