/**
 * ══ 门内「写死的受检对象集合」判据库 · G-GATE-ROSTER-HANDCOPIED 的普查器 ══════════
 *
 * ── 它治什么 ──────────────────────────────────────────────────────────────────
 * 一道门只能证明「**它问过的那些**是对的」，证明不了「**该问的都问了**」。
 * 凡把**受检对象集合**手抄成数组写死在门自己的源码里，不在名单里的对象就**永远绿**。
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『名单里那几个都合格』当作『所有该合格的都合格』的证据，而前者并不度量后者。」**
 *
 * 实测现场（WO-GATE-ROSTER-SWEEP 亲手测的，不是推想）：
 *   · `check-boundary-singlesource.mjs` 的「内联 baseId 回潮」扫描面 = 手抄 3 个文件。
 *     那 3 个今天**恰好一处都没有**（历史上修干净了）⇒ 门永远绿；
 *     而全仓真有 **5 个名单外文件、24 处**内联册内 baseId，**从未被这道门问过一次**。
 *   · `check-edge-active-mounts.mjs` 的 `PAGES` 手抄 9 条，推演页现算 12 条（另一 WO 已收）。
 *
 * ── ⚠ 本库最要紧的一条纪律：**不是所有写死都是病** ────────────────────────────
 * 阈值表 / 错误码表 / 词法表 / 金丝雀样例 / 规范条文抄录 —— 这些**本身就是判据**，
 * 写死是对的，改成"现算"反而把判据变成同义反复（拿被测物去定义判据 = 自证循环）。
 *
 * **区分判据只有一句**：
 *   > **这个集合会随仓库演进而变吗？**
 *   > 会变（新增一页 / 新增一个求解器 / 新增一个消费方就该进来）⇒ **该现算**（roster）
 *   > 不会变（它定义"什么算合格"，改它 = 改规范）              ⇒ **是判据本体**（criteria）
 *
 * 这句话**机器判不了** —— 它问的是集合的**语义**，而源码里只有**写法**。
 * 拿写法去猜语义正是铁律 0.6 点名的病（代理指标）。故本库的分工是**刻意**这样切的：
 *   · **机器**（本库）：按**客观形态**抽出全部候选，并给出可核对的**信号**（路径类/键类/散文类）；
 *   · **人**（基线 `scripts/gate-roster-baseline.json`）：逐条定性 + 写 `why`；
 *   · **门**（`check-gate-roster-handcopied.mjs`）：**没定性的候选 = 红**，且 `roster` 债只降不升。
 * 于是"新加的门里写死了名册"这件事，**下次是机器先说话**，不靠人想起来。
 *
 * ── 三种定性（写进基线的 `verdict`，处置完全不同，不许合并）────────────────────
 *   · `criteria` —— 判据本体，写死是对的。`why` 要答「凭什么它不随仓库演进而变」。
 *   · `computed` —— 已经现算了（本库抽到的只是现算逻辑的**输入常量**，如扫描根、正则表）。
 *   · `roster`   —— **真债**：受检对象集合写死了。`why` 必须写**差集是多少**、**该从哪儿现算**。
 *
 * ── 金丝雀纪律（铁律 0.6 落地机制）──────────────────────────────────────────────
 * `rosterCanary()` 把内嵌合成样例喂给**本文件导出的解析器本体**，不另抄一份正则
 * （抄了就是装饰品：改主正则时金丝雀拿旧的去测、照样绿）。
 * **双向**：必中样例（确实写死了名册）漏了 ⇒ 工具瞎了；必不中样例（不是名册）报了 ⇒ 工具乱咬。
 * 任一不符 ⇒ 调用方必须报「**工具坏了**」并 RC=2，**不许**报「全仓没有写死的名册」。
 *
 * 本文件是**纯函数库**：不读文件、不 `process.exit`、无顶层副作用。读盘与退出码归门。
 */

/** 仓内路径的首段（判「路径类信号」用）。这张表本身是**判据**：仓库顶层目录布局。 */
export const REPO_TOP_DIRS = ["apps", "packages", "scripts", "docs", "deploy", "db-seed", "services", ".github"];

/** 路径类元素：形如 `apps/datacore/src/x.ts`。**只认仓内首段**，避免把 URL / 正则片段算进来。 */
export const PATHISH_RE = new RegExp(`^(?:${REPO_TOP_DIRS.map((d) => d.replace(".", "\\.")).join("|")})/[\\w./*-]+$`);

/**
 * 键类元素：短的 ASCII 标识符（kebab / snake / dot / camel），无空格、无中文。
 * 这是"注册键"的形状 —— 视图键 `sim-sandbox`、求解器键 `capacity_forecast`、事件名 `order.settlement`。
 */
