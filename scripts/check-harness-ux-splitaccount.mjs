#!/usr/bin/env node
/**
 * 门 `harness-ux-splitaccount:check` · **拆账明账门（门 B）**（WO-GATE-B-SPLITACCOUNT 建）
 *
 * ══ 它治什么 ═══════════════════════════════════════════════════════════════════
 * `docs/PRD-harness-ux-adoption.md` §2.1 把六条判据各自**拆成两半**：可判的那半留在 §4 表里
 * 逐页判，**不可判的那半**挪进 §4.2 登记为 4 条 `B-x` 明账。于是那张表的读数从
 * 「符合 17 · 判不了 57」变成「符合 60 · **判不了 0**」。
 *
 * **「判不了 0」不度量「这条要求验完了」** —— 两者之间隔着的正是那 4 条明账。
 * 而在本门建成之前，那 4 条**只是写在文档里的四行字**：没有任何东西保证它们
 * ① 还在 ② 有人认领 ③ 指向一个真实存在的受理方 ④ 有一张能派出去的单。
 * 删掉那张表、或把某条的「要判它得有什么」挖空，仓库**照样全绿**。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『判据表里判不了 0』当作『这条要求验完了』的证据，而前者并不度量后者。」**
 *
 * 兄弟门 `sim-ux-criteria:check` 判据⑦ 已守住「§4.2 里**至少有一条** `B-x`」——
 * 那只挡住了「整张表被删」这一种死法。本门守的是剩下的那些：
 * **账的形态 / 认领关系 / 受理方是否存在 / 有没有单 / 不许静默销账 / 自陈不许超发。**
 *
 * ══ 九条判据（同时成立才算过 · 每条对应一种真实的死法）═══════════════════════════
 *  ① **账形态完整**   §4.2 每条 `B-x` 三栏（拆出去的那半 / 为什么够不着 / 要判它得有什么）
 *                     全部非空，且**点名**至少一个判据编号 `U#`。
 *                     栏里写 `—` / `-` / `TBD` / `待定` / `见上` 一律判空 —— 把明账写成填空题。
 *  ② **双向绑定**     正向：§2.1「挪出去的那半去哪」凡写了 `§4.2` 的那一行，其 `U#`
 *                     必须被某条 `B-x` 认领（否则**账凭空消失**：改写记录说挪走了，而那边没有）。
 *                     反向：每条 `B-x` 认领的 `U#` 必须在 §2 判据表里真实存在（否则是**僵尸账**：
 *                     判据都删了，账还挂着一个不存在的对象）。
 *                     ⚠ 只查一个方向必然漏一半：正向漏「僵尸账」，反向漏「账消失」。
 *  ③ **出口不指向空气** 每条 `B-x` 的「要判它得有什么」必须点名一个**受理方登记表里的**受理方，
 *                     且那个受理方**真实存在**：`R13` ⇒ 本体里必须真有 R13 这条不变量；
 *                     `门 B`/`真浏览器` ⇒ **本门必须真的接进 `pnpm gates`**（自指接线证明）；
 *                     `编排侧评测` ⇒ §5 必须有对应可派单。
 *                     本仓真发生过「把账转给一个不存在的接收方」= 销账（悬空引用那次）。
 *  ④ **每条账有单**   §5 优先级表里必须有一行**点名该 `B-x`** 且归属栏非空。
 *                     拦的是「诚实挂账」退化成「诚实地永远不做」—— 那只解决准确性，不解决可交付。
 *  ⑤ **B-2 内容面现算** 四条里**只有 B-2 的内容面今天真能静态机检**（判定见下「逐条可机检判定」）。
 *                     现算：从 §4.1 的 U3「符合」段抽出**面板文件**（不手抄），剥注释后看
 *                     `本体链`/`ontologyChain` 有无**对位实现**，并断言 B-2 账面那句
 *                     「本仓多数页无对位实现」**仍然属实**（`withChain × 2 ≤ 面板文件数`）。
 *                     ⚠ **只机检必要条件**：连这个词都不在面板代码里，就谈不上「逐字齐全」；
 *                     反之词在了也不等于齐全（那要渲染后看）。**不许把本条读成 B-2 已验完。**
 *  ⑥ **不许静默销账** 基线记住每条 `B-x` 的「认领的 U# + 受理方」。少一条 / 改绑 / 多一条
 *                     都要 `--tighten` 显式重记 —— 多一条也要，否则新账可以随时再消失而门不吭声。
 *  ⑦ **自陈不许超发** §4.2 必须写明「内容面机检 N/M」，且 N 必须等于**本门现算**的内容面机检条数。
 *                     拦的是本门建成之后最可能发生的那件事：**「门 B 建好了 ⇒ 4 条都验了」**。
 *                     本门今天只机检 1 条的内容面，文档就不许写 4。
 *  ⑧ **受理方单号真实存在**（WO-SPLITACCOUNT-B-CLOSE 2026-08-20 补）
 *                     §5 里点名 B-x 的行所点名的每个 `WO-…` 单号，必须能在**仓里或远端**查到：
 *                     ① 有一个 git ref 名字含它的 kebab 小写形（`refs/heads/*` / `refs/remotes/*`），或
 *                     ② 本 PRD **之外**的某个已跟踪文件提过它。两者皆无 ⇒ 这个受理方是**编出来的名字**。
 *                     ⚠ **为什么判据③ 不够**：③ 只问「点没点名一个**已登记的抽象受理方**」，
 *                     其中「编排侧评测」那条的存在性判据是 `§5 里有任意一张点名任意 B-x 的单`——
 *                     那是**代理指标**：把 §5 的 `WO-QOS-PAGECTX-EVAL` 改成 `WO-随便编一个`，
 *                     ③ 照样绿（其它三行还在，`dispatchAll.length > 0` 恒真）。
 *                     形态（铁律 0.6 句式）：**「我用『这张表里还有单』当作『这一条的受理方存在』的证据。」**
 *  ⑨ **结案状态不许说谎**（WO-SPLITACCOUNT-B-CLOSE 2026-08-20 补）
 *                     §4.2.1 判定表里被标结案（`核销`/`已交付`/`已闭`/`已完成`/`已结案`）的 B-x：
 *                     ⑨a 不许**同时**还挂在 §4.2 在册表里（「做完了」与「还欠着」不能同时为真）；
 *                     ⑨b 必须在那一行点名交付它的 `WO-…` 单号（说不出出处的结案 = 无从核对）；
 *                     ⑨c 该单号必须能在 §2.1 判据改写记录里找到**同样标了结案**的那条 `U#`
 *                         （拆出去的那半销了账，拆的源头也必须销 —— 只销一头 = 两处账对不上）；
 *                     ⑨d **该 `U#` 在 §4 主表里不许还有「判不了」格** ←── 这一条就是本判据的本体：
 *                         拆出去的那半自称交付，而留在表内的那半还判不了 ⇒ 「判不了 0」是假的。
 *                     ⑨e 结案记录本身上棘轮（只许增不许减）—— 否则把结案行删掉，⑨ 整条自动空转变绿。
 *
 * ══ 逐条可机检判定（本门的诚实位 · 不许读成「四条都验了」）═════════════════════════
 *  · **B-1（U1 时延面）**：**内容面不能机检**。「改完输入到结果更新要多久」是运行期量，
 *    源码里不存在这个数。**差什么**：一个能渲染真页面的 harness（Playwright/happy-dom）
 *    + 一条「改一个输入、不点任何按钮、断言结果 DOM 变了」的用例。已派单见 §5。
 *  · **B-2（U3 本体链面）**：**必要条件能机检（本门判据⑤ 已机检）· 充分条件不能**。
 *    账面理由原写「本仓多数页无对位实现」—— 那**不是**「判不了」，那是**可判且判出来是不符合**。
 *    这一条今天从「写在文档里的承诺」变成了机器判据。逐字齐全仍需渲染，归 R13。
 *  · **B-3（U5 跨屏面）**：**不能机检**。要比对「同一事实在两屏上的值」，先得有一份
 *    「事实 → 读取它的页面集合」的可枚举注册表，**本仓今天不存在**。
 *    **差什么**：先有那份注册表（或从 useQuery key 静态抽取一份），才谈得上比对。已派单见 §5。
 *  · **B-4（U7 内容面 + U8 几何面）**：**不能机检**。U7 要真跑一次编排 + 真模型；
 *    U8 要渲染后量浮层几何。**差什么**：编排侧评测集（含期望答案）+ 渲染后几何量测。已派单见 §5。
 *
 * ══ 金丝雀（铁律 0.6：报否定结论前先自证工具）═══════════════════════════════════
 * 必中 / 必不中样例全部喂给**同一个** `parseSplitAccounts()` + `judge()`，**不另抄一份正则**
 * （抄了就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿）。
 * 任一不符预期 ⇒ 打印「⛔ 工具坏了」并 **RC=2**，**不许**打印「明账都在册」。
 *
 * ══ 退出码三分（不许合并）══════════════════════════════════════════════════════
 *   0 = 干净 · 1 = 明账**真有问题** · 2 = **门自己坏了**（金丝雀不中 / 扫描面缺失 /
 *   §4.2 解析出 0 行 / 面板文件抽不出 / §4 主表解析不出 U 列 / §5 抽不出任何 `WO-…` 单号 /
 *   判据⑧ 的两条证据源（git ref、仓内 grep）任一取不到）。
 *   2 与 1 处置完全相反：前者只许说「我没查出来」。
 *   ⚠ **判据⑧ 刻意要求两条证据源都可用才判**：只剩一条时，「另一条本可查到」的单号会被
 *   错报成 RC=1（编出来的名字）—— 那是**失败方向反了**（把「我没查全」说成「你违规」）。
 *
 * ══ 诚实边界 ═════════════════════════════════════════════════════════════════
 *  · 本门**不验四条明账的内容对不对**，只有 B-2 是例外且只到必要条件（判据⑤）。
 *    其余三条本门守的是**账本身**：在不在、有没有主、指不指向空气、有没有单。
 *  · 判据③ 的受理方登记表是**写死的**（`RECEIVERS`）—— 新受理方必须同批登记，
 *    否则「出口栏没点名任何已登记的受理方」会红。**这是刻意的**：让「随手写一个新去处」
 *    这件事必须过一次人眼，而不是静悄悄多出一个没人核过的接收方。
 *  · 判据⑤ 的面板文件来自 §4.1 的 U3「**符合**」段（不含「不符合」段，那里提到的
 *    `LayeredDag.tsx` 是共享组件不是面板）。抽不出 ⇒ **RC=2**，不是「没有面板」。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 G-SPLITACCOUNT-PROMISE-ONLY。
 * 门账：scripts/gate-ledger.json。
 *
 * 用法：
 *   node scripts/check-harness-ux-splitaccount.mjs                  # 门（0/1/2）
 *   node scripts/check-harness-ux-splitaccount.mjs --selftest        # 只跑金丝雀
 *   node scripts/check-harness-ux-splitaccount.mjs --census          # 打印现算明账全貌
 *   node scripts/check-harness-ux-splitaccount.mjs --mutation-proof  # 逐条 B-x 变异反证
 *   node scripts/check-harness-ux-splitaccount.mjs --seed            # 首次建账
 *   node scripts/check-harness-ux-splitaccount.mjs --tighten         # 重记基线（销账/改绑必须显式）
 */
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";

const PRD = "docs/PRD-harness-ux-adoption.md";
const ONTOLOGY = "docs/SYSTEM-ONTOLOGY.md";
const PKG = "package.json";
const FE_ROOT = "apps/frontend-shell/src";
const BASELINE = "scripts/harness-ux-splitaccount-baseline.json";
const SELF = "check-harness-ux-splitaccount.mjs";

