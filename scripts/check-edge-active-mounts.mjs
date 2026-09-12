#!/usr/bin/env node
/**
 * WO-ACTIVE-EDGE-UX · 挂载点门：**每个推演页都挂了 `EdgeActivePanel`，且挂在主组件里**。
 * WO-INFER-PAGE-SSOT · 受检名册从**手抄数组**改成**现算**（闭 `G-GATE-ROSTER-HANDCOPIED` 本门这一侧）。
 *
 * ── 为什么要这道门（它拦的是一个真发生过的错，不是假想）─────────────────────────────
 * 本单初稿把三处 `<EdgeActivePanel>` 挂进了**子组件**（`SchemeCard` / `VersionDetail` /
 * `DecisionPlay`）——它们只在"已经跑出结果 / 已选中版本"时才渲染。净效果是：
 *   **没跑过推演就看不见开关**，而"先关掉一条边、再看结果"恰恰是最常见的用法。
 * 这是本仓反复吃亏的那个形态的又一例：**实现有、测试可能还是绿的、但那条链路走不到**
 * （`G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 同族）。人眼逐个 `sed` 去数是能查出来的 ——
 * 我这次就是这么查出来的 —— 但**人眼不是机制**（铁律 0.6：下次同样的错必须机器先说话）。
 *
 * ── 2026-08-16 本门自己犯的**第二个**病，与上面那个不同族，必须分开记 ──────────────
 * 受检名册 `PAGES` 曾是**手抄的 9 条**（注释自陈「前 8 条来自工单 §1；第 9 条 risk-board
 * 是复核时补的」）。于是 `cleanroom-attr` / `disruption-radius` / `order-chain` 三页
 * **从未被本门问过，于是永远绿**。
 * 形态（铁律 0.6 句式）：**「我用『名单里那几个都合格』当作『所有该合格的都合格』的证据，
 * 而前者并不度量后者。」** —— 门只能证明「它问过的那些是对的」，证明不了「该问的都问了」。
 * 修法：名册改由 `scripts/lib/sim-page-roster.mjs` **现算**（判据的单一来源，五条纳入判据
 * + 一条排除判据 + 三条交叉断言，每页带依据链），本文件里**一个页面键都不存**。
 * 连「页 → 源码文件」也是现算的（registry.ts 的 `registerRenderer` / App.tsx 的静态 route）——
 * 原先那一半也是手抄的，页一搬家门就读到 ENOENT 而不是读到真相。
 *
 * ── 判据（四条，都不许降级成"grep 到就算数"）───────────────────────────────────
 *  ① **名册合法**：交叉断言 C1/C2/C3 零违规（词面像推演却没在 `BUILTIN_VIEWS` 标 `sim: true`
 *     ⇒ 漏标；沙盘家族成员归属不明；名册里的页解析不到源码文件）。
 *  ② **覆盖**：名册里每一页的源码文件都出现 `<EdgeActivePanel`。
 *  ③ **位置**：该 JSX 的行号必须落在**默认导出组件**的行段内，即
 *     `export default function X` 那一行 ≤ 挂载行 < 其后第一个顶层 `function`/`export default` 行。
 *     （本仓这几页的顶层声明都在第 0 列，故"第 0 列的 `function `"就是顶层边界的可靠判据。）
 *  ④ **棘轮**：已知缺口登记在 `scripts/edge-active-mounts-baseline.json`（每条必须写 `why`），
 *     只许收不许放：
 *       · 基线里记「缺」而实测已挂 ⇒ **松弛（免检名额）**，跑 `--tighten` 收紧，否则红；
 *       · 基线里有、名册里没有的页 ⇒ **死账**（同名一建回来就继承旧额度），红；
 *       · 名册里新出现的页没挂且不在基线里 ⇒ **真违规**，红。
 *     ⚠ 为什么用棘轮而不是"一律红"：本门改成现算的当天就多问出 3 页真缺口，而**补挂面板
 *     是产品改动、不在本单范围边界内**。一道长期红的门只会训练人把门删掉（本仓已记过这条
 *     教训：会因无害重构而红的门等于没有门）。棘轮把「漏检永远绿」换成「已知缺口在册、
 *     新缺口当场红」—— 缺口从此有名有姓、有 why、只减不增。
 *
 * ── 金丝雀（铁律 0.6：报否定结论前先自证工具，且金丝雀与主判据**共用同一份实现**）──────
 * 三层，全部跑**本门真正在用的那几个函数**，不另抄一份正则：
 *   · `analyze()` 两向（挂主组件必中 / 挂子组件必不中）—— 判据②③ 的实现本体；
 *   · `rosterCanary()` 十向 —— 判据① 的实现本体（`scripts/lib/sim-page-roster.mjs`）；
 *   · `baselineDocCanary()` 四向 —— 判据④ 写基线那一支的实现本体。
 * 任一不符预期 ⇒ 报「工具坏了」并 exit 2，**不许**报「页面都挂对了」。
 * 抄一份正则给金丝雀 = 装饰品（改主正则时金丝雀拿旧的去测、照样绿）。
 *
 * 用法：
 *   node scripts/check-edge-active-mounts.mjs             # 门
 *   node scripts/check-edge-active-mounts.mjs --census     # 现算名册 + 逐页依据链 + 排除项
 *   node scripts/check-edge-active-mounts.mjs --selftest   # 只跑三层金丝雀，不读仓库
 *   node scripts/check-edge-active-mounts.mjs --seed       # 首次建棘轮基线
 *   node scripts/check-edge-active-mounts.mjs --tighten    # 只收紧不放松（收掉免检名额）
 * RC: 0 通过 · 1 有页不合格 / 名册非法 / 棘轮倒退或松弛 · 2 **门自己坏了**
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";
import { computeRoster, rosterCanary, SIM_SOURCE_FILES } from "./lib/sim-page-roster.mjs";

const BASELINE = "scripts/edge-active-mounts-baseline.json";
/**
 * 名册规模下界。**不是**在写死名单（写死名单正是本门要治的病），是在自证扫描面没塌：
 * 五个源头同时被重构成解析不了的写法 ⇒ 名册变空 ⇒ 「0/0 页全过」是**失败危险方向**的绿。
 * 取 8 的理由：光「推演」导航组一组现算就有 8 条，任何低于它的数都意味着解析器瞎了。
 */
