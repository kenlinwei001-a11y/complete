#!/usr/bin/env node
/**
 * 过期「自称实测」声明门 —— 本体 §8 `G-STALE-MEASURED-CLAIM` 的机械那一半。
 *
 * ── 存在理由（一族真实病灶，不是假想）────────────────────────────────────────
 * 2026-08-08 一天之内在本仓实测到 **6 例**同一个病：**过期声明自称「运行态实测」**。
 * 最毒的一例在 `apps/frontend-shell/src/views/sim/inspectorModel.ts`：屏上写着
 * 「`Cadence` 对象全仓 0 条（**运行态实测** `GET /a/v1/objects?type=Cadence` → total 0）」，
 * 而当天 `apps/datacore/src/synthetic/service.ts` 已经在 `putAll("Cadence", …)` 真落库、
 * `app.ts` 的推演 tick 已经在读它。**「自称实测」把可疑度压到最低**，因此比普通过期注释更能骗过复审——
 * 复审看见"运行态实测"四个字就默认这是查过的，于是不再追一层。
 *
 * 病的机理是**保质期**：实测的保质期等于做实测的那一天。一句没有日期、没有复验方式的
 * "实测 X 是 0"，写下的当天是真的，上游一补齐就变成屏上说谎，而且没有任何人会被通知。
 *
 * ── 本门的三层判据 ──────────────────────────────────────────────────────────
 *  ① `STALE-1 · 无实测日期`   —— 声明式地使用了「实测/实跑/运行态/现算」却没写下**哪天测的**。
 *                                 没有日期 = 没有保质期 = 永远没人知道它该复验了。
 *  ② `STALE-2 · 无复验方式`   —— 没有端点 / 命令 / `file:line` 锚点，复审无从"亲手跑一遍"
 *                                 （CLAUDE.md 铁律 0.5 第 4 条：「我 grep 了」不是复验）。
 *  ③ `STALE-3/4 · 事实当场读回` —— 声明里若引用了**机器可复验的事实**
 *                                 （「某对象类型 0 条 / 无承载」「某符号零消费方」），
 *                                 本门**当场把那个事实读回来核**：
 *                                   · 对象类型 → 查 `apps/datacore/src/synthetic/service.ts` 的 `putAll("<Type>"` 清单；
 *                                   · 符号     → 在 `apps/<app>/src` `packages/<pkg>/src` 下真数非声明处的引用。
 *                                 **上游一补齐，声明当场红** —— 这一层才是治本的，前两层只是逼人留下保质期。
 *
 * ── 为什么不是「凡出现这四个字就要日期」──────────────────────────────────────
 * 因为「实测」在本仓还是**词汇**：`provenance.kind === "实测"` 的徽章、`<dt>实测值 vs 阈值</dt>`、
 * 「合成·未接实测」的诚实灰标。对这些要求日期是纯噪声，只会训练出一张几百条的白名单，
 * 白名单一大就没人看，门就死了。故本门只咬**声明式用法** = 关键词 + 同一声明单元内出现
 * **可被证伪的观测结果**（数字+量词 / `0 命中` / `零消费方` / 端点回值 / `grep` 计数）。
 * 这是本门自觉的**边界**，见文件末尾《做不到的部分》。
 *
 * ── 金丝雀（门自己会瞎）────────────────────────────────────────────────────
 * 本会话实测过两个"工具骗人"的陷阱：`git grep -- "apps/<星>/src"` 恒 0 命中（⚠️ 病因**不是**
 * "pathspec 的通配符不跨 `/`"——那是 2026-08-11 已被实测推翻的错病因，`*` 确实跨 `/`；
 * 真因是**含通配的 pathspec 不当目录前缀用**，须补一段成 `apps/<星>/src/<星>`。
 * 详见 CLAUDE.md 铁律 0.5 判据 #5 的订正段）；
 * 正则 `BUILTIN_VIEWS[^=]*=` 被 `_RENAMED: BuiltInView[] ` 吞掉。两者的共同后果都是
 * **门报绿，而它其实一个字都没扫到**。故本门开跑前先跑 `selftest()`：
 * 拿内嵌的必咬样例过一遍检测器，任一条没被咬 ⇒ 打印「⛔ 门自己瞎了」并 exit 1，
 * 而不是安安静静报「代码干净」。扫描规模（文件数/命中数）也设下限，扫空即红。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── 2026-08-14 · WO-ONSCREEN-STALE-FACTS 扩判据：**屏上印着的过时"事实"** ─────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 上面那四层守的是**注释**里「自称实测」的过期声明。今天实测抓出它**咬不住**的一族：
 * **一次性测量的结果被硬编码成屏上文案，源码变了文案不变** —— 病灶在**字符串字面量**里，
 * 而字面量里通常一个「实测」字都不写，于是 STALE-1/2 的关键词触发器完全看不见它。
 *
 * ── 今天亲手复核到的两处（都是**用户真能看见**的字，不是注释）────────────────
 *  ① `apps/frontend-shell/src/views/sim/sandboxConsoleModel.ts` 的 `IMPEDIMENT_JOIN_REASON`
 *     与 `apps/frontend-shell/src/locales/zh.ts` 的 `decisionPlay.entry.whyBody`，屏上写着
 *     「demo 的 locus **只有** MaterialBalance / MaterialBatch / Line **三类**」
 *     「带 drillType=MaterialBatch 或 Line 的因子**一条都没有**」。
 *     **两句今天都是假的**：`chain-impediment.ts` 的判据绑定里 `CONTENTION_LOCUS_TYPE = "Base"`
 *     已经长出**第四类** locus；`battery-extended.ts` 的 `CAUSAL_FACTORS` 里
 *     `drillType: "Line"` 有 1 条（`cf-cap-bottleneck-process`）、`drillType: "MaterialBatch"` 有 1 条
 *     （`cf-batch-idle`）、`drillType: "Base"` 有 1 条（`cf-base-capacity-contention`）。
 *     ⚠ **两句错得不一样，修法也不一样**（这一条是本单的要害，混了必修错地方）：
 *       · 「只有三类」= 上游**新长出**一类，文案没跟 ⇒ 改文案；
 *       · 「Line 一条都没有」= **判据本身就错**：那条因子 `drillId` 是 `*`（通配），
 *         真正缺的是「`*` 怎么算对上」这条 join 判据，不是缺种子。当"缺数据"去补，补了也白补。
 *  ② `apps/datacore/src/features.ts` / `apps/datacore/src/synthetic/service.ts` /
 *     `apps/agentcore/src/features/registry.ts` / `apps/frontend-shell/src/mocks/fixtures.ts`
 *     各存一份视图标题字面量「订单全链聚合」，而前端 `locales/zh.ts` 已改名「订单进展与卡因」
 *     —— **一个概念两份真相源**，改了一份没改另一份。部署态若由后端下发 `view.title`，
 *     用户会看到旧名。zh.ts 自己的注释里写着「改了会连坐后端 VIEW_DEFS / features / mock 三处」，
 *     ——**写在注释里的纪律不是机制**，所以它一处都没拦住。
 *
 * ── 新增四层判据 ────────────────────────────────────────────────────────────
 *  ⑤ `STALE-5 · 屏上断言无溯源记号`
 *       **只扫剥掉注释之后仍然存在的字符串字面量**（= 会到屏上的那些字）。里面若出现
 *       **可被机器现场复核的断言**（枚举断言「只有 A/B/C 三类」「共 N 种」；否定断言
 *       「一条都没有」「没有任何一条」「全仓 0 条」），就必须带一条机器可跑的溯源记号。
 *       为什么只咬字面量、不咬注释：注释归 ①②（保质期那两问）；把两者混在一层，
 *       噪声会淹掉真病灶 —— **同一批判据在注释里的命中数远多于字面量**（2026-08-16 实测
 *       注释 63 行 vs 字面量 13 行）。数字本身会随前端改动而变，故真正被机器守住的是
 *       **那个数量级差**，不是这两个数：
 *         @stale-self onscreen.commentHits >=30
 *         @stale-self onscreen.literalHits <=25
 *       两条一旦交叉（注释侧塌下来或字面量侧涨上去），"只扫屏上"这个取舍就失去依据，门当场红。
 *
 *  ⑥ `STALE-6 · 溯源记号现算不符`（**永不豁免**）
 *       记号语法（刻意做成**可执行断言**，不是指针）：
 *           @stale-fact <仓内相对路径> /<正则>/ <op><n>        op ∈ == != >= <= > <
 *       例：`@stale-fact apps/datacore/src/synthetic/battery-extended.ts /drillType: "Line"/ ==1`
 *       门当场在那个文件里数那条正则的匹配数，与 `<op><n>` 比。不符 ⇒ RC=1，并把**现算值**打出来。
 *       **为什么记号里要写死期望值，而不是只写"来源在哪"**：指针式记号（`@stale-source file:symbol`）
 *       只解决"能不能找到来源"，不解决"来源变了没人知道" —— 门还得去猜文案里哪个数字对应来源里的什么，
 *       而中文数量词（「三类」「一条都没有」）跟机器计数之间没有可靠的自动映射。让作者显式声明
 *       **「我这句话赌的是这个计数」**，是唯一不靠猜的办法：赌注写下来了，输了才有人知道。
 *       记号写在哪：该字面量所在单元的**行内**，或**紧贴其上的那个连续注释块**里。
 *       判据是**贴不贴着**（连续性），不是"前 N 行内" —— 窗宽一改结论就变，等于把判据交给运气。
 *       存量文案暂时不改的，可以把赌注登记在基线条目的 `factChecks` 上（同一套执行器），
 *       语义是「这句话我这一单不改，但它赌的计数在案 —— 上游一变，门当场红」。
 *
 *  ⑦ `STALE-7 · 改名声明未落到全部真相源`
 *       仓里若有**改名声明**（`前名「X」` / `原名「X」` / `旧名「X」` / `改名前叫「X」`），
 *       则旧名 X **不许**再作为活字面量出现在任何 `name:` / `title:` / `featureName:` / `label:` 槽位里。
 *       为什么以"改名声明"为锚：它是仓里**唯一**能机器读出的"这两个名字是同一个东西"的证据。
 *       没有声明的改名，机器无从知道 A 和 B 说的是一回事 —— 那属本门的诚实边界（见文末）。
 *
 *  ⑧ `STALE-8 · 视图标题两份真相源分叉`
 *       同一个视图 slug 的标题字面量（后端 `VIEW_DEFS` / `features` 注册表 / mock fixtures /
 *       `view-manifest`）必须彼此一致；**且**当前端 locale 命名空间 camelCase→kebab-case
 *       **恰好等于**某个 slug 时（`orderChain` → `order-chain`），`zh.<ns>.title` 也必须与之一致。
 *       ⚠ **对不上就不判**：`quarter` → `quarter`（真 slug 是 `quarterly-rolling`）、`geo` → `geo`
 *       （真 slug 是 `geo-map`）—— 这类映射本门认不准，故一个字都不说（宁可漏，不可诬）。
 *       ⑦ 与 ⑧ 是**两条互相独立**的路径，今天都能咬中 order-chain 那处 —— 刻意留双保险：
 *       任一条的抽取正则被改坏，另一条还在。
 *
 * ── 存量怎么办：**棘轮 + 待修点名**，不是白名单 ─────────────────────────────
 * ⑤⑦⑧ 的存量进 `onscreenExemptions` 段（与 ①②③④ 的 `exemptions` **分开**两个棘轮：
 * 合在一起就得把 `ratchetHigh` 调大，而"评审唯一必须拒绝的一行"就是把它调大）。
 * 每条豁免必须标 `verdict`：
 *   · `FALSE-POSITIVE` —— 检测器粗粒度误报（元讨论、把术语当词用）；
 *   · `CONFIRMED-STALE` —— **确认是过时事实**，只是修文案归另一张单。这一类**每次跑都被点名打印**，
 *     并计入「待修」计数 —— 豁免只买"暂时不红"，不买"没人知道"。
 *
 * 用法：
 *   node scripts/check-stale-claims.mjs             # 门（CI/gate.sh 用）
 *   node scripts/check-stale-claims.mjs --list      # 列出全部现存违规（写基线用）
 *   node scripts/check-stale-claims.mjs --selftest  # 只跑金丝雀
 *   node scripts/check-stale-claims.mjs --update    # 收紧棘轮（只降不升；散文字段归人手）
 */

/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。
 *
 * ⚠ **2026-08-14 WO-ONSCREEN-STALE-FACTS 换形态**：原来这里挂的是
 *   `process.on("uncaughtException"/"unhandledRejection", …)` 两个**全局** handler。
 *   本文件被 `apps/frontend-shell/test/stale-claims.seam.test.ts` 真 `import`（它要拿 `judgeUnit`
 *   本体当判据，不另抄一份）——**全局 handler 会跟着装进 vitest 进程**，把测试自己的未捕获异常
 *   也吞成 `process.exit(2)`，等于本门反过来污染别人的进程。
 *   形态（铁律 0.6 句式）：「我用『本文件的兜底』当作『本进程的兜底』，而前者不该度量后者。」
 *   改成 Program 直接子语句的顶层 `try { if (isMain) main() } catch { toolBroken() }`：
 *   作用域只在本文件被当**脚本**跑的那一次，被 import 时一个 handler 都不装。 */
