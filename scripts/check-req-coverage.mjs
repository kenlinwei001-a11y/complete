#!/usr/bin/env node
/**
 * 门 · 需求落地覆盖（check-req-coverage）
 *
 * ── 来历（铁律 0.6 第 3 级处置） ────────────────────────────────────────────
 * 本轮仓主连续三次抓到我遗漏：**时序推演整维 / Solver 性质说错 / 方案比对丢在 UI**。
 * 三次同一形态：
 *   **「我用『我列了一份清单』当作『需求都覆盖了』的证据，而前者不度量后者。」**
 * 第 4 次是 2026-08-09 仓主「不要打补丁……遗漏了我的需求」——
 * 那次的形态更隐蔽：需求没被显式删掉，是被「平台有个近似物」悄悄吸收了。
 *
 * `docs/REQ-LEDGER-sandbox.md` 是那次立的台账，但**台账本身不是机制** ——
 * 台账要人去读、去比、去记得比。机制的判据是：
 *   **下次同样的遗漏发生时，是机器先说话，不是人先想起来。**
 * 本门即那个「机器先说话」。
 *
 * ── 判什么 ──────────────────────────────────────────────────────────────────
 * 台账里每条需求带一个裁决符号：
 *   ♻️ 复用已有   —— 不需要新工作，**不要求**落点
 *   🔗 复用+补一小块 —— 有工作量 ⇒ **必须**在别处有落点
 *   🆕 零承载要新做  —— 有工作量 ⇒ **必须**在别处有落点
 *   ⛔ 不做（仓主已裁）—— **必须**有理由，且理由须是「仓主自己裁的」或「有 file:line 证据
 *                      证明会造第二套真相源」；若理由是「工作量大/独立项目/平台有近似物」，
 *                      本门报 🔴 —— 那三条在 PRD §0.25 里已被判定为**不成立的裁需求理由**
 *
 * 「落点」= 该需求编号（REQ###）在 `docs/` 下**除台账以外**的任一文档里被引用。
 * 强制引用编号，是为了让「这条需求落在哪」变成**机器可判**的，而不是靠人读散文判断。
 *
 * ── 棘轮基线 ────────────────────────────────────────────────────────────────
 * 基线是**具名 ID 清单**，不是一个数字。
 * 拿数字当基线会出事：漏掉 REQ070 同时补上 REQ071，数字不变、门照绿 ——
 * 那正是「我用一个看起来相关的数字当判据，而它并不度量我要度量的东西」（铁律 0.6 原话）。
 *
 * ── 为什么编号是 `REQ###` 而不是 `R###`（2026-08-09 改名，治本不打补丁） ──────
 * 原用 `R###`，与**本体不变量** `R1`–`R19` 共用前缀。后果是真的：
 * `check-prd-ontology` 把 PRD 里的 `R060`/`R143` 读成「引用了本体不存在的不变量」而报红 ——
 * 两个 ID 空间共用前缀，正是欠账 #99「D1/E1 各造一套词表」那个病。
 * 处置不是给门加白名单（那是打补丁），是**把需求 ID 空间整体改名**，让它在词法上就撞不着。
 * 实测本体侧 `R###` 三位数命中 = 0，故 `\bR(\d{3})\b → REQ\1` 的机械改名不会误伤不变量。
 *
 * ── 金丝雀 ──────────────────────────────────────────────────────────────────
 * 与主逻辑共用同一份实现（`refsOf`），不许各抄一份正则。
 *
 * 退出码：0 = 未新增遗漏 · 1 = 检出新遗漏 · 2 = **门自己坏了**
 */

/**
 * ⚠️ 本门度量的是什么 —— 必须说准，否则本门自己就犯了它防的病
 *
 * 本门判的是「**需求编号在 docs/ 下除台账外被引用过**」，
 * **不是**「这条需求真的被实现了」，**也不是**「这条需求在 PRD 里被讨论过」。
 *
 * 三者的区别：
 *   被引用 ⊃ 被讨论 ⊃ 被实现
 * 一条需求可能在 PRD 里用散文讲得很透，却因为没写编号而被本门判成「未落点」。
 * **那不是误报，是本门刻意立的纪律**：只有「落点带编号」，覆盖才是机器可判的；
 * 靠人读散文判断覆盖，正是连续四次遗漏的成因。
 *
 * 所以：
 *   门报「未落点」  ⇒ 「这条需求没有机器可追的落点」——**可能已被讨论，但追不到**
 *   门报「已落点」  ⇒ 「有文档引用了它」——**不等于已实现**（实现状态看台账的裁决列）
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DOCS = "docs";
const LEDGER = join(DOCS, "REQ-LEDGER-sandbox.md");
const BASELINE = "scripts/req-coverage-baseline.json";

/** 裁决符号 → 是否要求有落点 */
const NEEDS_LANDING = { "🆕": true, "🔗": true, "♻️": false, "⛔": false };