/**
 * **本门今天真的机检了内容面的那几条**（判据⑦ 拿它跟文档自陈比）。
 * 加一条进来 = 承诺本门真的有一条判据在验它的内容，不许只改这里不加判据。
 */
export const CONTENT_CHECKED = new Set(["B-2"]);

/** 「本体链」的对位实现标识 —— 面板代码里出现它，是「逐字齐全」的**必要条件**。 */
const CHAIN_MARK = /本体链|ontologyChain/;

/** 空栏的各种写法：明账写成填空题就等于没写。 */
const BLANK = /^(—|-|--|~|TBD|待定|待补|见上|同上|略|\/)?$/i;

/**
 * §4 主表里「静态源码判不了」那一态的**逐字写法**（判据⑨d 数的就是它）。
 * ⚠ 写成常量而不是字面量散在各处：改坏它 ⇒ 金丝雀 ⑩ 当场不中 ⇒ RC=2，不会静悄悄变绿。
 */
const UNDECIDABLE = "判不了";

/**
 * 结案标记（判据⑨）。⚠ `核销` 不加 `已` 前缀：§2.1 的原文写的是「2026-08-18 核销：…」。
 * 刻意**不**收「已建」「已接」「已部分能」—— 那些说的是**受理方**的进度，不是**这条账**结了。
 */
const CLOSED_MARK = /核销|已交付|已闭|已完成|已结案/;

/** 工单号（判据⑧⑨ 的连接键）。全大写 + 数字 + 连字符，`WO-` 起头。 */
const WO_ID = /\bWO-[A-Z0-9][A-Z0-9-]*\b/g;

/** 从一段文本里取出全部工单号（去重保序）。**唯一实现** —— 判据⑧⑨ 与金丝雀共用。 */
export function woIdsIn(text) {
  return [...new Set((String(text ?? "").match(WO_ID) ?? []))];
}

/** 工单号 → git ref 名里的形态（`WO-FACT-USAGE-REGISTRY` → `wo-fact-usage-registry`）。 */
export function woRefSlug(wo) {
  return String(wo).toLowerCase();
}

/**
 * **受理方登记表**：`B-x` 的「要判它得有什么」栏必须点名其中之一，且那个受理方必须真实存在。
 * 写死是刻意的（见诚实边界）：新增受理方必须同批登记，不许静悄悄多出一个没人核过的接收方。
 */
const RECEIVERS = [
  {
    name: "R13 溯源链（本体不变量）",
    re: /R13/,
    check: (ctx) => /\bR13\b/.test(ctx.ontology),
    miss: "本体 docs/SYSTEM-ONTOLOGY.md 里找不到 R13 —— 账转给了一个不存在的受理方 = 销账",
  },
  {
    name: "门 B（本门 · 真浏览器那一面尚未具备）",
    re: /门\s*B|真浏览器|Playwright/i,
    check: (ctx) => ctx.wired,
    miss: `账写着「归门 B」，而门 B（scripts/${SELF}）**没有接进 pnpm gates** —— 受理方存在但从不运行，等于不存在`,
  },
  {
    name: "编排侧评测",
    re: /编排侧评测/,
    check: (ctx) => ctx.dispatchAll.length > 0,
    miss: "账写着「归编排侧评测」，而 §5 里一张点名 B-x 的单都没有 —— 转出去了却没人接",
  },
];

/* ═══════════════════ 唯一实现 · Markdown 解析 ═══════════════════════════════════ */

/** 取某个标题下的正文（到下一个同级或更高级标题为止）。 */
function section(md, heading) {
  const lines = md.split("\n");
  const i = lines.findIndex((l) => l.trim().startsWith(heading));
  if (i < 0) return null;
  const level = (heading.match(/^#+/) ?? ["#"])[0].length;
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const m = lines[j].match(/^(#+)\s/);
    if (m && m[1].length <= level) break;
    out.push(lines[j]);
  }
  return out.join("\n");
}

/** 表格行 → 单元格（去掉粗体星号与首尾空白）。 */
function cells(row) {
  return row.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.replace(/\*/g, "").trim());
}

/** 分隔行（`|---|---|`）不是数据行。 */
function isSep(cs) {
  return cs.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, "")));
}

/** 剥注释：`//` 行、块注释续行 `*`、`/*` 开头 —— 注释里提一嘴 ≠ 真渲染了这个字段。 */
export function stripComments(src) {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
}

/**
 * 解析 PRD 的拆账面。**唯一实现** —— 金丝雀跑的就是它。
 * @returns {{criteria:Set<string>, carveOuts:Array<{u:string,dest:string}>,
 *            accounts:Array<{id:string,half:string,why:string,need:string,us:string[]}>,
 *            dispatch:Map<string,string>, dispatchAll:string[],
 *            selfClaim:{n:number,m:number}|null, panelFiles:string[],
 *            closures:Array<{id:string,verdict:string,wos:string[]}>,
 *            carveClosures:Array<{u:string,wos:string[],dest:string}>,
 *            woIds:Array<{wo:string,ids:string[]}>,
 *            grid:Map<string,{total:number,undecidable:string[]}>}}
 */
