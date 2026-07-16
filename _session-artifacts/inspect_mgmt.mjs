import { launch, login, BASE } from './driver.mjs';
const { browser, page } = await launch();
await login(page, {username:'admin'});
for (const key of ['agents','workflows','solvers','skills']){
  await page.goto(`${BASE}/admin/${key}`, { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2500);
  const tids = await page.$$eval('[data-testid]', els=>[...new Set(els.map(e=>e.getAttribute('data-testid')))]);
  const pageTids = tids.filter(t=>!/^nav-|^board-|^health|tenant-name|global-search|history-clock|notif-|user-menu|left-nav|query-dock/.test(t));
  console.log(`\n### ${key}: ${pageTids.length} page testids`);
  console.log('  ', pageTids.slice(0,45).join('  '));
  // clickable buttons with text
  const btns = await page.$$eval('button', els=>els.filter(e=>e.offsetParent).map(e=>e.innerText.replace(/\s+/g,' ').trim()).filter(Boolean));
  console.log('  BTN texts:', [...new Set(btns)].slice(0,25).join(' | '));
}
await browser.close();
