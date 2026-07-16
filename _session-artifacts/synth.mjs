import { launch, login, watch, newSink, goto, DC } from './lib.mjs';
const tok = await (await fetch(DC + '/a/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 'demo', username: 'admin', password: 'demo1234' }) })).json().then(j => j.accessToken);
async function dc(path) { const r = await fetch(DC + path, { headers: { Authorization: 'Bearer ' + tok } }); return { status: r.status, body: await r.json().catch(()=>null) }; }
async function count(path){ const r=await dc(path); const b=r.body; return Array.isArray(b)?b.length:(b?.items?.length ?? JSON.stringify(b).slice(0,80)); }

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const sink = newSink(); watch(page, sink);
await login(page, 'admin');
await goto(page, '/admin/data-builder');
await page.waitForTimeout(700);

const connBefore = await count('/a/v1/connections');
const dsBefore = await count('/a/v1/raw-datasets');
console.log('before: connections=', connBefore, 'raw-datasets=', dsBefore);

// set seed to a distinct value to force new deterministic dataset
await page.selectOption('[data-testid=qs-industry]', 'battery-manufacturing').catch(()=>{});
await page.selectOption('[data-testid=qs-scale]', 'S').catch(()=>{});
await page.fill('[data-testid=qs-seed]', '777');
await page.click('[data-testid=qs-run]');
// wait for report
await page.waitForSelector('[data-testid=qs-report]', { timeout: 20000 }).catch(()=>console.log('no qs-report within 20s'));
await page.waitForTimeout(1500);
const report = await page.evaluate(() => {
  const r = document.querySelector('[data-testid=qs-report]');
  if (!r) return null;
  const rows = Array.from(r.querySelectorAll('tbody tr')).map(tr=>tr.innerText.replace(/\s+/g,' ').trim());
  return { rows };
});
console.log('QS REPORT:', JSON.stringify(report));
await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots_db_synth_report.png' });

const connAfter = await count('/a/v1/connections');
const dsAfter = await count('/a/v1/raw-datasets');
console.log('after: connections=', connAfter, 'raw-datasets=', dsAfter);
console.log('LANDED (raw-datasets delta):', (typeof dsAfter==='number'&&typeof dsBefore==='number')? dsAfter-dsBefore : 'n/a');

if (sink.http.length) console.log('HTTP>=400:', JSON.stringify(sink.http.slice(-8)));
if (sink.pageerrors.length) console.log('PAGEERR:', JSON.stringify(sink.pageerrors.slice(-4)));
await ctx.close(); await browser.close(); console.log('DONE');