const ROSTER_FLOOR = 8;

/**
 * **唯一实现**：给一份源码文本，回「挂载行号们」+「默认导出组件的行段」+ 判定。
 * 主判据与金丝雀都调它 —— 这就是"金丝雀必须与主逻辑共用同一份实现"那条纪律的落点。
 * `apps/frontend-shell/test/edge-active.seam.test.tsx` 也 import 它（同一条纪律）。
 */
export function analyze(src) {
  const lines = src.split("\n");
  const mounts = [];
  const topLevel = [];
  let defaultAt = -1;
  lines.forEach((ln, i) => {
    if (ln.includes("<EdgeActivePanel")) mounts.push(i);
    // 顶层声明：第 0 列的 `function ` 或 `export default function `（本仓这几页都如此）
    if (/^export default function /.test(ln)) { defaultAt = i; topLevel.push(i); }
    else if (/^function /.test(ln)) topLevel.push(i);
  });
  if (defaultAt < 0) return { ok: false, reason: "NO_DEFAULT_EXPORT", mounts, range: null };
  const next = topLevel.find((i) => i > defaultAt);
  const end = next === undefined ? lines.length : next;
  const range = [defaultAt, end];
  if (mounts.length === 0) return { ok: false, reason: "NO_MOUNT", mounts, range };
  const outside = mounts.filter((i) => i < defaultAt || i >= end);
  if (outside.length > 0) return { ok: false, reason: "MOUNTED_IN_SUBCOMPONENT", mounts, outside, range };
  return { ok: true, reason: "OK", mounts, range };
}

/**
 * **受检名册的唯一入口**（门 / 前端接缝测试共用，谁都不许再自己抄一份数组）。
 * @param {(rel:string)=>string} readFile 注入读盘（门里用 `read()` 走 RC=2 出口，测试里用 fs）
 */
export function loadSimPageRoster(readFile) {
  const texts = Object.fromEntries(Object.entries(SIM_SOURCE_FILES).map(([k, p]) => [k, readFile(p)]));
  return computeRoster(texts);
}

