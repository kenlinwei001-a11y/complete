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
 * ══ 七条判据（同时成立才算过 · 每条对应一种真实的死法）═══════════════════════════
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
 *   §4.2 解析出 0 行 / 面板文件抽不出）。2 与 1 处置完全相反：前者只许说「我没查出来」。
 *
 * ══ 诚实边界 ═════════════════════════════════════════════════════════════════
 *  · 本门**不验四条明账的内容对不对**，只有 B-2 是例外且只到必要条件（判据⑤）。
 *    其余三条本门守的是**账本身**：在不在、有没有主、指不指向空气、有没有单。
 *  · 判据③ 的受理方登记表是**写死的**（`RECEIVERS`）—— 新受理方必须同批登记，
 *    否则「出口栏没点名任何已登记的受理方」会红。**这是刻意的**：让「随手写一个新去处」
 *    这件事必须过一次人眼，而不是静悄悄多出一个没人核过的接收方。
 *  · 判据⑤ 的面板文件来自 §4.1 的 U3「**符合**」段（不含「不符合」段），再按**角色**收窄：
 *    只数解析路径落在 `src/views/` 下的页面级组件 —— 共享渲染件（`components/` 下，如
 *    `LayeredDag.tsx`）即便被闭格叙事以叙述性引用带进「符合」段也不是面板，不入数
 *    （WO-SPLITACCOUNT-B2-BASELINE：原代理「只取符合段」已被 U3 闭格叙事击穿，此为把
 *    本注释自陈的意图机械化）。抽不出 ⇒ **RC=2**，不是「没有面板」。
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
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
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
 *            selfClaim:{n:number,m:number}|null, panelFiles:string[]}}
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

  /* §5 优先级表：点名了某条 B-x 且归属栏（末列）非空的行 = 一张可派的单 */
  const dispatch = new Map();
  const dispatchAll = [];
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
  }

  /*
   * §4.1 的 U3「**符合**」段里点名的**面板文件**（判据⑤ 的扫描面，**现算不手抄**）。
   * 两道收窄叠加：①此处刻意只取「符合」那一段（「不符合」段的组件名不进扫描面）；
   * ②`computeChain` 按角色再剔 —— 只数解析到 `src/views/` 下的文件（共享渲染件如
   * `LayeredDag.tsx` 即便被闭格叙事带进「符合」段也只是叙述性引用，不是面板，
   * 收进来会把「共享组件里没有本体链」误当成「某个面板里没有」、并稀释分母）。
   */
  const sec41 = section(md, "### 4.1") ?? "";
  const u3 = sec41.split(/\*\*U3\s/)[1] ?? "";
  const u3Block = u3.split(/\n\*\*U\d/)[0] ?? "";
  const conform = (u3Block.split(/-\s*\*\*不符合/)[0] ?? "");
  const panelFiles = [...new Set([...conform.matchAll(/([A-Z][A-Za-z0-9]*\.tsx)/g)].map((x) => x[1]))].sort();

  return { criteria, carveOuts, accounts, dispatch, dispatchAll, selfClaim, panelFiles };
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
 * @returns {{fail:Array<{code:string,account:string|null,msg:string}>}}
 */
