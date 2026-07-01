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
// 每次改一行·调用方负责 fetch/rebase/commit/push（避免格式漂移·冲突走 rebase 重试）。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const QUEUE = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "work-queue.json");
const PRIO = { P0: 0, P1: 1, P2: 2, P3: 3 };
const load = () => JSON.parse(readFileSync(QUEUE, "utf8"));
const save = (q) => writeFileSync(QUEUE, JSON.stringify(q, null, 2) + "\n");
const find = (q, id) => q.items.find((x) => x.id === id);
const depsDone = (q, it) => (it.deps || []).every((d) => (find(q, d)?.status ?? "DONE") === "DONE");

const [, , cmd, ...args] = process.argv;
const q = load();
const bySort = (a, b) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9) || a.id.localeCompare(b.id);

function set(id, status, patch = {}) {
  const it = find(q, id);
  if (!it) { console.error(`NO_SUCH_ID ${id}`); process.exit(2); }
  it.status = status;
  Object.assign(it, patch);
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
  case "claim": set(args[0], "WIP", { owner: args[1] || "dev" }); break;
  case "built": set(args[0], "BUILT", { blockReason: "" }); break;
  case "done":  set(args[0], "DONE"); break;
  case "block": set(args[0], "BLOCKED", { blockReason: args.slice(1).join(" ") }); break;
  default:
    console.log("cmds: show | next-dev | next-review | claim <id> <owner> | built <id> | done <id> | block <id> <reason>");
}