export const KEYISH_RE = /^[a-z][a-z0-9]*(?:[-_.:][a-z0-9]+)*$/i;

/**
 * 散文元素：含 CJK、或长过 40 字符、或含空白。
 * 散文占多数 ⇒ 这一坨多半是**金丝雀样例 / 规范条文抄录 / 理由文本**，不是受检对象名册。
 */
export function isProse(s) {
  return /[\u4e00-\u9fff]/.test(s) || s.length > 40 || /\s/.test(s);
}

/**
 * 剥注释（保留字符串字面量原样、保留换行以免行号偏移）。
 * 用逐字符小状态机而非正则：正则会把字符串里的 `//`（如 `http://`）误当注释起点，
 * 也会把注释里写的示例代码当成真代码 —— 本仓多道门都踩过这两个坑。
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 从 `open` 位置的开括号起做括号配对，返回闭括号下标（字符串内的括号不计）。-1 = 没配上。 */
function matchBracket(src, open) {
  const pairs = { "[": "]", "{": "}", "(": ")" };
  const close = pairs[src[open]];
  if (!close) return -1;
  let depth = 0;
  let q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === "\\") { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === src[open]) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * 抽出一个源文件里所有**顶层常量集合**（数组 / `new Set([...])` / 对象字面量）。
 *
 * 为什么只认**顶层**（行首 `const` / `export const`，缩进 0）：函数体里的临时数组是实现细节，
 * 而"受检对象名册"要被复用、要能被人 review，实测无一例外都写在文件顶层的大写常量上。
 * 把函数内的也算进来会把候选从 ~100 涨到几百条，**淹没**真正要看的那些 —— 噪声即失效。
 *
 * @returns {Array<{name:string,line:number,kind:"array"|"set"|"object",strings:string[],raw:string}>}
 */
