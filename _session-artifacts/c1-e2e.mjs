const B = 'http://127.0.0.1:4001';
const H = { 'X-Debug-User': 'c1freshco2:admin:admin', 'Content-Type': 'application/json' };
const post = async (path, body) => {
  const r = await fetch(B + path, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t.slice(0, 300) }; }
};
const invoke = async () => {
  const r = await post('/a/v1/solvers/risk_timeline/invoke', { args: { base: '常州', factor: '物料齐套', horizon: 30 } });
  const d = r.json?.data || {};
  return { synthetic: d.confidence?.synthetic, dataMode: d.dataMode };
};
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// ① synthetic seed
const job = await post('/a/v1/synthetic/jobs', { industry: 'battery-manufacturing', scale: 'S', seed: 42 });
console.log('① synthetic job:', job.json?.id || job.status);
// ② before
const before = await invoke();
console.log('② BEFORE:', JSON.stringify(before));
// ③ upload real orders → objectify (NO manual invalidate)
const csv = 'so,cust,model,qty,due,status\nSO-1,星辰,4680-NCM,1200,2026-07-15,OPEN\nSO-2,远景,LFP-280,800,2026-07-20,OPEN';
const up = await post('/a/v1/uploads', { filename: 'real-orders.csv', contentBase64: b64(csv) });
const connId = up.json?.connection?.id;
console.log('③a upload connId:', connId, 'status:', up.status);
const obj = await post('/a/v1/databuilder/intake/objectify', { connId });
console.log('③b objectify:', JSON.stringify(obj.json?.materialized || obj.json || obj.text));
// ④ after
const after = await invoke();
console.log('④ AFTER:', JSON.stringify(after));
const pass = after.synthetic === false && after.dataMode !== 'SYNTHETIC';
console.log(pass
  ? 'C1 PASS ✅ — 诚实位经真实写路径(upload→objectify→runDerivations)自动翻转，零手动 invalidate'
  : 'C1 FAIL ❌ — AFTER 仍 SYNTHETIC（缓存未随写路径自动失效）');
