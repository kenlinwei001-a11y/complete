import { launch, login, BASE, snapLogs, clearLogs, SHOT_DIR } from './driver.mjs';
const { browser, page, logs } = await launch();
await login(page, {username:'admin'});
await page.goto(`${BASE}/scenarios`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2500);
for (const sid of ['S01','S07','S11']){
  const btn = await page.$(`[data-testid="launcher-launch-${sid}"]`);
  if(!btn){ console.log(sid,'MISS'); continue; }
  const info = await btn.evaluate(el=>({ disabled:el.disabled, text:el.innerText.trim(), visible:el.offsetParent!==null, cls:el.className, rect:el.getBoundingClientRect().width+'x'+el.getBoundingClientRect().height }));
  console.log(sid, JSON.stringify(info));
}
// try force JS click on S01
console.log('--- force click S01 ---');
clearLogs(logs);
await page.$eval('[data-testid="launcher-launch-S01"]', el=>el.click());
await page.waitForTimeout(3500);
console.log('url:', page.url().replace(BASE,''));
const dock = await page.$('[data-testid=query-dock-panel]');
const clar = await page.$('[data-testid=clarification]');
const ans = await page.$('[data-testid=answer-card]');
console.log('after force click: dock=',!!dock,'clarify=',!!clar,'answer=',!!ans, 'http=', snapLogs(logs).net4xx5xx.filter(x=>!x.includes('history')).length);
console.log('body tail:', (await page.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ').slice(-350));
await page.screenshot({ path:`${SHOT_DIR}/scen-force-S01.png` });
await browser.close();
