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
// 合法 hash 用途：结果进 id/version/bucket 分流（非业务量），或 Node crypto 去重/摘要（computeSource dedup·非展示级业务值）。
// WO-GATE-ID-TIGHTEN：id 豁免**锚定到赋值目标**（`const/let/var xxxId` 或 `xxxId =/:`）——`hash(xxxId)` 把 id 当**实参**派生
// 业务值不再被放行（此前 `Id\b` 松匹配全行→ `hash(baseId)` 造"谁负责"逃逸）；`const nodeId = hash(x)`（id 作赋值目标）仍合法。
const LEGIT_RE = /(\b(?:const|let|var)\s+\w*[Ii]d\b|\w*[Ii]d\s*[=:]|version|rsv_|bucket|splitPct|`e\$\{|toString\(\s*36\s*\)|toString\(\s*16\s*\)|createHash\s*\(|\.digest\s*\()/;
// 残口信号（WO-FAKE-05 堵根·扩）：**任意 hash 命名函数**参与派生数值——不再只守全局 `hashString(`，
// 也逮**本地 hash**（如审计 R4 的 `riskHashN(base) % N` 取模造"谁负责"/占用比·FAKE-03 已治→防复发）。
// `\w*[Hh]ash\w*(` 覆盖 hashString/riskHashN/createHash/...；createHash/digest 由 LEGIT_RE 豁免（真去重非业务量）。
const SMELL_RE = /\b\w*[Hh]ash\w*\s*\(/;
// 注释行不算残口（诚实注释常写"绝不再用 riskHashN(...)/此前 hash(so)%..."记录已删残口·非活代码）。
const COMMENT_RE = /^\s*(\/\/|\*|\/\*)/;

// ── C1 gate自证（WO-FAKE-05·牙齿）：SMELL 必逮本地 hash 造数、LEGIT 必放行 crypto/id·任一失守则门自红 ──
{
  const mustCatch = [
    'const owner = RISK_OWNER_NAMES[riskHashN(base) % RISK_OWNER_NAMES.length];', // 审计 R4 本地 hash 造"谁负责"
    'const occ = creditBase + myHash(cust) % creditMod / 100;',                    // 本地 hash 造占用比
    'const jitter = hashString(so) % jitterMod;',                                  // 全局 hashString 造抖动（存量口径）
    'const sev = SEVERITY[hashString(baseId) % 3];',                               // WO-GATE-ID-TIGHTEN：hash(xxxId) 作实参造业务值·不再被 id 豁免放行
  ];
  const mustPass = [
    'const hash = createHash("sha256").update(draft.computeSource).digest("hex").slice(0, 16);', // crypto dedup id
    'const bucket = hashString(tenantId + solverKey) % 100 < splitPct;',                          // AB 分流 bucket
    'const nodeId = hashString(seed).slice(0, 8);',                                                // WO-GATE-ID-TIGHTEN：id 作赋值目标·合法·不误伤
  ];
  for (const s of mustCatch) if (!(SMELL_RE.test(s) && !LEGIT_RE.test(s))) { console.error(`✗ C1 gate自证失守：SMELL 未逮本地 hash 造数残口 → 「${s}」（牙齿钝·堵根失效）`); process.exit(2); }
  for (const s of mustPass) if (!(LEGIT_RE.test(s) || COMMENT_RE.test(s))) { console.error(`✗ C1 gate自证失守：LEGIT 误伤合法 hash 用途 → 「${s}」（假阳·会逼真去重/分流改坏）`); process.exit(2); }
}

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
    if (COMMENT_RE.test(line)) return; // 注释行（记录已删残口的诚实注释·非活代码）→ 不算
    if (LEGIT_RE.test(line)) return; // id/version/bucket/crypto → 合法
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
