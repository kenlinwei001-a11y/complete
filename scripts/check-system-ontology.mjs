#!/usr/bin/env node
/**
 * 系统本体漂移门禁（治理）：核对 docs/SYSTEM-ONTOLOGY.md 的机器可派生段是否与代码一致。
 * 当前覆盖最易漂、最关键的两类事实：
 *   1) 数据流事件失效图（§4）—— event-subscriptions.ts 的事件集 必须 = 本体 §4 记录的事件集。
 *   2) 求解器注册表 —— SOLVER_KEYS 必须都在本体 §2/§3 出现（新增求解器忘记登记即红）。
 *   3) 本体引用的源文件锚点必须真实存在（防止链接到已删/改名的文件）。
 * 用法：node scripts/check-system-ontology.mjs   （package.json: "ontology:check"）
 * 退出码非 0 即 CI 失败 —— "改了接线没回写本体" 不再是风险。
 */
import { readFileSync, existsSync } from "node:fs";

const ONTO = "docs/SYSTEM-ONTOLOGY.md";
const EVENTS_SRC = "apps/agentcore/src/event-subscriptions.ts";
const SOLVERS_SRC = "apps/datacore/src/solvers/service.ts";

const fail = [];
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

const onto = read(ONTO);
if (!onto) {
  console.error(`✗ 缺少 ${ONTO} —— 系统本体不存在，无法校核。`);
  process.exit(1);
}

// --- 1) 事件失效图 ---------------------------------------------------------
const evSrc = read(EVENTS_SRC);
if (!evSrc) fail.push(`缺少 ${EVENTS_SRC}（事件单一来源）`);
else {
  const codeEvents = new Set([...evSrc.matchAll(/event:\s*"([a-z0-9_]+\.[a-z0-9_]+)"/g)].map((m) => m[1]));
  // 本体 §4 表里事件以反引号包裹，形如 `raw_dataset.uploaded`
  const docEvents = new Set([...onto.matchAll(/`([a-z0-9_]+\.[a-z0-9_]+)`/g)].map((m) => m[1]));
  const missingInDoc = [...codeEvents].filter((e) => !docEvents.has(e));
  if (missingInDoc.length) fail.push(`事件已在代码、未登记进本体 §4：${missingInDoc.join(", ")}`);
  // 反向：本体记了但代码已删（仅对"看起来像领域事件"的，宽松告警不致命可按需收紧）
  const staleInDoc = [...docEvents].filter((e) => !codeEvents.has(e) && /\.(uploaded|published|completed|updated|executed|applied|promoted|ingested|merged|created|added|regenerated|divergence)$/.test(e));
  if (staleInDoc.length) fail.push(`本体 §4 记了、代码已无此事件（疑似漂移）：${staleInDoc.join(", ")}`);
  console.log(`· 事件：代码 ${codeEvents.size} 个，本体覆盖 ${[...codeEvents].filter((e) => docEvents.has(e)).length} 个`);
}

