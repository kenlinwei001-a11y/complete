#!/usr/bin/env node
/**
 * WO-P50-RENAME · 分位字段命名门：**一个分位字段名只许对应一个量纲**。
 *
 * ── 为什么要这道门（它拦的是一个真发生过的错，不是假想）─────────────────────────────
 * 2026-08-14 仓主实测撞上：产能推演页的杠杆重算明细表里，表头只写 `p50`，用户分不出
 * 「这行是需求的万套还是产能的电芯」。实测下来 `p50` 这一个名字在本仓背了 **6 个量纲**：
 *
 *   | 出处 | 含义 | 量纲 |
 *   |---|---|---|
 *   | `DemandSegment.p50/p90`（`synthetic/battery.ts`）      | 需求分位       | 万套/年   |
 *   | `CapacityForecastOutput.p50/p90`（`contracts/solvers`）| 窗口产能分位   | 万套/窗口 |
 *   | `ByProcessModelRow.p50`（同上）                        | 工序×型号日产能 | 电芯/日   |
 *   | `BaseCapacityOutlookByModel.p50At30/60/90`（同上）     | T+N 累计可承接 | 套        |
 *   | `sop.ts` 三线对照 row.p90                              | S&OP 滚动下分位 | 万套      |
 *   | `order_fullchain` deliveryJudge.p50/p90                | 周供给判据     | 套/周     |
 *
 * 其中两个都写「万套」但**分母不同**（年 vs 窗口）—— 只写「万套」正是让用户分不出的那半个信息。
 * 更糟的是当时 `capacity.ts` 下发 `unit:"套/天"` 而契约注释写「电芯/日」，**两者差 96 倍**
 * （packCellCount=96），即同一个字段的量纲在两处各写各的（第二真相源）。
 *
 * 人眼逐个数是能查出来的 —— 我这次就是这么查出来的 —— 但**人眼不是机制**
 * （铁律 0.6：下次同样的错必须机器先说话）。
 *
 * ── 判据（三条，都从**契约自身的标注**取，不硬编码任何字段清单）───────────────────────
 * 判据来源 = 契约里的 `@unit <量纲>` 文档标注（或同一 z.object 内的 `unit: z.literal("…")`）。
 * 硬编码一张字段清单是过期的（清单不会随代码长），所以本门只认代码里的标注。
 *
 *   ① **COLLISION**：同一个字段名出现 ≥2 个**不同**量纲 ⇒ 红。
 *      这是本门的主判据 ——「同一个分位字段名不许对应多个单位/含义」。
 *   ② **BARE**：字段名**只由分位标记构成**（`p50` / `p90` / `p50At30` / `cumP90` …），
 *      即名字本身不带任何口径信息 ⇒ 红。
 *      这条同时堵死「为向后兼容留一个旧名别名」——别名与新名量纲相同，判据①抓不到，
 *      判据②抓得到。**第二真相源就是本仓反复治的病，兼容别名是它最常见的伪装。**
 *   ③ **UNDECLARED**：分位字段没有 `@unit` 标注 ⇒ 红。
 *      不加这条的话，绕过本门只需要「不写单位」——那等于把判据交给被判者。
 *
 * ── 金丝雀（铁律 0.6：报否定结论前先自证工具，且金丝雀与主判据**共用同一份实现**）──────
 * 三个已知答案的合成样例，跑的都是下面那一个 `analyze()`，**不是另抄的正则**：
 * 抄一份给金丝雀 = 装饰品（改主正则时金丝雀拿旧的去测、照样绿）。
 * 任一金丝雀不符预期 ⇒ 报「工具坏了」并 exit 2，**不许**报「契约干净 / 没有冲突」。
 *
 * 用法：`node scripts/check-quantile-field-naming.mjs`
 * RC：0 干净 · 1 真违规 · 2 工具坏了（含任何未预期异常，见顶层兜底）
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

/** 契约扫描根（单一来源：跨包共享的形状只许在这里定义）。 */
const CONTRACT_DIR = "packages/contracts/src";

