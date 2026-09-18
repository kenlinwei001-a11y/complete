// 探针第二击（2026-09-18）：修正第一击两处探针自身缺陷，让两条判据真正咬上
// R1 drill：换「材质对路」事件 MATERIAL_REPRICE@铝箔 pctChange=15 —— 预期 appliedStateEffects 非空、
//    worldCellsMoved>0、findingsChanged>0（与第一击错配事件的 0/0/0 成对照）
// R2 对抗方双臂：用 demo 会话的 baseSnapshot 建臂（第一击空世界 ⇒ 作废重测）；
//    客户匹配改 includes；记录 trace 规则键分布、disclosure 结构、特性开关回读确认
import { writeFileSync } from "node:fs";

const DC = "http://127.0.0.1:4001";
const OUT = new URL("./", import.meta.url).pathname;
let TOKEN = "";
const lines = [];
const say = (s) => { const l = `[${new Date().toISOString().slice(11, 19)}] ${s}`; lines.push(l); console.log(l); };

async function dc(method, path, body) {
  const res = await fetch(DC + path, {
    method,
    headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 3000) }; }
  return { status: res.status, json };
}
function ev(name, data, rc = 0) {
  writeFileSync(OUT + name + ".json", JSON.stringify(data, null, 2));
  writeFileSync(OUT + name + ".rc", String(rc) + "\n");
}
async function step(name, fn) {
  try { const data = await fn(); ev(name, data ?? { ok: true }, 0); return data; }
  catch (e) { say(`🔴 ${name} 异常（不绕行，原文落盘）：${e instanceof Error ? e.message : String(e)}`); ev(name, { exception: String(e instanceof Error ? e.stack ?? e.message : e) }, 1); return null; }
}
const items = (j) => Array.isArray(j) ? j : (j.items ?? []);

await step("r0-login", async () => {
  const r = await dc("POST", "/a/v1/auth/login", { tenantId: "demo", username: "admin", password: "demo1234" });
  TOKEN = String(r.json.accessToken ?? r.json.token ?? "");
  if (r.status !== 200 || TOKEN === "") throw new Error(`login ${r.status}`);
  say("登录 OK");
  return { status: r.status };
});

// ── R1 drill 对路事件 ───────────────────────────────────────────────────────
await step("r1-drill-material-reprice", async () => {
  const run = await dc("POST", "/a/v1/sim/sessions/sims_demo_seed_world/drill", {
    events: [{ kind: "MATERIAL_REPRICE", targetObjectId: "obj_material_al_foil", payload: { pctChange: 15 }, effectiveDay: 1 }],
    horizonDays: 7,
  });
  const j = run.json;
  say(`drill MATERIAL_REPRICE@铝箔+15% status=${run.status}`);
  say(`appliedStateEffects=${JSON.stringify(j.appliedStateEffects).slice(0, 500)}`);
  say(`worldCellsMoved=${String(j.worldCellsMoved)}/${String(j.worldCellsTotal)} findingsChanged=${String(j.findingsChanged)} totalByKind=${JSON.stringify(j.totalByKind)}`);
  say(`solverRuns=${JSON.stringify(j.solverRuns).slice(0, 500)}`);
  say(`对照第一击（错配事件）：moved 0→${String(j.worldCellsMoved)}、changed 0→${String(j.findingsChanged)} ⇒ ${Number(j.worldCellsMoved) > 0 ? "✅ 对路事件真打进世界态" : "⚠ 对路也没打进，另查"}`);
  return { status: run.status, appliedStateEffects: j.appliedStateEffects ?? null, worldCellsMoved: j.worldCellsMoved ?? null, worldCellsTotal: j.worldCellsTotal ?? null, findingsChanged: j.findingsChanged ?? null, totalByKind: j.totalByKind ?? null, solverRuns: j.solverRuns ?? null, degraded: j.degraded ?? null, summary: j.summary ?? null };
});

