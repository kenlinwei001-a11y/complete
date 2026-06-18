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

function help() {
  console.log(`平台对话式 CLI —— 一句话驱动整个平台（QOS 意图识别 + 权限路由 + 求解器/工作流/Agent）

  login <tenant> <user> <pass>     登录取 token（如 demo admin demo1234）
  ask "<问句>" [--view v] [--package p]   提问 → 流式答案（含多轮澄清）
  scenarios                        列可用场景
  approve <draftId>                审批写操作草稿
  whoami                           当前身份
环境：DATACORE_URL / AGENTCORE_URL / PACKAGE_ID`);
}

const [cmd, ...rest] = process.argv.slice(2);
const run = { login: cmdLogin, ask: cmdAsk, scenarios: cmdScenarios, approve: cmdApprove, whoami: cmdWhoami, tickets: cmdTickets, claim: cmdClaim, grow: cmdGrow };
(async () => {
  try {
    if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") return help();
    const fn = run[cmd];
    if (!fn) { console.error(C.red(`未知命令: ${cmd}`)); help(); process.exit(1); }
    await fn(rest);
  } catch (e) { console.error(C.red("✗ " + (e?.message ?? e))); process.exit(1); }
})();
