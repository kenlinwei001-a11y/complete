import { launch, login } from './pw.mjs';
const SHOT = '/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad';
const { browser, page, logs } = await launch();
await login(page);
await page.waitForTimeout(1200);
// SPA-navigate into a business view so QueryDock mounts (full reload would drop in-memory auth)
const navLink = page.locator('a:has-text("产能推演"), button:has-text("产能推演")').first();
if (await navLink.count()) { await navLink.click(); } else {
  await page.locator('text=经营驾驶舱').first().click();
}
await page.waitForTimeout(2000);
console.log('url:', page.url(), '| dock bar count:', await page.locator('[data-testid=query-dock-bar]').count());
// find the query dock input (bar)
const bar = page.locator('[data-testid=query-dock-bar] input, [data-testid=query-dock-panel] input').first();
let typed = false;
if (await bar.count()) {
  await bar.click();
  await bar.fill('4680-NCM 加 20% 六周能不能接？');
  await page.keyboard.press('Enter');
  typed = true;
}
console.log('typed into dock:', typed, '| dock input count:', await page.locator('input').count());
// wait for clarification / candidates
let seen = false;
for (let i=0;i<25;i++){
  await page.waitForTimeout(1000);
  const txt = await page.locator('body').innerText().catch(()=> '');
  if (/澄清|请选择|意图|可承接|承接性|挤占|需要更多信息|choose|clarif/i.test(txt) && txt.includes('4680')) { seen = true; break; }
}
await page.screenshot({ path: `${SHOT}/ch01_clarify.png`, fullPage: true });
const body = await page.locator('body').innerText().catch(()=> '');
console.log('clarification-ish text seen:', seen);
const idx = Math.max(0, body.indexOf('4680-NCM 加 20%'));
console.log('--- DOCK AREA TEXT ---\n', body.slice(idx, idx+700));
console.log('--- recent console errors ---\n', logs.filter(l=>l.includes('error')||l.includes('pageerror')).slice(-6).join('\n'));
await browser.close();
