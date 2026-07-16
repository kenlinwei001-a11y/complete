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
  // try 推演 views that mount InferenceProcessPanel
  for (const view of ['/v/risk', '/v/plan-audit', '/v/project-sim', '/v/order']) {
    await page.evaluate((v) => { window.history.pushState({}, '', v); window.dispatchEvent(new PopStateEvent('popstate')); }, view);
    await page.waitForTimeout(2500);
    // expand "推演过程" panel if present
    const expander = await page.$('text=推演过程');
    if (expander) { await expander.click().catch(() => {}); await page.waitForTimeout(1200); }
    const nodeKind = await page.$('[class*="nodeKind"]');
    if (nodeKind) {
      const info = await page.evaluate(() => {
        const el = document.querySelector('[class*="nodeKind"]');
        if (!el) return null;
        const c = getComputedStyle(el);
        return { fill: c.fill, color: c.color, text: el.textContent };
      });
      P('view=' + view + ' → .nodeKind found: ' + JSON.stringify(info));
      // var(--muted)=#9aa8b6=rgb(154,168,182); old var(--muted2)=#67737f=rgb(103,115,127)
      const val = (info.fill && info.fill !== 'none') ? info.fill : info.color;
      const isMuted = /154,\s*168,\s*182|#?9aa8b6/i.test(val);
      const isOld = /103,\s*115,\s*127|#?67737f/i.test(val);
      P('  computed color=' + val + ' | =var(--muted)#9aa8b6(亮): ' + isMuted + ' | =old --muted2#67737f(暗): ' + isOld);
      await page.screenshot({ path: EV + '/cf-c7-dag-contrast.png' });
      break;
    } else {
      P('view=' + view + ' → no .nodeKind (panel not rendered)');
    }
  }
} catch (e) { P('ERR: ' + e.message); }
console.log(JSON.stringify(out, null, 2));
await b.close();
