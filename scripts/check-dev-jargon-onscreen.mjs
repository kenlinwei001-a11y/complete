#!/usr/bin/env node
/**
 * 门 `dev-jargon:check` · **开发的话不许上屏**（WO-UI-LAYERING-BURNDOWN §3.3）
 *
 * ══ 守的命题 ═══════════════════════════════════════════════════════════════════
 * **给开发看的话，不许出现在用户的屏幕上。**
 * 判据一句话（派单原文）：**「这句话用户读了能做什么决定？」答不出 ⇒ 它不该在屏上。**
 *
 * 现场（本单实测，仓主截图那页）：`DecisionPlayView` 的入口横幅上印着
 *   「contracts **ChainImpedimentSchema** 是 **strictObject**，逐键核过，无 factorId / factorRef」
 * ——**契约类型名上了屏**。决策者不需要知道契约是不是 strictObject；
 * 这与 `DataBuilderPage` 的「三页归一（自成长收编）」「厂商中立施工」是同一个病。
 *
 * ══ ⚠ 这道门最容易做成废物的地方：把注释也数进去 ═════════════════════════════
 * 全仓 `grep -rEo "WO-[A-Z0-9-]+" views/ pages/admin/` 命中 **数百条**，
 * 但**绝大多数在注释里** —— 注释是写给开发看的，本来就该写这些，一个字都不算违规。
 * 拿 grep 的原始命中数当判据，会得出「全仓到处是违规」这个**恰好相反**的结论，
 * 然后这道门因为噪声太大被永久关掉。这正是本仓铁律 0.6 点名的形态：
 *   **「我用『源码里出现了这个词』当作『用户看得见这个词』的证据，而前者并不度量后者。」**
 *
 * ⇒ 故本门**不 grep 源码文本**，而是用 TypeScript 解析，只取**真正会渲染出去的字**：
 *    ① JSX 文本节点（`<div>这里</div>`）
 *    ② 文案型属性上的字符串字面量（`label=` / `title=` / `placeholder=` …）
 *    ③ 上述位置里的模板字符串字面量片段
 *    ④ **locale 模式**（`locales/**`）：整份文件就是词表，故取**全部**字符串/模板字面量，
 *       但**排除属性键名**（`{ "WO-FOO": 1 }` 的键不是给用户看的字）。
 *    注释 / 变量名 / import / data-testid / className **一律不看**。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ══ 2026-08-17 · WO-SCREEN-PLAINSPEAK 扩扫描面：**门原来射不到屏上文案的所在地** ══
 * ══════════════════════════════════════════════════════════════════════════════
 * 仓主指着「流程等待态」页问「这些功能描述型的文字之前也要求你调整，为何没有调整」，
 * 而本门当天 **RC=0、金丝雀 6/6 全中**。两者同时为真，因为本门那天**接了线接错地方**
 * （不是没接线，也不是没数据 —— 三种"不工作"修法完全不同，见 CLAUDE.md 铁律 0.5 判据 1）：
 *
 *   · **A1 扫描面**：`SCAN` 只有 `views` + `pages/admin` 且只收 `.tsx`。
 *     而截图上那段字的正文在 `apps/frontend-shell/src/locales/zh.ts` ——
 *     **目录不在射程、扩展名也不对**，1821 条屏上文案 100% 在门外。
 *     ⚠ 讽刺的是：这一条**本门自己在下面「诚实边界」里写明过**（「藏在 locale 里的测不出来」），
 *     写了两个月，没有任何机器去读它 —— **写在注释里的诚实边界不是机制**。
 *   · **A2 词表**：截图上印着 curl 命令 / `X-Debug-User` 调试头 / `127.0.0.1:4001` 本机端口 /
 *     jq 表达式 / `docs/xxx.md` 仓库路径 / `battery/S/seed=42` 种子口径 / 一堆没渲染的
 *     markdown 星号 —— **一条都不在当时的 `JARGON` 里**。
 *
 * 形态（铁律 0.6 句式）：
 *   **「我用『门 RC=0』当作『屏上没有开发话』的证据，而前者并不度量后者 ——
 *     门的射程里压根没有屏上文案真正住的那个文件。」**
 *
 * ── 由此加的那道**扫描面自证**（金丝雀堵不住这个洞，必须另设机制）─────────────
 * 金丝雀证明的是**检测逻辑没瞎**（喂它一段必中样例，它咬得动），
 * 它**证明不了扫描面选对了** —— 上面那次翻车正是"逻辑没瞎但射程错了"，
 * 6/6 全中与 100% 漏检同时成立。故本门另设**独立口径的分母下界**：
 * locale 面抽出来的字面量总数必须 ≥ `MIN_LOCALE_LITERALS`。
 * 抽取器一坏 / 目录一改名 / 扩展名一漏，这个分母当场塌，门喊「工具坏了」而不是「页面干净」。
 *
 * ══ 诚实边界（本门做不到什么，不许当成"屏上已干净"）════════════════════════════
 *  · ~~经变量间接上屏的看不见~~ —— **2026-08-17 已消除**：`locales/**` 已进扫描面，
 *    `<div>{zh.foo.bar}</div>` 的正文现在扫得到。（做到了的诚实位必须删，
 *    留一条已经不成立的"做不到"＝反过来骗人说这里还有个洞。）
 *  · **仍看不见：非 `locales/` 的模块里写死的屏上串**。实例（2026-08-17 复核）：
 *    `apps/frontend-shell/src/views/sim/sandboxConsoleModel.ts:809` 的
 *    `IMPEDIMENT_JOIN_REASON` 是病因文案表，同文件 `:850` 取出来上屏 ——
 *    它是 `.ts` 且不在 `locales/` 下，本门一个字都看不到。
 *    没有把 `views/` 下的 `.ts` 整个纳入，是**刻意的取舍**：那类文件里的字面量大多是
 *    对象类型名 / 端点路径 / 枚举值这些**本来就该是代码**的东西，纳入＝制造几百条误报，
 *    而误报一多这道门就会被关掉（见文件头「最容易做成废物的地方」）。
 *  · **仍看不见：跨文件的变量拼接**。`<p>{tip(kind)}</p>` 里 `tip()` 在别的模块拼出来的字，
 *    本门不跟函数调用、不做常量折叠。
 *  · **一条字面量只记第一个命中形态**（`check()` 里 `break`）⇒ 报告里的**形态分布是下界**，
 *    不是精确分布：一句话里既有星号又有 curl 时只记一条。总数不受影响。
 *  · **locale 面会过报**：locale 里少数串并不真上屏（如给 `aria-*` / 内部 key 用的）。
 *    方向是**多报**不是漏报，故不加豁免 —— 宁可多改一句话，不可放过一句。
 *  · **词表是有限的**：只咬列举的那几类形态，不是"所有开发术语"。
 *    新的黑话形态要手工补进 `JARGON`，不会自己冒出来。
 *  报「0 命中」时必须连同这几条一起报 —— 「我没找到」和「它不存在」是两个命题。
 *
 * ══ 金丝雀 ════════════════════════════════════════════════════════════════════
 * 与主逻辑**共用同一份 `analyze()`**，不另抄正则（抄一份 = 装饰品：改主正则时
 * 金丝雀拿旧的去测、照样绿。本仓 2026-08-08 实测过）。含「必咬」与「必不咬」两侧，
 * 必不咬那侧专门钉死「注释里的 WO 编号不算违规」这条 —— 它是本门唯一的活路。
 *
 * ══ 退出码 ════════════════════════════════════════════════════════════════════
 *   0 = 未超基线 · 1 = 真超标（新增开发话上屏）· 2 = **工具自己坏了**
 * 与 `check-ui-first-layer.mjs` 同约定：任何"我没能扫描"一律 RC=2，
 * 默认失败方向必须是「我没查出来」，不是「你的页面干净」。
 *
 * 用法：
 *   node scripts/check-dev-jargon-onscreen.mjs            # 门（棘轮）
 *   node scripts/check-dev-jargon-onscreen.mjs --selftest # 只跑金丝雀
 *   node scripts/check-dev-jargon-onscreen.mjs --list     # 逐条列出屏上命中
 *   node scripts/check-dev-jargon-onscreen.mjs --update   # 重写基线（需人工核）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/dev-jargon-baseline.json");
const SPEC = "docs/CONVENTION-ui-information-layering.md";

function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「屏上没有开发话 / 页面干净」——");
  console.error("   本门这次根本没有扫描成功，它什么都没证明。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2);
}

let ts;
try {
  ts = require("typescript");
} catch {
  toolBroken("缺 typescript（本门的 JSX 解析器）", "先跑 `pnpm install --prefer-offline` 再重跑。");
}

/**
 * 黑话词表 —— 前 6 条逐条对着派单 §3.3 原文抄的，不是自拟：
 *   > 契约类型名（`XxxSchema`）· `strictObject` · WO 编号 · PRD 区号（`区2`/`区4`…）·
 *   > 内部机制名（「三页归一」「自成长收编」「厂商中立施工」）
 * 后 7 条是 2026-08-17 WO-SCREEN-PLAINSPEAK 补的，**每一条都取自仓主截图上真印着的字**，
 * 不是想象出来的形态（想象出来的词表只会长出白名单，长不出命中）。
 *
 * ⚠ `form` 字段是**报告口径**，不是装饰：交单要给「逐形态命中表」，
 *   而 `why` 是给被咬的人看的一句话，两者用途不同，不许合并成一个字段。
 */