export function parseSplitAccounts(md) {
  /* §2 判据表：`| **U1** | …` —— 只取 §2 正文（§2.1 之前那段） */
  const sec2 = (section(md, "## 2 ·") ?? "").split("### 2.1")[0];
  const criteria = new Set();
  for (const line of sec2.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cs = cells(line);
    if (isSep(cs)) continue;
    const m = cs[0].match(/^(U\d+b?)$/);
    if (m) criteria.add(m[1]);
  }

  /* §2.1 改写记录：5 列，末列写了 `§4.2` 的即「外移」 */
  const carveOuts = [];
  for (const line of (section(md, "### 2.1") ?? "").split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cs = cells(line);
    if (isSep(cs) || cs.length < 5) continue;
    const m = cs[0].match(/^(U\d+b?)$/);
    if (!m) continue;
    const dest = cs[cs.length - 1];
    if (/§\s*4\.2/.test(dest)) carveOuts.push({ u: m[1], dest });
  }

  /*
   * §4.2 明账：4 列 `| **B-1** | 拆出去的那半 | 为什么够不着 | 要判它得有什么 |`
   *
   * ⚠ **只取 §4.2 正文（第一个 `####` 子标题之前）**。§4.2.1 是门 B 的逐条可机检判定，
   * 那张表第一列同样写着 `**B-1**`…`**B-4**` —— 连它一起收会把 4 条账读成 8 条，
   * 然后「重复的 B-1」在判据⑥ 里表现为「基线里没有」这种莫名其妙的红。
   * 形态照铁律 0.6：**「我用『§4.2 里所有 B-x 开头的行』当作『明账集合』的证据，
   * 而前者并不度量后者」** —— 同一节里可以有别的表在谈同一批账。
   */
  const sec42 = section(md, "### 4.2") ?? "";
  const sec42Body = sec42.split(/\n#{4,}\s/)[0];
  const accounts = [];
  for (const line of sec42Body.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cs = cells(line);
    if (isSep(cs)) continue;
    const m = cs[0].match(/^(B-\d+)$/);
    if (!m) continue;
    const half = cs[1] ?? "";
    accounts.push({
      id: m[1],
      half,
      why: cs[2] ?? "",
      need: cs[3] ?? "",
      us: [...new Set([...half.matchAll(/U\d+b?/g)].map((x) => x[0]))].sort(),
    });
  }

  /* §4.2 自陈：「内容面机检 N/M」 */
  const sc = sec42.match(/内容面机检\s*(\d+)\s*\/\s*(\d+)/);
  const selfClaim = sc ? { n: Number(sc[1]), m: Number(sc[2]) } : null;

  /*
   * §4.2.1 判定表里**被标结案**的 B-x（判据⑨ 的 B 侧真值源）。
   * 只看第 2 列「内容面今天能不能机检」这一栏的判词 —— 第 4 列「差什么」里满是
   * 「harness 已建」「已接 pnpm gates」，那说的是**受理方**的进度不是**这条账**结了，
   * 收进来就会把「工具做好了」读成「这条账验完了」（本门存在的全部理由就是拦这个）。
   */
  const sec42Sub = sec42.split(/\n#{4,}\s/).slice(1).join("\n");
  const closures = [];
  for (const line of sec42Sub.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cs = cells(line);
    if (isSep(cs) || cs.length < 2) continue;
    const m = cs[0].match(/^(B-\d+)$/);
    if (!m) continue;
    if (!CLOSED_MARK.test(cs[1] ?? "")) continue;
    closures.push({ id: m[1], verdict: cs[1] ?? "", wos: woIdsIn(line) });
  }

  /* §2.1 里**被标结案**的 U#（判据⑨ 的 U 侧真值源）：末列「挪出去的那半去哪」含结案标记 */
  const carveClosures = [];
  for (const line of (section(md, "### 2.1") ?? "").split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cs = cells(line);
    if (isSep(cs) || cs.length < 5) continue;
    const m = cs[0].match(/^(U\d+b?)$/);
    if (!m) continue;
    const dest = cs[cs.length - 1];
    if (!CLOSED_MARK.test(dest)) continue;
    carveClosures.push({ u: m[1], wos: woIdsIn(dest), dest });
  }

  /* §5 优先级表：点名了某条 B-x 且归属栏（末列）非空的行 = 一张可派的单 */
  const dispatch = new Map();
  const dispatchAll = [];
  const woIds = []; // {wo, ids[]} —— 判据⑧ 的扫描面
  const woSeen = new Map();
  for (const line of (section(md, "## 5 ·") ?? "").split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cs = cells(line);
    if (isSep(cs) || cs.length < 2) continue;
    const ids = [...new Set([...line.matchAll(/\bB-\d+\b/g)].map((x) => x[0]))];
    if (!ids.length) continue;
    const owner = cs[cs.length - 1];
    if (BLANK.test(owner)) continue; // 归属栏空 = 没人接 = 不算一张单
    dispatchAll.push(line);
    for (const id of ids) dispatch.set(id, line);
    for (const wo of woIdsIn(line)) {
      if (!woSeen.has(wo)) { const e = { wo, ids: [] }; woSeen.set(wo, e); woIds.push(e); }
      for (const id of ids) if (!woSeen.get(wo).ids.includes(id)) woSeen.get(wo).ids.push(id);
    }
  }

  /*
   * §4 主表（**只取 §4.1 之前那段**）逐 `U#` 列读数 —— 判据⑨d 的真值源。
   * ⚠ §4 这一节下面还有 §4.1/§4.5/§4.7…十几张**别的**表（逐格取证 / 逐单增补），
   * 它们的正文里「判不了」三个字满地都是。连它们一起收 ⇒ 主表明明 0 格判不了，
   * 门却报「还有判不了」。形态照铁律 0.6：**「我用『§4 这一节里出现的判不了』
   * 当作『主表里的判不了格』的证据，而前者并不度量后者。」**
   * 表头判据是**形状**不是列数：一行里 ≥3 个单元格形如 `U3 DAG点节点` ⇒ 那是表头。
   * 这样将来加一列判据不会让本门失灵（写死列数才会）。
   */
  const sec4 = (section(md, "## 4 ·") ?? "").split("### 4.1")[0];
  let gridHead = null;
  const gridRows = [];
  for (const line of sec4.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cs = cells(line);
    if (isSep(cs)) continue;
    const us = cs.map((c) => (c.match(/^(U\d+b?)(\s|$)/) ?? [])[1] ?? null);
    if (!gridHead && us.filter(Boolean).length >= 3) { gridHead = us; continue; }
    if (gridHead) gridRows.push(cs);
  }
  const grid = new Map();
  if (gridHead) {
    for (let c = 0; c < gridHead.length; c++) {
      const u = gridHead[c];
      if (!u) continue;
      const undecidable = gridRows.filter((r) => (r[c] ?? "") === UNDECIDABLE).map((r) => r[0]);
      grid.set(u, { total: gridRows.length, undecidable });
    }
  }

  /*
   * §4.1 的 U3「**符合**」段里点名的**面板文件**（判据⑤ 的扫描面，**现算不手抄**）。
   * 刻意只取「符合」那一段：「不符合」段提到的 `LayeredDag.tsx` 是共享组件不是面板，
   * 收进来会把「共享组件里没有本体链」误当成「某个面板里没有」。
   */
  const sec41 = section(md, "### 4.1") ?? "";
  const u3 = sec41.split(/\*\*U3\s/)[1] ?? "";
  const u3Block = u3.split(/\n\*\*U\d/)[0] ?? "";
  const conform = (u3Block.split(/-\s*\*\*不符合/)[0] ?? "");
  const panelFiles = [...new Set([...conform.matchAll(/([A-Z][A-Za-z0-9]*\.tsx)/g)].map((x) => x[1]))].sort();

  return { criteria, carveOuts, accounts, dispatch, dispatchAll, selfClaim, panelFiles, closures, carveClosures, woIds, grid };
}

/* ═══════════════════ 唯一实现 · 判据本体 ═══════════════════════════════════════ */

/**
 * **判据本体**。主流程、金丝雀、变异反证调的都是它 —— 不许各抄一份。
 *
 * @param {object} p
 * @param {ReturnType<parseSplitAccounts>} p.prd
 * @param {string} p.ontology   本体正文（判据③ 查 R13）
 * @param {boolean} p.wired     本门是否真在 `pnpm gates` 串里（判据③ 自指接线证明）
 * @param {{panels:number,withChain:number}} p.chain 判据⑤ 的现算读数
 * @param {object|null} p.baseline
 * @param {((wo:string)=>{found:boolean,via:string})|null} [p.woEvidence]
 *        判据⑧ 的证据源（注入，便于金丝雀喂假证据而仍走同一个 judge）。
 *        **传 null = 本次没有证据源**，判据⑧ 整条跳过 —— 主流程绝不许这样调：
 *        取不到证据源时 main() 直接 RC=2（「我没查出来」），不是静悄悄跳过。
 * @returns {{fail:Array<{code:string,account:string|null,msg:string}>}}
 */
export function judge({ prd, ontology, wired, chain, baseline, woEvidence = null }) {
  const fail = [];
  const push = (code, account, msg) => fail.push({ code, account, msg });
  const ctx = { ontology, wired, dispatchAll: prd.dispatchAll };

  /* ── ① 账形态完整 ───────────────────────────────────────────────────────── */
  if (prd.accounts.length === 0) {
    push("①", null, "§4.2 里一条 `B-x` 明账都解析不出 —— 拆出去的那一半没有留名，「判不了 0」会被下一个人读成「都验过了」");
  }
  for (const a of prd.accounts) {
    for (const [col, label] of [["half", "拆出去的那半"], ["why", "为什么够不着"], ["need", "要判它得有什么"]]) {
      if (BLANK.test(a[col])) push("①", a.id, `${a.id} 的「${label}」栏是空的（「${a[col]}」）—— 明账写成填空题，等于没写`);
    }
    if (a.us.length === 0) {
      push("①", a.id, `${a.id} 没有点名任何判据编号 U# —— 一条不知道自己是从哪条判据拆出来的账，没法被认领也没法被核销`);
    }
  }

  /* ── ② 双向绑定（只查一个方向必然漏一半）──────────────────────────────── */
  const claimed = new Set(prd.accounts.flatMap((a) => a.us));
  for (const c of prd.carveOuts) {
    if (!claimed.has(c.u)) {
      push("②", null, `②正向·账凭空消失：§2.1 的 ${c.u} 行写着挪进 §4.2（「${c.dest.slice(0, 40)}…」），而 §4.2 没有任何一条 B-x 认领 ${c.u}`);
    }
  }
  for (const a of prd.accounts) {
    for (const u of a.us) {
      if (!prd.criteria.has(u)) {
        push("②", a.id, `②反向·僵尸账：${a.id} 认领 ${u}，而 §2 判据表里没有 ${u} 这条判据（判据都删了，账还挂着一个不存在的对象）`);
      }
    }
  }

  /* ── ③ 出口不指向空气 ───────────────────────────────────────────────────── */
  for (const a of prd.accounts) {
    if (BLANK.test(a.need)) continue; // ① 已报，不重复误伤
    const hit = RECEIVERS.filter((r) => r.re.test(a.need));
    if (hit.length === 0) {
      push("③", a.id, `${a.id} 的「要判它得有什么」没点名任何**已登记的受理方**（登记表：${RECEIVERS.map((r) => r.name).join(" / ")}）—— 转出去而不说转给谁，账就是丢了`);
      continue;
    }
    for (const r of hit) if (!r.check(ctx)) push("③", a.id, `${a.id} 的受理方「${r.name}」指向空气 —— ${r.miss}`);
  }

  /* ── ④ 每条账有单 ───────────────────────────────────────────────────────── */
  for (const a of prd.accounts) {
    if (!prd.dispatch.has(a.id)) {
      push("④", a.id, `${a.id} 在 §5 里没有一张点名它、且归属栏非空的单 —— 「诚实挂账」不许退化成「诚实地永远不做」`);
    }
  }

  /* ── ⑤ B-2 内容面现算（唯一一条内容真能静态机检的）───────────────────── */
  const b2 = prd.accounts.find((a) => a.id === "B-2");
  if (b2 && chain) {
    if (chain.withChain * 2 > chain.panels) {
      push("⑤", "B-2", `B-2 账面写「本仓多数页无「本体链」对位实现」，而现算 ${chain.panels} 个面板文件里有 ${chain.withChain} 个已有对位实现 —— 账面理由已经不成立了，该重判这条账（可判且判出来是不符合 ≠ 判不了）`);
    }
    const base = baseline?.chain;
    if (base && (base.panels !== chain.panels || base.withChain !== chain.withChain)) {
      push("⑤", "B-2", `B-2 现算读数变了：面板文件 ${base.panels}→${chain.panels} · 有对位实现 ${base.withChain}→${chain.withChain}。这不一定是缺陷，但**必须显式记账**：跑 \`--tighten\` 重记基线，并同批复核 B-2 的账面理由还成不成立`);
    }
  }

  /* ── ⑥ 不许静默销账 ─────────────────────────────────────────────────────── */
  const baseAcc = baseline?.accounts;
  if (baseAcc) {
    const now = new Map(prd.accounts.map((a) => [a.id, a]));
    for (const [id, was] of Object.entries(baseAcc)) {
      const is = now.get(id);
      if (!is) { push("⑥", id, `⑥销账：基线里有 ${id}，现在 §4.2 里没有了 —— 明账消失必须显式过一次人眼（真要核销就跑 \`--tighten\`，并在 §4.2 写明去向）`); continue; }
      const wasU = (was.us ?? []).join("/");
      const isU = is.us.join("/");
      if (wasU !== isU) push("⑥", id, `⑥改绑：${id} 认领的判据从「${wasU}」变成「${isU}」—— 换了对象的账不是同一笔账，跑 \`--tighten\` 显式重记`);
      const wasR = (was.receivers ?? []).join("/");
      const isR = RECEIVERS.filter((r) => r.re.test(is.need)).map((r) => r.name).join("/");
      if (wasR !== isR) push("⑥", id, `⑥改口：${id} 的受理方从「${wasR || "（无）"}」变成「${isR || "（无）"}」—— 跑 \`--tighten\` 显式重记`);
    }
    for (const a of prd.accounts) {
      if (!baseAcc[a.id]) push("⑥", a.id, `⑥新账未登记：${a.id} 不在基线里 —— 新账也要显式记一笔（跑 \`--tighten\`），否则它可以随时再消失而门不吭声`);
    }
  }

  /* ── ⑦ 自陈不许超发 ─────────────────────────────────────────────────────── */
  const realN = prd.accounts.filter((a) => CONTENT_CHECKED.has(a.id)).length;
  if (!prd.selfClaim) {
    push("⑦", null, "§4.2 里没有「内容面机检 N/M」这句自陈 —— 门建成之后最可能发生的事就是「门 B 建好了 ⇒ 4 条都验了」，所以覆盖率必须写下来并被机器核对");
  } else {
    if (prd.selfClaim.n !== realN) {
      push("⑦", null, `⑦自陈超发/欠报：§4.2 写「内容面机检 ${prd.selfClaim.n}/${prd.selfClaim.m}」，而本门现算真正机检了内容面的是 ${realN} 条（${[...CONTENT_CHECKED].join("、")}）`);
    }
    if (prd.accounts.length && prd.selfClaim.m !== prd.accounts.length) {
      push("⑦", null, `⑦自陈分母不对：§4.2 写分母 ${prd.selfClaim.m}，而 §4.2 现算 ${prd.accounts.length} 条明账`);
    }
  }

  /* ── ⑧ 受理方单号真实存在（判据③ 只问「点没点名」，这条问「那个名字是不是真的」）── */
  if (woEvidence) {
    for (const w of prd.woIds) {
      const ev = woEvidence(w.wo);
      if (ev.found) continue;
      for (const id of w.ids) {
        push("⑧", id, `⑧受理方是编出来的名字：§5 把 ${id} 派给 \`${w.wo}\`，而这个单号**仓里和远端都查不到** —— 既没有名字含 \`${woRefSlug(w.wo)}\` 的 git ref，也没有本 PRD 之外的已跟踪文件提过它。转给一个不存在的接收方 = 销账（判据③ 拦不住这一种：它只问「点没点名一个已登记的受理方」）`);
      }
    }
  }

  /* ── ⑨ 结案状态不许说谎 ─────────────────────────────────────────────────── */
  const inLedger = new Set(prd.accounts.map((a) => a.id));
  for (const c of prd.closures) {
    /* ⑨a：结了的账不许还挂着 */
    if (inLedger.has(c.id)) {
      push("⑨", c.id, `⑨a 账面自相矛盾：§4.2.1 把 ${c.id} 标成结案（「${c.verdict.slice(0, 26)}…」），而 §4.2 在册表里它**还挂着** —— 「做完了」与「还欠着」不能同时为真`);
    }
    /* ⑨b：结案必须说得出是哪张单交付的 */
    if (!c.wos.length) {
      push("⑨", c.id, `⑨b 结案说不出出处：§4.2.1 把 ${c.id} 标成结案，而那一行里没有点名任何 \`WO-…\` 单号 —— 一条说不出被谁交付的结案，无从核对，与「悄悄删掉」在证据上等价`);
      continue;
    }
    /* ⑨c：拆出去的那半销账了，拆的源头（§2.1）也必须销 —— 只销一头 = 两处账对不上 */
    const matched = prd.carveClosures.filter((cc) => cc.wos.some((w) => c.wos.includes(w)));
    if (!matched.length) {
      push("⑨", c.id, `⑨c 两处账对不上：§4.2.1 说 ${c.id} 由 ${c.wos.join("/")} 结案，而 §2.1 判据改写记录里**没有任何一条 U# 记着由这张单结案** —— 拆出去的那半销了账，拆的源头还写着「挪出去了」`);
      continue;
    }
    /* ⑨d：本判据的本体 —— 结了案的那条判据，表内那半不许还是「判不了」 */
    for (const cc of matched) {
      const col = prd.grid.get(cc.u);
      if (!col) {
        push("⑨", c.id, `⑨d 判据列查无此列：${c.id} 结案时对应的 ${cc.u} 在 §4 主表表头里找不到 —— 结案对不上任何一列，这条状态无从核对`);
        continue;
      }
      if (col.undecidable.length) {
        const who = col.undecidable.slice(0, 3).join(" / ");
        push("⑨", c.id, `⑨d 状态说谎：${c.id} 标着结案（${c.wos.join("/")}），而它对应的 ${cc.u} 在 §4 主表里**还有 ${col.undecidable.length}/${col.total} 格是「${UNDECIDABLE}」**（${who}${col.undecidable.length > 3 ? " …" : ""}）—— 拆出去的那半自称交付，留在表内的那半却还判不了，「判不了 0」这个读数就是假的`);
      }
    }
  }
  /* ⑨e：结案记录上棘轮 —— 少一条 ⇒ ⑨ 整条自动空转变绿，这是本门最廉价的死法 */
  const baseClosures = baseline?.closures;
  if (baseClosures) {
    const nowC = new Set(prd.closures.map((c) => c.id));
    for (const id of Object.keys(baseClosures)) {
      if (!nowC.has(id)) {
        push("⑨", id, `⑨e 结案记录消失：基线记着 ${id} 是一条结案记录，现在 §4.2.1 里读不到了 —— 删掉结案行，判据⑨ 就没有对象可判、整条自动变绿（真要删就跑 \`--tighten\` 显式记一笔）`);
      }
    }
  }

  return { fail };
}

/* ═══════════════════ 判据⑤ 的现算（面板文件 → 本体链对位实现）═══════════════════ */

/** 递归找 basename 对应的真实路径（面板文件在 §4.1 里只写了文件名，不写路径）。 */
function findFile(root, base) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === base) return p;
    }
  }
  return null;
}

