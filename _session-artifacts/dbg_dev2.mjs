import { launch, login, BASE, snapLogs, clearLogs } from './driver.mjs';
const { browser, page, logs } = await launch();
await login(page, {username:'admin'});
await page.goto(`${BASE}/scenarios`, { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2500);
// exact button: launcher-developing-S36 (button element, text 查看验证状态)
const btn = await page.$('[data-testid="launcher-developing-S36"]');
console.log('exact btn found:', !!btn, 'text=', btn?(await btn.innerText()).trim():'');
clearLogs(logs);
await btn.scrollIntoViewIfNeeded();
await btn.click();
await page.waitForTimeout(3000);
console.log('url after click:', page.url().replace(BASE,''));
console.log('scenes page loaded:', page.url().includes('/admin/scenes'), 'http=', snapLogs(logs).net4xx5xx.filter(x=>!x.includes('history')).length);
console.log('body:', (await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(0,220));
await browser.close();