const JARGON = [
  { form: "契约类型名", re: /\b[A-Z][A-Za-z0-9]*Schema\b/, why: "契约类型名（用户不需要知道契约长什么样）" },
  { form: "zod术语", re: /\bstrictObject\b/, why: "zod 术语" },
  { form: "工单编号", re: /\bWO-[A-Z0-9][A-Z0-9-]*/, why: "工单编号（内部排期，不是用户的事）" },
  { form: "PRD区号", re: /区\s?[0-9①-⑳]/, why: "PRD 区号（内部章节编号）" },
  { form: "内部机制名", re: /(三页归一|自成长收编|厂商中立施工)/, why: "内部机制名（开发内部叫法）" },
  { form: "实现细节标识符", re: /\b(zod|tsx?|useQuery|useState|repo\.|msw)\b/, why: "实现细节标识符" },

  /* ── 以下 7 条：2026-08-17 补（仓主截图那页的原文逐类拆出来）───────────────── */
  {
    form: "shell命令",
    re: /\b(curl|jq|pnpm|npm run|git grep|grep -[rnEocl])\b/,
    why: "shell 命令（复验探针是给工程师的，决策者不会开终端；移进代码注释或 title 悬浮）",
  },
  {
    form: "本机URL端口",
    re: /\b(127\.0\.0\.1|localhost)(:\d+)?\b/,
    why: "本机 IP / 端口（用户的浏览器里根本不存在这个地址，印上去只会误导）",
  },
  {
    form: "调试请求头",
    re: /\bX-Debug-User\b/,
    why: "开发链路的调试请求头（生产走 JWT，用户看到它只会以为要自己拼 header）",
  },
  {
    form: "仓库文件路径",
    re: /\b(docs|apps|packages|scripts)\/[\w./-]*\.(md|ts|tsx|mjs|js|json|sql|ya?ml)\b/,
    why: "仓库文件路径（用户没有这个仓库；要给出处就挂 title 悬浮，不上第一层）",
  },
  {
    form: "接口路径",
    re: /\/(a|b|api)\/v1\//,
    why: "内部接口路径（用户读了做不出任何决定；出处属工程师层）",
  },
  {
    form: "种子画像口径",
    re: /\bseed\s*=\s*\d+|\bbattery\/[A-Z]\b/,
    why: "合成数据的种子/画像口径（内部复现参数，不是业务事实）",
  },
  {
    /**
     * ⚠ 这一条与其他 12 条**性质不同**：它咬的不是"用错了词"，是**渲染方式不对**。
     * 屏上原样印着 `**标准工期**` ⇒ 这些文案**按 markdown 写、按纯文本渲染**。
     * 作者以为自己做了强调，读者看到的是乱码。两个病：难看 + 强调完全丢失。
     * 修法全仓统一取 (i)：**去掉星号，要强调就用真正的 DOM 强调**（`<b>` / `<strong>`），
     * 不引行内 markdown 渲染器（本仓不许无理由加依赖，而这层依赖换不来别的东西）。
     */
    form: "未渲染md星号",
    re: /\*\*[^*\n]+\*\*/,
    why: "markdown 强调标记（这些文案按纯文本渲染，星号会原样印在屏上；改用 <b>/<strong>）",
  },
  {
    /**
     * ══ 误伤排查的实测记录（2026-08-17，WO 明令「先 `--list` 逐条看再定正则」）══════
     * 宽版正则（`/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/`，"全大写下划线"）两面合计命中 **48 条**，
     * 逐条看完 48 条之后，**这条规则自己的前提被证伪了**：
     *   **「全大写下划线」根本不度量「环境变量」—— 48 条里真·环境变量只有 3 条。**
     * 形态（铁律 0.6 句式）：**「我用『长得像环境变量』当作『是环境变量』的证据，
     * 而前者并不度量后者。」** 48 条实际是**三个不同的population**，修法各不相同：
     *
     *  | population | 例（实测原文） | 定性 | 该不该咬 |
     *  |---|---|---|---|
     *  | **产品语义的状态/枚举值** | `TICK_DRIVEN`（推演时钟态）· `PLAN_LOCKED`（409 码）· `IN_REVIEW`（审批态）· `SAT_SUN_OFF`（工作日口径，屏上紧跟中文解释）· `DERIVED_FROM_DOCUMENT`（溯源口径）· `CUSTOMS_BROKER`（清关段） | 用户读得懂、**读了能做决定** ⇒ 判据对它答得出来 | **不咬**（咬了这道门就会因噪声被关掉） |
     *  | **内部常量/注册表名** | `SEG_REGISTRY` · `CHAIN_NODE_REGISTRY` · `BASE_REGISTRY` · `CHAIN_STAGES` · `PROCUREMENT_LEGS` · `RING_LAYOUT` · `RAMP_PROFILE` · `SOLVER_FIELD_ROLES` | 只存在于源码里的**容器名**，用户无从知道也无从行动 | **咬**（但它是**另一个形态**，见下一条 `内部常量名`） |
     *  | **真·部署期环境变量** | `SEED_DEMO`（zh.ts:2649）· `OPTIMIZER_BASE_URL`（×2） | 运维配置 | **咬**（就是本条） |
     *
     * ⛔ **没有把正则收紧到"只咬我改完的那几条"**（那是买绿）。名单**不是我手列的**，
     *    是**从仓库自己的两个真相源现算**出来的（见 `deployEnvNames()`）：
     *      ① 全仓 `process.env.X` / `import.meta.env.X` 的实际读取点；
     *      ② `apps/<app>/src/config.ts` 里 zod env schema 的键。
     *    ⇒ 以后新加一个环境变量，这条规则**自动**跟着咬，不需要有人想起来改词表；
     *      而新写的 `FOO_BAR` 状态名不会被误伤。这就是「机器先说话」。
     */
    form: "环境变量名",
    match: (s, ctx) => {
      for (const n of ctx.envNames) if (new RegExp(`\\b${n}\\b`).test(s)) return n;
      return null;
    },
    why: "部署期环境变量名（运维配置，用户改不了也不该知道；出处属工程师层）",
  },
  {
    /**
     * 上面那张表的第二个 population —— **内部常量/注册表名**。
     * 与「环境变量名」**刻意分成两条**：定性不同、修法不同（一个是运维配置该藏起来，
     * 一个是源码容器名该换成业务说法），合成一条就会像原来那样用一个笼统数字盖住两个事实。
     *
     * 判据取**中心词**（容器语义），不取"我改没改到"：`_REGISTRY|_STAGES|_LEGS|_LAYOUT|
     * _PROFILE|_ROLES|_REFS|_DEFS|_TABLE|_CONFIG` 这些词头指的都是「开发把数据放哪儿」，
     * 而不是「你的东西现在什么状态」。
     * ⚠ `CATALOG` 刻意**不在**表里：实测 `OUT_OF_CATALOG` 是个状态码（"不在目录内"），
     *   收进来就会误伤 —— 中心词判据必须逐个对着实测样例验，不能凭语感拍。
     */
    form: "内部常量名",
    re: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(REGISTRY|STAGES|LEGS|LAYOUT|PROFILE|ROLES|REFS|DEFS|TABLE|CONFIG)\b/,
    why: "源码里的常量/注册表名（用户无从知道也无从行动；换成业务说法或移进 title 悬浮）",
  },
];