/**
 * @returns {{panels:number, withChain:number, files:Array<{base:string,path:string|null,chain:boolean}>}}
 */
export function computeChain(panelFiles, root, readText) {
  const files = panelFiles.map((base) => {
    const path = findFile(root, base);
    const chain = path ? CHAIN_MARK.test(stripComments(readText(path))) : false;
    return { base, path, chain };
  });
  return { panels: files.length, withChain: files.filter((f) => f.chain).length, files };
}

/* ═══════════════════ 判据⑧ 的证据源（仓里 / 远端 两条，缺一条就 RC=2）════════════ */

/**
 * 已知**必不存在**的样例：grep 若连它都命中，说明 grep 在乱报，报的 0/非 0 都不可信。
 *
 * ⚠ **必须拼出来，不许写成一个字面量**（2026-08-20 实测栽过一次，当场 RC=2）：
 * 写成字面量的话，这个串就**存在于本文件里**，`git grep` 一扫就命中自己 ⇒
 * 反向金丝雀永远报「grep 在乱报」⇒ 门永远 RC=2。拼接后源码里只有碎片、没有整串。
 * 形态照铁律 0.6：**「我用『我造了一个不存在的串』当作『它真不存在于仓里』的证据」——
 * 而我写下它的那一刻，它就存在了。**
 */
const EVIDENCE_ABSENT_CANARY = ["WO", "SPLITACCOUNT", "CANARY", "MUSTNOT", "EXIST", "7F3A"].join("-");

/**
 * 两条证据源都现算，**都可用才返回查询函数**；任一不可用返回 `{ ok:false }` ⇒ 调用方 RC=2。
 *
 * ⚠ 为什么不允许「只用还活着的那一条」：一个单号可能只有 git ref 没有仓内文本（刚推的分支），
 * 也可能只有仓内文本没有 ref（分支已删、账留着）。**少一条源 ⇒ 把「我没查全」报成「你违规」**，
 * 失败方向正好反了。本仓吃过这个亏（否定结论必须先自证工具，铁律 0.6）。
 *
 * @param {(args:string[])=>{status:number|null,stdout:string}} run  注入 git 执行器（金丝雀可喂假的）
 * @returns {{ok:true, query:(wo:string)=>{found:boolean,via:string}, refCount:number, canary:string}
 *          |{ok:false, why:string}}
 */
export function buildWoEvidence(run, selfMark, prdPath) {
  const refsRes = run(["for-each-ref", "--format=%(refname)"]);
  if (refsRes.status !== 0) return { ok: false, why: `git for-each-ref 跑不了（status=${refsRes.status}）` };
  const refs = refsRes.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (refs.length === 0) return { ok: false, why: "git for-each-ref 一条 ref 都没返回（一个 git 仓不可能零 ref ⇒ 证据源坏了）" };

  /** git grep 一个字面串 → 命中的文件名（已剔除本 PRD 自身：自证不算佐证）。 */
  const grepFiles = (needle) => {
    const r = run(["grep", "-l", "-F", "--", needle]);
    if (r.status !== 0 && r.status !== 1) return null; // 0=有命中 1=无命中 其余=git 出错
    return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean).filter((f) => f !== prdPath);
  };

  /* 金丝雀（**用的就是上面这个 grepFiles**，不另抄一份）：必中取自生产实物，必不中是刻意造的。 */
  const hit = grepFiles(selfMark);
  if (hit === null) return { ok: false, why: "git grep 跑不了（非 0/1 退出码）" };
  if (hit.length === 0) return { ok: false, why: `grep 金丝雀不中：连「${selfMark}」都报 0 命中（它至少写在 package.json 的 gates 串里）⇒ 是 grep 坏了，不是单号不存在` };
  const anti = grepFiles(EVIDENCE_ABSENT_CANARY);
  if (anti === null) return { ok: false, why: "git grep 跑不了（反向金丝雀）" };
  if (anti.length > 0) return { ok: false, why: `grep 反向金丝雀命中：「${EVIDENCE_ABSENT_CANARY}」本不该存在却报 ${anti.length} 个文件 ⇒ grep 在乱报` };

  const query = (wo) => {
    const slug = woRefSlug(wo);
    const ref = refs.find((r) => r.toLowerCase().includes(slug));
    if (ref) return { found: true, via: `git ref ${ref}` };
    const files = grepFiles(wo) ?? [];
    if (files.length) return { found: true, via: `仓内 ${files.length} 个文件（如 ${files[0]}）` };
    return { found: false, via: "" };
  };
  return { ok: true, query, refCount: refs.length, canary: `必中「${selfMark}」${hit.length} 文件 · 必不中「${EVIDENCE_ABSENT_CANARY}」0 文件 · git ref ${refs.length} 条` };
}

/* ═══════════════════ 金丝雀（与主判据共用上面那两个函数）══════════════════════ */

/** 判据⑨d 的钉子：U5 已结案的那一格，翻成「判不了」就必须被咬到（见 CANARY_MD_LIE）。 */
const CANARY_ROW_CLEAN = "| 甲页 `a` | **符合** | **符合** | **符合** | **判不了** |";
const CANARY_ROW_LIE = "| 甲页 `a` | **符合** | **符合** | **判不了** | **判不了** |";
/** 判据⑨a 的钉子：把已结案的 B-5 塞回 §4.2 在册表。 */
const CANARY_LEDGER_B2 = "| **B-2** | **U3 的「本体链」面** | 多数页无对位实现 | 归 R13 溯源链验收 |";
const CANARY_LEDGER_PLUS_B5 = CANARY_LEDGER_B2 + "\n| **B-5** | **U5 的跨屏面** | 要两屏同开 | 归 R13 溯源链验收 |";
/** 判据⑨c 的钉子：只销 §4.2.1 那一头、§2.1 的源头不销。 */
const CANARY_CARVE_CLOSED = "| **U5** | x | y | ① | ②「跨屏」→ R13 线（不在本表射程）。2026-01-01 核销：WO-CANARY-DONE 交付 |";
const CANARY_CARVE_OPEN = "| **U5** | x | y | ① | ②「跨屏」→ R13 线（不在本表射程），还在做 |";

const CANARY_MD_OK = [
  "## 2 · 判据表",
  "| # | 判据 | 可机检？ |",
  "|---|---|---|",
  "| **U1** | 改输入即重演 | ✅ |",
  "| **U3** | 过程图 | ✅ |",
  "| **U5** | 跨屏一致 | ✅ |",
  "",
  "### 2.1 判据改写记录",
  "| # | 原措辞 | 缝在一起 | 留哪半 | 挪出去的那半去哪 |",
  "|---|---|---|---|---|",
  "| **U1** | x | y | ① | ② → §4.2 门 B（真浏览器） |",
  "| **U3** | x | y | ① | ②「本体链」→ §4.2（属 R13 溯源链） |",
  CANARY_CARVE_CLOSED,
  "",
  "## 4 · 表",
  // ↓ §4 主表 = 判据⑨d 的真值源。**U5 已结案 ⇒ 该列不许有「判不了」**；
  //   **U9 未结案且刻意留着一格「判不了」** —— 它钉住 UNDECIDABLE 这个常量：
  //   改坏它，下面 ⑨必中的 `U9 判不了 1 格` 当场不中 ⇒ RC=2（而不是静悄悄变绿）。
  "| 页 | U1 改输入即重演 | U3 过程图 | U5 跨屏一致 | U9 导出带口径 |",
  "|---|---|---|---|---|",
  CANARY_ROW_CLEAN,
  "| 乙页 `b` | **符合** | **符合** | **符合** | **符合** |",
  "",
  "### 4.1 依据",
  // ↓ **诱饵表**：§4.1 底下也有一张 `U…` 开头的表头（真文档里 §4.1/§4.5/§4.7 全是这种）。
  //   主表解析若不在 `### 4.1` 处截断，这两行会被算进主表，U9 的判不了从 1 变 2、总行数从 2 变 4
  //   —— ⑨必中当场报红。形态照铁律 0.6：「§4 这一节里出现的判不了」≠「主表里的判不了格」。
  "| 页 | U1 逐格取证 | U3 逐格取证 | U5 逐格取证 | U9 逐格取证 |",
  "|---|---|---|---|---|",
  "| 甲页 | 判不了 | 判不了 | 判不了 | 判不了 |",
  "",
  "**U3 过程图 + 点节点看凭什么**",
  "- **符合 1 页**：`p`：`FakePanelView.tsx:1` 面板",
  "- **不符合 9 页**：`LayeredDag.tsx:104` 共享组件",
  "**U4 反事实**",
  "- 略",
  "",
  "### 4.2 被拆出去的那一半",
  "| # | 拆出去的那半 | 为什么够不着 | 要判它得有什么 |",
  "|---|---|---|---|",
  "| **B-1** | **U1 的时延面** | 运行期量 | 真浏览器：断言 DOM 变了 |",
  CANARY_LEDGER_B2,
  "",
  // ↓ 同一节里的**第二张**表，第一列也叫 B-1/B-2 —— 连它一起收会把 2 条账读成 4 条。
  //   这个坑 2026-08-16 真发生过（本门自己写文档时当场踩中），故常驻金丝雀钉住。
  "#### 4.2.1 逐条可机检判定",
  "| # | 能不能机检 | 理由 | 差什么 |",
  "|---|---|---|---|",
  // ⚠ 这一行的「差什么」栏刻意写「已建 / 已接」：那说的是**受理方**的进度，
  //   **不是这条账结了**。CLOSED_MARK 收了它，门就会把「工具做好了」读成「这条账验完了」。
  "| **B-1** | 不能 | 运行期量 | 真浏览器 harness 已建并已接 gates |",
  "| **B-2** | 必要条件能 | 可判 | 渲染后读 DOM |",
  "| **B-5** | ✅ **已核销 · 已交付**（WO-CANARY-DONE）—— 本行是结案记录 | 账面理由被现算推翻 | 已兑现 |",
  "**内容面机检 1/2**（仅 B-2）",
  "",
  "## 5 · 优先级",
  "| 级 | 事项 | 为什么 | 归谁 |",
  "|---|---|---|---|",
  "| P3 | `WO-CANARY-HARNESS` 建真浏览器 harness，闭 B-1 | 静态够不着 | 一张门单 |",
  "| P3 | `WO-CANARY-R13` B-2 逐字齐全归 R13 | 需渲染 | 一张 R13 单 |",
].join("\n");