// ⚠ 以下是**命令行入口**，只在被直接执行时跑（`node scripts/check-edge-active-mounts.mjs`）。
// 加这道守卫的理由很具体：前端接缝门 `test/edge-active.seam.test.tsx` **import 本文件的 `analyze`
// 与 `loadSimPageRoster`** —— 这正是"金丝雀必须与主逻辑共用同一份实现"那条纪律的落点。
// 若不守卫，一次 import 就会跑完整个门并可能 `process.exit(1)`，**把跑测试的那个进程一起带走**
//（表现为一条与本用例无关的诡异失败）。守卫之后：命令行跑门、测试只借判据，互不干扰。
/* ── 退出码纪律 · 顶层兜底（WO-GATE-LEDGER-FIX 补 · `gate-exit-discipline:check` 当场报红逼出来的）──
 * 本门原有 RC=2 出口（金丝雀不符那条），**但缺顶层兜底**：任何未预期异常（只读 FS / 权限 /
 * OOM / node 版本差异 / 某个源码文件被删）都会走 node 默认的退 **1** —— 恰好撞上「真有页没挂」
 * 那个码，于是「我没扫成」被读成「你的页面漏挂了」，方向正好相反。
 *
 * ⚠ 这里刻意用**形态 (a) 顶层 try/catch**，而**不是** `process.on("uncaughtException")`：
 *   本文件的 `analyze` 被 `test/edge-active.seam.test.tsx` import。顶层无条件注册全局 handler
 *   会**装进跑测试的那个进程**，一旦测试里别处抛未捕获异常就会被本门的 handler 抢走并 `exit(2)`，
 *   把整个测试进程带走。try/catch 只包住「被直接执行时才跑的那一句」，import 时是彻底的 no-op。
 * ⚠ `try` 必须是 **Program 的直接子语句**（`check-gate-exit-discipline.mjs` 只认这一形态；
 *   写成 `if (isMain) { try {…} }` 会被判「无顶层兜底」）。
 * ───────────────────────────────────────────────────────────────────────────── */
