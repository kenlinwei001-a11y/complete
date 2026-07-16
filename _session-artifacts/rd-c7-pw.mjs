import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXE = process.env.CHROME;
const EV = '/home/user/complete/docs/evidence';
const BASE = 'http://127.0.0.1:5178';
const out = { steps: [] };
const P = (m) => out.steps.push(m);
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const page = await b.newPage({ viewport: { width: 1440, height: 950 } });
try {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', 'planner');
  await page.fill('input[type=password]', 'demo');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2200);
  P('after-login url=' + page.url());
  // client-side nav (no reload → avoid mock refresh-401)
  await page.evaluate(() => { window.history.pushState({}, '', '/admin/rule-docs'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(2500);
  P('rule-docs url=' + page.url());
  // if not there, try clicking sidebar link
  if (!/rule-docs/.test(page.url()) || !(await page.$('[data-testid="ruledoc-progress"]'))) {
    const link = await page.$('a[href*="rule-docs"]') || await page.$('text=规则文档');
    if (link) { await link.click(); await page.waitForTimeout(2000); }
  }
  // select the EXTRACTING doc from the <select aria-label="选择文档"> so its progress bar renders
  try {
    await page.selectOption('select[aria-label="选择文档"]', { value: 'doc-extracting' });
  } catch (e) {
    await page.selectOption('select[aria-label="选择文档"]', { label: /抽取中|EXTRACTING/ }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  const selVal = await page.$eval('select[aria-label="选择文档"]', (s) => s.value).catch(() => null);
  P('selected doc value: ' + selVal);
  const prog = await page.$('[data-testid="ruledoc-progress"]');
  const count = await page.$('[data-testid="ruledoc-progress-count"]');
  const failed = await page.$('[data-testid="ruledoc-progress-failed"]');
  const countText = count ? ((await count.textContent()) || '').trim() : null;
  const failedText = failed ? ((await failed.textContent()) || '').trim() : null;
  P('ruledoc-progress present: ' + !!prog);
  P('progress count text: ' + JSON.stringify(countText) + ' (expect "3/4")');
  P('failed badge text: ' + JSON.stringify(failedText) + ' (expect "失败 1")');
  // progress bar fill width
  if (prog) {
    const fillW = await page.evaluate(() => { const p = document.querySelector('[data-testid="ruledoc-progress"] span span span'); return p ? p.style.width : null; });
    P('progress bar fill width: ' + fillW + ' (expect 75%)');
  }
  await page.screenshot({ path: EV + '/rd-c7-progress.png', fullPage: true });
} catch (e) { P('ERR: ' + e.message); }
console.log(JSON.stringify(out, null, 2));
await b.close();