// --- 2) 求解器注册表 -------------------------------------------------------
const slvSrc = read(SOLVERS_SRC);
if (!slvSrc) fail.push(`缺少 ${SOLVERS_SRC}`);
else {
  // ⚠ 必须锚到 `\n] as const` 收尾，不能用非贪婪 `[\\s\\S]*?\\]`：
  //    数组里的注释含 `x[i,b,t]` 这类方括号，非贪婪会在**注释中间**截断 →
  //    门只看得见 54/57 个键（portfolio / base_capacity_outlook / ontology_query 在视野外），
  //    而它照样打印「代码 54 个，本体覆盖 54 个 ✓ 一致」——两边都是被截断的同一集合，永远"一致"。
  //    这是「门的解析器被数据内容截断，视野残缺却报一致」形态的假绿（WO-SANDBOX-E1 查出）。
  const block = slvSrc.match(/SOLVER_KEYS\s*=\s*\[([\s\S]*?)\n\] as const/);
  const keys = block ? [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [];
  const missing = keys.filter((k) => !onto.includes(k) && !["capacity_rollup"].includes(k));
  if (missing.length) fail.push(`求解器已注册、未在本体出现：${missing.join(", ")}`);
  console.log(`· 求解器：SOLVER_KEYS ${keys.length} 个，本体覆盖 ${keys.filter((k) => onto.includes(k)).length} 个`);
}

// --- 3) 本体引用的源文件锚点存在性（取 `path/file.ts` 形态，去重后抽样校验）---
const refFiles = new Set(
  [...onto.matchAll(/`((?:apps|packages|scripts|deploy)\/[A-Za-z0-9_./-]+\.[a-z]{2,4})(?::\d+)?`/g)].map((m) => m[1]),
);
const brokenRefs = [...refFiles].filter((f) => !existsSync(f));
if (brokenRefs.length) fail.push(`本体引用的源文件不存在（已删/改名）：${brokenRefs.slice(0, 10).join(", ")}${brokenRefs.length > 10 ? " …" : ""}`);
console.log(`· 文件锚点：引用 ${refFiles.size} 个，缺失 ${brokenRefs.length} 个`);

// --- 4) SessionStart 钩子必须从本体动态抽取断点（不许硬编码，防"硬编码即漂移"）---
const HOOK = ".claude/hooks/session-start-ontology.sh";
const hook = read(HOOK);
if (hook) {
  // 硬编码断点行形如 "  G-1 20场景..."（缩进 + G-数字 + 描述）；命令里的 (G-[0-9]+) 正则不算。
  const hardcoded = hook.split("\n").filter((l) => /^\s+G-\d+\s+\S/.test(l));
  if (hardcoded.length) fail.push(`钩子硬编码了断点（应从本体 §8 动态抽取）：${hardcoded.map((l) => l.trim().slice(0, 20)).join(" / ")}`);
  if (!hook.includes(ONTO.split("/").pop())) fail.push(`钩子未引用 ${ONTO}（应动态读取）`);
  console.log(`· 钩子：${hardcoded.length === 0 ? "断点动态抽取（不漂）" : "发现硬编码断点"}`);
}

// --- 5) 断点编号闭合：正文声称「闭了 G-XXX」→ §8 表里必须真有该编号 -----------
//
// 由来（2026-08-06 一天抓到两处，**都是人工对账翻出来的，没有任何门拦得住**）：
//   · `G-PROCUREMENT-OPAQUE`：§2.H 白纸黑字写「闭 §8 G-PROCUREMENT-OPAQUE」，§8 表里 grep 不到。
//   · `G-RISK-NO-DECISION-INFO`：§3 写「闭 G-RISK-NO-DECISION-INFO」，全仓仅此一处命中。
//
// 病的形态：**回写了描述、没回写登记 = 悬空引用**。后果不是笔误级的 ——
//   本体自称「系统接线的单一来源」，照 §8 查断点的人会得出「不存在这道断点」，
//   于是一道**已经被声明关掉**的坑，在唯一的权威清单里查无此项。
//
// 为什么此前没有门：锚点门只验 `file:line` 漂移（第 3 节验文件存在、check-ontology-anchors 验行号），
//   没有任何一条验**编号本身的登记闭合**。两次都靠人肉发现 ⇒ 这不是偶发笔误，是判据缺失。
//   —— 本仓一贯做法：同一个病出现第二次，就把它交给机器判，不再靠人记得。
{
  const H8 = onto.indexOf("## 8.");
  if (H8 < 0) fail.push("本体缺 §8 断点登记章节（无法校核断点编号闭合）");
  else {
    // §8 表行形如 `| G-XXX | 描述 | 链路 | 状态 |` —— 只认**行首**的表格单元格，
    // 正文里顺带提到的编号不算「已登记」（这正是要抓的那种情况）。
    const sec8 = onto.slice(H8);
    const registered = new Set([...sec8.matchAll(/^\|\s*(G-[A-Z0-9-]+)\s*\|/gm)].map((m) => m[1]));
    // 正文里的「闭 G-XXX」「闭合 G-XXX」「关闭 G-XXX」声明（§8 之外的部分）。
    // ⚠️ 一处「闭」后面可能挂**多个**编号，如 §7:877「闭 §8 G-DEAD-GATE-BY-POLICY 整类 + G-WRITEBACK-ONE-WAY」。
    //    第一版正则只取紧跟其后的那一个 ⇒ 后面的编号漏检 —— 那正是本门要治的病本身
    //    （拿一个覆盖不全的信号去断言「全查过了」）。故改为：命中「闭」后，在其后 120 字符窗口内**全取**。
    const claimed = new Set();
    for (const m of onto.slice(0, H8).matchAll(/(?:闭合?|关闭)\s*(?:§\s*8\s*)?(?=G-)/g)) {
      const win = onto.slice(m.index, m.index + 120);
      for (const g of win.matchAll(/\b(G-[A-Z0-9-]+)/g)) claimed.add(g[1]);
    }
    const dangling = [...claimed].filter((g) => !registered.has(g)).sort();
    if (dangling.length) {
      fail.push(
        `正文声称已闭、§8 表里却查无此号（**悬空引用**：回写了描述没回写登记）：${dangling.join(", ")}` +
          ` —— 修法：在 §8 补一行 \`| ${dangling[0]} | 病是什么 | 链路 | 状态 |\`，` +
          `不要改正文把「闭」字删掉了事（那是把证据擦掉，不是把账记上）。`,
      );
    }
    console.log(`· 断点编号：§8 已登记 ${registered.size} 个 · 正文声称已闭 ${claimed.size} 个 · 悬空 ${dangling.length} 个`);
  }
}

// --- 结论 ------------------------------------------------------------------
if (fail.length) {
  console.error("\n✗ 系统本体漂移门禁未通过（改了接线必须回写 docs/SYSTEM-ONTOLOGY.md）：");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ 系统本体与代码一致（事件 / 求解器 / 文件锚点 / 断点编号闭合）。");
