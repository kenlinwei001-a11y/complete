#!/usr/bin/env node
/**
 * 门 `agent-config-complete:check` · **已注册 Agent 配置完整性 + 两侧键空间对账门**（WO-GATE4 ③）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * 「注册了一个 agent」和「注册了一个**能跑的** agent」是两件事，而**此前没有任何门在分辨**。
 * 一个 `tools: []` / `scopeDeclaration.objectTypes: []` 的 agent 定义**照样通过 schema、照样出现在
 * agent 列表页、照样能被选中**，只是它一件事也做不了 —— 用户看到的是一个能力，拿到的是一个空壳。
 *
 * ══ 两侧是**两套东西**，不是同一批 agent 的两个投影（本门建立时追一层追出来的）═══
 * 平台里有两处「agent 清单」，此前谁也没核对过谁：
 *
 *   | 侧 | 位置 | 形态 | 到屏路径 |
 *   |---|---|---|---|
 *   | **DataCore** | `apps/datacore/src/graphmeta.ts:73 (AGENT_SEEDS)` | 只有 `key/displayName/summary`，**零 tools、零 scope** | `mapping.ts:57` → `buildMappingRows` → `GET /a/v1/ontology/mapping` → 图谱映射表 `kind="agent"` 行；另 `GRAPH_EXTRA_NODES` 同名 4 个节点进本体图谱 |
 *   | **AgentCore** | `apps/agentcore/src/mocks/seed.ts` `seedRegistry().agents` | 真 `AgentDefinition`（tools / scopeDeclaration / ruleBindings / budget / skills / mcpServers） | agent 注册表 → 路径 B 真执行 |
 *
 * `AGENT_SEEDS` 上的注释写着「静态种子清单；**AgentCore 侧注册表为运行态来源**」——
 * 这句话读起来像「同一批 agent 的展示投影」。**实测两侧 key 交集 = ∅**：
 *   DataCore 侧 `learning-agent / risk-agent / report-agent`
 *   AgentCore 侧 `analyst / explore_agent / risk_advisor / capacity_planner / quality_inspector /
 *                supply_chain / finance_analyst / carbon_auditor / external_market / code_assistant / coordinator`
 * ⇒ 映射表上展示的三个 agent **在运行态一个都不存在**，而真正存在的十一个**一个都没展示**。
 * 这不是死代码（那条链是活的，`app.ts:3141` 真下发），是**接了线、有数据、内容是错的**
 * —— 三种"不工作"里最难发现的一种，因为屏上什么都有。
 *
 * ══ 判据 ═══════════════════════════════════════════════════════════════════════
 *   C1（硬·棘轮）  每个已注册 agent 的 `tools` 非空
 *   C2（硬·棘轮）  每个已注册 agent 的 **scopeObjectTypes** 非空
 *                  （AgentCore = `scopeDeclaration.objectTypes`；DataCore 侧压根没有这个字段 ⇒ 违规）
 *   C3（硬·棘轮）  带 `ruleBindings` 字段的，其内容必须非空（`"ALL_APPLICABLE"` 或非空 `ruleKeys` 数组）；
 *                  刻意留空的必须在基线里**具名声明理由**（"显式声明为空的理由"）
 *   C4（硬·棘轮）  **两侧键空间对账**：`AGENT_SEEDS` 的每个 key 必须能解析到一个真 AgentCore agent key
 *   C5（棘轮反向）  基线条目一旦不再违规必须删除（只降不升）
 *
 * ══ 诚实边界（本门**不**保证什么）═══════════════════════════════════════════════
 *  · 只看**出厂种子**两处注册表，看不见运行期由用户经 API 创建/编辑的 agent（那需要跑起来的库）。
 *  · 只证「配置字段非空」，**不证「配置对不对」** —— 一个 `tools` 里全是不存在的工具名、
 *    或 `scopeObjectTypes` 写了本体里没有的类型，本门一样绿。那是另一道门的事。
 *  · C4 只对账 `AGENT_SEEDS`→AgentCore 单向。反向（AgentCore 有而映射表没展示）现算 11 条，
 *    **如实打印但不进红** —— 「展示子集」是可以的产品判断，「展示不存在的东西」不是。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）。
 * 用法：node scripts/check-agent-config-complete.mjs   ·   pnpm agent-config-complete:check
 *      node scripts/check-agent-config-complete.mjs --list     # 两侧逐条判定表
 *      node scripts/check-agent-config-complete.mjs --update   # 棘轮基线只许收缩式回写
 */