function toolBroken(what, hint) {
  console.error(`⛔ check-edge-active-mounts.mjs：${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「推演页都挂对了 / 代码干净 / 通过」——本门这次没跑完，它什么都没证明。");
  if (hint) console.error("   " + hint);
  process.exit(2); // 2 = 工具自己坏了（1 = 真有页没挂或挂错层），两者处置相反，不许合并
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
try {
  if (isMain) main();
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}

function read(rel) {
  const p = resolve(process.cwd(), rel);
  if (!existsSync(p)) {
    toolBroken(`读不到 ${rel}`, "扫描面缺失 ⇒ 名册会变空 ⇒ 「0/0 页全过」是失败危险方向的绿，故一律判「工具坏了」。");
  }
  return readFileSync(p, "utf8");
}

function main() {
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);

// ── 保命判据 · 三层金丝雀（跑的都是本门真正在用的实现，不是另抄的正则）────────────
const two = [
  ["必中（挂在主组件里）", `export default function P() {\n  return <div><EdgeActivePanel pageKey="x" /></div>;\n}\nfunction Sub() { return null; }\n`, (r) => r.ok],
  ["必不中（挂在子组件里）", `export default function P() {\n  return <Sub />;\n}\nfunction Sub() {\n  return <EdgeActivePanel pageKey="x" />;\n}\n`, (r) => !r.ok && r.reason === "MOUNTED_IN_SUBCOMPONENT"],
];
const analyzeBad = two.filter(([, src, want]) => !want(analyze(src))).map(([name]) => name);
const rc = rosterCanary();
const bd = baselineDocCanary();
if (analyzeBad.length || !rc.ok || !bd.ok) {
  console.error("🛠️  **工具坏了**：金丝雀不符预期 ——");
  for (const n of analyzeBad) console.error(`   · analyze 金丝雀「${n}」不符预期`);
  for (const b of rc.bad) console.error(`   · 名册金丝雀：${b}`);
  if (!bd.ok) console.error(`   · 基线写入器金丝雀：${bd.got}`);
  console.error("   ⛔ 不许把本次结果读作「页面都挂对了」。");
  process.exit(2);
}
console.log(`✅ 金丝雀 16/16（analyze 2 向 · 名册 10 向 · 基线写入器 4 向，全部跑本门在用的同一份实现）`);
if (flag("--selftest")) { console.log("（--selftest：只跑金丝雀，未比对仓库内容）"); return; }

// ── 判据① 名册现算 + 合法性 ────────────────────────────────────────────────────
const roster = loadSimPageRoster(read);
if (roster.pages.length < ROSTER_FLOOR) {
  toolBroken(
    `现算名册只有 ${roster.pages.length} 页（下界 ${ROSTER_FLOOR}）`,
    "五个源头不可能同时真的空；名册塌了 = 解析器瞎了，不是仓里没有推演页。报「全过」会是失败危险方向的绿。",
  );
}

if (flag("--census")) {
  console.log(`\n── 现算推演页名册（${roster.pages.length} 页 · 判据的单一来源 scripts/lib/sim-page-roster.mjs）──`);
  for (const p of roster.pages) {
    console.log(`  ${p.key.padEnd(18)} ${p.file ?? "（解析不到源码文件）"}`);
    for (const w of p.why) console.log(`      ← ${w}`);
  }
  console.log(`\n── 逐判据贡献 ──`);
  for (const [k, v] of Object.entries(roster.sources.byRule)) console.log(`  ${k}: ${v.length} · ${v.join(" ") || "（空）"}`);
  console.log(`\n── 有理由地排除（不是漏掉）──`);
  for (const e of roster.excluded) console.log(`  ${e.key.padEnd(18)} ${e.why}`);
  console.log(`\n── 交叉断言 ──`);
  console.log(roster.violations.length ? roster.violations.map((v) => `  ${v.code} ${v.key}：${v.detail}`).join("\n") : "  （零违规）");
  return;
}

const fail = [];
for (const v of roster.violations) {
  fail.push(`① 名册合法：${v.code} ${v.key} —— ${v.detail}`);
}

// ── 判据②③ 逐页挂载点 ─────────────────────────────────────────────────────────
const now = {}; // pageKey -> "OK" | 失败原因
for (const p of roster.pages) {
  if (!p.file) { now[p.key] = "NO_FILE"; continue; }
  const abs = resolve(process.cwd(), p.file);
  if (!existsSync(abs)) {
    // 名册说这页有组件、文件却不在 —— 这是**仓库**的问题（注册表指向了不存在的模块），不是门的问题
    now[p.key] = "FILE_MISSING";
    continue;
  }
  now[p.key] = analyze(readFileSync(abs, "utf8")).reason;
}

// ── 判据④ 棘轮 ────────────────────────────────────────────────────────────────
const prev = existsSync(resolve(process.cwd(), BASELINE)) ? JSON.parse(read(BASELINE)) : null;
const knownGaps = prev?.gaps ?? {};

if (flag("--seed") || flag("--tighten")) {
  const gaps = {};
  for (const [key, reason] of Object.entries(now)) {
    if (reason === "OK") continue; // --tighten 的全部作用：挂好了的页从基线里消失，额度收回
    gaps[key] = {
      reason,
      why: knownGaps[key]?.why ?? "⚠ 未填 why —— 每条已知缺口必须写清「为什么它今天还缺」，空 why 一律判红。",
    };
  }
  writeFileSync(
    resolve(process.cwd(), BASELINE),
    JSON.stringify(
      buildBaselineDoc({
        prev,
        generatedBy: `node scripts/check-edge-active-mounts.mjs ${flag("--seed") ? "--seed" : "--tighten"}`,
        prose: {
          note:
            "edge-active-mounts 棘轮基线：**已知缺口**（推演页未挂 EdgeActivePanel）的具名登记，只许降不许升。" +
            "受检名册由 scripts/lib/sim-page-roster.mjs **现算**，本文件里一个页面键都不存 —— " +
            "名单一手抄，新增的页就永远不在里面、于是永远绿（本体 §8 G-GATE-ROSTER-HANDCOPIED）。" +
            "`gaps.<page>.reason` 归机器算；`gaps.<page>.why` 与本 note 归人手，" +
            "由 scripts/lib/baseline-doc.mjs 保证 --tighten 不吞人话。" +
            "补挂面板属产品改动：收口时删掉对应条目并跑 --tighten，额度即收回。",
        },
        computed: { gaps, gapCount: Object.keys(gaps).length, rosterSize: roster.pages.length },
      }),
      null,
      2,
    ) + "\n",
  );
  console.log(`✍️  基线已写：${BASELINE}（名册 ${roster.pages.length} 页 · 已知缺口 ${Object.keys(gaps).length}）`);
  return;
}

if (prev == null) {
  fail.push(`④ 棘轮：基线 ${BASELINE} 不存在 —— 先跑 \`node scripts/check-edge-active-mounts.mjs --seed\` 建账（不建账 = 棘轮不生效，门是装饰品）`);
} else {
  // 名册缩水：**反向的漏检**。删掉 `BUILTIN_VIEWS` 的 `sim: true`、或把一页移出「推演」导航组，
  // 都会让它悄悄退出受检面 —— 交叉断言 C1 只咬「词面像推演却没标」，咬不到「名字不像、标记也被删」
  // 的那一类（`plan-generate` / `sop-balance` 正是这一类，也正是 `sim` 字段存在的理由）。
  // 故名册规模本身也上棘轮：只许涨，要降必须显式 `--tighten`（那一步会把理由留在 git 历史里）。
  if (typeof prev.rosterSize === "number" && roster.pages.length < prev.rosterSize) {
    fail.push(
      `④ 棘轮名册缩水：现算 ${roster.pages.length} 页 < 基线 ${prev.rosterSize} 页 —— ` +
        `有页退出了受检面（多半是 BUILTIN_VIEWS 的 sim:true 被删、或某页被移出「推演」导航组）。` +
        `确实是页退役了就跑 \`--tighten\` 并在提交说明里写清楚；否则这就是「漏检永远绿」正在复发。`,
    );
  }
  // 死账：基线里有、名册里没有的页（同名一建回来就继承旧额度）
  for (const key of Object.keys(knownGaps)) {
    if (!(key in now)) fail.push(`④ 棘轮死账：${key} 在基线里挂着，却不在现算名册里 —— 页没了就把账也销掉，别留着给同名的新页继承`);
  }
  // 松弛：基线记「缺」而实测已挂 ⇒ 免检名额
  for (const [key, g] of Object.entries(knownGaps)) {
    if (now[key] === "OK") fail.push(`④ 棘轮松弛（**免检名额**）：${key} 基线记「${g.reason}」而实测已挂对 —— 基线比实测松，跑 \`--tighten\` 收紧`);
  }
  // why 必填：没有理由的挂账 = 白名单
  for (const [key, g] of Object.entries(knownGaps)) {
    if (!g.why || /未填 why/.test(g.why)) fail.push(`④ 棘轮挂账无理由：${key} 的 why 是空的/占位 —— 没有理由的挂账把棘轮降级成白名单`);
  }
}

