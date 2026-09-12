#!/usr/bin/env node
/**
 * 门 `dsh-dormancy:check` · **外部 agent 运行时（dsh）休眠护栏门**（WO-DSH-FUSE-GUARDS）
 *
 * ══ 治什么 ═══════════════════════════════════════════════════════════════════════
 * POC 分支 `claude/handoff-wo-dsh-poc-s1` @ `6b9a7558` 把外部 agent 运行时
 * **dsh（deepseek-harness）** 接进来当 agent 执行层（替掉 `runAgentLoop` 那一层，
 * **不替代 AgentCore 本体** —— 租户/鉴权/entitlement/审计/SSE 外壳、三件套治理面、
 * 规则引擎、workflow 引擎全部保留）。路线是**出进程 JSON-RPC**：外部闭包收在
 * `packages/dsh-harness`，`apps/agentcore` 只依赖两个协议包，走 `DSH_HARNESS=1` 的
 * **休眠分叉** —— flag 关时动态 import 不加载。
 *
 * 审核方裁决：**代码可以并，flag 不能翻**（理由见 `docs/DECISION-dsh-fusion.md`）。
 *
 * 而「休眠分叉」这个安全性论证，**只在它真休眠时成立**。裁决落地时，仓里
 * **没有任何机制拦住以后有人把它打开**，也没有任何机制拦住静态 import 悄悄扩散
 * （扩散一处，flag 关着也照加载，休眠当场失效）。**本门就是那个机制本体** ——
 * 让「不能翻」由机器守住，不靠人记得。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『今天它是休眠的』当作『它会一直休眠』的证据，而前者并不度量后者。」**
 *
 * ⚠ 本门**不评价** dsh 该不该用、也不阻止把 POC 代码并进 canonical。
 *   它只守一件事：**并进来之后必须保持休眠**，直到三条前置条件（决策文档 §3）被逐条销账。
 *
 * ══ 三条判据（任一破即 RC=1）═════════════════════════════════════════════════════
 *   **D1 · 部署面不许开 flag**
 *        `docker-compose*.yml` / `deploy/**` / `Dockerfile*` / `*.env*` / CI 配置里
 *        出现 `DSH_HARNESS` 被设成真值（含 `${DSH_HARNESS:-1}` 这种**缺省即开**的写法）即红。
 *        显式设 `0`/`false` 不红 —— 那是在**加固**休眠，不是在破坏它。
 *   **D2 · 静态 import 不许扩散**
 *        `apps/<pkg>/src` 与 `packages/<pkg>/src` 全树里对 `@deepseek-ai/…` 的**静态** import
 *        只许出现在 `apps/agentcore/src/dsh-runtime/` 目录内。出现在别处即红 ——
 *        静态 import 在**链接期**加载，flag 关着也照跑，休眠当场失效。
 *   **D3 · 入口只许有一个**
 *        `import("./dsh-runtime/…")` 这种动态入口全仓**至多 1 处**，且**必须**被
 *        `process.env.DSH_HARNESS` 的判断包住。多于 1 处、或有裸入口（不带判断的动态入口 /
 *        从 dsh-runtime 目录外静态 import 它）即红。
 *
 * ══ 金丝雀（保命判据 · 每次运行都先跑）════════════════════════════════════════════
 * 开扫之前先拿内嵌样例过一遍**与主逻辑同一份实现**的 `scanDeployText` / `scanSourceText`
 * —— **不另抄正则**。抄一份就是装饰品：改主正则时金丝雀拿旧的去测、照样绿
 * （本仓 2026-08-08 实测抓到过这个坏法）。
 * 金丝雀分三组，每条都对应一个**真实会踩的**坑：
 *   · D1 组：`DSH_HARNESS_PROVIDER=…` **不许**被读成 `DSH_HARNESS`（前缀陷阱 —— POC 的
 *     `engine.ts:509` 真有这个变量）；注释掉的 flag 不算数；行尾带注释的真 flag 仍要咬。
 *   · D2 组：`join(dir, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js")`
 *     **不许**被读成 import —— 这是 POC `runner.ts:60` 的**真实形状**，朴素
 *     `grep '@deepseek-ai'` 会把它算成第 2 处静态 import，于是「1 处」变「2 处」，
 *     「休眠属实」当场被读成「已经扩散」，结论正好相反。
 *   · D3 组：裸入口要咬、带判断的单一入口不许咬、两处入口要咬。
 * 任一不中 ⇒ 打印「⛔ 门自己瞎了」并 **RC=2**，**不许**报「仓库很干净」。
 *
 * ══ 扫描面下界（否定结论的前提）═══════════════════════════════════════════════════
 * 报「零处 / 不存在」这类**否定结论**之前，必须先证明**扫到了东西**：
 * 部署面枚举不到 `docker-compose.yml`、或源码面文件数低于下界 ⇒ 报「工具坏了」（RC=2），
 * **不许**报「部署面很干净」。（本仓血账：含通配的 pathspec 当目录前缀用时恒 0 命中，
 * 若信了会得出「全仓都是死代码」这个恰好相反的结论。）
 *
 * ══ 诚实边界（本门做不到什么 · 不许当成「dsh 已被彻底关住」）══════════════════════
 *  · **本门不解析 TypeScript**（worktree 常常没有 `node_modules`，装个解析器就等于把门的
 *    可用性绑在依赖上）。D2/D3 走**剥注释 + 掩字符串**的词法近似，不是 AST。
 *    因此 D3 的「被判断包住」只证明**结构上**外层 `if` 的条件里提到了
 *    `process.env.DSH_HARNESS`，**不证明语义上真的关得住**（`if (true || process.env.DSH_HARNESS)`
 *    照样算过）。要更强的保证，只能等门能稳定拿到解析器。
 *  · **只守静态面，不守运行时**。有人在容器里 `docker exec -e DSH_HARNESS=1` 手动开，
 *    或用编排层（k8s / systemd unit / CI secret）注入，本门一律看不见 —— 它守的是
 *    **仓里的部署面文件**，不是**真实运行的进程**。
 *  · **`packages/dsh-harness/` 不在 D2 扫描面内**：该包今天没有 `src/`，外部闭包以
 *    `plugins/*.mjs` + `cordis.yml` 形式存在，由 dsh 自己的 loader 按**名字**加载、
 *    不经我方 import。若将来它加了 `src/`，需同批决定是加进白名单还是加进扫描面。
 *  · **D1 忽略注释行**。注释里的 `DSH_HARNESS=1` 是**惰性**的（说明文档常这么写），
 *    但代价是：靠注释伪装的开关本门看不见。剥注释这一步本身被金丝雀双向咬住
 *    （注释里的不咬 ∧ 行尾带注释的真 flag 仍咬）。
 *
 * ══ 退出码三分（1 和 2 撞码 = 读的人分不出「仓库真有问题」和「门没跑起来」）═════════
 *   0 干净 · 1 真违规（D1/D2/D3 明确判负）· 2 门自己坏了（金丝雀不中 / 读不到文件 /
 *   扫描面塌了 ⇒ **本次结论作废**）。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-DSH-DORMANT-UNGUARDED`。
 * 门账：scripts/gate-ledger.json（同批登账，否则新门天然免疫 gate-ledger:check 治理）。
 * 决策文档：docs/DECISION-dsh-fusion.md（裁决 + 三条翻 flag 前置条件 + 四条复核事实）。
 *
 * 用法：
 *   node scripts/check-dsh-dormancy.mjs             # 门（0 干净 / 1 真违规 / 2 工具坏了）
 *   node scripts/check-dsh-dormancy.mjs --census    # 全表：扫描面、命中、入口清单
 *   node scripts/check-dsh-dormancy.mjs --selftest  # 金丝雀 + 三条变异反证 + 退出码三分机验
 */

