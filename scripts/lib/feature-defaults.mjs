/**
 * 功能注册表 `defaultOn` 抽取器（`feature-default-parity:check` 与其金丝雀**共用这一份**）。
 *
 * 为什么单列一个 lib 而不在门里内联正则：铁律 0.6 —— 门里的金丝雀若各抄一份正则，
 * 改主逻辑时金丝雀拿旧的去测、照样绿，那金丝雀就是装饰品。本文件是**唯一实现**，
 * 主逻辑与金丝雀都只能调它。
 *
 * 词法层复用 `source-lex.mjs`（`stripComments` / `splitTopLevel`）——不另造轮子，
 * 也就不会出现「注释里的 `defaultOn: false` 被当成真条目」这类老坑
 * （`stripComments` 顶注记着那次真实事故：带注释的字段被整条读作不存在）。
 */
import { stripComments, splitTopLevel } from "./source-lex.mjs";

/**
 * 从源码里抽某个数组常量的 `{ key, defaultOn }` 条目。
 *
 * ⚠️ 必须从 `=` 之后再找 `[`：直接找 `[` 会撞上**类型标注** `FeatureDef[]`，
 *    抽出一个空数组并报「0 个 feature」——这正是 dark-launch 门当年被金丝雀逮住的写法。
 *
 * @param {string} src 源码全文
 * @param {string} declName 常量名（如 "FEATURE_REGISTRY" / "BUILTIN_VIEWS"）
 * @param {{keyField?: string}} [opts] key 字段名（BUILTIN_VIEWS 用 `featureKey`）
 * @returns {{entries: {key: string, defaultOn: boolean|null}[], spreads: string[],
 *            rawTrue: number, rawFalse: number, found: boolean}}
 */
export function extractDefaults(src, declName, opts = {}) {
  const keyField = opts.keyField ?? "key";
  const text = stripComments(src);
  const declIdx = text.indexOf(`const ${declName}`);
  if (declIdx < 0) return { entries: [], spreads: [], rawTrue: 0, rawFalse: 0, found: false };
  const eq = text.indexOf("=", declIdx);
  const open = eq < 0 ? -1 : text.indexOf("[", eq);
  if (open < 0) return { entries: [], spreads: [], rawTrue: 0, rawFalse: 0, found: false };

  const { parts, end } = splitTopLevel(text, open);
  const arrayText = text.slice(open, end);
  const entries = [];
  const spreads = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (p.startsWith("...")) { spreads.push(p.slice(0, 80)); continue; }
    const k = new RegExp(`\\b${keyField}\\s*:\\s*"([^"]+)"`).exec(p);
    if (!k) continue;
    const d = /\bdefaultOn\s*:\s*(true|false)\b/.exec(p);
    entries.push({ key: k[1], defaultOn: d ? d[1] === "true" : null });
  }

  // 独立的第二次测量：与上面的括号走查**机制不同**（子串计数 vs 顶层切分）。
  // 两个数字对不上 ⇒ 走查漏了条目 ⇒ 报「工具坏了」，不许报内容结论。
  //
  // ⚠️ 只量**数组切片**，不量整文件（这一条是实测踩出来的）：
  // `features.ts` 在 `FEATURE_REGISTRY` 之外还有一处 `defaultOn: true`
  // （`dynamicDefs()` 构造动态视图 FeatureDef 的那行）。按整文件计数会得 49+32=81 vs 走查 80，
  // 差 1 ⇒ 门每次都喊「工具坏了」。**那不是工具坏了，是尺子量错了对象** ——
  // 正是铁律 0.6 的形态：「我用『整文件的 defaultOn 计数』当作『数组条目数』的证据，而前者并不度量后者。」
  const rawTrue = (arrayText.match(/\bdefaultOn\s*:\s*true\b/g) ?? []).length;
  const rawFalse = (arrayText.match(/\bdefaultOn\s*:\s*false\b/g) ?? []).length;
  return { entries, spreads, rawTrue, rawFalse, found: true };
}

/**
 * A 侧（datacore）的**有效** defaultOn 全表。
 *
 * ⚠️ 关键：`features.ts` 的 `FEATURE_REGISTRY` 顶部是 `...builtInViewFeatureDefs()` ——
 * 一个**展开调用**，不是对象字面量。只扫字面量会把全部内置视图键读作「不存在」。
 * 那些键的 defaultOn 由 `view-manifest.ts` 的 `builtInViewFeatureDefs()` **硬编码为 true**，
 * 故此处按 `BUILTIN_VIEWS` 的 `featureKey` 逐条补成 true。
 * `builtinDefaultOn` 是这条假设的**显式载体**：`view-manifest.ts` 里那行若改了，
 * 门的 A9 自证会当场报出来（见门脚本），不会静默把结论算错。
 */
export function backendDefaults(featuresSrc, manifestSrc) {
  const reg = extractDefaults(featuresSrc, "FEATURE_REGISTRY");
  const views = extractDefaults(manifestSrc, "BUILTIN_VIEWS", { keyField: "featureKey" });
  // `builtInViewFeatureDefs()` 里写死的那个值（抽出来核对，不假定）
  const m = /function builtInViewFeatureDefs[\s\S]{0,400}?defaultOn:\s*(true|false)/.exec(stripComments(manifestSrc));
  const builtinDefaultOn = m ? m[1] === "true" : null;

  const map = new Map();
  for (const v of views.entries) map.set(v.key, builtinDefaultOn);
  for (const e of reg.entries) map.set(e.key, e.defaultOn); // 字面量后写，覆盖同名（现实中不重名）
  return { map, reg, views, builtinDefaultOn };
}

/** 前端 mock（fixtures.ts）侧的 defaultOn 全表。 */
export function mockDefaults(fixturesSrc) {
  const reg = extractDefaults(fixturesSrc, "FEATURE_REGISTRY");
  return { map: new Map(reg.entries.map((e) => [e.key, e.defaultOn])), reg };
}

/**
 * 逐 key 对账（**主逻辑与金丝雀共用的唯一比较实现**）。
 * 只看**两侧都声明了**的键；一侧缺失不是本门的事（`nav-group-coverage:check` 判据② 管那个方向）。
 * @returns {{key:string, backend:boolean|null, mock:boolean|null}[]} 反向清单
 */
export function divergences(backendMap, mockMap) {
  const out = [];
  for (const [key, mock] of mockMap) {
    if (!backendMap.has(key)) continue;
    const backend = backendMap.get(key);
    if (backend === null || mock === null) continue; // 没写 defaultOn 的条目不判（契约默认值由 zod 定，不是本门口径）
    if (backend !== mock) out.push({ key, backend, mock });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
