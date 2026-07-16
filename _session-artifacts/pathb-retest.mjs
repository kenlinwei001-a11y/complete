// Path B 重测（WO-1 构建）：直消 SSE，时间戳每帧，测延迟+流式+降级
const AC = "http://127.0.0.1:4002";
const DEMO = "demo:admin:admin|planner|catalog_admin";
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1);

const Q = "常州基地在途批次库存覆盖天数偏低，哪些设备检修计划会加剧交付风险？";
const sub = await fetch(`${AC}/api/v1/queries`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-Debug-User": DEMO, "Idempotency-Key": "retest-" + el() },
  body: JSON.stringify({ packageId: "pkg_battery_manufacturing", query: Q, context: { view: "dashboard", filters: {}, selectedObjects: [{ objectType: "Base", objectId: "changzhou", label: "常州" }] } }),
});
const subj = await sub.json();
console.log(`[t+${el()}s] POST queries → ${sub.status} taskId=${subj.taskId} status=${subj.status} path=${subj.path ?? "?"}`);
const taskId = subj.taskId;
if (!taskId) { console.log("无 taskId, body:", JSON.stringify(subj).slice(0, 200)); process.exit(1); }

// 消 SSE 事件流
const res = await fetch(`${AC}/api/v1/queries/${taskId}/events`, { headers: { "X-Debug-User": DEMO } });
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "", firstToken = null, evCount = 0, lastEv = "";
const deadline = Date.now() + 360000; // 6min 上限
while (Date.now() < deadline) {
  const { value, done } = await reader.read();
  if (done) { console.log(`[t+${el()}s] 流关闭 (done)`); break; }
  buf += dec.decode(value, { stream: true });
  const frames = buf.split("\n\n"); buf = frames.pop() ?? "";
  for (const f of frames) {
    const ev = (f.match(/event:\s*(.+)/) || [])[1] || "";
    const data = (f.match(/data:\s*([\s\S]+)/) || [])[1] || "";
    if (!ev) continue;
    evCount++;
    lastEv = ev;
    // 首个内容/答案 token
    if (firstToken == null && /token|delta|answer|text|message|step/i.test(ev)) { firstToken = el(); }
    // 只打关键帧，避免刷屏
    if (/classif|route|answer\.final|task\.(completed|failed|cancelled)|error|degrad|step\.(started|completed)/i.test(ev)) {
      console.log(`[t+${el()}s] ${ev} ${data.slice(0, 120)}`);
    }
    if (/task\.(completed|failed|cancelled)|answer\.final/i.test(ev)) {
      console.log(`\n=== 收敛 ===`);
      console.log(`首帧时延: ${firstToken ?? "?"}s | 总时延: ${el()}s | 事件数: ${evCount} | 末事件: ${ev}`);
      if (/answer\.final/.test(ev)) { try { const d = JSON.parse(data); console.log("trustLevel:", d.trustLevel, "| blocks:", (d.blocks||[]).map(b=>b.type).join(",")); console.log("答案首句:", JSON.stringify((d.blocks||[]).find(b=>b.markdown)?.markdown||"").slice(0,180)); } catch {} }
      process.exit(0);
    }
  }
}
console.log(`[t+${el()}s] 超时退出 (6min) 末事件=${lastEv} 事件数=${evCount}`);
