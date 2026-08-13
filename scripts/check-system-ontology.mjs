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
  // §4 已登记事件集 —— 两条来源，都要，且各有各的收紧理由（WO-3 件一：这里是发射侧盲区的**对称面**）：
  //  ① 反引号里的**多段点名**（`a.b` / `a.b.c`）：沿用旧行为。旧正则写成恰好一个点，
  //     于是 `iam.user.created` 这类**两个点**的事件「登记了也读不到」——与发射端只认字面量同源。
  //  ② 表格行第二列的反引号 token（**任意形状**，含无点名 `supply_risk`）：
  //     无点名在散文里无法与普通标识符区分，只在**结构化的表格事件列**认它，避免「随便提一次就算登记」的过宽假绿
  //     （§4 上方注释记着的旧坑：一段说「这些没登记」的话反而让门判它们登记了）。
  const docEvents = new Set([...sec4Text.matchAll(/`([a-z0-9_]+(?:\.[a-z0-9_]+)+)`/g)].map((m) => m[1]));
  for (const row of sec4Text.matchAll(/^\|[^|\n]*\|\s*`([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)`\s*\|/gm)) docEvents.add(row[1]);
  const missingInDoc = [...codeEvents].filter((e) => !docEvents.has(e));
  if (missingInDoc.length) fail.push(`事件已在代码、未登记进本体 §4：${missingInDoc.join(", ")}`);
  // 反向：本体记了但代码已删（疑似漂移）。
  // ⚠ 判据必须是「代码里还有没有这个事件」= 订阅声明 ∪ **发射端**。只拿订阅声明当权威，
  //   会把「只发不订阅」的事件（iam.*/view_config.* 这类审计事件）误报成「代码已删」——
  //   又是「我用 A 当作 B 的证据，而 A 并不度量 B」。发射集在下方算出后再判，故此处只留占位。
  const staleCandidates = [...docEvents].filter((e) => !codeEvents.has(e) && /\.(uploaded|published|completed|updated|executed|applied|promoted|ingested|merged|created|added|regenerated|divergence)$/.test(e));
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
  // ⛔ 第三次犯同一种病（2026-08-12 实测，WO-3 件一）：上一版抽取器的正则形如
  //    `outbox\.emit\(…,\s*"<字面量>"` —— **只认字符串字面量**。事件名来自常量/变量/三元的 emit
  //    对它完全不可见：既不计入「真 emit N 个」，也永远撞不上棘轮。
  //    形态（铁律 0.6）：「我用『字面量 emit 的条数』当作『真发事件数』的证据，而前者并不度量后者。」
  //    实测盲区（本次修复前，全 78 个发射点里有 6 个不可见）：
  //      · `RULE_SCOPE_UNRESOLVED_EVENT`（跨文件常量引用）scheduler.ts:219
  //      · `event`（同作用域三元赋值 → rule.alert / calibration.required）scheduler.ts:286
  //      · 内联三元（calibration.applied / calibration.auto_applied）calibration/service.ts:681
  //      · `supply_risk`（真字面量，但**无点**，被事件名形状 `a.b` 挡在门外）planviews.ts:416
  //      · `event`（本地 wrapper 形参 → 9 个 iam./view_config./scenario_package. 事件）adminplatform.ts:132
  //
  // ★ 机制：**不判就必须说不判**。解析不出的落进 `undecidable` 桶并显式播报 ——
  //    「静默当作没有 emit」正是本单要治的病换个形式复发。
  // ★ 金丝雀与主逻辑**共用 resolveEmitsIn 本尊**（不许各抄一份正则），每种解析形态各一条，
  //    并钉死上面的真实盲区；诚实位（各形态命中数）**现算不写死**。
  const EMIT_SRC_DIRS = ["apps/datacore/src", "apps/agentcore/src"];
  const EMIT_CALLEES = ["outbox.emit", "emitDomainEvent"];
  // 事件名形状：领域事件惯例是 `a.b`，但 outbox 真发过无点名（supply_risk 实测）——放宽并照实计入。
  const EV_SHAPE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;

  // 注释里的 emit 样例不是真发射（event-subscriptions.ts:105 的散文就写着 `outbox.emit("sim.*")`）。
  // ⚠ 必须**单趟状态机**，不许「先剥块注释再剥行注释」两遍正则：
  //   app.ts:950 的**行注释**里有一句 `/a/v1/*`，两遍法会把那个 `/*` 当块注释起点，
  //   一路吞到下一个 `*/` —— 实测吞掉 4 个真 emit（connection.created / materialize.completed /
  //   prototype.objectified / schema_reconcile.resolved），且**静默**：数字只是变小，没有任何报错。
  //   这与本门要治的病同源（「看不见」被当成「不存在」），所以这里也得较真。
  // 保留字符数与换行（用空格填充），位置不漂。
  const stripComments = (t) => {
    const out = t.split("");
    let i = 0;
    const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " "; };
    while (i < t.length) {
      const c = t[i], n = t[i + 1];
      if (c === '"' || c === "'" || c === "`") { // 字符串/模板：整体跳过（内部 // 与 /* 都不是注释）
        const q = c; i++;
        while (i < t.length && !(t[i] === q && t[i - 1] !== "\\")) i++;
        i++; continue;
      }
      if (c === "/" && n === "/") { const e = t.indexOf("\n", i); const end = e === -1 ? t.length : e; blank(i, end); i = end; continue; }
      if (c === "/" && n === "*") { const e = t.indexOf("*/", i + 2); const end = e === -1 ? t.length : e + 2; blank(i, end); i = end; continue; }
      i++;
    }
    return out.join("");
  };

  // 顶层实参切分（括号/方括号/花括号/引号/模板串均计深度）——比正则可靠，多行调用照切。
  const splitArgs = (src, openIdx) => {
    const args = [];
    let d = 0, s = openIdx + 1, q = null;
    for (let i = openIdx + 1; i < src.length; i++) {
      const c = src[i], prev = src[i - 1];
      if (q) { if (c === q && prev !== "\\") q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if ("([{".includes(c)) d++;
      else if (")]}".includes(c)) { if (c === ")" && d === 0) { args.push(src.slice(s, i)); return { args, end: i }; } d--; }
      else if (c === "," && d === 0) { args.push(src.slice(s, i)); s = i + 1; }
    }
    return { args, end: -1 };
  };

  const litOf = (e) => {
    const m = e.trim().match(/^(?:"([^"]*)"|'([^']*)'|`([^`${]*)`)$/);
    return m ? (m[1] ?? m[2] ?? m[3]) : null;
  };

  /**
   * 解析一段源码里所有 emit 的事件名。
   * @returns {{resolved: Map<string,string>, undecidable: Array<{expr:string,line:number}>, forms: Record<string,number>}}
   *   resolved: 事件名 → 解析形态；undecidable: 判不出来的表达式（**必须被播报**）
   */
  const resolveEmitsIn = (rawText, extern = new Map()) => {
    const text = stripComments(rawText);
    const resolved = new Map(), undecidable = [], forms = {};
    const note = (ev, form) => { if (EV_SHAPE.test(ev)) { if (!resolved.has(ev)) resolved.set(ev, form); forms[form] = (forms[form] || 0) + 1; } };
    const lineOf = (i) => text.slice(0, i).split("\n").length;

    // 同文件常量表：const X = "lit" / const X = c ? "a" : "b" / const O = { K: "lit" }
    const constLit = new Map(), constTern = new Map(), constObj = new Map();
    for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:"([^"]*)"|'([^']*)')\s*;/g))
      constLit.set(m[1], m[2] ?? m[3]);
    for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*[^;?]+\?\s*(?:"([^"]*)"|'([^']*)')\s*:\s*(?:"([^"]*)"|'([^']*)')\s*;/g))
      constTern.set(m[1], [m[2] ?? m[3], m[4] ?? m[5]]);
    for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\{([^{}]*)\}\s*as const\s*;|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\{([^{}]*)\}\s*;/g)) {
      const name = m[1] ?? m[3], body = m[2] ?? m[4];
      if (!name || !body) continue;
      const kv = new Map();
      for (const p of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(?:"([^"]*)"|'([^']*)')/g)) kv.set(p[1], p[2] ?? p[3]);
      if (kv.size) constObj.set(name, kv);
    }

    // 本地 wrapper：const f = (a, evt, p) => outbox.emit(a, evt, p) —— 形参转发，靠调用点补齐
    const wrappers = new Map();
    const wrapperParams = new Set(); // wrapper 的事件名形参：其内部转发点由调用点覆盖，不算「判不出来」
    for (const m of text.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::[^=]+)?=>\s*\{?\s*(?:return\s*)?(?:await\s+)?(outbox\.emit|this\.outbox\.emit|emitDomainEvent)\(([^)]*)\)/g)) {
      const params = m[2].split(",").map((s) => s.trim().replace(/[:?].*$/, "").trim());
      const callArgs = m[4].split(",").map((s) => s.trim());
      const pos = params.indexOf(callArgs[1]);
      if (pos >= 0) { wrappers.set(m[1], pos); wrapperParams.add(callArgs[1]); }
    }

    const scanCallee = (callee, isWrapper, evPos) => {
      const needle = callee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // ⚠ 接收者前缀是任意的：`outbox.emit` / `this.outbox.emit` / `deps.outbox.emit` / `this.deps.outbox.emit`。
      //   早先写死 `(?:this\.)?` 漏掉 `deps.outbox.emit(`（llmproviders.ts:484 的 llm.credential_fetched 实测丢失）。
      const recv = isWrapper ? "" : "(?:[A-Za-z_$][\\w$]*\\.)*";
      for (const m of text.matchAll(new RegExp(`(?:^|[^\\w$.])(?:await\\s+)?${recv}${needle}\\s*\\(`, "g"))) {
        const open = text.indexOf("(", m.index + m[0].length - 1);
        const { args } = splitArgs(text, open);
        const raw = args[evPos];
        if (raw === undefined) continue;
        const e = raw.trim(), ln = lineOf(m.index);
        const lit = litOf(e);
        if (lit !== null) { note(lit, isWrapper ? "wrapper-call" : "literal"); continue; }
        const tern = e.match(/^[^?]+\?\s*(?:"([^"]*)"|'([^']*)')\s*:\s*(?:"([^"]*)"|'([^']*)')$/s);
        if (tern) { note(tern[1] ?? tern[2], "ternary-inline"); note(tern[3] ?? tern[4], "ternary-inline"); continue; }
        if (isWrapper) continue; // wrapper 内部的形参转发由调用点覆盖
        if (/^[A-Za-z_$][\w$]*$/.test(e)) {
          if (constLit.has(e)) { note(constLit.get(e), "const-local"); continue; }
          if (constTern.has(e)) { constTern.get(e).forEach((v) => note(v, "ternary-var")); continue; }
          if (extern.has(e)) { note(extern.get(e), "const-import"); continue; }
          // wrapper 的事件名形参：该转发点本身不携带事件名，真值在调用点（已由 wrapper-call 解析）⇒ 不算判不出来
          if (wrapperParams.has(e)) continue;
        }
        const mem = e.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
        if (mem && constObj.get(mem[1])?.has(mem[2])) { note(constObj.get(mem[1]).get(mem[2]), "const-map"); continue; }
        undecidable.push({ expr: e.replace(/\s+/g, " ").slice(0, 60), line: ln });
      }
    };

    for (const c of EMIT_CALLEES) scanCallee(c, false, 1);
    for (const [w, pos] of wrappers) scanCallee(w, true, pos);
    return { resolved, undecidable, forms };
  };

  // 金丝雀：**每种解析形态各一条**，全部走 resolveEmitsIn 本尊（改坏任一条，对应金丝雀立刻红）。
  const CANARIES = [
    { form: "literal", src: 'await outbox.emit(c.tenantId, "sim.canary_emitted", {});', expect: ["sim.canary_emitted"] },
    { form: "literal(domain)", src: 'emitDomainEvent(tid, "sim.canary_domain", {});', expect: ["sim.canary_domain"] },
    { form: "dotless", src: 'await outbox.emit(t, "canary_dotless", {});', expect: ["canary_dotless"] },
    { form: "const-local", src: 'const CE = "sim.canary_const";\nawait outbox.emit(t, CE, {});', expect: ["sim.canary_const"] },
    { form: "ternary-inline", src: 'await outbox.emit(t, x ? "sim.canary_ti_a" : "sim.canary_ti_b", {});', expect: ["sim.canary_ti_a", "sim.canary_ti_b"] },
    { form: "ternary-var", src: 'const ev = x === 1 ? "sim.canary_tv_a" : "sim.canary_tv_b";\nawait outbox.emit(t, ev, {});', expect: ["sim.canary_tv_a", "sim.canary_tv_b"] },
    { form: "const-map", src: 'const EVT = { RULE_ALERT: "sim.canary_map" };\nawait outbox.emit(t, EVT.RULE_ALERT, {});', expect: ["sim.canary_map"] },
    { form: "wrapper-call", src: 'const audit = (tid, event, p) => outbox.emit(tid, event, p);\nawait audit(c.tenantId, "sim.canary_wrapped", {});', expect: ["sim.canary_wrapped"] },
  ];
  for (const cn of CANARIES) {
    const got = resolveEmitsIn(cn.src, new Map([["IMPORTED_CE", "sim.canary_import"]])).resolved;
    const miss = cn.expect.filter((e) => !got.has(e));
    if (miss.length)
      fail.push(`**门自己瞎了**：发射端解析形态 \`${cn.form}\` 的金丝雀未命中（缺 ${miss.join(", ")}）—— 此时的「真 emit / 未登记 N 个」不可信。`);
  }
  // 金丝雀·跨文件常量引用（extern 通道）
  if (!resolveEmitsIn('await outbox.emit(t, IMPORTED_CE, {});', new Map([["IMPORTED_CE", "sim.canary_import"]])).resolved.has("sim.canary_import"))
    fail.push("**门自己瞎了**：发射端解析形态 `const-import`（跨文件常量）的金丝雀未命中 —— 跨文件事件名不可见。");
  // 金丝雀·**不判就必须说不判**：判不出来的必须进 undecidable 桶，不许静默当「没有 emit」。
  {
    const u = resolveEmitsIn('await outbox.emit(t, computeName(kind), {});').undecidable;
    if (!u.some((x) => x.expr.includes("computeName")))
      fail.push("**门自己瞎了**：判不出来的事件名没有落进「无法静态判定」桶 —— 它会被静默当作『没有 emit』，正是本门要治的病复发。");
  }
  // 金丝雀·注释里的 emit 样例不得计入（散文 ≠ 真发射）
  if (resolveEmitsIn('// 说明：datacore 六处 outbox.emit("sim.doc_example")\n').resolved.size !== 0)
    fail.push("**门自己瞎了**：注释里的 emit 样例被计成真发射 —— 「真 emit N 个」被散文灌水。");

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
  // 跨文件常量表：全仓 `export const X = "a.b"` —— 供 const-import 形态解析（scheduler 引 rule-scope 那种）。
  const externConsts = new Map();
  for (const f of tsFiles)
    for (const m of readFileSync(f, "utf8").matchAll(/export\s+const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(?:"([^"]*)"|'([^']*)')\s*;/g))
      externConsts.set(m[1], m[2] ?? m[3]);

  const emitted = new Set();
  const emitForms = {};
  const undecidableAll = [];
  for (const f of tsFiles) {
    const r = resolveEmitsIn(readFileSync(f, "utf8"), externConsts);
    for (const [ev, form] of r.resolved) { emitted.add(ev); emitForms[form] = (emitForms[form] || 0) + 1; }
    for (const u of r.undecidable) undecidableAll.push({ ...u, file: f });
  }
  // 金丝雀③：全仓必有 emit（若为 0，是遍历/正则坏了，不是「代码里没有事件」）。
  if (emitted.size === 0)
    fail.push("**门自己瞎了**：全仓一个 emit 都没抽到 —— 报「emit 未登记 0 个」等于什么都没验。");
  // 金丝雀④：钉死三条**实测已知盲区**（WO-3 件一）。它们是非字面量事件名，
  //   上一版抽取器看不见、靠人工登记进 §4 —— 现在必须由门自己认出来，退化即红。
  for (const known of ["rule.scope_unresolved", "rule.alert", "calibration.required"])
    if (!emitted.has(known))
      fail.push(`**门自己瞎了**：已知非字面量盲区 \`${known}\` 未被解析出来 —— 发射端抽取器又退回「只认字面量」。`);

  // 漂移判据补齐（见上方占位）：登记了、订阅侧没有、**发射侧也没有** ⇒ 才是真漂移。
  const staleInDoc = staleCandidates.filter((e) => !emitted.has(e));
  if (staleInDoc.length) fail.push(`本体 §4 记了、代码已无此事件（疑似漂移）：${staleInDoc.join(", ")}`);

  const emitUnregistered = [...emitted].filter((e) => !docEvents.has(e)).sort();
  // 棘轮：存量记账、新增被挡（只降不升）。存量清零请回写 §4，不要抬基线。
  // 基线 23 = 2026-08-08 在 canonical 实测；其中 sim.scenario_saved 的 §4 登记在待并批次里，
  // 那批并线后应降到 22 —— 降了要顺手把这个数字改小，这就是棘轮的用法。
  // 2026-08-12（WO-3 件一）23 → 21：抽取器认出非字面量事件名后本应涨到 33，
  // 回写 §4 十一条（`calibration.auto_applied` / `supply_risk` / 9 条 `iam.*`·`view_config.*`·`scenario_package.*`）
  // 压回 22；§4 解析同步修掉「只认恰好一个点」的对称盲区（`iam.user.created` 这类登记了也读不到）后实测 21。
  // 存量清零请继续回写 §4，**不许抬这个数**。
  const MAX_EMIT_UNREGISTERED = 21;
  if (emitUnregistered.length > MAX_EMIT_UNREGISTERED) {
    fail.push(
      `**emit 了但本体 §4 未登记**：${emitUnregistered.length} 个 > 棘轮基线 ${MAX_EMIT_UNREGISTERED}。` +
        ` 新增的是：${emitUnregistered.slice(MAX_EMIT_UNREGISTERED).join(", ")}` +
        ` —— 修法：在 §4 补登该事件（发了没人收也要登，登记的是「系统会发这个事」，不是「有人在收」）。` +
        ` 不许抬基线了事。`,
    );
  }
  // 诚实位**现算不写死**：各解析形态命中数 + 「无法静态判定」桶。
  const formStr = Object.keys(emitForms).sort().map((k) => `${k}=${emitForms[k]}`).join(" ");
  console.log(
    `· 事件（发射端）：真 emit ${emitted.size} 个 · §4 未登记 ${emitUnregistered.length} 个（棘轮基线 ${MAX_EMIT_UNREGISTERED}，只降不升）`,
  );
  console.log(`  └ 解析形态：${formStr}`);
  // 取证用：`ONTOLOGY_DUMP_EMITS=1 node scripts/check-system-ontology.mjs` 打印全量事件名清单
  //（改抽取器时对账「新认出了哪些」用，属诚实位的一部分：清单现算，不写死）。
  if (process.env.ONTOLOGY_DUMP_EMITS === "1") {
    console.log(`  └ 事件清单（${emitted.size}）：`);
    for (const ev of [...emitted].sort()) console.log(`     ${docEvents.has(ev) ? "✓§4" : "✗未登记"}  ${ev}`);
  }
  // ⛔ 判不出来的**必须显式播报**，不许静默当作「没有 emit」——那是本门第三次犯的病换个形式复发。
  if (undecidableAll.length) {
    console.log(`  └ **无法静态判定 ${undecidableAll.length} 处**（事件名非静态可求值 ⇒ 未计入上面的「真 emit」，也未被棘轮覆盖）：`);
    for (const u of undecidableAll.slice(0, 8)) console.log(`     · ${u.file}:${u.line}  ${u.expr}`);
    if (undecidableAll.length > 8) console.log(`     · …另 ${undecidableAll.length - 8} 处`);
  } else {
    console.log("  └ 无法静态判定：0 处（全部发射点的事件名都已静态求值）");
  }
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
