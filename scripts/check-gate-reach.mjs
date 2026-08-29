#!/usr/bin/env node
/**
 * 门 `gate-reach:check`（WO-GATE-REACH-SWEEP 建 · 射程对账门 · 闭本体 §8 G-GATE-SCOPE-MISSES-SUBJECT）：
 *
 * ── 治什么 ──────────────────────────────────────────────────────────────────
 * 一道门 RC=0、金丝雀全中，**同时**可以 100% 漏检 —— 金丝雀只证明检测逻辑活着，
 * 一个字都不说**扫描面**选没选对（2026-08-17 实测：`dev-jargon:check` 6/6 全中 +
 * 漏掉屏上文案真正住的 `locales/zh.ts`；扩射程后同一份旧代码 10 条 → 135 条）。
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『门 RC=0 且金丝雀全中』当作『被守的那件事没出问题』的证据，
 *      而前者并不度量后者 —— 射程里有没有被检测对象，金丝雀结构上无从知道。」**
 *
 * 本门对**每一道门**现算三列并求差集（对账表落 `docs/AUDIT-gate-reach-sweep.md`）：
 *   · **声称**：`scripts/gate-ledger.json` 该门的 `guardedPaths`（台账责任边界）；
 *   · **实际**：`scripts/lib/reach-surface.mjs` 从门源码 AST 抽出的扫描面（含本地 import 追两层）；
 *   · **差集**：声称⊄实际 = 射程缺口候选 · 实际⊄声称 = 台账欠账候选。
 *
 * ── 分工（与 roster 门同款，刻意）─────────────────────────────────────────────
 *   · **机器**（本门）：现算差集，**没定性的差集 = 红**；基线死账 = 红；棘轮只降不升。
 *   · **人**（`scripts/gate-reach-baseline.json`）：逐条定性 + 写 `why`（≥20 字）。定性三分：
 *       `POINTER`         —— 台账写的是**责任指针**（红时找谁/去哪修），不是扫描对象；
 *                           `why` 必须引门头/注释**原文**作证。
 *       `EXTRACTOR-BLIND` —— 门真的读，但读取形态抽取器跟不了（环境变量/子进程输出/HTTP）；
 *                           `why` 必须写门实际怎么读到它。
 *       `EXTRACTOR-SHAPE` —— 差集条目与已登记条目**同义不同形**（glob vs 具体目录）；
 *                           `why` 必须写清两者为何同范围。
 *     ⚠ **没有 `REAL-GAP` 定性**：真缺口（台账说守 X、实现不读 X、而门就该守 X）唯一的
 *     处置是**修门**（本单实物：`check-arg-drop-seam.mjs` 的 ceo-route.ts —— 已修，见
 *     其断言⓪）。落账买绿 = 把假绿制度化，正是本门要治的病。
 *
 * ── 金丝雀（铁律 0.6）───────────────────────────────────────────────────────
 * `reachCanary(ts)`（向数现算 · 样例全部取自生产实物形状）跑的是
 * `lib/reach-surface.mjs` 导出的 `extractSurface/covered/reconcile` **本体**，
 * 不另抄一份正则。任一不符 ⇒ 报「工具坏了」RC=2，**不许**报「全仓射程已对齐」。
 * 另有变异反证三笔（2026-08-20 真跑，证据在台账 provenRed）：
 *   M1 抽掉一条基线定性 ⇒ RC=1 点名未定性差集；M2 给某门台账塞一条它根本不读的
 *   guardedPath ⇒ RC=1 点名 GAP；M3 给某门源码加一个扫描常量 ⇒ RC=1 点名 UNDECLARED。
 *
 * ── 依赖：typescript 编译器 API ─────────────────────────────────────────────
 * 抽取走 AST 不走正则（正则死在词法层：正则字面量里的反引号、模板串里的假路径，
 * 见 lib 头注）。typescript 由 `check-gate-exit-discipline.mjs` 同款 createRequire 取；
 * 取不到 ⇒ RC=2「工具坏了」，**不许**静默降级正则（降级 = 把两类已修掉的坑请回来）。
 *
 * 用法：
 *   node scripts/check-gate-reach.mjs            # 判
 *   node scripts/check-gate-reach.mjs --update   # 收紧基线（只删死账/落新候选，定性靠人补）
 * RC：0 干净 · 1 真违规（未定性差集 / 死账 / 棘轮松弛 / 定性非法）· 2 工具坏了
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { listGateScripts } from "./gate-census.mjs";
import { extractSurface, reconcile, reachCanary } from "./lib/reach-surface.mjs";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";

const ROOT = process.cwd();
const LEDGER_PATH = resolve(ROOT, "scripts/gate-ledger.json");
const BASELINE = resolve(ROOT, "scripts/gate-reach-baseline.json");
const BASELINE_NOTE =
  "射程差集定性账（G-GATE-SCOPE-MISSES-SUBJECT）。机器现算每道门「声称（台账 guardedPaths）vs 实际（源码扫描面）」" +
  "的双向差集；差集条目逐条由人定性（POINTER 责任指针 / EXTRACTOR-BLIND 抽取器边界 / EXTRACTOR-SHAPE 同义异形），" +
  "没有 REAL-GAP 定性 —— 真缺口只能修门，落账买绿 = 把假绿制度化。entryCount/ratchetHigh 只降不升。";
const VERDICTS = new Set(["POINTER", "EXTRACTOR-BLIND", "EXTRACTOR-SHAPE"]);
const MIN_WHY = 20;
const FOLLOW_DEPTH = 2; // 门 → 本地 lib → lib 的 lib（再深没见过，见到了先查是不是环）

function toolBroken(msg, detail) {
  console.error(`🛠️  **工具坏了**（${msg}）—— ⛔ 不许把本次结果读作「全仓门射程已对齐 / 零差集」。`);
  if (detail) console.error(detail);
  process.exit(2);
}

// 只有直接跑本文件时才执行并可能 process.exit —— 被 import 当判据库时不许把宿主进程带走。
// ⚠️ `try` 必须是 **Program 的直接子语句**（`check-gate-exit-discipline.mjs` 只认这一形态）。
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
try {
  if (isMain) main();
} catch (e) {
  toolBroken("未预期异常", e?.stack ?? String(e));
}

/** 差集条目的稳定 id（刻意不含行号 —— 行号会漂）。 */
function diffId(gate, direction, path) {
  return `${gate}|${direction}|${path}`;
}

