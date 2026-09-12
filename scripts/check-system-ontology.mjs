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
  // ⚠ 键抽取不限定小写形状（2026-08-20 M2 变异实测）：若要求 `[a-z0-9_.]`，把订阅名改成
  //    带大写的「另一个名字」会被**静默跳过**（不算订阅、也不算死订阅，两个方向都看不见）。
  //    这些表/字段按构造装的就是事件名，抽到不合惯例的名字该由对账判红，不是由抽取器滤掉。
  const codeEvents = new Set([...evSrc.matchAll(/event:\s*"([^"]+)"/g)].map((m) => m[1]));
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
      // ⚠ 可选链盲点（2026-08-20 实测，WO-EVENT-SUB-CLOSURE）：`this.outbox?.emit(...)` 的 `?`
      //   会断掉字面 needle —— 全仓 30 处 `outbox?.emit`（connectors/databuilder/solvers 等 8 个文件）
      //   此前对本门完全不可见，「真 emit 78 个」是**少报**。逐段转义后用 `\??\.` 相接。
      const needle = callee.split(".").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\??\\.");
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
    { form: "literal(optional-chain)", src: 'await this.outbox?.emit(tid, "sim.canary_optchain", {});', expect: ["sim.canary_optchain"] },
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
    // ⚠ 措辞纪律（2026-08-20 实测踩中）：下面列的是**按字母序排在基线之外的尾部**，
    //    不是「这次新增的名字」——纯计数棘轮不知道谁新谁旧，名单一涨一跌尾部就会换人。
    //    本单曾被这句「新增的是」误导去登记错误的事件名。要真「新增」名单， diff 两次门输出。
    fail.push(
      `**emit 了但本体 §4 未登记**：${emitUnregistered.length} 个 > 棘轮基线 ${MAX_EMIT_UNREGISTERED}。` +
        ` 超出基线的（字母序尾部，不等于本次新增）：${emitUnregistered.slice(MAX_EMIT_UNREGISTERED).join(", ")}` +
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

  // --- 1c) 发射 → 订阅对账（发出的事件有没有人接）────────────────────────────────
  // ⛔ 存在理由（断点 G-EVENT-GATE-MEASURES-SUBS-NOT-EMITS 的另一半，WO-EVENT-SUB-CLOSURE 建）：
  //    1) 量「订阅声明 ⊆ §4」、1b) 量「emit ⊆ §4」—— 两道都对账**登记**，
  //    没有任何一条回答「这个 emit 出去的事件，有没有哪怕一个订阅方」。
  //    形态（铁律 0.6）：「我用『订阅数 > 0』当作『这个事件有消费方』的证据，
  //    而前者并不度量后者 —— 订阅的可能全是**别的**事件。」
  //    sim.* 六事件当年就是这样：发了、登记了、零消费方，门照样绿。
  //
  // 订阅方 = 三处**静态可见**的订阅点 ∪ 一处「故意不接」台账：
  //   ① agentcore event-subscriptions.ts 的登记（事件→语义标签单一来源，上面已抽为 codeEvents）；
  //   ② 前端 eventInvalidation.ts 的 EVENT_INVALIDATES 顶层键（真失效接线）；
  //   ③ B 侧 /b/v1/internal/invalidate 的 `event.startsWith("<prefix>")` 前缀处理器
  //      （llm_provider/feature/ontology/prompt 这类 {kind}.updated 事件的消费方）；
  //   ④ 前端 SIM_EVENT_GAPS 的键 = 「故意不接 + 写明理由」的已确认缺口
  //      （sim-event-invalidation seam 测试守着：理由不许空、不许与已接线重叠）——算记了账，不算违规。
  // ⚠ 运行时租户自助注册的 webhook（outbox 第二投递通道）静态不可见 ⇒
  //   只走那条通道的事件只能落下面的棘轮台账，这是口径边界，不是门的盲区谎报。
  const FE_INVALIDATION_SRC = "apps/frontend-shell/src/store/eventInvalidation.ts";
  const B_SERVER_SRC = "apps/agentcore/src/server.ts";

  // 抽对象字面量的顶层事件键。⚠ 锚必须是**声明行**（`export const X`），不能只找字串 "X"：
  //   eventInvalidation.ts 的散文/注释里多次提到 EVENT_INVALIDATES（如 GAPS 的「挪进
  //   EVENT_INVALIDATES」），锚不到声明行会把**前一个对象**（SIM_EVENT_GAPS）的键抽出来
  //   —— 2026-08-20 建本段时探针亲测踩中（缺口台账被当成接线表）。
  const harvestTopKeys = (src, declAnchor) => {
    const m = src.match(new RegExp(declAnchor + "[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};"));
    if (!m) return null;
    return new Set([...m[1].matchAll(/^\s*"([^"]+)":/gm)].map((x) => x[1]));
  };
  // B 侧 invalidate 前缀：`event.startsWith("...")` 这个形态在本仓只出现在那个 handler 里
  // （若将来别处也用，把扫描窗收窄到该 handler 段——先按实测口径记在这里）。
  const harvestInvalidatePrefixes = (src) =>
    [...new Set([...src.matchAll(/event\.startsWith\("([^"]+)"\)/g)].map((m) => m[1]))];
  // 订阅判据与差集计算：**主逻辑与金丝雀共用同一份实现**（不许各抄一份）。
  const makeSubPredicate = ({ codeEv, invKeys, gapKeys, prefixes }) => (e) =>
    codeEv.has(e) || invKeys.has(e) || gapKeys.has(e) || prefixes.some((p) => e.startsWith(p));
  const computeUncovered = (emittedIter, hasSub) => [...emittedIter].filter((e) => !hasSub(e)).sort();

  const feSrc = read(FE_INVALIDATION_SRC);
  const bSrvSrc = read(B_SERVER_SRC);
  if (!feSrc) fail.push(`缺少 ${FE_INVALIDATION_SRC}（前端失效接线表）——1c 无法判定订阅方，不许读作「都有订阅」。`);
  if (!bSrvSrc) fail.push(`缺少 ${B_SERVER_SRC}（B 侧 invalidate 处理器所在）——1c 无法判定前缀订阅。`);
  if (feSrc && bSrvSrc) {
    const invKeys = harvestTopKeys(feSrc, "export const EVENT_INVALIDATES");
    const gapKeys = harvestTopKeys(feSrc, "export const SIM_EVENT_GAPS");
    const prefixes = harvestInvalidatePrefixes(bSrvSrc);
    if (!invKeys) fail.push("**门自己瞎了**：抽不出 EVENT_INVALIDATES 的声明块（锚改了？）——1c 结论不可信。");
    if (!gapKeys) fail.push("**门自己瞎了**：抽不出 SIM_EVENT_GAPS 的声明块（锚改了？）——1c 结论不可信。");
    if (prefixes.length === 0)
      fail.push("**门自己瞎了**：B 侧 invalidate 处理器一个 startsWith 前缀都没抽到 —— {kind}.updated 事件会被误报成零订阅。");

    // 金丝雀（全部走上面同一份实现，改坏任一抽取器/判据，对应金丝雀立刻红）：
    //  C1 必咬：合成 emit 无任何订阅 ⇒ 必被点名。
    {
      const c = computeUncovered(["sim.canary_orphan"], makeSubPredicate({ codeEv: new Set(), invKeys: new Set(), gapKeys: new Set(), prefixes: [] }));
      if (!(c.length === 1 && c[0] === "sim.canary_orphan"))
        fail.push("**门自己瞎了**：1c 必咬金丝雀未命中 —— 无订阅的 emit 没被抓出来，此时的「零订阅 N 个」不可信。");
    }
    //  C2 必不咬 ⊕ 锚陷阱：样例里先在**散文串**里提一次 EVENT_INVALIDATES 再真声明 ——
    //     锚不到声明行的抽取器会把前一个对象（这里故意放个 GAPS 样子的块）的键当接线表。
    {
      const src =
        'const NOTE = "出台账条件：把本条挪进 EVENT_INVALIDATES 接 [\'sim-x\']。";\n' +
        "export const SIM_EVENT_GAPS: Record<string, string> = {\n  \"sim.canary_gap\": \"理由：今天没有缓存可失效\",\n};\n" +
        "export const EVENT_INVALIDATES: Record<string, readonly string[]> = {\n  \"sim.canary_wired\": [\"sim-sessions\"],\n};\n";
      const k = harvestTopKeys(src, "export const EVENT_INVALIDATES");
      const g = harvestTopKeys(src, "export const SIM_EVENT_GAPS");
      const okC2 = k?.has("sim.canary_wired") && !k.has("sim.canary_gap") && g?.has("sim.canary_gap");
      if (!okC2) fail.push("**门自己瞎了**：1c 抽取器锚错了对象（把缺口台账当接线表，或反之）——1c 结论不可信。");
      else {
        const pred = makeSubPredicate({ codeEv: new Set(), invKeys: k, gapKeys: g, prefixes: [] });
        if (computeUncovered(["sim.canary_wired"], pred).length !== 0)
          fail.push("**门自己瞎了**：1c 必不咬金丝雀误咬 —— 已接线的事件被报成零订阅（误报方向）。");
        if (computeUncovered(["sim.canary_gap"], pred).length !== 0)
          fail.push("**门自己瞎了**：记在缺口台账（有理由的故意不接）的事件被报成违规 —— 台账豁免失效。");
      }
    }
    //  C3 前缀订阅：B 侧 startsWith 前缀 ⇒ "rules.canary_x" 算有订阅。
    {
      const pre = harvestInvalidatePrefixes('if (event.startsWith("rules")) invalidated.push("rules(no-cache)");');
      if (!pre.includes("rules") || computeUncovered(["rules.canary_x"], makeSubPredicate({ codeEv: new Set(), invKeys: new Set(), gapKeys: new Set(), prefixes: pre })).length !== 0)
        fail.push("**门自己瞎了**：1c 前缀订阅金丝雀未命中 —— {kind}.updated 那类事件的消费方不可见。");
    }

    if (invKeys && gapKeys && prefixes.length > 0) {
      const hasSub = makeSubPredicate({ codeEv: codeEvents, invKeys, gapKeys, prefixes });
      const uncovered = computeUncovered(emitted, hasSub);

      // 棘轮台账（只降不升）：今日实测「emit 了但静态零订阅方」的存量，逐名登记。
      // 存量大头是审计/webhook 通道事件（iam.* / view_config.* / scenario_package.* / llm.* 等）——
      // 消费方是运行时租户注册的 webhook 或纯落库审计，静态不可见，不是「忘了接」。
      // 两个方向都判（与 SIM_EVENT_GAPS seam 测试同款纪律）：
      //   · 台账外新出现的无订阅事件 ⇒ 红，逐名点名（新增 emit 必须接线或登记缺口）；
      //   · 台账里的事件今天已有订阅方 / 已不再 emit ⇒ 红，勒令删名（防台账 drift 成遮羞布）。
      // 2026-08-20 建账：35 名（sim.checkpoint_saved 同日接线出账，未进台账）。
      // 2026-08-20 修正 35 → 42：`outbox?.emit` 可选链盲点修复后实测 42 名 ——
      //   新进的 7 名（buildpipeline.reset / buildpipeline.updated / buildworkflow.step_approved /
      //   decision.options_generated / gap.attributed / prototype.materialized / trigger.fired）
      //   是**抽取器此前看不见、今天才变得可见**的存量，不是本单新增的违规；
      //   照 0.6 记账：基线扩张只发生在「测量工具修正」时，且逐名留证据。消费方缺失本身仍是真存量，
      //   后续接线任一名字必须顺手从台账删名（下面 staleBaseline 方向强制）。
      const NO_SUBSCRIBER_BASELINE = [
        "action.approved", "action.auto_approved", "action.cancelled", "action.execution_failed", "action.rejected",
        "aop.finalized", "approval.escalated", "approval.reminder",
        "buildpipeline.reset", "buildpipeline.updated", "buildworkflow.step_approved",
        "calibration.auto_applied", "calibration.meta_evaluated", "calibration.required",
        "decision.options_generated", "decision.realized", "gap.attributed",
        "iam.tenant.created", "iam.user.created", "iam.user.password_reset", "iam.user.updated",
        "llm.credential_fetched", "meta.ontology_synced",
        "ops_schedule.forecast_run", "ops_schedule.sop_opened", "ops_schedule.updated",
        "plan.canvas.published", "prototype.materialized", "prototype.objectified",
        "rule.alert", "rule.scope_unresolved",
        "scenario.trigger_fired", "scenario_package.created", "scenario_package.updated",
        "sop.changed", "sop.finalized", "supply_risk", "trigger.fired", "ts.late_arrival",
        "view_config.created", "view_config.deleted", "view_config.updated",
      ];
      const baselineSet = new Set(NO_SUBSCRIBER_BASELINE);
      const newUncovered = uncovered.filter((e) => !baselineSet.has(e));
      const staleBaseline = NO_SUBSCRIBER_BASELINE.filter((e) => !uncovered.includes(e));
      if (newUncovered.length)
        fail.push(
          `**emit 了但没有任何订阅方**（台账外新增）：${newUncovered.join(", ")} —— 修法：` +
            `在 event-subscriptions.ts 登记 + 前端 EVENT_INVALIDATES 接线（真缓存承载），` +
            `或（仅 sim.*）记进 SIM_EVENT_GAPS 写清「为什么今天不接」。不许把名字塞进 NO_SUBSCRIBER_BASELINE 了事。`,
        );
      if (staleBaseline.length)
        fail.push(
          `无订阅台账与实测不符：${staleBaseline.join(", ")} 今天已有订阅方或已不再 emit —— ` +
            `把它们从 NO_SUBSCRIBER_BASELINE 删掉（棘轮只降不升靠这个方向强制）。`,
        );
      console.log(
        `· 事件（发射→订阅对账）：真 emit ${emitted.size} 个 · 静态零订阅方 ${uncovered.length} 个（棘轮台账 ${NO_SUBSCRIBER_BASELINE.length} 名，只降不升）`,
      );

      // --- 1d) 订阅 → 发射 对账（接的线有没有人在发）──────────────────────────
      // ⛔ 存在理由（与 1c 对称的另一半，WO-EVENT-SUB-CLOSURE 建）：
      //    1c 量「每个真 emit 有没有订阅方」；本段量反向 ——「每条登记的订阅，有没有任何一处真在发」。
      //    没有这一段时，把订阅改成订阅一个**没人发的名字**门照样绿（2026-08-20 M2 变异实测漏报：
      //    EVENT_INVALIDATES 的 `sim.branched` → `sim.branchedX`，门 RC=0）——
      //    订阅表可以悄悄 drift 成一堆「听了也没人讲」的死登记。
      // 发射方 = 两条**静态可见**的真发射通道：
      //   ① 领域事件：上面 1b 扫出的 emitted（outbox.emit / emitDomainEvent），不重复扫；
      //   ② B 侧任务事件总线 `events.emit(<taskId>, "<name>", …)`（orchestrator/server 等）——
      //      entity.out_of_domain、scenario.growth_triggered 这类真的在发，走的是任务流不是 outbox；
      //      不扫这条通道会把它们误报成死订阅。
      //   ⚠ webhook 是**订阅**通道不是发射通道，与本方向无关。
      const harvestTaskBusEmits = (src) =>
        [...src.matchAll(/\bevents\.emit\(\s*[^,]+,\s*"([a-z0-9_.]+)"/g)].map((m) => m[1]);
      // 判据与差集：**主逻辑与金丝雀共用同一份实现**。
      const computeDangling = (subs, emittedSet, taskBusSet) =>
        [...subs].filter((e) => !emittedSet.has(e) && !taskBusSet.has(e)).sort();
      //  C4 必咬：合成订阅名两条通道都没人发 ⇒ 必被点名。
      {
        const d = computeDangling(["sim.canary_dangling"], new Set(), new Set());
        if (!(d.length === 1 && d[0] === "sim.canary_dangling"))
          fail.push("**门自己瞎了**：1d 必咬金丝雀未命中 —— 死订阅没被抓出来，M2 变异（把订阅改成没人发的名字）照样漏。");
      }
      //  C5 必不咬：任务事件总线（events.emit）发的名字算「有人在发」。
      {
        const tb = new Set(harvestTaskBusEmits('await deps.events.emit(taskId, "sim.canary_taskbus", { x: 1 });'));
        if (!tb.has("sim.canary_taskbus") || computeDangling(["sim.canary_taskbus"], new Set(), tb).length !== 0)
          fail.push("**门自己瞎了**：1d 任务总线金丝雀未命中 —— events.emit 通道不可见，会把真在发的事件误报成死订阅。");
      }
      const taskBusEmits = new Set(tsFiles.flatMap((f) => harvestTaskBusEmits(readFileSync(f, "utf8"))));
      const subExact = new Set([...codeEvents, ...invKeys]);
      const danglingExact = computeDangling(subExact, emitted, taskBusEmits);
      const danglingPrefixes = prefixes.filter((p) => ![...emitted, ...taskBusEmits].some((e) => e.startsWith(p))).sort();
      // 棘轮台账（只降不升，与 1c 同款双向纪律）。
      // 2026-08-20 建账：6 名 exact + 2 条前缀 —— 全是「订阅登记写着 producer，但两条发射通道都
      //   找不到这个名字」的实测存量（登记了没人发 = 死登记，修法是补真 emit 或删登记）。
      const DANGLING_SUBSCRIPTION_BASELINE = [
        "features.updated", "intent.promoted", "policy.updated",
        "quarantine.row_added", "scene_entry.updated", "ts.ingested",
      ];
      const DANGLING_PREFIX_BASELINE = ["feature", "prompt"];
      const danglingBaseSet = new Set(DANGLING_SUBSCRIPTION_BASELINE);
      const prefixBaseSet = new Set(DANGLING_PREFIX_BASELINE);
      const newDangling = danglingExact.filter((e) => !danglingBaseSet.has(e));
      const staleDangling = DANGLING_SUBSCRIPTION_BASELINE.filter((e) => !danglingExact.includes(e));
      const newDanglingPrefixes = danglingPrefixes.filter((p) => !prefixBaseSet.has(p));
      const stalePrefixes = DANGLING_PREFIX_BASELINE.filter((p) => !danglingPrefixes.includes(p));
      if (newDangling.length)
        fail.push(
          `**订阅了但没有任何发射方**（台账外新增）：${newDangling.join(", ")} —— 把订阅改成没人发的名字 = 死登记。` +
            `修法：补真 emit（D-29 产出必发）或删掉这条订阅登记。不许塞进 DANGLING_SUBSCRIPTION_BASELINE 了事。`,
        );
      if (staleDangling.length)
        fail.push(
          `死订阅台账与实测不符：${staleDangling.join(", ")} 今天已有真发射方或已删登记 —— ` +
            `把它们从 DANGLING_SUBSCRIPTION_BASELINE 删掉（棘轮只降不升靠这个方向强制）。`,
        );
      if (newDanglingPrefixes.length)
        fail.push(
          `**B 侧 invalidate 前缀没有任何发射方**（台账外新增）：${newDanglingPrefixes.join(", ")} —— 同死登记，修法同上。`,
        );
      if (stalePrefixes.length)
        fail.push(
          `死前缀台账与实测不符：${stalePrefixes.join(", ")} 今天已有匹配的发射 —— 从 DANGLING_PREFIX_BASELINE 删掉。`,
        );
      console.log(
        `· 事件（订阅→发射对账）：静态订阅 ${subExact.size} 名 + B 侧前缀 ${prefixes.length} 条 · 无发射方 ${danglingExact.length} 名 + ${danglingPrefixes.length} 前缀（棘轮台账 ${DANGLING_SUBSCRIPTION_BASELINE.length}+${DANGLING_PREFIX_BASELINE.length}，只降不升）`,
      );
    }
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