/* ── 兜底必须**最先**注册：它要覆盖的正是「后面任何一行崩了」──────────────────────
 * 实测（node v22+）：顶层同步 throw 走 `uncaughtException`，顶层 await 之后的 throw 走
 * `unhandledRejection` —— 两个都要挂，只挂一个有洞。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（不带兜底的新门会被它当场判红）。 */
process.on("uncaughtException", (e) => bail(e));
process.on("unhandledRejection", (e) => bail(e));
function bail(e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

/* ═══════════════════════════════════════════════════════════════════════════════
 * RC=2 统一出口 —— **任何**「我没能完成扫描」的情形一律走这里
 * ═══════════════════════════════════════════════════════════════════════════════ */
function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「部署面干净 / dsh 仍在休眠 / 通过」——");
  console.error("   本门这次根本没有扫描成功，它什么都没证明。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2); // 2 = 工具自己坏了（1 是「真有违规」，两者处置完全相反，不许合并）
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * 词法：剥注释 / 掩字符串（D2·D3 共用；金丝雀双向咬住这一步）
 *
 * 两个产物**长度与原文一致**（被替换的字符换成空格，换行保留），故位置/行号可直接对位。
 *   · noComments —— 注释体变空格，**字符串内容保留**（import 说明符要读得到）
 *   · masked     —— 在 noComments 之上再把**字符串内容**变空格（花括号计数不被字符串带偏）
 * ═══════════════════════════════════════════════════════════════════════════════ */
export function lexJs(src) {
  const n = src.length;
  const noComments = src.split("");
  const strSpans = [];
  let i = 0;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (noComments[k] !== "\n") noComments[k] = " "; };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") { const j = src.indexOf("\n", i); const e = j < 0 ? n : j; blank(i, e); i = e; continue; }
    if (c === "/" && d === "*") { const j = src.indexOf("*/", i + 2); const e = j < 0 ? n : j + 2; blank(i, e); i = e; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === q) break;
        j++;
      }
      strSpans.push([i + 1, Math.min(j, n)]);
      i = Math.min(j + 1, n);
      continue;
    }
    i++;
  }
  const noCommentsStr = noComments.join("");
  const maskedArr = noCommentsStr.split("");
  for (const [a, b] of strSpans) for (let k = a; k < b; k++) if (maskedArr[k] !== "\n") maskedArr[k] = " ";
  return { noComments: noCommentsStr, masked: maskedArr.join("") };
}

/** 剥掉 `#` 行注释（YAML / Dockerfile / .env 共用）。长度不变，行号可对位。 */
export function stripHashComments(src) {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  let inS = null;
  while (i < n) {
    const c = src[i];
    if (c === "\n") { inS = null; i++; continue; }
    if (inS) { if (c === inS) inS = null; i++; continue; }
    if (c === '"' || c === "'") { inS = c; i++; continue; }
    if (c === "#") { let j = i; while (j < n && src[j] !== "\n") { out[j] = " "; j++; } i = j; continue; }
    i++;
  }
  return out.join("");
}

const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

/* ═══════════════════════════════════════════════════════════════════════════════
 * D1 · 部署面 flag 探测（判据本体 —— 金丝雀与主扫描共用这一份）
 *
 * ⚠ 前缀陷阱：POC 里真有 `DSH_HARNESS_PROVIDER`（engine.ts:509）。`DSH_HARNESS` 后面
 *   必须跟**非标识符字符**，否则 `DSH_HARNESS_PROVIDER=deepseek` 会被读成「部署面开了 flag」。
 * ═══════════════════════════════════════════════════════════════════════════════ */
const FLAG = "DSH_HARNESS";
/** 真值集合：这些值一律视为「开了」。`${VAR:-1}` 这种**缺省即开**同样算开。 */
const TRUTHY = /^(1|true|yes|on|enabled)$/i;

/**
 * @returns {Array<{line:number, raw:string, value:string, why:string}>} 命中（= 违规）
 */
