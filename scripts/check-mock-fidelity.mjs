#!/usr/bin/env node
/**
 * 门 `mock-fidelity:check` · **mock 谎报门**（闭本体 §8 `G-MOCK-OVERCLAIM`）
 *
 * ── 治什么 ────────────────────────────────────────────────────────────────────
 * MSW mock 是「前端在没有后端时看到的那个世界」。它**多说一句**或**说反一句**，
 * 后果不是「mock 不准」这么轻——是**前端在 mock 上跑得好好的，一接真后端就崩**，
 * 而且所有前端测试（跑在同一份 mock 上）**全绿**。这是假绿的又一形态：
 * 信号是真的，只是它证明的是「mock 自洽」，不是「前端能用」。
 *
 * 已经是**第 2 例**了（照 CLAUDE.md 铁律 0.6 第 2 级处置：第 2 次必须当场建机制）：
 *   ① #158 `demo_line_util_to_base_load` 声明 `Line --line_belongs_to_base--> Base`，
 *      而本体单源是 `Base→Line`（`apps/datacore/src/synthetic/battery.ts`）⇒ 规则恒不触发。（后端侧，已修）
 *   ② #160 **同一形态的前端副本**：`apps/frontend-shell/src/mocks/handlers.ts` 的
 *      `/a/v1/ontology/mapping/registries` 回 `{ key:"line_belongs_to_base", fromType:"Line", toType:"Base" }`
 *      —— 方向与后端单源**正好相反**。截至本门落地仍未修（见基线文件）。
 * 「下次注意」不是机制。机制的判据是：**下次同样的错发生时，是机器先说话，不是人先想起来。**
 *
 * ── 判据（两类载体，都是「mock 侧 ⟶ 真后端侧」的方向） ───────────────────────
 *   载体① **目录**（路由）：`apps/frontend-shell/src/mocks/**` 里 MSW 声明的每条路由，
 *          真后端（datacore/agentcore `src/`）必须真的注册了同名路由。
 *          `/b/v1` ⇄ `/api/v1` 别名表从 `agentcore/src/server.ts` 的 `rewriteUrl` **单源抽取**，
 *          不硬编码 —— 否则 21 条 `/b/v1/*` 会被全部误报成「谎报」（本门开发时实测踩过这一脚）。
 *   载体② **条目**（链路方向/基数）：mock 与后端**同 key** 的链路类型条目，
 *          `fromType↔fromTypeKey` / `toType↔toTypeKey` / `cardinality` 必须一致。
 *          两侧的值都从**真源码**抽，本门不存任何「期望值」——只存已知欠账的**豁免名单**。
 *
 * ── 与既有门的分工（别重复造轮子） ────────────────────────────────────────────
 *   · `nav-group-coverage:check` 判据② 管的是**反方向**：后端有、mock 缺（⇒ 前端断言恒真的哑门）。
 *   · `cockpit-widgets:check` 管 DASH_LAYOUT 后端/mock 漂移。
 *   · 本门补的是**没人管的那个方向**：**mock 有、后端没有（或相反）**。三者互补，不重叠。
 *
 * ── 诚实边界（先读，免得把这道门当成它不是的东西） ────────────────────────────
 *  · 载体① 判的是「路由**注册**了没有」，不是「返回的形状对不对」。后者要起真服务，本门不做。
 *  · 载体② 只覆盖**链路类型形状**的条目（两侧都带 from/to 的那种）。
 *    为什么不做成「所有同名条目的所有同名字段」：**实测过，噪声压不住** ——
 *    放开字段集后 `description` 一项就产生 ~15 条误报（mock 是后端文案的删节版，
 *    如 `sales_orders.description` 后端多写了「订单明细行/承诺台账」），全是**合理**差异。
 *    一道天天报误报的门会被无视，等于没有门。故本门只咬**结构性字段**（方向/基数）。
 *  · **本门不做「条目集合差集」的自动配对**，因为实测不可靠：按 key 交集给 mock 数组
 *    自动找后端对应数组时，`handlers.ts:51` 的 4 个求解器 key 会被配到
 *    `l2-decompose.ts:36` 的 21 个意图 key 上（交集恰好 2），"mock 多出 2 条"整条是假的。
 *    宁可没有这条载体，也不上一条会说谎的。
 *
 * ── 金丝雀（比断言本身更重要） ────────────────────────────────────────────────
 * 铁律 0.6：任何扫描/解析/计数在报出结论前，先跑「已知必中」样例。
 * 本门金丝雀**与主逻辑共用同一批函数**（`extractMockRoutes` / `flatObjects` / `linkEntries` /
 * `routeBackedBy` / `compareEntry`），不另抄一份正则。
 * 判据是**双向**的：既验「已知存在的必须命中」，也验「已知不该命中的必须不中」——
 * 一个恒真的匹配器把所有缺口藏起来、一个恒假的把全仓报成缺口，单向金丝雀两者都测不出来。
 * 金丝雀不中 ⇒ 打印「⛔ 门自己坏了」并 `exit 2`，**绝不允许**报「mock 干净 / 零谎报」。
 *
 * 退出码：0 = 无新增谎报 · 1 = 检出新增谎报 · **2 = 门自己坏了**（不许据此报「干净」）
 *
 * 用法：node scripts/check-mock-fidelity.mjs [--seed] [--update] [--verbose]
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门 `mock-fidelity:check`）· §8（断点 `G-MOCK-OVERCLAIM`）。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
// ⚠️ 词法原语与 `befe-seam:check` **共用同一份实现**（scripts/lib/source-lex.mjs）。
//    照铁律 0.6：不许各抄一份正则 —— 抄了就是装饰品，改主正则时金丝雀拿旧的去测、照样绿。
import {
  lex, splitTopLevel, stripComments, lineOf, walk, M_CODE,
  METHODS, extractBackendRoutes, normalizePath, extractRewritePrefixes, pathMatches,
} from "./lib/source-lex.mjs";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/mock-fidelity-baseline.json");
const MOCK_DIR = join(ROOT, "apps/frontend-shell/src/mocks");
const DATACORE_SRC = join(ROOT, "apps/datacore/src");
const AGENTCORE_SRC = join(ROOT, "apps/agentcore/src");
const AGENTCORE_SERVER = join(ROOT, "apps/agentcore/src/server.ts");

const argv = new Set(process.argv.slice(2));
const SEED = argv.has("--seed");
const UPDATE = argv.has("--update");
const VERBOSE = argv.has("--verbose");

/* ════════════════════════════════════════════════════════════════════════════
 * 1 · 抽取原语（主逻辑与金丝雀共用）
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * MSW 声明的路由：`http.get("*​/a/v1/x", …)`。
 * `mask` 剔注释 —— 注释掉的 mock **不是** mock（否则门会抓一堆幻觉谎报）。
 */
