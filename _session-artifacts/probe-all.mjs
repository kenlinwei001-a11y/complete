#!/usr/bin/env node
// 20 场景启动器卡片 · 前后端一起跑 · 断点探针
// 真实用户路径：launch 卡片 → QOS classify(Kimi) → path A/B → 落点 ViewDef/answer
// 检测器：路由对否 / 终态 / 求解器是否出真值 / answer 是否空 / trustLevel / 错误
const BASE = "http://127.0.0.1:4002";
const H = { "X-Debug-User": "demo:admin:admin|planner|catalog_admin", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 卡片表（取自 scenarios-catalog.ts 单一来源，含期望 intentKey/solver 以判误路）
const CARDS = [
  ["S01","订单可承接性评审","project","capacity_feasibility","capacity_forecast","REUSED","COMPUTE"],
  ["S02","交期风险与受影响订单","risk","affected_orders","affected_orders","REUSED","COMPUTE"],
  ["S03","风险越线根因","risk","risk_root_cause","risk_timeline","REUSED","COMPUTE"],
  ["S04","月度规划体检","audit","plan_audit_q","plan_audit","REUSED","COMPUTE"],
  ["S05","经营方案比选","generate","plan_recommend","plan_generate","REUSED","COMPUTE"],
  ["S06","处置方案采纳","risk","adopt_mitigation","mitigation_select","NEW","ACTION_DRAFT"],
  ["S07","产线认证排期","project","cert_scheduling","cert_schedule","NEW","COMPUTE"],
  ["S08","物料齐套分析","risk","kit_analysis","kit_readiness","NEW","COMPUTE"],
  ["S09","长协执行与补缺","dash","lta_gap_q","lta_gap","NEW","COMPUTE"],
  ["S10","库存水位优化","dash","inventory_opt","inventory_optimize","NEW","COMPUTE"],
  ["S11","换型排序优化","project","changeover_opt","changeover_sequence","NEW","COMPUTE"],
  ["S12","良率波动诊断","risk","yield_diag","yield_diagnosis","NEW","COMPUTE"],
  ["S13","检修窗口错峰","risk","maint_stagger","maintenance_stagger","NEW","COMPUTE"],
  ["S14","外协决策","generate","outsourcing_q","outsourcing_split","NEW","COMPUTE"],
  ["S15","接单毛利评审","dash","quote_margin_q","quote_margin","NEW","COMPUTE"],
  ["S16","客户信用风险","dash","credit_check","credit_exposure","NEW","COMPUTE"],
  ["S17","产能投资评审","generate","capex_review","capex_scenario","REUSED","COMPUTE"],
  ["S18","S&OP 月度平衡","sop","sop_status","sop_balance","REUSED","COMPUTE"],
  ["S19","季度缺口对策","quarter","quarterly_gap_q","quarterly_gap","NEW","COMPUTE"],
  ["S20","碳足迹核算","dash","carbon_q","carbon_footprint","NEW","COMPUTE"],
];

async function launch(sNo) {
  // 429-aware backoff（Moonshot RPM 限速）：重试 4 次 3s/6s/12s/24s
  let last = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(`${BASE}/b/v1/scenarios/${sNo}/launch`, { method: "POST", headers: H });
    const body = await r.json().catch(() => ({}));
    last = { httpStatus: r.status, taskId: body.taskId || null, launchErr: body.error || (r.status >= 400 ? body : null) };
    if (last.taskId) return last;
    const is429 = r.status === 429 || JSON.stringify(body).includes("429") || /rate/i.test(JSON.stringify(body));
    if (!is429) return last; // 非限速错误：直接返回（真断点）
    const wait = 3000 * Math.pow(2, attempt);
    process.stderr.write(`  ${sNo} 429 retry in ${wait}ms\n`);
    await sleep(wait);
  }
  return last;
}

async function poll(taskId, timeoutMs = 90000) {
  const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "NEEDS_CLARIFICATION"]);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`${BASE}/api/v1/queries/${taskId}`, { headers: H });
    if (r.ok) {
      const j = await r.json();
      if (TERMINAL.has(j.status)) return j;
    }
    await sleep(1500);
  }
  return null;
}

// answer 空/真值检测
function inspectAnswer(ans) {
  if (!ans) return { hasAnswer: false, blockCount: 0, kpiCount: 0, tableRows: 0, emptyMarkers: 0, trustLevel: null, unverified: 0 };
  const blocks = ans.blocks || [];
  let kpiCount = 0, tableRows = 0, emptyMarkers = 0;
  const EMPTY_RE = /(暂无|无数据|没有数据|N\/A|空|未找到|no data|—\s*$)/i;
  for (const b of blocks) {
    if (b.type === "kpi") {
      kpiCount++;
      const v = String(b.value ?? "").trim();
      if (v === "" || v === "0" || v === "—" || v === "-" || EMPTY_RE.test(v)) emptyMarkers++;
    }
    if (b.type === "table") tableRows += (b.rows?.length || 0);
    if (b.type === "text" && EMPTY_RE.test(String(b.markdown || ""))) emptyMarkers++;
  }
  return {
    hasAnswer: true,
    blockCount: blocks.length,
    kpiCount,
    tableRows,
    emptyMarkers,
    trustLevel: ans.trustLevel || null,
    unverified: (ans.unverifiedNumerics || []).length,
  };
}

const results = [];
// 严格串行（Kimi RPM 限速）：一次一张卡 launch→poll→记录，卡间留 2s 间隔
for (const card of CARDS) {
  const [sNo, name, view, expIntent, expSolver, solverStatus, risk] = card;
  const lr = await launch(sNo);
  if (!lr.taskId) {
    results.push({ sNo, name, view, expIntent, expSolver, solverStatus, risk, launchHttp: lr.httpStatus, terminal: "LAUNCH_FAILED", launchErr: lr.launchErr, breakpoint: "LAUNCH" });
    process.stderr.write(`${sNo} LAUNCH_FAILED ${lr.httpStatus}\n`);
    continue;
  }
  const task = await poll(lr.taskId);
  if (!task) {
    results.push({ sNo, name, view, expIntent, expSolver, solverStatus, risk, launchHttp: lr.httpStatus, taskId: lr.taskId, terminal: "TIMEOUT", breakpoint: "TIMEOUT" });
    process.stderr.write(`${sNo} TIMEOUT\n`);
    continue;
  }
  const gotIntent = task.matchedIntent?.intentKey || task.classification?.candidates?.[0]?.intentKey || null;
  const a = inspectAnswer(task.answer);
  const classModel = task.classification?.model || null;
  const r = {
    sNo, name, view, expIntent, expSolver, solverStatus, risk,
    launchHttp: lr.httpStatus,
    taskId: lr.taskId,
    terminal: task.status,
    path: task.path || null,
    gotIntent,
    intentMatch: gotIntent === expIntent,
    outOfCatalog: task.classification?.outOfCatalog ?? null,
    classModel,
    classLatencyMs: task.classification?.latencyMs ?? null,
    ...a,
  };
  results.push(r);
  process.stderr.write(`${sNo} ${task.status} path=${r.path} intent=${gotIntent}(${r.intentMatch?"✓":"✗"}) blocks=${a.blockCount} kpi=${a.kpiCount} empty=${a.emptyMarkers} trust=${a.trustLevel}\n`);
  await sleep(2000); // 卡间间隔，避让 Moonshot RPM
}

process.stdout.write(JSON.stringify(results, null, 2));
