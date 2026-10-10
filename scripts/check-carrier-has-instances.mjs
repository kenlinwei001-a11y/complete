#!/usr/bin/env node
/**
 * 门 `carrier-has-instances:check` · **业务流程承载物→实例存在性门**（WO-GATE4 ②）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * 65 条核心业务流程每条都声明了一个 `carrierTypeKey`（这条流程作用在什么对象上）。
 * 已有的 `apps/datacore/test/process-layer.test.ts` 断言① 守住了**类型层**
 * （「承载物在本体里查得到」），**没有任何东西守实例层**。于是有第三种空壳：
 *
 *   **类型在、一条实例都没有** ⇒ 前端/Agent 从流程行下钻到承载物，拿到的是空列表；
 *   后端 200、查询成功、`total: 0` —— 与「这个基地这周恰好没有工单」**长得一模一样**，
 *   看的人分不出是「业务上确实没有」还是「这类对象根本从没落过库」。
 *
 * ══ 三种"没实例"必须分开（CLAUDE.md 铁律 0.5 判据①：混了必修错地方）═══════════
 *   ① **没接线**       生成器产了行，但 `instantiateBattery` 的物化清单里**没有** `putAll("T", …)`
 *                      ⇒ 修法 = 补物化点（或把流程层的承载物改指一个真会落库的类型）
 *   ② **接了线没数据** 物化清单里有，但行源现读 0 行 ⇒ 修法 = 补种子数据（改物化点没用）
 *   ③ **未判定**       行源表达式本门解析不出（局部变量/复杂拼接）⇒ **如实列出，不进红**
 *                      （不许把「我没排除掉」写成「它是死的」）
 *
 * ══ 判据 ═══════════════════════════════════════════════════════════════════════
 *   B1（硬·棘轮）  每个 `carrierTypeKey` 必须出现在 `apps/datacore/src/synthetic/service.ts`
 *                  的 `putAll("<类型>", <行源>, "<主键>")` 清单里。
 *   B2（硬·棘轮）  该 `putAll` 的行源**现读** ≥1 行（import dist 真跑生成器，不 grep）。
 *   B3（棘轮反向）  基线里的存量条目一旦不再违规，必须删除（只降不升）。
 *
 * **行源现读四臂**（`instantiateBattery` 真正用到的全部生成器，一个都不能少）：
 *   `generateBattery(42,"S")` · `generateExtended(42, ctx, "S")` ·
 *   `generatePlanDomain(…)` · `cadenceObjectRows(deriveChainCadences(g))` · `MOCK_EXTERNAL_DATA`
 *
 * ⚠ **`generateExtended` 的签名是 `(seed, ctx, scale)`，ctx 必须给全**
 *   （`models/bases/lines/equipment/materialBalances/demandSegments`）——传错会**静默**返回空壳，
 *   于是 32 个 `ext.*` 行源全部落进「未判定」，缺口数会被虚报。故金丝雀**显式断言 ext 真产出了行**。
 * ⚠ **`generatePlanDomain` 是第四臂，漏了它会把 `PlanTarget`/`AnnualScenario`/`ScenarioTrigger`
 *   三条误报成零实例** —— 它们的实例不出自前两个生成器（`service.ts:1098-1101`）。
 *   本门 2026-08-13 建立时就是靠追这一层，把一份「8 条缺口」的清单纠正为**这里现算的这份**。
 *
 * ══ 诚实边界（本门**不**保证什么）═══════════════════════════════════════════════
 *  · 只证「demo 合成路径会落库 ≥1 行」，**不证「租户运行态里真有」**（pg 模式、别的行业模板、
 *    真连接器接进来的数据都不在射程）。
 *  · 只看 `synthetic/service.ts` 的 `putAll`。经别的路径写进对象库的类型（如运行期由 Action 写台账的
 *    `AdoptedMitigation`）本门一律看作「种子期零实例」—— 那是**事实**，但它是否算缺陷要人判，
 *    故走具名豁免而不是硬红。
 *  · 不验实例的**内容**对不对（字段齐不齐、值合不合理）。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）。
 * 用法：node scripts/check-carrier-has-instances.mjs   ·   pnpm carrier-has-instances:check
 *      node scripts/check-carrier-has-instances.mjs --list     # 65 条逐条判定表
 *      node scripts/check-carrier-has-instances.mjs --update   # 棘轮基线只许收缩式回写
 */
