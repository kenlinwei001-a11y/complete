import { launch, login, BASE, SHOT_DIR } from './driver.mjs';
const { browser, page, logs } = await launch();
await login(page, {username:'admin'});
await page.goto(`${BASE}/scenarios`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2500);
const tids = await page.$$eval('[data-testid]', els=>[...new Set(els.map(e=>e.getAttribute('data-testid')))].filter(t=>/scen|card|launch|start|启动/i.test(t)));
console.log('scenario testids:', tids.slice(0,30).join('  '));
// find launch buttons
const launchBtns = await page.$$('button');
const cand=[];
for (const b of launchBtns){ const t=(await b.innerText()).replace(/\s+/g,' ').trim(); const tid=await b.getAttribute('data-testid'); if(/启动|launch|进入|开始|去/.test(t)||/launch|start|card/i.test(tid||'')) cand.push({t:t.slice(0,20),tid}); }
console.log('launch candidates:', cand.slice(0,12).map(c=>`${c.t}[${c.tid}]`).join(' | '));
// click first real launch button (data-testid based)
const realBtn = await page.$('[data-testid^="scenario-launch"], [data-testid^="scenario-card"], [data-testid^="launch-"]');
if (realBtn){
  const tid = await realBtn.getAttribute('data-testid');
  console.log('clicking', tid);
  await realBtn.scrollIntoViewIfNeeded();
  await realBtn.click().catch(e=>console.log('clickerr',String(e).slice(0,60)));
  await page.waitForTimeout(3000);
  console.log('after click url:', page.url().replace(BASE,''));
  console.log('body sample:', (await page.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ').slice(0,300));
} else {
  console.log('no testid-based launch button; dumping first 3 buttons full text');
  for (const b of (await page.$$('main button, [class*=card] button')).slice(0,3)){ console.log('  BTN:', (await b.innerText()).replace(/\s+/g,' ').slice(0,60), '| tid=', await b.getAttribute('data-testid')); }
}
await page.screenshot({ path:`${SHOT_DIR}/scenarios-inspect.png`, fullPage:true });

// ---- agent detail ----
await page.goto(`${BASE}/admin/agents`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2000);
const ag = await page.$('button:has-text("分析师 Agent")');
if (ag){ await ag.click(); await page.waitForTimeout(1200); const detail = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ')); console.log('\nAGENT detail after click (tail 400):', detail.slice(-400)); }
await page.screenshot({ path:`${SHOT_DIR}/agent-detail.png` });
await browser.close();
