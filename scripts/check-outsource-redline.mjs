#!/usr/bin/env node
/**
 * outsource-redline:check —— 堵死 G-C08-REDLINE-DRIFT 回潮（DF.13 · R14 · R-一致）。
 *
 * 病灶（真实·用户可感知·测试全绿盖住了）：**一条业务红线，六个不同的数**。
 *   · `synthetic/battery.ts` 规则库发布 `Order.outsourceRatio > 0.3`（30%）
 *   · `livedin/engine.ts` 发布态却是 `> 0.2`（20%）
 *   · 三个求解器（outsourcing_split cap / countermeasure_combo release / capacity what-if）按 **0.2** 算
 *   · 前端 mock 写成 `Outsource.ratio <= 0.2`（主体和极性都是另一套）
 *   · agentcore mock DataCore `c08Threshold = 0.3`
 *   · 契约知识库答案自称「年初 v1.0 为 ≤25%」（版本史里 v1.0 其实是 30%）
 * 用户在界面上看到「红线 20%」，引擎按 20% 拦，规则库里却写着 30% —— 规则与推演各说各话，
 * 而**四包测试全绿**：每一半各自自洽，没有任何一条测试跨过接缝去对齐这个数。
 *
 * 本门四条断言（任一不满足即红）：
 *   ① 契约单源锚点在（`OUTSOURCE_REDLINE.maxRatio` 可解析）——锚点失效即红，不许门空跑通过；
 *   ② 合成耦合不变量：植入越线样本 > 红线，合规桶上界 < 红线（否则 C08 退化成哑弹或全量误报）；
 *   ③ 每个登记消费端必须**引用契约 token**（口头单源不算，得真 import）；
 *   ④ 裸字面量哨兵：除契约单源文件外，`apps/<pkg>/src` + `packages/contracts/src` 里凡与 C08/外协相关的行，
 *      不得出现红线形状的裸字面量（0.2/0.22/0.25/0.3 或 20%/22%/25%/30%）。
 *
 * 关于测试目录：**有意不扫**。测试必须能自由 republish 别的阈值（如收紧到 0.1）来证明"改红线→判定翻转"，
 * 把测试也一刀切禁字面量会逼出假绿。接缝由 `rules-p3-payload-11solvers.test.ts` 的 C08 翻转用例守。
 *
 * ⚠ **本门盖不住的地方（诚实边界，别以为绿了就万事大吉）**：
 *   本门是**静态源码扫描**，只管"仓库里的字面量"。它**看不见运行时数据库里的规则记录**。
 *   规则 DSL 目前**不支持在 expression 里引用 params**（`> $C08.outsourceRatioMax` 这种写法不存在），
 *   所以一条已发布规则上，`params.outsourceRatioMax` 与 `expression` 字符串里的那个数是**两个可各自编辑的数**。
 *   种子期本门保证二者同源生成（见 `battery.ts` C08 那行：expression 与 params 同取一个常量）；
 *   但**管理员在界面上改了 expression 却没改 params（或反之），本门一无所知**。
 *   这是全仓系统性缺口（C04 的 `'量产'`、C09 的 `lagHours > 2` 同病），登记为 **G-C08-EXPR-PARAM-SPLIT**
 *   （`docs/SYSTEM-ONTOLOGY.md` §8）。修法两条：① 扩 DSL 支持 param 插值；② 发布时按模板从 params 重生成
 *   expression。二者都要改规则引擎/RulesService，非本单范围。
 *
 * 逃生舱：确属另一业务含义的数（库存周转 0.2、观测值、有意不同的待审批候选）在**本行或上一行**写
 * `redline-allow：<理由>`。理由必填是故意的——写不出理由的多半就是漂移。
 *
 * 读源码而非 dist：本门守的是"声明与接线一致"，源码即声明。
 * 相关门：`boundary-singlesource:check`（册级 token 存在性）· 本门补的是它做不到的**裸字面量扫描**。
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
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-outsource-redline.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const fails = [];

/** 契约单源文件（唯一允许出现红线裸字面量的地方 —— 那里的字面量就是定义本身）。 */
const SOURCE_OF_TRUTH = "packages/contracts/src/base-registry.ts";

