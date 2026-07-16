#!/usr/bin/env node
// Track A · 直接求解器探针（无 Kimi，确定性，快）：隔离后端数据断点。
// 对每张卡的绑定 solver POST /b/v1/solvers/:key/run（args=卡片 slotPresets）→ 看出真值/空/桩/错。
const BASE = "http://127.0.0.1:4002";
const H = { "X-Debug-User": "demo:admin:admin|planner|catalog_admin", "Content-Type": "application/json" };

// [sNo, solverKey, args(slotPresets), solverStatus]
const SOLVERS = [
  ["S01","capacity_forecast",{modelId:"4680-NCM",demandDelta:0.2,weeks:6},"REUSED"],
  ["S02","affected_orders",{baseId:"changzhou"},"REUSED"],
  ["S03","risk_timeline",{baseId:"changzhou",factor:"物料齐套"},"REUSED"],
  ["S04","plan_audit",{cashCushion:4500000000},"REUSED"],
  ["S05","plan_generate",{},"REUSED"],
  ["S06","mitigation_select",{baseName:"常州",factor:"物料齐套",solutionName:"三班制"},"NEW"],
  ["S07","cert_schedule",{horizonWeeks:12},"NEW"],
  ["S08","kit_readiness",{fromDay:1,toDay:14},"NEW"],
  ["S09","lta_gap",{material:"三元正极",month:"2026-07"},"NEW"],
  ["S10","inventory_optimize",{},"NEW"],
  ["S11","changeover_sequence",{lineId:"常州·动力线-A",week:1},"NEW"],
  ["S12","yield_diagnosis",{processKey:"涂布",baseName:"常州"},"NEW"],
  ["S13","maintenance_stagger",{},"NEW"],
  ["S14","outsourcing_split",{gap:80000,weeks:6},"NEW"],
  ["S15","quote_margin",{custName:"电网公司F"},"NEW"],
  ["S16","credit_exposure",{custName:"商用车集团G"},"NEW"],
  ["S17","capex_scenario",{scenario:"基准"},"REUSED"],
  ["S18","sop_balance",{},"REUSED"],            // 非注册 solver key（应为 workflow）→ 期望 404
  ["S19","quarterly_gap",{quarter:"2026Q2"},"NEW"],
  ["S20","carbon_footprint",{modelId:"4680-NCM",baseName:"成都"},"NEW"],
];

// 判定真值 vs 空/桩：统计数值字段、数组长度、是否含 placeholder/TODO/0 标记
function classify(httpStatus, body) {
  if (httpStatus === 404) return { verdict: "SOLVER_404", detail: body?.error?.code || "not found" };
  if (httpStatus === 504) return { verdict: "TIMEOUT", detail: "solver run >15s" };
  if (httpStatus >= 400) return { verdict: "ERROR_" + httpStatus, detail: body?.error?.message || JSON.stringify(body).slice(0,120) };
  // 成功：探数据深度
  const json = JSON.stringify(body);
  const data = body?.data ?? body?.result ?? body;
  // 收集所有数值
  const nums = (json.match(/:\s*-?\d+(\.\d+)?/g) || []).map((s) => parseFloat(s.replace(/:\s*/, "")));
  const nonZero = nums.filter((n) => n !== 0);
  // 数组规模
  let arrLen = 0;
  const scan = (o) => { if (Array.isArray(o)) { arrLen += o.length; o.forEach(scan); } else if (o && typeof o === "object") Object.values(o).forEach(scan); };
  scan(data);
  // placeholder/桩 标记
  const stubMark = /(TODO|placeholder|临时|stub|mock|未实现|provisional|PROVISIONAL|暂未|占位)/i.test(json);
  const emptyMark = /(暂无|无数据|没有.*数据|"rows":\s*\[\]|"items":\s*\[\]|"series":\s*\[\])/i.test(json);
  let verdict;
  if (stubMark) verdict = "STUB_MARK";
  else if (json.length < 40) verdict = "EMPTY_THIN";
  else if (nonZero.length === 0 && arrLen === 0) verdict = "ALL_ZERO_EMPTY";
  else if (emptyMark && nonZero.length < 2) verdict = "EMPTY_ARRAYS";
  else verdict = "REAL_DATA";
  return { verdict, bytes: json.length, nums: nums.length, nonZero: nonZero.length, arrLen, stubMark, emptyMark };
}

const out = [];
for (const [sNo, key, args, solverStatus] of SOLVERS) {
  let httpStatus = 0, body = null, err = null;
  try {
    const r = await fetch(`${BASE}/b/v1/solvers/${key}/run`, { method: "POST", headers: H, body: JSON.stringify({ args }) });
    httpStatus = r.status;
    body = await r.json().catch(() => ({}));
  } catch (e) { err = String(e); }
  const c = classify(httpStatus, body);
  const row = { sNo, key, solverStatus, httpStatus, ...c };
  out.push(row);
  process.stderr.write(`${sNo} ${key} http=${httpStatus} ${c.verdict} bytes=${c.bytes||0} nonZero=${c.nonZero||0} arr=${c.arrLen||0}${c.stubMark?" STUB":""}${err?" ERR:"+err:""}\n`);
}
process.stdout.write(JSON.stringify(out, null, 2));
