import { readFileSync, writeFileSync, existsSync } from "node:fs";
/**
 * #105 验收取数：10 题 × N 次（默认 5）真 Kimi 端到端矩阵。
 *
 * 为什么是「连跑 N 次」而不是「跑一遍」：
 * 起点 3/10 → 一轮修复后单次 8/10，但把其中一题单独跑 5 次会出 **4 种不同结果**。
 * 单次跑分测的是运气不是稳定性，故判据换成：**5/5 稳定 COMPLETED 且 clarificationRounds===0**。
 * 任何跑次分歧即未达标。
 *
 * 已知豁免 #10「采纳常州的三班制方案」：用户没说风险因子，系统问一句是对的。
 * 它的判据是「一次澄清 + 回答后能完成」，不是零反问 —— 故本脚本对 #10 会**应答澄清**再继续轮询。
 *
 * 用法：node run-matrix.mjs <datacorePort> <agentcorePort> [runs] [outFile]
 *
 * 纪律：每次跑完立刻落盘（容器随时被回收，不落盘就等于没跑）。
 * token 每次跑前刷新 —— 上一轮 30/35 题被 UNAUTHORIZED 打掉是脚本 bug，不是产品缺陷，这里根除它。
 */
const S = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const DC = `http://127.0.0.1:${process.argv[2] || 4601}`;
const AC = `http://127.0.0.1:${process.argv[3] || 4602}`;
const RUNS = Number(process.argv[4] || 5);
const OUT = process.argv[5] || `${S}/kimi-accept-matrix.json`;
const Q = JSON.parse(readFileSync(`${S}/accept10.json`, "utf8"));
const POLL_MAX = 200; // 秒；有条路径的看门狗默认 180s

let TOK = "";
const refresh = async () => {
  const r = await fetch(`${DC}/a/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
  });
  const j = await r.json();
  if (!j.accessToken) throw new Error(`login failed: ${JSON.stringify(j).slice(0, 200)}`);
  TOK = j.accessToken;
};
const H = () => ({ Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED"];

async function poll(taskId, maxSec, stopOnClarify = true) {
  let t = null;
  for (let i = 0; i < maxSec; i++) {
    const res = await fetch(`${AC}/api/v1/queries/${taskId}`, { headers: H() });
    t = await res.json();
    if (res.status === 401) throw new Error("UNAUTHORIZED_WHILE_POLLING"); // 脚本 bug 要显式炸，别静默成产品缺陷
    if (TERMINAL.includes(t.status)) return t;
    if (stopOnClarify && t.status === "AWAITING_CLARIFICATION") return t;
    await sleep(1000);
  }
  return { ...(t || {}), status: `TIMEOUT(${t?.status ?? "?"})` };
}

/** 从 pendingClarification 造一个应答（#10 豁免路径用）。 */
function buildReply(pc) {
  if (!pc) return null;
  if (pc.kind === "INTENT_CHOICE") {
    const k = pc.intents?.[0]?.intentKey;
    return k ? { kind: "INTENT_CHOICE", chosenIntentKey: k } : null;
  }
  const slotValues = {};
  for (const s of pc.slots || []) {
    // 有候选优先用第一个候选（系统自己给的合法值）；否则给一个业务上合理的字面量
    if (s.candidates?.length) slotValues[s.name] = s.candidates[0].objectId;
    else slotValues[s.name] = "物料齐套"; // 风险因子：本题语境下的合理回答
  }
  return { kind: "SLOT_FILLING", slotValues };
}

function snap(t, ms) {
  return {
    ms,
    status: t?.status,
    rounds: t?.clarificationRounds ?? -1,
    slots: t?.classification?.extractedSlots ?? null,
    routed: (t?.classification?.candidates || [])[0]?.intentKey ?? null,
    routedConf: (t?.classification?.candidates || [])[0]?.confidence ?? null,
    matched: t?.matchedIntent?.intentKey ?? null,
    path: t?.path ?? null,
    taskSlots: t?.slots ?? null,
    slotResolutions: t?.slotResolutions ?? null,
    pending: t?.pendingClarification ?? null,
    error: t?.error ?? null,
    answerHead: (t?.answer?.blocks || []).map((b) => b.markdown || "").join(" ").replace(/\s+/g, " ").slice(0, 160),
  };
}

async function runOnce(q) {
  const t0 = Date.now();
  await refresh(); // 每次跑前刷新：把 token 过期彻底排除出变量
  const subRes = await fetch(`${AC}/api/v1/queries`, {
    method: "POST",
    headers: H(),
    body: JSON.stringify({
      packageId: "pkg_battery_manufacturing",
      query: q.query,
      context: { view: q.view, selectedObjects: [], filters: {} },
    }),
  });
  const sub = await subRes.json();
  if (!sub.taskId) {
    return { taskId: null, ...snap(null, Date.now() - t0), status: "SUBMIT_FAIL", submitErr: JSON.stringify(sub).slice(0, 300) };
  }
  let t = await poll(sub.taskId, POLL_MAX);
  const first = snap(t, Date.now() - t0);

  // #10 豁免：一次澄清 + 回答后能完成 = 达标。其余题目 AWAITING_CLARIFICATION 即未达标（不再应答）。
  if (q.no === 10 && t.status === "AWAITING_CLARIFICATION") {
    const reply = buildReply(t.pendingClarification);
    if (!reply) {
      return { taskId: sub.taskId, ...first, exemptOutcome: "NO_PENDING_PAYLOAD" };
    }
    const rr = await fetch(`${AC}/api/v1/queries/${sub.taskId}/clarification`, {
      method: "POST", headers: H(), body: JSON.stringify(reply),
    });
    if (rr.status >= 300) {
      return { taskId: sub.taskId, ...first, replySent: reply, exemptOutcome: `REPLY_HTTP_${rr.status}`, replyErr: (await rr.text()).slice(0, 300) };
    }
    const t2 = await poll(sub.taskId, POLL_MAX, false);
    const after = snap(t2, Date.now() - t0);
    return {
      taskId: sub.taskId, ...first,
      replySent: reply,
      afterReply: after,
      exemptOutcome: after.status === "COMPLETED" ? "COMPLETED_AFTER_1_CLARIFY" : `AFTER_REPLY_${after.status}`,
    };
  }
  return { taskId: sub.taskId, ...first };
}

// ---------------------------------------------------------------------------
const results = existsSync(OUT) && process.env.RESUME === "1" ? JSON.parse(readFileSync(OUT, "utf8")) : [];
const done = new Set(results.map((r) => `${r.no}#${r.run}`));
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 1));

