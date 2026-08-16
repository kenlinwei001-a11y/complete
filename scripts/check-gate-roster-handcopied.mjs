#!/usr/bin/env node
/**
 * 门 `gate-roster:check` · **门内写死名册的普查门**（WO-GATE-ROSTER-SWEEP · 闭 `G-GATE-ROSTER-HANDCOPIED`）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * 一道门只能证明「**它问过的那些**是对的」，证明不了「**该问的都问了**」。
 * 凡把**受检对象集合**手抄成数组写死在门自己的源码里，不在名单里的对象就**永远绿**。
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『名单里那几个都合格』当作『所有该合格的都合格』的证据，而前者并不度量后者。」**
 *
 * 这是**整类**病，不是某一道门的个案。已实测的两个现场：
 *  · `check-boundary-singlesource.mjs`（本单 ① 已修）——「内联 baseId 回潮」扫描面手抄 3 个文件，
 *    而那 3 个恰是当年修干净的那 3 个 ⇒ 门每天报「内联 0（零容忍）」，
 *    全仓真有 5 个名单外文件 24 处内联，**从未被问过一次**。A/B 实证：同一棵树同一个变异，
 *    旧脚本 RC=0 且打印「内联 0」，新脚本 RC=1 点名 file:line。
 *  · `check-edge-active-mounts.mjs` 的 `PAGES` 手抄 9 条 / 推演页现算 12 条（另单 WO-INFER-PAGE-SSOT 收）。
 *
 * ══ 本门为什么是「机制」而不是又一张清单 ═══════════════════════════════════════
 * 照铁律 0.6 三级处置：同一个错第 2 次必须建机制，**机制的判据只有一条 ——
 * 下次同样的错发生时，是机器先说话，不是人先想起来。**
 * 逐道门去修是一次性的：明天新加的门照旧可以手抄一份名册，病当天复发。
 * **本门就是那个机制本体** —— 新门里出现未定性的写死集合，当场红。
 *
 * ══ ⚠ 最要紧的一条：**不是所有写死都是病** ═════════════════════════════════════
 * 阈值表 / 错误码表 / 词法表 / 金丝雀样例 / 规范条文抄录 —— 这些**本身就是判据**，
 * 写死是对的；改成"现算"反而是拿被测物去定义判据（自证循环），比原来更糟。
 *
 * **区分只有一句**：
 *   > **这个集合会随仓库演进而变吗？**
 *   > 会变（新增一页 / 一个求解器 / 一个消费方就该进来）⇒ **该现算**（`roster`）
 *   > 不会变（它定义"什么算合格"，改它 = 改规范）      ⇒ **是判据本体**（`criteria`）
 *
 * 这句话**机器判不了** —— 它问的是集合的**语义**，源码里只有**写法**；
 * 拿写法猜语义正是铁律 0.6 点名的代理指标病。故本门的分工是**刻意**这样切的：
 *   · **机器**（`scripts/lib/roster-hardcode.mjs`）：按客观形态抽全部候选 + 给可核对的信号；
 *   · **人**（`scripts/gate-roster-baseline.json`）：逐条定性 + 写 `why`；
 *   · **门**（本文件）：**没定性的候选 = 红**，`roster` 债**只降不升**，死账也红。
 *
 * ══ 四条判据（同时成立才算过）══════════════════════════════════════════════════
 *  ① **无未定性**：现算候选 ⊆ 基线键集合。新门写死一份名册而没定性 ⇒ 红。
 *  ② **无死账**：基线键集合 ⊆ 现算候选。常量改名/删了而账还挂着 ⇒ 红（跑 `--tighten` 收）。
 *  ③ **定性合法且有理由**：`verdict ∈ {criteria, computed, roster}`，`why` ≥ 20 字。
 *     无理由的定性 = 白名单，正是本门要治的病。
 *  ④ **`roster` 债棘轮**：`roster` 条数不许超过 `ratchetHigh`。
 *     评审唯一必须拒绝的一行，就是把 `ratchetHigh` 调大。
 *
 * ══ 诚实边界（不许读成「全仓已无写死名册」）════════════════════════════════════
 *  · 本门**只扫 `scripts/check-*.mjs` 的顶层常量**。函数体内的临时数组、
 *    `switch` 分支里的字符串、以及**基线 json 里**的名册，本门看不见。
 *    （顶层限制是刻意的：全扫会把候选从 68 涨到几百条，真信息被噪声淹没 = 门失效。）
 *  · 本门**判不了**某个 `roster` 的差集是多少 —— 那要跑到被测系统里现算，
 *    每道门的现算逻辑各不相同。差集逐条记在基线的 `why` 与 `docs/AUDIT-gate-roster-sweep.md`。
 *  · 定性是**人写的**，写错了本门不知道。它保证的是「每一条都被人看过且给了理由」，
 *    **不是**「每一条定性都对」。把 `roster` 写成 `criteria` 就能骗过本门 ——
 *    这一步靠 diff 可审（改定性 = 一处显眼 diff）+ 人工复审接住。
 *
 * ══ 金丝雀（保命判据 · 每次运行都先跑）════════════════════════════════════════
 * `rosterCanary()` 与主逻辑**共用** `scripts/lib/roster-hardcode.mjs` 的解析器本体，
 * 不另抄一份正则（抄了就是装饰品：改主正则时金丝雀拿旧的去测、照样绿）。
 * **双向**：必中样例漏了 ⇒ 工具瞎了；必不中样例报了 ⇒ 工具乱咬。
 * 另有**扫描面下界自证**：门脚本数 / 候选数低于下界 ⇒ 报「工具坏了」RC=2，
 * **不许**报「全仓没有写死的名册」——「我没找到」和「它不存在」是两个命题。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-GATE-ROSTER-HANDCOPIED`（本门所闭断点）。
 * 用法：
 *   node scripts/check-gate-roster-handcopied.mjs            # 门（0 干净 / 1 有违规 / 2 工具坏了）
 *   node scripts/check-gate-roster-handcopied.mjs --census    # 现算全表（含信号与定性）
 *   node scripts/check-gate-roster-handcopied.mjs --selftest  # 只跑金丝雀（双向）
 *   node scripts/check-gate-roster-handcopied.mjs --seed      # 首次建账
 *   node scripts/check-gate-roster-handcopied.mjs --tighten   # 收紧（只删死账，不收编新候选）
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRosters, signals, rosterId, rosterCanary, VERDICTS } from "./lib/roster-hardcode.mjs";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";
import { listGateScripts } from "./gate-census.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts/gate-roster-baseline.json");

/**
 * 扫描面下界（金丝雀 · 失败的危险方向在这里）。
 * 枚举器一坏（目录改名 / 过滤写反）集合就变空 ⇒ 差集恒空 ⇒ 门**恒绿**且一声不吭。
 * 实测 2026-08-16：门 82 道、顶层常量集合 352 个、候选名册 68 个。
 */