export function judge({ prd, ontology, wired, chain, baseline }) {
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
 * @returns {{panels:number, withChain:number, files:Array<{base:string,path:string|null,counted:boolean,chain:boolean}>}}
 */
export function computeChain(panelFiles, root, readText) {
  const files = panelFiles.map((base) => {
    const path = findFile(root, base);
    /* 判据⑤ 扫描面按角色收窄（WO-SPLITACCOUNT-B2-BASELINE）：**面板 = 解析路径落在
     * `src/views/` 下的页面级组件**。共享渲染件（`components/` 下，如 `LayeredDag.tsx`）
     * 在「符合」段只是闭格叙事的叙述性引用（病灶坐标/渲染件清单），不是面板 —— 原代理
     * 「只取符合段」已被 U3 闭格叙事击穿（该组件现出现在符合段），此处把门头注释自陈的
     * 意图机械化。解析不到（改名/删除/移出 views/）同样不入数 ⇒ 现算读数当场变 ⇒
     * 与基线对不上 ⇒ 门红（「移出扫描面必咬」的变异实录见该单 HANDOFF）。
     * 路径证成（2026-08-18 现算 5 文件）：4 个真面板全在 `views/sim/`，唯一共享件在
     * `components/Dag/` —— 「只数 views/」恰好保留 4 剔 1，零误伤。 */
    const counted = path !== null && /[\\/]views[\\/]/.test(path);
    const chain = counted && path ? CHAIN_MARK.test(stripComments(readText(path))) : false;
    return { base, path, counted, chain };
  });
  return { panels: files.filter((f) => f.counted).length, withChain: files.filter((f) => f.chain).length, files };
}

/* ═══════════════════ 金丝雀（与主判据共用上面那两个函数）══════════════════════ */

const CANARY_MD_OK = [
  "## 2 · 判据表",
  "| # | 判据 | 可机检？ |",
  "|---|---|---|",
  "| **U1** | 改输入即重演 | ✅ |",
  "| **U3** | 过程图 | ✅ |",
  "",
  "### 2.1 判据改写记录",
  "| # | 原措辞 | 缝在一起 | 留哪半 | 挪出去的那半去哪 |",
  "|---|---|---|---|---|",
  "| **U1** | x | y | ① | ② → §4.2 门 B（真浏览器） |",
  "| **U3** | x | y | ① | ②「本体链」→ §4.2（属 R13 溯源链） |",
  "",
  "## 4 · 表",
  "### 4.1 依据",
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
  "| **B-2** | **U3 的「本体链」面** | 多数页无对位实现 | 归 R13 溯源链验收 |",
  "",
  // ↓ 同一节里的**第二张**表，第一列也叫 B-1/B-2 —— 连它一起收会把 2 条账读成 4 条。
  //   这个坑 2026-08-16 真发生过（本门自己写文档时当场踩中），故常驻金丝雀钉住。
  "#### 4.2.1 逐条可机检判定",
  "| # | 能不能机检 | 理由 | 差什么 |",
  "|---|---|---|---|",
  "| **B-1** | 不能 | 运行期量 | 真浏览器 harness |",
  "| **B-2** | 必要条件能 | 可判 | 渲染后读 DOM |",
  "**内容面机检 1/2**（仅 B-2）",
  "",
  "## 5 · 优先级",
  "| 级 | 事项 | 为什么 | 归谁 |",
  "|---|---|---|---|",
  "| P3 | B-1 建真浏览器 harness | 静态够不着 | 一张门单 |",
  "| P3 | B-2 逐字齐全归 R13 | 需渲染 | 一张 R13 单 |",
].join("\n");

/**
 * 必不中样例：六处一起坏（①②③④⑦ 各一处），全部喂给**同一个** `parseSplitAccounts` + `judge`。
 */
const CANARY_MD_BAD = CANARY_MD_OK
  .replace("| **B-1** | **U1 的时延面** | 运行期量 | 真浏览器：断言 DOM 变了 |", "| **B-1** | **U1 的时延面** | 运行期量 | — |")
  .replace("| **B-2** | **U3 的「本体链」面** | 多数页无对位实现 | 归 R13 溯源链验收 |", "| **B-2** | **U99 的面** | 多数页无对位实现 | 以后再说 |")
  .replace("| P3 | B-1 建真浏览器 harness | 静态够不着 | 一张门单 |", "")
  .replace("**内容面机检 1/2**（仅 B-2）", "**内容面机检 2/2**（都验了）");

const FAKE_ONTOLOGY = "…不变量 R13 结论可溯源…";

export function canaries() {
  const bad = [];
  const ok = parseSplitAccounts(CANARY_MD_OK);
  const notok = parseSplitAccounts(CANARY_MD_BAD);

  /* ①必中：解析器认得出合法的账（2 条账 · 2 条外移 · 2 条判据 · 2 张单 · 自陈 1/2 · 面板文件只取「符合」段） */
  if (!(ok.accounts.length === 2 && ok.carveOuts.length === 2 && ok.criteria.size === 2 &&
        ok.dispatch.size === 2 && ok.selfClaim?.n === 1 && ok.selfClaim?.m === 2 &&
        ok.panelFiles.join(",") === "FakePanelView.tsx")) {
    bad.push(`①必中样例：accounts=${ok.accounts.length} carveOuts=${ok.carveOuts.length} criteria=${ok.criteria.size} dispatch=${ok.dispatch.size} selfClaim=${JSON.stringify(ok.selfClaim)} panelFiles=[${ok.panelFiles.join(",")}]（应为 2/2/2/2/{1,2}/[FakePanelView.tsx]）`);
  }
  /* ①b 必不中：`LayeredDag.tsx` 在「不符合」段，**不许**被收进面板文件 —— 收进来会把
   *      「共享组件里没有本体链」误当成「某个面板里没有」（那正是代理指标那一族病）。 */
  if (ok.panelFiles.includes("LayeredDag.tsx")) {
    bad.push("①b 必不中样例：`LayeredDag.tsx`（§4.1「不符合」段的共享组件）被误收进面板文件");
  }
  /* ①c 必不中：§4.2.1 的第二张表（第一列同样是 B-1/B-2）**不许**被算成明账。
   *      样例里两张表各 2 行；若解析器把两张都收了，`accounts` 会是 4 —— 上面 ①必中
   *      的 `accounts.length === 2` 就会当场报红。这条只再钉一次「重复 id」这个更刺眼的形态。 */
  if (new Set(ok.accounts.map((a) => a.id)).size !== ok.accounts.length) {
    bad.push(`①c 必不中样例：明账 id 有重复（${ok.accounts.map((a) => a.id).join(",")}）—— §4.2.1 的第二张表被误收成了明账`);
  }

  /* ②必中：合法账全绿 */
  const jOk = judge({
    prd: ok, ontology: FAKE_ONTOLOGY, wired: true,
    chain: { panels: 1, withChain: 0 },
    baseline: { accounts: { "B-1": { us: ["U1"], receivers: ["门 B（本门 · 真浏览器那一面尚未具备）"] }, "B-2": { us: ["U3"], receivers: ["R13 溯源链（本体不变量）"] } }, chain: { panels: 1, withChain: 0 } },
  });
  if (jOk.fail.length !== 0) bad.push(`②必中样例：合法账应零违规，实得 ${jOk.fail.length} 条 → ${jOk.fail.map((f) => f.code + (f.account ? "/" + f.account : "")).join(" ")}`);

  /* ③必不中：六处坏账必须被逐条抓到，且**红在对应那条上** */
  const jBad = judge({ prd: notok, ontology: FAKE_ONTOLOGY, wired: true, chain: { panels: 1, withChain: 0 }, baseline: null });
  const codes = new Set(jBad.fail.map((f) => f.code));
  const want = ["①", "②", "③", "④", "⑦"];
  for (const c of want) if (!codes.has(c)) bad.push(`③必不中样例：判据${c} 没有被抓到（实得 ${[...codes].join("")}）`);
  if (!jBad.fail.some((f) => f.account === "B-1" && f.code === "①")) bad.push("③必不中样例：B-1 的空栏没有红在 B-1 上");
  if (!jBad.fail.some((f) => f.account === "B-2" && f.code === "③")) bad.push("③必不中样例：B-2 的未登记受理方没有红在 B-2 上");

  /* ④受理方登记表真的会拒绝不存在的受理方（R13 从本体里消失 ⇒ B-2 的出口指向空气） */
  const jNoR13 = judge({ prd: ok, ontology: "（本体里没有那条不变量）", wired: true, chain: { panels: 1, withChain: 0 }, baseline: null });
  if (!jNoR13.fail.some((f) => f.code === "③" && f.account === "B-2")) bad.push("④受理方存在性：R13 从本体里消失时，B-2 的出口没有被判为指向空气");

  /* ⑤自指接线证明：本门没接进 gates 串时，「归门 B」那条必须红 */
  const jUnwired = judge({ prd: ok, ontology: FAKE_ONTOLOGY, wired: false, chain: { panels: 1, withChain: 0 }, baseline: null });
  if (!jUnwired.fail.some((f) => f.code === "③" && f.account === "B-1")) bad.push("⑤自指接线证明：门未接线时「归门 B」那条没有红");

  /* ⑥判据⑤ 的现算方向：对位实现过半 ⇒ B-2 账面理由不再成立 */
  const jChain = judge({ prd: ok, ontology: FAKE_ONTOLOGY, wired: true, chain: { panels: 2, withChain: 2 }, baseline: null });
  if (!jChain.fail.some((f) => f.code === "⑤" && f.account === "B-2")) bad.push("⑥判据⑤：对位实现过半时 B-2 账面理由没有被判为不成立");

  /* ⑦剥注释：注释里写的「本体链」不算对位实现 */
  if (CHAIN_MARK.test(stripComments("// 这里以后要渲染本体链\nconst x = 1;"))) bad.push("⑦剥注释：注释里的「本体链」被当成了对位实现");
  if (!CHAIN_MARK.test(stripComments("const label = \"本体链\";"))) bad.push("⑦剥注释：真代码里的「本体链」被剥掉了");

  const bd = baselineDocCanary();
  if (!bd.ok) bad.push(`⑧基线写入器：${bd.got}`);

  /* ⑨判据⑤ 扫描面按角色收窄（WO-SPLITACCOUNT-B2-BASELINE）—— 与主流程**共用同一个
   *      computeChain**：造一棵假树，两个组件名一个解析到 `views/`、一个解析到
   *      `components/`，只有前者入数。少了这条，角色收窄这条新规则本身退化（正则写反、
   *      误伤 views/）没有任何东西先说话。 */
  {
    const fakeRoot = mkdtempSync(join(tmpdir(), "splitaccount-canary9-"));
    try {
      mkdirSync(join(fakeRoot, "views"), { recursive: true });
      mkdirSync(join(fakeRoot, "components"), { recursive: true });
      writeFileSync(join(fakeRoot, "views", "FakePanel.tsx"), "export const a = 1;");
      writeFileSync(join(fakeRoot, "components", "FakeShared.tsx"), "export const b = 2;");
      const c9 = computeChain(["FakePanel.tsx", "FakeShared.tsx"], fakeRoot, (p) => readFileSync(p, "utf8"));
      const panel = c9.files.find((f) => f.base === "FakePanel.tsx");
      const shared = c9.files.find((f) => f.base === "FakeShared.tsx");
      if (!(c9.panels === 1 && panel?.counted === true && shared?.counted === false)) {
        bad.push(`⑨扫描面角色收窄：views/FakePanel 应入数、components/FakeShared 应剔（实得 panels=${c9.panels} panel.counted=${panel?.counted} shared.counted=${shared?.counted}）`);
      }
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  }

  return { ok: bad.length === 0, bad };
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
  console.log("✅ 金丝雀 9/9（必中账 · 必不中账六处逐条对位 · 共享组件不许混进面板文件 · 受理方存在性 · 自指接线 · 判据⑤方向 · 剥注释双向 · 基线写入器 · 判据⑤扫描面角色收窄）");
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
    return;
  }

  if (flag("--seed") || flag("--tighten")) {
    const bc = baselineDocCanary();
    if (!bc.ok) toolBroken(`基线写入器金丝雀不过（${bc.got}）`, `期望：${bc.want}`);
    const accounts = {};
    for (const a of prd.accounts) {
      accounts[a.id] = { us: a.us, receivers: RECEIVERS.filter((r) => r.re.test(a.need)).map((r) => r.name) };
    }
    writeFileSync(resolve(process.cwd(), BASELINE), JSON.stringify(buildBaselineDoc({
      prev: baseline,
      generatedBy: `node scripts/${SELF} ${flag("--seed") ? "--seed" : "--tighten"}`,
      prose: {
        note:
          "harness-ux-splitaccount 棘轮基线：`docs/PRD-harness-ux-adoption.md` §4.2 的 B-x 明账快照。" +
          "记的是每条账**认领的判据**与**受理方**，以及判据⑤ 的现算读数。销账 / 改绑 / 改口 / 新账" +
          "一律要显式跑 `--tighten` —— 明账最危险的死法不是被推翻，是**没人注意到它没了**。" +
          "`accounts`/`chain` 归机器算，本 note 与任何人手新增的顶层键归人手（scripts/lib/baseline-doc.mjs 保证不吞人话）。",
      },
      computed: { accounts, chain: { panels: chain.panels, withChain: chain.withChain } },
    }), null, 2) + "\n");
    console.log(`✍️  基线已写：${BASELINE}（明账 ${Object.keys(accounts).length} 条 · 面板文件 ${chain.panels} · 有对位实现 ${chain.withChain}）`);
    return;
  }

  if (flag("--mutation-proof")) { mutationProof({ prdText, ontology, wired, chain, baseline }); return; }

  /* ── 门本体 ─────────────────────────────────────────────────────────────── */
  const { fail } = judge({ prd, ontology, wired, chain, baseline });

  console.log(`· §4.2 明账 ${prd.accounts.length} 条：${prd.accounts.map((a) => `${a.id}(${a.us.join("+")})`).join(" ")}`);
  console.log(`· §2.1 外移 ${prd.carveOuts.length} 条 → 认领 ${new Set(prd.accounts.flatMap((a) => a.us)).size} 条 · §5 已派单 ${prd.dispatch.size}/${prd.accounts.length}`);
  console.log(`· 判据⑤ 现算：面板文件 ${chain.panels} · 有「本体链」对位实现 ${chain.withChain}${unresolved.length ? `（${unresolved.length} 个文件名找不到，未计入）` : ""}`);
  console.log(`· 内容面机检 ${prd.accounts.filter((a) => CONTENT_CHECKED.has(a.id)).length}/${prd.accounts.length}（自陈 ${prd.selfClaim ? `${prd.selfClaim.n}/${prd.selfClaim.m}` : "缺"}）· 本门已接线 ${wired ? "是" : "否"}`);
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
  console.log("\n🟢 harness-ux-splitaccount:check 通过（账形态完整 · 双向绑定无孤儿无悬空 · 受理方均存在 · 每条账有单 · B-2 账面理由现算属实 · 无静默销账 · 自陈未超发）。");
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
function mutationProof({ prdText, ontology, wired, chain, baseline }) {
  const M = [
    {
      id: "M1", target: "B-1", wantCodes: "①⑥",
      why: "把 B-1 的「要判它得有什么」挖成 `—`（明账写成填空题）",
      note: "①空栏 + ⑥改口（受理方随之消失）。③**刻意不触发** —— 栏已空时 ③ 主动跳过，免得同一处坏账被报两遍",
      mutate: (t) => t.replace("| 真浏览器：改一个输入、**不点任何按钮**，断言结果 DOM 在 N 毫秒内变了 |", "| — |"),
    },
    {
      id: "M2", target: "B-2", wantCodes: "③⑥",
      why: "把 B-2 的受理方从「R13 溯源链」改成一个没登记的去处",
      note: "③出口没点名任何已登记受理方 + ⑥改口",
      mutate: (t) => t.replace("| 归 R13 溯源链验收，不在本表射程 |", "| 以后再说 |"),
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
      id: "M5", target: "B-2", wantCodes: "②⑥⑦",
      why: "整行删掉 B-2（明账最危险的死法：没人注意到它没了）",
      note: "②正向（U3 挪走了却没人认领）+ ⑥销账 + ⑦分母 4→3。**⑦跟着红是对的**：账少了一条，自陈的分母就不再属实",
      mutate: (t) => t.split("\n").filter((l) => !l.trim().startsWith("| **B-2** |")).join("\n"),
    },
    {
      id: "M6", target: null, wantCodes: "⑦",
      why: "把自陈从「内容面机检 1/4」改成 4/4（门建成之后最可能发生的那件事）",
      note: "**等长替换 ⇒ 长度差为 0**，所以这一条的「变异体≠原文」必须靠首个差异位来证，不能靠字节数",
      mutate: (t) => t.replace(/内容面机检\s*1\s*\/\s*4/, "内容面机检 4/4"),
    },
  ];

  let bad = 0;
  console.log("\n── 变异反证（每条先证「变异体 ≠ 原文」，再断言判据编号与牵连账**都**对得上）──");
  for (const m of M) {
    const mutated = m.mutate(prdText);
    const d = diffProof(prdText, mutated);
    if (!d) { console.error(`  ✗ ${m.id} 变异体与原文完全相同 —— **锚点没命中，这一条什么都没证**（${m.why}）`); bad++; continue; }
    const prd2 = parseSplitAccounts(mutated);
    const { fail } = judge({ prd: prd2, ontology, wired, chain, baseline });
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
