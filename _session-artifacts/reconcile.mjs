import fs from "fs";
const p = "docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));
const now = new Date().toISOString();
// 按真实证据重建（幂等·可重放）。key=id, val={status, owner?, atKey}
const truth = {
  // 审核方已独立复验 PASS → DONE（certain·被 clobber 回退，恢复）
  "WO-L1B-4":                    { status: "DONE",  atKey: "done" },
  "WO-L2-4":                     { status: "DONE",  atKey: "done" },
  "WO-SANDBOX-CONFIG-COVERAGE":  { status: "DONE",  atKey: "done" },
  // Dev-2 已按审核方最小修改好（a798fe6 幂等守卫+re-adopt测）→ BUILT 待我复验
  "WO-L2-5":                     { status: "BUILT", owner: "dev2", atKey: "built" },
  // Dev-2 datacore 两半均落（摄取 9702527 + retrieve 端点 04f3d7a）→ BUILT 待验
  "WO-L1.5-3":                   { status: "BUILT", owner: "dev2", atKey: "built" },
  // Dev-2 决策模式挖掘+反馈校准（4bba07d·完整特征提交）→ BUILT 待验
  "WO-L1.5-4":                   { status: "BUILT", owner: "dev2", atKey: "built" },
  // L1B-5 已是 BUILT dev1（Dev-1 建·不动）
};
const changes = [];
for (const [id, t] of Object.entries(truth)) {
  const it = q.items.find(i => i.id === id);
  if (!it) { console.log("!! MISSING", id); continue; }
  const before = it.status + "/" + (it.owner || "-");
  if (it.status === t.status && (t.owner === undefined || it.owner === t.owner)) {
    // 已一致（可能已被前次重放修好）——跳过但报告
    console.log("· already", id, before);
    continue;
  }
  it.status = t.status;
  if (t.owner !== undefined) it.owner = t.owner;
  if (t.status === "DONE") it.blockReason = "";
  it.at = it.at || {};
  it.at[t.atKey] = now;
  changes.push(`${id}: ${before} → ${t.status}/${it.owner || "-"}`);
}
q.meta = q.meta || {};
q.meta.lastActivity = { role: "review", cmd: "RECONCILE(clobber修复)", id: `${changes.length}项`, at: now };
fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
console.log("\n=== 变更 ===");
changes.forEach(c => console.log("  " + c));
const by = {}; for (const x of q.items) by[x.status] = (by[x.status] || 0) + 1;
console.log("\ncounts:", JSON.stringify(by), "total:", q.items.length);
