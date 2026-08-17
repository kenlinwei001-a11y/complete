#!/usr/bin/env node
/**
 * 门 `derived-recompute:check` · **派生属性重算一致性核对**
 * （WO-DERIVED-RECOMPUTE-CHECK · 闭 `docs/SYSTEM-ONTOLOGY.md` §8 `G-DERIVED-FORMULA-UNVERIFIED`）
 *
 * ══ 治什么 · 为什么既有的门/测试看不见 ═══════════════════════════════════════════
 * 本体里有 `derivedProperties`（`{propKey, formula}`），派生管线
 * （`apps/datacore/src/ontology.ts` `runDerivations()`）按公式重算并**物化到对象 props 上**。
 * 但**从来没有任何东西验过「这个 formula 真的能算出那个值」**：
 *   · 公式写错了、或值来自**别的路径**（不是由 formula 算的，是别处写进来的），
 *   · 屏上照样有数、测试照样绿、**没有任何信号**。
 *
 * 更要命的是求值器本身是**静默容错**的：`evalArithmetic`（`ontology.ts:78`）对**未知标识符
 * 返回 0**，不抛不报 —— 实测 `evalArithmetic("nope * 2", {}) === 0`。于是一条引用了
 * 并不存在的属性名的公式，会安静地把 0 写进对象，全链一个字都不报错。
 * 本仓刚出过同族事故：`navigation-slice.ts` 的 `OBJECT_KEY_PROPS` 85 个属性名里
 * **40 个（47%）在其声明的类型上根本不存在**。
 *
 * **既有的覆盖有多少 —— 现算，不猜**：`synthetic/service.ts:2030` 的 `derivationSpotChecks`
 * 是仓里唯一一处「重算比对」，它只查 **2 条派生属性**（`Model.totalDemand` / `Base.committedQty`），
 * 而且**每条只查 1 个对象**（`models[0]` 与 `bases.find(changzhou)`）。
 * 唯一断言它的是 `apps/datacore/test/synthetic.test.ts:25`。
 * 全库派生属性 **14 条**（本门现算）⇒ **12 条 × 全部实例，今天一次都没被算过**。
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『抽查了 2 条各 1 个对象』当作『14 条公式都算得对』的证据，而前者并不度量后者。」**
 *
 * ══ 判据（四条 · 同时成立才算过）═══════════════════════════════════════════════
 *
 * **A · 分类闭合（无静默跳过）**
 *   每条 formula 必须落进 `AGG`（`FN(Type.prop BY field)`）或 `ARITH`（可机械求值的算术式）之一。
 *   落不进 ⇒ `OPAQUE`（自然语言 / 引用本体外的东西 / 解析失败），**必须在
 *   `scripts/derived-recompute-baseline.json` 的 `opaque` 里有条目且带 `whyNotComputable`**。
 *   没登记 ⇒ **红**。⛔ **静默跳过等于「我没查」被读成「查了都对」** —— 这条判据就是防这个。
 *
 * **B · 标识符闭合（硬 · 无豁免）**
 *   · ARITH：公式里每个标识符必须在**同一类型**的
 *     `properties ∪ derivedProperties ∪ stateVariables` 里解析得到；
 *   · AGG：`sourceType` 必须是已发布类型，`sourceProp` 与 `byField` 必须在 `sourceType` 上存在。
 *   不闭合 ⇒ 红。这一条钉死的正是 `evalArithmetic` 静默返 0 的形态。
 *
 * **C · 逐实例重算 == 实际存的值（硬 · 无豁免 · 本门的核心）**
 *   · **实际存的值** = **真跑生产派生管线**拿到的值：把出厂本体 + 出厂种子实例种进
 *     内存仓（`repo/memory.js createMemoryRepos`），**调 `OntologyService.runDerivations()` 本尊**，
 *     再从 `obj.props[propKey]` 读回来。⚠ 刻意**不复刻**管线（复刻出来的一致只能证明我抄得像）。
 *   · **重算值** = 本门**自己的独立严格求值器**（`strictRecompute`）：未知标识符**抛**、
 *     非数值**抛**，绝不像生产那样静默返 0。
 *   · 逐实例比对（生产 `round(v,6)`，故本门同样取 6 位再比，容差 1e-9）。
 *     不符 ⇒ 红，逐条报 **属性名 · formula · 重算值 · 实际值 · 差多少**。
 *   · **C2 · 种子预填值**：种子生成器**已经填了**该派生键的实例（值来自**别的路径**，
 *     如 `InterBaseTransfer.etaDay` 在 `battery.ts:4785` 被早填），其预填值也必须 == 公式重算值。
 *     这一条抓的就是「公式与实际来源分家」。
 *
 * **D · 量纲（棘轮 · 存量挂账只降不升）**
 *   比对时**同时核量纲** —— 本仓前科 `G-LEVER-SNAPSHOT-UNIT-LIE`：张力峰值（0–100 无量纲）
 *   被塞进 `capWanP50`（万套/窗口），门守不了、屏上不显示、审批的人照着假数签了字。
 *   两条可机械判定的形态：
 *   · **D1 · 比率存百分号**：propKey 在同类型 PropertyDef 上声明 `unit ∈ {%, pct, 百分比}`，
 *     而公式是**无 ×100 的比值**，且实测值域全部 ⊆ [-1,1] ⇒ **差 100 倍**。
 *     （前端真有 `` `${m.value}${m.unit}` `` 这种直贴写法，见
 *     `apps/frontend-shell/src/views/sim/PhysicalTopologyView.tsx:63`。）
 *   · **D2 · 万×万仍叫万**：乘法公式里 ≥2 个**乘数**带「万」量纲（unit 含「万」或名字含 `Wan`），
 *     而目标属性名/unit 仍只声称一个「万」⇒ 万×万 = 亿，**差 10⁴ 倍**。
 *   ⛔ **本单只查不改**（改公式还是改值是**产品判断**不是工程判断）⇒ 存量逐条挂账进基线，
 *   条数**只降不升**；新增一条即红。
 *
 * ══ 诚实边界（本门**不**保证什么 · 别把绿读成「派生都对」）═════════════════════
 *  · 真值集 = **demo 出厂本体 + 出厂种子**（`batteryObjectTypes()` ∪ `extendedObjectTypes()`
 *    × `generateBattery(42,"S")`），与 `lever-prop-resolvable:check` 同一集合。
 *    租户运行期自建的类型/实例、pg 仓里的历史数据，**不在射程内**。
 *  · **只覆盖 `derivedProperties` 这一种派生机制**。本仓还有第二种：`DerivationSpec`
 *    （`ontology-core.ts compileSpecs`，DSL 带 link 导航）。现算：src 里唯一调用方是
 *    REST 端点 `app.ts:4095`，**没有任何种子路径调它** ⇒ demo 的 `derivationSpecs` 恒 0 条
 *    （`sim/certification.ts:249` 的实测注释也写着 demo「派生 0」）。
 *    **那是「接了线没数据」，不是「已覆盖」** —— 哪天有种子了，本门看不见它。
 *  · **不验「谁在用这个派生值」**：一条公式算得对、但屏上根本不读它（或读的是别处一份同名量），
 *    本门照样绿。`metric_rollup` 求解器就**另算了一份 `delta`**
 *    （`solvers/service.ts:4126` `round(actual - target, 4)`，且 `target` 会被 `PlanTarget` 覆盖、
 *    `unit==="%"` 时 actual/target 还会 ×100）——**同一个屏上有两个「差异」**。
 *    今日两者数值恰好相同（PlanTarget.period 是 `2026/2026-Q1…`，与 Metric.key `gm_rate…`
 *    交集为空 ⇒ 对齐分支从不触发；所有 % 指标的值都 >1 ⇒ 缩放分支从不触发），
 *    **是「今天碰巧相等」不是「结构上一致」**，故如实记在这里，不做成判据（那是另一张单）。
 *  · **不验前端 mock 里那份公式副本**（`apps/frontend-shell/src/mocks/fixtures.ts:796/800`
 *    各抄了一份 `derivations:[{propKey,formula}]`）。抄了两份就会漂，但该文件本单不碰。
 *
 * ══ 金丝雀（保命判据 · 与主逻辑**共用同一份实现**，不另抄一份）═══════════════════
 *  报「否定结论」（没有派生属性 / 都对得上 / 没有量纲问题）之前先自证工具是好的：
 *   ① 抽取必中：`Metric.delta` 必须被抽到且 `classify` 判为 `ARITH`；
 *      `Base.committedQty` 必须被抽到且判为 `AGG`（两个我确定存在的样例）；
 *   ② 抽取计数 > 0、对象类型数 > 0、`runDerivations` 必须 SUCCEEDED 且 updatedObjects > 0；
 *   ③ **必咬**：`compareOne()`（**主判定函数本尊**）喂一对故意对不上的数 ⇒ 必须报不符；
 *   ④ **必不咬**：同一个函数喂一对对得上的数 ⇒ 必须不报（防「怎么写都红」）；
 *   ⑤ **必咬**：`closureOf()`（**主判定函数本尊**）喂一条引用不存在属性的公式 ⇒ 必须报；
 *   ⑥ **必不咬**：同一个函数喂 `Metric.delta` 的真公式 ⇒ 必须不报；
 *   ⑦ **必咬/必不咬**：`unitVerdict()` 对已知形态（`MaterialBalance.coverage` 报 D1 /
 *      `Metric.gapPct` 不报）双向各一；
 *   ⑧ `baselineDocCanary()`（共享基线写入器的四向自检）。
 *  任一不中 ⇒ 打印「⛔ 门自己坏了」并 **RC=2**，**不许**报「都对 / 无违规 / 通过」。
 *
 * ══ 变异反证开关（机器可复跑 · 真变异见门账 provenRed）═════════════════════════
 *   DERIVED_RECOMPUTE_MUTATE_FORMULA="Metric.delta=actual - target - 1"
 *        改错公式 ⇒ 必须 RC=1，且**点名那一个属性**并给出重算值/实际值/差多少
 *   DERIVED_RECOMPUTE_MUTATE_VALUE="Metric.delta=+1"
 *        公式不动、把**实际存的值**改错 ⇒ 同样 RC=1
 *   DERIVED_RECOMPUTE_BREAK_EVALUATOR=1
 *        弄坏求值器 ⇒ 必须 **RC=2 而非 0**（「我没算出来」不许读成「都对」）
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-DERIVED-FORMULA-UNVERIFIED`（本门所闭断点）。
 * 门账：scripts/gate-ledger.json（同批登账，否则新门天然免疫 gate-ledger:check 治理）。
 * 用法：node scripts/check-derived-recompute.mjs   ·   pnpm derived-recompute:check
 *       node scripts/check-derived-recompute.mjs --update   （认账用 · 不是消红用）
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)。
 * 守门的门：scripts/check-gate-exit-discipline.mjs。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-derived-recompute.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「派生都对 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 5).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDistFresh } from "./dist-freshness.mjs";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "apps/datacore/dist");
const BASELINE = join(ROOT, "scripts/derived-recompute-baseline.json");
const SYNTH_SERVICE_SRC = join(ROOT, "apps/datacore/src/synthetic/service.ts");
const UPDATE = process.argv.includes("--update");

/** RC=2 统一出口：任何「我没能完成判定」的情形都走这里。 */
function toolBroken(lines) {
  console.error("⛔ derived-recompute:check **门自己坏了，不是代码坏了**：");
  for (const l of lines) console.error(`  - ${l}`);
  console.error("   本次结论作废：**不许**读作「派生都对 / 无违规 / 通过」——本门这次什么都没证明。");
  process.exit(2);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 判定本体 —— 金丝雀与主判据**共用这一份**，不另抄一份查法
 * （铁律 0.6 已落地的机制：抄一份的金丝雀是装饰品，改主逻辑时它拿旧的去测、照样绿。）
 * ═══════════════════════════════════════════════════════════════════════════ */

const AGG_RE = /^\s*(SUM|COUNT|MIN|MAX|AVG)\(\s*([A-Za-z_][\w]*)\.([\w]+)\s+BY\s+([\w]+)\s*\)\s*$/i;
/** ARITH 词法：与生产 `evalArithmetic` 同一套（数字 / 标识符 / + - * / ( )）。 */
const TOKEN_RE = /\d+(?:\.\d+)?|[A-Za-z_][\w]*|[+\-*/()]/g;

/** 把一条 formula 分类成 AGG / ARITH / OPAQUE。**唯一分类入口**。 */
function classify(formula) {
  if (typeof formula !== "string" || formula.trim() === "") {
    return { kind: "OPAQUE", why: "formula 为空或非字符串" };
  }
  const m = AGG_RE.exec(formula);
  if (m) {
    return {
      kind: "AGG",
      agg: { fn: m[1].toUpperCase(), sourceType: m[2], sourceProp: m[3], byField: m[4] },
    };
  }
  const tokens = formula.match(TOKEN_RE) ?? [];
  // 词法必须**无残渣**：把 token 逐个抠掉后剩下的只能是空白。
  // 有残渣 = 出现了算术式表达不了的东西（中文散文、函数调用、比较符、点号导航…）⇒ OPAQUE。
  let rest = formula;
  for (const t of tokens) {
    const i = rest.indexOf(t);
    if (i < 0) return { kind: "OPAQUE", why: `词法切分残缺（token「${t}」回找不到）` };
    rest = rest.slice(0, i) + rest.slice(i + t.length);
  }
  if (rest.trim() !== "") {
    return { kind: "OPAQUE", why: `含算术式表达不了的片段「${rest.trim()}」（自然语言描述 / 函数调用 / 本体外引用）` };
  }
  if (!tokens.some((t) => /^[A-Za-z_]/.test(t))) {
    return { kind: "OPAQUE", why: "公式里一个标识符都没有（纯常量不是派生）" };
  }
  return { kind: "ARITH", tokens };
}

/** 类型上所有可解析的属性名（承载位三选一：普通 / 派生 / 状态变量）。 */
function propNamesOf(type) {
  return new Set([
    ...(type?.properties ?? []).map((p) => p.propKey),
    ...(type?.derivedProperties ?? []).map((p) => p.propKey),
    ...(type?.stateVariables ?? []).map((p) => p.propKey),
  ]);
}

/**
 * 判据 B · 标识符闭合。**唯一闭合判定入口**（金丝雀走的也是它）。
 * @returns {string[]} 不闭合的说明（空数组 = 闭合）
 */
function closureOf(cls, type, typeByKey) {
  const bad = [];
  if (cls.kind === "AGG") {
    const st = typeByKey.get(cls.agg.sourceType);
    if (!st) {
      bad.push(`聚合源类型 ${cls.agg.sourceType} 在已发布本体里不存在`);
      return bad;
    }
    const names = propNamesOf(st);
    if (!names.has(cls.agg.sourceProp)) bad.push(`聚合源属性 ${cls.agg.sourceType}.${cls.agg.sourceProp} 不存在`);
    if (!names.has(cls.agg.byField)) bad.push(`聚合分组字段 ${cls.agg.sourceType}.${cls.agg.byField} 不存在`);
    return bad;
  }
  if (cls.kind !== "ARITH") return bad;
  const names = propNamesOf(type);
  for (const t of new Set(cls.tokens.filter((x) => /^[A-Za-z_]/.test(x)))) {
    if (!names.has(t)) {
      bad.push(
        `标识符 ${t} 在类型 ${type.key} 上不存在 —— ` +
          `生产求值器 evalArithmetic 对它**静默返 0**（不抛不报），这条公式会把一个错数安静写进对象`,
      );
    }
  }
  return bad;
}

/**
 * 本门**自己的**严格求值器：未知标识符抛、非数值抛。
 * ⛔ 刻意**不复用** dist 的 `evalArithmetic` —— 那样比对退化成「自己跟自己比」。
 */
function strictRecompute(cls, props, known) {
  if (process.env.DERIVED_RECOMPUTE_BREAK_EVALUATOR === "1") {
    // 故障注入：证「求值器坏掉时门会喊 RC=2」，而不是一句写在注释里的承诺。
    throw new Error("DERIVED_RECOMPUTE_BREAK_EVALUATOR=1 注入的求值器故障");
  }
  const tokens = cls.tokens;
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function prim() {
    const t = next();
    if (t === undefined) throw new Error("公式提前结束");
    if (t === "(") {
      const v = add();
      if (next() !== ")") throw new Error("缺右括号");
      return v;
    }
    if (t === "-") return -prim();
    if (/^\d/.test(t)) return Number(t);
    if (!known.has(t)) throw new Error(`UNKNOWN_IDENT:${t}`);
    const v = props[t];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`NON_NUMERIC:${t}=${JSON.stringify(v)}`);
    return v;
  }
  function mul() {
    let v = prim();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const r = prim();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function add() {
    let v = mul();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = mul();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const out = add();
  if (pos !== tokens.length) throw new Error("公式尾部有多余 token");
  return out;
}

/** 聚合重算（本门自己算一遍：按 `src.props[byField]` 匹配 `target.props[pk]`）。 */
function strictAggregate(agg, targetKey, sources) {
  if (process.env.DERIVED_RECOMPUTE_BREAK_EVALUATOR === "1") {
    throw new Error("DERIVED_RECOMPUTE_BREAK_EVALUATOR=1 注入的求值器故障");
  }
  const values = [];
  let count = 0;
  for (const s of sources) {
    const by = s.props[agg.byField];
    const hit = Array.isArray(by) ? by.includes(targetKey) : by === targetKey;
    if (!hit) continue;
    count++;
    const v = s.props[agg.sourceProp];
    if (typeof v === "number") values.push(v);
  }
  if (agg.fn === "COUNT") return count;
  if (agg.fn === "SUM") return values.reduce((a, b) => a + b, 0);
  if (agg.fn === "MIN") return values.length ? Math.min(...values) : 0;
  if (agg.fn === "MAX") return values.length ? Math.max(...values) : 0;
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; // AVG
}

/** 生产管线的取整（`ontology.ts` `round(value, 6)`）—— 本门同样取 6 位，免得把取整读成不符。 */
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const TOL = 1e-9;

/**
 * 判据 C · 单点比对。**唯一比对入口**（金丝雀的必咬/必不咬走的也是它）。
 * @returns {null | {expected:number, actual:unknown, diff:number|null, reason:string}}
 */
function compareOne(expected, actual) {
  if (typeof actual !== "number" || !Number.isFinite(actual)) {
    return { expected, actual, diff: null, reason: "实际值不是有限数值（派生管线没写、或写进了非数）" };
  }
  const e = round6(expected);
  if (Math.abs(e - actual) <= TOL) return null;
  return { expected: e, actual, diff: actual - e, reason: "重算值与实际存的值不符" };
}

/* ── 判据 D · 量纲 ───────────────────────────────────────────────────────────── */
const PCT_UNITS = new Set(["%", "pct", "百分比", "％"]);
/** 名字/单位是否带「万」量纲。 */
function isWanFlavored(name, unit) {
  if (unit && /万/.test(unit)) return true;
  return /(^|[^A-Za-z])[Ww]an($|[^a-z])/.test(name) || /Wan([A-Z0-9]|$)/.test(name);
}
/** 公式里直接参与乘法的标识符（token 层：`*` 的左右邻居）。 */
function multiplicandsOf(tokens) {
  const out = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "*") continue;
    for (const j of [i - 1, i + 1]) {
      const t = tokens[j];
      if (t && /^[A-Za-z_]/.test(t)) out.add(t);
    }
  }
  return out;
}
/**
 * 判据 D · 量纲裁决。**唯一量纲判定入口**（金丝雀双向走的也是它）。
 * @returns {null | {id:string, kind:"D1"|"D2", factor:string, detail:string}}
 */
