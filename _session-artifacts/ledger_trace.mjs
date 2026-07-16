import { launch, login, clearLogs, snapLogs, pageState, BASE, SHOT_DIR } from './driver.mjs';
const { browser, page, logs } = await launch();
await login(page, {username:'admin'});

// ===== Ledger view (v/order) =====
console.log('===== LEDGER v/order =====');
await page.goto(`${BASE}/v/order`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(3000);
const tids = await page.$$eval('[data-testid]', els=>[...new Set(els.map(e=>e.getAttribute('data-testid')))].filter(t=>!/^nav-|^board-|^health|tenant-name|global-search|history-clock|notif-|user-menu|left-nav|query-dock/.test(t)));
console.log('ledger testids:', tids.slice(0,30).join('  '));
// click provenance / derivation / evidence buttons
let clicked=0, errs=0;
for (const t of tids.filter(x=>/prov|deriv|evidence|ledger|派生|证据|账本|drill|expand|row/i.test(x)).slice(0,8)){
  const el = await page.$(`[data-testid="${t}"]`);
  if(!el) continue;
  clearLogs(logs);
  try{ await el.scrollIntoViewIfNeeded(); await el.click({timeout:2500}); clicked++; }catch(e){ continue; }
  await page.waitForTimeout(500);
  const s=snapLogs(logs); const st=await pageState(page);
  if(st.errBoundary||s.pageerr.length||s.net4xx5xx.filter(x=>!x.includes('history')).length){ errs++; console.log(`  ${t}: ERR pageerr=${s.pageerr.length}`); }
}
console.log(`ledger: clicked ${clicked} prov/evidence buttons, ${errs} errors`);

// ===== QOS decision trace link (查看完整执行过程) =====
console.log('\n===== QOS EVIDENCE CHAIN (查看完整执行过程) =====');
await page.goto(`${BASE}/v/risk`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2000);
let input = await page.$('[data-testid=query-dock-bar] input');
await input.fill('常州基地影响哪些订单？');
await input.press('Enter');
for (let i=0;i<16;i++){
  await page.waitForTimeout(1500);
  const sf = await page.$('[data-testid=slot-form]');
  if (sf){ for (const t of await sf.$$('input[type=text]')){ await t.fill('常州'); await page.waitForTimeout(500); const o=await page.$('ul[role=listbox] button[role=option]'); if(o) await o.click().catch(()=>{});} const b=await sf.$('button[type=submit]'); if(b){await b.click(); await page.waitForTimeout(2500);} continue; }
  if (await page.$('[data-testid=answer-card]')) break;
}
const traceLink = await page.$('button:has-text("查看完整执行过程"), a:has-text("查看完整执行过程"), [data-testid*="trace"], [data-testid*="process"]');
if (traceLink){
  clearLogs(logs);
  const before=(await page.evaluate(()=>document.body.innerText)).length;
  await traceLink.scrollIntoViewIfNeeded();
  await traceLink.click().catch(e=>console.log('trace click err', String(e).slice(0,50)));
  await page.waitForTimeout(2500);
  const after=(await page.evaluate(()=>document.body.innerText)).length;
  const s=snapLogs(logs);
  console.log(`查看完整执行过程 click: Δ=${after-before} url=${page.url().replace(BASE,'')} http=${s.net4xx5xx.filter(x=>!x.includes('history')).length} pageerr=${s.pageerr.length}`);
  console.log('  trace content sample:', (await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(-300));
} else { console.log('查看完整执行过程 link not found (answer card present:', !!(await page.$('[data-testid=answer-card]')),')'); }
await page.screenshot({ path:`${SHOT_DIR}/qos-trace.png` });
await browser.close();
console.log('\nDONE ledger_trace');
