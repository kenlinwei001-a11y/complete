#!/usr/bin/env node
// Track B v2 · 端到端 Kimi 启动探针（前后端一起）：launch→classify(Kimi)→path→render→answer。
// 串行 1 活动任务（避 ≤3 并发 429）；耐心轮询（Moonshot 慢）；重点抓 error{code,message,stepId} + 空槽。
const BASE = "http://127.0.0.1:4002";
const H = { "X-Debug-User": "demo:admin:admin|planner|catalog_admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CARDS = [
  ["S01","订单可承接性评审","capacity_feasibility"],["S02","交期风险与受影响订单","affected_orders"],
  ["S03","风险越线根因","risk_root_cause"],["S04","月度规划体检","plan_audit_q"],
  ["S05","经营方案比选","plan_recommend"],["S06","处置方案采纳","adopt_mitigation"],
  ["S07","产线认证排期","cert_scheduling"],["S08","物料齐套分析","kit_analysis"],
  ["S09","长协执行与补缺","lta_gap_q"],["S10","库存水位优化","inventory_opt"],
  ["S11","换型排序优化","changeover_opt"],["S12","良率波动诊断","yield_diag"],
  ["S13","检修窗口错峰","maint_stagger"],["S14","外协决策","outsourcing_q"],
  ["S15","接单毛利评审","quote_margin_q"],["S16","客户信用风险","credit_check"],
  ["S17","产能投资评审","capex_review"],["S18","S&OP 月度平衡","sop_status"],
  ["S19","季度缺口对策","quarterly_gap_q"],["S20","碳足迹核算","carbon_q"],
];

async function launchOne(sNo) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`${BASE}/b/v1/scenarios/${sNo}/launch`, { method: "POST", headers: H });
    const b = await r.json().catch(() => ({}));
    if (b.taskId) return { httpStatus: r.status, taskId: b.taskId };
    const txt = JSON.stringify(b);
    if (r.status === 429 || /RATE_LIMITED|429/.test(txt)) { await sleep(4000 * (attempt + 1)); continue; }
    return { httpStatus: r.status, taskId: null, launchErr: b.error || b };
  }
  return { httpStatus: 429, taskId: null, launchErr: { code: "RATE_LIMITED_GIVEUP" } };
}

async function poll(taskId, timeoutMs = 180000) {
  const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "NEEDS_CLARIFICATION"]);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`${BASE}/api/v1/queries/${taskId}`, { headers: H });
    if (r.ok) { const j = await r.json(); if (TERMINAL.has(j.status)) return j; }
    await sleep(2000);
  }
  return null;
}

function inspectAnswer(ans) {
  if (!ans) return { hasAnswer: false, blockCount: 0, kpiCount: 0, emptyMarkers: 0, trustLevel: null };
  const blocks = ans.blocks || [];
  let kpiCount = 0, emptyMarkers = 0;
  const EMPTY = /(暂无|无数据|没有数据|N\/A|未找到|no data)/i;
  for (const b of blocks) {
    if (b.type === "kpi") { kpiCount++; const v = String(b.value ?? "").trim(); if (v === "" || EMPTY.test(v)) emptyMarkers++; }
    if (b.type === "text" && EMPTY.test(String(b.markdown || ""))) emptyMarkers++;
  }
  return { hasAnswer: true, blockCount: blocks.length, kpiCount, emptyMarkers, trustLevel: ans.trustLevel || null };
}

const out = [];
for (const [sNo, name, expIntent] of CARDS) {
  const lr = await launchOne(sNo);
  if (!lr.taskId) {
    out.push({ sNo, name, expIntent, terminal: "LAUNCH_FAILED", launchErr: lr.launchErr, bp: "LAUNCH" });
    process.stderr.write(`${sNo} LAUNCH_FAILED ${JSON.stringify(lr.launchErr)}\n`); continue;
  }
  const t = await poll(lr.taskId);
  if (!t) { out.push({ sNo, name, expIntent, taskId: lr.taskId, terminal: "TIMEOUT", bp: "TIMEOUT" });
    process.stderr.write(`${sNo} TIMEOUT\n`); continue; }
  const gotIntent = t.matchedIntent?.intentKey || t.classification?.candidates?.[0]?.intentKey || null;
  const conf = t.classification?.candidates?.[0]?.confidence ?? null;
  const slots = t.slots || {};
  const nullSlots = Object.entries(slots).filter(([k, v]) => v === null || v === undefined).map(([k]) => k);
  const a = inspectAnswer(t.answer);
  const r = {
    sNo, name, expIntent, taskId: lr.taskId, terminal: t.status, path: t.path || null,
    gotIntent, intentMatch: gotIntent === expIntent, conf,
    model: t.classification?.model || null, classLatencyMs: t.classification?.latencyMs ?? null,
    nullSlots, error: t.error || null, ...a,
  };
  out.push(r);
  const errStr = r.error ? ` ERR[${r.error.code}@${r.error.stepId || "?"}:${(r.error.message||"").slice(0,50)}]` : "";
  process.stderr.write(`${sNo} ${t.status} ${t.path} intent=${gotIntent}(${r.intentMatch?"✓":"✗"},${conf}) nullSlots=[${nullSlots.join(",")}] blocks=${a.blockCount} kpi=${a.kpiCount} trust=${a.trustLevel}${errStr}\n`);
  await sleep(3000);
}
process.stdout.write(JSON.stringify(out, null, 2));
