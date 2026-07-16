import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXE = process.env.CHROME;
const EV = '/home/user/complete/docs/evidence';
const BASE = 'http://127.0.0.1:5177';
const out = { steps: [] };
const P = (m) => out.steps.push(m);
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const page = await b.newPage({ viewport: { width: 1440, height: 950 } });
try {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', 'admin');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2500);
  // risk view
  await page.goto(BASE + '/v/risk', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  P('risk url=' + page.url());
  // risk cards present?
  const cards = await page.$$('[data-testid^="risk-card-"]');
  P('risk cards: ' + cards.length);
  // "开 what-if" button (gated by sim.sandbox·now on)
  let btn = await page.$('[data-testid="risk-open-whatif"]');
  if (!btn && cards.length) { await cards[0].click(); await page.waitForTimeout(1000); btn = await page.$('[data-testid="risk-open-whatif"]'); }
  P('risk-open-whatif button visible (sim.sandbox on): ' + !!btn + (btn ? ' text="' + ((await btn.textContent()) || '').trim() + '"' : ''));
  await page.screenshot({ path: EV + '/e2-c7-riskboard-whatif-btn.png', fullPage: true });
  if (btn) {
    await btn.click();
    await page.waitForTimeout(3500);
    P('after click → url=' + page.url());
    const isWhatif = /sim-sandbox|whatif/.test(page.url());
    P('navigated to sim-sandbox?whatif: ' + isWhatif);
    // sandbox what-if context bar + compare
    const ctxBar = await page.evaluate(() => {
      const t = document.body.innerText;
      return { hasWhatifCtx: /what-if|What-If|上下文|基线|预设|风险/.test(t), hasRadar: !!document.querySelector('[data-testid="sandbox-radar"]'), hasCompare: /对比|基线|diff|world|SimCompare/i.test(t) };
    });
    P('sandbox what-if context: ' + JSON.stringify(ctxBar));
    await page.screenshot({ path: EV + '/e2-c7-sandbox-whatif.png', fullPage: true });
  }
} catch (e) { P('ERR: ' + e.message); }
console.log(JSON.stringify(out, null, 2));
await b.close();