/* ── 退出码纪律 · 顶层兜底 ───────────────────────────────────────────────────── */
process.on("uncaughtException", (e) => gateToolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   ")));
process.on("unhandledRejection", (e) => gateToolBroken(`未预期 rejection（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   ")));
function gateToolBroken(what, hint) {
  console.error(`⛔ check-agent-config-complete.mjs：${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「agent 配置都完整 / 代码干净 / 通过」——本门这次没跑完，它什么都没证明。");
  if (hint) console.error("   " + hint);
  process.exit(2);
}

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertDistFresh } from "./dist-freshness.mjs";

const ROOT = process.cwd();
const GRAPHMETA_DIST = "apps/datacore/dist/graphmeta.js";
const ACSEED_DIST = "apps/agentcore/dist/mocks/seed.js";
const BASELINE = join(ROOT, "scripts/agent-config-baseline.json");

/* ═══════════════════════════════════════════════════════════════════════════
 * 判据本体 —— 金丝雀与主扫描**共用这一个函数**，不许各抄一份
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 判一个 agent 记录的配置完整性。两侧共用（DataCore 侧的记录天然缺字段，正好被同一套判据咬）。
 * @returns {{key:string, tools:number, scopeTypes:number|null, ruleBindings:"OK"|"EMPTY"|"ABSENT",
 *            problems:string[]}}
 */
export function judgeAgent(rec) {
  const key = String(rec?.key ?? "(无 key)");
  const tools = Array.isArray(rec?.tools) ? rec.tools.length : 0;
  // scopeObjectTypes 的两种承载形状都认（AgentCore 用 scopeDeclaration.objectTypes；
  // 若哪天有人给 DataCore 侧补了扁平字段，也照样认——判据看的是**能力边界有没有声明**，不是字段名）。
  const scopeArr = Array.isArray(rec?.scopeDeclaration?.objectTypes)
    ? rec.scopeDeclaration.objectTypes
    : Array.isArray(rec?.scopeObjectTypes)
      ? rec.scopeObjectTypes
      : null;
  const scopeTypes = scopeArr === null ? null : scopeArr.length;

  let ruleBindings = "ABSENT";
  if (rec && Object.prototype.hasOwnProperty.call(rec, "ruleBindings") && rec.ruleBindings != null) {
    const rk = rec.ruleBindings.ruleKeys;
    ruleBindings = rk === "ALL_APPLICABLE" || (Array.isArray(rk) && rk.length > 0) ? "OK" : "EMPTY";
  }

  const problems = [];
  if (tools === 0) problems.push("C1_NO_TOOLS");
  if (scopeTypes === null) problems.push("C2_NO_SCOPE_FIELD");
  else if (scopeTypes === 0) problems.push("C2_EMPTY_SCOPE");
  if (ruleBindings === "EMPTY") problems.push("C3_EMPTY_RULE_BINDINGS");
  return { key, tools, scopeTypes, ruleBindings, problems };
}

/** C1/C2/C3 的人读说明（报告与修法提示共用，避免两处各写一套措辞）。 */
export function describeProblem(p) {
  switch (p) {
    case "C1_NO_TOOLS": return "`tools` 为空 —— 这个 agent 一件事也做不了，但它照样出现在列表里、照样能被选中";
    case "C2_NO_SCOPE_FIELD": return "**根本没有** scopeObjectTypes 这个字段 —— 能力边界从未声明，越界拒绝无从谈起";
    case "C2_EMPTY_SCOPE": return "`scopeDeclaration.objectTypes` 是空数组 —— 声明了「我不碰任何业务对象」";
    case "C3_EMPTY_RULE_BINDINGS": return "`ruleBindings.ruleKeys` 是空数组 —— 规则后校验实际上关着";
    case "C4_ORPHAN_KEY": return "该 key 在 AgentCore 注册表里**不存在** —— 屏上展示的是一个运行态并不存在的 agent";
    default: return p;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 现读 dist（守卫必须在 import 之前）
 * ═══════════════════════════════════════════════════════════════════════════ */
assertDistFresh([GRAPHMETA_DIST, ACSEED_DIST], { gate: "agent-config-complete:check" });

let gm, acs;
try {
  gm = await import(`file://${join(ROOT, GRAPHMETA_DIST)}`);
} catch (e) {
  gateToolBroken(`载入 ${GRAPHMETA_DIST} 失败（${e?.message || e}）`, "先跑：pnpm --filter datacore build");
}
try {
  acs = await import(`file://${join(ROOT, ACSEED_DIST)}`);
} catch (e) {
  gateToolBroken(`载入 ${ACSEED_DIST} 失败（${e?.message || e}）`, "先跑：pnpm --filter agentcore build");
}
if (!Array.isArray(gm?.AGENT_SEEDS)) gateToolBroken("datacore `AGENT_SEEDS` 不是数组（构建产物形状变了？）");
if (typeof acs?.seedRegistry !== "function") gateToolBroken("agentcore `seedRegistry` 不是函数（构建产物形状变了？）");

let acAgents;
try {
  acAgents = acs.seedRegistry().agents;
} catch (e) {
  gateToolBroken(`调用 agentcore seedRegistry() 抛异常（${e?.message || e}）`);
}
if (!Array.isArray(acAgents)) gateToolBroken("agentcore seedRegistry().agents 不是数组");

const dcSeeds = gm.AGENT_SEEDS;
const acKeys = new Set(acAgents.map((a) => a?.key));

/* ═══════════════════════════════════════════════════════════════════════════
 * 金丝雀 · **双向**，与主逻辑共用 judgeAgent
 * ═══════════════════════════════════════════════════════════════════════════ */
const CANARIES = [
  {
    name: "必中·配置齐全的 agent 判为无问题（拿 AgentCore 的 analyst 真记录，不是编的）",
    get rec() { return acAgents.find((a) => a.key === "analyst"); },
    ok: (r) => r && r.problems.length === 0 && r.tools > 0 && r.scopeTypes > 0 && r.ruleBindings === "OK",
  },
  {
    name: "必不中·tools 空 ⇒ 必须判 C1_NO_TOOLS",
    rec: { key: "__canary_no_tools__", tools: [], scopeDeclaration: { objectTypes: ["Order"] }, ruleBindings: { ruleKeys: "ALL_APPLICABLE" } },
    ok: (r) => r.problems.includes("C1_NO_TOOLS"),
  },
  {
    name: "必不中·scope 数组空 ⇒ 必须判 C2_EMPTY_SCOPE（而不是 C2_NO_SCOPE_FIELD —— 两者性质不同）",
    rec: { key: "__canary_empty_scope__", tools: [{}], scopeDeclaration: { objectTypes: [] }, ruleBindings: { ruleKeys: "ALL_APPLICABLE" } },
    ok: (r) => r.problems.includes("C2_EMPTY_SCOPE") && !r.problems.includes("C2_NO_SCOPE_FIELD"),
  },
  {
    name: "必不中·压根没有 scope 字段 ⇒ 必须判 C2_NO_SCOPE_FIELD",
    rec: { key: "__canary_no_scope_field__", tools: [{}], ruleBindings: { ruleKeys: "ALL_APPLICABLE" } },
    ok: (r) => r.problems.includes("C2_NO_SCOPE_FIELD"),
  },
  {
    name: "必不中·ruleBindings.ruleKeys 为空数组 ⇒ 必须判 C3_EMPTY_RULE_BINDINGS",
    rec: { key: "__canary_empty_rules__", tools: [{}], scopeDeclaration: { objectTypes: ["Order"] }, ruleBindings: { ruleKeys: [], mode: "POST_CHECK" } },
    ok: (r) => r.problems.includes("C3_EMPTY_RULE_BINDINGS"),
  },
  {
    name: "必中·没有 ruleBindings 字段的记录不该被 C3 咬（判据是「带该字段的一并验」）",
    rec: { key: "__canary_no_rulebindings__", tools: [{}], scopeDeclaration: { objectTypes: ["Order"] } },
    ok: (r) => r.ruleBindings === "ABSENT" && !r.problems.includes("C3_EMPTY_RULE_BINDINGS"),
  },
  {
    name: "必中·ALL_APPLICABLE 算非空（别把哨兵字符串当成空数组）",
    rec: { key: "__canary_all_applicable__", tools: [{}], scopeDeclaration: { objectTypes: ["Order"] }, ruleBindings: { ruleKeys: "ALL_APPLICABLE" } },
    ok: (r) => r.ruleBindings === "OK",
  },
];
{
  const bad = [];
  const MIN_AC = 8, MIN_DC = 1;
  if (acAgents.length < MIN_AC) bad.push(`AgentCore 只读到 ${acAgents.length} 个 agent（下界 ${MIN_AC}）——注册表读取坏了`);
  if (dcSeeds.length < MIN_DC) bad.push(`DataCore AGENT_SEEDS 只读到 ${dcSeeds.length} 条（下界 ${MIN_DC}）——构建产物异常`);
  if (!acKeys.has("analyst")) bad.push("金丝雀：AgentCore 注册表里必须有 analyst（出厂默认 agent）");
  if (acKeys.has("__no_such_agent_G4__")) bad.push("金丝雀（必不中）：AgentCore 注册表里不该有 __no_such_agent_G4__ —— 键集合是个「什么都包含」的假集合");
  for (const c of CANARIES) {
    let r;
    try { r = judgeAgent(c.rec); } catch (e) { bad.push(`${c.name} —— 判据抛异常：${e?.message || e}`); continue; }
    if (!r || !c.ok(r)) bad.push(`${c.name} —— 实得 problems=[${r?.problems?.join(",") ?? "?"}] tools=${r?.tools} scopeTypes=${r?.scopeTypes} ruleBindings=${r?.ruleBindings}`);
  }
  if (bad.length) gateToolBroken("金丝雀不中 ⇒ **门自己瞎了**：\n   · " + bad.join("\n   · "));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 主判据
 * ═══════════════════════════════════════════════════════════════════════════ */
const rows = [];
for (const a of acAgents) rows.push({ side: "agentcore", ...judgeAgent(a), status: a?.status });
for (const s of dcSeeds) {
  const r = { side: "datacore", ...judgeAgent(s) };
  if (!acKeys.has(r.key)) r.problems = [...r.problems, "C4_ORPHAN_KEY"];
  rows.push(r);
}
// C4 反向（如实打印、不进红）：AgentCore 有、映射表没展示的
const dcKeys = new Set(dcSeeds.map((s) => s.key));
const notShown = [...acKeys].filter((k) => !dcKeys.has(k));

const violations = [];
for (const r of rows) for (const p of r.problems) violations.push({ ...r, problem: p, id: `${r.side}:${r.key}|${p}` });

const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  for (const r of rows) {
    console.log(`  ${r.problems.length ? "✗" : "✓"} [${r.side.padEnd(9)}] ${r.key.padEnd(20)} tools=${r.tools} scopeTypes=${r.scopeTypes ?? "(无此字段)"} ruleBindings=${r.ruleBindings}${r.problems.length ? "  → " + r.problems.join(",") : ""}`);
  }
  process.exit(0);
}
if (argv.includes("--update")) {
  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { exempt: {} };
  const exempt = {};
  for (const v of violations) exempt[v.id] = prev.exempt?.[v.id] || { why: "TODO：写清楚为什么这个 agent 今天可以缺这项配置（空 why 会被门判红）" };
  writeFileSync(BASELINE, JSON.stringify({
    note: "agent-config-complete 棘轮基线：存量「agent 配置不完整 / 两侧键对不上」的具名豁免，只许降不许升。每条必须写 why。键 = `<侧>:<agent key>|<判据码>`。",
    generatedBy: "node scripts/check-agent-config-complete.mjs --update",
    exempt,
  }, null, 2) + "\n");
  console.log(`已写基线：豁免 ${Object.keys(exempt).length} 条（${BASELINE}）`);
  process.exit(0);
}

if (!existsSync(BASELINE)) gateToolBroken(`基线文件不存在（${BASELINE}）`, "从 canonical 取回，或先跑 `--update` 生成。");
let baseline;
try { baseline = JSON.parse(readFileSync(BASELINE, "utf8")); } catch (e) { gateToolBroken(`基线不是合法 JSON（${e?.message || e}）`); }
if (!baseline || typeof baseline.exempt !== "object" || baseline.exempt === null) gateToolBroken("基线结构不对（缺 `exempt` 对象）");
const exempt = baseline.exempt;

const fail = [];
const used = new Set();
for (const v of violations) {
  const e = exempt[v.id];
  if (!e) {
    fail.push(
      `${v.problem.slice(0, 2)} ${v.side} 侧 agent \`${v.key}\`：${describeProblem(v.problem)}\n` +
        `      修法：${v.problem === "C4_ORPHAN_KEY"
          ? "要么把该 key 改成一个真存在的 AgentCore agent key，要么把这条从 AGENT_SEEDS 删掉 —— 屏上不许出现运行态没有的 agent。"
          : v.problem === "C3_EMPTY_RULE_BINDINGS"
            ? "要么绑上真规则集（或 ALL_APPLICABLE），要么在基线里**具名写明**为什么这个 agent 刻意不做规则后校验。"
            : "补齐该 agent 的能力配置；确属「展示节点而非可执行 agent」的，别混在同一张注册表里 —— 那正是本门要分辨的两件事。"}`,
    );
  } else {
    used.add(v.id);
    if (!e.why || !String(e.why).trim() || /^TODO/.test(String(e.why))) {
      fail.push(`豁免无理由：${v.id} 在基线里但没写 why —— 豁免必须说清理由，否则等于永久居留权`);
    }
  }
}
// C5 棘轮反向
const liveIds = new Set(violations.map((v) => v.id));
for (const id of Object.keys(exempt)) {
  if (used.has(id)) continue;
  fail.push(
    `C5 棘轮：豁免项 \`${id}\` 已不再是违规${liveIds.has(id) ? "" : "（该 agent 的这项配置已补齐，或该 agent 已不在注册表里）"}` +
      ` —— 请从 scripts/agent-config-baseline.json 删掉该条（只降不升）。`,
  );
}

/* ── 报告 ── */
console.log(`✅ 金丝雀 ${CANARIES.length + 4} 项全中（必中 ${CANARIES.filter((c) => c.name.startsWith("必中")).length + 1} · 必不中 ${CANARIES.filter((c) => c.name.startsWith("必不中")).length + 1} · 规模下界 2；与主逻辑共用 judgeAgent）`);
console.log(
  `· agent-config-complete：AgentCore 注册表 ${acAgents.length} 个 agent · DataCore AGENT_SEEDS ${dcSeeds.length} 条 · ` +
    `两侧 key 交集 ${[...dcKeys].filter((k) => acKeys.has(k)).length} · 违规 ${violations.length} 条（已豁免 ${used.size}）`,
);
for (const v of violations) console.log(`  ✗ [${v.side}] ${v.key} → ${v.problem}${exempt[v.id] ? "【基线豁免】" : ""}`);
console.log(`· ⓘ 反向（不进红）：AgentCore 有而映射表未展示的 agent ${notShown.length} 个 —— ${notShown.join(" / ") || "（无）"}`);
console.log("· ⚠ 诚实边界：只看出厂种子两处注册表；只证「配置字段非空」，不证「配置对不对」（工具名/对象类型是否真实存在不在射程）。");

if (fail.length) {
  console.error(`\n✗ agent-config-complete:check 未通过（${fail.length} 条）：`);
  for (const m of fail) console.error("  - " + m);
  process.exit(1);
}
// ⚠ 通过语必须**带上棘轮实况**：一句「配置都齐全」盖住 11 条挂账的豁免，就是屏上说谎的那种绿。
console.log(
  `\n✓ agent-config-complete:check 通过（无**新增**违规；存量 ${used.size} 条具名挂账在 scripts/agent-config-baseline.json，逐条带 why；豁免名单无冗余）。`,
);
if (used.size > 0) console.log(`  ⚠ 「通过」= 没有变得更糟，**不等于**干净：上面 ${used.size} 条今天仍然是真的。`);