const MIN_GATES = 60;
const MIN_CANDIDATES = 30;
/** `why` 下限。20 字以下写不出「凭什么这条今天可以这样定性」，那就是白名单不是理由。 */
const MIN_WHY = 20;

const BASELINE_NOTE =
  "① 本文件是 `check-gate-roster-handcopied.mjs` 的**全门定性账**：每一个写死在门源码里的顶层常量集合逐条定性。" +
  "**受检对象集合（扫哪些门）由 `scripts/gate-census.mjs` 的 `listGateScripts()` 现算**，本文件里一个门文件名都不存 —— " +
  "否则本门自己就犯了它要治的病（名单一手抄，新加的门就永远不在里面）。" +
  "② `verdict` 三选一，处置完全不同、不许合并：" +
  "`criteria`=判据本体（写死是对的，`why` 要答「凭什么它不随仓库演进而变」）；" +
  "`computed`=已现算（抽到的只是现算逻辑的输入常量，如扫描根/词法表）；" +
  "`roster`=**真债**（受检对象集合写死了，`why` 必须写**差集是多少**、**该从哪儿现算**、**差什么才能修**）。" +
  "③ `why` <20 字即判红：无理由的定性就是白名单，正是本门要治的病。" +
  "④ `ratchetHigh` 是 `roster` 债的历史最高水位，**只降不升**；评审唯一必须拒绝的一行就是把它调大。" +
  "⑤ `--tighten` **只删死账、不收编新候选**：新候选必须人手定性，自动收编 = 买来一片绿。";

function toolBroken(what, detail = "") {
  console.error(`⛔ gate-roster:check **工具坏了**：${what}`);
  console.error("   本次结论作废：**不许**读作「全仓没有写死的名册 / 门都干净 / 通过」——本门这次什么都没证明。");
  if (detail) console.error("   " + detail);
  process.exit(2);
}