/**
 * 必不中样例：六处一起坏（①②③④⑦ 各一处），全部喂给**同一个** `parseSplitAccounts` + `judge`。
 */
const CANARY_MD_BAD = CANARY_MD_OK
  .replace("| **B-1** | **U1 的时延面** | 运行期量 | 真浏览器：断言 DOM 变了 |", "| **B-1** | **U1 的时延面** | 运行期量 | — |")
  .replace(CANARY_LEDGER_B2, "| **B-2** | **U99 的面** | 多数页无对位实现 | 以后再说 |")
  .replace("| P3 | `WO-CANARY-HARNESS` 建真浏览器 harness，闭 B-1 | 静态够不着 | 一张门单 |", "")
  .replace("**内容面机检 1/2**（仅 B-2）", "**内容面机检 2/2**（都验了）");

/**
 * ⚠ **锚点自检（2026-08-20 WO-SPLITACCOUNT-B-CLOSE 补，因为差点栽在这上面）**：
 * 上面四处 `replace` 的锚点都是**手抄的行**。改 `CANARY_MD_OK` 时锚点会静悄悄失配，
 * `replace` 无声返回原串 ⇒ 「必不中样例」退化成「必中样例」⇒ 判据③ 那一组**全部空转**，
 * 而门照样 RC=0。形态照铁律 0.6：**「我用『我写了一个坏样例』当作『坏样例真的坏了』的证据。」**
 * 故此处硬断言：坏样例必须**真的**与好样例不同（差异条数写死，少一处都不行）。
 */
const CANARY_BAD_DIFF = (() => {
  const a = CANARY_MD_OK.split("\n");
  const b = CANARY_MD_BAD.split("\n");
  return a.filter((l, i) => l !== b[i]).length;
})();

const FAKE_ONTOLOGY = "…不变量 R13 结论可溯源…";

/** 判据⑧ 的假证据源（金丝雀用）：只有这两张单存在。走的仍是**同一个** `judge`。 */
const FAKE_WO_ALL_FOUND = (wo) => ({ found: wo === "WO-CANARY-HARNESS" || wo === "WO-CANARY-R13", via: "canary" });
/** 同上，但 `WO-CANARY-R13` 查无此单 —— 判据⑧ 必须咬在 B-2 上。 */
const FAKE_WO_R13_MISSING = (wo) => ({ found: wo === "WO-CANARY-HARNESS", via: "canary" });
/**
 * 金丝雀基线（含结案记录，供判据⑥⑨e 的棘轮用）。
 *
 * ⚠ **现算自 `CANARY_MD_OK`，刻意不手抄**（2026-08-20 改）：手抄一份 fixture 出来，
 * 它会和金丝雀样例**各自漂移** —— 改了样例忘了改 fixture，②必中就会莫名其妙报 ⑥ 销账，
 * 于是下一个人为了让它绿而去改 fixture，金丝雀就被驯化了。
 * 而且这段现算走的**就是 `--tighten` 写基线时那段代码的同一形状**，
 * 顺带证明「tighten 出来的基线，judge 认」。
 */
const FAKE_BASELINE = (() => {
  const p = parseSplitAccounts(CANARY_MD_OK);
  const accounts = {};
  for (const a of p.accounts) accounts[a.id] = { us: a.us, receivers: RECEIVERS.filter((r) => r.re.test(a.need)).map((r) => r.name) };
  const closures = {};
  for (const c of p.closures) closures[c.id] = c.wos;
  return { accounts, closures, chain: { panels: 1, withChain: 0 } };
})();