/**
 * **真·部署期环境变量名单 —— 从仓库自己的真相源现算，不手列。**
 *
 * 手列名单的病：它度量的是「我今天想起了哪几个」，不是「仓库里有哪几个」。
 * 现算的两个源（缺一都会漏）：
 *   ① `process.env.X` / `import.meta.env.X` 的**实际读取点** —— 但 `SEED_DEMO` 这类
 *      经 `config.SEED_DEMO` 间接读的**抓不到**（实测：它只在 `config.ts` 的 schema 里露名）；
 *   ② `apps/<app>/src/config.ts` 的 zod env schema 键 —— 补上 ① 的那个洞。
 * 这正是铁律 0.5 那条「grep 的直接命中不是结论，必须再追一层」的实例：
 * 只用 ① 会漏掉一半，而漏掉的那一半照样印在屏上。
 */
function deployEnvNames(root) {
  const names = new Set();
  const takeEnvReads = (src) => {
    for (const m of src.matchAll(/(?:process|import\.meta)\.env(?:\.([A-Z][A-Z0-9_]{2,})|\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\])/g)) {
      names.add(m[1] ?? m[2]);
    }
  };
  const roots = [];
  for (const group of ["apps", "packages"]) {
    const g = join(root, group);
    if (!existsSync(g)) continue;
    for (const pkg of readdirSync(g)) {
      const s = join(g, pkg, "src");
      if (existsSync(s) && statSync(s).isDirectory()) roots.push({ dir: s, pkg });
    }
  }
  const walkAll = function* (dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) yield* walkAll(p);
      else if (/\.(ts|tsx|mjs)$/.test(e.name)) yield p;
    }
  };
  for (const { dir } of roots) {
    for (const f of walkAll(dir)) {
      let src;
      try {
        src = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      takeEnvReads(src);
      // ② env schema 的键（`SEED_DEMO: z.string()…`）—— 只在 config*.ts 里认，避免把
      //    普通对象的全大写键当成环境变量
      if (/[\\/]config[\w-]*\.ts$/.test(f)) {
        for (const m of src.matchAll(/^\s{2}([A-Z][A-Z0-9_]{2,})\s*:\s*z\./gm)) names.add(m[1]);
      }
    }
  }
  return names;
}
/** 现算名单的下界 —— 抽取器一坏名单会空掉，那时本条规则**静默失效**（不报错，只是不再咬）。 */
const MIN_ENV_NAMES = 15;
/**
 * 金丝雀用的小样本名单。
 * ⚠ 金丝雀**不该**依赖全仓现算（那要求跑金丝雀时仓库是完整的，且会把"名单算错"
 * 和"规则写错"两种失败混成一个信号）。这里只放几个**确定存在**的名字，
 * 逐形态活性验的是「规则会不会用名单」，名单本身对不对由 `MIN_ENV_NAMES` 下界另管。
 */