export function extractMockRoutes(src) {
  const { mask } = lex(src);
  const out = [];
  const re = new RegExp(String.raw`\bhttp\.(${METHODS}|all)\s*\(\s*(["'\`])([^"'\`]+)\2`, "g");
  for (const m of src.matchAll(re)) {
    if (mask[m.index] !== M_CODE) continue;
    // MSW 的 `*` 前缀是「任意 origin」，不是路径段；归一前先摘掉。
    const raw = m[3].replace(/^\*/, "");
    if (!raw.startsWith("/")) continue;
    out.push({ method: m[1].toUpperCase(), path: normalizePath(raw), line: lineOf(src, m.index) });
  }
  return out;
}

/**
 * 顶层 键→**字面量**值（string / number / bool）。非字面量（表达式、嵌套对象）一律不收 ——
 * 本门只比对结构性字面量，猜表达式的值只会制造噪声。
 */
export function literalProps(objText) {
  const openIdx = objText.indexOf("{");
  if (openIdx < 0) return null;
  const { parts, end } = splitTopLevel(objText, openIdx);
  // ⚠️ 判「配平」必须看**收尾字符**，不能用 `end >= objText.length`：
  //    对一个完整的 `{…}`，闭括号就是最后一个字符 ⇒ end === length ⇒ 那种写法会把
  //    **每一个完整对象**都判成「截断」并返回 null。本门开发时实测踩过：整仓抽出 0 个对象，
  //    差点据此报「mock 里没有任何条目」——又一次「我没找到 ≠ 它不存在」。
  if (objText[end - 1] !== "}") return null;
  const props = {};
  for (const raw of parts) {
    const p = stripComments(raw).trim();   // 注释不抹掉 ⇒ 带注释的字段一律读作不存在
    if (!p) continue;
    const m = /^(?:["'])?([A-Za-z_$][\w$]*)(?:["'])?\s*:\s*([\s\S]*)$/.exec(p);
    if (!m) continue;
    const v = m[2].trim();
    const sm = /^["'`]([^"'`]*)["'`]$/.exec(v);
    if (sm) { props[m[1]] = sm[1]; continue; }
    if (/^-?\d+(\.\d+)?$/.test(v)) { props[m[1]] = Number(v); continue; }
    if (v === "true" || v === "false") { props[m[1]] = v === "true"; continue; }
  }
  return { props };
}

/** 文件里所有**扁平**对象字面量（不含嵌套 `{}`）。链路条目正是这种形状。 */
export function flatObjects(src) {
  const { mask } = lex(src);
  const out = [];
  for (const m of src.matchAll(/\{[^{}]*\}/g)) {
    if (mask[m.index] !== M_CODE) continue;
    const r = literalProps(m[0]);
    if (!r) continue;
    out.push({ props: r.props, line: lineOf(src, m.index) });
  }
  return out;
}

/**
 * 链路类型条目。两侧字段名不同是**历史事实**，不是本门可以改的：
 *   mock 侧（前端契约投影）：`fromType` / `toType`
 *   后端侧（LinkTypeDef）  ：`fromTypeKey` / `toTypeKey`
 * 归一到 `from` / `to` 再比 —— 这就是「形状对齐」，不是硬编对照表：
 * **值全部来自真源码，本门一个期望值都不存。**
 */
export const LINK_SHAPES = [
  { side: "mock", from: "fromType", to: "toType" },
  { side: "backend", from: "fromTypeKey", to: "toTypeKey" },
];
export function linkEntries(src, side) {
  const shape = LINK_SHAPES.find((s) => s.side === side);
  const out = [];
  for (const o of flatObjects(src)) {
    const { props } = o;
    if (typeof props.key !== "string") continue;
    if (typeof props[shape.from] !== "string" || typeof props[shape.to] !== "string") continue;
    out.push({
      key: props.key,
      from: props[shape.from],
      to: props[shape.to],
      cardinality: typeof props.cardinality === "string" ? props.cardinality : undefined,
      line: o.line,
    });
  }
  return out;
}

/** 一条 mock 路由是否被某条后端路由承接（含 `/b/v1` ⇄ `/api/v1` 别名）。 */
export function routeBackedBy(mockRoute, backendRoutes, rewritePrefixes) {
  const aliases = [mockRoute.path];
  const m1 = /^\/b\/v1\/([a-z-]+)(\/.*)?$/.exec(mockRoute.path);
  if (m1 && rewritePrefixes.includes(m1[1])) aliases.push(`/api/v1/${m1[1]}${m1[2] ?? ""}`);
  const m2 = /^\/api\/v1\/([a-z-]+)(\/.*)?$/.exec(mockRoute.path);
  if (m2 && rewritePrefixes.includes(m2[1])) aliases.push(`/b/v1/${m2[1]}${m2[2] ?? ""}`);
  return backendRoutes.find(
    (b) => b.method === mockRoute.method && aliases.some((a) => pathMatches(a, b.norm)),
  );
}

/** 同 key 的两条链路条目逐字段比对 → 不一致字段列表。 */
export function compareEntry(mockEntry, beEntry) {
  const diffs = [];
  if (mockEntry.from !== beEntry.from) diffs.push({ field: "from", mock: mockEntry.from, backend: beEntry.from });
  if (mockEntry.to !== beEntry.to) diffs.push({ field: "to", mock: mockEntry.to, backend: beEntry.to });
  if (mockEntry.cardinality !== undefined && beEntry.cardinality !== undefined && mockEntry.cardinality !== beEntry.cardinality)
    diffs.push({ field: "cardinality", mock: mockEntry.cardinality, backend: beEntry.cardinality });
  return diffs;
}

/* ════════════════════════════════════════════════════════════════════════════
 * 2 · 采集
 * ═══════════════════════════════════════════════════════════════════════════ */

const mockFiles = walk(MOCK_DIR);
const backendFiles = [...walk(DATACORE_SRC), ...walk(AGENTCORE_SRC)].filter((f) => !/\.(test|spec)\.tsx?$/.test(f));

const mockRoutes = [];
for (const f of mockFiles) {
  const src = readFileSync(f, "utf8");
  for (const r of extractMockRoutes(src)) mockRoutes.push({ ...r, file: relative(ROOT, f) });
}

const rewritePrefixes = extractRewritePrefixes(existsSync(AGENTCORE_SERVER) ? readFileSync(AGENTCORE_SERVER, "utf8") : "");

const backendRoutes = [];
for (const f of backendFiles) {
  const src = readFileSync(f, "utf8");
  if (!/\.(get|post|put|patch|delete)\s*[<(]/.test(src)) continue;
  for (const r of extractBackendRoutes(src)) {
    backendRoutes.push({ ...r, norm: normalizePath(r.path), file: relative(ROOT, f) });
  }
}

const mockLinks = [];
for (const f of mockFiles) {
  const src = readFileSync(f, "utf8");
  for (const e of linkEntries(src, "mock")) mockLinks.push({ ...e, file: relative(ROOT, f) });
}
const beLinksByKey = new Map();
for (const f of backendFiles) {
  const src = readFileSync(f, "utf8");
  for (const e of linkEntries(src, "backend")) {
    if (!beLinksByKey.has(e.key)) beLinksByKey.set(e.key, []);
    beLinksByKey.get(e.key).push({ ...e, file: relative(ROOT, f) });
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * 3 · 金丝雀（与主逻辑共用同一批函数 · 不中即「门自己坏了」exit 2）
 * ═══════════════════════════════════════════════════════════════════════════ */

function canaries() {
  const list = [];
  const add = (name, why, fn) => list.push({ name, why, fn });

  // C1 词法：注释掉的 mock 不算 mock（否则门会抓幻觉谎报）
  add("lex/注释内 http.get 不计", "把注释掉的 mock 当真声明 ⇒ 幻觉谎报，门天天误报后被无视", () => {
    const s = `// http.get("*/a/v1/ghost/route", () => {})\nconst x = 1;`;
    const got = extractMockRoutes(s);
    return { ok: got.length === 0, got, want: [] };
  });

  // C2 真文件：mock 路由抽取必须在真 handlers.ts 上有效
  add("route/真文件 mock 抽取", "抽空了 ⇒ mock 路由集恒为空 ⇒ 差集恒为空 ⇒ 门恒报「零谎报」（#189 那种空转）", () => {
    const ok = mockRoutes.length > 100 && mockRoutes.some((r) => r.method === "GET" && r.path === "/a/v1/me/workspace");
    return { ok, got: `${mockRoutes.length} 条 · 含 GET /a/v1/me/workspace=${mockRoutes.some((r) => r.path === "/a/v1/me/workspace")}`, want: ">100 且含该路由" };
  });

  // C3 真文件：后端路由抽取必须有效（否则每条 mock 路由都读作「后端没有」= 全仓报成谎报）
  add("route/真文件 后端抽取", "抽空了 ⇒ 反向坏法：全部 mock 路由被误报成谎报", () => {
    const ok = backendRoutes.length > 100 && backendRoutes.some((r) => r.norm === "/a/v1/me/workspace");
    return { ok, got: `${backendRoutes.length} 条`, want: ">100 且含 /a/v1/me/workspace" };
  });

  // C4 匹配判据**双向**：恒真的匹配器藏起全部谎报，恒假的把全仓报成谎报
  add("route/匹配双向", "单向金丝雀测不出恒真/恒假匹配器——两种坏法一个报「零谎报」一个报「全是谎报」", () => {
    const real = { method: "GET", path: "/a/v1/me/workspace" };
    const fake = { method: "GET", path: "/a/v1/__mock_fidelity_canary_never_exists__" };
    const hit = routeBackedBy(real, backendRoutes, rewritePrefixes);
    const miss = routeBackedBy(fake, backendRoutes, rewritePrefixes);
    return { ok: !!hit && !miss, got: `真路由命中=${!!hit} · 假路由命中=${!!miss}`, want: "true / false" };
  });

  // C5 别名表单源：抽空了 ⇒ 21 条 /b/v1/* 全被误报（本门开发时实测的第一个错数字）
  add("route/别名前缀单源", "抽空 ⇒ /b/v1/queries 与 /api/v1/queries 被当成两条路 ⇒ 21 条幻觉谎报", () => {
    const ok = rewritePrefixes.includes("queries");
    return { ok, got: rewritePrefixes, want: "含 queries" };
  });

  // C6 对象解析：**尾逗号**必须照样解析（本门开发时实测：尾逗号让整仓抽出 0 个数组条目）
  add("obj/尾逗号仍解析", "尾逗号是本仓通用写法；漏了它 ⇒ 条目集恒空 ⇒ 门恒绿（实测踩过）", () => {
    const s = `const a = { key: "k1", fromType: "A", toType: "B", cardinality: "1:N", };`;
    const got = linkEntries(s, "mock");
    return { ok: got.length === 1 && got[0].from === "A" && got[0].to === "B", got, want: "1 条 A→B" };
  });

  // C6b 对象解析：完整 `{…}` 不许被误判为「截断」（`end >= length` 那个写法会杀掉全部对象）
  add("obj/完整对象不判截断", "把每个完整对象都判成截断 ⇒ 抽出 0 条 ⇒ 报「mock 里没有条目」（实测踩过）", () => {
    const r = literalProps(`{ key: "k", fromType: "A", toType: "B" }`);
    return { ok: !!r && r.props.key === "k", got: r?.props ?? null, want: "解析成功" };
  });

  // C7 真文件：两侧链路条目都必须抽得到（任一侧空 ⇒ 交集空 ⇒ 门恒绿）
  add("link/真文件 两侧都抽到", "任一侧抽空 ⇒ 同 key 交集恒空 ⇒ 门恒报「零不一致」", () => {
    const m = mockLinks.some((e) => e.key === "line_belongs_to_base");
    const b = beLinksByKey.has("line_belongs_to_base");
    return { ok: m && b && mockLinks.length >= 3, got: `mock ${mockLinks.length} 条(含目标=${m}) · backend key 数 ${beLinksByKey.size}(含目标=${b})`, want: "两侧都含 line_belongs_to_base" };
  });

  // C8 比对判据**双向**：已知相同的必须判相同，已知相反的必须判不同
  add("link/比对双向", "恒等比对器会把方向反了的条目全放过（#160 就是这么活了这么久的）", () => {
    const same = compareEntry({ from: "Model", to: "Base" }, { from: "Model", to: "Base" });
    const diff = compareEntry({ from: "Line", to: "Base" }, { from: "Base", to: "Line" });
    return { ok: same.length === 0 && diff.length === 2, got: `相同→${same.length} 条差异 · 相反→${diff.length} 条差异`, want: "0 / 2" };
  });

  return list;
}

const canaryResults = canaries().map((c) => ({ ...c, ...c.fn() }));
const broken = canaryResults.filter((c) => !c.ok);
if (broken.length) {
  console.error("⛔ 门自己坏了 —— mock-fidelity:check 的金丝雀未命中，本次**不产出任何结论**。");
  console.error("   （铁律 0.6：金丝雀不中只许报「工具坏了」，绝不许报「mock 干净 / 零谎报」。）\n");
  for (const c of broken) {
    console.error(`  ✗ 金丝雀「${c.name}」未中`);
    console.error(`      为什么它重要：${c.why}`);
    console.error(`      期望：${JSON.stringify(c.want)}`);
    console.error(`      实际：${JSON.stringify(c.got)}`);
  }
  process.exit(2);
}

/* ════════════════════════════════════════════════════════════════════════════
 * 4 · 判定
 * ═══════════════════════════════════════════════════════════════════════════ */

// 载体① 路由目录
const routeViolations = [];
for (const r of mockRoutes) {
  if (!/^\/(a|b|api)\/v1\//.test(r.path)) continue; // 非平台路由（探活等）不在本门管辖
  if (!routeBackedBy(r, backendRoutes, rewritePrefixes)) {
    routeViolations.push({ id: `ROUTE ${r.method} ${r.path}`, where: `${r.file}:${r.line}` });
  }
}

// 载体② 链路条目方向/基数
const linkViolations = [];
for (const me of mockLinks) {
  const cands = beLinksByKey.get(me.key);
  if (!cands || cands.length === 0) continue; // 后端无同 key ⇒ 不在本载体管辖（见「诚实边界」）
  // 任一后端声明与 mock 一致即算一致（同 key 多处声明时，只要 mock 对上了其中一处就不算谎报）
  const best = cands.map((b) => ({ b, d: compareEntry(me, b) })).sort((x, y) => x.d.length - y.d.length)[0];
  if (best.d.length === 0) continue;
  for (const d of best.d) {
    linkViolations.push({
      id: `LINK ${me.key}.${d.field}`,
      where: `${me.file}:${me.line}`,
      detail: `mock=${d.mock} vs 后端=${d.backend}（${best.b.file}:${best.b.line}）`,
    });
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * 5 · 棘轮基线（只减不增）
 * ═══════════════════════════════════════════════════════════════════════════ */

const BASELINE_NOTE =
  "mock 谎报棘轮基线（WO-GATE-MOCK-FIDELITY · 闭本体 §8 G-MOCK-OVERCLAIM）。" +
  "每条 = 一处「mock 声称的，真后端并不提供或方向相反」的**已知欠账**，必须写明 why。" +
  "**只减不增**：--update 只摘掉已修复项，绝不收编新增谎报（否则棘轮秒变橡皮图章）；" +
  "要把一条新谎报记进存量，必须人手编辑本文件——那是一个可评审的显式动作，不是脚本的副作用。";

const empty = { version: 1, note: BASELINE_NOTE, exemptions: {} };
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : empty;
const exempt = base.exemptions ?? {};

const current = [...routeViolations, ...linkViolations];
const currentIds = current.map((v) => v.id);
const fresh = current.filter((v) => !(v.id in exempt));
const fixed = Object.keys(exempt).filter((id) => !currentIds.includes(id));

function writeBaseline(entries, how) {
  writeFileSync(
    BASELINE,
    JSON.stringify({ version: 1, note: BASELINE_NOTE, generatedBy: `node scripts/check-mock-fidelity.mjs ${how}`, exemptions: entries }, null, 2) + "\n",
  );
}

if (SEED) {
  if (existsSync(BASELINE)) {
    console.error("✗ --seed 拒绝执行：基线已存在。首次建账才用 --seed；日常收紧用 --update（只减不增）。");
    process.exit(1);
  }
  const seeded = {};
  for (const v of current) seeded[v.id] = { why: "TODO 填写理由", where: v.where };
  writeBaseline(seeded, "--seed");
  console.log(`· 首次建账：${current.length} 条记为今天的存量（此后只减不增）。**必须人手把每条的 why 写清楚。**`);
  process.exit(0);
}
if (UPDATE) {
  const next = {};
  for (const [id, meta] of Object.entries(exempt)) if (currentIds.includes(id)) next[id] = meta;
  writeBaseline(next, "--update");
  console.log(`· 基线已收紧：${Object.keys(exempt).length} → ${Object.keys(next).length} 条（新增谎报 ${fresh.length} 条**未**收编）`);
}

/* ── 报告 ── */
console.log(`· 金丝雀 ${canaryResults.length}/${canaryResults.length} 全中（词法 1 · 路由 4 · 对象解析 2 · 条目 2）——抽取器在真源码上有效，下面的否定结论才有资格被相信。`);
console.log(
  `· 载体① 目录：mock 声明 ${mockRoutes.length} 条路由 · 后端注册 ${backendRoutes.length} 条` +
    `（别名前缀 ${rewritePrefixes.join("/")}）· **mock 谎报 ${routeViolations.length} 条**`,
);
console.log(
  `· 载体② 条目：mock 链路条目 ${mockLinks.length} 条 · 后端同类 key ${beLinksByKey.size} 个` +
    ` · **方向/基数不一致 ${linkViolations.length} 条**`,
);
if (VERBOSE || fresh.length) {
  for (const v of current) {
    const tag = v.id in exempt ? "（已记基线）" : "★新增";
    console.log(`    ${tag} ${v.id}  ${v.where}${v.detail ? `  ${v.detail}` : ""}`);
  }
}
if (fixed.length) {
  console.log(`· ✅ 有人把 mock 修对了：${fixed.join(" , ")}`);
  console.log("  → 跑 `node scripts/check-mock-fidelity.mjs --update` 收紧基线（只减不增）。");
}

if (fresh.length) {
  console.error(`\n✗ mock-fidelity:check 未通过（${fresh.length} 条**新增** mock 谎报 · 棘轮只许降不许升）：`);
  for (const v of fresh) {
    console.error(`  - ${v.id}   ${v.where}${v.detail ? `\n      ${v.detail}` : ""}`);
    console.error(
      `      → 这就是 G-MOCK-OVERCLAIM：mock 声称的东西真后端并不提供（或方向相反）。` +
        `\n        后果：前端在 mock 上跑得通、前端测试全绿，一接真后端就崩。` +
        `\n        修：把 mock 改成与真后端一致（mock 是后端的影子，不是它的对手）；` +
        `\n        或确属暂不修 → 人手加进 scripts/mock-fidelity-baseline.json 并写明 why。`,
    );
  }
  process.exit(1);
}
console.log(
  `\n✓ mock-fidelity:check 通过：mock 声明的目录与条目无**新增**谎报` +
    `（存量 ${Object.keys(exempt).length} 条已记基线，只减不增）。`,
);
