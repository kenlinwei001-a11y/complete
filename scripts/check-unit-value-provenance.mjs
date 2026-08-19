#!/usr/bin/env node
/**
 * WO-SNAPSHOT-UNIT-LIE · **值级**量纲门：带 `@unit` 的契约字段，**塞进去的值必须量纲自证**。
 *
 * ── 为什么要这道门（它拦的是一个真发生过的错，不是假想）─────────────────────────────
 * `G-LEVER-SNAPSHOT-UNIT-LIE`（2026-08-14 登记 · 本单收口）：
 * `RiskBoardView.tsx` 写 `snapshot={{ …, capWanP50: card.peak, capWanP90: card.peak, … }}`
 * —— `card.peak` 是**张力峰值（0–100 无量纲指数）**，而 `capWanP50` 的契约 `@unit` 是
 * **万套/窗口**。该快照整份进 `plan_change` 的 ActionDraft payload，`ActionsPage` 又把
 * payload 原样打给审批人看 ⇒ **审批留痕里记着一个假的产能数，审批的人看不出来。**
 *
 * 三道既有防线一道都没拦住，各有各的**度量错位**：
 *   · `check-quantile-field-naming`：守「一个**名字**只对应一个量纲」。`capWanP50` 名字
 *     量纲唯一、`@unit` 写得好好的 ⇒ 三条判据全过。它**守不了塞进去的值**。
 *   · UI 门：看屏上的字，而这个数**不上屏**（只进 payload）。
 *   · TypeScript：两边都是 `number`。**量纲不在类型系统里。**
 * 形态（铁律 0.6 句式）：
 *   **「我用『字段名的量纲唯一』当作『这个字段里的值量纲正确』的证据，而前者并不度量后者。」**
 * 本门就是补上那个「后者」的机器判据 —— 名级门管名字，本门管**值的来路**。
 *
 * ── 判据（UNPROVEN：右值量纲无凭即红）───────────────────────────────────────────
 * 「这个值的量纲对不对」在一般情形下**不可判定**（要真值/真语义）。所以本门不去判「对不对」，
 * 只判一件可判定的事：**这个赋值的量纲有没有凭据**。四条凭据，满足任一即绿：
 *   (a) **同名自证**：右值末端标识符 == 字段名（`out.capWanP50` → `capWanP50`）；
 *   (b) **同量纲字段**：右值末端标识符是另一个 `@unit` 相同的契约字段；
 *   (c) **零元**：右值字面量 `0`（无量纲零，不引入量纲信息）；
 *   (d) **人手背书**：同一行带 `@unit <量纲>` 注释，且与契约声明**逐字相同**
 *       —— 背书是**看得见、可审计、会被门点名统计**的；写错量纲照样红。
 * 其余一律 **UNPROVEN**。这是**保守**方向的判据：宁可多报「无凭」，不许漏报 ——
 * 反过来（默认放行、只在能证伪时报红）恰恰就是让本病活到今天的那种设计。
 *
 * ⚠ 判据(a)对本病**真的有牙**：`capWanP50: card.peak` 的末端标识符是 `peak`，
 *   既不等于 `capWanP50`、也不是任何 `@unit` 字段 ⇒ UNPROVEN 命中（实测见基线 diff）。
 *
 * ── 注册表：只认「名字自带口径」的字段（不硬编码清单）──────────────────────────────
 * 注册表从契约的 `@unit` 标注**现算**，但只收**名字量纲唯一**的字段：
 * 同一个 zod 字段名在契约里若**有的带 `@unit` 有的不带**，说明这个名字本身不自带口径
 * （`qty` / `target` / `demand` / `rolling` 这类泛名就是），对它设防会把
 * `target: "Model"`、`target: AuthCtx = body.user` 这种毫不相干的行判成量纲违规。
 * **实测**：不加这条限制 ⇒ 注册表 27 项、全仓 259 条红，其中绝大多数是泛名噪音；
 * 加上之后 ⇒ 注册表 11 项、红 33 条，且病灶行**在列**。
 * 一道会喊 259 次狼的门就是装饰品，故本门刻意把射程收到「已满足 R18 的那批字段」。
 * **这也是本门的诚实边界**（写在这里而不是藏着）：泛名字段的值级量纲，本门管不了；
 * 要管，得先让那些名字自带口径（那是 `quantile-field-naming` 那道门的活）。
 *
 * ── 棘轮 ────────────────────────────────────────────────────────────────────
 * 存量 UNPROVEN 逐文件落基线，只许降不许升；且带**反向遍历基线的松弛检测**
 * （基线高于实测 = 免检名额 ⇒ 判红，不是判绿）。
 *
 * ── 金丝雀（铁律 0.6）───────────────────────────────────────────────────────
 * 四条已知答案的合成样例，跑的都是下面那一个 `analyze()`，**不是另抄的正则**。
 * 任一不符 ⇒ 报「工具坏了」并 exit 2，**不许**报「全仓量纲干净 / 零命中」。
 *
 * 用法：
 *   node scripts/check-unit-value-provenance.mjs            # 判
 *   node scripts/check-unit-value-provenance.mjs --update   # 写/收紧基线（只降不升）
 * RC：0 干净 · 1 真违规（新增或松弛）· 2 工具坏了（含任何未预期异常，见顶层兜底）
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";

const ROOT = process.cwd();
const CONTRACT_DIR = "packages/contracts/src";
/** 扫描树：两系统 src + 契约自身（契约里也会写值，如默认值/示例）。 */
const SCAN_ROOTS = ["apps/datacore/src", "apps/agentcore/src", "apps/frontend-shell/src", "packages/contracts/src"];
/* 扫描面自证的独立口径分母（2026-08-19 · WO-GATE-SCAN-SURFACE-CENSUS）：
 * 4 根递归 .ts/.tsx 总量下界 —— 当日现算 634，取 ~60%。
 * 单根整个消失时 collectSources 会 throw（有兜底），但**部分塌陷**（过滤失手/子树跳过）
 * 无任何信号 ⇒ 「UNPROVEN 0 新增」会是真空绿。塌到下界以下 ⇒ toolBroken RC=2。 */
