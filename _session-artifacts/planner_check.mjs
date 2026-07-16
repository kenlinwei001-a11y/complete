import { launch, login, BASE, pageState, snapLogs, clearLogs, SHOT_DIR } from './driver.mjs';
const { browser, page, logs } = await launch();
await login(page, {username:'planner'});
// access-denied message
await page.goto(`${BASE}/admin/agents`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(1500);
console.log('planner /admin/agents guard text:', (await page.evaluate(()=>{const m=document.querySelector('main')||document.body; return m.innerText.replace(/\s+/g,' ');})).slice(0,260));
// planner QOS query from risk view
await page.goto(`${BASE}/v/risk`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2000);
let input = await page.$('[data-testid=query-dock-bar] input');
await input.fill('常州基地影响哪些订单？');
await input.press('Enter');
clearLogs(logs);
let answered=false;
for (let i=0;i<16;i++){
  await page.waitForTimeout(1500);
  const slotForm = await page.$('[data-testid=slot-form]');
  if (slotForm){ for (const t of await slotForm.$$('input[type=text]')){ await t.fill('常州').catch(()=>{}); await page.waitForTimeout(500); const opt=await page.$('ul[role=listbox] button[role=option]'); if(opt) await opt.click().catch(()=>{}); } const sb=await slotForm.$('button[type=submit]'); if(sb){ await sb.click(); await page.waitForTimeout(2500);} continue; }
  const intentOpts = await page.$$('[data-testid^=intent-option-]'); if(intentOpts.length){ await intentOpts[0].click(); await page.waitForTimeout(2000); continue; }
  if (await page.$('[data-testid=answer-card]')){ answered=true; break; }
  if (await page.$('[data-testid=task-failed]')) break;
}
const ac = await page.$('[data-testid=answer-card]');
const trust = await page.$('[data-testid=trust-badge]');
console.log('planner QOS answered:', answered, 'trust:', trust?(await trust.innerText()).trim():null);
if (ac) console.log('answer:', (await ac.innerText()).replace(/\s+/g,' ').slice(0,260));
console.log('http errs:', snapLogs(logs).net4xx5xx.filter(x=>!x.includes('history')).slice(0,3).join(';')||'none');
await page.screenshot({ path:`${SHOT_DIR}/planner-qos.png` });
await browser.close();
