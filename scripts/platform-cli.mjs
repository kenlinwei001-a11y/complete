#!/usr/bin/env node
/**
 * 平台对话式 CLI（系统本体 D7 编排域 / 切片 sys.orch.query_to_answer 的一个客户端）。
 *
 * 一句话驱动整个平台：问句 → QOS 意图识别 → 按权限路由 → 触发求解器/工作流/Agent → 流式答案。
 * 权限(A6 行级 + entitlement)、跨系统功能触发、多轮澄清、真值写入经 Action 审批——全由服务端
 * 既有机制保证；本 CLI 只是瘦客户端（复用 ~80%）。也是 Claude Code 嵌入系统的对话入口形态。
 *
 * 用法：
 *   node scripts/platform-cli.mjs login <tenant> <user> <pass>
 *   node scripts/platform-cli.mjs ask "常州影响哪些订单？" [--view risk] [--package <pkg>]
 *   node scripts/platform-cli.mjs scenarios
 *   node scripts/platform-cli.mjs approve <draftId>
 *   node scripts/platform-cli.mjs whoami
 * 环境：DATACORE_URL(默认 http://127.0.0.1:4001) · AGENTCORE_URL(默认 http://127.0.0.1:4002)
 *       PACKAGE_ID(默认 pkg_battery_manufacturing)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const DC = process.env.DATACORE_URL ?? "http://127.0.0.1:4001";
const AC = process.env.AGENTCORE_URL ?? "http://127.0.0.1:4002";
const PKG = process.env.PACKAGE_ID ?? "pkg_battery_manufacturing";
const TOKEN_FILE = join(homedir(), ".platform-cli.json");

const C = { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m` };

function saveSession(s) { writeFileSync(TOKEN_FILE, JSON.stringify(s, null, 2)); }
function loadSession() {
  if (process.env.PLATFORM_TOKEN) return { accessToken: process.env.PLATFORM_TOKEN, who: "(env)" };
  if (existsSync(TOKEN_FILE)) return JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  return null;
}
function authHeader() {
  const s = loadSession();
  if (!s?.accessToken) { console.error(C.red("未登录。先 `login <tenant> <user> <pass>`。")); process.exit(1); }
  return { authorization: `Bearer ${s.accessToken}` };
}

async function http(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers ?? {}) } });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status} ${json?.error?.code ?? ""} ${json?.error?.message ?? text.slice(0, 200)}`);
  return json;
}

// ---- 命令 -----------------------------------------------------------------
async function cmdLogin([tenant, user, pass]) {
  if (!tenant || !user || !pass) { console.error("用法: login <tenant> <user> <pass>"); process.exit(1); }
  const pair = await http(`${DC}/a/v1/auth/login`, { method: "POST", body: JSON.stringify({ tenantId: tenant, username: user, password: pass }) });
  saveSession({ accessToken: pair.accessToken, who: `${tenant}/${user}`, at: new Date().toISOString() });
  console.log(C.green(`✓ 已登录 ${tenant}/${user}`));
}

function cmdWhoami() {
  const s = loadSession();
  console.log(s ? `${C.bold(s.who ?? "?")} ${C.dim(s.at ?? "")}` : "未登录");
}

async function cmdScenarios() {
  const r = await http(`${AC}/b/v1/scenarios`, { headers: authHeader() });
  const items = r.items ?? [];
  console.log(C.bold(`场景目录（${r.total ?? items.length}）`));
  for (const c of items) console.log(`  ${C.cyan(c.sNo ?? "")} ${c.name ?? c.intentKey}  ${C.dim(c.triggerQuestion ?? "")}${c.willProduceDraft ? C.yellow(" [将产生草稿]") : ""}`);
}

async function cmdApprove([id]) {
  if (!id) { console.error("用法: approve <draftId>"); process.exit(1); }
  const r = await http(`${DC}/a/v1/action-drafts/${encodeURIComponent(id)}/approve`, { method: "POST", body: "{}", headers: authHeader() });
  console.log(C.green(`✓ 已审批 ${id}`), C.dim(JSON.stringify(r).slice(0, 120)));
}

// ---- 自成长发动机 P5：成长工单活查询面（厂商中立·人与 code agent 共用同一 CLI） ----------
async function cmdTickets() {
  const r = await http(`${AC}/api/v1/growth/tickets`, { headers: authHeader() });
  const items = r.items ?? [];
  console.log(C.bold(`成长工单（缺功能·需开发，${items.length}）`));
  for (const t of items) {
    console.log(`  ${C.cyan(t.id)} [${C.yellow(t.status)}] ${C.dim(t.gapCode)} ← ${t.fromQuestion}`);
    console.log(`     I/O 契约: in[${(t.ioContract?.inputs ?? []).join(",")}] out[${(t.ioContract?.outputShape ?? []).join(",")}] · 验收: ${C.dim(t.acceptance ?? "")}`);
  }
}
async function cmdClaim([id, assignee]) {
  if (!id) { console.error("用法: claim <ticketId> [assignee]"); process.exit(1); }
  const r = await http(`${AC}/api/v1/growth/tickets/${encodeURIComponent(id)}/claim`, { method: "POST", body: JSON.stringify({ assignee: assignee ?? "cli-agent" }), headers: authHeader() });
  console.log(C.green(`✓ 已认领 ${id}`), C.dim(`status=${r.status} assignee=${r.assignee}`));
}
async function cmdGrow(args) {
  const q = args.filter((a) => !a.startsWith("--")).join(" ");
  if (!q) { console.error("用法: grow \"<问句>\" [--package <pkg>] [--rounds N]"); process.exit(1); }
  const pkg = argVal(args, "--package") ?? "pkg_battery_manufacturing";
  const rounds = Number(argVal(args, "--rounds") ?? 8);
  const r = await http(`${AC}/api/v1/growth/run`, { method: "POST", headers: authHeader(), body: JSON.stringify({ packageId: pkg, query: q, context: { view: argVal(args, "--view") ?? "dash", selectedObjects: [], filters: {} }, maxRounds: rounds }) });
  console.log(C.bold(`自成长运行：${r.terminalState}（${r.rounds?.length ?? 0} 轮 / K=${r.maxRounds}）`));
  for (const tk of r.openTickets ?? []) console.log(`  ${C.yellow("⚑ 工单")} ${tk.gapCode}: ${C.dim(tk.detail)}`);
}
function argVal(args, flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }

// ---- ask：提交 → SSE 流 → 渲染 → 多轮澄清 -----------------------------------
function renderBlocks(blocks = []) {
  for (const b of blocks) {
    if (b.type === "text") console.log("\n" + (b.markdown ?? ""));
    else if (b.type === "kpi") console.log(`  📊 ${C.bold(b.label)}: ${C.green(String(b.value))}${b.unit ? " " + b.unit : ""}`);
    else if (b.type === "table") {
      const cols = b.columns ?? []; const rows = b.rows ?? [];
      console.log("  " + cols.map((c) => C.bold(c)).join(" | "));
      for (const row of rows.slice(0, 50)) console.log("  " + row.map((v) => String(v ?? "")).join(" | "));
      if (rows.length > 50) console.log(C.dim(`  …(+${rows.length - 50} 行)`));
    } else if (b.type === "rule_violation") console.log(`  ${C.red("⚠ " + b.ruleId)} [${b.severity}] ${b.explanation}`);
    else if (b.type === "action_draft") console.log(`  📝 ${C.yellow("待审批草稿")} ${b.draftId} (${b.actionType}): ${b.summary}\n     → 执行：platform approve ${b.draftId}`);
  }
}

async function streamTask(taskId, rl) {
  const s = loadSession();
  const url = `${AC}/api/v1/queries/${encodeURIComponent(taskId)}/events?access_token=${encodeURIComponent(s.accessToken)}`;
  const res = await fetch(url, { headers: { accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
  const dec = new TextDecoder(); let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      let ev = "message", data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      let payload; try { payload = JSON.parse(data); } catch { continue; }
      const done = await onEvent(ev, payload, taskId, rl);
      if (done) return;
    }
  }
}

async function onEvent(ev, p, taskId, rl) {
  switch (ev) {
    case "task.accepted": console.log(C.dim("· 已接收，分类中…")); return false;
    case "routing.completed": console.log(C.dim(`· 路由：${p.path ?? p.route ?? ""} ${p.intentKey ? "意图=" + p.intentKey : ""}`)); return false;
    case "step.started": console.log(C.dim(`  ▸ ${p.stepId ?? p.type ?? "step"}`)); return false;
    case "step.completed": return false;
    case "clarification.required": {
      const slots = p.slots ?? p.missing ?? [];
      console.log(C.yellow(`? 需要补充：${slots.map((s) => s.name ?? s).join(", ")}`));
      const answers = {};
      for (const slot of slots) {
        const name = slot.name ?? slot;
        answers[name] = await rl.question(`  ${name}${slot.clarifyPrompt ? "（" + slot.clarifyPrompt + "）" : ""}: `);
      }
      await http(`${AC}/api/v1/queries/${encodeURIComponent(taskId)}/clarification`, { method: "POST", body: JSON.stringify({ slots: answers }), headers: authHeader() });
      console.log(C.dim("· 已补充，继续推演…"));
      return false;
    }
    case "answer.final": {
      console.log(C.green("\n══ 答案 ══") + C.dim(` (${p.trustLevel ?? ""})`));
      renderBlocks(p.blocks ?? p.answer?.blocks ?? []);
      return true;
    }
    case "task.failed": console.error(C.red(`✗ 失败：${p.error?.code ?? ""} ${p.error?.message ?? JSON.stringify(p)}`)); return true;
    case "task.cancelled": console.log(C.dim("· 已取消")); return true;
    default: return false;
  }
}

async function cmdAsk(args) {
  const flags = {}; const positional = [];
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[++i]; else positional.push(args[i]); }
  const query = positional.join(" ");
  if (!query) { console.error('用法: ask "<问句>" [--view risk] [--package <pkg>]'); process.exit(1); }
  const context = { view: flags.view ?? "risk", selectedObjects: [], filters: {} };
  const submit = await http(`${AC}/api/v1/queries`, { method: "POST", headers: authHeader(), body: JSON.stringify({ packageId: flags.package ?? PKG, query, context }) });
  console.log(C.dim(`task=${submit.taskId}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { await streamTask(submit.taskId, rl); } finally { rl.close(); }
}

// ---- A15.2/3：模块交互流 handler（复用同一 REST + R3/R4，与 GUI 平行同源）-----------------
function parseFlags(args) {
  const flags = {}; const pos = [];
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith("--")) flags[args[i].slice(2)] = (args[i + 1] && !args[i + 1].startsWith("--")) ? args[++i] : true; else pos.push(args[i]); }
  return { flags, pos };
}

// build：故事建域（FDE）；--mode PROVISIONAL 走未审核态；--json 供 agent 解析。
async function cmdBuild(args) {
  const { flags, pos } = parseFlags(args);
  const script = pos.join(" ");
  if (!script) { console.error('用法: build "<故事脚本>" [--seed 42] [--mode STRICT|PROVISIONAL] [--inference] [--json]'); process.exit(1); }
  const body = { script, ...(flags.seed ? { seed: Number(flags.seed) } : {}), ...(flags.mode ? { buildMode: flags.mode } : {}), ...(flags.inference ? { inference: true } : {}) };
  const r = await http(`${DC}/a/v1/databuilder/runs`, { method: "POST", headers: authHeader(), body: JSON.stringify(body) });
  if (flags.json) return console.log(JSON.stringify(r));
  console.log(`${r.status === "SUCCEEDED" ? C.green("✓") : C.yellow("◐")} 建域 ${r.status}  ${C.dim(r.id)}  buildMode=${r.buildMode ?? "STRICT"}${r.domainTrustLevel ? "/" + r.domainTrustLevel : ""}`);
  if (r.verification) console.log(`  终态验证：${r.verification.status}`);
  console.log(C.dim("  下一步：solve <求解器> / ask \"<问句>\" 验证真能答"));
}

// solve：调用既有求解器（A1）；--args '<json>'。
async function cmdSolve(args) {
  const { flags, pos } = parseFlags(args);
  const key = pos[0];
  if (!key) { console.error('用法: solve <solverKey> [--args \'{"baseId":"changzhou"}\'] [--json]；新增求解器见深链(do)'); process.exit(1); }
  let solverArgs = {}; try { solverArgs = flags.args ? JSON.parse(flags.args) : {}; } catch { console.error(C.red("--args 非合法 JSON")); process.exit(1); }
  const r = await http(`${DC}/a/v1/solvers/${encodeURIComponent(key)}/invoke`, { method: "POST", headers: authHeader(), body: JSON.stringify({ args: solverArgs }) });
  if (flags.json) return console.log(JSON.stringify(r));
  const prov = r.data?.__provisional;
  console.log(`${C.green("✓")} ${key}${prov ? C.yellow(` [未审核·${prov.trustLevel}·${prov.origin}]`) : ""}  snapshot=${r.snapshotVersion ?? "-"}`);
  console.log("  " + C.dim(JSON.stringify(r.data).slice(0, 300)));
}

// synth：合成数据作业。
async function cmdSynth(args) {
  const { flags, pos } = parseFlags(args);
  const industry = pos[0] ?? flags.industry;
  if (!industry) { console.error("用法: synth <industry> [--scale S|M|L] [--seed 42] [--json]"); process.exit(1); }
  const r = await http(`${DC}/a/v1/synthetic/jobs`, { method: "POST", headers: authHeader(), body: JSON.stringify({ industry, scale: flags.scale ?? "S", seed: flags.seed ? Number(flags.seed) : 42 }) });
  console.log(flags.json ? JSON.stringify(r) : `${C.green("✓")} 合成作业 ${r.status ?? "提交"}  ${C.dim(r.id ?? "")}`);
}

// types：对象/类型浏览（A4），按域分组计数。
async function cmdTypes(args) {
  const { flags } = parseFlags(args);
  const r = await http(`${DC}/a/v1/ontology/object-types/stats`, { headers: authHeader() });
  const stats = r.stats ?? [];
  if (flags.json) return console.log(JSON.stringify(stats));
  console.log(C.bold(`对象类型（${stats.length}）`));
  for (const s of stats.filter((x) => !flags.domain || x.domain === flags.domain)) console.log(`  ${C.cyan(s.key)} ${C.dim("[" + s.domain + "]")} 属性${s.propCount} 派生${s.derivedCount} 物化${s.count}`);
}

// generate：A18.2 LLM 临时求解器生成（缺求解器→生成+沙箱跑通+注册 PROVISIONAL）。
async function cmdGenerate(args) {
  const { flags, pos } = parseFlags(args);
  const key = pos[0]; const intent = pos.slice(1).join(" ") || flags.intent;
  if (!key || !intent) { console.error('用法: generate <solverKey> "<意图>"（LLM 临时求解器，沙箱跑通注册 PROVISIONAL）'); process.exit(1); }
  const r = await http(`${DC}/a/v1/solvers/generate`, { method: "POST", headers: authHeader(), body: JSON.stringify({ key, intent }) });
  console.log(flags.json ? JSON.stringify(r) : `${r.status === "PROVISIONAL" ? C.green("✓") : C.red("✗")} ${key} → ${r.status}${r.rejectReason ? " (" + r.rejectReason + ")" : C.yellow(" [未审核·" + r.trustLevel + "]")}`);
}

// shell：REPL，每行走 do 万能路由（人机共用）。
async function cmdShell() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(C.dim("platform shell — 输入自然语言（do 路由），exit 退出"));
  for (;;) {
    const line = (await rl.question(C.cyan("platform> "))).trim();
    if (!line || line === "exit" || line === "quit") break;
    try { await cmdDo([line]); } catch (e) { console.error(C.red("✗ " + (e?.message ?? e))); }
  }
  rl.close();
}

// ---- A15：do 万能路由（NL → operations/classify → QUERY 走 ask / OPERATION 路由模块）----------
async function cmdDo(args) {
  const json = args.includes("--json");
  const input = args.filter((a) => a !== "--json").join(" ");
  if (!input) { console.error('用法: do "<自然语言>" [--json]'); process.exit(1); }
  const cls = await http(`${AC}/b/v1/operations/classify`, { method: "POST", headers: authHeader(), body: JSON.stringify({ input }) });
  if (json) { console.log(JSON.stringify(cls)); return; }
  if (cls.kind === "QUERY") {
    console.log(C.dim("· 判为查询型 → 走 QOS ask"));
    return cmdAsk([input]);
  }
  // OPERATION：低置信/多候选 → 列候选不瞎猜
  if (cls.confidence < 0.6 && cls.candidates.length > 1) {
    console.log(C.dim("· 不确定，候选能力（请用对应子命令明确）："));
    for (const c of cls.candidates) console.log(`    ${c.op}  —  ${c.label}`);
    return;
  }
  console.log(`· 判为操作型：${C.dim(cls.op)}  →  ${cls.endpoint}${cls.r4 ? "  (经 R4 审批)" : ""}`);
  if (cls.requiredSlots?.length) console.log(C.dim(`  需补参：${cls.requiredSlots.join(", ")}（用 \`${cls.cliCommand ?? cls.op} …\` 子命令）`));
  if (cls.uiDeepLink) console.log(`  🔗 或在 GUI 完成：${DC.replace(/\/$/, "")}${cls.uiDeepLink}`);
  if (cls.cliCommand) console.log(C.dim(`  CLI 等价命令：${cls.cliCommand}`));
}

function help() {
  console.log(`平台对话式 CLI —— 一句话驱动整个平台（QOS 意图识别 + 权限路由 + 求解器/工作流/Agent）

  login <tenant> <user> <pass>     登录取 token（如 demo admin demo1234）
  do "<自然语言>" [--json]          万能入口：意图识别 → 查询走 ask / 操作路由模块（A15）
  shell                            REPL：每行走 do 万能路由（人机共用）
  ask "<问句>" [--view v]          提问 → 流式答案（含多轮澄清）
  build "<故事>" [--mode PROVISIONAL] 故事建域（FDE）；--mode 走未审核态
  solve <key> [--args '<json>']    调用既有求解器（A1）
  generate <key> "<意图>"          LLM 临时求解器（沙箱跑通注册 PROVISIONAL，A18.2）
  synth <industry> [--scale --seed] 合成数据作业
  types [--domain d]               对象/类型浏览（A4）
  scenarios / approve <id> / whoami / tickets / claim / grow
环境：DATACORE_URL / AGENTCORE_URL / PACKAGE_ID · --json 供 agent 解析`);
}

const [cmd, ...rest] = process.argv.slice(2);
const run = { login: cmdLogin, do: cmdDo, shell: cmdShell, ask: cmdAsk, build: cmdBuild, solve: cmdSolve, generate: cmdGenerate, synth: cmdSynth, types: cmdTypes, scenarios: cmdScenarios, approve: cmdApprove, whoami: cmdWhoami, tickets: cmdTickets, claim: cmdClaim, grow: cmdGrow };
(async () => {
  try {
    if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") return help();
    const fn = run[cmd];
    if (!fn) { console.error(C.red(`未知命令: ${cmd}`)); help(); process.exit(1); }
    await fn(rest);
  } catch (e) { console.error(C.red("✗ " + (e?.message ?? e))); process.exit(1); }
})();