const MIN_SOURCE_FILES = 380;
const BASELINE = resolve(ROOT, "scripts/unit-value-provenance-baseline.json");
const BASELINE_NOTE =
  "值级量纲棘轮（G-LEVER-SNAPSHOT-UNIT-LIE）。逐文件记 UNPROVEN 条数，只许降不许升；" +
  "基线高于实测 = 免检名额，同样判红。存量多为 mock/fixture 里的数字字面量（量纲看着对，但门证不了），" +
  "要销账就在那一行补 `/* @unit <量纲> */` 背书 —— 背书是看得见的，放宽判据是看不见的。";

/** 一行 zod 字段声明：`  name: z.…`。与 `check-quantile-field-naming` 同形。 */
const FIELD_DECL = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*z\./;
/** 文档标注里的量纲：`@unit 电芯/日`，取到**该行**行尾（`m` 不可省，见名级门的记账）。 */
const UNIT_TAG = /@unit[ \t]+([^\n*]+?)[ \t]*(?:\*\/|$)/m;

/**
 * 注释块起始行判据：该行**以** `/*` 开头（允许前置空白）。
 *
 * ⚠ 记账（本门建门当天实测，照铁律 0.6）：初版抄名级门写的是 `line.includes("/*")`，
 * 结果 `capWanP50` 的 JSDoc 里有一句 `（万套/**年**·需求）` —— `万套/` 后面跟着 `*`，
 * `includes("/*")` 当场为真 ⇒ 注释块从那一行就"开始"了，把上面真正写着 `@unit` 的那行
 * 切在块外 ⇒ **`capWanP50` 取不到量纲**，注册表里根本没有它。
 * 后果不是报错，是**这道门对着本病最核心的那个字段视而不见还打印绿灯**。
 * 判据改成「行首是 `/*`」即修好。金丝雀④ 固化这个形态，防回潮。
 */
