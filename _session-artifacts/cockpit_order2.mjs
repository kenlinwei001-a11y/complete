import { launch, login, clearLogs, snapLogs, pageState, SHOT_DIR, BASE } from './driver.mjs';
const { browser, page, logs } = await launch();
await login(page, {username:'admin'});
await page.goto(`${BASE}/v/order-chain`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(3500);

async function ofcCondsP90(){
  const c = await page.$('[data-testid=ofc-conds]');
  if(!c) return null;
  const t = await c.innerText();
  const m = t.match(/P90\s*([\d.]+)/);
  return m ? m[1] : t.replace(/\s+/g,' ').slice(0,80);
}
async function judgeRowCap(){
  const c = await page.$('[data-testid=ofc-judge-row-cap]');
  return c ? (await c.innerText()).replace(/\s+/g,' ').trim() : null;
}

console.log('=== P90 per order (ofc-conds full precision vs backend) ===');
const orders = ['SO-3391','SO-3420','SO-3481','SO-3490','SO-3402','SO-3415','SO-3452','SO-3470','SO-3476','SO-3445'];
for (const so of orders){
  const s = await page.$('[data-testid=ofc-so-select]');
  await s.selectOption(so).catch(()=>{});
  await page.waitForTimeout(1600);
  console.log(`  ${so}: conds-P90=${await ofcCondsP90()}  | judgeRow="${await judgeRowCap()}"`);
}

// buttons
console.log('\n=== ofc buttons ===');
async function click(testid, label){
  const el = await page.$(`[data-testid="${testid}"]`);
  if(!el){ console.log(`  MISS ${label} (${testid})`); return; }
  clearLogs(logs);
  const before=(await page.evaluate(()=>document.body.innerText)).length;
  try{ await el.scrollIntoViewIfNeeded(); await el.click({timeout:4000}); }catch(e){ console.log(`  CLICKFAIL ${label}: ${String(e).slice(0,60)}`); return; }
  await page.waitForTimeout(1000);
  const after=(await page.evaluate(()=>document.body.innerText)).length;
  const st=await pageState(page); const s=snapLogs(logs);
  const http=s.net4xx5xx.filter(x=>!x.includes('history/bundle'));
  console.log(`  CLICK ${label}: Δ=${after-before}${st.errBoundary?' ERRBND':''}${http.length?' HTTP['+http[0]+']':''}${s.pageerr.length?' PAGEERR['+s.pageerr[0].slice(0,50)+']':''}`);
}
await click('ofc-adopt','采纳结论→工单');
// screenshot after adopt to see result
await page.screenshot({ path:`${SHOT_DIR}/order-after-adopt.png` }).catch(()=>{});
// dag nodes
console.log('\n=== ofc-dag nodes (9) ===');
for (const nid of ['ofc-dag-node-order:SO-3391','ofc-dag-node-jcap','ofc-dag-node-jfin','ofc-dag-node-vrd']){
  const el = await page.$(`[data-testid="${nid}"]`);
  if(!el){ console.log(`  MISS ${nid}`); continue; }
  clearLogs(logs);
  try{ await el.click({timeout:3000}); }catch(e){ console.log(`  ${nid} clickfail`); continue; }
  await page.waitForTimeout(900);
  const s=snapLogs(logs);
  console.log(`  ${nid}: pageerr=${s.pageerr.length} http=${s.net4xx5xx.filter(x=>!x.includes('history')).length}`);
}
// inline rows
console.log('\n=== inline detail rows expansion ===');
for (const so of ['SO-3391','SO-3452','SO-3470']){
  const r = await page.$(`[data-testid="oc-row-${so}"]`);
  if(!r){ console.log(`  MISS oc-row-${so}`); continue; }
  clearLogs(logs);
  const before=(await page.evaluate(()=>document.body.innerText)).length;
  await r.scrollIntoViewIfNeeded();
  try{ await r.click({timeout:3000}); }catch(e){ console.log(`  oc-row-${so} clickfail`); continue; }
  await page.waitForTimeout(2000);
  const after=(await page.evaluate(()=>document.body.innerText)).length;
  const sim = await page.$(`[data-testid="oc-sim-judge-${so}-cap"]`);
  const empty = await page.$(`[data-testid="oc-sim-empty-${so}"]`);
  const loading = await page.$(`[data-testid="oc-sim-loading-${so}"]`);
  const s=snapLogs(logs);
  console.log(`  oc-row-${so}: Δ=${after-before} simCap=${sim?'"'+(await sim.innerText()).replace(/\s+/g,' ').trim()+'"':(empty?'EMPTY':(loading?'LOADING':'none'))} pageerr=${s.pageerr.length}`);
  await r.click().catch(()=>{}); // collapse
}
// margin ledger, problems
console.log('\n=== ledger / problems / risk chips ===');
await click('oc-margin-ledger','毛利账本');
await click('oc-caliber','口径');
const prob = await page.$('[data-testid=oc-problem-cost]');
if(prob){ clearLogs(logs); await prob.scrollIntoViewIfNeeded(); await prob.click().catch(()=>{}); await page.waitForTimeout(1000); const modal=await page.$('[data-testid=problem-dag]'); console.log('  oc-problem-cost -> problem-dag:', modal?'OPENED':'none', 'pageerr='+snapLogs(logs).pageerr.length); if(modal){ const c=await page.$('[data-testid=problem-dag] button'); if(c) await c.click().catch(()=>{}); } }
const chip = await page.$('[data-testid=oc-risk-chip-SO-3391-常州]');
if(chip){ clearLogs(logs); await chip.scrollIntoViewIfNeeded(); await chip.click().catch(()=>{}); await page.waitForTimeout(1000); console.log('  oc-risk-chip clicked pageerr='+snapLogs(logs).pageerr.length); }

await browser.close();
console.log('\nDONE cockpit-order2');
