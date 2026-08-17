#!/usr/bin/env node
/**
 * 门 `layout-legibility:check` · **版面门**（WO-SANDBOX-LAYOUT-HARNESS）
 *
 * ══ 病因（仓主 2026-08-17 看推演沙盘部署截图后原话）════════════════════════════
 *   > **「这是你最终的推演沙盘的UI，UX吗？」**
 *
 * 根因不在那一页，在**门的分布**：本仓 62 道门**全部在守「信息诚实」**
 * （数从哪来 · 有没有假绿 · 承诺有没有撑），**一道都不守「版面」**。
 * 于是「字太小 / 一屏塞几十行 / 控件不对齐 / 视口利用率低」这些
 * **用户第一眼就看见的问题**，在机器眼里完全不存在 —— 没有任何信号会红。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『62 道门全绿』当作『这一屏能看』的证据，而前者并不度量后者。」**
 *
 * ══ 与既有两道门的分工（不是重复造轮子）══════════════════════════════════════
 *  · `check-ui-first-layer.mjs` —— **静态 AST**：数源码里第一层有几个信息块、字号层级几级。
 *    量的是**作者写了什么**。
 *  · `check-text-legibility.mjs` —— **静态调色板**：颜色对比度 × 字号的加权公式。
 *    量的是**颜色够不够亮**。
 *  · **本门** —— **真 Chromium 布局后逐元素量几何**：字号实际渲染成几 px、
 *    一屏落进来几个控件、内容横向占了多少、同组行的左边缘是不是一条竖线、有没有横向溢出。
 *    量的是**浏览器把它排成了什么样**。三者互不覆盖：前两者全绿而这一屏仍然可以不能看。
 *
 * ══ ⚠ 诚实订正：仓里**不是**「零渲染 harness」════════════════════════════════
 * `docs/PRD-harness-ux-adoption.md` §4.2.1 的 B-1/B-4 原写「差一个能渲染真页面的 harness」。
 * 本单实测：`scripts/ui-smoke-*.mjs` 共 **12 个**脚本早就用 playwright 渲染真页面。
 * 真实缺口是**两条**，不是「没有」：
 *   ① 它们**一律 SKIP 成 exit 0**（`ui-smoke-sandbox.mjs:38` 原文
 *      「无 chromium/playwright-core → SKIP(exit 0)」）—— 渲染不出来时报「通过」，
 *      正是本仓最恨的假绿；
 *   ② 它们断言的是**行为**（点 tick、值变没变），**没有一个量几何**。
 * 本门补的就是这两条。**故本门渲染失败一律 RC=2（工具坏了），永不 SKIP 成 0。**
 * ⇒ 运维后果要当面说清：本门进 `gates` 串后，**没有 Chromium 的环境跑 gates 会停在这里并报 RC=2**。
 *   那是**设计意图**，不是故障：RC=2 的含义是「我没查出来」，而不是「你的代码有问题」，
 *   更不是「版面合格」。要跑 gates 就得有浏览器 —— 本容器已预置 `/opt/pw-browsers`。
 *
 * ══ 六项判据（取数方法逐条写在 `scripts/lib/layout-probe.mjs` 的 `measureLayout` 里）══
 *   M1 minFontPx        最小可见字号(px)          ↑只许升
 *   M2 bodyFontPx       正文字号·众数(px)         ↑只许升
 *   M3 firstScreenCtrls 单屏可见交互控件数         ↓只许降
 *   M4 viewportUsePct   视口利用率(%)             ↑只许升
 *   M5 misalignedGroups 左边缘未对齐的行组数       ↓只许降
 *   M6 overflowPx       横向溢出(px)              ↓只许降
 * **两个视口各量一组**（1440×900 / 1280×800）。只量宽屏会漏掉「窄屏挤成一团」，
 * 而部署机未必是宽屏。
 *
 * ══ 阈值是怎么定的（⚠ 不许直接抄参照物的数）════════════════════════════════
 * 参照物 `venture_twin_v2_7.html`（仓主给的另一个产品的一屏）可量到的数：
 *   `body 13.5px` · `.nrow label 11.5px` · `small 10px` · `.page max-width 1520px`
 *   · `.cfg grid 1fr 1fr / gap 18px` · `.nrow grid 1fr 88px 42px / gap 6px`
 * 它是**另一个产品**的一屏，信息密度未必与本页相同，**直接抄成阈值是拿别人的合身当自己的合身**。
 * 故本门只对「数值本身无歧义、且改动权在本单范围内」的项设**绝对下限**，
 * 其余一律**只做棘轮**（只许变好），并逐条写明为什么：
 *
 *  | 项 | 改前实测 | 参照物 | 本门取值 | 为什么取在这 |
 *  |---|---|---|---|---|
 *  | minFontPx | **10** | 10（`small`） | 下限 **12** | ⚠ 这一项**故意不取在「现值与参照值之间」**，理由要当面说清：参照物那 10px `small` 装的是**拉丁数字与单位**，本页那 12 个装的是**中文**（「/ 吨」「/ 套/天」）—— 同一个数字在两种字形下不是同一件事，「取中间」在这里没有意义。真正的锚点在**本仓自己身上**：`check-text-legibility.mjs` 的 `FLOOR_PX = 12`，而它文件头写明这个 12 **不是自由参数，是它判据 A 与本仓调色板的交点**（换调色板交点自己会动）。用本仓已有的、可推导的硬底，强过用另一个产品的一个数。改后本页实测最小值恰为 **12**（余下的 12px 元素来自 `InfoPopover`/`global.css` 等本单范围外的组件）。 |
 *  | bodyFontPx | **12**（占 92.2%） | 13.5（`body`） | 下限 **13** | 本页 602 个文本元素里 **555 个是 12px**——仓主说的「字太小」指的是**这 92%**，不是那 12 个 `small`。13 严格落在 12 与 13.5 之间；且 13px **本来就在本页调色板里**（改前已有 21 个元素用它），不是我发明的一个数。 |
 *  | overflowPx | 0 | —— | 上限 **0** | 硬判据无争议：页面出现横向滚动条 = 版面破了。改前已是 0 ⇒ 设成 0 是把现状**锁死**。 |
 *  | misalignedGroups | 0 | 三段固定栅格 | 上限 **0** | 同上：改前已经是 0（本页重复行组确实都对齐），设 0 锁死，别人加一组参差的行立刻红。 |
 *  | firstScreenCtrls | 50 / 49 | 每 chip 展开 5–8 行 | **只棘轮，不设绝对上限** | 参照物「5–8 行」是**它的 IA**（整页无左侧导航、分类 chip 逐个展开）。把 50 压到 8 需要重排信息架构 —— 那是 `WO-SANDBOX-NAV-CONSOLIDATE` / `WO-SANDBOX-STRUCTURE` 的活，不在本单范围。硬设一个够不着的上限只会逼出豁免。 |
 *  | viewportUsePct | 79.7 / 77.1 | `max-width:1520px` 且**整页无左导航** | **只棘轮，不设绝对下限** | 本页天花板被**外壳左导航 248px** 卡住（1440 视口下内容区最多 82.8%），而 `pages/ShellLayout.tsx` 不在本单范围。设一个由别人决定的下限 = 把别人的改动记在本页账上。 |
 *
 * ══ 棘轮与「不许奖励删内容」══════════════════════════════════════════════════
 * 每页每视口存一份基线，**只许变好不许变坏**。收紧基线要显式 `--tighten`；
 * `--update` **不是日常操作**（本仓发生过 `--update` 悄悄把 87 抬到 94、买来一片绿）。
 * ⚠ 光有棘轮会**奖励删除**：把一整块内容删掉，`firstScreenCtrls` 立刻变好、
 * `misalignedGroups` 也可能归零 —— 与 `check-ui-first-layer.mjs` D4 判据同一个坑。
 * 故本门另有两条**守恒**判据（C1/C2，见 `conservation()`）：
 *   C1 `misalignedGroups` 变好时 `rowGroups`（分母）不许同时下降；
 *   C2 任一「越小越好」的项变好时，`textEls`（页面总墨迹量）不许跌超过 10%。
 * 触发即红，提示语直指「疑似删内容冒充版面变好」。
 *
 * ══ 金丝雀（保命判据 · 每次运行都先跑）════════════════════════════════════════
 * 与主逻辑**共用同一份** `measureLayout`（不另抄一份逻辑 —— 抄了就是装饰品，
 * 改主逻辑时金丝雀拿旧的去测、照样绿；CLAUDE.md 铁律 0.6 实测过）。**双侧**：
 *   · **必咬**：造一页 8px 字 + 横向溢出 + 参差行组 ⇒ 三项都必须被量出来；
 *   · **必不咬**：造一页 14px 字、无溢出、行组对齐 ⇒ 一项都不许报。
 * ⚠ 金丝雀只证明**工具没瞎**，**不证明扫描面选对**。故另有**独立口径**：
 *   量到的文本元素数 < `TEXT_ELS_FLOOR` ⇒ 判「页面没渲染出来」⇒ **RC=2**，而不是「合格」。
 *
 * ══ 退出码（三分）════════════════════════════════════════════════════════════
 *   0 干净 · 1 **真变坏 / 触底** · 2 **工具自己坏了**（含：渲染不出来、找不到浏览器、
 *   dev server 起不来、页面没稳定、独立口径不过）。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 G-LAYOUT-UNGATED。
 * 门账：scripts/gate-ledger.json。
 *
 * 用法：
 *   node scripts/check-layout-legibility.mjs             # 门
 *   node scripts/check-layout-legibility.mjs --report    # 只打印实测数，不判定
 *   node scripts/check-layout-legibility.mjs --selftest  # 金丝雀（不起 dev server，秒级）
 *   node scripts/check-layout-legibility.mjs --tighten   # 把基线收紧到本次实测（只许变好）
 *   node scripts/check-layout-legibility.mjs --update    # 重写基线（放宽也写；⚠ 非日常操作）
 *
 * 环境：
 *   LAYOUT_PROBE_URL=http://127.0.0.1:5188/   已有 dev server 时直接用它（跳过自起）
 *   PLAYWRIGHT_CHROMIUM=/path/to/chrome       浏览器不在默认位置时直接指过去
 */