const COMMENT_OPEN = /^\s*\/\*/;

// ────────────────────────────────────────────────────────────────────────────
// 唯一实现：主判据与金丝雀都调它（抄一份给金丝雀 = 装饰品）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 取某个 zod 字段声明**紧邻上方**的注释块（只跳空行，**不跳兄弟声明行**）。
 * 跳兄弟行会把上一个字段的 `@unit` 算到自己头上 —— 那正是「注册表里冒出
 * `ok = 万套/窗口`、`verdict = 吨`」的来路（本门建门当天实测过）。
 */
function commentBlockAbove(lines, declIdx) {
  let j = declIdx - 1;
  while (j >= 0 && lines[j].trim() === "") j--;
  const block = [];
  if (j >= 0 && lines[j].includes("*/")) {
    while (j >= 0) {
      block.unshift(lines[j]);
      if (COMMENT_OPEN.test(lines[j])) break;
      j--;
    }
  } else {
    while (j >= 0 && /^\s*\/\//.test(lines[j])) {
      block.unshift(lines[j]);
      j--;
    }
  }
  block.push(lines[declIdx]); // 行尾同行注释也算
  return block.join("\n");
}

/**
 * 从契约源码建**值级量纲注册表**。
 * 只收「名字量纲唯一」的字段：同名字段在契约里若出现过**没有** `@unit` 的声明，
 * 说明这个名字不自带口径（泛名），一律剔除 —— 见文件头「注册表」一节的实测数字。
 *
 * @returns {{ registry: Map<string,string>, dropped: {name:string, units:(string|null)[]}[] }}
 */
export function buildUnitRegistry(contractSources) {
  const seen = new Map();
  for (const { file, text } of contractSources) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = FIELD_DECL.exec(lines[i]);
      if (!m) continue;
      const tag = UNIT_TAG.exec(commentBlockAbove(lines, i));
      if (!seen.has(m[1])) seen.set(m[1], { units: new Set(), at: [] });
      seen.get(m[1]).units.add(tag ? tag[1].trim() : null);
      seen.get(m[1]).at.push(`${file}:${i + 1}`);
    }
  }
  const registry = new Map();
  const dropped = [];
  for (const [name, v] of seen) {
    const units = [...v.units];
    if (units.length === 1 && units[0] !== null) registry.set(name, units[0]);
    else if (units.some((u) => u !== null)) dropped.push({ name, units, at: v.at });
  }
  return { registry, dropped };
}

/** 右值的**末端标识符**：`round(out.capWanP50)` → `capWanP50`；`card.peak` → `peak`。 */
function tailIdent(rhs) {
  const m = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(rhs.replace(/[)\]\s]+$/, ""));
  return m ? m[1] : null;
}

/**
 * **唯一实现**：给注册表 + 若干 `{file,text}`，回「量纲赋值点 + UNPROVEN 违规」。
 */
