#!/usr/bin/env node
/**
 * 门 `harness-ux-behavior:check` · **行为面门**（WO-GATE-B-BROWSER-HARNESS）
 *
 * ══ 守什么 ═══════════════════════════════════════════════════════════════════
 * `docs/PRD-harness-ux-adoption.md` §4.2 拆出去的 4 条明账里，有两条的**内容面**
 * 只差「在既有真浏览器 probe 上加一个能力」，本门就是那两个能力的判据：
 *
 *   **B-1 = U1 的时延面**（「改输入即重演」的行为半）：
 *     改一个输入、**不点任何按钮**，断言结果 DOM 在 N 毫秒内变了。
 *     失败态 = 存在提交闸（用户改完不点、以为看到的是新结果，**实际在看旧结果**）
 *     或输入根本没进求解入参。两者在源码里都能写得「看起来像接了」，
 *     只有渲染后真改一下才知道 —— 所以它被拆进 §4.2，静态与单页渲染都够不着。
 *
 *   **B-4·U8 的几何面**（「看明细不换页」的浮层半）：
 *     悬停/点击原地展开的浮层，做 z-order × 矩形相交判定 ——
 *     「A 盖住了 B 的哪一部分」。浮层盖住内容是它的本分（信息面照实报），
 *     但**不许有别的东西反过来盖住浮层**（盖住 = 浮层白开 = 违规）。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『静态判据全绿』当作『改输入结果真会变 / 浮层真没被压住』的证据，
 *   >    而前者并不度量后者。」**
 *
 * ══ 与既有门/库的分工（不新造 harness）════════════════════════════════════════
 * 真浏览器 harness 用的是**既有** `scripts/lib/layout-probe.mjs`
 * （真 Chromium 起 dev server + 登录 + SPA 内导航 + 等版面稳定，`layout-legibility:check` 在用）。
 * 本单只在它上面加两个能力（B-1 两时刻 DOM 快照比对 · B-4·U8 遮挡判定），
 * 页面装配走同一份 `openStablePage` —— **没有新造任何 harness**。
 *  · `layout-legibility:check` 量「浏览器把它排成了什么样」（单时刻几何，棘轮）；
 *  · `harness-ux-splitaccount:check`（门 B）守「账还在、有人认领、受理方存在」（静态文档面）；
 *  · **本门**判「行为/遮挡的内容面」（真浏览器，逐页对账 + 违规即红）。三者互不覆盖。
 *
 * ══ B-1 的判法 = 与 PRD §4 表 U1 列**逐格对账**（不是「一律要求符合」）══════════
 * 与 `layout-legibility --survey` 的 U10 对账同一个道理（推导见那个文件）：
 *   表说 `符合`、屏上有输入改了结果真变 ⇒ 绿；表说 `符合` 而试过的输入**全不变** ⇒ 红（有人改坏了）；
 *   表说 `不符合`、屏上**仍有输入改了不变**（陈旧窗口仍在）⇒ 绿（**诚实登记的欠账不染红**）；
 *   表说 `不符合` 而试过的输入**全都真变** ⇒ 红（闸确实没了 = 修好了没回写表，方向相反的脱节）。
 * 两条归因纪律（都是 2026-08-18 真页面实测逼出来的）：
 *   · **输入回显 ≠ 结果重演**：改值后唯一变化是屏上把那个数原样照抄（echo），归「没重演」一侧
 *     （`classifyReaction`，optimize-whatif 基线表实测：不区分它，带闸页会被误判「修好没回写」）；
 *   · **混合证据照实记**：一页可以「主流程有闸 ∧ 另有实时区（如共享传导边面板）」——
 *     对「不符合」格，闸的存在由「仍有输入改了不变」证明，实时区不妨碍欠账属实。
 * 页内探不到可编辑输入 ⇒ 本页这条**未判**（如实报，不算红也不算绿 ——
 * 但**全部 12 页都未判** ⇒ RC=2：探针一个输入都够不着 ⇒ 是探针坏了，不是页面干净）。
 *
 * ══ B-4·U8 的判法 = 与 PRD §4.2.3 遮挡登记表**对账**（与 B-1 对 U1 列同一个道理）═══════
 * 逐页找浮层触发器（`[aria-expanded]`/`[aria-haspopup]`，本仓浮层组件的公开契约面），
 * 先悬停、无浮层再点击；**出现**浮层就量遮挡（`measureOcclusionInPage`，与金丝雀同一份）：
 *   · 浮层矩形内 3×3 采样点，任一采样点最上层元素不属于浮层子树 ⇒ 浮层被压住
 *     （被压点带九宫格分区名 + 压人元素矩形 + 被压区域包围盒 —— WO-U8-OCCLUSION-GRID
 *      把 B 线 fdd19a43d 的更细粒度纯加性并入，判据/对账语义不动）；
 *   · 浮层盖住了哪些文本元素、各盖住百分之几 ⇒ **照实打印**（「A 盖住了 B 的哪一部分」）。
 * 触发后无浮层 ⇒ 记「内联展开或无浮层」，**不红**（U8 的合法形态之一就是原地内联展开）。
 * 被压住的处置按 §4.2.3 登记表对账：
 *   · 屏上被压 + 表里登记 `不符合` ⇒ 绿（**诚实登记的欠账不染红**，登记行必须写清去向）；
 *   · 屏上被压 + 表里**没有** ⇒ 红（新遮挡：要么修 z-index/堆叠上下文，要么显式登记）；
 *   · 屏上无压 / 触发器没了 + 表里登记着 ⇒ 红（**修好没回写 / 登记指向空气**，逼销账）。
 *   登记键 = `页::触发器 aria 标签`全等匹配 —— 文案改了门当场红，**登记不许无声腐烂**。
 * 12 页合计一个触发器都找不到 / 一个浮层都开不出来 ⇒ RC=2
 * （代码里明明有 `InfoPopover`，一个都触发不到 ⇒ 是探针坏了）。
 *
 * ══ 金丝雀（每次运行先跑 · 与主逻辑共用同一份 lib 函数，不另抄）═════════════════
 *   必咬①：改输入即变的页（`oninput` 直接改结果文本）⇒ 必须探到 changed；
 *   必咬②：提交闸的页（结果只在点按钮时变）⇒ 必须探到 unchanged，且对账「符合」格必须判红；
 *   必咬②b：纯回显页（输入值被原样照抄）⇒ 必须归因为 echo 并归入「没重演」一侧；
 *   判据单元：合成 tried 清单四向（混合证据对不符合放行 / 全变对不符合判红 /
 *     全不变对符合判红 / 混合对符合放行）；
 *   必咬③：被高压住的浮层（overlay z-1 上盖一个 z-2 的块）⇒ 必须报出 occludedBy 且判红，
 *     且每个被压点必须带**九宫格分区名**（cell）与压人元素矩形（byRect），
 *     occludedRect 聚合包围盒必须命中夹具真值（WO-U8-OCCLUSION-GRID，B 线粒度纯加性并入）；
 *   方位变异：遮挡块只压浮层**右下角**一个采样点 ⇒ 报告必须说出且只说出「右下」，
 *     说错分区（行/列算反、张冠李戴）即红；
 *   必不咬：置顶浮层（z-99）⇒ 一个 occludedBy 都不许报，且 covers 必须量到被盖元素（带其矩形）；
 *   对账⑤：同一 judgeOcclusion 三向 —— 登记遮挡不红 / 未登记遮挡必红 / 修好没回写必红；
 *   解析⑥：§4.2.3 样例表必须解析出 1 条登记（解析器瞎了 ⇒ RC=2，不许报「零欠账」）。
 *
 * ══ 退出码（三分）════════════════════════════════════════════════════════════
 *   0 干净 · 1 **对账不一致 / 未登记的浮层遮挡 / 登记脱节（修好没回写·指向空气）** · 2 **工具自己坏了**
 *   （渲染不出来 · 金丝雀不过 · 独立口径不过：0 页可判 / 0 个触发器 / 0 个浮层）。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 G-SPLITACCOUNT-PROMISE-ONLY（B-1/B-4·U8 收口）。
 * 门账：scripts/gate-ledger.json。
 *
 * 用法：
 *   node scripts/check-harness-ux-behavior.mjs              # 门（12 页全量）
 *   node scripts/check-harness-ux-behavior.mjs --selftest   # 金丝雀（不起 dev server，秒级）
 *   node scripts/check-harness-ux-behavior.mjs --report     # 只打印实测，不判定
 *   node scripts/check-harness-ux-behavior.mjs --pages=sim-sandbox,what-if   # 只跑指定页（调试用）
 *
 * 环境：
 *   LAYOUT_PROBE_URL=http://127.0.0.1:5188/   已有 dev server 时直接用它（跳过自起）
 *   PLAYWRIGHT_CHROMIUM=/path/to/chrome       浏览器不在默认位置时直接指过去
 */

