#!/usr/bin/env node
// queue-integrity:check — 检测 docs/work-queue.json「旧基线覆盖」clobber（2026-07-11 立·根治共编队列老毛病）。
// 判据：某单**当前状态 rank < 它历史曾达的最高 rank**，且**没有任何提及本单 id 的提交把它设成当前(低)状态**
//   → 该低状态是被「不提本单、却带旧基线全文」的提交覆盖出来的 = clobber → 红。
// 合法降级（有意）总有一条提及本单 id 的提交（审核方 BLOCK、sweep 释放、显式 reopen）→ 不判红。
// BLOCKED 不参与 rank 比较（审核方动作）。修法：审核方核实后恢复；collab-queue 现已原子写防复发。
import { execSync } from "node:child_process";
const RANK = { TODO: 0, OPEN: 0, WIP: 1, BUILT: 2, DONE: 3 };
const N = Number(process.env.QUEUE_INTEGRITY_N || 30);
const sh = (c) => execSync(c, { encoding: "utf8" }).trim();
const _cache = {};
const itemsAt = (sha) => (sha in _cache ? _cache[sha] : (_cache[sha] = (() => {
  try { return JSON.parse(sh(`git show ${sha}:docs/work-queue.json`)).items || []; } catch { return null; }
})()));

const lines = sh(`git log -${N} --format=%H%x1f%s -- docs/work-queue.json`).split("\n").filter(Boolean).reverse(); // 旧→新
if (lines.length < 2) { console.log("✓ queue-integrity:check 跳过（历史提交不足）"); process.exit(0); }

const maxRank = new Map();          // id → 历史曾达最高 rank
const intentional = new Map();      // id → Set(在「提及本单 id」的提交里本单被设成的 rank)
const everSeen = new Map();         // id → 最近一次出现时的 status（含 BLOCKED，供删除检测取删前状态）
const subjects = [];                // 全窗口提交 subject（供删除检测独立扫 id 提及）
let current = [];
for (const line of lines) {
  const [sha, subject = ""] = line.split("\x1f");
  const items = itemsAt(sha); if (!items) continue;
  subjects.push(subject);
  current = items;
  for (const it of items) {
    everSeen.set(it.id, it.status);
    const r = RANK[it.status];
    if (r === undefined) continue; // BLOCKED 等跳过 rank 比较
    if (!maxRank.has(it.id) || r > maxRank.get(it.id)) maxRank.set(it.id, r);
    // 有意匹配：提交 message 含全 id，或含 id 尾两段短名（dev 常用短名，如 "LINK-STABILIZE" 之于 WO-DB-LINK-STABILIZE）
    const tail = it.id.split("-").slice(-2).join("-");
    if (subject.includes(it.id) || (tail.length >= 8 && subject.includes(tail))) {
      if (!intentional.has(it.id)) intentional.set(it.id, new Set());
      intentional.get(it.id).add(r);
    }
  }
}
// 某 id 是否被任一提交 subject 提及（全 id 或尾两段短名）= 有意删除/关闭的信号
const mentionedAnywhere = (id) => {
  const tail = id.split("-").slice(-2).join("-");
  return subjects.some((s) => s.includes(id) || (tail.length >= 8 && s.includes(tail)));
};

const rname = ["TODO", "WIP", "BUILT", "DONE"];
const viol = [];
const currentIds = new Set(current.map((it) => it.id));
for (const it of current) {
  const r = RANK[it.status];
  if (r === undefined) continue;
  const mx = maxRank.get(it.id);
  if (mx === undefined || r >= mx) continue;                 // 未倒退
  if (intentional.get(it.id)?.has(r)) continue;             // 有提及本单的提交显式设过该(低)状态 = 有意
  viol.push({ id: it.id, cur: it.status, mx });
}

// 删除检测（补盲区·2026-07-12 立·dev2 databuilder 曾删 7 单而降级门未逮）：
// 历史曾出现的 id 现已从队列消失，且窗口内无任一提交提及本单 id → 疑被「不提本单、带旧基线全文」的提交覆盖删除。
// 合法删除（去重/关单）总会在提交 message 提及本单 id → 不判红。
const del = [];
for (const [id, lastStatus] of everSeen) {
  if (currentIds.has(id)) continue;                          // 仍在，非删除
  if (mentionedAnywhere(id)) continue;                       // 有提交提及本单 = 有意删除/关闭
  del.push({ id, lastStatus });
}

if (viol.length || del.length) {
  if (viol.length) {
    console.error(`✗ queue-integrity:check — ${viol.length} 处疑似「旧基线覆盖」clobber（当前状态低于历史曾达·且无提及本单的提交解释）:`);
    for (const v of viol) console.error(`  ${v.id}: 当前=${v.cur} 但历史曾达 ${rname[v.mx]} → 疑被旧基线提交覆盖`);
  }
  if (del.length) {
    console.error(`✗ queue-integrity:check — ${del.length} 处疑似「旧基线覆盖删除」（历史曾在·现已消失·且无提及本单的提交解释）:`);
    for (const d of del) console.error(`  ${d.id}: 删前=${d.lastStatus} 现已从队列消失 → 疑被旧基线提交覆盖删除`);
  }
  console.error("  修法：审核方核实（真被误删/误退→从最后好基线恢复 / 真去重关单→提交 message 提及本单 id）。");
  process.exit(1);
}
console.log(`✓ queue-integrity:check 通过（近 ${N} 提交无「旧基线覆盖」逆向倒退/删除）`);