export function analyze(registry, sources) {
  const sites = [];
  for (const { file, text } of sources) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (/^\s*\*/.test(ln) || /^\s*\/\//.test(ln)) continue; // 注释行不是赋值
      for (const [name, unit] of registry) {
        const m = new RegExp(`(?:^|[\\{,(\\s])${name}\\s*:\\s*([^,\\n}]+)`).exec(ln);
        if (!m) continue;
        const rhs = m[1].trim();
        if (/^z\./.test(rhs)) continue; // zod 声明本身
        if (/^(number|string|boolean)\b/.test(rhs)) continue; // 类型位
        if (/^["'`]/.test(rhs)) continue; // 字符串字面量：非数值位（标签/键名）
        if (/^\{/.test(rhs)) continue; // 对象字面量：描述符（如 { formula } / { type:"number" }），非标量赋值

        const t = tailIdent(rhs);
        const attest = UNIT_TAG.exec(ln);
        let proof = null;
        if (t === name) proof = "SAME_FIELD";
        else if (t && registry.get(t) === unit) proof = "SAME_UNIT_FIELD";
        else if (/^0$/.test(rhs)) proof = "ZERO";
        else if (attest && attest[1].trim() === unit) proof = "ATTESTED";
        // 背书写了但量纲对不上 ⇒ 不算凭据（背错比不背更危险，必须点名）。
        const attestedWrongUnit = !!attest && attest[1].trim() !== unit;
        sites.push({ file, line: i + 1, name, unit, rhs, proof, attestedWrongUnit });
      }
    }
  }
  const unproven = sites.filter((s) => s.proof === null);
  const byFile = {};
  for (const s of unproven) byFile[s.file] = (byFile[s.file] ?? 0) + 1;
  return { sites, unproven, byFile, ok: unproven.length === 0 };
}

function collectSources(dir) {
  const out = [];
  if (!existsSync(dir)) throw new Error(`扫描根不存在：${dir}`);
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...collectSources(p));
    else if (d.name.endsWith(".ts") || d.name.endsWith(".tsx")) out.push({ file: relative(ROOT, p), text: readFileSync(p, "utf8") });
  }
  return out;
}

