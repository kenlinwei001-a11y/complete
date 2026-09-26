#!/usr/bin/env node
/**
 * WO-DBUI-FLOW · 主流程顺序门：**数据构建页第一屏第一个可交互控件必须是故事脚本输入**，
 * 且**屏上不许出现 PRD 区号 / 给开发看的话**。
 *
 * ── 为什么要这道门（它拦的是一个真发生过的错）─────────────────────────────────────
 * 改前的 `DataBuilderPage.tsx` 屏顶第一个是「快速合成」的模板下拉（`QuickSynthPanel`），
 * 「输入故事脚本」在下面 —— **用户的第一个动作在第二屏**。同时屏上写着「区2/区4/区5/区6/区7」
 * 与「三页归一（自成长收编）」「厂商中立施工」这类只有写代码的人才懂的词。
 * 这两条人眼都查得出（我这次就是这么查出来的），但**人眼不是机制**
 * （铁律 0.6：同一个错第二次必须建机制，下次要机器先说话）。
 *
 * ── 判据（两条）────────────────────────────────────────────────────────────────
 *  ① **顺序**：`DataBuilderPage` 默认导出组件的 JSX 里，`<DataBuilderFlow` 必须出现在
 *     任何其它面板组件（`QuickSynthPanel` / `WorkflowTimelinePanel` / `GrowthConsolePanel` /
 *     `InPlaceApprovalPanel`）之前。
 *  ② **屏上文案**：所有页面源码文件里，**JSX 文本节点**中不许出现 `区[0-9]` 或开发口径词表。
 *     判据只看**会上屏的文本**——`//` 与 `/* *​/` 注释里保留区号做 PRD 溯源是允许的
 *     （工单原文：「代码注释里保留 PRD 区号做溯源没问题，屏上不许出现」）。
 *
 * ── 金丝雀（铁律 0.6：报否定结论前先自证工具，且金丝雀与主判据**共用同一份实现**）─────
 * 用同一个 `analyze()` 跑两个**已知答案**的合成样例：一个必中（顺序错 + 区号上屏），
 * 一个必不中（顺序对 + 区号只在注释里）。任一金丝雀不符预期 ⇒ 报「工具坏了」并 exit 2，
 * **不许**报「页面都合格」。抄一份正则给金丝雀 = 装饰品（改主正则时金丝雀拿旧的去测、照样绿）。
 *
 * 用法：`node scripts/check-dbui-flow-order.mjs`   RC: 0 通过 · 1 不合格 · 2 工具坏了
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 统一的「门自己坏了」出口 —— RC=2。
 *
 * 为什么必须有它（本仓真发生过的假红/假绿）：`readFileSync` 读不到文件、缺依赖、只读 FS、
 * node 版本差异，这些是**环境**失败，不是「页面真不合格」。原文把读不到文件也算进 `bad++`
 * ⇒ 走 RC=1，与「主流程没排第一」撞同一个码，读的人分不出是仓库违规还是门没跑起来。
 * 判据：**RC=1 只留给主判据明确判负那一条路径**，其余一律 RC=2 并宣告结论作废。
 */
function toolBroken(why, hint) {
  console.error(`🛠️ 门自己坏了：${why}`);
  console.error("   ⇒ **本次结论作废**——既不能读成「页面都合格」，也不能读成「有页不合格」。");
  if (hint) console.error(`   修法：${hint}`);
  process.exit(2);
}

/** 主流程组件必须排在这些面板之前。 */
const MUST_FOLLOW = ["QuickSynthPanel", "WorkflowTimelinePanel", "GrowthConsolePanel", "InPlaceApprovalPanel"];
/** 给开发看的话（屏上出现即不合格）。 */
const DEV_JARGON = ["三页归一", "自成长收编", "厂商中立"];

/**
 * 扫描面现算（WO-GATE-ROSTER-SWEEP-2，2026-08-18）：DataBuilder 流程族 = `pages/admin/` 下
 * `DataBuilder|Promote` 前缀的全部 `.tsx`，**枚举现算，一个文件名都不手抄**。
 * 旧形态写死 3 个文件 —— 族里明天新增 `DataBuilderXxx.tsx` 就永远在名单外、永远漏
 * （断点 G-GATE-ROSTER-HANDCOPIED）。判据：这个集合随仓库演进而变 ⇒ 现算。
 * 顺序判据①仍只咬 `DataBuilderPage.tsx`（isPage 语义不变），文案判据②扫全族。
 */
const SCAN_DIR = "apps/frontend-shell/src/pages/admin";
const FAMILY_RE = /^(DataBuilder|Promote).*\.tsx$/;
/** 族规模下界（金丝雀）——今日恰 3 个；塌到下界以下 ⇒ 枚举器/目录坏了，不是族没了。 */
const MIN_FAMILY = 3;
function listFamily(root) {
  let entries;
  try {
    entries = readdirSync(resolve(root, SCAN_DIR));
  } catch (e) {
    toolBroken(`读不到扫描目录 ${SCAN_DIR}（${e?.message || e}）`, "是不是 cwd 不在仓库根？本门用 process.cwd() 解析相对路径。");
  }
  const out = entries.filter((f) => FAMILY_RE.test(f)).sort().map((f) => `${SCAN_DIR}/${f}`);
  if (out.length < MIN_FAMILY) {
    toolBroken(
      `DataBuilder 流程族只枚举到 ${out.length} 个文件（下界 ${MIN_FAMILY}）——枚举塌陷。`,
      `若族文件真被改名/挪走（不再匹配 ${FAMILY_RE}），同步改本门的 FAMILY_RE 与下界。`,
    );
  }
  return out;
}