export function extractRosters(src) {
  const code = stripComments(src);
  const out = [];
  const re = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(new Set\(\s*)?([[{])/gm;
  let m;
  while ((m = re.exec(code))) {
    const name = m[1];
    const isSet = !!m[2];
    const open = m.index + m[0].length - 1;
    const end = matchBracket(code, open);
    if (end < 0) continue;
    const body = code.slice(open + 1, end);
    const strings = [...body.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1] ?? x[2]);
    out.push({
      name,
      line: code.slice(0, m.index).split("\n").length,
      kind: isSet ? "set" : code[open] === "[" ? "array" : "object",
      strings,
      raw: body,
    });
    re.lastIndex = end;
  }
  return out;
}

/** 候选门槛：少于这么多字符串元素的常量不当"名册"看（1~2 条通常是一对锚点，不是册子）。 */
export const MIN_MEMBERS = 3;

/**
 * 给一个抽出的常量算**客观信号**，并判定它是否够格当"候选名册"。
 *
 * ⚠ 信号**不是定性**。信号只答「它长得像不像一册对象」，
 * 定性（criteria / computed / roster）只能由人写进基线 —— 见文件头「区分判据只有一句」。
 */
export function signals(entry) {
  const s = entry.strings;
  const pathish = s.filter((x) => PATHISH_RE.test(x));
  const keyish = s.filter((x) => !PATHISH_RE.test(x) && KEYISH_RE.test(x) && !isProse(x));
  const prose = s.filter((x) => isProse(x));
  const candidate =
    s.length >= MIN_MEMBERS &&
    // 路径类 ≥2：两条以上仓内路径写死在门里，几乎必然是"受检文件名册"
    (pathish.length >= 2 ||
      // 键类过半且 ≥3：一串注册键
      (keyish.length >= MIN_MEMBERS && keyish.length >= s.length / 2));
  return {
    n: s.length,
    pathish: pathish.length,
    keyish: keyish.length,
    prose: prose.length,
    candidate,
    sample: (pathish.length ? pathish : keyish).slice(0, 4),
  };
}

/** 候选 id：`<门文件>:<常量名>`。**刻意不含行号** —— 行号会漂，写死行号的引用天生带保质期。 */
export function rosterId(file, name) {
  return `${file}:${name}`;
}

/** 合法定性三分。处置完全不同，不许合并（见文件头）。 */
export const VERDICTS = new Set(["criteria", "computed", "roster"]);

/**
 * **双向**金丝雀 —— 直接跑本文件导出的 `extractRosters`/`signals` 本体，不另抄一份正则。
 *
 * 必中侧取的是**真实病样**（`check-boundary-singlesource.mjs` 的 `CONSUMERS` 原文形状）
 * 与**真实判据样**（`check-gate-ledger.mjs` 的 `DISPOSITIONS` 原文形状）——
 * 编一个自己保证能过的样例是自欺，判据必须咬真实写法。
 *
 * @returns {{ok:boolean, got:string, want:string, detail:object}}
 */
export function rosterCanary() {
  // ① 必中·路径类名册（boundary-singlesource 的 SEG_CONSUMERS 原文形状）
  const SAMPLE_PATH_ROSTER = `
const SEG_CONSUMERS = [
  "apps/datacore/src/synthetic/battery.ts",
  "apps/datacore/src/solvers/risk.ts",
  "apps/frontend-shell/src/views/plan/OrderChainView.tsx",
];
`;
  // ② 必中·键类名册（edge-active-mounts 的 PAGES 原文形状，去掉路径只留键）
  const SAMPLE_KEY_ROSTER = `
const PAGES = ["sandbox", "project-sim", "global-sim", "risk-board"];
`;
  // ③ 必不中·判据本体（gate-ledger 的 DISPOSITIONS：4 个枚举值，是判据不是名册）
  //    —— 它**长得像**名册（Set + 4 个短标识符），靠形态区分不开，所以本库**不判**它，
  //    交给基线定性。金丝雀在这里要的是「它确实被抽出来了」（抽不出来 = 漏掉，人就没机会定性）。
  const SAMPLE_CRITERIA = `
const DISPOSITIONS = new Set(["WIRE", "MANUAL", "FOLD", "DELETE"]);
`;
  // ④ 必不中·散文（金丝雀样例数组：全是中文长句，不是受检对象册）
  const SAMPLE_PROSE = `
const CANARIES = ["必咬-1 第一层堆料：口径公式 + 长说明直接渲染", "必不咬-1 同样的内容降进浮层 ⇒ 第一层只剩结论", "必咬-2 字号层级超上限"];
`;
  // ⑤ 必不中·注释里的名册（剥注释若失效，这一坨会被当成真代码抽出来）
  const SAMPLE_IN_COMMENT = `
// const FAKE_ROSTER = ["apps/a/src/x.ts", "apps/b/src/y.ts", "apps/c/src/z.ts"];
/* const ALSO_FAKE = ["apps/d/src/w.ts", "apps/e/src/v.ts"]; */
const REAL = 1;
`;
  // ⑥ 必不中·函数体内的临时数组（缩进 ≠ 0 ⇒ 不是可复用的册子）
  const SAMPLE_LOCAL = `
function f() {
  const local = ["apps/a/src/x.ts", "apps/b/src/y.ts", "apps/c/src/z.ts"];
  return local;
}
`;

  const one = (src) => extractRosters(src).map((e) => ({ e, s: signals(e) }));
  const pathR = one(SAMPLE_PATH_ROSTER);
  const keyR = one(SAMPLE_KEY_ROSTER);
  const crit = one(SAMPLE_CRITERIA);
  const prose = one(SAMPLE_PROSE);
  const inCmt = one(SAMPLE_IN_COMMENT);
  const local = one(SAMPLE_LOCAL);

  const checks = {
    "①必中·路径类名册被抽出且判为候选":
      pathR.length === 1 && pathR[0].e.name === "SEG_CONSUMERS" && pathR[0].s.candidate === true && pathR[0].s.pathish === 3,
    "②必中·键类名册被抽出且判为候选":
      keyR.length === 1 && keyR[0].e.name === "PAGES" && keyR[0].s.candidate === true && keyR[0].s.keyish === 4,
    "③判据本体也被抽出（抽不出来 = 人没机会定性）":
      crit.length === 1 && crit[0].e.name === "DISPOSITIONS" && crit[0].e.kind === "set",
    "④必不中·散文数组不判为候选":
      prose.length === 1 && prose[0].s.candidate === false && prose[0].s.prose === 3,
    "⑤必不中·注释里的名册一条都不许抽出":
      inCmt.filter((x) => /FAKE/.test(x.e.name)).length === 0,
    "⑥必不中·函数体内的临时数组不抽（只认顶层）":
      local.length === 0,
  };
  const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return {
    ok: bad.length === 0,
    got: bad.length ? `未通过：${bad.join(" · ")}` : "六向全通过",
    want: "六向全通过（路径类必中 · 键类必中 · 判据本体必被抽出 · 散文必不中 · 注释内必不抽 · 函数内必不抽）",
    detail: { pathR: pathR.map((x) => x.e.name), keyR: keyR.map((x) => x.e.name), crit: crit.map((x) => x.e.name), local: local.length },
  };
}