for (const q of Q) {
  for (let run = 1; run <= RUNS; run++) {
    if (done.has(`${q.no}#${run}`)) { console.log(`⏭  #${q.no} run${run} 已有结果，跳过`); continue; }
    let r;
    try {
      r = await runOnce(q);
    } catch (e) {
      r = { status: "SCRIPT_ERROR", scriptErr: String(e).slice(0, 300), rounds: -1, ms: -1 };
    }
    const rec = { no: q.no, run, intent: q.intent, view: q.view, query: q.query, why: q.why, ...r };
    // 达标判据：#10 走豁免（一次澄清后完成），其余必须 COMPLETED 且零反问
    rec.pass = q.no === 10
      ? rec.exemptOutcome === "COMPLETED_AFTER_1_CLARIFY" || (rec.status === "COMPLETED" && rec.rounds === 0)
      : rec.status === "COMPLETED" && rec.rounds === 0;
    results.push(rec);
    save(); // 每跑必落盘
    console.log(
      `${rec.pass ? "✅" : "❌"} #${String(q.no).padStart(2)} run${run} ${String(rec.ms).padStart(6)}ms ` +
      `${String(rec.status).padEnd(24)} rounds=${rec.rounds} routed=${rec.routed ?? "-"} ` +
      `slots=${JSON.stringify(rec.slots)}${rec.exemptOutcome ? ` exempt=${rec.exemptOutcome}` : ""}` +
      `${rec.error ? ` err=${rec.error.code}:${String(rec.error.message).slice(0, 80)}` : ""}`,
    );
  }
}
save();

// --- 汇总 ---
console.log(`\n═══ 10×${RUNS} 矩阵汇总 ═══`);
let stable = 0;
for (const q of Q) {
  const rs = results.filter((r) => r.no === q.no);
  const passes = rs.filter((r) => r.pass).length;
  const dist = {};
  for (const r of rs) {
    const k = q.no === 10 ? (r.exemptOutcome || `${r.status}/r${r.rounds}`) : `${r.status}/r${r.rounds}`;
    dist[k] = (dist[k] || 0) + 1;
  }
  const ok = passes === rs.length && rs.length === RUNS;
  if (ok) stable++;
  console.log(`${ok ? "✅ 5/5 稳定" : "❌ 分歧/未达标"} #${String(q.no).padStart(2)} ${passes}/${rs.length}  ${JSON.stringify(dist)}  「${q.query.slice(0, 24)}」`);
}
console.log(`\n═══ 总分 ${stable}/10 达标（5/5 稳定）═══`);
console.log(`结果落盘：${OUT}`);