/* ── 退出码纪律 · 顶层兜底 ─────────────────────────────────────────────────────
 * 0 = 干净 · 1 = 真有问题 · 2 = 工具自己坏了（node 未捕获异常默认退 1，恰好撞上「真有问题」）。 */
process.on("uncaughtException", (e) => gateToolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   ")));
process.on("unhandledRejection", (e) => gateToolBroken(`未预期 rejection（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   ")));
function gateToolBroken(what, hint) {
  console.error(`⛔ check-carrier-has-instances.mjs：${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「承载物都有实例 / 代码干净 / 通过」——本门这次没跑完，它什么都没证明。");
  if (hint) console.error("   " + hint);
  process.exit(2);
}

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertDistFresh } from "./dist-freshness.mjs";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";

const ROOT = process.cwd();
const SEED_SRC = join(ROOT, "apps/datacore/src/seed.ts");
const SVC_SRC = join(ROOT, "apps/datacore/src/synthetic/service.ts");
const BATTERY_DIST = "apps/datacore/dist/synthetic/battery.js";
const EXTENDED_DIST = "apps/datacore/dist/synthetic/battery-extended.js";
const CADENCE_DIST = "apps/datacore/dist/synthetic/cadence.js";
const REGISTRY_DIST = "apps/datacore/dist/connectors/registry.js";
const BASELINE = join(ROOT, "scripts/carrier-instance-baseline.json");

/* ═══════════════════════════════════════════════════════════════════════════
 * 判据本体 —— 金丝雀与主扫描**共用这三个纯函数**，不许各抄一份
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 从 `seed.ts` 抽 65 条 `ProcessDefinition` 的 `(key, carrierTypeKey)`。 */
export function parseCarriers(seedText) {
  const blk = seedText.match(/const DEMO_PROCESS_DEFINITIONS[\s\S]*?=\s*\[([\s\S]*?)\n\];/);
  if (!blk) return null; // null ⇒ 声明变形了，调用方必须报「工具坏了」而不是「一条流程都没有」
  const out = [];
  for (const line of blk[1].split("\n")) {
    const k = line.match(/\bkey:\s*"(P\d{2})"/);
    const c = line.match(/\bcarrierTypeKey:\s*"([A-Za-z0-9_]+)"/);
    if (k && c) out.push({ key: k[1], carrier: c[1] });
  }
  return out;
}

/** 从 `synthetic/service.ts` 抽物化清单 `putAll("<类型>", <行源>, "<主键>")`。 */
export function parsePutAll(svcText) {
  return [...svcText.matchAll(/putAll\(\s*"([A-Za-z0-9_]+)"\s*,\s*([^,]+?)\s*,\s*"([A-Za-z0-9_]+)"\s*\)/g)]
    .map((m) => ({ type: m[1], expr: m[2].trim(), pk: m[3] }));
}

/**
 * 行源表达式 → 真实行数组。**只认下面几种形状**，别的一律返回 `undefined`（= 未判定）。
 * 刻意不用 eval：门不该有执行任意源码的能力，且「解析不出」本来就该是一档可见状态。
 */
export function resolveRows(expr, bind) {
  let m = expr.match(/^(g|ext|pd)\.(\w+)$/);
  if (m) return bind[m[1]]?.[m[2]];
  if (expr === "cadenceObjectRows(deriveChainCadences(g))") return bind.cadenceRows;
  m = expr.match(/^MOCK_EXTERNAL_DATA\.(\w+)!?$/);
  if (m) return bind.mockExternal?.[m[1]];
  return undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 现读 dist（守卫必须在 import 之前）
 * ═══════════════════════════════════════════════════════════════════════════ */
assertDistFresh([BATTERY_DIST, EXTENDED_DIST, CADENCE_DIST, REGISTRY_DIST], { gate: "carrier-has-instances:check" });

let bat, extm, cad, reg;
try {
  bat = await import(`file://${join(ROOT, BATTERY_DIST)}`);
  extm = await import(`file://${join(ROOT, EXTENDED_DIST)}`);
  cad = await import(`file://${join(ROOT, CADENCE_DIST)}`);
  reg = await import(`file://${join(ROOT, REGISTRY_DIST)}`);
} catch (e) {
  gateToolBroken(`载入 datacore 构建产物失败（${e?.message || e}）`, "先跑：pnpm --filter datacore build");
}
for (const [name, fn] of [["generateBattery", bat.generateBattery], ["generateExtended", extm.generateExtended], ["generatePlanDomain", bat.generatePlanDomain], ["cadenceObjectRows", cad.cadenceObjectRows], ["deriveChainCadences", cad.deriveChainCadences]]) {
  if (typeof fn !== "function") gateToolBroken(`\`${name}\` 不是函数（构建产物形状变了？）`);
}

let g, ext, pd, cadenceRows;
try {
  g = bat.generateBattery(42, "S");
  // ⚠ 三个实参一个都不能省：ctx 传错 → 静默返回空壳 → 32 个 ext.* 行源全落「未判定」，缺口数被虚报。
  ext = extm.generateExtended(
    42,
    {
      models: g.models, bases: g.bases, lines: g.lines, equipment: g.equipment,
      materialBalances: g.materialBalances, demandSegments: g.demandSegments,
    },
    "S",
  );
  // 第四臂：`AnnualScenario`/`ScenarioTrigger`/`PlanTarget` 的实例只出自它（service.ts:1098）。
  // 两个实参是**缩放系数**，只影响数值不影响条数与键（金丝雀现算复核这一点）。
  pd = bat.generatePlanDomain(1, 1);
  cadenceRows = cad.cadenceObjectRows(cad.deriveChainCadences(g));
} catch (e) {
  gateToolBroken(`跑合成生成器时抛异常（${e?.message || e}）`);
}
const bind = { g, ext, pd, cadenceRows, mockExternal: reg.MOCK_EXTERNAL_DATA };

/* ── 源码 ── */
if (!existsSync(SEED_SRC)) gateToolBroken(`找不到 ${SEED_SRC}`);
if (!existsSync(SVC_SRC)) gateToolBroken(`找不到 ${SVC_SRC}`);
const carriers = parseCarriers(readFileSync(SEED_SRC, "utf8"));
if (carriers === null) {
  gateToolBroken(
    "在 apps/datacore/src/seed.ts 里解析不到 `DEMO_PROCESS_DEFINITIONS` 声明",
    "它可能被改名/改形（挪进别的文件、换成 Map）——**这不是可以忽略的解析失败**：声明一变形本门就再也守不住这条链，必须同步改解析式。",
  );
}
const putAll = parsePutAll(readFileSync(SVC_SRC, "utf8"));
const wired = new Map(putAll.map((c) => [c.type, c]));

/* ═══════════════════════════════════════════════════════════════════════════
 * 金丝雀 · **双向**，与主逻辑共用 parseCarriers / parsePutAll / resolveRows
 * ═══════════════════════════════════════════════════════════════════════════ */
{
  const bad = [];
  // —— 规模下界（解析式失配会让全表恒绿，必须先自证）——
  // ⚠ 判据是**下界**不是等号（2026-08-13 变异 M5' 实测逼出来的）：写死 `!== 65` 会让「新增一条流程」
  //   走进「工具坏了」而不是被**判定** —— 那正好把本门要咬的场景吞掉，是最坏的一种假绿。
  //   「恰好 65 条」是 process-layer.test.ts 的金值，不该在这里再抄一份。
  if (carriers.length < 60) bad.push(`DEMO_PROCESS_DEFINITIONS 只解析出 ${carriers.length} 条（下界 60）——解析式失配`);
  if (new Set(carriers.map((c) => c.key)).size !== carriers.length) bad.push("解析出的流程号有重复——解析式把同一条抽了两次");
  if (putAll.length < 50) bad.push(`putAll 物化清单只解析出 ${putAll.length} 条（下界 50）——解析式失配`);
  // —— 必中：确定存在的样例，判据必须认出来 ——
  if (!carriers.some((c) => c.key === "P37" && c.carrier === "ProductionSchedule")) bad.push("金丝雀：P37 的承载物应为 ProductionSchedule（PRD §3.2.2 的编号锚点）");
  if (!wired.has("Order")) bad.push("金丝雀：物化清单里必须有 Order（种子必产）");
  if (!Array.isArray(resolveRows("g.orders", bind)) || resolveRows("g.orders", bind).length === 0) bad.push("金丝雀：g.orders 应解析出非空行");
  if (!Array.isArray(resolveRows("ext.materials", bind)) || resolveRows("ext.materials", bind).length === 0) {
    bad.push("金丝雀：ext.materials 应解析出非空行 —— **generateExtended 的 ctx 传错时它会静默返回空壳**，缺口数会被虚报");
  }
  if (!Array.isArray(resolveRows("pd.planTargets", bind)) || resolveRows("pd.planTargets", bind).length === 0) {
    bad.push("金丝雀：pd.planTargets 应解析出非空行 —— 漏掉 generatePlanDomain 这一臂会把三条 plan 域承载物误报成零实例");
  }
  if (!Array.isArray(resolveRows("cadenceObjectRows(deriveChainCadences(g))", bind)) || cadenceRows.length === 0) bad.push("金丝雀：节拍行应解析出非空行");
  if (!Array.isArray(resolveRows("MOCK_EXTERNAL_DATA.external_signals!", bind))) bad.push("金丝雀：MOCK_EXTERNAL_DATA.external_signals 应解析得到（含结尾 `!` 的非空断言写法）");
  // —— 必不中：不可能存在的样例，必须数到 0（防「恒真解析器」这种更坏的假绿）——
  if (wired.has("__NoSuchCarrier_G4__")) bad.push("金丝雀（必不中）：物化清单里不该有 __NoSuchCarrier_G4__");
  if (resolveRows("g.__no_such_collection_G4__", bind) !== undefined) bad.push("金丝雀（必不中）：g.__no_such_collection_G4__ 应解析不出");
  if (resolveRows("someLocalVariable", bind) !== undefined) bad.push("金丝雀（必不中）：裸局部变量应落「未判定」而不是被解析成行");
  if (parseCarriers("const SOMETHING_ELSE = [];\n") !== null) bad.push("金丝雀（必不中）：无 DEMO_PROCESS_DEFINITIONS 的文本必须返回 null（= 声明变形，报工具坏了），而不是空数组（= 一条流程都没有）");
  {
    const fake = parseCarriers('const DEMO_PROCESS_DEFINITIONS = [\n  { key: "P01", carrierTypeKey: "Order" },\n];\n');
    if (!Array.isArray(fake) || fake.length !== 1 || fake[0].carrier !== "Order") bad.push("金丝雀（必中）：合成样例应抽出恰好 1 条 P01→Order");
  }
  if (parsePutAll('console.log("Order", x, "so");\n').length !== 0) bad.push("金丝雀（必不中）：非 putAll 的三参调用不该被抽成物化点");
  // —— generatePlanDomain 实参不变性（本门拿 (1,1) 代跑生产的 (weeklyTotal, avgUnitPrice)，得先证明条数不随实参变）——
  try {
    const pd2 = bat.generatePlanDomain(123456, 18667);
    for (const k of Object.keys(pd)) {
      if ((pd2[k] ?? []).length !== (pd[k] ?? []).length) bad.push(`金丝雀：generatePlanDomain 的 ${k} 条数随实参变（${pd[k].length} vs ${pd2[k].length}）—— 本门用 (1,1) 代跑的前提不成立`);
    }
  } catch (e) { bad.push(`金丝雀：generatePlanDomain 二次调用抛异常（${e?.message || e}）`); }

  if (bad.length) gateToolBroken("金丝雀不中 ⇒ **门自己瞎了**：\n   · " + bad.join("\n   · "));
}
const CANARY_COUNT = 17; // 上面逐条现写；改动此块请同步（本行只用于报告的诚实位）

/* ═══════════════════════════════════════════════════════════════════════════
 * 主判据
 * ═══════════════════════════════════════════════════════════════════════════ */
const rows = carriers.map((c) => {
  const w = wired.get(c.carrier);
  if (!w) return { ...c, verdict: "NOT_MATERIALIZED", detail: "物化清单里没有该类型的 putAll" };
  const r = resolveRows(w.expr, bind);
  if (!Array.isArray(r)) return { ...c, verdict: "UNRESOLVED", expr: w.expr, detail: `行源表达式 \`${w.expr}\` 本门解析不出` };
  if (r.length === 0) return { ...c, verdict: "ZERO_ROWS", expr: w.expr, detail: `行源 \`${w.expr}\` 现读 0 行` };
  return { ...c, verdict: "OK", expr: w.expr, n: r.length };
});
const violations = rows.filter((r) => r.verdict === "NOT_MATERIALIZED" || r.verdict === "ZERO_ROWS");
const unresolved = rows.filter((r) => r.verdict === "UNRESOLVED");

const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  for (const r of rows) {
    const mark = r.verdict === "OK" ? "✓" : r.verdict === "UNRESOLVED" ? "?" : "✗";
    console.log(`  ${mark} ${r.key} ${r.carrier.padEnd(26)} ${r.verdict}${r.n != null ? ` (${r.n} 行 ← ${r.expr})` : r.expr ? ` ← ${r.expr}` : ""}`);
  }
  process.exit(0);
}
if (argv.includes("--update")) {
  // 基线写入器四向金丝雀（与 buildBaselineDoc 共用同一份实现，不另抄）——
  // 治「--update 静默吞掉人手挂账」那一族病，来历见 scripts/lib/baseline-doc.mjs。
  const bc = baselineDocCanary();
  if (!bc.ok) gateToolBroken(`基线写入器金丝雀不过（${bc.got}）`, `期望：${bc.want}`);
  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
  const exempt = {};
  for (const v of violations) {
    const k = `${v.key}|${v.carrier}`;
    exempt[k] = prev?.exempt?.[k] || { verdict: v.verdict, why: "TODO：写清楚为什么这条流程的承载物今天一条实例都没有（空 why 会被门判红）" };
  }
  writeFileSync(BASELINE, JSON.stringify(buildBaselineDoc({
    prev,
    generatedBy: "node scripts/check-carrier-has-instances.mjs --update",
    prose: { note: "carrier-has-instances 棘轮基线：存量「流程承载物零实例」的具名豁免，只许降不许升。每条必须写 why。键 = `<流程号>|<承载物类型>`。" },
    computed: { exempt },
  }), null, 2) + "\n");
  console.log(`已写基线：豁免 ${Object.keys(exempt).length} 条（${BASELINE}）`);
  process.exit(0);
}

/* ── 棘轮 ── */
if (!existsSync(BASELINE)) gateToolBroken(`基线文件不存在（${BASELINE}）`, "从 canonical 取回，或先跑 `--update` 生成。");
let baseline;
try { baseline = JSON.parse(readFileSync(BASELINE, "utf8")); } catch (e) { gateToolBroken(`基线不是合法 JSON（${e?.message || e}）`); }
if (!baseline || typeof baseline.exempt !== "object" || baseline.exempt === null) gateToolBroken("基线结构不对（缺 `exempt` 对象）");
const exempt = baseline.exempt;

const fail = [];
const used = new Set();
for (const v of violations) {
  const k = `${v.key}|${v.carrier}`;
  const e = exempt[k];
  if (!e) {
    fail.push(
      `B${v.verdict === "NOT_MATERIALIZED" ? "1 没接线" : "2 接了线没数据"}：${v.key} 的承载物 \`${v.carrier}\` —— ${v.detail}\n` +
        `      后果：从这条业务流程下钻到承载物，拿到的是空列表，而后端 200 + total:0 —— \n` +
        `           与「业务上恰好没有」长得一模一样，看的人分不出是哪一种。\n` +
        (v.verdict === "NOT_MATERIALIZED"
          ? `      修法：在 apps/datacore/src/synthetic/service.ts 的 instantiateBattery 里补一行 putAll("${v.carrier}", …)，\n` +
            `           或把该流程的 carrierTypeKey 改指一个真会落库的类型（**别为了变绿改判据**）。\n`
          : `      修法：补种子数据 —— 物化点已经在了，改物化点没有用（这是三种"不工作"里的第二种）。\n`),
    );
  } else {
    used.add(k);
    if (!e.why || !String(e.why).trim() || /^TODO/.test(String(e.why))) {
      fail.push(`豁免无理由：${k} 在基线里但没写 why —— 豁免必须说清理由，否则等于永久居留权`);
    }
  }
}
// B3 棘轮反向：不再违规却还挂在基线上 ⇒ 红
for (const k of Object.keys(exempt)) {
  if (used.has(k)) continue;
  const [pkey, carrier] = k.split("|");
  const cur = rows.find((r) => r.key === pkey && r.carrier === carrier);
  const why = !cur
    ? `流程 ${pkey}(承载物 ${carrier}) 已不在 DEMO_PROCESS_DEFINITIONS 里`
    : `${pkey} → ${carrier} 现在判定为 ${cur.verdict}${cur.n != null ? `（${cur.n} 行）` : ""}，不再是违规`;
  fail.push(`B3 棘轮：${why} —— 豁免已过期，请从 scripts/carrier-instance-baseline.json 删掉该条（只降不升）。`);
}

/* ── 报告 ── */
console.log(`✅ 金丝雀 ${CANARY_COUNT} 项全中（必中 9 · 必不中 5 · 规模/结构自证 3；与主逻辑共用 parseCarriers/parsePutAll/resolveRows）`);
console.log(
  `· carrier-has-instances：流程 ${carriers.length} 条（承载物 ${new Set(carriers.map((c) => c.carrier)).size} 类）· ` +
    `物化清单 ${putAll.length} 条 · 有实例 ${rows.filter((r) => r.verdict === "OK").length} · ` +
    `没接线 ${rows.filter((r) => r.verdict === "NOT_MATERIALIZED").length} · 接了线 0 行 ${rows.filter((r) => r.verdict === "ZERO_ROWS").length} · 未判定 ${unresolved.length}`,
);
for (const v of violations) console.log(`  ✗ ${v.key} → ${v.carrier}（${v.verdict}）${exempt[`${v.key}|${v.carrier}`] ? "【基线豁免】" : ""}`);
for (const u of unresolved) console.log(`  ? ${u.key} → ${u.carrier} 未判定：${u.detail}（**不进红**，也不算已确认干净）`);
console.log("· ⚠ 诚实边界：只证「demo 合成路径会落库 ≥1 行」，不证租户运行态；只看 synthetic/service.ts 的 putAll；不验实例内容。");

if (fail.length) {
  console.error(`\n✗ carrier-has-instances:check 未通过（${fail.length} 条）：`);
  for (const m of fail) console.error("  - " + m);
  process.exit(1);
}
// ⚠ 通过语必须**带上棘轮实况**：一句「承载物都有实例」盖住挂账的豁免，就是屏上说谎的那种绿。
console.log(
  `\n✓ carrier-has-instances:check 通过（无**新增**违规；存量 ${used.size} 条具名挂账在 scripts/carrier-instance-baseline.json，逐条带 why；豁免名单无冗余）。`,
);
if (used.size > 0 || unresolved.length > 0) {
  console.log(`  ⚠ 「通过」= 没有变得更糟，**不等于**干净：${used.size} 条挂账 + ${unresolved.length} 条未判定，今天仍然是真的。`);
}
