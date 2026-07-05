#!/usr/bin/env node
// 协同工作队列 CLI（reviewer↔dev 共享·单一机器可读来源 docs/work-queue.json）。
// 用法:
//   node scripts/collab-queue.mjs show                 # 渲染表
//   node scripts/collab-queue.mjs next-dev             # dev 下一个该做的(先BLOCKED再TODO·按优先级·deps满足)
//   node scripts/collab-queue.mjs next-review          # reviewer 待复验的(BUILT)
//   node scripts/collab-queue.mjs claim <id> <owner>   # TODO→WIP
//   node scripts/collab-queue.mjs built <id>           # WIP/BLOCKED→BUILT
//   node scripts/collab-queue.mjs done  <id>           # BUILT→DONE
//   node scripts/collab-queue.mjs block <id> <reason…> # BUILT→BLOCKED(带原因)
//   node scripts/collab-queue.mjs health               # LOOP 体检: 陈旧WIP/积压BUILT/对侧心跳(exit 1=有病灶)
//   node scripts/collab-queue.mjs sweep                # 自动释放陈旧WIP(>24h无该单相关提交·记半程锚点)
// 每次改一行·调用方负责 fetch/rebase/commit/push（避免格式漂移·冲突走 rebase 重试）。
// 防死锁机制(2026-07-05 SANDBOX peer失联2.5天复盘): 每个状态迁移盖 at 时间戳+meta.lastActivity 心跳;
// health/sweep 以「该单最后相关 git 提交」为失联判据(回合制会话无进程心跳·提交即心跳)。
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const QUEUE = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "work-queue.json");
const PRIO = { P0: 0, P1: 1, P2: 2, P3: 3 };
const STALE_WIP_H = Number(process.env.STALE_WIP_H || 24);    // WIP 失联阈(h)·env 可调(齿检/运维)
const STALE_BUILT_H = Number(process.env.STALE_BUILT_H || 2); // BUILT 积压阈(h)·超则提示升级激活审核方
const load = () => JSON.parse(readFileSync(QUEUE, "utf8"));
const save = (q) => writeFileSync(QUEUE, JSON.stringify(q, null, 2) + "\n");
const find = (q, id) => q.items.find((x) => x.id === id);
const depsDone = (q, it) => (it.deps || []).every((d) => (find(q, d)?.status ?? "DONE") === "DONE");
const hoursAgo = (iso) => iso ? (Date.now() - Date.parse(iso)) / 36e5 : Infinity;
/** 审核方/队列管理类提交前缀——不算 owner 心跳(否则复验/仲裁提到该 id 会误续命·齿检抓出的真 bug)。 */
const REVIEWER_SUBJECT = /^(复验|仲裁|入队|merge: 收编|docs\(debt\)|docs\(coord\)|chore\(prd\)|chore\(queue\): .*(done|DONE|释放|sweep))/;
/** 该单最后**施工侧**相关提交(id 在 message 且非审核方前缀)·回合制会话的"心跳"。返回 {sha, iso} 或 null。 */
function lastCommitFor(id) {
  try {
    const out = execSync(`git log --all -15 --format="%H\t%cI\t%s" --grep="${id}"`, { cwd: dirname(QUEUE), encoding: "utf8" }).trim();
    if (!out) return null;
    for (const line of out.split("\n")) {
      const [sha, iso, ...rest] = line.split("\t");
      const subject = rest.join("\t");
      if (REVIEWER_SUBJECT.test(subject)) continue;
      return { sha: sha.slice(0, 7), iso };
    }
    return null;
  } catch { return null; }
}

const [, , cmd, ...args] = process.argv;
const q = load();
const bySort = (a, b) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9) || a.id.localeCompare(b.id);

function set(id, status, patch = {}, role = "dev") {
  const it = find(q, id);
  if (!it) { console.error(`NO_SUCH_ID ${id}`); process.exit(2); }
  it.status = status;
  Object.assign(it, patch);
  // 心跳/审计戳: 每次迁移记 who/when(工具层时间戳·非产品 R6 范畴)
  it.at = it.at || {};
  it.at[status.toLowerCase()] = new Date().toISOString();
  q.meta = q.meta || {};
  q.meta.lastActivity = { role, cmd: status, id, at: new Date().toISOString() };
  save(q);
  console.log(`OK ${id} → ${status}${patch.note ? " ("+patch.note+")" : ""}`);
}

