#!/usr/bin/env node
/**
 * WO 用户价值判据检查器 —— 派单前必跑，答不上来就不许派。
 *
 * ── 为什么要有它（仓主 2026-08-29 定）─────────────────────────────────────────
 * 仓主原话：「扫描每个 WO 的每个功能，审核其开发的功能对用户是有 100% 明确价值的，
 * 否则不开发。」
 *
 * 本仓已经为「造了没人能用的东西」付过的账（全部实测，非推断）：
 *   · 99 条本体切片里 **95 条是 hops=0 / paths:[] 的零跳存根**，只为撑「每个类型都有切片」
 *     这个覆盖率指标 —— 服务的是度量装置自己，不是任何用户。
 *   · **9 条图谱导航只画出 5 张图**；其中 `graph-mvp` 屏上写着「实色高亮 MVP 核心闭环」，
 *     实测与普通图谱**逐字节相同** —— 文字承诺了图上没有的东西。
 *   · **接口**机制齐全（专属契约 + 专属页面 + 真发布门），**只有 1 个实例**。
 *   · 决策台 4 个「有 N 种改法 ▸」按钮**点了什么都不发生**（`__hits=1`，屏幕 diff 为空）。
 *   · `/v/decision-console` 做完了**三处入口全无**，COO 打不开自己的决策台。
 *   · 11 类事件里 **10 类不写世界态** —— 用户把参数放大 6.7 倍，屏上一个数不动。
 *
 * ── 为什么是脚本不是检查清单 ─────────────────────────────────────────────────
 * CLAUDE.md 铁律 0.6 三级处置要求「机器先说话，不是人先想起来」，并且本仓已经自证：
 * **「检查清单是文档，不是机器，所以它一次都没拦住我。」**（`SOP-reviewer-claim-discipline.md`
 * 第 11 条错账）。门被仓主禁令 3 冻结，检查清单已自证无效 ⇒ 只剩「派单必经的脚本」这条路。
 *
 * ── 判据（三问，缺一不可）───────────────────────────────────────────────────
 *   ① 谁会看见它？          —— 必须点名**角色 + 屏上位置**，位置要能被本脚本解析成一条真路由
 *   ② 他前后看到的有什么不同？—— 必须给**两个具体的数或原文**，形容词不算
 *   ③ 不做会怎样？          —— 落在「审核方会再犯一次记账错误」⇒ B 类 ⇒ 禁令 1 已禁止开工
 *
 * 用法：
 *   node scripts/wo-value-check.mjs --wo WO-XXX \
 *     --who "COO · /v/decision-console 区③" \
 *     --diff "修前屏上『0.91%』，修后『91.1%』" \
 *     --cost "COO 会按 0.91% 这个数判断计划达成率严重不达标，实际是 91.1%"
 *   node scripts/wo-value-check.mjs --selftest     # 金丝雀：拿已知好/坏样本各跑一遍
 *
 * 退出码：0 = 三问都过；1 = 有问题（打印哪一问、为什么）；2 = 用法错。
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 形容词/空话黑名单 —— 命中即判「这不是一个可测量的差别」。 */
const VAGUE = [
  "更好", "更清晰", "更完善", "更友好", "更方便", "提升体验", "优化体验",
  "增强", "改善", "完善", "更合理", "更准确", "提高质量", "更规范",
  "better", "improve", "enhance", "optimize", "cleaner", "nicer",
];

/** B 类判据 —— 仓主禁令 1 的原话形态：只服务于「审核方少犯一次记账错误」。 */
const B_CLASS = [
  "记账", "台账", "对账", "销号", "覆盖率", "记号", "度量装置",
  "基线 json", "棘轮", "审核方", "统计口径",
];

/** ② 至少要有两个「具体的东西」：两个数，或两段带引号的屏上原文。 */
function countConcrete(s) {
  const nums = (s.match(/-?\d[\d,]*\.?\d*\s*(%|px|条|个|张|天|亿|万|元|倍|次|ms|秒)?/g) ?? [])
    .filter((t) => /\d/.test(t));
  const quoted = s.match(/[「『"'"][^」』"'"]{1,80}[」』"'"]/g) ?? [];
  return { nums: nums.length, quoted: quoted.length, total: nums.length + quoted.length };
}

/**
 * ① 位置能不能解析成一条真路由。
 *
 * ⚠ **这个函数第一版是错的，金丝雀当场咬出来了 —— 病因值得写下来防复发。**
 * 第一版判据是「键是否出现在 `App.tsx` 里」，于是把真实存在的 `/v/dash` 判成「路由不存在」。
 * 真机制：`App.tsx:159` 有一条**通配路由** `{ path: "v/:viewKey", element: <ViewPage /> }`，
 * 视图键来自**后端 `workspace.views` 下发**，压根不在前端源码里；只有少数专用页
 * （`/v/sim-unified`、`/v/decision-console` 等）才以静态段出现在 `App.tsx`。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『这个键出现在 App.tsx 里』当作『这条路由存在』的证据，而前者并不度量后者。」**
 *
 * 改正后的三态（**不许把第三态当成否证**）：
 *   · `static`   —— 静态段命中，确实存在
 *   · `wildcard` —— 有通配路由兜底 ⇒ **静态上无法否证**，本脚本不下结论、不拦
 *   · `missing`  —— 既无静态段又无通配路由 ⇒ 才敢说不存在
 */