/** 现算：扫全部门脚本，抽出候选名册。**门的名册本身也是现算的**（listGateScripts）。 */
function liveCandidates() {
  const gates = listGateScripts();
  const out = new Map();
  let totalConsts = 0;
  for (const f of gates) {
    const p = join(ROOT, "scripts", f);
    if (!existsSync(p)) continue;
    for (const e of extractRosters(readFileSync(p, "utf8"))) {
      totalConsts++;
      const s = signals(e);
      if (!s.candidate) continue;
      out.set(rosterId(f, e.name), { file: f, name: e.name, kind: e.kind, ...s });
    }
  }
  return { gates, out, totalConsts };
}

function main() {
  const argv = process.argv.slice(2);

  /* ── 保命判据：金丝雀先跑（双向）。不过 ⇒ RC=2「门自己坏了」──────────────── */
  const c = rosterCanary();
  if (!c.ok) toolBroken(`金丝雀${c.got}（解析器本体已失效，普查结果不可信）`, `期望：${c.want}`);
  const bc = baselineDocCanary();
  if (!bc.ok) toolBroken(`基线写入器金丝雀${bc.got}`);
  if (argv.includes("--selftest")) {
    console.log(`✓ 金丝雀：${c.got}；基线写入器：${bc.got}`);
    return 0;
  }

  const { gates, out: live, totalConsts } = liveCandidates();
  /* ── 扫描面下界自证：集合塌陷时报「工具坏了」，不报「没有写死的名册」──────── */
  if (gates.length < MIN_GATES) toolBroken(`只枚举到 ${gates.length} 个门脚本（下界 ${MIN_GATES}）—— 枚举器坏了，不是门没了`);
  if (live.size < MIN_CANDIDATES) toolBroken(`只抽出 ${live.size} 个候选名册（下界 ${MIN_CANDIDATES}，实测应约 68）—— 抽取器坏了，不是全仓干净了`);

  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;

  if (argv.includes("--census")) {
    console.log(`· 门 ${gates.length} 道 · 顶层常量集合 ${totalConsts} 个 · 候选名册 ${live.size} 个`);
    const known = base?.entries ?? {};
    const rows = [...live.entries()].sort((a, b) => (b[1].pathish - a[1].pathish) || (b[1].n - a[1].n));
    for (const [id, v] of rows) {
      const k = known[id];
      console.log(`  [${k?.verdict ?? "未定性"}] n=${v.n} 路径${v.pathish} 键${v.keyish}  ${id}  ${JSON.stringify(v.sample)}`);
    }
    const tally = {};
    for (const k of Object.values(known)) tally[k.verdict] = (tally[k.verdict] ?? 0) + 1;
    console.log(`· 定性分布：${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(" · ") || "（尚未建账）"}`);
    return 0;
  }

  if (argv.includes("--seed") || argv.includes("--tighten")) {
    const isTighten = argv.includes("--tighten");
    const prev = base?.entries ?? {};
    const next = {};
    for (const id of live.keys()) {
      // --tighten **只删死账、不收编新候选**：自动收编就是买来一片绿。
      if (isTighten && !(id in prev)) continue;
      next[id] = prev[id] ?? { verdict: "roster", why: "【待人定性】--seed 落的机器事实，尚未写明这个集合会不会随仓库演进而变。" };
    }
    const rosterCount = Object.values(next).filter((e) => e.verdict === "roster").length;
    const prevHigh = typeof base?.ratchetHigh === "number" ? base.ratchetHigh : rosterCount;
    const nextHigh = Math.min(prevHigh, rosterCount); // 只降不升：杜绝 --update 悄悄抬水位买绿（本仓真发生过 87→94）
    // ⚠ `buildBaselineDoc(` 必须**内联在写入表达式里**：`baseline-writer-honesty:check` 判的是
    //   「写的那一刻用没用共享写入器」，先赋值给中间变量再写会被判 HAND_ROLLED。
    writeFileSync(
      BASELINE,
      JSON.stringify(buildBaselineDoc({
        prev: base,
        generatedBy: `node scripts/check-gate-roster-handcopied.mjs ${isTighten ? "--tighten" : "--seed"}`,
        prose: { note: BASELINE_NOTE },
        computed: { entries: next, candidateCount: Object.keys(next).length, rosterCount, ratchetHigh: nextHigh },
      }), null, 2) + "\n",
    );
    console.log(`✓ 基线已写：候选 ${Object.keys(next).length} 条 · roster 债 ${rosterCount} 条 · ratchetHigh ${nextHigh}（${isTighten ? "只删死账" : "首次建账"}）`);
    return 0;
  }

  if (!base) {
    toolBroken("找不到 scripts/gate-roster-baseline.json —— 定性账是本门的输入，缺账即无从判定",
      "先跑：node scripts/check-gate-roster-handcopied.mjs --seed");
  }
  const known = new Map(Object.entries(base.entries ?? {}));
  const fails = [];

  /* ── 判据①：无未定性 ────────────────────────────────────────────────────── */
  for (const [id, v] of live) {
    if (!known.has(id)) {
      fails.push(
        `① 未定性的写死集合：${id}（${v.n} 个字面量 · 路径类 ${v.pathish} · 键类 ${v.keyish}）${JSON.stringify(v.sample)}\n` +
          `      问自己一句：**这个集合会随仓库演进而变吗？** 会变 ⇒ 该现算（记 roster 并写差集）；不会 ⇒ 是判据本体（记 criteria 并写理由）。`,
      );
    }
  }
  /* ── 判据②：无死账 ──────────────────────────────────────────────────────── */
  for (const id of known.keys()) {
    if (!live.has(id)) fails.push(`② 死账：基线里有 ${id}，但现算已抽不到（常量改名/删了）——请跑 --tighten 收账`);
  }
  /* ── 判据③：定性合法且有理由 ────────────────────────────────────────────── */
  for (const [id, e] of known) {
    if (!e || !VERDICTS.has(e.verdict)) {
      fails.push(`③ ${id} 的 verdict="${e?.verdict ?? ""}" 非法，只许 criteria | computed | roster`);
      continue;
    }
    if (typeof e.why !== "string" || e.why.trim().length < MIN_WHY) {
      fails.push(`③ ${id} 缺 why（<${MIN_WHY} 字）——无理由的定性就是白名单，正是本门要治的病`);
    }
    if (e.verdict === "roster" && !/差集|漏|从未|现算|差什么/.test(e.why ?? "")) {
      fails.push(`③ ${id} 定性为 roster 但 why 里没写差集/漏了什么 —— roster 的 why 必须答「漏检了多少、该从哪儿现算」`);
    }
  }
  /* ── 判据④：roster 债棘轮（只降不升）─────────────────────────────────────── */
  const rosterNow = [...known.values()].filter((e) => e?.verdict === "roster").length;
  if (typeof base.ratchetHigh === "number" && rosterNow > base.ratchetHigh) {
    fails.push(`④ 棘轮：roster 债 ${rosterNow} 条 > ratchetHigh ${base.ratchetHigh} —— 只许降不许升（新写死的名册要么现算掉，要么证明它是判据本体）`);
  }
  if (typeof base.candidateCount === "number" && base.candidateCount !== known.size) {
    fails.push(`④ 基线自洽：candidateCount=${base.candidateCount} ≠ entries 条数 ${known.size}（改额度必须是一处显眼 diff）`);
  }

  const tally = {};
  for (const e of known.values()) tally[e?.verdict] = (tally[e?.verdict] ?? 0) + 1;
  console.log(
    `· 现算：门 ${gates.length} 道 · 顶层常量集合 ${totalConsts} 个 · 候选名册 ${live.size} 个` +
      `　定性：${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(" · ")}（ratchetHigh ${base.ratchetHigh}）`,
  );

  if (fails.length) {
    console.error(`\n✗ gate-roster:check 未通过（${fails.length} 条）：`);
    for (const m of fails) console.error(`  - ${m}`);
    console.error(
      "\n  守的命题：**门只能证明「它问过的那些是对的」，证明不了「该问的都问了」。**\n" +
        "  受检对象集合必须现算；写死则必须同批加一条「名单 vs 现算」的一致性断言。\n" +
        "  本体 §8 G-GATE-ROSTER-HANDCOPIED · 全门定性表见 docs/AUDIT-gate-roster-sweep.md",
    );
    return 1;
  }
  console.log(`\n✓ gate-roster:check 通过（无未定性候选 · 无死账 · 定性合法且各有理由 · roster 债 ${rosterNow} ≤ ratchetHigh ${base.ratchetHigh}）。`);
  return 0;
}

/* ── 顶层兜底（Program 直接子语句）：未预期异常一律归 RC=2「工具坏了」，不是 RC=1「代码坏了」。 */
try {
  process.exit(main());
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}