switch (cmd) {
  case "show": {
    const w = Math.max(...q.items.map((i) => i.id.length));
    for (const s of ["BLOCKED", "BUILT", "WIP", "TODO", "DONE"])
      for (const it of q.items.filter((i) => i.status === s).sort(bySort))
        console.log(`${it.status.padEnd(7)} ${it.priority} ${it.id.padEnd(w)}  ${it.title}${it.note ? "  ·"+it.note : ""}`);
    break;
  }
  case "next-dev": {
    const blocked = q.items.filter((i) => i.status === "BLOCKED").sort(bySort);
    const todo = q.items.filter((i) => i.status === "TODO" && depsDone(q, i)).sort(bySort);
    const pick = blocked[0] || todo[0];
    if (!pick) { console.log("NONE — 无可开工项(全 WIP/BUILT/DONE 或 deps 未满足)"); break; }
    console.log(`${pick.status === "BLOCKED" ? "FIX" : "BUILD"} ${pick.id}\ndoc: ${pick.doc}\ntitle: ${pick.title}\n${pick.note ? "note: "+pick.note+"\n" : ""}${pick.status === "BLOCKED" ? "blocked_reason: "+(pick.blockReason||"")+"\n" : ""}→ claim: node scripts/collab-queue.mjs claim ${pick.id} dev`);
    break;
  }
  case "next-review": {
    const built = q.items.filter((i) => i.status === "BUILT").sort(bySort);
    if (!built.length) { console.log("NONE — 无待复验(BUILT)项"); break; }
    for (const it of built) console.log(`REVIEW ${it.id}  doc:${it.doc}  ${it.title}  owner:${it.owner||"?"}`);
    break;
  }
  case "claim": set(args[0], "WIP", { owner: args[1] || "dev" }, args[1] || "dev"); break;
  case "built": set(args[0], "BUILT", { blockReason: "" }, "dev"); break;
  case "done":  set(args[0], "DONE", {}, "review"); break;
  case "block": set(args[0], "BLOCKED", { blockReason: args.slice(1).join(" ") }, "review"); break;
  case "health": {
    // LOOP 体检: ①陈旧WIP(失联判据=该单最后相关提交>24h) ②积压BUILT(>2h无裁决) ③对侧心跳。exit 1=有病灶。
    let sick = 0;
    const wip = q.items.filter((i) => i.status === "WIP");
    for (const it of wip) {
      const c = lastCommitFor(it.id);
      const h = c ? hoursAgo(c.iso) : hoursAgo(it.at?.wip);
      const stale = h > STALE_WIP_H;
      if (stale) sick++;
      console.log(`${stale ? "✗ STALE-WIP" : "· WIP"}  ${it.id}  owner:${it.owner||"?"}  最后相关提交:${c ? c.sha+" "+Math.round(h)+"h前" : "无(按claim时间"+(isFinite(hoursAgo(it.at?.wip))?Math.round(hoursAgo(it.at?.wip))+"h":"未知")+")"}${stale ? "  → 建议 sweep 释放" : ""}`);
    }
    const built = q.items.filter((i) => i.status === "BUILT");
    for (const it of built) {
      const h = hoursAgo(it.at?.built);
      const old = h > STALE_BUILT_H;
      if (old) sick++;
      console.log(`${old ? "✗ 积压BUILT" : "· BUILT"} ${it.id}  等裁决:${isFinite(h)?Math.round(h)+"h":"未知"}${old ? "  → 升级:提醒用户激活审核方" : ""}`);
    }
    const la = q.meta?.lastActivity;
    console.log(`· 最后队列活动: ${la ? la.role+" "+la.cmd+" "+la.id+" ("+Math.round(hoursAgo(la.at))+"h前)" : "无记录"}`);
    console.log(sick ? `✗ health: ${sick} 处病灶` : "✓ health: 无陈旧WIP·无积压BUILT");
    process.exit(sick ? 1 : 0);
  }
  case "sweep": {
    // 自动释放陈旧 WIP(>24h 无该单相关提交)·note 记半程锚点·任何在场 dev 可续做(COORD §6)。
    let n = 0;
    for (const it of q.items.filter((i) => i.status === "WIP")) {
      const c = lastCommitFor(it.id);
      const h = c ? hoursAgo(c.iso) : hoursAgo(it.at?.wip);
      if (h <= STALE_WIP_H) continue;
      const anchor = c ? `半程锚点 ${c.sha}(${c.iso.slice(0,16)})·续做基于其上勿重启` : "无半程提交·可全新开工";
      it.status = "TODO"; const prevOwner = it.owner; it.owner = "";
      it.note = (it.note || "") + ` 【sweep 自动释放 ${new Date().toISOString().slice(0,16)}】原owner ${prevOwner||"?"} 失联${Math.round(h)}h·${anchor}。`;
      it.at = it.at || {}; it.at.swept = new Date().toISOString();
      console.log(`SWEEP ${it.id}: WIP→TODO (失联${Math.round(h)}h·${anchor})`);
      n++;
    }
    if (n) { q.meta = q.meta || {}; q.meta.lastActivity = { role: "review", cmd: "SWEEP", id: `${n}项`, at: new Date().toISOString() }; save(q); }
    console.log(n ? `OK 释放 ${n} 项` : "无陈旧WIP可释放");
    break;
  }
  default:
    console.log("cmds: show | next-dev | next-review | claim <id> <owner> | built <id> | done <id> | block <id> <reason> | health | sweep");
}
