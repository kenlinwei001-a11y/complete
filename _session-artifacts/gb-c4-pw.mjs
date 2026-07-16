import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXE = process.env.CHROME;
const EV = '/home/user/complete/docs/evidence';
const BASE = 'http://127.0.0.1:5177';
const out = { steps: [] };
const P = (m) => out.steps.push(m);
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1200);
  await page.fill('#login-tenant', 'demo'); await page.fill('#login-username', 'admin'); await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]'); await page.waitForTimeout(2500);
  const preSearchPath = await page.evaluate(() => location.pathname);
  P('C4 pre-search path=' + preSearchPath + ' idx=' + await page.evaluate(() => window.history.state?.idx ?? 0));
  // real global search → select a hit → navigates to o360 (React Router·idx++)
  await page.fill('[data-testid="global-search-input"]', '常州');
  await page.waitForTimeout(1800);
  const hits = await page.$$('[data-testid^="gs-hit-"]');
  P('search hits: ' + hits.length);
  if (hits.length) {
    await hits[0].click();
    await page.waitForTimeout(2800);
    const idx = await page.evaluate(() => window.history.state?.idx ?? 0);
    const backBtns = await page.$$('[data-testid="o360-back"]');
    P('C4 after search-select: url=' + page.url() + ' | o360-back count=' + backBtns.length + ' | history.idx=' + idx + ' (expect >0)');
    await page.screenshot({ path: EV + '/gb-c4-o360-searchdrill.png' });
    if (backBtns.length) {
      await backBtns[0].click();
      await page.waitForTimeout(1800);
      const afterPath = await page.evaluate(() => location.pathname);
      P('C4 after back: pathname=' + afterPath + ' | NOT /o/: ' + !afterPath.startsWith('/o/') + ' | ==pre-search(' + preSearchPath + '): ' + (afterPath === preSearchPath));
    }
  }
} catch (e) { P('ERR: ' + e.message); }
console.log(JSON.stringify(out, null, 2));
await b.close();