const CANARY_ENV_NAMES = new Set(["DATABASE_URL", "SEED_DEMO", "OPTIMIZER_BASE_URL", "JWT_SECRET", "SERVICE_TOKEN"]);

/** 文案型属性 —— 这些属性上的字符串会渲染给用户看。 */
const TEXT_ATTR = /^(label|title|heading|caption|placeholder|text|desc|description|hint|summary|subtitle|tip|topic|aria-label)$/;

/**
 * **属性键名判别** —— locale 模式的要害。
 *
 * ⛔ **不许用 `ts.isPropertyName(n)`**（审核方 2026-08-17 第一版就栽在这里）：
 *   它是按**语法种类**判的 —— `PropertyName` 这个语法类别本身就包含 `StringLiteral`，
 *   于是任何字符串字面量它都返回 true ⇒ **全部字符串字面量被跳过**，只剩模板串，
 *   `zh.ts` 报「6 条」。若信了它，结论会是「屏上开发话只有 6 条、基本干净」——
 *   而事实是 67 条，**恰好相反**。是金丝雀（必中-字符串字面量里的 curl）当场抖出来的。
 *   形态（铁律 0.6 句式）：**「我用『这个节点属于 PropertyName 语法类别』当作
 *   『它是一个键名』的证据，而前者并不度量后者 —— 值的位置上照样是同一个语法种类。」**
 *
 * ✅ 正确姿势：看它**在父节点里坐的是哪个位置** —— `parent.name === n` 才是键。
 */
function isPropertyKey(n) {
  const p = n.parent;
  if (!p) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isEnumMember(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p)) && p.name === n) return true;
  // `obj["键"]` 的下标 —— 是取值用的键，不是给用户看的字
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  // `import x from "…"` / `export … from "…"` 的模块说明符
  if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === n) return true;
  return false;
}

/**
 * **主判据本体** —— 门 / `--list` / 金丝雀**三者共用这一份**。
 * @param {string} src
 * @param {string} fileName
 * @param {"jsx"|"locale"|"auto"} mode  locale 模式取全部字面量（整份文件就是词表）
 * @returns {{text:string,match:string,form:string,why:string,line:number}[]} 屏上命中
 */