export function scanDeployText(src) {
  const text = stripHashComments(src);
  const hits = [];
  const re = new RegExp(String.raw`${FLAG}(?![A-Za-z0-9_])`, "g");
  let m;
  while ((m = re.exec(text))) {
    const at = m.index;
    // 取本行剩余部分做取值判定（compose `- K=V` / `K: V`、Dockerfile `ENV K V` / `ENV K=V`、.env `K=V`）
    const nl = text.indexOf("\n", at);
    const rest = text.slice(at + FLAG.length, nl < 0 ? text.length : nl);
    const rawLine = src.split("\n")[lineOf(text, at) - 1] ?? "";

    // `${DSH_HARNESS:-1}` / `${DSH_HARNESS:-true}` —— **缺省即开**，最阴的一种
    const def = /^\s*:-\s*([A-Za-z0-9_.]+)\s*\}/.exec(rest);
    if (def) {
      if (TRUTHY.test(def[1])) {
        hits.push({ line: lineOf(text, at), raw: rawLine.trim(), value: def[1], why: `\${${FLAG}:-${def[1]}} 缺省即开` });
      }
      continue;
    }
    // `=V` / `: V` / `  V`（Dockerfile 的 `ENV K V` 形态）
    const asg = /^\s*(?:=|:)?\s*["']?([A-Za-z0-9_.$-]+)["']?/.exec(rest);
    if (!asg) continue;
    let v = asg[1];
    if (v.startsWith("$")) continue;              // `DSH_HARNESS=$SOMETHING` —— 值来自外部，静态判不了
    if (TRUTHY.test(v)) hits.push({ line: lineOf(text, at), raw: rawLine.trim(), value: v, why: `${FLAG} 被设为真值 ${v}` });
  }
  return hits;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * D2 / D3 · 源码面探测（判据本体 —— 金丝雀与主扫描共用这一份）
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** `import … from "spec"` / `import "spec"` / `export … from "spec"` / `require("spec")` */
const RE_STATIC = /(?:^|[\s;}])(?:import|export)\s+(?:[\s\S]{0,400}?\sfrom\s*)?["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\)/g;
/** `import("spec")` —— 动态，含 `await import(...)` */
const RE_DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const RE_EXTERNAL = /^@deepseek-ai\//;
const RE_DSH_ENTRY = /(^|\/)dsh-runtime\//;

/**
 * @returns {{staticExternal:Array, dynamicExternal:Array, staticEntry:Array, dynamicEntry:Array}}
 *   每项 {line, spec, guarded?}
 */
export function scanSourceText(src) {
  const { noComments, masked } = lexJs(src);
  const out = { staticExternal: [], dynamicExternal: [], staticEntry: [], dynamicEntry: [] };

  let m;
  RE_STATIC.lastIndex = 0;
  while ((m = RE_STATIC.exec(noComments))) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    /* ⚠ 行号必须落在**关键字**上，不能落在 `m.index` 上：RE_STATIC 的前缀
     * `(?:^|[\s;}])` 会把上一行的换行符吃进匹配，于是 `m.index` 指向**上一行行尾**
     * ⇒ 报出来的 file:line 整体偏 1 行。实测抓到过：POC 的 `runner.ts` 第 13 行的
     * import 被报成 L12（门红了按行号点开是空行，读的人会以为门在瞎报）。
     * 金丝雀「行号必须落在关键字上」钉住这一条 —— 原来那条样例把 import 放在第 1 行，
     * 恰好走 `^` 分支，**永远测不出这个偏移**。 */
    const kw = m[0].search(/\b(?:import|export|require)\b/);
    const line = lineOf(noComments, m.index + (kw < 0 ? 0 : kw));
    if (RE_EXTERNAL.test(spec)) out.staticExternal.push({ line, spec });
    else if (RE_DSH_ENTRY.test(spec)) out.staticEntry.push({ line, spec });
  }

  RE_DYNAMIC.lastIndex = 0;
  while ((m = RE_DYNAMIC.exec(noComments))) {
    const spec = m[1];
    const line = lineOf(noComments, m.index);
    if (RE_EXTERNAL.test(spec)) out.dynamicExternal.push({ line, spec });
    else if (RE_DSH_ENTRY.test(spec)) out.dynamicEntry.push({ line, spec, guarded: guardedAt(masked, m.index) });
  }
  return out;
}

/**
 * 该位置是否落在一个「条件里提到 `process.env.DSH_HARNESS`」的块内。
 *
 * 无 AST 的近似：从命中处向前做花括号配平，找到最内层未闭合的 `{`，
 * 取它**前面**那段块头（到上一个 `;`/`{`/`}`/行首为止），看条件里有没有那个 env。
 * 逐层向外找，任一层命中即算被包住。诚实边界见文件头：这只证明**结构上**有判断。
 */
function guardedAt(masked, at) {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = masked[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth > 0) { depth--; continue; }
      // 找到一层未闭合的 `{` —— 取块头
      let s = i - 1;
      while (s >= 0 && !";{}".includes(masked[s])) s--;
      const header = masked.slice(s + 1, i);
      if (new RegExp(String.raw`process\.env\.${FLAG}(?![A-Za-z0-9_])`).test(header)) return true;
      // 继续向外层找
    }
  }
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * 扫描面枚举
 * ═══════════════════════════════════════════════════════════════════════════════ */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vite", "coverage", ".claude", ".turbo"]);

function walk(dir, hit, depth = 0) {
  if (depth > 8) return;
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    toolBroken(`读不到目录 ${relative(ROOT, dir) || "."}（${e?.message || e}）`);
  }
  for (const e of ents) {
    if (e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, hit, depth + 1); continue; }
    if (e.isFile()) hit(p);
  }
}

/**
 * 部署面归类器（**纯函数**，金丝雀与枚举器共用这一份）。
 *
 * ⚠ 这里踩过一个真坑，故单独抽成函数并加金丝雀：第一版的 env 判据写成
 *   `/(^|\.)env(\.|$)/` —— 它把 **`apps/frontend-shell/src/env.ts`** 也算进了部署面
 *   （`^env` + 后面跟 `.`）。后果不是漏报而是**范畴错误**：前端源码里任何一处
 *   `DSH_HARNESS` 字样都会被报成「部署面开了 flag」，而那根本不是部署面。
 *   形态（铁律 0.6 句式）：**「我用『文件名里有 env』当作『它是 env 文件』的证据。」**
 *   判据改为：必须有**字面的点**把 `env` 隔开 —— `.env` / `.env.x` / `x.env` / `x.env.y`。
 */