function toolBroken(e, why) {
  console.error(`⛔ check-stale-claims.mjs ${why ?? "未预期异常"}（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOT = "apps/frontend-shell/src";
const BASELINE_PATH = "scripts/stale-claim-baseline.json";
/**
 * ⑨⑩ 自扫描的对象 —— **门自己**。
 * 不是白名单（白名单是"这些不查"），是**受审名单**（"这些额外要查"）：
 * 谁在下判断，谁先受审。为什么不把整个 `scripts/` 加进来，见 § 3.6 的说明。
 */
const SELF_SCAN_FILE = "scripts/check-stale-claims.mjs";

/**
 * 屏上层豁免的三种 verdict —— **处置完全不同，混成一类必修错地方**：
 *   · `FALSE-POSITIVE`  检测器粗粒度误报（这句话根本不是在断言一个可复核的集合）⇒ 去修检测器
 *   · `UNMARKED`        是真断言、今天**没被证伪**，只是还没挂 `@stale-fact` 记号 ⇒ 去补记号
 *   · `CONFIRMED-STALE` 已复核，**今天确认是假的**，只是修文案归另一张单 ⇒ 去改屏上那句话
 * 只有两档（对/错）时，中间那一大类会被硬塞进某一端，于是要么假装干净、要么假装有病。
 */
const ONSCREEN_VERDICTS = ["FALSE-POSITIVE", "UNMARKED", "CONFIRMED-STALE"];

/** 屏上事实层棘轮段的**首次建账**说明（散文归人手：`--update` 之后不会再覆盖它）。 */
const ONSCREEN_BASELINE_NOTE = [
  "① 本段是 STALE-5/7/8 的**存量棘轮**，与上面 exemptions 段（STALE-1..4）刻意分开两套水位：",
  "   合成一套就得把 ratchetHigh 调大，而「评审唯一必须拒绝的一行」就是把它调大。",
  "② 每条必须写 verdict，三选一（处置完全不同，混成一类必修错地方）：",
  "   · FALSE-POSITIVE  检测器粗粒度误报 ⇒ 去修检测器",
  "   · UNMARKED        是真断言、今天没被证伪，只是还没挂 @stale-fact 记号 ⇒ 去补记号",
  "   · CONFIRMED-STALE 已复核、今天确认是假的，修文案归另一张单 ⇒ 去改屏上那句话",
  "   CONFIRMED-STALE 每次跑都会被门**点名打印** —— 豁免只买「暂时不红」，不买「没人知道」。",
  "③ **STALE-6 永不豁免**：它是「现算不符」，一条正在对用户说谎的断言没有理由值得买暂时不红。",
  "④ 条目可挂 factChecks[{file,pattern,op,n,means}] —— 存量文案这一单不改，但把它赌的计数登记在案；",
  "   走的是与 @stale-fact 记号**同一个执行器**（runStaleFactMark），上游一变当场红。",
  "⑤ 棘轮**松弛**（基线条目今天一条都没命中）与回弹同样判红：基线高于实测 = 一份看不见的免检名额。",
].join("\n");

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 词法：什么算「声明式使用」
// ══════════════════════════════════════════════════════════════════════════════

/** 触发词。出现即进入审查（但是否算声明，还要看 §1.2 的观测结果标记）。 */
const CLAIM_KEYWORDS = ["实测", "实跑", "运行态", "现算"];

/**
 * **观测结果标记** —— 有它才算「声明」，没它只是把「实测」当词用。
 * 判据是「这句话可不可能被证伪」：一个数、一个命中计数、一个端点回值，都能被后来的事实推翻；
 * 一个徽章标签不能。
 */
const MEASURED_RESULT_PATTERNS = [
  /\d+\s*(条|行|格|命中|个|次|台|组|页|字节|KB|MB|ms|px|天|%)/,
  /0\s*命中|零\s*命中|零消费方|零调用方|零生产调用方|零直接消费方|零运行时消费方/,
  /total\s*[=＝:：]?\s*\d|→\s*total/,
  /\bGET\s+\/|\bPOST\s+\/|\/a\/v1|\/b\/v1|\/api\/v1/,
  /grep/,
];

/** ① 实测日期：ISO 或中文年月日。**年月即可**——精确到天最好，但月份也构成保质期。 */
const DATE_PATTERNS = [/\b20\d{2}-\d{2}-\d{2}\b/, /\b20\d{2}-\d{2}\b/, /20\d{2}\s*年\s*\d{1,2}\s*月/];

/** ② 复验方式：端点 / 命令 / 文件锚点。任一即可——目的是让复审能**亲手跑一遍**。 */
const HOWTO_PATTERNS = [
  /[\w./@-]+\.(ts|tsx|mjs|js|sql|json|md|yml|yaml)(:\d+)?/, // 文件锚点（带不带行号都算）
  /\/a\/v1|\/b\/v1|\/api\/v1/, // 端点
  /\bgrep\b|\bpnpm\b|\bnode\s+scripts\/|\bcurl\b|\bgit\s+grep\b/, // 命令
];

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 声明单元 —— 判据挂在「单元」上，不是「行」上
// ══════════════════════════════════════════════════════════════════════════════
//
// 单元 = 该断言所在的**最小完整表述**，三种形态：
//   (a) 块注释 `/* … */`      → 整块；
//   (b) 连续 `//` 行注释段     → 整段；
//   (c) 代码（多为拼接字符串） → 按**续行**上下扩张：行尾是 `+ ( , : [ {` 等续行符则继续，
//                               遇到以 `,` `;` `{` `}` 收尾的行即封口。
// 为何不用固定行窗：日期与锚点常写在同一条 evidence 的**另一行**上，固定窗要么切断要么串味；
// 按续行扩张才让「一条 evidence」= 「一条声明」。

/** 标出每一行是否落在块注释内，并给出所属块的 [start, end]。 */
function blockCommentRanges(lines) {
  const owner = new Array(lines.length).fill(null);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (start === -1) {
      const open = l.indexOf("/*");
      if (open !== -1 && l.indexOf("*/", open + 2) === -1) start = i;
      else if (open !== -1) owner[i] = [i, i]; // 单行 /* … */
    }
    if (start !== -1) {
      if (l.includes("*/") && !(l.indexOf("/*") !== -1 && l.indexOf("/*") === l.lastIndexOf("/*") && start === i && l.indexOf("*/") < l.indexOf("/*"))) {
        if (i > start || l.indexOf("*/") > l.indexOf("/*")) {
          for (let k = start; k <= i; k++) owner[k] = [start, i];
          start = -1;
        }
      } else {
        owner[i] = [start, -1]; // 暂记，闭合时回填
      }
    }
  }
  if (start !== -1) for (let k = start; k < lines.length; k++) owner[k] = [start, lines.length - 1];
  // 回填未闭合标记
  for (let i = 0; i < owner.length; i++) if (owner[i] && owner[i][1] === -1) owner[i] = null;
  return owner;
}

const isLineComment = (s) => /^\s*(\/\/|\*)/.test(s);
/**
 * 续行符收尾 ⇒ 下一行仍属同一条声明。
 *
 * ⚠ **`,` 刻意不在这张表里**（第一版栽在这儿）：对象字面量里每个属性都以 `,` 收尾，
 *   把 `,` 当续行符 ⇒ 从 `evidence:` 一路吞到相邻的兄弟属性、再吞下一个变量对象，
 *   于是「K1 的日期」会被算成「K2 也有日期」——**漏报**。`,` 是属性收口，不是续行。
 */
const continuesDown = (s) => /[+({[:=?&|]\s*$/.test(s.replace(/\s+$/, ""));
/** 语句/属性收口。 */
const closesUnit = (s) => /[;}]\s*$/.test(s.trim()) || /^\s*$/.test(s);

function unitRange(lines, hit, blockOwner) {
  if (blockOwner[hit]) return blockOwner[hit];
  if (isLineComment(lines[hit])) {
    let a = hit;
    let b = hit;
    while (a > 0 && isLineComment(lines[a - 1])) a--;
    while (b < lines.length - 1 && isLineComment(lines[b + 1])) b++;
    return [a, b];
  }
  let a = hit;
  let b = hit;
  // 向上：只要**上一行**是续行状态（以续行符收尾）就并进来
  while (a > 0 && continuesDown(lines[a - 1]) && !blockOwner[a - 1] && !isLineComment(lines[a - 1])) a--;
  // 向下：只要**本行**以续行符收尾就并下一行
  while (b < lines.length - 1 && continuesDown(lines[b]) && !closesUnit(lines[b])) b++;
  return [a, b];
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 事实当场读回（治本的那一层）
// ══════════════════════════════════════════════════════════════════════════════

/** `apps/datacore/src/synthetic/service.ts` 的 `putAll("<Type>"` 清单 = 「这个对象类型今天有承载」的单一事实源。 */
function loadMaterializedTypes(root) {
  const p = join(root, "apps/datacore/src/synthetic/service.ts");
  if (!existsSync(p)) return null; // 上游文件没了：不静默放行，交给调用方判红
  const src = readFileSync(p, "utf8");
  const types = new Set();
  for (const m of src.matchAll(/putAll\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g)) types.add(m[1]);
  return types;
}

/**
 * 声明里「某对象类型没有承载」的说法。
 * 只咬**否定承载**的措辞——「Cadence 已落库」这类肯定句不该被这一层碰。
 */
const ABSENCE_ASSERTIONS = [
  /`?([A-Z][A-Za-z0-9_]{2,})`?\s*(?:对象)?\s*(?:全仓\s*)?0\s*条/g,
  /`?([A-Z][A-Za-z0-9_]{2,})`?\s*(?:对象)?\s*(?:全仓\s*)?(?:0|零)\s*命中/g,
  /(?:无|没有|不存在)\s*`?([A-Z][A-Za-z0-9_]{2,})`?\s*(?:对象|实例|承载|行)/g,
  /`?([A-Z][A-Za-z0-9_]{2,})`?\s*(?:对象类型)?\s*尚?不存在/g,
];

/**
 * 声明里「某符号零消费方」的说法。
 *
 * ⚠ 主语必须**认得出来才判**（第一版栽在这儿）：原先用「关键词前 24 字内的任意标识符」当主语，
 *   于是 "`apps/datacore/src/solvers/` **零直接消费方**" 里被抠出 `datacore` 当符号去数引用，
 *   数到 21 处 ⇒ 三条**误报**。真相是那句话的主语是 `transitDays`，`apps/datacore/src/solvers/`
 *   只是**作用域**。故：主语只认反引号里的**非路径标识符**（不含 `/`、不含空格）；
 *   认不出主语就**什么都不说** —— 宁可漏，不可诬。
 */
const DEAD_CLAIM_RE = /(?:零|0)\s*(?:直接|生产|运行时)?\s*(?:消费方|调用方)/g;
const SYMBOLISH = /^[A-Za-z_][A-Za-z0-9_.]{3,}$/;

/** 行级触发器：这一行看着像在断言「某某没有/是 0」⇒ 值得把它所在的声明单元拿去核事实。 */
const FACT_CLAIM_TRIGGER = /(?:0\s*条|0\s*命中|零\s*命中|零\s*(?:直接|生产|运行时)?\s*(?:消费方|调用方)|(?:无|没有|不存在)\s*`?[A-Z][A-Za-z0-9_]{2,}`?\s*(?:对象|实例|承载|行)|尚?不存在)/;

/**
 * 从「零消费方」这句话里认主语：先看左窗最近的反引号标识符，再看右窗最近的。
 *
 * ⚠ **作用域限定的声明一律跳过**（第二版栽在这儿）：
 *   "…`etaDay` 派生管线消费），但 `apps/datacore/src/solvers/` **零直接消费方**…"
 *   这句的主语是更前面的 `transitDays`、作用域是 `solvers/`，而左窗最近的合法标识符是 `etaDay`
 *   ⇒ 抓错主语、全仓计数 12 处 ⇒ 又一条**误报**。这类"某目录下零消费方"的声明，
 *   主语与作用域都要认对才能复验，本门认不准 ⇒ **不判**（它仍会被 STALE-1/2 咬到日期与复验方式）。
 */
function subjectsOfDeadClaims(text) {
  const found = new Set();
  for (const m of text.matchAll(DEAD_CLAIM_RE)) {
    const i = m.index ?? 0;
    // ⚠ **主语必须与断言同行**（第三版栽在这儿）：
    //   跨行取主语时，`* 每一种都必须配 \`inertReason\`：` 的下一行 `（零消费方 / 换算缺承载）`
    //   ——那是一句**分类标签**，根本不是在说 `inertReason` 没人用 —— 也被当成声明去数引用 ⇒ 误报。
    //   同行取到的最后一个反引号标识符 = 主语；同行取不到就**不判**（宁可漏，不可诬）。
    //   刻意不用"前 N 字"这种窗：窗宽一改结论就变，等于把判据交给运气。
    const lineStart = text.lastIndexOf("\n", i) + 1;
    const lineEndRaw = text.indexOf("\n", i);
    const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
    const before = text.slice(lineStart, i);
    const after = text.slice(i + m[0].length, lineEnd);
    // 作用域限定（左窗近处出现路径）⇒ 主语与作用域都认不准，跳过
    if (/`[^`\n]*\/[^`\n]*`\s*\*{0,2}\s*$/.test(before.slice(-45))) continue;
    const pick = (win, last) => {
      const toks = [...win.matchAll(/`([^`\n]+)`/g)].map((x) => x[1].trim()).filter((t) => SYMBOLISH.test(t));
      return toks.length === 0 ? null : last ? toks[toks.length - 1] : toks[0];
    };
    const s = pick(before, true) ?? pick(after, false);
    if (s !== null) found.add(s);
  }
  return found;
}

/** 在每个 `apps/<app>/src` 与 `packages/<pkg>/src` 下真数引用（排除声明所在文件与 test）。 */
function countSrcReferences(root, symbol, excludeFile) {
  const roots = [];
  for (const group of ["apps", "packages"]) {
    const g = join(root, group);
    if (!existsSync(g)) continue;
    for (const pkg of readdirSync(g)) {
      const s = join(g, pkg, "src");
      if (existsSync(s) && statSync(s).isDirectory()) roots.push(s);
    }
  }
  let n = 0;
  const hits = [];
  for (const r of roots) {
    for (const f of walk(r)) {
      const rel = relative(root, f);
      if (rel === excludeFile) continue;
      if (/\.(test|spec)\.[jt]sx?$/.test(f)) continue;
      const src = readFileSync(f, "utf8");
      // 只数**代码**里的引用：剥掉注释与中文串里的提及，否则"注释里提了一嘴"会被当成消费方
      const code = stripCommentsAndCjkStrings(src);
      if (code.includes(symbol)) {
        n += 1;
        hits.push(rel);
      }
    }
  }
  return { n, hits };
}

function stripCommentsAndCjkStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/"[^"\n]*[一-鿿][^"\n]*"/g, '""')
    .replace(/'[^'\n]*[一-鿿][^'\n]*'/g, "''");
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3.5 · 屏上事实层（WO-ONSCREEN-STALE-FACTS）—— STALE-5/6/7/8 的词法与事实读回
// ══════════════════════════════════════════════════════════════════════════════

/**
 * **行数守恒**的注释剥除 —— 剥完还剩下的字符串字面量 ≈ 会到屏上的那些字。
 *
 * ⚠ 为什么不能用 §3 那个 `stripCommentsAndCjkStrings`：它把块注释整个换成一个空格，
 *   **行号当场全漂**。本层报的是 `file:line` 给人去改文案的，行号漂了这条报告就是废的。
 *   （这正是本仓踩过的那个坑：变异反证时用未剥注释的源码 `indexOf` 定位，插进去的东西
 *   落在注释里，得出假反证。行号/偏移一旦不守恒，定位就开始骗人。）
 *   故这里逐字符走状态机：注释内容换成等量空格、换行原样保留，**偏移与行号逐字节守恒**。
 *   同时它认识字符串态（`'` `"` \`），所以 `"http://x"` 里的 `//` 不会被当成行注释。
 */
export function stripCommentsKeepLines(src) {
  return splitCodeAndComments(src).code;
}

/**
 * **同一台状态机的另一半视图** —— 只留注释、把代码抹成等长空格（WO-STALE-REGEX-BLIND 补）。
 *
 * ⚠ **刻意不另写一台状态机**：两台机器 = 两套「什么算注释」= 迟早给出互相矛盾的结论，
 *   而这类矛盾一旦出现，两边都是绿的（各自都"自洽"）。故本文件只有 `splitCodeAndComments`
 *   一台，`code` / `comments` 是它的两个互补视图，`splitViewCanary()` 当场验互补性。
 *
 * ⑨⑩ 这一层要的正是这半边：**门的自述写在注释里**。
 * 而门**实现**这套机制时必然要在代码里写下 `@stale-self` 的正则、错误文案、金丝雀样例 ——
 * 那些是**实现**，不是自述。不区分两者的后果 2026-08-16 当场实测过：本层第一版把自己的实现
 * 咬出 18 条噪声（真病灶只有 6 条，淹在里面）。这条排除是**语法上下文**（在不在注释里），不是文件白名单 ——
 * 白名单迟早被例外吃光，上下文规则对以后新写的段落照样生效。
 */
export function stripCodeKeepComments(src) {
  return splitCodeAndComments(src).comments;
}

/**
 * 唯一那台状态机。两个返回视图**逐字节互补**：同一位置，一边是原字符，另一边是空格
 * （换行两边都保留 ⇒ 行号在两个视图里完全一致，`file:line` 才不会漂）。
 */
function splitCodeAndComments(src) {
  let code = "";
  let comments = "";
  let i = 0;
  let state = 0; // 0=code 1=// 2=/* 3='' 4="" 5=``
  const push = (inComment, s) => {
    if (inComment) { comments += s; code += s.replace(/[^\n]/g, " "); }
    else { code += s; comments += s.replace(/[^\n]/g, " "); }
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 0) {
      if (c === "/" && n === "/") { state = 1; push(true, "//"); i += 2; continue; }
      if (c === "/" && n === "*") { state = 2; push(true, "/*"); i += 2; continue; }
      if (c === "'") { state = 3; push(false, c); i += 1; continue; }
      if (c === '"') { state = 4; push(false, c); i += 1; continue; }
      if (c === "`") { state = 5; push(false, c); i += 1; continue; }
      push(false, c); i += 1; continue;
    }
    if (state === 1) { if (c === "\n") { state = 0; push(false, "\n"); } else push(true, c); i += 1; continue; }
    if (state === 2) {
      if (c === "*" && n === "/") { state = 0; push(true, "*/"); i += 2; continue; }
      if (c === "\n") { push(false, "\n"); i += 1; continue; }
      push(true, c); i += 1; continue;
    }
    // ⚠ **`'` / `"` 串遇换行必须复位**（2026-08-16 修，此前是真 bug 不是取舍）：
    //   本机器不认识**正则字面量**，于是 `/putAll\(\s*["']…["']/g` 这种正则里的引号
    //   会被当成串的开头。JS 的 `'`/`"` 串本来就不许跨行（跨行要转义），故在换行处复位
    //   是**更正确**的语义，同时把这类误判的破坏面从「整个文件后半段」压到「这一行」。
    //   实测：不复位时本文件的注释视图只剩 63.4%，后 2/3 被整段吞掉而门照样报绿。
    //   反引号模板串**不复位** —— 它本来就合法跨行，复位会把真模板串切碎。
    if (c === "\n" && (state === 3 || state === 4)) { state = 0; push(false, "\n"); i += 1; continue; }
    if (c === "\\") { push(false, src.slice(i, i + 2)); i += 2; continue; } // 字符串里的转义整对吞
    push(false, c);
    if ((state === 3 && c === "'") || (state === 4 && c === '"') || (state === 5 && c === "`")) state = 0;
    i += 1;
  }
  return { code, comments };
}

/**
 * **枚举断言** —— 「只有 A / B / C 三类」「共 N 种」。
 * 判据是"数量词把一个集合封死了"：集合一长，这句话当场变假，而屏上不会有任何提示。
 */
const ENUM_ASSERTIONS = [
  /只有\s*[^。；\n]{0,60}?(?:两|三|四|五|六|七|八|九|十|\d+)\s*(?:类|种|条|个|张|处)/,
  /共\s*\d+\s*(?:类|种|条|个|张|处)/,
  /恰好\s*\d+\s*(?:类|种|条|个|张|处)/,
];

/**
 * **否定断言** —— 「一条都没有」「没有任何一条」「全仓 0 条」。
 * 这一类最毒：**上游新增一条它就变假**，而"没有"这个词天然让人不去复验
 * （"既然没有，还查什么"）。它与枚举断言分开列，是因为**修法不同**：
 * 枚举断言错了多半是"上游长出新成员"⇒ 改文案；否定断言错了常常是**判据本身写错了**
 * （本单实测：「Line 一条都没有」真相是那条因子 `drillId` 是 `*` 通配、join 判据没认它 ——
 * 当"缺数据"去补，补了也白补）。
 */
const NEGATIVE_ASSERTIONS = [
  /(?:一条|一个|一处|一张|一种|一类)都没有/,
  /没有任何一(?:条|个|处|张|种|类)/,
  /(?:全仓|全库|全量)\s*(?:0|零)\s*(?:条|个|处|张|种|类)/,
];

/** 溯源记号：`@stale-fact <路径> /<正则>/ <op><n>` —— 一条**机器能跑的断言**，不是一个指针。 */
const STALE_FACT_MARK = /@stale-fact\s+([\w./@-]+)\s+\/((?:[^/\\]|\\.)+)\/\s*(==|!=|>=|<=|>|<)\s*(\d+)/g;

/**
 * **提及 ≠ 写下赌注**（2026-08-15 补）——「用反引号把 @stale-fact 当术语提一嘴」是文档里的正常写法
 * （"故本表下方挂 `@stale-fact` 记号"），它**不是**一条挂坏了的赌注。
 * 不区分这两者，后果是**反过来的**：谁在注释里认真解释这套机制，谁就被门判「语法不完整」——
 * 门开始惩罚写文档的人，而真正的坏记号淹在噪声里。这与本仓既有的「`grep -rl` 到的可能只是
 * 注释里提了一嘴，**提及 ≠ 读取**」是同一条判据。
 *
 * 判据刻意做得**窄**：只剔除「紧贴反引号包起来」这一种形态。真要写一条赌注，
 * `@stale-fact` 后面必然跟空格 + 路径，绝不会紧跟一个反引号 —— 所以这条剔除**不给任何坏记号开后门**
 * （金丝雀 `ONSCREEN_MUST_BITE` 里那条「@stale-fact apps/x.ts 大概有三条吧」照样被咬）。
 */
const MARK_MENTION = /`@stale-fact`/g;
/**
 * 「作者试图写一条赌注」的粗计数（单一出处：`parseStaleFactMarks` 与 `extractMarksWithLines` 共用）。
 *
 * ⚠ 剔除提及时**必须等长替换**（换成同宽空格），不许直接删：`extractMarksWithLines` 要拿
 * `m.index` 去数行号，删一段就把后面所有偏移左移，报出的行号**全漂**。
 * 本文件为此已经栽过一次并留了戒律（见 `stripCommentsKeepLines` 的「偏移与行号逐字节守恒」），
 * 这里是同一条：**行号一旦不守恒，定位就开始骗人。**
 */
function countMarkAttempts(text) {
  const masked = text.replace(MARK_MENTION, (m) => " ".repeat(m.length));
  return [...masked.matchAll(/@stale-fact/g)];
}

/** 解析一个文本块里的全部记号。**语法错的记号不静默忽略** —— 忽略了等于把赌注撕了。 */
export function parseStaleFactMarks(text) {
  const marks = [];
  for (const m of text.matchAll(STALE_FACT_MARK)) marks.push({ file: m[1], pattern: m[2], op: m[3], n: Number(m[4]) });
  // 写了 @stale-fact 却没匹上完整语法 ⇒ 记号本身坏了，必须出声（否则作者以为自己挂了赌注，其实没有）
  return { marks, malformed: countMarkAttempts(text).length - marks.length };
}

/**
 * 从一段源码里抽出全部记号 **及其行号**（纯函数 —— 金丝雀直接喂它，与全仓扫描共用这同一份实现）。
 *
 * 与 `parseStaleFactMarks` 分开一层的理由：那个只回记号本体（`judgeOnscreen` 按"单元"用它，
 * 不需要行号）；本函数要报的是「记号写在哪一行」，因为它扫的是**整个文件**而不是某个单元 ——
 * 没有行号，报出来的红没法让人找到那条赌注。
 */
export function extractMarksWithLines(text) {
  const out = [];
  for (const m of text.matchAll(STALE_FACT_MARK)) {
    out.push({
      file: m[1],
      pattern: m[2],
      op: m[3],
      n: Number(m[4]),
      line: text.slice(0, m.index).split("\n").length,
    });
  }
  const attempts = countMarkAttempts(text);
  return { marks: out, malformed: attempts.length - out.length, malformedLines: attempts.map((r) => text.slice(0, r.index).split("\n").length) };
}

const OP_FN = {
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  ">=": (a, b) => a >= b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  "<": (a, b) => a < b,
};

/**
 * 跑一条溯源记号 —— **判据与金丝雀共用这同一个函数**（另抄一份就是装饰品）。
 * @param {{file:string,pattern:string,op:string,n:number}} mark
 * @param {(rel:string)=>string|null} readSource  读不到返回 null（**不抛** —— 抛与"文件不在"是两件事）
 * @returns {{ok:boolean, got:number|null, reason:string}}
 */
export function runStaleFactMark(mark, readSource) {
  const src = readSource(mark.file);
  if (src === null) {
    // 刻意判负而不是判「工具坏了」：记号指向的来源文件不在了 ⇒ **这条断言已经无源可核**，
    // 那正是本门要治的病的极端形态（来源都没了，屏上那句话还在）。
    // 与之相对，`readSource` 内部真抛 IO 异常（权限/OOM）才走 toolBroken —— 两者处置相反。
    return { ok: false, got: null, reason: `溯源记号指向的来源文件不存在：${mark.file}` };
  }
  let re;
  try {
    re = new RegExp(mark.pattern, "g");
  } catch (e) {
    return { ok: false, got: null, reason: `溯源记号里的正则非法（${e.message}）：/${mark.pattern}/` };
  }
  const got = [...src.matchAll(re)].length;
  const fn = OP_FN[mark.op];
  if (fn === undefined) return { ok: false, got, reason: `溯源记号里的比较符不认识：${mark.op}` };
  return {
    ok: fn(got, mark.n),
    got,
    reason: fn(got, mark.n)
      ? ""
      : `溯源记号赌的是 ${mark.file} 里 /${mark.pattern}/ ${mark.op}${mark.n}，**现算 ${got}** —— ` +
        `上游变了而屏上那句话没变，它现在正在对用户说谎`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3.6 · 门自述层（STALE-9/10 · WO-STALE-REGEX-BLIND）—— **门必须先扫自己**
// ══════════════════════════════════════════════════════════════════════════════
//
// ── 修的是什么盲区（2026-08-16 实测，逐条有 file:line）────────────────────────
// 本门的扫描范围是 `SCAN_ROOT`（`apps/frontend-shell/src`）与 `srcRoots()`
// （`apps/<pkg>/src` + `packages/<pkg>/src`）。**`scripts/` 一个字都不扫** ——
// 于是本门**看不见自己**，而它自己的文件头与《做不到的部分》里写满了
// 「今天全仓 N 条 / 实测命中 N 行」这类**自称现状的计数**：正是本门存在的理由那一族。
// 当天有 6 个数字已经变假（`@stale-fact` 生产记号「0 条」实为 11 条、
// 基线赌注「6 条」实为 0 条、CONFIRMED-STALE「两条」实为 0 条、
// 注释命中「147 行」实为 63 行、字面量命中「14 行」实为 13 行），而门 RC=0 报绿。
//
// 形态（CLAUDE.md 铁律 0.6 句式）：
//   **「我用『门报 RC=0』当作『仓里没有过期声明』的证据，而前者并不度量后者 ——
//     门的扫描范围里压根没有它自己那份自述。」**
// 这与本门自己的诚实边界第 12 条（「不碰后端注释与 docs/」）**不是同一件事**：
// 那一条是**主动划定**的取舍，而「扫不到自己」是**没人想到过**的洞 ——
// 一道会说谎的门，没有资格说别人说谎。
//
// ── 两条判据（**互补**，缺一就只堵住一半）──────────────────────────────────────
//  ⑨ `STALE-9 · 门自述赌注失守`（**永不豁免**，同 STALE-6）
//     记号语法（与 `@stale-fact` 同族，区别只在赌的对象；下面这行整段裹在反引号里，
//     因为它是**语法说明不是赌注** —— 门认这条规则，见 `SELF_MARK_MENTION`）：
//         `@stale-self <口径名> <op><n>`        op ∈ == != >= <= > <
//     `@stale-fact` 赌的是「某个文件里某条正则的匹配数」；
//     `@stale-self` 赌的是「**本门这一次运行现算出来的某个口径**」——
//     像「注释里命中多少行」这种**跨文件聚合值**，没有任何单文件正则表达得了它，
//     故必须由门把自己算出来的数摆出来让人下注。口径名认不出来 ⇒ 同样判负
//     （作者以为自己挂了赌注，其实赌的是一个不存在的东西）。
//
//  ⑩ `STALE-10 · 门自述的现状计数无赌注`
//     只咬**现状口吻**的计数（`今天 / 今日 / 现在 / 当前 / 实测 / 现算` + 数字 + 量词）。
//     **按语法上下文排除史料，不开文件白名单**（白名单迟早被例外吃光，上下文规则对新写的段落照样生效）：
//     同一声明单元里带 ISO 日期戳（`2026-08-08`）的，读作「那天测的」= 史料，
//     它的保质期已经写在脸上，本层放行（这类段落是本仓刻意保留的错账，见文件头）。
//     不带日期戳却用现状口吻报数的，就是在断言**此刻** —— 必须挂赌注。
//
// ── 为什么不是「把 scripts/ 整个加进 SCAN_ROOT」──────────────────────────────
// 全仓 82 个门脚本每一个都写满「实测」，一加就是几百条存量 ⇒ 只能拿基线买绿，
// 而买绿正是本门要治的病。故本层**只对门自己那份自述**开，判据是「谁在下判断谁先受审」。
// 覆盖面就这么大，不粉饰：见文末《做不到的部分》第 13 条。

/**
 * 门自述赌注。刻意与 `STALE_FACT_MARK` **分开一个记号**而不是复用：
 * 两者赌的东西不是一回事（文件里的正则计数 vs 门现算的聚合口径），
 * 混成一个记号，`runStaleFactMark` 就得去猜第一个实参是路径还是口径名 —— 猜错就是静默放行。
 */
const STALE_SELF_MARK = /@stale-self\s+([a-zA-Z][A-Za-z0-9.]*)\s*(==|!=|>=|<=|>|<)\s*(\d+)/g;
/**
 * **提及 ≠ 写下赌注**（判据同 `MARK_MENTION`，但窗口刻意更宽一点）：
 * 反引号里整段都算举例/术语（`` `@stale-self <口径名> <op><n>` `` 这种语法说明），
 * 不算一条挂坏了的赌注。真要下注就写在注释正文里，不加反引号 ——
 * 这条规则会写进报错文案，作者一看就知道该怎么改。
 * 等长替换（不删）：`extractSelfMarks` 要拿 `m.index` 数行号，删一段后面全漂。
 *
 * ⚠ **反引号一律写成 `\x60`，绝不在正则字面量里放裸反引号**（2026-08-16 当场踩到并被机器抓出）：
 *   `splitCodeAndComments` 是个不认识**正则字面量**的状态机，它只认 `'` `"` 和反引号三种串。
 *   本条第一版写成含 **3 个**裸反引号的正则字面量 ⇒ 状态机进了模板串态且再也没出来，
 *   **从这一行往下整个文件都被判成"代码"**，注释视图当场空掉 —— 而门照样 RC=0，
 *   因为前面那两条赌注恰好在这一行**之前**，抽得到，`self.marks < 1` 的下限也就没喊。
 *   形态（铁律 0.6 句式）：**「我用『赌注抽到了 2 条』当作『注释视图是完整的』的证据，
 *   而前者并不度量后者。」** 对策是下面 `commentViewCoverage` 那道**覆盖率**下限：
 *   它比对「原文里长得像注释的行」与「注释视图真留下的行」，被吞就当场喊工具坏了。
 */
const SELF_MARK_MENTION = new RegExp("\\x60@stale-self[^\\x60\\n]*\\x60", "g");

/** 现状口吻的计数断言。**史料**（同单元带 ISO 日期戳）由调用方按语法上下文排除。 */
const SELF_STATE_CLAIM = /(?:今天|今日|现在|当前|实测|现算)[^。；\n]{0,48}?(?:\*\*)?\d+(?:\*\*)?\s*(?:条|处|个|类|种|行|张)/;

/** 门自述赌注的抽取（**纯函数** —— 金丝雀直接喂它，与自扫描共用这同一份实现）。 */
export function extractSelfMarks(text) {
  const masked = text.replace(SELF_MARK_MENTION, (m) => " ".repeat(m.length));
  const marks = [];
  for (const m of masked.matchAll(STALE_SELF_MARK)) {
    marks.push({ metric: m[1], op: m[2], n: Number(m[3]), line: masked.slice(0, m.index).split("\n").length });
  }
  const attempts = [...masked.matchAll(/@stale-self/g)];
  return { marks, malformed: attempts.length - marks.length, malformedLines: attempts.map((r) => masked.slice(0, r.index).split("\n").length) };
}

/**
 * 跑一条门自述赌注 —— **与 `runStaleFactMark` 共用同一张 `OP_FN`**（另抄一份比较表就是装饰品）。
 * @param {{metric:string, op:string, n:number}} mark
 * @param {Record<string, number>} live  本次运行**现算**出来的口径表
 */
export function runStaleSelfMark(mark, live) {
  if (!(mark.metric in live)) {
    // 判负而不是判「工具坏了」：口径名打错 = 这条赌注**从来没被执行过**，
    // 与「记号指向的来源文件不在了」是同一族（作者以为挂了赌注，其实一条都没跑）。
    return {
      ok: false,
      got: null,
      reason:
        `门自述赌注里的口径名不认识：\`${mark.metric}\` —— 这条赌注从来没被执行过。` +
        `可用口径：${Object.keys(live).sort().join(" · ")}`,
    };
  }
  const got = live[mark.metric];
  const fn = OP_FN[mark.op];
  if (fn === undefined) return { ok: false, got, reason: `门自述赌注里的比较符不认识：${mark.op}` };
  return {
    ok: fn(got, mark.n),
    got,
    reason: fn(got, mark.n)
      ? ""
      : `门自述赌的是 \`${mark.metric}\` ${mark.op}${mark.n}，**本次现算 ${got}** —— ` +
        `口径变了而门的自述没变：这道门自己正在说一句过时的话`,
  };
}

/**
 * ⑨⑩ 判据本体（**纯函数** —— 金丝雀直接喂它，与自扫描共用这同一份实现）。
 *
 * @param {string} text     声明单元原文
 * @param {string} markText 可挂记号的范围（本单元 + 紧贴其上的连续注释块）
 * @param {Record<string, number>} live 本次现算口径表
 */
export function judgeSelfUnit(text, markText, live) {
  const out = [];
  const { marks, malformed } = extractSelfMarks(markText);
  if (malformed > 0) {
    out.push({
      code: "STALE-9",
      detail:
        `有 ${malformed} 处 \`@stale-self\` 语法不完整 —— 作者以为自己挂了赌注，其实门一条都没跑。` +
        "语法：@stale-self <口径名> <op><n>（举例请整段放进反引号，门会当作术语提及放行）",
    });
  }
  for (const m of marks) {
    const r = runStaleSelfMark(m, live);
    if (!r.ok) out.push({ code: "STALE-9", detail: r.reason });
  }
  // ⑩ 史料按**语法上下文**排除：同单元带 ISO 日期戳 ⇒ 「那天测的」，保质期写在脸上
  const isHistory = DATE_PATTERNS.some((re) => re.test(text));
  const { marks: factMarks } = parseStaleFactMarks(markText);
  if (SELF_STATE_CLAIM.test(text) && !isHistory && marks.length === 0 && factMarks.length === 0) {
    out.push({
      code: "STALE-10",
      detail:
        "门的自述里用**现状口吻**报了一个计数（今天/今日/现在/当前/实测 + 数字 + 量词），却既无日期戳也无赌注 —— " +
        "没有保质期、也没有机器复核，上游一变这句话就变成一道**会说谎的门**。" +
        "修法：① 若说的是史料 ⇒ 补上实测日期（YYYY-MM-DD）；② 若说的是此刻 ⇒ 挂 @stale-self <口径名> <op><n>，把这句话赌的口径写下来。",
    });
  }
  return out;
}

/** ⑦ 改名声明：仓里唯一能被机器读出的「这两个名字是同一个东西」的证据。 */
const RENAME_DECL = /(?:前名|原名|旧名|原称|改名前叫)\s*[「『"]([^」』"\n]{2,24})[」』"]/g;
/** 旧名若还活在这些槽位里，就是**活字面量**（不是"注释里提了一嘴"）。 */
const NAME_SLOT = (old) => new RegExp(`(?:name|title|featureName|label|heading)\\s*:\\s*"${old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g");

/**
 * ⑦ 判据本体（**纯函数**，金丝雀直接喂它）。
 * @param {{old:string, at:string}[]} decls        改名声明
 * @param {{file:string, line:number, text:string}[]} literals  全仓非 test 源码的**活字面量**行
 */
export function judgeRenameResidue(decls, literals) {
  const out = [];
  for (const d of decls) {
    const re = NAME_SLOT(d.old);
    for (const l of literals) {
      re.lastIndex = 0;
      if (!re.test(l.text)) continue;
      out.push({
        code: "STALE-7",
        file: l.file,
        line: l.line,
        detail:
          `旧名「${d.old}」仍是活字面量，而 ${d.at} 已声明它改过名 —— **一个概念两份真相源**：` +
          `改了一份没改另一份，部署态由后端下发标题时用户会看到旧名`,
        sample: l.text.trim().slice(0, 120),
      });
    }
  }
  return out;
}

/**
 * ⑧ 视图标题的真相源槽位（后端 VIEW_DEFS / features 注册表 / view-manifest / mock fixtures 通吃）。
 *
 * ⚠ **`title` 与 `featureName` 分成两个命名空间**（这一条是本单当场被自己的输出逼出来的）：
 *   第一版把两者揉进同一个桶，于是 `view-manifest.ts` 那行
 *   `{ key: "dash", title: "经营驾驶舱", featureKey: "view.dash", featureName: "驾驶舱" }`
 *   自己跟自己"分叉"，报出 4 条噪声。真相是它们**本来就是两个概念**：
 *   `title` = 屏上的视图标题，`featureName` = 功能开关册里的功能名，同一个 slug 上各有一份是正常的。
 *   形态（铁律 0.6 句式）：「我用『两个字符串不相等』当作『同一个概念有两份真相源』的证据，
 *   而前者并不度量后者 —— 得先确认它们说的是同一个概念。」
 */
/**
 * ⚠ **2026-08-15 · `feature-name` 两条槽位的判据补盲区（WO-STALE-TEXT-SWEEP）**
 *
 * ── 旧判据错在哪（不是"太严"，是**度量错了对象**）─────────────────────────────
 * 旧写法 `key:\s*"view\.([a-z0-9-]+)"` 把两个互不相干的限制一起焊进了正则：
 *   ① 前缀只认 `view.`；② slug 段里不许出现 `.`。
 * 而功能开关册的键**从来就不止 `view.` 前缀、也从来允许多段** —— 同一份注册表里躺着
 * `shell.query-dock` · `qos.agent-fallback` · `admin.plan-builder` · `act.export` · `sim.sandbox`
 * 与 `view.graph.persp.all` · `view.project-sim.whatif` · `view.risk-board.mitigation`。
 * 这些键**一条都抽不出来**，于是「一个概念两份真相源」这条判据在它们身上等于没开。
 * 实测（下方 `featureKeySlotCanary()` 跑的是**同一份 `VIEW_TITLE_SLOTS`**，不是另抄的正则）：
 * 被 ≥2 个真相源同时登记、因而**真有可能查出分叉**的键，旧判据 43 个 → 新判据 82 个，
 * 其中 **39 个是旧判据完全看不见的**（`agentcore/features/registry.ts` × `datacore/features.ts`
 * × `frontend-shell/mocks/fixtures.ts` 三方各登记一份名字的那批）。
 *
 * 形态（铁律 0.6 句式）：**「我用『门报了 N 条』当作『只有 N 条』的证据，而前者并不度量后者」** ——
 * 门报 0 条分叉不是因为没有分叉，是因为它压根没把这些键抽出来。
 *
 * ── 新判据为什么**仍咬得住**原来那个病 ────────────────────────────────────────
 * 新判据 = **「带点的小写键」即功能键**（`<段>.<段>[.<段>…]`），前缀不限。
 * 「至少含一个点」这一条**是收窄不是放宽**：它把**同形但不同概念**的 `key:` 挡在外面 ——
 * 求解器键 `finance_pnl`、视图 slug `order-chain` 都不带点，一个都不会误进 `feature-name`
 * 命名空间（那是 `view-title` 那两条槽位的地盘，本次一个字未动）。
 * 原病灶 `view.order-chain`（订单全链聚合 → 订单进展与卡因）依旧逐字命中。
 *
 * ── 顺带堵上加宽才会出现的新坑：**捕获整键含前缀** ──────────────────────────
 * 旧写法捕获组只取 `view.` 之后那截（`dash`）。前缀一放开，`view.x` 与 `qos.x` 就会并进
 * 同一个 slug 桶 ⇒ 两个**本来无关**的功能被判成"标题分叉"，凭空造出一条假红。
 * 故新捕获组取**整键**（`view.dash`）—— 加宽判据时必须同时问「这个键还唯一吗」。
 */
const FEATURE_KEY = String.raw`[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+`;
const VIEW_TITLE_SLOTS = [
  { ns: "feature-name", re: new RegExp(String.raw`key:\s*"(${FEATURE_KEY})"\s*,\s*name:\s*"([^"]+)"`, "g") },
  { ns: "feature-name", re: new RegExp(String.raw`featureKey:\s*"(${FEATURE_KEY})"\s*,\s*featureName:\s*"([^"]+)"`, "g") },
  { ns: "view-title", re: /key:\s*"([a-z0-9-]+)"\s*,\s*title:\s*"([^"]+)"/g },
  { ns: "view-title", re: /"([a-z0-9-]+)":\s*\{\s*[\r\n]?\s*title:\s*"([^"]+)"/g },
];
const camelToKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * ⑧ 判据本体（**纯函数**）。
 * @param {Map<string, {title:string, at:string}[]>} registry  slug → 各真相源里的标题
 * @param {{ns:string, title:string, at:string}[]} localeTitles  前端 locale 的 `<ns>.title`
 */
export function judgeViewTitleForks(registry, localeTitles) {
  const out = [];
  for (const [nsSlug, rows] of registry) {
    const distinct = [...new Set(rows.map((r) => r.title))];
    if (distinct.length > 1) {
      out.push({
        code: "STALE-8",
        file: rows[0].at.split(":")[0],
        line: Number(rows[0].at.split(":")[1]),
        detail: `${nsSlug} 在真相源之间分叉：${distinct.join(" ≠ ")}（出处 ${rows.map((r) => r.at).join(" · ")}）`,
        sample: `${nsSlug} ${distinct.join(" ≠ ")}`,
      });
    }
  }
  for (const l of localeTitles) {
    // 前端 locale 的 `<ns>.title` 对的是**视图标题**那一份真相源，不是功能开关册里的功能名
    const slug = `view-title:${camelToKebab(l.ns)}`;
    const rows = registry.get(slug);
    // ⚠ 映射对不上就**一个字都不说**：`quarter`→`quarter`（真 slug `quarterly-rolling`）、
    //   `geo`→`geo`（真 slug `geo-map`）—— 本门认不准的映射不许拿来判人（宁可漏，不可诬）。
    if (rows === undefined) continue;
    const distinct = [...new Set(rows.map((r) => r.title))];
    if (distinct.includes(l.title)) continue;
    out.push({
      code: "STALE-8",
      file: l.at.split(":")[0],
      line: Number(l.at.split(":")[1]),
      detail:
        `前端 locale `.concat(`zh.${l.ns}.title = "${l.title}"`, `，而后端/注册表里同一个视图 slug「${slug}」写的是 `) +
        `${distinct.join(" / ")}（出处 ${rows.map((r) => r.at).join(" · ")}）—— 一个概念两份真相源`,
      sample: `zh.${l.ns}.title="${l.title}" ≠ ${distinct.join("/")}`,
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 检测器（**纯函数** —— 金丝雀就靠它能被单独喂样例）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @param {string} text  一个声明单元的原文
 * @param {{ materializedTypes: Set<string>|null, refCounter: (sym:string)=>{n:number,hits:string[]} }} facts
 * @returns {{code:string, detail:string}[]}
 */
export function judgeUnit(text, facts) {
  const out = [];

  // ── ①② 保质期两问：只对**声明式**用法发问（把"实测"当词用的不问）────────────
  const declarative = CLAIM_KEYWORDS.some((k) => text.includes(k)) && MEASURED_RESULT_PATTERNS.some((re) => re.test(text));
  if (declarative) {
    if (!DATE_PATTERNS.some((re) => re.test(text))) {
      out.push({ code: "STALE-1", detail: "自称实测/实跑/运行态却没写**哪天测的** —— 没有日期就没有保质期，上游一变没人知道该复验" });
    }
    if (!HOWTO_PATTERNS.some((re) => re.test(text))) {
      out.push({ code: "STALE-2", detail: "没有可复验方式（端点 / 命令 / file:line 锚点）—— 复审无法亲手跑一遍，只能选择相信" });
    }
  }

  // ── ③ 事实当场读回：**不挂在关键词上** ──────────────────────────────────────
  //
  // 刻意与 ①② 解耦。本单三处病灶里的第 ② 处（K2 「同上无 `Cadence` 实例；且全仓零运行时消费方」）
  // **一个「实测」字都没有**，却同样是假话 —— 若把事实层也挂在关键词上，它就从门下溜过去了。
  // 「这句话能不能被机器证伪」与「作者有没有自称实测」是两件事：能证伪的就当场证。
  if (facts.materializedTypes !== null) {
    const claimed = new Set();
    for (const re of ABSENCE_ASSERTIONS) for (const m of text.matchAll(re)) claimed.add(m[1]);
    for (const t of claimed) {
      if (facts.materializedTypes.has(t)) {
        out.push({
          code: "STALE-3",
          detail: `声明「${t} 无承载 / 0 条」，但 apps/datacore/src/synthetic/service.ts 今天有 putAll("${t}", …) —— 上游已补齐，这句话已经是假的`,
        });
      }
    }
  }
  for (const s of subjectsOfDeadClaims(text)) {
    const { n, hits } = facts.refCounter(s);
    if (n > 0) {
      out.push({
        code: "STALE-4",
        detail: `声明「${s} 零消费方」，但 src 下实有 ${n} 处引用（${hits.slice(0, 3).join(" · ")}${hits.length > 3 ? " …" : ""}）—— 这句话已经是假的`,
      });
    }
  }
  return out;
}

/**
 * ⑤⑥ **屏上断言**检测器（**纯函数** —— 金丝雀直接喂它，与主流程共用这同一份实现）。
 *
 * 与 `judgeUnit` 刻意分开两个函数而不是塞进一个：
 * 两者**喂进来的文本不是一回事** —— `judgeUnit` 吃的是原文（含注释），
 * 本函数吃的是**剥掉注释后仍存在的字面量**那一段。混成一个函数，调用方迟早喂错，
 * 而喂错的后果是"看着在跑，其实扫的是另一批字"（本仓假绿的经典形态）。
 *
 * @param {string} text      声明单元里的**字面量**原文（已剥注释、行数守恒）
 * @param {string} markText  可挂记号的范围原文（本单元 + 紧贴其上的连续注释块，**未剥注释**）
 * @param {{readSource:(rel:string)=>string|null}} facts
 * @returns {{code:string, detail:string}[]}
 */
export function judgeOnscreen(text, markText, facts) {
  const out = [];
  const enumHit = ENUM_ASSERTIONS.some((re) => re.test(text));
  const negHit = NEGATIVE_ASSERTIONS.some((re) => re.test(text));
  const { marks, malformed } = parseStaleFactMarks(markText);

  if (malformed > 0) {
    out.push({
      code: "STALE-6",
      detail: `有 ${malformed} 处 \`@stale-fact\` 语法不完整 —— 作者以为自己挂了赌注，其实门一条都没跑。语法：@stale-fact <路径> /<正则>/ <op><n>`,
    });
  }
  for (const m of marks) {
    const r = runStaleFactMark(m, facts.readSource);
    if (!r.ok) out.push({ code: "STALE-6", detail: r.reason });
  }

  if ((enumHit || negHit) && marks.length === 0) {
    out.push({
      code: "STALE-5",
      detail:
        `屏上字面量里有${enumHit ? "**枚举断言**（「只有…N 类」/「共 N 种」）" : ""}` +
        `${enumHit && negHit ? "与" : ""}${negHit ? "**否定断言**（「一条都没有」/「全仓 0 条」）" : ""}，` +
        "却没有任何 `@stale-fact` 溯源记号 —— 这句话上游一变就变成屏上说谎，而没有任何人会被通知。" +
        "修法：在本单元或紧贴其上的注释块里挂 `@stale-fact <路径> /<正则>/ <op><n>`，把这句话赌的那个计数写下来。",
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · 金丝雀 —— 门自己得先被咬一口
// ══════════════════════════════════════════════════════════════════════════════

/** 必咬样例（每条都对应一个真实病灶形态）。任一条没被咬 ⇒ 门瞎了。 */
const MUST_BITE = [
  {
    name: "自称实测但没日期",
    text: '"公式有但值缺：`Cadence` 对象全仓 0 条（运行态实测 `GET /a/v1/objects?type=Cadence` → total 0）"',
    expect: "STALE-1",
  },
  {
    name: "自称实测但没复验方式",
    text: '"实测 130 行，够用且留余量（2026-08-08）"',
    expect: "STALE-2",
  },
  {
    name: "声称某对象类型 0 条，而它其实在册",
    text: '"2026-08-08 运行态实测 `GET /a/v1/objects?type=Cadence` → Cadence 对象全仓 0 条"',
    expect: "STALE-3",
  },
  {
    name: "声称某符号零消费方，而它其实有生产调用方",
    text: '"`buildCadenceGates` 全仓零运行时消费方（2026-08-08 实测 grep 计数 0，见 apps/datacore/src/sim/propagation.ts:120）"',
    expect: "STALE-4",
  },
  {
    // 本单病灶 ②：**一个「实测」字都没有**的假话。若事实层挂在关键词上，这条就溜过去了。
    name: "不含任何触发词、但事实已被上游推翻",
    text: '"`Cadence.offsetDays` · chain-sim.ts:73（契约字段在），但同上无 `Cadence` 实例"',
    expect: "STALE-3",
  },
];

/** 必**不**咬样例（把「实测」当词用的，咬了就是噪声门）。 */
const MUST_NOT_BITE = [
  { name: "provenance 徽章标签", text: 'const PROV_KIND_COLOR = { 实测: "#62BE77", 派生: "#4C90F0" };' },
  { name: "屏上字段名", text: "<dt>实测值 vs 阈值</dt>" },
  { name: "诚实灰标", text: '<span>合成·未接实测</span>' },
];

// ── ⑤⑥ 屏上断言层的金丝雀（**跑的是 `judgeOnscreen` 本体**，不另抄一份正则）────────
//
// 金丝雀里的 `readSource` 是**内嵌的假来源**：判据要验的是"记号跑得对不对"，
// 不是"仓里今天有几条" —— 拿真仓当金丝雀，仓一变金丝雀就跟着变，等于没有基准。
const CANARY_SOURCES = {
  "fake/upstream.ts": 'drillType: "Line"\ndrillType: "MaterialBatch"\n',
};
const canaryReadSource = (rel) => (rel in CANARY_SOURCES ? CANARY_SOURCES[rel] : null);

/** 必咬（屏上层）。每条都是本单实测到的真实形态。 */
const ONSCREEN_MUST_BITE = [
  {
    name: "屏上枚举断言、无溯源记号（= 本单病灶 ①：「locus 只有…三类」）",
    text: '"demo 的 locus 只有 MaterialBalance / MaterialBatch / Line 三类，"',
    mark: "",
    expect: "STALE-5",
  },
  {
    name: "屏上否定断言、无溯源记号（= 本单病灶 ①下半：「一条都没有」）",
    text: '"而合成种子里带 drillType=MaterialBatch 或 Line 的因子一条都没有。"',
    mark: "",
    expect: "STALE-5",
  },
  {
    name: "带记号，但上游已经变了 ⇒ 现算不符（治本的那一层）",
    text: '"带 drillType=Line 的因子一条都没有"',
    mark: '// @stale-fact fake/upstream.ts /drillType: "Line"/ ==0',
    expect: "STALE-6",
  },
  {
    name: "记号指向的来源文件已经不在了 ⇒ 这条断言无源可核",
    text: '"共 3 类"',
    mark: "// @stale-fact fake/gone.ts /whatever/ ==1",
    expect: "STALE-6",
  },
  {
    name: "写了 @stale-fact 但语法不完整 ⇒ 作者以为挂了赌注，其实一条都没跑",
    text: '"只有三类"',
    mark: "// @stale-fact apps/x.ts 大概有三条吧",
    expect: "STALE-6",
  },
];

/** 必**不**咬（屏上层）。咬了就是噪声门 —— 噪声一多，白名单一长，门就死了。 */
const ONSCREEN_MUST_NOT_BITE = [
  {
    name: "带合法溯源记号、且现算相符 ⇒ 放行（这就是本门要的那个终态）",
    text: '"带 drillType=Line 的因子一条都没有"',
    mark: '// @stale-fact fake/upstream.ts /drillType: "Line"/ ==1',
  },
  { name: "屏上普通文案，没有任何可证伪的量化断言", mark: "", text: '"合计套"' },
  { name: "带数字但不是封死集合的断言（不构成可现场复核的枚举）", mark: "", text: '"共涉及 3 个基地的产能面"' },
];

/** ⑦⑧ 判据的金丝雀（同样跑 `judgeRenameResidue` / `judgeViewTitleForks` 本体）。 */
function renameJudgeCanary() {
  const decls = [{ old: "订单全链聚合", at: "fake/zh.ts:1" }];
  const bite = judgeRenameResidue(decls, [{ file: "fake/features.ts", line: 9, text: '{ key: "view.order-chain", name: "订单全链聚合" }' }]);
  const pass = judgeRenameResidue(decls, [
    { file: "fake/features.ts", line: 9, text: '{ key: "view.order-chain", name: "订单进展与卡因" }' },
    // 「注释里提了一嘴旧名」不算残留 —— 主流程喂进来的是**剥过注释**的行，这里模拟其结果
    { file: "fake/other.ts", line: 3, text: "const s = 订单全链聚合;" },
  ]);
  const bad = [];
  if (bite.length !== 1) bad.push(`⑦必咬：旧名活字面量应被咬 1 条，实得 ${bite.length}`);
  if (pass.length !== 0) bad.push(`⑦必不咬：改到位/非槽位的不该被咬，实得 ${pass.length}`);
  return bad;
}

function viewTitleJudgeCanary() {
  const forked = new Map([["view-title:a-view", [{ title: "旧名", at: "fake/x.ts:1" }, { title: "新名", at: "fake/y.ts:2" }]]]);
  const agreed = new Map([
    ["view-title:a-view", [{ title: "新名", at: "fake/x.ts:1" }, { title: "新名", at: "fake/y.ts:2" }]],
    // 同一个 slug 上「视图标题」与「功能名」各有一份是**正常**的，不许判成分叉（第一版栽在这儿）
    ["feature-name:a-view", [{ title: "另一个概念的名字", at: "fake/x.ts:1" }]],
  ]);
  const bad = [];
  if (judgeViewTitleForks(forked, []).length !== 1) bad.push("⑧必咬：同 slug 标题分叉应被咬");
  if (judgeViewTitleForks(agreed, []).length !== 0) bad.push("⑧必不咬：同 slug 标题一致不该被咬");
  // locale 桥：camel→kebab **恰好等于** slug 才判；对不上的一个字都不说
  if (judgeViewTitleForks(agreed, [{ ns: "aView", title: "另一个名", at: "fake/zh.ts:5" }]).length !== 1)
    bad.push("⑧必咬：locale 命名空间 aView→a-view 与注册表分叉应被咬");
  if (judgeViewTitleForks(agreed, [{ ns: "quarter", title: "季度规划", at: "fake/zh.ts:6" }]).length !== 0)
    bad.push("⑧必不咬：locale 命名空间映射不到任何 slug 时必须闭嘴（宁可漏，不可诬）");
  return bad;
}

/**
 * ⑧ **功能键槽位**的金丝雀（2026-08-15 补盲区随手加的那道机器）。
 *
 * 跑的是**同一份 `VIEW_TITLE_SLOTS`**，不是另抄一份正则 —— 抄了就是装饰品：
 * 改主正则时金丝雀拿旧的去测、照样绿（本仓 2026-08-08 实测过的那个坑）。
 * 四条必咬 = 旧判据的盲区各取一例；两条必不咬 = 加宽**不许**把非功能键卷进来。
 */
function featureKeySlotCanary() {
  const probe = [
    'const F = [{ key: "view.dash", name: "驾驶舱" },',
    '  { key: "view.graph.persp.all", name: "图谱·全景" },', // 盲区①：带点的多段 slug
    '  { key: "qos.agent-fallback", name: "Agent 兜底" },', // 盲区②：非 view. 前缀
    '  { featureKey: "view.project-sim.whatif", featureName: "What-if 调参" },', // 盲区③：两者兼有
    '  { key: "finance_pnl", name: "量价本利科目表" },', // 必不咬：求解器键（不带点）
    '  { key: "order-chain", name: "订单进展与卡因" }];', // 必不咬：裸视图 slug（不带点）
  ].join("\n");
  const seen = new Set();
  for (const { ns, re } of VIEW_TITLE_SLOTS) {
    re.lastIndex = 0;
    for (const m of probe.matchAll(re)) seen.add(`${ns}:${m[1]}`);
  }
  const bad = [];
  for (const want of ["feature-name:view.dash", "feature-name:view.graph.persp.all", "feature-name:qos.agent-fallback", "feature-name:view.project-sim.whatif"]) {
    if (!seen.has(want)) bad.push(`⑧功能键必咬：槽位正则抽不到「${want}」—— 盲区没补上（或补完又被改窄了）`);
  }
  for (const never of ["feature-name:finance_pnl", "feature-name:order-chain"]) {
    if (seen.has(never)) bad.push(`⑧功能键必不咬：不带点的「${never}」被当成功能键卷进来了 —— 判据加宽过头，会把求解器键/视图 slug 混成一个命名空间`);
  }
  // 捕获整键（含前缀）：否则 `view.x` 与 `qos.x` 会并成一个桶，凭空造出假分叉
  if (seen.has("feature-name:dash")) bad.push("⑧功能键：捕获组只取了 `view.` 之后那截 —— 不同前缀的同名键会并桶，造出假分叉");
  return bad;
}

/**
 * ⑥b **记号扫全仓**的金丝雀（跑 `extractMarksWithLines` + `runStaleFactMark` 本体）。
 * 验四件事：抽得到 · 行号对 · 语法坏的能被认出来 · **术语提及不被误判**。
 * 行号错了，报出来的红没人找得到那条赌注。
 */
function markSweepCanary() {
  const probe = ["行1", '// @stale-fact fake/upstream.ts /drillType: "Line"/ ==1', "行3", "// @stale-fact 这条语法是坏的"].join("\n");
  const { marks, malformed } = extractMarksWithLines(probe);
  const bad = [];
  if (marks.length !== 1) bad.push(`⑥b必咬：应抽到 1 条合法记号，实得 ${marks.length}`);
  else {
    if (marks[0].line !== 2) bad.push(`⑥b行号：合法记号在第 2 行，实得 ${marks[0].line} —— 行号错了，报出的红没人找得到`);
    const r = runStaleFactMark(marks[0], canaryReadSource);
    if (!r.ok || r.got !== 1) bad.push(`⑥b执行器：内嵌假来源里 /drillType: "Line"/ 应现算 1 且通过，实得 got=${r.got} ok=${r.ok}`);
  }
  if (malformed !== 1) bad.push(`⑥b语法坏的记号应被认出 1 处，实得 ${malformed} —— 认不出 = 作者以为挂了赌注其实没挂`);

  // **提及 ≠ 赌注**：注释里用反引号提一嘴这个术语，不许被判成"语法不完整"（否则门开始惩罚写文档的人）。
  // 同时验行号仍守恒 —— 剔除提及是等长替换，不是删除。
  const mention = ["行1", "说明：故本表下方挂 `@stale-fact` 记号，由门现算比对。", '// @stale-fact fake/upstream.ts /drillType: "Line"/ ==1'].join("\n");
  const mres = extractMarksWithLines(mention);
  if (mres.malformed !== 0) bad.push(`⑥b提及被误判：反引号包起来的术语提及被当成坏记号（实得 malformed=${mres.malformed}）`);
  if (mres.marks.length !== 1 || mres.marks[0].line !== 3) {
    bad.push(`⑥b提及剔除破坏了行号守恒：真记号应在第 3 行，实得 ${mres.marks[0]?.line ?? "无"} —— 删而不是等长替换，偏移会全漂`);
  }
  return bad;
}

/**
 * ⑨⑩ **门自述层**的金丝雀 + **变异反证**（跑 `judgeSelfUnit` / `extractSelfMarks` 本体）。
 *
 * ⚠ **变异反证与主判据共用同一份实现，一个字都不另抄** —— 抄一份就是装饰品：
 *   改主正则时反证拿旧的去测、照样绿（本仓 2026-08-08 实测抓到过这种装饰品）。
 *   故此处**不写任何正则**，只喂样例给 `judgeSelfUnit`，用它的返回码判对错。
 *
 * 变异反证喂的是「故意写过时的自述」，两类各一条：
 *   · 赌注失守（数字与现算不符）⇒ 必须 STALE-9；
 *   · 现状口吻报数、无日期无赌注 ⇒ 必须 STALE-10。
 * 再各配一条必**不**咬（赌注相符 / 带日期的史料），证明它不是「见数字就红」的噪声门。
 */
function selfClaimCanary() {
  const bad = [];
  const LIVE = { "canary.alpha": 11, "canary.beta": 0 };
  const cases = [
    // ── 必咬（变异反证：两类各一条）────────────────────────────────────────────
    {
      name: "⑨变异反证·赌注失守：自述写 0 条，而现算 11 条",
      text: " * 写在源码里的记号，今天全仓 0 条。",
      mark: " * 写在源码里的记号，今天全仓 0 条。 @stale-self canary.alpha ==0",
      expect: "STALE-9",
    },
    {
      name: "⑩变异反证·现状口吻报数却既无日期也无赌注",
      text: " * 后者今天有 6 条真数据在跑。",
      mark: " * 后者今天有 6 条真数据在跑。",
      expect: "STALE-10",
    },
    {
      name: "⑨口径名打错 ⇒ 这条赌注从来没被执行过",
      text: " * 今天 3 条。",
      mark: " * 今天 3 条。 @stale-self canary.typo ==3",
      expect: "STALE-9",
    },
    {
      name: "⑨语法不完整 ⇒ 作者以为挂了赌注其实没挂",
      text: " * 今天 3 条。",
      mark: " * 今天 3 条。 @stale-self 大概三条吧",
      expect: "STALE-9",
    },
  ];
  for (const c of cases) {
    const codes = judgeSelfUnit(c.text, c.mark, LIVE).map((v) => v.code);
    if (!codes.includes(c.expect)) bad.push(`门自述必咬样例「${c.name}」没被咬（期望 ${c.expect}，实得 ${codes.join(",") || "无"}）`);
  }
  const passCases = [
    { name: "赌注相符 ⇒ 放行（这就是本层要的终态）", text: " * 今天全仓 11 条。", mark: " * 今天全仓 11 条。 @stale-self canary.alpha ==11" },
    { name: "带 ISO 日期戳的史料 ⇒ 放行（保质期写在脸上，本仓刻意保留的错账）", text: " * 2026-08-08 一天之内实测到 6 例同一个病。", mark: " * 2026-08-08 一天之内实测到 6 例同一个病。" },
    { name: "语法举例整段放进反引号 ⇒ 术语提及，不是坏赌注", text: " * 语法说明。", mark: " * 语法：`@stale-self <口径名> <op><n>`，由门现算比对。" },
    { name: "没有计数的普通说明 ⇒ 放行", text: " * 本层只对门自己那份自述开。", mark: " * 本层只对门自己那份自述开。" },
  ];
  for (const c of passCases) {
    const codes = judgeSelfUnit(c.text, c.mark, LIVE).map((v) => v.code);
    if (codes.length > 0) bad.push(`门自述必不咬样例「${c.name}」被误咬（${codes.join(",")}）—— 噪声一多白名单就长，门就死了`);
  }
  // 行号守恒：报出的红要让人找得到那条赌注（剔除提及是等长替换，不是删除）
  const probe = ["行1", "说明：语法 `@stale-self canary.alpha ==11` 只是举例。", "行3 @stale-self canary.alpha ==11"].join("\n");
  const ex = extractSelfMarks(probe);
  if (ex.marks.length !== 1 || ex.marks[0].line !== 3) {
    bad.push(`⑨行号守恒：真赌注应在第 3 行且只抽到 1 条，实得 ${ex.marks.length} 条 / 行 ${ex.marks[0]?.line ?? "无"}`);
  }
  if (ex.malformed !== 0) bad.push(`⑨反引号举例被误判成坏赌注（malformed=${ex.malformed}）—— 门开始惩罚写文档的人`);
  bad.push(...splitViewCanary());
  return bad;
}

/**
 * **两个视图互补**的金丝雀（跑 `stripCommentsKeepLines` / `stripCodeKeepComments` 本体）。
 *
 * 这一条是 ⑨⑩ 的地基：`comments` 视图一坏，本层要么什么都扫不到（报「门的自述没问题」= 假绿），
 * 要么把自己的实现全咬一遍（噪声淹掉真病灶）。两种坏法方向相反，故**双向**都验。
 */
function splitViewCanary() {
  const bad = [];
  const probe = 'const a = "字面量里的话"; // 注释里的话\n/* 块注释里的话 */\nconst re = /@x/;\n';
  const code = stripCommentsKeepLines(probe);
  const comm = stripCodeKeepComments(probe);
  if (code.length !== probe.length || comm.length !== probe.length) {
    bad.push(`⑨视图长度不守恒（code=${code.length} comments=${comm.length} 原文=${probe.length}）—— 偏移一漂，报出的 file:line 全是错的`);
  }
  if (code.split("\n").length !== probe.split("\n").length || comm.split("\n").length !== probe.split("\n").length) {
    bad.push("⑨视图行数不守恒 —— 报出来的 file:line 会全部漂掉");
  }
  if (!code.includes("字面量里的话")) bad.push("⑨code 视图把字面量也剥了 —— ⑤ 那一层等于没开");
  if (code.includes("注释里的话") || code.includes("块注释里的话")) bad.push("⑨code 视图没剥掉注释 —— ⑤ 会把注释当屏上文案");
  if (!comm.includes("注释里的话") || !comm.includes("块注释里的话")) bad.push("⑨comments 视图漏了注释 —— ⑨⑩ 这一层会报「门的自述没问题」，那是假绿");
  if (comm.includes("字面量里的话") || comm.includes("@x")) bad.push("⑨comments 视图把代码也留下了 —— 门会把自己的实现咬成噪声，真病灶淹在里面");
  // 逐字节互补：同一位置至多一边是非空白（换行两边都留）
  for (let i = 0; i < probe.length; i++) {
    const a = code[i];
    const b = comm[i];
    if (a === "\n" && b === "\n") continue;
    if (a !== " " && b !== " ") { bad.push(`⑨两视图在偏移 ${i} 同时非空白（'${a}'/'${b}'）—— 不互补就说明状态机分叉了`); break; }
  }
  return bad;
}

function selftest(facts, scanStats) {
  const blind = [];
  for (const c of MUST_BITE) {
    const codes = judgeUnit(c.text, facts).map((v) => v.code);
    if (!codes.includes(c.expect)) blind.push(`必咬样例「${c.name}」没被咬（期望 ${c.expect}，实得 ${codes.join(",") || "无"}）`);
  }
  for (const c of MUST_NOT_BITE) {
    const codes = judgeUnit(c.text, facts).map((v) => v.code);
    if (codes.length > 0) blind.push(`必不咬样例「${c.name}」被误咬（${codes.join(",")}）`);
  }
  // ── ⑤⑥⑦⑧ 屏上事实层的金丝雀 ────────────────────────────────────────────────
  for (const c of ONSCREEN_MUST_BITE) {
    const codes = judgeOnscreen(c.text, c.mark, { readSource: canaryReadSource }).map((v) => v.code);
    if (!codes.includes(c.expect)) blind.push(`屏上必咬样例「${c.name}」没被咬（期望 ${c.expect}，实得 ${codes.join(",") || "无"}）`);
  }
  for (const c of ONSCREEN_MUST_NOT_BITE) {
    const codes = judgeOnscreen(c.text, c.mark, { readSource: canaryReadSource }).map((v) => v.code);
    if (codes.length > 0) blind.push(`屏上必不咬样例「${c.name}」被误咬（${codes.join(",")}）`);
  }
  blind.push(...renameJudgeCanary(), ...viewTitleJudgeCanary(), ...featureKeySlotCanary(), ...markSweepCanary(), ...selfClaimCanary());
  // 基线写入器的四向金丝雀（**跑 buildBaselineDoc 本体**）—— 不过 ⇒ `--update` 会静默吞掉人手挂账
  {
    const c = baselineDocCanary();
    if (!c.ok) blind.push(`基线写入器金丝雀未过：${c.got}（期望：${c.want}）—— --update 会吞掉人手写的 why/verdict`);
  }
  // 剥注释器自己也得被咬一口：它一坏，⑤ 这一层就从"只扫屏上字"退化成"什么都扫"或"什么都不扫"
  {
    const probe = 'const a = "屏上：只有三类"; // 注释里：一条都没有\n/* 块注释：共 9 种 */\nconst b = 2;\n';
    const got = stripCommentsKeepLines(probe);
    if (got.split("\n").length !== probe.split("\n").length) blind.push("剥注释器**行数不守恒** —— 报出来的 file:line 会全部漂掉");
    if (!got.includes("只有三类")) blind.push("剥注释器把**字面量**也剥掉了 —— ⑤ 这一层等于没开");
    if (got.includes("一条都没有") || got.includes("共 9 种")) blind.push("剥注释器没剥掉注释 —— ⑤ 会把注释当屏上文案，噪声淹掉真病灶");
  }
  // 扫描规模下限：防「工具报 0 命中而其实一个文件都没读到」（本会话真踩过的 pathspec 陷阱同源）
  if (scanStats !== null) {
    if (scanStats.files < 50) blind.push(`只扫到 ${scanStats.files} 个源文件（<50）—— 扫描根 ${SCAN_ROOT} 是不是没读到？`);
    if (scanStats.keywordHits < 20) blind.push(`只扫到 ${scanStats.keywordHits} 处关键词（<20）—— 正则或编码坏了，不是代码干净了`);
  }
  if (facts.materializedTypes === null || facts.materializedTypes.size < 20) {
    blind.push(`putAll 事实源读不出（读到 ${facts.materializedTypes?.size ?? "null"} 个类型）—— STALE-3 这一层等于没开`);
  }
  return blind;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 6 · 主流程
// ══════════════════════════════════════════════════════════════════════════════

const unitKey = (file, text) => `${file}#${createHash("sha256").update(text.trim()).digest("hex").slice(0, 16)}`;

function scan(root, facts) {
  const violations = [];
  let files = 0;
  let keywordHits = 0;
  const scanDir = join(root, SCAN_ROOT);
  if (!existsSync(scanDir)) return { violations, files, keywordHits, missing: true };
  for (const f of walk(scanDir)) {
    files += 1;
    const rel = relative(root, f);
    const src = readFileSync(f, "utf8");
    const lines = src.split("\n");
    const owner = blockCommentRanges(lines);
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      const kw = CLAIM_KEYWORDS.some((k) => lines[i].includes(k));
      // 触发两路：① 自称实测的关键词；② **可机器证伪的事实断言**（不必自称实测 —— 病灶 ② 就是这一路）
      if (!kw && !FACT_CLAIM_TRIGGER.test(lines[i])) continue;
      if (kw) keywordHits += 1;
      const [a, b] = unitRange(lines, i, owner);
      const rk = `${a}:${b}`;
      if (seen.has(rk)) continue;
      seen.add(rk);
      const text = lines.slice(a, b + 1).join("\n");
      for (const v of judgeUnit(text, { ...facts, excludeFile: rel })) {
        violations.push({ file: rel, line: a + 1, endLine: b + 1, code: v.code, detail: v.detail, key: unitKey(rel, text), sample: firstClaimLine(lines.slice(a, b + 1)) });
      }
    }
  }
  return { violations, files, keywordHits, missing: false };
}

function firstClaimLine(unitLines) {
  const l = unitLines.find((x) => CLAIM_KEYWORDS.some((k) => x.includes(k))) ?? unitLines[0] ?? "";
  const t = l.trim();
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

// ── ⑤⑥ 屏上断言扫描（扫的是**剥注释后**的字面量，行数守恒）────────────────────

/**
 * 记号可以挂在哪：本单元自己那几行（行尾注释），或**紧贴其上的那个连续注释块**。
 * 判据是**贴不贴着**（连续性），不是"前 N 行" —— 窗宽一改结论就变，等于把判据交给运气。
 */
function markScopeRange(rawLines, a, b) {
  let top = a;
  while (top > 0 && /^\s*(\/\/|\*|\/\*)/.test(rawLines[top - 1])) top -= 1;
  return [top, b];
}

function scanOnscreen(root, facts) {
  const violations = [];
  let files = 0;
  let literalHits = 0;
  // 同一批判据在**注释**里的命中数 —— 只作口径统计（这一层刻意不判注释，见 ⑤ 的说明）。
  // 它是「为什么只扫屏上字」这个取舍的**唯一证据**，故必须现算，不许写死在注释里当传说。
  let commentHits = 0;
  const scanDir = join(root, SCAN_ROOT);
  if (!existsSync(scanDir)) return { violations, files, literalHits, commentHits, missing: true };
  for (const f of walk(scanDir)) {
    files += 1;
    const rel = relative(root, f);
    const raw = readFileSync(f, "utf8");
    const rawLines = raw.split("\n");
    const codeLines = stripCommentsKeepLines(raw).split("\n");
    const owner = blockCommentRanges(codeLines);
    const seen = new Set();
    for (let i = 0; i < rawLines.length; i++) {
      // 「这一行的注释部分」= 原文命中而剥注释后不命中 —— 靠剥注释器行数守恒才成立
      const hitRaw = ENUM_ASSERTIONS.some((re) => re.test(rawLines[i])) || NEGATIVE_ASSERTIONS.some((re) => re.test(rawLines[i]));
      const hitCode = ENUM_ASSERTIONS.some((re) => re.test(codeLines[i] ?? "")) || NEGATIVE_ASSERTIONS.some((re) => re.test(codeLines[i] ?? ""));
      if (hitRaw && !hitCode) commentHits += 1;
    }
    for (let i = 0; i < codeLines.length; i++) {
      const l = codeLines[i];
      if (!ENUM_ASSERTIONS.some((re) => re.test(l)) && !NEGATIVE_ASSERTIONS.some((re) => re.test(l))) continue;
      literalHits += 1;
      const [a, b] = unitRange(codeLines, i, owner);
      const rk = `${a}:${b}`;
      if (seen.has(rk)) continue;
      seen.add(rk);
      const text = codeLines.slice(a, b + 1).join("\n");
      const [ma, mb] = markScopeRange(rawLines, a, b);
      const markText = rawLines.slice(ma, mb + 1).join("\n");
      for (const v of judgeOnscreen(text, markText, facts)) {
        violations.push({
          file: rel,
          line: a + 1,
          endLine: b + 1,
          code: v.code,
          detail: v.detail,
          key: unitKey(rel, text),
          sample: (rawLines[i] ?? "").trim().slice(0, 120),
        });
      }
    }
  }
  return { violations, files, literalHits, commentHits, missing: false };
}

/**
 * ── ⑨⑩ · **门扫自己**（WO-STALE-REGEX-BLIND 补）──────────────────────────────────
 *
 * 单元切分与记号作用域**完全复用** `unitRange` / `markScopeRange` / `blockCommentRanges`
 * （另写一套切分器 = 两套判据两个结论，迟早对不上）。唯一不同的是：本层扫的是**注释原文**，
 * 不剥注释 —— 门的自述本来就写在注释里，剥掉就什么都不剩了。
 *
 * `missing: true` 走 RC=2 而不是 RC=1：读不到自己的源码 = 门坏了，不是仓库有问题。
 */
function scanSelf(root, live) {
  const violations = [];
  const p = join(root, SELF_SCAN_FILE);
  if (!existsSync(p)) return { violations, marks: 0, missing: true };
  const raw = readFileSync(p, "utf8");
  // **只看注释那半边**（语法上下文排除，不是文件白名单）：代码里的正则/错误文案/金丝雀样例
  // 是本机制的**实现**，不是门的自述。行号在两个视图里逐字节一致，故 file:line 仍指向原文。
  const rawLines = raw.split("\n");
  const lines = stripCodeKeepComments(raw).split("\n");
  const owner = blockCommentRanges(lines);
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!SELF_STATE_CLAIM.test(lines[i]) && !/@stale-self/.test(lines[i])) continue;
    const [a, b] = unitRange(lines, i, owner);
    const rk = `${a}:${b}`;
    if (seen.has(rk)) continue;
    seen.add(rk);
    const text = lines.slice(a, b + 1).join("\n");
    const [ma, mb] = markScopeRange(lines, a, b);
    const markText = lines.slice(ma, mb + 1).join("\n");
    for (const v of judgeSelfUnit(text, markText, live)) {
      violations.push({
        file: SELF_SCAN_FILE,
        line: a + 1,
        endLine: b + 1,
        code: v.code,
        detail: v.detail,
        key: unitKey(SELF_SCAN_FILE, text),
        sample: (rawLines[i] ?? "").trim().slice(0, 120), // 打印**原文**那一行，人才认得出改哪儿
      });
    }
  }
  // 赌注计数同样只数注释里的（代码里那些是实现，数进来就成了「自己给自己发的通行证」）
  return { violations, marks: extractSelfMarks(lines.join("\n")).marks.length, coverage: commentViewCoverage(rawLines, lines), missing: false };
}

/**
 * **注释视图覆盖率** —— 「状态机把后半个文件吞了」这一族的唯一自证（2026-08-16 建）。
 *
 * 判据：原文里**长得像注释**的行（`//` / ` * ` / `/*` 开头）里，注释视图真正留下内容的占比。
 * 状态机若在某个正则字面量里进了串态出不来，从那一行起注释视图全空 ⇒ 占比断崖式下跌。
 * 这个数**不度量代码质量**，只度量「我这次到底看没看见东西」——
 * 跌破下限时必须报「工具坏了」（RC=2），**不许**报「门的自述没问题」。
 *
 * 为什么不用「有没有抽到赌注」当判据：本次实测证明它不管用 ——
 * 被吞的是文件后半段，而赌注恰好有两条在前半段，抽得到，于是下限一声不吭。
 * 判据必须落在**被吞的那一段**上，不是落在「我手里有没有东西」上。
 */
function commentViewCoverage(rawLines, commentLines) {
  const looksComment = (s) => /^\s*(\/\/|\*\s|\*$|\/\*)/.test(s);
  let want = 0;
  let got = 0;
  for (let i = 0; i < rawLines.length; i++) {
    if (!looksComment(rawLines[i])) continue;
    want += 1;
    if ((commentLines[i] ?? "").trim().length > 0) got += 1;
  }
  return { want, got, ratio: want === 0 ? 0 : got / want };
}

/**
 * ── ⑥b · **记号扫全仓**（2026-08-15 WO-STALE-TEXT-SWEEP 补）──────────────────────
 *
 * **修的是什么**：`scanOnscreen` 只走 `SCAN_ROOT`（`apps/frontend-shell/src`），而且只在
 * **命中枚举/否定断言的那个单元**上下文里跑记号。于是有两类记号**写了等于没写**：
 *   ① 写在别的包里的（`apps/agentcore/src/**` / `apps/datacore/src/**` / `packages/**`）——
 *      扫描根压根不到那儿；
 *   ② 写在 `SCAN_ROOT` 里、但**所在单元没有枚举/否定断言**的（例如挂在一段纯注释的机制说明上）——
 *      没有单元命中，就没有人去跑它。
 * 两类的后果与本门早就在治的 `malformed` 一模一样：**作者以为自己挂了赌注，其实门一条都没跑。**
 * 形态（铁律 0.6 句式）：「我用『我写下了记号』当作『这条赌注会被执行』的证据，而前者并不度量后者。」
 *
 * **判据**：`@stale-fact` 是**可执行断言**，不是注解 —— 写在仓里哪儿都得被执行。故本函数在
 * 全部 `apps/<pkg>/src` + `packages/<pkg>/src` 下逐文件抽记号并跑，执行器仍是
 * `runStaleFactMark`（**单一出处**，与 `judgeOnscreen`、`runBaselineFactChecks` 同一个）。
 *
 * **与 `scanOnscreen` 的重叠怎么处理**：不靠"划分地盘"（划错了就有洞），靠**结果去重** ——
 * 同一条记号失守时两路会给出**逐字节相同的 `detail`**（都出自 `runStaleFactMark` 的 reason），
 * 主流程按 `file|detail` 去重即可。宁可两路都扫到，也不留"谁都不管"的缝。
 */
function scanStaleFactMarks(root, facts) {
  const violations = [];
  let files = 0;
  let markCount = 0;
  for (const r of srcRoots(root)) {
    for (const f of walk(r)) {
      files += 1;
      const rel = relative(root, f);
      const { marks, malformed, malformedLines } = extractMarksWithLines(readFileSync(f, "utf8"));
      markCount += marks.length;
      if (malformed > 0) {
        violations.push({
          file: rel,
          line: malformedLines[0] ?? 1,
          code: "STALE-6",
          detail: `有 ${malformed} 处 \`@stale-fact\` 语法不完整 —— 作者以为自己挂了赌注，其实门一条都没跑。语法：@stale-fact <路径> /<正则>/ <op><n>`,
          sample: "",
        });
      }
      for (const m of marks) {
        const res = runStaleFactMark(m, facts.readSource);
        if (res.ok) continue;
        violations.push({
          file: rel,
          line: m.line,
          code: "STALE-6",
          detail: res.reason,
          sample: `@stale-fact ${m.file} /${m.pattern}/ ${m.op}${m.n}`,
        });
      }
    }
  }
  return { violations, files, markCount };
}

// ── ⑦⑧ 全仓真相源扫描（跨包 —— 「一个概念两份真相源」按定义就不在单包里）──────

function srcRoots(root) {
  const roots = [];
  for (const group of ["apps", "packages"]) {
    const g = join(root, group);
    if (!existsSync(g)) continue;
    for (const pkg of readdirSync(g)) {
      const s = join(g, pkg, "src");
      if (existsSync(s) && statSync(s).isDirectory()) roots.push(s);
    }
  }
  return roots;
}

/**
 * 抽三样东西：改名声明 · 活字面量行 · 视图标题真相源。
 * 三样都从**同一次遍历**里出，且都带真行号（靠行数守恒的剥注释器）。
 */
function collectTruthSources(root) {
  const decls = [];
  const literals = [];
  const registry = new Map();
  let files = 0;
  for (const r of srcRoots(root)) {
    for (const f of walk(r)) {
      files += 1;
      const rel = relative(root, f);
      const raw = readFileSync(f, "utf8");
      // 改名声明多写在注释里 ⇒ 从**原文**抽
      for (const m of raw.matchAll(RENAME_DECL)) decls.push({ old: m[1], at: `${rel}:${raw.slice(0, m.index).split("\n").length}` });
      if (/\.(test|spec)\.[jt]sx?$/.test(f)) continue; // 测试不是真相源（它复述真相源）
      const code = stripCommentsKeepLines(raw);
      code.split("\n").forEach((line, i) => {
        if (line.includes('"')) literals.push({ file: rel, line: i + 1, text: line });
      });
      for (const { ns, re } of VIEW_TITLE_SLOTS) {
        for (const m of code.matchAll(re)) {
          const at = `${rel}:${code.slice(0, m.index).split("\n").length}`;
          const k = `${ns}:${m[1]}`;
          if (!registry.has(k)) registry.set(k, []);
          registry.get(k).push({ title: m[2], at });
        }
      }
    }
  }
  return { decls, literals, registry, files };
}

/** 前端 locale 的 `<命名空间>.title` —— 屏上标题的前端那一份真相源。 */
function collectLocaleTitles(root) {
  const p = join(root, "apps/frontend-shell/src/locales/zh.ts");
  if (!existsSync(p)) return null; // 读不到 ⇒ 交给调用方判「工具坏了」，不静默放行
  const lines = readFileSync(p, "utf8").split("\n");
  const rel = relative(root, p);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s{2}([a-zA-Z][A-Za-z0-9]*):\s*\{/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const t = /^\s{4}title:\s*"([^"]+)"/.exec(lines[j]);
      if (t) { out.push({ ns: m[1], title: t[1], at: `${rel}:${j + 1}` }); break; }
      if (/^\s{2}\}/.test(lines[j])) break;
    }
  }
  return out;
}

/** 基线条目上挂的赌注（存量文案这一单不改，但把它赌的计数登记在案）。走的是**同一个执行器**。 */
function runBaselineFactChecks(exemptions, readSource) {
  const out = [];
  for (const e of exemptions ?? []) {
    for (const fc of e.factChecks ?? []) {
      const r = runStaleFactMark(fc, readSource);
      if (r.ok) continue;
      out.push({
        code: "STALE-6",
        file: e.file,
        line: e.line,
        endLine: e.line,
        detail: `【基线登记的赌注失守】${fc.means ?? ""} ${r.reason}`,
        key: `${e.key}#factcheck`,
        sample: e.sample ?? "",
      });
    }
  }
  return out;
}

/**
 * 同一条**记号**可能被两路扫到（`scanOnscreen` 的单元路径 + `scanStaleFactMarks` 的全仓路径），
 * 两路的 `detail` 逐字节同源（都出自 `runStaleFactMark` 的 reason）⇒ 去重。
 * **刻意不按 key 去重**：key 一路是单元 hash、一路是记号行号，本来就不同；按内容才认得出"同一件事"。
 *
 * ⚠ **只对 STALE-6 去重**（第一版栽在这儿，当场被门自己的松弛检测抖出来）：
 *   第一版对所有码按 `file|code|detail` 去重，而 STALE-5 的 `detail` 是**由 enumHit/negHit 两个布尔
 *   拼出来的固定句式** —— 同一个文件里两处不同位置的断言会得到**逐字节相同**的 detail，
 *   于是被当成"同一件事"合并掉：**2026-08-15 实测** 11 条屏上违规被压成 9 条，基线里 3 条豁免当场"松弛"。
 *   形态（铁律 0.6 句式）：**「我用『两条报告的文字一样』当作『它们是同一条违规』的证据，
 *   而前者并不度量后者」** —— 文字一样只说明句式是模板，不说明位置是同一处。
 *   STALE-6 不同：它的 detail 里带着**这条赌注自己的 file/pattern/op/n/现算值**，
 *   文字相同即赌注相同，合并才是对的。
 */
function dedupViolations(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    if (v.code !== "STALE-6") { out.push(v); continue; }
    const k = `${v.file}|${v.detail}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const materializedTypes = loadMaterializedTypes(REPO_ROOT);
  const refCache = new Map();
  /** 读仓内文件：**不存在返回 null**（内容判据），真 IO 异常照抛（走顶层兜底 → RC=2）。 */
  const readSource = (rel) => {
    const p = join(REPO_ROOT, rel);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const facts = {
    materializedTypes,
    readSource,
    refCounter: (sym) => {
      if (!refCache.has(sym)) refCache.set(sym, countSrcReferences(REPO_ROOT, sym, null));
      return refCache.get(sym);
    },
  };

  const selftestOnly = argv.includes("--selftest");
  const res = selftestOnly ? { violations: [], files: 999, keywordHits: 999, missing: false } : scan(REPO_ROOT, facts);
  if (res.missing) {
    // RC=**2**：扫描根不在 = 本门这次什么都没扫，属「工具坏了」。
    // 曾经写的是 exit(1)，与「仓库真有违规」撞同一个码 —— 读的人分不出「代码有问题」
    // 还是「门没跑起来」，而两者的处置**方向相反**（前者去改代码，后者去修门）。
    toolBroken(new Error(`扫描根 ${SCAN_ROOT} 不存在`), "扫描根缺失");
  }

  // ── ⑤⑥⑦⑧ 屏上事实层 ────────────────────────────────────────────────────────
  const onscreen = selftestOnly ? { violations: [], files: 999, literalHits: 99, commentHits: 99, missing: false } : scanOnscreen(REPO_ROOT, facts);
  const truth = selftestOnly ? { decls: [{}], literals: new Array(999), registry: new Map(new Array(40).fill(0).map((_, i) => [`s${i}`, []])), files: 999 } : collectTruthSources(REPO_ROOT);
  const localeTitles = selftestOnly ? [] : collectLocaleTitles(REPO_ROOT);
  if (!selftestOnly && localeTitles === null) {
    toolBroken(new Error("apps/frontend-shell/src/locales/zh.ts 读不到"), "屏上标题的前端真相源缺失");
  }
  // ⑥b 全仓记号扫描（记号写在哪儿都得被执行 —— 否则"挂了赌注"是假的）
  const markSweep = selftestOnly ? { violations: [], files: 999, markCount: 99 } : scanStaleFactMarks(REPO_ROOT, facts);
  const onscreenViolations = selftestOnly
    ? []
    : dedupViolations([
        ...onscreen.violations,
        ...markSweep.violations,
        ...judgeRenameResidue(truth.decls, truth.literals),
        ...judgeViewTitleForks(truth.registry, localeTitles),
      ]).map((v) => ({
        ...v,
        key: v.key ?? unitKey(v.file, `${v.code}|${v.sample}`),
        endLine: v.endLine ?? v.line,
      }));

  // ── ⑨⑩ 门自述层：**门必须先扫自己** ────────────────────────────────────────
  // 基线在这里就得读出来 —— 门自述里赌的口径有一半来自基线（赌注条数 / CONFIRMED-STALE 条数）。
  // 读不出（文件缺失 / JSON 非法）会抛，由顶层 try 归 RC=2：那是「门坏了」，不是「代码坏了」。
  const baseline = JSON.parse(readFileSync(join(REPO_ROOT, BASELINE_PATH), "utf8"));
  /**
   * **现算口径表** —— 每一个数都出自本次运行的真实测量，没有一个是写死的。
   * 门自述里的 `@stale-self` 赌注就赌在这张表上；表里没有的口径名一律判负
   * （赌一个不存在的东西 = 这条赌注从来没被执行过）。
   */
  const live = selftestOnly
    ? { "selftest.stub": 1 }
    : {
        "scan.files": res.files,
        "scan.keywordHits": res.keywordHits,
        "scan.violations": res.violations.length,
        "onscreen.literalHits": onscreen.literalHits,
        "onscreen.commentHits": onscreen.commentHits,
        "onscreen.violations": onscreenViolations.length,
        "marks.production": markSweep.markCount,
        "marks.scannedFiles": markSweep.files,
        "truth.renameDecls": truth.decls.length,
        "truth.viewSlugs": truth.registry.size,
        "truth.literals": truth.literals.length,
        "facts.materializedTypes": materializedTypes?.size ?? 0,
        "baseline.exemptions": baseline.exemptions.length,
        "baseline.onscreenExemptions": (baseline.onscreenExemptions ?? []).length,
        "baseline.factChecks": (baseline.onscreenExemptions ?? []).reduce((n, e) => n + (e.factChecks ?? []).length, 0),
        "baseline.confirmedStale": (baseline.onscreenExemptions ?? []).filter((e) => e.verdict === "CONFIRMED-STALE").length,
        "baseline.unmarked": (baseline.onscreenExemptions ?? []).filter((e) => e.verdict === "UNMARKED").length,
      };
  const self = selftestOnly ? { violations: [], marks: 99, coverage: { want: 1, got: 1, ratio: 1 }, missing: false } : scanSelf(REPO_ROOT, live);
  if (self.missing) toolBroken(new Error(`${SELF_SCAN_FILE} 读不到`), "门读不到自己的源码");

  const blind = selftest(facts, selftestOnly ? null : res);
  // 屏上事实层的**扫描规模**下限：与上面同源 —— 抽到 0 条 ⇒ 报「工具坏了」，不许报「屏上没有过时事实」
  if (!selftestOnly) {
    if (onscreen.files < 50) blind.push(`屏上层只扫到 ${onscreen.files} 个源文件（<50）—— 扫描根 ${SCAN_ROOT} 是不是没读到？`);
    if (onscreen.literalHits < 5) blind.push(`屏上层只抽到 ${onscreen.literalHits} 处字面量断言（<5）—— 剥注释器或断言正则坏了，不是屏上干净了`);
    if (truth.registry.size < 20) blind.push(`视图标题真相源只抽到 ${truth.registry.size} 个 slug（<20）—— ⑧ 这一层等于没开`);
    // ⑥b 扫描规模下限：记号在生产源码里**今天真有实例**（@stale-self marks.production ==11
    //    ⇒ 这个数不再是传说，它由本门每次现算并对账）。抽到 0 条 ⇒ 报「工具坏了」，
    //    **不许**报「全仓记号都通过」—— 那正是本门自己在治的那种「我没找到 ≠ 它不存在」。
    if (markSweep.files < 100) blind.push(`⑥b 记号扫描只走到 ${markSweep.files} 个源文件（<100）—— srcRoots 是不是没读到？`);
    if (markSweep.markCount < 5) blind.push(`⑥b 全仓只抽到 ${markSweep.markCount} 条 @stale-fact 记号（<5）—— 抽取器坏了，不是记号没人写了`);
    if (truth.decls.length < 1) blind.push("全仓一条**改名声明**都没抽到（<1）—— ⑦ 这一层等于没开（今日已知至少 1 条）");
    if (truth.literals.length < 1000) blind.push(`活字面量只抽到 ${truth.literals.length} 行（<1000）—— 剥注释器把字面量也剥了？⑦ 这一层等于没开`);
    // ⑨ 自扫描规模下限：门自述里必须真有赌注在跑。抽到 0 条 ⇒ 报「工具坏了」，
    //    **不许**报「门的自述没问题」—— 那正是本门自己在治的「我没找到 ≠ 它不存在」。
    if (self.marks < 1) blind.push(`⑨ 门自述里一条 @stale-self 赌注都没抽到（${self.marks} < 1）—— 抽取器坏了，或者门的自述又变回了没人下注的散文`);
    // ⑨ **注释视图覆盖率**下限：这一条才真正度量「后半个文件有没有被状态机吞掉」。
    //    上面那条（赌注条数）实测**挡不住**这个坑 —— 被吞的段落里正好没有赌注时它一声不吭。
    if (self.coverage.ratio < 0.9) {
      blind.push(
        `⑨ 注释视图只覆盖到 ${self.coverage.got}/${self.coverage.want} 行（${(self.coverage.ratio * 100).toFixed(1)}% < 90%）—— ` +
          "splitCodeAndComments 多半在某个**正则字面量里的裸引号/裸反引号**上进了串态出不来，从那行起整段被当成代码。" +
          "把该正则里的引号改成 \\x22 / \\x27 / \\x60 转义写法。**这不是「门的自述没问题」，是这次根本没看见后半个文件。**",
      );
    }
  }
  if (blind.length > 0) {
    // RC=**2**，不是 1（本次改正）：金丝雀不中 = **门自己瞎了**，本次什么都没证明。
    // 撞成 1 的后果是读的人分不出「仓库真有问题」（去改代码）与「门没跑起来」（去修门），
    // 而这两条路的方向正好相反 —— 与 `docs/SOP-reviewer-claim-discipline.md` §3 的三分约定一致。
    console.error("⛔ 门自己瞎了（金丝雀未被咬 / 扫描规模异常）—— **不是代码干净**：");
    for (const b of blind) console.error(`   · ${b}`);
    console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」。修门，别改结论。RC=2");
    process.exit(2);
  }
  if (selftestOnly) {
    console.log(
      `✅ 金丝雀：${MUST_BITE.length} 条必咬全部咬中，${MUST_NOT_BITE.length} 条必不咬全部放过，putAll 事实源 ${materializedTypes.size} 个类型；` +
        `屏上层 ${ONSCREEN_MUST_BITE.length} 必咬 + ${ONSCREEN_MUST_NOT_BITE.length} 必不咬全中，⑦⑧ 判据金丝雀四向全过；` +
        "⑨⑩ 门自述层变异反证 4 必咬 + 4 必不咬全中",
    );
    return;
  }

  if (argv.includes("--list")) {
    console.log(JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: res.violations.length, violations: res.violations, onscreenCount: onscreenViolations.length, onscreen: onscreenViolations, selfCount: self.violations.length, self: self.violations, live }, null, 2));
    return;
  }

  // ── 棘轮 ──────────────────────────────────────────────────────────────────
  const allowed = new Map(baseline.exemptions.map((e) => [e.key, e]));
  const fresh = res.violations.filter((v) => !allowed.has(v.key));
  const usedKeys = new Set(res.violations.map((v) => v.key));
  const stale = baseline.exemptions.filter((e) => !usedKeys.has(e.key));

  // 屏上事实层用**独立**棘轮段（合进上面那段就得把 ratchetHigh 调大，
  // 而"评审唯一必须拒绝的一行"就是把它调大 —— 新判据的存量不该去撑破旧判据的水位）。
  const onExempt = baseline.onscreenExemptions ?? [];
  // ⚠ STALE-6 **永不豁免**：它是"现算不符"，不是"检测器粗粒度"。
  //   一条正在对用户说谎的断言，没有任何理由值得买"暂时不红"。
  const onAllowed = new Map(onExempt.filter((e) => e.code !== "STALE-6").map((e) => [`${e.key}|${e.code}`, e]));
  const factCheckViolations = runBaselineFactChecks(onExempt, readSource);
  const onFresh = [...onscreenViolations, ...factCheckViolations].filter((v) => !onAllowed.has(`${v.key}|${v.code}`));
  const onUsed = new Set(onscreenViolations.map((v) => `${v.key}|${v.code}`));
  // **棘轮松弛检测（反向遍历基线）**：`onscreenViolations` 只含有命中的条目 ⇒ 零命中的条目
  // 正向遍历永远发现不了，于是基线**高于**实测就成了一份看不见的**免检名额**。
  // 故必须反着走一遍基线：基线里有、实测里没有 ⇒ 判负，逼着跑 `--update` 把水位收紧。
  const onSlack = onExempt.filter((e) => e.code !== "STALE-6" && !onUsed.has(`${e.key}|${e.code}`));

  if (argv.includes("--update")) {
    const kept = onExempt.filter((e) => onUsed.has(`${e.key}|${e.code}`));
    const addl = onscreenViolations.filter((v) => !onAllowed.has(`${v.key}|${v.code}`));
    const next = [...kept, ...addl.map((v) => ({ key: v.key, code: v.code, file: v.file, line: v.line, verdict: "TODO-VERDICT", why: "", sample: v.sample }))];
    const doc = buildBaselineDoc({
      prev: baseline,
      generatedBy: "node scripts/check-stale-claims.mjs --update",
      prose: { $schema: baseline.$schema, note: baseline.note, onscreenNote: ONSCREEN_BASELINE_NOTE },
      computed: {
        onscreenExemptions: next,
        onscreenMax: next.length,
        onscreenRatchetHigh: Math.min(baseline.onscreenRatchetHigh ?? next.length, Math.max(next.length, kept.length)),
      },
    });
    writeFileSync(join(REPO_ROOT, BASELINE_PATH), `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`✅ 屏上层棘轮已收紧：${onExempt.length} → ${next.length}（新增 ${addl.length} 条待写 verdict/why，删掉 ${onExempt.length - kept.length} 条已消失的）`);
    return;
  }

  console.log(`扫描：${res.files} 个源文件 · ${res.keywordHits} 处关键词命中 · ${res.violations.length} 条声明违规 · 豁免 ${baseline.exemptions.length} 条（上限 ${baseline.maxExemptions}）`);
  console.log(
    `屏上层：${onscreen.literalHits} 处字面量断言（注释里另有 ${onscreen.commentHits} 处·不判） · ${truth.registry.size} 个视图 slug · ${truth.decls.length} 条改名声明 ` +
      `⇒ ${onscreenViolations.length} 条屏上违规 · 豁免 ${onExempt.length} 条（上限 ${baseline.onscreenMax ?? "未设"}）`,
  );
  console.log(`门自述层：${SELF_SCAN_FILE} 里 ${self.marks} 条 @stale-self 赌注对账 ${Object.keys(live).length} 个现算口径 ⇒ ${self.violations.length} 条违规（**永不豁免**）`);

  let bad = false;
  // ── ⑨⑩ 门自述层：**没有棘轮、没有豁免段** ──────────────────────────────────
  // 理由与 STALE-6 同源：一道正在说谎的门，没有任何理由值得买「暂时不红」。
  // 给它开豁免 = 允许门保留一句假话，而本门的全部说服力就建立在「它自己不说假话」上。
  if (self.violations.length > 0) {
    bad = true;
    console.error(`\n❌ 门自述违规 ${self.violations.length} 条（**这道门自己正在说过时的话**）：`);
    for (const v of self.violations) {
      console.error(`   ${v.file}:${v.line}-${v.endLine}  [${v.code}]`);
      console.error(`      ${v.detail}`);
      console.error(`      原文：${v.sample}`);
    }
    console.error("\n   修法：· STALE-9 ⇒ **把自述那句话改对**（现算值已逐条打印在上面），赌注保持挂着；");
    console.error("         · STALE-10 ⇒ 史料补 ISO 日期戳；说此刻的挂 @stale-self <口径名> <op><n>。");
    console.error("         **不许**加豁免段：谁在下判断谁先受审，这一层没有白名单。");
  }
  if (fresh.length > 0) {
    bad = true;
    console.error(`\n❌ 新增「自称实测」声明违规 ${fresh.length} 条：`);
    for (const v of fresh) {
      console.error(`   ${v.file}:${v.line}-${v.endLine}  [${v.code}]`);
      console.error(`      ${v.detail}`);
      console.error(`      原文：${v.sample}`);
    }
    console.error("\n   修法：① 补上实测日期（YYYY-MM-DD）；② 补上复验方式（端点 / 命令 / file:line）；");
    console.error("         ③ 若是 STALE-3/4：上游已经补齐了，**把话改对**，不要加豁免。");
  }
  if (stale.length > 0) {
    bad = true;
    console.error(`\n❌ 棘轮回弹：${stale.length} 条豁免已经匹配不到任何声明（文案改过了？）—— 请从 ${BASELINE_PATH} 删掉，让上限跟着降：`);
    for (const e of stale) console.error(`   ${e.key}  —— ${e.why}`);
  }
  // ── 棘轮三条（都写在 baseline 的 note 里）───────────────────────────────────
  if (baseline.exemptions.length !== baseline.maxExemptions) {
    bad = true;
    console.error(
      `\n❌ 棘轮失守：maxExemptions=${baseline.maxExemptions} 与实际豁免数 ${baseline.exemptions.length} 不等。` +
        `\n   这个数必须**恒等于**豁免条数 —— 加一条豁免就得同时改这个数，让它在 diff 里躲不掉。`,
    );
  }
  if (baseline.exemptions.length > baseline.ratchetHigh) {
    bad = true;
    console.error(
      `\n❌ 棘轮回升：豁免数 ${baseline.exemptions.length} 超过历史最高水位 ratchetHigh=${baseline.ratchetHigh}。` +
        `\n   ratchetHigh **只降不升**。评审唯一必须拒绝的一行，就是把它调大。`,
    );
  }
  const noReason = baseline.exemptions.filter((e) => typeof e.why !== "string" || e.why.trim().length < 10);
  if (noReason.length > 0) {
    bad = true;
    console.error(`\n❌ ${noReason.length} 条豁免没写理由（why < 10 字）—— 无理由白名单本身就是本门要治的病。`);
    for (const e of noReason) console.error(`   ${e.key}`);
  }

  // ── 屏上事实层的棘轮（独立一套，判据同源）──────────────────────────────────
  if (onFresh.length > 0) {
    bad = true;
    console.error(`\n❌ 新增「屏上过时事实」违规 ${onFresh.length} 条：`);
    for (const v of onFresh) {
      console.error(`   ${v.file}:${v.line}${v.endLine !== v.line ? `-${v.endLine}` : ""}  [${v.code}]`);
      console.error(`      ${v.detail}`);
      if (v.sample) console.error(`      原文：${v.sample}`);
    }
    console.error("\n   修法：· STALE-5 ⇒ 挂 `@stale-fact <路径> /<正则>/ <op><n>`，把这句话赌的计数写下来；");
    console.error("         · STALE-6 ⇒ **上游已经变了，把屏上那句话改对**（这一条永不豁免）；");
    console.error("         · STALE-7/8 ⇒ 把旧名/分叉的那一份真相源改到位（一个概念只许有一份真相源）。");
  }
  if (onSlack.length > 0) {
    bad = true;
    console.error(
      `\n❌ 屏上层棘轮**松弛**：${onSlack.length} 条豁免今天一条都没命中 —— 基线高于实测 = 一份看不见的**免检名额**。` +
        `\n   （正向遍历永远发现不了这个洞：没命中的条目根本不出现在结果里，故本门反着遍历基线。）` +
        `\n   请跑：node scripts/check-stale-claims.mjs --update`,
    );
    for (const e of onSlack) console.error(`   ${e.key}|${e.code}  —— ${e.why ?? "(无 why)"}`);
  }
  if (onExempt.length !== (baseline.onscreenMax ?? -1)) {
    bad = true;
    console.error(`\n❌ 屏上层棘轮失守：onscreenMax=${baseline.onscreenMax ?? "未设"} 与实际豁免数 ${onExempt.length} 不等 —— 这个数必须恒等于条数，让加豁免在 diff 里躲不掉。`);
  }
  if (onExempt.length > (baseline.onscreenRatchetHigh ?? -1)) {
    bad = true;
    console.error(`\n❌ 屏上层棘轮回升：豁免数 ${onExempt.length} > onscreenRatchetHigh=${baseline.onscreenRatchetHigh ?? "未设"}。只降不升。`);
  }
  const onBadMeta = onExempt.filter(
    (e) => typeof e.why !== "string" || e.why.trim().length < 10 || !ONSCREEN_VERDICTS.includes(e.verdict),
  );
  if (onBadMeta.length > 0) {
    bad = true;
    console.error(`\n❌ 屏上层 ${onBadMeta.length} 条豁免缺 why(≥10 字) 或 verdict(${ONSCREEN_VERDICTS.join(" / ")})。`);
    console.error("   **verdict 是本段的要害**：三者的处置完全不同 ——");
    console.error("   FALSE-POSITIVE 去修检测器 · UNMARKED 去补 @stale-fact 记号 · CONFIRMED-STALE 去改屏上那句话。");
    console.error("   混成一类，最后一类就永远没人回来改了（豁免只买『暂时不红』，不买『没人知道』）。");
    for (const e of onBadMeta) console.error(`   ${e.key}|${e.code}  verdict=${e.verdict ?? "缺"}`);
  }

  // ── 待修点名：CONFIRMED-STALE 每次都打印（RC 不变，但**机器先说话**）──────────
  const confirmed = onExempt.filter((e) => e.verdict === "CONFIRMED-STALE");
  const unmarked = onExempt.filter((e) => e.verdict === "UNMARKED");
  if (confirmed.length > 0) {
    console.log(`\n⚠ **屏上仍在说谎的 ${confirmed.length} 条（已复核确认过时，修文案归后续单）** —— 豁免只买"暂时不红"，不买"没人知道"：`);
    for (const e of confirmed) console.log(`   ${e.file}:${e.line} [${e.code}] ${e.why.slice(0, 160)}`);
  }
  if (unmarked.length > 0) {
    console.log(`\n· 另有 ${unmarked.length} 条 UNMARKED（是真断言、今天没被证伪，但还没挂 @stale-fact 记号 ⇒ 没有保质期）。`);
  }

  if (bad) {
    // 三层分开报账：哪一层红，处置完全不同（注释层去补日期，屏上层去改文案 / 收敛真相源，
    // 门自述层去改门自己那句话）。合成一句「未通过」会让人去改错的地方 —— 这正是本门自己在治的那种病。
    const legacyBad = fresh.length > 0 || stale.length > 0;
    const onscreenBad = onFresh.length > 0 || onSlack.length > 0;
    console.error(
      `\n❌ stale-claims:check 未通过 —— 注释层(STALE-1..4)：${legacyBad ? `红（新增 ${fresh.length} · 回弹 ${stale.length}）` : "绿"}` +
        ` · 屏上层(STALE-5..8)：${onscreenBad ? `红（新增 ${onFresh.length} · 松弛 ${onSlack.length}）` : "绿"}` +
        ` · 门自述层(STALE-9/10)：${self.violations.length > 0 ? `红（${self.violations.length} 条）` : "绿"}`,
    );
    process.exit(1);
  }
  console.log(
    `✅ stale-claims:check 通过（金丝雀 ${MUST_BITE.length}+${MUST_NOT_BITE.length} 条全中 · 无新增声明违规 · 豁免棘轮 ${baseline.exemptions.length}/${baseline.maxExemptions}` +
      ` · 屏上层棘轮 ${onExempt.length}/${baseline.onscreenMax ?? "?"}，其中 ${confirmed.length} 条已确认过时待修` +
      ` · 门自述 ${self.marks} 条赌注全部现算相符）`,
  );
}

/**
 * 顶层兜底 —— **必须是 Program 的直接子语句**。
 * ⚠ 写成 `if (isMain) { try {…} }` 会被 `scripts/check-gate-exit-discipline.mjs` 判「无顶层兜底」
 *   （它只认 Program 直接子语句这一形态），即使那样写也真的能退 2。判据在**语法位置**，不在行为。
 */
const isMain = Boolean(process.argv[1] && process.argv[1].endsWith("check-stale-claims.mjs"));
try {
  if (isMain) main();
} catch (e) {
  toolBroken(e);
}

/**
 * ── 《本门做不到的部分》（诚实边界，不圆场）──────────────────────────────────
 * 1. **只认四个触发词**。一句「我查过了，Cadence 一条都没有」不含「实测/实跑/运行态/现算」，
 *    本门一个字都看不见。治的是「自称实测」这一族，不是全部过期声明。
 * 2. **只扫 `apps/frontend-shell/src`**。同族病灶在 `docs/` 与后端注释里同样存在
 *    （`docs/AUDIT-zombie-and-orphan-code.md` 另记 3 条），本门不碰。
 * 3. **日期只验"有没有"，不验"对不对"**。写 `2026-08-08` 而实际是三个月前测的，本门看不出来；
 *    它逼出的是**保质期**，不是真实性。真实性靠 STALE-3/4 那一层的事实读回，而那一层
 *    只覆盖两类可机器复验的事实（对象类型承载 / 符号消费方）。
 * 4. **STALE-4 的引用计数是"文件级 + 剥注释"的近似**：同名子串会误计（如 `Base` 之于 `BaseX`），
 *    故 `DEAD_SYMBOL_ASSERTIONS` 只抓 ≥4 字符的标识符；间接调用（字符串键分发 / 依赖注入 /
 *    事件订阅）本门同样看不见 —— 它只能证伪「零消费方」，不能证实「真的零消费方」。
 * 5. **声明单元靠续行符切分**，是启发式：单元切大了会把邻居的日期算成自己的（漏报），
 *    切小了会把同一条声明劈成两半（误报）。故金丝雀里必咬样例是**整段原文**喂进来的，
 *    保证判据本身对；切分错只影响个别条目，不影响判据。
 *
 * ── 屏上事实层（STALE-5..8）**做不到的部分** ────────────────────────────────
 * 6. **`@stale-fact` 记号两条路径的现状（照 CLAUDE.md 铁律 0.5 判据 #1 的三分法说清楚）**。
 *    ⚠ **本条 2026-08-16 被本门自己的 ⑨ 层抓成过时，逐条改正 —— 原文两句话都是假的**：
 *      · 原文写「写在源码里的 `@stale-fact` 记号今天全仓 0 条 …… 还没有生产实例，不许读作『已经在用』」。
 *        **实为 11 条**，分布在 3 个文件（`agentcore/agent/navigation-slice.ts` ×3 ·
 *        `frontend-shell/locales/zh.ts` ×2 · `frontend-shell/views/sim/sandboxConsoleModel.ts` ×6）。
 *        WO-STALE-TEXT-SWEEP 当天就补上了生产实例，而这句自述留在原地 ——
 *        **它把「已经在用」写成了「还没在用」，方向正好相反**。
 *        赌注：@stale-self marks.production ==11
 *      · 原文写「`runBaselineFactChecks` 那条今天有 6 条真数据，挂在两条 CONFIRMED-STALE 上」。
 *        **实为 0 条赌注、0 条 CONFIRMED-STALE**（存量已被后续单改完，基线只剩
 *        7 条 UNMARKED + 4 条 FALSE-POSITIVE）。
 *        赌注：@stale-self baseline.factChecks ==0
 *        赌注：@stale-self baseline.confirmedStale ==0
 *    ⇒ 今天的真实分工是：**记号路径已在生产**（11 条）、**基线赌注路径今天没有数据**
 *      （属「接了线没数据」，不是「没接线」——`runBaselineFactChecks` 仍被主流程无条件调用）。
 *    ⇒ 复验命令：`node scripts/check-stale-claims.mjs`（末行直接打印这三个现算值）。
 * 7. **⑤ 只咬四种句式**（「只有…N 类」「共 N 种」「恰好 N 个」「一条都没有 / 没有任何一条 / 全仓 0 条」）。
 *    一句「locus 就那么几类」「基本没有」本门一个字都看不见 —— 它治的是**把数量词写死**这一族，
 *    不是全部过期文案。**2026-08-16 实测**这四种句式在 `apps/frontend-shell/src` 的**字面量**里
 *    命中 13 处、在**注释**里命中 63 处（原文写的是 14 / 147，两个数都已过期；量级差这个论点仍成立，
 *    且已由 ⑤ 那一节的两条 `@stale-self` 赌注机器守住）——「注释侧远多于字面量侧」正是
 *    "只扫屏上"这个取舍的理由。
 * 8. **⑤ 只判"有没有挂记号"，不判"记号挂得对不对"**。作者可以挂一条恒真的记号
 *    （`/./ >=0`）来蒙混过关。本门看不出来 —— 它逼出的是**赌注**，赌得认不认真归复审。
 *    （同 ①② 那条「日期只验有没有，不验对不对」的边界，是同一族。）
 * 9. **⑦ 只认被**声明**过的改名**。`前名「X」` 这类声明是仓里唯一能被机器读出的
 *    「A 和 B 是同一个东西」的证据；没写声明就改名的，机器无从知道两个字符串说的是一回事，
 *    本门一个字都不说。全仓只抽到 **1 条**改名声明 —— 覆盖面就这么大，不粉饰。
 *    赌注：@stale-self truth.renameDecls ==1
 * 10. **⑧ 的 locale↔slug 桥只认 camelCase→kebab-case 的精确相等**。`quarter`（真 slug
 *    `quarterly-rolling`）、`geo`（真 slug `geo-map`）、`calib` 这类都对不上 ⇒ **一个字都不说**。
 *    宁可漏，不可诬：猜一个映射然后据此判人，比不判更坏。
 * 11. **⑧ 把 `title` 与 `featureName` 分成两个命名空间**，所以它**看不见**「视图标题与功能名之间
 *    该不该一致」这类跨概念问题 —— 那需要产品口径，不是机器判据。
 * 12. **本门不碰后端注释与 `docs/`**：⑤ 只扫 `apps/frontend-shell/src`（屏上文案的所在地），
 *    ⑦⑧ 扫 `apps/<pkg>/src` + `packages/<pkg>/src`（真相源的所在地），两者都不进 `docs/`。
 *
 * ── 门自述层（STALE-9/10）**做不到的部分** ──────────────────────────────────
 * 13. **⑨⑩ 只扫这一个文件**（`SELF_SCAN_FILE`），不扫 `scripts/` 里另外那些门。
 *    这是**取舍不是遗漏**：全仓门脚本每一个都写满「实测」，一次性全开只能拿基线买绿，
 *    而买绿正是本门要治的病。判据是「谁在下判断谁先受审」—— 先把这道门自己管住，
 *    再一道一道纳入（每纳入一道就得把它的存量自述真改对，不许进基线）。
 * 14. **⑨ 只对账「本门自己现算得出来的口径」**。一句「另有 3 条记在某文档里」这类
 *    指向外部的自述，本层没有口径可赌 ⇒ 只能靠 ⑩ 逼出一个日期戳，验不了真假。
 * 15. **⑩ 靠「有没有 ISO 日期戳」区分史料与现状**，是启发式：
 *    一句带着 2026-08-08 却在说今天的话，本层会当史料放行（同边界 #3）。
 *    它逼出的是**保质期**，真实性仍归 ⑨ 的赌注 —— 想被真守住就别只写日期，写赌注。
 */
