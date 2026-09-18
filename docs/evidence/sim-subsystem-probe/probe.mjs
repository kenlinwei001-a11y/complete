// 子系统存在性·亲测探针（2026-09-18）
// 仓主令：「不要仅仅基于 grep，而是亲自输入扰动因素去验证」。
// 对象：grep 轮claim过「存在」的子系统 —— 演习 drill/分叉、counterfactual 双臂、
//       对抗方还手（ABM 树桩）、校准/回测、场景目录、base_capacity_outlook、引擎级 UQ 缺席。
// 纪律（与控制台 E2E 同）：逐步 try/catch，异常原文落盘不绕行；每步写 <step>.json + <step>.rc；
// 对照实验判据：能双臂的绝不单臂（对抗方开/关两臂、反事实开/关边两臂、未知键 400 一臂）。
import { writeFileSync } from "node:fs";

const DC = "http://127.0.0.1:4001";
const AC = "http://127.0.0.1:4002";
const OUT = new URL("./", import.meta.url).pathname;
let TOKEN = "";
const lines = [];
const say = (s) => { const l = `[${new Date().toISOString().slice(11, 19)}] ${s}`; lines.push(l); console.log(l); };

async function api(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 3000) }; }
  return { status: res.status, json };
}
const dc = (m, p, b) => api(DC, m, p, b);
const ac = (m, p, b) => api(AC, m, p, b);
function ev(name, data, rc = 0) {
  writeFileSync(OUT + name + ".json", JSON.stringify(data, null, 2));
  writeFileSync(OUT + name + ".rc", String(rc) + "\n");
}
async function step(name, fn) {
  try { const data = await fn(); ev(name, data ?? { ok: true }, 0); return data; }
  catch (e) { say(`🔴 ${name} 异常（不绕行，原文落盘）：${e instanceof Error ? e.message : String(e)}`); ev(name, { exception: String(e instanceof Error ? e.stack ?? e.message : e) }, 1); return null; }
}
const items = (j) => Array.isArray(j) ? j : (j.items ?? j.sessions ?? []);

// ── S0 登录 ────────────────────────────────────────────────────────────────
await step("s0-login", async () => {
  const r = await dc("POST", "/a/v1/auth/login", { tenantId: "demo", username: "admin", password: "demo1234" });
  TOKEN = String(r.json.accessToken ?? r.json.token ?? "");
  if (r.status !== 200 || TOKEN === "") throw new Error(`login status=${r.status} body=${JSON.stringify(r.json).slice(0, 300)}`);
  say(`登录 OK（demo/admin）token ${TOKEN.length} 字符`);
  return { status: r.status, tokenLen: TOKEN.length };
});

// ── S1 会话基线 ─────────────────────────────────────────────────────────────
let demoCurTick = null;
await step("s1-sessions", async () => {
  const r = await dc("GET", "/a/v1/sim/sessions");
  const list = items(r.json);
  const demo = list.find((s) => s.id === "sims_demo_seed_world");
  demoCurTick = demo?.curTick ?? null;
  say(`会话列表 ${list.length} 条；demo 会话 curTick=${String(demoCurTick)} status=${demo?.status} adversaryEnabled=${String(demo?.adversaryEnabled)} suppressed=${JSON.stringify(demo?.adversarySuppressed ?? null)}`);
  return { status: r.status, count: list.length, demo: demo ?? null };
});

// ── S2 对抗方特性开关·当前值 ────────────────────────────────────────────────
await step("s2-features", async () => {
  const r = await dc("GET", "/a/v1/features/registry");
  const s = JSON.stringify(r.json);
  const i = s.indexOf("adversary");
  say(`features registry 命中 adversary 片段：${i >= 0 ? s.slice(Math.max(0, i - 60), i + 160) : "（无）"}`);
  return { status: r.status, adversarySnippet: i >= 0 ? s.slice(Math.max(0, i - 60), i + 160) : null };
});