/**
 * 分位字段判据：名字**以**分位标记结尾（可带 `At<天数>` 后缀）。
 * 命中例：`p50` `capWanP50` `packsP50At30` `cumCapWanP90` `deliveryP90`
 * 不命中：`p90_health`（M11 校准参数键，不是字段）· `p95`（timeseries 的**聚合算子枚举值**，不是字段）
 */
const QUANTILE_TAIL = /[Pp](?:10|25|50|75|90|95|99)(?:At\d+)?$/;

/** 「裸分位名」：整个名字就是分位标记（可带 cum 前缀 / At 后缀），不含任何口径信息。 */
const BARE_NAME = /^(?:cum)?[Pp](?:10|25|50|75|90|95|99)(?:At\d+)?$/;

/** 一行 zod 字段声明：`  name: z.…`。 */
const FIELD_DECL = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*z\./;

/**
 * 文档标注里的量纲：`@unit 电芯/日`，取到**该行**行尾（`m` 标志不可省）。
 *
 * ⚠ 这里踩过一次，记账（铁律 0.6）：初版写的是 `/@unit\s+([^\n*]+?)\s*(?:\*\/|$)/`——**没有 `m`**。
 * 于是 `$` 只匹配整段文本的末尾，而真实契约里 `@unit` 是**多行 JSDoc 的中间一行**，
 * 后面还跟着别的说明行 ⇒ 永远匹配不上 ⇒ 所有字段的量纲都退到下面那个「兄弟 unit」兜底去取，
 * 兜底当时又是「上下 40 行内随便找一个 `unit: z.literal`」⇒ `capWanP50`（万套/窗口）
 * 被判成了隔壁 `ByProcessModelRow` 的 **电芯/日**，而门**照样打印绿灯**。
 * 金丝雀当时也没抓到，因为金丝雀写的是**单行** `/** @unit X *​/` 形式 —— 与真实用法不同。
 * ⇒ 教训：**金丝雀必须覆盖生产里真正在用的那个形态**，否则它只是在给自己发合格证。
 */
const UNIT_TAG = /@unit[ \t]+([^\n*]+?)[ \t]*(?:\*\/|$)/m;

/**
 * **唯一实现**：给若干 `{file, text}`，回「分位字段清单 + 三类违规」。
 * 主判据与金丝雀都调它 —— 这就是「金丝雀必须与主逻辑共用同一份实现」那条纪律的落点。
 */
export function analyze(sources) {
  const fields = [];
  for (const { file, text } of sources) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = FIELD_DECL.exec(lines[i]);
      if (!m) continue;
      const name = m[1];
      if (!QUANTILE_TAIL.test(name)) continue;
      fields.push({ name, file, line: i + 1, unit: findUnit(lines, i), bare: BARE_NAME.test(name) });
    }
  }

  // 判据①：名字 → 量纲集合。同名多量纲 = 本门要拦的那个病。
  const byName = new Map();
  for (const f of fields) {
    if (!f.unit) continue;
    if (!byName.has(f.name)) byName.set(f.name, new Map());
    const units = byName.get(f.name);
    if (!units.has(f.unit)) units.set(f.unit, []);
    units.get(f.unit).push(f);
  }
  const collisions = [];
  for (const [name, units] of byName) {
    if (units.size > 1) collisions.push({ name, units: [...units.entries()].map(([u, at]) => ({ unit: u, at })) });
  }

  const bare = fields.filter((f) => f.bare);
  const undeclared = fields.filter((f) => !f.unit);

  return {
    fields,
    collisions,
    bare,
    undeclared,
    ok: collisions.length === 0 && bare.length === 0 && undeclared.length === 0,
  };
}

/**
 * 向上找该字段的量纲标注。
 * 先跳过**同组的兄弟声明行**与空行（`packsP50At30/60/90` 三行共用上方一段注释），
 * 再在紧邻的注释块里找 `@unit`；找不到则退而求其次，看同一 z.object 里的 `unit: z.literal("…")`。
 */
