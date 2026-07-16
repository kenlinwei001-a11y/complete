// WO-Q1 增量2 复验：Path B 自由问句·捕获 SSE answer.delta 增量帧·真 Kimi
const AC = "http://127.0.0.1:4002", DC = "http://127.0.0.1:4001";
const t0 = Date.now(); const el = () => ((Date.now() - t0) / 1000).toFixed(1);
const tok = await (await fetch(`${DC}/a/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }) })).json();
const JWT = tok.accessToken;
const Q = "用一句话介绍这个平台能帮制造业做什么。";
const sub = await fetch(`${AC}/api/v1/queries`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${JWT}` }, body: JSON.stringify({ packageId: "pkg_battery_manufacturing", query: Q, context: { view: "dash", selectedObjects: [], filters: {} } }) });
const sj = await sub.json();
console.log(`[t+${el()}s] POST → ${sub.status} task=${sj.taskId} path=${sj.path ?? "?"}`);
const res = await fetch(`${AC}/api/v1/queries/${sj.taskId}/events`, { headers: { Authorization: `Bearer ${JWT}` } });
const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
let deltaText = 0, deltaReason = 0, firstDelta = null, lastShown = 0, txtAccum = "", reasonAccum = "";
const classifyFrames = [];
const dl = Date.now() + 240000;
while (Date.now() < dl) {
  const { value, done } = await rd.read(); if (done) { console.log(`[t+${el()}s] 流关闭`); break; }
  buf += dec.decode(value, { stream: true });
  const frames = buf.split("\n\n"); buf = frames.pop() ?? "";
  for (const f of frames) {
    const ev = (f.match(/event:\s*(.+)/) || [])[1] || ""; const data = (f.match(/data:\s*([\s\S]+)/) || [])[1] || "";
    if (!ev) continue;
    if (ev === "answer.delta") {
      if (firstDelta == null) { firstDelta = el(); console.log(`[t+${el()}s] 首个 answer.delta 帧 ✓（终答开始增量流式·非静默）`); }
      try { const d = JSON.parse(data); if (d.text) { deltaText++; txtAccum += d.text; } if (d.reasoning) { deltaReason++; reasonAccum += d.reasoning; } } catch {}
      // 每 ~40 帧打一次累计快照，证明"增量增长"
      const tot = deltaText + deltaReason;
      if (tot - lastShown >= 60) { lastShown = tot; console.log(`  [t+${el()}s] 累计 delta=${tot}（text ${deltaText}/reason ${deltaReason}）· 答案累计「${txtAccum.slice(-28)}」`); }
    } else if (/step\.(started|completed)/.test(ev) && /classify/.test(data)) {
      classifyFrames.push(el());
    } else if (ev === "answer.final") {
      console.log(`\n[t+${el()}s] answer.final`);
      try { const d = JSON.parse(data); console.log("  trustLevel:", d.trustLevel, "| 最终答案首句:", JSON.stringify((d.blocks || []).find((b) => b.markdown)?.markdown || "").slice(0, 90)); } catch {}
      console.log(`\n=== 判据 ===`);
      console.log(`① 分类期首帧: ${classifyFrames[0] ?? "无"}s（≤5s 非静默）`);
      console.log(`② 终答增量流式: answer.delta 总 ${deltaText + deltaReason} 帧（text ${deltaText} + reason ${deltaReason}）· 首 delta @ ${firstDelta}s`);
      console.log(`   增量证据: text 累计 ${txtAccum.length} 字 / reasoning 累计 ${reasonAccum.length} 字（逐帧累加·非一次性）`);
      console.log(`   reasoning 捕获(WO-Q1 根因·此前被丢): ${deltaReason > 0 ? "✓ 真捕获" : "✗"}`);
      process.exit(0);
    } else if (/task\.(failed|cancelled)/.test(ev)) { console.log(`[t+${el()}s] ${ev} ${data.slice(0,100)}`); process.exit(0); }
  }
}
console.log(`[t+${el()}s] 超时退出 · delta 帧=${deltaText + deltaReason}`);