// ── S3 演习 drill：事件 → fork → 双引擎 → 扫描（亲输扰动事件）────────────────
await step("s3-drill", async () => {
  const cat = await dc("GET", "/a/v1/sim/drill/catalog");
  const specs = cat.json.specs ?? [];
  const kinds = specs.map((s) => `${s.kind}${s.stateEffect ? "+stateEffect" : ""}`);
  say(`drill 目录 ${specs.length} 类事件：${kinds.join(" | ")}`);
  // 优先挑带 stateEffect 的价格类事件（碳酸锂/材料涨价 —— G-DRILL-3 注释里点名的那条路径）
  const pick = specs.find((s) => s.stateEffect && /PRICE|REPRICE|MATERIAL/i.test(String(s.kind))) ?? specs.find((s) => s.stateEffect) ?? specs[0];
  if (!pick) throw new Error("drill 目录为空");
  const ev0 = { kind: pick.kind, targetObjectId: "obj_material_al_foil", payload: { pct: 15, deltaPct: 15, magnitude: 15 }, effectiveDay: 1 };
  const before = (await dc("GET", "/a/v1/sim/sessions/sims_demo_seed_world")).json;
  const run = await dc("POST", "/a/v1/sim/sessions/sims_demo_seed_world/drill", { events: [ev0], horizonDays: 7 });
  const after = (await dc("GET", "/a/v1/sim/sessions/sims_demo_seed_world")).json;
  const j = run.json;
  const findingKinds = Object.fromEntries(Object.entries(j.findings ?? j).filter(([k]) => /choke|fragile|finding|unevaluated/i.test(k)).map(([k, v]) => [k, Array.isArray(v) ? v.length : v]));
  say(`drill 事件=${pick.kind}@铝箔(+15) status=${run.status} forkedFromStateId=${JSON.stringify(j.forkedFromStateId ?? "（键缺席）")}`);
  say(`drill 结论键：${Object.keys(j).join(",")} ；findings 概览=${JSON.stringify(findingKinds).slice(0, 400)}`);
  say(`drill 只读核验：curTick ${before.curTick} → ${after.curTick}（不变=演习没推歪世界线）；扰动账 ${(before.perturbationCount ?? "?")}→${(after.perturbationCount ?? "?")}`);
  return { status: run.status, pick: pick.kind, catalogKinds: kinds, response: j, readOnly: { before: before.curTick, after: after.curTick } };
});

// ── S4 反事实 counterfactual：双臂 + 未知键拒跑 ─────────────────────────────
await step("s4-counterfactual", async () => {
  const good = await dc("POST", "/a/v1/sim/sessions/sims_demo_seed_world/counterfactual", { n: 2, disabledRuleKeys: ["demo_material_price_to_model_cost"] });
  const g = good.json;
  const diffCount = g.diffs ? Object.keys(g.diffs).length : null;
  say(`反事实（关 demo_material_price_to_model_cost, n=2）status=${good.status} 差分格数=${String(diffCount)} firedInBaseline=${JSON.stringify(g.suppressedRulesFiredInBaseline ?? null)}`);
  const bad = await dc("POST", "/a/v1/sim/sessions/sims_demo_seed_world/counterfactual", { n: 1, disabledRuleKeys: ["zz_no_such_rule"] });
  say(`未知键对照臂 status=${bad.status} code=${g === null ? "?" : String(bad.json?.error?.code ?? bad.json?.code ?? "?")} msg=${String(bad.json?.error?.message ?? "").slice(0, 120)}`);
  return { good: { status: good.status, diffCount, firedInBaseline: g.suppressedRulesFiredInBaseline ?? null, keys: Object.keys(g) }, bad: { status: bad.status, body: bad.json } };
});

