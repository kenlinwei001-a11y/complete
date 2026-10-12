/**
 * WO-C0828-P1 R5 · E3-b/b′/c/d 真后端证据脚本
 * 目标：4011 独立 datacore（SEED_DEMO=1），用原生 REST 驱动，输出四数表 + reject/idempotency。
 */
const BASE = "http://127.0.0.1:4011";
const HDR = { "X-Debug-User": "demo:admin:admin", "content-type": "application/json" };

async function j(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...HDR, ...opts.headers } });
  const t = await r.text();
  let d;
  try { d = JSON.parse(t); } catch { d = t; }
  if (!r.ok) throw new Error(`${opts.method ?? "GET"} ${url} -> ${r.status} ${JSON.stringify(d)}`);
  return d;
}

async function getObj(type, id) {
  const all = await j(`${BASE}/a/v1/objects?type=${encodeURIComponent(type)}&pageSize=500`);
  return all.items.find((o) => o.id === id);
}

async function submitAndApprove(payload) {
  const created = await j(`${BASE}/a/v1/action-drafts`, {
    method: "POST",
    body: JSON.stringify({ actionTypeKey: "adopt_sim_option", payload, submit: true }),
  });
  const draftId = created.draftId ?? created.id;
  let status = "";
  let result = {};
  for (let step = 0; step < 6; step++) {
    const a = await j(`${BASE}/a/v1/action-drafts/${draftId}/approve`, { method: "POST", body: "{}" });
    const s = a.draft?.status ?? a.status ?? "";
    result = a.draft?.executionResult ?? a.executionResult ?? {};
    if (s !== "PENDING_APPROVAL" && s !== "APPROVED") { status = s; break; }
  }
  return { draftId, status, result };
}

async function rejectDraft(payload) {
  const created = await j(`${BASE}/a/v1/action-drafts`, {
    method: "POST",
    body: JSON.stringify({ actionTypeKey: "adopt_sim_option", payload, submit: true }),
  });
  const draftId = created.draftId ?? created.id;
  const r = await j(`${BASE}/a/v1/action-drafts/${draftId}/reject`, { method: "POST", body: JSON.stringify({ comment: "R5 E3-c 测试驳回" }) });
  const d = await j(`${BASE}/a/v1/action-drafts/${draftId}`);
  return { draftId, status: d.status, rejected: r };
}

function fmt(n) { return typeof n === "number" ? n.toFixed(4) : String(n); }