export function analyze(src, fileName = "x.tsx", mode = "auto", ctx = null) {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const isLocale = mode === "locale" || (mode === "auto" && /[\\/]locales[\\/]/.test(fileName));
  /** 独立口径分母：locale 面抽出来的字面量总数（扫描面自证用，见文件头）。 */
  let literalCount = 0;
  // 规则上下文（现算的环境变量名单）。金丝雀不传 ⇒ 用内置小样本，保证逐形态活性可测。
  const rctx = ctx ?? { envNames: CANARY_ENV_NAMES };

  const check = (raw, line) => {
    const s = String(raw).replace(/\s+/g, " ").trim();
    if (!s) return;
    for (const j of JARGON) {
      // 规则有两种形态：`re`（正则）与 `match`（函数，用于要吃现算名单的那种）
      const m = j.re ? j.re.exec(s)?.[0] : j.match(s, rctx);
      if (m) {
        hits.push({ text: s.slice(0, 80), match: m, form: j.form, why: j.why, line });
        break;
      }
    }
  };

  const visit = (node) => {
    // ④ locale 模式：整份文件就是屏上词表 ⇒ 取全部字面量，只排掉键名/模块说明符
    if (isLocale) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (!isPropertyKey(node)) {
          literalCount += 1;
          check(node.text, lineOf(node));
        }
      } else if (ts.isTemplateExpression(node)) {
        // 模板串：`已卡 ${n} 天` —— head 与每个 span 的字面量段都是屏上的字
        literalCount += 1;
        check(node.head.text, lineOf(node));
        node.templateSpans.forEach((sp) => check(sp.literal.text, lineOf(sp.literal)));
      }
      ts.forEachChild(node, visit);
      return;
    }

    // ① JSX 文本节点 —— 真正印在屏上的字
    if (ts.isJsxText(node)) check(node.text, lineOf(node));

    // ② 文案型属性上的字面量
    if (ts.isJsxAttribute(node) && node.name && node.initializer) {
      const an = node.name.getText();
      if (TEXT_ATTR.test(an)) {
        if (ts.isStringLiteral(node.initializer)) check(node.initializer.text, lineOf(node));
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          // 只取字面量片段；变量引用跨文件，本门不跟（见"诚实边界"）
          const walk = (n) => {
            if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) check(n.text, lineOf(node));
            else if (ts.isTemplateExpression(n)) {
              check(n.head.text, lineOf(node));
              n.templateSpans.forEach((sp) => check(sp.literal.text, lineOf(node)));
            }
            ts.forEachChild(n, walk);
          };
          walk(node.initializer.expression);
        }
      }
    }

    // ③ JSX 表达式容器里的字面量：`<div>{"文字"}</div>` / `<div>{`模板`}</div>`
    if (ts.isJsxExpression(node) && node.expression) {
      const ex = node.expression;
      if (ts.isStringLiteral(ex) || ts.isNoSubstitutionTemplateLiteral(ex)) check(ex.text, lineOf(node));
      else if (ts.isTemplateExpression(ex)) {
        check(ex.head.text, lineOf(node));
        ex.templateSpans.forEach((sp) => check(sp.literal.text, lineOf(node)));
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  // 独立口径分母随命中一起带出（不可枚举 ⇒ 不影响既有把返回值当纯数组用的调用方）
  Object.defineProperty(hits, "literalCount", { value: literalCount, enumerable: false });
  return hits;
}

/* ── 金丝雀：与主逻辑共用同一份 analyze() ────────────────────────────────────── */
const CANARIES = [
  {
    name: "必咬-1 契约类型名 + zod 术语上屏（仓主截图那页的原文）",
    src: `export const V = () => <div>（contracts <span>ChainImpedimentSchema</span> 是 strictObject，逐键核过）</div>;`,
    expect: (h) => h.some((x) => /Schema/.test(x.match)) && h.some((x) => x.match === "strictObject"),
  },
  {
    name: "必咬-2 PRD 区号上屏",
    src: `export const V = () => <div>下面 区4 显示的是默认根因</div>;`,
    expect: (h) => h.some((x) => /区\s?4/.test(x.match)),
  },
  {
    name: "必咬-3 内部机制名上屏",
    src: `export const V = () => <div>三页归一（自成长收编）</div>;`,
    expect: (h) => h.length >= 1,
  },
  {
    name: "必咬-4 文案型属性上的 WO 编号",
    src: `export const V = () => <button title="WO-FOO-BAR 入口">去</button>;`,
    expect: (h) => h.some((x) => /^WO-/.test(x.match)),
  },
  {
    /**
     * ⚠ **本门唯一的活路，也是最容易做错的一条。**
     * 注释里的 WO 编号 / 契约名是**写给开发看的，本来就该写**。
     * 全仓注释里有数百条 —— 若本门把它们算进去，噪声会淹掉真违规，门必被关掉。
     * 形态（铁律 0.6）：「我用『源码里出现了这个词』当作『用户看得见这个词』的证据。」
     */
    name: "必不咬-1 注释 / 变量名 / testid 里的黑话不算违规（本门的活路）",
    src: `/** WO-FOO-BAR · 见 ChainImpedimentSchema（strictObject） */
      import { ChainImpedimentSchema } from "@platform/contracts";
      const wo = "WO-FOO-BAR"; // 区4
      export const V = () => <div data-testid="wo-区4" className="strictObject">正常文案</div>;`,
    expect: (h) => h.length === 0,
  },
  {
    name: "必不咬-2 普通中文文案不误伤",
    src: `export const V = () => <div>缩短备份供应商认证周期 · 本季 · 规则未到线</div>;`,
    expect: (h) => h.length === 0,
  },

  /* ══ locale 面的金丝雀（2026-08-17 补）══════════════════════════════════════════
   * ⚠ **样例形状取自生产实物，不是手写单行**（WO 明令）。手写的 `const a = "curl x"`
   * 与真实的**多段 `+` 拼接对象属性**在 AST 上是两种形状：真实那段是
   *   `cannotAnswer: "…①…" + "…② curl …" + "…（**日期**·battery/S/seed=42）…"`
   * 抽取器若只认「单个 StringLiteral 初始值」，手写样例照中、生产实物照漏 ——
   * 金丝雀全绿而漏检 100%。故下面这段是从 `locales/zh.ts` 的 `honesty.cannotAnswer`
   * **原样搬过来的**（本单改文案前的那一版），一个字都没简化。
   */
  {
    name: "必咬-5 [locale] 生产实物：多段拼接里的 curl / 本机端口 / 调试头 / 仓库路径",
    file: "apps/frontend-shell/src/locales/zh.ts",
    src: `export const zh = {
      honesty: {
        title: "本页答得了什么、答不了什么",
        cannotAnswer:
          "答不了（诚实边界）：① 实例时刻是从既有带时间戳单据反推的；" +
          "（2026-08-13 实测·battery/S/seed=42；复验：\`curl -s -H 'X-Debug-User: demo:admin:admin' " +
          "'http://127.0.0.1:4001/a/v1/process-definitions/P34/instances' | jq '{available,instanceCount}'\`，" +
          "逐条清单见 \`docs/WO-FLOWTIME-feasibility.md\`）",
      },
    };`,
    /**
     * ⚠ 断言刻意**不**写成「这 5 个形态各中一条」—— 第一版就是那么写的，当场被自己咬红。
     * 原因：`check()` 一条字面量只记**第一个**命中形态（`break`），而这段是 4 段 `+` 拼接，
     * 每段只贡献 1 条 ⇒ 实测是 `shell命令 / shell命令 / 工单编号` 三条。
     * 这不是 bug，是既有的计数口径（与旧基线可比），故**改断言、不改口径**。
     * 那这条金丝雀真正该钉死的是什么 ⇒ **多段拼接的每一段都被抽到了**（漏抽第 2 段是真会发生的病），
     * 判据落在「命中分布在 ≥3 个不同行上」——单段抽取器绝不可能满足它。
     * 逐形态是否活着由下面 `必咬-9` 那组**隔离样例**逐条证明（隔离 ⇒ 不受 break 掩盖）。
     */
    expect: (h) => h.length >= 3 && new Set(h.map((x) => x.line)).size >= 3 && h.some((x) => x.form === "shell命令"),
  },
  {
    name: "必咬-6 [locale] 拼接式字面量的**第二段**（不是只咬第一段）",
    file: "apps/frontend-shell/src/locales/zh.ts",
    // 第一段完全干净 ⇒ 只认"初始值第一个字面量"的抽取器会漏掉它
    src: `export const zh = { a: { note: "这一页只对部分流程算得出停留时长。" + "复验：curl -s 'http://127.0.0.1:4001/a/v1/x'" } };`,
    expect: (h) => h.some((x) => x.form === "shell命令" || x.form === "本机URL端口"),
  },
  {
    // 样例里刻意**不含** WO 号：`工单编号` 在词表里排得更靠前，会把 `仓库文件路径` 这条遮掉
    // （break 语义）—— 遮掉之后这条金丝雀就变成在验 `工单编号`，而不是它自称在验的那条。
    name: "必咬-7 [locale] 模板串的 span 段（不是只咬 head 段）",
    file: "apps/frontend-shell/src/locales/zh.ts",
    src: `export const zh = { a: { tip: (n: number) => \`共 \${n} 条，详见 docs/flowtime-feasibility.md\` } };`,
    expect: (h) => h.some((x) => x.form === "仓库文件路径"),
  },
  {
    name: "必咬-8 [locale] 未渲染的 markdown 星号（按 md 写、按纯文本渲染）",
    file: "apps/frontend-shell/src/locales/zh.ts",
    src: `export const zh = { a: { s: "下方**标准工期**是定义值，不是实测滞留天数" } };`,
    expect: (h) => h.some((x) => x.form === "未渲染md星号"),
  },
  {
    /**
     * ⚠ **本条钉死那个把审核方骗过一次的坑**（见 `isPropertyKey` 的注释）：
     * 用 `ts.isPropertyName()` 排键名 ⇒ 所有 StringLiteral 全被跳过 ⇒ 上面 4 条必咬**全灭**。
     * 这一条与它们是**一对**：只有"键名不咬"与"值咬得到"同时成立，判别才是对的。
     * 只写其中一边，两种错法（全跳过 / 全不跳过）各能骗过一边。
     */
    name: "必不咬-3 [locale] 属性键名不算违规（但同一份文件里的值照咬）",
    file: "apps/frontend-shell/src/locales/zh.ts",
    src: `export const zh = { "WO-FOO-BAR": { "docs/x.md": 1, ok: "正常业务文案：本季度产能缺口 3 个基地" } };`,
    expect: (h) => h.length === 0,
  },
  {
    name: "必不咬-4 [locale] 注释里的 WO 号 / curl / 仓库路径不算违规（注释天然不进 AST）",
    file: "apps/frontend-shell/src/locales/zh.ts",
    src: `/** WO-FOO · 复验 curl http://127.0.0.1:4001/a/v1/x，清单见 docs/y.md */
      // 环境变量 DATABASE_URL 见 docs/z.md
      export const zh = { a: { s: "正常业务文案：本季度产能缺口 3 个基地" } };`,
    expect: (h) => h.length === 0,
  },
  {
    /** 产品语义的状态名/枚举值**不是**环境变量，误伤它们会让这道门被关掉（见 `环境变量名` 那条的注释）。 */
    name: "必不咬-5 [locale] 产品语义的全大写状态名不误伤（TICK_DRIVEN 这类）",
    file: "apps/frontend-shell/src/locales/zh.ts",
    src: `export const zh = { a: { s: "推演时钟处于 TICK_DRIVEN 态，计划已 PLAN_LOCKED，等待 AWAITING_APPROVAL" } };`,
    /**
     * ✅ 2026-08-17 已收敛并恢复为硬断言。
     * 这三个名字是**实测样本**（`TICK_DRIVEN` 见 zh.ts:821/835/841/843，
     * `PLAN_LOCKED` 见 zh.ts:1355，`IN_REVIEW` 见 zh.ts:1460）——
     * 宽版正则当时把它们全咬了，正是那 48 条里最大的一个误伤 population。
     */
    expect: (h) => h.length === 0,
  },
];

/**
 * **必咬-9 · 逐形态活性金丝雀** —— 每条新词表规则**单独**喂一个只含该形态的样例。
 *
 * 为什么必须隔离：`check()` 一条字面量只记第一个命中形态。把 8 个形态塞进一段话，
 * 只会证明**排最前面那条**活着，后面 7 条即使被写死成 `/$^/` 也照样全绿 ——
 * 那正是本仓说的「装饰品金丝雀」。形态（铁律 0.6 句式）：
 * **「我用『这段话被咬了』当作『这 8 条规则都活着』的证据，而前者并不度量后者。」**
 *
 * 样例句刻意写成**决策者读得懂的中文**外壳 + 一处黑话，与生产实物同形。
 */
const FORM_LIVENESS = [
  ["shell命令", "复验：curl -s 那个接口再看回值"],
  ["本机URL端口", "服务地址 http://127.0.0.1:4001 上取回"],
  ["调试请求头", "请求需带 X-Debug-User: demo:admin:admin"],
  ["仓库文件路径", "逐条清单见 docs/flowtime-feasibility.md"],
  ["接口路径", "数据取自 /a/v1/process-definitions 这一路"],
  ["种子画像口径", "口径 battery/S/seed=42 下重跑一致"],
  ["未渲染md星号", "下方**标准工期**是定义值，不是实测"],
  ["环境变量名", "部署时把环境变量 DATABASE_URL 指向新库"],
  ["内部常量名", "在册节点取自 CHAIN_NODE_REGISTRY，今天为空"],
];

/**
 * **必不咬-6 · 中心词判据的边界样例**（与 `内部常量名` 那条规则配对）。
 * `OUT_OF_CATALOG` 长得像"容器名"（含 CATALOG），实为状态码「不在目录内」。
 * 这条钉死「`CATALOG` 不进中心词表」这个决定 —— 决定写在注释里会被后人顺手改掉，
 * 写成金丝雀才拦得住（本仓：写在注释里的纪律不是机制）。
 */
CANARIES.push({
  name: "必不咬-6 [locale] 长得像容器名的状态码不误伤（OUT_OF_CATALOG）",
  file: "apps/frontend-shell/src/locales/zh.ts",
  src: `export const zh = { a: { s: "该物料不在目录内（OUT_OF_CATALOG），请先补目录再下单" } };`,
  expect: (h) => h.length === 0,
});

for (const [form, sample] of FORM_LIVENESS) {
  CANARIES.push({
    name: `必咬-9 [逐形态活性] ${form}`,
    file: "apps/frontend-shell/src/locales/zh.ts",
    src: `export const zh = { a: { s: ${JSON.stringify(sample)} } };`,
    expect: (h) => h.some((x) => x.form === form),
  });
}

function runCanaries() {
  const fails = [];
  for (const c of CANARIES) {
    let h;
    try {
      // 文件名决定 mode（auto）—— 金丝雀走的是与全仓扫描**同一条**分派路径，
      // 不许在这里手工指定 mode：那会让金丝雀验的路径与生产路径分叉。
      h = analyze(c.src, c.file ?? "canary.tsx");
    } catch (e) {
      fails.push(`${c.name} —— analyze() 抛异常：${e.message}`);
      continue;
    }
    if (!c.expect(h)) fails.push(`${c.name} —— 实测命中 ${h.length} 条：${h.map((x) => `${x.form}:${x.match}`).join(" / ") || "（无）"}`);
  }
  return fails;
}

/* ── 扫描面 ────────────────────────────────────────────────────────────────────
 * 逐层枚举，**不用 pathspec 通配**（CLAUDE.md 铁律 0.5 判据 #5：含通配的 pathspec
 * 不当目录前缀用，含通配的那种恒 0 命中 ⇒ 会得出「全仓干净」这个恰好相反的结论）。
 * `mode` 决定抽取器走哪条路：`jsx` 只取会渲染的 JSX 位置；`locale` 取全部字面量。
 */
const SCAN = [
  { dir: "apps/frontend-shell/src/views", exts: [".tsx"], mode: "jsx" },
  { dir: "apps/frontend-shell/src/pages/admin", exts: [".tsx"], mode: "jsx" },
  // 2026-08-17 补：屏上文案 100% 住在这里，而门原来看不见它（见文件头 A1）
  { dir: "apps/frontend-shell/src/locales", exts: [".ts", ".tsx"], mode: "locale" },
];
const MIN_FILES = 80;
/**
 * **扫描面自证的独立口径分母**（金丝雀堵不住的那个洞，见文件头）。
 * locale 面抽出来的字面量总数下界 —— 2026-08-17 实测 `zh.ts` 为 1821 条，
 * 取 1200 留出正常增删的余量。抽取器一坏 / 目录改名 / 扩展名漏，这个数当场塌，
 * 门喊「工具坏了」而**不是**「页面干净」。
 */
const MIN_LOCALE_LITERALS = 1200;

function listFiles() {
  const out = [];
  const walk = (abs, rel, depth, ent) => {
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs)) {
      const p = join(abs, e);
      const r = `${rel}/${e}`;
      if (statSync(p).isDirectory()) {
        if (depth < 2) walk(p, r, depth + 1, ent);
      } else if (ent.exts.some((x) => e.endsWith(x))) out.push({ file: r, mode: ent.mode });
    }
  };
  for (const d of SCAN) walk(join(ROOT, d.dir), d.dir, 1, d);
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

