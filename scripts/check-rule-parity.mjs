#!/usr/bin/env node
/**
 * rule-parity:check —— 堵死 `G-RULE-MOCK-EXPR-DRIFT` 回潮（DF.14 · 欠账 #78 的机制面）。
 *
 * 病灶（真实·测试全绿盖住了）：同一条规则在**两处各写一份 expression** ——
 * datacore 场景包种子 `synthetic/battery.ts BATTERY_RULES` 与前端 `mocks/fixtures.ts RULES`。
 * 二者曾系统性不同口径：mock 写人读的**约束式**（`<= 0.5`），后端写引擎吃的**违规谓词**（`> 0.5`）
 * —— 极性相反，照 mock 那套喂引擎则合规订单全报违规；外加主体丢前缀、对象类型被中译
 * （`产线.utilization` 不是任何已注册类型 key ⇒ mock 态哑弹）。
 *
 * 上一轮把**值**手工对齐了，**机制没变**：两处仍各写一份字面量，谁也不校验谁 ⇒ 早晚再漂。
 * 本门要求两端都从契约 `PARITY_RULE_SEEDS` **派生**，而不是各自手抄。
 *
 * 四条断言（任一不满足即红）：
 *   ① 契约单源锚点在（`PARITY_RULE_SEEDS` 可解析且非空）—— 锚点失效即红，**不许门空跑通过**；
 *   ② 每个登记键在**两端**都真物化（少一端 = 登记了却没接线）；
 *   ③ 两端该键所在行必须调用 `parityRuleExpression("<key>")`（口头单源不算，得真派生）；
 *   ④ 裸字面量哨兵：该行不得再出现引号包裹的 expression 字面量（防「留着 import、把值换回手抄」）。
 * 另加⑤：`RULE_PARAM_BINDINGS` 每条必须显式声明 `role` —— 漏声明会让运行期反向闸静默放过
 *   （`missingBoundThresholdRefs` 只咬 `role==="threshold"`，漏写等于默默豁免）。
 *
 * ⚠ 诚实边界：本门是**静态源码扫描**，只管仓库里的声明。运行期规则记录（管理员在界面上编辑的那些）
 *   由发布闸 `assertValidExpression` 的正反两向校验守 —— 两者互补，谁也替不了谁。
 *   C08 **不在本门管辖**：它有更专的单一来源 `OUTSOURCE_REDLINE`（DF.13），由 `outsource-redline:check` 守。
 *
 * 读源码而非 dist：本门守的是"声明与接线一致"，源码即声明。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch {
    console.error(`✗ rule-parity:check 读不到 ${rel}`);
    process.exit(1);
  }
};

const fails = [];

/** 契约单源文件（唯一允许出现这些 expression 字面量的地方 —— 那里的字面量就是定义本身）。 */
const SOURCE_OF_TRUTH = "packages/contracts/src/base-registry.ts";

/**
 * 物化站点：凡在这些文件里**渲染某条已发布规则的 expression**，都必须从契约派生。
 *
 * 为什么不是「两个文件各一处」——本门第一次跑就逮到：`fixtures.ts` 里同一个规则码有**四处**物化
 * （规则库 `RULES` / 本体图谱 `GRAPH[].rules` / 答案证据链 `provenance[].rules` / A2 候选），
 * 上一轮只修了 `RULES` 那一处，另外三处仍带着 `产线.utilization`（中译=哑弹）、
 * `Order.credit <= Customer.creditLimit`（约束式+真后端没有的字段）、`demandDelta <= 0.5`（丢前缀+极性反）。
 * 所以判定按**键 × 出现位置**逐个来，不按文件。
 */
const SITES = [
  ["apps/datacore/src/synthetic/battery.ts", "datacore 场景包种子 BATTERY_RULES"],
  ["apps/frontend-shell/src/mocks/fixtures.ts", "前端 mock：规则库 RULES + 本体图谱 GRAPH + 证据链 provenance"],
  ["apps/frontend-shell/src/mocks/simSolvers.ts", "前端 mock 求解器留痕 evaluatedRules"],
];

/**
 * **不**归本门管的 expression 形态（写清楚，免得下一个人以为漏了）：
 *  · `RULE_CANDIDATES`（A2 抽取候选）与 `RULE_DOC`（制度原文）—— 人读的**约束式**，与引擎口径极性相反
 *    是**对的**，前端 seam 测试专门守它别被"顺手统一"；
 *  · `livedInFixtures.ts` 的**版本史**快照 —— 历史上那一版的阈值就是那个数，是数据，不该随现行值漂；
 *  · `handlers.ts` 里 `load <= capacity` / `weeklySupply.p90 >= weeklyDemand` 这类**伪表达式**：
 *    它们不是任何已发布规则的定义渲染（scope 与 severity 都是另一套 VM 形态），属另一笔欠账，
 *    本门不冒充覆盖它们。
 */

