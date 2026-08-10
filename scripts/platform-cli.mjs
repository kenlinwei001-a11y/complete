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

async function cmdScenarios(args = []) {
  const [sub, key, ...rest] = args;
  if (sub === "launch") {
    if (!key) { console.error("用法: scenarios launch <sNo> [--query '<自定义问句>']"); process.exit(1); }
    const query = argVal(rest, "--query");
    const body = query ? JSON.stringify({ query }) : "{}";
    const r = await http(`${AC}/b/v1/scenarios/${encodeURIComponent(key)}/launch`, { method: "POST", headers: authHeader(), body });
    console.log(C.bold(`启动场景 ${r.scenario ?? key}`), C.dim(`taskId=${r.taskId} query=${r.query ?? ""}`));
    return;
  }
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

// ---- sim：推演沙盘（G-11·暗发 entitlement，关=404）；行业无关，state 为抽象 objectId→stateVar→number ----
async function cmdSim(args) {
  const [sub, ...rest] = args;
  const SIM = `${DC}/a/v1/sim`;
  const J = (b) => ({ method: "POST", headers: authHeader(), body: JSON.stringify(b) });
  try {
    if (sub === "init") {
      const state = JSON.parse(argVal(rest, "--state") ?? "{}");
      const r = await http(`${SIM}/sessions`, J({ baseSnapshot: state, scope: JSON.parse(argVal(rest, "--scope") ?? "{}") }));
      console.log(C.bold(`会话 ${r.id}`) + ` status=${r.status} tick=${r.curTick}`); return;
    }
    const id = rest.find((a) => !a.startsWith("--"));
    if (sub === "tick") { const r = await http(`${SIM}/sessions/${id}/tick`, J({ n: Number(argVal(rest, "--n") ?? 1) })); console.log(`tick=${r.curTick} state=${JSON.stringify(r.state)}`); return; }
    if (sub === "act") { const r = await http(`${SIM}/sessions/${id}/act`, J({ objectId: argVal(rest, "--obj"), stateVar: argVal(rest, "--var"), value: Number(argVal(rest, "--val")) })); console.log(`act@tick${r.curTick} state=${JSON.stringify(r.state)}`); return; }
    if (sub === "checkpoint") { const r = await http(`${SIM}/sessions/${id}/checkpoint`, J({ label: argVal(rest, "--label") })); console.log(C.bold(`检查点 ${r.id}`) + ` @tick${r.tick} "${r.label}"`); return; }
    if (sub === "rollback") { const r = await http(`${SIM}/sessions/${id}/rollback`, J({ checkpointId: argVal(rest, "--cp") })); console.log(`已回滚 → tick=${r.curTick}`); return; }
    if (sub === "branch") { const r = await http(`${SIM}/sessions/${id}/branch`, J({ checkpointId: argVal(rest, "--cp") })); console.log(C.bold(`分支会话 ${r.id}`) + ` parentCp=${r.parentCheckpointId}`); return; }
    if (sub === "compare") {
      const r = await http(`${SIM}/compare?a=${argVal(rest, "--a")}&b=${argVal(rest, "--b")}`, { headers: authHeader() });
      const aEnd = r.a.at(-1)?.state ?? {}, bEnd = r.b.at(-1)?.state ?? {};
      console.log(C.bold(`沙盘对比`) + ` A:${r.a.length} ticks · B:${r.b.length} ticks`);
      // 评审遗留·人体工学：逐对象·状态变量列出**分歧**（A vs B 末态差异），而非整块 JSON。
      const keys = [...new Set([...Object.keys(aEnd), ...Object.keys(bEnd)])].sort();
      let diverged = 0;
      for (const obj of keys) {
        const vars = [...new Set([...Object.keys(aEnd[obj] ?? {}), ...Object.keys(bEnd[obj] ?? {})])].sort();
        for (const v of vars) {
          const av = aEnd[obj]?.[v], bv = bEnd[obj]?.[v];
          if (av !== bv) { console.log(`  ${C.yellow("Δ")} ${obj}.${v}: A=${C.cyan(String(av ?? "—"))} vs B=${C.cyan(String(bv ?? "—"))}`); diverged++; }
        }
      }
      console.log(diverged ? C.dim(`  共 ${diverged} 处分歧`) : C.dim("  两分支末态一致（无分歧）"));
      return;
    }
    if (sub === "world") { const r = await http(`${SIM}/sessions/${id}/world`, { headers: authHeader() }); console.log(`tick=${r.tick} state=${JSON.stringify(r.state)}`); return; }
    if (sub === "ls") { const r = await http(`${SIM}/sessions`, { headers: authHeader() }); for (const s of r.items ?? []) console.log(`  ${s.id} status=${s.status} tick=${s.curTick}`); return; }
    if (sub === "rule") { const r = await http(`${SIM}/propagation-rules`, J(JSON.parse(rest.join(" ")))); console.log(C.bold(`传导规则 ${r.key}`) + ` ${r.sourceTypeKey}.${r.sourceStateVar} --${r.viaLinkKey} ${r.coefficient}--> ${r.targetTypeKey}.${r.targetStateVar}`); return; }
    if (sub === "certify") {
      // 就绪认证 L0-L4（投影既有 closure，零新校验）。
      const scope = (argVal(rest, "--scope") ?? "GLOBAL").toUpperCase();
      const target = argVal(rest, "--target");
      const qs = `scope=${scope}${target ? `&target=${encodeURIComponent(target)}` : ""}`;
      const r = await http(`${SIM}/sessions/${id}/certification?${qs}`, { headers: authHeader() });
      const lvlColor = r.canEnterSimulation ? C.green : C.yellow;
      console.log(C.bold(`就绪认证 ${r.scope}${r.targetRef ? `:${r.targetRef}` : ""}`) + ` → ${lvlColor(r.level)}`);
      console.log(`  三维：结构 ${r.dims.structure} · 知识 ${r.dims.knowledge} · 行为 ${r.dims.behavior} · 综合 ${C.bold(r.dims.composite)}/100`);
      console.log(`  L4 三元组：扇出安全=${r.l4Checks.fanoutSafe} · writeback=${r.l4Checks.writebackComplete} · 可观测=${r.l4Checks.observabilityMet}`);
      // WO-CERT-HONESTY ③：原文「触发 N 条规则（传导待增量3）」两处失真 —— 空跑一条都没触发，
      // 而传导核早已实装、只是这条路没调它。改成实测口径。
      console.log(
        `  Trial Tick：${r.trialTick.passed ? C.green("PASS=重算未抛异常") : C.red("FAIL")} 派生图节点 ${r.trialTick.derivationNodes} 个${r.trialTick.error ? ` (${r.trialTick.error})` : ""}` +
          C.dim(r.trialTick.propagationCovered ? "（含传导空跑）" : "（传导未纳入本次空跑）"),
      );
      console.log(`  世界完整度：${r.worldCompleteness.pct}% · 将进入沙盘 ${r.worldCompleteness.entering.length} 个要素（派生/行动/传导混装）`);
      console.log(`  ${r.canEnterSimulation ? C.green("✓ 可进入推演") : C.red("✗ 不可进入推演")}（缺件 ${r.gaps.length} 个）`);
      for (const g of r.gaps.slice(0, 20)) console.log(C.dim(`    - [${g.gapCode}] ${g.ref}: ${g.detail}`));
      return;
    }
    if (sub === "precheck") {
      // init step③ 范围预检：世界完整度 + 将进入沙盘清单。
      const scope = (argVal(rest, "--scope") ?? "GLOBAL").toUpperCase();
      const target = argVal(rest, "--target");
      const qs = `scope=${scope}${target ? `&target=${encodeURIComponent(target)}` : ""}`;
      const r = await http(`${SIM}/sessions/${id}/scope-precheck?${qs}`, { headers: authHeader() });
      const w = r.worldCompleteness;
      console.log(C.bold(`范围预检 ${r.scope}${r.targetRef ? `:${r.targetRef}` : ""}`) + ` 世界完整度 ${C.bold(w.pct)}%`);
      // WO-CERT-HONESTY ①：原首项「状态变量 N/M」与「派生 N/M」恒等（后端同一变量/同一表达式），已删；
      // 真正的状态变量改列名字（stateVarKeys = 传导规则 source/target stateVar 去重集，无 needed 承载物）。
      console.log(`  派生 ${w.derivationRules.present}/${w.derivationRules.needed} · 动作 ${w.actions.present}/${w.actions.needed} · 传导 ${w.propagationRules.present}/${w.propagationRules.needed}`);
      console.log(`  世界将承载的状态变量 ${w.stateVarKeys.length} 个${w.stateVarKeys.length ? `：${w.stateVarKeys.join(" · ")}` : ""}`);
      for (const e of w.entering.slice(0, 30)) console.log(C.dim(`    ${e.key} [${e.kind}] ← ${e.source}`));
      console.log(`  ${r.canEnterSimulation ? C.green("✓ 可进入推演") : C.yellow("· 仍有缺口")}（缺件 ${r.gaps.length} 个）`);
      return;
    }
    console.error('用法: sim init|tick|act|checkpoint|rollback|branch|compare|world|ls|rule|certify|precheck …'); process.exit(1);
  } catch (e) { console.error(C.red(`sim ${sub} 失败: ${e.message}`)); process.exit(1); }
}

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

// import：上传文件（CSV/JSON）→ 连接器 + RawDataset（A11 category 可选）。下一步提示 model。
async function cmdImport(args) {
  const { flags, pos } = parseFlags(args);
  const file = pos[0];
  if (!file || !existsSync(file)) { console.error("用法: import <file.csv|json> [--category ERP] [--json]"); process.exit(1); }
  const content = readFileSync(file);
  const r = await http(`${DC}/a/v1/uploads`, { method: "POST", headers: authHeader(), body: JSON.stringify({ filename: file.split("/").pop(), contentBase64: content.toString("base64"), ...(flags.category ? { category: flags.category } : {}) }) });
  if (flags.json) return console.log(JSON.stringify(r));
  console.log(`${C.green("✓")} 已上传 ${C.dim(r.connId)} 数据集=${r.datasetName}  行=${r.schema?.datasets?.[0]?.rowCount ?? "?"}`);
  console.log(C.dim(`  下一步：model ${r.connId}（数据→本体草稿）`));
}

// model：选 RawDataset → 半自动建模派生本体草稿（R12 字段覆盖）。下一步提示 approve/publish。
async function cmdModel(args) {
  const { flags, pos } = parseFlags(args);
  if (pos.length === 0) { console.error("用法: model <rawDatasetId...> [--json]"); process.exit(1); }
  const r = await http(`${DC}/a/v1/modeling/derive`, { method: "POST", headers: authHeader(), body: JSON.stringify({ rawDatasetIds: pos }) });
  if (flags.json) return console.log(JSON.stringify(r));
  console.log(`${C.green("✓")} 本体草稿 ${C.dim(r.draftId)} 状态=${r.status}`);
  console.log(C.dim("  下一步：在 GUI 建模页发布(R4) 或 approve <draftId>；覆盖率 GET /modeling/drafts/:id/coverage"));
}

// rule：建规则（DSL 表达式）；默认 DRAFT，--publish 走发布。
async function cmdRule(args) {
  const { flags, pos } = parseFlags(args);
  const expression = pos.join(" ");
  if (!expression || !flags.key || !flags.scope) { console.error('用法: rule "<DSL 表达式>" --key C99 --name "<名>" --scope Order [--severity WARN] [--publish]'); process.exit(1); }
  const created = await http(`${DC}/a/v1/rules`, { method: "POST", headers: authHeader(), body: JSON.stringify({ key: flags.key, name: flags.name ?? flags.key, expression, scopeObjectTypes: String(flags.scope).split(","), severity: flags.severity ?? "WARN" }) });
  console.log(`${C.green("✓")} 规则 ${created.key ?? flags.key} 已建（DRAFT）`);
  if (flags.publish && created.id) { await http(`${DC}/a/v1/rules/${created.id}/publish`, { method: "POST", headers: authHeader() }); console.log(C.green("  ✓ 已发布（R4）")); }
  else console.log(C.dim("  下一步：rule publish 或 GUI 审批生效"));
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

// opt：轨B·增量1 抽象优化模板池（CP-SAT 可证最优）。CLI 先于 UI（R15）。
//   opt templates                                     列模板族（gated opt.solver-pool）
//   opt solve <family> --args '{...}' [--json]        绑定→CP-SAT 求最优（贴 status/objective）
async function cmdOpt(args) {
  const { flags, pos } = parseFlags(args);
  const sub = pos[0];
  if (sub === "templates") {
    const r = await http(`${DC}/a/v1/opt/templates`, { headers: authHeader() });
    return console.log(flags.json ? JSON.stringify(r) : `${C.green("✓")} 模板族: ${(r.families ?? []).join(", ")}`);
  }
  if (sub === "solve") {
    const family = pos[1];
    if (!family) { console.error("用法: opt solve <family> [--args '{...}' | --binding '{...}'] [--json]；family ∈ facility_location|min_cost_flow|set_cover|independent_set|combinatorial_auction"); process.exit(1); }
    // 增量1：--args 直接给抽象结构化数组；增量2：--binding 给 OntologyBinding（role→本体类型/属性，R14）。
    let payload = { family };
    if (flags.binding) { try { payload.binding = JSON.parse(flags.binding); } catch { console.error(C.red("--binding 非合法 JSON")); process.exit(1); } }
    else { try { payload.args = flags.args ? JSON.parse(flags.args) : {}; } catch { console.error(C.red("--args 非合法 JSON")); process.exit(1); } }
    const r = await http(`${DC}/a/v1/opt/solve`, { method: "POST", headers: authHeader(), body: JSON.stringify(payload) });
    if (flags.json) return console.log(JSON.stringify(r));
    const d = r.data ?? r;
    console.log(`${C.green("✓")} ${family}  status=${d.status} optimal=${d.optimal} objective=${d.objective}`);
    console.log("  " + C.dim((d.summary ?? JSON.stringify(d)).slice(0, 400)));
    return;
  }
  if (sub === "retrieve") {
    const need = flags.need ?? pos.slice(1).join(" ");
    if (!need) { console.error("用法: opt retrieve --need \"选址类需求\" [--json]"); process.exit(1); }
    const r = await http(`${DC}/a/v1/opt/retrieve?need=${encodeURIComponent(need)}`, { headers: authHeader() });
    if (flags.json) return console.log(JSON.stringify(r));
    console.log(`${C.green("✓")} mode=${r.mode}${r.coverageGap ? C.yellow(" [覆盖缺口]") : ""}  ${C.dim(r.note ?? "")}`);
    for (const c of r.candidates ?? []) console.log(`  · ${c.key}${c.score !== undefined ? "  " + C.dim("score=" + c.score) : ""}`);
    return;
  }
  if (sub === "whatif") {
    const family = pos[1];
    if (!family) { console.error("用法: opt whatif <family> --perturbations '[{...}]' [--args|--binding '{...}'] [--json]"); process.exit(1); }
    let perturbations = []; try { perturbations = flags.perturbations ? JSON.parse(flags.perturbations) : []; } catch { console.error(C.red("--perturbations 非合法 JSON")); process.exit(1); }
    const payload = { family, perturbations };
    if (flags.binding) { try { payload.binding = JSON.parse(flags.binding); } catch { console.error(C.red("--binding 非合法 JSON")); process.exit(1); } }
    else if (flags.args) { try { payload.args = JSON.parse(flags.args); } catch { console.error(C.red("--args 非合法 JSON")); process.exit(1); } }
    const r = await http(`${DC}/a/v1/opt/whatif`, { method: "POST", headers: authHeader(), body: JSON.stringify(payload) });
    if (flags.json) return console.log(JSON.stringify(r));
    const d = r.data ?? r;
    console.log(`${C.green("✓")} ${family} what-if  baseline=${d.baselineObjective} perturbed=${d.perturbedObjective} Δ=${d.deltaObjective} feasible=${d.feasible}`);
    if (!d.feasible) console.log("  " + C.yellow("冲突约束: " + (d.conflictConstraints || []).join(", ")));
    console.log("  " + C.dim((d.explanation ?? "").slice(0, 400)));
    return;
  }
  console.error("用法: opt <templates|solve|whatif|retrieve> …（solve <family> [--args|--binding]；whatif <family> --perturbations；retrieve --need）"); process.exit(1);
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

// resources：WO-DRIL-P1 · Resource Registry 一次发现全量资源（R15 CLI 对等）。
async function cmdResources(args) {
  const { flags, pos } = parseFlags(args);
  // 详情：resources <kind> <key>
  if (pos.length >= 2) {
    const r = await http(`${AC}/b/v1/resources/${encodeURIComponent(pos[0])}/${encodeURIComponent(pos[1])}`, { headers: authHeader() });
    return console.log(flags.json ? JSON.stringify(r) : `${C.cyan(r.kind + "/" + r.key)} ${C.bold(r.label)}\n  ${C.dim(r.description)}`);
  }
  const qs = [];
  if (flags.kind) qs.push(`kind=${encodeURIComponent(flags.kind)}`);
  if (flags.tag) qs.push(`tag=${encodeURIComponent(flags.tag)}`);
  const r = await http(`${AC}/b/v1/resources${qs.length ? "?" + qs.join("&") : ""}`, { headers: authHeader() });
  const items = r.items ?? [];
  if (flags.json) return console.log(JSON.stringify(items));
  const byKind = {};
  for (const it of items) (byKind[it.kind] ??= []).push(it);
  console.log(C.bold(`智能资源注册表（${r.total ?? items.length}，${Object.keys(byKind).length} 类）`));
  for (const kind of Object.keys(byKind).sort()) {
    console.log(C.yellow(`  [${kind}] ${byKind[kind].length}`));
    for (const it of byKind[kind]) console.log(`    ${C.cyan(it.key)} ${it.label}  ${C.dim((it.description ?? "").slice(0, 60))}`);
  }
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

// ontology-query：WO-Phase3-B §3.5 本体查询引擎 CLI 对等（R15）。复用同一 REST（/a/v1/solvers/ontology_query/invoke）+R3+R4。
//   ontology-query --input '{"rootType":"Base","rootFilter":[{"field":"name","op":"eq","value":"常州"}],"select":[{"type":"Order","fields":["so","qty","due"]}]}'
//   ontology-query "常州基地关联哪些订单"        （NL advisory → nl-to-query → 引擎确定性执行；无法映射诚实报 NO_QUERY_PLAN）
async function cmdOntologyQuery(args) {
  const { flags, pos } = parseFlags(args);
  let payload;
  if (flags.input) {
    try { payload = JSON.parse(flags.input); } catch { console.error(C.red("--input 非合法 JSON")); process.exit(1); }
  } else if (pos[0]) {
    payload = { nl: pos.join(" ") }; // NL advisory 入口
  } else {
    console.error('用法: ontology-query --input \'{"rootType":...,"select":[...]}\'  或  ontology-query "<自然语言>" [--json]');
    process.exit(1);
  }
  const r = await http(`${DC}/a/v1/solvers/ontology_query/invoke`, { method: "POST", headers: authHeader(), body: JSON.stringify({ args: payload }) });
  if (flags.json) return console.log(JSON.stringify(r));
  const d = r.data ?? {};
  console.log(`${C.green("✓")} ontology_query  rows=${(d.rows ?? []).length}  cols=[${(d.columns ?? []).join(", ")}]  snapshot=${r.snapshotVersion ?? "-"}`);
  if (d.queryPlan) console.log("  " + C.dim(`plan: hops=${(d.queryPlan.hops ?? []).map((h) => h.linkKey + ":" + h.direction).join(" → ") || "(root)"}  slices=[${(d.queryPlan.usedSliceKeys ?? []).join(",")}]  agg=[${(d.queryPlan.aggregation ?? []).join(",")}]`));
  for (const row of (d.rows ?? []).slice(0, 10)) console.log("  " + C.dim(JSON.stringify(row)));
  if ((d.rows ?? []).length > 10) console.log("  " + C.dim(`… 共 ${d.rows.length} 行`));
  if (d.deltas?.length) console.log("  " + C.yellow(`what-if before/after: ${d.deltas.length} 项`));
}

function help() {
  console.log(`平台对话式 CLI —— 一句话驱动整个平台（QOS 意图识别 + 权限路由 + 求解器/工作流/Agent）

  login <tenant> <user> <pass>     登录取 token（如 demo admin demo1234）
  do "<自然语言>" [--json]          万能入口：意图识别 → 查询走 ask / 操作路由模块（A15）
  shell                            REPL：每行走 do 万能路由（人机共用）
  ask "<问句>" [--view v]          提问 → 流式答案（含多轮澄清）
  build "<故事>" [--mode PROVISIONAL] 故事建域（FDE）；--mode 走未审核态
  solve <key> [--args '<json>']    调用既有求解器（A1）
  ontology-query --input '<json>' | "<自然语言>"  本体多跳遍历查询（planSlice+executeSlice+简单聚合·R15 对等）
  generate <key> "<意图>"          LLM 临时求解器（沙箱跑通注册 PROVISIONAL，A18.2）
  synth <industry> [--scale --seed] 合成数据作业
  types [--domain d]               对象/类型浏览（A4）
  resources [--kind k --tag t] | <kind> <key>  智能资源注册表：一次发现全量资源（DRIL·R15 对等）
  scenarios / approve <id> / whoami / tickets / claim / grow
环境：DATACORE_URL / AGENTCORE_URL / PACKAGE_ID · --json 供 agent 解析`);
}

const [cmd, ...rest] = process.argv.slice(2);
const run = { login: cmdLogin, do: cmdDo, shell: cmdShell, ask: cmdAsk, import: cmdImport, model: cmdModel, rule: cmdRule, build: cmdBuild, solve: cmdSolve, opt: cmdOpt, "ontology-query": cmdOntologyQuery, generate: cmdGenerate, synth: cmdSynth, types: cmdTypes, resources: cmdResources, scenarios: cmdScenarios, approve: cmdApprove, whoami: cmdWhoami, tickets: cmdTickets, claim: cmdClaim, grow: cmdGrow, sim: cmdSim };
(async () => {
  try {
    if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") return help();
    const fn = run[cmd];
    if (!fn) { console.error(C.red(`未知命令: ${cmd}`)); help(); process.exit(1); }
    await fn(rest);
  } catch (e) { console.error(C.red("✗ " + (e?.message ?? e))); process.exit(1); }
})();