export function isDeployPath(rel) {
  const b = basename(rel);
  if (/^docker-compose.*\.ya?ml$/i.test(b)) return "compose";
  if (rel.startsWith("deploy/")) return "deploy-dir";
  if (/^Dockerfile/i.test(b) || /\.dockerfile$/i.test(b)) return "dockerfile";
  if (/^\.env(\..+)?$/i.test(b) || /\.env$/i.test(b) || /\.env\./i.test(b)) return "env";
  if (/^\.github\/workflows\/.+\.ya?ml$/i.test(rel)) return "ci";
  return null;
}

/** 部署面：docker-compose*.yml · deploy 目录 · Dockerfile* · *.env* · CI workflows */
export function listDeployFiles() {
  const out = [];
  walk(ROOT, (p) => {
    const rel = relative(ROOT, p).split(sep).join("/");
    if (isDeployPath(rel)) out.push(rel);
  });
  return out.sort();
}

/** 源码面：apps/<pkg>/src/** 与 packages/<pkg>/src/** 的 ts/tsx/js/mjs/cjs */
export function listSourceFiles() {
  const out = [];
  for (const top of ["apps", "packages"]) {
    const dir = join(ROOT, top);
    if (!existsSync(dir)) continue;
    for (const pkg of readdirSync(dir, { withFileTypes: true })) {
      if (!pkg.isDirectory() || SKIP_DIRS.has(pkg.name)) continue;
      const srcDir = join(dir, pkg.name, "src");
      if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) continue;
      walk(srcDir, (p) => {
        if (/\.(ts|tsx|js|mjs|cjs)$/.test(p)) out.push(relative(ROOT, p).split(sep).join("/"));
      });
    }
  }
  return out.sort();
}

/** D2 白名单：唯一允许静态 import 外部闭包的目录 */
const ALLOWED_STATIC_DIR = "apps/agentcore/src/dsh-runtime/";

const DEPLOY_FLOOR = 5;   // 部署面下界：低于它多半是 cwd 不对，不是「部署面很干净」
const SOURCE_FLOOR = 200; // 源码面下界：同上（本仓实测 613）

/* ═══════════════════════════════════════════════════════════════════════════════
 * 金丝雀 —— 喂样例给**上面那两个函数**，不另抄正则
 * ═══════════════════════════════════════════════════════════════════════════════ */

/* POC 的真实形状，逐字转写自 `claude/handoff-wo-dsh-poc-s1` @ 6b9a7558：
 * runner.ts:13 是唯一的静态 import；runner.ts:60 是**字符串路径**，朴素 grep 会把它
 * 误算成第 2 处 import —— 于是「休眠属实」被读成「已经扩散」，结论正好相反。 */
const POC_RUNNER_SHAPE = [
  'import { HarnessClient } from "@deepseek-ai/dsh-sdk-client";',
  "",
  "const spec = {",
  '  args: [join(harnessDir, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js"), "cordis.yml"],',
  "};",
].join("\n");

/* POC 的入口形状，逐字转写自 engine.ts:497-498。 */
const POC_ENTRY_SHAPE = [
  'if (process.env.DSH_HARNESS === "1") {',
  '  const { buildSessionSetup, mapSkill, runDshAgent } = await import("./dsh-runtime/index.js");',
  "  void buildSessionSetup; void mapSkill; void runDshAgent;",
  "}",
].join("\n");

