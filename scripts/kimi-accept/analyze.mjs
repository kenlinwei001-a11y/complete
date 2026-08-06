import { readFileSync } from "node:fs";
/**
 * 把 10×5 矩阵结果压成「取数报告」四件套：
 *  ① 结果矩阵（每题 5 次终态分布 · 标 5/5 稳定 or 分歧）
 *  ② 总分
 *  ③ 每条未达标的真因定性（贴 extractedSlots 与 error.message 原文）
 *  ④ 同题跑次分歧样本（同题不同结果的 slots 并排 —— 最有价值的证据）
 *
 * 用法：node analyze.mjs [matrixJson]
 */
const S = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const R = JSON.parse(readFileSync(process.argv[2] || `${S}/kimi-accept-matrix.json`, "utf8"));
const nos = [...new Set(R.map((r) => r.no))].sort((a, b) => a - b);
const key = (r) => (r.no === 10 ? r.exemptOutcome || `${r.status}/r${r.rounds}` : `${r.status}/r${r.rounds}`);

console.log("## ① 10×5 结果矩阵\n");
console.log("| # | 意图 | 问句 | 5 次终态分布 | 判定 |");
console.log("|---|---|---|---|---|");
let stable = 0;
const unstable = [], failed = [];
for (const no of nos) {
  const rs = R.filter((r) => r.no === no);
  const dist = {};
  for (const r of rs) dist[key(r)] = (dist[key(r)] || 0) + 1;
  const passes = rs.filter((r) => r.pass).length;
  const ok = passes === rs.length;
  if (ok) stable++;
  else if (Object.keys(dist).length > 1) unstable.push(no);
  else failed.push(no);
  const verdict = ok ? (Object.keys(dist).length === 1 ? "✅ 5/5 稳定" : "✅ 全过(形态不一)") : Object.keys(dist).length > 1 ? "❌ 分歧" : "❌ 稳定失败";
  const d = Object.entries(dist).map(([k, v]) => `${k}×${v}`).join(" · ");
  console.log(`| ${no} | ${rs[0].intent} | ${rs[0].query} | ${d} | ${verdict} ${passes}/${rs.length} |`);
}
console.log(`\n## ② 总分：**${stable}/10** 达标（5/5 稳定 COMPLETED 且零反问；#10 走豁免）\n`);

console.log("## ③ 未达标真因定性\n");
for (const no of nos) {
  const rs = R.filter((r) => r.no === no);
  if (rs.every((r) => r.pass)) continue;
  console.log(`### #${no} 「${rs[0].query}」 (${rs[0].intent})`);
  for (const r of rs.filter((x) => !x.pass)) {
    console.log(`- run${r.run} \`${r.status}\` rounds=${r.rounds} routed=\`${r.routed}\` matched=\`${r.matched}\` path=${r.path} ${r.ms}ms`);
    console.log(`  - extractedSlots: \`${JSON.stringify(r.slots)}\``);
    if (r.taskSlots) console.log(`  - task.slots(填充后): \`${JSON.stringify(r.taskSlots)}\``);
    if (r.slotResolutions?.length) console.log(`  - slotResolutions: \`${JSON.stringify(r.slotResolutions)}\``);
    if (r.pending) console.log(`  - pendingClarification: \`${JSON.stringify(r.pending)}\``);
    if (r.error) console.log(`  - **error**: \`${r.error.code}\` — ${r.error.message}${r.error.stepId ? ` (step=${r.error.stepId})` : ""}`);
    if (r.exemptOutcome) console.log(`  - exemptOutcome: ${r.exemptOutcome}`);
    if (r.afterReply) console.log(`  - 应答后: \`${r.afterReply.status}\` rounds=${r.afterReply.rounds} err=${JSON.stringify(r.afterReply.error)}`);
    if (r.submitErr) console.log(`  - submitErr: ${r.submitErr}`);
    if (r.scriptErr) console.log(`  - scriptErr: ${r.scriptErr}`);
  }
  console.log("");
}

console.log("## ④ 同题跑次分歧样本（同题不同结果的 slots 并排）\n");
for (const no of nos) {
  const rs = R.filter((r) => r.no === no);
  const forms = new Set(rs.map(key));
  const slotForms = new Set(rs.map((r) => JSON.stringify(r.slots)));
  if (forms.size === 1 && slotForms.size === 1) continue; // 完全一致，无分歧可看
  console.log(`### #${no} 「${rs[0].query}」 —— 终态 ${forms.size} 种 · slots ${slotForms.size} 种`);
  console.log("| run | extractedSlots | routed | 终态 | rounds | ms |");
  console.log("|---|---|---|---|---|---|");
  for (const r of rs) {
    console.log(`| ${r.run} | \`${JSON.stringify(r.slots)}\` | ${r.routed} | ${r.pass ? "✅" : "❌"} ${key(r)} | ${r.rounds} | ${r.ms} |`);
  }
  console.log("");
}

// 耗时统计（旁证：卡死 vs 正常）
const done = R.filter((r) => r.ms > 0).map((r) => r.ms).sort((a, b) => a - b);
console.log(`## ⑤ 耗时：中位 ${done[Math.floor(done.length / 2)]}ms · 最慢 ${done[done.length - 1]}ms · 最快 ${done[0]}ms · n=${done.length}`);