/* ── 兜底必须**最先**注册：它要覆盖的正是「后面任何一行崩了」（WO-GATE-RC2-DISCIPLINE）。
 *    未捕获异常 node 默认退 1，恰好撞上「真有问题」—— 必须兜成 2（工具坏了）。 */
process.on("uncaughtException", (e) => bail(e));
process.on("unhandledRejection", (e) => bail(e));
function bail(e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}

import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// ⚠ 页名册与 U1 判词**从 PRD §4 表现读**，不在本文件里手抄一份
//   （`check-gate-roster-handcopied.mjs` 治的就是手抄名册那个病）。
import { parsePrdTable } from "./check-sim-ux-criteria.mjs";
import {
  ProbeBroken,
  REACTION_TIMEOUT_MS,
  launchBrowser,
  openStablePage,
  probeInputReaction,
  findOverlayTriggersInPage,
  listVisibleOverlaysInPage,
  measureOcclusionInPage,
} from "./lib/layout-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

let exiting = false;
function toolBroken(msg, extra = "") {
  if (exiting) return;
  exiting = true;
  console.error(`\n⛔ harness-ux-behavior 工具坏了（RC=2 · 只许说「我没查出来」，不许说「页面没问题」）`);
  console.error(`   ${msg}`);
  if (extra) console.error(`   ${extra}`);
  process.exit(2);
}

const LOGIN = { tenant: "demo", username: "planner", password: "demo1234" };
const VIEWPORT = { width: 1440, height: 900 };
const ROOT_SEL = "main";

// ───────────────────────────────────────────────────────────────────────────────
// 判据本体（主流程与金丝雀共用这两份，不许各抄一份 —— 抄了金丝雀就是装饰品）
// ───────────────────────────────────────────────────────────────────────────────

/**
 * B-1 对账判据：行为探针结果 ⇄ PRD §4 表 U1 格。
 * @returns {{fail:string|null, note:string}}
 *   fail 非空 = 对账不一致（RC=1 的真违规）；note 是如实读数（含「未判」「欠账属实」）。
 */
export function judgeReaction(pageId, result, cell) {
  const where = `${pageId} · B-1（U1 时延面）`;
  if (result.status === "no-input") {
    return { fail: null, note: `${where}：页内探不到可编辑输入 ⇒ 本页**未判**（${result.reason}）` };
  }
  if (result.status === "unstable") {
    // 探针没法归因 = 这一页本次没查成。如实上抛，由调用方决定（真页面上这是 RC=2 的事）。
    return { fail: null, note: `${where}：探针无法归因（${result.reason}）`, unstable: true };
  }
  const fmtInp = (t) =>
    `<${t.tag}${t.type ? ` type=${t.type}` : ""}${t.name ? ` name=${t.name}` : ""}${t.aria ? ` aria=「${t.aria}」` : ""}> ` +
    `${t.oldValue}→${t.newValue}`;
  const tried = result.tried ?? [];
  const changedOnes = tried.filter((t) => t.outcome === "changed");
  const stillOnes = tried.filter((t) => t.outcome === "unchanged" || t.outcome === "echo");
  const inp = tried.length
    ? `试过 ${tried.length} 个输入：${tried.map((t) => `${fmtInp(t)} ⇒ ${t.result}`).join(" · ")}`
    : result.input
      ? `输入 ${fmtInp(result.input)}`
      : "";
  const lat = changedOnes.length ? `（首个 ${result.latencyMs}ms 内变了）` : `（各等 ${result.timeoutMs}ms 没变）`;

  if (cell === "符合") {
    if (changedOnes.length) {
      const mixed = stillOnes.length ? `\n      ↳ 另有 ${stillOnes.length} 个输入改了不变（展示型/未接线候选，不构成提交闸证据）` : "";
      return { fail: null, note: `${where}：表=符合 · 屏=改输入即变 ${lat} ⇒ 一致 ✓ ${inp}${mixed}` };
    }
    return {
      fail:
        `${where}：表说 U1 **符合**（改输入即重演），而真浏览器里${inp}，` +
        `不点任何按钮各等 ${result.timeoutMs}ms，结果 DOM **一次都没变**（输入回显不算重演）—— ` +
        `存在提交闸或输入没进求解入参（用户改完不点，以为看到新结果，实际在看旧结果）。` +
        `\n     ⇒ 先修页面（把输入接进入参 / 去掉提交闸），不许改表买绿。`,
      note: "",
    };
  }
  if (cell === "不符合") {
    // 欠账格的行为面证据 = **陈旧窗口仍在**：至少一个输入改了而结果不变（echo = 只有回显，同样算不变）。
    // 全试过都真变了 ⇒ 闸确实没了 ⇒ 「修好没回写」才成立。
    if (stillOnes.length) {
      const live = changedOnes.length
        ? `\n      ↳ 页内另有实时区：${changedOnes.map((t) => `${fmtInp(t)} ${t.latencyMs}ms 即变`).join(" · ")} —— 不改变「主流程有闸」的欠账事实`
        : "";
      return {
        fail: null,
        note: `${where}：表=不符合 · 屏=陈旧窗口仍在（${stillOnes.length} 个输入改了不变/仅回显）⇒ **欠账属实**（登记在册，不染红）${inp}${live}`,
      };
    }
    return {
      fail:
        `${where}：表说 U1 **不符合**，而真浏览器里改 ${inp} 后结果 DOM 每次都真变了 ${lat} —— ` +
        `试过的输入**没有一个**留在旧值窗口 ⇒ 提交闸确实没了，是修好了没回写表。` +
        `⇒ 把 §4 表该页 U1 格改成「符合」并跑 check-sim-ux-criteria.mjs --tighten。`,
      note: "",
    };
  }
  // 不适用 / 其他：U1 在这一页无处落脚（表里已登记），本门不重复判。
  return { fail: null, note: `${where}：表=${cell ?? "（无此格）"} ⇒ 本门不判这一格（屏=${result.status}）` };
}