/** §0.25 判定为**不成立**的裁需求理由（⛔ 条目命中即报 🔴） */
const BAD_CUT_REASONS = [
  ["工作量", "「工作量大」不是裁需求的理由（PRD §0.25）"],
  ["独立项目", "「是独立项目」不是裁需求的理由（PRD §0.25）"],
  ["近似物", "「平台有个近似物」不是裁需求的理由（PRD §0.25）"],
  ["后续再", "「后续再说」= 无限期推迟，须给可测的触发条件或期次"],
];

const ID_RE = /\*\*(REQ\d{3})\*\*/g;

/** 主逻辑 · 单一实现：一段文本里引用了哪些需求编号。金丝雀与主检测共用它。 */
function refsOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/\bREQ(\d{3})\b/g)) out.add(`REQ${m[1]}`);
  return out;
}

function parseLedger(src) {
  const items = [];
  for (const line of src.split("\n")) {
    const m = /^\s*-\s*\[[ x]\]\s*\*\*(REQ\d{3})\*\*\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, id, rest] = m;
    const verdict = Object.keys(NEEDS_LANDING).find((v) => rest.includes(v)) ?? "?";
    items.push({ id, verdict, text: rest.trim(), line });
  }
  return items;
}

// ── 读台账 ───────────────────────────────────────────────────────────────────
if (!existsSync(LEDGER)) {
  console.error(`✗ **门自己坏了**：台账 ${LEDGER} 不存在 ⇒ 无从判覆盖。不报「全覆盖」。`);
  process.exit(2);
}
const ledgerSrc = readFileSync(LEDGER, "utf8");
const items = parseLedger(ledgerSrc);

// ── 🐤 金丝雀 ① 台账解析器有效性 ────────────────────────────────────────────
const declared = /合计\s*\*?\*?(\d+)\s*条/.exec(ledgerSrc);
if (items.length === 0) {
  console.error(
    `✗ **门自己坏了**：台账解析出 0 条需求（文件 ${ledgerSrc.split("\n").length} 行，非空）。\n` +
      `   ⇒ 报的是「解析器坏了」，**不是**「台账里没有需求」。`,
  );
  process.exit(2);
}
if (declared && Number(declared[1]) !== items.length) {
  console.error(
    `✗ **门自己坏了**：台账自称 ${declared[1]} 条，解析器只认出 ${items.length} 条。\n` +
      `   两个数字必须一致 —— 不一致说明解析器漏了某种写法，此时任何「覆盖率」都是假的。`,
  );
  process.exit(2);
}

// ── 扫 docs/ 下除台账外的全部文档 ────────────────────────────────────────────
const referenced = new Map(); // REQ### -> [文件…]
let scanned = 0;
for (const f of readdirSync(DOCS)) {
  if (!f.endsWith(".md") || join(DOCS, f) === LEDGER) continue;
  scanned++;
  const text = readFileSync(join(DOCS, f), "utf8");
  for (const id of refsOf(text)) {
    if (!referenced.has(id)) referenced.set(id, []);
    referenced.get(id).push(f);
  }
}

// ── 🐤 金丝雀 ② 引用扫描器有效性（与主逻辑同一个 refsOf） ────────────────────
const CANARY_IDS = ["REQ060", "REQ143"]; // 两条我确定在 PRD-UPGRADE 里被引用过的编号
const canaryMiss = CANARY_IDS.filter((id) => !referenced.has(id));
if (canaryMiss.length) {
  console.error(
    `✗ **门自己坏了**：金丝雀 ${canaryMiss.join(" / ")} 在 ${scanned} 份文档里一次都没搜到。\n` +
      `   这两条是已知被 docs/PRD-UPGRADE-decision-sandbox-v2.md 引用的编号。\n` +
      `   ⇒ 报的是「扫描器坏了」，**不是**「这些需求没落地」。\n` +
      `   「我没找到」和「它不存在」是两个不同的命题。`,
  );
  process.exit(2);
}

// ── 判定 ─────────────────────────────────────────────────────────────────────
const unlanded = [];
const badCuts = [];
for (const it of items) {
  if (NEEDS_LANDING[it.verdict] && !referenced.has(it.id)) {
    unlanded.push(it);
  }
  if (it.verdict === "⛔") {
    for (const [needle, why] of BAD_CUT_REASONS) {
      if (it.text.includes(needle)) badCuts.push({ ...it, why });
    }
  }
}