// ── ① 契约锚点：解析 PARITY_RULE_SEEDS 的 key 清单 ───────────────────────────────
const contract = read(SOURCE_OF_TRUTH);
// `(?![A-Za-z0-9_])` 不可省：没有它，`PARITY_RULE_SEEDS` 会**前缀匹配** `PARITY_RULE_SEEDS_RENAMED`，
// 于是"把锚点改名"这条变异照样绿 —— 本门第一次做变异反证时就是这么漏掉的（门自己犯了它要防的病）。
const seedBlock = contract.match(/export const PARITY_RULE_SEEDS(?![A-Za-z0-9_])[\s\S]*?\n\] as const;/);
if (!seedBlock) {
  console.error(`✗ 契约单源锚点失效：${SOURCE_OF_TRUTH} 里找不到 PARITY_RULE_SEEDS —— 门拒绝空跑通过。`);
  process.exit(1);
}
const KEYS = [...seedBlock[0].matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
if (KEYS.length === 0) {
  console.error("✗ PARITY_RULE_SEEDS 为空 —— 门会退化成恒过的空断言，拒绝通过。");
  process.exit(1);
}

// ── ②③④ 逐键 × 逐站点核查 ────────────────────────────────────────────────────
/** 某行是否在"渲染这条规则的 expression"（同一行里既指明规则码又给出表达式）。 */
const materializes = (line, key) => new RegExp(`key:\\s*"${key}"`).test(line) && /expression:/.test(line);

const siteCount = new Map(KEYS.map((k) => [k, 0]));
for (const [rel, label] of SITES) {
  const src = read(rel);
  // 去行注释后判定：注释里提一句 token 不算派生（同 outsource-redline 门的口径）。
  const lines = src.split("\n").map((l) => l.replace(/\/\/.*$/, ""));
  for (const key of KEYS) {
    const hits = lines
      .map((l, i) => [l, i + 1])
      .filter(([l]) => materializes(l, key));
    if (hits.length === 0) continue; // 该站点不物化这条规则 —— 不强求（站点分工不同）
    siteCount.set(key, siteCount.get(key) + hits.length);
    for (const [line, lineNo] of hits) {
      if (!new RegExp(`parityRuleExpression\\(\\s*"${key}"\\s*\\)`).test(line)) {
        fails.push(`${rel}:${lineNo}（${label}）的 ${key} 未经 parityRuleExpression("${key}") 派生 —— 手抄副本回潮`);
      }
      // ④ 裸字面量哨兵：expression: 后面直接跟引号/反引号 = 又写了一份。
      if (/expression:\s*["'`]/.test(line)) {
        fails.push(`${rel}:${lineNo} 的 ${key} 的 expression 是字面量 —— 表达式必须只存契约一处`);
      }
    }
  }
}

// ② 登记表里的每条都必须**真被至少两处**物化，否则它根本不需要单一来源（登记即空转）。
for (const key of KEYS) {
  if (siteCount.get(key) < 2) {
    fails.push(`${key} 只在 ${siteCount.get(key)} 处物化 —— 登记进 PARITY_RULE_SEEDS 却无第二个物化点（登记空转）`);
  }
}

// ── ⑤ 绑定表 role 必须显式声明（漏写 = 静默豁免运行期反向闸）───────────────────
const datacoreContract = read("packages/contracts/src/datacore.ts");
const bindingBlock = datacoreContract.match(/export const RULE_PARAM_BINDINGS(?![A-Za-z0-9_])[\s\S]*?\n\] as const;/);
if (!bindingBlock) {
  fails.push("packages/contracts/src/datacore.ts 里找不到 RULE_PARAM_BINDINGS —— 锚点失效");
} else {
  const rows = bindingBlock[0].split("\n").filter((l) => /\{\s*ruleKey:/.test(l));
  if (rows.length === 0) fails.push("RULE_PARAM_BINDINGS 解析出 0 条 —— 门拒绝空跑通过");
  for (const row of rows) {
    const key = (row.match(/ruleKey:\s*"([^"]+)"/) ?? [])[1];
    const param = (row.match(/param:\s*"([^"]+)"/) ?? [])[1];
    if (!/role:\s*"(threshold|coefficient)"/.test(row)) {
      fails.push(`RULE_PARAM_BINDINGS ${key}.${param} 未声明 role —— 漏写会让运行期反向闸默默豁免它`);
    }
  }
}

if (fails.length > 0) {
  console.error("\n✗ rule-parity:check 未过：");
  for (const f of fails) console.error(`  · ${f}`);
  console.error(
    "\n修法：把该站点的 expression 换成 parityRuleExpression(\"<key>\")（params 用 parityRuleParams），" +
      "值改到 packages/contracts/src/base-registry.ts 的 PARITY_RULE_SEEDS 一处。",
  );
  process.exit(1);
}

console.log(`· rule-parity：${KEYS.length} 条多处物化规则（${KEYS.join("/")}）在 ${SITES.length} 端均经契约派生，无手抄副本。`);
console.log("· rule-parity：RULE_PARAM_BINDINGS 每条均显式声明 role（运行期反向闸有据可依）。");
console.log("✓ rule-parity:check 通过（诚实边界：静态扫描；运行期规则记录由发布闸正反双向校验守）。");
