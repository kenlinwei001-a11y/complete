#!/usr/bin/env node
/**
 * 门 `fact-usage:check` · **事实使用注册表不退化门**（WO-FACT-USAGE-REGISTRY）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * `docs/PRD-harness-ux-adoption.md` §4.2 明账 **B-3（U5 跨屏面）** 的前置。原账写着：
 *   > 要比对「同一事实在两屏的值」，先得知道**哪个事实出现在哪两屏**。
 *   > 本仓没有「事实 → 读取它的页面集合」的可枚举注册表 ——
 *   > **连该比哪两个数都列不出来，真浏览器也无从下手。**
 * 注册表由 `scripts/lib/fact-usage.mjs` **现算**（AST，不手抄名单）。本门守它**不退化**。
 *
 * ══ ⛔ 本门**不**判什么（不许把它的绿读成 B-3 已闭）═══════════════════════════
 * 本门**一个字都不判「两屏的值相不相等」**。那要真渲染两屏读 DOM，归
 * `WO-GATE-B-BROWSER-HARNESS`。本门只守「该比哪两个数」这份清单不缩水、每条说得出依据。
 * 形态提醒（铁律 0.6）：**「我用『注册表建好了』当作『B-3 验完了』的证据」** —— 那是两件事。
 *
 * ══ 判据（四条，同时成立才 RC=0）═══════════════════════════════════════════════
 *   D1 **抽取器没瞎**（先于一切）：金丝雀逐条全中（条数现算自 `CANARY_IDS`，不写死）+ **独立词面口径逐族对总数**
 *      （AST 认出的 solver/object 调用位数 ≥ 剥注释后的词面数）。任一不成立 ⇒ **RC=2**，
 *      报「工具坏了」，**不许**报「注册表没变化 / 仓库很干净」。
 *   D2 **规模棘轮**：事实条数 / 跨 ≥2 屏的事实条数 / 跨屏对数 三个数**只许涨不许跌**
 *      （相对 `scripts/fact-usage-baseline.json`）。跌 = 有页面/读取位从受检面掉出去了 ——
 *      这正是 `G-GATE-ROSTER-HANDCOPIED` 那一族「不在名单里就永远绿」的退化路径。
 *   D3 **依据链非空**：注册表里每条事实的**每个页**都要说得出「在哪个 file:line、经哪个绑定」读的。
 *      一条说不出依据的记录 = 手抄名单的等价物，必须红。
 *   D4 **口径分家清单不许静默缩小**：`CALIBER-DIVERGENT`（同源同字段不同 args）条数也上棘轮。
 *      它是「7 日 vs 14 日」那类分叉的清单；悄悄变少通常意味着**某一屏的读取位没被认出来**。
 *
 *   收紧基线：`--tighten`（只许把三个数改大 / 把 `CALIBER-DIVERGENT` 改成实测值）。
 *   `--seed` 首次建账（基线已存在则拒绝）。`--census` 打印全量注册表（给审计文档用）。
 *
 * ══ 三条金丝雀纪律的落实（今天各被实证栽过一次）════════════════════════════════
 *  ① **扫描面**：金丝雀证明工具没瞎，**不证扫描面选对了**。本门的扫描面 = 页根组件的
 *     **本地 import 传递闭包**（不是「只扫页文件」），且把闭包规模逐页打印出来备查
 *     （`--census`）。只扫页文件会漏掉所有共享面板里的读取位。
 *  ② **覆盖率**：金丝雀全中不保证抽取器覆盖全。故 D1 里**必带独立词面口径对总数**，
 *     且**逐族对**（solver / object 各对各的）—— 拿含 rest 的总数去盖 solver 的缺口，
 *     正是「我用 X 当作 Y 的证据」。
 *  ③ **样例形状**：金丝雀样例形状取自生产实物（多行 `useQuery`、`Schema.parse(res.data)`、
 *     `{ out: res.data, snapshotVersion }`、`.map((o)=>o.props.so)`、`for…of`），不是手写单行。
 *
 * 退出码三分：0 干净 · 1 真违规（先修代码/基线） · 2 门自己坏了（只许说「我没查出来」）。
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门 `fact-usage:check`）· §8（`G-FACT-USAGE-UNREGISTERED`）。
 * 用法：node scripts/check-fact-usage.mjs [--census] [--seed] [--tighten] [--json]
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * node 对未捕获异常一律退 1 —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM）会被读成「你的代码有问题」，方向正好相反。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」*/
process.on("uncaughtException", (e) => gateToolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   ")));
process.on("unhandledRejection", (e) => gateToolBroken(`未预期 rejection（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   ")));

function gateToolBroken(what, hint) {
  console.error(`⛔ check-fact-usage.mjs：${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「注册表没退化 / 事实都登记了 / 通过」——本门这次没跑完，它什么都没证明。");
  if (hint) console.error("   " + hint);
  process.exit(2); // 2 = 门自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}

import { readdirSync, readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  loadTs, parseEndpointsModule, buildPageRoster, computeFactUsage, factUsageCanary,
  FRONTEND_SRC, ENDPOINTS_FILE, REGISTRY_FILE, APP_FILE,
} from "./lib/fact-usage.mjs";
import { parseRendererFiles, parseStaticRouteFiles } from "./lib/sim-page-roster.mjs";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/fact-usage-baseline.json");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

/** 只收生产 UI 源（`mocks/` 是 MSW 假数据源，进来会把 fixture 当成屏上读取）。 */
const EXCLUDE_DIRS = new Set(["mocks", "locales", "styles", "assets"]);

function collectFiles(dir, out, base) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const abs = join(dir, ent.name);
    const rel = `${base}/${ent.name}`;
    if (ent.isDirectory()) {
      if (EXCLUDE_DIRS.has(ent.name)) continue;
      collectFiles(abs, out, rel);
    } else if (/\.(ts|tsx)$/.test(ent.name) && !/\.d\.ts$/.test(ent.name)) {
      out.set(rel, readFileSync(abs, "utf8"));
    }
  }
}

function main() {
  /* ── D1 先自证工具（金丝雀 + 独立口径），不中一律 RC=2 ─────────────────────── */
  let ts;
  try { ts = loadTs(); } catch (e) { gateToolBroken(`typescript 加载不到（${e?.message || e}）—— 先 \`pnpm install --prefer-offline\``); }

  const canary = factUsageCanary();
  if (!canary.ok) {
    console.error("⛔ 金丝雀不中 ⇒ **抽取器瞎了**，本次不产出任何结论：");
    for (const b of canary.bad) console.error("   · " + b);
    process.exit(2);
  }

  const srcDir = join(ROOT, FRONTEND_SRC);
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
    gateToolBroken(`扫描面不存在：${FRONTEND_SRC} —— 是不是在错的工作目录里跑的？`);
  }
  const files = new Map();
  collectFiles(srcDir, files, FRONTEND_SRC);
  if (files.size < 50) gateToolBroken(`只收到 ${files.size} 个前端源文件（本仓量级应为数百）⇒ 扫描面塌了，结论作废`);

  const endpointsSrc = files.get(ENDPOINTS_FILE);
  const registrySrc = files.get(REGISTRY_FILE);
  const appSrc = files.get(APP_FILE);
  for (const [n, v] of [[ENDPOINTS_FILE, endpointsSrc], [REGISTRY_FILE, registrySrc], [APP_FILE, appSrc]]) {
    if (!v) gateToolBroken(`读不到 ${n} —— 三个真相源缺一，注册表无从算起`);
  }

  const endpointMap = parseEndpointsModule(ts, endpointsSrc);
  if (Object.keys(endpointMap).length < 20) {
    gateToolBroken(`endpoints.ts 只解析出 ${Object.keys(endpointMap).length} 个端点（本仓量级 200+）⇒ 端点解析器瞎了`);
  }

  // 页名册：renderer / 静态 route 两支**复用** sim-page-roster 的既有解析器（RL3 单一来源，不另抄）
  const pages = buildPageRoster({
    registrySrc, appSrc,
    rendererFiles: parseRendererFiles(registrySrc),
    staticRouteFiles: parseStaticRouteFiles(appSrc),
  });
  if (pages.length < 20) gateToolBroken(`页名册只现算出 ${pages.length} 页（本仓量级 80+）⇒ 名册解析器瞎了`);

  const r = computeFactUsage({ ts, files, pages, endpointMap });

  // 独立口径逐族对总数 —— 这一条比金丝雀更能抓住「抽取器越瞎门越绿」
  if (!r.coverage.ok) {
    console.error("⛔ 独立词面口径对不上 AST 抽取数 ⇒ **抽取器瞎了**（金丝雀纪律②：全中也不保证覆盖全）：");
    console.error(`   词面(剥注释)  solver=${r.coverage.lexical.solver}  object=${r.coverage.lexical.object}`);
    console.error(`   AST 认出      solver=${r.coverage.ast.solver}  object=${r.coverage.ast.object}  rest=${r.coverage.ast.rest}`);
    console.error("   本次不产出任何结论：**不许**读作「注册表就这么大 / 没有跨屏事实」。");
    process.exit(2);
  }

  const now = {
    facts: r.stats.facts,
    multiScreenFacts: r.stats.multiScreenFacts,
    pairs: r.stats.pairs,
    caliberDivergent: r.stats.caliberDivergent,
  };

  if (has("--census")) { printCensus(r, endpointMap); if (!has("--seed") && !has("--tighten")) process.exit(0); }
  if (has("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }

  /* ── 建账 / 收紧 ────────────────────────────────────────────────────────── */
  if (has("--seed")) {
    if (existsSync(BASELINE)) { console.error("⛔ 基线已存在，--seed 拒绝覆盖（要收紧用 --tighten）"); process.exit(1); }
    writeBaseline(now, r);
    console.log("✅ 已建账 scripts/fact-usage-baseline.json：" + JSON.stringify(now));
    process.exit(0);
  }
  if (!existsSync(BASELINE)) {
    console.error("⛔ 缺 scripts/fact-usage-baseline.json —— 先 `node scripts/check-fact-usage.mjs --seed`");
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(BASELINE, "utf8"));
  if (has("--tighten")) {
    const shrink = Object.keys(now).filter((k) => now[k] < (base.min?.[k] ?? 0));
    if (shrink.length) {
      console.error(`⛔ --tighten 只许收紧，不许放水：${shrink.map((k) => `${k} ${base.min[k]} → ${now[k]}`).join(" · ")}`);
      process.exit(1);
    }
    writeBaseline(now, r);
    console.log("✅ 棘轮已收紧：" + JSON.stringify(now));
    process.exit(0);
  }

  /* ── D2/D4 棘轮 · D3 依据链 ──────────────────────────────────────────────── */
  const fail = [];
  for (const k of ["facts", "multiScreenFacts", "pairs", "caliberDivergent"]) {
    const min = base.min?.[k] ?? 0;
    if (now[k] < min) {
      fail.push(`D2/D4 规模棘轮回退：\`${k}\` ${min} → ${now[k]}（少了 ${min - now[k]}）—— 有读取位从受检面掉出去了。` +
        `\n        判据不是「数字变小不好看」：注册表缩水 = 某个事实**不再被任何页认领**，` +
        `而 B-3 拿这份清单去比 ⇒ 掉出去的那条**永远绿**（断点 G-GATE-ROSTER-HANDCOPIED 同族）。` +
        `\n        若确属有意（页删了 / 读取位真撤了），跑 \`node scripts/check-fact-usage.mjs --tighten\` 显式改账。`);
    }
  }
  const noWhy = [];
  for (const f of r.facts) {
    for (const pg of f.pages) {
      if (!(f.why?.[pg]?.length)) noWhy.push(`${f.fact} @ ${pg}`);
    }
  }
  if (noWhy.length) {
    fail.push(`D3 依据链为空 ${noWhy.length} 条（说不出在哪个 file:line 读的 = 手抄名单的等价物）：\n        ` + noWhy.slice(0, 8).join("\n        "));
  }

  if (fail.length) {
    console.error("❌ fact-usage:check 判负：");
    for (const f of fail) console.error("   · " + f);
    console.error(`\n   现算：事实 ${now.facts} · 跨 ≥2 屏 ${now.multiScreenFacts} · 跨屏对 ${now.pairs}（其中口径分家 ${now.caliberDivergent}）`);
    console.error(`   基线：事实 ${base.min.facts} · 跨 ≥2 屏 ${base.min.multiScreenFacts} · 跨屏对 ${base.min.pairs}（口径分家 ${base.min.caliberDivergent}）`);
    process.exit(1);
  }

  console.log(`✅ fact-usage:check 通过 —— 事实 ${now.facts} 条（solver ${r.stats.byKind.solver} · object ${r.stats.byKind.object} · rest ${r.stats.byKind.rest}）· 页 ${r.stats.pages}`);
  console.log(`   跨 ≥2 屏的事实 ${now.multiScreenFacts} 条 ⇒ **B-3 该比的跨屏对 ${now.pairs} 组**（同口径应相等 ${r.stats.equalExpected} · 口径分家应各自标明 ${now.caliberDivergent}）`);
  console.log(`   金丝雀 ${canary.total}/${canary.total} 中 · 独立词面口径 solver ${r.coverage.lexical.solver}→AST ${r.coverage.ast.solver} · object ${r.coverage.lexical.object}→AST ${r.coverage.ast.object}（逐族均不少于词面）`);
  console.log("   ⚠ 本门**不判两屏的值相不相等**（要渲染，归 WO-GATE-B-BROWSER-HARNESS）——它只守「该比哪两个数」这份清单不缩水。");
  process.exit(0);
}

function writeBaseline(now, r) {
  writeFileSync(BASELINE, JSON.stringify({
    _doc: [
      "事实使用注册表的**规模棘轮**基线（WO-FACT-USAGE-REGISTRY · 门 scripts/check-fact-usage.mjs）。",
      "这里存的是**下限**不是快照：注册表现算自前端 AST，条数只许涨不许跌。",
      "跌 = 某个事实不再被任何页认领 ⇒ B-3 拿这份清单去比时，掉出去的那条永远绿。",
      "有意收缩（页删了 / 读取位真撤了）走 `--tighten` 显式改账，不许静默。",
    ],
    min: now,
    lastSeen: {
      byKind: r.stats.byKind,
      pages: r.stats.pages,
      equalExpected: r.stats.equalExpected,
      coverage: r.coverage,
    },
  }, null, 2) + "\n");
}

function printCensus(r, endpointMap) {
  const solverUrls = {};
  for (const [fn, ep] of Object.entries(endpointMap)) (solverUrls[ep.url] ??= []).push(fn);
  console.log("── 粒度裁决的现算证据：候选①「按端点」会塌缩成什么 ──");
  const collapsed = Object.entries(solverUrls).filter(([u]) => /\/solvers\/\{\}\//.test(u));
  for (const [u, fns] of collapsed) {
    const keys = new Set(r.facts.filter((f) => f.kind === "solver").map((f) => f.key));
    console.log(`   ${u}  ←  ${fns.join(", ")}  ⇒ 本表现算的求解器键 ${keys.size} 个全部塌缩进这一条模板`);
  }
  console.log(`\n── 页名册（现算 ${r.pages.length} 页 · 读取面 = 本地 import 传递闭包）──`);
  for (const p of r.pages.slice().sort((a, b) => b.reads - a.reads)) {
    console.log(`   ${String(p.reads).padStart(4)} 读取位 · 闭包 ${String(p.files).padStart(3)} 文件 · ${p.key}${p.missing ? "  ⚠ 根组件文件解析不到" : ""}`);
  }
  console.log(`\n── 跨 ≥2 屏的事实 ${r.multi.length} 条（**B-3 真正要比的就是这些**）──`);
  for (const f of r.multi) {
    console.log(`   ${f.fact}`);
    console.log(`      屏(${f.pages.length})：${f.pages.join(" · ")}`);
    console.log(`      args 口径：${f.argsSigs.join(" | ")}${f.argsSigs.length > 1 ? "  ⇒ CALIBER-DIVERGENT（值本就该不同，该断言的是屏上各自标明口径）" : "  ⇒ EQUAL-EXPECTED（该断言两屏读数相等）"}`);
    for (const [pg, why] of Object.entries(f.why)) console.log(`      依据 ${pg}：${why.join(" ; ")}`);
  }
  console.log(`\n── 抽不出来的部分（${r.unresolved.length} 条 · 静态分析看不见，如实留白）──`);
  const byReason = {};
  for (const u of r.unresolved) (byReason[u.reason] ??= []).push(`${u.file}:${u.line}`);
  for (const [reason, sites] of Object.entries(byReason)) console.log(`   [${sites.length}] ${reason}\n        ${sites.slice(0, 12).join("\n        ")}`);
  console.log(`\n── 覆盖率对账 ──\n   ${JSON.stringify(r.coverage)}`);
}

/* 顶层兜底：`try` 必须是 Program 的**直接子语句**（`check-gate-exit-discipline.mjs` 只认这形态）。 */
try {
  main();
} catch (e) {
  gateToolBroken(`主流程抛出（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}
