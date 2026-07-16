import pkg from '/home/user/complete/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const EXE = process.env.CHROME;
const EV = '/home/user/complete/docs/evidence';
const BASE = 'http://127.0.0.1:5177';
const OBJ = '/o/Base/obj_base_changzhou';
const out = { steps: [] };
const p = (m) => out.steps.push(m);
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.fill('#login-tenant', 'demo');
  await page.fill('#login-username', 'admin');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2200);
  await page.goto(BASE + OBJ, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3200);
  const nodes = await page.$$('[data-testid^="o360-lineage-node-"]');
  p('nodes=' + nodes.length);
  // open drawer
  await nodes[1].click(); await page.waitForTimeout(900);
  p('open#1 drawer=' + !!(await page.$('[data-testid="dag-node-drawer"]')));
  // close via Escape
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  p('after-Escape drawer=' + !!(await page.$('[data-testid="dag-node-drawer"]')));
  // re-open a different node → proves repeatable
  const nodes2 = await page.$$('[data-testid^="o360-lineage-node-"]');
  await nodes2[3].click(); await page.waitForTimeout(900);
  const d2 = await page.$('[data-testid="dag-node-drawer"]');
  p('re-open#2 drawer=' + !!d2);
  if (d2) p('drawer2 src=' + (await (await page.$('[data-testid="dag-node-src"]'))?.textContent() || '').trim());
  // close via ✕ button
  const x = await page.$('button[aria-label]');
  const xlabel = x ? await x.getAttribute('aria-label') : null;
  p('close-btn aria-label=' + xlabel);
  if (x) { await x.click(); await page.waitForTimeout(700); }
  p('after-✕ drawer=' + !!(await page.$('[data-testid="dag-node-drawer"]')));
} catch (e) { p('ERR: ' + e.message); }
console.log(JSON.stringify(out, null, 2));
await b.close();