function toolBroken(msg, detail) {
  console.error(`🛠️  **工具坏了**（${msg}）—— ⛔ 不许把本次结果读作「全仓量纲干净 / 零命中」。`);
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

function main() {
  // ── 金丝雀：四条已知答案的合成样例，跑的是上面那两个 export ────────────────────
  // ① 病灶原样：`capWanP50: card.peak` 必须被抓（这是本门存在的理由，抓不到=门白建）
  const C_CONTRACT = [
    {
      file: "canary-contract.ts",
      text:
        `export const A = z.object({\n` +
        `  /**\n   * 窗口内产能中位口径。\n   * @unit 万套/窗口\n   * 与需求（万套/**年**）不是同一个量。\n   */\n` +
        `  capWanP50: z.number(),\n` +
        `  /** 需求量。@unit 万套/窗口 */\n  otherWanP90: z.number(),\n` +
        `  /** 泛名：这里带 @unit …… @unit 套 */\n  qty: z.number(),\n` +
        `});\n` +
        `export const B = z.object({\n  qty: z.number(),\n});\n`,
    },
  ];
  const { registry: cReg, dropped: cDrop } = buildUnitRegistry(C_CONTRACT);
  const C_USE = [
    {
      file: "canary-use.ts",
      text:
        `const bad = { capWanP50: card.peak };\n` + //            ① UNPROVEN（病灶原样）
        `const good1 = { capWanP50: out.capWanP50 };\n` + //      ② SAME_FIELD
        `const good2 = { capWanP50: otherWanP90 };\n` + //        ③ SAME_UNIT_FIELD
        `const good3 = { capWanP50: 0 };\n` + //                  ④ ZERO
        `const good4 = { capWanP50: 21.4 /* @unit 万套/窗口 */ };\n` + // ⑤ ATTESTED
        `const bad2 = { capWanP50: 21.4 /* @unit 电芯/日 */ };\n` + //    ⑥ 背错量纲 ⇒ 仍红
        `const skip = { qty: 1200 };\n`, //                       ⑦ 泛名不设防
    },
  ];
  const cRes = analyze(cReg, C_USE);
  const unprovenNames = cRes.unproven.map((u) => `${u.name}:${u.rhs}`);

  const checks = {
    "①注册表只收量纲唯一名（capWanP50 在 · qty 被剔）": cReg.has("capWanP50") && !cReg.has("qty") && cDrop.some((d) => d.name === "qty"),
    "②多行 JSDoc 里含 `/**` 的正文不切断量纲提取": cReg.get("capWanP50") === "万套/窗口",
    "③病灶原样被抓（capWanP50: card.peak）": unprovenNames.includes("capWanP50:card.peak"),
    // 七条样例里恰好 2 条该红：病灶原样 + 背错量纲。四条凭据（同名/同量纲/零元/正确背书）全放行，
    // 泛名 `qty: 1200` 根本不进射程。`cRes.sites.length === 6` 钉住「泛名没被扫进来」这一半。
    "④四条凭据都放行 + 背错量纲仍红 + 泛名不设防":
      cRes.unproven.length === 2 &&
      cRes.sites.length === 6 &&
      cRes.unproven.some((u) => u.attestedWrongUnit) &&
      unprovenNames.includes("capWanP50:21.4 /* @unit 电芯/日 */"),
  };
  const badCanary = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (badCanary.length) {
    console.error("🛠️  **工具坏了**：金丝雀不符预期 ——");
    for (const b of badCanary) console.error(`   ✗ ${b}`);
    console.error(`   registry=${JSON.stringify([...cReg])} dropped=${JSON.stringify(cDrop.map((d) => d.name))}`);
    console.error(`   unproven=${JSON.stringify(unprovenNames)}`);
    console.error("   ⛔ 不许把本次结果读作「全仓量纲干净 / 零命中」。");
    process.exit(2);
  }
  console.log(
    `✅ 金丝雀 4/4：注册表剔泛名（qty 出局）· 多行 @unit 取对（capWanP50=${cReg.get("capWanP50")}）· ` +
      `病灶原样被抓（capWanP50: card.peak）· 四条凭据放行且背错量纲仍红`,
  );

  const bc = baselineDocCanary();
  if (!bc.ok) toolBroken(`基线写入器金丝雀不过：${bc.got}`, `期望：${bc.want}`);

  // ── 真扫 ────────────────────────────────────────────────────────────────
  const { registry, dropped } = buildUnitRegistry(collectSources(resolve(ROOT, CONTRACT_DIR)));
  if (registry.size === 0) toolBroken("契约里一个带 @unit 的量纲唯一字段都没扫到（注册表为空）");

  const sources = SCAN_ROOTS.flatMap((r) => collectSources(resolve(ROOT, r)));
  if (sources.length < MIN_SOURCE_FILES)
    toolBroken(`扫描面只枚举到 ${sources.length} 个 .ts/.tsx（下界 ${MIN_SOURCE_FILES}）—— 枚举部分塌陷，不是「全仓量纲都有凭据」`);
  const r = analyze(registry, sources);

  console.log(`\n注册表（名字量纲唯一 · 现算自契约 @unit）${registry.size} 项：`);
  for (const [k, u] of registry) console.log(`   ${k.padEnd(24)} ${u}`);
  if (dropped.length) {
    console.log(`\n射程外（同名有的带 @unit 有的不带 ⇒ 名字不自带口径，本门不设防）${dropped.length} 项：`);
    for (const d of dropped) console.log(`   ${d.name.padEnd(24)} ${d.at.length} 处声明`);
  }
  console.log(`\n量纲赋值点 ${r.sites.length} 处：有凭 ${r.sites.length - r.unproven.length} · UNPROVEN ${r.unproven.length}`);
  console.log(`  （扫描面 ${sources.length} 个源文件，下界 ${MIN_SOURCE_FILES}，已过 ⇒ 射程没塌）`);

  if (process.argv.includes("--update")) {
    const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
    const doc = buildBaselineDoc({
      prev,
      generatedBy: "node scripts/check-unit-value-provenance.mjs --update",
      prose: { note: BASELINE_NOTE, gate: "scripts/check-unit-value-provenance.mjs", ontologyRef: "§7 · G-LEVER-SNAPSHOT-UNIT-LIE" },
      computed: { total: r.unproven.length, files: r.byFile },
    });
    writeFileSync(BASELINE, JSON.stringify(doc, null, 1) + "\n");
    console.log(`✅ 基线已写：${Object.keys(r.byFile).length} 个文件 / ${r.unproven.length} 条 → ${relative(ROOT, BASELINE)}`);
    process.exit(0);
  }

  if (!existsSync(BASELINE)) toolBroken(`基线缺失 ${relative(ROOT, BASELINE)} —— 先跑 --update`);
  const base = JSON.parse(readFileSync(BASELINE, "utf8"));
  const baseFiles = base.files ?? {};

  // ── 松弛检测（反向遍历基线）：基线**高于**实测 = 一格免检名额 ⇒ 判红 ─────────────
  // 正向遍历发现不了：`r.byFile` 只含**有命中**的文件，被修干净的文件根本不在里面。
  const slack = [];
  for (const [f, b] of Object.entries(baseFiles)) {
    const a = r.byFile[f] ?? 0;
    if (a < b) slack.push(`${f}：基线 ${b} > 实测 ${a} ⇒ 余 ${b - a} 格免检名额`);
  }

  const fresh = [];
  for (const [f, n] of Object.entries(r.byFile)) {
    const b = baseFiles[f] ?? 0;
    if (n > b) {
      const hits = r.unproven.filter((u) => u.file === f).slice(0, 4);
      fresh.push(`${f} 量纲无凭 ${b} → ${n}：` + hits.map((h) => `L${h.line} \`${h.name}: ${h.rhs.slice(0, 40)}\`（该字段 @unit ${h.unit}）`).join(" · "));
    }
  }
  // 背错量纲：任何时候都红，不吃棘轮（背书写错比不背更危险 —— 它会骗过复审的人眼）。
  const misAttested = r.sites.filter((s) => s.attestedWrongUnit);

  if (slack.length) {
    console.error(`\n❌ 棘轮松弛（${slack.length} 个文件）——**这不是通过**`);
    slack.forEach((s) => console.error("  · " + s));
    console.error("\n  为什么这算不通过：余量 = 免检名额。新塞进这些文件的量纲谎报不会被抓，");
    console.error("  而门还会照常打印「量纲无凭未新增」——**这正是本仓最贵的那种假绿**。");
    console.error("  修法：`node scripts/check-unit-value-provenance.mjs --update` 把基线收到实测值。");
  }
  if (fresh.length) {
    console.error(`\n❌ 新增量纲无凭（${fresh.length} 个文件）`);
    fresh.forEach((f) => console.error("  · " + f));
    console.error("\n  判据：**这个值凭什么是那个量纲？** 四条凭据任选其一 ——");
    console.error("    (a) 右值末端就是同名字段  (b) 右值是同 @unit 的另一个字段");
    console.error("    (c) 字面量 0              (d) 同行写 `/* @unit <与契约逐字相同的量纲> */` 人手背书");
    console.error("  一条都给不出 ⇒ 这个值的量纲**没有凭据**，而它可能正流向审批留痕（R4 审批面）。");
  }
  if (misAttested.length) {
    console.error(`\n❌ 背书量纲与契约对不上（${misAttested.length} 处·不吃棘轮）`);
    for (const s of misAttested.slice(0, 10)) console.error(`  · ${s.file}:${s.line} \`${s.name}\` 契约 @unit ${s.unit}，而该行背书写的是别的量纲`);
    console.error("  背错比不背更危险：它会骗过复审的人眼（人看见有背书就默认核过了）。");
  }

  if (slack.length || fresh.length || misAttested.length) {
    console.error(`\n🔴 未通过（松弛 ${slack.length} · 新增 ${fresh.length} · 背书错 ${misAttested.length}）。`);
    process.exit(1);
  }
  console.log(`\n🟢 ${r.sites.length} 处量纲赋值：无新增无凭赋值，棘轮无松弛（存量 ${r.unproven.length} 条在基线内）。`);
}