// ── S5 对抗方还手·双臂（亲输成本冲击扰动）────────────────────────────────────
await step("s5-adversary-twin-arm", async () => {
  const orders = items((await dc("GET", "/a/v1/objects?type=Order&pageSize=500")).json);
  const big = orders.slice().sort((a, b) => Number(b.props?.value ?? 0) - Number(a.props?.value ?? 0))[0];
  if (!big) throw new Error("订单簿为空");
  say(`最大订单：${big.id} cust=${String(big.props?.cust)} value=${String(big.props?.value)}`);
  const runArm = async (tag) => {
    const sess = (await dc("POST", "/a/v1/sim/sessions", {})).json;
    const pid = sess.id;
    const p = await dc("POST", `/a/v1/sim/sessions/${pid}/perturbations`, {
      kind: "cost_shock", targetObjectId: big.id, targetStateVar: "costPressure",
      magnitude: 80, mode: "delta", startTick: 0, durationTicks: null, label: `探针${tag}·成本冲击+80`,
    });
    const t = await dc("POST", `/a/v1/sim/sessions/${pid}/tick?disclose=1`, { n: 3 });
    const trace = t.json.trace ?? [];
    const rows = trace.filter((r) => r.ruleKey === "demo_customer_reaction_cut_order");
    const disc = t.json.disclosure ?? {};
    const adv = disc.rules?.adversaryEnabled ?? disc.adversaryEnabled ?? null;
    say(`臂${tag}：会话 ${pid} 施扰 status=${p.status} tick status=${t.status} trace=${trace.length}行 还手规则行数=${rows.length} disclosure.adversaryEnabled=${JSON.stringify(adv)}`);
    if (rows.length > 0) say(`臂${tag} 还手样本：${JSON.stringify(rows.slice(0, 3)).slice(0, 500)}`);
    const w = (await dc("GET", `/a/v1/sim/sessions/${pid}/world`)).json;
    const state = w.state ?? w;
    const custObj = items((await dc("GET", "/a/v1/objects?type=Customer&pageSize=500")).json).find((o) => String(o.props?.name ?? o.props?.cust ?? "") === String(big.props?.cust));
    const recv = custObj ? state[custObj.id]?.receivablePressure : undefined;
    const churn = state[big.id]?.orderChurn;
    say(`臂${tag}：客户=${custObj?.id ?? "（未匹配）"} receivablePressure=${JSON.stringify(recv)}（容忍线 12） 订单 orderChurn=${JSON.stringify(churn)}`);
    return { session: pid, perturbStatus: p.status, traceRows: trace.length, reactionRows: rows.length, reactionSample: rows.slice(0, 5), adversaryEnabled: adv, receivablePressure: recv ?? null, orderChurn: churn ?? null };
  };
  const armA = await runArm("A(关)");
  const put = await dc("PUT", "/a/v1/tenants/demo/features", { overrides: { "sim.propagation.adversary": true } });
  say(`PUT features 开对抗方 status=${put.status} 回包含 adversary 片段：${JSON.stringify(put.json).slice(0, 200)}`);
  const armB = await runArm("B(开)");
  const restore = await dc("PUT", "/a/v1/tenants/demo/features", { overrides: { "sim.propagation.adversary": false } });
  say(`已复原开关 status=${restore.status}。双臂对照：A 还手 ${armA.reactionRows} 行 / B 还手 ${armB.reactionRows} 行 ⇒ ${armA.reactionRows === 0 && armB.reactionRows > 0 ? "✅ 开关真控还手（ABM 树桩活着）" : armA.reactionRows === 0 && armB.reactionRows === 0 ? "⚠ 开了也不还手（容忍线未越/链路未通，逐行查样本）" : "⚠ 关着也还手？！"}`);
  return { order: { id: big.id, cust: big.props?.cust, value: big.props?.value }, armA, armB, putStatus: put.status, restoreStatus: restore.status };
});