function unitVerdict(typeKey, propKey, cls, type, values) {
  const declaredUnit = (type?.properties ?? []).find((p) => p.propKey === propKey)?.unit;
  // D1 · 比率存百分号
  if (cls.kind === "ARITH" && declaredUnit && PCT_UNITS.has(String(declaredUnit).trim())) {
    const scaled = /\*\s*100(\D|$)/.test(cls.tokens.join("")) || /100\s*\*/.test(cls.tokens.join("")) || cls.tokens.includes("100");
    const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
    const allRatio = nums.length > 0 && nums.every((v) => Math.abs(v) <= 1) && nums.some((v) => v !== 0);
    if (!scaled && allRatio) {
      return {
        id: `${typeKey}.${propKey}`,
        kind: "D1",
        factor: "100×",
        detail:
          `PropertyDef 声明 unit=${JSON.stringify(declaredUnit)}，但公式「${cls.formula}」是**无 ×100 的比值**，` +
          `实测 ${nums.length} 个实例值域 [${Math.min(...nums)}, ${Math.max(...nums)}] ⊆ [-1,1] ⇒ 存的是 0–1 比率，差 100 倍`,
      };
    }
  }
  // D2 · 万 × 万 仍叫万
  if (cls.kind === "ARITH") {
    const mults = multiplicandsOf(cls.tokens);
    const unitOf = (n) => (type?.properties ?? []).find((p) => p.propKey === n)?.unit;
    const wanMults = [...mults].filter((n) => isWanFlavored(n, unitOf(n)));
    if (wanMults.length >= 2 && isWanFlavored(propKey, declaredUnit)) {
      return {
        id: `${typeKey}.${propKey}`,
        kind: "D2",
        factor: "10⁴×",
        detail:
          `公式「${cls.formula}」里有 ${wanMults.length} 个「万」量纲的乘数（${wanMults
            .map((n) => `${n}${unitOf(n) ? `[${unitOf(n)}]` : ""}`)
            .join(" × ")}）⇒ 乘积量纲是 **万×万 = 亿**，` +
          `而目标属性名/单位仍只声称一个「万」（${propKey}${declaredUnit ? `[${declaredUnit}]` : ""}）⇒ 差 10⁴ 倍`,
      };
    }
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ⛔ 守卫必须在 import dist **之前**：本门读 dist 的类型/生成器，下的却是**源码**结论。
 * ═══════════════════════════════════════════════════════════════════════════ */
assertDistFresh(["apps/datacore/dist"], { gate: "derived-recompute:check" });

let bat, extm, ontoMod, memMod;
try {
  bat = await import(`file://${join(DIST, "synthetic/battery.js")}`);
  extm = await import(`file://${join(DIST, "synthetic/battery-extended.js")}`);
  ontoMod = await import(`file://${join(DIST, "ontology.js")}`);
  memMod = await import(`file://${join(DIST, "repo/memory.js")}`);
} catch (e) {
  toolBroken([`载入 apps/datacore/dist 失败：${e?.message || e}（先 pnpm --filter datacore build）`]);
}

const types = [...bat.batteryObjectTypes(), ...extm.extendedObjectTypes()];
const typeByKey = new Map(types.map((t) => [t.key, t]));

/* ── 受检集合**现算**，不手抄名册（`gate-roster:check` 治的正是手抄）──────────────
 * 类型 → 种子集合 的映射从 `synthetic/service.ts` 的 `putAll("Type", g.xxx, "pk")` 现场解析。
 * 新增一个带派生属性的类型并种进去，本门**自动**把它纳入射程。 */
const PUTALL_RE = /putAll\(\s*"([A-Za-z_]\w*)"\s*,\s*(g|ext)\.(\w+)\s*,\s*"(\w+)"\s*\)/g;
let putAllSrc = "";
try {
  putAllSrc = readFileSync(SYNTH_SERVICE_SRC, "utf8");
} catch (e) {
  toolBroken([`读不到 ${SYNTH_SERVICE_SRC}：${e?.message || e}`]);
}
const seedMap = new Map(); // typeKey -> { from: "g"|"ext", coll, pk }
for (const m of putAllSrc.matchAll(PUTALL_RE)) {
  if (!seedMap.has(m[1])) seedMap.set(m[1], { from: m[2], coll: m[3], pk: m[4] });
}

/* ── 抽取全部派生属性（分母） ─────────────────────────────────────────────────── */
const derived = []; // { typeKey, propKey, formula, cls }
for (const t of types) {
  for (const d of t.derivedProperties ?? []) {
    let formula = d.formula;
    // 变异反证开关①：改错某条公式（证「门真会红并点名」）。
    const mf = process.env.DERIVED_RECOMPUTE_MUTATE_FORMULA;
    if (mf) {
      const i = mf.indexOf("=");
      if (i > 0 && mf.slice(0, i).trim() === `${t.key}.${d.propKey}`) formula = mf.slice(i + 1);
    }
    const cls = classify(formula);
    cls.formula = formula;
    derived.push({ typeKey: t.key, propKey: d.propKey, formula, cls });
  }
}
derived.sort((a, b) => `${a.typeKey}.${a.propKey}`.localeCompare(`${b.typeKey}.${b.propKey}`));

/* ═══════════════════════════════════════════════════════════════════════════
 * 真跑生产派生管线（不是复刻）—— 拿到「实际存的值」
 * ═══════════════════════════════════════════════════════════════════════════ */
const SEED = 42;
const SCALE = "S";
const TENANT = "__derived_recompute_gate__";
const CTX = { tenantId: TENANT, userId: "gate", roles: ["admin"], attributes: {} };

let repos, runResult, gBattery, gExt;
try {
  repos = memMod.createMemoryRepos();
  for (const t of types) {
    await repos.ontologyTypes.put({ ...t, id: `otype_${t.key}`, tenantId: TENANT, version: 1, status: "ACTIVE" });
  }
  gBattery = bat.generateBattery(SEED, SCALE);
  const needExt = [...new Set(derived.map((d) => d.typeKey))].some((k) => seedMap.get(k)?.from === "ext");
  if (needExt && typeof extm.generateExtended === "function") {
    gExt = extm.generateExtended(
      SEED,
      {
        models: gBattery.models, bases: gBattery.bases, lines: gBattery.lines,
        equipment: gBattery.equipment, materialBalances: gBattery.materialBalances,
        demandSegments: gBattery.demandSegments,
      },
      SCALE,
    );
  }
  for (const [typeKey, spec] of seedMap) {
    const src = spec.from === "g" ? gBattery : gExt;
    const rowsIn = src?.[spec.coll];
    if (!Array.isArray(rowsIn)) continue;
    for (const row of rowsIn) {
      await repos.objects.put({
        id: `obj_${typeKey}_${String(row[spec.pk])}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
        tenantId: TENANT,
        type: typeKey,
        props: { ...row },
        origin: { type: "SYNTHETIC" },
      });
    }
  }
  const svc = new ontoMod.OntologyService(repos, null, null);
  runResult = await svc.runDerivations(CTX);
} catch (e) {
  toolBroken([`真跑生产派生管线（OntologyService.runDerivations）失败：${e?.message || e}`]);
}

/** 种子原始行（管线跑之前的值）—— 判据 C2 的「别的路径写进来的值」。 */
function seedRows(typeKey) {
  const spec = seedMap.get(typeKey);
  if (!spec) return null;
  const src = spec.from === "g" ? gBattery : gExt;
  return Array.isArray(src?.[spec.coll]) ? src[spec.coll] : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 金丝雀：先自证工具是好的，再谈结论
 * ═══════════════════════════════════════════════════════════════════════════ */
const canaryErrs = [];
{
  const bd = baselineDocCanary();
  if (!bd.ok) canaryErrs.push(`⑧ 共享基线写入器自检不过：want=${bd.want} got=${bd.got}`);
  if (types.length === 0) canaryErrs.push("② batteryObjectTypes() ∪ extendedObjectTypes() 载入出 0 个类型（构建产物异常）");
  if (derived.length === 0) canaryErrs.push("② 抽取到 **0 条**派生属性 —— 报「没有派生属性」之前先信这一条：是抽取器坏了");
  if (seedMap.size < 40) canaryErrs.push(`② putAll 映射只解析到 ${seedMap.size} 条（正常 > 40）—— 正则或源码路径变了`);
  if (!runResult || runResult.status !== "SUCCEEDED") canaryErrs.push(`② runDerivations 未 SUCCEEDED（status=${runResult?.status}）`);
  if (runResult && runResult.updatedObjects <= 0) canaryErrs.push("② runDerivations 一个对象都没更新 —— 派生管线这次没真跑");

  // ① 抽取必中（两个我确定存在的样例，且分类必须落对）
  const cMetric = derived.find((d) => d.typeKey === "Metric" && d.propKey === "delta");
  const cBase = derived.find((d) => d.typeKey === "Base" && d.propKey === "committedQty");
  if (!cMetric) canaryErrs.push("① 金丝雀 Metric.delta 没被抽到 —— 我确定它存在（battery.ts metricDerived）");
  else if (classify("actual - target").kind !== "ARITH") canaryErrs.push("① classify 把 `actual - target` 判成了非 ARITH");
  if (!cBase) canaryErrs.push("① 金丝雀 Base.committedQty 没被抽到 —— 我确定它存在（battery.ts baseDerived）");
  else if (classify("SUM(Order.qty BY bases)").kind !== "AGG") canaryErrs.push("① classify 把 `SUM(Order.qty BY bases)` 判成了非 AGG");

  // ③④ compareOne 双向（主判定函数本尊）
  if (compareOne(3, 5) === null) canaryErrs.push("③ 必咬：compareOne(3,5) 应报不符却放行 ⇒ 判据恒真 = 哑门");
  if (compareOne(3, 3) !== null) canaryErrs.push("④ 必不咬：compareOne(3,3) 不该报却报了 ⇒ 怎么写都红");

  // ⑤⑥ closureOf 双向（主判定函数本尊）
  const metricType = typeByKey.get("Metric");
  if (metricType) {
    const bogus = classify("actual - __no_such_prop__");
    if (closureOf(bogus, metricType, typeByKey).length === 0) {
      canaryErrs.push("⑤ 必咬：closureOf 对引用不存在属性的公式应报却放行");
    }
    if (closureOf(classify("actual - target"), metricType, typeByKey).length !== 0) {
      canaryErrs.push("⑥ 必不咬：closureOf 对 Metric 的真公式 `actual - target` 不该报却报了");
    }
  }

  // ⑦ unitVerdict 双向
  const mbType = typeByKey.get("MaterialBalance");
  if (mbType) {
    const cCov = classify("(netDemandTon - gapTon) / netDemandTon");
    cCov.formula = "(netDemandTon - gapTon) / netDemandTon";
    if (!unitVerdict("MaterialBalance", "coverage", cCov, mbType, [0.92, 0.94])) {
      canaryErrs.push("⑦ 必咬：unitVerdict 对 MaterialBalance.coverage（unit=% 却存 0–1 比率）应报 D1 却放行");
    }
  }
  if (metricType) {
    const cGap = classify("(actual - target) / target * 100");
    cGap.formula = "(actual - target) / target * 100";
    if (unitVerdict("Metric", "gapPct", cGap, metricType, [6.25, -9.2])) {
      canaryErrs.push("⑦ 必不咬：unitVerdict 对 Metric.gapPct（真·百分数）不该报却报了");
    }
  }
}
if (canaryErrs.length) toolBroken(canaryErrs);

/* ═══════════════════════════════════════════════════════════════════════════
 * 主判据
 * ═══════════════════════════════════════════════════════════════════════════ */
const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
const prevOpaque = new Map(Object.entries(prev?.opaque ?? {}));
const prevUnit = new Map(Object.entries(prev?.unitLie ?? {}));

const fail = [];
const rowsOut = [];
const opaqueNow = {};
const unitNow = {};
let comparedInstances = 0;
let comparedProps = 0;

for (const d of derived) {
  const type = typeByKey.get(d.typeKey);
  const id = `${d.typeKey}.${d.propKey}`;

  /* ---- 判据 A · 分类闭合 ---- */
  if (d.cls.kind === "OPAQUE") {
    const registered = prevOpaque.get(id);
    opaqueNow[id] = {
      formula: d.formula,
      whyNotComputable: registered?.whyNotComputable ?? `（未登记）${d.cls.why}`,
      detectedWhy: d.cls.why,
    };
    if (!registered || !registered.whyNotComputable) {
      fail.push(
        `A · 不可机械求值却**未登记**：${id}\n` +
          `      formula：「${d.formula}」\n` +
          `      抽取器判定：${d.cls.why}\n` +
          `      ⇒ 请在 scripts/derived-recompute-baseline.json 的 opaque 里补一条并写 whyNotComputable。\n` +
          `      ⛔ 不许静默跳过 —— 静默跳过等于「我没查」被下游读成「查了都对」。`,
      );
    }
    rowsOut.push(`  ⊘ ${id.padEnd(38)} OPAQUE  ${registered ? "已登记" : "**未登记**"}`);
    continue;
  }

  /* ---- 判据 B · 标识符闭合 ---- */
  const bad = closureOf(d.cls, type, typeByKey);
  if (bad.length) {
    for (const b of bad) {
      fail.push(
        `B · 公式标识符不闭合：${id}\n` +
          `      formula：「${d.formula}」\n` +
          `      ${b}\n` +
          `      修法二选一（**不许**改 formula 去迁就值 —— 那是把错误固化）：\n` +
          `        (a) 该量确实存在但改过名 ⇒ 把公式里的名字改成真名；\n` +
          `        (b) 该量根本不存在      ⇒ 这条派生属性本身是死的，连同它的消费方一起处置。`,
      );
    }
    rowsOut.push(`  ✗ ${id.padEnd(38)} ${d.cls.kind.padEnd(6)} 标识符不闭合`);
    continue;
  }

  /* ---- 判据 C · 逐实例重算 == 实际存的值 ---- */
  let objs = [];
  try {
    objs = await repos.objects.listByType(TENANT, d.typeKey);
  } catch (e) {
    toolBroken([`读回对象失败（${d.typeKey}）：${e?.message || e}`]);
  }
  if (objs.length === 0) {
    // 类型有派生属性但出厂种子没有实例 ⇒ 这条公式今天**一次都没被算过**（诚实报，不当成「对」）。
    opaqueNow[id] = opaqueNow[id] ?? undefined;
    rowsOut.push(`  – ${id.padEnd(38)} ${d.cls.kind.padEnd(6)} 出厂种子 0 实例（本次未比对）`);
    continue;
  }

  const known = propNamesOf(type);
  const pkProp = (type.properties ?? []).find((p) => p.isPrimaryKey)?.propKey ?? seedMap.get(d.typeKey)?.pk ?? "id";
  const aggSources =
    d.cls.kind === "AGG" ? await repos.objects.listByType(TENANT, d.cls.agg.sourceType) : null;

  // 变异反证开关②：公式不动，把**实际存的值**改错（证「值错了门也会红」）。
  let valueMutation = 0;
  const mv = process.env.DERIVED_RECOMPUTE_MUTATE_VALUE;
  if (mv) {
    const i = mv.indexOf("=");
    if (i > 0 && mv.slice(0, i).trim() === id) valueMutation = Number(mv.slice(i + 1));
  }

  const seeded = seedRows(d.typeKey);
  const seededByPk = seeded ? new Map(seeded.map((r) => [String(r[pkProp]), r])) : null;
  const values = [];
  let mismatched = 0;
  for (const o of objs) {
    let expected;
    try {
      expected =
        d.cls.kind === "AGG"
          ? strictAggregate(d.cls.agg, o.props[pkProp], aggSources)
          : strictRecompute(d.cls, o.props, known);
    } catch (e) {
      // 求值器自己算不出来 ⇒ **RC=2**，绝不读作「都对」。
      toolBroken([
        `重算 ${id}（对象 ${o.id}）时求值器抛异常：${e?.message || e}`,
        "⇒「我没算出来」不许读成「都对」，故本次判定作废。",
      ]);
    }
    let actual = o.props[d.propKey];
    if (valueMutation && typeof actual === "number") actual += valueMutation;
    values.push(actual);
    comparedInstances++;
    const bad2 = compareOne(expected, actual);
    if (bad2) {
      mismatched++;
      if (mismatched <= 3) {
        const dim = unitVerdict(d.typeKey, d.propKey, d.cls, type, values);
        fail.push(
          `C · 重算值 ≠ 实际存的值：${id}（对象 ${o.props[pkProp]}）\n` +
            `      formula ：「${d.formula}」\n` +
            `      重算值  ：${bad2.expected}\n` +
            `      实际值  ：${JSON.stringify(bad2.actual)}\n` +
            `      差多少  ：${bad2.diff === null ? "无法相减（实际值非数）" : bad2.diff}\n` +
            `      量纲    ：${dim ? `**不一致**（${dim.kind} ${dim.factor}）${dim.detail}` : "本门两条量纲判据未报"}\n` +
            `      原因    ：${bad2.reason}\n` +
            `      ⛔ 先追一层：这个值是**派生管线算的**，还是**别处写进来的**？两者修法完全不同。`,
        );
      }
    }

    // 判据 C2 · 种子预填值（值来自别的路径）
    const srow = seededByPk?.get(String(o.props[pkProp]));
    if (srow && srow[d.propKey] !== undefined) {
      const bad3 = compareOne(expected, srow[d.propKey]);
      if (bad3) {
        fail.push(
          `C2 · 种子**预填值**与公式重算不符（值来自别的路径）：${id}（对象 ${o.props[pkProp]}）\n` +
            `      formula ：「${d.formula}」\n` +
            `      重算值  ：${bad3.expected}\n` +
            `      预填值  ：${JSON.stringify(bad3.actual)}（由种子生成器直接写，不是派生管线算的）\n` +
            `      差多少  ：${bad3.diff === null ? "无法相减" : bad3.diff}\n` +
            `      ⇒ 「公式与实际来源分家」：屏上看到的可能是预填值，公式只是墙上的一句话。`,
        );
      }
    }
  }
  if (mismatched > 3) fail.push(`C · ${id} 另有 ${mismatched - 3} 个实例同样不符（此处省略）`);
  comparedProps++;

  /* ---- 判据 D · 量纲 ---- */
  const dim = unitVerdict(d.typeKey, d.propKey, d.cls, type, values);
  if (dim) {
    const registered = prevUnit.get(dim.id);
    unitNow[dim.id] = {
      kind: dim.kind,
      factor: dim.factor,
      formula: d.formula,
      detail: dim.detail,
      why: registered?.why ?? "（未挂账）本单只查不改：改公式还是改值属产品判断，须另开单裁决",
    };
    if (!registered) {
      fail.push(
        `D · 量纲不一致且**未挂账**：${dim.id}（${dim.kind} · 差 ${dim.factor}）\n` +
          `      ${dim.detail}\n` +
          `      ⇒ 前科 G-LEVER-SNAPSHOT-UNIT-LIE：门守不了、屏上不显示、审批的人照着假数签了字。\n` +
          `      ⇒ 本门只查不改：请在 scripts/derived-recompute-baseline.json 的 unitLie 里挂账并写 why，\n` +
          `        或者修掉它（棘轮只降不升）。`,
      );
    }
    rowsOut.push(`  ⚠ ${id.padEnd(38)} ${d.cls.kind.padEnd(6)} ${objs.length} 实例全对 · 量纲 ${dim.kind} 差 ${dim.factor}`);
  } else {
    rowsOut.push(`  ✓ ${id.padEnd(38)} ${d.cls.kind.padEnd(6)} ${objs.length} 实例逐一比对通过`);
  }
}

/* ---- 棘轮：只降不升 ---- */
const unitCount = Object.keys(unitNow).length;
const opaqueCount = Object.keys(opaqueNow).filter((k) => opaqueNow[k]).length;
const maxUnit = prev?.maxUnitLie ?? unitCount;
const maxOpaque = prev?.maxOpaque ?? opaqueCount;
if (!UPDATE) {
  if (unitCount > maxUnit) fail.push(`D · 棘轮：量纲挂账 ${unitCount} 条 > 基线 ${maxUnit} 条（只降不升）`);
  if (opaqueCount > maxOpaque) fail.push(`A · 棘轮：不可机械求值 ${opaqueCount} 条 > 基线 ${maxOpaque} 条（只降不升）`);
  for (const k of prevUnit.keys()) {
    if (!unitNow[k]) fail.push(`D · 死账：基线里挂着 ${k}，现算已不再命中 ⇒ 跑 --update 收紧（棘轮必须单调收缩）`);
  }
  for (const k of prevOpaque.keys()) {
    if (!opaqueNow[k]) fail.push(`A · 死账：基线里挂着 opaque ${k}，现算已不再命中 ⇒ 跑 --update 收紧`);
  }
}

/* ---- 报告 ---- */
const kinds = { AGG: 0, ARITH: 0, OPAQUE: 0 };
for (const d of derived) kinds[d.cls.kind]++;
console.log(
  `· derived-recompute：${types.length} 个对象类型 · ` +
    `${new Set(derived.map((d) => d.typeKey)).size} 个类型带派生属性 · **${derived.length} 条派生属性**` +
    `（可机械求值 ${kinds.AGG + kinds.ARITH} = 聚合式 ${kinds.AGG} + 算术式 ${kinds.ARITH} · 不可求值 ${kinds.OPAQUE}）`,
);
console.log(
  `  真跑生产派生管线：OntologyService.runDerivations() → ${runResult.status}，` +
    `更新 ${runResult.updatedObjects} 个对象，拓扑序 ${runResult.order.length} 个类型`,
);
console.log(`  逐实例比对：${comparedProps} 条派生属性 × 合计 ${comparedInstances} 个实例`);
console.log(`  金丝雀（必中）：Metric.delta→ARITH ✓ · Base.committedQty→AGG ✓ · compareOne 必咬/必不咬 ✓ · closureOf 必咬/必不咬 ✓ · unitVerdict 必咬/必不咬 ✓`);
for (const r of rowsOut) console.log(r);
if (unitCount) {
  console.log(`\n  ⚠ 量纲挂账 ${unitCount} 条（棘轮上限 ${maxUnit}，只降不升 —— 本单只查不改，修它是另一张单）：`);
  for (const [k, v] of Object.entries(unitNow)) console.log(`    · ${k}  ${v.kind} 差 ${v.factor} —— ${v.detail}`);
}
if (opaqueCount) {
  console.log(`\n  ⊘ 不可机械求值 ${opaqueCount} 条（登记在册，非静默跳过）：`);
  for (const [k, v] of Object.entries(opaqueNow)) if (v) console.log(`    · ${k}「${v.formula}」—— ${v.whyNotComputable}`);
} else {
  console.log(`\n  ⊘ 不可机械求值：**0 条**（金丝雀已证抽取器可用：${derived.length} 条全部抽到且分类落对）`);
}

/* ---- --update：认账（不是消红） ---- */
if (UPDATE) {
  const doc = buildBaselineDoc({
    prev,
    generatedBy: "node scripts/check-derived-recompute.mjs --update",
    prose: {
      note:
        "derived-recompute:check 的棘轮基线。unitLie = 量纲不一致的**存量挂账**（本门只查不改：" +
        "「改公式还是改值」是产品判断不是工程判断，故挂账不修）；opaque = 不可机械求值的派生属性登记表" +
        "（每条必须写 whyNotComputable —— 静默跳过等于「我没查」被读成「查了都对」）。" +
        "maxUnitLie / maxOpaque 只降不升；--update 是认账用的，不是消红用的。",
    },
    computed: {
      unitLie: unitNow,
      opaque: Object.fromEntries(Object.entries(opaqueNow).filter(([, v]) => v)),
      maxUnitLie: Math.min(maxUnit, unitCount),
      maxOpaque: Math.min(maxOpaque, opaqueCount),
    },
  });
  writeFileSync(BASELINE, JSON.stringify(doc, null, 2) + "\n");
  console.log(`\n✎ 已写 ${BASELINE}（unitLie ${unitCount} 条 · opaque ${opaqueCount} 条）`);
  process.exit(0);
}

if (fail.length) {
  console.error(`\n✗ derived-recompute:check 不通过（${fail.length} 条）：`);
  for (const f of fail) console.error(`  ${f}`);
  console.error(
    "\n  ⛔ 处置纪律：**不许**改 formula 去迁就值，也不许改值去迁就 formula —— 先追一层，" +
      "查清这个值到底由谁写入（派生管线？种子生成器？某个求解器？），再决定改哪一边。",
  );
  process.exit(1);
}
console.log(`\n✓ derived-recompute:check 通过（${comparedProps} 条派生属性 × ${comparedInstances} 个实例逐一重算比对，零不符）`);
process.exit(0);