export function canaries() {
  const bad = [];
  /**
   * ⚠ **跑过的条数必须现算，不许写死**（2026-08-20 WO-SPLITACCOUNT-B-CLOSE 改）：
   * 原来打印的是硬编码的 `金丝雀 8/8`。删掉一条金丝雀，那个 `8` 一动不动 ——
   * 于是「金丝雀 8/8」这句话本身就成了装饰品，正是本门要拦的那一族病。
   * 形态（铁律 0.6）：**「我用『报告里写着 8/8』当作『真跑了 8 条』的证据。」**
   */
  let ran = 0;
  const chk = (cond, msg) => { ran++; if (!cond) bad.push(msg); };

  const ok = parseSplitAccounts(CANARY_MD_OK);
  const notok = parseSplitAccounts(CANARY_MD_BAD);

  /* ①必中：解析器认得出合法的账（2 条账 · 2 条外移 · 3 条判据 · 2 张单 · 自陈 1/2 · 面板文件只取「符合」段） */
  chk(ok.accounts.length === 2 && ok.carveOuts.length === 2 && ok.criteria.size === 3 &&
      ok.dispatch.size === 2 && ok.selfClaim?.n === 1 && ok.selfClaim?.m === 2 &&
      ok.panelFiles.join(",") === "FakePanelView.tsx",
    `①必中样例：accounts=${ok.accounts.length} carveOuts=${ok.carveOuts.length} criteria=${ok.criteria.size} dispatch=${ok.dispatch.size} selfClaim=${JSON.stringify(ok.selfClaim)} panelFiles=[${ok.panelFiles.join(",")}]（应为 2/2/3/2/{1,2}/[FakePanelView.tsx]）`);
  /* ①b 必不中：`LayeredDag.tsx` 在「不符合」段，**不许**被收进面板文件 —— 收进来会把
   *      「共享组件里没有本体链」误当成「某个面板里没有」（那正是代理指标那一族病）。 */
  chk(!ok.panelFiles.includes("LayeredDag.tsx"),
    "①b 必不中样例：`LayeredDag.tsx`（§4.1「不符合」段的共享组件）被误收进面板文件");
  /* ①c 必不中：§4.2.1 的第二张表（第一列同样是 B-1/B-2）**不许**被算成明账。
   *      样例里两张表各 2 行；若解析器把两张都收了，`accounts` 会是 4 —— 上面 ①必中
   *      的 `accounts.length === 2` 就会当场报红。这条只再钉一次「重复 id」这个更刺眼的形态。 */
  chk(new Set(ok.accounts.map((a) => a.id)).size === ok.accounts.length,
    `①c 必不中样例：明账 id 有重复（${ok.accounts.map((a) => a.id).join(",")}）—— §4.2.1 的第二张表被误收成了明账`);

  /* ②必中：合法账全绿（**带上判据⑧⑨ 的证据源一起判**，否则两条新判据在必中侧从没被跑过） */
  const jOk = judge({
    prd: ok, ontology: FAKE_ONTOLOGY, wired: true,
    chain: { panels: 1, withChain: 0 },
    baseline: FAKE_BASELINE, woEvidence: FAKE_WO_ALL_FOUND,
  });
  if (jOk.fail.length !== 0) bad.push(`②必中样例：合法账应零违规，实得 ${jOk.fail.length} 条 → ${jOk.fail.map((f) => f.code + (f.account ? "/" + f.account : "") + " " + f.msg.slice(0, 60)).join(" ｜ ")}`);

  /* ③0 锚点自检：坏样例必须**真的**坏了（四处 replace 全部命中）—— 见 CANARY_BAD_DIFF 的注释 */
  chk(CANARY_BAD_DIFF === 4,
    `③0 锚点自检：必不中样例只与必中样例差 ${CANARY_BAD_DIFF} 行（应 4 行）—— 有 replace 的锚点失配、无声返回了原串，那几条「必不中」其实什么都没测`);

  /* ③必不中：六处坏账必须被逐条抓到，且**红在对应那条上** */
  const jBad = judge({ prd: notok, ontology: FAKE_ONTOLOGY, wired: true, chain: { panels: 1, withChain: 0 }, baseline: null });
  const codes = new Set(jBad.fail.map((f) => f.code));
  for (const c of ["①", "②", "③", "④", "⑦"]) {
    chk(codes.has(c), `③必不中样例：判据${c} 没有被抓到（实得 ${[...codes].join("")}）`);
  }
  chk(jBad.fail.some((f) => f.account === "B-1" && f.code === "①"), "③必不中样例：B-1 的空栏没有红在 B-1 上");
  chk(jBad.fail.some((f) => f.account === "B-2" && f.code === "③"), "③必不中样例：B-2 的未登记受理方没有红在 B-2 上");

  /* ④受理方登记表真的会拒绝不存在的受理方（R13 从本体里消失 ⇒ B-2 的出口指向空气） */
  const jNoR13 = judge({ prd: ok, ontology: "（本体里没有那条不变量）", wired: true, chain: { panels: 1, withChain: 0 }, baseline: null });
  chk(jNoR13.fail.some((f) => f.code === "③" && f.account === "B-2"), "④受理方存在性：R13 从本体里消失时，B-2 的出口没有被判为指向空气");

  /* ⑤自指接线证明：本门没接进 gates 串时，「归门 B」那条必须红 */
  const jUnwired = judge({ prd: ok, ontology: FAKE_ONTOLOGY, wired: false, chain: { panels: 1, withChain: 0 }, baseline: null });
  chk(jUnwired.fail.some((f) => f.code === "③" && f.account === "B-1"), "⑤自指接线证明：门未接线时「归门 B」那条没有红");

  /* ⑥判据⑤ 的现算方向：对位实现过半 ⇒ B-2 账面理由不再成立 */
  const jChain = judge({ prd: ok, ontology: FAKE_ONTOLOGY, wired: true, chain: { panels: 2, withChain: 2 }, baseline: null });
  chk(jChain.fail.some((f) => f.code === "⑤" && f.account === "B-2"), "⑥判据⑤：对位实现过半时 B-2 账面理由没有被判为不成立");

  /* ⑦剥注释：注释里写的「本体链」不算对位实现 */
  chk(!CHAIN_MARK.test(stripComments("// 这里以后要渲染本体链\nconst x = 1;")), "⑦剥注释：注释里的「本体链」被当成了对位实现");
  chk(CHAIN_MARK.test(stripComments("const label = \"本体链\";")), "⑦剥注释：真代码里的「本体链」被剥掉了");

  const bd = baselineDocCanary();
  chk(bd.ok, `⑧基线写入器：${bd.got}`);

  /* ══ 以下 ⑨–⑬ 为 WO-SPLITACCOUNT-B-CLOSE 补：判据⑧⑨ 的正反两侧 ══════════════
   * 全部喂给**同一个** `parseSplitAccounts()` + `judge()`。这几条同时是 M4 的靶子：
   * 主正则/主常量（`B-\d+` · `U\d+b?` · UNDECIDABLE · CLOSED_MARK · WO_ID · 表头形状）
   * 任改坏一个，下面必有一条不中 ⇒ RC=2（工具坏了），**不会**静悄悄 RC=0。 */

  /* ⑨必中：新解析面的四个读数（§4 主表逐列 · 结案记录 · 源头销账 · §5 单号） */
  const u5 = ok.grid.get("U5");
  const u9 = ok.grid.get("U9");
  chk(ok.grid.size === 4 && !!u5 && !!u9 && u5.total === 2 && u5.undecidable.length === 0 &&
      u9.total === 2 && u9.undecidable.length === 1,
    `⑨必中样例·§4 主表：列数=${ok.grid.size}（应 4）· U5=${u5 ? `${u5.undecidable.length}/${u5.total}` : "缺"}（应 0/2）· U9=${u9 ? `${u9.undecidable.length}/${u9.total}` : "缺"}（应 1/2）—— 多半是 UNDECIDABLE 常量、表头形状正则，或 \`### 4.1\` 截断被改坏（§4.1 的诱饵表混进主表）`);
  chk(ok.closures.length === 1 && ok.closures[0].id === "B-5" && ok.closures[0].wos.join(",") === "WO-CANARY-DONE",
    `⑨必中样例·结案记录：实得 [${ok.closures.map((c) => `${c.id}(${c.wos.join("+")})`).join(",")}]（应 [B-5(WO-CANARY-DONE)]）—— 多半是 CLOSED_MARK 或 WO_ID 被改坏`);
  chk(ok.carveClosures.length === 1 && ok.carveClosures[0].u === "U5",
    `⑨必中样例·§2.1 源头销账：实得 [${ok.carveClosures.map((c) => c.u).join(",")}]（应 [U5]）`);
  chk(ok.woIds.length === 2 && ok.woIds[0].wo === "WO-CANARY-HARNESS" && ok.woIds[0].ids.join(",") === "B-1" &&
      ok.woIds[1].wo === "WO-CANARY-R13" && ok.woIds[1].ids.join(",") === "B-2",
    `⑨必中样例·§5 单号：实得 [${ok.woIds.map((w) => `${w.wo}→${w.ids.join("+")}`).join(", ")}]（应 [WO-CANARY-HARNESS→B-1, WO-CANARY-R13→B-2]）—— WO_ID 正则被改坏时这条先红`);
  /* ⑨b 必不中：「harness 已建 / 已接 gates」说的是受理方进度，**不是这条账结了** */
  chk(!ok.closures.some((c) => c.id === "B-1"),
    "⑨b 必不中样例：B-1 那行的「已建 / 已接」被 CLOSED_MARK 当成了结案标记 —— 「工具做好了」会被读成「这条账验完了」，正是本门要拦的那件事");
  chk(CLOSED_MARK.test("已核销") && CLOSED_MARK.test("已交付") && !CLOSED_MARK.test("不能") && !CLOSED_MARK.test("harness 已建并已接 pnpm gates"),
    "⑨b 必不中样例：CLOSED_MARK 双向判定不符（应认「已核销/已交付」、不认「不能」与「已建/已接」）");
  /* ⑨c 必中：WO_ID 只认全大写单号，不认小写、不认半截 */
  chk(woIdsIn("派给 `WO-FOO-BAR` 与 wo-lower-case 以及 WO-").join(",") === "WO-FOO-BAR",
    `⑨c WO_ID 正则：woIdsIn 实得 [${woIdsIn("派给 \`WO-FOO-BAR\` 与 wo-lower-case 以及 WO-").join(",")}]（应 [WO-FOO-BAR]）`);

  /* ⑩必中：判据⑨d 会咬 —— 已结案的 U5 列翻出一格「判不了」 */
  const lieMd = CANARY_MD_OK.replace(CANARY_ROW_CLEAN, CANARY_ROW_LIE);
  chk(lieMd !== CANARY_MD_OK, "⑩必中样例：⑨d 的锚点没命中（变异体与原文相同）—— 这一条什么都没证");
  const jLie = judge({ prd: parseSplitAccounts(lieMd), ontology: FAKE_ONTOLOGY, wired: true, chain: { panels: 1, withChain: 0 }, baseline: FAKE_BASELINE, woEvidence: FAKE_WO_ALL_FOUND });
  chk(jLie.fail.some((f) => f.code === "⑨" && f.account === "B-5" && f.msg.includes("状态说谎")),
    `⑩必中样例·⑨d：已结案的 U5 列出现「${UNDECIDABLE}」时没有红在 B-5 上（实得 ${jLie.fail.map((f) => f.code + "/" + f.account).join(" ") || "零违规"}）`);

  /* ⑪必中：判据⑨a 会咬 —— 已结案的账又挂回 §4.2 在册表 */
  const dupMd = CANARY_MD_OK.replace(CANARY_LEDGER_B2, CANARY_LEDGER_PLUS_B5);
  chk(dupMd !== CANARY_MD_OK, "⑪必中样例：⑨a 的锚点没命中（变异体与原文相同）");
  const jDup = judge({ prd: parseSplitAccounts(dupMd), ontology: FAKE_ONTOLOGY, wired: true, chain: { panels: 1, withChain: 0 }, baseline: FAKE_BASELINE, woEvidence: FAKE_WO_ALL_FOUND });
  chk(jDup.fail.some((f) => f.code === "⑨" && f.account === "B-5" && f.msg.includes("自相矛盾")),
    `⑪必中样例·⑨a：结了案的 B-5 又挂回在册表时没有红在 B-5 上（实得 ${jDup.fail.map((f) => f.code + "/" + f.account).join(" ") || "零违规"}）`);

  /* ⑫必中：判据⑨c 会咬 —— 只销 §4.2.1 那一头，§2.1 的源头不销 */
  const orphanMd = CANARY_MD_OK.replace(CANARY_CARVE_CLOSED, CANARY_CARVE_OPEN);
  chk(orphanMd !== CANARY_MD_OK, "⑫必中样例：⑨c 的锚点没命中（变异体与原文相同）");
  const jOrphan = judge({ prd: parseSplitAccounts(orphanMd), ontology: FAKE_ONTOLOGY, wired: true, chain: { panels: 1, withChain: 0 }, baseline: FAKE_BASELINE, woEvidence: FAKE_WO_ALL_FOUND });
  chk(jOrphan.fail.some((f) => f.code === "⑨" && f.account === "B-5" && f.msg.includes("两处账对不上")),
    `⑫必中样例·⑨c：§2.1 源头不销账时没有红在 B-5 上（实得 ${jOrphan.fail.map((f) => f.code + "/" + f.account).join(" ") || "零违规"}）`);

  /* ⑫b 必中：判据⑨e 会咬 —— 结案记录整行消失（⑨ 最廉价的空转死法） */
  const goneMd = CANARY_MD_OK.split("\n").filter((l) => !l.trim().startsWith("| **B-5** |")).join("\n");
  chk(goneMd !== CANARY_MD_OK, "⑫b 必中样例：⑨e 的锚点没命中（变异体与原文相同）");
  const jGone = judge({ prd: parseSplitAccounts(goneMd), ontology: FAKE_ONTOLOGY, wired: true, chain: { panels: 1, withChain: 0 }, baseline: FAKE_BASELINE, woEvidence: FAKE_WO_ALL_FOUND });
  chk(jGone.fail.some((f) => f.code === "⑨" && f.account === "B-5" && f.msg.includes("结案记录消失")),
    `⑫b 必中样例·⑨e：结案行被删时没有红在 B-5 上（实得 ${jGone.fail.map((f) => f.code + "/" + f.account).join(" ") || "零违规"}）`);

  /* ⑬必中：判据⑧ 会咬 —— 受理方单号查无此单，且**红在认领它的那条账上** */
  const jFakeWo = judge({ prd: ok, ontology: FAKE_ONTOLOGY, wired: true, chain: { panels: 1, withChain: 0 }, baseline: FAKE_BASELINE, woEvidence: FAKE_WO_R13_MISSING });
  const hit8 = jFakeWo.fail.filter((f) => f.code === "⑧");
  chk(hit8.length === 1 && hit8[0].account === "B-2",
    `⑬必中样例·⑧：单号查无此单时应恰好红 1 条且落在 B-2，实得 [${hit8.map((f) => f.account).join(",")}]`);
  /* ⑬b 必不中：证据源齐全时判据⑧ 不许误伤（否则每条账都会被报成「编出来的名字」） */
  chk(!jOk.fail.some((f) => f.code === "⑧"), "⑬b 必不中样例：单号都查得到时判据⑧ 仍报了违规（误伤）");
  /* ⑬c 必不中：**没有证据源就不许判** —— 传 null 时判据⑧ 必须整条跳过（主流程此时走 RC=2） */
  const jNoEv = judge({ prd: ok, ontology: FAKE_ONTOLOGY, wired: true, chain: { panels: 1, withChain: 0 }, baseline: FAKE_BASELINE, woEvidence: null });
  chk(!jNoEv.fail.some((f) => f.code === "⑧"), "⑬c 必不中样例：没有证据源时判据⑧ 仍下了结论 —— 「我没查出来」被说成了「你违规」，失败方向反了");

  return { ok: bad.length === 0, bad, ran };
}

/* ═══════════════════ 顶层兜底（形态 a：try 是 Program 的直接子语句）═════════════ */