/* ── 兜底必须**最先**注册：它要覆盖的正是「后面任何一行崩了」。
 *    实测（node v22）：顶层同步 throw 走 uncaughtException，顶层 await 之后的 throw
 *    走 unhandledRejection —— 两个都要挂，只挂一个有洞。 */
process.on("uncaughtException", (e) => bail(e));
process.on("unhandledRejection", (e) => bail(e));
function bail(e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";
// ⚠ 页名册**从 PRD 的 §4 表现读**，不在本文件里手抄一份。
//   本仓已有一道门专治手抄名册（`check-gate-roster-handcopied.mjs`），
//   而 `check-edge-active-mounts.mjs` 的手抄 `PAGES` 数组漏页正是它的来历。
//   复用 `parsePrdTable` ⇒ 表里加一页，survey 自动覆盖，不会漏。
import { parsePrdTable } from "./check-sim-ux-criteria.mjs";
import {
  METRICS,
  TEXT_ELS_FLOOR,
  ProbeBroken,
  launchBrowser,
  renderAndMeasure,
  measureHtml,
} from "./lib/layout-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASELINE = join(ROOT, "scripts", "layout-legibility-baseline.json");

let exiting = false;
function toolBroken(msg, extra = "") {
  if (exiting) return;
  exiting = true;
  console.error(`\n⛔ layout-legibility 工具坏了（RC=2 · 只许说「我没查出来」，不许说「版面合格」）`);
  console.error(`   ${msg}`);
  if (extra) console.error(`   ${extra}`);
  process.exit(2);
}

// ───────────────────────────────────────────────────────────────────────────────
// 绝对阈值（为什么取这些数，见文件头那张表；不许直接抄参照物）
// ───────────────────────────────────────────────────────────────────────────────
const FLOORS = {
  minFontPx: { cmp: "min", value: 12, why: "取本仓自己的 12px 硬底（check-text-legibility 的 FLOOR_PX，是它判据 A 与本仓调色板的交点、非自由参数），不取参照物的 10px —— 参照物那 10px 装拉丁单位，本页那 10px 装中文（「/ 吨」「/ 套/天」）。" },
  bodyFontPx: { cmp: "min", value: 13, why: "本页 92.2% 的文本是 12px；参照物 body 13.5px。13 严格落在两者之间，且 13px 改前已在本页调色板里。" },
  overflowPx: { cmp: "max", value: 0, why: "横向滚动条 = 版面破了，硬判据无争议；改前已是 0，设 0 即锁死现状。" },
  misalignedGroups: { cmp: "max", value: 0, why: "改前实测 0（本页重复行组确实都对齐），设 0 锁死；别人加一组参差的行立刻红。" },
  // ⚠ 只有「真够不着」的才设绝对上限；「溢出总数」走棘轮（见 RATCHET_ONLY 与 METRICS 的注释）。
  overflowUnreachable: { cmp: "max", value: 0, why: "内容被裁死、用户既滚不到也点不着 = 真丢内容，无争议的硬判据。注意它与「溢出总数」是两个数：总数>0 只说明要横滚才看得见（走棘轮），这一项>0 才是够不着。" },
};
// 只做棘轮、不设绝对阈值的项 —— 每条都必须写清「为什么不设」，否则就是偷偷放水。
const RATCHET_ONLY = {
  firstScreenCtrls: "压到参照物那种「5–8 行」要重排信息架构，属 WO-SANDBOX-NAV-CONSOLIDATE / -STRUCTURE，不在本单范围；硬设够不着的上限只会逼出豁免。",
  viewportUsePct: "天花板被外壳左导航（248px）卡住（1440 视口下内容区最多 82.8%），而 pages/ShellLayout.tsx 不在本单范围；设一个由别人决定的下限 = 把别人的改动记在本页账上。",
  overflowEls:
    "「溢出视口」在本仓不等于「坏」：横向表格 / 时间轴刻度尺天生比视口宽，躺在可横滚容器里是**正常设计**。" +
    "设绝对上限会把这类正常设计一律判红、逼出豁免。但也不能不管 —— **「够得着」不等于「好用」**，" +
    "要横滚才看得见的内容正是「第一层看不到重点」。⇒ 折中：总数**只许降**（棘轮），" +
    "真够不着的那部分（overflowUnreachable）另设绝对上限 0。",
};

const CONSERVATION_TEXT_DROP_PCT = 10; // C2：墨迹量跌超过它即判「疑似删内容」

// ───────────────────────────────────────────────────────────────────────────────
// 金丝雀 —— 与主逻辑共用同一份 measureLayout（双侧：必咬 / 必不咬）
// ⚠ 样例形状取自生产实物：`.dimGroup > .dimHead > b` 是沙盘左栏「范围」的真实结构，
//   `small` 装单位、`.opt` 是复选框行 —— 都是本页真有的形状，不是编的。
// ───────────────────────────────────────────────────────────────────────────────
/* 必咬样例。三处形状**逐个取自生产实物**（`SandboxConsole.module.css` / `.tsx`），不是编的：
 *   · `.dimGroup > .dimHead > b` + `small` 装单位 —— 左栏「范围」的真实结构，`small` 就是那 12 个 10px 的出处；
 *   · `.optList > label.opt > input + span` —— 基地复选框行的真实结构（同一个类反复出现 = 真「行组」）；
 *   · 参差是靠**中间多包一层缩进壳**造出来的，这正是 React 里行错位的真实成因
 *     （不是给某一行手写 padding —— 那种写法现实中很少见，拿它当样例证不了什么）。 */
const CANARY_BITE = `
<style>
 body{margin:0;font:12px/1.5 system-ui;width:100%}
 .pane{width:1200px}
 .dimGroup{padding:6px 9px}
 .dimHead b{font:700 12px monospace}
 small{font-size:8px}
 .opt{display:flex;align-items:center;gap:6px;padding:2px 0}
 .ind1{display:inline-block;padding-left:16px}
 .ind2{display:inline-block;padding-left:32px}
 .wide{width:2400px;height:20px;background:#eee}
 /* 「真够不着」的样例：外层 overflow-x:hidden 裁死，用户既滚不到也点不着。
    与 .wide 刻意成对 —— .wide 是「溢出但够得着」，这个是「溢出且够不着」，
    两个样例合起来才证明门分得开这两件事（只有一个样例证明不了「分得开」）。
    ⚠ 本注释里不许出现反引号：整个样例是模板字符串，反引号会把它截断
      （本单实测踩过，当场 RC=2）。 */
 .clip{width:1100px;overflow-x:hidden}
 .clipped{width:2400px;height:20px;background:#ddd}
</style>
<main><div class="pane">
  <div class="dimGroup"><div class="dimHead"><b>基地</b><small>/ 吨</small></div></div>
  <div class="optList">
    <label class="opt"><input type="checkbox"><span>常州</span></label>
    <label class="opt"><span class="ind1"><input type="checkbox"></span><span>溧阳</span></label>
    <label class="opt"><span class="ind2"><input type="checkbox"></span><span>成都</span></label>
  </div>
  <div class="wide">溢出块</div>
  <div class="clip"><div class="clipped">被裁死的溢出块</div></div>
</div></main>`;

/* 必不咬样例：同样的 `.opt` 行组，但**不包缩进壳** ⇒ 三行左边缘同一条竖线；字号 14px；无溢出。 */
const CANARY_CLEAN = `
<style>
 body{margin:0;font:14px/1.6 system-ui;width:100%;overflow-x:hidden}
 main{width:100%}
 .opt{display:flex;align-items:center;gap:6px;padding:2px 0}
</style>
<main>
  <div class="optList">
    <label class="opt"><input type="checkbox"><span>常州</span></label>
    <label class="opt"><input type="checkbox"><span>溧阳</span></label>
    <label class="opt"><input type="checkbox"><span>成都</span></label>
  </div>
  <p>正文一段</p>
</main>`;

async function runCanary(browser) {
  const vp = { width: 1440, height: 900 };
  const bite = await measureHtml(browser, CANARY_BITE, vp, "main");
  const clean = await measureHtml(browser, CANARY_CLEAN, vp, "main");
  const problems = [];
  // 必咬三件事
  if (!bite.ok) problems.push("必咬样例的扫描根都没命中");
  else {
    if (!(bite.minFontPx <= 8)) problems.push(`必咬样例的 8px 字号没被量出来（量到 ${bite.minFontPx}）`);
    if (!(bite.overflowPx > 0)) problems.push(`必咬样例的横向溢出没被量出来（量到 ${bite.overflowPx}）`);
    if (!(bite.misalignedGroups >= 1)) problems.push(`必咬样例的参差行组没被量出来（量到 ${bite.misalignedGroups}）`);
    // 溢出的两个数**必须分得开**：样例里刻意各放一个。
    // 只断言总数 ≥2 证明不了「分得开」—— 那正是「把 415 合成一个数」的病。
    if (!(bite.overflowEls >= 2)) problems.push(`必咬样例的溢出元素没被数全（应 ≥2：一个够得着 + 一个够不着，量到 ${bite.overflowEls}）`);
    if (!(bite.overflowUnreachable >= 1)) problems.push(`必咬样例里被 overflow-x:hidden 裁死的那个「够不着」没被认出来（量到 ${bite.overflowUnreachable}）`);
    if (!(bite.overflowEls > bite.overflowUnreachable)) {
      problems.push(
        `必咬样例的两个数没分开：总数 ${bite.overflowEls} 应**严格大于**够不着数 ${bite.overflowUnreachable}` +
          `（样例里 .wide 是「溢出但够得着」、.clipped 是「溢出且够不着」；两者相等 ⇒ 门把两件事合成了一件）。`,
      );
    }
  }
  // 必不咬
  if (!clean.ok) problems.push("必不咬样例的扫描根都没命中");
  else {
    if (clean.minFontPx < 11) problems.push(`必不咬样例被误报小字（${clean.minFontPx}）`);
    if (clean.overflowPx > 0) problems.push(`必不咬样例被误报溢出（${clean.overflowPx}）`);
    if (clean.misalignedGroups > 0) problems.push(`必不咬样例被误报参差（${clean.misalignedGroups}）`);
    if (clean.overflowEls > 0) problems.push(`必不咬样例被误报溢出元素（${clean.overflowEls}）`);
    if (clean.overflowUnreachable > 0) problems.push(`必不咬样例被误报「够不着」（${clean.overflowUnreachable}）`);
  }
  return { problems, bite, clean };
}

// ───────────────────────────────────────────────────────────────────────────────
// dev server（mock 模式 · 零后端依赖 ⇒ 数据确定、可复现）
// ───────────────────────────────────────────────────────────────────────────────
async function waitForServer(url, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function startDevServer() {
  const port = Number(process.env.LAYOUT_PROBE_PORT || 5187);
  const url = `http://127.0.0.1:${port}/`;
  const cwd = join(ROOT, "apps", "frontend-shell");
  if (!existsSync(join(cwd, "node_modules"))) {
    throw new ProbeBroken(
      `apps/frontend-shell/node_modules 不存在 —— 先 \`pnpm install --prefer-offline\`。` +
        `（这属环境缺件，不是版面问题，故 RC=2。）`,
    );
  }
  const child = spawn(
    "node",
    [join(cwd, "node_modules", "vite", "bin", "vite.js"), "--port", String(port), "--strictPort"],
    { cwd, env: { ...process.env, VITE_MOCK: "1" }, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let log = "";
  child.stdout.on("data", (d) => (log += String(d)));
  child.stderr.on("data", (d) => (log += String(d)));
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* 已经没了 */
    }
  };
  if (!(await waitForServer(url))) {
    stop();
    throw new ProbeBroken(`前端 dev server（mock 模式）60s 内没起来。\n   vite 输出：${log.slice(-600)}`);
  }
  return { url, stop };
}

// ───────────────────────────────────────────────────────────────────────────────
// 被测页册（本单只铺一页 —— 一天硬铺 12 页产出的会是 12 个装饰件）
// ───────────────────────────────────────────────────────────────────────────────
const VIEWPORTS = [
  { key: "1440x900", width: 1440, height: 900 },
  { key: "1280x800", width: 1280, height: 800 },
];

const PAGES = [
  {
    id: "sim-sandbox",
    title: "推演沙盘主页",
    route: "/v/sim-sandbox",
    // 扫描根 = 外壳内容区。**不含左侧导航**：导航属 pages/ShellLayout.tsx，
    // 与本页不是同一个交付单元，算进来会让「换一个页面」与「改一次导航」在同一个数上互相污染。
    rootSelector: "main",
    login: { tenant: "demo", username: "planner", password: "demo1234" },
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// U10「版面」逐页普查（--survey）
//
// ⚠ **普查 ≠ 门**，两者刻意不同，混了就会得出错的排期：
//   · **门**（棘轮基线）只盯 `PAGES` 里那一页 —— 本单的任务是「造一把尺子并证明它有牙」，
//     一天硬铺 12 页棘轮，产出的会是 12 个没人维护的装饰件。
//   · **普查**跑满 12 页，是为了给 `docs/PRD-harness-ux-adoption.md` §4 的 **U10 列**
//     逐格填**实测数**（那张表的规矩是「不许手数、以机器为准」）。
//
// 判据（三条全过才算「符合」，逐条都是本门已有的量，不新发明）：
//   ① minFontPx ≥ 12        —— 与 FLOORS.minFontPx 同一个数、同一个来历
//   ② overflowPx = 0        —— 页面级横向滚动条
//   ③ overflowUnreachable=0 —— 真够不着的内容（**不是** overflowEls；两者分开报）
// ⚠ 渲染不出来的页一律记 `判不了` 并让本模式 **RC=2** —— 不许把「没量到」填成「符合」。
// ───────────────────────────────────────────────────────────────────────────────
const U10_RULE = "minFontPx ≥ 12 ∧ overflowPx = 0 ∧ overflowUnreachable = 0";

function u10Verdict(m) {
  if (!m) return { state: "判不了", why: "页面没渲染出来 —— 不许填成「符合」" };
  const bad = [];
  if (!(m.minFontPx >= 12)) bad.push(`最小字号 ${m.minFontPx}px < 12`);
  if (!(m.overflowPx === 0)) bad.push(`横向溢出 ${m.overflowPx}px`);
  if (!(m.overflowUnreachable === 0)) bad.push(`够不着的元素 ${m.overflowUnreachable} 个`);
  return bad.length ? { state: "不符合", why: bad.join(" · ") } : { state: "符合", why: U10_RULE };
}

function prdPageKeys() {
  const md = readFileSync(join(ROOT, "docs", "PRD-harness-ux-adoption.md"), "utf8");
  const prd = parsePrdTable(md);
  const keys = prd.rows.map((r) => r.key);
  // 金丝雀：名册解析器自证。表里必有沙盘那一页；解析不到 ⇒ 报「工具坏了」，
  // **不许**报「表里没有页」（铁律 0.6：否定结论必须附金丝雀命中证据）。
  if (!keys.includes("sim-sandbox") || keys.length < 5) {
    throw new ProbeBroken(
      `页名册解析器金丝雀不中：从 PRD §4 表只解析到 ${keys.length} 页（${keys.join(",") || "空"}），` +
        `且必中项 sim-sandbox ${keys.includes("sim-sandbox") ? "在" : "不在"}里面。` +
        `⇒ 判「解析器坏了」，不许报「表里没有这些页」。`,
    );
  }
  return keys;
}

async function survey(browser, baseUrl) {
  const keys = prdPageKeys();
  console.log(`\n══ U10「版面」逐页普查（${keys.length} 页 · 1440×900 · 名册现读自 PRD §4 表，非手抄）══`);
  console.log(`   判据：${U10_RULE}\n`);
  const head = ["页".padEnd(20), "最小字号".padStart(9), "正文".padStart(6), "溢出px".padStart(8),
    "溢出元素".padStart(9), "够不着".padStart(8), "视口%".padStart(7), "控件".padStart(6), "文本元素".padStart(9), "  U10"].join("");
  console.log(head);
  const rows = [];
  let broken = 0;
  for (const key of keys) {
    let m = null;
    let err = "";
    try {
      m = await renderAndMeasure(browser, {
        baseUrl,
        route: `/v/${key}`,
        viewport: { width: 1440, height: 900 },
        rootSelector: "main",
        login: PAGES[0].login,
      });
    } catch (e) {
      err = String(e?.message || e).split("\n")[0].slice(0, 90);
      broken++;
    }
    const v = u10Verdict(m);
    rows.push({ key, m, verdict: v, err });
    const cells = m
      ? [String(m.minFontPx).padStart(9), String(m.bodyFontPx).padStart(6), String(m.overflowPx).padStart(8),
         String(m.overflowEls).padStart(9), String(m.overflowUnreachable).padStart(8),
         String(m.viewportUsePct).padStart(7), String(m.firstScreenCtrls).padStart(6), String(m.textEls).padStart(9)].join("")
      : "".padStart(62);
    console.log(`${key.padEnd(20)}${cells}  ${v.state}${m ? "" : ` ← ${err}`}`);
  }
  const tally = { 符合: 0, 不符合: 0, 判不了: 0, 不适用: 0 };
  for (const r of rows) tally[r.verdict.state]++;
  console.log(`\n合计：符合 ${tally.符合} · 不符合 ${tally.不符合} · 判不了 ${tally.判不了} · 不适用 ${tally.不适用}`);
  console.log(`\n不符合逐页理由（填进 PRD §4.1 用）：`);
  for (const r of rows.filter((x) => x.verdict.state === "不符合")) console.log(`  · ${r.key}：${r.verdict.why}`);
  // 「溢出总数」与「真够不着」全程分开印，最后再显式对一次账 —— 防止读者把总数读成坏点数。
  const totOverflow = rows.reduce((a, r) => a + (r.m?.overflowEls || 0), 0);
  const totUnreach = rows.reduce((a, r) => a + (r.m?.overflowUnreachable || 0), 0);
  console.log(
    `\n溢出两个数（**分开报**，不许合成一个）：全 ${rows.length} 页合计溢出视口的元素 ${totOverflow} 个，` +
      `其中**真够不着的 ${totUnreach} 个**。前者只说明「要横滚才看得见」，后者才是丢内容。`,
  );
  return { rows, broken, tally, totOverflow, totUnreach };
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE, "utf8"));
  } catch (e) {
    throw new ProbeBroken(`基线读不出来（${BASELINE}）：${e.message}`);
  }
}

/** 守恒判据 —— 防「删内容冒充版面变好」。见文件头 C1/C2。 */
function conservation(prev, cur) {
  const out = [];
  if (!prev) return out;
  if (cur.misalignedGroups < (prev.misalignedGroups ?? 0) && cur.rowGroups < (prev.rowGroups ?? 0)) {
    out.push(
      `C1 疑似删行冒充对齐：未对齐组 ${prev.misalignedGroups}→${cur.misalignedGroups} 变好，` +
        `但行组总数 ${prev.rowGroups}→${cur.rowGroups} **同时下降**。分母掉了，分子当然掉。`,
    );
  }
  const improvedDown = METRICS.filter((m) => m.dir === "down").some(
    (m) => typeof prev[m.key] === "number" && cur[m.key] < prev[m.key],
  );
  if (improvedDown && typeof prev.textEls === "number" && prev.textEls > 0) {
    const dropPct = ((prev.textEls - cur.textEls) / prev.textEls) * 100;
    if (dropPct > CONSERVATION_TEXT_DROP_PCT) {
      out.push(
        `C2 疑似删内容冒充版面变好：文本元素 ${prev.textEls}→${cur.textEls}（跌 ${dropPct.toFixed(1)}%，` +
          `超过 ${CONSERVATION_TEXT_DROP_PCT}%），同时有「越小越好」的项变好。` +
          `诚实位允许降到浮层，**绝不允许删除**。`,
      );
    }
  }
  return out;
}

function fmt(v) {
  return v === null || v === undefined ? "—" : String(v);
}

async function main() {
  const argv = process.argv.slice(2);
  const wantReport = argv.includes("--report");
  const wantSelftest = argv.includes("--selftest");
  const wantSurvey = argv.includes("--survey");
  const wantTighten = argv.includes("--tighten");
  const wantUpdate = argv.includes("--update");

  // 基线写入器四向金丝雀（与 buildBaselineDoc 共用同一份实现）
  const bdc = baselineDocCanary();
  if (!bdc?.ok) toolBroken(`基线写入器金丝雀不过：${bdc?.got ?? JSON.stringify(bdc)}（应：${bdc?.want ?? "四向全通过"}）`);

  const browser = await launchBrowser();
  let server = null;
  try {
    // ── 金丝雀：开扫之前先跑，不中就报「门自己瞎了」而不是「代码干净」──────────
    const canary = await runCanary(browser);
    if (canary.problems.length) {
      await browser.close().catch(() => {});
      toolBroken(`⛔ 门自己瞎了（金丝雀不过）：\n   - ${canary.problems.join("\n   - ")}`);
      return;
    }
    console.log(
      `✓ 金丝雀双侧通过 —— 必咬：8px 字量到 ${canary.bite.minFontPx}px · 溢出 ${canary.bite.overflowPx}px · ` +
        `参差行组 ${canary.bite.misalignedGroups} 组 · 溢出元素 ${canary.bite.overflowEls} 个` +
        `（其中真够不着 ${canary.bite.overflowUnreachable} 个 ⇒ 两个数分得开）；` +
        `必不咬：最小字号 ${canary.clean.minFontPx}px · 溢出 ${canary.clean.overflowPx}px · ` +
        `参差 ${canary.clean.misalignedGroups} 组 · 溢出元素 ${canary.clean.overflowEls} 个。`,
    );
    if (wantSelftest) {
      console.log("✓ --selftest 通过（金丝雀双侧 + 基线写入器四向）。");
      await browser.close().catch(() => {});
      process.exit(0);
    }

    // ── 起页面 ──────────────────────────────────────────────────────────────
    let baseUrl = process.env.LAYOUT_PROBE_URL;
    if (baseUrl) {
      console.log(`· 用已有 dev server：${baseUrl}`);
    } else {
      server = await startDevServer();
      baseUrl = server.url;
      console.log(`· 已起前端 dev server（VITE_MOCK=1）：${baseUrl}`);
    }

    // ── U10 逐页普查（给 PRD 的 U10 列填实测数用；**不**参与棘轮判定）──────────
    if (wantSurvey) {
      const s = await survey(browser, baseUrl);
      await cleanup(browser, server);
      if (s.broken > 0) {
        // 有页没渲染出来 ⇒ 本次普查**不完整**，绝不许被读成「12 页都量过了」。
        toolBroken(
          `普查有 ${s.broken} 页没渲染出来（已在上表逐页标 判不了）。` +
            `RC=2 的含义是「我没查全」，不是「这些页版面合格」—— 不许拿这份不完整的表去填 U10 列。`,
        );
        return;
      }
      console.log(`\n✓ 普查完整：${s.rows.length} 页全部渲染并量到（无 判不了）。可据此填 PRD §4 的 U10 列。`);
      process.exit(0);
    }

    // ── 名单 vs 现算 一致性断言（`gate-roster-handcopied` 守的那条命题）────────────
    // 本门的 `PAGES` 是**写死的**（只铺一页），而「推演页」的全集是**能现算的**
    // （`parsePrdTable` 读 PRD §4 表，`--survey` 用的就是它）。
    // 该门的规矩：受检对象集合写死 ⇒ **必须同批加一条「名单 vs 现算」的一致性断言**。
    // 故这里每次运行都把差集**报出来**，不许让「只守了 1/12」这件事沉默地待着：
    //   · 名单里出现现算名册**没有**的页 ⇒ RC=2（名单脏了，不是代码坏了）；
    //   · 名单是名册子集但小于全集 ⇒ 照常跑，但**打印欠账**（这是真债，登记在
    //     `scripts/gate-roster-baseline.json` 的 `check-layout-legibility.mjs:PAGES`）。
    {
      const roster = prdPageKeys();
      const gated = PAGES.map((p) => p.id);
      const alien = gated.filter((k) => !roster.includes(k));
      if (alien.length) {
        throw new ProbeBroken(
          `被测页名单里有现算名册没有的页：${alien.join(", ")}（名册 ${roster.length} 页现读自 PRD §4 表）。` +
            `⇒ 名单脏了，判「工具坏了」而不是「版面不合格」。`,
        );
      }
      const ungated = roster.filter((k) => !gated.includes(k));
      console.log(
        `· 名单 vs 现算：现算推演页名册 ${roster.length} 页 · 本门棘轮守 ${gated.length} 页（${gated.join(",")}）· ` +
          `**未进棘轮 ${ungated.length} 页**${ungated.length ? `（${ungated.join(",")}）` : ""}。` +
          `\n  ⚠ 这 ${ungated.length} 页由 \`--survey\` 逐页量过并填进 PRD 的 U10 列，但**量到 ≠ 守住** —— ` +
          `它们今天变坏本门不会红。这是登记在册的真债（gate-roster-baseline.json:check-layout-legibility.mjs:PAGES），不是遗漏。`,
      );
    }

    const prevDoc = loadBaseline();
    const measured = {};
    for (const page of PAGES) {
      measured[page.id] = {};
      for (const vp of VIEWPORTS) {
        const r = await renderAndMeasure(browser, {
          baseUrl,
          route: page.route,
          viewport: { width: vp.width, height: vp.height },
          rootSelector: page.rootSelector,
          login: page.login,
        });
        measured[page.id][vp.key] = r;
      }
    }

    // ── 报告 ────────────────────────────────────────────────────────────────
    for (const page of PAGES) {
      console.log(`\n── ${page.title}（${page.route} · 扫描根 \`${page.rootSelector}\`）──`);
      const head = ["判据".padEnd(22), ...VIEWPORTS.map((v) => v.key.padStart(11))].join("");
      console.log(`  ${head}`);
      for (const m of METRICS) {
        const cells = VIEWPORTS.map((v) => fmt(measured[page.id][v.key][m.key]).padStart(11)).join("");
        console.log(`  ${m.label.padEnd(22)}${cells}`);
      }
      // ⚠ `overflowUnreachable` 与上面棘轮里的 `overflowEls` **必须并排印成两行**，
      //   不许合成一个数 —— 前任把「415 个溢出」报成一个数，读者会读成「415 个坏点」，
      //   而其中真够不着的是 0。两行并排才读得对。
      const extra = ["overflowUnreachable", "textEls", "rowGroups", "bodyFontShare"];
      for (const k of extra) {
        const cells = VIEWPORTS.map((v) => fmt(measured[page.id][v.key][k]).padStart(11)).join("");
        const label = k === "overflowUnreachable" ? "其中·真够不着的" : `(参考) ${k}`;
        console.log(`  ${label.padEnd(22)}${cells}`);
      }
      const anyOverflow = VIEWPORTS.some((v) => (measured[page.id][v.key].overflowEls || 0) > 0);
      if (anyOverflow) {
        console.log(
          `  ↳ 读法：「溢出视口的元素数」是**要横滚才看得见**的元素，不是坏点；` +
            `其中「真够不着」才是丢内容。前者走棘轮（只许降 —— 够得着≠好用），后者绝对上限 0。`,
        );
      }
    }

    if (wantReport) {
      await cleanup(browser, server);
      process.exit(0);
    }

    // ── 判定 ────────────────────────────────────────────────────────────────
    const failures = [];
    for (const page of PAGES) {
      for (const vp of VIEWPORTS) {
        const cur = measured[page.id][vp.key];
        const where = `${page.id} @ ${vp.key}`;
        // ① 绝对阈值
        for (const [key, f] of Object.entries(FLOORS)) {
          const v = cur[key];
          if (typeof v !== "number") continue;
          const bad = f.cmp === "min" ? v < f.value : v > f.value;
          if (bad) {
            const detail = key === "minFontPx"
              ? ` 最小的几个：${(cur.smallest || []).slice(0, 4).map((s) => `<${s.tag}${s.cls ? "." + s.cls : ""}>「${s.text}」@${s.at} ${s.fs}px`).join(" · ")}`
              : key === "overflowPx"
                ? ` 溢出元素：${(cur.overflowSamples || []).map((s) => `<${s.tag}.${s.cls}> right=${s.right}`).join(" · ") || "（页面级溢出，未定位到具体元素）"}`
                : key === "misalignedGroups"
                  ? ` 参差的组：${(cur.misalignedSamples || []).map((g) => `${g.group} ${g.rows}行/${g.distinct}个左边缘 ${JSON.stringify(g.lefts)}`).join(" · ")}`
                  : key === "overflowUnreachable"
                    ? ` 够不着的元素（溢出总数 ${cur.overflowEls} 里的这几个被裁死了）：${(cur.overflowUnreachableSamples || []).map((s) => `<${s.tag}.${s.cls}> right=${s.right}`).join(" · ")}`
                    : "";
            failures.push(`${where} · ${key} = ${v}，${f.cmp === "min" ? "低于下限" : "高于上限"} ${f.value}。\n     理由：${f.why}${detail ? `\n     现场：${detail}` : ""}`);
          }
        }
        // ② 棘轮
        const prev = prevDoc?.pages?.[page.id]?.viewports?.[vp.key];
        if (prev) {
          for (const m of METRICS) {
            const p = prev[m.key];
            const c = cur[m.key];
            if (typeof p !== "number" || typeof c !== "number") continue;
            const worse = m.dir === "up" ? c < p : c > p;
            if (worse) failures.push(`${where} · ${m.label} 变坏：${p} → ${c}（棘轮方向：${m.dir === "up" ? "只许升" : "只许降"}）`);
          }
          // ③ 守恒
          for (const msg of conservation(prev, cur)) failures.push(`${where} · ${msg}`);
        } else {
          console.log(`\n· ${where} 尚无基线 ⇒ 本次只查绝对阈值。用 --tighten 建账。`);
        }
      }
    }

    if (wantTighten || wantUpdate) {
      const pages = {};
      for (const page of PAGES) {
        const viewports = {};
        for (const vp of VIEWPORTS) {
          const cur = measured[page.id][vp.key];
          const prev = prevDoc?.pages?.[page.id]?.viewports?.[vp.key];
          const rec = {};
          for (const m of METRICS) {
            const c = cur[m.key];
            const p = prev?.[m.key];
            if (wantUpdate || typeof p !== "number") rec[m.key] = c;
            else rec[m.key] = m.dir === "up" ? Math.max(p, c) : Math.min(p, c); // --tighten 只许变好
          }
          rec.textEls = cur.textEls;
          rec.rowGroups = cur.rowGroups;
          viewports[vp.key] = rec;
        }
        pages[page.id] = {
          route: page.route,
          rootSelector: page.rootSelector,
          why: prevDoc?.pages?.[page.id]?.why ?? `${page.title} —— 本门的样板页（WO-SANDBOX-LAYOUT-HARNESS 只铺一页）。`,
          viewports,
        };
      }
      // ⚠ `buildBaselineDoc(…)` **必须内联在 `writeFileSync` 的实参里**，不许先抽成 `const doc = …`。
      //   这不是风格洁癖：`baseline-writer-honesty:check` 判的是「**写的那一刻**用没用共享写入器」，
      //   而「文件顶部 import 了」证明不了「写的时候用了」（同一个符号可以被同名局部变量遮蔽）。
      //   本单实测踩过：抽成 `const doc` 后该门当场判 HAND_ROLLED（RC=1），改成内联才绿。
      writeFileSync(
        BASELINE,
        `${JSON.stringify(
          buildBaselineDoc({
            prev: prevDoc,
            generatedBy: `node scripts/check-layout-legibility.mjs ${wantUpdate ? "--update" : "--tighten"}`,
            prose: {
              note:
                "版面门棘轮基线。每页每视口一组实测数，**只许变好**。" +
                "`--tighten` 逐项取「更好的那个」；`--update` 会连放宽一起写下来，**不是日常操作**" +
                "（本仓发生过 --update 悄悄抬基线买来一片绿）。阈值与取数方法见 scripts/check-layout-legibility.mjs 文件头。",
            },
            computed: { pages },
          }),
          null,
          2,
        )}\n`,
      );
      console.log(`\n✓ 基线已写入 ${BASELINE}（${wantUpdate ? "--update" : "--tighten"}）。`);
      await cleanup(browser, server);
      process.exit(0);
    }

    await cleanup(browser, server);
    if (failures.length) {
      console.error(`\n✗ layout-legibility 不通过（${failures.length} 条）：`);
      for (const f of failures) console.error(`   - ${f}`);
      console.error(
        `\n   只做版面（字号 / 栅格 / 间距 / 密度）就能修的，直接修；` +
          `确属信息架构、需另开单的，写进 docs/PRD-harness-ux-adoption.md §4.3 逐格登记，别改基线买绿。`,
      );
      process.exit(1);
    }
    console.log(`\n✓ layout-legibility 通过（${PAGES.length} 页 × ${VIEWPORTS.length} 视口 · 独立口径下限 textEls ≥ ${TEXT_ELS_FLOOR}）。`);
    process.exit(0);
  } catch (e) {
    await cleanup(browser, server);
    if (e instanceof ProbeBroken || e?.probeBroken) toolBroken(e.message);
    throw e;
  }
}

async function cleanup(browser, server) {
  await browser?.close().catch(() => {});
  server?.stop();
}

try {
  await main();
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}
