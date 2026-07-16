import fs from 'fs';
const AC = 'http://127.0.0.1:4182';
const TOKEN = fs.readFileSync('/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/admin_token.txt','utf8').trim();
const H = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function submitAndStream(query, view='dash', ms=9000) {
  const sub = await fetch(`${AC}/b/v1/queries`, { method:'POST', headers:{...H,'Idempotency-Key':crypto.randomUUID()}, body: JSON.stringify({ packageId:'pkg_battery_manufacturing', query, context:{ view, selectedObjects:[], filters:{} } }) });
  const subj = await sub.json();
  if (!subj.taskId) { console.log('SUBMIT FAIL:', JSON.stringify(subj)); return; }
  const taskId = subj.taskId;
  console.log(`\n### QUERY: ${query}  (view=${view})`);
  console.log(`### taskId=${taskId} status=${subj.status} streamUrl=${subj.streamUrl}`);
  // stream events
  const ac = new AbortController();
  const to = setTimeout(()=>ac.abort(), ms);
  const events = [];
  try {
    const res = await fetch(`${AC}${subj.streamUrl}`, { headers:H, signal:ac.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream:true});
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx+2);
        const ev = {};
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event:')) ev.event = line.slice(6).trim();
          else if (line.startsWith('data:')) ev.data = (ev.data||'') + line.slice(5).trim();
        }
        if (ev.event || ev.data) events.push(ev);
      }
    }
  } catch(e) { /* aborted */ }
  clearTimeout(to);
  console.log(`### ${events.length} SSE events:`);
  for (const e of events) {
    let dp = e.data || '';
    try { const j = JSON.parse(dp); dp = JSON.stringify(j).slice(0,220); } catch {}
    console.log(`  [${e.event||'message'}] ${dp.slice(0,220)}`);
  }
  // final
  const t = await (await fetch(`${AC}/b/v1/queries/${taskId}`, {headers:H})).json();
  console.log(`### FINAL status=${t.status} intent=${t.classification?.candidates?.[0]?.intentKey} conf=${t.classification?.candidates?.[0]?.confidence} model=${t.classification?.model}`);
  if (t.answer) console.log(`### answer: ${JSON.stringify(t.answer).slice(0,300)}`);
  if (t.clarification) console.log(`### clarification: ${JSON.stringify(t.clarification).slice(0,300)}`);
  return { taskId, t };
}

const queries = process.argv.slice(2);
const list = queries.length ? queries.map(q=>[q,'dash']) : [
  ['4680-NCM 加 20% 六周能不能接？','project-sim'],
  ['常州基地影响哪些订单？','risk'],
  ['现金垫 45 亿过得了体检吗？','plan-audit'],
  ['未来六个月需求预测多少？','dash'],
];
for (const [q,v] of list) { await submitAndStream(q, v); }
