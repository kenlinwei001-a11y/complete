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
  console.error(`⛔ check-system-ontology.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";

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
  // ⛔ 必须**只截 §4 那一节**，不能扫全文（2026-08-08 实测，我自己当场踩出来的）：
  //    全文扫时，只要事件名在本体任何地方被反引号提过一次就算「已登记」——
  //    我在 §8 写一条断点、描述里点名了 4 个「**没登记**」的事件，
  //    棘轮当场从 23 掉到 19：**一段说「这些没登记」的话，反而让门判它们登记了。**
  //    形态（铁律 0.6）：「我用『全文出现过这个反引号串』当作『§4 登记了这个事件』的证据，
  //    而前者并不度量后者。」订阅声明侧那条断言此前也吃着同一个宽口径。
  const sec4 = onto.match(/\n## 4\. [\s\S]*?(?=\n## 5\. )/);
  if (!sec4) fail.push("**门自己瞎了**：切不出本体 §4 章节（标题格式变了？）—— 此时的事件登记判定全部不可信。");
  const sec4Text = sec4 ? sec4[0] : "";
  // 金丝雀：§4 必须含一个已知必在的事件；不中说明切窗切歪了，不是「本体没登记事件」。
  if (sec4 && !/`raw_dataset\.uploaded`/.test(sec4Text))
    fail.push("**门自己瞎了**：§4 切窗里找不到金丝雀 `raw_dataset.uploaded` —— 切窗错位，登记判定不可信。");
  const docEvents = new Set([...sec4Text.matchAll(/`([a-z0-9_]+\.[a-z0-9_]+)`/g)].map((m) => m[1]));
  const missingInDoc = [...codeEvents].filter((e) => !docEvents.has(e));
  if (missingInDoc.length) fail.push(`事件已在代码、未登记进本体 §4：${missingInDoc.join(", ")}`);
  // 反向：本体记了但代码已删（仅对"看起来像领域事件"的，宽松告警不致命可按需收紧）
  const staleInDoc = [...docEvents].filter((e) => !codeEvents.has(e) && /\.(uploaded|published|completed|updated|executed|applied|promoted|ingested|merged|created|added|regenerated|divergence)$/.test(e));
  if (staleInDoc.length) fail.push(`本体 §4 记了、代码已无此事件（疑似漂移）：${staleInDoc.join(", ")}`);
  // ⚠ 用词要精确：这里量的是**订阅声明**，不是「代码里的事件」。
  //   曾打印「代码 N 个」，于是所有人（包括写它的我）都以为发射端已被覆盖 —— 见下 §1b。
  console.log(`· 事件（订阅声明侧）：event-subscriptions.ts ${codeEvents.size} 个，本体 §4 覆盖 ${[...codeEvents].filter((e) => docEvents.has(e)).length} 个`);

  // --- 1b) 发射端 -----------------------------------------------------------
  // ⛔ 存在理由 = 这道门自己的假绿（2026-08-08 实测，本文件第二次犯同一种病）：
  //    上面那段只读 event-subscriptions.ts 的 `event: "..."`（**订阅声明**），
  //    从没看过一眼 `outbox.emit` / `emitDomainEvent`（**发射端**，全仓 79 处调用点）。
  //    于是「emit 了但 §4 没登记」这**一整类**结构性不可见 —— 实测存量 23 个。
  //    形态（CLAUDE.md 铁律 0.6）：「我用『订阅声明数』当作『代码真发的事件数』的证据，
  //    而前者并不度量后者。」同文件上一次是 SOLVER_KEYS 被注释里的方括号截断（见下方注释）。
  //
  // ★ 机制（不是「下次注意」）：**每条抽取器各有自己的金丝雀**。
  //    上一版对账脚本栽的就是这个 —— 三个样例全走 outbox 那条抽取器，
  //    第二条 emitDomainEvent 抽取器写成什么样都照样全绿，把 4 个事件误报成「零 emit」。
  //    金丝雀与主逻辑**共用 harvestEmits 本尊**，改坏任一条正则，对应金丝雀立刻红。
  const EMIT_SRC_DIRS = ["apps/datacore/src", "apps/agentcore/src"];
  const EMITTERS = [
    { key: "outbox.emit", re: /outbox\.emit\(\s*[^,]+,\s*"([a-z0-9_]+\.[a-z0-9_]+)"/g, canary: 'await outbox.emit(c.tenantId, "sim.canary_emitted", {})', expect: "sim.canary_emitted" },
    { key: "emitDomainEvent", re: /emitDomainEvent\(\s*[^,]+,\s*"([a-z0-9_]+\.[a-z0-9_]+)"/g, canary: 'emitDomainEvent(tid, "sim.canary_domain", {})', expect: "sim.canary_domain" },
  ];
  const harvestEmits = (re, text) => new Set([...text.matchAll(new RegExp(re.source, "g"))].map((m) => m[1]));

  for (const em of EMITTERS) {
    if (!harvestEmits(em.re, em.canary).has(em.expect))
      fail.push(`**门自己瞎了**：发射端抽取器 \`${em.key}\` 的金丝雀未命中 —— 此时的「emit 未登记 N 个」不可信（可能漏整条发射通道）。`);
  }

  const tsFiles = [];
  const walkTs = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d)) {
      const p = `${d}/${e}`;
      if (statSync(p).isDirectory()) { if (e !== "node_modules" && e !== "dist") walkTs(p); }
      else if (p.endsWith(".ts") && !p.includes(".test.")) tsFiles.push(p);
    }
  };
  EMIT_SRC_DIRS.forEach(walkTs);
  const emitted = new Set();
  for (const f of tsFiles) {
    const t = readFileSync(f, "utf8");
    for (const em of EMITTERS) for (const ev of harvestEmits(em.re, t)) emitted.add(ev);
  }
  // 金丝雀③：全仓必有 emit（若为 0，是遍历/正则坏了，不是「代码里没有事件」）。
  if (emitted.size === 0)
    fail.push("**门自己瞎了**：全仓一个 emit 都没抽到 —— 报「emit 未登记 0 个」等于什么都没验。");

  const emitUnregistered = [...emitted].filter((e) => !docEvents.has(e)).sort();
  // 棘轮：存量记账、新增被挡（只降不升）。存量清零请回写 §4，不要抬基线。
  // 基线 23 = 2026-08-08 在 canonical 实测；其中 sim.scenario_saved 的 §4 登记在待并批次里，
  // 那批并线后应降到 22 —— 降了要顺手把这个数字改小，这就是棘轮的用法。
  const MAX_EMIT_UNREGISTERED = 23;
  if (emitUnregistered.length > MAX_EMIT_UNREGISTERED) {
    fail.push(
      `**emit 了但本体 §4 未登记**：${emitUnregistered.length} 个 > 棘轮基线 ${MAX_EMIT_UNREGISTERED}。` +
        ` 新增的是：${emitUnregistered.slice(MAX_EMIT_UNREGISTERED).join(", ")}` +
        ` —— 修法：在 §4 补登该事件（发了没人收也要登，登记的是「系统会发这个事」，不是「有人在收」）。` +
        ` 不许抬基线了事。`,
    );
  }
  console.log(
    `· 事件（发射端）：真 emit ${emitted.size} 个 · §4 未登记 ${emitUnregistered.length} 个（棘轮基线 ${MAX_EMIT_UNREGISTERED}，只降不升）`,
  );
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
    // ── 「闭 G-XXX」声明的**单一抽取实现** ────────────────────────────────────────
    //    主逻辑与两条金丝雀共用同一份。⚠️ 别把正则再抄一份给金丝雀 —— 抄了就成装饰品：
    //    改主正则时金丝雀拿旧的去测、照样绿，正是本仓在治的「门自己的假绿」。
    //    （2026-08-08 我第一版就写成抄一份，变异反证当场抖出来：改主正则时两条金丝雀一起响，
    //      说明它们测的是被改过的那份 —— 换成只改主正则就测不出了。）
    //
    //    这段历史上栽过三次，三种病各不相同，修法也不同：
    //      ① 只取「闭」后紧跟的那一个编号 ⇒ 一处挂多个编号时后面的漏检（已修：窗口内全取）。
    //      ② 先行断言要求「闭」后紧接 `G-`，而本仓惯例把编号写进**反引号** ⇒ 整句不匹配。
    //         实测代价：抓到 26 条声明并报「悬空 0」，放宽后抓到 31 条、其中 1 条真悬空。
    //         也就是说这个检测器长期**只看得见不合书写惯例的那一小半**。（已修：字符类含反引号）
    //      ③ 120 字窗口把编号切断（`G-NO-FREIGHT-COST` → `G-NO-FREIGHT-CO`）⇒ **凭空多报**一条悬空。
    //         ②修好后③才暴露 —— 此前根本匹配不上，截断无从发生。（已修：切在编号中间就往后延）
    //    ②是漏报、③是误报，方向相反，但都让「悬空 N」这个数字不可信。
    const CLOSE_RE = /(?:闭合?|关闭)[\s`§8]{0,8}(?=G-)/g;
    const harvestClosed = (text) => {
      const out = new Set();
      for (const m of text.matchAll(CLOSE_RE)) {
        let end = m.index + 120;
        while (end < text.length && /[A-Z0-9-]/.test(text[end]) && end < m.index + 200) end++;
        for (const g of text.slice(m.index, end).matchAll(/\b(G-[A-Z0-9-]+)/g)) out.add(g[1]);
      }
      return out;
    };
    const claimed = harvestClosed(onto.slice(0, H8));
    const dangling = [...claimed].filter((g) => !registered.has(g)).sort();

    // 金丝雀（门自身没坏）：两条样例都走 harvestClosed 本尊，改坏它两条一起红。
    if (!harvestClosed("…（确定性）闭 §8 `G-CANARY-BACKTICK` 完毕").has("G-CANARY-BACKTICK"))
      fail.push("**门自己瞎了**：反引号写法的「闭 `G-XXX`」抽不出来 —— 悬空检测覆盖不全，此时的「悬空 0」不可信（2026-08-08 实测病灶）。");
    if (!harvestClosed("闭 `G-CANARY-TRUNCATION-SENTINEL` " + "x".repeat(100) + " 尾巴").has("G-CANARY-TRUNCATION-SENTINEL"))
      fail.push("**门自己瞎了**：窗口把编号截断了 —— 「悬空 N」会多报（2026-08-08 实测：G-NO-FREIGHT-COST → G-NO-FREIGHT-CO）。");
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