const CANARIES = [
  // ── D1 组 ──────────────────────────────────────────────────────────────────
  { name: "D1·必咬·compose 列表形态 `- DSH_HARNESS=1`", kind: "deploy",
    src: "services:\n  agentcore:\n    environment:\n      - DSH_HARNESS=1\n",
    expect: (h) => h.length === 1 && h[0].value === "1" },
  { name: "D1·必咬·compose 映射形态 `DSH_HARNESS: \"1\"`", kind: "deploy",
    src: "services:\n  agentcore:\n    environment:\n      DSH_HARNESS: \"1\"\n",
    expect: (h) => h.length === 1 },
  { name: "D1·必咬·**缺省即开** `${DSH_HARNESS:-1}`（最阴的一种）", kind: "deploy",
    src: "      - DSH_HARNESS=${DSH_HARNESS:-1}\n",
    expect: (h) => h.length === 1 && /缺省即开/.test(h[0].why) },
  { name: "D1·必咬·Dockerfile `ENV DSH_HARNESS true`", kind: "deploy",
    src: "FROM node:22\nENV DSH_HARNESS true\n",
    expect: (h) => h.length === 1 && h[0].value === "true" },
  { name: "D1·必咬·行尾带注释的真 flag 仍要咬（剥注释不许把整行吃掉）", kind: "deploy",
    src: "      - DSH_HARNESS=1   # 临时打开试一下\n",
    expect: (h) => h.length === 1 },
  { name: "D1·必不咬·`DSH_HARNESS_PROVIDER` 前缀陷阱（POC engine.ts:509 真有这个变量）", kind: "deploy",
    src: "      - DSH_HARNESS_PROVIDER=deepseek\n      - DSH_HARNESS_DIR=/opt/harness\n",
    expect: (h) => h.length === 0 },
  { name: "D1·必不咬·显式关 `DSH_HARNESS=0` / `${DSH_HARNESS:-0}`（那是加固休眠）", kind: "deploy",
    src: "      - DSH_HARNESS=0\n      - OTHER=${DSH_HARNESS:-0}\n",
    expect: (h) => h.length === 0 },
  { name: "D1·必不咬·注释掉的 flag 是惰性的", kind: "deploy",
    src: "      # - DSH_HARNESS=1\n      # 说明：要打开就把上面这行放开\n",
    expect: (h) => h.length === 0 },

  // ── D2 组 ──────────────────────────────────────────────────────────────────
  { name: "D2·必咬·`import … from \"@deepseek-ai/…\"` 静态 import", kind: "source",
    src: 'import { HarnessClient } from "@deepseek-ai/dsh-sdk-client";\n',
    expect: (r) => r.staticExternal.length === 1 },
  { name: "D2·必咬·`export * from \"@deepseek-ai/…\"` re-export 形态（grep import 看不见）", kind: "source",
    src: 'export * from "@deepseek-ai/dsh-sdk-protocol";\n',
    expect: (r) => r.staticExternal.length === 1 },
  { name: "D2·必咬·`require(\"@deepseek-ai/…\")` CJS 形态", kind: "source",
    src: 'const p = require("@deepseek-ai/dsh-sdk-protocol");\n',
    expect: (r) => r.staticExternal.length === 1 },
  { name: "D2·必不咬·注释里的 import 不算数", kind: "source",
    src: '// import { X } from "@deepseek-ai/dsh-agent";\n/* import "@deepseek-ai/dsh-llm"; */\n',
    expect: (r) => r.staticExternal.length === 0 },
  { name: "D2·必不咬·**字符串路径**不是 import（POC runner.ts:60 的真实形状）", kind: "source",
    src: 'const args = [join(d, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js")];\n',
    expect: (r) => r.staticExternal.length === 0 },
  { name: "D2·必中且只中一处·POC runner.ts 真实形状（import ∧ 字符串路径各一处，只算 import）", kind: "source",
    src: POC_RUNNER_SHAPE,
    expect: (r) => r.staticExternal.length === 1 && r.staticExternal[0].line === 1 },
  { name: "D2·必咬·**行号必须落在关键字上**（前缀吃掉换行会整体偏 1 行 —— 真实踩过）", kind: "source",
    src: '\n\nconst a = 1;\nimport { X } from "@deepseek-ai/dsh-agent";\n',
    expect: (r) => r.staticExternal.length === 1 && r.staticExternal[0].line === 4 },
  { name: "D2·必不咬·动态 import 外部包不算静态扩散（链接期不加载）", kind: "source",
    src: 'const m = await import("@deepseek-ai/dsh-agent");\n',
    expect: (r) => r.staticExternal.length === 0 && r.dynamicExternal.length === 1 },

  // ── D3 组 ──────────────────────────────────────────────────────────────────
  { name: "D3·必不咬·带判断的单一动态入口（POC engine.ts:497-498 真实形状）", kind: "source",
    src: POC_ENTRY_SHAPE,
    expect: (r) => r.dynamicEntry.length === 1 && r.dynamicEntry[0].guarded === true },
  { name: "D3·必咬·裸动态入口（无 flag 判断）", kind: "source",
    src: 'const m = await import("./dsh-runtime/index.js");\n',
    expect: (r) => r.dynamicEntry.length === 1 && r.dynamicEntry[0].guarded === false },
  { name: "D3·必咬·换个 env 名的判断不算数（判据咬的是 DSH_HARNESS 本身）", kind: "source",
    src: 'if (process.env.SOMETHING_ELSE === "1") {\n  const m = await import("./dsh-runtime/index.js");\n}\n',
    expect: (r) => r.dynamicEntry.length === 1 && r.dynamicEntry[0].guarded === false },
  { name: "D3·必咬·两处入口（哪怕都带判断）", kind: "source",
    src: POC_ENTRY_SHAPE + "\n" + POC_ENTRY_SHAPE,
    expect: (r) => r.dynamicEntry.length === 2 },
  { name: "D3·必咬·**静态**入口 = 裸入口（flag 关着也照加载）", kind: "source",
    src: 'import { runDshAgent } from "./dsh-runtime/index.js";\n',
    expect: (r) => r.staticEntry.length === 1 },
  { name: "D3·必不咬·嵌套一层花括号仍认得出外层判断（花括号配平）", kind: "source",
    src: 'if (process.env.DSH_HARNESS === "1") {\n  const cfg = { a: 1 };\n  const m = await import("./dsh-runtime/index.js");\n  void cfg;\n}\n',
    expect: (r) => r.dynamicEntry.length === 1 && r.dynamicEntry[0].guarded === true },
  { name: "D3·必不咬·字符串里的花括号不许把配平带偏（掩字符串这一步真的生效）", kind: "source",
    src: 'if (process.env.DSH_HARNESS === "1") {\n  const s = "} fake close {";\n  const m = await import("./dsh-runtime/index.js");\n  void s;\n}\n',
    expect: (r) => r.dynamicEntry.length === 1 && r.dynamicEntry[0].guarded === true },

  // ── 部署面归类器组（第一版把 `src/env.ts` 算进部署面，是范畴错误，见 isDeployPath 顶注）──
  { name: "归类·必咬·docker-compose.yml / docker-compose.seed.yml", kind: "path",
    src: ["docker-compose.yml", "docker-compose.seed.yml"],
    expect: (r) => r.every((x) => x === "compose") },
  { name: "归类·必咬·Dockerfile / deploy 目录 / CI workflow", kind: "path",
    src: ["apps/agentcore/Dockerfile", "deploy/nginx.conf", ".github/workflows/gates.yml"],
    expect: (r) => r[0] === "dockerfile" && r[1] === "deploy-dir" && r[2] === "ci" },
  { name: "归类·必咬·`*.env*` 四种真形态（.env / .env.example / prod.env / app.env.local）", kind: "path",
    src: [".env", ".env.example", "ops/prod.env", "ops/app.env.local"],
    expect: (r) => r.every((x) => x === "env") },
  { name: "归类·必不咬·`src/env.ts` 不是部署面（真实踩过的范畴错误）", kind: "path",
    src: ["apps/frontend-shell/src/env.ts", "apps/datacore/src/environment.ts", "scripts/env-probe.mjs"],
    expect: (r) => r.every((x) => x === null) },
  { name: "归类·必不咬·普通 yaml / md 不是部署面", kind: "path",
    src: ["pnpm-workspace.yaml", "docs/DECISION-dsh-fusion.md", "packages/dsh-harness/cordis.yml"],
    expect: (r) => r.every((x) => x === null) },
];

