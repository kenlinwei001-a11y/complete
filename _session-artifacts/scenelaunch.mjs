import { launch, login, watch, newSink, goto, DC, AC } from './lib.mjs';

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const sink = newSink(); watch(page, sink);
await login(page, 'admin');

console.log('===== Scenario Launcher: 断链 scenes (S05/S12/S13/S14/S17/S19) =====');
await goto(page, '/scenarios');
await page.waitForTimeout(1000);
const brokenScenes = ['S05','S12','S13','S14','S17','S19'];
for (const s of brokenScenes) {
  const st = await page.evaluate((sNo) => {
    const card = document.querySelector(`[data-testid=launcher-card-${sNo}]`);
    if (!card) return { present: false };
    const launchBtn = card.querySelector(`[data-testid=launcher-launch-${sNo}]`);
    const maturity = card.querySelector(`[data-testid=launcher-maturity-${sNo}]`)?.textContent?.trim();
    return { present: true, maturity, launchDisabled: launchBtn?.disabled, hasViewDeveloping: !!card.querySelector(`[data-testid=launcher-developing-${sNo}]`) };
  }, s);
  console.log(`  ${s}:`, JSON.stringify(st));
}
// try launching S05 if present & enabled
const s05 = await page.evaluate(() => {
  const b = document.querySelector('[data-testid=launcher-launch-S05]');
  return { exists: !!b, disabled: b?.disabled };
});
console.log('\nS05 launch button:', JSON.stringify(s05));
if (s05.exists && !s05.disabled) {
  await page.click('[data-testid=launcher-launch-S05]');
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({ url: location.pathname, bodySnippet: document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,200), hasError: /出错|失败|error|没有|缺/i.test(document.body.innerText) }));
  console.log('after launching S05:', JSON.stringify(after));
  await page.screenshot({ path: '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/shots_s05_launch.png' });
}
if (sink.http.length) console.log('HTTP>=400:', JSON.stringify(sink.http.slice(-6)));
await ctx.close();

// ===== base_manager row-level isolation probe =====
console.log('\n===== base_manager:常州 row-level scope probe =====');
const bmTok = await (await fetch(DC + '/a/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 'demo', username: 'base_manager', password: 'demo1234' }) })).json().then(j => j.accessToken);
async function bm(path){ const r = await fetch(DC + path, { headers: { Authorization: 'Bearer ' + bmTok } }); return { status: r.status, text: await r.text() }; }
// Bases: base_manager:常州 should only see 常州/changzhou base data (A6 row filter)
const bases = await bm('/a/v1/objects?type=Base&q=');
try {
  const j = JSON.parse(bases.text);
  const items = j.items || j.objects || [];
  const baseNames = items.map(o => o.props?.name || o.props?.baseName || o.key || o.id);
  console.log('base_manager sees Base objects:', items.length, JSON.stringify(baseNames.slice(0,12)));
} catch(e){ console.log('Base query status', bases.status, bases.text.slice(0,150)); }
// admin sees all bases for comparison
const adminTok = await (await fetch(DC + '/a/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 'demo', username: 'admin', password: 'demo1234' }) })).json().then(j => j.accessToken);
const abases = await (await fetch(DC + '/a/v1/objects?type=Base&q=', { headers: { Authorization: 'Bearer ' + adminTok } })).json();
const aitems = abases.items || abases.objects || [];
console.log('admin sees Base objects:', aitems.length, JSON.stringify(aitems.map(o=>o.props?.name||o.key||o.id).slice(0,12)));

// cross-tenant: forge a different tenant in query — expect 403/404/empty
const xt = await (await fetch(DC + '/a/v1/objects?type=Base&q=&tenantId=other-tenant', { headers: { Authorization: 'Bearer ' + bmTok } }));
console.log('cross-tenant param probe (base_manager + tenantId=other-tenant): status', xt.status);

await browser.close();
console.log('\nDONE');