// --update：把当前状态写成新基线。棘轮只许变小 —— 想放大必须显式加 --allow-grow，
// 且脚本会把「放大了多少」打出来，不让基线在无人注意时悄悄膨胀。
if (process.argv.includes("--update")) {
  const firstTime = !existsSync(BASELINE);
  const prev = firstTime ? { unlanded: [] } : JSON.parse(readFileSync(BASELINE, "utf8"));
  // 首次建基线不算「放大」——之前没有基线，不是从小变大，是从无到有。
  const grew = !firstTime && unlanded.length > (prev.unlanded?.length ?? 0);
  if (grew && !process.argv.includes("--allow-grow")) {
    console.error(
      `⛔ 拒绝放大基线：${prev.unlanded.length} → ${unlanded.length}。\n` +
        `   棘轮只许变小。确要放大请加 --allow-grow，并在提交信息里写明为什么。`,
    );
    process.exit(1);
  }
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        _comment:
          "check-req-coverage 棘轮基线。具名 ID 清单，不是数字 —— 拿数字当基线会让「漏一条补一条」照样绿（铁律 0.6）。",
        _meaning: "在此清单里 = 该需求今天没有带编号的落点。不等于「不用做」，只等于「不是本次新欠的」。",
        updatedAt: "2026-08-09",
        unlanded: unlanded.map((i) => i.id).sort(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`✅ 基线已更新：${unlanded.length} 条未落点${grew ? "（⚠️ 已放大）" : ""}`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { unlanded: [], badCuts: [] };
const baseSet = new Set(base.unlanded ?? []);
const newlyUnlanded = unlanded.filter((i) => !baseSet.has(i.id));
const fixed = (base.unlanded ?? []).filter((id) => !unlanded.some((i) => i.id === id));

// ── 报告 ─────────────────────────────────────────────────────────────────────
const need = items.filter((i) => NEEDS_LANDING[i.verdict]).length;
console.log(`🐤 金丝雀：台账 ${items.length} 条与自称一致 · ${CANARY_IDS.join("/")} 在 ${scanned} 份文档里命中 ⇒ 工具有效\n`);
console.log(`需求总数 ${items.length}（🆕${items.filter((i) => i.verdict === "🆕").length} · 🔗${items.filter((i) => i.verdict === "🔗").length} · ♻️${items.filter((i) => i.verdict === "♻️").length} · ⛔${items.filter((i) => i.verdict === "⛔").length}）`);
console.log(`要求有落点的 ${need} 条 → 已落 ${need - unlanded.length} · 未落 ${unlanded.length}（基线 ${baseSet.size}）\n`);

if (fixed.length) console.log(`✅ 本次新落地 ${fixed.length} 条：${fixed.join(" ")}\n`);

if (badCuts.length) {
  console.error(`🔴 ${badCuts.length} 条 ⛔ 的裁决理由不成立（PRD §0.25）：`);
  for (const c of badCuts) console.error(`   ${c.id} — ${c.why}\n      台账原文：${c.text.slice(0, 90)}`);
  console.error("");
}

if (newlyUnlanded.length === 0 && badCuts.length === 0) {
  if (unlanded.length) {
    console.log(`⚠️  仍有 ${unlanded.length} 条在基线内未落地（未新增，门放行）：`);
    console.log(`   ${unlanded.map((i) => i.id).join(" ")}`);
    console.log(`   ——「在基线内」不等于「不用做」，只等于「不是本次新欠的」。`);
  } else {
    console.log(`✅ 要求有落点的 ${need} 条全部有落点。（此否定结论有金丝雀背书）`);
  }
  if (fixed.length) console.log(`\n提示：${fixed.length} 条已修，跑 --update 收紧基线（棘轮只许变小）。`);
  process.exit(0);
}

if (newlyUnlanded.length) {
  console.error(`⛔ 新增 ${newlyUnlanded.length} 条需求**没有任何落点**（docs/ 下除台账外零引用）：\n`);
  for (const i of newlyUnlanded) console.error(`   ${i.id} ${i.verdict} ${i.text.slice(0, 100)}`);
  console.error(
    `\n处置：在 PRD 或 WO 里给它一个落点，并**引用编号**（写 "${newlyUnlanded[0].id}"）。\n` +
      `      若确实该裁掉 → 在台账里改成 ⛔ 并写明理由，理由须是「仓主自己裁的」\n` +
      `      或「有 file:line 证据证明会造第二套真相源」——「工作量大/独立项目/平台有近似物」不算。`,
  );
}
process.exit(1);