function toolBroken(what, hint) {
  console.error(`⛔ ${SELF}：${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「明账都在册 / 拆账没问题 / 通过」——本门这次没跑完，它什么都没证明。");
  if (hint) console.error("   " + hint);
  process.exit(2); // 2 = 门自己坏了（1 = 明账真有问题），两者处置相反，不许合并
}

// ⚠ 与兄弟门 check-sim-ux-criteria.mjs 同款：顶层 try 是 Program 的**直接子语句**
// （`check-gate-exit-discipline.mjs` 判据②(a) 只认这一形态；写成 `if (isMain) { try {…} }`
// 语义一样但会被判「无顶层兜底」）。刻意不用 `process.on` 全局 handler：本文件导出的
// 解析器可被测试 import，全局 handler 会装进跑测试的那个进程并把它整个带走。
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
try {
  if (isMain) main();
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}

function read(rel) {
  const p = resolve(process.cwd(), rel);
  if (!existsSync(p)) {
    toolBroken(`读不到 ${rel}`, "扫描面缺失 ⇒ 账集合会变空 ⇒ 差集恒空 ⇒ 门恒绿（失败危险方向），故一律判「工具坏了」。");
  }
  return readFileSync(p, "utf8");
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (f) => argv.includes(f);

  /* ── 保命判据：金丝雀先跑（不过 ⇒ RC=2，不许报「明账都在册」）───────────── */
  if (process.env.SPLITACCOUNT_FORCE_CANARY_BREAK === "1") {
    // 故障注入：只给退出码自检用 —— 写在注释里的约定不是机制，机器跑得到的才是。
    toolBroken("（故障注入）金丝雀被强制判不中", "这是退出码自检在验「工具坏了 ⇒ RC=2」这条路径。");
  }
  const cy = canaries();
  if (!cy.ok) {
    console.error("🛠️  **工具坏了**：金丝雀不符预期 ——");
    for (const b of cy.bad) console.error("   · " + b);
    console.error("   ⛔ 不许把本次结果读作「明账都在册」。");
    process.exit(2);
  }
  // ⚠ 条数**现算**（`cy.ran`），不是写死的字面量 —— 删掉一条金丝雀，这个数会跟着掉。
  console.log(`✅ 金丝雀 ${cy.ran}/${cy.ran}（必中账 · 必不中账逐条对位 · 坏样例锚点自检 · 共享组件不许混进面板文件 · 受理方存在性 · 自指接线 · 判据⑤方向 · 剥注释双向 · 基线写入器 · §4 主表逐列 · 结案标记双向 · 单号正则 · 判据⑨abcde 五向 · 判据⑧ 正反两侧＋无证据源不许判）`);
  if (flag("--selftest")) { console.log("（--selftest：只跑金丝雀，未比对仓库内容）"); return; }

  /* ── 现算三个输入源 ────────────────────────────────────────────────────── */
  const prdText = read(PRD);
  const prd = parseSplitAccounts(prdText);
  if (prd.accounts.length === 0 && prd.criteria.size === 0) {
    toolBroken(`${PRD} 里 §2 判据表与 §4.2 明账**同时**解析出 0 条`, "两个都空 = 解析器瞎了（文档真长这样的可能性极低）；报「明账不存在」会把一份真账读成没有。");
  }
  if (prd.panelFiles.length === 0) {
    toolBroken(`${PRD} §4.1 的 U3「符合」段抽不出任何面板文件`, "抽不出 ⇒ 判据⑤ 的扫描面为空 ⇒ 恒绿（失败危险方向）。多半是 §4.1 改写了写法。");
  }
  /* ↓ 判据⑧⑨ 的两个扫描面，空了就是恒绿的危险方向 —— 一律判「我没查出来」而不是「都好着呢」 */
  if (prd.grid.size === 0) {
    toolBroken(`${PRD} §4 主表解析不出任何 \`U#\` 列`, "解析不出 ⇒ 判据⑨d 没有任何一格可数 ⇒ 「结案的那条判据还判不了」永远发现不了（恒绿）。多半是主表表头改了写法，或 `### 4.1` 这个截断锚点变了。");
  }
  if (prd.woIds.length === 0) {
    toolBroken(`${PRD} §5 里点名 B-x 的行抽不出任何 \`WO-…\` 单号`, "抽不出 ⇒ 判据⑧ 的扫描面为空 ⇒ 「受理方是编出来的名字」永远发现不了（恒绿）。多半是 §5 改了写法，或单号不再写成全大写。");
  }
  const ontology = read(ONTOLOGY);
  const pkg = read(PKG);
  const gatesChain = (() => {
    try { return JSON.parse(pkg).scripts?.gates ?? ""; } catch (e) { return toolBroken(`package.json 解析不出（${e?.message || e}）`); }
  })();
  if (!gatesChain) toolBroken("package.json 里读不到 `scripts.gates`", "判据③ 的自指接线证明要拿它当真值；读不到就是「我没查出来」。");
  const wired = gatesChain.includes(SELF);

  const chain = computeChain(prd.panelFiles, resolve(process.cwd(), FE_ROOT), (p) => readFileSync(p, "utf8"));
  const unresolved = chain.files.filter((f) => !f.path);
  if (unresolved.length === chain.files.length) {
    toolBroken(`§4.1 点名的 ${chain.files.length} 个面板文件在 ${FE_ROOT} 下一个都找不到`, "全找不到 = 多半 cwd 不在仓根，或前端目录被搬了；报「没有对位实现」会把结论反着说。");
  }

  const baseline = existsSync(resolve(process.cwd(), BASELINE)) ? JSON.parse(read(BASELINE)) : null;

  /* ── 判据⑧ 的证据源：git ref（远端）＋ 仓内 grep，**两条都可用才判** ─────────── */
  const git = (args) => {
    const r = spawnSync("git", args, { encoding: "utf8", cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 });
    return { status: r.error ? null : r.status, stdout: r.stdout ?? "" };
  };
  const ev = buildWoEvidence(git, SELF, PRD);
  if (!ev.ok) {
    toolBroken(`判据⑧ 的证据源取不到：${ev.why}`, "少一条证据源 ⇒ 「本可查到的单号」会被错报成「编出来的名字」—— 那是把「我没查全」说成「你违规」，失败方向正好反了。");
  }
  const woEvidence = ev.query;

  if (flag("--census")) {
    console.log("\n── §4.2 明账现算 ──");
    for (const a of prd.accounts) {
      const rec = RECEIVERS.filter((r) => r.re.test(a.need)).map((r) => r.name).join(" / ") || "（未点名已登记受理方）";
      console.log(`  ${a.id}  认领 ${a.us.join("+") || "（无）"}  受理方：${rec}  §5 单：${prd.dispatch.has(a.id) ? "有" : "无"}  内容面机检：${CONTENT_CHECKED.has(a.id) ? "是" : "否"}`);
    }
    console.log(`\n  §2.1 外移登记 ${prd.carveOuts.length} 条：${prd.carveOuts.map((c) => c.u).join(" ")}`);
    console.log(`  §2 判据表 ${prd.criteria.size} 条：${[...prd.criteria].join(" ")}`);
    console.log(`  自陈：内容面机检 ${prd.selfClaim ? `${prd.selfClaim.n}/${prd.selfClaim.m}` : "（缺）"} · 本门现算 ${prd.accounts.filter((a) => CONTENT_CHECKED.has(a.id)).length}`);
    console.log(`\n── 判据⑤ 现算（面板文件 → 本体链对位实现）──`);
    for (const f of chain.files) console.log(`  ${f.chain ? "✓有" : "✗无"}  ${f.base}\t${f.path ?? "（找不到，本次不计入）"}`);
    console.log(`  合计：面板文件 ${chain.panels} · 有对位实现 ${chain.withChain}`);
    console.log(`\n  本门是否已接进 pnpm gates：${wired ? "是" : "否"}`);
    console.log(`\n── 判据⑧ 现算（§5 点名的受理方单号 → 仓里/远端查得到吗）──`);
    console.log(`  证据源金丝雀：${ev.canary}`);
    for (const w of prd.woIds) {
      const r = woEvidence(w.wo);
      console.log(`  ${r.found ? "✓在" : "✗查无此单"}  ${w.wo}\t← ${w.ids.join("+")}\t${r.via}`);
    }
    console.log(`\n── 判据⑨ 现算（结案状态 → §4 主表对应列还有没有「${UNDECIDABLE}」）──`);
    if (!prd.closures.length) console.log("  （§4.2.1 里今天没有任何结案记录）");
    for (const c of prd.closures) {
      const ms = prd.carveClosures.filter((cc) => cc.wos.some((w) => c.wos.includes(w)));
      const cols = ms.map((cc) => {
        const col = prd.grid.get(cc.u);
        return `${cc.u}: ${col ? `${col.undecidable.length}/${col.total} 格${UNDECIDABLE}` : "§4 主表无此列"}`;
      });
      console.log(`  ${c.id}  结案单 ${c.wos.join("+") || "（未点名）"}  §2.1 源头销账 ${ms.map((m) => m.u).join("+") || "（无·两处账对不上）"}  ${cols.join(" · ") || "—"}  在册 ${prd.accounts.some((a) => a.id === c.id) ? "是（自相矛盾）" : "否"}`);
    }
    console.log(`\n── §4 主表逐列（判据⑨d 的真值源，共 ${prd.grid.size} 列 × ${[...prd.grid.values()][0]?.total ?? 0} 页）──`);
    console.log(`  还有「${UNDECIDABLE}」的列：${[...prd.grid.entries()].filter(([, v]) => v.undecidable.length).map(([u, v]) => `${u}(${v.undecidable.length})`).join(" ") || "（无）"}`);
    return;
  }

  if (flag("--seed") || flag("--tighten")) {
    const bc = baselineDocCanary();
    if (!bc.ok) toolBroken(`基线写入器金丝雀不过（${bc.got}）`, `期望：${bc.want}`);
    const accounts = {};
    for (const a of prd.accounts) {
      accounts[a.id] = { us: a.us, receivers: RECEIVERS.filter((r) => r.re.test(a.need)).map((r) => r.name) };
    }
    const closures = {};
    for (const c of prd.closures) closures[c.id] = c.wos;
    writeFileSync(resolve(process.cwd(), BASELINE), JSON.stringify(buildBaselineDoc({
      prev: baseline,
      generatedBy: `node scripts/${SELF} ${flag("--seed") ? "--seed" : "--tighten"}`,
      prose: {
        note:
          "harness-ux-splitaccount 棘轮基线：`docs/PRD-harness-ux-adoption.md` §4.2 的 B-x 明账快照。" +
          "记的是每条账**认领的判据**与**受理方**，以及判据⑤ 的现算读数。销账 / 改绑 / 改口 / 新账" +
          "一律要显式跑 `--tighten` —— 明账最危险的死法不是被推翻，是**没人注意到它没了**。" +
          "`accounts`/`chain`/`closures` 归机器算，本 note 与任何人手新增的顶层键归人手（scripts/lib/baseline-doc.mjs 保证不吞人话）。" +
          "`closures` 是**结案记录**的棘轮（判据⑨e）：一条账结了案就从 accounts 挪到这里，之后**只许增不许减**——" +
          "把结案行删掉，判据⑨ 就没有对象可判、整条自动变绿，那是本门最廉价的死法。",
      },
      computed: { accounts, closures, chain: { panels: chain.panels, withChain: chain.withChain } },
    }), null, 2) + "\n");
    console.log(`✍️  基线已写：${BASELINE}（明账 ${Object.keys(accounts).length} 条 · 结案记录 ${Object.keys(closures).length} 条 · 面板文件 ${chain.panels} · 有对位实现 ${chain.withChain}）`);
    return;
  }

  if (flag("--mutation-proof")) { mutationProof({ prdText, ontology, wired, chain, baseline, woEvidence }); return; }

  /* ── 门本体 ─────────────────────────────────────────────────────────────── */
  const { fail } = judge({ prd, ontology, wired, chain, baseline, woEvidence });

  console.log(`· §4.2 明账 ${prd.accounts.length} 条：${prd.accounts.map((a) => `${a.id}(${a.us.join("+")})`).join(" ")}`);
  console.log(`· §2.1 外移 ${prd.carveOuts.length} 条 → 认领 ${new Set(prd.accounts.flatMap((a) => a.us)).size} 条 · §5 已派单 ${prd.dispatch.size}/${prd.accounts.length}`);
  console.log(`· 判据⑤ 现算：面板文件 ${chain.panels} · 有「本体链」对位实现 ${chain.withChain}${unresolved.length ? `（${unresolved.length} 个文件名找不到，未计入）` : ""}`);
  console.log(`· 内容面机检 ${prd.accounts.filter((a) => CONTENT_CHECKED.has(a.id)).length}/${prd.accounts.length}（自陈 ${prd.selfClaim ? `${prd.selfClaim.n}/${prd.selfClaim.m}` : "缺"}）· 本门已接线 ${wired ? "是" : "否"}`);
  console.log(`· 判据⑧ 受理方单号 ${prd.woIds.filter((w) => woEvidence(w.wo).found).length}/${prd.woIds.length} 查得到（${prd.woIds.map((w) => w.wo).join(" ")}）`);
  console.log(`· 判据⑨ 结案记录 ${prd.closures.length} 条：${prd.closures.map((c) => `${c.id}←${c.wos.join("+")}`).join(" ") || "（无）"} · §4 主表 ${prd.grid.size} 列，仍有「${UNDECIDABLE}」的列：${[...prd.grid.entries()].filter(([, v]) => v.undecidable.length).map(([u, v]) => `${u}(${v.undecidable.length})`).join(" ") || "无"}`);
  if (!baseline) {
    console.error(`\n🔴 harness-ux-splitaccount:check 未通过：基线 ${BASELINE} 不存在 —— 先跑 \`node scripts/${SELF} --seed\` 建账（不建账 = 判据⑥ 不生效，门是装饰品）`);
    process.exit(1);
  }
  if (fail.length) {
    console.error(`\n🔴 harness-ux-splitaccount:check 未通过（${fail.length} 条）：`);
    for (const f of fail) console.error(`  - ${f.code}${f.account ? ` [${f.account}]` : ""} ${f.msg}`);
    console.error("\n  提醒：本门红了**不等于**那四条明账被验完了 —— 它们今天的验收方式见门头「逐条可机检判定」。");
    process.exit(1);
  }
  console.log("\n🟢 harness-ux-splitaccount:check 通过（账形态完整 · 双向绑定无孤儿无悬空 · 受理方均存在 · 每条账有单 · B-2 账面理由现算属实 · 无静默销账 · 自陈未超发 · 受理方单号仓里/远端查得到 · 结案状态与 §4 主表对得上）。");
  console.log("  ⚠ 诚实位：**通过 ≠ 那几条明账被验完了**。本门守的是账（在不在 / 有没有主 / 指不指向空气 / 有没有单 / 状态是不是真的），不是账的内容。");
}