// ── R2 对抗方双臂（带真世界快照）────────────────────────────────────────────
await step("r2-adversary-twin-arm-v2", async () => {
  const demo = (await dc("GET", "/a/v1/sim/sessions/sims_demo_seed_world")).json;
  const snap = demo.baseSnapshot;
  if (!snap || typeof snap !== "object") throw new Error("demo 会话取不到 baseSnapshot");
  say(`demo baseSnapshot 取到，格数=${Object.keys(snap).length}`);

  const orders = items((await dc("GET", "/a/v1/objects?type=Order&pageSize=500")).json);
  const big = orders.slice().sort((a, b) => Number(b.props?.value ?? 0) - Number(a.props?.value ?? 0))[0];
  const custName = String(big.props?.cust ?? "");
  const custObj = items((await dc("GET", "/a/v1/objects?type=Customer&pageSize=500")).json)
    .find((o) => JSON.stringify(o.props ?? {}).includes(custName.replace(/(集团|汽车|公司)/g, "").slice(0, 2)) || JSON.stringify(o.props ?? {}).includes(custName));
  say(`最大订单=${big.id}（${custName} value=${String(big.props?.value)}）→ 客户对象=${custObj?.id ?? "（未匹配）"}`);

  const runArm = async (tag) => {
    const sess = (await dc("POST", "/a/v1/sim/sessions", { baseSnapshot: snap })).json;
    const pid = sess.id;
    await dc("POST", `/a/v1/sim/sessions/${pid}/perturbations`, {
      kind: "cost_shock", targetObjectId: big.id, targetStateVar: "costPressure",
      magnitude: 80, mode: "delta", startTick: 0, durationTicks: null, label: `探针${tag}·成本冲击+80`,
    });
    const t = await dc("POST", `/a/v1/sim/sessions/${pid}/tick?disclose=1`, { n: 3 });
    const trace = t.json.trace ?? [];
    const ruleKeys = [...new Set(trace.map((r) => r.ruleKey))].sort();
    const rows = trace.filter((r) => r.ruleKey === "demo_customer_reaction_cut_order");
    const w = (await dc("GET", `/a/v1/sim/sessions/${pid}/world`)).json;
    const state = w.state ?? w;
    const recv = custObj ? state[custObj.id]?.receivablePressure : undefined;
    const churn = state[big.id]?.orderChurn;
    const cost = state[big.id]?.costPressure;
    const discKeys = t.json.disclosure ? Object.keys(t.json.disclosure) : [];
    say(`臂${tag}：trace=${trace.length}行 规则键=${ruleKeys.length}种 还手行数=${rows.length} | 订单costPressure=${JSON.stringify(cost)} 客户receivablePressure=${JSON.stringify(recv)}(线12) orderChurn=${JSON.stringify(churn)}`);
    if (rows.length > 0) say(`臂${tag} 还手样本=${JSON.stringify(rows.slice(0, 4)).slice(0, 600)}`);
    return { session: pid, traceRows: trace.length, ruleKeys, reactionRows: rows.length, reactionSample: rows.slice(0, 6), costPressure: cost ?? null, receivablePressure: recv ?? null, orderChurn: churn ?? null, disclosureKeys: discKeys, adversaryDisclosure: t.json.disclosure?.rules?.adversary ?? t.json.disclosure?.adversary ?? null };
  };

  const armA = await runArm("A(关)");
  const put = await dc("PUT", "/a/v1/tenants/demo/features", { overrides: { "sim.propagation.adversary": true } });
  const enabled = JSON.stringify(put.json).includes("sim.propagation.adversary");
  say(`PUT 开对抗方 status=${put.status} 回包含该键=${enabled}`);
  const armB = await runArm("B(开)");
  await dc("PUT", "/a/v1/tenants/demo/features", { overrides: { "sim.propagation.adversary": false } });
  say("已复原开关");
  const verdict = armA.reactionRows === 0 && armB.reactionRows > 0 ? "✅ 开关真控还手：关=0、开>0（ABM 树桩活着且受控）"
    : armA.reactionRows === 0 && armB.reactionRows === 0 ? `⚠ 两臂皆 0：${Number(armB.receivablePressure) > 12 ? "容忍线已越却不还手=链路断" : `容忍线未越（B 臂 receivablePressure=${JSON.stringify(armB.receivablePressure)}），探针力度问题非产品问题`}`
    : "⚠ 关着也还手，开关是假的";
  say(`双臂裁决：A=${armA.reactionRows} / B=${armB.reactionRows} ⇒ ${verdict}`);
  return { order: { id: big.id, cust: custName, value: big.props?.value }, customer: custObj?.id ?? null, putEnabled: enabled, armA, armB, verdict };
});

writeFileSync(OUT + "findings2.md", `# 探针第二击 findings（2026-09-18）\n\n${lines.join("\n")}\n`);
say("═══ 第二击走完 ═══");
