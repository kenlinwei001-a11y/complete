#!/usr/bin/env node
/**
 * 门 `feature-default-parity:check` · **两侧 `defaultOn` 反向必须有理由门**（WO-GSIM-LIVE-FLAG-REASON）
 *
 * ══ 治什么（这是一个真炸过的事故，不是假想）═══════════════════════════════════
 * `view.global-sim.live` 曾经两侧反向：
 *   · A 侧真相源 `apps/datacore/src/features.ts` → `defaultOn: false`
 *   · 前端 mock  `apps/frontend-shell/src/mocks/fixtures.ts` → `defaultOn: true`
 * 而 `<Feature flag="view.global-sim.live">`（`src/workspace/featureGate.tsx`）是 R3 闸，关 ⇒ 整块不渲染。
 * 于是：`VITE_MOCK=1` 的全部前端测试走 fixtures（true）⇒ 那两块渲染 ⇒ **全绿**；
 *       真部署走 A 侧 workspace（false）⇒ 那两块**看不见**。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『前端测试绿』当作『这块功能真部署可见』的证据，而前者并不度量后者。」**
 *
 * ⚠️ **反向本身不一定是 bug**。「mock 开着是为了让前端能测到渲染路径」是**合法理由**——
 *    实测在册的两条（`sim.sandbox` / `decision.causal-graph`）正是这一类：A 侧 `false` 是 **L1**，
 *    而 demo 租户的 L2 行业模板把它们抬开了，mock 照抄的是**有效值**不是 L1 字面量。
 *    所以本门**不禁止反向**，只要求 **反向必须登记 + 必须写明「所以前端绿不证明真部署可见」**。
 *    禁止反向会逼人把 mock 改成照抄 L1，那会让五个沙盘子视图被级联过滤掉 —— 一道会造成实际损害的门。
 *
 * ══ 判据（五条，同时成立才算过）═══════════════════════════════════════════════
 *   A1 无未登记反向     实测反向的每个 key 必须在 `scripts/feature-default-divergence.json` 里
 *   A2 无陈旧登记       登记表里的每个 key 必须**仍然**反向（理由不成立了就该删登记）
 *   A3 登记值属实       登记的 backend/mock 必须与现算一致（凭印象填 ⇒ 红）
 *   A4 理由实质         `why` 非空且 ≥ 40 字（占位串挡不住下一个人，等于没登记）
 *   A5 说明那句话       `frontendGreenProves` 必须明写「前端绿 …… 不证明/不代表 …… 真部署（可见）」
 *   A6 无悬空登记       登记表里的 key 必须两侧注册表里都真实存在
 *
 * ══ 诚实边界（先读，免得把这道门当成它不是的东西）═══════════════════════════
 *  · 本门只比 **`defaultOn` 字面量**，**不解释运行期有效值**。A 侧的有效值是四层叠加
 *    （L1 默认 → L2 行业模板 → L3 租户 override → L4 角色收窄，见 `features.ts` `layeredSet()`），
 *    `defaultOn` 只管 L1。**「A 侧 defaultOn:false」≠「所有租户都看不见」** ——
 *    有行业模板的租户（如 demo=battery）L2 会整个取代 L1。这正是上面两条登记的由来。
 *  · 只看**两侧都声明了**的键。一侧有一侧无，是 `nav-group-coverage:check` 判据② 的地盘，本门不碰。
 *  · 只看 mock 的 `FEATURE_REGISTRY`，不看 `db.tenantOverrides` 之类的运行期 mock 覆盖。
 *  · 本门**不判**「这个 defaultOn 值本身对不对」（那是 `dark-launch:check` 按 `feature-rollout.json`
 *    声明的投放意图在判）。两门互补：那道门查「意图 vs 机制」，本门查「A 侧 vs mock」。
 *
 * ══ 金丝雀（比断言本身更重要）═══════════════════════════════════════════════
 * 铁律 0.6：任何扫描/解析/计数在报出结论前，先跑「已知必中」样例。
 * 本门金丝雀**与主逻辑共用同一份实现**（`scripts/lib/feature-defaults.mjs` 的
 * `extractDefaults` / `backendDefaults` / `mockDefaults` / `divergences` + 本文件的 `violationsOf`），
 * 不另抄一份正则 —— 抄了就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿。
 * 判据**双向**：既验「已知必中的抓得到」（造一条未登记反向），
 * 也验「已知不该中的不咬」（两侧同值 / 已登记的反向）。
 * 金丝雀不中 ⇒ 打印「⛔ 门自己坏了」并 `exit 2`，**绝不允许**报「两侧一致 / 无反向」。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-GSIM-LIVE-FLAG-STALE`。
 * 用法：node scripts/check-feature-default-parity.mjs  ·  pnpm feature-default-parity:check
 *      node scripts/check-feature-default-parity.mjs --selftest   （只跑金丝雀，不看仓库现状）
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * node 对未捕获异常一律退 1，恰好撞上「真有问题」——方向正好相反，故必须显式兜底成 2。
 * 兜底只改**默认失败方向**，不动任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。 */