/**
 * 现算全门对账表。**这是本门唯一的计算入口**，--update 与判责共用。
 * @returns {{rows: Array, diffs: Map<string,{gate:string,direction:string,path:string}>, counts: object}}
 */
export function computeReconciliation(ts, ledger) {
  const gates = listGateScripts();
  // 深度感知 + 环安全缓存：同一文件被更深请求时补追 import；缓存先于递归落（A⇄B 互引不死循环）。
  // 教训两条（都是本单实测）：① 只按「有没有」缓存会让 layout-legibility→sim-ux-criteria
  //   这条 import 把后者以 depth 0 存进缓存，轮到它自己时射程永远缺一层；
  //   ② 递归前不落缓存，互引即死循环。重复条目无害（covered/declared 是集合语义）。
  const cache = new Map(); // file -> {surface, depth}
  const surfaceOf = (file, depth) => {
    const hit = cache.get(file);
    if (hit && hit.depth >= depth) return hit.surface;
    let src;
    try {
      src = readFileSync(join(ROOT, "scripts", file), "utf8");
    } catch (e) {
      toolBroken(`门源码读不出：scripts/${file}`, e?.message);
    }
    const s = hit ? hit.surface : extractSurface(src, file, ts);
    cache.set(file, { surface: s, depth });
    if (depth > 0) {
      for (const e of s.filter((x) => x.origin === "import")) {
        const sub = e.path.replace(/^scripts\//, "");
        for (const se of surfaceOf(sub, depth - 1)) s.push({ ...se, via: `${file}→${se.via}` });
      }
    }
    return s;
  };

  const rows = [];
  const diffs = new Map();
  let clean = 0;
  for (const g of gates) {
    const entry = ledger[g];
    if (!entry) toolBroken(`台账缺门：${g}（gate-ledger:check 应该先红 —— 它的账与本门不同步）`);
    const claimed = entry.guardedPaths || [];
    const surface = surfaceOf(g, FOLLOW_DEPTH);
    const r = reconcile(claimed, surface);
    if (!r.gaps.length && !r.undeclared.length) clean++;
    for (const p of r.gaps) diffs.set(diffId(g, "gap", p), { gate: g, direction: "gap", path: p });
    for (const p of r.undeclared) diffs.set(diffId(g, "undeclared", p), { gate: g, direction: "undeclared", path: p });
    rows.push({ gate: g, claimed, surfaceCount: surface.length, gaps: r.gaps, undeclared: r.undeclared });
  }
  return { rows, diffs, counts: { gates: gates.length, clean, withDiffs: gates.length - clean } };
}

function main() {
  // ── 金丝雀先行（铁律 0.6：扫描类结论一律先自证工具）──────────────────────────
  const req = createRequire(resolve(ROOT, "scripts/check-gate-exit-discipline.mjs"));
  let ts;
  try {
    ts = req("typescript");
  } catch (e) {
    toolBroken("typescript 编译器 API 取不到（AST 抽取的硬依赖，不许降级正则）", e?.message);
  }
  const canary = reachCanary(ts);
  if (!canary.ok) toolBroken(`射程抽取器金丝雀不过：${canary.got}`, `期望：${canary.want}`);
  console.log(`✅ 射程抽取器金丝雀：${canary.got}`);
  const bc = baselineDocCanary();
  if (!bc.ok) toolBroken(`基线写入器金丝雀不过：${bc.got}`, `期望：${bc.want}`);

  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  const { rows, diffs, counts } = computeReconciliation(ts, ledger.gates || ledger);
  console.log(
    `· 对账：门 ${counts.gates} 道 · 双向零差 ${counts.clean} 道 · 有差集 ${counts.withDiffs} 道 · 差集条目 ${diffs.size} 条`,
  );

  // ── --update：收紧基线（死账删掉、新候选落【待人定性】，棘轮只降不升）─────────
  if (process.argv.includes("--update")) {
    const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
    const next = {};
    for (const [id, d] of diffs) {
      next[id] = prev?.entries?.[id] ?? {
        verdict: "POINTER",
        why: "【待人定性】--update 落的机器事实，尚未写明这条差集为何可以这样定性。",
      };
    }
    const dropped = Object.keys(prev?.entries ?? {}).filter((k) => !next[k]);
    const entryCount = Object.keys(next).length;
    const prevHigh = typeof prev?.ratchetHigh === "number" ? prev.ratchetHigh : entryCount;
    const ratchetHigh = Math.min(prevHigh, entryCount);
    // ⚠️ `buildBaselineDoc(...)` **必须内联在 `writeFileSync` 的实参里**，不许先抽成 `const doc`。
    //    `baseline-writer-honesty:check` 的判据认的就是「写入点实参里有没有这个调用」——
    //    抽成变量在文本上一样合规，在判据上不合规，本门此前正是栽在这个子形态（HAND_ROLLED (b)）。
    //    判据这么严不是吹毛求疵：`note` 字段有两个主人（脚本常量 vs 基线正文里的人手挂账），
    //    `--update` 永远最后写 ⇒ 谁绕过共享写入器，谁就会静默吞掉别人写的「为何这条不许豁免」。
    //    ratchetHigh 先算出来单独持有，只为下面那行 console.log 用 —— 它不是绕道，是同一个值。
    writeFileSync(
      BASELINE,
      JSON.stringify(
        buildBaselineDoc({
          prev,
          generatedBy: "node scripts/check-gate-reach.mjs --update",
          prose: { note: BASELINE_NOTE, gate: "scripts/check-gate-reach.mjs", ontologyRef: "§7 · G-GATE-SCOPE-MISSES-SUBJECT" },
          computed: { entries: next, entryCount, ratchetHigh },
        }),
        null,
        1,
      ) + "\n",
    );
    console.log(
      `✅ 基线已写：差集 ${entryCount} 条（死账清除 ${dropped.length} 条）· ratchetHigh ${ratchetHigh} → ${relative(ROOT, BASELINE)}`,
    );
    if (dropped.length) for (const d of dropped) console.log(`   - 死账 ${d}`);
    process.exit(0);
  }

  // ── 判 ────────────────────────────────────────────────────────────────────
  if (!existsSync(BASELINE)) toolBroken(`基线缺失 ${relative(ROOT, BASELINE)} —— 先跑 --update`);
  const base = JSON.parse(readFileSync(BASELINE, "utf8"));
  const entries = base.entries ?? {};
  const fails = [];

  // ① 无未定性差集：现算差集 ⊆ 基线键
  for (const [id, d] of diffs) {
    if (!entries[id]) {
      fails.push(
        `① 未定性差集：${d.gate} 的${d.direction === "gap" ? "台账声称" : "实际射程"}「${d.path}」` +
          `${d.direction === "gap" ? "不在其实现的扫描面里（射程缺口候选）" : "不在台账 guardedPaths 里（台账欠账候选）"}` +
          ` —— 定性（POINTER / EXTRACTOR-BLIND / EXTRACTOR-SHAPE，各带原文证据）或修门/修账。`,
      );
    }
  }
  // ② 无死账：基线键 ⊆ 现算差集（差集消失了还挂着账 = 棘轮松了一格没人知道）
  for (const id of Object.keys(entries)) {
    if (!diffs.has(id)) fails.push(`② 基线死账：${id} —— 差集已消失，跑 --update 收紧（只降不升，不许留着买绿）`);
  }
  // ③ 定性合法且有理由
  for (const [id, e] of Object.entries(entries)) {
    if (!VERDICTS.has(e?.verdict)) fails.push(`③ ${id} verdict 非法（${e?.verdict}）—— 只许 ${[...VERDICTS].join("/")}`);
    if (typeof e?.why !== "string" || e.why.trim().length < MIN_WHY || e.why.includes("【待人定性】")) {
      fails.push(`③ ${id} 缺 why（<${MIN_WHY} 字或未定性）—— 无理由的定性就是白名单，正是本门要治的病`);
    }
    if (e?.verdict === "POINTER" && !/「|"|`|L\d+|行/.test(e?.why ?? "")) {
      fails.push(`③ ${id} 定性 POINTER 但 why 里没引原文/出处 —— 责任指针必须指得出它写在哪`);
    }
  }
  // ④ 棘轮：差集定性账条数只降不升
  const prevHigh = typeof base.ratchetHigh === "number" ? base.ratchetHigh : 0;
  if (Object.keys(entries).length > prevHigh) {
    fails.push(
      `④ 棘轮松弛：定性账 ${Object.keys(entries).length} 条 > 历史高水位 ${prevHigh}` +
        ` —— 水位只能降（修门/修账销条目）或平，不许升。评审唯一必须拒绝的一行就是把 ratchetHigh 调大。`,
    );
  }

  if (fails.length) {
    console.error(`\n🔴 gate-reach:check 未通过（${fails.length} 条）：`);
    for (const f of fails) console.error("  · " + f);
    console.error(
      "\n  两个方向都要想清楚再定性：声称⊄实际 = 门也许根本没看它说要守的东西（去修门）；\n" +
        "  实际⊄声称 = 门守的东西台账没写，门红时没人知道该找谁（去修账）。\n" +
        "  ⛔ 没有「REAL-GAP 认账」这个出口 —— 真缺口只能修门，落账买绿 = 把假绿制度化。",
    );
    process.exit(1);
  }

  const byVerdict = {};
  for (const e of Object.values(entries)) byVerdict[e.verdict] = (byVerdict[e.verdict] ?? 0) + 1;
  console.log(
    `\n🟢 gate-reach:check 通过：${counts.gates} 道门对账完毕（双向零差 ${counts.clean} 道）· 差集 ${diffs.size} 条全部定性` +
      `（${Object.entries(byVerdict).map(([k, v]) => `${k} ${v}`).join(" · ") || "无"}）· 棘轮 ${Object.keys(entries).length} ≤ ${prevHigh}。`,
  );
  if (process.argv.includes("--table")) {
    console.log("\n── 全门对账表（声称/实际/差集）──");
    for (const r of rows) {
      const mark = r.gaps.length || r.undeclared.length ? "◑" : "✓";
      console.log(`${mark} ${r.gate}  声称 ${r.claimed.length} 条 · 射程 ${r.surfaceCount} 条 · gap ${r.gaps.length} · undeclared ${r.undeclared.length}`);
    }
  }
}