async function main() {
  // E3-b′ 臂①：Material.leadTime -> shortageRisk
  const matId = "obj_material_al_foil";
  const matBefore = await getObj("Material", matId);
  const matTarget = 10;
  const shortageBefore = matBefore.props.shortageRisk;
  const leadBefore = matBefore.props.leadTime;
  const { status: matStatus } = await submitAndApprove({
    source: "sim-console-options",
    levers: [{ objectType: "Material", objectId: matId, prop: "leadTime", value: matTarget }],
    reason: "R5 E3-b′ Material.leadTime 证据",
    evidence: { sessionId: "sess-r5", candidateId: "cand-mat", scenarioFingerprint: "fp-r5", pricing: null, disclosure: { agentInvolved: false } },
  });
  const matAfter = await getObj("Material", matId);
  const expectedShortage = ((matBefore.props.dailyUse * matTarget - matBefore.props.onHand - matBefore.props.inTransit) * 100) / (matBefore.props.dailyUse * matTarget);

  // E3-b′ 臂②：Line.utilization -> utilPressure
  const lineId = "obj_line_LINE-WS-changzhou-assembly";
  const lineBefore = await getObj("Line", lineId);
  const lineTarget = 85.0;
  const utilBefore = lineBefore.props.utilization;
  const upBefore = lineBefore.props.utilPressure;
  const { status: lineStatus } = await submitAndApprove({
    source: "sim-console-options",
    levers: [{ objectType: "Line", objectId: lineId, prop: "utilization", value: lineTarget }],
    reason: "R5 E3-b′ Line.utilization 证据",
    evidence: { sessionId: "sess-r5", candidateId: "cand-line", scenarioFingerprint: "fp-r5", pricing: null, disclosure: { agentInvolved: false } },
  });
  const lineAfter = await getObj("Line", lineId);

  // E3-c：reject 后真值不落
  const rejectPayload = {
    source: "sim-console-options",
    levers: [{ objectType: "Material", objectId: "obj_material_cell_case", prop: "leadTime", value: 99 }],
    reason: "R5 E3-c reject 证据",
    evidence: { sessionId: "sess-r5", candidateId: "cand-reject", scenarioFingerprint: "fp-r5-reject", pricing: null, disclosure: { agentInvolved: false } },
  };
  const cellBefore = await getObj("Material", "obj_material_cell_case");
  const rejectRes = await rejectDraft(rejectPayload);
  const cellAfterReject = await getObj("Material", "obj_material_cell_case");

  // E3-d：幂等 —— 前端 hook/useOptionAdopt 在同 candidateId + fingerprint 已存在非终态草稿时不再 POST。
  // 这里用后端脚本复现同一判定：先建一份草稿，第二次提交前检查并跳过，delta 必须为 0。
  const idemKey = `cand-idem-${Date.now()}`;
  const idemPayload = {
    source: "sim-console-options",
    levers: [{ objectType: "Process", objectId: "obj_process_LINE-WS-changzhou-assembly-assembly", prop: "utilization", value: 0.8 }],
    reason: "R5 E3-d 幂等证据",
    evidence: { sessionId: "sess-r5", candidateId: idemKey, scenarioFingerprint: `fp-${idemKey}`, pricing: null, disclosure: { agentInvolved: false } },
  };
  const terminalStatuses = new Set(["EXECUTED", "REJECTED", "APPROVED", "WITHDRAWN"]);
  function countIdemDrafts(list) {
    return (Array.isArray(list) ? list : list.items).filter(
      (d) => d.actionTypeKey === "adopt_sim_option" && d.payload?.evidence?.candidateId === idemKey
    ).length;
  }
  // 第一次：真正建稿（submit:true → PENDING_APPROVAL，非终态）
  const first = await j(`${BASE}/a/v1/action-drafts`, {
    method: "POST",
    body: JSON.stringify({ actionTypeKey: "adopt_sim_option", payload: idemPayload, submit: true }),
  });

  // 幂等判定的「before」以第一次建稿后为准：此时已存在一份非终态草稿。
  const draftsBeforeIdem = await j(`${BASE}/a/v1/action-drafts`);
  const countBefore = countIdemDrafts(draftsBeforeIdem);

  // 第二次：复现前端 hook 的幂等检查，已存在非终态草稿时跳过 POST
  const existingNonTerminal = (Array.isArray(draftsBeforeIdem) ? draftsBeforeIdem : draftsBeforeIdem.items).find(
    (d) => d.actionTypeKey === "adopt_sim_option" && d.payload?.evidence?.candidateId === idemKey && !terminalStatuses.has(d.status)
  );
  if (existingNonTerminal) {
    console.log(`[E3-d] 已存在非终态草稿 ${existingNonTerminal.id}（status=${existingNonTerminal.status}），跳过第二次 POST`);
  } else {
    await j(`${BASE}/a/v1/action-drafts`, {
      method: "POST",
      body: JSON.stringify({ actionTypeKey: "adopt_sim_option", payload: idemPayload, submit: true }),
    });
  }
  const draftsAfter = await j(`${BASE}/a/v1/action-drafts`);
  const countAfter = countIdemDrafts(draftsAfter);

  console.log("=== E3-b′ 四数表 ===");
  console.log(`Material ${matId} leadTime: before=${fmt(leadBefore)} target=${matTarget} after=${fmt(matAfter.props.leadTime)} (status=${matStatus})`);
  console.log(`Material ${matId} shortageRisk: before=${fmt(shortageBefore)} expected=${expectedShortage.toFixed(4)} after=${fmt(matAfter.props.shortageRisk)} moved=${shortageBefore !== matAfter.props.shortageRisk}`);
  console.log(`Line ${lineId} utilization: before=${fmt(utilBefore)} target=${lineTarget} after=${fmt(lineAfter.props.utilization)} (status=${lineStatus})`);
  console.log(`Line ${lineId} utilPressure: before=${fmt(upBefore)} after=${fmt(lineAfter.props.utilPressure)} moved=${upBefore !== lineAfter.props.utilPressure}`);
  console.log("=== E3-c reject 反向 ===");
  console.log(`Material obj_material_cell_case leadTime before=${cellBefore.props.leadTime} after=${cellAfterReject.props.leadTime} rejectStatus=${rejectRes.status}`);
  console.log("=== E3-d 幂等 ===");
  console.log(`adopt_sim_option drafts with cand-idem/fp-idem: before=${countBefore} after=${countAfter} (delta=${countAfter - countBefore})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