// ── S6 校准/回测 ────────────────────────────────────────────────────────────
await step("s6-calibration", async () => {
  const [rep, prop, hist] = await Promise.all([
    dc("GET", "/a/v1/calibration/report"), dc("GET", "/a/v1/calibration/proposals"), dc("GET", "/a/v1/calibration/history"),
  ]);
  say(`校准 GET：report=${rep.status} proposals=${prop.status} history=${hist.status}；proposals 条数=${Array.isArray(prop.json) ? prop.json.length : JSON.stringify(prop.json).slice(0, 120)}`);
  const run = await dc("POST", "/a/v1/calibration/run", {});
  const rj = JSON.stringify(run.json);
  say(`校准 runAll status=${run.status} 回包前 600 字：${rj.slice(0, 600)}`);
  return { report: { status: rep.status, body: rep.json }, proposals: { status: prop.status, body: prop.json }, history: { status: hist.status, body: hist.json }, run: { status: run.status, body: run.json } };
});

// ── S7 场景目录（agentcore）─────────────────────────────────────────────────
await step("s7-scenarios", async () => {
  const r = await ac("GET", "/b/v1/scenarios");
  const list = items(r.json);
  const one = list[0] ?? null;
  say(`场景目录 status=${r.status} 卡数=${list.length}；首卡=${one ? `${one.sNo} ${one.name} solver=${one.solver}(${one.solverStatus}) presetContext键=${Object.keys(one.presetContext ?? {}).join(",")}` : "（空）"}`);
  return { status: r.status, count: list.length, first: one, all: list.map((x) => `${x.sNo}:${x.solver}:${x.solverStatus}`) };
});

// ── S8 base_capacity_outlook（前瞻产能推演·置信口径）─────────────────────────
await step("s8-base-outlook", async () => {
  const bases = items((await dc("GET", "/a/v1/objects?type=Base&pageSize=50")).json);
  const b0 = bases[0];
  const baseId = String(b0?.props?.baseId ?? b0?.id ?? "");
  say(`基地候选 ${bases.length} 个，取 ${baseId || "（空）"}（${String(b0?.props?.name ?? "")}）`);
  const r = await dc("POST", "/a/v1/solvers/base_capacity_outlook/invoke", { args: { baseId } });
  const s = JSON.stringify(r.json);
  const hits = ["SPE", "PRMS", "置信", "p50", "p90", "P50", "P90"].filter((k) => s.includes(k));
  say(`outlook status=${r.status} 顶层键=${r.json?.data ? Object.keys(r.json.data).join(",") : Object.keys(r.json).join(",")}；置信口径命中=${hits.join("/") || "（无）"}`);
  return { status: r.status, baseId, topKeys: r.json?.data ? Object.keys(r.json.data) : Object.keys(r.json), confidenceHits: hits, snippet: s.slice(0, 800) };
});

// ── S9 引擎级 UQ 探针（往 tick 里塞 ensemble/distribution，看收不收）─────────
await step("s9-uq-probe", async () => {
  const r = await dc("POST", "/a/v1/sim/sessions/sims_demo_seed_world/tick", { n: 1, ensemble: 3, distribution: "p90", seeds: [1, 2, 3] });
  const keys = Object.keys(r.json);
  const echoed = ["ensemble", "distribution", "seeds", "p90", "confidence"].filter((k) => keys.includes(k) || JSON.stringify(r.json).includes(`"${k}"`));
  say(`UQ 探针 status=${r.status} 回包顶层键=${keys.join(",")}；UQ 字段回声=${echoed.join("/") || "（零）"} ⇒ ${r.status === 200 && echoed.length === 0 ? "knob 不存在且被静默忽略（tick 体是手读 n，非 zod 解析）" : "有回响，另判"}`);
  return { status: r.status, topKeys: keys, uqEcho: echoed };
});

writeFileSync(OUT + "findings.md", `# 子系统存在性·亲测探针 findings（2026-09-18）\n\n${lines.join("\n")}\n`);
say("═══ 探针走完（各步异常已逐条落盘，未绕行）═══");