function scanAll() {
  const rows = [];
  let localeLiterals = 0;
  const envNames = deployEnvNames(ROOT);
  if (envNames.size < MIN_ENV_NAMES) {
    console.error(`⛔ 门自己瞎了：现算的环境变量名单只有 ${envNames.size} 个（下界 ${MIN_ENV_NAMES}）。`);
    console.error("   名单空掉时 `环境变量名` 这条规则会**静默失效**（不报错，只是再也不咬）——");
    console.error("   那正是「门报绿而它什么都没查」的形态。**不许**把本次读作「屏上没有环境变量名」。");
    process.exit(2);
  }
  const ctx = { envNames };
  for (const { file: f, mode } of listFiles()) {
    let src;
    try {
      src = readFileSync(join(ROOT, f), "utf8");
    } catch {
      continue;
    }
    const hits = analyze(src, f, mode, ctx);
    if (mode === "locale") localeLiterals += hits.literalCount ?? 0;
    if (hits.length) rows.push({ file: f, hits });
  }
  return { rows, localeLiterals, envNames };
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return null;
  try {
    const j = JSON.parse(readFileSync(BASELINE, "utf8"));
    if (!j || typeof j.files !== "object") toolBroken("基线结构不对（缺 files）");
    return j;
  } catch (e) {
    toolBroken(`基线读不出 / 不是合法 JSON（${e.message}）`, "合并冲突残留？重跑 --update 或从 canonical 取回。");
  }
}

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);

  // 金丝雀先跑，任何模式都跑
  const cf = runCanaries();
  if (cf.length) {
    console.error("⛔ 门自己瞎了 —— 金丝雀不中，**不许**据此报「屏上没有开发话」：");
    cf.forEach((f) => console.error("   · " + f));
    process.exit(2);
  }

  const files = listFiles();
  if (files.length < MIN_FILES) {
    console.error(`⛔ 门自己瞎了：扫描面只枚举到 ${files.length} 个文件（下界 ${MIN_FILES}）——枚举器坏了，不是文件没了。`);
    process.exit(2);
  }

  if (has("--selftest")) {
    const bite = CANARIES.filter((c) => /必咬/.test(c.name)).length;
    console.log(`✅ 金丝雀 ${CANARIES.length}/${CANARIES.length} 全中（必咬 ${bite} + 必不咬 ${CANARIES.length - bite}）`);
    console.log(`✅ 扫描面 ${files.length} 个文件（下界 ${MIN_FILES}）`);
    console.log("   金丝雀命中证据（报否定结论时必须一同给出）：");
    analyze(CANARIES[0].src, "c.tsx").forEach((h) => console.log(`     · "${h.match}" ← ${h.why}`));
    process.exit(0);
  }

  const { rows, localeLiterals, envNames } = scanAll();
  const total = rows.reduce((a, r) => a + r.hits.length, 0);

  // ── 扫描面自证：独立口径的分母（金丝雀证明不了这一条，见文件头）──────────────
  // 这道检查专治「逻辑没瞎但射程错了」——2026-08-17 那次翻车正是 6/6 全中 + 100% 漏检同时成立。
  if (localeLiterals < MIN_LOCALE_LITERALS) {
    console.error(`⛔ 门自己瞎了：locale 面只抽到 ${localeLiterals} 条字面量（下界 ${MIN_LOCALE_LITERALS}）。`);
    console.error("   这是**扫描面**塌了（目录改名 / 扩展名漏收 / 抽取器坏），不是文案变干净了。");
    console.error("   **不许**把本次读作「屏上没有开发话」。");
    process.exit(2);
  }

  /** 逐形态计数（交单报告口径）。注意 `check()` 一条字面量只记第一个命中形态 ⇒ 这是**下界分布**。 */
  const byForm = () => {
    const m = new Map();
    for (const r of rows) for (const h of r.hits) m.set(h.form, (m.get(h.form) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  /** 按扫描面分列（locale 面 vs 页面文件面）—— 报告要两面各一列。 */
  const faceOf = (f) => (/[\\/]locales[\\/]/.test(f) ? "locales" : "pages");

  if (has("--forms")) {
    const per = new Map();
    for (const r of rows) {
      for (const h of r.hits) {
        const k = h.form;
        const cur = per.get(k) ?? { locales: 0, pages: 0 };
        cur[faceOf(r.file)] += 1;
        per.set(k, cur);
      }
    }
    console.log("形态\tlocales\tpages\t合计");
    let tl = 0;
    let tp = 0;
    for (const [k, v] of [...per.entries()].sort((a, b) => b[1].locales + b[1].pages - (a[1].locales + a[1].pages))) {
      tl += v.locales;
      tp += v.pages;
      console.log(`${k}\t${v.locales}\t${v.pages}\t${v.locales + v.pages}`);
    }
    console.log(`合计\t${tl}\t${tp}\t${tl + tp}`);
    console.log(`（locale 面字面量分母 ${localeLiterals} 条）`);
    process.exit(0);
  }

  if (has("--list")) {
    // `--form=<名>` 逐形态过滤：误伤排查靠它（WO 明令先逐条看再定正则）
    const want = (argv.find((a) => a.startsWith("--form=")) ?? "").slice(7);
    let shown = 0;
    for (const r of rows) {
      const hs = want ? r.hits.filter((h) => h.form === want) : r.hits;
      if (hs.length === 0) continue;
      console.log(`\n# ${r.file}（${hs.length}）`);
      hs.forEach((h) => {
        shown += 1;
        console.log(`  L${h.line}\t[${h.form}] ${h.match}\t← ${h.why}\n     "${h.text}"`);
      });
    }
    console.log(`\n合计 ${want ? `${shown} 条（形态过滤：${want}）` : `${total} 条`} / ${rows.length} 个文件`);
    if (!want) byForm().forEach(([f, n]) => console.log(`  · ${f}\t${n}`));
    process.exit(0);
  }

  if (has("--update")) {
    const out = {
      note: `${SPEC} §3.3「开发的话不许上屏」棘轮。只数**会渲染出去的字**（JSX 文本 + 文案型属性字面量 + locale 面的全部非键名字面量），注释/变量名/testid 不算。`,
      spec: SPEC,
      gate: "scripts/check-dev-jargon-onscreen.mjs",
      total,
      byForm: Object.fromEntries(byForm()),
      localeLiterals,
      files: Object.fromEntries(rows.map((r) => [r.file, r.hits.length])),
      // 逐文件逐形态：报红时用来算「哪个形态涨了」，把定位从「文件」收到「那几行」
      filesByForm: Object.fromEntries(
        rows.map((r) => {
          const m = {};
          for (const h of r.hits) m[h.form] = (m[h.form] ?? 0) + 1;
          return [r.file, m];
        })
      ),
    };
    writeFileSync(BASELINE, JSON.stringify(out, null, 1) + "\n");
    console.log(`✅ 基线已写：${rows.length} 个文件 / ${total} 条 → ${relative(ROOT, BASELINE)}`);
    byForm().forEach(([f, n]) => console.log(`   · ${f}\t${n}`));
    process.exit(0);
  }

  const base = loadBaseline();
  if (!base) {
    console.error(`⛔ 基线缺失 ${relative(ROOT, BASELINE)} —— 先跑 --update`);
    process.exit(2);
  }

  // ── 松弛检测：基线**高于**实测 = 一个免检名额（2026-08-14 变异反证当场抓出）──────────
  // 实测经过：往 DataBuilderPage.tsx 的真 JSX 里塞 **1** 条开发话 ⇒ 门 **RC=0 放行**；
  // 塞 2 条才红。原因：基线记 `DataBuilderPage.tsx: 1`，而该文件早被修干净、实测 0 ——
  // 差出来的那 1 格谁都能用，且**门本来还会打印「屏上开发话未新增」**，读起来像干净。
  // 形态（铁律 0.6 句式）：**「我用『没有超过基线』当作『没有新增』的证据，而前者并不度量后者。」**
  // ⇒ 棘轮只降不升还不够，**降了就必须当场收紧**，否则余量会一格一格攒成免检额度。
  // 注意 `rows` 只含**有命中**的文件，零命中的文件根本不出现在里面 —— 所以必须反向遍历基线。
  const actual = new Map(rows.map((r) => [r.file, r.hits.length]));
  const slack = [];
  for (const [f, b] of Object.entries(base.files ?? {})) {
    const a = actual.get(f) ?? 0;
    if (a < b) slack.push(`${f}：基线 ${b} > 实测 ${a} ⇒ 余 ${b - a} 格免检名额`);
  }
  if (slack.length) {
    console.error(`❌ dev-jargon:check 棘轮松弛（${slack.length} 个文件）——**这不是通过**\n`);
    slack.forEach((s) => console.error("  · " + s));
    console.error("\n  为什么这算不通过：余量 = 免检名额。新塞进这些文件的开发话不会被抓，");
    console.error("  而门还会照常打印「屏上开发话未新增」——**这正是本仓最贵的那种假绿**。");
    console.error("  修法：`node scripts/check-dev-jargon-onscreen.mjs --update` 把基线收到实测值。");
    process.exit(1);
  }

  /**
   * ── 报红要**点到那一条**，不是点到那个文件 ────────────────────────────────────
   * 第一版报红时打的是 `hits.slice(0, 3)` = 该文件**最靠前**的三条命中。
   * 2026-08-17 变异反证当场看出这没用：往 `zh.ts`（1800 行）第 2634 行塞一条 curl，
   * 门确实 RC=1，但打印出来的是 L325/L417/L598 三条**存量**（基线里本来就记着的），
   * 读的人会跑去看 L325，那里什么问题都没有。
   * 形态（铁律 0.6 句式）：**「我用『这个文件里最靠前的三条』当作『新增的那三条』的证据，
   * 而前者并不度量后者。」**
   * ⇒ 基线改为**逐文件逐形态**记账，报红时先算出「哪个形态涨了」，只打印那个形态的命中。
   *   形态粒度是免费的（`byForm` 本来就在算），而它把定位范围从「一个 1800 行的文件」
   *   收到「这一类里的这几行」。
   */
  const formsOf = (hits) => {
    const m = {};
    for (const h of hits) m[h.form] = (m[h.form] ?? 0) + 1;
    return m;
  };
  const fails = [];
  for (const r of rows) {
    const b = base.files[r.file] ?? 0;
    if (r.hits.length > b) {
      const now = formsOf(r.hits);
      const was = base.filesByForm?.[r.file] ?? {};
      const grew = Object.keys(now).filter((f) => now[f] > (was[f] ?? 0));
      // 认得出哪个形态涨了 ⇒ 只打那个形态的命中；认不出（旧基线没有 filesByForm）⇒ 明说认不出
      const pick = grew.length ? r.hits.filter((h) => grew.includes(h.form)) : r.hits;
      const head = grew.length
        ? grew.map((f) => `${f} ${was[f] ?? 0}→${now[f]}`).join(" · ")
        : "（基线缺 filesByForm，认不出是哪个形态涨的 —— 跑 --list 看全量）";
      fails.push(
        `${r.file} 屏上开发话 ${b} → ${r.hits.length}［${head}］：\n      ` +
          pick.slice(0, 5).map((h) => `L${h.line} "${h.match}"（${h.why}）`).join("\n      ")
      );
    }
  }

  if (fails.length) {
    console.error(`❌ dev-jargon:check 未通过（${fails.length} 条）\n`);
    fails.forEach((f) => console.error("  · " + f));
    console.error(`\n判据（${SPEC} §3.3）：**这句话用户读了能做什么决定？** 答不出 ⇒ 它不该在屏上（移进代码注释）。`);
    process.exit(1);
  }

  console.log(`✅ dev-jargon:check 通过 —— ${files.length} 个文件（含 locale 面），屏上开发话未新增`);
  console.log(`   存量 ${total} 条 / ${rows.length} 个文件（棘轮基线 ${base.total}）`);
  byForm().forEach(([f, n]) => console.log(`     · ${f}\t${n}`));
  console.log(`   ✅ 扫描面自证：locale 面抽到 ${localeLiterals} 条字面量（下界 ${MIN_LOCALE_LITERALS}）⇒ 射程没塌`);
  console.log(`   ✅ 金丝雀 ${CANARIES.length}/${CANARIES.length} 全中 ⇒ 检测逻辑活着`);
  console.log("   ⚠ 诚实边界（不许读成「屏上已干净」）：");
  console.log("     ① **仍看不见**非 `locales/` 模块里写死的屏上串（实例 views/sim/sandboxConsoleModel.ts:809 IMPEDIMENT_JOIN_REASON）；");
  console.log("     ② **仍看不见**跨文件的变量拼接（不跟函数调用、不做常量折叠）；");
  console.log("     ③ 一条字面量只记第一个命中形态 ⇒ 上面的形态分布是**下界**，不是精确分布；");
  console.log("     ④ 词表有限，只咬已列举的几类形态，新黑话不会自己冒出来。");
  process.exit(0);
}

try {
  main();
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 3).join("\n   "));
}