function findUnit(lines, declIdx) {
  let i = declIdx - 1;
  while (i >= 0 && (lines[i].trim() === "" || FIELD_DECL.test(lines[i]))) i--;
  // 收集紧邻的注释块（`*/` 往上直到 `/**`，或连续的 `//`）。
  const block = [];
  if (i >= 0 && lines[i].includes("*/")) {
    while (i >= 0) {
      block.unshift(lines[i]);
      if (lines[i].includes("/**") || lines[i].includes("/*")) break;
      i--;
    }
  } else {
    while (i >= 0 && /^\s*\/\//.test(lines[i])) { block.unshift(lines[i]); i--; }
  }
  // 行尾同行注释也算（`p50: z.number(), // @unit 套`）。
  block.push(lines[declIdx]);
  const tag = UNIT_TAG.exec(block.join("\n"));
  if (tag) return tag[1].trim();

  // 兜底：**同一个 schema 块内**的 `unit: z.literal("…")`（后端量纲单源下发的那种写法）。
  // 边界取「上一个 z.object( 开头」到「下一个 z.object( 开头」——初版用的是「上下 40 行」，
  // 那会跨过 schema 边界把隔壁对象的量纲算到自己头上（见上面 UNIT_TAG 的记账）。
  let lo = 0;
  for (let j = declIdx; j >= 0; j--) if (/z\.object\(\s*\{/.test(lines[j])) { lo = j; break; }
  let hi = lines.length;
  for (let j = declIdx + 1; j < lines.length; j++) if (/z\.object\(\s*\{/.test(lines[j])) { hi = j; break; }
  for (let j = lo; j < hi; j++) {
    const lit = /^\s*unit\s*:\s*z\.literal\(\s*"([^"]+)"/.exec(lines[j]);
    if (lit) return lit[1];
  }
  return null;
}

function collectSources(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...collectSources(p));
    else if (name.name.endsWith(".ts")) out.push({ file: p, text: readFileSync(p, "utf8") });
  }
  return out;
}

// 只有直接跑本文件时才执行并可能 process.exit —— 被 import 当判据库时不许把宿主进程带走。
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { main(); } catch (e) {
    // 顶层兜底：任何未预期异常一律读作「工具坏了」，**不许**读作「契约干净」。
    console.error("🛠️  **工具坏了**（未预期异常，非「契约干净」）：", e?.stack ?? e);
    process.exit(2);
  }
}

function main() {
  // ── 金丝雀：三个已知答案的合成样例，跑的是上面那个 analyze ────────────────────────
  const C_COLLIDE = [
    { file: "canary-a.ts", text: `export const A = z.object({\n  /** @unit 万套/窗口 */\n  p50: z.number(),\n});\n` },
    { file: "canary-b.ts", text: `export const B = z.object({\n  /** @unit 电芯/日 */\n  p50: z.number(),\n});\n` },
  ];
  const C_CLEAN = [
    { file: "canary-c.ts", text: `export const C = z.object({\n  /** @unit 万套/窗口 */\n  capWanP50: z.number(),\n  /** @unit 电芯/日 */\n  cellsPerDayP50: z.number(),\n});\n` },
  ];
  const C_UNDECLARED = [
    { file: "canary-d.ts", text: `export const D = z.object({\n  /** 没写量纲 */\n  fooP90: z.number(),\n});\n` },
  ];
  /**
   * 金丝雀④ —— **生产里真正在用的那个形态**：`@unit` 在多行 JSDoc 的**中间一行**，
   * 且相邻 schema 里有一个**不同**量纲的 `unit: z.literal(...)` 等着被误取。
   * 初版正则（无 `m`）+ 初版兜底（上下 40 行）在这个样例上会把 `barWanP50` 判成「电芯/日」，
   * 而三个旧金丝雀全绿 —— 这条就是当时漏掉的那道判据，补在这里，机器先说话。
   */
  const C_MULTILINE = [
    { file: "canary-e.ts", text:
      `export const Neighbour = z.object({\n` +
      `  /**\n   * 隔壁对象的日产能。\n   * @unit 电芯/日\n   * 后面还有说明行，故 @unit 不在块尾。\n   */\n` +
      `  fooCellsP50: z.number(),\n  unit: z.literal("电芯/日"),\n});\n\n` +
      `export const Target = z.object({\n` +
      `  /**\n   * 窗口内产能。\n   * @unit 万套/窗口\n   * 这一行故意跟在 @unit 后面。\n   */\n` +
      `  barWanP50: z.number(),\n});\n` },
  ];

  const collide = analyze(C_COLLIDE);
  const clean = analyze(C_CLEAN);
  const undecl = analyze(C_UNDECLARED);
  const multi = analyze(C_MULTILINE);
  const barWan = multi.fields.find((f) => f.name === "barWanP50");

  const canaryOk =
    collide.collisions.length === 1 && collide.bare.length === 2 && // p50 同名两量纲 + 两处都是裸名
    clean.ok && clean.fields.length === 2 &&                        // 带口径的两个名字 → 干净
    undecl.undeclared.length === 1 && !undecl.ok &&                 // 无 @unit → 被抓住
    barWan?.unit === "万套/窗口";                                    // 多行 @unit 取对，且没串到隔壁的「电芯/日」
  if (!canaryOk) {
    console.error("🛠️  **工具坏了**：金丝雀不符预期 ——");
    console.error(`   同名异量纲样例 → collisions=${collide.collisions.length}（应为 1）· bare=${collide.bare.length}（应为 2）`);
    console.error(`   带口径样例     → ok=${clean.ok}（应为 true）· fields=${clean.fields.length}（应为 2）`);
    console.error(`   缺量纲样例     → undeclared=${undecl.undeclared.length}（应为 1）· ok=${undecl.ok}（应为 false）`);
    console.error(`   多行@unit样例  → barWanP50.unit=${barWan?.unit}（应为「万套/窗口」；若为「电芯/日」= 串到隔壁 schema 了）`);
    console.error("   ⛔ 不许把本次结果读作「契约干净 / 没有冲突 / 零命中」。");
    process.exit(2);
  }
  console.log(
    `✅ 金丝雀 4/4：同名异量纲被抓（${collide.collisions[0].name}：` +
      `${collide.collisions[0].units.map((u) => u.unit).join(" ≠ ")}）· 带口径样例判干净 · 缺 @unit 被抓 ·` +
      ` 多行 @unit 取对（barWanP50=${barWan.unit}，未串隔壁）`,
  );

  const dir = resolve(process.cwd(), CONTRACT_DIR);
  const r = analyze(collectSources(dir));

  console.log(`\n扫描 ${CONTRACT_DIR} → 分位字段 ${r.fields.length} 个：`);
  for (const f of r.fields) console.log(`   ${f.name.padEnd(18)} ${String(f.unit ?? "—").padEnd(12)} ${f.file}:${f.line}`);

  let bad = 0;
  for (const c of r.collisions) {
    bad++;
    console.error(`\n❌ COLLISION · 字段名 \`${c.name}\` 背了 ${c.units.length} 个量纲 —— 用户在屏上分不出是哪个：`);
    for (const u of c.units) console.error(`     ${u.unit}  ←  ${u.at.map((a) => `${a.file}:${a.line}`).join(" , ")}`);
    console.error("   修法：名字自带口径（如 capWanP50 / cellsPerDayP50 / packsP50At90），**不许**靠注释区分。");
  }
  for (const f of r.bare) {
    bad++;
    console.error(`\n❌ BARE · \`${f.name}\`（${f.file}:${f.line}）是**裸分位名**，名字里没有任何口径信息。`);
    console.error("   若这是为向后兼容留的旧名别名 —— 那正是本门要拦的第二真相源，删掉它。");
  }
  for (const f of r.undeclared) {
    bad++;
    console.error(`\n❌ UNDECLARED · \`${f.name}\`（${f.file}:${f.line}）没有 \`@unit\` 标注 ⇒ 本门无从判定量纲。`);
    console.error("   补一行 `/** @unit 电芯/日 */`；不写单位不是通过，是把判据交给了被判者。");
  }

  if (bad > 0) {
    console.error(`\n🔴 ${bad} 处违规（COLLISION ${r.collisions.length} · BARE ${r.bare.length} · UNDECLARED ${r.undeclared.length}）。`);
    process.exit(1);
  }
  console.log(`\n🟢 ${r.fields.length} 个分位字段，每个名字恰好一个量纲，且名字都自带口径。`);
}