// ── 逐页报告 ──────────────────────────────────────────────────────────────────
let ok = 0, gap = 0;
for (const p of roster.pages) {
  const reason = now[p.key];
  const known = Object.prototype.hasOwnProperty.call(knownGaps, p.key);
  if (reason === "OK") {
    ok++;
    console.log(`✅ ${p.key.padEnd(18)} 挂载于主组件`);
  } else if (known) {
    gap++;
    console.log(`◑ ${p.key.padEnd(18)} 已知缺口（${reason}）：${knownGaps[p.key].why}`);
  } else if (reason === "NO_MOUNT") {
    fail.push(`②③ ${p.key} **未挂载** EdgeActivePanel（${p.file}）—— 「所有推演的功能」是横向要求，漏一页就是漏一页；它进名册的依据：${p.why.join(" / ")}`);
  } else if (reason === "MOUNTED_IN_SUBCOMPONENT") {
    fail.push(`②③ ${p.key} 挂在**子组件**里（${p.file}）⇒ 没跑出结果 / 没选中条目时看不见开关`);
  } else if (reason === "FILE_MISSING" || reason === "NO_FILE") {
    fail.push(`②③ ${p.key} 名册说它有组件，实际 ${reason === "NO_FILE" ? "解析不到源码文件" : `文件不存在（${p.file}）`}`);
  } else {
    fail.push(`②③ ${p.key} ${reason}`);
  }
}

console.log(`\n· 现算名册 ${roster.pages.length} 页（R1 ${roster.sources.byRule.R1.length} · R2 ${roster.sources.byRule.R2.length} · R3 ${roster.sources.byRule.R3.length} · R4 ${roster.sources.byRule.R4.length} · R5 ${roster.sources.byRule.R5.length}）· 有理由排除 ${roster.excluded.length} 个沙盘内部构件`);
console.log(`· 挂对 ${ok} · 已知缺口 ${gap}（在册·只减不增） · 交叉断言违规 ${roster.violations.length}`);

if (fail.length) {
  console.error(`\n🔴 edge-active-mounts:check 未通过（${fail.length} 条）：`);
  for (const m of fail) console.error("  - " + m);
  process.exit(1);
}
console.log(`\n🟢 edge-active-mounts:check 通过（名册现算不手抄 · ${ok}/${roster.pages.length} 页挂载合规 · ${gap} 个已知缺口在册且只减不增）。`);
}