function resolveRoute(who) {
  const m = who.match(/\/(?:v|o|admin)\/[A-Za-z0-9_\-:/]+/);
  if (!m) return { found: false, path: null, verdict: null };
  const path = m[0];
  const appPath = join(ROOT, "apps/frontend-shell/src/App.tsx");
  if (!existsSync(appPath)) return { found: true, path, verdict: "unreadable" };
  const app = readFileSync(appPath, "utf8");
  const seg = path.replace(/^\//, "").split("/")[0]; // v | o | admin
  const key = path.replace(/^\/(v|o|admin)\//, "").split("/")[0];
  if (new RegExp(`["'\`]${seg}/${key}["'\`]`).test(app) || app.includes(`path="${key}"`)) {
    return { found: true, path, verdict: "static" };
  }
  // helper 建的路由：`admin("ontology-relations", <Page />)` —— 路径段由 helper 拼，
  // 字面 `path: "admin/xxx"` 一次都不出现。
  //
  // 形态（CLAUDE.md 铁律 0.6 句式）——这条假阴性 2026-08-30 被金丝雀当场抓到：
  //   **「我用『这个键没以 `path:` 字面形式出现』当作『这条路由不存在』的证据，
  //     而前者并不度量后者。」**
  // 对照实验：`/admin/org`（字面 path）✅ 过；`/admin/slices`（helper 建）🔴 被误判不存在，
  // 而 SlicesPage 真实存在且 E2E 测试在它上面建过切片。
  // 一道会对半数 admin 路由喊狼来了的门，迟早被习惯性绕过 —— 那时它就彻底不工作了。
  if (new RegExp(`\\b${seg}\\(\\s*["'\`]${key}["'\`]`).test(app)) {
    return { found: true, path, verdict: "static" };
  }
  // 通配兜底：`v/:viewKey` / `o/:type/:key` 这类
  if (new RegExp(`["'\`]${seg}/:`).test(app)) return { found: true, path, verdict: "wildcard" };
  return { found: true, path, verdict: "missing" };
}

function judge({ wo, who, diff, cost }) {
  const problems = [];
  const notes = [];

  // ── ① 谁会看见 ──────────────────────────────────────────────────────────
  if (!who || who.trim().length < 6) {
    problems.push("① 谁会看见它：没答，或太短。必须点名**角色 + 屏上位置**。");
  } else {
    const hasRole = /COO|CEO|运营|计划员|排产|采购|财务|供应商|客户|管理员|planner|admin|专员|经理/.test(who);
    if (!hasRole) problems.push("① 没点名**角色**。「用户」「使用者」不算 —— 说清是谁。");
    const r = resolveRoute(who);
    if (!r.found) {
      problems.push("① 没给**屏上位置**（形如 `/v/xxx`）。答不出位置，通常意味着这东西没有屏。");
    } else if (r.verdict === "missing") {
      problems.push(
        `① 位置 \`${r.path}\` 既无静态路由也无通配兜底 ⇒ **这条路由不存在**。` +
          "本单要顺带造它就写明；否则做出来没人到得了（本仓刚发生过：决策台做完三处入口全无，COO 打不开）。",
      );
    } else if (r.verdict === "wildcard") {
      notes.push(
        `① \`${r.path}\` 走通配路由（视图键由后端 \`workspace.views\` 下发）⇒ **静态上无法否证，本脚本不下结论**。` +
          "⚠ 但「路由通」≠「用户到得了」——**导航入口要另外验**。",
      );
    } else if (r.verdict === "unreadable") {
      notes.push("① 位置无法核对（读不到 App.tsx）—— 本脚本不假装验过。");
    }
  }

  // ── ② 前后差什么 ────────────────────────────────────────────────────────
  if (!diff || diff.trim().length < 6) {
    problems.push("② 前后有什么不同：没答。**这一问答不出来 = 这个单没法验收**（铁律 1.5）。");
  } else {
    const c = countConcrete(diff);
    if (c.total < 2) {
      problems.push(
        `② 只给了 ${c.total} 个具体的东西（数 ${c.nums} · 屏上原文 ${c.quoted}），**至少要两个**：` +
          "修前一个、修后一个。「变得更准」不是差别，「0.91% → 91.1%」才是。",
      );
    }
    const hit = VAGUE.filter((v) => diff.toLowerCase().includes(v.toLowerCase()));
    if (hit.length) {
      problems.push(`② 出现形容词：${hit.join(" / ")}。形容词不可验收 —— 换成两个能被量出来的值。`);
    }
  }

  // ── ③ 不做会怎样 ────────────────────────────────────────────────────────
  if (!cost || cost.trim().length < 6) {
    problems.push("③ 不做会怎样：没答。答不出代价，说明没人在等这件事。");
  } else {
    const hit = B_CLASS.filter((b) => cost.toLowerCase().includes(b.toLowerCase()));
    if (hit.length) {
      problems.push(
        `③ 代价落在【${hit.join(" / ")}】上 ⇒ 按仓主禁令 1 的判据这是 **B 类**：` +
          "「这道门/这笔账删了，用户会不会看到坏东西？不会，只是审核方会再犯一次记账错误」⇒ **禁止开工**。\n" +
          "     唯一例外：它已经让四包 gate 变红（那是解除阻塞不是维护记账）—— 是的话请在 --cost 里点名哪条红、红在哪。",
      );
    }
  }

  return { wo, problems, notes };
}

function render(res) {
  const ok = res.problems.length === 0;
  const line = "─".repeat(72);
  console.log(line);
  console.log(`WO 用户价值判据 · ${res.wo ?? "(未命名)"}`);
  console.log(line);
  if (ok) {
    console.log("✅ 三问都过 —— 可以派。把下面这段抄进派单第一段：\n");
    console.log("## 这个单对用户的价值（派单前已过 wo-value-check）");
    console.log(`- **谁会看见**：${res.who}`);
    console.log(`- **前后差什么**：${res.diff}`);
    console.log(`- **不做会怎样**：${res.cost}`);
    console.log("\n⚠ 交付时必须回填「② 前后差什么」的**实测两个数**。与派单预期不符要顶回来，不许改数迁就。");
  } else {
    console.log("🔴 不许派 —— 下列各条必须先答上来：\n");
    res.problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}\n`));
  }
  res.notes.forEach((n) => console.log(`  ⓘ ${n}`));
  console.log(line);
  return ok;
}

/** 金丝雀：拿本会话真实发生过的好/坏样本各跑一遍，证明这把尺子两头都咬得住。 */
function selftest() {
  const cases = [
    {
      name: "【好】计划达成率 100× 显示错（真实交付过）",
      expect: true,
      wo: "WO-KPI-RATIO",
      who: "COO · /v/dash 首屏「计划达成率」卡",
      diff: "修前屏上大数字「0.91%」而注脚「差 8.9pt」自相矛盾；修后「91.1%」与注脚一致",
      cost: "COO 会按 0.91 判断计划达成率崩了，实际是 91.1，据此做的产能决策方向相反",
    },
    {
      name: "【坏】只服务覆盖率指标的零跳切片存根",
      expect: false,
      wo: "WO-COVERAGE-STUBS",
      who: "审核方 · 切片注册表",
      diff: "覆盖率从 4/98 提到 99/98",
      cost: "覆盖率统计对不上，台账要记一笔",
    },
    {
      name: "【坏】形容词当验收判据",
      expect: false,
      wo: "WO-VAGUE",
      who: "COO · /v/decision-console",
      diff: "让方案对比更清晰、体验更好",
      cost: "用户看不懂四栏",
    },
    {
      name: "【坏】没有屏、没有角色",
      expect: false,
      wo: "WO-NO-SCREEN",
      who: "用户",
      diff: "从 3 条变成 7 条",
      cost: "以后不好维护",
    },
  ];
  let bad = 0;
  for (const c of cases) {
    const r = judge(c);
    const got = r.problems.length === 0;
    const ok = got === c.expect;
    if (!ok) bad++;
    console.log(`${ok ? "✅" : "❌"} ${c.name} — 期望 ${c.expect ? "放行" : "拦下"}，实得 ${got ? "放行" : "拦下"}`);
    if (!ok) r.problems.forEach((p) => console.log(`      ${p.split("\n")[0]}`));
  }
  console.log(
    bad === 0
      ? "\n金丝雀 4/4 通过 —— 好样本放行、三种坏样本各自被不同的一问拦下，尺子两头都咬得住。"
      : `\n🔴 金丝雀 ${bad} 条不符：这把尺子本身坏了，**不许拿它的结论去派单**。`,
  );
  return bad === 0;
}

// ── main ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes("--selftest")) process.exit(selftest() ? 0 : 1);

const get = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
};
const input = { wo: get("wo"), who: get("who"), diff: get("diff"), cost: get("cost") };
if (!input.who && !input.diff && !input.cost) {
  console.error(
    "用法：node scripts/wo-value-check.mjs --wo <编号> --who <角色+屏上位置> --diff <修前修后两个数> --cost <不做会怎样>\n" +
      "      node scripts/wo-value-check.mjs --selftest",
  );
  process.exit(2);
}
const res = judge(input);
res.who = input.who; res.diff = input.diff; res.cost = input.cost;
process.exit(render(res) ? 0 : 1);