/**
 * B-4·U8 遮挡判据：浮层**不许被别的元素压住**；盖住别人是浮层的本分，照实报。
 * 判法 = 与 PRD §4.2.3 的 U8 遮挡登记表**对账**（与 B-1 对 U1 列对账同一个道理）：
 *   屏上被压 + 表里登记 `不符合` ⇒ 绿（**诚实登记的欠账不染红**，否则消红的最短路径是改表）；
 *   屏上被压 + 表里**没有** ⇒ 红（新遮挡，必须修页面或显式登记 —— 登记要写给出去向）；
 *   屏上无遮挡 + 表里登记了 `不符合` ⇒ 红（**修好了没回写**，脱节的方向相反而已）。
 * @returns {{fail:string|null, note:string, debtKey:string|null, occluded:boolean}}
 */
export function judgeOcclusion(pageId, trigger, occ, debtRegistry) {
  const where = `${pageId} · B-4·U8（浮层遮挡）`;
  // debtLabel：同名触发器在同页出现多次时带「#N」序号（文档序，scanOverlays 现算）——
  // 否则一笔登记会把两个同名触发器一起盖住，修了一个另一个就失锚。
  const label = trigger ? (trigger.debtLabel || (trigger.aria || trigger.text || "").trim()) : "";
  const debtKey = trigger ? `${pageId}::${label}` : null;
  if (!occ.ok) return { fail: null, note: `${where}：浮层量测没做成（${occ.reason}）`, debtKey, occluded: false };
  const ov = occ.overlay;
  const head = `浮层 <${ov.sel}> rect=${ov.rect.w}×${ov.rect.h}@${ov.rect.x},${ov.rect.y}`;
  if (occ.occludedBy.length > 0) {
    // 读数加细（WO-U8-OCCLUSION-GRID，纯加性）：旧读数（坐标 at / 压人元素 by / byText / N/M 点）
    // 原样保留，追加 B 线粒度的九宫格分区名 cell 与被压区域包围盒 occludedRect。
    const pts = occ.occludedBy
      .slice(0, 4)
      .map((p) => `${p.at}${p.cell ? `（${p.cell}）` : ""} 被 ${p.by}「${p.byText}」压住`)
      .join(" · ");
    const area = occ.occludedRect
      ? `（被压区域 ≈ ${occ.occludedRect.w}×${occ.occludedRect.h}@${occ.occludedRect.x},${occ.occludedRect.y}）`
      : "";
    if (debtKey && debtRegistry?.has(debtKey)) {
      return {
        fail: null,
        note:
          `${where}：${head} 被压 ${occ.occludedBy.length}/${occ.samples} 点（${pts}）${area}` +
          `\n      ⇒ **欠账属实**（已登记 PRD §4.2.3，去向见表；不染红）`,
        debtKey,
        occluded: true,
      };
    }
    return {
      fail:
        `${where}：${head} —— 浮层**被别的元素压住了**（${occ.occludedBy.length}/${occ.samples} 个采样点）${area}：${pts}。` +
        `\n     浮层被盖住 = 浮层白开（用户点开却看不全），且 PRD §4.2.3 **没有登记**这一笔。` +
        `\n     ⇒ 修 z-index / 堆叠上下文；确需挂账就显式登记 §4.2.3 并写清去向。**不许豁免。**`,
      note: "",
      debtKey,
      occluded: true,
    };
  }
  if (debtKey && debtRegistry?.has(debtKey)) {
    return {
      fail:
        `${where}：§4.2.3 登记「${label}」的浮层被压（不符合），而真浏览器里它**已无遮挡** —— ` +
        `修好了没回写。⇒ 删掉 §4.2.3 那一行（销账也要显式）。`,
      note: "",
      debtKey,
      occluded: false,
    };
  }
  const covers = occ.covers
    .slice(0, 4)
    .map((c) => `<${c.tag}${c.cls ? "." + c.cls : ""}>「${c.text}」盖 ${c.coverPct}%`)
    .join(" · ");
  return {
    fail: null,
    note:
      `${where}：${head} · 采样 ${occ.samples} 点全在浮层子树（无遮挡）✓` +
      `${occ.outside ? ` · ${occ.outside} 点在视口外未量` : ""}` +
      `${covers ? `\n      ↳ 它盖住了 ${occ.coveredEls} 个文本元素（「A 盖住了 B 的哪一部分」）：${covers}` : " · 没盖到任何文本元素"}`,
    debtKey,
    occluded: false,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// 金丝雀 —— 与主逻辑共用同一份 lib 函数与判据（双侧：必咬 / 必不咬）
// ───────────────────────────────────────────────────────────────────────────────

/* 必咬①：改输入即变（oninput 直接改结果文本 —— 「改输入即重演」的最小真形状）。
 * ⚠ 样例里不许出现反引号（整个样例是模板字符串，反引号会把它截断 —— 本仓实测踩过）。 */
const CANARY_REACTIVE = `
<main>
  <label>需求量 <input id="dem" type="number" value="100"></label>
  <div id="result">合计： 100 吨</div>
  <script>
    document.getElementById("dem").addEventListener("input", (e) => {
      document.getElementById("result").textContent = "合计： " + (Number(e.target.value) * 2) + " 吨";
    });
  </script>
</main>`;

/* 必咬②：提交闸（结果只在点按钮时变 —— B-1 要咬的失败态的最小真形状）。 */
const CANARY_GATED = `
<main>
  <label>需求量 <input id="dem" type="number" value="100"></label>
  <button id="go" type="button">重新计算</button>
  <div id="result">合计： 100 吨</div>
  <script>
    document.getElementById("go").addEventListener("click", () => {
      const v = document.getElementById("dem").value;
      document.getElementById("result").textContent = "合计： " + (Number(v) * 2) + " 吨";
    });
  </script>
</main>`;

/* 必咬②b：纯回显（oninput 只把输入值原样抄进一个 span —— 求解器一下都没跑）。
 * 2026-08-18 实测 optimize-whatif 的真形状：改基线表数字，屏上唯一变化是一个 span 照抄那个数。
 * 探针必须归因为 echo 并归入「没重演」那一侧 —— 输入回显 ≠ 结果重演。 */
const CANARY_ECHO = `
<main>
  <label>基线量 <input id="dem" type="number" value="100"></label>
  <div>当前基线：<span id="echo">100</span></div>
  <div id="result">合计： 100 吨</div>
  <script>
    document.getElementById("dem").addEventListener("input", (e) => {
      document.getElementById("echo").textContent = e.target.value;
    });
  </script>
</main>`;

/* 必咬③：浮层被高压住（overlay z-1，上面再盖一个 z-2 的块 —— U8 要咬的失败态）。 */
const CANARY_OCCLUDED = `
<main style="position:relative">
  <p style="margin:200px 0 0 0">底层内容一段</p>
  <div id="ov" style="position:absolute;left:40px;top:40px;width:240px;height:160px;z-index:1;background:#fff;border:1px solid #999">浮层正文：口径说明一段</div>
  <div id="cov" style="position:absolute;left:100px;top:80px;width:240px;height:160px;z-index:2;background:#ddd">压住浮层的块</div>
</main>`;

/* 必不咬：置顶浮层（z-99 盖住底层文本 —— 盖住别人是本分，不许报；被盖必须量到）。
 * ⚠ 底层文本用 absolute 钉进浮层矩形内 —— 第一版用 margin 摆位，实测矩形根本没相交
 *   （样例错了而量测是对的，金丝雀当场把它咬出来 —— 这正是金丝雀存在的意义）。 */
const CANARY_TOPMOST = `
<main style="position:relative">
  <p id="under" style="position:absolute;left:60px;top:120px;margin:0">被浮层盖住的底层文本</p>
  <div id="ov" style="position:absolute;left:40px;top:40px;width:320px;height:160px;z-index:99;background:#fff;border:1px solid #999">浮层正文：口径说明一段</div>
</main>`;

/* 方位变异（WO-U8-OCCLUSION-GRID）：遮挡块**只压浮层右下角一个采样点** ——
 * 报告必须说出且只说出「右下」。咬「少报/多报/报成不存在的格」；
 * 「行/列序号互换」由必咬③的逐点方位映射咬（右下角在对角线上，转置后仍是右下，本夹具咬不到互换）。 */
const CANARY_OCCLUDED_CORNER = `
<main style="position:relative">
  <div id="ov" style="position:absolute;left:40px;top:40px;width:240px;height:160px;z-index:1;background:#fff;border:1px solid #999">浮层正文：口径说明一段</div>
  <div id="cov" style="position:absolute;left:200px;top:150px;width:200px;height:200px;z-index:2;background:#ddd">只压右下角的块</div>
</main>`;

async function withHtmlPage(browser, html, fn) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function runCanary(browser) {
  const problems = [];

  // ── 必咬①：改输入即变的页必须探到 changed ─────────────────────────────────
  const r1 = await withHtmlPage(browser, CANARY_REACTIVE, (page) =>
    probeInputReaction(page, { rootSelector: "main", timeoutMs: 2000, pollMs: 100 }),
  );
  if (r1.status !== "changed") {
    problems.push(`必咬①（改输入即变的页）探针没探到变化（status=${r1.status} ${r1.reason || ""}）`);
  } else {
    const j1 = judgeReaction("canary-reactive", r1, "符合");
    if (j1.fail) problems.push(`必咬①过了探针却被判据误判红：${j1.fail}`);
  }

  // ── 必咬②：提交闸的页必须探到 unchanged，且对「符合」格判红、对「不符合」格不红 ──
  const r2 = await withHtmlPage(browser, CANARY_GATED, (page) =>
    probeInputReaction(page, { rootSelector: "main", timeoutMs: 1200, pollMs: 100 }),
  );
  if (r2.status !== "unchanged") {
    problems.push(`必咬②（提交闸的页）探针没咬出来（status=${r2.status}）—— 门会对提交闸放行`);
  } else {
    const j2a = judgeReaction("canary-gated", r2, "符合");
    if (!j2a.fail) problems.push(`必咬②探到提交闸，判据却没对「表=符合」格判红 —— 门没牙`);
    const j2b = judgeReaction("canary-gated", r2, "不符合");
    if (j2b.fail) problems.push(`必咬②对「表=不符合」的诚实登记欠账误判红 —— 会逼人去改表买绿`);
  }

  // ── 必咬②b：纯回显页必须归因为 echo（归入「没重演」一侧），不许当成「改输入即重演」──
  const r2b = await withHtmlPage(browser, CANARY_ECHO, (page) =>
    probeInputReaction(page, { rootSelector: "main", timeoutMs: 1200, pollMs: 100 }),
  );
  if (!(r2b.status === "unchanged" && r2b.tried?.[0]?.outcome === "echo")) {
    problems.push(
      `必咬②b（纯回显页）没归因为 echo（status=${r2b.status} outcome=${r2b.tried?.[0]?.outcome ?? "?"}）—— ` +
        `回显会被当成重演，带提交闸的页会被误判「修好没回写」（2026-08-18 optimize-whatif 实测过的坑）`,
    );
  } else {
    const j2c = judgeReaction("canary-echo", r2b, "不符合");
    if (j2c.fail) problems.push(`必咬②b 回显页对「表=不符合」格误判红 —— 回显不是「闸已修好」的证据`);
    const j2d = judgeReaction("canary-echo", r2b, "符合");
    if (!j2d.fail) problems.push(`必咬②b 回显页对「表=符合」格没判红 —— 回显被当成了重演`);
  }

  // ── 判据单元向（不起页面，喂合成 tried 清单给**同一个** judgeReaction）──────────
  const mk = (outcome) => ({
    tag: "input", type: "number", name: "", aria: "",
    oldValue: "100", newValue: "101",
    outcome, result: outcome === "changed" ? "changed(200ms)" : outcome,
    latencyMs: outcome === "changed" ? 200 : undefined,
  });
  const mixed = { status: "changed", latencyMs: 200, timeoutMs: 5000, tried: [mk("unchanged"), mk("changed")] };
  const allChanged = { status: "changed", latencyMs: 200, timeoutMs: 5000, tried: [mk("changed"), mk("changed")] };
  const allStill = { status: "unchanged", timeoutMs: 5000, tried: [mk("unchanged"), mk("echo")] };
  if (judgeReaction("unit", mixed, "不符合").fail)
    problems.push(`判据单元：混合证据（有输入改了不变）对「不符合」格误判红 —— 会把「主流程仍有闸、另有实时区」的页逼去改表`);
  if (!judgeReaction("unit", allChanged, "不符合").fail)
    problems.push(`判据单元：试过的输入全部真变的页对「不符合」格没判红 —— 「修好没回写」漏牙`);
  if (!judgeReaction("unit", allStill, "符合").fail)
    problems.push(`判据单元：全不变（含回显）的页对「符合」格没判红 —— 提交闸会放行`);
  if (judgeReaction("unit", mixed, "符合").fail)
    problems.push(`判据单元：混合证据（有真变的）对「符合」格误判红`);

  // ── 必咬③：被压住的浮层必须报出 occludedBy 且判红 ─────────────────────────
  const o1 = await withHtmlPage(browser, CANARY_OCCLUDED, (page) =>
    page.evaluate(measureOcclusionInPage, { overlaySelector: "#ov", rootSelector: "main" }),
  );
  if (!o1.ok) problems.push(`必咬③（被压浮层）量测没做成：${o1.reason}`);
  else {
    if (!(o1.occludedBy.length > 0)) {
      problems.push(`必咬③浮层明明被 z-2 的块压着，却没报出任何被压采样点 —— z-order 判定瞎了`);
    }
    const j3 = judgeOcclusion("canary-occluded", null, o1);
    if (!j3.fail) problems.push(`必咬③量到了被压采样点，判据却没判红 —— 门没牙`);
    // ── 新维度断言（WO-U8-OCCLUSION-GRID）：九宫格分区名 + byRect + occludedRect ──
    // 夹具几何：cov 块（left:100 top:80 240×160 z-2）相对浮层（left:40 top:40）右移 60、下移 40，
    // 恰好压住中列/右列 × 中行/下行 4 个采样点。断言写成**相对几何**（夹具在视口里的绝对原点
    // 受 body margin/外边距折叠影响，绝对坐标断言会咬错对象 —— 本单实测踩过）：
    // 分区集合、byRect 宽高与相对偏移、occludedRect 落在压人块内部，全都与原点无关。
    const CELLS9 = ["左上", "上中", "右上", "左中", "正中", "右中", "左下", "下中", "右下"];
    const badCell = o1.occludedBy.filter((p) => !CELLS9.includes(p.cell));
    if (badCell.length) {
      problems.push(
        `必咬③被压点的九宫格分区名缺失/非法：${badCell.map((p) => `${p.at}=${p.cell ?? "（无）"}`).join(" · ")} —— 新维度没落地`,
      );
    }
    const wantCells = ["正中", "右中", "下中", "右下"];
    const gotCells = o1.occludedBy.map((p) => p.cell);
    if (!(o1.occludedBy.length === 4 && wantCells.every((c) => gotCells.includes(c)))) {
      problems.push(
        `必咬③被压点方位集合应是 4 点 ${wantCells.join("/")}（cov 压住浮层中右一片到右下），` +
          `实得 ${o1.occludedBy.length} 点：${gotCells.join("/") || "空"} —— 分区定位说错方位`,
      );
    }
    // 逐点方位映射：集合断言对「行/列序号互换」不敏感（本夹具 4 点恰好转置对称，本单实测
    // 互换变异体曾因此漏网）—— 必须逐点咬：x 最大的被压点必须在右列（右中），
    // y 最大的必须在下行（下中）；互换变异体会把两者对调，当场红。
    const xOf = (p) => Number(p.at.split(",")[0]);
    const yOf = (p) => Number(p.at.split(",")[1]);
    const rightmost = o1.occludedBy.reduce((a, p) => (xOf(p) > xOf(a) ? p : a));
    const bottommost = o1.occludedBy.reduce((a, p) => (yOf(p) > yOf(a) ? p : a));
    if (rightmost.cell !== "右中") {
      problems.push(`必咬③逐点映射：最右被压点（${rightmost.at}）必须是「右中」，实得「${rightmost.cell}」—— 行/列算反了`);
    }
    if (bottommost.cell !== "下中") {
      problems.push(`必咬③逐点映射：最下被压点（${bottommost.at}）必须是「下中」，实得「${bottommost.cell}」—— 行/列算反了`);
    }
    const ovr = o1.overlay.rect;
    const badRect = o1.occludedBy.filter(
      (p) =>
        !p.byRect ||
        p.byRect.w !== 240 ||
        p.byRect.h !== 160 ||
        p.byRect.x - ovr.x !== 60 || // cov.left(100) − ov.left(40)
        p.byRect.y - ovr.y !== 40, //   cov.top(80) − ov.top(40)
    );
    if (badRect.length) {
      problems.push(
        `必咬③被压点的 byRect 应是压人块矩形（240×160 · 相对浮层右 60 下 40），` +
          `实得 ${badRect.map((p) => `${p.at}→${JSON.stringify(p.byRect ?? null)}`).join(" · ")} —— 压人元素矩形没量对`,
      );
    }
    // occludedRect = 被压采样点包围盒，必须落在压人块矩形内部（B 线 coverRect 的语义）。
    const ar = o1.occludedRect;
    const br0 = o1.occludedBy[0]?.byRect;
    if (
      !(
        ar &&
        br0 &&
        ar.w > 0 &&
        ar.h > 0 &&
        ar.x >= br0.x &&
        ar.y >= br0.y &&
        ar.x + ar.w <= br0.x + br0.w &&
        ar.y + ar.h <= br0.y + br0.h
      )
    ) {
      problems.push(
        `必咬③ occludedRect（被压采样点包围盒）应存在且落在压人块内部，实得 ${JSON.stringify(ar ?? null)}（压人块 ${JSON.stringify(br0 ?? null)}）`,
      );
    }
  }

  // ── 方位变异向：只压右下角的遮挡，报告必须说出且只说出「右下」───────────────
  const o3 = await withHtmlPage(browser, CANARY_OCCLUDED_CORNER, (page) =>
    page.evaluate(measureOcclusionInPage, { overlaySelector: "#ov", rootSelector: "main" }),
  );
  if (!o3.ok) problems.push(`方位变异（只压右下角）量测没做成：${o3.reason}`);
  else if (!(o3.occludedBy.length === 1 && o3.occludedBy[0].cell === "右下")) {
    problems.push(
      `方位变异：遮挡块只压浮层右下角一个采样点，报告必须说出且只说出「右下」，实得 ` +
        `${o3.occludedBy.length} 点（${o3.occludedBy.map((p) => `${p.at}=${p.cell ?? "（无）"}`).join(" · ") || "空"}）—— ` +
        `分区定位说错方位（行/列序号算反或张冠李戴都会被这一向咬住）`,
    );
  }

  // ── 必不咬：置顶浮层一个被压点都不许报，且「盖住了谁」必须量到 ─────────────
  const o2 = await withHtmlPage(browser, CANARY_TOPMOST, (page) =>
    page.evaluate(measureOcclusionInPage, { overlaySelector: "#ov", rootSelector: "main" }),
  );
  if (!o2.ok) problems.push(`必不咬（置顶浮层）量测没做成：${o2.reason}`);
  else {
    if (o2.occludedBy.length > 0) {
      problems.push(`必不咬置顶浮层被误报 ${o2.occludedBy.length} 个被压采样点 —— 会把好浮层判红`);
    }
    const hit = o2.covers.find((c) => c.text.includes("被浮层盖住"));
    if (!hit) {
      problems.push(`必不咬样例里浮层明明盖着「被浮层盖住的底层文本」，covers 却没量到 —— 「A 盖住了 B 的哪一部分」这一维瞎了`);
    } else if (!(hit.rect && hit.rect.w > 0 && hit.rect.h > 0)) {
      problems.push(
        `必不咬 covers 条目缺被盖元素矩形 rect（实得 ${JSON.stringify(hit.rect ?? null)}）—— ` +
          `WO-U8-OCCLUSION-GRID 的加性维度没落地`,
      );
    }
    const j4 = judgeOcclusion("canary-topmost", null, o2);
    if (j4.fail) problems.push(`必不咬置顶浮层被判据误判红：${j4.fail}`);
  }

  // ── 对账语义⑤（§4.2.3 登记表三向，喂给**同一个** judgeOcclusion）──────────────
  //   ⑤a 屏上被压 + 表里登记了 ⇒ 不许红（欠账属实；判红 = 逼人删登记买绿）
  //   ⑤b 屏上被压 + 表里没登记 ⇒ 必须红（登记表不许成免死金牌）
  //   ⑤c 屏上无压 + 表里登记了 ⇒ 必须红（修好没回写；不咬 = 登记表无声腐烂）
  if (o1.ok && o1.occludedBy.length > 0 && o2.ok && o2.occludedBy.length === 0) {
    const reg5 = new Map([["pg5::被压触发器", { page: "pg5", label: "被压触发器", verdict: "不符合", why: "样例" }]]);
    const j5a = judgeOcclusion("pg5", { aria: "被压触发器", text: "" }, o1, reg5);
    if (j5a.fail) problems.push(`对账语义⑤a：已登记的遮挡被判红 —— 会逼人删登记买绿（${j5a.fail.slice(0, 80)}）`);
    const j5b = judgeOcclusion("pg5", { aria: "没登记的触发器", text: "" }, o1, reg5);
    if (!j5b.fail) problems.push(`对账语义⑤b：未登记的遮挡没判红 —— 登记表成了免死金牌`);
    const j5c = judgeOcclusion("pg5", { aria: "被压触发器", text: "" }, o2, reg5);
    if (!j5c.fail) problems.push(`对账语义⑤c：登记了而屏上已无遮挡（修好没回写）没判红 —— 登记表会无声腐烂`);
  }

  // ── 解析器金丝雀⑥：§4.2.3 登记表解析（与主逻辑同一个 parseU8DebtRegistry）──────
  const md6 = [
    "#### 4.2.3 U8 遮挡登记",
    "",
    "| 页 | 触发器（aria 标签） | 判定 | 去向 |",
    "|---|---|---|---|",
    "| `what-if` | 这一页怎么用 | 不符合 | 去修 z-index |",
    "",
    "### 4.3 下一节",
    "| `what-if` | 不该被收到的行 | x | x |",
  ].join("\n");
  const reg6 = parseU8DebtRegistry(md6);
  if (!(reg6.size === 1 && reg6.has("what-if::这一页怎么用") && reg6.get("what-if::这一页怎么用").verdict === "不符合")) {
    problems.push(
      `解析器金丝雀⑥：§4.2.3 样例应解析出 1 条「what-if::这一页怎么用=不符合」，` +
        `实得 ${reg6.size} 条（${[...reg6.keys()].join(",") || "空"}）⇒ 判「登记表解析器坏了」。`,
    );
  }

  return { problems, r1, r2, o1, o2, o3 };
}

// ───────────────────────────────────────────────────────────────────────────────
// PRD §4 表：名册 + U1 判词 + §4.2.3 U8 遮挡欠账登记（现读不手抄 · 解析器自带金丝雀）
// ───────────────────────────────────────────────────────────────────────────────

/**
 * PRD §4.2.3「U8 遮挡登记表」解析 —— 与 B-1 的 U1 列对账是同一个道理：欠账要**显式登记**，
 * 门按对账语义判（登记的不符合 ⇒ 绿放行但照实印；屏上被压而表里没登记 ⇒ 红；
 * 登记了而屏上已修好 ⇒ 红，逼回写销账）。
 * 键 = `页::触发器标签`（标签 = 触发器的 aria-label，**全等匹配** —— 文案一改登记就失配、
 * 门当场红，这是刻意的：**登记不许无声腐烂**，改名必须连登记表一起改）。
 * 章节不存在 ⇒ 空表（全部修好时这是合法终态，不是异常）。
 * @returns {Map<string, {page:string, label:string, verdict:string, why:string}>}
 */
export function parseU8DebtRegistry(md) {
  const lines = md.split("\n");
  const i = lines.findIndex((l) => l.trim().startsWith("#### 4.2.3"));
  const reg = new Map();
  if (i < 0) return reg;
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (/^#{1,4}\s/.test(l.trim())) break; // 下一个同级或更高级标题 = 本节结束
    if (!l.trim().startsWith("|")) continue;
    const cs = l.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.replace(/\*\*/g, "").trim());
    if (cs.length < 3) continue;
    const page = (cs[0].match(/`([a-z0-9-]+)`/) ?? [])[1];
    if (!page) continue; // 表头 / 分隔行
    const label = cs[1].trim();
    if (!label || label === "触发器") continue;
    reg.set(`${page}::${label}`, { page, label, verdict: cs[2], why: cs[3] ?? "" });
  }
  return reg;
}

function prdRosterAndU1() {
  const md = readFileSync(join(ROOT, "docs", "PRD-harness-ux-adoption.md"), "utf8");
  const prd = parsePrdTable(md);
  const keys = prd.rows.map((r) => r.key);
  const u1 = {};
  for (const r of prd.rows) u1[r.key] = r.cells.U1;
  // 金丝雀：解析器自证。表里必有沙盘页且它必有 U1 判词；解析不到 ⇒ 报「工具坏了」，
  // **不许**报「表里没有这些页」（铁律 0.6：否定结论必须附金丝雀命中证据）。
  if (!keys.includes("sim-sandbox") || keys.length < 5 || !u1["sim-sandbox"]) {
    throw new ProbeBroken(
      `名册/U1 解析器金丝雀不中：解析到 ${keys.length} 页（${keys.join(",") || "空"}），` +
        `sim-sandbox 的 U1 格 = 「${u1["sim-sandbox"] ?? "（空）"}」。⇒ 判「解析器坏了」。`,
    );
  }
  return { keys, u1, u8Debt: parseU8DebtRegistry(md) };
}

// ───────────────────────────────────────────────────────────────────────────────
// dev server（mock 模式 · 零后端依赖 ⇒ 数据确定、可复现）
//   与 check-layout-legibility.mjs 同款的化境 plumbing；判据逻辑不在这里。
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
  const port = Number(process.env.BEHAVIOR_PROBE_PORT || 5191);
  const url = `http://127.0.0.1:${port}/`;
  const cwd = join(ROOT, "apps", "frontend-shell");
  if (!existsSync(join(cwd, "node_modules"))) {
    throw new ProbeBroken(
      `apps/frontend-shell/node_modules 不存在 —— 先 \`pnpm install --prefer-offline\`。（环境缺件，RC=2。）`,
    );
  }
  const child = spawn(
    "node",
    // ⚠ 必须 `--host 127.0.0.1`：vite 默认绑 `localhost`，在 macOS 上它解析成 ::1（IPv6），
    //   于是 `waitForServer(http://127.0.0.1:…)` 永远等不到 —— 本单实测踩过，RC=2 了一次。
    [join(cwd, "node_modules", "vite", "bin", "vite.js"), "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
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
// U8 逐页浮层扫描
// ───────────────────────────────────────────────────────────────────────────────
async function scanOverlays(page, pageId, debtRegistry) {
  const notes = [];
  const failures = [];
  // 上限 12 而不是 8：登记在 §4.2.3 的触发器若排在扫描上限之外，会被误判成「登记指向空气」。
  const found = await page.evaluate(findOverlayTriggersInPage, { rootSelector: ROOT_SEL, max: 12 });
  if (!found.ok)
    return { notes: [`${pageId} · U8：触发器扫描失败（${found.reason}）`], failures, triggers: 0, overlays: 0, matchedDebt: new Set(), debtConfirmed: 0 };
  const triggers = found.triggers;
  let overlaysSeen = 0;
  let debtConfirmed = 0;
  let sigCounter = 0;
  const matchedDebt = new Set();
  const labelSeen = new Map(); // 同名触发器序号（文档序 1 起）—— 登记键与 §4.2.3 表全靠它消歧
  // 基线浮层集（页面加载完就开着的，不算「触发出来的」）
  const base = await page.evaluate(listVisibleOverlaysInPage, { sig: `b${pageId}` });
  const baseMarks = new Set(base.map((o) => o.mark));
  for (const t of triggers) {
    const baseLabel = (t.aria || t.text || "").trim();
    const ord = (labelSeen.get(baseLabel) ?? 0) + 1;
    labelSeen.set(baseLabel, ord);
    t.debtLabel = ord > 1 ? `${baseLabel}#${ord}` : baseLabel;
    const label = `<${t.tag}>「${t.debtLabel}」`;
    let overlay = null;
    // 先悬停（InfoPopover 的契约就是悬停展开）
    await page.hover(t.sel).catch(() => {});
    await page.waitForTimeout(400);
    let now = await page.evaluate(listVisibleOverlaysInPage, { sig: `s${pageId}${sigCounter++}` });
    let fresh = now.filter((o) => !baseMarks.has(o.mark));
    if (!fresh.length) {
      // 悬停没开 ⇒ 再点一下（幂等展开型触发器）；**这不是 B-1 的「按钮」**，B-1 管的是输入→结果。
      await page.click(t.sel).catch(() => {});
      await page.waitForTimeout(400);
      now = await page.evaluate(listVisibleOverlaysInPage, { sig: `s${pageId}${sigCounter++}` });
      fresh = now.filter((o) => !baseMarks.has(o.mark));
    }
    if (fresh.length) {
      overlay = fresh[0];
      overlaysSeen++;
      const occ = await page.evaluate(measureOcclusionInPage, { overlaySelector: overlay.sel, rootSelector: ROOT_SEL });
      const j = judgeOcclusion(pageId, t, occ, debtRegistry);
      if (j.debtKey && debtRegistry?.has(j.debtKey)) {
        matchedDebt.add(j.debtKey);
        if (j.occluded && !j.fail) debtConfirmed++;
      }
      if (j.fail) failures.push(`触发器 ${label} 开出的 ${j.fail}`);
      else notes.push(`触发器 ${label} 开出的 ${j.note}`);
    } else {
      notes.push(`${pageId} · U8：触发器 ${label} 悬停+点击后无浮层 ⇒ 内联展开或无浮层（U8 合法形态之一，不判红）`);
      // 没开出浮层也可能是「登记了的那笔」—— 触发器在而浮层没开，登记照样算遇到
      // （没浮层可压 ⇒ 谈不上遮挡；若它登记在册 ⇒ 走「修好没回写」同款判据，逼销账）。
      const dk = `${pageId}::${t.debtLabel}`;
      if (debtRegistry?.has(dk)) {
        matchedDebt.add(dk);
        failures.push(
          `${pageId} · B-4·U8：§4.2.3 登记「${dk.split("::")[1]}」的浮层被压（不符合），` +
            `而真浏览器里这个触发器**根本没开出浮层** —— 登记与实况脱节。⇒ 销账（删那一行）或查明浮层为何不开。`,
        );
      }
    }
    // 收场：Esc + 挪走鼠标，免得浮层串到下一个触发器的量测里
    await page.keyboard.press("Escape").catch(() => {});
    await page.mouse.move(2, 2).catch(() => {});
    await page.waitForTimeout(250);
  }
  return { notes, failures, triggers: triggers.length, overlays: overlaysSeen, matchedDebt, debtConfirmed };
}

// ───────────────────────────────────────────────────────────────────────────────
// 主流程
// ───────────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const wantSelftest = argv.includes("--selftest");
  const wantReport = argv.includes("--report");
  const pagesArg = (argv.find((a) => a.startsWith("--pages=")) || "").slice(8);
  const onlyPages = pagesArg ? pagesArg.split(",").filter(Boolean) : null;

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
      `✓ 金丝雀双侧通过 —— 必咬①改输入即变探到 changed（${canary.r1.latencyMs}ms）· ` +
        `必咬②提交闸探到 unchanged 且对「符合」格判红、对「不符合」格放行 · ` +
        `必咬②b纯回显归因为 echo 并按「没重演」判 · 判据单元四向（混合/全变×符合/不符合）· ` +
        `必咬③被压浮层报出 ${canary.o1.occludedBy?.length ?? "?"}/${canary.o1.samples ?? "?"} 个被压采样点并判红` +
        `（方位 ${canary.o1.occludedBy?.map((p) => p.cell).join("/") ?? "?"} · byRect/occludedRect 精确命中夹具真值）· ` +
        `方位变异向只压右下角报出且只报出「${canary.o3?.occludedBy?.[0]?.cell ?? "?"}」· ` +
        `必不咬置顶浮层 0 误报且盖住了 ${canary.o2.coveredEls ?? "?"} 个文本元素（covers 带被盖元素矩形）· ` +
        `对账⑤三向（登记遮挡放行 / 未登记遮挡判红 / 修好没回写判红）· 解析⑥§4.2.3 登记表。`,
    );
    if (wantSelftest) {
      console.log("✓ --selftest 通过（金丝雀九向：B-1 双向 + 回显归因 + 判据单元 + U8 双向 + 方位变异 + 对账三向 + 登记表解析）。");
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

    const { keys, u1, u8Debt } = prdRosterAndU1();
    const targets = onlyPages ?? keys;
    if (onlyPages) {
      const alien = onlyPages.filter((k) => !keys.includes(k));
      if (alien.length) throw new ProbeBroken(`--pages 里有名册没有的页：${alien.join(", ")}`);
      console.log(`· 只跑指定页：${targets.join(", ")}（名册全量 ${keys.length} 页现读自 PRD §4 表）`);
    } else {
      console.log(`· 页名册 ${keys.length} 页现读自 PRD §4 表（不手抄）：${keys.join(", ")}`);
    }
    if (u8Debt.size) {
      console.log(`· §4.2.3 U8 遮挡欠账登记 ${u8Debt.size} 笔在册（对账：欠账属实放行 · 未登记遮挡判红 · 修好没回写判红）`);
    }

    const failures = [];
    const tally = { judged: 0, noInput: 0, unstable: 0, triggers: 0, overlays: 0, debtConfirmed: 0 };
    const matchedDebt = new Set();
    for (const key of targets) {
      console.log(`\n── ${key}（/v/${key} · 扫描根 \`${ROOT_SEL}\`）──`);
      let ctx;
      try {
        ctx = await openStablePage(browser, {
          baseUrl,
          route: `/v/${key}`,
          viewport: VIEWPORT,
          rootSelector: ROOT_SEL,
          login: LOGIN,
        });
      } catch (e) {
        if (e instanceof ProbeBroken || e?.probeBroken) throw e;
        throw e;
      }
      const page = ctx.page;
      try {
        // ── B-1：改一个输入、不点任何按钮、断言结果 DOM 在 N ms 内变了 ──────────
        const r = await probeInputReaction(page, { rootSelector: ROOT_SEL });
        const j = judgeReaction(key, r, u1[key]);
        if (r.status === "changed" || r.status === "unchanged") tally.judged++;
        else if (r.status === "no-input") tally.noInput++;
        else if (r.status === "unstable") {
          tally.unstable++;
          // 探针无法归因 = 这一页本次没查成 ⇒ 工具维度的事，RC=2 而不是「合格/不合格」。
          throw new ProbeBroken(
            `${key}：B-1 探针无法归因（${r.reason}）。本次结论作废 —— 不许读作「这一页改输入即重演」。`,
          );
        }
        if (j.fail) failures.push(j.fail);
        else console.log(`  ${j.note}`);

        // ── B-4·U8：浮层 z-order × 矩形相交遮挡判定（对 §4.2.3 登记表对账）────────
        const u8 = await scanOverlays(page, key, u8Debt);
        tally.triggers += u8.triggers;
        tally.overlays += u8.overlays;
        tally.debtConfirmed += u8.debtConfirmed;
        for (const k of u8.matchedDebt) matchedDebt.add(k);
        for (const n of u8.notes) console.log(`  ${n}`);
        for (const f of u8.failures) failures.push(f);
        if (!u8.triggers) console.log(`  ${key} · U8：页内无浮层触发器候选（[aria-expanded]/[aria-haspopup]）`);
      } finally {
        await page.close().catch(() => {});
      }
    }

    // ── §4.2.3 登记指向空气：扫过的页里，登记了却没遇到的触发器 ⇒ 红（登记不许无声腐烂）
    const scannedPages = new Set(targets);
    for (const [k, d] of u8Debt) {
      if (scannedPages.has(d.page) && !matchedDebt.has(k)) {
        failures.push(
          `${d.page} · B-4·U8：§4.2.3 登记了「${d.label}」的浮层遮挡，但这一页扫遍触发器也没遇到它 —— ` +
            `登记指向空气（触发器改名/删了却没销账）。⇒ 把那一行改成现名，或删掉销账。`,
        );
      }
    }

    // ── 独立口径（金丝雀证明不了的那一半：扫描面到底够没够着东西）─────────────
    console.log(
      `\n══ 合计：B-1 判了 ${tally.judged} 页 · 未判（无可编辑输入）${tally.noInput} 页 · ` +
        `U8 触发器 ${tally.triggers} 个 · 开出浮层 ${tally.overlays} 个` +
        `${u8Debt.size ? ` · §4.2.3 欠账 ${tally.debtConfirmed}/${u8Debt.size} 笔照单属实` : ""} ══`,
    );
    if (!onlyPages) {
      if (tally.judged === 0) {
        throw new ProbeBroken(
          `B-1 独立口径不过：${targets.length} 页**一页都没判成**（全部 no-input/unstable）。` +
            `代码里明明有带输入的推演页 ⇒ 判「探针坏了」，不许报「页面都没提交闸」。`,
        );
      }
      if (tally.triggers === 0) {
        throw new ProbeBroken(
          `U8 独立口径不过：${targets.length} 页**一个浮层触发器都没找到**。` +
            `代码里明明有 InfoPopover（aria-expanded 触发器）⇒ 判「探针坏了」，不许报「没有浮层」。`,
        );
      }
      if (tally.overlays === 0) {
        throw new ProbeBroken(
          `U8 独立口径不过：找到 ${tally.triggers} 个触发器而**一个浮层都没开出来**。` +
            `InfoPopover 的契约是悬停即开 ⇒ 判「探针坏了」，不许报「浮层都没问题」。`,
        );
      }
    }

    await cleanup(browser, server);
    if (wantReport) {
      if (failures.length) {
        console.log(`\n· --report 实测到 ${failures.length} 条不一致（本模式不计红，照实印出）：`);
        for (const f of failures) console.log(`   - ${f}`);
      } else {
        console.log(`\n· --report：只打印实测，不判定（本次未测到不一致）。`);
      }
      process.exit(0);
    }
    if (failures.length) {
      console.error(`\n✗ harness-ux-behavior 不通过（${failures.length} 条）：`);
      for (const f of failures) console.error(`   - ${f}`);
      console.error(
        `\n   B-1 对账不一致：表说符合而屏上不变 ⇒ 修页面（输入接进入参/去提交闸）；` +
          `表说不符合而屏上已变 ⇒ 回写 §4 表该格并跑 check-sim-ux-criteria.mjs --tighten。` +
          `\n   U8 浮层被压：修 z-index / 堆叠上下文；确需挂账 ⇒ 显式登记 PRD §4.2.3 并写清去向；` +
          `修好了 ⇒ 删登记行销账。两类的共同点：**不许改表买绿，也不许登记烂账**。`,
      );
      process.exit(1);
    }
    console.log(
      `\n✓ harness-ux-behavior 通过（B-1 对账 ${tally.judged} 页逐格一致 · ` +
        `U8 浮层 ${tally.overlays} 个无未登记遮挡` +
        `${u8Debt.size ? ` · §4.2.3 欠账 ${tally.debtConfirmed}/${u8Debt.size} 笔照单属实` : ""} · 时窗 ${REACTION_TIMEOUT_MS}ms）。`,
    );
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
