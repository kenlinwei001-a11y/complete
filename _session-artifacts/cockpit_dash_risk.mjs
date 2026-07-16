import { launch, login, clearLogs, snapLogs, pageState, SHOT_DIR, BASE } from './driver.mjs';
const { browser, page, logs } = await launch();
await login(page, {username:'admin'});

// ============ DASHBOARD PLAN DRILL (FAKE-02) ============
console.log('===== DASHBOARD v/dash — plan drill (FAKE-02) =====');
await page.goto(`${BASE}/v/dash`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(3000);
const drillPanel = await page.$('[data-testid=dash-plan-drill]');
console.log('dash-plan-drill present:', !!drillPanel);
async function drillSnapshot(){
  const p = await page.$('[data-testid=dash-plan-drill]');
  if(!p) return 'NO-PANEL';
  return (await p.innerText()).replace(/\s+/g,' ').slice(0,420);
}
for (const lv of ['op','month','quarter','year']){
  const b = await page.$(`[data-testid="drill-level-${lv}"]`);
  if(!b){ console.log(`  drill-level-${lv}: MISS`); continue; }
  clearLogs(logs);
  await b.scrollIntoViewIfNeeded();
  try{ await b.click({timeout:3000}); }catch(e){ console.log(`  drill-level-${lv} clickfail`); continue; }
  await page.waitForTimeout(1600);
  const s=snapLogs(logs); const http=s.net4xx5xx.filter(x=>!x.includes('history/bundle'));
  console.log(`  [level=${lv}]${http.length?' HTTP['+http[0]+']':''}${s.pageerr.length?' PAGEERR':''}`);
  console.log('     drill text:', await drillSnapshot());
}
await page.screenshot({ path:`${SHOT_DIR}/dash-drill-year.png` }).catch(()=>{});
// drill-dag / drill-to-generate / drill-to-audit
console.log('  -- drill nav buttons --');
for (const [tid,label] of [['drill-to-generate','去建议'],['drill-to-audit','去体检']]){
  const b = await page.$(`[data-testid="${tid}"]`);
  console.log(`  ${label} (${tid}):`, b?'present':'MISS');
}

// ============ RISK BOARD (FAKE-03) ============
console.log('\n===== RISK BOARD v/risk (FAKE-03 owner + cards) =====');
await page.goto(`${BASE}/v/risk`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(3500);
const st = await pageState(page);
console.log('risk textLen:', st.textLen);
const planPanel = await page.$('[data-testid=risk-plan-panel]');
console.log('risk-plan-panel (处置责任人表) present:', !!planPanel, '(expected HIDDEN under synthetic per topLive gate)');
if (planPanel){
  const ownerRows = await page.$$eval('[data-testid=risk-plan-table] tbody tr', trs => trs.slice(0,6).map(tr=>Array.from(tr.querySelectorAll('td')).map(td=>td.innerText.trim())));
  console.log('  owner rows:'); for(const r of ownerRows) console.log('    ', JSON.stringify(r));
}
// list risk testids
const riskTids = await page.$$eval('[data-testid]', els=>[...new Set(els.map(e=>e.getAttribute('data-testid')))].filter(t=>/risk|card|heat|affect|owner|plan|dot/i.test(t)));
console.log('risk-related testids:', riskTids.slice(0,40).join('  '));
// click first risk card -> affected orders popup
const cards = await page.$$('[data-testid^="risk-card-"]');
console.log('risk cards:', cards.length);
if (cards.length){
  clearLogs(logs);
  await cards[0].scrollIntoViewIfNeeded();
  const before=(await page.evaluate(()=>document.body.innerText)).length;
  try{ await cards[0].click({timeout:3000}); }catch(e){ console.log('  card click fail'); }
  await page.waitForTimeout(1500);
  const after=(await page.evaluate(()=>document.body.innerText)).length;
  const pop = await page.$('[data-testid^="risk-popover"], [data-testid*="affected"], [class*="popover"], [class*="Popover"]');
  const s=snapLogs(logs);
  console.log(`  card0 click: Δ=${after-before} popover=${pop?'OPENED':'none'} pageerr=${s.pageerr.length} http=${s.net4xx5xx.filter(x=>!x.includes('history')).length}`);
}
await page.screenshot({ path:`${SHOT_DIR}/risk-board.png`, fullPage:true }).catch(()=>{});

await browser.close();
console.log('\nDONE cockpit-dash-risk');
