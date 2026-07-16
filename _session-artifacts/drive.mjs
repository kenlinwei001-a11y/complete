import { readFileSync } from "node:fs";
const TOK = readFileSync(process.argv[2], "utf8").trim().replace(/^export TOK=/, "");
const BASE = "http://127.0.0.1:4102";
const PKG = "pkg_battery_manufacturing";

async function run(label, query, view) {
  const submit = await fetch(`${BASE}/api/v1/queries`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOK}`, "content-type": "application/json" },
    body: JSON.stringify({ packageId: PKG, query, context: { view, selectedObjects: [], filters: {} } }),
  });
  const sj = await submit.json();
  if (!sj.taskId) { console.log(`\n## ${label} [view=${view}]\nSUBMIT FAIL: ${JSON.stringify(sj)}`); return; }
  let task;
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${BASE}/api/v1/queries/${sj.taskId}`, { headers: { authorization: `Bearer ${TOK}` } });
    task = await r.json();
    if (["COMPLETED", "FAILED", "CANCELLED", "AWAITING_CLARIFICATION"].includes(task.status)) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  const cls = task.classification || {};
  const cand = (cls.candidates || []).map((c) => `${c.intentKey}@${c.confidence}`).join(", ");
  console.log(`\n## ${label} [view=${view}] query="${query}"`);
  console.log(`taskId=${sj.taskId}`);
  console.log(`status=${task.status}  path=${task.path}  trustLevel=${task.trustLevel}`);
  console.log(`matchedIntent=${JSON.stringify(task.matchedIntent)}`);
  console.log(`classification.model=${cls.model}  outOfCatalog=${cls.outOfCatalog}`);
  console.log(`candidates=[${cand}]`);
  const ans = task.answer || {};
  const blocks = ans.blocks || [];
  console.log(`answer.blockTypes=[${blocks.map((b) => b.type).join(", ")}]`);
  for (const b of blocks) {
    if (b.type === "text") {
      const t = (b.text || b.markdown || b.content || JSON.stringify(b.data || b)).toString().replace(/\s+/g, " ").slice(0, 260);
      console.log(`  [text] ${t}`);
    } else if (b.type === "table") {
      const rows = (b.rows || b.data?.rows || []);
      console.log(`  [table] rows=${rows.length} ${JSON.stringify(rows).slice(0, 200)}`);
    } else if (b.type === "kpi") {
      console.log(`  [kpi] ${b.label || b.title}=${JSON.stringify(b.value ?? b.data)}`);
    }
  }
  if (task.error) console.log(`error=${JSON.stringify(task.error)}`);
}

const q1 = "为什么这项经营指标越线恶化？根因主驱动是哪个？";
const q2 = "常州物料齐套为什么这天越线？";
await run("Q1-GENERIC(dev-claim)", q1, "dash");
await run("Q2-CHANGZHOU(special-check)", q2, "dash");
await run("Q2b-CHANGZHOU(view=risk)", q2, "risk");