/**
 * 登记消费端：必须引用契约 token（断言③）。
 * 新增 C08 消费方 → 加到这里；漏登记的那个就是下次不一致的种子。
 */
const CONSUMERS = [
  ["apps/datacore/src/synthetic/battery.ts", "规则库 C08 表达式 + what-if outsourceMax + 合成越线样本", /expression:\s*outsourceRedlineViolationExpr\(/],
  ["apps/datacore/src/livedin/engine.ts", "lived-in 红线版本演进 + 版本史", /OUTSOURCE_REDLINE_HISTORY/],
  ["apps/datacore/src/solvers/extended.ts", "outsourcing_split 外协渠道上限 / countermeasure_combo 释放量", /outsourceRedlineCap\(/],
  ["apps/datacore/src/solvers/capacity.ts", "what-if 触红线拒绝判定 + 用户可见拒绝文案", /outsourceRedlineRejectReason\(/],
  ["apps/agentcore/src/mocks/clients.ts", "mock DataCore 的 C08 阈值（须与真 A 同源）", /c08Threshold[^=\n]*=\s*OUTSOURCE_REDLINE\.maxRatio/],
  ["apps/frontend-shell/src/mocks/simSolvers.ts", "前端 mock 求解器上限 + 拒绝文案 + 叙事文案", /outsourceMax:\s*OUTSOURCE_REDLINE\.maxRatio/],
  ["apps/frontend-shell/src/mocks/livedInFixtures.ts", "红线版本史 mock（曾是 datacore 那份的手抄副本）", /OUTSOURCE_REDLINE_HISTORY\.map\(/],
  ["apps/frontend-shell/src/mocks/fixtures.ts", "已发布规则 mock + A2 抽取候选 + 制度原文", /outsourceRedlineConstraintExpr\(/],
  ["apps/frontend-shell/src/mocks/handlers.ts", "live-scenarios 触红线 ruleFlag（前端半）", /OUTSOURCE_REDLINE\.maxRatio/],
  ["apps/datacore/src/app.ts", "live-scenarios 触红线 ruleFlag（后端半 · 与前端 handlers 对称）", /OUTSOURCE_REDLINE\.maxRatio/],
  ["apps/agentcore/src/mocks/seed.ts", "场景入口建议问句「是否超过 C08 红线 N%」", /outsourceRedlinePct\(\)/],
  ["apps/frontend-shell/src/mocks/planFixtures.ts", "季度滚动事件文案「外协过渡（≤N%）」", /outsourceRedlinePct\(\)/],
  ["apps/frontend-shell/src/locales/zh.ts", "i18n 用户可见文案「已达 C08 红线 N%」", /outsourceRedlinePct\(\)/],
  ["apps/frontend-shell/src/views/sim/DynamicLeverPanel.tsx", "外协杠杆上限兜底", /OUTSOURCE_REDLINE\.maxRatio/],
];

/** 契约 token：出现任一即视为"从单源派生"。 */
const CONTRACT_TOKENS = /OUTSOURCE_REDLINE|OUTSOURCE_SAMPLE|outsourceRedline(Pct|ViolationExpr|ConstraintExpr|Cap|RejectReason)/;

/**
 * 去注释再判定（变异反证逼出来的补强）：否则**注释里提一句 `OUTSOURCE_REDLINE` 就能骗过断言③** ——
 * 消费端把值换成别的常数、只留一句"本值来自 OUTSOURCE_REDLINE"的注释，门照样绿。口头单源不算单源。
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

/** 扫描根（生产/ mock 源码；test 目录有意排除，见文件头说明）。 */
const SCAN_ROOTS = [
  "apps/datacore/src",
  "apps/agentcore/src",
  "apps/frontend-shell/src",
  "packages/contracts/src",
];

/** 与 C08/外协相关的行才判定（避免把无关的 0.2 全网误伤）。 */
const RELEVANT_LINE = /C08|外协|outsource/i;
/** 红线形状的裸字面量：0.2 / 0.20 / 0.22 / 0.25 / 0.3 / 0.30，或 20% / 22% / 25% / 30%。 */
const BARE_DECIMAL = /(?<![\d.])0\.(?:30?|25|22|20?)(?![\d])/;
const BARE_PERCENT = /(?<![\d.])(?:30|25|22|20)\s*%/;
const ALLOW_MARK = /redline-allow|debattery-allow/;

// ── 断言① 契约单源锚点 ───────────────────────────────────────────────────────
let currentRatio = null;
let sotSrc = "";
try {
  sotSrc = read(SOURCE_OF_TRUTH);
} catch {
  fails.push(`断言① 读不到契约单源 ${SOURCE_OF_TRUTH} —— 单源没了，本门无从判定。`);
}
if (sotSrc) {
  const block = sotSrc.slice(sotSrc.indexOf("export const OUTSOURCE_REDLINE"));
  const m = /maxRatio:\s*([0-9.]+)/.exec(block);
  if (!/export const OUTSOURCE_REDLINE\b/.test(sotSrc)) {
    fails.push(
      `断言① ${SOURCE_OF_TRUTH} 里找不到 \`export const OUTSOURCE_REDLINE\` —— 锚点失效（改名/搬家须同步本门），` +
        `否则本门会静默空跑，等于没有门。`,
    );
  } else if (!m) {
    fails.push(`断言① OUTSOURCE_REDLINE 里解析不到 \`maxRatio: <数字>\` —— 锚点失效，勿让本门空跑通过。`);
  } else {
    currentRatio = Number(m[1]);
  }
  if (!/export const OUTSOURCE_REDLINE_HISTORY\b/.test(sotSrc)) {
    fails.push(`断言① 缺 \`OUTSOURCE_REDLINE_HISTORY\` —— 版本史必须也在册，否则退役值会被手抄回各处。`);
  }
}

// ── 断言② 合成耦合不变量（防 C08 变哑弹）────────────────────────────────────
if (currentRatio !== null && sotSrc) {
  const sample = sotSrc.slice(sotSrc.indexOf("export const OUTSOURCE_SAMPLE"));
  const v = /violationRatio:\s*([0-9.]+)/.exec(sample);
  const b = /normalBucketMod:\s*([0-9]+)/.exec(sample);
  if (!v || !b) {
    fails.push(
      `断言② 解析不到 OUTSOURCE_SAMPLE.{violationRatio,normalBucketMod} —— 合成数据与红线的耦合失去看护，` +
        `红线一动 C08 可能悄悄变哑弹（历史病灶：已发布规则在真实数据上 violations=0）。`,
    );
  } else {
    const violation = Number(v[1]);
    const bucketMax = (Number(b[1]) - 1) / 100;
    if (!(violation > currentRatio)) {
      fails.push(
        `断言② 植入越线样本 ${violation} **不大于**红线 ${currentRatio} —— C08 在真实合成数据上将永不触发（哑弹规则）。` +
          `修：调高 OUTSOURCE_SAMPLE.violationRatio 使其严格大于红线。`,
      );
    }
    if (!(bucketMax < currentRatio)) {
      fails.push(
        `断言② 合规桶上界 ${bucketMax}（normalBucketMod=${b[1]}）**不小于**红线 ${currentRatio} —— 正常订单会被整片误判越线。` +
          `修：调低 OUTSOURCE_SAMPLE.normalBucketMod 使 (mod−1)/100 < 红线。`,
      );
    }
  }
}

// ── 断言③ 消费端必须引用契约 token ─────────────────────────────────────────
for (const [file, role, derivePattern] of CONSUMERS) {
  let src;
  try {
    src = read(file);
  } catch {
    fails.push(`断言③ 读不到登记消费端 ${file}（${role}）—— 文件搬家须同步本门 CONSUMERS。`);
    continue;
  }
  const code = stripComments(src); // 注释不算数据（见 stripComments 说明）
  if (!CONTRACT_TOKENS.test(code)) {
    fails.push(
      `断言③ ${file}（${role}）的**代码里**未引用契约单源 token（注释里提到不算）—— ` +
        `该消费端的红线值不再与 @platform/contracts 同步。` +
        `修：\`import { OUTSOURCE_REDLINE } from "@platform/contracts"\` 并改用 ` +
        `OUTSOURCE_REDLINE.maxRatio / outsourceRedlineCap() / outsourceRedlineViolationExpr() / outsourceRedlinePct()。`,
    );
  } else if (derivePattern && !derivePattern.test(code)) {
    // 接缝锚：光"文件里某处引用了契约"不够——**那个具体的绑定点**必须是派生的，
    // 否则改掉绑定点、留着别处的引用，门照样绿（变异反证 MUT3 逼出来的这条）。
    fails.push(
      `断言③ ${file}（${role}）引用了契约，但**关键绑定点没派生**：期望匹配 \`${derivePattern.source}\`。` +
        `—— 该处的红线值被换成了别的东西（常见：换成裸常数、换成另一个变量）。` +
        `修：把该绑定点改回从 @platform/contracts 派生；若绑定点确实改名/搬家，同步本门 CONSUMERS 的 derivePattern。`,
    );
  }
}

// ── 断言④ 裸字面量哨兵（本门真正咬人的一条）─────────────────────────────────
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = `${dir}/${e}`;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(rel);
  }
  return out;
}

const scanned = SCAN_ROOTS.flatMap((r) => walk(r));
if (scanned.length === 0) {
  fails.push("断言④ 扫描到 0 个源文件 —— 扫描根失效（目录搬家？），本门等于空跑。");
}
for (const file of scanned) {
  if (relative(".", file) === SOURCE_OF_TRUTH) continue; // 单源处的字面量就是定义本身
  const lines = read(file).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!RELEVANT_LINE.test(line)) continue;
    if (!BARE_DECIMAL.test(line) && !BARE_PERCENT.test(line)) continue;
    if (ALLOW_MARK.test(line) || (i > 0 && ALLOW_MARK.test(lines[i - 1]))) continue;
    const hit = (BARE_DECIMAL.exec(line) ?? BARE_PERCENT.exec(line))[0];
    fails.push(
      `断言④ ${file}:${i + 1} 出现 C08 红线裸字面量 \`${hit}\`：\n` +
        `      ${line.trim().slice(0, 160)}\n` +
        `      修（三选一）：① 数值 → \`OUTSOURCE_REDLINE.maxRatio\` / \`outsourceRedlineCap(total)\`；` +
        `② 表达式 → \`outsourceRedlineViolationExpr()\`（引擎口径 \`>\`）或 \`outsourceRedlineConstraintExpr(subject)\`（文档口径 \`<=\`）；` +
        `③ 文案里的百分数 → \`outsourceRedlinePct()\`。` +
        `确属另一业务含义（周转率/观测值/有意不同的待审批候选）→ 本行或上一行加 \`redline-allow：<理由>\`。`,
    );
  }
}

if (fails.length > 0) {
  console.error(`✗ outsource-redline:check 未通过（${fails.length} 项）：\n`);
  for (const f of fails) console.error(`  ✗ ${f}\n`);
  console.error(
    "外协红线 C08 是一条业务事实，必须只有一个出处：`packages/contracts/src/base-registry.ts` 的 OUTSOURCE_REDLINE。\n" +
      "「20 还是 30」不是重点 —— 一致性才是：屏幕上的数、引擎算的数、规则库写的数必须是同一个数。\n",
  );
  process.exit(1);
}
console.log(
  `· outsource-redline：C08 红线单源 = OUTSOURCE_REDLINE.maxRatio(${currentRatio}) · ` +
    `${CONSUMERS.length} 个消费端全部派生 · ${scanned.length} 个源文件无裸字面量回潮 · 合成耦合不变量成立。`,
);
console.log(
  "⚠ 诚实边界：本门只扫源码。规则 DSL 尚不支持 expression 引用 params → 运行时改了 expression 而没改 " +
    "params（或反之）本门看不见（断点 G-C08-EXPR-PARAM-SPLIT，见 SYSTEM-ONTOLOGY §8）。种子期二者同源生成。",
);
console.log("✓ outsource-redline:check 通过。");