/**
 * **唯一实现**：给一份源码文本，剥掉注释后回「主流程挂载位置 / 其它面板位置 / 上屏违禁词」。
 * 主判据与金丝雀都调它 —— 这就是「金丝雀必须与主逻辑共用同一份实现」那条纪律的落点。
 */
export function analyze(src) {
  // 先剥注释：区号留在注释里是允许的，只有会上屏的文本才受判。
  //  · 块注释 /* … *​/（含 JSX 里的 {/* … *​/} 形式，剥完只剩空的 `{}`）
  //  · 行注释 //…（跳过 http:// 这类，故要求 `//` 前不是 `:`）
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const flowAt = code.indexOf("<DataBuilderFlow");
  const panelAt = {};
  for (const p of MUST_FOLLOW) {
    const i = code.indexOf(`<${p}`);
    if (i >= 0) panelAt[p] = i;
  }
  // 顺序违规 = 有面板挂在主流程之前（主流程缺席也算违规，单独报）。
  const orderViolations =
    flowAt < 0
      ? Object.keys(panelAt).length > 0 ? ["<DataBuilderFlow 未挂载"] : []
      : Object.entries(panelAt).filter(([, i]) => i < flowAt).map(([p]) => `${p} 排在主流程之前`);

  // 上屏违禁词：区号 + 开发口径。剥完注释后仍出现即判违规。
  const banned = [];
  for (const m of code.matchAll(/区[0-9]/g)) banned.push(m[0]);
  for (const j of DEV_JARGON) if (code.includes(j)) banned.push(j);

  return { flowAt, panelAt, orderViolations, banned };
}

// ── 金丝雀：两个已知答案的合成样例，跑的是上面同一个 analyze ──────────────────────
const CANARY_BAD = `
export default function P() {
  return (<div><QuickSynthPanel /><DataBuilderFlow />区5 三页归一</div>);
}`;
const CANARY_GOOD = `
export default function P() {
  /* 区5 模块同步矩阵（三页归一）——注释里的区号是 PRD 溯源，允许 */
  return (<div><DataBuilderFlow /><QuickSynthPanel /></div>);
}`;

function runCanaries() {
  const bad = analyze(CANARY_BAD);
  const good = analyze(CANARY_GOOD);
  const ok =
    bad.orderViolations.length === 1 &&
    bad.banned.length === 2 && // 区5 + 三页归一
    good.orderViolations.length === 0 &&
    good.banned.length === 0;
  return { ok, bad, good };
}

function main() {
  const root = process.cwd();
  const c = runCanaries();
  if (!c.ok) {
    console.error("   必中样例:", JSON.stringify(c.bad));
    console.error("   必不中样例:", JSON.stringify(c.good));
    toolBroken(
      "金丝雀不符预期（判据本体失灵）",
      "analyze() 的注释剥离或位置比较被改坏了；先让两条金丝雀复绿再谈仓库合不合格。",
    );
  }
  console.log(
    `金丝雀 2/2 通过：必中样例抓到 ${c.bad.orderViolations.length} 处顺序违规 + ${c.bad.banned.length} 个上屏违禁词；` +
      `必不中样例 0/0（注释里的区号未被误判）。`,
  );

  let bad = 0;
  const files = listFamily(root);
  for (const rel of files) {
    let src;
    try {
      src = readFileSync(resolve(root, rel), "utf8");
    } catch (e) {
      // 读不到 = **环境**失败，不是「页面不合格」。原文在这里 bad++ ⇒ 退 1，
      // 与真违规撞码，把「门没跑起来」读成「仓库真有问题」。
      toolBroken(
        `读不到 ${rel}（${e?.message || e}）`,
        "是不是 cwd 不在仓库根？本门用 process.cwd() 解析相对路径。文件真被删/改名了则须同步改 FAMILY_RE。",
      );
    }
    const r = analyze(src);
    const isPage = rel.endsWith("DataBuilderPage.tsx");
    const problems = [...(isPage ? r.orderViolations : []), ...r.banned.map((w) => `屏上出现「${w}」`)];
    if (problems.length > 0) {
      console.error(`❌ ${rel}：${problems.join(" · ")}`);
      bad++;
    } else {
      console.log(`✅ ${rel}${isPage ? "（主流程排第一）" : ""}`);
    }
  }
  if (bad > 0) {
    console.error(`\n不合格 ${bad} 个文件。主流程必须排第一；区号与开发口径只许留在注释里。`);
    process.exit(1);
  }
  console.log("\n✅ 主流程排第一 · 屏上无区号 · 屏上无开发口径。");
}

// ── 顶层兜底 ──────────────────────────────────────────────────────────────────
// 形态刻意选**顶层 try/catch**，不用 `process.on("uncaughtException")` 全局 handler：
// 本文件 `export function analyze`，将来被测试 import 时，顶层无条件注册全局 handler
// 会装进跑测试的那个进程、把无关异常抢走并 exit(2)，连累整个测试进程
// （同样的取舍记在 scripts/check-edge-active-mounts.mjs 头注里）。
// ⚠️ `try` 必须是 **Program 的直接子语句** —— `check-gate-exit-discipline.mjs` 只认这一形态
// （它的理由是「嵌在函数里的 try 不覆盖全流程」）。初稿写成 `if (isMain) { try {…} }`，
// 语义完全一样、变异反证也确实退 2，但门报「无顶层兜底 · 找到 0 处兜底结构」。
// 处置是**改我的文件去合规**，不是放宽那道门 —— 为了让自己变绿去松判据，就是把门做成装饰品。
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
try {
  if (isMain) main();
} catch (e) {
  // 走到这里 = 未预期异常（缺依赖 / 只读 FS / 权限 / OOM / node 版本差异）。
  // 没有这个兜底，node 默认退 1 —— 恰好撞上「真有页不合格」的码，被读成真违规。
  toolBroken(`未预期异常（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 3).join("\n   "));
}