function runCanaries() {
  const fails = [];
  for (const c of CANARIES) {
    let got;
    try {
      // ← 三种 kind 各自调**主扫描用的同一个函数**，不另抄正则
      got = c.kind === "deploy" ? scanDeployText(c.src)
        : c.kind === "path" ? c.src.map((p) => isDeployPath(p))
        : scanSourceText(c.src);
    } catch (e) {
      fails.push(`${c.name} —— 分析器抛异常：${e?.message || e}`);
      continue;
    }
    if (!c.expect(got)) fails.push(`${c.name} —— 实得 ${JSON.stringify(got)}`);
  }
  return fails;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * 故障 / 违规注入（--selftest 用；走的是**同一套**判据，不另开旁路）
 * ═══════════════════════════════════════════════════════════════════════════════ */
const INJECT_D1 = process.env.DSH_DORMANCY_INJECT_D1 === "1";
const INJECT_D2 = process.env.DSH_DORMANCY_INJECT_D2 === "1";
const INJECT_D3 = process.env.DSH_DORMANCY_INJECT_D3 === "1";

const VIRTUAL = new Map();
if (INJECT_D1) VIRTUAL.set("docker-compose.INJECTED.yml", "services:\n  agentcore:\n    environment:\n      - DSH_HARNESS=1\n");
if (INJECT_D2) VIRTUAL.set("apps/agentcore/src/INJECTED-spread.ts", 'import { HarnessClient } from "@deepseek-ai/dsh-sdk-client";\nexport const c = HarnessClient;\n');
if (INJECT_D3) VIRTUAL.set("apps/agentcore/src/INJECTED-bare-entry.ts", 'export const m = await import("./dsh-runtime/index.js");\n');

function readSrc(rel) {
  if (VIRTUAL.has(rel)) return VIRTUAL.get(rel);
  if (process.env.DSH_DORMANCY_FORCE_UNREADABLE === "1") {
    toolBroken("（故障注入）读不到扫描面文件", "这是 --selftest 在自检「读文件失败 ⇒ RC=2」这条路径。");
  }
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch (e) {
    toolBroken(`读不到 ${rel}（${e?.message || e}）`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * 主流程
 * ═══════════════════════════════════════════════════════════════════════════════ */
function analyze() {
  const deployFiles = [...listDeployFiles(), ...[...VIRTUAL.keys()].filter((k) => /ya?ml$|Dockerfile|\.env/i.test(k))];
  const sourceFiles = [...listSourceFiles(), ...[...VIRTUAL.keys()].filter((k) => /\.(ts|tsx|js|mjs|cjs)$/.test(k))];

  // ── 扫描面下界：报否定结论之前先证明扫到了东西 ────────────────────────────
  if (deployFiles.length < DEPLOY_FLOOR || !deployFiles.includes("docker-compose.yml")) {
    toolBroken(
      `部署面只枚举到 ${deployFiles.length} 个文件（下界 ${DEPLOY_FLOOR}，且必须含 docker-compose.yml）`,
      "多半是 cwd 不在仓根：本门必须在仓根跑。**不许**读作「部署面很干净」。",
    );
  }
  if (sourceFiles.length < SOURCE_FLOOR) {
    toolBroken(
      `源码面只枚举到 ${sourceFiles.length} 个文件（下界 ${SOURCE_FLOOR}，本仓实测 613）`,
      "多半是 cwd 不对或目录读错。**不许**读作「零静态 import」。",
    );
  }

  const d1 = [];
  for (const f of deployFiles) for (const h of scanDeployText(readSrc(f))) d1.push({ file: f, ...h });

  const d2 = [];
  const entriesDyn = [];
  const entriesStatic = [];
  const dynExternal = [];
  for (const f of sourceFiles) {
    const r = scanSourceText(readSrc(f));
    const allowed = f.startsWith(ALLOWED_STATIC_DIR);
    for (const h of r.staticExternal) if (!allowed) d2.push({ file: f, ...h });
    for (const h of r.dynamicExternal) dynExternal.push({ file: f, ...h });
    for (const h of r.dynamicEntry) entriesDyn.push({ file: f, ...h });
    // 从 dsh-runtime 目录**内部**互相静态 import 是包内实现，不算入口
    for (const h of r.staticEntry) if (!allowed) entriesStatic.push({ file: f, ...h });
  }
  return { deployFiles, sourceFiles, d1, d2, entriesDyn, entriesStatic, dynExternal };
}

function report(a) {
  const fail = [];

  // ── D1 ──────────────────────────────────────────────────────────────────────
  for (const h of a.d1) {
    fail.push(
      `[D1] 部署面开了 flag：${h.file}:${h.line}  ${h.why}\n` +
      `        原文：${h.raw}\n` +
      `        「休眠分叉」的安全性论证**只在它真休眠时成立**。翻 flag 需先销三条前置条件，` +
      `见 docs/DECISION-dsh-fusion.md §3。`,
    );
  }

  // ── D2 ──────────────────────────────────────────────────────────────────────
  for (const h of a.d2) {
    fail.push(
      `[D2] 静态 import 扩散到白名单外：${h.file}:${h.line}  ← "${h.spec}"\n` +
      `        只许出现在 ${ALLOWED_STATIC_DIR}。静态 import 在**链接期**加载 ——\n` +
      `        flag 关着也照跑，休眠当场失效。改法：挪进 ${ALLOWED_STATIC_DIR}，或改成 flag 判断内的动态 import。`,
    );
  }

  // ── D3 ──────────────────────────────────────────────────────────────────────
  for (const h of a.entriesStatic) {
    fail.push(
      `[D3] 裸入口（**静态** import dsh-runtime）：${h.file}:${h.line}  ← "${h.spec}"\n` +
      `        静态入口绕过 flag：模块在链接期就被加载。入口必须是 flag 判断内的动态 import。`,
    );
  }
  for (const h of a.entriesDyn) {
    if (!h.guarded) {
      fail.push(
        `[D3] 裸入口（动态 import 没有被 process.env.${FLAG} 的判断包住）：${h.file}:${h.line}  ← "${h.spec}"\n` +
        `        改法：外面包 \`if (process.env.${FLAG} === "1") { … }\`。`,
      );
    }
  }
  if (a.entriesDyn.length > 1) {
    fail.push(
      `[D3] dsh-runtime 入口 ${a.entriesDyn.length} 处，只许 1 处：\n` +
      a.entriesDyn.map((h) => `          · ${h.file}:${h.line}（${h.guarded ? "有判断" : "**裸入口**"}）`).join("\n") + "\n" +
      `        多入口 = 多个必须各自守住的开关，早晚漏一个。收敛成单一入口。`,
    );
  }

  return fail;
}

function printCensus(a) {
  console.log(`扫描面：部署面 ${a.deployFiles.length} 个文件 · 源码面 ${a.sourceFiles.length} 个文件`);
  console.log(`  部署面：${a.deployFiles.join(" · ")}`);
  console.log(`D1 部署面开 flag：${a.d1.length} 处`);
  for (const h of a.d1) console.log(`  ✗ ${h.file}:${h.line} ${h.why} —— ${h.raw}`);
  console.log(`D2 静态 import @deepseek-ai/*：白名单外 ${a.d2.length} 处（白名单 ${ALLOWED_STATIC_DIR}）`);
  for (const h of a.d2) console.log(`  ✗ ${h.file}:${h.line} ← ${h.spec}`);
  console.log(`D3 dsh-runtime 入口：动态 ${a.entriesDyn.length} 处 · 静态(裸) ${a.entriesStatic.length} 处`);
  for (const h of a.entriesDyn) console.log(`  ${h.guarded ? "·" : "✗"} ${h.file}:${h.line} ← ${h.spec}（${h.guarded ? "有 flag 判断" : "裸入口"}）`);
  for (const h of a.entriesStatic) console.log(`  ✗ ${h.file}:${h.line} ← ${h.spec}（静态入口）`);
  console.log(`（参考）动态 import @deepseek-ai/*：${a.dynExternal.length} 处`);
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);

  // ── 金丝雀先跑，任何模式都跑 ────────────────────────────────────────────────
  if (process.env.DSH_DORMANCY_FORCE_CANARY_BREAK === "1") {
    // 故障注入：模拟「判据本体被改坏」——金丝雀必须当场不中并报工具坏了
    toolBroken("（故障注入）金丝雀不中 ⇒ 门自己瞎了", "这是 --selftest 在自检「金丝雀不中 ⇒ RC=2」这条路径。");
  }
  const canaryFails = runCanaries();
  if (canaryFails.length) {
    console.error("⛔ 金丝雀不中 ⇒ **门自己瞎了**，本次结论作废：");
    console.error("   **不许**读作「dsh 仍在休眠 / 部署面干净 / 通过」——本门这次没有正确分析任何东西。");
    canaryFails.forEach((f) => console.error("   · " + f));
    process.exit(2);
  }
  // 诚实位：**现算**，不写死（写死是假绿第 11 形态：加了样例而计数不动，屏上照旧「N/N 全中」）
  const CANARY_LINE =
    `✅ 金丝雀 ${CANARIES.length}/${CANARIES.length} 全中` +
    `（必咬 ${CANARIES.filter((c) => /必咬|必中/.test(c.name)).length} + 必不咬 ${CANARIES.filter((c) => /必不咬/.test(c.name)).length}` +
    ` · D1 ${CANARIES.filter((c) => c.kind === "deploy").length} + D2/D3 ${CANARIES.filter((c) => c.kind === "source").length}` +
    ` + 归类器 ${CANARIES.filter((c) => c.kind === "path").length}）`;

  // ── `--explain <file>`：拿**真文件**过一遍主扫描函数，逐条打印它看见了什么 ──────
  // 报「零处」这类否定结论时，用它给出「扫描器确实看得见那一处」的正面证据
  // （否则「0」既可能是真的 0，也可能是扫描器瞎了 —— 这两个命题不同）。
  if (has("--explain")) {
    const i = argv.indexOf("--explain");
    const f = argv[i + 1];
    if (!f || f.startsWith("--")) toolBroken("`--explain` 没给文件名", "用法：`--explain apps/agentcore/src/engine.ts`");
    const rel = f.replace(/^\.\//, "");
    if (!existsSync(join(ROOT, rel))) toolBroken(`${rel} 不存在（相对仓根）`);
    const src = readSrc(rel);
    const kind = isDeployPath(rel);
    console.log(`# ${rel}`);
    console.log(`部署面归类：${kind ?? "（不是部署面）"}`);
    if (kind) {
      const h = scanDeployText(src);
      console.log(`D1 命中 ${h.length} 处：` + (h.map((x) => `L${x.line} ${x.why}`).join(" · ") || "无"));
    }
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(rel)) {
      const r = scanSourceText(src);
      const allowed = rel.startsWith(ALLOWED_STATIC_DIR);
      console.log(`白名单内（${ALLOWED_STATIC_DIR}）：${allowed}`);
      console.log(`静态 import @deepseek-ai/…  ${r.staticExternal.length} 处：` + (r.staticExternal.map((x) => `L${x.line} ${x.spec}`).join(" · ") || "无"));
      console.log(`动态 import @deepseek-ai/…  ${r.dynamicExternal.length} 处：` + (r.dynamicExternal.map((x) => `L${x.line} ${x.spec}`).join(" · ") || "无"));
      console.log(`dsh-runtime 动态入口        ${r.dynamicEntry.length} 处：` + (r.dynamicEntry.map((x) => `L${x.line} ${x.spec}（${x.guarded ? "有 flag 判断" : "裸入口"}）`).join(" · ") || "无"));
      console.log(`dsh-runtime 静态入口        ${r.staticEntry.length} 处：` + (r.staticEntry.map((x) => `L${x.line} ${x.spec}`).join(" · ") || "无"));
    }
    process.exit(0);
  }

  const a = analyze();

  if (has("--census")) {
    console.log(CANARY_LINE);
    printCensus(a);
    process.exit(0);
  }

  if (has("--selftest")) {
    console.log(CANARY_LINE);
    console.log(`✅ 扫描面：部署面 ${a.deployFiles.length}（下界 ${DEPLOY_FLOOR}）· 源码面 ${a.sourceFiles.length}（下界 ${SOURCE_FLOOR}）`);

    /*
     * ── 退出码契约 + 变异反证（**双向**）────────────────────────────────────────
     * 只验「故障 ⇒ 2」会把门做成**永远不红**（拿更糟的假绿换掉假红）。
     * 故必须同时验：三条判据各自的真违规 ⇒ RC=1，**且红在对应那一条上**（不许误伤）。
     */
    const selfPath = fileURLToPath(import.meta.url);
    const run = (env) => spawnSync(process.execPath, [selfPath], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });

    const probes = [
      { want: 0, label: "无注入 ⇒ RC=0（干净）", env: {}, tag: null, notTags: ["[D1]", "[D2]", "[D3]"] },
      { want: 1, label: "变异①：部署面塞 `DSH_HARNESS=1` ⇒ RC=1 且**只**红在 [D1]", env: { DSH_DORMANCY_INJECT_D1: "1" }, tag: "[D1]", notTags: ["[D2]", "[D3]"] },
      { want: 1, label: "变异②：白名单外静态 import @deepseek-ai ⇒ RC=1 且**只**红在 [D2]", env: { DSH_DORMANCY_INJECT_D2: "1" }, tag: "[D2]", notTags: ["[D1]", "[D3]"] },
      { want: 1, label: "变异③：裸动态入口 ⇒ RC=1 且**只**红在 [D3]", env: { DSH_DORMANCY_INJECT_D3: "1" }, tag: "[D3]", notTags: ["[D1]", "[D2]"] },
      { want: 2, label: "注入「读不到文件」⇒ RC=2（工具坏了，不是代码坏了）", env: { DSH_DORMANCY_FORCE_UNREADABLE: "1" }, tag: null, notTags: [] },
      { want: 2, label: "注入「金丝雀不中」⇒ RC=2（门自己瞎了，拒绝产出结论）", env: { DSH_DORMANCY_FORCE_CANARY_BREAK: "1" }, tag: null, notTags: [] },
    ];
    for (const p of probes) {
      const r = run(p.env);
      const all = (r.stdout || "") + (r.stderr || "");
      const bad = [];
      if (r.status !== p.want) bad.push(`RC 期望 ${p.want} 实得 ${r.status}`);
      if (p.tag && !all.includes(p.tag)) bad.push(`应红在 ${p.tag} 上，输出里没有该标签`);
      for (const nt of p.notTags) if (all.includes(nt)) bad.push(`**误伤**：不该红的 ${nt} 也出现了`);
      if (bad.length) {
        console.error(`⛔ 契约被破：${p.label}\n   ${bad.join("\n   ")}`);
        console.error("   输出：" + all.trim().split("\n").slice(0, 8).join("\n          "));
        process.exit(2);
      }
      console.log(`✅ ${p.label}`);
    }
    console.log("\n✓ dsh-dormancy --selftest 通过（金丝雀全中 · 三条变异各自红在对应判据上且不误伤 · 退出码三分机验）");
    process.exit(0);
  }

  /* ── 门本体 ─────────────────────────────────────────────────────────────── */
  const fail = report(a);

  console.log(CANARY_LINE);
  console.log(
    `· 扫描面：部署面 ${a.deployFiles.length} 文件 · 源码面 ${a.sourceFiles.length} 文件` +
    `（下界 ${DEPLOY_FLOOR} / ${SOURCE_FLOOR}，均已过 ⇒ 下面的「零处」是真的零，不是没扫到）`,
  );
  console.log(
    `· D1 部署面开 flag ${a.d1.length} 处 · D2 白名单外静态 import ${a.d2.length} 处 · ` +
    `D3 入口 动态 ${a.entriesDyn.length}（其中裸 ${a.entriesDyn.filter((h) => !h.guarded).length}）/ 静态 ${a.entriesStatic.length}`,
  );
  if (a.entriesDyn.length === 0 && a.entriesStatic.length === 0 && a.d2.length === 0) {
    console.log("· 诚实位：本树上 **dsh 融合代码尚未并入**（零入口 / 零外部 import）⇒ D2·D3 本次是**空过**，只有 D1 咬到了真东西。");
  }

  if (fail.length) {
    console.error(`\n✗ dsh-dormancy:check 未通过（${fail.length} 条）：`);
    for (const m of fail) console.error("  - " + m);
    console.error("\n  裁决背景：审核方判定「**代码可以并，flag 不能翻**」。翻 flag 的三条前置条件");
    console.error("  （真 provider 从没跑过 / STALL_LOOP 护栏净减少 / MCP serverName 是 root 级预约与");
    console.error("  tenant_id everywhere 直接冲突）逐条写在 docs/DECISION-dsh-fusion.md §3，未销账不许翻。");
    process.exit(1); // 1 = 真有违规（与所有 toolBroken 的 2 严格分开）
  }
  console.log("\n✓ dsh-dormancy:check 通过（部署面零 flag · 静态 import 未扩散 · 入口至多 1 处且有判断）");
  process.exit(0);
}

/*
 * ── 兜底之二：把主流程也包起来（必须是 Program 的直接子语句）──────────────────
 * 上面的 process.on 钩子已覆盖同步与异步两侧，这里再包一层不是冗余：
 * 它让「兜底」这件事在**源码结构上**也成立 —— `check-gate-exit-discipline.mjs`
 * 的判据②认的就是这个结构（写成 `if (isMain) { try {…} }` 语义一样但会被判「无顶层兜底」）。
 */
try {
  await main();
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}