/* ═══════════════════ 变异反证（每条 B-x 一个违规样例，且必须红在对应那条上）═════ */

/** 证明「变异体 ≠ 原文」的**可打印证据**。长度差为 0 也可能真改了（等长替换），故必须给首个差异位。 */
function diffProof(a, b) {
  if (a === b) return null;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return { dLen: a.length - b.length, at: i, was: a.slice(i, i + 14), now: b.slice(i, i + 14) };
}

/**
 * 逐条 B-x 喂违规样例，**三向断言**：
 *   ① 变异体 ≠ 原文（锚点真命中 —— 附首个差异位，等长替换时长度差为 0 也照样成立）；
 *   ② 触发的**判据编号集合**恰好等于预期（`wantCodes`，不是散文而是断言）；
 *   ③ **被牵连的 B-x 集合恰好等于目标那一条**（不许误伤别的账）。
 * 走的是**同一个** `parseSplitAccounts` + `judge`，不另起一套。
 *
 * ⚠ ② 这一向是 2026-08-16 补的：初版只把预期写成散文（`want: "①+③"`），
 * 而实测触发的是 `①⑥` —— **打印出来的「期望」是错的却没人拦**，正是本仓
 * 「写在最容易被信的地方的错误说法比没有更危险」那条。断言化之后，写错当场红。
 */
function mutationProof({ prdText, ontology, wired, chain, baseline, woEvidence }) {
  /**
   * M7/M8 需要**假装某个单号查不到**。刻意不去真删分支：变异必须只动被验的那一个变量。
   * 包在真证据源外面 —— 仍是同一个 `judge`，只是喂它一个被单点污染的证据源。
   */
  const evWithout = (missing) => (wo) => (wo === missing ? { found: false, via: "" } : woEvidence(wo));
  /** 一个**真的**查不到的单号。同 EVIDENCE_ABSENT_CANARY：拼出来，否则它会存在于本文件里。 */
  const FAKE_WO = ["WO", "NEVER", "EXISTED", "ZZ9"].join("-");
  /**
   * 结构化变异：把 §4 主表里 `u` 那一列的**第一个数据行**翻成「判不了」。
   * 刻意不写死行文本 —— 那张表的格子今天全是「符合」，靠字面锚点根本定位不到某一列，
   * 而写死某一行的整行文本，明天别人翻一格账那行就变了、锚点静默失配（M2/M5/M6 就是这么死的）。
   */
  const flipGridCell = (t, u) => {
    const lines = t.split("\n");
    let headIdx = -1; let col = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim().startsWith("|")) continue;
      const cs = cells(lines[i]);
      const us = cs.map((c) => (c.match(/^(U\d+b?)(\s|$)/) ?? [])[1] ?? null);
      if (us.filter(Boolean).length >= 3) { headIdx = i; col = us.indexOf(u); break; }
    }
    if (headIdx < 0 || col < 0) return t; // 定位不到 ⇒ 原样返回 ⇒ 「变异体 ≠ 原文」当场判失败
    for (let i = headIdx + 1; i < lines.length; i++) {
      if (!lines[i].trim().startsWith("|")) break;
      const cs = cells(lines[i]);
      if (isSep(cs)) continue;
      const raw = lines[i].replace(/^\|/, "").replace(/\|\s*$/, "").split("|");
      if (col >= raw.length) return t;
      raw[col] = ` **${UNDECIDABLE}** `;
      lines[i] = "|" + raw.join("|") + "|";
      return lines.join("\n");
    }
    return t;
  };

  const M = [
    {
      id: "M1", target: "B-1", wantCodes: "①⑥",
      why: "把 B-1 的「要判它得有什么」挖成 `—`（明账写成填空题）",
      note: "①空栏 + ⑥改口（受理方随之消失）。③**刻意不触发** —— 栏已空时 ③ 主动跳过，免得同一处坏账被报两遍",
      mutate: (t) => t.replace("| 真浏览器：改一个输入、**不点任何按钮**，断言结果 DOM 在 N 毫秒内变了 |", "| — |"),
    },
    {
      id: "M2", target: "B-3", wantCodes: "③⑥",
      why: "把 B-3 的受理方从「真浏览器」改成一个没登记的去处",
      note: "③出口没点名任何已登记受理方 + ⑥改口。⚠ 本条原来打在 B-2 上，**B-2 已于 2026-08-18 核销出表**，锚点随之失配（`--mutation-proof` 因此从 6/6 掉成 3/6 而没人发现）—— 已改挂在册的 B-3",
      mutate: (t) => t.replace("| 真浏览器：两屏同开，断言同一 `objectId.prop` 两处读数相等 |", "| 以后再说 |"),
    },
    {
      id: "M3", target: "B-3", wantCodes: "④",
      why: "删掉 §5 里点名 B-3 的那张单（挂账退化成「诚实地永远不做」）",
      note: "④只咬「没单」这一件事，账本身没动 ⇒ 不许牵连 ⑥",
      mutate: (t) => t.split("\n").filter((l) => !(l.trim().startsWith("|") && /\bB-3\b/.test(l) && !/^\| \*\*B-3\*\*/.test(l.trim()))).join("\n"),
    },
    {
      id: "M4", target: "B-4", wantCodes: "②⑥",
      why: "把 B-4 认领的判据改成一个 §2 判据表里不存在的 U99（僵尸账）",
      note: "②反向（U99 不在判据表）+ ⑥改绑。②正向（U7/U8 没人认领）不带 B-x 标签，故不进牵连集",
      mutate: (t) => t.replace("| **B-4** | **U7 的内容面** ＋ **U8 的几何面**", "| **B-4** | **U99 的内容面** ＋ **U98 的几何面**"),
    },
    {
      id: "M5", target: "B-3", wantCodes: "②⑥⑦",
      why: "整行删掉 B-3（明账最危险的死法：没人注意到它没了）",
      note: "②正向（U5 挪走了却没人认领）+ ⑥销账 + ⑦分母 3→2。**⑦跟着红是对的**：账少了一条，自陈的分母就不再属实。⚠ 同 M2，原来打在已核销的 B-2 上",
      mutate: (t) => t.split("\n").filter((l) => !l.trim().startsWith("| **B-3** |")).join("\n"),
    },
    {
      id: "M6", target: null, wantCodes: "⑦",
      why: "把自陈从「内容面机检 0/3」改成 3/3（门建成之后最可能发生的那件事）",
      note: "**等长替换 ⇒ 长度差为 0**，所以这一条的「变异体≠原文」必须靠首个差异位来证，不能靠字节数。⚠ 原写死 `1/4`，随 B-2 核销失配",
      mutate: (t) => t.replace(/内容面机检\s*0\s*\/\s*3/, "内容面机检 3/3"),
    },
    {
      id: "M7", target: "B-3", wantCodes: "⑧",
      why: `把 §5 派给 B-3 的受理方单号换成一个仓里和远端都查不到的名字（${FAKE_WO}）`,
      note: "⑧ 单号查无此单。**判据③ 在这一条上一声不吭** —— 它只问「点没点名一个已登记的抽象受理方」，而「真浏览器」那三个字一个没动。这正是加判据⑧ 的全部理由",
      mutate: (t) => t.replaceAll("WO-FACT-USAGE-REGISTRY", FAKE_WO),
    },
    {
      id: "M8", target: "B-2", wantCodes: "⑨",
      why: `把 §4 主表里 U3 列的第一格翻成「${UNDECIDABLE}」（B-2 标着已交付，而它拆自的那条判据还判不了）`,
      note: "⑨d 状态说谎 —— 这一条就是本门新判据的本体：「判不了 0」是拆账拆出来的读数，拆出去的那半自称交付时，留在表内的那半必须真的判得了",
      mutate: (t) => flipGridCell(t, "U3"),
    },
    {
      id: "M9", target: "B-2", wantCodes: "⑨",
      why: "把 §2.1 U3 行的「核销」二字抹掉（只销 §4.2.1 那一头，拆的源头不销）",
      note: "⑨c 两处账对不上。等长替换，长度差为 0 ⇒ 必须靠首个差异位证明真改了",
      mutate: (t) => t.replace("**2026-08-18 核销**：WO-R13-ONTOCHAIN-PANEL", "**2026-08-18 收尾**：WO-R13-ONTOCHAIN-PANEL"),
    },
    {
      id: "M10", target: "B-2", wantCodes: "⑨",
      why: "整行删掉 §4.2.1 里 B-2 的结案记录（判据⑨ 最廉价的死法：没有对象可判 ⇒ 整条自动变绿）",
      note: "⑨e 结案记录消失（棘轮）。**这一条只有在基线里记着 closures 时才会红** —— 它同时在证明那份基线不是摆设",
      mutate: (t) => t.split("\n").filter((l) => !l.trim().startsWith("| **B-2** |")).join("\n"),
    },
  ];

  let bad = 0;
  console.log("\n── 变异反证（每条先证「变异体 ≠ 原文」，再断言判据编号与牵连账**都**对得上）──");
  for (const m of M) {
    const mutated = m.mutate(prdText);
    const d = diffProof(prdText, mutated);
    if (!d) { console.error(`  ✗ ${m.id} 变异体与原文完全相同 —— **锚点没命中，这一条什么都没证**（${m.why}）`); bad++; continue; }
    const prd2 = parseSplitAccounts(mutated);
    const { fail } = judge({ prd: prd2, ontology, wired, chain, baseline, woEvidence: m.evidence ? m.evidence(evWithout) : woEvidence });
    const hitB = [...new Set(fail.map((f) => f.account).filter((a) => a && /^B-\d+$/.test(a)))].sort();
    const codes = [...new Set(fail.map((f) => f.code))].sort().join("");
    const wantB = m.target ? [m.target] : [];
    const okCodes = codes === m.wantCodes;
    const okAim = hitB.join(",") === wantB.join(",");
    const evid = `变异证据：长度差 ${d.dLen} · 首个差异 @${d.at}「${d.was.replace(/\n/g, "⏎")}」→「${d.now.replace(/\n/g, "⏎")}」`;
    if (okCodes && okAim) {
      console.log(`  ✓ ${m.id} ${m.why}`);
      console.log(`      ${evid}`);
      console.log(`      判据 ${codes}（期望 ${m.wantCodes}）· 牵连 ${hitB.join(",") || "（无 B-x，按预期）"}（期望 ${wantB.join(",") || "无"}）· ${m.note}`);
    } else {
      console.error(`  ✗ ${m.id} ${m.why}`);
      console.error(`      ${evid}`);
      console.error(`      判据 ${codes}（期望 ${m.wantCodes}${okCodes ? "" : " ← 不符"}）· 牵连 [${hitB.join(",")}]（期望 [${wantB.join(",")}]${okAim ? "" : " ← 不符"}）`);
      for (const f of fail) console.error(`      · ${f.code}${f.account ? `[${f.account}]` : ""} ${f.msg.slice(0, 110)}`);
      bad++;
    }
  }
  if (bad) {
    console.error(`\n⛔ 变异反证 ${M.length - bad}/${M.length} —— 有 ${bad} 条没打中，本门的判据**没有被证明会红**（装饰品风险）。`);
    process.exit(2); // 门自己没被证明有效 = 工具坏了，不是仓库有问题
  }
  console.log(`\n✓ 变异反证 ${M.length}/${M.length} 全中：判据编号与牵连账**都**与预期逐条相等（既证会红，也证不误伤）。`);
}