process.on("uncaughtException", (e) => toolBroken(e));
process.on("unhandledRejection", (e) => toolBroken(e));

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { backendDefaults, mockDefaults, divergences, extractDefaults } from "./lib/feature-defaults.mjs";

const ROOT = process.cwd();
const FEATURES = "apps/datacore/src/features.ts";
const MANIFEST = "apps/datacore/src/synthetic/view-manifest.ts";
const FIXTURES = "apps/frontend-shell/src/mocks/fixtures.ts";
const REGISTRY = "scripts/feature-default-divergence.json";

function toolBroken(e) {
  console.error(`⛔ check-feature-default-parity.mjs 未预期异常（${e?.message ?? e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「两侧一致 / 无未登记反向 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack ?? "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那条路径，两者处置相反，不许合并）
}
function blind(msg) {
  console.error(`⛔ 门自己坏了：${msg}`);
  console.error("   ⇒ 只许说「我没查出来」。**不许**读作「两侧一致 / 无反向 / 代码干净」。");
  process.exit(2);
}
const read = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) blind(`找不到 ${rel}`);
  return readFileSync(p, "utf8");
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 判定核心 —— **主逻辑与金丝雀共用这一个函数**，不许各写一份
 * ═══════════════════════════════════════════════════════════════════════════ */

const PROVES_RE = /前端.{0,4}绿[\s\S]{0,40}?(不证明|不代表|证明不了|不等于)[\s\S]{0,40}?真部署/;
const WHY_MIN = 40;

/**
 * @param {Map<string, boolean|null>} backendMap
 * @param {Map<string, boolean|null>} mockMap
 * @param {{features?: Record<string, any>}} registry
 * @returns {{code:string, key:string, msg:string}[]}
 */
export function violationsOf(backendMap, mockMap, registry) {
  const declared = registry?.features ?? {};
  const found = divergences(backendMap, mockMap);
  const foundByKey = new Map(found.map((d) => [d.key, d]));
  const out = [];

  // A1 无未登记反向
  for (const d of found) {
    if (Object.prototype.hasOwnProperty.call(declared, d.key)) continue;
    out.push({
      code: "A1",
      key: d.key,
      msg:
        `两侧 defaultOn 反向且**未登记**：A 侧 ${FEATURES}=${d.backend} ↔ mock ${FIXTURES}=${d.mock}。\n` +
        `        ⚠️ **这个 flag 前端绿不代表真部署看得见** —— mock 侧是 ${d.mock}，前端测试全走这条；` +
        `真部署读 A 侧 workspace（${d.backend}），<Feature flag="${d.key}"> 闸${d.backend ? "开" : "关"}。\n` +
        `        修法二选一：① 若反向是有意的（如「mock 开是为了让前端能测渲染路径」），` +
        `到 ${REGISTRY} 登记，写清 why 与 frontendGreenProves；② 若不是有意的，改掉其中一侧。`,
    });
  }

  for (const [key, rec] of Object.entries(declared)) {
    const d = foundByKey.get(key);
    // A6 无悬空登记
    if (!backendMap.has(key) || !mockMap.has(key)) {
      out.push({ code: "A6", key, msg: `登记表里有它，但${!backendMap.has(key) ? ` A 侧 ${FEATURES}` : ` mock ${FIXTURES}`} 的注册表里没有这个 key（悬空登记）。` });
      continue;
    }
    // A2 无陈旧登记
    if (!d) {
      out.push({
        code: "A2",
        key,
        msg:
          `登记表说它反向，但**现在两侧已经同值**（A 侧=${backendMap.get(key)} · mock=${mockMap.get(key)}）⇒ **陈旧登记，请删掉这条**。\n` +
          `        留一句已不成立的理由比没有理由更坏：下一个人读了会以为这里还有已知分歧，` +
          `从而绕开本该直接使用的能力（这正是 ${FEATURES} 那句「端点未落」注释造成过的损害）。`,
      });
      continue;
    }
    // A3 登记值属实
    if (rec.backend !== d.backend || rec.mock !== d.mock) {
      out.push({ code: "A3", key, msg: `登记的两侧值与现算不符：登记 backend=${rec.backend}/mock=${rec.mock}，现算 backend=${d.backend}/mock=${d.mock}。` });
    }
    // A4 理由实质
    const why = String(rec.why ?? "");
    if (why.trim().length < WHY_MIN) {
      out.push({ code: "A4", key, msg: `why 太短（${why.trim().length} < ${WHY_MIN} 字）⇒ 占位理由挡不住下一个人，等于没登记。` });
    }
    // A5 说明那句话
    if (!PROVES_RE.test(String(rec.frontendGreenProves ?? ""))) {
      out.push({
        code: "A5",
        key,
        msg:
          `frontendGreenProves 没有明写那句话。反向的**唯一后果**就是它，必须写出来：\n` +
          `        「前端绿不证明真部署可见」（或「前端绿不代表真部署看得见」等同义表述）。`,
      });
    }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 金丝雀 —— 与主逻辑同一份实现（上面的 violationsOf + lib 里的抽取器），只喂样例
 * ═══════════════════════════════════════════════════════════════════════════ */

const SAMPLE_BACKEND = `
export const FEATURE_REGISTRY: FeatureDef[] = assertSharedFeatureNames([
  // 注释里也写一个 defaultOn: true 来钓 stripComments —— 抽到 3 条就是把注释吃进去了
  { key: "same.on", name: "两侧同开", level: "BLOCK", defaultOn: true },
  { key: "flip.me", name: "会被翻的", level: "BLOCK", defaultOn: false },
], "sample");
`;
const SAMPLE_MOCK_SAME = `
export const FEATURE_REGISTRY: FeatureDef[] = assertSharedFeatureNames([
  { key: "same.on", name: "两侧同开", level: "BLOCK", defaultOn: true },
  { key: "flip.me", name: "会被翻的", level: "BLOCK", defaultOn: false },
]);
`;
const SAMPLE_MOCK_FLIPPED = SAMPLE_MOCK_SAME.replace(`"flip.me", name: "会被翻的", level: "BLOCK", defaultOn: false`, `"flip.me", name: "会被翻的", level: "BLOCK", defaultOn: true`);

const GOOD_RECORD = {
  backend: false,
  mock: true,
  why: "样例：mock 侧开着是为了让前端能测到渲染路径；A 侧 L1 关但 L2 行业模板会抬开，mock 照抄的是有效值不是 L1 字面量。",
  frontendGreenProves: "前端绿不证明真部署可见：无行业模板的租户仍会 404。",
};

/** @returns {{name:string, ok:boolean, detail:string}[]} */
function runCanaries() {
  const r = [];
  const mapOf = (src) => new Map(extractDefaults(src, "FEATURE_REGISTRY").entries.map((e) => [e.key, e.defaultOn]));

  // ⓪ 抽取器自证：样例里注释中的 `defaultOn: true` 不许被算进条目
  const be = extractDefaults(SAMPLE_BACKEND, "FEATURE_REGISTRY");
  r.push({ name: "⓪ 抽取器不吃注释（样例注释里有一个 defaultOn: true）", ok: be.entries.length === 2, detail: `抽到 ${be.entries.length} 条（期望 2）` });
  r.push({ name: "⓪b 第二次测量与走查一致（rawTrue+rawFalse == 条目数）", ok: be.rawTrue + be.rawFalse === be.entries.length, detail: `${be.rawTrue}+${be.rawFalse} vs ${be.entries.length}` });

  const backendMap = mapOf(SAMPLE_BACKEND);

  // ① 必中：造一条**未登记**的反向 ⇒ 必须报 A1
  const v1 = violationsOf(backendMap, mapOf(SAMPLE_MOCK_FLIPPED), { features: {} });
  r.push({ name: "① 必中：未登记的反向 ⇒ A1", ok: v1.some((x) => x.code === "A1" && x.key === "flip.me"), detail: `报 ${v1.length} 条：${v1.map((x) => x.code + ":" + x.key).join(",") || "无"}` });

  // ② 必不咬：两侧同值 ⇒ 零违规
  const v2 = violationsOf(backendMap, mapOf(SAMPLE_MOCK_SAME), { features: {} });
  r.push({ name: "② 必不咬：两侧同值 ⇒ 零违规", ok: v2.length === 0, detail: `报 ${v2.length} 条：${v2.map((x) => x.code + ":" + x.key).join(",") || "无"}` });

  // ③ 必不咬：反向但**已登记且理由合规** ⇒ 零违规
  const v3 = violationsOf(backendMap, mapOf(SAMPLE_MOCK_FLIPPED), { features: { "flip.me": GOOD_RECORD } });
  r.push({ name: "③ 必不咬：已登记且理由合规的反向 ⇒ 零违规", ok: v3.length === 0, detail: `报 ${v3.length} 条：${v3.map((x) => x.code + ":" + x.key).join(",") || "无"}` });

  // ④ 必中：登记了但两侧其实同值 ⇒ A2 陈旧登记（本单要治的病的机器化形态）
  const v4 = violationsOf(backendMap, mapOf(SAMPLE_MOCK_SAME), { features: { "flip.me": GOOD_RECORD } });
  r.push({ name: "④ 必中：陈旧登记（已同值还留着）⇒ A2", ok: v4.some((x) => x.code === "A2" && x.key === "flip.me"), detail: `报 ${v4.map((x) => x.code + ":" + x.key).join(",") || "无"}` });

  // ⑤ 必中：登记值填错 ⇒ A3
  const v5 = violationsOf(backendMap, mapOf(SAMPLE_MOCK_FLIPPED), { features: { "flip.me": { ...GOOD_RECORD, backend: true, mock: false } } });
  r.push({ name: "⑤ 必中：登记值与现算不符 ⇒ A3", ok: v5.some((x) => x.code === "A3"), detail: `报 ${v5.map((x) => x.code).join(",") || "无"}` });

  // ⑥ 必中：占位理由 ⇒ A4
  const v6 = violationsOf(backendMap, mapOf(SAMPLE_MOCK_FLIPPED), { features: { "flip.me": { ...GOOD_RECORD, why: "历史原因" } } });
  r.push({ name: "⑥ 必中：占位理由（why 太短）⇒ A4", ok: v6.some((x) => x.code === "A4"), detail: `报 ${v6.map((x) => x.code).join(",") || "无"}` });

  // ⑦ 必中：没写「前端绿不证明真部署可见」⇒ A5（这是本门存在的理由，漏了等于没门）
  const v7 = violationsOf(backendMap, mapOf(SAMPLE_MOCK_FLIPPED), { features: { "flip.me": { ...GOOD_RECORD, frontendGreenProves: "没什么影响。" } } });
  r.push({ name: "⑦ 必中：没写那句话 ⇒ A5", ok: v7.some((x) => x.code === "A5"), detail: `报 ${v7.map((x) => x.code).join(",") || "无"}` });

  // ⑧ 必中：悬空登记 ⇒ A6
  const v8 = violationsOf(backendMap, mapOf(SAMPLE_MOCK_SAME), { features: { "ghost.key": GOOD_RECORD } });
  r.push({ name: "⑧ 必中：悬空登记（两侧都没这个 key）⇒ A6", ok: v8.some((x) => x.code === "A6"), detail: `报 ${v8.map((x) => x.code).join(",") || "无"}` });

  return r;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 主流程 —— 顶层 try/catch 是 Program 的直接子语句（gate-exit-discipline 判据②(a)）
 * ═══════════════════════════════════════════════════════════════════════════ */
try {
  const selftestOnly = process.argv.includes("--selftest");

  // ── 金丝雀先跑：报任何否定结论之前先自证工具 ──────────────────────────────
  const canaries = runCanaries();
  const bad = canaries.filter((c) => !c.ok);
  if (bad.length > 0) {
    console.error("⛔ 门自己坏了 —— 金丝雀未全中：");
    for (const c of bad) console.error(`   ✗ ${c.name} —— ${c.detail}`);
    console.error("   ⇒ 只许说「我没查出来」。**不许**读作「两侧一致 / 无反向 / 代码干净」。");
    process.exit(2);
  }

  if (selftestOnly) {
    console.log(`✅ feature-default-parity:check --selftest —— 金丝雀 ${canaries.length}/${canaries.length} 全中（必中 6 · 必不咬 2 · 抽取器自证 2）。`);
    for (const c of canaries) console.log(`   ✓ ${c.name}`);
    process.exit(0);
  }

  // ── 现算两侧 ────────────────────────────────────────────────────────────
  const featuresSrc = read(FEATURES);
  const manifestSrc = read(MANIFEST);
  const fixturesSrc = read(FIXTURES);
  const be = backendDefaults(featuresSrc, manifestSrc);
  const mo = mockDefaults(fixturesSrc);

  // 抽取器自证（真文件上，不是样例）——报否定结论前先证明尺子是对的
  if (!be.reg.found) blind(`${FEATURES} 里找不到 FEATURE_REGISTRY 的数组`);
  if (!mo.reg.found) blind(`${FIXTURES} 里找不到 FEATURE_REGISTRY 的数组`);
  if (be.reg.entries.length === 0) blind(`${FEATURES} 抽到 0 条 feature —— 抽取器坏了`);
  if (mo.reg.entries.length === 0) blind(`${FIXTURES} 抽到 0 条 feature —— 抽取器坏了`);
  if (be.views.entries.length === 0) blind(`${MANIFEST} 抽到 0 条 BUILTIN_VIEWS —— 抽取器坏了（这会让全部内置视图键被读作「不存在」）`);
  if (be.builtinDefaultOn === null) blind(`${MANIFEST} 的 builtInViewFeatureDefs() 里读不到写死的 defaultOn —— 内置视图键的值无从判定`);
  if (be.reg.spreads.length === 0) blind(`${FEATURES} 的 FEATURE_REGISTRY 里没有展开调用了 —— 结构变了，请复核本门对内置视图键的补齐假设`);
  for (const [label, x] of [[FEATURES, be.reg], [FIXTURES, mo.reg]]) {
    const withDefault = x.entries.filter((e) => e.defaultOn !== null).length;
    if (x.rawTrue + x.rawFalse !== withDefault) {
      blind(`${label} 两次独立测量对不上：子串计数 ${x.rawTrue}+${x.rawFalse}=${x.rawTrue + x.rawFalse}，顶层走查 ${withDefault} ⇒ 走查漏了条目`);
    }
  }
  // 金丝雀（真文件上的「已知必中」样例）：本门就是为它建的，它必须两侧都在
  const GOLDEN = "view.global-sim.live";
  if (!be.map.has(GOLDEN) || !mo.map.has(GOLDEN)) {
    blind(`金丝雀键 ${GOLDEN} 在${!be.map.has(GOLDEN) ? " A 侧" : " mock 侧"}没抽到 —— 它确实在源码里，故是抽取器坏了，不是它不存在`);
  }

  const shared = [...mo.map.keys()].filter((k) => be.map.has(k));
  if (shared.length === 0) blind("两侧共有的 key 为 0 —— 不可能，抽取器坏了");

  // ── 登记表 ──────────────────────────────────────────────────────────────
  const regPath = join(ROOT, REGISTRY);
  if (!existsSync(regPath)) blind(`找不到登记表 ${REGISTRY}`);
  let registry;
  try { registry = JSON.parse(readFileSync(regPath, "utf8")); }
  catch (e) { blind(`登记表不是合法 JSON：${e.message}`); }

  // ── 判定 ────────────────────────────────────────────────────────────────
  const found = divergences(be.map, mo.map);
  const violations = violationsOf(be.map, mo.map, registry);

  console.log(`— feature-default-parity:check —`);
  console.log(`  金丝雀 ${canaries.length}/${canaries.length} 全中（必中 6 · 必不咬 2 · 抽取器自证 2）⇒ 检测逻辑活着。`);
  console.log(`  A 侧 ${FEATURES}：字面量 ${be.reg.entries.length} 条 + 内置视图 ${be.views.entries.length} 条（builtInViewFeatureDefs 写死 defaultOn=${be.builtinDefaultOn}）= ${be.map.size} 键`);
  console.log(`  mock ${FIXTURES}：${mo.reg.entries.length} 键 · 两侧共有 ${shared.length} 键`);
  console.log(`  实测反向 ${found.length} 条：${found.map((d) => `${d.key}(A=${d.backend}/mock=${d.mock})`).join("、") || "无"}`);
  console.log(`  已登记 ${Object.keys(registry.features ?? {}).length} 条`);

  if (violations.length > 0) {
    console.error(`\n❌ feature-default-parity:check 不通过 —— ${violations.length} 条：`);
    for (const v of violations) console.error(`   · [${v.code}] ${v.key}：${v.msg}`);
    console.error(`\n   判据与修法见本文件顶注；登记表：${REGISTRY}`);
    process.exit(1);
  }

  console.log(`\n✅ feature-default-parity:check 通过 —— ${shared.length} 个共有 key 里 ${found.length} 条反向，全部已登记且带理由。`);
  console.log(`   ⚠ 诚实边界（不许读成「两侧完全一致」或「真部署一定看得见」）：`);
  console.log(`     ① 本门只比 defaultOn **字面量**（= L1）。A 侧有效值还要过 L2 行业模板 / L3 租户 override / L4 角色收窄；`);
  console.log(`        「A 侧 defaultOn:false」≠「所有租户都看不见」—— 在册那两条反向正是这么来的。`);
  console.log(`     ② 只看两侧**都声明**的键；一侧缺失归 nav-group-coverage:check 判据②。`);
  console.log(`     ③ 不判 defaultOn 值本身对不对（那是 dark-launch:check 按 feature-rollout.json 的投放意图在判）。`);
  process.exit(0);
} catch (e) {
  toolBroken(e);
}
